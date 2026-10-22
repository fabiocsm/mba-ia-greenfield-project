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
import { Video, VideoStatus } from '../src/videos/entities/video.entity';

describe('videos-playback', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let throttlerStorage: ThrottlerStorageService;
  let sequence = 0;

  beforeAll(async () => {
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

  async function registerOwner(): Promise<string> {
    const email = `playback_owner_${++sequence}@example.com`;
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

  function playback(accessToken: string, videoId: string) {
    return request(app.getHttpServer())
      .get(`/videos/${videoId}/playback`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  function download(accessToken: string, videoId: string) {
    return request(app.getHttpServer())
      .get(`/videos/${videoId}/download`)
      .set('Authorization', `Bearer ${accessToken}`);
  }

  async function mark(
    videoId: string,
    status: VideoStatus,
    key: string | null,
  ): Promise<void> {
    await videoRepository.update(videoId, {
      status,
      original_storage_key: key,
    });
  }

  // 1. GET /videos/:id/playback
  test('get-playback-ready', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await mark(videoId, 'ready', `originals/${videoId}`);

    const res = await playback(accessToken, videoId).expect(200);

    expect(Object.keys(httpBody(res)).sort()).toEqual([
      'expiresInSeconds',
      'fileUrl',
    ]);
    expect(httpBody(res).expiresInSeconds).toBe(900);
    expect(httpBody(res).fileUrl).toEqual(expect.any(String));
    expect(httpBody(res).fileUrl).toContain(`originals/${videoId}`);
    expect(httpBody(res).fileUrl).not.toContain('response-content-disposition');
  });

  test('get-playback-nao-ready', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const key = `originals/${videoId}`;

    for (const status of ['draft', 'processing', 'error'] as const) {
      await mark(videoId, status, key);
      const before = await videoRepository.findOneByOrFail({ id: videoId });
      const res = await playback(accessToken, videoId).expect(409);
      const after = await videoRepository.findOneByOrFail({ id: videoId });

      expect(httpBody(res).error).toBe('VIDEO_NOT_READY');
      expect(after.status).toBe(before.status);
      expect(after.original_storage_key).toBe(before.original_storage_key);
    }
  });

  test('get-playback-ready-sem-chave', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await mark(videoId, 'ready', null);

    const res = await playback(accessToken, videoId).expect(409);

    expect(httpBody(res).error).toBe('VIDEO_FILE_NOT_STORED');
  });

  test('get-playback-inexistente-ou-de-outro-canal', async () => {
    const ownerA = await registerOwner();
    const ownerB = await registerOwner();
    const foreignId = await createDraft(ownerB);
    await mark(foreignId, 'ready', `originals/${foreignId}`);

    const missing = await playback(
      ownerA,
      '00000000-0000-0000-0000-000000000000',
    ).expect(404);
    expect(httpBody(missing).error).toBe('VIDEO_NOT_FOUND');

    const foreign = await playback(ownerA, foreignId).expect(404);
    expect(httpBody(foreign).error).toBe('VIDEO_NOT_FOUND');
  });

  test('get-playback-file-url-nao-e-a-url-publica', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await mark(videoId, 'ready', `originals/${videoId}`);
    const detail = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const res = await playback(accessToken, videoId).expect(200);

    expect(httpBody(res).fileUrl).not.toBe(httpBody(detail).url);
    expect(httpBody(res).fileUrl).not.toContain('thumbnails/');
  });

  // 2. GET /videos/:id/download
  test('get-download-ready', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await mark(videoId, 'ready', `originals/${videoId}`);
    const playbackRes = await playback(accessToken, videoId).expect(200);

    const res = await download(accessToken, videoId).expect(200);

    expect(httpBody(res).expiresInSeconds).toBe(900);
    expect(httpBody(res).fileUrl).toContain(`originals/${videoId}`);
    expect(httpBody(res).fileUrl).toContain('response-content-disposition');
    expect(decodeURIComponent(httpBody(res).fileUrl)).toContain('attachment');
    expect(httpBody(res).fileUrl).not.toBe(httpBody(playbackRes).fileUrl);
  });

  test('get-download-nao-ready', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    const key = `originals/${videoId}`;

    for (const status of ['draft', 'processing', 'error'] as const) {
      await mark(videoId, status, key);
      const before = await videoRepository.findOneByOrFail({ id: videoId });
      const res = await download(accessToken, videoId).expect(409);
      const after = await videoRepository.findOneByOrFail({ id: videoId });

      expect(httpBody(res).error).toBe('VIDEO_NOT_READY');
      expect(after.status).toBe(before.status);
      expect(after.original_storage_key).toBe(before.original_storage_key);
    }
  });

  test('get-download-ready-sem-chave', async () => {
    const accessToken = await registerOwner();
    const videoId = await createDraft(accessToken);
    await mark(videoId, 'ready', null);

    const res = await download(accessToken, videoId).expect(409);

    expect(httpBody(res).error).toBe('VIDEO_FILE_NOT_STORED');
  });

  test('get-download-inexistente-ou-de-outro-canal', async () => {
    const ownerA = await registerOwner();
    const ownerB = await registerOwner();
    const foreignId = await createDraft(ownerB);
    await mark(foreignId, 'ready', `originals/${foreignId}`);

    const missing = await download(
      ownerA,
      '00000000-0000-0000-0000-000000000000',
    ).expect(404);
    expect(httpBody(missing).error).toBe('VIDEO_NOT_FOUND');

    const foreign = await download(ownerA, foreignId).expect(404);
    expect(httpBody(foreign).error).toBe('VIDEO_NOT_FOUND');
  });
});
