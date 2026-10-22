import { readFile } from 'fs/promises';
import { join } from 'path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { confirmationMailer, httpBody } from './http-body';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoProcessingQueue } from '../src/videos/video-processing.queue';
import { VideoStorage } from '../src/videos/video-storage';

describe('videos-upload-complete', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let sequence = 0;
  let sampleVideo: Buffer;

  beforeAll(async () => {
    sampleVideo = await readFile(join(__dirname, 'fixtures/tiny.mp4'));
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    videoRepository = dataSource.getRepository(Video);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    const storage = app.get(VideoStorage);
    const rows = await videoRepository.find();
    for (const row of rows) {
      if (!row.multipart_upload_id) {
        continue;
      }
      await storage
        .abortMultipart(`originals/${row.id}`, row.multipart_upload_id)
        .catch(() => undefined);
    }
  });

  async function registerOwner(): Promise<string> {
    const email = `complete_owner_${++sequence}@example.com`;
    const authService = app.get(AuthService);
    const mailServiceInstance = confirmationMailer(authService);
    let capturedToken = '';
    jest
      .spyOn(mailServiceInstance, 'sendConfirmationEmail')
      .mockImplementationOnce(
        (_email: string, _name: string, token: string) => {
          capturedToken = token;
          return Promise.resolve();
        },
      );

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/auth/confirm-email')
      .query({ token: capturedToken })
      .expect(204);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    return httpBody(login).access_token;
  }

  async function createDraft(accessToken: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    return httpBody(created).id;
  }

  async function openUpload(
    accessToken: string,
    videoId: string,
    sizeBytes: number,
  ) {
    return request(app.getHttpServer())
      .post(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sizeBytes, contentType: 'video/mp4' })
      .expect(201);
  }

  async function putPart(url: string, body: Buffer): Promise<void> {
    const uploaded = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(body),
    });
    expect(uploaded.ok).toBe(true);
  }

  function complete(accessToken: string, videoId: string) {
    return request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  async function waitForStatus(
    accessToken: string,
    videoId: string,
    status: string,
  ) {
    const deadline = Date.now() + 30_000;
    let last: request.Response | undefined;
    while (Date.now() < deadline) {
      last = await request(app.getHttpServer())
        .get(`/videos/${videoId}`)
        .set('Authorization', `Bearer ${accessToken}`);
      if (httpBody(last).status === status) {
        return last;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `video stayed ${last ? httpBody(last).status : 'unknown'} instead of ${status}`,
    );
  }

  // 1. POST /videos/:id/upload/complete
  test('post-complete-associa-e-segue-draft', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);

    const res = await complete(accessToken, videoId).expect(200);

    expect(httpBody(res).status).toBe('draft');
    expect(httpBody(res).file.associated).toBe(true);
    expect(httpBody(res).durationSeconds).toBeNull();
    expect(httpBody(res).technicalMetadata).toBeNull();
    expect(httpBody(res).thumbnailStored).toBe(false);
  });

  test('post-complete-partes-faltando', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await openUpload(accessToken, videoId, 2048);

    const res = await complete(accessToken, videoId).expect(409);

    expect(httpBody(res).error).toBe('VIDEO_UPLOAD_INCOMPLETE');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.original_storage_key).toBeNull();
  });

  test('post-complete-soma-acima-do-limite', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await openUpload(accessToken, videoId, 1024);
    const storage = app.get(VideoStorage);
    jest
      .spyOn(storage, 'listParts')
      .mockResolvedValueOnce([
        { partNumber: 1, size: 10_000_000_001, eTag: '"big"' },
      ]);

    const res = await complete(accessToken, videoId).expect(422);

    expect(httpBody(res).error).toBe('VIDEO_FILE_TOO_LARGE');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.original_storage_key).toBeNull();
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-complete-sem-envio', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);

    const res = await complete(accessToken, videoId).expect(409);

    expect(httpBody(res).error).toBe('VIDEO_UPLOAD_NOT_STARTED');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.original_storage_key).toBeNull();
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-complete-redis-recusa-o-job', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    jest
      .spyOn(app.get(VideoProcessingQueue), 'enqueue')
      .mockRejectedValueOnce(new Error('redis refused'));

    const res = await complete(accessToken, videoId).expect(503);

    expect(httpBody(res).error).toBe('VIDEO_PROCESSING_NOT_SCHEDULED');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.original_storage_key).toBe(`originals/${videoId}`);
    expect(row.status).toBe('draft');
  });

  test('post-complete-retoma-original-apos-resposta-perdida-do-storage', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    const storage = app.get(VideoStorage);
    const completeMultipart = storage.completeMultipart.bind(
      storage,
    ) as VideoStorage['completeMultipart'];
    jest
      .spyOn(storage, 'completeMultipart')
      .mockImplementationOnce(async (...args) => {
        await completeMultipart(...args);
        throw new Error(
          'Storage completed the upload but its response was lost',
        );
      });

    await complete(accessToken, videoId).expect(500);
    const rolledBack = await videoRepository.findOneByOrFail({ id: videoId });
    expect(rolledBack.original_storage_key).toBeNull();
    expect(rolledBack.multipart_upload_id).toEqual(expect.any(String));
    await expect(storage.headObject(`originals/${videoId}`)).resolves.toEqual({
      sizeBytes: sampleVideo.length,
    });

    // A new upload must not replace the completed original while DB state lags.
    const reopen = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ sizeBytes: sampleVideo.length, contentType: 'video/mp4' })
      .expect(409);
    expect(httpBody(reopen).error).toBe('VIDEO_FILE_ALREADY_STORED');

    const retried = await complete(accessToken, videoId).expect(200);
    expect(httpBody(retried).file.associated).toBe(true);
    await waitForStatus(accessToken, videoId, 'ready');
    const ready = await videoRepository.findOneByOrFail({ id: videoId });
    expect(ready.original_storage_key).toBe(`originals/${videoId}`);
    expect(ready.multipart_upload_id).toBeNull();
    const original = await fetch(
      await storage.signGet(`originals/${videoId}`, false),
    );
    expect(Buffer.from(await original.arrayBuffer())).toEqual(sampleVideo);
  });

  test('post-upload-reabre-multipart-abortado-apos-rollback', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    const original = await videoRepository.findOneByOrFail({ id: videoId });
    const storage = app.get(VideoStorage);
    jest
      .spyOn(storage, 'listParts')
      .mockResolvedValueOnce([
        { partNumber: 1, size: 10_000_000_001, eTag: '"oversized"' },
      ]);
    const abortMultipart = storage.abortMultipart.bind(
      storage,
    ) as VideoStorage['abortMultipart'];
    jest
      .spyOn(storage, 'abortMultipart')
      .mockImplementationOnce(async (...args) => {
        await abortMultipart(...args);
        throw new Error('Storage aborted the upload but its response was lost');
      });

    await complete(accessToken, videoId).expect(500);
    const rolledBack = await videoRepository.findOneByOrFail({ id: videoId });
    expect(rolledBack.multipart_upload_id).toBe(original.multipart_upload_id);
    expect(rolledBack.original_storage_key).toBeNull();
    await expect(
      storage.headObject(`originals/${videoId}`),
    ).resolves.toBeNull();

    const reopened = await openUpload(accessToken, videoId, sampleVideo.length);
    const replaced = await videoRepository.findOneByOrFail({ id: videoId });
    expect(replaced.multipart_upload_id).not.toBe(original.multipart_upload_id);
    await putPart(httpBody(reopened).parts[0].url, sampleVideo);
    await complete(accessToken, videoId).expect(200);
    await waitForStatus(accessToken, videoId, 'ready');
  });

  test('post-complete-redis-inacessivel-retorna-503-e-permite-retomar', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    const unavailable = new VideoProcessingQueue({ host: 'redis', port: 1 });
    const enqueue = jest
      .spyOn(app.get(VideoProcessingQueue), 'enqueue')
      .mockImplementation((id: string) => unavailable.enqueue(id));
    try {
      const started = Date.now();
      const res = await complete(accessToken, videoId).expect(503);
      expect(Date.now() - started).toBeLessThan(6500);
      expect(httpBody(res).error).toBe('VIDEO_PROCESSING_NOT_SCHEDULED');
    } finally {
      enqueue.mockRestore();
      await unavailable.onModuleDestroy();
    }

    // The uploaded original remains and a real, healthy queue can accept it.
    await complete(accessToken, videoId).expect(200);
    await waitForStatus(accessToken, videoId, 'ready');
  }, 20_000);

  // 2. GET /videos/:id
  test('get-videos-id-depois-do-worker-ready', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    await complete(accessToken, videoId).expect(200);

    const res = await waitForStatus(accessToken, videoId, 'ready');

    expect(res.status).toBe(200);
    expect(httpBody(res).durationSeconds).toEqual(expect.any(Number));
    expect(httpBody(res).technicalMetadata).toEqual(expect.any(Object));
    expect(httpBody(res).thumbnailStored).toBe(true);
    expect(httpBody(res).file.associated).toBe(true);
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    const thumbnail = await fetch(
      await app.get(VideoStorage).signGet(row.thumbnail_storage_key!, false),
    );
    expect(thumbnail.status).toBe(200);
    expect(thumbnail.headers.get('content-type')).toBe('image/jpeg');
    const bytes = Buffer.from(await thumbnail.arrayBuffer());
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
  });

  test('get-videos-id-depois-do-worker-error', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const body = Buffer.from('this is not a video');
    const opened = await openUpload(accessToken, videoId, body.length);
    await putPart(httpBody(opened).parts[0].url, body);
    await complete(accessToken, videoId).expect(200);

    const res = await waitForStatus(accessToken, videoId, 'error');

    expect(res.status).toBe(200);
    expect(httpBody(res).thumbnailStored).toBe(false);
    expect(httpBody(res).file.associated).toBe(true);
  });

  test('post-complete-segundo-job-nao-muda-o-desfecho', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const opened = await openUpload(accessToken, videoId, sampleVideo.length);
    await putPart(httpBody(opened).parts[0].url, sampleVideo);
    await complete(accessToken, videoId).expect(200);
    await waitForStatus(accessToken, videoId, 'ready');

    const enqueue = jest.spyOn(app.get(VideoProcessingQueue), 'enqueue');
    await complete(accessToken, videoId).expect(200);
    const res = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(httpBody(res).status).toBe('ready');
    expect(enqueue).not.toHaveBeenCalled();
  });
});
