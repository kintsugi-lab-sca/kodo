// test/startup-budget.test.js — LOG-12 startup budget (INFORMATIVE, NOT BLOCKING)
//
// === Why this test is SKIPPED ===
//
// El baseline de Wave 0 (Plan 06-01) reveló que `kodo check` NO es un vigilante
// puro: invoca `provider.listPendingTasks()` (HTTP Plane API) y potencialmente
// `launchOrchestrator()` (spawn cmux + refresh workspace). La medición
// (10 runs, ver `.planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md`)
// arroja `median=65.8s`, `min=6.2s`, `max=68s` — una distribución dominada por
// I/O de red, con dispersión 11× entre min y max.
//
// Cualquier threshold mecánico sobre esta distribución es ruido de red disfrazado
// de guardián. Decisión consolidada del planner (ver `06-CONTEXT.md` sección
// "Aislamiento del vigilante (LOG-12)", Decisión B, 2026-04-15):
//
//   1. El canal FIABLE de LOG-12 es `test/check-isolation.test.js` — walker
//      transitivo de imports. Ése garantiza que ningún path desde `src/check.js`
//      alcanza `src/logger.js`, lo cual es la restricción arquitectónica real.
//
//   2. Este test queda INFORMATIVO / no-bloqueante hasta que `src/check.js` se
//      refactorice en "status snapshot" (sin red) + "act on status" (con red).
//      Ese refactor queda explícitamente fuera del alcance de Fase 6.
//
//   3. Subir `THRESHOLD_MS` para que el test pase "verde" enmascara regresiones
//      reales de imports (si algún día `kodo check` deja de hacer I/O, un
//      threshold alto dejará pasar un import inadvertido del logger).
//      Por eso NO se recalibra — se marca como skipped.
//
// Post-phase re-measurement (ver STARTUP-BASELINE.md sección "Post-phase
// measurement", 2026-04-15 tras Plans 02-03): la distribución sigue siendo
// [min=5.9s, median=6.2s, max=65.3s], indistinguible del baseline pre-phase.
// Eso confirma que Plans 02-03 no degradaron el arranque (consistente con el
// test de isolation, que prueba no-regresión del grafo).
//
// === Cómo ejecutar la medición manualmente ===
//
// ```
// node test/helpers/startup-baseline.js
// ```
//
// Ese helper imprime el JSON con runs/median/min/max/threshold. Úsalo:
//   - Antes/después de refactorizar `src/check.js` para medir impacto real.
//   - Cuando el test de isolation falle, para cuantificar la regresión.
//   - En CI opcional (workflow separado, no bloqueante del merge).
//

import { describe, it } from 'node:test';

describe('LOG-12: startup budget (informative, non-blocking)', () => {
  it.skip(
    'kodo check startup budget — see header for Decision B rationale',
    () => {
      // Implementación preservada para reactivación futura (tras refactor de
      // src/check.js que separe status snapshot del act). Si algún día
      // `kodo check` pasa a ser un vigilante puro, cambiar `it.skip` a `it`
      // y recalibrar THRESHOLD_MS desde `node test/helpers/startup-baseline.js`.
      //
      // const { spawnSync } = await import('node:child_process');
      // const { resolve, dirname } = await import('node:path');
      // const { fileURLToPath } = await import('node:url');
      // const __dirname = dirname(fileURLToPath(import.meta.url));
      // const BIN_KODO = resolve(__dirname, '..', 'bin', 'kodo');
      // const THRESHOLD_MS = 50; // post-refactor target (aspirational, LOG-12)
      // const RUNS = 5;
      // const durations = [];
      // for (let i = 0; i < RUNS; i++) {
      //   const t0 = process.hrtime.bigint();
      //   const res = spawnSync(process.execPath, [BIN_KODO, 'check'], { stdio: 'ignore' });
      //   assert.equal(res.status, 0);
      //   durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
      // }
      // durations.sort((a, b) => a - b);
      // const median = durations[Math.floor(RUNS / 2)];
      // assert.ok(median < THRESHOLD_MS, `median ${median}ms > ${THRESHOLD_MS}ms`);
    },
  );
});
