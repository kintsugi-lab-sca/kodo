# Phase 30: SessionRecord Lifecycle - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar el desync `state.json ↔ cmux` que ROMAN-132 confirmó empíricamente el 2026-05-15 (sesión seguía viva en cmux mientras `state.sessions = {}`) via 2 refactors quirúrgicos en el lifecycle de SessionRecord:

1. **LIFE-01** — `findSession(query)` en `src/session/state.js` extiende su scan para cubrir `state.history` además de `state.sessions`. Cuando una sesión ya pasó por `removeSession` (stop hook), `kodo gsd verify <session-id>` y `kodo logs --session-of <task-id>` siguen devolviendo el SessionRecord histórico — NO el error "session not found".

2. **LIFE-02** — `markSessionStatus(taskId, status, reason, log)` en `src/session/manager.js` refactoriza su path de falsy `task_id`: en vez de bail-out silencioso (hoy `updateSession` hace `if (state.sessions[taskId])` y no-op), emite `log.warn` observable y retorna shape determinístico. Callers existentes (`verify.js#finalize`, `stop.js`) preservan su semántica externa (try/catch silencioso intacto).

**Out of scope** (decisiones explícitas — NO entran en este phase):
- cmux RPC cross-check (`cmux rpc workspace.list` antes de declarar terminada). Diferido a Phase 30.1 si el desync resurge tras el doble-scan de LIFE-01.
- Refactors de `addSession` / `removeSession` / `updateSession`. Solo se tocan `findSession` y `markSessionStatus`.
- Reescritura del flujo de `state.history` (FIFO 50-slot vigente en `removeSession` queda intacto).

</domain>

<decisions>
## Implementation Decisions

### findSession (LIFE-01)

- **D-01:** Return shape **tagged**: `{ id, session, source: 'sessions' | 'history' }`. Discriminated union explícita — alineado con el patrón del dispatcher (`{action, code}`). Callers existentes que solo usan `r.session` siguen funcionando sin cambio; futuros callers (verify.js#84, logs --session-of) pueden reaccionar distinto a `source: 'history'` sin parsear `archived_at` timestamps.
- **D-02:** Cuando una entry está en sessions Y en history (post `removeSession` que mantiene la entry en sessions hasta el `delete state.sessions[taskId]` — caso degenerado), **priority sessions**. SC#3 del ROADMAP lo lockea.
- **D-03:** Para history entries, `id` = `session.task_id` (sintetizado del propio record). History entries NO tienen key real (son items de un array), pero el shape `{id, session}` se preserva para compatibilidad con verify.js#84 etc.
- **D-04:** Las 3 lookup keys actuales (`sessionId`, `workspaceRef`, `cwd`) operan idénticas sobre history entries (mismo shape gracias a `removeSession` que hace `{...removed, archived_at}`).

### markSessionStatus (LIFE-02)

- **D-05:** Return shape **simétrico completo**:
  - Success: `{ ok: true, from: <prevStatus>, to: <nextStatus> }`
  - Falsy task_id: `{ ok: false, reason: 'missing-task-id' }`
  Discriminated union completa. `from, to` ayudan a observabilidad si el caller los loguea (deferred — solo si surge necesidad).
- **D-06:** Callers existentes (`verify.js#267`, `stop.js#188`) NO capturan el return value (ambos llaman fire-and-forget dentro de try/catch). Por SC#2 ROADMAP, su semántica externa se preserva intacta. Cualquier futuro caller que destructure `{ok}` opera sobre shape determinístico.
- **D-07:** Nueva firma del signature: `markSessionStatus(taskId, nextStatus, reason, logger, sessionId?)`. El **5º parámetro `sessionId` es opcional**. Callers existentes pasan `session.session_id` (lo tienen en scope: verify.js#267 y stop.js#188). Si no se provee, el warn registra `session_id: 'unknown'`.
- **D-08:** Warn payload literal byte-exact: `log.warn('markSessionStatus: missing task_id', { session_id, status, reason })`. SC#2 ROADMAP lockea las keys `{session_id, status, reason}`.
- **D-09:** Cuando `task_id` es falsy, NO se llama a `updateSession(...)` (early return tras el warn). Esto preserva la semántica de no-op silencioso pero ahora con observabilidad.

### Test Layout

- **D-10:** Tests viven en subdirectorio nuevo `test/session/`:
  - `test/session/find-session.test.js` — 3 escenarios (en sessions, en history, en ambos = priority sessions, en ninguno = not found). El SC#3 dice "3 escenarios" pero la lista del SC enumera 4 — interpretación: 4 tests, label "3 escenarios" se refiere a las 3 ramas no-null (presente/ausente/priority).
  - `test/session/mark-status.test.js` — 4 escenarios (task_id presente → success shape + status transition, null → warn + return, undefined → warn + return, empty string → warn + return).
- **D-11:** Convención existente del proyecto es flat (`test/session-start.test.js`, `test/session-of-resolver.test.js`). Phase 30 introduce el subdirectorio porque el ROADMAP SC#3 lo lockea explícitamente. Tests existentes flat NO se mueven (alcance fuera de phase).

### Scope Boundaries

- **D-12 [deferred]:** cmux RPC cross-check **diferido**. Si tras LIFE-01 el desync persiste empíricamente (nuevo incidente tipo ROMAN-132), se planifica Phase 30.1 con `cmux rpc workspace.list` cross-check. La memoria del usuario `kodo_state_json_desync.md` registra la observación; Phase 30 no la cierra estructuralmente.
- **D-13:** Phase 30 cierra **CR-01 Phase 19 deferred** (findSession debe escanear state.history) y **WR-07 Phase 22 deferred** (markSessionStatus early-return refactor) en STATE.md v0.7 deferred section. SC#4 lo lockea.

### Suite Floor

- **D-14:** Suite global post-Phase-30 ≥825 pass + 0 fail. Floor explícito en SC#4. Baseline post-Phase-29 = 873 pass + 1 skip — Phase 30 añade ~7 tests netos (4 mark-status + 3 find-session). Target real ≥880 pass.

### Claude's Discretion

- **Internal helper extraction**: Si `findSession` se vuelve ilegible al añadir el segundo scan loop, Claude puede extraer un helper privado `findInBucket(bucket, query)` reutilizable. No requiere decisión explícita.
- **JSDoc updates**: Actualizar JSDoc de `findSession` para documentar el nuevo `source` field y de `markSessionStatus` para el nuevo signature + return shape. Discreción de Claude.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements

- `.planning/ROADMAP.md` §"Phase 30: SessionRecord Lifecycle" — Goal + 4 SCs observables + dependencies (Phase 29).
- `.planning/REQUIREMENTS.md` §LIFE-01 + §LIFE-02 — Driver completo (ROMAN-132 2026-05-15) + cerraje cross-milestone (CR-01 Phase 19 + WR-07 Phase 22).

### Existing Source (anchor files)

- `src/session/state.js` — `findSession` (líneas 180-196), `removeSession` (líneas 127-142) define el shape de history entries, `loadState`/`saveState` para el estado.
- `src/session/manager.js` — `markSessionStatus` (líneas 352-360), JSDoc en 348-352.
- `src/gsd/verify.js:84` + `:267` — callers reales de findSession + markSessionStatus en producción.
- `src/hooks/stop.js:188` — caller de markSessionStatus con `session.task_id` y `session.session_id` en scope (D-07).
- `src/hooks/session-start.js:203` — caller de findSession con `{sessionId, cwd}`.

### Codebase Maps (already-generated overviews)

- `.planning/codebase/ARCHITECTURE.md` — Si existe sección de session lifecycle / state machine, leer antes de planning.
- `.planning/codebase/STRUCTURE.md` — Estructura `src/session/` y `test/session/` (este último a crear).
- `.planning/codebase/TESTING.md` — Convenciones de test paths + patterns existentes (flat vs subdirectorio).

### Prior Phases (decisions inherited)

- `.planning/phases/19-*` Phase 19 — Introdujo `findSession` original. CR-01 (deferred bug: state.history scan) deja documento aquí.
- `.planning/phases/22-*` Phase 22 — Introdujo `markSessionStatus`. WR-07 (early-return refactor) deja documento aquí.
- `.planning/phases/29-gsd-provider-reporting-integration/29-CONTEXT.md` — Phase previa, define el patrón de D-NN decision-recording que Phase 30 sigue.
- `.planning/phases/28-polling-daemon-hardening/28-CONTEXT.md` — Define convención de tests con seam testing (`KODO_TEST_FORCE_THROW`) — puede ser útil para mark-status path.

### Memoria del usuario (no en repo, contexto operacional)

- `kodo_state_json_desync.md` — Memoria que registra el desync; Phase 30 cierra parcialmente (LIFE-01) pero la nota persiste hasta que el cmux cross-check (Phase 30.1 condicional) se implemente.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `loadState()` (state.js:93): retorna el state completo con `sessions` (object) + `history` (array). Reutilizable directo en findSession extendido.
- `removeSession()` (state.js:127): define el shape canónico de history entries (`{...removed, archived_at: ISO}`). Garantía implícita para D-04: history entries tienen `session_id`, `workspace_ref`, `project_path` (mismos campos que sessions, los 3 lookup keys de findSession).
- `state.history` slice 50 (state.js:136): el cap implícito; findSession no necesita preocuparse del tamaño (lookup O(n) sobre array de ≤50 es trivial).
- Patrón discriminated union `{action, code}` del dispatcher (Phase 29-01): plantilla para el return shape `{id, session, source}` de findSession y `{ok, ...}` de markSessionStatus.
- `noopLogger` (state.js): logger fallback para callers sin instrumentación. markSessionStatus puede usar `logger || noopLogger` para no romper si caller pasa undefined.

### Established Patterns

- **Defensive helper shape** (Phase 29-01 `isGsdChild`): tolera null/undefined/non-array. markSessionStatus puede aplicar el patrón al `taskId` check (`Boolean(taskId)` es suficiente; sin necesidad de Array.isArray).
- **Test naming prefix `REQ-ID:`** (QUICK-08/GH-05 + Phase 29 REPORT-NN): tests describe blocks llevan prefix con req ID. Phase 30 → `LIFE-01 — findSession scans history` + `LIFE-02 — markSessionStatus falsy task_id observability`.
- **Logger child con component + task_id** (state.js / manager.js): `logger.child({component: 'session', task_id: taskId})`. En el path falsy, el child se construye sin task_id (que sería null/undefined) — Claude decide si emitir warn desde logger raw o child sin task_id.
- **Try/catch silent en callers** (verify.js#266-269, stop.js#187-189): los callers actuales NO capturan return de markSessionStatus + envuelven en try/catch. SC#2 preserva esta semántica externa — el cambio de return shape NO afecta a callers existentes (no destructuran).

### Integration Points

- **session-start.js#203 (findSession)**: opera sobre `{sessionId, cwd}`. Con D-01 tagged shape, recibe `source` adicional — actualmente el caller solo verifica truthy + `result.session`. Sin breaking change.
- **verify.js#84 (findSession)**: `const r = findSession(q); if (!r) ...; r.session.task_ref ...`. Con D-01, opcional check futuro `if (r.source === 'history') ...` para rechazar verify sobre sesiones archived (out of scope para Phase 30, pero el `source` tagged lo habilita).
- **verify.js#267 + stop.js#188 (markSessionStatus)**: ambos tienen `session.session_id` en scope → llaman al nuevo signature `markSessionStatus(task_id, status, reason, log, session.session_id)`. Pequeño cambio en 2 callsites.
- **logs --session-of (en `src/cli/` o equivalente)**: SC#1 menciona que debe funcionar con findSession extendido. Si usa findSession directo, gana funcionalidad sin cambio. Si usa otra path (búsqueda directa en sessions), Phase 30 debe adaptarlo. Researcher confirma.

</code_context>

<specifics>
## Specific Ideas

- **Warn message byte-exact**: `'markSessionStatus: missing task_id'` (SC#2 lockea). Mantener literal con espacios exactos.
- **History entry priority**: Cuando una entry aparece en sessions Y history, sessions wins (SC#3 ROADMAP). Importante porque el flow de `removeSession` deja un window microscópico donde una entry puede existir en ambos (entre `unshift` y `delete`).
- **Test scenarios (locked en SC#3)**:
  - find-session.test.js: en sessions, en history, en ambos (priority sessions), en ninguno (not found).
  - mark-status.test.js: task_id presente (OK), null, undefined, empty string (los 3 últimos → warn + `{ok:false, reason:'missing-task-id'}`).

</specifics>

<deferred>
## Deferred Ideas

- **cmux RPC cross-check** (`cmux rpc workspace.list` antes de declarar terminada): mencionado en LIFE-01 requirement como resolución parcial. Diferido a Phase 30.1 condicional — solo se planifica si el desync resurge tras Phase 30. Memoria `kodo_state_json_desync.md` mantiene la observación viva.
- **`updateSession` para archived sessions**: si un caller quisiera actualizar status de una sesión que ya está en history, el comportamiento actual (updateSession opera sobre `state.sessions[taskId]` que ya no existe) es no-op silencioso. Phase 30 NO toca esto — observabilidad limitada. Si surge necesidad, abrir nuevo phase.
- **`markSessionStatus` async logging**: el warn actual es sincrónico. Para drift futuro con sink externo (Sentry, etc.), considerar wiring async. Out of scope.
- **`findSession` con TTL/cache**: para perf en suites grandes con muchos lookups. No necesario hoy (history cap 50).
- **Renombrar tests existentes flat → subdirectorio**: alineamiento con D-10 podría sugerir mover `test/session-start.test.js` etc. a `test/session/`. Out of scope para Phase 30 (mass-rename = scope creep).

### Reviewed Todos (not folded)

None — no había pending todos para Phase 30 (matches=0 en `gsd-sdk query todo.match-phase 30`).

</deferred>

---

*Phase: 30-sessionrecord-lifecycle*
*Context gathered: 2026-05-20*
