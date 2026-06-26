import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { ThrottlerStorageService, ThrottlerStorage } from '@nestjs/throttler';
import { Queue } from 'bullmq';

import { AppModule } from '../src/app.module';
import { StorageService } from '../src/storage/storage.service';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import { Channel } from '../src/channels/entities/channel.entity';
import { User } from '../src/users/entities/user.entity';
import { AuthService } from '../src/auth/auth.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;
  let throttlerStorage: ThrottlerStorageService;
  let videoQueue: Queue;

  const mockStorageService = {
    initiateMultipartUpload: jest.fn().mockResolvedValue('fake-upload-id'),
    generatePresignedUploadPartUrl: jest
      .fn()
      .mockResolvedValue('http://fake-s3/upload-part'),
    completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
    generatePresignedGetUrl: jest
      .fn()
      .mockResolvedValue('http://fake-s3/get-object'),
  };

  beforeAll(async () => {
    jest.setTimeout(60000);
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(StorageService)
      .useValue(mockStorageService)
      .compile();

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
    channelRepository = dataSource.getRepository(Channel);
    userRepository = dataSource.getRepository(User);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
    videoQueue = moduleFixture.get<Queue>('BullQueue_video-processing');
    jest.spyOn(videoQueue, 'add').mockResolvedValue(undefined as any);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
    jest.clearAllMocks();
  });

  async function registerAndLogin(
    email: string,
    password = 'password123',
  ): Promise<{ accessToken: string; userId: string; channelId: string }> {
    const authService = app.get(AuthService);

    // Registrar usuário (cria canal automaticamente)
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password })
      .expect(201);

    const userId = registerRes.body.id;

    // Confirmar e-mail manualmente no banco
    const user = await userRepository.findOneBy({ id: userId });
    if (user) {
      user.is_confirmed = true;
      await userRepository.save(user);
    }

    // Logar
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(200);

    const channel = await channelRepository.findOneBy({ user_id: userId });

    return {
      accessToken: loginRes.body.access_token,
      userId,
      channelId: channel?.id || '',
    };
  }

  describe('POST /videos/upload/init', () => {
    it('returns 401 when accessed without authorization', async () => {
      await request(app.getHttpServer())
        .post('/videos/upload/init')
        .send({ title: 'Gameplay' })
        .expect(401);
    });

    it('returns 201 with S3 upload credentials when authenticated', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');

      const res = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Minha Gameplay Incrível' })
        .expect(201);

      expect(res.body.videoId).toBeDefined();
      expect(res.body.uploadId).toBe('fake-upload-id');
      expect(res.body.key).toBeDefined();
      expect(res.body.slug).toBeDefined();

      const video = await videoRepository.findOneBy({ id: res.body.videoId });
      expect(video).toBeDefined();
      expect(video?.status).toBe(VideoStatus.DRAFT);
    });
  });

  describe('POST /videos/upload/presign-parts', () => {
    it('returns 401 when accessed without authorization', async () => {
      await request(app.getHttpServer())
        .post('/videos/upload/presign-parts')
        .send({
          videoId: '1a2b3c4d-5e6f-7g8h-9i0j-1k2l3m4n5o6p',
          uploadId: 'up',
          key: 'key',
          partNumbers: [1],
        })
        .expect(401);
    });

    it("returns 403 when trying to presign parts for another channel's video", async () => {
      const creator1 = await registerAndLogin('creator1@example.com');
      const creator2 = await registerAndLogin('creator2@example.com');

      // Creator 1 cria vídeo
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${creator1.accessToken}`)
        .send({ title: 'Video Creator 1' });

      // Creator 2 tenta assinar partes dele
      await request(app.getHttpServer())
        .post('/videos/upload/presign-parts')
        .set('Authorization', `Bearer ${creator2.accessToken}`)
        .send({
          videoId: initRes.body.videoId,
          uploadId: initRes.body.uploadId,
          key: initRes.body.key,
          partNumbers: [1, 2],
        })
        .expect(403);
    });

    it('returns 200 with presigned urls for owner', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'My Video' });

      const res = await request(app.getHttpServer())
        .post('/videos/upload/presign-parts')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          videoId: initRes.body.videoId,
          uploadId: initRes.body.uploadId,
          key: initRes.body.key,
          partNumbers: [1, 2],
        })
        .expect(200);

      expect(res.body.parts).toHaveLength(2);
      expect(res.body.parts[0]).toEqual({
        partNumber: 1,
        url: 'http://fake-s3/upload-part',
      });
    });
  });

  describe('POST /videos/upload/complete', () => {
    it('returns 200, sets status to PROCESSING and triggers worker', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');

      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Finalizing Video' });

      const res = await request(app.getHttpServer())
        .post('/videos/upload/complete')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          videoId: initRes.body.videoId,
          uploadId: initRes.body.uploadId,
          key: initRes.body.key,
          parts: [{ partNumber: 1, etag: 'etag-1' }],
        })
        .expect(200);

      expect(res.body.status).toBe(VideoStatus.PROCESSING);

      const video = await videoRepository.findOneBy({
        id: initRes.body.videoId,
      });
      expect(video?.status).toBe(VideoStatus.PROCESSING);
      expect(videoQueue.add).toHaveBeenCalledWith('process', {
        videoId: video?.id,
        videoKey: video?.original_key,
      });
    });
  });

  describe('GET /videos/:slug', () => {
    it('returns 400 (VideoNotReadyException) for anonymous users if video is DRAFT', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Draft Video' });

      await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}`)
        .expect(400); // VideoNotReadyException mapped to 400
    });

    it('returns 200 for anonymous users if video is READY', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Ready Video' });

      // Atualizar status para READY manualmente no banco
      const video = await videoRepository.findOneBy({
        id: initRes.body.videoId,
      });
      if (video) {
        video.status = VideoStatus.READY;
        await videoRepository.save(video);
      }

      const res = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}`)
        .expect(200);

      expect(res.body.slug).toBe(initRes.body.slug);
      expect(res.body.title).toBe('Ready Video');
      expect(res.body.status).toBe(VideoStatus.READY);
    });

    it('returns 200 for owner if video is DRAFT', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'My Draft Video' });

      const res = await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.status).toBe(VideoStatus.DRAFT);
    });
  });

  describe('GET /videos/:slug/stream & GET /videos/:slug/download', () => {
    it('stream and download redirect with 302 to storage url if READY', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Streaming Video' });

      // Atualizar status para READY
      const video = await videoRepository.findOneBy({
        id: initRes.body.videoId,
      });
      if (video) {
        video.status = VideoStatus.READY;
        await videoRepository.save(video);
      }

      // Stream Redirect
      await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}/stream`)
        .expect(302)
        .expect('Location', 'http://fake-s3/get-object');

      // Download Redirect
      await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}/download`)
        .expect(302)
        .expect('Location', 'http://fake-s3/get-object');
    });

    it('returns 400 for stream and download if video is not READY', async () => {
      const { accessToken } = await registerAndLogin('creator@example.com');
      const initRes = await request(app.getHttpServer())
        .post('/videos/upload/init')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ title: 'Not Ready Video' });

      await request(app.getHttpServer())
        .get(`/videos/${initRes.body.slug}/stream`)
        .expect(400);
    });
  });
});
