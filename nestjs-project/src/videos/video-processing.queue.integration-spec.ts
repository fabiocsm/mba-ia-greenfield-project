import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import queueConfig from '../config/queue.config';
import {
  VIDEO_PROCESSING_QUEUE,
  VideoProcessingQueue,
} from './video-processing.queue';

// Namespace the real Redis queues; retain BullMQ's implementation and scripts.
jest.mock('bullmq', () => {
  const bullmq = jest.requireActual<typeof import('bullmq')>('bullmq');
  const { randomUUID: allocatePrefix } =
    jest.requireActual<typeof import('node:crypto')>('node:crypto');
  const prefix = `queue-review-${allocatePrefix()}`;
  return {
    ...bullmq,
    Queue: class extends bullmq.Queue {
      constructor(name: string, options: import('bullmq').QueueOptions) {
        super(name, { ...options, prefix });
      }
    },
  };
});

describe('VideoProcessingQueue (integration)', () => {
  const connection = { host: 'redis', port: 6379 };
  let producer: VideoProcessingQueue;
  let queue: Queue;
  let events: QueueEvents;
  const workers: Worker[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingQueue,
        { provide: queueConfig.KEY, useValue: connection },
      ],
    }).compile();
    producer = module.get(VideoProcessingQueue);
    queue = new Queue(VIDEO_PROCESSING_QUEUE, { connection });
    events = new QueueEvents(queue.name, {
      connection,
      prefix: queue.opts.prefix,
    });
    await events.waitUntilReady();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await queue.drain(true);
  });

  afterAll(async () => {
    await producer.onModuleDestroy();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  });

  function startWorker(processor: (job: Job) => Promise<void>): Worker {
    const worker = new Worker(queue.name, processor, {
      connection,
      prefix: queue.opts.prefix,
    });
    workers.push(worker);
    return worker;
  }

  async function failedJob(): Promise<Job> {
    const worker = startWorker(() =>
      Promise.reject(
        new Error('Database unavailable before claiming the draft'),
      ),
    );
    const videoId = randomUUID();
    const job = await queue.add(
      'process',
      { videoId },
      { jobId: videoId, attempts: 1 },
    );
    await expect(job.waitUntilFinished(events, 5000)).rejects.toThrow(
      'Database unavailable',
    );
    await worker.close();
    expect(await job.getState()).toBe('failed');
    return job;
  }

  it('reschedules a retained failed job when completion is repeated', async () => {
    const job = await failedJob();

    await producer.enqueue(job.id!);

    expect(await job.getState()).toBe('waiting');
    startWorker(() => Promise.resolve());
    await job.waitUntilFinished(events, 5000);
    expect(await job.getState()).toBe('completed');
    expect((await queue.getJob(job.id!))?.opts.attempts).toBe(1);
  });

  it('accepts concurrent rescheduling while adding the failed job only once', async () => {
    const job = await failedJob();
    const originalRetry = Job.prototype.retry;
    let release!: () => void;
    const bothRetrying = new Promise<void>((resolve) => {
      release = resolve;
    });
    let retryCalls = 0;
    jest.spyOn(Job.prototype, 'retry').mockImplementation(async function (
      this: Job,
      ...args: Parameters<Job['retry']>
    ) {
      if (++retryCalls === 2) release();
      await bothRetrying;
      await originalRetry.apply(this, args);
    });

    await expect(
      Promise.all([producer.enqueue(job.id!), producer.enqueue(job.id!)]),
    ).resolves.toEqual([undefined, undefined]);

    expect(await job.getState()).toBe('waiting');
    const waiting = await queue.getJobs(['waiting']);
    expect(waiting.filter((candidate) => candidate.id === job.id)).toHaveLength(
      1,
    );
  });

  it('keeps one attempt when a newly added job fails before scheduling returns', async () => {
    const videoId = randomUUID();
    startWorker(() => Promise.reject(new Error('Processing failed')));
    const originalAdd = Queue.prototype.add;
    jest.spyOn(Queue.prototype, 'add').mockImplementation(async function (
      this: Queue,
      ...args: Parameters<Queue['add']>
    ) {
      const job = (await originalAdd.apply(this, args)) as Job;
      await expect(job.waitUntilFinished(events, 5000)).rejects.toThrow(
        'Processing failed',
      );
      return job;
    });
    const retry = jest.spyOn(Job.prototype, 'retry');

    await producer.enqueue(videoId);

    expect(retry).not.toHaveBeenCalled();
    const job = await queue.getJob(videoId);
    expect(await job?.getState()).toBe('failed');
    expect(job?.attemptsMade).toBe(1);
  });

  it('keeps waiting and active jobs deduplicated', async () => {
    const videoId = randomUUID();
    await producer.enqueue(videoId);
    await producer.enqueue(videoId);
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
    let release!: () => void;
    const processing = new Promise<void>((resolve) => {
      release = resolve;
    });
    let executions = 0;
    const worker = startWorker(async () => {
      executions += 1;
      await processing;
    });
    const active = once(worker, 'active');
    try {
      await active;
      await producer.enqueue(videoId);
      expect(await (await queue.getJob(videoId))?.getState()).toBe('active');
      expect(executions).toBe(1);
    } finally {
      release();
    }
    const job = await queue.getJob(videoId);
    await job!.waitUntilFinished(events, 5000);
  });

  it('rejects within a bounded time when Redis is unreachable', async () => {
    const warning = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    // No service listens on this port; do not interrupt the shared queue.
    const queue = new VideoProcessingQueue({ host: 'redis', port: 1 });
    const started = Date.now();
    try {
      await expect(queue.enqueue('unreachable-redis')).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(6000);
    } finally {
      await queue.onModuleDestroy();
      warning.mockRestore();
    }
  }, 10_000);
});
