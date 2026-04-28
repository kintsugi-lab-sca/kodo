# Phase 8: GSD Label + Session Plumbing - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 9 (1 new module, 3 new test files, 5 modified files)
**Analogs found:** 8 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/gsd/lock.js` (NEW) | utility | file-I/O | `src/session/state.js` | role-match |
| `src/session/state.js` (MOD) | model | CRUD | -- (self) | exact |
| `src/session/manager.js` (MOD) | service | request-response | -- (self) | exact |
| `src/triggers/dispatcher.js` (MOD) | controller | request-response | -- (self) | exact |
| `src/hooks/session-start.js` (MOD) | hook | request-response | -- (self) | exact |
| `src/hooks/stop.js` (MOD) | hook | request-response | -- (self) | exact |
| `test/gsd-lock.test.js` (NEW) | test | CRUD | `test/manager.test.js` | role-match |
| `test/gsd-context.test.js` (NEW) | test | request-response | `test/session-start.test.js` | exact |
| `test/gsd-concurrency.test.js` (NEW) | test | request-response | `test/dispatcher.test.js` | exact |

## Pattern Assignments

### `src/gsd/lock.js` (NEW utility, file-I/O)

**Analog:** `src/session/state.js` -- mismo patron de JSON file read/write con funciones puras exportadas.

**Imports pattern** (state.js lines 1-5):
```javascript
// @ts-check
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
```

**Adicionales para lock.js:**
```javascript
import { mkdirSync, unlinkSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
```

**JSDoc typedef pattern** (state.js lines 12-26):
```javascript
/**
 * @typedef {{
 *   workspace_ref: string,
 *   session_id: string,
 *   task_id: string,
 *   task_ref: string,
 *   ...
 * }} Session
 */
```
Lock.js debe definir `LockContent` typedef con el mismo estilo.

**JSON read with try/catch pattern** (state.js lines 63-71):
```javascript
/** @returns {State} */
export function loadState() {
  if (!existsSync(STATE_PATH)) return { schema_version: 2, sessions: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return { schema_version: 2, sessions: {} };
  }
}
```

**JSON write pattern** (state.js lines 74-76):
```javascript
/** @param {State} state */
export function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}
```

**Key difference:** lock.js no usa `KODO_DIR` -- el path se construye desde `projectPath` argumento (`join(realpathSync(projectPath), '.planning/.kodo.lock')`). No debe importar `config.js` para evitar acoplamiento.

---

### `src/session/state.js` (MOD model, typedef extension)

**Self-analog.** Modificacion aditiva del Session typedef.

**Typedef extension pattern** (state.js lines 12-26) -- anadir campos opcionales:
```javascript
/**
 * @typedef {{
 *   workspace_ref: string,
 *   session_id: string,
 *   task_id: string,
 *   task_ref: string,
 *   provider: string,
 *   project_id: string,
 *   summary: string,
 *   status: 'running'|'done'|'error'|'review',
 *   started_at: string,
 *   project_path: string,
 *   gsd?: boolean,          // Phase 8: GSD mode flag
 *   phase_id?: string,      // Phase 9 prep: resolved phase identifier
 * }} Session
 */
```

No hay cambios funcionales -- solo typedef.

---

### `src/session/manager.js` (MOD service, buildSessionFromTask)

**Self-analog.** Extender `buildSessionFromTask` para aceptar `flags` y setear `gsd: true`.

**Function signature pattern** (manager.js lines 14-23):
```javascript
/**
 * Build the session record saved to state from a resolved TaskItem.
 * Pure function — no I/O.
 *
 * @param {{
 *   task: import('../interface.js').TaskItem,
 *   providerName: string,
 *   projectPath: string,
 *   workspaceRef: string,
 *   sessionId: string,
 * }} params
 * @returns {import('./state.js').Session}
 */
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId }) {
```

**Extension point** -- anadir `flags` al destructuring y spread condicional al return:
```javascript
// Anadir al @param:
//   flags?: string[],
// Anadir al return object:
//   ...(flags?.includes('gsd') ? { gsd: true } : {}),
```

**launchWorkItem integration** (manager.js lines 181-189) -- donde se pasa flags al session record:
```javascript
  const session = buildSessionFromTask({
    task,
    providerName: config.provider,
    projectPath,
    workspaceRef,
    sessionId,
    // Anadir: flags: combinedFlags,
  });
  addSession(task.id, session);
```

---

### `src/triggers/dispatcher.js` (MOD controller, guard chain)

**Self-analog.** Anadir guard GSD lock despues del inFlight check.

**DI dependencies typedef** (dispatcher.js lines 12-19):
```javascript
/**
 * @typedef {{
 *   getProviderFn?: (name?: string) => import('../interface.js').TaskProvider,
 *   launchWorkItemFn?: (ref: string, opts: object) => Promise<any>,
 *   listSessionsFn?: () => any[],
 *   listWorkspacesFn?: () => Promise<string>,
 *   removeSessionFn?: (id: string) => void,
 * }} DispatchDeps
 */
```
Anadir: `acquireGsdLockFn?`, `resolveProjectPathFn?` para inyeccion en tests.

**Guard pattern: inFlight** (dispatcher.js lines 86-92):
```javascript
  // 3. In-flight guard — prevents duplicate dispatches for the same task
  if (inFlight.has(task.id)) {
    console.log(`[kodo:dispatch] Ignored — ${task.ref} already dispatching`);
    return { action: 'already_active' };
  }
```

**Nuevo guard GSD sigue el mismo patron** -- entre inFlight (line 92) y session-already-active (line 94):
```javascript
  // 3b. GSD repo lock guard (only for GSD-flagged tasks)
  if (kodoConfig.flags.includes('gsd')) {
    const lockResult = acquireGsdLockFn(projectPath, {
      session_id: sessionId,
      task_id: task.id,
      task_ref: task.ref,
    });
    if (!lockResult.acquired) {
      return { action: 'gsd_locked', holder: lockResult.holder };
    }
  }
```

**Return type extension** -- anadir `'gsd_locked'` a la union del `@returns`:
```javascript
// @returns {Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked', ... }>}
```

**Nota critica:** El guard GSD necesita `projectPath` resuelto, que actualmente solo se resuelve dentro de `launchWorkItem`. El dispatcher necesita resolver el path antes del guard, usando `resolveProjectPath` (ya exportado por manager.js) o inyectandolo como dep.

---

### `src/hooks/session-start.js` (MOD hook, context bifurcation)

**Self-analog.** Anadir `buildGsdContext` y bifurcar en `main()`.

**buildSessionContext pattern** (session-start.js lines 22-67):
```javascript
/**
 * Build the additional context block injected into Claude Code sessions.
 * Pure: no I/O, no globals — fully testable.
 *
 * @param {import('../session/state.js').Session} session
 * @param {{ provider: string, providers: Record<string, any> }} config
 * @returns {string}
 */
export function buildSessionContext(session, config) {
  // ...
  return [
    `# kodo ${session.task_ref}`,
    '',
    `Estas trabajando en **${session.task_ref}: ${session.summary}**`,
    // ...
  ].join('\n');
}
```

**buildGsdContext debe seguir el mismo patron** -- funcion pura exportada, JSDoc `@param`/`@returns`, array de lines `.join('\n')`:
```javascript
/**
 * Build GSD-mode context injected into Claude Code sessions.
 * Replaces buildSessionContext entirely for GSD sessions.
 * Pure: no I/O, no globals — fully testable.
 *
 * @param {import('../session/state.js').Session} session
 * @returns {string}
 */
export function buildGsdContext(session) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    '',
    // ... English context per D-04
  ];
  return lines.join('\n');
}
```

**Bifurcation point in main()** (session-start.js lines 93-95):
```javascript
    const { session } = result;
    const config = loadConfig();
    const context = buildSessionContext(session, config);
```
Cambia a:
```javascript
    const { session } = result;
    const context = session.gsd
      ? buildGsdContext(session)
      : buildSessionContext(session, loadConfig());
```

**Logger event emission pattern** (session-start.js lines 99-117) -- best-effort try/catch silencioso:
```javascript
    try {
      const { createLogger } = await import('../logger.js');
      const { sessionStart } = await import('../logger-events.js');
      const log = createLogger({
        sessionId: session.session_id,
        minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
      }).child({ component: 'hook', task_id: session.task_id });
      sessionStart(log, { /* fields */ });
    } catch {
      // silent — never crash Claude Code
    }
```
Para GSD: emitir `gsdBootstrap` o `gsdPhaseResolved` segun `session.phase_id`, usando el mismo patron try/catch.

---

### `src/hooks/stop.js` (MOD hook, lock release)

**Self-analog.** Anadir `releaseGsdLock` call condicional.

**Cleanup pattern in main()** (stop.js lines 60-103) -- cadena de try/catch independientes:
```javascript
    const { id, session } = result;

    // cmux color change
    try {
      await cmux.setColor({ /* ... */ });
    } catch (err) {
      console.error(`[kodo] Error setting color: ${err.message}`);
    }

    // notification
    try {
      await cmux.notify({ /* ... */ });
    } catch {}

    // logger event
    try {
      const { createLogger } = await import('../logger.js');
      // ...
    } catch {
      // silent
    }

    removeSession(id);
```

**Nuevo bloque de lock release sigue el mismo patron** -- antes de `removeSession`:
```javascript
    // Release GSD lock if applicable (idempotent, verifies session_id)
    if (session.gsd) {
      try {
        const { releaseGsdLock } = await import('../gsd/lock.js');
        releaseGsdLock(session.project_path, session.session_id);
      } catch (err) {
        console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
      }
    }
```

---

### `test/gsd-lock.test.js` (NEW test)

**Analog:** `test/manager.test.js` -- tests de funciones puras con `makeTask()` fixtures.

**Test structure pattern** (manager.test.js lines 1-6, 37-45):
```javascript
// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('gsd lock — acquireGsdLock', () => {
  // Use tmp directories for isolation
  // Test cases: acquire new, reject active, steal dead PID, steal expired TTL, corrupt file
});
```

**Fixture helper pattern** (manager.test.js lines 21-35):
```javascript
function makeSession(overrides = {}) {
  return {
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    ...overrides,
  };
}
```

**Nota:** Los tests de lock necesitan directorio temporal para escribir lock files reales. Usar `mkdtempSync` de `node:fs` + cleanup en `afterEach`.

---

### `test/gsd-context.test.js` (NEW test)

**Analog:** `test/session-start.test.js` -- tests de `buildSessionContext` con fixtures `makeSession`/`makeConfig`.

**Test structure pattern** (session-start.test.js lines 1-7, 41-46):
```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGsdContext } from '../src/hooks/session-start.js';

describe('session-start.js — buildGsdContext', () => {
  it('includes GSD Mode header', () => {
    const session = makeSession({ gsd: true });
    const context = buildGsdContext(session);
    assert.match(context, /GSD Mode/);
  });
});
```

**Session fixture con gsd flag** (derivado de session-start.test.js lines 13-29):
```javascript
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42',
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Fix bug',
    status: 'running',
    started_at: '2026-04-10T00:00:00.000Z',
    project_path: '/tmp/kl-42',
    gsd: true,
    ...overrides,
  };
}
```

---

### `test/gsd-concurrency.test.js` (NEW test)

**Analog:** `test/dispatcher.test.js` -- DI-based integration tests con `createFakeProvider`.

**DI test pattern** (dispatcher.test.js lines 9-31, 64-80):
```javascript
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({
      id: 'task-uuid-1',
      ref: 'KL-42',
      title: 'Test task',
      description: 'desc',
      labels: ['kodo'],
      projectId: 'proj-1',
      projectName: 'Test Project',
      groups: [],
      url: 'https://example.com/KL-42',
      priority: 'medium',
    }),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: async () => [],
    parseTriggerEvent: () => null,
    verifySignature: () => true,
    resolveRef: async () => '',
    ...overrides,
  };
}

describe('dispatchTrigger', () => {
  beforeEach(() => { /* reset mocks */ });

  it('Test: GSD lock blocks second task on same repo', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    const event = { taskRef: 'KL-42', action: 'state_change', provider: 'test', raw: {} };
    const result = await dispatchTrigger(event, {}, {
      getProviderFn: () => fakeProvider,
      launchWorkItemFn: async (ref, opts) => { /* ... */ },
      // acquireGsdLockFn: mock that returns { acquired: false, holder: {...} }
    });
    assert.equal(result.action, 'gsd_locked');
  });
});
```

---

## Shared Patterns

### ES Module + JSDoc Convention
**Source:** Todos los archivos en `src/`
**Apply to:** `src/gsd/lock.js` y todos los archivos modificados
```javascript
// @ts-check
import { ... } from 'node:fs';

/**
 * Description.
 * @param {type} name
 * @returns {type}
 */
export function name(params) { }
```

### Best-Effort Logger Emission (Hook Pattern)
**Source:** `src/hooks/session-start.js` lines 99-117
**Apply to:** `src/hooks/session-start.js` (GSD events), `src/hooks/stop.js` (lock release logging)
```javascript
try {
  const { createLogger } = await import('../logger.js');
  const { gsdBootstrap } = await import('../logger-events.js');
  const log = createLogger({
    sessionId: session.session_id,
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'hook', task_id: session.task_id });
  gsdBootstrap(log, { project_path: session.project_path });
} catch {
  // silent — never crash Claude Code
}
```

### DI for Testability (Dispatcher Pattern)
**Source:** `src/triggers/dispatcher.js` lines 12-19, 31-36
**Apply to:** `src/triggers/dispatcher.js` (nuevas deps: `acquireGsdLockFn`, `resolveProjectPathFn`)
```javascript
/**
 * @typedef {{
 *   existingDep?: ...,
 *   acquireGsdLockFn?: (projectPath: string, session: object) => { acquired: boolean, holder?: object },
 * }} DispatchDeps
 */
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const acquireGsdLockFn = deps.acquireGsdLockFn || acquireGsdLock;
  // ...
}
```

### Guard Return Convention (Dispatcher)
**Source:** `src/triggers/dispatcher.js` lines 49-51, 70, 92
**Apply to:** Nuevo guard `gsd_locked`
```javascript
// Existing guards return { action: '<name>' } with optional context:
return { action: 'ignored' };           // line 50
return { action: 'already_active' };    // line 92, 102
return { action: 'cleaned' };           // line 67

// New guard follows same convention:
return { action: 'gsd_locked', holder: lockResult.holder };
```

### Test File Convention
**Source:** `test/dispatcher.test.js`, `test/session-start.test.js`, `test/manager.test.js`
**Apply to:** Todos los nuevos test files
```javascript
// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeFixture(overrides = {}) {
  return { /* defaults */, ...overrides };
}

describe('module — function', () => {
  it('Test N: descriptive behavior name', () => {
    // arrange, act, assert
  });
});
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/gsd/lock.js` (parcial) | utility | file-I/O | El patron de lock con PID check + TTL + steal semantics no existe en el codebase. La lectura/escritura JSON si tiene analog (`state.js`), pero la logica de adquisicion es nueva. Usar RESEARCH.md Code Examples como referencia primaria para `acquireGsdLock`, `releaseGsdLock`, `isPidAlive`. |

## Metadata

**Analog search scope:** `src/`, `test/`
**Files scanned:** 14 source files + 24 test files
**Pattern extraction date:** 2026-04-17
