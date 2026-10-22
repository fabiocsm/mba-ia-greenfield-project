import type { Queue } from 'bullmq';
import type { EntityManager } from 'typeorm';
import { Video } from './entities/video.entity';
import { markError } from './video-processing';

// Both the processing claim and terminal BullMQ outcome survive worker restarts.
// Leave other queue states alone: a stalled job may still be active until BullMQ
// finishes its own recovery, and a draft may legitimately be scheduled again.
export async function reconcileFailedVideos(
  manager: EntityManager,
  queue: Pick<Queue, 'getJob'>,
): Promise<void> {
  const processing = await manager.find(Video, {
    select: { id: true, processing_claim: true },
    where: { status: 'processing' },
  });

  for (const video of processing) {
    if (!video.processing_claim) continue;
    const job = await queue.getJob(video.id);
    const state = await job?.getState();
    // A successful processor persists ready/error before completing. A completed
    // job can still leave processing behind if a concurrent completion retried a
    // failed job and the duplicate found an existing claim, then did no work.
    if (state === 'failed' || state === 'completed') {
      await markError(manager, video.id, video.processing_claim);
    }
  }
}
