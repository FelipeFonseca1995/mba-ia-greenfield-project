---
kind: phase
name: phase-03-videos
sources_mtime:
  docs/project-plan.md: "2026-04-08T14:58:57-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-06-26T10:10:00-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-05-12T12:23:19-03:00"
  docs/phases/phase-02-auth/phase-02-auth.md: "2026-04-08T14:58:57-03:00"
---

# phase-03-videos — Context

## Scope

**Phase name:** Fase 03 — Upload e Processamento de Vídeos

**Capabilities**

- Serviço de armazenamento de arquivos (object storage) em container local (MinIO) compatível com S3.
- Serviço de processamento em segundo plano (BullMQ + Redis).
- Upload de vídeos com suporte a arquivos de até 10GB via URLs pré-assinadas multipart upload sem trafegar pela API.
- Pré-cadastro automático do vídeo como rascunho (`DRAFT`) ao iniciar o processo de upload.
- Processamento automático do vídeo pós-upload em container/worker separado para extrair duração e metadados via `ffprobe`.
- Geração automática de thumbnail a partir de um frame do vídeo usando `ffmpeg` no worker.
- URL pública curta e única para identificação do vídeo (slug amigável).
- Reprodução via streaming com suporte a HTTP Range Requests através de redirecionamento para URLs pré-assinadas temporárias do S3.
- Download do vídeo pelo usuário através de URL de download direto pré-assinada.

**Out of scope:**
- Telas de upload e player de vídeo no Next.js (Diferido/Deferred para fase posterior).
- Gerenciamento de metadados estendidos do vídeo (título editável, categoria, visibilidade pública/unlisted) e painel de gerenciamento (Fase 04).
- Comentários, likes, inscrições em canais (Fase 06).

**Deliverables:**
- Módulo `Videos` implementado no NestJS.
- Endpoint de inicialização, geração de assinaturas de multipart upload e finalização de upload.
- Endpoint para streaming e download de vídeos.
- Worker de processamento (FFmpeg) em container separado configurado no `compose.yaml`.
- Fila (BullMQ) e cache/mensageria (Redis) configurados no `compose.yaml`.
- Migration do banco de dados criando a tabela de `videos`.
- Cobertura completa de testes unitários, integração e e2e para as novas funcionalidades.

**Affected subprojects:** `nestjs-project/`

**Deferred subprojects:** `next-frontend/` — A interface de usuário para fazer upload de vídeos e assistir com o player fica diferida para uma fase futura.

**Sequencing notes:** Depende de Fase 01 (Configuração Base) e Fase 02 (Cadastro, Login e Canais).

**Neighbors (for boundary detection only):** Fase 02 (prior), Fase 04 — Gerenciamento de Vídeos e Canal (next).

## Decisions Index

| Ref | Source | Scope | Topic | Status | Decision | Libraries |
|-----|--------|-------|-------|--------|----------|-----------|
| phase-03-videos/TD-01 | technical-decisions-phase-03-videos.md | Cross-layer | Upload Strategy for 10GB Files | decided | B (S3 Presigned Multipart Upload) | `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` |
| phase-03-videos/TD-02 | technical-decisions-phase-03-videos.md | Infrastructure | Message Queue Broker | decided | B (BullMQ + Redis) | `bullmq@^8.x`, `ioredis@^5.x`, `@nestjs/bullmq@^11.x` |
| phase-03-videos/TD-03 | technical-decisions-phase-03-videos.md | Infrastructure | Worker Run Architecture | decided | B (Separate Container/Process) | — |
| phase-03-videos/TD-04 | technical-decisions-phase-03-videos.md | Backend (Worker)| Video Processing Library | decided | B (fluent-ffmpeg + native FFmpeg) | `fluent-ffmpeg@^2.x`, `@types/fluent-ffmpeg` |
| phase-03-videos/TD-05 | technical-decisions-phase-03-videos.md | Backend | Unique Video ID Strategy | decided | C (Short unique slug string) | `nanoid@^3.x` |
| phase-03-videos/TD-06 | technical-decisions-phase-03-videos.md | Cross-layer | Streaming & Playback Delivery | decided | B (Redirect to short-lived S3 Presigned GET URLs) | — |
| phase-03-videos/TD-07 | technical-decisions-phase-03-videos.md | Backend | Video Status Lifecycle | decided | Enum status + metadata column | — |

## Capability Coverage

| Capability | Covered by |
|------------|------------|
| Serviço de armazenamento de arquivos (vídeos e thumbnails) | phase-03-videos/TD-01 |
| Serviço de processamento em segundo plano (filas) | phase-03-videos/TD-02 |
| Upload de vídeos de até 10GB sem travar o sistema | phase-03-videos/TD-01 |
| Pré-cadastro automático do vídeo como rascunho | phase-03-videos/TD-07 |
| Processamento automático do vídeo pós-upload (duração/metadados) | phase-03-videos/TD-03, phase-03-videos/TD-04 |
| Geração automática de thumbnail | phase-03-videos/TD-04 |
| URL única por vídeo, sem conflito com outros | phase-03-videos/TD-05 |
| Reprodução via streaming | phase-03-videos/TD-06 |
| Download do vídeo pelo usuário | phase-03-videos/TD-06 |

## Decisions Detail

### phase-03-videos/TD-01 (Upload Strategy)
- **Recommendation:** Option B (S3 Presigned Multipart Upload). The NestJS API only generates S3 presigned URLs. The client directly uploads file chunks to MinIO/S3 and completes it, minimizing API CPU/RAM/socket exhaustion.
- **Libraries:** `@aws-sdk/client-s3@^3.x`, `@aws-sdk/s3-request-presigner@^3.x`

### phase-03-videos/TD-02 (Queue Technology)
- **Recommendation:** Option B (BullMQ + Redis). Highly performant, natively supported by NestJS, allows progress reporting, retries, and failure tracking.
- **Libraries:** `bullmq@^8.x`, `ioredis@^5.x`, `@nestjs/bullmq@^11.x`

### phase-03-videos/TD-03 (Worker Architecture)
- **Recommendation:** Option B (Separate Container). Worker runs the same backend codebase configured in worker mode (consuming jobs without exposing a REST server), protecting the API from FFmpeg CPU exhaustion.

### phase-03-videos/TD-04 (FFmpeg Tooling)
- **Recommendation:** Option B (fluent-ffmpeg with OS-level FFmpeg/ffprobe binaries). Clean Node.js callback API for processing, resolution and duration extraction, and thumbnail frame capture.
- **Libraries:** `fluent-ffmpeg@^2.x`, `@types/fluent-ffmpeg`

### phase-03-videos/TD-05 (Unique Video URL)
- **Recommendation:** Option C (Short ID Slug). Generate an unguessable 10-12 character URL-safe slug (like YouTube `dQw4w9WgXcQ`) instead of sequentials or long UUIDs.
- **Libraries:** `nanoid@^3.x` (or custom generator using Node's `crypto` module if compatibility issues arise)

### phase-03-videos/TD-06 (Streaming Strategy)
- **Recommendation:** Option B (Redirect to short-lived S3 Presigned GET URLs). Enables Range Requests (206) direct from MinIO/S3 to browser, bypassing NestJS memory proxy bottleneck.

### phase-03-videos/TD-07 (Video Status Lifecycle)
- **Recommendation:** DB ENUM status (`DRAFT` -> `PROCESSING` -> `READY` / `ERROR`) to represent state machine, with a `metadata` jsonb field containing duration, resolution, codecs, and processing logs.

## Inherited Decisions Detail
- **phase-02-auth/TD-07 (Error Response Standardization):** We inherit the custom domain exceptions filter to handle video validation and upload errors uniformly.
- **phase-02-auth/TD-02 (Auth Guard):** All video creation, upload initialization, and complete endpoints require authentication using the existing `JwtAuthGuard`.

## Inherited Conventions
- TypeORM Migrations must define schema modifications explicitly.
- The repository pattern is used: `TypeOrmModule.forFeature([Video])` will inject the database entity.
- Controllers use strict REST structure, DTO validation via class-validator, and mapping schemas.

## Testing Requirements
- Unit tests (`*.spec.ts`) mock all database, S3, and queue interactions.
- Integration tests (`*.integration-spec.ts`) use real database connections and MinIO (mocked or running in compose) if feasible.
- E2E tests (`*.e2e-spec.ts`) bootstrap the full application to test upload coordination, streaming redirects, and metadata responses.
