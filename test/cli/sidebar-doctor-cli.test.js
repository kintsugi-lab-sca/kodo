// @ts-check
// Phase 79 Plan 03 (SDR-01/SDR-06): cobertura hermética DI del handler CLI
// `kodo sidebar doctor`.
//
// Calco del estilo de gsd-doctor-cli.test.js: scanFn/executeFn/writeFn/errFn/
// formatterFn 100% inyectados, CERO disco real, CERO spawn, CERO cmux. Verifica:
//   - exit code 0/1 (hasActions), dry-run NUNCA llama executeFn, --fix llama
//     executeFn exactamente UNA vez DESPUÉS de scan (orden ['scan','execute'])
//   - protected (sesiones ya agrupadas) NO afecta al exit code (espejo D-09)
//   - --json byte-determinista idéntico TTY/no-TTY (SDR-06), cero ANSI
//   - render humano agrupa las 3 categorías con la acción exacta por item (SDR-01)
//   - source-hygiene: el handler no importa picocolors (color isolation) ni
//     `../cmux/client.js` (aislamiento RESEARCH §Nota de aislamiento)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runSidebarDoctor } from '../../src/cli/sidebar-doctor.js';
import { createFormatter } from '../../src/cli/format.js';

/** Captura las strings escritas. */
function makeStdoutStub() {
  let buf = '';
  return {
    write: (s) => { buf += s; },
    get: () => buf,
  };
}

/** Formatter NO_COLOR fixture — cero ANSI. */
function nocolorFormatter() {
  return createFormatter({ isTTY: false }, /** @type {any} */ ({}));
}

/** Report limpio (sidebar convergido, nada que arreglar). */
function cleanReport() {
  return {
    missing_group: [],
    loose_workspace: [],
    empty_group: [],
    protected: { sessions: [] },
    hasActions: false,
  };
}

/** Report con deriva en las 3 categorías. */
function driftReport() {
  return {
    missing_group: [
      { name: 'ACME/Auth', anchor: 'workspace:1', members: ['workspace:1', 'workspace:2'] },
    ],
    loose_workspace: [
      { group: 'workspace_group:5', workspace_ref: 'workspace:3', name: 'ACME/Api' },
    ],
    empty_group: [
      { ref: 'workspace_group:9', name: 'ACME/Old' },
    ],
    protected: { sessions: [{ ref: 'workspace:7', group: 'workspace_group:2', name: 'ACME/Web' }] },
    hasActions: true,
  };
}

/** Result de execute por defecto (nada ejecutado). */
function emptyResult() {
  return { created: 0, added: 0, ungrouped: 0, errors: [] };
}

describe('runSidebarDoctor — exit code (espejo D-09)', () => {
  it('clean report (hasActions:false) → returns 0 and renders clean verdict', async () => {
    const stdout = makeStdoutStub();
    const code = await runSidebarDoctor({}, {
      scanFn: () => cleanReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 0);
    assert.match(stdout.get(), /clean/, 'clean verdict rendered');
  });

  it('drift present (hasActions:true) → returns 1 and renders per-category actions', async () => {
    const stdout = makeStdoutStub();
    const code = await runSidebarDoctor({}, {
      scanFn: () => driftReport(),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    const out = stdout.get();
    assert.match(out, /Grupos faltantes\/disueltos \(1\)/, 'missing_group category header');
    assert.match(out, /create \+ add \+ set-anchor — ACME\/Auth/, 'exact missing action per item');
    assert.match(out, /Workspaces sueltos \(1\)/, 'loose_workspace category header');
    assert.match(out, /add — workspace:3/, 'exact loose action per item');
    assert.match(out, /Grupos vacíos \(1\)/, 'empty_group category header');
    assert.match(out, /ungroup — workspace_group:9/, 'exact empty action per item');
    assert.match(out, /drift found/, 'drift verdict rendered');
  });

  it('protected present but no actions → returns 0 (protected never affects exit)', async () => {
    const stdout = makeStdoutStub();
    const report = cleanReport();
    report.protected.sessions.push({ ref: 'workspace:7', group: 'workspace_group:2', name: 'ACME/Web' });
    // hasActions stays false even with protected sessions present.
    const code = await runSidebarDoctor({}, {
      scanFn: () => report,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 0, 'protected sessions must NOT bump exit to 1');
    assert.match(stdout.get(), /protected: 1/, 'protected summary rendered');
  });
});

describe('runSidebarDoctor — dry-run vs --fix', () => {
  it('dry-run (fix:false) NEVER calls executeFn', async () => {
    let executeCalls = 0;
    const code = await runSidebarDoctor({}, {
      scanFn: () => driftReport(),
      executeFn: async () => { executeCalls++; return emptyResult(); },
      writeFn: () => {},
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    assert.equal(executeCalls, 0, 'executeFn must not run without --fix');
  });

  it('--fix calls executeFn exactly once AFTER scan; exit derives from scan().hasActions', async () => {
    const order = [];
    const result = emptyResult();
    result.created = 1;
    result.added = 1;
    result.ungrouped = 1;
    const stdout = makeStdoutStub();
    const code = await runSidebarDoctor({ fix: true }, {
      scanFn: () => { order.push('scan'); return driftReport(); },
      executeFn: async (deps, opts) => {
        order.push('execute');
        assert.equal(opts.fix, true, 'execute must be called with {fix:true}');
        return result;
      },
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1, 'exit code still derives from scan().hasActions');
    assert.deepEqual(order, ['scan', 'execute'], 'scan must run before execute, execute exactly once');
    const out = stdout.get();
    assert.match(out, /executed/, 'executed section rendered under --fix');
    assert.match(out, /created:\s+1/, 'created result rendered');
    assert.match(out, /added:\s+1/, 'added result rendered');
    assert.match(out, /ungrouped:\s+1/, 'ungrouped result rendered');
  });

  it('--fix surfaces execute errors on stderr (not stdout)', async () => {
    const result = emptyResult();
    result.errors.push({ category: 'add', target: 'workspace:3', reason: 'cmux add failed' });
    const stdout = makeStdoutStub();
    const stderr = makeStdoutStub();
    await runSidebarDoctor({ fix: true }, {
      scanFn: () => driftReport(),
      executeFn: async () => result,
      writeFn: stdout.write,
      errFn: stderr.write,
      formatterFn: nocolorFormatter,
    });
    const errOut = stderr.get();
    assert.match(errOut, /errors \(1\)/, 'errors header rendered on stderr');
    assert.match(errOut, /cmux add failed/, 'error reason rendered on stderr');
    assert.doesNotMatch(stdout.get(), /cmux add failed/, 'error detail must not leak to stdout');
  });
});

describe('runSidebarDoctor — --json byte-determinism (SDR-06)', () => {
  it('--json output is valid JSON and is the serialized scan report (no human framing)', async () => {
    const stdout = makeStdoutStub();
    const report = driftReport();
    const code = await runSidebarDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout.get());
    assert.equal(parsed.hasActions, true);
    assert.equal(parsed.missing_group[0].name, 'ACME/Auth');
    assert.equal(parsed.loose_workspace[0].workspace_ref, 'workspace:3');
    assert.equal(parsed.empty_group[0].ref, 'workspace_group:9');
    assert.doesNotMatch(stdout.get(), /Grupos faltantes/, 'no human render in JSON mode');
  });

  it('--json is identical regardless of stream.isTTY (byte-determinism), zero ANSI', async () => {
    const report = driftReport();
    const ttyOut = makeStdoutStub();
    const nonTtyOut = makeStdoutStub();
    await runSidebarDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: ttyOut.write,
      errFn: () => {},
      formatterFn: () => createFormatter({ isTTY: true }, /** @type {any} */ ({ FORCE_COLOR: '1' })),
    });
    await runSidebarDoctor({ json: true }, {
      scanFn: () => report,
      writeFn: nonTtyOut.write,
      errFn: () => {},
      formatterFn: () => createFormatter({ isTTY: false }, /** @type {any} */ ({})),
    });
    assert.equal(ttyOut.get(), nonTtyOut.get(), 'JSON bytes must be identical TTY vs non-TTY');
    assert.doesNotMatch(ttyOut.get(), /\x1b\[/, 'JSON must contain no ANSI escapes');
  });

  it('--json under --fix merges the execute result under `executed`', async () => {
    const stdout = makeStdoutStub();
    const result = emptyResult();
    result.created = 2;
    await runSidebarDoctor({ json: true, fix: true }, {
      scanFn: () => driftReport(),
      executeFn: async () => result,
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    const parsed = JSON.parse(stdout.get());
    assert.equal(parsed.hasActions, true);
    assert.equal(parsed.executed.created, 2, 'execute result merged under executed');
  });
});

describe('runSidebarDoctor — source hygiene', () => {
  it('handler imports no picocolors directly (color isolation) nor ../cmux/client.js', () => {
    const src = readFileSync(new URL('../../src/cli/sidebar-doctor.js', import.meta.url), 'utf-8');
    assert.ok(!/picocolors/.test(src), 'sidebar-doctor.js must not import picocolors');
    assert.ok(!/cmux\/client\.js/.test(src), 'sidebar-doctor.js must not import ../cmux/client.js');
  });

  it('exports runSidebarDoctor', async () => {
    const mod = await import('../../src/cli/sidebar-doctor.js');
    assert.equal(typeof mod.runSidebarDoctor, 'function', 'runSidebarDoctor must be exported');
  });
});
