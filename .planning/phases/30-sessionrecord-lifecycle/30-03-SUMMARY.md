---
phase: 30-sessionrecord-lifecycle
plan: 03
subsystem: stop-hook
tags:
  - stop-hook
  - idempotency
  - cr-01-closure
  - gap-closure
  - phase-30
requires:
  - phase-30-01 (LIFE-01 findSession history-scan landed)
provides:
  - cr-01-closed (stop hook idempotency restored)
  - test/hooks/stop-idempotency.test.js (regression coverage)
affects:
  - src/hooks/stop.js (5-LOC discriminator)
tech-stack:
  added: []
  patterns:
    - "Tagged-union early-return: discriminate findSession result.source before applying side-effects"
key-files:
  created:
    - test/hooks/stop-idempotency.test.js
  modified:
    - src/hooks/stop.js
decisions:
  - "Discriminator implemented in stop.js (caller-side filter) rather than findSession opt-in flag. Preserves findSession's utility for verify.js + session-start.js read flows; keeps the surgical 5-LOC scope of the gap closure."
  - "Discriminator placed AFTER the !result guard (between lines 145 and 147 in the new layout), NOT before. The plan's <action> wording 'antes del if (!result)' is overridden by the REVIEW.md code template and by defensive ordering — accessing result.source while result might be null would throw."
  - "console.error chosen over logger.info to stay consistent with the rest of the hook (lines 131, 135, 158, 192). The fail-open semantic uses console.error for diagnostics; the structured logger captures observable events that downstream consumers parse."
metrics:
  duration: "~10 min"
  completed: "2026-05-20T12:03:14Z"
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  loc_added: 9
  loc_removed: 0
requirements_addressed:
  - LIFE-01
---

# Phase 30 Plan 03: CR-01 Closure — Stop Hook Idempotency Summary

CR-01 del code review queda cerrado: el doble-scan de `findSession` (Phase 30 LIFE-01) ya no rompe la idempotencia natural del stop hook. Discriminator de 5 LOC en `src/hooks/stop.js` + test de regresión que ejecuta el escenario RED→GREEN explícitamente. Suite global: 882 pass / 0 fail (vs target ≥881).

## What changed

### `src/hooks/stop.js` — 9 líneas añadidas

Bloque insertado entre el `if (!result)` handler (línea 134-145, sin cambios) y el `const { id, session } = result;` (línea 155, sin cambios):

```js
// Phase 30 LIFE-01 CR-01: findSession ahora escanea state.history. El stop
// hook NO debe re-procesar sesiones archivadas — el primer trigger ya hizo
// cleanup. Re-procesar emite eventos duplicados (state.transition, session.end,
// segundo nudge) y puede tocar workspaces reasignados o worktrees ya removidos.
if (result && result.source === 'history') {
  console.error(`[kodo:stop] Session ${result.session.task_ref} already archived — skip`);
  return;
}
```

Posición clave: AFTER el `!result` guard (sin riesgo de TypeError sobre `result.source`) y BEFORE setColor / markSessionStatus / sessionEnd / worktree-cleanup / removeSession / buildStopNudgeText. El short-circuit es `return`, no `throw` — preserva fail-open behavior del hook (nunca crashea Claude Code).

Ningún otro caller de `findSession` se tocó. `verify.js#84` y `session-start.js#203` siguen leyendo entradas de history porque sus flujos son READ-only (verify lee VERIFICATION.md desde el worktree; session-start solo verifica que la sesión exista para arrancar Claude). LIFE-01 SC#1 (read flows ven entries archivadas) se preserva intacto.

### `test/hooks/stop-idempotency.test.js` — 250 líneas, 1 `describe`, 1 `it`

Nuevo test file siguiendo el scaffold de `test/stop-state-transition.test.js`:

- HOME-isolation con `mkdtempSync` + `process.env.HOME` override (evita pollutar `~/.kodo/state.json` real).
- Dynamic import POST-HOME para que `KODO_DIR` del módulo `state.js` resuelva al tmpdir aislado.
- `makeLogger()` memSink (events array sobrevive a `.child(...)`).
- `makeCmuxStub()` (registra setColor/notify/listWorkspaces/send sin conectar a cmuxd).
- Usa **el `findSession` real** (no mock) para que la transición `state.sessions → state.history` ocurra a través del removeSession real durante la primera invocación — observa el bug end-to-end.

Escenario único: dos invocaciones consecutivas de `runStopHook` con el mismo `session_id`. La primera procesa la sesión completamente (1 setColor, 1 state.transition, removeSession real). La segunda, post-fix, NO debe emitir `state.transition` (`markSessionStatus` skipped), NO `session.end`, NO `cmux.setColor`, NO `cmux.send` (nudge), NO `removeSession`. `state.history.length === 1` (no se duplica).

## Tasks Executed

| Task | Name                                                                 | Commit    | Files                                           |
| ---- | -------------------------------------------------------------------- | --------- | ----------------------------------------------- |
| 1    | Test idempotencia — runStopHook 2 veces, segunda es no-op (RED)      | `c0faea2` | `test/hooks/stop-idempotency.test.js` (+250)    |
| 2    | Discriminator source==='history' en stop.js (GREEN)                  | `20acabe` | `src/hooks/stop.js` (+9)                        |

## TDD Cycle

| Phase    | State | Evidence                                                                                              |
| -------- | ----- | ----------------------------------------------------------------------------------------------------- |
| RED      | ✅    | Pre-fix `node --test test/hooks/stop-idempotency.test.js` → 1 fail, expected=0 / actual=1 state.transition |
| GREEN    | ✅    | Post-fix same command → 1 pass, 0 fail. Suite combinada con stop-state-transition + find-session: 9 pass / 0 fail |
| REFACTOR | n/a   | 5-LOC scope no requiere refactor                                                                       |

## Verification

```
$ grep -c "result.source === 'history'" src/hooks/stop.js
1
$ grep -c "already archived" src/hooks/stop.js
1
$ node --test test/hooks/stop-idempotency.test.js test/stop-state-transition.test.js test/session/find-session.test.js
9 pass / 0 fail / 0 cancelled / 0 skipped
$ npm test
883 tests / 182 suites / 882 pass / 0 fail / 1 skipped / duration 21.8s
```

Suite total post-fix: **882 pass / 0 fail / 1 skipped**, supera el target del plan (`≥881 pass + 0 fail`). El test "skipped" es preexistente (no relacionado con este plan).

## Decisions Made

1. **Posición del discriminator: caller-side en stop.js, no opción en findSession.**
   El REVIEW.md ofrecía una alternativa (`findSession({activeOnly:true})` opt-in). Elegimos el discriminator en el caller porque (a) preserva la semántica positiva del LIFE-01 D-04 (las 3 lookup keys operan idénticamente sobre history), (b) los otros callers (`verify.js`, `session-start.js`) tienen flujos READ legítimos sobre history y opt-out caso-por-caso sería ruido, (c) 5 LOC vs. ampliar firma + cambiar tipos + actualizar tres callers.

2. **Posición física: AFTER `if (!result)` guard.**
   El `<action>` del plan dice "antes del if (!result)" pero el código template del REVIEW.md y del plan está después. Implementación sigue el template (defensivo: accederar `result.source` antes del null-check arrojaría TypeError). Documentado aquí porque hay drift textual en el plan que un futuro lector debe entender.

3. **`console.error`, no logger estructurado.**
   El hook usa `console.error` consistentemente para mensajes diagnósticos (líneas 131, 135, 158, 192, 218, 259, 302, 378, 383, 399). El logger estructurado solo emite eventos observables (`state.transition`, `session.end`, `worktree.cleanup.*`). El "already archived — skip" es informativo de control-flow, no un evento de dominio. Consistente con la convención del archivo.

## Deviations from Plan

### Decisión textual divergente entre `<action>` y código template

- **Found during:** Task 2 (read del bloque pre-fix).
- **Issue:** El `<action>` del plan instruye "DESPUÉS de findSessionFn ... y ANTES del `if (!result)`" pero el código template del mismo plan (y de REVIEW.md) coloca el bloque DESPUÉS del `if (!result)`.
- **Fix:** Implementación sigue el template (la posición lógicamente correcta — accederar `result.source` sin null-check arrojaría TypeError si findSession retorna null). Documentado en Decisions Made §2.
- **Files modified:** `src/hooks/stop.js`
- **Commit:** `20acabe`
- **Rule:** N/A — interpretation drift dentro del propio plan, no fix correctivo.

Ningún otro deviation. Plan ejecutado quirúrgicamente.

## LIFE-01 SC#1 Compatibility (read-flow preservation)

`findSession` sigue devolviendo entradas de history con `source: 'history'`. Los callers de read-only que dependen de ese comportamiento mantienen su contrato:

- `src/gsd/verify.js#~84` — `kodo gsd verify <session-id>` resuelve sesiones archivadas (driver original ROMAN-132).
- `src/hooks/session-start.js#~203` — bootstrap lookup tolera sesiones que ya transicionaron.
- Cualquier futuro `kodo logs --session-of <task-id>` que escanee history.

Solo el stop hook recibió el filter. La idempotencia natural se restaura sin sacrificar la utilidad multi-flow del helper.

## Threat Flags

Ningún nuevo threat surface introducido. El cambio es defensivo (reduce side-effects sobre estados ya archivados); no abre endpoints, no toca auth ni schemas.

## Known Stubs

Ninguno. El test usa `findSession` real (no stub) precisamente para observar el bug end-to-end. El cmux stub y el logger memSink son test infrastructure estándar, no stubs de production code.

## Self-Check: PASSED

- [x] `test/hooks/stop-idempotency.test.js` existe (250 líneas).
- [x] `src/hooks/stop.js` contiene `result.source === 'history'` (grep = 1).
- [x] `src/hooks/stop.js` contiene `already archived` (grep = 1).
- [x] Commit `c0faea2` existe (RED test).
- [x] Commit `20acabe` existe (GREEN fix).
- [x] `node --test test/hooks/stop-idempotency.test.js` exits 0.
- [x] `node --test test/stop-state-transition.test.js` exits 0 (regression intacta).
- [x] `node --test test/session/find-session.test.js` exits 0 (LIFE-01 intacto).
- [x] `npm test` retorna 882 pass / 0 fail (≥881 target alcanzado).
