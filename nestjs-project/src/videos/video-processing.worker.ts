import 'dotenv/config';
import { Worker } from 'bullmq';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { AppDataSource } from '../database/data-source';
import { S3VideoStorage } from './s3-video-storage';
import { markInterrupted, processVideo } from './video-processing';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.queue';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const storage = new S3VideoStorage(storageConfig());
  const redis = queueConfig();
  const worker = new Worker(
    VIDEO_PROCESSING_QUEUE,
    async (job: { data: { videoId: string } }) => {
      await processVideo(AppDataSource.manager, storage, job.data.videoId);
    },
    {
      connection: {
        host: redis.host,
        port: redis.port,
        maxRetriesPerRequest: null,
      },
      concurrency: 1,
      maxStalledCount: 0,
    },
  );

  worker.on('failed', (job, error) => {
    console.error('video processing failed', job?.id, error);
    if (job) {
      void markInterrupted(AppDataSource.manager, job.data.videoId).catch(
        (failure: unknown) =>
          console.error('video status update failed', failure),
      );
    }
  });
  worker.on('error', (error) => console.error('video worker error', error));

  const shutdown = () => {
    void worker
      .close()
      .then(() => AppDataSource.destroy())
      .catch((error: unknown) => {
        console.error('video worker shutdown failed', error);
        process.exitCode = 1;
      });
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

void main().catch((error: unknown) => {
  console.error('video worker startup failed', error);
  process.exitCode = 1;
});
