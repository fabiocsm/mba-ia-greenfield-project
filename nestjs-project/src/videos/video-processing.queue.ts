import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

@Injectable()
export class VideoProcessingQueue implements OnModuleDestroy {
  private readonly queue: Queue;

  constructor(
    @Inject(queueConfig.KEY)
    config: ConfigType<typeof queueConfig>,
  ) {
    this.queue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: {
        host: config.host,
        port: config.port,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: { attempts: 1 },
    });
  }

  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      'process',
      { videoId },
      { jobId: videoId, attempts: 1 },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
