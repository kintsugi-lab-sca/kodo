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
// con skills canonical) y un afterEach común limpia ambos con chmod restore.
//
// Phase 84 (CAPT-05, D-01): `makeFixture` siembra las DOS skills del registro
// `KODO_SKILLS` — `kodo-orchestrate` (2 ficheros, entrypoint `skill.md` en
// minúsculas por D-08) y `kodo-capture` (1 fichero, entrypoint `SKILL.md` en
// mayúsculas). El orden importa: el fixture se amplió ANTES de generalizar el
// handler a multi-skill (84-RESEARCH §Pitfall 1). Sembrar la segunda skill en un
// tmpRepo sintético no tiene efecto sobre un handler single-skill, así que la
// suite sigue verde; lo que evita es descubrir en rojo, de uno en uno, los 6
// asserts anclados al render y al payload single-skill.
//
// Corolario: el agregado de `files_changed` con las dos skills sincronizadas es
// 3 (2 de orchestrate + 1 de capture) — literal del que depende el assert
// byte-anclado de `--json`.

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
import { runSkillSyncCli } from '../src/cli/skill-sync.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Crea DOS tmpdirs (HOME aislado + fake repo kodo con las DOS skills canonical
 * sembradas: `kodo-orchestrate` con 2 ficheros y `kodo-capture` con 1).
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

  // Phase 84 (D-01/D-07): segunda entrada del registro. Entrypoint en MAYÚSCULAS
  // (`SKILL.md`), a diferencia de `kodo-orchestrate` — la asimetría es deliberada
  // y es lo que ejercita el gate case-tolerante. UN SOLO fichero: el agregado de
  // `files_changed` es 2 + 1 = 3, literal del assert byte-anclado de `--json`.
  const captureSkillDir = join(tmpRepo, '.claude', 'skills', 'kodo-capture');
  mkdirSync(captureSkillDir, { recursive: true });
  writeFileSync(
    join(captureSkillDir, 'SKILL.md'),
    '# kodo-capture\n\nCanonical capture body v1.\n',
    'utf-8',
  );

  return { tmpHome, tmpRepo, skillDir, captureSkillDir };
}

function destOf(tmpHome, name = 'kodo-orchestrate') {
  return join(tmpHome, '.claude', 'skills', name);
}

function sourceOf(tmpRepo, name = 'kodo-orchestrate') {
  return join(tmpRepo, '.claude', 'skills', name);
}

// Nombres de las skills que el fixture siembra — usado por los afterEach para
// restaurar permisos de AMBOS destinos antes del rmSync (si un test deja el dest
// de `kodo-capture` en 0o000, el borrado del tmpHome falla).
const FIXTURE_SKILLS = ['kodo-orchestrate', 'kodo-capture'];

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

// ─── Suite 1.5: onConsoleWarn callback DI (ADVISORY-01) ──────────────────────
//
// Phase 31 Plan 01 — cierra Phase 21 WR-04. El callsite del prune foreign-removal
// pasa por el callback cuando se inyecta; default fallback a `console.warn`
// preserva back-compat byte-exact (Test 6 de Suite 1 sigue ejerciendo el path
// default). Test A confirma DI sin mutar `console.warn` global; Test B blinda
// regresión del `?? console.warn` (si alguien rompe el default, Test B falla).

describe('syncSkill onConsoleWarn DI (ADVISORY-01)', () => {
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

  it('Test A: captura warning vía callback sin spy global de console.warn', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    // Sembrar dest sin prune.
    syncSkill({ source, dest });
    // Crear foráneo que prune debe detectar.
    writeFileSync(join(dest, 'foreign.md'), 'local override\n', 'utf-8');

    // Snapshot de console.warn ANTES de la invocación — debe quedar inmutable
    // (verifica que el patrón DI no toca la referencia global).
    const beforeConsoleWarn = console.warn;

    /** @type {string[]} */
    const warns = [];
    const result = syncSkill({
      source,
      dest,
      prune: true,
      onConsoleWarn: (msg) => warns.push(msg),
    });

    // Assert observable: prune se ejecutó + el callback recibió el string.
    assert.equal(result.files_pruned, 1);
    assert.equal(existsSync(join(dest, 'foreign.md')), false);
    assert.equal(warns.length, 1);
    assert.match(warns[0], /\[kodo skill sync --prune\] removing foreign: foreign\.md/);

    // Assert source-hygiene: console.warn REFERENCIA no fue mutada (no se hizo
    // monkey-patch global). El patrón DI evita el spy.
    assert.equal(console.warn, beforeConsoleWarn, 'console.warn debe permanecer intacta');
  });

  it('Test B: default fallback usa console.warn cuando onConsoleWarn no se inyecta (regression guard de `?? console.warn`)', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const source = sourceOf(_tmpRepo);
    const dest = destOf(_tmpHome);

    syncSkill({ source, dest });
    writeFileSync(join(dest, 'foreign.md'), 'local override\n', 'utf-8');

    // Override transitorio de console.warn — patrón Suite 1 Test 6.
    /** @type {string[]} */
    const warns = [];
    const origWarn = console.warn;
    console.warn = (m) => { warns.push(String(m)); };
    let result;
    try {
      // Sin onConsoleWarn — debe caer al default `console.warn`.
      result = syncSkill({ source, dest, prune: true });
    } finally {
      console.warn = origWarn;
    }

    assert.equal(result.files_pruned, 1);
    assert.ok(
      warns.some((w) => /removing foreign/.test(w)),
      `expected default fallback a console.warn, got: ${JSON.stringify(warns)}`,
    );
  });
});

// ─── Suite 1.6: cleanupFn ordering DI (ADVISORY-02) ──────────────────────────
//
// Phase 31 Plan 02 — cierra Phase 21 WR-05. runSkillSyncCli acepta cleanupFn
// como DI dep; cuando se inyecta, el helper try/finally ejecuta await
// cleanupFn() ANTES de retornar el exit code en cada una de las 3 ramas
// (return 0 happy-path, return 1 fs error / result.error, return 2 early-gate
// not-a-kodo-repo). Tests in-process via import directo de runSkillSyncCli
// (NO spawnSync, NO monkey-patch de process.exit). Ordering observable via
// process.hrtime.bigint() — D-06 patrón emergente.
//
// HOME isolation (CR-02): los 3 tests inyectan syncFn stub (o caen en
// early-gate / fs-error path) — NUNCA invocan el syncSkill real, que mutaría
// el HOME del usuario porque dest = homedir() + '.claude/skills/...'.

describe('runSkillSyncCli cleanupFn ordering (ADVISORY-02)', () => {
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

  /**
   * Helper: invoca runSkillSyncCli con cleanupFn que push timestamp + writeFn
   * que también push timestamp (cuando lo provee este helper). El caller puede
   * pasar su propio writeFn (Tests 2/3 lo hacen para silenciar el render que
   * no aplica en sus paths de error).
   */
  async function captureOrdering({ opts, deps, captureWrites = false }) {
    /** @type {Array<{tag: string, t: bigint}>} */
    const ts = [];
    const cleanupFn = async () => {
      // setImmediate fuerza un tick async para diferenciar timestamps
      // observable (nanos resolution evita colisión en máquinas rápidas).
      await new Promise((r) => setImmediate(r));
      ts.push({ tag: 'cleanup', t: process.hrtime.bigint() });
    };
    /** @type {(s: string) => void} */
    const writeFn = captureWrites
      ? (_s) => { ts.push({ tag: 'write', t: process.hrtime.bigint() }); }
      : (deps && deps.writeFn) || (() => {});
    const mergedDeps = { ...deps, cleanupFn, writeFn };
    const code = await runSkillSyncCli(opts, mergedDeps);
    ts.push({ tag: 'return', t: process.hrtime.bigint() });
    return { code, ts };
  }

  it('Test 1 (return 0 happy path): cleanupFn corre DESPUÉS del render y ANTES de return', async () => {
    // HOME isolation: usar syncFn stub para evitar mutar ~/.claude/skills/.
    // El _tmpRepo se conserva sólo para satisfacer el early-gate existsSync.
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { code, ts } = await captureOrdering({
      opts: {},
      deps: {
        cwdFn: () => _tmpRepo,
        syncFn: () => ({ status: 'ok', files_changed: 2 }),
        errFn: () => {},
      },
      captureWrites: true,
    });

    assert.equal(code, 0);
    // ≥1 write (renderHuman puede emitir varios) + 1 cleanup + 1 return.
    assert.ok(ts.length >= 3, `ts.length = ${ts.length}, ts = ${JSON.stringify(ts.map(x => x.tag))}`);
    assert.ok(ts.some((x) => x.tag === 'write'), 'render TTY debe haber escrito al menos 1 vez');
    assert.equal(ts[ts.length - 2].tag, 'cleanup');
    assert.equal(ts[ts.length - 1].tag, 'return');
    // Ordering completo: render → cleanup → return.
    const writeTs = ts.find((x) => x.tag === 'write');
    const cleanupTs = ts[ts.length - 2];
    const returnTs = ts[ts.length - 1];
    assert.ok(writeTs.t < cleanupTs.t, `write_ts (${writeTs.t}) < cleanup_ts (${cleanupTs.t})`);
    assert.ok(cleanupTs.t < returnTs.t, `cleanup_ts (${cleanupTs.t}) < return_ts (${returnTs.t})`);
  });

  it('Test 2 (return 2 early gate not-a-kodo-repo): cleanupFn corre ANTES de return', async () => {
    const emptyCwd = mkdtempSync(join(tmpdir(), 'kodo-not-a-repo-'));
    try {
      const { code, ts } = await captureOrdering({
        opts: {},
        deps: {
          cwdFn: () => emptyCwd,
          writeFn: () => {},
          errFn: () => {},
        },
      });

      assert.equal(code, 2);
      // No render en early-gate — sólo cleanup + return.
      assert.equal(ts.length, 2, `ts = ${JSON.stringify(ts.map(x => x.tag))}`);
      assert.equal(ts[0].tag, 'cleanup');
      assert.equal(ts[1].tag, 'return');
      assert.ok(ts[0].t < ts[1].t, `cleanup_ts (${ts[0].t}) < return_ts (${ts[1].t})`);
    } finally {
      rmSync(emptyCwd, { recursive: true, force: true });
    }
  });

  it('Test 3 (return 1 fs error via syncFn stub): cleanupFn corre ANTES de return', async () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { code, ts } = await captureOrdering({
      opts: {},
      deps: {
        cwdFn: () => _tmpRepo,
        writeFn: () => {},
        errFn: () => {},
        // result.error path (no excepción del catch — el otro path de return 1
        // está cubierto estructuralmente por la misma rama try/finally externa).
        syncFn: () => ({ status: 'error', files_changed: 0, error: 'simulated fs error' }),
      },
    });

    assert.equal(code, 1);
    assert.equal(ts.length, 2, `ts = ${JSON.stringify(ts.map(x => x.tag))}`);
    assert.equal(ts[0].tag, 'cleanup');
    assert.equal(ts[1].tag, 'return');
    assert.ok(ts[0].t < ts[1].t, `cleanup_ts (${ts[0].t}) < return_ts (${ts[1].t})`);
  });
});

// ─── Suite 2: runSkillSyncCli (integration spawnSync) ────────────────────────

describe('runSkillSyncCli (integration spawnSync `bin/kodo skill sync`)', () => {
  let _tmpHome;
  let _tmpRepo;

  afterEach(() => {
    if (_tmpHome) {
      // chmod restore de LOS DOS destinos (Phase 84): el CLI escribe en ambos, y
      // un test que deje cualquiera de ellos sin permisos impediría el rmSync.
      for (const name of FIXTURE_SKILLS) {
        try { chmodSync(destOf(_tmpHome, name), 0o755); } catch {}
      }
      rmSync(_tmpHome, { recursive: true, force: true });
    }
    if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
    _tmpHome = undefined;
    _tmpRepo = undefined;
  });

  it('SKILL-04 #1: ok (first sync) → exit 0, una línea por skill con su prefijo', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    // D-05: una línea por skill, prefijo `<nombre>: `, orden del registro.
    assert.match(result.stdout, /^kodo-orchestrate: .*Synced 2 files to /m);
    assert.match(result.stdout, /^kodo-capture: .*Synced 1 file to /m);
    const dest = destOf(_tmpHome);
    assert.equal(
      readFileSync(join(dest, 'skill.md'), 'utf-8'),
      '# kodo:orchestrate\n\nCanonical body v1.\n',
    );
    assert.equal(readFileSync(join(dest, 'subdir', 'extra.md'), 'utf-8'), 'extra content\n');
    // La segunda skill del registro llegó a SU destino, con el entrypoint en
    // mayúsculas intacto.
    assert.equal(
      readFileSync(join(destOf(_tmpHome, 'kodo-capture'), 'SKILL.md'), 'utf-8'),
      '# kodo-capture\n\nCanonical capture body v1.\n',
    );
  });

  it('SKILL-04 #2: noop (segundo run sin drift) → exit 0, `No drift` por skill', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const first = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(first.status, 0);
    const second = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(second.status, 0);
    assert.match(second.stdout, /^kodo-orchestrate: .*No drift/m);
    assert.match(second.stdout, /^kodo-capture: .*No drift/m);
  });

  it('SKILL-04 #3: fs error (dest file unreadable) → exit 1, stderr canonical', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    // Primer run para crear dest.
    const first = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    assert.equal(first.status, 0);
    const dest = destOf(_tmpHome);
    // chmod del archivo individual a 0o000: el syncSkill intentará readFileSync
    // para computar el hash y fallará con EACCES (Rule 1: ajustar setup del test
    // para reproducir fs error determinísticamente; chmod del dir 0o500 no basta
    // en macOS porque POSIX permite overwrite de archivo existente sin permiso
    // en parent dir si el file mismo es escribible).
    chmodSync(join(dest, 'skill.md'), 0o000);
    // Modificar source para forzar una comparación de hash que requiere leer dest.
    writeFileSync(
      join(sourceOf(_tmpRepo), 'skill.md'),
      '# kodo:orchestrate\n\nCanonical body v2.\n',
      'utf-8',
    );

    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo });
    // afterEach restaura permisos del dest dir antes del rmSync (chmod 0o755).
    // Restaurar también el archivo aquí para que afterEach pueda borrarlo.
    try { chmodSync(join(dest, 'skill.md'), 0o644); } catch {}
    assert.equal(result.status, 1, `stdout: ${result.stdout}, stderr: ${result.stderr}`);
    // El prefijo literal se conserva ANCLADO a inicio de cadena — es el que dicta
    // la forma del mensaje por skill (el nombre va DESPUÉS de los dos puntos).
    assert.match(result.stderr, /^Error: filesystem error: /);
    assert.match(result.stderr, /^Error: filesystem error: \[kodo-orchestrate\] /);
    // D-03 resiliencia observada end-to-end: pese al fallo de `kodo-orchestrate`,
    // `kodo-capture` llegó a su destino.
    assert.equal(
      readFileSync(join(destOf(_tmpHome, 'kodo-capture'), 'SKILL.md'), 'utf-8'),
      '# kodo-capture\n\nCanonical capture body v1.\n',
    );
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
    assert.match(result.stdout, /^kodo-orchestrate: .*Legacy symlink replaced/m);
    assert.equal(lstatSync(dest).isSymbolicLink(), false);
    assert.equal(lstatSync(dest).isDirectory(), true);
  });

  it('D-06b --json: byte-deterministic single-line, sin ANSI', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const result = runCli({ tmpHome: _tmpHome, tmpRepo: _tmpRepo, args: ['--json'] });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    // D-04: crecimiento ADITIVO. `status` y `files_changed` conservan su posición
    // (el agregado), `skills[]` se añade después con el orden del registro y cada
    // entrada con el orden fijo {name, status, files_changed}. Anclado a AMBOS
    // extremos: el orden de claves ES el contrato (DX-06).
    assert.match(
      result.stdout,
      /^\{"status":"ok","files_changed":3,"skills":\[\{"name":"kodo-orchestrate","status":"ok","files_changed":2\},\{"name":"kodo-capture","status":"ok","files_changed":1\}\]\}\n$/,
    );
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
    // El foráneo se sembró en el destino de `kodo-orchestrate` → su línea es la
    // que reporta el prune.
    assert.match(result.stdout, /^kodo-orchestrate: .*Pruned 1 foreign file/m);
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

// ─── Suite 3: registro multi-skill (Phase 84 CAPT-05 — D-01/D-03/D-07) ───────
//
// Los tests de resiliencia usan DI de `syncFn`: el stub no toca el filesystem,
// así que el `dest` derivado de `homedir()` nunca se materializa. NINGÚN test de
// esta suite puede escribir en el `~/.claude/skills/` real.

// Formatter mínimo determinista para los tests in-process: replica los tres
// helpers que usa `renderHuman` sin color (equivalente a NO_COLOR).
const PLAIN_FMT = /** @type {any} */ ({
  ok: (s) => `✓ ${s}`,
  yellow: (s) => s,
  dim: (s) => s,
});

describe('registro multi-skill de skill sync (CAPT-05)', () => {
  let _tmpHome;
  let _tmpRepo;

  afterEach(() => {
    if (_tmpHome) {
      for (const name of FIXTURE_SKILLS) {
        try { chmodSync(destOf(_tmpHome, name), 0o755); } catch {}
      }
      rmSync(_tmpHome, { recursive: true, force: true });
    }
    if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
    _tmpHome = undefined;
    _tmpRepo = undefined;
  });

  it('D-03 resiliencia: `status: error` en la primera skill NO aborta el bucle — exit agregado 1', async () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    /** @type {string[]} */
    const calls = [];
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const errs = [];

    const code = await runSkillSyncCli({}, {
      cwdFn: () => _tmpRepo,
      writeFn: (s) => { out.push(s); },
      errFn: (s) => { errs.push(s); },
      formatterFn: () => PLAIN_FMT,
      syncFn: /** @type {any} */ ((o) => {
        calls.push(o.source);
        return calls.length === 1
          ? { status: 'error', files_changed: 0, error: 'boom' }
          : { status: 'ok', files_changed: 1 };
      }),
    });

    // El bucle recorrió LAS DOS entradas del registro, en su orden.
    assert.equal(calls.length, 2, `el bucle no debe abortar en la primera skill; calls: ${JSON.stringify(calls)}`);
    assert.match(calls[0], /kodo-orchestrate$/);
    assert.match(calls[1], /kodo-capture$/);
    // Exit agregado: 1 (no 2 — el 2 queda reservado al gate).
    assert.equal(code, 1);
    // La fallida nombra la skill culpable DESPUÉS del prefijo literal.
    assert.equal(errs.join(''), 'Error: filesystem error: [kodo-orchestrate] boom\n');
    // La OK imprime su línea en stdout; la fallida no imprime nada en stdout.
    assert.match(out.join(''), /^kodo-capture: .*Synced 1 file to /m);
    assert.equal(
      /kodo-orchestrate:/.test(out.join('')),
      false,
      'la skill fallida no debe emitir línea de estado en stdout',
    );
  });

  it('D-03 excepción: un `syncFn` que LANZA se normaliza a error y el bucle continúa igual', async () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    /** @type {string[]} */
    const calls = [];
    /** @type {string[]} */
    const out = [];
    /** @type {string[]} */
    const errs = [];

    const code = await runSkillSyncCli({}, {
      cwdFn: () => _tmpRepo,
      writeFn: (s) => { out.push(s); },
      errFn: (s) => { errs.push(s); },
      formatterFn: () => PLAIN_FMT,
      syncFn: /** @type {any} */ ((o) => {
        calls.push(o.source);
        if (calls.length === 1) throw new Error('boom');
        return { status: 'ok', files_changed: 1 };
      }),
    });

    // Resultado IDÉNTICO al del test anterior: la excepción no propaga.
    assert.equal(calls.length, 2, 'la excepción de la primera skill no debe abortar el bucle');
    assert.equal(code, 1);
    assert.equal(errs.join(''), 'Error: filesystem error: [kodo-orchestrate] boom\n');
    assert.match(out.join(''), /^kodo-capture: .*Synced 1 file to /m);
  });

  it('D-07 case-tolerance: el entrypoint vale como `SKILL.md` o `skill.md` en los DOS gates', async () => {
    // ⚠ En macOS este test pasa TRIVIALMENTE: el filesystem es case-insensitive,
    // así que `existsSync(join(dir, 'skill.md'))` devuelve true aunque en disco
    // solo exista `SKILL.md`. Su valor es morder el día que la CI corra en Linux:
    // allí, sin D-07, `kodo-capture/SKILL.md` pasaría el gate del handler (que
    // solo mira `kodo-orchestrate`) y después `syncSkill` devolvería
    // `source skill not found`. Se mantiene por eso, no por lo que prueba hoy.
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());

    // Invertir las grafías respecto al fixture por defecto: orchestrate pasa a
    // MAYÚSCULAS y capture a minúsculas. Así ambas variantes quedan ejercitadas.
    rmSync(join(sourceOf(_tmpRepo), 'skill.md'), { force: true });
    writeFileSync(join(sourceOf(_tmpRepo), 'SKILL.md'), '# kodo:orchestrate\n\nupper\n', 'utf-8');
    rmSync(join(sourceOf(_tmpRepo, 'kodo-capture'), 'SKILL.md'), { force: true });
    writeFileSync(join(sourceOf(_tmpRepo, 'kodo-capture'), 'skill.md'), '# kodo-capture\n\nlower\n', 'utf-8');

    // Gate 1 — el del handler: con solo `SKILL.md` en mayúsculas NO debe dar el
    // exit 2 de "no es un repo kodo". syncFn stub → cero escrituras en el HOME.
    const code = await runSkillSyncCli({}, {
      cwdFn: () => _tmpRepo,
      writeFn: () => {},
      errFn: () => {},
      formatterFn: () => PLAIN_FMT,
      syncFn: /** @type {any} */ (() => ({ status: 'noop', files_changed: 0 })),
    });
    assert.notEqual(code, 2, 'el gate del handler debe aceptar `SKILL.md` en mayúsculas');

    // Gate 2 — el interno de syncSkill, con dest SANDBOXED en el tmpHome.
    const upper = syncSkill({ source: sourceOf(_tmpRepo), dest: destOf(_tmpHome) });
    assert.notEqual(upper.status, 'error', `SKILL.md en mayúsculas: ${upper.error}`);
    const lower = syncSkill({
      source: sourceOf(_tmpRepo, 'kodo-capture'),
      dest: destOf(_tmpHome, 'kodo-capture'),
    });
    assert.notEqual(lower.status, 'error', `skill.md en minúsculas: ${lower.error}`);
  });

  it('D-01 source-hygiene: el registro es una allowlist LITERAL y nunca se descubre por directorio', () => {
    // Este test es el gate del control de acceso T-84-01: lo único que impide que
    // una skill de trabajo local del repo (hoy `worktree-cleanup`) acabe copiada
    // al HOME de todos los operadores es que el registro sea literal.
    const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
    const stripped = stripComments(cliHandler);

    assert.match(
      stripped,
      /const KODO_SKILLS = Object\.freeze\(\['kodo-orchestrate', 'kodo-capture'\]\);/,
      'KODO_SKILLS debe ser la allowlist literal congelada de las dos skills distribuibles',
    );
    // El registro JAMÁS se construye leyendo `.claude/skills/`.
    assert.equal(
      /readdirSync|globSync|\bglob\s*\(/.test(stripped),
      false,
      'el registro no puede descubrirse por directorio — sería un control de acceso abierto',
    );
  });

  it('D-08b source-hygiene: los consumidores single-skill NO importan el registro', () => {
    // Los TRES consumidores que hardcodean `kodo-orchestrate` fuera de este
    // handler quedan DELIBERADAMENTE fuera del boundary de CAPT-05 por D-08b:
    //   1. src/orchestrator/launch.js — auto-sync fail-open del launch. Sincronizar
    //      `kodo-capture` ahí es una decisión de producto que el CONTEXT no toma.
    //   2. src/hooks/stop.js — auto-commit de learnings, con pathspec restringido a
    //      `.claude/skills/kodo-orchestrate/`. `kodo-capture` no acumula aprendizaje
    //      y meterla bajo un commit automático rompería el sujeto de su golden.
    //   3. src/hooks/stop.js — la constante SKILL_PATH (hoy muerta).
    // Consecuencia conocida y aceptada, registrada en el deferred-items.md de la
    // fase: quien solo use `kodo orchestrate` y nunca ejecute `kodo skill sync` no
    // recibirá `/kodo-capture`.
    //
    // El assert está anclado al PATRÓN DE IMPORT, nunca al identificador suelto: un
    // comentario que documente la regla (como este) no puede poner roja la suite
    // — lección explícita de 83-02 y 83-05.
    const REGISTRY_IMPORT_RE =
      /import\s*(?:\{[^}]*\bKODO_SKILLS\b[^}]*\}|\*\s+as\s+\w+)\s*from\s*['"][^'"]*skill-sync\.js['"]/;

    for (const rel of [['src', 'orchestrator', 'launch.js'], ['src', 'hooks', 'stop.js']]) {
      const stripped = stripComments(readFileSync(join(REPO, ...rel), 'utf-8'));
      assert.equal(
        REGISTRY_IMPORT_RE.test(stripped),
        false,
        `${rel.join('/')} no debe importar el registro de src/cli/skill-sync.js — sigue siendo single-skill por D-08b`,
      );
    }
  });
});
