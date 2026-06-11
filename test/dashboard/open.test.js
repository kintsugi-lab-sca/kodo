// @ts-check
//
// test/dashboard/open.test.js — Phase 48 Plan 02 (OPEN-01/02/03).
//
// Clon del esqueleto de 5 escenarios de focus.test.js para el discriminante {ok} de
// `runOpen`, MÁS un 6º escenario adversarial (allowlist http(s)):
//   1. ok path           → callback sin err + args ordering literal `[url]` → { ok:true }
//   2. ENOENT mapping    → err.code='ENOENT' → { ok:false, code:'ENOENT', detail }
//   3. NON_ZERO_EXIT     → err.code=7 (numérico) → { ok:false, code:'NON_ZERO_EXIT', detail:7 }
//   4. SPAWN_ERROR       → exec sync-throws → { ok:false, code:'SPAWN_ERROR' } (never-throws)
//   5. leak guard        → omitir `exec` → TypeError (estructural, runOpen jamás toca execFile real)
//   6. BAD_PROTOCOL      → URL adversarial → { ok:false, code:'BAD_PROTOCOL' } + exec NUNCA invocado
//
// runOpen NEVER-THROWS: cualquier modo de fallo (incl. un `new URL()` que lance al parsear
// una URL basura) colapsa al discriminante, jamás una excepción que llegue al caller en
// App.js (OPEN-02 invariante "no crash" — alineado con focus.js / Phase 35 D-07).
//
// Leak guard ESTRUCTURAL: `runOpen` REQUIERE `exec` como argumento sin default — aunque
// `binary` SÍ defaulta a 'open' (divergencia con focus.js). Cualquier test que olvide pasar
// `exec` falla con TypeError. Sin esa inyección, jamás se toca el `execFile` real.
//
// Allowlist http(s) (OPEN-03, Pitfall 4): el guard de protocolo corre ANTES de exec. Solo
// `http:`/`https:` pasan; `file://`, `javascript:`, valores con dash inicial (`-a Calculator`),
// strings vacíos y URLs no parseables se rechazan a BAD_PROTOCOL y exec NUNCA se invoca
// (contador de llamadas == 0). Esto mata la flag-injection de `open` (una URL http(s) real
// nunca empieza por `-`) y los `file://` accidentales.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runOpen } from '../../src/cli/dashboard/open.js';

describe('Phase 48 Plan 02: runOpen never-throws + args [url] + http(s) allowlist (OPEN-01/02/03)', () => {
  it('ok path: callback sin err → { ok: true } y args ordering literal [url]', async () => {
    /** @type {{ cmd: string, args: string[], opts: object } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { cmd, args, opts };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runOpen({
      exec,
      url: 'https://example.com/x',
      binary: 'open',
    });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured, 'exec must be invoked');
    assert.equal(captured.cmd, 'open');
    assert.deepEqual(
      captured.args,
      ['https://example.com/x'],
      'args ordering literal OPEN-03: [url] — un único positional, sin verbo/flag',
    );
  });

  it('binary defaults to "open": ok path sin pasar binary explícito', async () => {
    /** @type {{ cmd: string, args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { cmd, args };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runOpen({ exec, url: 'http://example.org' });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured);
    assert.equal(captured.cmd, 'open', 'binary defaultea a "open" (divergencia con focus.js)');
  });

  it('http:// también pasa la allowlist (no solo https)', async () => {
    let called = 0;
    const exec = (cmd, args, opts, cb) => {
      called++;
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runOpen({ exec, url: 'http://plane.local/browse/KL-1' });
    assert.deepEqual(result, { ok: true });
    assert.equal(called, 1, 'exec invocado para una URL http:// válida');
  });

  it('ENOENT mapping: err.code="ENOENT" → { ok:false, code:"ENOENT", detail }', async () => {
    const exec = (cmd, args, opts, cb) => {
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      setImmediate(() => cb(err, '', ''));
    };
    const result = await runOpen({ exec, url: 'https://example.com', binary: 'open' });
    assert.equal(result.ok, false);
    if (result.ok) return; // narrowing para ts
    assert.equal(result.code, 'ENOENT');
    assert.equal(typeof result.detail, 'string');
    assert.ok(result.detail.length > 0, 'detail debe ser un string no vacío');
  });

  it('NON_ZERO_EXIT mapping: err.code=7 → { ok:false, code:"NON_ZERO_EXIT", detail:7 }', async () => {
    const exec = (cmd, args, opts, cb) => {
      const err = Object.assign(new Error('command failed'), { code: 7 });
      setImmediate(() => cb(err, '', ''));
    };
    const result = await runOpen({ exec, url: 'https://example.com', binary: 'open' });
    assert.equal(result.ok, false);
    if (result.ok) return; // narrowing
    assert.equal(result.code, 'NON_ZERO_EXIT');
    assert.equal(result.detail, 7);
  });

  it('never-throws contract: exec sync-throws → { ok:false, code:"SPAWN_ERROR" }', async () => {
    const exec = () => {
      throw new Error('bad args');
    };
    let rejected = false;
    /** @type {any} */
    let result;
    try {
      result = await runOpen({ exec, url: 'https://example.com', binary: 'open' });
    } catch {
      rejected = true;
    }
    assert.equal(
      rejected,
      false,
      'never-throws: la promise NO debe rechazar ante un sync-throw de exec (OPEN-02)',
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SPAWN_ERROR');
    assert.equal(typeof result.detail, 'string');
  });

  it('leak guard estructural: omitir exec → TypeError (jamás toca execFile real)', async () => {
    // Sin `exec` inyectado, `runOpen` debe fallar con TypeError ANTES de tocar nada — el
    // guard es estructural (mismo patrón que focus.js). `binary` defaulta a 'open' pero
    // `exec` NO tiene default: la inyección es contractual.
    await assert.rejects(
      // @ts-ignore — deliberadamente omitiendo `exec` para verificar el guard.
      async () => runOpen({ url: 'https://example.com' }),
      (err) => err instanceof TypeError,
      'sin exec inyectado, runOpen debe fallar con TypeError (leak guard estructural)',
    );
  });

  it('allowlist http(s) adversarial: rechaza file://, javascript:, dash, vacío y basura a BAD_PROTOCOL sin invocar exec', async () => {
    const adversarial = [
      'javascript:alert(1)',
      'file:///etc/passwd',
      '-a Calculator',
      '',
      'not a url',
    ];
    for (const url of adversarial) {
      let execCalls = 0;
      const exec = (cmd, args, opts, cb) => {
        execCalls++;
        setImmediate(() => cb(null, '', ''));
      };
      const result = await runOpen({ exec, url });
      assert.equal(result.ok, false, `"${url}" debe resolver {ok:false}`);
      if (result.ok) continue; // narrowing
      assert.equal(
        result.code,
        'BAD_PROTOCOL',
        `"${url}" debe colapsar a BAD_PROTOCOL (allowlist http(s), Pitfall 4)`,
      );
      assert.equal(
        execCalls,
        0,
        `exec NUNCA debe invocarse para "${url}" — el guard corre ANTES de exec`,
      );
    }
  });
});
