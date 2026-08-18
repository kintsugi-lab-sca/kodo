// @ts-check
//
// test/orchestrator-identity.test.js — KODO-16.
//
// El bug: con un orquestador vivo, `kodo stop && kodo up` hacía que el siguiente
// `kodo check` lanzara un SEGUNDO orquestador. Dos supervisores sobre el mismo
// state.json y la misma cola despachan la misma tarea dos veces y duplican
// comentarios en el provider.
//
// La detección de «ya hay orquestador» era `findOrchestratorRef`: buscar una tab
// TITULADA `kodo-orchestrator` en `cmux workspace list`. Falla por dos sitios —
// el título es mutable (arrancar el daemon desde esa tab la renombra a
// `心動 kodo service`, server.js) y `workspace list` es window-scoped.
//
// Estos tests cubren el carril que lo sustituye: identidad persistida en
// state.json + revalidación contra `cmux tree --all --json` (cross-window, por
// UUID), más el guard que impide que el daemon pise el nombre del orquestador.
//
// Todo son unidades puras o con DI — cero cmux real, cero HOME real.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findWorkspaceInTree,
  verifyRegisteredOrchestrator,
  resolveWorkspaceId,
} from '../src/orchestrator/launch.js';
import { shouldBrandWorkspace } from '../src/server.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ORCH_UUID = '0AE8A07E-B73A-40EB-B168-2270EEE03683';
const OTHER_UUID = '2720E3EA-6B7D-4B3D-9FA5-2D0D91313014';

/** Árbol mínimo con la shape real de `cmux tree --all --json` (dos windows). */
function treeFixture() {
  return {
    windows: [
      {
        ref: 'window:1',
        workspaces: [
          { ref: 'workspace:1', id: OTHER_UUID, title: 'Grupo 5' },
        ],
      },
      {
        ref: 'window:2',
        workspaces: [
          { ref: 'workspace:32', id: ORCH_UUID, title: '心動 kodo service' },
        ],
      },
    ],
  };
}

/** Registro canónico de state.json `.orchestrator`. */
function registration(over = {}) {
  return {
    workspace_ref: 'workspace:32',
    workspace_id: ORCH_UUID,
    session_id: 'sess-1',
    started_at: '2026-08-10T08:00:00.000Z',
    ...over,
  };
}

describe('findWorkspaceInTree — resolución de identidad cross-window', () => {
  it('encuentra el workspace por UUID aunque viva en OTRO window', () => {
    // El corazón del bug: `workspace list` (window-scoped) no lo vería. El árbol sí.
    const hit = findWorkspaceInTree(treeFixture(), { id: ORCH_UUID });
    assert.equal(hit?.ref, 'workspace:32');
    assert.equal(hit?.id, ORCH_UUID);
  });

  it('encuentra por UUID aunque el título ya NO sea kodo-orchestrator', () => {
    // Regresión directa: el fixture tiene la tab renombrada a `心動 kodo service`
    // por el arranque del daemon, que es lo que huerfanizaba al orquestador.
    const hit = findWorkspaceInTree(treeFixture(), { id: ORCH_UUID });
    assert.equal(hit?.title, '心動 kodo service');
  });

  it('con id presente NO cae al match por ref (ref reciclado ≠ workspace vivo)', () => {
    // cmux reusa `workspace:N`. Si el ref existe pero con OTRO uuid, el workspace
    // registrado murió y su número lo heredó otro: eso es un miss, no un hit.
    const tree = {
      windows: [{ workspaces: [{ ref: 'workspace:32', id: OTHER_UUID, title: 'otra cosa' }] }],
    };
    assert.equal(findWorkspaceInTree(tree, { id: ORCH_UUID, ref: 'workspace:32' }), null);
  });

  it('cae al match por ref cuando el registro no tiene UUID (degradado)', () => {
    const hit = findWorkspaceInTree(treeFixture(), { id: null, ref: 'workspace:32' });
    assert.equal(hit?.ref, 'workspace:32');
  });

  it('devuelve el ref del ÁRBOL, no el buscado', () => {
    const tree = { windows: [{ workspaces: [{ ref: 'workspace:40', id: ORCH_UUID }] }] };
    const hit = findWorkspaceInTree(tree, { id: ORCH_UUID, ref: 'workspace:32' });
    assert.equal(hit?.ref, 'workspace:40');
  });

  it('null cuando no se pide ninguna identidad', () => {
    assert.equal(findWorkspaceInTree(treeFixture(), {}), null);
    assert.equal(findWorkspaceInTree(treeFixture(), { id: null, ref: null }), null);
  });

  it('never-throws ante shapes inválidas', () => {
    for (const bad of [null, undefined, 42, 'texto', {}, { windows: 'no-array' }]) {
      assert.equal(findWorkspaceInTree(/** @type {any} */ (bad), { id: ORCH_UUID }), null);
    }
    // Elementos basura DENTRO del árbol (cmux malformado) no deben lanzar.
    const dirty = { windows: [null, { workspaces: [null, 7, { ref: 'workspace:1' }] }] };
    assert.equal(findWorkspaceInTree(dirty, { id: ORCH_UUID }), null);
  });
});

describe('verifyRegisteredOrchestrator — el gate anti-duplicado', () => {
  const okTree = async () => JSON.stringify(treeFixture());

  it('none cuando no hay registro (el caller sigue a su fallback)', async () => {
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: okTree,
      getOrchestratorFn: () => null,
    });
    assert.deepEqual(v, { status: 'none' });
  });

  it('alive: el workspace registrado sigue en el árbol → NO se lanza otro', async () => {
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: okTree,
      getOrchestratorFn: () => registration(),
    });
    assert.deepEqual(v, { status: 'alive', ref: 'workspace:32' });
  });

  it('alive aunque el check corra desde otro window y la tab esté renombrada', async () => {
    // Reproducción del escenario exacto de KODO-16: daemon reiniciado (tab renombrada)
    // y check disparado desde window:1 (el orquestador vive en window:2).
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: okTree,
      getOrchestratorFn: () => registration(),
    });
    assert.equal(v.status, 'alive');
  });

  it('dead: el host responde y el workspace NO está → se puede relanzar', async () => {
    // Criterio 3: un registro huérfano no puede dejar la cola sin supervisor.
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: async () => JSON.stringify({ windows: [{ workspaces: [] }] }),
      getOrchestratorFn: () => registration(),
    });
    assert.deepEqual(v, { status: 'dead', ref: 'workspace:32' });
  });

  it('dead cuando el ref sobrevive pero con otro UUID (tab reciclada)', async () => {
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: async () =>
        JSON.stringify({ windows: [{ workspaces: [{ ref: 'workspace:32', id: OTHER_UUID }] }] }),
      getOrchestratorFn: () => registration(),
    });
    assert.equal(v.status, 'dead');
  });

  it('unverifiable cuando cmux falla → NO se lanza (silencio ≠ muerte)', async () => {
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: async () => { throw new Error('cmux tree failed: socket'); },
      getOrchestratorFn: () => registration(),
    });
    assert.deepEqual(v, { status: 'unverifiable', ref: 'workspace:32' });
  });

  it('unverifiable ante JSON corrupto', async () => {
    const v = await verifyRegisteredOrchestrator({
      listTreeFn: async () => '{ no json',
      getOrchestratorFn: () => registration(),
    });
    assert.equal(v.status, 'unverifiable');
  });

  it('no consulta el host cuando no hay registro (cero I/O innecesaria)', async () => {
    let calls = 0;
    await verifyRegisteredOrchestrator({
      listTreeFn: async () => { calls++; return '{}'; },
      getOrchestratorFn: () => null,
    });
    assert.equal(calls, 0);
  });
});

describe('resolveWorkspaceId — UUID de un workspace:N', () => {
  it('resuelve el UUID desde el árbol', async () => {
    const id = await resolveWorkspaceId('workspace:32', {
      listTreeFn: async () => JSON.stringify(treeFixture()),
    });
    assert.equal(id, ORCH_UUID);
  });

  it('null cuando el ref no está en el árbol', async () => {
    const id = await resolveWorkspaceId('workspace:99', {
      listTreeFn: async () => JSON.stringify(treeFixture()),
    });
    assert.equal(id, null);
  });

  it('null (never-throws) cuando cmux falla — el registro degrada a solo-ref', async () => {
    const id = await resolveWorkspaceId('workspace:32', {
      listTreeFn: async () => { throw new Error('boom'); },
    });
    assert.equal(id, null);
  });
});

describe('shouldBrandWorkspace — el daemon no pisa el nombre del orquestador', () => {
  it('false sin CMUX_WORKSPACE_ID (no hay nada que marcar)', () => {
    assert.equal(shouldBrandWorkspace(undefined, null), false);
    assert.equal(shouldBrandWorkspace('', null), false);
  });

  it('true sin orquestador registrado (comportamiento previo intacto)', () => {
    assert.equal(shouldBrandWorkspace(ORCH_UUID, null), true);
  });

  it('false cuando el workspace ES el del orquestador registrado', () => {
    // La causa proximal de KODO-16: `kodo up` desde la tab del orquestador la
    // renombraba a `心動 kodo service` y le borraba la identidad.
    assert.equal(shouldBrandWorkspace(ORCH_UUID, registration()), false);
  });

  it('true cuando es otro workspace', () => {
    assert.equal(shouldBrandWorkspace(OTHER_UUID, registration()), true);
  });

  it('true cuando el registro no tiene UUID (sin evidencia, no se bloquea)', () => {
    assert.equal(shouldBrandWorkspace(ORCH_UUID, registration({ workspace_id: null })), true);
  });

  it('false también si el host exportara el ref en vez del UUID', () => {
    assert.equal(shouldBrandWorkspace('workspace:32', registration()), false);
  });

  it('false bajo el test runner (la suite no renombra el workspace del operador)', () => {
    // Verificado en vivo durante KODO-16: los tests que arrancan un server heredan el
    // CMUX_WORKSPACE_ID del shell y renombraban la tab real desde la que corre `npm test`.
    assert.equal(shouldBrandWorkspace(ORCH_UUID, null, true), false);
    assert.equal(shouldBrandWorkspace(OTHER_UUID, registration(), true), false);
  });

  it('el guard de test está cableado a NODE_TEST_CONTEXT en el callsite', () => {
    // El flag se pasa desde `brandServiceWorkspace`, que no es exportable; se blinda por
    // source-hygiene para que un refactor no lo deje suelto.
    const source = readFileSync(join(REPO, 'src', 'server.js'), 'utf-8');
    assert.match(source, /shouldBrandWorkspace\([^)]*NODE_TEST_CONTEXT[^)]*\)/);
  });
});
