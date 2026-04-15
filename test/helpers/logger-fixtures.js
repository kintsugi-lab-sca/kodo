import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Crea un HOME temporal y lo setea en process.env.HOME ANTES de cargar logger.js.
 * Devuelve { homeDir, logPath, cleanup } donde cleanup elimina el dir.
 * @param {{ sessionId: string, label?: string }} opts
 */
export function makeTmpHome({ sessionId, label = 'logger' }) {
  const homeDir = join(tmpdir(), `kodo-${label}-${Date.now()}-${process.pid}`);
  process.env.HOME = homeDir;
  const logPath = join(homeDir, '.kodo', 'logs', `${sessionId}.ndjson`);
  return {
    homeDir,
    logPath,
    cleanup() { rmSync(homeDir, { recursive: true, force: true }); },
  };
}

/**
 * Lee y parsea todas las líneas NDJSON de un archivo de log.
 * @param {string} logPath
 * @returns {Array<object>}
 */
export function readAllLines(logPath) {
  const raw = readFileSync(logPath, 'utf-8');
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}
