# Phase 19: Worktree Cleanup & Integration - Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 7 (3 source + 4 test)
**Analogs found:** 7 / 7

## File Classification

| Archivo (new/modified) | Rol | Data Flow | Analog más cercano | Match Quality |
|------------------------|-----|-----------|--------------------|---------------|
| `src/hooks/stop.js` (MODIFY) | hook (lifecycle handler) | event-driven + file-I/O (git CLI out-of-process) | `src/hooks/stop.js:195-200` (`releaseGsdLock` block), `src/hooks/stop.js:238-272` (`handleOrchestratorStop` git execSync) | exact (mismo archivo, mismas funciones-vecinas) |
| `src/gsd/verify.js` (MODIFY, 1 línea) | service (verification gate) | request-response (filesystem read) | `src/gsd/verify.js:121-124` (resolución actual de `padded` + `phasesRoot`) | exact (cambio in-situ) |
| `src/logger-events.js` (MODIFY, +3 helpers) | utility (typed event helpers) | transform (pure) | `src/logger-events.js:103-111` (`sessionEnd`), `:126-139` (`orchestratorReview` warn-level), `:189-204` (`planeApiCallFailed` error-level) | exact (templates verbatim) |
| `test/stop-worktree-cleanup.test.js` (NEW) | test (mixed unit + E2E) | file-I/O + child_process | `test/skill-auto-commit.test.js:24-99` (mkdtempSync + git init + spawnSync child), `test/gsd-verify-integration.test.js:23-101` (in-process DI + memSink logger) | exact (estructura mixta verified empíricamente como canon) |
| `test/logger-events.test.js` (EXTEND) | test (contract) | transform assertion | `test/logger-events.test.js:102-114` (`sessionEnd` test), `:127-140` (`orchestratorReview` test) | exact (mismo archivo) |
| `test/gsd-verify-integration.test.js` (EXTEND) | test (E2E fixtures) | file-I/O | `test/gsd-verify-integration.test.js:103-120` (fixture VERIFICATION.md pass), `:37-52` (`makeSession()` factory) | exact (mismo archivo) |
| `test/stop.test.js` (EXTEND) | test (source-hygiene + behavior) | source regex grep | `test/stop.test.js:41-51` (`releases lock before removeSession` order check) | exact (mismo archivo, mismo tipo de assertion) |

**Resumen del coverage:** 7/7 archivos con analog exact en el codebase. **Cero novel patterns en Phase 19.** Cada archivo modificado o creado copia su shape de código ya en producción (mayoría de Phase 16 LOG-15 + Phase 999.1 D-16 + Phase 9 D-14).

---

## Pattern Assignments

### 1. `src/hooks/stop.js` (MODIFY) — hook, event-driven + file-I/O

**Analog #1 (in-file):** `src/hooks/stop.js:195-200` — patrón canonical de try/catch fail-open con dynamic import.

**Excerpt** (líneas 195-200):

```javascript
try {
  const { releaseGsdLock } = await import('../gsd/lock.js');
  releaseGsdLock(session.project_path, session.session_id);
} catch (err) {
  console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
}
```

**Por qué este es el analog:** Es el bloque INMEDIATAMENTE anterior al sitio donde Phase 19 inyecta el cleanup. Mismo shape (dynamic import + sync op + catch con `console.error`). El planner debe copiar este patrón para los 5 try/catch del cleanup (status, branch read, remove/move, branch -D, prune) — D-03/D-08.

**Analog #2 (in-file):** `src/hooks/stop.js:238-272` — `handleOrchestratorStop` patrón git CLI via execSync.

**Excerpt** (líneas 239-246, 257-261):

```javascript
const { execSync } = await import('node:child_process');

try {
  const status = execSync('git status --porcelain .claude/skills/', {
    cwd: KODO_ROOT,
    encoding: 'utf-8',
  }).trim();
  // ...
  execSync(`git -c commit.gpgsign=false add .claude/skills/ && git -c commit.gpgsign=false commit -m "skill: orchestrator learnings ${date}"`, {
    cwd: KODO_ROOT,
    encoding: 'utf-8',
  });
```

**Por qué este es el analog:** Precedent ESTABLECIDO en este mismo archivo de invocar git via `execSync(string, { cwd, encoding })` para operaciones de side-effect. RESEARCH §"Anti-Patterns" recomienda `execFileSync('git', [...args])` para Phase 19 (más robusto vs shell parsing y más facilita stubs `gitFn` en tests), pero la elección entre `execSync` y `execFileSync` queda a discreción del planner — ambas siguen el patrón establecido.

**Analog #3 (in-file):** `src/hooks/stop.js:97-101` — firma `runStopHook(input, deps)` con defaults vía OR.

**Excerpt** (líneas 97-101):

```javascript
export async function runStopHook(input, deps = {}) {
  // W-4: defaults vía OR — runtime productivo usa los imports estáticos.
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  const cmuxClient = deps.cmux || cmux;
```

**Diff sugerido — Phase 19 añade UNA dep nueva (`gitFn`)** (alternativa: `execFileSync` import dinámico, sin DI; el planner decide):

```javascript
const gitFn = deps.gitFn || ((cwd, args) => {
  const { execFileSync } = require('node:child_process'); // o await import en función async
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
});
```

**Analog #4 (in-file):** `src/hooks/stop.js:123` — closure local `const { id, session } = result;` para leer datos PRE-removeSession.

**Excerpt** (línea 123):

```javascript
const { id, session } = result;
```

**Por qué importa:** `session.worktree_path` se lee de esta closure local, ANTES de `removeSession(id)` (línea 203). RESEARCH §Summary punto 2 lo confirma: el cleanup debe leer `session.worktree_path` desde la variable de closure, NO desde un re-fetch de `findSession` (porque tras `removeSession` el record vive en `state.history` y `findSession` solo busca en `state.sessions` — bug latente D-07).

**Sitio de inyección del nuevo bloque cleanup:** entre línea 201 (cierre del `if (session.gsd) { ... releaseGsdLock ... }`) y línea 203 (`removeSessionFn(id)`). Orden recomendado por RESEARCH: `cleanup → removeSession → notify-orchestrator` para que el nudge pueda referenciar `moved_to` si dirty.

**Restricciones duras:**
- D-07: cleanup DESPUÉS de `releaseGsdLock` (línea 197).
- D-05: NO tocar `handleOrchestratorStop` (líneas 238-272).
- D-09: skip silencioso si `!session.worktree_path` (legacy v0.5).

---

### 2. `src/gsd/verify.js` (MODIFY, 1 línea) — service, request-response

**Analog (in-file):** `src/gsd/verify.js:121-124` — resolución actual de `padded` + `phasesRoot`.

**Excerpt actual** (líneas 121-124):

```javascript
const padded = /^\d+$/.test(session.phase_id)
  ? session.phase_id.padStart(2, '0')
  : session.phase_id; // "02.1" se queda como está
const phasesRoot = join(session.project_path, '.planning', 'phases');
```

**Diff sugerido (cambio quirúrgico de 1 línea + actualización JSDoc del header):**

```javascript
const padded = /^\d+$/.test(session.phase_id)
  ? session.phase_id.padStart(2, '0')
  : session.phase_id;
// Phase 19 D-06: lee del worktree cuando existe (sesiones v0.6+),
// fallback silent a project_path para sesiones legacy v0.5 sin worktree_path (D-09).
const phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases');
```

**Patrón de "campo aditivo opcional + fallback nullish coalescing"** ya consagrado:
- Phase 11 D-08 (`gsd_mode`).
- Phase 18 D-03c (`worktree_path` persistido como aditivo opcional).
- D-06 + D-09 lo extienden al consumer.

**No tocar:** El resto de `runGsdVerify` (líneas 71-181) queda intacto. Sólo `phasesRoot` y el JSDoc del header (líneas 1-31 del archivo) se actualizan para reflejar el fallback.

---

### 3. `src/logger-events.js` (MODIFY) — utility, pure transform

**Analog #1 (in-file):** `src/logger-events.js:30-39` — `EVENTS` frozen object.

**Excerpt actual** (líneas 30-39):

```javascript
export const EVENTS = Object.freeze({
  SESSION_START:          'session.start',
  SESSION_END:            'session.end',
  STATE_TRANSITION:       'state.transition',
  ORCHESTRATOR_REVIEW:    'orchestrator.review',
  GSD_PHASE_RESOLVED:     'gsd.phase.resolved',
  GSD_BOOTSTRAP:          'gsd.bootstrap',
  PLANE_API_CALL:         'plane.api.call',
  PLANE_API_CALL_FAILED:  'plane.api.call.failed',
});
```

**Diff sugerido (extender el frozen object + actualizar JSDoc del `@type`):**

```javascript
export const EVENTS = Object.freeze({
  SESSION_START:           'session.start',
  SESSION_END:             'session.end',
  STATE_TRANSITION:        'state.transition',
  ORCHESTRATOR_REVIEW:     'orchestrator.review',
  GSD_PHASE_RESOLVED:      'gsd.phase.resolved',
  GSD_BOOTSTRAP:           'gsd.bootstrap',
  PLANE_API_CALL:          'plane.api.call',
  PLANE_API_CALL_FAILED:   'plane.api.call.failed',
  WORKTREE_CLEANUP_OK:     'worktree.cleanup.ok',
  WORKTREE_CLEANUP_DIRTY:  'worktree.cleanup.dirty',
  WORKTREE_CLEANUP_ERROR:  'worktree.cleanup.error',
});
```

**Analog #2 (in-file):** `src/logger-events.js:94-111` — helper `sessionEnd` (level `info`).

**Excerpt actual** (líneas 94-111):

```javascript
/**
 * @param {Logger} logger
 * @param {{
 *   session_id: string,
 *   task_id: string | null,
 *   status: 'done' | 'error' | 'review' | 'interrupted' | 'running',
 *   ended_at: string,
 * }} fields
 */
export function sessionEnd(logger, fields) {
  logger.info(EVENTS.SESSION_END, {
    event: EVENTS.SESSION_END,
    session_id: fields.session_id,
    task_id: fields.task_id,
    status: fields.status,
    ended_at: fields.ended_at,
  });
}
```

**Analog #3 (in-file):** `src/logger-events.js:126-139` — helper `orchestratorReview` con level condicional (`info`|`warn`).

**Excerpt actual** (líneas 126-139):

```javascript
/**
 * @param {Logger} logger
 * @param {{ phase_id: string, verdict: 'approved' | 'blocked', reason: string }} fields
 */
export function orchestratorReview(logger, fields) {
  // verdict !== 'approved' → warn para espejar a stderr también
  const level = fields.verdict === 'approved' ? 'info' : 'warn';
  logger[level](EVENTS.ORCHESTRATOR_REVIEW, {
    event: EVENTS.ORCHESTRATOR_REVIEW,
    phase_id: fields.phase_id,
    verdict: fields.verdict,
    reason: fields.reason,
  });
}
```

**Analog #4 (in-file):** `src/logger-events.js:189-204` — helper `planeApiCallFailed` (level `error`).

**Excerpt actual** (líneas 189-204):

```javascript
/**
 * Emitido cuando una llamada a Plane falla en un paso específico del gate
 * (getTask, addComment, updateTaskState). Complementa `plane.api.call` —
 * el provider emite el evento success internamente, y este módulo emite el
 * failure desde los consumers (verify.js u otros).
 *
 * @param {Logger} logger
 * @param {{ step: string, error: string }} fields
 */
export function planeApiCallFailed(logger, fields) {
  logger.error(EVENTS.PLANE_API_CALL_FAILED, {
    event: EVENTS.PLANE_API_CALL_FAILED,
    step: fields.step,
    error: fields.error,
  });
}
```

**Diff sugerido — 3 helpers nuevos (verbatim shape, level mapping D-10):**

```javascript
/**
 * Worktree cleanup OK — emitted after a clean worktree was successfully
 * removed and (optionally) its branch deleted (Phase 19 D-08).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, branch_deleted: boolean }} fields
 */
export function worktreeCleanupOk(logger, fields) {
  logger.info(EVENTS.WORKTREE_CLEANUP_OK, {
    event: EVENTS.WORKTREE_CLEANUP_OK,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch_deleted: fields.branch_deleted,
  });
}

/**
 * Worktree cleanup DIRTY — emitted (warn) when the worktree had uncommitted
 * changes and was moved aside to `<path>.dirty` for human review (D-02).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, moved_to: string }} fields
 */
export function worktreeCleanupDirty(logger, fields) {
  logger.warn(EVENTS.WORKTREE_CLEANUP_DIRTY, {
    event: EVENTS.WORKTREE_CLEANUP_DIRTY,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    moved_to: fields.moved_to,
  });
}

/**
 * Worktree cleanup ERROR — emitted (error) when a cleanup step failed
 * unexpectedly (FS error, git lock, race). The hook continues fail-open (D-03).
 *
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, phase: 'status'|'remove'|'move'|'branch'|'prune', reason: string }} fields
 */
export function worktreeCleanupError(logger, fields) {
  logger.error(EVENTS.WORKTREE_CLEANUP_ERROR, {
    event: EVENTS.WORKTREE_CLEANUP_ERROR,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    phase: fields.phase,
    reason: fields.reason,
  });
}
```

**Level mapping (D-10 + RESEARCH §Pattern 2):**
- `.ok` → `logger.info` (mismo que `sessionEnd`).
- `.dirty` → `logger.warn` (espejado a stderr, mismo principio que `orchestratorReview` blocked).
- `.error` → `logger.error` (mismo que `planeApiCallFailed`).

---

### 4. `test/stop-worktree-cleanup.test.js` (NEW) — test, mixed unit + E2E

**Analog #1 (otro archivo):** `test/skill-auto-commit.test.js:22-99` — patrón canonical E2E con tmpdir + git init local + spawnSync child con `HOME` + `KODO_ROOT` override.

**Excerpt** (líneas 24-72 condensado):

```javascript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function makeIsolatedRepo() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const gitOpts = { cwd: tmpRepo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] };
  const run = (cmd) => execSync(cmd, gitOpts);

  run('git init -q');
  run('git config user.email "test@kodo.local"');
  run('git config user.name "kodo test"');
  run('git config commit.gpgsign false');
  // ... seed initial commit
  return { tmpHome, tmpRepo };
}
```

**Por qué este es el analog principal:** Phase 999.1 Plan 04 (CR-02 Phase 16) estableció este shape exacto. `mkdtempSync + git init -q + git config local + commit.gpgsign false` es la única forma segura de probar git real sin tocar el repo del dev ni el gitconfig global. RESEARCH §Pattern 1 lo confirma como canon para Phase 19.

**Analog #2 (otro archivo):** `test/gsd-verify-integration.test.js:73-101` — patrón `makeLogger()` memSink + `makeDeps()` factory para inyección sin I/O.

**Excerpt** (líneas 73-101):

```javascript
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,
  };
  return { logger, events };
}

function makeDeps(session) {
  const { provider, calls } = makeProviderMock();
  const { logger, events } = makeLogger();
  return {
    deps: {
      findSessionFn: () => session,
      // ...
      loggerFactory: () => logger,
    },
    calls,
    events,
  };
}
```

**Cómo lo usa Phase 19:** Los tests unit del cleanup (paths CLEAN/DIRTY/ERROR/LEGACY) usan **`gitFn` stub** + memSink logger inyectados vía `runStopHook(input, deps)` — sin spawn child, sin git real. Los tests E2E (1-2 escenarios smoke) usan el patrón #1 de `skill-auto-commit.test.js` con git real.

**Estructura sugerida para `test/stop-worktree-cleanup.test.js`:**

```javascript
// SECCIÓN 1 — Unit tests con gitFn stub (canon Phase 16 LOG-15):
describe('runStopHook — worktree cleanup unit', () => {
  it('CLEAN path: removes worktree + deletes branch + emits cleanup.ok', async () => {
    const gitCalls = [];
    const gitFn = (cwd, args) => {
      gitCalls.push({ cwd, args });
      if (args.includes('--show-current')) return 'session-abc';
      if (args.includes('--porcelain')) return ''; // clean
      return '';
    };
    const { logger, events } = makeMemLogger();
    await runStopHook(input, { gitFn, loggerFactory: () => logger, /* ... */ });
    // assert events contains worktree.cleanup.ok with branch_deleted: true
    // assert gitCalls order: branch --show-current → status → worktree remove → branch -D → prune
  });

  it('DIRTY path: moves worktree to .dirty + emits cleanup.dirty');
  it('ERROR path on remove: emits cleanup.error{phase:remove}');
  it('LEGACY path: no worktree_path → no gitFn calls, no events (D-09 silent)');
  it('TARGET COLLISION: existing .dirty path → timestamp suffix (Pitfall #1)');
});

// SECCIÓN 2 — E2E smoke tests con git real (canon Phase 999.1 D-16):
describe('runStopHook — worktree cleanup E2E', () => {
  it('git real: clean worktree → removed + branch deleted on disk', () => {
    const { tmpHome, tmpRepo, sessionId } = makeIsolatedRepoWithWorktree();
    // ... spawn child con HOME + KODO_ROOT override
    // ... assert !existsSync(worktreePath)
    // ... assert git branch | grep <branch> empty
  });
});
```

---

### 5. `test/logger-events.test.js` (EXTEND) — test, contract assertion

**Analog (in-file):** líneas 102-114 (`sessionEnd` test) y 207-216 (`planeApiCallFailed` con `assert.equal(line.level, 'error')`).

**Excerpt** (líneas 102-114):

```javascript
it('sessionEnd emits event=session.end + status/ended_at', () => {
  const sessionId = 'sess-ev-end';
  const log = createLogger({ sessionId, minLevel: 'info' });
  sessionEnd(log, {
    session_id: sessionId,
    status: 'done',
    ended_at: '2026-04-16T10:05:00.000Z',
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.SESSION_END);
  assert.equal(line.status, 'done');
  assert.equal(line.ended_at, '2026-04-16T10:05:00.000Z');
});
```

**Excerpt** (líneas 207-216):

```javascript
it('planeApiCallFailed emits event=plane.api.call.failed + step/error at error level', () => {
  const sessionId = 'sess-ev-pacf';
  const log = createLogger({ sessionId, minLevel: 'info' });
  planeApiCallFailed(log, { step: 'getTask', error: 'ECONNREFUSED' });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.PLANE_API_CALL_FAILED);
  assert.equal(line.level, 'error');
  assert.equal(line.step, 'getTask');
  assert.equal(line.error, 'ECONNREFUSED');
});
```

**Diff sugerido (3 it() nuevos + update del EVENTS frozen contract test en línea 45-58):**

```javascript
// Update líneas 47-57 — la lista canónica ahora tiene 11 tipos (8 + 3 nuevos):
const types = Object.values(EVENTS).sort();
assert.deepEqual(types, [
  'gsd.bootstrap',
  'gsd.phase.resolved',
  'orchestrator.review',
  'plane.api.call',
  'plane.api.call.failed',
  'session.end',
  'session.start',
  'state.transition',
  'worktree.cleanup.dirty',
  'worktree.cleanup.error',
  'worktree.cleanup.ok',
]);

// Nuevos it() (al final del describe block):

it('worktreeCleanupOk emits event=worktree.cleanup.ok at info level', () => {
  const sessionId = 'sess-ev-wto';
  const log = createLogger({ sessionId, minLevel: 'info' });
  worktreeCleanupOk(log, {
    session_id: sessionId,
    worktree_path: '/tmp/wt',
    branch_deleted: true,
  });
  const line = readAllLines(logPathFor(sessionId)).pop();
  assert.equal(line.event, EVENTS.WORKTREE_CLEANUP_OK);
  assert.equal(line.level, 'info');
  assert.equal(line.branch_deleted, true);
});

it('worktreeCleanupDirty emits at warn level + moved_to field', () => {
  // ... mirror sessionEnd shape, assert level==='warn', moved_to assertion
});

it('worktreeCleanupError emits at error level + phase + reason', () => {
  // ... mirror planeApiCallFailed shape, assert level==='error'
});
```

**Heads-up sobre el `describe` heading** (línea 44): `describe('LOG-09: logger-events taxonomy (8 helpers)', ...)` — el planner debe actualizar la cifra de 8 a 11 al añadir los 3 helpers, o renombrar a algo más genérico tipo `'logger-events taxonomy (D-10 + Phase 19 cleanup)'`.

---

### 6. `test/gsd-verify-integration.test.js` (EXTEND) — test, E2E fixtures

**Analog (in-file):** `test/gsd-verify-integration.test.js:37-52` (`makeSession()` factory).

**Excerpt actual** (líneas 37-52):

```javascript
function makeSession() {
  return {
    session_id: 'sess-int',
    task_id: 'task-int',
    task_ref: 'KL-99',
    provider: 'plane',
    project_id: 'proj-int',
    project_path: tmpRoot,
    summary: 'Orchestrator gate',
    status: 'review',
    started_at: new Date().toISOString(),
    workspace_ref: 'workspace:1',
    gsd: true,
    phase_id: '10',
  };
}
```

**Diff sugerido — 2 fixtures nuevos para Phase 19 D-06:**

```javascript
// Fixture 1: sesión v0.6+ con worktree_path → verify lee de tmpWorktree
function makeSessionWithWorktree(tmpWorktree) {
  return {
    ...makeSession(),
    worktree_path: tmpWorktree, // D-06: phasesRoot resuelve aquí
  };
}

// Fixture 2: sesión legacy v0.5 sin worktree_path → verify lee de project_path (D-09 silent)
function makeLegacySession() {
  return makeSession(); // sin worktree_path explícito; cubre fallback nullish-coalescing
}

// Nuevos it() al final del describe block:

it('Phase 19 D-06: verify reads VERIFICATION.md from worktree_path when present', async () => {
  // setup: crear tmpWorktree con .planning/phases/.../VERIFICATION.md
  // session = makeSessionWithWorktree(tmpWorktree)
  // assert que el archivo leído fue el del worktree, NO el de tmpRoot/project_path
});

it('Phase 19 D-09: legacy session without worktree_path → falls back to project_path silently', async () => {
  // setup: VERIFICATION.md SÓLO en tmpRoot (project_path), nada en tmpWorktree
  // session = makeLegacySession() (sin worktree_path)
  // assert verdict.action === 'pass' (lectura del fallback funcionó)
  // assert NO warn-level event "fallback" en events array (D-09: silent)
});
```

**Patrón "campo aditivo opcional + fallback":** el primer fixture extiende `makeSession()` con spread (`...makeSession(), worktree_path: ...`), el segundo lo usa tal cual. Mismo shape que Phase 11 D-08 (`gsd_mode`) y Phase 18 D-03c.

---

### 7. `test/stop.test.js` (EXTEND) — test, source-hygiene + behavior

**Analog (in-file):** `test/stop.test.js:41-51` — assertion de orden cleanup⇄release vía `source.indexOf`.

**Excerpt actual** (líneas 41-51):

```javascript
it('releases lock before removeSession (order matters)', () => {
  const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
  const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
  // Phase 16 (LOG-15): main() refactor a runStopHook(input, deps) renombró el
  // call site de removeSession(id) a removeSessionFn(id). Aceptamos ambas
  // variantes — lo crítico es el orden, no el nombre del binding local.
  const removeFnIdx = source.indexOf('removeSessionFn(id)');
  const removeIdx = removeFnIdx >= 0 ? removeFnIdx : source.indexOf('removeSession(id)');
  assert.ok(removeIdx > 0, 'must find removeSessionFn(id) or removeSession(id) call');
  assert.ok(lockIdx < removeIdx, 'releaseGsdLock must come before remove call');
});
```

**Diff sugerido — 3 it() nuevos al final del `describe('stop.js source hygiene', ...)` block:**

```javascript
it('Phase 19 D-07: worktree cleanup happens AFTER releaseGsdLock', () => {
  const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
  const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
  const cleanupIdx = source.indexOf('worktreeCleanupOk'); // o el nombre del helper/marker
  assert.ok(cleanupIdx > 0, 'must find worktree cleanup block in source');
  assert.ok(lockIdx < cleanupIdx, 'cleanup must come AFTER releaseGsdLock (D-07)');
});

it('Phase 19 D-08: branch --show-current is read BEFORE worktree remove', () => {
  const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
  const showCurrentIdx = source.indexOf('branch --show-current');
  // 'worktree', 'remove' como flag args en execFileSync, o 'worktree remove' en execSync string
  const removeIdx = Math.max(
    source.indexOf("'remove'"),
    source.indexOf('worktree remove'),
  );
  assert.ok(showCurrentIdx > 0 && removeIdx > 0, 'must reference both commands');
  assert.ok(showCurrentIdx < removeIdx, 'branch read must precede worktree remove (Pitfall #2)');
});

it('Phase 19 D-05: handleOrchestratorStop still uses cwd: KODO_ROOT (NOT modified)', () => {
  const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
  // Extract handleOrchestratorStop block by regex
  const match = source.match(/async function handleOrchestratorStop[\s\S]*?\n}/);
  assert.ok(match, 'must find handleOrchestratorStop function');
  assert.ok(match[0].includes('cwd: KODO_ROOT'), 'handleOrchestratorStop must preserve cwd: KODO_ROOT (D-05 satisfied-by-design)');
});
```

**Por qué este es el patrón:** Source-hygiene grep tests son LIVING DOCUMENTATION — si un futuro refactor mueve el bloque cleanup ANTES de `releaseGsdLock` o invierte el orden branch⇄remove, el test falla con mensaje explícito apuntando a la decisión D-07/D-08. Mismo principio que el test existente "releases lock before removeSession (order matters)".

---

## Shared Patterns

### Try/Catch Fail-Open Por Bloque

**Source:** `src/hooks/stop.js:128-216` (cmux.setColor, cmux.notify, sessionEnd emit, markSessionStatus, releaseGsdLock, notify orchestrator — 6 try/catch independientes).

**Apply to:** Cada uno de los 5 pasos del cleanup en `stop.js`:
1. `git -C <wt> branch --show-current` (lee branch name) — catch → `branchName=null`, continúa silent.
2. `git -C <wt> status --porcelain` (dirty check) — catch → emit `cleanup.error{phase:'status'}`, skip cleanup.
3. `git worktree remove` o `git worktree move` — catch → emit `cleanup.error{phase:'remove'|'move'}`.
4. `git branch -D <branch>` — catch → emit `cleanup.ok{branch_deleted:false}` + warn stderr.
5. `git worktree prune` — catch → emit `cleanup.error{phase:'prune'}` + continúa.

**Excerpt canonical** (`stop.js:195-200`):

```javascript
try {
  const { releaseGsdLock } = await import('../gsd/lock.js');
  releaseGsdLock(session.project_path, session.session_id);
} catch (err) {
  console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
}
```

### Eventos NDJSON Tipados (helpers en logger-events.js)

**Source:** `src/logger-events.js:80-204` (8 helpers existentes).

**Apply to:** 3 helpers nuevos `worktreeCleanupOk/Dirty/Error` siguiendo verbatim el shape de `sessionEnd` (info), `orchestratorReview` (warn), `planeApiCallFailed` (error).

**Invariant LOG-12:** ningún consumer en el grafo de `src/check.js` importa `logger-events.js`. Phase 19 preserva (los helpers se importan solo desde `stop.js`).

### DI vía `runStopHook(input, deps)` con defaults vía OR

**Source:** `src/hooks/stop.js:97-101`.

**Apply to:** Phase 19 añade UNA sola dep nueva (`gitFn`) — alternativa: hacer dynamic import de `execFileSync` sin DI. El planner decide. Si elige DI (recomendado por testability):

```javascript
const gitFn = deps.gitFn || ((cwd, args) => {
  const { execFileSync } = require('node:child_process');
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
});
```

### Campo aditivo opcional + fallback nullish coalescing

**Source:** Phase 11 D-08 (`session.gsd_mode`), Phase 18 D-03c (`session.worktree_path`).

**Apply to:**
- `verify.js:124` — `session.worktree_path ?? session.project_path` (D-06).
- `stop.js` cleanup block — `if (!session.worktree_path) return;` (D-09 silent skip).

### Tests `tmpdir + HOME override` (Phase 16 CR-02)

**Source:** `test/skill-auto-commit.test.js:45-72` + `test/helpers/logger-fixtures.js:10-19` (`makeTmpHome`).

**Apply to:** `test/stop-worktree-cleanup.test.js` — sección E2E debe inyectar `HOME` + `KODO_ROOT` env vars al child, sembrar repo con `git init -q` local + `git config commit.gpgsign false` local. NUNCA tocar el repo del dev ni el gitconfig global.

### Lazy import en stop hook

**Source:** `src/hooks/stop.js:154, 160, 189, 196, 239` (`await import(...)` para `logger.js`, `logger-events.js`, `manager.js`, `gsd/lock.js`, `node:child_process`).

**Apply to:** Phase 19 importa `logger-events.js` (helpers nuevos) y `node:child_process` (si `gitFn` no se inyecta) vía dynamic import dentro del bloque cleanup — minimiza cold-start del hook cuando el path legacy v0.5 lo skippea (D-09).

---

## No Analog Found

**Ninguno.** Los 7 archivos de Phase 19 tienen analog exact en el codebase. Phase 19 es **ejecución cuidadosa de patrones consagrados**, no descubrimiento técnico (RESEARCH §Summary).

---

## Metadata

**Analog search scope:**
- `src/hooks/` (stop.js)
- `src/gsd/` (verify.js, lock.js)
- `src/session/` (state.js)
- `src/logger-events.js`
- `test/` (skill-auto-commit, gsd-verify-integration, logger-events, stop, helpers/logger-fixtures)

**Files scanned:** ~12 archivos lectura directa + grep helpers.

**Pattern extraction date:** 2026-05-12

**Key invariants preserved (RESEARCH §"Decisiones de phases previas que Phase 19 preserva"):**
- GSD-10 (lock per-repo): cleanup ocurre TRAS `releaseGsdLock`, NO altera contrato.
- Phase 10 D-04/D-17: `orchestratorReview` emitido en TODAS las ramas del verdict — verify.js cambio NO toca finalize().
- Phase 12 QUICK-07: etiquetas `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` byte-idénticas — Phase 19 NO toca `buildSessionContext` ni `buildClaudeCommand`.
- Phase 16 LOG-15: `markSessionStatus(... 'done' ...)` PRE-release preservado (líneas 179-193 de stop.js).
- Phase 999.1 D-04..D-06: orchestrator cwd=repo invariante. D-05 de Phase 19 lo confirma explícitamente.
- Phase 999.1 D-16: `KODO_ROOT` env override preservado sin cambios.
