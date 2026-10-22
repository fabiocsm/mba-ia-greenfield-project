---
kind: task
name: task-videos-convergence
test_specs_aware: false
affected_subprojects:
  - nestjs-project
sources_mtime:
  docs/tasks/task-videos-convergence/context.md: "2026-10-21T22:20:00-03:00"
  docs/tasks/task-videos-convergence/validation.md: "2026-10-21T22:20:00-03:00"
---

# task-videos-convergence

## Objective

Fechar as lacunas que `speckit-converge` anexou às specs 001–004, sem reabrir fila, upload, worker ou streaming.

## Step Implementations

### SI-1 — Rejeitar channelId nulo e cobrir o e2e do rascunho

**Description:** `POST /videos` com `channelId: null` responde 400. Sem token responde 401. Campo não previsto responde 400. Nenhuma dessas chamadas insere linha. Cobre T029, T031 e T032.

**Technical actions:**

1. Em `nestjs-project/src/videos/dto/create-video.dto.ts`, validar `channelId` quando o campo vem no JSON, inclusive `null`. `title` e `description` nulos continuam válidos.
2. Estender `nestjs-project/test/videos.e2e-spec.ts` com os três casos.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `CreateVideoDto` | E2E: wiring do ValidationPipe e do guard | `test/videos.e2e-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `channelId: null` devolve 400 `VALIDATION_ERROR` e zero linhas.
- `POST /videos` sem `Authorization` devolve 401 e zero linhas.
- Campo não previsto devolve 400 `VALIDATION_ERROR` e zero linhas.

### SI-2 — Fechar o limite de 10 GB e a soma declarada

**Description:** Abortar o multipart quando a soma já passa de 10.000.000.000 bytes, mesmo com número de parte faltando, e limpar tamanho e tipo declarados. Concluir só quando a soma iguala `declared_size_bytes`. Cobre T036, T037 e T038.

**Technical actions:**

1. Em `completeUpload` e no resume de `openUpload`, abortar e limpar `multipart_upload_id`, `declared_size_bytes` e `declared_content_type` quando a soma das partes passa do limite.
2. Concluir o multipart só com todos os números de parte e soma igual ao tamanho declarado.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` | Unit: ramos de aborto, soma diferente e parte faltando | `src/videos/videos-complete.service.spec.ts` |
| `VideosService` | Unit: resume com partes já acima do limite | `src/videos/videos-upload.service.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Soma acima de 10.000.000.000 aborta, zera id, tamanho e tipo, e não grava `original_storage_key`.
- Soma diferente do tamanho declarado não conclui e não apaga as partes.
- Parte faltando com soma ainda dentro do limite continua incompleta, sem aborto.

### SI-3 — Claim só com arquivo associado

**Description:** A passagem `draft` → `processing` só vence com `original_storage_key` não nula. Sem claim, o vídeo permanece rascunho. Cobre T044.

**Technical actions:**

1. Incluir `original_storage_key IS NOT NULL` no `UPDATE` de `claimDraft`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `claimDraft` | Integration: Postgres real | `src/videos/video-processing.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Rascunho sem chave permanece `draft` e o claim devolve null.
- Rascunho com chave continua podendo ser reivindicado.

### SI-4 — Provar Range e download no storage

**Description:** A URL assinada de playback responde 206 a três ranges consecutivos. A URL de download devolve o objeto inteiro de `originals/{id}` com `Content-Disposition: attachment`. Cobre T033.

**Technical actions:**

1. Estender `nestjs-project/src/videos/video-storage.integration-spec.ts` contra o object storage do Compose.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `S3VideoStorage.signGet` | Integration: storage real | `src/videos/video-storage.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Três `GET` com `Range` de 1024 bytes devolvem 206 e o trecho pedido, sem os bytes anteriores.
- O download sem `Range` devolve os 3072 bytes e `Content-Disposition` de anexo.

### SI-5 — Registrar as bibliotecas já instaladas

**Description:** Criar `docs/phases/phase-03-videos/library-refs.md` com as versões de `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `bullmq` e `ioredis` que estão em `nestjs-project/package.json`. Cobre T043.

**Technical actions:**

1. Gravar o arquivo com essas quatro versões.

**Tests:** _(empty — documentação)_

**Dependencies:** none

**Acceptance criteria:**

- O arquivo existe e cita as quatro versões do `package.json`.

### SI-6 — Serializar o e2e

**Description:** `npm run test:e2e` executa Jest com `--runInBand`. Cobre T046.

**Technical actions:**

1. Acrescentar `--runInBand` ao script `test:e2e` de `nestjs-project/package.json`.

**Tests:** _(empty — o fechamento roda `npm run test:e2e`)_

**Dependencies:** none

**Acceptance criteria:**

- O script `test:e2e` contém `--runInBand`.

### SI-7 — Documentar o módulo de vídeos

**Description:** `CLAUDE.md` e `nestjs-project/CLAUDE.md` passam a descrever as rotas, a fila `video-processing`, o serviço `video-worker` e o storage. A fila deixa de figurar como TBD. Cobre T030, T034, T039 e T045.

**Technical actions:**

1. Atualizar os dois arquivos com o que o código já expõe.

**Tests:** _(empty — documentação)_

**Dependencies:** none

**Acceptance criteria:**

- Os dois arquivos citam `POST /videos`, `GET /videos/:id`, upload, complete, playback, download, `video-processing` e `video-worker`.
- A fila no diagrama da raiz não está como TBD.

## Dependency Map

```
SI-1 (root)
SI-2 (root)
SI-3 (root)
SI-4 (root)
SI-5 (root)
SI-6 (root)
SI-7 (root)
```

## Deliverables

- [x] SI-1 — Rejeitar channelId nulo e cobrir o e2e do rascunho
- [x] SI-2 — Fechar o limite de 10 GB e a soma declarada
- [x] SI-3 — Claim só com arquivo associado
- [x] SI-4 — Provar Range e download no storage
- [x] SI-5 — Registrar as bibliotecas já instaladas
- [x] SI-6 — Serializar o e2e
- [x] SI-7 — Documentar o módulo de vídeos
- [x] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [x] E2E tests pass (`docker compose exec nestjs-api npm run test:e2e`)
- [x] `npx tsc --noEmit` exits 0
- [x] `npm run lint` exits 0
