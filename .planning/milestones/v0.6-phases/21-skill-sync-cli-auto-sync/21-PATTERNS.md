# Phase 21: Skill Sync CLI + Auto-Sync — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 7 (2 CREATE pure/handler + 3 MODIFY + 2 CREATE tests)
**Analogs found:** 7 / 7 (100% coverage; todos los archivos tienen analog directo en el codebase)

## File Classification

| New/Modified File | Type | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|------|-----------|----------------|---------------|
| `src/skill/sync.js` | CREATE | service (pure module) | file-I/O + transform | `src/gsd/verify.js` (orchestration + DI) + `src/session/state.js` (computeWorktreePath pure helper) | role+flow exact |
| `src/cli/skill-sync.js` | CREATE | controller (CLI handler) | request-response | `src/cli/gsd-verify.js` | exact (handler pattern) |
| `src/cli.js` | MODIFY | route (Commander wiring) | request-response | bloque `kodo gsd <inspect\|verify>` en `src/cli.js:241-274` | exact (subgrupo Commander) |
| `src/logger-events.js` | MODIFY | event-emitter | event-driven | helpers `worktreeCleanupOk/Dirty/Error` líneas 221-267 | exact (Phase 19 precedente literal) |
| `src/orchestrator/launch.js` | MODIFY | controller (orchestrator hook) | event-driven (fail-open) | `src/hooks/stop.js` worktree-cleanup outer block líneas 205-363 | role+flow exact |
| `test/skill-sync.test.js` | CREATE | test (integration spawnSync) | request-response | `test/skill-auto-commit.test.js` (spawnSync child + HOME + KODO_ROOT) + `test/dispatcher-isolation.test.js` (source-hygiene grep) | exact |
| `test/orchestrator-auto-sync.test.js` | CREATE | test (in-process DI) | event-driven | `test/gsd-verify-integration.test.js` (makeLogger memSink + makeDeps) | exact |

## Pattern Assignments

### `src/skill/sync.js` (service, file-I/O + transform)

**Analog principal:** `src/gsd/verify.js` (función pura `runGsdVerify(opts, deps)` con DI)
**Analog secundario:** `src/session/state.js` (helper puro, declared at top, sin I/O fuera del scope)

**Header pattern** — JSDoc shape + responsabilidades + invariantes (mirror de `src/gsd/verify.js:1-36`):
```javascript
// @ts-check
//
// src/skill/sync.js — Phase 21 D-08: módulo único de sincronización canonical → home.
//
// Responsabilidades:
//   1. Detectar drift por hash SHA-256 archivo por archivo (D-02 — no mtime).
//   2. Detectar y reemplazar symlink legacy en dest (D-04).
//   3. Copiar archivos cambiados; preservar foráneos salvo opts.prune (D-05).
//   4. Return { status, files_changed, files_pruned?, symlink_replaced?, error? }.
//      NO emite eventos (caller decide — D-08 SoSoT).
//
// Invariantes:
//   - lstatSync (NO statSync) detecta symlink sin seguirlo (Phase 19 D-02 patrón).
//   - rmSync(symlinkPath, { force: true }) borra solo el link, no el target.
//   - syncSkill es función pura testeable: NO emite eventos; el caller los emite (D-08).
//   - Walker manual recursivo (NO fs.cp) para control fino sobre diff hash + prune list.
```

**Imports pattern** (mirror de `src/gsd/verify.js:37-45` — solo Node stdlib, sin nuevas deps):
```javascript
import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync,
  lstatSync, rmSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
```

**DI signature pattern** (mirror de `runGsdVerify(opts, deps)` en `src/gsd/verify.js:76-97` y `runStopHook(input, deps)` en `src/hooks/stop.js:98-108`):
```javascript
/**
 * @typedef {{
 *   source: string,
 *   dest: string,
 *   prune?: boolean,
 *   logger?: import('../logger.js').Logger,
 * }} SyncSkillOpts
 *
 * @typedef {{
 *   status: 'ok' | 'noop' | 'error',
 *   files_changed: number,
 *   files_pruned?: number,
 *   symlink_replaced?: boolean,
 *   error?: string,
 * }} SyncSkillResult
 *
 * @param {SyncSkillOpts} opts
 * @returns {SyncSkillResult}
 */
export function syncSkill(opts) { /* ... */ }
```

**Symlink-detection pattern** (mirror de `src/hooks/stop.js:302-314` — lstatSync wrapped en try/catch para detectar dangling symlinks vs ENOENT):
```javascript
// D-04: detectar symlink legacy ANTES de tocar archivos.
// lstatSync NO sigue el symlink — coincide con el patrón Phase 19 CR-03.
let symlinkReplaced = false;
try {
  const st = lstatSync(dest);
  if (st.isSymbolicLink()) {
    rmSync(dest, { force: true }); // borra solo el link, no el target
    mkdirSync(dest, { recursive: true });
    symlinkReplaced = true;
  }
} catch (err) {
  // ENOENT: dest no existe. Cualquier otro error: defensa profunda, mkdirSync más abajo idempotente.
  if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
    // fall-through; mkdirSync recursive lo crea
  }
}
```

**Fail-soft outer try/catch pattern** (mirror de `src/hooks/stop.js:359-362` y `runGsdVerify` Plane catches en líneas individuales):
```javascript
// Outer try/catch — convierte syscall throw en return { status: 'error' }.
// El caller (CLI o orchestrator) decide qué hacer con el error.
try {
  // ... walker + hash + copy + prune
  return { status: filesChanged > 0 || symlinkReplaced ? 'ok' : 'noop', files_changed: filesChanged, ... };
} catch (err) {
  return { status: 'error', files_changed: filesChanged, error: /** @type {Error} */ (err).message };
}
```

**KODO_ROOT-style env override pattern** (consumido por el caller; mirror de `src/hooks/stop.js:20`):
```javascript
// El caller resuelve source/dest; este módulo NO lee env vars. Mantiene pureza.
// Ejemplo de cómo el caller lo invoca:
//   const source = join(process.env.KODO_ROOT || process.cwd(), '.claude', 'skills', 'kodo-orchestrate');
```

---

### `src/cli/skill-sync.js` (controller, request-response)

**Analog principal:** `src/cli/gsd-verify.js` (handler con DI completa + exit codes deterministas)
**Analog secundario:** `src/cli/gsd-inspect.js` (handler con renderHuman pattern + JSON branch)

**Header + DI shape** (mirror de `src/cli/gsd-verify.js:17-29`):
```javascript
// @ts-check
//
// src/cli/skill-sync.js — Action handler de `kodo skill sync`.
//
// Responsabilidades (CONTEXT §D-06, D-07, D-08):
//   1. Gate: ¿cwd es un repo kodo? (exit 2 + stderr canonical D-07).
//   2. Invocar syncSkill (lógica vive en src/skill/sync.js — D-08 SoSoT).
//   3. Render: human (default) coloreado via createFormatter, o JSON (--json).
//   4. Exit codes: 0 (ok/noop) — 1 (fs error) — 2 (no kodo repo).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { syncSkill } from '../skill/sync.js';
import { createFormatter } from './format.js';
```

**DI typedef** (mirror exacto de `src/cli/gsd-verify.js:20-29` con sustitución de fields):
```javascript
/**
 * @typedef {{ prune?: boolean, json?: boolean }} RunSkillSyncCliOpts
 *
 * @typedef {{
 *   syncFn?: typeof syncSkill,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 * }} RunSkillSyncCliDeps
 */
```

**Handler shape: defaults + body** (mirror de `src/cli/gsd-verify.js:57-85`):
```javascript
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  // Lazy: createFormatter solo si entramos al render TTY.
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  const source = join(cwd, '.claude', 'skills', 'kodo-orchestrate');
  const dest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');

  // Gate D-07 exit 2: stderr canonical message.
  if (!existsSync(join(source, 'skill.md'))) {
    err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
    return 2;
  }

  let result;
  try {
    result = syncFn({ source, dest, prune: opts.prune });
  } catch (e) {
    err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }
  if (result.status === 'error') {
    err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
    return 1;
  }

  if (opts.json) {
    write(JSON.stringify({
      status: result.status,
      files_changed: result.files_changed,
      ...(opts.prune ? { files_pruned: result.files_pruned ?? 0 } : {}),
      ...(result.symlink_replaced ? { symlink_replaced: true } : {}),
    }) + '\n');
  } else {
    renderHuman(result, dest, write, fmt);
  }
  return 0;
}
```

**renderHuman pattern** (mirror de `src/cli/gsd-verify.js:106-127` — usa `fmt.ok`/`fmt.yellow`/`fmt.green` desde `createFormatter`, sin importar picocolors directamente):
```javascript
function renderHuman(result, dest, write, fmt) {
  // Warning del symlink legacy va PRIMERO (informativo, D-04).
  if (result.symlink_replaced) {
    write(`${fmt.yellow('⚠')} Legacy symlink replaced at ${dest}\n`);
  }
  if (result.status === 'noop') {
    write(`${fmt.ok('No drift')} — ${dest} up to date\n`);
  } else {
    const n = result.files_changed;
    write(`${fmt.ok(`Synced ${n} file${n === 1 ? '' : 's'} to ${dest}`)}\n`);
  }
  if (result.files_pruned && result.files_pruned > 0) {
    write(`${fmt.yellow(`Pruned ${result.files_pruned} foreign file(s)`)}\n`);
  }
}
```

**Color isolation invariante** (Phase 14 D-07 + blindado por `test/format-isolation.test.js`): este archivo NUNCA importa `picocolors` directamente — solo `createFormatter`. El test `format-isolation.test.js` líneas 99-115 grep-asserta que `picocolors` solo se importa desde `src/cli/format.js`. Phase 21 lo respeta sin cambios.

---

### `src/cli.js` (route, request-response — MODIFY)

**Analog:** bloque `kodo gsd <inspect|verify>` líneas 241-274 (verificado en lectura)

**Insertion point:** después de la línea 274 (cierre del bloque `gsd.command('verify')`), antes de `program.parse()` (línea 276).

**Pattern a copiar literal** (líneas 241-274 son el molde):
```javascript
// --- kodo skill <subcommand> ---
const skill = program.command('skill').description('Skill management subcommands (sync, etc.)');

skill
  .command('sync')
  .description('Sync canonical skill <repo>/.claude/skills/kodo-orchestrate/ → ~/.claude/skills/kodo-orchestrate/')
  .option('--prune', 'Remove foreign files in home that are not in repo (destructive; opt-in)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    try {
      // NOTE: NO `ensureConfig()` — kodo skill sync no requiere provider configurado
      // (RESEARCH §Open Question 1; gate D-07 exit 2 sustituye al check de config).
      const { runSkillSyncCli } = await import('./cli/skill-sync.js');
      const code = await runSkillSyncCli({ prune: opts.prune || false, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Decisiones de wiring** (verificadas contra `kodo gsd verify` líneas 260-274):
- **Subgrupo Commander** (no flat command) → `program.command('skill')` devuelve un objeto reutilizable para futuros `skill diff` / `skill list` (CONTEXT §Deferred).
- **Lazy import** (`await import('./cli/skill-sync.js')`) → startup-budget protegido (LOG-12 spirit; mismo patrón que `gsd inspect|verify`).
- **`process.exit(code)`** explícito → handler retorna 0/1/2 y `process.exit` lo propaga literal.
- **NO `ensureConfig()`** → diferencia respecto a `gsd inspect|verify` (líneas 250, 266) — `skill sync` no necesita provider; el gate del handler (D-07 exit 2) basta.

---

### `src/logger-events.js` (event-emitter — MODIFY)

**Analog:** helpers `worktreeCleanupOk/Dirty/Error` líneas 221-267 (Phase 19 D-08; estructura literal a copiar).

**Insertion point:**
- **EVENTS object** (líneas 35-47): añadir 2 entries al final del `Object.freeze({...})`:
  ```javascript
  SKILL_SYNC_AUTO:        'skill.sync.auto',
  SKILL_SYNC_AUTO_ERROR:  'skill.sync.auto.error',
  ```
  Y actualizar el `@type` JSDoc (líneas 22-34) con las 2 nuevas claves.

- **Helpers** (después de la línea 267, donde termina `worktreeCleanupError`):

**Helper shape pattern** (mirror exacto de `worktreeCleanupOk` líneas 215-228):
```javascript
/**
 * Skill sync AUTO ok — emitted (info) when launchOrchestrator auto-syncs
 * the canonical skill from repo → home (Phase 21 D-03b). `files_changed` is
 * the count of files actually copied this run (may be 0 if drift was detected
 * but resolved via symlink-replace alone — symlink_replaced gets normalized
 * into a non-zero count by the caller).
 *
 * @param {Logger} logger
 * @param {{ source: string, dest: string, files_changed: number }} fields
 */
export function skillSyncAuto(logger, fields) {
  logger.info(EVENTS.SKILL_SYNC_AUTO, {
    event: EVENTS.SKILL_SYNC_AUTO,
    source: fields.source,
    dest: fields.dest,
    files_changed: fields.files_changed,
  });
}

/**
 * Skill sync AUTO error — emitted (error) when the auto-sync in launchOrchestrator
 * failed (FS error, permissions, etc). The orchestrator continues fail-open
 * (Phase 21 D-03 — mismo principio que worktree cleanup Phase 19 D-03).
 *
 * @param {Logger} logger
 * @param {{ source: string, dest: string, error: string }} fields
 */
export function skillSyncAutoError(logger, fields) {
  logger.error(EVENTS.SKILL_SYNC_AUTO_ERROR, {
    event: EVENTS.SKILL_SYNC_AUTO_ERROR,
    source: fields.source,
    dest: fields.dest,
    error: fields.error,
  });
}
```

**Level mapping**:
- `skillSyncAuto` → `logger.info` (igual que `worktreeCleanupOk` línea 222 — happy path).
- `skillSyncAutoError` → `logger.error` (igual que `worktreeCleanupError` línea 260 — hard fail).
- **NO `skill.sync.auto.noop`** event (D-03b: omitido para evitar ruido en cada launch; mismo principio que Phase 19 D-10 que descartó `worktree.cleanup.dirty` skipped legacy).

**Header comment update** (líneas 4-9): añadir `skill.sync.auto, skill.sync.auto.error` a la enumeración de eventos del comentario top:
```javascript
// Contrato fijo por ROADMAP §Phase 7 + extensiones v0.3 (LOG-09)
// + Phase 19 (worktree cleanup) + Phase 21 (skill sync):
//   session.start, session.end, state.transition, orchestrator.review,
//   gsd.phase.resolved, gsd.bootstrap, plane.api.call, plane.api.call.failed,
//   worktree.cleanup.ok, worktree.cleanup.dirty, worktree.cleanup.error,
//   skill.sync.auto, skill.sync.auto.error
```

---

### `src/orchestrator/launch.js` (controller, event-driven — MODIFY)

**Analog principal:** `src/hooks/stop.js` outer try/catch + fail-open block líneas 205-363 (Phase 19 worktree cleanup).
**Analog secundario:** Patrón `dynamic import` de logger-events.js (líneas 219, 223-228 stop.js).

**Insertion point:** entre las líneas 40 (`log?.info('orchestrator.launch.start'...)`) y 42 (`// Check if orchestrator is already running`). RESEARCH §Inserción confirma L44 antes de `cmux.listWorkspaces()` (versus L70 antes de `cmux.newWorkspace`).

**Imports adicionales al top** (mirror de `src/hooks/stop.js:12-15` con `homedir`):
```javascript
import { homedir } from 'node:os';
import { syncSkill } from '../skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../logger-events.js';
```

Y **constante KODO_ROOT-style** (mirror exacto de `src/hooks/stop.js:19-20`):
```javascript
const KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd();
// NOTA: cwd al import-time es el repo del operador cuando lanza `kodo orchestrate`.
// Para tests: KODO_ROOT env override (canon Phase 999.1 D-16 / skill-auto-commit.test.js).
```

**Auto-sync block pattern** (mirror de `src/hooks/stop.js:205-363` worktree cleanup outer block — fail-open con event emission):
```javascript
// ─── PHASE 21 D-03 fail-open auto-sync ───
// Sincroniza canonical skill <repo>/.claude/skills/kodo-orchestrate/ → home
// ANTES del primer side-effect cmux (D-08 SoSoT: mismo módulo que kodo skill sync).
// Si falla: emit skill.sync.auto.error + continuar (D-03 — la skill local del repo
// gana por construcción Phase 999.1 D-04, así el orchestrator funciona stale-home).
// NO se hace prune (D-05c — prune solo manual).
try {
  const source = join(KODO_ROOT_FOR_SKILL, '.claude', 'skills', 'kodo-orchestrate');
  const dest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');
  const result = syncSkill({ source, dest });
  if (result.status === 'error') {
    if (log) skillSyncAutoError(log, { source, dest, error: result.error || 'unknown' });
  } else if (result.status === 'ok') {
    if (log) skillSyncAuto(log, { source, dest, files_changed: result.files_changed });
  }
  // 'noop' → silencio total (D-03b — sin .noop event para evitar ruido).
} catch (err) {
  // Defense in depth: si syncSkill throws inesperado, fail-open silencioso.
  // Mismo patrón que stop.js:359-362 outer catch.
  console.error(`[kodo:orchestrator] skill sync failed: ${/** @type {Error} */ (err).message}`);
}
// ────────────────────────────────────────────
```

**Constraint cwd=repo preservation** (Phase 999.1 D-04 + SKILL-03 + D-10): el bloque insertado NO toca `process.cwd()` ni los args de `cmux.newWorkspace({ cwd: process.cwd() })` línea 72. La skill canonical sigue siendo la del repo. Verificable por grep-assert en `test/orchestrator-launch-isolation.test.js` style — el archivo NO añade lectura de `~/.claude/skills/kodo-orchestrate/skill.md`.

**Comentario Phase 18 D-06 (líneas 83-101) NO se toca** — preservado intacto.

---

### `test/skill-sync.test.js` (test integration spawnSync — CREATE)

**Analog principal:** `test/skill-auto-commit.test.js` (Phase 999.1 D-16 — spawnSync child + HOME + KODO_ROOT override + git init local + makeIsolatedRepo).
**Analog secundario:** `test/dispatcher-isolation.test.js` (source-hygiene grep + stripComments).

**Imports + constants** (mirror exacto de `test/skill-auto-commit.test.js:22-32`):
```javascript
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  lstatSync, symlinkSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');
```

**makeFixture pattern** (mirror de `test/skill-auto-commit.test.js:45-73` `makeIsolatedRepo`, simplificado para no necesitar git init):
```javascript
/**
 * Crea DOS tmpdirs (HOME aislado + fake repo kodo con skill canonical sembrada).
 * NO requiere git init (skill sync no toca git).
 */
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
  // Subdir + extra file para verificar walker recursivo (RESEARCH §Test Fixture).
  mkdirSync(join(skillDir, 'subdir'), { recursive: true });
  writeFileSync(join(skillDir, 'subdir', 'extra.md'), 'extra content\n', 'utf-8');

  return { tmpHome, tmpRepo };
}
```

**runCli helper** (mirror de `test/skill-auto-commit.test.js:87-99` `runStopHookChild` con env override):
```javascript
function runCli({ tmpHome, tmpRepo, args = [], cwd }) {
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'skill', 'sync', ...args],
    {
      cwd: cwd ?? tmpRepo,
      // NO_COLOR=1 deterministic stdout (RESEARCH §Risks; canon Phase 14).
      env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' },
      encoding: 'utf-8',
      timeout: 10000, // T-999.1.04-03 DoS mitigation
    },
  );
}
```

**afterEach cleanup pattern** (mirror de `test/skill-auto-commit.test.js:107-115`):
```javascript
let tmpHome;
let tmpRepo;
afterEach(() => {
  if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
  tmpHome = undefined;
  tmpRepo = undefined;
});
```

**4 escenarios SKILL-04 + symlink + source-hygiene** — cada uno con assert sobre `result.status` y `result.stderr` (mirror de `test/skill-auto-commit.test.js:117-156`):

Escenario 1 (ok first sync):
```javascript
it('SKILL-04 #1: ok (first sync) → exit 0, copia archivos canónicos', () => {
  ({ tmpHome, tmpRepo } = makeFixture());
  const result = runCli({ tmpHome, tmpRepo });
  assert.equal(result.status, 0, `stderr: ${result.stderr}`);
  assert.match(result.stdout, /Synced 2 files? to /);
  const destSkillMd = join(tmpHome, '.claude', 'skills', 'kodo-orchestrate', 'skill.md');
  assert.equal(readFileSync(destSkillMd, 'utf-8'), '# kodo:orchestrate\n\nCanonical body v1.\n');
});
```

Escenario 4 (not a kodo repo — bytes exactos del stderr):
```javascript
it('SKILL-04 #4: not a kodo repo → exit 2 + stderr canonical', () => {
  const emptyCwd = mkdtempSync(join(tmpdir(), 'kodo-not-a-repo-'));
  try {
    ({ tmpHome } = makeFixture()); // solo necesitamos tmpHome
    const result = runCli({ tmpHome, tmpRepo: emptyCwd, cwd: emptyCwd });
    assert.equal(result.status, 2);
    assert.equal(
      result.stderr,
      'Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n',
    );
  } finally {
    rmSync(emptyCwd, { recursive: true, force: true });
  }
});
```

**Symlink escenario** (CONTEXT §D-04 driver real verificado):
```javascript
it('D-04: legacy symlink → replaced with real dir', () => {
  ({ tmpHome, tmpRepo } = makeFixture());
  const destSkill = join(tmpHome, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(dirname(destSkill), { recursive: true });
  symlinkSync('/nonexistent/path/to/old/skill', destSkill);
  assert.equal(lstatSync(destSkill).isSymbolicLink(), true);

  const result = runCli({ tmpHome, tmpRepo });
  assert.equal(result.status, 0);
  assert.equal(lstatSync(destSkill).isSymbolicLink(), false);
  assert.equal(lstatSync(destSkill).isDirectory(), true);
});
```

**Source-hygiene pattern** (mirror exacto de `test/dispatcher-isolation.test.js:32-63` — grep importers tras stripComments):
```javascript
// Reusar stripComments verbatim de test/dispatcher-isolation.test.js:24-30.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

it('D-08b: syncSkill imported from exactly 2 callsites (CLI + orchestrator)', () => {
  const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
  const launchMod = readFileSync(join(REPO, 'src', 'orchestrator', 'launch.js'), 'utf-8');
  assert.match(stripComments(cliHandler), /from\s+['"]\.\.\/skill\/sync\.js['"]/);
  assert.match(stripComments(launchMod), /from\s+['"]\.\.\/skill\/sync\.js['"]/);
  // Cross-repo grep: solo 2 callsites importan syncSkill (excl. tests + el propio módulo).
  // Walker recursivo style de test/format-isolation.test.js:60-71.
});
```

---

### `test/orchestrator-auto-sync.test.js` (test in-process DI — CREATE)

**Analog principal:** `test/gsd-verify-integration.test.js:72-119` (memSink logger factory + makeDeps pattern, NO spawn).

**memSink logger pattern** (mirror exacto de `test/gsd-verify-integration.test.js:91-101`):
```javascript
function makeMemSink() {
  const records = [];
  const logger = {
    info: (msg, fields) => records.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => records.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => records.push({ level: 'error', msg, fields }),
    debug: (msg, fields) => records.push({ level: 'debug', msg, fields }),
    child: () => logger,
  };
  return { logger, records };
}
```

**3 escenarios** (RESEARCH §3 escenarios auto-sync):
- **A (drift detected → ok event)**: `syncSkill({ source, dest })` con dest vacío → `status: 'ok', files_changed > 0`; caller emite `skillSyncAuto`. memSink captura record con `fields.event === 'skill.sync.auto'`.
- **B (no drift → no event)**: segundo run con dest ya sync; `status: 'noop'`; caller NO emite event. memSink records sigue sin records de skill.sync.*.
- **C (sync error → error event)**: forzar error (chmod 000 dest, o source dir borrado mid-test). `result.status === 'error'`; caller emite `skillSyncAutoError`. memSink captura `fields.event === 'skill.sync.auto.error'`.

**No spawn — import directo**:
```javascript
import { syncSkill } from '../src/skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../src/logger-events.js';
```

**Cleanup pattern + chmod restore** (mirror de RESEARCH §Test 4 fs error):
```javascript
afterEach(() => {
  // Restaurar permisos ANTES de rmSync para evitar EACCES en cleanup.
  if (tmpHome) {
    try { chmodSync(join(tmpHome, '.claude', 'skills', 'kodo-orchestrate'), 0o755); } catch {}
    rmSync(tmpHome, { recursive: true, force: true });
  }
  if (tmpRepo) rmSync(tmpRepo, { recursive: true, force: true });
});
```

---

## Shared Patterns

### Pattern A — DI con defaults via OR
**Source:** `src/hooks/stop.js:99-108` + `src/cli/gsd-verify.js:58-64` + `src/gsd/verify.js:81-97`
**Apply to:** `src/skill/sync.js`, `src/cli/skill-sync.js`

```javascript
export async function fn(opts, deps = {}) {
  const dep1 = deps.dep1 || defaultDep1;
  const dep2 = deps.dep2 || ((arg) => defaultBehavior(arg));
  // ...
}
```

### Pattern B — Fail-open con event NDJSON + outer try/catch silencioso
**Source:** `src/hooks/stop.js:205-363` (worktree cleanup) + `src/hooks/stop.js:359-362` (outer catch)
**Apply to:** `src/orchestrator/launch.js` Phase 21 insertion block

Estructura:
1. Inner try/catch per-op con `event.error` emission (no throw).
2. Outer try/catch que captura cualquier throw inesperado y emite `console.error` (NO crash el caller).

### Pattern C — KODO_ROOT env override (test-isolation)
**Source:** `src/hooks/stop.js:20` + `test/skill-auto-commit.test.js:92-93`
**Apply to:** `src/orchestrator/launch.js` (`KODO_ROOT_FOR_SKILL = process.env.KODO_ROOT || process.cwd()`).

```javascript
const KODO_ROOT = process.env.KODO_ROOT || join(__dirname, '..', '..');
// Tests inyectan: env: { ...process.env, HOME: tmpHome, KODO_ROOT: tmpRepo }
```

### Pattern D — Exit codes + stderr canonical messages
**Source:** `src/cli/gsd-verify.js:71-75` (transient → 2; otros → 1) + `src/cli/gsd-inspect.js:74-91` (fetch fail → 2; config fail → 1)
**Apply to:** `src/cli/skill-sync.js` (D-07 4 estados: 0 ok/noop, 1 fs error, 2 no kodo repo).

```javascript
err(`Error: <category>: <detail>\n`);
return <0|1|2>;
```
Stderr siempre canonical, termina en `\n`, sin ANSI escapes.

### Pattern E — Color isolation (single-source picocolors)
**Source:** `src/cli/format.js` (único importer de picocolors) + `test/format-isolation.test.js:99-115` (grep-assert)
**Apply to:** `src/cli/skill-sync.js` debe importar `createFormatter` de `./format.js`, NUNCA picocolors directamente. El test `format-isolation.test.js` debe seguir pasando sin cambios después de Phase 21.

### Pattern F — Lazy dynamic imports en handlers
**Source:** `src/cli.js:251` (`const { runGsdInspect } = await import('./cli/gsd-inspect.js')`) + `src/hooks/stop.js:182, 198, 215-219` (lazy imports en runtime path)
**Apply to:** `src/cli.js` action de `kodo skill sync`. `src/orchestrator/launch.js` puede importar estáticamente (no es path crítico de startup como bin/kodo).

### Pattern G — Tmpdir + HOME override + spawnSync timeout
**Source:** `test/skill-auto-commit.test.js:45-99`
**Apply to:** `test/skill-sync.test.js`. Garantiza aislamiento del HOME real del developer; `NO_COLOR=1` añadido para bytes-deterministic stdout (canon Phase 14).

### Pattern H — Source-hygiene grep con stripComments
**Source:** `test/dispatcher-isolation.test.js:24-63` (Phase 16) + `test/format-isolation.test.js:99-128` (Phase 14)
**Apply to:** `test/skill-sync.test.js` (single-importer check de syncSkill) + invariante de que picocolors no leak en `src/cli/skill-sync.js`.

### Pattern I — Lazy createFormatter via factory closure
**Source:** `src/cli/gsd-verify.js:64`, `src/cli/gsd-inspect.js:56` (`const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();`)
**Apply to:** `src/cli/skill-sync.js`. La factory difiere la apertura de process.stdout hasta el momento del render.

---

## No Analog Found

(ninguno — todos los archivos tienen analog directo en el codebase)

---

## Metadata

**Analog search scope:**
- `/Users/alex/dev/klab/kodo/src/cli/` (3 archivos: format, gsd-inspect, gsd-verify)
- `/Users/alex/dev/klab/kodo/src/gsd/` (verify.js — orchestration con DI)
- `/Users/alex/dev/klab/kodo/src/hooks/` (stop.js — fail-open + event emission + KODO_ROOT)
- `/Users/alex/dev/klab/kodo/src/orchestrator/` (launch.js — insertion point para auto-sync)
- `/Users/alex/dev/klab/kodo/src/logger-events.js` (worktreeCleanupOk/Dirty/Error — Phase 19 helpers tipados)
- `/Users/alex/dev/klab/kodo/src/cli.js` (Commander subgrupos)
- `/Users/alex/dev/klab/kodo/test/` (4 archivos: skill-auto-commit, dispatcher-isolation, format-isolation, gsd-verify-integration, gsd-verify-cli-handler)

**Files scanned:** ~12 archivos productivos + ~6 archivos de test (no se exhaustó el árbol — early-stop tras 3 analogs strong por file).

**Pattern extraction date:** 2026-05-12

**Confidence:** HIGH — todos los excerpts incluyen file paths con line numbers verificados; los patterns A..I tienen al menos 2 callsites precedentes en el repo (single-source-of-pattern garantizado).
