// @ts-check
//
// test/dashboard/focus-wiring.test.js — KODO-32.
//
// Guard estructural del CABLEADO de `onFocus` en `runDashboard`. Complementa
// test/dashboard/app-focus.test.js (que verifica el COMPORTAMIENTO con un `onFocus`
// inyectado) cerrando el agujero que ese test no puede ver: la prop real que
// `src/cli/dashboard/index.js` pasa a `<App />`.
//
// Bug que motiva el test (KODO-32): KODO-18 renombró `cmuxBin` → `hostBin` al hacer
// el binario dependiente del host activo, pero la prop `onFocus` siguió leyendo
// `cmuxBin`. En un módulo ESM esa referencia muerta NO falla al importar: revienta con
// `ReferenceError: cmuxBin is not defined` la primera vez que el operador pulsa Enter
// o `O` sobre el TUI ya montado — es decir, en producción y no en la suite.
//
// Por qué source-assertion y no un test de comportamiento: `runDashboard` exige TTY
// real (guard non-TTY con `process.exit(1)`), monta ink contra `process.stdout` y hace
// I/O de config; ejercitarlo entero desde node:test costaría más de lo que vale. Mismo
// patrón y misma justificación que test/dashboard-altscreen.test.js (Phase 36 hot-patch),
// que cubre por source-assertion el toggle del alternate screen buffer.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', '..', 'src', 'cli', 'dashboard', 'index.js');

/**
 * Devuelve el fuente sin comentarios de línea ni de bloque, para que las asserciones
 * miren CÓDIGO y no la prosa de los comentarios (este archivo está densamente comentado
 * y las menciones históricas a variables retiradas son legítimas ahí).
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('KODO-32: cableado de onFocus en runDashboard', () => {
  test('onFocus se cablea al verbo del contrato `host.selectWorkspace`', () => {
    const code = stripComments(readFileSync(INDEX_PATH, 'utf8'));
    assert.match(
      code,
      /onFocus:\s*async\s*\(ref\)\s*=>\s*host\.selectWorkspace\(ref\)/,
      'onFocus DEBE delegar en `host.selectWorkspace(ref)` — el host ya se construye con el ' +
        'binario del host ACTIVO (getHost(hostName, { exec, binary: hostBin })). Cablearlo a ' +
        '`runFocus` directo reintroduce dos bugs: la referencia al binario fuera del host, y el ' +
        'verbo cmux `select-workspace --workspace` disparado contra el binario de orca.',
    );
  });

  test('no quedan referencias en CÓDIGO a `cmuxBin` (variable retirada por KODO-18)', () => {
    const code = stripComments(readFileSync(INDEX_PATH, 'utf8'));
    assert.doesNotMatch(
      code,
      /\bcmuxBin\b/,
      '`cmuxBin` ya no existe: KODO-18 la sustituyó por `hostBin`. Cualquier uso en código es una ' +
        'referencia muerta que NO falla al importar el módulo — crashea el TUI con ReferenceError ' +
        'en el primer Enter/`O` del operador (KODO-32).',
    );
  });

  test('el binario del host se resuelve a `hostBin` según el host activo', () => {
    const code = stripComments(readFileSync(INDEX_PATH, 'utf8'));
    assert.match(
      code,
      /const\s+hostBin\s*=/,
      'la resolución del binario debe seguir viviendo en `hostBin` (KODO-18)',
    );
    assert.match(
      code,
      /getHost\(\s*hostName\s*,\s*\{\s*exec:\s*execImpl,\s*binary:\s*hostBin\s*\}\s*\)/,
      'el host se instancia con el host activo y su binario — es el único punto que decide el ' +
        'dialecto (cmux vs orca) para TODOS los verbos del contrato, onFocus incluido.',
    );
  });
});
