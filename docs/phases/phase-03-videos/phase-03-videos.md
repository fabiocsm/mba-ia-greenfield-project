---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-21T14:48:50-03:00"
  docs/project-plan.md: "2026-10-20T16:03:03-03:00"
  docs/decisions/technical-decisions-videos.md: "2026-10-20T17:36:38-03:00"
  docs/decisions/technical-decisions-video-draft-registration.md: "2026-10-21T14:45:28-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-10-20T16:03:03-03:00"
  docs/phases/phase-01-configuracao-base/context.md: "2026-10-20T16:03:03-03:00"
  docs/phases/phase-02-auth/context.md: "2026-10-20T16:03:03-03:00"
  docs/phases/phase-02-auth-frontend/context.md: "2026-10-20T16:03:03-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-20T16:03:03-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload de até 10GB funcional, o processamento automático do vídeo, o streaming e as URLs únicas: armazenamento de vídeos e thumbnails, fila, upload sem impacto na performance, pré-cadastro do rascunho ao iniciar o upload, duração e metadados, thumbnail a partir de um frame, URL sem conflito, reprodução sem download completo e download pelo dono.

---

## Step Implementations

### SI-03.1 — Subir object storage e Redis

**Description:** Sobe MinIO e Redis no Compose e valida a configuração nova, para o upload e a fila usarem o nome do serviço em vez de localhost.

**Technical actions:**

1. Acrescentar os serviços de object storage compatível com S3 e de Redis em `nestjs-project/compose.yaml`, com o bucket `videos` (per `videos/TD-07`). O host de cada um é o nome do serviço.
2. Criar `src/config/storage.config.ts` e `src/config/queue.config.ts` com `registerAs` (convenção herdada de `phase-01-configuracao-base/TD-03`).
3. Validar as chaves novas no Joi de `src/config/env.validation.ts` (convenção herdada de `phase-01-configuracao-base/TD-02`).
4. Registrar as factories no `ConfigModule` e documentar as chaves no exemplo de ambiente.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| env.validation | Integration: schema recusa ambiente sem as chaves de storage e de fila | `nestjs-project/src/config/env.validation.integration-spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose ps` em `nestjs-project/` mostra os serviços de object storage e de Redis em execução junto da API e do Postgres.
- A API resolve storage e Redis pelo nome do serviço do Compose.
- Boot sem a chave do bucket `videos` ou sem a chave do Redis falha na validação de ambiente.

---

### SI-03.2 — Criar a tabela videos

**Description:** Cria a linha de vídeo ligada ao canal, com `public_url` única, para o rascunho existir antes do arquivo.

**Technical actions:**

1. Criar a entidade `Video` em `nestjs-project/src/videos/entities/video.entity.ts` com as colunas de `### Data Model` → `#### Video`.
2. Acrescentar o `@OneToMany` inverso em `Channel`. O módulo de canais não cria vídeo.
3. Gerar a migration que cria `videos` com `synchronize: false`.
4. Criar `VideosModule` e importá-lo em `AppModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| Video | Integration: constraints, defaults, unique em `public_url`, FK `channel_id` | `nestjs-project/src/videos/entities/video.entity.integration-spec.ts` |
| VideosModule | Unit: compilation test | `nestjs-project/src/videos/videos.module.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- Inserir um vídeo persiste `status` `draft` quando o valor não é informado.
- `title` e `description` em branco persistem `null`.
- Duas linhas não compartilham `public_url`.
- `channel_id` aponta para `channels.id`. A tabela não guarda o arquivo em coluna de conteúdo.
- `VideosModule` compila dentro do `AppModule`.

---

### SI-03.3 — Registrar e ler o rascunho

**Description:** O dono autenticado inicia o envio e recebe exatamente um rascunho do próprio canal, identificável antes de o arquivo chegar.

**Route:** POST /videos, GET /videos/:id
**Test Specs:** see `nestjs-project/specs/videos.plan.md`
**Authorization:** Owner. Anônimo recebe 401 do guard. Canal alheio ou id de outro dono não cria nem revela a linha.

**Technical actions:**

1. Expor `findByUserId` em `ChannelsService`, devolvendo o canal daquele `user_id` ou `null`, sem criar canal.
2. Criar o alocador de `public_url` com `node:crypto` e nova tentativa quando a unique violation estourar (per `videos/TD-04`).
3. Implementar criação e leitura do próprio vídeo em `VideosService`. Um envio persiste uma linha antes de qualquer chamada ao storage (per `video-draft-registration/TD-01`).
4. Implementar `POST /videos` e `GET /videos/:id` com o corpo de `### API Contracts` e decorators `@nestjs/swagger` (per `openapi-docs-nestjs/TD-01`).
5. Registrar controller, service, repositório e alocador em `VideosModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| ChannelsService | Unit: `findByUserId` devolve o canal ou `null` | `nestjs-project/src/channels/channels.service.spec.ts` |
| VideosService | Unit: um envio pede uma inserção; título e descrição vazios viram `null`; `status` gravado é `draft` | `nestjs-project/src/videos/videos.service.spec.ts` |

**Dependencies:** SI-03.2 — a tabela `videos` precisa existir

**Acceptance criteria:**

- `POST /videos` autenticado, sem arquivo, retorna `201` com `id`, `channelId`, `status` `draft` e `url` não vazia.
- `POST /videos` com `title` ou `description` em branco persiste e devolve `null` nesses campos.
- `GET /videos/:id` do dono retorna `200` com o mesmo `id`, `channelId`, `status` e `url`.
- `POST /videos` com `channelId` de outro usuário retorna `403` com `error` `VIDEO_CHANNEL_FORBIDDEN` e não cria linha.
- `POST /videos` de autenticado sem canal retorna `404` com `error` `CHANNEL_NOT_FOUND` e não cria canal.
- `GET /videos/:id` de id inexistente ou de outro canal retorna `404` com `error` `VIDEO_NOT_FOUND`.
- Dois `POST /videos` simultâneos retornam dois `201` com `url` diferentes.

---

### SI-03.4 — Abrir e retomar o upload

**Description:** O dono pede o envio de até 10GB e recebe endereços assinados das partes que faltam, sem o arquivo passar pela API.

**Route:** POST /videos/:id/upload
**Test Specs:** see `nestjs-project/specs/videos-upload.plan.md`
**Authorization:** Owner

**Technical actions:**

1. Criar a porta de storage que abre um multipart, assina cada parte, executa `ListParts` e aborta o multipart (per `videos/TD-02`). Os bytes não entram na API.
2. Implementar as regras de `sizeBytes` e `contentType` de `### API Contracts` → `POST /videos/:id/upload`. Retomada reutiliza o mesmo `multipart_upload_id`.
3. Implementar o controller. `partSizeBytes` é `5242880`, ou o próprio `sizeBytes` quando o arquivo cabe numa parte. A chave do objeto fica `originals/{id}` só no complete (per `videos/TD-07`).
4. Incluir `file.associated`, `file.sizeBytes` e `file.uploadInProgress` no `GET /videos/:id`.
5. Registrar a porta no `VideosModule`, lendo `storage.config` (per `videos/TD-07`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideosService | Unit: vazio, tipo inválido, acima de 10GB, arquivo já associado e retomada do mesmo multipart | `nestjs-project/src/videos/videos-upload.service.spec.ts` |
| Storage adapter | Integration: multipart real no MinIO do Compose, `ListParts` e aborto | `nestjs-project/src/videos/video-storage.integration-spec.ts` |

**Dependencies:** SI-03.1 — o storage precisa estar no Compose; SI-03.3 — o rascunho precisa existir

**Acceptance criteria:**

- `POST /videos/:id/upload` do dono, com vídeo de até 10000000000 bytes, retorna `201` com `videoId`, `partSizeBytes`, `sizeBytes` e `parts`.
- O mesmo POST com multipart já aberto retorna `200` e só as partes que `ListParts` ainda não vê.
- `sizeBytes` `0` retorna `422` com `error` `VIDEO_FILE_EMPTY` e não cria multipart.
- `sizeBytes` acima de 10000000000 retorna `422` com `error` `VIDEO_FILE_TOO_LARGE`.
- Tipo que não começa com `video/` retorna `422` com `error` `VIDEO_FILE_NOT_VIDEO`.
- Upload de vídeo já associado retorna `409` com `error` `VIDEO_FILE_ALREADY_STORED`.
- Dois POST simultâneos no mesmo rascunho deixam um único `multipart_upload_id`.

---

### SI-03.5 — Concluir o arquivo e processar

**Description:** O complete grava o original, publica um único job e o worker marca o vídeo `ready` ou `error` sem apagar o arquivo.

**Route:** POST /videos/:id/upload/complete
**Test Specs:** see `nestjs-project/specs/videos-upload-complete.plan.md`
**Authorization:** Owner

**Technical actions:**

1. Completar o multipart, gravar `original_storage_key` `originals/{id}` e zerar `multipart_upload_id`. Soma acima do limite aborta e não deixa chave (per `videos/TD-07`, per `videos/TD-02`).
2. Publicar o job BullMQ com `jobId` igual ao `id` do vídeo. Se o Redis recusar, responder `503` `VIDEO_PROCESSING_NOT_SCHEDULED` com a chave já gravada (per `videos/TD-01`).
3. Subir o worker em container separado, com os binários `ffmpeg` e `ffprobe`, sem biblioteca wrapper (per `videos/TD-03`).
4. No worker, uma tentativa: claim `draft` → `processing` com `processing_claim`, depois `ready` ou `error`. Os dois desfechos não se aplicam juntos (per `videos/TD-06`).
5. Em `ready`, gravar `duration_seconds`, `technical_metadata` e `thumbnail_storage_key` `thumbnails/{id}` no mesmo UPDATE.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideosService | Unit: partes faltando, soma acima do limite, job recusado e complete repetido | `nestjs-project/src/videos/videos-complete.service.spec.ts` |
| Worker | Integration: claim no Postgres real e um segundo job não sobrescreve `ready` nem `error` | `nestjs-project/src/videos/video-processing.integration-spec.ts` |

**Dependencies:** SI-03.4 — o multipart precisa existir; SI-03.1 — Redis e o bucket `videos` precisam estar no Compose

**Acceptance criteria:**

- `POST /videos/:id/upload/complete` com todas as partes retorna `200`, `file.associated` `true` e `status` ainda `draft`.
- Complete com partes faltando retorna `409` com `error` `VIDEO_UPLOAD_INCOMPLETE` e não grava `original_storage_key`.
- Complete cuja soma passa de 10000000000 retorna `422` com `error` `VIDEO_FILE_TOO_LARGE` e aborta o multipart.
- Complete sem multipart e sem arquivo retorna `409` com `error` `VIDEO_UPLOAD_NOT_STARTED`.
- Redis recusando o job retorna `503` com `error` `VIDEO_PROCESSING_NOT_SCHEDULED` e a chave permanece.
- Depois do worker, `GET /videos/:id` do dono retorna `ready` com `durationSeconds`, `technicalMetadata` e `thumbnailStored` `true`, ou `error` com `thumbnailStored` `false` e o original ainda associado.
- Dois jobs do mesmo vídeo não deixam a linha ao mesmo tempo `ready` e `error`.

---

### SI-03.6 — Entregar reprodução e download

**Description:** O dono de um vídeo `ready` recebe um GET assinado para assistir por Range ou para baixar o arquivo inteiro, sem a API carregar o objeto.

**Route:** GET /videos/:id/playback, GET /videos/:id/download
**Test Specs:** see `nestjs-project/specs/videos-playback.plan.md`
**Authorization:** Owner, e só com status `ready` e `original_storage_key` preenchida

**Technical actions:**

1. Assinar o GET de `original_storage_key` depois das checagens de dono e de `ready` (per `videos/TD-05`). `expiresInSeconds` é `900`.
2. No playback, omitir `response-content-disposition` e omitir `Range` na assinatura. No download, incluir `response-content-disposition=attachment`.
3. Implementar os dois controllers com o corpo de `### API Contracts` e `@nestjs/swagger` (per `openapi-docs-nestjs/TD-01`).
4. Recusar `draft`, `processing` e `error` com `VIDEO_NOT_READY`, e `ready` sem chave com `VIDEO_FILE_NOT_STORED`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| VideosService | Unit: dono `ready` assina; outros status recusam; `ready` sem chave recusa; download pede attachment | `nestjs-project/src/videos/videos-playback.service.spec.ts` |

**Dependencies:** SI-03.5 — só um vídeo `ready` com `original_storage_key` autoriza a assinatura

**Acceptance criteria:**

- `GET /videos/:id/playback` do dono com status `ready` retorna `200` com `fileUrl` e `expiresInSeconds` `900`, sem a API ler o objeto.
- `GET /videos/:id/download` do mesmo vídeo retorna `200` com `fileUrl` de attachment do mesmo objeto.
- Playback ou download com status `draft`, `processing` ou `error` retorna `409` com `error` `VIDEO_NOT_READY` e não altera a linha.
- Status `ready` com `original_storage_key` nula retorna `409` com `error` `VIDEO_FILE_NOT_STORED`.
- Id inexistente ou vídeo de outro canal retorna `404` com `error` `VIDEO_NOT_FOUND`.
- `fileUrl` não usa `public_url` nem a chave `thumbnails/{id}`.

---

## Technical Specifications

### Data Model

#### Video

Tabela `videos`. Uma linha por envio iniciado. O arquivo e a thumbnail não são linhas: a linha guarda as chaves.

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated. Não é a URL pública |
| channel_id | uuid | NOT NULL, FK `channels.id` ON DELETE RESTRICT |
| status | varchar | NOT NULL, default `draft`. Valores: `draft`, `processing`, `ready`, `error`. CHECK |
| public_url | varchar | NOT NULL, UNIQUE. Na resposta HTTP o mesmo valor se chama `url` |
| title | text | NULL. Ausente, `null` ou em branco persiste `null` |
| description | text | NULL. Mesma regra de `title` |
| declared_size_bytes | bigint | NULL. Inteiro de 1 a 10000000000 inclusive enquanto há envio ou arquivo associado |
| declared_content_type | varchar | NULL. Tipo declarado normalizado para a comparação `video/` |
| multipart_upload_id | varchar | NULL. No máximo um multipart por linha |
| original_storage_key | varchar | NULL. Quando preenchida, o valor é `originals/{id}` e não se reescreve |
| processing_claim | uuid | NULL. Token do job que tomou a linha. Não sai na API |
| duration_seconds | numeric | NULL. Fora de `ready` permanece `null`. Em `ready`, finito e >= 0 |
| technical_metadata | jsonb | NULL. Fora de `ready` permanece `null`. Em `ready`, objeto com `format` e `streams` |
| thumbnail_storage_key | varchar | NULL. Só deixa de ser `null` no mesmo UPDATE que grava `ready`. Valor: `thumbnails/{id}` |
| created_at | timestamptz | NOT NULL, default now() |
| updated_at | timestamptz | NOT NULL, default now() |

**Relations:** `Video` pertence a um `Channel` (`@ManyToOne`, lado dono, `@JoinColumn({ name: 'channel_id' })`). `Channel` tem muitos `Video` (`@OneToMany` inverso). O módulo de canais não cria vídeo. A busca do canal pelo `user_id` do token já existe no cadastro; esta fase só lê.
**Indexes:** unique em `public_url`; índice em `channel_id`

Bucket `videos` (per `videos/TD-07`). Prefixo `originals/` para o arquivo. Prefixo `thumbnails/` para a capa. As duas chaves usam o `id` do vídeo.

**State:** `draft` sem `original_storage_key` não agenda job. `draft` com `original_storage_key` passa a `processing` só se o UPDATE ainda encontra `draft` e grava `processing_claim`. `ready` e `error` saem só de `processing`, e só se `processing_claim` é o token daquele job (per `videos/TD-06`). `error` não apaga `original_storage_key`. `public_url` é gerada com `node:crypto` e, em unique violation, a inserção tenta de novo (per `videos/TD-04`). A linha nasce antes de qualquer chamada ao storage (per `video-draft-registration/TD-01`).

### API Contracts

Rotas autenticadas pelo guard JWT já global. Nenhuma usa `@Public()`. Envelope de erro herdado de `phase-02-auth/TD-07`: `{ statusCode, error, message }`. Validação inválida continua `400` com `error` `VALIDATION_ERROR`. Campo desconhecido no corpo é recusado. Documentar com `@nestjs/swagger` (per `openapi-docs-nestjs/TD-01`). A UI do Swagger permanece só fora de produção (per `openapi-docs-nestjs/TD-03`). O corpo destas rotas não carrega o arquivo.

#### POST /videos (SI-03.3)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer access token

**Request body:**
- title: string, optional — omitido, `null` ou em branco persiste `null`
- description: string, optional — mesma regra de `title`
- channelId: uuid, optional — omitido usa o canal do token; igual ao canal do token segue; diferente não cria vídeo

**Response 201:**
- id: string (uuid)
- channelId: string (uuid)
- status: `draft`
- url: string não vazia. É a coluna `public_url`
- title: string ou `null`
- description: string ou `null`

**Error responses:**
- 401: token ausente ou inválido, código já emitido pelo guard. Nenhuma linha
- 403 VIDEO_CHANNEL_FORBIDDEN: `channelId` de outro usuário. Nenhuma linha
- 404 CHANNEL_NOT_FOUND: autenticado sem canal. Nenhuma linha e nenhum canal criado
- 400 validation error: campo não previsto, inclusive arquivo

Dois POST simultâneos devolvem dois `201` com `id` e `url` diferentes (per `videos/TD-04`, per `video-draft-registration/TD-01`).

---

#### GET /videos/:id (SI-03.3, SI-03.4, SI-03.5)

**Request headers:**
- Authorization: Bearer access token

**Response 200:**
- id, channelId, status, url, title, description: os mesmos de `POST /videos`
- file.associated: `false` até o complete; `true` depois
- file.sizeBytes: `null` até o complete; depois o inteiro associado, de 1 a 10000000000
- file.uploadInProgress: `true` se existe `multipart_upload_id`; senão `false`
- durationSeconds: `null` fora de `ready`. Em `ready`, número finito >= 0. Coluna `duration_seconds`
- technicalMetadata: `null` fora de `ready`. Em `ready`, objeto. Coluna `technical_metadata`
- thumbnailStored: `true` só em `ready` com `thumbnail_storage_key` preenchida; senão `false`
- status: `draft`, `processing`, `ready` ou `error`

**Error responses:**
- 401: token ausente ou inválido, código já emitido pelo guard
- 404 VIDEO_NOT_FOUND: id inexistente ou vídeo de outro canal

Não inclui `fileUrl`, `processing_claim` nem a chave `thumbnails/{id}`.

---

#### POST /videos/:id/upload (SI-03.4)

**Request headers:**
- Content-Type: application/json
- Authorization: Bearer access token

**Request body:**
- sizeBytes: integer, required — `0` é vazio; acima de 10000000000 é excesso; 10000000000 é aceito
- contentType: string, required — o trecho antes de `;`, sem espaços nas pontas, começa com `video/` sem diferenciar maiúsculas

**Response 201:** multipart novo. **Response 200:** multipart já existente; o corpo lista só as partes que faltam (`ListParts`, per `videos/TD-02`).

- videoId: uuid do rascunho
- partSizeBytes: `5242880`, ou o próprio `sizeBytes` quando o arquivo cabe numa parte
- sizeBytes: tamanho declarado aceito
- parts: lista ordenada do que ainda falta. Cada item tem `partNumber` (a partir de 1) e `url` (endereço assinado da parte). Lista vazia só se todas as partes já chegaram e o complete ainda não rodou

A `url` da parte pode vencer sem apagar partes já aceitas. Outro POST no mesmo rascunho devolve URLs novas para o que falta e reutiliza o mesmo `multipart_upload_id`. `original_storage_key` continua `null`. Dois POST simultâneos no mesmo rascunho criam um só multipart.

**Error responses:**
- 401: token ausente ou inválido, código já emitido pelo guard
- 404 VIDEO_NOT_FOUND: id inexistente ou vídeo de outro canal
- 400 validation error: `sizeBytes` ausente, tipo errado ou campo não previsto
- 422 VIDEO_FILE_EMPTY: `sizeBytes` igual a 0
- 422 VIDEO_FILE_TOO_LARGE: `sizeBytes` acima de 10000000000
- 422 VIDEO_FILE_NOT_VIDEO: tipo que não começa com `video/`
- 409 VIDEO_FILE_ALREADY_STORED: `original_storage_key` já preenchida

---

#### POST /videos/:id/upload/complete (SI-03.4, SI-03.5)

**Request headers:**
- Authorization: Bearer access token

**Request body:** nenhum.

**Response 200:** o mesmo corpo de `GET /videos/:id`. Na associação que acaba de gravar a chave, `status` continua `draft`, `file.associated` é `true`, `durationSeconds` é `null`, `technicalMetadata` é `null`, `thumbnailStored` é `false`. A API não espera o worker.

Grava `original_storage_key` = `originals/{id}`, encerra o multipart e zera `multipart_upload_id` (per `videos/TD-07`). Em seguida publica um job com `jobId` igual ao `id` do vídeo (per `videos/TD-01`). Complete repetido com a chave já gravada não cria outro objeto e não publica um segundo job com o mesmo `jobId`. Complete com status `processing`, `ready` ou `error` não muda a linha nem publica outro job.

**Error responses:**
- 409 VIDEO_UPLOAD_INCOMPLETE: faltam partes. As partes já aceitas permanecem. Nenhuma chave final
- 422 VIDEO_FILE_TOO_LARGE: a soma das partes passa de 10000000000. Aborta o multipart. `original_storage_key` continua `null`. Partes não permanecem
- 409 VIDEO_UPLOAD_NOT_STARTED: não há multipart e não há arquivo
- 503 VIDEO_PROCESSING_NOT_SCHEDULED: a chave foi gravada e o Redis recusou o job. Status segue `draft`. Outro complete pode publicar o job
- 401: token ausente ou inválido, código já emitido pelo guard
- 404 VIDEO_NOT_FOUND: id inexistente ou vídeo de outro canal

Arquivo já associado e job já aceito: `200`, sem outro objeto.

---

#### GET /videos/:id/playback (SI-03.6)

**Request headers:**
- Authorization: Bearer access token

**Response 200:**
- fileUrl: GET assinado de `original_storage_key`. Sem `response-content-disposition` e sem `Range` na assinatura (per `videos/TD-05`)
- expiresInSeconds: `900`

A API não lê o objeto. Quem continua de um ponto envia `Range` ao storage nesse `fileUrl`. O storage responde `206` com o trecho pedido. A linha não muda.

**Error responses:**
- 401: token ausente ou inválido, código já emitido pelo guard
- 404 VIDEO_NOT_FOUND: id inexistente ou vídeo de outro canal
- 409 VIDEO_NOT_READY: status `draft`, `processing` ou `error`
- 409 VIDEO_FILE_NOT_STORED: status `ready` e `original_storage_key` `null`

---

#### GET /videos/:id/download (SI-03.6)

**Request headers:**
- Authorization: Bearer access token

**Response 200:**
- fileUrl: GET assinado do mesmo objeto, com `response-content-disposition=attachment` e sem `Range` na assinatura (per `videos/TD-05`)
- expiresInSeconds: `900`

Um GET nesse `fileUrl` sem `Range` devolve o objeto inteiro. A linha não muda. A chave `thumbnails/{id}` não entra em `fileUrl`.

**Error responses:**
- os mesmos de `GET /videos/:id/playback`

#### Validation Rules — rascunho e upload

- `title`: opcional; string, `null` ou omitido; em branco persiste `null`
- `description`: a mesma regra de `title`
- `channelId`: opcional; UUID
- `sizeBytes`: obrigatório no upload; inteiro; `0` recusado; máximo 10000000000 inclusive
- `contentType`: obrigatório no upload; depois do recorte antes de `;`, começa com `video/`

### Authorization Matrix

Quem não é o dono do canal da linha recebe a mesma recusa de id inexistente (`404` `VIDEO_NOT_FOUND`), não uma lista do que existe.

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| POST /videos | ✗ | ✓ se o canal é o do token | ✓ |
| GET /videos/:id | ✗ | ✗ | ✓ |
| POST /videos/:id/upload | ✗ | ✗ | ✓ |
| POST /videos/:id/upload/complete | ✗ | ✗ | ✓ |
| GET /videos/:id/playback | ✗ | ✗ | ✓ só com status `ready` e `original_storage_key` preenchida |
| GET /videos/:id/download | ✗ | ✗ | ✓ só com status `ready` e `original_storage_key` preenchida |

### Error Catalog

O envelope não muda (per `phase-02-auth/TD-07`):

```
{ statusCode: number, error: string, message: string }
```

`401` de token ausente ou inválido continua o que o guard JWT já emite. Não entra neste catálogo.

| errorCode | HTTP | Trigger |
|-----------|------|---------|
| VIDEO_CHANNEL_FORBIDDEN | 403 | POST /videos com `channelId` de outro usuário |
| CHANNEL_NOT_FOUND | 404 | POST /videos de autenticado sem canal |
| VIDEO_NOT_FOUND | 404 | id inexistente ou vídeo de outro canal, em qualquer rota `/videos/:id` |
| VIDEO_FILE_EMPTY | 422 | POST /videos/:id/upload com `sizeBytes` 0 |
| VIDEO_FILE_TOO_LARGE | 422 | `sizeBytes` ou soma das partes acima de 10000000000 |
| VIDEO_FILE_NOT_VIDEO | 422 | `contentType` que não começa com `video/` |
| VIDEO_FILE_ALREADY_STORED | 409 | POST /videos/:id/upload com `original_storage_key` já preenchida |
| VIDEO_UPLOAD_INCOMPLETE | 409 | complete com partes faltando |
| VIDEO_UPLOAD_NOT_STARTED | 409 | complete sem multipart e sem arquivo |
| VIDEO_PROCESSING_NOT_SCHEDULED | 503 | complete gravou a chave e o Redis recusou o job |
| VIDEO_NOT_READY | 409 | playback ou download com status `draft`, `processing` ou `error` |
| VIDEO_FILE_NOT_STORED | 409 | playback ou download com status `ready` e `original_storage_key` `null` |
| VALIDATION_ERROR | 400 | corpo que falha o ValidationPipe, inclusive campo não previsto |

### Events/Messages

#### video-processing

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** API, no complete que grava `original_storage_key` (per `videos/TD-01`)
**Consumer:** worker em container separado, processo BullMQ `Worker` (per `videos/TD-01`, per `videos/TD-03`)
**Trigger:** o original ficou em `originals/{id}`. O `jobId` é o `id` do vídeo, então o mesmo complete não enfileira um segundo job.
**Delivery semantics:** at-least-once, uma tentativa (per `videos/TD-06`). O worker grava `processing_claim` na passagem `draft` → `processing`. `ready` e `error` só vencem se esse token é o do job. Falha deixa `error`, conserva o objeto e não deixa outro job sobrescrever o desfecho. O worker lê duração e metadados com `ffprobe` e gera a thumbnail com `ffmpeg`, sem biblioteca wrapper (per `videos/TD-03`). A capa vai para `thumbnails/{id}` (per `videos/TD-07`).

---

## Dependency Map

```
SI-03.1 (root)
SI-03.2 (root)
└── SI-03.3 — depends on SI-03.2 (a tabela videos existe antes do rascunho)
    └── SI-03.4 — depends on SI-03.3 e SI-03.1 (rascunho e storage antes do multipart)
        └── SI-03.5 — depends on SI-03.4 e SI-03.1 (multipart e Redis antes do job)
            └── SI-03.6 — depends on SI-03.5 (só assina vídeo ready)
```

---

## Deliverables

- [ ] SI-03.1 — Subir object storage e Redis
- [ ] SI-03.2 — Criar a tabela videos
- [ ] SI-03.3 — Registrar e ler o rascunho
- [ ] SI-03.4 — Abrir e retomar o upload
- [ ] SI-03.5 — Concluir o arquivo e processar
- [ ] SI-03.6 — Entregar reprodução e download

**Full test suites:**

- [ ] Backend tests pass (`cd nestjs-project && docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass (`cd nestjs-project && docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation checks pass (`cd nestjs-project && docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Project builds successfully (`cd nestjs-project && docker compose exec nestjs-api npm run build`)
- [ ] Lint passes (`cd nestjs-project && docker compose exec nestjs-api npm run lint`)
