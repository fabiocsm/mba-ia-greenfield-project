---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.4
target_file: nestjs-project/test/videos-upload.e2e-spec.ts
---

# POST /videos/:id/upload Test Plan

## Application Overview

O dono de um rascunho pede o envio de um vídeo de até 10GB. A API devolve endereços assinados das partes que ainda faltam e não recebe o arquivo. Um segundo pedido no mesmo rascunho retoma o mesmo multipart.

## Test Scenarios

### 1. POST /videos/:id/upload

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`. O rascunho do dono já existe. O object storage do Compose está no ar.

#### 1.1. post-upload-abre-multipart

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono com `sizeBytes` de 1 a 10000000000 e `contentType` que começa com `video/`
    - expect: 201
    - expect: corpo traz `videoId` igual ao id do rascunho, `partSizeBytes`, `sizeBytes` igual ao declarado e `parts` com `partNumber` e `url`
    - expect: o corpo da resposta não contém o arquivo

#### 1.2. post-upload-retoma-partes-faltantes

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono até abrir o multipart
  2. Repetir POST /videos/:id/upload no mesmo rascunho depois que ao menos uma parte já está no storage
    - expect: 200
    - expect: `parts` lista só o que `ListParts` ainda não vê, em ordem

#### 1.3. post-upload-arquivo-vazio

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono com `sizeBytes` 0 e `contentType` `video/mp4`
    - expect: 422
    - expect: `error` é `VIDEO_FILE_EMPTY`
    - expect: a linha não ganha `multipart_upload_id`

#### 1.4. post-upload-acima-de-10gb

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono com `sizeBytes` acima de 10000000000
    - expect: 422
    - expect: `error` é `VIDEO_FILE_TOO_LARGE`
    - expect: a linha não ganha `multipart_upload_id`

#### 1.5. post-upload-tipo-nao-video

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono com `contentType` cujo trecho antes de `;` não começa com `video/`
    - expect: 422
    - expect: `error` é `VIDEO_FILE_NOT_VIDEO`
    - expect: a linha não ganha `multipart_upload_id`

#### 1.6. post-upload-arquivo-ja-associado

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos/:id/upload do dono quando `original_storage_key` já está preenchida
    - expect: 409
    - expect: `error` é `VIDEO_FILE_ALREADY_STORED`
    - expect: nenhum multipart novo

#### 1.7. post-upload-simultaneo-um-multipart

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. Disparar dois POST /videos/:id/upload ao mesmo tempo no mesmo rascunho, com o mesmo tamanho e o mesmo tipo válidos
    - expect: um responde 201 e o outro 200, ou os dois respondem 200 se o primeiro já gravou o id
    - expect: a linha fica com um único `multipart_upload_id`
