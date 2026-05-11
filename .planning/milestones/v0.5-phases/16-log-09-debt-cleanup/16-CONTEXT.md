# Phase 16: LOG-09 Debt Cleanup - Context

**Gathered:** 2026-05-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar la deuda v0.3 sobre la taxonomía de eventos: tres callsites independientes que migran a la canon de `EVENTS.*` y `markSessionStatus` para que `state.transition` y `gsd.phase.resolved`/`gsd.bootstrap` se emitan vía la API canónica en runtime, sin alterar los flujos existentes (Plane comment posting, lock release per-repo, dispatch full/quick).

**Tres callsites:**
1. `src/triggers/dispatcher.js` → 4 literales `'gsd.phase.resolved'` + 1 `'gsd.bootstrap'` migran a `EVENTS.*` constantes (LOG-13)
2. `src/gsd/verify.js` → `markSessionStatus(taskId, 'review', ...)` post-pass + addComment OK + updateTaskState OK (LOG-14)
3. `src/hooks/stop.js` → `markSessionStatus(id, 'done', ...)` PRE-release del lock per-repo (LOG-15)

</domain>

<decisions>
## Implementation Decisions

### Dispatcher migration strategy (LOG-13)

- **D-01:** Estrategia **EVENTS.* directo (mínimo cambio)** — sustituir el string literal del primer arg de `log.info()`/`log.warn()` y el `event:` key del payload por la constante `EVENTS.GSD_PHASE_RESOLVED` / `EVENTS.GSD_BOOTSTRAP`. El shape inline del payload se preserva (todas las variantes con campos extra `matched`/`tolerated`/`code`/`error_code`/`detail`/`task_ref`/`mode` quedan exactamente iguales). Los helpers existentes `gsdPhaseResolved()` / `gsdBootstrap()` NO se usan desde dispatcher.js — sus shapes fijos no cubren las 4 variantes que dispatcher emite (matched-true, no-match-tolerated quick branch, fail-closed warn, bootstrap).
- **D-02:** `dispatcher.js` añade `import { EVENTS } from '../logger-events.js'` al top del archivo. Tanto el primer arg de `log.info()`/`log.warn()` como el `event:` key dentro del payload migran a la constante (single-source: si la constante cambia, ambos lugares cambian sin drift).
- **D-03:** Los helpers `gsdPhaseResolved`/`gsdBootstrap` en `src/logger-events.js` **NO se modifican** — siguen disponibles para callers que emitan el shape canónico (matched-true happy path), pero dispatcher.js no los usa por incompatibilidad de shape.

### stop.js terminal status policy (LOG-15)

- **D-04:** Estado terminal **fixed `'done'` para ambos modos** (full y quick). stop.js es hook mecánico (ya documentado así en cabecera del archivo) — NO infiere modo, NO consulta verdict, NO deriva del transcript. Just marks `'done'` cuando libera el lock per-repo.
- **D-05:** Aceptamos transición `from='review' to='done'` cuando full pasó por verify primero (que marcó `'review'`) y luego stop dispara. Esto es válido: la sesión llegó a su fin tras la review humana implícita / la transition Plane.
- **D-06:** `reason` del `state.transition` será **`'session-stop:lock-released'`** — informativo, mismo formato que otros eventos (e.g., `'gate-passed'`, `'plane-unreachable'`).
- **D-07:** Solo se emite `markSessionStatus` dentro de la rama `if (session.gsd) { ... }` (Phase 11 D-08 pertenece a ambos modos). La rama no-GSD del switch sigue sin emitir `state.transition` — la mantenemos intacta.

### stop.js order of operations (LOG-15)

- **D-08:** Orden **PRE-release** — `markSessionStatus` se invoca ANTES de `releaseGsdLock`. Consistente con el patrón ya documentado en stop.js línea 116 (`Emit typed session.end event BEFORE removeSession so the logger can read fields from the still-existing session record`).
- **D-09:** El bloque `markSessionStatus` se envuelve en try/catch silencioso (mirror del patrón "silent — never block on logger failure" ya en uso en dispatcher.js) para que un fallo defensivo en logger NO impida el releaseGsdLock que viene después. Comentario explícito: `// silent — never block lock release on logger failure (mirrors session.end pattern line 116)`.

### verify.js terminal status (LOG-14, builder discretion)

- **D-10:** Estado terminal en verify.js#pass branch = `'review'`. SC#2 lo sugiere directamente y el tipo de `markSessionStatus` ya admite `'review'`. Reason: `'gate-passed'` (consistente con el verdict legacy mapping ya existente en verify.js cabecera línea 26).
- **D-11:** `markSessionStatus(taskId, 'review', 'gate-passed', logger)` se invoca **SOLO** cuando `verdict.action === 'pass'` Y `addComment` OK Y `updateTaskState` OK (D-11/D-12 Phase 10 preservadas — el orden ya está enforced en verify.js). Las ramas `soft-fail`, `hard-fail`, `missing`, `malformed` y errores intermedios de Plane NO emiten `state.transition` (regression test cubre las 4+ ramas — SC#3).

### Test source-hygiene shape (LOG-13)

- **D-12:** **Grep simple comment-aware**: el test filtra líneas que empiecen con `//` o `*` (comment markers) ANTES de hacer regex contra `'gsd.phase.resolved'` y `'gsd.bootstrap'`. Comentarios pueden mencionar los strings (documentación histórica D-14). Single-file scan de `src/triggers/dispatcher.js`, alineado con SC#1.
- **D-13:** Test vive en **`test/dispatcher-isolation.test.js`** — nombre paralelo a `test/check-isolation.test.js`, `test/format-isolation.test.js`, `test/session-start.js source invariants`. Tres asserts: (1) no literal `'gsd.phase.resolved'` en código no-comment de dispatcher.js, (2) no literal `'gsd.bootstrap'` en código no-comment, (3) positive — `import { EVENTS } from '../logger-events.js'` (o `from './logger-events.js'`) presente en dispatcher.js (fuerza el wiring).

### Claude's Discretion

Áreas donde el builder decide sin re-preguntar:
- **Scope de migración en dispatcher**: solo los 5 callsites con literales — comentarios documentando el flujo histórico (líneas 171, 173, 203, 228) **se mantienen** porque son referencias históricas a invariantes (D-14 Phase 9). El test source-hygiene los respeta vía comment-aware filter.
- **markSessionStatus return value**: ignored en stop.js / verify.js — no se usa upstream, basta con el side-effect (state mutation + state.transition emit).
- **Logger threading**: stop.js y verify.js ya tienen logger en scope (el `log` child desde createLogger). markSessionStatus recibe ese mismo logger.
- **Verify.js test coverage para SC#3**: 4+ ramas del verdict (`pass`, `soft-fail`, `hard-fail`, `missing`/`malformed`, addComment-error, updateTaskState-error) — cada rama con un test que afirma que markSessionStatus **no** se llama (logger fake con spy).
- **Stop.js test coverage para SC#5**: cadena quick → stop → lock release → state.transition done; cadena full → verify(review) → stop → lock release → state.transition review→done; rama no-GSD → no state.transition.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §Phase 16 — goal + 5 success criteria + dependencies (Phase 14/15 independencia documentada)
- `.planning/REQUIREMENTS.md` LOG-13/LOG-14/LOG-15 — contratos de los 3 cambios

### Source files to modify
- `src/triggers/dispatcher.js` — 5 callsites con literales (líneas 183, 184, 210, 211 + bootstrap callsite); ya importa createLogger lazily, requiere import de EVENTS
- `src/gsd/verify.js` — pass branch (action=='pass' + addComment OK + updateTaskState OK), línea ~26 cabecera con verdict legacy mapping ya documentado
- `src/hooks/stop.js` línea 137-147 — rama `if (session.gsd) { ... }` con releaseGsdLock + removeSession; patrón "Emit typed event BEFORE mutation" línea 116 sirve de precedente

### Helpers / contratos a consumir
- `src/logger-events.js` — `EVENTS.GSD_PHASE_RESOLVED`, `EVENTS.GSD_BOOTSTRAP` (constantes), `EVENTS.STATE_TRANSITION`, helper `stateTransition(logger, fields)` (usado internamente por markSessionStatus)
- `src/session/manager.js:299` — `markSessionStatus(taskId, nextStatus, reason, logger)` signature; tipos válidos `'running'|'done'|'error'|'review'|'interrupted'`

### Prior phase decisions a preservar
- Phase 9 D-14 — dispatcher es **single-source** de `gsd.phase.resolved` (D-01/D-02 preservan invariante: solo dispatcher emite el evento, helpers existen para otros callers pero dispatcher no los necesita)
- Phase 10 D-11/D-12 — `updateTaskState` SOLO en pass + addComment OK; **D-11 LOG-14**: markSessionStatus SOLO post-updateTaskState OK (cadena pass→addComment→updateTaskState→markSessionStatus)
- Phase 11 D-07 — `gsd.bootstrap` lleva `mode: 'full'|'quick'` (preservar shape inline en migración EVENTS.*)
- Phase 11 D-08 — stop.js libera lock para ambos modos (D-04 fixed `'done'` aplica a la rama compartida)
- Phase 13 D-09/D-10/D-11 — anti-inline `session.gsd_mode` access patterns (no afecta directamente Phase 16, pero source-hygiene tests existentes deben seguir verdes)

### Test patterns to mirror
- `test/format-isolation.test.js` — patrón LOG-12 walker (referencia, NO se replica para LOG-13 — ver D-12)
- `test/check-isolation.test.js` — naming pattern y estructura para `test/dispatcher-isolation.test.js`
- `test/dispatcher.test.js` — fake logger / spy patterns existentes para verificar campos NDJSON canónicos

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`markSessionStatus(taskId, nextStatus, reason, logger)`** en `src/session/manager.js:299` — listo para usar; emite `state.transition` con `from`/`to` reales cuando se pasa logger; retrocompatible (sin logger se comporta como updateSession plano).
- **`EVENTS` dict** en `src/logger-events.js:33-50` — `STATE_TRANSITION`, `GSD_PHASE_RESOLVED`, `GSD_BOOTSTRAP` ya exportados.
- **`stateTransition(logger, fields)`** helper — usado internamente por `markSessionStatus`, no se invoca directamente desde Phase 16.

### Established Patterns
- **`log.info(EVENT, { event: EVENT, ...fields })`** — el `event:` key duplicado en payload es intencional (facilita queries NDJSON sin parser de mensaje); preservar shape al migrar.
- **`silent — never block ... on logger failure`** — try/catch silencioso alrededor de logger ops en dispatcher.js + stop.js. Aplicado en D-09 a `markSessionStatus` en stop.js.
- **`Emit typed event BEFORE mutation`** — stop.js línea 116 ya usa `session.end` antes de `removeSession`. D-08 extiende este patrón a `state.transition` antes de `releaseGsdLock`.
- **`if (session.gsd) { ... }`** — rama Phase 11 D-08 que cubre ambos modos (full + quick); D-04/D-07 mantienen markSessionStatus dentro de esta rama, NO duplicado en switch quick/full.

### Integration Points
- **dispatcher.js**: imports lazy de logger.js dentro de cada try block; nuevo `import { EVENTS } from '../logger-events.js'` se añade al top (eager — sin runtime cost porque logger-events.js no tiene side effects).
- **verify.js → markSessionStatus**: se inserta DESPUÉS de `updateTaskState` exitoso, ANTES de `orchestratorReview` (que es el último side-effect del happy path).
- **stop.js → markSessionStatus**: se inserta ANTES de `releaseGsdLock` dentro de la rama `if (session.gsd)`, después del `session.end` event ya emitido.

</code_context>

<specifics>
## Specific Ideas

- Test fake logger pattern: usar el mismo helper que existe en `test/dispatcher.test.js` o `test/manager.test.js` (memSink que captura entries) para verificar campos canónicos del NDJSON: `event === 'state.transition'`, `from === <prev_status>`, `to === 'done'|'review'`, `reason` no vacío.
- Regression test SC#3 verify.js: parametrizado sobre las 4 ramas (`pass`, `soft-fail`, `hard-fail`, `malformed/missing`) + 2 ramas de error (addComment fail, updateTaskState fail) — cada test asserts que markSessionStatus NO se llamó (spy o memSink filter por event === 'state.transition').
- Regression test SC#5 stop.js: un test por modo (full + quick) + un test rama no-GSD que confirma que markSessionStatus NO se llama y `state.transition` NO se emite.

</specifics>

<deferred>
## Deferred Ideas

- **Helpers expandidos para variants no-canónicos del dispatcher** — descartado por D-01 (mínimo cambio), pero podría revisitarse en una fase futura si la taxonomía cerrada D-14 se expande a más callsites con shapes heterogéneos. Por ahora EVENTS.* directo es suficiente.
- **Walker AST style LOG-12 para dispatcher-isolation** — descartado por D-12 (grep comment-aware es suficiente). Walker tendría sentido si dispatcher.js empieza a tener indirecciones (helpers locales que retornan strings) — escenario que NO está en scope Phase 16.
- **markSessionStatus en rama no-GSD del stop.js** — fuera de scope (D-07): `state.transition` se reserva para sesiones GSD. Reformular si en el futuro se quiere observabilidad uniforme para todas las sesiones.

</deferred>

---

*Phase: 16-log-09-debt-cleanup*
*Context gathered: 2026-05-06*
