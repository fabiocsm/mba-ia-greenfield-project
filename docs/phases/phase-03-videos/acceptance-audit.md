# Phase 03 — Acceptance audit (2026-10-22)

## Research

Baseline: branch `feature/phase-03-videos`, working tree clean, `dev` is an ancestor.
The history contains decisions/research (`e4db8bb`), planning (`7104c99`) and
implementation (`f77dfd7`, `c563d3a`) in that order. Existing SIs and all five
Technical Specifications are present. Baseline backend: 31 suites / 182 tests green.

Reviewed the Compose configuration, migrations, upload transactions, S3 adapter,
BullMQ producer/worker, processing claims, and real storage/HTTP tests. Consulted
Context7 for AWS SDK v3 and BullMQ (see `library-refs.md`).

Confirmed gaps:

- Missing canonical `technical-decisions-phase-03-videos.md` filename.
- No `AGENTS.md` / Codex foundation port.
- Presigned URLs use the Docker-only hostname `minio`.
- The draft's `url` is a token without a corresponding resolvable URL.
- Producer has unlimited Redis retries; its documented 503 can hang.
- Compose API command is `tail`, requires manually installed dependencies and startup.
- No persistent volumes for video objects, database or queue.
- Plan deliverables unchecked although progress says completed.
- Temporary-directory allocation occurs outside the processing error handler.
- The real 10GB smoke completed processing but metadata polling hit the inherited
  auth throttler (10 requests/minute). Status reads need an explicit exemption
  so clients can observe a long-running job without a spurious 429.

## Correction plan

1. Preserve the existing research and SI-03.1–SI-03.6 plan; add the canonical
   decisions entry, document findings and port instructions/skills for Codex.
2. SI-03.1: make Compose install locked dependencies, migrate and start API/worker;
   persist PostgreSQL, Redis and storage. Separate internal storage addressing
   from the endpoint used to sign client URLs.
3. SI-03.5: bound producer queue waits and record processing allocation failures.
   SI-03.3: expose the unique token as a resolvable owner-only resource URL,
   preserving the existing database token and collision protection.
   Exempt the two owner-only metadata GETs from the inherited auth rate limit;
   retain JWT/ownership and limits on upload/playback commands.
4. SI-03.4/SI-03.6: regression tests for external signatures, queue outage, real
   multipart limits, processing, HTTP Range and full downloads.
5. Run full `npm test`, `npm run test:e2e`, `npx tsc --noEmit`, `npm run lint`
   and build in Docker; verify Compose and update validation/progress/checklist
   only with observed results. Record limits of the large-file verification.

## Implementation and verification

Completed. All confirmed gaps above were corrected. Final evidence is in
`validation.md`, `progress.md` and `large-upload-report.json`. The live smoke
transferred and downloaded exactly 10GB, observed draft → processing → ready,
verified three Range/206 responses and matching SHA-256, and recorded zero API
health failures. Only generated smoke originals/thumbnails were removed afterward
to reclaim 10GB; reports and the reproducible script are retained.
