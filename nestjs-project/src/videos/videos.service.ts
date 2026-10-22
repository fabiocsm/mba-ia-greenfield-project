import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import type { FindOptionsWhere } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { OpenUploadDto } from './dto/open-upload.dto';
import { OpenUploadResponseDto } from './dto/open-upload-response.dto';
import { VideoDetailResponseDto } from './dto/video-detail-response.dto';
import { VideoDraftResponseDto } from './dto/video-draft-response.dto';
import { nullIfBlank, Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { VideoProcessingQueue } from './video-processing.queue';
import { SIGNED_URL_TTL_SECONDS, VideoStorage } from './video-storage';
import {
  ChannelNotFoundException,
  VideoChannelForbiddenException,
  VideoFileAlreadyStoredException,
  VideoFileEmptyException,
  VideoFileNotVideoException,
  VideoFileTooLargeException,
  VideoFileNotStoredException,
  VideoNotFoundException,
  VideoNotReadyException,
  VideoProcessingNotScheduledException,
  VideoUploadIncompleteException,
  VideoUploadNotStartedException,
} from './video.exceptions';

const MULTIPART_PART_BYTES = 5_242_880;
const MAX_VIDEO_BYTES = 10_000_000_000;

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_URL_COLUMN = 'public_url';
const MAX_URL_RETRIES = 5;

function isUniquePublicUrlViolation(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err as QueryFailedError & {
    code?: string;
    detail?: string;
  };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    typeof driverError.detail === 'string' &&
    driverError.detail.includes(PUBLIC_URL_COLUMN)
  );
}

function toDraft(video: Video): VideoDraftResponseDto {
  return {
    id: video.id,
    channelId: video.channel_id,
    status: video.status,
    url: `/videos/by-url/${video.public_url}`,
    title: video.title,
    description: video.description,
  };
}

export function declaredContentType(contentType: string): string {
  return contentType.split(';')[0].trim();
}

export function partSizeBytesFor(sizeBytes: number): number {
  return sizeBytes <= MULTIPART_PART_BYTES ? sizeBytes : MULTIPART_PART_BYTES;
}

function partCountFor(sizeBytes: number): number {
  return Math.ceil(sizeBytes / partSizeBytesFor(sizeBytes));
}

function originalObjectKey(videoId: string): string {
  return `originals/${videoId}`;
}

function storedByteCount(parts: { size: number }[]): number {
  return parts.reduce((sum, part) => sum + part.size, 0);
}

function assertUploadRequest(dto: OpenUploadDto): string {
  if (dto.sizeBytes === 0) {
    throw new VideoFileEmptyException();
  }
  if (dto.sizeBytes > MAX_VIDEO_BYTES) {
    throw new VideoFileTooLargeException();
  }
  const contentType = declaredContentType(dto.contentType);
  if (!contentType.toLowerCase().startsWith('video/')) {
    throw new VideoFileNotVideoException();
  }
  return contentType;
}

function toDetail(video: Video): VideoDetailResponseDto {
  const ready = video.status === 'ready';
  const stored = video.original_storage_key != null;
  return {
    ...toDraft(video),
    file: {
      associated: stored,
      sizeBytes: stored ? video.declared_size_bytes : null,
      uploadInProgress: video.multipart_upload_id != null,
    },
    durationSeconds: ready ? video.duration_seconds : null,
    technicalMetadata: ready ? video.technical_metadata : null,
    thumbnailStored: ready && video.thumbnail_storage_key != null,
  };
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videos: Repository<Video>,
    private readonly channelsService: ChannelsService,
    private readonly publicUrls: PublicUrlAllocator,
    private readonly storage: VideoStorage,
    private readonly processing: VideoProcessingQueue,
  ) {}

  async create(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<VideoDraftResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }
    if (dto.channelId !== undefined && dto.channelId !== channel.id) {
      throw new VideoChannelForbiddenException();
    }

    for (let attempt = 0; attempt < MAX_URL_RETRIES; attempt++) {
      try {
        const saved = await this.videos.save(
          this.videos.create({
            channel_id: channel.id,
            public_url: this.publicUrls.allocate(),
            title: nullIfBlank(dto.title),
            description: nullIfBlank(dto.description),
            status: 'draft',
          }),
        );
        return toDraft(saved);
      } catch (err) {
        if (!isUniquePublicUrlViolation(err)) {
          throw err;
        }
      }
    }

    throw new Error('Public URL conflict could not be resolved after retries');
  }

  async findOwn(
    userId: string,
    videoId: string,
  ): Promise<VideoDetailResponseDto> {
    return this.findOwnBy(userId, { id: videoId });
  }

  async findOwnByUrl(
    userId: string,
    token: string,
  ): Promise<VideoDetailResponseDto> {
    return this.findOwnBy(userId, { public_url: token });
  }

  private async findOwnBy(
    userId: string,
    identifier: FindOptionsWhere<Video>,
  ): Promise<VideoDetailResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const video = await this.videos.findOne({
      where: { ...identifier, channel_id: channel.id },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }

    return toDetail(video);
  }

  async openUpload(
    userId: string,
    videoId: string,
    dto: OpenUploadDto,
  ): Promise<{ statusCode: 200 | 201; body: OpenUploadResponseDto }> {
    const contentType = assertUploadRequest(dto);
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const opened = await this.videos.manager.transaction(async (manager) => {
      const repo = manager.getRepository(Video);
      const video = await repo.findOne({
        where: { id: videoId, channel_id: channel.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) {
        throw new VideoNotFoundException();
      }
      if (video.original_storage_key) {
        throw new VideoFileAlreadyStoredException();
      }

      const key = originalObjectKey(video.id);
      const created = video.multipart_upload_id == null;
      if (created) {
        video.multipart_upload_id = await this.storage.createMultipart(
          key,
          contentType,
        );
        video.declared_size_bytes = dto.sizeBytes;
        video.declared_content_type = contentType;
        await repo.save(video);
      }

      const sizeBytes = video.declared_size_bytes ?? dto.sizeBytes;
      const uploadId = video.multipart_upload_id;
      if (uploadId == null) {
        throw new Error('Multipart upload id was not stored');
      }

      const storedParts = await this.storage.listParts(key, uploadId);
      if (storedByteCount(storedParts) > MAX_VIDEO_BYTES) {
        await this.clearOversizedUpload(repo, video, key, uploadId);
        return { tooLarge: true as const };
      }

      const statusCode: 200 | 201 = created ? 201 : 200;
      return {
        tooLarge: false as const,
        statusCode,
        body: {
          videoId: video.id,
          partSizeBytes: partSizeBytesFor(sizeBytes),
          sizeBytes,
          parts: await this.missingParts(key, uploadId, sizeBytes),
        },
      };
    });

    if (opened.tooLarge) {
      throw new VideoFileTooLargeException();
    }

    return { statusCode: opened.statusCode, body: opened.body };
  }

  private async clearOversizedUpload(
    repo: Repository<Video>,
    video: Video,
    key: string,
    uploadId: string,
  ): Promise<void> {
    await this.storage.abortMultipart(key, uploadId);
    video.multipart_upload_id = null;
    video.declared_size_bytes = null;
    video.declared_content_type = null;
    await repo.save(video);
  }

  private async missingParts(
    key: string,
    uploadId: string,
    sizeBytes: number,
  ): Promise<OpenUploadResponseDto['parts']> {
    const uploaded = new Set(
      await this.storage.listUploadedPartNumbers(key, uploadId),
    );
    const missing: number[] = [];
    for (
      let partNumber = 1;
      partNumber <= partCountFor(sizeBytes);
      partNumber++
    ) {
      if (!uploaded.has(partNumber)) {
        missing.push(partNumber);
      }
    }

    return Promise.all(
      missing.map(async (partNumber) => ({
        partNumber,
        url: await this.storage.signPart(key, uploadId, partNumber),
      })),
    );
  }

  async completeUpload(
    userId: string,
    videoId: string,
  ): Promise<VideoDetailResponseDto> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }

    const finished = await this.videos.manager.transaction<{
      video: Video;
      schedule: boolean;
      tooLarge: boolean;
    }>(async (manager) => {
      const repo = manager.getRepository(Video);
      const video = await repo.findOne({
        where: { id: videoId, channel_id: channel.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!video) {
        throw new VideoNotFoundException();
      }
      if (video.original_storage_key) {
        return { video, schedule: video.status === 'draft', tooLarge: false };
      }
      if (!video.multipart_upload_id) {
        throw new VideoUploadNotStartedException();
      }

      const key = originalObjectKey(video.id);
      const uploadId = video.multipart_upload_id;
      const parts = await this.storage.listParts(key, uploadId);
      const sizeBytes = video.declared_size_bytes;
      if (sizeBytes == null) {
        throw new VideoUploadIncompleteException();
      }
      const uploaded = new Set(parts.map((part) => part.partNumber));
      const uploadedBytes = storedByteCount(parts);
      if (uploadedBytes > MAX_VIDEO_BYTES) {
        await this.clearOversizedUpload(repo, video, key, uploadId);
        return { video, schedule: false, tooLarge: true };
      }

      for (
        let partNumber = 1;
        partNumber <= partCountFor(sizeBytes);
        partNumber++
      ) {
        if (!uploaded.has(partNumber)) {
          throw new VideoUploadIncompleteException();
        }
      }
      if (uploadedBytes !== sizeBytes) {
        throw new VideoUploadIncompleteException();
      }

      await this.storage.completeMultipart(
        key,
        uploadId,
        parts.filter((part) => part.partNumber <= partCountFor(sizeBytes)),
      );
      video.original_storage_key = key;
      video.multipart_upload_id = null;
      await repo.save(video);
      return { video, schedule: true, tooLarge: false };
    });

    if (finished.tooLarge) {
      throw new VideoFileTooLargeException();
    }

    if (finished.schedule) {
      try {
        await this.processing.enqueue(finished.video.id);
      } catch {
        throw new VideoProcessingNotScheduledException();
      }
    }

    return toDetail(finished.video);
  }

  playback(userId: string, videoId: string) {
    return this.signOriginal(userId, videoId, false);
  }

  download(userId: string, videoId: string) {
    return this.signOriginal(userId, videoId, true);
  }

  private async signOriginal(
    userId: string,
    videoId: string,
    attachment: boolean,
  ): Promise<{ fileUrl: string; expiresInSeconds: number }> {
    const channel = await this.channelsService.findByUserId(userId);
    if (!channel) {
      throw new VideoNotFoundException();
    }
    const video = await this.videos.findOne({
      where: { id: videoId, channel_id: channel.id },
    });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== 'ready') {
      throw new VideoNotReadyException();
    }
    if (!video.original_storage_key) {
      throw new VideoFileNotStoredException();
    }

    return {
      fileUrl: await this.storage.signGet(
        video.original_storage_key,
        attachment,
      ),
      expiresInSeconds: SIGNED_URL_TTL_SECONDS,
    };
  }
}
