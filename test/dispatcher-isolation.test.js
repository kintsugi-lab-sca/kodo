import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
const DISPATCHER_PATH = join(SRC, 'triggers', 'dispatcher.js');

/**
 * Strip block comments + line comments + JSDoc continuation lines.
 * Used by source-hygiene tests that want to assert literal-absence in CODE
 * (not in documentation prose). Comments in dispatcher.js documenting the
 * historical contract D-14 (Phase 9) mention 'gsd.phase.resolved' literally
 * and must be tolerated — this helper filters them out.
 *
 * Mirrors test/stop.test.js:62-67 (Phase 13 source-hygiene).
 *
 * NOTE (WR-08 Phase 16 closure via Phase 22): inline comments at end of code lines
 * are NOT stripped. Esto es intencional — si un test futuro mencionara
 * 'gsd.phase.resolved' en un comentario inline al final de una línea de código, el
 * match sobre el código real sería válido y el test debería capturarlo. Para evitar
 * falsos positivos, mantén las menciones literales en líneas dedicadas (//-only).
 *
 * @param {string} src
 * @returns {string} the source with all comment lines removed
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('LOG-13: dispatcher source hygiene (Phase 16 SC#1)', () => {
  it('does not contain literal "gsd.phase.resolved" in non-comment code (uses EVENTS.GSD_PHASE_RESOLVED)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes("'gsd.phase.resolved'") && !stripped.includes('"gsd.phase.resolved"'),
      'src/triggers/dispatcher.js must not contain literal "gsd.phase.resolved" in code ' +
        '(use EVENTS.GSD_PHASE_RESOLVED). Comments documenting the historical contract are allowed.',
    );
  });

  it('does not contain literal "gsd.bootstrap" in non-comment code (uses EVENTS.GSD_BOOTSTRAP or gsdBootstrap helper)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes("'gsd.bootstrap'") && !stripped.includes('"gsd.bootstrap"'),
      'src/triggers/dispatcher.js must not contain literal "gsd.bootstrap" in code ' +
        '(use EVENTS.GSD_BOOTSTRAP or the gsdBootstrap helper).',
    );
  });

  it('imports EVENTS from logger-events.js (forces wiring — Phase 16 D-02)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    // Path relative from src/triggers/dispatcher.js to src/logger-events.js es '../logger-events.js'.
    // Acepta la forma `import { EVENTS } from '...'` o `import { EVENTS, ... } from '...'`
    // (named import, posiblemente con extras como gsdBootstrap).
    assert.match(
      source,
      /import\s+\{[^}]*\bEVENTS\b[^}]*\}\s+from\s+['"]\.\.\/logger-events\.js['"]/,
      'dispatcher.js must import { EVENTS } from "../logger-events.js" (Phase 16 D-02 wiring)',
    );
  });
});
