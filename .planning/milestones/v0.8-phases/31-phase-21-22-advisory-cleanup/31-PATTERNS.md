# Phase 31: Phase 21/22 Advisory Cleanup — Pattern Map

**Mapped:** 2026-05-21
**Files analyzed:** 5 (3 src + 2 test)
**Analogs found:** 5 / 5 (100%)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/skill/sync.js` (MODIFY) | pure module / utility | transform | self (línea 117) + Phase 14 D-07 color isolation invariant | exact (self-extension) |
| `src/cli/skill-sync.js` (MODIFY) | CLI thin wrapper | request-response (exit-code) | `src/cli/gsd-verify.js` (deps DI shape) + self (4 returns existentes) | exact (sibling CLI) |
| `src/orchestrator/launch.js` (MODIFY) | orchestrator | event-driven (spawn) | self línea 67 (`opts.logger` injectable existente) + `child_process.spawn` callsite implícito | role-match |
| `test/skill-sync.test.js` (MODIFY — describe blocks aditivos para ADVISORY-01 + ADVISORY-02) | test infrastructure | request-response | self (HOME-isolation + tmpdir fixtures + Suite 1 unit + Suite 2 integration) | exact (self-extension) |
| `test/launch.test.js` (MODIFY — añade suite `launchOrchestrator real-spawn`) | test infrastructure | event-driven | self + `test/orchestrator-launch-isolation.test.js` (KODO_ROOT override + source-hygiene) + `test/skill-sync.test.js` (spawnSync + HOME isolation) | role-match (compuesto) |

## Pattern Assignments

### `src/skill/sync.js` (pure module, transform) — ADVISORY-01

**Analog:** mismo módulo, líneas 50-138 (extensión aditiva no rompedora — D-01).

**Callsite a modificar** (`src/skill/sync.js:111-122`):
```js
    // 6. D-05 prune (opt-in destructivo, default false).
    if (prune === true) {
      const destFiles = walkFiles(dest);
      for (const relPath of destFiles) {
        if (!sourceSet.has(relPath)) {
          // D-05b: warn explícito ANTES de borrar para que el operador vea qué se pierde.
          console.warn(`[kodo skill sync --prune] removing foreign: ${relPath}`);
          rmSync(join(dest, relPath), { force: true });
          filesPruned += 1;
        }
      }
    }
```

**Inyección a aplicar (D-01/D-02/D-03):** la única línea `console.warn` directa (línea 117) pasa a llamar al callback opcional. Resto del módulo intacto.

**Patrón de DI opcional con default** (referencia analog: cómo `addSession` define default param + `cleanupFn` en Plan 31-02; mismo idioma):
```js
// En la firma del JSDoc + destructuring:
//
// @typedef {{
//   source: string,
//   dest: string,
//   prune?: boolean,
//   logger?: Logger,
//   onConsoleWarn?: (msg: string) => void,   // NUEVO — D-01
// }} SyncSkillOpts
//
// En el cuerpo:
const { source, dest, prune = false, onConsoleWarn } = opts;
// ...
const warn = onConsoleWarn ?? console.warn;
// ...
warn(`[kodo skill sync --prune] removing foreign: ${relPath}`);
```

**JSDoc typedef analog (líneas 25-40)** — extender con el nuevo campo opcional respetando el orden:
```js
/**
 * @typedef {{
 *   source: string,
 *   dest: string,
 *   prune?: boolean,
 *   logger?: import('../logger.js').Logger,
 * }} SyncSkillOpts
 */
```

**Imports actuales (líneas 18-23)** — NO añadir nada (`onConsoleWarn` es runtime-only):
```js
import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync,
  lstatSync, rmSync, unlinkSync, existsSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
```

**Color isolation invariant (file header líneas 1-16)** — preservar el contrato "pure module". El callback recibe un string ya formateado; NO se importa `picocolors`. Test `test/skill-sync.test.js:382-384` ya blinda esto:
```js
const syncMod = readFileSync(join(REPO, 'src', 'skill', 'sync.js'), 'utf-8');
assert.equal(/picocolors/.test(stripComments(syncMod)), false);
```

---

### `src/cli/skill-sync.js` (CLI thin wrapper, request-response) — ADVISORY-02

**Analog primario:** mismo módulo, líneas 21-31 (typedef deps) + 40-83 (cuerpo con 4 returns).
**Analog cross-CLI:** `src/cli/gsd-verify.js` (líneas 23-29, 57-85 — patrón canónico de deps DI).

**Typedef deps actual** (`src/cli/skill-sync.js:24-31`):
```js
/**
 * @typedef {{
 *   syncFn?: typeof syncSkill,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 * }} RunSkillSyncCliDeps
 */
```

**Extensión D-04** — añadir `cleanupFn?: () => Promise<void> | void` como sexto field. Patrón espejo del cross-CLI:
```js
// src/cli/gsd-verify.js:23-29
/**
 * @typedef {{
 *   runVerifyFn?: typeof runGsdVerify,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunGsdVerifyCliDeps
 */
```

**Cuerpo actual con 3 ramas de return** (`src/cli/skill-sync.js:40-84`):
```js
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  const source = join(cwd, '.claude', 'skills', 'kodo-orchestrate');
  const dest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');

  // Gate D-07 exit 2
  if (!existsSync(join(source, 'skill.md'))) {
    err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
    return 2;                                          // ← RAMA 1
  }

  let result;
  try {
    result = syncFn({ source, dest, prune: opts.prune === true });
  } catch (e) {
    err(`Error: filesystem error: ${(e).message}\n`);
    return 1;                                          // ← RAMA 2a
  }
  if (result.status === 'error') {
    err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
    return 1;                                          // ← RAMA 2b
  }
  // ... render ...
  return 0;                                            // ← RAMA 3
}
```

**Patrón canónico try/finally** (D-05/D-08) — recomendado por context, garantiza cleanup en CADA exit path incluyendo el `return 2` early-gate:
```js
export async function runSkillSyncCli(opts, deps = {}) {
  const cleanupFn = deps.cleanupFn;
  // ... resto del setup idéntico ...
  try {
    // Gate D-07 exit 2
    if (!existsSync(join(source, 'skill.md'))) {
      err('Error: not a kodo repository...\n');
      return 2;
    }
    // ... bloque try-syncFn ...
    // ... render ...
    return 0;
  } finally {
    if (cleanupFn) await cleanupFn();
  }
}
```

**Alternativa explícita pre-return (D-08 "equivalente estructural")** — `cleanupFn` ejecutado antes de cada return individual; más verbose pero observable en code review. La elección queda al planner pero el test debe cubrir las 3 ramas (ok/error/no-repo).

**Default omitido intencionalmente** — a diferencia de `writeFn`/`errFn` que tienen default `process.stdout.write`, `cleanupFn` NO debe tener default. Si no se inyecta, el `if (cleanupFn)` lo elide. Esto preserva back-compat byte-exact con callers que no pasan `deps.cleanupFn` (zero churn).

---

### `src/orchestrator/launch.js` (orchestrator, event-driven) — ADVISORY-03

**Analog:** mismo módulo, líneas 65-67 (signature actual con un único `opts.logger`).

**Signature actual** (`src/orchestrator/launch.js:62-67`):
```js
/**
 * Launch the orchestrator Claude session in a dedicated cmux workspace.
 *
 * @param {{ logger?: import('../logger.js').Logger }} [opts]
 */
export async function launchOrchestrator(opts = {}) {
```

**Extensión D-09/D-14** — añadir `spawnFn` como segundo field opcional del opts object. Sin breaking change: callers existentes (`bin/kodo orchestrate`, tests previos) no pasan `spawnFn` y reciben default `child_process.spawn`.
```js
/**
 * @param {{
 *   logger?: import('../logger.js').Logger,
 *   spawnFn?: typeof import('node:child_process').spawn,
 * }} [opts]
 */
export async function launchOrchestrator(opts = {}) {
  const config = loadConfig();
  const log = opts.logger?.child({ component: 'orchestrator' });
  // NOTA: spawnFn no se usa hoy en el cuerpo (cmux.send + cmux.newWorkspace
  // cubren el lifecycle); el DI existe para que el test pueda ejecutar
  // node -e <inline-script> sin requerir cmux real.
  const spawnFn = opts.spawnFn; // se invoca solo si los callers lo proveen
```

**Imports actuales (líneas 2-12)** — NO añadir `child_process` al top-level imports (el módulo hoy no usa spawn; solo cmux client). El default `child_process.spawn` se carga lazy desde dentro del block donde se use, o se omite (caller test inyecta su propio fn).
```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { loadConfig, isReportToProviderEnabled } from '../config.js';
import { listSessions } from '../session/state.js';
import * as cmux from '../cmux/client.js';
import { getSessionMode } from '../labels.js';
import { syncSkill } from '../skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../logger-events.js';
```

**KODO_ROOT override pattern (líneas 17-19)** — analog para futuras envs de test isolation:
```js
// Phase 21 D-08 + Pattern C: KODO_ROOT override aditivo para test isolation
// (mismo patrón que src/hooks/stop.js:20; permite spawnSync con env.KODO_ROOT=tmpRepo).
const KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd();
```

**Auto-sync fail-open block (líneas 87-110)** — INTOCABLE per CONTEXT.md fuera-de-scope. Preservar verbatim.

---

### `test/skill-sync.test.js` (test infrastructure) — ADVISORY-01 + ADVISORY-02

**Analog:** mismo archivo, líneas 38-79 (fixture infra) + Suite 1 unit `syncSkill` (líneas 93-250) + Suite 2 integration spawnSync (líneas 254-385).

**Plans 31-01 y 31-02 ambos tocan este archivo en describe blocks distintos** (CONTEXT D-15 overlap controlado).

**Fixture infra (líneas 38-79)** — REUSAR sin cambios para ambos plans:
```js
function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const skillDir = join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'skill.md'),
    '# kodo:orchestrate\n\nCanonical body v1.\n',
    'utf-8',
  );
  mkdirSync(join(skillDir, 'subdir'), { recursive: true });
  writeFileSync(join(skillDir, 'subdir', 'extra.md'), 'extra content\n', 'utf-8');

  return { tmpHome, tmpRepo, skillDir };
}
```

**Test ADVISORY-01 analog actual** (`test/skill-sync.test.js:197-223`) — patrón existente para Phase 21 que ADVISORY-01 reemplaza por DI callback (sin monkey-patch global):
```js
it('Test 6: prune=true → foráneo borrado con console.warn previo', () => {
  // ... setup ...
  // Capturar console.warn temporalmente.
  const warns = [];
  const origWarn = console.warn;
  console.warn = (msg) => { warns.push(String(msg)); };
  let second;
  try {
    second = syncSkill({ source, dest, prune: true });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(second.files_pruned, 1);
  assert.ok(warns.some((w) => /\[kodo skill sync --prune\] removing foreign: foreign\.md/.test(w)));
});
```

**ADVISORY-01 — patrón nuevo (sin spy global)**:
```js
it('ADVISORY-01: prune=true + onConsoleWarn callback → captura sin spy global', () => {
  ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
  const source = sourceOf(_tmpRepo);
  const dest = destOf(_tmpHome);
  syncSkill({ source, dest });
  writeFileSync(join(dest, 'foreign.md'), 'local override\n', 'utf-8');

  const warns = [];
  const result = syncSkill({
    source, dest, prune: true,
    onConsoleWarn: (msg) => warns.push(msg),
  });

  assert.equal(result.files_pruned, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /\[kodo skill sync --prune\] removing foreign: foreign\.md/);
});

it('ADVISORY-01: default fallback console.warn cuando onConsoleWarn no se inyecta', () => {
  // ... re-usar el patrón existente Test 6 verbatim (back-compat byte-exact) ...
});
```

**ADVISORY-02 — patrón nuevo (in-process, NO spawnSync — Suite 1 style)**:
```js
import { runSkillSyncCli } from '../src/cli/skill-sync.js';

describe('runSkillSyncCli — ADVISORY-02 cleanupFn ordering', () => {
  // ... afterEach idéntico al Suite 1 ...

  async function captureOrdering(scenario) {
    const ts = [];
    const cleanupFn = async () => {
      await new Promise((r) => setImmediate(r));
      ts.push({ tag: 'cleanup', t: process.hrtime.bigint() });
    };
    const code = await runSkillSyncCli(scenario.opts, {
      ...scenario.deps,
      cleanupFn,
    });
    ts.push({ tag: 'return', t: process.hrtime.bigint() });
    return { code, ts };
  }

  it('ADVISORY-02 #1: cleanupFn corre ANTES de return 0 (ok path)', async () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { code, ts } = await captureOrdering({
      opts: {},
      deps: { cwdFn: () => _tmpRepo, writeFn: () => {}, errFn: () => {} },
    });
    assert.equal(code, 0);
    assert.equal(ts[0].tag, 'cleanup');
    assert.equal(ts[1].tag, 'return');
    assert.ok(ts[0].t < ts[1].t, 'cleanup_ts < return_ts');
  });

  it('ADVISORY-02 #2: cleanupFn corre ANTES de return 2 (no kodo repo)', async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), 'kodo-not-a-repo-'));
    try {
      const { code, ts } = await captureOrdering({
        opts: {},
        deps: { cwdFn: () => emptyCwd, writeFn: () => {}, errFn: () => {} },
      });
      assert.equal(code, 2);
      assert.ok(ts[0].t < ts[1].t);
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('ADVISORY-02 #3: cleanupFn corre ANTES de return 1 (fs error)', async () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { code, ts } = await captureOrdering({
      opts: {},
      deps: {
        cwdFn: () => _tmpRepo,
        writeFn: () => {},
        errFn: () => {},
        syncFn: () => ({ status: 'error', files_changed: 0, error: 'simulated' }),
      },
    });
    assert.equal(code, 1);
    assert.ok(ts[0].t < ts[1].t);
  });
});
```

**Source-hygiene pattern (líneas 369-384)** — referenciar para mantener color isolation tras los cambios:
```js
it('D-08b source-hygiene: CLI handler importa solo desde ../skill/sync.js y NO importa picocolors', () => {
  const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
  const stripped = stripComments(cliHandler);
  assert.match(stripped, /from\s+['"]\.\.\/skill\/sync\.js['"]/);
  assert.equal(/from\s+['"]picocolors['"]/.test(stripped), false);
});
```

---

### `test/launch.test.js` (test infrastructure, event-driven) — ADVISORY-03

**Analog primario:** `test/skill-sync.test.js` líneas 38-79 (HOME-isolation + tmpdir fixture pattern).
**Analog secundario:** `test/orchestrator-launch-isolation.test.js` líneas 19-39 (KODO_ROOT override + stripComments source-hygiene scaffold).
**Analog terciario:** `src/hooks/session-start.js:216-236` (sessionStart helper invocation pattern).
**Analog cuaternario:** `src/session/state.js:117-125` (`addSession` signature target del inline-script).

**Estado actual del archivo** (`test/launch.test.js:1-125`) — describe blocks `REPORT-03 applyReportingGate` (suite LG1-LG8) + `launch.js source hygiene` (LH1-LH3). NO contiene tests de `launchOrchestrator` runtime — solo helpers/source-hygiene. **No hay mockSpawn previo a reemplazar** (CONTEXT habla de un patrón estructural que el research debe localizar; en el archivo actual no aparece).

**Imports actuales** (`test/launch.test.js:1-5`):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyReportingGate } from '../src/orchestrator/launch.js';
```

**Extensión propuesta — nuevo describe block** al final del archivo:
```js
describe('ADVISORY-03 — launchOrchestrator real-spawn', () => {
  let _tmpHome;
  afterEach(() => {
    if (_tmpHome) rmSync(_tmpHome, { recursive: true, force: true });
    _tmpHome = undefined;
  });

  it('SC#3: spawnFn DI ejecuta node -e inline-script → state.json + NDJSON head-line observables', async () => {
    _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-launch-'));
    // ... setup tmp repo + cmux stub (analog test/orchestrator-launch-isolation.test.js) ...

    const inlineScript = `
      process.env.KODO_DIR = ${JSON.stringify(join(_tmpHome, '.kodo'))};
      const { addSession } = await import(${JSON.stringify(join(REPO, 'src/session/state.js'))});
      const { createLogger } = await import(${JSON.stringify(join(REPO, 'src/logger.js'))});
      const { sessionStart } = await import(${JSON.stringify(join(REPO, 'src/logger-events.js'))});
      const sessionId = 'test-uuid-1234';
      const taskId = 'TEST-001';
      addSession(taskId, {
        task_id: taskId,
        session_id: sessionId,
        task_ref: 'TEST-001',
        workspace_ref: 'workspace:test',
        provider: 'plane',
        project_id: 'p1',
        summary: 'inline test',
        status: 'running',
        started_at: new Date().toISOString(),
        project_path: process.cwd(),
        gsd: false,
      });
      const log = createLogger({ sessionId }).child({ component: 'test' });
      sessionStart(log, {
        session_id: sessionId,
        task_id: taskId,
        provider: 'plane',
        project_path: process.cwd(),
        started_at: new Date().toISOString(),
      });
      process.exit(0);
    `;

    const calls = [];
    const spawnFn = (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      // Spawn real `node -e <inlineScript>` con HOME=_tmpHome aislado.
      return realSpawn(process.execPath, ['-e', inlineScript], {
        env: { ...process.env, HOME: _tmpHome, KODO_DIR: join(_tmpHome, '.kodo') },
      });
    };

    await launchOrchestrator({ logger: noopLogger, spawnFn });

    // Assertion 1: state.json contiene la sesión recién creada.
    const state = loadState(); // con KODO_DIR override
    assert.ok(state.sessions['TEST-001']);
    assert.equal(state.sessions['TEST-001'].session_id, 'test-uuid-1234');

    // Assertion 2: NDJSON head-line parseable con event=session.start.
    const logfile = join(_tmpHome, '.kodo', 'logs', 'test-uuid-1234.ndjson');
    const head = readFirstLine(logfile);
    const rec = JSON.parse(head);
    assert.equal(rec.event, 'session.start');
    assert.equal(rec.task_id, 'TEST-001');
    assert.ok(rec.transcript_path, 'transcript_path debe estar populated');
  });
});
```

**Session record shape (target del inline-script)** — referencia `src/session/state.js:11-30` typedef Session:
```js
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
 *   gsd?: boolean,
 *   // ...
 * }} Session
 */
```

**addSession analog (target call)** — `src/session/state.js:117-125`:
```js
export function addSession(taskId, session, logger = noopLogger) {
  const state = loadState();
  state.sessions[taskId] = session;
  saveState(state);
  logger.info('state.session.added', {
    task_id: taskId,
    status: session.status,
  });
}
```

**sessionStart helper (target call)** — `src/logger-events.js:108-120`:
```js
export function sessionStart(logger, fields) {
  const transcript_path = fields.transcript_path
    ?? resolveTranscriptPath(fields.project_path, fields.session_id);
  logger.info(EVENTS.SESSION_START, {
    event: EVENTS.SESSION_START,
    session_id: fields.session_id,
    task_id: fields.task_id,
    provider: fields.provider,
    project_path: fields.project_path,
    transcript_path,
    started_at: fields.started_at,
  });
}
```

**Inline-script idiom (analog hooks/session-start.js:219-233)** — dynamic import + try/catch fail-open:
```js
try {
  const { createLogger } = await import('../logger.js');
  const { sessionStart } = await import('../logger-events.js');
  const log = createLogger({ sessionId: session.session_id, ... });
  sessionStart(log, { session_id, task_id, provider, project_path, transcript_path, started_at });
} catch {
  // silent — never crash
}
```

**readFirstLine helper (assertion target)** — `src/logs/head-line.js:33-52`:
```js
export function readFirstLine(filePath) {
  // ... lee primera línea bounded 64KB ...
}
```

**cmux stub pattern (analog test/orchestrator-launch-isolation.test.js)** — el test ADVISORY-03 NO debe spawnar claude/cmux reales. Stub via `KODO_ROOT` env var + cmux client mock vía dynamic import overrides, mismo scaffold que ya bloquea --worktree (líneas 19-39).

---

## Shared Patterns

### DI Default Pattern (mandatory if-guard, no default fn)

**Source:** `src/cli/skill-sync.js:41-43` + decisión D-04/D-05.

**Apply to:** `cleanupFn` en `runSkillSyncCli` + `onConsoleWarn` en `syncSkill` + `spawnFn` en `launchOrchestrator`.

**Excerpt analog** (deps con default `||`):
```js
const write = deps.writeFn || ((s) => process.stdout.write(s));
const err = deps.errFn || ((s) => process.stderr.write(s));
const syncFn = deps.syncFn || syncSkill;
```

**Variant para los nuevos DI fields** (default NULL + if-guard) — necesario porque inyectar un default no-op cambia el side-effect observable:
```js
// ADVISORY-01:
const warn = onConsoleWarn ?? console.warn;
// ADVISORY-02:
const cleanupFn = deps.cleanupFn; // sin default; if(cleanupFn) await ...
// ADVISORY-03:
const spawnFn = opts.spawnFn; // sin default visible; consumer pasa o usa cmux
```

### HOME-isolation + tmpdir Fixture

**Source:** `test/skill-sync.test.js:38-79`.

**Apply to:** todos los tests nuevos en `test/skill-sync.test.js` y `test/launch.test.js` que requieran filesystem aislado.

**Excerpt** (verbatim del fixture canónico):
```js
function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  // ... seed canonical skill.md ...
  return { tmpHome, tmpRepo, skillDir };
}

// afterEach con chmod restore:
afterEach(() => {
  if (_tmpHome) {
    try { chmodSync(destOf(_tmpHome), 0o755); } catch {}
    rmSync(_tmpHome, { recursive: true, force: true });
  }
  if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
});
```

### Source-hygiene grep (color isolation + import constraints)

**Source:** `test/skill-sync.test.js:82-89` (stripComments) + `test/skill-sync.test.js:369-384` (assert pattern).

**Apply to:** tras modificar `src/skill/sync.js`, mantener el assert `picocolors` ausent. Tras modificar `src/cli/skill-sync.js`, mantener el assert `import ../skill/sync.js` presente.

**Excerpt** (stripComments verbatim):
```js
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

### NoopLogger pattern

**Source:** `src/session/state.js:6-7` import.

**Apply to:** tests de `launchOrchestrator` que invocan funciones con `logger` opcional sin querer side-effects.
```js
import { noopLogger } from '../logger-noop.js';
// ...
await launchOrchestrator({ logger: noopLogger, spawnFn });
```

### exit ordering via process.hrtime.bigint()

**Source:** decisión D-06 (no analog existente — patrón emergente).

**Apply to:** los 3 tests de ADVISORY-02 ordering.

**Excerpt template**:
```js
const ts = [];
const cleanupFn = async () => {
  await new Promise((r) => setImmediate(r));
  ts.push({ tag: 'cleanup', t: process.hrtime.bigint() });
};
const code = await runSkillSyncCli(opts, { ...deps, cleanupFn });
ts.push({ tag: 'return', t: process.hrtime.bigint() });
assert.ok(ts[0].t < ts[1].t, 'cleanup_ts < return_ts');
```

## No Analog Found

Ninguno. Los 5 files tienen analog completo. Todos los patrones son extensiones aditivas de código pre-existente (incluyendo el record shape + sessionStart emitter que ya existen).

## Metadata

**Analog search scope:**
- `/Users/alex/dev/klab/kodo/src/skill/sync.js`
- `/Users/alex/dev/klab/kodo/src/cli/skill-sync.js`
- `/Users/alex/dev/klab/kodo/src/cli/gsd-verify.js`
- `/Users/alex/dev/klab/kodo/src/orchestrator/launch.js`
- `/Users/alex/dev/klab/kodo/src/session/state.js`
- `/Users/alex/dev/klab/kodo/src/logger-events.js`
- `/Users/alex/dev/klab/kodo/src/logs/head-line.js`
- `/Users/alex/dev/klab/kodo/src/hooks/session-start.js`
- `/Users/alex/dev/klab/kodo/test/skill-sync.test.js`
- `/Users/alex/dev/klab/kodo/test/launch.test.js`
- `/Users/alex/dev/klab/kodo/test/orchestrator-launch-isolation.test.js`

**Files scanned:** 11 (5 modificados + 6 análogos read-only)
**Pattern extraction date:** 2026-05-21
