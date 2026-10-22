import { createWriteStream } from 'fs';
import { readFile } from 'fs/promises';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  type ListPartsCommandOutput,
  NoSuchUpload,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import {
  SIGNED_URL_TTL_SECONDS,
  MultipartUploadNotFoundError,
  StoredPart,
  VideoStorage,
} from './video-storage';

export class S3VideoStorage extends VideoStorage {
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigType<typeof storageConfig>) {
    super();
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      endpoint: `http://${config.endpoint}:${config.port}`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKey,
        secretAccessKey: config.secretKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    // Sign the client-visible host itself: changing a signed URL's host later
    // invalidates its signature. Server-to-server calls retain Docker DNS.
    this.signingClient = config.publicEndpoint
      ? new S3Client({
          region: config.region,
          endpoint: config.publicEndpoint,
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.accessKey,
            secretAccessKey: config.secretKey,
          },
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
        })
      : this.client;
  }

  async headObject(key: string): Promise<{ sizeBytes: number } | null> {
    try {
      const object = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (object.ContentLength == null) {
        throw new Error('Object storage did not return the object length');
      }
      return { sizeBytes: object.ContentLength };
    } catch (error) {
      if (
        error instanceof S3ServiceException &&
        error.$metadata.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async createMultipart(key: string, contentType: string): Promise<string> {
    const created = await this.client.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    if (!created.UploadId) {
      throw new Error('Object storage did not return a multipart upload id');
    }
    return created.UploadId;
  }

  async listParts(key: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let partNumberMarker: string | undefined;

    do {
      let page: ListPartsCommandOutput;
      try {
        page = await this.client.send(
          new ListPartsCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumberMarker: partNumberMarker,
          }),
        );
      } catch (error) {
        if (error instanceof NoSuchUpload) {
          throw new MultipartUploadNotFoundError(
            'Multipart upload is missing',
            {
              cause: error,
            },
          );
        }
        throw error;
      }
      for (const part of page.Parts ?? []) {
        if (part.PartNumber == null || !part.ETag) {
          continue;
        }
        parts.push({
          partNumber: part.PartNumber,
          size: part.Size ?? 0,
          eTag: part.ETag,
        });
      }
      partNumberMarker = page.IsTruncated
        ? page.NextPartNumberMarker
        : undefined;
    } while (partNumberMarker);

    parts.sort((left, right) => left.partNumber - right.partNumber);
    return parts;
  }

  async listUploadedPartNumbers(
    key: string,
    uploadId: string,
  ): Promise<number[]> {
    const parts = await this.listParts(key, uploadId);
    return parts.map((part) => part.partNumber);
  }

  async signPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new UploadPartCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  async signGet(key: string, attachment: boolean): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(attachment ? { ResponseContentDisposition: 'attachment' } : {}),
      }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  }

  async completeMultipart(
    key: string,
    uploadId: string,
    parts: StoredPart[],
  ): Promise<void> {
    const ordered = [...parts].sort(
      (left, right) => left.partNumber - right.partNumber,
    );
    await this.client.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: ordered.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.eTag,
          })),
        },
      }),
    );
  }

  async abortMultipart(key: string, uploadId: string): Promise<void> {
    await this.client.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async downloadToFile(key: string, filePath: string): Promise<void> {
    const object = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!object.Body) {
      throw new Error('Object storage returned an empty body');
    }
    await pipeline(object.Body as Readable, createWriteStream(filePath));
  }

  async putFile(
    key: string,
    filePath: string,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: await readFile(filePath),
        ContentType: contentType,
      }),
    );
  }
}
