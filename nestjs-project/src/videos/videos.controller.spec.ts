import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { HttpStatus } from '@nestjs/common';

import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { JwtPayload } from '../auth/auth.types';
import { VideoStatus } from './entities/video.entity';

describe('VideosController (unit)', () => {
  let controller: VideosController;
  let service: jest.Mocked<VideosService>;
  let jwtService: jest.Mocked<JwtService>;

  beforeEach(async () => {
    const mockVideosService = {
      initiateVideoUpload: jest.fn(),
      generatePresignedParts: jest.fn(),
      completeVideoUpload: jest.fn(),
      getVideoBySlug: jest.fn(),
      getStreamUrl: jest.fn(),
      getDownloadUrl: jest.fn(),
    };

    const mockJwtService = {
      verifyAsync: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideosController],
      providers: [
        { provide: VideosService, useValue: mockVideosService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    controller = module.get<VideosController>(VideosController);
    service = module.get(VideosService);
    jwtService = module.get(JwtService);
  });

  describe('initUpload', () => {
    it('should call service.initiateVideoUpload with user sub and dto', async () => {
      const user: JwtPayload = { sub: 'user-1', email: 'user@example.com' };
      const dto: InitUploadDto = { title: 'Gameplay' };
      const expectedResult = {
        videoId: 'video-1',
        uploadId: 'up-1',
        key: 'key-1',
        slug: 'slug123',
      };
      service.initiateVideoUpload.mockResolvedValue(expectedResult);

      const result = await controller.initUpload(user, dto);

      expect(service.initiateVideoUpload).toHaveBeenCalledWith('user-1', dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('presignParts', () => {
    it('should call service.generatePresignedParts with user sub and dto', async () => {
      const user: JwtPayload = { sub: 'user-1', email: 'user@example.com' };
      const dto: PresignPartsDto = {
        videoId: 'video-1',
        uploadId: 'up-1',
        key: 'key-1',
        partNumbers: [1, 2],
      };
      const expectedResult = { parts: [{ partNumber: 1, url: 'url-1' }] };
      service.generatePresignedParts.mockResolvedValue(expectedResult);

      const result = await controller.presignParts(user, dto);

      expect(service.generatePresignedParts).toHaveBeenCalledWith(
        'user-1',
        dto,
      );
      expect(result).toBe(expectedResult);
    });
  });

  describe('completeUpload', () => {
    it('should call service.completeVideoUpload with user sub and dto', async () => {
      const user: JwtPayload = { sub: 'user-1', email: 'user@example.com' };
      const dto: CompleteUploadDto = {
        videoId: 'video-1',
        uploadId: 'up-1',
        key: 'key-1',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      };
      const expectedResult = {
        videoId: 'video-1',
        status: VideoStatus.PROCESSING,
      };
      service.completeVideoUpload.mockResolvedValue(expectedResult);

      const result = await controller.completeUpload(user, dto);

      expect(service.completeVideoUpload).toHaveBeenCalledWith('user-1', dto);
      expect(result).toBe(expectedResult);
    });
  });

  describe('getVideo', () => {
    it('should call service.getVideoBySlug with undefined userId when no auth token provided', async () => {
      const videoDetail: any = { slug: 'slug123', title: 'Video Title' };
      service.getVideoBySlug.mockResolvedValue(videoDetail);

      const result = await controller.getVideo('slug123');

      expect(service.getVideoBySlug).toHaveBeenCalledWith('slug123', undefined);
      expect(result).toBe(videoDetail);
    });

    it('should decode bearer token and call service.getVideoBySlug with userId when token is valid', async () => {
      const authHeader = 'Bearer valid-jwt-token';
      const userPayload = { sub: 'user-1', email: 'user@example.com' };
      jwtService.verifyAsync.mockResolvedValue(userPayload);

      const videoDetail: any = { slug: 'slug123', title: 'Video Title' };
      service.getVideoBySlug.mockResolvedValue(videoDetail);

      const result = await controller.getVideo('slug123', authHeader);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-jwt-token');
      expect(service.getVideoBySlug).toHaveBeenCalledWith('slug123', 'user-1');
      expect(result).toBe(videoDetail);
    });

    it('should call service.getVideoBySlug with undefined userId when token is invalid', async () => {
      const authHeader = 'Bearer invalid-token';
      jwtService.verifyAsync.mockRejectedValue(new Error('Invalid token'));

      const videoDetail: any = { slug: 'slug123', title: 'Video Title' };
      service.getVideoBySlug.mockResolvedValue(videoDetail);

      const result = await controller.getVideo('slug123', authHeader);

      expect(jwtService.verifyAsync).toHaveBeenCalledWith('invalid-token');
      expect(service.getVideoBySlug).toHaveBeenCalledWith('slug123', undefined);
      expect(result).toBe(videoDetail);
    });
  });

  describe('streamVideo', () => {
    it('should redirect to the streaming URL provided by the service', async () => {
      const res = {
        redirect: jest.fn(),
      } as unknown as Response;

      service.getStreamUrl.mockResolvedValue('https://storage/video-stream');

      await controller.streamVideo('slug123', res);

      expect(service.getStreamUrl).toHaveBeenCalledWith('slug123');
      expect(res.redirect).toHaveBeenCalledWith(
        HttpStatus.FOUND,
        'https://storage/video-stream',
      );
    });
  });

  describe('downloadVideo', () => {
    it('should redirect to the download URL provided by the service', async () => {
      const res = {
        redirect: jest.fn(),
      } as unknown as Response;

      service.getDownloadUrl.mockResolvedValue(
        'https://storage/video-download',
      );

      await controller.downloadVideo('slug123', res);

      expect(service.getDownloadUrl).toHaveBeenCalledWith('slug123');
      expect(res.redirect).toHaveBeenCalledWith(
        HttpStatus.FOUND,
        'https://storage/video-download',
      );
    });
  });
});
