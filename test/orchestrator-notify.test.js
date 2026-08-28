// @ts-check
//
// test/orchestrator-notify.test.js — KODO-53: el aviso de UNA línea.
//
// La regla que este fichero blinda cabe en una frase: **solo se teclea si el orquestador
// está idle**. Todo lo demás —debounce, destinatario, fallos del host— son las formas de
// NO teclear.
//
// AISLAMIENTO POR SEAM, no por HOME (mismo patrón que `getOrchestratorFn` en
// `test/hooks/session-end.test.js`): `maybeNotifyOrchestrator` recibe `listFn`,
// `markNotifiedFn`, `getOrchestratorFn` y el `hostClient` por parámetro, así que ningún
// caso de aquí lee ni escribe el `~/.kodo/state.json` real ni abre un proceso `cmux`.
// Sin esos seams, la suite pasaría a depender de si la máquina que corre `npm test` tiene
// un orquestador vivo — y con uno idle, le TECLEARÍA avisos de prueba en su terminal.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { maybeNotifyOrchestrator } from '../src/orchestrator/notify.js';

const noOrchestrator = () => null;
const IDLE_SCREEN = 'salida previa\n❯';
const BUSY_SCREEN = '✻ Thinking… (12s · 3.1k tokens)';

/**
 * Stub del cliente del host que registra las llamadas. Shape mínimo de `host._legacy`.
 * @param {{ screen?: string, screenThrows?: boolean, sendThrows?: boolean, noReadScreen?: boolean }} [over]
 */
function makeHost(over = {}) {
  const calls = [];
  /** @type {any} */
  const host = {
    listWorkspaces: async () => {
      calls.push({ fn: 'listWorkspaces' });
      return 'workspace:9 kodo-orchestrator\n';
    },
    readScreen: async (args) => {
      calls.push({ fn: 'readScreen', args });
      if (over.screenThrows) throw new Error('cmuxd caído');
      return over.screen ?? IDLE_SCREEN;
    },
    send: async (args) => {
      calls.push({ fn: 'send', args });
      if (over.sendThrows) throw new Error('ref muerto');
    },
  };
  if (over.noReadScreen) delete host.readScreen;
  return { host, calls };
}

const mkEvent = (over = {}) => ({
  id: 'e1', ts: '2026-08-28T10:00:00.000Z', kind: 'session-end', task_ref: 'K-1',
  session_id: null, text: 'larga', seen: false, seen_at: null, notified_at: null, ...over,
});

describe('maybeNotifyOrchestrator — la puerta del idle', () => {
  it('ORQUESTADOR OCUPADO: no teclea nada, y el evento se queda en la bandeja', async () => {
    // Este es EL caso de KODO-53: con el orquestador a mitad de turno, en su prompt no
    // aparece nada. El evento ya está persistido; la siguiente ronda lo listará.
    const { host, calls } = makeHost({ screen: BUSY_SCREEN });
    const marked = [];
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent()],
      markNotifiedFn: (ids) => { marked.push(ids); return { ok: true, value: ids.length }; },
    });
    assert.deepEqual(r, { sent: false, reason: 'busy' });
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0, 'CERO keystrokes');
    assert.deepEqual(marked, [], 'sin aviso no se sella el debounce');
  });

  it('ORQUESTADOR IDLE: teclea UNA línea con el conteo y las refs', async () => {
    const { host, calls } = makeHost();
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent({ id: 'a', task_ref: 'ITCLIP-119' }), mkEvent({ id: 'b', task_ref: 'ITCLIP-121', kind: 'session-launched' })],
      markNotifiedFn: () => ({ ok: true, value: 2 }),
    });
    assert.equal(r.sent, true);
    assert.equal(r.reason, 'sent');
    assert.equal(r.workspace, 'workspace:9');
    const send = calls.find((c) => c.fn === 'send');
    assert.equal(
      send.args.text,
      '[kodo] 2 eventos nuevos — ITCLIP-119 en Review, ITCLIP-121 lanzada. Ronda.',
    );
    assert.ok(!send.args.text.includes('larga'), 'el texto LARGO se queda en la bandeja');
  });

  it('el aviso sella el debounce SOBRE LOS EVENTOS avisados', async () => {
    const { host } = makeHost();
    let marked = null;
    await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent({ id: 'a' }), mkEvent({ id: 'b' })],
      markNotifiedFn: (ids) => { marked = ids; return { ok: true, value: ids.length }; },
    });
    assert.deepEqual(marked, ['a', 'b']);
  });

  it('DEBOUNCE: un evento notificado hace 10 s silencia el aviso — tres cierres, un aviso', async () => {
    const now = new Date('2026-08-28T10:00:30.000Z');
    const { host, calls } = makeHost();
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      now: () => now,
      listFn: () => [
        mkEvent({ id: 'a', notified_at: '2026-08-28T10:00:20.000Z' }),
        mkEvent({ id: 'b' }),
        mkEvent({ id: 'c' }),
      ],
      markNotifiedFn: () => ({ ok: true, value: 0 }),
    });
    assert.deepEqual(r, { sent: false, reason: 'debounced' });
    assert.equal(calls.length, 0, 'el debounce corta ANTES de tocar el host (camino barato primero)');
  });

  it('pasada la ventana, el aviso vuelve y reagrupa TODO lo que sigue sin ver', async () => {
    const now = new Date('2026-08-28T10:05:00.000Z');
    const { host, calls } = makeHost();
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      now: () => now,
      listFn: () => [
        mkEvent({ id: 'a', task_ref: 'K-1', notified_at: '2026-08-28T10:00:00.000Z' }),
        mkEvent({ id: 'b', task_ref: 'K-2' }),
      ],
      markNotifiedFn: () => ({ ok: true, value: 2 }),
    });
    assert.equal(r.sent, true);
    const send = calls.find((c) => c.fn === 'send');
    assert.match(send.args.text, /^\[kodo\] 2 eventos nuevos — K-1 en Review, K-2 en Review\./);
  });

  it('BANDEJA VACÍA: ni siquiera consulta al host', async () => {
    const { host, calls } = makeHost();
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [],
    });
    assert.deepEqual(r, { sent: false, reason: 'nothing-unseen' });
    assert.equal(calls.length, 0);
  });

  it('SIN ORQUESTADOR: no es un error, es que no hay a quién avisar (ese caso lo cubre `kodo check`)', async () => {
    const { host, calls } = makeHost();
    host.listWorkspaces = async () => { calls.push({ fn: 'listWorkspaces' }); return ''; };
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent()],
    });
    assert.deepEqual(r, { sent: false, reason: 'no-orchestrator' });
    assert.equal(calls.filter((c) => c.fn === 'readScreen').length, 0, 'sin destinatario no se lee pantalla');
  });

  it('el ref REGISTRADO gana al del título (KODO-16) y es a él a quien se le lee la pantalla', async () => {
    const { host, calls } = makeHost();
    await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: () => ({ workspace_ref: 'workspace:42' }),
      listFn: () => [mkEvent()],
      markNotifiedFn: () => ({ ok: true, value: 1 }),
    });
    assert.equal(calls.find((c) => c.fn === 'readScreen').args.workspace, 'workspace:42');
    assert.equal(calls.find((c) => c.fn === 'send').args.workspace, 'workspace:42');
  });

  it('PANTALLA ILEGIBLE: fail-closed — no se teclea (ante la duda, la bandeja ya lo tiene)', async () => {
    const { host, calls } = makeHost({ screenThrows: true });
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent()],
    });
    assert.deepEqual(r, { sent: false, reason: 'unreadable' });
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0);
  });

  it('HOST SIN readScreen: fail-closed también — no se asume idle por no poder mirar', async () => {
    const { host, calls } = makeHost({ noReadScreen: true });
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent()],
    });
    assert.deepEqual(r, { sent: false, reason: 'unreadable' });
    assert.equal(calls.filter((c) => c.fn === 'send').length, 0);
  });

  it('SEND FALLIDO: NO sella el debounce — el siguiente cierre debe poder reintentar', async () => {
    // Sellar antes de saber si el aviso llegó dejaría al orquestador mudo 30 s por un
    // mensaje que nunca aterrizó.
    const { host } = makeHost({ sendThrows: true });
    let marked = null;
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => [mkEvent()],
      markNotifiedFn: (ids) => { marked = ids; return { ok: true, value: ids.length }; },
    });
    assert.deepEqual(r, { sent: false, reason: 'send-failed' });
    assert.equal(marked, null, 'sin entrega no hay debounce');
  });

  it('NEVER-THROWS: un listFn que revienta devuelve el discriminado, no una excepción', async () => {
    const { host } = makeHost();
    const r = await maybeNotifyOrchestrator({
      hostClient: host,
      getOrchestratorFn: noOrchestrator,
      listFn: () => { throw new Error('state.json ilegible'); },
    });
    assert.deepEqual(r, { sent: false, reason: 'error' });
  });

  it('NEVER-THROWS: sin `opts` útil tampoco lanza (el aviso jamás tumba a su caller)', async () => {
    const r = await maybeNotifyOrchestrator(/** @type {any} */ ({}));
    assert.equal(r.sent, false);
  });
});
