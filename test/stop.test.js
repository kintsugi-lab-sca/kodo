// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStopNudgeText } from '../src/hooks/stop.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOP_SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'stop.js');

describe('stop.js source hygiene', () => {
  it('does not import PlaneClient', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'stop.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import from plane/client');
  });

  it('does not touch Plane state (no updateTaskState, no addComment calls)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('updateTaskState'), 'hook must not move Plane state — the active session does that');
    assert.ok(!source.includes('addComment'), 'hook must not post comments — the active session does that');
  });

  it('does not import provider registry', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('initRegistry'), 'hook should not initialize registry');
    assert.ok(!source.includes('getProvider'), 'hook should not fetch a provider');
  });

  it('imports releaseGsdLock from gsd/lock.js for GSD cleanup (D-09)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /releaseGsdLock/, 'stop.js must reference releaseGsdLock for GSD lock cleanup');
  });

  it('guards lock release behind session.gsd check', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /session\.gsd/, 'lock release must be conditional on session.gsd');
  });

  it('releases lock before removeSession (order matters)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
    // Phase 16 (LOG-15): main() refactor a runStopHook(input, deps) renombró el
    // call site de removeSession(id) a removeSessionFn(id). Aceptamos ambas
    // variantes — lo crítico es el orden, no el nombre del binding local.
    const removeFnIdx = source.indexOf('removeSessionFn(id)');
    const removeIdx = removeFnIdx >= 0 ? removeFnIdx : source.indexOf('removeSession(id)');
    assert.ok(removeIdx > 0, 'must find removeSessionFn(id) or removeSession(id) call');
    assert.ok(lockIdx < removeIdx, 'releaseGsdLock must come before remove call');
  });

  it('uses dynamic import for gsd/lock.js (lazy load)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /await import\(.*gsd\/lock/, 'must use dynamic import for lock module');
  });

  it('QUICK-08: no inline `session.gsd_mode || "full"` (Phase 13 D-09 anti-inline)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(
      !/session\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
      'stop.js must use getSessionMode(session), not inline `session.gsd_mode || "full"` (Phase 13 D-09)',
    );
  });

  it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.gsd_mode\b/.test(stripped),
      'src/hooks/stop.js must not access .gsd_mode directly. Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
    );
  });

  it('QUICK-08: case "quick" block in source does NOT contain `kodo gsd verify` (Phase 13 D-11 source guard complementing behavior test)', () => {
    // Captura el bloque del case 'quick' por regex y verifica que no
    // contiene la subcadena `kodo gsd verify`. Si alguien refactoriza
    // el switch y reintroduce el verify nudge en quick, este test
    // falla además del behavior test.
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const quickCaseMatch = source.match(/case\s+['"]quick['"]:[\s\S]*?(?=case\s+['"]full['"]|case\s+['"]default['"]|\bdefault\s*:)/);
    assert.ok(quickCaseMatch, 'must find case "quick" block in source');
    assert.ok(
      !quickCaseMatch[0].includes('kodo gsd verify'),
      'case "quick" block must NOT contain `kodo gsd verify` (CLI does not support quick mode)',
    );
  });

  it('Phase 19 D-07: worktree cleanup happens AFTER releaseGsdLock', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
    assert.ok(lockIdx > 0, 'must find releaseGsdLock call site');
    // Cleanup marker: el helper canónico `worktreeCleanupOk` se invoca en la
    // rama CLEAN del cleanup block. Si alguien reordena y cleanup queda antes
    // de releaseGsdLock, este test falla.
    const cleanupIdx = source.indexOf('worktreeCleanupOk');
    assert.ok(cleanupIdx > 0, 'must find worktree cleanup block (worktreeCleanupOk)');
    assert.ok(
      lockIdx < cleanupIdx,
      'cleanup must come AFTER releaseGsdLock (Phase 19 D-07)',
    );
  });

  it('Phase 19 D-08 / Pitfall #2: branch --show-current is read BEFORE worktree remove', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const showCurrentIdx = source.indexOf("'--show-current'");
    // worktree remove se invoca como array literal: ['worktree', 'remove', ...].
    const removeMatches = [];
    const re = /'worktree',\s*'remove'/g;
    let m;
    while ((m = re.exec(source)) !== null) removeMatches.push(m.index);
    const removeIdx = removeMatches[0] ?? -1;
    assert.ok(showCurrentIdx > 0, 'must reference branch --show-current');
    assert.ok(removeIdx > 0, 'must reference worktree remove');
    assert.ok(
      showCurrentIdx < removeIdx,
      'branch --show-current must precede worktree remove (Pitfall #2 / D-08)',
    );
  });

  it('Phase 19 D-05 (WT-05 satisfied-by-design): handleOrchestratorStop preserves cwd: KODO_ROOT', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const match = source.match(/async function handleOrchestratorStop[\s\S]*?\n}/);
    assert.ok(match, 'must find handleOrchestratorStop function');
    assert.ok(
      match[0].includes('cwd: KODO_ROOT'),
      'handleOrchestratorStop must preserve cwd: KODO_ROOT (Phase 19 D-05; auto-commit excluded from worktree per Phase 18 D-06)',
    );
  });
});

describe('QUICK-08 — buildStopNudgeText switch', () => {
  function makeQuickSession(overrides = {}) {
    return {
      workspace_ref: 'workspace:1',
      session_id: 'sess-quick-123',
      task_id: 'tid',
      task_ref: 'KL-42',
      provider: 'plane',
      project_id: 'p1',
      summary: 'Quick task',
      status: 'review',
      started_at: '2026-04-29T00:00:00.000Z',
      project_path: '/tmp/proj',
      ...overrides,
    };
  }

  it('QUICK-08: case "quick" — text omits `kodo gsd verify`, mentions sin VERIFICATION.md, asks manual review, idioma ES (Phase 12 D-08)', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'quick' }));
    assert.ok(!text.includes('kodo gsd verify'), 'quick case must NOT mention `kodo gsd verify` (CLI does not support quick)');
    assert.match(text, /sin VERIFICATION\.md/, 'quick case must mention sin VERIFICATION.md');
    assert.match(text, /Revísala manualmente/, 'quick case must ask for manual review');
    assert.match(text, /La sesión KL-42/, 'preserves base sentence opener');
    assert.match(text, /Es una sesión GSD quick/, 'identifies session as GSD quick');
    // Idioma ES (D-16 Phase 10 carry-forward)
    assert.ok(!/\bplease\b|\byou must\b/i.test(text), 'must be Spanish, no English keywords');
    // Phase 10 \\n literal preservado (cmux.send interpreta como Enter)
    assert.ok(text.endsWith('\\n'), 'must end with literal \\\\n (cmux Enter)');
  });

  it('QUICK-08: case "full" with phase_id — includes `kodo gsd verify <session-id>` and `fase N` (Phase 10 D-04 preserved)', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full', phase_id: '10' }));
    assert.match(text, /kodo gsd verify sess-quick-123/, 'must include session-id in verify command');
    assert.match(text, /fase 10/, 'phase_id renders as "fase N"');
    assert.match(text, /actúa según el verdict/, 'instructive ES text preserved');
  });

  it('QUICK-08: case "full" without phase_id (bootstrap) — verify command + "bootstrap" fallback', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full' }));
    assert.match(text, /kodo gsd verify sess-quick-123/);
    assert.match(text, /\(bootstrap\)/, 'phase_label fallback "bootstrap" when phase_id absent');
  });

  it('QUICK-08: legacy gsd:true without gsd_mode reads as full (Phase 11 D-08) — verify nudge present', () => {
    // Sesión v0.3 legacy persistida en state.json antes de Phase 11.
    // getSessionMode aplica la regla "ausente == full" → cae en case 'full'.
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, phase_id: '5' /* sin gsd_mode */ }));
    assert.match(text, /kodo gsd verify sess-quick-123/, 'legacy session reads as full → verify nudge');
    assert.match(text, /fase 5/);
  });

  it('QUICK-08: default (non-GSD) — original Phase 10 text, no verify, no quick mention', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: false }));
    assert.match(text, /Revisa el resultado y decide si pasa a Done/);
    assert.ok(!text.includes('kodo gsd verify'), 'non-GSD must not suggest verify');
    assert.ok(!text.includes('quick'), 'non-GSD must not mention quick');
  });
});
