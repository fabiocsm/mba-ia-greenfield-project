import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

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

  let counter = 0;

  async function createChannel(): Promise<Channel> {
    const n = ++counter;
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${n}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${n}`,
        nickname: `videochan${n}`,
        user_id: user.id,
      }),
    );
  }

  it('should persist status draft when status is omitted', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_url: `url-${channel.id}`,
      }),
    );

    expect(video.status).toBe('draft');
  });

  it('should persist blank title and description as null', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_url: `url-${channel.id}`,
        title: '   ',
        description: '',
      }),
    );

    expect(video.title).toBeNull();
    expect(video.description).toBeNull();
  });

  it('should reject two videos with the same public_url', async () => {
    const channel = await createChannel();
    await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_url: 'shared-url',
      }),
    );

    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: channel.id,
          public_url: 'shared-url',
        }),
      ),
    ).rejects.toThrow();
  });

  it('should require channel_id to reference channels and keep the file out of a content column', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          channel_id: '00000000-0000-0000-0000-000000000000',
          public_url: 'missing-channel',
        }),
      ),
    ).rejects.toThrow();

    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        public_url: `url-${channel.id}`,
      }),
    );
    expect(video.channel_id).toBe(channel.id);

    await expect(channelRepository.delete(channel.id)).rejects.toThrow();

    const columns: { column_name: string; data_type: string }[] =
      await dataSource.query(
        `SELECT column_name, data_type
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'videos'`,
      );
    expect(columns.map((column) => column.column_name)).not.toContain(
      'content',
    );
    expect(columns.some((column) => column.data_type === 'bytea')).toBe(false);
    expect(columns.map((column) => column.column_name)).toContain(
      'original_storage_key',
    );
  });
});
