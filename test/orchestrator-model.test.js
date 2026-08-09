// @ts-check
//
// KODO-12 — el orquestador va SIEMPRE con su propio modelo (`claude.orchestrator_model`,
// default `fable`), desacoplado del de las sesiones de trabajo (`claude.default_model`).
//
// Cubre la función PURA `buildOrchestratorCommand` (espejo de `buildClaudeCommand` en
// session/manager.js) + el default de `DEFAULT_CONFIG`. Sin I/O, sin cmux, sin claude:
// la función no toca disco ni red, así que el test es hermético por construcción.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrchestratorCommand } from '../src/orchestrator/launch.js';
import { DEFAULT_CONFIG } from '../src/config.js';

/** Config mínimo: buildOrchestratorCommand solo lee `config.claude.*`. */
function makeConfig(claude) {
  return /** @type {any} */ ({ claude: { flags: [], ...claude } });
}

describe('KODO-12 — DEFAULT_CONFIG.claude.orchestrator_model', () => {
  it('el default del orquestador es fable', () => {
    assert.equal(DEFAULT_CONFIG.claude.orchestrator_model, 'fable');
  });

  it('el default de las sesiones de trabajo NO cambia (sigue opus)', () => {
    assert.equal(DEFAULT_CONFIG.claude.default_model, 'opus');
  });
});

describe('KODO-12 — buildOrchestratorCommand', () => {
  it('emite --model desde orchestrator_model, NO desde default_model', () => {
    const cmd = buildOrchestratorCommand(
      makeConfig({ default_model: 'opus', orchestrator_model: 'fable' }),
      'sess-1',
      'hola',
    );
    assert.match(cmd, /--model fable/);
    assert.doesNotMatch(cmd, /--model opus/);
  });

  it('con el DEFAULT_CONFIG real el orquestador arranca en fable', () => {
    const cmd = buildOrchestratorCommand(DEFAULT_CONFIG, 'sess-2', 'hola');
    assert.match(cmd, /--model fable/);
  });

  it('cae a default_model si un config parcial no trae orchestrator_model', () => {
    const cmd = buildOrchestratorCommand(makeConfig({ default_model: 'sonnet' }), 'sess-3', 'hola');
    assert.match(cmd, /--model sonnet/);
  });

  it('preserva el resto del contrato: KODO_ORCHESTRATOR=1, --session-id y flags extra', () => {
    const cmd = buildOrchestratorCommand(
      makeConfig({ orchestrator_model: 'fable', flags: ['--dangerously-skip-permissions'] }),
      'sess-4',
      'hola',
    );
    assert.ok(cmd.startsWith('KODO_ORCHESTRATOR=1 claude '), `prefijo de entorno esperado\n${cmd}`);
    assert.match(cmd, /--session-id sess-4/);
    assert.match(cmd, /--dangerously-skip-permissions/);
  });

  it('el prompt va entre comillas simples y las simples internas se escapan', () => {
    const cmd = buildOrchestratorCommand(
      makeConfig({ orchestrator_model: 'fable' }),
      'sess-5',
      "no 'toques' $(whoami)",
    );
    assert.ok(cmd.endsWith("'no '\\''toques'\\'' $(whoami)'"), `escape de comillas simples\n${cmd}`);
  });
});
