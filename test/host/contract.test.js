// test/host/contract.test.js
// Phase 38 SC#1 (TUI-17) — WorkspaceHost contract matrix.
// Espejo de test/providers/contract.test.js: itera implementations × asserts core.
// IMPLS = ['cmux', 'null']. Todos los it() viven DENTRO del describe del loop
// (pitfall #3 de Phase 27 — asserts por implementación).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_METHODS, getHost, validateHost } from '../../src/host/interface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'cmux');

const LIST_FIXTURE = readFileSync(join(FIXTURES, 'list-workspaces.json'), 'utf-8');
const NOTIF_FIXTURE = readFileSync(join(FIXTURES, 'notification-list.json'), 'utf-8');

const IMPLS = ['cmux', 'null'];

/**
 * Leak-guard exec: stub loud-on-call si la impl olvidó usar el inyectable.
 * Mirror del leak-guard de test/providers/contract.test.js.
 */
function loudExec() {
  return () => {
    throw new Error('LEAK: la impl usó el exec real en lugar del inyectable de test');
  };
}

/**
 * Fake exec que sirve los fixtures JSON según el argv de cmux.
 * Firma compatible con execFile(file, args, opts, cb) Y con execFileSync.
 */
function fakeExecFromFixtures() {
  return (binary, args, opts, cb) => {
    const argv = (args || []).join(' ');
    let payload = '';
    if (argv.includes('list-workspaces')) payload = LIST_FIXTURE;
    else if (argv.includes('notification.list')) payload = NOTIF_FIXTURE;
    else payload = '';
    // selectWorkspace path: never-throws, código 0.
    if (typeof cb === 'function') {
      cb(null, payload, '');
      return;
    }
    return payload; // execFileSync style
  };
}

/**
 * assertWorkspaceInfoShape — espejo de assertTaskItemShape.
 * Campos requeridos del shape WorkspaceInfo (D-03).
 */
function assertWorkspaceInfoShape(item, label) {
  assert.equal(typeof item.workspace_ref, 'string', `${label}.workspace_ref string`);
  assert.equal(typeof item.alive, 'boolean', `${label}.alive boolean`);
  assert.equal(typeof item.needs_input, 'boolean', `${label}.needs_input boolean`);
  assert.ok(
    item.last_activity === null || typeof item.last_activity === 'string',
    `${label}.last_activity string|null`,
  );
}

/**
 * instantiateHost — espejo de instantiateProvider.
 * Para 'cmux' inyecta exec fake + run fake que cargan los fixtures.
 * Para 'null' instancia directa sin DI.
 */
function instantiateHost(name) {
  if (name === 'cmux') {
    return getHost('cmux', {
      exec: fakeExecFromFixtures(),
      run: async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('list-workspaces')) return LIST_FIXTURE;
        if (argv.includes('notification.list')) return NOTIF_FIXTURE;
        return '';
      },
      binary: '/fake/cmux',
    });
  }
  return getHost('null');
}

describe('WorkspaceHost contract matrix', () => {
  test('HOST_METHODS es exactamente los 4 métodos D-03 en orden', () => {
    assert.deepEqual(
      [...HOST_METHODS],
      ['listWorkspaces', 'selectWorkspace', 'isAlive', 'needsInput'],
    );
    assert.equal(HOST_METHODS.length, 4);
    for (const m of HOST_METHODS) assert.equal(typeof m, 'string');
  });

  for (const implName of IMPLS) {
    describe(`impl=${implName}`, () => {
      let host;
      before(() => {
        // leak guard: instalar exec loud por si la impl lo ignora (cmux).
        loudExec();
        host = instantiateHost(implName);
      });

      test('implementa los 4 métodos del contrato', () => {
        for (const m of HOST_METHODS) {
          assert.equal(typeof host[m], 'function', `falta ${m}`);
        }
      });

      test('validateHost no lanza', () => {
        assert.doesNotThrow(() => validateHost(host));
      });

      test('listWorkspaces retorna array de WorkspaceInfo', async () => {
        const items = await host.listWorkspaces();
        assert.ok(Array.isArray(items), 'listWorkspaces retorna array');
        for (const [i, item] of items.entries()) {
          assertWorkspaceInfoShape(item, `${implName}[${i}]`);
        }
      });

      test('selectWorkspace retorna discriminated union {ok} (never-throws)', async () => {
        const res = await host.selectWorkspace('workspace:1');
        assert.equal(typeof res, 'object');
        assert.equal(typeof res.ok, 'boolean');
      });

      test('isAlive retorna boolean', async () => {
        const v = await host.isAlive('workspace:1');
        assert.equal(typeof v, 'boolean');
      });

      test('needsInput retorna boolean', async () => {
        const v = await host.needsInput('workspace:1');
        assert.equal(typeof v, 'boolean');
      });
    });
  }

  // Asserts específicos de CmuxHost contra los fixtures golden (R-7 literal match).
  describe('CmuxHost — derivación needs_input desde notification.list (R-7)', () => {
    let host;
    before(() => {
      host = instantiateHost('cmux');
    });

    test('workspace:1 → needs_input=false (sin notification Waiting unread)', async () => {
      await host.listWorkspaces(); // puebla snapshot
      assert.equal(await host.needsInput('workspace:1'), false);
    });

    test('workspace:16 → needs_input=true (subtitle Waiting + is_read false)', async () => {
      await host.listWorkspaces();
      assert.equal(await host.needsInput('workspace:16'), true);
    });

    test('mapea workspace_ref ← ref y last_activity ← latest_submitted_at', async () => {
      const items = await host.listWorkspaces();
      const ws1 = items.find((w) => w.workspace_ref === 'workspace:1');
      assert.ok(ws1, 'workspace:1 presente');
      assert.equal(ws1.last_activity, '2026-05-29T22:26:03.108Z');
      const ws21 = items.find((w) => w.workspace_ref === 'workspace:21');
      assert.equal(ws21.last_activity, null, 'last_activity null cuando latest_submitted_at null');
    });

    test('alive=true para todo workspace presente en list-workspaces', async () => {
      const items = await host.listWorkspaces();
      for (const w of items) assert.equal(w.alive, true);
    });
  });
});
