// @ts-check
//
// test/orchestrator-auto-sync.test.js — Phase 21 SKILL-02 + SKILL-03.
//
// Tests in-process del hook auto-sync que Plan 02 cabela en src/orchestrator/launch.js
// ANTES de cmux.listWorkspaces() (entre L40 y L42 actuales). Consumimos syncSkill +
// skillSyncAuto/Error directamente (no spawn — auto-sync vive dentro del proceso).
//
// Cobertura:
//   A — drift detected → skill.sync.auto event (D-03b)
//   B — no drift → SIN event (D-03b silencio total)
//   C — sync error → skill.sync.auto.error event + caller fail-open (D-03)
//   D — source-hygiene cross-callsite (D-08b — exactamente 2 importers de syncSkill)
//   E — SKILL-03 invariante (orchestrator NO lee ~/.claude/skills/.../skill.md)

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncSkill } from '../src/skill/sync.js';
import { skillSyncAuto, skillSyncAutoError } from '../src/logger-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

function makeMemSink() {
  const records = [];
  const logger = {
    info:  (msg, fields) => records.push({ level: 'info',  msg, fields: fields || {} }),
    warn:  (msg, fields) => records.push({ level: 'warn',  msg, fields: fields || {} }),
    error: (msg, fields) => records.push({ level: 'error', msg, fields: fields || {} }),
    debug: (msg, fields) => records.push({ level: 'debug', msg, fields: fields || {} }),
    child: () => logger,
  };
  return { logger, records };
}

function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-auto-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-auto-sync-repo-'));
  const skillDir = join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'skill.md'), '# kodo:orchestrate\n\nv1\n', 'utf-8');
  writeFileSync(join(skillDir, 'extra.md'), 'extra\n', 'utf-8');
  return { tmpHome, tmpRepo };
}

function sourceFor(tmpRepo) { return join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate'); }
function destFor(tmpHome) { return join(tmpHome, '.claude', 'skills', 'kodo-orchestrate'); }

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
}

let _tmpHome, _tmpRepo;
afterEach(() => {
  if (_tmpHome) {
    try { chmodSync(destFor(_tmpHome), 0o755); } catch {}
    // Restaurar permisos de archivos individuales por si Test C dejó alguno 0o000.
    try {
      const skillMd = join(destFor(_tmpHome), 'skill.md');
      chmodSync(skillMd, 0o644);
    } catch {}
    rmSync(_tmpHome, { recursive: true, force: true });
  }
  if (_tmpRepo) rmSync(_tmpRepo, { recursive: true, force: true });
  _tmpHome = undefined; _tmpRepo = undefined;
});

describe('auto-sync (SKILL-02)', () => {
  it('A: drift detected → emit skill.sync.auto with files_changed > 0', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { logger, records } = makeMemSink();
    const source = sourceFor(_tmpRepo);
    const dest = destFor(_tmpHome);

    const result = syncSkill({ source, dest });
    assert.equal(result.status, 'ok');
    assert.equal(result.files_changed, 2);

    // Simula el caller (orchestrator): emite skill.sync.auto en status='ok'.
    skillSyncAuto(logger, { source, dest, files_changed: result.files_changed });

    const skillRecords = records.filter((r) => r.fields.event === 'skill.sync.auto');
    assert.equal(skillRecords.length, 1);
    assert.equal(skillRecords[0].level, 'info');
    assert.equal(skillRecords[0].fields.source, source);
    assert.equal(skillRecords[0].fields.dest, dest);
    assert.equal(skillRecords[0].fields.files_changed, 2);
  });

  it('B: no drift → silencio total (D-03b — sin .noop event para evitar ruido)', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { logger, records } = makeMemSink();
    const source = sourceFor(_tmpRepo);
    const dest = destFor(_tmpHome);

    syncSkill({ source, dest }); // primer run: ok
    const result = syncSkill({ source, dest }); // segundo run: noop
    assert.equal(result.status, 'noop');

    // Caller correcto: NO emite event en noop (simulando lógica del bloque Plan 02).
    if (result.status === 'error') {
      skillSyncAutoError(logger, { source, dest, error: result.error || 'x' });
    } else if (result.status === 'ok') {
      skillSyncAuto(logger, { source, dest, files_changed: result.files_changed });
    }

    const skillRecords = records.filter((r) => /^skill\.sync\./.test(r.fields.event || ''));
    assert.equal(skillRecords.length, 0,
      `expected 0 skill.sync.* records, got: ${JSON.stringify(skillRecords)}`);
  });

  it('C: sync error → emit skill.sync.auto.error + caller continues fail-open', () => {
    ({ tmpHome: _tmpHome, tmpRepo: _tmpRepo } = makeFixture());
    const { logger, records } = makeMemSink();
    const source = sourceFor(_tmpRepo);
    const dest = destFor(_tmpHome);

    syncSkill({ source, dest }); // primer run para crear dest dir + archivos
    // Plan 01 SUMMARY §Deviation 1: en macOS chmod 0o500 sobre el DIR no provoca
    // EACCES en overwrite de archivo existente. Forzar EACCES via chmod 0o000
    // sobre el archivo concreto que syncSkill leerá para hash comparison.
    chmodSync(join(dest, 'skill.md'), 0o000);
    writeFileSync(join(source, 'skill.md'), '# kodo:orchestrate\n\nv2 modified\n', 'utf-8');

    let result;
    try {
      result = syncSkill({ source, dest });
    } catch (e) {
      result = { status: 'error', files_changed: 0, error: e.message };
    }
    assert.equal(result.status, 'error');
    assert.ok(result.error, 'expected error string truthy');

    skillSyncAutoError(logger, { source, dest, error: result.error });

    const errorRecords = records.filter((r) => r.fields.event === 'skill.sync.auto.error');
    assert.equal(errorRecords.length, 1);
    assert.equal(errorRecords[0].level, 'error');
    assert.equal(errorRecords[0].fields.source, source);
    assert.equal(errorRecords[0].fields.dest, dest);
    assert.ok(errorRecords[0].fields.error);
  });
});

describe('source-hygiene D-08b (Phase 21)', () => {
  it('D: syncSkill imported from exactly 2 callsites (CLI handler + orchestrator launch)', () => {
    const cliHandler = readFileSync(join(REPO, 'src', 'cli', 'skill-sync.js'), 'utf-8');
    const launchMod  = readFileSync(join(REPO, 'src', 'orchestrator', 'launch.js'), 'utf-8');

    assert.match(stripComments(cliHandler), /from\s+['"]\.\.\/skill\/sync\.js['"]/,
      'src/cli/skill-sync.js must import from ../skill/sync.js');
    assert.match(stripComments(launchMod), /from\s+['"]\.\.\/skill\/sync\.js['"]/,
      'src/orchestrator/launch.js must import from ../skill/sync.js (Plan 02 wiring)');

    const grepOutput = execSync('grep -rl "from.*skill/sync" src/ || true', {
      cwd: REPO, encoding: 'utf-8',
    });
    const importers = grepOutput.trim().split('\n').filter(Boolean).sort();
    assert.deepEqual(
      importers,
      ['src/cli/skill-sync.js', 'src/orchestrator/launch.js'].sort(),
      `expected exactly 2 importers, got: ${importers.join(', ')}`,
    );
  });
});

describe('SKILL-03 invariante (Phase 999.1 D-04..D-06 preserved)', () => {
  it('E: src/orchestrator/launch.js NO reads ~/.claude/skills/kodo-orchestrate/skill.md', () => {
    const launchMod = stripComments(readFileSync(join(REPO, 'src', 'orchestrator', 'launch.js'), 'utf-8'));

    // Negativo 1: ningún readFileSync sobre .claude/skills/... + skill.md combo.
    assert.equal(
      /readFileSync\s*\([^)]*\.claude\/skills[\s\S]{0,80}skill\.md/.test(launchMod), false,
      'launch.js must NOT readFileSync from .claude/skills/.../skill.md (auto-load by cwd, not direct read)',
    );

    // Negativo 2: ningún homedir() + skill.md combo (lectura desde home).
    assert.equal(
      /homedir\s*\(\)[\s\S]{0,80}skill\.md/.test(launchMod), false,
      'launch.js must NOT read homedir-based skill.md (Phase 999.1 D-04 invariant)',
    );

    // Positivo: el bloque Plan 02 SÍ invoca syncSkill.
    assert.match(launchMod, /syncSkill\s*\(/,
      'launch.js must invoke syncSkill (Plan 02 hook present)');
  });
});
