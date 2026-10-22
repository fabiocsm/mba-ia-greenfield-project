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
  nestjs-project/package.json: "2026-10-21T22:25:00-03:00"
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
