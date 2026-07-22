---
phase: 75-superficie-del-next-dashboard-y-nudge
plan: 02
subsystem: infra
tags: [hooks, session-end, handoff, nudge, cmux, state]

# Dependency graph
requires:
  - phase: 74-persistencia-del-next
    provides: "state.tasks[task_id].next persistido con semántica asimétrica; upsertTaskHandoff/writeHandoff"
provides:
  - "buildStopNudgeText(session, next?) — 2º parámetro opcional que añade una línea ES concreta al nudge en los 3 modos"
  - "upsertTaskHandoff devuelve el entry persistido en value (post-asimetría), cero I/O extra"
  - "writeHandoff devuelve { planPath, next } con el next efectivo post-upsert threadeado al nudge del orquestador"
affects: [nudge-orquestador, session-end, verify-work, dashboard-next]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Threading por-return del dato efectivo bajo el lock (cero I/O extra): el value se construye una vez en memoria y se propaga por el return en vez de re-leer disco"
    - "Función pura con parámetro opcional threadeado: buildStopNudgeText recibe el next, nunca lo lee"

key-files:
  created: []
  modified:
    - src/hooks/stop.js
    - src/session/state.js
    - src/hooks/session-end.js
    - test/stop.test.js
    - test/state/handoff-state.test.js
    - test/hooks/session-end-handoff.test.js

key-decisions:
  - "El next del nudge es el EFECTIVO post-asimetría (upsertResult.value.next), NO r.value.next — un cierre mecánico tras un NEXT: real produce un nudge con contexto (Pitfall 5)"
  - "buildStopNudgeText permanece pura: el next se threadea, jamás se lee de disco (D-08)"
  - "Sin next el texto por-modo queda byte-idéntico — degradación limpia que protege los tests de no-regresión (D-09)"
  - "Best-effort ante lock-timeout del upsert: si el upsert cae, el nudge usa el next de esta sesión (r.value.next)"

patterns-established:
  - "Return-threading del dato bajo lock: capturar el objeto construido en el mutator y devolverlo en value para evitar una re-lectura de disco"
  - "Guard estricto typeof === 'string' && length > 0 para degradación byte-idéntica ante falsy/no-string"

requirements-completed: [LIVE-07]

coverage:
  - id: D1
    description: "buildStopNudgeText gana un 2º parámetro opcional next; con string no vacío añade UNA línea ES al final en los 3 modos, byte-idéntico sin next, y permanece pura"
    requirement: "LIVE-07"
    verification:
      - kind: unit
        ref: "test/stop.test.js#LIVE-07: con un next string no vacío añade UNA línea ES al final, en los TRES modos"
        status: pass
      - kind: unit
        ref: "test/stop.test.js#LIVE-07: sin next (undefined) === next null === next \"\" — BYTE-IDÉNTICO por modo (D-09)"
        status: pass
      - kind: unit
        ref: "test/stop.test.js#LIVE-07: buildStopNudgeText permanece PURA — cero I/O en su cuerpo (D-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "upsertTaskHandoff devuelve el entry persistido (post-asimetría) y writeHandoff threadea el next efectivo al nudge del orquestador; un cierre mecánico tras un NEXT: previo produce un nudge con contexto"
    requirement: "LIVE-07"
    verification:
      - kind: unit
        ref: "test/state/handoff-state.test.js#el value devuelto honra la ASIMETRÍA: cierre mecánico tras un NEXT: previo devuelve el previo (LIVE-07 / Pitfall 5)"
        status: pass
      - kind: integration
        ref: "test/hooks/session-end-handoff.test.js#LIVE-07: con un NEXT: persistido, el nudge al orquestador incluye la línea concreta (no genérico)"
        status: pass
      - kind: integration
        ref: "test/hooks/session-end-handoff.test.js#LIVE-07: cierre mecánico SIN NEXT: previo → el nudge queda genérico (byte-idéntico, D-09)"
        status: pass
    human_judgment: false
  - id: D3
    description: "El nudge con contexto llega al workspace del orquestador en el UAT real de /gsd-verify-work (contexto cuando hay NEXT:, genérico cuando no)"
    verification: []
    human_judgment: true
    rationale: "El threading está probado unitariamente, pero la llegada efectiva del nudge al panel del orquestador vía cmux.send es un efecto de integración con el runtime cmux que la suite hermética no ejercita; se confirma en el UAT vivo."

# Metrics
duration: 5min
completed: 2026-07-17
status: complete
---

# Phase 75 Plan 02: Superficie del NEXT: en el nudge del orquestador Summary

**El nudge que session-end.js envía al orquestador deja de ser genérico: cuando la tarea tiene un NEXT: persistido, añade una línea ES concreta threadeando el valor efectivo post-asimetría por el return de upsertTaskHandoff→writeHandoff, sin I/O extra ni pérdida de pureza.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-17T12:36:41+02:00
- **Completed:** 2026-07-17T12:41:22+02:00
- **Tasks:** 2
- **Files modified:** 6 (3 src, 3 test)

## Accomplishments
- `buildStopNudgeText(session, next?)` gana un 2º parámetro opcional: con un NEXT: string no vacío añade una única línea ES («Siguiente paso sugerido por la sesión: <next>») al final del texto por-modo, en los tres modos (quick/full/no-GSD); sin next queda byte-idéntico al texto actual. La función sigue pura (cero I/O).
- `upsertTaskHandoff` pasa a devolver el entry PERSISTIDO en `value` (`{plan_path, next, updated_at}`) — el `next` efectivo post-asimetría, construido una vez bajo el lock, sin re-lectura de disco.
- `writeHandoff` captura el resultado del upsert y devuelve `{ planPath, next }` con el next EFECTIVO (post-asimetría); un cierre mecánico tras un NEXT: real de la tarea propaga el real → el nudge lleva contexto, no genérico (Pitfall 5). El paso de handoff captura `handoffNext` dentro del try/catch estructural y lo threadea a `buildStopNudgeText(session, handoffNext)`.

## Task Commits

Cada tarea se implementó con ciclo TDD (test RED → feat GREEN):

1. **Task 1: buildStopNudgeText gana un 2º parámetro opcional con el NEXT:**
   - `adf8958` (test — RED)
   - `7b5cf6d` (feat — GREEN)
2. **Task 2: Threadear el NEXT: persistido — upsertTaskHandoff return + writeHandoff + bloque nudge**
   - `7de284d` (test — RED)
   - `3384251` (feat — GREEN)

_Note: TDD tasks tienen commits test → feat._

## Files Created/Modified
- `src/hooks/stop.js` — `buildStopNudgeText` con 2º parámetro opcional `next`; captura el texto por-modo en `text` y añade una línea ES solo cuando `typeof next === 'string' && next.length > 0`.
- `src/session/state.js` — `upsertTaskHandoff` captura el entry construido bajo el lock en `persisted` y devuelve `{ ok: true, value: persisted }`; typedef del return actualizado.
- `src/hooks/session-end.js` — `writeHandoff` captura `upsertResult` y devuelve `{ planPath, next: effectiveNext }`; el paso de handoff captura `handoffNext` y el bloque «3. Nudge al orquestador» lo pasa como 2º arg.
- `test/stop.test.js` — casos LIVE-07: línea ES en los 3 modos con next, byte-idéntico sin next, degradación de no-string, pureza (cero I/O en el source).
- `test/state/handoff-state.test.js` — el return trae `value` con el entry persistido; la asimetría se refleja en `value.next` (cierre mecánico tras un NEXT: previo devuelve el previo).
- `test/hooks/session-end-handoff.test.js` — mock `makeStateWriter` pasa a devolver `{ ok:true, value:{...} }` (con `returnOverride` configurable); writeHandoff devuelve el next efectivo; nudge al orquestador con la línea concreta cuando hay NEXT:, genérico cuando no.

## Decisions Made
- **El next del nudge es el efectivo post-asimetría, no el de esta sesión.** `writeHandoff` threadea `upsertResult.value.next` (post-upsert), no `r.value.next` (null en cierre mecánico). Sin esto, un cierre mecánico tras un NEXT: real dejaría el nudge genérico pese a haber contexto persistido (RESEARCH Pitfall 5).
- **Return-threading en vez de re-lectura.** El entry efectivo ya está en memoria tras el upsert bajo el lock; se propaga por el return de `upsertTaskHandoff` → `writeHandoff` → nudge. Cero I/O extra (D-08).
- **Best-effort ante lock-timeout del upsert.** Si el upsert de state.json cae por lock-timeout, `effectiveNext` recae en `r.value.next` (el next de esta sesión) — degradación sin bloquear el cierre.
- **Guard estricto para la degradación byte-idéntica.** `typeof next === 'string' && next.length > 0` garantiza que null/''/undefined/no-string dejen el texto por-modo intacto (D-09).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. El único fallo de `npm test` es el flaky preexistente CR-01 («gsd lock steal race — concurrent dead-holder steal»), documentado como esperado en los acceptance criteria del plan; no relacionado con este cambio.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- LIVE-07 completo: el nudge del orquestador ya se alimenta del NEXT: persistido.
- Queda el Plan 75-03 pendiente en la fase.
- Confirmación viva pendiente en el UAT de `/gsd-verify-work` (D3): que el nudge con contexto llegue efectivamente al panel del orquestador vía cmux.

## Self-Check: PASSED

- Ficheros modificados presentes: src/hooks/stop.js, src/session/state.js, src/hooks/session-end.js, 75-02-SUMMARY.md.
- Commits presentes en git: adf8958 (test T1), 7b5cf6d (feat T1), 7de284d (test T2), 3384251 (feat T2).

---
*Phase: 75-superficie-del-next-dashboard-y-nudge*
*Completed: 2026-07-17*
