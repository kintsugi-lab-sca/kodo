# Phase 75: Superficie del `NEXT:` — dashboard y nudge - Research

**Researched:** 2026-07-17
**Domain:** TUI ink/React dashboard (consumidor) + hook `SessionEnd` (nudge) — kodo, JS puro, cero deps
**Confidence:** HIGH (todos los hallazgos verificados por lectura directa del código en esta sesión)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Canal de datos:**
- **D-01: Lectura directa de `~/.kodo/state.json` desde la capa de datos de la TUI** — reader puro
  never-throws (DI de `readFileFn`/`kodoDir` para aislar `HOME`, espejo de `plan.js` D-08) que lee
  **un solo fichero** por tick y colapsa cualquier fallo (ausente, corrupto, sin clave `tasks`) a
  `{}`. NO enriquecer `/status`. NO endpoint nuevo en `src/server.js`.
- **D-02: Cadencia piggyback sobre el poll existente** — se engancha al tick de `usePoll` que ya
  refresca `/status`. El merge con las filas se hace por `task_id` en la capa **derive** (pura,
  React-free), nunca en el render.

**Presentación en la tabla:**
- **D-03: Columna condicional siguiendo el precedente `prog` (Phase 50 D-06)** — la columna `next`
  solo aparece cuando ≥1 fila visible tiene `NEXT:` no vacío. Fila sin `NEXT:` → celda vacía, sin
  placeholder ruidoso.
- **D-04: Truncado al ancho disponible, última posición** — el valor ya llega acotado a 200 chars
  (74 D-02); la celda trunca al ancho del terminal con ellipsis. Columna al FINAL del orden actual
  (`… → task → age → next`) como columna flexible. Ancho exacto y flex/fijo es Claude's Discretion.

**Render del plan completo (LIVE-06):**
- **D-05: Mini-renderer markdown line-based in-house, cero deps nuevas** — sustituye
  `md.split('\n')` plano de `plan.js`. Función pura React-free: mapea línea→estilo ink (headings
  bold/color, `**Label:**` bold, bullets, code fences dim). Best-effort, NO CommonMark completo.
  Color exclusivamente vía props ink `<Text>` — jamás picocolors.
- **D-06: Strip de los marcadores `<!-- kodo:handoff … -->`** — el render elimina/oculta el
  marcador HTML del heading de handoff (cumple la promesa de invisibilidad, deuda de 74 D-01). El
  strip usa el conocimiento del contrato de `src/session/handoff.js` — no una regex ad-hoc.
- **D-07: Solo el carril `readLightPlan`, misma UX de overlay** — el render aplica únicamente a la
  rama `phaseId == null` (readPlan sigue priorizando GSD — D-02 LOCKED). Misma mecánica de overlay
  que `c`/`l`/`p`: `mode:'overlay'`, snapshot congelado, read-only, `Esc` preserva cursor por
  `task_id`. Default: reutilizar el binding `p` actual (discriminar es Claude's Discretion).

**Nudge con contexto (LIVE-07):**
- **D-08: `buildStopNudgeText` gana un parámetro opcional con el `NEXT:`** — la función sigue pura
  (cero I/O); `session-end.js` (`:243-253`) le threadea el valor **persistido en `state.tasks`**
  tras el paso de handoff (`:123-128`), heredando la semántica asimétrica de `upsertTaskHandoff`
  (si esta sesión no dejó `NEXT:` pero la tarea tiene uno previo, se usa el previo). Threading sin
  I/O extra preferido. Rechazado: que `buildStopNudgeText` lea `state.json` por su cuenta.
- **D-09: Formato — línea adicional en español, textos por-modo intactos** — con `NEXT:` presente,
  una línea concreta al final del texto por-modo existente (p. ej. `Siguiente paso sugerido por la
  sesión: <next>`), conservando el switch quick/full/no-GSD de `stop.js:40` y la convención de
  escape `\\n`. Sin `NEXT:` → texto actual **byte-idéntico**.
- **D-10: El nudge con `NEXT:` aplica a TODOS los modos (quick/full/no-GSD)** — D-02 restringe el
  *pintado* en el overlay, no el nudge.

### Claude's Discretion

- Nombre/ubicación del reader de `state.tasks` (módulo nuevo en `src/cli/dashboard/` vs helper en
  `client.js`) y del mini-renderer markdown.
- Ancho exacto y comportamiento flex/fijo de la columna `next`; abreviación del header.
- Redacción literal de la línea del nudge (ES, una línea, textos sin `NEXT:` byte-idénticos).
- Mecanismo de threading del `NEXT:` dentro de `runSessionEndHook` (valor en memoria vs return del
  writer) — con preferencia por cero I/O extra.
- Estructura de tests (fixtures, aislamiento de HOME vía `kodoPlansDir`/`homedirFn`).

### Deferred Ideas (OUT OF SCOPE)

- **Servir `state.tasks` vía `/status` para dashboards remotos** — limitación multi-nodo aceptada;
  cambio de payload de otro milestone.
- **Scroll/paginación del overlay de plan** — ligado a la poda diferida a v0.18 (M21).
- **Render markdown para los overlays `c`/`l` o el plan GSD** — el mini-renderer nace para el
  carril light-plan; generalizarlo es fuera de scope (D-02 LOCKED para GSD).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIVE-05 | El usuario ve el `NEXT:` por tarea en la lista del dashboard sin que la TUI abra N ficheros de plan | Reader leaf `state.json` (§Pattern 1) + enrich derive por `task_id` (§Pattern 2) + columna condicional `next` espejo de `prog` (§Pattern 3). Cero endpoint, cero apertura de planes. |
| LIVE-06 | El usuario abre el markdown completo del plan renderizado (no editable) en la rama `phaseId == null` | Mini-renderer line-based (§Pattern 4) gated al carril light-plan (§Pitfall 3) + strip del marcador vía helper exportado de `handoff.js` (§Pattern 5). Overlay `p` existente reusa `mode:'overlay'` snapshot congelado. |
| LIVE-07 | Con un `NEXT:` presente, el nudge del orquestador lo usa como contexto en vez del genérico | `buildStopNudgeText(session, next?)` (§Pattern 6) + threading del valor persistido devuelto por `writeHandoff`/`upsertTaskHandoff` (§Pattern 7, §Pitfall 5). |
</phase_requirements>

## Summary

Esta fase es **100% código interno de kodo** — cero dependencias npm nuevas, cero endpoints, cero
migraciones de datos. Los tres requirements son consumidores del dato que la Phase 74 (cerrada) ya
produce en `~/.kodo/plans/<task_id>.md` (bloques de handoff) y en `state.tasks[task_id] = {
plan_path, next, updated_at }`. Todo el trabajo es cablear ese dato ya existente a tres superficies:
la tabla del dashboard (LIVE-05), el overlay de plan renderizado del carril no-GSD (LIVE-06) y el
nudge del orquestador (LIVE-07).

El codebase tiene **precedentes exactos** para cada pieza, verificados en esta sesión: la columna
condicional `prog` (Phase 50 D-06) es el molde literal de la columna `next` (D-03); el reader
síncrono never-throws `readLightPlan`/`readGsdProgress` (leaf que solo importa `node:fs`/`node:path`/
`node:os`) es el molde del reader de `state.json` (D-01); el enrich client-side del progreso vivo
(App.js `:730`, lectura filesystem síncrona en el render sin await ni server) es el molde del
piggyback por tick (D-02); `handoff.js` es la hoja pura de cero imports diseñada explícitamente para
ser importada desde el dashboard (D-06). El riesgo real de la fase no es técnico sino de
**no-regresión**: SC#3 exige que las filas GSD abran su overlay byte-idéntico a hoy, y SC#5 exige
degradación limpia sin ruido en cinco caminos de dato ausente.

**Primary recommendation:** Replicar tres patrones ya probados del propio codebase —
`readLightPlan` para el reader de `state.json`, el enrich de `progress.js` para el merge por tick,
y la columna condicional `prog` para la celda `next`— añadiendo un helper `stripHandoffMarker`
exportado desde `handoff.js` (mantiene la hoja como dueño único del contrato) y devolviendo el
`next` persistido desde `writeHandoff` para threadearlo al nudge sin I/O extra. **No reutilizar
`loadState()`** — escribe en disco al migrar (§Pitfall 1, crítico).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Leer `state.tasks` del disco local | TUI data-layer (leaf `node:fs`) | — | D-01: la TUI ya lee el filesystem local directamente (`plan.js`, `progress.js`); el server no sirve `state.tasks` (`/status` = `listSessions()`, `server.js:589`). |
| Merge `next` por `task_id` con las filas | TUI derive (puro, React-free) | — | D-02: el merge vive en la capa derive testeable, no en el render (espejo del enrich de `progress`). |
| Decidir visibilidad de la columna `next` | TUI derive (`deriveAnyNext`) | — | D-03: flag estructural sobre el set SIN filtrar (espejo `deriveAnyGsd`/`deriveAnyProgress`). |
| Render markdown del plan | TUI presentación (ink `<Text>`) | Contrato de formato (`handoff.js`) | D-05/D-06: color solo ink; el strip del marcador delega en el dueño del formato. |
| Extraer/strippear el marcador de handoff | `src/session/handoff.js` (hoja pura) | — | D-06/D-13: un solo módulo dueño del contrato; no regex ad-hoc divergente. |
| Threadear el `NEXT:` al nudge | Hook `SessionEnd` (I/O + orquestación) | Función pura `buildStopNudgeText` | D-08: la función sigue pura; el hook le pasa el valor persistido. |

## Standard Stack

### Core

Cero librerías nuevas. Los módulos internos que se tocan o reutilizan:

| Módulo | Rol en esta fase | Por qué es el estándar |
|--------|------------------|------------------------|
| `src/cli/dashboard/plan.js` | `readLightPlan` (`:65`) es el carril de LIVE-06; su forma es el molde del reader D-01 | Leaf never-throws con DI `kodoPlansDir`/`homedirFn`, ya probado (Phase 44/46) |
| `src/cli/dashboard/progress.js` | Molde del enrich por tick (D-02) y del reader síncrono never-throws | `readGsdProgress` es el precedente exacto de lectura filesystem en el render sin await/server |
| `src/cli/dashboard/select.js` | Aloja `deriveAnyGsd`/`deriveAnyProgress`; se añade `deriveAnyNext` | Derive puro React-free, testeable sin ink |
| `src/cli/dashboard/format.js` | Aloja `progCell`/`taskCell`; se añade `nextCell` | Presentación pura `{text, dim}`, color-isolation garantizada |
| `src/cli/dashboard/SessionTable.js` | `COLS` (`:95`) + columna condicional; se añade `next` al final | Precedente literal de columna condicional `prog` |
| `src/session/handoff.js` | Se añade `stripHandoffMarker` exportado (D-06) | Hoja pura de cero imports, dueño único del contrato del marcador (D-13) |
| `src/hooks/stop.js` | `buildStopNudgeText` (`:40`) gana param opcional (D-08/D-09/D-10) | Función pura testeable, switch por-modo ES |
| `src/hooks/session-end.js` | `writeHandoff` (`:289`) devuelve el `next`; el bloque nudge (`:245`) lo threadea | Punto único donde el `NEXT:` está en memoria tras el handoff |
| `src/session/state.js` | `upsertTaskHandoff` (`:416`) devuelve el entry persistido (para la asimetría D-08) | Único escritor de `state.tasks`, ya bajo `withStateLock` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reader leaf nuevo de `state.json` | `loadState()` de `state.js` | **RECHAZADO** — `loadState` llama `migrateStateIfNeeded()` que ESCRIBE (migración + `.bak`) en un tick de lectura (§Pitfall 1). Además fija `STATE_PATH` en module-load sin DI de HOME. |
| Mini-renderer in-house | `marked` / `ink-markdown` | **RECHAZADO por D-05** — viola «cero deps npm nuevas» (invariante cross-milestone). |
| Threading del `next` devuelto por el writer | Relectura de `state.json` en el nudge | **RECHAZADO por D-08** — I/O extra innecesario; el valor ya está en memoria tras el upsert. |
| Strip con regex ad-hoc en el renderer | Helper `stripHandoffMarker` en `handoff.js` | **RECHAZADO por D-06/D-13** — divergiría del contrato; el marcador tiene un solo dueño. |

**Installation:** N/A — cero paquetes. Verificación de invariante:

```bash
# Confirma que NO se añadió ninguna dependencia
git diff --stat package.json package-lock.json   # debe estar vacío tras la fase
```

## Package Legitimacy Audit

**N/A — esta fase NO instala ningún paquete externo.** Invariante cross-milestone «Cero
dependencias npm nuevas» (STATE.md §Critical Invariants; REQUIREMENTS.md §Constraints). Todo el
código usa builtins de Node (`node:fs`, `node:path`, `node:os`) y módulos internos del repo. El
mini-renderer (D-05) es explícitamente in-house para NO añadir `marked`/`ink-markdown`.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
  PRODUCTOR (Phase 74 — leer, no tocar)
  ────────────────────────────────────
  SessionEnd hook ──writeHandoff()──► ~/.kodo/plans/<task_id>.md  (bloques ## Handoff + marcador)
                  └─upsertTaskHandoff─► ~/.kodo/state.json  state.tasks[task_id]={plan_path,next,updated_at}
                                                    │
        ┌───────────────────────────────────────────┼───────────────────────────────────┐
        │ LIVE-05 (tabla)                            │ LIVE-06 (overlay)                  │ LIVE-07 (nudge)
        ▼                                            ▼                                    ▼
  usePoll tick ──► readTasks(deps)             tecla 'p' ──► readPlan(row)          writeHandoff() devuelve
  (piggyback)      [leaf node:fs,               (phaseId==null)                     el `next` persistido
        │          never-throws, {}]                 │                                    │
        ▼                                            ▼                                    ▼
  enrich derive: row.next =                    readLightPlan → lines              buildStopNudgeText(session, next?)
  tasks[row.task_id]?.next                          │                             (D-09: +1 línea ES si next;
        │ (merge por task_id, puro)                 ▼                              byte-idéntico si no)
        ▼                                     mini-renderer line→ink                     │
  deriveAnyNext(enriched) ──► anyNext         + stripHandoffMarker (D-06)                ▼
        │                                          │                             cmux.send(orchestrator, texto)
        ▼                                          ▼
  SessionTable: columna `next` condicional   renderOverlay (render='markdown'
  al final, truncate, celda vacía si !next   solo carril light; GSD='plain' byte-idéntico)
```

Trazado del caso primario (LIVE-05): el poll ya corre para `/status`; en el MISMO tick el reader
leaf abre `state.json` una vez, el enrich mergea `next` por `task_id`, `deriveAnyNext` decide si la
columna aparece, y `SessionTable` pinta la celda (vacía si no hay dato). Nada abre ficheros de plan
para pintar la tabla; nada toca `server.js`.

### Recommended Project Structure

```
src/cli/dashboard/
├── tasks.js         # NUEVO — reader leaf de state.tasks (D-01). Molde: plan.js:65 readLightPlan
├── plan.js          # readLightPlan intacto; el render se aplica en la capa overlay, no aquí
├── markdown.js      # NUEVO (opcional) — mini-renderer line→ink (D-05). Alt: dentro de SessionTable.js
├── select.js        # + deriveAnyNext (espejo deriveAnyGsd/deriveAnyProgress)
├── format.js        # + nextCell (espejo progCell/taskCell)
├── SessionTable.js  # COLS += next; columna condicional; renderOverlay usa el mini-renderer
└── App.js           # enrich += row.next; anyNext; thread props a SessionTable
src/session/
└── handoff.js       # + stripHandoffMarker exportado (hoja pura, cero imports — D-13)
src/hooks/
├── stop.js          # buildStopNudgeText(session, next?)
└── session-end.js   # writeHandoff devuelve next; bloque nudge lo threadea
```

### Pattern 1: Reader leaf de `state.tasks` (D-01) — molde `readLightPlan`

**What:** Función pura síncrona never-throws que lee `~/.kodo/state.json` UNA vez y devuelve
`state.tasks || {}`, colapsando cualquier fallo a `{}`.
**When to use:** Un lookup por tick de poll (D-02).
**Example:**
```javascript
// Source: molde verificado de src/cli/dashboard/plan.js:65-78 (readLightPlan)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @param {{ readFileFn?: (p:string)=>string, kodoDir?: string, homedirFn?: ()=>string }} [deps]
 * @returns {Record<string, { plan_path: string, next: string|null, updated_at: string }>}
 */
export function readTasks(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    // Guard defensivo idéntico al documentado en state.js:61 (`state.tasks || {}`).
    return state && typeof state.tasks === 'object' && state.tasks !== null ? state.tasks : {};
  } catch {
    // ENOENT / JSON corrupto / sin clave → {} (celdas vacías, cero ruido — SC#5).
    return {};
  }
}
```
**Nota crítica:** NO importar `loadState` de `state.js` (§Pitfall 1). El reader NO ejecuta
`migrateStateIfNeeded` (que escribe). Es lectura pura.

### Pattern 2: Enrich por tick, merge por `task_id` (D-02) — molde `progress`

**What:** En el pipeline de derivación de App.js, tras `sortSessions`, mergear `next` en cada fila
leyendo `readTasks()` una vez por render (no por fila).
**When to use:** Piggyback sobre el tick de `usePoll` (no un segundo loop ni watcher).
**Example:**
```javascript
// Source: molde verificado de src/cli/dashboard/App.js:729-776 (enrich de progress)
const tasks = readTasks({}); // UNA lectura por render/tick; never-throws → {}
const enriched = sorted.map((rawRow) => {
  const row = { ...rawRow, /* stripControlChars ya aplicado, ver App.js:737 */ };
  const entry = row.task_id ? tasks[row.task_id] : undefined;
  // next del dato de la TAREA (no de la sesión). Ausente → undefined → celda vacía.
  return { ...row, next: entry?.next ?? null };
});
```
**Precedente:** el enrich de `progress` ya hace exactamente esto (lectura filesystem síncrona en el
cuerpo del render, sin await, sin server), App.js `:730`.

### Pattern 3: Columna condicional `next` (D-03/D-04) — molde `prog` (Phase 50 D-06)

**What:** La columna solo se emite si `anyNext === true` (≥1 fila con `next` no vacío en el set SIN
filtrar); si no, se omite el elemento y ink recupera el ancho vía flex.
**Example:**
```javascript
// select.js — espejo LITERAL de deriveAnyProgress (select.js:241)
export function deriveAnyNext(rows) {
  return rows.some((r) => typeof r.next === 'string' && r.next.length > 0);
}

// format.js — espejo de progCell/taskCell (format.js:240). Celda vacía si no hay next.
export function nextCell(session) {
  const n = session.next;
  return typeof n === 'string' && n.length > 0 ? n : '';
}

// App.js — computar sobre `enriched` (SIN filtrar), NO sobre `filtered` (Pitfall 4 de Phase 44/50)
const anyNext = deriveAnyNext(enriched);

// SessionTable.js — COLS y header/celda condicionales, al FINAL (D-04, tras age)
const COLS = { /* … */, age: 7, next: 40 /* flex/ancho = Claude's Discretion */ };
// cabecera (dentro de columnHeader):
...(anyNext ? [h(Box, { width: COLS.next }, h(Text, { dimColor: true }, 'next'))] : []),
// celda de datos (dentro de dataRows.map), truncate:true → ellipsis nativo `…` (D-04):
...(anyNext ? [cell({ width: COLS.next, text: cells.next, bold: selected, truncate: true })] : []),
```
**Nota de orden:** el orden actual de columnas es `gutter, state, task_ref, repo, [phasemode],
status, [prog], task, age`. `next` va DESPUÉS de `age` (última posición, D-04).

### Pattern 4: Mini-renderer markdown line-based (D-05)

**What:** Función pura React-free que mapea cada línea del markdown a un `<Text>` de ink con estilo
best-effort (headings bold/color, `**Label:**` bold, bullets, code fences dim). NO CommonMark.
**When to use:** Solo el carril light-plan (`phaseId == null`), NO GSD (§Pitfall 3).
**Example:**
```javascript
// Color SOLO vía props ink (D-05/color-isolation). Cero picocolors, cero ANSI inline.
import { Text } from 'ink';
import { createElement as h } from 'react';
import { stripHandoffMarker } from '../../session/handoff.js'; // D-06 (helper nuevo)

/** @param {string} line @param {number} key @returns {import('react').ReactElement} */
function renderMarkdownLine(line, key, inFence) {
  if (inFence) return h(Text, { key, dimColor: true }, line);           // code fence → dim
  if (line.startsWith('## ') || line.startsWith('# '))
    return h(Text, { key, bold: true, color: 'cyan' }, stripHandoffMarker(line)); // D-06
  if (line.startsWith('**') )  return h(Text, { key, bold: true }, line);         // **Label:**
  if (line.startsWith('- ') || line.startsWith('* '))
    return h(Text, { key }, line);                                       // bullet (best-effort)
  return h(Text, { key }, line);
}
// Nota: el toggle de `inFence` (líneas ```) se lleva en el map con un acumulador local.
```
**Recomendación de integración:** mantener `readLightPlan` devolviendo `lines` crudas (contrato de
status intacto) y aplicar el render en la capa `renderOverlay` de `SessionTable.js`, gated por un
discriminante `render:'markdown'` que `readPlan` fija SOLO en la rama light (§Pitfall 3).

### Pattern 5: `stripHandoffMarker` en `handoff.js` (D-06) — dueño único del contrato

**What:** Helper puro exportado que elimina el comentario HTML `<!-- kodo:handoff … -->` de una
línea, usando `indexOf`/`slice` (cero regex, cero imports — preserva la hoja).
**Why here:** los constantes `MARKER_OPEN`/`MARKER_CLOSE` son privados del módulo hoy; D-06/D-13
exigen que el marcador tenga un solo dueño. Añadir el helper AQUÍ evita duplicar el formato en el
dashboard.
**Example:**
```javascript
// src/session/handoff.js — junto a los MARKER_OPEN/MARKER_CLOSE existentes (:30-32).
// Hoja pura: sin regex (anti-ReDoS T-74-09), sin imports (guard test/check-isolation.test.js).
export function stripHandoffMarker(line) {
  if (typeof line !== 'string') return '';
  const open = line.indexOf(MARKER_OPEN);
  if (open === -1) return line;
  const rest = line.slice(open + MARKER_OPEN.length);
  const close = rest.indexOf(MARKER_CLOSE);
  if (close === -1) return line; // marcador sin cerrar → no se toca (conservador)
  const after = rest.slice(close + MARKER_CLOSE.length);
  return (line.slice(0, open) + after).trimEnd();
}
```
**Guard:** `test/check-isolation.test.js` verifica que `handoff.js` conserva CERO imports — el
helper debe seguir siendo string-only.

### Pattern 6/7: Nudge con contexto (D-08/D-09/D-10) + threading del valor persistido

**What:** `buildStopNudgeText` gana un 2º parámetro opcional; `writeHandoff` devuelve el `next`
persistido para threadearlo sin I/O extra.
**Example:**
```javascript
// stop.js — param opcional; byte-idéntico cuando next es falsy (D-09). Aplica a los 3 modos (D-10).
export function buildStopNudgeText(session, next) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  let text;
  switch (getSessionMode(session)) {
    case 'quick': text = `${base} Es una sesión GSD quick …\\n`; break;
    case 'full':  { const p = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
                    text = `${base} Es una sesión GSD (${p}). Ejecuta \`kodo gsd verify ${session.session_id}\` …\\n`; break; }
    default:      text = `${base} Revisa el resultado y decide …\\n`;
  }
  // D-09: SOLO añade la línea si hay next (si no → text queda byte-idéntico al actual).
  if (typeof next === 'string' && next.length > 0) {
    text += `Siguiente paso sugerido por la sesión: ${next}\\n`;
  }
  return text;
}
```
```javascript
// session-end.js — capturar el next devuelto por writeHandoff y threadearlo al nudge (:245-253).
let handoffNext = null;
try { handoffNext = writeHandoff({ session, input, log }, deps)?.next ?? null; }
catch (err) { console.error(`[kodo:session-end] Handoff error: ${err.message}`); }
// … más abajo, en el bloque «3. Nudge al orquestador»:
await cmuxClient.send({ workspace: orchMatch[1], text: buildStopNudgeText(session, handoffNext) });
```
**Semántica asimétrica (§Pitfall 5):** para que el nudge honre «si esta sesión no dejó NEXT pero la
tarea tiene uno previo, usa el previo», `writeHandoff` debe devolver el valor **post-upsert**, no
`r.value.next` (que es solo el de ESTA sesión, `null` en cierre mecánico). Ver §Pitfall 5.

### Anti-Patterns to Avoid

- **Importar `loadState()` en el dashboard:** escribe en disco al migrar (§Pitfall 1). Usar reader
  leaf propio.
- **Merge por `task_id` en el render en vez de en derive:** rompe D-02 (merge puro, testeable). El
  render solo pinta.
- **Aplicar el mini-renderer al plan GSD:** rompe SC#3 / D-02 LOCKED. Gated a `phaseId == null`.
- **`deriveAnyNext` sobre `filtered`:** la columna parpadearía al teclear una query `/` (Pitfall 4
  documentado en Phase 44/50). Computar sobre `enriched` sin filtrar.
- **Regex ad-hoc para el marcador en el dashboard:** rompe D-06/D-13. Usar `stripHandoffMarker`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leer `state.json` never-throws | Un reader con try/catch ad-hoc divergente | Copiar la forma de `readLightPlan` (plan.js:65) con DI HOME | Ya resuelve ENOENT/corrupto/HOME-isolation; consistencia de contrato |
| Parsear/strippear el marcador | Regex `/<!-- kodo:handoff.*?-->/` en el renderer | `stripHandoffMarker` en `handoff.js` | El marcador tiene un solo dueño (D-13); regex es vector ReDoS (T-74-09) |
| Columna condicional en la tabla | Aritmética de anchos manual | Patrón `anyGsd`/`anyProgress` (omitir elemento → flex de ink) | Ink recupera el ancho solo; sin cálculo de columnas |
| Truncado de la celda | Slice manual + `…` | `cell({ truncate: true })` (SessionTable.js:111) | `wrap:'truncate-end'` nativo de ink produce el ellipsis |
| Render markdown | `marked` / `ink-markdown` | Mini-renderer line-based in-house (D-05) | Cero deps npm nuevas (invariante) |

**Key insight:** cada pieza de esta fase tiene un gemelo ya en producción en el mismo directorio.
El trabajo es replicar patrones probados, no inventar. El único código genuinamente nuevo es el
mini-renderer (D-05) y el helper `stripHandoffMarker` (D-06) — ambos triviales y puros.

## Common Pitfalls

### Pitfall 1: `loadState()` escribe en disco — nunca usarlo como reader del poll
**What goes wrong:** Reutilizar `loadState()` de `state.js` para leer `state.tasks` haría que CADA
tick de poll pueda disparar `migrateStateIfNeeded()`, que reescribe `state.json` y crea backups
`.bak.<ts>` (state.js:257).
**Why it happens:** `loadState()` (state.js:262) llama `migrateStateIfNeeded()` en su primera línea
antes de leer. Es un cargador con efectos, no un lector puro.
**How to avoid:** Reader leaf propio (Pattern 1) que hace `readFileSync` + `JSON.parse` + `state.tasks
|| {}`, sin migración. Además, `state.js` importa `KODO_DIR` de `config.js`, fijando `STATE_PATH`
en module-load sin DI de HOME (los tests no podrían aislar).
**Warning signs:** aparición de ficheros `state.json.bak.*` durante `npm test`; escrituras a disco
en un flujo teóricamente de solo lectura.

### Pitfall 2: `MARKER_OPEN`/`MARKER_CLOSE` no están exportados hoy
**What goes wrong:** El renderer necesita el conocimiento del marcador, pero `handoff.js` solo
exporta funciones (`findSessionBlock`, `extractNext`, …), no los constantes del marcador.
**Why it happens:** El módulo se diseñó como parser de bloques, no como proveedor de constantes.
**How to avoid:** Añadir el helper `stripHandoffMarker` EXPORTADO en `handoff.js` (Pattern 5) — no
exportar los constantes crudos (encapsula el formato). Mantener cero imports (guard
`test/check-isolation.test.js`).
**Warning signs:** el planner intenta `import { MARKER_OPEN }` y no existe; o duplica el literal
`<!-- kodo:handoff` en el dashboard.

### Pitfall 3: El render markdown NO debe tocar la rama GSD (SC#3 / D-02 LOCKED)
**What goes wrong:** `renderOverlay` (SessionTable.js:177) es compartido por comments/logs/plan
(GSD y light). Aplicar el mini-renderer a todo el `kind:'plan'` rompería el overlay GSD, que debe
quedar byte-idéntico (SC#3, test de no-regresión explícito).
**Why it happens:** El snapshot lleva `kind:'plan'` tanto para GSD como para light; `readPlan`
elige la rama internamente pero el resultado no distingue hoy.
**How to avoid:** `readPlan` debe fijar un discriminante en su resultado (p. ej. `render:'markdown'`
solo cuando entró por `readLightPlan`; `render:'plain'` para GSD). App threadea ese flag al
snapshot; `renderOverlay` aplica el mini-renderer SOLO si `render === 'markdown'`. La rama GSD sigue
pintando `<Text>` plano exactamente como hoy.
**Warning signs:** un test de overlay GSD cambia de bytes; el handoff aparece con estilo en una
fila GSD (no debería surface en esa rama — REQUIREMENTS §Out of Scope).

### Pitfall 4: `deriveAnyNext` sobre el set filtrado hace parpadear la columna
**What goes wrong:** Si se computa `anyNext` sobre `filtered`, teclear una query `/` que oculta las
filas con `next` haría desaparecer la columna a medio tecleo.
**Why it happens:** El filtro es dinámico por render; la visibilidad de columna es estructural.
**How to avoid:** Computar `anyNext` sobre `enriched` (sin filtrar), exactamente como `anyGsd`
(App.js:780) y `anyProgress` (App.js:783). Documentado en select.js:209-212 y :232-236.
**Warning signs:** la columna `next` aparece/desaparece al escribir en el filtro.

### Pitfall 5: Threadear `r.value.next` naïf rompe la asimetría del nudge (D-08)
**What goes wrong:** `writeHandoff` calcula internamente `r.value.next` = el `NEXT:` de ESTA sesión,
que es `null` en un cierre mecánico (backstop LIVE-03). Threadear ese valor al nudge daría un nudge
genérico aunque la TAREA tenga un `NEXT:` real de una sesión anterior — contradiciendo D-08 («el
dato es de la tarea, no de la sesión»).
**Why it happens:** `upsertTaskHandoff` aplica la asimetría (`entry.next ?? prev.next ?? null`,
state.js:443) DENTRO del mutator; el valor efectivo persistido no sale hoy (retorna `value: void`).
**How to avoid:** Hacer que `upsertTaskHandoff` devuelva el entry persistido (`value: { plan_path,
next, updated_at }` — el objeto que ya construye en `state.tasks[taskId]`), y que `writeHandoff`
propague ese `next` efectivo. Cero I/O extra (el mutator ya lo tiene en memoria bajo el lock). Es la
opción con «preferencia por cero I/O extra» de D-08.
**Warning signs:** un cierre mecánico tras una sesión con `NEXT:` real produce nudge genérico; el
test de asimetría (previo preservado) falla para el nudge.

### Pitfall 6: `next` truncado a 200 en `state.json` pero la celda trunca al ancho del terminal
**What goes wrong:** Asumir que el valor de la celda ya cabe. Llega acotado a 200 (74 D-02), pero
200 chars desbordarían una columna de terminal.
**How to avoid:** `cell({ truncate: true })` (ellipsis nativo). D-04 lo especifica: doble acotado
(200 en el dato + ancho de columna en la celda).
**Warning signs:** la tabla se desborda a varias líneas cuando un `NEXT:` es largo.

## Runtime State Inventory

**N/A — esta fase NO es rename/refactor/migración.** Es una fase de features consumidoras. No
renombra strings, no toca claves de datastores, no migra registros. Todo el dato que consume ya lo
escribió la Phase 74. No hay estado runtime que reconciliar.

- **Stored data:** None — se LEE `state.tasks` y `~/.kodo/plans/*.md` (producidos por 74), no se
  escribe ni migra ningún dato nuevo. `upsertTaskHandoff` cambia su *return* (no el shape en disco).
- **Live service config:** None — cero endpoints, cero config de servicio.
- **OS-registered state:** None.
- **Secrets/env vars:** None.
- **Build artifacts:** None — cero deps, cero compilación.

## Code Examples

Ver §Architecture Patterns (Pattern 1-7) — todos verificados contra el código real en esta sesión.
Las fuentes exactas:

### Reader síncrono never-throws con DI de HOME
```javascript
// Source: src/cli/dashboard/plan.js:65-78 (readLightPlan) — molde literal del reader D-01
const plansDir = deps.kodoPlansDir || join((deps.homedirFn || homedir)(), '.kodo', 'plans');
try { const md = readFileFn(join(plansDir, `${taskId}.md`)); return { status: 'ok', lines: md.split('\n') }; }
catch (err) { const code = err?.code; if (code === 'ENOENT') return { status: 'no-light-plan', lines: [] }; return { status: 'error', lines: [] }; }
```

### Columna condicional (header + celda) recuperando ancho vía flex
```javascript
// Source: src/cli/dashboard/SessionTable.js:996 (header prog) y :1051 (celda prog)
...(anyProgress ? [h(Box, { width: COLS.prog }, h(Text, { dimColor: true }, 'prog'))] : []),
...(anyProgress ? [cell({ width: COLS.prog, text: cells.prog.text, dim: cells.prog.dim, bold: selected, truncate: true })] : []),
```

### Asimetría del upsert (el valor que debe devolverse para el nudge)
```javascript
// Source: src/session/state.js:443 — el valor efectivo persistido honra el previo
next: entry.next ?? (prev ? prev.next : null) ?? null,
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overlay de plan pinta `md.split('\n')` plano | Mini-renderer line→ink (D-05) SOLO carril light | Esta fase | Plan no-GSD legible; GSD intacto (SC#3) |
| Marcador `<!-- kodo:handoff -->` visible en crudo | Strippeado en el render (D-06) | Esta fase | Cumple la promesa de invisibilidad (deuda 74 D-01) |
| Nudge genérico por-modo | Nudge + línea `NEXT:` cuando existe (D-07..D-10) | Esta fase | Orquestador recibe contexto concreto |
| `state.tasks` no viaja a la TUI | Reader leaf directo de `state.json` (D-01) | Esta fase | LIVE-05 sin endpoint nuevo |

**Deprecated/outdated:** nada se deprecia. El nudge genérico anterior (`buildStopNudgeText` sin
2º param) queda como el camino byte-idéntico cuando no hay `NEXT:` (D-09).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El planner puede añadir un discriminante `render` al resultado de `readPlan`/al snapshot sin romper otros consumidores del overlay (comments/logs comparten `renderOverlay`) | Pitfall 3 / Pattern 4 | Bajo — es aditivo; si se implementa mal, un test de overlay GSD lo caza (SC#3). Verificar que `renderOverlay` no rompe los kinds no-plan. |
| A2 | Cambiar el `return` de `upsertTaskHandoff` de `value: void` a `value: {entry}` no rompe a otros callers | Pitfall 5 / Pattern 7 | Bajo — solo `writeHandoff` (session-end.js:379) lo consume hoy y descarta el value. Verificar con grep de `upsertTaskHandoff(` antes de cambiar. |
| A3 | El mini-renderer best-effort (headings/labels/bullets/fences) es suficiente para el UAT de LIVE-06 — no se exige tabla/link/nested rendering | Pattern 4 | Medio — D-05 dice explícitamente «best-effort, NO CommonMark completo», pero el UAT humano podría pedir más. Confirmar alcance del render con el operador si el UAT lo cuestiona. |

**Nota:** A1 y A2 son decisiones de implementación de bajo riesgo verificables con los tests
existentes. A3 es la única con posible fricción de UAT — el alcance del render es Claude's
Discretion dentro de «line-based best-effort».

## Open Questions

1. **¿El discriminante GSD-vs-light para el render vive en `readPlan` o en el handler `p` de App.js?**
   - What we know: `readPlan` (plan.js:91) es el único punto que sabe qué rama tomó (phaseId
     resuelto → GSD; `null` → `readLightPlan`). El handler `p` (App.js:1818) llama `readPlan` y
     construye el snapshot.
   - What's unclear: si es más limpio que `readPlan` devuelva `render:'markdown'|'plain'` en su
     resultado, o que App.js lo derive de si `row.phase_id == null`.
   - Recommendation: que `readPlan` lo devuelva (single point of decision, coherente con su rol de
     dueño de la lógica GSD-priority D-02). App threadea el flag al snapshot verbatim.

2. **¿El mini-renderer vive en un módulo propio (`markdown.js`) o dentro de `SessionTable.js`?**
   - What we know: `renderOverlay` ya vive en `SessionTable.js`; el resto de renders (adopt,
     config, projects) también.
   - What's unclear: separarlo facilita testearlo puro sin ink-render.
   - Recommendation: módulo propio `markdown.js` que exporta una función `(lines) → ReactElement[]`
     — testeable con snapshot de elementos, y mantiene `SessionTable.js` más ligero. Claude's
     Discretion (D-05 lo permite explícitamente).

## Environment Availability

**SKIPPED (Step 2.6):** esta fase es cambios de código puros — cero tools/servicios/runtimes
externos más allá de Node (ya presente, el proyecto corre) y el test runner `node --test` (builtin).
No hay dependencias que probar.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin) + `node:assert/strict` |
| Config file | none — script `"test": "node --test $(find test -name '*.test.js' -type f)"` en package.json:10 |
| Quick run command | `node --test test/dashboard-plan.test.js` (o el fichero relevante) |
| Full suite command | `npm test` (~2000+ tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-05 | `readTasks` never-throws → `{}` en ausente/corrupto/sin-tasks | unit | `node --test test/dashboard-tasks.test.js` | ❌ Wave 0 |
| LIVE-05 | `deriveAnyNext` true sólo con ≥1 next no vacío; sobre set sin filtrar | unit | `node --test test/dashboard-select.test.js` | ✅ (extender) |
| LIVE-05 | `nextCell` vacío si no hay next; valor si lo hay | unit | `node --test test/dashboard-format.test.js` | ✅ (extender) |
| LIVE-05 | Columna `next` aparece/oculta por `anyNext`; celda trunca; enrich mergea por task_id | render | `node --test test/dashboard-table.test.js` | ✅ (extender) |
| LIVE-06 | Overlay light-plan renderiza markdown; GSD queda byte-idéntico (no-regresión SC#3) | render | `node --test test/dashboard-overlay.test.js` | ✅ (extender) |
| LIVE-06 | `stripHandoffMarker` elimina el marcador; línea sin marcador intacta; never-throws | unit | `node --test test/handoff.test.js` | ✅ (extender) |
| LIVE-06 | `handoff.js` conserva CERO imports tras añadir el helper | isolation | `node --test test/check-isolation.test.js` | ✅ (ya guarda) |
| LIVE-07 | `buildStopNudgeText(session)` byte-idéntico al actual; `(session, next)` añade línea ES | unit | `node --test test/stop.test.js` | ✅ (extender) |
| LIVE-07 | Nudge usa el `NEXT:` persistido (asimetría: previo si esta sesión no dejó) | unit | `node --test test/hooks/session-end.test.js` | ✅ (extender) |
| SC#5 | Degradación limpia: sin next → celda vacía, nudge byte-idéntico, TUI never-throws | unit+render | `npm test` (múltiples) | ✅ (extender) |
| color-iso | Cero picocolors bajo `src/cli/dashboard/**` (reader + mini-renderer) | isolation | `node --test test/format-isolation.test.js` | ✅ (ya guarda) |

### Sampling Rate
- **Per task commit:** el fichero de test del módulo tocado (`node --test test/<file>.test.js`).
- **Per wave merge:** `npm test` completo.
- **Phase gate:** suite verde antes de `/gsd-verify-work`. **OJO:** `test/gsd-lock-race.test.js`
  «concurrent dead-holder steal (CR-01)» es flaky preexistente (~1/3 runs, STATE.md §Deferred) — NO
  lo causa esta fase; un fallo aislado ahí no bloquea el gate.

### Wave 0 Gaps
- [ ] `test/dashboard-tasks.test.js` — cubre `readTasks` (LIVE-05): ENOENT→`{}`, JSON corrupto→`{}`,
  sin clave `tasks`→`{}`, con `tasks`→el objeto; DI `kodoDir`/`readFileFn` para aislar HOME.
- [ ] Fixtures de `state.json` mínimos (con/sin `tasks`, corrupto) — patrón de siembra de la 74
  (state.tasks aditivo, sin bump de schema_version).
- [ ] Test de NO-regresión GSD explícito en `dashboard-overlay.test.js` (SC#3): un plan GSD abre
  byte-idéntico antes/después del mini-renderer.

## Security Domain

`security_enforcement` no está desactivado en config → sección incluida. Superficie de ataque de
esta fase: **entrada no confiable** (contenido LLM en los ficheros de plan, `summary`/`task_ref` del
provider remoto) renderizada en la TUI y leída de `state.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sin auth en esta fase (lectura local) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | `stripControlChars` ya aplicado en el enrich (App.js:737-741) neutraliza OSC-52/CSI/C1 antes del render; el `next` de `state.json` es contenido LLM → debe pasar el mismo saneo antes de pintarse en la celda |
| V6 Cryptography | no | — |
| V12 Files/Resources | **yes** | Path construido con root FIJO (`join(homedir(),'.kodo','state.json')`), nunca derivado de input; `readTasks` never-throws sobre ENOENT/EACCES |
| V14 Config | **yes** | Cero deps npm nuevas (sin superficie de supply-chain); cero endpoints (sin superficie de red) |

### Known Threat Patterns for {TUI ink + fichero local LLM-escrito}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Terminal escape injection vía `next` (OSC-52/CSI en el valor LLM) | Tampering | `stripControlChars` (src/format.js) en el punto de proyección al render — mismo patrón que task_ref/summary/comments (App.js:731-736). **Aplicar al `next` de la celda.** |
| ReDoS al parsear/strippear el marcador | DoS | `stripHandoffMarker` usa `indexOf`/`slice`, cero regex (T-74-09, guard `check-isolation`) |
| Path traversal al leer `state.json` | Tampering | Root fijo; el fichero no lleva componente derivado de input. El `next` no se usa como ruta. |
| Marcador forjado en `summary` hostil | Spoofing | Ya mitigado en la 74 (`sanitizeInline` en el writer); el renderer solo strippea, no interpreta el marcador como control |
| Crash de la TUI por dato ausente/corrupto | DoS | never-throws en toda la cadena (reader→enrich→celda); SC#5 (degradación limpia) |

**Acción de seguridad concreta para el planner:** el valor `next` proveniente de `state.json` es
contenido escrito por un LLM. Debe pasar por `stripControlChars` (src/cli/format.js — el mismo que
ya sanea `task_ref`/`summary` en App.js:737-741) ANTES de renderizarse en la celda `next`. Igual
para las líneas del plan en el mini-renderer si no vienen ya saneadas por el carril de lectura.

## Sources

### Primary (HIGH confidence)
- `src/cli/dashboard/plan.js` (leído completo) — `readLightPlan:65`, `readPlan:91`, patrón DI HOME,
  guards anti-traversal
- `src/cli/dashboard/SessionTable.js` (leído completo) — `COLS:95`, `cell:111`, `renderOverlay:177`,
  columna condicional `prog:996/1051`, `dataRows:1003`
- `src/cli/dashboard/client.js` (leído completo) — forma never-throws `fetchStatus:51`
- `src/cli/dashboard/format.js` (leído completo) — `progCell:240`, `taskCell:214`, `rowCells:257`
- `src/cli/dashboard/select.js:205-243` — `deriveAnyGsd:217`, `deriveAnyProgress:241`
- `src/cli/dashboard/progress.js` (leído completo) — `readGsdProgress:105` (molde reader síncrono)
- `src/cli/dashboard/App.js:640-800, 1795-1844` — `usePoll:703`, enrich:730, handler `p`:1805
- `src/session/handoff.js` (leído completo) — MARKER_OPEN:30, contrato del parser, cero imports
- `src/session/state.js:44-63, 260-289, 386-458` — typedef TaskHandoff, `loadState:262`,
  `upsertTaskHandoff:416`, asimetría:443
- `src/hooks/stop.js` (leído completo) — `buildStopNudgeText:40`
- `src/hooks/session-end.js:100-384` — bloque handoff:122-146, nudge:243-254, `writeHandoff:289`
- `test/format-isolation.test.js` (leído completo) — guard picocolors dashboard:209
- `package.json:10` — script de test `node --test`
- `.planning/phases/75-.../75-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Secondary (MEDIUM confidence)
- `test/check-isolation.test.js` (parcial, grep) — guard de cero imports de `handoff.js`

### Tertiary (LOW confidence)
- Ninguna. Toda afirmación de esta investigación está verificada contra código leído en la sesión.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps; todos los módulos internos leídos directamente
- Architecture: HIGH — cada patrón tiene un gemelo verificado en el mismo directorio
- Pitfalls: HIGH — Pitfall 1 (loadState escribe) y Pitfall 5 (asimetría del nudge) confirmados en
  el código fuente (state.js:257/262 y :443)

**Research date:** 2026-07-17
**Valid until:** 2026-08-16 (estable — código interno de un repo maduro; sin dependencias externas
que se muevan)
