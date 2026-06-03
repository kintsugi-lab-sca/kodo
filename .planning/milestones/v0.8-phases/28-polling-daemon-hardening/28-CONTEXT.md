# Phase 28: Polling/Daemon Hardening - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar el tech debt operacional v0.7 que dejó al daemon de polling sin observabilidad: (1) `normalizeIssue` (GitHub) y `normalizeWorkItem` (Plane) incluyen `updated_at` + `created_at` canónicos para que `shouldDispatch` evalúe contra timestamps reales en el provider-only path; (2) `kodo polling start --verbose` emite una línea agregada por tick (foreground stdout o daemon logfile); (3) daemon escribe stdout/stderr a `~/.kodo/logs/polling-YYYY-MM-DD.log` con `chmod 0o600` y retención 7 días, capturando cualquier crash (incluido SIGSEGV) via fd redirect en el spawn.

Cero adapters nuevos, cero capacidades nuevas. Pure consolidación de v0.7.

</domain>

<decisions>
## Implementation Decisions

### TaskItem timestamps (POLL-FIX-01)

- **D-01 (overrides D-18 Phase 24):** TaskItem canónico crece de 11 → 13 campos. `updated_at` y `created_at` se añaden a `interface.js` como REQUIRED (string ISO, NO null/undefined). D-18 leak guard se reformula a "EXACTAMENTE 13 fields, zero leaks GitHub-only/Plane-only adicionales (pull_request, assignees, milestone, reactions, etc.)".
- **D-02:** `normalizeIssue` (GitHub) emite `issue.updated_at` y `issue.created_at` directos (GitHub embeds ambos en cada payload — campos siempre presentes para Issues, son ISO 8601 UTC strings).
- **D-03:** `normalizeWorkItem` (Plane) también gana ambos campos en el TaskItem retornado, leídos de `workItem.updated_at` y `workItem.created_at` del payload Plane. El espejo Phase 27 contract matrix exige paridad.
- **D-04:** Phase 27 cross-provider contract matrix (`test/providers/contract.test.js`) gana 2 asserts core nuevos: `task.updated_at` is string ISO + `task.created_at` is string ISO. Pasa de 7 asserts × 2 providers = 14 a 9 × 2 = 18.
- **D-05:** `shouldDispatch(task, prev)` en `src/triggers/polling.js:167-170` ahora opera sobre `task.updated_at` (TaskItem normalizado) en ambos paths (client directo + provider-only). Test `test/triggers/polling.test.js` añade caso provider-only GREEN: provider mock retorna TaskItem CON timestamps → dispatch fires correctamente.
- **D-06:** `extractMaxUpdatedAt` en el cursor cache (`polling.js:288-290`) también lee `task.updated_at` en lugar de `issue.updated_at` cuando el path es provider-only. En el path client directo sigue siendo issue raw (no hay normalización intermedia).

### Semántica de --verbose

- **D-07:** `--verbose` es **ortogonal** a `--daemon`/`--no-daemon`. Activa output por tick en cualquier modo:
  - Foreground (`--no-daemon`) + `--verbose` → escribe summary line a stdout (TTY-formatted o NDJSON según TTY-detect, vía `createFormatter(process.stdout)`).
  - Daemon + `--verbose` → escribe summary line al logfile en nivel info (logfile siempre recibe stdout/stderr crudo del hijo vía fd redirect — ver D-13).
  - Sin `--verbose` → comportamiento silencioso actual preservado (logger NDJSON sigue al sink raíz como hoy).
- **D-08:** `--verbose` se acepta como flag Commander estándar; default `false`. Visible en `kodo polling start --help`.

### Shape del output por tick (DAEMON-01)

- **D-09:** Output via `createFormatter(stream)` (mirror del patrón Phase 14):
  - TTY → columnar humano con colores (timestamp · `polling.tick.summary` · repos=N · dispatched=M · rl=X).
  - No-TTY o `--json` → NDJSON byte-determinístico (preserva DX-06).
  - Daemon logfile → NDJSON siempre (no-TTY).
- **D-10:** Nuevo evento `polling.tick.summary` añadido al closed event taxonomy en `src/logger-events.js`. Shape: `{ts: ISO, event: 'polling.tick.summary', repos_polled: number, total_dispatches: number, rate_limit_remaining: number|null, repos: string[]}`. Se emite AL FINAL del tick (después de iterar todos los repos), una vez por tick.
- **D-11:** `polling.tick` per-repo (existente) se preserva sin cambios — sigue siendo el evento de drill-down. `--verbose` solo imprime el summary; los per-repo siguen al logger NDJSON raíz a nivel debug.
- **D-12:** `rate_limit_remaining` del summary es el mínimo cross-repo dentro del tick (el más conservador). Si ningún repo retornó rate-limit header (e.g., todos 304), valor `null`.

### Logfile lifecycle + rotación (DAEMON-02)

- **D-13:** Captura via **fd redirect en el spawn del padre**. `src/cli/polling.js` (branch daemon) hace `const logFd = openSync(logfilePath, 'a', 0o600)` y pasa `stdio: ['ignore', logFd, logFd]` al `spawn detached`. El hijo escribe normalmente a stdout/stderr; el kernel redirige. Cero código de captura en el hijo. Robusto a crashes catastróficos (SIGSEGV, OOM, throw fuera del event loop) que matan al hijo antes de poder limpiar.
- **D-14:** Filename `polling-YYYY-MM-DD.log` con YYYY-MM-DD = fecha local del día de arranque del daemon. **NO** roll mid-process: si el daemon corre varios días, se queda en el archivo del día de inicio. Trade-off explícito por simplicidad — el operador puede hacer `kodo polling stop && kodo polling start` para rotar manualmente.
- **D-15:** Retención 7 días aplicada **al arrancar el daemon** (`kodo polling start`): scan `~/.kodo/logs/polling-*.log`, borra los que tengan `mtime > 7 días`. Cleanup pasivo, no agresivo (no timer en background).
- **D-16:** Permisos `0o600` aplicados al `openSync` (vía mode argument) — espejo del patrón PID file Phase 26 D-15. Directory `~/.kodo/logs/` se crea con `mkdirSync(..., {recursive: true, mode: 0o700})` si no existe.
- **D-17:** Logfile content = stdout/stderr **crudo** del hijo. Contiene:
  - Stack traces de Node (uncaught exceptions sin handler) → texto crudo.
  - Output `console.error` de fallback (cuando logger no disponible) → texto crudo.
  - Summary lines de `--verbose` cuando `--verbose` activo en daemon → NDJSON.
- **D-18:** El logger NDJSON **sigue al sink raíz** (`~/.kodo/log/kodo-YYYY-MM-DD.ndjson`) sin cambios. Separation of concerns:
  - NDJSON sink raíz = telemetría estructurada (todos los eventos del taxonomy).
  - Logfile daemon = troubleshooting humano del daemon (crashes + verbose).
- `kodo logs --follow` sigue funcionando sin tocar.

### Claude's Discretion

- Estructura interna del módulo nuevo para logfile path resolution + retention sweep (probablemente `src/cli/polling-logfile.js` espejando el patrón de `polling-daemon.js`).
- Test seam para fd redirect (probablemente DI de `openSyncFn` parametrizable o test integration que spawn real y lee el archivo después).
- Test seam para retention sweep (DI de `Date.now()` o `mtimes` mockeables).
- Si el daemon ya estaba corriendo cuando se actualiza POLL-FIX-01 (TaskItem cambia shape), el cache cursor `~/.kodo/polling-state.json` sigue compatible (sólo persiste `last_updated_at` + `etag` per-repo, no shape de TaskItem).
- Numeración v0.7 archive: D-18 leak guard de Phase 24 se documenta como "overridden by Phase 28 D-01" sin re-escribir el archive.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 28 inputs (drivers + tech debt)

- `.planning/REQUIREMENTS.md` §POLL + §DAEMON — REQ-IDs canónicos POLL-FIX-01, DAEMON-01, DAEMON-02 con acceptance criteria.
- `.planning/ROADMAP.md` §"Phase 28: Polling/Daemon Hardening" — Success Criteria observables (4 items).
- `.planning/STATE.md` §"v0.7 Tech Debt (now IN v0.8 scope — Phase 28)" — drivers narrativos: D-18 leak guard Phase 25, T-26-DIAG silent crash.
- `.planning/v0.7-MILESTONE-AUDIT.md` — tech debt items contextualizados con verdict del audit v0.7.

### TaskItem contract + cross-provider matrix (afectados por POLL-FIX-01)

- `src/interface.js` — define `TaskItem` (target del cambio 11 → 13 fields). `TASK_PROVIDER_METHODS` y `VALID_PRIORITIES` también viven aquí.
- `.planning/milestones/v0.7-phases/24-githubprovider-normalizer-registry/24-CONTEXT.md` §"Decisions" — D-07/D-08/D-10/D-11/D-13/D-14/D-16/D-17/D-18 (Phase 24 normalizer contract; D-18 leak guard que esta phase amplía).
- `.planning/milestones/v0.7-phases/27-cross-provider-contract-matrix/27-CONTEXT.md` — contract matrix Plane+GitHub × asserts core (objetivo de extensión).
- `test/providers/contract.test.js` — file que necesita +2 asserts core (updated_at, created_at) × 2 providers.
- `src/providers/github/normalize.js` — `normalizeIssue` (touch target: añadir 2 campos al return shape).
- `src/providers/plane/normalize.js` — `normalizeWorkItem` (touch target paralelo: añadir 2 campos al return shape).

### Polling path + cursor cache

- `src/triggers/polling.js` §`shouldDispatch` (167-170), §`classifyPattern` (180-189), §`processRepo` (223-380) — shouldDispatch firma + provider-only path lectura de timestamps.
- `.planning/milestones/v0.7-phases/25-polling-trigger-channel/25-CONTEXT.md` — D-18 leak guard origen + cursor cache shape.

### Daemon spawn + PID + logfile

- `src/cli/polling.js` §"Daemon path" (228-262) — pre-flight + `spawn detached` con `stdio: 'ignore'` (touch target: fd redirect para logfile).
- `src/cli/polling-daemon.js` — patrón PID file atomic write (template para logfile path resolver + retention sweep).
- `.planning/milestones/v0.7-phases/26-config-wizard-cli-integration/26-CONTEXT.md` — D-15 PID file shape + chmod 0o600 atomic write pattern + T-26-DIAG threat origen.

### Logger taxonomy + NDJSON sink

- `src/logger-events.js` — closed taxonomy (añadir `polling.tick.summary`).
- `src/logger.js` — sink raíz `~/.kodo/log/kodo-YYYY-MM-DD.ndjson` (referencia: separation of concerns vs logfile).
- `src/cli/format.js` — `createFormatter(stream)` (Phase 14) — único productor de color/columnar output. Patrón para D-09.

### Patrones reutilizables (assets)

- `src/cli/format.js` (Phase 14 D-01..D-07) — factory bound methods, eager useColor, TTY→human / no-TTY→bytes-deterministic.
- `src/cli/polling-daemon.js` (Phase 26 D-15) — atomic write tmp+rename+chmod 0o600 + lazy path resolver para HOME-isolated tests.
- `src/triggers/polling.js#saveStateCache` (Phase 25) — atomic write precedente.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`createFormatter(stream, env?)` (`src/cli/format.js`)**: factory canonical para output. Reutilizable directo para `--verbose` foreground stdout. Devuelve bound methods + `formatRow`/`formatTable`. Eager `useColor` resuelto al construir (NO_COLOR > FORCE_COLOR > stream.isTTY).
- **`getPidPath()` + atomic write pattern (`src/cli/polling-daemon.js`)**: Template para `getLogfilePath()` lazy resolver (homedir() en cada llamada) + atomic write tmp+rename+chmod 0o600 — replicable para retention sweep o cualquier I/O a `~/.kodo/logs/`.
- **`saveStateCache(cache, statePath)` (`src/triggers/polling.js:149-154`)**: Atomic write precedente; mismo patrón para escribir logfile metadata si se necesita.
- **`pollingTick(logger, {...})` / `pollingDispatch(logger, {...})` (`src/logger.js` helpers)**: Patrón existente de emit estructurado. `pollingTickSummary` se añade siguiendo el mismo shape.
- **`normalizeWorkItem` (Plane) y `normalizeIssue` (GitHub)**: ambos son funciones puras tipo `(rawPayload, context) → TaskItem`. Añadir 2 fields es cambio aditivo en ambos (touch superficial).

### Established Patterns

- **Closed event taxonomy en `src/logger-events.js`**: cualquier evento nuevo (e.g., `polling.tick.summary`) entra como constante exportada + entry en el manifest. Test `test/logger-events.test.js` ya valida que no se emitan literales.
- **Lazy import W-6 (Phase 26)**: `startPolling`/`providers/registry` se cargan dentro del branch foreground. El logfile path resolver también debe ser lazy via `homedir()` en cada llamada (Pitfall #11 — HOME-isolated tests).
- **Color isolation D-07 (Phase 14)**: cualquier nuevo output con colores DEBE pasar por `createFormatter`. `picocolors` se queda con un solo importador (`src/cli/format.js`). Test guard `test/format-isolation.test.js` lo blinda.
- **`--json` bypass (Phase 15 D-08)**: el helper se early-return cuando `--json` está activo, garantizando bytes idénticos TTY/no-TTY. Aplicable a `--verbose --json`.
- **chmod PRE-rename (Phase 26 D-15)**: permisos restrictivos se aplican al tmp file ANTES del rename, para que cualquier concurrent read post-rename observe 0o600 inmediato.
- **fail-open en cleanup (Phase 19 D-07)**: cualquier I/O secundario en el path normal (e.g., retention sweep al arrancar) NUNCA debe crashear el comando principal. Try/catch silencioso + warn al logger raíz.

### Integration Points

- **`src/cli/polling.js:228-262` (branch daemon)**: punto único de cambio para fd redirect — añadir `openSync(logfilePath, 'a', 0o600)` y pasar fd al `spawn detached`. Pre-flight retention sweep va ANTES del pre-flight PID check (orden: ensure logs dir → retention sweep → PID check → spawn).
- **`src/cli/polling.js#runForegroundPolling`**: punto único para suscribirse al evento `polling.tick.summary` cuando `--verbose` activo → render via `createFormatter(process.stdout)`. Se hace en el path foreground (que es donde `startPolling` corre dentro del proceso).
- **`src/triggers/polling.js` (final del tick agregado)**: punto único de emisión del nuevo evento `polling.tick.summary` — después del loop sobre todos los repos, antes del `setTimeout(tick, intervalMs)`.
- **`src/providers/github/normalize.js#normalizeIssue` + `src/providers/plane/normalize.js#normalizeWorkItem`**: dos touch sites simétricos — añadir 2 fields al return shape de cada uno.
- **`test/providers/contract.test.js`**: +2 asserts core × 2 providers = +4 cases en la matrix. Patrón Phase 27 ya validado.

</code_context>

<specifics>
## Specific Ideas

- AC#1 literal: "formato consistente con `kodo logs`" → mirror exacto de la dual-shape `kodo logs`: TTY columnar humano con colores via `createFormatter`, no-TTY/`--json` NDJSON byte-deterministic. NO inventar formato nuevo.
- AC#2 literal: filename `polling-YYYY-MM-DD.log` con permisos `0o600` — ambos verificables en test integration spawning real daemon que crashea (caso 24-26 cookbook).
- AC#3 literal: `getProvider('github').listPendingTasks()` luego `shouldDispatch(task)` evalúa contra `task.updated_at`/`task.created_at` reales — test paralelo a `test/providers/github/normalize.test.js` + un caso provider-only path GREEN en `test/triggers/polling.test.js`.
- AC#4 literal: suite global ≥780 pass + 0 fail (777 baseline + ≥3 nuevos: 1 normalize + 1 polling provider-only + 1 daemon `--verbose` integration). 1 skip pre-existente preservado.
- Driver real T-26-DIAG: "silent crash sin logfile" — el test integration de DAEMON-02 debe SIMULAR un crash (e.g., daemon que `throw` post-arranque) y assertar logfile contiene stack trace.
- ROMAN-132 (2026-05-15): state.json desync ↔ cmux es Phase 30, NO Phase 28. No mezclar.

</specifics>

<deferred>
## Deferred Ideas

- **Log rolling mid-process a medianoche** → considerado durante D-14 pero rechazado por simplicidad (race con writes pendientes, complejidad en el hijo). Si el operador necesita rotar por día estricto, manualmente: `kodo polling stop && kodo polling start` cada día. Si emerge como pain real, futura phase v0.9+.
- **Size-cap rolling (logrotate-style)** → considerado durante D-14, viola la letra de AC#2 (filename literal `YYYY-MM-DD`). Defer hasta evidencia de archivos grandes problemáticos.
- **Per-process file `polling-{started_at}.log`** → considerado durante D-14, viola la letra de AC#2. Defer.
- **Logger tee a logfile** → considerado durante D-18, rechazado por mayor I/O y violación de "separation of concerns". Si emerge necesidad de "un único logfile con TODO" para soporte, futura phase.
- **`process.on('uncaughtException')` handlers en el hijo** → considerado durante D-13, rechazado en favor de fd redirect puro (más simple, cubre SIGSEGV). Si emerge necesidad de formato estructurado para errores esperados (e.g., level=error con sessionId), futura phase puede añadir handlers ADEMÁS del fd redirect (combinación), pero no se hace ahora.
- **TaskItem.assignees / TaskItem.milestone / TaskItem.reactions** → fuera de scope (no son cross-provider symmetric ni necesarios para shouldDispatch). D-18 (reformulado) sigue siendo leak guard contra estos.

### Reviewed Todos (not folded)

No todos relevantes para Phase 28 (todo.match-phase 28 retornó 0 matches).

</deferred>

---

*Phase: 28-Polling/Daemon Hardening*
*Context gathered: 2026-05-18*
