// @ts-check
//
// test/skill-sync.test.js — Phase 21 D-01..D-09 coverage.
//
// Cubre:
//   - syncSkill (unit, in-process): 8 escenarios → first-sync, noop, single-file
//     diff, symlink legacy replaced, prune default preserva, prune=true borra +
//     warn, source sin skill.md (error), walker recursivo 3 niveles.
//   - runSkillSyncCli (integration spawnSync `bin/kodo skill sync`): 4 escenarios
//     SKILL-04 (ok / noop / fs error / not a kodo repo) + symlink CLI + --json
//     byte-deterministic + --prune + source-hygiene grep (D-08b color isolation +
//     único importer del CLI handler — el orchestrator launch.js lo añade Plan 02).
//
// Patrón: spawnSync child + HOME override + NO_COLOR=1 (canon Phase 999.1 D-16,
// `test/skill-auto-commit.test.js`). makeFixture siembra DOS tmpdirs (HOME + repo
// con skill canonical) y un afterEach común limpia ambos con chmod restore.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync,
  lstatSync, symlinkSync, chmodSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkill } from '../src/skill/sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Crea DOS tmpdirs (HOME aislado + fake repo kodo con skill canonical sembrada).
 * NO requiere git init (skill sync no toca git).
 */
function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const skillDir = join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'skill.md'),
    '# kodo:orchestrate\n\nCanonical body v1.\n',
    'utf-8',
  );
  mkdirSync(join(skillDir, 'subdir'), { recursive: true });
  writeFileSync(join(skillDir, 'subdir', 'extra.md'), 'extra content\n', 'utf-8');

  return { tmpHome, tmpRepo, skillDir };
}

function destOf(tmpHome) {
  return join(tmpHome, '.claude', 'skills', 'kodo-orchestrate');
}

function sourceOf(tmpRepo) {
  return join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate');
}

/**
 * Spawn `bin/kodo skill sync [...args]` con HOME aislado + NO_COLOR=1.
 * timeout 10s (DoS mitigation Phase 999.1 T-04-03).
 */
function runCli({ tmpHome, tmpRepo, args = [], cwd }) {
  return spawnSync(
    process.execPath,
    [KODO_BIN, 'skill', 'sync', ...args],
    {
      cwd: cwd ?? tmpRepo,
      env: { ...process.env, HOME: tmpHome, NO_COLOR: '1' },
      encoding: 'utf-8',
      timeout: 10000,
    },
  );
}

// stripComments verbatim de test/dispatcher-isolation.test.js:24-30 — filtra
// comentarios para asserts source-hygiene sobre código (no documentación).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

// ─── Suite 1: syncSkill (unit, in-process) ──────────────────────────────────

describe('syncSkill (unit, in-process)', () => {
  let _tmpHome;
  let _tmpRepo;

  afterEach(() => {
    if (_tmpHome) {
      // chmod restore por si el test forzó read-only en dest.
      try { chmodSync(destOf(_tmpHome), 0o755); } catch {}
      rmSync(_tmpHome, { recursive: true, force: true });
    }
    if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
    _tmpHome = undefined;
    _tmpRepo = undefined;
  });

  it('Test 1: happy path first-sync → status=ok, files_changed=2, archivos copiados byte-idénticos', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    const result = syncSkill({ source, dest });

    assert.equal(result.status, 'ok');
    assert.equal(result.files_changed, 2);
    assert.equal(result.symlink_replaced, undefined);
    assert.equal(existsSync(join(dest, 'skill.md')), true);
    assert.equal(
      readFileSync(join(dest, 'skill.md'), 'utf-8'),
      '# kodo:orchestrate\n\nCanonical body v1.\n',
    );
    assert.equal(readFileSync(join(dest, 'subdir', 'extra.md'), 'utf-8'), 'extra content\n');
  });

  it('Test 2: noop sin drift → segundo run status=noop, files_changed=0', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    syncSkill({ source, dest });
    const second = syncSkill({ source, dest });

    assert.equal(second.status, 'noop');
    assert.equal(second.files_changed, 0);
  });

  it('Test 3: single-file diff → status=ok, files_changed=1', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    syncSkill({ source, dest });
    // Modificar solo skill.md en source.
    writeFileSync(join(source, 'skill.md'), '# kodo:orchestrate\n\nCanonical body v2.\n', 'utf-8');

    const second = syncSkill({ source, dest });
    assert.equal(second.status, 'ok');
    assert.equal(second.files_changed, 1);
    // El otro archivo NO se retocó (mismo contenido).
    assert.equal(readFileSync(join(dest, 'subdir', 'extra.md'), 'utf-8'), 'extra content\n');
    // Y skill.md ahora tiene el contenido v2.
    assert.equal(
      readFileSync(join(dest, 'skill.md'), 'utf-8'),
      '# kodo:orchestrate\n\nCanonical body v2.\n',
    );
  });

  it('Test 4: symlink legacy → reemplazado por dir real, symlink_replaced=true', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);
    // Asegurar que el parent existe pero el dest aún no, luego crear symlink dangling.
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync('/nonexistent/path/to/old/skill', dest);
    assert.equal(lstatSync(dest).isSymbolicLink(), true);

    const result = syncSkill({ source, dest });

    assert.equal(result.status, 'ok');
    assert.equal(result.symlink_replaced, true);
    assert.equal(result.files_changed, 2);
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
    assert.equal(lstatSync(dest).isDirectory(), true);
    assert.equal(
      readFileSync(join(dest, 'skill.md'), 'utf-8'),
      '# kodo:orchestrate\n\nCanonical body v1.\n',
    );
  });

  it('Test 5: prune=false default → foráneos preservados, files_pruned=undefined', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    syncSkill({ source, dest });
    // Añadir archivo foráneo en dest.
    writeFileSync(join(dest, 'foreign.md'), 'local override\n', 'utf-8');

    const second = syncSkill({ source, dest });
    assert.equal(second.status, 'noop');
    assert.equal(second.files_pruned, undefined);
    assert.equal(existsSync(join(dest, 'foreign.md')), true);
    assert.equal(readFileSync(join(dest, 'foreign.md'), 'utf-8'), 'local override\n');
  });

  it('Test 6: prune=true → foráneo borrado con console.warn previo', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    syncSkill({ source, dest });
    writeFileSync(join(dest, 'foreign.md'), 'local override\n', 'utf-8');

    // Capturar console.warn temporalmente.
    /** @type {string[]} */
    const warns = [];
    const origWarn = console.warn;
    console.warn = (msg) => { warns.push(String(msg)); };
    let second;
    try {
      second = syncSkill({ source, dest, prune: true });
    } finally {
      console.warn = origWarn;
    }

    assert.equal(second.files_pruned, 1);
    assert.equal(existsSync(join(dest, 'foreign.md')), false);
    assert.ok(
      warns.some((w) => /\[kodo skill sync --prune\] removing foreign: foreign\.md/.test(w)),
      `expected canonical warn, got: ${JSON.stringify(warns)}`,
    );
  });

  it('Test 7: source sin skill.md → status=error, error matches /source skill not found/', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    // Borrar skill.md del source para forzar error.
    rmSync(join(sourceOf(_tmpRepo), 'skill.md'), { force: true });

    const result = syncSkill({ source: sourceOf(_tmpRepo), dest: destOf(_tmpHome) });
    assert.equal(result.status, 'error');
    assert.match(result.error || '', /source skill not found/);
  });

  it('Test 8: walker recursivo 3 niveles → files_changed=3 en primer run', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    // Sembrar tercer nivel.
    mkdirSync(join(source, 'subdir', 'nested'), { recursive: true });
    writeFileSync(join(source, 'subdir', 'nested', 'b.md'), 'nested content\n', 'utf-8');

    const result = syncSkill({ source, dest: destOf(_tmpHome) });
    assert.equal(result.status, 'ok');
    assert.equal(result.files_changed, 3);
    assert.equal(
      readFileSync(join(destOf(_tmpHome), 'subdir', 'nested', 'b.md'), 'utf-8'),
      'nested content\n',
    );
  });
});

// ─── Suite 2: runSkillSyncCli (integration spawnSync) ────────────────────────

describe('runSkillSyncCli (integration spawnSync `bin/kodo skill sync`)', () => {
  let _tmpHome;
  let _tmpRepo;

  afterEach(() => {
    if (_tmpHome) {
      try { chmodSync(destOf(_tmpHome), 0o755); } catch {}
      rmSync(_tmpHome, { recursive: true, force: true });
    }
    if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
    _tmpHome = undefined;
    _tmpRepo = undefined;
  });

  it('SKILL-04 #1: ok (first sync) → exit 0, stdout `Synced 2 files`', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Synced 2 files? to /);
    const dest = destOf(_tmpHome);
    assert.equal(
      readFileSync(join(dest, 'skill.md'), 'utf-8'),
      '# kodo:orchestrate\n\nCanonical body v1.\n',
    );
    assert.equal(readFileSync(join(dest, 'subdir', 'extra.md'), 'utf-8'), 'extra content\n');
  });

  it('SKILL-04 #2: noop (segundo run sin drift) → exit 0, stdout `No drift`', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const first = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(first.status, 0);
    const second = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(second.status, 0);
    assert.match(second.stdout, /No drift/);
  });

  it('SKILL-04 #3: fs error (dest read-only) → exit 1, stderr canonical', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    // Primer run para crear dest, luego chmod 0o500 (read-only) y modificar source.
    const first = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(first.status, 0);
    const dest = destOf(_tmpHome);
    chmodSync(dest, 0o500);
    // Modificar source para forzar copia que fallará por permisos.
    writeFileSync(
      join(sourceOf(_tmpRepo), 'skill.md'),
      '# kodo:orchestrate\n\nCanonical body v2.\n',
      'utf-8',
    );

    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    // afterEach restaura permisos antes del rmSync (chmod 0o755).
    assert.equal(result.status, 1, `stdout: ${result.stdout}, stderr: ${result.stderr}`);
    assert.match(result.stderr, /^Error: filesystem error: /);
  });

  it('SKILL-04 #4: not a kodo repo → exit 2 + stderr canonical exacto', () => {
    ({ tmpHome: _tmpHome } = makeFixture());
    const emptyCwd = mkdtempSync(join(tmpdir(), 'kodo-not-a-repo-'));
    try {
      const result = runCli({ tmpHome: _tmpHome, tmpRepo: emptyCwd, cwd: emptyCwd });
      assert.equal(result.status, 2);
      assert.equal(
        result.stderr,
        'Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n',
      );
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('D-04 CLI: legacy symlink → reemplazado, stdout contiene `Legacy symlink replaced`', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const dest = destOf(_tmpHome);
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync('/nonexistent/path/to/old/skill', dest);
    assert.equal(lstatSync(dest).isSymbolicLink(), true);

    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Legacy symlink replaced/);
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
    assert.equal(lstatSync(dest).isDirectory(), true);
  });

  it('D-06b --json: byte-deterministic single-line, sin ANSI', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo, args: ['--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /^\{"status":"ok","files_changed":2\}\n$/);
    // No ANSI escapes leak (LOG-12 + DX-06).
    assert.equal(/\x1b\[/.test(result.stdout), false);
  });

  it('D-05 --prune: foráneo borrado, stdout `Pruned 1 foreign file`, stderr warn canonical', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    // First sync para crear dest.
    runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    // Sembrar foráneo.
    writeFileSync(join(destOf(_tmpHome), 'foreign.md'), 'local override\n', 'utf-8');

    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo, args: ['--prune'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Pruned 1 foreign file/);
    assert.match(result.stderr, /\[kodo skill sync --prune\] removing foreign: foreign\.md/);
    assert.equal(existsSync(join(destOf(_tmpHome), 'foreign.md')), false);
  });

  it('D-08b source-hygiene: CLI handler importa solo desde ../skill/sync.js y NO importa picocolors', () => {
    const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
    const stripped = stripComments(cliHandler);

    // Importa syncSkill desde ../skill/sync.js
    assert.match(stripped, /from\s+['"]\.\.\/skill\/sync\.js['"]/);
    // Color isolation: NO importa picocolors directamente (Phase 14 D-07).
    assert.equal(
      /from\s+['"]picocolors['"]/.test(stripped),
      false,
      'src/cli/skill-sync.js no debe importar picocolors directamente — solo createFormatter',
    );
    // El módulo sync.js tampoco importa picocolors.
    const syncMod = readFileSync(join(REPO, 'src', 'skill', 'sync.js'), 'utf-8');
    assert.equal(/picocolors/.test(stripComments(syncMod)), false);
  });
});
