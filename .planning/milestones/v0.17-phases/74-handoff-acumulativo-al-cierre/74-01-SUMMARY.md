---
phase: 74-handoff-acumulativo-al-cierre
plan: 01
subsystem: session
tags: [handoff, contract, pure-leaf, parser, security]
status: complete

requires: []
provides:
  - "src/session/handoff.js — módulo único del contrato de handoff (D-13)"
  - "HANDOFF_REASONS / normalizeReason — enum cerrado de motivos (D-03)"
  - "sanitizeInline — aplanado de texto no confiable del provider (T-74-03)"
  - "isSafeTaskId — guard de contención de ruta para el hook ESCRITOR (T-74-01)"
  - "buildPlanHeader — cabecera mínima del create-if-missing (D-09)"
  - "buildHandoffBlock — bloque mecánico del backstop (D-01/D-03, LIVE-03)"
  - "findSessionBlock / hasSessionHandoff — detección scoped por session_id (D-04)"
  - "extractNext — extracción + truncado a 200 del NEXT (D-02)"
affects:
  - "74-02 (upsertTaskHandoff consume extractNext)"
  - "74-04 (writeHandoff consume todo el contrato)"
  - "75 (importará el parser desde el leaf del dashboard)"

tech-stack:
  added: []
  patterns:
    - "zero-import leaf (contrato de src/logger-noop.js)"
    - "enum cerrado array literal + .includes() (espejo de labels.js:28-31)"
    - "guard de contención con String.includes, nunca RegExp (espejo de plan.js:119-121)"
    - "anti-ReDoS: solo operaciones de String en todo el módulo"
    - "reloj inyectado (at) para determinismo en tests"

key-files:
  created:
    - src/session/handoff.js
    - test/session/handoff.test.js
  modified:
    - test/check-isolation.test.js

decisions:
  - "sessionId NO se sanea en buildHandoffBlock: writer y parser deben usar el MISMO valor crudo o la detección de D-04 daría falsos negativos"
  - "El truncado del NEXT (200) vive en extractNext, no en el caller (D-02)"
  - "sanitizeInline colapsa/trimea con split+filter+join en vez de .replace(/…/g) — cero regex"

metrics:
  duration: ~18 min
  tasks: 3
  files: 3
  tests-added: 40
  completed: 2026-07-15
---

# Phase 74 Plan 01: Contrato de handoff (writer + parser) Summary

Módulo `src/session/handoff.js` como hoja pura de **cero imports** que posee el contrato de formato
del handoff completo — construcción del bloque mecánico (D-01/D-03), detección **scoped por
`session_id`** (D-04) y extracción del `NEXT:` con truncado a 200 (D-02) — blindado por un guard
automatizado de grafo de imports.

## What Was Built

**Task 1 — lado escritor** (`900a7da` RED, `e3dddb3` GREEN): `HANDOFF_REASONS` (enum cerrado
congelado de 5 motivos), `normalizeReason` (cualquier entrada fuera del enum → `'other'`, incluidos
`undefined`/`null`/números/`'CLEAR'`), `sanitizeInline` (aplana CR/LF a espacio, colapsa runs, trunca
a 120), `isSafeTaskId` (rechaza `/`, `\`, `..`, vacío y no-string), `buildPlanHeader` (D-09) y
`buildHandoffBlock` (heading + marcador en UNA línea, fecha local con padding + `at=` en ISO UTC,
sufijo ` — automático`, **sin `NEXT:`** por LIVE-03).

**Task 2 — lado parser** (`0cce11c` RED, `28553a8` GREEN): `findSessionBlock` (line-scoped a headings
`## Handoff ` reales, con igualdad **exacta de token** `session=<id>`), `hasSessionHandoff` y
`extractNext` (primera línea `**NEXT:**`, trimmed, truncada a 200).

**Task 3 — guard de aislamiento** (`c06245b`): caso nuevo en `test/check-isolation.test.js` que
asserta `extractImports(handoff.js) === []`, espejo verbatim del caso de `logger-noop.js`, reutilizando
el `extractImports` existente (no se duplicó el walker).

## Key Decisions

**`sessionId` NO se sanea en `buildHandoffBlock`.** El plan solo manda sanear `summary`, `task_ref` y
`status`. Consideré aplicar `sanitizeInline` también al `sessionId` (viene de stdin de Claude Code, un
trust boundary declarado), pero **habría sido un bug**: el writer escribiría el id saneado mientras el
parser (`findSessionBlock(md, sessionId)`) compara contra el valor **crudo** → mismatch permanente →
`hasSessionHandoff` siempre `false` → cada sesión appendearía un bloque mecánico de más. Writer y
parser deben usar el mismo valor. El modo de fallo de un `session_id` hostil es benigno y no de
seguridad (un bloque extra, no una escape de ruta ni una inyección), y no está en el threat register.
Se deja como está, deliberadamente.

**Truncado del `NEXT` en `extractNext`, no en el caller** (D-02): el tope vive en el contrato para que
ningún consumidor futuro (74-02 al persistir, 75 al pintar) pueda saltárselo.

**Cero regex en todo el módulo** (T-74-09): `sanitizeInline` usa `split('\r').join(' ')` +
`split(' ').filter(Boolean).join(' ')` en vez de `.replace(/\r|\n/g, ' ')` y `.replace(/\s+/g, ' ')`.
Ni siquiera un literal constante — el módulo entero es superficie de retroceso cero.

## Deviations from Plan

**Cero desviaciones de código** — el plan se ejecutó exactamente como está escrito, sin auto-fixes.

**Una desviación de proceso (deliberada): NO se marcaron LIVE-01..04 como completos.** El frontmatter
de este plan los lista, y el workflow del executor manda marcarlos al cerrar. No se ha hecho, porque
sería **falso**: `REQUIREMENTS.md` los traza a nivel de **fase** ("Phase 74"), no de plan, y ninguno
está satisfecho todavía por este plan, que solo entrega el contrato puro:

| Req | Qué exige | Quién lo satisface |
|-----|-----------|--------------------|
| LIVE-01 | el hook escribe el bloque al cerrar | Plan 04 (`writeHandoff` en `session-end.js`) |
| LIVE-02 | la segunda sesión acumula sin pisar | Plan 03 (invertir `session-start.js:85`/`:145`) |
| LIVE-03 | backstop mecánico si el LLM no escribió | Plan 04 (este plan solo aporta `buildHandoffBlock`/`hasSessionHandoff`) |
| LIVE-04 | `state.json` refleja plan_path + NEXT | Plan 02 (`upsertTaskHandoff`) |

Marcarlos ahora dejaría la tabla de traceability diciendo "Complete" mientras `session-end.js` sigue
sin escribir un solo byte — engañando al verifier y a cualquier audit posterior. Se dejan en
`Pending`; corresponde marcarlos al cierre de la fase (tras el Plan 05 / `/gsd-verify-work`).

## Verification

| Check | Result |
|-------|--------|
| `node --test test/session/handoff.test.js` | 39 pass / 0 fail |
| `node --test test/check-isolation.test.js` | 8 pass / 0 fail (7 preexistentes LOG-12 + 1 nuevo) |
| `npm test` (suite completa) | 2070 tests — **cero regresiones atribuibles a este plan**; ver nota de flake abajo |
| `git diff --stat package.json package-lock.json` | vacío — **cero deps npm nuevas** (T-74-SC) |
| Exports del contrato | 9/9 (`HANDOFF_REASONS`, `normalizeReason`, `sanitizeInline`, `isSafeTaskId`, `buildPlanHeader`, `buildHandoffBlock`, `findSessionBlock`, `hasSessionHandoff`, `extractNext`) |

**Caso crítico D-04 verificado y verde:** un markdown que ya contiene el bloque de `session=s-0`,
consultado por `'s-1'`, devuelve `null` y `hasSessionHandoff` devuelve `false` → el backstop de
LIVE-03 sigue disparando aunque haya acumulación. Es el fallo exacto que justifica la fase entera.

**Flake preexistente detectado (NO es una regresión de este plan) —
`test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)»:** el primer `npm test` salió
`0 fail`, pero re-ejecuciones del mismo HEAD sin cambiar un byte dieron `2 fail` y luego `1 fail`.
Aislado (`node --test test/gsd-lock-race.test.js` × 3) falla 1 de cada 3 → es sensible a timing, no
determinista. Prueba de que no lo causó este plan: `git diff --stat 900a7da~1..HEAD -- src/gsd/
test/gsd-lock-race.test.js` sale **vacío** (código bajo test byte-idéntico al baseline), y
`handoff.js` es una hoja de cero imports que **solo importa su propio test**. Por el scope boundary
(no auto-arreglar lo que el task no causó) se registró en
`.planning/phases/74-handoff-acumulativo-al-cierre/deferred-items.md` con evidencia, hipótesis y la
advertencia para los planes 02..05, y **no se tocó**: "arreglarlo" a ciegas podría enmascarar una
carrera real del lock, que es el invariante de v0.16 Phase 70 que ese test protege.
La suite de este plan (`handoff.test.js`, `check-isolation.test.js`) es **100% determinista**:
39/39 y 8/8 estables en todas las ejecuciones.

**Negative control del guard de Task 3 (acceptance criterion explícito):** se inyectó
`import { join } from 'node:path';` en `handoff.js` → el caso nuevo **falló** (`7 pass / 1 fail`, con
el mensaje `found: node:path`); tras revertir, `8 pass / 0 fail` y `git diff` del fichero vacío
(revert byte-idéntico). El guard muerde de verdad, no pasa trivialmente.
`grep -c 'function extractImports'` sigue siendo **1** (walker no duplicado).

## Threat Mitigations Applied

| Threat | Mitigación implementada y testeada |
|--------|-------------------------------------|
| T-74-01 | `isSafeTaskId` con `String.includes` sobre `/`, `\`, `..` (nunca RegExp). D-09 hace del hook un ESCRITOR → impide CREAR ficheros fuera del root |
| T-74-02 | `normalizeReason` valida contra el enum CERRADO antes de interpolar; testeado que `'valor-inventado'` produce `motivo: other` y que el valor crudo **no aparece** en el markdown |
| T-74-03 | Doble defensa verificada: (a) `sanitizeInline` impide que un summary hostil introduzca una línea nueva; (b) `findSessionBlock` ignora marcadores que no estén en un heading `## Handoff ` real (test con marcador en prosa y en cita `> ## Handoff`) |
| T-74-09 | Cero construcciones de regex en el módulo; recorrido lineal sobre líneas |
| T-74-SC | Cero paquetes instalados — `git diff` de `package.json`/`package-lock.json` vacío |

## TDD Gate Compliance

Tasks 1 y 2 (`tdd="true"`) cumplen la secuencia de gates en git log: `test(...)` RED → `feat(...)`
GREEN, con el RED verificado fallando antes de cada implementación (Task 1: módulo inexistente;
Task 2: exports inexistentes). No hizo falta REFACTOR. Task 3 no es TDD (añade un guard, no
comportamiento nuevo).

## Known Stubs

Ninguno. El módulo está completo y sin placeholders — es puro contrato, sin dependencias sin cablear.

## Notes for Future Phases

- **Phase 75:** importar el parser (`findSessionBlock`/`extractNext`) desde `src/cli/dashboard/plan.js`
  es seguro — el guard de `check-isolation.test.js` mantiene la hoja. Si alguien intenta meter el I/O
  del plan dentro de `handoff.js`, ese test rompe el build en vez de romper la 75 en silencio.
- **D-12 vigente:** el módulo no implementa poda ni cap. Revisitar en v0.18 con datos reales.
- El marcador HTML se verá **crudo** en el overlay hasta que la 75 renderice markdown (LIVE-06) —
  ruido cosmético conocido y aceptado en el CONTEXT.

## Self-Check: PASSED

- Ficheros: `src/session/handoff.js` FOUND, `test/session/handoff.test.js` FOUND,
  `test/check-isolation.test.js` FOUND
- Commits: `900a7da`, `e3dddb3`, `0cce11c`, `28553a8`, `c06245b` — todos FOUND en git log
