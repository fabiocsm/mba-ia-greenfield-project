---
subproject: backend
runner: jest+supertest
scope: phase-03-videos
si: SI-03.3
target_file: nestjs-project/test/videos.e2e-spec.ts
---

# POST /videos e GET /videos/:id Test Plan

## Application Overview

O dono autenticado inicia o envio e o sistema grava exatamente um rascunho do canal dele antes de qualquer arquivo. A resposta identifica o vídeo, o canal, o estado `draft` e a `url`.

## Test Scenarios

### 1. POST /videos

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`.

#### 1.1. post-videos-cria-rascunho

**Covers AC:** #1
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos com Bearer do dono e corpo sem arquivo
    - expect: 201
    - expect: corpo traz `id`, `channelId` do canal desse token, `status` `draft` e `url` não vazia
    - expect: a tabela `videos` tem exatamente uma linha nova

#### 1.2. post-videos-titulo-e-descricao-em-branco

**Covers AC:** #2
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos com `title` só de espaços e `description` string vazia
    - expect: 201
    - expect: `title` e `description` no corpo são `null`
    - expect: as colunas `title` e `description` da linha persistem `null`

#### 1.3. post-videos-channel-id-alheio

**Covers AC:** #4
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos autenticado como o dono A, com `channelId` do canal do dono B
    - expect: 403
    - expect: `error` é `VIDEO_CHANNEL_FORBIDDEN`
    - expect: nenhuma linha nova em `videos`

#### 1.4. post-videos-sem-canal

**Covers AC:** #5
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos com Bearer de um usuário autenticado que não tem linha em `channels`
    - expect: 404
    - expect: `error` é `CHANNEL_NOT_FOUND`
    - expect: nenhuma linha nova em `videos` e nenhuma linha nova em `channels`

#### 1.5. post-videos-simultaneos

**Covers AC:** #7
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. Disparar dois POST /videos ao mesmo tempo, do mesmo dono ou de donos diferentes, ambos sem arquivo
    - expect: os dois respondem 201
    - expect: os `id` são diferentes e as `url` são diferentes

### 2. GET /videos/:id

**Setup:** beforeEach truncate test DB; bootstrap backend test module (NestJS: `Test.createTestingModule({ imports: [AppModule] }).compile()`), com o pipe, os filters e o guard globais de `main.ts`.

#### 2.1. get-videos-id-do-dono

**Covers AC:** #3
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. POST /videos autenticado e guardar `id`, `channelId`, `status` e `url`
  2. GET /videos/:id com o mesmo Bearer
    - expect: 200
    - expect: `id`, `channelId`, `status` e `url` são os mesmos do 201

#### 2.2. get-videos-id-inexistente-ou-de-outro-canal

**Covers AC:** #6
**Source:** auto
**Last sync:** 2026-10-21T18:14:22Z

**Steps:**
  1. GET /videos/:id com um UUID que não existe, autenticado
    - expect: 404
    - expect: `error` é `VIDEO_NOT_FOUND`
  2. GET /videos/:id do vídeo do dono B, autenticado como o dono A
    - expect: 404
    - expect: `error` é `VIDEO_NOT_FOUND`
