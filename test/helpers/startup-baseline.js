// Ejecutar: node test/helpers/startup-baseline.js
// Imprime: { "runs": N, "median_ms": X, "min_ms": Y, "max_ms": Z, "threshold_ms": max(50, median*1.15) }
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIN_KODO = resolve(__dirname, '..', '..', 'bin', 'kodo');
const RUNS = 10;

const durations = [];
for (let i = 0; i < RUNS; i++) {
  const t0 = process.hrtime.bigint();
  spawnSync(process.execPath, [BIN_KODO, 'check'], { stdio: 'ignore' });
  durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
durations.sort((a, b) => a - b);
const median = durations[Math.floor(RUNS / 2)];
const threshold = Math.max(50, median * 1.15);
console.log(JSON.stringify({
  runs: RUNS,
  median_ms: Number(median.toFixed(2)),
  min_ms: Number(durations[0].toFixed(2)),
  max_ms: Number(durations[RUNS - 1].toFixed(2)),
  threshold_ms: Number(threshold.toFixed(2)),
}, null, 2));
