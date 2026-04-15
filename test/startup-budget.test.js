import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_KODO = resolve(__dirname, '..', 'bin', 'kodo');

// Derivado de .planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md
// Fórmula: max(50, median_baseline * 1.15). Re-medir si cambia CI host o si
// se refactoriza kodo check para eliminar I/O de red / spawn cmux.
// NOTA: el baseline actual (~65s median) refleja que kodo check NO es puro;
// ver STARTUP-BASELINE.md para el análisis completo.
const THRESHOLD_MS = 75623.08;
const RUNS = 5;

describe('LOG-12: startup budget', () => {
  it(`kodo check median of ${RUNS} runs is under ${THRESHOLD_MS}ms`, () => {
    const durations = [];
    for (let i = 0; i < RUNS; i++) {
      const t0 = process.hrtime.bigint();
      const res = spawnSync(process.execPath, [BIN_KODO, 'check'], { stdio: 'ignore' });
      assert.equal(res.status, 0, `kodo check failed with status ${res.status}`);
      durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(RUNS / 2)];
    assert.ok(
      median < THRESHOLD_MS,
      `median startup ${median.toFixed(1)}ms exceeds ${THRESHOLD_MS}ms budget (runs: ${durations.map(d => d.toFixed(1)).join(', ')})`,
    );
  });
});
