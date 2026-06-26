import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { VideosService, generateSlug } from './videos.service';
import { Video, VideoStatus } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import {
  ChannelNotFoundException,
  ForbiddenVideoAccessException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';

describe('VideosService (unit)', () => {
  let service: VideosService;
  let videoRepository: jest.Mocked<Repository<Video>>;
  let channelRepository: jest.Mocked<Repository<Channel>>;
  let storageService: jest.Mocked<StorageService>;
  let videoQueue: any;

  beforeEach(async () => {
    const mockVideoRepository = {
      create: jest.fn(),
      save: jest.fn(),
      findOneBy: jest.fn(),
      findOne: jest.fn(),
    };

    const mockChannelRepository = {
      findOneBy: jest.fn(),
    };

    const mockStorageService = {
      initiateMultipartUpload: jest.fn(),
      generatePresignedUploadPartUrl: jest.fn(),
      completeMultipartUpload: jest.fn(),
      generatePresignedGetUrl: jest.fn(),
    };

    const mockVideoQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VideosService,
        {
          provide: getRepositoryToken(Video),
          useValue: mockVideoRepository,
        },
        {
          provide: getRepositoryToken(Channel),
          useValue: mockChannelRepository,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: 'BullQueue_video-processing',
          useValue: mockVideoQueue,
        },
      ],
    }).compile();

    service = module.get<VideosService>(VideosService);
    videoRepository = module.get(getRepositoryToken(Video));
    channelRepository = module.get(getRepositoryToken(Channel));
    storageService = module.get(StorageService);
    videoQueue = module.get('BullQueue_video-processing');
  });

  describe('generateSlug', () => {
    it('should generate a string of the requested length', () => {
      const slug = generateSlug(11);
      expect(slug).toHaveLength(11);
      expect(typeof slug).toBe('string');
    });

    it('should only use safe URL characters', () => {
      const slug = generateSlug(100);
      expect(slug).toMatch(/^[0-9A-Za-z]+$/);
    });
  });

  describe('initiateVideoUpload', () => {
    it('should throw ChannelNotFoundException if user has no channel', async () => {
      channelRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.initiateVideoUpload('user-1', { title: 'Test Video' }),
      ).rejects.toThrow(ChannelNotFoundException);
    });

    it('should create a draft video and return S3 upload parameters', async () => {
      const channel = { id: 'channel-1', user_id: 'user-1' } as Channel;
      channelRepository.findOneBy.mockResolvedValue(channel);
      storageService.initiateMultipartUpload.mockResolvedValue('s3-upload-id');

      const video = {
        id: 'video-1',
        title: 'Test Video',
        slug: 'slug123',
        status: VideoStatus.DRAFT,
        original_key: 'uploads/slug123/video.mp4',
      } as Video;
      videoRepository.create.mockReturnValue(video);
      videoRepository.save.mockResolvedValue(video);

      const result = await service.initiateVideoUpload('user-1', {
        title: 'Test Video',
      });

      expect(videoRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Test Video',
          channel_id: 'channel-1',
          status: VideoStatus.DRAFT,
        }),
      );
      expect(storageService.initiateMultipartUpload).toHaveBeenCalledWith(
        expect.any(String),
        'video/mp4',
      );
      expect(result).toEqual({
        videoId: 'video-1',
        uploadId: 's3-upload-id',
        key: expect.any(String),
        slug: expect.any(String),
      });
    });
  });

  describe('generatePresignedParts', () => {
    it('should throw VideoNotFoundException if video does not exist', async () => {
      videoRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.generatePresignedParts('user-1', {
          videoId: 'video-1',
          uploadId: 'up-1',
          key: 'key-1',
          partNumbers: [1],
        }),
      ).rejects.toThrow(VideoNotFoundException);
    });

    it('should throw ForbiddenVideoAccessException if user does not own the video channel', async () => {
      const video = { id: 'video-1', channel_id: 'channel-owner' } as Video;
      videoRepository.findOneBy.mockResolvedValue(video);

      const otherChannel = {
        id: 'channel-other',
        user_id: 'user-1',
      } as Channel;
      channelRepository.findOneBy.mockResolvedValue(otherChannel);

      await expect(
        service.generatePresignedParts('user-1', {
          videoId: 'video-1',
          uploadId: 'up-1',
          key: 'key-1',
          partNumbers: [1],
        }),
      ).rejects.toThrow(ForbiddenVideoAccessException);
    });

    it('should return presigned URLs for requested parts', async () => {
      const video = { id: 'video-1', channel_id: 'channel-owner' } as Video;
      videoRepository.findOneBy.mockResolvedValue(video);

      const channel = { id: 'channel-owner', user_id: 'user-1' } as Channel;
      channelRepository.findOneBy.mockResolvedValue(channel);

      storageService.generatePresignedUploadPartUrl.mockResolvedValue(
        'http://signed-url-for-part',
      );

      const result = await service.generatePresignedParts('user-1', {
        videoId: 'video-1',
        uploadId: 'up-1',
        key: 'key-1',
        partNumbers: [1, 2],
      });

      expect(
        storageService.generatePresignedUploadPartUrl,
      ).toHaveBeenCalledTimes(2);
      expect(result.parts).toHaveLength(2);
      expect(result.parts[0]).toEqual({
        partNumber: 1,
        url: 'http://signed-url-for-part',
      });
    });
  });

  describe('completeVideoUpload', () => {
    it('should complete S3 upload, set status to PROCESSING, and queue task', async () => {
      const video = {
        id: 'video-1',
        channel_id: 'channel-owner',
        status: VideoStatus.DRAFT,
      } as Video;
      videoRepository.findOneBy.mockResolvedValue(video);

      const channel = { id: 'channel-owner', user_id: 'user-1' } as Channel;
      channelRepository.findOneBy.mockResolvedValue(channel);

      const updatedVideo = {
        ...video,
        status: VideoStatus.PROCESSING,
      } as Video;
      videoRepository.save.mockResolvedValue(updatedVideo);

      const result = await service.completeVideoUpload('user-1', {
        videoId: 'video-1',
        uploadId: 'up-1',
        key: 'key-1',
        parts: [{ partNumber: 1, etag: 'etag-1' }],
      });

      expect(storageService.completeMultipartUpload).toHaveBeenCalledWith(
        'key-1',
        'up-1',
        [{ partNumber: 1, etag: 'etag-1' }],
      );
      expect(videoRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: VideoStatus.PROCESSING }),
      );
      expect(videoQueue.add).toHaveBeenCalledWith('process', {
        videoId: 'video-1',
        videoKey: 'key-1',
      });
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });
  });

  describe('getVideoBySlug', () => {
    it('should throw VideoNotFoundException if video does not exist', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(service.getVideoBySlug('nonexistent')).rejects.toThrow(
        VideoNotFoundException,
      );
    });

    it('should return video details if video status is READY', async () => {
      const video = {
        slug: 'ready-video',
        status: VideoStatus.READY,
        channel_id: 'channel-1',
      } as Video;
      videoRepository.findOne.mockResolvedValue(video);

      const result = await service.getVideoBySlug('ready-video');
      expect(result).toBe(video);
    });

    it('should throw VideoNotReadyException if video not READY and accessed anonymously', async () => {
      const video = {
        slug: 'draft-video',
        status: VideoStatus.DRAFT,
        channel_id: 'channel-1',
      } as Video;
      videoRepository.findOne.mockResolvedValue(video);

      await expect(service.getVideoBySlug('draft-video')).rejects.toThrow(
        VideoNotReadyException,
      );
    });

    it('should allow owner to see video even if not READY', async () => {
      const video = {
        slug: 'draft-video',
        status: VideoStatus.DRAFT,
        channel_id: 'channel-owner',
      } as Video;
      videoRepository.findOne.mockResolvedValue(video);

      const channel = { id: 'channel-owner', user_id: 'user-1' } as Channel;
      channelRepository.findOneBy.mockResolvedValue(channel);

      const result = await service.getVideoBySlug('draft-video', 'user-1');
      expect(result).toBe(video);
    });
  });
});
