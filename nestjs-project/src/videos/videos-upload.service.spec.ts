import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../channels/channels.service';
import { Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { VideoProcessingQueue } from './video-processing.queue';
import { MultipartUploadNotFoundError, VideoStorage } from './video-storage';
import {
  VideoFileAlreadyStoredException,
  VideoFileEmptyException,
  VideoFileNotVideoException,
  VideoFileTooLargeException,
} from './video.exceptions';
import { VideosService } from './videos.service';

describe('VideosService upload', () => {
  const channel = { id: 'channel-id' };
  let service: VideosService;
  let storage: {
    createMultipart: jest.Mock;
    listUploadedPartNumbers: jest.Mock;
    listParts: jest.Mock;
    signPart: jest.Mock;
    abortMultipart: jest.Mock;
    headObject: jest.Mock;
  };
  let findOne: jest.Mock;
  let save: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn();
    save = jest.fn((video: Video) => Promise.resolve(video));
    storage = {
      createMultipart: jest.fn().mockResolvedValue('upload-1'),
      listUploadedPartNumbers: jest.fn().mockResolvedValue([]),
      listParts: jest.fn().mockResolvedValue([]),
      signPart: jest.fn((_key: string, _uploadId: string, partNumber: number) =>
        Promise.resolve(`https://signed/${partNumber}`),
      ),
      abortMultipart: jest.fn(),
      headObject: jest.fn().mockResolvedValue(null),
    };

    const videos = {
      manager: {
        transaction: (run: (manager: unknown) => Promise<unknown>) =>
          run({
            getRepository: () => ({ findOne, save }),
          }),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videos },
        {
          provide: ChannelsService,
          useValue: { findByUserId: jest.fn().mockResolvedValue(channel) },
        },
        { provide: PublicUrlAllocator, useValue: { allocate: jest.fn() } },
        { provide: VideoStorage, useValue: storage },
        { provide: VideoProcessingQueue, useValue: { enqueue: jest.fn() } },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  function draft(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-id',
      channel_id: 'channel-id',
      status: 'draft',
      multipart_upload_id: null,
      original_storage_key: null,
      declared_size_bytes: null,
      declared_content_type: null,
      ...overrides,
    } as Video;
  }

  it('rejects an empty file without opening a multipart upload', async () => {
    findOne.mockResolvedValue(draft());

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 0,
        contentType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoFileEmptyException);

    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('rejects a content type that is not video without opening a multipart upload', async () => {
    findOne.mockResolvedValue(draft());

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 1024,
        contentType: 'text/plain; charset=utf-8',
      }),
    ).rejects.toBeInstanceOf(VideoFileNotVideoException);

    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('rejects a file above 10GB without opening a multipart upload', async () => {
    findOne.mockResolvedValue(draft());

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 10_000_000_001,
        contentType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoFileTooLargeException);

    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('rejects a video whose file is already stored', async () => {
    findOne.mockResolvedValue(
      draft({ original_storage_key: 'originals/video-id' }),
    );

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 1024,
        contentType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoFileAlreadyStoredException);

    expect(storage.createMultipart).not.toHaveBeenCalled();
  });

  it('reuses the same multipart upload and signs only the missing parts', async () => {
    findOne.mockResolvedValue(
      draft({
        multipart_upload_id: 'upload-existing',
        declared_size_bytes: 5_242_881,
        declared_content_type: 'video/mp4',
      }),
    );
    storage.listParts.mockResolvedValue([
      { partNumber: 1, size: 5_242_880, eTag: '"correct"' },
    ]);
    storage.listUploadedPartNumbers.mockResolvedValue([1]);

    const opened = await service.openUpload('user-id', 'video-id', {
      sizeBytes: 5_242_881,
      contentType: 'video/mp4',
    });

    expect(opened.statusCode).toBe(200);
    expect(opened.body.partSizeBytes).toBe(5_242_880);
    expect(opened.body.parts).toEqual([
      { partNumber: 2, url: 'https://signed/2' },
    ]);
    expect(storage.createMultipart).not.toHaveBeenCalled();
    expect(storage.signPart).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    { firstSize: 5_242_879, finalSize: 1024, expectedParts: [1] },
    { firstSize: 5_242_880, finalSize: 512, expectedParts: [2] },
    { firstSize: 5_242_880, finalSize: 1025, expectedParts: [2] },
    { firstSize: 5_242_880, finalSize: 1024, expectedParts: [] },
  ])(
    're-signs incorrect part lengths ($firstSize, $finalSize) and omits correct parts',
    async ({ firstSize, finalSize, expectedParts }) => {
      findOne.mockResolvedValue(
        draft({
          multipart_upload_id: 'upload-existing',
          declared_size_bytes: 5_242_880 + 1024,
          declared_content_type: 'video/mp4',
        }),
      );
      storage.listParts.mockResolvedValue([
        { partNumber: 1, size: firstSize, eTag: '"first"' },
        { partNumber: 2, size: finalSize, eTag: '"final"' },
      ]);
      storage.listUploadedPartNumbers.mockResolvedValue([1, 2]);

      const opened = await service.openUpload('user-id', 'video-id', {
        sizeBytes: 5_242_880 + 1024,
        contentType: 'video/mp4',
      });

      expect(opened.statusCode).toBe(200);
      expect(opened.body.parts.map((part) => part.partNumber)).toEqual(
        expectedParts,
      );
      expect(storage.signPart).toHaveBeenCalledTimes(expectedParts.length);
      expect(storage.listParts).toHaveBeenCalledTimes(1);
      expect(storage.listUploadedPartNumbers).not.toHaveBeenCalled();
      expect(storage.createMultipart).not.toHaveBeenCalled();
      expect(storage.abortMultipart).not.toHaveBeenCalled();
    },
  );

  it('aborts a resume whose accepted parts already exceed 10GB', async () => {
    const video = draft({
      multipart_upload_id: 'upload-existing',
      declared_size_bytes: 10_000_000_000,
      declared_content_type: 'video/mp4',
    });
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([
      { partNumber: 2, size: 10_000_000_001, eTag: '"oversized"' },
    ]);

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 10_000_000_000,
        contentType: 'video/mp4',
      }),
    ).rejects.toBeInstanceOf(VideoFileTooLargeException);

    expect(storage.abortMultipart).toHaveBeenCalledWith(
      'originals/video-id',
      'upload-existing',
    );
    expect(video.multipart_upload_id).toBeNull();
    expect(video.declared_size_bytes).toBeNull();
    expect(video.declared_content_type).toBeNull();
    expect(storage.signPart).not.toHaveBeenCalled();
  });

  it('restarts a stale multipart after an abort was not committed in the database', async () => {
    const video = draft({
      multipart_upload_id: 'upload-aborted',
      declared_size_bytes: 10_000_000_000,
      declared_content_type: 'video/mp4',
    });
    findOne.mockResolvedValue(video);
    storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());

    const result = await service.openUpload('user-id', 'video-id', {
      sizeBytes: 2048,
      contentType: 'video/webm',
    });

    expect(result.statusCode).toBe(201);
    expect(result.body.sizeBytes).toBe(2048);
    expect(result.body.parts.map((part) => part.partNumber)).toEqual([1]);
    expect(video.multipart_upload_id).toBe('upload-1');
    expect(video.declared_content_type).toBe('video/webm');
    expect(storage.createMultipart).toHaveBeenCalledWith(
      'originals/video-id',
      'video/webm',
    );
  });

  it('does not start a replacement upload over an unassociated completed original', async () => {
    findOne.mockResolvedValue(
      draft({
        multipart_upload_id: 'upload-completed',
        declared_size_bytes: 1024,
      }),
    );
    storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());
    storage.headObject.mockResolvedValue({ sizeBytes: 1024 });

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 2048,
        contentType: 'video/webm',
      }),
    ).rejects.toBeInstanceOf(VideoFileAlreadyStoredException);

    expect(storage.createMultipart).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('does not replace a stale upload when inspecting its original fails', async () => {
    findOne.mockResolvedValue(
      draft({
        multipart_upload_id: 'upload-missing',
        declared_size_bytes: 1024,
      }),
    );
    storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());
    const failure = new Error('Object inspection is forbidden');
    storage.headObject.mockRejectedValue(failure);

    await expect(
      service.openUpload('user-id', 'video-id', {
        sizeBytes: 2048,
        contentType: 'video/webm',
      }),
    ).rejects.toBe(failure);

    expect(storage.createMultipart).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});
