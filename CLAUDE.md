# CLAUDE.md

## Project Overview

StreamTube — a video sharing platform (YouTube-like). Users can upload, manage, and publish videos. Anonymous users can watch freely; social features (comments, subscriptions, likes) require authentication.

More info in the project overview: [docs/project-plan.md](docs/project-plan.md)

## Repository Structure

This is a monorepo with two main areas:

- `nestjs-project/` — Backend API (NestJS 11, TypeScript, Express). Contains modules for users, channels, videos, comments, etc.
- `docs/` — Project documentation, architecture diagrams, and planning.
- `next-frontend/` — initialized Next.js 16 frontend, authentication UI and BFF

## Videos API

`VideosModule` in `nestjs-project`. The owner authenticates with the same JWT as the rest of the API.

- `POST /videos` — creates one draft on the caller's channel
- `GET /videos/:id` — returns that draft, including `status`, `durationSeconds`, `technicalMetadata`, `thumbnailStored`, and `file`
- `POST /videos/:id/upload` — opens or resumes a multipart upload
- `POST /videos/:id/upload/complete` — stores `originals/{id}` and enqueues processing
- `GET /videos/:id/playback` — presigned URL for the ready original, so the client can send `Range`
- `GET /videos/:id/download` — presigned URL of that same original, with `Content-Disposition: attachment`

Video bytes never pass through NestJS. The maximum is 10,000,000,000 bytes;
5 MiB parts are uploaded directly to storage. The stable `url` field is `/videos/by-url/{token}`, resolving the unique
URL-safe identity token with the same owner checks as `/videos/{id}`. Public
watch pages belong to phase 05.

Internal storage requests use `minio:9000`. Presigned URLs use
`STORAGE_PUBLIC_ENDPOINT` (`http://localhost:9000` for a host browser), signed for
that exact endpoint. Test clients inside Docker use the internal endpoint via the
Jest setup. The queue producer waits at most 5 seconds and returns the documented
503 if scheduling fails; repeating complete can schedule the same video safely.

Processing uses the Compose service `video-worker` and the BullMQ queue `video-processing`. A scheduling failure returns `503` `VIDEO_PROCESSING_NOT_SCHEDULED`. Object storage is the Compose service `minio`, bucket `videos`. Status is `draft`
→ `processing` → `ready`/`error`; media failures keep the original and fail the job.
Terminal stalled jobs reconcile interrupted processing to `error`.

`docker compose up -d --build` in `nestjs-project/` installs locked dependencies,
runs migrations, provisions storage and starts API and worker. Named volumes
persist PostgreSQL, video objects and Redis AOF. Research, plan and audit evidence
are in `docs/phases/phase-03-videos/`; canonical decisions are in
`docs/decisions/technical-decisions-phase-03-videos.md`.

## Architecture (C4 Container Diagram)

See `docs/diagrams/software-arch.mermaid` for the full diagram. Key containers:

- **Frontend** (Next.js) → calls API via REST, streams from Object Storage
- **API** (Nest.js) → business rules, auth, reads/writes DB, signs direct storage uploads, publishes jobs to queue, sends emails
- **Video Worker** (FFmpeg) → consumes jobs from queue, processes videos, updates DB and storage
- **Database** (PostgreSQL) → users, channels, videos, comments, likes
- **Object Storage** (S3/MinIO) → video files and thumbnails
- **Message Queue** (BullMQ no Redis, fila `video-processing`) → video processing job queue
- **Email Service** (SMTP) → account confirmation and password recovery

## Docker Networking

This project runs entirely in Docker containers. When configuring connections between services (database, cache, queue, etc.), **always use the Docker Compose service name** as the host — never `localhost` or `127.0.0.1`.

Inside a container, `localhost` refers to the container itself, not the host machine or other containers. Services communicate through the Docker Compose network using their service names (e.g., `db`, `nestjs-api`).

- **Correct:** `DB_HOST=db` (the Compose service name)
- **Wrong:** `DB_HOST=localhost`

This applies to server-to-server connections. `STORAGE_PUBLIC_ENDPOINT` is the
explicit exception: it describes the client's reachable host for signed URLs,
not a server-to-server connection. Use an externally reachable HTTPS URL in a
remote deployment.

## Working Principles

- **Single Responsibility:** each module, service, and function should have a clear, focused responsibility. Re-evaluate adherence at every step — when a module starts owning logic or entities that are not its own (e.g., a service creating an entity from another domain), extract it immediately into the proper module instead of deferring to a later corrective task.
- **Type Safety:** Strict TypeScript usage across all layers.
- **Testing:** Strong emphasis on pyramid testing at all levels to ensure reliability and maintainability.
- **Code Quality:** Use ESLint and Prettier for consistent code style. Code reviews should focus on readability, maintainability, and adherence to best practices.
- **Documentation:** Comprehensive docs for architecture, setup, and troubleshooting in `docs/`.

## Definition of Done (Technical)

A change is only considered complete when **all** of the following pass:

1. The relevant test suite passes (unit + integration + e2e affected by the change).
2. The full test suite passes before finishing the task.
3. TypeScript compiles cleanly: `npx tsc --noEmit` exits with code 0. Compilation errors must never be left as debt for future tasks.
4. Lint passes: `npm run lint`.

If any of these fails, the task is not done — fix the underlying issue before declaring completion.


## Git Conventions

- **Main branch:** `main` — never commit directly to it
- Branches: `feature/*`, `bugfix/*`, `hotfix/*`, `docs/*`
- **Commits:** short, descriptive messages focused on the "why" of the change
- **Workflow:** Git Flow conventions. Two long-lived branches:
  - `main` — stable, production-ready code 
  - `dev` — integration branch; all feature/bugfix/hotfix branches start from `dev` and merge back into `dev`
  - When `dev` is stable, it is merged into `main`

## Testing Policy

Every change must be tested. During development, run only the tests related to the modified code. Before finishing, always run the full test suite to ensure nothing is broken.

## Scope Limits

- Work on **one feature, fix, or refactoring at a time** — do not mix scopes
- Do not include cosmetic changes (formatting, renaming) alongside functional changes
- If something out of scope comes up during work, note it as a separate task instead of acting on it
- Focus on the defined scope for each task to ensure clarity and maintainability of the codebase.
- If you identify a necessary change that is out of scope, create a new issue or task for it instead of including it in the current work.

## Agent Skill Usage

When working on any task (planning, implementing, debugging, refactoring, 
reviewing, etc.), decompose the request into its underlying subtasks and 
concerns, then identify which available skills match any of them and activate 
those skills.

## Library Documentation Lookup

Before implementing any feature, you MUST use the **context7** MCP tool to look up the relevant library APIs and official documentation.

Always:

- Check the installed library version in the project manifest
- Retrieve the corresponding documentation using context7
- Cross-reference APIs to avoid deprecated or incompatible patterns
- Follow the official documentation over training data

Skip documentation lookup only for trivial operations such as:

- Variable declarations
- Basic control flow
- Simple CRUD using established project patterns

If a library is involved and there is uncertainty, documentation lookup is mandatory.
If the documentation returned does not match the installed version, flag the discrepancy before proceeding.

## Codex foundation

`AGENTS.md` at root and in both subprojects routes Codex to these shared
instructions and the matching `.claude/rules/` files. `.agents/skills/` exposes
all shared skills using relative symlinks. See `docs/ai-foundation-codex.md` for
workflow/tool mappings and MCP configuration. Keep the phase artifact format
identical across tools.

Owner-only metadata reads (`GET /videos/:id` and `/videos/by-url/:token`)
are exempt from the inherited auth throttler so clients can poll processing
status. JWT and ownership checks still apply. Upload/playback commands keep the
existing throttler.
