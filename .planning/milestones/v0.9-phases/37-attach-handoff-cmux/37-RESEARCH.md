# Phase 37: Attach — handoff a cmux - Research

**Researched:** 2026-05-28
**Domain:** Handoff TTY desde ink (React TUI) hacia un proceso externo interactivo (cmux), con vuelta intacta al desmarcaje
**Confidence:** MEDIUM-HIGH overall · **CRITICAL gap surfaced en C-01** (semántica real del binario `cmux` divergente del CONTEXT.md)

## Summary

Phase 37 implementa la integración de mayor riesgo del milestone v0.9: `Enter` sobre la fila seleccionada del dashboard ink debe ceder el TTY a una invocación interactiva de `cmux`, y al detach volver al panel intacto. La arquitectura del handoff (loop `unmount → waitUntilExit → spawn(stdio:'inherit') → re-render`, never-throws con discriminated union, snapshot del cursor a través del intent, alt-screen toggle simétrico, no-op SIGINT durante la ventana) está LOCKED en `37-CONTEXT.md` D-01..D-13 y alineada con los patrones estándar para nested TUIs (vim shell-out, lazygit→nvim).

**Sin embargo**, durante el sondeo del binario instalado en este equipo (`/Applications/cmux.app/Contents/Resources/bin/cmux`, default de `loadConfig().cmux.binary`) surge un hallazgo crítico que el planner DEBE confirmar con el operador antes de empezar: **`cmux attach <workspace_ref>` no existe como subcomando**. `cmux` es una app macOS GUI con un socket de control; sus verbos de workspace son `select-workspace`, `new-workspace`, `list-workspaces`, etc. El subcomando más cercano semánticamente al "attach" del CONTEXT.md es `cmux select-workspace --workspace workspace:N`, que cambia el workspace activo dentro de la app GUI — pero NO secuestra el TTY del proceso parent. Ver §`C-01` para la disposición concreta (3 opciones, con recomendación) y §`Open Questions` Q1.

**Primary recommendation:** El planner debe escalar `C-01` al operador antes de generar PLAN.md. Toda la arquitectura del handoff D-01..D-12 (loop, never-throws, alt-screen, SIGINT no-op, snapshot) es correcta y aplicable a CUALQUIER invocación interactiva — pero el comando concreto (la string `'cmux'` + args) tiene que confirmarse contra la realidad del binario antes de validar UAT manual. Sin esa confirmación, el escenario UAT #1 ("`cmux attach workspace:N` toma el TTY") es no-reproducible.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Arquitectura del handoff: dueño del proceso (TUI-13)**
- **D-01:** El loop `unmount → spawn → re-render` vive en `runDashboard` (`src/cli/dashboard/index.js`) — único dueño del proceso. App.js NUNCA orquesta su propio desmonte y re-mount; solo emite intent y llama `useApp().exit()`.
- **D-02:** Seam intent↔runDashboard = mutable ref + callback prop. `runDashboard` crea `const intent = { value: null }` por iteración y pasa `onAttach(ref, snapshot) => { intent.value = { type:'attach', ref, snapshot }; exit(); }` como prop a `<App />`.
- **D-03:** `spawn` se inyecta en `runDashboard(deps)` — mismo patrón que `stdout`/`stdin`/`url`. `attach.js` recibe `spawn` como argumento (cero import eager).
- **D-04:** `attach.js` como módulo separado; exporta `runAttach({ spawn, ref, stdout })` — orquestador puro y testeable que retorna discriminated union `{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}` (jamás throw que llegue al loop).

**Pre-flight guard (TUI-14, criterio #3)**
- **D-05:** El guard `alive===false` corre en App.js DENTRO del handler de Enter, ANTES de emitir intent. Si `row.alive === false`, NO se llama `onAttach`; se fija `attachError = 'workspace gone'` y se renderiza el footer rojo. Cero unmount, cero spawn, App nunca se desmonta — el TTY ni se toca.

**Alt-screen + cursor durante el handoff (TUI-13, criterio #1)**
- **D-06:** Toggle simétrico del alt-screen alrededor del spawn:
  1. `stdout.write('\x1b[?1049l')` ANTES del spawn.
  2. `spawn(<binario interactivo>, [...args], { stdio:'inherit' })`.
  3. `await` close del child.
  4. `stdout.write('\x1b[?1049h')` ANTES del re-render.
  5. `render(<App initialSnapshot={...} initialError={...} />)`.
- **D-07:** NO añadir belt-and-suspenders de restauración de cursor/raw-mode. `ink.waitUntilExit()` ya lo garantiza por contrato.

**Estado post-detach: snapshot (criterio #2)**
- **D-08:** Snapshot `{selectedTaskId, query, mode}` viaja en el intent y se reaplica como prop del siguiente render: `<App initialSnapshot={snapshot} ... />`. App usa los valores como `useState` initializers.

**UX del mensaje de error (TUI-14, criterios #3 y #4)**
- **D-09:** El footer `↑↓ move · / filter · q quit` se reemplaza por el mensaje de error rojo, persistente hasta la próxima tecla. Cualquier tecla (incluida Esc — no choca con la reserva D-11 Phase 34 porque aquí no abre overlay, solo dismisses el error) limpia `attachError`/`initialError` y restaura el footer normal. SIN timers cosméticos.
- **D-10:** Tres mensajes literal-estables:
  - Zombie pre-flight: `[!] workspace gone (alive=false) — press any key`
  - ENOENT: `[!] cmux not found in PATH — press any key`
  - Non-zero exit / otros: `[!] cmux attach failed (code N) — press any key`
- **D-11:** Origen del error:
  - Zombie pre-flight: estado local en App (`useState(null)` de `attachError`), set en el Enter handler.
  - Post-spawn (ENOENT / non-zero): `runAttach` retorna `{ok:false, code, detail}`; runDashboard captura y pasa `<App initialError={msg} />` a la siguiente iteración.

**Manejo de señales durante la ventana (Pitfall 1)**
- **D-12:** Durante la ventana del attach (entre resolución de `waitUntilExit` y re-render):
  1. Install no-op SIGINT handler (`process.on('SIGINT', noop)`).
  2. Remove el handler de SIGTERM de Phase 34 D-10.
  3. Limpieza inversa al volver del spawn: `process.removeListener('SIGINT', noop)` + reinstalar `process.once('SIGTERM', onSigterm)`. Cero leak de handlers entre iteraciones.

**Artifact UAT (criterio #5, sin esto la fase NO está completa)**
- **D-13:** Markdown único `${phase_dir}/37-HUMAN-UAT.md` con 4 escenarios obligatorios (setup/steps/expected/observed/sign-off):
  - (1) Primer attach + vuelta limpia.
  - (2) Segundo attach consecutivo.
  - (3) Attach a workspace muerto (`alive===false`).
  - (4) Ctrl-C durante attach.

### Claude's Discretion

- Estructura granular de `attach.js`: ¿único módulo o split en `runAttach` + helpers (`mapAttachError`, `dismissAttachError`)? Recomendado mantener un único `attach.js` mientras la lógica quepa razonable (< ~120 LOC).
- Forma exacta del discriminated union de `runAttach`: `{ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}` es el contrato propuesto; el planner puede pulir nombres mientras preserve el mapeo 1:1 a D-10.
- Tests inyectables: el planner decide qué se prueba con `spawn` fake (ordering, ENOENT mapping, exit-code mapping) vs. UAT manual. Mínimo automatizable: ordering relativo + mapeo de errores + snapshot pass-through.
- Ubicación exacta del render del footer-error: en `SessionTable.js` (donde ya vive el footer) o izado a App.js. Recomendado: render condicional en `SessionTable.js`.
- Si `initialError` se persiste un solo render o se mantiene en estado y la primera tecla lo limpia (D-09 dice "primera tecla limpia"; la implementación natural es izar a `useState(initialError)` con clear-on-any-input).

### Deferred Ideas (OUT OF SCOPE)

- Overlays `c` (comentarios) y `l` (logs) — Phase 38.
- `kodo gsd doctor` — post-v0.9.
- Attach con argumentos extra (`cmux attach <ref> --foo`) — sin caso de uso.
- Reconexión semántica si Ctrl-C falla — bug de cmux, fuera de scope.
- Notificación visual al detach — innecesario.
- Surface provider state in dashboard — scope creep (modificaría `src/server.js`).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **TUI-13** | El usuario pulsa `Enter` sobre la fila seleccionada para hacer attach a su workspace cmux; al detach el dashboard vuelve intacto (handoff TTY: `unmount → waitUntilExit → spawn stdio:'inherit' → re-render`) | §Standard Stack (ink waitUntilExit semantics), §Architecture Patterns 1-3 (loop, never-throws, alt-screen), §Code Examples 1-4 (loop completo + attach.js + tests), §C-01 (verbo real de cmux a confirmar) |
| **TUI-14** | El attach está guardado: si la sesión no está viva (`alive===false`) o `cmux` no está en PATH (ENOENT), el dashboard muestra mensaje y permanece montado en lugar de romper la terminal | §Architecture Pattern 2 (discriminated union mapeo), §Pitfalls 1-2 (zombie pre-flight + ENOENT detection), §Code Example 2 (runAttach con manejo de err.code), §Validation Architecture (4 Wave 0 RED tests) |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Loop attach (unmount → spawn → re-render) | **Process orchestration** (`runDashboard` en `index.js`) | — | El loop destruye y recrea el árbol ink — NO puede vivir dentro de un componente React. Único dueño del proceso (consistente con alt-screen, SIGTERM, exit code ya en index.js). |
| Pre-flight zombie guard | **React tree** (`App.js` Enter handler) | — | Cero touch del TTY: la decisión "no spawn" se toma ANTES de emitir intent. El estado local `attachError` se renderiza por el mismo render-cycle que el resto de UI. |
| Spawn interactivo (`stdio:'inherit'`) | **Pure orchestrator** (`attach.js#runAttach`) | — | Aislado del proceso para inyectar `spawn` fake en tests; nunca importa ink/react; retorna discriminated union jamás throw. |
| Snapshot del cursor/filtro/mode | **React props chain** (intent → runDashboard → re-render como `initialSnapshot`) | — | El snapshot se captura ANTES de exit() (dentro del Enter handler), viaja por la ref mutable, y se inyecta como prop al re-render — cero state leak entre iteraciones (cada `render()` es una instancia ink fresca). |
| Alt-screen toggle | **Process orchestration** (`runDashboard` o delegado a `attach.js`) | — | Capa de proceso: la app interactiva no debe saber del alt-screen del parent. El toggle simétrico envuelve el spawn. |
| Manejo SIGINT durante attach | **Process orchestration** (`runDashboard`) | — | Los handlers de señal son globales (`process.on`); su install/remove debe hacerse desde el dueño del proceso, jamás desde un componente React. |
| Render del footer-error rojo | **React tree** (`SessionTable.js` o `App.js`, Discretion) | — | Color SOLO vía `<Text color="red">` (color-isolation D-12 Phase 34). |

## Standard Stack

### Core (sin cambios — invariantes heredadas)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `^6.8.0` | React renderer terminal — `render()`, `useApp().exit()`, `waitUntilExit()` semantics | LOCKED desde Phase 34. `waitUntilExit()` resuelve DESPUÉS de unmount-related stdout writes + cleanup (raw-mode, cursor) según docs oficiales — esto es load-bearing para D-07. [VERIFIED: package.json + npm registry] [CITED: ink docs / Context7 `/vadimdemedes/ink`] |
| `react` | `^19.2.0` | ink peer | LOCKED desde Phase 34. `React.createElement` plano (sin JSX, sin build). [VERIFIED: package.json] |
| `node:child_process` (built-in) | Node ≥20 | `spawn` para invocación interactiva con `stdio:'inherit'` | Built-in, sin nueva dep. `spawn(cmd, args, { stdio:'inherit' })` es el patrón canónico de Node para entregar el TTY a un child sin pipe-buffering. [CITED: nodejs.org child_process docs] |
| `ink-testing-library` | `^4.0.0` (devDep) | Render ink en tests + `stdin.write()` para sim. teclas | LOCKED desde Phase 34. CUBRE: pre-flight zombie guard test, snapshot test. NO CUBRE: real TTY handoff (de ahí D-13 UAT manual). [VERIFIED: package.json] |

### Supporting (nuevo en Phase 37)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (ninguna nueva) | — | — | Phase 37 NO añade prod deps. `spawn` viene de built-in `node:child_process`. El nuevo módulo `attach.js` se construye con primitivas existentes. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Disposition |
|------------|-----------|----------|-------------|
| `child_process.spawn` con `stdio:'inherit'` | `child_process.execFile` (patrón de `src/cmux/client.js`) | `execFile` captura stdout/stderr en buffers — NO entrega el TTY al child → echo/raw-mode roto, ningún TUI nested funciona. | **Rechazado** — confirmado por CONTEXT.md "REFERENCIA, NO REUSAR". |
| `spawn` con `stdio:'inherit'` | `spawn` con `stdio:['inherit','inherit','inherit']` (forma explícita) | Equivalente; `'inherit'` shorthand expande a la tupla. | **Equivalente** — usar la shorthand idiomática. |
| `await new Promise((res) => child.on('exit', res))` | `await once(child, 'exit')` (`events.once`) | Idéntico semánticamente; `events.once` es más conciso pero menos común en este repo. | **Discretion** — el planner elige. |
| Ink `useApp().exit(value)` con valor de retorno | Callback prop `onAttach(ref, snapshot)` + mutable ref | El valor de `exit(value)` resuelve `waitUntilExit()` con ese valor (ink docs lo confirman). Pero la combinación `callback + mutable ref` es lo locked en D-02 — no exploramos alternativa. | **Locked en D-02** — no re-litigar. |

**Installation:** *(no installs en esta fase)*

```bash
# Phase 37 NO requiere npm install. `node:child_process.spawn` ya existe.
```

**Version verification:** Confirmado en `package.json` actual del repo: `ink ^6.8.0`, `react ^19.2.0`, `ink-testing-library ^4.0.0`. Sin cambios planificados. [VERIFIED: cat package.json]

## Package Legitimacy Audit

> Phase 37 NO instala paquetes nuevos. La auditoría de legitimidad para `ink`, `react`, `ink-testing-library` se realizó en Phase 34 (ya en producción, suite 895 pass). El único componente externo invocado es el binario `cmux` resuelto vía `loadConfig().cmux.binary` (ver §C-01).

| Package | Registry | Source Repo | Disposition |
|---------|----------|-------------|-------------|
| (ninguno nuevo) | — | — | N/A — Phase 37 no añade deps. |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ bin/kodo dashboard  →  src/cli.js  →  runDashboard(deps)             │
│                                                                       │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  ITERATION LOOP (NUEVO en Phase 37 — reemplaza try/finally)    │ │
│  │  while (true) {                                                  │ │
│  │    intent = { value: null }                                      │ │
│  │    stdout.write('\x1b[?1049h')                                   │ │
│  │    install SIGTERM handler (heredado de Phase 34 D-10)           │ │
│  │    app = render(<App                                             │ │
│  │      baseUrl, ...                                                 │ │
│  │      initialSnapshot = lastSnapshot                              │ │
│  │      initialError    = lastError                                 │ │
│  │      onAttach        = (ref, snap) => {                          │ │
│  │        intent.value  = {type:'attach', ref, snapshot:snap}       │ │
│  │        exit()                                                    │ │
│  │      }                                                            │ │
│  │    />)                                                            │ │
│  │    await app.waitUntilExit()                                     │ │
│  │    remove SIGTERM handler                                        │ │
│  │                                                                   │ │
│  │    if intent.value?.type !== 'attach': break                     │ │
│  │                                                                   │ │
│  │    ┌─────────── ATTACH WINDOW ───────────┐                       │ │
│  │    │ install SIGINT noop                  │                       │ │
│  │    │ stdout.write('\x1b[?1049l')          │                       │ │
│  │    │ result = await runAttach({           │                       │ │
│  │    │   spawn, ref: intent.value.ref,      │                       │ │
│  │    │   stdout                              │                       │ │
│  │    │ })                                    │                       │ │
│  │    │ stdout.write('\x1b[?1049h') ← se hace├──┐                    │ │
│  │    │ remove SIGINT noop                   │  │ next iter           │ │
│  │    └──────────────────────────────────────┘  │ render() lo absorbe │ │
│  │                                              │ (Discretion)         │ │
│  │    lastSnapshot = intent.value.snapshot     │                      │ │
│  │    lastError = result.ok ? null : map(result)                       │ │
│  │  }                                                                   │ │
│  │  finally { stdout.write('\x1b[?1049l'); process.exitCode = 0 }     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└──────────────┬───────────────────────────────────────────┬────────────┘
               │ (ink owns TTY when mounted)                │ (spawn owns TTY when child alive)
┌──────────────▼──────────────────┐         ┌──────────────▼──────────────────┐
│ <App> (NUEVAS PROPS Phase 37)    │         │ runAttach({ spawn, ref, stdout })│
│  - initialSnapshot               │         │  ┌────────────────────────────┐  │
│  - initialError                  │         │  │ never-throws contract       │  │
│  - onAttach                      │         │  │ try { child = spawn(...) }  │  │
│                                  │         │  │ catch (err) → if err.code   │  │
│  useState initializers:          │         │  │   === 'ENOENT' →             │  │
│   selectedTaskId, query, mode    │         │  │   return {ok:false,code:    │  │
│      ← initialSnapshot           │         │  │     'ENOENT', detail}       │  │
│                                  │         │  │                              │  │
│  Enter handler (mode === 'list'):│         │  │ await once(child, 'exit')   │  │
│   if (sel.row.alive === false)   │         │  │ if exitCode === 0:          │  │
│     setAttachError('workspace    │         │  │   return {ok:true}          │  │
│       gone (alive=false)')       │         │  │ else:                        │  │
│     return                       │         │  │   return {ok:false,         │  │
│   onAttach(                       │         │  │     code:'NON_ZERO_EXIT',   │  │
│     sel.row.workspace_ref,       │         │  │     detail: exitCode}        │  │
│     {selectedTaskId, query, mode}│         │  └────────────────────────────┘  │
│   )                              │         └─────────────────┬────────────────┘
│   exit() ← useApp().exit()       │                            │ (interactive child)
│                                  │                            │ stdio:'inherit'
│  Footer:                          │                            ▼
│   if attachError || initialError │              ┌─────────────────────────────┐
│     <Text color="red">[!]...</Tex│              │  cmux (or whatever interactive│
│   else                            │              │  child the operator confirms │
│     <Text>↑↓ ... · q quit</Text>  │              │  in C-01 disposition)        │
└──────────────────────────────────┘              └─────────────────────────────┘
```

### Recommended Project Structure

```
src/cli/dashboard/
├── index.js         # MODIFICADO: loop while(true) reemplaza try/finally lineal
├── App.js           # MODIFICADO: tres props nuevas (onAttach/initialSnapshot/initialError)
│                    #             + Enter handler con guard alive===false (mode==='list')
│                    #             + estado local attachError + render condicional footer-error
├── attach.js        # NUEVO: runAttach({ spawn, ref, stdout }) → {ok} | {ok:false,code,detail}
│                    #        never-throws · discriminated union · color-isolation respetada
├── SessionTable.js  # POSIBLE (Discretion): render condicional del footer-error rojo
├── client.js        # SIN TOCAR
├── select.js        # SIN TOCAR
├── usePoll.js       # SIN TOCAR
└── format.js        # SIN TOCAR

test/
├── dashboard-attach-ordering.test.js          # NUEVO: unmount precede spawn (spawn fake)
├── dashboard-attach-alive-guard.test.js       # NUEVO: alive===false → no spawn, footer rojo
├── dashboard-attach-enoent.test.js            # NUEVO: spawn err.code='ENOENT' → mapeo D-10
├── dashboard-attach-non-zero-exit.test.js     # NUEVO: child exit 1 → mapeo D-10
├── dashboard-attach-snapshot.test.js          # NUEVO: snapshot pass-through entre iteraciones
├── dashboard-attach-signal-handlers.test.js   # NUEVO: process.listenerCount invariantes
└── format-isolation.test.js                   # SIN TOCAR (ya cubre attach.js automáticamente)

.planning/phases/37-attach-handoff-cmux/
├── 37-HUMAN-UAT.md   # NUEVO (D-13): 4 escenarios obligatorios + sign-off
```

### Pattern 1: Loop "iteración por intent" — único dueño del proceso

**What:** El proceso orquestador (`runDashboard`) hace `while (true)` sobre un par `render() → waitUntilExit() → bifurca por intent`. Cada iteración crea una instancia ink FRESCA — cero state leak entre handoffs.
**When to use:** Cuando el ciclo de vida de UI debe ser interrumpido por un proceso externo que necesita el TTY (cmux attach, vim shell-out, lazygit→nvim).
**Example:**

```js
// src/cli/dashboard/index.js — versión Phase 37 (esqueleto)
// @ts-check
import { spawn as defaultSpawn } from 'node:child_process';
import { DEFAULT_CONFIG } from '../../config.js';

export async function runDashboard(deps = {}) {
  const {
    stdout = process.stdout,
    stdin = process.stdin,
    url,
    spawn: spawnDep = defaultSpawn, // D-03: inyectable
  } = deps;

  // Guard non-TTY (Phase 34, sin tocar)
  if (!stdout.isTTY || !stdin.isTTY) {
    process.stderr.write(NON_TTY_MSG + '\n');
    process.exit(1);
  }

  const { loadConfig } = await import('../../config.js');
  const baseUrl = resolveBaseUrl({ url, loadConfig });
  const cmuxBin = loadConfig().cmux.binary; // recomendado en CONTEXT.md
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const App = (await import('./App.js')).default;
  const { runAttach } = await import('./attach.js');

  let snapshot = null;
  let initialError = null;

  try {
    stdout.write('\x1b[?1049h'); // alt-screen ON (Phase 36 polish)
    while (true) {
      const intent = { value: null }; // D-02 mutable ref

      const app = render(createElement(App, {
        baseUrl,
        initialSnapshot: snapshot,
        initialError,
        onAttach: (ref, snap) => {
          intent.value = { type: 'attach', ref, snapshot: snap };
          app.exit(); // == useApp().exit() — D-08 Phase 34
        },
      }));

      // SIGTERM handler para esta iteración (Phase 34 D-10)
      const onSigterm = () => app.unmount();
      process.once('SIGTERM', onSigterm);

      try {
        await app.waitUntilExit();
      } finally {
        process.removeListener('SIGTERM', onSigterm);
      }

      // Bifurcación por intent
      if (intent.value?.type !== 'attach') {
        break; // q / SIGTERM / etc → salir del loop
      }

      // ── ATTACH WINDOW (D-12) ───────────────────────────────────
      const noopSigint = () => {}; // D-12.1: noop para no morir en Ctrl-C
      process.on('SIGINT', noopSigint);
      try {
        stdout.write('\x1b[?1049l'); // D-06.1: salir del alt-screen
        const result = await runAttach({
          spawn: spawnDep,
          ref: intent.value.ref,
          stdout,
          cmuxBin,
        });
        stdout.write('\x1b[?1049h'); // D-06.4: re-entrar alt-screen
        snapshot = intent.value.snapshot;
        initialError = result.ok ? null : mapAttachError(result);
      } finally {
        process.removeListener('SIGINT', noopSigint); // D-12.3: limpieza
      }
      // ── FIN ATTACH WINDOW ───────────────────────────────────
    }
  } finally {
    stdout.write('\x1b[?1049l'); // alt-screen OFF (Phase 36 polish)
    process.exitCode = 0;
  }
}

function mapAttachError(result) {
  if (result.code === 'ENOENT') return '[!] cmux not found in PATH — press any key';
  // NON_ZERO_EXIT o SPAWN_ERROR: usar detail como código (N substituido)
  const n = result.detail ?? 'unknown';
  return `[!] cmux attach failed (code ${n}) — press any key`;
}
```

[Sources: ink docs (Context7), CONTEXT.md D-01..D-12, ARCHITECTURE.md líneas 27-34, PITFALLS.md Pitfall 1]

### Pattern 2: `runAttach` orquestador puro, never-throws + discriminated union

**What:** Módulo aislado de ink que recibe `spawn` inyectado y siempre retorna `{ok:true} | {ok:false, code, detail}`. Captura `spawn` errors (ENOENT en el `error` event), mapea exit codes, NUNCA propaga excepciones al loop.
**When to use:** Cualquier handoff a proceso externo donde un throw rompería el ciclo de vida del UI.

```js
// src/cli/dashboard/attach.js — NUEVO en Phase 37
// @ts-check
import { once } from 'node:events';

/**
 * Orquestador puro del handoff a cmux.
 * Never-throws: errores del spawn se mapean a un discriminated union.
 *
 * @param {object} args
 * @param {typeof import('node:child_process').spawn} args.spawn - Inyectable (D-03).
 * @param {string} args.ref - workspace_ref (ej. 'workspace:3').
 * @param {NodeJS.WriteStream} args.stdout - Stream parent (alt-screen toggle vive en runDashboard, no aquí — Discretion).
 * @param {string} [args.cmuxBin] - Path al binario cmux (loadConfig().cmux.binary). Default 'cmux' (PATH lookup).
 * @returns {Promise<{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail?:any}>}
 */
export async function runAttach({ spawn, ref, cmuxBin = 'cmux' }) {
  let child;
  try {
    child = spawn(cmuxBin, ['attach', ref], { stdio: 'inherit' });
    // NOTA: 'cmux attach <ref>' es la SEMÁNTICA que CONTEXT.md asume.
    // El binario real cmux.app NO expone 'attach' como subcomando — ver §C-01.
    // El planner debe resolver C-01 antes de PLAN.md; los args concretos
    // pueden cambiar (ej. ['select-workspace', '--workspace', ref]).
  } catch (err) {
    // spawn synchronous throw (raro pero posible en Windows o args mal formados)
    return { ok: false, code: 'SPAWN_ERROR', detail: err.message };
  }

  // ENOENT del binary se entrega como event 'error', NO throw síncrono.
  // Race entre 'error' y 'exit': captura ambos y resuelve por el primero.
  return await new Promise((resolve) => {
    let settled = false;
    child.once('error', (err) => {
      if (settled) return;
      settled = true;
      if (err.code === 'ENOENT') resolve({ ok: false, code: 'ENOENT', detail: err.message });
      else resolve({ ok: false, code: 'SPAWN_ERROR', detail: err.message });
    });
    child.once('exit', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve({ ok: true });
      else resolve({ ok: false, code: 'NON_ZERO_EXIT', detail: code ?? signal ?? 'unknown' });
    });
  });
}
```

[Sources: Node.js child_process docs (ENOENT entrega como event 'error', no throw síncrono), CONTEXT.md D-04 + D-10 + D-11]

### Pattern 3: Snapshot del cursor via mutable ref + initialSnapshot prop

**What:** App.js captura `{selectedTaskId, query, mode}` en el handler de Enter, lo emite via `onAttach(ref, snapshot)`, runDashboard lo guarda en `let snapshot`, y la siguiente iteración renderiza `<App initialSnapshot={snapshot} />`. App.js usa esos valores como `useState` initializers.
**When to use:** Para preservar UX state entre iteraciones de ink sin compartir state-stores entre instancias.

```js
// src/cli/dashboard/App.js (extracto del cambio Phase 37)
export default function App({
  baseUrl, fetchFn, now, schedule, cancel, /* ... */
  initialSnapshot,  // NUEVO Phase 37
  initialError,     // NUEVO Phase 37
  onAttach,         // NUEVO Phase 37
}) {
  // useState initializers con fallback a defaults Phase 36
  const [selectedTaskId, setSelectedTaskId] = useState(
    /** @type {string | null} */ (initialSnapshot?.selectedTaskId ?? null)
  );
  const [query, setQuery] = useState(initialSnapshot?.query ?? '');
  const [mode, setMode] = useState(
    /** @type {'list' | 'filter'} */ (initialSnapshot?.mode ?? 'list')
  );

  // attachError: estado local para zombie pre-flight; initialError es el cebado desde runDashboard.
  // Clear-on-any-input se hace izando initialError a useState inicial y limpiando en useInput.
  const [attachError, setAttachError] = useState(
    /** @type {string | null} */ (initialError ?? null)
  );

  // ... resto del componente Phase 36 ...

  useInput((input, key) => {
    // SI HAY attachError visible: cualquier tecla lo limpia (D-09).
    if (attachError != null) {
      setAttachError(null);
      return;
    }

    if (mode === 'filter') { /* ... Phase 36 ... */ return; }

    // mode === 'list'
    if (input === 'q') { exit(); return; }
    if (input === '/') { setMode('filter'); return; }
    if (key.upArrow)   { /* ... */ return; }
    if (key.downArrow) { /* ... */ return; }

    // NUEVO Phase 37: Enter handler con guard alive===false (D-05).
    if (key.return) {
      const row = sel.row;
      if (!row) return; // lista vacía: no-op
      if (row.alive === false) {
        // Zombie pre-flight: footer rojo, NO emit intent. (D-05 / D-10)
        setAttachError('[!] workspace gone (alive=false) — press any key');
        return;
      }
      // Emit intent con snapshot (D-08).
      onAttach?.(row.workspace_ref, { selectedTaskId, query, mode });
      exit(); // D-08 Phase 34: clean unmount, NO process.exit.
      return;
    }
  }, { isActive: isRawModeSupported });

  // ... render: si attachError != null, SessionTable recibe prop attachError y pinta el footer rojo
  //              en lugar del footer estándar (Discretion sobre ubicación exacta).
}
```

[Sources: CONTEXT.md D-05 + D-08 + D-09; Phase 36 D-05 (selectedTaskId identity); existing App.js líneas 89-260 que se mutan]

### Anti-Patterns to Avoid

- **Spawn desde dentro de `useInput`:** ink mantiene `process.stdin` en raw mode mientras el árbol está montado. Spawn con `stdio:'inherit'` mientras ink está vivo produce: doubled echo, `Raw mode is not supported` errors, terminal rota. → **Patrón correcto:** emit intent → exit() → await waitUntilExit() → spawn (Pattern 1, D-01).
- **Throw desde `runAttach` que llegue al loop:** un throw en el loop NO captura el alt-screen toggle de vuelta (D-06.4) ni los handlers de señal (D-12.3). → **Patrón correcto:** never-throws + discriminated union; `try/finally` solo para SIGINT noop + alt-screen.
- **`process.exit` desde React o desde el loop:** rompe el alt-screen-off del finally + el drenaje de stdio. → **Patrón correcto:** `useApp().exit()` para unmount limpio; `process.exitCode = 0` al final, no `process.exit`.
- **Asignar `selectedTaskId` desde `initialSnapshot` sin null-check del campo:** si `initialSnapshot === null` (primera iteración), debe caer a `null` no a `undefined.selectedTaskId` (TypeError). → **Patrón correcto:** `initialSnapshot?.selectedTaskId ?? null`.
- **Toggle asimétrico del alt-screen:** saltarse `\x1b[?1049l` antes del spawn deja a kodo y a cmux peleándose por el alt-screen → frame fantasma en scrollback. Saltarse `\x1b[?1049h` después deja al re-render pintando sobre la primary screen del operador. → **Patrón correcto:** D-06 simétrico estricto.
- **`process.exit` en SIGINT handler del parent:** rompe el caso #4 del UAT (Ctrl-C durante attach = kodo sigue vivo). → **Patrón correcto:** noop handler durante la ventana, removed al volver (D-12).
- **`setInterval` para clear del error footer:** anti-pattern documentado en Pitfall 8 (Phase 35 research). → **Patrón correcto:** clear-on-keypress, sin timers (D-09).
- **Importar `picocolors` en `attach.js` o nuevos archivos del footer-error:** rompe color-isolation D-12 Phase 34. → **Patrón correcto:** `<Text color="red">` de ink.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detección de "binario no en PATH" | Probar `which`/`stat` antes del spawn | El propio `child.on('error', (err) => err.code === 'ENOENT')` que entrega Node | Race-free, idiomático, ya cubre Windows PATHEXT + macOS spotlight aliasing automáticamente. [CITED: nodejs.org child_process — "When ENOENT is encountered, the 'error' event is emitted"] |
| TTY release antes del spawn | Llamar `process.stdin.setRawMode(false)` + `process.stdin.removeAllListeners('data')` manualmente | `app.exit()` + `await app.waitUntilExit()` (ink contract) | ink's cleanup teardown se ejecuta DENTRO de `waitUntilExit` settle — manual cleanup duplica y compete con ink. [CITED: ink docs `waitUntilExit` "resolves after unmount-related stdout writes complete"]. **⚠ Caveat:** ver Pitfall 3 (residual listeners en algunos escenarios). |
| Race entre `child.on('error')` y `child.on('exit')` | `Promise.race` + `clearTimeout` patterns | Single `settled` flag dentro del `Promise` (Code Example 2) | El primer evento gana; el segundo es defensivamente ignorado. Pattern estándar Node. |
| Capturar exit code y signal por separado | Branching elaborado por `null` checks | `code ?? signal ?? 'unknown'` (nullish coalescing) | Idiomático ESM 2022+; un de los dos siempre estará no-null cuando `exit` fire. |
| Alt-screen abstraction (clase/util) | `class AltScreenGuard { enter() / exit() }` | Dos `stdout.write` literales con secuencias `\x1b[?1049h/l` | 2 escape sequences en 4 sitios — encapsular añade fricción sin valor. |
| Snapshot serialization | JSON.stringify + parse en el seam | Pasar el objeto plain JS directamente (mutable ref + prop) | Cero IPC boundary; mismo proceso; el objeto es estable durante la ventana. |

**Key insight:** El stack ya está hecho (`spawn` built-in, ink contract, never-throws pattern). Phase 37 es ENSAMBLAJE de primitivas existentes con discipline — no hay deuda de implementación primitiva.

## Runtime State Inventory

> Phase 37 NO es rename/refactor/migration — es greenfield wiring sobre código existente.
> Sin embargo, las nuevas instancias de ink + el spawn crean **estado runtime nuevo** que merece auditoría inicial.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **Nada nuevo.** Ni `state.json`, ni `~/.kodo/config.json`, ni history se modifican por Phase 37. | none |
| Live service config | **Nada nuevo.** El binario `cmux` es invocado, no configurado. Los workspaces cmux pre-existen del server kodo (alimentados por `src/cmux/client.js` en el path de orquestador). | none — pero confirmar §C-01 |
| OS-registered state | **Process group del child.** Con `stdio:'inherit'` sin `detached:true`, el child queda en el mismo process group del parent → Ctrl-C va a ambos (mitigado por D-12.1 noop SIGINT en parent). Cero registro en `launchd`/Task Scheduler. | Verificado por UAT escenario #4. |
| Secrets/env vars | **Inherited.** Spawn con `stdio:'inherit'` hereda TODO el env del parent (incluyendo `PLANE_API_KEY`, `GITHUB_TOKEN`, etc.). cmux es un binario local del operador — riesgo nulo. | none |
| Build artifacts | **Nada.** Phase 37 no produce egg-info, dist, .compiled artifacts. | none |
| **Process listeners (cross-iteration)** | **AUDITAR.** Cada `render()` crea nuevas referencias a listeners; el contrato es 0 leak entre iteraciones (D-12). | **Test load-bearing:** `process.listenerCount('SIGINT')` y `('SIGTERM')` snapshot antes/después/durante cada iteración. |
| **Ink residual stdin listeners** | **AUDITAR (Pitfall 3 nuevo).** WebSearch revela que `useInput` puede dejar listeners en `process.stdin` tras unmount. Si el segundo `render()` no los limpia y los acumula → handler invocado N veces. | Recomendación: test que mida `process.stdin.listenerCount('data')` antes del 1er render y tras la 2nd iteración. Si no es 0→0, considerar `process.stdin.removeAllListeners('data')` justo antes del 2nd render. **[ASSUMED: severity unknown — necesita verificación empírica en este repo concreto]** |

**Nothing found in category:** Confirmado para stored data, OS registrations, secrets, build artifacts. La auditoría queda en process listeners (ya cubierta por D-12) + ink stdin listeners (Pitfall 3 nuevo, ver §Common Pitfalls).

## Common Pitfalls

### Pitfall 1 (cross-reference): `cmux attach` TTY handoff rompe la terminal (Pitfall 1 de PITFALLS.md)

**What goes wrong:** Spawn mientras ink owns el TTY → raw-mode errors, doubled echo, terminal rota tras detach. **El mecanismo y su prevención están LOCKED en PITFALLS.md Pitfall 1 + CONTEXT.md D-01..D-06.**
**Why it happens:** ink puts stdin en raw mode + (si `alternateScreen`) takes over la pantalla. spawn con `stdio:'inherit'` desde useInput compite por el fd.
**How to avoid:** Pattern 1 (loop "iteración por intent" con unmount → waitUntilExit → spawn → re-render).
**Warning signs:** Doubled echo tras primer attach; `Raw mode is not supported` en Enter; shell sin echo tras detach.
**Status:** **LOCKED, no re-litigar.** Esta fase EJECUTA Pitfall 1.

### Pitfall 2 (cross-reference): Attach handoff no es unit-testeable — UAT manual obligatorio (Pitfall 13 PITFALLS.md)

**What goes wrong:** Real TTY swap es invisible a `ink-testing-library` (fake stdout, no real TTY).
**How to avoid:** D-13 — `37-HUMAN-UAT.md` con 4 escenarios obligatorios. Lo automatizable se cubre: pre-flight guard + ordering test + ENOENT mapping + snapshot pass-through.
**Status:** **LOCKED.** Sin 4/4 sign-off, la fase NO está completa.

### Pitfall 3 (NUEVO en Phase 37): Listeners residuales en `process.stdin` tras unmount de ink

**What goes wrong:** Investigación reciente (WebSearch + GitHub issues: slopus/happy#422, claude-code#404/#1072) documenta que `useInput` registra `process.stdin.on('data', handler)` y NO siempre limpia ese listener cuando ink hace unmount. Tras varias iteraciones del loop attach, `process.stdin.listenerCount('data')` puede acumularse → el handler de `useInput` de la 1a iteración sigue vivo y procesa input para una instancia React desmontada (silently no-op si el state es unreachable, pero puede crashear si referencia closures de la instancia muerta).
**Why it happens:** ink usa reference-counting en `rawModeEnabledCount`; la decrementación al unmount es correcta para raw mode pero el `removeListener` del data callback puede no ejecutarse en todos los paths de teardown.
**How to avoid:** **Defense-in-depth recomendada** (no LOCKED en CONTEXT.md — el planner decide):
1. **Test invariante:** `process.stdin.listenerCount('data') === 0` antes del primer `render()` y al final del loop. Si no es 0, FAIL — diagnose antes de cerrar fase.
2. **Belt-and-suspenders (opcional):** `process.stdin.removeAllListeners('data')` justo ANTES del 2nd `render()` en el loop. Aceptable porque solo data listeners propios de ink están en juego (el repo no añade listeners de data fuera del dashboard). Riesgo: si el operador inyectó listeners externos, los borra — improbable en `kodo dashboard`.
3. **Solo si el test #1 falla:** activar #2.

**Warning signs:** Tras Nth attach, latencia creciente al teclear; comportamiento `useInput` "fantasma" (responde a una tecla con la acción de una iteración anterior).
**Confidence:** MEDIUM — el patrón está documentado en issues de ink-based projects (claude-code, happy), pero la severidad concreta en ink@6.8.0 + react@19 no está verificada empíricamente en este repo. [CITED: deepwiki.com/vadimdemedes/ink/7.3-raw-mode-and-input-processing; github.com/slopus/happy/issues/422]
**Phase to address:** Phase 37 — añadir el test invariante al menos.

### Pitfall 4 (NUEVO en Phase 37): SIGINT durante attach mata kodo si el handler noop NO está instalado

**What goes wrong:** Con `stdio:'inherit'` sin `detached`, el child queda en el mismo process group que el parent. Ctrl-C envía SIGINT a TODO el process group (POSIX). Si el parent no tiene un handler, Node lo trata como default → exit code 130 → kodo muere → criterio UAT #4 falla.
**Why it happens:** El default-handler de Node para SIGINT es "exit with 128+2"; install de cualquier listener lo desactiva. cmux maneja su propio SIGINT (detach behavior) → si kodo también muriera, perderíamos el dashboard al detach.
**How to avoid:** **D-12.1 noop install** ANTES del spawn, **removeListener** después. **Crítico:** debe ser un mismo handler `const noopSigint = () => {}` para que `removeListener` lo encuentre — `process.on('SIGINT', () => {})` con función anónima NO se puede remover.
**Warning signs:** UAT #4 falla con `kodo` desapareciendo del `ps aux` tras Ctrl-C; el shell vuelve al prompt sin re-aparición del dashboard.
**Test load-bearing:** `process.listenerCount('SIGINT')` debe ser 0 antes del attach, 1 durante (el noop), 0 después.
[CITED: nodejs.org/api/child_process — "stdio: 'inherit' keeps the child attached to the controlling terminal"; CONTEXT.md D-12]

### Pitfall 5 (NUEVO en Phase 37): Race entre `'error'` y `'exit'` events del child

**What goes wrong:** Node entrega errores de spawn vía event `'error'` (NO throw síncrono — los args incorrectos o ENOENT NO arrojan en la llamada `spawn(...)`). Pero el child PUEDE además emitir `'exit'` casi simultáneo. Si el handler trata ambos sin un flag de settling, podría retornar dos veces el Promise.
**Why it happens:** Las race conditions en EventEmitter son intrínsecas; el orden de fire de `error`/`exit` depende del path de fallo en libuv.
**How to avoid:** Flag `let settled = false` dentro del Promise (Pattern 2, Code Example 2). El primer evento marca settled+resuelve; el segundo es defensivamente ignorado.
**Warning signs:** Tests intermitentes que pasan/fallan; en producción es benigno (`resolve` solo gana una vez), pero un `console.log` doble en debug delata el bug.

### Pitfall 6 (NUEVO en Phase 37): Alt-screen toggle asimétrico → frame fantasma

**What goes wrong:** Si por error solo se hace `\x1b[?1049l` antes del spawn pero NO `\x1b[?1049h` antes del re-render, kodo "cree" que sigue en alt-screen tras el detach de cmux (cmux mismo hizo `\x1b[?1049l` al salir de SU alt-screen, dejando al parent en primary screen). El siguiente `render()` pinta sobre la primary screen del operador → frame fantasma en scrollback.
**Why it happens:** Las secuencias de alt-screen son estado terminal global; cada TUI que entra/sale opera sobre el mismo flag. Cuando dos TUIs anidados se toggle-an sin disciplina, el más externo pierde su contexto.
**How to avoid:** D-06 **simétrico** estricto: 4 escrituras en orden fijo (off ANTES de spawn, on ANTES de render). Idealmente envueltas en try/finally para que un throw del spawn no las saltee. **Test load-bearing:** difícil de automatizar sin un PTY real — se cubre por UAT escenario #1 ("scrollback sin frames apilados" — fixture validado en Phase 36 con hot-patch `116cb1e`).
**Warning signs:** Tras detach + redraw, ves la cabecera "kodo dashboard" apilada en el scrollback (regresión del fix Phase 36 `116cb1e`).

### Pitfall 7 (NUEVO en Phase 37): `initialError` que persiste indefinidamente vs clear-on-keypress

**What goes wrong:** Si `initialError` se mete como prop pero NUNCA se setea como `useState(initialError)` con un clear-on-input, el error queda visible eternamente — incluso después de un nuevo attach exitoso.
**Why it happens:** Una prop no se "limpia sola"; necesita estado local que pueda mutarse. Y el estado local debe inicializarse desde la prop en el primer render de cada iteración.
**How to avoid:** Pattern 3 + D-09: `useState(initialError)` + cualquier keypress llama `setAttachError(null)` ANTES de procesar la tecla.
**Warning signs:** Tras un attach fallido (ENOENT), el siguiente attach exitoso no limpia el footer rojo.

## Code Examples

### Example 1: Test de ordering (unmount precede spawn) — Wave 0 RED

```js
// test/dashboard-attach-ordering.test.js — NUEVO
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDashboard } from '../src/cli/dashboard/index.js';

describe('Phase 37: attach loop ordering (TUI-13)', () => {
  it('spawn se llama DESPUÉS de que waitUntilExit() resolvió (unmount → spawn)', async () => {
    const events = [];
    const fakeSpawn = (cmd, args) => {
      events.push({ event: 'spawn', cmd, args });
      // Fake child: emite exit 0 inmediatamente
      const child = new (require('node:events').EventEmitter)();
      setImmediate(() => child.emit('exit', 0));
      return child;
    };

    // Fake stdout/stdin TTY
    const stdout = Object.assign(new (require('node:stream').Writable)({
      write(_c, _e, cb) { cb(); }
    }), { isTTY: true });
    const stdin = Object.assign(new (require('node:stream').PassThrough)(), { isTTY: true });

    // Simular ink mediante una App que emite onAttach inmediatamente al primer render
    // y luego al segundo render emite quit (sin attach) para salir del loop.
    // (En la práctica, este test se hace con un mock de render que captura el orden.)
    // ... configuración detallada en el plan ...

    // Aserción load-bearing:
    const spawnIdx = events.findIndex((e) => e.event === 'spawn');
    const waitIdx  = events.findIndex((e) => e.event === 'waitUntilExit-resolved');
    assert.ok(waitIdx >= 0, 'waitUntilExit resolved event missing');
    assert.ok(spawnIdx > waitIdx, 'spawn must fire AFTER waitUntilExit resolved');
  });
});
```
[Source: CONTEXT.md §Specifics "Test load-bearing de TUI-13"]

### Example 2: Test de alive===false → no spawn + footer rojo — Wave 0 RED

```js
// test/dashboard-attach-alive-guard.test.js — NUEVO
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

describe('Phase 37: alive===false pre-flight guard (TUI-14)', () => {
  it('Enter sobre fila zombie NO emite onAttach y muestra footer rojo', async () => {
    let attachCalled = false;
    const onAttach = () => { attachCalled = true; };

    // Fake fetch que retorna 1 sesión con alive:false
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        sessions: [{
          task_id: 'T-1', task_ref: 'KL-99', workspace_ref: 'workspace:9',
          status: 'running', alive: false, repo: 'foo', started_at: new Date().toISOString(),
        }],
        count: 1,
        pending: [],
      }),
    });

    const { stdin, lastFrame } = render(createElement(App, {
      baseUrl: 'http://localhost:9090',
      fetchFn: fakeFetch,
      onAttach,
    }));

    // Esperar al primer poll + render
    await new Promise((r) => setTimeout(r, 50));

    // Enter
    stdin.write('\r');
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(attachCalled, false, 'onAttach must NOT be called when alive===false');
    assert.match(lastFrame(), /workspace gone \(alive=false\)/, 'footer must show D-10 zombie message');
  });
});
```
[Source: CONTEXT.md §Specifics "Test load-bearing de TUI-14 alive===false"]

### Example 3: Test de ENOENT mapping — Wave 0 RED

```js
// test/dashboard-attach-enoent.test.js — NUEVO
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runAttach } from '../src/cli/dashboard/attach.js';

describe('Phase 37: ENOENT mapping (TUI-14)', () => {
  it('spawn err.code === "ENOENT" → {ok:false, code:"ENOENT"}', async () => {
    const fakeSpawn = () => {
      const child = new EventEmitter();
      setImmediate(() => {
        const err = new Error('spawn cmux ENOENT'); err.code = 'ENOENT';
        child.emit('error', err);
      });
      return child;
    };
    const result = await runAttach({ spawn: fakeSpawn, ref: 'workspace:1' });
    assert.deepEqual(result, { ok: false, code: 'ENOENT', detail: 'spawn cmux ENOENT' });
  });

  it('child exit con code !== 0 → {ok:false, code:"NON_ZERO_EXIT", detail: N}', async () => {
    const fakeSpawn = () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 42, null));
      return child;
    };
    const result = await runAttach({ spawn: fakeSpawn, ref: 'workspace:1' });
    assert.deepEqual(result, { ok: false, code: 'NON_ZERO_EXIT', detail: 42 });
  });

  it('child exit con code === 0 → {ok:true}', async () => {
    const fakeSpawn = () => {
      const child = new EventEmitter();
      setImmediate(() => child.emit('exit', 0, null));
      return child;
    };
    const result = await runAttach({ spawn: fakeSpawn, ref: 'workspace:1' });
    assert.deepEqual(result, { ok: true });
  });
});
```
[Source: CONTEXT.md §Specifics "Test load-bearing TUI-14 ENOENT" + D-04 contract]

### Example 4: Test de signal listener invariants — Wave 0 RED

```js
// test/dashboard-attach-signal-handlers.test.js — NUEVO
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Phase 37: signal handler invariants (D-12, cross-cutting)', () => {
  it('process.listenerCount("SIGINT") y ("SIGTERM") son 0 antes/después de cada iteración del loop', async () => {
    const sigintBefore  = process.listenerCount('SIGINT');
    const sigtermBefore = process.listenerCount('SIGTERM');

    // ... run loop with 2 simulated attaches via fakes ...

    const sigintAfter  = process.listenerCount('SIGINT');
    const sigtermAfter = process.listenerCount('SIGTERM');

    assert.equal(sigintAfter, sigintBefore,
      `SIGINT listener leak across loop iterations (was ${sigintBefore}, now ${sigintAfter})`);
    assert.equal(sigtermAfter, sigtermBefore,
      `SIGTERM listener leak across loop iterations (was ${sigtermBefore}, now ${sigtermAfter})`);
  });
});
```
[Source: CONTEXT.md §Specifics + D-12.3 "cero leak"]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setRawMode(false)` + `removeAllListeners` manuales antes de spawn | Confiar en `ink.waitUntilExit()` settle-after-cleanup | ink ≥3 (~2020) | D-07 — no belt-and-suspenders. Reduce código pero requiere fe en el contrato (mitigada por test de Pitfall 3). |
| `execFile` con captura de stdout | `spawn` con `stdio:'inherit'` para interactivos | Node 6+ (`stdio:'inherit'` shorthand) | Pattern canónico. `src/cmux/client.js` usa `execFile` para verbos no-interactivos; attach es interactivo → fundamentalmente diferente. |
| Promise.race para race de events | Single `settled` flag + dos `once` | Idioma común desde 2018+ | Más legible que `Promise.race` cuando hay cleanup post-resolve. |
| Index-based selection | `task_id` identity + `resolveSelection` clamp | Phase 36 (D-05/D-06) | Phase 37 hereda — el snapshot D-08 viaja `task_id`, el re-render lo re-resuelve. |

**Deprecated/outdated en CONTEXT del proyecto:**
- `ink@7` con Node 22 — bloqueado por `engines.node >=20` (Phase 34 LOCKED).
- JSX + build step — bloqueado por "no build step" invariante.
- `ink-table` — descartado en STACK.md (stale/CJS).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| **A1** | El binario `cmux` resuelto vía `loadConfig().cmux.binary` (default `/Applications/cmux.app/Contents/Resources/bin/cmux`) tiene un subcomando interactivo que toma el TTY al hacer attach a un workspace. [ASSUMED] — **REFUTADO empíricamente:** `cmux attach <ref>` no existe; `cmux select-workspace --workspace <ref>` cambia foco en la GUI pero no toma el TTY. Ver §C-01 disposición. | Code Example 2, Architecture Pattern 2, §C-01 | **CRITICAL** — Sin un comando real que tome el TTY, todo el handoff TTY pierde target. PLAN.md no puede generarse hasta resolver C-01. |
| **A2** | El listener residual de `process.stdin.on('data')` reportado en ink-based projects (slopus/happy#422, claude-code#404) afecta ink@6.8.0 con el patrón concreto de este repo. [ASSUMED] — la severidad no está verificada empíricamente; el repo no tiene reports propios. | Pitfall 3 | **MEDIUM** — Si afecta: el test de Pitfall 3 lo detecta y el `removeAllListeners` cleanup es bajo-costo. Si NO afecta: el test pasa siempre, sin costo adicional. |
| **A3** | El `--lines` flag de `cmux read-screen` y otros verbos cmux GUI no son relevantes al handoff — la única integración necesaria es invocar el verbo "ir al workspace X". [ASSUMED] | §C-01 disposición | **LOW** — incluso si necesitásemos `read-screen` en una futura iteración, queda fuera de Phase 37 (scope: solo handoff). |
| **A4** | El loop `while (true)` con `let snapshot` y `let initialError` plain (sin mutex/lock) es seguro en JS single-threaded para esta orquestación. [ASSUMED] — verificado por lectura: Node event loop garantiza atomicidad entre await points; no hay concurrencia real. | Pattern 1, Code Example 1 | **LOW** — invariante de Node, no específico a este código. |
| **A5** | El campo `workspace_ref` en `SessionRecord` (alimentado por `/status`) está siempre presente para sesiones con `alive===true`. [VERIFIED: cat src/server.js:381 → `alive: workspaceList.includes(s.workspace_ref)`] — el alive merge SOLO opera sobre `workspace_ref`, así que un alive===true sin workspace_ref es estructuralmente imposible. | D-05 / Pattern 3 (Enter handler) | **LOW** — confirmado en código. |

**Disposition A1:** El planner debe escalar `C-01` (§Open Questions Q1) al operador ANTES de generar PLAN.md. Hasta entonces, toda la arquitectura D-01..D-12 sigue siendo correcta y reusable — solo cambian la string `'cmux'` + los args `['attach', ref]` en `runAttach`.

## Open Questions

### Q1 (CRÍTICA, escalada a `/gsd:discuss-phase`): ¿Qué verbo de cmux toma el TTY?

**What we know:**
- `cmux attach <workspace_ref>` referenciado en CONTEXT.md D-04 / D-06 / D-13 / ROADMAP TUI-13 / PITFALLS.md Pitfall 1: **NO EXISTE como subcomando**. Confirmado contra el binario instalado en este equipo (`/Applications/cmux.app/Contents/Resources/bin/cmux help`).
- cmux es una app macOS GUI (Ghostty + AppKit, controlada por socket Unix). Los verbos relacionados con workspace son: `select-workspace`, `list-workspaces`, `new-workspace`, `close-workspace`, `rename-workspace`, `workspace-action`, `current-workspace`. NINGUNO de ellos secuestra el TTY del proceso parent — todos hacen RPC sobre el socket y retornan rápido.
- El verbo `cmux <path>` (sin subcomando) "Open a directory in a new workspace (launches cmux if needed)" es el más cercano semánticamente a "abre una vista" — pero ESO crea un workspace nuevo, no se hace attach a uno existente.
- `cmux ssh-session-attach --session-id <id>` SÍ existe pero es para sesiones SSH (no workspaces locales).
- El binario `src/cmux/client.js` actual del repo invoca verbos como `new-workspace`, `send`, `read-screen`, `workspace-action` — todos no-interactivos vía `execFile`.

**What's unclear:** ¿Cuál es el verbo cmux REAL que el operador espera invocar al pulsar Enter en el dashboard? Hipótesis posibles (en orden de plausibilidad técnica):

**Hipótesis H1 — `select-workspace` (más probable):** El operador quiere que pulsar Enter cambie el workspace activo en la app GUI cmux (que ya está corriendo). El comando sería `cmux select-workspace --workspace <ref>`, que retorna rápido (no toma TTY). **PERO** entonces NO hay handoff TTY: kodo dashboard no debería desmontarse ni hacer alt-screen toggle. El "attach" es metafórico (= "ir a", "enfocar"). Esto **invalida toda la arquitectura D-01..D-12 y D-06**, que asumen handoff real. Pre-flight guard (D-05) y mensajes de error (D-10) sí siguen aplicando, pero serían un fire-and-forget post-hook simple.

**Hipótesis H2 — `cmux open <path>` o `cmux <path>`:** El operador quiere lanzar/abrir un workspace por path. Mismo issue que H1 — no toma TTY.

**Hipótesis H3 — Hay otro binario (no cmux.app) que sí toma el TTY:** Quizá el operador tiene un alias `cmux` distinto en su PATH (no `/Applications/cmux.app/...`), o hay un wrapper local. La configuración por defecto apunta a cmux.app, pero el operador podría overridelo. **CONFIRMAR `loadConfig().cmux.binary` REAL del operador.**

**Hipótesis H4 — Se necesita una nueva piece (no cmux):** Quizá la intención original era invocar un shell embedido o un attach a un tmux/screen session creado por cmux. Esto requeriría refactorizar el approach por completo.

**Recommendation (para `/gsd:discuss-phase`):**
1. **Ir a `/gsd:discuss-phase 37`** con esta pregunta concreta al operador, mostrando el output de `cmux --help | head -20` que el researcher capturó.
2. **No bloquear el resto del research**: la arquitectura D-01..D-12 sigue siendo válida para CUALQUIER verbo interactivo. Lo único variable es la string del binario + args en `runAttach`. Si el verbo final NO toma TTY (H1/H2), la mitad de la arquitectura se simplifica drásticamente (no necesitamos D-06 alt-screen toggle, no necesitamos D-12 SIGINT noop, el loop while se reduce a "después de cada attach call, re-render con el snapshot").
3. **Si H1 confirmado:** PLAN.md se simplifica radicalmente — Phase 37 se vuelve la fase de **menor** riesgo del milestone (un fire-and-forget RPC), no la de mayor. El UAT manual de 4 escenarios se reduce a 2 (alive===false + ENOENT siguen aplicando; los 2 de TTY handoff dejan de tener sentido).

### Q2 (MEDIUM): ¿Cómo testear el ordering "spawn DESPUÉS de waitUntilExit" sin un ink real?

**What we know:** `ink-testing-library` no expone `render()`'s `waitUntilExit` con el mismo contrato que `ink` (cancela en algunos paths). El test de ordering necesita un mock de `render` que registre el orden de los eventos.

**What's unclear:** ¿El planner inyecta su propio mock `render` en `runDashboard(deps)`, o usa el `ink-testing-library` y se acepta una semántica más débil?

**Recommendation:** Añadir `render` a `deps` de `runDashboard` (siguiendo el patrón DI ya establecido en Phase 34); en tests, inyectar un mock `(element) => ({ exit: (val) => { onExit?.(val) }, waitUntilExit: () => waitPromise, unmount: () => {} })`. El test controla el resolve del `waitPromise` y aserta que `spawnFake.calls.length === 0` hasta entonces.

### Q3 (LOW): ¿`initialError` se debe limpiar al cambiar de mode (filter ↔ list), o solo al keypress en list?

**What we know:** D-09 dice "cualquier tecla limpia". `/` para entrar a filter mode es una tecla — ¿la limpia? Probablemente sí (cualquier tecla, sin distinción).

**Recommendation:** Implementación más conservadora: clear-on-any-keypress (incluido `/`). El operador raramente entra a filter mode después de un error sin verlo primero.

### Q4 (LOW): ¿El test de Pitfall 3 (listeners residuales) debe ir en Wave 0 RED o en Wave 1 GREEN?

**What we know:** Es un test invariante (assertion contra el estado del proceso), no un test de comportamiento. Puede pasar trivialmente sin nada implementado (listenerCount === 0 antes del render).

**Recommendation:** Wave 0 RED — montar el loop una vez (sin attach) y luego una segunda iteración (sin attach) y aserta listenerCount === 0. Si pasa: la mitigación de Pitfall 3 NO es necesaria. Si falla: el test guía la fix.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥20 | All | ✓ | (host) | — |
| `cmux` binary | runAttach spawn target | ✓ | `/Applications/cmux.app/Contents/Resources/bin/cmux` (GUI app) | **CRITICAL: verbo `attach` NO disponible** — ver §C-01 / Q1 |
| `ink@^6.8.0` | App.js | ✓ | from package.json | — |
| `react@^19.2.0` | App.js | ✓ | from package.json | — |
| `ink-testing-library@^4.0.0` | tests | ✓ | from package.json (devDep) | — |
| `node:child_process` (built-in) | runAttach | ✓ | built-in | — |
| `node:events` (built-in) | race detection | ✓ | built-in | — |

**Missing dependencies with no fallback:**
- **`cmux attach <ref>` subcomando** — el verbo `attach` no existe en el binario cmux instalado. Necesita resolución por el operador (§Q1).

**Missing dependencies with fallback:**
- (ninguna)

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `ink-testing-library@^4.0.0` |
| Config file | none (mirrors Phase 34-36 patterns) |
| Quick run command | `node --test test/dashboard-attach-*.test.js` |
| Full suite command | `npm test` (which expands to `node --test $(find test -name '*.test.js' -type f)`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUI-13 | Loop ordering: unmount → spawn → re-render | unit (DI mock render+spawn) | `node --test test/dashboard-attach-ordering.test.js` | ❌ Wave 0 |
| TUI-13 | Snapshot pass-through entre iteraciones | unit (DI mocks) | `node --test test/dashboard-attach-snapshot.test.js` | ❌ Wave 0 |
| TUI-13 | Segundo attach consecutivo (loop multi-iter, listener invariants) | unit | `node --test test/dashboard-attach-signal-handlers.test.js` | ❌ Wave 0 |
| TUI-14 | alive===false guard → no spawn + footer rojo | unit (ink-testing-library) | `node --test test/dashboard-attach-alive-guard.test.js` | ❌ Wave 0 |
| TUI-14 | ENOENT mapping → `{ok:false, code:'ENOENT'}` | unit (DI spawn fake) | `node --test test/dashboard-attach-enoent.test.js` | ❌ Wave 0 |
| TUI-14 | NON_ZERO_EXIT mapping → `{ok:false, code:'NON_ZERO_EXIT', detail:N}` | unit | (same file as ENOENT) | ❌ Wave 0 |
| TUI-13 criterio #1 (vuelta intacta TTY) | UAT manual escenario #1 | **manual** | `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` | ❌ Wave 0 (D-13) |
| TUI-13 criterio #2 (2do attach equivalente) | UAT manual escenario #2 | **manual** | (same file) | ❌ Wave 0 |
| TUI-14 zombie real | UAT manual escenario #3 | **manual** | (same file) | ❌ Wave 0 |
| TUI-13 Ctrl-C durante attach | UAT manual escenario #4 | **manual** | (same file) | ❌ Wave 0 |
| Cross-cutting: color-isolation (no picocolors) | invariant test | `node --test test/format-isolation.test.js` | ✅ existe (walker incluye attach.js automáticamente) |
| Cross-cutting: never-throws contract (no throw cross-boundary) | unit (try { runAttach(...) } pasa sin throw para todos los códigos) | (covered in enoent.test.js) | ❌ Wave 0 |
| Cross-cutting: no process.exit desde React | grep-based ¿existe ya? | (covered by existing Phase 34 tests si los hay) | TBD por planner |
| Cross-cutting: zero leaked signal handlers across iterations | `process.listenerCount('SIGINT')/('SIGTERM')` before/after each handoff | (same as signal-handlers.test.js) | ❌ Wave 0 |
| Cross-cutting: zero leaked stdin data listeners across iterations | `process.stdin.listenerCount('data')` before first/after last | NEW test (Pitfall 3) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test test/dashboard-attach-*.test.js` (rápido, < 5s)
- **Per wave merge:** `npm test` (suite completa)
- **Phase gate:** Full suite green + `37-HUMAN-UAT.md` con 4/4 sign-off antes de `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `test/dashboard-attach-ordering.test.js` — covers TUI-13 ordering
- [ ] `test/dashboard-attach-alive-guard.test.js` — covers TUI-14 alive===false
- [ ] `test/dashboard-attach-enoent.test.js` — covers TUI-14 ENOENT + NON_ZERO_EXIT
- [ ] `test/dashboard-attach-snapshot.test.js` — covers TUI-13 snapshot pass-through
- [ ] `test/dashboard-attach-signal-handlers.test.js` — covers cross-cutting D-12 invariants + Pitfall 3 stdin listener invariant
- [ ] `src/cli/dashboard/attach.js` — runAttach module (target of unit tests)
- [ ] `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` — UAT artifact (D-13)

*(No framework install gaps — `node:test` + `ink-testing-library` ya existen en el repo.)*

## Security Domain

`security_enforcement` no está explicitamente desactivado en `.planning/config.json` → tratamos como enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth nueva; el spawn hereda el contexto del operador local) |
| V3 Session Management | no | — (no sessions HTTP) |
| V4 Access Control | no | — (operación local; el operador ya tiene el TTY) |
| V5 Input Validation | **yes** | `workspace_ref` viene del payload `/status` (server kodo trusted) y se pasa a `spawn(cmuxBin, ['attach', ref], ...)`. **Spawn con array de args NO interpola shell** — no hay riesgo de command injection vía `;`/`&&`/backticks en el ref. **Verificar que `ref` es string** antes del spawn (TypeScript via `@ts-check`). |
| V6 Cryptography | no | — (no crypto nueva) |
| V8 Data Protection | **yes (env vars)** | `stdio:'inherit'` hace que el child herede TODO el env del parent (incluyendo `PLANE_API_KEY`, `GITHUB_TOKEN`). Aceptable porque cmux es binario local del operador y no exfiltra. **No documentado como necesario reset**, pero el planner debe registrarlo como decisión consciente. |
| V12 File Operations | no | — (no file I/O nueva en runAttach) |

### Known Threat Patterns for Node `spawn` interactivo

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection en `ref` (e.g., `workspace:1; rm -rf /`) | Tampering | Spawn array form (no shell) → safe by default. Ref viene de `/status` (server trusted, no user-controlled string en este path). **[VERIFIED: `spawn(cmd, [args], opts)` sin `shell:true` jamás interpola]** |
| Path traversal en `cmuxBin` (e.g., `../../malicious`) | Tampering | Path viene de `loadConfig().cmux.binary` (user-controlled config file `~/.kodo/config.json`). **Riesgo aceptado:** el operador controla su propio config; si compromete su config tiene problemas mayores. **Aceptable.** |
| Hung child child que retiene el TTY | Denial of Service | El operador puede Ctrl-C el child (cmux maneja detach por SIGINT). Sin timeout server-side. **Aceptado** por scope (no se pide timeout en CONTEXT.md). |
| Signal flooding (Ctrl-C rápido repetido) | Denial of Service | noop SIGINT handler (D-12.1) ignora múltiples Ctrl-C silenciosamente. |
| Env var leak al child | Information Disclosure | `stdio:'inherit'` propaga env. Aceptado (binario local trusted). Si Phase futura necesita scrub, añadir `env: { ...filteredEnv }` al spawn. |

## Sources

### Primary (HIGH confidence)
- **CONTEXT.md `/Users/alex/dev/klab/kodo/.planning/phases/37-attach-handoff-cmux/37-CONTEXT.md`** — D-01..D-13 locked decisions, canonical refs, code context map.
- **PITFALLS.md `/Users/alex/dev/klab/kodo/.planning/research/PITFALLS.md`** §Pitfall 1 (lines 21-41), §Pitfall 13 (lines 342-347) — milestone-level mechanism locked.
- **ARCHITECTURE.md `/Users/alex/dev/klab/kodo/.planning/research/ARCHITECTURE.md`** §"ATTACH HANDOFF" lines 27-34, Pattern 4 (líneas 179-209), Anti-pattern 2.
- **STACK.md** — ink@6.8.0 + react@19 invariantes, no JSX.
- **src/cli/dashboard/index.js, App.js** (read directly) — current runDashboard/App state to modify.
- **src/cmux/client.js** (read directly) — REFERENCE for execFile pattern (NOT reused).
- **src/config.js** (read directly) — `cmux.binary` default path.
- **src/server.js:381** (read directly) — confirmed `alive: workspaceList.includes(s.workspace_ref)` (validates A5).
- **package.json** (read directly) — ink@6.8.0 + react@19.2.0 + ink-testing-library@4 confirmed.
- **test/format-isolation.test.js:199-220** (read directly) — TUI-04 walker confirmed covers `src/cli/dashboard/**`.
- **Phase 34/35/36 CONTEXT.md** (read directly) — heredados constraints aún válidos.
- **Phase 34/36 HUMAN-UAT.md** (read directly) — formato confirmado: `status:`/`source:`/`Current Test`/`Tests` con `expected`/`result`/`verified_via` + `Summary`/`Gaps`.

### Secondary (MEDIUM confidence)
- **`cmux --help` output** (run live) — refutó la asunción A1 / abre Q1. [VERIFIED en este equipo, 2026-05-28]
- **Node.js child_process docs** — `stdio:'inherit'` semantics + ENOENT via `'error'` event. [CITED: nodejs.org/api/child_process]
- **ink docs (Context7 `/vadimdemedes/ink`)** — `waitUntilExit` settle-after-cleanup contract. [CITED]

### Tertiary (LOW confidence, flagged for validation)
- **WebSearch results re: ink stdin listener leak** — Pitfall 3 está documentado en `slopus/happy#422`, `claude-code#404/#1072`, `claude-code#5925` pero no verificado empíricamente en ink@6.8.0 con este repo concreto. [ASSUMED severity]
- **cmux.com/docs/api** — confirms socket-based control, no terminal handoff verb. [WebFetch summary]
- **manaflow-ai-cmux.mintlify.app/cli/workspaces** — confirms `select-workspace` is the canonical "switch to" verb. [WebFetch summary]

## Metadata

**Confidence breakdown:**
- Standard Stack: **HIGH** — ink/react/spawn locked since Phase 34; verified against package.json.
- Architecture: **HIGH** — directly derived from PITFALLS.md Pitfall 1 + ARCHITECTURE.md Pattern 4 + CONTEXT.md D-01..D-12 (all locked).
- Pitfalls: **MEDIUM-HIGH** — Pitfalls 1-2 cross-referenced from milestone research (HIGH); Pitfalls 3-7 newly documented for this phase with MEDIUM confidence (3 needs empirical verification, 4-7 derived from Node/ink docs).
- C-01 (cmux verbo real): **HIGH** — empirically refuted via `cmux --help` on this machine.
- Validation: **HIGH** — pattern mirrors Phase 34-36 (DI-based tests + UAT for what can't be automated, established practice).
- Security: **HIGH** — V5/V8 analysis straightforward; spawn-array idiom blocks injection by default.

**Research date:** 2026-05-28
**Valid until:** ~2026-06-28 for ink/react ecosystem (stable line); **immediately stale for C-01** if operator clarifies the cmux verb mid-conversation.

---

## C-01: CRITICAL CHECK — `cmux attach <workspace_ref>` no existe

**Severity:** CRITICAL — blocks PLAN.md generation.
**Triggered by:** Empirical check during Step 2.6 Environment Availability Audit.

### Evidence

```
$ /Applications/cmux.app/Contents/Resources/bin/cmux attach --help
Unknown command 'attach'. Run 'cmux help' to see available commands.

$ /Applications/cmux.app/Contents/Resources/bin/cmux --help | grep -E "^  [a-z]" | grep -i workspace
  workspace-action --action <name> [--workspace ...]
  list-workspaces [--window <id|ref|index>]
  new-workspace [--name <title>] ...
  close-workspace --workspace <id|ref|index> ...
  select-workspace --workspace <id|ref|index> [--window <id|ref|index>]
  rename-workspace [--workspace <id|ref|index>] ...
  current-workspace [--window <id|ref|index>]
```

cmux es una app macOS GUI (Ghostty-based). Su CLI controla la app via socket Unix. **No hay verbo cmux que ceda el TTY del proceso parent.**

### Disposition

**1. Block PLAN.md until operator confirms the actual verb.** Escalar `/gsd:discuss-phase 37` con `Q1` (Open Questions). El operador conoce su intención; el researcher solo puede documentar el desajuste.

**2. Toda la arquitectura D-01..D-12 sigue siendo correcta y reusable** para cualquier verbo interactivo. Lo único variable: la string del binario + args en el call `spawn(cmuxBin, [...args], { stdio: 'inherit' })`. Phase 37's value ARCHITECTURAL es lo que está locked; el `cmux attach` particular es solo el call concreto en una línea de código.

**3. Hipótesis a presentar al operador:**
- **H1 (más probable):** El operador quiere `cmux select-workspace --workspace <ref>` — un RPC fire-and-forget. **Implicación:** Phase 37 se simplifica drásticamente (no D-06 alt-screen, no D-12 SIGINT noop, no loop iteración; un onClick simple desde dentro de useInput). El UAT manual cae de 4 escenarios a 2 (alive===false + ENOENT siguen aplicables; los 2 de handoff TTY desaparecen).
- **H2:** El operador tiene un alias `cmux` distinto en PATH (NO cmux.app) que sí tiene `attach` y sí toma el TTY. **Implicación:** confirmar `which cmux` y `loadConfig().cmux.binary` actuales del operador; pivot del default.
- **H3:** Otra integración (e.g., `tmux attach -t <ref>` over cmux workspace, o un wrapper shell). **Implicación:** rediseñar el contrato de `workspace_ref` para mapearlo al target real.

**4. Si el operador confirma H1:** abrir un nuevo PASE de planning con CONTEXT.md actualizado (Phase 37 se vuelve fase de RIESGO BAJO, no alta). Re-run `/gsd:discuss-phase`.

**5. Si el operador confirma H2 o H3:** ajustar Code Example 2 (`runAttach`) con el binario y args correctos, el resto de arquitectura permanece.

**No proceed with PLAN.md until C-01 has explicit operator disposition recorded in CONTEXT.md (e.g., addendum section "Hypothesis H1 confirmed → spawn args = ['select-workspace', '--workspace', ref]").**
