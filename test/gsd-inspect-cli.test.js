// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runGsdInspect } from '../src/cli/gsd-inspect.js';

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
  it('exits 0 and prints phase_id when verdict is phase (human mode)', async () => {
    const stdout = makeStdoutStub();
    const stderr = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskPhaseMatch }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({
        action: 'phase',
        phase_id: '9',
        match_heading: '### Phase 9: Phase Resolver + Bootstrap',
        match_reason: 'exact title match (normalized)',
      }),
      writeFn: stdout.write,
      errFn: stderr.write,
    };
    const code = await runGsdInspect({ taskId: 'KL-42' }, deps);
    assert.equal(code, 0);
    const out = stdout.get();
    assert.ok(out.includes('Task:         KL-42'), 'task line present');
    assert.ok(out.includes('phase_id:      9'), 'phase_id present');
    assert.ok(out.includes('match_heading:'), 'match_heading present');
    assert.ok(out.includes('buildGsdContext preview'), 'preview section present');
    assert.ok(out.includes('/gsd-plan-phase 9'), 'preview includes phase command');
  });

  it('exits 0 and prints bootstrap verdict with brief preview', async () => {
    const stdout = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskBootstrap }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({ action: 'bootstrap', reason: 'no-planning-dir' }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    const code = await runGsdInspect({ taskId: 'KL-1' }, deps);
    assert.equal(code, 0);
    const out = stdout.get();
    assert.ok(out.includes('action:        bootstrap'), 'bootstrap action printed');
    assert.ok(out.includes('## Project Brief'), 'brief heading rendered in preview');
    assert.ok(out.includes('**Task:** KL-1 — Bootstrap me'), 'brief task line rendered');
    assert.ok(out.includes('/gsd-new-project'), 'bootstrap command in preview');
  });

  it('exits 1 when verdict is error (no-match)', async () => {
    const stdout = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskNoMatch }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({ action: 'error', code: 'no-match' }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    const code = await runGsdInspect({ taskId: 'KL-99' }, deps);
    assert.equal(code, 1);
    const out = stdout.get();
    assert.ok(out.includes('action:        error'));
    assert.ok(out.includes('code:          no-match'));
  });

  it('exits 1 on multi-match with the list of matches', async () => {
    const stdout = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskNoMatch }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({
        action: 'error',
        code: 'multi-match',
        matches: ['Phase 1: Foo', 'Phase 2: Foo'],
      }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    const code = await runGsdInspect({ taskId: 'KL-99' }, deps);
    assert.equal(code, 1);
    const out = stdout.get();
    assert.ok(out.includes('code:          multi-match'));
    assert.ok(out.includes('Phase 1: Foo, Phase 2: Foo'), 'matches list printed');
  });

  it('--json emits structured verdict + metadata (D-17)', async () => {
    const stdout = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskPhaseMatch }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({ action: 'phase', phase_id: '9', match_heading: 'x', match_reason: 'y' }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    const code = await runGsdInspect({ taskId: 'KL-42', json: true }, deps);
    assert.equal(code, 0);
    const json = JSON.parse(stdout.get());
    assert.equal(json.task.ref, 'KL-42');
    assert.equal(json.project_path, '/tmp/fake-project');
    assert.equal(json.verdict.action, 'phase');
    assert.equal(json.verdict.phase_id, '9');
    // brief is null for phase verdicts (only rendered on bootstrap)
    assert.equal(json.brief, null);
    // Output must NOT contain the human-readable header lines
    assert.ok(!stdout.get().includes('Task:         '), 'human header should be absent in JSON mode');
  });

  it('--json emits non-null brief when verdict is bootstrap', async () => {
    const stdout = makeStdoutStub();
    const deps = {
      getProviderFn: () => ({ init: async () => {}, getTask: async () => taskBootstrap }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      resolvePhaseFn: () => ({ action: 'bootstrap', reason: 'no-planning-dir' }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    await runGsdInspect({ taskId: 'KL-1', json: true }, deps);
    const json = JSON.parse(stdout.get());
    assert.equal(json.verdict.action, 'bootstrap');
    assert.ok(json.brief && json.brief.startsWith('## Project Brief'));
  });

  it('exits 2 on provider fetch failure (task not found)', async () => {
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
    };
    const code = await runGsdInspect({ taskId: 'KL-0' }, deps);
    assert.equal(code, 2);
    assert.ok(stderr.get().includes('Task KL-0 not found'));
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
});
