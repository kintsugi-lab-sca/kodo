---
phase: 85-saneo-de-deuda-nyquist-retroactivo
plan: 03
subsystem: planning
tags: [nyquist, backfill, validation-contract, citation-based, audit-milestone, v0.18, documentacion]

# Dependency graph
requires:
  - phase: 79-sidebar-doctor
    provides: "`79-VERIFICATION.md` (passed 5/6, gaps_remaining vacío), `79-UAT.md` (4/4 pass) y los 4 SUMMARY de plan — la evidencia citada"
  - phase: 80-carril-orquestador-reconciliacion-documental
    provides: "`80-VERIFICATION.md` (passed 11/12, con rangos de línea exactos de `test/check.test.js`), `80-UAT.md` (1/1 pass) y los 2 SUMMARY de plan"
  - phase: 81-saneo-de-deuda-v0-17
    provides: "`81-VERIFICATION.md` (passed 26/26, `behavior_unverified: 0`), `81-UAT.md` (1/1 pass) y los 3 SUMMARY de plan"
  - phase: 47
    provides: "`41-VALIDATION.md` — el molde del backfill Nyquist aceptado (D-13)"
provides:
  - "Los tres `VALIDATION.md` de v0.18 (79, 80, 81) en `status: validated` + `nyquist_compliant: true`, legibles por `audit-milestone §5.5` como COMPLIANT en vez de NOT-VALIDATED"
  - "Per-Task Verification Map con columna «Evidencia citada (fichero + resultado)» poblada en las 20 filas de las tres fases — cada una con fichero, sección y conteo"
  - "Los 4 items no automatizables de v0.18 contabilizados como Manual-Only con su razón y su evidencia, en vez de como huecos de cobertura"
affects: [audit-milestone, NYQ-01, cierre de v0.18, plan 85-04 (bloque NYQ-02 de v0.16), plan 85-05 (bookkeeping de STATE)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backfill citation-based: la cobertura ES la cita a la evidencia empírica ya en disco (fichero + sección + conteo), nunca una re-derivación"

key-files:
  created: []
  modified:
    - .planning/milestones/v0.18-phases/81-saneo-de-deuda-v0-17/81-VALIDATION.md
    - .planning/milestones/v0.18-phases/80-carril-orquestador-reconciliaci-n-documental/80-VALIDATION.md
    - .planning/milestones/v0.18-phases/79-sidebar-doctor/79-VALIDATION.md

key-decisions:
  - "D-12 respetado de forma literal: cero ficheros de test creados y cero ejecuciones de `npm test` atribuibles a este plan. El §5 del workflow (spawn del auditor generador de tests) nunca se alcanzó porque el §3 no vio gaps y el gate §4 se respondió con la opción 2 («Skip — mark manual-only»)"
  - "D-13 prevalece sobre la plantilla genérica del workflow: `## Reconstruction Audit {fecha} (Phase 85 NYQ-01)` con 6 métricas, no `## Validation Audit` con la tabla Gaps found/Resolved/Escalated"
  - "D-17 aplicado como comprobación real, no como trámite: el veredicto de cada fase se decidió leyendo su propio `VERIFICATION.md`; las tres admiten `true` honestamente porque cada dimensión verde tiene cita, y los items sin evidencia automatizable se declararon manual-only en vez de forzarse"
  - "El checkbox de sign-off se reformuló a «`nyquist_compliant` fijado a **true** en el frontmatter» para que el criterio de aceptación `grep -c 'nyquist_compliant: true'` = 1 siga distinguiendo el frontmatter de la prosa"
  - "`wave_0_complete` se conservó como llegaba en las tres (81 en `true` con sus dos confirmaciones marcadas; 79 y 80 en `false`) — D-14: ante duda no se re-deriva"

patterns-established:
  - "Convención de celda de evidencia: `{N}-VERIFICATION.md` + sección citada + conteo en negrita `**X pass / 0 fail**` + el `Truth #N ✓ VERIFIED` correspondiente. Una fila verde sin fichero:sección detrás es un `true` sin respaldo"
  - "Un `behavior_unverified` del VERIFICATION no es un hueco de sampling: va a Manual-Only con su razón y su evidencia parcial (precedente `41-VALIDATION.md`, nyquist-compliant CON fila manual-only)"

requirements: [NYQ-01]

metrics:
  duration_min: 24
  tasks: 3
  files_created: 0
  files_modified: 3
  completed: 2026-07-27

status: complete
---

# Phase 85 Plan 03: Backfill Nyquist de v0.18 (79/80/81) Summary

Los tres `VALIDATION.md` de v0.18 pasan de `draft` / `nyquist_compliant: false` a `validated` / `nyquist_compliant: true` **citation-based**: cada una de las 20 filas de sus Per-Task Verification Maps cita un fichero de evidencia concreto con su sección y su conteo, sin generar un solo test ni re-ejecutar la suite. NYQ-01 queda saldado y `audit-milestone §5.5` lee ahora las tres fases como COMPLIANT en vez de NOT-VALIDATED.

## What Was Built

**Nada de código.** Tres ficheros Markdown reescritos in-place en su directorio archivado, con el molde de `41-VALIDATION.md` (D-13): blockquote de cabecera de 3 líneas declarando el backfill, fila `Evidencia citada` en Test Infrastructure, `Sampling Rate` con la política de backfill explícita, Per-Task Verification Map de 7 columnas con la columna «Evidencia citada (fichero + resultado)», `Wave 0 Requirements`, `Manual-Only Verifications`, `Validation Sign-Off` con los 6 checkboxes marcados y `## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-01)` con sus 6 métricas y su párrafo **Nota Nyquist**.

| Fase | Requirements | Filas del mapa | Veredicto | Evidencia primaria citada |
|------|--------------|----------------|-----------|---------------------------|
| **81** | DEBT-01..04 | 6 (4 verdes, 1 manual-only, 1 guard verde) | `validated` + `true` | `81-VERIFICATION.md` passed **26/26**, `behavior_unverified: 0`; **135 pass / 0 fail** citados (24 handoff-state + 53 session-end + 58 dashboard-format) sobre suite **2364** |
| **80** | ORCH-07, ORCH-08 | 7 (6 verdes, 1 manual-only) | `validated` + `true` | `80-VERIFICATION.md` passed **11/12**; **33 pass / 0 fail** (`check.test.js` + `check-isolation.test.js`) con rangos de línea exactos, sobre suite **2355** |
| **79** | SDR-01..06 | 7 (6 verdes, 1 manual-only) | `validated` + `true` | `79-VERIFICATION.md` passed **5/6**, `gaps_remaining: []`; **54 pass / 0 fail** (17+22+15) más los golden, sobre suite **2348** |

**Reconstrucción por fase:**

- **81** (el caso más barato): las 6 filas ya existían con Requirement/Threat/Command; el delta fue completar la columna de evidencia y reordenarlas al esquema del molde. Se añadió el gate humano de WR-01/WR-02 a Manual-Only anotando que la propia Phase 85 los cerró (85-01 y 85-02).
- **80**: faltaba entera la fila de `80-02` (ORCH-08) y la única existente (`80-01-01`) era un esqueleto con guiones. Se reconstruyeron 6 dimensiones de ORCH-07 reproduciendo los rangos de línea exactos que su `VERIFICATION.md` mapea (`test/check.test.js:338-355 / 357-369 / 371-395 / 397-426 / 428-439`, `test/check-isolation.test.js:156`, `test/cmux/sidebar-doctor.test.js:218`) más la fila de ORCH-08 con su grep contractual 8/8 + 5/5.
- **79** (el más caro): el mapa se escribió desde cero sobre 4 planes y SDR-01..06, sustituyendo la única fila placeholder. Se añadió una séptima fila para el cierre del gap **G-79-1** (`execute()` ya no emite `create`/`set-anchor`), que es el invariante de seguridad de la fase.

## Deviations from Plan

Ninguna en el sentido de las Reglas 1-4: cero auto-fixes, cero bugs encontrados, cero decisiones arquitectónicas. Tres precisiones de ejecución, todas dentro de lo que el plan autoriza explícitamente:

**1. Reformulación del checkbox de sign-off (criterio de aceptación vs molde 41).** El molde de `41-VALIDATION.md` cierra con `- [x] \`nyquist_compliant: true\` set in frontmatter`. Copiarlo literalmente habría puesto `grep -c 'nyquist_compliant: true'` en **2**, incumpliendo el criterio de aceptación de las tres tareas (que exige `1`). El checkbox se reformuló a «`nyquist_compliant` fijado a **true** en el frontmatter», que dice lo mismo sin duplicar el token que el criterio usa para distinguir frontmatter de prosa.

**2. Corrección de dos comandos de test inexistentes.** El `80-VALIDATION.md` seeded citaba `test/check-piggyback.test.js` y el `79-VALIDATION.md` un glob `test/sidebar-doctor*.test.js` que solo alcanza uno de los tres ficheros reales. Ambos se sustituyeron por los paths que la evidencia citada nombra (`test/check.test.js` + `test/check-isolation.test.js`; y los tres ficheros de 79). Un contrato de validación que apunta a un fichero que no existe no es citable.

**3. Evidencia de UAT más fuerte de la que el plan anticipaba, en 79 y 80.** El plan preveía citar el `behavior_unverified` de SDR-05 con «evidencia parcial: verbo crudo validado en `79-UAT.md` A2». Al leer el fichero apareció además el **test 4 con `result: pass`**: el operador ejercitó el round-trip completo vía el binario kodo con deriva real el 2026-07-23, después de que se escribiera el `VERIFICATION.md`. Lo mismo en 80, cuyo `UAT.md` marca la convergencia como pass. Ambas se citaron tal cual **sin** cerrar la fila «Evidencia en vivo» de `STATE.md`, que sigue abierta y explícitamente anotada como no cerrada por esta fase — el bookkeeping de `STATE.md` es del plan 85-05.

## Threat Flags

Ninguno. El plan no toca código, no abre superficie de red ni de proceso, y no instala nada. Los dos vectores del threat model (T-85-03-01 `true` sin evidencia, T-85-03-02 reescritura de snapshots archivados) están mitigados y comprobados: cada fila verde cita fichero + sección + conteo, y `git diff --exit-code .planning/milestones/v0.18-MILESTONE-AUDIT.md` sale 0 tras las tres tareas.

## D-12 — declaración explícita

**Cero ejecuciones de `npm test` atribuibles a este plan.** No se ejecutó la suite ni ningún `node --test` durante las tres tareas: todos los conteos que aparecen en los tres `VALIDATION.md` están **citados** de `{N}-VERIFICATION.md`, no medidos aquí. Comprobado tras cada tarea:

- `git status --porcelain test/ | grep -c '^??'` → **0** (cero ficheros de test nuevos)
- `git log --oneline -10 | grep -c 'test(phase-'` → **0** (ningún commit con prefijo de test)
- El §5 del workflow (spawn del auditor que genera tests) **nunca se alcanzó**: el §3 no encontró gaps de cobertura y el gate §4 se respondió con la **opción 2 — «Skip — mark manual-only»**, tal y como el §Protocolo de invocación del plan fija de forma vinculante.
- Los `MILESTONE-AUDIT.md` archivados de v0.18 quedan **intactos** (D-15): el cierre se registra en la cabecera de cada `VALIDATION.md`.

## Verification

Los 30 criterios de aceptación de las tres tareas pasan. Resultados agregados:

| Comprobación | 81 | 80 | 79 |
|---|---|---|---|
| `nyquist_compliant: true` | 1 | 1 | 1 |
| `status: validated` / `status: approved` | 1 / 0 | 1 / 0 | 1 / 0 |
| `^# status lifecycle:` / `^# audit-milestone` | 1 / 1 | 1 / 1 | 1 / 1 |
| `git diff \| grep -c '^-created:'` | 0 | 0 | 0 |
| `wave_0_complete` | `true` (1) | `false` (1) | `false` (1) |
| `Reconstruction Audit` / `Validation Audit` | 1 / 0 | 1 / 0 | 1 / 0 |
| `{N}-VERIFICATION.md` citado | 13 | 14 | 14 |
| Placeholders (`a rellenar` / `se rellena` / `TBD`) | 0 | 0 | 0 |

- Los tres bloques `<automated>` del plan devuelven `NYQ-01/81 OK`, `NYQ-01/80 OK` y `NYQ-01/79 OK`.
- `grep -l 'nyquist_compliant: true' .planning/milestones/v0.18-phases/{79,80,81}-…-VALIDATION.md | wc -l` → **3**.
- Ninguna fila del Per-Task Verification Map con `Status` verde tiene la celda de evidencia vacía ni con prosa sin `.md` ni conteo.

## Commits

| Task | Commit | Fichero |
|------|--------|---------|
| 1 (85-03-01) | `64de09b` | `81-VALIDATION.md` |
| 2 (85-03-02) | `3eec586` | `80-VALIDATION.md` |
| 3 (85-03-03) | `adabb94` | `79-VALIDATION.md` |

## Notes for Next Phase

- **El molde queda fijado e instanciado tres veces** para el plan **85-04** (bloque NYQ-02: fases 69/71/72 de v0.16). Diferencias que 85-04 encontrará: esas tres **no** traen los dos comentarios de lifecycle en el frontmatter (no se les añaden), la 72 trae la tabla de Test Infrastructure como plantilla sin rellenar, y sus `plan_count` son 4/5/5.
- **El plan 85-05 hereda dos filas de `STATE.md` §Deferred Items**: la de «Nyquist draft … 79/80/81» pasa a cerrable, y la de «Evidencia en vivo» (79/SDR-05 + 80/ORCH-07) **sigue abierta** — este plan la dejó explícitamente anotada como no cerrada en los dos `VALIDATION.md`.
- El gate humano de **WR-01/WR-02** de 81 quedó anotado en su Manual-Only como cerrado por 85-01 y 85-02; si 85-05 lo refleja en `STATE.md`, la anotación ya es coherente.

## Self-Check: PASSED

Los 4 ficheros declarados existen en disco (3 `VALIDATION.md` modificados + este SUMMARY) y los 3 commits de tarea (`64de09b`, `3eec586`, `adabb94`) están en el historial.
