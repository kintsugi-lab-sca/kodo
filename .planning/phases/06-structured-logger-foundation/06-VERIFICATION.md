---
phase: 06-structured-logger-foundation
verified: 2026-04-15T22:18:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "LOG-12: kodo check vigilante respeta presupuesto de arranque (<50ms)"
    reason: "Decisión B (06-CONTEXT.md + commit c5c6b22): kodo check no es vigilante puro (hace HTTP Plane + spawn cmux, mediana 65.8s). Threshold mecánico sería ruido. LOG-12 queda cubierto por test de grafo de imports (check-isolation.test.js 4/4 PASS) que es la garantía arquitectónica real. Startup-budget.test.js demotizado a it.skip() con código mock preservado para reactivación tras refactor futuro de check.js."
    accepted_by: "alex"
    accepted_at: "2026-04-15T22:00:00Z"
requirements_covered:
  - LOG-01
  - LOG-02
  - LOG-03
  - LOG-04
  - LOG-08
  - LOG-12
---

# Phase 06: Structured Logger Foundation — Verification Report

**Phase Goal:** Crear `src/logger.js` — factory NDJSON con redacción de secretos, espejo stderr pretty-print y aislamiento estricto del vigilante `kodo check`.

**Verified:** 2026-04-15T22:18:00Z
**Status:** PASSED
**Re-verification:** No (verificación inicial tras cierre de 4 waves)

---

## Goal Achievement

### Observable Truths (por requirement)

| # | Requirement | Truth | Status | Evidence |
|---|-------------|-------|--------|----------|
| 1 | LOG-01 | 4 niveles (debug/info/warn/error) con filtrado por `minLevel` | VERIFIED | `src/logger.js:25` LEVELS frozen; `:152` createLogger valida minLevel; `:191` filtra por LEVELS[level] < minLevelNum. Tests `test/logger.test.js` — 3 it pasan. |
| 2 | LOG-02 | Logs NDJSON con `timestamp` ISO-8601 + `level` + `component` + `msg` + ctx libre | VERIFIED | `src/logger.js:192-198` construye rawRecord con timestamp ISO + level + ...boundFields + msg + ...ctx; `:209` appendFileSync con `+ '\n'`. Test LOG-02 asserta shape + merge top-level. 2 it PASS. |
| 3 | LOG-03 | Sesión escribe en `~/.kodo/logs/<session-id>.ndjson` con correlación (session_id, plane_task_id, phase_id) | VERIFIED | `:160-162` join(KODO_DIR, 'logs', `${sessionId}.ndjson`); `:167` session_id bindeado en raíz; `:176` child() mergea bindings. Test LOG-03 verifica existencia de archivo + merge de plane_task_id/phase_id. 2 it PASS. |
| 4 | LOG-04 | Consola muestra pretty-print a stderr sin duplicar JSON | VERIFIED | `:223-238` maybeMirrorToStderr formato `HH:MM:SS LEVEL comp msg +ctx` — no `JSON.stringify`. Test LOG-04 captura stderr y asserta que ninguna línea empieza con `{`. 2 it PASS. |
| 5 | LOG-08 | Logger redacta secretos (PLANE_API_KEY, Authorization, x-plane-signature, JWT-like) antes de disco/consola | VERIFIED | `:61-71` SENSITIVE_KEYS closed set (9 keys); `:77` JWT_RE; `:80` BEARERY_RE; `:99-132` redact() deep-walk con MAX_DEPTH=4; `:201` `redact(rawRecord)` ANTES de ambos sinks. Test grep-based sobre archivo NDJSON persistido: 3 it PASS. |
| 6 | LOG-12 | `kodo check` no carga el logger transitivamente | VERIFIED (con override parcial) | `test/check-isolation.test.js` 4 it PASS (sanity + noop zero-imports + walker transitivo con regex dual + whitelist noop). Smoke negativo ejecutado en 06-04 confirma que inyectar `import './logger.js'` rompe el test. Componente de startup-budget demotizado — ver override. |

**Score:** 6/6 requirements verificados (1 con override documentado).

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Data Flows | Status |
|----------|----------|--------|-------------|-------|------------|--------|
| `src/logger.js` | createLogger factory + NDJSON + stderr + redact | Yes (258 LoC) | Yes | N/A (no consumers in phase 6) | Yes (writes to KODO_DIR/logs) | VERIFIED |
| `src/logger-noop.js` | Zero-imports noop stub | Yes (28 LoC) | Yes | N/A (reserved for phase 7 consumers) | N/A | VERIFIED |
| `test/logger.test.js` | LOG-01..LOG-04 coverage | Yes (96 LoC) | Yes (8 it PASS) | Yes (imports src/logger.js) | Yes | VERIFIED |
| `test/logger-redaction.test.js` | LOG-08 grep-based | Yes (47 LoC) | Yes (3 it PASS) | Yes | Yes | VERIFIED |
| `test/check-isolation.test.js` | LOG-12 import-graph guard | Yes (108 LoC) | Yes (4 it PASS) | Yes (walker desde src/check.js) | Yes | VERIFIED |
| `test/startup-budget.test.js` | LOG-12 startup perf | Yes (77 LoC) | it.skip() intencional + mock preservado | N/A | N/A | PASSED (override) |
| `test/helpers/logger-fixtures.js` | makeTmpHome, readAllLines | Yes (29 LoC) | Yes (used by 2 test files) | Yes | Yes | VERIFIED |
| `test/helpers/startup-baseline.js` | baseline measurement helper | Yes (26 LoC) | Yes (preservado para invocación manual) | N/A | N/A | VERIFIED |
| `.planning/phases/06-structured-logger-foundation/STARTUP-BASELINE.md` | baseline + Post-phase | Yes | Yes (Pre + Post + Decision sections) | N/A | N/A | VERIFIED |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/logger.js` | `src/config.js` | `import { KODO_DIR }` | WIRED | `logger.js:18` — reutiliza path canonical, no duplica homedir resolution |
| `src/logger.js` | `src/logger-noop.js` | `export { noopLogger } from` | WIRED | `logger.js:22` re-export para ergonomía de consumidores |
| `src/check.js` | `src/logger.js` | — | CORRECTLY NOT WIRED | LOG-12: grep `from.*logger` en check.js = 0 matches. Walker transitivo 4-test PASS. |
| `src/logger-noop.js` | (nothing) | zero imports | VERIFIED | `grep -c "^\s*import\s" src/logger-noop.js` = 0. Validado en test 2 de check-isolation. |
| redact() | emit() sinks | `redact(rawRecord)` antes de writeNdjson + maybeMirrorToStderr | WIRED | `logger.js:201-203` — una sola pasada, sin drift entre canales |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite pasa | `npm test` | 140 tests / 139 pass / 0 fail / 1 skip / duration 286ms | PASS |
| `src/logger-noop.js` zero imports | `grep -c "^\s*import\s" src/logger-noop.js` | 0 | PASS |
| `src/check.js` no importa logger.js | `grep -E "from.*logger" src/check.js` | (no output) | PASS |
| Fix stderr mirror aplicado | `grep -n "process\.stderr\.write\|writeSync\(2" src/logger.js` | líneas 213 + 237 (ambas `process.stderr.write`), 0 matches de `writeSync(2`. Commit eebe83c confirmado. | PASS |
| Decisión B commit presente | `git log --all \| grep c5c6b22` | `c5c6b22 docs(06): record Decision B — budget test demoted to informative (LOG-12)` | PASS |

### Mid-flight Orchestrator Decisions — Validación

1. **Fix post-merge stderr write (commit eebe83c):** VALIDATED. `src/logger.js:213` y `:237` usan `process.stderr.write(...)` en lugar de `writeSync(2, ...)`. Esto permite al mock `t.mock.method(process.stderr, 'write', ...)` en tests LOG-04 y LOG-08 capturar el output. Sin este fix, los tests de stderr anti-duplication y redacción del mirror fallarían por no poder interceptar el canal. Decisión correcta: determinismo del test sobre la invariante "no monkey-patcheable".

2. **Decisión B — startup-budget demotion (commit c5c6b22):** VALIDATED como override razonado. La justificación es defendible:
   - El baseline empírico (mediana 65.8s, dispersión 11× entre min/max) confirma que `kodo check` no es vigilante puro; cualquier threshold mecánico enmascara ruido de red, no regresión de imports.
   - La garantía arquitectónica de LOG-12 ("el logger no se carga transitivamente") **sí** queda cubierta por `test/check-isolation.test.js` con 4 aserciones endurecidas, incluyendo regex dual que cubre side-effect imports (`import './logger.js';`) que el walker original se tragaba silenciosamente.
   - El código mock del test queda preservado para reactivación tras refactor futuro de `check.js` (separar snapshot/act), documentado explícitamente en el header y en STARTUP-BASELINE.md.
   - Alternativas descartadas correctamente: subir THRESHOLD_MS a 75s enmascararía regresiones reales; eliminar el archivo perdería el punto de reactivación.

### Anti-Patterns Found

Ninguno. Scan de `src/logger.js`, `src/logger-noop.js` y los 4 test files:

| Pattern | Matches | Severity |
|---------|---------|----------|
| TODO / FIXME / PLACEHOLDER | 0 (solo "deferred" en comentarios de scope futuro, no en código) | — |
| `return null` / `return {}` / `() => {}` | Solo noopLogger (intencional: es un no-op) y `maybeMirrorToStderr` returns temprano condicionales | ℹ️ Info (by design) |
| Hardcoded empty data | N/A — todo el estado viene de argumentos del factory | — |
| console.log only | 0 matches | — |

### Requirements Coverage (tabla final)

| Requirement | Plan Source | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| LOG-01 | 06-01 + 06-02 | 4 niveles configurables por env/flag | SATISFIED | src/logger.js:25 LEVELS; minLevel validado; test/logger.test.js:12-32 3/3 PASS |
| LOG-02 | 06-01 + 06-02 | NDJSON shape con campos base + ctx | SATISFIED | emit() construye record; test LOG-02 2/2 PASS |
| LOG-03 | 06-01 + 06-02 | `~/.kodo/logs/<session>.ndjson` + child bindings | SATISFIED | KODO_DIR reuse; child() merge; test LOG-03 2/2 PASS |
| LOG-04 | 06-01 + 06-02 | stderr pretty-print sin JSON duplicado | SATISFIED | maybeMirrorToStderr; test LOG-04 2/2 PASS con mock stderr |
| LOG-08 | 06-01 + 06-03 | Redact antes de disco/consola (SENSITIVE_KEYS + JWT/Bearer regex) | SATISFIED | redact() deep-walk MAX_DEPTH=4; test LOG-08 3/3 PASS (grep sobre archivo) |
| LOG-12 | 06-01 + 06-04 | `kodo check` no carga logger transitivamente | SATISFIED (con override de componente startup-budget) | check-isolation.test.js 4/4 PASS con smoke negativo verificado; startup-budget demotizado por Decisión B |

**Orphaned requirements:** ninguno. Los 6 requirements mapeados a Phase 6 en REQUIREMENTS.md están presentes en las frontmatter `requirements:` de los 4 plans de la fase.

**Out-of-phase:** LOG-05..LOG-07 (CLI `kodo logs`), LOG-09..LOG-11 (taxonomía eventos + correlación `--session-of`) pertenecen explícitamente a Phase 7 (confirmado en REQUIREMENTS.md:92-98 y 06-CONTEXT.md domain). No se verifica su cobertura en esta fase.

---

## Residual Risk & Known Trade-offs (aceptados explícitamente en 06-03 threat_model)

| Riesgo | Severidad | Mitigación actual | Acción recomendada |
|--------|-----------|-------------------|-------------------|
| T-6-03-03: Secret embebido en frase (`"x=Bearer plane_xxx and y=z"`) no se redacta (regex con anchors `^...$`) | Media | Convención de callsites: pasar secretos como valor de key sensible, no interpolar en `msg` | Lint rule en Phase 7 que detecte interpolación de PLANE_API_KEY en template strings |
| T-6-03-04: Secret en `msg` natural (sin key conocida) — regex aplica pero no captura si no es shape exacto de JWT/Bearer | Baja | Convención documentada en 06-CONTEXT.md | Code review + lint |
| T-6-03-02: Falso positivo en JWTs legítimos (cualquier valor `eyJ...` se redacta) | Muy baja | Plane usa UUIDs v4 para task IDs, no JWTs. Verificado manualmente: session_id/plane_task_id/phase_id no matchean | Allow-list per campo si Phase 7+ introduce payloads con `eyJ...` legítimo |
| Startup-budget guard desactivado | Media | Test de grafo de imports cubre la garantía arquitectónica real. Helper preservado para invocación manual | Refactor futuro de check.js (snapshot/act) reactiva `it.skip()` — OUT OF SCOPE Phase 6 |

---

## Deuda transferible a Phase 7 (explícita, no accidental)

Items identificados como deferred en 06-CONTEXT.md `<deferred>` o referenciados por los plans como fuera de alcance:

1. **LOG-05/06/07 — CLI `kodo logs`** — enteramente Phase 7. El logger actual escribe el NDJSON que Phase 7 consumirá.
2. **LOG-09 — taxonomía de eventos estructurados** (`session.start`, `state.transition`, etc.). El logger actual provee el canal; los callsites con `log.info('session.start', {...})` se cablean en Phase 7-10.
3. **LOG-10 — transcript path en `session.start`** — depende de la taxonomía LOG-09.
4. **LOG-11 — `kodo logs --session-of <plane-task-id>`** — requiere índice/lookup sobre archivos NDJSON, Phase 7.
5. **Refactor de `check.js`** (separar status snapshot de act on status) — reactiva `startup-budget.test.js`. Explícitamente fuera de Phase 6 (06-CONTEXT.md Decisión B y Plan 06-04 Task 4.2).
6. **Consumers (DI del logger)** — `src/session/manager.js`, `src/plane/client.js`, `src/cmux/client.js`, `src/hooks/*.js`, `src/orchestrator/launch.js` deben recibir un logger por DI. Phase 6 provee la factory; el cableado es Phase 7+.
7. **Precedencia exacta flag CLI `--log-level` vs `KODO_LOG_LEVEL`** — Phase 6 acepta ambos canales en la API, pero el parseo vive en `bin/kodo` / `src/cli.js` (Phase 7 CLI wiring).
8. **Lint rule de no-interpolación de secretos** — mitiga T-6-03-03/04. Phase 7 o posterior.

Todos estos items están correctamente mapeados a Phase 7 en REQUIREMENTS.md:92-98 o son refactors explícitos fuera de scope. **Ninguno constituye gap de Phase 6.**

---

## Human Verification Required

Ninguno. Todos los checks se verificaron automáticamente:
- Tests end-to-end con archivo NDJSON real (grep sobre disco) cubren LOG-01..LOG-04 + LOG-08.
- Mock de stderr captura pretty-print para validar LOG-04 + LOG-08 mirror.
- Walker transitivo de imports cubre LOG-12 con smoke negativo ejecutado.
- Fases siguientes (7+) harán verificación visual/TTY cuando el CLI exista.

---

## Gaps Summary

**Ninguno bloqueante.**

Phase 6 cierra la foundation del logger estructurado: factory NDJSON, child bindings, stderr pretty-print sin duplicación, redactor deep-walk con dual strategy (SENSITIVE_KEYS + regex JWT/Bearer) y aislamiento verificado del vigilante `kodo check` mediante walker de grafo con regex dual que cierra la fuga silenciosa de side-effect imports.

Las 6 requirements mapeadas (LOG-01, LOG-02, LOG-03, LOG-04, LOG-08, LOG-12) están satisfechas con evidencia ejecutable (139 pass / 1 skip intencional / 0 fail). La Decisión B sobre el componente startup-budget de LOG-12 está documentada, trazada a un commit específico (c5c6b22), defendida con medición empírica (baseline pre y post-phase) y aceptada como override con plan explícito de reactivación.

**Status final: PASSED.**

---

_Verified: 2026-04-15T22:18:00Z_
_Verifier: Claude (gsd-verifier)_
