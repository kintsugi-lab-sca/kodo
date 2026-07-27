# Phase 85: Saneo de deuda + Nyquist retroactivo - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-27
**Phase:** 85-saneo-de-deuda-nyquist-retroactivo
**Mode:** `--auto` — sin AskUserQuestion; cada pregunta se resolvió con la opción recomendada. Las alternativas descartadas quedan aquí para auditoría.
**Areas discussed:** Alcance del saneo del typedef `TaskHandoff` (DEBT-05), Colapso de whitespace en `deriveAnyNext` (DEBT-06), Resolver vs re-aceptar los 3 warnings de 80-REVIEW (DEBT-07), Mecanismo del backfill Nyquist (NYQ-01/02), Frontera del saneo

---

## A. Alcance del saneo del typedef `TaskHandoff` (DEBT-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Doc-only acotado a `src/session/state.js` + grep de auditoría documentado | Reescribe el comentario del campo `next` y revisa el mismo fichero; audita el resto con grep y corrige solo one-liners | ✓ |
| Solo el bloque del typedef (`:51-55`) | Cumple el criterio literal con el mínimo diff | |
| Barrido repo-wide de toda mención a la semántica del `next` | Garantiza consistencia total en código y docs | |

**[auto] Selected:** «Doc-only acotado a `state.js` + grep de auditoría» (recomendada) → **D-01, D-02**
**Notes:** El mínimo estricto se descartó porque `upsertTaskHandoff` repite la semántica en su `@param`/`@returns` (`:427-430`) a 370 líneas del typedef — arreglar uno y dejar el otro reproduce la deuda que la fase paga. El barrido repo-wide se descartó por superficie abierta y por riesgo de reescribir prosa de fases archivadas, que son snapshots históricos.

**Sub-pregunta — ¿test nuevo para DEBT-05?**

| Option | Description | Selected |
|--------|-------------|----------|
| Cero tests nuevos; citar los tres existentes | El contrato tres-estados ya está probado en `test/state/handoff-state.test.js:265,288,307` | ✓ |
| Añadir un test de regresión del contrato | Refuerzo redundante del comportamiento | |

**[auto] Selected:** «Cero tests nuevos» → **D-03**
**Notes:** Verificado en la discusión: los casos CLEAR / PRESERVE / OVERWRITE existen literalmente y son la evidencia citable de DEBT-05. Un comentario JSDoc no es testeable.

---

## B. Colapso de whitespace en `deriveAnyNext` (DEBT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| `deriveAnyNext` delega en `nextCell` (import de `./format.js`) | Una sola fuente de verdad del colapso; la incoherencia deja de ser posible por construcción | ✓ |
| Inline del `replace(/\s+/g,' ').trim()` + test anti-drift que ancle los dos lectores | Replica el patrón D-17/D-18 de Phase 84 (duplicación deliberada + custodia por test) | |
| Extraer un helper `collapseWs` a un módulo nuevo compartido | Tercera ubicación neutral para ambos consumidores | |

**[auto] Selected:** «Delegar en `nextCell`» (recomendada) → **D-04, D-05, D-06**
**Notes:** La opción 2 era la trampa de esta área — parecía la coherente con el precedente inmediato. Se descartó tras **verificar la premisa**: la duplicación de Phase 84 estaba justificada porque `src/inbox/store.js:46` importa `../cli/format.js` → **picocolors**. `src/cli/dashboard/format.js` es otro fichero y su único import es `node:path` (`:25`), con comentario de color-isolation explícito (`:22`); no hay ciclo (`format.js` no importa `select.js`), y `test/format-isolation.test.js` §TUI-04 ya cubre **todos** los ficheros del directorio, así que el invariante queda garantizado por el guard existente. Aplicar el precedente sin comprobarlo habría sido duplicación ritual. La opción 3 añade fichero e imports para lógica que ya vive documentada y probada dentro de `nextCell`.

---

## C. Los 3 warnings de 80-REVIEW: resolver vs re-aceptar (DEBT-07)

| Option | Description | Selected |
|--------|-------------|----------|
| Resolver los tres | WR-01 fix + WR-02 test + WR-03 comentario corregido y guard reforzado | ✓ |
| Resolver WR-01+WR-02, re-aceptar WR-03 con razón | El guard estático «hoy se sostiene»; ahorra el source-grep | |
| Re-aceptar los tres con razón documentada | Cumple el criterio por la vía barata (permitida literalmente) | |

**[auto] Selected:** «Resolver los tres» (recomendada) → **D-07, D-08, D-09**
**Notes:** El criterio admite re-aceptar, pero los tres son baratos y WR-01 degrada el diagnóstico de un carril **automático**: `Sidebar: 0 acción(es) aplicadas` significa hoy «todo bien» y «cmux caído con 3 fallos» indistintamente. Re-aceptar WR-03 se descartó porque su premisa escrita es **falsa hoy** (`src/providers/registry.js:27,28,57,58`); dejar el comentario mintiendo es peor que no tener guard. Sub-decisiones registradas: la línea de fallos sale por **`errorFn`, no `logFn`** (un fallo silencioso arreglado en el canal del éxito sigue invisible en un pipe); **no se inyecta el logger real** (LOG-12 intacto); el molde del refuerzo es el guard *source-hygiene* de `test/skill-sync.test.js` (Phase 84). Riesgo señalado al planner: si el source-grep sale rojo de partida es un hallazgo real de LOG-12 y **se escala** — no se relaja para greenear.

**Sub-pregunta — ¿entra IN-01?**

| Option | Description | Selected |
|--------|-------------|----------|
| No — el criterio dice «los 3 warnings»; IN-01 es *info* | Se re-registra en deferred con su trigger | ✓ |
| Sí — aprovechar que se toca el fichero | | |

**[auto] Selected:** «No» → **D-10**

---

## D. Mecanismo y forma del backfill Nyquist (NYQ-01/02)

| Option | Description | Selected |
|--------|-------------|----------|
| `/gsd-validate-phase {N}` por fase, con «cero tests nuevos / cero re-run» como constraint LOCKED | Usa la herramienta que el roadmap nombra, con guardarraíl explícito | ✓ |
| Backfill manual siguiendo el molde de `41-VALIDATION.md`, sin invocar la skill | Control total sobre el output; replica el precedente de Phase 47/51 | |
| `/gsd-validate-phase` sin restricciones | Deja que el auditor llene gaps como estime | |

**[auto] Selected:** «Skill + guardarraíl» (recomendada) → **D-11, D-12, D-13**
**Notes:** Verificado en la discusión que `init.phase-op` **resuelve fases archivadas** (`79` → `.planning/milestones/v0.18-phases/79-sidebar-doctor`; `69` → `.planning/milestones/v0.16-phases/69-red-y-autenticaci-n`, ambas con `has_verification: true`), así que la skill opera in-place sin mover nada — era el riesgo que habría forzado la opción 2. La opción 3 se descartó explícitamente: el objetivo declarado de la skill incluye *generated test files*, y eso convertiría «backfill documental de 6 fases» en generación de tests sobre código de tres milestones — el fallo de scope más probable de la fase. La forma de salida se ancla al molde ya aceptado en este repo (`41-VALIDATION.md`, backfill Phase 47; `44-VALIDATION.md`, backfill Phase 51).

**Sub-preguntas resueltas en la misma área:**

| Sub-pregunta | Opción elegida | Descartada | Decisión |
|---|---|---|---|
| Valor de `status:` en el frontmatter | `validated` en las 6 | `approved` (usado en los backfills de v0.10/v0.11, anterior a la convención actual) | D-14 |
| ¿Se reescriben los `MILESTONE-AUDIT.md` archivados? | No — snapshot histórico; el cierre va en la nota del `VALIDATION.md` + `STATE.md` §Deferred Items | Sí, para consistencia | D-15 |
| Orden de las 6 fases | 79/80/81 primero (evidencia fresca, vocabulario compartido con DEBT-07), 69/71/72 después | 69/71/72 primero por antigüedad | D-16 |
| ¿Y si una fase no da para `true`? | `validated` + `nyquist_compliant: false` con la razón escrita (estado PARTIAL de `audit-milestone` §5.5) | Forzar `true` | D-17 |

---

## E. Frontera del saneo

| Option | Description | Selected |
|--------|-------------|----------|
| Frontera estricta: solo DEBT-05/06/07 + NYQ-01/02 | La deuda adyacente queda diferida con su trigger | ✓ |
| Incluir `format-isolation` transitivo (anotado en 84 como «candidato natural de la Phase 85») | Aprovecha que la fase ya toca guards de aislamiento | |

**[auto] Selected:** «Frontera estricta» (recomendada) → **D-18, D-19, D-20**
**Notes:** La anotación de Phase 84 es una sugerencia, no un requirement; el boundary del roadmap es fijo. Además la propia nota admite que **no se ha medido el radio** de ficheros del dashboard que se pondrían rojos al seguir imports transitivos — descubrirlo dentro de una fase declarada «ligera y mecánica» es cómo se descarrila. Matiz registrado para el planner: D-09/WR-03 **sí** refuerza `check-isolation.test.js`; si eso produce un helper reutilizable, **no** se aplica a `format-isolation.test.js` en esta fase.

**Hallazgo nuevo de la discusión:** `.planning/codebase/TESTING.md` está desfasado desde 2026-04-07 — describe 2 ficheros de test frente a los 110 reales (2586 tests). Deuda real, pero no es ninguno de los 5 requirements → deferred con trigger (D-20).

---

## Claude's Discretion

Copy exacta de la línea de fallos de D-07 (dentro de la restricción `errorFn`) · redacción concreta del comentario del typedef de D-01 · número y reparto de planes (partición natural DEBT-05+06 / DEBT-07 / NYQ, pero decide el planner) · nombre y ubicación del helper de source-grep de D-09 si se extrae · N exacto de fixtures del test de D-08 · orden dentro de cada bloque de D-16 · si el grep de auditoría de D-02 va en el plan de DEBT-05 o como paso previo compartido.

## Deferred Ideas

- `format-isolation` transitivo (D-18) — medir primero el radio.
- IN-01 de 80-REVIEW (D-10) — doble `scan` por pase; clasificado *info*.
- Refresco de `.planning/codebase/TESTING.md` (D-20) — próximo `/gsd-map-codebase` o `/gsd-docs-update`.
- R-82-01 — carrera de 2.º orden de `stealLock` con holder VIVO; esta fase no abre `src/gsd/lock.js`.
- D-08 / D-08b de Phase 84 — rename `skill.md` → `SKILL.md` · auto-sync multi-skill del orquestador.
- D-24 / D-13 de Phase 84 — tecla de triage en el dashboard · `task_ref` en la línea de captura.
- Hallazgos del grep de auditoría (D-02) fuera de `state.js` que no sean one-liner.

## Todos cruzados

`todo.match-phase 85` → 0 matches. Nada que foldear ni que registrar como revisado.
