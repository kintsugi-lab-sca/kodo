# Phase 75: Superficie del `NEXT:` — dashboard y nudge - Mapa de Patrones

**Mapeado:** 2026-07-17
**Ficheros analizados:** 10 (2 nuevos + 8 modificados)
**Analogs encontrados:** 10 / 10 (todos con gemelo verificado en el mismo repo)

> Nota metodológica: la 75-RESEARCH.md ya trae los patrones verificados por lectura directa.
> Este documento consolida la clasificación por rol/data-flow y ancla cada fichero a su analog
> concreto con líneas exactas, para que el planner copie sin re-descubrir.

## Clasificación de Ficheros

| Fichero (nuevo/modificado) | Rol | Data Flow | Analog más cercano | Calidad de match |
|----------------------------|-----|-----------|--------------------|------------------|
| `src/cli/dashboard/tasks.js` **(NUEVO)** | utility (reader leaf) | file-I/O (read-only) | `src/cli/dashboard/plan.js` → `readLightPlan` (`:65-78`) | exacta |
| `src/cli/dashboard/markdown.js` **(NUEVO, opcional)** | component (render puro) | transform (línea→ink) | `src/cli/dashboard/SessionTable.js` → `renderOverlay` (`:177`) | role-match |
| `src/cli/dashboard/select.js` | utility (derive puro) | transform | `deriveAnyProgress` (`:241`) / `deriveAnyGsd` (`:217`) | exacta |
| `src/cli/dashboard/format.js` | utility (celda pura) | transform | `progCell` (`:240`) / `taskCell` (`:214`) | exacta |
| `src/cli/dashboard/App.js` | provider (wiring/enrich) | event-driven (poll tick) | enrich de `progress` (`:729-776`) | exacta |
| `src/cli/dashboard/SessionTable.js` | component (tabla + overlay) | request-response (render) | columna condicional `prog` (`:95`, `:996`, `:1051`) | exacta |
| `src/session/handoff.js` | utility (parser puro, hoja) | transform (string) | `MARKER_OPEN/CLOSE` (`:30-32`), funciones puras del módulo | exacta |
| `src/hooks/stop.js` | utility (texto puro de hook) | transform | `buildStopNudgeText` (`:40-55`) | exacta (extensión in-place) |
| `src/hooks/session-end.js` | controller (hook orquestador) | event-driven (I/O) | bloque nudge (`:243-254`) + writeHandoff | exacta |
| `src/session/state.js` | model (único escritor de `state.tasks`) | CRUD | `upsertTaskHandoff` (`:416-457`) | exacta (cambia solo el return) |

---

## Asignaciones de Patrones

### `src/cli/dashboard/tasks.js` (NUEVO — reader leaf, file-I/O read-only)

**Analog:** `src/cli/dashboard/plan.js` → `readLightPlan` (`:65-78`)

**Imports pattern** (plan.js `:41-45`) — leaf-isolation: SOLO builtins, jamás `config.js`:
```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
```

**Core pattern (never-throws + DI de HOME)** — copiar la forma exacta de `readLightPlan` (`:65-78`):
```javascript
export function readTasks(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  // Convención byte-idéntica a plan.js:69 (join(homedir(), '.kodo', ...))
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    // Guard defensivo idéntico al documentado en state.js:61 (`state.tasks || {}`)
    return state && typeof state.tasks === 'object' && state.tasks !== null ? state.tasks : {};
  } catch {
    return {}; // ENOENT / JSON corrupto / sin clave → {} (celdas vacías, SC#5)
  }
}
```

**Anti-pattern CRÍTICO (RESEARCH §Pitfall 1):** NO importar `loadState()` de `state.js` — llama
`migrateStateIfNeeded()` que ESCRIBE en disco (`.bak`) en cada tick de poll. Reader puro propio.

---

### `src/cli/dashboard/markdown.js` (NUEVO opcional — component render puro, transform)

**Analog:** patrón de render de `SessionTable.js` (`renderOverlay:177`) + color-isolation de `format.js`.

**Imports pattern** — color EXCLUSIVAMENTE vía props ink (guard `test/format-isolation.test.js`):
```javascript
import { Text } from 'ink';
import { createElement as h } from 'react';
import { stripHandoffMarker } from '../../session/handoff.js'; // helper NUEVO (D-06)
```

**Core pattern (línea→estilo ink, best-effort, NO CommonMark)** — RESEARCH §Pattern 4:
```javascript
function renderMarkdownLine(line, key, inFence) {
  if (inFence) return h(Text, { key, dimColor: true }, line);
  if (line.startsWith('## ') || line.startsWith('# '))
    return h(Text, { key, bold: true, color: 'cyan' }, stripHandoffMarker(line)); // D-06
  if (line.startsWith('**')) return h(Text, { key, bold: true }, line);
  if (line.startsWith('- ') || line.startsWith('* ')) return h(Text, { key }, line);
  return h(Text, { key }, line);
}
// El toggle de `inFence` (líneas ```) se acumula en el map.
```

**Gate CRÍTICO (§Pitfall 3 / SC#3):** aplicar SOLO al carril light-plan (`render:'markdown'`),
nunca a la rama GSD. Ver `SessionTable.js` abajo.

---

### `src/cli/dashboard/select.js` (derive puro, transform) — AÑADIR `deriveAnyNext`

**Analog:** `deriveAnyProgress` (`:241-243`) y `deriveAnyGsd` (`:217-219`).

**Core pattern** — espejo literal de `deriveAnyProgress`:
```javascript
export function deriveAnyProgress(rows) {
  return rows.some((r) => r.progress?.status === 'ok');
}
// NUEVO — mismo molde:
export function deriveAnyNext(rows) {
  return rows.some((r) => typeof r.next === 'string' && r.next.length > 0);
}
```

**Invariante heredada (docstring `:209-212`, `:232-236`):** el consumidor lo computa sobre el set
**SIN filtrar** (`enriched`), nunca sobre `filtered` — si no, la columna parpadea al teclear `/`
(§Pitfall 4). Documentar esto en el docstring nuevo igual que los dos existentes.

---

### `src/cli/dashboard/format.js` (celda pura, transform) — AÑADIR `nextCell`

**Analog:** `progCell` (`:240-246`) y `taskCell` (`:214-221`).

**Core pattern** — celda vacía si no hay next (SC#5, sin placeholder ruidoso):
```javascript
// Analog progCell (:240) devuelve { text, dim } plano. Para next basta el texto:
export function nextCell(session) {
  const n = session.next;
  return typeof n === 'string' && n.length > 0 ? n : '';
}
```

**Integración en `rowCells` (`:257-267`)** — añadir `next` al objeto de celdas, al FINAL (tras `age`):
```javascript
return {
  ...,
  age: formatAge(session.elapsed_min),
  next: nextCell(session), // D-04: última posición
};
```

**Seguridad (RESEARCH §Security):** el `next` es contenido LLM — pasar por `stripControlChars`
(`src/cli/format.js`, el mismo que ya sanea `task_ref`/`summary` en `App.js:737-741`) ANTES de pintar.

---

### `src/cli/dashboard/App.js` (provider — wiring/enrich, event-driven piggyback)

**Analog:** el enrich de `progress` (`:729-776`) + `anyProgress`/`anyGsd` (`:780`, `:783`).

**Core pattern (enrich por tick, merge por `task_id`)** — RESEARCH §Pattern 2:
```javascript
const tasks = readTasks({}); // UNA lectura por render/tick; never-throws → {}
const enriched = sorted.map((rawRow) => {
  const row = { ...rawRow }; // stripControlChars ya aplicado (App.js:737)
  const entry = row.task_id ? tasks[row.task_id] : undefined;
  return { ...row, next: entry?.next ?? null }; // dato de la TAREA, no de la sesión
});
const anyNext = deriveAnyNext(enriched); // sobre enriched SIN filtrar (§Pitfall 4)
```

**Threading a SessionTable:** pasar `anyNext` como prop, espejo de cómo se pasa `anyProgress` hoy.

**Overlay `p` (handler, `:1805`+):** al construir el snapshot del overlay, threadear el discriminante
`render` que devuelve `readPlan` (ver plan.js abajo) verbatim al snapshot.

---

### `src/cli/dashboard/SessionTable.js` (component — tabla + overlay)

**Analog:** columna condicional `prog` (`COLS:95`, header `:996`, celda `:1051`) y `renderOverlay:177`.

**COLS pattern (`:95`)** — añadir `next` al FINAL (D-04):
```javascript
const COLS = { gutter: 2, state: 18, task_ref: 10, repo: 18, phasemode: 11, status: 18, prog: 7, task: 12, age: 7, next: 40 /* ancho/flex = Claude's Discretion */ };
```

**Header + celda condicional** — espejo LITERAL de `prog` (RESEARCH §Code Examples, `:996`/`:1051`):
```javascript
// header (dentro de columnHeader):
...(anyProgress ? [h(Box, { width: COLS.prog }, h(Text, { dimColor: true }, 'prog'))] : []),
// NUEVO next:
...(anyNext ? [h(Box, { width: COLS.next }, h(Text, { dimColor: true }, 'next'))] : []),

// celda (dentro de dataRows.map) — cell({truncate:true}) da el ellipsis nativo `…` (D-04, §Pitfall 6):
...(anyNext ? [cell({ width: COLS.next, text: cells.next, bold: selected, truncate: true })] : []),
```

**`cell` helper ya existe (`:111`)** — `wrap:'truncate-end'` nativo de ink resuelve el truncado; no hand-roll.

**`renderOverlay` (`:177`) — gate del mini-renderer (SC#3, §Pitfall 3):** aplicar `markdown.js` SOLO
si el snapshot lleva `render === 'markdown'`; la rama GSD (`render:'plain'` / ausente) sigue pintando
`<Text>` plano byte-idéntico. Test de NO-regresión GSD obligatorio.

---

### `src/session/handoff.js` (utility — parser puro hoja) — AÑADIR `stripHandoffMarker`

**Analog:** los constantes privados del propio módulo (`MARKER_OPEN:30`, `MARKER_CLOSE:32`) y el
estilo string-only del módulo (docstring `:18-22`).

**Constraint estructural (docstring `:9-16`):** CERO imports — ni `node:fs`/`path`/`os`. Guard runtime
`test/check-isolation.test.js`. El helper debe ser string-only (`indexOf`/`slice`, sin regex — anti-ReDoS).

**Core pattern** — RESEARCH §Pattern 5, junto a los MARKER_* existentes:
```javascript
export function stripHandoffMarker(line) {
  if (typeof line !== 'string') return '';
  const open = line.indexOf(MARKER_OPEN);
  if (open === -1) return line;
  const rest = line.slice(open + MARKER_OPEN.length);
  const close = rest.indexOf(MARKER_CLOSE);
  if (close === -1) return line; // marcador sin cerrar → conservador
  const after = rest.slice(close + MARKER_CLOSE.length);
  return (line.slice(0, open) + after).trimEnd();
}
```

**§Pitfall 2:** exportar el HELPER, NO los constantes crudos — encapsula el formato (D-13, dueño único).

---

### `src/hooks/stop.js` (utility — texto puro) — EXTENDER `buildStopNudgeText`

**Analog:** el propio `buildStopNudgeText` actual (`:40-55`) — switch por-modo ES, escape `\\n`.

**Core pattern actual** (a preservar byte-idéntico cuando no hay next, D-09) — los tres modos existentes:
```javascript
export function buildStopNudgeText(session) {   // ← gana 2º param opcional `next`
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  switch (getSessionMode(session)) {
    case 'quick': return `${base} Es una sesión GSD quick ...\\n`;
    case 'full':  { const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
                    return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` ...\\n`; }
    default:      return `${base} Revisa el resultado y decide ...\\n`;
  }
}
```

**Extensión (D-08/D-09/D-10)** — RESEARCH §Pattern 6. Refactor mínimo: capturar el texto en una var
`text`, y AÑADIR la línea SOLO si `next` es truthy (aplica a los 3 modos, D-10):
```javascript
if (typeof next === 'string' && next.length > 0) {
  text += `Siguiente paso sugerido por la sesión: ${next}\\n`; // ES, una línea, escape `\\n` (D-04 Phase 10)
}
```
Redacción literal = Claude's Discretion (mientras sea ES, una línea, y sin-next quede byte-idéntico).

---

### `src/hooks/session-end.js` (controller — hook, event-driven I/O)

**Analog:** el propio bloque «3. Nudge al orquestador» (`:243-254`) y el paso de handoff (`writeHandoff`).

**Core pattern actual del nudge (`:245-253`)** — donde se threadea el valor (D-08):
```javascript
const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
if (orchMatch) {
  await cmuxClient.send({ workspace: orchMatch[1], text: buildStopNudgeText(session) }); // ← + handoffNext
}
```

**Cambio (RESEARCH §Pattern 7 / §Pitfall 5):** capturar el `next` **post-upsert** devuelto por
`writeHandoff` (que lo propaga de `upsertTaskHandoff`) y pasarlo como 2º arg:
```javascript
// en el paso de handoff (:122-146), capturar el next efectivo persistido:
let handoffNext = null;
try { handoffNext = writeHandoff({ session, input, log }, deps)?.next ?? null; } catch (err) { ... }
// en el nudge (:251):
text: buildStopNudgeText(session, handoffNext),
```
CRÍTICO: threadear el valor **persistido** (honra la asimetría: previo si esta sesión no dejó NEXT),
NO `r.value.next` naïf (que es `null` en cierre mecánico). Cero I/O extra.

---

### `src/session/state.js` (model — único escritor de `state.tasks`)

**Analog:** el propio `upsertTaskHandoff` (`:416-457`) — la asimetría ya vive en el mutator (`:443`).

**Estado actual:** el mutator ya construye el entry con la asimetría honrada (`:431-449`):
```javascript
state.tasks[taskId] = {
  plan_path: entry.plan_path,
  next: entry.next ?? (prev ? prev.next : null) ?? null, // asimetría D-08 (:443)
  updated_at: entry.updated_at ?? new Date().toISOString(),
};
```
Pero `upsertTaskHandoff` retorna `r` (`{ ok, reason }` de `withStateLock`) sin exponer el entry.

**Cambio (§Pitfall 5, RESEARCH assumption A2):** hacer que el return incluya el `next` efectivo
persistido (el objeto que ya construye en memoria bajo el lock — cero I/O extra). Verificar con
`grep 'upsertTaskHandoff('` antes: hoy solo `writeHandoff` (session-end.js) lo consume y descarta el value.

---

## Patrones Compartidos (cross-cutting)

### Never-throws en toda la cadena TUI
**Fuente:** `plan.js` `readLightPlan` (`:70-77`), `client.js` `fetchStatus:51`.
**Aplica a:** `tasks.js` (reader), enrich de `App.js`, `nextCell`, `markdown.js`.
Todo fallo colapsa a estado renderizable (`{}`, celda vacía) — ningún throw llega a React (SC#5).

### Derive puro React-free sobre el set SIN filtrar
**Fuente:** `deriveAnyGsd:217` / `deriveAnyProgress:241` (docstrings `:209-212`, `:232-236`).
**Aplica a:** `deriveAnyNext`, el merge por `task_id`. Testeable sin ink; computar sobre `enriched`,
nunca sobre `filtered` (§Pitfall 4 — la columna parpadearía al teclear `/`).

### Color-isolation (props ink, cero picocolors)
**Fuente:** guard `test/format-isolation.test.js` (escanea `src/cli/dashboard/**`), docstring `format.js:207-209`.
**Aplica a:** `markdown.js`, `nextCell`, celda `next` de `SessionTable.js`. Color solo vía `<Text color/dimColor>`.

### Sanitización de contenido LLM antes del render
**Fuente:** `stripControlChars` (`src/cli/format.js`) ya aplicado en `App.js:737-741` a `task_ref`/`summary`.
**Aplica a:** el `next` de la celda (contenido LLM de `state.json`) y las líneas del plan en `markdown.js`.
Neutraliza OSC-52/CSI/C1 antes de proyectar al terminal (V5 Input Validation).

### String-only / anti-ReDoS en el contrato del marcador
**Fuente:** docstring `handoff.js:18-22` (cero regex), guard `test/check-isolation.test.js` (cero imports).
**Aplica a:** `stripHandoffMarker`. `indexOf`/`slice`, jamás `/<!-- kodo:handoff.*?-->/`.

### Overlay con snapshot congelado + `Esc` preserva cursor por `task_id`
**Fuente:** mecánica compartida de `c`/`l`/`p` en `App.js` (handler `:1805`+) y `renderOverlay:177`.
**Aplica a:** LIVE-06 — reutilizar el binding `p` existente (`mode:'overlay'`, read-only). No añadir tecla
salvo que el planner detecte necesidad de discriminar (Claude's Discretion; default = reusar `p`).

---

## Sin Analog (usar patrones propios / RESEARCH)

Ninguno. Cada fichero de esta fase tiene un gemelo verificado en el mismo repo (RESEARCH §Don't Hand-Roll:
«cada pieza tiene un gemelo ya en producción en el mismo directorio»). El único código genuinamente
nuevo — el mini-renderer (`markdown.js`, D-05) y `stripHandoffMarker` (D-06) — son puros y triviales, y
aun así heredan patrones existentes (render de ink + string-only del propio `handoff.js`).

---

## Metadata

**Scope de búsqueda de analogs:** `src/cli/dashboard/`, `src/session/`, `src/hooks/`.
**Ficheros escaneados/leídos directamente:** `plan.js`, `select.js`, `format.js`, `SessionTable.js`,
`handoff.js`, `stop.js`, `state.js`, `session-end.js` (+ RESEARCH.md verificado contra código).
**Fecha de extracción:** 2026-07-17.
</content>
</invoke>
