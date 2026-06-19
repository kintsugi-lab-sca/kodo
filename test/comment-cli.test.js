// @ts-check
//
// test/comment-cli.test.js — Tests para el thin CLI handler `runCommentCli`
// de `src/cli/comment.js` (Phase 60, BIDIR-F2 — backfill enrichment).
//
// El handler es thin: reusa el método FROZEN-9 `addComment` y el backstop
// `sanitizeAdoptionData` (BIDIR-08). Aquí verificamos SOLO la capa
// argv → validación → resolución provider → getTask → sanitize → addComment
// → render → exit code.
//
// Cobertura:
//   - input vacío (ref/body) → INVALID_INPUT exit 1, provider NUNCA tocado.
//   - happy path → getTask + addComment llamados; exit 0; render ok.
//   - body saneado (BIDIR-08): rutas absolutas / home redactados ANTES del POST.
//   - getTask falla → FETCH_FAILED exit 2 (transient); addComment NO llamado.
//   - addComment falla → POST_FAILED exit 2 (transient).
//   - --json byte-determinista, parseable, SIN ANSI con formatter TTY inyectado.
//   - Wiring estático en src/cli.js (command('comment') + import + runCommentCli).
//
// DI: cada test inyecta deps (getProviderFn, sanitizeFn opcional, writeFn/errFn,
// formatterFn) → cero I/O real (registry, network).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runCommentCli } from '../src/cli/comment.js';

/** Formatter plano (sin ANSI) para asertar contenido determinista. */
const plainFmt = () => ({
  ok: (/** @type {string} */ s) => s,
  green: (/** @type {string} */ s) => s,
  red: (/** @type {string} */ s) => s,
  yellow: (/** @type {string} */ s) => s,
});

/** Captura write/err en buffers. */
function makeIO() {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    writeFn: (/** @type {string} */ s) => { out.stdout += s; },
    errFn: (/** @type {string} */ s) => { out.stderr += s; },
    formatterFn: plainFmt,
  };
}

describe('runCommentCli — input validation (INVALID_INPUT)', () => {
  it('ref vacío → exit 1, provider nunca tocado', async () => {
    const io = makeIO();
    let providerTouched = false;
    const code = await runCommentCli(
      { ref: '   ', body: 'resumen' },
      { ...io, getProviderFn: () => { providerTouched = true; return {}; } },
    );
    assert.equal(code, 1);
    assert.equal(providerTouched, false);
    assert.match(io.out.stderr, /INVALID_INPUT.*ref/);
  });

  it('body vacío → exit 1, provider nunca tocado', async () => {
    const io = makeIO();
    let providerTouched = false;
    const code = await runCommentCli(
      { ref: 'ROMAN-192', body: '   ' },
      { ...io, getProviderFn: () => { providerTouched = true; return {}; } },
    );
    assert.equal(code, 1);
    assert.equal(providerTouched, false);
    assert.match(io.out.stderr, /INVALID_INPUT.*body/);
  });
});

describe('runCommentCli — happy path', () => {
  it('getTask + addComment llamados; exit 0; render ok', async () => {
    const io = makeIO();
    const calls = { getTask: /** @type {string[]} */ ([]), addComment: /** @type {any[]} */ ([]) };
    const task = { ref: 'ROMAN-192', url: 'https://plane/ROMAN-192', title: 'x' };
    const provider = {
      getTask: async (/** @type {string} */ ref) => { calls.getTask.push(ref); return task; },
      addComment: async (/** @type {any} */ t, /** @type {string} */ body) => { calls.addComment.push({ t, body }); },
    };
    const code = await runCommentCli(
      { ref: 'ROMAN-192', body: 'Trabajo: refactor del poller' },
      { ...io, getProviderFn: () => provider },
    );
    assert.equal(code, 0);
    assert.deepEqual(calls.getTask, ['ROMAN-192']);
    assert.equal(calls.addComment.length, 1);
    assert.equal(calls.addComment[0].t, task);
    assert.match(io.out.stdout, /Commented/);
    assert.match(io.out.stdout, /ROMAN-192/);
  });
});

describe('runCommentCli — BIDIR-08 sanitization backstop', () => {
  it('rutas absolutas / home redactados ANTES del POST', async () => {
    const io = makeIO();
    let posted = '';
    const provider = {
      getTask: async () => ({ ref: 'KL-1', url: null, title: 't' }),
      addComment: async (/** @type {any} */ _t, /** @type {string} */ body) => { posted = body; },
    };
    // sanitizeFn inyectado para no depender del home real de la máquina de CI.
    const sanitizeFn = (/** @type {{description?: string}} */ { description }) => ({
      title: '',
      description: (description ?? '').replace(/\/Users\/[^/\s]+\/[^\s]*/g, '<path>'),
    });
    const code = await runCommentCli(
      { ref: 'KL-1', body: 'edité /Users/alex/dev/secreto/file.js hoy' },
      { ...io, getProviderFn: () => provider, sanitizeFn },
    );
    assert.equal(code, 0);
    assert.doesNotMatch(posted, /\/Users\/alex/);
    assert.match(posted, /<path>/);
  });

  it('usa el sanitizeAdoptionData real por defecto (no lanza)', async () => {
    const io = makeIO();
    let posted = null;
    const provider = {
      getTask: async () => ({ ref: 'KL-2', url: null, title: 't' }),
      addComment: async (/** @type {any} */ _t, /** @type {string} */ body) => { posted = body; },
    };
    const code = await runCommentCli(
      { ref: 'KL-2', body: 'resumen sin rutas' },
      { ...io, getProviderFn: () => provider },
    );
    assert.equal(code, 0);
    assert.equal(posted, 'resumen sin rutas');
  });
});

describe('runCommentCli — transient failures (exit 2)', () => {
  it('getTask falla → FETCH_FAILED exit 2; addComment NO llamado', async () => {
    const io = makeIO();
    let addCalled = false;
    const provider = {
      getTask: async () => { throw new Error('network down'); },
      addComment: async () => { addCalled = true; },
    };
    const code = await runCommentCli(
      { ref: 'KL-3', body: 'resumen' },
      { ...io, getProviderFn: () => provider },
    );
    assert.equal(code, 2);
    assert.equal(addCalled, false);
    assert.match(io.out.stderr, /FETCH_FAILED/);
  });

  it('addComment falla → POST_FAILED exit 2', async () => {
    const io = makeIO();
    const provider = {
      getTask: async () => ({ ref: 'KL-4', url: null, title: 't' }),
      addComment: async () => { throw new Error('403'); },
    };
    const code = await runCommentCli(
      { ref: 'KL-4', body: 'resumen' },
      { ...io, getProviderFn: () => provider },
    );
    assert.equal(code, 2);
    assert.match(io.out.stderr, /POST_FAILED/);
  });
});

describe('runCommentCli — --json byte-determinista', () => {
  it('emite JSON parseable, sin ANSI, con formatter TTY inyectado', async () => {
    const io = makeIO();
    const ansiFmt = () => ({
      ok: (/** @type {string} */ s) => `[32m${s}[0m`,
      green: (/** @type {string} */ s) => `[32m${s}[0m`,
      red: (/** @type {string} */ s) => `[31m${s}[0m`,
      yellow: (/** @type {string} */ s) => `[33m${s}[0m`,
    });
    const provider = {
      getTask: async () => ({ ref: 'KL-5', url: 'https://x/KL-5', title: 't' }),
      addComment: async () => {},
    };
    const code = await runCommentCli(
      { ref: 'KL-5', body: 'resumen', json: true },
      { ...io, getProviderFn: () => provider, formatterFn: ansiFmt },
    );
    assert.equal(code, 0);
    assert.doesNotMatch(io.out.stdout, /\[/); // sin ANSI
    const parsed = JSON.parse(io.out.stdout);
    assert.deepEqual(parsed, { ok: true, ref: 'KL-5', task_url: 'https://x/KL-5' });
  });
});

describe('src/cli.js — comment command registration (static)', () => {
  const cli = readFileSync('src/cli.js', 'utf-8');

  it('CLI1: registra .command("comment <ref>")', () => {
    assert.ok(cli.includes("command('comment <ref>')"), "expected literal command('comment <ref>')");
  });

  it('CLI2: importa dinámicamente ./cli/comment.js', () => {
    assert.ok(cli.includes("import('./cli/comment.js')"), "expected literal import('./cli/comment.js')");
  });

  it('CLI3: invoca runCommentCli', () => {
    assert.ok(cli.includes('runCommentCli'), 'expected runCommentCli identifier');
  });

  it('CLI4: registra --body como requiredOption', () => {
    assert.ok(cli.includes("'--body <text>'"), 'expected --body option declaration');
  });
});
