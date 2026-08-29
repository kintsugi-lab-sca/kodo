// @ts-check
//
// KODO-19 — elección de agente por etiqueta (`kodo:cc` / `kodo:oc`).
//
// Cubre las tres capas del carril, de dentro hacia fuera:
//   1. `getAgentName` / `resolveAgentName` — la taxonomía de etiquetas (labels.js).
//   2. `DEFAULT_CONFIG.agents.registry.opencode` — la mecánica declarada (config.js).
//   3. `buildAgentCommand` — la línea que se teclea en el workspace (manager.js).
//
// El invariante que atraviesa el fichero entero es el de NO REGRESIÓN: sin etiqueta de
// agente, todo tiene que comportarse byte a byte como antes de esta tarea. Los golden
// bytes de Claude Code viven en test/manager.test.js y siguen ahí sin tocar; aquí se
// verifica la otra mitad — que la rama de OpenCode existe y no contamina la de Claude.

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { getAgentName, AGENT_LABELS, parseKodoLabels } from '../src/labels.js';
import { DEFAULT_CONFIG, getAgentDef } from '../src/config.js';
import { buildAgentCommand, resolveAgentName, mapAgentModel, buildSessionFromTask } from '../src/session/manager.js';

/** @returns {any} config mínima — buildAgentCommand solo lee claude.default_model y agents. */
function makeConfig() {
  return {
    provider: 'plane',
    claude: { default_model: 'sonnet' },
    providers: { plane: { mcp_hint: 'MCP de plane', states: { review: 'In Review' } } },
    agents: DEFAULT_CONFIG.agents,
  };
}

/** @returns {any} TaskItem mínimo. */
function makeTask(overrides = {}) {
  return {
    id: 'task-uuid',
    ref: 'KODO-19',
    title: 'Añadir Opencode como opción',
    projectId: 'proj-uuid',
    projectName: 'kodo',
    url: 'https://example.invalid/KODO-19',
    ...overrides,
  };
}

describe('KODO-19 · etiquetas de agente (labels.js)', () => {
  test('kodo:oc y kodo:opencode seleccionan opencode', () => {
    assert.equal(getAgentName(['oc']), 'opencode');
    assert.equal(getAgentName(['opencode']), 'opencode');
  });

  test('kodo:cc y kodo:claude-code seleccionan claude-code', () => {
    assert.equal(getAgentName(['cc']), 'claude-code');
    assert.equal(getAgentName(['claude-code']), 'claude-code');
  });

  test('sin etiqueta de agente devuelve null — NO "claude-code"', () => {
    // La distinción importa: `null` deja que decida `config.agents.default`, que el
    // operador puede haber movido. Devolver 'claude-code' aquí cortocircuitaría ese
    // ajuste y volvería el default del config inalcanzable desde el carril de labels.
    assert.equal(getAgentName([]), null);
    assert.equal(getAgentName(['gsd', 'yolo']), null);
  });

  test('es case-insensitive y tolera entradas degeneradas sin lanzar', () => {
    assert.equal(getAgentName(['OpenCode']), 'opencode');
    assert.equal(getAgentName(/** @type {any} */ (null)), null);
    assert.equal(getAgentName(/** @type {any} */ ([42, null, {}, 'oc'])), 'opencode');
  });

  test('etiquetas en conflicto (cc + oc) resuelven al agente con ciclo de vida completo', () => {
    // Conservador por diseño: ante ambigüedad se lanza el agente que SÍ tiene hooks,
    // cleanup de worktree y comentario de cierre — no el degradado.
    assert.equal(getAgentName(['oc', 'cc']), 'claude-code');
    assert.equal(getAgentName(['cc', 'oc']), 'claude-code');
  });

  test('la etiqueta viaja por `flags` de parseKodoLabels, no por un campo propio', () => {
    // Es lo que hace que el carril funcione sin tocar el dispatcher: los flags ya se
    // propagan hasta launchWorkItem tal cual.
    const parsed = parseKodoLabels([{ name: 'kodo' }, { name: 'kodo:oc' }]);
    assert.equal(parsed.isKodo, true);
    assert.deepEqual(parsed.flags, ['oc']);
    assert.equal(getAgentName(parsed.flags), 'opencode');
  });

  test('AGENT_LABELS solo mapea a agentes que existen en el registro por defecto', () => {
    for (const agentId of Object.values(AGENT_LABELS)) {
      assert.ok(
        DEFAULT_CONFIG.agents.registry[agentId],
        `la etiqueta apunta a '${agentId}', que no está en agents.registry`,
      );
    }
  });
});

describe('KODO-19 · resolveAgentName (GSD manda sobre la etiqueta)', () => {
  test('kodo:oc + kodo:gsd degrada a claude-code', () => {
    // El flujo GSD son slash commands `/gsd-*` y hooks de Claude Code. Con OpenCode no
    // daría una sesión degradada: daría una que teclea comandos inexistentes.
    assert.equal(resolveAgentName(['oc', 'gsd']), 'claude-code');
    assert.equal(resolveAgentName(['oc', 'gsd-quick']), 'claude-code');
  });

  test('kodo:oc sin GSD respeta la etiqueta', () => {
    assert.equal(resolveAgentName(['oc']), 'opencode');
    assert.equal(resolveAgentName(['oc', 'yolo']), 'opencode');
  });

  test('sin etiqueta sigue devolviendo null, con o sin GSD', () => {
    assert.equal(resolveAgentName([]), null);
    assert.equal(resolveAgentName(['gsd']), null);
  });
});

describe('KODO-19 · registro de opencode (config.js)', () => {
  test('opencode está registrado con su mecánica real', () => {
    const def = DEFAULT_CONFIG.agents.registry.opencode;
    assert.equal(def.binary, 'opencode', 'binario por PATH, nunca path absoluto');
    assert.equal(def.model_flag, '--model');
    assert.equal(def.prompt_style, 'flag');
    assert.equal(def.prompt_flag, '--prompt');
    assert.equal(def.skip_perms_flag, '--auto');
  });

  test('opencode NO admite fijar el session id ni aislar por worktree', () => {
    // Ambos son `null` a propósito, no un olvido: `opencode --session <id>` CONTINÚA una
    // sesión existente y no hay flag de worktree. Emitirlos produciría un comando roto.
    const def = DEFAULT_CONFIG.agents.registry.opencode;
    assert.equal(def.session_id_flag, null);
    assert.equal(def.worktree_flag, null);
  });

  test('opencode declara status_authority process — no finge tener hooks', () => {
    // Los hooks (SessionStart/Stop/SessionEnd) son de Claude Code; OpenCode no los
    // ejecuta. Declarar 'hooks' dejaría sus sesiones eternamente en running.
    assert.equal(DEFAULT_CONFIG.agents.registry.opencode.status_authority, 'process');
  });

  test('claude-code conserva su mecánica y su patrón pgrep histórico', () => {
    const def = DEFAULT_CONFIG.agents.registry['claude-code'];
    assert.equal(def.session_id_flag, '--session-id');
    assert.equal(def.worktree_flag, '--worktree');
    assert.equal(def.prompt_style, 'positional');
    assert.equal(def.skip_perms_flag, '--dangerously-skip-permissions');
    assert.equal(def.process_match, 'session-id <sid>');
  });

  test('el process_match de opencode busca el UUID a secas', () => {
    // Sin `--session-id` en argv no hay literal estable salvo el propio prompt, donde
    // el UUID viaja dentro del bloque de contexto que buildAgentCommand inyecta.
    assert.equal(DEFAULT_CONFIG.agents.registry.opencode.process_match, '<sid>');
  });

  test('todo agente del registro declara un process_match — si no, se leería muerto', () => {
    for (const [id, def] of Object.entries(DEFAULT_CONFIG.agents.registry)) {
      assert.ok(def.process_match, `'${id}' no declara process_match`);
      assert.ok(
        def.process_match.includes('<sid>'),
        `el process_match de '${id}' debe interpolar <sid>`,
      );
    }
  });
});

describe('KODO-19 · mapAgentModel', () => {
  test('traduce el alias de kodo al identificador provider/model de opencode', () => {
    const oc = DEFAULT_CONFIG.agents.registry.opencode;
    assert.equal(mapAgentModel('opus', oc), 'opencode/claude-opus-5');
    assert.equal(mapAgentModel('sonnet', oc), 'opencode/claude-sonnet-5');
    assert.equal(mapAgentModel('haiku', oc), 'opencode/claude-haiku-4-5');
  });

  test('un modelo fuera del mapa pasa VERBATIM (passthrough)', () => {
    // Es lo que permite `--model anthropic/claude-sonnet-4-5` sin tocar el registro.
    const oc = DEFAULT_CONFIG.agents.registry.opencode;
    assert.equal(mapAgentModel('anthropic/claude-sonnet-4-5', oc), 'anthropic/claude-sonnet-4-5');
  });

  test('un agente sin model_map deja el modelo intacto (claude-code, no regresión)', () => {
    const cc = DEFAULT_CONFIG.agents.registry['claude-code'];
    assert.equal(mapAgentModel('opus', cc), 'opus');
    assert.equal(mapAgentModel('sonnet', cc), 'sonnet');
  });

  test('never-throws sobre definiciones degeneradas', () => {
    assert.equal(mapAgentModel('opus', /** @type {any} */ (null)), 'opus');
    assert.equal(mapAgentModel('opus', /** @type {any} */ ({})), 'opus');
  });
});

describe('KODO-19 · buildAgentCommand', () => {
  test('sin agentName el comando es el de Claude Code, byte a byte (NO REGRESIÓN)', () => {
    const cmd = buildAgentCommand(makeConfig(), 'abc-123', makeTask(), 'desc', null, [], null);
    assert.match(
      cmd,
      /^claude --model sonnet --session-id abc-123 --worktree abc-123 "\$\(cat .+\)"$/,
      'la ausencia de etiqueta debe producir exactamente el comando previo a KODO-19',
    );
  });

  test('con opencode: binario, modelo mapeado y prompt por flag', () => {
    const cmd = buildAgentCommand(makeConfig(), 'abc-123', makeTask(), 'desc', null, [], null, true, 'opencode');
    assert.match(
      cmd,
      /^opencode --model opencode\/claude-sonnet-5 --prompt "\$\(cat .+\)"$/,
      'la línea de OpenCode: sin session-id, sin worktree, prompt por --prompt',
    );
  });

  test('con opencode NO se emite --session-id ni --worktree aunque el repo sea git', () => {
    // El 8º arg (isGitRepo) es true aquí: la omisión del worktree la decide el AGENTE,
    // no el proyecto. Emitir `--worktree` haría que OpenCode abortase por flag inválido.
    const cmd = buildAgentCommand(makeConfig(), 'abc-123', makeTask(), 'desc', null, [], null, true, 'opencode');
    assert.ok(!cmd.includes('--session-id'), 'opencode no admite fijar el session id');
    assert.ok(!cmd.includes('--worktree'), 'opencode no tiene flag de worktree');
    assert.ok(!cmd.includes('abc-123 abc-123'), 'ningún hueco de flag colapsado a medias');
  });

  test('skip-permissions usa el flag de CADA agente', () => {
    const cc = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'd', null, ['yolo'], null);
    assert.ok(cc.includes('--dangerously-skip-permissions'));
    const oc = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'd', null, ['yolo'], null, true, 'opencode');
    assert.ok(oc.includes('--auto'), 'OpenCode pide --auto, no --dangerously-skip-permissions');
    assert.ok(!oc.includes('--dangerously-skip-permissions'));
  });

  test('sin skip-permissions ninguno de los dos emite su flag', () => {
    const oc = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'd', null, [], null, true, 'opencode');
    assert.ok(!oc.includes('--auto'));
  });

  test('un agentName desconocido cae al default (never-throws)', () => {
    const cmd = buildAgentCommand(makeConfig(), 'abc-123', makeTask(), 'desc', null, [], null, true, 'no-existe');
    assert.match(cmd, /^claude --model sonnet --session-id abc-123 --worktree abc-123 /);
  });

  test('el modelo explícito gana y también se mapea', () => {
    const cmd = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'd', 'opus', [], null, true, 'opencode');
    assert.ok(cmd.includes('--model opencode/claude-opus-5'));
  });
});

describe('KODO-19 · inyección del contexto de sesión en el prompt', () => {
  /** Lee el fichero de prompt que buildAgentCommand escribe, extrayéndolo del comando. */
  function readPromptOf(cmd) {
    const m = cmd.match(/\$\(cat (.+?)\)/);
    assert.ok(m, `no se encontró el path del prompt en: ${cmd}`);
    return readFileSync(m[1], 'utf-8');
  }

  const session = /** @type {any} */ ({
    task_ref: 'KODO-19',
    summary: 'Añadir Opencode como opción',
    session_id: 'sess-abc-123',
    task_id: 'task-uuid',
    project_id: 'proj-uuid',
    project_path: '/tmp/kodo',
    provider: 'plane',
  });

  test('un agente sin hooks recibe el contexto DENTRO del prompt', () => {
    // Sin esto, una sesión de OpenCode arrancaría sin saber su task ref, ni que debe
    // comentar en el provider, ni dónde escribir el plan.
    const cmd = buildAgentCommand(makeConfig(), 'sess-abc-123', makeTask(), 'desc', null, [], null, true, 'opencode', session);
    const prompt = readPromptOf(cmd);
    assert.ok(prompt.startsWith('# kodo KODO-19'), 'el contexto va PRIMERO');
    assert.ok(prompt.includes('Session ID: sess-abc-123'));
    assert.ok(prompt.includes('Trabaja en: Añadir Opencode como opción.'), 'la instrucción va después');
  });

  test('el session id acaba en el prompt — es lo que hace greppable el proceso', () => {
    // Contrato cruzado con `process_match: '<sid>'`: sin el UUID en el argv del proceso,
    // isSessionProcessAlive leería la sesión como muerta en el primer tick.
    const cmd = buildAgentCommand(makeConfig(), 'sess-abc-123', makeTask(), 'desc', null, [], null, true, 'opencode', session);
    assert.ok(readPromptOf(cmd).includes('sess-abc-123'));
  });

  test('Claude Code NO recibe el contexto en el prompt — se lo pone su hook', () => {
    // Duplicarlo sería inyectar dos veces el mismo bloque en cada sesión.
    const cmd = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'desc', null, [], null, true, 'claude-code', session);
    const prompt = readPromptOf(cmd);
    assert.ok(!prompt.includes('# kodo KODO-19'));
    assert.equal(prompt, 'Trabaja en: Añadir Opencode como opción. Descripción: desc');
  });

  test('sin SessionRecord se lanza con el prompt pelado (fail-open)', () => {
    const cmd = buildAgentCommand(makeConfig(), 'sid', makeTask(), 'desc', null, [], null, true, 'opencode');
    assert.equal(readPromptOf(cmd), 'Trabaja en: Añadir Opencode como opción. Descripción: desc');
  });
});

describe('KODO-19 · persistencia del agente en el SessionRecord', () => {
  const base = {
    task: makeTask(),
    providerName: 'plane',
    projectPath: '/tmp/kodo',
    workspaceRef: 'workspace:1',
    sessionId: 'sid',
  };

  test('el agente se persiste cuando hay etiqueta', () => {
    assert.equal(buildSessionFromTask({ ...base, agentName: 'opencode' }).agent, 'opencode');
  });

  test('sin etiqueta el campo se OMITE — no se persiste un default congelado', () => {
    // Omitirlo es lo que deja que la sesión se resuelva contra `config.agents.default`
    // en cada lectura, igual que las sesiones legacy anteriores a KODO-19.
    assert.equal('agent' in buildSessionFromTask(/** @type {any} */ (base)), false);
    assert.equal('agent' in buildSessionFromTask({ ...base, agentName: null }), false);
  });
});
