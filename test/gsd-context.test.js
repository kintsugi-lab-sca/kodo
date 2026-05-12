// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGsdContext } from '../src/hooks/session-start.js';

/**
 * Minimal GSD-mode Session fixture.
 * gsd: true is the default — individual tests override fields as needed.
 */
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42',
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Fix authentication bug',
    status: 'running',
    started_at: '2026-04-17T00:00:00.000Z',
    project_path: '/tmp/kl-42',
    gsd: true,
    ...overrides,
  };
}

describe('session-start.js — buildGsdContext', () => {
  it('includes GSD Mode header with task_ref', () => {
    const ctx = buildGsdContext(makeSession({ task_ref: 'KL-99' }));
    assert.match(ctx, /# kodo KL-99 — GSD Mode/);
  });

  it('includes project_path, session_id, task_id in common data', () => {
    const ctx = buildGsdContext(makeSession());
    assert.match(ctx, /Project path: \/tmp\/kl-42/);
    assert.match(ctx, /Session ID: sess-abc/);
    assert.match(ctx, /Work item ID: uuid-123/);
  });

  it('includes GSD command sequence when phase_id is present (D-01)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    assert.match(ctx, /\/gsd-plan-phase 08/);
    assert.match(ctx, /\/gsd-execute-phase 08/);
    assert.match(ctx, /\/gsd-verify-work/);
  });

  it('uses hyphen form for commands, not colon (D-02)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '03' }));
    assert.ok(!ctx.includes('gsd:plan'), 'must use gsd-plan not gsd:plan');
    assert.ok(!ctx.includes('gsd:execute'), 'must use gsd-execute not gsd:execute');
    assert.ok(!ctx.includes('gsd:verify'), 'must use gsd-verify not gsd:verify');
  });

  it('includes bootstrap instructions when phase_id is absent (D-01 fallback)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    assert.match(ctx, /\/gsd-new-project/);
    assert.ok(!ctx.includes('/gsd-plan-phase'), 'should not include plan command without phase_id');
  });

  it('bootstrap uses hyphen form gsd-new-project (D-02)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    assert.ok(!ctx.includes('gsd:new-project'), 'must use gsd-new-project not gsd:new-project');
    assert.match(ctx, /gsd-new-project/);
  });

  it('context is in English (D-04)', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '05' }));
    assert.match(ctx, /Execute the following commands/);
    assert.ok(!ctx.includes('Estás trabajando'), 'must not contain Spanish instructions');
    assert.ok(!ctx.includes('Tu responsabilidad'), 'must not contain Spanish headers');
  });

  it('does NOT include generic instructions (D-03)', () => {
    const ctx = buildGsdContext(makeSession());
    assert.ok(!ctx.includes('comenta tu plan'), 'must not include generic plan comment instruction');
    assert.ok(!ctx.includes('In Review'), 'must not include generic review transition');
    assert.ok(!ctx.includes('mcp_hint'), 'must not reference MCP hints');
  });

  it('includes task summary in context', () => {
    const ctx = buildGsdContext(makeSession({ summary: 'Build the widget' }));
    assert.match(ctx, /Build the widget/);
  });

  it('renders brief BEFORE the bootstrap command (D-11 order)', () => {
    const session = /** @type {any} */ (makeSession({ phase_id: undefined }));
    const out = buildGsdContext(session, {
      brief: '## Project Brief\n\n**Task:** KL-42 — Build phase resolver\n\nBody',
    });
    const briefIdx = out.indexOf('## Project Brief');
    const cmdIdx = out.indexOf('/gsd-new-project');
    assert.ok(briefIdx >= 0, 'brief heading should be present');
    assert.ok(cmdIdx >= 0, 'bootstrap command should be present');
    assert.ok(briefIdx < cmdIdx, `brief must appear before command (brief@${briefIdx}, cmd@${cmdIdx})`);
  });

  it('renders bootstrap branch without brief when opts.brief is absent (backward-compatible)', () => {
    const session = /** @type {any} */ (makeSession({ phase_id: undefined }));
    const out = buildGsdContext(session); // no opts
    assert.ok(!out.includes('## Project Brief'), 'brief block should be absent');
    assert.ok(out.includes('/gsd-new-project'), 'bootstrap command still rendered');
  });

  it('ignores opts.brief when session.phase_id is present (phase branch unchanged)', () => {
    const session = /** @type {any} */ (makeSession({ phase_id: '9' }));
    const out = buildGsdContext(session, { brief: '## Project Brief\n\nShould NOT appear' });
    assert.ok(!out.includes('## Project Brief'), 'brief should NOT be rendered on phase branch');
    assert.ok(out.includes('/gsd-plan-phase 9'), 'phase commands still render');
  });
});

describe('HOOK-01 — anti-push reminder, GSD EN', () => {
  const HEADER = '## No automatic push';

  it('HOOK-01 (phase): bloque "## No automatic push" presente con statement + ejemplo', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    assert.match(ctx, /## No automatic push/);
    assert.match(ctx, /kodo does NOT push automatically/);
    assert.match(ctx, /verify with a real `git push`/);
    assert.match(ctx, /Bad: "Feature deployed to production\."/);
    assert.match(ctx, /Good: "Feature committed locally, pending `git push` to remote\."/);
    assert.match(ctx, /Bad: "Deploy done\."/);
    assert.match(ctx, /Good: "Deploy will be live once `git push origin main` runs\."/);
  });

  it('HOOK-01 (bootstrap): bloque "## No automatic push" presente', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    assert.match(ctx, /## No automatic push/);
    assert.match(ctx, /kodo does NOT push automatically/);
    // El bloque común se appendea DESPUÉS de /gsd-new-project (rama bootstrap).
    const cmdIdx = ctx.indexOf('/gsd-new-project');
    const blockIdx = ctx.lastIndexOf(HEADER);
    assert.ok(cmdIdx >= 0, '/gsd-new-project still rendered in bootstrap branch');
    assert.ok(blockIdx > cmdIdx, 'HOOK-01 block must come AFTER bootstrap command');
  });

  it('HOOK-02 (phase, opción B): bloque al FINAL — prefix bytes intactos', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0, `header "${HEADER}" must be present and after byte 0`);
    const tail = ctx.slice(idx);
    assert.ok(tail.startsWith(HEADER), 'header must start the final block');
    const prefix = ctx.slice(0, idx);
    assert.ok(
      prefix.endsWith('\n\n'),
      'prefix must end with blank line separator before HOOK-01 block (D-03)',
    );
  });

  it('HOOK-02 (bootstrap, opción B): bloque al FINAL — prefix bytes intactos', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0);
    const tail = ctx.slice(idx);
    assert.ok(tail.startsWith(HEADER), 'header must start the final block (bootstrap branch)');
    const prefix = ctx.slice(0, idx);
    assert.ok(prefix.endsWith('\n\n'), 'prefix must end with blank line separator (D-03)');
  });

  it('D-04 common-block invariance: bloque EN bytes-idéntico en las 3 ramas (quick / phase / bootstrap)', () => {
    const ctxQuick = buildGsdContext(makeSession({ gsd_mode: 'quick', summary: 'TASK-X' }));
    const ctxPhase = buildGsdContext(makeSession({ phase_id: '08' }));
    const ctxBoot = buildGsdContext(makeSession({ phase_id: undefined }));
    const tail = (s) => s.slice(s.lastIndexOf(HEADER));
    assert.equal(tail(ctxQuick), tail(ctxPhase), 'quick tail must equal phase tail');
    assert.equal(tail(ctxPhase), tail(ctxBoot), 'phase tail must equal bootstrap tail');
    // Sanidad: el tail no está vacío y empieza con el header.
    assert.ok(tail(ctxPhase).startsWith(HEADER), 'tail must start with HEADER');
    assert.ok(tail(ctxPhase).length > HEADER.length, 'tail must include block body');
  });

  it('HOOK-03 idempotencia (phase): re-emitir produce bytes idénticos', () => {
    const session = makeSession({ phase_id: '08' });
    const a = buildGsdContext(session);
    const b = buildGsdContext(session);
    assert.equal(a, b);
    assert.equal(a.length, b.length);
  });

  it('HOOK-03 idempotencia (bootstrap): re-emitir produce bytes idénticos', () => {
    const session = makeSession({ phase_id: undefined });
    const a = buildGsdContext(session);
    const b = buildGsdContext(session);
    assert.equal(a, b);
  });

  it('HOOK-01 D-02b: bloque EN sin emojis ni códigos ANSI escape', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    const block = ctx.slice(ctx.lastIndexOf(HEADER));
    // Cubre rangos Unicode comunes de emojis: Miscellaneous Symbols (2600-26FF),
    // Dingbats (2700-27BF) — incluye ✅/⚠/✓ — y Misc Symbols & Pictographs +
    // Supplemental Symbols & Pictographs (1F300-1FAFF).
    assert.ok(
      !/[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}]/u.test(block),
      'HOOK-01 EN block must not contain emojis (D-02b)',
    );
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\x1B\[/.test(block), 'HOOK-01 EN block must not contain ANSI escape sequences (D-02b)');
  });
});
