---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
validated_at: "2026-10-22"
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-10-22T02:42:49-03:00"
  docs/phases/phase-03-videos/phase-03-videos.md: "2026-10-22T02:36:46-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-10-22T02:36:46-03:00"
  docs/decisions/technical-decisions-video-draft-registration.md: "2026-10-22T02:08:26-03:00"
  nestjs-project/package.json: "2026-10-22T02:09:57-03:00"
  nestjs-project/compose.yaml: "2026-10-22T02:06:26-03:00"
issues: []
advisories: []
---

# phase-03-videos — Validation

PR #1 recovery review is complete: all four findings in `pr-review.md` are fixed
and the combined delta was independently reviewed. Final Docker verification:
35 suites / 218 unit/integration tests, 7 suites / 91 E2E tests, TypeScript, lint
and build passed. Real 11MB multipart/worker/thumbnail/Range/download verification
passed (`pr-review-smoke-report.json`). The 10GB acceptance results below remain
historical; that large smoke was not rerun for this review.

## Findings

No unresolved inconsistency, ambiguity, missing decision, dependency gap,
inherited constraint conflict or open question remains against the acceptance
criteria. The video UI and public watch pages belong to later phases; this phase
delivers the backend and direct storage streaming.

## Acceptance evidence

| Mandatory criterion | Evidence / result |
|---|---|
| Resolved, justified decisions | docs/decisions/technical-decisions-phase-03-videos.md: queue, multipart, FFmpeg, URL uniqueness, Range/download, failure lifecycle and bucket layout; draft registration explicitly decided before storage |
| Required phase artifacts | context, validation (clean), phase plan, progress and library-refs present in this directory |
| Plan format | SI-03.1–SI-03.6; Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages; Dependency Map; checked Deliverables |
| Research → planning → implementation | Git e4db8bb (decisions), 7104c99 (plan), f77dfd7 / c563d3a (implementation). Audit research and correction plan recorded in acceptance-audit.md before corrections |
| Upload up to 10GB, API responsive, draft first | Actual 10,000,000,000-byte multipart transfer: 1,908 parts, 32.945 s; draft read before upload and first-part resume checked. 199 API health probes during upload/processing, zero failures, maximum 44.276 ms |
| Automatic metadata and thumbnail | Real separate worker reached ready in 9.944 s after upload; duration 1 s, stream metadata and thumbnail stored. E2E downloads the generated JPEG and checks its header/content type |
| Unique, resolvable URL | Unique DB constraint plus collision retry and concurrent-create tests; /videos/by-url/{token} resolves the same video, requires JWT and owner, returns 404 for other owners / unknown tokens |
| Streaming and download | Actual 206 for 1,024-byte ranges at offsets 0, 5,000,000,000 and 9,999,998,976. Full download: 10,000,000,000 bytes, attachment, SHA-256 matches the generated source |
| Status in DB | Observed draft → processing → ready for 10GB. E2E corrupt-media path reaches error and preserves original. DB integration covers claims, terminal protection and interrupted-worker reconciliation |
| Compose infrastructure | docker compose up -d --build succeeded. API, db, redis, minio, mailpit and video-worker running; API/db/redis/storage healthy. dependencies, migrate and minio-init exited 0. pg_isready: accepting connections; Redis: PONG |
| Migration / channel relation | CreateVideos migration and migration suite pass; videos.channel_id FK, ManyToOne / inverse OneToMany, UNIQUE public_url, status CHECK |
| Appropriate green test levels | Unit, real DB/storage integration and HTTP E2E. 33 suites / 185 tests plus 7 E2E suites / 88 tests passed |
| Full Definition of Done | npm test, npm run test:e2e, npx tsc --noEmit, npm run lint and npm run build all exit 0 inside Docker |
| Git Flow | Current branch feature/phase-03-videos; merge-base with dev is 8459b2f3a9c0dcad4bd0f31972761c00c52609a1 (the dev tip). main remains at that original commit. No commit to main |
| Shared instructions / Codex port | CLAUDE.md and backend instructions match implementation; root/backend/frontend AGENTS.md, 23 valid shared skill symlinks, Codex MCP config and docs/ai-foundation-codex.md |

## Commands and results

Run from nestjs-project/ (all npm/npx commands execute inside nestjs-api):

```bash
docker compose up -d --build
docker compose exec -T nestjs-api npm test
docker compose exec -T nestjs-api npm run test:e2e
docker compose exec -T nestjs-api npx tsc --noEmit
docker compose exec -T nestjs-api npm run lint
docker compose exec -T nestjs-api npm run build
docker compose exec -T nestjs-api npm run openapi:export
```

All exited 0. npm test enforces --runInBand, avoiding shared DB races. The
OpenAPI export includes video contracts and the stable URL resolver.

Real smoke, **on the host after build and API restart**, with no Jest suite
running concurrently:

```bash
python3 scripts/smoke-video-upload.py --report /tmp/phase03-10gb.json
```

Exit 0. Preserved machine-readable evidence:
[large-upload-report.json](large-upload-report.json). The fixture is a valid
one-second MP4 padded to exactly 10GB; every byte was transmitted to storage,
read by the worker and downloaded/hashed. This measures local Compose behavior
and the exact size boundary, not remote network throughput or every video codec.
The generated 10GB original, thumbnail and video row were removed after validation
to reclaim space. The script retains its own sample by default for inspection.

## Resolved Issues

- Added the exact canonical decisions filename; retained a legacy redirect.
- Ported the AI foundation to discoverable Codex conventions with shared sources.
- Signed externally reachable client URLs separately from Docker storage calls.
- Replaced manual API startup with Compose dependency/migration/start sequencing.
- Added persistent object, database and Redis AOF volumes; backed up/restored
  existing database and objects before moving them.
- Bounded actual Redis scheduling failures, with 503 and safe complete retry.
- Covered allocation failures and interrupted workers in the processing lifecycle.
- Made the unique token a resolvable owner-only URL.
- Allowed owner-only metadata polling without the inherited auth throttle.
- Checked actual thumbnail content, 10GB multipart pagination/resume, HTTP Range
  and byte-exact full download; refreshed plan, progress, library references and
  shared documentation.

## Automatic rejection audit

No listed rejection condition remains: workflow artifacts and SIs/specifications
exist, validation is clean, media never traverses the API, real storage/queue/
worker run in Compose, all mandatory gates pass, work is on a feature branch from
dev, shared instructions match the code, and the Codex foundation port is present.
