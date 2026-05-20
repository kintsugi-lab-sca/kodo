---
phase: 30-sessionrecord-lifecycle
plan: 04
subsystem: session-lifecycle / logs-resolver
tags:
  - session-lookup
  - history-scan
  - sc1-closure
  - gap-closure
  - life-01-extension
dependency-graph:
  requires:
    - LIFE-01 (Phase 30 Plan 01) — findSession dual-scan canonical idiom (sessions + history, priority sessions, Array.isArray guard)
    - removeSession FIFO history (50-slot cap, ended_at injection) — Phase 30 Plan 01 D-09
  provides:
    - resolveSessionIdFromTaskId dual-scan step-1 (sessions + history) — SC#1 Truth 2 byte-exact closure
  affects:
    - src/logs/session-lookup.js — step-1 dual-scan; step-2 NDJSON unchanged
    - bin/kodo logs --session-of <task_ref> — identical CLI behavior for archived sessions
tech-stack:
  added: []
  patterns:
    - Defensive Array.isArray guard for legacy state.json files without history field (mirrors LIFE-01 findSession#213 and listHistory#150)
    - Priority sessions > history (LIFE-01 D-02 idiom for degenerate window during removeSession unshift→delete)
key-files:
  created: []
  modified:
    - src/logs/session-lookup.js (+27 -2 in 25ee2b3)
    - test/logs-session-of.test.js (+72 in 00331dd)
decisions:
  - id: D-01
    title: Reusar idiom LIFE-01 D-02 (priority sessions sobre history) sin abstraer helper compartido
    rationale: El cuerpo dual-scan en step-1 (12 LOC con 2 for-loops + Array.isArray guard) no justifica extraer findInBucket() — `src/session/state.js#findSession` y `src/logs/session-lookup.js#resolveSessionIdFromTaskId` tienen contratos distintos (3 lookup keys vs 2 task identifiers + return shape) y la coincidencia es estructural, no semántica. Regla 2 (simplicidad primero) + cambios quirúrgicos (Regla 3).
  - id: D-02
    title: Match por task_id || task_ref en ambos buckets sin diferenciar UUID vs humano
    rationale: SC#1 Truth 2 exige comportamiento idéntico entre sesiones vivas y archivadas. Step-1 ya hacía `task_id || task_ref` para sessions; replicar el check en history es la mínima extensión que cierra el gap empírico.
  - id: D-03
    title: Step-2 NDJSON scan preservado intacto
    rationale: Cubre sesiones huérfanas (logs presentes pero state.json limpiado por crash o `kodo gsd doctor` futuro). Step-1 dual-scan no lo hace redundante para ese caso edge. Plan explícitamente lo proteje en `<action>`.
metrics:
  duration: "~25 min"
  completed: 2026-05-20T12:18:41Z
  tasks_completed: 2
  files_created: 0
  files_modified: 2
  commits: 2
---

# Phase 30 Plan 04: Gap Closure SC#1 Truth 2 — session-lookup step-1 history scan Summary

Step-1 de `resolveSessionIdFromTaskId` extendido para escanear ambos buckets (`state.sessions` + `state.history`) con priority sessions y matching por `task_id || task_ref`, cerrando byte-exact el gap empírico de HUMAN-UAT Test #2 donde `kodo logs --session-of <task_ref-humano>` fallaba para sesiones archivadas.

## Driver

HUMAN-UAT Test #2 (SC#1 Truth 2 ROADMAP): el operador descubrió empíricamente que `kodo logs --session-of LIKEN-113` retornaba `No session found` tras el stop hook (sesión movida a `state.history` por `removeSession`). Causa raíz:

- Step-1 sólo iteraba `Object.values(state.sessions)` — sesión archivada no match.
- Step-2 (NDJSON head-line scan) sólo matchea por `task_id` UUID, NO por `task_ref` humano — el operador con `LIKEN-113` (task_ref) no resuelve aunque exista `<sessionId>.ndjson`.

Resultado: SC#1 Truth 2 literalmente incumplido — comportamiento divergente entre sesiones vivas y archivadas en el CLI.

## Changes

### Task 1 — Test RED (commit 00331dd)

`test/logs-session-of.test.js` +72 LOC bajo un nuevo describe `session-lookup step-1 — history scan (LIFE-01 closure)`:

1. **`resolves archived session by humano task_ref via state.history`** — escenario primario del gap empírico: `state.sessions = {}`, `state.history = [{task_ref: 'GAP-30', session_id: 'sess-archived-gap30', ...}]`, llamada con `'GAP-30'` (task_ref humano). Pre-fix falló con `actual=null, expected='sess-archived-gap30'`.
2. **`priority sessions over history (D-02 idiom)`** — regression para la ventana degenerada de `removeSession` (mismo task_ref en ambos buckets). Verifica que sessions gana sobre history. Este test ya pasaba pre-fix por construcción del step-1 original (sólo escaneaba sessions).

Test 1 RED confirmado vía `node --test test/logs-session-of.test.js` antes del fix.

### Task 2 — GREEN dual-scan (commit 25ee2b3)

`src/logs/session-lookup.js`: nuevo body de step-1 en `resolveSessionIdFromTaskId`:

```
const state = loadState();
const sessions = state.sessions || {};
const history = Array.isArray(state.history) ? state.history : [];

// Priority sessions (LIFE-01 D-02 idiom)
for (const s of Object.values(sessions)) {
  if (sess.task_id === taskId || sess.task_ref === taskId) return sess.session_id;
}
for (const h of history) {
  if (entry.task_id === taskId || entry.task_ref === taskId) return entry.session_id;
}
// Fall through a step-2 (NDJSON scan, sin cambios)
```

Comentario header del file actualizado para documentar el dual-scan y el driver (HUMAN-UAT Test #2). Step-2 NDJSON head-line scan **preservado intacto** (D-03) — sigue siendo el path para sesiones huérfanas.

## Verification

| Check | Result |
|-------|--------|
| `node --test test/logs-session-of.test.js test/session-of-resolver.test.js` | 10 pass / 0 fail |
| `grep -c "Array.isArray.*history" src/logs/session-lookup.js` | `1` (≥1 acceptance) |
| `npm test` full suite | 884 pass + 1 skip + 0 fail (885 total, +2 nuevos tests vs Wave 2 baseline) |
| Test RED → GREEN cycle | Confirmed via two-commit sequence (00331dd test fail → 25ee2b3 src fix → re-run pass) |
| Step-2 NDJSON preserved | `git diff 25ee2b3~1 25ee2b3 -- src/logs/session-lookup.js` muestra cero cambios en líneas 50-94 (step-2 body) |
| Step-1 dual-scan acceptance | Ambos tests del nuevo describe pasan (escenario archivado + priority) |

### Empirical re-test note

El re-test CLI empírico (`node bin/kodo logs --session-of LIKEN-113` retorna logs reales en lugar de `No session found`) lo realiza el orchestrator post-merge en el repo principal — el worktree no tiene `~/.kodo/state.json` real con la sesión LIKEN-113 archivada. La cobertura unitaria + targeted resolver es equivalente: el test añadido en Task 1 ejecuta la misma cadena (`resolveSessionIdFromTaskId` con task_ref humano sobre state.history seeded) que el CLI E2E.

## Deviations from Plan

None — plan executed exactly as written. La opción "extraer helper privado `findInBucket(bucket, taskId)`" (Claude's Discretion) NO se ejerció por D-01 (simplicidad: el body es 12 LOC con contrato divergente vs `findSession`; abstracción prematura no aporta).

## Auth Gates

None.

## Threat Flags

None — el cambio amplia la cobertura del resolver de lectura sin introducir nueva surface de auth, network, ni IO. `state.history` ya era leído por `listHistory`/`findSession` (LIFE-01 Phase 30 Plan 01); este plan agrega un consumer más para la misma fuente.

## Known Stubs

None.

## Plan Verification Criteria

| Criterion | Status |
|-----------|--------|
| Step-1 dual-scan implemented (sessions + history) | ✅ src/logs/session-lookup.js:30-50 |
| Priority sessions > history (D-02 idiom) | ✅ Verified by regression test (priority over history) |
| `kodo logs --session-of <task_ref>` resuelve sesiones archivadas | ✅ Verified by Task 1 test (archived session by humano task_ref) |
| Suite global ≥882 pass + 0 fail | ✅ 884 pass + 1 skip + 0 fail |
| Test añade escenario history-only matcheable por task_ref humano | ✅ Task 1 commit 00331dd |

## Commits

- `00331dd` — `test(30-04): add failing test for history-scan in session-lookup step-1`
- `25ee2b3` — `feat(30-04): extend session-lookup step-1 to scan state.history`

## Self-Check: PASSED

- src/logs/session-lookup.js: FOUND
- test/logs-session-of.test.js: FOUND
- Commit 00331dd: FOUND in history
- Commit 25ee2b3: FOUND in history
- No unintended file deletions
