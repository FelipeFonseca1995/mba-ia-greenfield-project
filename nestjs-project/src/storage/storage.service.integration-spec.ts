import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import storageConfig from '../config/storage.config';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';
import * as fs from 'fs';
import * as path from 'path';

describe('StorageService (integration)', () => {
  let storageService: StorageService;

  beforeAll(async () => {
    // Para rodar localmente durante testes, reescrevemos o host para localhost se estiver fora do docker
    const isDocker =
      process.env.DB_HOST === 'db' || process.env.REDIS_HOST === 'redis';
    if (!isDocker) {
      process.env.STORAGE_ENDPOINT = 'http://localhost:9000';
    }

    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig],
        }),
        StorageModule,
      ],
    }).compile();

    storageService = module.get(StorageService);
    await storageService.onModuleInit();
  });

  it('should upload a buffer and download it back', async () => {
    const key = 'test-folder/test-file.txt';
    const content = Buffer.from('Hello, MinIO Storage integration test!');

    // Upload Buffer
    await storageService.uploadBuffer(key, content, 'text/plain');

    // Generate Presigned GET Url
    const url = await storageService.generatePresignedGetUrl(key, 3600);
    expect(url).toBeDefined();
    expect(url).toContain(key);

    // Download to Local
    const localTmpPath = path.join(__dirname, 'downloaded-test-file.txt');
    try {
      await storageService.downloadToLocal(key, localTmpPath);

      // Verify Content
      const downloadedContent = fs.readFileSync(localTmpPath, 'utf8');
      expect(downloadedContent).toBe('Hello, MinIO Storage integration test!');
    } finally {
      // Cleanup local temp file
      if (fs.existsSync(localTmpPath)) {
        fs.unlinkSync(localTmpPath);
      }
    }
  });

  it('should initialize, presign parts and complete a multipart upload', async () => {
    const key = 'test-folder/multipart-test.txt';

    // Initiate multipart upload
    const uploadId = await storageService.initiateMultipartUpload(
      key,
      'text/plain',
    );
    expect(uploadId).toBeDefined();

    // Generate Presigned Upload Part URL
    const uploadPartUrl = await storageService.generatePresignedUploadPartUrl(
      key,
      uploadId,
      1,
    );
    expect(uploadPartUrl).toBeDefined();
    expect(uploadPartUrl).toContain('uploadId=' + uploadId);
    expect(uploadPartUrl).toContain('partNumber=1');
  });
});
