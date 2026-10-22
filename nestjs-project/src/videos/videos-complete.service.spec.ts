import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChannelsService } from '../channels/channels.service';
import { Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { VideoProcessingQueue } from './video-processing.queue';
import {
  MultipartUploadNotFoundError,
  StoredPart,
  VideoStorage,
} from './video-storage';
import {
  VideoFileTooLargeException,
  VideoProcessingNotScheduledException,
  VideoUploadIncompleteException,
  VideoUploadNotStartedException,
} from './video.exceptions';
import { VideosService } from './videos.service';

describe('VideosService complete', () => {
  let service: VideosService;
  let storage: {
    listParts: jest.Mock;
    completeMultipart: jest.Mock;
    abortMultipart: jest.Mock;
    headObject: jest.Mock;
  };
  let enqueue: jest.Mock;
  let findOne: jest.Mock;
  let save: jest.Mock;

  beforeEach(async () => {
    findOne = jest.fn();
    save = jest.fn((video: Video) => Promise.resolve(video));
    enqueue = jest.fn().mockResolvedValue(undefined);
    storage = {
      listParts: jest.fn().mockResolvedValue([]),
      completeMultipart: jest.fn().mockResolvedValue(undefined),
      abortMultipart: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn().mockResolvedValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: {
            manager: {
              transaction: async (
                run: (manager: unknown) => Promise<unknown>,
              ) => run({ getRepository: () => ({ findOne, save }) }),
            },
          },
        },
        {
          provide: ChannelsService,
          useValue: {
            findByUserId: jest.fn().mockResolvedValue({ id: 'channel-id' }),
          },
        },
        { provide: PublicUrlAllocator, useValue: { allocate: jest.fn() } },
        { provide: VideoStorage, useValue: storage },
        { provide: VideoProcessingQueue, useValue: { enqueue } },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  function row(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-id',
      channel_id: 'channel-id',
      status: 'draft',
      public_url: 'url-1',
      title: null,
      description: null,
      multipart_upload_id: 'upload-1',
      original_storage_key: null,
      declared_size_bytes: 1024,
      declared_content_type: 'video/mp4',
      duration_seconds: null,
      technical_metadata: null,
      thumbnail_storage_key: null,
      ...overrides,
    } as Video;
  }

  function part(size = 1024): StoredPart {
    return { partNumber: 1, size, eTag: '"part"' };
  }

  it('rejects a complete when a part is missing and keeps the key empty', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([]);

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoUploadIncompleteException);

    expect(video.original_storage_key).toBeNull();
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(storage.abortMultipart).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('aborts the multipart when the uploaded bytes exceed 10GB', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([part(10_000_000_001)]);

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoFileTooLargeException);

    expect(storage.abortMultipart).toHaveBeenCalledWith(
      'originals/video-id',
      'upload-1',
    );
    expect(video.multipart_upload_id).toBeNull();
    expect(video.declared_size_bytes).toBeNull();
    expect(video.declared_content_type).toBeNull();
    expect(video.original_storage_key).toBeNull();
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('aborts when accepted parts already exceed 10GB even if a part number is missing', async () => {
    const video = row({ declared_size_bytes: 10_000_000_000 });
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([
      { partNumber: 2, size: 10_000_000_001, eTag: '"oversized"' },
    ]);

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoFileTooLargeException);

    expect(storage.abortMultipart).toHaveBeenCalledWith(
      'originals/video-id',
      'upload-1',
    );
    expect(video.declared_size_bytes).toBeNull();
    expect(video.declared_content_type).toBeNull();
    expect(video.original_storage_key).toBeNull();
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });

  it('does not complete when the uploaded bytes differ from the declared size', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([part(512)]);

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoUploadIncompleteException);

    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(storage.abortMultipart).not.toHaveBeenCalled();
    expect(video.original_storage_key).toBeNull();
    expect(video.declared_size_bytes).toBe(1024);
  });

  it('associates an already completed original when the database write was lost', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());
    storage.headObject.mockResolvedValue({ sizeBytes: 1024 });

    const result = await service.completeUpload('user-id', 'video-id');

    expect(result.file.associated).toBe(true);
    expect(video.original_storage_key).toBe('originals/video-id');
    expect(video.multipart_upload_id).toBeNull();
    expect(save).toHaveBeenCalledWith(video);
    expect(enqueue).toHaveBeenCalledWith('video-id');
    expect(storage.completeMultipart).not.toHaveBeenCalled();
  });

  it.each([null, { sizeBytes: 512 }])(
    'rejects recovery when the completed original is absent or has a different length (%j)',
    async (stored) => {
      const video = row();
      findOne.mockResolvedValue(video);
      storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());
      storage.headObject.mockResolvedValue(stored);

      await expect(
        service.completeUpload('user-id', 'video-id'),
      ).rejects.toBeInstanceOf(VideoUploadIncompleteException);

      expect(video.original_storage_key).toBeNull();
      expect(video.multipart_upload_id).toBe('upload-1');
      expect(save).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it('propagates an unavailable storage service without claiming completion', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    const failure = new Error('storage unavailable');
    storage.listParts.mockRejectedValue(failure);

    await expect(service.completeUpload('user-id', 'video-id')).rejects.toBe(
      failure,
    );
    expect(storage.headObject).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates failed object inspection instead of treating it as a missing original', async () => {
    findOne.mockResolvedValue(row());
    storage.listParts.mockRejectedValue(new MultipartUploadNotFoundError());
    const failure = new Error('access denied');
    storage.headObject.mockRejectedValue(failure);

    await expect(service.completeUpload('user-id', 'video-id')).rejects.toBe(
      failure,
    );
    expect(save).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps the stored key when the queue refuses the job', async () => {
    const video = row();
    findOne.mockResolvedValue(video);
    storage.listParts.mockResolvedValue([part()]);
    enqueue.mockRejectedValue(new Error('redis refused'));

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoProcessingNotScheduledException);

    expect(video.original_storage_key).toBe('originals/video-id');
    expect(video.multipart_upload_id).toBeNull();
    expect(video.status).toBe('draft');
    expect(storage.completeMultipart).toHaveBeenCalledTimes(1);
  });

  it('does not complete or enqueue again when the file is already stored', async () => {
    const video = row({
      status: 'ready',
      multipart_upload_id: null,
      original_storage_key: 'originals/video-id',
      duration_seconds: 1,
      technical_metadata: { format: {}, streams: [] },
      thumbnail_storage_key: 'thumbnails/video-id',
    });
    findOne.mockResolvedValue(video);

    const result = await service.completeUpload('user-id', 'video-id');

    expect(result.status).toBe('ready');
    expect(result.file.associated).toBe(true);
    expect(storage.completeMultipart).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rejects a draft that has neither a multipart upload nor a file', async () => {
    findOne.mockResolvedValue(
      row({ multipart_upload_id: null, original_storage_key: null }),
    );

    await expect(
      service.completeUpload('user-id', 'video-id'),
    ).rejects.toBeInstanceOf(VideoUploadNotStartedException);

    expect(enqueue).not.toHaveBeenCalled();
  });
});
