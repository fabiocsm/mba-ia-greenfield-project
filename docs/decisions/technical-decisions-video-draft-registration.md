---
scope_type: ad-hoc
related_phases: [3]
status: decided
date: 2026-10-21
scope_description: "When the video row is created relative to object storage, for the phase-03 draft pre-registration capability."
---

# Technical Decisions — Video draft registration

_Subprojects in scope:_

- `nestjs-project/` — the command that records the draft and the row it persists. No new library: NestJS and TypeORM are already the stack.
- `next-frontend/` — no open decision. Screens stay out of this phase.

This note does not reopen queue, presigned multipart upload, worker, public URL, streaming, failure handling, or bucket layout. Those stay in `docs/decisions/technical-decisions-phase-03-videos.md`.

---

## TD-01: When the draft row is created

**Scope:** Backend

**Capability:** Pré-cadastro automático do vídeo como rascunho ao iniciar o upload

**Context:** Spec 001 requires exactly one draft, owned by the caller's channel, as soon as a send starts, and that draft must remain identifiable when the file has not arrived. Spec 002 starts only after that draft exists and keeps the bytes off the API. The open choice is which operation inserts the row. URL allocation stays `videos/TD-04`. Multipart upload stays `videos/TD-02`.

**Options:**

### Option A: Register the draft before any storage call
- An authenticated command inserts one `videos` row in status `draft` and returns its identity. Object storage is not called in that command. The later upload addresses that existing row.
- **Pros:** Matches the spec cut: the draft exists with no file, and the upload spec can assume the row. A failed or abandoned upload does not erase the draft. No new library.
- **Cons:** The client makes a registration call and then a separate upload handshake.

### Option B: Insert the row inside the call that opens the multipart upload
- The same request creates the draft and asks storage for the upload id. The response carries both.
- **Pros:** One round trip to start a send.
- **Cons:** Couples registration to storage. Spec 002 says the draft already exists when the send of the file starts. A storage outage would fail registration itself, so the draft would not exist when the file has not arrived.

### Option C: Insert the row only after the object is complete
- The video row is written when every part has been stored.
- **Pros:** No draft without a file.
- **Cons:** Contradicts the requirement that the draft remains identifiable when the file has not arrived. Two simultaneous starts would have nothing to keep unique until the end.

**Recommendation:** Option A — Register the draft before any storage call. It is the only option that keeps the draft alive with no file and leaves the 10GB upload as a later step.

**Decision:** A (Register the draft before any storage call)

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|----------------|--------|
| TD-01 | Backend | When the draft row is created | Option A — Register the draft before any storage call | A |
