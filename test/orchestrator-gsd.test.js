// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

describe('prompt.md — sección GSD renderizada', () => {
  const prompt = readFileSync('src/orchestrator/prompt.md', 'utf-8');

  it('PM1: contiene heading literal "## Sesiones GSD"', () => {
    assert.ok(prompt.includes('## Sesiones GSD'),
      'heading "## Sesiones GSD" debe estar presente');
  });

  it('PM2: contiene comando literal "kodo gsd verify <session-id>"', () => {
    assert.ok(prompt.includes('kodo gsd verify <session-id>'));
  });

  it('PM3: menciona los 4 verdicts como palabras literales', () => {
    for (const v of ['pass', 'fail', 'missing', 'malformed']) {
      assert.ok(new RegExp(`\\b${v}\\b`).test(prompt),
        `verdict "${v}" ausente en prompt.md`);
    }
  });

  it('PM4: referencia los 4 artefactos GSD', () => {
    for (const artifact of ['PROJECT.md', 'ROADMAP.md', 'PLAN.md', 'VERIFICATION.md']) {
      assert.ok(prompt.includes(artifact), `artifact "${artifact}" ausente`);
    }
  });

  it('PM5: conserva el placeholder {{provider_name}}', () => {
    assert.ok(prompt.includes('{{provider_name}}'));
  });

  it('PM6: menciona kodo gsd inspect para debugging', () => {
    assert.ok(prompt.includes('kodo gsd inspect <task-id>'));
  });

  it('PM7: sin frases inglesas típicas de prompts', () => {
    for (const phrase of [/\byou must\b/i, /\bplease\b/i, /\bexecute your\b/i]) {
      assert.ok(!phrase.test(prompt), `frase inglesa prohibida encontrada: ${phrase}`);
    }
  });
});

import { buildContextSummary } from '../src/orchestrator/launch.js';

describe('buildContextSummary — Phase 10 GSD tagging', () => {
  const baseSession = {
    workspace_ref: 'workspace:1',
    session_id: 's1',
    task_id: 'tid',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'p1',
    summary: 'Do work',
    status: 'running',
    started_at: new Date().toISOString(),
    project_path: '/tmp/proj',
  };
  const config = { claude: { max_parallel: 3 } };

  it('L1: sesión GSD con phase_id=10 → tag [GSD phase 10]', () => {
    const sessions = [{ ...baseSession, gsd: true, phase_id: '10' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD phase 10\]`/);
  });

  it('L2: sesión GSD sin phase_id (bootstrap) → tag [GSD bootstrap]', () => {
    const sessions = [{ ...baseSession, gsd: true, phase_id: undefined }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD bootstrap\]`/);
  });

  it('L3: sesión no-GSD → NO contiene tag [GSD...]', () => {
    const sessions = [{ ...baseSession, gsd: false }];
    const out = buildContextSummary(sessions, config);
    assert.ok(!out.includes('[GSD'));
    assert.match(out, /- \*\*KL-42\*\*: Do work/);
  });

  it('L4: sesión con gsd undefined → NO contiene tag', () => {
    const sessions = [{ ...baseSession }]; // sin gsd
    const out = buildContextSummary(sessions, config);
    assert.ok(!out.includes('[GSD'));
  });

  it('L5: mix de sesiones → cada una tageada correctamente', () => {
    const sessions = [
      { ...baseSession, task_ref: 'KL-1', gsd: true, phase_id: '5' },
      { ...baseSession, task_ref: 'KL-2', gsd: false },
      { ...baseSession, task_ref: 'KL-3', gsd: true, phase_id: undefined },
    ];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-1\*\*\s*`\[GSD phase 5\]`/);
    assert.match(out, /KL-2\*\*:/); // sin tag
    assert.ok(!out.match(/KL-2\*\*.*\[GSD/));
    assert.match(out, /KL-3\*\*\s*`\[GSD bootstrap\]`/);
  });

  it('L6: workspace + elapsed + project_path preservados', () => {
    const sessions = [{ ...baseSession, gsd: true, phase_id: '10' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /Workspace: workspace:1/);
    assert.match(out, /\/tmp\/proj/);
  });
});

import { buildStopNudgeText } from '../src/hooks/stop.js';

describe('buildStopNudgeText — Phase 10 nudge condicional GSD', () => {
  const baseSession = {
    workspace_ref: 'workspace:1',
    session_id: 'sess-abc-123',
    task_id: 'tid',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'p1',
    summary: 'Do work',
    status: 'review',
    started_at: new Date().toISOString(),
    project_path: '/tmp/proj',
  };

  it('S1: GSD session con phase_id → incluye `kodo gsd verify <session-id>` y fase', () => {
    const text = buildStopNudgeText({ ...baseSession, gsd: true, phase_id: '10' });
    assert.match(text, /kodo gsd verify sess-abc-123/);
    assert.match(text, /fase 10/);
    assert.match(text, /La sesión KL-42/);
  });

  it('S2: GSD session sin phase_id (bootstrap) → fallback bootstrap', () => {
    const text = buildStopNudgeText({ ...baseSession, gsd: true, phase_id: undefined });
    assert.match(text, /kodo gsd verify sess-abc-123/);
    assert.match(text, /bootstrap/);
  });

  it('S3: non-GSD session → texto original sin kodo gsd verify', () => {
    const text = buildStopNudgeText({ ...baseSession, gsd: false });
    assert.ok(!text.includes('kodo gsd verify'));
    assert.match(text, /Revisa el resultado y decide si pasa a Done/);
  });

  it('S4: session sin gsd (undefined) → texto original', () => {
    const text = buildStopNudgeText({ ...baseSession });
    assert.ok(!text.includes('kodo gsd verify'));
  });

  it('S5: todos los casos arrancan con "La sesión KL-42"', () => {
    const gsd = buildStopNudgeText({ ...baseSession, gsd: true, phase_id: '10' });
    const nonGsd = buildStopNudgeText({ ...baseSession, gsd: false });
    assert.ok(gsd.startsWith('La sesión KL-42'));
    assert.ok(nonGsd.startsWith('La sesión KL-42'));
  });

  it('S6: preserva el \\n literal al final', () => {
    const text = buildStopNudgeText({ ...baseSession, gsd: true, phase_id: '10' });
    assert.ok(text.endsWith('\\n'));
  });

  it('S7: idioma español (no inglés en prosa)', () => {
    const text = buildStopNudgeText({ ...baseSession, gsd: true, phase_id: '10' });
    // No debe contener palabras-clave inglesas típicas del buildGsdContext.
    assert.ok(!/\bplease\b|\byou must\b|\bexecute\b/i.test(text));
    assert.match(text, /Ejecuta/); // español
  });
});

describe('QUICK-08 — buildContextSummary gsdTag', () => {
  const baseSession = {
    workspace_ref: 'workspace:1',
    session_id: 's1',
    task_id: 'tid',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'p1',
    summary: 'Do work',
    status: 'running',
    started_at: new Date().toISOString(),
    project_path: '/tmp/proj',
  };
  const config = { claude: { max_parallel: 3 } };

  it('QUICK-08: gsd_mode:"quick" → tag [GSD quick]', () => {
    const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'quick' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD quick\]`/, 'must render [GSD quick] tag');
    assert.ok(!out.includes('[GSD phase'), 'must not render [GSD phase ...] for quick session');
    assert.ok(!out.includes('[GSD bootstrap]'), 'must not render [GSD bootstrap] for quick session');
  });

  it('QUICK-08: gsd_mode:"full" + phase_id → tag [GSD phase N] (Phase 10 D-19 preserved)', () => {
    const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'full', phase_id: '9' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD phase 9\]`/);
  });

  it('QUICK-08: gsd_mode:"full" without phase_id → tag [GSD bootstrap]', () => {
    const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'full' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD bootstrap\]`/);
  });

  it('QUICK-08: defensive — quick session with residual phase_id renders [GSD quick] (mode wins over phase_id, Phase 12 D-11)', () => {
    // Phase 12 D-11: defensa en profundidad. Dispatcher descarta phase_id
    // en quick (Phase 11 D-03), así que esta combinación no debería
    // existir en producción. Si por bug/legacy aparece, mode-first
    // garantiza que el tag respeta la intención del modo.
    const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'quick', phase_id: '9' }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD quick\]`/, 'mode wins over residual phase_id');
    assert.ok(!out.includes('[GSD phase 9]'), 'must not fall through to phase_id branch');
  });

  it('QUICK-08: legacy gsd:true without gsd_mode + phase_id reads as full (Phase 11 D-08) → [GSD phase N]', () => {
    // Sesión v0.3 legacy: getSessionMode devuelve 'full' (regla ausente == full).
    // El cómputo `mode === 'quick' ? 'quick' : (s.phase_id ? 'phase N' : 'bootstrap')`
    // cae al ternary phase_id → '[GSD phase 5]'.
    const sessions = [{ ...baseSession, gsd: true, phase_id: '5' /* no gsd_mode */ }];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-42\*\*\s*`\[GSD phase 5\]`/, 'legacy session reads as full → phase tag');
  });

  it('QUICK-08: mix of all 3 GSD tag flavors renders correctly per session', () => {
    const sessions = [
      { ...baseSession, task_ref: 'KL-Q', gsd: true, gsd_mode: 'quick' },
      { ...baseSession, task_ref: 'KL-P', gsd: true, gsd_mode: 'full', phase_id: '7' },
      { ...baseSession, task_ref: 'KL-B', gsd: true, gsd_mode: 'full' },
      { ...baseSession, task_ref: 'KL-N', gsd: false },
    ];
    const out = buildContextSummary(sessions, config);
    assert.match(out, /KL-Q\*\*\s*`\[GSD quick\]`/);
    assert.match(out, /KL-P\*\*\s*`\[GSD phase 7\]`/);
    assert.match(out, /KL-B\*\*\s*`\[GSD bootstrap\]`/);
    assert.ok(!/KL-N\*\*.*\[GSD/.test(out), 'non-GSD session must not have any GSD tag');
  });
});

describe('QUICK-08 — launch.js source hygiene', () => {
  const LAUNCH_SOURCE_PATH = 'src/orchestrator/launch.js';

  it('QUICK-08: no inline `s.gsd_mode || "full"` or `session.gsd_mode || "full"` (Phase 13 D-09)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    assert.ok(
      !/\b(s|session)\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
      'launch.js must use getSessionMode(s), not inline `s.gsd_mode || "full"` (Phase 13 D-09)',
    );
  });

  it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.gsd_mode\b/.test(stripped),
      'src/orchestrator/launch.js must not access .gsd_mode directly. Use `getSessionMode(s)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
    );
  });

  it('QUICK-08: imports getSessionMode from labels.js (Phase 12 D-11 contract)', () => {
    const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /import\s*\{[^}]*getSessionMode[^}]*\}\s*from\s*['"]\.\.\/labels\.js['"]/,
      'launch.js must import getSessionMode from ../labels.js',
    );
  });
});

import { applyReportingGate, resolvePromptTemplate } from '../src/orchestrator/launch.js';
import { KODO_LABEL_GSD_CHILD } from '../src/labels.js';

describe('REPORT-04..08 — Sub-issue reporting block content', () => {
  // We assert on the FULLY RESOLVED prompt (post placeholders + flag=true).
  // This mirrors what the agent will actually read at runtime.
  const raw = readFileSync('src/orchestrator/prompt.md', 'utf-8');
  const resolved = applyReportingGate(
    resolvePromptTemplate(raw, { provider: 'plane' }),
    true,
  );

  // Convenience: extract just the block content for some asserts.
  const beginIdx = resolved.indexOf('<!-- BEGIN reporting -->');
  const endIdx = resolved.indexOf('<!-- END reporting -->');
  const block = resolved.substring(beginIdx, endIdx);

  it('RC1 (REPORT-04): block references kodo:gsd-child literal coupled to KODO_LABEL_GSD_CHILD constant', () => {
    // Hard coupling: if Phase 14 changes the constant value, this test
    // breaks immediately. Intentional cross-phase dependency (CONTEXT.md
    // <domain> "Constraint cross-phase").
    assert.equal(KODO_LABEL_GSD_CHILD, 'kodo:gsd-child',
      'sanity: Phase 14 constant must hold the documented value');
    assert.ok(block.includes(KODO_LABEL_GSD_CHILD),
      `block must reference KODO_LABEL_GSD_CHILD literal ('${KODO_LABEL_GSD_CHILD}') — found labels: ${block.match(/kodo:[a-z-]+/g)?.join(', ') ?? 'none'}`);
  });

  it('RC2 (REPORT-04): block instructs creating sub-issue with parent_id', () => {
    assert.ok(block.includes('parent_id'),
      'block must mention parent_id (linking sub-issue to parent task)');
  });

  it('RC3 (REPORT-04): block instructs Phase N: title format', () => {
    assert.ok(block.includes('Phase N:'),
      'block must specify the title format "Phase N: <name>"');
  });

  it('RC4 (REPORT-05): block instructs plan-by-plan as comments (not new sub-issues)', () => {
    // D-11: comentarios plan-by-plan con header "## Plan N-MM:".
    assert.ok(/Plan N-?MM/.test(block) || block.includes('Plan N-MM'),
      'block must define the comment header format "Plan N-MM"');
    assert.ok(/Plan\s*=\s*comentario/i.test(block) || /comentario/i.test(block),
      'block must explicitly state plan == comment (not separate sub-issue)');
  });

  it('RC5 (REPORT-06): block uses abstract lifecycle vocabulary in progress / done / verified', () => {
    for (const word of ['in progress', 'done', 'verified']) {
      assert.ok(new RegExp(`\\b${word}\\b`).test(block),
        `lifecycle vocabulary "${word}" must appear in block`);
    }
  });

  it('RC6 (REPORT-06): block includes pragmatic Plane parens for status mapping', () => {
    // D-05: paréntesis pragmático "(en Plane: `In Progress` / `In Review` / `Done`)".
    // After resolvePromptTemplate, "{{provider_name}}" → "Plane".
    assert.ok(block.includes('Plane'),
      'resolved block must mention Plane in pragmatic parens (D-05)');
    assert.ok(/In Progress/.test(block),
      'pragmatic Plane mapping must include "In Progress"');
    assert.ok(/Done/.test(block),
      'pragmatic Plane mapping must include "Done"');
  });

  it('RC7 (REPORT-07): block enforces append-only with NUNCA capitalized near delete-issue', () => {
    // D-07: "NUNCA `delete-issue`". Capitalized for emphasis.
    assert.ok(/\bNUNCA\b/.test(block),
      'block must contain "NUNCA" capitalized (append-only emphasis)');
    // Sanity: "NUNCA" is near "delete-issue" — within 200 chars.
    const nuncaIdx = block.search(/\bNUNCA\b/);
    const deleteIdx = block.indexOf('delete-issue');
    assert.ok(deleteIdx >= 0,
      'block must mention `delete-issue` literally (the forbidden call)');
    assert.ok(Math.abs(nuncaIdx - deleteIdx) < 200,
      `NUNCA and delete-issue must be near each other (NUNCA at ${nuncaIdx}, delete-issue at ${deleteIdx})`);
  });

  it('RC8 (REPORT-07): block instructs cancelled status for orphaned phases', () => {
    assert.ok(/\bcancelled\b/.test(block),
      'block must instruct transitioning to "cancelled" for re-planned phases');
  });

  it('RC9 (REPORT-08): block opens validation section with HARD STEP marker', () => {
    // D-13: "HARD STEP" capitalized to ensure agent does not skip.
    assert.ok(/HARD STEP/.test(block),
      'block must contain "HARD STEP" (validation reminder D-13)');
  });

  it('RC10 (REPORT-04..08, D-14): block defines MCP failure log with exact literal', () => {
    // D-14: log literal "[kodo:reporting] MCP failure on phase N: <error>".
    assert.ok(block.includes('[kodo:reporting] MCP failure on phase N:'),
      'block must define MCP failure log line exactly');
  });

  it('RC11 (REPORT-04..08, D-15): block defines capability gap log with exact literal', () => {
    // D-15: log literal "[kodo:reporting] Provider MCP lacks sub-issue capability — reporting disabled".
    assert.ok(block.includes('[kodo:reporting] Provider MCP lacks sub-issue capability — reporting disabled'),
      'block must define capability gap log line exactly (em-dash included)');
  });

  it('RC12 (REPORT-04, D-08): block clarifies quick mode does NOT create sub-issues', () => {
    // D-08: quick lifecycle differs; D-CONTEXT specifies "En sesiones GSD `quick` ... NO crees sub-issue".
    assert.ok(/quick/i.test(block),
      'block must mention quick mode handling');
    // Either "no crees sub-issue" or "no se crea" or similar negation near "quick".
    assert.ok(/quick[\s\S]{0,200}(no\s+cre|no\s+se\s+crea|no\s+aplica)/i.test(block),
      'block must instruct that quick sessions do not create sub-issues');
  });

  it('RC13 (D-12): block specifies initial body with Goal:, PLAN dir:, Plans:', () => {
    for (const field of ['Goal:', 'PLAN dir:', 'Plans:']) {
      assert.ok(block.includes(field),
        `initial sub-issue body must include "${field}" field (D-12)`);
    }
  });

  it('RC14 (D-10): block instructs dedup via list-issues filtered by parent_id and label', () => {
    assert.ok(block.includes('list-issues'),
      'dedup step must reference list-issues call');
    // Already verified parent_id (RC2) and kodo:gsd-child (RC1) are in block;
    // here we just verify dedup verb appears.
    assert.ok(/REUSA|dedup|reuses?|reusar/i.test(block),
      'dedup intent must be verbalized');
  });

  it('RC15: source-hygiene — block does NOT contain forbidden English prompt phrases (PM7 sub-scoped)', () => {
    for (const phrase of [/\byou must\b/i, /\bplease\b/i, /\bexecute your\b/i]) {
      assert.ok(!phrase.test(block),
        `forbidden English phrase found INSIDE the reporting block: ${phrase}`);
    }
  });
});

describe('REPORT-03 — Sub-issue reporting block ABSENT when flag=false', () => {
  const raw = readFileSync('src/orchestrator/prompt.md', 'utf-8');
  const stripped = applyReportingGate(
    resolvePromptTemplate(raw, { provider: 'plane' }),
    false,
  );

  it('RA1: stripped prompt has no Sub-issue reporting heading', () => {
    assert.ok(!stripped.includes('Sub-issue reporting'),
      'flag=false must remove the entire reporting section');
  });

  it('RA2: stripped prompt has no kodo:gsd-child references', () => {
    // The label only appears inside the gated block (Phase 15 design).
    // If it appears elsewhere later, this test guides us to keep it gated.
    assert.ok(!stripped.includes('kodo:gsd-child'),
      'flag=false must remove kodo:gsd-child references (only appear in the gated block today)');
  });

  it('RA3: stripped prompt has no NUNCA capitalized', () => {
    assert.ok(!/\bNUNCA\b/.test(stripped),
      'flag=false must remove the NUNCA append-only directive (only inside gated block)');
  });

  it('RA4: stripped prompt has no HARD STEP marker', () => {
    assert.ok(!/HARD STEP/.test(stripped),
      'flag=false must remove the HARD STEP validation reminder');
  });

  it('RA5: stripped prompt has no [kodo:reporting] log directives', () => {
    assert.ok(!stripped.includes('[kodo:reporting]'),
      'flag=false must remove all [kodo:reporting] log directives');
  });

  it('RA6: stripped prompt PRESERVES the unrelated "## Sesiones GSD" section intact', () => {
    assert.ok(stripped.includes('## Sesiones GSD'),
      'pre-existing GSD section must survive');
    assert.ok(stripped.includes('kodo gsd verify <session-id>'),
      'pre-existing GSD command snippet must survive');
    assert.ok(stripped.includes('Sesiones quick'),
      'pre-existing quick subsection must survive');
  });
});
