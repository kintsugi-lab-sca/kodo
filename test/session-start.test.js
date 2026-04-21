// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSessionContext } from '../src/hooks/session-start.js';

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

  it('Phase 9: still invokes gsdBootstrap from hook for bootstrap sessions', () => {
    // Companion assertion: removing the phase-resolved emit must NOT remove the
    // bootstrap emit. Bootstrap events still originate from the hook.
    assert.match(
      source,
      /gsdBootstrap\s*\(/,
      'session-start.js must still invoke gsdBootstrap for bootstrap sessions',
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
});
