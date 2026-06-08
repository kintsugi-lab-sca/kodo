---
phase: 43-render-provider-state-en-el-dashboard
verified: 2026-06-08T09:52:00+02:00
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Abrir el dashboard TUI con una sesión real que tenga provider_state 'in_review' y verificar que la columna 'task' aparece entre 'status' y 'age' mostrando 'in_review' en texto plano."
    expected: "La columna 'task' es visible en el frame, posicionada entre 'status' y 'age', con el valor verbatim del provider sin color propio."
    why_human: "El render ink solo puede verificarse completamente en una terminal real con sesiones activas; las pruebas de integración usan fixtures estáticos."
  - test: "En el dashboard TUI, activar el modo filtro con '/' y escribir 'ps:review'. Verificar que solo aparecen las filas con provider_state que contiene 'review'."
    expected: "Las filas sin provider_state o con provider_state que no contiene 'review' desaparecen; las que contienen 'review' permanecen."
    why_human: "No existe test de integración de render end-to-end para ps: (IN-01 del code review). La capa pura está cubierta pero el camino stdin→parseFilter→applyFilter→SessionTable→lastFrame no está ejercitado."
  - test: "Verificar que en el footer del dashboard se muestra el hint 'ps:state' junto al resto de hints de filtro."
    expected: "El footer muestra '↑↓ move · / filter (ps:state) · d dismiss · q quit' en texto dim."
    why_human: "Verificación visual del layout real en terminal."
---

# Phase 43: Render provider_state en el Dashboard — Verification Report

**Phase Goal:** Render — provider_state en el dashboard: render (columna dedicada `task` para `provider_state`, 3 reason-states sin color) + filtro de `provider_state` (prefijo `ps:` separado del `s:`), según decisiones discuss-phase.
**Verified:** 2026-06-08T09:52:00+02:00
**Status:** human_needed
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El dashboard muestra provider_state en columna dedicada 'task', separada de 'status' (eje local v3) — D-01/D-02/D-03 | ✓ VERIFIED | `COLS.task = 12` en SessionTable.js:48; cabecera `task` en línea 294; celda de datos en línea 330 entre `status` y `age`. |
| 2 | Una sesión con provider_state 'in_review' es visible verbatim en la columna 'task' (ROMAN-150) | ✓ VERIFIED | `taskCell` retorna `{text:'in_review',dim:false}` — spot-check en vivo confirmado. Test `dashboard-format.test.js` cobre este caso. |
| 3 | Fila unsupported muestra '—' dim; fila fetch-failed muestra '?' dim — distinguibles SIN color (D-04/D-05) | ✓ VERIFIED | `taskCell`: `reason==='unsupported'→{text:'—',dim:true}`, `reason==='fetch-failed'→{text:'?',dim:true}`. Spot-check en vivo y tests 24/24 verdes. |
| 4 | El valor crudo 'unknown' (reason null) se muestra verbatim como ok-value, NO como glyph degradado | ✓ VERIFIED | `taskCell({provider_state:'unknown',provider_state_reason:null})` → `{text:'unknown',dim:false}`. Documentado inline en format.js:187-189. Test explícito en dashboard-format.test.js. |
| 5 | Un estado renombrado por el provider se muestra verbatim sin cambios de código (cero tabla de mapeo — D-08) | ✓ VERIFIED | `taskCell` devuelve `session.provider_state` sin ninguna transformación (format.js:207). Test 'criterio 4: valor inventado verbatim' en dashboard-format.test.js. |
| 6 | El operador filtra por provider_state con prefijo dedicado `ps:` — NO extender s: con OR (D-06) | ✓ VERIFIED | `parseFilter`: rama `startsWith('ps:')` en select.js:121, campo `provider_state` en `out`. `parseFilter('ps:review')` → `{provider_state:'review',status:null}`. Spot-check en vivo confirmado. |
| 7 | El match es por substring case-insensitive: ps:rev casa 'in_review' — String.includes anti-ReDoS, nunca RegExp (D-07) | ✓ VERIFIED | `applyFilter`: `(r.provider_state??'').toLowerCase().includes(parsed.provider_state)` — select.js:171-172. Grep gate: `grep -cE 'new RegExp|\.match\(|\.test\('` == 0. Test anti-ReDoS con `ps:.*` en dashboard-select.test.js. |
| 8 | El prefijo `s:` sigue filtrando SOLO el estado local v3 (match exacto) — ejes separados | ✓ VERIFIED | `parseFilter('s:running').provider_state === null` — spot-check en vivo. Test explícito 'ps: NO se confunde con s:' en dashboard-select.test.js. La asimetría está documentada inline en select.js:144-148. |
| 9 | Una fila con provider_state === null (unsupported/fetch-failed) NUNCA casa con ps: — D-09 | ✓ VERIFIED | `(null ?? '').toLowerCase()` → `''`; `''.includes('review')` → false. Spot-check en vivo: fila con `provider_state:null` excluida. Tests D-09 en dashboard-select.test.js (null y ausente). |
| 10 | El footer de hints documenta el prefijo ps: | ✓ VERIFIED | App.js:575: `'↑↓ move · / filter (ps:state) · d dismiss · q quit'`. `grep -c 'ps:' src/cli/dashboard/App.js` == 1. |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/dashboard/format.js` | `taskCell` puro + `rowCells.task` | ✓ VERIFIED | `taskCell` exportado (línea 201), `rowCells` extendido con `task: taskCell(session)` (línea 224). Sustantivo: 208 líneas, función pura documentada con los 3 reason-states. Wired: importado por SessionTable.js vía `rowCells`. |
| `src/cli/dashboard/SessionTable.js` | Columna `task` entre status y age | ✓ VERIFIED | `COLS.task: 12` (línea 48), cabecera (línea 294), celda de datos (línea 330) consumiendo `cells.task.text` y `cells.task.dim`. |
| `src/cli/dashboard/select.js` | `parseFilter` reconoce `ps:` + `applyFilter` filtra por `provider_state` con `String.includes` | ✓ VERIFIED | Rama `ps:` en parseFilter:121, rama `provider_state` en applyFilter:168-172. |
| `src/cli/dashboard/App.js` | Footer de hints documenta `ps:` | ✓ VERIFIED | Línea 575: `'↑↓ move · / filter (ps:state) · d dismiss · q quit'`. |
| `test/dashboard-format.test.js` | 8 tests de taskCell + rowCells.task | ✓ VERIFIED | 8 casos verificados: 6 de taskCell (ok, unknown, unsupported, fetch-failed, ausencia, verbatim) + 2 de rowCells. 24/24 tests verdes. |
| `test/dashboard-table.test.js` | Tests PSTATE-05: header, verbatim, glyphs | ✓ VERIFIED | `FIXTURE_PSTATE` con 3 reason-states; 3 tests (D-03 header, verbatim, glyphs —/?). `unmount()` al final de cada test nuevo para evitar event loop leak. |
| `test/dashboard-select.test.js` | 9 tests PSTATE-06 | ✓ VERIFIED | Tests: parseFilter reconoce ps:, case-insensitive, no-confusión con s:, substring, D-09 null, ausente, exacto-vs-substring, AND con s:, anti-ReDoS literal `.*`. 27/27 tests verdes. |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `SessionTable.js` | `format.js` | `rowCells(session).task` | ✓ WIRED | SessionTable.js:25 importa `rowCells`; línea 301 llama `rowCells(session)`; línea 330 consume `cells.task.text` y `cells.task.dim`. |
| `format.js` | `provider_state / provider_state_reason` | `taskCell` deriva de ambos campos | ✓ WIRED | `taskCell`: `session.provider_state_reason` (línea 202) y `session.provider_state` (línea 206). Carril read-only (no escribe). |
| `App.js` | `select.js` | `applyFilter(sorted, parseFilter(query), deriveRepo)` | ✓ WIRED | App.js:266 (wiring preexistente intacto). La rama `ps:` entra automáticamente vía `parseFilter`. |
| `select.js applyFilter` | `provider_state` | `String.includes` sobre `r.provider_state` | ✓ WIRED | `(r.provider_state ?? '').toLowerCase().includes(parsed.provider_state)` — línea 171-172. |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `SessionTable.js` — celda `task` | `cells.task.text` / `cells.task.dim` | `rowCells(session)` → `taskCell(session)` → `session.provider_state` + `session.provider_state_reason` (enriquecidos por GET /status, Phase 40) | Si (Phase 40 ya provee los campos en cada poll) | ✓ FLOWING |
| `applyFilter` — rama `ps:` | `r.provider_state` | Mismo campo de GET /status; `parseFilter(query)` desde input del operador | Si | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `taskCell` con los 5 casos del plan | `node -e "import taskCell; console.log(...)"` | `{text:'in_review',dim:false}` / `{text:'—',dim:true}` / `{text:'?',dim:true}` / `{text:'unknown',dim:false}` / `{text:'—',dim:false}` | ✓ PASS |
| `parseFilter('ps:review')` → campo `provider_state` | `node -e "parseFilter('ps:review')"` | `{repo:null,status:null,provider_state:'review',text:''}` | ✓ PASS |
| D-09: fila `provider_state:null` nunca casa con `ps:review` | `applyFilter([{task_id:'a',provider_state:null},{task_id:'b',provider_state:'in_review'}], parseFilter('ps:review'))` | `['b']` — solo la fila con valor presente | ✓ PASS |
| AND: `s:running ps:review` filtra ambos ejes | `parseFilter('s:running ps:review').status`, `.provider_state` | `'running'`, `'review'` — ejes separados, ambos activos | ✓ PASS |
| Anti-ReDoS gate | `grep -cE 'new RegExp|\.match\(|\.test\(' select.js` (no-comentarios) | 0 | ✓ PASS |
| Suite completa (confirmación) | `find test -name '*.test.js' \| xargs node --test` | 1203 pass / 0 fail / 1 skip / 261 suites | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| PSTATE-05 | 43-01-PLAN.md | Dashboard muestra `provider_state` de forma separada de `statusColor` v3 | ✓ SATISFIED | Columna dedicada `task` en SessionTable.js entre `status` y `age`; `taskCell` puro en format.js; 3 reason-states distinguibles sin color. |
| PSTATE-06 | 43-02-PLAN.md | Filtro del dashboard permite acotar por `provider_state` con `String.includes` anti-ReDoS | ✓ SATISFIED | Prefijo `ps:` en `parseFilter`/`applyFilter`; substring case-insensitive; filas null nunca casan (D-09); cero RegExp; footer documenta `ps:`. |

**Cobertura:** 2/2 requirements del milestone Phase 43 satisfechos. Los requirements PSTATE-01–PSTATE-04 fueron satisfechos en Phase 40 (fuera del scope de esta fase).

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `format.js` | 207 | `raw == null ? '—' : raw` no cubre `raw === ''` | ⚠️ Warning (WR-01 del code review) | Un `provider_state` de cadena vacía renderiza celda en blanco en vez de `'—'`. No crashea. Bug latente ya documentado en 43-REVIEW.md. No afecta los 3 reason-states especificados (el servidor solo emite string no vacío o null). |
| `test/dashboard-table.test.js` | ~164,182,193,… | Tests TUI-07…TUI-12 preexistentes no llaman `unmount()` | ⚠️ Warning (WR-02 del code review) | Event loop leak; puede causar interferencias en el runner. Preexistente a Phase 43 (no introducido por esta fase). Los tests nuevos PSTATE-05 sí llaman `unmount()` correctamente. |

No hay `TBD`, `FIXME` ni `XXX` en ninguno de los 4 archivos modificados. No hay imports reales de `picocolors` (solo menciones en comentarios de documentación de invariante — el walker automático `test/format-isolation.test.js` confirma cero imports reales: 8/8 tests verdes).

---

### Invariantes críticos confirmados

| Invariante | Estado | Evidencia |
|------------|--------|-----------|
| Color-isolation: cero picocolors en `src/cli/dashboard/` | ✓ INTACTO | `test/format-isolation.test.js` 8/8 pass; grep de imports reales vacío en los 4 archivos. |
| Anti-ReDoS: cero RegExp sobre input del operador en `select.js` | ✓ INTACTO | Gate `grep -cE 'new RegExp\|\.match\(\|\.test\('` == 0. |
| `ps:` eje separado de `s:` | ✓ INTACTO | `parseFilter('s:running').provider_state === null`; ramas completamente independientes. |
| Filas con `provider_state===null` nunca casan con `ps:` | ✓ INTACTO | `(null??'').toLowerCase()` → `''`; `''.includes(termNoVacío)` → false por construcción. Spot-check en vivo confirmado. |

---

### Human Verification Required

#### 1. Render visual de la columna `task` en terminal real

**Test:** Abrir el dashboard TUI (`kodo dashboard`) con al menos una sesión que tenga `provider_state` activo (ej. una tarea en Plane en estado "In Review"). Verificar el frame completo de la tabla.
**Expected:** La columna `task` aparece entre `status` y `age` con header `task` (dimColor), la sesión muestra su `provider_state` verbatim ('in_review') en texto plano sin color propio; las sesiones sin soporte muestran '—' dim y las con fetch-failed muestran '?' dim.
**Why human:** El render ink en terminal real puede diferir de los tests de integración con ink-testing-library (métricas de ancho, alineación, truncado). No existe entorno de CI con terminal real.

#### 2. Filtro `ps:` end-to-end en terminal real

**Test:** En el dashboard TUI, activar el filtro con `/` y escribir `ps:review`. Observar la tabla.
**Expected:** Solo las sesiones cuyo `provider_state` contiene 'review' (ej. 'in_review') permanecen visibles. Las demás desaparecen. Al borrar el filtro, todas las sesiones reaparecen.
**Why human:** No existe test de integración render end-to-end para `ps:` (IN-01 del code review). La capa pura (`select.js`) está completamente cubierta, pero el camino `stdin.write('ps:review')` → `parseFilter` → `applyFilter` → `SessionTable` → frame visible no tiene cobertura en el test runner.

#### 3. Footer hint `ps:state` visible en terminal

**Test:** En el dashboard TUI, sin entrar en modo filtro, verificar el footer inferior.
**Expected:** El footer muestra `↑↓ move · / filter (ps:state) · d dismiss · q quit` en dimColor.
**Why human:** Verificación visual del layout y legibilidad del hint en anchuras de terminal distintas.

---

### Gaps Summary

Sin gaps bloqueantes. Todos los must-haves de ambos planes (43-01 y 43-02) están verificados con evidencia directa en el código. Los tres warnings del code review (WR-01, WR-02, WR-03) son de naturaleza advisory y no bloquean el goal de la fase:

- **WR-01** (edge case `provider_state === ''`) es un bug latente para un caso que el servidor no produce actualmente; no afecta los 3 reason-states especificados.
- **WR-02** (unmount faltante en tests preexistentes) es deuda preexistente a Phase 43; los tests nuevos de esta fase sí la respetan.
- **WR-03** (JSDoc ambiguo en select.js:251) es cosmético.

El status `human_needed` refleja que 3 verificaciones de comportamiento visual/interactivo en terminal real no pueden hacerse programáticamente.

---

_Verified: 2026-06-08T09:52:00+02:00_
_Verifier: Claude (gsd-verifier)_
