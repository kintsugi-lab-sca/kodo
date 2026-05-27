---
phase: 36-tabla-viva-render-seleccion-filtros
verified: 2026-05-28T00:50:00Z
status: human_needed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification: false
human_verification:
  - test: "Lanzar `kodo dashboard` contra un server real con sesiones activas y verificar que la tabla se ve correctamente en la terminal"
    expected: "Tabla columnar con task_ref · repo · phase/mode · status · age, orden DESC por started_at, indicador ● live, contadores por estado en el header"
    why_human: "Los tests de ink-testing-library verifican el texto generado pero no el layout visual real con anchos fijos COLS en una terminal TTY. El truncado con ellipsis (wrap='truncate-end') solo se activa con un ancho de terminal real."
  - test: "Con una sesión zombie (running + alive=false) visible, verificar que el color rojo aparece en la celda status y que '(zombie)' es legible"
    expected: "La celda status muestra 'running (zombie)' en rojo; la marca textual sobrevive el ancho de columna de 18 chars sin truncarse"
    why_human: "Los tests verifican el string de color name ('red') y el texto '(zombie)', pero el rendering visual de ink con inverse+color no puede confirmarse programáticamente"
  - test: "Abrir el filtro modal con '/' y teclear una query; verificar que la línea de filtro aparece al pie de la tabla con el cursor ▏"
    expected: "Aparece la línea '/ <query>▏' al pie, las filas se filtran en vivo, el modo se distingue visualmente del footer de hints '/ filter'"
    why_human: "El test unitario verifica la presencia del char ▏ en el frame de texto; el posicionamiento visual al pie de la tabla (marginTop) requiere una terminal real"
---

# Phase 36: Verification Report — Tabla viva, render, selección y filtros

**Phase Goal:** El operador ve y navega la lista viva de sesiones con una tabla legible, selección estable por identidad, orden que no salta, color semántico, resumen de contadores y filtros — la capa de presentación central sobre la que actúan attach/comments/logs.
**Verified:** 2026-05-28T00:50:00Z
**Status:** human_needed
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| # | Verdad | Status | Evidencia |
|---|--------|--------|-----------|
| 1 | La tabla muestra columnas `task_ref · repo · phase/mode · status · age` (TUI-07) | VERIFIED | `SessionTable.js:166-175` renderiza las 6 columnas con COLS fijos; `test/dashboard-table.test.js:148-164` verde: KL-1/kodo/36/full/5m + KL-2/foo/—/1h3m |
| 2 | La selección se rastrea por `task_id` y sobrevive al reordenamiento/refresh (TUI-08) | VERIFIED | `resolveSelection` en `select.js:74-80` implementa búsqueda por identidad; `dashboard-select.test.js:46-51` verde; navegación ↑/↓ en `App.js:207-216` re-fija `selectedTaskId`; `dashboard-table.test.js:273-305` (nav clamp) verde |
| 3 | Las filas se ordenan DESC por `started_at` con tiebreak `task_id` (TUI-09, WR-01) | VERIFIED | `sortSessions` en `select.js:40-58` normaliza NaN→0 antes de comparar (fix WR-01, commit 43e790f); `dashboard-select.test.js:115-188` incluye test de timestamps no parseables; `dashboard-table.test.js:192-207` (orden DESC) verde |
| 4 | Las filas se colorean por `status+alive`; el zombie muestra '(zombie)' textual (TUI-10) | VERIFIED | `statusColor/statusLabel` en `format.js:91-110`; `SessionTable.js:192-193` aplica `statusColor` en la celda status sin truncar; `dashboard-format.test.js:70-105` verde; `dashboard-table.test.js:166-175` (zombie marker) verde |
| 5 | El header muestra indicador live + contadores por estado con zombie aparte; vacío muestra 'no active sessions' (TUI-11) | VERIFIED | `countsLabel` en `SessionTable.js:61-69`; `LiveIndicator` en `SessionTable.js:82-95` porta las tres ramas de Phase 35; precedencia D-12 en `SessionTable.js:152-164`; `dashboard-table.test.js:177-256` (contadores + vacíos + precedencia degradada) verde |
| 6 | El filtro `/` preserva el cursor por identidad al aplicar/limpiar; `r:`/`s:` + substring; nunca regex (TUI-12, CR-01 fix) | VERIFIED | `parseFilter/applyFilter` en `select.js:91-131` usa `String.includes` exclusivamente; `App.js:226-236` useEffect con guard `sel.taskId != null` (fix CR-01, commit 8edb871); `dashboard-table.test.js:386-434` (test de regresión CR-01 hide-all→clear) verde |

**Score:** 6/6 verdades verificadas

---

### Verificación CR-01 (Blocker resuelto post-ejecución)

El code review (36-REVIEW.md) identificó un bug crítico: cuando el filtro oculta TODA la lista, el `useEffect` de write-back en `App.js` sobrescribía `selectedTaskId` con `null`, destruyendo la identidad. Al limpiar el filtro, el cursor saltaba a la primera fila en lugar de volver a la sesión seleccionada (violación de D-16/TUI-12).

**Fix verificado en App.js:229-235:**
```js
prevIndexRef.current = sel.index >= 0 ? sel.index : prevIndexRef.current;
if (sel.taskId != null && selectedTaskId !== sel.taskId) setSelectedTaskId(sel.taskId);
```
La condición `sel.taskId != null` impide pisar la identidad cuando la lista filtrada está vacía.

**Test de regresión verificado:** `test/dashboard-table.test.js:386-434` — "CR-01/D-16: filtro que oculta TODA la lista → al limpiar, el cursor vuelve a la sesión seleccionada (no a la primera fila)" — **PASA** (11.5ms).

**Traza del camino CR-01 verificada:**
1. Estado inicial: KL-1 seleccionado (newest, top)
2. `stdin.write('/')` + `stdin.write('r:foo')` → solo KL-2 visible → selectedTaskId='b' (por clamp D-06)
3. `stdin.write('zzz')` → query='r:foozzz' → filtered=[] → `sel.taskId === null`
4. `useEffect`: `sel.index === -1` → `prevIndexRef` NO se pisa; `sel.taskId === null` → `setSelectedTaskId` NO se llama → identidad 'b' conservada
5. `stdin.write('\x1b')` (Esc) → query='', filtered=[KL-1, KL-2] → `resolveSelection([KL-1,KL-2], 'b', prevIndexRef)` → devuelve `{index:1, taskId:'b'}`
6. Frame: `› KL-2` presente, `› KL-1` ausente ← **correcto**

**Verificación WR-01 (fix incluido):** `sortSessions` aplica `Number.isFinite(t) ? t : 0` antes del comparador. Test `dashboard-select.test.js:140-168` verifica orden determinista con timestamps no parseables y con input barajado. **PASA**.

---

### Required Artifacts

| Artifact | Descripción esperada | Status | Detalles |
|----------|---------------------|--------|----------|
| `src/cli/dashboard/select.js` | sortSessions, applyFilter, parseFilter, resolveSelection, countByStatus | VERIFIED | 148 líneas; todos los exports presentes; `// @ts-check`; JSDoc en cada export; cero picocolors/new RegExp sobre input |
| `src/cli/dashboard/format.js` | deriveRepo, formatAge, phaseMode, statusColor, statusLabel, rowCells | VERIFIED | 128 líneas; todos los exports presentes; usa `basename` de `node:path`; solo color names (strings planos) |
| `src/cli/dashboard/App.js` | Tabla render, pipeline sort→filter→resolve, mode/query state, useInput gateado | VERIFIED | 261 líneas; imports de select.js y format.js confirmados; `setSessions`, `mode === 'filter'`, `setMode`, `parseFilter(query)`, `setSelectedTaskId` presentes; prevIndexRef para clamp |
| `src/cli/dashboard/SessionTable.js` | Tabla presentacional: header, filas con COLS fijos, filter line, no-match branch | VERIFIED | 206 líneas; default export; React key = `task_id` (línea 184: `key: session.task_id`); `mode === 'filter'` → filter line; `hasQuery` distingue empty states |
| `test/dashboard-select.test.js` | Tests puros: resolveSelection (2 load-bearing), sortSessions, countByStatus | VERIFIED | `grep -c 'LOAD-BEARING' = 2`; los 2 casos load-bearing marcados explícitamente; cero import de react/ink |
| `test/dashboard-format.test.js` | Tests puros: deriveRepo, formatAge, phaseMode, statusColor, statusLabel, rowCells | VERIFIED | Cubre D-03/D-08/D-09 completamente; verde |
| `test/dashboard-filter.test.js` | Tests puros: parseFilter/applyFilter incl. case folding y literal special chars | VERIFIED | Test de `.*` literal presente; cero new RegExp; verde |
| `test/dashboard-table.test.js` | Render tests (ink-testing-library): columnas, orden, zombie, contadores, nav, filtro, CR-01 | VERIFIED | 15 tests; incluye test de regresión CR-01/D-16 (línea 386); todos verde |

---

### Key Link Verification

| From | To | Via | Status | Detalles |
|------|----|-----|--------|----------|
| `App.js` | `select.js + format.js` | `import { sortSessions, applyFilter, parseFilter, resolveSelection, countByStatus }` + `{ rowCells, statusColor, deriveRepo }` | WIRED | App.js líneas 58-65; imports confirmados por grep |
| `App.js onResult` | `data.sessions` | `setSessions(result.data.sessions ?? [])` en ok; untouched en !ok | WIRED | App.js línea 137: `setSessions(result.data.sessions ?? [])` |
| `App.js render pipeline` | `parseFilter(query) / applyFilter` | query en vivo (no '') en cada render: `applyFilter(sorted, parseFilter(query), deriveRepo)` | WIRED | App.js línea 161 |
| `App.js useInput` | `mode state` | `mode === 'filter'` enruta teclas; `setMode`, `setQuery` actualizados | WIRED | App.js líneas 172-220 |
| `App.js ↑/↓ handler` | `setSelectedTaskId` | `filtered[ni].task_id` en ambos handlers (up y down) | WIRED | App.js líneas 210, 215 |
| `SessionTable.js` | `ink <Text color>` | `statusColor` devuelve nombre string aplicado a `<Text color>`; cero picocolors | WIRED | SessionTable.js línea 182: `const sc = statusColor(...)`; línea 193: `color: sc.color` |
| `format.js` | `src/session/state.js Session typedef` | `project_name`, `project_path`, `phase_id`, `gsd_mode`, `elapsed_min` — todos los campos D-03 | WIRED | format.js:38-45 (deriveRepo), :55-61 (formatAge usa elapsed_min), :70-73 (phaseMode) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produce datos reales | Status |
|----------|--------------|--------|---------------------|--------|
| `SessionTable.js` | `rows` (prop) | `filtered` de App.js render pipeline ← `setSessions` en `onResult` ← `usePoll`/`fetchStatus` ← `GET /status` | Sí — `setSessions(result.data.sessions ?? [])` en respuesta ok; keep-last-good en !ok | FLOWING |
| `SessionTable.js` | `counts` (prop) | `countByStatus(filtered)` en App.js render | Sí — derivado de `filtered` que viene de la misma fuente | FLOWING |
| `SessionTable.js` | `selectedIndex` | `sel.index` de `resolveSelection(filtered, selectedTaskId, prevIndexRef.current)` | Sí — basado en identidad `task_id`, no índice estático | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Resultado | Status |
|----------|-----------|--------|
| 42 tests puros (select/format/filter) pasan | 42/42 verde — `ℹ pass 42` | PASS |
| 15 tests de render (dashboard-table) pasan incluyendo CR-01 regression | 15/15 verde — CR-01 test verde (11.5ms) | PASS |
| Suite completa sin regresión | 957 pass / 0 fail / 1 skipped — ningún test preexistente roto | PASS |
| Color-isolation walker (format-isolation) | 8 pass / 0 fail | PASS |
| No `new RegExp` sobre input en src/cli/dashboard/ | `grep -REn "new RegExp" src/cli/dashboard/` retorna vacío | PASS |
| No picocolors ni cli/format importados en src/cli/dashboard/ | Solo aparecen en comentarios; cero import statements | PASS |

---

### Requirements Coverage

| Requirement | Plan | Descripción | Status | Evidencia |
|-------------|------|-------------|--------|-----------|
| TUI-07 | 36-01, 36-02 | Tabla con columnas task_ref · repo · phase/mode · status · age | SATISFIED | `SessionTable.js:166-175`; test dashboard-table.test.js:148-164 verde |
| TUI-08 | 36-01, 36-03 | Selección por identidad task_id, sobrevive rebuild del array | SATISFIED | `resolveSelection` select.js:74-80; nav ↑/↓ App.js:207-216; tests select + table verde |
| TUI-09 | 36-01, 36-02 | Orden estable DESC por started_at, sin saltar entre polls | SATISFIED | `sortSessions` select.js:40-58 con fix WR-01; test select.test.js:115-188 verde |
| TUI-10 | 36-01, 36-02 | Color semántico por status+alive; zombie running+!alive con '(zombie)' | SATISFIED | `statusColor/statusLabel` format.js:91-110; SessionTable.js:192-193 no trunca; tests verde |
| TUI-11 | 36-01, 36-02 | Header con indicador live + contadores (zombie aparte); empty state | SATISFIED | `countsLabel` SessionTable.js:61-69; tres ramas D-12 SessionTable.js:152-164; tests verde |
| TUI-12 | 36-01, 36-03 | Filtro `/` con r:/s:+substring; cursor preservado al aplicar/limpiar; CR-01 corregido | SATISFIED | `parseFilter/applyFilter` select.js:91-131; App.js:226-236 con guard CR-01; test regresión CR-01 verde |

Todos los 6 requirement IDs de Phase 36 (TUI-07 a TUI-12) cubiertos y satisfechos.

---

### Anti-Patterns Found

| File | Línea | Pattern | Severidad | Impacto |
|------|-------|---------|-----------|---------|
| `App.js` | 108-109 | Estado `lastError` escrito pero nunca leído (IN-01 de REVIEW) | INFO | Provoca un setState extra sin efecto observable; no bloquea nada. Marcado como `// eslint-disable-next-line no-unused-vars` |
| `App.js` | 18 | Comentario cabecera dice `footer hint 'q quit'` pero el código renderiza `'↑↓ move · / filter · q quit'` (IN-02 de REVIEW) | INFO | Documentación desactualizada en comentario; el código es correcto |
| `SessionTable.js` | 194 | `truncate: false` para celda `age` es redundante (IN-03 de REVIEW) | INFO | Decisión defensiva inofensiva; no requiere acción |
| `select.js/format.js` | varios | WR-02 (countByStatus no contempla estado `idle`) y WR-03 (formatAge no normaliza float) documentados en REVIEW pero **no corregidos** | WARNING | WR-01 (sort determinista) fue corregido en 43e790f; WR-02 y WR-03 son advisories sin impacto operativo actual — el server envía status cerrado y `Math.floor(elapsed_min)` respectivamente |

No hay marcadores TBD/FIXME/XXX sin referencia de seguimiento en los archivos modificados. Los dos advisories restantes (WR-02, WR-03) son acoplamiento de contrato no declarado, no bugs activos.

---

### Human Verification Required

#### 1. Layout visual de la tabla en terminal real

**Test:** Lanzar `kodo dashboard` con sesiones activas y observar la tabla en la terminal
**Expected:** Columnas alineadas con anchos fijos COLS={gutter:2, task_ref:10, repo:18, phasemode:11, status:18, age:7}; texto truncado con `…` cuando desborda; ninguna columna se solapa ni se deforma
**Why human:** El ancho efectivo de las columnas depende del ancho de la terminal TTY real; `wrap='truncate-end'` en ink solo se activa con dimensiones reales; los tests de ink-testing-library validan el contenido de texto pero no el layout visual ni el truncado real

#### 2. Color semántico visible: zombie rojo, done atenuado, review cyan

**Test:** Con sesiones en distintos estados (running, running zombie, review, error, done), verificar que la celda status muestra el color correcto
**Expected:** running=verde, zombie=rojo, review=cyan, error=magenta, done=atenuado; la marca '(zombie)' en rojo es legible y no se trunca
**Why human:** Los tests verifican el color name string ('red', 'cyan', etc.) y la presencia del texto, pero el rendering visual de ink con `inverse` superpuesto al color requiere una terminal real para confirmar legibilidad

#### 3. Filtro modal: posicionamiento y UX del prompt

**Test:** Pulsar `/`, teclear una query (`r:kodo`), verificar la línea modal al pie; luego Esc para cancelar y verificar que el cursor vuelve a la sesión original
**Expected:** La línea `/ r:kodo▏` aparece visualmente al pie de la tabla (no entrelazada con las filas); al cancelar con Esc, la lista completa vuelve y el cursor `›` está en la sesión que estaba seleccionada antes del filtro
**Why human:** El test automatizado del camino CR-01 verifica el comportamiento en el frame de texto con fake stdin; el flujo de interacción completo con una terminal real puede tener latencias de render o comportamiento de Esc diferente con buffers de terminal reales

---

### Gaps Summary

**No hay gaps bloqueantes.** Todas las verdades observables del goal de la fase están verificadas en el código real.

El blocker CR-01 identificado en el code review fue corregido (commit 8edb871) antes de esta verificación:
- El fix es correcto: `sel.taskId != null` como guarda en el write-back useEffect
- El test de regresión cubre el camino completo (seleccionar KL-2 → filtrar a vacío → limpiar → verificar que el cursor vuelve a KL-2, no KL-1)
- El test pasa verde con el fix y habría fallado sin él

Los advisories WR-02 (estado `idle` no contado) y WR-03 (formatAge con float) son acoplamiento de contrato no declarado entre select.js/format.js y los invariantes del server; no tienen impacto operativo hoy. La documentación JSDoc los menciona; no requieren acción en esta fase.

Los tres informativos (IN-01 lastError dead state, IN-02 comentario desactualizado, IN-03 truncate redundante) son ruido menor que no afectan la funcionalidad.

---

_Verified: 2026-05-28T00:50:00Z_
_Verifier: Claude (gsd-verifier)_
