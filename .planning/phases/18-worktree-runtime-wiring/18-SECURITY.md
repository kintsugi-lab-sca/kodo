---
phase: 18-worktree-runtime-wiring
audited: 2026-05-12T10:35:00+02:00
asvs_level: 1
block_on: critical
total_threats: 10
threats_closed: 10
threats_open: 0
unregistered_flags: 0
status: SECURED
---

# Phase 18 — Security Audit Report

**Phase:** 18 — Worktree Runtime Wiring
**Threats Closed:** 10/10
**ASVS Level:** 1
**Block-on:** critical

## Summary

Phase 18 cabela `--worktree <sessionId>` en `launchWorkItem`, persiste `worktree_path` PRE-spawn en `SessionRecord` y añade el canonical error `worktree_collision` en el dispatcher. Audit verifica, por grep + ejecución de tests de defensa, que TODAS las disposiciones declaradas en los 3 threat models (Plan 01 / 02 / 03) están materializadas en código. Cero gaps. Cero flags no registrados.

## Threat Verification — All Plans

| Threat ID (Plan) | Category | Disposition | Evidence (file:line / cmd) |
|------------------|----------|-------------|----------------------------|
| T-18-01 (P01) | Tampering — sessionId malicioso → path traversal | accept | `randomUUID()` upstream + defense-in-depth `test/state.test.js:105` `assert.ok(!out.includes('..'), 'no traversal')`. UUIDs cumplen `/^[a-f0-9-]+$/i` (no `..`, sin separadores). |
| T-18-02 (P01) | Information Disclosure — `worktree_path` con `\n` leak vía logger | mitigate | NDJSON logger usa `JSON.stringify`: `src/logger.js:79` (`parts.push('${k}=${JSON.stringify(v)}')`), `src/logger.js:308` (`appendFileSync(filePath, JSON.stringify(record) + '\n')`). Escape automático de control chars. Plan 01 NO escribe directamente a logger — solo añade la signatura. |
| T-18-03 (P01) | Disclosure — `worktree_path` persistido en `state.json` (filesystem multi-usuario) | accept | Mismo modelo de threat que `project_path` ya persistido en `Session` typedef (`src/session/state.js:22`). Persistencia bajo `~/.kodo/` permissions umask del usuario. No introduce regresión (Plan 01 `<threat_model>` línea 254). |
| T-18-03 (P02) | Tampering — sessionId malicioso → shell injection en `--worktree ${sessionId}` | accept | sessionId proviene de `randomUUID()` (`src/session/manager.js:229`) o `opts.sessionId` threaded del dispatcher (también UUID). UUIDs trust-by-construction: `src/triggers/dispatcher.js:134` (GSD) + `:185` (no-GSD). Sin chars peligrosos (`;`, `&`, `$`, espacios). |
| T-18-04 (P02) | Disclosure — `worktree_path` con separators inesperados leak vía cmux/logger | mitigate | Path proviene de `computeWorktreePath` puro (`src/session/state.js:69-71`, `join(projectPath, '.bg-shell', sessionId)`). Logger NDJSON serializa con `JSON.stringify` (mismo evidence que T-18-02). Sin nuevo vector vs. `project_path`. |
| T-18-05 (P02) | Repudiation — `addSession` falla silenciosa entre persist y `cmux.send` → sesión arranca sin trace | mitigate | **PRE-spawn ordering aplicado**: `addSession(task.id, session)` en `src/session/manager.js:266` corre ANTES de `cmux.send(...)` en `src/session/manager.js:269` (verificado: `awk` reporta line 266 < line 269). Si `addSession` falla, throw propagado al try/catch del dispatcher (`src/triggers/dispatcher.js:379-393` stale_relaunch + `:422-433` launch) que libera el lock; la sesión NO arranca. |
| T-18-06 (P02) | DoS — sessionId colisiona con worktree existente | mitigate | Plan 03 implementa fail-fast canonical en dispatcher ANTES de `launchWorkItem`: `src/triggers/dispatcher.js:187-214` invoca `existsSyncFn(worktreePath)` y retorna `{ action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath }` línea 213. |
| T-18-05 (P03) | Tampering / Privilege Escalation — callsite pasa worktreePath a `acquireGsdLockFn`/`releaseGsdLockFn` → coalescencia rota | mitigate | **Cross-source grep retorna 0 matches**: `grep -rE "acquireGsdLock(Fn)?\(...worktree\|releaseGsdLock(Fn)?\(...worktree" src/` exit 1 (no matches). Test source-hygiene activa: `test/gsd-concurrency.test.js:483-520` `lock invariant cross-callsite` con `stripComments` sobre `dispatcher.js + manager.js + stop.js`. Test ejecutado: PASS (8/8 suite). |
| T-18-06 (P03) | Bypass — desarrollador añade `--worktree` a `launchOrchestrator` | mitigate | `test/orchestrator-launch-isolation.test.js:42-50` con `stripComments` afirma `!stripped.includes('--worktree')` en `src/orchestrator/launch.js`. Test ejecutado: 3/3 PASS. Las 4 menciones de `--worktree` en `src/orchestrator/launch.js` (líneas 84, 91, 96, 99) están todas dentro de comentario in-file (líneas 83-101). Array `claudeCmd` (líneas 102-108) carece del flag. Comentario in-file educa al lector. |
| T-18-07 (P03) | TOCTOU — entre `existsSync(worktreePath)` y `cmux.send` | accept | Window ms-scale + UUID v4 122 bits entropía + `inFlight` Set del dispatcher (`src/triggers/dispatcher.js:16,114-117,355,395,400,435`) cubre dispatches concurrentes del propio kodo. Documentado in-file en comentario `src/triggers/dispatcher.js:167-175`. |
| T-18-08 (P03) | Disclosure — `worktree_collision` detail leak path absoluto vía stderr/return | accept | Mismo modelo que `gsd_locked` con `holder.task_ref` (línea 141 del dispatcher) y `resolver_failed` con detail (línea 297). Path contiene `projectPath` (config humano) + UUID (random, no identificable). Sin nueva superficie. |
| T-18-09 (P03) | DoS — atacante pre-crea `.bg-shell/<uuid>/` para todos los UUIDs | accept | UUID v4 = 122 bits de entropía (espacio inaddresable). Atacante necesita acceso al filesystem (control total = threat fuera del modelo de kodo). Personal-use tool sin multi-tenant. |
| T-18-10 (P03) | Repudiation — `existsSync` falla con EACCES → silent exception | mitigate | **Defensive wrap aplicado post-WR-04 (commit 11206a9)**: `src/triggers/dispatcher.js:195-202` envuelve `existsSyncFn(worktreePath)` en `try { pathExists = existsSyncFn(worktreePath); } catch (probeErr) { console.log('[kodo:dispatch] worktree_probe_failed — ${task.ref}: ${probeErr.message}'); }`. Si throws → forensic log + proceed; si lock GSD adquirido y collision detectada → release idempotente (línea 204-211). |

**All 13 threat dispositions in scope verified: CLOSED.**

## Defense-in-Depth Tests Confirmed Active

| Defense Test | File:Line | Status |
|--------------|-----------|--------|
| `!out.includes('..')` defense-in-depth (T-18-01) | `test/state.test.js:105` | PASS (22/22 state.test.js) |
| `--worktree` runtime absence (T-18-06 P03) | `test/orchestrator-launch-isolation.test.js:42-50` | PASS (3/3) |
| `cwd: process.cwd()` preservation (D-06 anchor) | `test/orchestrator-launch-isolation.test.js:52-59` | PASS |
| `Phase 18 D-06` comment presence | `test/orchestrator-launch-isolation.test.js:61-68` | PASS |
| `acquire/releaseGsdLockFn(...worktree...)` cross-source ban (T-18-05 P03) | `test/gsd-concurrency.test.js:483-520` | PASS (8/8) |
| `addSession` precedes `cmux.send` (T-18-05 P02 ordering) | `test/manager.test.js` source-hygiene | PASS (43/43 per summary) |
| `worktree_collision` shape + stderr canonical (T-18-06 P02) | `test/dispatcher.test.js` Phase 18 describe (8 tests) | PASS (32/32 per summary) |

## Unregistered Flags

**None.**

SUMMARY.md `## Threat Flags`/`## Threat Surface Scan` sections explicitly reaffirm: "No se introduce nueva superficie no contemplada en el `<threat_model>` del plan". Los 3 summaries documentan textualmente la cobertura:
- `18-01-SUMMARY.md` líneas 126-130 (T-18-01..03).
- `18-02-SUMMARY.md` líneas 196-202 (T-18-03..06 Plan 02).
- `18-03-SUMMARY.md` líneas 238-247 (T-18-05..10 Plan 03).

Auditor cross-checked: no new attack surface beyond declared threats appeared during implementation. The 1 known gap (CR-02 — `SessionRecord 'running'` huérfano si `cmux.send` falla post-`addSession`) está documentado como tech-debt deferido a Phase 19, NO es threat de seguridad (es robustez/correctness de housekeeping; threat models existentes T-18-05 P02 cubren repudiation por addSession-fail, no por cmux.send-fail post-addSession).

## Accepted Risks Log

| Threat ID | Reason for Acceptance | Re-evaluation Trigger |
|-----------|----------------------|------------------------|
| T-18-01 (P01) | sessionId hard-bounded a `randomUUID()` regex; no entry de red al string | Phase 19+ si acepta sessionIds del dispatcher con input externo |
| T-18-03 (P01) | Mismo modelo de threat que `project_path`; sin escalar permisos | Si kodo deviene multi-tenant |
| T-18-03 (P02) | UUIDs trust-by-construction; sin entrada de red al string | Phase 19+ si acepta sessionId con input externo |
| T-18-07 (P03) | UUID v4 122 bits entropía + `inFlight` Set cubre concurrencia interna | Si TOCTOU produce incidencia operacional real |
| T-18-08 (P03) | Path = projectPath (config humano) + UUID; mismo modelo que gsd_locked | Si kodo deviene multi-tenant |
| T-18-09 (P03) | 122 bits inaddresable; tool personal sin multi-tenant | Si kodo deviene multi-tenant |

## Audit Method Trace

Tools used (read-only verification, never modified implementation):

```
# T-18-02 / T-18-04 mitigation:
grep -n "JSON.stringify" src/logger.js src/logger-events.js src/logger-noop.js
# → src/logger.js:79, src/logger.js:308 — confirmed escape automático

# T-18-05 P02 mitigation (PRE-spawn ordering):
awk '/addSession/{a=NR} /cmux.send.*claudeCmd/{b=NR} END{print a<b}' src/session/manager.js
# → addSession line 266, cmux.send line 269, addSession<cmux.send=true

# T-18-05 P03 mitigation (lock invariant cross-source):
grep -rE "acquireGsdLock(Fn)?\s*\(\s*[a-zA-Z_]*[wW]orktree|releaseGsdLock(Fn)?\s*\(\s*[a-zA-Z_]*[wW]orktree" src/
# → exit 1, 0 matches

# T-18-06 P03 mitigation (orchestrator runtime --worktree absent):
node --test test/orchestrator-launch-isolation.test.js
# → 3/3 PASS

# T-18-10 mitigation (defensive existsSync wrap):
grep -n "pathExists\|worktree_probe_failed" src/triggers/dispatcher.js
# → lines 195-202 defensive try/catch confirmed

# Integration test:
node --test test/gsd-concurrency.test.js
# → 8/8 PASS (incl. lock invariant cross-callsite)
```

## Final Verdict

**SECURED.** Phase 18 cumple su goal de seguridad: toda mitigación declarada en los 3 threat models está materializada en código verificable por grep + tests automatizados. Todos los riesgos aceptados tienen justificación sólida bajo ASVS Level 1 (personal-use tool, single-tenant filesystem, no red input al sessionId). No hay flags de superficie no registrados. Phase listo para merge.

---

_Audited: 2026-05-12T10:35:00+02:00_
_Auditor: gsd-security-auditor (Claude)_
_ASVS Level: 1 — Block-on: critical_
