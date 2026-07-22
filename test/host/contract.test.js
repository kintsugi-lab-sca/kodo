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
const TREE_FIXTURE = readFileSync(join(FIXTURES, 'surface-tree.json'), 'utf-8');
const SURFACE_FIXTURE = readFileSync(join(FIXTURES, 'surface-resume-show.json'), 'utf-8');
const SURFACE_MAP = JSON.parse(SURFACE_FIXTURE); // mapa surfaceRef → showOutput (DETECT-01)

/**
 * Extrae el valor de `--surface <ref>` de un argv ya unido con espacios y devuelve
 * la salida cruda de `surface resume show` para ese ref desde la fixture map.
 * Si el ref no está en el map, devuelve '' (simula not_found / surface sin binding).
 */
function surfaceShowFor(argv) {
  const m = argv.match(/--surface\s+(\S+)/);
  const ref = m ? m[1] : null;
  const entry = ref && SURFACE_MAP[ref];
  return entry ? JSON.stringify(entry) : '';
}

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
    if (argv.includes('workspace list')) payload = LIST_FIXTURE;
    else if (argv.includes('notification.list')) payload = NOTIF_FIXTURE;
    else if (argv.includes('surface resume show')) payload = surfaceShowFor(argv);
    else if (argv.includes('tree')) payload = TREE_FIXTURE;
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
function instantiateHost(name, runOverride) {
  if (name === 'cmux') {
    return getHost('cmux', {
      exec: fakeExecFromFixtures(),
      run:
        runOverride ||
        (async (args) => {
          const argv = (args || []).join(' ');
          if (argv.includes('workspace list')) return LIST_FIXTURE;
          if (argv.includes('notification.list')) return NOTIF_FIXTURE;
          if (argv.includes('surface resume show')) return surfaceShowFor(argv);
          if (argv.includes('tree')) return TREE_FIXTURE;
          return '';
        }),
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

    // IN-05 (Phase 78): guarda a nivel de elemento. listWorkspaces es never-throws por
    // contrato pero el .map/.some vive FUERA del try/catch de parseo. Un elemento
    // null/primitivo en workspaces o notifications NO debe hacer escapar una excepción.
    test('elementos null en workspaces/notifications → se filtran, nunca lanza (IN-05)', async () => {
      const malformed = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('workspace list')) {
          return JSON.stringify({
            workspaces: [
              { ref: 'workspace:1', latest_submitted_at: null, title: 'ok' },
              null, // elemento malformado: w.ref lanzaría sin el guard
            ],
          });
        }
        if (argv.includes('notification.list')) {
          return JSON.stringify({
            notifications: [
              null, // elemento malformado: n.workspace_ref lanzaría sin el guard
              { workspace_ref: 'workspace:1', is_read: false, subtitle: 'Waiting' },
            ],
          });
        }
        return '';
      };
      const h = instantiateHost('cmux', malformed);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.equal(items.length, 1, 'el elemento null de workspaces se filtra');
      assert.equal(items[0].workspace_ref, 'workspace:1');
      assert.equal(items[0].needs_input, true, 'el null de notifications no rompe el .some');
    });
  });

  // DETECT-01 — listAgentSurfaces() (método OPCIONAL typeof-detected, FUERA de
  // HOST_METHODS). Golden asserts campo a campo contra surface-resume-show.json
  // (cmux 0.64.16) + casos fail-open D-05 (never-throws, fila-a-fila).
  describe('CmuxHost — listAgentSurfaces (DETECT-01)', () => {
    let host;
    before(() => {
      host = instantiateHost('cmux');
    });

    test('retorna AgentSurface[] con {workspaceRef,cwd,sessionId,kind} campo a campo', async () => {
      const surfaces = await host.listAgentSurfaces();
      assert.ok(Array.isArray(surfaces), 'listAgentSurfaces retorna array');
      // surface:1 es el único adoptable de la fixture (source=agent-hook ∧ cleared=false).
      const adoptable = surfaces.find(
        (s) => s.sessionId === 'c1c3ed6d-fa07-43af-add7-44274b1e0a64',
      );
      assert.ok(adoptable, 'la surface adoptable está presente');
      // D-02: sessionId ← resume_binding.checkpoint_id (literal de la fixture).
      assert.equal(adoptable.sessionId, 'c1c3ed6d-fa07-43af-add7-44274b1e0a64');
      assert.equal(adoptable.cwd, '/Users/alex/dev/klab/kodo');
      assert.equal(adoptable.kind, 'claude');
      assert.equal(typeof adoptable.workspaceRef, 'string');
      assert.equal(adoptable.workspaceRef, 'workspace:1');
    });

    // Phase 56-06: enriquecimiento del title (← workspace list --json custom_title).
    test('setea title ← custom_title del workspace cuando has_custom_title===true (56-06)', async () => {
      const surfaces = await host.listAgentSurfaces();
      const adoptable = surfaces.find(
        (s) => s.sessionId === 'c1c3ed6d-fa07-43af-add7-44274b1e0a64',
      );
      assert.ok(adoptable, 'la surface adoptable está presente');
      // workspace:1 en list-workspaces.json tiene has_custom_title:true + custom_title:"KODO DEV".
      assert.equal(adoptable.title, 'KODO DEV', 'title ← custom_title del workspace de la surface');
    });

    test('title undefined cuando el workspace NO tiene custom_title (fail-open, 56-06)', async () => {
      // El workspace-list devuelve solo workspace:16 (has_custom_title:false). La surface
      // adoptable cae en workspace:1 que NO está en este list → sin join → title undefined.
      const noCustom = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('workspace list')) {
          return JSON.stringify({
            workspaces: [
              { ref: 'workspace:1', has_custom_title: false, custom_title: null, title: 'auto' },
            ],
          });
        }
        if (argv.includes('tree')) return TREE_FIXTURE;
        if (argv.includes('surface resume show')) return surfaceShowFor(argv);
        return '';
      };
      const h = instantiateHost('cmux', noCustom);
      const surfaces = await h.listAgentSurfaces();
      const adoptable = surfaces.find(
        (s) => s.sessionId === 'c1c3ed6d-fa07-43af-add7-44274b1e0a64',
      );
      assert.ok(adoptable, 'la surface adoptable está presente');
      assert.equal(adoptable.title, undefined, 'sin custom_title → title ausente (core cae al basename)');
    });

    test('workspace-list fetch falla → surfaces SIN title, nunca lanza (fail-open, 56-06)', async () => {
      // El title es una nicety: si la fetch del workspace-list falla, las surfaces se
      // devuelven igual (sin título). El contrato never-throws de discovery NO se rompe.
      const titleFetchFails = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('workspace list')) throw new Error('socket caído en workspace list');
        if (argv.includes('tree')) return TREE_FIXTURE;
        if (argv.includes('surface resume show')) return surfaceShowFor(argv);
        return '';
      };
      const h = instantiateHost('cmux', titleFetchFails);
      let surfaces;
      await assert.doesNotReject(async () => {
        surfaces = await h.listAgentSurfaces();
      });
      assert.equal(surfaces.length, 1, 'la surface adoptable sobrevive pese al fallo del title-fetch');
      assert.equal(surfaces[0].sessionId, 'c1c3ed6d-fa07-43af-add7-44274b1e0a64');
      assert.equal(surfaces[0].title, undefined, 'fail-open: sin title cuando la fetch del workspace-list falla');
    });

    test('omite cleared:true / sin resume_binding / source!=agent-hook (D-05)', async () => {
      const surfaces = await host.listAgentSurfaces();
      // La fixture tiene 4 refs; solo surface:1 es adoptable.
      assert.equal(surfaces.length, 1, 'solo la surface adoptable sobrevive');
      // Ninguna inválida se cuela: ni cleared (surface:3) ni source!=agent-hook (surface:4).
      assert.ok(!surfaces.some((s) => s.sessionId === '9f2a1b7c-3d4e-4f5a-b6c7-8d9e0f1a2b3c'));
      assert.ok(!surfaces.some((s) => s.kind === 'tmux'));
    });

    test('tree falla → [] (fail-open D-05), nunca lanza', async () => {
      const failTree = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('tree')) throw new Error('socket caído');
        return surfaceShowFor(argv);
      };
      const h = instantiateHost('cmux', failTree);
      let res;
      await assert.doesNotReject(async () => {
        res = await h.listAgentSurfaces();
      });
      assert.deepEqual(res, []);
    });

    test('un resume show individual falla → se omite esa surface, no rompe el array (D-05 fila-a-fila)', async () => {
      // Devuelve el tree, sirve surface:1 OK pero throws para surface:1... no:
      // hacemos throw en una surface NO adoptable (surface:2) y servimos surface:1 OK.
      const partialFail = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('tree')) return TREE_FIXTURE;
        if (argv.includes('surface resume show')) {
          if (argv.includes('--surface surface:2')) throw new Error('not_found');
          return surfaceShowFor(argv);
        }
        return '';
      };
      const h = instantiateHost('cmux', partialFail);
      let res;
      await assert.doesNotReject(async () => {
        res = await h.listAgentSurfaces();
      });
      // surface:1 (adoptable) sobrevive pese al fallo de surface:2.
      assert.equal(res.length, 1);
      assert.equal(res[0].sessionId, 'c1c3ed6d-fa07-43af-add7-44274b1e0a64');
    });

    test('shape malformado (kind/workspace_ref no-string) se omite — contrato AgentSurface (WR-01)', async () => {
      // cmux devuelve un binding agent-hook válido en source/checkpoint/cwd pero con
      // kind:null y SIN workspace_ref: el typedef AgentSurface promete los 4 como string.
      // normalizeSurface DEBE omitirlo (no debe fluir {kind:null, workspaceRef:undefined}
      // al consumer / adoptSession de Phase 56).
      const malformed = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('tree')) return TREE_FIXTURE;
        if (argv.includes('surface resume show')) {
          if (argv.includes('--surface surface:1')) {
            return JSON.stringify({
              workspace_ref: 12, // no-string (tampering)
              cleared: false,
              resume_binding: {
                source: 'agent-hook',
                checkpoint_id: 'malformed-0000-0000-0000-000000000000',
                cwd: '/Users/alex/dev/klab/kodo',
                kind: null, // no-string
              },
            });
          }
          return surfaceShowFor(argv);
        }
        return '';
      };
      const h = instantiateHost('cmux', malformed);
      let res;
      await assert.doesNotReject(async () => {
        res = await h.listAgentSurfaces();
      });
      assert.ok(
        !res.some((s) => s.sessionId === 'malformed-0000-0000-0000-000000000000'),
        'la surface con kind/workspace_ref no-string NO se cuela',
      );
      // y ningún campo undefined/null se filtró al array
      for (const s of res) {
        assert.equal(typeof s.workspaceRef, 'string', 'workspaceRef siempre string');
        assert.equal(typeof s.kind, 'string', 'kind siempre string');
      }
    });

    test('cleared truthy no-booleano (p. ej. "true") se trata como limpiada (WR-02)', async () => {
      // Bajo el threat model (stdout no confiable), un cleared:"true" (string) NO debe
      // bypasear el filtro de cleared. Cualquier truthy = limpiada.
      const truthyCleared = async (args) => {
        const argv = (args || []).join(' ');
        if (argv.includes('tree')) return TREE_FIXTURE;
        if (argv.includes('surface resume show')) {
          if (argv.includes('--surface surface:1')) {
            return JSON.stringify({
              workspace_ref: 'workspace:1',
              cleared: 'true', // truthy no-booleano
              resume_binding: {
                source: 'agent-hook',
                checkpoint_id: 'c1c3ed6d-fa07-43af-add7-44274b1e0a64',
                cwd: '/Users/alex/dev/klab/kodo',
                kind: 'claude',
              },
            });
          }
          return surfaceShowFor(argv);
        }
        return '';
      };
      const h = instantiateHost('cmux', truthyCleared);
      let res;
      await assert.doesNotReject(async () => {
        res = await h.listAgentSurfaces();
      });
      assert.ok(
        !res.some((s) => s.sessionId === 'c1c3ed6d-fa07-43af-add7-44274b1e0a64'),
        'una surface con cleared truthy no-booleano se omite',
      );
    });

    test('null host NO implementa listAgentSurfaces (rama degradación typeof, D-03)', () => {
      // El consumer (Phase 56) hace `typeof host.listAgentSurfaces === 'function'`
      // y degrada fail-open. NullHost lo deja AUSENTE para documentar esa rama.
      assert.notEqual(typeof getHost('null').listAgentSurfaces, 'function');
    });
  });

  // Phase 59 (liveness gap-fix) — _legacy.rename para que `kodo adopt` renombre el
  // workspace y su título lleve el task_ref (→ titleIdentifiesSession pasa en reconcile).
  describe('_legacy.rename (Phase 59 liveness)', () => {
    test('cmux host expone _legacy.rename como función', () => {
      const host = instantiateHost('cmux');
      assert.equal(typeof host?._legacy?.rename, 'function', 'cmux _legacy.rename presente');
    });

    test('null host expone un _legacy.rename no-op (fail-open en hosts non-cmux)', async () => {
      const host = getHost('null');
      assert.equal(typeof host?._legacy?.rename, 'function', 'NullHost _legacy.rename presente');
      // no-op: no lanza y resuelve undefined.
      await assert.doesNotReject(async () => {
        const r = await host._legacy.rename({ workspace: 'workspace:1', title: 'X' });
        assert.equal(r, undefined);
      });
    });

    test('cmux/client.js rename emite argv canónico `workspace rename <ws> --title <t>`', () => {
      // client.js no tiene seam de DI sobre execFile (resuelve el binario de config);
      // aserción a nivel de fuente del argv (espejo de los source-hygiene tests del suite).
      // Forma canónica cmux 0.64.16: `workspace rename` — NO `workspace-action --action set-title`
      // (esa acción no existe; verificado en vivo, "Unknown workspace action").
      const src = readFileSync(join(__dirname, '..', '..', 'src', 'cmux', 'client.js'), 'utf-8');
      assert.match(
        src,
        /['"]workspace['"],\s*['"]rename['"],\s*opts\.workspace,\s*['"]--title['"],\s*opts\.title/,
        'rename construye el argv canónico workspace rename con workspace + title',
      );
      assert.doesNotMatch(src, /--action['"],\s*['"]set-title/, 'NO usa la acción inexistente set-title');
    });
  });
});
