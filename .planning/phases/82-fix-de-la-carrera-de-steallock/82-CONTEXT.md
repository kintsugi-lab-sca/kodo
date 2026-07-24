# Phase 82: Fix de la carrera de `stealLock` - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas sobre la opción recomendada; auditables en 82-DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Cerrar con un fix real la ventana no-atómica move-aside→`O_EXCL` de `stealLock` (`src/gsd/lock.js:283-351`): con N≥2 procesos robando el mismo lock GSD muerto, exactamente uno adquiere (LOCK-01); el test `gsd-lock-race` pasa verde de forma determinista sin debilitar asserts ni enmascarar (LOCK-02); R-81-01 y la debug session `gsd-lock-race-cr01` quedan formalmente cerradas con la resolución documentada (LOCK-03).

Fuera del boundary: el lock del inbox (Phase 83 usa `withFileLock` de `src/session/state-lock.js`, NUNCA este módulo), cualquier rediseño del modelo de locking más allá de cerrar la ventana, y el segundo mecanismo benigno del harness (`raceGsdChildren` hold-expiry por spawn-jitter — timing del harness, no bug de producto; documentado en el diagnóstico §"Segundo mecanismo").

</domain>

<decisions>
## Implementation Decisions

### Decisiones heredadas (LOCKED — no re-discutir)

- **R-81-01 (mantenedor, 2026-07-24): fix real**, no aceptación del riesgo. Coherente con el espíritu hardening de v0.16/v0.18.
- **Constraint DEBT-04:** el test `gsd-lock-race` NO se greenea enmascarando — ni `.skip`, ni retries, ni timeouts subidos, ni debilitar el assert `exactly one`. Un «arreglo» que debilite el CAS es el TOP THREAT (T-81-03-02).
- **Cero deps npm nuevas** — todo con `node:fs`/`node:crypto` built-in (invariante cross-milestone).

### Estrategia del fix (mecanismo que cierra la ventana)

- **D-01 (estructural, LOCKED):** `lockPath` **jamás queda ausente** durante un steal. La causa raíz es la ventana briefly-empty que abre `renameSync(lockPath → aside)`; cualquier fix válido la elimina **por construcción**, no por reducción probabilística.
- **D-02 (mecanismo recomendado):** sustituir move-aside→create por **reemplazo in-place atómico**: escribir el lock nuevo en un tmp de nombre único y `renameSync(tmp → lockPath)` — en POSIX `rename(2)` sustituye el destino atómicamente sin estado intermedio ausente. La exclusión entre stealers concurrentes la da un **steal-guard `O_EXCL`** propio (fichero hermano del lock): solo el poseedor del guard ejecuta re-check + rename; el re-check ABA (releer `lockPath` y confirmar que sigue stale) ocurre DENTRO del guard, antes del rename. Con esto: los `acquireGsdLock` Case-1 frescos nunca ganan durante un steal (el path nunca está vacío → su `O_EXCL` siempre da EEXIST), y el steal es linealizable entre stealers.
- **D-03 (alternativas descartadas, con razón):** (a) *verificación post-adquisición* (re-read + confirmar ownership) — descartada: el propio diagnóstico la marca como "reduce pero no elimina (TOCTOU residual)"; no cumple LOCK-01 por construcción. (b) *lock por directorio (`mkdir`)* — descartada: cambia el formato del artefacto de lock (fichero JSON → directorio) con blast radius en `readLock`, `releaseGsdLock`, `doctor.decideLock` y tests golden; desproporcionado para cerrar una ventana.
- **D-04:** si el research/planner encuentra un impedimento real al mecanismo D-02, puede proponer variante — pero D-01 (nunca-ausente por construcción) y el contrato D-08 son innegociables. El fallback final de `stealLock` (líneas 339-350, `writeLockFile` tras agotar attempts) se re-evalúa bajo la misma regla: no puede reabrir la ventana.

### Robustez ante crash mid-steal (guard huérfano)

- **D-05:** el steal-guard debe ser **breakable**: un stealer que muere dentro del guard no puede bloquear steals para siempre. Criterio de rotura: PID del guard muerto (`isPidAlive`, reutilizado) **o** edad del guard > umbral corto — segundos, no horas: la sección crítica del steal es de milisegundos, un guard viejo es basura por definición. Contenido mínimo del guard (pid + timestamp); cleanup best-effort (`unlink` en el camino feliz y en el de error).
- **D-06:** los perdedores del guard re-evalúan contra el estado fresco (releer `lockPath`: holder vivo → `{acquired:false, holder}`; sigue stale → re-contender con presupuesto acotado, patrón `MAX_STEAL_ATTEMPTS` existente). Nunca espera indefinida ni spin sin límite.

### Validación (LOCK-02)

- **D-07:** el harness CR-01 de `test/gsd-lock-race.test.js` queda **byte-idéntico** — es la prueba del invariante y tocarlo levantaría sospecha de enmascarado. Se añaden **unit tests nuevos dirigidos** de la primitiva del guard (guard huérfano de PID muerto se rompe; guard fresco de PID vivo bloquea/re-contiende; crash simulado no deja el lock en estado inconsistente). Evidencia de verde determinista para VERIFICATION.md: loop de estrés del fichero de test (≥30 iteraciones, ideal bajo carga paralela — el diagnóstico reproducía ~48% de fallos en esas condiciones) con 0 fallos.
- **D-08 (contrato, LOCKED):** API pública y artefactos intactos — shape `AcquireResult` (`{acquired:true} | {acquired:false, holder}`), formato JSON del lock file, exports del módulo y semántica de Cases 1-5 sin cambios. Los consumidores (`doctor.decideLock`, dispatch, release) no se tocan. El cambio queda contenido en `stealLock` + helpers privados nuevos.

### Cierre documental (LOCK-03)

- **D-09:** `.planning/debug/gsd-lock-race-cr01.md` se mueve a `.planning/debug/resolved/` (subdirectorio ya existente) con su sección Outcome actualizada con la resolución (fecha, mecanismo del fix, commit).
- **D-10:** la fila «Carrera real confirmada en `stealLock`» de STATE.md §Deferred Items se marca cerrada con la resolución (fue "Programado → v0.19 Phase 82"; al completar, refleja el cierre).
- **D-11:** el docblock de `stealLock` (`lock.js:258-282`) se reescribe — hoy describe el CAS move-aside que el fix elimina; dejarlo sería doc-drift del tipo que HYG-08/DEBT-02 vinieron a erradicar.

### Claude's Discretion

Nombre exacto del fichero guard (p. ej. `.kodo.lock.steal-guard`), umbral concreto de edad del guard (orden de segundos), presupuesto de re-contención (reutilizar o ajustar `MAX_STEAL_ATTEMPTS`), estructura interna de los helpers privados, y N exacto del loop de estrés de verificación.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Diagnóstico (la fuente de verdad de la causa raíz)
- `.planning/debug/gsd-lock-race-cr01.md` — debug session completa: síntoma, evidencia reproducida (traza de dos `O_EXCL`-create ganadores, insensibilidad al hold), interleaving mínimo de la doble adquisición, por qué la ABA guard no lo cierra, y las 3 direcciones de fix. **Leer entero antes de planificar.**
- `.planning/milestones/v0.18-phases/81-saneo-de-deuda-v0-17/81-DEBT-04-DIAGNOSIS.md` — el diagnóstico DEBT-04 archivado con la fase 81 (threats T-81-03-01/02).

### Código afectado
- `src/gsd/lock.js:283-351` — `stealLock`, la carrera (move-aside→`O_EXCL` no atómico). Objetivo del fix.
- `src/gsd/lock.js:108-151` — `acquireGsdLock`, cuyo create Case-1 (`:117`) gana en la ventana abierta por un stealer concurrente.
- `src/gsd/lock.js:244-256` — `isStaleLock` / `isPidAlive` (`:72-79`), reutilizables para la staleness del guard.

### Test (el invariante ejecutable)
- `test/gsd-lock-race.test.js:142-162` — casos CR-01 (`raceGsdStealDeadHolder` N=2/N=5). Harness CORRECTO, byte-idéntico (D-07).
- `test/helpers/lock-race-child.mjs` — hijo del harness (imprime `acquired`/`blocked`). Sin cambios.

### Contexto de milestone
- `.planning/ROADMAP.md` §Phase 82 — goal + 4 success criteria.
- `.planning/STATE.md` §Deferred Items — la fila a cerrar (D-10) + decisión de apertura v0.19 (R-81-01 = fix real).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isPidAlive` (`src/gsd/lock.js:72`): staleness por PID para el guard (D-05), ya probada.
- `isStaleLock` (`src/gsd/lock.js:251`): gating PID+TTL existente; el re-check dentro del guard la reutiliza tal cual.
- Patrón unique-tmp-name + rename (`src/hooks/session-end.js:331-389`): el mismo patrón de escritura atómica que D-02 aplica al lock.
- `MAX_STEAL_ATTEMPTS` (`src/gsd/lock.js:57`): presupuesto de re-contención acotado ya establecido; la nueva contención sobre el guard sigue el mismo patrón.

### Established Patterns
- Locks vía `node:fs` built-in, cero deps (v0.16 CONC-02) — el guard sigue igual.
- Tests de carrera con procesos reales + barrier file (`test/gsd-lock-race.test.js`) — los unit tests nuevos del guard pueden ser in-process (la sección crítica es una función), el invariante E2E ya lo cubre el harness.
- Doc-truth: comentarios que describen semántica de concurrencia se mantienen fieles al código (HYG-08, DEBT-02) — motiva D-11.

### Integration Points
- Consumidores de `acquireGsdLock`/`releaseGsdLock`: dispatch GSD, `doctor.decideLock` — no se tocan (D-08); la suite completa (2364 tests) debe seguir verde (success criterion 3).
- El guard vive junto al lock en `<repo>/.planning/` — mismo directorio, creado ya por `mkdirSync` en `stealLock`.

</code_context>

<specifics>
## Specific Ideas

- El interleaving mínimo del diagnóstico (§Root Cause, pasos 1-6) es el escenario de referencia: cualquier revisión del fix debe poder explicar por qué ese interleaving ya no produce dos `acquired: true`.
- La evidencia de determinismo replica las condiciones del repro original: loops del fichero de test con la suite/carga en paralelo (el diagnóstico midió 13/50 y 19/40 fallos así).

</specifics>

<deferred>
## Deferred Ideas

- El segundo mecanismo del harness (`raceGsdChildren` :131 — hold-expiry por spawn-jitter, 1/40 observado, benigno y legítimo): NO es objetivo de esta fase; si tras el fix reaparece como flaky residual, se trata como issue de harness aparte, jamás debilitando el assert.
- Rediseño mayor del modelo de locking (p. ej. migrar todo a lock por directorio): fuera de alcance; esta fase cierra la ventana con blast radius mínimo.

</deferred>

---

*Phase: 82-Fix de la carrera de `stealLock`*
*Context gathered: 2026-07-24*
