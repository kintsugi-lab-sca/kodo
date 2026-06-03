# Project Research Summary

**Project:** kodo v0.10 "Higiene y estado real de sesiones"
**Domain:** Node.js CLI — session/task lifecycle hygiene, read-write TUI, cross-provider task-state enrichment
**Researched:** 2026-06-03
**Confidence:** HIGH

---

## Executive Summary

kodo v0.10 entrega tres features orthogonales que convergen en dos puntos de acoplamiento: el módulo de saneo (`doctor.js`) y el contrato del `TaskProvider`. El saneo es la fundación de la que depende el dismiss; el contrato es la fundación de la que depende el enrichment. La arquitectura es aditiva sobre v0.9 — no hay roturas de contrato, no hay dependencias nuevas, no hay endpoints nuevos. Todo el stack necesario (commander, ink@6, react@19, picocolors, Node 20 APIs) ya existe en producción.

La corrección crítica que esta investigación establece: `getTaskState` NO debe añadirse a `TASK_PROVIDER_METHODS`. El loop de validación de `registry.js` lanza para cualquier método ausente — añadir el 10º rompería el arranque del server para cualquier adapter que no lo implemente. El patrón correcto ya está en producción: método opcional + `typeof === 'function'` + campo `supported`, exactamente como `listComments` en v0.9. El contrato canónico permanece en 9 métodos; `getTaskState` es el décimo pero opcional.

El mayor riesgo del milestone es la destrucción accidental de recursos vivos. Doctor corre operaciones destructivas (worktree remove, lock release, log delete) sobre un filesystem y un `state.json` que `reconcileTick` puede estar modificando concurrentemente. Las mitigaciones son: dry-run como default, re-check de `alive` inmediatamente antes de cada acción destructiva, nunca tocar worktrees con `rm -rf` (usar `git worktree remove`/`prune`), y respetar el TTL del lock como red de seguridad contra PID-reuse en macOS. El dismiss de la TUI hereda todos estos guards porque reutiliza el mismo módulo.

---

## Key Findings

### Recommended Stack

**Sin dependencias nuevas — el milestone se construye al 100% con el stack actual de 4 deps prod.** Esta es una restricción verificada en código, no una preferencia. Las libs alternativas consideradas (simple-git, ink-text-input, ink-confirm-input, p-limit, p-queue, lru-cache) resuelven problemas que kodo no tiene a su escala.

**Core technologies:**

| Technology | Purpose | Rationale |
|------------|---------|-----------|
| `commander@^13` | Subcomando `kodo gsd doctor` + flags `--fix`/`--dry-run`/`--json` | Ya parsea todo el CLI; doctor se registra como cualquier otro subcomando |
| `ink@^6.8` + `react@^19.2` | Sub-modo `confirm` en `useInput` para dismiss | `useInput` mode-gated ya tiene 3 sub-modos en `App.js`; `confirm` es el cuarto. No requiere ink@7 (exigiría Node 22) |
| `picocolors@^1.1` | Output de `doctor` (CLI) via `createFormatter(stream)` | Color isolation blindada por `test/format-isolation.test.js`; la TUI usa `<Text color>`, nunca picocolors directamente |
| `node:child_process` | `execFileSync('git', ['worktree', ...])` para doctor | Mismo patrón `gitFn` DI de `stop.js` — testable sin spawnear. No se introduce `simple-git` |
| `Promise.allSettled` + `Map` TTL | Enrichment fail-open de N×getTaskState en `/status` | N = decenas de sesiones activas — `p-limit`/`p-queue` resolverían un problema de escala que kodo no tiene |
| `fetch` global (Node 18+) | `dismissSession()` en `client.js` never-throws | Ya en uso en `client.js`; el DELETE reutiliza el patrón never-throws existente |

**Nota de compatibilidad:** ink@6 floor Node >=20. NO subir a ink@7 (requeriría Node 22 y rompería el `engines` actual). La pareja ink@6 + react@19 ya está validada con 1073 tests en v0.9.

---

### Expected Features

**Must have (table stakes — v0.10 core):**

- `getTaskState(taskId)` como método OPCIONAL del `TaskProvider` — el contrato canónico permanece en 9; la validación del registry no lo toca
- Plane mapping: `group` + substring-match en nombre para `in_review`/`blocked` dentro de `Started` — cero extra API calls
- GitHub mapping: label-convention primaria (etiquetas conteniendo "review"/"block", case-insensitive `String.includes`); `open`→`in_progress`, `closed`→`done` como fallback — aprovecha el payload de `normalizeIssue` existente, sin Timeline API
- Vocabulario normalizado: `in_progress | in_review | blocked | done | unknown` — exactamente 5 valores, ninguno más
- `/status` enrichment: fail-open por fila + cache `provStateCache` TTL ~30s + emit NDJSON en fallo
- `kodo gsd doctor`: dry-run por defecto, `--fix` para mutar, output agrupado por 4 categorías, exit 0=clean/1=problemas
- Módulo `doctor.js` puro+DI (espeja `reconcile.js`): `scan()` + `execute()` con fs/clock/lock inyectables
- Shared helper `dismissSession`/`reapZombie` extraído de doctor — **una sola fuente de saneo**
- Dashboard tecla `d`: guard inverso (`alive===false`), inline footer confirm (`d` again / Esc), never-throws via `client.js`

**Should have (v0.10.x — discuss-phase decisions abiertas):**

- Render de `provider_state` en el dashboard (decisión abierta: columna vs badge vs color semántico; separado del `statusColor` v3)
- Filtro semántico de `provider_state` (`s:review` OR vs prefijo `ps:` — decisión abierta; implementar con `String.includes` sobre el string crudo)
- Header banner degradación cuando TODOS los provider_state fetches fallen (análogo al banner "server caído" de v0.9)

**Defer to post-v0.10:**

- GitHub Option (ii) issue→PR review-state derivation — Timeline API frágil, N+1+, sin endpoint limpio
- Concurrency-capped batched enrichment — solo si N crece suficientemente
- Tabla configurable por workspace de nombre→normalizado
- `doctor --fix` con confirmación interactiva por ítem — YAGNI para herramienta personal

**Anti-features (no construir):**

- Vocabulario extendido (`backlog`/`triage`/`cancelled`/`paused`/`archived`) — una sesión viva no necesita estados pre-sesión
- `doctor` mutando por defecto — es exactamente el bug de `npm doctor` (exit 0 en errores)
- Modal de confirmación para el dismiss — friction excesiva para sesión ya muerta
- Recompute de `alive` en el dashboard — viola el invariante "reconcileTick único escritor"
- ANSI inline en `doctor` o en la TUI — rompe la color-isolation

---

### Architecture Approach

La arquitectura de v0.10 es **aditiva sobre v0.9**: dos módulos nuevos (`src/gsd/doctor.js`, `src/cli/gsd-doctor.js`) y modificaciones quirúrgicas en 7 archivos existentes. El diseño gira en torno a tres patrones bien establecidos en el codebase: (1) módulo puro+DI+never-throws espejando `reconcile.js`, (2) método opcional con capability flag `supported` espejando `listComments`, (3) enrichment fail-open con cache TTL espejando `pendingCache`.

**Major components:**

| Component | Responsibility en v0.10 | Nuevo/Mod |
|-----------|--------------------------|-----------|
| `src/gsd/doctor.js` | Módulo puro de saneo: scan+execute con DI. Único dueño del saneo de worktrees huérfanos, zombies, locks colgados, logs viejos | NUEVO |
| `src/cli/gsd-doctor.js` | Wire del módulo puro al CLI: dry-run/--fix/--json, exit codes deterministas | NUEVO |
| `src/interface.js` | Typedef OPCIONAL `getTaskState` — solo JSDoc. `TASK_PROVIDER_METHODS` permanece en 9 (FROZEN) | MOD mínimo |
| `src/providers/plane/provider.js` | `getTaskState(task)` → normalización group+nombre | MOD |
| `src/providers/github/provider.js` | `getTaskState(task)` → label-convention + open/closed | MOD |
| `src/server.js GET /status` | Enrichment fail-open + `provStateCache` Map TTL por `task_id` | MOD |
| `src/server.js DELETE /sessions` | Amplía de solo `removeSession` a invocar `doctor.execute({taskId})` | MOD |
| `src/cli/dashboard/client.js` | `dismissSession()` never-throws (espeja `fetchStatus`) | MOD |
| `src/cli/dashboard/App.js` | Sub-modo `confirm` con `useInput`; guard inverso `alive===false` para `d` | MOD |
| `src/providers/registry.js` | **SIN CAMBIOS** — loop de 9 métodos intacto | NO TOCAR |
| `src/session/reconcile.js` | **SIN CAMBIOS** — único escritor de `alive` | NO TOCAR |
| `src/hooks/stop.js` | **SIN CAMBIOS** — dueño del cleanup happy-path | NO TOCAR |

**Invariantes que no cambian:**
- `reconcileTick` es el ÚNICO escritor de `alive` — doctor y dismiss NUNCA escriben `alive`
- `provider_state` es un carril paralelo READ-ONLY — no toca `state.json`, no modifica el lifecycle
- Color isolation — `createFormatter` en CLI, `<Text color>` en TUI, cero picocolors en dashboard
- Never-throws en la capa de datos de la TUI — el DELETE pasa por `client.js` never-throws
- Token=0 en server/vigilante — `getTaskState` son HTTP calls, no llamadas al modelo

---

### Critical Pitfalls

**Clase A — Destrucción de datos (irreversible):**

1. **PID reciclado por OS engaña `isPidAlive` → doctor roba lock vivo.** Mitigación: TTL como red de seguridad real (lock con PID "vivo" pero TTL excedido = huérfano seguro). Cross-check PID contra `state.json`. Nunca borrar lock con PID-vivo+TTL-ok.

2. **TOCTOU state: la sesión revive entre el check y el `rm`.** Mitigación: re-verificar `alive` de `state.json` inmediatamente antes de cada acción destructiva. `git worktree remove` (sin `--force`) rechaza árboles con cambios. Si dirty → mover a `.dirty` (patrón de `stop.js`), nunca borrar.

3. **TOCTOU filesystem: `rm -rf` sigue symlinks.** Mitigación: `git worktree remove` (registrados) + `git worktree prune` (metadata stale). `realpathSync` + confirmar target bajo `.bg-shell/`. Reusar `lstatSync`-en-try/catch de `stop.js`.

**Clase B — Violaciones de contrato (rompen startup o TUI):**

4. **Añadir `getTaskState` a `TASK_PROVIDER_METHODS` rompe el registry.** El loop de `registry.js:102-104` lanza para cualquier adapter incompleto. Mitigación: método opcional + `typeof === 'function'` + campo `supported`. El array permanece en 9 (FROZEN).

5. **Throw en el handler de `d` crashea React.** Mitigación: `dismissSession()` en `client.js` never-throws → `{ok:false, error}`; handler de `d` no hace `await` desnudo en `useInput`.

6. **Mutar sobre snapshot stale → dismiss de la fila equivocada.** Mitigación: capturar `task_id` al pulsar `d`, mostrarlo en el prompt, ejecutar DELETE contra ese `task_id`; re-validar `alive===false` al confirmar.

**Clase C — Degradación silenciosa:**

7. **N+1 `getTaskState` por poll → rate-limit exhaust.** Mitigación: `provStateCache` Map TTL ~30s en `/status` server-side. Single-flight por `task_id`. El GitHubClient ya tiene el warn `X-RateLimit-Remaining < 100`.

8. **Fail-open silencioso oculta caídas del provider.** Mitigación: emitir `provider.state.fetch.failed` en NDJSON; distinguir tres estados: ok / unsupported / fetch-failed. Marca de frescura en el cache.

9. **Acoplar lifecycle al vocabulario del provider.** Mitigación: `provider_state` es dato crudo; filtro con `String.includes` case-insensitive; columna/badge separada de `statusColor` v3.

10. **Borrar logs con `--follow` activo / duplicar la retención de 7 días.** Mitigación: "viejo" = mtime > 7 días (mismo umbral del polling-daemon); unlink entero (no truncar); dry-run por defecto.

---

## Implications for Roadmap

### Decisión de orden de fases: DOCTOR-first vs PROVIDER-STATE-first

Esta es la tensión explícita entre los archivos de ARCHITECTURE y PITFALLS que debe resolverse.

**ARCHITECTURE recomienda:** DOCTOR → provider_state chain → DISMISS
- Rationale: DOCTOR es la dependencia de DISMISS. Construir primero entrega valor aislado y establece el módulo que DISMISS reutilizará.

**PITFALLS recomienda:** PROVIDER-STATE → DOCTOR → DISMISS
- Rationale: PROVIDER-STATE toca el contrato (getTaskState, 9→10) y la contract matrix. Hacerlo primero cierra el driver real del milestone (ROMAN-150) antes de que otras fases modifiquen los adapters.

**Veredicto recomendado: PROVIDER-STATE → DOCTOR → DISMISS**

Razones:
1. El driver de negocio del milestone (ROMAN-150: sesión "In Review" invisible) vive en PROVIDER-STATE. Entregarlo primero valida el valor del milestone; DOCTOR y DISMISS son higiene que puede deferirse si PROVIDER-STATE tarda.
2. PROVIDER-STATE y DOCTOR son independientes entre sí (no comparten archivos críticos), por lo que pueden desarrollarse en paralelo si hay bandwidth — pero el contrato del provider debe estar verde antes de que DISMISS lo use.
3. DISMISS depende de DOCTOR en cualquier orden — eso no cambia.

**Tradeoff aceptado:** con PROVIDER-STATE primero, el módulo de saneo no está disponible hasta la segunda fase; el dismiss tarda más. Con DOCTOR primero, la contract matrix lleva más tiempo en estado no-definitivo. El primero es más fácil de gestionar.

---

### Phase 1: PROVIDER-STATE — contrato + providers + enrichment

**Rationale:** Cierra ROMAN-150. Establece el contrato antes de que otras fases modifiquen los adapters.

**Delivers:**
- `getTaskState` opcional en `src/interface.js` (typedef solo — TASK_PROVIDER_METHODS frozen en 9)
- Implementación en `plane/provider.js` (group + nombre substring) y `github/provider.js` (label-convention + open/closed)
- `provStateCache` Map TTL en `src/server.js GET /status` + `Promise.allSettled` fail-open
- Contract matrix extendida: capability-gated para `getTaskState` × 2 providers
- NDJSON `provider.state.fetch.failed` en fail path
- Actualización de `STATE.md`: invariante "9-method contract" → 10 (doc, misma fase)

**Addresses:** Feature provider_state completa (contrato + adapters + server enrichment)

**Avoids pitfalls:** #5 N+1 rate-limit (cache desde el principio), #6 fail-open silencioso (NDJSON desde el principio), #7 acoplamiento al vocabulario, #10 contract matrix rota

**Needs research-phase:** NO — patrones verificados en código.

---

### Phase 2: DOCTOR — módulo puro + CLI

**Rationale:** La dependencia de DISMISS. Entrega valor aislado como herramienta de saneo manual.

**Delivers:**
- `src/gsd/doctor.js`: `scan(deps)` + `execute(findings, deps)` puros+DI
- 4 categorías: worktrees huérfanos, sesiones zombie, locks colgados, logs viejos
- `src/cli/gsd-doctor.js`: dry-run por defecto, `--fix`, `--json`, exit 0/1/2
- Shared helper `dismissSession`/`reapZombie` exportado

**Addresses:** Feature `kodo gsd doctor` completa + helper que DISMISS reutilizará

**Avoids pitfalls:** #1 PID-reuse (TTL como red de seguridad, máquina de acquireGsdLock), #2 TOCTOU state (re-check alive antes de actuar), #3 TOCTOU filesystem (git worktree remove/prune; lstatSync discriminante), #4 borrado de logs activos

**Needs research-phase:** NO — patrones verificados en `stop.js`, `lock.js`, `reconcile.js`.

---

### Phase 3: DISMISS — TUI read-write + server amplification

**Rationale:** La única ruptura de invariante del milestone (TUI read-only → read-write, backlog 999.1). Se construye última porque depende del módulo de doctor y las fundaciones deben estar probadas.

**Delivers:**
- `client.js dismissSession()` never-throws
- `App.js` sub-modo `confirm` en `useInput`: guard inverso, prompt con `task_id`, `d` again / Esc
- `src/server.js DELETE /sessions/{id}` ampliado para invocar `doctor.execute({taskId})`

**Addresses:** Feature dismiss completa + cierre del ciclo doctor-dismiss-single-source

**Avoids pitfalls:** #2 TOCTOU (re-check alive al confirmar), #8 throw en d, #9 fila equivocada

**Needs research-phase:** NO.

---

### Phase 4: RENDER — provider_state en el dashboard (discuss-phase decisions)

**Rationale:** Thin layer sobre los datos de Phase 1. Las decisiones (columna vs badge vs color, semántica del filtro) son discuss-phase.

**Delivers:**
- `format.js`: render de `provider_state` separado de `statusColor` v3
- `select.js`: filtro con `String.includes` case-insensitive sobre el string crudo
- Tres estados visuales: ok / unsupported / fetch-failed (dim + `?`)
- Header banner degradación cuando todos los fetches fallen

**Addresses:** Features render/filtro (v0.10.x)

**Needs discuss-phase:** columna vs badge vs color, semántica del filtro.

---

### Phase Ordering Rationale

- PROVIDER-STATE primero porque el contrato del provider es la fundación cross-feature y ROMAN-150 es el driver del milestone
- DOCTOR segundo porque DISMISS es su único consumidor del shared helper
- DISMISS tercero porque introduce la única ruptura de invariante y depende de ambos anteriores
- RENDER al final porque sus decisiones son discuss-phase y no bloquean los datos
- Paralelismo posible entre PROVIDER-STATE y DOCTOR (no comparten archivos críticos)

### Research Flags

**Ninguna fase necesita `/gsd:plan-phase --research-phase`** — todos los patrones están verificados en código fuente del repo.

**Puntos de discuss-phase (no research):**
- Phase 1: TTL exacto del cache (rango seguro 30s como punto de partida)
- Phase 4: columna vs badge vs color para `provider_state`
- Phase 4: semántica de filtro (`s:review` OR vs prefijo `ps:`)

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verificado contra `package.json`, `node_modules/`, código fuente real. Zero ambiguedad — no hay nuevas deps |
| Features | HIGH | Provider state mapping verificado contra APIs oficiales (Jira/Linear/Plane/GitHub). Doctor conventions verificadas contra brew/flutter/npm/git docs. TUI dismiss conventions MEDIUM (UX guidance) |
| Architecture | HIGH | Grounded en lecturas directas de `interface.js`, `registry.js`, `server.js`, `reconcile.js`, `lock.js`, `stop.js`, `App.js`. Precedente `listComments`/`supported` es código en producción |
| Pitfalls | HIGH | Verificado contra `kill(2)` macOS, `git worktree --help`, `lock.js:isPidAlive`. TOCTOU patterns son reales, no teóricos |

**Overall confidence: HIGH**

### Gaps to Address

- **TTL exacto de `provStateCache`:** ARCHITECTURE sugiere ~10s, PITFALLS sugiere 30-60s. Usar 30s como punto de partida; ajustar en plan-phase.
- **Render decide-phase (columna vs badge vs color):** no bloquea Phase 1; resolver en plan-phase de Phase 4.
- **GitHub `in_review` honestidad:** la label-convention requiere que el operador aplique la etiqueta. Documentar explícitamente en Phase 1 que `in_review` en GitHub es convention-driven, no automático.
- **`STATE.md` invariante "9-method contract" → 10:** doc-work de Phase 1.

---

## Sources

### Primary (HIGH confidence — código verificado)

- `src/interface.js` — TASK_PROVIDER_METHODS frozen en 9 métodos
- `src/providers/registry.js:91-110` — loop all-or-nothing que lanzaría para 10º método
- `src/server.js:19,364-457` — pendingCache, /status pass-through alive, DELETE /sessions, supported precedent
- `src/session/reconcile.js` — patrón puro+DI+never-throws a espejar para doctor
- `src/gsd/lock.js:67-171` — isPidAlive (ESRCH/EPERM), readLock, releaseGsdLock
- `src/hooks/stop.js:237-303` — worktree cleanup fail-open, lstatSync discriminante, move-a-`.dirty`
- `src/cli/dashboard/App.js:402-438` — Enter handler guard alive===true, error-al-footer, sub-modos
- `package.json` + `node_modules/` — stack prod confirmado
- `man 2 kill` (macOS) — ESRCH/EPERM semántica
- `git worktree --help` — prune, remove, locked/prunable

### Secondary (HIGH — fuentes oficiales externas)

- [Plane workflow states](https://docs.plane.so/core-concepts/issues/states) — 5 grupos fixed, custom names
- [Jira statusCategory REST API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-workflow-status-categories/) — 3 buckets
- [Linear configuring workflows](https://linear.app/docs/configuring-workflows) + [Linear Jira](https://linear.app/docs/jira) — unmapped → Triage/keep-last-good
- [Homebrew Manpage](https://docs.brew.sh/Manpage) — doctor report-only + cleanup --dry-run
- [git-worktree docs](https://git-scm.com/docs/git-worktree) — prune --dry-run, locked, prunable
- [npm/cli#1226](https://github.com/npm/cli/issues/1226) — npm doctor exit 0 on error (anti-pattern)

### Tertiary (MEDIUM — community)

- [GitHub community discussion #179613](https://github.com/orgs/community/discussions/179613) — no clean API para PR↔linked issues
- [Flutter troubleshoot](https://docs.flutter.dev/install/troubleshoot) — category-grouped doctor output
- UX guides destructive actions — friction proporcional a reversibilidad

---
*Research completed: 2026-06-03*
*Ready for roadmap: yes*
