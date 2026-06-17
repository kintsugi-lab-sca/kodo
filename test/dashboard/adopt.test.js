// @ts-check
//
// test/dashboard/adopt.test.js — Phase 56 Plan 01 (DETECT-02).
//
// Clon del esqueleto de 5 escenarios de open.test.js para el discriminante {ok} de
// `runAdopt`, DROPpeando el 6º escenario adversarial BAD_PROTOCOL (específico de open.js;
// runAdopt NO valida protocolo — los 4 valores de argv vienen de datos confiables del host
// + el reverse-lookup). Las divergencias load-bearing respecto a runOpen:
//   - binary === process.execPath, args[0] === kodoBin (NO execFile de bin/kodo directo —
//     bin/kodo es un script #!/usr/bin/env node; Pitfall 4).
//   - argv LITERAL de 8 elementos tras kodoBin:
//       ['adopt','--workspace',ref,'--cwd',cwd,'--session-id',sid,'--project',pid]
//   - exit codes semánticos de `kodo adopt` (0 ok / 1 config / 2 transient) → NON_ZERO_EXIT
//     con detail = el código literal (1 o 2).
//
// Escenarios:
//   1. ok path           → callback sin err + cmd===execPath + args[0]===kodoBin + argv literal → {ok:true}
//   2. ENOENT mapping    → err.code='ENOENT' → { ok:false, code:'ENOENT', detail }
//   3. NON_ZERO_EXIT     → err.code=1 → detail:1 Y err.code=2 → detail:2 (semántica kodo adopt)
//   4. SPAWN_ERROR       → exec sync-throws → { ok:false, code:'SPAWN_ERROR' } (never-throws, NO reject)
//   5. leak guard        → omitir `exec` → TypeError (estructural; runAdopt jamás toca execFile real)
//
// runAdopt NEVER-THROWS: cualquier modo de fallo colapsa al discriminante, jamás una
// excepción que llegue al caller en App.js (D-07, espejo focus.js / Phase 35 D-07).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { runAdopt } from '../../src/cli/dashboard/adopt.js';

const EXEC_PATH = '/usr/local/bin/node';
const KODO_BIN = '/repo/bin/kodo';
const WORKSPACE_REF = 'workspace:5';
const CWD = '/home/op/projects/kodo/src';
const SESSION_ID = 'sess-abc123';
const PROJECT_ID = 'kodo';

const base = {
  execPath: EXEC_PATH,
  kodoBin: KODO_BIN,
  workspaceRef: WORKSPACE_REF,
  cwd: CWD,
  sessionId: SESSION_ID,
  projectId: PROJECT_ID,
};

describe('Phase 56 Plan 01: runAdopt never-throws + execPath binary + literal 8-elem argv (DETECT-02)', () => {
  it('ok path: callback sin err → { ok:true } y cmd===execPath, args[0]===kodoBin, argv literal', async () => {
    /** @type {{ cmd: string, args: string[], opts: object } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { cmd, args, opts };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runAdopt({ exec, ...base });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured, 'exec must be invoked');
    assert.equal(captured.cmd, EXEC_PATH, 'cmd debe ser process.execPath (node), NO bin/kodo directo');
    assert.equal(captured.args[0], KODO_BIN, 'args[0] debe ser el kodoBin absoluto (Pitfall 4)');
    assert.deepEqual(
      captured.args,
      [
        KODO_BIN,
        'adopt',
        '--workspace',
        WORKSPACE_REF,
        '--cwd',
        CWD,
        '--session-id',
        SESSION_ID,
        '--project',
        PROJECT_ID,
      ],
      'argv literal: [kodoBin, adopt, --workspace, ref, --cwd, cwd, --session-id, sid, --project, pid]',
    );
  });

  it('ENOENT mapping: err.code="ENOENT" → { ok:false, code:"ENOENT", detail }', async () => {
    const exec = (cmd, args, opts, cb) => {
      const err = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
      setImmediate(() => cb(err, '', ''));
    };
    const result = await runAdopt({ exec, ...base });
    assert.equal(result.ok, false);
    if (result.ok) return; // narrowing
    assert.equal(result.code, 'ENOENT');
    assert.equal(typeof result.detail, 'string');
    assert.ok(result.detail.length > 0, 'detail debe ser un string no vacío');
  });

  it('NON_ZERO_EXIT mapping: err.code=1 (config) → detail:1 Y err.code=2 (transient) → detail:2', async () => {
    for (const code of [1, 2]) {
      const exec = (cmd, args, opts, cb) => {
        const err = Object.assign(new Error('command failed'), { code });
        setImmediate(() => cb(err, '', ''));
      };
      const result = await runAdopt({ exec, ...base });
      assert.equal(result.ok, false);
      if (result.ok) continue; // narrowing
      assert.equal(result.code, 'NON_ZERO_EXIT', `exit ${code} → NON_ZERO_EXIT`);
      assert.equal(result.detail, code, `detail debe ser el exit code literal ${code}`);
    }
  });

  it('never-throws contract: exec sync-throws → { ok:false, code:"SPAWN_ERROR" } (NO reject)', async () => {
    const exec = () => {
      throw new Error('bad args');
    };
    let rejected = false;
    /** @type {any} */
    let result;
    try {
      result = await runAdopt({ exec, ...base });
    } catch {
      rejected = true;
    }
    assert.equal(
      rejected,
      false,
      'never-throws: la promise NO debe rechazar ante un sync-throw de exec (D-07)',
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SPAWN_ERROR');
    assert.equal(typeof result.detail, 'string');
  });

  it('leak guard estructural: omitir exec → TypeError (jamás toca execFile real)', async () => {
    await assert.rejects(
      // @ts-ignore — deliberadamente omitiendo `exec` para verificar el guard.
      async () => runAdopt({ ...base }),
      (err) => err instanceof TypeError,
      'sin exec inyectado, runAdopt debe fallar con TypeError (leak guard estructural)',
    );
  });
});
