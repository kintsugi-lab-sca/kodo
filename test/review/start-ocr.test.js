// @ts-check
//
// test/review/start-ocr.test.js — KODO-92: el cableado de la sección OCR en `kodo review start`.
//
// `test/review/launch.test.js` congela las piezas (recogida, render, escapado). Aquí se congela
// que el handler las junta: lo que se TECLEA en el workspace lleva la sección cuando OCR
// contesta, y cuando no contesta sale una línea en stderr y el arranque sigue como siempre.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** HOME temporal ANTES de importar nada que cachee `~/.kodo`. */
const HOME = mkdtempSync(join(tmpdir(), 'kodo92-home-'));
process.env.HOME = HOME;

const { runReviewStartCli } = await import('../../src/cli/review.js');
const { OCR_SECTION_HEADING } = await import('../../src/review/launch.js');

const CONFIG = /** @type {any} */ ({
  claude: { default_model: 'opus', flags: [] },
  agents: {
    default: 'claude-code',
    registry: {
      'claude-code': {
        binary: 'claude', model_flag: '--model', session_id_flag: '--session-id', worktree_flag: '--worktree',
        skip_perms_flag: '--dangerously-skip-permissions', prompt_style: 'positional', status_authority: 'hooks',
      },
    },
  },
  oracle: { repos: { '/repo/clipping': { ocr_rule: '/cfg/clipping.rule.json' } } },
  review: { max_rounds: 3 },
});

/** @param {(params: any) => any} ocrSpecFn */
function harness(ocrSpecFn) {
  const out = { stdout: '', stderr: '', sent: '', ocrParams: /** @type {any} */ (null) };
  const deps = /** @type {any} */ ({
    writeFn: (/** @type {string} */ s) => { out.stdout += s; },
    errFn: (/** @type {string} */ s) => { out.stderr += s; },
    loadConfigFn: () => CONFIG,
    findIntegrationFn: () => ({ task_ref: 'ITCLIP-1', task_id: 't1', project_path: '/repo/clipping', branch: 'feat/x' }),
    provisionFn: () => ({ ok: true, path: join(HOME, 'no-es-un-repo'), created: true }),
    openCycleFn: () => ({ ok: true, value: { round: 0 } }),
    readdirFn: () => [],
    randomUUIDFn: () => 'sid-92',
    newWorkspaceFn: async () => 'ws-92',
    sendFn: async (/** @type {{ text: string }} */ p) => { out.sent = p.text; },
    ocrSpecFn: (/** @type {any} */ params) => { out.ocrParams = params; return ocrSpecFn(params); },
  });
  return { out, deps };
}

describe('KODO-92 — kodo review start con la sección OCR', () => {
  after(() => rmSync(HOME, { recursive: true, force: true }));

  it('OCR contesta: la línea tecleada lleva la sección y --json lo dice', async () => {
    const section = `${OCR_SECTION_HEADING}\n\n- \`impacts/views.py\` (modified, +1 −0)\n\n`;
    const { out, deps } = harness(() => ({ ok: true, section }));
    const code = await runReviewStartCli('ITCLIP-1', { json: true }, deps);

    assert.equal(code, 0, out.stderr);
    assert.ok(out.sent.startsWith('KODO_REVIEWER=1 '));
    assert.ok(out.sent.includes(OCR_SECTION_HEADING), 'la sección viaja en el prompt tecleado');
    assert.equal(out.stderr, '');
    assert.equal(JSON.parse(out.stdout).ocr, 'included');
    // Se le pide a OCR con el repo, la rama y la regla de ESTE proyecto.
    assert.deepEqual(
      { projectPath: out.ocrParams.projectPath, branch: out.ocrParams.branch, rulePath: out.ocrParams.rulePath },
      { projectPath: '/repo/clipping', branch: 'feat/x', rulePath: '/cfg/clipping.rule.json' },
    );
    assert.ok(out.ocrParams.base, 'siempre con una base, aunque no se resuelva');
  });

  it('OCR no contesta: una línea en stderr con el motivo, y el arranque sigue sin la sección', async () => {
    const { out, deps } = harness(() => ({ ok: false, reason: 'ocr-missing' }));
    const code = await runReviewStartCli('ITCLIP-1', { json: true }, deps);

    assert.equal(code, 0, 'fail-open: nunca bloquea el arranque');
    assert.ok(out.sent.startsWith('KODO_REVIEWER=1 '), 'la sesión se lanza igual');
    assert.ok(!out.sent.includes(OCR_SECTION_HEADING));
    assert.equal(out.stderr.trim().split('\n').length, 1, `una sola línea:\n${out.stderr}`);
    assert.match(out.stderr, /^OCR: .*\(ocr-missing\)/);
    assert.equal(JSON.parse(out.stdout).ocr, 'ocr-missing');
  });
});
