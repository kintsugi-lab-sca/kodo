---
phase: 18-worktree-runtime-wiring
verified: 2026-05-12T10:20:00Z
status: passed
score: 8/8 must-haves verified
overrides_applied: 0
re_verification: null
known_gaps:
  - id: CR-02
    truth: "PRE-spawn reorder (D-03) deja un SessionRecord 'running' huérfano si cmux.send falla post-addSession"
    addressed_in: "Phase 19 (stop hook fail-open cleanup — WT-04)"
    evidence: "CONTEXT.md líneas 17-20 (out-of-scope explícito). 18-REVIEW-FIX.md skip section documenta la decisión D-03 explícita: el record se persiste PRE-spawn precisamente para que kodo logs --session-of pueda resolver la traza forensic INCLUSO si la sesión nunca arrancó. Removerlo en el catch elimina ese beneficio diseñado. Stop hook centralizado en Phase 19 proveerá la solución arquitectónica correcta."
    severity: known-debt
---

# Phase 18: Worktree Runtime Wiring — Verification Report

**Phase Goal:** Toda sesión kodo arranca en un worktree dedicado derivado determinísticamente del session-id, sin romper el lock per-repo.
**Verified:** 2026-05-12T10:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap SC + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC#1 — Toda sesión `launchWorkItem` (full/quick/no-GSD) corre con `claude --worktree <sessionId>` | VERIFIED | `src/session/manager.js:326` — `buildClaudeCommand` emite `--worktree ${sessionId}` SIEMPRE en el template (sin branch GSD/no-GSD). `grep -Fc -- '--worktree ${sessionId}' src/session/manager.js` == 1. Test `buildClaudeCommand cmd shape (Phase 18 WT-01)` cubre los 3 modos. |
| 2 | SC#2 — `SessionRecord.worktree_path` persistido en state.json con path determinístico `<repo>/.bg-shell/<session-id>` | VERIFIED | `src/session/state.js:69-71` exporta helper puro `computeWorktreePath` (call de prueba: `/repo/.bg-shell/abc-123` ✓). `src/session/manager.js:237` invoca el helper PRE-spawn; `:64` conditional spread en `buildSessionFromTask` persiste el campo; `:266` `addSession` corre ANTES de `cmux.send` (pos 11603 < 11680 verificado). Typedef `Session.worktree_path?` añadido en `state.js:29` aditivo opcional. |
| 3 | SC#3 — Coalescencia preservada: 2 tasks sobre mismo repo → la segunda recibe `gsd_locked`; lock vive en repo principal, NO en worktree | VERIFIED | Cross-source grep `acquireGsdLockFn?\(...worktree\|releaseGsdLockFn?\(...worktree` retorna 0 matches en `src/`. Test `test/gsd-concurrency.test.js` `Phase 18 — coalesce con worktree cableado (WT-03 SC#3)` (4 asserts) cubre: lock precede a collision check, lock file vive en `<repo>/.planning/.kodo.lock`, no-GSD paralelo, source-hygiene cross-callsite. |
| 4 | Helper puro `computeWorktreePath` factorizado en state.js (D-03 Claude's Discretion) — Phase 19 lo consumirá | VERIFIED | `src/session/state.js:69` `export function computeWorktreePath`. JSDoc completo con `@param`/`@returns`. Sin `realpathSync`/`mkdirSync`/`existsSync` (verificado). 4 tests en `test/state.test.js` pasan. |
| 5 | D-03 PRE-spawn ordering: `addSession` ANTES de `cmux.send` | VERIFIED | `manager.js` posiciones: `addSession(task.id, session)` línea 266; `cmux.send({ workspace: workspaceRef, text: claudeCmd })` línea 269. Test source-hygiene en `test/manager.test.js` (`Phase 18 D-03: addSession runs BEFORE cmux.send`). |
| 6 | D-05/D-05b fail-fast canonical `worktree_collision` en dispatcher con shape `{action, code, detail}` + stderr + lock release | VERIFIED | `dispatcher.js:212-213` emite `console.log('[kodo:dispatch] worktree_collision — ...')` y `return { action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath }`. Líneas 204-211 release del lock GSD on collision (idempotente). 8 tests en `test/dispatcher.test.js` cubren shape GSD/non-GSD, lock release, threading, stderr, graceful. |
| 7 | D-06 — `launchOrchestrator` EXCLUIDO de `--worktree` (cwd=repo para auto-cargar skill Phase 999.1) | VERIFIED | `src/orchestrator/launch.js:84-100` comentario in-file documenta D-06; las 4 menciones de `--worktree` están todas en bloque comentario (líneas 84, 91, 96, 99). Array `claudeCmd` (líneas 102-108) NO contiene `--worktree`. Test `test/orchestrator-launch-isolation.test.js` con stripComments confirma 0 menciones runtime. `cwd: process.cwd()` línea 72 intacto. |
| 8 | D-06b — Sesiones no-GSD también con worktree, sin lock (resuelve incidencia 28/04 ROMAN-113…118) | VERIFIED | `dispatcher.js:179-186` genera `dispatchSessionId = randomUUID()` early-bird para no-GSD; threading via `opts.sessionId` en líneas 367 (stale_relaunch) y 410 (launch). `buildClaudeCommand` emite `--worktree` siempre, sin branch GSD. Test `non-GSD parallel D-06b` en `gsd-concurrency.test.js`. |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/session/state.js` | Helper `computeWorktreePath` + typedef `Session.worktree_path?` | VERIFIED | 197 LOC. Helper exportado línea 69. Typedef extension línea 29. Suite estado 22/22 pass. |
| `src/session/manager.js` | Import + invocación `computeWorktreePath`, conditional spread `worktree_path`, emit `--worktree ${sessionId}`, reorden PRE-spawn | VERIFIED | 361 LOC. Import línea 8 (`computeWorktreePath` en named imports). Invocación línea 237. Spread línea 64. Template línea 326. Reorden línea 266 (addSession) antes de 269 (cmux.send). |
| `src/triggers/dispatcher.js` | Canonical `worktree_collision`, `existsSyncFn` deps slot, threading `dispatchSessionId`, lock invariant preservado | VERIFIED | 438 LOC. Bloque collision-check líneas 147-215. `existsSyncFn` deps fallback línea 55. Threading dispatchSessionId líneas 367 + 410. Stale_relaunch fix CR-01 línea 367 (no más `gsdSessionId`). |
| `src/orchestrator/launch.js` | Comentario D-06 + array `claudeCmd` sin `--worktree` | VERIFIED | Comentario 84-100. Array 102-108 sin `--worktree`. `cwd: process.cwd()` línea 72 intacto. |
| `test/state.test.js` | 4 asserts `computeWorktreePath` | VERIFIED | 117 LOC. 4 asserts ejecutados (shape canónico, determinismo, UUID-safe, NO realpathSync). 20/20 pass. |
| `test/manager.test.js` | Asserts shape session + cmd + ordering | VERIFIED | 25 KB. 43/43 pass (claim summary). Source-hygiene asserts incluidos. |
| `test/dispatcher.test.js` | 8 asserts Phase 18 worktree_collision | VERIFIED | 40 KB. 32/32 pass (claim summary). |
| `test/gsd-concurrency.test.js` | 4 asserts coalesce + WT-03 invariants | VERIFIED | 20 KB. Tests Phase 18 D-06b parallel, lock invariant cross-callsite presentes. |
| `test/orchestrator-launch-isolation.test.js` | 3 asserts source-hygiene D-06 | VERIFIED | 2.6 KB nuevo. 3/3 pass (claim summary). |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/session/manager.js` | `src/session/state.js#computeWorktreePath` | named import | WIRED | Línea 8: `import { addSession, listSessions, updateSession, computeWorktreePath } from './state.js'`. Invocado en línea 237. |
| `src/triggers/dispatcher.js` | `src/session/state.js#computeWorktreePath` | named import | WIRED | Línea 7: `import { listSessions, removeSession, computeWorktreePath } from '../session/state.js'`. Invocado en línea 188. |
| `src/triggers/dispatcher.js` | `node:fs#existsSync` | import + deps fallback | WIRED | Línea 3: `import { existsSync } from 'node:fs'`. Línea 55: `const existsSyncFn = deps.existsSyncFn || existsSync`. |
| `manager.js#launchWorkItem` | `manager.js#computeWorktreePath` invocation | `computeWorktreePath(projectPath, sessionId)` | WIRED | Línea 237. |
| `manager.js#buildSessionFromTask` | `Session.worktree_path` | conditional spread `...(worktreePath ? { worktree_path: worktreePath } : {})` | WIRED | Línea 64. Mismo idiom que `phase_id`/`brief`/`gsd_mode`. |
| `manager.js#buildClaudeCommand` | `claude --worktree <sessionId>` | string interpolation | WIRED | Línea 326. Orden `--model X --session-id Y --worktree Y [--dangerously-skip-permissions] '<prompt>'`. |
| `manager.js#launchWorkItem` | `addSession` PRE-spawn ordering | `addSession(task.id, session)` antes de `cmux.send(...)` | WIRED | Posiciones 11603 < 11680 (verificado). |
| `dispatcher.js#worktree-collision` | stderr canonical | `console.log('[kodo:dispatch] worktree_collision — ...')` | WIRED | Línea 212. Mismo formato que `gsd_locked` (línea 141). |
| `dispatcher.js#worktree-collision` | `releaseGsdLockFn` (no leak) | release antes de return cuando GSD acquired | WIRED | Líneas 204-211. |
| `orchestrator/launch.js` | absence of `--worktree` (D-06) | array `claudeCmd` sin el flag | WIRED | Líneas 102-108. 4 menciones todas en comentario (84, 91, 96, 99). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `manager.js#buildClaudeCommand` | `sessionId` | `randomUUID()` o `opts.sessionId` threaded del dispatcher (UUID v4) | Sí — UUID v4 garantizado | FLOWING |
| `manager.js#launchWorkItem` | `worktreePath` | `computeWorktreePath(projectPath, sessionId)` pure call | Sí — path determinístico literal | FLOWING |
| `state.json#sessions[].worktree_path` | persisted field | `addSession` con session que incluye spread del path | Sí — persistido pre-cmux.send | FLOWING |
| `dispatcher.js#worktree-collision detail` | `worktreePath` returned | `computeWorktreePath(dispatchProjectPath, dispatchSessionId)` | Sí — input absoluto + UUID | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Helper export + computation | `node -e "import('./src/session/state.js').then(m => m.computeWorktreePath('/repo', 'abc-123'))"` | `/repo/.bg-shell/abc-123` (function type) | PASS |
| Suite global | `npm test` | tests 547, pass 546, fail 0, skipped 1 (LOG-12 Decisión B pre-existente) | PASS |
| Order invariant runtime | `node -e fs.readFileSync('src/session/manager.js').indexOf('addSession(task.id, session)') < indexOf('cmux.send(... claudeCmd')` | true (11603 < 11680) | PASS |
| WT-03 lock invariant cross-source | `grep -rE "acquire\|releaseGsdLockFn?\(...worktree" src/` | 0 matches | PASS |
| Phase 18 isolated tests | `node --test test/orchestrator-launch-isolation.test.js test/state.test.js test/gsd-concurrency.test.js` | 20/20 pass | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| **WT-01** | 18-02-PLAN.md, 18-03-PLAN.md | Toda sesión kodo se lanza con `claude --worktree` (full + quick + no-GSD), sin opt-in | SATISFIED | Truth #1 + Truth #7 (orchestrator excluido por D-06). `buildClaudeCommand` emite `--worktree ${sessionId}` siempre; `orchestrator/launch.js` exento documentado y source-hygiene blindado. |
| **WT-02** | 18-01-PLAN.md, 18-02-PLAN.md | Path derivado determinísticamente del session-id + persistido en `SessionRecord.worktree_path` | SATISFIED | Truth #2 + Truth #4. Helper puro `computeWorktreePath` exportado; persistencia PRE-spawn via conditional spread; typedef aditivo opcional. |
| **WT-03** | 18-03-PLAN.md | Lock per-repo invariante sobre `projectPath` — coalescencia preservada | SATISFIED | Truth #3 + grep cross-source 0 matches. Test integration `lock invariant cross-callsite` + `lock file vive en projectPath/.planning/.kodo.lock`. |

**Coverage:** 3/3 requirements satisfied (100%). No orphans (REQUIREMENTS.md líneas 75-77 mapea exactamente WT-01/02/03 a Phase 18).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/session/manager.js` | 263 | Comentario admite "SessionRecord queda en estado 'running' hasta el siguiente ciclo de housekeeping" | INFO | Edge case conocido (CR-02), deferido a Phase 19 stop hook fail-open. Documentado en frontmatter `known_gaps`. |
| `src/triggers/dispatcher.js` | 199 | `console.log` para `worktree_probe_failed` (canal stdout, no stderr) | INFO | Convención del módulo — `gsd_locked` y `resolver_failed` también usan stdout. Migración a stderr marcada como tech-debt v0.6 (WR-02 fix doc). |
| `test/gsd-concurrency.test.js` + `test/orchestrator-launch-isolation.test.js` | helper | `stripComments` naive (WR-05) | INFO | Limitaciones documentadas in-file. Adecuado para el codebase actual (no contiene los patrones problemáticos). |

Ningún BLOCKER. Ningún WARNING que invalide el goal.

### Human Verification Required

Ninguno requerido para gate de Phase 18. La verificación programática cubre todos los SCs y key links. Smoke manual opcional documentado en cada PLAN (lanzar sesión real, verificar `git rev-parse --show-toplevel` desde el worktree, verificar lock file path) puede ejecutarse antes de empezar Phase 19 si el operador lo desea.

### Gaps Summary

**Sin gaps bloqueantes.** Goal "Toda sesión kodo arranca en un worktree dedicado derivado determinísticamente del session-id, sin romper el lock per-repo" — VERIFICADO.

Un known gap (CR-02 — SessionRecord huérfano si `cmux.send` falla post-addSession) documentado explícitamente como tech-debt deferido a Phase 19 per CONTEXT.md scope (líneas 17-20). El reorden D-03 fue una decisión arquitectónica consciente: el record se persiste PRE-spawn para que `kodo logs --session-of` resuelva la traza forensic incluso si la sesión nunca arrancó. El cleanup centralizado vivirá en el stop hook fail-open de Phase 19 (WT-04) en lugar de fragmentarse entre dispatcher catch y stop hook.

Code review (18-REVIEW.md) había identificado:
- **2 BLOCKERs** (CR-01, CR-02) → CR-01 corregido en commit `cf8f33b`; CR-02 conscientemente deferido (18-REVIEW-FIX.md documenta la decisión).
- **5 WARNINGs** (WR-01..05) → todos cerrados (commits `a9952f4`, `fdb023b`, `86063c5`, `11206a9`, `2fd00f6`).
- **4 INFOs** (IN-01..04) → cosméticos, sin acción requerida.

Estado final: 6 issues in-scope cerrados, 1 deferido con trazabilidad clara hacia Phase 19.

---

_Verified: 2026-05-12T10:20:00Z_
_Verifier: Claude (gsd-verifier)_
