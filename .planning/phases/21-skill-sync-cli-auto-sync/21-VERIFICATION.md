---
phase: 21-skill-sync-cli-auto-sync
verified: 2026-05-13T00:18:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 21: Skill Sync CLI + Auto-Sync Verification Report

**Phase Goal:** La skill canonical `kodo-orchestrate` se mantiene sincronizada entre `<repo>/.claude/skills/` y `~/.claude/skills/` sin acción humana recurrente, sin romper la Constraint cwd=repo de Phase 999.1.
**Verified:** 2026-05-13T00:18:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kodo skill sync` CLI exists con `--prune` + `--json` + 4 exit codes + canonical stderr | VERIFIED | `node bin/kodo skill sync --help` muestra ambos flags. Spot-check `cd /tmp/kodo-not-a-repo && node bin/kodo skill sync` → stderr exacto `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)` + exit=2. `src/cli/skill-sync.js:52-67` implementa los 4 exit codes (0 ok/noop, 1 fs error, 2 no kodo repo). |
| 2 | `src/skill/sync.js` exporta función pura `syncSkill(opts)` con SHA-256 diff + symlink unlinkSync + prune opt-in default false | VERIFIED | Línea 50: `export function syncSkill(opts)`. SHA-256 via `createHash('sha256')` (línea 94, 100). `lstatSync(dest).isSymbolicLink()` + `unlinkSync(dest)` (líneas 67-69) — WR-01 fix confirmado: `rmSync` reemplazado por `unlinkSync`. `prune = false` default en destructuring línea 51. NO emite eventos NDJSON (verificado por grep — sin imports a logger-events.js). |
| 3 | `launchOrchestrator` invoca `syncSkill` ANTES de `cmux.listWorkspaces` con fail-open + eventos `skill.sync.auto` / `.error` | VERIFIED | `src/orchestrator/launch.js:63-86` contiene bloque try/outer-catch que invoca `syncSkill` en línea 66; `cmux.listWorkspaces()` aparece en línea 92 (DESPUÉS). Branch `status==='ok'` emite `skillSyncAuto` (línea 70); `status==='error'` emite `skillSyncAutoError` (línea 68); `status==='noop'` silencio (D-03b). Outer catch fail-open emite vía `skillSyncAutoError` (no `console.error`) — WR-02 fix confirmado. |
| 4 | `~/.claude/skills/kodo-orchestrate/` legacy symlink handling correcto (idempotente) | VERIFIED | `src/skill/sync.js:67-79`: `lstatSync(dest)` + `if (st.isSymbolicLink()) { unlinkSync(dest); mkdirSync(dest, {recursive:true}); symlinkReplaced=true; }`. Catch propaga errores non-ENOENT (WR-03 fix: `throw err` en línea 77). Cobertura por Test 4 (unit) + Test CLI 5 (D-04 symlink CLI) en test/skill-sync.test.js. |
| 5 | `src/logger-events.js` exporta `skillSyncAuto`/`skillSyncAutoError` + 2 keys en EVENTS frozen | VERIFIED | Líneas 50-51: `SKILL_SYNC_AUTO: 'skill.sync.auto'`, `SKILL_SYNC_AUTO_ERROR: 'skill.sync.auto.error'` dentro de `Object.freeze`. Helpers exportados líneas 289 y 306. JSDoc shape actualizado (líneas 35-36). Header comment menciona Phase 21 (línea 6) + 13 eventos taxonomía. |
| 6 | D-08 single-source: syncSkill importado desde EXACTAMENTE 2 callsites (CLI + orchestrator) | VERIFIED | `grep -rln "from.*skill/sync" src/` → exactamente `src/cli/skill-sync.js` y `src/orchestrator/launch.js`. Blindado por Test D (`test/orchestrator-auto-sync.test.js:156-176`) que usa `assert.deepEqual` sobre el array sorted de importers. |
| 7 | D-10 cwd=repo Phase 999.1 preservada: launchOrchestrator NO modifica process.cwd() ni args | VERIFIED | `grep -c "process.chdir" src/orchestrator/launch.js` → 0. `cmux.newWorkspace({ cwd: process.cwd() })` línea 119 intacto. Test E (`test/orchestrator-auto-sync.test.js:178-198`) blinda con regex negativos sobre stripComments: no readFileSync sobre `.claude/skills/.../skill.md`, no `homedir() + skill.md` combo. |
| 8 | Phase 18 D-06 comment en launch.js intacto | VERIFIED | `grep -c "Phase 18 D-06: launchOrchestrator EXCLUIDO de --worktree" src/orchestrator/launch.js` → 1 match (línea 131). Bloque completo de comentario líneas 130-148 preservado byte-a-byte. |
| 9 | `.claude/skills/kodo-orchestrate/skill.md` NO modificado | VERIFIED | `git status .claude/skills/kodo-orchestrate/` → tree clean. `git diff main -- .claude/skills/kodo-orchestrate/` → empty. La skill canonical es read-only por construcción Phase 21 (D-01 invariante). |
| 10 | npm test green (608 pass / 1 skip pre-existente) | VERIFIED | `npm test 2>&1 | tail -25` → `tests 609 / pass 608 / fail 0 / skipped 1`. Total bumps from baseline 567 → 608 = +41 nuevos tests (Plan 01: 36; Plan 02: 5). |

**Score:** 10/10 truths verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/skill/sync.js` | Módulo único `syncSkill` puro + walker + SHA-256 + symlink | VERIFIED | 165 LOC. Exports `syncSkill`. Walker manual `walkFiles` privado. SHA-256 via `node:crypto`. `unlinkSync` (no `rmSync`) para symlink. `throw err` en lstatSync catch para non-ENOENT. Sin imports de logger-events. Sin picocolors. |
| `src/cli/skill-sync.js` | Handler CLI con DI completa + 4 exit codes | VERIFIED | 112 LOC. Exports `runSkillSyncCli`. Gate D-07 exit 2 (línea 52-55). Try/catch para fs error exit 1 (líneas 59-68). Render JSON byte-deterministic vs human via createFormatter. Sin imports de picocolors. |
| `src/cli.js` | Subgrupo Commander `kodo skill sync` con --prune + --json | VERIFIED | `node bin/kodo skill sync --help` exit 0, ambos flags presentes. Lazy dynamic import in `.action()` (D-08 + perf pattern Phase 9). |
| `src/logger-events.js` | 2 EVENTS keys frozen + 2 helpers tipados | VERIFIED | `EVENTS.SKILL_SYNC_AUTO`/`SKILL_SYNC_AUTO_ERROR` en Object.freeze. `skillSyncAuto(logger, fields)` + `skillSyncAutoError(logger, fields)` con JSDoc completo. Header actualizado a 13 eventos. |
| `src/orchestrator/launch.js` | Bloque auto-sync fail-open ANTES de cmux.listWorkspaces | VERIFIED | +38 LOC: 3 imports (homedir, syncSkill, skillSyncAuto/Error) + KODO_ROOT_FOR_SKILL const + bloque try/outer-catch líneas 48-87. Inner branches emiten per status. Outer catch usa skillSyncAutoError event (no console.error — WR-02 fix). |
| `test/skill-sync.test.js` | 16 tests (8 unit + 8 CLI spawnSync) | VERIFIED | `node --test test/skill-sync.test.js` → 16 pass / 0 fail. Cubre 4 escenarios SKILL-04 + symlink + --json byte-deterministic + --prune + source-hygiene grep. |
| `test/orchestrator-auto-sync.test.js` | 5 tests A..E in-process DI | VERIFIED | `node --test test/orchestrator-auto-sync.test.js` → 5 pass / 0 fail. Cubre auto-sync drift/noop/error + D-08b cross-callsite + SKILL-03 invariante. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cli.js` | `src/cli/skill-sync.js` | lazy dynamic import in `.action()` | WIRED | `await import('./cli/skill-sync.js')` presente; `--help` exit 0; spawn exit 2 desde tmp dir confirma wiring funcional. |
| `src/cli/skill-sync.js` | `src/skill/sync.js` | static import | WIRED | Línea 18: `import { syncSkill } from '../skill/sync.js'`. Test 16 (source-hygiene) verifica stripComments-friendly. |
| `src/cli/skill-sync.js` | `src/cli/format.js` | createFormatter (color isolation) | WIRED | Línea 19: `import { createFormatter } from './format.js'`. No imports directos a `picocolors` (grep -c picocolors → 0). |
| `src/orchestrator/launch.js` | `src/skill/sync.js` | static import top | WIRED | Línea 11: `import { syncSkill } from '../skill/sync.js'`. Invocado línea 66 dentro try block. |
| `src/orchestrator/launch.js` | `src/logger-events.js` | static import skillSyncAuto/Error | WIRED | Línea 12: `import { skillSyncAuto, skillSyncAutoError } from '../logger-events.js'`. Invocados en líneas 68 (error branch) y 70 (ok branch). |
| auto-sync block | `cmux.listWorkspaces()` | ejecuta ANTES del side-effect | WIRED | Bloque try líneas 48-87 cierra antes de la línea 92 `workspaceList = await cmux.listWorkspaces()`. Ordering correcto. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `syncSkill` return value | `skillResult` en launch.js:66 | `syncSkill({source, dest})` con paths reales `KODO_ROOT_FOR_SKILL/.claude/skills/...` y `homedir()/.claude/skills/...` | Sí (SHA-256 real sobre archivos del repo) | FLOWING |
| `skill.sync.auto` event | `files_changed: skillResult.files_changed` línea 70 | Contador real incrementado en sync.js:107 cuando hash difiere | Sí | FLOWING |
| `kodo skill sync` stdout | `result.files_changed` en renderHuman/JSON | Direct return de syncSkill (no hardcoded) | Sí | FLOWING |
| `--json` output | `JSON.stringify(payload)` | Construido desde `result.status/files_changed/files_pruned/symlink_replaced` reales | Sí | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CLI help muestra --prune y --json | `node bin/kodo skill sync --help` | exit 0, salida contiene ambos flags | PASS |
| Exit 2 desde non-repo cwd con stderr canonical | `cd /tmp/kodo-not-a-repo-test && node /Users/alex/dev/klab/kodo/bin/kodo skill sync` | stderr exacto + exit=2 | PASS |
| 16 tests skill-sync verde | `node --test test/skill-sync.test.js` | 16 pass / 0 fail | PASS |
| 5 tests orchestrator-auto-sync verde | `node --test test/orchestrator-auto-sync.test.js` | 5 pass / 0 fail | PASS |
| Suite global verde | `npm test` | 608 pass / 0 fail / 1 skipped | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SKILL-01 | 21-01 | CLI `kodo skill sync` diff-aware con `--prune` opt-in | SATISFIED | `kodo skill sync --help` muestra `--prune`; tests Test 5/6 unit + Test CLI 7 cubren preserve-by-default vs prune-on-flag. SHA-256 walker manual confirma diff-aware. |
| SKILL-02 | 21-02 | `kodo orchestrator` detecta drift y auto-sincroniza con evento `skill.sync.auto` | SATISFIED | Bloque launch.js:48-87 ejecuta syncSkill antes de cmux. Tests A/C en orchestrator-auto-sync.test.js verifican emit de events; Test B verifica silencio en noop (D-03b). |
| SKILL-03 | 21-02 | Auto-sync NO rompe Constraint cwd=repo | SATISFIED | `process.chdir` ausente. `cwd: process.cwd()` preservado en cmux.newWorkspace. Test E blinda con regex negativos. Phase 18 D-06 comment intacto (1 grep match). |
| SKILL-04 | 21-01 | Exit codes deterministas 0/0/1/2 + stderr canonical documentado | SATISFIED | `src/cli/skill-sync.js:52-67` implementa los 4 paths. Spot-check externo confirma exit=2 + stderr exacto. Tests `SKILL-04 #1..#4` en skill-sync.test.js (spawnSync real) blindan bytes. |

Cobertura: 4/4 SKILL requirements satisfied. Sin orphaned requirements (todas declaradas en plans frontmatter y mapeadas en REQUIREMENTS.md a Phase 21).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cli/skill-sync.js` | 40 | `async` sin awaits internos (WR-05 deferido) | Info | Cosmético; documentado como follow-up advisory en 21-REVIEW.md. NO blocker. |
| `src/skill/sync.js` | 117 | `console.warn` en módulo "puro" durante --prune (WR-04 deferido) | Info | Funciona end-to-end (stdout limpio); rompe pureza estricta pero solo afecta path manual con --prune. Documentado deferido. |
| `test/orchestrator-auto-sync.test.js` | A/B/C | Tests simulan caller en lugar de invocar launchOrchestrator real (WR-06 deferido) | Info | Tests D+E cubren wiring estructural; gap es behavioral runtime path. Documentado follow-up. |

Ningún anti-pattern es BLOCKER. Los 3 warnings deferidos (WR-04/05/06) están explícitamente documentados en 21-REVIEW.md como advisory.

### Human Verification Required

_Ninguno._ Todas las truths se verifican programáticamente:
- Tests automatizados cubren los 4 SKILL requirements (16 unit + CLI tests + 5 in-process auto-sync tests).
- Spot-check directo del CLI desde non-repo cwd confirma bytes-exactos en stderr y exit code.
- `npm test` green confirma no regresión cross-phase.
- El comportamiento de auto-sync en producción real (`kodo orchestrate`) se observará la primera vez que el operador lo invoque post-merge — pero la lógica está blindada por tests y el path es fail-open (no rompe el orchestrator si falla).

### Gaps Summary

_Sin gaps._ Phase 21 cumple su goal: skill canonical sincronizable manual (CLI) y automáticamente (launchOrchestrator) sin romper Constraint cwd=repo Phase 999.1.

Los warnings WR-01/02/03 del code review YA están fixed en commit reciente (verificado en el código actual: `unlinkSync` en sync.js:69, outer-catch usa `skillSyncAutoError` event en launch.js:81, `throw err` en sync.js:77). WR-04/05/06 quedan como follow-up advisory documentados en 21-REVIEW.md — no bloquean el cierre de Phase 21.

**Highlights de verificación:**

- 4 SKILL requirements (SKILL-01..04) **SATISFIED** con evidencia de código y tests
- Suite global: 608 pass / 0 fail / 1 skip (delta +41 desde baseline 567)
- D-08 single-source: exactamente 2 importers de syncSkill (blindado por test estructural)
- D-10 cwd preservation: process.chdir ausente, args de cmux.newWorkspace intactos
- Phase 18 D-06 comment preservado byte-a-byte (1 grep match)
- Skill canonical read-only: git tree limpio para .claude/skills/kodo-orchestrate/
- WR-01 fix verificado: unlinkSync reemplaza rmSync para symlink replacement
- WR-02 fix verificado: outer catch emite event NDJSON (no console.error)
- WR-03 fix verificado: throw err propaga errores non-ENOENT en lstatSync catch

---

_Verified: 2026-05-13T00:18:00Z_
_Verifier: Claude (gsd-verifier)_
