# Codex project foundation

Read and follow [CLAUDE.md](CLAUDE.md), the shared project instructions. Read the
nested `AGENTS.md` before working in either subproject. User instructions take
precedence. Keep work on `feature/*` from `dev`; never commit directly to `main`.

## Workflow

Preserve the research → planning → implementation sequence and its evidence.
Phase 03 uses `docs/decisions/technical-decisions-phase-03-videos.md` and
`docs/phases/phase-03-videos/{context,validation,phase-03-videos,progress,library-refs}.md`.
Plans require SIs `SI-03.x`, Technical Specifications (Data Model, API Contracts,
Authorization Matrix, Error Catalog, Events/Messages), Dependency Map and
Deliverables. Mark validation `clean` only after resolving findings and checking
the code. Record actual commands and results; never invent verification.

## Shared rules and skills

Skills are exposed through `.agents/skills/*` as relative symlinks to the complete
`.claude/skills/*` directories, including templates and references. Read the
matching `SKILL.md` before applying a workflow. Explicit Claude slash commands map
to the same skill names in Codex (for example `$research`, `$plan-phase`,
`$implement-phase`); do not assume Claude-specific tool names are callable.

Before editing, read matching `.claude/rules/*.md` using each rule's `paths`
frontmatter. Codex does not automatically load these path-scoped rules. Readers
in `.claude/agents/*.md` remain reusable task instructions: use repository search
and file reads for Read/Grep/Glob. Delegate only when the user or an applied
workflow authorizes delegation and the runtime supports it.

Use available Context7 tools to resolve library IDs and fetch documentation before
library changes. `.mcp.json` is Claude-specific; Codex MCP configuration is described
in `docs/ai-foundation-codex.md`.

## Videos

Pre-register `draft`, upload directly to S3 using signed multipart URLs (maximum
10,000,000,000 bytes), then complete and publish `video-processing`. Never proxy
video bytes through the API. The separate worker persists `processing` then
`ready`/`error`, duration, metadata and thumbnail. API/worker use Docker service
DNS; URLs sent to clients use `STORAGE_PUBLIC_ENDPOINT`. The stable `url` path resolves through `GET /videos/by-url/:token`.
Owners alone receive playback/download signatures after `ready`; storage handles Range/206.

## Required verification

In `nestjs-project/`, run every npm/npx/node command inside `nestjs-api`:
`npm test -- --runInBand`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run lint`.
Also verify Compose services and the real worker/storage flow. Shared-database
test suites must run sequentially. Update phase evidence and shared instructions
when behavior changes.

Owner-only metadata reads (`GET /videos/:id` and `/videos/by-url/:token`)
are exempt from the inherited auth throttler so clients can poll processing
status. JWT and ownership checks still apply. Upload/playback commands keep the
existing throttler.
