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
        '--json',
      ],
      'argv literal: [..., --project, pid, --json] — 56-03: --json is the FINAL argv element',
    );
    assert.equal(captured.args[captured.args.length - 1], '--json', '--json debe ser el último elemento del argv');
  });

  // 56-06: cuando se pasa un `title` no vacío, runAdopt inserta `--title <title>` como par
  // literal en el argv (antes de --json). execFile sin shell → el título es UN argumento literal,
  // injection-safe automáticamente. Cuando el title es absent/empty se OMITE (core cae al basename).
  it('56-06: title no vacío → inserta --title <title> en el argv (par literal, antes de --json)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runAdopt({ exec, ...base, title: 'ROMAN-170 [FVF]' });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured);
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
        '--title',
        'ROMAN-170 [FVF]',
        '--json',
      ],
      '--title <title> debe insertarse como par literal tras --project, antes de --json',
    );
    assert.equal(captured.args[captured.args.length - 1], '--json', '--json sigue siendo el último elemento');
  });

  it('56-06: title con prefijo `-` se pasa como argumento literal del flag (no se parsea como flag)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    await runAdopt({ exec, ...base, title: '--rm -rf' });
    assert.ok(captured);
    const i = captured.args.indexOf('--title');
    assert.ok(i >= 0, '--title presente');
    assert.equal(captured.args[i + 1], '--rm -rf', 'el valor del título va inmediatamente tras --title como literal');
  });

  it('56-06: title ausente → omite --title (core cae al basename(cwd))', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    await runAdopt({ exec, ...base }); // sin title
    assert.ok(captured);
    assert.ok(!captured.args.includes('--title'), 'sin title → ningún --title en el argv');
  });

  it('56-06: title vacío "" → omite --title (no fuerza un título vacío)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    await runAdopt({ exec, ...base, title: '' });
    assert.ok(captured);
    assert.ok(!captured.args.includes('--title'), 'title "" → omitido (core cae al basename)');
  });

  // 56-03 UAT gap-fix: `kodo adopt` exits 0 even for ALREADY_ADOPTED (idempotent by
  // design — the exit contract is shared with Phase 57 and does NOT change). With
  // --json now appended, runAdopt parses stdout on the exit-0 branch and surfaces an
  // ALREADY_ADOPTED no-op distinctly so the dashboard footer is not falsely green.
  it('ALREADY_ADOPTED: exit 0 + stdout discriminant → { ok:false, code:"ALREADY_ADOPTED" }', async () => {
    const stdout =
      JSON.stringify({ ok: false, code: 'ALREADY_ADOPTED', detail: { task_id: 'KL-7' } }, null, 2) + '\n';
    const exec = (cmd, args, opts, cb) => {
      setImmediate(() => cb(null, stdout, ''));
    };
    const result = await runAdopt({ exec, ...base });
    assert.equal(result.ok, false);
    if (result.ok) return; // narrowing
    assert.equal(result.code, 'ALREADY_ADOPTED');
    assert.equal(result.detail, 'KL-7', 'detail debe ser el task_id existente cuando está presente');
  });

  it('ALREADY_ADOPTED defensive: exit 0 + ok:true stdout → { ok:true } (genuine adopt)', async () => {
    const stdout = JSON.stringify({ ok: true, task: { id: 'KL-9' } }, null, 2) + '\n';
    const exec = (cmd, args, opts, cb) => {
      setImmediate(() => cb(null, stdout, ''));
    };
    const result = await runAdopt({ exec, ...base });
    assert.deepEqual(result, { ok: true }, 'un ok:true (adopt real) debe seguir resolviendo { ok:true }');
  });

  it('ALREADY_ADOPTED defensive: exit 0 + unparseable stdout → { ok:true } (never throws)', async () => {
    const exec = (cmd, args, opts, cb) => {
      setImmediate(() => cb(null, 'not json at all', ''));
    };
    const result = await runAdopt({ exec, ...base });
    assert.deepEqual(result, { ok: true }, 'un stdout no parseable NO debe romper — cae a { ok:true } como hoy');
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

// 62-02 (ORCH-02 SC#4, D-10/D-13): el par `--description <d>` es el ESPEJO EXACTO del par
// `--title` (Phase 56-06). La descripción derivada por Haiku (Plan 01) viaja como cuerpo
// at-adopt vía `--description`, NO como comentario post-hoc (D-10). execFile sin shell → la
// description es UN argumento literal, metacaracteres inertes (D-13/T-62-07). El saneo
// (sanitizeAdoptionData / BIDIR-08) sigue aguas abajo en adoptSession (D-12); runAdopt no re-sanea.
describe('Phase 62 (ORCH-02): runAdopt --description (espejo literal de --title, injection-inerte)', () => {
  it('description no vacía → inserta --description <description> en el argv (par literal, antes de --json)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runAdopt({ exec, ...base, description: 'Refactor del resolver de fases' });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured);
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
        '--description',
        'Refactor del resolver de fases',
        '--json',
      ],
      '--description <d> debe insertarse como par literal tras --project, antes de --json',
    );
    assert.equal(captured.args[captured.args.length - 1], '--json', '--json sigue siendo el último elemento');
  });

  it('title Y description juntos → orden argv: ...--title, T, --description, D, --json (--json último)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    const result = await runAdopt({ exec, ...base, title: 'ROMAN-170 [FVF]', description: 'cuerpo derivado' });
    assert.deepEqual(result, { ok: true });
    assert.ok(captured);
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
        '--title',
        'ROMAN-170 [FVF]',
        '--description',
        'cuerpo derivado',
        '--json',
      ],
      'orden exacto: --title antes de --description, --json último (D-10: el título existe antes del createTask)',
    );
    const ti = captured.args.indexOf('--title');
    const di = captured.args.indexOf('--description');
    assert.ok(ti >= 0 && di >= 0 && ti < di, '--title debe preceder a --description en el argv');
    assert.equal(captured.args[captured.args.length - 1], '--json', '--json último');
  });

  it('description ausente → omite --description (core cae al cuerpo at-adopt por defecto)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    await runAdopt({ exec, ...base }); // sin description
    assert.ok(captured);
    assert.ok(!captured.args.includes('--description'), 'sin description → ningún --description en el argv');
  });

  it('description vacía "" → omite --description (no fuerza una descripción vacía)', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    await runAdopt({ exec, ...base, description: '' });
    assert.ok(captured);
    assert.ok(!captured.args.includes('--description'), 'description "" → omitido (core cae al cuerpo por defecto)');
  });

  it('injection-inerte (D-13/T-62-07): description con metacaracteres → un solo arg literal tras --description', async () => {
    /** @type {{ args: string[] } | undefined} */
    let captured;
    const exec = (cmd, args, opts, cb) => {
      captured = { args };
      setImmediate(() => cb(null, '', ''));
    };
    const evil = '$(rm -rf /); `whoami` && echo pwned | tee /etc/passwd';
    await runAdopt({ exec, ...base, description: evil });
    assert.ok(captured);
    const i = captured.args.indexOf('--description');
    assert.ok(i >= 0, '--description presente');
    assert.equal(
      captured.args[i + 1],
      evil,
      'la description con metacaracteres viaja como UN solo arg literal (execFile sin shell → inerte)',
    );
    // Verificación estructural: el valor es exactamente UN elemento del array (no fragmentado).
    assert.equal(
      captured.args.filter((a) => a === evil).length,
      1,
      'el valor adversarial ocupa exactamente un elemento del argv (no se fragmenta por metacaracteres)',
    );
  });
});
