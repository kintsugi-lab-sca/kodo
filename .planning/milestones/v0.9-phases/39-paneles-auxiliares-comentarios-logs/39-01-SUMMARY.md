---
phase: 39-paneles-auxiliares-comentarios-logs
plan: 01
subsystem: ui
tags: [tui, ink, http-client, never-throws, anti-redos, substring-grep]

# Dependency graph
requires:
  - phase: 35-tui-datos
    provides: "fetchStatus never-throws {ok} discriminante + patrón fetchFn inyectable"
  - phase: 36-tabla-viva
    provides: "select.js capa de derive pura (sortSessions/applyFilter String.includes anti-ReDoS)"
provides:
  - "fetchComments(baseUrl, taskId, fetchFn?, signal?) never-throws con 404 discriminable (code='not-found'|'http'|'network')"
  - "fetchLogs(baseUrl, fetchFn?, signal?) never-throws — buffer crudo de /logs, sin discriminante de status"
  - "grepLogs(logs, session) filtro puro substring OR de task_ref/workspace_ref sobre el buffer compartido"
affects: [39-02-overlay-ui, dashboard, App.js]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "never-throws {ok} con discriminante code para distinguir 404 semántico de 5xx/red (D-07 extendido)"
    - "grep best-effort por substring sobre buffer compartido sin session_id (anti-ReDoS, T-39-02)"

key-files:
  created:
    - test/dashboard-select.test.js (extendido con bloque grepLogs)
  modified:
    - src/cli/dashboard/client.js
    - src/cli/dashboard/select.js
    - test/dashboard-client.test.js

key-decisions:
  - "fetchComments añade discriminante `code` ('not-found'|'http'|'network') sobre el patrón de fetchStatus — App.js debe distinguir 404 (task ausente) de 5xx/red"
  - "comments:[] vacío es {ok:true} — la ausencia de comentarios es estado de UI, no error"
  - "grepLogs vive en select.js (derive), no en format.js (presentación) — es un filtro, no un cell projector"
  - "SC#4 (D-08) ya satisfecho: PROJECT.md línea 32 dice correctamente 'best-effort' y 'no hay session_id real' — cero diff"

patterns-established:
  - "never-throws + code discriminante: el fallo HTTP/red colapsa a {ok:false, code} para que React ramifique sin try/catch"
  - "grep substring OR anti-ReDoS: needles = [task_ref, workspace_ref].filter(Boolean), String.includes, nunca compila regex"

requirements-completed: [TUI-15, TUI-16]

# Metrics
duration: ~20min
completed: 2026-06-02
---

# Phase 39 Plan 01: Capa de DATOS y DERIVE de los overlays comentarios+logs Summary

**Clientes HTTP never-throws `fetchComments` (404 discriminable vía `code`) y `fetchLogs` (buffer crudo) + helper puro `grepLogs` (substring OR anti-ReDoS sobre el buffer compartido de /logs), base testeable sin host del overlay UI del Plan 02.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-06-02T10:25:25Z
- **Tasks:** 3
- **Files modified:** 4 (1 nuevo bloque de tests)

## Accomplishments
- `fetchComments` distingue 404 ("task not found") de 5xx/red ("error fetching comments") vía discriminante `code` — el invariante no-crash de TUI-15 es estructural en el data layer, nunca un throw llega a React.
- `fetchLogs` trae el buffer compartido crudo never-throws (sin discriminante de status — `/logs` siempre existe); el grep es un paso separado.
- `grepLogs` filtra por substring OR de `task_ref`/`workspace_ref` contra `entry.msg` vía `String.includes`, jamás compila regex (anti-ReDoS T-39-02); needles vacíos → `[]` (no inunda el overlay con el buffer entero, D-03).
- SC#4 (D-08) verificado: el wording de PROJECT.md sobre `/logs` ya es honesto ("best-effort substring grep, no hay session_id real") — cero cambios necesarios.

## Task Commits

Cada task se commiteó atómicamente (TDD para Tasks 1 y 2):

1. **Task 1 (RED): fetchComments/fetchLogs matriz D-07** - `5ebfac4` (test)
2. **Task 1 (GREEN): fetchComments + fetchLogs never-throws** - `d93ba3d` (feat)
3. **Task 2 (RED): grepLogs substring OR tests** - `0a22caf` (test)
4. **Task 2 (GREEN): grepLogs pure substring filter** - `93fcfef` (feat)
5. **Task 3: verificación SC#4 (D-08)** - sin commit (cero diff a PROJECT.md — wording ya correcto)

_Nota: STATE.md/ROADMAP.md NO modificados (worktree mode — el orchestrator los actualiza post-merge)._

## Files Created/Modified
- `src/cli/dashboard/client.js` - Añadidas `fetchComments` (404 discriminable + encodeURIComponent del task_id, T-39-01) y `fetchLogs` (buffer crudo). Header YAGNI actualizado: ambas funciones ya implementadas en Phase 39.
- `src/cli/dashboard/select.js` - Añadida `grepLogs` (substring OR anti-ReDoS). Header actualizado.
- `test/dashboard-client.test.js` - Matriz D-07 de ambas funciones (200/empty/404 code=not-found/500 code=http/ECONNREFUSED code=network/corrupt/bad-shape + assert de encodeURIComponent).
- `test/dashboard-select.test.js` - Bloque grepLogs (match task_ref, OR workspace_ref, case-insensitive, needles vacíos → [], no-match → [], char `.*` literal, orden preservado, msg ausente never-throws).

## Decisions Made
- `fetchComments` extiende el patrón de `fetchStatus` con discriminante `code` (no presente en fetchStatus) porque la UI debe ramificar 404 vs 5xx/red de forma distinta.
- `grepLogs` ubicado en `select.js` (capa derive) y no en `format.js` (presentación), coherente con `applyFilter`.

## Deviations from Plan

Una micro-corrección dentro del scope de la Task 2 (no es deviation de comportamiento):

**1. [Rule 3 - Blocking acceptance] Reformulado un comentario para satisfacer `grep "new RegExp" = 0`**
- **Found during:** Task 2 (grepLogs GREEN)
- **Issue:** El JSDoc de `grepLogs` contenía la cadena literal "`new RegExp`" en una frase explicativa ("JAMÁS `new RegExp`"), lo que hacía que `grep -c "new RegExp" select.js` devolviera 1 — violando el acceptance criteria que exige cero ocurrencias (el guard no es comment-aware).
- **Fix:** Reformulada la frase a "JAMÁS se compila una expresión regular" — el código nunca usó `new RegExp`; solo el comentario contenía la cadena.
- **Files modified:** src/cli/dashboard/select.js
- **Verification:** `grep -c "new RegExp" src/cli/dashboard/select.js` → 0; suite verde 18/18.
- **Committed in:** `93fcfef` (Task 2 GREEN commit)

---

**Total deviations:** 1 (acceptance-criteria compliance, sin cambio de comportamiento)
**Impact on plan:** Ninguno funcional. El anti-ReDoS estaba ya garantizado en código; solo se ajustó el wording del comentario para no disparar un falso positivo del grep.

## Issues Encountered
- `test/dashboard-select.test.js` ya existía (de Phase 36/38) — se EXTENDIÓ con el bloque grepLogs en lugar de sobrescribirlo (la primera intención de Write falló por archivo no leído, lo que confirmó su preexistencia y evitó destruir los tests de TUI-08/09/11/12).

## Observaciones (fuera de scope, NO corregidas)
- **Drift ortogonal a D-08:** PROJECT.md línea 31 menciona `cmux attach <workspace_ref>` (verbo viejo, revisado a `select-workspace` en Phase 37). El plan indica explícitamente NO corregirlo en esta fase (es ortogonal a D-08, que es solo sobre `/logs`). Anotado para una fase futura.

## Next Phase Readiness
- Plan 02 (overlay UI) tiene sus tres funciones base listas y verdes: `fetchComments`, `fetchLogs`, `grepLogs`. El invariante no-crash de TUI-15/TUI-16 está garantizado estructuralmente en el data/derive layer.
- El header del overlay de logs debe etiquetar el buffer como compartido/best-effort (D-04) — eso lo implementa el Plan 02.

## Self-Check: PASSED

- Archivos verificados: client.js, select.js, dashboard-client.test.js, dashboard-select.test.js, 39-01-SUMMARY.md (todos FOUND).
- Commits verificados: 5ebfac4, d93ba3d, 0a22caf, 93fcfef, ca0696a (todos FOUND).
- Exports verificados: fetchComments, fetchLogs, grepLogs (todos presentes).
- Suite: `node --test test/dashboard-client.test.js test/dashboard-select.test.js test/format-isolation.test.js` → 44 pass / 0 fail.

---
*Phase: 39-paneles-auxiliares-comentarios-logs*
*Completed: 2026-06-02*
