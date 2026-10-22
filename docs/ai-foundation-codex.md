# AI foundation — Codex port

The project keeps one shared instruction source (`CLAUDE.md` at root and in each
subproject). Codex loads `AGENTS.md` at those same scopes, which explicitly imports
the shared source and maps path-scoped rules and workflow artifacts. This avoids
divergent copies of architecture and Definition of Done.

| Claude foundation | Codex convention |
|---|---|
| root / nested `CLAUDE.md` | root / nested `AGENTS.md`, requiring the shared instructions |
| `.claude/rules/*.md` with `paths` | explicit rule routing in `AGENTS.md`; read rules matching edited paths |
| `.claude/skills/*` | checked-in relative symlinks under `.agents/skills/*`, preserving all resources |
| `/research`, `/plan-*`, `/implement-*` | same named skills; read their SKILL.md, retain the existing phase format |
| `.claude/agents/*.md` | reusable read-only task recipes; map Read/Grep/Glob to file reads/rg |
| `.mcp.json` | `.codex/config.toml` project MCP entry for the existing Postgres server |

Codex does not interpret Claude frontmatter permissions or `disable-model-invocation`
as an approval policy. Apply the active runtime permissions and the user's scope.
The port grants no new permission and starts no agent or external service by itself.
Context7 in this audit is supplied by the connected runtime's MCP Docker server;
no extra credentials or guessed local Context7 launch command are stored.

Verification: all `.agents/skills/*/SKILL.md` links resolve within the repository;
the three instruction entry points exist; shared rules, skills and templates stay
in their original locations. Phase 03 research and planning predate implementation
in Git (`e4db8bb`, `7104c99`, then `f77dfd7`). Audit corrections are planned in
`docs/phases/phase-03-videos/acceptance-audit.md` before their implementation.

Official conventions checked on 2026-10-22:
[AGENTS.md discovery](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [repository skills and symlink support](https://learn.chatgpt.com/docs/build-skills).
