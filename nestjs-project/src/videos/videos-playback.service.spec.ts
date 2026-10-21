import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../channels/channels.service';
import { Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStorage } from './video-storage';
import {
  VideoFileNotStoredException,
  VideoNotReadyException,
} from './video.exceptions';
import { VideosService } from './videos.service';

describe('VideosService playback', () => {
  let service: VideosService;
  let signGet: jest.Mock;
  let findOne: jest.Mock;

  beforeEach(async () => {
    signGet = jest
      .fn()
      .mockImplementation((key: string, attachment: boolean) => {
        const disposition = attachment
          ? '&response-content-disposition=attachment'
          : '';
        return Promise.resolve(
          `http://minio:9000/videos/${key}?X-Amz-Expires=900${disposition}`,
        );
      });
    findOne = jest.fn();

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: { findOne } },
        {
          provide: ChannelsService,
          useValue: {
            findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
          },
        },
        { provide: PublicUrlAllocator, useValue: { allocate: jest.fn() } },
        { provide: VideoStorage, useValue: { signGet } },
        { provide: VideoProcessingQueue, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  function row(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-id',
      channel_id: 'channel-id',
      status: 'ready',
      public_url: 'public-url',
      title: null,
      description: null,
      multipart_upload_id: null,
      original_storage_key: 'originals/video-id',
      thumbnail_storage_key: 'thumbnails/video-id',
      ...overrides,
    } as Video;
  }

  it('signs the original for a ready video owned by the caller', async () => {
    const video = row();
    findOne.mockResolvedValue(video);

    const result = await service.playback('user-id', 'video-id');

    expect(result.expiresInSeconds).toBe(900);
    expect(result.fileUrl).toContain('originals/video-id');
    expect(result.fileUrl).not.toContain('thumbnails/');
    expect(result.fileUrl).not.toContain('public-url');
    expect(result.fileUrl).not.toContain('response-content-disposition');
    expect(signGet).toHaveBeenCalledWith('originals/video-id', false);
    expect(video.status).toBe('ready');
    expect(video.original_storage_key).toBe('originals/video-id');
  });

  it.each(['draft', 'processing', 'error'] as const)(
    'rejects playback while the video is %s',
    async (status) => {
      const video = row({ status, original_storage_key: 'originals/video-id' });
      findOne.mockResolvedValue(video);

      await expect(
        service.playback('user-id', 'video-id'),
      ).rejects.toBeInstanceOf(VideoNotReadyException);

      expect(signGet).not.toHaveBeenCalled();
      expect(video.status).toBe(status);
      expect(video.original_storage_key).toBe('originals/video-id');
    },
  );

  it('rejects a ready video that has no stored file', async () => {
    findOne.mockResolvedValue(row({ original_storage_key: null }));

    await expect(
      service.playback('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoFileNotStoredException);

    expect(signGet).not.toHaveBeenCalled();
  });

  it('asks for an attachment disposition on download of the same object', async () => {
    findOne.mockResolvedValue(row());

    const result = await service.download('user-id', 'video-id');

    expect(result.expiresInSeconds).toBe(900);
    expect(result.fileUrl).toContain('originals/video-id');
    expect(result.fileUrl).toContain('response-content-disposition=attachment');
    expect(signGet).toHaveBeenCalledWith('originals/video-id', true);
  });
});
