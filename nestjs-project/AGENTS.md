# Backend instructions for Codex

Read [CLAUDE.md](CLAUDE.md) in this directory and the repository root instructions.
They are the shared source of truth for Docker commands, architecture and testing.

Before changing TypeScript, read applicable rules in `../.claude/rules/`:
`typescript-strict`, `nestjs-common-conventions`, `nestjs-layer-separation`, plus
the artifact-specific controller/service/module/entity/DTO/testing, TypeORM or JWT
rules. Read `../.agents/skills/testing-guide-nestjs-project/SKILL.md` and its
relevant artifact recipe when changing tests; use `nestjs-best-practices` for
NestJS architecture.

Run npm, npx, node, compilation and tests inside the Compose container. For the
full backend use `docker compose up -d --build`; dependencies and migrations run
before API and worker. To start infrastructure alone name the services explicitly:
`docker compose up -d db redis minio minio-init mailpit`.

Video lifecycle: `draft` → `processing` → `ready`/`error`. Video bytes go directly
between client and storage; internal calls use `minio`, signatures use the public
endpoint. Keep owner checks, queue wait limits and processing claim guards intact.
