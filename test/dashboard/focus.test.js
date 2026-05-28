// @ts-check
//
// test/dashboard/focus.test.js — Phase 37 Plan 01 Wave 0 (TUI-13 + TUI-14).
//
// Cubre los 5 escenarios del discriminante {ok} de `runFocus` (D-01 + D-07):
//   1. ok path           → callback sin err + args ordering literal → { ok:true }
//   2. ENOENT mapping    → err.code='ENOENT' → { ok:false, code:'ENOENT', detail }
//   3. NON_ZERO_EXIT     → err.code=7 (numérico) → { ok:false, code:'NON_ZERO_EXIT', detail:7 }
//   4. SPAWN_ERROR       → exec sync-throws → { ok:false, code:'SPAWN_ERROR' } (never-throws)
//   5. leak guard        → omitir `exec` → TypeError (estructural, runFocus jamás toca execFile real)
//
// runFocus NEVER-THROWS: cualquier modo de fallo colapsa al discriminante, jamás una
// excepción que llegue al caller en App.js (TUI-14 invariante "no crash" — estructural aquí,
// alineado con Phase 35 D-07 `fetchStatus` pattern).
//
// Leak guard ESTRUCTURAL (NO override de globalThis — `execFile` no es global):
// `runFocus` REQUIERE `exec` como argumento sin default. Cualquier test que olvide pasarlo
// falla con `TypeError: exec is not a function` (Test 5). Sin esa inyección, jamás se toca
// el `execFile` real de `node:child_process`. El patrón es callback-style idéntico a la
// firma de execFile: `(cmd, args, opts, cb)`.
//
// Estado Wave 0: ROJO por diseño hasta que la Task 2 cree `src/cli/dashboard/focus.js`
// (export `runFocus`). Hoy el import falla porque el archivo no existe — la mordida
// esperada del Nyquist gate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runFocus } from '../../src/cli/dashboard/focus.js';

describe('Phase 37 Plan 01: runFocus never-throws + args ordering (TUI-13/TUI-14)', () => {
  it('ok path: callback sin err → { ok: true } y args ordering literal', async () => {
    /** @type {{ cmd: string, args: string[], opts: object } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { cmd, args, opts };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runFocus({
      exec,
      ref: 'workspace:5',
      binary: '/path/to/cmux',
    });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured, 'exec must be invoked');
    assert.equal(captured.cmd, '/path/to/cmux');
    assert.deepEqual(
      captured.args,
      ['select-workspace', '--workspace', 'workspace:5'],
      'args ordering literal D-07: [select-workspace, --workspace, ref]',
    );
  });

  it('ENOENT mapping: err.code="ENOENT" → { ok:false, code:"ENOENT", detail }', async () => {
    const exec = (cmd, args, opts, cb) => {
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      setImmediate(() => cb(err, '', ''));
    };
    const result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
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
    const result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
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
      result = await runFocus({ exec, ref: 'workspace:1', binary: 'cmux' });
    } catch {
      rejected = true;
    }
    assert.equal(
      rejected,
      false,
      'never-throws: promise must NOT reject on sync exec throw (D-01 + Phase 35 D-07 contract)',
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SPAWN_ERROR');
    assert.equal(typeof result.detail, 'string');
  });

  it('leak guard estructural: omitir exec → TypeError (jamás toca execFile real)', async () => {
    // Sin `exec` inyectado, `runFocus` invoca `undefined(...)` y produce TypeError.
    // Esto demuestra que NO hay fallback al `execFile` de `node:child_process` dentro
    // del módulo — la inyección es contractual. El leak guard es ESTRUCTURAL: imposible
    // que un test "tonto" toque cmux real porque la API no lo permite.
    await assert.rejects(
      // @ts-ignore — deliberadamente omitiendo `exec` para verificar el guard.
      async () => runFocus({ ref: 'workspace:1', binary: 'cmux' }),
      (err) => err instanceof TypeError,
      'sin exec inyectado, runFocus debe fallar con TypeError (leak guard estructural)',
    );
  });
});
