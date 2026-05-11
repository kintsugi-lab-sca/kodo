---
phase: 17-phase-7-uat-automation
plan: 01
subsystem: tests
tags: [uat, integration-test, logs-follow, subprocess]
requires: [src/logs/follow.js, src/cli.js, bin/kodo]
provides: [test/logs-follow-integration.test.js]
affects: [v0.5/Phase-17/SC#1]
tech_stack_added: [node:test integration pattern with spawn child_process + HOME-isolated tmpdir]
patterns: [mkdtempSync HOME override (CR-02 Phase 16) adapted to subprocess child env, awaitLine event-driven assertion]
key_files_created:
  - test/logs-follow-integration.test.js
key_files_modified: []
decisions:
  - "D-01..D-07 del CONTEXT cubiertos: subprocess real, HOME aislado en child env (no global), 3 batches con setInterval ≥FOLLOW_INTERVAL_MS, awaitLine inline strict order, SIGINT cleanup con waitForExit 2s, archivo NDJSON pre-creado vacío"
  - "Predicate string-match sobre línea humana de logger.js#formatLine (rama useColor=false del child con stdio:'pipe') en lugar de JSON.parse — el plan describía un predicate JSON pero el child sin --json emite formato humano. Documentado como deviation Rule 1 inline"
metrics:
  duration_minutes: 12
  test_runtime_ms: ~1300
  completed_date: 2026-05-10
---

# Phase 17 Plan 01: UAT-01 logs --follow integration test Summary

Convierte el UAT humano de Phase 7 (`07-HUMAN-UAT.md` test #1, `kodo logs --follow` con tail real + cleanup limpio del watcher) en integration test automatizado bajo `node:test`. Spawnea `bin/kodo logs <session-id> --follow` como child real con HOME aislado, escribe progresivamente 3 batches NDJSON al archivo objetivo, verifica con orden estricto que el child los emite a stdout según se appendean (tail real, no fake), y cierra el watcher vía SIGINT con timeout duro de 2s.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Crear test/logs-follow-integration.test.js con dump-0 + tail real + SIGINT cleanup | c322f96 | test/logs-follow-integration.test.js |

## Files Created

- `test/logs-follow-integration.test.js` — 248 líneas, 1 test `it()` cubre UAT-01 SC#1 end-to-end.

## Files Modified

Ninguno.

## D-decisions Covered

| Decision | Implementation |
|----------|----------------|
| D-01 (subprocess real) | `spawn(process.execPath, [KODO_BIN, 'logs', sessionId, '--follow'], …)` — NO import directo de `followFile` |
| D-02 (HOME aislado) | `mkdtempSync(join(tmpdir(), 'kodo-uat-follow-'))` + `env: { ...process.env, HOME: tmpHome }` en el spawn. NO override de `process.env.HOME` global del runner. `after()` con `rmSync(tmpHome, { recursive: true, force: true })` |
| D-03 (no `KODO_DIR` público) | No introducido. Solo HOME override |
| D-04 (3 batches con ≥250ms) | Loop sobre `[{seq:1},{seq:2},{seq:3}]` con `appendFileSync(logFile, sentinel + '\n')` y sleep `250ms` entre cada uno (≥ `FOLLOW_INTERVAL_MS=200`) |
| D-05 (awaitLine strict order) | Helper inline `awaitLine(stream, predicate, timeoutMs, description)` con cleanup de listeners y timeout 2000ms. `await awaitLine(seq=N)` antes de appendear seq=N+1 |
| D-06 (SIGINT + waitForExit 2s) | `child.kill('SIGINT')` + `waitForExit(child, 2000)` con assert `code === 0` |
| D-07 (pre-crear NDJSON vacío) | `writeFileSync(logFile, '')` ANTES del spawn. Path "existe pero vacío" → dump-0 + tail; el path "waiting for session log to appear" queda fuera de scope (deferred) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Predicate JSON.parse no era compatible con la salida real del child**
- **Found during:** Task 1 (sketch del predicate antes del primer run)
- **Issue:** El plan sugería el predicate `(line) => { try { const r = JSON.parse(line); return r.event === 'test.batch' && r.seq === expectedSeq; } catch { return false; } }`. Pero el child se spawnea SIN `--json` (D-04 prohíbe el flag para no ampliar scope), y `src/logs/reader.js#printLine` (líneas 80-104) llama a `formatLine(rec, { useColor })` que con `useColor=false` (caso `stdio:'pipe'` del child) emite shape humano `${time} ${lvl}${comp} ${msg}${ctx}` — NO NDJSON crudo. El predicate JSON nunca matchearía esa línea.
- **Fix:** Cambiar el predicate a string-match sobre la línea humana formateada: `(line) => line.includes('event=test.batch') && line.includes('seq=' + seq)`. `formatCtxInline` (logger.js:72-83) serializa los campos no-base como `+event=test.batch seq=N timestamp=…`, así que ambas substrings aparecen literalmente. Determinismo: `event=test.batch` no choca con ningún `EVENTS.*` canónico (verificado en threat register T-17-01-05 del plan).
- **Files modified:** `test/logs-follow-integration.test.js` (predicate inline + comentario de doc explicando la decisión)
- **Commit:** c322f96 (incluido en el commit del task)

### Auth Gates

Ninguna — el test es 100% local (subprocess + filesystem tmpdir).

## Verification Results

- `node --test test/logs-follow-integration.test.js` → exit 0, 1 test pass, ~1.3s
- `node --test` (suite completa) → exit 0, 508 tests pass, 0 fail, 1 skip pre-existente (startup-budget Decisión B), 137s total
- 3 ejecuciones consecutivas verdes (1322ms / 1321ms / 1306ms): determinismo confirmado bajo carga normal
- Sin regresiones detectadas en la suite existente

### Acceptance Criteria Grep Checks (all pass)

| Check | Result |
|-------|--------|
| `spawn(process.execPath` | 2 hits |
| `mkdtempSync` | 4 hits |
| `'kodo-uat-` | 2 hits |
| `HOME: tmpHome` | 1 hit |
| `KODO_BIN` + `'logs'` + `'--follow'` | 2 / 3 / 4 hits |
| `appendFileSync` + `'test.batch'` | 2 / 6 hits |
| `seq: 1` / `seq: 2` / `seq: 3` | 3 / 3 / 3 hits |
| `awaitLine` | 7 hits |
| `kill('SIGINT')` | 2 hits |
| `'exit'` | 4 hits |
| `2000` (timeout) | 2 hits |
| `writeFileSync(.*, '')` | 1 hit |
| `process.env.FOLLOW_INTERVAL_MS\s*=` (negative) | 0 hits |
| `from.*src/logs/follow` (negative) | 0 hits |

## Observed SIGINT Cleanup Behavior

- Exit code observado: **0** (consistent en 3 runs)
- Tiempo entre `child.kill('SIGINT')` y `'exit'` event: << 2000ms (timeout duro nunca alcanzado en runs verdes)
- Test runtime total: ~1.3s (350ms startup buffer + 3 × ~250ms sleeps + ~50-100ms para SIGINT round-trip)

## Threat Register Status

Las 5 entradas STRIDE del plan se mantienen mitigadas/aceptadas tal cual:

- T-17-01-01 (DoS watcher cleanup): mitigada por `waitForExit(child, 2000)` que falla loud si el watcher leakea
- T-17-01-02 (HOME override scope): mitigada por env del child (no toca runner)
- T-17-01-03 (leaked tmpdir): mitigada por `after()` con `rmSync(recursive: true, force: true)`
- T-17-01-04 (flaky timing): mitigada por márgenes ≥50ms sobre poll interval (350ms startup, 250ms inter-batch); tres runs deterministicos lo confirman
- T-17-01-05 (sentinel collision): aceptada — `event:'test.batch'` no choca con ningún `EVENTS.*` canónico

Severity gate: 0 high / 0 medium-high. Plan cierra sin nuevas amenazas.

## Threat Flags

Ningún nuevo surface security-relevante introducido (test-only, sin cambio en producción).

## Self-Check: PASSED

- File `test/logs-follow-integration.test.js`: FOUND
- Commit `c322f96`: FOUND
- Suite global: PASSED (508/507 + 1 skip)
- Determinism: PASSED (3 consecutive runs)
