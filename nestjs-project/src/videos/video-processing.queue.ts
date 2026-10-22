import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';

export const VIDEO_PROCESSING_QUEUE = 'video-processing';

@Injectable()
export class VideoProcessingQueue implements OnModuleDestroy {
  private readonly queue: Queue;
  private readonly logger = new Logger(VideoProcessingQueue.name);

  constructor(
    @Inject(queueConfig.KEY)
    config: ConfigType<typeof queueConfig>,
  ) {
    this.queue = new Queue(VIDEO_PROCESSING_QUEUE, {
      connection: {
        host: config.host,
        port: config.port,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2000,
        commandTimeout: 3000,
      },
      defaultJobOptions: { attempts: 1 },
    });
    this.queue.on('error', (error) => this.logger.warn(error.message));
  }

  async enqueue(videoId: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.queue.add('process', { videoId }, { jobId: videoId, attempts: 1 }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Video queue scheduling timed out')),
            5000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
