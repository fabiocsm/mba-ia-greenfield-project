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

describe('videos', () => {
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

  async function registerOwner(email: string): Promise<{
    accessToken: string;
    userId: string;
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
      userId: httpBody(registered).id,
      channelId: channel.id,
    };
  }

  function nextEmail(): string {
    sequence += 1;
    return `video_owner_${sequence}@example.com`;
  }

  // 1. POST /videos
  test('post-videos-cria-rascunho', async () => {
    const owner = await registerOwner(nextEmail());

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({})
      .expect(201);

    expect(httpBody(res).id).toEqual(expect.any(String));
    expect(httpBody(res).channelId).toBe(owner.channelId);
    expect(httpBody(res).status).toBe('draft');
    expect(httpBody(res).url).toEqual(expect.any(String));
    expect(httpBody(res).url).not.toBe('');
    expect(await videoRepository.count()).toBe(1);
  });

  test('post-videos-titulo-e-descricao-em-branco', async () => {
    const owner = await registerOwner(nextEmail());

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: '   ', description: '' })
      .expect(201);

    expect(httpBody(res).title).toBeNull();
    expect(httpBody(res).description).toBeNull();

    const row = await videoRepository.findOneByOrFail({ id: httpBody(res).id });
    expect(row.title).toBeNull();
    expect(row.description).toBeNull();
  });

  test('post-videos-channel-id-alheio', async () => {
    const ownerA = await registerOwner(nextEmail());
    const ownerB = await registerOwner(nextEmail());

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .send({ channelId: ownerB.channelId })
      .expect(403);

    expect(httpBody(res).error).toBe('VIDEO_CHANNEL_FORBIDDEN');
    expect(await videoRepository.count()).toBe(0);
  });

  test('post-videos-sem-canal', async () => {
    const owner = await registerOwner(nextEmail());
    await channelRepository.delete({ user_id: owner.userId });

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({})
      .expect(404);

    expect(httpBody(res).error).toBe('CHANNEL_NOT_FOUND');
    expect(await videoRepository.count()).toBe(0);
    expect(await channelRepository.count()).toBe(0);
  });

  test('post-videos-simultaneos', async () => {
    const owner = await registerOwner(nextEmail());

    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({}),
      request(app.getHttpServer())
        .post('/videos')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({}),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(httpBody(first).id).not.toBe(httpBody(second).id);
    expect(httpBody(first).url).not.toBe(httpBody(second).url);
  });

  // 2. GET /videos/:id
  test('get-videos-id-do-dono', async () => {
    const owner = await registerOwner(nextEmail());
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({})
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/videos/${httpBody(created).id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    expect(httpBody(res).id).toBe(httpBody(created).id);
    expect(httpBody(res).channelId).toBe(httpBody(created).channelId);
    expect(httpBody(res).status).toBe(httpBody(created).status);
    expect(httpBody(res).url).toBe(httpBody(created).url);
  });

  test('get-videos-id-inexistente-ou-de-outro-canal', async () => {
    const ownerA = await registerOwner(nextEmail());
    const ownerB = await registerOwner(nextEmail());
    const created = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${ownerB.accessToken}`)
      .send({})
      .expect(201);

    const missing = await request(app.getHttpServer())
      .get('/videos/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(404);
    expect(httpBody(missing).error).toBe('VIDEO_NOT_FOUND');

    const foreign = await request(app.getHttpServer())
      .get(`/videos/${httpBody(created).id}`)
      .set('Authorization', `Bearer ${ownerA.accessToken}`)
      .expect(404);
    expect(httpBody(foreign).error).toBe('VIDEO_NOT_FOUND');
  });
});
