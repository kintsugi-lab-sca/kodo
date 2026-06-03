# Phase 36: Tabla viva — render + selección + filtros - Pattern Map

**Mapped:** 2026-05-27
**Files analyzed:** 6 (1 MODIFY, 2 NEW source, 3 NEW test) — granularidad final a decisión del planner
**Analogs found:** 6 / 6 (todos con analog dentro del propio dashboard slice — fases 34/35)

> **Hecho de grounding más importante (D-03):** el modelo de columnas NO es 1:1 con `SessionRecord`.
> No hay campo `repo` (derivar de `project_name ?? basename(project_path)`), no hay literales
> `phase`/`mode` (usar `phase_id` + `gsd_mode`, ambos GSD-only → `—`), y `age` viene del
> `elapsed_min` que el server ya computa (NUNCA recomputar con timer cliente). El typedef está en
> `src/session/state.js:11-30`; el enriquecimiento (`alive`, `elapsed_min`) en `src/server.js:379-383`.

> **Invariante dura de color-isolation:** CERO `picocolors` y CERO import de `src/cli/format.js`
> bajo `src/cli/dashboard/**`. Todo el color sale de props de `<Text>` de ink (nombres de color
> como string: `'green'`, `'red'`, `'cyan'`, `'magenta'`; `dimColor`, `inverse`). Verificado
> automáticamente por el walker en `test/format-isolation.test.js:208-219` — cubre cualquier
> archivo nuevo bajo `src/cli/dashboard/` sin tocar el test.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/App.js` (MODIFY) | component (ink root) | request-response (poll→render) | su versión actual Phase 35 (`src/cli/dashboard/App.js`) | exact (auto-analog) |
| `src/cli/dashboard/select.js` (NEW) | utility (pure derive) | transform | `src/cli/dashboard/usePoll.js` (`runPollLoop` puro + DI) | role-match (pure+DI) |
| `src/cli/dashboard/format.js` (NEW) | utility (pure derive) | transform | `src/cli/dashboard/usePoll.js` / `client.js` (puros never-throw) | role-match (pure) |
| `src/cli/dashboard/SessionTable.js` (NEW, OPCIONAL) | component (ink) | transform→render | `src/cli/dashboard/App.js` (createElement plano + `<Box>`/`<Text>`) | exact |
| `test/dashboard-select.test.js` (NEW) | test (pure) | transform | `test/dashboard-poll.test.js` (DI puro, sin host React) | exact |
| `test/dashboard-table.test.js` (NEW) | test (ink render) | request-response | `test/dashboard-status-line.test.js` (harness `makeFakeClock`/`injectProps`/`drain`) | exact |

> **Granularidad (Discretion D-117/Open Q2):** el planner puede fundir `select.js` + `format.js`
> en un solo módulo derive, mantener `SessionTable` inline en `App.js`, y fundir los dos test files.
> La clasificación de arriba refleja la estructura recomendada por RESEARCH (líneas 216-234); las
> asignaciones de patrón de abajo aplican igual sea cual sea la partición elegida.

---

## Pattern Assignments

### `src/cli/dashboard/App.js` (component ink root, request-response) — MODIFY

**Analog:** su propia versión Phase 35 — `src/cli/dashboard/App.js`. Se EXTIENDE, no se reescribe:
reemplaza el cuerpo de la status line (`statusNode`, líneas 130-149 + render líneas 151-157) por la
tabla, conserva el connection state (líneas 92-117), el `useInput` gateado (líneas 81-88) y la
estructura raíz `<Box>` (líneas 151-157).

**Imports pattern** (App.js:41-44) — copiar tal cual, añadir `useEffect`/`useRef` si hace falta para el write-back de selección:
```js
import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { createElement, useCallback, useState } from 'react';
import { fetchStatus } from './client.js';
import { usePoll } from './usePoll.js';
// NEW Phase 36: import { sortSessions, applyFilter, parseFilter, resolveSelection, countByStatus } from './select.js';
//               import { deriveRepo, formatAge, phaseMode, statusColor, statusLabel, rowCells } from './format.js';
```

**Connection state a REUSAR para el indicador live del header (D-10)** (App.js:92-97 + onResult 101-117):
```js
const [lastGoodCount, setLastGoodCount] = useState(/** @type {number | null} */ (null));
const [lastGoodAt, setLastGoodAt] = useState(/** @type {number | null} */ (null));
const [connected, setConnected] = useState(false);
const [lastAttemptAt, setLastAttemptAt] = useState(/** @type {number | null} */ (null));
```
> CRÍTICO (D-10): el indicador `● live` / `⚠ server caído` / `waiting for server` ya está derivado
> en App.js:130-149 (las tres ramas `connected` / `lastGoodAt != null` / else). NO reinventar —
> mover ese bloque al header de la tabla. Para el contador de sesiones el header usa `countByStatus`
> sobre la lista filtrada (D-11), pero la PRECEDENCIA de los estados degradados (waiting/stale) se
> mantiene por encima de los estados vacíos (D-12, Pitfall 5).

**Patrón `onResult` — keep-last-good + acceso a `data.sessions`** (App.js:101-117): en Phase 36 el
`onResult` debe además guardar el array de sesiones (p. ej. `setSessions(result.data.sessions)`) en
`ok`, y en `!ok` NO tocarlo (keep-last-good). El patrón de no-blanqueo está en las líneas 109-113.

**`useInput` mode-gated (D-13/D-15)** — el analog actual (App.js:81-88) solo maneja `q`; extender a
un flag `mode: 'list'|'filter'` que enruta teclas. Conservar el guard `{ isActive: isRawModeSupported }`
y el `Esc` deliberadamente NO manejado en modo lista (App.js:84 comment / D-15):
```js
useInput((input, key) => {
  if (mode === 'filter') {
    if (key.escape) { setQuery(''); setMode('list'); return; }   // D-15 cancel (scope MODAL)
    if (key.return) { setMode('list'); return; }                  // D-15 confirm (mantiene filtro)
    if (key.backspace || key.delete) {
      if (query === '') { setMode('list'); return; }
      setQuery((q) => q.slice(0, -1)); return;
    }
    if (input && !key.ctrl && !key.meta) setQuery((q) => q + input); // live append (D-13)
    return;
  }
  if (input === 'q') { exit(); return; }                          // conservado Phase 34
  if (input === '/') { setMode('filter'); return; }
  if (key.upArrow) { /* mover índice derivado, clamp, re-fijar selectedTaskId */ return; }
  if (key.downArrow) { /* idem hacia abajo */ return; }
  // key.escape: IGNORADO en modo lista (D-15 / Phase 34 D-11 — reservado Phase 38)
}, { isActive: isRawModeSupported });
```

**Render raíz a conservar** (App.js:151-157) — misma envoltura `<Box flexDirection="column" borderStyle="round" paddingX={1}>`, banner `bold`, `marginY:1` entre header y tabla, footer `dimColor`:
```js
return createElement(
  Box, { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
  createElement(Text, { bold: true }, 'kodo dashboard'),
  // NEW: header (indicador live D-10 + countByStatus D-11) + tabla / estados vacíos + línea de filtro
  createElement(Text, { dimColor: true }, '↑↓ move · / filter · q quit'),  // footer (UI-SPEC:185)
);
```

**Pipeline de derivación en render (orden OBLIGATORIO — Pitfall 3 / D-16):**
`sortSessions(sessions)` → `applyFilter(sorted, parseFilter(query), deriveRepo)` → `resolveSelection(filtered, selectedTaskId, prevIndex)`. Resolver SIEMPRE contra la lista YA filtrada.

---

### `src/cli/dashboard/select.js` (utility pura, transform) — NEW

**Analog:** `src/cli/dashboard/usePoll.js` — concretamente `runPollLoop` (líneas 93-157): función pura,
React-free, con dependencias inyectadas, testable sin host React. `select.js` es el mismo arquetipo:
puro, sin React, sin ink, testado aislado en `test/dashboard-select.test.js`.

**Convenciones de archivo a copiar** (usePoll.js:1-2, 42, JSDoc `@param`/`@returns`):
- `// @ts-check` en la primera línea (todo el dashboard lo usa).
- Cabecera comentario explicando decisión + fase (estilo usePoll.js:1-40).
- JSDoc `@param`/`@returns` en cada export público (regla global del proyecto + estilo usePoll.js:88-92).
- ESM `export function` con nombres explícitos (no default export para módulos de helpers).

**Funciones puras a implementar (firmas de RESEARCH, verificadas contra el typedef):**
```js
// @ts-check
/** D-04/TUI-09: copia + sort por started_at (dir FIJA, UI-SPEC:158 = DESC), tiebreak task_id. */
export function sortSessions(rows) {
  return [...rows].sort((a, b) => {                               // copia — no mutar usePoll result
    const ta = new Date(a.started_at).getTime();
    const tb = new Date(b.started_at).getTime();
    if (ta !== tb) return tb - ta;                                // DESC (UI-SPEC §Layout, línea 158)
    return a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0;  // desempate determinista
  });
}

/** D-05/D-06/D-16 (LOAD-BEARING): índice derivado por identidad + clamp fallback. */
export function resolveSelection(rows, selectedTaskId, prevIndex = 0) {
  if (rows.length === 0) return { index: -1, taskId: null };      // D-06 lista vacía
  const idx = rows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, taskId: selectedTaskId };  // sigue presente (TUI-08)
  const clamped = Math.max(0, Math.min(prevIndex, rows.length - 1));
  return { index: clamped, taskId: rows[clamped].task_id };       // vecino clampado (D-06)
}

/** D-14: parse "r:foo s:running bar" → { repo, status, text }. Substring literal, NUNCA RegExp. */
export function parseFilter(query) { /* split whitespace, prefijos r:/s:, resto → text.toLowerCase() */ }

/** D-14: AND entre criterios activos, case-insensitive, sobre celdas derivadas. */
export function applyFilter(rows, parsed, deriveRepo) { /* ver RESEARCH:368-378 */ }

/** D-11: contadores por status; zombie (running && !alive) contado APARTE. */
export function countByStatus(rows) { /* { running, review, done, error, zombie } */ }
```
> El zombie en `countByStatus` se cuenta con `r.status === 'running' && r.alive === false` ANTES del
> conteo normal (RESEARCH:337-344). `applyFilter` usa `String.includes`, jamás `new RegExp(query)`
> (Security V5 / UI-SPEC:226 — anti-ReDoS).

---

### `src/cli/dashboard/format.js` (utility pura, transform) — NEW

**Analog:** `src/cli/dashboard/client.js` (puro never-throws) + `usePoll.js` (puro). Mismo arquetipo
React-free. **OJO con el nombre:** existe `src/cli/format.js` (CLI clásico, importa `picocolors`) —
este es un archivo DISTINTO bajo `dashboard/`. El planner puede renombrarlo `derive.js` para evitar
confusión, pero la regla dura es solo que NO importe `picocolors` ni `src/cli/format.js`.

**Mapeo D-03 (el código de mayor riesgo de bug silencioso) — fuente: state.js typedef + server enrich:**
```js
// @ts-check
import { basename } from 'node:path';

/** repo: NO existe campo `repo` (state.js:11-30). Derivar (D-03). */
export function deriveRepo(session) {
  return session.project_name ?? basename(session.project_path ?? '') ?? '—';
}

/** age: humaniza elapsed_min YA computado por el server (server.js:382). NUNCA recomputar con timer. */
export function formatAge(elapsedMin) {
  if (elapsedMin == null || elapsedMin < 0) return '—';
  if (elapsedMin < 60) return `${elapsedMin}m`;
  const h = Math.floor(elapsedMin / 60), m = elapsedMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;            // 63 → "1h3m", 120 → "2h"
}

/** phase/mode: phase_id + gsd_mode, ambos GSD-only (state.js:26-27). No-GSD → "—". */
export function phaseMode(session) {
  if (!session.phase_id && !session.gsd_mode) return '—';
  return [session.phase_id, session.gsd_mode].filter(Boolean).join('/');  // "36/full"
}

/** Color SEMÁNTICO como NOMBRE de color ink (string), jamás ANSI (color-isolation D-08). */
export function statusColor(status, alive) {
  if (status === 'running' && !alive) return { color: 'red' };   // ZOMBIE
  if (status === 'running') return { color: 'green' };
  if (status === 'review') return { color: 'cyan' };
  if (status === 'error') return { color: 'magenta' };           // distinto del red zombie
  if (status === 'done') return { dim: true };                   // gray
  return {};
}

/** Marca textual NO_COLOR (D-09, LOAD-BEARING): zombie distinguible sin color. */
export function statusLabel(status, alive) {
  return status === 'running' && !alive ? 'running (zombie)' : status;
}
```
> `statusColor` devuelve strings como `'green'` que ink convierte a ANSI vía su propio chalk
> bundleado — NO `picocolors`. Esto satisface el walker de `test/format-isolation.test.js:208-219`.

---

### `src/cli/dashboard/SessionTable.js` (component ink, transform→render) — NEW (OPCIONAL)

**Analog:** `src/cli/dashboard/App.js` — el patrón `createElement` plano (sin JSX) sobre `<Box>`/`<Text>`.
El planner puede mantener esto inline en `App.js` (RESEARCH:233 "lo más simple"). Si se extrae, mismo
estilo de markup que App.js:151-157.

**Patrón de fila + celda (anchos fijos D-02, truncado ink, color SOLO via `<Text>`):**
```js
// @ts-check
import { Box, Text } from 'ink';
import { createElement as h } from 'react';

// Anchos fijos (UI-SPEC §Anchos de columna, líneas 51-58): gutter 2, task_ref 10, repo 18,
// phase/mode 11, status 18 (NO truncar — "(zombie)" load-bearing), age 7.
const COLS = { gutter: 2, task_ref: 10, repo: 18, phasemode: 11, status: 18, age: 7 };

function cell(width, text, color, dim, wrap) {
  return h(Box, { width },
    h(Text, { color, dimColor: dim, wrap: wrap ? 'truncate-end' : undefined }, text));
}

function Row({ cells, selected, statusColorName, dim }) {
  // inverse en TODA la fila + gutter `›` (redundancia NO_COLOR de la selección — UI-SPEC §Selected-Row).
  // React key = task_id (NUNCA índice — Pitfall 7).
  return h(Box, { flexDirection: 'row' },
    h(Box, { width: COLS.gutter }, h(Text, null, selected ? '› ' : '  ')),
    h(Box, { width: COLS.task_ref }, h(Text, { inverse: selected, wrap: 'truncate-end' }, cells.task_ref)),
    cell(COLS.repo, cells.repo, undefined, undefined, true),
    cell(COLS.phasemode, cells.phasemode, undefined, undefined, true),
    cell(COLS.status, cells.status, statusColorName, dim, false),  // status: color semántico, NO truncar
    cell(COLS.age, cells.age, undefined, undefined, false),
  );
}
```
> UI-SPEC excepción (línea 65): la columna `status` NO se trunca porque `(zombie)` (16 chars) es
> load-bearing para accesibilidad. La fila seleccionada compone `inverse` SOBRE el color semántico
> de `status` — el test de render debe confirmar que `(zombie)` sigue legible en la fila seleccionada
> (UI-SPEC:82).

---

### `test/dashboard-select.test.js` (test pure, transform) — NEW

**Analog:** `test/dashboard-poll.test.js` — tests de funciones puras vía DI por parámetro, SIN host
React, SIN `mock.module`. Es el patrón exacto para los dos casos load-bearing (TUI-08 y TUI-12).

**Estructura a copiar** (dashboard-poll.test.js:28-31, 131):
```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sortSessions, applyFilter, parseFilter, resolveSelection, countByStatus } from '../src/cli/dashboard/select.js';
```

**Caso LOAD-BEARING TUI-08 (selección sobrevive rebuild/reorder)** — patrón de dos arrays (RESEARCH:599):
```js
// B seleccionado; un poll reordena (B sube/baja) → resolveSelection sigue a B por task_id.
// Otro poll elimina B → cae al vecino clampado, NUNCA a un id ausente.
const before = [{task_id:'a',...}, {task_id:'b',...}, {task_id:'c',...}];
const after  = [{task_id:'a',...}, {task_id:'c',...}];           // 'b' desaparece
const sel = resolveSelection(after, 'b', /* prevIndex */ 1);
assert.equal(sel.taskId !== 'b' && after.some(r => r.task_id === sel.taskId), true);
```

**Caso LOAD-BEARING TUI-12 (cursor preservado al aplicar→limpiar filtro)** — RESEARCH:603:
```js
// s:running luego limpiar filtro: el selectedTaskId sigue siendo la misma sesión antes/después.
```

> El harness de `dashboard-poll.test.js` (fake clock, `drain()`, DI) NO es necesario para estas
> pruebas puras — `select.js` no tiene timers ni I/O. Solo se copia el ESTILO (describe/it/assert.strict,
> `// @ts-check`, mensajes de assert descriptivos con el valor real interpolado).

---

### `test/dashboard-table.test.js` (test ink render, request-response) — NEW

**Analog:** `test/dashboard-status-line.test.js` — el harness hermético ink-testing-library con
`makeFakeClock` + `injectProps` + `drain()` + `okResponse`. REUSAR esos helpers tal cual.

**Helpers a copiar literalmente** (dashboard-status-line.test.js):
- `makeFakeClock(startMs)` — líneas 39-76 (schedule/cancel/scheduleTimeout/flushTick/now/advance).
- `injectProps(clock, fetchFn)` — líneas 82-92 (props de inyección que App propaga a usePoll/fetchStatus).
- `drain()` — líneas 99-101 (`setImmediate` para drenar microtasks; ink@4 NO tiene `waitUntilExit()`).
- `okResponse(body)` — líneas 104-106 (response-like mínimo `{ok,status,json}`).

**Fixture `/status` con los campos D-03** (RESEARCH:526-532) — incluir zombie + non-GSD:
```js
const FIXTURE = { count: 2, sessions: [
  { task_id:'a', task_ref:'KL-1', status:'running', alive:true,  started_at:'2026-05-27T10:00:00Z', project_name:'kodo',  elapsed_min:5,  phase_id:'36', gsd_mode:'full', summary:'' },
  { task_id:'b', task_ref:'KL-2', status:'running', alive:false, started_at:'2026-05-27T09:00:00Z', project_path:'/x/foo', elapsed_min:63, summary:'' },  // zombie, non-GSD
]};
```

**Aserciones de render** (estilo dashboard-status-line.test.js:119-139, `assert.match(lastFrame(), …)`):
- columnas presentes (`task_ref` / repo derivado / `36/full` / `—` non-GSD / `5m` / `1h3m`).
- marca zombie `(zombie)` presente en `lastFrame()` (TUI-10/D-09) — y también en la fila seleccionada.
- contadores del header (`2 running · 1 zombie` o equivalente, D-11).
- estados vacíos: `no active sessions` (D-12a) vs `no sessions match` (D-12b).
- modo filtro: `stdin.write('/')` abre la línea; char writes filtran en vivo; `stdin.write('\x1b')` (Esc) cancela.

> Teclas de flecha: `stdin.write('\x1b[A')` (↑) / `'\x1b[B')` (↓) (RESEARCH:537). El caso
> selección-sobrevive-rebuild se cubre mejor como test PURO de `resolveSelection` (arriba) que por
> frame-diff — el frame-diff es frágil (RESEARCH:537, 616).

---

## Shared Patterns

### Color-isolation (invariante dura cross-milestone — D-12 Phase 34)
**Source:** `test/format-isolation.test.js:208-219` (walker que escanea `src/cli/dashboard/**`).
**Apply to:** TODOS los archivos nuevos bajo `src/cli/dashboard/`.
- Color SOLO via props de `<Text>` de ink: `color` (nombre string), `dimColor`, `inverse`, `bold`.
- PROHIBIDO importar `picocolors` o `src/cli/format.js` (este último lo importa transitivamente).
- `statusColor` devuelve `{ color: 'green' }` (string), no ANSI — ink lo convierte internamente.
- El test ya cubre archivos nuevos automáticamente (no hay que editarlo); se pondrá rojo si alguno cuela `picocolors`.

### `// @ts-check` + JSDoc en cada export público
**Source:** todos los archivos del dashboard (`App.js:1`, `usePoll.js:1,88-92`, `client.js:1,37-46`).
**Apply to:** todos los archivos nuevos (source y test).
- Primera línea `// @ts-check`.
- JSDoc `@param`/`@returns` en cada función pública (regla global del proyecto — CLAUDE.md "YARD/PHPDoc"; aquí JSDoc).
- Cabecera comentario con la decisión + nº de fase (estilo usePoll.js:1-40 / App.js:1-39).

### `React.createElement` plano (sin JSX, sin build step)
**Source:** `src/cli/dashboard/App.js:130-157`.
**Apply to:** `App.js` (MODIFY) y `SessionTable.js` (si se extrae).
- `import { createElement } from 'react'` (o `createElement as h`).
- Nada de JSX — el proyecto corre `.js` plano sin transpilación.

### Helpers puros + DI testable (sin `mock.module`)
**Source:** `src/cli/dashboard/usePoll.js` (`runPollLoop`) + `client.js` (`fetchStatus` con `fetchFn` inyectable).
**Apply to:** `select.js`, `format.js`, sus tests.
- Toda la LÓGICA (sort/filter/parse/resolve/derive/color) vive en funciones puras React-free.
- ink solo renderiza strings/colores ya derivados (dumb component).
- Tests puros directos (`test/dashboard-poll.test.js` estilo); render tests via ink-testing-library (`test/dashboard-status-line.test.js` estilo).

### Harness hermético ink (sin red, sin timers reales)
**Source:** `test/dashboard-status-line.test.js:39-106` (`makeFakeClock`/`injectProps`/`drain`/`okResponse`).
**Apply to:** `test/dashboard-table.test.js`.
- `ink-testing-library@4` `render()` → `{ lastFrame, frames, stdin, rerender, unmount, cleanup }` — NO `waitUntilExit()`.
- Inyectar `fetchFn` + clock fake por props de `App` (igual que Phase 34/35).
- `drain()` = `new Promise(r => setImmediate(r))` para avanzar microtasks.

---

## No Analog Found

> Ninguno. Los 6 archivos tienen analog directo dentro del slice del dashboard (fases 34/35). Esta
> fase es presentación pura sobre el stream ya existente — todo arquetipo (render ink, helper puro+DI,
> test puro, test render hermético) ya existe en el codebase y está cubierto por la suite verde.

Casos NO cubiertos por un analog exacto (a derivar de RESEARCH/UI-SPEC, no del codebase):
| Aspecto | Razón | Fuente prescriptiva |
|---------|-------|---------------------|
| Truncado con ellipsis `…` | No hay tabla previa en el dashboard | `<Text wrap="truncate-end">` (RESEARCH:416, UI-SPEC:63) |
| Mode-gated `useInput` (list/filter) | App.js actual solo maneja `q` | RESEARCH Pattern 6 (líneas 348-399) |
| Selected-row treatment (`inverse` + gutter `›`) | No hay selección previa | UI-SPEC §Selected-Row (líneas 122-137) |

---

## Metadata

**Analog search scope:** `src/cli/dashboard/` (App.js, usePoll.js, client.js, index.js), `test/dashboard-*.test.js`, `src/server.js:361-413` (shape `/status`), `src/session/state.js:11-37` (typedef Session), `test/format-isolation.test.js` (walker color-isolation), `src/cli/format.js` (referencia de qué NO importar — confirmado prohibido).
**Files scanned:** 9 archivos leídos (4 source dashboard + 3 test + server slice + state typedef).
**Pattern extraction date:** 2026-05-27
