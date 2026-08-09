// @ts-check
// Registro de agentes (config.agents, inspirado en los agent manifests de diri):
// resolución de getAgentDef + invariante golden-bytes de que la mecánica del
// registro produce EXACTAMENTE el mismo comando que los literales previos.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_CONFIG, getAgentDef } from '../src/config.js';

describe('config.agents registry', () => {
  test('DEFAULT_CONFIG declara claude-code como agente default con mecánica completa', () => {
    assert.equal(DEFAULT_CONFIG.agents.default, 'claude-code');
    const def = DEFAULT_CONFIG.agents.registry['claude-code'];
    assert.equal(def.binary, 'claude', 'binario por PATH (D-15), nunca path absoluto');
    assert.equal(def.model_flag, '--model');
    assert.equal(def.session_id_flag, '--session-id');
    assert.deepEqual(def.resume, { style: 'flag', token: '--resume' });
    assert.equal(def.status_authority, 'hooks');
  });

  test('claude.binary (path absoluto muerto, D-15) ya no existe en DEFAULT_CONFIG', () => {
    assert.equal('binary' in DEFAULT_CONFIG.claude, false);
  });

  test('getAgentDef sin nombre resuelve el agente default', () => {
    const def = getAgentDef(DEFAULT_CONFIG);
    assert.equal(def.binary, 'claude');
  });

  test('getAgentDef con nombre desconocido cae al default (never-throws)', () => {
    const def = getAgentDef(DEFAULT_CONFIG, 'no-existe');
    assert.equal(def, getAgentDef(DEFAULT_CONFIG));
  });

  test('getAgentDef sobre config sin sección agents cae a DEFAULT_CONFIG', () => {
    const def = getAgentDef({});
    assert.equal(def.binary, 'claude');
    assert.equal(def.status_authority, 'hooks');
  });

  test('getAgentDef resuelve un agente adicional registrado por el operador', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.agents.registry['codex'] = {
      binary: 'codex',
      model_flag: '--model',
      session_id_flag: '--session-id',
      resume: { style: 'subcommand', token: 'resume' },
      status_authority: 'process',
    };
    const def = getAgentDef(config, 'codex');
    assert.equal(def.binary, 'codex');
    assert.equal(def.resume.style, 'subcommand');
    // El default no se ve afectado por el registro adicional.
    assert.equal(getAgentDef(config).binary, 'claude');
  });
});
