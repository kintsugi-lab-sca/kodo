# Phase 50: Live-progress display (CONDICIONAL — solo si Phase 49 = VIABLE) — Research

**Researched:** 2026-06-12
**Domain:** Claude Code hooks (eventos `Task*`) + persistencia filesystem `~/.kodo/` + columna condicional de dashboard (ink/React)
**Confidence:** HIGH (mecanismo verificado en primera persona contra la build instalada 2.1.175 + doc oficial de hooks)

## Summary

Phase 50 es **barata por construcción**: el spike (Phase 49) ya cerró el riesgo caro (captura). Lo que queda es plomería sobre patrones ya shipped en kodo: un hook nuevo separado que lee `~/.claude/tasks/<session_id>/` y escribe `~/.kodo/progress/<task_id>.json` (mold del productor de `~/.kodo/plans/`), y una columna condicional `prog` en `SessionTable.js` (mold exacto de `phasemode`/`deriveAnyGsd` + `provider_state`/`taskCell`). Verifiqué en primera persona contra la build instalada (`claude 2.1.175`) que el schema de `N.json` es estable, que los eventos `TaskCreated`/`TaskCompleted` están soportados, y que el payload del hook lleva `session_id`+`task_id`+`cwd` directamente.

**Hallazgo NUEVO no anticipado por CONTEXT.md (load-bearing, HIGH):** la doc oficial de Claude Code dice que `TaskCreated`/`TaskCompleted` disparan **síncronamente dentro del agentic loop** y que "**slow hooks add latency to the session**". El Success Criteria 1 exige "sin latencia ni romper la sesión". Esto NO es automático: un hook command Node que arranca un proceso nuevo por evento puede costar ~50-150ms de cold-start de Node. El plan DEBE mitigarlo explícitamente — ver Pitfall 1. Esto eleva el A2 a confirmar DOS cosas, no una: (a) que dispara en worktree, y (b) que no añade latencia perceptible.

**Discrepancia spike vs decisión (resuelta a favor de D-04):** el spike derivó `M = count(TaskCreated)` acumulando eventos. **D-04 rechaza eso por frágil** y manda leer `~/.claude/tasks/<session_id>/` autoritativo (self-healing). Son DOS fuentes distintas: el evento es solo el *trigger*; el `N/M` se deriva SIEMPRE del tasks-dir. El plan no debe acumular contadores de eventos.

**Primary recommendation:** Tarea 1 = confirmación A2 empírica barata (instrumentar un `execute-phase` worktree real con un hook throwaway que loguea `cwd`+timestamp a `/tmp` y mide latencia). Si confirma → hook `src/hooks/task-progress.js` (never-throws, fire-and-forget, lee tasks-dir → escribe artefacto) registrado vía `installHooks()` con el patrón de envoltura `{hooks:[...]}` existente; consumidor `readProgress` clonado de `readLightPlan`; columna `prog` clonada de `phasemode`+`taskCell`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detección de cambio de progreso (trigger) | Claude Code runtime (hook event) | — | Solo Claude Code sabe cuándo una task cambia de estado; kodo se suscribe vía `~/.claude/settings.json` |
| Derivación `N/M` autoritativa | Hook script (`task-progress.js`) | `~/.claude/tasks/<session_id>/` (READ) | El hook lee el tasks-dir plano (self-healing, D-04), no acumula eventos |
| Correlación `session_id → task_id` | Hook script | `findSession` (`src/session/state.js`) | Round-trip ya probado en el spike; cero código nuevo |
| Persistencia del artefacto | Hook script (write-owner kodo) | `~/.kodo/progress/<task_id>.json` | Territorio kodo; espejo de `~/.kodo/plans/<task_id>.md` |
| Lectura del artefacto | Dashboard leaf (`plan.js`-style) | filesystem (`~/.kodo/progress/`) | Cero endpoints nuevos (invariante); never-throws; lectura CLIENT-SIDE en App.js (mold readPlan), NO server.js |
| Render de la columna `prog` | TUI presentacional (`SessionTable.js`) | `format.js` (deriva celda) + `select.js` (deriva flag condicional) | Mold exacto de `phasemode` (condicional) + `task`/`provider_state` (no-color, degradado) |

**Nota de tier:** TODO el acoplamiento a internals de Claude Code vive EXCLUSIVAMENTE en el hook (1 archivo). El dashboard NUNCA lee `~/.claude/`; solo lee el artefacto kodo. Este aislamiento es la propiedad arquitectónica central de la fase (mismo seam que plan-ligero v0.11).

## Standard Stack

Esta fase NO instala paquetes externos. Todo es Node builtins (`node:fs`, `node:path`, `node:os`) + ink/React ya presentes. El hook y el consumidor son leaves que solo importan builtins (preserva la leaf-isolation de `plan.js`).

### Core (todo ya en el repo)
| Módulo | Propósito | Por qué es el estándar aquí |
|--------|-----------|------------------------------|
| `node:fs` (sync) | readdir/readFile/writeFile del tasks-dir y artefacto | Mold de `plan.js`: síncrono, never-throws envuelto en try/catch |
| `node:os` `homedir()` | construir `~/.kodo/progress/` y `~/.claude/tasks/` | Misma convención que `plan.js:45` y `config.js:4` — builtin, preserva leaf-isolation |
| `node:path` `join` | rutas byte-idénticas productor↔consumidor | Patrón seam v0.11 |
| `findSession` (`src/session/state.js`) | correlación `session_id → task_id` | Round-trip probado en el spike; ya retorna `{id, session, source}` |
| `installHooks()` (`src/hooks/install.js`) | registrar el nuevo hook sin clobber | Extender con el nuevo evento, mismo patrón `addHook` |
| `readLightPlan` (`src/cli/dashboard/plan.js`) | mold del consumidor never-throws + anti-ReDoS guard | Clonar la forma para `readProgress` |
| `taskCell`/`rowCells` (`src/cli/dashboard/format.js`) | mold de celda no-color con degradados `—`/`?` | La celda `prog` se deriva igual |
| `deriveAnyGsd` (`src/cli/dashboard/select.js`) | mold del flag de columna condicional | `deriveAnyProgress` se clona de aquí |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hook command Node por evento | Hook `type:"http"` a un endpoint local | Rechazado: añade endpoint (rompe invariante "cero endpoints nuevos") y acopla al server vivo |
| Derivar `N/M` del tasks-dir (D-04) | Acumular `count(TaskCreated)`/`count(TaskCompleted)` del evento | Rechazado por D-04: frágil ante misses de eventos; el spike lo usó pero CONTEXT.md lo descarta para producción |
| Reusar `readLightPlan` literalmente | `readProgress` separado clonado | Clonar (no reusar): el artefacto es JSON con campos, no markdown línea-a-línea; el parseo difiere aunque el guard/never-throws sea idéntico |

**Installation:** N/A — cero paquetes nuevos.

## Package Legitimacy Audit

No aplica: esta fase no instala paquetes externos (cero dependencias nuevas en `package.json`). Todo es Node builtins + dependencias ya presentes (ink, react). Slopcheck no necesario.

## Architecture Patterns

### System Architecture Diagram

```
  Claude Code session (worktree: cwd = .bg-shell/<sid>/)
        │
        │ TaskCreate / mark-complete  (agentic loop)
        ▼
  ┌─────────────────────────────┐
  │ Claude Code runtime          │
  │  • materializa tasks-dir     │──► ~/.claude/tasks/<session_id>/N.json  (READ-ONLY surface)
  │  • dispara hook event        │        { id, status:"completed"|"pending", ... }
  └──────────────┬──────────────┘
                 │ stdin payload: { session_id, task_id, cwd, hook_event_name, ... }
                 ▼
  ┌─────────────────────────────────────────────────┐
  │ src/hooks/task-progress.js  (NUEVO, separado)    │
  │  fire-and-forget · never-throws · NO toma .lock  │
  │  1. parse payload → session_id                   │
  │  2. readdir ~/.claude/tasks/<session_id>/        │ ◄── lee N.json (autoritativo, D-04)
  │     N = count(status=="completed"); M = total    │
  │  3. findSession({sessionId}) → task_id           │ ◄── src/session/state.js
  │  4. writeFile ~/.kodo/progress/<task_id>.json    │ ──► { n, m, completed, updated_at }
  └─────────────────────────────────────────────────┘
                 │  (WRITE-OWNER kodo)
                 ▼
        ~/.kodo/progress/<task_id>.json   ◄═══════ seam byte-idéntico ═══════╗
                                                                              ║
  ┌─────────────────────────────────────────────────┐                        ║
  │ Dashboard (TUI, poll loop)                       │                        ║
  │  GET /status → filas con task_id                 │                        ║
  │  readProgress(task_id) CLIENT-SIDE en App.js ────╫────────────────────────╝
  │   (mold readPlan App.js:544 — NO server.js)      │
  │   → { n, m, completed } | ENOENT→— | error→?     │
  │  deriveAnyProgress(rows) → muestra/oculta col    │ ◄── mold deriveAnyGsd
  │  progCell(row) → "1/3" | "3/3✓" | "—" | "?"      │ ◄── mold taskCell
  │  SessionTable: columna `prog` entre status y task│ ◄── mold phasemode/task COLS
  └─────────────────────────────────────────────────┘
```

Trazado del caso primario: una task se completa en la sesión worktree → el evento dispara el hook → el hook recuenta el tasks-dir y escribe `2/3` (o `3/3` + completed) al artefacto kodo → en el siguiente poll el dashboard (App.js, client-side) lee el artefacto y pinta `2/3` (o `3/3✓`) en la columna `prog` de esa fila.

### Recommended Project Structure
```
src/
├── hooks/
│   ├── task-progress.js   # NUEVO: hook de captura (lee tasks-dir → escribe artefacto)
│   ├── install.js         # EDITAR: registrar TaskCreated/TaskCompleted (sin tocar SessionStart/Stop)
│   └── session-start.js   # NO TOCAR (golden-bytes HOOK-02)
└── cli/dashboard/
    ├── plan.js            # mold de readProgress (clonar readLightPlan, no editar)
    ├── progress.js        # NUEVO: readProgress leaf
    ├── format.js          # EDITAR: progCell + rowCells añade `prog`
    ├── select.js          # EDITAR: deriveAnyProgress (mold deriveAnyGsd)
    ├── App.js             # EDITAR: enrich CLIENT-SIDE session.progress vía readProgress (mold readPlan) — NO server.js
    └── SessionTable.js    # EDITAR: COLS.prog + cabecera + celda condicional
```

### Pattern 1: Hook fire-and-forget never-throws con lectura autoritativa del tasks-dir
**What:** El hook NO confía en el conteo de eventos; en cada disparo recuenta el directorio plano. Esto es self-healing: si se pierde un evento, el siguiente recuento corrige el estado.
**When to use:** Siempre que el trigger sea un evento pero la verdad viva en un datastore reconstruible.
**Example:**
```javascript
// src/hooks/task-progress.js — forma propuesta (verificada contra schema real 2.1.175)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STDIN_TIMEOUT = 3000;

async function main() {
  try {
    const input = JSON.parse(await readStdin());     // payload del hook
    const sessionId = input.session_id;
    if (!sessionId) return;                            // never-throws: salida silenciosa

    // 1. Recuento AUTORITATIVO del tasks-dir (D-04). NUNCA toma el .lock (Pitfall 3 spike).
    const tasksDir = join(homedir(), '.claude', 'tasks', sessionId);
    let n = 0, m = 0;
    try {
      for (const f of readdirSync(tasksDir)) {
        if (!f.endsWith('.json') || f.startsWith('.')) continue; // ignora .lock/.highwatermark
        m++;
        try {
          const t = JSON.parse(readFileSync(join(tasksDir, f), 'utf-8'));
          if (t.status === 'completed') n++;
        } catch { /* json a medio escribir → no cuenta como completed (self-heal próximo evento) */ }
      }
    } catch { return; }  // ENOENT/EACCES → silencioso (cohorte sin tasks-dir tolerada)

    // 2. Correlación session_id → task_id (round-trip probado en el spike)
    const { findSession } = await import('../session/state.js');
    const found = findSession({ sessionId });
    if (!found) return;                                // sesión no rastreada por kodo → no-op
    const taskId = found.session.task_id;
    if (!taskId || taskId.includes('/') || taskId.includes('\\') || taskId.includes('..')) return; // anti-traversal (incluye backslash — mold plan.js:120-121)

    // 3. Escritura write-owner kodo (artefacto)
    const progDir = join(homedir(), '.kodo', 'progress');
    try { mkdirSync(progDir, { recursive: true }); } catch {}
    const snapshot = { n, m, completed: m > 0 && n === m, updated_at: new Date().toISOString() };
    writeFileSync(join(progDir, `${taskId}.json`), JSON.stringify(snapshot) + '\n');
  } catch { /* never-throws: jamás crashea Claude Code */ }
}
```
**Nota:** el `import.meta.url === ...` guard de `session-start.js` debe replicarse para que sea testeable sin spawn.
**Nota anti-traversal:** el guard DEBE incluir los TRES checks — `/`, `\\` (backslash) y `..` — alineado con el mold de `plan.js:120-121`. Omitir el backslash deja una vía de traversal en Windows-style paths.

### Pattern 2: Consumidor never-throws con discriminante de status (mold readLightPlan)
```javascript
// readProgress(taskId, deps) → { status:'ok'|'no-progress'|'error', n?, m?, completed? }
// Mapeo (espejo readLightPlan): contenido→'ok'; ENOENT→'no-progress'; otro→'error'.
// Anti-ReDoS guard: REUSAR el de readLightPlan (String.includes, NO regex) — el caller valida taskId.
function readProgress(taskId, deps) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const progDir = deps.kodoProgressDir || join((deps.homedirFn || homedir)(), '.kodo', 'progress');
  try {
    const raw = readFileFn(join(progDir, `${taskId}.json`));
    const o = JSON.parse(raw);
    return { status: 'ok', n: o.n, m: o.m, completed: !!o.completed };
  } catch (err) {
    if (err?.code === 'ENOENT') return { status: 'no-progress' };
    return { status: 'error' };   // EACCES/JSON corrupto → '?' + keep-last-good en el render
  }
}
```

### Pattern 3: Columna condicional (mold deriveAnyGsd) + celda no-color con degradados (mold taskCell)
```javascript
// select.js — flag estructural sobre el set SIN filtrar (igual que deriveAnyGsd, Pitfall 4 Phase 44)
export function deriveAnyProgress(rows) {
  return rows.some((r) => r.progress != null);  // alguna fila tiene artefacto legible
}

// format.js — celda no-color (mold taskCell): truncado anti-DoS via truncate:true en SessionTable
export function progCell(session) {
  const p = session.progress;                          // { status, n, m, completed } enriquecido CLIENT-SIDE en App.js
  if (!p || p.status === 'no-progress') return { text: '—', dim: true };
  if (p.status === 'error') return { text: '?', dim: true };  // keep-last-good lo maneja App.js
  const suffix = p.completed ? '✓' : '';
  return { text: `${p.n}/${p.m}${suffix}`, dim: false };       // "1/3", "3/3✓"
}
```

### Anti-Patterns to Avoid
- **Acumular contadores de eventos** (`count(TaskCreated)`): frágil ante misses. D-04 manda recuento del tasks-dir. El spike usó acumulación solo como prueba de concepto.
- **Append al `session-start.js`**: rompe golden-bytes HOOK-02. El hook es un archivo SEPARADO.
- **Tomar el `.lock` del tasks-dir**: el spike fue explícito (Pitfall 3) — leer never-throws SIN lock; el `.lock` es de Claude Code.
- **Leer `~/.claude/tasks/` desde el dashboard**: el dashboard SOLO lee el artefacto kodo. Acoplar el render a internals viola el seam.
- **Hook command lento/síncrono sin mitigar**: ver Pitfall 1 — añade latencia a la sesión.
- **Enriquecer `progress` en `src/server.js` GET /status**: viola D-08 (cero endpoints nuevos, cero cambios server-side). La lectura del artefacto es CLIENT-SIDE en App.js (mold `readPlan`, `App.js:544`), lectura filesystem síncrona never-throws. A diferencia de `provider_state` (server-side por requerir `await ...resolve()`/red), `progress` NO se enriquece en el payload de `/status`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Correlación `session_id → task_id` | Parser propio de `state.json` | `findSession({sessionId})` | Round-trip ya probado; maneja sessions+history |
| Registro de hook sin clobber | Edición manual de `settings.json` | extender `installHooks()`/`addHook` | Ya idempotente, ya preserva hooks ajenos |
| Lectura never-throws + anti-ReDoS guard | Validación nueva del `task_id` | clonar el guard de `readLightPlan` (`String.includes`) | Mismo threat-model T-44-01 ya cubierto |
| Columna condicional aparecer/desaparecer | Aritmética de anchos manual | mold `deriveAnyGsd` + omitir elemento (flex de ink) | Ink recupera el ancho sin cálculo |
| Degradados `—`/`?`/keep-last-good | Lógica de color nueva | mold `taskCell` (dim plano, cero color propio) | Color-isolation intacta, NO_COLOR-safe |

**Key insight:** Phase 50 no inventa NADA. Cada pieza tiene un análogo exacto ya shipped y testeado (plan-ligero v0.11 para el seam; `provider_state` v0.10 para la columna degradada; `deriveAnyGsd` v0.11 para la condicionalidad; `readPlan` enrich client-side v0.11 para la lectura). El trabajo es clonar la forma, no diseñar.

## Runtime State Inventory

> Phase 50 es mayormente greenfield (artefacto + columna nuevos), pero el hook toca settings.json e introduce un datastore nuevo. Inventario de estado relevante:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/progress/<task_id>.json` (NUEVO datastore, write-owner kodo). `~/.claude/tasks/<session_id>/N.json` (READ-ONLY, propiedad de Claude Code — 32 dirs con N.json reales en la máquina hoy). | Crear `~/.kodo/progress/` con `mkdirSync recursive` en el hook (no asumir que existe). El dashboard tolera ENOENT (`—`). |
| Live service config | `~/.claude/settings.json` → claves `hooks.TaskCreated` / `hooks.TaskCompleted` (HOY AUSENTES — verificado). install.js debe añadirlas SIN tocar `SessionStart`/`Stop`/`SubagentStop` existentes (coexisten 5 hooks SessionStart de distintas herramientas — gsd, codeisland, orca). | Extender `installHooks()` con el patrón `addHook` (envoltura `{hooks:[...]}`). `uninstallHooks()` también debe limpiar los 2 nuevos eventos. |
| OS-registered state | Ninguno (no hay tareas de OS, ni pm2, ni launchd asociado a esta fase). | None — verificado: el hook es invocado por Claude Code, no por el OS. |
| Secrets/env vars | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` habilita la maquinaria `TaskCreate` (verificado presente). NO es un secreto de kodo; es un flag del entorno de Claude Code. | None para kodo; documentar como prerequisito ambiental — si el flag desaparece, los eventos no disparan (degrada a `—`, tolerado). |
| Build artifacts | Ninguno (sin compilación; JS plano sin build step). | None. |

**Riesgo de cohorte legacy:** 12/58 dirs `tasks/` son worktrees (inferencia del spike). Sesiones sin tasks-dir (quick/non-execute) → el hook nunca dispara para ellas → no hay artefacto → columna `—`. Tolerado por diseño (D-09).

## Common Pitfalls

### Pitfall 1: Latencia del hook síncrono (NUEVO — no anticipado por CONTEXT.md)
**What goes wrong:** `TaskCreated`/`TaskCompleted` disparan **síncronamente dentro del agentic loop** (doc oficial). Un hook command que arranca un proceso Node nuevo por evento cuesta ~50-150ms de cold-start; con varias tasks por wave, eso es latencia acumulada en la sesión. Success Criteria 1 exige "sin latencia".
**Why it happens:** A diferencia de eventos async (`FileChanged`, `WorktreeCreate`), estos son parte del turn flow; "slow hooks add latency to the session" (doc oficial verbatim).
**How to avoid:** Tres mitigaciones, en orden de preferencia: (1) marcar el hook `async: true` + `asyncRewake: true` en settings.json si la build lo soporta (verificar contra 2.1.175 en la tarea A2); (2) `timeout` bajo (p. ej. 2-3s) como red de seguridad — un hook que excede timeout no bloquea; (3) mantener el trabajo del hook mínimo (readdir + 1 writeFile, sin red, sin imports pesados — el `findSession` dinámico ya es lazy). El cuerpo propuesto es deliberadamente pequeño.
**Warning signs:** La sesión "tartamudea" al crear/completar tasks; el tiempo entre waves crece. La tarea A2 DEBE medir latencia, no solo presencia de disparo.

### Pitfall 2: Confundir el evento (trigger) con la fuente de verdad (tasks-dir)
**What goes wrong:** Tentación de derivar `N/M` del payload del evento (que solo trae UNA task). El payload no da el agregado.
**Why it happens:** El spike mostró `M=count(TaskCreated)` y es fácil copiarlo.
**How to avoid:** El evento es SOLO el trigger. El `N/M` SIEMPRE sale de `readdir ~/.claude/tasks/<session_id>/` (D-04). El payload solo aporta `session_id`.
**Warning signs:** El `N/M` no se auto-corrige tras un evento perdido; los números divergen del `ls` del tasks-dir.

### Pitfall 3: Tomar el `.lock` o tropezar con archivos no-task del tasks-dir
**What goes wrong:** El tasks-dir contiene `.lock` (0B) y `.highwatermark` además de los `N.json`. Contarlos como tasks infla `M`.
**Why it happens:** `readdir` los devuelve igual.
**How to avoid:** Filtrar `f.endsWith('.json') && !f.startsWith('.')`. NUNCA abrir/tomar el `.lock` (es de Claude Code; el spike Pitfall 3). Verificado: en la máquina, dirs activos tienen `.lock` + `.highwatermark` + `1.json…N.json`.
**Warning signs:** `M` cuenta de más; aparece un task fantasma.

### Pitfall 4: Status no-`completed` mal contados como N
**What goes wrong:** N debe ser `count(status==="completed")`. Status observados HOY en la máquina: `completed` y `pending`. Pero Claude Code podría emitir `in_progress`/`cancelled`/`blocked` en otras situaciones.
**Why it happens:** Asumir un set cerrado de status.
**How to avoid:** N = `count(status==="completed")` ESTRICTO (igualdad exacta, no "todo lo que no es pending"). Una task `cancelled` o `blocked` NO es completed → no infla N. M = total de `N.json`. Esto coincide con la derivación del spike (`(status=="completed")/total`).
**Warning signs:** `N > M` imposible; o un `cancelled` cuenta como done.

### Pitfall 5: Columna `prog` parpadea bajo filtro `/`
**What goes wrong:** Si `deriveAnyProgress` se computa sobre el set FILTRADO, teclear una query que oculta las filas con progreso hace desaparecer la columna y la tabla "salta".
**Why it happens:** Mismo bug que Phase 44 evitó (Pitfall 4 de `deriveAnyGsd`).
**How to avoid:** Computar `deriveAnyProgress(sorted)` sobre el set SIN filtrar en App.js — EXACTAMENTE como `deriveAnyGsd(sorted)` (App.js:331). La columna es estructural.
**Warning signs:** La columna aparece/desaparece al teclear `/`.

### Pitfall 6: Versión inferida (Pitfall 0 del spike)
**What goes wrong:** Asumir 2.1.174/anterior. El spike re-verificó 2.1.175 en primera persona.
**How to avoid:** La tarea A2 DEBE re-verificar `claude --version` en el momento de ejecutar (la build puede haber rotado). Hallazgos de esta research valen para 2.1.175.

## Code Examples

### Registro del nuevo hook en install.js (sin clobber)
```javascript
// src/hooks/install.js — añadir DENTRO de installHooks(), tras los addHook existentes.
// El patrón addHook YA usa la envoltura { hooks: [{ type:'command', command }] } — el mismo
// shape que SessionStart/Stop tienen en settings.json (verificado en vivo). NO usar el shape
// "plano" { type, command } que muestra la doc oficial: kodo/addHook envuelve, y mezclar shapes
// rompería la idempotencia del check `entry.hooks`.
const taskProgressCmd = `node "${join(kodoRoot, 'src', 'hooks', 'task-progress.js')}"`;
changed = addHook(settings.hooks, 'TaskCreated', taskProgressCmd) || changed;
changed = addHook(settings.hooks, 'TaskCompleted', taskProgressCmd) || changed;

// uninstallHooks(): extender el array de eventos a barrer.
for (const event of ['SessionStart', 'Stop', 'TaskCreated', 'TaskCompleted']) { /* ... */ }
```
Source: `src/hooks/install.js` (patrón `addHook` existente) + verificación en vivo de `~/.claude/settings.json`.

### Schema real de `N.json` (verificado en la máquina, 2.1.175)
```json
{ "id": "1",
  "subject": "Plan 34-02: Implement dashboard App component and CLI registration",
  "description": "...",
  "status": "completed",
  "blocks": [],
  "blockedBy": [] }
```
Keys observadas en 8 archivos: `{blockedBy, blocks, description, id, status, subject}` siempre; `activeForm` en algunos. Solo `id`, `status` son load-bearing para `N/M`. Status observados: `completed`, `pending`.

### Forma propuesta del artefacto `~/.kodo/progress/<task_id>.json`
```json
{ "n": 2, "m": 3, "completed": false, "updated_at": "2026-06-12T13:05:00.000Z" }
```
`completed: true` solo cuando `m > 0 && n === m` (habilita el sufijo `✓` sin re-derivar en el render). `updated_at` permite keep-last-good / debug. Campos mínimos por D-04/D-08.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `TodoWrite` + `PostToolUse`/`PreToolUse` para progreso | `TaskCreate`/`TaskUpdate` tools que **bypassean** PostToolUse/PreToolUse; eventos dedicados `TaskCreated`/`TaskCompleted` | Claude Code ~v2.1.142 (issue #20243) | El playbook de progreso de v0.11 NO transfiere; por eso el spike fue necesario. Phase 50 usa los eventos dedicados, no PostToolUse. |
| Hooks solo síncronos | `async: true` + `asyncRewake: true` para validación en background | Claude Code 2026 hooks | Permite mitigar la latencia del Pitfall 1 — verificar soporte en 2.1.175. |

**Deprecated/outdated:**
- Derivar progreso vía `TodoWrite`/`PostToolUse`: ya no aplica a las task-tools nuevas (#20243).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `TaskCreate` dispara durante un `execute-phase` real en worktree (`cwd=.bg-shell/<sid>/`) | A2 / Success Criteria | ALTO — es el load-bearing A2. La tarea 1 lo confirma empíricamente; si falla → cortar la fase (PROG-F1). |
| A2 | El hook command Node no añade latencia perceptible a la sesión | Pitfall 1 | ALTO — Success Criteria 1 lo exige; la tarea A2 debe MEDIRLO. Mitigable con async/timeout. |
| A3 | `async: true`/`asyncRewake: true` está soportado en 2.1.175 | Pitfall 1 / State of Art | MEDIO — si no, caer a `timeout` bajo + hook mínimo. Verificar en tarea A2. |
| A4 | El payload del hook trae `session_id` en worktree igual que en orquestador | Pattern 1 | BAJO — el spike lo probó en orquestador; el campo es del runtime, independiente del tipo de sesión. La tarea A2 lo re-confirma de paso. |
| A5 | N = `count(status==="completed")` cubre todos los status terminales relevantes | Pitfall 4 | BAJO — verificado `completed`/`pending` hoy; igualdad estricta es fail-safe ante status nuevos. |

## Open Questions (RESOLVED)

1. **¿`async: true`/`asyncRewake: true` está soportado y elimina la latencia en 2.1.175?**
   - **RESOLVED:** se cierra empíricamente en gate A2 (Plan 01) — el plan elige el modo según el veredicto. La tarea A2 prueba ambos modos (sync con timeout vs async) y mide; el plan adopta el que la evidencia respalde.
   - What we know: la doc lo menciona como recomendación para hooks de validación en background.
   - What's unclear (a cerrar en A2): si la build instalada lo respeta para `Task*` y si el artefacto se escribe a tiempo para el siguiente poll.

2. **¿El `task_id` del payload del hook (`"1"`, "2"...) colisiona con el `task_id` de kodo (UUID del provider)?**
   - **RESOLVED:** namespaces distintos — usar `found.session.task_id` (UUID), nunca `input.task_id`. El payload trae `task_id: "1"` (índice de Claude Code), DISTINTO del `task_id` UUID de kodo (`findSession` retorna el UUID).
   - What we know: son namespaces separados; el artefacto usa el UUID de kodo (vía `findSession`), no el `"1"` del payload.
   - Recommendation (aplicada en el plan): NO usar `input.task_id` para el nombre del artefacto. Usar `found.session.task_id`. Documentado en el plan para evitar el bug sutil.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Claude Code (build instalada) | eventos `Task*` + tasks-dir | ✓ | 2.1.175 | — (re-verificar en A2) |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | maquinaria `TaskCreate` | ✓ | =1 (verificado) | si ausente → eventos no disparan → columna `—` (tolerado) |
| `~/.claude/tasks/<sid>/` materializado | recuento `N/M` | ✓ | 32 dirs con N.json | ENOENT → `—` (tolerado D-09) |
| `~/.claude/settings.json` escribible | registro del hook | ✓ | — | install.js ya falla limpio si no se puede leer |
| Node (hook runtime) | `task-progress.js` | ✓ | ya es el runtime de kodo | — |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** ninguna crítica; toda ausencia degrada a `—` por diseño.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (node:test builtin) — el repo usa `npm test` con ~900 tests |
| Config file | none — tests en `test/*.test.js`, descubiertos por el runner |
| Quick run command | `node --test test/task-progress.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| A2 (gate) | `TaskCreate` dispara + sin latencia en worktree real | manual/empírico | instrumentación throwaway en `execute-phase` real | ❌ Wave 0 (es manual por naturaleza, como el spike) |
| PROG-02 | hook recuenta tasks-dir → escribe artefacto correcto | unit | `node --test test/task-progress.test.js` | ❌ Wave 0 |
| PROG-02 | never-throws ante ENOENT/JSON corrupto/sin sesión | unit | idem (casos degradados) | ❌ Wave 0 |
| PROG-02 | install/uninstall registra/limpia `TaskCreated`/`TaskCompleted` sin clobber | unit | `node --test test/install.test.js` (extender) | ⚠️ existe, extender |
| PROG-03 | `readProgress` mapea ok/no-progress/error | unit | `node --test test/progress.test.js` | ❌ Wave 0 |
| PROG-03 | `progCell` formatea `N/M`/`N/M✓`/`—`/`?` | unit | `node --test test/format.test.js` (extender) | ⚠️ existe, extender |
| PROG-03 | `deriveAnyProgress` sobre set sin filtrar | unit | `node --test test/select.test.js` (extender) | ⚠️ existe, extender |
| PROG-03 | columna `prog` no rompe color-isolation | unit | `test/format-isolation.test.js` (walker, auto-cubre) | ✓ auto |

### Sampling Rate
- **Per task commit:** `node --test test/<archivo-tocado>.test.js`
- **Per wave merge:** `npm test` (suite completa, cero regresiones — el repo exige 0 fail)
- **Phase gate:** `npm test` verde + confirmación A2 documentada antes de `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/task-progress.test.js` — hook: recuento correcto, filtrado de `.lock`/`.highwatermark`, never-throws, anti-traversal del task_id (incluye backslash), status estricto `completed`
- [ ] `test/progress.test.js` — `readProgress` ok/no-progress/error + anti-ReDoS guard
- [ ] Extender `test/install.test.js` — registro/limpieza de los 2 eventos nuevos sin tocar SessionStart/Stop
- [ ] Extender `test/format.test.js` — `progCell` (4 estados) + `rowCells` incluye `prog`
- [ ] Extender `test/select.test.js` — `deriveAnyProgress` sobre set sin filtrar
- [ ] Fixtures compartidas: tasks-dir sintético (`N.json` con mix de status) + artefacto de progreso de muestra, con HOME isolation (mismo patrón `kodoProgressDir`/`homedirFn` que `readLightPlan`)

## Security Domain

> `security_enforcement` ausente en config.json → tratado como habilitado. Superficie de seguridad pequeña (filesystem local, sin red, sin input de usuario remoto).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | `task_id` validado anti-traversal (`String.includes('/')`/`'\\'`/`'..'`) ANTES de construir la ruta del artefacto — reusar el guard de `readLightPlan` (T-44-01) |
| V5 (DoS) | yes | Truncado anti-DoS de la celda `prog` (`truncate:true` en SessionTable, mold T-43-03) — un artefacto con `n`/`m` absurdos no desborda la tabla |
| V6 Cryptography | no | sin secretos ni cripto en esta fase |
| V4 Access Control | no | filesystem local del usuario; sin multi-tenancy |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal vía `task_id` en nombre de artefacto | Tampering | Guard `String.includes` (NO regex, anti-ReDoS) — los TRES checks `/`/`\\`/`..`; ruta CONSTRUIDA con root fijo `~/.kodo/progress/` |
| ReDoS en matching de path | DoS | Cero compilación de regex desde input (mold `plan.js` D-13) — solo `String.startsWith/endsWith/includes` |
| Tabla desbordada por `n`/`m` gigantes | DoS | `truncate:true` en la celda (mold T-43-03 `provider_state`) |
| Hook lento bloquea/cuelga la sesión | DoS (self-inflicted) | `timeout` bajo + cuerpo mínimo + `async` si soportado (Pitfall 1) |
| JSON corrupto del artefacto crashea el dashboard | DoS | `readProgress` never-throws: JSON.parse en try/catch → `error`→`?` |

## Sources

### Primary (HIGH confidence)
- Verificación en primera persona, build instalada `claude 2.1.175`: schema de `~/.claude/tasks/<sid>/N.json` (32 dirs con N.json reales), status `completed`/`pending`, presencia de `.lock`/`.highwatermark`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, claves `hooks.*` de `settings.json` (TaskCreated/TaskCompleted AUSENTES hoy).
- `.planning/phases/49-live-progress-spike-hard-gate/49-SPIKE.md` — veredicto VIABLE, payload crudo del hook, round-trip `session_id→task_id`, riesgo A2.
- `src/cli/dashboard/plan.js` (`readLightPlan`), `format.js` (`taskCell`/`rowCells`), `select.js` (`deriveAnyGsd`), `SessionTable.js` (`COLS`, celda), `App.js` (`readPlan` enrich client-side), `hooks/install.js` (`addHook`), `hooks/session-start.js` (golden-bytes), `session/state.js` (`findSession`), `config.js` (`KODO_DIR`) — leídos verbatim.
- code.claude.com/docs/en/hooks — campos del payload `Task*`, registro en settings.json (sin matchers), exit-code semantics, **ejecución síncrona + latencia**.

### Secondary (MEDIUM confidence)
- WebSearch (code.claude.com docs + agregadores): confirmación de que `TaskCreated`/`TaskCompleted` no soportan matchers y siempre disparan; exit 2 bloquea.

### Tertiary (LOW confidence)
- Soporte de `async:true`/`asyncRewake:true` en 2.1.175 específicamente: doc lo menciona genéricamente; NO re-verificado en la build → A3 (Assumptions Log), confirmar en tarea A2.

## Metadata

**Confidence breakdown:**
- Standard stack (todo reuso interno): HIGH — código leído verbatim, patrones ya shipped.
- Mecanismo de captura (eventos + tasks-dir): HIGH — verificado en primera persona + doc oficial.
- Latencia del hook síncrono: MEDIUM — doc oficial clara, pero el impacto real en worktree no medido (A2/A3).
- A2 (disparo en worktree real): MEDIUM — inferido del spike, NO re-medido; la tarea 1 lo cierra.

**Research date:** 2026-06-12
**Valid until:** 2026-06-19 (7 días — Claude Code rota versiones rápido; re-verificar `claude --version` + schema tasks-dir en ejecución).
