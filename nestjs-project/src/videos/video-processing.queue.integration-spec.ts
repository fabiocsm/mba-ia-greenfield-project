import { Logger } from '@nestjs/common';
import { VideoProcessingQueue } from './video-processing.queue';

describe('VideoProcessingQueue (integration)', () => {
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
