import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import storageConfig from '../config/storage.config';
import * as fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;

  constructor(
    @Inject(storageConfig.KEY)
    private readonly cfg: ConfigType<typeof storageConfig>,
  ) {
    this.s3Client = new S3Client({
      region: 'us-east-1',
      endpoint: this.cfg.endpoint,
      credentials: {
        accessKeyId: this.cfg.accessKeyId,
        secretAccessKey: this.cfg.secretAccessKey,
      },
      forcePathStyle: this.cfg.forcePathStyle,
    });
  }

  async onModuleInit() {
    const bucket = this.cfg.bucketVideos;
    try {
      this.logger.log(`Checking if storage bucket "${bucket}" exists...`);
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
      this.logger.log(`Bucket "${bucket}" already exists.`);
    } catch (err: unknown) {
      const error = err as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        error.name === 'NotFound' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        this.logger.warn(`Bucket "${bucket}" not found. Creating it...`);
        try {
          await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
          this.logger.log(`Bucket "${bucket}" created successfully.`);
        } catch (createErr) {
          this.logger.error(`Failed to create bucket "${bucket}":`, createErr);
        }
      } else {
        this.logger.error(`Error checking bucket "${bucket}":`, err);
      }
    }
  }

  async initiateMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const command = new CreateMultipartUploadCommand({
      Bucket: this.cfg.bucketVideos,
      Key: key,
      ContentType: contentType,
    });
    const response = await this.s3Client.send(command);
    if (!response.UploadId) {
      throw new Error(`Failed to initiate multipart upload for ${key}`);
    }
    return response.UploadId;
  }

  async generatePresignedUploadPartUrl(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string> {
    const command = new UploadPartCommand({
      Bucket: this.cfg.bucketVideos,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: this.cfg.bucketVideos,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map((p) => ({
          ETag: p.etag,
          PartNumber: p.partNumber,
        })),
      },
    });
    await this.s3Client.send(command);
  }

  async generatePresignedGetUrl(
    key: string,
    expiresInSeconds = 3600,
    filename?: string,
  ): Promise<string> {
    const params: GetObjectCommandInput = {
      Bucket: this.cfg.bucketVideos,
      Key: key,
    };

    if (filename) {
      params.ResponseContentDisposition = `attachment; filename="${encodeURIComponent(
        filename,
      )}"`;
    }

    const command = new GetObjectCommand(params);
    return getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.bucketVideos,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.s3Client.send(command);
  }

  async downloadToLocal(key: string, localPath: string): Promise<void> {
    const command = new GetObjectCommand({
      Bucket: this.cfg.bucketVideos,
      Key: key,
    });
    const response = await this.s3Client.send(command);
    if (!response.Body) {
      throw new Error(`Failed to download object ${key} from storage`);
    }

    const writeStream = fs.createWriteStream(localPath);
    await pipeline(response.Body as Readable, writeStream);
  }
}
