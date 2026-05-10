---
phase: 17-phase-7-uat-automation
plan: 02
subsystem: uat-automation
tags: [uat, integration-test, session-start, hook, fail-loud, ndjson, contract-assert]
requires: [src/hooks/session-start.js, src/logger-events.js, src/session/state.js, src/logger.js]
provides: [test/session-start-event.test.js]
affects: []
tech_stack:
  added: []
  patterns:
    - "subprocess spawn pattern para integration test del hook (D-01) — primera vez aplicado a un hook (no a `bin/kodo`)"
    - "mkdtempSync + HOME override + dynamic import (CR-02 pattern) replicado en contexto subprocess (D-02)"
    - "fail-loud externo compensa silent try/catch de subsistema bajo test (D-10) — patrón nuevo en kodo, aplicable a futuros UAT-03 y a tests de cualquier subsistema con outer try/catch"
key_files:
  created:
    - test/session-start-event.test.js
  modified: []
decisions:
  - "Importar EVENTS estáticamente desde src/logger-events.js (D-09) — el módulo es stdlib-only puro y no depende de HOME, así que importarlo eager es seguro y mantiene la simplicidad"
  - "Pre-crear ${tmpHome}/.kodo/logs/ aunque el logger ya lo crea con mkdirSync recursive — defense-in-depth: si el bootstrap del logger falla silenciosamente bajo el outer try/catch, queremos que el fail-loud apunte a 'no escribió el file' y no a 'directorio no existe'"
  - "child.stdin.end() inmediatamente tras write — readStdin() resuelve via 'end' event en <50ms vs el timeout de 3s del hook; el test corre en ~75ms en cold cache"
  - "project_path: tmpHome para que cwd-fallback de findSession matchee como defensa secundaria si el hash session_id falla; el primary path sigue siendo session_id exact match"
  - "stderr capturado solo para diagnostics en mensajes de fail-loud — el contrato del hook es exit code + NDJSON file, stderr es prose"
metrics:
  duration: "~25 min"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  tests_added: 1
  tests_total_after: "507 pass + 1 skip pre-existente (suite global)"
completed_date: "2026-05-10"
---

# Phase 17 Plan 02: UAT-02 Session Start Event Integration Test Summary

UAT-02 (`session.start` emite los 6 campos canónicos D-10) automatizado como integration test que spawnea `src/hooks/session-start.js` con stdin canónico y assertea contra el contrato `EVENTS.SESSION_START` + signature `sessionStart()`, con fail-loud externo cubriendo el silent outer try/catch del hook.

## Objective Recap

Convertir el UAT humano #2 de Phase 7 (`07-HUMAN-UAT.md`) en cobertura programática que:
- Ejerce el path REAL del hook (no import directo del helper) — disparado como subprocess.
- Assertea contra el CONTRATO del helper (`EVENTS.SESSION_START` + las 6 keys D-10), no contra fixture estático — cambiar el contrato rompe el test (SC#2).
- Compensa el silent-on-failure outer try/catch del hook (líneas 223-225) con fail-loud externo que distingue 3 modos de falla.
- Reproduce el flujo Plane → Claude Code start sin Plane vivo, vía state.json sintético + stdin JSON.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | UAT-02 integration test (spawn hook + addSession + 6 keys assert + fail-loud) | `27e17bd` | `test/session-start-event.test.js` (created, 231 lines) |

## D-Decisions Covered

### Cross-cutting (D-01, D-02 — transversales a UAT-01/02/03)

- **D-01 spawn subprocess real**: `spawn(process.execPath, [HOOK_PATH], {stdio: ['pipe','pipe','pipe']})` — no se importa `sessionStart()` directamente; se ejerce el wiring `readStdin → JSON.parse → findSession → createLogger → sessionStart` que Claude Code dispara en producción.
- **D-02 HOME override + dynamic import**: `mkdtempSync(join(tmpdir(), 'kodo-uat-session-start-'))` + `process.env.HOME = tmpHome` + `await import('../src/session/state.js')` DESPUÉS de fijar HOME. El subprocess recibe `HOME=tmpHome` via env. Cleanup `rmSync(tmpHome, {recursive: true, force: true})` en `after()`.

### UAT-02 específicas (D-08..D-11)

- **D-08 state.json sintético + stdin**: `addSession(session.task_id, session)` (importado dinámicamente post-HOME) escribe `${tmpHome}/.kodo/state.json`. El subprocess recibe stdin JSON `{session_id, transcript_path, cwd}` y `child.stdin.end()` cierra inmediatamente para que `readStdin()` resuelva en <50ms (vs timeout interno 3s del hook).
- **D-09 import estático del contrato**: `import { EVENTS } from '../src/logger-events.js'` — el módulo es stdlib-only puro. Asserts incluyen:
  - `record.event === EVENTS.SESSION_START` (cambiar el valor en `logger-events.js` rompe el test, exactamente lo que SC#2 pide).
  - Las 6 keys canónicas presentes con tipos correctos (`session_id`, `task_id`, `provider`, `project_path`, `transcript_path`, `started_at`).
  - Loop `requiredKeys` que falla si una key falta (defensa contra refactors silenciosos del helper).
- **D-10 fail-loud externo (3 paths cubiertos)**:
  1. **File ausente** → `assert.fail('D-10 fail-loud: hook did not emit session.start NDJSON file at ' + ndjsonPath + ...)`. Cubre el caso "el outer try/catch tragó un crash de bootstrap del logger" (e.g. `createLogger()` lanza, `mkdirSync` falla, etc.).
  2. **JSON malformed** → `try { JSON.parse(raw[0]) } catch (e) { assert.fail('D-10 fail-loud: first line malformed: ' + raw[0] + ...) }`. Cubre escritura parcial o truncada.
  3. **Event mismatch** → `assert.equal(record.event, EVENTS.SESSION_START, 'D-09: first event must equal EVENTS.SESSION_START. Got: ' + JSON.stringify(record))`. Cubre el caso "se emitió otro evento primero" (regresión por insertar callsite extra en bootstrap del hook).
- **D-11 sesión sintética no-GSD**: `gsd: false` aísla el test de `buildGsdContext()`/builder quick — `session.start` está fuera del switch de modo (líneas 188-208 del hook), así que es invariante al modo. Una variante basta. Las variantes GSD full/quick quedan deferred si surge regresión.

## NDJSON Record Shape Observed

Primera línea del archivo `${tmpHome}/.kodo/logs/<session_id>.ndjson` tras spawn del hook:

```jsonc
{
  // Campos del wrapper logger (timestamp, level, component, etc.) están presentes
  // pero no son parte del contrato session.start — el test los ignora.
  "event": "session.start",                              // EVENTS.SESSION_START (D-09)
  "session_id": "uat02-<pid>-<epoch_ms>",                // del stdin
  "task_id": "kodo-uat02-task-<pid>",                    // de la sesión en state.json
  "provider": "plane",                                   // de la sesión
  "project_path": "<tmpHome>",                           // de la sesión
  "transcript_path": "/tmp/fake-transcript-<sid>.jsonl", // del stdin (no auto-resuelto porque venía explícito)
  "started_at": "2026-05-10T15:14:23.456Z"               // ISO-8601, generado por new Date().toISOString() en el hook
}
```

Las 6 keys requeridas por D-10 verificadas presentes y con tipo correcto. Test pasa el loop `requiredKeys` que itera y assertea `k in record` para cada una.

## Fail-loud Paths Exercised vs Not

| Path | Triggered en run normal | Modo de regresión que lo dispararía |
|------|-------------------------|--------------------------------------|
| `existsSync(ndjsonPath) === false` → `assert.fail` | NO (path nominal) | Crash silencioso en bootstrap del logger (mkdirSync, createLogger, child import) tragado por outer try/catch del hook |
| `JSON.parse(raw[0])` throws → `assert.fail` | NO | Escritura parcial/truncada del NDJSON sink (fsync interrumpido, file system full, race condition entre child y test reader) |
| `record.event !== EVENTS.SESSION_START` → `assert.fail` | NO | Refactor que insertara un callsite logger.info() ANTES de `sessionStart()` en el hook, o cambio del valor de `EVENTS.SESSION_START` en `logger-events.js` |

Los 3 paths son **defense-in-depth**: en runs verdes ninguno dispara, pero cualquier regresión en uno de los 3 los activa con mensaje específico que apunta al contrato violado.

## Verification

- **Test específico**: `node --test test/session-start-event.test.js` exit 0 (1 test, 1 pass, ~75ms).
- **Determinismo**: 3 ejecuciones consecutivas verdes (`for i in 1 2 3; do node --test test/session-start-event.test.js; done` exit 0 las 3 veces, durations 169/184/175ms).
- **Suite global**: `node --test` exit 0 — **507 pass + 1 skip** pre-existente (baseline 506+1, +1 test nuevo, **0 regresiones**).
- **Acceptance criteria grep checks**: 15/15 verdes
  - `EVENTS.SESSION_START` (8 occurrences) ✓
  - `import { EVENTS } from '../src/logger-events.js'` (estático) ✓
  - `spawn(process.execPath` ✓
  - `HOOK_PATH` referenciado ✓
  - `mkdtempSync` + `'kodo-uat-session-start-'` ✓
  - `HOME: tmpHome` (child env) ✓
  - `await import('../src/session/state.js')` (post-HOME) ✓
  - `addSession(` ✓
  - `child.stdin.write(` + `child.stdin.end()` ✓
  - `gsd: false` ✓
  - `assert.fail(` 5 occurrences (≥2 requerido) ✓
  - 6 keys canónicas presentes en assert strings ✓
  - `requiredKeys` loop ✓
  - 0 mocks/stubs de findSession/createLogger ✓
  - 0 imports directos de `sessionStart` (D-01: path real, no helper bajo test) ✓

## Regressions Detected

Ninguna. La suite global pasó de 506 pass + 1 skip a **507 pass + 1 skip**. El skip pre-existente (`startup-budget`, Decisión B Phase 6) sigue intacto.

## Deviations from Plan

Ninguna deviation Rule 1/2/3 aplicada — el plan se ejecutó tal cual. Una micro-corrección formal (cosmetic, no funcional):

- **Reformatting de la llamada `spawn(...)`**: el plan especificaba el call multi-línea `spawn(process.execPath, [HOOK_PATH], {...})` con line break tras `spawn(`. El acceptance criterion #3 grep busca el literal `spawn(process.execPath` en una sola línea. Compactado a una sola línea para que el grep pase sin perder legibilidad. Cero impacto funcional.

## Self-Check: PASSED

- [x] `test/session-start-event.test.js` exists at expected path (231 lines).
- [x] Commit `27e17bd` exists in `git log --all --oneline`.
- [x] `node --test test/session-start-event.test.js` exits 0.
- [x] Full suite `node --test` exits 0 (507 pass + 1 skip).
- [x] 3 ejecuciones consecutivas del test verdes (deterministic).
- [x] 15/15 acceptance criteria grep checks verdes.

## Threat Flags

Ninguno. Todos los threat IDs T-17-02-01..06 del threat_model del plan están cubiertos por las decisiones de implementación (HOME override pre-import, rmSync cleanup, fail-loud externo, stdin.end() inmediato). No se introduce nueva superficie de ataque ni nuevo trust boundary.
