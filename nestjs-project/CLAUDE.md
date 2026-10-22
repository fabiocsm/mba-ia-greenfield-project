# CLAUDE.md

## Environment Startup Verification

For infrastructure alone, name the services explicitly:

```bash
docker compose up -d db redis minio minio-init mailpit
docker compose ps
docker compose exec db pg_isready -U streamtube
docker compose exec redis redis-cli ping
```

For the complete backend (including phase 03 acceptance verification):

```bash
# First checkout only: create .env from the committed example
cp .env.example .env
docker compose up -d --build
docker compose ps
curl --fail http://localhost:3000/
```

Compose runs `dependencies` (`npm ci`), then `migrate` (`npm run migration:run`),
then API (`npm run start:dev`) and worker. One-shot initializer containers exiting
0 is expected. Never start a second API server using `exec`. Server-to-server
hosts are `db`, `redis`, `minio`, `mailpit`. Named volumes persist database,
objects and Redis AOF; do not use `down -v` to stop the environment.

## Development Environment

All npm/npx/node commands run inside Docker. Services:

- `nestjs-api` — NestJS API, port `3000`, HTTP healthcheck
- `db` — PostgreSQL 17, port `5432`, database/user/password `streamtube`
- `redis` — BullMQ queue `video-processing`, port `6379`, AOF enabled
- `minio` — S3-compatible storage (`pgsty/silo`), bucket `videos`, ports `9000/9001`
- `video-worker` — BullMQ consumer, ffprobe metadata and ffmpeg thumbnail
- `mailpit` — SMTP capture, ports `1025/8025`

## Videos

Owner JWT protects every video route:

- `POST /videos` persists `draft` before storage, returns unique resolvable `url` (`/videos/by-url/{token}`)
- `GET /videos/:id` returns status, durationSeconds, technicalMetadata,
  thumbnailStored and file association
- `POST /videos/:id/upload` opens/resumes multipart and signs missing parts
- `POST /videos/:id/upload/complete` stores `originals/{id}` and enqueues processing
- `GET /videos/:id/playback` signs the ready original; storage supports Range/206
- `GET /videos/:id/download` signs that same original as an attachment

Maximum: 10,000,000,000 bytes; parts: 5,242,880 bytes (last part may be smaller).
Video bytes go directly to storage. API/worker use `STORAGE_ENDPOINT=minio`;
client signatures use `STORAGE_PUBLIC_ENDPOINT` (host browser: localhost:9000).
Jest uses internal service DNS via `test/storage-endpoint.setup.ts`.

The worker persists `draft` → `processing` → `ready`/`error`. A media failure
keeps the original and fails the job. Terminal stalled jobs also set `error`.
A producer failure returns `503 VIDEO_PROCESSING_NOT_SCHEDULED` within a bounded
wait (5 seconds for scheduling); complete can be repeated safely. Claim tokens
prevent a duplicate from changing a terminal result.

When storage completion succeeds before an interrupted database write, complete
reconciles `originals/{id}` through HEAD and checks its declared byte length.
Resume offers replacement URLs for parts with incorrect lengths. A retained job
that failed before claiming a draft can be explicitly rescheduled by complete;
the single media attempt policy still applies. Worker startup and periodic
reconciliation compare processing claims with terminal queue jobs and retry status
persistence after a database outage, preserving ready/error outcomes.

Teardown: `docker compose down` preserves the named volumes.

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server (already started by Compose; do not start a second instance)
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.

Owner-only metadata reads (`GET /videos/:id` and `/videos/by-url/:token`)
are exempt from the inherited auth throttler so clients can poll processing
status. JWT and ownership checks still apply. Upload/playback commands keep the
existing throttler.
