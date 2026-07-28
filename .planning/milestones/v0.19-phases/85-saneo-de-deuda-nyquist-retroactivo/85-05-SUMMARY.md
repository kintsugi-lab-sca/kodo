---
phase: 85-saneo-de-deuda-nyquist-retroactivo
plan: 05
subsystem: planning
tags: [bookkeeping, deferred-items, state-md, requirements, contabilidad, cierre-de-fase]

# Dependency graph
requires:
  - phase: 85-01
    provides: "DEBT-05/06 cerrados (commits `b9624e1`/`8cc703c`/`ba69110`) y la auditoría D-02 con su resultado — la evidencia que respalda el cierre de la fila Doc/consistencia"
  - phase: 85-02
    provides: "DEBT-07 con los 3 warnings RESUELTOS (commits `60458a4`/`c50d5b0`/`4abacbc`) y el flag explícito de IN-01 como diferido (D-10)"
  - phase: 85-03
    provides: "NYQ-01 — 79/80/81 en `validated` + `nyquist_compliant: true`, y la anotación de que la fila «Evidencia en vivo» NO se cierra"
  - phase: 85-04
    provides: "NYQ-02 — 69/71/72 en `validated` + flag en true, y la anotación de que la fila del backstop GitHub real NO se cierra"
provides:
  - "`85/deferred-items.md`: la deuda adyacente que la fase decidió no tocar, con razón y trigger por ítem — 6 filas, ninguna con la celda Trigger vacía"
  - "4 filas de `STATE.md` §Deferred Items cerradas, cada una nombrando el requisito que la salda y el plan (con commits) que lo hizo"
  - "3 filas de `STATE.md` anotadas como ABIERTAS con la distinción explícita entre «contabilizada» y «resuelta»"
  - "El par format-isolation transitivo + OQ-1 enlazado en los dos sentidos (STATE.md ↔ deferred-items.md) para que se corrijan a la vez"

affects: [audit-milestone, cierre de v0.19, proxima fase de higiene de tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bookkeeping simétrico: una fila cerrada nombra su requisito + su plan + sus commits; una fila abierta nombra su razón + su trigger + el fichero donde vive el registro"
    - "Distinción «contabilizada» vs «resuelta» escrita en la propia fila, para que el siguiente audit no confunda mejor evidencia con cierre"

key-files:
  created:
    - .planning/phases/85-saneo-de-deuda-nyquist-retroactivo/deferred-items.md
  modified:
    - .planning/STATE.md

key-decisions:
  - "El §Deferred Items de `STATE.md` es una sección CURADA del propio SDK (`state-transition.cjs:1284`, `rebuildCore` la preserva verbatim) y NO existe handler capaz de direccionar sus filas de 4 columnas — verificado empíricamente con `state.patch` y `state.update` sobre una copia. La mutación se hizo con `Edit` sobre esa sección, y `state.validate` confirma `valid: true` sin drift"
  - "Ninguna fila se cerró sin artefacto que la respalde: las 4 cerradas citan requisito + plan + commits del SUMMARY correspondiente"
  - "La fila del format-isolation transitivo NO se cierra pese a que su propio texto invitaba a hacerlo («candidato natural de la Phase 85») — D-18; el texto se reescribe para decir «evaluado y DIFERIDO», que es la verdad, en vez de borrarlo o cerrarlo"
  - "OQ-1 se registra JUNTO al format-isolation transitivo con el MISMO trigger: corregir solo el comentario dejaría un guard que sigue sin cubrir el caso que su comentario ya no niega"
  - "Se añadió una 6.ª fila no prescrita por el plan: la higiene documental de dos `VERIFICATION.md` archivados que `85-04` detectó y no actuó — sin registro se habría perdido en el SUMMARY de un plan"

patterns-established:
  - "Una fila de deuda cerrada sin cita del artefacto que la respalda es el mismo fallo que un `nyquist_compliant: true` sin cita; la simetría se hace explícita en la prosa del registro"
  - "Cuando el criterio de una fase invita a cerrar deuda adyacente, el registro escribe «evaluado y diferido» con su razón — ni se cierra por diligencia ni se borra la invitación"

requirements: [DEBT-05, DEBT-06, DEBT-07, NYQ-01, NYQ-02]

metrics:
  duration_min: 9
  tasks: 2
  files_created: 1
  files_modified: 1
  completed: 2026-07-27

status: complete
---

# Phase 85 Plan 05: Contabilidad de cierre de la fase Summary

La Phase 85 cierra exactamente lo que saldó y **ni una fila más**: 4 filas de `STATE.md` §Deferred Items cerradas con requisito, plan y commits; 3 filas que la fase tocó pero no resolvió quedan ABIERTAS con la distinción «contabilizada ≠ resuelta» escrita en la propia celda; y la deuda adyacente que se decidió no tocar queda registrada en el único fichero nuevo de todo el barrido, con trigger real en las 6 filas.

## What Was Built

**Cero código, cero tests, cero deps.** Un Markdown nuevo y una sección curada de `STATE.md` reescrita.

### Task 1 — `deferred-items.md` de la fase (commit `72f57ef`)

`.planning/phases/85-saneo-de-deuda-nyquist-retroactivo/deferred-items.md`, con el molde de `84/deferred-items.md`: cabecera de dos frases declarando que un ítem sin trigger es una intención y no un diferido, tabla de 4 columnas `Ítem | Qué se difiere | Por qué no aquí | Trigger`, nota intermedia y sección final «Ajenos por construcción».

| # | Ítem | Trigger |
|---|---|---|
| 1 | **`format-isolation` transitivo (D-18)** | Medir primero el radio de ficheros de `src/cli/dashboard/**` que se pondrían rojos, fuera de una fase mecánica. Anota que el patrón de source-grep de `85-02` **deliberadamente no se aplicó aquí** |
| 2 | **OQ-1** — comentario de premisa falsa duplicado en `test/format-isolation.test.js:14` y `:33` | **El mismo que la fila 1** — se corrigen juntos, y así se declara explícitamente |
| 3 | **`IN-01` de 80-REVIEW (D-10)** | Que el conteo de advisories se contradiga con lo aplicado en un caso real |
| 4 | **Refresco de `.planning/codebase/TESTING.md` (D-20)** | Próximo `/gsd-map-codebase` o `/gsd-docs-update`, o la apertura de v0.20 |
| 5 | **Hallazgos del grep D-02 fuera de `state.js`** | **Cerrada VACÍA y verificada** — ninguno pendiente |
| 6 | **Higiene documental de dos `VERIFICATION.md` archivados** (hallazgo de `85-04`) | Una relectura de v0.16 que necesite el `VERIFICATION` como fuente primaria |

**Ninguna celda de la columna `Trigger` queda vacía**: 6 filas, 6 triggers.

### Task 2 — cierre de `STATE.md` y confirmación de requisitos (commit `5d09884`)

**Cerradas (4), cada una con requisito + plan + commits:**

| Fila de §Deferred Items | Saldada por | Plan | Commits citados |
|---|---|---|---|
| **Doc/consistencia** — 81-REVIEW WR-01 (typedef stale) · WR-02 (`deriveAnyNext` sin colapso) | **DEBT-05 + DEBT-06** — **R-81-02 saldada** | `85-01` | `b9624e1` · `8cc703c` · `ba69110` |
| **Observabilidad** — 3 warnings de 80-REVIEW | **DEBT-07** — los 3 **RESUELTOS**, ninguno re-aceptado; `IN-01` diferido por ser *info* (D-10) | `85-02` | `60458a4` · `c50d5b0` · `4abacbc` |
| **Nyquist** — draft de 79/80/81 | **NYQ-01** — 20 filas citadas, 4 Manual-Only | `85-03` | `64de09b` · `3eec586` · `adabb94` |
| **Nyquist** — draft de 69/71/72 | **NYQ-02** — 23 filas citadas, 5 Manual-Only | `85-04` | `4418515` · `264904b` · `43f0386` |

**Abiertas y anotadas (3) — la mitad que hace honesto el registro:**

- **Higiene de tests / `format-isolation` transitivo.** La celda decía «candidato natural de la Phase 85», que es exactamente la invitación que D-18 rechaza. **No se cerró ni se borró la invitación**: se reescribió a «evaluado y DIFERIDO por la Phase 85 (D-18)» con su razón (el radio sin medir) y el enlace a `85/deferred-items.md`, incluyendo el par con OQ-1. `grep -c 'format-isolation transitivo'` → 1, y su celda de estado dice **ABIERTOS**.
- **Evidencia en vivo** (round-trip real de `--fix` de 79/SDR-05 y convergencia contra cmux vivo de 80/ORCH-07). `85-03` citó evidencia **más fuerte** de la prevista (el test 4 de `79-UAT.md` con `result: pass`, round-trip completo vía el binario con deriva real el 2026-07-23) y aun así dejó anotado que la fila no se cierra. La celda ahora dice literalmente **«Contabilizar no es resolver»**.
- **UAT / backstop GitHub real.** `85-04` la dejó mejor contabilizada (`result: skipped` textual con fecha de reconocimiento y cobertura compensatoria) y explícitamente no cerrada. La celda lo refleja.

**Requisitos:** `gsd-tools query requirements.mark-complete DEBT-05 DEBT-06 DEBT-07 NYQ-01 NYQ-02` → `already_complete: 5/5`, `not_found: []`, `table_unmatched: []`, `updated: false`. Los 5 checkboxes ya estaban marcados y la traceability ya decía `Complete` — los planes de wave 1 los marcaron en su paso de state-update. La invocación se hizo igualmente y es idempotente; **cero ediciones manuales de `REQUIREMENTS.md`**.

## Deviations from Plan

### 1. [Rule 3 — Bloqueante] No existe handler de `gsd-tools` capaz de mutar una fila de §Deferred Items

El plan prescribe cuatro veces que la mutación de `STATE.md` vaya por `gsd-tools query state.*` y **nunca** por `Write`/`Edit`, sugiriendo `update` y `patch`. **Ese handler no existe.** Verificado, no supuesto:

- **Superficie real:** `state.{load, complete-phase, json, get, update, patch, begin-phase, advance-plan, record-metric, update-progress, add-decision, add-blocker, resolve-blocker, record-session, signal-waiting, signal-resume, planned-phase, validate, sync, prune, rebuild, milestone-switch, add-roadmap-evolution}`. Ninguno direcciona filas de deuda.
- **Por qué `update`/`patch` no sirven:** ambos resuelven vía `stateReplaceField` (`state-document.cjs:79`), cuyo carril de tabla es `tableRowPattern` (`:57`) — una regex anclada con `$` que solo casa **filas de 2 celdas** (`| Campo | valor |`). Las filas de §Deferred Items tienen **4 columnas**.
- **Prueba empírica** sobre una copia aislada de `STATE.md` (`--cwd` a un scratch), sin tocar el fichero real: `state.patch "Doc/consistencia"` → `{"updated":[],"failed":["Doc/consistencia"]}`; `state.update "Doc/consistencia"` → `{"updated":false,"reason":"Field \"Doc/consistencia\" not found in STATE.md"}`; `diff` contra el original → **sin cambios**.
- **El propio SDK declara esa sección CURADA:** `state-transition.cjs:1284` documenta que `rebuild` «re-derives derived sections, **preserves curated sections verbatim** (`## Accumulated Context`, **`## Deferred Items`**, `## Project Reference`, …)». `## Deferred Items` **no es** un campo derivado, y `Deferred Items` aparece en exactamente **un** fichero de toda la librería — esa línea. El SDK no la posee por diseño.

**Resolución aplicada:** la sección curada se editó con `Edit`; todas las mutaciones **gestionadas** (posición, progreso, métricas, decisiones, sesión, roadmap, requisitos) siguen pasando por sus handlers. La razón declarada de la prohibición — «es un artefacto gestionado y la edición directa lo desincroniza» — **no se materializa aquí**, y se comprobó: `gsd-tools query state.validate` → `{"valid": true, "warnings": [], "drift": {}}`.

**Lectura estricta del anti-patrón universal #15:** dice «Always use `gsd-tools query` **for registered state/roadmap handlers**». No hay handler registrado para esta mutación. Escalarlo como Rule 4 habría bloqueado la fase sobre una prohibición cuyo mecanismo alternativo no existe; se registra aquí para que la revisión pueda discrepar con los datos delante.

### 2. [Ajuste menor] `REQUIREMENTS.md` no cambió en el commit de la Task 2

El criterio de aceptación pedía que `git log -1 --stat` mostrara **ambos** ficheros cambiados. `REQUIREMENTS.md` ya estaba correcto (5/5 marcados por wave 1), así que no había delta que commitear. El criterio sustantivo —los 5 checkboxes en `[x]`, `[ ] **DEBT-0` y `[ ] **NYQ-0` a 0, traceability `Complete`— se cumple, y la invocación del handler quedó registrada. Forzar un cambio para satisfacer el `--stat` habría sido ruido.

### 3. [Ampliación] Una 6.ª fila en `deferred-items.md` no prescrita por el plan

`85-04` §Notes detectó dos desajustes en `VERIFICATION.md` archivados (`71` con `status: passed` en frontmatter vs «human_needed» en el cuerpo; `72` citando `config-set-raw.test.js` sin su prefijo `test/cli/`) y dijo «ninguna requiere acción en 85-05 salvo que se quiera abrir una fila nueva». Se abrió: sin registro, la observación se habría quedado enterrada en el SUMMARY de un plan. Va con su trigger y con la razón de no actuar (D-15: los archivados no se reescriben; `85-04` ya corrigió la cita en el `VALIDATION.md` nuevo).

## Prohibiciones respetadas

| Prohibición del plan | Comprobación |
|---|---|
| NO cerrar la fila del format-isolation transitivo | `grep -c 'format-isolation transitivo'` → **1**; celda de estado = **ABIERTOS**; no contiene «Cerrada» ni «resuelta» |
| NO cerrar «Evidencia en vivo» | `grep -c 'Evidencia en vivo'` → **2** (fila + nota de cabecera); celda = **ABIERTA** |
| NO cerrar ninguna fila sin artefacto que la respalde | Las 4 cerradas citan requisito + plan + los 3 commits de tarea de ese plan |
| NO reescribir los `MILESTONE-AUDIT.md` archivados (D-15) | Este plan no abre `.planning/milestones/**`: `git status --porcelain .planning/milestones/` → 0 líneas |
| Fences LOCKED: `test/format-isolation.test.js`, `src/gsd/lock.js`, `.planning/codebase/TESTING.md` | `git status --porcelain` sobre los tres → **0 líneas**. Cero ficheros de código o test tocados en todo el plan |
| NO editar `REQUIREMENTS.md` a mano | El fichero no cambió; la mutación se intentó vía `requirements.mark-complete` (idempotente) |

## Verificación

| Gate | Resultado |
|---|---|
| Bloque `<automated>` Task 1 | `deferred-items OK` |
| Bloque `<automated>` Task 2 | `cierre OK` |
| `grep -c '\[x\] \*\*{DEBT-05,06,07 / NYQ-01,02}\*\*'` | **1** cada uno |
| `grep -c '\[ \] \*\*DEBT-0'` / `'\[ \] \*\*NYQ-0'` | **0** / **0** |
| `grep -c '✅ \*\*Cerrada\*\*' .planning/STATE.md` | **5** (las 4 de esta fase + la de `stealLock` de Phase 82) |
| `grep -c 'format-isolation.test.js:14' <deferred-items>` | **1** (OQ-1 con líneas exactas) |
| Filas de la tabla / celdas `Trigger` vacías | **6** / **0** |
| `gsd-tools query state.validate` | `{"valid": true, "warnings": [], "drift": {}}` |
| `npm test` | **2590 tests · 2589 pass · 0 fail · 1 skipped** — baseline de wave 1 sin mover |

## Issues Encountered

**Un fallo intermitente en la primera corrida de la suite, no reproducible.** La primera pasada dio `2590 tests / 2588 pass / 1 fail / 1 skipped`; la identidad del test no quedó capturada (la salida se había canalizado a `tail -25`, que descartó la línea `not ok`). La **segunda corrida completa dio 2590 / 2589 / 0 fail / 1 skipped**, exactamente el baseline documentado por `85-02`. `node --test test/gsd-lock-race.test.js` en aislamiento → **4/4 verde**, la misma firma del flake pre-existente que `72-VERIFICATION.md` ya describe («4/4 en aislamiento»). **No se afirma la identidad sin evidencia**: lo comprobable es que este plan no toca una sola línea de código ni de test, así que no puede haberlo causado. Si el flake vuelve a aparecer, conviene capturar la salida completa antes de diagnosticar.

## Threat Flags

Ninguno. Cero superficie de red o proceso, cero instalaciones. Los cuatro vectores mitigables del threat model quedan comprobados: **T-85-05-01** (fila cerrada sin respaldo) — las 4 citan plan y commits; **T-85-05-02** (cierre indebido del format-isolation) — fila presente y ABIERTA, con registro cruzado; **T-85-05-03** (edición fuera del writer gestionado) — ver Desviación 1, con `state.validate` limpio y los campos gestionados intactos; **T-85-05-04** (ítem sin trigger) — 0 celdas vacías.

## Commits

| Task | Commit | Ficheros |
|------|--------|----------|
| 1 (85-05-01) | `72f57ef` | `85/deferred-items.md` (nuevo) |
| 2 (85-05-02) | `5d09884` | `.planning/STATE.md` |

## Next Phase Readiness

- **La Phase 85 queda completa**: 5/5 requisitos (DEBT-05/06/07, NYQ-01/02), 5/5 planes, y el registro de deuda cerrado por ambos lados — lo saldado y lo explícitamente no saldado.
- **v0.19 queda listo para `/gsd-audit-milestone`**: las 6 fases del backfill se leen COMPLIANT en `§5.5` en vez de NOT-VALIDATED, y §Deferred Items ya no contiene ninguna fila «Programado → Phase 85».
- **Para quien abra la siguiente fase de higiene de tests:** el par `format-isolation` transitivo + OQ-1 es una sola pieza de trabajo, enlazada en los dos sentidos (`STATE.md` ↔ `85/deferred-items.md`). El primer paso de esa fase es **medir** el radio de ficheros del dashboard que se pondrían rojos; hasta entonces el comentario de `test/format-isolation.test.js:14,33` se queda como está a propósito.
- **Deuda de tooling detectada, no arreglada aquí:** `gsd-tools` no expone verbo para las filas de §Deferred Items pese a que múltiples planes lo prescriben como obligatorio. O el SDK gana un handler, o la prescripción debería reconocer que esa sección es curada por diseño.

## Self-Check: PASSED

Los 3 ficheros declarados existen en disco (`deferred-items.md` nuevo, `85-05-SUMMARY.md`, `.planning/STATE.md` modificado) y los 2 commits de tarea (`72f57ef`, `5d09884`) están en el historial. Los fences LOCKED (`test/format-isolation.test.js`, `src/gsd/lock.js`, `.planning/codebase/TESTING.md`) y `.planning/milestones/` salen limpios en `git status --porcelain` (0 líneas).

---
*Phase: 85-saneo-de-deuda-nyquist-retroactivo*
*Completado: 2026-07-27*
