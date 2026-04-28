# Phase 7: `kodo logs` CLI + Event Taxonomy — Pattern Map

**Mapped:** 2026-04-16
**Files analyzed:** 16 (5 new source modules, 7 consumer edits, 4 test assets)
**Analogs found:** 16 / 16 (100% coverage — Fase 7 es reuso puro del codebase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/logger-events.js` | pure-module (taxonomy + helpers) | transform (input fields → NDJSON via logger) | `src/logger.js` (factory + LEVELS frozen const + JSDoc typedef) | exact (same package, same style, same redactor pipeline) |
| `src/logs/reader.js` | CLI-action-handler / io-module | file-I/O + stdout (batch + streaming) | `src/cli.js:189-211` `status` handler + `src/check.js` (scan + print) | role-match (CLI action handler) |
| `src/logs/follow.js` (implícito en reader.js o archivo aparte) | io-module (watcher) | file-I/O event-driven | ninguno — novel (RESEARCH Pattern 3) | no-analog (stdlib fs.watchFile) |
| `src/logs/session-lookup.js` (o `session-of.js`) | pure-module + io-module | two-step CRUD lookup (state.json + FS scan) | `src/session/state.js` `findSession()` + `src/check.js` readdirSync loop | role-match (state reader + dir scanner) |
| `src/logs/head-line.js` (implícito) | pure-module io | file-I/O streaming (bounded) | ninguno — novel (RESEARCH Pattern 2) | no-analog (stdlib fs.openSync + readSync) |
| `src/cli.js` (MODIFY) | CLI-command registration | commander sub-command | self (`.command('launch <ref>')` lines 144-187 con opcional positional y opts.*) | exact (mismo archivo, mismo patrón) |
| `src/logger.js` (MODIFY additive) | factory export extension | transform (record → string) | self (`formatCtxInline` lines 246-257, `COLOR_BY_LEVEL` line 37) | exact (extract+export, no refactor de comportamiento) |
| `src/hooks/session-start.js` (MODIFY) | consumer-wire + emisor `session.start` | event-driven (stdin hook → typed log) | self (patrón silent-failure line 106-108) + pattern Fase 6 de consumer logger | role-match (hook pattern ya establecido) |
| `src/hooks/stop.js` (MODIFY) | consumer-wire + emisor `session.end` | event-driven | self (misma forma que session-start.js) | exact |
| `src/session/manager.js` (MODIFY) | consumer-wire | request-response (recibe logger, child('session')) | `createPlaneProvider(config)` en `src/providers/plane/provider.js:23` (factory que recibe config → objeto) | role-match (factory con DI config) |
| `src/session/state.js` (MODIFY optional) | consumer-wire (emisión opcional) | CRUD + log | self (fns existentes `addSession`/`removeSession` lines 79-99) | exact (extender firma, default `noopLogger`) |
| `src/providers/plane/client.js` (MODIFY) | consumer-wire + emisor `plane.api.call` | request-response | self (`async request(path, opts)` lines 22-75) | exact (insertar helper tras `res.ok`) |
| `src/providers/plane/provider.js` (MODIFY) | consumer-wire | factory con DI | self (factory ya recibe `config`) | exact (añadir opcional `logger` al config o 2º arg) |
| `src/cmux/client.js` (MODIFY) | consumer-wire | request-response (execFile) | self (funciones top-level `run`, `newWorkspace`) | exact (añadir opcional `{ logger }` en `run`) |
| `src/orchestrator/launch.js` (MODIFY) | consumer-wire + emisor `orchestrator.review` | request-response | self (función async `launchOrchestrator()` line 34) | exact |
| `test/logger-events.test.js` (NEW) | test | unit | `test/logger.test.js` (makeTmpHome + readAllLines + assert ndjson line shape) | exact |
| `test/logs-reader.test.js` (NEW) | test | integration | `test/logger.test.js` Test 4 (mock `process.stderr.write`) + `test/session-start.test.js` (importa módulo y asserta output) | role-match |
| `test/logs-session-of.test.js` (NEW) | test | integration | `test/state.test.js` + `test/logger-redaction.test.js` (patrón tmpHome + loadState) | role-match |
| `test/fixtures/events-golden.ndjson` (NEW) | fixture | data | ninguno — novel en este repo (no hay fixtures NDJSON aún) | no-analog |
| `test/helpers/logger-sink.js` (NEW) | test-helper | transform | `test/helpers/logger-fixtures.js` (makeTmpHome + readAllLines) | exact |

## Pattern Assignments

---

### `src/logger-events.js` (pure-module, transform: fields → NDJSON via logger.*)

**Analog:** `src/logger.js` (mismo file, estilo y pipeline). Reutiliza el sink NDJSON que ya redacta secretos.

**Imports pattern** (como `src/logger.js:16-18`):

```javascript
// @ts-check
//
// src/logger-events.js — Taxonomía cerrada de 7 eventos de ciclo de vida.
// Consumida por los 7 consumers vía DI del logger raíz.
// No abre archivos ni reabre sinks: delega en logger.info/warn/error
// que ya redacta + escribe en ~/.kodo/logs/<sess>.ndjson.
//

import { homedir } from 'node:os';
import { join } from 'node:path';
```

**Frozen const pattern** (copiado de `src/logger.js:25` y `:28`):

```javascript
// Fuente: src/logger.js:25
// export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
//
// Adapt para logger-events.js:
/** @type {Readonly<{
 *   SESSION_START: 'session.start',
 *   SESSION_END: 'session.end',
 *   STATE_TRANSITION: 'state.transition',
 *   ORCHESTRATOR_REVIEW: 'orchestrator.review',
 *   GSD_PHASE_RESOLVED: 'gsd.phase.resolved',
 *   GSD_BOOTSTRAP: 'gsd.bootstrap',
 *   PLANE_API_CALL: 'plane.api.call',
 * }>} */
export const EVENTS = Object.freeze({
  SESSION_START:        'session.start',
  SESSION_END:          'session.end',
  STATE_TRANSITION:     'state.transition',
  ORCHESTRATOR_REVIEW:  'orchestrator.review',
  GSD_PHASE_RESOLVED:   'gsd.phase.resolved',
  GSD_BOOTSTRAP:        'gsd.bootstrap',
  PLANE_API_CALL:       'plane.api.call',
});
```

**Pure helper pattern** (inspirado por `src/hooks/session-start.js:22-67` `buildSessionContext` — pure function, no I/O):

```javascript
/**
 * Deterministic transcript path. Pure — no I/O.
 * [VERIFIED empírico: /Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/<uuid>.jsonl exists]
 * @param {string} projectPath absolute
 * @param {string} sessionId UUID v4
 * @returns {string}
 */
export function resolveTranscriptPath(projectPath, sessionId) {
  const encoded = encodeURIComponent(projectPath).replace(/%2F/g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}
```

**Typed helper pattern** (inspirado por firma de `logger.js` emit + typedef):

```javascript
/**
 * Emit the 7-field session.start contract line.
 * @param {import('./logger.js').Logger} logger
 * @param {{ session_id: string,
 *           plane_task_id: string | null,
 *           provider: string,
 *           project_path: string,
 *           transcript_path?: string,
 *           started_at: string }} fields
 */
export function sessionStart(logger, fields) {
  const transcript_path = fields.transcript_path
    ?? resolveTranscriptPath(fields.project_path, fields.session_id);
  logger.info('session.start', {
    event: EVENTS.SESSION_START,
    session_id: fields.session_id,
    plane_task_id: fields.plane_task_id,
    provider: fields.provider,
    project_path: fields.project_path,
    transcript_path,
    started_at: fields.started_at,
  });
}
```

**JSDoc convention** (copiado de `src/logger.js:135-144`): `@typedef` para Logger + `@param`/`@returns` obligatorio en API público. Los 6 restantes (`sessionEnd`, `stateTransition`, `orchestratorReview`, `gsdPhaseResolved`, `gsdBootstrap`, `planeApiCall`) siguen exactamente la misma forma.

**Redacción:** NADA. El helper solo construye el objeto `ctx` y delega en `logger.info/warn/error`. El redactor de `logger.js:99-132` corre dentro de `emit()` → `redact()` (ya cubre `authorization`, `plane_api_key`, JWTs). Los eventos tipados NO llevan campos sensibles (session_id/task_id/path/status son públicos) — test de redacción queda verde sin cambios.

---

### `src/logs/reader.js` (CLI-action-handler, file-I/O + stdout)

**Analog:** `src/cli.js:189-211` (comando `status`) para la estructura del handler + `src/check.js` para el patrón scan+print.

**Imports pattern** (copia literal estilo `src/cli.js:1-5`):

```javascript
// @ts-check
import { readFileSync, existsSync, openSync, readSync, closeSync,
         watchFile, unwatchFile, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { LEVELS, formatLine } from '../logger.js';  // nuevos exports (wave 1 additive)
```

**Action handler delegation pattern** (fuente `src/cli.js:189-211`):

```javascript
// Source: src/cli.js:189-211 (comando `kodo status`)
program
  .command('status')
  .description('Show active sessions')
  .action(async () => {
    await ensureConfig();
    const { listSessions } = await import('./session/state.js');
    const sessions = listSessions();
    if (sessions.length === 0) {
      console.log('No active sessions.');
      return;
    }
    // ...
  });

// Adapt para `kodo logs`:
program
  .command('logs [session-id]')  // positional opcional (reemplazable por --session-of)
  .description('Inspect session log')
  .option('-f, --follow', 'Tail live output')
  .option('-l, --level <level>', 'Min level: debug|info|warn|error')
  .option('-c, --component <name>', 'Filter by component')
  .option('-e, --event-type <type...>', 'Filter by event type (repeatable)')
  .option('--json', 'Emit raw NDJSON (pipe-friendly)')
  .option('--session-of <task-id>', 'Resolve session-id from task id')
  .action(async (sessionId, opts) => {
    const { runLogs } = await import('./logs/reader.js');
    await runLogs({ sessionId, ...opts });
  });
```

**Error-exit pattern** (copiado de `src/cli.js:137-140` del comando `orchestrate`):

```javascript
// Fuente: src/cli.js:137-140
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

// Adapt en reader.js:
if (!sessionId) {
  console.error('Usage: kodo logs <session-id> | kodo logs --session-of <task-id>');
  process.exit(2);
}
```

**Dump loop + filter + print pattern** (inspirado `src/session/state.js:60-68` readFileSync + parse + filter):

```javascript
// Source synthesis of:
//   - src/logger.js:207-209 appendFileSync pattern (reverso: readFileSync + split)
//   - src/session/state.js:60-68 try/catch JSON.parse defensive
// Pretty path: reuse formatLine exported desde logger.js
const raw = readFileSync(filePath, 'utf-8');
for (const line of raw.split('\n')) {
  if (!line) continue;
  let rec;
  try { rec = JSON.parse(line); }
  catch { process.stdout.write(`[malformed] ${line}\n`); continue; }
  if (LEVELS[rec.level] < minLevelNum) continue;
  if (opts.component && rec.component !== opts.component) continue;
  if (opts.eventType?.length && !opts.eventType.includes(rec.event)) continue;
  if (opts.json) {
    process.stdout.write(line + '\n');
  } else {
    process.stdout.write(formatLine(rec, { useColor }) + '\n');
  }
}
```

**TTY+NO_COLOR detection** (copiado EXACTO de `src/logger.js:164`):

```javascript
// Fuente: src/logger.js:164
// const useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
//
// En reader.js usamos stdout (no stderr):
const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
```

---

### `src/logs/follow.js` (io-module watcher) — NOVEL

**Analog:** ninguno. RESEARCH Pattern 3 es la fuente; sigue convenciones del repo (ESM puro, funciones top-level, try/catch defensivo).

**Pattern a implementar** (verbatim de RESEARCH.md:328-384):

```javascript
// @ts-check
import { watchFile, unwatchFile, openSync, readSync, closeSync,
         existsSync, statSync } from 'node:fs';

const FOLLOW_INTERVAL_MS = 200;  // exportable para test override

/**
 * Tail-follow con buffer para líneas parciales.
 * Semántica `tail -f`: dump completo + live append.
 * Si el archivo no existe, espera hasta que aparezca (poll).
 *
 * @param {string} filePath
 * @param {(line: string) => void} onLine called once per complete JSON line
 */
export function followFile(filePath, onLine) {
  let readFrom = 0;
  let buffer = '';

  if (existsSync(filePath)) {
    drainFrom(filePath, 0);
    readFrom = statSync(filePath).size;
  } else {
    process.stderr.write(`waiting for session log to appear...\n`);
  }

  watchFile(filePath, { interval: FOLLOW_INTERVAL_MS }, (curr, prev) => {
    if (curr.size === 0 && prev.size === 0) return;
    if (curr.size < prev.size) { readFrom = 0; buffer = ''; }
    if (curr.size > readFrom) { drainFrom(filePath, readFrom); readFrom = curr.size; }
  });

  process.on('SIGINT', () => { unwatchFile(filePath); process.exit(0); });

  function drainFrom(path, start) {
    const fd = openSync(path, 'r');
    try {
      const size = statSync(path).size - start;
      if (size <= 0) return;
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, start);
      buffer += buf.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop();
      for (const line of parts) if (line) onLine(line);
    } finally {
      closeSync(fd);
    }
  }
}
```

**Convención del repo preservada:** JSDoc `@param` obligatorio, try/finally para liberar fd, ES modules puros, zero deps.

---

### `src/logs/session-lookup.js` (resolver `--session-of`, dos pasos)

**Analog:** `src/session/state.js:133-147` (`findSession({ cwd, workspaceRef })`) + scan readdirSync style similar a ausencia propia del repo (se hand-rolls stdlib).

**Step 1 — loadState pattern** (copiado literal de `src/session/state.js:60-68`):

```javascript
// Fuente: src/session/state.js:60-68
// export function loadState() {
//   migrateStateIfNeeded();
//   if (!existsSync(STATE_PATH)) return { schema_version: 2, sessions: {} };
//   try {
//     return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
//   } catch { return { schema_version: 2, sessions: {} }; }
// }

// Adapt para session-lookup.js:
import { loadState } from '../session/state.js';

export async function resolveSessionIdFromTaskId(taskId) {
  // Step 1: state.json in-memory index
  const state = loadState();
  const hit = Object.values(state.sessions).find(
    (s) => s.task_id === taskId || s.task_ref === taskId
  );
  if (hit) return hit.session_id;

  // Step 2: scan logs/ ...
}
```

**Step 2 — head-line scan pattern** (NOVEL — RESEARCH Pattern 2):

```javascript
// head-line-read: NO usar readline — lee archivo entero.
// fs.openSync + readSync(buf, 4096) + indexOf('\n').
import { openSync, readSync, closeSync, readdirSync, existsSync } from 'node:fs';
const MAX_HEADLINE_BYTES = 65536;

function readFirstLine(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    let acc = '';
    let pos = 0;
    while (acc.length < MAX_HEADLINE_BYTES) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) return null;
      const chunk = buf.slice(0, n).toString('utf8');
      const nl = chunk.indexOf('\n');
      if (nl !== -1) return acc + chunk.slice(0, nl);
      acc += chunk;
      pos += n;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
```

**Multi-match sort + warn pattern** (inspirado `src/check.js` stderr convention + `src/cli.js:175-176` console.log+warn):

```javascript
// Source: convención stderr del repo (console.error / process.stderr.write)
// Sort desc by ISO-8601 timestamp: lexicographic ordering coincide con cronológico.
matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
if (matches.length > 1) {
  process.stderr.write(`Multiple sessions for task ${taskId}:\n`);
  for (const m of matches.slice(1)) {
    process.stderr.write(`  ${m.sessionId}  ${m.timestamp}\n`);
  }
  process.stderr.write(`Using most recent: ${matches[0].sessionId}\n\n`);
}
return matches[0].sessionId;
```

---

### `src/cli.js` (MODIFY — register `kodo logs`)

**Analog:** self (`.command('launch <ref>')` lines 144-187 es el sub-comando de referencia para positional opcional + opts).

**Insertion point:** entre `.command('status')` (line 189) y `program.parse()` (line 213). Commander 13 soporta variadic `<type...>` sin configuración extra — VERIFIED en RESEARCH.

**Pattern excerpt** (adapta `src/cli.js:143-187`):

```javascript
// Source: src/cli.js:143-187 (comando `kodo launch`)
program
  .command('launch <ref>')
  .description('Launch a Claude Code session for a task (e.g. KL-42)')
  .option('--model <model>', 'Override Claude model')
  .option('--yolo', 'Skip confirmation prompts')
  .option('--force', 'Skip kodo label requirement')
  .action(async (ref, opts) => {
    await ensureConfig();
    try {
      // ... dynamic import + delegation
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// Adapt exacto para `kodo logs`:
program
  .command('logs [session-id]')
  .description('Inspect a session log (dump, tail, filter)')
  .option('-f, --follow', 'Tail live output (like tail -f)')
  .option('-l, --level <level>', 'Min log level: debug|info|warn|error')
  .option('-c, --component <name>', 'Filter by component')
  .option('-e, --event-type <type...>', 'Filter by event type (repeatable)')
  .option('--json', 'Emit raw NDJSON (pipe-friendly)')
  .option('--session-of <task-id>', 'Resolve session-id from task id')
  .action(async (sessionId, opts) => {
    try {
      const { runLogs } = await import('./logs/reader.js');
      await runLogs({ sessionId, ...opts });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Dynamic import convention** (preservada — el repo usa `await import()` para todos los lazy loads en cli.js — líneas 25, 73, 82, 94, 111, 120, 130, 153, 194):

```javascript
// Fuente: src/cli.js:194
// const { listSessions } = await import('./session/state.js');
```

---

### `src/logger.js` (MODIFY — additive exports)

**Analog:** self. Extract-and-export del private `formatCtxInline` + `COLOR_BY_LEVEL` existentes.

**Change 1 — promote constants to export** (líneas 31-42):

```javascript
// Source: src/logger.js:31-42 (actualmente privados)
// const ANSI_RESET = '\x1b[0m';
// const COLOR_BY_LEVEL = Object.freeze({ ... });

// Change: simplemente añadir `export` a los existentes:
export const ANSI_RESET = '\x1b[0m';
const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

export const COLOR_BY_LEVEL = Object.freeze({
  debug: ANSI_GRAY,
  info: ANSI_CYAN,
  warn: ANSI_YELLOW,
  error: ANSI_RED,
});
```

**Change 2 — extract `formatLine` from `maybeMirrorToStderr`** (fuente `src/logger.js:222-238`):

```javascript
// Source: src/logger.js:222-238 (actual emissor stderr)
// function maybeMirrorToStderr(level, record) { ... }
//
// Extraer el cuerpo del formato a función pura exportada:

/**
 * Pretty-format a log record. Shared by stderr mirror AND `kodo logs` CLI.
 * Pure — no I/O.
 * @param {object} record
 * @param {{ useColor: boolean }} opts
 * @returns {string}
 */
export function formatLine(record, { useColor }) {
  const time = String(record.timestamp).slice(11, 19);
  const lvl = String(record.level).toUpperCase();
  const c = useColor ? COLOR_BY_LEVEL[record.level] : '';
  const r = useColor ? ANSI_RESET : '';
  const comp = record.component ? ` ${record.component}` : '';
  const ctx = formatCtxInline(record);
  return `${time} ${c}${lvl}${r}${comp} ${record.msg}${ctx}`;
}
```

`maybeMirrorToStderr` ahora se convierte en:

```javascript
function maybeMirrorToStderr(level, record) {
  const isTTY = Boolean(process.stderr.isTTY);
  const mirror =
    level === 'error' ||
    level === 'warn' ||
    (level === 'info' && isTTY && minLevelNum <= LEVELS.info) ||
    (level === 'debug' && isTTY && minLevelNum <= LEVELS.debug);
  if (!mirror) return;
  process.stderr.write(formatLine(record, { useColor }) + '\n');
}
```

**Change 3 — mover `formatCtxInline` fuera del closure de `createLogger`** para que `formatLine` (top-level) pueda llamarla. Ya es pura (líneas 246-257) — solo cambiar su scope. No afecta tests existentes.

**Guardado por:** `test/logger.test.js` Test LOG-04 (stderr pretty-print sigue siendo idéntico) + `test/check-isolation.test.js` (logger.js sigue prohibido en grafo de check.js — sin cambios al grafo, solo exports nuevos).

---

### `src/hooks/session-start.js` (MODIFY — emisor `session.start`)

**Analog:** self. El hook ya pattern-matched: lee stdin payload, hace `findSession`, emite output. Añadir emisión de `sessionStart(logger, fields)` antes del `process.stdout.write(output)`.

**DI pattern para hooks** (hook corre como proceso separado — crea su propio root logger):

```javascript
// Fuente: src/hooks/session-start.js:81-109 (main actual)
async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const result = findSession({ sessionId, cwd });
    if (!result) process.exit(0);
    const { session } = result;
    const config = loadConfig();
    const context = buildSessionContext(session, config);
    // ... stdout.write
  } catch {
    // Silent failure — never break Claude Code startup
  }
}

// ADD: emisión typed antes de stdout.write. Nunca throw — preserva silent failure.
async function main() {
  try {
    const input = JSON.parse(await readStdin());
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const result = findSession({ sessionId, cwd });
    if (!result) process.exit(0);
    const { session } = result;
    const config = loadConfig();

    // NEW: typed emisión (best effort — silent on failure)
    try {
      const { createLogger } = await import('../logger.js');
      const { sessionStart } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: session.session_id,
        minLevel: process.env.KODO_LOG_LEVEL || 'info',
      }).child({ component: 'hook', plane_task_id: session.task_id });
      sessionStart(log, {
        session_id: session.session_id,
        plane_task_id: session.task_id,
        provider: session.provider,
        project_path: session.project_path,
        transcript_path: input.transcript_path,  // Claude payload if present; fallback in helper
        started_at: new Date().toISOString(),
      });
    } catch {}  // silent — hook must never crash Claude

    const context = buildSessionContext(session, config);
    // ... stdout.write unchanged
  } catch {}
}
```

**Silent-failure preservation** (crítico — línea 106-108 existente):

```javascript
// Fuente: src/hooks/session-start.js:106-108
// } catch {
//   // Silent failure — never break Claude Code startup
// }
//
// Mantenido intacto; el try/catch nuevo anida dentro sin cambiar el outer.
```

---

### `src/hooks/stop.js` (MODIFY — emisor `session.end`)

**Analog:** self + `session-start.js` (simetría).

**Insertion point:** justo antes de `removeSession(id)` línea 82. El status se obtiene de `session.status` del state actual (antes de remover).

```javascript
// Fuente: src/hooks/stop.js:60-82
const { id, session } = result;
try {
  await cmux.setColor({ /*...*/ });
} catch (err) { /*...*/ }

// NEW: typed emisión (best effort)
try {
  const { createLogger } = await import('../logger.js');
  const { sessionEnd } = await import('../logger-events.js');
  const log = createLogger({
    sessionId: session.session_id,
    minLevel: process.env.KODO_LOG_LEVEL || 'info',
  }).child({ component: 'hook', plane_task_id: session.task_id });
  sessionEnd(log, {
    session_id: session.session_id,
    plane_task_id: session.task_id,
    status: session.status,       // 'running'|'done'|'error'|'review' — ver state.js:17
    ended_at: new Date().toISOString(),
  });
} catch {}

removeSession(id);
```

---

### `src/session/state.js` (MODIFY optional — D-14 `(si emite)`)

**Analog:** self. API existente `addSession(taskId, session)` línea 79.

**Constraint crítico (D-16 + LOG-12):** `state.js` NO puede importar `logger.js` a nivel módulo — el grafo de `check.js:check.js → state.js` haría fallar `test/check-isolation.test.js`. Solución: aceptar `logger` como arg opcional defaulting a `noopLogger` (ya importable sin I/O).

```javascript
// Fuente: src/session/state.js:79-83 (actual)
// export function addSession(taskId, session) {
//   const state = loadState();
//   state.sessions[taskId] = session;
//   saveState(state);
// }

// Adapt con DI opcional:
import { noopLogger } from '../logger-noop.js';  // SAFE — zero imports, no triggers LOG-12
// NO import de logger.js. NO import de logger-events.js (que importa path/os — ok pero los callsites no necesitan typed events aquí: transición de estado más útil lanzada por session/manager.js).

/**
 * @param {string} taskId
 * @param {import('./state.js').Session} session
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 */
export function addSession(taskId, session, logger = noopLogger) {
  const state = loadState();
  state.sessions[taskId] = session;
  saveState(state);
  logger.info('state.session.added', { task_id: taskId, status: session.status });
}
```

**Safety:** `noopLogger` (líneas 22-28 de `logger-noop.js`) tiene zero imports y es freeze — el walker de `test/check-isolation.test.js` permite su presencia explícitamente (`logger-noop.js is allowed in the check.js graph`).

---

### `src/providers/plane/client.js` (MODIFY — emisor `plane.api.call`)

**Analog:** self. Método `async request(path, opts)` líneas 22-75 es el único callsite de `fetch()` en el cliente.

**Insertion point:** tras `if (!res.ok)` y antes de `return res.json()` (línea 73). Medir `duration_ms` con `Date.now()` antes del `fetch`.

```javascript
// Fuente: src/providers/plane/client.js:22-75 (actual)
async request(path, opts = {}) {
  const url = new URL(/*...*/);
  // ...
  while (true) {
    const started = Date.now();
    const res = await fetch(url, { /*...*/ });
    // ...
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
    }
    // NEW: typed emisión (best effort; no block request)
    if (this.logger) {
      try {
        const { planeApiCall } = await import('../../logger-events.js');
        planeApiCall(this.logger, {
          method: opts.method || 'GET',
          path,
          status: res.status,
          duration_ms: Date.now() - started,
        });
      } catch {}
    }
    return res.json();
  }
}
```

**Constructor DI extension** (modificar constructor líneas 5-15):

```javascript
// Fuente: src/providers/plane/client.js:5-15 (constructor actual)
constructor(opts = {}) {
  const config = loadConfig();
  this.baseUrl = (opts.baseUrl || config.plane.base_url).replace(/\/$/, '');
  this.apiKey = opts.apiKey || getPlaneApiKey();
  this.workspaceSlug = opts.workspaceSlug || config.plane.workspace_slug;
  // ADD:
  this.logger = opts.logger;  // opcional; noopLogger si no se pasa
  if (!this.apiKey) { /*...*/ }
}
```

**Excepción de clase preservada:** `PlaneClient` es una de las pocas clases del repo (ver PROJECT.md convention). Añadir `this.logger` no cambia la naturaleza.

---

### `src/providers/plane/provider.js` (MODIFY — DI al cliente)

**Analog:** self. La factory `createPlaneProvider(config)` línea 23 ya instancia `PlaneClient` línea 24.

```javascript
// Fuente: src/providers/plane/provider.js:23-28 (actual)
export function createPlaneProvider(config) {
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
  });

// Adapt — acepta logger en config o como 2º arg:
/**
 * @param {PlaneProviderConfig} config
 * @param {{ logger?: import('../../logger.js').Logger }} [opts]
 */
export function createPlaneProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'plane' });
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
    logger,  // pass through
  });
  // ...
}
```

---

### `src/cmux/client.js` (MODIFY — consumer-wire sin evento tipado)

**Analog:** self. Funciones top-level `run`, `newWorkspace`, `send`, etc.

**Change:** añadir opcional `logger` param a `run()` (función base línea 13). No hay evento tipado para cmux (no está en los 7) pero el logger permite debug-level traces útiles.

```javascript
// Fuente: src/cmux/client.js:13-23 (actual)
function run(args) {
  return new Promise((resolve, reject) => {
    execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) { reject(/*...*/); return; }
      resolve(stdout.trim());
    });
  });
}

// Adapt: opcional logger (fallback implícito: no emite nada si no hay).
function run(args, logger) {
  return new Promise((resolve, reject) => {
    logger?.debug('cmux.exec', { cmd: args[0], args: args.slice(1).length });
    execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        logger?.warn('cmux.fail', { cmd: args[0], stderr });
        reject(new Error(`cmux ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
```

**Propagation:** cada helper (`newWorkspace`, `send`, …) acepta opcionalmente `{ logger }` en opts y lo pasa a `run`. Callsites en `session/manager.js` y `orchestrator/launch.js` pasan su logger bindeado. Sin cambios breaking — el default `undefined` no emite.

---

### `src/orchestrator/launch.js` (MODIFY — emisor `orchestrator.review`)

**Analog:** self. Función async `launchOrchestrator()` línea 34 es single entrypoint.

**Change:** aceptar logger opcional, hacer `.child({ component: 'orchestrator' })`, emitir `orchestratorReview(log, ...)` cuando procese el veredict de revisión (Fase 10 formaliza; Fase 7 solo prepara el callsite con firma correcta).

```javascript
// Fuente: src/orchestrator/launch.js:34 (actual)
// export async function launchOrchestrator() {

/**
 * @param {{ logger?: import('../logger.js').Logger }} [opts]
 */
export async function launchOrchestrator(opts = {}) {
  const log = opts.logger?.child({ component: 'orchestrator' });
  const config = loadConfig();
  // ... unchanged flow
  // En Fase 7 no emitimos orchestrator.review aún (se hace en Fase 10 en el gate verifier).
  // Pero dejamos el logger cableado listo.
}
```

---

### `src/session/manager.js` (MODIFY — consumer-wire + emisor `state.transition`)

**Analog:** self. Factory-shape functions (`buildSessionFromTask`, `createManaged…`). DI por arg opcional.

**`state.transition` callsite** (al cambiar `session.status` via `updateSession`). Manager es el callsite canónico cuando transiciona el estado:

```javascript
// Adapt al finalizar una tarea (ejemplo callsite):
import { stateTransition } from '../logger-events.js';

export async function markSessionDone(taskId, logger) {
  const prev = getSession(taskId);
  if (!prev) return;
  updateSession(taskId, { status: 'done' });
  const log = logger?.child({ component: 'session', plane_task_id: taskId });
  if (log) {
    stateTransition(log, { from: prev.status, to: 'done', reason: 'claude_exit' });
  }
}
```

---

## Shared Patterns

### Logger root creation (entrypoint)

**Source:** D-13 (nuevo) + `src/cli.js` estilo commander action.
**Apply to:** `src/cli.js` (todas las action handlers que necesitan logger), `src/server.js`.
**Pattern excerpt:**

```javascript
// Añadir en cli.js global (antes de `program.parse()` o dentro del action si sessionId es conocido):
function makeRootLogger(sessionId, flagLevel) {
  const minLevel = flagLevel || process.env.KODO_LOG_LEVEL || 'info';
  return createLogger({ sessionId, minLevel });
}
// Precedencia: flag CLI > KODO_LOG_LEVEL env > 'info' default.
```

### DI convention (cómo pasa root → consumers)

**Source:** patrón existente `createPlaneProvider(config)` — factory que recibe config, devuelve provider.
**Apply to:** `session/manager.js`, `providers/plane/provider.js`, `providers/plane/client.js` (constructor), `cmux/client.js` (opcional arg), `hooks/*.js` (crea su propio dentro del hook), `orchestrator/launch.js`.

**Pattern:**

```javascript
// Consumer API shape:
export function createManagedThing(config, { logger } = {}) {
  const log = logger?.child({ component: '<name>' });
  // use log?.info(...) everywhere — if undefined, nothing emitted (noop-safe)
}
```

### Silent-failure on logger I/O (hooks)

**Source:** `src/hooks/session-start.js:106-108` silent catch.
**Apply to:** ambos hooks (`session-start.js`, `stop.js`). Nested try/catch alrededor de la emisión tipada dentro del main try/catch existente.

```javascript
try {
  // ... logger-events emission
} catch {}  // never crash Claude Code
```

### JSDoc `@typedef` for Logger

**Source:** `src/logger.js:135-144`.
**Apply to:** `logger-events.js` JSDoc params + cualquier consumer que declare la firma.

```javascript
/** @param {import('./logger.js').Logger} logger */
```

### Test fixture pattern (tmp HOME + readAllLines)

**Source:** `test/helpers/logger-fixtures.js:10-29`.
**Apply to:** `test/logger-events.test.js`, `test/logs-reader.test.js`, `test/logs-session-of.test.js`.

```javascript
// Fuente literal: test/helpers/logger-fixtures.js
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';
const fx = makeTmpHome({ sessionId: 'sess-events-unit', label: 'events' });
after(() => fx.cleanup());
const { createLogger } = await import('../src/logger.js');
```

### Test structure: describe + it + strict assertions

**Source:** `test/logger.test.js:12-32` (el template de todos los tests del repo).

```javascript
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

describe('LOG-XX: capability name', () => {
  it('does X when Y', () => {
    // setup
    const log = createLogger({ sessionId, minLevel: 'info' });
    // act
    someHelper(log, fields);
    // assert
    const lines = readAllLines(fx.logPath);
    assert.equal(lines[lines.length - 1].event, EVENTS.SESSION_START);
  });
});
```

### Mock stdout/stderr pattern

**Source:** `test/logger.test.js:75-89` y `test/logger-redaction.test.js:38-46` — `t.mock.method(process.stderr, 'write', ...)`.
**Apply to:** `test/logs-reader.test.js` (capturar stdout para verificar formato pretty / filtrado).

```javascript
it('prints only lines matching --level warn', (t) => {
  const captured = [];
  t.mock.method(process.stdout, 'write', (chunk) => { captured.push(chunk.toString()); return true; });
  // run reader...
  assert.equal(captured.every(l => !l.includes('INFO')), true);
});
```

### Defensive JSON.parse

**Source:** `src/session/state.js:60-68` (try/catch wrapping `JSON.parse(readFileSync(...))`).
**Apply to:** `src/logs/reader.js` (por línea), `src/logs/session-lookup.js` (head-line). Malformed líneas → continue, nunca crash.

### Scripts `isMainEntry` guard (hooks)

**Source:** `src/hooks/session-start.js:112-114`.
**Apply to:** si algún hook nuevo se añade — no relevante para Fase 7 puros tests, sí para stop.js si se modifica comportamiento main.

```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

---

## No Analog Found

Estas piezas son novel — el planner debe implementarlas siguiendo RESEARCH.md patterns (ya hand-rolled + verified empíricamente):

| File/Pattern | Role | Reason | Reference |
|--------------|------|--------|-----------|
| `readFirstLine(filePath)` (head-line read) | pure fn | No existe utility similar en el repo; `node:readline` lee demasiado | RESEARCH Pattern 2 (verified empírico con `openSync + readSync`) |
| `followFile(path, onLine)` (tail + wait-exists) | io fn | No hay watchers en el repo actualmente | RESEARCH Pattern 3 (verified empírico con `fs.watchFile`) |
| `resolveTranscriptPath(projectPath, sessionId)` | pure fn | Convención externa (Claude Code dir layout) | VERIFIED `/Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/<uuid>.jsonl` |
| `test/fixtures/events-golden.ndjson` | data fixture | Primer fixture NDJSON del repo | 1 línea por cada uno de los 7 tipos con contrato completo |

Todas tienen cobertura de test definida (RESEARCH §Validation Architecture).

---

## Metadata

**Analog search scope:** `src/**/*.js`, `test/**/*.js`, `test/helpers/*.js`
**Files scanned:** 43 (tree completo de src + test)
**Pattern extraction date:** 2026-04-16
**Confidence:** HIGH — 100% de los archivos a modificar tienen analog exacto (self-analog) o role-match fuerte. Los 3 módulos novel (head-line, follow, transcript path) tienen pattern completo verified en RESEARCH.

**Canonical analogs at a glance:**

| Analog File | Used For |
|-------------|----------|
| `src/logger.js` | logger-events.js estilo, formatLine/COLOR_BY_LEVEL extract |
| `src/cli.js:143-187` | registro de `kodo logs` sub-command |
| `src/cli.js:189-211` | CLI action handler shape con ensureConfig + dynamic import |
| `src/hooks/session-start.js:81-114` | hook emisor pattern + silent failure |
| `src/session/state.js:60-147` | loadState + JSON.parse defensive + findSession |
| `src/providers/plane/client.js:22-75` | request wrapper + planeApiCall insertion point |
| `src/providers/plane/provider.js:23` | factory con DI de config |
| `test/helpers/logger-fixtures.js` | makeTmpHome + readAllLines (reusable directo) |
| `test/logger.test.js` | describe/it/assert.strict + fixture flow |
| `test/logger-redaction.test.js:38-46` | mock stderr con `t.mock.method` |
| `test/check-isolation.test.js` | guardián LOG-12 (intocable, validar que logger-events.js NO entra en grafo de check.js) |

**Isolation invariant (LOG-12):** `src/logger-events.js` importa `node:os` + `node:path` (ok — stdlib, no matchea `/\/logger\.js$/`). Los consumers que lo usan vienen de `cli.js` / `server.js` / `hooks/*.js` — ninguno está en el grafo de `check.js`. Verificación mecánica en CI por `test/check-isolation.test.js` (no requiere extensión — la regex `/\/logger\.js$/` sigue solo matcheando `logger.js`, no `logger-events.js`).
