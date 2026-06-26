import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as crypto from 'crypto';

import { Video, VideoStatus } from './entities/video.entity';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { InitUploadDto } from './dto/init-upload.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import {
  ChannelNotFoundException,
  ForbiddenVideoAccessException,
  VideoNotFoundException,
  VideoNotReadyException,
} from '../common/exceptions/domain.exception';

// Gerador de slugs curto, único e seguro contra URL e CommonJS
export function generateSlug(length = 11): string {
  const chars =
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storageService: StorageService,
    @InjectQueue('video-processing')
    private readonly videoQueue: Queue,
  ) {}

  private async verifyChannelOwner(
    userId: string,
    videoChannelId: string,
  ): Promise<void> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel || channel.id !== videoChannelId) {
      throw new ForbiddenVideoAccessException();
    }
  }

  async initiateVideoUpload(
    userId: string,
    dto: InitUploadDto,
  ): Promise<{ videoId: string; uploadId: string; key: string; slug: string }> {
    const channel = await this.channelRepository.findOneBy({ user_id: userId });
    if (!channel) {
      throw new ChannelNotFoundException();
    }

    const slug = generateSlug();
    const key = `uploads/${slug}/video.mp4`;

    const video = this.videoRepository.create({
      slug,
      title: dto.title,
      channel_id: channel.id,
      status: VideoStatus.DRAFT,
      original_key: key,
    });

    const uploadId = await this.storageService.initiateMultipartUpload(
      key,
      'video/mp4',
    );
    const savedVideo = await this.videoRepository.save(video);

    return {
      videoId: savedVideo.id,
      uploadId,
      key,
      slug,
    };
  }

  async generatePresignedParts(
    userId: string,
    dto: PresignPartsDto,
  ): Promise<{ parts: Array<{ partNumber: number; url: string }> }> {
    const video = await this.videoRepository.findOneBy({ id: dto.videoId });
    if (!video) {
      throw new VideoNotFoundException();
    }

    await this.verifyChannelOwner(userId, video.channel_id);

    const parts: { partNumber: number; url: string }[] = [];
    for (const partNumber of dto.partNumbers) {
      const url = await this.storageService.generatePresignedUploadPartUrl(
        dto.key,
        dto.uploadId,
        partNumber,
      );
      parts.push({ partNumber, url });
    }

    return { parts };
  }

  async completeVideoUpload(
    userId: string,
    dto: CompleteUploadDto,
  ): Promise<{ videoId: string; status: VideoStatus }> {
    const video = await this.videoRepository.findOneBy({ id: dto.videoId });
    if (!video) {
      throw new VideoNotFoundException();
    }

    await this.verifyChannelOwner(userId, video.channel_id);

    await this.storageService.completeMultipartUpload(
      dto.key,
      dto.uploadId,
      dto.parts,
    );

    video.status = VideoStatus.PROCESSING;
    const updatedVideo = await this.videoRepository.save(video);

    await this.videoQueue.add('process', {
      videoId: video.id,
      videoKey: dto.key,
    });

    return {
      videoId: updatedVideo.id,
      status: updatedVideo.status,
    };
  }

  async getVideoBySlug(slug: string, userId?: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { slug },
      relations: ['channel'],
    });

    if (!video) {
      throw new VideoNotFoundException();
    }

    if (video.status !== VideoStatus.READY) {
      if (!userId) {
        throw new VideoNotReadyException();
      }
      const channel = await this.channelRepository.findOneBy({
        user_id: userId,
      });
      if (!channel || video.channel_id !== channel.id) {
        throw new VideoNotReadyException();
      }
    }

    return video;
  }

  async getStreamUrl(slug: string): Promise<string> {
    const video = await this.videoRepository.findOneBy({ slug });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    if (!video.original_key) {
      throw new Error(`Video ${slug} has no original key`);
    }
    return this.storageService.generatePresignedGetUrl(
      video.original_key,
      3600,
    );
  }

  async getDownloadUrl(slug: string): Promise<string> {
    const video = await this.videoRepository.findOneBy({ slug });
    if (!video) {
      throw new VideoNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }
    if (!video.original_key) {
      throw new Error(`Video ${slug} has no original key`);
    }
    return this.storageService.generatePresignedGetUrl(
      video.original_key,
      3600,
      `${video.title}.mp4`,
    );
  }
}
