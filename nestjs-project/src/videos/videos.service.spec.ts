import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStorage } from './video-storage';
import {
  ChannelNotFoundException,
  VideoChannelForbiddenException,
} from './video.exceptions';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  const channel = { id: 'channel-id', user_id: 'user-id' };
  let service: VideosService;
  let videos: { create: jest.Mock; save: jest.Mock };
  let channels: { findByUserId: jest.Mock };
  let publicUrls: { allocate: jest.Mock };

  beforeEach(async () => {
    videos = {
      create: jest.fn((data: Partial<Video>) => ({
        id: 'video-id',
        ...data,
      })),
      save: jest.fn((entity: Video) => Promise.resolve(entity)),
    };
    channels = { findByUserId: jest.fn().mockResolvedValue(channel) };
    publicUrls = { allocate: jest.fn().mockReturnValue('url-1') };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videos },
        { provide: ChannelsService, useValue: channels },
        { provide: PublicUrlAllocator, useValue: publicUrls },
        { provide: VideoStorage, useValue: {} },
        { provide: VideoProcessingQueue, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  it('asks for one insert and stores status draft', async () => {
    const result = await service.create('user-id', {});

    expect(videos.save).toHaveBeenCalledTimes(1);
    expect(videos.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'channel-id',
        public_url: 'url-1',
        status: 'draft',
      }),
    );
    expect(result.status).toBe('draft');
    expect(result.url).toBe('/videos/by-url/url-1');
  });

  it('stores blank title and description as null', async () => {
    await service.create('user-id', { title: '   ', description: '' });

    expect(videos.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: null, description: null }),
    );
  });

  it('does not insert when the channel belongs to someone else', async () => {
    await expect(
      service.create('user-id', { channelId: 'other-channel' }),
    ).rejects.toBeInstanceOf(VideoChannelForbiddenException);

    expect(videos.save).not.toHaveBeenCalled();
  });

  it('does not insert when the user has no channel', async () => {
    channels.findByUserId.mockResolvedValue(null);

    await expect(service.create('user-id', {})).rejects.toBeInstanceOf(
      ChannelNotFoundException,
    );

    expect(videos.save).not.toHaveBeenCalled();
  });

  it('allocates another public url when the first insert collides', async () => {
    const collision = new QueryFailedError(
      'INSERT',
      [],
      new Error(),
    ) as QueryFailedError & {
      code: string;
      detail: string;
    };
    collision.code = '23505';
    collision.detail = 'Key (public_url)=(url-1) already exists.';
    publicUrls.allocate
      .mockReturnValueOnce('url-1')
      .mockReturnValueOnce('url-2');
    videos.save
      .mockRejectedValueOnce(collision)
      .mockImplementationOnce((entity: Video) => Promise.resolve(entity));

    const result = await service.create('user-id', {});

    expect(publicUrls.allocate).toHaveBeenCalledTimes(2);
    expect(videos.save).toHaveBeenCalledTimes(2);
    expect(result.url).toBe('/videos/by-url/url-2');
  });
});
