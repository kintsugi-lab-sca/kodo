// @ts-check
//
// test/skill-worktree-cleanup-sessions.test.js — limpieza de worktrees de sesión.
//
// Ejercita `.claude/skills/worktree-cleanup/sessions.py` de punta a punta contra repos
// temporales: un remoto bare, un clon con cinco worktrees en `.claude/worktrees/<sid>`,
// un HOME falso con `~/.kodo/{state,projects}.json` y un Plane falso en 127.0.0.1.
// Cada worktree rompe UNA sola condición (salvo el borrable, que cumple las cuatro),
// así que el veredicto de cada uno prueba esa condición aislada.
//
// El Plane falso vive en este proceso, así que el script se lanza con `execFile`
// asíncrono: un `spawnSync` bloquearía el event loop y el servidor no respondería.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const SCRIPT = fileURLToPath(new URL('../.claude/skills/worktree-cleanup/sessions.py', import.meta.url));
const HAS_PYTHON = spawnSync('python3', ['--version']).status === 0;

const PID = 'proj-1';
const SID = {
  ok: 'aaaaaaaa-0000-0000-0000-000000000001',
  ahead: 'aaaaaaaa-0000-0000-0000-000000000002',
  dirty: 'aaaaaaaa-0000-0000-0000-000000000003',
  live: 'aaaaaaaa-0000-0000-0000-000000000004',
  unknown: 'aaaaaaaa-0000-0000-0000-000000000005',
};
const GIT_ENV = {
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  GIT_CONFIG_NOSYSTEM: '1',
};

describe('worktree-cleanup/sessions.py', { skip: !HAS_PYTHON && 'python3 no disponible' }, () => {
  /** @type {string} */ let root;
  /** @type {string} */ let home;
  /** @type {string} */ let repo;
  /** @type {import('node:http').Server} */ let plane;
  /** @type {Record<string, string>} */ let env;

  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...args) =>
    execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
  const wt = (/** @type {string} */ sid) => join(repo, '.claude', 'worktrees', sid);
  const run = async (/** @type {string[]} */ ...args) =>
    (await promisify(execFile)('python3', ['-I', SCRIPT, '--repo', repo, ...args], { env, encoding: 'utf8' })).stdout;
  const line = (/** @type {string} */ out, /** @type {string} */ sid) => out.split('\n').find((l) => l.includes(sid)) ?? '';

  before(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'kodo-wt-cleanup-')));
    home = join(root, 'home');
    repo = join(root, 'repo');
    mkdirSync(join(home, '.kodo'), { recursive: true });

    // Plane falso: todas las tareas en Done.
    plane = createServer((req, res) => {
      const url = req.url ?? '';
      let body;
      if (/\/projects\/$/.test(url.split('?')[0])) body = { results: [{ id: PID, identifier: 'TST' }] };
      else if (url.includes('/states/')) body = { results: [{ id: 'st-done', group: 'completed', name: 'Done' }] };
      else if (url.includes('/work-items/')) body = { id: 'x', state: 'st-done', sequence_id: 1 };
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
    });
    await new Promise((r) => plane.listen(0, '127.0.0.1', () => r(undefined)));
    const port = /** @type {import('node:net').AddressInfo} */ (plane.address()).port;

    env = {
      PATH: process.env.PATH ?? '', HOME: home, ...GIT_ENV,
      PLANE_API_KEY: 'test', PLANE_BASE_URL: `http://127.0.0.1:${port}`, PLANE_WORKSPACE_SLUG: 'ws',
    };

    // Remoto bare + clon con un commit en main.
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(root, 'remote.git')], { env: { ...process.env, ...env } });
    execFileSync('git', ['clone', '-q', join(root, 'remote.git'), repo], { env: { ...process.env, ...env } });
    writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.env\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'init');
    git(repo, 'push', '-q', 'origin', 'main');

    for (const sid of Object.values(SID)) git(repo, 'worktree', 'add', '-q', '-b', `worktree-${sid}`, wt(sid), 'main');
    // ok: solo ignorados regenerables (node_modules) — no deben impedir el borrado.
    mkdirSync(join(wt(SID.ok), 'node_modules', 'x'), { recursive: true });
    writeFileSync(join(wt(SID.ok), 'node_modules', 'x', 'index.js'), '');
    // ahead: un commit propio que no está en origin/main.
    writeFileSync(join(wt(SID.ahead), 'nuevo.txt'), 'x');
    git(wt(SID.ahead), 'add', '.');
    git(wt(SID.ahead), 'commit', '-q', '-m', 'propio');
    // dirty: un fichero modificado (su línea porcelain empieza por espacio) y otro sin seguimiento.
    writeFileSync(join(wt(SID.dirty), '.gitignore'), 'node_modules/\n');
    writeFileSync(join(wt(SID.dirty), 'informe.md'), 'x');

    const row = (/** @type {string} */ sid, /** @type {string} */ ref) =>
      ({ session_id: sid, task_id: `task-${ref}`, task_ref: ref, project_id: PID });
    writeFileSync(join(home, '.kodo', 'projects.json'), JSON.stringify({ [PID]: repo }));
    writeFileSync(join(home, '.kodo', 'state.json'), JSON.stringify({
      sessions: { 'task-TST-4': row(SID.live, 'TST-4') },
      history: [row(SID.ok, 'TST-1'), row(SID.ahead, 'TST-2'), row(SID.dirty, 'TST-3')],
    }));
  });

  after(() => {
    plane?.close();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('sin --apply solo simula: lista veredictos y no borra nada', async () => {
    const out = await run();
    assert.match(out, /SIMULACIÓN/);
    assert.match(line(out, SID.ok), /\*\*BORRABLE\*\*/);
    assert.match(line(out, SID.ahead), /SE CONSERVA.*commits propios: 1 sobre origin\/main/);
    assert.match(line(out, SID.dirty), /SE CONSERVA.*sucio: 2 sin commit \(\.gitignore, informe\.md\)/);
    assert.match(line(out, SID.live), /SE CONSERVA.*sesión viva en state\.json \(TST-4\)/);
    assert.match(line(out, SID.unknown), /SE CONSERVA.*tarea no identificada/);
    for (const sid of Object.values(SID)) assert.ok(existsSync(wt(sid)), `${sid} no debe borrarse en simulación`);
    assert.match(out, /1 borrables, 4 se conservan/);
  });

  it('con --apply borra solo el que cumple las cuatro condiciones, con su rama', async () => {
    const out = await run('--apply');
    assert.match(line(out, SID.ok), /\*\*BORRADO\*\*/);
    assert.ok(!existsSync(wt(SID.ok)), 'el worktree borrable debe desaparecer');
    assert.equal(git(repo, 'branch', '--list', `worktree-${SID.ok}`), '', 'su rama local también');
    for (const sid of [SID.ahead, SID.dirty, SID.live, SID.unknown]) {
      assert.ok(existsSync(wt(sid)), `${sid} debe conservarse`);
      assert.notEqual(git(repo, 'branch', '--list', `worktree-${sid}`), '', `rama de ${sid} intacta`);
    }
    assert.ok(existsSync(join(wt(SID.dirty), 'informe.md')), 'el fichero sin commit sigue ahí');
  });

  it('falla cerrado si Plane no responde', async () => {
    const saved = env.PLANE_BASE_URL;
    env.PLANE_BASE_URL = 'http://127.0.0.1:1';
    try {
      const out = await run();
      assert.match(line(out, SID.ahead), /SE CONSERVA.*Plane no responde/);
      assert.match(out, /0 borrables/);
    } finally {
      env.PLANE_BASE_URL = saved;
    }
  });
});
