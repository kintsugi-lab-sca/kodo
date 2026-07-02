// @ts-check
//
// test/daemon/logging-epipe-safe.test.js — Phase 66 Plan 05 (gap-closure D-01/D-05).
//
// Regresión del flood infinito observado en el spike `brew services`: bajo launchd,
// stdout/stderr del daemon están conectados a un PIPE; cuando ese pipe se rompe
// (EPIPE / "Broken pipe, errno 32") Node emite un 'error' en el stream. Como NO hay
// handler y el patch de console reescribe en el mismo pipe roto (y encima intentaría
// loguear el fallo), el proceso entra en un bucle auto-sostenido de EPIPE.
//
// Dos superficies endurecidas, cubiertas aquí con DI (mismos patrones que run.test.js):
//   1. server.js — el writer patcheado de console (makeSafeConsoleWriter) debe: (a) NO
//      lanzar si el writer original tira EPIPE, (b) NO recursar/loopear (llamar al
//      writer exactamente una vez, sin intentar loguear el fallo), (c) igualmente
//      registrar la entrada en el buffer in-memory (pushLog corrió primero).
//   2. run.js — runDaemon debe registrar listeners 'error' en process.stdout y
//      process.stderr al arrancar, y un EPIPE emitido NO debe lanzar (swallow).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeSafeConsoleWriter, getLogBuffer } from '../../src/server.js';
import { runDaemon } from '../../src/daemon/run.js';

/** Error EPIPE-like como el que Node adjunta al romperse un pipe (errno 32). */
function epipeError() {
  return Object.assign(new Error('write EPIPE'), { code: 'EPIPE', errno: -32, syscall: 'write' });
}

describe('server.js console patch: EPIPE-safe writer', () => {
  it('no lanza, no recursa y aún así puebla el log buffer cuando el writer tira EPIPE', () => {
    let calls = 0;
    const throwingWriter = (..._args) => { calls += 1; throw epipeError(); };
    const safe = makeSafeConsoleWriter('error', throwingWriter);
    const marker = `epipe-marker-${Date.now()}-${Math.random()}`;

    assert.doesNotThrow(() => safe(marker), 'un EPIPE del writer original no debe propagarse');
    assert.equal(calls, 1, 'el writer original se llama EXACTAMENTE una vez (sin loop/recursión)');

    const buf = getLogBuffer();
    const hit = buf.find((e) => typeof e.msg === 'string' && e.msg.includes(marker));
    assert.ok(hit, 'pushLog corrió primero: la entrada existe en el buffer in-memory');
    assert.equal(hit.level, 'error', 'nivel preservado');
  });

  it('info y warn también son resilientes a un writer que lanza', () => {
    const throwingWriter = () => { throw epipeError(); };
    assert.doesNotThrow(() => makeSafeConsoleWriter('info', throwingWriter)('hola', { a: 1 }));
    assert.doesNotThrow(() => makeSafeConsoleWriter('warn', throwingWriter)('cuidado'));
  });
});

describe('runDaemon: guards de EPIPE en stdout/stderr', () => {
  /** Stream fake que captura los listeners por evento. */
  function makeFakeStream() {
    const handlers = {};
    return {
      handlers,
      on(ev, fn) { (handlers[ev] ||= []).push(fn); return this; },
    };
  }

  /** Fake `process` con on/exit (mismo shape que run.test.js). */
  function makeFakeProc() {
    const handlers = {};
    const exitCalls = [];
    return { handlers, exitCalls, on(sig, fn) { handlers[sig] = fn; }, exit(code) { exitCalls.push(code); } };
  }

  const CONFIG = { provider: 'plane' };

  it('registra listeners "error" en stdout y stderr; un EPIPE emitido no lanza', async () => {
    const stdout = makeFakeStream();
    const stderr = makeFakeStream();
    const proc = makeFakeProc();

    await runDaemon({
      _loadConfig: () => CONFIG,
      _providerUsesPolling: () => false,
      _startServer: () => ({ server: { close() {} }, stopReconcile: () => {} }),
      _writePidFile: () => {},
      _removePidFile: () => {},
      _process: proc,
      _stdout: stdout,
      _stderr: stderr,
      _block: async () => {},
      _log: () => {},
    });

    assert.ok(stdout.handlers.error && stdout.handlers.error.length >= 1, 'listener "error" en stdout');
    assert.ok(stderr.handlers.error && stderr.handlers.error.length >= 1, 'listener "error" en stderr');
    assert.doesNotThrow(() => stdout.handlers.error[0](epipeError()), 'EPIPE en stdout es swallowed');
    assert.doesNotThrow(() => stderr.handlers.error[0](epipeError()), 'EPIPE en stderr es swallowed');
  });
});
