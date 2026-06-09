# Phase 41: Doctor — módulo puro de saneo + CLI - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Un módulo puro `src/gsd/doctor.js` (espejo de `reconcile.js`: **puro + DI + never-throws**) que **detecta** (dry-run por defecto) y **sanea** (`--fix`) las 4 categorías de basura del ciclo de vida de sesiones, sin tocar JAMÁS recursos vivos, expuesto vía el subcomando `kodo gsd doctor` y exportando un helper reusable que el dismiss de Phase 42 consumirá — una sola fuente de saneo.

**Las 4 categorías de basura (DOCTOR-01):**
1. **Worktrees huérfanos** — dirs `.bg-shell/<sessionId>` sin sesión viva (`computeWorktreePath` en `state.js:153`).
2. **Sesiones zombie** — entradas en `state.json` con `alive===false`.
3. **Locks per-repo colgados** — `.planning/.kodo.lock` con PID muerto o TTL excedido.
4. **Logs NDJSON antiguos** — `~/.kodo/logs/<sessionId>.ndjson` con `mtime > 7d`.

**En scope (Phase 41):**
- Módulo `src/gsd/doctor.js` puro + DI + never-throws con API `scan()` + `execute()` — DOCTOR-04
- Detección dry-run agrupada por categoría + exit code 0/1 — DOCTOR-01, DOCTOR-03
- Saneo `--fix` con re-check liveness por acción, `git worktree remove/prune` (nunca `rm -rf`), reuso de helpers de `lock.js`/`stop.js` — DOCTOR-02
- Subcomando CLI `kodo gsd doctor` (`--fix`, `--json`)
- Helper reusable por taskId que Phase 42 (dismiss) consumirá

**Fuera de scope (otras fases):**
- La tecla `d` / TUI read-write / `DELETE /sessions/{id}` amplificado → **Phase 42** (DISMISS-01..04). Phase 41 sólo deja el módulo listo para que dismiss lo invoque.
- Cualquier acoplamiento del saneo a `alive`/lifecycle como escritor: `reconcileTick` sigue siendo el ÚNICO escritor de `alive`. doctor sólo borra/mueve recursos huérfanos y quita entradas muertas de `state.json` vía `removeSession`.

</domain>

<decisions>
## Implementation Decisions

### Superficie CLI (DOCTOR-01, DOCTOR-03)
- **D-01:** **`--json` sí.** `kodo gsd doctor` expone `--json` byte-determinista para scripting, consistente con TODOS los demás subcomandos (`inspect`/`verify`/`polling`/`skill`). Output human-readable por defecto. Sigue el patrón de registro del subcomando en `src/cli.js` (lazy import del handler, `process.exit(code)`).
- **D-02:** **Siempre las 4 categorías juntas, sin flags por-categoría.** El CLi reporta/sanea worktrees+zombies+locks+logs en bloque. El acotado fino (por `taskId`) vive en la API del módulo para Phase 42, NO en flags CLI. YAGNI: nada de `--worktrees/--locks/--logs/--zombies` hasta que un operador lo pida (capturado en Deferred).
- **D-03:** **Sin `--dry-run` explícito.** Sin flags = dry-run (DOCTOR-01); `--fix` es el ÚNICO opt-in a mutar. Modelo mental: "`doctor` mira, `doctor --fix` arregla". Un `--dry-run` redundante añadiría superficie sin valor.

### Forma del módulo reusable (DOCTOR-04 → dependencia dura de Phase 42)
- **D-04:** **`scan()` + `execute()` separados** (NO una función única con flag `apply`). `scan(deps)` = detección PURA que devuelve el reporte estructurado (alimenta dry-run + `--json` + futuro consumo del dashboard). `execute(deps, opts)` = ejecuta el saneo. Espeja el par dry-run/fix y el split `reconcileTick` (puro) / `runReconcileTick` (I/O) de `reconcile.js`. Returns con tipos distintos y limpios (reporte vs resultado-de-saneo).
- **D-05:** **`execute({taskId})` acota a worktree + lock + entrada de `state.json` de ESA sesión.** Es exactamente lo que la tecla `d` de Phase 42 necesita: descartar UNA sesión dead → limpiar su worktree `.bg-shell/<id>`, su lock si está colgado, y quitarla de `state.json` (la "zombie" de ESE id). **Los logs quedan FUERA del dismiss por-tarea** — son retención global (D-12), no parte de descartar una fila. Sin `taskId`, `execute()` barre las 4 categorías globalmente (modo CLI).
- **D-06:** **`execute()` re-detecta internamente + re-chequea liveness JUSTO antes de cada acción destructiva** (`isPidAlive` + `alive`), cumpliendo DOCTOR-02 / SC#2. **NO consume el reporte de `scan()` como plan** — actuar sobre un snapshot stale arriesga TOCTOU, y el re-check por acción es obligatorio igualmente, así que pasar el plan no ahorra el guard crítico. `scan()` y `execute()` comparten helpers internos de detección (DRY sin acoplar el snapshot).

### UX de seguridad de `--fix` (fase de alto riesgo)
- **D-07:** **`--fix` ejecuta directo, sin prompt de confirmación.** El dry-run-por-defecto ya impone el ritual de 2 pasos (corre plano → revisa → corre `--fix`); `--fix` es la señal explícita de intención. El guard REAL es el re-check liveness por acción (D-06) + el invariante nunca-tocar-vivo, no un `y/n`. Un prompt rompería scriptabilidad/CI y la detección TTY. (Sin `--yes`: innecesario sin prompt.)
- **D-08:** **El dry-run previsualiza la acción EXACTA por ítem**, no sólo el conteo. Por cada ítem se indica QUÉ haría `--fix`: worktree `remove` vs `prune` (registrado-sin-dir vs metadata stale) vs `move-a-.dirty` (si dirty); lock `steal` vs `keep`; log `unlink`. Hace el dry-run confiable: el operador decide ejecutar viendo el plan real.
- **D-09:** **Doctor reporta un resumen breve de los recursos VIVOS que protege** (p. ej. "protegidos: N sesiones vivas / M locks activos omitidos"), además de la basura accionable. Da confianza en el invariante nunca-tocar-vivo y facilita auditar. **NO cuenta para el exit code** — sigue siendo `0=limpio` si sólo hay recursos vivos (DOCTOR-03).

### Invariantes heredadas del roadmap (LOCKED — no re-discutidas, downstream DEBE respetarlas)
- **D-10:** Patrón **puro + DI + never-throws** espejo exacto de `reconcile.js`. doctor no lanza: un fallo de una acción se reporta y el barrido continúa (fail-open por ítem, como `sweepRetention` y el worktree cleanup de `stop.js`).
- **D-11:** **Saneo de worktree = espejo de `stop.js` (líneas 251-402):** leer branch ANTES de remover; `git worktree remove` SIN `--force`; **dirty → mover a `<wt>.dirty`** (con fallback rename+`worktree repair`), NUNCA borrar; `git worktree prune` oportunista al final. **Nunca `rm -rf`.** Distinguir worktree registrado-sin-dir (`remove`) de metadata stale (`prune`).
- **D-12 (logs — área no seleccionada, discreción anclada al roadmap):** "Log viejo" = `mtime > 7d` reusando la retención del polling-daemon (`DEFAULT_RETENTION_DAYS=7` en `polling-logfile.js:49`). doctor barre los **`<sessionId>.ndjson` huérfanos** (de sesión NO viva) con `mtime>7d`; **unlink entero, nunca truncar** (no romper followers POSIX); **nunca el log de una sesión viva**. Los `polling-*.log` ya los barre `sweepRetention` del daemon — doctor puede invocarlo o dejarlos a su cargo (discreción del planner; no duplicar el número 7 — reusar la constante).
- **D-13:** **Máquina de estados del lock = espejo de `acquireGsdLock` (`lock.js:103-139`):** lock con **PID vivo + TTL no excedido → NO se borra**; **PID muerto (ESRCH) o TTL excedido → se roba/borra**. TTL como red de seguridad real contra PID-reuse en macOS; cross-check del PID contra `state.json`. Reusar `isPidAlive` y `readLock`, no reimplementar.
- **D-14:** doctor **NUNCA** sanea worktree/lock de sesión viva (`alive===true` o PID vivo). `stop.js` sigue siendo dueño del cleanup happy-path; doctor recoge SÓLO huérfanos.

### Claude's Discretion
- **Firma exacta de `scan()`/`execute()`** (qué `deps` se inyectan: `loadState`/`removeSession`, `gitFn`, `isPidAlive`, clock `now`, `logger`, resolver de paths de logs). Seguir el molde de DI de `runReconcileTick` y `runStopHook`.
- **Forma exacta del reporte de `scan()`** (estructura por categoría + ítem + acción prevista). Debe ser serializable a `--json` (D-01) y consumible por el render del dismiss (Phase 42).
- **Si `execute()` global invoca `sweepRetention` para los `polling-*.log`** o sólo barre los `.ndjson` huérfanos (D-12). Reusar la constante de 7d en cualquier caso.
- **Eventos NDJSON de observabilidad** (p. ej. `doctor.scan`, `doctor.fix.worktree.removed`, `doctor.fix.lock.stolen`, `doctor.fix.error`): seguir el molde de `worktreeCleanup*` y `*.api.call.failed` en `logger-events.js`. Token=0 (operaciones de filesystem/git, no llamadas al modelo).
- **Concurrencia del barrido** (serial vs paralelo): N típicamente bajo; serial es aceptable y más simple para el re-check liveness por acción.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Driver y requisitos
- `.planning/REQUIREMENTS.md` §DOCTOR-01..04 — requisitos formales de esta fase
- `.planning/ROADMAP.md` §"Phase 41" — Goal, Success Criteria e Invariantes/notas (el grueso del diseño ya está ahí: lectura obligatoria)
- `.planning/ROADMAP.md` §"Phase 42" + §Backlog 999.1 — el consumidor del módulo (dismiss); valida que la API de D-04/D-05 le sirve

### Patrón a espejar (puro + DI + never-throws)
- `src/session/reconcile.js` — **el espejo arquitectónico.** Split `reconcileTick` (puro) / `runReconcileTick` (I/O con DI: `loadState`/`saveState`/`now`/`logger`); `isSessionProcessAlive` (pgrep, fail-safe a muerto). `scan()`/`execute()` replican este molde.

### Código a reusar (no reimplementar)
- `src/gsd/lock.js:67` — `isPidAlive` (POSIX `process.kill(pid,0)`, ESRCH=muerto). `readLock` (`:86`), máquina de robo `acquireGsdLock` (`:103-139`), `LOCK_FILE`/`DEFAULT_TTL_HOURS` (`:51-52`)
- `src/hooks/stop.js:251-402` — saneo de worktree fail-open: branch-antes-de-remove, `worktree remove` sin `--force`, dirty→`.dirty` con fallback `rename`+`worktree repair`, `prune` oportunista
- `src/cli/polling-logfile.js:115-143` — `sweepRetention` (mtime>7d, `DEFAULT_RETENTION_DAYS=7` en `:49`, fail-open por archivo). Patrón a reusar para los `.ndjson`
- `src/session/state.js:153` — `computeWorktreePath(projectPath, sessionId)` = `<projectPath>/.bg-shell/<sessionId>`; `loadState` (`:208`), `removeSession` (`:242`), `listSessions` (`:287`)
- `src/logger.js:248-250` — los `<sessionId>.ndjson` viven en `~/.kodo/logs/`
- `src/cli.js:313-345` — registro del comando `gsd` (`gsd.command('doctor')` se añade junto a `inspect`/`verify`; patrón lazy-import + `process.exit`)
- `src/logger-events.js` — registro `EVENTS` (añadir eventos `doctor.*`; molde `worktreeCleanupOk/Dirty/Error`)

### Tests (patrones a seguir)
- `test/` — buscar tests de `reconcile`/`stop`/`lock`/`polling-logfile` para el patrón de DI inyectada (clock, gitFn, fs stubs) sin spawn real

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`reconcile.js` split puro/I-O:** el molde exacto de `scan()`(puro) + `execute()`(I/O con DI). Copiar la estructura, no inventar otra.
- **`isPidAlive` + `acquireGsdLock` (lock.js):** la máquina de estados del lock ya existe y está testeada — D-13 la reusa tal cual para decidir steal/keep.
- **Worktree cleanup de `stop.js`:** la lógica completa branch→status→remove|move→prune ya está escrita y endurecida (Pitfalls #1/#2/#3 cazados en Phase 19). doctor la extrae/comparte; idealmente factorizar el bloque a un helper reusable por ambos (stop.js y doctor.js) — una sola fuente.
- **`sweepRetention` (polling-logfile.js):** retención por mtime fail-open ya implementada; D-12 reusa el patrón y la constante de 7d.
- **`removeSession`/`listSessions`/`computeWorktreePath` (state.js):** la base para detectar zombies y resolver paths de worktree.

### Established Patterns
- **`reconcileTick` = único escritor de `alive`** (invariante v0.9 D-04). doctor NO escribe `alive`; sólo `removeSession` (quita entradas muertas) + borra recursos de filesystem/git.
- **Fail-open por ítem:** `sweepRetention` y el worktree cleanup continúan tras un fallo individual. doctor never-throws igual.
- **Subcomando CLI:** lazy import del handler + `ensureConfig()` opcional + `process.exit(code)` (ver `gsd verify`). doctor probablemente NO requiere `ensureConfig` (sanea filesystem local, no toca provider) — confirmar en plan.
- **Re-check liveness fail-safe a muerto:** `isSessionProcessAlive` (pgrep) y `isPidAlive` (ESRCH) ya son conservadores; doctor hereda esa semántica antes de cada borrado.

### Integration Points
- `src/cli.js` — nuevo `gsd.command('doctor')` junto a `inspect`/`verify`.
- `src/hooks/stop.js` — si se factoriza el worktree cleanup a un helper compartido, stop.js pasa a consumirlo (refactor quirúrgico; mantener su comportamiento fail-open verbatim).
- **Phase 42 (dismiss):** `DELETE /sessions/{id}` → `doctor.execute({taskId})`. La API de D-04/D-05 ES el contrato de esa fase.

</code_context>

<specifics>
## Specific Ideas

- **Realidad verificada (2026-06-04):** en este repo `git worktree list` muestra worktrees de `.claude/worktrees/` (tool Agent de Claude Code) y de orca — **NO** son worktrees de sesión kodo. doctor debe acotar su detección a `.bg-shell/<sessionId>` cross-checado contra `state.json`, sin tocar worktrees de otras herramientas. (Refuerza D-02/D-14: precisión en qué es "huérfano de kodo".)
- El reporte del dry-run debe ser lo bastante explícito (D-08) como para que un operador confíe en correr `--fix` en producción sin sorpresas — es la lección de v0.9 (37/38 cerrado por UAT manual sobre mutaciones).

</specifics>

<deferred>
## Deferred Ideas

- **Flags por-categoría en el CLI** (`--worktrees`/`--locks`/`--logs`/`--zombies`): descartado para v1 (D-02). Promover si un operador necesita saneo quirúrgico desde la línea de comandos. El acotado por `taskId` ya existe a nivel API.
- **Confirmación interactiva / `--yes` en `--fix`** (D-07): descartado — el dry-run-default + re-check liveness es el guard. Reconsiderar sólo si UAT revela borrados accidentales pese al ritual de 2 pasos.
- **Borrar el `.ndjson` de una sesión al descartarla (Phase 42)** (D-05): descartado por acoplar el dismiss a la retención de logs y por poder borrar un log aún útil tras descartar. El log caduca por mtime>7d globalmente (D-12).
- **TTL/retención configurable por env** (`KODO_DOCTOR_LOG_RETENTION_DAYS`): no para v1; el fijo de 7d (reuso del daemon) basta.

</deferred>

---

*Phase: 41-doctor-m-dulo-puro-de-saneo-cli*
*Context gathered: 2026-06-04*
</content>
</invoke>
