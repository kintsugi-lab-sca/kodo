# Phase 74: Handoff acumulativo al cierre - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 10 (2 create-src, 4 create-test, 1 extend-helper, 3 modify-src, 2 extend-test)
**Analogs found:** 9 / 10 (1 sin análogo: el contrato de formato D-01..D-04)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/session/handoff.js` ‡ | contract module (pure leaf) | transform | `src/cli/dashboard/plan.js` (leaf discipline) + `src/labels.js` (pure fns) | role-match |
| `src/hooks/session-end.js` | hook (I/O + orquestación) | event-driven | el bloque backstop **en el mismo fichero** `:98-129` | exact (self) |
| `src/hooks/session-start.js` | prompt builder (puro) | transform | las propias `:85` / `:145` | exact (self) |
| `src/session/state.js` (writer `state.tasks`) | model/state mutator | CRUD | `addSession:331-348` / `removeSession:355-376` | exact |
| `test/session/handoff.test.js` ‡ | test (unit puro) | transform | `test/gsd-context.test.js` (assert sobre string puro) | role-match |
| `test/hooks/session-end-handoff.test.js` ‡ | test (unit DI) | event-driven | `test/hooks/session-end.test.js:16-62` | exact |
| `test/state/handoff-state.test.js` ‡ | test (unit + HOME isolation) | CRUD | `test/state/save-state-atomic.test.js:67-90` | exact |
| `test/state/handoff-concurrency.test.js` ‡ | test (integration cross-process) | batch | `test/state/state-writers-concurrency.test.js:41-133` | exact |
| `test/helpers/lock-race-child.mjs` (`--kind handoff`) | test harness | batch | el bloque `--kind writer` `:72-95` del mismo fichero | exact (self) |
| `test/session-start.test.js` + `test/gsd-context.test.js` | test (golden bytes) | transform | `:174-190` / `:189-201` (guard emojis) | exact (self) |

‡ = fichero nuevo.

---

## Pattern Assignments

### `src/session/handoff.js` ‡ (contract module, pure leaf)

**Analog A (disciplina de hoja):** `src/cli/dashboard/plan.js`
**Analog B (funciones puras exportadas):** `src/labels.js`

**Imports pattern — el techo permitido** (`plan.js:41-45`):
```javascript
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
// D-07: node:os es builtin → preserva la leaf-isolation. Misma convención que config.js:4,6
// (`join(homedir(), '.kodo')`). NO se importa src/config.js para no acoplar el leaf a su I/O.
import { homedir } from 'node:os';
```
`handoff.js` debe ser **más estricto todavía**: idealmente **cero imports** (como `src/logger-noop.js`, que `test/check-isolation.test.js:64-73` asserta con `assert.deepEqual(imports, [])`). Si necesita ruta, replicar `join(homedir(), '.kodo', 'plans')` — **nunca** `import { KODO_DIR } from '../config.js'` (Pitfall 1 del research).

**Precedente LOG-12 de "no importes el módulo pesado"** (`state.js:5-8`):
```javascript
import { KODO_DIR } from '../config.js';
// LOG-12: import only the zero-import noop logger, NEVER logger.js. The noop
// is explicitly whitelisted in test/check-isolation.test.js.
import { noopLogger } from '../logger-noop.js';
```
El logger real llega **inyectado desde el caller** (`logger = noopLogger` como default param en cada export). Mismo contrato para `handoff.js`: recibe datos, no los busca.

**Path-containment guard — OBLIGATORIO en el escritor** (`plan.js:117-124`, `String.includes`, NO RegExp):
```javascript
  if (phaseId == null) {
    const taskId = row?.task_id;
    // String.includes (NO RegExp, D-13/anti-ReDoS) — espejo del guard WR-01 de las líneas de abajo.
    const usable =
      taskId && !taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..');
    if (usable) return readLightPlan(taskId, deps); // mapeo D-05 dentro del helper
    return { status: 'no-phase', lines: [] }; // terminal: sin task_id utilizable (D-06)
  }
```
Y la ruta se **construye**, nunca se deriva (`plan.js:67-71`):
```javascript
  // Ruta CONSTRUIDA (no derivada de input por regex, D-09). Byte-idéntica al productor
  // session-start.js:85,145: join(homedir(), '.kodo', 'plans', `${task_id}.md`).
  const plansDir = deps.kodoPlansDir || join((deps.homedirFn || homedir)(), '.kodo', 'plans');
  try {
    const md = readFileFn(join(plansDir, `${taskId}.md`));
```
D-09 convierte el hook en **WRITER** → el guard pasa de "evita leer fuera del root" a "evita **crear ficheros** fuera del root" (Security Domain V5 / OQ3). Copiar el guard verbatim, cambiando solo el valor de retorno degradado.

**Enum cerrado (D-03) — analog de shape:** `src/labels.js:28-31`
```javascript
      const tag = name.slice(5); // after "kodo:"
      if (['opus', 'sonnet', 'haiku'].includes(tag)) {
        result.model = tag;
```
Array literal + `.includes()`, valor no reconocido → default. Espejo exacto para `{clear, logout, prompt_input_exit, bypass_permissions_disabled, other}` → desconocido colapsa a `'other'`.

**Sin análogo:** construir el bloque `## Handoff`, detectar `session=<id>` en el marcador, extraer `**NEXT:**` + truncar a 200. Es código genuinamente nuevo (research §Don't Hand-Roll: *«El único código genuinamente nuevo es el contrato de formato»*). Usar RESEARCH.md D-01..D-04 como spec.

---

### `src/hooks/session-end.js` (hook, event-driven) — MODIFY

**Analog:** el bloque backstop **del mismo fichero** (`:98-129`) — el precedente literal de D-07.

**Seam exacto — el hueco es la línea 97** (`session-end.js:85-104`, estado ACTUAL verificado):
```javascript
    const { id, session } = result;                                    // :85

    // Logger compartido entre el backstop, el typed event y el cleanup.
    const log = deps.loggerFactory                                     // :88
      ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          return createLogger({
            sessionId: session.session_id,
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook', task_id: session.task_id });
        })();                                                          // :96

    // ◄────────── AQUÍ va el bloque de handoff (D-07). Línea 97.

    // ── Review backstop (DELIV-04, D-10..D-14) ─────────────────────  // :98
```
`session` ya está desestructurada en `:85` → `session.task_id` / `session.status` / `session.summary` / `session.task_ref` están disponibles sin trabajo extra. `log` existe desde `:96` → el `log.warn` de D-06 es posible.

**Comment + try/catch propio (fail-open por paso)** — copiar la forma de `:98-129`:
```javascript
    // ── Review backstop (DELIV-04, D-10..D-14) ─────────────────────────────
    // Bloque AUTÓNOMO: tras los guards de idempotencia (:61-72) y ANTES del
    // session.end event / lock release / performTerminalCleanup. No se entrelaza
    // con esos pasos [...]. Envuelto en su
    // propio try/catch además del outer never-throws: un fallo del backstop NUNCA
    // impide el cleanup terminal (fail-open, D-13).
    try {
      // ...
      await runReviewBackstop({ session, input, provider, config, log });
    } catch (err) {
      console.error(`[kodo:session-end] Review backstop error: ${/** @type {Error} */ (err).message}`);
    }
```
El try/catch **no es cosmético**: `withFileLock` sí lanza (Pitfall 3 — `acquireLock:73` `mkdirSync` puede lanzar; `:81` hace `if (e.code !== 'EEXIST') throw e`; `withFileLock:226-230` es `try/finally` **sin catch**, así que un `fn()` que lanza propaga).

**DI deps — shape a extender** (`session-end.js:47-63`):
```javascript
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   removeSessionFn?: typeof removeSession,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   provider?: any,
 *   config?: any,
 *   cmux?: typeof cmux,
 * }} [deps]
 */
export async function runSessionEndHook(input, deps = {}) {
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  // Phase 72 HYG-04: cmux inyectable (default lazy al import estático) para los
  // efectos de cierre cosméticos — mismo patrón DI que stop.js.
  const cmuxClient = deps.cmux || cmux;
```
Patrón: `deps.X || <default real>`, resuelto al principio de la función. Recomendación del research (Pitfall 6): añadir `plansDir` / `writeFn` / `stateWriterFn` a este shape → el test del hook no necesita aislar HOME.

**Lazy import de módulos pesados** (`session-end.js:111-120`) — usar esto si el bloque necesita `state.js`, para no acoplar el hook estáticamente:
```javascript
        try {
          const { loadConfig } = await import('../config.js');
          const realConfig = loadConfig();
          ...
        } catch {
          if (config === undefined) config = {};
          if (provider === undefined) provider = null;
        }
```

---

### `src/session/state.js` — writer de `state.tasks` (state mutator, CRUD)

**Analog:** `addSession:331-348` (el más simple de los tres; `removeSession:355-376` aporta el guard defensivo).

**El shape verbatim a espejar** (`state.js:331-348`):
```javascript
export function addSession(taskId, session, logger = noopLogger) {
  // WR-01: gate the success telemetry on the lock result. On lock-timeout the
  // session is NOT persisted — do not claim `state.session.added` (a false
  // success let callers spawn an untracked Claude session), warn + propagate the
  // fail-safe so callers (launchWorkItem) can abort before side effects.
  const r = withStateLock((state) => {
    state.sessions[taskId] = session;
  });
  if (!r.ok) {
    logger.warn('state.session.add_failed', { task_id: taskId, reason: r.reason });
    return r;
  }
  logger.info('state.session.added', {
    task_id: taskId,
    status: session.status,
  });
  return r;
}
```
Los 5 elementos NO negociables: (1) `logger = noopLogger` default param; (2) `withStateLock` con mutator que **muta en sitio y devuelve undefined**; (3) `if (!r.ok)` → `logger.warn('<ns>_failed', {task_id, reason: r.reason})` → **`return r`** (fail-safe propagado, jamás throw); (4) telemetría de éxito **gated** tras el guard; (5) `return r` final.

**Guard defensivo del campo aditivo** (`removeSession:361`):
```javascript
      if (!Array.isArray(state.history)) state.history = [];
```
→ para D-05: `if (!state.tasks) state.tasks = {};` dentro del mutator, antes de escribir.

**El typedef `State` a extender** (`state.js:51-56`) — mismo estilo de comentario que documenta la aditividad:
```javascript
 * @typedef {{
 *   schema_version: number,
 *   sessions: Record<string, Session>,
 *   history?: Array<Session & { ended_at: string }>  // Phase 30 (D-09 cleanup): aditivo opcional. Mantenido por removeSession (FIFO 50-slot cap). Legacy state.json files sin history se leen como ausente — callers usan `Array.isArray(state.history) ? state.history : []` defensive guard.
 * }} State
```
Y el precedente de "aditivo sin bump" en `Session` (`state.js:41`, `worktree_path`): *«Sesiones legacy v0.5 sin este campo se leen como undefined; consumers downstream deben tolerar falsy. **NO bump de schema_version**»*. Copiar esa frase de cierre en el comentario de `tasks?`.

**`withStateLock` — el contrato que consume** (`state.js:317-323`):
```javascript
export function withStateLock(mutator) {
  return runUnderStateLock(() => {
    const state = loadState();
    const next = mutator(state);
    saveState(next ?? state);
  });
}
```
Carga fresca **dentro** del lock (`:319`) — ésa es la clave anti-clobber. El mutator es **síncrono**.

---

### `src/hooks/session-start.js:85` y `:145` (prompt builder puro) — MODIFY

**Rama no-GSD, ES** (`session-start.js:81-86`) — nótese que el comentario `:83` queda **obsoleto** con D-10 y es parte del cambio:
```javascript
    // Phase 45 PLAN-03: append al FINAL preserva golden bytes (HOOK-02 satisfied-by-construction).
    // D-03: el hook solo emite el string; la sesión escribe el fichero. D-05 markdown plano,
    // D-06 escribir al empezar (re-dispatch sobrescribe, latest-wins), D-07 una sola línea, D-08 ES.
    '',
    `Además, al empezar escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\` (sobrescribe si ya existe).`,
  ].join('\n');
```

**Rama GSD quick, EN** (`session-start.js:140-146`):
```javascript
      // Phase 45 PLAN-03: append DENTRO del if quick — antes del bloque común
      // "## No automatic push" (fuera del if/else) preserva la D-04 common-block
      // invariance. D-03 sin I/O, D-05 markdown plano, D-06 escribir al empezar
      // (re-dispatch sobrescribe, latest-wins), D-07 una línea, D-08 EN (bloque GSD).
      '',
      `Also, at the start write a short plan (what you'll do + planned steps) to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\` (overwrite if it exists).`,
    );
```

**Restricciones de forma (no negociables):**
- Elemento de **array literal** unido con `.join('\n')` — la instrucción nueva es un string más en el array, con su `''` separador.
- La ruta se **resuelve** con `join(KODO_DIR, 'plans', \`${session.task_id}.md\`)` — nunca literal `<task_id>` (lo asserta `test/gsd-context.test.js:212-217`).
- **Conservar el prefijo** de la instrucción (`Además, al empezar escribe un plan corto` / `Also, at the start write a short plan`) — es lo que assertan los tests de presencia (`gsd-context.test.js:209`) y de exclusión phase/bootstrap (`:219`, `:224`).
- **Markdown plano, cero emojis, cero ANSI** — cae en el slice del guard (ver Shared Patterns §3).
- Añadir **dentro** del `if (mode === 'quick')` en `buildGsdContext` para preservar la invariancia del bloque común (`gsd-context.test.js:229`).

---

### `test/hooks/session-end-handoff.test.js` ‡ (test, unit DI)

**Analog:** `test/hooks/session-end.test.js:16-62` — copiar los 3 helpers tal cual.

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

/**
 * Cmux stub — registra las llamadas de los efectos de cierre (HYG-04) para
 * asserts. Sin inyectarlo, runSessionEndHook usaría el cmux real (conexión a
 * cmuxd + loadConfig) al disparar los efectos tras el cleanup.
 */
function makeCmuxStub() {
  const calls = [];
  return {
    stub: {
      setColor: async (args) => { calls.push({ fn: 'setColor', args }); },
      notify: async (args) => { calls.push({ fn: 'notify', args }); },
      listWorkspaces: async () => { calls.push({ fn: 'listWorkspaces' }); return ''; },
      send: async (args) => { calls.push({ fn: 'send', args }); },
    },
    calls,
  };
}

function makeSession(overrides = {}) {
  return {
    session_id: 's-end-1',
    task_id: 'kodo-end-1',
    task_ref: 'KL-end-1',
    /* ...task_url, provider, project_id, project_path, summary, status, started_at, workspace_ref, gsd... */
    ...overrides,
  };
}
```

**Forma de invocación + asserts** (`session-end.test.js:65-82`):
```javascript
  it('sesión viva (no worktree): emite session.end + remueve la sesión', async () => {
    const session = makeSession();
    const { logger, events } = makeLogger();
    const removed = [];
    await runSessionEndHook(
      { session_id: session.session_id, cwd: session.project_path },
      {
        findSessionFn: () => ({ id: session.task_id, session }),
        removeSessionFn: (id) => removed.push(id),
        loggerFactory: () => logger,
        cmux: makeCmuxStub().stub,
      },
    );
    const end = events.find((e) => e.fields?.event === 'session.end');
    assert.ok(end, 'debe emitir el typed session.end event');
    assert.deepEqual(removed, [session.task_id], 'removeSession llamado con el id');
  });
```
`makeCmuxStub().calls` + el push de `removeSessionFn` dan el **orden de efectos observable** que pide el test LIVE-01 («el handoff aterriza ANTES de removeSession»): un array compartido al que empuja tanto el `writeFn` inyectado como `removeSessionFn`.
Este fichero **no aísla HOME y no lo necesita** — inyecta todo. Mantener esa propiedad (→ el bloque D-07 debe aceptar DI de fs/plansDir).

---

### `test/state/handoff-state.test.js` ‡ (test, HOME isolation)

**Analog:** `test/state/save-state-atomic.test.js:67-90`
```javascript
describe('saveState atomic tmp+rename (BIDIR-05 / D-05)', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-atomic-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Dynamic import POST-HOME: STATE_PATH del módulo cacheado resuelve al
    // tmpdir aislado. NINGÚN import estático de state.js (rompería el aislamiento).
    const mod = await import('../../src/session/state.js');
    saveState = mod.saveState;
    loadState = mod.loadState;
    addSession = mod.addSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  afterEach(() => {
    // Reset a v3 limpio entre casos. force evita ENOENT si el caso ya escribió.
    writeFileSync(join(tmpHome, ...STATE_REL), JSON.stringify(cleanV3(), null, 2) + '\n');
  });
```
**Pitfall 5 — sembrar v3 SIEMPRE.** Sin fichero, `loadState():257` devuelve `{schema_version: 2, sessions: {}}` → el siguiente `loadState` migra v2→v3 → `migrateStateV2toV3:139-143` **reconstruye exhaustivamente y descarta `tasks`**. Semilla canónica (`state-writers-concurrency.test.js:47`):
```javascript
/** v3-shaped empty state seed. */
function seedV3() {
  return { schema_version: 3, sessions: {}, history: [] };
}
```

---

### `test/state/handoff-concurrency.test.js` ‡ (test, cross-process)

**Analog:** `test/state/state-writers-concurrency.test.js:41-133` — barrera `go` + HOME por env.

```javascript
const __dirname = dirname(fileURLToPath(import.meta.url));
const CHILD = join(__dirname, '..', 'helpers', 'lock-race-child.mjs');
const STATE_REL = ['.kodo', 'state.json'];

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'kodo-writers-race-'));
    mkdirSync(join(sandbox, '.kodo'), { recursive: true });
    // Seed an EMPTY v3 state.json in the isolated ~/.kodo.
    writeFileSync(join(sandbox, ...STATE_REL), JSON.stringify(seedV3(), null, 2) + '\n');
  });
  afterEach(() => { rmSync(sandbox, { recursive: true, force: true }); });

  function raceWriters(count) {
    const goFile = join(sandbox, 'go');
    const children = [];
    const outputs = new Array(count).fill('');
    for (let i = 0; i < count; i++) {
      const child = spawn(
        process.execPath,
        [CHILD, '--kind', 'writer', '--idx', String(i), '--barrier', goFile],
        {
          stdio: ['ignore', 'pipe', 'inherit'],
          // Isolated HOME so the child's KODO_DIR resolves to the sandbox —
          // NEVER the real ~/.kodo.
          env: { ...process.env, HOME: sandbox },
        },
      );
      child.stdout.on('data', (d) => { outputs[i] += d.toString(); });
      children.push(child);
    }
    const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));
    // All children spawned and waiting on the barrier — release them together.
    writeFileSync(goFile, '1');
    return done.then(() => outputs.map((o) => o.trim()));
  }
```
Assert sobre el **agregado**, nunca sobre quién gana (`:111-131`): todos reportan éxito **y** el estado final contiene las N entradas.

**Extensión del harness** — `test/helpers/lock-race-child.mjs`, modo `--kind handoff` espejo del `--kind writer` (`:72-95`):
```javascript
  // Writer mode (Plan 02): dynamic-import state.js AFTER HOME is set by the
  // parent (env), then addSession for this writer's index. Never throws.
  if (args.kind === 'writer') {
    let written = false;
    try {
      const { addSession } = await import('../../src/session/state.js');
      const idx = args.idx;
      addSession('task-' + idx, { /* ...session record... */ });
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }
```
Contrato del harness (cabecera `:12-16`): *intentar EXACTAMENTE una vez, imprimir un único verdicto a stdout, exit 0, nunca lanzar*. Registrar el modo nuevo en la lista de invocadores de la cabecera (`:5-10`) y en el bloque de argv (`:25-37`). Para el caso D-08 (dos escritores del **mismo** plan) sirve `--hold` (`:230-233`) para forzar solape de la sección crítica.

---

## Shared Patterns

### 1. `withFileLock` — la primitiva que D-08 reutiliza tal cual
**Source:** `src/session/state-lock.js:201-231`
**Apply to:** el RMW del fichero de plan (`<plan>.md.lock`)
```javascript
/**
 * Run `fn` while holding the advisory lock at `lockPath`.
 *
 * On success returns `{ ok:true, value: fn() }` and releases in `finally`.
 * On acquire failure (retries exhausted) returns the fail-safe
 * `{ ok:false, reason:'lock-timeout' }` and emits a warn — never throws, never
 * blocks indefinitely (D-03).
 *
 * @template T
 * @param {string} lockPath
 * @param {() => T} fn
 * @param {LockOpts} [opts]
 * @returns {{ ok: true, value: T } | { ok: false, reason: 'lock-timeout' }}
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
**Tres hechos duros del contrato:**
- `fn` debe ser **100% síncrono** (Pitfall 4): `try { return {ok:true, value: fn()} } finally { releaseLock(...) }` — un `async fn` devuelve una Promise y el `finally` libera el lock **antes** de que la escritura termine. Precedente ya comentado en el repo: `reconcile.js:357-359` (*«SIN `await` dentro del callback»*) y `state-lock.js:39-48` (`sleepSync` con `Atomics.wait` *«so the retry loop stays fully synchronous»*).
- **No hay `catch`**: si `fn()` lanza, propaga → el try/catch de D-07 es estructural.
- Defaults `retries=8, backoffMs=20, ttlMs=10_000` (`state-lock.js:34-36`) → ~160 ms peor caso por lock; **dos locks** en el bloque (plan + state) → ~320 ms.
- Se pasa `{ logger: log }` en `opts` para que el `lock.timeout` salga por el logger inyectado y no por `console.warn`.

### 2. Escritura atómica — copiar `saveState`, NO `writeFileAtomic`
**Apply to:** la escritura final del fichero de plan (D-08)

**El BUENO** (`src/session/state.js:266-281`) — tmp **único** por escritor:
```javascript
export function saveState(state) {
  // WR-02: unique temp name per write (pid + UUID) so two concurrent writers
  // never share a single '.tmp' file and clobber each other's PARTIAL bytes.
  // The final rename remains atomic (no torn reader); [...] On a
  // write/rename failure we best-effort clean the stray tmp so no '.tmp.*'
  // residue is left behind.
  const tmp = STATE_PATH + '.tmp.' + process.pid + '.' + randomUUID();
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n');
    renameSync(tmp, STATE_PATH);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
```

**La TRAMPA** (`src/config.js:135-146`) — tmp de nombre **FIJO**, confirmado:
```javascript
function writeFileAtomic(path, data) {
  const tmp = path + '.tmp';        // ← FIJO: dos escritores concurrentes lo comparten
  const hasSecret = /"[^"]*_secret"\s*:/.test(data);
  if (hasSecret) { writeFileSync(tmp, data, { mode: 0o600 }); chmodSync(tmp, 0o600); }
  else { writeFileSync(tmp, data); }
  renameSync(tmp, path);
}
```
Dos razones para no usarlo: (a) el tmp fijo es exactamente lo que WR-02 corrigió — bajo `withFileLock` sería seguro, pero el lock es **robable tras TTL 10s** (`state-lock.js:36`), así que la garantía no es absoluta; (b) importarlo **acopla a `config.js`**, que computa `KODO_DIR` en module-load (`config.js:14` vía import) y arrastra su grafo → rompe la hoja.

### 3. Guard de emojis/ANSI sobre el tail del prompt — el riesgo REAL de D-10/D-11
**Source:** `test/session-start.test.js:174-190` (ES) y `test/gsd-context.test.js:189-201` (EN)
**Apply to:** las instrucciones nuevas de `session-start.js:85` y `:145`
```javascript
  it('HOOK-01 D-02b: bloque sin emojis ni códigos ANSI escape', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    const HEADER = '## Anti-push-fantasma';
    const block = ctx.slice(ctx.lastIndexOf(HEADER));
    // Sólo verificamos el slice del bloque HOOK-01 — el resto del prompt ES
    // contiene emojis legítimos (✅/📁/⚠️/🔍) en la sección "Comentario final".
    assert.ok(
      !/[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}]/u.test(block),
      'HOOK-01 block must not contain emojis (D-02b)',
    );
    // ESC (\x1B) inicia secuencias ANSI; el bloque es markdown plano.
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\x1B\[/.test(block), 'HOOK-01 block must not contain ANSI escape sequences (D-02b)');
  });
```
El slice va desde `lastIndexOf(HEADER)` **hasta el final del string** → ya cubre la instrucción de plan de `:85`, y cubrirá la de handoff. El equivalente EN usa `HEADER = '## No automatic push'`. **Sin emojis, sin ANSI, markdown plano.** No hay golden bytes que reparar (D-11 re-alcanzado): cero tests assertan los literales «sobrescribe si ya existe» / «overwrite if it exists».

### 4. Tests de exclusión que NO deben romper
**Source:** `test/gsd-context.test.js:204-227`
```javascript
describe('PLAN-03 — quick-mode lightweight plan instruction (EN)', () => {
  const INSTR = 'Also, at the start write a short plan';

  it('PLAN-03 quick presencia: inyecta instrucción EN en la rama quick (D-08 inglés)', () => {
    const ctx = buildGsdContext(makeSession({ gsd_mode: 'quick', summary: 'X' }));
    assert.match(ctx, /Also, at the start write a short plan/);
  });

  it('PLAN-03 quick ruta resuelta: contiene join(KODO_DIR, "plans", "<task_id>.md"), sin literal', () => {
    const ctx = buildGsdContext(makeSession({ gsd_mode: 'quick', summary: 'X', task_id: 'uuid-abc' }));
    const expectedPath = join(KODO_DIR, 'plans', 'uuid-abc.md');
    assert.ok(ctx.includes(expectedPath), `quick output must contain resolved path ${expectedPath}`);
    assert.ok(!ctx.includes('<task_id>'), 'quick path must be resolved, not templated');
  });

  it('PLAN-03 exclusión phase: la rama phase NO recibe la instrucción (D-04)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    assert.ok(!ctx.includes(INSTR), 'phase branch must NOT inject the plan instruction');
  });
```
Las asserts son de **prefijo + ruta resuelta + orden**, no de bytes exactos → conservando el prefijo, no rompe nada. D-10 dice que full/bootstrap **siguen sin** instrucción → `:219` y `:224` son la regresión que lo vigila; el planner añade el par equivalente para el handoff.

### 5. Vigilancia del grafo de imports (LOG-12 / leaf-isolation)
**Source:** `test/check-isolation.test.js:40-73` (`walkImports`, walker transitivo de imports relativos) y `test/format-isolation.test.js:40`
**Apply to:** `src/session/handoff.js`
El repo ya tiene un walker que sigue imports relativos transitivamente (ignora bare specifiers como `node:fs`, **no** sigue `await import()` dinámico). El precedente de "cero imports" asserted:
```javascript
  it('src/logger-noop.js exists and has zero imports', () => {
    const src = readFileSync(noopPath, 'utf-8');
    const imports = extractImports(src);
    assert.deepEqual(
      imports,
      [],
      `logger-noop.js must have zero imports (including node: builtins), found: ${imports.join(', ')}`,
    );
  });
```
Si `handoff.js` acaba importando `config.js` o `state.js`, ese grafo llega a `logger.js` y **LOG-12 se rompe** (`check-isolation.test.js:75`). El planner puede añadir un caso a este fichero para blindar la hoja.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| El **contrato de formato** dentro de `src/session/handoff.js` — construir `## Handoff <fecha> <!-- kodo:handoff v=1 ... -->`, detectar el marcador scoped por `session=<id>`, extraer `**NEXT:**` + truncar a 200 | contract module | transform | No existe ningún parser/writer de markdown estructurado en el repo. `plan.js:72` hace `md.split('\n')` y no parsea. Es el único código genuinamente nuevo (RESEARCH §Don't Hand-Roll). Spec = CONTEXT.md D-01..D-04. La **forma del módulo** (hoja pura, DI, guards) sí tiene análogo: ver arriba. |

**Nota para el planner (D-09 create-if-missing):** la cabecera mínima interpola `session.task_ref` / `session.summary`, que vienen del **provider** y **no** están cubiertos por el enum de D-03 (Security Domain: *«Riesgo real bajo (markdown en un fichero local, no HTML ni shell), pero conviene al menos no interpolarlos en la ruta»*). El único análogo de defanging es `session-start.js:129` (`session.summary.replace(/"/g, "'")` — D-04 Phase 12), pero es para el parser de slash-commands, no para markdown.

---

## Metadata

**Analog search scope:** `src/session/`, `src/hooks/`, `src/cli/dashboard/`, `src/config.js`, `test/`, `test/state/`, `test/hooks/`, `test/helpers/`
**Files scanned:** 12 leídos con excerpts (`session-end.js`, `session-start.js`, `state.js`, `state-lock.js`, `plan.js`, `config.js`, `labels.js`, `session-end.test.js`, `save-state-atomic.test.js`, `state-writers-concurrency.test.js`, `lock-race-child.mjs`, `session-start.test.js`, `gsd-context.test.js`, `check-isolation.test.js`)
**Pattern extraction date:** 2026-07-15
