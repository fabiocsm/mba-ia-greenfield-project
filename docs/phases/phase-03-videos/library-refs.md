---
libs:
  "@aws-sdk/client-s3":
    version: "^3.1123.0"
  "@aws-sdk/s3-request-presigner":
    version: "^3.1123.0"
  bullmq:
    version: "^6.4.0"
  ioredis:
    version: "^5.11.1"
sources_mtime:
  nestjs-project/package.json: "2026-10-22T02:09:57-03:00"
---

# Library References — phase-03-videos

Versões já instaladas em `nestjs-project/package.json`. Nenhuma biblioteca nova foi escolhida nesta convergência.

## @aws-sdk/client-s3

**Version line:** `^3.1123.0`
**Decided in:** `videos/TD-02` e `videos/TD-07` (multipart e objeto no bucket `videos`).

## @aws-sdk/s3-request-presigner

**Version line:** `^3.1123.0`
**Decided in:** `videos/TD-02` e `videos/TD-05` (URL assinada de parte, playback e download).

## bullmq

**Version line:** `^6.4.0`
**Decided in:** `videos/TD-01` (fila `video-processing`, uma tentativa).

## ioredis

**Version line:** `^5.11.1`
**Decided in:** `videos/TD-01` (conexão da fila e do worker no host `redis`).


## Research checked during acceptance audit (2026-10-22)

Resolved and retrieved through Context7: `/aws/aws-sdk-js-v3`,
`/taskforcesh/bullmq` and `/websites/bullmq_io`. Context7's BullMQ repository lists
v6.3.11, while the installed/locked version is **6.4.0**; API usage was also checked
against the installed `.d.ts` and real Docker integration/E2E tests. No runtime
package was added by this audit.

| Library | Exact package-lock version | Relevant APIs and references |
|---|---|---|
| @aws-sdk/client-s3 | 3.1123.0 | S3Client endpoint, CreateMultipartUpload, UploadPart, paginated ListParts, Complete/AbortMultipartUpload, GetObject, PutObject; [SDK S3 reference](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/) |
| @aws-sdk/s3-request-presigner | 3.1123.0 | getSignedUrl with expiresIn=900; signing a separate public endpoint without rewriting signatures; [official README](https://github.com/aws/aws-sdk-js-v3/tree/main/packages/s3-request-presigner) |
| bullmq | 6.4.0 | Queue.add/jobId, Worker, attempts=1, failed event, maxStalledCount=0, close; [connections](https://docs.bullmq.io/guide/connections), [fail fast](https://docs.bullmq.io/patterns/failing-fast-when-redis-is-down), [stalled jobs](https://docs.bullmq.io/guide/jobs/stalled) |
| ioredis | 5.11.1 | Producer enableOfflineQueue=false, maxRetriesPerRequest=1 and command timeout; consumer maxRetriesPerRequest=null; [connection options](https://github.com/redis/ioredis#autoreconnect) |

Object storage image is fixed at `pgsty/silo:RELEASE.2026-09-16T00-00-00Z` in
Compose. FFmpeg/ffprobe are system binaries installed in `Dockerfile.worker`;
`ffmpeg -version` / `ffprobe -version` identify the tested build (both 5.1.9-0+deb12u1 in this audit). Node image:
`node:25.6.0-slim`. Dependency installation uses the committed package-lock via
`npm ci` (verified by the Compose dependencies service).


Existing `@nestjs/throttler@6.5.0`: Context7 `/nestjs/throttler`,
[SkipThrottle](https://github.com/nestjs/throttler#usage) for owner-only metadata
polling. Authentication limits remain covered by the existing auth E2E suite.
