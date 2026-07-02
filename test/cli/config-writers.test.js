// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ─────────────────────────────────────────────────────────────────────────────
// SETUP-05 — invariante single-writer del wizard `kodo config` (interactiveConfig)
//
// Blindaje source-level (molde de config.test.js:85-105 «anti-inline» +
// config-env-writer.test.js:320-342 «doesNotMatch sobre el cuerpo de una función»).
//
// SETUP-05 es "una fontanería, varios consumidores": el wizard headless (readline)
// y el dashboard (TUI enmascarado) DEBEN converger en los mismos escritores de
// `config.js` — `saveConfig` / `saveProjects` para lo estructural y `writeEnvVar`
// para el secreto. El wizard, además, comprueba la PRESENCIA de la API key
// (`getProviderApiKey`) pero NUNCA captura su VALOR (D-10/D-11): el valor entra
// EXCLUSIVAMENTE por el campo enmascarado del dashboard. Este test fija esos
// invariantes leyendo la fuente y aseverando `doesNotMatch` de los vectores de
// divergencia/fuga sobre el cuerpo de `interactiveConfig`.
//
// Disciplina (Pitfall 11): describimos los sinks por concepto; jamás incrustamos
// el nombre literal de la env var del secreto ni su valor en las cadenas del test.
// ─────────────────────────────────────────────────────────────────────────────

const source = readFileSync(new URL('../../src/cli.js', import.meta.url), 'utf-8');

// `interactiveConfig` es la última función del módulo: el cuerpo va desde su
// declaración hasta el final del fichero (mismo molde de recorte por índice que
// config-env-writer.test.js:325-329, que corta hasta el siguiente `export {`).
const START = 'async function interactiveConfig()';
const startIdx = source.indexOf(START);
const body = source.slice(startIdx);

// Cuerpo sin comentarios (bloque + línea + líneas JSDoc): las aserciones deben
// mirar el código ejecutable, no las notas que mencionan los vectores prohibidos.
// Molde canónico de config.test.js:90-95.
const bodyCode = body
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
  .join('\n');

describe('SETUP-05 — interactiveConfig converge en los escritores compartidos', () => {
  it('la función interactiveConfig existe en src/cli.js (contrato del wizard)', () => {
    assert.ok(startIdx >= 0, 'no se encontró async function interactiveConfig en src/cli.js');
  });

  it('persiste config/proyectos SOLO vía saveConfig/saveProjects (no writers directos)', () => {
    // Escritura estructural: los únicos escritores son los importados de config.js.
    assert.match(bodyCode, /\bsaveConfig\s*\(/, 'el wizard debe persistir config vía saveConfig');
    assert.match(bodyCode, /\bsaveProjects\s*\(/, 'el wizard debe persistir proyectos vía saveProjects');
    // Ningún camino escribe config.json/.env a mano (write directo = vector de divergencia).
    assert.doesNotMatch(
      bodyCode,
      /\b(writeFileSync|writeFileAtomic|renameSync)\s*\(/,
      'writer directo de fichero en interactiveConfig — todo debe ir por saveConfig/saveProjects/writeEnvVar',
    );
  });

  it('comprueba la PRESENCIA de la key (getProviderApiKey) sin capturar su valor (D-10/D-11)', () => {
    // El chequeo es de presencia: getProviderApiKey, no un prompt del valor.
    assert.match(
      bodyCode,
      /\bgetProviderApiKey\s*\(/,
      'el wizard debe comprobar la presencia de la key vía getProviderApiKey',
    );
    // El wizard NO escribe el secreto: writeEnvVar es exclusivo del campo enmascarado
    // del dashboard (D-11). Su ausencia aquí ⇒ el wizard nunca captura/escribe el valor.
    assert.doesNotMatch(
      bodyCode,
      /\bwriteEnvVar\s*\(/,
      'interactiveConfig no debe escribir el valor del secreto — el valor entra solo por el campo enmascarado del dashboard (D-11)',
    );
  });

  it('NO shell-out del secreto: sin child_process/execFile/spawn/exec (Pitfall 11)', () => {
    // El vector de mayor riesgo (P11) es el argv de un subprocess con el secreto.
    assert.doesNotMatch(bodyCode, /child_process/, 'interactiveConfig no debe importar child_process');
    assert.doesNotMatch(
      bodyCode,
      /\b(execFile|spawn|execSync|exec)\s*\(/,
      'interactiveConfig no debe shell-out (ningún subprocess con el secreto en argv)',
    );
  });

  it('la lista de proveedores del wizard es la canónica [plane, github] (D-05)', () => {
    // Misma fuente de verdad que el selector del dashboard: mata el drift provider.
    assert.match(
      bodyCode,
      /\[\s*'plane'\s*,\s*'github'\s*\]/,
      'el wizard debe ofrecer la lista canónica de proveedores [plane, github]',
    );
  });
});
