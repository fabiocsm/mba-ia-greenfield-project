# PR #1 — Review and correction plan (2026-10-22)

## Scope and baseline

Reviewed `8459b2f..2830ea3` on `feature/phase-03-videos`; the local `dev`
and PR base `main` both point to `8459b2f`. The initial working tree was clean
(snapshot `89f7c7ba79844cbe1dbcc7579ed056f953afa01d`).
The existing research → planning → implementation history is preserved.

Baseline commands, executed sequentially inside `nestjs-api`:

- `npm test -- --runInBand`: 33 suites / 185 tests passed.
- `npm run test:e2e`: 7 suites / 88 tests passed.

## Verified findings and planned fixes

| ID | Priority | Failure | Correction / regression coverage |
|---|---|---|---|
| R1-1 | P2 | S3 completion consumes the upload before the database transaction commits; retry gets `NoSuchUpload` after a lost response or DB failure. | Reconcile the immutable per-video original through HEAD, check its declared size, and associate/schedule it on retry. Test real storage completion followed by a rolled-back DB write. |
| R1-2 | P2 | A job that fails before claiming a draft remains under its video ID; a repeated complete silently deduplicates against the failed job. | Explicitly reschedule retained failed jobs when scheduling a draft; keep waiting/active jobs deduplicated and bounded scheduling. Test against real Redis. |
| R1-3 | P2 | Resume omits existing part numbers even when those parts contain fewer bytes than required; complete rejects forever after the original URL expires. | Re-sign parts whose stored lengths differ from their expected lengths. Test replacement of an incorrect part through real storage/HTTP. |
| R1-4 | P2 | After a processing claim, a database outage can defeat both the error write and the worker's one-shot failed-event handler, leaving `processing` forever. | Reconcile persisted processing claims against retained terminal failed jobs on worker startup and periodically; retry status persistence after database recovery without another media attempt. |

## Research before corrections

Context7 resolved and retrieved `/aws/aws-sdk-js-v3`, `/taskforcesh/bullmq`,
and `/websites/ffmpeg_documentation` before implementation. Installed versions
remain AWS SDK 3.1123.0, BullMQ 6.4.0 and FFmpeg 5.1.9; Context7's BullMQ
repository advertises v6.3.11, so installed declarations/source and real Redis
behavior also govern the correction. No dependency upgrade is planned.

## Verification plan

Add reproducing regression tests, implement each correction with the smallest
relevant change, review the combined delta, and run the required full tests,
TypeScript and lint inside `nestjs-api`. Check Compose health and a real
multipart → worker → ready → Range/download flow. Database suites and live
smoke must run sequentially. Record observed results here and in phase evidence
before committing and pushing to the PR branch.

## Results

All four findings are accepted and fixed. One correction iteration was followed
by an independent review of the combined source/test delta, with no remaining
actionable defects found. No schema, dependency or public DTO changes were needed.

| Finding | Regression evidence | Final disposition |
|---|---|---|
| R1-1 | Before correction: 6 focused failures / 18 passes. After: 3 focused suites / 26 passes. Real S3 complete/abort followed by injected response loss rolls back the DB; HTTP retries recover and reach ready. Missing HEAD returns null; forbidden HEAD propagates 403; mismatched object sizes are refused. | Fixed, including the stale-aborted-upload sibling. |
| R1-2 | Before correction: 2 queue regressions failed / 2 passed. After: 5 real Redis tests pass, including concurrent retries, waiting/active deduplication, first-delivery one-attempt behavior and unreachable Redis. Test queues have isolated prefixes. | Fixed; the existing 5-second scheduling bound remains. |
| R1-3 | Before correction: 3 focused failures / 7 passes. After: 10 focused passes; real HTTP short PUT → complete 409 → renewed replacement URL → corrected PUT → complete 200 and byte-identical original passes. | Fixed for first and final parts. |
| R1-4 | 9 unit tests and 6 PostgreSQL/isolated-Redis integration cases cover retry after transient persistence failure, startup-style recovery, failed/completed jobs, active/waiting jobs, terminal video states and stale claims. | Fixed with startup and non-overlapping periodic reconciliation every 5 seconds. |

### Cross-fix review and hardening

- H1-1: the first lint run reported 8 unsafe-value errors in two new test
  fixtures. Explicit types at the bound/generic library calls removed them;
  full lint and both full test suites were rerun successfully afterward.
- Avoided an implicit initial queue retry: inspect a retained failed job before
  adding a new job. A new job that fails before enqueue returns still has one
  attempt. Concurrent explicit retries tolerate only BullMQ's state-race error.
- A stale concurrent complete may finish a duplicate without changing an existing
  processing claim. Reconciliation handles both failed and completed jobs with
  such a claim; updates still require the original claim and processing status.
- Reviewed ownership, ready-only signatures, S3 error propagation and immutable
  key preservation. No authorization regression was found.

### Final gates

All npm/npx commands ran inside `nestjs-api`. Shared DB suites ran sequentially.
The final lint/test/build gate snapshot was
`12963bfa96a4102411a86ce503de01112e4142dd`; the post-gate snapshot matched it.

| Command | Observed result |
|---|---|
| `docker compose exec -T nestjs-api npm run lint` | Exit 0 after H1-1 correction. |
| `docker compose exec -T nestjs-api npm test -- --runInBand` | 35 suites / 218 tests passed. |
| `docker compose exec -T nestjs-api npm run test:e2e` | 7 suites / 91 tests passed. |
| `docker compose exec -T nestjs-api npx tsc --noEmit` | Exit 0. |
| `docker compose exec -T nestjs-api npm run build` | Exit 0. |
| `git diff --check origin/main 12963bfa96a4102411a86ce503de01112e4142dd` | Exit 0 from repository root. |

Expected 500 logs in the new HTTP regressions are the deliberately injected lost
storage responses; both tests assert recovery afterward. Existing Node localstorage
and pg concurrent-query deprecation warnings did not fail the suites.

### Live Compose verification

After build, restarted API and worker, waited for the HTTP health endpoint and ran:

`python3 scripts/smoke-video-upload.py --size 11000000 --report /Users/fabiocsm/workspace/mba-ia-greenfield-project/docs/phases/phase-03-videos/pr-review-smoke-report.json`

The host smoke used HTTP registration/email confirmation, direct signed multipart
PUTs, resume, the real queue and worker, owner polling, thumbnail metadata,
Range playback and full attachment download. It passed with 11,000,000 bytes in
3 parts, draft → processing → ready, three Range/206 responses and matching
SHA-256. Two health samples had zero failures (max 5.165 ms). Upload took 0.080 s
and processing 0.222 s; these are local observations, not performance guarantees.
The small smoke original/thumbnail are retained for inspection.

`docker compose ps -a` confirmed the running services and initializer exits 0;
`pg_isready -U streamtube`, `redis-cli ping` and `mc ready local` passed. An
immediate HTTP probe during restart first got a transient connection reset;
the retrying readiness probe then passed before the smoke started.

This review reran an 11MB smoke. The original 10GB report remains historical
acceptance evidence and was not rerun or relabeled as a review result.

The only tracked edits after the gate snapshot are phase context, results and
evidence. No unresolved accepted findings or decision-blocking findings remain.
