# phase-03-videos — Progress

**Status:** completed

The SI notes below are historical implementation observations; the acceptance
audit section records the current environment and supersedes temporary setup
limitations.
**SIs:** 6/6 completed

### SI-03.1 — Subir object storage e Redis
- **Status:** completed
- **Tests:** 7 passing
- **Observations:**
  - As imagens oficiais `minio/minio` e `quay.io/minio/minio` não puxam mais sem login (Docker Hub removeu o repositório; Quay responde 401). O object storage subiu com `pgsty/silo:RELEASE.2026-09-16T00-00-00Z`, fork compatível com a API S3 e com `MINIO_ROOT_*`. O serviço no Compose continua `minio`, e o `mc` cria o bucket `videos`.
  - Não existe `nestjs-project/.env`. As chaves novas estão só no `.env.example`. O boot do Nest falha na validação até um `.env` local incluí-las.

### SI-03.2 — Criar a tabela videos
- **Status:** completed
- **Tests:** 5 passing
- **Observations:**
  - Criado `nestjs-project/.env` a partir do exemplo, com `MAIL_FROM` entre aspas. O arquivo está no `.gitignore`.
  - Os testes que sobem o `Channel` passaram a registrar `Video`, e `cleanAllTables` apaga `videos` antes de `channels`, porque o `@OneToMany` exige a metadata da entidade.
  - `migrations.integration-spec.ts` inclui `CreateVideos` e derruba as tabelas em ordem de FK, mais o enum de `verification_tokens`, para o reset não entrar em deadlock nem falhar no `CREATE TYPE`.

### SI-03.3 — Registrar e ler o rascunho
- **Status:** completed
- **Tests:** 20 passing
- **Observations:**
  - O e2e sobe o `AppModule` no `beforeAll` e só trunca o banco no `beforeEach`, no mesmo formato de `auth.e2e-spec.ts`. O spec pedia bootstrap no `beforeEach`.

### SI-03.4 — Abrir e retomar o upload
- **Status:** completed
- **Tests:** 19 passing
- **Observations:**
  - `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` ficaram em `^3.1123.0`. A árvore atual do registro pede `@aws-sdk/types@^3.975.0`, versão que ainda não existe, então a instalação usou o recorte publicado antes de 2026-09-01.

### SI-03.5 — Concluir o arquivo e processar
- **Status:** completed
- **Tests:** 25 passing
- **Observations:**
  - BullMQ 6 não traz o `ioredis`; ele foi instalado à parte para a fila e o worker subirem.
  - O fixture `test/fixtures/tiny.mp4` foi gerado com o ffmpeg da imagem do worker para o complete real.

### SI-03.6 — Entregar reprodução e download
- **Status:** completed
- **Tests:** 15 passing
- **Observations:** none


## Acceptance audit — 2026-10-22

Corrections were researched and planned in `acceptance-audit.md` before edits.

- SI-03.1: Compose now installs lockfile dependencies, applies migrations and
  starts API and worker. Database/storage/Redis use persistent named volumes.
  Before migration to volumes, the existing database and objects were backed up
  and restored. API has a real HTTP healthcheck; initializers exit 0.
- SI-03.3: unique URL now resolves via owner-only `GET /videos/by-url/:token`;
  both metadata GETs support status polling without the inherited auth limit.
- SI-03.4/SI-03.6: signatures use the client-visible storage endpoint, while
  internal calls and test clients retain Compose service DNS.
- SI-03.5: actual unreachable Redis yields bounded 503; resubmitting complete
  schedules the preserved original. Allocation/media failures set error and fail
  the job; interrupted terminal jobs also reconcile processing to error.
- Foundation: root/backend/frontend `AGENTS.md`, 23 resolving shared skill links
  under `.agents/skills`, Codex MCP configuration and documented tool mappings.
- Canonical decisions file and all required phase artifacts present. The plan
  keeps six SIs, all five Technical Specifications, dependency map and deliverables.
- OpenAPI re-exported with video contracts and the resolvable URL route.

### Definition of Done

All commands ran in `nestjs-api`, sequentially for suites sharing the database:

| Gate | Result |
|---|---|
| `npm test` | 33 suites, 185 tests passed (script enforces runInBand) |
| `npm run test:e2e` | 7 suites, 88 tests passed |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | exit 0 |
| `npm run openapi:export` | exit 0 |

Large-file smoke evidence is recorded in `validation.md` and `large-upload-report.json`.
Do not build (deleteOutDir) concurrently with requests against the dev server;
finish build and restart the API before the live smoke. Tests themselves boot
isolated HTTP applications inside Jest; do not run them concurrently with the
large-file smoke because they clean the shared development database.

## PR #1 review — 2026-10-22

Four recovery defects were fixed: interrupted storage/database completion,
retained failed jobs before claim, incorrectly sized parts omitted during resume,
and terminal processing status lost during database outages. Research and the
correction plan precede the fixes in `pr-review.md`; all existing SI decisions and
public contracts are preserved. An independent delta review found no remaining
actionable regressions. Test-only typing errors found by lint were corrected.

Final Docker gates: 35 suites / 218 unit/integration tests, 7 suites / 91 E2E
tests, TypeScript, lint and build all passed. API and worker were restarted after
build. The real 11,000,000-byte / three-part upload resumed, processed to ready,
and passed thumbnail, Range/206 and full-download SHA-256 checks with zero health
failures. Evidence: `pr-review.md` and `pr-review-smoke-report.json`. The earlier
10GB acceptance report remains historical; this review did not repeat it.
