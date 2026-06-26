import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Logger } from '@nestjs/common';
import ffmpeg from 'fluent-ffmpeg';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { Video, VideoStatus } from '../entities/video.entity';
import { StorageService } from '../../storage/storage.service';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<{ videoId: string; videoKey: string }>): Promise<any> {
    const { videoId, videoKey } = job.data;
    this.logger.log(
      `Starting video processing job for video ${videoId} with key ${videoKey}`,
    );

    const video = await this.videoRepository.findOneBy({ id: videoId });
    if (!video) {
      this.logger.error(`Video ${videoId} not found in database.`);
      return;
    }

    const tempDir = os.tmpdir();
    const tempVideoPath = path.join(tempDir, `video-${videoId}.mp4`);
    const tempThumbFilename = `thumb-${videoId}.jpg`;
    const tempThumbPath = path.join(tempDir, tempThumbFilename);

    try {
      // 1. Baixar o arquivo do S3 para local
      this.logger.log(`Downloading video ${videoId} from storage...`);
      await this.storageService.downloadToLocal(videoKey, tempVideoPath);

      // 2. Extrair metadados via ffprobe
      this.logger.log(`Probing video ${videoId} for metadata...`);
      const metadata = await this.probeVideo(tempVideoPath);

      const duration = Math.round(metadata.format.duration ?? 0);
      const videoStream = metadata.streams.find(
        (s) => s.codec_type === 'video',
      );
      const width = videoStream?.width ?? null;
      const height = videoStream?.height ?? null;
      const codec = videoStream?.codec_name ?? null;

      this.logger.log(
        `Video metadata extracted: ${duration}s, ${width}x${height}, codec: ${codec}`,
      );

      // 3. Gerar thumbnail via ffmpeg (segundo 1)
      this.logger.log(`Generating thumbnail for video ${videoId}...`);
      await this.createThumbnail(tempVideoPath, tempDir, tempThumbFilename);

      // 4. Carregar thumbnail para o S3
      const thumbnailKey = `thumbnails/${video.slug}/thumb.jpg`;
      this.logger.log(`Uploading thumbnail to key ${thumbnailKey}...`);
      const thumbBuffer = fs.readFileSync(tempThumbPath);
      await this.storageService.uploadBuffer(
        thumbnailKey,
        thumbBuffer,
        'image/jpeg',
      );

      // 5. Atualizar o banco de dados
      video.status = VideoStatus.READY;
      video.thumbnail_key = thumbnailKey;
      video.duration = duration;
      video.width = width;
      video.height = height;
      video.codec = codec;
      video.error_message = null;

      await this.videoRepository.save(video);
      this.logger.log(`Video ${videoId} processed successfully.`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(`Failed to process video ${videoId}:`, error);
      video.status = VideoStatus.ERROR;
      video.error_message = error.message || 'Unknown video processing error';
      await this.videoRepository.save(video);
      throw error;
    } finally {
      // Limpar arquivos temporários
      this.cleanupFile(tempVideoPath);
      this.cleanupFile(tempThumbPath);
    }
  }

  private probeVideo(filePath: string): Promise<ffmpeg.FfprobeData> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          return reject(err instanceof Error ? err : new Error(String(err)));
        }
        resolve(metadata);
      });
    });
  }

  private createThumbnail(
    filePath: string,
    folder: string,
    filename: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(filePath)
        .screenshots({
          timestamps: [1],
          filename,
          folder,
          size: '1280x720',
        })
        .on('end', () => resolve())
        .on('error', (err) => reject(err));
    });
  }

  private cleanupFile(filePath: string) {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        this.logger.warn(`Failed to delete temporary file ${filePath}:`, err);
      }
    }
  }
}
