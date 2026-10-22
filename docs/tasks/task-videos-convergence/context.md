---
kind: task
name: task-videos-convergence
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-21T14:48:50-03:00"
  docs/decisions/technical-decisions-videos.md: "2026-10-20T17:36:38-03:00"
  docs/decisions/technical-decisions-video-draft-registration.md: "2026-10-21T14:45:28-03:00"
  docs/decisions/technical-decisions-phase-02-auth.md: "2026-10-20T16:03:03-03:00"
  .claude/skills/testing-guide-nestjs-project/SKILL.md: "2026-10-20T16:03:03-03:00"
---

# task-videos-convergence — Context

## Scope

> Fechar as tasks de convergência da Fase 03 no backend nestjs-project. Rejeitar channelId nulo em POST /videos com 400. Documentar no CLAUDE.md da raiz e do nestjs-project as rotas de rascunho, upload, complete, playback e download, a fila video-processing, o serviço video-worker e os campos de status do GET /videos/:id. Acrescentar e2e de POST /videos sem token (401) e com campo não previsto (400). Abortar o multipart quando a soma das partes passa de 10000000000 bytes mesmo se faltar número de parte, e limpar declared_size_bytes e declared_content_type nesse aborto. Concluir o multipart só quando a soma dos bytes iguala declared_size_bytes. O claim draft para processing só vence com original_storage_key não nula. Criar docs/phases/phase-03-videos/library-refs.md com as versões já instaladas de @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, bullmq e ioredis. Provar contra o object storage do Compose que a URL de playback responde 206 a Range e que a URL de download devolve o objeto originals/{id} inteiro. Fazer o script test:e2e de nestjs-project/package.json executar Jest com --runInBand.

## Decisions Index

_No TDs._

## Decisions Detail

_No current-scope TDs._

## Inherited Decisions Detail

### videos/TD-01

**Recommendation:** BullMQ with Redis. The phase asks for a queue that comes up in Compose next to storage and the worker, and BullMQ's Worker is already a separate process.
**Libraries:** —

### videos/TD-02

**Recommendation:** presigned multipart. It keeps the bytes off the API and resume is `ListParts` plus the missing parts.
**Libraries:** —

### videos/TD-03

**Recommendation:** ffmpeg and ffprobe in the worker image. Processing stays in the worker container and does not add a wrapper library.
**Libraries:** —

### videos/TD-04

**Recommendation:** `node:crypto`, stored in `public_url`, with retry on unique violation. It needs no library and still meets the uniqueness rule.
**Libraries:** —

### videos/TD-05

**Recommendation:** presigned GET after the owner and ready checks. Range covers resume-from-a-point, and the API does not carry the file.
**Libraries:** —

### videos/TD-06

**Recommendation:** one attempt, status error, object kept, and a claim token so a duplicate job cannot overwrite the outcome.
**Libraries:** —

### videos/TD-07

**Recommendation:** one bucket `videos`, prefixes `originals/` and `thumbnails/`, keyed by video id.
**Libraries:** —

### video-draft-registration/TD-01

**Recommendation:** Register the draft before any storage call. It is the only option that keeps the draft alive with no file and leaves the 10GB upload as a later step.
**Libraries:** —

### phase-02-auth/TD-06

**Recommendation:** class-validator + class-transformer. Validation stays on the DTO, through the global ValidationPipe.
**Libraries:** class-validator, class-transformer

### phase-02-auth/TD-07

**Recommendation:** Domain exception filter with `{ statusCode, error, message }` and a separate filter for class-validator errors.
**Libraries:** —

## Inherited Conventions

- Backend config uses `@nestjs/config` with namespaced `registerAs(name, () => ({...}))` factories — one file per domain in `src/config/`. _(from phase 01)_
- Env variables are validated by a Joi schema in `src/config/env.validation.ts`, passed to `ConfigModule.forRoot({ validationSchema, validationOptions: { allowUnknown: true, abortEarly: false } })`. _(from phase 01)_
- Config is injected into modules via `ConfigType<typeof xxxConfig>` and `@Inject(xxxConfig.KEY)`; the same factory is importable as a plain function for non-DI contexts (e.g., TypeORM CLI). _(from phase 01)_
- `data-source.ts` loads `.env` via `import 'dotenv/config'` at the top, then imports `databaseConfig` and calls it as a plain function. _(from phase 01)_
- Database connection parameters (host, port, etc.) are sourced from a single `databaseConfig` factory — never duplicated between `AppModule` and `data-source.ts`. _(from phase 01)_
- `TypeOrmModule.forRootAsync` is used (not `forRoot`), with `imports: [ConfigModule]`, `inject: [databaseConfig.KEY]`, `useFactory` returning options including `autoLoadEntities: true`, `synchronize: false`. _(from phase 01)_

## Inherited Deferred Capabilities

_No inherited deferred capabilities._

## Non-UI / Deferred Capabilities

_None._

## Testing Requirements

### nestjs-project

| Artifact type | Required layers |
|---------------|-----------------|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, `select: false` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract |
| Service with DB only (no branching) | Integration: DB contract |
| Service with configured lib (JWT, cache) | Unit: real lib with test config |
| Service with side-effect dep (email, storage) | Integration: real capture service (Mailpit) or local adapter |
| Module with configured imports | Unit: compilation test |
| Controller | E2E only — do NOT write unit tests |
| DTO | E2E: one validation wiring test per endpoint |
| Guard (delegates to service for business logic) | E2E + Unit if complex internal logic |
| Guard (simple, delegates to Passport) | E2E only |
| Strategy (Passport) | E2E via guard |
| Pipe (custom transformation/validation) | Unit |
| Interceptor (response transform, logging) | Unit and/or E2E |
| Exception Filter | Unit + E2E |
| Middleware | E2E |
