import { Queue, QueueEvents, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { claimDraft, markError, markReady } from './video-processing';
import { reconcileFailedVideos } from './video-processing.reconciliation';

describe('video processing reconciliation (integration)', () => {
  const connection = { host: 'redis', port: 6379 };
  const queueName = `video-reconciliation-${randomUUID()}`;
  const workers: Worker[] = [];
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let queue: Queue;
  let events: QueueEvents;

  beforeAll(async () => {
    dataSource = createTestDataSource([
      User,
      Channel,
      Video,
      RefreshToken,
      VerificationToken,
    ]);
    await dataSource.initialize();
    videos = dataSource.getRepository(Video);
    queue = new Queue(queueName, { connection });
    events = new QueueEvents(queueName, { connection });
    await events.waitUntilReady();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await queue.drain(true);
  });

  afterAll(async () => {
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
    await dataSource.destroy();
  });

  async function insertDraft(): Promise<Video> {
    const suffix = randomUUID();
    const user = await dataSource.getRepository(User).save({
      email: `reconcile-${suffix}@example.com`,
      password: 'hashed',
    });
    const channel = await dataSource.getRepository(Channel).save({
      name: 'Reconciliation channel',
      nickname: `reconcile-${suffix}`,
      user_id: user.id,
    });
    return videos.save(
      videos.create({
        channel_id: channel.id,
        public_url: suffix,
        original_storage_key: `originals/${suffix}`,
        status: 'draft',
      }),
    );
  }

  async function insertProcessing(): Promise<{ video: Video; claim: string }> {
    const video = await insertDraft();
    const claim = await claimDraft(dataSource.manager, video.id);
    if (!claim) throw new Error('Test video was not claimed');
    return { video, claim };
  }

  function startWorker(processor: () => Promise<void>): Worker {
    const worker = new Worker(queueName, processor, { connection });
    workers.push(worker);
    return worker;
  }

  async function finishJob(videoId: string, outcome: 'failed' | 'completed') {
    const worker = startWorker(() =>
      outcome === 'failed'
        ? Promise.reject(new Error('Media processing failed'))
        : Promise.resolve(),
    );
    const job = await queue.add('process', { videoId }, { jobId: videoId });
    const finished = job.waitUntilFinished(events, 5000);
    if (outcome === 'failed') {
      await expect(finished).rejects.toThrow('Media processing failed');
    } else {
      await finished;
    }
    await worker.close();
    expect(await job.getState()).toBe(outcome);
    return job;
  }

  it.each(['failed', 'completed'] as const)(
    'recovers a persisted processing claim from a %s job after restart',
    async (outcome) => {
      const { video, claim } = await insertProcessing();
      await finishJob(video.id, outcome);
      // A fresh queue client finds the persisted failure; there is no in-memory
      // failed-event retry list to recover from the previous worker process.
      await queue.close();
      queue = new Queue(queueName, { connection });

      await reconcileFailedVideos(dataSource.manager, queue);

      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe('error');
      expect(row.processing_claim).toBe(claim);
      expect(row.original_storage_key).toBe(video.original_storage_key);
      expect(row.duration_seconds).toBeNull();
      expect(row.thumbnail_storage_key).toBeNull();

      await reconcileFailedVideos(dataSource.manager, queue);
      expect(await videos.findOneByOrFail({ id: video.id })).toEqual(row);
    },
  );

  it('leaves a processing claim with a waiting job unchanged', async () => {
    const { video } = await insertProcessing();
    const job = await queue.add('process', {}, { jobId: video.id });
    expect(await job.getState()).toBe('waiting');

    await reconcileFailedVideos(dataSource.manager, queue);

    expect((await videos.findOneByOrFail({ id: video.id })).status).toBe(
      'processing',
    );
  });

  it('leaves a processing claim with an active job unchanged', async () => {
    const { video } = await insertProcessing();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const worker = startWorker(async () => blocked);
    const active = once(worker, 'active');
    const job = await queue.add('process', {}, { jobId: video.id });
    try {
      await active;
      expect(await job.getState()).toBe('active');

      await reconcileFailedVideos(dataSource.manager, queue);

      expect((await videos.findOneByOrFail({ id: video.id })).status).toBe(
        'processing',
      );
    } finally {
      release();
      await job.waitUntilFinished(events, 5000);
    }
  });

  it('preserves ready, error and draft videos even when their jobs failed', async () => {
    const ready = await insertProcessing();
    await markReady(dataSource.manager, ready.video.id, ready.claim, {
      durationSeconds: 1,
      technicalMetadata: { format: {}, streams: [] },
      thumbnailStorageKey: `thumbnails/${ready.video.id}`,
    });
    const error = await insertProcessing();
    await markError(dataSource.manager, error.video.id, error.claim);
    const draft = await insertDraft();
    for (const videoId of [ready.video.id, error.video.id, draft.id]) {
      await finishJob(videoId, 'failed');
    }
    const before = await videos.find({ order: { id: 'ASC' } });

    await reconcileFailedVideos(dataSource.manager, queue);

    expect(await videos.find({ order: { id: 'ASC' } })).toEqual(before);
  });

  it('does not overwrite a claim changed after discovery', async () => {
    const { video } = await insertProcessing();
    await finishJob(video.id, 'failed');
    const nextClaim = randomUUID();
    const getJob = jest.spyOn(queue, 'getJob');
    getJob.mockImplementationOnce(async (id) => {
      await videos.update(video.id, { processing_claim: nextClaim });
      getJob.mockRestore();
      return queue.getJob(id);
    });

    await reconcileFailedVideos(dataSource.manager, queue);

    const row = await videos.findOneByOrFail({ id: video.id });
    expect(row.status).toBe('processing');
    expect(row.processing_claim).toBe(nextClaim);
  });
});
