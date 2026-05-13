# Phase 20: HOOK-01 Universal Anti-Push-Fantasma - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 20-hook-01-universal-anti-push-fantasma
**Areas discussed:** Idioma del bloque, Posición + formato + variantes por modo, Contenido textual del recordatorio, Aplicar al orchestrator también

---

## Idioma del bloque

| Option | Description | Selected |
|--------|-------------|----------|
| Split actual (ES no-GSD / EN GSD) | Mantiene Phase 8 D-04 + Phase 12 QUICK-07: agente Claude lee EN en GSD, contexto humano-facing en ES. Cero fricción con golden bytes patterns existentes. | ✓ |
| Todo EN (incluso no-GSD) | Universal porque el agente es quien lee el bloque. Rompe el patrón actual de buildSessionContext (todo ES). | |
| Todo ES | Consistente con buildSessionContext no-GSD. Rompe el split: agente recibe ES en sesiones GSD, contra Phase 8 D-04. | |

**User's choice:** Split actual (ES no-GSD / EN GSD)
**Notes:** Recomendación aceptada. Preserva los dos contratos existentes sin reabrir Phase 8 D-04 ni Phase 12 QUICK-07.

---

## Rigor y contenido textual del recordatorio

| Option | Description | Selected |
|--------|-------------|----------|
| Statement + instrucción + ejemplos | "kodo NO hace git push automático. Verifica con git push real o redacta en condicional. Bad/Good ejemplos concretos." Máximo nudge contra paráfrasis ROMAN-125/126. | ✓ |
| Statement + instrucción (sin ejemplos) | Texto conciso, menos bytes. Pero el agente puede no entender dónde está la línea. | |
| Solo statement informativo | "kodo NO hace push automático." Mínimo absoluto. ROMAN-125/126 demuestra que el agente NO infiere la implicación. | |

**User's choice:** Statement + instrucción + ejemplos
**Notes:** Recomendación aceptada. Bytes finales del fraseo quedan a discreción del planner dentro del contrato semántico.

---

## Posición del bloque

| Option | Description | Selected |
|--------|-------------|----------|
| Header propio al FINAL | Append como sección `## Anti-push-fantasma` / `## No automatic push`. Offset determinista por modo, HOOK-02 preserved by construction. | ✓ |
| Inline en 'Criterios para dar la tarea por terminada' | Bullet dentro de la sección existente. Más integrado pero rompe golden bytes de las 3 ramas GSD por shifting interno. | |
| Header propio al PRINCIPIO | Inserta tras task_ref/summary. Máxima prominencia. Pero shiftea offsets de TODO el contenido posterior. | |

**User's choice:** Header propio al FINAL
**Notes:** Recomendación aceptada. Construcción append puro = bytes anteriores intactos.

---

## Granularidad por rama GSD (variantes vs bloque único)

| Option | Description | Selected |
|--------|-------------|----------|
| Bloque idéntico en las 3 ramas + no-GSD | 1 helper devuelve 1 bloque ES + 1 bloque EN. 2 goldens totales. Simplifica HOOK-03. | ✓ |
| Variantes por rama (4 bloques distintos) | quick/phase/bootstrap/no-GSD con énfasis diferenciado. 4 goldens, mayor superficie de drift. | |
| Bloque GSD común + bloque no-GSD distinto | Mismo EN para 3 ramas GSD, ES distinto para no-GSD. 2 goldens (equivalente al recomendado pero descrito por modo). | |

**User's choice:** Bloque idéntico en las 3 ramas + no-GSD
**Notes:** Recomendación aceptada. Consistente con la respuesta de idioma (split por builder, no por rama). El recordatorio es invariante semántico: "no hay push automático" no cambia por rama GSD.

---

## Aplicar al orchestrator también

| Option | Description | Selected |
|--------|-------------|----------|
| Excluir del scope de Phase 20 | Orchestrator no escribe código ni hace deploy. ROMAN-125/126 fue una sesión de trabajo. Mantiene HOOK-01 a 2 builders. Análogo a Phase 18 D-06. | ✓ |
| Incluir el recordatorio en prompt.md también | Defensa en profundidad. Suma 3ª fuente + golden bytes test extra. Mayor superficie de drift. | |
| Solo en la skill kodo-orchestrate | Defer a Phase 21 (skill sync). No toca Phase 20. | |

**User's choice:** Excluir del scope de Phase 20
**Notes:** Recomendación aceptada. Documentado como D-05 con razón explícita: el orchestrator supervisa, no produce código. Análogo a Phase 18 D-06.

---

## Claude's Discretion

- Bytes exactos del fraseo ES/EN dentro del contrato semántico de D-02 (statement + instrucción + ejemplos).
- Decisión helper vs inline para `buildAntiPushReminder(lang)` — preferencia inline, helper si reduce duplicación significativamente.
- Estrategia de tests para golden bytes (snapshot files vs asserts inline) — referencias: Phase 12 QUICK-07, Phase 14 D-07 format-isolation.
- Comando exacto del par "Bad / Good" en ejemplos ES y EN — el planner redacta dentro del contrato semántico.

## Deferred Ideas

- Enforcement runtime de `git push` verification — defer a v0.7+.
- NDJSON event `hook.anti_push.injected` — defer indefinidamente (bloque estático).
- Recordatorio en orchestrator prompt.md — reabrir solo si emerge caso de paráfrasis del orchestrator.
- Recordatorio en skill `kodo-orchestrate` — defer cohesivo con D-05; evaluar en Phase 21 si aplica.
- Variantes por rama GSD — descartado por D-04, reabrir solo si una rama necesita énfasis especial.
- Localización dinámica (i18n) por config — defer indefinido.
- Snapshot infra estilo Jest — defer cosmético, consolidar si Phase 21+ acumula más golden bytes tests.
