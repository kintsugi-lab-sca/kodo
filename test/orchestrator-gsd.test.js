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
