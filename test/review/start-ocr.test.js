// @ts-check
//
// test/review/start-ocr.test.js — KODO-92: el cableado de la sección OCR en `kodo review start`.
//
// `test/review/launch.test.js` congela las piezas (recogida, render, entrega). Aquí se congela
// que el handler las junta: el fichero de prompt lleva la sección cuando OCR contesta, y cuando
// no contesta sale una línea en stderr y el arranque sigue como siempre.
//
// KODO-110: la línea tecleada solo referencia ese fichero, y mide menos de 3500 bytes sea cual
// sea el prompt. Con cmux 0.65.2, `cmux send` falla de forma intermitente a partir de 4 KB.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** HOME temporal ANTES de importar nada que cachee `~/.kodo`. */
const HOME = mkdtempSync(join(tmpdir(), 'kodo92-home-'));
process.env.HOME = HOME;
// Los ficheros de prompt también van al directorio temporal del test.
process.env.TMPDIR = HOME;

const { runReviewStartCli } = await import('../../src/cli/review.js');
const { OCR_SECTION_HEADING } = await import('../../src/review/launch.js');
const { promptFilePath } = await import('../../src/session/prompt-file.js');

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
  const out = { stdout: '', stderr: '', sent: '', workspaces: 0, ocrParams: /** @type {any} */ (null) };
  const deps = /** @type {any} */ ({
    writeFn: (/** @type {string} */ s) => { out.stdout += s; },
    errFn: (/** @type {string} */ s) => { out.stderr += s; },
    loadConfigFn: () => CONFIG,
    findIntegrationFn: () => ({ task_ref: 'ITCLIP-1', task_id: 't1', project_path: '/repo/clipping', branch: 'feat/x' }),
    provisionFn: () => ({ ok: true, path: join(HOME, 'no-es-un-repo'), created: true }),
    openCycleFn: () => ({ ok: true, value: { round: 0 } }),
    readdirFn: () => [],
    randomUUIDFn: () => 'sid-92',
    newWorkspaceFn: async () => { out.workspaces += 1; return 'ws-92'; },
    sendFn: async (/** @type {{ text: string }} */ p) => { out.sent = p.text; },
    ocrSpecFn: (/** @type {any} */ params) => { out.ocrParams = params; return ocrSpecFn(params); },
  });
  return { out, deps };
}

const sentPrompt = () => readFileSync(promptFilePath('sid-92'), 'utf-8');

after(() => rmSync(HOME, { recursive: true, force: true }));

describe('KODO-92 — kodo review start con la sección OCR', () => {
  it('OCR contesta: el fichero de prompt lleva la sección y --json lo dice', async () => {
    const section = `${OCR_SECTION_HEADING}\n\n- \`impacts/views.py\` (modified, +1 −0)\n\n`;
    const { out, deps } = harness(() => ({ ok: true, section }));
    const code = await runReviewStartCli('ITCLIP-1', { json: true }, deps);

    assert.equal(code, 0, out.stderr);
    assert.ok(out.sent.startsWith('KODO_REVIEWER=1 '));
    assert.ok(out.sent.endsWith(`"$(cat ${promptFilePath('sid-92')})"`), out.sent);
    assert.ok(sentPrompt().includes(OCR_SECTION_HEADING), 'la sección viaja en el fichero de prompt');
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
    assert.ok(!sentPrompt().includes(OCR_SECTION_HEADING));
    assert.equal(out.stderr.trim().split('\n').length, 1, `una sola línea:\n${out.stderr}`);
    assert.match(out.stderr, /^OCR: .*\(ocr-missing\)/);
    assert.equal(JSON.parse(out.stdout).ocr, 'ocr-missing');
  });
});

describe('KODO-110 — kodo review start: el prompt va por fichero', () => {
  it('la línea tecleada mide menos de 3500 bytes aunque el prompt pese 200 KB', async () => {
    const section = `${OCR_SECTION_HEADING}\n\n${'x'.repeat(200_000)}\n\n`;
    const { out, deps } = harness(() => ({ ok: true, section }));
    const code = await runReviewStartCli('ITCLIP-1', { json: true }, deps);

    assert.equal(code, 0, out.stderr);
    assert.ok(Buffer.byteLength(sentPrompt()) > 200_000, 'el prompt completo está en el fichero');
    const bytes = Buffer.byteLength(out.sent);
    assert.ok(bytes < 3500, `línea tecleada de ${bytes} bytes`);
    assert.ok(!out.sent.includes(OCR_SECTION_HEADING), 'el prompt no viaja en la línea');
  });

  it('si el fichero no se puede escribir, sale con error y sin crear el workspace', async () => {
    const notADir = join(HOME, 'no-es-un-directorio');
    writeFileSync(notADir, '');
    const { out, deps } = harness(() => ({ ok: false, reason: 'no-rule' }));
    process.env.TMPDIR = notADir;
    try {
      const code = await runReviewStartCli('ITCLIP-1', { json: true }, deps);
      assert.equal(code, 1);
      assert.equal(out.workspaces, 0, 'no deja un workspace vacío');
      assert.equal(out.sent, '');
      assert.match(out.stderr, /No se pudo lanzar la sesión de revisión/);
    } finally {
      process.env.TMPDIR = HOME;
    }
  });
});
