# Phase 50: Live-progress display - Pattern Map

**Mapped:** 2026-06-12
**Files analyzed:** 6 (2 nuevos + 4 modificados) — lectura CLIENT-SIDE, server.js NO se toca
**Analogs found:** 6 / 6 (todos con analog exacto en el codebase — research confirmado verbatim)

> **CORRECCIÓN LOAD-BEARING para el planner:** CONTEXT.md/prompt citan `src/cli/dashboard/derive.js`
> para `deriveAnyProgress`. **Ese archivo NO EXISTE.** `deriveAnyGsd` vive en `src/cli/dashboard/select.js`
> (línea 217). `deriveAnyProgress` debe añadirse a **`select.js`**, no a un `derive.js` inexistente.
> Verificado por `ls src/cli/dashboard/`.

> **⚠ CORRECCIÓN CRÍTICA — el artefacto se lee CLIENT-SIDE, NO en server.js (D-08 LOCKED):** una versión
> previa de este documento clasificaba `src/server.js GET /status` como archivo a MODIFICAR y describía
> enriquecer `progress` server-side (mold de `provider_state`). **ESO VIOLA D-08 y se RECHAZA.** D-08 +
> Success Criteria 2 mandan: **CERO cambios en `src/server.js`, CERO endpoints nuevos.** La lectura del
> artefacto `~/.kodo/progress/<task_id>.json` vive en **`App.js`** (zona del render, ~línea 544), vía un
> helper `readProgress(row, deps)` modelado en `readPlan`/`readLightPlan` (`src/cli/dashboard/plan.js`):
> síncrono, never-throws, path byte-idéntico al hook productor.
> **Diferencia con `provider_state`:** `provider_state` se enriquece server-side porque requiere
> `await providerStateResolver.resolve(s)` (async/red). `progress` es lectura filesystem SÍNCRONA
> never-throws → encaja client-side EXACTAMENTE como `readPlan` (`App.js:544`). NO copiar el patrón de
> `provider_state` para `progress`. App.js enriquece `session.progress`; format.js/SessionTable.js lo CONSUMEN.

## File Classification

| Archivo nuevo/modificado | Role | Data Flow | Analog más cercano | Match |
|--------------------------|------|-----------|--------------------|-------|
| `src/hooks/task-progress.js` (NUEVO) | hook (capture) | event-driven → file-I/O | `src/hooks/session-start.js` | role-match (hook never-throws, NO golden-bytes) |
| `src/hooks/install.js` (MODIFICAR) | config (hook registration) | transform | `addHook` / `installHooks` (mismo archivo) | exact (extensión in-place) |
| `src/cli/dashboard/progress.js` (NUEVO) | utility (consumer leaf) | file-I/O (read) | `readLightPlan` en `src/cli/dashboard/plan.js:65-78` | exact |
| `src/cli/dashboard/select.js` (MODIFICAR) | utility (derive) | transform | `deriveAnyGsd` (mismo archivo, línea 217) | exact |
| `src/cli/dashboard/format.js` (MODIFICAR) | utility (cell projector) | transform | `taskCell` (línea 214) + `rowCells` (línea 232) | exact |
| `src/cli/dashboard/App.js` (MODIFICAR) | component (enrich client-side) | file-I/O (read) + render | `readPlan` enrich en el handler `p` (`App.js:544`) | exact |
| `src/cli/dashboard/SessionTable.js` (MODIFICAR) | component (presentational) | request-response (render) | columna `task`/`phasemode` (líneas 54, 323-327, 379) | exact |

> **⚠ NO incluir `src/server.js` en esta tabla.** Una versión previa lo listaba como archivo a MODIFICAR
> ("GET /status enrich"). Eso VIOLA D-08 — el progreso NO se enriquece server-side. El enrich del artefacto
> vive en `src/cli/dashboard/App.js` (client-side, mold `readPlan`), NO en `src/server.js`.

**Correlación (cero archivo nuevo):** `findSession({sessionId})` (`src/session/state.js:319`) — usado DESDE el hook.
**Root del artefacto:** `KODO_DIR` (`src/config.js:6`, exportado línea 233) = `join(homedir(), '.kodo')`.

## Pattern Assignments

### `src/hooks/task-progress.js` (NUEVO — hook, event-driven → file-I/O)

**Analog:** `src/hooks/session-start.js` (estructura del hook; es un hook SEPARADO — NO append, preserva golden-bytes HOOK-02).

**Imports + constante de timeout** — copiar la forma de `session-start.js:8-15`. El hook es un LEAF: solo builtins + import lazy de `state.js`:
```javascript
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STDIN_TIMEOUT = 3000;   // ← copia literal de session-start.js:15
```
**NOTA:** NO importar `findSession` arriba como `session-start.js` (línea 10). El research (Pitfall 1, latencia) manda mantener el cuerpo mínimo y el import lazy: `const { findSession } = await import('../session/state.js');` DENTRO de main (mold del import dinámico de logger en `session-start.js:233-234`).

**Lectura de stdin** — copiar VERBATIM `session-start.js:198-208` (`readStdin()` con timeout + resolve('{}')):
```javascript
async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}
```

**Cuerpo never-throws** — mold del `main()` de `session-start.js:210-267` (try/catch externo que jamás crashea Claude Code). La forma exacta del cuerpo ya está especificada verbatim en `50-RESEARCH.md:120-162` (Pattern 1). Puntos load-bearing del analog:
- Correlación: `findSession({ sessionId })` (mold de `session-start.js:216`, que usa `findSession({ sessionId, cwd })`).
- **USAR `found.session.task_id`** (UUID kodo), NUNCA `input.task_id` (índice `"1"` de Claude Code). El acceso a `found.session.task_id` es el mismo shape que `session-start.js:238` (`task_id: session.task_id`). Confirmado por Open Question 2 del research (namespaces distintos).
- Anti-traversal del taskId ANTES de construir la ruta: `String.includes` (NO regex), mold del guard de `plan.js:121` (`!taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..')`).
- Ruta del artefacto byte-idéntica al consumidor: `join(homedir(), '.kodo', 'progress', \`${taskId}.json\`)`.

**Guard de invocación directa** — copiar VERBATIM `session-start.js:269-272` (testeable sin spawn):
```javascript
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

---

### `src/hooks/install.js` (MODIFICAR — config, transform)

**Analog:** `addHook` + `installHooks` + `uninstallHooks` en el **mismo archivo**. El research (`50-RESEARCH.md:274-287`) ya da el diff exacto.

**El helper `addHook` (líneas 91-109) NO se toca** — ya envuelve en `{ hooks: [{ type:'command', command }] }` (línea 104-106) e idempotencia vía `entry.hooks.some(h => h.command?.includes('kodo'))`.

**Dentro de `installHooks()` (tras línea 13-15 declarar el cmd, tras línea 35 los addHook existentes):**
```javascript
// Declarar junto a sessionStartCmd/stopCmd (líneas 14-15), mismo patrón node-path-quote:
const taskProgressCmd = `node "${join(kodoRoot, 'src', 'hooks', 'task-progress.js')}"`;
// ... tras los addHook de SessionStart/Stop (líneas 32-35):
changed = addHook(settings.hooks, 'TaskCreated', taskProgressCmd) || changed;
changed = addHook(settings.hooks, 'TaskCompleted', taskProgressCmd) || changed;
```
Añadir los nuevos cmds al bloque `console.log` (líneas 39-41) por simetría.

**En `uninstallHooks()` (línea 65) — extender el array de eventos:**
```javascript
for (const event of ['SessionStart', 'Stop', 'TaskCreated', 'TaskCompleted']) {
```
El cuerpo del loop (filtra por `h.command?.includes('kodo')`, líneas 66-72) **no cambia** — ya limpia cualquier hook kodo de cada evento.

---

### `src/cli/dashboard/progress.js` (NUEVO — utility, file-I/O read)

**Analog EXACTO:** `readLightPlan` en `src/cli/dashboard/plan.js:65-78`. Clonar la forma (no reusar literalmente — el artefacto es JSON con campos, no markdown línea-a-línea; ver Alternatives del research).

**Imports** (mold `plan.js:41-45` — leaf-isolation, solo builtins, NO `src/config.js`):
```javascript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
```

**Firma + DI + discriminante + never-throws** — clonar `readLightPlan` (`plan.js:65-78`). Diferencia: parsear JSON y mapear status `ok`/`no-progress`/`error` (no `ok`/`no-light-plan`/`error`). El cuerpo ya está dado verbatim en `50-RESEARCH.md:170-181` (Pattern 2). Puntos load-bearing del analog:
- DI con default builtin: `const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));` (copia de `plan.js:66`).
- Root inyectable para HOME-isolation en tests: `deps.kodoProgressDir || join((deps.homedirFn || homedir)(), '.kodo', 'progress')` (mold de `plan.js:69` que usa `'.kodo', 'plans'`).
- Ruta byte-idéntica al productor: `join(progDir, \`${taskId}.json\`)`.
- Mapeo de error idéntico a `plan.js:73-77`: `err?.code === 'ENOENT'` → status `no-progress`; otro (EACCES/JSON corrupto) → `error`.
- **Anti-ReDoS guard del taskId:** REUSAR el de `plan.js:120-121` (`String.includes('/')`/`'\\'`/`'..'`). El research (D-08 CONTEXT) dice "reusar, no reinventar". El caller (App.js enrich, CLIENT-SIDE) valida el taskId ANTES de llamar, exactamente como `readPlan` valida antes de `readLightPlan` (`plan.js:117-123`).

---

### `src/cli/dashboard/select.js` (MODIFICAR — utility, transform)

**Analog EXACTO:** `deriveAnyGsd` (línea 217, **mismo archivo**). `deriveAnyProgress` es su espejo literal.

**Patrón a copiar (líneas 203-219):**
```javascript
export function deriveAnyGsd(rows) {
  return rows.some((r) => r.phase_id != null);
}
```
**Clonar como:**
```javascript
export function deriveAnyProgress(rows) {
  return rows.some((r) => r.progress != null);  // alguna fila tiene artefacto legible
}
```
**Load-bearing (Pitfall 5 del research, == Pitfall 4 de Phase 44):** el caller (App.js) lo computa sobre el set **SIN filtrar** (`sorted`), igual que `deriveAnyGsd(sorted)` en `App.js:331`. La columna es ESTRUCTURAL — no debe parpadear bajo query `/`. El docstring de `deriveAnyGsd` (líneas 209-213) documenta este invariante CRÍTICO — replicarlo.

---

### `src/cli/dashboard/format.js` (MODIFICAR — utility, cell projector)

**Analog EXACTO:** `taskCell` (línea 214, celda no-color con degradados `—`/`?`) + `rowCells` (línea 232, proyector).

**`progCell` — mold de `taskCell` (líneas 214-221):**
```javascript
// taskCell (analog) — la forma a espejar: { text, dim } plano, cero color propio:
export function taskCell(session) {
  const reason = session.provider_state_reason;
  if (reason === 'unsupported') return { text: '—', dim: true };
  if (reason === 'fetch-failed') return { text: '?', dim: true };
  const raw = session.provider_state;
  return { text: raw == null ? '—' : raw, dim: false };
}
```
**Clonar como `progCell`** (4 estados `N/M`/`N/M✓`/`—`/`?`). El cuerpo ya está verbatim en `50-RESEARCH.md:192-198` (Pattern 3). Load-bearing: devolver `{ text, dim }` plano (cero color propio — color-isolation D-12, el dim sale de ink). `progCell` lee `session.progress` (el objeto enriquecido CLIENT-SIDE en App.js — NO un campo del payload de `/status`). `no-progress`→`{ text:'—', dim:true }`; `error`→`{ text:'?', dim:true }`; ok → `{ text:\`${n}/${m}${completed?'✓':''}\`, dim:false }`.

**`rowCells` (líneas 232-241) — añadir `prog`:**
```javascript
export function rowCells(session) {
  return {
    task_ref: session.task_ref ?? '—',
    repo: deriveRepo(session),
    phasemode: phaseMode(session),
    status: outcomeCell(session.status ?? ''),
    task: taskCell(session),
    prog: progCell(session),          // ← AÑADIR (mold de la línea task)
    age: formatAge(session.elapsed_min),
  };
}
```
Actualizar el JSDoc `@returns` (línea 230) añadiendo `prog: { text: string, dim: boolean }`.

**Color-isolation (invariante D-12):** este módulo NO importa picocolors/`src/cli/format.js` (líneas 22-23). `progCell` debe respetarlo — `test/format-isolation.test.js` (walker) lo cubre automáticamente.

---

### `src/cli/dashboard/App.js` (MODIFICAR — component, enrich CLIENT-SIDE)

**Analog EXACTO:** el enrich de `readPlan` en el handler `p` (`App.js:544`: `const res = readPlan(row, { resolvePhaseFn: resolvePhase })`) — lectura filesystem SÍNCRONA never-throws en el render, SIN await. `progress` se enriquece con la misma forma. **NO** copiar el enrich async de `provider_state` (ese vive en server.js porque requiere red; `progress` no).

**Patrón a espejar (`App.js:544`, handler `p`):**
```javascript
// readPlan es SÍNCRONO never-throws — sin try/catch, sin await window (App.js:535-541 lo documenta):
const res = readPlan(row, { resolvePhaseFn: resolvePhase });
```
**Aplicar a `progress`** en el pipeline de derivación (zona líneas 322-337, donde ya vive `sorted`/`deriveAnyGsd(sorted)`):
- Importar `readProgress` de `./progress.js` y `deriveAnyProgress` de `./select.js`.
- Enriquecer cada fila con `progress` leyendo `readProgress(row.task_id, {})` (síncrono, never-throws) ANTES de `deriveAnyProgress`/`filtered`, de modo que `row.progress` esté presente para `deriveAnyProgress`, `applyFilter` y `rowCells`.
- **Keep-last-good (D-09):** mantener en un `useRef` (mapa por `task_id`) el último `{ n, m, completed }` con `status === 'ok'`; en `status === 'error'` con last-good presente, exponer `row.progress = { status:'ok', ...lastGood }` (sobrevive el N/M; progCell pinta N/M, no `?`).
- `const anyProgress = deriveAnyProgress(<filas enriquecidas SIN filtrar>);` (mold `deriveAnyGsd(sorted)`, Pitfall 5). Pasar `anyProgress` a `SessionTable` junto a `anyGsd` (zona línea 694).
- **Invariante (D-08):** cero endpoint nuevo, cero cambios en `src/server.js`. El enrich es CLIENT-SIDE en App.js, mold `readPlan`. Verificable por `git diff --quiet src/server.js`.

---

### `src/cli/dashboard/SessionTable.js` (MODIFICAR — component, presentational)

**Analog EXACTO:** la columna `task` (provider_state, Phase 43) y `phasemode` (condicional, Phase 44), mismo archivo.

**1. `COLS` (línea 54)** — añadir `prog` ENTRE `status` y `task` (research D-06: ancho 6-7, reservar para el `✓`):
```javascript
const COLS = { gutter: 2, state: 18, task_ref: 10, repo: 18, phasemode: 11, status: 18, prog: 7, task: 12, age: 7 };
```

**2. Prop `anyProgress`** — añadir a la firma de `SessionTable` (junto a `anyGsd`, línea 236) con default `false` (retro-compat: oculta la columna si no se pasa). Mold del JSDoc de `anyGsd` (líneas 204-208).

**3. Cabecera de columna condicional** — mold de `phasemode` (líneas 320-323), insertar ENTRE `status` (324) y `task` (326):
```javascript
// patrón analog (phasemode condicional, líneas 320-323):
...(anyGsd ? [h(Box, { width: COLS.phasemode }, h(Text, { dimColor: true }, 'phase/mode'))] : []),
// clonar para prog, ENTRE status(324) y task(326):
...(anyProgress ? [h(Box, { width: COLS.prog }, h(Text, { dimColor: true }, 'prog'))] : []),
```

**4. Celda de datos condicional** — mold de la celda `task` (línea 379, no-color + dim + truncate) combinado con el wrapper condicional de `phasemode` (líneas 368-370):
```javascript
// celda task (analog no-color, línea 379):
cell({ width: COLS.task, text: cells.task.text, dim: cells.task.dim, bold: selected, truncate: true }),
// celda prog (clon condicional, insertar ENTRE status y task):
...(anyProgress
  ? [cell({ width: COLS.prog, text: cells.prog.text, dim: cells.prog.dim, bold: selected, truncate: true })]
  : []),
```
`truncate: true` → ellipsis nativo `…` de ink = el anti-DoS T-43-03 (un `n`/`m` absurdo se trunca, no desborda la tabla). El helper `cell` (líneas 70-80) ya implementa `wrap: 'truncate-end'` cuando `truncate:true`.

## Shared Patterns

### Never-throws filesystem (seam byte-idéntico productor↔consumidor)
**Source:** `src/cli/dashboard/plan.js:65-78` (`readLightPlan`) + `src/hooks/session-start.js:85` (productor del plan ligero).
**Apply to:** `task-progress.js` (productor, escribe) + `progress.js` (consumidor, lee) + `App.js` enrich (caller CLIENT-SIDE).
Ruta byte-idéntica en ambos lados: `join(homedir(), '.kodo', 'progress', \`${taskId}.json\`)`. Todo I/O envuelto en try/catch; ningún error llega a React/Claude Code.

### Anti-ReDoS / anti-traversal del task_id (String.includes, NO regex)
**Source:** `src/cli/dashboard/plan.js:120-121`.
```javascript
const usable = taskId && !taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..');
```
**Apply to:** el guard del taskId en `task-progress.js` (antes de escribir) y en `progress.js`/su caller (antes de leer). REUSAR, no reinventar (CONTEXT D-08).

### Enriquecimiento CLIENT-SIDE en App.js (NO en server.js — D-08)
**Source:** `src/cli/dashboard/App.js:544` (enrich de `readPlan` en el handler `p`, lectura filesystem síncrona never-throws en el render).
**Apply to:** la lectura de `~/.kodo/progress/<task_id>.json` vive AQUÍ (client-side, mold `readPlan`), **NO en server.js GET /status**. `progress` es lectura SÍNCRONA never-throws → encaja client-side como `readPlan`; a diferencia de `provider_state` (server-side por requerir `await ...resolve()`/red), NO se enriquece en el payload de `/status`. Esto preserva el invariante "cero endpoints nuevos / cero cambios en server.js" (D-08, Success Criteria 2) y mantiene el dashboard sin tocar `~/.claude/`.

### Columna condicional estructural (sobre set SIN filtrar)
**Source:** `src/cli/dashboard/select.js:217` (`deriveAnyGsd`) + `src/cli/dashboard/App.js:331` (`deriveAnyGsd(sorted)`).
**Apply to:** `deriveAnyProgress` + su wiring en App.js. Computar sobre `sorted` (NO `filtered`) → Pitfall 5 (la columna no parpadea bajo `/`). Pasar `anyProgress` a `SessionTable` junto a `anyGsd` (`App.js:694`).

### Celda no-color con degradados (color-isolation D-12)
**Source:** `src/cli/dashboard/format.js:214-221` (`taskCell`) + render `SessionTable.js:379`.
**Apply to:** `progCell`. Devolver `{ text, dim }` plano; el `dim` lo mapea ink a `dimColor`; cero picocolors/ANSI. Cubierto por `test/format-isolation.test.js` (walker automático).

## No Analog Found

Ninguno. Los 6 archivos tienen analog exacto o role-match fuerte ya shipped y testeado (plan-ligero v0.11 para el seam; `provider_state` v0.10 para la columna degradada; `deriveAnyGsd` v0.11 para la condicionalidad; `readPlan` enrich v0.11 para la lectura client-side; `addHook` para el registro). El research lo resume: "Phase 50 no inventa NADA — clonar la forma, no diseñar."

## Metadata

**Analog search scope:** `src/hooks/`, `src/cli/dashboard/`, `src/session/`, `src/config.js`.
**Files scanned:** 8 leídos verbatim (plan.js, session-start.js, install.js, SessionTable.js, format.js, select.js, config.js, App.js readPlan enrich) + state.js (findSession) + App.js (wiring anyGsd/enrich).
**Correcciones load-bearing emitidas:** (1) `derive.js` NO existe → `deriveAnyProgress` va en `select.js`; (2) **el enrich del artefacto va CLIENT-SIDE en `App.js` (mold `readPlan`, `App.js:544`), NO en `server.js` — D-08 prohíbe tocar server.js**; una versión previa de este documento clasificaba server.js erróneamente como archivo a modificar (corregido).
**Pattern extraction date:** 2026-06-12
