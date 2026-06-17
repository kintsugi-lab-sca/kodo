# Phase 56: Tecla del dashboard - Research

**Researched:** 2026-06-17
**Domain:** ink/React TUI interaction machine + execFile orchestration (in-process host consumer)
**Confidence:** HIGH (todo verificado contra el código shippeado, no training data)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** El dashboard instancia el host cmux in-process vía `getHost('cmux', { exec/run, binary, logger })` y llama `host.listAgentSurfaces()` detectado por `typeof` al pulsar `a`. CERO endpoint nuevo en el server. Si el host no soporta el método o devuelve `[]` → footer informativo, nunca rompe.
- **D-02:** El set-difference se hace contra el snapshot vivo de `GET /status` que el dashboard YA tiene polleado — adoptables = surfaces `kind=="claude"` cuyo `sessionId` NO está entre los `session_id` de las sesiones del último `/status`. **Keyeado por `sessionId`, NUNCA por `workspaceRef`.** NO read nuevo de `state.json`. Helper puro React-free (`computeAdoptable(surfaces, statusSessions)`), molde de `select.js`.
- **D-03:** Descubrimiento on-demand (NO poll loop): `a` → discover. Overlay picker (`mode:'overlay'`, 5º consumidor tras c/l/p) listando adoptables (cwd + `sessionId` corto + `kind`), snapshot congelado bajo el poll vivo, `Esc` preserva cursor. 0 adoptables / host sin soporte → footer informativo, sin abrir overlay.
- **D-04:** Double-confirm espejo Phase 42: dentro del picker, seleccionar surface + armar adopt → prompt `adopt <ref>? press a again · Esc cancel`, armado por **identidad** (`sessionId`) → segunda `a` ejecuta, `Esc` cancela.
- **D-05:** `kodo adopt` exige `--project <id>`; el descubrimiento NO devuelve proyecto. Un helper puro hace reverse-lookup `cwd → projectId` contra `loadProjects()`. Match único e inequívoco → se usa. Sin match o ambiguo → footer never-throws (`no/ambiguous project for <cwd> — adopt via kodo adopt --project <id>`) y NO se shellea. **FLAG planner:** confirmar shape de `projects.json` + decidir semántica de match (cwd exacto vs ancestro). → **RESUELTO abajo.**
- **D-06:** `runAdopt({ exec, binary, ... })` molde de `runFocus`/`runOpen`: never-throws `{ok}`, `exec` inyectado SIN default (leak guard estructural), timeout 5s. argv LITERAL sin shell: `['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId, '--project', projectId]`. `binary` = ejecutable kodo. SIN `--title` (core aplica `basename(cwd)`). SIN `--json`.
- **D-07:** Resultado `{ok}` → footer transitorio (verde éxito / rojo error con code). Espejo de OPEN_OK/DISMISS_ERR. never-throws end-to-end; cero unmount del panel ink. Exit codes de `kodo adopt` (0 ok / 1 config / 2 transient) reflejados como detalle del footer.
- **D-08:** Color isolation preservado: módulos nuevos importan SOLO `node:*` o internos puros; CERO `picocolors`, CERO `src/cli/format.js`. Walker `test/format-isolation.test.js` lo verifica.

### Claude's Discretion
- Nombres exactos de sub-modos del picker + máquina de confirm (`mode:'adopt-pick'` vs reuso de `overlay`+`confirm`) — planner elige el state-machine mínimo que respete D-03/D-04.
- Semántica del reverse-lookup `cwd → projectId` (match exacto vs ancestro más cercano).
- Resolución del path del binario kodo (`process.argv[1]` vs `loadConfig().kodo.binary` vs `'kodo'` en PATH).
- Copy exacta del footer y eventos NDJSON.
- Estructura del helper de diff (puro separado `computeAdoptable` vs inline) — recomendado puro testeable.

### Deferred Ideas (OUT OF SCOPE)
- Título inteligente derivado de cwd/commits/transcript → Phase 57 (ORCH-01).
- Auto-derivar flags de `kodo adopt` desde el seam → Phase 54/57.
- Backfill de descripción desde transcript/diff → BIDIR-F2.
- Endpoint `GET /surfaces` → **rechazado** (violaría "cero endpoints nuevos").
- `createTask`/adopt hacia ClickUp + adapter local → BIDIR-F3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DETECT-02 | Tecla `a` sobre una sesión ad-hoc descubierta vía DETECT-01 → shells `kodo adopt` vía `execFile` sin shell (argv literal, espejo `focus.js`/`runOpen`), **cero endpoints nuevos** en `src/server.js`. Adoptables = surfaces `kind=="claude"` cuyo `sessionId` ∉ `state.json`. Discovery on-demand al pulsar (NO poll loop); double-confirm (espejo Phase 42); never-throws (panel ink montado). | `listAgentSurfaces()` shipeado y confirmado (`src/host/cmux.js:230`); `/status` rows portan `session_id` (set-difference; `src/server.js:444-463`); `runFocus`/`runOpen` molde de `runAdopt` (`focus.js:80`, `open.js:74`); `mode:'overlay'`+`mode:'confirm'` machinery en `App.js`; reverse-lookup `cwd→projectId` vía `loadProjects()` (`config.js:143`); 7 rutas fijas en `src/server.js` (cero a añadir). |
</phase_requirements>

## Summary

Phase 56 es un **consumidor puro y fino**: extiende `src/cli/dashboard/App.js` con una tecla `a` que (1) descubre surfaces ad-hoc in-process vía `host.listAgentSurfaces()` (Phase 55, ya shippeado), (2) diff contra el snapshot vivo de `/status` keyeado por `sessionId`, (3) presenta un overlay picker, (4) double-confirm, (5) shellea `kodo adopt` vía un nuevo `runAdopt` clon de `runFocus`/`runOpen`. Cero endpoints nuevos, never-throws, color isolation preservado.

**Todas las incógnitas críticas quedaron resueltas empíricamente contra el código shippeado:**
- El seam shipeó como **`listAgentSurfaces()`** (async, enumeración de dos pasos: `tree --all --json` → fan-out `surface resume show --json --surface <ref>`). Devuelve `AgentSurface[]` = `{ workspaceRef, cwd, sessionId, kind }`. NO está en `HOST_METHODS` (typeof-detected). Confirmado en `src/host/cmux.js:230-275` + `interface.js:27-42`.
- El `/status` row ES el `SessionRecord` con `...s` pass-through (`server.js:444-463`), así que **porta `session_id` literal** — el campo correcto para el set-difference (== `resume_binding.checkpoint_id`, NO `task_id`/`workspace_ref`).
- `loadProjects()` devuelve **`Record<string, string>`** (projectId → ruta local) — NO el shape `{default?}` que el CONTEXT.md flageó como posible. El reverse-lookup `cwd → projectId` es factible y determinista.
- El **binario kodo** se resuelve con el patrón canónico ya existente en `src/cli/polling.js:180-183` (`resolveKodoBin()` → `bin/kodo` + `process.execPath`). NO `process.argv[1]`, NO `'kodo'` en PATH, NO config field.

**Primary recommendation:** Reusar el `mode:'overlay'` para el picker y un `mode:'confirm'` paralelo para el double-confirm (NO inventar dos modos nuevos). Crear `runAdopt` (clon de `runOpen` con `binary` resuelto vía `resolveKodoBin`-equivalente + argv literal de 8 elementos) y un helper puro `computeAdoptable` en `select.js`. Wirear el host cmux + `onAdopt` callback en `index.js` (espejo de `onFocus`/`onOpen`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Descubrimiento de surfaces | Host (`src/host/cmux.js`) | — | Regla transversal LOCKED: todo lo cmux vive en `src/host/`. Ya shippeado (Phase 55). |
| Set-difference adoptables | Dashboard (derive puro `select.js`) | — | D-02/D-06 Phase 55: el diff vive en el consumer, keyeado por `sessionId`. |
| Reverse-lookup `cwd → projectId` | Dashboard (derive puro) | — | D-05: el dashboard resuelve el dato de entrada; lee el mismo mapa que `adopt.js`. |
| Creación de la tarea | CLI `kodo adopt` (proceso hijo) | Core `adoptSession` | Una fontanería, tres consumidores: el dashboard NO crea la tarea, shellea el CLI. |
| Orquestación UI (modos/teclas/footer) | Dashboard (`App.js`) | — | Capa de presentación + interacción. |
| Shell never-throws | Dashboard (`runAdopt`) | — | Molde de `runFocus`/`runOpen`; encapsula la única llamada a `execFile`. |

## Standard Stack

No se instalan paquetes nuevos. Phase 56 es código interno puro sobre dependencias ya presentes.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ink | (ya instalado) | TUI React renderer | Base del dashboard desde Phase 34. |
| react | (ya instalado) | Componentes | idem. |
| ink-testing-library | (ya instalado) | Tests de interacción | Molde de `app-dismiss.test.js`/`app-focus.test.js`. |
| node:child_process (`execFile`) | builtin | Shell de `kodo adopt` | Patrón `runFocus`/`runOpen`. |

**No hay Package Legitimacy Audit** — cero paquetes externos instalados en esta fase.

## Architecture Patterns

### System Architecture Diagram

```
   operador pulsa `a` (mode:'list')
            │
            ▼
   ┌─────────────────────────────────────────┐
   │ App.js useInput handler `a`              │
   │  (async, never-throws)                   │
   └─────────────────────────────────────────┘
            │
            ▼  onAdoptDiscover?.()  (DI prop, like onFocus/onOpen)
   ┌─────────────────────────────────────────┐
   │ host.listAgentSurfaces()  [typeof-gated] │  ← in-process, NO endpoint
   │  src/host/cmux.js (Phase 55)             │
   │  tree --all --json → fan-out resume show │
   └─────────────────────────────────────────┘
            │  AgentSurface[] = {workspaceRef,cwd,sessionId,kind}
            ▼
   ┌─────────────────────────────────────────┐
   │ computeAdoptable(surfaces, statusSess.)  │  ← pure, select.js
   │  filter kind=='claude'                   │
   │  diff: sessionId ∉ status[].session_id   │  ← live /status snapshot (D-02)
   └─────────────────────────────────────────┘
            │  adoptable[]
            ├── empty / host unsupported ──► footer "no adoptable sessions found" (mode stays list)
            ▼
   ┌─────────────────────────────────────────┐
   │ mode:'overlay' picker (frozen snapshot)  │  ← reuse c/l/p overlay machine
   │  ↑↓ move cursor over adoptable[]         │
   └─────────────────────────────────────────┘
            │  operador selecciona + arma (`a`)
            ▼
   ┌─────────────────────────────────────────┐
   │ resolveProjectId(cwd, projects)  [pure]  │  ← reverse-lookup, D-05
   └─────────────────────────────────────────┘
            ├── no/ambiguous match ──► footer "no/ambiguous project for <cwd>" (NO shell)
            ▼  mode:'confirm' (armed by sessionId) — 2nd `a`
   ┌─────────────────────────────────────────┐
   │ onAdopt?.({workspaceRef,cwd,sessionId,   │  ← runAdopt clon de runOpen
   │            projectId})                   │
   │  execFile(kodoBin, ['adopt', ...argv])   │  ← NO shell, argv literal
   └─────────────────────────────────────────┘
            │  {ok} | {ok:false, code, detail}
            ▼
   footer transitorio verde/rojo (D-07) → próximo /status muestra la fila
```

### Recommended Project Structure

```
src/cli/dashboard/
├── App.js          # EXTENDER: handler `a`, picker mode, confirm mode, footer copies, help line
├── adopt.js        # NUEVO: runAdopt (clon de open.js) + AdoptResult typedef
├── select.js       # EXTENDER: computeAdoptable() + resolveProjectId() (pure derives)
└── index.js        # EXTENDER: getHost('cmux') wiring + onAdoptDiscover/onAdopt props

test/dashboard/
├── adopt.test.js       # NUEVO: runAdopt never-throws (clon de open.test.js)
├── app-adopt.test.js   # NUEVO: handler `a` + picker + confirm (clon de app-dismiss.test.js)
└── select-adopt.test.js # NUEVO: computeAdoptable + resolveProjectId puros
```

### Pattern 1: `runAdopt` — clon estructural de `runOpen` (D-06)

**What:** Orquestador never-throws de `execFile(kodoBin, ['adopt', ...argv])`.
**When to use:** El handler de confirm (`App.js`) lo invoca vía `onAdopt` prop.
**Differences from `runOpen`:**
- argv es un array LITERAL de 8 elementos (no un único positional): `['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId, '--project', projectId]`.
- `binary` = el ejecutable kodo (NO `'open'`, NO `cmux`). Ver Pattern 3 para resolución.
- SIN allowlist de protocolo (eso es específico de `open.js`). Los 4 valores de argv vienen de datos confiables del host + el reverse-lookup; execFile los pasa como elementos argv literales (metacaracteres de shell inertes).
- El discriminante `AdoptResult` reusa el union de `FocusResult`: `{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}`.

```javascript
// Source: clon de src/cli/dashboard/open.js:74-129 (verificado)
// src/cli/dashboard/adopt.js
export function runAdopt({ exec, binary, workspaceRef, cwd, sessionId, projectId, timeoutMs = 5_000 }) {
  if (typeof exec !== 'function') {
    throw new TypeError('runAdopt: `exec` is required (no default — leak guard).');
  }
  return new Promise((resolve) => {
    try {
      const argv = ['adopt', '--workspace', workspaceRef, '--cwd', cwd, '--session-id', sessionId, '--project', projectId];
      exec(binary, argv, { timeout: timeoutMs }, (err, _stdout, _stderr) => {
        if (!err) { resolve({ ok: true }); return; }
        if (err.code === 'ENOENT') { resolve({ ok: false, code: 'ENOENT', detail: err.message ?? 'ENOENT' }); return; }
        if (typeof err.code === 'number') { resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: err.code }); return; }
        resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message ?? String(err) });
      });
    } catch (err) {
      resolve({ ok: false, code: 'SPAWN_ERROR', detail: err instanceof Error ? err.message : String(err) });
    }
  });
}
```

**⚠ CRÍTICO — exit codes vs `err.code`:** `runOpen`/`runFocus` mapean `typeof err.code === 'number'` → `NON_ZERO_EXIT` con `detail` = el exit code. `kodo adopt` usa exit codes semánticos (0 ok / 1 config / 2 transient POST, `adopt.js:144-160`). El `detail` de `NON_ZERO_EXIT` será **1 o 2** literal — el footer puede mostrar `adopt failed (code 1)` / `(code 2)`. El dashboard NO reimplementa la semántica; shellea y reporta el número (D-07).

### Pattern 2: `mode:'overlay'` para el picker + `mode:'confirm'` para el double-confirm

**What:** Reusar la machinery existente de modos en `App.js` en vez de inventar `mode:'adopt-pick'`.
**The `mode` typedef** (`App.js:273`): `'list' | 'filter' | 'overlay' | 'confirm'`. El picker encaja en `'overlay'` (5º consumidor tras c/l/p); el double-confirm encaja en `'confirm'` (2º consumidor tras dismiss).

**Picker (mode:'overlay'):**
- Reusa la rama `if (mode === 'overlay')` de `App.js:418-439`: Esc cierra (incrementa `overlayReqRef`, restaura `mode:'list'`), ↑/↓ scrollean. El problema: el overlay actual asume `overlaySnapshot.lines` (strings de texto) + scroll; el picker necesita un **cursor seleccionable**, no solo scroll de lectura.
- **Decisión de planner:** o bien (a) añadir un campo `overlaySnapshot.kind === 'adopt'` con un índice de cursor seleccionable (↑/↓ mueven cursor, no scroll), o (b) un nuevo `mode:'adopt-pick'` con su propia rama. **Recomendación: opción (a)** si el número de adoptables cabe en el viewport (normalmente 1-5 sesiones ad-hoc), evitando el scroll; un cursor sobre `adoptable[]` con clamp [0, len-1] (molde `resolveSelection` de `select.js`). Esto mantiene el `mode` typedef en 4 estados (D-08 minimal state-machine, Karpathy regla 2).

**Double-confirm (mode:'confirm'):**
- El dismiss usa `armedTaskId`/`armedTaskRef` (`App.js:260-261`) + la rama `if (mode === 'confirm')` (`App.js:445-477`). El espejo de adopt necesita un `armedSessionId` (D-04: armado por `sessionId`, NUNCA índice ni snapshot de fila).
- **⚠ COLISIÓN DE TECLA:** El dismiss usa `d` como segunda tecla; adopt usa `a`. La rama `mode === 'confirm'` actualmente hace `if (input === 'd') { ...execute... } else { ...cancel... }`. Si el picker entra a `mode:'confirm'`, la rama debe discriminar **qué** confirm está armado. Recomendación: añadir un campo de estado `confirmKind: 'dismiss' | 'adopt'` (o derivar de cuál armed-id está set: `armedTaskId` vs `armedSessionId`) y rutear la segunda tecla (`d` para dismiss, `a` para adopt). Esc cancela ambos.

### Pattern 3: Resolución del binario kodo (D-06, Claude's Discretion)

**Canonical pattern ya existe** en `src/cli/polling.js:180-183` (VERIFIED):

```javascript
// Source: src/cli/polling.js:180-183 (verificado) — el daemon spawn ya shellea kodo a sí mismo
function resolveKodoBin() {
  // src/cli/polling.js → ../../bin/kodo
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'kodo');
}
// uso: spawn(process.execPath, [KODO_BIN, 'polling', 'start', ...], {...})
```

`bin/kodo` existe y es `#!/usr/bin/env node` + `import('../src/cli.js')` (VERIFIED).

**Recomendación para el planner:** Espejo del patrón de polling. Desde `src/cli/dashboard/index.js`, resolver `bin/kodo` con `join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'kodo')` (¡ojo a la profundidad: `dashboard/index.js` está un nivel más abajo que `cli/polling.js` → tres `..`). Luego invocar `execFile(process.execPath, [kodoBin, 'adopt', ...argv])` — NO `execFile(kodoBin, ['adopt', ...])` directamente, porque `bin/kodo` depende del shebang resuelto por el OS. **Esto diverge de `runOpen`/`runFocus`** (que invocan `execFile(binary, args)` donde `binary` es un ejecutable directo). El binario es `process.execPath` (node) y `bin/kodo` es el primer argv — exactamente como `polling.js:287-294`.

**Implicación para `runAdopt`:** el argv literal debe ser `[KODO_BIN, 'adopt', '--workspace', ...]` y `binary` debe ser `process.execPath`. O bien `runAdopt` toma `binary` (= execPath) + `kodoBin` (= bin/kodo) por separado. Recomendación: `runAdopt({ exec, execPath, kodoBin, workspaceRef, cwd, sessionId, projectId })` con argv `[kodoBin, 'adopt', ...8 elems]`. Rationale: cero PATH lookup (mitigación de elevation-of-privilege, mismo razonamiento que `polling.js:175-176`), determinista, usa el mismo node que corre el dashboard.

### Pattern 4: Reverse-lookup `cwd → projectId` (D-05, RESUELTO)

**`loadProjects()` shape — VERIFIED (`config.js:142-151`):**
```javascript
/** @returns {Record<string, string>} projectId -> local path */
export function loadProjects() { ... return JSON.parse(...); }  // o {} si ausente/corrupto
```
**NO es `{default?}`** — es un mapa plano `projectId → ruta absoluta`. El flag del CONTEXT.md queda resuelto: shape simple. (Nota: `adopt.js:105` SÍ tiene un guard `typeof entry === 'string' ? entry : (entry.default ?? '')` defensivo por si una entrada fuera un objeto, pero el typedef y `saveProjects` confirman `Record<string,string>`.)

**Semántica de match recomendada (Claude's Discretion):** El reverse-lookup invierte `projectId → path` a `path → projectId`. La surface da `cwd`; el proyecto da `path`. Dos opciones:
- **(a) Match exacto:** `cwd === projectPath`. Simple, cero ambigüedad, pero falla si la sesión ad-hoc corre en un subdirectorio del proyecto (común: el operador abre claude en `proyecto/src/`).
- **(b) Ancestro más cercano:** el `projectPath` que sea prefijo de `cwd` (con boundary de separador de path) y, entre varios, el más largo (más específico). Más útil en la práctica.

**Recomendación: (b) ancestro más cercano, con guard de ambigüedad.** Algoritmo puro:
```javascript
// src/cli/dashboard/select.js — pure, React-free, testeable
export function resolveProjectId(cwd, projects) {
  // projects: Record<projectId, path>. Devuelve { projectId } | { error: 'none'|'ambiguous' }.
  const norm = (p) => p.replace(/\/+$/, '');  // strip trailing slash
  const c = norm(cwd);
  const matches = Object.entries(projects).filter(([, path]) => {
    const p = norm(path);
    return c === p || c.startsWith(p + '/');  // exacto o descendiente (boundary-safe)
  });
  if (matches.length === 0) return { error: 'none' };
  // Desempate: ancestro más largo (más específico). Si DOS paths idénticos mapean
  // a projectIds distintos → ambiguo (no determinista).
  matches.sort((a, b) => norm(b[1]).length - norm(a[1]).length);
  if (matches.length > 1 && norm(matches[0][1]).length === norm(matches[1][1]).length) {
    return { error: 'ambiguous' };
  }
  return { projectId: matches[0][0] };
}
```
**Ambigüedad real:** dos proyectos con el mismo path (config mal puesta) o nested projects donde el cwd cae bajo ambos con el mismo prefijo-longitud. Footer never-throws (`no/ambiguous project for <cwd> — adopt via kodo adopt --project <id>`, D-05) y NO shellea. Esto es el único punto que puede impedir el shell, y falla ruidoso hacia el escape-hatch del CLI.

**⚠ Seguridad/normalización:** usar `path.resolve()` o normalización consistente en AMBOS lados (cwd y projectPath) antes de comparar, para evitar falsos negativos por `./`, `//`, o symlinks. Considerar `realpathSync` solo si los paths existen — pero eso es I/O; el helper debe permanecer puro (recibir paths ya normalizados o normalizar con `path.normalize`, no `realpathSync`). Decisión de planner.

### Anti-Patterns to Avoid

- **Keyear el diff por `workspaceRef`:** cmux recicla `workspace:N` (defensa Phase 43, D-06 Phase 55). SIEMPRE `sessionId`.
- **Añadir un endpoint `GET /surfaces`:** rechazado (D-01). El descubrimiento vive in-process. El server tiene exactamente 7 rutas (`server.js:411,417,495,501,529,550,556`) — NINGUNA se añade.
- **Hacer un read nuevo de `state.json`:** D-02 reusa el snapshot vivo de `/status` (que ya porta `session_id` via `...s` pass-through, `server.js:447`).
- **Default en `exec` de `runAdopt`:** el leak guard ESTRUCTURAL exige `exec` sin default (TypeError si se omite). Espejo `focus.js:85`/`open.js:78`.
- **Poll loop de descubrimiento:** D-03 exige on-demand al pulsar `a`. NO un `usePoll` de surfaces.
- **`import { runAdopt }` síncrono en index.js sin lazy:** el resto de imports de dashboard son lazy (`index.js:111,114`). Mantener el patrón.
- **Reusar `armedTaskId` para adopt:** el dismiss arma por `task_id`; adopt arma por `sessionId`. Estados distintos (la surface NO tiene task_id — no es una fila de `/status`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shell never-throws | Un wrapper de execFile ad-hoc | Clon de `open.js` (`runAdopt`) | El molde ya resuelve ENOENT/NON_ZERO_EXIT/SPAWN_ERROR/sync-throw + leak guard. |
| Descubrimiento de surfaces | Parsear cmux desde el dashboard | `host.listAgentSurfaces()` | Regla LOCKED: todo cmux en `src/host/`. Ya shippeado y testeado (Phase 55). |
| Resolución del binario kodo | `'kodo'` en PATH / `process.argv[1]` | `resolveKodoBin()` pattern (`polling.js:180`) | Cero PATH lookup, determinista, mitigación EOP, mismo node. |
| Set-difference / selección | Lógica inline en el componente | Helper puro en `select.js` | Testeable sin host React; molde `resolveSelection`/`grepLogs`. |
| Footer transitorio | Un sistema de notificaciones nuevo | `focusError`+`footerColor` state (`App.js:247,254`) | Ya existe el clear-on-any-input + render condicional. |
| Double-confirm | Un timer/timeout de confirmación | `mode:'confirm'` armed-by-identity (`App.js:445`) | Persistente sin timer, Esc cancela. Espejo Phase 42. |

**Key insight:** Phase 56 NO tiene lógica de negocio nueva. Cada pieza tiene un molde 1:1 ya shipeado y testeado. El riesgo no es técnico sino de fidelidad: clonar los moldes exactamente (leak guard, never-throws, identidad estable, color isolation).

## Runtime State Inventory

No aplica como migración, pero el **set-difference depende de runtime state** ya en memoria:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `state.json` (sessions) — NO se lee directamente; se consume vía el snapshot vivo de `/status` que el dashboard ya pollea (D-02). | Ninguna — reusar `sessions` ya en React state (`App.js:266`). |
| Live service config | cmux surfaces ad-hoc descubiertas on-demand vía `listAgentSurfaces()`. NO persistidas en git/state. | Descubrir al pulsar `a` (in-process). |
| OS-registered state | Ninguna — None, verificado: el dashboard no registra nada en el OS. | None. |
| Secrets/env vars | Ninguna nueva. `kodo adopt` hereda el entorno del proceso padre (provider tokens via `~/.kodo/.env`). | None — el hijo hereda env por `execFile` default. |
| Build artifacts | Ninguna — código JS puro, sin compilación. | None. |

**Canonical question:** Tras el shell de `kodo adopt`, la nueva tarea se persiste en `state.json` por el core (`adoptSession`); el dashboard la verá en el **próximo tick de `/status`** (no requiere refresh manual — `usePoll` sigue corriendo bajo el overlay/confirm, D-05 Phase 42).

## Common Pitfalls

### Pitfall 1: ink NO awaitea el handler async — keystrokes encadenados usan el closure viejo
**What goes wrong:** El segundo `a` (confirm) puede ejecutarse antes de que React re-renderice con `mode:'confirm'`, usando el `mode` viejo.
**Why it happens:** `useInput` es async pero ink no espera el return; el state update llega tarde.
**How to avoid:** En tests, usar `drain()` con `setTimeout(80ms)` (NO `setImmediate`) entre keystrokes encadenados — molde EXACTO de `app-dismiss.test.js:81-89` y `app-focus.test.js`. En runtime no es problema (el operador teclea con gaps humanos). El comentario de `app-dismiss.test.js:81` lo documenta: "80ms es load-bearing (más corto es flakey en CI)".

### Pitfall 2: La segunda tecla del confirm colisiona entre dismiss (`d`) y adopt (`a`)
**What goes wrong:** La rama `if (mode === 'confirm')` (`App.js:445`) hardcodea `if (input === 'd')`. Si adopt entra al mismo `mode:'confirm'`, una `a` no ejecutaría (caería al else=cancel) y una `d` ejecutaría el dismiss equivocado.
**Why it happens:** Un solo `mode:'confirm'` con dos consumidores que esperan teclas distintas.
**How to avoid:** Discriminar por estado armado: `confirmKind` explícito o derivar de `armedSessionId != null` (adopt) vs `armedTaskId != null` (dismiss). La segunda tecla correcta (`a` o `d`) ejecuta; Esc/otra cancela ambos. **Esta es la decisión de state-machine más delicada de la fase.**

### Pitfall 3: El picker necesita cursor seleccionable, el overlay c/l/p solo tiene scroll de lectura
**What goes wrong:** Reusar `mode:'overlay'` tal cual da scroll (↑/↓ mueven `scrollOffset`), no un cursor para elegir una surface.
**Why it happens:** El overlay c/l/p (`App.js:418-439`) está diseñado para leer texto, no seleccionar filas.
**How to avoid:** Añadir un estado de cursor para el picker (índice clamped sobre `adoptable[]`) y rutear ↑/↓ a mover cursor cuando `overlaySnapshot.kind === 'adopt'`, no scroll. Molde de la navegación de lista (`App.js:667-676` con clamp [0, len-1] sin wrap).

### Pitfall 4: El argv de `runAdopt` debe ser `[kodoBin, 'adopt', ...]` con `process.execPath` como binario
**What goes wrong:** Invocar `execFile('bin/kodo', ['adopt', ...])` puede fallar si el shebang no se resuelve (permisos, entorno) o no ser determinista.
**Why it happens:** `bin/kodo` es un script con shebang `#!/usr/bin/env node`, no un binario nativo.
**How to avoid:** Espejo de `polling.js:286-294`: `execFile(process.execPath, [KODO_BIN, 'adopt', ...argv])`. El binario es node; `bin/kodo` es el primer argv.

### Pitfall 5: Olvidar el `kind == 'claude'` filter en `computeAdoptable`
**What goes wrong:** `listAgentSurfaces()` NO filtra por kind (D-05 Phase 55, `cmux.js:64-65`: "NO se filtra por `kind` aquí — el consumer decide"). Si `computeAdoptable` tampoco filtra, surfaces no-claude entrarían al picker.
**Why it happens:** El filtro es responsabilidad explícita del consumer (DETECT-02: "adoptables = surfaces con `kind == "claude"`").
**How to avoid:** `computeAdoptable` filtra `kind === 'claude'` Y `sessionId ∉ statusSessions` en el mismo pase.

### Pitfall 6: Color isolation — el nuevo `adopt.js` no debe importar picocolors/format.js
**What goes wrong:** Importar un helper de color rompe el walker `test/format-isolation.test.js:209-220` (escanea `src/cli/dashboard/**`).
**Why it happens:** El color del TUI sale solo de `<Text color>` de ink (D-08/D-12).
**How to avoid:** `runAdopt` y `computeAdoptable`/`resolveProjectId` importan SOLO `node:*` o internos puros. El walker lo verifica automáticamente (ya verde para `focus.js`/`open.js`/`select.js`/`client.js`).

## Code Examples

### Wiring del host + callbacks en index.js (espejo de onFocus/onOpen)
```javascript
// Source: src/cli/dashboard/index.js:109-144 (verificado — extensión)
// Lazy import (mismo patrón que runFocus/runOpen)
const { runAdopt } = await import('./adopt.js');
const { getHost } = await import('../../host/interface.js');

// Host cmux in-process (D-01) — typeof-detected en App.js
const host = getHost('cmux', { exec: execImpl, binary: cmuxBin, logger: undefined });

// Resolución del binario kodo (Pattern 3)
const { fileURLToPath } = await import('node:url');
const { join, dirname } = await import('node:path');
const kodoBin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'kodo');

const app = render(createElement(App, {
  baseUrl,
  onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin }),
  onOpen: async (url) => runOpen({ exec: execImpl, url }),
  // Phase 56 D-01: discovery on-demand, typeof-gated (fail-open si el host no lo soporta)
  onAdoptDiscover: async () =>
    typeof host.listAgentSurfaces === 'function' ? host.listAgentSurfaces() : [],
  // Phase 56 D-06: shell never-throws de `kodo adopt`
  onAdopt: async ({ workspaceRef, cwd, sessionId, projectId }) =>
    runAdopt({ exec: execImpl, execPath: process.execPath, kodoBin, workspaceRef, cwd, sessionId, projectId }),
}));
```

### computeAdoptable (pure, select.js)
```javascript
// Source: molde de select.js derive helpers (verificado)
// src/cli/dashboard/select.js
export function computeAdoptable(surfaces, statusSessions) {
  // surfaces: AgentSurface[] = {workspaceRef, cwd, sessionId, kind}
  // statusSessions: el array `sessions` del snapshot /status (porta session_id, server.js:447)
  const tracked = new Set((statusSessions ?? []).map((s) => s.session_id).filter(Boolean));
  return (surfaces ?? []).filter(
    (s) => s.kind === 'claude' && s.sessionId && !tracked.has(s.sessionId),
  );
}
```

### Footer copies (App.js, espejo de OPEN_OK/DISMISS_*)
```javascript
// Source: molde de App.js:133-163 (verificado)
export const ADOPT_NONE = 'no adoptable sessions found';
export const ADOPT_CONFIRM = (ref) => `adopt ${ref}? press a again · Esc cancel`;  // espejo DISMISS_CONFIRM
export const ADOPT_OK = (ref) => `adopted ${ref}…`;                                 // espejo OPEN_OK (verde)
export const ADOPT_NO_PROJECT = (cwd) => `[!] no/ambiguous project for ${cwd} — use kodo adopt --project <id>`;
export const ADOPT_ERR_ENOENT = '[!] kodo not found — press any key';
export const adoptErrFailed = (code) => `[!] adopt failed (code ${code}) — press any key`;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Seam nombrado `describeSurface(ref)` (roadmap) | `listAgentSurfaces()` (enumeración → array) | Phase 55 D-01 | El consumer descubre TODAS las surfaces para el diff; no consulta una ref conocida. |
| `surface resume list` (asumido enumerador) | Dos pasos: `tree --all --json` → fan-out `surface resume show --json --surface <ref>` | Phase 55 impl (`cmux.js:219-275`) | `surface resume list` NO existe en cmux 0.64.16; la enumeración es fan-out con try/catch fila-a-fila. |
| `loadProjects()` shape `{default?}` (CONTEXT.md flag) | `Record<projectId, string>` plano | Verificado `config.js:142` | El reverse-lookup es directo `path → projectId`; sin desempaquetado de `{default}`. |

**Deprecated/outdated:** Ninguno relevante a esta fase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El número de surfaces ad-hoc adoptables cabe en el viewport (1-5 típico) → cursor sin scroll en el picker. | Pattern 2 | Si hay decenas, el picker necesita scroll+cursor combinados. Bajo riesgo: las sesiones ad-hoc activas son pocas. |
| A2 | El match `cwd → projectId` por ancestro más cercano es la semántica preferida del operador. | Pattern 4 | Si se prefiere match exacto, sesiones en subdirectorios fallarían al footer (escape-hatch CLI). Mitigado: falla ruidoso, nunca silencioso. Decisión de planner. |
| A3 | `kodo adopt` hereda el entorno (provider tokens) del proceso del dashboard al shellearse. | Runtime State | Si el dashboard corre sin los tokens en env, el adopt falla con exit 2 (transient) → footer rojo. Es el comportamiento esperado y observable. |

## Open Questions

1. **¿Picker como `overlaySnapshot.kind:'adopt'` (cursor) o `mode:'adopt-pick'` nuevo?**
   - What we know: el `mode` typedef tiene 4 estados; el overlay c/l/p hace scroll de lectura, no selección.
   - What's unclear: si añadir un campo de cursor al overlay existente es menos diff que un modo nuevo.
   - Recommendation: reusar `mode:'overlay'` con `kind:'adopt'` + estado de cursor (mantiene 4 modos, D-08 minimal). El planner decide; ambos respetan D-03/D-04.

2. **¿Cómo discriminar la segunda tecla del confirm entre dismiss (`d`) y adopt (`a`)?**
   - What we know: la rama `mode:'confirm'` hardcodea `input === 'd'`.
   - What's unclear: `confirmKind` explícito vs derivar de qué armed-id está set.
   - Recommendation: derivar de `armedSessionId != null` (adopt) vs `armedTaskId != null` (dismiss); rutear la tecla correcta. Test cubre ambos caminos.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `bin/kodo` | runAdopt shell | ✓ | (repo) | — (es el propio binario) |
| node (`process.execPath`) | runAdopt shell | ✓ | corre el dashboard | — |
| cmux | listAgentSurfaces | ✓ (runtime del operador) | 0.64.16 | host devuelve `[]` fail-open → footer "no adoptable sessions found" |
| ink/react/ink-testing-library | TUI + tests | ✓ | ya instalados | — |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** cmux ausente/caído → `listAgentSurfaces()` ya degrada a `[]` (Phase 55 D-05, `cmux.js:235-242`) → footer informativo.

## Validation Architecture

> `.planning/config.json` — verificar `workflow.nyquist_validation`. Si ausente/true, esta sección aplica.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (builtin) + `ink-testing-library` |
| Config file | none — tests corren con `node --test` |
| Quick run command | `node --test test/dashboard/adopt.test.js test/dashboard/select-adopt.test.js` |
| Full suite command | `node --test test/` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| DETECT-02 | `runAdopt` never-throws + argv literal de 8 elems + leak guard | unit | `node --test test/dashboard/adopt.test.js` | ❌ Wave 0 (clon de `open.test.js`) |
| DETECT-02 | `computeAdoptable` filtra kind=='claude' ∧ diff por sessionId | unit | `node --test test/dashboard/select-adopt.test.js` | ❌ Wave 0 |
| DETECT-02 | `resolveProjectId` ancestro/exacto + none/ambiguous | unit | `node --test test/dashboard/select-adopt.test.js` | ❌ Wave 0 |
| DETECT-02 | Handler `a` → discover → picker → confirm → onAdopt (integration-light) | integration | `node --test test/dashboard/app-adopt.test.js` | ❌ Wave 0 (clon de `app-dismiss.test.js`) |
| DETECT-02 | Cero endpoints nuevos en server | structural | `node --test` (assert 7 rutas) o revisión | ⚠ ver Wave 0 gaps |
| DETECT-02 | Color isolation (adopt.js sin picocolors) | structural | `node --test test/format-isolation.test.js` | ✅ (walker existente, auto-cubre `dashboard/**`) |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard/adopt.test.js test/dashboard/select-adopt.test.js`
- **Per wave merge:** `node --test test/dashboard/ test/format-isolation.test.js`
- **Phase gate:** `node --test test/` verde antes de `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/dashboard/adopt.test.js` — clon de `open.test.js` (5 escenarios never-throws + leak guard, argv ordering literal de 8 elems). Cubre DETECT-02.
- [ ] `test/dashboard/select-adopt.test.js` — `computeAdoptable` (filtro kind + diff sessionId) + `resolveProjectId` (exacto/ancestro/none/ambiguous). Cubre DETECT-02.
- [ ] `test/dashboard/app-adopt.test.js` — clon de `app-dismiss.test.js` (harness `injectProps` + `drain()` 80ms; teclas `a`→picker→`a`→onAdopt; Esc cancela; footer transitorio). Necesita `onAdoptDiscover`/`onAdopt` props inyectables.
- [ ] **Zero-endpoints assertion:** NO existe un test que cuente las rutas de `src/server.js` (verificado: el invariante se ha sostenido por disciplina/revisión, no por test). El planner puede añadir un structural test que asierte que `src/server.js` tiene exactamente 7 `req.url ===`/`startsWith` handlers, o confiar en code review. Recomendación: revisión + diff guard (la fase NO toca `src/server.js` en absoluto — el grep `git diff --stat src/server.js` debe estar vacío).
- Framework install: ninguno (builtin + ink-testing-library ya presente).

## Security Domain

> `security_enforcement` — verificar config. Asumido enabled (ausente = enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sin auth nueva. El adopt hereda los tokens del entorno del dashboard. |
| V3 Session Management | no | — |
| V4 Access Control | no | Operador local con acceso al TTY. |
| V5 Input Validation | yes | argv literal sin shell (no interpolación); `cwd`/`sessionId`/`workspaceRef` vienen del host (datos confiables filtrados por `normalizeSurface`, `cmux.js:46-67`, que valida que los 4 campos sean strings). `projectId` viene del reverse-lookup contra `loadProjects()` (mapa controlado por el operador). |
| V6 Cryptography | no | — |

### Known Threat Patterns for ink TUI + execFile

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection vía argv | Tampering / EoP | `execFile` (NO `exec`/shell): argv son elementos literales, metacaracteres inertes. Espejo `open.js` OPEN-03. |
| Flag injection (cwd empieza por `-`) | Tampering | Bajo riesgo: `cwd`/`sessionId` vienen de `resume_binding` validados como strings (`cmux.js:53-60`); `--cwd` los precede como flag explícita, así que un cwd con `-` se pasa como valor del flag previo, no como flag nueva. A diferencia de `open` (positional único), aquí cada valor va precedido de su `--flag`. |
| PATH hijack del binario kodo | EoP | `resolveKodoBin()` con path absoluto + `process.execPath` (cero PATH lookup). Mitigación T-26-EOP existente (`polling.js:175-176`). |
| Path traversal en reverse-lookup | Tampering | El `cwd` se compara contra `loadProjects()` (mapa del operador); no se usa para construir paths de filesystem ni se pasa a `readFileSync`. Solo string comparison. Normalizar con `path.normalize` (no `realpathSync` — mantiene pureza). |
| Throw que tira el árbol ink | DoS (UX) | never-throws end-to-end (D-07): `runAdopt` colapsa todo a `{ok}`; `listAgentSurfaces` ya es never-throws (Phase 55); el handler `a` es async sin re-throw. Cero `unmount`. |

## Sources

### Primary (HIGH confidence) — código shippeado verificado en esta sesión
- `src/host/cmux.js:46-275` — `listAgentSurfaces()` (async, dos pasos), `normalizeSurface`, `extractSurfaceRefs`. Confirma nombre/async/enumeración/never-throws.
- `src/host/interface.js:27-103` — `@typedef AgentSurface`, `HOST_METHODS` (4, sin listAgentSurfaces), `getHost('cmux', opts)` factory.
- `src/cli/dashboard/focus.js:54-118` — `runFocus`: leak guard, never-throws `{ok,code,detail}`, argv literal, timeout 5s.
- `src/cli/dashboard/open.js:74-129` — `runOpen`: variante con `binary` default + BAD_PROTOCOL. Molde de `runAdopt`.
- `src/cli/dashboard/App.js:54-762` — modos `list/filter/overlay/confirm`, dismiss double-`d` (`armedTaskId`, `mode:'confirm'`, `:445-477`), overlay c/l/p (`:418-439`), footer copies (`:133-163`), help line (`:760`), onFocus/onOpen props (`:190-198`).
- `src/cli/dashboard/index.js:69-166` — `resolveBaseUrl`, DI wiring, lazy imports, `onFocus`/`onOpen`, `cmuxBin` resolution (`:125`).
- `src/cli/dashboard/select.js:44-310` — derive helpers puros (sortSessions, resolveSelection, grepLogs, mapDismissResult) — molde de `computeAdoptable`/`resolveProjectId`.
- `src/cli/dashboard/client.js:49-204` — `/status` never-throws shape; `dismissSession` (DELETE). Confirma cómo el snapshot llega a React.
- `src/cli/adopt.js:32-211` — `runAdoptCli` input shape `{workspaceRef,cwd,sessionId,projectId,title?,description?,json?}`, `exitCodeFor` (0/1/2), reverse de `loadProjects()[projectId]`.
- `src/cli.js:248-277` — comando `adopt` (required `--workspace --cwd --session-id --project`, optional `--title --description --json`).
- `src/config.js:142-157` — `loadProjects()` → `Record<string,string>` (RESUELVE el flag D-05).
- `src/cli/polling.js:180-294` — `resolveKodoBin()` + `spawn(process.execPath, [KODO_BIN, ...])` (patrón canónico de auto-shell de kodo).
- `src/server.js:411-556` — las 7 rutas fijas (cero a añadir); `/status` enrichment con `...s` pass-through de `session_id` (`:444-463`).
- `src/session/state.js:13-44` — `Session` typedef (porta `session_id`, `project_path`, `task_id`).
- `test/host/contract.test.js:1-66` — `fakeExecFromFixtures` + `surface-resume-show.json` fixture (reusable como stub de host).
- `test/dashboard/app-dismiss.test.js:1-89` — harness `injectProps` + `drain()` 80ms + router de DELETE (molde del test del handler `a`).
- `test/dashboard/open.test.js:1-55` — esqueleto de 5 escenarios never-throws (molde de `adopt.test.js`).
- `test/adopt-cli.test.js:1-55` — DI mold del CLI handler.
- `test/format-isolation.test.js:200-221` — walker color isolation sobre `src/cli/dashboard/**` (D-08).
- `bin/kodo` — `#!/usr/bin/env node` + `import('../src/cli.js')`.
- `.planning/REQUIREMENTS.md:27-28` — DETECT-01/DETECT-02 texto canónico.

### Secondary / Tertiary
- Ninguna — todo se resolvió contra el código local (cero WebSearch necesario).

## Metadata

**Confidence breakdown:**
- Seam shipeado (nombre/async/enumeración): **HIGH** — leído `cmux.js`/`interface.js` directamente.
- `/status` row porta `session_id`: **HIGH** — `server.js:447` `...s` pass-through + `state.js:15` typedef.
- `loadProjects()` shape: **HIGH** — `config.js:142` typedef + impl.
- Binario kodo resolution: **HIGH** — patrón existente `polling.js:180`, `bin/kodo` verificado.
- Reverse-lookup semantics: **MEDIUM** — la feasibility es HIGH; la elección exacta (exacto vs ancestro) es discreción del planner (A2).
- State-machine del picker/confirm: **MEDIUM** — los moldes existen; la composición mínima (reuso de modos + discriminación de la 2ª tecla) tiene dos opciones válidas (Open Questions 1-2).

**Research date:** 2026-06-17
**Valid until:** 2026-07-17 (código interno estable; cmux 0.64.16 contract fixture-locked en Phase 55)
