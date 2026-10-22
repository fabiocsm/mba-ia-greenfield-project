---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.5
target_file: nestjs-project/test/videos-upload-complete.e2e-spec.ts
---

# POST /videos/:id/upload/complete Test Plan

## Application Overview

O complete grava o original em `originals/{id}`, encerra o multipart e publica um job. A resposta continua `draft`. O worker, fora do pedido, leva a linha a `ready` ou `error` sem apagar o arquivo.

## Test Scenarios

### 1. POST /videos/:id/upload/complete

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`. Storage e Redis do Compose estão no ar.

#### 1.1. post-complete-associa-e-segue-draft

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono quando todas as partes do tamanho declarado já estão no storage
    - expect: 200
    - expect: `file.associated` é `true` e `status` é `draft`
    - expect: `durationSeconds` é `null`, `technicalMetadata` é `null` e `thumbnailStored` é `false`

#### 1.2. post-complete-partes-faltando

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono quando falta ao menos uma parte
    - expect: 409
    - expect: `error` é `VIDEO_UPLOAD_INCOMPLETE`
    - expect: `original_storage_key` continua nula

#### 1.3. post-complete-soma-acima-do-limite

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono quando a soma das partes passa de 10000000000
    - expect: 422
    - expect: `error` é `VIDEO_FILE_TOO_LARGE`
    - expect: o multipart é abortado e `original_storage_key` continua nula

#### 1.4. post-complete-sem-envio

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono em um rascunho sem multipart e sem arquivo
    - expect: 409
    - expect: `error` é `VIDEO_UPLOAD_NOT_STARTED`
    - expect: nada é gravado no storage

#### 1.5. post-complete-redis-recusa-o-job

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono com as partes completas e o Redis recusando o job depois da chave gravada
    - expect: 503
    - expect: `error` é `VIDEO_PROCESSING_NOT_SCHEDULED`
    - expect: `original_storage_key` permanece preenchida e `status` segue `draft`

### 2. GET /videos/:id

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`. O worker do Compose consome a fila.

#### 2.1. get-videos-id-depois-do-worker-ready

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono com um arquivo de vídeo válido e esperar o worker
  2. GET /videos/:id do mesmo dono
    - expect: 200
    - expect: `status` `ready`, `durationSeconds` preenchido, `technicalMetadata` objeto e `thumbnailStored` `true`

#### 2.2. get-videos-id-depois-do-worker-error

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload/complete do dono com um original que o worker não consegue ler e esperar o worker
  2. GET /videos/:id do mesmo dono
    - expect: 200
    - expect: `status` `error`, `thumbnailStored` `false` e `file.associated` `true`

#### 2.3. post-complete-segundo-job-nao-muda-o-desfecho

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. Levar o vídeo a `ready` ou `error` pelo worker
  2. POST /videos/:id/upload/complete de novo e ler GET /videos/:id
    - expect: o `status` permanece só `ready` ou só `error`, nunca os dois
    - expect: o segundo complete não publica outro job com o mesmo `jobId`
