---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.6
target_file: nestjs-project/test/videos-playback.e2e-spec.ts
---

# GET /videos/:id/playback e GET /videos/:id/download Test Plan

## Application Overview

O dono de um vídeo `ready` pede um endereço assinado para assistir ou para baixar. A API não lê o objeto. Quem não é o dono, ou cujo vídeo não está pronto, não recebe o endereço.

## Test Scenarios

### 1. GET /videos/:id/playback

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`. O object storage do Compose está no ar.

#### 1.1. get-playback-ready

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/playback do dono com `status` `ready` e `original_storage_key` preenchida
    - expect: 200
    - expect: corpo traz `fileUrl` e `expiresInSeconds` `900`
    - expect: a resposta da API não inclui o corpo do objeto

#### 1.2. get-playback-nao-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/playback do dono com `status` `draft`, depois `processing`, depois `error`
    - expect: cada chamada retorna 409
    - expect: `error` é `VIDEO_NOT_READY`
    - expect: `status` e `original_storage_key` da linha não mudam

#### 1.3. get-playback-ready-sem-chave

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/playback do dono com `status` `ready` e `original_storage_key` nula
    - expect: 409
    - expect: `error` é `VIDEO_FILE_NOT_STORED`

#### 1.4. get-playback-inexistente-ou-de-outro-canal

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/playback autenticado com um UUID que não existe
    - expect: 404
    - expect: `error` é `VIDEO_NOT_FOUND`
  2. GET /videos/:id/playback do vídeo `ready` do dono B, autenticado como o dono A
    - expect: 404
    - expect: `error` é `VIDEO_NOT_FOUND`

#### 1.5. get-playback-file-url-nao-e-a-url-publica

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/playback do dono com o vídeo `ready`
    - expect: `fileUrl` é diferente da `url` devolvida por GET /videos/:id
    - expect: `fileUrl` não contém o prefixo `thumbnails/`

### 2. GET /videos/:id/download

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`. O object storage do Compose está no ar.

#### 2.1. get-download-ready

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/download do dono com o mesmo vídeo `ready` do playback
    - expect: 200
    - expect: `fileUrl` pede `response-content-disposition=attachment` para o mesmo objeto
    - expect: `expiresInSeconds` é `900`

#### 2.2. get-download-nao-ready

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/download do dono com `status` `draft`, `processing` ou `error`
    - expect: 409
    - expect: `error` é `VIDEO_NOT_READY`
    - expect: a linha não muda

#### 2.3. get-download-ready-sem-chave

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/download do dono com `status` `ready` e `original_storage_key` nula
    - expect: 409
    - expect: `error` é `VIDEO_FILE_NOT_STORED`

#### 2.4. get-download-inexistente-ou-de-outro-canal

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id/download autenticado com um UUID que não existe, e de novo com o vídeo `ready` de outro canal
    - expect: as duas chamadas retornam 404
    - expect: `error` é `VIDEO_NOT_FOUND`
