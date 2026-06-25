// @ts-check
//
// test/dashboard/enrich.test.js — Phase 62 Plan 01 (ORCH-02).
//
// Suite unit del derivador LLM one-shot never-throws de `src/cli/dashboard/enrich.js`.
// TODO se inyecta por DI (`spawnFn` / `readFileFn` / `existsSyncFn`) → NINGÚN test invoca
// el binario `claude` real ni `child_process` real. Mapea 1:1 a las filas ORCH-02 de
// 62-VALIDATION.md §Per-Task Verification Map.
//
// Moldes reusados:
//   - fakeExec `(cmd, args, opts, cb)` con `setImmediate(() => cb(...))` — adopt.test.js:51-54
//   - leak-guard `assert.rejects(TypeError)` — adopt.test.js (escenario 5)
//   - sync-throw never-throws (NO reject) — adopt.test.js (escenario 4)
//   - existsSyncFn / readFileFn fakes capturadores — test/adopt.test.js:437

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  deriveAdoptionMeta,
  spawnDerive,
  firstUserPrompt,
} from '../../src/cli/dashboard/enrich.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

const CWD = '/home/op/projects/kodo';
const SESSION_ID = 'sess-abc123';

/** Fake spawn feliz: envelope JSON con result = JSON estricto {title, description}. */
function okExec(title, description) {
  return (cmd, args, opts, cb) => {
    const result = JSON.stringify({ title, description });
    const envelope = JSON.stringify({ type: 'result', is_error: false, result });
    setImmediate(() => cb(null, envelope, ''));
  };
}

// ───────────────────────────────────────────────────────────── spawnDerive

describe('Phase 62 Plan 01: spawnDerive — parse del envelope + fail-open a {}', () => {
  it('envelope feliz → { title, description } (trim aplicado)', async () => {
    const out = await spawnDerive({ spawnFn: okExec('X scope', 'Y'), prompt: 'p' });
    assert.deepEqual(out, { title: 'X scope', description: 'Y' });
  });

  it('is_error:true → {}', async () => {
    const spawnFn = (cmd, args, opts, cb) => {
      const envelope = JSON.stringify({ type: 'result', is_error: true, result: '' });
      setImmediate(() => cb(null, envelope, ''));
    };
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });

  it('stdout no-JSON → {}', async () => {
    const spawnFn = (cmd, args, opts, cb) => setImmediate(() => cb(null, 'not json at all', ''));
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });

  it('result no-JSON (result:"not json") → {}', async () => {
    const spawnFn = (cmd, args, opts, cb) => {
      const envelope = JSON.stringify({ type: 'result', is_error: false, result: 'not json' });
      setImmediate(() => cb(null, envelope, ''));
    };
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });

  it('cb con ENOENT (claude ausente en PATH) → {}', async () => {
    const err = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const spawnFn = (cmd, args, opts, cb) => setImmediate(() => cb(err, '', ''));
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });

  it('cb con killed:true (timeout) → {}', async () => {
    const err = Object.assign(new Error('killed'), { killed: true });
    const spawnFn = (cmd, args, opts, cb) => setImmediate(() => cb(err, '', ''));
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });

  it('spawnFn sync-throw → {} (never-throws, NO reject)', async () => {
    const spawnFn = () => {
      throw new Error('boom');
    };
    // Si la promise rechazara, este await lanzaría → el test fallaría. Assert: resuelve a {}.
    const out = await spawnDerive({ spawnFn, prompt: 'p' });
    assert.deepEqual(out, {});
  });

  it('omitir spawnFn → TypeError (leak guard estructural, no fallback silencioso)', async () => {
    await assert.rejects(
      async () => spawnDerive({ prompt: 'p' }),
      (e) => e instanceof TypeError,
    );
  });

  it('title/description con metacaracteres → un solo arg literal en argv (injection-inerte D-13)', async () => {
    /** @type {{ cmd: string, args: string[] } | undefined} */
    let captured;
    const hostile = 'rm -rf / ; $(whoami) `id` && echo "x"';
    const spawnFn = (cmd, args, opts, cb) => {
      captured = { cmd, args };
      setImmediate(() => cb(null, JSON.stringify({ type: 'result', is_error: false, result: '{}' }), ''));
    };
    await spawnDerive({ spawnFn, prompt: hostile });
    assert.ok(captured, 'spawnFn debe invocarse');
    assert.equal(captured.cmd, 'claude', "el binario se resuelve por PATH ('claude'), NO config.claude.binary");
    // El prompt hostil viaja como UN solo elemento argv literal (el último), no se parte ni interpola.
    assert.equal(captured.args[captured.args.length - 1], hostile);
    assert.ok(captured.args.includes('--json-schema'), 'usa --json-schema');
    assert.ok(captured.args.includes('claude-haiku-4-5'), 'usa el modelo haiku');
  });

  it('result válido pero sin title/description → {} (sin campos vacíos)', async () => {
    const spawnFn = (cmd, args, opts, cb) => {
      const envelope = JSON.stringify({ type: 'result', is_error: false, result: JSON.stringify({ title: '   ' }) });
      setImmediate(() => cb(null, envelope, ''));
    };
    assert.deepEqual(await spawnDerive({ spawnFn, prompt: 'p' }), {});
  });
});

// ──────────────────────────────────────────────────────── firstUserPrompt

describe('Phase 62 Plan 01: firstUserPrompt — primer prompt real del transcript', () => {
  it('primer user en línea variable (≥3): salta queue-operation y no-user', () => {
    const readFileFn = () => readFileSync(join(FIXTURES, 'transcript-variable-line.jsonl'), 'utf8');
    const out = firstUserPrompt({ cwd: CWD, sessionId: SESSION_ID, readFileFn });
    assert.equal(out, 'Refactor the auth module to use the new token rotation');
  });

  it('content array tool_result-only → saltado; toma el siguiente user con texto real', () => {
    const readFileFn = () => readFileSync(join(FIXTURES, 'transcript-tool-result-only.jsonl'), 'utf8');
    const out = firstUserPrompt({ cwd: CWD, sessionId: SESSION_ID, readFileFn });
    assert.equal(out, 'Now add input validation to the parser');
  });

  it('content string → extrae texto directo', () => {
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: 'just a string prompt' } });
    const readFileFn = () => line + '\n';
    assert.equal(firstUserPrompt({ cwd: CWD, sessionId: SESSION_ID, readFileFn }), 'just a string prompt');
  });

  it('cap a 1500 chars', () => {
    const big = 'a'.repeat(5000);
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content: big } });
    const readFileFn = () => line + '\n';
    const out = firstUserPrompt({ cwd: CWD, sessionId: SESSION_ID, readFileFn });
    assert.equal(out.length, 1500);
  });

  it('transcript ausente (readFileFn throw ENOENT) → ""', () => {
    const readFileFn = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    assert.equal(firstUserPrompt({ cwd: CWD, sessionId: SESSION_ID, readFileFn }), '');
  });
});

// ────────────────────────────────────────────────────── deriveAdoptionMeta

describe('Phase 62 Plan 01: deriveAdoptionMeta — rama GSD vs non-GSD (never-throws)', () => {
  it('rama GSD (existsSyncFn=true): lee .planning/{PROJECT,ROADMAP,STATE}.md y deriva', async () => {
    const readPaths = [];
    const readFileFn = (p) => {
      readPaths.push(p);
      return `content of ${p}`;
    };
    const existsSyncFn = () => true; // isGsdProject → true
    const out = await deriveAdoptionMeta({
      spawnFn: okExec('Derived GSD title', 'Derived GSD desc'),
      readFileFn,
      existsSyncFn,
      cwd: CWD,
      sessionId: SESSION_ID,
    });
    assert.deepEqual(out, { title: 'Derived GSD title', description: 'Derived GSD desc' });
    // Los 3 archivos de memoria GSD fueron leídos.
    const planning = join(CWD, '.planning');
    assert.ok(readPaths.includes(join(planning, 'PROJECT.md')), 'lee PROJECT.md');
    assert.ok(readPaths.includes(join(planning, 'ROADMAP.md')), 'lee ROADMAP.md');
    assert.ok(readPaths.includes(join(planning, 'STATE.md')), 'lee STATE.md');
  });

  it('rama non-GSD (existsSyncFn=false): usa git log (spawnFn git) + firstUserPrompt', async () => {
    /** @type {string[][]} */
    const gitCalls = [];
    const readFileFn = () =>
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'the user intent here' } }) + '\n';
    const existsSyncFn = () => false; // isGsdProject → false
    // spawnFn maneja DOS comandos: 'git' (log) y 'claude' (derive).
    const spawnFn = (cmd, args, opts, cb) => {
      if (cmd === 'git') {
        gitCalls.push(args);
        setImmediate(() => cb(null, 'abc123 some commit\ndef456 another commit\n', ''));
        return;
      }
      // claude
      const result = JSON.stringify({ title: 'NonGSD title', description: 'NonGSD desc' });
      setImmediate(() => cb(null, JSON.stringify({ type: 'result', is_error: false, result }), ''));
    };
    const out = await deriveAdoptionMeta({
      spawnFn,
      readFileFn,
      existsSyncFn,
      cwd: CWD,
      sessionId: SESSION_ID,
    });
    assert.deepEqual(out, { title: 'NonGSD title', description: 'NonGSD desc' });
    assert.ok(gitCalls.length >= 1, 'git log fue invocado en la rama non-GSD');
    assert.ok(
      gitCalls.some((args) => args.includes('log')),
      'git fue invocado con el subcomando log',
    );
  });

  it('never-throws: cualquier excepción interna → {} (fail-open total)', async () => {
    const spawnFn = () => {
      throw new Error('boom');
    };
    const readFileFn = () => {
      throw new Error('fs boom');
    };
    const existsSyncFn = () => {
      throw new Error('exists boom');
    };
    const out = await deriveAdoptionMeta({
      spawnFn,
      readFileFn,
      existsSyncFn,
      cwd: CWD,
      sessionId: SESSION_ID,
    });
    assert.deepEqual(out, {});
  });
});
