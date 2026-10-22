import type { Queue } from 'bullmq';
import type { EntityManager } from 'typeorm';
import { reconcileFailedVideos } from './video-processing.reconciliation';

describe('reconcileFailedVideos', () => {
  const id = 'processing-video';
  const claim = 'processing-claim';
  let find: jest.Mock;
  let query: jest.Mock;
  let getState: jest.Mock;
  let getJob: jest.Mock;
  let manager: EntityManager;
  let queue: Pick<Queue, 'getJob'>;

  beforeEach(() => {
    find = jest.fn().mockResolvedValue([{ id, processing_claim: claim }]);
    query = jest.fn().mockResolvedValue([[{ id }], 1]);
    getState = jest.fn().mockResolvedValue('failed');
    getJob = jest.fn().mockResolvedValue({ getState });
    manager = { find, query } as unknown as EntityManager;
    queue = { getJob };
  });

  it('retries status persistence on a later pass after a database outage', async () => {
    query.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(reconcileFailedVideos(manager, queue)).rejects.toThrow(
      'database unavailable',
    );
    await expect(
      reconcileFailedVideos(manager, queue),
    ).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenLastCalledWith(expect.any(String), [id, claim]);
    expect(getState).toHaveBeenCalledTimes(2);
  });

  it('retries discovery after a transient database read failure', async () => {
    find.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(reconcileFailedVideos(manager, queue)).rejects.toThrow(
      'database unavailable',
    );
    expect(getJob).not.toHaveBeenCalled();
    await reconcileFailedVideos(manager, queue);

    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reconciles a completed duplicate that left an existing claim processing', async () => {
    getState.mockResolvedValue('completed');

    await reconcileFailedVideos(manager, queue);

    expect(query).toHaveBeenCalledWith(expect.any(String), [id, claim]);
  });

  it.each(['waiting', 'active', 'delayed', 'unknown'])(
    'leaves %s jobs unchanged',
    async (state) => {
      getState.mockResolvedValue(state);

      await reconcileFailedVideos(manager, queue);

      expect(query).not.toHaveBeenCalled();
    },
  );

  it('leaves videos with no retained job unchanged', async () => {
    getJob.mockResolvedValue(undefined);

    await reconcileFailedVideos(manager, queue);

    expect(query).not.toHaveBeenCalled();
  });

  it('does not persist an error without a processing claim', async () => {
    find.mockResolvedValue([{ id, processing_claim: null }]);

    await reconcileFailedVideos(manager, queue);

    expect(getJob).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
