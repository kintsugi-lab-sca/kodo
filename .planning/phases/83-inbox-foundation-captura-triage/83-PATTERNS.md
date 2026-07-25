# Phase 83: Inbox foundation — captura + triage - Pattern Map

**Mapped:** 2026-07-25
**Files analyzed:** 10 (5 nuevos de src/test + 2 modificados + 3 de test nuevos)
**Analogs found:** 10 / 10

Todos los ficheros de esta fase tienen analog exacto en el repo. Cero patrones que haya que
tomar de RESEARCH sin respaldo de código vivo.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/inbox/store.js` (nuevo) | service / lógica pura + I/O | file-I/O (append-only + RMW bajo lock) | `src/hooks/session-end.js:318-391` (RMW) + `src/logger.js:314-326` (append) + `src/skill/sync.js` (forma del módulo) | exact (compuesto) |
| `src/cli/capture.js` (nuevo) | controller (thin CLI handler) | request-response (argv → exit code) | `src/cli/skill-sync.js` | exact |
| `src/cli/inbox.js` (nuevo) | controller (thin CLI handler) | request-response + read/render | `src/cli/skill-sync.js` | exact |
| `src/cli.js` (modificado) | route registration | request-response | `src/cli.js:502-521` (`skill sync`), `:478-500` (`sidebar`) | exact |
| `test/inbox-store.test.js` (nuevo) | test (unit) | transform | `test/skill-sync.test.js` (+ DI de paths) | role-match |
| `test/inbox-format-golden.test.js` (nuevo) | test (golden) | transform | goldens de `format.js` / `skill-sync.test.js` | role-match |
| `test/inbox-cli.test.js` (nuevo) | test (integration CLI) | request-response | `test/version-smoke.test.js:1-35` (spawnSync bin/kodo) + `test/gsd-doctor-cli.test.js:265` (source-hygiene) | exact |
| `test/inbox-concurrency.test.js` (nuevo) | test (integration multi-proceso) | event-driven / race | `test/gsd-lock-race.test.js:1-70` | exact |
| `test/helpers/lock-race-child.mjs` (modificado: +2 `--kind`) | test harness | event-driven | el propio fichero (`--kind writer` / `--kind handoff`) | exact |
| README + `.claude/skills/kodo-orchestrate/` (doc del seam D-09) | docs | — | — | n/a |

**Nota de arbitraje (bloqueante, ya resuelta en CONTEXT):** D-04 del CONTEXT vigente ya está
corregido — el mecanismo es **unique-tmp + rename**, NUNCA `writeFileAtomic` (`src/config.js:135`).
La sección §CONFLICTO de RESEARCH describe una versión previa de D-04. El planner no tiene que
re-arbitrar: `.planning/STATE.md:100` y `83-CONTEXT.md` D-04 (corrección post-research) coinciden.

---

## Pattern Assignments

### `src/cli/capture.js` y `src/cli/inbox.js` (controller, request-response)

**Analog:** `src/cli/skill-sync.js` (leído completo, 132 líneas)

**Header pattern** (`skill-sync.js:1-19`) — cabecera de responsabilidades + declaración explícita
de la invariante de color isolation, luego imports en orden `node:*` → relativos:

```js
// @ts-check
//
// src/cli/skill-sync.js — Action handler de `kodo skill sync`.
//
// Responsabilidades (CONTEXT §D-06, D-07, D-08):
//   1. Gate: ¿cwd es un repo kodo? (exit 2 + stderr canonical D-07).
//   2. Invocar syncSkill (lógica vive en src/skill/sync.js — D-08 SoSoT).
//   3. Render: human (default) coloreado via createFormatter, o JSON (--json).
//   4. Exit codes: 0 (ok/noop) — 1 (fs error) — 2 (no kodo repo).
//
// Color isolation invariante (Phase 14 D-07): este archivo NUNCA importa el
// paquete de color directamente — solo createFormatter. Blindado por
// test/format-isolation.test.js y test/skill-sync.test.js (source-hygiene).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { syncSkill } from '../skill/sync.js';
import { createFormatter } from './format.js';
```

**DI typedef pattern** (`skill-sync.js:21-32`) — opts separado de deps; cada dep opcional y con
default resuelto en el cuerpo:

```js
/**
 * @typedef {{ prune?: boolean, json?: boolean }} RunSkillSyncCliOpts
 *
 * @typedef {{
 *   syncFn?: typeof syncSkill,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 *   cleanupFn?: () => Promise<void> | void,
 * }} RunSkillSyncCliDeps
 */
```

Para el inbox, el shape equivalente añade `inboxPath`/`lockPath` (Pitfall 5: el path por DI es lo
que permite testear sin tocar `HOME`) y `clockFn`/`idFn` (D-22 golden determinista).

**Defaults + return-code contract** (`skill-sync.js:47-60`) — nótese `@returns {Promise<number>}`
y el comentario D-07: el handler **retorna**, nunca hace `process.exit`:

```js
 * D-07 invariante: NUNCA invoca el helper de exit del runtime — retorna el
 * código. bin/kodo (caller) ejecuta el exit con el returnValue post-return.
 *
 * @param {RunSkillSyncCliOpts} opts
 * @param {RunSkillSyncCliDeps} [deps]
 * @returns {Promise<number>} exit code per D-07 (0 ok/noop, 1 fs error, 2 no kodo repo).
 */
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  // Lazy: createFormatter solo si entramos al render TTY (no se invoca para --json).
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
```

**Gate → error → render, con exit codes** (`skill-sync.js:65-98`) — molde literal para
`capture` (texto vacío tras saneo → 2) e `inbox route/discard` (not-found / already-closed → 2):

```js
  try {
    // Gate D-07 exit 2: stderr canonical message exacto.
    if (!existsSync(join(source, 'skill.md'))) {
      err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
      return 2;
    }

    /** @type {import('../skill/sync.js').SyncSkillResult} */
    let result;
    try {
      result = syncFn({ source, dest, prune: opts.prune === true });
    } catch (e) {
      err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
      return 1;
    }
    if (result.status === 'error') {
      err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
      return 1;
    }

    if (opts.json === true) {
      // D-06b: single-line JSON byte-deterministic (LOG-12 + DX-06 invariante).
      /** @type {Record<string, any>} */
      const payload = {
        status: result.status,
        files_changed: result.files_changed,
      };
      if (opts.prune === true) payload.files_pruned = result.files_pruned ?? 0;
      if (result.symlink_replaced === true) payload.symlink_replaced = true;
      write(JSON.stringify(payload) + '\n');
    } else {
      renderHuman(result, dest, write, fmt);
    }
    return 0;
```

Claves a copiar: (a) la rama `--json` se separa **antes** de tocar el formatter, para bytes
deterministas (DX-06); (b) `JSON.stringify(payload) + '\n'`, una sola línea; (c) las claves
opcionales se añaden condicionalmente, en orden fijo.

**Render human en función privada aparte** (`skill-sync.js:106-131`) — solo `fmt.*`, cero
picocolors; es donde el inbox aplicará además `stripControlChars` al texto y al `dest`
(Pitfall 6):

```js
/**
 * Render TTY (human-readable). NO se invoca para --json — D-06b separa branches
 * temprano para garantizar bytes deterministas.
 *
 * @private
 * @param {import('../skill/sync.js').SyncSkillResult} result
 * @param {string} dest
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(result, dest, write, fmt) {
  if (result.symlink_replaced === true) {
    write(`${fmt.yellow('⚠')} Legacy symlink replaced at ${dest}\n`);
  }
  if (result.status === 'noop') {
    write(`${fmt.ok('No drift')} — ${dest} up to date\n`);
  } else {
    const n = result.files_changed;
    write(`${fmt.ok(`Synced ${n} file${n === 1 ? '' : 's'} to ${dest}`)}\n`);
  }
```

---

### `src/inbox/store.js` — forma del módulo (service, lógica pura)

**Analog de forma:** `src/skill/sync.js:1-41`

```js
// @ts-check
//
// src/skill/sync.js — Phase 21 D-08: módulo único de sincronización canonical → home.
//
// Responsabilidades:
//   1. Detectar drift por hash SHA-256 archivo por archivo (D-02 — no mtime).
//   …
// Invariantes:
//   - syncSkill es función pura testeable: NO emite eventos; el caller los emite (D-08).

import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync,
  lstatSync, rmSync, unlinkSync, existsSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';

/**
 * @typedef {{ source: string, dest: string, prune?: boolean, … }} SyncSkillOpts
 * @typedef {{ status: 'ok' | 'noop' | 'error', files_changed: number, error?: string }} SyncSkillResult
 */
```

A copiar: bloque de Responsabilidades + Invariantes en la cabecera, `@typedef` de opts y de
result-shape declarados antes de la primera función, import agrupado de `node:fs`, y la disciplina
«el módulo no emite eventos ni hace `process.exit`; el caller decide».

---

### `src/inbox/store.js` — `markCapture` (file-I/O, RMW bajo lock)

**Analog:** `src/hooks/session-end.js:318-391` (fix WR-02 — el template canónico del repo)

**mkdir fuera de la sección crítica + path construido** (`session-end.js:318-325`):

```js
  // 2. Ruta CONSTRUIDA, jamás derivada del input — byte-idéntica a la del productor
  //    (session-start.js:94) y a la del consumidor (dashboard/plan.js:69).
  const planPath = join(plansDir, `${taskId}.md`);
  const lockPath = `${planPath}.lock`;

  // 3. El mkdir va FUERA de la sección crítica (no necesita el lock).
  fs.mkdirSync(plansDir, { recursive: true });
```

**El lock con logger inyectado + lectura FRESCA dentro** (`session-end.js:327-340`):

```js
  // 4. RMW bajo el lock advisory de D-08. Un tmp+rename por sí solo NO evita el *lost
  //    update* de un leer→appendear→escribir concurrente (T-74-04). El `logger` va en
  //    `opts` para que el `lock.timeout` salga por el logger inyectado y no por
  //    console.warn (`state-lock.js:218-223`).
  const r = withFileLock(
    lockPath,
    () => {
      let md;
      if (fs.existsSync(planPath)) {
        md = fs.readFileSync(planPath, 'utf-8');
      } else { … }
```

El comentario `logger en opts` es la respuesta directa a la Open Question 6 de RESEARCH (doble
warn en el fail-open de D-03): el precedente del repo es **inyectar** el logger, no dejar el
`console.warn` por defecto.

**unique-tmp + rename — el excerpt a clonar literalmente** (`session-end.js:368-381`):

```js
      // d. tmp+rename con nombre ÚNICO por escritor — patrón de `saveState:280` (fix
      //    WR-02). NO se usa `writeFileAtomic` de config.js: su tmp es de nombre FIJO
      //    (`path + '.tmp'`), exactamente lo que WR-02 corrigió, porque dos escritores
      //    concurrentes lo comparten y se pisan bytes parciales. Bajo el lock sería
      //    seguro, pero el lock es ROBABLE tras el TTL de 10 s (`state-lock.js:36`), así
      //    que la garantía no es absoluta (T-74-14). Y además acoplaría a config.js.
      const tmp = planPath + '.tmp.' + process.pid + '.' + randomUUID();
      try {
        fs.writeFileSync(tmp, out);
        fs.renameSync(tmp, planPath);
      } catch (err) {
        fs.rmSync(tmp, { force: true }); // sin residuo de tmp perdido
        throw err;
      }
```

**Manejo del lock-timeout en el call-site** (`session-end.js:393-395`) — el marcado NO hace
fail-open (A5), mismo shape que aquí:

```js
  // 5. Lock ocupado → warn y fuera. El lock-timeout JAMÁS bloquea el cierre (D-06).
  if (!r.ok) {
    log.warn('session.handoff.lock_timeout', { task_id: taskId, reason: r.reason });
```

---

### `src/inbox/store.js` — `appendCapture` (file-I/O, append-only)

**Analog del sink append:** `src/logger.js:313-326`

```js
  /** @param {object} record */
  function writeNdjson(record) {
    // NET-05: disk sink deshabilitado para ids hostiles — nunca tocamos el path.
    if (!diskSinkEnabled) return;
    try {
      appendFileSync(filePath, JSON.stringify(record) + '\n');
    } catch (err) {
      if (!writeFailedWarned) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n`);
        writeFailedWarned = true;
      }
    }
  }
```

A copiar: `appendFileSync(path, payload + '\n')` en una sola llamada (una línea = un write =
un `O_APPEND` atómico) y el warn a stderr con prefijo `[kodo:*]`.
**A NO copiar:** las constantes `ANSI_*` — retiradas del carril público; el inbox usa
`createFormatter` o texto plano en stderr.

**Analog del contrato del lock:** `src/session/state-lock.js:201-231`

```js
/**
 * On success returns `{ ok:true, value: fn() }` and releases in `finally`.
 * On acquire failure (retries exhausted) returns the fail-safe
 * `{ ok:false, reason:'lock-timeout' }` and emits a warn — never throws, never
 * blocks indefinitely (D-03).
 */
export function withFileLock(lockPath, fn, opts = {}) {
  const got = acquireLock(lockPath, opts);
  if (!got) {
    const warn = opts.logger?.warn;
    if (typeof warn === 'function') {
      warn('lock.timeout', { lockPath });
    } else {
      console.warn(`[kodo:lock] lock.timeout ${lockPath}`);
    }
    return { ok: false, reason: 'lock-timeout' };
  }
  try {
    return { ok: true, value: fn() };
  } finally {
    releaseLock(lockPath, got.token);
  }
}
```

Consecuencia directa para D-03: el fail-open se implementa comprobando `r.ok === false`; para
evitar el doble warn hay que pasar `{ logger: { warn: () => {} } }` (o un logger real).

---

### `src/inbox/store.js` — derivación del tag (D-15)

**Analog:** `src/cli/dashboard/select.js:407-447` — **reutilizar, no reimplementar**.
Firma real (Pitfall 3): devuelve `{ projectId } | { error: 'none' | 'ambiguous' }`.

```js
  if (matches.length === 0) return { error: 'none' };
  matches.sort((a, b) => b[1] - a[1]);
  if (matches.length > 1 && matches[0][1] === matches[1][1]) {
    return { error: 'ambiguous' };
  }
  return { projectId: matches[0][0] };
```

Forma robusta a usar en el call-site: `const tag = ('projectId' in r) ? r.projectId : basename(cwd)`.
Nota de estilo del analog (`select.js:381`): «puro, sin I/O — NO `realpathSync`, NO `path` module
→ color isolation». `src/inbox/store.js` **sí** puede usar `node:path`; el módulo puro que no debe
tocarse es `select.js`.

---

### Saneo — `src/cli/format.js:80-123`

**Carril de escritura** (CAPT-01, D-02, D-11) — `stripForKeystroke:114`:

```js
export function stripForKeystroke(s) {
  return stripControlChars(s)
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\\[rnt]/g, ' ');
}
```

**Carril de render** (Pitfall 6) — `stripControlChars:80`:

```js
export function stripControlChars(s) {
  return String(s)
    .replace(/\x1b\[[\d;]*[A-Za-z]/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}
```

Ambas coaccionan con `String(s)` y **no hacen trim** — de ahí el gate de texto vacío (Pitfall 8).

---

### `src/cli.js` — registro de comandos (route registration)

**Analog:** `src/cli.js:502-521` (`skill sync`) para el subcomando con opciones, y `:478-500`
(`sidebar`) para el grupo padre.

```js
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

Elementos obligatorios a replicar en `capture` e `inbox`:
1. Comentario `// --- kodo <cmd> <subcommand> ---` como separador.
2. **`await import()` lazy** del handler dentro del `.action()` (presupuesto de arranque).
3. Comentario `NOTE: NO ensureConfig()` con la justificación — precedente `:490-492` y `:512-513`.
4. Normalización de flags con `opts.x || false` antes de pasarlos al handler.
5. `process.exit(code)` en el `.action()` + `try/catch` con `console.error('Error: …')` → exit 1.

Diferencia de esta fase: `inbox` es un comando padre **con `.action()` propio** además de
subcomandos (`route`/`discard`) — forma verificada en RESEARCH sobre commander 13.1.0. No hay
precedente en `cli.js` (todos los grupos actuales son padres sin acción); es la única desviación
del molde y conviene comentarla en el código.

---

### `test/inbox-cli.test.js` (test, integration CLI)

**Analog:** `test/version-smoke.test.js:1-35`

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

    const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
      cwd: REPO,
      encoding: 'utf-8',
      timeout: 10_000, // WR-01 Phase 14 — fail-fast si el bin cuelga (CI hygiene)
    });
    assert.equal(result.status, 0, `… status ${result.status}\nstderr: ${result.stderr}`);
```

Añadidos que exige esta fase (Pitfall 5): `env: { ...process.env, HOME: sandbox }` en cada
`spawnSync`, y sandbox por test con `mkdtempSync`/`rmSync` (ver el analog de concurrencia).
El `timeout: 10_000` y el mensaje de assert que incluye stderr son parte del molde.

**Analog del source-hygiene assert:** `test/gsd-doctor-cli.test.js:265`

```js
    assert.ok(!/picocolors/.test(src), 'gsd-doctor.js must not import picocolors');
```

Mismo shape para el gate CAPT-04: leer `src/inbox/store.js` y los dos handlers y assertar que no
contienen `gsd-capture`, `spawn` ni `exec`.

---

### `test/inbox-concurrency.test.js` (test, multi-proceso)

**Analog:** `test/gsd-lock-race.test.js:1-70`

**Cabecera con la disciplina de aserción** (`:1-8`):

```js
// @ts-check
//
// test/gsd-lock-race.test.js — Phase 70 Plan 01, THE Criterion 1 headline.
//
// INTEGRATION: two (and five) real child processes race acquireGsdLock against
// the SAME repo with a shared `go` barrier. Exactly one must print `acquired` —
// the audit's literal success criterion for the atomic (flag:'wx') create path.
// Asserts on the AGGREGATE, never on which child wins. Sandbox per test.
```

**Sandbox por test + spawn con barrier** (`:20-60`):

```js
beforeEach(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'kodo-gsd-race-'));
  repoDir = join(sandbox, 'repo');
  writeFileSync(join(sandbox, '.keep'), '');
});

afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'gsd', '--repo', repoDir, '--barrier', goFile, '--hold', '500'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (d) => { outputs[i] += d.toString(); });
    children.push(child);
  }

  const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));
```

Para D-21 los children de `capture` van con `env: { ...process.env, HOME: sandbox }` (el analog
`gsd` no lo necesita porque recibe `--repo`; los kinds `writer`/`handoff` sí lo usan).

---

### `test/helpers/lock-race-child.mjs` (modificado — `--kind capture` y `--kind mark`)

**Analog:** el propio fichero, bloque `--kind handoff` (`:26-36` doc, `:113-120` código).

**Header de consumidores a actualizar** (`:1-12`):

```js
// Child harness for the real-process lock race tests (Phase 70 Plan 01,
// Criterion 1) and the state-writers concurrency test (Phase 70 Plan 02).
// Invoked by:
//   - test/state/state-lock-concurrency.test.js    (--kind state)
//   - test/gsd-lock-race.test.js                   (--kind gsd)
//   …
//   - test/state/handoff-concurrency.test.js       (--kind handoff)
```

**La regla crítica del import dinámico POST-HOME** (`:113-120`) — copiar el comentario, no solo
el código:

```js
  // Handoff mode (Phase 74 Plan 05, LIVE-04/D-08): dynamic-import session-end.js
  // AFTER HOME is set by the parent (env), then writeHandoff with EMPTY deps so the
  // real defaults resolve … The import MUST stay dynamic and
  // POST-HOME (RESEARCH §Pitfall 6): config.js:11 evaluates join(homedir(), '.kodo')
  // at module-load, so a static import would write to the operator's REAL ~/.kodo.
  // Never throws — any error collapses to `failed`.
  if (args.kind === 'handoff') {
    let written = false;
    try {
```

**Barrier + contrato de salida** (`:56-79`):

```js
/** Parse `--flag value` pairs from argv into a plain object. */
function parseArgs(argv) { … }

/** Busy-wait (bounded) until the barrier go-file appears. */
function waitForBarrier(goFile, timeoutMs = 5000) {
  if (!goFile) return;
  const deadline = Date.now() + timeoutMs;
  const sab = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(goFile) && Date.now() < deadline) {
    Atomics.wait(sab, 0, 0, 1);
  }
}
```

Contrato del kind nuevo, espejo de `writer` (`:105-110`): una sola acción, `try/catch` que colapsa
a `failed`, `process.stdout.write('written' | 'failed')`, `process.exit(0)`. Nunca lanza.

---

## Shared Patterns

### Color isolation (aplica a `src/inbox/store.js`, `src/cli/capture.js`, `src/cli/inbox.js`)
**Source:** `src/cli/skill-sync.js:11-13` + `src/cli/format.js:179`
**Enforcement automático:** `test/format-isolation.test.js` (walker transitivo sobre `src/`).

```js
// Color isolation invariante (Phase 14 D-07): este archivo NUNCA importa el
// paquete de color directamente — solo createFormatter. Blindado por
// test/format-isolation.test.js y test/skill-sync.test.js (source-hygiene).
import { createFormatter } from './format.js';
```

### Exit codes + no `process.exit` en el handler
**Source:** `src/cli/skill-sync.js:44-49`, `src/cli.js:516`
**Apply to:** ambos handlers CLI.
El handler retorna `0 | 1 | 2`; el `.action()` de `src/cli.js` hace `process.exit(code)`.

### `--json` byte-determinista (DX-06)
**Source:** `src/cli/skill-sync.js:85-94`
**Apply to:** `kodo inbox --json`.
Rama separada antes del formatter, `JSON.stringify(payload) + '\n'`, claves en orden fijo,
opcionales añadidas condicionalmente.

### Convenciones de fichero (`.planning/codebase/CONVENTIONS.md`)
**Apply to:** todos los ficheros nuevos de `src/`.
`// @ts-check` en la línea 1 · cabecera de Responsabilidades/Invariantes · JSDoc con
`@param`/`@returns` en todo export · `@typedef` para shapes · imports con extensión `.js` ·
orden `node:*` → externos → relativos · kebab-case · 2 espacios · prefijos de log `[kodo:*]` ·
sin barrel files.

### Never-throws en el carril de lectura
**Source:** `src/cli/dashboard/select.js:394-400` (comentario CR-01) + `src/logger.js:319-325`
**Apply to:** `listCaptures` (D-18) y todo el render de `kodo inbox`.
El precedente documenta *por qué*: `projects.json` / `inbox.md` son operator-editable, así que
cualquier shape es alcanzable y un throw rompe la superficie.

---

## No Analog Found

Ninguno. Los tres huecos que podrían parecerlo tienen precedente parcial suficiente:

| Elemento | Estado |
|----------|--------|
| Comando padre commander **con `.action()`** + subcomandos | Sin precedente en `src/cli.js` (los grupos actuales no tienen acción propia). Verificado empíricamente en RESEARCH sobre commander 13.1.0. Copiar el resto del molde de `:502-521` y comentar la desviación. |
| Codec/parser de línea markdown (`encodeLine`/`parseLine`) | Sin analog de codec en el repo. Usar la regex y la tabla de 15 vectores de RESEARCH §Code Examples; la forma del módulo la aporta `src/skill/sync.js`. |
| Golden test byte-exacto de una línea (D-22) | Sin fichero golden dedicado; el patrón (assert de string exacta con dependencias inyectadas) es estándar en la suite. |

---

## Metadata

**Analog search scope:** `src/cli/`, `src/inbox/` (inexistente), `src/session/`, `src/hooks/`,
`src/skill/`, `src/`, `test/`, `test/helpers/`
**Ficheros leídos para extracción:** `src/cli/skill-sync.js` (completo), `src/skill/sync.js:1-45`,
`src/hooks/session-end.js:318-395`, `src/session/state-lock.js:195-231`, `src/logger.js:300-331`,
`src/cli/dashboard/select.js:380-447`, `src/cli/format.js:75-209`, `src/cli.js:476-525`,
`test/gsd-lock-race.test.js:1-60`, `test/helpers/lock-race-child.mjs:1-120`,
`test/version-smoke.test.js:1-35`
**Pattern extraction date:** 2026-07-25
