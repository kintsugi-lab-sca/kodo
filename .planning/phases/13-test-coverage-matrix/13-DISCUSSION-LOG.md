# Phase 13: Test Coverage Matrix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 13-test-coverage-matrix
**Areas discussed:** Forma de la matriz, Scope (stop+launch+getSessionMode), Behavior vs source-hygiene, Organización

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Forma de la matriz (4×4 o selectiva) | Decide el techo de coverage | ✓ |
| Scope: ¿incluir stop.js, launch.js y getSessionMode? | Cerrar v0.4 vs ceñirse al ROADMAP literal | ✓ |
| Behavior vs. source-hygiene regex | Estilo de tests en sitios nuevos | ✓ |
| Organización de tests (nuevo describe vs. extender existentes) | Cohesión por fase vs. semántica | ✓ |

**User's choice:** Las 4 áreas seleccionadas.

---

## Forma de la matriz

### Q1: ¿Qué forma toma la matriz cuando un estado no afecta el branching del sitio?

| Option | Description | Selected |
|--------|-------------|----------|
| Selectiva por afectación (Recommended) | Cubrir solo donde el estado afecta el branching (~10-12 tests) | ✓ |
| Matriz literal 4×4 = 16 tests | Simetría visual, ~20% duplicados | |
| Matriz "diagonal" — solo el estado nominal de cada sitio | ~6-8 tests, riesgo de brechas | |

**User's choice:** Selectiva por afectación.

### Q2: ¿Cómo enumerar los 4 estados de label en los tests?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline `flags: ['gsd-quick']` en cada test (Recommended) | Grep-friendly, alineado con manager.test.js | ✓ |
| Helper compartido `LABEL_SCENARIOS` en `test/helpers/` | DRY pero indirecto | |
| Tabla `it.each`-style con array de scenarios | Compacto pero pierde grep-friendliness | |

**User's choice:** Inline en cada test.

### Q3: ¿Dónde se valida la regla de precedencia 'gsd-quick gana sobre gsd'?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo en `test/labels.test.js` (Recommended) | Helper como única fuente de verdad | ✓ |
| En labels.test.js + manager.test.js end-to-end | Defensa en profundidad, dup. lógica | |
| En los 4 sitios | Máximo coverage, máxima redundancia | |

**User's choice:** Solo en labels.test.js.

---

## Scope (stop+launch+getSessionMode)

### Q1: ¿Tests de `getSessionMode(session)` aislados en `test/labels.test.js`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí (Recommended) | Phase 11 D-09/D-10 lo prometió; cubre legacy gsd:true == full | ✓ |
| No — cubierto indirectamente por session-start.test.js | Riesgo: regresión silenciosa caso legacy | |

**User's choice:** Sí.

### Q2: ¿Tests de `buildStopNudgeText` (Phase 12 D-07/D-08) en `test/stop.test.js`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí — cubrir los 3 cases del switch (Recommended) | Cierra QUICK-06 con behavior coverage directo | ✓ |
| No — fuera de QUICK-08 explícito | Defer a v0.5+ como deuda | |

**User's choice:** Sí, los 3 cases.

### Q3: ¿Tests de `buildContextSummary` gsdTag (Phase 12 D-11) en `test/orchestrator-gsd.test.js`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí — las 3 etiquetas (Recommended) | Cierra QUICK-07 success criterion 3, cubre defensa Phase 12 D-11 | ✓ |
| No — fuera de QUICK-08 explícito | Defer | |

**User's choice:** Sí, las 3 etiquetas.

### Q4: ¿Actualizar el ROADMAP/REQUIREMENTS para reflejar el scope ampliado?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí — ampliar ROADMAP success criteria con stop.js + launch.js + getSessionMode (Recommended) | Coherencia entre promesa y verificación | ✓ |
| No — cubrir como tests extra sin tocar specs | Lectura futura inconsistente | |
| No aplica — si descarté las anteriores | N/A | |

**User's choice:** Sí, actualizar ROADMAP.

---

## Behavior vs. source-hygiene regex

### Q1: ¿Qué estilo aplicas en los archivos de test nuevos/extendidos?

| Option | Description | Selected |
|--------|-------------|----------|
| Behavior + source-hygiene selectivo (Recommended) | Behavior por defecto, regex para invariantes específicos | ✓ |
| Solo behavior tests — más limpio | Sin red para invariantes "usa el helper" | |
| Dual obligatorio en cada sitio | Máximo coverage, ruido | |

**User's choice:** Behavior + source-hygiene selectivo.

### Q2: ¿Qué invariantes específicos quieres blindar con source-hygiene regex? (multiSelect)

| Option | Description | Selected |
|--------|-------------|----------|
| Anti-inline `\|\| 'full'` en hooks/launch (Recommended) | Fuerza uso de getSessionMode | ✓ |
| Anti-uso directo de `session.gsd_mode` (excepto en getSessionMode) | Excepción documentada en src/labels.js | ✓ |
| Source-hygiene en stop.js: switch `case 'quick'` debe NO contener `kodo gsd verify` | Complementa behavior test | ✓ |
| Manager.test.js: extender regex existente con `gsd_mode` source-hygiene | Paralelo al test de skipPerms | ✓ |

**User's choice:** Los 4 invariantes.

---

## Organización de tests

### Q1: ¿Cómo organizas los nuevos bloques `describe()` dentro de cada archivo?

| Option | Description | Selected |
|--------|-------------|----------|
| Mezcla: bloque dedicado QUICK-08 + extender existentes (Recommended) | Cohesión por fase + extensión de patrones existentes | ✓ |
| Todo dentro de un solo `describe('QUICK-08 ...')` por archivo | Cohesión máxima por fase, separa gemelos | |
| Solo extender bloques existentes — sin describe nuevo | Cohesión semántica, dificulta rastreo de fase | |

**User's choice:** Mezcla.

### Q2: ¿Nombres de los nuevos tests — incluir QUICK-08 o solo descripción?

| Option | Description | Selected |
|--------|-------------|----------|
| Con prefijo `QUICK-08:` cuando relevante (Recommended) | Trazabilidad con REQUIREMENTS, alineado con patrón existente | ✓ |
| Sin prefijo — solo descripción del comportamiento | Más legible pero pierde vínculo | |

**User's choice:** Con prefijo `QUICK-08:`.

### Q3: ¿Test del 'suite contract' (ROADMAP success criterion 5)?

| Option | Description | Selected |
|--------|-------------|----------|
| No — lo verifica CI/`npm test` (Recommended) | Evita test circular | ✓ |
| Sí — añadir test que cuenta los nuevos tests | Indirección sin señal útil | |

**User's choice:** No, lo verifica `npm test` en VERIFICATION.

---

## Closing question

### Q: ¿Listo para crear CONTEXT.md o queda alguna gray area sin resolver?

| Option | Description | Selected |
|--------|-------------|----------|
| Listo — escribir CONTEXT.md | Capturar decisiones y actualizar ROADMAP | ✓ |
| Explorar más gray areas | Identificar áreas adicionales | |

**User's choice:** Listo.

---

## Claude's Discretion

- Granularidad y orden de plans (¿1 plan por archivo? ¿1 plan por área? ¿1 combinado?)
- Mensajes exactos de fallo en regex de source-hygiene
- Estructura interna de fixtures (helpers `makeSession()` con `gsd_mode` si no existen)
- Stubs específicos de `resolvePhaseFn` para nuevos escenarios dispatcher

## Deferred Ideas

### A futuras milestones (v0.5+)
- Tests E2E de `kodo logs --session-of` para sesiones quick (deuda LOG-09)
- Snapshot tests del prompt orchestrator
- Helper `LABEL_SCENARIOS` exportado (si v0.5 introduce un quinto modo)
- Coverage report (c8/nyc) integrado al CI

### Out of Scope (REQUIREMENTS)
- Migración programática de sesiones legacy en `state.json`
- Tests del slash command `/gsd-quick`
- Nuevos eventos NDJSON específicos para quick

### Reviewed Todos
None — `gsd-tools todo match-phase 13` devolvió 0 matches.
