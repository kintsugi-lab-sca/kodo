// @ts-check
//
// test/daemon/polling-scopes.test.js — KODO-60.
//
// Unit puro sobre `resolvePollingPlan(config)`: la config entra como argumento, así
// que no hace falta aislar HOME ni tocar disco. Cubre las dos formas de scope (github
// por repo, plane por proyecto con la clave UUID), la precedencia del intervalo y el
// never-throws ante config ausente/malformed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePollingPlan } from '../../src/daemon/polling-scopes.js';

describe('resolvePollingPlan — provider plane', () => {
  const PLANE = {
    provider: 'plane',
    providers: {
      plane: {
        workspace_slug: 'k-lab',
        projects: [
          { id: 'uuid-kodo', identifier: 'KODO', name: 'kodo' },
          { id: 'uuid-scp', identifier: 'SCP', name: 'scp' },
        ],
      },
    },
    polling: { enabled: true, interval_s: 45, catch_up: false },
  };

  it('un scope por proyecto, con el UUID como clave del cursor', () => {
    const plan = resolvePollingPlan(PLANE);
    assert.equal(plan.providerName, 'plane');
    assert.deepEqual(plan.scopes, [
      { owner: 'k-lab', repo: 'KODO', id: 'uuid-kodo' },
      { owner: 'k-lab', repo: 'SCP', id: 'uuid-scp' },
    ]);
  });

  it('intervalSec sale de polling.interval_s', () => {
    assert.equal(resolvePollingPlan(PLANE).intervalSec, 45);
  });

  it('interval_s como string de dígitos (lo que deja `kodo config set`) SÍ se respeta', () => {
    const plan = resolvePollingPlan({
      ...PLANE,
      polling: { enabled: true, interval_s: '120' },
    });
    assert.equal(plan.intervalSec, 120, 'un "120" no debe degradar silenciosamente a 60');
  });

  it('interval_s inválido (0, negativo, texto) cae al default 60 — nunca a un bucle caliente', () => {
    for (const bad of [0, -5, 'abc', null, {}, 0.4]) {
      const plan = resolvePollingPlan({ ...PLANE, polling: { interval_s: bad } });
      assert.equal(plan.intervalSec, 60, `interval_s=${JSON.stringify(bad)} → 60`);
    }
  });

  it('catch_up: true se propaga; cualquier otra cosa es false (=== estricto)', () => {
    assert.equal(resolvePollingPlan({ ...PLANE, polling: { catch_up: true } }).catchUp, true);
    assert.equal(resolvePollingPlan({ ...PLANE, polling: { catch_up: 'true' } }).catchUp, false);
    assert.equal(resolvePollingPlan(PLANE).catchUp, false);
  });

  it('un proyecto sin id se descarta: sin UUID no hay nada contra lo que filtrar', () => {
    const plan = resolvePollingPlan({
      ...PLANE,
      providers: { plane: { workspace_slug: 'k-lab', projects: [{ identifier: 'GHOST' }] } },
    });
    assert.deepEqual(plan.scopes, []);
  });

  it('un proyecto sin identifier cae al UUID como etiqueta legible', () => {
    const plan = resolvePollingPlan({
      ...PLANE,
      providers: { plane: { workspace_slug: 'k-lab', projects: [{ id: 'uuid-x' }] } },
    });
    assert.deepEqual(plan.scopes, [{ owner: 'k-lab', repo: 'uuid-x', id: 'uuid-x' }]);
  });
});

describe('resolvePollingPlan — provider github (cero regresión)', () => {
  const GITHUB = {
    provider: 'github',
    providers: {
      github: { repos: [{ owner: 'o', repo: 'r' }], poll_interval: 30 },
    },
  };

  it('scopes por repo SIN id — la clave del cursor sigue siendo owner/repo', () => {
    const plan = resolvePollingPlan(GITHUB);
    assert.equal(plan.providerName, 'github');
    assert.deepEqual(plan.scopes, [{ owner: 'o', repo: 'r' }]);
    assert.equal(Object.hasOwn(plan.scopes[0], 'id'), false, 'sin id: clave legacy intacta');
  });

  it('poll_interval del provider GANA sobre polling.interval_s', () => {
    const plan = resolvePollingPlan({ ...GITHUB, polling: { interval_s: 900 } });
    assert.equal(plan.intervalSec, 30);
  });

  it('sin poll_interval cae a polling.interval_s, y sin ninguno a 60', () => {
    const noPoll = { provider: 'github', providers: { github: { repos: [] } } };
    assert.equal(resolvePollingPlan({ ...noPoll, polling: { interval_s: 90 } }).intervalSec, 90);
    assert.equal(resolvePollingPlan(noPoll).intervalSec, 60);
  });

  it('repos malformed se filtran uno a uno, sin tumbar el resto', () => {
    const plan = resolvePollingPlan({
      provider: 'github',
      providers: { github: { repos: [{ owner: 'o', repo: 'r' }, null, { owner: 'x' }, 42] } },
    });
    assert.deepEqual(plan.scopes, [{ owner: 'o', repo: 'r' }]);
  });
});

describe('resolvePollingPlan — never-throws', () => {
  it('config ausente/malformed → cero scopes, nunca lanza', () => {
    for (const bad of [undefined, null, {}, { provider: 42 }, { providers: null }]) {
      const plan = resolvePollingPlan(bad);
      assert.deepEqual(plan.scopes, [], `${JSON.stringify(bad)} → sin scopes`);
      assert.equal(plan.intervalSec, 60);
      assert.equal(plan.catchUp, false);
    }
  });

  it('provider desconocido → cero scopes (el loop tickea y no hace nada)', () => {
    const plan = resolvePollingPlan({ provider: 'jira', polling: { enabled: true } });
    assert.deepEqual(plan.scopes, []);
    assert.equal(plan.providerName, 'jira');
  });
});
