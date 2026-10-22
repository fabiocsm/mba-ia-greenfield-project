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
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video } from '../src/videos/entities/video.entity';
import { VideoStorage } from '../src/videos/video-storage';

const PART_BYTES = 5_242_880;

describe('videos-upload', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let channelRepository: Repository<Channel>;
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
    channelRepository = dataSource.getRepository(Channel);
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

  async function registerOwner(email: string): Promise<{
    accessToken: string;
    channelId: string;
  }> {
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

    const registered = await request(app.getHttpServer())
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

    const channel = await channelRepository.findOneByOrFail({
      user_id: httpBody(registered).id,
    });

    return {
      accessToken: httpBody(login).access_token,
      channelId: channel.id,
    };
  }

  function nextEmail(): string {
    sequence += 1;
    return `upload_owner_${sequence}@example.com`;
  }

  async function createDraft(accessToken: string): Promise<string> {
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);
    return httpBody(created).id;
  }

  function upload(accessToken: string, videoId: string, body: object) {
    return request(app.getHttpServer())
      .post(`/videos/${videoId}/upload`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body);
  }

  // 1. POST /videos/:id/upload
  test('post-upload-abre-multipart', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);

    const res = await upload(owner.accessToken, videoId, {
      sizeBytes: 1024,
      contentType: 'video/mp4; codecs=avc1',
    }).expect(201);

    expect(Object.keys(httpBody(res)).sort()).toEqual([
      'partSizeBytes',
      'parts',
      'sizeBytes',
      'videoId',
    ]);
    expect(httpBody(res).videoId).toBe(videoId);
    expect(httpBody(res).partSizeBytes).toBe(1024);
    expect(httpBody(res).sizeBytes).toBe(1024);
    const parts = httpBody(res).parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].partNumber).toBe(1);
    expect(parts[0].url.length).toBeGreaterThan(0);

    const detail = await request(app.getHttpServer())
      .get(`/videos/${videoId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(httpBody(detail).file).toEqual({
      associated: false,
      sizeBytes: null,
      uploadInProgress: true,
    });
  });

  test('post-upload-retoma-partes-faltantes', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);
    const opened = await upload(owner.accessToken, videoId, {
      sizeBytes: PART_BYTES + 1,
      contentType: 'video/mp4',
    }).expect(201);

    expect(
      httpBody(opened).parts.map(
        (part: { partNumber: number }) => part.partNumber,
      ),
    ).toEqual([1, 2]);

    const put = await fetch(httpBody(opened).parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(PART_BYTES).fill(1),
    });
    expect(put.ok).toBe(true);

    const resumed = await upload(owner.accessToken, videoId, {
      sizeBytes: PART_BYTES + 1,
      contentType: 'video/mp4',
    }).expect(200);

    expect(httpBody(resumed).parts).toHaveLength(1);
    expect(httpBody(resumed).parts[0].partNumber).toBe(2);
    expect(httpBody(resumed).parts[0].url).toEqual(expect.any(String));
  });

  test('post-upload-retoma-parte-incompleta-e-permite-concluir', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);
    const video = await readFile(join(__dirname, 'fixtures/tiny.mp4'));
    const body = { sizeBytes: video.length, contentType: 'video/mp4' };
    const opened = await upload(owner.accessToken, videoId, body).expect(201);
    const originalUpload = await videoRepository.findOneByOrFail({
      id: videoId,
    });

    const shortPart = await fetch(httpBody(opened).parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(video.subarray(0, Math.floor(video.length / 2))),
    });
    expect(shortPart.ok).toBe(true);

    const incomplete = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(409);
    expect(httpBody(incomplete).error).toBe('VIDEO_UPLOAD_INCOMPLETE');

    // Use only the resumed response, as a client renewing an expired URL does.
    const resumed = await upload(owner.accessToken, videoId, body).expect(200);
    expect(httpBody(resumed).parts).toHaveLength(1);
    expect(httpBody(resumed).parts[0].partNumber).toBe(1);
    const repaired = await fetch(httpBody(resumed).parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(video),
    });
    expect(repaired.ok).toBe(true);
    const resumedRow = await videoRepository.findOneByOrFail({ id: videoId });
    expect(resumedRow.multipart_upload_id).toBe(
      originalUpload.multipart_upload_id,
    );

    const completed = await request(app.getHttpServer())
      .post(`/videos/${videoId}/upload/complete`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    expect(httpBody(completed).file.associated).toBe(true);
    expect(httpBody(completed).file.sizeBytes).toBe(video.length);
    const stored = await fetch(
      await app.get(VideoStorage).signGet(`originals/${videoId}`, false),
    );
    expect(stored.status).toBe(200);
    expect(Buffer.from(await stored.arrayBuffer())).toEqual(video);
  });

  test('post-upload-arquivo-vazio', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);

    const res = await upload(owner.accessToken, videoId, {
      sizeBytes: 0,
      contentType: 'video/mp4',
    }).expect(422);

    expect(httpBody(res).error).toBe('VIDEO_FILE_EMPTY');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-upload-acima-de-10gb', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);

    const res = await upload(owner.accessToken, videoId, {
      sizeBytes: 10_000_000_001,
      contentType: 'video/mp4',
    }).expect(422);

    expect(httpBody(res).error).toBe('VIDEO_FILE_TOO_LARGE');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-upload-tipo-nao-video', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);

    const res = await upload(owner.accessToken, videoId, {
      sizeBytes: 1024,
      contentType: ' text/plain ; charset=utf-8',
    }).expect(422);

    expect(httpBody(res).error).toBe('VIDEO_FILE_NOT_VIDEO');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-upload-arquivo-ja-associado', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);
    await videoRepository.update(videoId, {
      original_storage_key: `originals/${videoId}`,
    });

    const res = await upload(owner.accessToken, videoId, {
      sizeBytes: 1024,
      contentType: 'video/mp4',
    }).expect(409);

    expect(httpBody(res).error).toBe('VIDEO_FILE_ALREADY_STORED');
    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.multipart_upload_id).toBeNull();
  });

  test('post-upload-simultaneo-um-multipart', async () => {
    const owner = await registerOwner(nextEmail());
    const videoId = await createDraft(owner.accessToken);
    const body = { sizeBytes: 2048, contentType: 'video/mp4' };

    const [first, second] = await Promise.all([
      upload(owner.accessToken, videoId, body),
      upload(owner.accessToken, videoId, body),
    ]);

    const statuses = [first.status, second.status];
    expect(statuses.every((status) => status === 200 || status === 201)).toBe(
      true,
    );
    expect(
      statuses.filter((status) => status === 201).length,
    ).toBeLessThanOrEqual(1);

    const row = await videoRepository.findOneByOrFail({ id: videoId });
    expect(row.multipart_upload_id).toEqual(expect.any(String));
    expect(row.original_storage_key).toBeNull();
  });
});
