// test/host/contract.test.js
// Phase 38 SC#1 (TUI-17) — WorkspaceHost contract matrix.
// Espejo de test/providers/contract.test.js: itera implementations × asserts core.
// IMPLS = ['cmux', 'orca', 'null']. Todos los it() viven DENTRO del describe del loop
// (pitfall #3 de Phase 27 — asserts por implementación).
//
// KODO-18: 'orca' entra a la matriz. Que un host NUEVO pase los mismos asserts del
// contrato sin tocarlos es justamente lo que la matriz existe para demostrar.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOST_METHODS,
  HOST_NAMES,
  getHost,
  validateHost,
  resolveHostName,
  hostIsolatesWorktree,
  hostDeliversPrompt,
} from '../../src/host/interface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '..', 'fixtures', 'cmux');
const ORCA_FIXTURES = join(__dirname, '..', 'fixtures', 'orca');
const BB_FIXTURES = join(__dirname, '..', 'fixtures', 'bb');

// KODO-31 — golden fixture de `bb thread list --json` (shape verbatim de una instancia
// real de bb-app: array PLANO, sin sobre; ids anonimizados).
const BB_LIST_FIXTURE = readFileSync(join(BB_FIXTURES, 'thread-list.json'), 'utf-8');

// KODO-18 — golden fixtures de orca 1.4.184 (shape verbatim, paths anonimizados).
const ORCA_PS_FIXTURE = readFileSync(join(ORCA_FIXTURES, 'worktree-ps.json'), 'utf-8');
const ORCA_TERMINALS_FIXTURE = readFileSync(join(ORCA_FIXTURES, 'terminal-list.json'), 'utf-8');

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

const IMPLS = ['cmux', 'orca', 'bb', 'null'];

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
  if (name === 'bb') {
    // El host bb habla SOLO por `run`: una única llamada `thread list --json` alimenta
    // listWorkspaces/isAlive/needsInput.
    return getHost('bb', {
      run:
        runOverride ||
        (async (args) => ((args || []).join(' ').includes('thread list') ? BB_LIST_FIXTURE : '')),
      binary: '/fake/bb',
    });
  }
  if (name === 'orca') {
    // El host orca habla SOLO por `run` (no usa `exec`): una única llamada
    // `worktree ps --json` alimenta listWorkspaces/isAlive/needsInput.
    return getHost('orca', {
      run:
        runOverride ||
        (async (args) => {
          const argv = (args || []).join(' ');
          if (argv.includes('worktree ps')) return ORCA_PS_FIXTURE;
          if (argv.includes('terminal list')) return ORCA_TERMINALS_FIXTURE;
          return '';
        }),
      binary: '/fake/orca',
    });
  }
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

  // KODO-18 — el selector de host: la pieza que hace a Orca *elegible*.
  describe('selector de host (KODO-18)', () => {
    test('getHost instancia todos los HOST_NAMES sin lanzar', () => {
      for (const name of HOST_NAMES) {
        assert.doesNotThrow(() => validateHost(getHost(name)), `getHost('${name}') debe cumplir el contrato`);
      }
    });

    test('un host desconocido sigue lanzando (no se instancia silenciosamente un cmux)', () => {
      assert.throws(() => getHost('tmux'), /Unknown host/);
    });

    test('resolveHostName SIEMPRE devuelve un host elegible (fail-safe, never-throws)', () => {
      // Lee ~/.kodo/config.json real: el test no fija el valor, fija el INVARIANTE —
      // pase lo que pase con el fichero, el daemon arranca con un host instanciable.
      let name;
      assert.doesNotThrow(() => {
        name = resolveHostName();
      });
      assert.ok(HOST_NAMES.includes(name), `resolveHostName devolvió '${name}'`);
      assert.doesNotThrow(() => getHost(name));
    });

    test('hostIsolatesWorktree: orca y bb traen su propio checkout, cmux no', () => {
      // De este booleano depende que kodo emita o no `claude --worktree`. Si cmux
      // devolviera true, TODAS las sesiones de cmux perderían su aislamiento.
      assert.equal(hostIsolatesWorktree('cmux'), false);
      assert.equal(hostIsolatesWorktree('orca'), true);
      // KODO-31: `thread spawn --new-environment worktree` materializa el checkout.
      assert.equal(hostIsolatesWorktree('bb'), true);
      assert.equal(hostIsolatesWorktree('desconocido'), false, 'ante la duda, NO se omite el aislamiento');
    });

    // KODO-31 — la segunda capacidad, INDEPENDIENTE de la primera.
    test('hostDeliversPrompt: solo bb entrega el prompt al crear el workspace', () => {
      // Si cmux u orca devolvieran true, su `send` se omitiría y la sesión arrancaría
      // con la tab abierta y sin comando: el fallo más caro posible en el launch path.
      assert.equal(hostDeliversPrompt('cmux'), false);
      assert.equal(hostDeliversPrompt('orca'), false, 'orca aísla por worktree pero SÍ usa keystrokes');
      assert.equal(hostDeliversPrompt('bb'), true);
      assert.equal(hostDeliversPrompt('desconocido'), false, 'ante la duda, se teclea (comportamiento previo)');
    });

    test('las dos capacidades NO son la misma: orca las distingue', () => {
      // El test que impide fusionar los dos sets en uno. orca está en
      // HOSTS_WITH_OWN_WORKTREE y NO en HOSTS_DELIVERING_PROMPT: un solo flag mataría
      // el carril de keystrokes de orca.
      assert.equal(hostIsolatesWorktree('orca'), true);
      assert.equal(hostDeliversPrompt('orca'), false);
    });
  });

  // KODO-31 — asserts golden de BbHost contra thread-list.json (shape real de bb-app).
  // Los casos que este host resuelve de forma distinta a sus dos hermanos.
  describe('BbHost — derivación de WorkspaceInfo desde `thread list`', () => {
    let host;
    before(() => {
      host = instantiateHost('bb');
    });

    test('workspace_ref ← id del thread; title prefiere `title` sobre `titleFallback`', async () => {
      const items = await host.listWorkspaces();
      const byRef = new Map(items.map((w) => [w.workspace_ref, w]));
      assert.equal(byRef.get('thr_alpha0000').title, 'KODO-42: arreglar el login');
      // Sin `title` explícito cae al que BB deriva del prompt — nunca undefined si hay uno.
      assert.equal(
        byRef.get('thr_charlie000').title,
        'Investiga por qué el daemon no arranca en frío...',
      );
    });

    test('alive = PRESENCIA, no status: un thread idle o en error sigue vivo', async () => {
      const items = await host.listWorkspaces();
      const byRef = new Map(items.map((w) => [w.workspace_ref, w]));
      assert.equal(byRef.get('thr_alpha0000').alive, true, 'status active → alive');
      // LA DECISIÓN QUE ESTE TEST PROTEGE: la ficha proponía derivar alive del status
      // ({starting, active} vivos). Al verificar el esquema real de BB resultó que NO hay
      // campo que distinga un idle con runtime cargado de uno liberado, así que derivarlo
      // del status marcaría MUERTA toda sesión que solo terminó su turno — el mismo falso
      // «dead» (ROMAN-151/152) que ya mordió al host orca en su UAT.
      assert.equal(byRef.get('thr_bravo0000').alive, true, "status:'idle' NO significa muerta");
      assert.equal(
        byRef.get('thr_echo00000').alive,
        true,
        "status:'error' sigue presente y el humano tiene que verla",
      );
      assert.equal(byRef.get('thr_delta0000').alive, false, 'archivedAt gana sobre todo lo demás');
    });

    test('needs_input SOLO desde hasPendingInteraction (señal nativa de BB)', async () => {
      await host.listWorkspaces(); // puebla el snapshot 1-tick
      assert.equal(await host.needsInput('thr_bravo0000'), true);
      assert.equal(await host.needsInput('thr_alpha0000'), false, 'un thread activo trabaja, no espera');
      assert.equal(await host.needsInput('thr_echo00000'), false, 'error ≠ esperando input');
    });

    test('un hasPendingInteraction truthy no-booleano NO se cuela (stdout no confiable)', async () => {
      const tampered = async () =>
        JSON.stringify([{ id: 'thr_x', hasPendingInteraction: 'true', latestAttentionAt: 1 }]);
      const h = instantiateHost('bb', tampered);
      const items = await h.listWorkspaces();
      assert.equal(items[0].needs_input, false, 'la comparación es === true estricta');
    });

    test('last_activity: epoch ms → ISO, con latestAttentionAt ganando a updatedAt', async () => {
      const items = await host.listWorkspaces();
      const byRef = new Map(items.map((w) => [w.workspace_ref, w]));
      assert.equal(
        byRef.get('thr_alpha0000').last_activity,
        new Date(1787560500000).toISOString(),
        'latestAttentionAt gana aunque updatedAt sea distinto',
      );
      // latestAttentionAt:0 no es un timestamp — cae al siguiente candidato, no a null.
      assert.equal(
        byRef.get('thr_charlie000').last_activity,
        new Date(1787559000000).toISOString(),
        'un latestAttentionAt de 0 cae a updatedAt',
      );
    });

    test('un payload que NO es array NO se confunde con «lista vacía» (never-throws → [])', async () => {
      // BB no tiene sobre `{ok:false}`: un fallo sale por exit code. Pero un binario que
      // imprima otra cosa (aviso de actualización, versión incompatible) daría un JSON
      // válido no-array, y tragárselo como lista vacía borraría el snapshot entero.
      const notAnArray = async () => JSON.stringify({ error: 'unauthorized' });
      const h = instantiateHost('bb', notAnArray);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.deepEqual(items, []);
    });

    test('filas null / sin id se filtran fila-a-fila (never-throws)', async () => {
      const malformed = async () =>
        JSON.stringify([null, { title: 'sin id' }, { id: 'thr_ok', latestAttentionAt: 1787560000000 }]);
      const h = instantiateHost('bb', malformed);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.equal(items.length, 1, 'solo sobrevive la fila con id string');
      assert.equal(items[0].workspace_ref, 'thr_ok');
    });

    test('el binario falla → [] sin lanzar (never-throws)', async () => {
      const down = async () => {
        throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      };
      const h = instantiateHost('bb', down);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.deepEqual(items, []);
    });

    test('_legacy.close existe SOLO en bb (gate por capacidad del autocierre)', () => {
      // `runReconcileTick` decide si hay carril de autocierre con
      // `typeof host._legacy.close === 'function'`. Si cmux u orca lo expusieran, el
      // reconcile empezaría a parar sesiones de hosts que no lo necesitan.
      assert.equal(typeof instantiateHost('bb')._legacy.close, 'function');
      assert.notEqual(typeof instantiateHost('cmux')._legacy?.close, 'function');
      assert.notEqual(typeof instantiateHost('orca')._legacy?.close, 'function');
    });

    test('_legacy.workspaceCwd existe (bb crea su propio checkout)', () => {
      // Lo que hace que `worktree_path` de state.json apunte al worktree REAL de BB y el
      // overlay de progreso lea el `.planning/` de la sesión, no el del repo principal.
      assert.equal(typeof instantiateHost('bb')._legacy.workspaceCwd, 'function');
    });

    test('setStatus y setColor son no-op que RESUELVEN (BB no tiene canal de estado)', async () => {
      const h = instantiateHost('bb');
      // El launch path los llama sin try/catch en el caso de setStatus: si lanzaran,
      // abortarían el dispatch de toda sesión bb.
      await assert.doesNotReject(async () => {
        await h._legacy.setStatus({ workspace: 'thr_x', status: 'running' });
        await h._legacy.setColor({ workspace: 'thr_x', color: 'Amber' });
      });
    });

    test('NO implementa listAgentSurfaces (BB no publica el session_id de Claude)', () => {
      // Misma decisión explícita que en orca: sin el session_id del hijo no hay forma
      // honesta de reconstruir la identidad de un thread ad-hoc desde fuera.
      assert.notEqual(typeof instantiateHost('bb').listAgentSurfaces, 'function');
    });
  });

  // KODO-18 — asserts golden de OrcaHost contra worktree-ps.json (orca 1.4.184).
  // Los cuatro casos que este host debe distinguir y que cmux resuelve de otra forma.
  describe('OrcaHost — derivación de WorkspaceInfo desde `worktree ps`', () => {
    let host;
    before(() => {
      host = instantiateHost('orca');
    });

    test('workspace_ref ← worktreeId y title ← displayName', async () => {
      const items = await host.listWorkspaces();
      const kodo42 = items.find((w) => w.workspace_ref === 'repo-b::/orca/workspaces/beta/kodo-42');
      assert.ok(kodo42, 'la fila kodo-42 está presente por su worktreeId');
      assert.equal(kodo42.title, 'KODO-42: arreglar el login');
    });

    test('alive se deriva del pty, NO del enum `status` (regresión del UAT)', async () => {
      const items = await host.listWorkspaces();
      const byRef = new Map(items.map((w) => [w.workspace_ref, w]));
      assert.equal(byRef.get('repo-a::/repos/alpha').alive, true, 'status active → alive');
      // EL BUG QUE DESTAPÓ EL UAT: la primera versión hacía `status === 'active'` y
      // marcaba MUERTA una sesión que estaba trabajando, porque Orca publica
      // `status: 'working'` mientras el agente ejecuta. Un falso «dead» sobre una sesión
      // viva es la clase de fallo (ROMAN-151/152) que el reconcile existe para evitar.
      assert.equal(
        byRef.get('repo-b::/orca/workspaces/beta/kodo-42').alive,
        true,
        "status:'working' con pty vivo DEBE ser alive",
      );
      assert.equal(
        byRef.get('repo-a::/orca/workspaces/alpha/dormido').alive,
        false,
        'PRESENCIA ≠ VIDA en Orca: un worktree sin terminales sigue listado pero no está vivo',
      );
      assert.equal(
        byRef.get('repo-b::/orca/workspaces/beta/archivado').alive,
        false,
        'isArchived gana sobre el pty vivo',
      );
    });

    test('needs_input SOLO desde agents[].state — `unread` NO es proxy', async () => {
      await host.listWorkspaces(); // puebla el snapshot 1-tick
      // `done` es el literal REAL de Orca cuando el agente termina su turno y se queda
      // en el prompt (verificado en el UAT). La primera versión asumía `waiting` por
      // analogía con cmux y NINGUNA sesión llegaba nunca a needs-input.
      assert.equal(
        await host.needsInput('repo-b::/orca/workspaces/beta/kodo-23'),
        true,
        'agents[0].state === "done" → needs_input',
      );
      assert.equal(
        await host.needsInput('repo-b::/orca/workspaces/beta/kodo-42'),
        false,
        'un agente `working` está ocupado, NO esperando al humano',
      );
      // La fila `dormido` tiene unread:true y agents:[] — si `unread` se usara como
      // proxy, casi toda sesión en marcha entraría en needs-input (falsos positivos).
      assert.equal(
        await host.needsInput('repo-a::/orca/workspaces/alpha/dormido'),
        false,
        'unread:true con agents[] vacío NO debe marcar needs_input',
      );
    });

    test('last_activity: epoch ms → ISO, con lastOutputAt ganando a lastActivityAt', async () => {
      const items = await host.listWorkspaces();
      const byRef = new Map(items.map((w) => [w.workspace_ref, w]));
      assert.equal(
        byRef.get('repo-b::/orca/workspaces/beta/kodo-42').last_activity,
        new Date(1778599000000).toISOString(),
        'lastOutputAt (más preciso) gana cuando existe',
      );
      assert.equal(
        byRef.get('repo-a::/repos/alpha').last_activity,
        new Date(1778598551705).toISOString(),
        'sin lastOutputAt cae a lastActivityAt',
      );
    });

    test('un sobre con ok:false NO se confunde con «lista vacía» (never-throws → [])', async () => {
      const down = async () =>
        JSON.stringify({ id: 'x', ok: false, error: { code: 'runtime_unavailable', message: 'app cerrada' } });
      const h = instantiateHost('orca', down);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.deepEqual(items, [], 'runtime caído → [] sin lanzar');
    });

    test('filas null / sin worktreeId se filtran fila-a-fila (never-throws)', async () => {
      const malformed = async () =>
        JSON.stringify({
          id: 'x',
          ok: true,
          result: { worktrees: [null, { displayName: 'sin id' }, { worktreeId: 'repo-a::/x', status: 'active' }] },
        });
      const h = instantiateHost('orca', malformed);
      let items;
      await assert.doesNotReject(async () => {
        items = await h.listWorkspaces();
      });
      assert.equal(items.length, 1, 'solo sobrevive la fila con worktreeId string');
      assert.equal(items[0].workspace_ref, 'repo-a::/x');
    });

    test('NO implementa listAgentSurfaces (Orca no publica el session_id de Claude)', () => {
      // Decisión explícita, no un olvido: sin `checkpoint_id` no hay forma honesta de
      // reconstruir la identidad de una sesión ad-hoc, así que el método OPCIONAL se
      // deja AUSENTE y el descubrimiento de adopción degrada a [] por el typeof.
      assert.notEqual(typeof instantiateHost('orca').listAgentSurfaces, 'function');
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

    test('KODO-18: ambos hosts reales exponen _legacy.listTree (identidad del orquestador)', () => {
      // `orchestrator/launch.js` dejó de importar cmux/client.js: su revalidación
      // anti-duplicado consume esta vista cross-window del host activo.
      for (const name of ['cmux', 'orca']) {
        assert.equal(
          typeof instantiateHost(name)?._legacy?.listTree,
          'function',
          `${name} _legacy.listTree presente`,
        );
      }
    });

    // NOTA: aquí solo se comprueba la PRESENCIA. Los métodos de `_legacy` son
    // passthroughs fieles al módulo cliente, que resuelve su binario desde loadConfig()
    // — el `run` inyectado NO los alcanza, así que invocarlos en un test dispararía el
    // binario real del operador. El comportamiento de la traducción se cubre sobre la
    // función PURA `buildTreeFromPs` en test/orca/client.test.js, incluida su
    // integración con findWorkspaceInTree.

    test('orca host expone _legacy.rename como función', () => {
      const host = instantiateHost('orca');
      assert.equal(typeof host?._legacy?.rename, 'function', 'orca _legacy.rename presente');
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
