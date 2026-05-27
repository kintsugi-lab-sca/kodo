# Phase 36: Tabla viva — render + selección + filtros - Research

**Researched:** 2026-05-27
**Domain:** ink (React-for-CLI) columnar table render + identity-tracked selection + live filtering, on top of the Phase 35 `/status` poll stream
**Confidence:** HIGH (ink API verified against installed `ink@6.8.0` exports + official docs; codebase patterns verified by reading App.js / usePoll.js / client.js / server.js / state.js / existing dashboard tests directly)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Render de la tabla columnar (TUI-07, TUI-09)**
- **D-01:** Render con **ink puro** (`<Box flexDirection="column">` para la lista; cada fila un `<Box flexDirection="row">` con un `<Text>` por celda). **NO** reusar `formatTable`/`formatRow` de `src/cli/format.js` (usa `picocolors`, prohibido bajo `src/cli/dashboard/**` por la invariante color-isolation D-12 Phase 34).
- **D-02:** **Anchos de columna fijos** (estáticos) con `padEnd` + **truncado con ellipsis `…`** para valores largos (`task_ref`, `repo` derivado, `summary`). NO layout responsive al ancho de terminal en esta fase (YAGNI). Markup vía `React.createElement` plano (sin JSX, sin build step).
- **D-03 (GROUNDING CRÍTICO — el mapeo de columnas NO es 1:1 con `SessionRecord`):**
  - `task_ref` → **directo** (`session.task_ref`, p. ej. `"KL-42"`, `"#42"`).
  - `repo` → **DERIVADO** — **no existe campo `repo`**. Usar `session.project_name ?? basename(session.project_path)`.
  - `phase/mode` → **`phase_id` + `gsd_mode`** (ambos opcionales, presentes SOLO en sesiones GSD). No-GSD → placeholder `—`. `gsd_mode ∈ {'full','quick'}`; `phase_id` p. ej. `"36"`.
  - `status` → **directo**, 4 valores: `'running' | 'done' | 'error' | 'review'`.
  - `age` → **humanizado** desde `elapsed_min` (server ya lo computa en `/status`) a formato compacto `Nm` / `Hh Mm` (p. ej. `5m`, `1h3m`). Preferir `elapsed_min` sobre recomputar desde `started_at`.
- **D-04:** **Orden estable por `started_at`** (TUI-09): sort determinista (asc o desc — el planner elige, pero **fijo**) con `started_at` como clave primaria y `task_id` como **desempate**. Sort sobre una **copia** del array (no mutar el resultado de `usePoll`).

**Selección por identidad (TUI-08)**
- **D-05:** El estado de cursor es **`selectedTaskId` (string | null)**, NO un índice numérico. El índice visible se **deriva** buscando `selectedTaskId` en la lista ya ordenada+filtrada en cada render.
- **D-06:** **Cuando la fila seleccionada desaparece** en un refresh: fallback al row en el **mismo índice posicional previo, clampado** a `[0, len-1]`, y se actualiza `selectedTaskId` al `task_id` de ese row. Lista vacía → `selectedTaskId = null`. Nunca apuntar a un id ausente.
- **D-07:** **Selección inicial** = primera fila (tras el orden de D-04) cuando hay ≥1 sesión; `null` cuando está vacía. ↑/↓ mueven el índice derivado y re-fijan `selectedTaskId`; **clamp en los extremos, sin wrap-around**.

**Color semántico (TUI-10)**
- **D-08:** Paleta `status` + `alive` → color, **solo vía `<Text color>` de ink**:
  - `running` + `alive` → **green**
  - `running` + `!alive` (ZOMBIE) → **red**
  - `review` → **cyan**
  - `done` → **dim/gray** (`dimColor`)
  - `error` → **magenta** (distinto del red del zombie)
- **D-09:** **No depender solo del color** (accesibilidad / NO_COLOR): el zombie lleva además una **marca textual** (sufijo `(zombie)` o glifo en la celda `status`).
- **D-10:** El **indicador "live" del header** (TUI-11) **reusa el connection state ya existente** en `App.js` de Phase 35 (`● live` verde / `⚠ server caído` amarillo) — no se reinventa; se mueve/integra al header de la tabla.

**Header de contadores + estados vacíos (TUI-11)**
- **D-11:** Header = indicador live (D-10) **+ contadores por `status`** derivados de la lista actual, formato compacto `3 running · 1 review` (omitir count 0). El **zombie** (`running`+`!alive`) se cuenta aparte cuando hay ≥1 (`2 running · 1 zombie`).
- **D-12:** **Dos estados vacíos distintos:** (a) **lista realmente vacía** (poll ok, 0 sesiones) → `no active sessions`; (b) **filtro sin coincidencias** → `no sessions match`. El estado `waiting for server` / `server caído` de Phase 35 se conserva por encima de todo.

**Filtros (TUI-12)**
- **D-13:** `/` abre un **modo filtro modal**: una línea de input al pie de la tabla. Filtrado **en vivo** (re-filtra a cada pulsación, no al pulsar Enter).
- **D-14:** **Prefijos dentro de la misma query:** `r:<texto>` filtra por la columna `repo` derivada; `s:<estado>` por `status`. Query **sin prefijo** → substring global sobre celdas visibles. Case-insensitive. (Planner decide si `r:`/`s:` combinan — recomendado: AND.)
- **D-15 (resuelve el conflicto con D-11 de Phase 34 — `Esc` reservado):** mientras el **input de filtro está activo**, `Esc` **cancela el filtro y sale del modo filtro** (scope MODAL). NO contradice D-11 de Phase 34 (esa reserva aplica al **modo lista**). `Enter` confirma (mantiene el filtro y devuelve ↑/↓ a la lista). Backspace en query vacía también sale del modo. **Phase 38 debe honrar este límite.**
- **D-16:** **Preservación del cursor al filtrar/limpiar (TUI-12):** dado que el cursor se rastrea por `selectedTaskId` (D-05), al aplicar/limpiar el filtro el cursor **sigue a la misma sesión** si permanece visible; si el filtro la oculta, fallback clampado dentro de la **lista filtrada** (mecánica de D-06). Al limpiar, si reaparece, el cursor vuelve a ella.

### Claude's Discretion
- Estructura de componentes: ¿un único `App.js` que crece, o extraer `SessionTable.js` / `useSelection.js` / `useFilter.js` / helpers puros (`formatAge`, `deriveRepo`, `statusColor`)? Recomendado extraer helpers puros (testables sin ink, patrón DI). Planner decide granularidad.
- Dónde vive el estado de selección/filtro (hooks dedicados vs `useState` en `App`), respetando D-05/D-13/D-16.
- Si `r:` y `s:` combinan (AND) o son exclusivos (D-14) — recomendado AND.
- Dirección del sort por `started_at` (asc/desc) mientras sea **fija y estable** (D-04).
- Anchos exactos de columna y umbral de truncado (D-02).
- Si los contadores del header incluyen `done`/`error` o solo los "activos" (D-11).

### Deferred Ideas (OUT OF SCOPE)
- **Attach con `Enter`** → `cmux attach <workspace_ref>` (handoff TTY) — **Phase 37**. Esta fase deja `workspace_ref` disponible en la fila seleccionada pero NO hace el handoff.
- **Overlays `c` (comentarios) y `l` (logs grep)** — **Phase 38**. `Esc` cerrará overlays en modo lista (honrando el límite modal de D-15).
- **Layout responsive al ancho de terminal** — descartado por YAGNI (D-02).
- **Ordenar por columnas distintas a `started_at`** — fuera de scope; el orden estable por `started_at` es el requisito (TUI-09).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUI-07 | Tabla de sesiones con columnas `task_ref · repo · phase/mode · status · age` | Standard Stack (hand-rolled `<Box>`/`<Text>` table), Pattern 1 (fixed-width columns), Code Examples (rowCells / column layout). D-03 field-mapping grounding made explicit. |
| TUI-08 | Cursor ↑/↓; selección rastreada por `task_id`, sobrevive refresh/reorder | Pattern 2 (selection-by-identity), `resolveSelection` helper, Pitfall 1, Validation Architecture (load-bearing reducer test). |
| TUI-09 | Orden estable por `started_at` (no salta cada poll) | Pattern 3 (stable sort w/ tiebreak), `sortSessions` helper, Pitfall 2. |
| TUI-10 | Color por `status`+`alive`, incl. zombie `running`+`!alive` | Pattern 4 (`statusColor` + textual marker), Code Examples, Pitfall 4. Color via ink `<Text color>` only. |
| TUI-11 | Header live + contadores por estado; vacío → "no active sessions" | Pattern 5 (header counters), `countByStatus` helper, two empty-states (D-12), reuses Phase 35 connection state (D-10). |
| TUI-12 | Filtros `/` substring + prefijos `r:`/`s:`, cursor preservado | Pattern 6 (modal filter mode), `applyFilter` + `parseFilter` helpers, Pitfall 3 + Pitfall 5, contextual-Esc (D-15), Validation Architecture (cursor-preservation test). Filter input: hand-rolled via `useInput` (see Standard Stack rationale). |
</phase_requirements>

## Summary

This phase is **pure presentation logic over an already-flowing data stream**. Phase 35 delivered `fetchStatus` (never-throws `{ok,data}`), `usePoll` (self-scheduling, single-flight, backoff), and an `App.js` that already holds `connected`/`lastGoodCount`/`lastGoodAt` connection state and renders a minimal status line. Phase 36 replaces that status line body with a navigable columnar table and adds selection, color, a counter header, and filtering. **No new dependencies, no new endpoints, no new data-fetching** — the entire phase is React render + pure derive helpers.

The dominant architectural force is the project's **pure-helper + DI testability pattern** (the Node test runner has no `mock.module`). Every piece of *logic* — `sortSessions`, `applyFilter`, `parseFilter`, `resolveSelection`, `deriveRepo`, `formatAge`, `statusColor`, `countByStatus` — must be a React-free pure function unit-tested in isolation, while ink components are exercised via `ink-testing-library`'s `lastFrame()` / `stdin.write()`. The two load-bearing behaviors (selection-by-`task_id` surviving array rebuild, and cursor preservation across filter apply/clear) are both expressible as pure-function tests on `resolveSelection`, which is the single highest-value piece of test coverage in the phase.

The single most important grounding fact is **D-03**: the column model is NOT 1:1 with `SessionRecord`. There is no `repo` field (derive from `project_name ?? basename(project_path)`), no `phase`/`mode` literals (use `phase_id` + `gsd_mode`, both GSD-only optionals → `—` placeholder for non-GSD sessions), and `age` comes from the server-computed `elapsed_min` (never recompute client-side on a timer — Pitfall 6). Getting the field mapping wrong is the most likely silent bug.

**Primary recommendation:** Extract all logic into a React-free `select.js` (and a `format.js`-style derive module) of pure helpers; render via hand-rolled `<Box>`/`<Text>` with fixed-width columns and ink's native `<Text wrap="truncate-end">` for ellipsis; hand-roll the `/` filter input with `useInput` + a `mode` flag (do NOT add `ink-text-input` for a single-line query — see rationale); track selection as `selectedTaskId` re-derived every render via `resolveSelection`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Table layout (columns, widths, truncation) | ink component (`<Box>`/`<Text>`) | Pure derive (`rowCells` produces display strings) | ink owns Flexbox layout + color; derive layer produces the strings, ink positions/colors them. |
| Stable ordering | Pure derive (`sortSessions`) | — | Sort is pure data transformation; zero React, zero ink. Testable in isolation. |
| Selection-by-identity | Pure derive (`resolveSelection`) + App `useState` | ink `useInput` (key events) | Identity resolution is pure; React holds `selectedTaskId`; `useInput` translates ↑/↓ into state changes. |
| Color mapping | Pure derive (`statusColor` → color name string) | ink component (`<Text color={...}>`) | The *decision* (status+alive → color name) is pure and testable; ink *applies* it. Color-isolation: ink only. |
| Header counters | Pure derive (`countByStatus`) | App state (connection) + ink render | Counts are pure over the list; live indicator reuses Phase 35 connection state already in App. |
| Filter parsing + matching | Pure derive (`parseFilter`, `applyFilter`) | ink `useInput` (query input) + App `useState` (query, mode) | Parse/match are pure; React holds the query string + filter mode; `useInput` captures keystrokes. |
| Filter input UX (modal `/` line) | ink component + App `mode` state | `useInput` mode-gating | Modal input is a React mode flag (`'list' | 'filter'`) routing keys; no library needed for one line. |
| Empty/degraded states | App render (branch on connection + filtered length) | Pure derive (counts/lengths) | Branch logic in render; the inputs (connected?, total len, filtered len) are pure. |

> **Tier discipline note:** every "decision" in this phase is pure and lives outside React; ink components are dumb renderers that receive already-derived strings/colors. This is the direct application of the project's DI-for-testability invariant and is what makes the load-bearing behaviors automatable.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `^6.8.0` (installed; npm latest of the 6 line) | `<Box>`/`<Text>` Flexbox layout, `useInput` keys, `<Text color>` semantic color, `wrap="truncate-end"` ellipsis | Already a prod dep (verified in `package.json`). Keeps `engines.node >=20` (ink@7 needs Node 22). Exports verified by importing the installed module: `Box, Text, useApp, useInput, useStdin, Transform, measureElement, ...`. `[VERIFIED: installed node_modules/ink + npm registry]` |
| `react` | `^19.2.0` (installed `19.2.6`) | `useState`/`useEffect`/`useRef`/`createElement` for selection + filter state | ink@6 peer-requires `react >=19.0.0`. Already installed. `React.createElement` plano (no JSX, no build step). `[VERIFIED: installed node_modules/react]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ink-testing-library` | `^4.0.0` (installed, devDep) | Render components to a string buffer; `lastFrame()` / `frames` / `stdin.write()` for key injection | **Already the project's TUI test harness** (used by `test/dashboard-render.test.js`, `test/dashboard-status-line.test.js`). All ink render + key-routing tests in this phase use it. `[VERIFIED: installed + in package.json devDependencies]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled `<Box>`/`<Text>` table | `ink-table` | **REJECTED** (D-01, milestone STACK). `ink-table@3.1.0` last modified **2023-12-06** (stale, `[VERIFIED: npm view time.modified]`), historically CJS/loose peers. Hand-rolling fixed columns is ~40 LOC for 5 known columns and preserves color-isolation. |
| Hand-rolled `/` filter input via `useInput` | `ink-text-input@^6.0.0` | **NOT RECOMMENDED for this phase.** `ink-text-input` is a legitimate maintained package (`[VERIFIED: npm view]` — maintainer `vdemedes`, repo `github.com/vadimdemedes/ink-text-input`, modified 2024-05-21), BUT: (1) it is **not currently installed** and **not in package.json** — adding it is a new prod dep against minimal-deps culture; (2) the filter is a **single-line, no-paste, no-multiline-cursor** query — hand-rolling over `useInput` (append char, backspace, Esc/Enter) is ~15 LOC; (3) it adds a focus-management surface (`useFocus`) that complicates the simple `mode: 'list'|'filter'` flag. **Recommendation: hand-roll.** If the planner finds cursor-positioning UX (left/right arrow within the query) is required, reconsider — but D-13/D-14 describe append-and-backspace live filtering, which `useInput` covers directly. Milestone STACK called `ink-text-input` "needed" for the search box, but that assessment predates the D-13 modal-line simplification; flag as a planner decision. |
| `<Text wrap="truncate-end">` for ellipsis | Manual `padEnd` + `.slice()` + `…` | Both valid. ink's `wrap="truncate-end"` inside a fixed-`width` `<Box>` truncates with `…` natively (verified in ink docs). **Recommended: use ink truncate for the visual ellipsis; use `padEnd` only for right-padding alignment.** Keep the truncation threshold logic out of pure helpers where ink already does it — but `rowCells` may still pre-truncate for deterministic `lastFrame()` assertions. Planner decides; document the choice. |

**Installation:**
```bash
# Nothing to install — ink@6.8.0, react@19.2.x, ink-testing-library@4 already in package.json.
# Confirm node_modules is populated before implementing:
npm ls ink react ink-testing-library
# If hand-rolling the filter input is rejected in favor of ink-text-input, THEN (and only then):
#   npm install ink-text-input@^6.0.0   (gate behind a checkpoint:human-verify — see Package Legitimacy Audit)
```

**Version verification (performed this session):**
- `ink`: npm latest `7.0.4` (Node >=22 — correctly avoided); `ink@6.8.0` pinned, `engines.node >=20`, peer `react >=19.0.0`. `[VERIFIED: npm view ink + npm view ink@6.8.0]`
- `react`: installed `19.2.6`, satisfies ink@6 peer. `[VERIFIED: node_modules/react/package.json]`
- `ink-text-input`: `6.0.0`, peer `ink >=5, react >=18`. `[VERIFIED: npm view ink-text-input]` — but NOT installed and NOT recommended for this phase.
- `ink-table`: `3.1.0`, modified 2023-12-06 (stale). `[VERIFIED: npm view ink-table]` — REJECTED.

## Package Legitimacy Audit

> No new packages are required for this phase. All recommended packages are already present.

| Package | Registry | Age | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-------------|-----------|-------------|
| `ink@6.8.0` | npm | created 2017, modified 2025 | github.com/vadimdemedes/ink | unavailable | Approved (already a prod dep; verified by import) |
| `react@19.2.x` | npm | mature | github.com/facebook/react | unavailable | Approved (already a prod dep; installed 19.2.6) |
| `ink-testing-library@4.0.0` | npm | mature | github.com/vadimdemedes/ink-testing-library | unavailable | Approved (already a devDep; used by existing tests) |
| `ink-text-input@6.0.0` | npm | created 2017-07-09, modified 2024-05-21 | github.com/vadimdemedes/ink-text-input | unavailable | **NOT ADDED** — only if planner overrides hand-roll recommendation; if added, gate behind `checkpoint:human-verify` |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

*slopcheck could not be installed in this environment (`pip install slopcheck` unavailable). However, the three approved packages are NOT new — they are already declared in `package.json` and three of them are already resolved in `node_modules` and exercised by the green Phase 34/35 test suite, which is stronger evidence than a registry check. `ink-text-input` (the only candidate new install) is verified via npm registry to share the same maintainer (`vdemedes`) and GitHub org (`vadimdemedes`) as `ink` itself — low slop risk — but is not recommended for addition this phase. If the planner adds it, gate it behind a `checkpoint:human-verify` task per the degradation protocol.*

## Architecture Patterns

### System Architecture Diagram

```
                         Phase 35 (already wired, untouched data layer)
┌──────────────────────────────────────────────────────────────────────────┐
│  usePoll(fetchStatus, …)  ──tick──►  fetchStatus → { ok, data }            │
│       │                                                                     │
│       └─ onResult({ok,data})  in App.js                                     │
│             ├─ ok:    setConnected(true);  setLastGood…                     │
│             └─ !ok:   setConnected(false);  (keep-last-good)                │
└──────────────────────────────┬─────────────────────────────────────────────┘
                                │  data.sessions[]  (rebuilt every poll)
                                │  each: {task_ref, status, started_at, task_id,
                                │         workspace_ref, project_name?, project_path,
                                │         phase_id?, gsd_mode?, summary, alive, elapsed_min}
                                ▼
        ╔═══════════════ NEW in Phase 36: PURE DERIVE PIPELINE (no React, no ink) ════════════╗
        ║  sortSessions(sessions)               → stable by started_at, task_id tiebreak (D-04) ║
        ║       │                                                                              ║
        ║       ▼                                                                              ║
        ║  applyFilter(sorted, parseFilter(query))  → filtered subset (D-13/D-14)              ║
        ║       │                                                                              ║
        ║       ▼                                                                              ║
        ║  resolveSelection(filtered, selectedTaskId, prevIndex)                               ║
        ║       │   → { index, taskId|null }   (identity + clamp fallback, D-05/D-06/D-16)      ║
        ║       │                                                                              ║
        ║  per-row:  deriveRepo(s) · formatAge(s.elapsed_min) · phaseMode(s) ·                 ║
        ║            statusColor(s.status, s.alive) · zombieMarker(s)   (D-03/D-08/D-09)        ║
        ║  whole list:  countByStatus(filtered)   (D-11)                                       ║
        ╚══════════════════════════════════╤═══════════════════════════════════════════════════╝
                                            │  derived rows + colors + counts + selectedIndex
                                            ▼
        ┌─────────────────────────── ink RENDER (dumb, color via <Text> only) ─────────────────┐
        │  App / SessionTable                                                                   │
        │   ├─ Header:  ● live | ⚠ server caído  (reuse Phase 35 connection state, D-10)        │
        │   │           + "3 running · 1 review · 1 zombie"  (countByStatus, D-11)              │
        │   ├─ Column header row  (task_ref  repo  phase/mode  status  age)                     │
        │   ├─ Rows:   <Box flexDirection="row"> <Text color width…> per cell </Box>            │
        │   │           selected row → inverse / highlight; status cell color = statusColor()   │
        │   ├─ Empty branch:  "no active sessions" (D-12a) | "no sessions match" (D-12b)        │
        │   │                 | "waiting for server" / stale (Phase 35, above all, D-12)         │
        │   └─ Filter line (when mode==='filter'):  "/ <query>▏"  at the foot                   │
        │   Footer: "↑↓ move   / filter   q quit"                                               │
        └──────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │  key events
        ┌───────────────────────────────────────▼────────────────────────────────────────────────┐
        │  useInput((input, key), { isActive: isRawModeSupported })   — MODE-GATED                  │
        │   mode==='list':                                                                          │
        │     key.upArrow/downArrow → move derived index, re-fix selectedTaskId (clamp, no wrap)    │
        │     input==='/'           → setMode('filter')                                             │
        │     input==='q'           → exit()   (existing)                                           │
        │     key.escape            → IGNORED (reserved for Phase 38 overlays, D-15)                │
        │   mode==='filter':                                                                        │
        │     printable char        → query += char  (live re-filter, D-13)                        │
        │     key.backspace/delete  → query = query.slice(0,-1); empty+backspace → setMode('list')  │
        │     key.return            → setMode('list')  (keep filter applied, D-15)                  │
        │     key.escape            → query='' ; setMode('list')  (cancel filter, D-15 MODAL scope) │
        └──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/cli/dashboard/
├── App.js              # MODIFIED: replace status-line body with table; hold selectedTaskId + query + mode; route keys
├── select.js           # NEW (pure, no React): sortSessions, applyFilter, parseFilter, resolveSelection, countByStatus
├── format.js           # NEW (pure, no React): deriveRepo, formatAge, phaseMode, statusColor, zombieMarker, rowCells
│                        #   (planner may merge select.js + format.js into one derive module — Discretion)
├── SessionTable.js      # NEW (optional, ink): Header + column header + rows + empty/filter branches
│                        #   (planner may keep this inline in App.js if "lo más simple" wins — Discretion)
├── client.js           # UNTOUCHED (Phase 35)
├── usePoll.js           # UNTOUCHED (Phase 35)
└── index.js             # UNTOUCHED (Phase 34) — runDashboard, baseUrl, lifecycle
```

> **NOTE — do NOT name the new derive module `format.js` if it would collide with the mental model of `src/cli/format.js`.** The classic-CLI `src/cli/format.js` is the picocolors single-source (forbidden in the dashboard). A dashboard-local `src/cli/dashboard/format.js` is a *different file* and is fine, but to avoid confusion the planner may prefer a name like `derive.js` or fold all helpers into `select.js`. The hard rule is only that nothing under `src/cli/dashboard/**` imports `picocolors` or `src/cli/format.js`.

### Structure Rationale
- **`select.js` / `format.js` are React-free on purpose** — they are the bulk of the test coverage (fast `node:test`, no ink, no terminal). This is the project's DI-for-testability invariant applied directly.
- **`SessionTable.js` extraction is optional** — the milestone ARCHITECTURE.md sketched `components/{Header,Table,Row,...}.js`, but for 5 fixed columns and ~5-10 rows, a single `SessionTable` (or even inline in `App.js`) is "lo más simple". Planner decides; do not over-decompose.
- **`App.js` owns all state** — `selectedTaskId`, `query`, `mode`, plus the existing Phase 35 connection state. Hooks (`useSelection`/`useFilter`) are optional sugar (Discretion); the state itself is small enough to live in `App` directly.

### Pattern 1: Hand-rolled fixed-width columnar table (D-01, D-02, TUI-07)
**What:** A `<Box flexDirection="column">` list; each row a `<Box flexDirection="row">` with one `<Text>` per cell. Each cell is wrapped in a fixed-`width` `<Box>` (or the `<Text>` is right-padded with `padEnd`), and long values truncate via `<Text wrap="truncate-end">` (native ellipsis) or pre-truncated by `rowCells`.
**When to use:** Always — this is the table (D-01 forbids `ink-table` and `formatTable`).
**Example:**
```js
// src/cli/dashboard/SessionTable.js — ink, color ONLY via <Text color>
// @ts-check
import { Box, Text } from 'ink';
import { createElement as h } from 'react';

// Fixed column widths (D-02; exact values are Claude's Discretion).
const COLS = { task_ref: 10, repo: 16, phasemode: 12, status: 12, age: 7 };

/** One cell: fixed width <Box>, native ellipsis truncation, optional color. */
function cell(width, text, color, dim) {
  return h(Box, { width },
    h(Text, { color, dimColor: dim, wrap: 'truncate-end' }, text));
}

function Row({ cells, selected, statusColorName, dim }) {
  // `inverse` highlights the whole selected row; per-cell color stays semantic.
  return h(Box, { flexDirection: 'row' },
    h(Box, { width: COLS.task_ref }, h(Text, { inverse: selected, wrap: 'truncate-end' }, cells.task_ref)),
    cell(COLS.repo, cells.repo),
    cell(COLS.phasemode, cells.phasemode),
    cell(COLS.status, cells.status, statusColorName, dim),   // semantic color here
    cell(COLS.age, cells.age),
  );
}
// Source pattern: ink <Box width>/<Text wrap="truncate-end"> — verified against installed ink@6.8.0 docs.
```

### Pattern 2: Selection by `task_id` identity, re-derived every render (D-05, D-06, D-07, TUI-08)
**What:** Store `selectedTaskId: string|null` in React state. Never store an index. Every render, `resolveSelection(filteredRows, selectedTaskId, prevIndex)` finds the row whose `task_id === selectedTaskId`; if absent, clamps to the previous positional index in `[0, len-1]` and returns the new `task_id` (which the caller writes back to state in an effect, or computes the displayed index purely and only updates `selectedTaskId` on a key press / when the id genuinely vanished).
**When to use:** Cursor nav (↑/↓), and as the foundation Phase 37 (`Enter`→attach) / Phase 38 (`c`/`l`) will build on.
**Critical:** `/status` rebuilds the `sessions` array every poll (`src/server.js:379` `.map()`). An index is meaningless across polls — this is the exact ROMAN-132 desync class, now in the UI. (Pitfall 1.)
**Example:**
```js
// src/cli/dashboard/select.js — pure, no React
// @ts-check
/**
 * @param {any[]} rows   already sorted+filtered
 * @param {string|null} selectedTaskId
 * @param {number} prevIndex   last known visible index (for clamp fallback, D-06)
 * @returns {{ index: number, taskId: string|null }}
 */
export function resolveSelection(rows, selectedTaskId, prevIndex = 0) {
  if (rows.length === 0) return { index: -1, taskId: null };            // empty (D-06)
  const idx = rows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, taskId: selectedTaskId };         // still present (TUI-08)
  // selected vanished → clamp to same positional index (D-06)
  const clamped = Math.max(0, Math.min(prevIndex, rows.length - 1));
  return { index: clamped, taskId: rows[clamped].task_id };
}
```

### Pattern 3: Stable sort by `started_at` with `task_id` tiebreak (D-04, TUI-09)
**What:** Sort a **copy** of the array (never mutate the poll result). Primary key `started_at`, tiebreak `task_id`, so equal timestamps never swap between polls and rows don't jump.
**Example:**
```js
// src/cli/dashboard/select.js — pure
// @ts-check
export function sortSessions(rows) {
  return [...rows].sort((a, b) => {
    const ta = new Date(a.started_at).getTime();
    const tb = new Date(b.started_at).getTime();
    if (ta !== tb) return ta - tb;                 // direction = Discretion, but FIXED
    return a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0; // deterministic tiebreak
  });
}
```
> `Array.prototype.sort` is stable in V8/Node 20+, but the explicit `task_id` tiebreak makes determinism independent of the input order (the server may emit a different array order each poll). Do not rely on sort stability alone — the tiebreak is the contract.

### Pattern 4: Semantic color decision is pure; ink applies it (D-08, D-09, TUI-10)
**What:** `statusColor(status, alive)` returns an ink color *name string* (`'green'|'red'|'cyan'|'magenta'` or a `{dim:true}` sentinel for `done`). The component passes it to `<Text color={...}>`. The zombie case (`running` + `!alive`) returns `'red'` AND a separate `zombieMarker()` returns a textual suffix so it's distinguishable without color (D-09, NO_COLOR).
**Example:**
```js
// src/cli/dashboard/format.js — pure (returns ink color NAMES, never ANSI; color-isolation safe)
// @ts-check
/** @returns {{ color?: string, dim?: boolean }} */
export function statusColor(status, alive) {
  if (status === 'running' && !alive) return { color: 'red' };       // ZOMBIE (D-08)
  if (status === 'running') return { color: 'green' };
  if (status === 'review') return { color: 'cyan' };
  if (status === 'error') return { color: 'magenta' };               // distinct from zombie red
  if (status === 'done') return { dim: true };                       // gray
  return {};
}
/** Textual marker so the zombie case survives NO_COLOR (D-09). */
export function statusLabel(status, alive) {
  return status === 'running' && !alive ? 'running (zombie)' : status;
}
```
> **Color-isolation is satisfied:** `statusColor` returns *plain strings* like `'green'` — ink turns those into ANSI internally via its own bundled `chalk`/`ansi-styles`, NOT via `picocolors`. No file under `src/cli/dashboard/` imports `picocolors`, so `test/format-isolation.test.js` stays green (verified by reading the walker at `test/format-isolation.test.js:199-220`).

### Pattern 5: Header counters + dual empty states (D-11, D-12, TUI-11)
**What:** `countByStatus(filteredRows)` returns `{ running, review, done, error, zombie }` (zombie = `running && !alive`, counted separately). The header renders the Phase 35 connection indicator (`● live` / `⚠ server caído`, reused from existing App state per D-10) followed by a compact `"3 running · 1 review · 1 zombie"` (omit zero counts). Two distinct empty states: poll-ok-but-zero → `no active sessions` (D-12a); filter-hides-all → `no sessions match` (D-12b); both *below* the keep-last-good `waiting for server` / stale banner (Phase 35, takes precedence — D-12).
**Example:**
```js
// src/cli/dashboard/select.js — pure
// @ts-check
export function countByStatus(rows) {
  const c = { running: 0, review: 0, done: 0, error: 0, zombie: 0 };
  for (const r of rows) {
    if (r.status === 'running' && r.alive === false) c.zombie++;
    else if (c[r.status] !== undefined) c[r.status]++;
  }
  return c;
}
// Render: join non-zero entries with ' · ' → "2 running · 1 zombie · 1 review"
```

### Pattern 6: Modal `/` filter with mode-gated `useInput` (D-13, D-14, D-15, D-16, TUI-12)
**What:** A `mode: 'list' | 'filter'` React state flag routes keys. In `'list'`, ↑/↓ move selection and `/` enters `'filter'`. In `'filter'`, printable chars append to `query` (live re-filter), backspace pops, `Enter` confirms (back to `'list'`, filter stays applied), `Esc` cancels (`query=''`, back to `'list'` — this is the D-15 modal-scope `Esc`, distinct from the list-mode `Esc` reserved for Phase 38). `parseFilter(query)` splits `r:`/`s:` prefixes from the global substring; `applyFilter` matches case-insensitively (AND across prefixes — recommended).
**Example:**
```js
// src/cli/dashboard/select.js — pure parse + match
// @ts-check
/** Parse "r:foo s:running bar baz" → { repo:'foo', status:'running', text:'bar baz' } */
export function parseFilter(query) {
  const out = { repo: null, status: null, text: '' };
  const words = query.trim().split(/\s+/).filter(Boolean);
  const rest = [];
  for (const w of words) {
    if (w.startsWith('r:')) out.repo = w.slice(2).toLowerCase();
    else if (w.startsWith('s:')) out.status = w.slice(2).toLowerCase();
    else rest.push(w);
  }
  out.text = rest.join(' ').toLowerCase();
  return out;
}
/** AND across active criteria; matches over derived display cells. */
export function applyFilter(rows, parsed, deriveRepo) {
  return rows.filter((r) => {
    if (parsed.repo && !deriveRepo(r).toLowerCase().includes(parsed.repo)) return false;
    if (parsed.status && r.status.toLowerCase() !== parsed.status) return false;  // exact status match
    if (parsed.text) {
      const hay = `${r.task_ref} ${deriveRepo(r)} ${r.phase_id ?? ''} ${r.gsd_mode ?? ''} ${r.summary ?? ''}`.toLowerCase();
      if (!hay.includes(parsed.text)) return false;
    }
    return true;
  });
}
```
```js
// src/cli/dashboard/App.js — useInput routing sketch (mode-gated)
useInput((input, key) => {
  if (mode === 'filter') {
    if (key.escape) { setQuery(''); setMode('list'); return; }        // D-15 cancel (modal scope)
    if (key.return) { setMode('list'); return; }                       // D-15 confirm (keep filter)
    if (key.backspace || key.delete) {
      if (query === '') { setMode('list'); return; }                   // backspace on empty exits
      setQuery((q) => q.slice(0, -1)); return;
    }
    if (input && !key.ctrl && !key.meta) setQuery((q) => q + input);   // live append (D-13)
    return;
  }
  // mode === 'list'
  if (input === 'q') { exit(); return; }
  if (input === '/') { setMode('filter'); return; }
  if (key.upArrow) { /* move derived index up, clamp, re-fix selectedTaskId */ return; }
  if (key.downArrow) { /* move derived index down, clamp, re-fix selectedTaskId */ return; }
  // key.escape: deliberately IGNORED in list mode (D-15 / Phase 34 D-11 — reserved for Phase 38)
}, { isActive: isRawModeSupported });
```

### Anti-Patterns to Avoid
- **Index-based selection** (`sessions[selectedIndex]`): wrong session after any poll reorder/removal. Use `selectedTaskId` + `resolveSelection`. (Pitfall 1.)
- **Recomputing age client-side on a 1s timer:** forces needless frames; `elapsed_min` is server-computed and only changes ~once/minute. Render `formatAge(s.elapsed_min)` straight from the payload. (Pitfall 6.)
- **`console.clear()` / manual ANSI clears:** fights ink's diffing → flicker. Let ink own the screen. (Pitfall 7.)
- **Mutating the `usePoll` result array with `.sort()`:** sort a copy (`[...rows]`). (D-04.)
- **Importing `picocolors` or `src/cli/format.js` for color:** breaks color-isolation; `test/format-isolation.test.js:199-220` fails. Color via ink `<Text color>` only. (Pitfall 8.)
- **Reusing `Esc` for "clear filter" in list mode:** collides with Phase 38's reserved `Esc`. `Esc` only acts inside the filter input (D-15).
- **Recreating row objects/keys each tick / index as React key:** defeats reconciliation, shuffles rows. Use `task_id` as the React `key`. (Pitfall 7.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal Flexbox layout + color compositing | A manual ANSI string-builder / `formatTable` | ink `<Box>`/`<Text color>` | ink already does width math, color, and diffing; manual ANSI double-encodes and breaks color-isolation. |
| Ellipsis truncation | Manual `.slice()` + width-aware `…` insertion (esp. with wide/emoji chars) | `<Text wrap="truncate-end">` inside a fixed-`width` `<Box>` | ink handles visible-width truncation natively (verified in docs). Manual slicing mishandles multi-byte/wide chars. |
| Sort stability across polls | Trusting `Array.sort` stability alone | Explicit `task_id` tiebreak in the comparator | Input order varies per poll; the tiebreak makes order independent of input. |
| Age / elapsed time | Client-side `Date.now() - started_at` recompute on a timer | `formatAge(s.elapsed_min)` from the server payload | Server already computes `elapsed_min`; client recompute = needless frames + a second source of truth. |
| Liveness (`alive`) | Calling `cmux rpc workspace.list` from the TUI | `s.alive` from `/status` | Server already merges cmux state; duplicating it adds an external dep + second source of truth. |

**Key insight:** This phase is logic-over-data, not infrastructure. The only thing genuinely worth "building" is the ~6 pure derive functions — and those are *small* precisely because ink owns layout/color/diffing and the server owns `alive`/`elapsed_min`. The one place where hand-rolling beats a library is the **single-line filter input** (`useInput` ~15 LOC vs. adding `ink-text-input`), because D-13's modal line needs only append/backspace, not cursor-positioning or paste.

## Common Pitfalls

### Pitfall 1: Index-based selection → wrong session (TUI-08)
**What goes wrong:** Cursor bound to an array index; after a poll reorders or removes a row, the highlight points at a different session. `Enter`/`c`/`l` (Phases 37/38) then act on the wrong workspace — the ROMAN-132 desync class, now in the UI.
**Why it happens:** `/status` rebuilds `sessions` every ~2.5s (`src/server.js:379`). Index is the path of least resistance and works until the list mutates (which it does by design).
**How to avoid:** Track `selectedTaskId`; re-derive index each render via `resolveSelection`; React `key={task_id}` on rows; clamp to nearest positional neighbor when the id vanishes (D-06).
**Warning signs:** Highlight jumps rows on auto-refresh with no key press; selection works at startup but breaks after a session ends.

### Pitfall 2: Rows jump on each poll from unstable order (TUI-09)
**What goes wrong:** Two sessions with equal `started_at` swap positions between polls, or sort relies on the server's emit order.
**Why it happens:** The server's array order is not guaranteed stable across requests; equal-key sorts without a tiebreak can reorder.
**How to avoid:** `sortSessions` with `started_at` primary + `task_id` tiebreak, on a copy. Fixed direction.
**Warning signs:** Rows visibly reorder every couple seconds even when nothing changed.

### Pitfall 3: Filter active while the list mutates; cursor falls out of the filtered set (TUI-12, D-16)
**What goes wrong:** With a filter applied, a poll changes the underlying list; the selected `task_id` is no longer in the filtered subset, or the subset is empty and ↑/↓ move an invisible cursor.
**Why it happens:** Filtering and selection computed independently; the invariant "selection ∈ filtered set" not re-enforced after every data/filter change.
**How to avoid:** Pipeline order is **sort → filter → resolveSelection** (resolve against the *filtered* set). If `selectedTaskId` ∉ filtered, clamp within the filtered set (D-06 mechanics, D-16). On filter *clear*, if the session reappears, the cursor returns to it automatically (because it's still tracked by `task_id`).
**Warning signs:** Highlight vanishes when typing a zero-match filter; cursor "stuck" after a filtered row ends.

### Pitfall 4: Zombie indistinguishable without color (TUI-10, D-09)
**What goes wrong:** `running`+`!alive` is only colored red; under `NO_COLOR` or a monochrome terminal it looks identical to a healthy `running`.
**Why it happens:** Relying on color as the sole signal.
**How to avoid:** `statusLabel()` adds a textual `(zombie)` marker for `running && !alive`. ink respects `NO_COLOR` automatically; the textual marker is the accessibility backstop.
**Warning signs:** A `NO_COLOR=1` render shows no difference between a zombie and a live running session.

### Pitfall 5: Empty / degraded states conflated (TUI-11, D-12)
**What goes wrong:** "Server down (keep-last-good)", "0 sessions", and "filter matched nothing" all render the same blank or the same message, confusing the operator.
**Why it happens:** A single empty branch.
**How to avoid:** Precedence: (1) keep-last-good `waiting for server` / `⚠ server caído` (Phase 35 connection state, above all); (2) connected + 0 sessions → `no active sessions`; (3) connected + N sessions but 0 match filter → `no sessions match`. Three distinct messages.
**Warning signs:** Operator can't tell "the server is down" from "you filtered everything out".

### Pitfall 6: Re-render flicker / forcing frames on age (TUI-07)
**What goes wrong:** Recomputing `age` on a client timer, or `setState` with a fresh object every poll even when data is identical, forces full repaints and flicker.
**Why it happens:** Over-updating / fighting ink's diffing.
**How to avoid:** Render `formatAge(elapsed_min)` from the payload (no timer); use stable `task_id` React keys; optionally `React.memo` rows on projected props. Let ink diff. (The Phase 35 status line already updates only on poll results — extend that discipline.)
**Warning signs:** Visible flash each poll; CPU ∝ poll rate at idle.

### Pitfall 7: `picocolors` / `format.js` leak breaks color-isolation
**What goes wrong:** A dashboard file imports `picocolors` (or `src/cli/format.js`, which imports it) to color a string → `test/format-isolation.test.js` goes red.
**Why it happens:** Reaching for the familiar classic-CLI color helper.
**How to avoid:** All color via ink `<Text color>`. The walker at `test/format-isolation.test.js:199-220` already scans `src/cli/dashboard/**` — it will catch any new file. Name the dashboard derive module something other than `format.js` to avoid confusion.
**Warning signs:** `format-isolation` test failure after adding TUI code.

## Code Examples

### deriveRepo + formatAge + phaseMode (D-03 — the field-mapping grounding)
```js
// src/cli/dashboard/format.js — pure, no React. THE D-03 mapping lives here.
// @ts-check
import { basename } from 'node:path';

/** repo column: NO `repo` field exists — derive it (D-03). */
export function deriveRepo(session) {
  return session.project_name ?? basename(session.project_path ?? '') ?? '—';
}

/** age column: humanize server-provided elapsed_min (D-03). Never recompute client-side. */
export function formatAge(elapsedMin) {
  if (elapsedMin == null || elapsedMin < 0) return '—';
  if (elapsedMin < 60) return `${elapsedMin}m`;
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;       // e.g. 63 → "1h3m", 120 → "2h"
}

/** phase/mode column: phase_id + gsd_mode, both GSD-only; non-GSD → "—" (D-03). */
export function phaseMode(session) {
  if (!session.phase_id && !session.gsd_mode) return '—';
  const parts = [];
  if (session.phase_id) parts.push(session.phase_id);          // e.g. "36"
  if (session.gsd_mode) parts.push(session.gsd_mode);          // "full" | "quick"
  return parts.join('/');                                      // e.g. "36/full"
}
```

### rowCells — project a session to display strings (consumed by SessionTable)
```js
// src/cli/dashboard/format.js — pure
// @ts-check
import { deriveRepo, formatAge, phaseMode, statusLabel } from './format.js';
export function rowCells(session) {
  return {
    task_ref: session.task_ref ?? '—',
    repo: deriveRepo(session),
    phasemode: phaseMode(session),
    status: statusLabel(session.status, session.alive),   // includes "(zombie)" when applicable
    age: formatAge(session.elapsed_min),
  };
}
```

### Hermetic render test (the project's established harness — extend, don't reinvent)
```js
// test/dashboard-table.test.js — pattern mirrors test/dashboard-render.test.js / dashboard-status-line.test.js
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

function okResponse(body) { return { ok: true, status: 200, json: async () => body }; }
const FIXTURE = {
  count: 2,
  sessions: [
    { task_id: 'a', task_ref: 'KL-1', status: 'running', alive: true,  started_at: '2026-05-27T10:00:00Z', project_name: 'kodo',  elapsed_min: 5,  phase_id: '36', gsd_mode: 'full', summary: '' },
    { task_id: 'b', task_ref: 'KL-2', status: 'running', alive: false, started_at: '2026-05-27T09:00:00Z', project_path: '/x/foo', elapsed_min: 63, summary: '' }, // zombie, non-GSD
  ],
};
// Inject fetchFn + fake clock exactly as test/dashboard-status-line.test.js:39-101 does (makeFakeClock).
// Assert lastFrame() contains the columns, the zombie textual marker, the counters, and selection highlight.
```

> **Harness facts (verified by reading the existing tests):** `ink-testing-library@4` `render()` returns `{ lastFrame, frames, stdin, rerender, unmount, cleanup }` — it does **NOT** expose `waitUntilExit()` (that's on the real `ink` `render()`). Drive arrow keys with `stdin.write('\x1b[A')` (up) / `'\x1b[B')` (down); drive the filter with `stdin.write('/')` then char writes. Use the `makeFakeClock` + `injectProps` + `drain()` helpers already in `test/dashboard-status-line.test.js` to advance the poll loop hermetically (no real timers, no network). Selection-survives-rebuild is best tested as a **pure `resolveSelection` test** (two arrays, one with the selected `task_id` removed) — far more robust than an ink frame diff.

## Runtime State Inventory

> Not applicable — this is a greenfield presentation phase (new pure helpers + render changes). No rename/refactor/migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts are touched. **Verified:** the phase adds `select.js`/`format.js`/(optional `SessionTable.js`) and modifies `App.js`; `src/server.js` is explicitly untouched (no new endpoints — hard milestone constraint).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ink-table` component | Hand-rolled `<Box>`/`<Text>` columns | `ink-table` stale since 2023-12 | No table dep; full control of color-isolation + widths. |
| `formatTable`/`formatRow` (classic CLI, picocolors) | ink `<Text color>` Flexbox | This milestone (Phase 34 color-isolation) | Two orthogonal color domains; dashboard never touches picocolors. |
| Manual ANSI ellipsis | `<Text wrap="truncate-end">` | ink native | Correct visible-width truncation, no manual slicing. |

**Deprecated/outdated:**
- `ink@7` / Node 22 floor: avoided — project pins `ink@6.8.0` to keep `engines.node >=20`.
- Client-side age timers: avoided — `elapsed_min` is server-side single-source.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Hand-rolling the `/` filter input (vs. adding `ink-text-input`) is the right call for D-13's single-line modal query | Standard Stack / Alternatives | LOW — if cursor-positioning UX is later required, add `ink-text-input` (verified-legit, same maintainer as ink). Milestone STACK called it "needed"; this research argues the D-13 simplification removes that need. **Planner should confirm.** |
| A2 | `<Text wrap="truncate-end">` inside a fixed-`width` `<Box>` truncates with `…` as expected for the dashboard's ASCII-ish content | Standard Stack / Pattern 1 | LOW — verified in ink docs; wide-char (CJK/emoji) task_refs are unlikely but would need width-aware handling. Planner may pre-truncate in `rowCells` for deterministic `lastFrame()` assertions. |
| A3 | `r:`/`s:` prefixes combine via AND (D-14 left it to the planner; this research recommends AND) | Pattern 6 / applyFilter | LOW — D-14 explicitly delegates this; AND is the recommended reading. Mutually-exclusive is a trivial variant if preferred. |
| A4 | Status counters in the header include all four statuses + zombie (D-11 left "active-only vs all" to the planner) | Pattern 5 | LOW — D-11 delegates; this research shows all-status + separate zombie. Planner may show active-only. |
| A5 | `started_at` is an ISO string parseable by `new Date()` | Pattern 3 | LOW — consistent with `src/server.js:382` (`new Date(s.started_at).getTime()`) and the SessionRecord typedef (`started_at: string`). Verified against server usage. |

**If this table feels long:** all five are LOW-risk and four of them are decisions the CONTEXT.md explicitly delegated to the planner (Claude's Discretion). A1 is the only one worth an explicit planner/user confirmation because it diverges from the milestone STACK's "ink-text-input needed" note.

## Open Questions

1. **`ink-text-input` vs. hand-rolled filter input (ties to A1).**
   - What we know: D-13 describes a single-line modal query with live append/backspace/Esc/Enter. `ink-text-input@6.0.0` is legit and would handle cursor-positioning/paste, but is not installed and not in package.json.
   - What's unclear: whether the planner/user wants in-query cursor editing (left/right within the typed text), which would tip toward the library.
   - Recommendation: hand-roll (Pattern 6). Revisit only if in-query cursor editing is a requirement. If reversed, gate the install behind `checkpoint:human-verify`.

2. **Component granularity (Claude's Discretion).**
   - What we know: ARCHITECTURE.md sketched `components/{Header,Table,Row,...}`; CONTEXT.md leaves granularity to the planner.
   - What's unclear: whether a single `SessionTable.js` (or inline in `App.js`) is "simple enough" vs. splitting Header/Row.
   - Recommendation: one `SessionTable.js` + two pure modules (`select.js`, `format.js`); avoid over-decomposition for ~5 columns / ~5-10 rows.

## Environment Availability

> Skipped — this phase has no external runtime dependencies beyond the already-installed `ink`/`react`/`ink-testing-library` and the Phase 35 data layer. The kodo server is consumed read-only via the existing `fetchStatus` (Phase 35), not invoked here. Node `>=20` (with global `fetch`) is the project floor and is already satisfied.

## Validation Architecture

> `workflow.nyquist_validation: true` in config — section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` + `ink-testing-library@4.0.0` for render |
| Config file | none (project runs `node --test $(find test -name '*.test.js')` — `package.json#scripts.test`) |
| Quick run command | `node --test test/dashboard-select.test.js test/dashboard-table.test.js` (the new files) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUI-07 | Table renders 5 columns with D-03 field mapping (derived repo, phase/mode, formatted age) | render + pure | `node --test test/dashboard-table.test.js` (lastFrame columns) + `test/dashboard-select.test.js` (rowCells/deriveRepo/formatAge/phaseMode) | ❌ Wave 0 |
| TUI-08 | Selection tracks `task_id` across reorder + clamps when row vanishes (**load-bearing**) | pure (primary) + render (secondary) | `node --test test/dashboard-select.test.js` (`resolveSelection` two-payload: removed id → clamp; reordered → follows id) | ❌ Wave 0 |
| TUI-09 | Stable sort by `started_at` + `task_id` tiebreak; no jump on equal timestamps | pure | `node --test test/dashboard-select.test.js` (`sortSessions` equal-timestamp determinism) | ❌ Wave 0 |
| TUI-10 | Color by status+alive; zombie `running`+`!alive` distinct (red) AND textual `(zombie)` marker (D-09) | pure (primary) + render | `node --test test/dashboard-select.test.js` (`statusColor`/`statusLabel`) + `test/dashboard-table.test.js` (frame contains `(zombie)`) | ❌ Wave 0 |
| TUI-11 | Header counters per status (zombie separate); `no active sessions` empty state | pure + render | `node --test test/dashboard-select.test.js` (`countByStatus`) + `test/dashboard-table.test.js` (empty → "no active sessions") | ❌ Wave 0 |
| TUI-12 | Filter `/` substring + `r:`/`s:` prefixes; **cursor preserved on apply/clear** (**load-bearing**) | pure (primary) + render | `node --test test/dashboard-select.test.js` (`parseFilter`/`applyFilter`; resolveSelection across filter apply→clear preserves `task_id`) + `test/dashboard-table.test.js` (`/` mode + Esc cancel via `stdin.write`) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard-select.test.js test/dashboard-table.test.js` (the new files, fast, no network/timers)
- **Per wave merge:** `npm test` (full suite — keeps the existing ~green Phase 34/35 + isolation tests honest)
- **Phase gate:** Full suite green before `/gsd:verify-work`. The two load-bearing pure tests (`resolveSelection` survives rebuild; cursor preserved across filter apply/clear) MUST be present and green.

### Wave 0 Gaps
- [ ] `test/dashboard-select.test.js` — pure tests for `sortSessions`, `applyFilter`, `parseFilter`, `resolveSelection` (incl. the two load-bearing cases), `countByStatus` — covers TUI-08/09/11/12
- [ ] `test/dashboard-format.test.js` (or fold into select test) — `deriveRepo`, `formatAge`, `phaseMode`, `statusColor`, `statusLabel`, `rowCells` — covers TUI-07/10 + D-03 mapping
- [ ] `test/dashboard-table.test.js` — `ink-testing-library` render: columns present, zombie marker, counters, empty states, `/` filter mode + Esc cancel (reuse `makeFakeClock`/`injectProps`/`drain` from `dashboard-status-line.test.js`)
- [ ] Framework install: none — `node:test` + `ink-testing-library` already present and exercised by existing tests

*The selection + filter-cursor load-bearing behaviors are deliberately pushed into PURE `resolveSelection` tests (no ink), per the harness note: `ink-testing-library@4` lacks `waitUntilExit()` and frame-diffing selection is brittle. The pure reducer test is the canonical, robust coverage for TUI-08 and TUI-12's cursor-preservation invariant.*

## Security Domain

> `security_enforcement` not set in config (absent) — treated as enabled. This phase has a narrow, mostly-N/A surface: it is a read-only renderer of localhost JSON the server already exposes (no auth, no secrets, no mutation, no new endpoints).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth in the TUI path (localhost read-only). |
| V3 Session Management | no | No HTTP session/cookies; `task_id` here is a domain identifier, not a security token. |
| V4 Access Control | no | No access decisions; renders whatever `/status` returns. |
| V5 Input Validation | yes (light) | Filter query is treated as a literal substring (no regex compilation) — no ReDoS/injection. `parseFilter` splits on whitespace and `r:`/`s:` literals only. |
| V6 Cryptography | no | None. |

### Known Threat Patterns for ink TUI rendering untrusted task content

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious task title / `summary` / `task_ref` containing ANSI/CSI escape sequences (could move cursor, clear screen, spoof UI) when rendered | Spoofing / Tampering | ink `<Text>` does not interpret embedded escapes as control codes by default (it treats children as literal text and does its own ANSI for styling), which neutralizes the common case. **Defense-in-depth (planner discretion):** strip known CSI/control sequences from untrusted `/status` string fields (`task_ref`, `summary`, `project_name`) in `rowCells` before display. LOW likelihood (task data originates from the operator's own provider), but cheap. |
| Regex injection via the `/` filter | Tampering / DoS | Use **plain substring** matching (`String.includes`), never `new RegExp(query)`. Pattern 6 already does this — no regex compilation of user input. |
| Leaking task content to scrollback/log files | Information Disclosure | Don't `console.log` payloads; ink owns the screen. (Already the project's discipline.) |

## Sources

### Primary (HIGH confidence)
- **Installed `ink@6.8.0`** (`node_modules/ink`) — exports verified by importing the module: `Box, Text, useApp, useInput, useStdin, Transform, measureElement, ...`. `engines.node >=20`, peer `react >=19.0.0` (`npm view ink@6.8.0`).
- **ink official docs (GitHub `vadimdemedes/ink`)** — `<Text wrap>` options (`truncate-end` etc.), `color`/`dimColor`/`inverse`/`bold`; `<Box width/minWidth/flexShrink/flexGrow>`; `useInput` key reporting (`key.upArrow/downArrow/return/escape/backspace/delete`, char in `input`).
- **kodo codebase (read directly):**
  - `src/cli/dashboard/App.js` — existing connection state (`connected`/`lastGoodCount`/`lastGoodAt`), `useInput` gated by `isRawModeSupported`, `q`→`exit()`, `Esc` deliberately unhandled, status-line body to replace.
  - `src/cli/dashboard/usePoll.js` / `client.js` — the Phase 35 data layer (`{ok,data}`, single-flight poll) consumed unchanged.
  - `src/server.js:361-413` — `/status` payload shape: `sessions` enriched with `alive` + `elapsed_min`, `count`; array `.map()`-rebuilt every request.
  - `src/session/state.js:11-30` — `Session` typedef: fields available for columns; **no `repo`** (derive), `phase_id?`/`gsd_mode?` GSD-only, `started_at: string`.
  - `test/format-isolation.test.js:199-220` — the walker that scans `src/cli/dashboard/**` for `picocolors` (the color-isolation invariant; stays green with ink color).
  - `test/dashboard-render.test.js` / `test/dashboard-status-line.test.js` — the established hermetic harness (`render` + `lastFrame()` + `makeFakeClock` + `injectProps` + `drain`); `ink-testing-library@4` has no `waitUntilExit()`.
- `.planning/research/{ARCHITECTURE,PITFALLS,STACK}.md` — milestone research (selection-by-identity, self-scheduling poll, hand-rolled table, ink@6.8.0 pin, color-isolation ruling).

### Secondary (MEDIUM confidence)
- `npm view` registry data for `ink` (latest `7.0.4`, Node 22), `ink-text-input@6.0.0` (maintainer `vdemedes`, repo `vadimdemedes/ink-text-input`, modified 2024-05-21), `ink-table@3.1.0` (modified 2023-12-06, stale).

### Tertiary (LOW confidence)
- none — every claim is backed by an installed module, a read source file, or a registry query.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages already installed/declared and exercised by green tests; versions verified against npm.
- Architecture: HIGH — patterns derived directly from existing App.js/usePoll.js + milestone ARCHITECTURE.md + verified ink API.
- Pitfalls: HIGH — carried from milestone PITFALLS.md (verified against `src/server.js`) and re-grounded to Phase 36's render scope.
- Field mapping (D-03): HIGH — verified against `src/session/state.js` typedef and `src/server.js` enrichment.

**Research date:** 2026-05-27
**Valid until:** ~2026-06-26 (stable — ink@6 line + project invariants are fixed; the only fast-moving variable is whether the team bumps to Node 22 / ink@7, which is out of scope here).
