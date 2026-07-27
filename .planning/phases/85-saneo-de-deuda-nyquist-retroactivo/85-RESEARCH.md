# Phase 85: Saneo de deuda + Nyquist retroactivo - Research

**Researched:** 2026-07-27
**Domain:** Saneo de deuda interna en un CLI/TUI Node.js ESM (JSDoc `@ts-check`, `node:test`) + backfill documental citation-based de artefactos GSD archivados
**Confidence:** HIGH (todos los hallazgos proceden de sondas ejecutadas sobre este repo en esta sesión; cero dependencias externas, cero búsquedas web necesarias)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Constraints heredados (LOCKED — no re-discutir)

- **Cero deps npm nuevas** · **cero endpoints nuevos en `src/server.js`** · **color isolation** (`picocolors` jamás bajo `src/cli/dashboard/**`) · **`--json` byte-determinista** · **TUI never-throws** · **exit codes deterministas 0/1/2** · **LOG-12** (el grafo de `check.js` no toca `src/logger.js`).
- **Regex CONSTANTE** en todo módulo que matchee (anti-ReDoS) — jamás compilada desde input externo.
- **Greenear enmascarando está prohibido** (constraint heredado de DEBT-04): ningún assert se debilita para cerrar un warning.

### Locked Decisions

**A. DEBT-05 — alcance del saneo del typedef `TaskHandoff`**

- **D-01 (LOCKED):** el saneo es **doc-only y acotado a `src/session/state.js`**. Se reescribe el comentario del campo `next` del typedef (`:53`) para que enuncie el contrato tres-estados por PRESENCIA, y se revisa **el mismo fichero** en busca de otras menciones que repitan la semántica vieja (el `@param entry` y el `@returns` de `upsertTaskHandoff`, `:427-430`, son los candidatos naturales). Deja de citarse «WR-02» como si fuera vigente: ese aviso describía el comportamiento anterior.
  - *Descartada — barrido repo-wide de toda mención a la semántica del `next`*: convierte una corrección de 5 líneas en una auditoría de superficie abierta, con riesgo de tocar prosa de fases archivadas que son **snapshots históricos** y deben seguir describiendo lo que era cierto cuando se escribieron.
- **D-02:** el planner ejecuta **un grep de auditoría** (`next.*ausente|NO borra|preserva`) sobre `src/` y `README`/docs vivos y **documenta el resultado en el SUMMARY**. Lo que aparezca fuera de `state.js` se corrige **solo si es one-liner**; si exige contexto, se registra como deferred con su path.
- **D-03:** **cero tests nuevos para DEBT-05.** El contrato tres-estados **ya está probado**: `test/state/handoff-state.test.js` tiene los tres casos explícitos — `CLEAR: next: null … BORRA` (`:265`), `PRESERVE: campo next AUSENTE … PRESERVA` (`:288`), `OVERWRITE: next no vacío … SOBRESCRIBE` (`:307`). **La cita a esos tres tests es la evidencia de DEBT-05**, y va en el SUMMARY.

**B. DEBT-06 — dónde vive el colapso de whitespace**

- **D-04 (LOCKED):** `deriveAnyNext` **delega en `nextCell`** (`import { nextCell } from './format.js'`), quedando `rows.some((r) => nextCell(r).length > 0)`. **Una sola fuente de verdad del colapso**.
  - **Por qué aquí SÍ se importa y en Phase 84 (D-17) NO:** `src/cli/dashboard/format.js` es puro (único import `node:path`, `:25`), lleva el comentario de color-isolation explícito (`:22`), y no hay ciclo. El precedente de 84 **no aplica**.
  - **El aislamiento queda garantizado por el guard que ya existe**: `test/format-isolation.test.js` §TUI-04 comprueba **todos** los ficheros bajo `src/cli/dashboard/`.
  - *Descartada — inline del `replace(/\s+/g, ' ').trim()` en `select.js` + test anti-drift.* *Descartada — extraer un tercer helper `collapseWs`.*
- **D-05:** el **contrato de `deriveAnyNext` no cambia**: flag estructural (`boolean`), computado sobre el set **SIN filtrar** (`enriched`, no `filtered` — Pitfall 4 de Phase 75), never-throws para no-string. `App.js:820` **no se toca**.
- **D-06:** el test RED se escribe **antes** del fix: `deriveAnyNext([{ next: '   ' }])` y `deriveAnyNext([{ next: '\n\t' }])` deben dar **`false`** (hoy dan `true`). Se añade a `test/dashboard-select.test.js` junto al bloque LIVE-05 existente (`:471`). Los casos ya cubiertos ahí (`:473-496`) deben seguir verdes **sin tocarlos**.

**C. DEBT-07 — los 3 warnings de 80-REVIEW, uno a uno**

**Política: los tres se RESUELVEN. Ninguno se re-acepta.**

- **D-07 — WR-01 (fallos por-item silenciosos): se resuelve.** Tras el `logFn` de acciones aplicadas, si `(r.errors || []).length > 0`, emitir por **`errorFn`** una línea `[kodo:check] Sidebar: N acción(es) fallida(s) (fail-open)`.
  - **No se inyecta el logger real** — LOG-12 sigue intacto. **El fail-open no cambia.** **Copy exacto a discreción del planner**, con una restricción: **`errorFn`, no `logFn`**.
- **D-08 — WR-02 (rama de advisories y línea «Sidebar: N aplicadas» sin cobertura): se resuelve.** Test nuevo en `test/check.test.js` con `needsOrchestrator: true` + `scanFn` que devuelve `hasAdvisories: true` con `missing_group` no vacío + `executeFn` que devuelve `{ added: 2, ungrouped: 1, errors: [...] }`, capturando `logFn`/`errorFn` en arrays y aseverando el conteo `applied = 3`, la línea de advisories y la línea de fallos de D-07. **El mismo test cubre WR-01 y WR-02.**
- **D-09 — WR-03 (guard LOG-12 estático sobre premisa falsa): se resuelve en sus dos mitades.**
  1. **Corregir el comentario mentiroso** de `test/check-isolation.test.js:14,33-34`.
  2. **Reforzar el guard con un source-grep** sobre los ficheros del grafo que `walkImports` ya calcula, buscando `import('…logger.js')` dinámico y **excluyendo `logger-events.js` / `logger-noop`**.
  - **Precedente directo en el repo:** el guard *source-hygiene* de `test/skill-sync.test.js` (Phase 84).
  - **Nota de riesgo para el planner:** **Verifícalo antes de escribir el assert**: si el grep sale rojo de partida, es un hallazgo real de LOG-12 y **se escala** — no se relaja el grep para greenear.
- **D-10:** **`IN-01` no entra.** Se re-registra en `<deferred>` con su trigger.

**D. NYQ-01/02 — mecanismo y forma del backfill**

- **D-11 (LOCKED):** el vehículo es **`/gsd-validate-phase {N}` invocado por fase**. `init.phase-op` **resuelve fases archivadas**. La skill opera sobre el directorio archivado sin mover nada.
- **D-12 (LOCKED — el guardarraíl que hace esto una fase «ligera y mecánica»): CERO tests nuevos y CERO re-ejecución de la suite.** Si el auditor detecta un gap de cobertura real, se registra como fila **manual-only** o como **deferred con su path**, nunca como test nuevo.
- **D-13:** la **forma de salida es el molde ya probado en este repo**: `.planning/milestones/v0.10-phases/41-…/41-VALIDATION.md` (backfill Phase 47, NYQ-01) — nota de cabecera, tabla *Test Infrastructure* con la evidencia citada, *Sampling Rate* con la política de backfill explícita, *Per-Task Verification Map* con columna **«Evidencia citada (fichero + resultado)»**, *Manual-Only Verifications* y *Validation Sign-Off* con checklist.
- **D-14:** frontmatter resultante: **`nyquist_compliant: true`** + **`status: validated`** en las 6. `wave_0_complete`: se pone a `true` solo si el backfill puede citarlo. **Ante duda, se deja como está.**
- **D-15:** **los `MILESTONE-AUDIT.md` archivados NO se reescriben.** El cierre se registra en (a) la nota de cabecera del propio `VALIDATION.md` y (b) la fila correspondiente de `STATE.md` §Deferred Items.
- **D-16:** **orden 79/80/81 primero, 69/71/72 después.** **Cada fase es independiente** — el planner puede paralelizar dentro de cada bloque.
- **D-17:** **si una fase no admite `nyquist_compliant: true` honestamente**, **no se fuerza**: se deja `validated` + `nyquist_compliant: false` con la razón escrita (estado PARTIAL).

**E. Frontera del saneo**

- **D-18 (LOCKED):** **el `format-isolation` transitivo NO entra.** **Matiz:** D-09/WR-03 **sí** refuerza `check-isolation.test.js`; si ese refuerzo produce un helper reutilizable, **no se aplica a `format-isolation.test.js` en esta fase**.
- **D-19:** la fase **no abre `src/gsd/lock.js`** ni el formato de línea del inbox ni `src/server.js`.
- **D-20:** **`.planning/codebase/TESTING.md` no se refresca aquí.** Va a `<deferred>` con su trigger.

### Claude's Discretion

Copy exacta de la línea de fallos de D-07 (dentro de la restricción `errorFn`) · redacción concreta del comentario del typedef de D-01 · número y reparto de planes (los bloques DEBT y NYQ son independientes; la partición natural es DEBT-05+06 / DEBT-07 / NYQ, pero el planner decide) · nombre y ubicación del helper de source-grep de D-09 si lo extrae · N exacto de fixtures del test de D-08 · orden de invocación dentro de cada bloque de D-16 · si el grep de auditoría de D-02 se ejecuta como parte del plan de DEBT-05 o como paso previo compartido.

### Deferred Ideas (OUT OF SCOPE)

- **`format-isolation` transitivo** (D-18) — **Trigger:** medir primero el radio de ficheros del dashboard que se pondrían rojos.
- **IN-01 de 80-REVIEW** (D-10) — doble `scan` por pase. **Trigger:** que el conteo de advisories se contradiga con lo aplicado en un caso real.
- **Refresco de `.planning/codebase/TESTING.md`** (D-20). **Trigger:** el próximo `/gsd-map-codebase` o `/gsd-docs-update`, o la apertura del siguiente milestone.
- **R-82-01** — carrera de 2.º orden en `stealLock`. Esta fase **no abre `src/gsd/lock.js`** (D-19).
- **D-08** (Phase 84) — rename `kodo-orchestrate/skill.md` → `SKILL.md`.
- **D-08b** (Phase 84) — auto-sync multi-skill de `src/orchestrator/launch.js`.
- **D-24 / D-13** (Phase 84) — tecla del dashboard para triar el inbox · `task_ref` en la línea de captura.
- **Hallazgos fuera de `state.js` en el grep de auditoría de D-02** que no sean one-liner.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Descripción | Soporte de este research |
|----|-------------|--------------------------|
| **DEBT-05** | El typedef `TaskHandoff` (`src/session/state.js`) documenta la semántica post-DEBT-01 — cierra 81-REVIEW WR-01 | §Sonda 4 (grep de auditoría D-02 ejecutado): **el único enunciado stale en todo `src/` es `state.js:53`**. `:405-410`, `:425`, `:429-430`, `:449-454` y `session-end.js:299/384/405` ya son correctos. README / `.planning/codebase/` / `prompt.md` / skills: 0 hits. Evidencia citable ya identificada (`test/state/handoff-state.test.js:265/288/307`). |
| **DEBT-06** | `deriveAnyNext` (`src/cli/dashboard/select.js`) colapsa whitespace al decidir la presencia de la columna `next` | §Sonda 2 (delegación verificada empíricamente): topología sin ciclo confirmada, TUI-04 confirmado como guard *por-fichero directo* sobre todo el directorio, los 8 asserts LIVE-05 existentes permanecen verdes bajo delegación, y 3 casos RED reproducidos hoy. |
| **DEBT-07** | Los 3 warnings de 80-REVIEW.md quedan resueltos o re-aceptados individualmente con razón documentada | §Sonda 1 (WR-03: guard **GREEN** a HEAD; regex admisible determinada; trampa del walker identificada), §Sonda 3 (WR-01+WR-02: shape DI exacta, literales exactos, hueco de cobertura confirmado por grep). |
| **NYQ-01** | Phases 79/80/81 con `VALIDATION.md` `nyquist_compliant: true` citation-based | §Sonda 5 (mecánica de la skill: qué pasos escriben tests y cómo suprimirlos) + §Sonda 6 (inventario de evidencia citable por fase, con números concretos). Las 3 son defendibles como `true`. |
| **NYQ-02** | Phases 69/71/72 con `VALIDATION.md` `nyquist_compliant: true` citation-based | Ídem. Las 3 son defendibles como `true`; **72 es la más cara** — su `VALIDATION.md` sigue siendo la plantilla sin rellenar. |

</phase_requirements>

---

## Summary

Esta fase no tiene «stack estándar» que investigar: es un barrido interno sobre un CLI/TUI Node.js ESM con `node:test`, cero dependencias nuevas y cero superficie externa. El valor del research está enteramente en **sondas empíricas** que retiran incertidumbre del plan. Se ejecutaron seis y las seis resuelven una decisión que, sin ellas, el planner habría tenido que adivinar.

**El hallazgo que más cambia el plan** es el de DEBT-07/WR-03. El guard reforzado **saldría GREEN a HEAD** — la invariante LOG-12 se sostiene tanto en el grafo estático (23 ficheros) como en la clausura completa siguiendo aristas dinámicas (29 ficheros): `src/logger.js` no es alcanzable por ningún camino. No hay escalado. Pero el mismo probe descubrió dos trampas de implementación: (1) una regex *naive* `import\(.*logger` produce **13 falsos positivos**, cinco de ellos apuntando literalmente a `../logger.js`, todos ellos imports de TIPO en JSDoc que se borran en runtime — el assert **debe** filtrar comentarios primero, con el helper `stripComments` que ya vive verbatim en 9 ficheros de test del repo; y (2) si alguien «mejora» `walkImports` para seguir imports dinámicos en vez de añadir un grep aparte, **pone rojos dos guards existentes** (`github/provider.js` y `github/normalize.js` están en la clausura dinámica, porque `check.js:103` llama `initRegistry()` → `registry.js` los carga con `await import()`). D-09 pide un grep sobre la lista que el walker ya devuelve: eso es exactamente lo correcto y no es negociable.

**El segundo hallazgo que más cambia el plan** es el de NYQ. Las 6 fases tienen evidencia rica y citable — cada `VERIFICATION.md` mapea truth → fichero de test concreto — así que `nyquist_compliant: true` es defendible en las 6 y **D-17 no se activa en ninguna**. Lo que sí varía brutalmente es el **coste de reconstrucción**: `81-VALIDATION.md` llega casi completo (6 filas reales con `File Exists ✅`), mientras que **`72-VALIDATION.md` sigue siendo la plantilla literal sin rellenar** (`{pytest 7.x / jest 29.x …}`, `REQ-{XX}`, `{tests/test_file.py}`) sobre 5 planes y 8 requirements. Tratar las 6 como intercambiables es el error de estimación más probable de este bloque. Además: el workflow `validate-phase` genera tests en su **§5** (spawn del `gsd-nyquist-auditor`) y los commitea en su **§7**; D-12 se suprime eligiendo la **opción 2 del gate §4** («Skip — mark manual-only»), que salta §5 por completo, o llegando a §3 sin gaps. Ninguna otra parte del workflow re-corre la suite.

**Primary recommendation:** partir en 3 planes independientes — (1) DEBT-05+06 (doc-only + delegación de una línea con su RED previo), (2) DEBT-07 (los 3 warnings, con el guard de WR-03 escrito sobre `stripComments` y **sin tocar `walkImports`**), (3) NYQ-01+02 (6 invocaciones de `/gsd-validate-phase`, con el gate §4 respondido «skip» y el molde de `41-VALIDATION.md`, presupuestando 72 al doble que las demás). Los tres son paralelizables entre sí.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Contrato semántico del `next` (DEBT-05) | Documentación de tipos (`src/session/state.js` JSDoc) | — | El comportamiento ya vive en la capa de estado (`:449-454`); el typedef es *solo* su descripción. Cero cambio de comportamiento, cero cambio de tier. |
| Decisión de presencia de la columna `next` (DEBT-06) | Capa **derive** del TUI (`src/cli/dashboard/select.js`) | Capa **presentación** del TUI (`src/cli/dashboard/format.js`) | El *flag estructural* es derive (lo consume `App.js`); la *regla de colapso* es presentación y ya vive en `nextCell`. D-04 mantiene cada responsabilidad en su tier y hace que derive **consuma** presentación en vez de duplicarla. |
| Observabilidad del piggyback del sidebar (DEBT-07/WR-01) | Capa **CLI/orquestación** (`src/check.js`) vía `errorFn` → stderr | — | LOG-12 prohíbe que el tier de logging estructurado (`src/logger.js`) entre en el grafo de `check.js`. El canal correcto es el que el piggyback ya usa: stdout/stderr, 0 tokens. |
| Custodia de la invariante LOG-12 (DEBT-07/WR-03) | Capa **test/guard** (`test/check-isolation.test.js`) | — | Ni `src/check.js` ni el walker cambian: el refuerzo es un assert nuevo sobre las fuentes que el walker ya enumera. |
| Backfill de contrato de validación (NYQ-01/02) | Capa **artefacto de planificación** (`.planning/milestones/**/{N}-VALIDATION.md`) | `.planning/STATE.md` §Deferred Items | Cero código de producción, cero tests. El único efecto colateral admitido es cerrar las filas de `STATE.md`, y eso va por `gsd-tools`, nunca por `Write` directo. |

---

## Standard Stack

### Core

| Librería | Versión | Propósito | Por qué es la estándar aquí |
|----------|---------|-----------|-----------------------------|
| `node:test` | built-in (runner nativo de Node) | Framework de test de todo el repo | Es la convención del repo. `package.json:10` → `"test": "node --test $(find test -name '*.test.js' -type f)"`. Sin config externa. [VERIFIED: `package.json` leído en esta sesión] |
| `node:assert/strict` | built-in | Aserciones | Convención uniforme en los 110 ficheros de test. [VERIFIED: grep sobre `test/`] |
| `node:fs` / `node:path` / `node:url` | built-in | Lectura de fuentes en los guards source-hygiene | Patrón ya usado por `check-isolation.test.js`, `format-isolation.test.js`, `skill-sync.test.js`. [VERIFIED: ficheros leídos] |

### Supporting

| Recurso | Ubicación | Propósito | Cuándo usarlo |
|---------|-----------|-----------|---------------|
| `stripComments` | duplicado **verbatim en 9 ficheros de test** | Filtrar comentarios antes de un assert source-hygiene | **Obligatorio** para el guard de D-09. Ver §Code Examples. |
| `walkImports` / `extractImports` | `test/check-isolation.test.js:23-52` | Enumerar el grafo estático de imports desde una entry | D-09 usa su **salida**; **no** se modifica el walker. |
| `nextCell` | `src/cli/dashboard/format.js:264` | Colapso `/\s+/g` + `trim`, never-throws para no-string | D-04 lo convierte en la fuente única del colapso. |
| `/gsd-validate-phase {N}` | `$HOME/.claude/skills/gsd-validate-phase/SKILL.md` + `$HOME/.claude/gsd-core/workflows/validate-phase.md` | Vehículo del backfill NYQ | Con el gate §4 respondido «Skip — mark manual-only» (ver §Sonda 5). |

### Alternatives Considered

| En vez de | Se podría usar | Tradeoff |
|-----------|----------------|----------|
| `stripComments` inline en `check-isolation.test.js` (10ª copia) | Extraer a `test/helpers/strip-comments.js` | El repo ya tomó esta decisión 9 veces: copia verbatim con comentario de procedencia. `test/helpers/` existe pero aloja *fixtures y procesos hijo* (`lock-race-child.mjs`, `logger-fixtures.js`, `logger-sink.js`, `startup-baseline.js`), no helpers de aserción. **Recomendación: copiar verbatim** con la línea de procedencia, como hace `skill-sync.test.js:113-114`. D-18 además prohíbe reutilizarlo en `format-isolation.test.js` en esta fase. |
| Grep aparte sobre la salida de `walkImports` (D-09) | Extender `walkImports` para seguir `import()` dinámico | **Prohibido de facto**: pone ROJOS dos guards existentes (`github/provider.js`, `github/normalize.js`). Ver §Pitfall 1. |

**Installation:**

```bash
# Ninguna. Constraint LOCKED: cero deps npm nuevas.
```

---

## Package Legitimacy Audit

**No aplica.** Esta fase **no instala ningún paquete externo** — constraint heredado LOCKED «cero deps npm nuevas», y las tres sondas de código confirman que todo lo necesario (`node:test`, `node:assert/strict`, `node:fs`, `node:path`, `node:url`) son builtins de Node ya en uso.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| *(ninguno)* | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

El planner **no debe** insertar ningún `checkpoint:human-verify` de instalación: no hay instalación.

---

## Sonda 1 — DEBT-07 / WR-03: probe empírico del guard LOG-12

> **Esta es la sonda de mayor valor del research.** El CONTEXT (D-09) pide explícitamente: *«Verifícalo antes de escribir el assert: si el grep sale rojo de partida, es un hallazgo real de LOG-12 y se escala»*.

### Veredicto: **GREEN**. No hay hallazgo LOG-12. No se escala.

### 1a. Grafo estático de `src/check.js` (lo que `walkImports` ya devuelve) — 23 ficheros

[VERIFIED: sonda ejecutada replicando `walkImports`/`extractImports` verbatim de `test/check-isolation.test.js`]

```
src/check.js                    src/labels.js
src/cli/config-args.js          src/logger-events.js
src/cli/format.js               src/logger-noop.js
src/cmux/client.js              src/orchestrator/launch.js
src/cmux/colors.js              src/providers/registry.js
src/cmux/sidebar-doctor.js      src/session/health.js
src/config-validate.js          src/session/manager.js
src/config.js                   src/session/prompt-file.js
src/gsd/lock.js                 src/session/state-lock.js
src/host/interface.js           src/session/state.js
src/interface.js                src/skill/sync.js
                                src/tasks/pending.js
```

### 1b. Imports dinámicos REALES en ese grafo (tras filtrar comentarios) — 5

[VERIFIED: sonda ejecutada]

| Fichero | Import dinámico | ¿Viola LOG-12? |
|---------|-----------------|----------------|
| `src/providers/registry.js` | `await import('../config.js')` (×2, `:27` y `:57`) | No |
| `src/providers/registry.js` | `await import('./plane/provider.js')` (`:28`) | No |
| `src/providers/registry.js` | `await import('./github/provider.js')` (`:58`) | No |
| `src/session/state.js` | `import('../logger-events.js')` (`:247`) | **No — allowlist explícita de D-09** |

**Confirma la premisa falsa que WR-03 denuncia:** el comentario de `test/check-isolation.test.js:14` y `:33` afirma «el repo no lo usa (verificado en 06-RESEARCH A3)». Es falso desde hace fases.

### 1c. Trampa de la regex naive — 13 falsos positivos, 5 apuntando a `logger.js`

Un grep `import\s*\(.*logger` **sin filtrar comentarios** produce 13 hits sobre el grafo de 23 ficheros. **Cinco de ellos citan literalmente `../logger.js`** y pondrían el guard **ROJO a HEAD sin ninguna violación real**:

| Fichero | Línea | Contenido | Naturaleza |
|---------|-------|-----------|-----------|
| `src/cmux/client.js` | `:11` | `* @param {import('../logger.js').Logger} [logger]` | JSDoc type-import (borrado en runtime) |
| `src/logger-events.js` | `:127` | `* @typedef {import('./logger.js').Logger} Logger` | JSDoc type-import |
| `src/orchestrator/launch.js` | `:132` | `*   logger?: import('../logger.js').Logger,` | JSDoc type-import |
| `src/session/manager.js` | `:621` | `* @param {import('../logger.js').Logger} [logger]` | JSDoc type-import |
| `src/session/prompt-file.js` | `:57` | `* @param {import('../logger.js').Logger} [logger]` | JSDoc type-import |
| `src/session/state.js` | `:216` | `* @param {import('../logger.js').Logger} [logger]` | JSDoc type-import |
| `src/skill/sync.js` | `:30` | `*   logger?: import('../logger.js').Logger,` | JSDoc type-import |
| `src/logger-events.js` | `:276` | comentario que *menciona* `await import('../../logger-events.js')` | prosa |
| `src/session/state.js` | `:335,:359,:426,:503` | `@param {import('../logger-noop.js')...}` | JSDoc type-import |

Un `import('x')` en **posición de tipo JSDoc** no crea arista de runtime — TypeScript/JSDoc lo borra. Aceptar un assert que se ponga rojo por esto obligaría a debilitarlo después, que es exactamente lo que el constraint anti-greenear prohíbe.

### 1d. La regex admisible

[VERIFIED: sonda ejecutada — 1 hit, en allowlist ⇒ GREEN]

```js
const DYNAMIC_LOGGER_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]*logger[^'"]*\.js)['"]/g;
const LOGGER_ALLOWLIST_RE = /logger-events\.js$|logger-noop\.js$/;
```

Aplicada **sobre `stripComments(readFileSync(file))`** de cada fichero de la salida de `walkImports(join(SRC,'check.js'))`:

| Escenario | Hits | Veredicto |
|-----------|------|-----------|
| Sin `stripComments` | 13 (5 → `logger.js`) | **ROJO — inadmisible** |
| **Con `stripComments`** | **1** (`src/session/state.js` → `import('../logger-events.js')`, en allowlist) | **VERDE** |

La regex es **CONSTANTE de módulo** (constraint anti-ReDoS LOCKED) y no se compila desde ningún input.

### 1e. Bonus — clausura estática + dinámica: también verde

[VERIFIED: sonda ejecutada]

Siguiendo además las aristas dinámicas, la clausura de `check.js` sube a **29 ficheros** (los 23 + `providers/{github,plane}/{provider,client,normalize}.js`). Sobre esa clausura completa:

- `src/logger.js` **NO es alcanzable por ningún camino** → LOG-12 se sostiene de verdad, no solo estructuralmente.
- La regex de 1d produce **5 hits, los 5 a `logger-events.js`** (allowlist) → verde también.

**Recomendación:** ceñirse al alcance literal de D-09 (los ficheros que `walkImports` ya devuelve, 23). El dato de la clausura de 29 se documenta como evidencia de que la invariante es real, **no** como ampliación del assert — ampliarla es la trampa del Pitfall 1.

### 1f. Lo que el comentario corregido debe (y no debe) decir

`src/check.js:103` ejecuta `await initRegistry()` → `registerDefaults()` → `await import('./github/provider.js')`. Es decir: **`kodo check` SÍ carga `github/provider.js` en runtime**, pese a que el guard `kodo check does not import src/providers/github/provider.js transitively` está verde.

El comentario nuevo debe ser honesto sobre esto: **los guards son sobre el grafo de MODULE-LOAD (coste de arranque + la prohibición de `logger.js`), no una afirmación sobre alcanzabilidad en runtime.** Verificado además que ni `github/provider.js` ni `plane/provider.js` alcanzan `logger.js` (8 ficheros cada uno, 0 hits) — así que la invariante que importa se mantiene por ambos caminos.

---

## Sonda 2 — DEBT-06: probe de delegación

### 2a. Topología: sin ciclo, sin dependencia nueva más allá de `node:path`

[VERIFIED: greps ejecutados]

| Hecho | Evidencia |
|-------|-----------|
| `src/cli/dashboard/select.js` tiene **cero imports de runtime** hoy | `grep "^import"` → vacío. Solo un `@typedef {import('./format.js').EnrichedSession}` en `:30-32`, que es type-only. D-04 le añade el primero, **al módulo que su typedef ya referencia**. |
| `src/cli/dashboard/format.js` importa exactamente **un** módulo | `:25` → `import { basename } from 'node:path';` |
| `format.js` **no** importa `select.js` → **sin ciclo** | `grep "select" src/cli/dashboard/format.js` → 0 hits |
| Coste transitivo de la delegación | **`node:path`, y nada más** |
| `App.js` ya importa **ambos** | `:71` `from './select.js'`, `:72` `import { deriveRepo } from './format.js'`. El import de D-04 no introduce un módulo nuevo al bundle del TUI. |

### 2b. §TUI-04 sigue cubriéndolo — y es un guard **por fichero directo**, no transitivo

[VERIFIED: `test/format-isolation.test.js:200-221` leído]

```js
const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
const leakers = dashFiles
  .filter((f) => extractImports(readFileSync(f, 'utf-8')).includes('picocolors'))
```

Comprueba **cada fichero del directorio por separado**. `format.js` ya está en esa lista, luego un `picocolors` en `format.js` pone TUI-04 rojo **con independencia** de que `select.js` lo importe o no. La premisa de D-04 se confirma literalmente. **No se modifica** (D-18).

Y el matiz de D-18 queda cuantificado: el gap transitivo de TUI-04 es *un fichero del dashboard que importe algo de FUERA del dashboard que a su vez importe picocolors*. `format.js` está **dentro** del directorio → la delegación de D-04 **no ensancha ese gap ni un byte**.

### 2c. Riesgos descartados

| Riesgo hipotético | Verificado |
|-------------------|-----------|
| ¿Algún guard asevera que `select.js` es hoja de cero imports? | **No.** Los leaf-guards del repo son `logger-noop.js`, `session/handoff.js`, `tasks/pending.js`. `select.js` no tiene ninguno. [VERIFIED: grep sobre `test/`] |
| ¿`test/startup-budget.test.js` se rompe? | **No.** Está en `it.skip` (es el único `skipped: 1` de la suite) y mide `bin/kodo check`, no el TUI. Riesgo cero. [VERIFIED: fichero leído] |
| ¿Alguien más llama `deriveAnyNext`? | **No.** Un solo caller de producción: `src/cli/dashboard/App.js:820` → `deriveAnyNext(enriched)` (set SIN filtrar, D-05 preservado). [VERIFIED: grep] |

### 2d. Los 8 asserts LIVE-05 existentes siguen verdes bajo delegación — verificado ejecutando ambas versiones

[VERIFIED: script ejecutado importando `deriveAnyNext` y `nextCell` reales]

| Caso (de `test/dashboard-select.test.js:473-497`) | HOY | Con delegación | Esperado |
|---|---|---|---|
| `[{next:'Escribir el test RED'},{next:null}]` | true | true | true ✓ |
| `[{next:''},{next:'algo'}]` | true | true | true ✓ |
| `[{next:null},{}]` | false | false | false ✓ |
| `[{next:''},{next:undefined}]` | false | false | false ✓ |
| `[]` | false | false | false ✓ |
| `[{next:42},{next:{}}]` | false | false | false ✓ |
| Pitfall 4 (`applyFilter` + set completo) | true/false | true/false | ✓ |

**Ninguno cambia.** Si al implementar alguno cambia, la delegación está mal hecha (D-06).

### 2e. Los casos RED exactos que hay que añadir

[VERIFIED: reproducidos contra el código a HEAD]

| Caso RED | `deriveAnyNext` HOY | Con delegación | Esperado |
|---|---|---|---|
| `deriveAnyNext([{ next: '   ' }])` | **`true`** ❌ | `false` | `false` |
| `deriveAnyNext([{ next: '\n\t' }])` | **`true`** ❌ | `false` | `false` |
| `deriveAnyNext([{ next: ' \r\n ' }])` | **`true`** ❌ | `false` | `false` |

Los tres son RED hoy. El tercero (`\r`) es un extra recomendado: `nextCell` lo colapsa vía `/\s+/g` y refuerza la coherencia con `stripControlChars` (`src/cli/format.js:73`, que elimina `\r`).

### 2f. Baseline de ejecución

[VERIFIED: `node --test` ejecutado en esta sesión]

```
node --test test/dashboard-select.test.js test/check.test.js \
            test/check-isolation.test.js test/format-isolation.test.js \
            test/state/handoff-state.test.js
# tests 106 · suites 22 · pass 106 · fail 0
```

Suite completa a HEAD (citada de `84-VERIFICATION.md:94`): **2586 tests · 2585 pass · 0 fail · 1 skipped**.

---

## Sonda 3 — DEBT-07 / WR-01+WR-02: shape exacta del test

### 3a. Literales exactos hoy en `src/check.js:156-166`

[VERIFIED: fichero leído]

```js
const deps = {}; // defaults de producción → noopLogger (LOG-12); NO inyectar logger real.
const report = await scanFn(deps);
const r = await executeFn(deps, { fix: true });
const applied = (r.added || 0) + (r.ungrouped || 0);
logFn(`[kodo:check] Sidebar: ${applied} acción(es) aplicadas`);
// missing_group es advisory report-only (79-04): acción de operador, no se ejecuta.
if (report && report.hasAdvisories) {
  logFn(`[kodo:check] Sidebar advisories: ${report.missing_group.length} (acción de operador)`);
}
} catch (err) {
  errorFn(`[kodo:check] Sidebar doctor error: ${err.message}`);
}
```

Las tres líneas literales, verbatim, para que el planner ancle el copy nuevo:

1. `` `[kodo:check] Sidebar: ${applied} acción(es) aplicadas` `` (por `logFn`)
2. `` `[kodo:check] Sidebar advisories: ${report.missing_group.length} (acción de operador)` `` (por `logFn`)
3. `` `[kodo:check] Sidebar doctor error: ${err.message}` `` (por `errorFn`)

**Copy sugerido para D-07** (dentro de la discreción del planner, coherente con la línea 1 y con el snippet del propio 80-REVIEW):

```js
const failed = (r.errors || []).length;
if (failed > 0) {
  errorFn(`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`);
}
```

> **Nota para el planner:** el texto en prosa de 80-REVIEW WR-01 dice *«emitirlo por `logFn`»* pero su propio snippet de fix usa `errorFn`. **D-07 resuelve la contradicción a favor de `errorFn`** y esa es la restricción vinculante.

### 3b. Confirmación empírica del hueco de cobertura (WR-02)

[VERIFIED: `grep -rn "Sidebar advisories\|acción(es) aplicadas\|Sidebar doctor error" test/ src/`]

Las tres cadenas aparecen **exclusivamente en `src/check.js`**. **Cero ocurrencias en todo `test/`.** El hueco que WR-02 denuncia es real y total: ni la línea de aplicadas, ni el cálculo `applied`, ni la rama de advisories tienen un solo assert.

### 3c. Shape DI exacta de los casos existentes (`test/check.test.js:320-440`)

[VERIFIED: fichero leído]

Helpers del `describe('check.js — runCheckAndAct sidebar doctor piggyback (ORCH-07)')`:

```js
/** SidebarReport limpio (sin acciones ni advisories). */
function cleanReport() {
  return {
    missing_group: [], loose_workspace: [], empty_group: [],
    protected: { sessions: [] },
    hasActions: false, hasAdvisories: false,
  };
}
/** SidebarResult vacío (0 acciones). */
function emptyResult() {
  return { created: 0, added: 0, ungrouped: 0, errors: [] };
}
```

Forma canónica de cada caso (todos `async`, todos con las 6 DI):

```js
await runCheckAndAct({
  runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
  scanFn:     async () => cleanReport(),
  executeFn:  async (_deps, opts) => emptyResult(),
  launchFn:   async () => {},
  logFn:      () => {},
  errorFn:    () => {},
});
```

| Caso | `needsOrchestrator` | `scanFn` | `hasAdvisories` | Qué asevera | ¿Alcanza el piggyback? |
|------|---------------------|----------|-----------------|-------------|------------------------|
| **A** | `true` | `cleanReport()` | false | `execArgs === {fix:true}`; orden `execute` < `launch` | Sí, pero rama de advisories NO |
| **B** | `false` | `cleanReport()` | false | `calls === []` (edge a) | No |
| **C** | `false` | scan sucio inline | **true** | `calls === []` (invariante D-04) | **No** — el gate cierra antes |
| **D** | `true` | `cleanReport()` | false | `executeFn` que lanza → `launch` corre igual | Sí (fail-open) |
| **D2** | `true` | lanza | — | `scanFn` que lanza → `launch` corre, `execute` no | Sí (fail-open) |
| **E** | — | — | — | source-assert: `runCheck()` no contiene `Sidebar` | N/A |

**Confirmado el diagnóstico de WR-02:** A/D usan `cleanReport()` (advisories false) y C tiene advisories true pero `needsOrchestrator: false`. **Ninguno cruza las dos condiciones.** Los seis pasan `logFn: () => {}` / `errorFn: () => {}` — descartan el output, nunca lo capturan.

### 3d. Shape del test nuevo de D-08 (cubre WR-01 + WR-02 a la vez)

Tipo de `errors` [VERIFIED: `src/cmux/sidebar-doctor.js:326`]:

```js
/** @typedef {{ created:number, added:number, ungrouped:number,
 *              errors: Array<{ category:string, target:string, reason:string }> }} SidebarResult */
```

Forma prescrita:

```js
it('Test F: gate ON + advisories + fallos por-item — las 3 líneas salen por su canal (WR-01/WR-02)', async () => {
  const logs = [];
  const errs = [];
  await runCheckAndAct({
    runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
    scanFn: async () => ({
      missing_group: [{ name: 'g', anchor: 'workspace:1', members: ['workspace:1'] }],
      loose_workspace: [], empty_group: [],
      protected: { sessions: [] },
      hasActions: true, hasAdvisories: true,
    }),
    executeFn: async (_deps, opts) => ({
      created: 0, added: 2, ungrouped: 1,
      errors: [
        { category: 'loose_workspace', target: 'workspace:2', reason: 'cmux exit 1' },
        { category: 'loose_workspace', target: 'workspace:3', reason: 'cmux exit 1' },
      ],
    }),
    launchFn: async () => {},
    logFn: (m) => logs.push(m),
    errorFn: (m) => errs.push(m),
  });

  // WR-02: el conteo applied = added + ungrouped (NO created) y la rama de advisories.
  assert.ok(logs.includes('[kodo:check] Sidebar: 3 acción(es) aplicadas'));
  assert.ok(logs.includes('[kodo:check] Sidebar advisories: 1 (acción de operador)'));
  // WR-01: los fallos por-item salen por errorFn, NO por logFn.
  assert.ok(errs.some((m) => m.includes('2 acción(es) fallida(s)')));
  assert.ok(!logs.some((m) => m.includes('fallida')), 'un fallo por logFn sigue siendo invisible en un pipe');
});
```

Notas de diseño: `created: 0` es deliberado — hace que el test detecte la regresión que WR-02 nombra («usar `r.created` en lugar de `r.added`»). `missing_group` con **1** elemento distingue el conteo de advisories (1) del de aplicadas (3) y del de fallidas (2): tres números distintos, ningún falso verde por coincidencia. Se ubica dentro del `describe` existente (`:320`), después del Test E.

---

## Sonda 4 — DEBT-05 / D-02: grep de auditoría **ejecutado** (report-only, nada modificado)

### 4a. Resultado: **un solo hit stale en todo `src/`**

[VERIFIED: greps ejecutados sobre `src/`, `README.md`, `.claude/skills/`, `.planning/codebase/`, `src/orchestrator/prompt.md`]

| # | Fichero:línea | Contenido (extracto) | Clasificación | Acción |
|---|---------------|----------------------|---------------|--------|
| **H1** | **`src/session/state.js:53`** | `// … OJO al leerlo (WR-02): un `next` ausente/null NO borra el previo, así que este valor puede venir de un cierre ANTERIOR al `updated_at` … para pisarlo hay que escribir uno nuevo no nulo.` | **STALE — el objetivo literal de DEBT-05** | **One-liner. Se corrige.** |

Búsquedas ejecutadas y sus resultados:

| Patrón | Alcance | Hits stale |
|--------|---------|-----------|
| `ausente/null` | `src/` + `README.md` + `.claude/skills/` + `.planning/codebase/` | **1** → H1 |
| `NO borra` / `no borra el previo` | ídem | **1** → H1 (mismo) |
| `NEXT:` + (`preserv`\|`borra`\|`ausen`\|`null`\|`sobrescrib`\|`pisa`) | `README.md`, `kodo-orchestrate/skill.md`, `kodo-capture/SKILL.md`, `src/orchestrator/prompt.md`, `.planning/codebase/*.md` | **0** |
| `preserva` (amplio, control) | `src/` | 108 hits, **todos ajenos** al `next` (color-isolation, byte-preservation, config, worktrees…) |

### 4b. Lo que **ya está correcto** y no debe tocarse

D-01 nombra `:427-430` como «candidatos naturales». **Este research los descarta: ya describen el contrato post-DEBT-01 correctamente.** DEBT-05 es un cambio de **una** línea, no de cinco.

| Ubicación | Estado | Cita |
|-----------|--------|------|
| `src/session/state.js:405-410` | ✅ Correcto | Tabla explícita: `non-empty string → OVERWRITE` / `` `null` (explicit) → CLEAR `` / `field ABSENT/undefined → PRESERVE` |
| `src/session/state.js:425` (`@param entry`) | ✅ Correcto | «Un `next` string sobrescribe, `null` explícito borra (clear), campo AUSENTE preserva el previo (ver la tabla arriba)» |
| `src/session/state.js:427-430` (`@returns`) | ✅ Correcto | Describe `value` como «el entry EFECTIVO persistido (post-asimetría)» — no enuncia semántica vieja |
| `src/session/state.js:449-454` | ✅ Correcto | El merge tres-estados implementado, con su comentario `DEBT-01 three-state merge, discriminated by PRESENCE` |
| `src/session/state.js:61` (`State.tasks`) | ✅ Correcto | Describe el ciclo de vida del campo, no la semántica del `next` |
| `src/hooks/session-end.js:299, 384, 405` | ✅ Correcto | Describen «el writer PRESERVA el previo» en la rama mecánica — es exactamente el contrato vigente |
| `.claude/skills/kodo-orchestrate/skill.md:443-450` | ✅ Correcto | Describe el `NEXT:` como contexto; **no** enuncia la regla de merge. Sin hit. |

### 4c. Deferred producidos por la auditoría

**Ninguno.** No hay hallazgo fuera de `state.js` que exija contexto. La fila «Hallazgos fuera de `state.js` en el grep de auditoría de D-02» del `<deferred>` del CONTEXT **se cierra vacía** — y esa es una afirmación citable, no una omisión.

### 4d. Evidencia citable de DEBT-05 (D-03, cero tests nuevos)

[VERIFIED: `node --test test/state/handoff-state.test.js` → parte de los 106/106 verdes]

| Test | Línea | Contrato que fija |
|------|-------|-------------------|
| `CLEAR: next: null explícito … BORRA el previo` | `test/state/handoff-state.test.js:265` | `null` → borra |
| `PRESERVE: campo next AUSENTE … PRESERVA` | `:288` | ausente → preserva |
| `OVERWRITE: next no vacío … SOBRESCRIBE` | `:307` | string → sobrescribe |

---

## Sonda 5 — NYQ: mecánica de `/gsd-validate-phase` sobre fases archivadas

### 5a. Resolución de directorios archivados: **las 6 resuelven**

[VERIFIED: `gsd-tools query init.phase-op {N}` ejecutado para las 6]

| Fase | `phase_dir` resuelto | `has_verification` | `plan_count` |
|------|----------------------|--------------------|--------------|
| 79 | `.planning/milestones/v0.18-phases/79-sidebar-doctor` | true | 4 |
| 80 | `.planning/milestones/v0.18-phases/80-carril-orquestador-reconciliaci-n-documental` | true | 2 |
| 81 | `.planning/milestones/v0.18-phases/81-saneo-de-deuda-v0-17` | true | 3 |
| 69 | `.planning/milestones/v0.16-phases/69-red-y-autenticaci-n` | true | 4 |
| 71 | `.planning/milestones/v0.16-phases/71-fiabilidad-de-entrega-y-backstop` | true | 5 |
| 72 | `.planning/milestones/v0.16-phases/72-higiene-dx-y-verdad-documental` | true | 5 |

Confirma D-11: la skill opera in-place sobre el directorio archivado.

### 5b. Precondición del §0: el hook Nyquist está ACTIVO

[VERIFIED: `gsd-tools loop render-hooks verify:post --raw`]

```json
{ "capId": "nyquist", "kind": "step", "ref": { "skill": "validate-phase" },
  "when": "workflow.nyquist_validation", "produces": ["VALIDATION.md"], "onError": "halt" }
```

`.planning/config.json` tiene `workflow.nyquist_validation: true`. El §0 **no** aborta con «Nyquist validation is disabled».

### 5c. Qué pasos del workflow escriben tests o re-corren la suite — y cómo suprimirlos (D-12)

[VERIFIED: `$HOME/.claude/gsd-core/workflows/validate-phase.md` leído entero]

| Paso | Qué hace | ¿Peligro para D-12? | Instrucción para el plan |
|------|----------|---------------------|--------------------------|
| §0 Initialize | init + resolución de hooks | No | — |
| §1 Detect Input State | `ls *-VALIDATION.md` | No | **Las 6 son State A** (`VALIDATION.md` existe) → ruta «audit existing» |
| §2 Discovery | lee PLAN/SUMMARY, escanea el filesystem por ficheros de test, cruza requirement↔test **por nombre/imports/descripciones** | No — **no ejecuta nada** | Es exactamente el trabajo citation-based que D-12 quiere |
| §3 Gap Analysis | clasifica COVERED / PARTIAL / MISSING. **«No gaps → skip to Step 6, set `nyquist_compliant: true`»** | No | **Ruta ideal.** El criterio «runs green» de COVERED se satisface **por CITA** a `{N}-VERIFICATION.md`, no re-corriendo |
| §4 Present Gap Plan | `AskUserQuestion` con 3 opciones | Gate interactivo | **Opción 2 «Skip — mark manual-only» → salta a §6.** Este es **el** mecanismo de supresión de D-12. Nunca opción 1 |
| **§5 Spawn `gsd-nyquist-auditor`** | **genera ficheros de test** | **PROHIBIDO por D-12** | **Nunca se alcanza** si §3 no ve gaps o si §4 responde opción 2 |
| §6 Generate/Update VALIDATION.md | State A: actualiza mapa + frontmatter (`status: validated`), añade audit trail | No | Aquí se aplica el molde de D-13 |
| §7 Commit | `git add {test_files}` + `git commit -m "test(phase-N): …"`, luego `gsd_run query commit "docs(phase-N): …"` | **La primera mitad es prohibida** | **Omitir el commit de tests** (no habrá ninguno). Solo el commit `docs(…)` vía `gsd-tools` |
| §8 Results + Routing | render | No | — |

**Conclusión operativa:** ninguna parte del workflow re-ejecuta la suite. El único vector de violación de D-12 es §5, y se cierra por completo en el gate §4. El plan debe hacer explícito: *«en el gate §4 se responde SIEMPRE la opción 2 (skip — manual-only); §5 nunca se invoca; §7 no ejecuta `git add` de tests»*.

> **Consecuencia de planificación:** §4 es un `AskUserQuestion` por invocación ⇒ **6 gates interactivos**. Si `mode: yolo` / auto-chain los atraviesa, el plan debe fijar la respuesta explícitamente en el texto de la tarea para que ningún agente elija la opción 1 por defecto.

### 5d. El molde de D-13 — estructura exacta de `41-VALIDATION.md`

[VERIFIED: fichero leído completo, 89 líneas]

| # | Sección | Detalle a replicar |
|---|---------|--------------------|
| 1 | **Frontmatter** | `phase` · `slug` · `status` · `nyquist_compliant` · `wave_0_complete` · `created`. **41 usa `approved`; D-14 manda `validated`** — y conservar el bloque de comentarios del lifecycle que ya traen 79/80/81 |
| 2 | **Blockquote de cabecera** (3 líneas) | «Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase **85**, NYQ-0**1/2**).» + «Cobertura **citada** de `{N}-VERIFICATION.md` (passed X/Y must-haves) + los N SUMMARY de plan.» + «**Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.» |
| 3 | `## Test Infrastructure` | Tabla con fila extra **`Evidencia citada`** → `` `{N}-VERIFICATION.md` (fecha, status passed, score X/Y) `` |
| 4 | `## Sampling Rate` | 3 bullets: **Evidencia primaria** (VERIFICATION + score) · **Política Nyquist (backfill)** («la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite — D-12») · **UAT humano** (resultado) |
| 5 | `## Per-Task Verification Map (dimensión → cobertura citada)` | Columnas: `Requirement` \| `Plan` \| `Dimensión / Secure Behavior` \| `Test Type` \| `Automated Command` \| **`Evidencia citada (fichero + resultado)`** \| `Status`. Leyenda: `⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only` |
| 6 | `## Wave 0 Requirements` | Prosa: infraestructura nativa suficiente |
| 7 | `## Manual-Only Verifications` | Columnas: `Behavior` \| `Requirement` \| `Why Manual` \| **`Evidencia`** |
| 8 | `## Validation Sign-Off` | 6 checkboxes marcados + línea `**Approval:** validated {fecha} (backfill Phase 85, NYQ-0X)` |
| 9 | `## Reconstruction Audit {fecha} (Phase 85 NYQ-0X)` | Tabla de métricas: `Requirements audited` \| `COVERED (automated unit)` \| `PARTIAL` \| `MISSING` \| `Manual-only (by design)` \| `Tests citados (no re-corridos)`. Cierra con un párrafo **Nota Nyquist** |

Fórmula de cita del segundo precedente (`44-VALIDATION.md:13`), reutilizable literalmente:

> *«Reconstructed retroactively (citation-based) from the existing `{N}-VERIFICATION.md` (passed X/Y) during Phase 85 backfill (NYQ-0X). No suite re-run — coverage is cited from the empirical evidence already on disk.»*

> **Divergencia a resolver por el planner (D-13 manda):** el §6 del workflow prescribe un audit trail titulado `## Validation Audit {date}` con tabla `Gaps found / Resolved / Escalated`. **El molde de 41/44 usa `## Reconstruction Audit {date}` con métricas más ricas.** D-13 es LOCKED ⇒ **prevalece el molde 41**. El plan debe decirlo explícitamente para que el agente no adopte la plantilla genérica del workflow.

---

## Sonda 6 — NYQ: inventario de evidencia citable, fase a fase

[VERIFIED: los 6 `{N}-VALIDATION.md`, los 6 `{N}-VERIFICATION.md` y los 5 `{N}-UAT.md` leídos en esta sesión]

### 6a. Estado de partida de cada `VALIDATION.md` (lo que hay que reconstruir)

| Fase | `status` | `nyquist_compliant` | `wave_0_complete` | Estado del *Per-Task Map* | **Coste de reconstrucción** |
|------|----------|---------------------|-------------------|---------------------------|------------------------------|
| **81** | draft | false | **true** | **6 filas reales** con Requirement/Threat/Command y `File Exists ✅` | **BAJO** — casi solo cambiar frontmatter + añadir citas |
| **80** | draft | false | false | 1 fila real (`80-01-01`, ORCH-07) + nota «a rellenar»; Manual-Only ya tiene 1 fila (ORCH-08) | **MEDIO-BAJO** — falta la fila de 80-02 |
| **71** | draft | false | false | 4 filas con `TBD (planner fills)` pero **requirement, secure behavior y comando ya correctos** (DELIV-01..04); Manual-Only ya tiene 1 fila | **MEDIO** |
| **79** | draft | false | false | **1 fila placeholder** `(se rellena al crear los PLAN.md)` para SDR-01..06; Wave 0 lista 3 ficheros con `[ ]` | **MEDIO-ALTO** — mapa desde cero sobre 4 planes |
| **69** | draft | false | false | **1 fila placeholder** `(a rellenar por el planner)` para NET-01..06; Manual-Only ya tiene 1 fila | **MEDIO-ALTO** — mapa desde cero sobre 4 planes |
| **72** | draft | false | false | **PLANTILLA SIN RELLENAR**: `{pytest 7.x / jest 29.x / vitest / go test / other}`, `{quick command}`, `REQ-{XX}`, `{tests/test_file.py}`, `{framework install}` | **ALTO** — todo desde cero sobre 5 planes y 8 requirements |

> **El riesgo de estimación de esta fase vive aquí.** «6 fases» suena homogéneo; el trabajo real de 72 es ~4× el de 81. El planner debe presupuestarlo así y, si parte NYQ en varias tareas, dar a 72 la suya propia.

### 6b. Evidencia citable por fase (materia prima del backfill)

| Fase | Requirements | `VERIFICATION.md` — score | `behavior_unverified` | `human_verification` | UAT | Riqueza de la cita |
|------|--------------|---------------------------|-----------------------|----------------------|-----|--------------------|
| **79** | SDR-01..06 | `status: passed`, **5/6** must-haves (re-verificación tras gap G-79-1) | **1** (SDR-05: round-trip real vía `kodo sidebar doctor --fix`) | 1 (mismo item) | **4/4 pass** | ALTA — cada truth cita fichero de test: `test/cli/sidebar-doctor-cli.test.js`, `test/sidebar-doctor-hygiene.test.js` (17/17), `test/cmux/sidebar-doctor.test.js` (22/22), `test/manager.test.js`, `test/session/group-resolve.test.js` |
| **80** | ORCH-07, ORCH-08 | `status: passed`, **11/12** | **1** (SC1: convergencia ≤1 pase contra cmux vivo) | — | **1/1 pass** | ALTA — cita líneas exactas: `test/check.test.js:338-355 / 357-369 / 371-395 / 397-426 / 428-439`, `test/check-isolation.test.js:156` (33/33 combinado), `test/cmux/sidebar-doctor.test.js:218` |
| **81** | DEBT-01..04 | `status: passed`, **26/26** | **0** | 1 (la disposición de WR-01/WR-02 — **que es justo lo que la Phase 85 cierra**) | **1/1 pass** | MUY ALTA — 26 truths, cada uno con fichero + resultado; suite citada **2364/2364** |
| **69** | NET-01..06 | `status: passed`, **12/12** | **0** | — (sin `human_verification`) | sin `UAT.md` | MUY ALTA — 12 truths con `test/server-bind.test.js`, `test/server-auth.test.js`, `test/server/auth.test.js` (39 subtests / 122 asserts), `test/server-body-limit.test.js`, `test/server-error-hygiene.test.js`, `test/server-malformed-request.test.js`, `test/logs-reader.test.js`, `test/dashboard-client.test.js`, `test/format-isolation.test.js` |
| **71** | DELIV-01..04 | `status: passed`, **4/4** (re-verificación tras cerrar 2 gaps BLOCKER; el propio informe declara haber corrido los tests) | **0** | **2** (Plane real, GitHub real) | **2 total: 1 pass, 1 skipped** | ALTA — `test/triggers/polling.test.js` (5+5 casos), `test/adopt-cli.test.js` (34/34, E2E `:529-601`), `test/hooks/session-end.test.js:285-321 / 323-346` |
| **72** | HYG-01..08 | `status: passed`, **5/5** (verificado post-review a `2adfebd`) | **0** | 1 (propagación real de `KODO_ORCHESTRATOR=1`) | **1/1 pass** | ALTA — `test/hooks/stop-idempotency.test.js`, `test/skill-auto-commit.test.js` (A/B/C), `test/config-hardening.test.js` (22/22), `test/config.test.js`, `test/config-migration-atomic.test.js`, `test/dashboard-format.test.js`, `test/dashboard-table.test.js`, `test/hooks/session-end.test.js`, + tests por hallazgo (labels, gsd-verification, gsd-roadmap, plane-provider, hooks/install, registry) |

### 6c. Veredicto por fase: ¿`nyquist_compliant: true` es defendible?

| Fase | Veredicto | Justificación | ¿D-17 (`false` con razón)? |
|------|-----------|---------------|----------------------------|
| **81** | ✅ **SÍ** | 26/26, `behavior_unverified: 0`. El caso más limpio. | No |
| **69** | ✅ **SÍ** | 12/12, `behavior_unverified: 0`, sin items de verificación humana. Cada NET-0x mapea a ≥1 fichero de test nombrado. | No |
| **72** | ✅ **SÍ** | 5/5, `behavior_unverified: 0`. El único item humano (propagación de env var por `cmux.send`) es **manual-only por naturaleza**, con modo de fallo seguro documentado. Coste alto ≠ evidencia débil. | No |
| **80** | ✅ **SÍ** | 11/12; el 1 `PRESENT_BEHAVIOR_UNVERIFIED` es un escenario **contra un cmux vivo** → fila **Manual-Only**, no gap de cobertura (el cableado sí está cubierto por A/B/C/D/D2/E). | No |
| **79** | ✅ **SÍ** | 5/6; el 1 `behavior_unverified` (round-trip real de `--fix`) es **manual-only** — el verbo crudo ya se validó en `79-UAT.md` A2 (pass) y el argv exacto está probado con spy. Además ya figura como fila abierta en `STATE.md §Deferred Items` («Evidencia en vivo»). | No |
| **71** | ✅ **SÍ** | 4/4 tras gap closure; los 2 items humanos exigen **Plane/GitHub reales** → manual-only por construcción, y el UAT `skipped: 1` es reconocido explícitamente en `STATE.md` («skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria»). | No |

**Ninguna fase activa D-17.** Las 6 admiten `nyquist_compliant: true` + `status: validated` con manual-only rows citadas. **Precedente que lo autoriza:** `41-VALIDATION.md` es `nyquist_compliant: true` **con** una fila Manual-Only, y `44-VALIDATION.md` igual — el estado COMPLIANT del repo ya convive con manual-only por diseño.

### 6d. `wave_0_complete` (D-14: ante duda, se deja como está)

| Fase | Hoy | Recomendación |
|------|-----|---------------|
| 81 | `true` | Dejar `true` (su Wave 0 está marcado `[x]` con confirmaciones) |
| 79 | `false` | **Dejar `false`** — su lista Wave 0 tiene 3 `[ ]` sin marcar; los ficheros existen hoy pero el campo no es citable sin re-derivar |
| 80, 69, 71, 72 | `false` | **Dejar `false`** — D-14 lo permite explícitamente; el campo que importa es `nyquist_compliant` |

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────── BLOQUE DEBT (código + tests) ────────────────────────┐
│                                                                              │
│  state.json ──► upsertTaskHandoff (src/session/state.js:449-454)             │
│                   │  merge tres-estados por PRESENCIA                        │
│                   │    string  → OVERWRITE                                   │
│                   │    null    → CLEAR                                       │
│                   │    ausente → PRESERVE                                    │
│                   └──► [DEBT-05] typedef :53 describe ESTO ─── doc-only      │
│                            ▲ evidencia: handoff-state.test.js:265/288/307    │
│                                                                              │
│  /status ──► enrich (App.js) ──┬──► deriveAnyNext (select.js:258)            │
│                                │      └─[DEBT-06]─► nextCell(format.js:264)  │
│                                │            colapso /\s+/g + trim (única      │
│                                │            fuente de verdad)                │
│                                └──► nextCell ──► celda de la fila            │
│                                                                              │
│  kodo check ──► runCheck() ──► needsOrchestrator?                            │
│                                   │ sí                                       │
│                                   ▼                                          │
│                  try { scanFn(deps={})  ──► report.hasAdvisories             │
│                        executeFn({fix}) ──► { added, ungrouped, errors }     │
│                        logFn   "Sidebar: N acción(es) aplicadas"             │
│                        logFn   "Sidebar advisories: M (acción de operador)"  │
│                       [DEBT-07/WR-01]                                        │
│                        errorFn "Sidebar: K acción(es) fallida(s) (fail-open)"│
│                      } catch { errorFn "Sidebar doctor error: …" }           │
│                                   │                                          │
│                                   ▼  (fail-open SIEMPRE)                     │
│                              launchOrchestrator()                            │
│                                                                              │
│  GUARD [DEBT-07/WR-03]  walkImports(check.js) ─► 23 ficheros                 │
│                                │ (NO se modifica el walker)                  │
│                                ▼                                             │
│                  stripComments(source) ─► DYNAMIC_LOGGER_IMPORT_RE           │
│                                │                                             │
│                                ├─ hit en logger-events|noop ─► permitido     │
│                                └─ cualquier otro logger*.js ─► ROJO          │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────── BLOQUE NYQ (artefactos, cero código) ────────────────────┐
│                                                                              │
│  /gsd-validate-phase {N}                                                     │
│      §0 hook nyquist ACTIVO ──► §1 State A (VALIDATION.md existe)            │
│      §2 lee PLAN+SUMMARY, cruza requirement↔test (sin ejecutar)              │
│      §3 gap analysis ──► sin gaps ──────────────────┐                        │
│                       └─► con gaps ──► §4 gate ─────┤ opción 2 «skip»        │
│                                          │ opción 1 │                        │
│                                          ▼ PROHIBIDA│                        │
│                                    §5 auditor       │ (genera tests) ✗ D-12  │
│                                                     ▼                        │
│      §6 update VALIDATION.md ── molde 41-VALIDATION.md (D-13)                │
│           status: validated · nyquist_compliant: true (D-14)                 │
│      §7 commit SOLO docs (nunca `git add {test_files}`)                      │
│                                                                              │
│  6 objetivos independientes: 79 · 80 · 81  ─►  69 · 71 · 72   (orden D-16)   │
│  MILESTONE-AUDIT.md archivados ── INTACTOS (D-15)                            │
│  STATE.md §Deferred Items ── 4 filas cerradas vía gsd-tools                  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Fichero | Rol en esta fase | Qué cambia |
|---------|------------------|------------|
| `src/session/state.js` | Fuente de verdad del merge tres-estados | **Solo el comentario de `:53`.** Cero cambio de comportamiento |
| `src/cli/dashboard/select.js` | Capa derive del TUI | Gana su **primer import de runtime** (`{ nextCell } from './format.js'`) y `deriveAnyNext` pasa a `rows.some((r) => nextCell(r).length > 0)` |
| `src/cli/dashboard/format.js` | Capa presentación pura (único import: `node:path`) | **No cambia.** Pasa a ser la fuente única del colapso |
| `src/cli/dashboard/App.js` | Consumidor | **No se toca** (D-05) |
| `src/check.js` | Orquestación del vigilante | Gana **una rama** `if (failed > 0) errorFn(...)` dentro del `try` existente. Gate, orden y fail-open intactos |
| `test/dashboard-select.test.js` | Suite LIVE-05 | +≥2 casos RED en el `describe` de `:471`; los `:473-497` no se tocan |
| `test/check.test.js` | Suite del piggyback | +1 `it()` (Test F) tras el Test E, dentro del `describe` de `:320` |
| `test/check-isolation.test.js` | Guard LOG-12 | Comentarios `:14` y `:33-34` corregidos + **1 `it()` nuevo** con el source-grep. **`walkImports` NO se modifica** |
| `test/format-isolation.test.js` | Guard TUI-04 | **No se toca** (D-18) — aunque contiene el mismo comentario falso (ver Open Question OQ-1) |
| `.planning/milestones/v0.1{6,8}-phases/{69,71,72,79,80,81}/{N}-VALIDATION.md` | Contratos de validación | Reescritos in-place con el molde 41 |
| `.planning/STATE.md` | Registro de deuda | 4 filas de §Deferred Items cerradas — **vía `gsd-tools`, nunca `Write` directo** |

### Pattern 1: Source-hygiene guard sobre las fuentes ya enumeradas

**Qué:** un assert que lee el TEXTO de los ficheros que otro mecanismo (walker, allowlist) ya identificó, para atrapar regresiones invisibles a ese mecanismo.
**Cuándo:** cuando el analizador estructural tiene un punto ciego conocido (aquí: `walkImports` no ve `import()` dinámico).
**Regla no negociable:** filtrar comentarios ANTES de aserverar. Un guard que se pone rojo por un comentario acaba siendo debilitado, y debilitarlo es greenear enmascarando.

### Pattern 2: Delegación intra-directorio sobre módulo puro (frente a duplicación defensiva)

**Qué:** un módulo de *derive* consume el helper del módulo de *presentación* del mismo directorio en vez de duplicar su regla.
**Cuándo aplica (D-04, esta fase):** el módulo destino es puro (`node:path` y nada más), no hay ciclo, y un guard existente cubre por fichero todo el directorio.
**Cuándo NO aplica (D-17 de Phase 84):** el módulo destino arrastra `picocolors` por un camino verificado. **La asimetría es una decisión medida, no un descuido.**

### Pattern 3: Backfill citation-based

**Qué:** la cobertura de un artefacto de validación retroactivo **ES** la cita al resultado empírico ya en disco.
**Cuándo:** fases cerradas con `VERIFICATION.md` + `SUMMARY.md` por plan.
**Precedentes aceptados en este repo:** `41-VALIDATION.md` (Phase 47/NYQ-01) y `44-VALIDATION.md` (Phase 51/NYQ-03). NYQ-01/02 es el **tercer** pase del mismo procedimiento.

### Anti-Patterns to Avoid

- **Extender `walkImports` para seguir `import()` dinámico** en vez de añadir el grep aparte → pone rojos 2 guards existentes. Ver Pitfall 1.
- **Grep de imports sin `stripComments`** → 13 falsos positivos, guard rojo a HEAD sin violación real.
- **Emitir el fallo por-item por `logFn`** → sigue siendo invisible en un pipe; la restricción `errorFn` de D-07 es el punto entero del fix.
- **Tocar los `:473-497` de `test/dashboard-select.test.js`** para «hacer pasar» la delegación → si alguno necesita cambiar, la delegación está mal (D-06).
- **Marcar `nyquist_compliant: true` sin cita concreta** → greenear enmascarando; D-17 existe para el caso honesto.
- **Reescribir los `MILESTONE-AUDIT.md` archivados** → son snapshots históricos (D-15).
- **Aceptar la opción 1 del gate §4 de `validate-phase`** → invoca el auditor generador de tests, violación directa de D-12.
- **Tratar las 6 fases NYQ como trabajo equivalente** → 72 es ~4× 81.

---

## Don't Hand-Roll

| Problema | No construir | Usar en su lugar | Por qué |
|----------|--------------|------------------|---------|
| Filtrar comentarios antes de un assert source-hygiene | Un stripper propio con `//`/`/* */` ad hoc | `stripComments` **verbatim** (9 copias en `test/`, p.ej. `test/skill-sync.test.js:115-121`) | Ya resuelve bloques `/** */`, líneas `//` y continuaciones `*`. Divergir crea una 10ª variante que se comporta distinto |
| Enumerar el grafo de imports de `check.js` | Un walker nuevo en el test de D-09 | La salida de `walkImports` que ya vive en `test/check-isolation.test.js:40-52` | D-09 lo dice literal; además modificar el walker rompe guards vecinos |
| Colapsar whitespace del `next` | `replace(/\s+/g,' ').trim()` inline en `select.js` | `nextCell` (`src/cli/dashboard/format.js:264`) | Es exactamente el punto de DEBT-06: una sola fuente de verdad. Duplicar reintroduce la divergencia que WR-02 denuncia |
| Estructura del `VALIDATION.md` retroactivo | Un formato nuevo, o la plantilla genérica de `templates/VALIDATION.md` | El molde `41-VALIDATION.md` (D-13), con la fórmula de cita de `44-VALIDATION.md:13` | Dos backfills ya aceptados en este repo; `audit-milestone §5.5` sabe leer ese shape |
| Cerrar filas de `STATE.md` | `Write`/`Edit` directo sobre `STATE.md` | `gsd-tools` (Integration Points del CONTEXT lo exige) | `STATE.md` es artefacto gestionado; edición directa desincroniza |
| Fixtures del test de D-08 | Objetos ad hoc | `cleanReport()` / `emptyResult()` de `test/check.test.js:322-337` como base, mutando solo lo necesario | Coherencia con los 6 casos existentes; el revisor ve el delta, no un fixture paralelo |

**Key insight:** en un repo con 110 ficheros de test y guards source-hygiene en cascada, **cada helper nuevo es una divergencia futura**. Las tres piezas que esta fase necesita ya existen y están probadas; el trabajo es cablearlas, no escribirlas.

---

## Runtime State Inventory

> Esta fase no es un rename, pero **sí edita artefactos in-place fuera del árbol de código**. Este inventario evita que el barrido deje estado inconsistente.

| Categoría | Items encontrados | Acción requerida |
|-----------|-------------------|------------------|
| **Datos persistidos** | **Ninguno.** DEBT-05 es doc-only; DEBT-06 es render/derive (el dato de `state.json` sigue VERBATIM — colapso render-only, DEBT-03); DEBT-07 solo añade una línea a stderr. Ningún `state.json`, `inbox.md` ni caché cambia de forma. | Ninguna. Cero migración de datos. |
| **Config de servicios vivos** | **Ninguno.** D-19 cierra `src/server.js`; no hay endpoints, workflows n8n ni config de cmux implicada. | Ninguna. |
| **Estado registrado en el SO** | **Ninguno.** Ni hooks, ni tareas programadas, ni pm2. `src/hooks/**` no se toca. | Ninguna. |
| **Secretos / variables de entorno** | **Ninguno.** | Ninguna. |
| **Artefactos de build / paquetes instalados** | **Ninguno.** Cero deps nuevas, sin build step. La distribución de skills (`kodo skill sync`) no se toca (D-08/D-08b diferidos). | Ninguna. |
| **Artefactos de planificación editados in-place** | **6** `{N}-VALIDATION.md` bajo `.planning/milestones/v0.16-phases/**` y `v0.18-phases/**`. **4 filas** de `.planning/STATE.md` §Deferred Items (líneas 59, 60, 61, 62 a HEAD). **5 checkboxes** de `.planning/REQUIREMENTS.md` (DEBT-05/06/07, NYQ-01/02, hoy `- [ ]`). ROADMAP §Phase 85 «Plans: TBD». | Edición documental; `STATE.md` **vía `gsd-tools`**. Los `MILESTONE-AUDIT.md` de al lado quedan **intactos** (D-15). |
| **Filas Deferred que NO se cierran** | `STATE.md:64` («format-isolation transitivo … candidato natural de la Phase 85») — **D-18 la deja abierta**. | El SUMMARY debe decir explícitamente que se evaluó y se difirió, con el trigger («medir primero el radio»). Si no, el próximo audit la leerá como olvido. |

**La pregunta canónica:** *tras editar todos los ficheros, ¿qué sistema en runtime conserva el estado viejo?* → **Ninguno.** El único riesgo residual es **documental**: una fila de `STATE.md` sin cerrar o una fila cerrada sin que su artefacto lo respalde.

---

## Common Pitfalls

### Pitfall 1 — Extender `walkImports` en vez de añadir un grep aparte (**el más caro**)

**Qué sale mal:** al leer «el guard no ve imports dinámicos», el reflejo es arreglar el walker.
**Por qué pasa:** parece la solución de raíz.
**Qué ocurre realmente** [VERIFIED: clausura dinámica calculada]: siguiendo aristas dinámicas, el grafo de `check.js` pasa de 23 a **29** ficheros, incorporando `src/providers/github/provider.js` y `src/providers/github/normalize.js`. Esos dos ficheros son **exactamente** los que prohíben dos guards vecinos (`test/check-isolation.test.js:113` y `:123`). Un walker «mejorado» los pone **ROJOS** — y la reacción a un rojo espurio es debilitar el assert, que es lo que el constraint anti-greenear prohíbe.
**Cómo evitarlo:** D-09 dice literalmente «un source-grep **sobre los ficheros del grafo que `walkImports` ya calcula**». Se respeta al pie de la letra: `walkImports` no se toca.
**Señal de alarma:** cualquier diff que modifique `walkImports`, `extractImports`, `IMPORT_FROM_RE` o `IMPORT_BARE_RE`.

### Pitfall 2 — Grep de imports sin filtrar comentarios

**Qué sale mal:** el guard sale ROJO a HEAD con 13 hits, cinco de ellos apuntando a `../logger.js`.
**Por qué pasa:** el repo usa masivamente `@param {import('../logger.js').Logger}` en JSDoc — imports de TIPO, borrados en runtime.
**Cómo evitarlo:** `stripComments(...)` primero, siempre. Ver §Code Examples.
**Señal de alarma:** el guard rojo la primera vez que se ejecuta ⇒ **no es LOG-12, es el filtro que falta**. (Y si tras `stripComments` sigue rojo, **entonces sí** es LOG-12 y se escala — pero este research ya verificó que no lo está.)

### Pitfall 3 — Confundir «el guard estático está verde» con «`kodo check` no carga eso en runtime»

**Qué sale mal:** el comentario corregido de D-09 over-claims.
**Por qué pasa:** `src/check.js:103` ejecuta `await initRegistry()`, que dispara `await import('./github/provider.js')`. `kodo check` **sí** carga ese módulo en runtime, con el guard estático verde.
**Cómo evitarlo:** el comentario nuevo debe decir que los guards protegen el grafo de **module-load** (coste de arranque + prohibición de `logger.js`), no la alcanzabilidad en runtime. Dato tranquilizador y citable: ni `github/provider.js` ni `plane/provider.js` alcanzan `logger.js` (8 ficheros cada uno, 0 hits).

### Pitfall 4 — Tocar los casos LIVE-05 existentes para que pase la delegación

**Qué sale mal:** se «ajusta» algún assert de `:473-497` y se pierde la señal.
**Cómo evitarlo:** este research ya verificó que los 8 asserts existentes son **invariantes** bajo la delegación. Si alguno cambia, el fix está mal (D-06).

### Pitfall 5 — Emitir el fallo por-item por el mismo canal que el éxito

**Qué sale mal:** `logFn(...)` para los fallos ⇒ el operador que hace `kodo check 2>/dev/null` o `| grep` sigue sin verlos.
**Cómo evitarlo:** `errorFn`, restricción explícita de D-07. El test de D-08 debe **aserverar la ausencia** en `logs` además de la presencia en `errs`.

### Pitfall 6 — Que `/gsd-validate-phase` genere tests (violación de D-12)

**Qué sale mal:** el §5 spawnea `gsd-nyquist-auditor`, cuyo objetivo declarado incluye *generated test files*, sobre código de tres milestones distintos. La fase «ligera» se convierte en una de generación de tests.
**Cómo evitarlo:** en el gate §4, **opción 2 «Skip — mark manual-only»**, siempre. §7 no ejecuta `git add {test_files}`.
**Señal de alarma:** cualquier fichero nuevo bajo `test/` durante el bloque NYQ, o un commit `test(phase-N): add Nyquist validation tests`.

### Pitfall 7 — Presupuestar las 6 fases NYQ como trabajo idéntico

**Qué sale mal:** el plan da a 72 el mismo tamaño que a 81 y se descubre a mitad de ejecución que 72 parte de la **plantilla literal sin rellenar** sobre 5 planes y 8 requirements.
**Cómo evitarlo:** ver la tabla §6a. Recomendación: 72 en su propia tarea; 79 y 69 en otra; 81/80/71 pueden compartir.

### Pitfall 8 — Adoptar el audit trail genérico del workflow en vez del molde 41

**Qué sale mal:** el §6 del workflow prescribe `## Validation Audit {date}` con `Gaps found/Resolved/Escalated`, que no es lo que D-13 manda.
**Cómo evitarlo:** el plan debe nombrar explícitamente `## Reconstruction Audit {fecha} (Phase 85 NYQ-0X)` con las 6 métricas del molde 41.

### Pitfall 9 — Cerrar la fila de `STATE.md` del `format-isolation` transitivo

**Qué sale mal:** la fila `STATE.md:64` dice literalmente «candidato natural de la Phase 85». Un agente diligente la cerrará.
**Cómo evitarlo:** **D-18 la deja ABIERTA.** El SUMMARY debe declarar que se evaluó y se difirió, con su trigger.

---

## Code Examples

### Guard de D-09 — forma prescrita (verificada GREEN a HEAD)

```js
// test/check-isolation.test.js — añadir dentro del describe('LOG-12: vigilante isolation (import-graph)')

// stripComments verbatim de test/dispatcher-isolation.test.js:24-30 — filtra
// comentarios para asserts source-hygiene sobre código (no documentación).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

// Regex CONSTANTE (anti-ReDoS): jamás compilada desde input externo.
const DYNAMIC_LOGGER_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]*logger[^'"]*\.js)['"]/g;
const LOGGER_ALLOWLIST_RE = /logger-events\.js$|logger-noop\.js$/;

it('ningún fichero del grafo de check.js carga logger.js por import() DINÁMICO (WR-03)', () => {
  // El walker NO sigue import() dinámico (a propósito: seguirlo pondría rojos los
  // guards de github/provider.js y github/normalize.js, que SÍ están en la clausura
  // dinámica vía registry.js). Este grep cubre ese punto ciego sobre la MISMA lista.
  const graph = walkImports(join(SRC, 'check.js'));
  const violations = [];
  for (const file of graph) {
    const stripped = stripComments(readFileSync(file, 'utf-8'));
    for (const m of stripped.matchAll(DYNAMIC_LOGGER_IMPORT_RE)) {
      if (LOGGER_ALLOWLIST_RE.test(m[1])) continue; // logger-events / logger-noop: permitidos
      violations.push(`${relative(REPO, file)} → import('${m[1]}')`);
    }
  }
  assert.deepEqual(
    violations,
    [],
    `Un import() DINÁMICO de logger.js rompe LOG-12 sin que el walker estático lo vea:\n  ${violations.join('\n  ')}`,
  );
});
```

**Comentario que sustituye a la premisa falsa** (`test/check-isolation.test.js:14` y `:33-34`):

```js
// El walker sigue SOLO imports estáticos. El repo SÍ usa import() dinámico
// (src/providers/registry.js:27,28,57,58 y src/session/state.js:247), así que la
// afirmación original («el repo no lo usa, verificado en 06-RESEARCH A3») era falsa.
// El punto ciego lo cubre el guard de source-grep de más abajo (Phase 85 / DEBT-07 WR-03).
// Alcance de estos guards: el grafo de MODULE-LOAD de `kodo check` — coste de arranque y
// prohibición de logger.js. NO son una afirmación sobre alcanzabilidad en runtime:
// check.js:103 llama initRegistry(), que carga providers/{plane,github}/provider.js con
// await import(). Verificado (Phase 85): ninguno de esos dos alcanza logger.js.
```

### Delegación de D-06

```js
// src/cli/dashboard/select.js — primer import de runtime del módulo.
// format.js es PURO (único import: node:path, :25) y está cubierto por el mismo
// guard TUI-04 (test/format-isolation.test.js) que este fichero. Sin ciclo:
// format.js no importa select.js.
import { nextCell } from './format.js';

// …

export function deriveAnyNext(rows) {
  // DEBT-06: la presencia de la columna se decide con la MISMA regla que la pinta
  // (colapso /\s+/g + trim en nextCell) — un `next` de solo-whitespace ya no
  // enciende una columna que se renderiza vacía. nextCell es never-throws para
  // no-string, así que el contrato de D-05 (flag estructural sobre el set SIN
  // filtrar) queda intacto.
  return rows.some((r) => nextCell(r).length > 0);
}
```

### Casos RED de D-06

```js
// test/dashboard-select.test.js — dentro del describe('LIVE-05 …') existente (:471)

it('DEBT-06: un next de solo-whitespace NO enciende la columna (coherente con nextCell)', () => {
  // RED antes del fix: hoy `'   '.length > 0` → true, mientras nextCell devuelve ''.
  assert.equal(deriveAnyNext([{ next: '   ' }]), false);
  assert.equal(deriveAnyNext([{ next: '\n\t' }]), false);
  assert.equal(deriveAnyNext([{ next: ' \r\n ' }]), false);
  // Y una fila con contenido real sigue encendiéndola aunque otra sea whitespace.
  assert.equal(deriveAnyNext([{ next: '   ' }, { next: 'algo' }]), true);
});
```

### Fix de D-07 en `src/check.js`

```js
const r = await executeFn(deps, { fix: true });
const applied = (r.added || 0) + (r.ungrouped || 0);
logFn(`[kodo:check] Sidebar: ${applied} acción(es) aplicadas`);
// WR-01 (80-REVIEW): con deps={} el logger es el noopLogger obligado por LOG-12, así
// que un `addToWorkspaceGroup` fallido no deja rastro en NINGÚN canal. La línea sale
// por errorFn (stderr) y NO por logFn: un fallo escrito en el mismo canal que el éxito
// sigue siendo invisible en un pipe. Informa; jamás bloquea el check ni el launch, y
// jamás re-entra a `reasons` ni al gate needsOrchestrator (D-04 de Phase 80).
const failed = (r.errors || []).length;
if (failed > 0) {
  errorFn(`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`);
}
```

### Cabecera de un `VALIDATION.md` de backfill (molde 41 + D-14)

```markdown
---
phase: 80
slug: carril-orquestador-reconciliaci-n-documental
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---

# Phase 80 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-01).
> Cobertura **citada** de `80-VERIFICATION.md` (2026-07-23, status passed, score 11/12 must-haves) + los 2 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado (D-12).
```

---

## State of the Art

| Enfoque anterior | Enfoque vigente | Cuándo cambió | Impacto en esta fase |
|------------------|-----------------|---------------|----------------------|
| `next` mergeado por truthiness (`entry.next ?? prev.next ?? null`) — `null` y `undefined` colapsaban | Contrato tres-estados discriminado por **PRESENCIA** del campo | Phase 81 / DEBT-01 (`src/session/state.js:449-454`) | **Es la causa de DEBT-05**: el typedef `:53` sigue describiendo el mundo anterior |
| `missing_group` como acción auto-ejecutable (`create` + `set-anchor`) | `missing_group` es **advisory report-only**; `execute()` jamás emite `create`/`set-anchor` | Phase 79, gap closure G-79-1 | El test de D-08 debe usar `missing_group` como advisory, nunca esperar acciones de él |
| `status: approved` en `VALIDATION.md` | `status: validated` (lifecycle `draft → validated`), con `audit-milestone §5.5` distinguiendo NOT-VALIDATED / PARTIAL | posterior a los backfills de v0.10/v0.11 | **D-14**: usar `validated`, no el `approved` de 41/44 |
| Guards de aislamiento solo estructurales (walker de imports) | Guards estructurales **+ source-hygiene grep** sobre las mismas fuentes | Phase 84 (`test/skill-sync.test.js`) | Es el molde exacto de D-09 |

**Obsoleto / desfasado (no usar como referencia):**

- `.planning/codebase/TESTING.md` — congelado en 2026-04-07: describe **2** ficheros de test cuando la suite real tiene **110** ficheros y **2586** tests. Vale para el framework (`node:test` + `node:assert/strict`, DI, `beforeEach`/cleanup); **no vale como inventario**. No se refresca aquí (D-20).
- El comentario «el repo no lo usa (verificado en 06-RESEARCH A3)» — falso desde que `registry.js` y `state.js` introdujeron `await import()`.

---

## Project Constraints (from CLAUDE.md y skills del proyecto)

No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en la raíz del repo. Aplican las directivas globales de `~/.claude/CLAUDE.md`:

| Directiva | Cómo afecta al plan |
|-----------|---------------------|
| **Regla 3 — Cambios quirúrgicos** | «Toca solo lo que debas. No mejores código adyacente, comentarios ni formato.» Alineado con D-01/D-18/D-19/D-20. En particular: **no reformatear** los ficheros de test al añadir el `it()` nuevo |
| **Regla 2 — Simplicidad primero** | Refuerza la elección de copiar `stripComments` verbatim antes que extraer un helper compartido |
| **Regla 1 — Piensa antes de codificar** | El probe de WR-03 es exactamente esto: la premisa se verificó antes de escribir el assert |
| **Responde siempre en español** | La prosa de PLAN/SUMMARY/VALIDATION en español; código, paths e identificadores verbatim |
| **`bin/rails test` directo, no piped** | Análogo aquí: `node --test …` directo, sin `| cat` |

**Skills del proyecto** (`.claude/skills/`): `kodo-capture`, `kodo-orchestrate`, `worktree-cleanup`. Son skills de **producto** (superficie del operador), no reglas de desarrollo. **Ninguna se toca en esta fase**: `kodo-orchestrate/skill.md` está fenced por los diferidos D-08/D-08b de Phase 84, y el grep de D-02 confirmó que su §NEXT: (`:443-450`) no enuncia la semántica vieja.

**Convenciones vinculantes** (`.planning/codebase/CONVENTIONS.md`): `// @ts-check` + JSDoc en todo export · kebab-case en ficheros · imports con extensión `.js` explícita · sin barrel files · prefijos `[kodo:*]` en salida de CLI · orden de imports (builtins → externos → relativos).

---

## Assumptions Log

| # | Claim | Sección | Riesgo si es falso |
|---|-------|---------|--------------------|
| A1 | La partición de planes DEBT-05+06 / DEBT-07 / NYQ es la mejor; los tres son paralelizables | §Summary | Bajo — el CONTEXT declara la partición explícitamente como discreción del planner |
| A2 | El copy `[kodo:check] Sidebar: N acción(es) fallida(s) (fail-open)` es aceptable | §Sonda 3a | Nulo — es el snippet literal de 80-REVIEW y D-07 deja el copy a discreción (solo fija `errorFn`) |
| A3 | Añadir el caso `' \r\n '` a los RED de D-06 es deseable | §Sonda 2e | Nulo — es un caso extra; D-06 solo exige `'   '` y `'\n\t'` |
| A4 | 72 cuesta ~4× lo que 81 en el bloque NYQ | §Sonda 6a | Medio — la *dirección* está verificada (72 es plantilla sin rellenar, 81 tiene 6 filas reales); el multiplicador es una estimación |
| A5 | Responder «opción 2» en el gate §4 basta para suprimir §5 en las 6 invocaciones | §Sonda 5c | Bajo — el workflow lo dice literal («Skip — mark manual-only → add to Manual-Only, Step 6»); no ejecutado end-to-end en esta sesión |
| A6 | Las 6 fases llegarán a §3 con al menos algún gap (y por tanto pasarán por el gate §4) | §Sonda 5c | Nulo en cualquier dirección — si §3 no ve gaps, salta a §6 con `nyquist_compliant: true`, que es el resultado deseado igualmente |

Todo lo demás en este documento está tagueado `[VERIFIED]` contra sondas ejecutadas en esta sesión.

---

## Open Questions

### OQ-1 — El mismo comentario falso vive también en `test/format-isolation.test.js:14` y `:33` — ¿se corrige?

- **Qué sabemos** [VERIFIED: `grep -rn "06-RESEARCH A3" test/`]: la frase aparece en exactamente **4** sitios: `check-isolation.test.js:14`, `:33` (los que D-09 nombra) y `format-isolation.test.js:14`, `:33` (copias verbatim).
- **Qué no está claro:** D-09 solo cita `check-isolation`. D-18 dice de `format-isolation.test.js` «**No se modifica**», pero su razón declarada es el *guard transitivo*, no un comentario.
- **Recomendación (conservadora, D-18 es LOCKED):** **no tocarlo.** Registrarlo en el `deferred-items.md` de la fase con path y líneas exactas, junto al item de format-isolation transitivo que ya está diferido — se corregirán juntos cuando ese guard se aborde. Corregir solo el comentario dejaría el fichero con un guard que sigue sin cubrir el caso que su comentario ya no niega, que es peor que la situación actual.
- **Estado: ABIERTA** — decisión de una línea para el planner.

### OQ-2 — ¿El backfill escribe `## Reconstruction Audit` (molde 41) o `## Validation Audit` (workflow §6)?

- **Resuelta por D-13:** el molde de 41 es LOCKED ⇒ `## Reconstruction Audit {fecha} (Phase 85 NYQ-0X)` con las 6 métricas (`Requirements audited` / `COVERED` / `PARTIAL` / `MISSING` / `Manual-only` / `Tests citados (no re-corridos)`). El plan debe decirlo explícitamente para que el agente no adopte la plantilla genérica.
- **Estado: RESUELTA.**

### OQ-3 — ¿Se activa D-17 en alguna de las 6 fases NYQ?

- **Resuelta por la §Sonda 6c:** **no.** Las 6 tienen `status: passed` en su `VERIFICATION.md` con evidencia por-truth mapeada a ficheros de test nombrados; los `behavior_unverified` de 79 y 80 y los `human_verification` de 71/72/81 son manual-only por naturaleza (cmux vivo, Plane/GitHub reales, propagación de env var por shell), con precedente aceptado (`41-VALIDATION.md` es `nyquist_compliant: true` **con** fila Manual-Only).
- **Estado: RESUELTA.**

### OQ-4 — ¿El guard reforzado de WR-03 sale rojo a HEAD (⇒ escalado LOG-12)?

- **Resuelta por la §Sonda 1:** **NO. Sale VERDE.** Con `stripComments` el único hit es `src/session/state.js → import('../logger-events.js')`, en la allowlist explícita de D-09. Verificado además sobre la clausura completa estática+dinámica (29 ficheros): `src/logger.js` no es alcanzable por ningún camino. **No hay hallazgo LOG-12 que escalar.**
- **Estado: RESUELTA.**

### OQ-5 — ¿La delegación de D-04 introduce dependencia o ciclo?

- **Resuelta por la §Sonda 2:** **no.** Coste transitivo = `node:path` y nada más; sin ciclo (`format.js` no importa `select.js`); `App.js` ya importa ambos; ningún leaf-guard cubre `select.js`; `startup-budget.test.js` es `it.skip` y mide `kodo check`, no el TUI.
- **Estado: RESUELTA.**

---

## Environment Availability

| Dependencia | Requerida por | Disponible | Versión | Fallback |
|-------------|---------------|------------|---------|----------|
| Node.js (runner `node --test`) | Toda la suite | ✓ | la del repo (ejecutado con éxito en esta sesión: 106/106) | — |
| `gsd-tools.cjs` | `init.phase-op`, `commit`, cierre de filas de `STATE.md` | ✓ | `$HOME/.claude/gsd-core/bin/gsd-tools.cjs` | — |
| Skill `/gsd-validate-phase` | NYQ-01/02 (D-11) | ✓ | `$HOME/.claude/skills/gsd-validate-phase/SKILL.md` + `workflows/validate-phase.md` | — |
| Hook `verify:post` → `nyquist` | Precondición del §0 de `validate-phase` | ✓ | activo (`workflow.nyquist_validation: true`) | — |
| Directorios archivados de las 6 fases | NYQ-01/02 | ✓ | las 6 resuelven con `has_verification: true` | — |
| `git` | Commits atómicos | ✓ | — | — |
| cmux vivo / Plane / GitHub reales | **NO requeridos** | — | — | La fase no ejercita ningún carril externo; todo es DI/stub o documental |

**Dependencias ausentes sin fallback:** ninguna.
**Dependencias ausentes con fallback:** ninguna.

---

## Validation Architecture

### Test Framework

| Propiedad | Valor |
|-----------|-------|
| Framework | `node:test` (runner nativo) + `node:assert/strict` |
| Fichero de config | ninguno — convención del repo `test/**/*.test.js` |
| Quick run command | `node --test test/dashboard-select.test.js test/check.test.js test/check-isolation.test.js` |
| Full suite command | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| Runtime estimado | ~1 s (quick) · ~120 s (full, 2586 tests) |
| Baseline a HEAD | **2586 tests · 2585 pass · 0 fail · 1 skipped** (`84-VERIFICATION.md:94`); ficheros tocados: **106/106 pass** (medido en esta sesión) |

### Phase Requirements → Test Map

| Req ID | Comportamiento | Tipo de test | Comando automatizado | ¿Fichero existe? |
|--------|----------------|--------------|----------------------|------------------|
| **DEBT-05** | El typedef enuncia el contrato tres-estados | **CITATION** — cero tests nuevos (D-03) | `node --test test/state/handoff-state.test.js` (cita a `:265` CLEAR, `:288` PRESERVE, `:307` OVERWRITE) | ✅ existe |
| **DEBT-05** (backstop) | El cambio es doc-only: la suite queda verde sin tocar ningún test | regression | `npm test` | ✅ |
| **DEBT-06** | `deriveAnyNext` con `next` solo-whitespace → `false` (RED antes del fix) | **unit NUEVO** | `node --test test/dashboard-select.test.js` | ✅ existe — se extiende in-place (`describe` de `:471`) |
| **DEBT-06** (no-regresión) | Los 8 asserts LIVE-05 existentes siguen verdes **sin tocarlos** | unit existente | `node --test test/dashboard-select.test.js` | ✅ |
| **DEBT-06** (aislamiento) | El import nuevo no rompe la color-isolation del TUI | guard existente | `node --test test/format-isolation.test.js` | ✅ — **no se modifica** (D-18) |
| **DEBT-07 / WR-01** | Con `errors` no vacío sale una línea por `errorFn` y **no** por `logFn` | **unit NUEVO** (mismo `it()` que WR-02) | `node --test test/check.test.js` | ✅ existe — se extiende (`describe` de `:320`) |
| **DEBT-07 / WR-02** | `applied = added + ungrouped` (no `created`) y la rama de advisories se ejercitan y se aseveran | **unit NUEVO** | `node --test test/check.test.js` | ✅ |
| **DEBT-07 / WR-03 (a)** | El comentario deja de afirmar la premisa falsa | **manual-only** — un comentario no es testeable; evidencia = diff + cita a `registry.js:27,28,57,58` y `state.js:247` | inspección en el SUMMARY | N/A |
| **DEBT-07 / WR-03 (b)** | Un `import('…logger.js')` dinámico en el grafo de `check.js` pone rojo el guard | **unit NUEVO (guard)** | `node --test test/check-isolation.test.js` | ✅ existe — se extiende; **`walkImports` NO se modifica** |
| **DEBT-07 / WR-03 (mordida)** | El guard tiene mordida real | **manual/verificación** — insertar temporalmente `await import('../logger.js')` en un fichero del grafo, comprobar ROJO, revertir | `node --test test/check-isolation.test.js` | ✅ |
| **NYQ-01** | 79/80/81 con `nyquist_compliant: true` citation-based | **CITATION** — cero tests nuevos (D-12) | `grep -c "nyquist_compliant: true" .planning/milestones/v0.18-phases/{79,80,81}*/*-VALIDATION.md` | ✅ los 3 `VALIDATION.md` existen |
| **NYQ-02** | 69/71/72 con `nyquist_compliant: true` citation-based | **CITATION** — cero tests nuevos (D-12) | `grep -c "nyquist_compliant: true" .planning/milestones/v0.16-phases/{69,71,72}*/*-VALIDATION.md` | ✅ los 3 existen |

**Resumen del reparto (crítico para el planner):**

- **Cobertura automatizada NUEVA:** solo **DEBT-06** y **DEBT-07** (3 `it()` nuevos en 3 ficheros existentes: `dashboard-select`, `check`, `check-isolation`).
- **Cobertura por CITA a evidencia existente:** **DEBT-05** (D-03), **NYQ-01**, **NYQ-02** (D-12). Cero ficheros de test nuevos, cero re-ejecución de suite para el backfill.
- **Manual-only:** la corrección del comentario de WR-03(a) y la verificación de mordida del guard de WR-03(b).

### Sampling Rate

- **Por commit de tarea:** el fichero de test tocado — `node --test test/dashboard-select.test.js` · `node --test test/check.test.js` · `node --test test/check-isolation.test.js`
- **Por merge de wave:** `npm test` — debe seguir en **2586 · 2585 pass · 0 fail · 1 skipped**; cualquier delta de `fail` bloquea
- **Gate de fase:** suite completa verde antes de `/gsd-verify-work`
- **Latencia máxima de feedback:** ~1 s (quick) / ~120 s (full)
- **Para el bloque NYQ:** **ninguna ejecución de suite** — la política de muestreo es la cita a la evidencia ya en disco (D-12)

### Wave 0 Gaps

**Ninguno.** Los tres ficheros que crecen existen y traen ya los helpers necesarios:

- `test/dashboard-select.test.js` — importa `deriveAnyNext`, `applyFilter`, `parseFilter` (`:26`); el `describe` LIVE-05 está en `:471`
- `test/check.test.js` — trae `cleanReport()` / `emptyResult()` y las 6 DI (`:320-440`)
- `test/check-isolation.test.js` — trae `walkImports` / `extractImports`; `stripComments` se copia verbatim del precedente

Framework: `node:test` es builtin, sin instalación. **Cero tareas de Wave 0.**

---

## Security Domain

### Applicable ASVS Categories

| Categoría ASVS | ¿Aplica? | Control estándar |
|----------------|----------|------------------|
| V2 Authentication | no | La fase no toca `src/server.js` ni el carril de auth (D-19) |
| V3 Session Management | no | Sin sesiones HTTP implicadas |
| V4 Access Control | no | Sin cambio de superficie |
| **V5 Input Validation** | **sí** | La regex del guard de D-09 es **constante de módulo**, jamás compilada desde input externo (constraint anti-ReDoS LOCKED). Opera sobre fuentes del propio repo, no sobre entrada del operador. `deriveAnyNext` sigue never-throws para cualquier shape (`nextCell` guarda con `typeof !== 'string'`) |
| V6 Cryptography | no | Sin criptografía implicada |
| **V7 Error Handling & Logging** | **sí** | DEBT-07/WR-01 **mejora** la postura: un fallo silencioso pasa a ser observable. Restricción: la línea nueva emite un **conteo**, nunca `err.message` ni `target` — no filtra refs de workspace ni rutas del operador a stderr. LOG-12 intacto: no se inyecta el logger real |

### Known Threat Patterns

| Patrón | STRIDE | Mitigación estándar |
|--------|--------|---------------------|
| ReDoS por regex compilada desde input | Denial of Service | Regex **CONSTANTE de módulo**; el guard de D-09 nunca construye un patrón dinámico |
| Fuga de información en logs de error | Information Disclosure | La línea de D-07 emite `${failed}` (un entero), **no** `r.errors[i].reason` ni `.target` |
| Guard de seguridad debilitado para «pasar» | Repudiation / erosión de control | Constraint anti-greenear heredado de DEBT-04. Este research verificó **antes** que el guard sale verde, eliminando la presión de debilitarlo |
| Aserción de compliance sin evidencia | Repudiation | D-17 + molde 41 (`Evidencia citada` obligatoria por fila). §Sonda 6c verifica que las 6 fases tienen evidencia real |
| Regresión silenciosa de LOG-12 vía `import()` dinámico | Tampering | **Es exactamente lo que D-09 cierra.** Verificado GREEN a HEAD sobre 23 y 29 ficheros |

**Nota:** la fase no introduce superficie de ataque nueva. Su efecto neto sobre la postura de seguridad es **positivo**: cierra un punto ciego de un guard de aislamiento y convierte un fallo silencioso en observable.

---

## Sources

### Primary (HIGH confidence) — sondas ejecutadas sobre este repo en esta sesión

- Réplica de `walkImports`/`extractImports` de `test/check-isolation.test.js` → grafo estático de `src/check.js` (23 ficheros) y clausura estática+dinámica (29 ficheros); enumeración de imports dinámicos reales; evaluación de la regex candidata con y sin `stripComments`
- Ejecución comparada de `deriveAnyNext` (HEAD) vs. `rows.some((r) => nextCell(r).length > 0)` sobre 9 casos, importando los módulos reales
- `node --test` sobre `test/dashboard-select.test.js`, `test/check.test.js`, `test/check-isolation.test.js`, `test/format-isolation.test.js`, `test/state/handoff-state.test.js` → 106/106 pass
- `gsd-tools query init.phase-op {85,79,80,81,69,71,72}` → resolución de directorios archivados
- `gsd-tools loop render-hooks verify:post --raw` → hook `nyquist` activo
- Greps de auditoría D-02 sobre `src/`, `README.md`, `.claude/skills/`, `.planning/codebase/`, `src/orchestrator/prompt.md`
- Grep de cobertura de las 3 líneas literales del piggyback sobre `test/` y `src/`
- Grep de `stripComments` sobre `test/` (9 copias verbatim) y de `06-RESEARCH A3` (4 ocurrencias)

### Primary (HIGH confidence) — ficheros leídos íntegros o en las regiones citadas

- `src/check.js:1-60, 130-175` · `src/session/state.js:40-70, 236-262, 405-470` · `src/cli/dashboard/select.js:1-40, 235-275` · `src/cli/dashboard/format.js:1-30, 245-275` · `src/providers/registry.js:1-70` · `src/cmux/sidebar-doctor.js:326-341`
- `test/check-isolation.test.js` (completo) · `test/check.test.js:300-445` · `test/dashboard-select.test.js:460-500` · `test/format-isolation.test.js:1-60, 180-221` · `test/skill-sync.test.js:105-135, 640-660` · `test/startup-budget.test.js` (cabecera) · `test/helpers/startup-baseline.js`
- `.planning/phases/85-…/85-CONTEXT.md` (completo) · `.planning/REQUIREMENTS.md` §DEBT/§NYQ · `.planning/ROADMAP.md` §Phase 85 · `.planning/STATE.md` §Deferred Items · `.planning/config.json` · `.planning/codebase/CONVENTIONS.md`
- `.planning/milestones/v0.18-phases/80-…/80-REVIEW.md:55-150` (§Warnings + §Info completos)
- Los 6 `{N}-VALIDATION.md` y los 6 `{N}-VERIFICATION.md` de 79/80/81/69/71/72 · los 5 `{N}-UAT.md` disponibles
- `.planning/milestones/v0.10-phases/41-…/41-VALIDATION.md` (completo) · `.planning/milestones/v0.11-phases/44-…/44-VALIDATION.md` (estructura)
- `.planning/phases/84-…/deferred-items.md`
- `$HOME/.claude/gsd-core/workflows/validate-phase.md` (completo) · `$HOME/.claude/skills/gsd-validate-phase/SKILL.md` · `$HOME/.claude/gsd-core/templates/VALIDATION.md`

### Secondary (MEDIUM confidence)

- Ninguna. No se consultó ninguna fuente externa.

### Tertiary (LOW confidence)

- Ninguna. **Cero búsquedas web y cero fetches de documentación externa**: la fase es un barrido interno sin dependencias nuevas, y todas las preguntas del CONTEXT se responden con sondas sobre este repo.

---

## Metadata

**Desglose de confianza:**

- **Standard stack:** HIGH — cero deps nuevas; los builtins y helpers implicados están verificados en disco y ejecutados
- **Arquitectura / topología de imports:** HIGH — grafos calculados, no inferidos; ciclos y coste transitivo verificados
- **Pitfalls:** HIGH — los 3 más caros (walker, `stripComments`, canal `errorFn`) proceden de sondas ejecutadas, no de intuición
- **Mecánica de `validate-phase`:** HIGH para el workflow (leído íntegro) · MEDIUM para el comportamiento end-to-end del gate §4 en 6 invocaciones consecutivas (no ejecutado — ver A5)
- **Inventario de evidencia NYQ:** HIGH — 6 `VERIFICATION.md` + 6 `VALIDATION.md` + 5 `UAT.md` leídos, con números concretos
- **Estimación relativa de coste NYQ:** MEDIUM — la dirección está verificada; el multiplicador es estimación (ver A4)

**Research date:** 2026-07-27
**Valid until:** ~30 días, o hasta el primer commit que toque `src/check.js`, `src/providers/registry.js`, `src/cli/dashboard/{select,format}.js` o cualquier `test/*-isolation.test.js` — las sondas de grafo y de delegación habría que re-ejecutarlas.

---

*Phase: 85 — Saneo de deuda + Nyquist retroactivo*
