# Phase 9: Phase Resolver + Bootstrap — Pattern Map

**Mapped:** 2026-04-20
**Files analyzed:** 10 (4 nuevos + 6 modificados)
**Analogs found:** 10 / 10 (cobertura 100%)

## File Classification

| File | New/Modified | Role | Data Flow | Closest Analog | Match Quality |
|------|--------------|------|-----------|----------------|---------------|
| `src/gsd/roadmap.js` | NEW | utility (pure parser) | transform | `src/labels.js` | exact (pure parser, no I/O) |
| `src/gsd/resolver.js` | NEW | service (orchestration) | request-response | `src/gsd/lock.js` | exact (gsd pure module con I/O, DI-able) |
| `src/cli/gsd-inspect.js` (o inline en cli.js) | NEW | CLI action handler | request-response | `src/logs/reader.js` + `cli.js` `logs` subcommand | exact |
| `test/gsd-roadmap.test.js` | NEW | test | request-response | `test/labels.test.js` | exact (unit de parser puro) |
| `test/gsd-resolver.test.js` | NEW | test | request-response | `test/gsd-lock.test.js` | exact (integración con tmpDir) |
| `test/gsd-inspect-cli.test.js` | NEW | test | request-response | `test/dispatcher.test.js` (sección GSD) | role-match (DI de resolvePhaseFn) |
| `src/triggers/dispatcher.js` | MOD | controller | request-response | self (patrón CR-01/WR-01 de Phase 8) | exact (mismo archivo, ampliar guard chain) |
| `src/session/manager.js` | MOD | service | CRUD | self (`buildSessionFromTask` / `launchWorkItem`) | exact (aditivo: opts.phase_id, opts.brief) |
| `src/session/state.js` | MOD | model (typedef) | CRUD | self (typedef `Session`) | exact (añadir `brief?` opcional) |
| `src/hooks/session-start.js` | MOD | hook | event-driven | self (`buildGsdContext`) | exact (extender signature con brief) |
| `src/cli.js` | MOD | CLI router | request-response | self (subcommand `logs`, Phase 7) | exact (mismo patrón commander) |

## Pattern Assignments

---

### `src/gsd/roadmap.js` (NEW — pure parser)

**Analog:** `src/labels.js` — 38 líneas, pure transform, sin imports node:*.

**Copy patterns from `src/labels.js`:**

**Header + JSDoc de módulo puro** (líneas 1-11):
```javascript
// @ts-check

/**
 * Parse kodo labels from a work item's label data.
 * ...
 *
 * @param {Array<any>} labels
 * @returns {{ isKodo: boolean, model: string|null, flags: string[] }}
 */
export function parseKodoLabels(labels) {
```

**Shape del retorno** — objeto estructurado con defaults al principio (línea 13):
```javascript
const result = { isKodo: false, model: null, flags: [] };
if (!Array.isArray(labels) || labels.length === 0) return result;
```

**Pattern para `parseRoadmap(md)`** (aplicar a roadmap.js):
```javascript
// @ts-check

/**
 * Parse a ROADMAP.md string into structured phases. Pure: no I/O.
 *
 * Accepts heading levels `##` and `###` (D-05). Titles `#` and `####` rejected.
 * Accepts integer and decimal phase numbers (D-08): `Phase 9`, `Phase 72.1`.
 * Ranges like `Phase 1-5` are ignored (do not match regex).
 *
 * @param {string} md - Raw ROADMAP.md content.
 * @returns {{ phases: Array<{ n: string, title: string, heading: string, line: number }> }}
 */
export function parseRoadmap(md) {
  const result = { phases: [] };
  if (typeof md !== 'string' || md.length === 0) return result;

  const lines = md.split('\n');
  const re = /^(##{1,2})\s+Phase\s+(\d+(?:\.\d+)?)\s*[:\-]\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    result.phases.push({
      n: m[2],
      title: m[3].trim(),
      heading: lines[i],
      line: i + 1,
    });
  }
  return result;
}
```

**Nota de regex (D-05):** Usar `##{1,2}` para capturar `##` y `###` (no `##{2,3}` — ese cuenta desde 2 extras, i.e. 3-4 hashes). Confirmar en unit tests que `#` y `####` no matchean.

**Normalización de títulos (D-07)** — helper pequeño en el mismo módulo:
```javascript
/**
 * Normalize a title for strict 1:1 matching (D-07).
 * Only: trim + collapse whitespace runs + lowercase. Keeps punctuation/backticks.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeTitle(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}
```

---

### `src/gsd/resolver.js` (NEW — orquestación)

**Analog:** `src/gsd/lock.js` (222 líneas) — mismo directorio, mismo estilo: `// @ts-check`, JSDoc `@typedef` con discriminated unions, factory functions puras, fs síncrono, exports nombrados.

**Copy patterns from `src/gsd/lock.js`:**

**Header de módulo con doc block grande** (líneas 1-30):
```javascript
// @ts-check
import {
  readFileSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

/**
 * GSD phase resolver.
 *
 * Implements D-01 (two-module split), D-02 (discriminated union return),
 * D-05..D-08 (parser shape) from Phase 9 CONTEXT.md.
 *
 * Fail-closed semantics (GSD-03): 0 matches, >1 matches, or missing
 * ROADMAP.md when .planning/PROJECT.md is present → always returns an
 * `{ action: 'error' }` verdict. The dispatcher decides what to do
 * (release lock, return 'resolver_failed').
 */
```

**Discriminated union typedef** (patrón `AcquireResult` en lock.js:48):
```javascript
/**
 * @typedef {{ action: 'phase', phase_id: string, match_heading: string, match_reason: string }} PhaseVerdict
 * @typedef {{ action: 'bootstrap', reason: 'no-planning-dir' }} BootstrapVerdict
 * @typedef {{ action: 'error', code: 'no-match' | 'multi-match' | 'roadmap-missing', detail?: string, matches?: string[] }} ErrorVerdict
 * @typedef {PhaseVerdict | BootstrapVerdict | ErrorVerdict} ResolveResult
 */
```

**Pattern para `resolvePhase()`**:
```javascript
/**
 * @param {{ projectPath: string, task: { title: string, ref?: string } }} params
 * @returns {ResolveResult}
 */
export function resolvePhase({ projectPath, task }) {
  // Bootstrap guard (GSD-02): .planning/PROJECT.md missing → bootstrap.
  const projectMd = join(projectPath, '.planning', 'PROJECT.md');
  if (!existsSync(projectMd)) {
    return { action: 'bootstrap', reason: 'no-planning-dir' };
  }

  // ROADMAP.md missing with PROJECT.md present → fail-closed error.
  const roadmapMd = join(projectPath, '.planning', 'ROADMAP.md');
  if (!existsSync(roadmapMd)) {
    return { action: 'error', code: 'roadmap-missing', detail: roadmapMd };
  }

  const md = readFileSync(roadmapMd, 'utf-8');
  const { phases } = parseRoadmap(md);
  const needle = normalizeTitle(task.title);
  const matches = phases.filter((p) => normalizeTitle(p.title) === needle);

  if (matches.length === 0) {
    return { action: 'error', code: 'no-match' };
  }
  if (matches.length > 1) {
    return {
      action: 'error',
      code: 'multi-match',
      matches: matches.map((m) => `Phase ${m.n}: ${m.title}`),
    };
  }

  const hit = matches[0];
  return {
    action: 'phase',
    phase_id: hit.n,
    match_heading: hit.heading,
    match_reason: `exact title match (normalized)`,
  };
}
```

**Note (similar a lock.js:179):** No usar `realpathSync` aquí — el dispatcher ya resolvió projectPath y reutilizarlo es suficiente. Añadir realpath sería inconsistente con el resto del resolver y caro (lock.js lo necesita para colapsar `/tmp` → `/private/tmp`, el resolver solo lee dos archivos).

---

### `src/cli/gsd-inspect.js` (NEW — CLI action handler, o inline en cli.js)

**Analog:** `src/logs/reader.js` (action handler) + `cli.js:213-239` (subcommand registration).

**Copy patterns from `src/logs/reader.js:1-24`:**

**Header de módulo con comentario de responsabilidades**:
```javascript
// @ts-check
//
// src/cli/gsd-inspect.js — Action handler de `kodo gsd inspect <task-id>`.
//
// Responsabilidades (D-16..D-19):
//   1. Resolver task via provider (igual que dispatcher).
//   2. Resolver projectPath via resolveProjectPath.
//   3. Llamar resolvePhase() — MISMA función que dispatcher (D-04).
//   4. Renderizar preview de buildGsdContext con session sintético.
//   5. Emitir human-readable (default) o JSON (--json, D-17).
//   6. Exit code 0 si phase|bootstrap, 1 si error (D-19).
//
// Dry-run estricto (D-18): NO lock, NO state, NO cmux. Pure read-only.
//
```

**Pattern del signature `runLogs(opts)` (reader.js:38-44)** — aplicar a `runGsdInspect`:
```javascript
/**
 * @typedef {{ taskId: string, json?: boolean }} RunGsdInspectOpts
 */

/**
 * @param {RunGsdInspectOpts} opts
 * @returns {Promise<number>} exit code (0 success, 1 resolver error)
 */
export async function runGsdInspect(opts) {
  // ... fetch task, resolve project path, call resolvePhase, render
}
```

**Subcommand registration pattern (copy from `cli.js:213-239` — el comando `logs`):**
```javascript
// --- kodo gsd inspect ---
const gsd = program.command('gsd').description('GSD subcommands');
gsd
  .command('inspect <task-id>')
  .description('Dry-run the phase resolver for a task (read-only)')
  .option('--json', 'Emit structured verdict as JSON')
  .action(async (taskId, opts) => {
    try {
      const { runGsdInspect } = await import('./cli/gsd-inspect.js');
      const code = await runGsdInspect({ taskId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Human-readable rendering (D-16) — cuatro secciones:**
```javascript
// Section 1: task resolution
process.stdout.write(`Task:         ${task.ref} — ${task.title}\n`);
process.stdout.write(`Labels:       [${task.labels.join(', ')}]\n`);
process.stdout.write(`Project path: ${projectPath}\n\n`);

// Section 2: .planning/PROJECT.md presence
const hasPlanning = existsSync(join(projectPath, '.planning', 'PROJECT.md'));
process.stdout.write(`.planning/PROJECT.md: ${hasPlanning ? 'present' : 'MISSING'}\n\n`);

// Section 3: verdict (exhaustive switch per D-02)
process.stdout.write(`Verdict:\n`);
switch (verdict.action) {
  case 'phase':
    process.stdout.write(`  phase_id:      ${verdict.phase_id}\n`);
    process.stdout.write(`  match_heading: ${verdict.match_heading}\n`);
    break;
  case 'bootstrap':
    process.stdout.write(`  bootstrap (${verdict.reason})\n`);
    break;
  case 'error':
    process.stdout.write(`  error.code:   ${verdict.code}\n`);
    if (verdict.detail) process.stdout.write(`  detail:       ${verdict.detail}\n`);
    if (verdict.matches) process.stdout.write(`  matches:      ${verdict.matches.join(', ')}\n`);
    break;
}

// Section 4: preview of buildGsdContext (render with synthetic session)
const syntheticSession = { /* ... minimal fields needed by buildGsdContext ... */ };
const brief = verdict.action === 'bootstrap' ? buildBriefFromTask(task) : null;
const preview = buildGsdContext(syntheticSession, { brief });
process.stdout.write(`\n─── buildGsdContext preview ───\n`);
process.stdout.write(preview);
process.stdout.write(`\n───────────────────────────────\n`);
```

**JSON mode (D-17) — emit verdict + metadata:**
```javascript
if (opts.json) {
  process.stdout.write(JSON.stringify({
    task: { ref: task.ref, title: task.title, labels: task.labels },
    project_path: projectPath,
    has_planning_dir: hasPlanning,
    verdict,
    brief: verdict.action === 'bootstrap' ? brief : null,
  }, null, 2) + '\n');
}
```

**Exit code pattern (D-19)** — copiar `reader.js:54-63` error exit:
```javascript
return verdict.action === 'error' ? 1 : 0;
```

---

### `src/triggers/dispatcher.js` (MODIFIED — guard chain + release paths)

**Analog:** self — Phase 8 CR-01/WR-01 es el patrón literal a clonar para `phase_id` + `brief`.

**Extension points — extend DispatchDeps typedef (dispatcher.js:15-25):**
```javascript
/**
 * @typedef {{
 *   ...
 *   resolvePhaseFn?: (params: { projectPath: string, task: object }) => object,
 * }} DispatchDeps
 */
```

**Extension point — return union (dispatcher.js:35):**
```javascript
// Añadir 'resolver_failed' al enum:
// Promise<{ action: 'launched'|'ignored'|'already_active'|'stale_relaunch'|'cleaned'|'gsd_locked'|'resolver_failed', ..., code?: string, detail?: string }>
```

**Insertion point — después de `acquireGsdLockFn` (dispatcher.js:117-128) y ANTES del session-already-active guard (dispatcher.js:131):**
```javascript
// 3c. GSD phase resolution — Phase 9 (D-03). Only for GSD-flagged tasks,
// only after the repo lock is acquired. If the resolver fails (no-match,
// multi-match, roadmap-missing), release the lock and return early.
let gsdPhaseId = null;
let gsdBrief = null;
if (kodoConfig.flags.includes('gsd') && gsdProjectPath) {
  const verdict = resolvePhaseFn({ projectPath: gsdProjectPath, task });
  switch (verdict.action) {
    case 'phase':
      gsdPhaseId = verdict.phase_id;
      // emit gsd.phase.resolved { matched: true, phase_id }
      break;
    case 'bootstrap':
      gsdBrief = buildBriefFromTask(task); // inline helper or from new module
      // emit gsd.bootstrap { project_path, brief_empty: !task.description }
      break;
    case 'error':
      // Fail-closed (D-13). Release lock, return resolver_failed.
      try { releaseGsdLockFn(gsdProjectPath, gsdSessionId); } catch {}
      // emit gsd.phase.resolved { matched: false, error_code, detail }
      return { action: 'resolver_failed', code: verdict.code, detail: verdict.detail };
  }
}
```

**Thread into launchOpts — copy line 150-156 and 177-183 pattern verbatim** (same technique as Phase 8 CR-01 used for `sessionId`):
```javascript
const launchOpts = {
  model: opts.model ?? kodoConfig.model,
  flags: [...(opts.flags || []), ...kodoConfig.flags],
  ...(gsdSessionId ? { sessionId: gsdSessionId } : {}),
  ...(gsdPhaseId ? { phase_id: gsdPhaseId } : {}),
  ...(gsdBrief ? { brief: gsdBrief } : {}),
};
```

**Release-on-throw (dispatcher.js:159-172, 186-196) — no cambios, el catch existente ya cubre el caso porque `releaseGsdLockFn` es idempotente.**

**DI injection (dispatcher.js:43-45)** — añadir una línea análoga a `acquireGsdLockFn`:
```javascript
const resolvePhaseFn = deps.resolvePhaseFn || ((params) => {
  const { resolvePhase } = require('../gsd/resolver.js'); // or dynamic import
  return resolvePhase(params);
});
```
Como el resto del módulo usa `import` estático, preferir:
```javascript
import { resolvePhase } from '../gsd/resolver.js';
// ...
const resolvePhaseFn = deps.resolvePhaseFn || resolvePhase;
```

**Event emission** — el dispatcher aún no importa el logger (actualmente no emite eventos). Phase 9 introduce la primera invocación de `gsdPhaseResolved` / `gsdBootstrap` desde el dispatcher. Usar el patrón `session-start.js:151-168` (best-effort try/catch, dynamic import de logger + logger-events):
```javascript
try {
  const { createLogger } = await import('../logger.js');
  const { gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js');
  const log = createLogger({ sessionId: gsdSessionId }).child({ component: 'dispatcher' });
  if (verdict.action === 'phase') {
    gsdPhaseResolved(log, { phase_id: verdict.phase_id, match_heading: verdict.match_heading });
  }
} catch { /* silent */ }
```

---

### `src/session/manager.js` (MODIFIED — aditivo)

**Analog:** self — `buildSessionFromTask` (manager.js:25) y `launchWorkItem` (manager.js:132).

**Copy pattern from `buildSessionFromTask` (line 39-41)** — conditional spread para campos opcionales:
```javascript
// Existing pattern (keep literal):
...(flags?.includes('gsd') ? { gsd: true } : {}),
// New additions — same shape:
...(phaseId ? { phase_id: phaseId } : {}),
...(brief ? { brief } : {}),
```

**Extend signature (manager.js:15-23)**:
```javascript
/**
 * @param {{
 *   task: import('../interface.js').TaskItem,
 *   providerName: string,
 *   projectPath: string,
 *   workspaceRef: string,
 *   sessionId: string,
 *   flags?: string[],
 *   phaseId?: string,   // NEW (Phase 9)
 *   brief?: string,     // NEW (Phase 9) — only if D-09 persistence decision is YES
 * }} params
 */
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags, phaseId, brief }) {
```

**Extend `launchWorkItem` opts (manager.js:126-131)** — clon literal del pattern CR-01 (`sessionId` acceptance):
```javascript
/**
 * @param {string} identifier
 * @param {{ model?: string|null, flags?: string[], sessionId?: string, phase_id?: string, brief?: string }} [opts]
 */
export async function launchWorkItem(identifier, opts = {}) {
```

**Thread to buildSessionFromTask (manager.js:193-200)**:
```javascript
const session = buildSessionFromTask({
  task,
  providerName: config.provider,
  projectPath,
  workspaceRef,
  sessionId,
  flags: combinedFlags,
  phaseId: opts.phase_id,   // NEW
  brief: opts.brief,        // NEW (if persisted)
});
```

---

### `src/session/state.js` (MODIFIED — typedef only)

**Analog:** self — `Session` typedef (state.js:11-27). Ya tiene `phase_id?: string` (Phase 8 D-11, línea 26).

**Add to typedef (state.js:26, line already shows phase_id)** — decisión D-09 pendiente: brief persistente o transitorio.

Si se persiste (recomendado por simplicidad del hook SessionStart, que lee el record):
```javascript
/**
 * @typedef {{
 *   ...
 *   phase_id?: string,      // Phase 9: resolved phase identifier (was Phase 8 prep).
 *   brief?: string,         // Phase 9 (D-09): bootstrap brief for no-phase sessions.
 * }} Session
 */
```

**No changes to `loadState` / `saveState` / `addSession` / `updateSession`** — el schema v2 es flexible y no requiere migración (campos opcionales son aditivos).

---

### `src/hooks/session-start.js` (MODIFIED — extender `buildGsdContext`)

**Analog:** self — `buildGsdContext` (session-start.js:77-117).

**Extend signature** (session-start.js:76):
```javascript
/**
 * Build GSD-mode context injected into Claude Code sessions.
 *
 * @param {import('../session/state.js').Session} session
 * @param {{ brief?: string }} [opts] - Phase 9: bootstrap brief rendered before commands (D-11 order).
 * @returns {string}
 */
export function buildGsdContext(session, opts = {}) {
  const lines = [
    // ... existing header lines 78-89 ...
  ];

  if (session.phase_id) {
    // ... existing phase branch (lines 92-102) unchanged ...
  } else {
    // D-11: brief FIRST, commands after.
    if (opts.brief) {
      lines.push(opts.brief, '');  // D-10 formatted block
    }
    // ... existing bootstrap branch (lines 105-113) ...
  }

  return lines.join('\n');
}
```

**Brief format (D-10) — helper en el mismo archivo o en un nuevo módulo `src/gsd/brief.js`:**
```javascript
/**
 * Render the bootstrap brief block per D-10.
 * @param {{ ref: string, title: string, url?: string, description?: string|null }} task
 * @returns {string}
 */
export function buildBriefFromTask(task) {
  const body = task.description && task.description.trim()
    ? task.description
    : '(no description provided)';
  return [
    '## Project Brief',
    '',
    `**Task:** ${task.ref} — ${task.title}`,
    task.url ? `**Source:** ${task.url}` : null,
    '',
    body,
  ].filter((l) => l !== null).join('\n');
}
```

**Caller (session-start.js:143-146)** — pasar el brief al render:
```javascript
const context = session.gsd
  ? buildGsdContext(session, { brief: session.brief })  // NEW: thread brief from record
  : buildSessionContext(session, loadConfig());
```

**Migrate `gsd.phase.resolved` emission (D-14 + specifics line 140-141)** — eliminar la emisión del hook (session-start.js:179-181) porque el dispatcher pasa a ser fuente de verdad. El hook solo mantiene:
- `session.start` (siempre)
- `gsd.bootstrap` (SOLO si `session.gsd && !session.phase_id`)

Resultado del refactor de session-start.js:171-189:
```javascript
if (session.gsd && !session.phase_id) {
  try {
    const { createLogger } = await import('../logger.js');
    const { gsdBootstrap } = await import('../logger-events.js');
    const log = createLogger({ sessionId: session.session_id }).child({ component: 'hook', task_id: session.task_id });
    gsdBootstrap(log, { project_path: session.project_path });
  } catch { /* silent */ }
}
// gsd.phase.resolved is no longer emitted here — it lives in the dispatcher (Phase 9 D-14).
```

---

### `src/cli.js` (MODIFIED — nuevo subcommand `gsd inspect`)

**Analog:** self — el subcomando `logs` de Phase 7 (cli.js:213-239) es el patrón exacto.

**Copy from `cli.js:213-239` (literal):**
```javascript
program
  .command('logs [session-id]')
  .description('Inspect a session log (dump, tail, filter)')
  .option('-f, --follow', 'Tail live output (like tail -f)')
  // ... more options ...
  .action(async (sessionId, opts) => {
    try {
      const { runLogs } = await import('./logs/reader.js');
      await runLogs({ /* ... */ });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Apply to `gsd inspect` (group subcommand, commander convention):**
```javascript
// --- kodo gsd <subcommand> ---
const gsd = program.command('gsd').description('GSD subcommands');

gsd
  .command('inspect <task-id>')
  .description('Dry-run the phase resolver for a task (read-only)')
  .option('--json', 'Emit structured verdict as JSON')
  .action(async (taskId, opts) => {
    await ensureConfig();
    try {
      const { runGsdInspect } = await import('./cli/gsd-inspect.js');
      const code = await runGsdInspect({ taskId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Critique reasonable:** El CONTEXT indica "inline en cli.js O en src/cli/gsd-inspect.js". Recomendación: **archivo dedicado** `src/cli/gsd-inspect.js`. cli.js ya tiene 469 líneas; meter inline la lógica de inspect (~100 líneas mínimo) lo vuelve difícil de mantener. El patrón `logs` ya demuestra que cli.js solo registra el comando y delega en un módulo handler.

---

### `test/gsd-roadmap.test.js` (NEW — unit tests del parser)

**Analog:** `test/labels.test.js` (60+ líneas, imports mínimos, `describe`/`it` flat, `assert.equal`/`assert.deepEqual`).

**Copy the header pattern (labels.test.js:1-4):**
```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoadmap, normalizeTitle } from '../src/gsd/roadmap.js';
```

**Copy the describe/it flat shape (labels.test.js:5-60):**
```javascript
describe('parseRoadmap', () => {
  it('returns empty phases when markdown is empty', () => {
    assert.deepEqual(parseRoadmap(''), { phases: [] });
  });

  it('parses ## Phase headings (spec form)', () => {
    const md = '## Phase 1: Foundation\nbody\n## Phase 2: Rollout\n';
    const { phases } = parseRoadmap(md);
    assert.equal(phases.length, 2);
    assert.equal(phases[0].n, '1');
    assert.equal(phases[0].title, 'Foundation');
  });

  it('parses ### Phase headings (real ROADMAP form, D-05)', () => {
    const md = '### Phase 9: Phase Resolver + Bootstrap\n';
    const { phases } = parseRoadmap(md);
    assert.equal(phases.length, 1);
    assert.equal(phases[0].n, '9');
    assert.equal(phases[0].title, 'Phase Resolver + Bootstrap');
  });

  it('rejects # and #### levels', () => {
    const md = '# Phase 1: Hashed\n#### Phase 2: Too deep\n';
    assert.deepEqual(parseRoadmap(md), { phases: [] });
  });

  it('accepts decimal phase numbers (D-08, forward compat)', () => {
    const { phases } = parseRoadmap('## Phase 72.1: Inserted\n');
    assert.equal(phases[0].n, '72.1');
  });

  it('ignores range headings like Phase 1-5', () => {
    const { phases } = parseRoadmap('## Phase 1-5: Overview\n');
    assert.equal(phases.length, 0);
  });
});

describe('normalizeTitle', () => {
  it('lowercases, trims, and collapses whitespace — nothing else (D-07)', () => {
    assert.equal(normalizeTitle('  Phase   Resolver  '), 'phase   resolver'.replace(/\s+/g, ' '));
    assert.equal(normalizeTitle('Foo: `bar`'), 'foo: `bar`'); // punctuation preserved
  });
});
```

---

### `test/gsd-resolver.test.js` (NEW — integration with tmp dirs)

**Analog:** `test/gsd-lock.test.js` (líneas 1-80) — mismo estilo: `mkdtempSync` + `rmSync` en `beforeEach`/`afterEach`, helper `writeLockDirect` análogo al que escribe ROADMAP.md.

**Copy the tmpDir setup (gsd-lock.test.js:49-59):**
```javascript
// @ts-check
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolvePhase } from '../src/gsd/resolver.js';

/** @param {string} projectPath, @param {string} md */
function writePlanning(projectPath, files) {
  const planning = join(projectPath, '.planning');
  mkdirSync(planning, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(planning, name), content);
  }
}

describe('resolvePhase — bootstrap vs error vs phase', () => {
  /** @type {string} */ let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'kodo-resolver-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns bootstrap when .planning/PROJECT.md is missing', () => {
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'whatever' } });
    assert.equal(r.action, 'bootstrap');
    assert.equal(r.reason, 'no-planning-dir');
  });

  it('returns error roadmap-missing when PROJECT.md present but ROADMAP.md absent', () => {
    writePlanning(tmpDir, { 'PROJECT.md': '# proj' });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.action, 'error');
    assert.equal(r.code, 'roadmap-missing');
  });

  it('returns phase on exact match', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# proj',
      'ROADMAP.md': '## Phase 3: Consumer Rewiring\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Consumer Rewiring' } });
    assert.equal(r.action, 'phase');
    assert.equal(r.phase_id, '3');
  });

  it('returns error no-match when title differs', () => {
    writePlanning(tmpDir, { 'PROJECT.md': '# p', 'ROADMAP.md': '## Phase 1: Foo\n' });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Bar' } });
    assert.equal(r.code, 'no-match');
  });

  it('returns error multi-match with list of matches', () => {
    writePlanning(tmpDir, {
      'PROJECT.md': '# p',
      'ROADMAP.md': '## Phase 1: Foo\n## Phase 2: Foo\n',
    });
    const r = resolvePhase({ projectPath: tmpDir, task: { title: 'Foo' } });
    assert.equal(r.code, 'multi-match');
    assert.equal(r.matches.length, 2);
  });
});
```

---

### `test/gsd-inspect-cli.test.js` (NEW — CLI action handler)

**Analog:** `test/dispatcher.test.js:302-394` — DI pattern con `acquireGsdLockFn` / `resolveProjectPathFn`.

**Aplicar al handler `runGsdInspect`** — inyectar `resolvePhaseFn` + `getProviderFn` para evitar tocar filesystem/red:
```javascript
describe('runGsdInspect — read-only dry-run', () => {
  it('exits 0 and prints phase_id when verdict is phase', async () => {
    // Capture stdout via process.stdout.write stub
    // Call runGsdInspect({ taskId: 'KL-42' }, { getProviderFn, resolvePhaseFn, ... })
    // Assert exit code 0 + stdout includes 'phase_id: 9'
  });

  it('exits 1 when verdict is error', async () => { /* ... */ });
  it('--json emits structured verdict', async () => { /* ... */ });
  it('never acquires lock (D-18 pure read-only)', async () => {
    let lockCalled = false;
    // acquireGsdLockFn spy — must never be invoked
  });
});
```

**Crítica del plan:** `runGsdInspect` debería aceptar deps inyectables (DI pattern de dispatcher.test.js) **desde el principio**. Si se escribe sin DI y luego se retrofita, los tests acabarán tocando filesystem real o requiriendo mocks globales. Añadir `DispatchDeps`-style opcional en `runGsdInspect(opts, deps = {})`.

---

## Shared Patterns

### 1. Module Header Convention
**Source:** todos los módulos existentes bajo `src/` empiezan con `// @ts-check` (lock.js:1, labels.js:1, dispatcher.js:1, state.js:1, manager.js:1).
**Apply to:** `src/gsd/roadmap.js`, `src/gsd/resolver.js`, `src/cli/gsd-inspect.js`.

### 2. Pure-Module / I/O-Module Split
**Source:** `src/labels.js` (puro) vs `src/gsd/lock.js` (con I/O, DI-able).
**Apply to:** D-01 — `roadmap.js` debe ser 100% puro (sin `node:fs`, sin `node:path`); `resolver.js` es el único que hace I/O y llama al parser.

### 3. Discriminated Union Return
**Source:** `src/gsd/lock.js:48` — `AcquireResult = { acquired: true } | { acquired: false, holder }`. Dispatcher consume con exhaustive check (`if (!lockResult.acquired)`, dispatcher.js:124).
**Apply to:** D-02 — `ResolveResult = PhaseVerdict | BootstrapVerdict | ErrorVerdict`. Todos los consumidores (dispatcher, CLI inspect) **deben** usar `switch (verdict.action)` exhaustivo.

### 4. DI via Optional Deps Object
**Source:** `src/triggers/dispatcher.js:15-25, 37-45` — `DispatchDeps` typedef, defaults mediante `deps.X || fallback`.
**Apply to:**
- `dispatcher.js`: añadir `resolvePhaseFn` al `DispatchDeps`.
- `src/cli/gsd-inspect.js`: seguir el mismo patrón para testabilidad (no tocar fs ni red en tests).

### 5. Best-Effort Silent Logger Invocation
**Source:** `src/hooks/session-start.js:151-168` — dynamic `await import` + try/catch silencioso.
**Apply to:** `dispatcher.js` cuando emita `gsdPhaseResolved` / `gsdBootstrap`. El dispatcher no debe fallar el launch por un error de logger.

### 6. Conditional Spread for Optional Fields
**Source:** `src/session/manager.js:41` — `...(flags?.includes('gsd') ? { gsd: true } : {})`.
**Apply to:** `buildSessionFromTask` cuando acepte `phase_id` y `brief` — `...(phaseId ? { phase_id: phaseId } : {})`. Mantiene el record limpio (no campos undefined explícitos).

### 7. Dynamic Import in CLI Action
**Source:** `src/cli.js:25, 82, 225` — todos los `.action(async (...) => { const { X } = await import('./mod.js') })`.
**Apply to:** nuevo subcommand `gsd inspect` — `const { runGsdInspect } = await import('./cli/gsd-inspect.js')`. Permite que `cli.js` cargue rápido sin arrastrar cadena de imports.

### 8. Test Pattern — describe/it flat con `node:test`
**Source:** `test/labels.test.js`, `test/gsd-lock.test.js`, `test/dispatcher.test.js`.
**Apply to:** los 3 nuevos tests de Phase 9 — misma shape, mismos imports (`describe/it/beforeEach/afterEach`), `assert/strict`.

### 9. tmpDir Fixture Pattern
**Source:** `test/gsd-lock.test.js:49-59`.
**Apply to:** `test/gsd-resolver.test.js` — `mkdtempSync(join(tmpdir(), 'kodo-resolver-'))` + `rmSync(... force: true)`.

### 10. Fail-Closed Lock Release on Error Path
**Source:** `src/triggers/dispatcher.js:159-172, 186-196` (patrón WR-01).
**Apply to:** nuevo camino `action === 'error'` del resolver — **release antes de return**. El principio: cualquier ruta que abandone el dispatcher después de acquire debe garantizar release (lock idempotente es la red de seguridad, no la política).

---

## No Analog Found

Todos los archivos de Phase 9 tienen análogo directo en el codebase. No hay necesidad de apoyarse en RESEARCH.md (inexistente para esta fase).

---

## Metadata

**Analog search scope:**
- `src/gsd/`, `src/triggers/`, `src/session/`, `src/hooks/`, `src/logs/`, `src/`
- `test/` (dispatcher, gsd-lock, labels, session-start)

**Files scanned:**
- Pure: `src/labels.js`, `src/logger-events.js`
- With I/O: `src/gsd/lock.js`, `src/triggers/dispatcher.js`, `src/session/manager.js`, `src/session/state.js`, `src/hooks/session-start.js`, `src/logs/reader.js`, `src/cli.js`
- Tests: `test/dispatcher.test.js`, `test/labels.test.js`, `test/gsd-lock.test.js`

**Pattern extraction date:** 2026-04-20

---

## Sanity Notes for the Planner

1. **D-04 invariant (una sola `resolvePhase`)** — el test CLI debe importar `resolvePhase` del mismo módulo que el dispatcher. No crear variantes.
2. **D-18 invariant (inspect no toca lock/state/cmux)** — el test debe incluir un spy sobre `acquireGsdLockFn` y aseverar que nunca es invocado. Bloquea regresiones futuras donde alguien "reutilice" código del dispatcher sin leer la nota.
3. **Regex de roadmap.js** — la spec del CONTEXT dice `##{2,3}`, pero ese regex matchea 3-4 hashes (no 2-3). El valor correcto para capturar `##` y `###` es `##{1,2}` o alternativa `#{2,3}`. Validar con unit test explícito por nivel de heading.
4. **Orden del guard chain en dispatcher** — labels → terminal-state → in-flight → GSD-lock → **resolver (NEW)** → already-active → launch. El resolver debe correr antes del `already-active` para que el `phase_id` se propague al relaunch stale path (dispatcher.js:148-172), no solo al primer launch.
5. **Emisión de `gsd.phase.resolved`** — **mover del hook al dispatcher** (session-start.js:179-181 sale; dispatcher.js lo emite). Si se mantiene el hook emitiendo también, hay duplicados en los logs y `kodo logs --event gsd.phase.resolved` se vuelve ruidoso.
6. **`brief` persistido vs transitorio** — el CONTEXT deja D-09 abierto. Recomendación fuerte: **persistirlo en el record `Session`**. El hook SessionStart solo tiene acceso al record (`findSession(cwd/sessionId)`); meter el brief como side-channel requeriría un mecanismo nuevo (env var, archivo temporal, etc.) que añade complejidad vs. un campo opcional en el JSON del state.
