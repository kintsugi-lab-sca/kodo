# Phase 16: LOG-09 Debt Cleanup - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-06
**Phase:** 16-log-09-debt-cleanup
**Areas discussed:** Dispatcher migration strategy, stop.js terminal status, stop.js order of operations, Test source-hygiene shape

---

## Dispatcher: helpers expandidos vs EVENTS.* directo

| Option | Description | Selected |
|--------|-------------|----------|
| A: EVENTS.* directo (mínimo cambio) | Sustituir string literal por `EVENTS.GSD_PHASE_RESOLVED`/`EVENTS.GSD_BOOTSTRAP`. Shape inline preservado, log.info/log.warn intactos. Diff pequeño, riesgo bajo, dispatcher mantiene flexibilidad de emitir variantes ad-hoc. Helpers existentes quedan disponibles para callsites con shape canónico. | ✓ |
| B: Helpers expandidos (union types) | `gsdPhaseResolved` acepta `{variant, ...campos}` con level interno. Más DRY — logger-events.js queda como single-source-of-truth del shape. Refactor mayor, posibles regresiones en otros callers. | |
| C: Helpers nuevos por variant | `gsdPhaseResolved` se queda matched-true happy path. Crear `gsdPhaseResolvedNoMatch()` y `gsdPhaseResolvedFailClosed()`. Cada helper single-purpose. Surface crece pero cada uno claro. | |

**User's choice:** A — EVENTS.* directo (mínimo cambio).
**Notes:** Los 4 callsites de dispatcher emiten variantes con campos heterogéneos (matched, tolerated, code, error_code, level info/warn) que los helpers fijos actuales no cubren. Mantener shape inline preserva flexibilidad sin contaminar helpers; helpers existentes siguen para callers canónicos.

---

## stop.js: estado terminal por modo (quick vs full)

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed 'done' para ambos modos | stop.js es hook mecánico. Marcar 'done' refleja "sesión completada por Claude Code". Distinción upstream del caller. Simplicidad + previsibilidad. | ✓ |
| 'done' (full) / 'review' (quick) | Quick siempre necesita revisión humana. Full ya pasó por verify. stop.js diferencia. Captura semántica pero acopla stop.js al modo (lo que QUICK-08 D-09/D-10 quería evitar). | |
| Idempotente: solo emitir si status != ya-terminal | Skip markSessionStatus si la session ya tiene status terminal. Solo emite 'done' si status es 'running'. Evita state.transition duplicado. Trade: 1 lectura más del state.json. | |
| Derivar del transcript final (Claude exit code) | Stop hook recibe transcript data. Mapear: exit 0 → 'done', exit !=0 → 'error', interrupt → 'interrupted'. Más semántico. Trade: stop.js empieza a inferir cosas que upstream sabe mejor. | |

**User's choice:** Fixed 'done' para ambos modos.
**Notes:** Coherente con principio existente "stop.js es hook mecánico". Acepta transición `from='review' to='done'` cuando full pasa por verify primero — válida (sesión llega a fin tras review).

---

## stop.js: orden state.transition vs releaseGsdLock

| Option | Description | Selected |
|--------|-------------|----------|
| PRE-release (consistente con session.end existente) | markSessionStatus ANTES de releaseGsdLock. Consistente con patrón session.end línea 116 (`Emit typed event BEFORE removeSession`). Lectores ven 'session done' antes de 'lock liberado'. | ✓ |
| POST-release (refleja estado real post-cleanup) | markSessionStatus DESPUÉS de releaseGsdLock. Evento refleja 'sesión done con lock ya liberado'. Trade: si releaseGsdLock falla state.transition no se emite. Orden inverso al patrón existente. | |
| Independiente: try/catch separados, orden por documentación | Cada uno en su try/catch propio, orden PRE-release con comentario explícito. Máxima resiliencia. | |

**User's choice:** PRE-release (consistente con session.end existente).
**Notes:** Sigue el patrón documentado en stop.js línea 116. Builder añade try/catch silencioso alrededor de markSessionStatus para que un fallo defensivo no impida el releaseGsdLock que viene después.

---

## Test source-hygiene shape para LOG-13

| Option | Description | Selected |
|--------|-------------|----------|
| Grep simple comment-aware | Regex que detecta literales en código pero ignora líneas que empiezan con `//` o `*` comment markers. Single-file scan de dispatcher.js. Simple, alineado con SC#1, mantiene comments libres para documentación histórica. | ✓ |
| Walker estilo LOG-12 (carga + AST trace) | Como format-isolation.test.js: importa dispatcher.js, recorre AST detectando StringLiteral. Robusto, distingue code vs comments por construcción. Más complejo. | |
| Grep + allowlist explicit (híbrido) | Grep simple, pero con allowlist de líneas/contextos donde literales SÍ están permitidos. El test mantiene array de allowed_lines. Trade: allowlist requiere mantenimiento. | |

**User's choice:** Grep simple comment-aware (lo más pragmático).
**Notes:** Phase 16 dispatcher mantiene comentarios documentando el flujo histórico (D-14 Phase 9). Comment-aware filter es suficiente para distinguir código vs documentación. Builder ubica el test en `test/dispatcher-isolation.test.js` (paralelo a check-isolation/format-isolation).

---

## Claude's Discretion

Áreas donde el builder decide sin re-preguntar:

- **verify.js terminal state = `'review'`** — SC#2 lo sugiere directamente y `markSessionStatus` admite `'review'`. Reason `'gate-passed'` (consistente con verdict legacy mapping ya en cabecera de verify.js).
- **dispatcher.js scope de migración** — solo los 5 callsites con literales activos; comentarios documentales (líneas 171, 173, 203, 228) se mantienen porque son referencias históricas a invariantes (D-14 Phase 9). Test source-hygiene los respeta vía comment-aware filter.
- **markSessionStatus return value ignored** — basta con el side-effect (state mutation + state.transition emit). No upstream dependency.
- **Logger threading** — verify.js y stop.js ya tienen el `log` child desde createLogger en scope; markSessionStatus recibe ese mismo logger.
- **Reason field stop.js** — `'session-stop:lock-released'` (informativo, formato consistente con otros reasons como `'gate-passed'`, `'plane-unreachable'`).
- **Test coverage SC#3 (verify.js)** — 4+ ramas del verdict + 2 ramas de error → cada una con test que asserta `markSessionStatus` NO se llamó (memSink filter por `event === 'state.transition'`).
- **Test coverage SC#5 (stop.js)** — full + quick + no-GSD = 3 tests integration cadena completa.

## Deferred Ideas

- **Helpers expandidos para variants no-canónicos del dispatcher** — fuera de scope Phase 16. Revisitable si la taxonomía cerrada D-14 se expande a más callsites heterogéneos.
- **Walker AST style LOG-12 para dispatcher-isolation** — innecesario para dispatcher actual. Reformular si dispatcher.js gana indirecciones (helpers locales que retornan strings).
- **markSessionStatus en rama no-GSD del stop.js** — fuera de scope. `state.transition` se reserva para sesiones GSD; reformular si se quiere observabilidad uniforme para todas las sesiones.
