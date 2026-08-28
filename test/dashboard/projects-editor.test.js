// @ts-check
//
// test/dashboard/projects-editor.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/ProjectsEditor.js`: el fetch de 2 hops y los
// siete modos `projects*`. Complementa `test/dashboard-projects.test.js` (end-to-end sobre ink).
//
// Los tests de ESCRITURA usan un directorio temporal real: `validateExistingDir` hace I/O de
// verdad (never-throws) y el contrato PROJ-02 es justamente "una ruta inválida NUNCA llega al
// disco" — falsearlo con un stub anularía el assert.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runProjectsFetch,
  handleProjectsInput,
  PROJECTS_REMOVED,
  PROJECTS_SAVED_RESTART,
  PROJECTS_NO_MODULES,
  PROJECTS_LOAD_FAILED,
} from '../../src/cli/dashboard/ProjectsEditor.js';
import { makeCtx, KEY, called } from '../helpers/dashboard-ctx.js';

const REMOTE = [
  { id: 'p1', identifier: 'KODO', name: 'kodo' },
  { id: 'p2', identifier: 'SCP', name: 'scp' },
];

/** @type {string} */
let TMP;
before(() => {
  TMP = mkdtempSync(join(tmpdir(), 'kodo-projects-editor-'));
});
after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('ProjectsEditor — runProjectsFetch (1.er hop)', () => {
  it('éxito → snapshot CONGELADO { remote, map, dispatch } y mode:projects', async () => {
    const ctx = makeCtx({
      listProjectsFn: async () => ({ ok: true, projects: REMOTE }),
      loadProjectsFn: () => ({ p1: '/ruta/kodo' }),
      dispatchProjectIdsFn: () => ['p1'],
      fieldCursor: 4,
    });
    await runProjectsFetch(ctx);
    assert.equal(ctx.mode, 'projects');
    assert.deepEqual(ctx.projectsSnapshot.remote, REMOTE);
    assert.deepEqual(ctx.projectsSnapshot.map, { p1: '/ruta/kodo' });
    assert.ok(ctx.projectsSnapshot.dispatch.has('p1'), 'el set dispatch-enabled se congela también');
    assert.equal(ctx.fieldCursor, 0);
    const modes = called(ctx, 'setMode');
    assert.deepEqual(modes, ['projects-loading', 'projects'], 'pasa por el transitorio de carga');
  });

  it('fallo → projects-error con el motivo (NO fail-open: distingue 0-proyectos de error de red)', async () => {
    const ctx = makeCtx({ listProjectsFn: async () => ({ ok: false, error: 'ECONNREFUSED' }) });
    await runProjectsFetch(ctx);
    assert.equal(ctx.mode, 'projects-error');
    assert.equal(ctx.projectsError, 'ECONNREFUSED');
  });

  it('T-64-08: si projectsReqRef avanza durante el await, el resultado tardío se DESCARTA', async () => {
    const ctx = makeCtx({
      listProjectsFn: async () => {
        ctx.projectsReqRef.current += 2; // Esc en projects-loading
        return { ok: true, projects: REMOTE };
      },
    });
    await runProjectsFetch(ctx);
    assert.equal(ctx.projectsSnapshot, null);
    assert.deepEqual(called(ctx, 'setMode'), ['projects-loading'], 'no llega a abrir la lista');
  });
});

describe('ProjectsEditor — mode:projects-loading y projects-error', () => {
  it('Esc en loading invalida el fetch en vuelo y vuelve a list', async () => {
    const ctx = makeCtx();
    await handleProjectsInput('projects-loading', '', KEY.escape, ctx);
    assert.equal(ctx.projectsReqRef.current, 1);
    assert.equal(ctx.mode, 'list');
  });

  it('`r` en projects-error re-dispara el MISMO carril de fetch', async () => {
    let hits = 0;
    const ctx = makeCtx({
      listProjectsFn: async () => {
        hits++;
        return { ok: true, projects: REMOTE };
      },
    });
    await handleProjectsInput('projects-error', 'r', KEY.none, ctx);
    assert.equal(hits, 1);
    assert.equal(ctx.mode, 'projects');
  });

  it('projects-error es carril de LECTURA: jamás llama a saveProjectsFn (PROJ-05)', async () => {
    let writes = 0;
    const ctx = makeCtx({
      saveProjectsFn: () => { writes++; },
      listProjectsFn: async () => ({ ok: false, error: 'boom' }),
    });
    await handleProjectsInput('projects-error', 'r', KEY.none, ctx);
    await handleProjectsInput('projects-error', '', KEY.escape, ctx);
    assert.equal(writes, 0);
    assert.equal(ctx.mode, 'list');
  });
});

describe('ProjectsEditor — mode:projects (lista)', () => {
  const snap = () => ({ remote: REMOTE, map: { p1: '/ruta/kodo' }, dispatch: new Set(['p1']) });

  it('↑/↓ hacen clamp sin wrap sobre la lista remota', async () => {
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 0 });
    await handleProjectsInput('projects', '', KEY.up, ctx);
    assert.equal(ctx.fieldCursor, 0);
    await handleProjectsInput('projects', '', KEY.down, ctx);
    assert.equal(ctx.fieldCursor, 1);
    await handleProjectsInput('projects', '', KEY.down, ctx);
    assert.equal(ctx.fieldCursor, 1, 'clamp superior en len-1');
  });

  it('Enter PRECARGA la ruta actual (forma dual) y entra a projects-edit', async () => {
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 0 });
    await handleProjectsInput('projects', '', KEY.enter, ctx);
    assert.equal(ctx.mode, 'projects-edit');
    assert.equal(ctx.buffer, '/ruta/kodo');
    assert.equal(ctx.cursor, '/ruta/kodo'.length);
  });

  it('Enter sobre un proyecto SIN mapear precarga cadena vacía', async () => {
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 1 });
    await handleProjectsInput('projects', '', KEY.enter, ctx);
    assert.equal(ctx.buffer, '');
  });

  it('`x` quita el mapeo, persiste y avisa en ámbar (PROJ-03)', async () => {
    let saved = null;
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 0, saveProjectsFn: (m) => { saved = m; } });
    await handleProjectsInput('projects', 'x', KEY.none, ctx);
    assert.deepEqual(saved, {}, 'el mapeo desaparece del mapa persistido');
    assert.deepEqual(ctx.projectsSnapshot.map, {});
    assert.equal(ctx.focusError, PROJECTS_REMOVED('KODO'));
    assert.equal(ctx.footerColor, 'yellow');
  });
});

describe('ProjectsEditor — 2.º hop de MÓDULOS (`m` en mode:projects)', () => {
  const snap = () => ({ remote: REMOTE, map: {}, dispatch: new Set() });

  it('con módulos → los congela en el snapshot y abre projects-modules', async () => {
    const mods = [{ id: 'm1', name: 'Review' }];
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 0, listModulesFn: async () => ({ ok: true, modules: mods }) });
    await handleProjectsInput('projects', 'm', KEY.none, ctx);
    assert.equal(ctx.mode, 'projects-modules');
    assert.deepEqual(ctx.projectsSnapshot.modules, mods);
    assert.equal(ctx.projectsSnapshot.activeProjectId, 'p1');
    assert.equal(ctx.fieldCursor, 0);
  });

  it('lista VACÍA (github) → footer informativo, NO abre el sub-overlay ni escribe', async () => {
    let writes = 0;
    const ctx = makeCtx({
      projectsSnapshot: snap(),
      fieldCursor: 0,
      listModulesFn: async () => ({ ok: true, modules: [] }),
      saveProjectsFn: () => { writes++; },
    });
    await handleProjectsInput('projects', 'm', KEY.none, ctx);
    assert.equal(ctx.focusError, PROJECTS_NO_MODULES);
    assert.equal(ctx.mode, 'projects');
    assert.equal(writes, 0);
  });

  it('fallo del 2.º hop → footer rojo y vuelta a projects (never-throws)', async () => {
    const ctx = makeCtx({ projectsSnapshot: snap(), fieldCursor: 0, listModulesFn: async () => ({ ok: false, error: '503' }) });
    await handleProjectsInput('projects', 'm', KEY.none, ctx);
    assert.equal(ctx.focusError, PROJECTS_LOAD_FAILED('503'));
    assert.equal(ctx.footerColor, 'red');
    assert.equal(ctx.mode, 'projects');
  });

  it('T-64-12: si el token avanza durante el 2.º await, el resultado tardío se descarta', async () => {
    const ctx = makeCtx({
      projectsSnapshot: snap(),
      fieldCursor: 0,
      listModulesFn: async () => {
        ctx.projectsReqRef.current += 3;
        return { ok: true, modules: [{ id: 'm1', name: 'Review' }] };
      },
    });
    await handleProjectsInput('projects', 'm', KEY.none, ctx);
    assert.deepEqual(called(ctx, 'setMode'), ['projects-modules-loading']);
    assert.equal(ctx.projectsSnapshot.modules, undefined);
  });

  it('Esc en projects-modules-loading vuelve a projects (no a list: se abrió DESDE projects)', async () => {
    const ctx = makeCtx();
    await handleProjectsInput('projects-modules-loading', '', KEY.escape, ctx);
    assert.equal(ctx.mode, 'projects');
    assert.equal(ctx.projectsReqRef.current, 1);
  });
});

describe('ProjectsEditor — text-input de rutas (PROJ-02: la inválida NUNCA llega al disco)', () => {
  it('ruta inexistente → projectsEditError, cero escrituras, sigue editando', async () => {
    let writes = 0;
    const ctx = makeCtx({
      projectsSnapshot: { remote: REMOTE, map: {}, dispatch: new Set() },
      fieldCursor: 0,
      buffer: join(TMP, 'no-existe-jamas'),
      saveProjectsFn: () => { writes++; },
    });
    await handleProjectsInput('projects-edit', '', KEY.enter, ctx);
    assert.equal(writes, 0);
    assert.ok(ctx.projectsEditError, 'el error va al estado DEDICADO');
    assert.equal(called(ctx, 'setMode').length, 0, 'no sale de projects-edit');
  });

  it('ruta válida → setProjectPath + persistencia + aviso ámbar y vuelta a projects', async () => {
    let saved = null;
    const ctx = makeCtx({
      projectsSnapshot: { remote: REMOTE, map: {}, dispatch: new Set() },
      fieldCursor: 0,
      buffer: TMP,
      saveProjectsFn: (m) => { saved = m; },
    });
    await handleProjectsInput('projects-edit', '', KEY.enter, ctx);
    assert.ok(saved && saved.p1, 'el proyecto queda mapeado');
    assert.equal(ctx.focusError, PROJECTS_SAVED_RESTART);
    assert.equal(ctx.mode, 'projects');
  });

  it('Esc cancela sin guardar', async () => {
    let writes = 0;
    const ctx = makeCtx({ projectsSnapshot: { remote: REMOTE, map: {}, dispatch: new Set() }, buffer: TMP, saveProjectsFn: () => { writes++; } });
    await handleProjectsInput('projects-edit', '', KEY.escape, ctx);
    assert.equal(writes, 0);
    assert.equal(ctx.mode, 'projects');
  });

  it('el sub-editor de módulos preserva el `default` y los OTROS módulos (D-06/T-64-13)', async () => {
    let saved = null;
    const ctx = makeCtx({
      projectsSnapshot: {
        remote: REMOTE,
        map: { p1: { default: '/ruta/base', modules: { Otro: '/ruta/otro' } } },
        dispatch: new Set(),
        modules: [{ id: 'm1', name: 'Review' }],
        activeProjectId: 'p1',
      },
      fieldCursor: 0,
      buffer: TMP,
      saveProjectsFn: (m) => { saved = m; },
    });
    await handleProjectsInput('projects-modules-edit', '', KEY.enter, ctx);
    assert.equal(saved.p1.default, '/ruta/base', 'el default sobrevive');
    assert.equal(saved.p1.modules.Otro, '/ruta/otro', 'los otros módulos sobreviven');
    assert.ok(saved.p1.modules.Review, 'el módulo editado se materializa por NOMBRE del provider');
    assert.equal(ctx.mode, 'projects-modules');
  });
});

describe('ProjectsEditor — contrato de re-export', () => {
  it('App.js re-exporta los literales PROJECTS_* sin alterarlos', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/ProjectsEditor.js');
    for (const name of Object.keys(Mod).filter((k) => k.startsWith('PROJECTS_'))) {
      assert.equal(App[name], Mod[name], `App.js debe re-exportar ${name}`);
    }
  });
});
