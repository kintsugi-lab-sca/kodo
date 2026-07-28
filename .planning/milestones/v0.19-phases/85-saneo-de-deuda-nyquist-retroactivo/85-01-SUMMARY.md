---
phase: 85-saneo-de-deuda-nyquist-retroactivo
plan: 01
subsystem: testing
tags: [jsdoc, tui, ink, dashboard, handoff, node-test]

# Dependency graph
requires:
  - phase: 74-handoff-next
    provides: "el campo `next` de `TaskHandoff` y el truncado a 200 que este plan NO toca"
  - phase: 75-columna-next-live
    provides: "`deriveAnyNext` y `nextCell`, los dos lectores del mismo dato que este plan reconcilia"
  - phase: 81-debt-01-merge-tres-estados
    provides: "el merge tres-estados por PRESENCIA implementado en `upsertTaskHandoff`, que el typedef ahora describe"
provides:
  - "typedef `TaskHandoff` coherente con el merge tres-estados vigente (OVERWRITE / CLEAR / PRESERVE por presencia del campo)"
  - "`deriveAnyNext` delegando en `nextCell`: una única fuente de verdad del colapso de whitespace"
  - "caso RED de solo-whitespace en el bloque LIVE-05, commiteado en rojo antes del fix"
affects: [dashboard-next-column, handoff-state, phase-85-plan-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "delegación derive→format: el que DECIDE la presencia de una columna consume al que la PINTA, en vez de duplicar su regla"
    - "primer import de runtime en un módulo de la capa derive, justificado por pureza del módulo destino (§TUI-04)"

key-files:
  created: []
  modified:
    - src/session/state.js
    - src/cli/dashboard/select.js
    - test/dashboard-select.test.js

key-decisions:
  - "D-01/D-03: DEBT-05 es doc-only — cero cambio de comportamiento y cero tests nuevos; la evidencia del contrato es la cita a los tests que ya lo congelan"
  - "D-04: `deriveAnyNext` delega en `nextCell` en vez de replicar el colapso `/\\s+/g` — la incoherencia de 81-REVIEW WR-02 deja de ser posible por construcción"
  - "D-06: el test de solo-whitespace se commitea EN ROJO antes del fix; el test dicta la forma del arreglo"
  - "El comentario de justificación del import evita el literal `picocolors` para no inflar el conteo del fichero por encima de su baseline de HEAD (2)"

patterns-established:
  - "Delegación de coherencia: cuando dos lectores del mismo dato aplican reglas distintas, el fix es que uno consuma al otro, no sincronizar dos copias de la regla"
  - "Justificación in-line de un import que cruza capas: pureza del destino + guard que lo custodia + ausencia de ciclo, en el mismo sitio donde vive el import"

requirements-completed: [DEBT-05, DEBT-06]

coverage:
  - id: D1
    description: "El typedef `TaskHandoff` enuncia el contrato tres-estados por PRESENCIA del campo `next` (OVERWRITE / CLEAR / PRESERVE), coherente con la tabla de `state.js:405-410` y con el merge de `:449-454`"
    requirement: DEBT-05
    verification:
      - kind: unit
        ref: "test/state/handoff-state.test.js#CLEAR/PRESERVE/OVERWRITE (:265/:288/:307) — verde y el fichero SIN modificar"
        status: pass
      - kind: other
        ref: "grep -c 'ausente/null' src/session/state.js → 0 · grep -c 'NO borra el previo' → 0 · sed -n '44,64p' | grep -c 'PRESENCIA' → 1 · grep -c 'WR-02' en 44-64 → 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Un `next` de solo-whitespace ya no enciende la columna `next` del dashboard: `deriveAnyNext` decide con la MISMA regla que la pinta"
    requirement: DEBT-06
    verification:
      - kind: unit
        ref: "test/dashboard-select.test.js#DEBT-06: un next de solo-whitespace NO enciende la columna (coherente con nextCell)"
        status: pass
      - kind: unit
        ref: "test/dashboard-select.test.js — los 8 asserts LIVE-05 previos (:473-497), verdes SIN tocarlos"
        status: pass
      - kind: unit
        ref: "test/format-isolation.test.js#§TUI-04 — verde y el fichero SIN modificar (D-18)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Auditoría D-02: la advertencia stale retirada no sobrevive en ningún otro punto de la documentación viva"
    requirement: DEBT-05
    verification:
      - kind: other
        ref: "grep -rn 'ausente/null' | 'NO borra' | 'no borra el previo' sobre src/ README.md .planning/codebase/ .claude/skills/ → 0 hits"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-27
status: complete
---

# Phase 85 Plan 01: Saneo DEBT-05 + DEBT-06 Summary

**El typedef `TaskHandoff` vuelve a describir el merge tres-estados que realmente se ejecuta, y `deriveAnyNext` deja de duplicar la regla de `nextCell` — un `next` de solo-whitespace ya no enciende una columna que se renderiza vacía.**

## Performance

- **Duración:** ~8 min
- **Iniciado:** 2026-07-27T10:43Z
- **Completado:** 2026-07-27T10:51Z
- **Tareas:** 3
- **Ficheros modificados:** 3

## Accomplishments

- **DEBT-05 (cierra 81-REVIEW WR-01):** el comentario del campo `next` del typedef `TaskHandoff` describía la semántica PRE-DEBT-01 («un `next` ausente/null NO borra el previo»), falsa desde que Phase 81 cambió el merge. Ahora enuncia el contrato de tres estados discriminado por **presencia** del campo, con los mismos tres verbos de la tabla canónica de `upsertTaskHandoff` (`:405-410`) y con la cita a los tres tests que lo congelan.
- **DEBT-06 (cierra 81-REVIEW WR-02):** `deriveAnyNext` decidía la presencia de la columna midiendo la longitud del string **crudo**, mientras `nextCell` la pintaba tras colapsar `/\s+/g` + `trim`. Un `next` de `'   '` encendía la columna — cabecera incluida — para luego renderizar una celda vacía. Ahora el que decide **consume** al que pinta: `rows.some((r) => nextCell(r).length > 0)`.
- **El fix llegó dictado por un test rojo:** el caso de solo-whitespace se commiteó fallando (`8cc703c`) antes de existir la delegación (`ba69110`), con un cuarto assert mixto que impide que el arreglo se pase de frenada y apague la columna cuando sí hay contenido real.
- **Ningún assert existente se tocó:** los 8 asserts LIVE-05 previos son invariantes bajo la delegación, tal como RESEARCH §2d había verificado empíricamente.

## Task Commits

1. **Task 1 (85-01-01): DEBT-05 — typedef `TaskHandoff`** — `b9624e1` (docs)
2. **Task 2 (85-01-02): DEBT-06 RED — caso de solo-whitespace** — `8cc703c` (test, commiteado EN ROJO)
3. **Task 3 (85-01-03): DEBT-06 GREEN — delegación en `nextCell`** — `ba69110` (fix)

## Files Created/Modified

- `src/session/state.js` — comentario del campo `next` del typedef `TaskHandoff` reescrito al contrato tres-estados por PRESENCIA. **Una sola línea cambiada** (1 insertion, 1 deletion); cero código ejecutable, cero cambio de comportamiento.
- `test/dashboard-select.test.js` — un `it()` nuevo dentro del `describe` LIVE-05 con 4 asserts (3 de solo-whitespace → `false`, 1 mixto → `true`). **8 insertions, 0 deletions** — ninguna línea preexistente modificada.
- `src/cli/dashboard/select.js` — primer import de runtime del módulo (`import { nextCell } from './format.js';`), predicado de `deriveAnyNext` delegado y docblock actualizado. El párrafo CRÍTICO de Pitfall 4 (set SIN filtrar) y el comentario de color-isolation quedan intactos.

## Auditoría D-02 — grep de la advertencia retirada

Ejecutada tras el saneo de la Task 1, con los patrones exactos de la advertencia retirada:

| Patrón | Alcance | Hits post-fix | Hits a HEAD (pre-fix) |
|---|---|---|---|
| `ausente/null` | `src/` · `README.md` · `.planning/codebase/` · `.claude/skills/` | **0** | 1 — `src/session/state.js:53` |
| `NO borra` | `src/` · `README.md` · `.planning/codebase/` · `.claude/skills/` | **0** | 1 — `src/session/state.js:53` |
| `no borra el previo` | `src/` · `README.md` · `.planning/codebase/` · `.claude/skills/` | **0** | 0 |

Comando: `grep -rn -- "<patrón>" src/ README.md .planning/codebase/ .claude/skills/` (los cuatro paths del alcance existen y se recorrieron; el grep es case-sensitive, por eso `NO borra` capturaba lo que `no borra el previo` no).

**Clasificación de los hits:** el único hit stale de todo el repo era el de `src/session/state.js:53` — exactamente el que corrige esta tarea. Confirma la predicción de RESEARCH §4a. **La fila «Hallazgos fuera de `state.js`» del bloque `<deferred>` del CONTEXT se cierra VACÍA**: no hay hallazgos adicionales, ni one-liners corregidos al paso ni entradas que pasen a `deferred-items.md`. Es una afirmación verificada, no una omisión.

Fuera de alcance por decisión explícita (D-02): la prosa de artefactos archivados (`.planning/milestones/**`) no se reescribe — son snapshots históricos que describen lo que era cierto cuando se escribieron.

## Decisions Made

- **Se conserva la mención al truncado a 200 (D-02 de Phase 74)** en la primera frase del comentario: es prosa preexistente y sigue siendo cierta. El texto **nuevo** no re-enuncia ninguna regla de longitud, igualdad ni normalización, como exigía el must-have.
- **Se conserva la última frase del comentario original** (`null` significa «ninguna sesión ha dejado nunca un `NEXT:`», no «el último cierre no lo traía»): sigue siendo cierta bajo el contrato nuevo y es información útil para el lector.
- **`deriveAnyNext` pierde su guard `typeof`**: `nextCell` ya es never-throws para no-string (`format.js:265`), así que el contrato never-throws de D-05 se preserva sin guard propio. El Test 3 del bloque LIVE-05 (`next: 42` / `next: {}` → `false`) lo confirma en verde sin tocarse.

## Deviations from Plan

### Ajustes menores

**1. [Rule 3 - Blocking] Criterio de aceptación `grep -c 'picocolors' src/cli/dashboard/select.js` = 0 era insatisfacible a HEAD**

- **Encontrado durante:** Task 3 (verificación de gates)
- **Problema:** el criterio literal pide `0`, pero a HEAD el fichero ya contenía **2** menciones de `picocolors`, ambas en comentarios: el bloque de color-isolation (`:27`, que dice literalmente «NO importa `picocolors`» y es la invariante que hay que preservar) y una nota en el docblock de `grepLogs` (`:305`). Satisfacer el criterio al pie de la letra habría exigido borrar el comentario de color-isolation — justo lo que el propio plan prohíbe en el punto 4 de la acción.
- **Interpretación aplicada:** el gate efectivo es **el guard §TUI-04 de `test/format-isolation.test.js` en verde** (que inspecciona imports, no prosa) más cero sentencias `import` de `picocolors`. Ambos se cumplen.
- **Ajuste hecho:** mi comentario de justificación del import mencionaba `picocolors` una tercera vez; se reformuló a «no arrastra la capa de color» para dejar el conteo del fichero **exactamente en su baseline de HEAD (2)**, sin perder información — la afirmación sustantiva (que `format.js` no arrastra color) se mantiene íntegra.
- **Verificación:** `grep -c 'picocolors' src/cli/dashboard/select.js` → `2` (= HEAD); `node --test test/format-isolation.test.js` → verde; `git diff --exit-code test/format-isolation.test.js` → 0.
- **Commiteado en:** `ba69110` (commit de la Task 3)

---

**Total de desviaciones:** 1 ajuste de interpretación de un criterio de aceptación. **Cero** desviaciones de comportamiento, cero código fuera del alcance del plan, cero deps.
**Impacto:** ninguno sobre el objetivo. Ningún assert se debilitó, estrechó ni reescribió.

## Issues Encountered

Ninguno. Los tres fences LOCKED se respetaron sin fricción: `test/format-isolation.test.js`, `src/gsd/lock.js` y `.planning/codebase/TESTING.md` no se abrieron; `src/cli/dashboard/format.js`, `src/cli/dashboard/App.js` y `test/state/handoff-state.test.js` salen `git diff --exit-code` = 0.

## Verificación

| Gate | Resultado |
|---|---|
| `node --test test/state/handoff-state.test.js` | 24/24 verde, fichero sin modificar |
| `node --test test/dashboard-select.test.js` | 42/42 verde (41 baseline + 1 nuevo) |
| `node --test test/dashboard-format.test.js` | verde |
| `node --test test/format-isolation.test.js` | verde, fichero sin modificar |
| `npm test` (suite completa) | **2587 tests · 2586 pass · 0 fail · 1 skipped** (baseline 2586/2585/0/1 + el `it()` nuevo) |
| `git diff --exit-code src/cli/dashboard/App.js src/cli/dashboard/format.js test/format-isolation.test.js test/state/handoff-state.test.js` | sale 0 |
| `grep -cF "import { nextCell } from './format.js';" select.js` | 1 |
| `grep -cF 'nextCell(r).length > 0' select.js` | 1 |
| `grep -c 'r.next.length' select.js` | 0 |
| `grep -c 'nextCell' select.js` | 4 (≥ 3) |

## User Setup Required

Ninguno — cero deps npm, cero configuración externa, cero migraciones de estado.

## Next Phase Readiness

- **DEBT-05 y DEBT-06 cerrados**; con ambos queda saldada R-81-02. Los dos warnings de `81-REVIEW` (WR-01 y WR-02) dejan de estar abiertos.
- **Para el plan 85-05 (consolidación):** la auditoría D-02 no aporta ninguna entrada a `deferred-items.md` — la fila «Hallazgos fuera de `state.js`» se cierra vacía y verificada.
- **Nudge de revisión manual (supuesto A1 del planner):** DEBT-06 quedó `unclassified` en el edge probe determinista. Su cobertura real es la de D-06 (4 asserts nuevos + 8 de no-regresión intactos), pero conviene que la validación de la fase lo registre como cubierto-por-diseño en vez de como gap automático.
- Ninguna otra parte del contrato de la columna `next` se movió: `nextCell` sigue colapsando `/\s+/g` + `trim` y `SessionTable` sigue truncando a `COLS.next = 40`.

## Self-Check: PASSED

Los 3 ficheros modificados existen en disco y los 3 commits de tarea (`b9624e1`, `8cc703c`, `ba69110`) están en el historial.

---
*Phase: 85-saneo-de-deuda-nyquist-retroactivo*
*Completado: 2026-07-27*
