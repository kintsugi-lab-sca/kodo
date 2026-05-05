// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGsdInspect } from '../src/cli/gsd-inspect.js';
import { createFormatter } from '../src/cli/format.js';

/**
 * Build a StdoutStub that captures written strings.
 */
function makeStdoutStub() {
  let buf = '';
  return {
    write: (s) => { buf += s; },
    get: () => buf,
  };
}

/**
 * Crea un directorio tmp con `.planning/PROJECT.md` para que el `existsSync`
 * de `runGsdInspect` (línea 89 actual) marque hasPlanning=true.
 */
function makeProjectDirWithPlanning() {
  const dir = mkdtempSync(join(tmpdir(), 'gsd-inspect-'));
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, '.planning', 'PROJECT.md'), '# Test project\n');
  return dir;
}

/**
 * Crea un directorio tmp sin `.planning/PROJECT.md` → hasPlanning=false.
 */
function makeProjectDirWithoutPlanning() {
  return mkdtempSync(join(tmpdir(), 'gsd-inspect-noroad-'));
}

/**
 * Formatter NO_COLOR fixture — fmt.ok/fmt.fail devuelven símbolos sin ANSI.
 */
function nocolorFormatter() {
  return createFormatter({ isTTY: false }, /** @type {any} */ ({}));
}

const taskPhaseMatch = {
  id: 'task-1',
  ref: 'KL-42',
  title: 'Phase Resolver + Bootstrap',
  labels: ['kodo', 'kodo:gsd'],
  url: 'https://plane.example.com/KL-42',
  description: 'Implements GSD-03.',
  projectId: 'proj-1',
};

const taskBootstrap = {
  id: 'task-2',
  ref: 'KL-1',
  title: 'Bootstrap me',
  labels: ['kodo', 'kodo:gsd'],
  description: 'Fresh project brief',
  projectId: 'proj-1',
};

const taskNoMatch = {
  id: 'task-3',
  ref: 'KL-99',
  title: 'No such phase exists',
  labels: ['kodo', 'kodo:gsd'],
  description: null,
  projectId: 'proj-1',
};

describe('runGsdInspect — read-only dry-run (D-18 invariant)', () => {
  it('exits 0 and prints 4 sections (config/fetch/roadmap/match) for phase verdict', async () => {
    const stdout = makeStdoutStub();
    const stderr = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskPhaseMatch }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({
        action: 'phase',
        phase_id: '9',
        match_heading: '### Phase 9: Phase Resolver + Bootstrap',
        match_reason: 'exact title match (normalized)',
      }),
      writeFn: stdout.write,
      errFn: stderr.write,
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-42' }, deps);
    assert.equal(code, 0);
    const out = stdout.get();
    // Header de contexto
    assert.ok(out.includes('Task:         KL-42'), 'task line present');
    // 4 secciones literales SC#3
    assert.match(out, /config:\s+✓ OK/, 'section config: ✓ OK');
    assert.match(out, /fetch:\s+✓ OK/, 'section fetch: ✓ OK');
    assert.match(out, /roadmap:\s+✓ OK/, 'section roadmap: ✓ OK');
    assert.match(out, /match:\s+✓ OK — phase 9/, 'section match: ✓ OK — phase <id>');
    // Última línea = Exit: 0
    assert.match(out, /Exit: 0\n$/, 'last line Exit: 0');
    // Orden literal: config antes que fetch, fetch antes que roadmap, roadmap antes que match
    const idxConfig = out.indexOf('config:');
    const idxFetch = out.indexOf('fetch:');
    const idxRoadmap = out.indexOf('roadmap:');
    const idxMatch = out.indexOf('match:');
    assert.ok(idxConfig < idxFetch && idxFetch < idxRoadmap && idxRoadmap < idxMatch,
      'sections in literal order: config / fetch / roadmap / match');
    // El shape antiguo NO debe aparecer (no `Verdict:` heading, no `action:` lines, no `.planning/PROJECT.md: present`)
    assert.doesNotMatch(out, /^Verdict:$/m, 'old shape removed');
    assert.doesNotMatch(out, /action:\s+phase/, 'old action: phase line removed');
    assert.doesNotMatch(out, /\.planning\/PROJECT\.md:\s+present/, 'old roadmap line removed');
  });

  it('exits 0 with bootstrap verdict — match line shows reason + brief preview retained', async () => {
    const stdout = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskBootstrap }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({ action: 'bootstrap', reason: 'no-planning-dir' }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-1' }, deps);
    assert.equal(code, 0);
    const out = stdout.get();
    assert.match(out, /match:\s+✓ OK — bootstrap \(no-planning-dir\)/, 'bootstrap match line');
    assert.match(out, /Exit: 0\n$/, 'Exit: 0 last');
    // Preview block conservado para bootstrap (Discretion CONTEXT línea 70)
    assert.ok(out.includes('## Project Brief'), 'brief heading rendered in preview');
    assert.ok(out.includes('**Task:** KL-1 — Bootstrap me'), 'brief task line rendered');
    assert.ok(out.includes('/gsd-new-project'), 'bootstrap command in preview');
    assert.ok(out.includes('buildGsdContext preview'), 'preview marker present');
  });

  it('exits 1 with verdict error — match line shows ✗ FAIL + code', async () => {
    const stdout = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskNoMatch }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({ action: 'error', code: 'no-match' }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-99' }, deps);
    assert.equal(code, 1);
    const out = stdout.get();
    assert.match(out, /match:\s+✗ FAIL — no-match/, 'error match line');
    assert.match(out, /Exit: 1\n$/, 'Exit: 1 last line');
    // Preview NO debe aparecer en error
    assert.doesNotMatch(out, /buildGsdContext preview/, 'no preview block on error');
  });

  it('exits 1 on multi-match with the verdict detail rendered in match line', async () => {
    const stdout = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskNoMatch }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({
        action: 'error',
        code: 'multi-match',
        detail: 'Phase 1: Foo, Phase 2: Foo',
        matches: ['Phase 1: Foo', 'Phase 2: Foo'],
      }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-99' }, deps);
    assert.equal(code, 1);
    const out = stdout.get();
    assert.match(out, /match:\s+✗ FAIL — multi-match: Phase 1: Foo, Phase 2: Foo/, 'detail rendered after code');
    assert.match(out, /Exit: 1\n$/);
  });

  it('Test 4: roadmap missing → roadmap section shows ✗ FAIL', async () => {
    const stdout = makeStdoutStub();
    const projectDirNoPlanning = makeProjectDirWithoutPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskBootstrap }),
      resolveProjectPathFn: () => projectDirNoPlanning,
      resolvePhaseFn: () => ({ action: 'bootstrap', reason: 'no-planning-dir' }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-1' }, deps);
    // Verdict bootstrap → exit 0 aunque roadmap falle (la presencia es informativa)
    assert.equal(code, 0);
    const out = stdout.get();
    assert.match(out, /roadmap:\s+✗ FAIL/, 'roadmap shown FAIL when .planning/PROJECT.md missing');
    assert.match(out, /config:\s+✓ OK/, 'config still OK');
    assert.match(out, /fetch:\s+✓ OK/, 'fetch still OK');
  });

  it('--json emits structured verdict + metadata (D-17) — shape unchanged, no Exit: N', async () => {
    const stdout = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskPhaseMatch }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({ action: 'phase', phase_id: '9', match_heading: 'x', match_reason: 'y' }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-42', json: true }, deps);
    assert.equal(code, 0);
    const raw = stdout.get();
    const json = JSON.parse(raw);
    assert.equal(json.task.ref, 'KL-42');
    assert.equal(json.project_path, projectDir);
    assert.equal(json.verdict.action, 'phase');
    assert.equal(json.verdict.phase_id, '9');
    assert.equal(json.brief, null);
    // Shape inalterado — exactamente las 5 keys
    assert.deepEqual(
      Object.keys(json).sort(),
      ['brief', 'has_planning_dir', 'project_path', 'task', 'verdict'],
      '--json shape must remain { task, project_path, has_planning_dir, verdict, brief }',
    );
    // Output NO debe contener líneas humanas ni Exit: N
    assert.ok(!raw.includes('Task:         '), 'human header should be absent in JSON mode');
    assert.doesNotMatch(raw, /config:\s+✓/, 'no human section in JSON mode');
    assert.doesNotMatch(raw, /Exit:/, 'Exit: N must not appear in JSON output');
  });

  it('--json emits non-null brief when verdict is bootstrap', async () => {
    const stdout = makeStdoutStub();
    const projectDir = makeProjectDirWithPlanning();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskBootstrap }),
      resolveProjectPathFn: () => projectDir,
      resolvePhaseFn: () => ({ action: 'bootstrap', reason: 'no-planning-dir' }),
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    };
    await runGsdInspect({ taskId: 'KL-1', json: true }, deps);
    const json = JSON.parse(stdout.get());
    assert.equal(json.verdict.action, 'bootstrap');
    assert.ok(json.brief && json.brief.startsWith('## Project Brief'));
  });

  it('Test 6: provider fetch failure → exit 2 + Exit: 2 visible in stdout (human mode)', async () => {
    const stdout = makeStdoutStub();
    const stderr = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({
        init: async () => {},
        getTask: async () => { throw new Error('Task KL-0 not found'); },
      }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({ action: 'phase', phase_id: '1', match_heading: 'x', match_reason: 'y' }),
      writeFn: stdout.write,
      errFn: stderr.write,
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-0' }, deps);
    assert.equal(code, 2);
    assert.ok(stderr.get().includes('Task KL-0 not found'), 'error message in stderr');
    assert.match(stdout.get(), /Exit: 2\n$/, 'Exit: 2 visible in stdout (human mode)');
  });

  it('Test 5b: --json mode suppresses Exit: N on fetch failure', async () => {
    const stdout = makeStdoutStub();
    const stderr = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({
        init: async () => {},
        getTask: async () => { throw new Error('boom'); },
      }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      writeFn: stdout.write,
      errFn: stderr.write,
      formatterFn: nocolorFormatter,
    };
    const code = await runGsdInspect({ taskId: 'KL-0', json: true }, deps);
    assert.equal(code, 2);
    assert.doesNotMatch(stdout.get(), /Exit:\s*\d/, 'Exit: N must be suppressed in --json mode');
  });

  it('D-18 invariant: never invokes acquireGsdLock, addSession, or cmux', async () => {
    // This is the ANTI-REGRESSION test for D-18 (dry-run strict).
    // We inspect the imports of gsd-inspect.js — if anyone adds an import of
    // state mutation or cmux, this test fails.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/cli/gsd-inspect.js', import.meta.url), 'utf-8');
    assert.ok(!/import.*acquireGsdLock/.test(src), 'must not import acquireGsdLock');
    assert.ok(!/import.*releaseGsdLock/.test(src), 'must not import releaseGsdLock');
    assert.ok(!/import.*addSession/.test(src), 'must not import addSession');
    assert.ok(!/import.*removeSession/.test(src), 'must not import removeSession');
    assert.ok(!/import.*updateSession/.test(src), 'must not import updateSession');
    assert.ok(!/import.*cmux/.test(src), 'must not import anything from cmux/');
    assert.ok(!/launchWorkItem/.test(src), 'must not reference launchWorkItem');
  });

  it('D-04 invariant: imports the SAME resolvePhase used by the dispatcher', async () => {
    // runGsdInspect MUST import resolvePhase from src/gsd/resolver.js (not an
    // inline copy, not a different module). This is a static assertion on the
    // inspect handler's source.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/cli/gsd-inspect.js', import.meta.url), 'utf-8');
    assert.match(src, /import\s*\{\s*resolvePhase\s*\}\s*from\s*['"]\.\.\/gsd\/resolver\.js['"]/);
  });

  it('Test 5: resolveProjectPath throws → exit 1 + Exit: 1 visible (config error ≠ fetch failure, D-19)', async () => {
    // HI-02 gap closure: distinguimos config error (exit 1) de fetch failure
    // (exit 2). Un project mapping ausente no es transient — reintentar
    // nunca va a funcionar hasta que el operador arregle la config.
    const stdout = makeStdoutStub();
    const exitCode = await runGsdInspect({ taskId: 'KL-42' }, {
      getProviderFn: () => ({
        init: async () => {},
        getTask: async () => ({ ref: 'KL-42', title: 'x', labels: [], project_id: 'p-missing' }),
      }),
      resolveProjectPathFn: () => {
        throw new Error('No local path mapped for project p-missing');
      },
      writeFn: stdout.write,
      errFn: () => {},
      formatterFn: nocolorFormatter,
    });
    assert.strictEqual(exitCode, 1,
      'config error (resolveProjectPath throw) must return 1, not 2 (D-19 reserves 2 for fetch failure)');
    assert.match(stdout.get(), /Exit: 1\n$/, 'Exit: 1 visible in stdout (human mode)');
  });

  it('Test 8: Exit: N visible coincide exactamente con el return del handler (3 verdicts)', async () => {
    const projectDir = makeProjectDirWithPlanning();
    const cases = [
      {
        name: 'phase',
        verdict: { action: 'phase', phase_id: '01', match_heading: 'X', match_reason: 'Y' },
        expectedExit: 0,
      },
      {
        name: 'bootstrap',
        verdict: { action: 'bootstrap', reason: 'no-phase-id-yet' },
        expectedExit: 0,
      },
      {
        name: 'error',
        verdict: { action: 'error', code: 'no-match', detail: 'no heading matches' },
        expectedExit: 1,
      },
    ];
    for (const tc of cases) {
      const stdout = makeStdoutStub();
      const fakeTask = { id: 't1', ref: 'KL-1', title: 'X', labels: [], projectId: 'p1' };
      const code = await runGsdInspect(
        { taskId: 't1', json: false },
        {
          getProviderFn: () => ({ init: async () => {}, getTask: async () => fakeTask }),
          resolveProjectPathFn: () => projectDir,
          resolvePhaseFn: () => /** @type {any} */ (tc.verdict),
          writeFn: stdout.write,
          errFn: () => {},
          formatterFn: nocolorFormatter,
        },
      );
      assert.equal(code, tc.expectedExit, `${tc.name}: return code mismatch`);
      assert.match(stdout.get(), new RegExp(`Exit: ${tc.expectedExit}\\n$`),
        `${tc.name}: visible Exit must equal return code`);
    }
  });
});
