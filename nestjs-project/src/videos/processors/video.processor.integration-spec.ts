/* eslint-disable @typescript-eslint/no-require-imports, no-empty */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Job } from 'bullmq';
import * as fs from 'fs';

import { VideoProcessor } from './video.processor';
import { Video, VideoStatus } from '../entities/video.entity';
import { Channel } from '../../channels/entities/channel.entity';
import { User } from '../../users/entities/user.entity';
import { StorageService } from '../../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';

// Mock fluent-ffmpeg package
jest.mock('fluent-ffmpeg', () => {
  const mockState = {
    folder: '',
    filename: '',
  };

  const mockFfmpeg = jest.fn(() => ({
    screenshots: jest.fn().mockImplementation(function (options: {
      folder: string;
      filename: string;
    }) {
      mockState.folder = options.folder || '';
      mockState.filename = options.filename || '';
      return this;
    }),
    on: jest.fn().mockImplementation(function (
      event: string,
      callback: () => void,
    ) {
      if (event === 'end') {
        const fullPath = require('path').join(
          mockState.folder,
          mockState.filename,
        );
        try {
          require('fs').writeFileSync(fullPath, 'fake-thumb-bytes');
        } catch {}
        setTimeout(() => {
          callback();
        }, 50);
      }
      return this;
    }),
  }));

  (mockFfmpeg as any).ffprobe = jest.fn((filePath, callback) => {
    callback(null, {
      format: { duration: 180 },
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080 },
      ],
    });
  });

  return mockFfmpeg;
});

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideoProcessor (integration)', () => {
  let dataSource: DataSource;
  let processor: VideoProcessor;
  let videoRepository: Repository<Video>;
  let channelRepository: Repository<Channel>;
  let userRepository: Repository<User>;
  let storageService: jest.Mocked<StorageService>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);
    channelRepository = dataSource.getRepository(Channel);
    userRepository = dataSource.getRepository(User);

    const mockStorageService = {
      downloadToLocal: jest.fn().mockResolvedValue(undefined),
      uploadBuffer: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessor,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    processor = module.get(VideoProcessor);
    storageService = module.get(StorageService);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    jest.clearAllMocks();
  });

  const createChannelAndVideo = async (slug: string): Promise<Video> => {
    const user = userRepository.create({
      email: `${slug}@example.com`,
      password: 'hashedpassword',
    });
    const savedUser = await userRepository.save(user);

    const channel = channelRepository.create({
      name: 'Test Channel',
      nickname: `nick_${slug}`,
      user_id: savedUser.id,
    });
    const savedChannel = await channelRepository.save(channel);

    const video = videoRepository.create({
      slug,
      title: 'Processor Test Video',
      channel_id: savedChannel.id,
      status: VideoStatus.DRAFT,
      original_key: `uploads/${slug}/video.mp4`,
    });
    return videoRepository.save(video);
  };

  it('should process video, extract metadata, upload thumbnail, and update status to READY', async () => {
    const video = await createChannelAndVideo('slugsuccess');

    // Mock S3 buffer upload to do nothing
    storageService.uploadBuffer.mockResolvedValue(undefined);

    const job = {
      data: {
        videoId: video.id,
        videoKey: video.original_key,
      },
    } as Job;

    await processor.process(job);

    // Verify S3 calls
    expect(storageService.downloadToLocal).toHaveBeenCalledWith(
      video.original_key,
      expect.stringContaining(`video-${video.id}.mp4`),
    );
    expect(storageService.uploadBuffer).toHaveBeenCalledWith(
      `thumbnails/${video.slug}/thumb.jpg`,
      expect.any(Buffer),
      'image/jpeg',
    );

    // Verify DB update
    const updated = await videoRepository.findOneBy({ id: video.id });
    expect(updated).toBeDefined();
    expect(updated?.status).toBe(VideoStatus.READY);
    expect(updated?.duration).toBe(180);
    expect(updated?.width).toBe(1920);
    expect(updated?.height).toBe(1080);
    expect(updated?.codec).toBe('h264');
    expect(updated?.thumbnail_key).toBe(`thumbnails/${video.slug}/thumb.jpg`);
    expect(updated?.error_message).toBeNull();
  });

  it('should transition status to ERROR and save error message if processing fails', async () => {
    const video = await createChannelAndVideo('slugfailure');

    // Simular falha de download
    storageService.downloadToLocal.mockRejectedValue(
      new Error('S3 Download Failed'),
    );

    const job = {
      data: {
        videoId: video.id,
        videoKey: video.original_key,
      },
    } as Job;

    await expect(processor.process(job)).rejects.toThrow('S3 Download Failed');

    // Verify DB update
    const updated = await videoRepository.findOneBy({ id: video.id });
    expect(updated).toBeDefined();
    expect(updated?.status).toBe(VideoStatus.ERROR);
    expect(updated?.error_message).toBe('S3 Download Failed');
  });
});
