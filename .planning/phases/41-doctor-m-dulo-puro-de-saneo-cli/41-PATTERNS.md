# Phase 41: Doctor — módulo puro de saneo + CLI - Pattern Map

**Mapped:** 2026-06-04
**Files analyzed:** 5 (1 new module, 1 new CLI handler, 1 new test, 2 modified, +1 optional shared helper)
**Analogs found:** 5 / 5 (every target file has a concrete in-repo analog)

> Toda interacción con el código fue de solo lectura. El único archivo escrito es este PATTERNS.md.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/gsd/doctor.js` (NEW) | service (puro + DI + never-throws) | batch / file-I/O (sweep + sanea) | `src/session/reconcile.js` (`reconcileTick` puro / `runReconcileTick` I/O) | exact (espejo arquitectónico) |
| `src/cli/gsd-doctor.js` (NEW handler) | controller (CLI action) | request-response | `src/cli/gsd-inspect.js` | exact (mismo molde handler + `--json` + exit code + `writeFn`/`errFn` DI) |
| `src/cli.js` (MODIFIED — `gsd.command('doctor')`) | route/config | request-response | `src/cli.js:315-345` (`gsd inspect`/`gsd verify`) | exact (lazy-import + `process.exit`) |
| `src/logger-events.js` (MODIFIED — `doctor.*`) | utility (event registry) | event-driven | `worktreeCleanupOk/Dirty/Error` (`:305-351`) + `EVENTS` (`:52-77`) | exact |
| `test/gsd-doctor.test.js` (NEW) | test | n/a | `test/stop-worktree-cleanup.test.js` + `test/server-reconcile-logger.test.js` | exact (DI hermético: memLogger, gitFn stub, HOME-isolated, sin spawn) |
| `src/hooks/worktree-cleanup.js` (OPTIONAL shared helper) | utility | file-I/O / transform | `src/hooks/stop.js:251-402` (bloque a factorizar) | source (extracción del bloque existente) |

---

## Pattern Assignments

### `src/gsd/doctor.js` (service, puro + DI + never-throws) — DOCTOR-04 / D-04 / D-10

**Analog:** `src/session/reconcile.js` — el espejo arquitectónico exacto. Copiar el split puro/I-O, NO inventar otro shape.

**Mapeo conceptual:**
- `reconcileTick` (puro, no I/O, no throw) → **`scan(deps)`** (detección pura → reporte estructurado).
- `runReconcileTick` (I/O con DI: `loadState`/`saveState`/`now`/`logger`/`pgrep`) → **`execute(deps, opts)`** (sanea con re-check liveness por acción).

**Header / contrato puro+DI** (`reconcile.js:1-27`) — replicar la doc-banner declarando: PURA + never-throws, NO importa `logger.js` (se inyecta vía `deps`), el único import nativo permitido es para liveness (`execFileSync`/`process.kill`):
```javascript
// PURA + never-throws (D-07): no abre sockets, no escribe disco, no lanza. El
// caller [...] consulta el host, invoca reconcileTick, y persiste [...]. El logger
// se inyecta vía opts (LOG-12: este módulo NO importa logger.js).
```

**Firma DI del runner I/O** (`reconcile.js:254`) — molde literal para `execute()` deps (D-04, Discretion línea 56). Inyectar `loadState`/`removeSession`/`now`/`logger` + `gitFn` + funciones de liveness:
```javascript
export async function runReconcileTick({ host, loadState, saveState, debounceStore, tick, now, logger, pgrep }) {
```
Para `execute(deps, { taskId, fix })`: `deps = { loadState, removeSession, gitFn, isPidAlive, readLock, now, logger, listLogFiles? }`. Default a las funciones reales (`./session/state.js`, `./gsd/lock.js`) cuando no se inyectan — igual que `gsd-inspect.js:58-65` resuelve defaults lazy.

**Return tipado distinto scan vs execute** (`reconcile.js:181-184`) — `scan()` retorna reporte estructurado, `execute()` retorna resultado-de-saneo (NO el mismo tipo, D-04):
```javascript
return {
  state: { ...state, sessions, history },
  events: { rescued, sealed, transitioned, total },
};
```

**Liveness fail-safe-a-muerto** (`reconcile.js:226-236`) — `execute()` re-chequea ANTES de cada acción destructiva (D-06/D-14). Mismo patrón conservador: error/sin-match ⇒ tratar como muerto:
```javascript
export function isSessionProcessAlive(sessionId, pgrep) {
  const run = pgrep || ((sid) => execFileSync('pgrep', ['-f', `session-id ${sid}`], { encoding: 'utf-8', timeout: 3000 }));
  try { const out = run(sessionId); return String(out || '').trim().length > 0; }
  catch { return false; } // pgrep exit 1 (sin match) → conservador: muerto.
}
```
Reusar `isPidAlive` de `lock.js:67` (ESRCH=muerto) para el PID del lock; cross-check contra `alive` de `state.json`.

**Skip / no-op cuando no hay cambios** (`reconcile.js:74-77`, `177-179`) — doctor never-throws: un fallo de detección emite warn y devuelve reporte vacío; un sweep sin basura retorna limpio.

---

#### Detección de las 4 categorías — helpers internos compartidos por `scan()` y `execute()` (D-06: DRY sin acoplar snapshot)

**1. Worktrees huérfanos** — `computeWorktreePath` (`state.js:153-155`):
```javascript
export function computeWorktreePath(projectPath, sessionId) {
  return join(projectPath, '.bg-shell', sessionId);
}
```
Acotar SÓLO a `.bg-shell/<sessionId>` cross-checado contra `state.json` (Specifics línea 117: NO tocar worktrees de `.claude/worktrees/` ni orca). `listSessions` (`state.js:287-289`) da las entradas vivas para el cross-check.

**2. Sesiones zombie** — entradas en `state.json` con `alive===false`. Usar `loadState` (`state.js:208`) para leer y `removeSession` (`state.js:242-256`) para quitarlas. **doctor NO escribe `alive`** — sólo `removeSession` (invariante: `reconcileTick` es el único escritor de `alive`). `removeSession` ya hace unshift a history (cap 50) — comportamiento correcto a reusar tal cual.

**3. Locks colgados** — máquina de estados de `acquireGsdLock` (`lock.js:103-139`, D-13). Reusar `readLock` (`lock.js:86`) + `isPidAlive` (`lock.js:67`) + constantes `LOCK_FILE`/`DEFAULT_TTL_HOURS` (`lock.js:51-52`). NO reimplementar la decisión steal/keep:
```javascript
// Case 2: holder PID is dead — steal silently.
if (!isPidAlive(existing.pid)) { return stealLock(...); }
// Case 3: PID alive but TTL expired — steal + warn.
const ttlMs = (existing.ttl_hours || DEFAULT_TTL_HOURS) * 3600_000;
if (Number.isFinite(acquiredAt) && Date.now() - acquiredAt > ttlMs) { ...steal }
// Case 4: PID alive, TTL OK — reject (doctor: KEEP, nunca borrar).
```

**4. Logs NDJSON antiguos** — patrón + constante de `sweepRetention` (`polling-logfile.js:115-143`, D-12). Reusar `DEFAULT_RETENTION_DAYS=7` (`:49`) y `MS_PER_DAY` (`:52`) — NO duplicar el `7`. Path: `~/.kodo/logs/<sessionId>.ndjson` (`logger.js:248-250`). Filtro estricto por sufijo + mtime + fail-open por archivo:
```javascript
const cutoffMs = nowMs - retentionDays * MS_PER_DAY;
for (const name of entries) {
  if (!name.endsWith('.ndjson')) continue;          // doctor: .ndjson (no polling-*.log)
  try { const st = statSync(full); if (st.mtimeMs < cutoffMs) unlinkSync(full); }
  catch { /* fail-open per archivo */ }
}
```
Reglas doctor (D-12): sólo `.ndjson` de sesión NO viva, **unlink entero nunca truncar** (no romper followers POSIX), nunca el log de una sesión viva. Los `polling-*.log` ya los barre el daemon — discreción del planner si `execute()` global invoca `sweepRetention()` o los deja al daemon.

---

### `src/cli/gsd-doctor.js` (controller, request-response) — DOCTOR-01/03 / D-01

**Analog:** `src/cli/gsd-inspect.js` — molde exacto del handler: `--json` byte-determinista, `writeFn`/`errFn` inyectables, exit code como return value.

**Firma + DI de salida** (`gsd-inspect.js:53-56`):
```javascript
export async function runGsdInspect(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
```
Para doctor: `runGsdDoctor({ fix, json }, deps)` inyecta `scanFn`/`executeFn` (de `doctor.js`) + `writeFn`/`errFn`. **Doctor probablemente NO requiere `ensureConfig`** (sanea filesystem local, no toca provider) — confirmar en plan (CONTEXT línea 104).

**Exit code calculado antes de render** (`gsd-inspect.js:103-105`) — D-03: `0=limpio / 1=problemas encontrados`. Los recursos VIVOS protegidos (D-09) NO cuentan para el exit code:
```javascript
const exitCode = verdict.action === 'error' ? 1 : 0;
```

**Branch `--json` vs human** (`gsd-inspect.js:107-118`) — JSON preserva shape serializable (consumible por Phase 42); human-readable agrupa por categoría con `✓`/`✗` vía `createFormatter`. El reporte de `scan()` ES el objeto serializado a `--json` (D-01).

**Dry-run preview por ítem** (D-08) — el render human debe mostrar la acción EXACTA por ítem (worktree `remove` vs `prune` vs `move-a-.dirty`; lock `steal` vs `keep`; log `unlink`), no sólo conteos. Equivale al `matchLine` detallado de `gsd-inspect.js:159-168`.

---

### `src/cli.js` modification (`gsd.command('doctor')`) — D-01

**Analog:** `src/cli.js:315-345` (`gsd inspect` / `gsd verify`). Añadir junto a ellos bajo el `const gsd` ya existente (`:313`).

**Patrón de registro** (`cli.js:331-345`) — lazy-import del handler + `process.exit(code)` + catch top-level:
```javascript
gsd
  .command('verify <session-id>')
  .description('...')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(async (sessionId, opts) => {
    try {
      await ensureConfig();
      const { runGsdVerifyCli } = await import('./cli/gsd-verify.js');
      const code = await runGsdVerifyCli({ sessionId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```
Para doctor: `.command('doctor')`, opciones `--fix` y `--json` (D-02: SIN flags por-categoría). Si doctor NO necesita provider, **omitir `ensureConfig()`** (precedente: `skill sync` en `cli.js:357` y `polling start` en `:383` lo omiten con comentario justificativo).

---

### `src/logger-events.js` modification (eventos `doctor.*`) — Discretion línea 59

**Analog:** `worktreeCleanupOk/Dirty/Error` (`:305-351`) + registro `EVENTS` (`:52-77`).

**Entradas en `EVENTS`** (`:61-63`) — añadir junto a las `WORKTREE_CLEANUP_*`:
```javascript
WORKTREE_CLEANUP_OK:     'worktree.cleanup.ok',
WORKTREE_CLEANUP_DIRTY:  'worktree.cleanup.dirty',
WORKTREE_CLEANUP_ERROR:  'worktree.cleanup.error',
```
Nuevos: `DOCTOR_SCAN: 'doctor.scan'`, `DOCTOR_FIX_WORKTREE: 'doctor.fix.worktree'`, `DOCTOR_FIX_LOCK: 'doctor.fix.lock'`, `DOCTOR_FIX_LOG: 'doctor.fix.log'`, `DOCTOR_FIX_ERROR: 'doctor.fix.error'` (nombres exactos = discreción del planner).

**Helper por nivel** (`:305-351`) — molde literal (info=ok, warn=dirty/skip, error=fallo), token=0 (no model call):
```javascript
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
`doctor.fix.error` debe llevar un campo `category: 'worktree'|'lock'|'log'|'zombie'` y `reason` (paralelo a `phase` de cleanup).

---

### `test/gsd-doctor.test.js` (NEW test)

**Analogs:** `test/stop-worktree-cleanup.test.js` (gitFn stub, HOME-isolated, memLogger) + `test/server-reconcile-logger.test.js` (DI hermético sin timers/spawn).

**memLogger en memoria** (`stop-worktree-cleanup.test.js:36-46`) — captura eventos sin tocar disco:
```javascript
function makeMemLogger() {
  const events = [];
  const logger = {
    info: (msg, fields) => events.push({ level: 'info', msg, fields }),
    warn: (msg, fields) => events.push({ level: 'warn', msg, fields }),
    error: (msg, fields) => events.push({ level: 'error', msg, fields }),
    debug: () => {}, child: () => logger,
  };
  return { logger, events };
}
```

**HOME-isolated + import dinámico** (`stop-worktree-cleanup.test.js:22-33`) — OBLIGATORIO: importar `doctor.js` SÓLO tras aislar `HOME` a un tmpdir (evita fijar `KODO_DIR` al `~/.kodo` real y corromper el state del usuario — bug cazado en UAT Phase 38):
```javascript
before(async () => {
  _origHome = process.env.HOME;
  _tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-doctor-'));
  process.env.HOME = _tmpHome;
  mkdirSync(join(_tmpHome, '.kodo'), { recursive: true });
  ({ scan, execute } = await import('../src/gsd/doctor.js'));
});
```

**DI hermético, sin spawn real** (`server-reconcile-logger.test.js:47-55`) — inyectar `now`, `loadState`/`saveState`, `gitFn`, `isPidAlive` como stubs; verificar `doesNotThrow` (never-throws) + que NUNCA se toca un recurso vivo:
```javascript
stop = startReconcileLoop({
  host: { listWorkspaces: async () => [] },
  loadState: () => ({ schema_version: 3, sessions: {}, history: [] }),
  saveState: () => {},
  logger,
  setInterval: () => { intervalSet = true; return 1; },
});
```
Tests clave a cubrir: (1) `scan()` puro no muta state ni hace I/O destructivo; (2) `execute()` re-chequea liveness y NUNCA borra worktree/lock de PID vivo (D-14); (3) fail-open por ítem (un fallo no detiene el sweep); (4) `execute({taskId})` acota a worktree+lock+entrada de ESA sesión (D-05), logs FUERA.

---

### `src/hooks/worktree-cleanup.js` (OPTIONAL shared helper) — D-11

**Analog/Source:** `src/hooks/stop.js:251-402` — el bloque completo branch→status→remove|move→prune a factorizar.

**Recomendación:** extraer el bloque a un helper compartido consumido por `stop.js` Y `doctor.js` (una sola fuente de saneo, CONTEXT línea 97/109). Refactor quirúrgico: `stop.js` pasa a consumirlo manteniendo su comportamiento fail-open VERBATIM. Si el planner prefiere no refactorizar `stop.js` en esta fase, doctor puede replicar el patrón — pero el ideal LOCKED (D-11) es factorizar.

**Secuencia a preservar literalmente** (`stop.js:272-397`):
1. **Branch read ANTES de remove** (`:276-282`, Pitfall #2) — `git -C <wt> branch --show-current`, fail-open silent.
2. **Status / dirty check** (`:286-298`) — `git -C <wt> status --porcelain`; fallo ⇒ `cleanup.error{phase:status}` + skip remove/move (aún corre prune).
3. **CLEAN path** (`:300-332`) — `git worktree remove <wt>` SIN `--force`; luego `branch -D` (fail-open, Pitfall #3).
4. **DIRTY path** (`:333-383`) — move-aside a `<wt>.dirty` (colisión ⇒ `<wt>.dirty-${Date.now()}` vía `lstatSync` en try/catch, Pitfall #1); fallback `renameSync` + `git worktree repair`. **NUNCA borrar dirty.**
5. **Prune oportunista** (`:387-397`) — `git worktree prune`, fail-open con `cleanup.error{phase:prune}`.

```javascript
// 1. Read branch name BEFORE remove (Pitfall #2 / D-08). Fail-open silent.
const out = await gitFn(project, ['-C', wt, 'branch', '--show-current']);
branchName = (out || '').trim() || null;
// ...
await gitFn(project, ['worktree', 'remove', wt]);   // SIN --force
// dirty:
await gitFn(project, ['worktree', 'move', wt, target]);  // target = `${wt}.dirty`
// fallback: renameSync(wt, target); await gitFn(project, ['worktree', 'repair', target]);
// final:
await gitFn(project, ['worktree', 'prune']);
```
**Distinción D-11 que doctor añade** (no presente en stop.js, que siempre tiene `worktree_path`): worktree registrado-sin-dir ⇒ `remove`; metadata stale ⇒ `prune`. **Nunca `rm -rf`.**

---

## Shared Patterns

### Never-throws / fail-open por ítem
**Source:** `src/cli/polling-logfile.js:130-142` (`sweepRetention`) + `src/hooks/stop.js:398-401` (outer catch defensivo) + `src/session/reconcile.js:177-179`.
**Apply to:** `src/gsd/doctor.js` (todas las acciones de `execute()`), el helper de worktree-cleanup.
```javascript
try { const st = statSync(full); if (st.mtimeMs < cutoffMs) unlinkSync(full); }
catch { /* Fail-open per archivo: el siguiente del loop continúa. */ }
```

### Liveness fail-safe-a-muerto (re-check por acción, D-06/D-14)
**Source:** `src/gsd/lock.js:67-74` (`isPidAlive`, ESRCH) + `src/session/reconcile.js:226-236` (`isSessionProcessAlive`, pgrep).
**Apply to:** `execute()` ANTES de cada acción destructiva; nunca sanea worktree/lock de `alive===true` o PID vivo.
```javascript
export function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code !== 'ESRCH'; } // sólo ESRCH ⇒ muerto; EPERM ⇒ conservador vivo.
}
```

### Logger inyectado (NO importar logger.js en el módulo puro)
**Source:** `src/session/reconcile.js:14` (LOG-12) — el logger se pasa vía `deps`/`opts`, el módulo nunca lo importa.
**Apply to:** `src/gsd/doctor.js`. Los helpers de evento (`logger-events.js`) reciben el `logger` ya construido como primer argumento.

### Constante de retención única (no duplicar el `7`)
**Source:** `src/cli/polling-logfile.js:49` (`DEFAULT_RETENTION_DAYS = 7`) + `:52` (`MS_PER_DAY`).
**Apply to:** `src/gsd/doctor.js` barrido de `.ndjson` (D-12) — importar/reusar la constante, no hardcodear.

### CLI subcommand (lazy-import + exit code)
**Source:** `src/cli.js:331-345` (`gsd verify`) + handler `src/cli/gsd-inspect.js:53-56` (`writeFn`/`errFn` DI, `--json`).
**Apply to:** registro `gsd doctor` en `cli.js` + handler `gsd-doctor.js`.

---

## No Analog Found

Ninguno. Las 5 categorías de target file tienen analog directo en el repo; toda la mecánica destructiva (worktree, lock, retención de logs, removeSession) ya está escrita y endurecida. Phase 41 es esencialmente composición + factorización, no invención.

---

## Metadata

**Analog search scope:** `src/session/`, `src/gsd/`, `src/hooks/`, `src/cli/`, `src/cli/`, `src/logger*.js`, `test/`
**Files scanned:** `reconcile.js`, `lock.js`, `stop.js`, `polling-logfile.js`, `state.js`, `cli.js`, `gsd-inspect.js`, `logger.js`, `logger-events.js`, `stop-worktree-cleanup.test.js`, `server-reconcile-logger.test.js`
**Pattern extraction date:** 2026-06-04
