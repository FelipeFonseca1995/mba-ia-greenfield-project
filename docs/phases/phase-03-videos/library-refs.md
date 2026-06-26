---
libs:
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3/s3-request-presigner"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "bullmq":
    version: "^8.x"
    context7_id: "/task-queues/bullmq"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "@nestjs/bullmq":
    version: "^11.x"
    context7_id: "/nestjs/bullmq"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "ioredis":
    version: "^5.x"
    context7_id: "/redis/ioredis"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "fluent-ffmpeg":
    version: "^2.x"
    context7_id: "/media/fluent-ffmpeg"
    fetched_at: "2026-06-26T10:12:00-03:00"
  "nanoid":
    version: "^3.x"
    context7_id: "/security/nanoid"
    fetched_at: "2026-06-26T10:12:00-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-26T10:10:00-03:00"
---

# Library References — phase-03-videos

Esta seção descreve a API de referência das novas bibliotecas necessárias para a implementação do upload e processamento de vídeos.

---

### S3 Client & Request Presigner (@aws-sdk/client-s3)

**Use:** Coordenar o S3/MinIO para Multipart Upload (inicialização, assinatura de URL de partes, conclusão) e URLs temporárias de streaming/download.

**Key API Surface:**

```ts
import { 
  S3Client, 
  CreateMultipartUploadCommand, 
  UploadPartCommand, 
  CompleteMultipartUploadCommand,
  GetObjectCommand 
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({
  region: "us-east-1",
  endpoint: process.env.STORAGE_ENDPOINT, // MinIO
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
  },
  forcePathStyle: true, // Necessário para MinIO local
});

// Inicialização do Multipart Upload
const initCommand = new CreateMultipartUploadCommand({
  Bucket: "streamtube-videos",
  Key: "video-key.mp4",
  ContentType: "video/mp4",
});
const { UploadId } = await s3Client.send(initCommand);

// Geração de URL assinada para envio de parte
const partCommand = new UploadPartCommand({
  Bucket: "streamtube-videos",
  Key: "video-key.mp4",
  UploadId: uploadId,
  PartNumber: partNumber,
});
const presignedUrl = await getSignedUrl(s3Client, partCommand, { expiresIn: 3600 });

// Finalização do Multipart Upload
const completeCommand = new CompleteMultipartUploadCommand({
  Bucket: "streamtube-videos",
  Key: "video-key.mp4",
  UploadId: uploadId,
  MultipartUpload: {
    Parts: parts.map(p => ({ ETag: p.etag, PartNumber: p.partNumber })),
  },
});
await s3Client.send(completeCommand);

// Link de download/stream pré-assinado
const getCommand = new GetObjectCommand({
  Bucket: "streamtube-videos",
  Key: "video-key.mp4",
  ResponseContentDisposition: "attachment; filename=\"video.mp4\"", // Opcional para download
});
const readUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });
```

---

### BullMQ & @nestjs/bullmq

**Use:** Criação e consumo de filas em NestJS para o processamento de vídeos em segundo plano.

**Key API Surface:**

```ts
// videos.module.ts
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'redis',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    BullModule.registerQueue({
      name: 'video-processing',
    }),
  ],
})
export class VideosModule {}

// videos.service.ts (Producer)
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export class VideosService {
  constructor(@InjectQueue('video-processing') private readonly videoQueue: Queue) {}

  async queueVideoProcessing(videoId: string, videoKey: string) {
    await this.videoQueue.add('process', { videoId, videoKey }, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
    });
  }
}

// video-processor.ts (Consumer/Worker)
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  async process(job: Job<any, any, string>): Promise<any> {
    const { videoId, videoKey } = job.data;
    // Lógica do processamento do vídeo
    return { success: true };
  }
}
```

---

### fluent-ffmpeg

**Use:** Wrapper Node.js para chamar comandos do FFmpeg/ffprobe a fim de obter a duração e salvar thumbnails de vídeos locais.

**Key API Surface:**

```ts
import * as ffmpeg from 'fluent-ffmpeg';

// Obter metadados
ffmpeg.ffprobe(localFilePath, (err, metadata) => {
  if (err) throw err;
  const duration = metadata.format.duration;
  const width = metadata.streams[0].width;
  const height = metadata.streams[0].height;
});

// Gerar Thumbnail
ffmpeg(localFilePath)
  .screenshots({
    timestamps: [1], // Segundo 1
    filename: 'thumbnail.jpg',
    folder: '/tmp',
    size: '1280x720',
  })
  .on('end', () => {
    console.log('Thumbnail gerada!');
  })
  .on('error', (err) => {
    console.error('Erro na thumbnail:', err);
  });
```

---

### nanoid

**Use:** Gerar strings de URL curtas, seguras e não previsíveis para os vídeos.

**Key API Surface:**

```ts
import { customAlphabet } from 'nanoid';

// Alfabeto seguro para URLs sem ambiguidade visual
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const generateSlug = customAlphabet(alphabet, 11); // 11 caracteres (idêntico ao YouTube)

const slug = generateSlug(); // Ex: "7Y1zKx9Q3W0"
```
