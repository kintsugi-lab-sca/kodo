---
phase: 50-live-progress-display-condicional-solo-si-phase-49-viable
plan: 03
subsystem: cli/dashboard
tags: [tui, dashboard, progress, display, conditional-column, never-throws, color-isolation]
dependency_graph:
  requires: ["50-02 (~/.kodo/progress/<task_id>.json productor + schema { n, m, completed, updated_at })"]
  provides:
    - "src/cli/dashboard/progress.js (readProgress consumidor never-throws)"
    - "deriveAnyProgress (select.js) — flag estructural columna condicional"
    - "progCell + prog en rowCells (format.js) — celda no-color 4 estados"
    - "enrich client-side de session.progress + keep-last-good (App.js)"
    - "columna condicional prog en SessionTable.js (entre status y task)"
  affects: ["dashboard TUI — PROG-03 cerrado (display N/M + estados degradados)"]
tech_stack:
  added: []
  patterns:
    - "consumidor filesystem never-throws (mold readLightPlan, seam byte-idéntico productor↔consumidor)"
    - "columna condicional estructural sobre set SIN filtrar (mold deriveAnyGsd, Pitfall 5)"
    - "celda no-color con degradados (mold taskCell, color-isolation D-12)"
    - "enrich client-side en App.js (mold readPlan, NO server.js — D-08)"
    - "keep-last-good en useRef por task_id (memoria entre polls, sin re-render)"
    - "anti-traversal task_id String.includes (NO regex, mold plan.js:120-121)"
key_files:
  created:
    - src/cli/dashboard/progress.js
    - test/dashboard-progress.test.js
  modified:
    - src/cli/dashboard/select.js
    - src/cli/dashboard/format.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - test/dashboard-select.test.js
    - test/dashboard-format.test.js
decisions:
  - "Enrich CLIENT-SIDE en App.js (mold readPlan App.js:544) — CERO cambios en server.js (D-08 LOCKED)"
  - "Keep-last-good en useRef Map<task_id> — error+last-good expone N/M (status ok), sin él expone error (?)"
  - "Guard anti-traversal interno en App.js antes de readProgress (defensa en profundidad; UUID kodo seguro)"
  - "COLS.prog=7 (reserva sufijo ✓ para peor caso 12/15✓) entre status y task"
  - "deriveAnyProgress sobre enriched (set SIN filtrar) — columna no parpadea bajo /"
metrics:
  duration: "~15 min"
  completed: "2026-06-13"
  tasks: 3
  files: 6
requirements_completed: ["PROG-03"]
---

# Phase 50 Plan 03: Live-progress display condicional Summary

El dashboard TUI muestra el progreso vivo `N/M` por sesión en una columna condicional `prog` (entre `status` y `task`), leyendo SOLO el artefacto kodo `~/.kodo/progress/<task_id>.json` filesystem-style (mold `readLightPlan`), enriquecido **CLIENT-SIDE en App.js** (mold `readPlan`, never-throws, CERO `server.js`), con 4 estados degradados honestos (`N/M` / `N/M✓` / `—` / `?`), keep-last-good en memoria y cero-color. Cierra PROG-03 — el consumidor del seam byte-idéntico productor↔consumidor del Plan 02.

## Qué se construyó

- **`src/cli/dashboard/progress.js` (NUEVO):** `readProgress(taskId, deps)` never-throws, espejo de la forma de `readLightPlan`. DI `readFileFn`/`kodoProgressDir`/`homedirFn` (HOME-isolable). Discriminante de status: JSON parseable → `{ status:'ok', n, m, completed:!!o.completed }`; ENOENT → `{ status:'no-progress' }`; otro (EACCES/JSON corrupto/sin .code) → `{ status:'error' }`. Leaf-isolation: solo Node builtins, sin `src/config.js`, sin picocolors, sin regex. Ruta byte-idéntica al productor del Plan 02.
- **`src/cli/dashboard/select.js` (MODIFICADO):** `deriveAnyProgress(rows)` = `rows.some(r => r.progress != null)`, espejo literal de `deriveAnyGsd`. Docstring replica el invariante CRÍTICO: el caller lo computa sobre el set SIN filtrar (Pitfall 5 == Pitfall 4 de Phase 44).
- **`src/cli/dashboard/format.js` (MODIFICADO):** `progCell(session)` deriva los 4 estados LOCKED desde `session.progress` (espejo de `taskCell`): `no-progress`/ausente → `{ text:'—', dim:true }`; `error` → `{ text:'?', dim:true }`; `ok` → `{ text:'N/M[✓]', dim:false }`. Devuelve `{ text, dim }` plano, CERO color propio. `rowCells` incluye `prog: progCell(session)` entre `task` y `age`; JSDoc `@returns` actualizado.
- **`src/cli/dashboard/App.js` (MODIFICADO):** enrich CLIENT-SIDE de cada fila con `progress` vía `readProgress(row.task_id, {})` (síncrono never-throws, mold del handler `p`/`readPlan` App.js:544), construido sobre `sorted` ANTES de `deriveAnyProgress`/`applyFilter`/`rowCells`. **Keep-last-good (D-09):** `progressLastGoodRef` (useRef `Map<task_id, {n,m,completed}>`): `ok` refresca el ref; `error` con last-good expone `{ status:'ok', ...prev }` (progCell pinta N/M, no `?`); `error` sin last-good expone `{ status:'error' }` (`?`); `no-progress` → `—`. Guard anti-traversal del taskId (String.includes, NO regex) antes de leer. `anyProgress = deriveAnyProgress(enriched)` sobre el set SIN filtrar, pasado a `SessionTable`.
- **`src/cli/dashboard/SessionTable.js` (MODIFICADO):** `COLS.prog = 7` entre `status` y `task` (orden `status → prog → task → age`). Prop `anyProgress` (default `false`, retro-compat). Cabecera + celda condicionales (mold `phasemode`): se emiten solo si `anyProgress`, recuperan ancho vía flex si no. `truncate:true` → ellipsis nativo `…` = anti-DoS (T-50-cell-dos). Cero-color en la celda prog.

## Decisión load-bearing: enrich CLIENT-SIDE, NO server.js (D-08)

El PATTERNS.md original sugería enriquecer `progress` server-side en `src/server.js GET /status` (mold de `provider_state`). **D-08 + Success Criteria 2 lo RECHAZAN.** `provider_state` es server-side porque requiere `await ...resolve()` (async/red); `progress` es lectura filesystem SÍNCRONA never-throws → encaja CLIENT-SIDE exactamente como `readPlan` (App.js:544). El enrich vive en el pipeline de derivación de App.js. **`git diff --quiet src/server.js` → 0 cambios (acceptance DURO PASS).**

## Verificación

- `node --test test/dashboard-progress.test.js test/dashboard-select.test.js test/dashboard-format.test.js test/format-isolation.test.js` → **83/83 verde** (8 readProgress + deriveAnyProgress + 4 deriveAnyProgress + 5 progCell + 2 rowCells + el resto de las suites existentes).
- `node --test test/dashboard/app-open.test.js` → 4/4 verde.
- `npm test` → **1317 pass, 0 fail, 1 skip** (cero regresiones; +18 sobre los 1299 del Plan 02).
- **`git diff --quiet src/server.js` → 0 cambios (D-08 LOCKED: cero endpoints nuevos, cero enrich server-side).**
- `format-isolation.test.js` verde → `progCell` no rompe color-isolation (cero picocolors/ANSI).
- Greps acceptance: `readProgress` en App.js (3), `deriveAnyProgress|anyProgress` en App.js (5), `anyProgress` en SessionTable.js (6 ≥2), `prog` en SessionTable.js (13).

## Threat model

- **T-50-redos / T-50-traversal (mitigate):** guard `String.includes('/')`/`'\\'`/`'..'` sobre `task_id` en App.js ANTES de `readProgress` (defensa en profundidad; el UUID kodo es seguro por construcción). Ruta CONSTRUIDA con root FIJO `join(homedir(),'.kodo','progress')`. Cero regex desde input.
- **T-50-cell-dos (mitigate):** `truncate:true` en la celda prog → wrap `truncate-end`, un n/m absurdo se trunca a la columna, no desborda la tabla (mold T-43-03).
- **T-50-json-crash (mitigate):** `readProgress` never-throws (JSON.parse en try/catch → status 'error' → progCell '?' + keep-last-good en App.js).
- **T-50-endpoint (mitigate):** INVARIANTE D-08 honrado — cero cambios en server.js, cero endpoints (verificado por `git diff --quiet`).
- **T-50-SC (N/A):** cero paquetes nuevos (Node builtins + ink/react ya presentes).

## Deviations from Plan

None — el plan se ejecutó exactamente como estaba escrito. El enrich se ubicó CLIENT-SIDE en App.js (D-08), ignorando el texto residual de PATTERNS.md/RESEARCH.md que sugería server.js, tal como el plan instruía explícitamente. Detalle de fidelidad: `deriveAnyGsd` se computa sobre `enriched` (= `sorted` + spread de `progress` por fila) en vez de `sorted`; `phase_id` se preserva intacto en el spread, así que es equivalente y mantiene un único pase de derivación.

## Known Stubs

None — la columna es funcional end-to-end. Consume el artefacto que el hook del Plan 02 produce (seam byte-idéntico verificado). Cohortes legacy / sesiones sin tasks-dir → sin artefacto → `—` (tolerado por diseño D-09).

## Self-Check: PASSED

- FOUND: src/cli/dashboard/progress.js
- FOUND: test/dashboard-progress.test.js
- FOUND commit 0760fa3 (RED t1), 2bc9b9a (GREEN t1), 93ad42c (RED t2), a83868d (GREEN t2), 5811429 (t3)
- D-08 PASS: git diff --quiet src/server.js → 0 cambios

## TDD Gate Compliance

Tareas 1 y 2 siguieron RED → GREEN (commits `test(...)` preceden a sus `feat(...)`):
- Task 1: `0760fa3 test` → `2bc9b9a feat`
- Task 2: `93ad42c test` → `a83868d feat`

Task 3 (`type="auto"`, sin `tdd="true"`) integró el wiring client-side + columna; verificado por la suite existente (`app-open.test.js` + `npm test` completo) sin commit RED separado, según el contrato del plan. REFACTOR no requerido.
