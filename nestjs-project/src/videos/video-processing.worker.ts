import 'dotenv/config';
import { Queue, Worker } from 'bullmq';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { AppDataSource } from '../database/data-source';
import { S3VideoStorage } from './s3-video-storage';
import { processVideo } from './video-processing';
import { VIDEO_PROCESSING_QUEUE } from './video-processing.queue';
import { reconcileFailedVideos } from './video-processing.reconciliation';

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
  });
  worker.on('error', (error) => console.error('video worker error', error));

  const reconciliationQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
    connection: {
      host: redis.host,
      port: redis.port,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      commandTimeout: 3000,
    },
  });
  reconciliationQueue.on('error', (error) =>
    console.error('video reconciliation queue error', error),
  );
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reconciliation: Promise<void>;
  const reconcile = (): void => {
    reconciliation = reconcileFailedVideos(
      AppDataSource.manager,
      reconciliationQueue,
    )
      .catch((failure: unknown) =>
        console.error('video status reconciliation failed', failure),
      )
      .finally(() => {
        if (!stopping) timer = setTimeout(reconcile, 5000);
      });
  };
  reconcile();

  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    void (async () => {
      await worker.close();
      await reconciliation;
      await reconciliationQueue.close();
      await AppDataSource.destroy();
    })().catch((error: unknown) => {
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
