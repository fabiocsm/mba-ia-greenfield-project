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
import {
  claimDraft,
  markError,
  markInterrupted,
  markReady,
} from './video-processing';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('video processing claim (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let sequence = 0;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function insertDraft(
    storageKey: string | null = `originals/worker-${sequence + 1}`,
  ): Promise<Video> {
    const n = ++sequence;
    const user = await userRepository.save(
      userRepository.create({
        email: `worker_${n}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `workerchan${n}`,
        user_id: user.id,
      }),
    );
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_url: `worker-url-${n}`,
        status: 'draft',
        original_storage_key: storageKey,
      }),
    );
  }

  it('does not let a second job overwrite ready or error', async () => {
    const readyVideo = await insertDraft();
    const readyClaim = await claimDraft(dataSource.manager, readyVideo.id);
    expect(readyClaim).toEqual(expect.any(String));
    expect(await claimDraft(dataSource.manager, readyVideo.id)).toBeNull();

    const thumbnail = `thumbnails/${readyVideo.id}`;
    expect(
      await markReady(dataSource.manager, readyVideo.id, readyClaim!, {
        durationSeconds: 1.5,
        technicalMetadata: { format: { duration: '1.5' }, streams: [] },
        thumbnailStorageKey: thumbnail,
      }),
    ).toBe(true);
    expect(
      await markError(dataSource.manager, readyVideo.id, readyClaim!),
    ).toBe(false);

    const readyRow = await videoRepository.findOneByOrFail({
      id: readyVideo.id,
    });
    expect(readyRow.status).toBe('ready');
    expect(readyRow.original_storage_key).toBe(readyVideo.original_storage_key);
    expect(readyRow.duration_seconds).toBe(1.5);
    expect(readyRow.thumbnail_storage_key).toBe(thumbnail);
    expect(readyRow.technical_metadata).toEqual({
      format: { duration: '1.5' },
      streams: [],
    });

    const errorVideo = await insertDraft();
    const errorClaim = await claimDraft(dataSource.manager, errorVideo.id);
    expect(
      await markError(dataSource.manager, errorVideo.id, errorClaim!),
    ).toBe(true);
    expect(
      await markReady(dataSource.manager, errorVideo.id, errorClaim!, {
        durationSeconds: 1,
        technicalMetadata: { format: {}, streams: [] },
        thumbnailStorageKey: `thumbnails/${errorVideo.id}`,
      }),
    ).toBe(false);

    const errorRow = await videoRepository.findOneByOrFail({
      id: errorVideo.id,
    });
    expect(errorRow.status).toBe('error');
    expect(errorRow.original_storage_key).toBe(errorVideo.original_storage_key);
    expect(errorRow.thumbnail_storage_key).toBeNull();
  });

  it('leaves a draft without a stored file in draft', async () => {
    const video = await insertDraft(null);

    expect(await claimDraft(dataSource.manager, video.id)).toBeNull();

    const row = await videoRepository.findOneByOrFail({ id: video.id });
    expect(row.status).toBe('draft');
    expect(row.processing_claim).toBeNull();
    expect(row.original_storage_key).toBeNull();
  });

  it('marks an interrupted worker as error while preserving the original and terminal states', async () => {
    const video = await insertDraft();
    await claimDraft(dataSource.manager, video.id);
    await markInterrupted(dataSource.manager, video.id);
    const interrupted = await videoRepository.findOneByOrFail({ id: video.id });
    expect(interrupted.status).toBe('error');
    expect(interrupted.original_storage_key).toBe(video.original_storage_key);

    const ready = await insertDraft();
    const claim = await claimDraft(dataSource.manager, ready.id);
    await markReady(dataSource.manager, ready.id, claim!, {
      durationSeconds: 1,
      technicalMetadata: { format: {}, streams: [] },
      thumbnailStorageKey: `thumbnails/${ready.id}`,
    });
    await markInterrupted(dataSource.manager, ready.id);
    expect(
      (await videoRepository.findOneByOrFail({ id: ready.id })).status,
    ).toBe('ready');
  });
});
