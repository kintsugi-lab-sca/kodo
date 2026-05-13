# Requirements — Milestone v0.7 GitHub Issues Adapter

**Milestone goal:** Validar la arquitectura provider-agnostic de v0.2 implementando GitHub Issues como segundo adapter TaskProvider, con polling trigger channel para uso personal sin infraestructura pública.

**Scope:** 16 requirements en 4 categorías (GH × 5, POLL × 4, CFG × 4, TEST × 3).

---

## v0.7 Requirements

### GitHub Issues adapter core (GH-*)

- [ ] **GH-01** — `GitHubClient` (`src/providers/github/client.js`) implementa REST wrapper sobre `https://api.github.com` con auth `Authorization: token <GITHUB_TOKEN>`; maneja rate limit headers (`X-RateLimit-Remaining` warn cuando < 100); respeta 304 Not Modified para condicional fetch via etag.
- [ ] **GH-02** — `GitHubProvider` (`src/providers/github/provider.js`) implementa los 9 métodos `TaskProvider`: `init`, `getTask`, `listTasks`, `addComment`, `updateTaskState`, `listProjects`, `listLabels`, `listStates` (estados GitHub fijos: `open`/`closed`), `transitionTask`. Contract idéntico al de `PlaneProvider`.
- [ ] **GH-03** — Normalizer GitHub Issue → `TaskItem` canónico: `id` = issue `node_id` (string opaco); `ref` = `<owner>/<repo>#<number>` (human-readable); `title`, `description` = body; `labels` array; `projectId` = `<owner>/<repo>`; `url` = html_url; `priority` derivada de label `priority:high|medium|low` (default `medium`).
- [ ] **GH-04** — Registry update — `src/providers/registry.js` añade factory function para `github` provider con singleton lazy init; tests existentes de registry siguen verdes; bin/kodo arranca con `provider: github` configurado.
- [ ] **GH-05** — Label canonical `kodo` reconocido (mismo gate que Plane); labels secundarias `kodo:sonnet`/`haiku`/`gsd`/`gsd-quick` propagadas a `Session` via `getModelForFlags` / `getGsdMode` existentes (cero cambios en helpers). `parseKodoLabels` sigue siendo provider-agnostic.

### Polling trigger channel (POLL-*)

- [ ] **POLL-01** — `src/triggers/polling.js` ejecuta loop async que pollea cada `poll_interval` segundos (default 60s, configurable via `~/.kodo/config.json`) los repos listados en config; usa GitHub Issues API con filtro `labels=kodo&state=open&since=<cursor>`.
- [ ] **POLL-02** — State cache en `~/.kodo/polling-state.json` persiste `last_updated_at` (ISO) + `etag` por `<owner>/<repo>`; respeta respuesta `304 Not Modified` para ahorrar API quota; el cache es aditivo y migra fail-open (corrupted → reset cursor, no crashea).
- [ ] **POLL-03** — Polling dispara `dispatchTrigger` con `TaskItem` normalizado al detectar: (a) issue nueva con label `kodo`; (b) issue existente que recibió label `kodo`/`kodo:gsd*` desde el último cursor; (c) cambio de estado relevante. Idempotencia: el dispatcher ya gestiona deduplicación via lock per-repo (Phase 8 GSD-10).
- [ ] **POLL-04** — Polling fail-open ante errores transitorios (rate limit `429`, network errors, `5xx`) — log warn + retry exponential backoff (max 3 retries, base 2s); nunca crashea el loop ni el proceso parent. Emite evento NDJSON `polling.error` con `{ owner, repo, status, attempt }`.

### Config wizard + CLI integration (CFG-*)

- [ ] **CFG-01** — `kodo config` reconoce `provider: github`, pide `GITHUB_TOKEN` (guardado en `~/.kodo/.env`, no en config.json), y `repos: [{owner, repo}]` array. Auto-detect del cwd via `git remote get-url origin` (si parsea a github.com URL); ofrece confirmación antes de añadir.
- [ ] **CFG-02** — `~/.kodo/config.json` schema extiende `providers.github` con `repos`, `poll_interval` (default 60), `mcp_hint` (default `"GitHub MCP server"`), `states.review` (default `"closed"`). Migración aditiva — configs v0.6 sin clave `github` siguen leyéndose idéntico (zero breaking change).
- [ ] **CFG-03** — CLI `kodo polling start` arranca el polling loop en background daemon (PID file en `~/.kodo/polling.pid`) o foreground con `--no-daemon`; `kodo polling stop` finaliza vía PID file; `kodo polling status` reporta running/idle. Exit codes deterministas: 0 ok, 1 ya corriendo, 2 no config, 3 stop sin daemon vivo.
- [ ] **CFG-04** — `kodo orchestrator --polling` flag arranca polling integrado en el mismo proceso del orchestrator (sin daemon separado). Ortogonal a `kodo polling start` daemon path — el operador elige uno u otro (NO ambos simultáneos por el mismo repo, sería doble dispatch).

### Integration tests + fixtures (TEST-*)

- [ ] **TEST-01** — `test/providers/github/provider.test.js` — contract tests validando que `GitHubProvider` cumple los 9 métodos `TaskProvider` con fixtures GitHub API offline (`test/fixtures/github/*.json` JSON snapshots de respuestas reales redactadas); zero live API calls; cobertura ≥ 90% de las branches del normalizer.
- [ ] **TEST-02** — `test/triggers/polling.test.js` — integration tests del polling loop con clock mock (override de `setTimeout`/`setInterval` o helper `controlledTime`); verifica detection patterns POLL-03 (a)/(b)/(c), 304 handling POLL-02, fail-open retry POLL-04 sin sleep real (<1s wall time).
- [ ] **TEST-03** — `test/providers/contract.test.js` — provider-agnostic matrix test corriendo el mismo contract suite contra ambos `plane` y `github` providers; valida que el contrato `TaskProvider` se cumple idéntico en los dos adapters (mismas signatures, mismos error shapes); demuestra el invariante v0.2 con uso real ≠ Plane.

---

## Future Requirements (deferred to v0.8+)

- Adapter de ClickUp que implementa `TaskProvider` (v0.8 candidate).
- Adapter local (JSON/Markdown) que implementa `TaskProvider`.
- File watcher trigger para provider local.
- Webhook ingress para GitHub (real-time, requiere ngrok / Cloudflare Tunnel para personal use).
- GitHub Enterprise self-hosted (URL configurable `base_url`).
- OAuth GitHub App (PAT clásico suficiente para personal use).
- Fine-grained PAT per-repo.
- `kodo gsd doctor` para limpiar zombies pre-existentes (worktrees huérfanos, sesiones legacy).

---

## v0.6 Deferred (carried over, but NOT in v0.7 scope)

Documentado en `.planning/milestones/v0.6-MILESTONE-AUDIT.md` — explícitamente fuera de scope v0.7:

- **Phase 19 CR-01** (latent bug): `findSession` no busca en `state.history`. Defer a phase dedicada al lifecycle del SessionRecord.
- **Phase 22 WR-07** (deferred): `markSessionStatus` early-return refactor estructural. Requiere ampliar contrato DI o cambiar tests Phase 16 LOG-13/14/15.
- **Phase 21 WR-04/05/06 advisory**: pureza `syncSkill`, async cleanup en `runSkillSyncCli`, test que invoque `launchOrchestrator` real para cubrir el bloque condicional auto-sync.
- **Phase 15 IN residuales** (no DEBT-04 scope): 5+ items cosméticos preexistentes.

Reabrir en v0.8 si emerge necesidad operativa.

---

## Out of Scope (v0.7 explícito)

- Webhook GitHub ingress — descartado por trigger choice (polling-only en v0.7).
- GitHub Enterprise self-hosted — descartado por host choice (api.github.com only).
- OAuth GitHub App — descartado por auth choice (PAT clásico).
- Multi-tenant / multi-usuario — herramienta personal (preservado de v0.2 Out of Scope).
- Persistencia en base de datos — JSON files siguen siendo suficientes.
- TypeScript migration — JSDoc + @ts-check cubre las necesidades sin build step.
- Dashboard web — CLI sigue siendo suficiente.
- Real-time GitHub webhook dispatch — defer a v0.8+ si demand emerge.

---

## Traceability

Mapped to phases by `gsd-roadmapper` 2026-05-13 — see `ROADMAP.md` for full phase definitions.

| REQ-ID   | Phase    | Status  |
|----------|----------|---------|
| GH-01    | TBD      | pending |
| GH-02    | TBD      | pending |
| GH-03    | TBD      | pending |
| GH-04    | TBD      | pending |
| GH-05    | TBD      | pending |
| POLL-01  | TBD      | pending |
| POLL-02  | TBD      | pending |
| POLL-03  | TBD      | pending |
| POLL-04  | TBD      | pending |
| CFG-01   | TBD      | pending |
| CFG-02   | TBD      | pending |
| CFG-03   | TBD      | pending |
| CFG-04   | TBD      | pending |
| TEST-01  | TBD      | pending |
| TEST-02  | TBD      | pending |
| TEST-03  | TBD      | pending |

**Coverage:** 16 requirements pendientes, mapping a phases TBD por `gsd-roadmapper`.

---

*Created: 2026-05-13 — milestone v0.7 initialized via `/gsd-new-milestone`. Requirements gathered without research (skip — GitHub Issues API es bien documentada, arquitectura provider-agnostic ya validada en v0.2 con Plane). Traceability filled by `gsd-roadmapper` post-write.*
