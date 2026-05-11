# Phase 17: Phase 7 UAT Automation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-07
**Phase:** 17-phase-7-uat-automation
**Areas discussed:** Spawn shape, UAT-01 follow, UAT-02 session.start, UAT-03 session-of + 07-HUMAN-UAT fate

---

## Spawn shape (transversal)

### Q1 — Shape de invocación

| Option | Description | Selected |
|--------|-------------|----------|
| Subprocess real (node bin/kodo) | Ejerce CLI plumbing real (commander, exit codes, stdout pipes). Precedente en `gsd-verify-cli-handler.test.js`, `version-smoke.test.js`. | ✓ |
| Import directo (followFile/emit) | Más rápido, no ejerce wiring CLI. | |
| Mixto: subprocess para --follow, import para session.start | Inconsistente; UAT-02 también gana ejerciendo entry point real. | |

### Q2 — Aislamiento KODO_DIR

| Option | Description | Selected |
|--------|-------------|----------|
| Override HOME en spawn env | `{ env: { ...process.env, HOME: tmpDir } }`. Kodo computa KODO_DIR al import-time desde homedir(). | ✓ |
| Variable env KODO_DIR explícita | Añade superficie pública no pedida. | |
| cwd override + path relativo | Rompe convención `~/.kodo`. | |

### Q3 — Binario / entry point

| Option | Description | Selected |
|--------|-------------|----------|
| node + ruta absoluta a bin/kodo | `process.execPath` + `path.resolve(repoRoot, 'bin/kodo')`. | ✓ |
| node + bin/kodo via package.json bin | `require.resolve` indirecto, frágil. | |
| node + src/hooks/session-start.js directo | Combinable con bin/kodo (UAT-02 sí, UAT-01/03 no). | |

### Q4 — UAT-02 path (clarificación)

| Option | Description | Selected |
|--------|-------------|----------|
| node + src/hooks/session-start.js directo | Mismo entry point que Claude Code en producción. UAT-01/03 mantienen `bin/kodo logs`. | ✓ |
| bin/kodo con subcomando "emit-session-start" nuevo | Crea superficie pública innecesaria. | |

**User's choice:** Subprocess real con `process.execPath` + ruta absoluta a `bin/kodo` (UAT-01/03) y a `src/hooks/session-start.js` (UAT-02). HOME override en env.
**Notes:** El claim inicial "bin/kodo para todo" se corrigió en Q4 — el hook se invoca directamente en producción, no via bin/kodo. Coherencia restaurada.

---

## UAT-01 — follow

### Q1 — Progresión NDJSON

| Option | Description | Selected |
|--------|-------------|----------|
| 3 batches con setInterval ~250ms | ≥ FOLLOW_INTERVAL_MS=200ms, fiel al caso real. | ✓ |
| Override FOLLOW_INTERVAL_MS via env | Superficie test-only. | |
| Pre-popular + appendFileSync 1 línea | Menos cobertura del path live progresivo. | |

### Q2 — Verificación de orden

| Option | Description | Selected |
|--------|-------------|----------|
| Stdout drain incremental con awaitLine() | Promise resuelve con el sentinel; verifica orden estricto. | ✓ |
| Timeout fijo + lectura total | Flaky bajo carga, no verifica orden temporal. | |
| Polling con condición sobre buffer | Equivalente menos limpio a (1). | |

### Q3 — Cleanup del watcher

| Option | Description | Selected |
|--------|-------------|----------|
| child.kill('SIGINT') + awaitExit timeout 2s | Confiamos en el SIGINT handler real de followFile (unwatchFile + exit(0)). | ✓ |
| SIGINT + assert handles abiertos del proceso de TEST | El watcher vive en el child; assert no aplica. | |
| SIGTERM | No tiene handler específico → no refleja Ctrl+C. | |

### Q4 — Pre-creación del archivo

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-crear vacío + escribir progresivamente | Path principal de la UAT. | ✓ |
| No pre-crear: cubrir "waiting..." | Caso secundario. | |
| Cubrir ambos en tests separados | Duplica setup; discrecional. | |

**User's choice:** 3 batches setInterval ~250ms, awaitLine incremental, SIGINT + timeout 2s, pre-crear vacío.
**Notes:** El path "waiting for session log to appear" queda explícitamente deferred.

---

## UAT-02 — session.start

### Q1 — Driver del evento

| Option | Description | Selected |
|--------|-------------|----------|
| state.json sintético + stdin con session_id | Hook lee state.json normalmente; fiel al flujo Claude Code. | ✓ |
| Stdin con TODOS los datos | Salta `findSessionBySessionId`, pierde fidelidad. | |
| Spawn bin/kodo simulando webhook | Acumula superficie irrelevante (cmux, plane). | |

### Q2 — Asserts contra contrato

| Option | Description | Selected |
|--------|-------------|----------|
| Helper sessionStart() de logger-events.js como fuente de verdad | Cambio del contrato rompe el test (objetivo SC#2). | ✓ |
| Fixture estático esperado en JSON | No detecta divergencias del contrato canon. | |
| Mix keys obligatorias + valores específicos | Equivalente a (1) en práctica. | |

### Q3 — Fail-loud

| Option | Description | Selected |
|--------|-------------|----------|
| Verificar archivo NDJSON existe + parseo OK | Cubre crash silencioso y malformación. | ✓ |
| Capturar stderr y assertar vacío | El outer try/catch absorbe la traza — no fiable. | |
| Modificar el hook para fail-loud en DEV | Cambia contrato de producción por test scaffolding. | |

### Q4 — Modo de sesión sintética

| Option | Description | Selected |
|--------|-------------|----------|
| Sesión no-GSD (modo básico) | Aísla del builder GSD/quick. session.start es invariante al modo. | ✓ |
| Sesión GSD full | Acopla UAT-02 a Phase 8/9. | |
| Cubrir los 3 modos en variantes | 3x setup, SC#2 sólo pide "campos canónicos". | |

**User's choice:** state.json sintético + stdin con session_id, asserts contra `sessionStart()` helper, fail-loud verificando archivo NDJSON, sesión no-GSD básica.
**Notes:** Las variantes GSD full/quick quedan deferred — cubrir sólo si surge regresión que rompa la invarianza al modo.

---

## UAT-03 — session-of + fate

### Q1 — Casos cubiertos

| Option | Description | Selected |
|--------|-------------|----------|
| Los 3 casos de SC#3 + happy path step-2 | step-1 hit / step-2 hit / not-found / state-apunta-a-log-ausente. | ✓ |
| Sólo los 3 enunciados literalmente | Pierde step-2 happy path explícito. | |
| Añadir multi-match (D-21 LOG-11) | SC#3 no lo pide. | |

### Q2 — Exit codes

| Option | Description | Selected |
|--------|-------------|----------|
| Verificar exit codes actuales del CLI | Discuss-phase no rediseña contratos. | ✓ |
| Definir contrato canónico nuevo | Scope creep. | |
| Sólo exit 0 vs no-0 | Insuficiente para "deterministas". | |

### Q3 — Fate de 07-HUMAN-UAT.md

| Option | Description | Selected |
|--------|-------------|----------|
| Reducir a nota con redirect | Preserva enlaces inversos y trazabilidad. | ✓ |
| Borrar el archivo | Pierde referencias. | |
| Dejar como está + nota arriba | El contenido contradice el nuevo estado. | |

### Q4 — MILESTONES.md v0.3 entry

| Option | Description | Selected |
|--------|-------------|----------|
| En este Phase 17 al cierre, mínimo | Cierra SC#4 dentro del scope de la fase. | ✓ |
| Diferir a /gsd-complete-milestone v0.5 | Dejaría SC#4 como check incompleto. | |
| Skip MILESTONES.md | Reescribiría SC#4. | |

**User's choice:** 4 casos UAT-03 (incluye state-points-to-missing-log), exit codes actuales tal cual, 07-HUMAN-UAT.md reducido a redirect, MILESTONES.md actualizado en este Phase 17 al cierre.
**Notes:** Multi-match D-21 explícitamente deferred. Si los exit codes actuales no son deterministas, el plan documentará la divergencia y escalará antes de implementar fix.

---

## Claude's Discretion

- Naming de los 3 archivos test (sugerencia: `test/logs-follow-integration.test.js`, `test/session-start-event.test.js`, `test/session-of-resolver.test.js`).
- Helper `awaitLine()` inline o en `test/_helpers.js` según número de usos.
- Sentinels concretos del NDJSON UAT-01 (shape parseable que no choque con eventos canon).
- Pattern de cleanup (`before/after` vs `beforeEach/afterEach`, mkdtempSync por test o compartido).
- stderr capture en los 3 tests para debugging local pero sin asserts sobre contenido.
- Cómo verifica UAT-03 case 4 ("sessionId resolvido sin .ndjson file") si requiere fix mínimo del CLI; escalar antes de implementar.

---

## Deferred Ideas

- UAT-01 path "waiting for session log to appear" — fuera de SC#1.
- UAT-02 variantes GSD full y quick — invariante al modo según contrato.
- UAT-03 multi-match (D-21 LOG-11) — SC#3 no lo pide.
- Override de `FOLLOW_INTERVAL_MS` por env — superficie test-only injustificada.
- Helper compartido `test/_helpers.js` — crear sólo si surgen 2+ usos.
