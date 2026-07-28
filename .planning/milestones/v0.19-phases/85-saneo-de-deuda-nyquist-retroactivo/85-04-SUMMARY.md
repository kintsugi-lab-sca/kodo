---
phase: 85-saneo-de-deuda-nyquist-retroactivo
plan: 04
subsystem: planning
tags: [nyquist, backfill, validation-contract, citation-based, audit-milestone, v0.16, documentacion]

# Dependency graph
requires:
  - phase: 69-red-y-autenticaci-n
    provides: "`69-VERIFICATION.md` (passed 12/12, `behavior_unverified: 0`, §Human Verification Required «None») y los 4 SUMMARY de plan — la evidencia citada"
  - phase: 71-fiabilidad-de-entrega-y-backstop
    provides: "`71-VERIFICATION.md` (passed 4/4 tras cerrar 2 gaps BLOCKER, `gaps_remaining: []`), `71-UAT.md` (1 pass / 1 skipped) y los 5 SUMMARY de plan"
  - phase: 72-higiene-dx-y-verdad-documental
    provides: "`72-VERIFICATION.md` (passed 5/5 a HEAD `2adfebd` post review-fix), `72-UAT.md` (1/1 pass), `72-SECURITY.md` (15/15 threats closed) y los 5 SUMMARY de plan"
  - phase: 85-03
    provides: "El molde de `41-VALIDATION.md` ya instanciado tres veces (79/80/81) — convención de celda de evidencia y reformulación del checkbox de sign-off"
provides:
  - "Los tres `VALIDATION.md` de v0.16 (69, 71, 72) en `status: validated` + flag Nyquist en **true**, legibles por `audit-milestone §5.5` como COMPLIANT en vez de NOT-VALIDATED"
  - "Per-Task Verification Map con la columna «Evidencia citada (fichero + resultado)» poblada en las 23 filas de las tres fases"
  - "Los 5 items no automatizables de v0.16 contabilizados como Manual-Only con su razón y su evidencia — incluido el único que NO está cumplido (GitHub real), declarado como skip y no como verde"
affects: [audit-milestone, NYQ-02, cierre de la columna Nyquist de v0.16, plan 85-05 (bookkeeping de STATE)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Backfill citation-based: la cobertura ES la cita a la evidencia empírica ya en disco (fichero + sección + conteo), nunca una re-derivación"
    - "Requirement de ausencia: cuando el entregable es un borrado (HYG-02/HYG-03), la fila se declara guard de ausencia (superficie real del CLI + grep sobre el módulo), no se disfraza de unit test"

key-files:
  created: []
  modified:
    - .planning/milestones/v0.16-phases/69-red-y-autenticaci-n/69-VALIDATION.md
    - .planning/milestones/v0.16-phases/71-fiabilidad-de-entrega-y-backstop/71-VALIDATION.md
    - .planning/milestones/v0.16-phases/72-higiene-dx-y-verdad-documental/72-VALIDATION.md

key-decisions:
  - "D-12 respetado de forma literal: cero ficheros de test creados y cero ejecuciones de `npm test` o `node --test` atribuibles a este plan. El §5 del workflow (auditor generador de tests) nunca se alcanzó — §3 no vio gaps y el gate §4 se responde con la opción 2 («Skip — mark manual-only»)"
  - "D-13 prevalece sobre la plantilla genérica del workflow: `## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-02)` con 6 métricas, no `## Validation Audit` con la tabla Gaps found/Resolved/Escalated"
  - "D-17 aplicado leyendo cada `VERIFICATION.md` por separado: las tres admiten **true** honestamente porque cada fila verde tiene cita concreta, y los 5 items sin evidencia automatizable se declararon manual-only en vez de forzarse"
  - "Los dos comentarios de lifecycle que 79/80/81 traen NO se añadieron a 69/71/72 (`grep -c '^# status lifecycle:'` = 0 en las tres): son ficheros anteriores a esa convención y homogeneizarlos reescribiría su historia sin beneficio para el consumidor"
  - "`wave_0_complete` se conservó en `false` en las tres, tal y como llegaba (D-14: ante duda no se re-deriva un flag de proceso ya cerrado)"
  - "Evidencia adversa citada tal cual, sin redondear: el `skipped: 1` del UAT de 71 y el fallo del flake pre-existente `gsd-lock-race` en la corrida de suite completa de 72 (2025 pass / 1 fail / 1 skip)"

patterns-established:
  - "Cuando un requirement es de ausencia (feature borrada), la celda «Automated Command» es el guard real —`node src/cli.js up --help`, `grep` sobre el módulo— y la fila lo declara como tal; presentarlo como unit test sería una cita falsa"
  - "Un ítem humano NO cumplido se contabiliza en Manual-Only con `result: skipped` textual, su fecha de reconocimiento y su cobertura compensatoria citada — nunca se dobla a pass para que la fila quede verde"

requirements: [NYQ-02]

metrics:
  duration_min: 31
  tasks: 3
  files_created: 0
  files_modified: 3
  completed: 2026-07-27

status: complete
---

# Phase 85 Plan 04: Backfill Nyquist de v0.16 (69/71/72) Summary

Los tres `VALIDATION.md` de v0.16 pasan de `draft` / flag Nyquist en `false` a `validated` / flag en **true**, **citation-based**: las 23 filas de sus Per-Task Verification Maps citan fichero de evidencia, sección y conteo, sin generar un solo test ni re-ejecutar la suite. El caso duro —`72-VALIDATION.md`, que seguía siendo la plantilla literal del seed— deja de serlo por completo (`grep -c '{'` → **0**). Con esto NYQ-02 queda saldado y la columna Nyquist de v0.16 lista para cerrarse en `STATE.md`.

## What Was Built

**Nada de código.** Tres ficheros Markdown reescritos in-place en su directorio archivado bajo `.planning/milestones/v0.16-phases/`, con el molde de `41-VALIDATION.md` (D-13) en el orden que fijó el plan 85-03: frontmatter · blockquote de cabecera de 3 líneas · `## Test Infrastructure` con la fila `Evidencia citada` · `## Sampling Rate` · `## Per-Task Verification Map (dimensión → cobertura citada)` de 7 columnas · `## Wave 0 Requirements` · `## Manual-Only Verifications` · `## Validation Sign-Off` · `## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-02)` con sus 6 métricas y su párrafo **Nota Nyquist**.

| Fase | Requirements | Filas del mapa | Manual-Only | Veredicto | Evidencia primaria citada |
|------|--------------|----------------|-------------|-----------|---------------------------|
| **69** | NET-01..06 | 9 (todas verdes) | 2 (LAN física, Plane real) | `validated` + **true** | `69-VERIFICATION.md` passed **12/12**, `behavior_unverified: 0`, «No gaps»; **122 pass / 0 fail** en la suite de 11 ficheros, sobre suite **1843** |
| **71** | DELIV-01..04 | 6 (todas verdes) | 2 (Plane real **pass**, GitHub real **skipped**) | `validated` + **true** | `71-VERIFICATION.md` passed **4/4** tras cerrar 2 gaps BLOCKER, `gaps_remaining: []`; **130 tests / 0 fallos** fase-scoped y **34/34** en `adopt-cli`, sobre suite **1914** |
| **72** | HYG-01..08 | 8 (6 unit + 2 guards de ausencia) | 1 (`KODO_ORCHESTRATOR`, **cumplido**) | `validated` + **true** | `72-VERIFICATION.md` passed **5/5** a HEAD `2adfebd` post review-fix; **92 pass / 0 fail** en spot-checks nominales (22+67+3), sobre suite **2027 (2025 pass / 1 fail flake / 1 skip)** |

**Reconstrucción por fase:**

- **69** (el más rico del bloque, coste MEDIO-ALTO): el mapa se escribió desde cero sustituyendo la única fila placeholder. Sus 12 truths permiten 9 dimensiones sin ninguna celda floja — NET-02 se desglosa en tres (default-deny en el pipeline, primitivas puras de auth, y los dos dashboards) y NET-04 en dos (cuerpos neutros y resistencia a request targets malformados por socket TCP crudo). El tercer bullet de `## Sampling Rate` declara explícitamente que la fase **no tiene UAT** y que su `VERIFICATION` dice «Human Verification Required: None», en vez de omitirlo o rellenarlo.
- **71** (coste MEDIO): las 4 filas del seed llevaban requirement, secure behavior y comando ya correctos; el trabajo fue la columna de evidencia. Se desdoblaron DELIV-03 y DELIV-04 en dos filas cada uno para separar el mecanismo de su **alcanzabilidad** —que es exactamente donde estaban los dos gaps BLOCKER que la re-verificación cerró—.
- **72** (coste ALTO, ~4× el resto, como anticipaba RESEARCH §6a): partía de la plantilla literal, con marcadores de framework, comando, requirement y fichero de test. Se sustituyó entera. La tercera columna del mapa se nutrió además de `72-SECURITY.md`, que asigna threat ID y disposición a cada requirement (T-72-01..14 + T-72-SC, 15/15 closed) — eso convirtió la columna *Dimensión / Secure Behavior* en algo verificable en vez de una paráfrasis del requirement.

## Deviations from Plan

Ninguna en el sentido de las Reglas 1-4: cero auto-fixes de código, cero bugs, cero decisiones arquitectónicas. Cuatro precisiones de ejecución, todas dentro de lo que el plan autoriza:

**1. Corrección de una ruta de test mal citada en la evidencia de 72.** El `72-VERIFICATION.md` §Code Review Findings cita `config-set-raw.test.js` para WR-05, pero el fichero vive en `test/cli/config-set-raw.test.js` (con prefijo `cli/`); citarlo sin el prefijo apunta a un fichero inexistente. Se citó la ruta real. Misma clase de hallazgo que las dos referencias muertas que 85-03 encontró en 79/80 — con la diferencia de que aquí el error estaba en el `VERIFICATION`, no en el seed del `VALIDATION`. **El artefacto archivado NO se corrigió** (D-15): la corrección vive en el `VALIDATION.md` nuevo.

**2. Comando de DELIV-03 (71) ampliado, porque el del seed no cubría el gap real.** El seed citaba `node --test test/adopt.test.js`. Ese fichero cubre el **mecanismo** de idempotencia (`:206`), pero el gap BLOCKER que 71-04 cerró era la **alcanzabilidad desde el CLI**, cuya prueba E2E vive en `test/adopt-cli.test.js:529-601`. Citar solo el primero habría dejado el hallazgo más caro de la fase sin evidencia. Se citan ambos, en filas separadas y con su rol explícito.

**3. Filas de ausencia en 72 (HYG-02/HYG-03) declaradas como guards, no como unit tests.** No existe ni `test/cli-up.test.js` ni `test/session-health.test.js`: el `72-VERIFICATION.md` verifica ambos requirements por la superficie real (`node src/cli.js up --help` sin `--url`, `dashboard --help` con ella) y por grep sobre `src/session/health.js` (0 matches). Inventar un comando `node --test` para esas dos filas habría sido exactamente el `true` sin cita que el threat model T-85-04-01 prohíbe. Se declaran como lo que son. Ambos guards se comprobaron vigentes a HEAD (grep → 0; `up --help` → solo `-h, --help`) — dos invocaciones de comprobación de existencia, **no** ejecuciones de suite.

**4. Evidencia adversa citada sin redondeo.** Dos puntos donde el camino cómodo era escribir «suite verde»: (a) el `71-UAT.md` tiene `skipped: 1` —GitHub real—, declarado como skip con su fecha de reconocimiento (2026-07-09) y su cobertura compensatoria, con nota explícita de que **esta fase no cierra** la fila de `STATE.md`; (b) la corrida de suite completa citada por `72-VERIFICATION.md` es **2025 pass / 1 fail / 1 skip**, con el fail siendo el flake pre-existente `gsd-lock-race` (4/4 en aislamiento). Ambos aparecen tal cual en su `VALIDATION.md`.

## Threat Flags

Ninguno. El plan no toca código, no abre superficie de red ni de proceso y no instala nada. Los cuatro vectores mitigables del threat model están comprobados: T-85-04-01 (**true** sin evidencia) — cada fila verde cita fichero + sección + conteo, con 17/14/15 referencias a su `VERIFICATION.md` respectivo; T-85-04-02 (tampering de la suite) — cero ficheros nuevos bajo `test/`; T-85-04-03 (reescritura de archivados) — `git diff --exit-code` sale 0 sobre `v0.16-MILESTONE-AUDIT.md`, `71-UAT.md`, `72-UAT.md` y `72-SECURITY.md`; T-85-04-04 (skip maquillado) — el skip de 71 aparece 8 veces en el fichero y en ningún sitio como pass.

## D-12 — declaración explícita

**Cero ejecuciones de `npm test` atribuibles a este plan.** No se ejecutó la suite ni ningún `node --test` durante las tres tareas: todos los conteos que aparecen en los tres `VALIDATION.md` están **citados** de su `{N}-VERIFICATION.md`, no medidos aquí. Las únicas invocaciones de shell no-git fueron comprobaciones de existencia de rutas (`test -f` sobre los 32 ficheros de test citados) y dos guards de ausencia de 72 (`grep` sobre `src/session/health.js` y `node src/cli.js up --help`) — ninguna es una corrida de suite. Comprobado tras cada tarea:

- `git status --porcelain test/ | grep -c '^??'` → **0** (cero ficheros de test nuevos)
- `git log --oneline -10 | grep -c 'test(phase-'` → **0** (ningún commit con prefijo de test)
- El §5 del workflow (auditor generador de tests) **nunca se alcanzó**: §3 no encontró gaps y el gate §4 se responde con la **opción 2 — «Skip — mark manual-only»**, según el §Protocolo de invocación vinculante del plan.
- Los `MILESTONE-AUDIT.md` archivados de v0.16 quedan **intactos** (D-15); el cierre se registra en la cabecera de cada `VALIDATION.md`.
- Las tres vallas de alcance del bloque (`test/format-isolation.test.js`, `src/gsd/lock.js`, `.planning/codebase/TESTING.md`) siguen sin modificar: `git status --porcelain` sobre las tres → **0 líneas**.

## Verification

Los 33 criterios de aceptación de las tres tareas pasan. Resultados agregados:

| Comprobación | 69 | 71 | 72 |
|---|---|---|---|
| Flag Nyquist en **true** (frontmatter, 1 sola vez) | 1 | 1 | 1 |
| `status: validated` / `status: approved` | 1 / 0 | 1 / 0 | 1 / 0 |
| `^# status lifecycle:` (NO se añade) | 0 | 0 | 0 |
| `git diff \| grep -c '^-created:'` | 0 | 0 | 0 |
| `wave_0_complete: false` | 1 | 1 | 1 |
| `Reconstruction Audit` / `Validation Audit` | 1 / 0 | 1 / 0 | 1 / 0 |
| `{N}-VERIFICATION.md` citado | 17 | 14 | 15 |
| Filas del mapa (una por requirement, mínimo) | 9 (NET-01..06) | 6 (DELIV-01..04) | 8 (HYG-01..08) |
| Placeholders (`a rellenar` / `por el planner` / `TBD`) | 0 | 0 | — |
| Marcadores de plantilla (`pytest`, `jest`, `REQ-{`, `tests/test_file`, `{`) | — | — | 0 / 0 / 0 / 0 / **0** |
| `node:test` declarado | ✓ | ✓ | 2 |

- Los tres bloques `<automated>` del plan devuelven `NYQ-02/69 OK`, `NYQ-02/71 OK` y `NYQ-02/72 OK`.
- **Cierre de NYQ-02:** `grep -l 'nyquist_compliant: true'` sobre los tres ficheros → **3**.
- Los 32 ficheros de test citados en las tres fases se comprobaron existentes en disco; el único desajuste (`config-set-raw`) se corrigió en la cita, no en el archivado.
- Ninguna fila con `Status` verde tiene la celda de evidencia vacía ni con prosa sin `.md` ni conteo detrás.

## Commits

| Task | Commit | Fichero |
|------|--------|---------|
| 1 (85-04-01) | `4418515` | `69-VALIDATION.md` |
| 2 (85-04-02) | `264904b` | `71-VALIDATION.md` |
| 3 (85-04-03) | `43f0386` | `72-VALIDATION.md` |

## Notes for Next Phase

Para el plan **85-05** (bookkeeping de `STATE.md` §Deferred Items), lo que este plan deja listo y lo que deja explícitamente abierto:

- **Cerrable:** la fila de «Nyquist draft» correspondiente a **69/71/72** — las tres fases tienen ya `status: validated` y el flag en **true** con cita por dimensión. Sumada a la de 79/80/81 que dejó 85-03, la columna Nyquist de v0.16 y v0.18 queda saldada.
- **NO cerrada por este plan (y anotada como tal dentro del propio `71-VALIDATION.md`):** la fila del **backstop de GitHub real** («nunca cierra issues») sigue abierta. El `71-UAT.md` lo tiene en `skipped`, reconocido por el operador el 2026-07-09 con el mock de 3 capacidades como cobertura compensatoria. El backfill solo lo deja correctamente contabilizado; convertirlo en cerrado exige el UAT contra un repo GitHub real.
- **Dos observaciones de higiene documental** que este plan detectó pero **no** actuó (fuera de su alcance, D-15): (a) `71-VERIFICATION.md` tiene `status: passed` en frontmatter y «Status: human_needed» en el cuerpo —divergencia benigna, se escribió con el UAT pendiente y `71-UAT.md` cerró el ciclo el 2026-07-09; queda reconciliada en la prosa del `VALIDATION`—; (b) `72-VERIFICATION.md` cita `config-set-raw.test.js` sin su prefijo `test/cli/`. Ninguna requiere acción en 85-05 salvo que se quiera abrir una fila nueva.
- El molde queda instanciado **seis** veces (79/80/81 por 85-03, 69/71/72 por este plan). Si aparece un séptimo backfill, la referencia más completa es `72-VALIDATION.md`: es la única que combina las tres fuentes (`VERIFICATION` + `UAT` + `SECURITY`) y la única con filas de requirement-de-ausencia.

## Self-Check: PASSED

Los 4 ficheros declarados existen en disco (3 `VALIDATION.md` modificados + este SUMMARY) y los 3 commits de tarea (`4418515`, `264904b`, `43f0386`) están en el historial.
