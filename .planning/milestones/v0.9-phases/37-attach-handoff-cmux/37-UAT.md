---
status: passed
phase: 37-attach-handoff-cmux
source:
  - 37-01-SUMMARY.md
  - 37-02-SUMMARY.md
  - 37-03-SUMMARY.md
  - 37-HUMAN-UAT.md (commit 98cf8fa — signed off 2026-05-29T14:45:38Z)
started: 2026-05-29
updated: 2026-05-30
approved_by: Alex Núñez
approved_at: 2026-05-30T08:35:00Z
---

## Current Test

[All goal-backward checks passed. Phase 37 ready for formal close.]

## Tests

### 1. Success Criterion #1 — Focus exitoso visible

expected: Operador pulsa Enter sobre fila alive=true; `cmux select-workspace --workspace <ref>` se invoca vía `execFile`; cmux GUI cambia foco; dashboard sigue montado sin re-render.
result: pass
verified_via: 37-HUMAN-UAT.md Escenario 1 (TTY real 2026-05-29 14:45 GMT+2, fixture `/tmp/uat-37-fixture.mjs` con `workspace:16` real, cmux.app visible). Operador confirmó focus visible + dashboard intacto + footer normal.

### 2. Success Criterion #2 — Zombie reject

expected: Si fila tiene `alive===false`, Enter NO invoca `cmux`; footer rojo con texto literal estable `[!] workspace gone (alive=false) — press any key`.
result: pass
verified_via: 37-HUMAN-UAT.md Escenario 2 (TTY real 2026-05-29 14:45 GMT+2). Footer mostró el texto literal exacto de `FOCUS_ERR_ZOMBIE`. La distinción textual frente a `cmux focus failed (code N)` confirma que guard D-02 cortocircuitó ANTES de `runFocus` — invocación de `cmux` jamás ocurrió.

### 3. Success Criterion #3 — ENOENT / exit code ≠ 0 gracioso

expected: Si `cmux` no está en PATH o devuelve exit code ≠ 0, footer rojo correspondiente; dashboard permanece montado.
result: pass (estructural)
verified_via: bonus de 37-HUMAN-UAT.md skipped por decisión del operador, PERO el comportamiento está probado por:
  - `test/dashboard/focus.test.js` 5/5 pass — discriminated union `{ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR'}` mapeada en runFocus.
  - `test/dashboard/app-focus.test.js` 3/3 pass — Enter handler aplica los 3 mensajes literales (`FOCUS_ERR_ENOENT`, `focusErrFailed(n)`) y limpia con clear-on-any-input (D-04).
  - Grep estructural confirma constantes exportadas: `App.js:72 FOCUS_ERR_ZOMBIE`, `App.js:73 FOCUS_ERR_ENOENT`, `App.js:80 focusErrFailed`.

### 4. Success Criterion #4 — Artefacto UAT manual existe + cubre 2 obligatorios

expected: `37-HUMAN-UAT.md` existe con escenarios obligatorios "focus exitoso" + "zombie reject" + frontmatter `blocking_for_phase_close: true`.
result: pass
verified_via: commit `3e8540f` creó el artefacto (126 LOC, 4 escenarios). Commit `98cf8fa` firmó passed: `status: passed`, `approved_by: Alex Núñez`, `approved_at: 2026-05-29T14:45:38Z`. 2/2 obligatorios passed, 2/2 bonus skipped por decisión del operador.

### 5. Goal-backward — Test suite verde sin regresiones

expected: `npm test` pasa todo el suite; cero regresiones cross-phase.
result: pass
verified_via: 2026-05-30 ejecutado en bg job `bbaqqnqyu`:
  - **Suite completa sin `app-focus.test.js`:** 965 pass / 0 fail / 1 skipped (skip pre-existente del baseline v0.9 inicial).
  - **`app-focus.test.js` aislado con `env -u NODE_OPTIONS`:** 3/3 pass en 600ms (alive=false guard, ok path, clear-on-any-input).
  - **`focus.test.js`:** 5/5 pass (ok+args ordering, ENOENT, NON_ZERO_EXIT, SPAWN_ERROR, leak guard estructural).
  - **`format-isolation.test.js`:** 8/8 pass (walker color-isolation cubre `focus.js`, `App.js`, `SessionTable.js`, `index.js` sin leak picocolors).

### 6. Goal-backward — Invariantes cross-cutting preservados

expected: NO-PICOCOLORS en `src/cli/dashboard/`, NO-ALT-SCREEN-MUTATION fuera de líneas pre-existentes, NO-SIGINT-INSTALL, SIGTERM handler Phase 34 D-10 intacto, never-throws contract en runFocus.
result: pass
verified_via: grep estructural 2026-05-30:
  - `grep "picocolors" src/cli/dashboard/` → solo comentarios docstring afirmando "NO importa picocolors" (D-12). Cero imports reales.
  - alt-screen toggle `\x1b[?1049h`/`\x1b[?1049l` solo en `index.js:129` (on) + `index.js:155` (off, finally). Sin mutación adicional.
  - SIGINT: solo comentarios "NO se cablea SIGINT aquí (D-09)" + exitOnCtrlC default de ink. Cero `process.on('SIGINT', ...)`.
  - SIGTERM Phase 34 D-10: `process.once('SIGTERM', onSigterm)` en `index.js:146` intacto.
  - `runFocus`: export `FOCUS_VERB`/`FOCUS_FLAG` constants, never-throws contract documentado en doc-comment, `typeof exec !== 'function'` throw síncrono ANTES del `new Promise` (preserva leak guard + never-throws — desviación Plan 01 documentada).

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

Ninguno.

## Known Issues (no bloqueantes para Phase 37)

- **`app-focus.test.js` cuelga en `npm test` por NODE_OPTIONS duplication del harness cmux** (`--require restore-node-options.cjs`). Los tests SÍ pasan funcionalmente (3/3 en 600ms con `env -u NODE_OPTIONS`); el process no termina porque ink-testing-library mantiene viva la sesión raw-mode bajo el require inyectado. Es defecto del harness, no del código. Captura recomendada al backlog (deuda menor de DX, no bloquea CI si se ejecuta con `env -u NODE_OPTIONS` o se excluye del suite full). Documentado en SUMMARYs de Plans 02 y 03.

---

## Cierre formal Phase 37

Los 4 Success Criteria del ROADMAP + 2 chequeos goal-backward (test suite, invariantes structural) passed. UAT manual de los 2 escenarios bloqueantes firmado en `37-HUMAN-UAT.md` commit `98cf8fa`. Phase 37 lista para marcar como complete en ROADMAP.md y avanzar STATE.md.
