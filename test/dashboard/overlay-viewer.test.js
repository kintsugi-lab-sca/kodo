// @ts-check
//
// test/dashboard/overlay-viewer.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/OverlayViewer.js`: la sub-máquina de teclado
// del `mode:'overlay'` (cierre + scroll clamped) y las cuatro aperturas (c/l/L/p), incluido el
// reqId-guard CR-01 anti-reapertura-obsoleta.
//
// Complementa (no sustituye) `test/dashboard-overlay.test.js`, que sigue verificando el mismo
// contrato END-TO-END sobre el árbol ink. Aquí se ataca el handler DIRECTO — sin React, sin
// clock falso — que es justo lo que la extracción hizo posible.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleOverlayInput,
  openCommentsOverlay,
  openLogsOverlay,
  openLogsAllOverlay,
  OVERLAY_VIEWPORT,
} from '../../src/cli/dashboard/OverlayViewer.js';
import { makeCtx, KEY, called } from '../helpers/dashboard-ctx.js';

/** Router de fetch por sufijo de URL (never-throws, mismo molde que los tests de integración). */
function routerFetch(routes) {
  return async (/** @type {string} */ url) => {
    for (const [suffix, body] of Object.entries(routes)) {
      if (String(url).includes(suffix)) {
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

describe('OverlayViewer — cierre y scroll de mode:overlay', () => {
  it('Esc cierra a list, limpia overlayKind e INVALIDA las aperturas en vuelo (CR-01)', async () => {
    const ctx = makeCtx({ overlaySnapshot: { kind: 'comments', lines: ['a'], status: 'ok', taskRef: 'X-1' } });
    await handleOverlayInput('', KEY.escape, ctx);
    assert.equal(ctx.mode, 'list');
    assert.equal(ctx.overlayKind, null);
    assert.equal(ctx.overlayReqRef.current, 1, 'el token debe avanzar para descartar el post-await');
  });

  it('↑ hace clamp en 0 (no scrollea por encima del inicio)', async () => {
    const ctx = makeCtx({ scrollOffset: 0, overlaySnapshot: { kind: 'logs', lines: ['a', 'b'], status: 'ok', taskRef: '' } });
    await handleOverlayInput('', KEY.up, ctx);
    assert.equal(ctx.scrollOffset, 0);
  });

  it('↓ hace clamp en lines.length - OVERLAY_VIEWPORT (el último scroll deja el viewport LLENO)', async () => {
    const lines = Array.from({ length: OVERLAY_VIEWPORT + 3 }, (_, i) => `l${i}`);
    const ctx = makeCtx({ scrollOffset: 3, overlaySnapshot: { kind: 'logs', lines, status: 'ok', taskRef: '' } });
    await handleOverlayInput('', KEY.down, ctx);
    assert.equal(ctx.scrollOffset, 3, 'ya estaba en el máximo (3 = 21 - 18) → no avanza');
  });

  it('con menos líneas que el viewport el máximo es 0 (WR-01: nunca negativo)', async () => {
    const ctx = makeCtx({ scrollOffset: 0, overlaySnapshot: { kind: 'logs', lines: ['solo-una'], status: 'ok', taskRef: '' } });
    await handleOverlayInput('', KEY.down, ctx);
    assert.equal(ctx.scrollOffset, 0);
  });

  it('cualquier otra tecla se TRAGA (no toca estado) mientras el operador lee', async () => {
    const ctx = makeCtx({ overlaySnapshot: { kind: 'plan', lines: ['x'], status: 'ok', taskRef: '' } });
    await handleOverlayInput('z', KEY.none, ctx);
    assert.deepEqual(ctx.calls, []);
  });
});

describe('OverlayViewer — apertura de comentarios (`c`)', () => {
  it('congela un snapshot con las líneas proyectadas y entra a mode:overlay', async () => {
    const ctx = makeCtx({
      fetchFn: routerFetch({ '/comments': { comments: [{ author: 'ana', body: 'hola' }, { text: 'suelto' }] } }),
    });
    await openCommentsOverlay({ task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.mode, 'overlay');
    assert.equal(ctx.overlayKind, 'comments');
    assert.equal(ctx.scrollOffset, 0);
    assert.deepEqual(ctx.overlaySnapshot.lines, ['ana: hola', 'suelto']);
    assert.equal(ctx.overlaySnapshot.status, 'ok');
    assert.equal(ctx.overlaySnapshot.taskRef, 'KODO-1');
  });

  it('`supported:false` gana sobre ok/empty (estado PERMANENTE, D-08)', async () => {
    const ctx = makeCtx({ fetchFn: routerFetch({ '/comments': { supported: false, comments: [] } }) });
    await openCommentsOverlay({ task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.overlaySnapshot.status, 'unsupported');
  });

  it('lista vacía → status empty (distinto de unsupported)', async () => {
    const ctx = makeCtx({ fetchFn: routerFetch({ '/comments': { comments: [] } }) });
    await openCommentsOverlay({ task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.overlaySnapshot.status, 'empty');
  });

  it('CR-01: si el token avanza durante el await, la apertura se DESCARTA', async () => {
    const ctx = makeCtx({
      fetchFn: async () => {
        ctx.overlayReqRef.current += 5; // simula un Esc / segunda apertura durante el fetch
        return { ok: true, status: 200, json: async () => ({ comments: [{ body: 'tardío' }] }) };
      },
    });
    await openCommentsOverlay({ task_id: 't1', task_ref: 'KODO-1' }, ctx);
    assert.equal(ctx.mode, 'list', 'no debe reabrir un overlay obsoleto');
    assert.equal(ctx.overlaySnapshot, null);
  });
});

describe('OverlayViewer — aperturas de logs (`l` y `L`)', () => {
  it('`l` grepea por task_ref/workspace_ref y proyecta `ts level msg`', async () => {
    const ctx = makeCtx({
      fetchFn: routerFetch({
        '/logs': { logs: [{ ts: 'T1', level: 'info', msg: 'algo de KODO-1' }, { msg: 'ruido ajeno' }] },
      }),
    });
    await openLogsOverlay({ task_ref: 'KODO-1', workspace_ref: 'workspace:9' }, ctx);
    assert.equal(ctx.overlayKind, 'logs');
    assert.deepEqual(ctx.overlaySnapshot.lines, ['T1 info algo de KODO-1']);
  });

  it('`l` sin coincidencias → status empty', async () => {
    const ctx = makeCtx({ fetchFn: routerFetch({ '/logs': { logs: [{ msg: 'nada que ver' }] } }) });
    await openLogsOverlay({ task_ref: 'KODO-1', workspace_ref: 'workspace:9' }, ctx);
    assert.equal(ctx.overlaySnapshot.status, 'empty');
  });

  it('`L` NO grepea: proyecta TODAS las líneas del buffer compartido', async () => {
    const ctx = makeCtx({
      fetchFn: routerFetch({ '/logs': { logs: [{ msg: 'uno' }, { msg: 'dos' }, { msg: 'tres' }] } }),
    });
    await openLogsAllOverlay(ctx);
    assert.equal(ctx.overlayKind, 'logs-all');
    assert.deepEqual(ctx.overlaySnapshot.lines, ['uno', 'dos', 'tres']);
    assert.equal(ctx.overlaySnapshot.taskRef, '', 'la vista general no está atada a una fila');
  });

  it('fetch fallido → status error (never-throws: el panel no se desmonta)', async () => {
    const ctx = makeCtx({ fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
    await openLogsAllOverlay(ctx);
    assert.equal(ctx.overlaySnapshot.status, 'error');
    assert.equal(ctx.mode, 'overlay');
  });
});

describe('OverlayViewer — saneo del contenido externo (HYG-07/M4)', () => {
  it('los comentarios del provider pasan por stripControlChars antes del render', async () => {
    // OSC-52 (secuestro del portapapeles): ESC ] 52 ; c ; <b64> BEL. El vector se construye con
    // escapes \u… — nada de bytes de control crudos en el fuente del test.
    const ESC = '\u001b';
    const BEL = '\u0007';
    const osc52 = `inocuo${ESC}]52;c;YmFk${BEL}cola`;
    const ctx = makeCtx({ fetchFn: routerFetch({ '/comments': { comments: [{ body: osc52 }] } }) });
    await openCommentsOverlay({ task_id: 't1', task_ref: 'X' }, ctx);
    const [line] = ctx.overlaySnapshot.lines;
    assert.ok(osc52.includes(ESC), 'guard del propio test: el vector debe llevar un ESC real');
    assert.ok(!line.includes(ESC), 'ningún ESC debe sobrevivir a la proyección');
    assert.ok(!line.includes(BEL), 'ningún BEL debe sobrevivir a la proyección');
    assert.ok(line.includes('inocuo') && line.includes('cola'), 'el texto legítimo se conserva');
  });
});

describe('OverlayViewer — contrato de re-export', () => {
  it('App.js sigue exportando los literales OVERLAY_* (SessionTable y los tests los importan de ahí)', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/OverlayViewer.js');
    for (const name of Object.keys(Mod).filter((k) => k.startsWith('OVERLAY_'))) {
      assert.equal(App[name], Mod[name], `App.js debe re-exportar ${name} sin alterarlo`);
    }
    assert.ok(called(makeCtx(), 'setMode').length === 0, 'sanity del helper: ctx recién creado sin llamadas');
  });
});
