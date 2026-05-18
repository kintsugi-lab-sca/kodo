# Phase 28: Polling/Daemon Hardening — Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 9 (6 modified + 3 created/probable)
**Analogs found:** 9/9 (todos los archivos tienen analog directo en el repo — Phase 28 es consolidación pura, cero green-field)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/interface.js` (MOD) | type-contract | none (typedef + frozen consts) | self (extensión aditiva del propio TaskItem typedef) | exact (auto-analog) |
| `src/providers/github/normalize.js` (MOD) | normalizer / pure transform | request-response (raw payload → TaskItem) | `src/providers/plane/normalize.js#normalizeWorkItem` | exact (mirror cross-provider) |
| `src/providers/plane/normalize.js` (MOD) | normalizer / pure transform | request-response (raw payload → TaskItem) | `src/providers/github/normalize.js#normalizeIssue` | exact (mirror cross-provider) |
| `src/triggers/polling.js` (MOD) | trigger / event-driven loop | event-driven (tick → emit) | self §`processRepo` + §`saveStateCache` | exact (extensión aditiva) |
| `src/logger-events.js` (MOD) | taxonomy / pure transform | event-driven (fields → record) | self §`pollingTick` / §`githubApiCall` | exact (mirror taxonomy entry) |
| `src/cli/polling.js` (MOD) | CLI handler / process spawn | request-response + spawn-fork | self §`runPollingStartCli` / §`runForegroundPolling` | exact (extensión del branch daemon) |
| `src/cli/polling-logfile.js` (NEW probable) | utility / FS-I/O | file-I/O (path resolve + retention sweep) | `src/cli/polling-daemon.js` | exact (mirror lazy resolver + atomic) |
| `test/providers/contract.test.js` (MOD) | test / contract matrix | request-response (provider × asserts) | self (extensión: +2 asserts × 2 providers) | exact |
| `test/providers/github/normalize.test.js` (MOD) | test / normalizer | request-response | self (extensión aditiva 2 asserts) | exact |
| `test/triggers/polling.test.js` (MOD) | test / loop coverage | event-driven con clock virtual | self (extensión 1 caso provider-only GREEN + 1 caso summary) | exact |
| `test/cli/polling-logfile.test.js` (NEW probable) | test / FS-I/O unit | file-I/O | `test/cli/polling-daemon.test.js` | exact (mirror HOME-isolated + dynamic import) |
| `test/cli/polling-verbose.test.js` (NEW probable) | test / integration spawn | spawn-fork crash | `test/cli/polling.test.js` (caso 2 + caso 14) | role-match (integration spawn pattern existente) |

## Pattern Assignments

### `src/interface.js` (type-contract, aditivo)

**Analog:** self — TaskItem typedef líneas 11-24.

**Cambio aditivo D-01:** añadir `updated_at: string` y `created_at: string` al typedef. AMBOS **REQUIRED** (NO `?` opcional). Pasa de 11 a 13 campos canónicos.

**Patrón actual a extender** (`src/interface.js:10-24`):
```javascript
/**
 * @typedef {{
 *   id: string,
 *   ref: string,
 *   title: string,
 *   description: string,
 *   labels: string[],
 *   projectId: string,
 *   projectName: string,
 *   groups: string[],
 *   url: string,
 *   priority: 'urgent'|'high'|'medium'|'low'|'none'|null,
 *   state?: string,
 * }} TaskItem
 */
```

**Shape post-Phase-28** (mirror cómo entran `updated_at` / `created_at` — REQUIRED strings ISO 8601 UTC):
```javascript
/**
 * @typedef {{
 *   id: string,
 *   ref: string,
 *   title: string,
 *   description: string,
 *   labels: string[],
 *   projectId: string,
 *   projectName: string,
 *   groups: string[],
 *   url: string,
 *   priority: 'urgent'|'high'|'medium'|'low'|'none'|null,
 *   state?: string,
 *   updated_at: string,    // D-01 Phase 28: REQUIRED ISO 8601 UTC string
 *   created_at: string,    // D-01 Phase 28: REQUIRED ISO 8601 UTC string
 * }} TaskItem
 */
```

**JSDoc convention en este archivo** — comentar la decisión inline con phase pointer cuando es D-01 override (lo hace el resto del repo: `state?` no tiene comment, los nuevos D-01 sí).

---

### `src/providers/github/normalize.js` (normalizer, pure transform)

**Analog:** `src/providers/plane/normalize.js#normalizeWorkItem` (cross-provider mirror) + self §`normalizeIssue` (extensión aditiva del return).

**Patrón actual** (`src/providers/github/normalize.js:83-105`):
```javascript
export function normalizeIssue(issue, context) {
  const labels = Array.isArray(issue.labels)
    ? issue.labels
        .map((l) => (typeof l === 'string' ? l : l?.name))
        .filter(Boolean)
    : [];

  return {
    id: issue.node_id,                              // D-07: node_id (NOT numeric id)
    ref: `${context.projectId}#${issue.number}`,    // D-08: owner/repo#number
    title: issue.title,                             // D-09
    description: issue.body || '',                  // D-10: raw Markdown
    labels,                                         // D-11
    projectId: context.projectId,                   // D-12
    projectName: context.projectId,                 // D-13: same slug
    groups: [],                                     // D-14
    url: issue.html_url,                            // D-15
    priority: extractPriority(issue.labels),        // D-17
    state: issue.state,                             // D-16
  };
}
```

**Cambio (D-02 Phase 28):** añadir `updated_at: issue.updated_at` y `created_at: issue.created_at` al return shape (después de `state`). GitHub Issues SIEMPRE embeben ambos campos como ISO 8601 UTC strings (verificado en fixture `test/fixtures/github/issue.json:16-17`):
```json
"created_at": "2026-05-14T07:00:00Z",
"updated_at": "2026-05-14T08:00:00Z",
```

**Comentario inline** (mirror estilo existente):
```javascript
    state: issue.state,                             // D-16: 'open'|'closed' literal
    updated_at: issue.updated_at,                   // D-02 Phase 28: ISO 8601 (always present)
    created_at: issue.created_at,                   // D-02 Phase 28: ISO 8601 (always present)
```

**Actualizar también el JSDoc header (líneas 73-78 + D-18 comentario línea 19):**
- Línea 19: cambiar "EXACTAMENTE 11 canonical fields" → "EXACTAMENTE 13 canonical fields"
- Línea 73-78: actualizar la lista enumerada de campos en el JSDoc del return
- Línea 76-77: remover `created_at, updated_at` del "no leaks" enumeration (ya NO son leaks; ahora son canónicos)

---

### `src/providers/plane/normalize.js` (normalizer, pure transform)

**Analog:** `src/providers/github/normalize.js#normalizeIssue` (cross-provider mirror).

**Patrón actual** (`src/providers/plane/normalize.js:64-80`):
```javascript
export function normalizeWorkItem(workItem, context) {
  const ref = `${context.projectIdentifier}-${workItem.sequence_id}`;

  return {
    id: workItem.id,
    ref,
    title: workItem.name,
    description: stripHtml(workItem.description_html || ''),
    labels: resolveWorkItemLabels(workItem.labels, context.labels),
    projectId: workItem.project_detail?.id || workItem.project,
    projectName: workItem.project_detail?.name || '',
    groups: [],
    url: `${context.baseUrl}/${context.workspaceSlug}/browse/${ref}`,
    priority: VALID_PRIORITIES.includes(workItem.priority) ? workItem.priority : null,
    state: workItem.state_detail?.name || context.stateMap?.get(workItem.state) || undefined,
  };
}
```

**Cambio (D-03 Phase 28):** añadir 2 campos al return. Plane embebe ambos en cada work item (verificado en fixture `test/fixtures/plane-workitem.json:31-32`):
```json
"created_at": "2026-04-01T10:00:00.000Z",
"updated_at": "2026-04-08T14:30:00.000Z",
```

**Cambio mínimo a aplicar** (mirror simétrico con GitHub):
```javascript
    state: workItem.state_detail?.name || context.stateMap?.get(workItem.state) || undefined,
    updated_at: workItem.updated_at,    // D-03 Phase 28: paridad cross-provider
    created_at: workItem.created_at,    // D-03 Phase 28: paridad cross-provider
```

**Sin guard defensivo** (D-01 dice REQUIRED, NO null/undefined). Si el payload Plane no trae el campo, se prefiere fail-loud downstream que enmascarar con `|| ''`.

---

### `src/triggers/polling.js` (trigger, event-driven)

**Analog múltiple:**
- `src/triggers/polling.js#shouldDispatch` (167-170) — extensión a TaskItem normalizado.
- `src/triggers/polling.js#saveStateCache` (149-154) — patrón atomic write reusable.
- `src/triggers/polling.js#processRepo` (282-290) — extracción de maxUpdatedAt.

**Touch site 1 — `shouldDispatch` (D-05 Phase 28):**

Patrón actual (líneas 167-170):
```javascript
function shouldDispatch(issue, prev) {
  if (!prev.last_updated_at) return false; // first-tick skip
  return issue.updated_at > prev.last_updated_at;
}
```

**Cambio:** la firma es identica (string comparison sobre `updated_at`), pero ahora `issue` puede ser **raw GitHub issue** (path client) o **TaskItem normalizado** (path provider-only). AMBOS exponen `updated_at` ISO string post-Phase-28 → SIN cambio funcional en el body de `shouldDispatch`. Renombrar el parámetro a `task` para reflejar la dualidad semántica:

```javascript
function shouldDispatch(task, prev) {
  if (!prev.last_updated_at) return false; // first-tick skip (T-25-04)
  return task.updated_at > prev.last_updated_at;
}
```

**Touch site 2 — `processRepo` maxUpdatedAt (D-06 Phase 28):**

Patrón actual (líneas 286-290):
```javascript
        if (issue.pull_request) continue;

        if (issue.updated_at && issue.updated_at > maxUpdatedAt) {
          maxUpdatedAt = issue.updated_at;
        }
```

**Cambio:** en el path provider-only (`else if (provider)`), los items ya son TaskItems. La iteración funciona sin cambio porque ambos shapes tienen `updated_at`. Lo que SÍ cambia es la guarda `issue.pull_request` — esa es GitHub-only, NO aplica a TaskItem (Phase 24 D-25 ya filtra PRs en el provider). Mantener la guarda como-is — TaskItem nunca tiene `pull_request` así que el `continue` jamás se ejecuta en path provider; el guard es defensa en profundidad en path client.

**Touch site 3 — emisión `polling.tick.summary` (D-10 Phase 28, nuevo evento):**

**Pattern lift:** el tick loop existente vive en `startPolling#tick` (líneas 431-457). Se añade emisión AL FINAL del for-loop, antes del `setTimeout(tick, intervalMs)`. Se requiere acumular contadores cross-repo dentro del tick:

```javascript
  async function tick() {
    if (stopped) return;
    const cache = loadStateCache(statePath);

    // Phase 28 D-10/D-12: acumuladores cross-repo para summary.
    let totalDispatched = 0;
    let minRateLimit = null;   // mínimo cross-repo; null si ningún repo lo retornó
    const reposPolled = [];

    for (const { owner, repo } of opts.repos) {
      if (stopped) break;
      const key = `${owner}/${repo}`;
      reposPolled.push(key);
      const isFirstTick = !firstTickPerRepo.has(key);
      // processRepo retorna {dispatched, rate_limit_remaining} (nuevo shape)
      const repoSummary = await processRepo({ ... });
      totalDispatched += repoSummary.dispatched;
      if (repoSummary.rate_limit_remaining != null) {
        minRateLimit = minRateLimit == null
          ? repoSummary.rate_limit_remaining
          : Math.min(minRateLimit, repoSummary.rate_limit_remaining);
      }
      firstTickPerRepo.add(key);
    }

    // Phase 28 D-10: emit summary AL FINAL del tick (después de iterar todos los repos).
    if (opts.logger && !stopped) {
      pollingTickSummary(opts.logger, {
        repos_polled: reposPolled.length,
        total_dispatches: totalDispatched,
        rate_limit_remaining: minRateLimit,
        repos: reposPolled,
      });
    }

    if (!stopped) {
      timer = clock.setTimeout(tick, intervalMs);
    }
  }
```

**Implicación contractual:** `processRepo` debe ahora retornar `{dispatched: number, rate_limit_remaining: number|null}` (hoy retorna `void`). Cambio aditivo no-breaking (todos los call sites están dentro del mismo archivo).

---

### `src/logger-events.js` (taxonomy, pure transform)

**Analog:** `pollingTick` (líneas 420-429) — mismo shape y nivel info.

**Patrón actual** (`src/logger-events.js:420-429`):
```javascript
export function pollingTick(logger, fields) {
  logger.info(EVENTS.POLLING_TICK, {
    event: EVENTS.POLLING_TICK,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    dispatched: fields.dispatched,
    ...(fields.first_tick ? { first_tick: true } : {}),
  });
}
```

**Añadir constante + helper (D-10 Phase 28):**

```javascript
// Add to EVENTS (líneas 46-65), después de POLLING_ERROR:
POLLING_TICK_SUMMARY: 'polling.tick.summary',
```

Y actualizar el typedef JSDoc readonly map (líneas 26-45) para incluir la nueva key.

**Nuevo helper (mirror `pollingTick` shape):**
```javascript
/**
 * Emitido AL FINAL de cada tick agregado del polling loop, una vez por tick
 * (D-10 Phase 28). Mientras `pollingTick` emite per-repo (granular), este
 * emite cross-repo (agregado) para soportar `--verbose` summary line.
 *
 * `rate_limit_remaining` es el mínimo cross-repo dentro del tick (D-12: el más
 * conservador). `null` cuando ningún repo retornó rate-limit header (e.g. todos
 * 304 con cursor preservado).
 *
 * Invariante T-25-02 (Information disclosure): el helper SOLO emite contadores
 * + lista de repos. JAMÁS body, título, ref, payload raw.
 *
 * @param {Logger} logger
 * @param {{
 *   repos_polled: number,
 *   total_dispatches: number,
 *   rate_limit_remaining: number | null,
 *   repos: string[],
 * }} fields
 */
export function pollingTickSummary(logger, fields) {
  logger.info(EVENTS.POLLING_TICK_SUMMARY, {
    event: EVENTS.POLLING_TICK_SUMMARY,
    repos_polled: fields.repos_polled,
    total_dispatches: fields.total_dispatches,
    rate_limit_remaining: fields.rate_limit_remaining,
    repos: fields.repos,
  });
}
```

**Header comment update:** la línea 13 del header tiene la lista de 18 eventos. Añadir `polling.tick.summary` a la enumeración (pasa a 19).

---

### `src/cli/polling.js` (CLI handler, spawn-fork + foreground subscriber)

**Analog múltiple:**
- `runPollingStartCli` daemon branch (228-262) — touch site para fd redirect (D-13).
- `runForegroundPolling` (275-307) — touch site para suscriber `--verbose`.
- `runPollingStatusCli` (370-396) — patrón `createFormatter(stream)` ya wired.

**Touch site 1 — daemon spawn con fd redirect (D-13/D-16 Phase 28):**

Patrón actual (líneas 245-252):
```javascript
  const KODO_BIN = resolveKodoBin();
  const child = spawn(
    process.execPath,
    [KODO_BIN, 'polling', 'start', '--no-daemon'],
    { detached: true, stdio: 'ignore', env: process.env },
  );
  child.unref();
```

**Cambio:** abrir logfile como fd y pasarlo en `stdio`. Pre-flight retention sweep ANTES del spawn (D-15). Importar nuevo módulo `polling-logfile.js`:

```javascript
import { openSync, mkdirSync } from 'node:fs';
import { resolveLogfilePath, sweepRetention, ensureLogsDir } from './polling-logfile.js';

// ... dentro de runPollingStartCli, después del check PID y antes del spawn:

  ensureLogsDir();                  // mkdir -p ~/.kodo/logs con mode 0o700
  try { sweepRetention(); }          // D-15 fail-open: cleanup pasivo, no agresivo
  catch (e) { /* warn fail-open — log a logger raíz si disponible */ }

  const logfilePath = resolveLogfilePath();  // ~/.kodo/logs/polling-YYYY-MM-DD.log
  const logFd = openSync(logfilePath, 'a', 0o600);  // D-16: 0o600 mode

  const KODO_BIN = resolveKodoBin();
  const child = spawn(
    process.execPath,
    [KODO_BIN, 'polling', 'start', '--no-daemon', ...(opts.verbose ? ['--verbose'] : [])],
    { detached: true, stdio: ['ignore', logFd, logFd], env: process.env },
  );
  child.unref();
  // logFd se cierra implícitamente cuando el spawn la duplicó (Node behavior).
```

**Touch site 2 — `--verbose` foreground subscriber (D-07/D-09 Phase 28):**

Patrón actual (líneas 275-307): `runForegroundPolling` crea handle via `startPolling({...})` + sets PID file + SIGINT cleanup. Cero subscriber sobre eventos del logger.

**Cambio:** cuando `opts.verbose === true`, inyectar un logger wrapper que tras emitir `polling.tick.summary` también escribe la línea al stdout formateada (TTY columnar vs no-TTY NDJSON). Mirror del patrón `runPollingStatusCli` (líneas 386-394):

```javascript
async function runForegroundPolling({ config, reposRaw, verbose }) {
  const { startPolling } = await import('../triggers/polling.js');
  const { initRegistry, getProvider } = await import('../providers/registry.js');
  await initRegistry();
  const provider = getProvider('github');

  // D-07/D-09: cuando --verbose, wrappear logger para suscribir polling.tick.summary
  // y renderizar a stdout vía createFormatter (TTY-aware).
  const fmt = createFormatter(process.stdout);
  const baseLogger = createLogger({ provider: 'github' }); // o el logger raíz canonical
  const logger = verbose
    ? wrapLoggerForSummary(baseLogger, fmt, process.stdout)
    : baseLogger;

  const handle = startPolling({
    provider,
    repos: reposRaw,
    intervalSec: config?.providers?.github?.poll_interval || 60,
    logger,
  });
  // ... resto idéntico (writePidFile + SIGINT cleanup + block forever).
}

// Helper local — tap sobre logger.info que reconoce polling.tick.summary y
// duplica a stdout. Cualquier otro evento pasa transparente al sink NDJSON.
function wrapLoggerForSummary(logger, fmt, stream) {
  return {
    ...logger,
    info(event, record) {
      logger.info(event, record);
      if (event === 'polling.tick.summary') {
        if (process.stdout.isTTY && !process.env.KODO_JSON) {
          // TTY columnar via createFormatter (D-09)
          const line = fmt.formatRow(
            [
              fmt.dim(record.ts || new Date().toISOString()),
              fmt.cyan('polling.tick.summary'),
              `repos=${record.repos_polled}`,
              `dispatched=${record.total_dispatches}`,
              `rl=${record.rate_limit_remaining ?? '—'}`,
            ],
            [],
            { separator: ' · ' },
          );
          stream.write(line + '\n');
        } else {
          // no-TTY → NDJSON byte-determinístico (preserva DX-06)
          stream.write(JSON.stringify(record) + '\n');
        }
      }
    },
  };
}
```

**Touch site 3 — flag `--verbose` en Commander signature.** El handler ya acepta `opts`. Asegurar que `opts.verbose` se propaga desde la registración del comando en `src/cli.js` (Commander `.option('--verbose')` default `false`).

---

### `src/cli/polling-logfile.js` (NEW, utility / FS-I/O)

**Analog:** `src/cli/polling-daemon.js` (verbatim mirror del patrón de path lazy resolver + ensure dir + atomic ops).

**Patrón a replicar — lazy resolver con `homedir()` por llamada (D-15/D-16 Phase 28, Pitfall #11):**

Patrón actual en `polling-daemon.js:51-53`:
```javascript
export function getPidPath() {
  return join(homedir(), '.kodo', 'polling.pid');
}
```

**Shape esperado del nuevo módulo** (estructura mirror — header de 30 líneas explicando el patrón, exports lazy, fail-open en sweep):

```javascript
// @ts-check
//
// src/cli/polling-logfile.js — Phase 28 D-13..16 logfile lifecycle.
//
// Provee 3 primitivas pure FS-I/O para el daemon:
//   - resolveLogfilePath() → string : path al logfile del DÍA del arranque.
//       Filename `polling-YYYY-MM-DD.log` (D-14). Computed via `new Date()`
//       local time AL MOMENTO de la llamada (no cached). NO roll mid-process
//       (D-14 explicit trade-off).
//   - ensureLogsDir() → void : mkdir -p ~/.kodo/logs con mode 0o700 (D-16).
//   - sweepRetention(opts?) → void : borra polling-*.log con mtime > 7 días.
//       Fail-open: cualquier I/O error se traga (no crashea el comando).
//
// Patrón verbatim del precedente src/cli/polling-daemon.js (Phase 26 D-15):
//   lazy path resolver via homedir() en cada llamada (Pitfall #11 HOME-isolated
//   tests sin ESM cache bust), chmod PRE-rename, fail-open en reads.
//
// Color isolation: cero stdout/stderr writes desde este módulo (Pattern A v0.5).
// El caller (CLI handler) hace el rendering vía createFormatter.

import { openSync, readdirSync, statSync, unlinkSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Resuelve el path del logfile del día actual (fecha local). Lazy — recomputa
 * en cada llamada para que los tests HOME-isolated funcionen sin ESM bust.
 *
 * Filename `polling-YYYY-MM-DD.log` (D-14 LOCKED). NO roll mid-process.
 *
 * @param {{ now?: () => Date }} [opts] — clock injection para tests
 * @returns {string}
 */
export function resolveLogfilePath(opts = {}) {
  const now = (opts.now ? opts.now() : new Date());
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return join(homedir(), '.kodo', 'logs', `polling-${y}-${m}-${d}.log`);
}

/**
 * Idempotente. Crea `~/.kodo/logs/` con mode 0o700 (D-16).
 */
export function ensureLogsDir() {
  mkdirSync(join(homedir(), '.kodo', 'logs'), { recursive: true, mode: 0o700 });
}

/**
 * D-15: borra `polling-*.log` con `mtime > 7 días` (cleanup pasivo al arrancar).
 * Fail-open por archivo — un fail de unlink no detiene el sweep del resto.
 *
 * @param {{ now?: () => Date, retentionDays?: number }} [opts]
 */
export function sweepRetention(opts = {}) {
  const dir = join(homedir(), '.kodo', 'logs');
  const cutoffMs = (opts.now ? opts.now().getTime() : Date.now())
    - (opts.retentionDays ?? 7) * 86_400_000;
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith('polling-') || !name.endsWith('.log')) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (st.mtimeMs < cutoffMs) unlinkSync(full);
    } catch { /* fail-open per file */ }
  }
}
```

**Diferencias respecto al analog `polling-daemon.js`:** no escribe (solo abre fd via `openSync` que retorna al caller); el sweep es READ + UNLINK (no atomic-write); chmod se aplica en el `openSync` del CALLER (`src/cli/polling.js`) NO aquí — separation of concerns (este módulo no decide el modo, el caller sí).

---

### `test/providers/contract.test.js` (test, contract matrix)

**Analog:** self — añade asserts al patrón Phase 27 ya empíricamente verde.

**Patrón actual** (líneas 77-89):
```javascript
const CANONICAL_TASK_ITEM_KEYS = Object.freeze([
  'id', 'ref', 'title', 'description', 'labels', 'projectId',
  'projectName', 'groups', 'url', 'priority', 'state',
]);
```

**Cambio (D-04 Phase 28):**

1. **Extender la constante** a 13 entries:
```javascript
const CANONICAL_TASK_ITEM_KEYS = Object.freeze([
  'id', 'ref', 'title', 'description', 'labels', 'projectId',
  'projectName', 'groups', 'url', 'priority', 'state',
  'updated_at', 'created_at',    // D-04 Phase 28
]);
```

2. **Reformular el comment línea 71-76:** "Los 11 fields canonical" → "Los 13 fields canonical (Phase 28 D-01)".

3. **Añadir 2 type asserts dentro de `assertTaskItemShape`** (mirror del patrón ya existente en líneas 155-167):
```javascript
  assert.equal(typeof task.updated_at, 'string',
    `[${providerName}] updated_at must be string ISO`);
  assert.equal(typeof task.created_at, 'string',
    `[${providerName}] created_at must be string ISO`);
```

**Patrón del file-level loop preservado:** ningún `it()` nuevo top-level — los 2 asserts viven dentro de `assertTaskItemShape` que ya se invoca en los `it()` B2 y B5 del loop existente. Resultado: 7 → 9 asserts × 2 providers = 18 cases (mirror perfecto del bookkeeping declarado en CONTEXT D-04).

**Fixtures:** `test/fixtures/github/issue.json` ya tiene `created_at`/`updated_at` (líneas 16-17 — verificado). `test/fixtures/plane-workitem.json` ya tiene ambos también (líneas 31-32 — verificado). Cero touches a fixtures.

---

### `test/providers/github/normalize.test.js` (test, normalizer)

**Analog:** self — extensión aditiva 2 asserts.

**Patrón actual** (líneas 20-34):
```javascript
const CANONICAL_KEYS = [
  'id', 'ref', 'title', 'description', 'labels', 'projectId',
  'projectName', 'groups', 'url', 'priority', 'state',
];
```

**Cambio:**

1. Extender `CANONICAL_KEYS` a 13 entries (mirror contract.test.js).
2. Actualizar el test "D-18 leak guard" (líneas 57-65) — mensaje y count: "EXACTAMENTE 11 canonical TaskItem keys" → "EXACTAMENTE 13 canonical TaskItem keys"; quitar `created_at, updated_at` del enumeration de leaks (líneas 63-64).
3. Actualizar el primer test (líneas 37-55) — añadir 2 asserts justo después de `result.priority`:
```javascript
  assert.equal(
    result.updated_at,
    '2026-05-14T08:00:00Z',
    'D-02 Phase 28: updated_at passthrough literal',
  );
  assert.equal(
    result.created_at,
    '2026-05-14T07:00:00Z',
    'D-02 Phase 28: created_at passthrough literal',
  );
```

---

### `test/triggers/polling.test.js` (test, event-driven loop)

**Analog:** self — clock virtual + fake client/provider/logger patrón existente.

**Cambio 1 — caso provider-only GREEN (D-05 Phase 28):**

Patrón a mirror: cualquier `describe('startPolling — POLL-01 ...')` block con `makeFakeProvider` + `makeFakeLogger`. Hoy el provider path retorna TaskItems vía `makeFakeProvider({ listPendingTasks: () => [...] })` — el TaskItem mock debe incluir `updated_at`/`created_at` para que `shouldDispatch` GREEN cubra el path.

```javascript
it('provider-only path: TaskItem con updated_at dispara correctamente', async () => {
  const { clock, advance } = createTestClock();
  const taskItem = {
    id: 'I_test1', ref: 'octocat/hello#1', title: 't', description: '',
    labels: ['kodo'], projectId: 'octocat/hello', projectName: 'octocat/hello',
    groups: [], url: 'https://github.com/octocat/hello/issues/1', priority: null,
    state: 'open',
    updated_at: '2026-05-15T10:00:00Z',  // POST cursor → debe disparar
    created_at: '2026-05-15T09:00:00Z',
  };
  // Pre-poblar cursor para evitar first-tick skip
  writeFileSync(statePath, JSON.stringify({ 'octocat/hello': { last_updated_at: '2026-05-15T08:00:00Z' } }));
  const provider = makeFakeProvider({ listPendingTasks: async () => [taskItem] });
  const dispatched = [];
  handle = startPolling({
    provider,
    repos: [{ owner: 'octocat', repo: 'hello' }],
    intervalSec: 60, clock, statePath,
    dispatchTriggerFn: async (event) => { dispatched.push(event); },
  });
  await drainMicrotasks();
  assert.equal(dispatched.length, 1, 'TaskItem updated_at > cursor → dispatch fires');
  assert.equal(dispatched[0].taskRef, 'octocat/hello#1');
});
```

**Cambio 2 — caso `polling.tick.summary` emission (D-10 Phase 28):**

Mirror del patrón de `makeFakeLogger(captureArray)` (líneas 165-173) — captura todos los emits, filtrar por `msg === 'polling.tick.summary'`:

```javascript
it('emite polling.tick.summary AL FINAL del tick con shape D-10', async () => {
  const { clock } = createTestClock();
  const events = [];
  const logger = makeFakeLogger(events);
  const client = makeFakeClient({
    listIssues: async () => ({
      status: 200, items: [], etag: undefined, rate_limit_remaining: 4823,
    }),
  });
  handle = startPolling({
    client,
    repos: [{ owner: 'a', repo: 'b' }, { owner: 'c', repo: 'd' }],
    intervalSec: 60, clock, statePath, logger,
  });
  await drainMicrotasks();
  const summaries = events.filter((e) => e.msg === 'polling.tick.summary');
  assert.equal(summaries.length, 1, 'exactamente 1 summary por tick');
  assert.equal(summaries[0].repos_polled, 2);
  assert.equal(summaries[0].total_dispatches, 0);
  assert.equal(summaries[0].rate_limit_remaining, 4823);
  assert.deepEqual(summaries[0].repos, ['a/b', 'c/d']);
});
```

---

### `test/cli/polling-logfile.test.js` (NEW probable, test FS-I/O unit)

**Analog:** `test/cli/polling-daemon.test.js` (verbatim mirror del patrón).

**Patrón actual** (`test/cli/polling-daemon.test.js:37-57`):
```javascript
it('writePidFile escribe atomic con chmod 0o600 + tmp file ausente post-rename', async () => {
  _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pid-write-'));
  mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
  _prevHome = process.env.HOME;
  process.env.HOME = _tmpHome;
  const mod = await import(`../../src/cli/polling-daemon.js?write-test-${Date.now()}`);
  mod.writePidFile({ pid: 42, started_at: '...', repos: ['a/b'] });
  const pidPath = mod.getPidPath();
  assert.equal(existsSync(pidPath), true);
  const mode = statSync(pidPath).mode & 0o777;
  assert.equal(mode, 0o600);
  // ...
});
```

**Casos mínimos a cubrir** (mirror verbatim):

1. **`resolveLogfilePath` filename format** — inyectar `now: () => new Date('2026-05-18T12:00:00')` y assertar el path termina en `polling-2026-05-18.log` (D-14 literal AC#2).
2. **`ensureLogsDir` crea dir con mode 0o700** — `statSync(dir).mode & 0o777 === 0o700` (D-16).
3. **`sweepRetention` borra archivos > 7 días** — pre-poblar 3 archivos con `utimesSync` para forzar mtime antiguo + 2 con mtime reciente, assert solo los 3 antiguos borrados.
4. **`sweepRetention` fail-open ante dir ausente** — sin `~/.kodo/logs/`, no throw, return cleanly (D-15 cleanup pasivo).
5. **`sweepRetention` no toca archivos no-polling-** — pre-poblar `random.log` con mtime antiguo, assertar que persiste post-sweep.

**Pattern de HOME isolation** mirror lines 37-46 de polling-daemon.test.js:
- `mkdtempSync(join(tmpdir(), 'kodo-logfile-...'))`
- `process.env.HOME = _tmpHome`
- `await import(\`../../src/cli/polling-logfile.js?test-${Date.now()}\`)` para ESM cache bust per-test
- `afterEach` restaura HOME y rmSync el tmpHome

---

### `test/cli/polling-verbose.test.js` (NEW probable, integration spawn)

**Analog:** `test/cli/polling.test.js` casos 2 (foreground SIGINT) + 3 (daemon spawn PID file) + 14 (Windows refuse).

**Pattern lift integration spawn** (líneas 179-185):
```javascript
const { spawn } = await import('node:child_process');
const child = spawn(
  process.execPath,
  [KODO_BIN, 'polling', 'start', '--no-daemon'],
  { env: { ...process.env, HOME: tmpHome, GITHUB_TOKEN: 'fake', NO_COLOR: '1' } },
);
```

**Casos a cubrir** (mirror AC del CONTEXT.md):

1. **AC#1: foreground `--verbose` emite ≥1 línea por tick a stdout** — spawn con `--no-daemon --verbose` + lectura de stdout (≤5s wait) + assertar regex `polling\.tick\.summary` o keys del shape D-10 en la línea.
2. **AC#2: daemon crash escribe stack trace a logfile** — patrón "daemon que `throw` post-arranque" (driver real T-26-DIAG). Mock binary que arranca y throw a los 200ms, spawn como daemon (sin `--no-daemon`), wait ≤3s, `readFileSync(~/.kodo/logs/polling-YYYY-MM-DD.log)` debe contener stack trace.
3. **AC#2: logfile permisos 0o600** — `statSync(logfilePath).mode & 0o777 === 0o600`.
4. **Daemon `--verbose` escribe NDJSON al logfile** — spawn daemon con `--verbose`, esperar 1 tick, grep el logfile por `"event":"polling.tick.summary"`.

**Helper a reutilizar:** `makeFixture(opts)` en `test/cli/polling.test.js:87-110` ya wirea `~/.kodo/config.json` + `~/.kodo/.env` con `GITHUB_TOKEN=fake_token_for_test`. Re-importar de un helpers/ compartido o duplicar el helper en este file (preferido: lift-and-shift a `test/cli/_helpers.js` si emerge una tercera copia).

---

## Shared Patterns

### Atomic FS write (chmod PRE-rename)
**Source:** `src/cli/polling-daemon.js#writePidFile` (76-83) + `src/triggers/polling.js#saveStateCache` (149-154).
**Apply to:** N/A en Phase 28 (logfile usa `openSync(..., 'a', 0o600)` con mode argument — flag append + create con permission, NO rename pattern).

```javascript
mkdirSync(dirname(path), { recursive: true });
const tmp = path + '.tmp';
writeFileSync(tmp, content);
chmodSync(tmp, 0o600);   // PRE-rename per Security V14 / Phase 26 D-15
renameSync(tmp, path);
```

### Lazy resolver via homedir() (Pitfall #11 — HOME-isolated tests)
**Source:** `src/cli/polling-daemon.js#getPidPath` (51-53).
**Apply to:** `src/cli/polling-logfile.js` (`resolveLogfilePath`, `ensureLogsDir`).

```javascript
export function getPidPath() {
  return join(homedir(), '.kodo', 'polling.pid');  // recomputa en cada llamada
}
```

### Fail-open en cleanup secundario
**Source:** Phase 19 D-07 + `loadStateCache` (123-136) + `removePidFile` (113-119).
**Apply to:** `sweepRetention` en `polling-logfile.js`; el wrap try/catch del pre-flight sweep en `runPollingStartCli`.

```javascript
try { sweepRetention(); } catch { /* fail-open — cleanup pasivo */ }
```

### Closed event taxonomy
**Source:** `src/logger-events.js` (líneas 46-65 EVENTS frozen + helpers individuales).
**Apply to:** añadir `POLLING_TICK_SUMMARY` literal + `pollingTickSummary` helper. Test `test/logger-events.test.js` ya valida la inmutabilidad del map.

```javascript
export const EVENTS = Object.freeze({
  // ... existing entries ...
  POLLING_TICK_SUMMARY: 'polling.tick.summary',  // D-10 Phase 28
});

export function pollingTickSummary(logger, fields) {
  logger.info(EVENTS.POLLING_TICK_SUMMARY, { event: EVENTS.POLLING_TICK_SUMMARY, ...whitelisted });
}
```

### `createFormatter(stream)` para output coloreado TTY-aware
**Source:** `src/cli/format.js#createFormatter` (114-178) + uso en `runPollingStatusCli` (387-394).
**Apply to:** `runForegroundPolling` cuando `--verbose` activo. NUNCA importar `picocolors` directamente fuera de `format.js` (Color isolation D-07 Phase 14 — blindado por `test/format-isolation.test.js`).

```javascript
const fmt = createFormatter(process.stdout);
write(`${fmt.cyan('polling.tick.summary')} repos=${n} dispatched=${m} rl=${rl}\n`);
```

### `--json` byte-determinismo (DX-06)
**Source:** Phase 15 D-08 + `runPollingStatusCli:376-385` (early-return JSON path).
**Apply to:** path no-TTY del verbose subscriber — siempre `JSON.stringify(record) + '\n'` sin colores. Idéntico TTY y no-TTY cuando `--json` o stdout no es TTY.

### Provider × matrix con `assertTaskItemShape`
**Source:** `test/providers/contract.test.js#assertTaskItemShape` (131-168).
**Apply to:** extender la constante `CANONICAL_TASK_ITEM_KEYS` + añadir 2 type asserts dentro del helper. NO añadir `it()` top-level — preservar el invariante "TODOS los it dentro del for-loop" (Pitfall #3).

### Integration spawn helper (HOME-isolated + timeout)
**Source:** `test/cli/polling.test.js#makeFixture` (87-110) + spawn pattern (179-185, 332-336).
**Apply to:** `test/cli/polling-verbose.test.js`. `env: { ...process.env, HOME: tmpHome, GITHUB_TOKEN: 'fake', NO_COLOR: '1' }` + `spawnSync` con `timeout: 10_000` (DoS guard) o `spawn` con kill-after-N-ms para verbose tick capture.

## No Analog Found

Ningún archivo de Phase 28 carece de analog directo en el repo. Phase 28 es consolidación pura — la mayoría de cambios son aditivos sobre paths ya verdes en v0.7. Los 2 archivos "nuevos probables" (`polling-logfile.js`, `polling-logfile.test.js`) son mirrors verbatim de `polling-daemon.js` / `polling-daemon.test.js` con divergencias mínimas (FS read + unlink en lugar de FS write atomic).

## Metadata

**Analog search scope:**
- `src/interface.js`
- `src/providers/{github,plane}/normalize.js`
- `src/triggers/polling.js`
- `src/cli/{format,polling,polling-daemon}.js`
- `src/logger-events.js`, `src/logger.js`
- `test/providers/contract.test.js`, `test/providers/github/normalize.test.js`
- `test/triggers/polling.test.js`
- `test/cli/{polling,polling-daemon}.test.js`
- `test/fixtures/{github/issue.json,plane-workitem.json}`

**Files scanned:** 14 source + test files leídos en profundidad. Tests existentes de fixtures verifican que `created_at`/`updated_at` ya están presentes en los payloads raw de ambos providers — el cambio normalizer es trivial (passthrough).

**Pattern extraction date:** 2026-05-18

**Phase 28 readiness:** Todos los analogs son first-class (no role-match degradado). El planner puede asignar plan boundaries con copy-paste de patrones concretos. Plans naturales sugeridos (no-binding):
- **Plan 28-01 (POLL-FIX-01):** TaskItem 13 fields + normalizers + 3 test files (contract.test, github/normalize.test, triggers/polling.test).
- **Plan 28-02 (DAEMON-01):** `polling.tick.summary` event taxonomy + emisión en polling.js + `--verbose` subscriber + test verbose foreground.
- **Plan 28-03 (DAEMON-02):** `polling-logfile.js` nuevo + fd redirect en spawn + retention sweep + test logfile unit + test daemon crash integration.
