---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-10-20
scope_description: "Backend phase 03: queue, direct large-file upload with resume, worker processing, unique video URL, authorized streaming and download, and object-key layout on S3-compatible storage."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — API, database, and the new Compose services for object storage, queue, and the video worker.
- `next-frontend/` — no open decision. Screens, player, and anonymous or public access stay out of this phase.

Storage product is not a decision: S3-compatible API, MinIO in local Docker. NestJS, TypeORM, and the test pyramid are already the project stack and are not TDs.

---

## TD-01: Queue technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** After a video file is stored, processing must run outside the request. The phase requires a real queue and a separate worker container in Compose. Nothing in `nestjs-project/package.json` provides a queue today. PostgreSQL 17 is already in Compose.

**Options:**

### Option A: BullMQ with Redis
- The API adds jobs with BullMQ `Queue`. A worker process uses BullMQ `Worker` and its own Redis connection (`maxRetriesPerRequest: null` in the BullMQ Node quick start). Redis is a new Compose service.
- **Pros:** Queue and worker are separate processes. Retries and concurrency are built in. A queue container is visible in Compose, which matches the phase rubric.
- **Cons:** New Redis service and new libraries (`bullmq`, `ioredis`). Another datastore to back up and test.

### Option B: pg-boss on the existing Postgres
- Jobs live in Postgres. `createQueue`, `send`, and `work` are the core API. A second Node process can call `work` against the same database. Long jobs can send heartbeats; the pg-boss docs show this on a `video-processing` queue.
- **Pros:** No new datastore. Transactions can commit a job together with a row. The worker can still be its own container.
- **Cons:** No dedicated queue container. Workers poll (LISTEN/NOTIFY is optional). Queue load shares the application database.

### Option C: RabbitMQ
- A broker container plus a Node client. The worker consumes from a queue declared on that broker.
- **Pros:** A real broker in Compose. Language-agnostic.
- **Cons:** Another service and another client library, without the Nest-adjacent job API of BullMQ or the zero-new-datastore path of pg-boss.

**Recommendation:** Option A — BullMQ with Redis. The phase asks for a queue that comes up in Compose next to storage and the worker, and BullMQ's Worker is already a separate process.

**Decision:** A (BullMQ with Redis)

---

## TD-02: Upload of up to 10GB with resume

**Scope:** Backend

**Capability:** Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance

**Context:** The file must not pass through the API. If the connection drops, the owner continues from where it stopped. The draft already exists before the bytes arrive. AWS SDK for JavaScript v3 is not installed yet. Its S3 multipart upload uses parts of at least 5 MB and can leave parts in place when a multipart upload fails, which is the resume hook.

**Options:**

### Option A: Presigned S3 multipart upload
- The API calls `CreateMultipartUpload` and returns presigned `UploadPart` URLs for the MinIO object of that draft. The client sends parts straight to storage. On resume, `ListParts` shows what already landed. `CompleteMultipartUpload` runs only when every part is present.
- **Pros:** The API never holds the file. Resume is native to S3. The same API works for MinIO and for S3 later.
- **Cons:** The client must speak multipart (part size, ETags, complete call). Abandoned uploads need an abort rule.

### Option B: tus protocol
- A tus server accepts resumable PATCH uploads and writes the finished object to storage.
- **Pros:** Resume is the protocol. Clients already exist.
- **Cons:** Another server besides MinIO, the API, and the worker. The phase does not need a second upload product.

### Option C: One presigned PUT
- The API signs a single PUT. The client sends the whole object.
- **Pros:** Small API surface.
- **Cons:** A dropped connection starts the 10GB body again. That misses the rule that the owner continues from the last accepted part.

**Recommendation:** Option A — presigned multipart. It keeps the bytes off the API and resume is `ListParts` plus the missing parts.

**Decision:** A (Presigned S3 multipart upload)

---

## TD-03: Worker processing and thumbnail

**Scope:** Backend

**Capability:** Transversal — covers: Processamento automático do vídeo após upload (extração de duração e metadados); Geração automática de thumbnail a partir de um frame do vídeo

**Context:** Processing runs in its own container, after the object is stored, and outside the user's request. The worker must read duration and technical metadata and write one thumbnail taken from a frame of that video. The API process is not a candidate.

**Options:**

### Option A: ffmpeg and ffprobe binaries in the worker image
- The worker downloads the object to a temp file, runs `ffprobe` for duration and metadata, and `ffmpeg` for one frame. The thumbnail goes back to object storage. No npm wrapper.
- **Pros:** The tools that extract media data are the ones in the image. No extra library to version. The container boundary stays obvious.
- **Cons:** The worker must shell out and parse ffprobe's output. Image size grows by the ffmpeg install.

### Option B: fluent-ffmpeg in the worker
- Same binaries, called through the `fluent-ffmpeg` package.
- **Pros:** A Node API instead of hand-built argument lists.
- **Cons:** A library on top of the same binaries. The phase gains a dependency without a new capability.

### Option C: Managed transcoding service
- A cloud API returns duration, metadata, and a thumbnail.
- **Pros:** No ffmpeg in the image.
- **Cons:** Not available in local Compose. The phase requires the worker to run here.

**Recommendation:** Option A — ffmpeg and ffprobe in the worker image. Processing stays in the worker container and does not add a wrapper library.

**Decision:** A (ffmpeg and ffprobe binaries in the worker image)

---

## TD-04: Unique video URL

**Scope:** Backend

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each draft gets its own short URL, distinct from the video id, including when two creates happen together. The column `public_url` is unique. A collision retries, as channel nicknames already do on Postgres `23505`. The character pattern is this decision, not a behavior of the spec. `node:crypto` is already in the runtime. No URL library is installed.

**Options:**

### Option A: nanoid
- A short id from the `nanoid` package, stored in `public_url`, retried on unique violation.
- **Pros:** Built for short, URL-safe ids. Collision odds are well documented.
- **Cons:** A new dependency whose only job is a string the runtime can already make.

### Option B: node:crypto random bytes
- `node:crypto` fills a short buffer. The worker or API encodes it (hex or base64url) into `public_url` and retries on `23505`.
- **Pros:** No new library. Unique constraint still handles two simultaneous creates. Tests can ignore the alphabet.
- **Cons:** Encoding and length are ours to pick inside this option. A poor length raises retries.

### Option C: UUID as the public URL
- The video's UUID is the URL.
- **Pros:** Already unique. No generator.
- **Cons:** The spec asks for a short URL that the owner can tell apart from the video's identity. A UUID is the identity.

**Recommendation:** Option B — `node:crypto`, stored in `public_url`, with retry on unique violation. It needs no library and still meets the uniqueness rule.

**Decision:** B (node:crypto random bytes)

---

## TD-05: Streaming and download

**Scope:** Backend

**Capability:** Transversal — covers: Reprodução via streaming (sem necessidade de download completo); Download do vídeo pelo usuário

**Context:** Only the owner, and only when the video is ready, may watch from the start or from a later point without transferring the skipped prefix, and may download the whole file. Draft, processing, and error are neither streamed nor downloaded. The interface is out of scope. Proxying the whole file through the API is the same failure mode the upload rule rejects.

**Options:**

### Option A: Authorized presigned GET with Range
- The API checks owner and status, then returns a short-lived presigned GET. S3 and MinIO honor `Range` and answer `206`. Download is the same URL without a range, or with a `Content-Disposition` response override. `@aws-sdk/s3-request-presigner` `getSignedUrl` defaults `expiresIn` to 900 seconds.
- **Pros:** Bytes stay on storage. Range is the "continue from a point" behavior. The API still enforces owner and ready.
- **Cons:** The client talks to storage for the bytes. The signature must expire. A leaked URL works until then.

### Option B: API proxies the object with Range
- The API checks owner and status, then streams the object, forwarding `Range` and returning `206`.
- **Pros:** The client never sees storage. One host for auth and bytes.
- **Cons:** A long playback holds an API connection. That repeats the "do not pin the API to the file" rule.

### Option C: HLS packaging in the worker
- The worker writes a playlist and segments. Playback is the playlist, not the original file.
- **Pros:** Adaptive playback later.
- **Cons:** Extra objects, a player, and a packaging step this phase does not require. Download of the original file is a separate path anyway.

**Recommendation:** Option A — presigned GET after the owner and ready checks. Range covers resume-from-a-point, and the API does not carry the file.

**Decision:** A (Authorized presigned GET with Range)

---

## TD-06: Processing failure

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The video moves draft, then processing, then ready or error. On failure the status is error, distinct from ready, and the original object is not deleted. Two runs of the same video must not record ready and error together. Depends on TD-01 for how a job is claimed.

**Options:**

### Option A: Single attempt, then error
- The worker sets processing, then ready, or error. The queue is configured with no automatic retry. A second delivery of the same video id is ignored unless the row is still processing and the worker token matches. The object stays.
- **Pros:** Matches the written failure rule. One row cannot be both ready and error. No hidden retry loop.
- **Cons:** A transient ffmpeg failure needs a later, explicit new attempt. This phase does not define that attempt.

### Option B: Bounded automatic retries, then error
- The queue retries a failed job a fixed number of times, then the worker sets error and keeps the object. The row stays processing until the last failure.
- **Pros:** Transient failures can succeed without a person.
- **Cons:** A retry and a late success can race a terminal error unless the claim token is strict. The spec does not ask for automatic retry.

### Option C: Delete the object on failure
- Error status, and the worker removes the original.
- **Pros:** No orphaned objects.
- **Cons:** Contradicts the rule that a failure must not delete the original quietly.

**Recommendation:** Option A — one attempt, status error, object kept, and a claim token so a duplicate job cannot overwrite the outcome.

**Decision:** A (Single attempt, then error)

---

## TD-07: Bucket and key layout

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** MinIO stores the video object and the generated thumbnail. Keys must not collide across videos. The upload in TD-02 writes the original; the worker in TD-03 writes the thumbnail. The product stays S3-compatible.

**Options:**

### Option A: One bucket, two prefixes
- Bucket `videos`. Original at `originals/{videoId}`. Thumbnail at `thumbnails/{videoId}`. The video row stores both keys.
- **Pros:** One bucket to create in Compose. The video id keeps keys unique. Prefixes separate the two kinds of object.
- **Cons:** One lifecycle policy applies to both prefixes unless filters are added later.

### Option B: Two buckets
- Bucket `videos` for originals and bucket `thumbnails` for images.
- **Pros:** Policies can differ per bucket.
- **Cons:** Two buckets to provision for a distinction a prefix already makes.

### Option C: One prefix per channel
- Keys like `{channelId}/{videoId}`.
- **Pros:** Easy to list a channel's objects.
- **Cons:** The row already knows the channel. Putting the channel in the key does not help uniqueness beyond `videoId`.

**Recommendation:** Option A — one bucket `videos`, prefixes `originals/` and `thumbnails/`, keyed by video id.

**Decision:** A (One bucket, two prefixes)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | Queue technology | A — BullMQ with Redis | A |
| TD-02 | Backend | Upload of up to 10GB with resume | A — Presigned S3 multipart | A |
| TD-03 | Backend | Worker processing and thumbnail | A — ffmpeg and ffprobe in the worker image | A |
| TD-04 | Backend | Unique video URL | B — node:crypto random bytes | B |
| TD-05 | Backend | Streaming and download | A — Authorized presigned GET with Range | A |
| TD-06 | Backend | Processing failure | A — Single attempt, then error | A |
| TD-07 | Backend | Bucket and key layout | A — One bucket, two prefixes | A |


## Acceptance audit — 2026-10-22

All phase decisions are resolved. Draft registration is decided in
[video-draft-registration/TD-01](technical-decisions-video-draft-registration.md):
`POST /videos` persists `draft` before any storage call, followed by the multipart
handshake. This preserves the draft if storage is unavailable.

Operational details of the chosen options:

- TD-01: producer waits at most 5 seconds, uses bounded Redis command retries and
  disables the offline queue; it returns the documented 503 on scheduling failure.
  Worker connections keep unlimited retries for queue consumption.
- TD-02/TD-05: API/worker use `minio:9000` internally. Client URLs are signed for
  `STORAGE_PUBLIC_ENDPOINT` (local host: `http://localhost:9000`), including that
  host in the signature. Never rewrite signed URLs after signing.
- TD-03/TD-06: temporary allocation and media errors persist `error`, keep the
  original and fail the BullMQ job. Terminal stalled jobs also reconcile
  `processing` to `error` (`maxStalledCount: 0`, no implicit media retries).
- TD-07: named volumes preserve PostgreSQL, video objects and Redis AOF across
  container recreation. Initialization installs `package-lock.json` via `npm ci`,
  migrates before API/worker, and provisions the private `videos` bucket.

The stored `public_url` is a persistent, unique URL-safe token. The response
`url` is `/videos/by-url/{token}`, resolved by an owner-only GET to the same
video detail as `/videos/{id}`. Browser watch pages are phase 05. Signed playback
and download URLs are temporary capabilities, separate from that stable identity.
10GB means **10,000,000,000 bytes**, with parts of 5,242,880 bytes (1,908 parts at
the limit). Expired URLs can be renewed through the same handshake.

## PR #1 recovery review — 2026-10-22

These are corrections within TD-01/TD-02/TD-06, preserving the selected options:

- Resume renews URLs for missing parts and for parts with an incorrect expected
  length, including the final part.
- Storage completion and the database commit are separate effects. Complete
  reconciles the immutable `originals/{id}` via HEAD and validates its byte length
  when recovering an interrupted association. An absent aborted upload can be
  reopened without replacing an already completed original.
- A completion retry can reschedule a retained failed job for a draft that was
  never claimed. This is an explicit scheduling retry, not a second media attempt.
- The worker reconciles persisted processing claims with terminal queue jobs on
  startup and periodically. Database outages delay the error write; they do not
  discard it or cause media to run again. Active/waiting jobs and terminal video
  outcomes are preserved.

Correction plan and regression evidence: `../phases/phase-03-videos/pr-review.md`.
