// @ts-check
//
// test/cli/doctor.test.js — KODO-10.
//
// La mitad CLI de `kodo doctor` (handler `runDoctor`). Espejo del contrato de gsd-doctor.js:
// dry-run render humano + `--json` byte-determinista + exit code (hasIssues ? 1 : 0). Todo por
// DI: loadRawConfigFn/loadProjectsFn/listStatesFn/writeFn/errFn/formatterFn — CERO red, cero
// lectura del ~/.kodo real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../../src/cli/doctor.js';

// Formatter identidad (sin ANSI) para assertar por contenido.
function idFormatter() {
  const id = (s) => s;
  return { ok: id, fail: id, yellow: id, red: id, cyan: id, dim: id, green: id, gray: id, info: id, warn: id, error: id, bold: id };
}

// Settings sintético con los 3 hooks kodo registrados bajo su evento correcto. Se
// inyecta por defecto en makeSink() para que TODOS los tests existentes queden
// HERMÉTICOS (dejan de leer el ~/.claude/settings.json real, que hoy tiene SessionEnd
// ausente — el bug G-74-4 — y viraría sus exit codes a 1).
const kodoCmd = (file) => `node "/repo/src/hooks/${file}"`;
const CLEAN_SETTINGS = {
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: kodoCmd('session-start.js') }] }],
    Stop: [{ hooks: [{ type: 'command', command: kodoCmd('stop.js') }] }],
    SessionEnd: [{ hooks: [{ type: 'command', command: kodoCmd('session-end.js') }] }],
  },
};

function makeSink() {
  const out = { s: '', e: '' };
  return {
    out,
    writeFn: (x) => { out.s += x; },
    errFn: (x) => { out.e += x; },
    formatterFn: () => idFormatter(),
    readSettingsFn: () => CLEAN_SETTINGS,
  };
}

const ALIGNED_CONFIG = {
  provider: 'plane',
  providers: { plane: {
    projects: [{ id: 'kodo', identifier: 'KODO', name: 'kodo' }],
    states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
  } },
};

describe('runDoctor: cruce config↔projects', () => {
  it('alineado → exit 0 y mensaje de limpio', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
    });
    assert.equal(code, 0);
    assert.match(sink.out.s, /clean|alinead|sin problemas/i);
  });

  it('SCP-like (mapeado no-config) → exit 1 y finding accionable', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ({ provider: 'plane', providers: { plane: { projects: [], states: {} } } }),
      loadProjectsFn: () => ({ scp: '/Users/alex/dev/roman/scp-cmri' }),
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /scp/i);
    assert.match(sink.out.s, /UNKNOWN|config\.json/i);
  });

  it('--json emite payload estructurado con findings (byte-determinista, sin formatter)', async () => {
    const sink = makeSink();
    const code = await runDoctor({ json: true }, {
      loadRawConfigFn: () => ({ provider: 'plane', providers: { plane: { projects: [], states: {} } } }),
      loadProjectsFn: () => ({ scp: '/tmp/scp' }),
      ...sink,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.equal(payload.provider, 'plane');
    assert.equal(payload.hasIssues, true);
    assert.ok(payload.findings.some((f) => f.code === 'mapped_not_dispatched' && f.projectId === 'scp'));
  });

  it('config ausente (null) → never-throws, exit 0', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => null,
      loadProjectsFn: () => ({}),
      ...sink,
    });
    assert.equal(code, 0);
  });
});

describe('runDoctor --states (check de estados por proyecto, red inyectada)', () => {
  it('todos los estados presentes → sin problemas de estados, exit 0', async () => {
    const sink = makeSink();
    const listStatesFn = async (/** @type {string} */ id) => {
      assert.equal(id, 'kodo');
      return ['Backlog', 'In Progress', 'In review', 'Done', 'Cancelled'];
    };
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 0);
  });

  it('falta "In review" (caso SCP) → exit 1 y reporta el estado ausente', async () => {
    const sink = makeSink();
    const listStatesFn = async () => ['Backlog', 'In Progress', 'Done'];
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /In review/i);
  });

  it('--states + --json incluye la sección states', async () => {
    const sink = makeSink();
    const listStatesFn = async () => ['In Progress', 'Done'];
    const code = await runDoctor({ states: true, json: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.ok(payload.states, 'el payload debe llevar la sección states bajo --states');
    assert.ok(payload.states.problems.some((p) => p.missing?.some((m) => m.name === 'In review')));
  });

  it('un fallo de red por proyecto NO tira el comando (never-throws) → se reporta como error de estados', async () => {
    const sink = makeSink();
    const listStatesFn = async () => { throw new Error('ECONNREFUSED'); };
    const code = await runDoctor({ states: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      listStatesFn,
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /ECONNREFUSED|no se pudo/i);
  });
});

describe('runDoctor: sección hooks (deriva instalación↔settings, G-74-4)', () => {
  // Settings SIN el SessionEnd de kodo (el escenario exacto de G-74-4): SessionStart y
  // Stop presentes, SessionEnd solo con un command ajeno.
  const SETTINGS_MISSING_SESSIONEND = {
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: kodoCmd('session-start.js') }] }],
      Stop: [{ hooks: [{ type: 'command', command: kodoCmd('stop.js') }] }],
      SessionEnd: [{ hooks: [{ type: 'command', command: 'python codeisland-state.py' }] }],
    },
  };

  it('los 3 hooks limpios + config alineada → exit 0 y render nombra los hooks limpios', async () => {
    const sink = makeSink(); // readSettingsFn → CLEAN_SETTINGS
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
    });
    assert.equal(code, 0);
    assert.match(sink.out.s, /SessionStart|SessionEnd|hooks/i);
  });

  it('SessionEnd ausente → exit 1, ERROR nombrando SessionEnd + sugiere "kodo install"', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
      readSettingsFn: () => SETTINGS_MISSING_SESSIONEND,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /SessionEnd/);
    assert.match(sink.out.s, /kodo install/);
  });

  it('--json con SessionEnd ausente → payload.hooks.missing incluye SessionEnd, readable true', async () => {
    const sink = makeSink();
    const code = await runDoctor({ json: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
      readSettingsFn: () => SETTINGS_MISSING_SESSIONEND,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.ok(payload.hooks, 'el payload lleva la clave hooks');
    assert.equal(payload.hooks.readable, true);
    assert.ok(payload.hooks.missing.some((m) => m.event === 'SessionEnd'));
  });

  it('settings ilegible (readSettingsFn → null) → never-throws, WARN, no fuerza exit 1', async () => {
    const sink = makeSink();
    let code;
    await assert.doesNotReject(async () => {
      code = await runDoctor({}, {
        loadRawConfigFn: () => ALIGNED_CONFIG,
        loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
        ...sink,
        readSettingsFn: () => null,
      });
    });
    assert.equal(code, 0, 'settings ilegible NO fuerza exit 1 (config alineada)');
  });

  it('--json con settings ilegible → payload.hooks.readable false', async () => {
    const sink = makeSink();
    await runDoctor({ json: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink,
      readSettingsFn: () => null,
    });
    const payload = JSON.parse(sink.out.s);
    assert.equal(payload.hooks.readable, false);
  });
});

// ── --identifiers: divergencia config ↔ provider (KODO-13) ───────────────────
//
// El check nace del bug real: el proyecto quedó cacheado como ITROMAN en config.json,
// Plane lo llama ITCLIP, y kodo emitía refs `ITROMAN-1` inexistentes en el provider.
describe('runDoctor --identifiers', () => {
  const STALE_CONFIG = {
    provider: 'plane',
    providers: { plane: {
      projects: [{ id: 'p1', identifier: 'ITROMAN', name: 'IT roman' }],
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
    } },
  };
  const REMOTE = [{ id: 'p1', identifier: 'ITCLIP', name: 'Clipping' }];

  it('identifier obsoleto → exit 1 y reporta cacheado vs real con remedio', async () => {
    const sink = makeSink();
    const code = await runDoctor({ identifiers: true }, {
      loadRawConfigFn: () => STALE_CONFIG,
      loadProjectsFn: () => ({ p1: '/tmp/clipping' }),
      listProjectsFn: async () => REMOTE,
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /identifier obsoleto/);
    assert.match(sink.out.s, /ITROMAN/);
    assert.match(sink.out.s, /ITCLIP/);
    assert.match(sink.out.s, /kodo config/);
  });

  it('identifiers alineados → exit 0 y clean', async () => {
    const sink = makeSink();
    const code = await runDoctor({ identifiers: true }, {
      loadRawConfigFn: () => ({
        provider: 'plane',
        providers: { plane: { projects: [{ id: 'p1', identifier: 'ITCLIP', name: 'Clipping' }] } },
      }),
      loadProjectsFn: () => ({ p1: '/tmp/clipping' }),
      listProjectsFn: async () => REMOTE,
      ...sink,
    });
    assert.equal(code, 0);
    assert.match(sink.out.s, /identifiers \(--identifiers\)/);
    assert.match(sink.out.s, /identifier real del provider/);
  });

  it('provider inalcanzable → exit 1, nunca lanza', async () => {
    const sink = makeSink();
    const code = await runDoctor({ identifiers: true }, {
      loadRawConfigFn: () => STALE_CONFIG,
      loadProjectsFn: () => ({ p1: '/tmp/clipping' }),
      listProjectsFn: async () => { throw new Error('Plane API 500'); },
      ...sink,
    });
    assert.equal(code, 1);
    assert.match(sink.out.s, /no se pudo listar los proyectos del provider: Plane API 500/);
  });

  it('sin el flag no se toca la red ni se emite la sección', async () => {
    const sink = makeSink();
    let called = 0;
    const code = await runDoctor({}, {
      loadRawConfigFn: () => STALE_CONFIG,
      loadProjectsFn: () => ({ p1: '/tmp/clipping' }),
      listProjectsFn: async () => { called++; return REMOTE; },
      ...sink,
    });
    assert.equal(called, 0, 'el check remoto es opt-in');
    assert.equal(code, 0);
    assert.ok(!sink.out.s.includes('--identifiers'));
  });

  it('--json incluye la sección identifiers con el problema estructurado', async () => {
    const sink = makeSink();
    const code = await runDoctor({ identifiers: true, json: true }, {
      loadRawConfigFn: () => STALE_CONFIG,
      loadProjectsFn: () => ({ p1: '/tmp/clipping' }),
      listProjectsFn: async () => REMOTE,
      ...sink,
    });
    assert.equal(code, 1);
    const payload = JSON.parse(sink.out.s);
    assert.equal(payload.identifiers.checked, 1);
    assert.equal(payload.identifiers.problems[0].code, 'stale_identifier');
    assert.equal(payload.identifiers.problems[0].cached, 'ITROMAN');
    assert.equal(payload.identifiers.problems[0].actual, 'ITCLIP');
  });

  it('provider no-plane → n/a sin red y sin exit 1', async () => {
    const sink = makeSink();
    const code = await runDoctor({ identifiers: true }, {
      loadRawConfigFn: () => ({
        provider: 'github',
        providers: { github: { projects: [{ id: 'r1', identifier: 'org/repo', name: 'org/repo' }] } },
      }),
      loadProjectsFn: () => ({ r1: '/tmp/repo' }),
      ...sink,
    });
    assert.equal(code, 0);
    assert.match(sink.out.s, /solo aplica al provider plane/);
  });
});

// ── KODO-31: check del runtime de BB ─────────────────────────────────────────
//
// Corre SIEMPRE con `host: 'bb'` y NUNCA con otro host. No es un flag opt-in por el mismo
// motivo que la deriva de hooks: con bb, un servidor caído o un provider `claude-code` no
// disponible dejan a kodo lanzando threads que mueren al arrancar — invisible desde el
// resto del sistema. Y no rompe el default offline del doctor: la llamada es a loopback.
describe('runDoctor: host bb (KODO-31)', () => {
  const BB_CONFIG = { ...ALIGNED_CONFIG, host: 'bb' };
  const deps = (sink, bbDoctorFn) => ({
    loadRawConfigFn: () => BB_CONFIG,
    loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
    bbDoctorFn,
    ...sink,
  });

  it('servidor en pie + claude-code disponible → exit 0 y "clean"', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, deps(sink, async () => ({
      serverUrl: 'http://127.0.0.1:38886',
      serverUp: true,
      providerAvailable: true,
    })));
    assert.equal(code, 0);
    assert.match(sink.out.s, /host bb \(http:\/\/127\.0\.0\.1:38886\)/);
    assert.match(sink.out.s, /provider claude-code disponible/);
  });

  it('servidor caído → exit 1 y la pista de cómo arrancarlo', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, deps(sink, async () => ({
      serverUrl: 'http://127.0.0.1:38886',
      serverUp: false,
      providerAvailable: null,
      detail: 'connect ECONNREFUSED',
    })));
    assert.equal(code, 1, 'un servidor caído es un problema, no un aviso');
    assert.match(sink.out.s, /el servidor de BB no responde: connect ECONNREFUSED/);
    assert.match(sink.out.s, /npx bb-app@latest/);
  });

  it('servidor en pie pero claude-code NO disponible → exit 1', async () => {
    // El fallo que este check existe para hacer visible: BB responde, kodo lanza el
    // thread, y el thread muere porque no hay binario `claude` en esa máquina.
    const sink = makeSink();
    const code = await runDoctor({}, deps(sink, async () => ({
      serverUrl: 'http://x',
      serverUp: true,
      providerAvailable: false,
    })));
    assert.equal(code, 1);
    assert.match(sink.out.s, /claude-code no está disponible/);
  });

  it('provider indeterminado (servidor en pie, consulta fallida) → parcial SIN exit 1', async () => {
    // No se puede afirmar una deriva sobre lo que no se pudo leer — mismo criterio que el
    // `settings ilegible` de la deriva de hooks.
    const sink = makeSink();
    const code = await runDoctor({}, deps(sink, async () => ({
      serverUrl: 'http://x',
      serverUp: true,
      providerAvailable: null,
      detail: 'timeout',
    })));
    assert.equal(code, 0);
    assert.match(sink.out.s, /parcial/);
  });

  it('el check NO corre con otro host: la salida queda idéntica a la de siempre', async () => {
    for (const host of ['cmux', 'orca', undefined]) {
      const sink = makeSink();
      let called = false;
      const code = await runDoctor({}, {
        loadRawConfigFn: () => ({ ...ALIGNED_CONFIG, host }),
        loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
        bbDoctorFn: async () => {
          called = true;
          return { serverUrl: 'x', serverUp: false, providerAvailable: null };
        },
        ...sink,
      });
      assert.equal(called, false, `host=${host} no debe disparar el check de bb`);
      assert.equal(code, 0);
      assert.ok(!sink.out.s.includes('host bb'), 'no debe renderizarse el bloque de bb');
    }
  });

  it('--json incluye el bloque `bb` solo cuando el check aplicó', async () => {
    const sink = makeSink();
    await runDoctor({ json: true }, deps(sink, async () => ({
      serverUrl: 'http://127.0.0.1:38886',
      serverUp: true,
      providerAvailable: true,
    })));
    assert.deepEqual(JSON.parse(sink.out.s).bb, {
      serverUrl: 'http://127.0.0.1:38886',
      serverUp: true,
      providerAvailable: true,
    });

    const sink2 = makeSink();
    await runDoctor({ json: true }, {
      loadRawConfigFn: () => ALIGNED_CONFIG,
      loadProjectsFn: () => ({ kodo: '/tmp/kodo' }),
      ...sink2,
    });
    assert.equal(JSON.parse(sink2.out.s).bb, undefined);
  });

  it('un check que LANZA degrada a «sin check», nunca tumba el doctor', async () => {
    const sink = makeSink();
    const code = await runDoctor({}, deps(sink, async () => {
      throw new Error('el cliente bb no está instalado');
    }));
    assert.equal(code, 0);
    assert.ok(!sink.out.s.includes('host bb'));
  });
});
