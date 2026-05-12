// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSessionContext, buildGsdContext } from '../src/hooks/session-start.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'session-start.js');

/**
 * Minimal Session fixture using the v2 schema (task_ref, task_id).
 */
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42',
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Fix bug',
    status: 'running',
    started_at: '2026-04-10T00:00:00.000Z',
    project_path: '/tmp/kl-42',
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    provider: 'plane',
    providers: {
      plane: { mcp_hint: 'MCP de Plane' },
    },
    ...overrides,
  };
}

describe('session-start.js — buildSessionContext', () => {
  it('Test 1: output contains session.task_ref (not session.plane_identifier)', () => {
    const session = makeSession({ task_ref: 'KL-99' });
    const context = buildSessionContext(session, makeConfig());
    assert.match(context, /KL-99/);
  });

  it('Test 2: output contains session.task_id (not session.plane_id)', () => {
    const session = makeSession({ task_id: 'uuid-xyz' });
    const context = buildSessionContext(session, makeConfig());
    assert.match(context, /uuid-xyz/);
  });

  it('Test 3: output uses dynamic mcp_hint from config', () => {
    const config = makeConfig({
      providers: { plane: { mcp_hint: 'MCP de Plane custom hint' } },
    });
    const context = buildSessionContext(makeSession(), config);
    assert.match(context, /MCP de Plane custom hint/);
  });

  it('Test 4: falls back to "MCP de {providerName}" when mcp_hint not in config', () => {
    const config = {
      provider: 'github',
      providers: { github: {} }, // no mcp_hint
    };
    const session = makeSession({ provider: 'github' });
    const context = buildSessionContext(session, config);
    assert.match(context, /MCP de github/);
  });

  it('uses session.provider over config.provider when both present', () => {
    const config = {
      provider: 'plane',
      providers: {
        plane: { mcp_hint: 'MCP plane' },
        github: { mcp_hint: 'MCP github' },
      },
    };
    const session = makeSession({ provider: 'github' });
    const context = buildSessionContext(session, config);
    assert.match(context, /MCP github/);
    assert.ok(!context.includes('MCP plane'));
  });

  it('includes summary, session_id, and project_path in output', () => {
    const session = makeSession({
      summary: 'Refactor auth module',
      session_id: 'sess-42',
      project_path: '/home/user/project',
    });
    const context = buildSessionContext(session, makeConfig());
    assert.match(context, /Refactor auth module/);
    assert.match(context, /sess-42/);
    assert.match(context, /\/home\/user\/project/);
  });
});

describe('HOOK-01 — anti-push reminder, no-GSD ES', () => {
  it('HOOK-01: bloque "## Anti-push-fantasma" presente con header H2', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    assert.match(ctx, /## Anti-push-fantasma/);
  });

  it('HOOK-01 D-02: statement explícito + par Bad/Good presentes', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    assert.match(ctx, /kodo NO hace `git push` automático/);
    assert.match(ctx, /verifica con `git push` real/);
    assert.match(ctx, /Bad: "Feature publicada en producción\."/);
    assert.match(ctx, /Good: "Feature commiteada localmente, pendiente de `git push` al remoto\."/);
    assert.match(ctx, /Bad: "Deploy hecho\."/);
    assert.match(ctx, /Good: "Deploy quedará efectivo una vez se haga `git push origin main`\."/);
  });

  it('HOOK-02 (opción B): bloque al FINAL — prefix bytes intactos + tail starts con header', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    const HEADER = '## Anti-push-fantasma';
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

  it('HOOK-03 idempotencia: re-emitir produce bytes idénticos', () => {
    const session = makeSession();
    const config = makeConfig();
    const a = buildSessionContext(session, config);
    const b = buildSessionContext(session, config);
    assert.equal(a, b);
    assert.equal(a.length, b.length);
  });

  it('HOOK-01 D-02b: bloque sin emojis ni códigos ANSI escape', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    const HEADER = '## Anti-push-fantasma';
    const block = ctx.slice(ctx.lastIndexOf(HEADER));
    // Sólo verificamos el slice del bloque HOOK-01 — el resto del prompt ES
    // contiene emojis legítimos (✅/📁/⚠️/🔍) en la sección "Comentario final".
    // Cubre rangos Unicode comunes de emojis: Miscellaneous Symbols (2600-26FF),
    // Dingbats (2700-27BF) — incluye ✅/⚠/✓ — y Misc Symbols & Pictographs +
    // Supplemental Symbols & Pictographs (1F300-1FAFF) que cubre 📁/🔍/etc.
    assert.ok(
      !/[\u{2600}-\u{27BF}\u{1F300}-\u{1FAFF}]/u.test(block),
      'HOOK-01 block must not contain emojis (D-02b)',
    );
    // ESC (\x1B) inicia secuencias ANSI; el bloque es markdown plano.
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\x1B\[/.test(block), 'HOOK-01 block must not contain ANSI escape sequences (D-02b)');
  });
});

describe('QUICK-08 — quick mode buildGsdContext', () => {
  it('QUICK-08: renders /gsd-quick "<title>" and omits /gsd-plan-phase, /gsd-execute-phase, /gsd-verify-work, /gsd-new-project', () => {
    const session = makeSession({
      gsd: true,
      gsd_mode: 'quick',
      summary: 'TASK-X',
      task_ref: 'KL-42',
    });
    const output = buildGsdContext(session, {});
    assert.match(output, /\/gsd-quick "TASK-X"/);
    assert.ok(!output.includes('/gsd-plan-phase'), 'quick branch must not inject /gsd-plan-phase');
    assert.ok(!output.includes('/gsd-execute-phase'), 'quick branch must not inject /gsd-execute-phase');
    assert.ok(!output.includes('/gsd-verify-work'), 'quick branch must not inject /gsd-verify-work');
    assert.ok(!output.includes('/gsd-new-project'), 'quick branch must not inject /gsd-new-project (bootstrap is full-only)');
  });

  it('QUICK-08: includes closing line "Run the slash command and finish — no plan/execute/verify cycle." (Phase 12 D-05)', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const output = buildGsdContext(session, {});
    assert.match(
      output,
      /Run the slash command and finish — no plan\/execute\/verify cycle\./,
      'D-05 closing line must justify why quick block has a single command',
    );
  });

  it('QUICK-08: escapes double-quotes in title — \'TASK-X "with quotes"\' produces /gsd-quick "TASK-X \'with quotes\'" (Phase 12 D-04)', () => {
    // Phase 12 D-04: title.replace(/"/g, "'"). Plane titles raramente usan
    // quotes estratégicamente; el slash-command parser de Claude Code
    // interpreta backslash escapes inconsistentemente, así que reemplazo
    // simple es la elección predecible.
    const session = makeSession({
      gsd: true,
      gsd_mode: 'quick',
      summary: 'TASK-X "with quotes"',
    });
    const output = buildGsdContext(session, {});
    assert.ok(
      output.includes(`/gsd-quick "TASK-X 'with quotes'"`),
      `output must contain literal /gsd-quick "TASK-X 'with quotes'" — got fragment: ${output.slice(output.indexOf('/gsd-quick'), output.indexOf('/gsd-quick') + 60)}`,
    );
  });

  it('QUICK-08: when opts.brief present, brief renders FIRST and slash command AFTER (Phase 12 D-03 simétrico con D-11 Phase 9)', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const brief = '## Project Brief\n\nFoo bar baz';
    const output = buildGsdContext(session, { brief });
    const briefIdx = output.indexOf('## Project Brief');
    const cmdIdx = output.indexOf('/gsd-quick');
    assert.ok(briefIdx >= 0, 'brief must be rendered when opts.brief is provided');
    assert.ok(cmdIdx >= 0, 'slash command must be rendered');
    assert.ok(briefIdx < cmdIdx, 'brief must come BEFORE slash command (Phase 12 D-03)');
  });

  it('QUICK-08: when opts.brief absent, no brief block is rendered (no blank section)', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const output = buildGsdContext(session, {});
    assert.ok(!output.includes('## Project Brief'), 'no brief block when opts.brief is undefined');
    assert.match(output, /\/gsd-quick/, 'slash command still rendered');
  });

  it('QUICK-08: header is unified "# kodo TASK-X — GSD Mode" (Phase 12 D-01: same as full branches)', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X', task_ref: 'KL-99' });
    const output = buildGsdContext(session, {});
    assert.match(output, /# kodo KL-99 — GSD Mode/, 'header must be unified across all GSD branches');
  });

  it('QUICK-08: quick wins over residual phase_id (Phase 12 D-06: defense in depth)', () => {
    // Una sesión quick NO debería tener phase_id (dispatcher lo descarta
    // por Phase 11 D-03). Si por error/legacy aparece, el branch quick
    // debe ignorarlo y NO degradar a la rama full+match.
    const session = makeSession({
      gsd: true,
      gsd_mode: 'quick',
      phase_id: '9',  // residual — should be ignored
      summary: 'TASK-X',
    });
    const output = buildGsdContext(session, {});
    assert.match(output, /\/gsd-quick "TASK-X"/, 'quick command rendered despite residual phase_id');
    assert.ok(!output.includes('/gsd-plan-phase 9'), 'must not fall through to full+phase branch');
  });

  it('HOOK-01 (quick EN): bloque "## No automatic push" presente con statement + ejemplo', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const ctx = buildGsdContext(session, {});
    assert.match(ctx, /## No automatic push/);
    assert.match(ctx, /kodo does NOT push automatically/);
    assert.match(ctx, /verify with a real `git push`/);
    assert.match(ctx, /Bad: "Feature deployed to production\."/);
    assert.match(ctx, /Good: "Feature committed locally, pending `git push` to remote\."/);
  });

  it('HOOK-02 (quick EN, opción B): bloque al FINAL — prefix bytes intactos', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const ctx = buildGsdContext(session, {});
    const HEADER = '## No automatic push';
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0);
    const tail = ctx.slice(idx);
    assert.ok(tail.startsWith(HEADER), 'header must start the final block (quick branch)');
    const prefix = ctx.slice(0, idx);
    assert.ok(prefix.endsWith('\n\n'), 'prefix must end with blank line separator (D-03)');
  });
});

describe('session-start.js — source invariants', () => {
  const source = readFileSync(SOURCE_PATH, 'utf-8');

  it('Test 5a: no occurrence of "plane_identifier" in source', () => {
    assert.ok(
      !source.includes('plane_identifier'),
      'session-start.js must not reference plane_identifier',
    );
  });

  it('Test 5b: no occurrence of "plane_id" as field access in source', () => {
    // Match session.plane_id or .plane_id (field access), NOT project_id
    assert.ok(
      !/\.plane_id\b/.test(source),
      'session-start.js must not use .plane_id field access',
    );
  });

  it('Test 6: no hardcoded "Plane" in user-facing instructions', () => {
    // Allow "Plane" only in comments (lines starting with //) or inside config lookup
    // Scan non-comment lines for the literal word "Plane"
    const lines = source.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      // Allow string "plane" lowercase (provider name, config key)
      // Disallow "Plane" (capitalized) in any runtime code path
      if (/\bPlane\b/.test(line)) {
        assert.fail(
          `Hardcoded "Plane" found in non-comment line: ${line.trim()}`,
        );
      }
    }
  });

  it('Phase 9: does NOT emit gsd.phase.resolved from hook (moved to dispatcher, pattern-mapper #3)', () => {
    // Anti-regression guard. The dispatcher is now the single source for
    // gsd.phase.resolved emission. Duplicating from the hook would make
    // `kodo logs --event gsd.phase.resolved` double-count every GSD session.
    //
    // Grep the source (comments stripped) for the invocation pattern. The
    // substring may appear in a comment describing the removal — that's fine.
    // We only forbid the actual call `gsdPhaseResolved(log, ...)`.
    const invocationRe = /gsdPhaseResolved\s*\(/;
    // Strip single-line and block comments to avoid false positives from the
    // explanatory comment block that documents this invariant.
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    assert.ok(
      !invocationRe.test(stripped),
      'src/hooks/session-start.js must NOT invoke gsdPhaseResolved — that emission moved to src/triggers/dispatcher.js in Phase 9 to avoid duplicate NDJSON entries',
    );
  });

  it('Phase 9 (09-06 gap closure): does NOT emit gsd.bootstrap from hook (moved to dispatcher, pattern-mapper #3)', () => {
    // Anti-regression guard completing pattern-mapper #3 for gsd.bootstrap.
    // The dispatcher is now the single source for gsd.bootstrap emission
    // (src/triggers/dispatcher.js:198-204). Duplicating from the hook would
    // make `kodo logs --event gsd.bootstrap` double-count every bootstrap
    // dispatch — the exact regression GAP-01 / REVIEW HI-01 identified.
    //
    // Strip single-line and block comments to avoid false positives from
    // explanatory comments that may legitimately mention gsdBootstrap.
    const invocationRe = /gsdBootstrap\s*\(/;
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    assert.ok(
      !invocationRe.test(stripped),
      'src/hooks/session-start.js must NOT invoke gsdBootstrap — that emission moved to src/triggers/dispatcher.js in Phase 9 (09-06) to avoid duplicate NDJSON entries',
    );
  });

  it('Phase 9: buildGsdContext signature accepts opts with brief field', () => {
    // Signature invariant — detect accidental reverts of the D-09 extension.
    assert.match(
      source,
      /export function buildGsdContext\(session, opts\s*=\s*\{\}\)/,
      'buildGsdContext must accept (session, opts = {}) with brief support',
    );
  });

  it('QUICK-08: no inline `session.gsd_mode || "full"` (Phase 13 D-09 anti-inline)', () => {
    // Phase 11 <specifics>: el helper getSessionMode aplica la regla
    // "legacy gsd:true sin gsd_mode == full" (D-08). Inline `session.gsd_mode || 'full'`
    // es una micro-violación de DRY que duplica la regla en cada callsite.
    // Si esta regex matchea, el refactor Phase 12 D-09 se está erosionando.
    assert.ok(
      !/session\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
      'session-start.js must use getSessionMode(session), not inline `session.gsd_mode || "full"` (Phase 13 D-09 — single source of legacy preservation)',
    );
  });

  it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
    // Phase 13 D-10: el campo session.gsd_mode SOLO debe leerse vía
    // getSessionMode (definido en src/labels.js). Cualquier acceso directo
    // .gsd_mode en session-start.js (consumer) es una violación del helper boundary.
    // Excepción documentada: src/labels.js:84 lee el campo legítimamente
    // dentro de getSessionMode — pero este archivo NO es src/labels.js.
    //
    // Strip comments para evitar false positives (la rama quick puede tener
    // un comentario que mencione gsd_mode como referencia documental).
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.gsd_mode\b/.test(stripped),
      'src/hooks/session-start.js must not access .gsd_mode directly. Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
    );
  });
});
