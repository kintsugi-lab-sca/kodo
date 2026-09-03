// @ts-check
//
// test/dashboard/row-actions.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/RowActions.js`: las acciones del modo LISTA
// sobre la fila seleccionada (Enter/`o`/`O`/`d`) y la rama DISMISS del double-confirm. Complementa
// `test/dashboard/app-focus.test.js`, `app-open.test.js` y `app-dismiss.test.js` (end-to-end).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  focusRow,
  openRow,
  focusOrchestrator,
  armDismiss,
  handleDismissConfirmInput,
  FOCUS_ERR_ZOMBIE,
  FOCUS_ERR_ENOENT,
  focusErrFailed,
  DISMISS_GUARD_ALIVE,
  DISMISS_OK,
  DISMISS_ERR,
  OPEN_OK,
  OPEN_ERR_NO_URL,
  OPEN_ERR_ENOENT,
  OPEN_ERR_BAD_PROTOCOL,
  openErrFailed,
  ORCH_OK,
  ORCH_NOT_RUNNING,
  ORCH_ERR,
} from '../../src/cli/dashboard/RowActions.js';
import { makeCtx, called } from '../helpers/dashboard-ctx.js';

/** Router de fetch por sufijo de URL. */
function routerFetch(routes) {
  return async (/** @type {string} */ url, /** @type {any} */ init) => {
    for (const [suffix, body] of Object.entries(routes)) {
      if (String(url).includes(suffix)) {
        const b = typeof body === 'function' ? body(init) : body;
        return { ok: b.__status !== 'fail', status: b.__status === 'fail' ? 500 : 200, json: async () => b };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('RowActions — Enter (focusRow)', () => {
  it('fila zombie → FOCUS_ERR_ZOMBIE y CERO invocación de cmux (D-02)', async () => {
    let calls = 0;
    const ctx = makeCtx({ onFocus: async () => { calls++; return { ok: true }; } });
    await focusRow({ alive: false, workspace_ref: 'workspace:1' }, ctx);
    assert.equal(ctx.focusError, FOCUS_ERR_ZOMBIE);
    assert.equal(calls, 0);
  });

  it('fila viva y éxito → sin mensaje de error (el foco es su propio feedback)', async () => {
    const ctx = makeCtx({ onFocus: async () => ({ ok: true }) });
    await focusRow({ alive: true, workspace_ref: 'workspace:1' }, ctx);
    assert.equal(called(ctx, 'setFocusError').length, 0);
  });

  it('ENOENT y NON_ZERO_EXIT mapean a sus literales', async () => {
    const a = makeCtx({ onFocus: async () => ({ ok: false, code: 'ENOENT' }) });
    await focusRow({ alive: true, workspace_ref: 'w' }, a);
    assert.equal(a.focusError, FOCUS_ERR_ENOENT);

    const b = makeCtx({ onFocus: async () => ({ ok: false, code: 'NON_ZERO_EXIT', detail: 3 }) });
    await focusRow({ alive: true, workspace_ref: 'w' }, b);
    assert.equal(b.focusError, focusErrFailed(3));

    const c = makeCtx({ onFocus: async () => ({ ok: false, code: 'SPAWN_ERROR' }) });
    await focusRow({ alive: true, workspace_ref: 'w' }, c);
    assert.equal(c.focusError, focusErrFailed('unknown'), 'detail ausente → "unknown"');
  });

  it('contexto degradado sin onFocus (tests sin DI) no lanza', async () => {
    const ctx = makeCtx({ onFocus: undefined });
    await focusRow({ alive: true, workspace_ref: 'w' }, ctx);
    assert.equal(called(ctx, 'setFocusError').length, 0);
  });
});

describe('RowActions — `o` (openRow)', () => {
  it('sin task_url → mensaje BARE (sin `[!]`) y onOpen NUNCA se invoca (D-05)', async () => {
    let calls = 0;
    const ctx = makeCtx({ onOpen: async () => { calls++; return { ok: true }; } });
    await openRow({ task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.focusError, OPEN_ERR_NO_URL);
    assert.ok(!ctx.focusError.includes('[!]'), 'es un no-op benigno, no un error');
    assert.equal(calls, 0);
  });

  it('éxito → footer verde OPEN_OK con el task_ref', async () => {
    const seen = [];
    const ctx = makeCtx({ onOpen: async (u) => { seen.push(u); return { ok: true }; } });
    await openRow({ task_ref: 'KODO-1', task_url: 'https://x/1' }, ctx);
    assert.deepEqual(seen, ['https://x/1']);
    assert.equal(ctx.focusError, OPEN_OK('KODO-1'));
    assert.equal(ctx.footerColor, 'green');
  });

  it('SIN guard alive: funciona sobre una fila zombie (D-04)', async () => {
    const ctx = makeCtx({ onOpen: async () => ({ ok: true }) });
    await openRow({ alive: false, task_ref: 'KODO-1', task_url: 'https://x/1' }, ctx);
    assert.equal(ctx.footerColor, 'green');
  });

  it('ENOENT / BAD_PROTOCOL / NON_ZERO_EXIT mapean a sus literales rojos', async () => {
    const cases = [
      [{ ok: false, code: 'ENOENT' }, OPEN_ERR_ENOENT],
      [{ ok: false, code: 'BAD_PROTOCOL' }, OPEN_ERR_BAD_PROTOCOL],
      [{ ok: false, code: 'NON_ZERO_EXIT', detail: 1 }, openErrFailed(1)],
    ];
    for (const [result, expected] of cases) {
      const ctx = makeCtx({ onOpen: async () => result });
      await openRow({ task_ref: 'K', task_url: 'https://x' }, ctx);
      assert.equal(ctx.focusError, expected);
      assert.equal(ctx.footerColor, 'red');
    }
  });
});

describe('RowActions — `O` (focusOrchestrator)', () => {
  it('resuelto + foco OK → footer verde ORCH_OK', async () => {
    const ctx = makeCtx({
      fetchFn: routerFetch({ '/orchestrator': { ok: true, workspace_ref: 'workspace:7' } }),
      onFocus: async () => ({ ok: true }),
    });
    await focusOrchestrator(ctx);
    assert.equal(ctx.focusError, ORCH_OK);
    assert.equal(ctx.footerColor, 'green');
  });

  it('resuelto pero sin workspace_ref → hint accionable, NO se llama a cmux', async () => {
    let calls = 0;
    const ctx = makeCtx({
      fetchFn: routerFetch({ '/orchestrator': { ok: true, workspace_ref: null } }),
      onFocus: async () => { calls++; return { ok: true }; },
    });
    await focusOrchestrator(ctx);
    assert.equal(ctx.focusError, ORCH_NOT_RUNNING);
    assert.equal(calls, 0);
  });

  it('fallo de red/HTTP → ORCH_ERR con el motivo honesto', async () => {
    const ctx = makeCtx({ fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
    await focusOrchestrator(ctx);
    assert.ok(String(ctx.focusError).startsWith(ORCH_ERR('').slice(0, 24)), 'formato `[!] orchestrator failed (…)`');
    assert.equal(ctx.footerColor, 'red');
  });

  it('el foco falla tras resolver → literal de FOCUS, no de ORCH', async () => {
    const ctx = makeCtx({
      fetchFn: routerFetch({ '/orchestrator': { ok: true, workspace_ref: 'workspace:7' } }),
      onFocus: async () => ({ ok: false, code: 'ENOENT' }),
    });
    await focusOrchestrator(ctx);
    assert.equal(ctx.focusError, FOCUS_ERR_ENOENT);
  });
});

describe('RowActions — `d` (armDismiss + confirm)', () => {
  it('sesión VIVA → guard rojo, NO entra en confirm (DISMISS-04/SC#2)', () => {
    const ctx = makeCtx();
    armDismiss({ alive: true, task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.focusError, DISMISS_GUARD_ALIVE);
    assert.equal(ctx.footerColor, 'red');
    assert.equal(called(ctx, 'setMode').length, 0);
  });

  it('sesión muerta → arma por IDENTIDAD (task_id) + ref legible y entra en confirm', () => {
    const ctx = makeCtx();
    armDismiss({ alive: false, task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.armedTaskId, 't1');
    assert.equal(ctx.armedTaskRef, 'KODO-1');
    assert.equal(ctx.mode, 'confirm');
  });

  it('sin task_ref, el ref legible cae a task_id', () => {
    const ctx = makeCtx();
    armDismiss({ alive: false, task_id: 't1' }, ctx);
    assert.equal(ctx.armedTaskRef, 't1');
  });

  it('segunda `d` manda UN DELETE y pinta el resultado', async () => {
    let deletes = 0;
    const ctx = makeCtx({
      armedTaskId: 't1',
      armedTaskRef: 'KODO-1',
      fetchFn: async (url, init) => {
        if (init?.method === 'DELETE') deletes++;
        return { ok: true, status: 200, json: async () => ({ ok: true, actions: [] }) };
      },
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(deletes, 1);
    assert.equal(ctx.focusError, DISMISS_OK('KODO-1'));
    assert.equal(ctx.armedTaskId, null);
    assert.equal(ctx.mode, 'list');
  });

  it('un 409 `alive` del server (TOCTOU) se pinta como error', async () => {
    const ctx = makeCtx({
      armedTaskId: 't1',
      armedTaskRef: 'KODO-1',
      fetchFn: async () => ({ ok: false, status: 409, json: async () => ({ error: 'alive' }) }),
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(ctx.focusError, DISMISS_ERR('alive'));
    assert.equal(ctx.footerColor, 'red');
  });

  it('Esc y cualquier otra tecla CANCELAN sin mandar DELETE (D-04)', async () => {
    for (const key of ['x', 'a', '']) {
      let deletes = 0;
      const ctx = makeCtx({
        armedTaskId: 't1',
        armedTaskRef: 'KODO-1',
        fetchFn: async (url, init) => {
          if (init?.method === 'DELETE') deletes++;
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        },
      });
      await handleDismissConfirmInput(key, ctx);
      assert.equal(deletes, 0, `la tecla "${key}" no debe ejecutar el dismiss`);
      assert.equal(ctx.armedTaskId, null);
      assert.equal(ctx.mode, 'list');
    }
  });

  it('WR-01 guard: armedTaskId nulo aborta silenciosamente sin DELETE', async () => {
    let deletes = 0;
    const ctx = makeCtx({
      armedTaskId: null,
      fetchFn: async (url, init) => {
        if (init?.method === 'DELETE') deletes++;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(deletes, 0);
    assert.equal(ctx.mode, 'list');
  });

  // KODO-78: el dismiss cierra su ciclo VISUAL. Sin esto, la fila descartada seguía pintada hasta
  // el siguiente tick del poll (2,5 s, hasta 10 s con el backoff abierto) bajo un footer que ya
  // decía "dismissed".
  it('tras un dismiss OK refresca el poll inmediatamente (KODO-78)', async () => {
    let refreshes = 0;
    const ctx = makeCtx({
      armedTaskId: 't1',
      armedTaskRef: 'KODO-1',
      refreshNow: () => refreshes++,
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, actions: [] }) }),
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(ctx.focusError, DISMISS_OK('KODO-1'));
    assert.equal(refreshes, 1, 'el éxito debe forzar un refresco: la fila descartada desaparece ya');
  });

  it('tras un 409 `alive` TAMBIÉN refresca: la tabla estaba mintiendo (KODO-78)', async () => {
    let refreshes = 0;
    const ctx = makeCtx({
      armedTaskId: 't1',
      armedTaskRef: 'KODO-1',
      refreshNow: () => refreshes++,
      fetchFn: async () => ({ ok: false, status: 409, json: async () => ({ error: 'alive' }) }),
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(ctx.focusError, DISMISS_ERR('alive'));
    assert.equal(refreshes, 1, 'el 409 significa que la fila revivió — hay que re-sincronizar');
  });

  it('cancelar el confirm NO refresca (no hubo DELETE)', async () => {
    let refreshes = 0;
    const ctx = makeCtx({ armedTaskId: 't1', armedTaskRef: 'KODO-1', refreshNow: () => refreshes++ });
    await handleDismissConfirmInput('x', ctx);
    assert.equal(refreshes, 0);
  });

  it('ctx degradado sin refreshNow: el dismiss no lanza', async () => {
    const ctx = makeCtx({
      armedTaskId: 't1',
      armedTaskRef: 'KODO-1',
      refreshNow: undefined,
      fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, actions: [] }) }),
    });
    await handleDismissConfirmInput('d', ctx);
    assert.equal(ctx.focusError, DISMISS_OK('KODO-1'));
  });
});

describe('RowActions — contrato de re-export', () => {
  it('App.js re-exporta los literales FOCUS_/DISMISS_/OPEN_/ORCH_ sin alterarlos', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/RowActions.js');
    const names = Object.keys(Mod).filter((k) => /^(FOCUS_|DISMISS_|OPEN_|ORCH_|focusErr|openErr)/.test(k));
    assert.ok(names.length >= 17, 'deben re-exportarse todos los literales del carril');
    for (const name of names) {
      assert.equal(App[name], Mod[name], `App.js debe re-exportar ${name}`);
    }
  });
});
