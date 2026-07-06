# Phase 70: Concurrencia y ciclo de vida de procesos - Research

**Researched:** 2026-07-06
**Domain:** Node.js multiprocess concurrency — advisory file locks (`O_EXCL`), atomic writes (tmp+rename), PID/process lifecycle, deterministic real-process race tests
**Confidence:** HIGH (todo verificado contra el código real leído esta sesión; cero dependencias externas por invariante del milestone)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** UNA primitiva de lock advisory reutilizable (lockfile `O_EXCL` + retry corto con backoff), módulo pequeño y puro (`src/session/state-lock.js` o `src/util/file-lock.js`). MISMA primitiva para `withStateLock` (CONC-01), lock de `polling start` (CONC-06/M20) y dedup no-GSD por `task_id` (CONC-08/M17). No duplicar lógica de lockfile en tres sitios.
- **D-02:** Firma `withStateLock(fn)` donde `fn` recibe el estado re-leído bajo el lock y devuelve el estado a guardar — patrón **load→mutate→save atómico**: adquirir lock → `loadState()` fresco → `fn(state)` → `saveState()` → liberar en `finally`. El `saveState` actual (tmp+rename, `state.js:242`) se conserva como paso de escritura DENTRO del lock; no se toca su atomicidad de bytes.
- **D-03:** Al no poder adquirir el lock tras agotar retry → **fail-safe observable**: warn NDJSON + abortar la mutación sin corromper (advisory, no bloqueante indefinido). Retry corto (~decenas de ms × pocos intentos). El lockfile guarda `{pid, acquired_at}` y se roba si el PID está muerto o supera un TTL corto — mismo criterio de liveness que `acquireGsdLock` (`isPidAlive` + TTL).
- **D-04:** El comentario falso **"ÚNICO escritor"** (auditoría lo cita como `server.js:682`; la línea derivó) se corrige en el MISMO commit que introduce `withStateLock`. Localizar el comentario real y reemplazarlo por la verdad («N escritores coordinados por `withStateLock`»).
- **D-05:** El gate de `max_parallel` (`manager.js:178`, hoy `filter(s => s.status === 'running')`) pasa a filtrar también por liveness: `status === 'running'` **y** `alive !== false`. Se elige filtrar en el gate por `alive` (no derivar `status:'idle'` desde reconcile) porque **`alive` es el campo cuyo único escritor es `reconcileTick`**; escribir `status` desde reconcile violaría la separación semántica (status = outcome, alive = liveness). El gate LEE, no escribe.
- **D-06:** Corrección puramente en el filtro del gate; sin nuevo campo, sin tocar la máquina de estados de reconcile.
- **D-07:** `writeLockFile` (`lock.js:191`) escribe con `writeFileSync(lockPath, content, {flag:'wx'})` (`O_EXCL`). En `acquireGsdLock` (`lock.js:103`) se elimina el TOCTOU del Caso 1 (`if (!existsSync) writeLockFile`): con `wx`, el `EEXIST` del segundo proceso cae al camino de leer el lock existente. Casos 2–5 intactos.
- **D-08:** `stealLock` (`lock.js:216`) pasa de `writeFileSync` directo a **tmp+rename** (reemplazo atómico del contenido). La decisión de robar (PID muerto/TTL) no cambia; solo se endurece la escritura.
- **D-09:** `teardown` solo borra `~/.kodo/kodo.pid` si `payload.pid === process.pid` (el proceso solo borra su propio PID file). Evita que un arranque nuevo borre el PID de un daemon vivo distinto.
- **D-10:** El PID se escribe **post-bind** (después de que el server abra el puerto), no antes: si el bind falla, no queda un `kodo.pid` mintiendo.
- **D-11:** Antes de un SIGKILL en `stop`/`stopDaemon`, comparar `started_at` del payload con el arranque real vía `ps -o lstart= -p <pid>`; si no cuadran (PID reciclado) → **abortar el kill**. macOS-first; si `ps` no está o no parsea, degradar seguro (no matar por defecto, log warn) — never-throws.
- **D-12:** `polling start` adquiere el lock `O_EXCL` de D-01 antes de arrancar el daemon: dos `polling start` concurrentes → un solo daemon (el segundo ve `EEXIST`, reporta «ya arrancando/arrancado», sale limpio). Reusa la primitiva.
- **D-13:** El dedup de sesiones **no-GSD** (hoy in-process) se hace cross-proceso con un lock por `task_id` usando la misma primitiva. Espejo del lock per-repo del carril GSD.
- **D-14:** `migrateConfigIfNeeded` (`config.js:146`) persiste vía `writeFileAtomic` (tmp+rename, ya definida en `config.js:100`), no `writeFileSync` directo.
- **D-15:** La ubicación real de los worktrees se verifica **empíricamente** (sesión GSD viva), se documenta, y si hay discrepancia se corrige la ruta. Si no puede montarse una sesión GSD real en el cierre, se difiere la firma humana pero el análisis del código sí se entrega.

### Claude's Discretion
- Nombre y ubicación exactos del módulo de la primitiva (`state-lock.js` vs `util/file-lock.js`) y si `withStateLock` es un wrapper fino o vive junto a `saveState` en `state.js`.
- Parámetros exactos del retry/backoff y del TTL del lockfile de estado (retry corto; robo respeta liveness por PID).
- Estructura del filtro del gate (`alive !== false` inline vs helper `isSchedulable(s)`).
- Formato de parseo de `ps -o lstart=` y margen de tolerancia al comparar `started_at` (segundos de skew).
- Ubicación y estilo de los tests (`node:test`; los de concurrencia lanzan procesos reales / hijos).

### Deferred Ideas (OUT OF SCOPE)
- Rediseño «un solo escritor de estado vía HTTP contra el server» — fuera de alcance explícito (el lockfile cubre el riesgo a ~1/20 del coste). No reescribir hooks/CLI/doctor.
- M21 «medir antes de arreglar» y M7–M9 — diferidos.
- Verificación HUMANA de la ubicación de worktrees en sesión GSD viva (M13) — se difiere la firma si no puede montarse, entregando igual el análisis del código.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONC-01 | ~6 escritores de `state.json` vía `withStateLock(fn)` + corregir comentario falso | §Standard Stack (primitiva), §Arch Pattern 1, §Pitfall 1/6. Los 4 puntos de mutación reales enumerados abajo. |
| CONC-02 | `acquireGsdLock` atómico (`flag:'wx'`, EEXIST→tomado); `stealLock` tmp+rename | §Arch Pattern 2, código real `lock.js:103/191/216` leído. |
| CONC-03 | Zombi libera slot de `max_parallel` (gate filtra `alive`) | §Arch Pattern 3, §Pitfall 2 (la sutileza tab-alive vs process-alive). |
| CONC-04 | `teardown` borra `kodo.pid` solo si `payload.pid === process.pid`; PID post-bind | §Arch Pattern 4, §Pitfall 3 (**tensión D-10 vs gap-closure 66-07**). |
| CONC-05 | Comparar `started_at` con `ps -o lstart=` antes de SIGKILL | §Arch Pattern 5, §Code Examples (parseo verificado macOS), §Pitfall 4 (locale). |
| CONC-06 | Dos `polling start` concurrentes → un daemon (lock `O_EXCL`) | §Arch Pattern 6, `lifecycle.js:86` startDaemon pre-flight (hoy TOCTOU). |
| CONC-07 | `migrateConfigIfNeeded` vía `writeFileAtomic` | §Arch Pattern 7 — trivial, `writeFileAtomic` ya existe en `config.js:100`. |
| CONC-08 | Dedup no-GSD cross-proceso (lock por `task_id`) | §Arch Pattern 8, `dispatcher.js:15` `inFlight` es `Set` in-process. |
| CONC-09 | Ubicación real de worktrees verificada empíricamente + documentada | §Arch Pattern 9, §Pitfall 5 (discrepancia `.bg-shell` vs `.claude/worktrees` viva en doctor.js). |
</phase_requirements>

## Summary

Esta es una fase de **hardening sobre código existente**, no greenfield. El invariante del milestone es **cero dependencias npm nuevas** (STATE.md: «locks vía `node:fs` `O_EXCL`/`flag:'wx'` built-in; nada de `proper-lockfile`/`lockfile`»). Por tanto la investigación es 90% arqueología de código y 10% verificación de primitivas de SO (`O_EXCL`, `ps -o lstart=`). Todos los hallazgos abajo están **verificados contra el código real** leído esta sesión, con `file:line`.

El corazón de la fase es una **primitiva advisory-lock** de ~40 líneas que generaliza el patrón ya probado en `src/gsd/lock.js` (lockfile + `isPidAlive` + TTL + steal). Esa primitiva se consume en tres sitios (state writers, `polling start`, dedup no-GSD). El resto son endurecimientos quirúrgicos: `flag:'wx'` en dos escrituras de lock, un `&& s.alive !== false` en un filtro, una comparación `ps -o lstart=` antes de un SIGKILL, un swap de `writeFileSync`→`writeFileAtomic`, y un guard de ownership del PID.

**Dos hallazgos críticos que el planner DEBE resolver antes de codificar** (ver §Pitfalls y §Assumptions): (1) **D-10 «PID post-bind» está en conflicto directo con la gap-closure 66-07** que movió deliberadamente la escritura del PID a *pre-bind* en `daemon/run.js:142` para que `kodo up` no diera timeout en cold-spawn — pero el objetivo de D-10 (no dejar PID mentiroso si el bind falla) YA lo cumple el `teardown(1)` del fail-path. (2) **El puente zombi→slot (D-05) solo libera el slot cuando reconcile marca `alive:false`, lo que requiere que la TAB del workspace muera, no solo el proceso Claude** — un `kill -9` que deja la tab viva produce `state:'idle'` con `alive:true`, que el gate SÍ cuenta. El test de zombi debe conducir la muerte de la tab.

**Primary recommendation:** Construir la primitiva `withStateLock` en/junto a `src/session/state.js`, envolviendo los **3 mutadores** (`addSession`/`updateSession`/`removeSession`) más el `saveState` de `runReconcileTick` — esos 4 puntos son el conjunto COMPLETO de escritura de `state.json` (verificado por grep). Reusar `isPidAlive` de `lock.js` para el criterio de robo. Los demás requisitos son diffs quirúrgicos aislados; ninguno introduce dependencias.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coordinación de escritura a `state.json` | Filesystem primitive (`state-lock.js`) | State module (`state.js` mutators) | Todos los mutadores funnelizan por 3 funciones de state.js; el lock vive en la capa de FS, se aplica en la capa de state. |
| Lock GSD per-repo | Filesystem primitive (`gsd/lock.js`) | Dispatcher | El lock ya existe; solo se endurece la atomicidad (`wx`). |
| Liveness de sesiones (`alive`) | Reconcile loop (server process) | Session gate (read-only) | `reconcileTick` es el único escritor de `alive`; el gate solo lee. |
| Ciclo de vida del PID/daemon | Daemon runtime (`daemon/run.js`, `daemon/lifecycle.js`) | PID file module (`cli/polling-daemon.js`) | El daemon es el único dueño de `kodo.pid`; el módulo PID es I/O puro. |
| Prevención de PID reuse en SIGKILL | Daemon lifecycle (`stopDaemon`) | OS (`ps`) | La verdad del arranque real vive en el kernel; se consulta vía `ps`. |
| Migración de config | Config module (`config.js`) | Filesystem primitive (`writeFileAtomic`) | Ya existe la fontanería atómica; solo se enchufa. |

## Standard Stack

Esta fase **no instala nada**. El «stack» son primitivas de Node built-in ya en uso.

### Core
| Primitiva | Módulo | Uso en esta fase | Ya en uso en |
|-----------|--------|------------------|--------------|
| `writeFileSync(path, data, {flag:'wx'})` | `node:fs` | Creación atómica exclusiva de lockfile (`O_EXCL`); `EEXIST` = ya tomado | Nuevo uso; patrón estándar POSIX |
| `renameSync(tmp, dst)` | `node:fs` | Reemplazo atómico intra-fs (steal, saveState, writeFileAtomic) | `state.js:252`, `config.js:103`, `polling-daemon.js:100` [VERIFIED: code] |
| `process.kill(pid, 0)` | `node:process` | Liveness check (`isPidAlive`) — `ESRCH` = muerto | `gsd/lock.js:67` [VERIFIED: code] |
| `execFileSync('ps', ['-o','lstart=','-p',pid])` | `node:child_process` | Arranque real del proceso para anti-PID-reuse (D-11) | `pgrep` ya usado igual en `reconcile.js:282` [VERIFIED: code] |
| `randomUUID()` | `node:crypto` | Nombres únicos de tmp por escritor (evita clobber de `.tmp`) | `state.js:249` [VERIFIED: code] |
| `node:test` + `node:assert/strict` | test runner | Tests unitarios y de proceso real (spawn de hijos) | 146 archivos de test, 1843 pass + 1 skip [VERIFIED: code] |
| `spawn(..., {detached:true})` + `child.unref()` | `node:child_process` | Lanzar daemons hijos en tests de race real | `lifecycle.js:121`, `polling.js` [VERIFIED: code] |

### Supporting
| Primitiva | Módulo | Uso |
|-----------|--------|-----|
| `mkdtempSync(tmpdir())` | `node:fs`/`node:os` | Sandbox por test (repo/HOME aislado) — patrón `gsd-concurrency.test.js:26` [VERIFIED: code] |
| `realpathSync` | `node:fs` | Colapsar `/tmp`→`/private/tmp` en macOS al comparar paths de lock | `lock.js:180` [VERIFIED: code] |
| `setTimeout` de `node:timers/promises` | `node:timers/promises` | Backoff del retry del lock | `lifecycle.js:35` (`sleep`) [VERIFIED: code] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `O_EXCL` lockfile | `proper-lockfile` / `lockfile` npm | **PROHIBIDO por invariante del milestone** (cero deps nuevas). El patrón ya existe in-house en `gsd/lock.js` y cubre el 100% del caso. |
| `ps -o lstart=` (localizado) | `/proc/<pid>/stat` btime | `/proc` no existe en macOS (kodo es macOS-primary). `ps` es la vía portable BSD. |
| Advisory lockfile | `flock(2)` real (`fs.flock` no existe en Node core) | Node core no expone `flock`; requeriría addon nativo (dep). Advisory lockfile es lo idiomático en el proyecto. |

**Installation:** N/A — cero paquetes. Todo es `node:` built-in.

## Package Legitimacy Audit

**No aplica.** Esta fase no instala ningún paquete externo (invariante del milestone: «Cero nuevas dependencias npm»). Toda la funcionalidad se implementa con módulos `node:` built-in ya importados en el codebase. No hay superficie de slopsquatting.

## Architecture Patterns

### System Architecture Diagram

```
                        PROCESOS INDEPENDIENTES (causa raíz T1)
   hooks/stop.js  hooks/session-end.js  cli/polling.js  cli/adopt.js  gsd/doctor.js
   server (reconcile)   dispatcher   orchestrator/launch   session/health   ...
        │        │        │        │        │        │
        └────────┴────────┴───┬────┴────────┴────────┘
                              │  todos mutan state.json
                              ▼
                  ┌───────────────────────────┐
                  │  state.js mutators (3):    │   ◄── HOY: loadState→mutar→saveState
                  │   addSession               │       SIN lock → clobber cross-proceso
                  │   updateSession            │
                  │   removeSession            │   ► FIX: envolver en withStateLock(fn)
                  │  + reconcile saveState (1) │
                  └────────────┬──────────────┘
                               │ withStateLock: acquire O_EXCL → RELOAD fresh
                               ▼                  → fn(state) → saveState → finally release
                  ┌───────────────────────────┐
                  │  state-lock.js (PRIMITIVA) │   ◄── D-01: reusada por 3 consumidores
                  │  lockfile O_EXCL + retry   │
                  │  + isPidAlive + TTL steal  │
                  └────┬──────────┬──────────┬─┘
                       │          │          │
              withStateLock  polling start  dedup no-GSD
               (CONC-01)     lock (CONC-06)  por task_id (CONC-08)

   ─────────────────────  Ciclo de vida del PID/daemon (causa raíz T2)  ─────────────
   daemon/run.js ── writePidFile{pid,started_at,kind} ── ~/.kodo/kodo.pid
        │  teardown ──► removePidFile SOLO si payload.pid===process.pid (D-09)
        │
   daemon/lifecycle.js stopDaemon ── SIGTERM ─5s─► [ps -o lstart= == started_at?] ─sí─► SIGKILL
                                                          └── no/parse-fail ──► ABORT + warn (D-11)
```

### Recommended Project Structure
```
src/
├── session/
│   ├── state-lock.js     # NUEVO (D-01): primitiva advisory-lock reusable. O ...
│   ├── state.js          # ... withStateLock vive aquí junto a saveState (discreción)
│   ├── manager.js        # gate max_parallel (:178) → añadir && alive !== false
│   └── reconcile.js      # único escritor de alive (sin cambios de lógica)
├── gsd/
│   ├── lock.js           # writeLockFile → flag:'wx'; stealLock → tmp+rename
│   └── doctor.js         # decideLock (:230) — espejo puro, se mantiene consistente
├── config.js             # migrateConfigIfNeeded → writeFileAtomic (ya existe :100)
├── triggers/
│   └── dispatcher.js     # dedup no-GSD: inFlight Set → lock cross-proceso por task_id
├── daemon/
│   ├── run.js            # PID ownership (teardown guard) + tensión post-bind
│   └── lifecycle.js      # stopDaemon → ps -o lstart= antes de SIGKILL; polling start lock
└── server.js             # corregir comentario "ÚNICO escritor" (:842, derivó de :682)
```

### Pattern 1: `withStateLock(fn)` — load→mutate→save bajo lock (CONC-01)
**What:** Un wrapper que adquiere un lockfile `O_EXCL`, **re-lee** el estado fresco bajo el lock, aplica `fn`, guarda con el `saveState` atómico existente, y libera en `finally`.
**When to use:** Los 4 puntos de escritura de `state.json` (los 3 mutadores de `state.js` + el `saveState` de reconcile).
**Los escritores reales** (verificado — `grep saveState(` y callers de los mutadores):
- `addSession` (`state.js:264`), `updateSession` (`state.js:305`), `removeSession` (`state.js:278`) — todos hacen `loadState()`→mutar→`saveState()` [VERIFIED: code `state.js`].
- `runReconcileTick` (`reconcile.js:308`) hace `loadState()`→...async host I/O...→`saveState()` (`:351`) [VERIFIED: code].
- **Callers cross-proceso** de esos mutadores (por qué el lock importa): `hooks/stop.js`, `hooks/session-end.js`, `hooks/terminal-cleanup.js`, `cli/polling.js`, `cli/adopt.js`, `gsd/doctor.js`, `gsd/verify.js`, `orchestrator/launch.js`, `session/manager.js` (`markSessionStatus:384`→`updateSession`), `session/health.js`, `adopt.js`, `dispatcher.js`, `server.js` (solo vía reconcile) [VERIFIED: code — grep de callers]. Obs. claude-mem 24815: «10 concurrent writers contradict single writer claim».

**Insight clave:** como TODA mutación funneliza por 3 funciones de `state.js` + el saveState de reconcile, envolver esos 4 puntos coordina a los ~13 call-sites cross-proceso gratis. La primitiva vive en la capa de FS; se aplica en la capa de state.

```javascript
// Source: patrón derivado de gsd/lock.js (isPidAlive+TTL+steal) + state.js saveState atómico [VERIFIED: code]
// state-lock.js — advisory lock reusable (D-01). NO deps externas.
export function withFileLock(lockPath, fn, { retries = 8, backoffMs = 20, ttlMs = 10_000 } = {}) {
  const acquired = acquireLock(lockPath, { retries, backoffMs, ttlMs }); // O_EXCL + retry + steal-if-dead
  if (!acquired) { /* D-03: warn NDJSON, abort sin corromper */ return { ok: false, reason: 'lock-timeout' }; }
  try { return { ok: true, value: fn() }; }
  finally { releaseLock(lockPath, acquired.token); } // idempotente, solo borra si es dueño
}

// withStateLock envuelve el load→mutate→save (D-02):
export function withStateLock(mutator) {
  return withFileLock(STATE_LOCK_PATH, () => {
    const state = loadState();        // RE-LEE fresco bajo el lock (clave anti-clobber)
    const next = mutator(state);
    saveState(next ?? state);         // saveState tmp+rename ya atómico (state.js:242)
  });
}
```

**Nuance de reconcile (documentar en el plan):** `runReconcileTick` hace I/O async del host (`pgrep`, `listWorkspaces`) ENTRE el load y el save. NO sostener el lock durante ese I/O. Opciones: (a) computar el diff fuera del lock y aplicar bajo `withStateLock` re-leyendo y re-derivando, o (b) aceptar que reconcile re-lee y re-aplica sus transiciones sobre el estado fresco dentro del lock. La derivación de `reconcileTick` es pura (`reconcile.js:117`) y ya retorna el estado nuevo desde el cargado — el patrón limpio es: snapshot host (async, sin lock) → `withStateLock(state => reconcileTick(state, liveRefs, ...).state)`.

### Pattern 2: `acquireGsdLock` atómico con `flag:'wx'` (CONC-02)
**What:** Cerrar el TOCTOU del Caso 1 en `lock.js:107` (`if (!existsSync(lockPath)) writeLockFile(...)`).
**Actual (roto):** dos procesos ven el fichero ausente → ambos `writeLockFile` → ambos `{acquired:true}` [VERIFIED: code `lock.js:103-110`].
**Fix:** `writeLockFile` (`lock.js:191`) usa `writeFileSync(lockPath, content, {flag:'wx'})`. En `acquireGsdLock`, envolver el intento de creación en try/catch: `EEXIST` → **caer al camino de leer el lock existente** (Casos 2–5 ya presentes: PID muerto→steal, TTL→steal, corrupto→steal, vivo+TTL ok→reject). `stealLock` (`lock.js:216`) → tmp+rename.

```javascript
// Source: reescritura de lock.js:103-139 [VERIFIED: code]
export function acquireGsdLock(projectPath, sessionInfo) {
  const lockPath = lockPathFor(projectPath);
  try {
    writeLockFile(lockPath, sessionInfo);   // ahora {flag:'wx'} — atómico
    return { acquired: true };              // ganó la carrera de creación
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;       // error real, no la carrera
    // EEXIST: otro proceso creó el lock primero → aplicar Casos 2–5 (leer existente)
  }
  // ... resto idéntico: readLock, isPidAlive→steal, TTL→steal, else reject ...
}
```
**Consistencia:** `decideLock` en `doctor.js:230` es un espejo PURO (no escribe; solo decide steal/keep) [VERIFIED: code]. No necesita cambio de código, pero el planner debe verificar que su semántica sigue cuadrando con `acquireGsdLock` (D-08 histórico).

### Pattern 3: gate de `max_parallel` filtra por `alive` (CONC-03)
**What:** `manager.js:178`: `listSessions().filter((s) => s.status === 'running')` → `...filter((s) => s.status === 'running' && s.alive !== false)` [VERIFIED: code `manager.js:178`].
**Por qué `alive !== false` y no `alive === true`:** sesiones legacy sin el campo `alive` se leen `undefined`; `!== false` las cuenta (conservador, no regresiona). Solo excluye las que reconcile marcó explícitamente `false`.
**Invariante:** `alive` lo escribe SOLO `reconcileTick` (vía `applyLiveFields`, `reconcile.js:257`) [VERIFIED: code]. El gate LEE. No se toca reconcile.

### Pattern 4: PID ownership — teardown guard + post-bind (CONC-04)
**Estado actual verificado:**
- `daemon/run.js:115-123` teardown hace `removePidFileFn('kodo')` **incondicional** [VERIFIED: code]. **Fix D-09:** leer el payload y borrar solo si `payload.pid === process.pid`.
- `daemon/run.js:142` escribe el PID **ANTES** del `await startServerFn` — es decir **pre-bind**, DELIBERADAMENTE (comentario 66-07: escribirlo post-await metía la latencia de `provider.init` en el bounded-wait de `startDaemon` y `kodo up` daba «failed to write PID file within 2000ms») [VERIFIED: code].
- `server.js:832` (legacy `kodo start`, no-managed) escribe `writeFileSync(PID_PATH, String(process.pid))` DENTRO del callback de `server.listen` — es decir **ya post-bind** [VERIFIED: code].
- El payload del daemon ya incluye `started_at` (`run.js:143`) — lo necesita D-11.

**Ver §Pitfall 3 — este es el hallazgo crítico #1: D-10 (post-bind) vs gap-closure 66-07 (pre-bind).**

### Pattern 5: anti-PID-reuse antes de SIGKILL (CONC-05)
**What:** En `stopDaemon` (`lifecycle.js:163`), tras SIGTERM y el wait de 5s, ANTES del `kill(pid, 'SIGKILL')` (`:184`), comparar `payload.started_at` con `ps -o lstart= -p <pid>` [VERIFIED: code — flujo SIGTERM→5s→SIGKILL en `lifecycle.js:176-187`].
**Degradación segura (D-11):** si `ps` no está, sale con error, o el parse da `NaN` → **no ejecutar SIGKILL**, log warn. El proceso ya recibió SIGTERM; el peor caso es que persista un poco (no matar a un inocente por PID reciclado). Ver §Code Examples y §Pitfall 4 para el parseo verificado.

### Pattern 6: lock `O_EXCL` en `polling start` (CONC-06)
**What:** `startDaemon` (`lifecycle.js:86`) hoy tiene un pre-flight `readPidFile(name)` + `isPidAlive` (`:111-118`) que es **check-then-spawn (TOCTOU)**: dos `polling start` casi simultáneos pueden ambos leer «no vivo» y ambos spawnear [VERIFIED: code].
**Fix D-12:** envolver la decisión de spawn en la primitiva `O_EXCL`: el segundo proceso ve `EEXIST` → reporta «ya arrancando/arrancado» → sale limpio. Reusa `state-lock.js`, no una primitiva nueva.

### Pattern 7: migración de config atómica (CONC-07)
**What:** `config.js:148,150` — `migrateConfigIfNeeded` escribe backup y config migrado con `writeFileSync` directo [VERIFIED: code]. **Fix:** usar `writeFileAtomic` (ya definida en `config.js:100`, tmp+rename) para el config migrado (`:150`). Trivial, diff de 1 línea. (El `.bak` en `:148` es opcional endurecerlo; el riesgo es el `config.json` truncado, no el backup.)

### Pattern 8: dedup no-GSD cross-proceso (CONC-08)
**What:** `dispatcher.js:15` — `const inFlight = new Set()` es **in-process** [VERIFIED: code]. El guard `if (inFlight.has(task.id))` (`:138`) solo dedup dentro del mismo proceso. Los tasks no-GSD NO adquieren el lock GSD (que es solo para `gsdMode`, `:150`) [VERIFIED: code].
**Fix D-13:** para el carril no-GSD, adquirir un lock por `task_id` con la primitiva `state-lock.js` (path tipo `~/.kodo/locks/dispatch-<task_id>.lock` o similar) antes de despachar. Cierra la ventana en que dos procesos despachan la misma tarea no-GSD casi a la vez. Espejo del lock per-repo GSD.

### Pattern 9: verificación empírica de worktrees (CONC-09)
**Estado verificado:**
- `computeRealWorktreePath` (`state.js:176`) devuelve `<projectPath>/.claude/worktrees/<sid>` — «confirmado empíricamente (TENDERIO-9 + git worktree list)» según su comentario [VERIFIED: code].
- `computeWorktreePath` legacy (`state.js:154`) devuelve `<projectPath>/.bg-shell/<sid>` [VERIFIED: code].
- **DISCREPANCIA VIVA:** `doctor.js:262` sigue detectando huérfanos como «no live session for **.bg-shell** dir» y `detectOrphanWorktrees` escanea `.bg-shell` [VERIFIED: code]. Si Claude Code crea los worktrees en `.claude/worktrees/`, el doctor está limpiando el directorio equivocado. Ver §Pitfall 5.
**Acción (D-15):** montar una sesión GSD real, `git worktree list`, confirmar dónde caen los worktrees, documentar, y si `.bg-shell` está muerto corregir doctor/reconcile/plan-reader para usar `computeRealWorktreePath`. Obs. 23450 (2026-06-13) «Worktree Path Discrepancy in computeWorktreePath» es el driver.

### Anti-Patterns to Avoid
- **Sostener el lock a través de I/O async** (reconcile host snapshot): dispara el TTL/steal y serializa el host poll. Computar fuera, aplicar dentro.
- **`alive === true` en el gate:** rompe sesiones legacy sin el campo. Usar `!== false`.
- **`writeFileSync` directo sobre un lock/config existente** (no atómico): un lector concurrente ve bytes a medias. Siempre tmp+rename para reemplazo.
- **Bloquear indefinidamente en el lock de estado:** los escritores de state son rápidos; retry corto + abort observable (D-03), nunca un `while(true)` esperando.
- **Matar por PID sin verificar arranque:** SIGKILL a un PID reciclado mata a un inocente. Comparar `started_at` (D-11).
- **Parsear `ps -o lstart=` asumiendo locale C:** el formato es localizado (ver §Pitfall 4).

## Don't Hand-Roll

Esta fase **invierte** la heurística normal de «don't hand-roll»: el proyecto DELIBERADAMENTE hand-rollea el lock por invariante (cero deps). La tabla lista lo que NO se debe re-construir **dentro del propio código del proyecto** (reusar lo que ya existe):

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Escritura atómica de fichero | Un nuevo tmp+rename | `saveState` (`state.js:242`), `writeFileAtomic` (`config.js:100`), `writePidFile` (`polling-daemon.js:94`) | Tres implementaciones probadas ya existen; el lock coordina, la atomicidad de bytes ya está resuelta. |
| Liveness de PID | Un nuevo check | `isPidAlive` (`lock.js:67`, `process.kill(pid,0)`, ESRCH-aware) | Ya exportado, ya testeado, ya reusado por `lifecycle.js` y `doctor.js`. |
| Lockfile + TTL + steal | Una segunda variante | Generalizar el patrón de `gsd/lock.js` a `state-lock.js` (D-01) | La lógica steal-if-dead/TTL ya existe; extraer, no duplicar (evita divergencia con `decideLock`). |
| Lock advisory | `proper-lockfile`/`lockfile` npm | Primitiva in-house `O_EXCL` | **Invariante del milestone: cero deps.** |
| Spawn detached de daemon | Nuevo spawn | `startDaemon` (`lifecycle.js:86`) | Ya maneja Windows-refuse, pre-flight, unref, bounded-wait. Solo añadir el lock O_EXCL delante. |
| Parseo de PID file | Nuevo parser | `readPidFile` (`polling-daemon.js:119`, shape-check defensivo) | Ya valida `pid:number`+`started_at:string`; el daemon ya lo reusa. |

**Key insight:** el 80% de esta fase es *reusar fontanería existente en un sitio nuevo*, no construir. El único módulo genuinamente nuevo es `state-lock.js` (~40 líneas), y hasta ese es una generalización de `gsd/lock.js`.

## Runtime State Inventory

> Esta fase toca ciclo de vida de procesos y locks — no es un rename, pero SÍ crea/gestiona estado runtime. Inventario de los artefactos runtime relevantes:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/state.json` (sessions+history, schema v3) — el objeto de contención de T1 | El lock coordina la escritura; los datos NO se migran (la migración v1→v2→v3 ya existe en `state.js:190`). |
| Live service config | `~/.kodo/kodo.pid` (payload `{pid, started_at, kind:'daemon'}`), `~/.kodo/config.json` (v1→v2 migrable) | PID: guard de ownership (D-09). Config: swap a `writeFileAtomic` (D-14). |
| Lockfiles nuevos | `~/.kodo/state.json.lock` (nuevo, withStateLock), `~/.kodo/locks/dispatch-<task_id>.lock` (nuevo, dedup no-GSD), lock de `polling start` (nuevo) | Todos advisory, con steal-if-dead. Documentar sus paths. `<repo>/.planning/.kodo.lock` (GSD) ya existe. |
| OS-registered state | El daemon corre bajo launchd/`brew services` (macOS) o `kodo up` detached. `kill -9` externo posible (zombi). | El anti-PID-reuse (D-11) y el guard de ownership (D-09) protegen el ciclo de vida bajo launchd. |
| Build artifacts | Ninguno relevante. | None — verificado: cero paquetes instalados, cero egg-info/dist. |
| Worktrees | `<projectPath>/.claude/worktrees/<sid>` (real, `computeRealWorktreePath`) vs `.bg-shell/<sid>` (legacy, doctor todavía lo escanea) | **Verificar empíricamente (D-15/CONC-09)** — discrepancia viva en `doctor.js:262`. |

## Common Pitfalls

### Pitfall 1: Sostener el lock de estado a través del I/O async de reconcile
**What goes wrong:** Si `withStateLock` envuelve todo `runReconcileTick` (incluido `host.listWorkspaces()` y `pgrep`), el lock se sostiene cientos de ms/segundos por tick (cada 2.5s), serializando el host poll y disparando el TTL/steal de otros escritores.
**Why it happens:** `runReconcileTick` (`reconcile.js:308`) hace `loadState()` → I/O async del host → `saveState()` en una sola función [VERIFIED: code].
**How to avoid:** Computar el snapshot del host FUERA del lock; aplicar la derivación pura `reconcileTick(state, liveRefs, ...)` DENTRO de `withStateLock` re-leyendo el estado fresco. La derivación ya es pura y toma el estado como argumento (`reconcile.js:117`).
**Warning signs:** ticks de reconcile que tardan >100ms sosteniendo el lock; escritores de hooks que reportan `lock-timeout` justo cada 2.5s.

### Pitfall 2: El zombi NO libera el slot si solo muere el proceso (no la tab)
**What goes wrong:** El test/escenario de `kill -9` puede no liberar el slot. `deriveTarget` (`reconcile.js:97`) devuelve `'dead'` solo si `!live || !live.alive` (la TAB del workspace murió). Si matas solo el proceso Claude pero la tab cmux persiste → `process_alive:false` pero `tab_alive:true` → target `'idle'` → `applyLiveFields` deja `alive:true` (idle cuenta como vivo, `reconcile.js:257`) [VERIFIED: code]. El gate (`status==='running' && alive!==false`) **SÍ cuenta** una sesión idle con alive true.
**Why it happens:** `alive` = «la sesión sigue existiendo/atendible» (running|idle|needs-input), NO «el proceso está vivo». El slot solo se libera cuando la sesión va a `'dead'`, que requiere que la tab desaparezca.
**How to avoid:** El test de éxito (Criterio 3) debe conducir la muerte de la TAB (o simular el host devolviendo `liveRefs` sin ese `workspace_ref`), no solo `kill -9` del proceso. Documentar esta semántica en el plan — es exactamente la ambigüedad que D-05 resuelve eligiendo `alive` sobre `status`, pero el planner debe saber QUÉ dispara `alive:false`.
**Warning signs:** un test que hace `kill -9` y espera slot libre en el siguiente tick pero el gate sigue contando la sesión → probablemente la tab sigue «viva» en el fixture del host.

### Pitfall 3 (CRÍTICO): D-10 «PID post-bind» vs gap-closure 66-07 «PID pre-bind»
**What goes wrong:** Implementar D-10 literalmente (mover `writePidFile` a DESPUÉS del `await startServer`) **reintroduce el bug 66-07**: en cold-spawn, la latencia de `provider.init` dentro de `startServer` empuja la escritura del PID más allá del bounded-wait de ~2000ms de `startDaemon`, y `kodo up` reporta «failed to write PID file within 2000ms» aunque el daemon SÍ arranca [VERIFIED: code — comentario extenso en `run.js:132-145`].
**Why it happens:** El daemon escribe el PID pre-bind A PROPÓSITO porque «PID = liveness del PROCESO, no server-ready»; server-ready lo cubre `waitForHealth` de `kodo up` contra `/health` (`run.js:132`).
**How to avoid — reconciliar los dos objetivos:** El objetivo REAL de D-10 es «no dejar un `kodo.pid` mintiendo sobre un proceso que nunca escuchó». Ese objetivo YA lo cumple el fail-path actual: si `startServer` lanza (bind falla), el `catch` llama `teardown(1)` que hace `removePidFile('kodo')` (`run.js:152-166`) [VERIFIED: code] → **un boot fallido NUNCA deja un PID stale**. Es decir, el invariante de D-10 se satisface hoy por un mecanismo distinto (cleanup en fail) en vez de por ordenamiento (post-bind). **Recomendación:** el planner debe (a) reconocer esta tensión explícitamente, (b) preferir CONSERVAR el pre-bind write + reforzar que el fail-path SIEMPRE limpia (ya lo hace), documentándolo como el cumplimiento de A5; o (c) si insiste en post-bind, mover el write dentro del callback de `server.listen` (managed branch, `server.js:811`) Y subir el `_waitMs` de `startDaemon` para absorber la latencia de `provider.init`. La opción (b) es la más segura (cero regresión de 66-07). **Esto es una decisión de diseño que necesita confirmación — ver §Assumptions A1.** El legacy `kodo start` (`server.js:832`) ya es post-bind y no cambia.
**Warning signs:** tras el cambio, `kodo up` en cold-spawn (primer arranque, provider.init lento) reporta timeout; los tests de `daemon/lifecycle.test.js` de bounded-wait fallan.

### Pitfall 4: `ps -o lstart=` es locale-dependiente
**What goes wrong:** Parsear la salida de `ps -o lstart=` asumiendo formato inglés/C. En este entorno (macOS, locale es_ES) la salida verificada es `lun.  6 jul. 12:59:44 2026` (¡meses/días en español!) [VERIFIED: ejecutado esta sesión].
**Why it happens:** `lstart` usa el locale del entorno del proceso. `new Date("lun.  6 jul. ...")` SÍ parseó correctamente aquí (Node fue tolerante), pero eso NO está garantizado entre locales/versiones de Node.
**How to avoid:** (1) No confiar en `Date.parse` del string localizado como única vía. Comparar con **tolerancia generosa** (la degradación segura D-11 cubre el parse-fail: `NaN` → no matar, warn). (2) `lstart` tiene resolución de **1 segundo**, y el `started_at` del payload (ISO de `run.js`, escrito ~ms/décimas DESPUÉS del exec real) diferirá 0–2s del arranque real. Un PID reciclado difiere minutos/horas → una tolerancia de ~5–10s distingue reciclado de skew normal sin falsos abortos. (3) Considerar forzar `LC_ALL=C` en el `execFileSync` para estabilizar el formato: `execFileSync('ps', [...], {env:{...process.env, LC_ALL:'C'}})` — mitiga el locale sin depender de la tolerancia de `Date`.
**Warning signs:** el kill se aborta siempre (parse siempre falla → nunca SIGKILL → daemons que no mueren con `kodo stop`); o nunca se aborta (tolerancia demasiado amplia → no protege contra reuse).

### Pitfall 5: doctor limpia `.bg-shell` pero los worktrees reales viven en `.claude/worktrees`
**What goes wrong:** `detectOrphanWorktrees` (`doctor.js:250-268`) escanea directorios `.bg-shell/<id>` y marca huérfanos «no live session for .bg-shell dir» [VERIFIED: code]. Pero `computeRealWorktreePath` (`state.js:176`) dice que los worktrees GSD reales están en `.claude/worktrees/<sid>` [VERIFIED: code]. Si los reales están en `.claude/worktrees`, `kodo doctor --fix` nunca los limpia (escanea el dir equivocado) y podría borrar `.bg-shell` que ya no se usa.
**Why it happens:** `computeWorktreePath` (`.bg-shell`) tiene 5 consumidores acoplados y NO se tocó al añadir `computeRealWorktreePath` en Phase 50.1 (blast radius mínimo). La discrepancia quedó viva (obs. 23450).
**How to avoid:** CONC-09/D-15 pide exactamente resolver esto empíricamente. Montar sesión GSD real, `git worktree list`, y decidir si doctor/reconcile deben migrar a `computeRealWorktreePath`. Documentar el hallazgo aunque la corrección se difiera.
**Warning signs:** `kodo doctor` reporta 0 huérfanos siempre; `.claude/worktrees/` crece sin límite; `git worktree list` muestra worktrees que kodo no conoce.

### Pitfall 6: El comentario «ÚNICO escritor» derivó de `:682` a `:842`
**What goes wrong:** El planner busca en `server.js:682` (la línea que cita la auditoría) y no encuentra el comentario; está en `server.js:842`: «el proceso server — el ÚNICO escritor de state.json (el dashboard es cliente HTTP read-only...)» [VERIFIED: code — grep]. La línea `:682` hoy es la zona `/comments/:id` (read-only, sin comentario mentiroso).
**Why it happens:** El código evolucionó desde la auditoría (2026-07-03); las líneas se desplazaron.
**How to avoid:** Corregir el comentario en `server.js:842` a la verdad («N escritores coordinados por `withStateLock`») en el MISMO commit que introduce `withStateLock` (D-04). Verificar por grep, no por número de línea.

## Code Examples

### Adquirir/liberar lock advisory O_EXCL con steal-if-dead (base de la primitiva D-01)
```javascript
// Source: generalización de src/gsd/lock.js:103-220 [VERIFIED: code]
import { writeFileSync, readFileSync, unlinkSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isPidAlive } from '../gsd/lock.js';   // REUSAR, no reimplementar

function acquireLock(lockPath, { retries, backoffMs, ttlMs }) {
  const token = randomUUID();
  const content = JSON.stringify({ pid: process.pid, acquired_at: Date.now(), token });
  for (let i = 0; i <= retries; i++) {
    try {
      writeFileSync(lockPath, content, { flag: 'wx' });   // O_EXCL: falla si existe
      return { token };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Ocupado: ¿robar? (PID muerto o TTL vencido) — mismo criterio que acquireGsdLock
      try {
        const held = JSON.parse(readFileSync(lockPath, 'utf-8'));
        const stale = !isPidAlive(held.pid) || (Date.now() - held.acquired_at > ttlMs);
        if (stale) {                                   // steal vía tmp+rename (atómico, D-08)
          const tmp = lockPath + '.steal.' + process.pid + '.' + randomUUID();
          writeFileSync(tmp, content);
          renameSync(tmp, lockPath);
          return { token };
        }
      } catch { /* lock corrupto → tratar como stale en el siguiente giro */ }
      if (i < retries) Atomics.wait /* o sleep async */; // backoff corto (D-03)
    }
  }
  return null;   // retry agotado → D-03 fail-safe observable (warn + abort)
}

function releaseLock(lockPath, token) {   // idempotente: solo borra si somos dueños
  try {
    const held = JSON.parse(readFileSync(lockPath, 'utf-8'));
    if (held.token === token) unlinkSync(lockPath);
  } catch { /* ausente o corrupto: no-op */ }
}
```

### Comparar arranque real vs payload antes de SIGKILL (D-11)
```javascript
// Source: verificado ejecutando en macOS es_ES esta sesión [VERIFIED: shell]
import { execFileSync } from 'node:child_process';

function processStartMatches(pid, payloadStartedAtISO, toleranceMs = 8000) {
  let real;
  try {
    // LC_ALL=C estabiliza el formato entre locales (Pitfall 4)
    const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)],
      { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }).trim();
    real = Date.parse(out);          // ej. "Mon Jul  6 12:59:44 2026" (con LC_ALL=C)
  } catch {
    return { verifiable: false };    // ps ausente/exit≠0 → degradar seguro (no matar)
  }
  const claimed = Date.parse(payloadStartedAtISO);
  if (!Number.isFinite(real) || !Number.isFinite(claimed)) return { verifiable: false };
  // lstart tiene resolución de 1s y started_at se escribe ~ms tras el exec → tolerancia
  return { verifiable: true, match: Math.abs(real - claimed) <= toleranceMs };
}

// En stopDaemon, antes del kill(pid,'SIGKILL'):
const check = processStartMatches(payload.pid, payload.started_at);
if (check.verifiable && !check.match) {
  logger?.warn?.('daemon.sigkill.aborted', { pid: payload.pid, reason: 'pid-reuse-suspected' });
  // NO SIGKILL — el PID fue reciclado por otro proceso
} else if (!check.verifiable) {
  logger?.warn?.('daemon.sigkill.unverifiable', { pid: payload.pid }); // degradación segura: no matar
} else {
  kill(payload.pid, 'SIGKILL');   // arranque confirmado, es nuestro proceso
}
```
**Nota sobre degradación:** con `!verifiable` D-11 dice «no matar por defecto». Esto significa que si `ps` falla, `kodo stop` deja el proceso que ya recibió SIGTERM (probablemente terminando). Trade-off aceptado: preferir un daemon zombi ocasional a matar a un inocente. Documentar para que el usuario sepa por qué a veces `kodo stop` deja un proceso (log warn visible).

### Test de proceso real: dos procesos hijo compitiendo por el lock (Criterio 1)
```javascript
// Source: patrón spawn de lifecycle.js:121 + sandbox de gsd-concurrency.test.js:26 [VERIFIED: code]
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';   // sync: determinismo, sin timers flaky
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

it('dos procesos concurrentes → exactamente un {acquired:true}', () => {
  const lockDir = mkdtempSync(join(tmpdir(), 'kodo-lock-race-'));
  const lockPath = join(lockDir, 'state.json.lock');
  // Un helper .mjs que intenta acquireLock y escribe 'acquired'|'blocked' a stdout.
  // Lanzar N en paralelo con detached spawn (no spawnSync secuencial) — ver abajo.
  // Recoger stdout de cada hijo; assert exactamente 1 === 'acquired'.
  // ...
  rmSync(lockDir, { recursive: true, force: true });
});
```
**Patrón anti-flaky para races reales:** (1) sandbox por test con `mkdtempSync` (aislamiento total de FS/HOME); (2) lanzar los N hijos con `spawn` detached en el MISMO instante y esperar a todos con `Promise.all` sobre sus `close`; (3) sincronizar el arranque con una barrera (los hijos esperan la existencia de un fichero `go` que el padre crea tras spawnear todos) para maximizar la simultaneidad real; (4) assertar sobre el AGREGADO (`exactamente 1 acquired`), no sobre cuál gana (no determinista); (5) HOME/tmp aislado para no tocar `~/.kodo` real (patrón `save-state-atomic.test.js` — import dinámico POST-HOME, ver abajo).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `if (!existsSync(lock)) write` (TOCTOU) | `writeFileSync(lock, ..., {flag:'wx'})` + EEXIST | Esta fase (CONC-02) | Cierra la carrera de doble-acquire (A3). |
| `state.js` mutadores sin lock (last-write-wins) | `withStateLock(fn)` load→mutate→save | Esta fase (CONC-01) | Fin del clobber cross-proceso (T1). |
| `inFlight = new Set()` in-process | lock por `task_id` cross-proceso | Esta fase (CONC-08) | Dedup real entre procesos (M17). |
| SIGKILL a ciegas por PID | Verificar `ps -o lstart=` antes | Esta fase (CONC-05) | No matar PID reciclado (A6). |
| `migrateConfigIfNeeded` con `writeFileSync` | `writeFileAtomic` (tmp+rename) | Esta fase (CONC-07) | Config no queda truncado en crash (M16). |

**Deprecated/outdated:**
- **`computeWorktreePath` (`.bg-shell`)**: coexiste con `computeRealWorktreePath` (`.claude/worktrees`); CONC-09 debe determinar cuál es el vivo y si doctor/reconcile deben migrar.
- **Comentario «ÚNICO escritor» (`server.js:842`)**: obsoleto — hay N escritores coordinados por lock (T1).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El objetivo de D-10 (post-bind) se cumple mejor CONSERVANDO el pre-bind write + el cleanup del fail-path (`teardown(1)` ya borra el PID si el bind falla), en vez de mover el write post-bind y regresionar 66-07. | Pitfall 3 | **ALTO** — implementar post-bind literal reintroduce el timeout de `kodo up` en cold-spawn. El planner debe confirmar la interpretación con el operador o preferir la opción segura (b). |
| A2 | El test de zombi (Criterio 3) debe simular muerte de la TAB (host sin ese `workspace_ref`), no solo `kill -9` del proceso, para que reconcile derive `alive:false`. | Pitfall 2 | MEDIO — un test que solo mata el proceso podría pasar/fallar espuriamente; el criterio de éxito se malinterpretaría. |
| A3 | Tolerancia de ~5–10s para el skew `ps lstart` vs `started_at`; `LC_ALL=C` para estabilizar el parseo. Los valores exactos son discreción del planner (CONTEXT lo marca así). | Pitfall 4, Code Examples | BAJO/MEDIO — tolerancia mal calibrada → falsos abortos de SIGKILL (daemon no muere) o falsos positivos (no protege). Ajustable. |
| A4 | El dedup no-GSD (D-13) usa un lockfile por `task_id` en `~/.kodo/locks/` (path exacto discrecional). | Pattern 8 | BAJO — el path es discreción; el mecanismo (lock por task_id con la primitiva) es la decisión locked. |
| A5 | Los ~6 escritores de `state.json` = los 3 mutadores de `state.js` + el saveState de reconcile (funnel completo verificado por grep). «~6» de la auditoría cuenta call-sites lógicos, no funciones. | Pattern 1 | BAJO — verificado por grep; si aparece un `saveState` directo fuera de esos 4 puntos, el planner debe envolverlo también. |
| A6 | `doctor.js` escanea `.bg-shell` mientras los worktrees reales están en `.claude/worktrees` — discrepancia viva. La verificación empírica (D-15) lo confirmará. | Pitfall 5 | MEDIO — si resulta que `.bg-shell` SÍ es el vivo, la corrección de CONC-09 es la inversa. Por eso D-15 exige verificación empírica, no inferencia. |

## Open Questions

1. **¿Post-bind literal o conservar pre-bind + cleanup? (D-10)**
   - What we know: el pre-bind write es deliberado (66-07); el fail-path ya limpia el PID.
   - What's unclear: si el operador quiere el ordenamiento post-bind estricto o el invariante «no PID mentiroso» (que ya se cumple).
   - Recommendation: preferir conservar pre-bind + documentar el cleanup como cumplimiento de A5; confirmar con el operador en discuss/plan. **Bloquea el diseño de CONC-04.**

2. **¿Qué dispara `alive:false` en el test de zombi? (D-05)**
   - What we know: `alive:false` requiere `state:'dead'`, que requiere que la tab del host desaparezca.
   - What's unclear: si el escenario real de «zombi» del operador incluye la muerte de la tab o solo del proceso.
   - Recommendation: el test debe conducir el fixture del host (`listWorkspaces` sin el ref); documentar la semántica. Si el operador espera liberar el slot con solo matar el proceso, se necesita un cambio adicional (fuera del scope actual de D-05).

3. **Path y granularidad de los lockfiles nuevos.**
   - What we know: `state.json.lock` (uno global), dedup por `task_id` (uno por tarea), `polling start` (uno).
   - What's unclear: si el state lock debe ser uno global o por-sección (no; el estado es un solo fichero → un solo lock global es correcto).
   - Recommendation: un lock global para `state.json` (`~/.kodo/state.json.lock`); locks por-task para dedup en `~/.kodo/locks/`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node:fs` `O_EXCL`/`flag:'wx'` | Toda la fase (locks) | ✓ | built-in | — |
| `/bin/ps` con `-o lstart=` | CONC-05 (anti-PID-reuse) | ✓ | macOS BSD ps | Degradación segura D-11: no matar, warn |
| `pgrep` | reconcile `isSessionProcessAlive` (ya en uso) | ✓ | macOS | fail-safe→muerto (`reconcile.js:287`) |
| `process.kill(pid, 0)` | `isPidAlive` | ✓ | node core | — |
| `node:test` runner | Tests de la fase | ✓ | node ≥18 | — |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** `ps` — si estuviera ausente, CONC-05 degrada a «no SIGKILL + warn» (D-11). Verificado presente en `/bin/ps` esta sesión.

## Validation Architecture

> `nyquist_validation: true` en config.json. Los tests de concurrencia lanzan **procesos reales** («tocar locks exige tests de proceso real» — ROADMAP).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in) |
| Config file | none — `package.json` script: `node --test $(find test -name '*.test.js' -type f)` [VERIFIED: code] |
| Quick run command | `node --test test/state/state-lock.test.js test/gsd-lock.test.js` (los archivos tocados) |
| Full suite command | `npm test` (1843 pass + 1 skip baseline tras Phase 69) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONC-02 | 2 procesos concurrentes → exactamente un `{acquired:true}` (acquireGsdLock `wx`) | integration (real child procs) | `node --test test/gsd-lock-race.test.js` | ❌ Wave 0 |
| CONC-06 | 2 `polling start` concurrentes → un solo daemon | integration (real spawn) | `node --test test/daemon/polling-start-race.test.js` | ❌ Wave 0 |
| CONC-01 | ~6 escritores bajo `withStateLock` sin escrituras perdidas; comentario `:842` corregido | integration (N child writers) + source-grep | `node --test test/state/state-lock-concurrency.test.js` | ❌ Wave 0 |
| CONC-01 | `withStateLock` load→mutate→save + finally-release + retry-exhaustion (D-03) | unit | `node --test test/state/state-lock.test.js` | ❌ Wave 0 |
| CONC-03 | zombi (tab muerta) → reconcile `alive:false` → gate libera slot | unit (fixture host) | `node --test test/session/max-parallel-alive.test.js` | ❌ Wave 0 (extender `manager.test.js`) |
| CONC-04 | teardown borra PID solo si `payload.pid===process.pid`; PID no-mentiroso si bind falla | unit (DI en run.js) | `node --test test/daemon/run.test.js` | ✅ (extender) |
| CONC-05 | `ps -o lstart=` mismatch → SIGKILL abortado; `ps` ausente → no matar + warn | unit (DI `_kill`/mock ps) | `node --test test/daemon/lifecycle.test.js` | ✅ (extender) |
| CONC-07 | migración v1→v2 vía `writeFileAtomic` (no residuo `.tmp`, no truncado) | unit (HOME-isolated) | `node --test test/config-migration-atomic.test.js` | ❌ Wave 0 (patrón `save-state-atomic.test.js`) |
| CONC-08 | 2 procesos despachan misma tarea no-GSD → un solo dispatch (lock por task_id) | integration (real procs) | `node --test test/dispatcher-dedup-crossproc.test.js` | ❌ Wave 0 |
| CONC-09 | ubicación real de worktrees verificada + documentada | manual (sesión GSD viva) + source-grep | verificación empírica; test de source si se corrige doctor | ❌ manual (D-15) |

### Sampling Rate
- **Per task commit:** `node --test` sobre el/los archivo(s) de test tocados por la tarea (<30s).
- **Per wave merge:** `npm test` completo (suite 1843+).
- **Phase gate:** suite verde antes de `/gsd-verify-work`; ningún test flaky en 3 corridas de los tests de race.

### Wave 0 Gaps
- [ ] `test/state/state-lock.test.js` — unit de la primitiva (acquire/release/steal/retry-exhaustion/finally) — CONC-01
- [ ] `test/state/state-lock-concurrency.test.js` — N escritores reales, sin pérdida — CONC-01
- [ ] `test/gsd-lock-race.test.js` — 2 procesos, un solo acquired (Criterio 1) — CONC-02
- [ ] `test/daemon/polling-start-race.test.js` — 2 polling start, un daemon — CONC-06
- [ ] `test/dispatcher-dedup-crossproc.test.js` — dedup no-GSD cross-proceso — CONC-08
- [ ] `test/config-migration-atomic.test.js` — migración atómica (HOME-isolated) — CONC-07
- [ ] Helpers de test: un `.mjs` que hace `acquireLock` y reporta a stdout (para los tests de spawn real); barrera de sincronización de arranque (fichero `go`) para maximizar simultaneidad; scaffold HOME-isolated con import dinámico POST-HOME (patrón `save-state-atomic.test.js:1-30`).
- [ ] Extender `test/daemon/run.test.js` (CONC-04) y `test/daemon/lifecycle.test.js` (CONC-05) — ya existen.

*Framework ya instalado; no hay gap de instalación.*

## Security Domain

> `security_enforcement` ausente en config = habilitado. Esta fase es hardening de concurrencia; las categorías ASVS relevantes son las de **race conditions y control de procesos**, no las de red (cubiertas en Phase 69).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1/V11 Business Logic & Concurrency (TOCTOU) | **yes** | Lock atómico `O_EXCL`; re-lectura bajo lock; sin check-then-act |
| V5 Input Validation | no (nuevo) | `sessionId`/paths ya validados en Phase 69 (NET-05); esta fase no añade superficie de input externo |
| V6 Cryptography | no | Sin cripto; `randomUUID` solo para unicidad de tmp/token, no seguridad |
| V12/V14 File & Resources | **yes** | tmp+rename atómico (0600 en PID via `polling-daemon.js:99`); lockfiles advisory; no symlink-follow (realpathSync) |
| V10 Malicious Code / Process integrity | **yes** | Anti-PID-reuse antes de SIGKILL (no matar proceso ajeno); ownership del PID file |

### Known Threat Patterns for {node multiprocess + macOS daemon}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| TOCTOU en creación de lock (doble-acquire) | Tampering / Elevation | `writeFileSync({flag:'wx'})` atómico; EEXIST→read-existing (CONC-02) |
| Escritura concurrente perdida a `state.json` | Tampering | `withStateLock` re-lee bajo lock (CONC-01) |
| PID reuse → SIGKILL a proceso inocente (local DoS) | Denial of Service | Verificar `ps -o lstart=` == `started_at` antes de matar (CONC-05) |
| Un arranque borra el PID de un daemon vivo ajeno | Denial of Service | teardown borra solo si `payload.pid===process.pid` (CONC-04) |
| Lock huérfano tras `kill -9` bloquea a todos | Denial of Service | steal-if-dead (`isPidAlive`) + TTL (D-03) |
| PID file truncado/config truncado en crash | Tampering / Integrity | tmp+rename atómico (writeFileAtomic, saveState) |
| Symlink en el path del lock (`/tmp`→`/private/tmp`) | Tampering | `realpathSync` colapsa symlinks (`lock.js:180`, ya presente) |

## Sources

### Primary (HIGH confidence) — código real leído esta sesión
- `src/gsd/lock.js` (acquireGsdLock/writeLockFile/stealLock/isPidAlive/readLock/releaseGsdLock) — patrón lockfile+TTL a generalizar
- `src/session/state.js` (saveState atómico, addSession/updateSession/removeSession, migraciones, computeWorktreePath/computeRealWorktreePath)
- `src/session/reconcile.js` (reconcileTick puro, deriveTarget, applyLiveFields, runReconcileTick, único escritor de `alive`)
- `src/session/manager.js:178` (gate max_parallel) + `:384` (markSessionStatus→updateSession)
- `src/config.js:100-165` (writeFileAtomic, migrateConfigIfNeeded)
- `src/daemon/run.js` (writePidFile pre-bind + teardown + fail-path cleanup) y `src/daemon/lifecycle.js` (startDaemon pre-flight TOCTOU, stopDaemon SIGTERM→SIGKILL)
- `src/cli/polling-daemon.js` (writePidFile/readPidFile shape-check, payload {pid,started_at,kind})
- `src/cli/stop-status.js` (runStopUnified→stopDaemon) y `src/gsd/doctor.js:223-268` (decideLock mirror, detectOrphanWorktrees .bg-shell)
- `src/server.js:660-870` (zona /comments, listen managed post-bind, comentario "ÚNICO escritor" en :842)
- `src/triggers/dispatcher.js:15,100-239` (inFlight Set in-process, lock GSD solo para gsdMode)
- `test/gsd-concurrency.test.js`, `test/state/save-state-atomic.test.js` (patrones de test: sandbox mkdtemp, DI, HOME-isolation)
- Verificación shell: `ps -o lstart= -p <pid>` en macOS es_ES → `lun.  6 jul. 12:59:44 2026` (locale-dependiente; `Date.parse` toleró)

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` (invariantes: cero deps npm, único escritor de alive=reconcileTick, status=outcome/alive=liveness)
- obs. claude-mem 24815 (10 concurrent writers), 23450 (worktree path discrepancy), 24409 (cold-spawn PID timeout 66-07)

### Tertiary (LOW confidence)
- Ninguna. Todo verificado contra código o ejecución directa; sin claims de solo-web.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps; todas las primitivas son node built-in ya en uso, verificadas por lectura.
- Architecture: HIGH — cada patrón anclado a `file:line` real; los dos hallazgos críticos (post-bind, tab-alive) derivados de leer el código, no inferidos.
- Pitfalls: HIGH — Pitfall 3 (post-bind) y 4 (locale) verificados directamente (comentario 66-07 en código, `ps` ejecutado); Pitfall 5 (doctor .bg-shell) confirmado por grep.
- Validation: HIGH — framework y patrones de test existentes leídos; gaps enumerados contra archivos reales.

**Research date:** 2026-07-06
**Valid until:** 2026-08-05 (estable — código propio, sin dependencias externas de versión volátil; re-verificar si `daemon/run.js` o `state.js` cambian antes de planificar).
