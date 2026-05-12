# Phase 21: Skill Sync CLI + Auto-Sync — Research

**Researched:** 2026-05-12
**Domain:** Filesystem sync (canonical skill replication) + CLI subgroup + auto-sync hook
**Confidence:** HIGH (todo verificado contra código existente; Node `fs`/`crypto` APIs verificadas; sin nuevas deps)
**Language:** español (per `response_language: es`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** Scope solo `<repo>/.claude/skills/kodo-orchestrate/` → `~/.claude/skills/kodo-orchestrate/`. NO otras skills. `syncSkill` opera sobre par de paths fijo.
- **D-02** Diff signal = SHA-256 hash por archivo via `node:crypto.createHash('sha256')`. Sin nuevas deps.
- **D-03** Auto-sync en `launchOrchestrator` fail-open con evento NDJSON. Variantes: `skill.sync.auto` (ok), `skill.sync.auto.error` (fail). Sin `.noop` (evita ruido).
- **D-03b** Payload mínimo: `{ source, dest, files_changed?, error? }`.
- **D-04** Symlink legacy en `~/.claude/skills/kodo-orchestrate` detectado por `lstatSync(...).isSymbolicLink()` → `fs.rmSync(dest)` (borra solo el link) → `mkdirSync(dest, { recursive: true })` → copia archivos canónicos.
- **D-04b** Reemplazo idempotente: tras primer run, `lstat` devuelve dir normal y flujo hash-diff aplica.
- **D-04c** No `readlink` antes de borrar (target puede o no existir, irrelevante).
- **D-05** Sin `--prune`: archivos foráneos en home se PRESERVAN silentemente.
- **D-05b** Con `--prune`: foráneos se BORRAN con `console.warn` por cada uno antes de borrar.
- **D-05c** Auto-sync NUNCA hace prune.
- **D-06** Commander subgrupo `kodo skill sync [--prune] [--json]`. Patrón Phase 9 `kodo gsd <inspect|verify>`. Output dual TTY (prosa coloreada via `createFormatter`) / `--json` (bytes-deterministic).
- **D-07** Exit codes: `0` (ok/noop) — `1` (fs error, stderr: `Error: filesystem error: ${detail}`) — `2` (no kodo repo, stderr: `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)`).
- **D-07b** Auto-sync return value: `{ status: 'ok'|'noop'|'error', detail? }`. Sin exit code (no es CLI).
- **D-08** Módulo único `src/skill/sync.js` con `syncSkill(opts)` función pura testeable. CLI handler decide exit code + output. `launchOrchestrator` lo consume vía DI.
- **D-08b** Source-hygiene: un único `import` de `syncSkill` desde 2 callsites (CLI + orchestrator). Patrón `test/dispatcher-isolation.test.js`.
- **D-09** 2 helpers tipados en `src/logger-events.js`: `skillSyncAuto(log, fields)` y `skillSyncAutoError(log, fields)`. NO se añade `skill.sync.manual`.
- **D-10** Constraint cwd=repo (Phase 999.1 D-04..D-06) preservada. Sync es side-effect previo al launch; NO modifica cwd; orchestrator NO lee `~/.claude/skills/kodo-orchestrate/skill.md`.

### Claude's Discretion

- **Bytes exactos del stderr canonical** (dentro del contrato D-07: 4 estados, mensajes inequívocos).
- **Estructura interna de `syncSkill`** — file walker manual vs `fs.cp` con filter. Preferencia: walker manual.
- **Ubicación**: `src/skill/sync.js` vs `src/skill-sync.js` flat. Preferencia: dir `src/skill/`.
- **Test fixture strategy**: tmpdir + HOME override (Phase 16 CR-02 reusable).
- **Logger DI** en `syncSkill`: `opts.logger?` opcional, default no-op.

### Deferred Ideas (OUT OF SCOPE)

- Sync inverso `~/.claude/skills/` → `<repo>/.claude/skills/`.
- `kodo skill diff` / `kodo skill list`.
- Watch mode (`--watch`).
- Sync de otras skills genéricas en `<repo>/.claude/skills/`.
- Pre-execute script de bootstrap para symlink residual.
- `kodo skill sync --dry-run`.
- Hash cache (no recomputar si mtime+size no cambió).
- Enforcement: orchestrator REQUIERE sync exitoso para lanzar (descartado por D-03 fail-open).
- Migración del symlink via `kodo doctor`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **SKILL-01** | CLI `kodo skill sync` empuja repo → home (diff-aware, NO borra foráneos sin `--prune`). | §Module Structure (`syncSkill`) + §CLI Subcommand Wiring (handler decide exit + formato). |
| **SKILL-02** | `kodo orchestrate` detecta drift antes de lanzar, sincroniza y emite `skill.sync.auto`. | §Inserción en launchOrchestrator (línea 41-44 — antes de `cmux.listWorkspaces`). |
| **SKILL-03** | Auto-sync NO rompe Constraint cwd=repo (Phase 999.1 D-04/D-05/D-06). | §Inserción en launchOrchestrator (sync no toca cwd; orchestrator sigue lanzando con `cwd: process.cwd()` línea 72). |
| **SKILL-04** | Exit codes deterministas en `kodo skill sync`: `0 ok / 0 noop / 1 fs error / 2 not a kodo repo`. Stderr canonical. | §stderr Canonical Messages + §Test Fixture Strategy (4 escenarios spawnSync). |
</phase_requirements>

## Research Summary

Phase 21 implementa un módulo único de sincronización `src/skill/sync.js` con función pura `syncSkill(opts)` consumida por dos callsites: el handler CLI nuevo (`kodo skill sync`) y un hook fail-open en `launchOrchestrator` justo antes de `cmux.listWorkspaces()`. El módulo usa `node:crypto.createHash('sha256')` para comparar contenido archivo por archivo (no mtime, evita falsos positivos por `touch`/checkout/Dropbox), y maneja el caso concreto verificado del symlink legacy en `~/.claude/skills/kodo-orchestrate` (apunta a `/Users/alex/dev/klab/kodo/skills/kodo-orchestrate`, ruta pre-Phase 999.1 que ya no existe). `lstatSync` (no `statSync`) detecta el symlink sin seguirlo; `fs.rmSync(symlinkPath)` borra solo el link, no el target. La superficie CLI sigue el patrón Phase 9 `kodo gsd <subcmd>` con exit codes deterministas (0/1/2) y output dual TTY/JSON via `createFormatter`. Sin nuevas dependencias — todo Node stdlib + `picocolors` (ya presente, single-source via `src/cli/format.js`).

**Primary recommendation:** Walker manual (`readdirSync` recursivo) + hash SHA-256 por archivo + `cpSync` con `{ recursive: true }` para el reemplazo de symlink legacy + `writeFileSync` atómico para archivos individuales. Hook en `launchOrchestrator` línea 41 (antes del primer `cmux.listWorkspaces()`), no en línea 70 (`cmux.newWorkspace`) — razonado en §Inserción.

## Module Structure (`src/skill/sync.js`)

### API pública

```js
// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, mkdirSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * @typedef {{
 *   source: string,        // absolute path a <repo>/.claude/skills/kodo-orchestrate/
 *   dest: string,          // absolute path a ~/.claude/skills/kodo-orchestrate/
 *   prune?: boolean,       // default false (D-05)
 *   logger?: import('../logger.js').Logger,  // opcional, default no-op (Discretion)
 * }} SyncSkillOpts
 *
 * @typedef {{
 *   status: 'ok' | 'noop' | 'error',
 *   files_changed: number,
 *   files_pruned?: number,    // solo si prune=true
 *   symlink_replaced?: boolean,  // D-04 — informativo para CLI render
 *   error?: string,           // solo si status='error'
 * }} SyncSkillResult
 */

/**
 * @param {SyncSkillOpts} opts
 * @returns {SyncSkillResult}
 */
export function syncSkill(opts) { /* ... */ }
```

### Internals (walker manual recomendado)

Estructura interna del módulo, en orden de ejecución:

1. **Validar `source` existe** — `existsSync(join(source, 'skill.md'))`. Si NO → return `{ status: 'error', error: 'source skill not found' }`. (El CLI handler lo traduce a exit 2; el caller orchestrator lo trata como `error` y emite `skill.sync.auto.error`.)
2. **Detectar y reemplazar symlink legacy (D-04)** — `lstatSync(dest)` envuelto en try/catch (ENOENT → no symlink, prosigue). Si `isSymbolicLink()`:
   - `rmSync(dest, { force: true })` borra el link.
   - `mkdirSync(dest, { recursive: true })` crea dir vacío.
   - Marcar flag `symlinkReplaced = true` para informar al render.
3. **Asegurar dest existe** — `mkdirSync(dest, { recursive: true })` (idempotente si ya es dir).
4. **Walker recursivo del source** — función auxiliar `walkDir(rootAbs, currentAbs)` que retorna `string[]` de rutas relativas a `rootAbs`. Usa `readdirSync(currentAbs, { withFileTypes: true })`. Recursa en `Dirent.isDirectory()`. Devuelve solo archivos regulares.
5. **Hash + diff por archivo** — para cada `relPath` en source:
   - `srcHash = createHash('sha256').update(readFileSync(srcAbs)).digest('hex')`
   - Si dest del archivo no existe → marcar para copia.
   - Si dest existe → calcular `destHash` y comparar. Si difiere → marcar para copia.
6. **Copy fase** — por cada archivo marcado:
   - `mkdirSync(dirname(destAbs), { recursive: true })` (crea subdirs si la skill los gana).
   - `writeFileSync(destAbs, srcContent)` (no `copyFileSync` — ya leímos el contenido para hashear; reuso evita doble I/O).
   - Incrementar `filesChanged`.
7. **Prune fase (solo si `opts.prune === true`)** — walker recursivo del DEST, lista archivos. Para cada uno NO presente en source set:
   - `console.warn('[kodo skill sync --prune] removing foreign: ${relPath}')` (D-05b).
   - `rmSync(destAbs, { force: true })`.
   - Incrementar `filesPruned`.
8. **Return** — `{ status: filesChanged > 0 || symlinkReplaced ? 'ok' : 'noop', files_changed, files_pruned?, symlink_replaced? }`. Cualquier excepción interna se captura en un outer try/catch que devuelve `{ status: 'error', error: err.message, files_changed: <parcial> }` — el caller decide qué hacer.

### Por qué walker manual y no `fs.cp` con filter

- **Control fino sobre el diff**: necesitamos contar `files_changed` ANTES de copiar para devolver `'noop'` correctamente. `fs.cp` con `filter` permite filtrar QUÉ se copia pero no devuelve un conteo estructurado.
- **Hash determinista**: el filter de `fs.cp` recibe paths, no contenido. Tendríamos que llamar `readFileSync(srcAbs)` dentro del filter Y otra vez para copiar — doble I/O.
- **Prune list**: con walker manual construimos el `Set<string>` de paths esperados en una sola pasada, reutilizable para el diff Y el prune.
- **Tamaño del corpus**: ~5-10 archivos, ~50KB total (verificado: 1 archivo de 8.1KB hoy). Walker manual es ~30 LOC y completamente sync; performance irrelevante.
- **Atomicidad fileset-level**: para archivos individuales `writeFileSync` es atómico en macOS/Linux para escrituras pequeñas en el mismo filesystem. NO necesitamos write-temp+rename para 8KB (overkill); si el archivo aumenta dramáticamente, revisar (deferred).

### Por qué `cpSync` queda fuera

`fs.cpSync(source, dest, { recursive: true, force: true })` parece tentador pero:
- Tras reemplazar symlink, podríamos hacer un único `cpSync` masivo. Pero perderíamos el diff hash-aware → cada launch del orchestrator marcaría `files_changed: N` aunque nada cambió. Auto-sync emite evento ruidoso por launch.
- `cpSync` puede actualizar mtime de archivos sin cambio de contenido, deparando drift superficial percibido por el siguiente run.
- Mantener walker manual unifica los 3 escenarios: first-run-symlink, drift-detectado, no-op.

## Inserción en launchOrchestrator

### Línea recomendada: ANTES de `cmux.listWorkspaces()` (línea 44-45)

```js
// src/orchestrator/launch.js — actual línea 37-45
export async function launchOrchestrator(opts = {}) {
  const config = loadConfig();
  const log = opts.logger?.child({ component: 'orchestrator' });
  log?.info('orchestrator.launch.start', { provider: config.provider });

  // ─── PHASE 21 INSERTION POINT ───
  // ANTES de cualquier side-effect cmux: sync skill canonical fail-open.
  // Si falla: log warn + evento, continuar (D-03 fail-open).
  await syncSkillAuto(log);
  // ────────────────────────────────

  // Check if orchestrator is already running
  let workspaceList;
  try {
    workspaceList = await cmux.listWorkspaces();
```

Donde `syncSkillAuto(log)` (helper privado dentro de `launch.js`) envuelve:

```js
async function syncSkillAuto(log) {
  try {
    const { syncSkill } = await import('../skill/sync.js');
    const { skillSyncAuto, skillSyncAutoError } = await import('../logger-events.js');
    const source = join(KODO_ROOT, '.claude', 'skills', 'kodo-orchestrate');
    const dest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');
    const result = syncSkill({ source, dest });  // prune NEVER true here (D-05c)
    if (result.status === 'error') {
      if (log) skillSyncAutoError(log, { source, dest, error: result.error || 'unknown' });
    } else if (result.status === 'ok') {
      if (log) skillSyncAuto(log, { source, dest, files_changed: result.files_changed });
    }
    // 'noop' → silencio total (D-03b — sin .noop event para evitar ruido)
  } catch (err) {
    // Defensa profunda: si syncSkill throws inesperado, fail-open silencioso.
    console.error(`[kodo:orchestrator] skill sync failed: ${err.message}`);
  }
}
```

`KODO_ROOT` y `homedir()` van importados al top del archivo (homedir desde `node:os`; KODO_ROOT con el mismo patrón que `src/hooks/stop.js:20` — `process.env.KODO_ROOT || join(__dirname, '..', '..')` para test override).

### Análisis de side-effects: línea 44 vs línea 70

| Aspecto | Antes de `listWorkspaces()` (L44) | Antes de `newWorkspace()` (L70) |
|---------|-----------------------------------|--------------------------------|
| Idempotencia "orchestrator ya existe" | Sync corre SIEMPRE, incluso si el orchestrator existe y solo se manda nudge. | Sync corre SOLO si vamos a crear workspace nuevo. |
| Drift al volver a invocar `kodo orchestrate` | Detectado y resuelto en cada launch (deseado). | Drift NO se sincroniza si el orchestrator ya está corriendo — el operador podría haber editado la skill en el repo, hacer `kodo orchestrate` para "refrescar" y home seguiría stale. |
| Latency penalty | ~5ms (8KB hash + compare) en cada `kodo orchestrate`. Despreciable. | Solo en first-run o tras stop. |
| Fail-open invariance | Igual. | Igual. |
| Test surface | Más simple: una sola ruta a cubrir. | Bifurcada: test "ya existe" no ejercitaría sync. |

**Decisión recomendada**: L44 (antes de `listWorkspaces`). Razones:
1. SKILL-02 dice "antes de invocar Claude Code" — el `cmux.send` a un orchestrator existente ES una invocación.
2. `kodo orchestrate` se usa explícitamente para "refrescar" — el operador espera que home esté coherente.
3. Test surface más simple.
4. La penalty de ~5ms es ruido.

### Constraint cwd=repo preservada (SKILL-03 / D-10)

El bloque insertado NO toca `process.cwd()` ni modifica los args de `cmux.newWorkspace({ cwd: process.cwd() })` en L72. La skill canonical sigue siendo la del repo (Claude Code la auto-carga por cwd=repo). El sync solo asegura que home no quede stale para invocaciones futuras desde otro cwd. Verificable por test grep-assert: el archivo `src/orchestrator/launch.js` NO añade lectura de `~/.claude/skills/kodo-orchestrate/skill.md` en ningún path.

## CLI Subcommand Wiring (Commander)

Sigue el patrón Phase 9 `kodo gsd <inspect|verify>` verificado en `src/cli.js:241-274`. Subgrupo extensible (deferred: futuros `kodo skill diff` / `list`).

```js
// src/cli.js — añadir tras el bloque kodo gsd (L274)

// --- kodo skill <subcommand> ---
const skill = program.command('skill').description('Skill management subcommands (sync, etc.)');

skill
  .command('sync')
  .description('Sync canonical skill <repo>/.claude/skills/kodo-orchestrate/ → ~/.claude/skills/kodo-orchestrate/')
  .option('--prune', 'Remove foreign files in home that are not in repo (destructive; opt-in)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    try {
      const { runSkillSyncCli } = await import('./cli/skill-sync.js');
      const code = await runSkillSyncCli({ prune: opts.prune || false, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

El handler `src/cli/skill-sync.js` (siguiendo el molde de `src/cli/gsd-verify.js`):

```js
// src/cli/skill-sync.js
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { syncSkill } from '../skill/sync.js';
import { createFormatter } from './format.js';

const SKILL_REL = '.claude/skills/kodo-orchestrate';

/**
 * @param {{ prune: boolean, json: boolean }} opts
 * @param {{ writeFn?, errFn?, syncFn?, formatterFn?, cwdFn? }} [deps]
 * @returns {Promise<number>} 0|1|2 per D-07
 */
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  const source = join(cwd, SKILL_REL);
  const dest = join(homedir(), SKILL_REL);

  // 1. Gate: ¿estamos en un repo kodo? (D-07 exit 2)
  if (!existsSync(join(source, 'skill.md'))) {
    err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
    return 2;
  }

  // 2. Ejecutar sync
  let result;
  try {
    result = syncFn({ source, dest, prune: opts.prune });
  } catch (e) {
    err(`Error: filesystem error: ${e.message}\n`);
    return 1;
  }

  if (result.status === 'error') {
    err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
    return 1;
  }

  // 3. Render
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

function renderHuman(result, dest, write, fmt) {
  if (result.symlink_replaced) {
    write(`${fmt.yellow('⚠')} Legacy symlink replaced at ${dest}\n`);
  }
  if (result.status === 'noop') {
    write(`${fmt.ok('No drift')} — ${dest} up to date\n`);
  } else {
    const msg = `Synced ${result.files_changed} file${result.files_changed === 1 ? '' : 's'} to ${dest}`;
    write(`${fmt.ok(msg)}\n`);
  }
  if (result.files_pruned && result.files_pruned > 0) {
    write(`${fmt.yellow(`Pruned ${result.files_pruned} foreign file(s)`)}\n`);
  }
}
```

### Decisiones de wiring

- **Lazy import del handler**: `await import('./cli/skill-sync.js')` dentro del `.action()` mantiene el startup-budget de `bin/kodo` (LOG-12 spirit — handlers se cargan on-demand). Misma técnica que `kodo gsd inspect|verify`.
- **DI completa para tests**: `writeFn / errFn / syncFn / formatterFn / cwdFn` permite spawn-less unit tests. spawnSync integration tests cubren el wiring real.
- **`cwd` desde `process.cwd()`**: no leemos repo desde config — el operador puede tener múltiples checkouts del kodo repo y queremos sync para el cwd actual (consistente con CLI tools tipo `git`). Verificable: ejecutar `kodo skill sync` desde `~/dev/klab/kodo` → source = ese path; desde `/tmp` → exit 2.
- **`--json` bypass**: cuando `--json` está activo NO se enrutan los renderes coloreados; bytes deterministas (DX-06 invariante Phase 14).

## stderr Canonical Messages

D-07 define 4 estados; aquí los bytes exactos propuestos (sin trailing whitespace, terminados en `\n`):

| Estado | Exit | Stream | Bytes exactos (último `\n` incluido) |
|--------|------|--------|--------------------------------------|
| OK (sync ejecutó, archivos copiados) | `0` | stdout | TTY: `✓ Synced <N> file(s) to <abs-dest>\n` — JSON: `{"status":"ok","files_changed":N}\n` |
| No-op (sin drift) | `0` | stdout | TTY: `✓ No drift — <abs-dest> up to date\n` — JSON: `{"status":"noop","files_changed":0}\n` |
| Filesystem error (permisos, ENOSPC, ENOENT en archivo origen) | `1` | stderr | `Error: filesystem error: <detail>\n` — el `<detail>` es `err.message` raw del syscall (ej. `EACCES: permission denied, open '/Users/alex/.claude/skills/kodo-orchestrate/skill.md'`). |
| Not a kodo repo (cwd sin `.claude/skills/kodo-orchestrate/skill.md`) | `2` | stderr | `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n` |

### Bytes adicionales (advisory, NO canonical contract)

- Symlink legacy detectado y reemplazado (exit 0 normal): stdout TTY adicional como PRIMERA línea: `⚠ Legacy symlink replaced at <abs-dest>\n`. En JSON queda en `symlink_replaced: true` field opcional.
- `--prune` removiendo archivos: `console.warn` (stderr en el handler de Node) por cada uno: `[kodo skill sync --prune] removing foreign: <relpath>\n` (D-05b).

### Determinismo bytes (Phase 14 / 15 DX-06)

- `--json` ramifica TEMPRANO en `runSkillSyncCli`: NO entra al render coloreado — bytes idénticos en TTY vs no-TTY.
- El JSON usa `JSON.stringify` SIN `, null, 2` para mantener una sola línea (consistencia LOG-12 single-line NDJSON pattern). El handler de `kodo gsd verify` usa pretty-print (3 espacios) pero ese caso emite multi-line por diseño; aquí preferimos single-line para ergonomía pipe-friendly (`kodo skill sync --json | jq .files_changed`).
- Sin `picocolors` import directo en `cli/skill-sync.js` — consume solo `createFormatter` (color isolation invariante, blindado por `test/format-isolation.test.js`).

## Test Fixture Strategy

Patrón canónico verificado: `test/skill-auto-commit.test.js` (Phase 999.1 D-16) — `mkdtempSync` + `HOME` override + `KODO_ROOT` override + `spawnSync` con `timeout: 10000`.

### Setup compartido (`makeFixture()`)

```js
function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-repo-'));

  // Sembrar fake repo con skill canonical
  mkdirSync(join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate'), { recursive: true });
  writeFileSync(
    join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'skill.md'),
    '# kodo:orchestrate\n\nCanonical body v1.\n',
    'utf-8',
  );
  // Opcional: archivo adicional para verificar walker recursivo
  mkdirSync(join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'subdir'), { recursive: true });
  writeFileSync(
    join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate', 'subdir', 'extra.md'),
    'extra content\n',
    'utf-8',
  );

  return { tmpHome, tmpRepo };
}
```

### 4 escenarios SKILL-04 (spawnSync `bin/kodo skill sync`)

```js
function runCli({ tmpHome, tmpRepo, args = [], cwd }) {
  return spawnSync(
    process.execPath,
    [join(REPO, 'bin', 'kodo'), 'skill', 'sync', ...args],
    {
      cwd: cwd ?? tmpRepo,
      env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' /* deterministic stdout */ },
      encoding: 'utf-8',
      timeout: 10000,
    },
  );
}
```

| # | Escenario | Setup | Assert |
|---|-----------|-------|--------|
| 1 | **ok (first sync, dest no existe)** | `makeFixture()` — home `.claude/skills/` vacío | `status === 0`, stdout contiene `Synced 2 files`, dest contiene `skill.md` + `subdir/extra.md`, contenidos byte-idénticos al source. |
| 2 | **noop (segunda corrida sin drift)** | `makeFixture()` + primer `runCli()` exitoso, segundo `runCli()` | Segundo `status === 0`, stdout contiene `No drift`, mtime de dest INALTERADO entre runs (verifica que walker skipped copy). |
| 3 | **fs error (dest read-only)** | `makeFixture()` + `chmodSync(homeSkillDir, 0o500)` para impedir escritura | `status === 1`, stderr matches `/^Error: filesystem error: /`. **AfterEach**: restaurar permisos antes de rmSync. |
| 4 | **not a kodo repo (cwd sin skill.md)** | `mkdtempSync` para cwd vacío; sin `.claude/skills/kodo-orchestrate/skill.md` | `status === 2`, stderr exacto: `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n` |

### 3 escenarios auto-sync (in-process, no spawn)

Para `launchOrchestrator`, usar import directo + DI:

```js
import { syncSkill } from '../src/skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../src/logger-events.js';

// memSink logger pattern (Phase 16 LOG-15)
function makeMemSink() {
  const records = [];
  const log = {
    info: (msg, ctx) => records.push({ level: 'info', msg, ...(ctx || {}) }),
    warn: (msg, ctx) => records.push({ level: 'warn', msg, ...(ctx || {}) }),
    error: (msg, ctx) => records.push({ level: 'error', msg, ...(ctx || {}) }),
    debug: () => {},
    child: () => log,
  };
  return { log, records };
}
```

| # | Escenario | Assert |
|---|-----------|--------|
| A | **drift detectado → sync + evento `skill.sync.auto`** | `syncSkill({ source, dest })` returns `status: 'ok', files_changed: N>0`; tras llamar `skillSyncAuto(log, { source, dest, files_changed: N })` el memSink captura un record con `event: 'skill.sync.auto'`. |
| B | **no-drift → no event** | Segundo run con dest ya sync'd: `status: 'noop'`. Caller NO emite evento. memSink records vacío. |
| C | **sync error → warn + evento `skill.sync.auto.error`** | Forzar error: source dir borrado mid-test (o `chmod 000` dest). `result.status === 'error'`. Caller emite `skillSyncAutoError(log, { source, dest, error })`. memSink captura record `event: 'skill.sync.auto.error'`. |

### Escenario adicional: symlink legacy (D-04)

Reproducir el driver verificado:

```js
it('replaces legacy symlink with real dir on first sync', () => {
  const { tmpHome, tmpRepo } = makeFixture();
  const destSkill = join(tmpHome, '.claude', 'skills', 'kodo-orchestrate');
  const destParent = dirname(destSkill);
  mkdirSync(destParent, { recursive: true });
  // Apuntar el symlink a un path que NO existe (driver real)
  symlinkSync('/nonexistent/path/to/old/skill', destSkill);

  assert.equal(lstatSync(destSkill).isSymbolicLink(), true);

  const result = syncSkill({
    source: join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate'),
    dest: destSkill,
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.symlink_replaced, true);
  assert.equal(lstatSync(destSkill).isDirectory(), true);
  assert.equal(lstatSync(destSkill).isSymbolicLink(), false);
  assert.equal(readFileSync(join(destSkill, 'skill.md'), 'utf-8'), '# kodo:orchestrate\n\nCanonical body v1.\n');
});
```

### Test source-hygiene (D-08b)

Patrón `test/dispatcher-isolation.test.js`:

```js
it('syncSkill imported from exactly 2 callsites (CLI + orchestrator)', () => {
  const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
  const launchModule = readFileSync(join(REPO, 'src', 'orchestrator', 'launch.js'), 'utf-8');

  assert.match(cliHandler, /from ['"]\.\.\/skill\/sync\.js['"]/);
  assert.match(launchModule, /from ['"]\.\.\/skill\/sync\.js['"]/);

  // Grep cross-repo: solo esos 2 archivos importan syncSkill
  const allSrc = execSync('grep -rl "from.*skill/sync" src/', { cwd: REPO, encoding: 'utf-8' });
  const importers = allSrc.trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(importers, ['src/cli/skill-sync.js', 'src/orchestrator/launch.js']);
});
```

## Risks and Unknowns

### Verificados / mitigados

- **`fs.rmSync(symlinkPath, { force: true })` solo borra el link, no el target** — verificado contra Node docs (Node 25.9.0 instalado). `lstatSync` es la API correcta porque `statSync` SIGUE el symlink y haría parecer que el target tiene tipo. La operación es atómica: `unlink(2)` syscall en POSIX.
- **`writeFileSync` atomicidad para 8KB**: POSIX no garantiza atomicidad de escrituras grandes, pero para 8KB en mismo filesystem el riesgo es teórico. Si crashea mid-write, el siguiente run recomputa hash y reescribe — convergente. NO necesitamos write-to-temp+rename para este tamaño.
- **`homedir()` always-writable**: `~/.claude/skills/` puede no existir (operador nuevo). `mkdirSync(dest, { recursive: true })` lo crea idempotentemente. EACCES sobre `~/.claude/` es prácticamente imposible salvo configuración anómala.
- **CLAUDE.md global "responde en español"**: el render TTY del CLI YA usa frases en inglés cortas (`Synced N files to ...`, `No drift`) consistentes con Phase 15 `kodo gsd verify` que también mezcla EN/ES. Mantener inglés en los mensajes técnicos del CLI; el render coloreado y los warnings de prune pueden quedar en inglés por simetría con `kodo gsd verify` output. CLAUDE.md aplica a respuestas conversacionales del assistant, no a strings de programa.

### Risks identificados

1. **Race condition: dos `kodo orchestrate` simultáneos** — el lock Phase 8 GSD-10 es per-repo SOLO para `gsd-quick`/`full` sessions, NO para `kodo orchestrate` (que es un launcher humano). Dos invocaciones concurrentes podrían leer la skill canonical y escribirla en paralelo. **Mitigación**: el caso es teórico (operador ejecuta `kodo orchestrate` una vez); última escritura gana (todas escriben el mismo contenido); convergente. NO se introduce file lock — overkill (LOG-12 Karpathy Regla 2 simplicity).
2. **Symlink legacy con target inaccesible (EACCES, no ENOENT)** — verificado: el target actual `/Users/alex/dev/klab/kodo/skills/kodo-orchestrate` no existe (ENOENT). Pero hipotéticamente podría existir como dir sin permisos. `lstatSync` NO sigue el symlink → no toca el target → no afecta el flujo. `rmSync` del symlink path tampoco toca el target. **No es un risk real.**
3. **Concurrent writes durante `--prune` en home** — Si el operador edita archivos en `~/.claude/skills/kodo-orchestrate/` mientras corre `kodo skill sync --prune`, perderá su trabajo. **Mitigación**: D-05b ya mandata `console.warn` por cada borrado antes de borrar — el operador ve qué se pierde si tail-ea stderr. `--prune` es opt-in informado.
4. **CLAUDE.md "tests son `bin/rails test` directo, no piped to cat"** — aplica solo a Rails. Para kodo: `node --test test/**/*.test.js` (verificado en `package.json:scripts.test`). El plan debe usar este runner.
5. **`NO_COLOR=1` en spawnSync para tests deterministas** — sin esto, picocolors puede emitir ANSI en CI si stdout es TTY. Patrón ya usado en tests existentes; documentar.

### Unknowns (a clarificar en planning)

1. **¿`runSkillSyncCli` debe llamar `await ensureConfig()` como `kodo gsd inspect`?** — Recomendación: **NO**. `kodo skill sync` no necesita un provider configurado (es pure FS), solo necesita estar en un repo kodo. El gate D-07 (`exit 2`) sustituye a `ensureConfig`. Consistente con D-01 ("no requiere config").
2. **¿El bloque comentado de Phase 18 D-06 sobre `--worktree` en launch.js sigue siendo el offset correcto tras añadir `syncSkillAuto`?** — Sí: el comentario L84-101 está DESPUÉS de `cmux.newWorkspace` y se preserva intacto. La inserción Phase 21 va ANTES de listWorkspaces, no choca.
3. **¿`KODO_ROOT` env override aplica al orchestrator launch también?** — Sí, mismo patrón que `src/hooks/stop.js:20`. Permite tests aislados con tmpdir como root del repo.

## Validation Architecture

`workflow.nyquist_validation = true` en `.planning/config.json` → sección requerida.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 25.9.0 built-in) |
| Config file | none — runner inline en `package.json:scripts.test` |
| Quick run command | `node --test test/skill-sync.test.js` |
| Full suite command | `npm test` (alias `node --test test/**/*.test.js`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| SKILL-01 | `kodo skill sync` copia diff archivos, preserva foráneos | integration (spawnSync) | `node --test test/skill-sync.test.js` | ❌ Wave 0 — crear `test/skill-sync.test.js` |
| SKILL-01 | `--prune` borra foráneos con `console.warn` previo | integration (spawnSync) | `node --test test/skill-sync.test.js` (mismo file, escenario adicional) | ❌ Wave 0 |
| SKILL-02 | `launchOrchestrator` ejecuta sync antes de cmux + emite `skill.sync.auto` | unit (DI + memSink) | `node --test test/orchestrator-auto-sync.test.js` | ❌ Wave 0 — crear |
| SKILL-02 | Sync error → emite `skill.sync.auto.error`, launch continúa | unit (DI + memSink, force error) | mismo file | ❌ Wave 0 |
| SKILL-03 | Constraint cwd=repo preservada (orchestrator NO lee `~/.claude/skills/kodo-orchestrate/skill.md`) | source-hygiene grep | `node --test test/orchestrator-auto-sync.test.js` (grep block) | ❌ Wave 0 |
| SKILL-04 | Exit code `0` ok | integration | `test/skill-sync.test.js` scenario 1 | ❌ Wave 0 |
| SKILL-04 | Exit code `0` noop | integration | scenario 2 | ❌ Wave 0 |
| SKILL-04 | Exit code `1` fs error + stderr canonical | integration | scenario 3 | ❌ Wave 0 |
| SKILL-04 | Exit code `2` not a kodo repo + stderr canonical | integration | scenario 4 | ❌ Wave 0 |
| D-04 | Symlink legacy detectado y reemplazado por dir real | unit (in-process) | `test/skill-sync-symlink.test.js` o escenario en `test/skill-sync.test.js` | ❌ Wave 0 |
| D-08b | `syncSkill` importado desde exactamente 2 callsites | source-hygiene grep | escenario en `test/skill-sync.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit**: `node --test test/skill-sync.test.js test/orchestrator-auto-sync.test.js`
- **Per wave merge**: `npm test` (full suite, esperado 567+ tests pass)
- **Phase gate**: `npm test` green antes de `/gsd-verify-work`. Plus regresión visual: `test/format-isolation.test.js` debe seguir pasando (single-source-of-color invariante — el nuevo `src/cli/skill-sync.js` consume solo `createFormatter`).

### Wave 0 Gaps

- [ ] `test/skill-sync.test.js` — 4 escenarios SKILL-04 (spawnSync) + symlink + source-hygiene grep.
- [ ] `test/orchestrator-auto-sync.test.js` — 3 escenarios auto-sync (in-process DI + memSink).
- [ ] Framework install: ninguno (Node built-in).
- [ ] Helper shared `makeFixture()`: inline en `test/skill-sync.test.js` (no extraer a helper hasta el segundo test file lo reuse — YAGNI).

## RESEARCH COMPLETE

**Phase:** 21 — Skill Sync CLI + Auto-Sync
**Confidence:** HIGH

### Key Findings

- Walker manual + SHA-256 + `cpSync` descartado: walker da control fino sobre diff/prune con 0 nuevas deps; `cpSync` actualizaría mtime y rompería el `'noop'` determinista.
- Inserción en `launchOrchestrator` línea 44 (antes de `cmux.listWorkspaces`) — NO línea 70 (`cmux.newWorkspace`): cubre el path "orchestrator ya existe" donde el operador espera "refresh".
- `lstatSync` + `rmSync(symlinkPath, { force: true })` borra solo el link, no el target — driver verificado (`~/.claude/skills/kodo-orchestrate` → `/Users/alex/dev/klab/kodo/skills/kodo-orchestrate`, ENOENT).
- Patrón Phase 9 `kodo gsd <inspect|verify>` 100% análogo para `kodo skill sync` con subgrupo Commander + handler en `src/cli/skill-sync.js` + DI completa (writeFn/errFn/syncFn/formatterFn).
- Test fixture canonical Phase 999.1 (`test/skill-auto-commit.test.js`) reusable: `mkdtempSync` + `HOME` override + `NO_COLOR=1` + `timeout: 10000`. 4 escenarios SKILL-04 + 3 auto-sync + 1 symlink + 1 source-hygiene grep.

### File Created
`/Users/alex/dev/klab/kodo/.planning/phases/21-skill-sync-cli-auto-sync/21-RESEARCH.md`

### Confidence Assessment

| Area | Level | Reason |
|------|-------|--------|
| Module structure (`syncSkill` API + internals) | HIGH | Node `fs`/`crypto` APIs verificadas; walker pattern estándar; sin deps nuevas. |
| Inserción en `launchOrchestrator` | HIGH | Código actual leído línea por línea; offset L44 confirmado; rationale L70 descartado documentado. |
| CLI subgroup wiring | HIGH | Patrón Phase 9 `kodo gsd` 100% análogo; `src/cli.js:241-274` leído. |
| stderr canonical messages | HIGH | Bytes propuestos dentro del contrato D-07; consistencia Phase 10 Pitfall #6 Opción A. |
| Test fixture strategy | HIGH | Patrón Phase 999.1 `test/skill-auto-commit.test.js` reusable verbatim. |
| Symlink replacement (D-04) | HIGH | Driver real verificado vía readlink; APIs Node confirmadas. |
| Auto-sync event taxonomy | HIGH | Patrón Phase 19 `worktreeCleanupOk/Dirty/Error` análogo. |

### Open Questions (para planning)

1. ¿`runSkillSyncCli` necesita `ensureConfig()`? Recomendado: **NO**. El gate D-07 exit 2 lo sustituye.
2. ¿`KODO_ROOT` env override en `launchOrchestrator` para test isolation? Recomendado: **SÍ**, mismo patrón `src/hooks/stop.js:20`.
3. ¿Mensajes TTY en inglés o español? Recomendado: **inglés** (consistencia con `kodo gsd verify`); CLAUDE.md aplica a conversaciones, no a strings de programa.

### Ready for Planning

Research completo. Planner puede crear PLAN.md files para Phase 21 con:
- 1 plan que crea `src/skill/sync.js` + `src/cli/skill-sync.js` + wiring en `src/cli.js`
- 1 plan que cabela hook en `src/orchestrator/launch.js` + 2 helpers en `src/logger-events.js`
- 1 plan de tests (puede ir en paralelo, Wave 1)

O bundle de 2 plans si granularity coarse (consistente con `.planning/config.json:granularity: coarse`).
