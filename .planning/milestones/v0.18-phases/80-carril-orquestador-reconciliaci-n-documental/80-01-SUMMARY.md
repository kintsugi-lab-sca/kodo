---
phase: 80-carril-orquestador-reconciliaci-n-documental
plan: 01
subsystem: check / orchestrator lane
tags: [ORCH-07, sidebar-doctor, piggyback, LOG-12, fail-open, DI]
requires:
  - src/cmux/sidebar-doctor.js (scan/execute, Phase 79)
  - src/orchestrator/launch.js (launchOrchestrator)
provides:
  - runCheckAndAct con carril orquestador in-process (ORCH-07)
affects:
  - src/check.js
  - src/logger-events.js
tech-stack:
  added: []
  patterns:
    - DI opcional con defaults de producción (espejo de checkPendingTasks)
    - piggyback fail-open per-lane (espejo del catch de launchOrchestrator)
    - convergencia observable por import-graph guard (espejo de pending.js ORCH-05)
key-files:
  created: []
  modified:
    - src/check.js
    - src/logger-events.js
    - test/check.test.js
    - test/check-isolation.test.js
decisions:
  - "El doctor corre in-process (import directo scan/execute), NO subproceso (D-01)"
  - "Gate estricto needsOrchestrator; doctor antes de launch (D-03/D-05)"
  - "Resultado del doctor jamás entra a reasons/needsOrchestrator (D-04)"
  - "deps {} → noopLogger; LOG-12 preservado (grafo sin logger.js)"
metrics:
  duration: ~10min
  completed: 2026-07-23
status: complete
---

# Phase 80 Plan 01: Carril orquestador (ORCH-07) Summary

Cableado del carril orquestador: `runCheckAndAct` ejecuta el `--fix` del sidebar
doctor (`scan`+`execute`) **in-process** de piggyback, gated por
`needsOrchestrator`, **antes** de `launchOrchestrator`, fail-open, y sin que el
resultado del doctor alimente jamás el gate (D-04). LOG-12 preservado y verificado
por un guard de convergencia nuevo.

## What Was Built

### Task 1 — Piggyback in-process en `runCheckAndAct` (TDD)
- **`src/check.js`**: import directo `{ scan, execute }` desde `./cmux/sidebar-doctor.js`
  (mismo estilo que `launchOrchestrator`/`fetchFreshPending`). Importa SOLO `scan`/`execute`
  — nunca `logger.js` ni un cliente de provider.
- `runCheckAndAct` refactorizado a firma DI opcional
  `runCheckAndAct({ runCheckFn, scanFn, executeFn, launchFn, logFn, errorFn } = {})`,
  espejo de `checkPendingTasks`. `await runCheckAndAct()` sin args sigue byte-idéntico
  para el caller de `src/cli.js:141`.
- Dentro de `if (result.needsOrchestrator)`, ANTES de la línea `Launching orchestrator`
  (orden D-05): bloque piggyback en su propio try/catch — `scanFn(deps)` (read-only para
  advisories) + `executeFn(deps, { fix: true })` (converge `loose→add`, `empty→ungroup`),
  con `deps = {}` (→ `noopLogger`). Líneas resumen deterministas por stdout con prefijo
  `[kodo:check]` (`Sidebar: N acción(es) aplicadas`, y si `hasAdvisories`,
  `Sidebar advisories: N (acción de operador)`). El catch (`Sidebar doctor error: <msg>`)
  es el espejo exacto del de `launchOrchestrator`.
- Commits TDD: `test(80-01)` d6f1e97 (RED, 3 subtests rojos) → `feat(80-01)` 630cc68 (GREEN, 22/22).

### Task 2 — Guard LOG-12 (convergencia) + comentario stale
- **`test/check-isolation.test.js`**: aserción POSITIVA nueva
  `it('kodo check reaches src/cmux/sidebar-doctor.js ... (convergence, ORCH-07)')`, espejo
  de la de `pending.js`. Los 4 guards negativos de prohibición (`logger.js`,
  `github/provider.js`, `github/normalize.js`, `triggers/polling.js`) siguen verdes CON el
  nuevo import en el grafo — prueba de que el import no arrastra los módulos prohibidos.
- **`src/logger-events.js`** (~L21): comentario del invariante LOG-12 corregido a la
  realidad post-Phase-80 (`check.js → sidebar-doctor.js → logger-events.js` SÍ alcanza el
  módulo, pero sigue siendo pure transform zero-side-effect: imports solo `node:os`+`node:path`;
  el prohibido es `logger.js`, no este helper). Cambio de solo-comentario.
- Commit: `test(80-01)` 4021995.

## Verification

- `node --test test/check.test.js test/check-isolation.test.js` → 33/33 verde.
- Criterios de aceptación Task 1: import presente ✓, sin `child_process|spawn|execFile` ✓,
  sin ANSI inline ✓, `runCheckAndAct()` sin args no lanza al importar ✓.
- Criterios Task 2: convergencia hacia `sidebar-doctor.js` verde + 4 guards negativos verdes ✓;
  frase stale eliminada del código ✓; `git diff --stat src/logger-events.js` solo comentario ✓.
- `src/orchestrator/launch.js` sin diffs (Pitfall 3) ✓.
- `runCheck()` byte-idéntico: su cuerpo no contiene líneas `Sidebar` (Test E) ✓.
- **Bordes ORCH-07 (a–d)** cubiertos: Test B (edge a, gate OFF), Test C (edge c, D-04),
  Test D/D2 (edge b, fail-open); edge d (convergencia sin bucle) heredado del motor Phase 79.

## Deviations from Plan

None — plan ejecutado exactamente como está escrito.

## Deferred Issues

- **`test/cli/polling-verbose.test.js` — flaky de timing (Phase 28 DAEMON-01), PREEXISTENTE
  y ajeno a este plan.** En `npm test` completo falló 1 subtest en una pasada (`polling start
  --verbose`) por timing del spawn del daemon; en la segunda pasada de `npm test` y en dos
  ejecuciones aisladas del fichero pasó 6/6. No toca ningún fichero de este plan (`check.js` /
  `sidebar-doctor` / `polling` son grafos disjuntos). Fuera de scope (SCOPE BOUNDARY): no se
  arregla aquí. Suite full: 2354/2356 pass, 1 skip, 1 flaky.

## Known Stubs

Ninguno. El carril consume el motor real `scan`/`execute` de Phase 79; sin datos mock ni
placeholders.

## Self-Check: PASSED
