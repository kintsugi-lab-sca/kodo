---
phase: 16
slug: log-09-debt-cleanup
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-06
---

# Phase 16 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Phase 16 cierra LOG-09 debt: migra `dispatcher.js` de literales a `EVENTS.GSD_PHASE_RESOLVED` (LOG-13), cablea `markSessionStatus` en `verify.js` post-pass (LOG-14) y en `stop.js` PRE-release del lock (LOG-15). Todas las amenazas declaradas en los 3 plans (T-16-01..T-16-19) verificadas contra código fuente; cada una resolviendo a CLOSED por evidencia directa de implementación o por entrada en el accepted risks log con rationale alineado con el código.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Trigger handler → logger (NDJSON) | `dispatcher.js` emite `gsd.phase.resolved` / `gsd.bootstrap` desde handler de webhook | Estado de la fase GSD (matched/code/tolerated/error_code/detail/task_ref/mode) |
| `verify.js` → `manager.js#markSessionStatus` | Invocación interna que muta `state.json` y emite `state.transition` vía logger child | session.task_id, fromStatus (read), nextStatus='review', reason='gate-passed' |
| `stop.js` → `manager.js#markSessionStatus` | Invocación interna lazy-imported PRE-release del lock per-repo | session.task_id, fromStatus (read), nextStatus='done', reason='session-stop:lock-released' |
| `manager.js` → `state.json` (filesystem) | `updateSession` → `saveState` → `writeFileSync` | Session record completo (status mutation) |
| `runStopHook` (export) → tests | Surface pública añadida por refactor light DI (W-4) | Inyectables: findSessionFn, removeSessionFn, cmux, loggerFactory |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-16-01 | T (Tampering) | `dispatcher.js` EVENTS import | mitigate | `import { EVENTS } from '../logger-events.js'` en `src/triggers/dispatcher.js:12`; 4 callsites usan `EVENTS.GSD_PHASE_RESOLVED` (líneas 184, 185, 211, 212); `test/dispatcher-isolation.test.js:53-63` enforce import via regex. | closed |
| T-16-02 | I (Info disclosure) | NDJSON event payloads | accept | Sin nuevos campos — migración 1-a-1 literal→constante preserva shape byte-a-byte. Ver Accepted Risks Log A-16-02. | closed |
| T-16-03 | D (DoS) | logger failure blocking dispatch | mitigate | Try/catch silent preservado byte-a-byte alrededor de los 2 emisores migrados (`dispatcher.js:178-195` con `// silent — never block dispatch on logger failure`; `dispatcher.js:205-221` análogo para warn). | closed |
| T-16-04 | R (Repudiation) | regression del literal | mitigate | `test/dispatcher-isolation.test.js:1-64` con 3 asserts comment-aware (2 negative literal-absence + 1 positive import). Test corre vía `node --test` en suite global. | closed |
| T-16-05 | T (Tampering) | LOG-12 guard regression (dispatcher) | mitigate | `logger-events.js` solo importa `node:os` + `node:path` (sin side effects); `test/check-isolation.test.js` sigue verde (ver `16-01-SUMMARY.md` línea 66). El nuevo import eager no añade nodos al grafo de `check.js`. | closed |
| T-16-06 | T (Tampering) | state.transition contract drift | mitigate | T20 SC#2 positive en `test/gsd-verify-integration.test.js:131-139` verifica `transition.fields.to === 'review'`, `reason === 'gate-passed'`, `from` no vacío. Filter discriminator por `e.fields?.event === 'state.transition'` (no por `msg`). | closed |
| T-16-07 | I (Info disclosure) | state.transition payload | accept | Campos `from`/`to`/`reason` son enum + reason informativo; sin PII. Ver Accepted Risks Log A-16-07. | closed |
| T-16-08 | E (Elevation) | markSessionStatus en rama equivocada (verify) | mitigate | `verify.js:258` invocación DENTRO del try de `updateTaskState`, después de `transitioned = true`. T21 (soft-fail), T22 (malformed), T23 (missing), T24 (getTask-fail), T26 (hard-fail), T27 (updateTaskState-fail) en `gsd-verify-integration.test.js` asertan `transition === undefined` (líneas 182-187, 215-216, 236-237, 280-285, 338-343, 383-388). | closed |
| T-16-09 | D (DoS) | logger failure blocking verify pipeline | accept (originalmente) → MITIGADO durante CR-01 fix | Plan declaraba `accept` (fail-fast). Code review CR-01 detectó violación de invariante D-17 (orchestrator.review nunca emitido si `markSessionStatus` lanza por fs error). Resolución iteración 1 (commit `68de9ca`): try/catch silencioso aplicado en `verify.js:257-261`. Disposition revisada a mitigate de facto. | closed |
| T-16-10 | T (Tampering) | LOG-12 guard regression (verify) | mitigate | `manager.js` ya estaba en grafo de `verify.js` desde Phase 11; nuevo import named no añade nodo nuevo. `test/check-isolation.test.js` exit 0 (ver `16-02-SUMMARY.md` línea 189). | closed |
| T-16-11 | R (Repudiation) | Phase 10 D-11/D-12 order regression | mitigate | T27 centinela del orden en `gsd-verify-integration.test.js:346-394`: si `markSessionStatus` se moviera afuera del try, T27 caería con assertion message explícito citando D-11. | closed |
| T-16-12 | D (DoS) | logger failure blocking lock release | mitigate | `stop.js:179-193` try/catch silent envuelve creación de logger + `markSessionStatus` con comentario `// silent — never block lock release on logger failure (mirrors session.end pattern line 116)`. Verificado via grep: 1 ocurrencia exacta. | closed |
| T-16-13 | T (Tampering) | state.transition con `to` incorrecto | mitigate | `stop.js:190` literal `'done'` hardcoded; sin acceso a `session.gsd_mode` (`grep -c "session.gsd_mode" === 0`). Test 4 D-04 invariante MANDATORY en `stop-state-transition.test.js:267-314` asserta `to === 'done'` para ambos modos. | closed |
| T-16-14 | E (Elevation) | markSessionStatus en rama no-GSD | mitigate | `stop.js:172` única ocurrencia de `if (session.gsd)`; `markSessionStatus` línea 190 dentro del bloque (verificado por inspección visual + grep `if (session.gsd) === 1`). Test 3 (`stop-state-transition.test.js:226-262`) asserta `transition === undefined` para `gsd:false`. | closed |
| T-16-15 | R (Repudiation) | Phase 13 D-09/D-10 anti-inline regression | mitigate | `grep -c "session.gsd_mode" src/hooks/stop.js === 0` (verificado). Phase 16 solo lee `session.task_id`, `session_id`, `project_path`, `gsd`, `status`. `test/stop.test.js` source-hygiene tests siguen verdes. | closed |
| T-16-16 | T (Tampering) | LOG-12 guard regression (stop) | mitigate | Lazy dynamic import de `manager.js` en `stop.js:189`. `manager.js` ya en grafo de stop.js indirectamente; sin nodo nuevo en `check.js`. `test/check-isolation.test.js` exit 0. | closed |
| T-16-17 | I (Info disclosure) | runStopHook export expone interno | accept | Export para tests unitarios (mismo patrón que `runGsdVerify`). Sin secrets ni privilegio adicional. Ver Accepted Risks Log A-16-17. | closed |
| T-16-18 | D (DoS) | hook stop crash on unexpected input | accept | `runStopHook` envuelve cuerpo en try/catch top-level (`stop.js:102-221`); `main()` parsea stdin y delega. Ver Accepted Risks Log A-16-18. | closed |
| T-16-19 | T (Tampering) | sessionEnd event drop tras refactor (W-2) | mitigate | `grep -c "sessionEnd(log" === 1` (línea 161). Orden preservado: `awk` confirma `sessionEnd line 161 < removeSessionFn line 203` (W-2 invariante "emit BEFORE mutation"). | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| A-16-02 | T-16-02 | Migración LOG-13 es 1-a-1 literal→constante (`EVENTS.GSD_PHASE_RESOLVED === 'gsd.phase.resolved'` por valor); shape inline byte-idéntico al pre-Phase 16 (Phase 9 review previo). Sin nueva superficie de información. | Phase 16 Plan 01 (16-01-PLAN.md threat register) | 2026-05-06 |
| A-16-07 | T-16-07 | `state.transition` payload contiene `{from, to, reason}` — enum status + reason informativo (`'gate-passed'`, `'session-stop:lock-released'`). Logger redaction Phase 6 ya aplicado upstream para session_id/task_id si fuera necesario. Sin nueva PII expuesta. | Phase 16 Plan 02 (16-02-PLAN.md threat register) | 2026-05-06 |
| A-16-17 | T-16-17 | `export async function runStopHook(input, deps)` espeja patrón establecido por `runGsdVerify(opts, deps)` Phase 10. Los 4 deps inyectables (W-4) son funciones internas ya importadas por stop.js — no leak adicional. Solo accesible vía import desde test files; runtime productivo invoca `main()` que delega a runStopHook. | Phase 16 Plan 03 (16-03-PLAN.md threat register) | 2026-05-06 |
| A-16-18 | T-16-18 | `runStopHook` envuelve cuerpo en try/catch top-level (`stop.js:102-221`) con `console.error` non-blocking; `main()` parsea stdin antes de delegar. Garantía pre-Phase 16 preservada — el hook NUNCA crashea Claude Code. | Phase 16 Plan 03 (16-03-PLAN.md threat register) | 2026-05-06 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-06 | 19 | 19 | 0 | gsd-secure-phase auditor (manual verification — grep + Read against committed source) |

### Verification Notes

- **T-16-09 disposition reclassified mid-phase:** plan declaraba `accept` (fail-fast deliberado), pero code review iteración 1 (`16-REVIEW.md` CR-01, commit `68de9ca`) aplicó try/catch local al `markSessionStatus` en `verify.js:257-261` para preservar invariante D-17. La disposición efectiva es ahora `mitigate`. Disposición revisada documentada en threat register table arriba.
- **CR-02 (test pollution `~/.kodo/state.json` real):** auditor confirma que `test/stop-state-transition.test.js` aplica el fix de la review iteración 1 (`97218d9`): override de `HOME` con `mkdtempSync` (líneas 100-126) + dynamic import de `state.js` post-override (líneas 112-114). No es un threat declarado del plan, pero se nota aquí como evidencia de hardening adicional.
- **Phase 16 REVIEW open warnings:** WR-01..WR-08 documentadas en `16-REVIEW.md` líneas 116-292; ninguna corresponde a un threat declarado. Quedan como deuda fuera de scope (incluyendo IN-04 sobre comentario "line 116" desactualizado, presente en `stop.js:175,192`).

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log (4 entries: A-16-02, A-16-07, A-16-17, A-16-18)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

---

## Cross-references

- **`test/dispatcher-isolation.test.js`** — 3 asserts comment-aware (LOG-13 guard); bloquea reintroducción de literal `'gsd.phase.resolved'` o `'gsd.bootstrap'` en código no-comment de dispatcher.js
- **`test/gsd-verify-integration.test.js`** — T20 (SC#2 positive), T21/T22/T23/T24/T26/T27 (SC#3 negative — 6 ramas no-pass + centinela orden D-11)
- **`test/stop-state-transition.test.js`** — 4 escenarios SC#5 (full D-05, quick, no-GSD D-07, D-04 invariante MANDATORY) con DI completa W-4
- **`test/check-isolation.test.js`** — LOG-12 invariante preservado tras los 3 nuevos imports (eager EVENTS, eager markSessionStatus en verify, lazy markSessionStatus en stop)
- **`test/stop.test.js`** — Phase 13 D-09/D-10 anti-inline source-hygiene tests siguen verdes (`grep session.gsd_mode === 0` en stop.js)
- **`16-REVIEW.md`** — code review iteración 1 con BLOCKERS CR-01 (D-17 contract preserved via try/catch en verify.js) y CR-02 (state.json pollution fix) ya resueltos en commits `68de9ca` y `97218d9`
