# Phase 70: Concurrencia y ciclo de vida de procesos - Context

**Gathered:** 2026-07-06
**Mode:** --auto (decisiones auto-seleccionadas con la opción recomendada; auditables en `70-DISCUSSION-LOG.md`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Hacer segura la concurrencia multiproceso de kodo y sanear el ciclo de vida de sus procesos (Ola 2 de v0.16 Hardening, causas raíz T1 «state.json multiproceso sin lock» y T2 «status vs state»). Cubre: un `withStateLock(fn)` advisory (lockfile `O_EXCL` + retry, re-lee→muta→guarda) envolviendo los ~6 escritores de `state.json`; `acquireGsdLock` atómico (`flag:'wx'`); el puente state→status para que un zombi libere su slot de `max_parallel`; PID ownership seguro (teardown solo borra su propio PID, escritura post-bind, verificación de `started_at` antes de SIGKILL); lock en `polling start`; migración de config v1→v2 atómica; dedup no-GSD cross-proceso; y verificación empírica de la ubicación real de los worktrees. Requirements: CONC-01..09.

Fuera del boundary: la superficie de red/auth (Fase 69, ya completa); fiabilidad de entrega y backstop del ciclo de vida (Fase 71, A7/M10/M11/T5); higiene/DX/config hardening y pasada de README (Fase 72). **Explícitamente fuera** (Key context de PROJECT.md): el rediseño «un solo escritor de estado vía HTTP» — el lockfile cubre el riesgo a ~1/20 del coste; no se reescriben hooks/CLI/doctor para mover toda mutación al server.

</domain>

<decisions>
## Implementation Decisions

### Primitiva `withStateLock` — diseño y ubicación
- **D-01:** Se crea **una primitiva de lock advisory reutilizable** (lockfile `O_EXCL` + retry corto con backoff) como módulo pequeño y puro (p. ej. `src/session/state-lock.js` o `src/util/file-lock.js`, lo que case con el layout). Es la MISMA primitiva que consumen `withStateLock` (CONC-01), el lock de `polling start` (CONC-06/M20) y el dedup no-GSD por `task_id` (CONC-08/M17). No se duplica la lógica de lockfile en tres sitios.
- **D-02:** La firma es `withStateLock(fn)` donde `fn` recibe el estado ya re-leído bajo el lock y devuelve el estado a guardar — el patrón **load→mutate→save atómico**: adquirir lock → `loadState()` fresco → `fn(state)` → `saveState()` → liberar en `finally`. Esto evita el clobber por last-write-wins que hoy sufren los ~6 escritores (`addSession`/`removeSession`/`updateSession`/reconcile/adopt/server), que hacen `loadState()` fuera de cualquier lock y se pisan entre procesos. El `saveState` actual (tmp+rename atómico, `state.js:242`) se conserva como paso de escritura **dentro** del lock; no se toca su atomicidad de bytes.
- **D-03:** Al **no poder adquirir** el lock tras agotar el retry (otro proceso lo tiene), el comportamiento es **fail-safe observable**: se registra un warn NDJSON y la mutación se aborta sin corromper (el lockfile es advisory, no bloqueante indefinido). El retry es corto (orden de ~decenas de ms × pocos intentos) porque los escritores de state.json son operaciones rápidas. El lockfile guarda `{pid, acquired_at}` y se roba si el PID está muerto o supera un TTL corto — mismo criterio de liveness que `acquireGsdLock` (`isPidAlive` + TTL), para no colgarse tras un `kill -9`.
- **D-04:** El comentario falso **"ÚNICO escritor"** asociado al carril `/comments/:id` (zona de `server.js:~682`, la auditoría A2 lo cita como `server.js:682`) se corrige en el MISMO commit que introduce `withStateLock`. Los comentarios que afirman invariantes falsas son deuda activa; el planner debe localizar el comentario real (la línea puede haber derivado) y reemplazarlo por la verdad («N escritores coordinados por `withStateLock`»).

### Puente zombi → slot de `max_parallel` (A4 — la fuga de capacidad más dañina)
- **D-05:** El gate de `max_parallel` (`src/session/manager.js:178`, hoy `listSessions().filter(s => s.status === 'running')`) pasa a **filtrar también por liveness**: cuenta solo sesiones con `status === 'running'` **y** `alive !== false`. Un zombi (`kill -9`) que reconcile ya marcó `alive:false` deja de ocupar slot en el siguiente `launchWorkItem`. Se elige filtrar en el gate por `alive` (opción recomendada de la auditoría) en vez de que reconcile derive `status:'idle'`, porque **`alive` es el campo de liveness cuyo único escritor es `reconcileTick`** (invariante v0.9/v0.10) mientras que `status` es el campo de *outcome* (redefinido en v0.10); escribir `status` desde reconcile violaría esa separación semántica. El gate lee, no escribe — respeta el «único escritor de `alive`».
- **D-06:** La corrección es puramente en el filtro del gate; no se añade un nuevo campo ni se toca la máquina de estados de reconcile. Test de éxito (de la auditoría): matar (`kill -9`) una sesión → verificar que reconcile marca `alive:false` en el siguiente tick y que el gate vuelve a ofrecer el slot liberado.
- **D-06b [AÑADIDO tras research — Pitfall 2]:** `alive` se deriva de la liveness del **workspace/tab** de cmux (`reconcileTick`), no del PID del proceso Claude. Un `kill -9` que mata solo el proceso pero deja la tab viva produce `state` derivado con `alive:true` → el gate lo seguiría contando. Por tanto el test del Criterio 3 **debe conducir la muerte de la TAB del workspace** (o mockear `host.listWorkspaces()` para que el ref deje de reportar `alive:true`), no solo `kill -9` al proceso. El planner debe diseñar el test de zombi contra la señal real que dispara `alive:false` (tab muerta / workspace ausente en `listWorkspaces`), documentándolo explícitamente.

### `acquireGsdLock` atómico (A3)
- **D-07:** `writeLockFile` (`src/gsd/lock.js:191`) pasa a escribir con **`writeFileSync(lockPath, content, {flag:'wx'})`** (`O_EXCL`). En `acquireGsdLock` (`lock.js:103`) se elimina el TOCTOU del **Caso 1** actual (`if (!existsSync(lockPath)) writeLockFile(...)`): dos procesos que ven el fichero ausente hoy escriben ambos y ambos obtienen `{acquired:true}`. Con `wx`, el `EEXIST` del segundo cae al camino de leer el lock existente y aplicar la lógica ya presente de PID-muerto/TTL/steal/reject. Los Casos 2–5 (steal por PID muerto, TTL, corrupto; reject por PID vivo+TTL OK) se conservan intactos.
- **D-08:** `stealLock` (`lock.js:216`) — que hoy hace `writeFileSync` directo sobre el lock existente — pasa a **tmp+rename** para que el reemplazo del contenido del lock sea atómico (no haya lectura de un lock a medio escribir). El robo sigue siendo la decisión ya tomada por el caller (PID muerto / TTL), solo se endurece la escritura.

### PID ownership + seguridad del SIGKILL (A5, A6)
- **D-09:** `teardown` solo borra `~/.kodo/kodo.pid` si `payload.pid === process.pid` (**el proceso solo borra su propio PID file**). Un proceso que no es el dueño del PID file no lo toca — evita que un arranque nuevo borre el PID de un daemon vivo distinto. El daemon sigue siendo el único dueño de `kodo.pid` (D-04 de v0.15, `server.js:800/817`).
- **D-10:** ~~El PID se escribe **post-bind**~~ **[REVISADO 2026-07-06 tras research — Pitfall 3]:** Se **conserva la escritura pre-bind** de `writePidFile` (`daemon/run.js:142`). La gap-closure **66-07** movió deliberadamente el PID a pre-bind para que `kodo up` no diera timeout esperando el `kodo.pid` en el cold-spawn; mover a post-bind **regresaría ese fix ya lanzado**. El objetivo original de D-10 (no dejar un `kodo.pid` mintiendo si el bind falla) **ya está cubierto** por el `teardown(1)` del fail-path (`run.js:152-166`), que borra el PID cuando el arranque aborta. Acción del planner: **NO tocar el orden pre-bind**; documentar (comentario) que el cleanup del PID en fallo de bind lo garantiza el teardown, no la posición de la escritura. El endurecimiento real de A5 vive en D-09 (ownership por `payload.pid === process.pid`) y D-11 (verificación de `started_at` antes de SIGKILL), que **no** dependen de post-bind.
- **D-11:** Antes de un **SIGKILL** en `stop`/`stopDaemon`, se compara el `started_at` del payload del PID file con el arranque real del proceso vía **`ps -o lstart= -p <pid>`**; si no cuadran (PID reciclado por otro proceso), **se aborta el kill** en vez de matar a un inocente. Esto es defensa contra reciclado de PID entre el SIGTERM y el fallback SIGKILL. La comparación es macOS-first (kodo es macOS-primary; Homebrew/launchd); si `ps` no está disponible o el formato no parsea, se degrada de forma segura (no matar por defecto, log warn) — never-throws coherente con el resto del CLI.

### Reuso de la primitiva: polling start (M20) y dedup no-GSD (M17)
- **D-12:** `polling start` adquiere el lock `O_EXCL` de D-01 antes de arrancar el daemon: dos `polling start` concurrentes → un solo daemon (el segundo ve `EEXIST`, reporta «ya arrancando/arrancado» y sale limpio). Reusa la primitiva, no una nueva.
- **D-13:** El dedup de sesiones **no-GSD** (hoy in-process) se hace cross-proceso con un lock por `task_id` usando la misma primitiva — cierra la ventana en la que dos procesos despachan la misma tarea no-GSD casi a la vez. Espejo del lock per-repo que ya protege el carril GSD (`acquireGsdLock`, GSD-10).

### Migración de config v1→v2 atómica (M16)
- **D-14:** `migrateConfigIfNeeded` (`src/config.js:146`) persiste el resultado migrado vía **`writeFileAtomic`** (tmp+rename, la fontanería de v0.14 ya usada por `saveConfig`/`saveState`), no un `writeFileSync` directo — un crash a mitad de migración no puede dejar un `config.json` truncado/corrupto. Consistente con el patrón atómico ya establecido en todo el proyecto.

### Verificación empírica de worktrees (M13 / CONC-09)
- **D-15:** La ubicación **real** de los worktrees de una sesión GSD viva se verifica **empíricamente** (no por inferencia): arrancar/observar una sesión GSD real y confirmar dónde caen los worktrees respecto a `computeRealWorktreePath` (helper de Phase 50.1) frente a lo que asumen reconcile/doctor/plan-reader. El hallazgo se **documenta** (comentario en el código y/o nota en STATE.md/README según corresponda) y, si hay discrepancia, se corrige la ruta. Cierra la deuda M13 arrastrada desde v0.12 (obs. 23450 «Worktree Path Discrepancy in computeWorktreePath»). Esta sub-tarea puede requerir una sesión GSD viva; si en el cierre no puede montarse, se difiere la verificación humana igual que se hizo con el display de progreso 50.1 — pero el análisis del código sí se entrega.

### Claude's Discretion
- Nombre y ubicación exactos del módulo de la primitiva de lock (`state-lock.js` vs `util/file-lock.js`) y si `withStateLock` es un wrapper fino sobre esa primitiva o vive junto a `saveState` en `state.js`.
- Parámetros exactos del retry/backoff y del TTL del lockfile de estado (mientras el retry sea corto y el robo respete liveness por PID).
- Cómo se estructura el filtro del gate (`alive !== false` inline vs helper `isSchedulable(s)`).
- Formato exacto de parseo de `ps -o lstart=` y el margen de tolerancia al comparar `started_at` (segundos de skew aceptable).
- Ubicación y estilo de los tests (la suite usa `node:test`, 1843 pass + 1 skip en v0.16 Phase 69 — seguir el patrón; los tests de concurrencia lanzan procesos reales / hijos, ver «éxito» de la auditoría).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auditoría (fuente de los hallazgos que esta fase cierra)
- `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` §«Ola 2 — Concurrencia y ciclo de vida de procesos» — plan acordado por hallazgo (A2, A3, A4, A5, A6, M16, M17, M20) con las anclas de código; las decisiones de arriba lo desarrollan, no lo contradicen. Incluye el criterio de éxito (2 procesos concurrentes → un solo `{acquired:true}`; test de zombi que libera slot).
- `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` — detalle original de cada hallazgo (leer A2–A6, M16, M17, M20 para el razonamiento completo, incl. T1/T2 como causas raíz).

### Requirements y roadmap
- `.planning/REQUIREMENTS.md` §«Concurrencia y ciclo de vida de procesos (Ola 2 — causas raíz T1, T2)» — CONC-01..09 normativos.
- `.planning/ROADMAP.md` §«Phase 70» — one-liner de scope (Ola 2, «la más delicada»).
- `.planning/PROJECT.md` §«Current Milestone: v0.16 Hardening» → Ola 2 + «Fuera de alcance explícito» (no reescribir a un solo escritor vía HTTP).

### Fontanería reusada (referencia viva = código)
- `src/gsd/lock.js` — `acquireGsdLock`/`stealLock`/`writeLockFile`/`readLock`, `isPidAlive`, TTL: patrón de lockfile + liveness que la primitiva nueva generaliza (A3 endurece este mismo fichero).
- `src/session/state.js` — `saveState` (tmp+rename atómico, `:242`), `loadState`, los escritores `addSession`/`removeSession`/`updateSession` que `withStateLock` envuelve.
- `src/session/reconcile.js` — `reconcileTick` (único escritor de `alive`; deriva `state:'dead'` en `:98`) y `runReconcileTick` (`:308`); base del puente A4.
- `src/session/manager.js:178` — gate de `max_parallel` a corregir (A4).
- `src/config.js:146` — `migrateConfigIfNeeded` a hacer atómico (M16); `writeFileAtomic` (fontanería v0.14) como reuso.
- `src/cli/polling-daemon.js` / `src/cli/stop-status.js` / `src/cli.js` — ciclo de vida del PID (`kodo.pid`, SIGTERM→5s→SIGKILL) para A5/A6.
- `src/gsd/doctor.js:223` (`decideLock`) — espejo EXACTO de `acquireGsdLock` (D-13 histórico): si cambia la semántica del lock GSD, este espejo debe seguir cuadrando.
- `computeRealWorktreePath` (Phase 50.1) — helper de ubicación de worktrees; eje de M13/CONC-09.

</canonical_refs>

<code_context>
## Existing Code Insights

### Anclas verificadas (2026-07-06, código actual)
- `src/session/state.js:242` — `saveState` ya es tmp+rename atómico (WR-02, tmp único por pid+UUID), PERO los escritores (`addSession:264`, `removeSession:278`, `updateSession:305`, adopt, server, reconcile) hacen `loadState()`→mutar→`saveState()` **sin lock** → clobber cross-proceso (T1). `withStateLock` cierra esto.
- `src/gsd/lock.js:103` — `acquireGsdLock` Caso 1: `if (!existsSync(lockPath)) writeLockFile(...)` = TOCTOU; dos procesos ganan a la vez. Fix: `flag:'wx'` en `writeLockFile:202` + `EEXIST`→camino de lectura existente.
- `src/gsd/lock.js:216` — `stealLock` hace `writeFileSync` directo → cambiar a tmp+rename.
- `src/session/manager.js:178` — `filter(s => s.status === 'running')` cuenta zombis; añadir `&& s.alive !== false`.
- `src/session/reconcile.js:98` — `if (!live || !live.alive) return 'dead'`; `reconcileTick` es el único escritor de `alive` (`:257`).
- `src/config.js:146` — `migrateConfigIfNeeded`; usar `writeFileAtomic` para persistir.
- `src/server.js` — zona `~682` (carril `/comments/:id`): comentario mentiroso «ÚNICO escritor» a corregir; `~800/817/866/893` PID ownership + SIGTERM.
- Obs. `claude-mem` 24815 (2026-07-03): «10 concurrent writers contradict single writer claim» — confirma T1 empíricamente.

### Reusable Assets
- Patrón lockfile + `isPidAlive` + TTL de `src/gsd/lock.js` — generalizar a la primitiva compartida (D-01).
- `saveState` / `writeFileAtomic` (tmp+rename) — escritura atómica ya probada; el lock coordina el load→mutate→save, la atomicidad de bytes ya existe.
- `computeRealWorktreePath` (Phase 50.1) — para M13/CONC-09.

### Established Patterns
- **Único escritor de `alive` = `reconcileTick`** (invariante v0.9/v0.10) — el gate de A4 debe LEER `alive`, nunca escribirlo desde otro sitio.
- **`status` = outcome, `state`/`alive` = liveness** (redefinición v0.10, saldó WARNING-02/D-09) — no mezclar; A4 se resuelve en la capa de liveness.
- **never-throws / degradación visible** — el fail de lock (D-03) y el `ps` ausente (D-11) degradan con warn, no con throw.
- Suite `node:test` (1843 pass + 1 skip tras Fase 69) — tests de concurrencia lanzan procesos/hijos reales.

### Integration Points
- Nuevo módulo de primitiva de lock; `src/session/state.js` (`withStateLock` + envolver escritores); `src/gsd/lock.js` (`wx` + `stealLock` tmp+rename); `src/session/manager.js` (gate `alive`); `src/config.js` (migración atómica); `src/triggers/polling.js` + daemon (lock de arranque); carril no-GSD del dispatcher (dedup por `task_id`); ciclo de vida del PID en CLI (`stop-status.js`, `polling-daemon.js`, `server.js`).

</code_context>

<specifics>
## Specific Ideas

- La propuesta de auditoría fija literalmente: `withStateLock(fn)` lockfile `O_EXCL`+retry re-lee→muta→guarda envolviendo los ~6 escritores; `writeFileSync(path, content, {flag:'wx'})` + `EEXIST`→tomado; `stealLock` vía tmp+rename; puente `state:'dead'`→libera slot (reconcile deriva `status:'idle'` **o** el gate filtra por `alive` — aquí se elige el gate por `alive`, D-05); `teardown` borra `kodo.pid` solo si `payload.pid===process.pid`, PID escrito post-bind; `ps -o lstart=` antes de SIGKILL; lock `O_EXCL` en `polling start`; `migrateConfigIfNeeded` vía `writeFileAtomic`; dedup no-GSD por `task_id`.
- Criterios de éxito verificables: (1) test que lanza 2 procesos concurrentes contra el mismo repo → exactamente un `{acquired:true}`; (2) test de zombi (`kill -9` a una sesión) → reconcile libera el slot de `max_parallel` en el siguiente tick.

</specifics>

<deferred>
## Deferred Ideas

- Rediseño «un solo escritor de estado vía HTTP contra el server» — **fuera de alcance explícito** de v0.16 (PROJECT.md): el lockfile cubre el riesgo a ~1/20 del coste. No reescribir hooks/CLI/doctor en esta fase.
- M21 «medir antes de arreglar» y M7–M9 — diferidos por PROJECT.md (solo si sobra hueco; no es esta fase).
- Verificación **humana** de la ubicación de worktrees en una sesión GSD viva (M13) — si en el cierre no puede montarse una sesión GSD real, se difiere la firma humana (mismo patrón que el display de progreso 50.1), entregando igualmente el análisis del código.

None fuera de lo anterior — la discusión se mantuvo dentro del scope de la Ola 2.

</deferred>

---

*Phase: 70-Concurrencia y ciclo de vida de procesos*
*Context gathered: 2026-07-06*
