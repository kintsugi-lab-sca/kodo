# Phase 34: Fundación — subcomando + ciclo de vida - Research

**Researched:** 2026-05-26
**Domain:** Subcomando TUI con ink (React-for-CLI) dentro de un CLI Node.js ESM existente — scaffold + guards + ciclo de vida (sin lógica de negocio)
**Confidence:** HIGH

> Idioma: este documento y todo output de cara al usuario van en español. Identificadores de código y términos técnicos (`render`, `useApp`, `isRawModeSupported`, `picocolors`, etc.) se mantienen en su forma original.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Esqueleto mínimo (TUI-01)**
- **D-01:** El render inicial muestra chrome estético desde el primer commit: una línea de título/banner `kodo dashboard` arriba, un placeholder central `starting…`, y un footer con el hint de teclas `q quit`. No es un marco vacío ni solo-título.
- **D-02:** El header con contadores por estado + indicador "live" (TUI-11) y el cuerpo con datos reales pertenecen a Phase 36 — Phase 34 solo deja el marco listo para que esas fases lo rellenen. El placeholder `starting…` es estático (no hay polling todavía).

**Refuse non-TTY (TUI-02)**
- **D-03:** El guard se ejecuta **antes** de `render()` (vía `isRawModeSupported` / chequeo de TTY). Si stdout no es un TTY (pipe/CI), se imprime a **stderr** un mensaje accionable y se sale con **exit code 1**.
- **D-04:** Mensaje canónico (único para todos los casos non-TTY, sin diferenciar pipe vs raw-mode): `kodo dashboard requires an interactive terminal (TTY). Run it directly in your terminal, not in a pipe or CI.` Este string es estable — el test de spawn-piped lo asierta.

**Superficie CLI (TUI-01)**
- **D-05:** Subcomando config-driven: por defecto construye la base URL desde `loadConfig().server.port` (default 9090, ver `src/config.js:62-66`). Se expone **un único flag de escape**: `--url <baseUrl>` para apuntar a otro host/puerto sin tocar config (útil para debugging). No hay `--port`/`--host` separados.
- **D-06:** Description del comando: `Live TUI dashboard of active kodo sessions`. Sin alias.
- **D-07:** Registro vía `commander` con lazy import del módulo dashboard, idéntico al patrón de `config`/`status`/`logs` en `src/cli.js` (la `.action` hace `await import('./cli/dashboard/index.js')`).

**Bindings de salida / ciclo de vida (TUI-03)**
- **D-08:** `q` sale vía `useApp().exit()`.
- **D-09:** Ctrl-C usa el `exitOnCtrlC` default de ink (ink desmonta y restaura la terminal). No se sobrescribe.
- **D-10:** SIGTERM tiene **handler propio explícito** que invoca el mismo camino de cleanup (`exit()` / `unmount()`) para garantizar terminal intacta — no se confía en el default de Node.
- **D-11:** `Esc` **NO** sale en el root. Se reserva deliberadamente para "volver a la tabla" en los overlays de Phase 38 — fijar esta semántica desde ahora evita reeducar al operador y cambiar el binding más adelante.

**Color-isolation (TUI-04)**
- **D-12:** Cero imports de `picocolors` bajo `src/cli/dashboard/**`. Todo el color del TUI proviene exclusivamente de `<Text color>` de ink. No pre-colorear strings con `createFormatter` antes de pasarlos a `<Text>` (doble-encoda ANSI y rompe el width math de ink).
- **D-13:** La verificación extiende el walker del `test/format-isolation.test.js` existente para cubrir el directorio TUI (criterio de éxito #4 del ROADMAP) — no se crea un test nuevo separado.

### Claude's Discretion
- Estructura exacta de archivos dentro de `src/cli/dashboard/` (el research sugiere `index.js`/`App.js`/`components/` pero la partición fina es criterio de implementación).
- Ubicación precisa del chequeo de TTY (en `index.js` `runDashboard` antes de `render()`).
- Detalles de markup del banner/footer (uso de `<Box>` con/sin borde, padding) mientras respete D-01.

### Deferred Ideas (OUT OF SCOPE)
- Exit codes diferenciados por causa de non-TTY (1 piped vs 2 raw-mode) — descartado por over-engineering en v1; un único exit 1 es suficiente.
- Flags `--port`/`--host` separados — descartados a favor de un único `--url`.
- Alias del subcomando (`dash`, `ui`) — no en v1.
- Header con contadores + indicador "live" + cuerpo con datos reales — Phase 36 (TUI-11), no Phase 34.
- **(Implícito por la frontera de fase)** Cliente HTTP/polling (Phase 35), tabla/selección/filtros (Phase 36), attach a cmux (Phase 37), overlays comments/logs (Phase 38). Phase 34 NO renderiza datos reales: el cuerpo es placeholder estático.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TUI-01 | El usuario lanza el panel en vivo con `kodo dashboard` | Patrón de registro `commander` + lazy import verificado en `src/cli.js` (análogo directo: `status`/`logs`). `render(<App/>)` con esqueleto estático (chrome D-01). Base URL desde `loadConfig().server.port` + `--url`. |
| TUI-02 | Si stdout no es un TTY (pipe/CI), el dashboard se niega a arrancar con mensaje claro y exit code ≠ 0 (no crash, no raw-mode error) | Pre-render guard `!process.stdout.isTTY \|\| !process.stdin.isTTY` → stderr + `process.exit(1)` **antes** de `render()`. Belt-and-suspenders: `useStdin().isRawModeSupported` dentro del componente. Test: `spawnSync(bin/kodo dashboard)` con stdio piped → exit 1 + mensaje canónico (análogo: `test/version-smoke.test.js`, `test/session-of-resolver.test.js`). |
| TUI-03 | El usuario sale limpiamente con `q` (y Ctrl-C / SIGTERM): cursor, echo y scrollback intactos | `q` → `useApp().exit()` (NO `process.exit`). Ctrl-C → `exitOnCtrlC` default de ink. SIGTERM → handler explícito que llama al mismo cleanup. ink restaura terminal en `unmount()`. Limpiar side-effects en `useEffect` cleanup. |
| TUI-04 | El color del TUI proviene exclusivamente de ink; ningún archivo bajo `src/cli/dashboard/` importa `picocolors` — verificado por test | Color via `<Text color>`. Extender el walker de `test/format-isolation.test.js` (ya escanea todo `src/` con `listJsFiles`) con una aserción que garantice cero importadores de `picocolors` bajo `src/cli/dashboard/`. ink NO es `picocolors` → la aserción existente sigue verde sin tocarla. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

El `CLAUDE.md` global del usuario aplica (no hay `CLAUDE.md` de proyecto con directivas técnicas — el del repo solo tiene el bloque `claude-mem-context`). Directivas relevantes para esta fase:

- **Regla 3 — Cambios quirúrgicos:** tocar solo lo necesario. Para Phase 34 eso significa: `src/cli.js` (+1 bloque `command`), `package.json` (deps), `test/format-isolation.test.js` (extender walker), y crear `src/cli/dashboard/`. NO refactorizar comandos vecinos ni el resto del test.
- **Regla 2 — Simplicidad primero:** el chrome es un placeholder estático; nada de polling, estado de datos ni abstracciones especulativas en esta fase.
- **Responder siempre en español** (aplicado a este documento y a todo output de planning).
- **Política de merge por blast radius:** añadir 3 prod deps + un subcomando nuevo es **Tier 2** (feature/refactor) → PR con review, no fast-forward directo. (Decisión de proceso, no de research; se anota para el planner.)

## Summary

Phase 34 es la **fundación** del milestone v0.9 TUI: monta el esqueleto del subcomando `kodo dashboard` con ink, y establece tres invariantes de disciplina **antes** de cualquier lógica de negocio — refuse non-TTY (guard antes de `render()`), ciclo de vida limpio (`q`/Ctrl-C/SIGTERM dejan la terminal intacta), y color-isolation (cero `picocolors` bajo el directorio TUI, verificado por test). No se renderiza ningún dato real: el cuerpo es un placeholder `starting…` estático. El milestone research (`.planning/research/`, confidence HIGH) ya verificó stack, arquitectura y pitfalls contra el codebase y el registro npm; este documento destila esa investigación a lo que Phase 34 necesita y re-verifica las versiones contra npm en vivo (2026-05-26).

El stack está **bloqueado y re-verificado hoy**: `ink@^6.8.0` (NO `ink@7`, que exige Node `>=22` y rompería `engines.node >=20`) + `react@^19.2.0` + `ink-testing-library@^4.0.0` (devDep). `ink-text-input` NO entra en esta fase (es para el filtro `/` de Phase 36). Sin paso de build: `React.createElement` en `.js` plano. El patrón de registro del subcomando es idéntico al de `status`/`logs` en `src/cli.js` (verificado: `program.command(...).description(...).action(async () => { await import('./cli/dashboard/index.js') })`). El test de spawn-piped del guard non-TTY tiene análogos directos en el repo (`test/version-smoke.test.js` y `test/session-of-resolver.test.js` ya usan `spawnSync(process.execPath, [KODO_BIN, ...])`).

Los tres pitfalls que esta fase debe evitar (Pitfalls 4, 9, 10 del milestone research): (4) crash en non-TTY en vez de refuse elegante → guard pre-render; (9) dirty exit que deja raw mode / cursor oculto / scrollback corrupto → `exit()` no `process.exit()`, + SIGTERM handler explícito; (10) leak de `picocolors` en el TUI → walker extendido. Las primitivas de lifecycle que se construyen aquí (`unmount`/`waitUntilExit`/restauración de terminal) son las mismas que reusará el handoff de attach en Phase 37, por eso es crítico fijarlas bien desde el primer commit.

**Primary recommendation:** Crear `src/cli/dashboard/index.js` (`runDashboard`) como propietario del proceso (resuelve base URL, guard non-TTY pre-render, `render()`, SIGTERM handler, exit code) + `src/cli/dashboard/App.js` (componente root con chrome estático D-01 y routing mínimo de `useInput` para `q`); registrar `kodo dashboard` en `src/cli.js` con lazy import; añadir `ink`+`react` a deps y `ink-testing-library` a devDeps con `React.createElement` (sin build); extender el walker de `test/format-isolation.test.js`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Registro del subcomando `kodo dashboard` | CLI / Backend (commander en `src/cli.js`) | — | Punto de entrada del proceso; mirror del patrón de todos los subcomandos existentes |
| Resolución de base URL (config + `--url`) | CLI / Process (`dashboard/index.js`) | Config (`src/config.js`) | `index.js` es dueño del proceso; lee `loadConfig().server.port`; el TUI no toca config |
| Guard non-TTY (refuse antes de render) | CLI / Process (`dashboard/index.js`) | Browser/Client (ink `isRawModeSupported` como belt-and-suspenders) | Debe correr antes de que ink tome el TTY; un crash de raw-mode es un fallo de proceso, no de UI |
| Render del esqueleto (chrome estático) | Terminal UI / Client (ink `App.js`) | — | ink owns el TTY y la composición flexbox; el chrome vive en el árbol React |
| Ciclo de vida / cleanup (`q`/Ctrl-C/SIGTERM) | CLI / Process (`index.js` + ink lifecycle) | Terminal UI (`useApp().exit` desde `App.js`) | La restauración de terminal es responsabilidad de ink (`unmount`); el SIGTERM handler y el exit code viven en el proceso |
| Color del TUI | Terminal UI / Client (ink `<Text color>`) | — | ink tiene su propio sistema de color (chalk interno); `picocolors`/`format.js` es el dominio del CLI clásico, ortogonal |

**Nota de tiers:** el `App.js`/componentes ink son "Terminal UI / Client" (análogo al browser tier de una webapp: renderizan, capturan input). `index.js` es "Process / Backend": dueño del lifecycle, exit code, y handoff de TTY. La separación importa porque el guard non-TTY y el SIGTERM handler NO pueden vivir en un componente React (corren antes del render y fuera del árbol, respectivamente).

## Standard Stack

> Versiones re-verificadas contra el registro npm en vivo el 2026-05-26 (`npm view`). El milestone research (`.planning/research/STACK.md`) llegó a las mismas conclusiones; aquí se confirman y se acotan a lo que Phase 34 instala.

### Core (entran en Phase 34)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `^6.8.0` | Renderer React para terminal: `render()`, `<Box>`/`<Text>`, `useInput`, `useApp`, `useStdin` | `[VERIFIED: npm view ink@6.8.0]` `engines.node ">=20"` — mantiene el floor del proyecto. `ink@7.0.4` (latest) exige Node `>=22` → rompería `engines.node >=20` de kodo. ink@6.8.0 es la cabeza de la línea 6. |
| `react` | `^19.2.0` | Peer obligatorio de ink (NO viene bundleado); `useState`/`useEffect` para lifecycle | `[VERIFIED: npm view ink@6.8.0 peerDependencies]` → `react ">=19.0.0"`. react latest = `19.2.6` `[VERIFIED: npm view react version]`. Pin `^19.2.0` satisface también el peer más estricto de ink@7 (`>=19.2.0`) si en el futuro se sube. |

### Supporting (devDep, entra en Phase 34 para el test harness)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ink-testing-library` | `^4.0.0` | Renderizar componentes ink a buffer de string en `node --test` (`render()` → `{lastFrame, frames, stdin, rerender, unmount}`); simular input sin TTY | `[VERIFIED: npm view ink-testing-library version → 4.0.0]` Peer solo `@types/react` (opcional) → version-agnóstico a ink/react. devDep. Necesario para testear el render del chrome y el routing de `q` sin un TTY real. |
| `@types/react` | `^19` | Type-checking del TUI bajo el `@ts-check` JSDoc existente | Opcional pero recomendado como devDep. `[ASSUMED]` el repo usa `// @ts-check` (verificado en `src/cli.js:1`, `src/config.js:1`); mantenerlo verde sobre la superficie ink/React justifica el types pkg. Confirmar con el usuario si se quiere el coste de +1 devDep. |

### NO entran en Phase 34 (fases posteriores)

| Library | Version | Phase | Por qué no ahora |
|---------|---------|-------|------------------|
| `ink-text-input` | `^6.0.0` | Phase 36 | Es para el input del filtro `/`. No hay filtros en la fundación. `[VERIFIED: npm view ink-text-input → 6.0.0, peer ink>=5 react>=18]` |
| `globalThis.fetch` (built-in) | — | Phase 35 | El cliente HTTP/polling es Phase 35. Phase 34 no consume `/status`. (No es dep, es built-in de Node 20+.) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `ink@6.8.0` (Node >=20) | `ink@7.0.4` (Node >=22) | Romper `engines.node >=20` — invariante dura del proyecto. Solo si el equipo sube el floor a 22 deliberadamente. **NO recomendado.** |
| `React.createElement` (sin build) | `.jsx` vía loader `tsx` | Reintroduce acoplamiento de build-step + cambia cómo se invoca el binario. Viola "no build step". Solo opt-in explícito si la verbosidad de `createElement` duele. **NO recomendado en v1.** |
| Hand-roll esqueleto con `<Box>`/`<Text>` | `ink-table` | `ink-table` está `0.0.0-development`, CJS, peerDeps stale (react>=16.8). Irrelevante en Phase 34 (no hay tabla todavía) pero el principio aplica: hand-roll. |

**Installation:**
```bash
# Core (prod) — ink + su peer React obligatorio
npm install ink@^6.8.0 react@^19.2.0

# Dev — testing harness (+ types opcional). NO transpiler/build step.
npm install -D ink-testing-library@^4.0.0 @types/react@^19
```

Cambio neto de prod deps en esta fase: **2 → 4** (`commander`, `picocolors` + `ink`, `react`). `ink-text-input` (la 5ª prod dep prevista en el milestone) entra en Phase 36, no aquí.

**Version verification (ejecutado 2026-05-26):**
- `ink` latest = `7.0.4`, `engines.node >=22` `[VERIFIED: npm view]`
- `ink@6.8.0` `engines.node >=20`, peer `react >=19.0.0`, `@types/react >=19.0.0`, `react-devtools-core >=6.1.2` `[VERIFIED: npm view]`
- `react` latest = `19.2.6` `[VERIFIED: npm view]`
- `ink-text-input` = `6.0.0`, peer `ink >=5`, `react >=18` `[VERIFIED: npm view]` (no se instala en Phase 34)
- `ink-testing-library` = `4.0.0` `[VERIFIED: npm view]`

## Architecture Patterns

### System Architecture Diagram

```
operador  ──$ kodo dashboard [--url <baseUrl>]──►  bin/kodo
                                                      │
                                                      ▼
                          src/cli.js  (commander)
                          program.command('dashboard')
                            .description('Live TUI dashboard of active kodo sessions')
                            .option('--url <baseUrl>', ...)
                            .action(async (opts) => {
                               const { runDashboard } = await import('./cli/dashboard/index.js'); // lazy
                               await runDashboard({ url: opts.url });
                            })
                                                      │
                                                      ▼
                  src/cli/dashboard/index.js  ── runDashboard(deps)  [PROCESS OWNER]
                                                      │
              ┌───────────────────────────────────────┼───────────────────────────────┐
              ▼ (1) resolver base URL                  ▼ (2) GUARD non-TTY              ▼ (3) lifecycle
   baseUrl = opts.url                       if (!stdout.isTTY || !stdin.isTTY) {   - SIGTERM handler → exit()/unmount()
     ?? `http://localhost:${                   stderr.write(CANONICAL_MSG)          - exitOnCtrlC default (ink) → Ctrl-C
        loadConfig().server.port}`             process.exit(1)        ◄── ANTES     - q → useApp().exit()  (desde App)
     (default 9090)                          }                          de render()  - process.exitCode = 0 al salir limpio
                                                      │
                                                      ▼ (TTY OK)
                                          render(createElement(App, { baseUrl }))
                                                      │
                                                      ▼
                  src/cli/dashboard/App.js  ── root ink component  [TERMINAL UI]
                    ┌──────────────────────────────────────────┐
                    │  ┌────────────────────────────────────┐  │  ← <Box> con borde (opcional, D-01 discrecional)
                    │   kodo dashboard            (banner)      │  ← <Text>  (color via ink, NUNCA picocolors)
                    │                                           │
                    │     starting…               (placeholder)│  ← estático, sin polling (D-02)
                    │                                           │
                    │   q quit                    (footer hint) │
                    │  └────────────────────────────────────┘  │
                    └──────────────────────────────────────────┘
                    useInput((input, key) => { if (input === 'q') exit(); /* Esc NO sale (D-11) */ })
```

**Trazado del caso primario (lanzar + salir):** operador ejecuta `kodo dashboard` → commander resuelve la `.action` → lazy import de `index.js` → `runDashboard` resuelve baseUrl, corre el guard non-TTY (si falla: stderr + exit 1, fin), si pasa monta `App` con `render()` → ink dibuja el chrome estático → operador pulsa `q` → `useApp().exit()` → ink desmonta y restaura la terminal → `waitUntilExit()` resuelve → `process.exitCode = 0` → proceso termina con la terminal intacta.

### Recommended Project Structure (alcance Phase 34)

```
src/cli/dashboard/
├── index.js            # runDashboard(deps): resolver baseUrl, guard non-TTY, render(), SIGTERM handler, exit code
└── App.js              # componente root ink: chrome estático (banner/placeholder/footer) + useInput('q' → exit)
```

> El milestone research propone una estructura completa de 7+ archivos (`client.js`, `select.js`, `usePoll.js`, `attach.js`, `components/`). **Esos NO entran en Phase 34** — se crean en Phases 35-38 a medida que se necesitan. En la fundación basta `index.js` + `App.js`. (Claude's Discretion D-69 de CONTEXT: la partición fina es criterio de implementación; el planner puede inline el chrome en `App.js` o sacar componentes pequeños — recomendación: mantenerlo en `App.js` por simplicidad, Regla 2.)

### Pattern 1: Registro de subcomando con lazy import (idéntico a `status`/`logs`)
**What:** Un bloque `program.command(...)` en `src/cli.js` que en su `.action` hace `await import()` del módulo dashboard. El lazy import mantiene el arranque del CLI ligero y aísla las deps de ink (que son pesadas) al path del subcomando — no se cargan en `kodo --version`, `kodo check`, etc.
**When to use:** El registro del comando `dashboard` (D-07).
**Example:**
```js
// src/cli.js — mirror exacto del patrón de `status` (líneas 250-270) y `logs` (273-298)
// Source: VERIFIED en src/cli.js del repo
program
  .command('dashboard')
  .description('Live TUI dashboard of active kodo sessions') // D-06
  .option('--url <baseUrl>', 'Base URL del server kodo (default: http://localhost:<config.server.port>)') // D-05
  .action(async (opts) => {
    const { runDashboard } = await import('./cli/dashboard/index.js'); // D-07 lazy import
    await runDashboard({ url: opts.url });
  });
```
> Nota: el repo NO usa `commander` para parsear flags *dentro* del TUI — el TUI es interactivo, no flag-driven. `commander` solo registra el punto de entrada.

### Pattern 2: Guard non-TTY ANTES de `render()` (refuse elegante, no crash)
**What:** Chequeo de `process.stdout.isTTY` / `process.stdin.isTTY` en `runDashboard` antes de llamar a `render()`. Si falla, escribir el mensaje canónico a stderr y `process.exit(1)`. Más barato y claro que el throw runtime de ink (`Raw mode is not supported`).
**When to use:** Entrada de `runDashboard` (D-03). Belt-and-suspenders: gatear `useInput` con `useStdin().isRawModeSupported` dentro de `App` por si queda algún path residual.
**Example:**
```js
// src/cli/dashboard/index.js
// Source: CITED ink#166 (canonical non-TTY crash pattern) + D-03/D-04 (CONTEXT)
const NON_TTY_MSG =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.'; // D-04 — string estable, asertado por test

export async function runDashboard(deps = {}) {
  const { stdout = process.stdout, stdin = process.stdin } = deps;
  if (!stdout.isTTY || !stdin.isTTY) {
    process.stderr.write(NON_TTY_MSG + '\n');
    process.exit(1); // D-03 — exit code 1, ANTES de render()
  }
  // ... resolver baseUrl, render(), SIGTERM handler ...
}
```

### Pattern 3: Ciclo de vida limpio (`q`/Ctrl-C/SIGTERM) — terminal intacta
**What:** `q` desmonta vía `useApp().exit()` (NO `process.exit()`, que saltaría el teardown de ink y dejaría raw mode / cursor oculto). Ctrl-C lo cubre el `exitOnCtrlC: true` default de ink. SIGTERM necesita un handler explícito que llame al mismo camino de cleanup, porque el default de Node para SIGTERM es matar el proceso sin restaurar la terminal.
**When to use:** Todo el lifecycle de salida (D-08/D-09/D-10/D-11).
**Example:**
```js
// src/cli/dashboard/App.js — q sale; Esc NO (D-11)
// Source: CITED ink README (useApp, useInput, exitOnCtrlC) + D-08/D-11
import { useApp, useInput } from 'ink';
function App() {
  const { exit } = useApp();
  useInput((input, key) => {
    if (input === 'q') exit();    // D-08 — clean unmount, no process.exit
    // Esc deliberadamente NO sale (D-11 — reservado para overlays Phase 38)
  });
  // ... chrome estático ...
}

// src/cli/dashboard/index.js — SIGTERM handler explícito
// Source: D-10 + CITED ink README (unmount restaura terminal)
const app = render(createElement(App, { baseUrl }));
const onSigterm = () => { app.unmount(); }; // mismo camino de cleanup que q/Ctrl-C
process.once('SIGTERM', onSigterm);
await app.waitUntilExit();
process.removeListener('SIGTERM', onSigterm);
process.exitCode = 0; // salida limpia
```

### Pattern 4: Color del TUI vía ink, NUNCA `picocolors`
**What:** Todo color en el TUI sale de `<Text color="...">` de ink (ink trae su propio sistema de color basado en chalk interno). Ningún archivo bajo `src/cli/dashboard/` importa `picocolors`. NO pre-colorear strings con `createFormatter` antes de pasarlos a `<Text>`.
**When to use:** Cualquier color en el chrome (banner, footer). En Phase 34 probablemente sea mínimo (el placeholder puede ser monocromo), pero la **disciplina de import** se fija desde el primer commit.
**Example:**
```js
// Source: VERIFIED test/format-isolation.test.js:98-115 (la aserción que define el invariante)
import { Text } from 'ink';
const banner = createElement(Text, { bold: true }, 'kodo dashboard'); // color via prop, no import
// PROHIBIDO: import pc from 'picocolors'; ... `<Text>${pc.green(x)}</Text>`  ← doble-encoda ANSI
```

### Anti-Patterns to Avoid
- **`process.exit(0)` en `q`:** salta el teardown de ink → raw mode / cursor oculto / scrollback corrupto. Usar `useApp().exit()`. (Pitfall 9)
- **No cablear SIGTERM:** `exitOnCtrlC` solo cubre Ctrl-C; SIGTERM sin handler mata el proceso con la terminal en raw mode. (D-10, Pitfall 9)
- **Spawnear/`render()` antes del guard non-TTY:** ink lanza `Raw mode is not supported` con stack trace en vez de un mensaje limpio. Guard primero. (Pitfall 4)
- **`import 'picocolors'` en el TUI:** rompe `test/format-isolation.test.js`. Color via ink. (Pitfall 10)
- **JSX / build step:** rompe "no build step". Usar `React.createElement`.
- **`ink@7`:** sube el floor de Node a 22, rompe `engines.node >=20`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Renderizar un panel TUI con layout | Escape codes ANSI + posicionamiento de cursor a mano | ink `<Box>`/`<Text>` (flexbox via yoga) | ink hace diffing, layout flexbox, y restauración de terminal; reinventarlo es la fuente clásica de bugs de raw-mode |
| Restaurar la terminal al salir | `process.stdout.write('\x1b[?25h...')` manual | `useApp().exit()` / `app.unmount()` de ink | ink restaura cursor, echo, alternate screen y consola nativa en unmount — verificado en su README |
| Detectar TTY / raw-mode support | Heurísticas propias | `process.stdout.isTTY` (guard) + `useStdin().isRawModeSupported` (ink) | API estándar; el guard explícito da mejor mensaje que el throw de ink |
| Testear un componente ink sin TTY | Spawnear un PTY falso | `ink-testing-library` (`render()` → `lastFrame()` + `stdin.write()`) | Renderiza a buffer de string, alimenta input sin TTY real — funciona bajo `node --test` |

**Key insight:** En esta fase el "don't hand-roll" principal es **el ciclo de vida de la terminal**. ink ya resuelve el problema difícil (raw mode, restauración, diffing). El trabajo de Phase 34 es *cablearlo correctamente* (guard antes de render, SIGTERM al mismo cleanup), no reimplementarlo.

## Runtime State Inventory

> Phase 34 es **greenfield** (crea archivos nuevos, no renombra ni migra). No hay state runtime preexistente que toque esta fase. Las cinco categorías se responden explícitamente para descartar sorpresas.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Ninguno — Phase 34 no lee ni escribe datastores. El placeholder es estático; no consume `/status` ni toca `state.json`/`history`. | None |
| Live service config | Ninguno nuevo. El TUI leerá `loadConfig().server.port` (Phase 35+), pero Phase 34 solo resuelve la baseUrl en memoria; no muta config ni servicios. | None |
| OS-registered state | Ninguno. No hay tasks/daemons/launchd nuevos. El subcomando corre en foreground a demanda. | None |
| Secrets/env vars | Ninguno nuevo. El TUI es cliente read-only de localhost; no lee secrets. (`--url` es un flag, no un env var.) | None |
| Build artifacts | **`package.json` cambia** (3 deps nuevas → `package-lock.json` se regenera, `node_modules/` crece). NO hay egg-info/binarios compilados (Node, sin build step). El binario `bin/kodo` corre directo. | `npm install` regenera lock; commitear `package.json` + `package-lock.json` juntos. |

**Verificado por:** lectura directa de `package.json` (solo `commander`+`picocolors`, sin scripts de build), `src/cli.js` (no hay subcomando `dashboard` aún), y `ls src/cli/dashboard` → no existe. Phase 34 es aditivo puro.

## Common Pitfalls

> Subconjunto del milestone research (`.planning/research/PITFALLS.md`) que aplica a Phase 34. Los pitfalls 1, 2, 3, 5, 6, 7, 8, 11, 12, 13 pertenecen a fases posteriores (polling, tabla, attach, aux) y NO se abordan aquí.

### Pitfall 1 (= P4 milestone): TUI crashea en vez de refusar en non-TTY
**What goes wrong:** `kodo dashboard | cat`, en CI, o con stdin redirigido → ink lanza `Raw mode is not supported on the current process.stdin` con stack trace y exit no determinista.
**Why it happens:** `useInput`/`setRawMode` requieren `stdin.isTTY`. ink solo lanza *cuando el input se usa de verdad*; el dev testea interactivo (siempre TTY) y nunca pega el path de pipe.
**How to avoid:** Pre-render guard (`!stdout.isTTY || !stdin.isTTY` → stderr + exit 1) antes de `render()` (D-03). Belt-and-suspenders: `useStdin().isRawModeSupported` dentro de `App`.
**Warning signs:** Stack trace con `setRawMode`; funciona en tu terminal pero falla bajo `| head` o en CI.

### Pitfall 2 (= P9 milestone): Dirty exit deja la terminal rota
**What goes wrong:** En `q`/SIGINT/SIGTERM, si el cleanup es incompleto el operador queda en un shell sin cursor, sin echo (raw mode aún activo), o con scrollback corrupto.
**Why it happens:** Llamar `process.exit(0)` en `q` en vez de desmontar; o no cablear SIGTERM (`exitOnCtrlC` solo cubre Ctrl-C).
**How to avoid:** `q` → `useApp().exit()` (D-08). SIGTERM → handler explícito al mismo cleanup (D-10). Ctrl-C → `exitOnCtrlC` default (D-09). Exit code 0 en salida limpia.
**Warning signs:** Tras `q` el shell no tiene cursor o no hace echo; Ctrl-C deja un proceso colgado; el alternate screen "se pega".

### Pitfall 3 (= P10 milestone): Leak de `picocolors` en el TUI
**What goes wrong:** Un archivo del TUI importa `picocolors` (directo o transitivo) → `test/format-isolation.test.js` se pone rojo (invariante que define el proyecto).
**Why it happens:** Reflejo de "reusar `createFormatter`" del CLI clásico.
**How to avoid:** Color exclusivamente via `<Text color>` de ink (D-12). Extender el walker del test para escanear `src/cli/dashboard/**` (D-13). ink NO es `picocolors`, así que la aserción existente sigue verde sin tocarla.
**Warning signs:** `format-isolation` falla tras añadir código TUI; un `from 'picocolors'` fuera de `src/cli/format.js`.

### Pitfall 4 (proceso): Bump accidental a `ink@7` sube el floor de Node
**What goes wrong:** `npm install ink` (sin pin) trae `ink@7.0.4` que exige Node `>=22` → mismatch latente con `engines.node >=20`.
**How to avoid:** Pin `ink@^6.8.0` explícito en `package.json`. Opcional: aserción en el smoke test de que `engines.node` sigue `>=20`.
**Warning signs:** `engines.node` cambia en el diff de `package.json`; warnings de peer/engine en `npm install`.

## Code Examples

> Patrones verificados contra el codebase y los docs de ink (Context7/README, citados en el milestone research). Los ejemplos de Patterns 1-4 arriba son los load-bearing; aquí se añade el test de spawn-piped (criterio de verificación de TUI-02) por tener análogo directo en el repo.

### Test de spawn-piped del guard non-TTY (verificación de TUI-02)
```js
// test/dashboard-non-tty.test.js (nuevo) — análogo directo de test/version-smoke.test.js
// Source: VERIFIED test/version-smoke.test.js + test/session-of-resolver.test.js (patrón spawnSync(bin/kodo))
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_BIN = join(resolve(__dirname, '..'), 'bin', 'kodo');
const CANONICAL =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.';

describe('TUI-02: kodo dashboard refuses non-TTY', () => {
  it('exits 1 with canonical stderr when stdout/stdin are not a TTY', () => {
    // spawnSync con pipes (sin TTY) reproduce `kodo dashboard | cat` / CI
    const r = spawnSync(process.execPath, [KODO_BIN, 'dashboard'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'], // ninguno es TTY
      timeout: 10_000,
    });
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\nstderr: ${r.stderr}`);
    assert.match(r.stderr, /requires an interactive terminal \(TTY\)/);
    assert.equal(r.stderr.trim(), CANONICAL);
  });
});
```

### Render del chrome con ink-testing-library (verificación de TUI-01/D-01)
```js
// test/dashboard-render.test.js (nuevo)
// Source: CITED ink-testing-library README (render → lastFrame, stdin.write)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

describe('TUI-01: dashboard chrome (D-01)', () => {
  it('renders banner + starting placeholder + q quit footer', () => {
    const { lastFrame } = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    const frame = lastFrame();
    assert.match(frame, /kodo dashboard/);
    assert.match(frame, /starting…/);
    assert.match(frame, /q quit/);
  });

  it('q triggers exit (clean unmount)', () => {
    const { stdin, lastFrame } = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    stdin.write('q');
    // exit() desmonta; aserción depende de cómo App señale exit (useApp mock o flag)
    // — el planner define la aserción concreta según la firma elegida.
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| TUIs hand-rolled con `readline` + ANSI escapes | ink (React-for-CLI) con flexbox + diffing | ink maduro desde ~2020; v6/v7 son la línea actual | Layout declarativo, restauración de terminal gratis, testeable sin TTY via ink-testing-library |
| `setRawMode` manual + restauración propia | `useApp().exit()` / `app.unmount()` de ink | API estable de ink | Phase 34 NO debe reinventar esto |
| React 18 / ink 5 | React 19 / ink 6+ (ink 7 = Node 22) | ink 6 → react>=19; ink 7 (2025) → Node>=22 | Pin `ink@6.8.0` para mantener Node>=20 |

**Deprecated/outdated:**
- `ink-table`: `0.0.0-development`, CJS, react>=16.8 — abandonado. (Irrelevante en Phase 34; hand-roll cuando llegue la tabla en Phase 36.)
- JSX con build step para ink en kodo: rechazado por la cultura "no build step" → `React.createElement`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@types/react` se quiere como devDep para mantener `@ts-check` sobre la superficie ink | Standard Stack (Supporting) | Bajo — es opcional; si el usuario no lo quiere, se omite sin afectar funcionalidad. ink's peer lo marca opcional. |
| A2 | El chrome del placeholder puede ser monocromo en Phase 34 (el color real llega en Phase 36) | Pattern 4 / Code Examples | Bajo — D-01 pide banner/placeholder/footer pero no especifica color; el planner puede añadir un `<Text bold>` sin romper nada. |
| A3 | El test de render usará `ink-testing-library` con `createElement(App, {...})` y aserción sobre `lastFrame()`; la aserción exacta de `q→exit` depende de la firma que elija el planner | Code Examples | Bajo — patrón estándar; la firma concreta (mock de `useApp` vs flag inyectado) es criterio de implementación. |

**Nota:** El resto de claims técnicos están `[VERIFIED]` (npm registry, lectura directa del codebase) o `[CITED]` (ink README/Context7 vía el milestone research de confidence HIGH). El stack, los pitfalls y la arquitectura no requieren confirmación del usuario — ya fueron decisiones lockeadas en CONTEXT.md. Las 3 asunciones arriba son de bajo riesgo y de detalle de implementación.

## Open Questions

1. **¿Se commitea `@types/react` o se omite?**
   - What we know: ink lo marca como peer opcional; el repo usa `@ts-check` (verificado).
   - What's unclear: si el usuario quiere el coste de +1 devDep para type-checking del TUI.
   - Recommendation: incluirlo (coste trivial, mantiene `@ts-check` verde). Si el planner/usuario prefiere minimalismo, omitirlo no rompe nada.

2. **¿`App.js` monolítico o componentes Header/Footer separados desde Phase 34?**
   - What we know: Claude's Discretion (CONTEXT) deja la partición fina al implementador. El milestone research sugiere `components/` pero para fases con datos.
   - What's unclear: cuánta estructura adelantar.
   - Recommendation: **monolítico en `App.js`** (Regla 2 — simplicidad; no estructura especulativa). Phase 36 sacará componentes cuando haya tabla real. El chrome estático no lo justifica aún.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Ejecutar `bin/kodo dashboard` + ink@6 (`>=20`) | ✓ | v25.9.0 (local) `[VERIFIED: node --version]` | — (cumple `>=20`) |
| npm | Instalar ink/react/ink-testing-library | ✓ | (bundled con Node) | — |
| ink@6.8.0 | Render TUI | ✗ (no instalado aún) | — | Ninguno — es la dep core; se instala en esta fase |
| react@19.2.x | peer de ink | ✗ (no instalado aún) | — | Ninguno — peer obligatorio |
| Terminal TTY (para UAT manual / uso real) | TUI-01/TUI-03 | ✓ (entorno de desarrollo) | — | El test automático usa pipes (non-TTY) para TUI-02; el render se testea con ink-testing-library (TTY falso) |

**Missing dependencies with no fallback:** ninguna que bloquee — `ink`+`react` son las deps que esta fase instala (es su trabajo). Node ya cumple el floor.

**Missing dependencies with fallback:** ninguna.

## Validation Architecture

> `workflow.nyquist_validation: true` en `.planning/config.json` → sección incluida.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in de Node) + `node:assert/strict` `[VERIFIED: package.json scripts.test]` |
| Config file | none — runner built-in; `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TUI-01 | `kodo dashboard` monta el chrome (banner/placeholder/footer) en TTY | render (ink-testing-library) | `node --test test/dashboard-render.test.js` | ❌ Wave 0 |
| TUI-02 | non-TTY → exit 1 + mensaje canónico, sin crash | integration (spawnSync piped) | `node --test test/dashboard-non-tty.test.js` | ❌ Wave 0 |
| TUI-03 | `q` desmonta limpio (terminal intacta) | render (ink-testing-library) + manual UAT | `node --test test/dashboard-render.test.js` (q→exit) | ❌ Wave 0 (auto) / parcial manual |
| TUI-03 | Ctrl-C / SIGTERM dejan terminal intacta | manual UAT (no automatizable sin TTY real) | — (smoke manual: lanzar, Ctrl-C, verificar cursor/echo) | manual |
| TUI-04 | cero `picocolors` bajo `src/cli/dashboard/**` | unit (walker estático) | `node --test test/format-isolation.test.js` | ⚠️ existe — **extender** walker (D-13) |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js` (los tres tests de la fase, <5s)
- **Per wave merge:** `npm test` (suite completa — baseline v0.8 = 895 pass + 1 skip; debe seguir verde)
- **Phase gate:** Full suite green antes de `/gsd-verify-work` + UAT manual de TUI-03 (Ctrl-C/SIGTERM en TTY real).

### Wave 0 Gaps
- [ ] `test/dashboard-non-tty.test.js` — cubre TUI-02 (spawnSync piped → exit 1 + mensaje canónico). Patrón de `test/version-smoke.test.js`.
- [ ] `test/dashboard-render.test.js` — cubre TUI-01 (chrome D-01) y TUI-03 parcial (`q`→exit). Requiere `ink-testing-library` instalado.
- [ ] **Extender** `test/format-isolation.test.js` — añadir aserción "cero importadores de `picocolors` bajo `src/cli/dashboard/`" (D-13). El walker `listJsFiles` ya recorre todo `src/` (verificado líneas 59-71); añadir un `describe`/`it` que filtre por path bajo `src/cli/dashboard/`. NO modificar las aserciones existentes.
- [ ] Framework install: `npm install -D ink-testing-library@^4.0.0` — necesario para los tests de render.
- [ ] **UAT manual de TUI-03** (Ctrl-C/SIGTERM en TTY real): no automatizable sin PTY; documentar como smoke manual (mirror de la práctica HUMAN-UAT del proyecto). Escenarios: (a) `q` → cursor visible + echo + scrollback intacto; (b) Ctrl-C → ídem; (c) SIGTERM (`kill <pid>`) → ídem.

> Nota nyquist: el render real en un TTY y la restauración de terminal tras Ctrl-C/SIGTERM son el único gap genuinamente no-automatizable de esta fase (raw-mode handoff necesita TTY real). El resto (guard non-TTY, render del chrome, color-isolation) es 100% automatizable. Esto es menor que el UAT de Phase 37 (attach) pero merece un mini-checklist manual.

## Security Domain

> `security_enforcement` no está presente en `.planning/config.json` → tratado como habilitado. Phase 34 tiene superficie de seguridad mínima (no auth, no secrets, no input de red — el cuerpo es placeholder estático).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El TUI no autentica; lee localhost (en fases posteriores). Phase 34 no toca red. |
| V3 Session Management | no | No hay sesiones HTTP del lado TUI. |
| V4 Access Control | no | Cliente read-only local; sin control de acceso propio. |
| V5 Input Validation | parcial | El único input externo en Phase 34 es el flag `--url` (CLI, no red) y las teclas del TTY. Validación: `--url` se usa como baseUrl en fases posteriores; en Phase 34 solo se almacena. Las teclas se enrutan por `useInput` (sin eval). |
| V6 Cryptography | no | Sin cripto. |

### Known Threat Patterns for ink TUI / Node CLI (Phase 34 scope)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crash/DoS por non-TTY (raw-mode throw) | Denial of Service | Guard pre-render → exit 1 limpio (D-03). Cubierto por TUI-02. |
| ANSI escape injection desde contenido de tarea | Tampering / Spoofing | **No aplica en Phase 34** — el cuerpo es placeholder estático, no renderiza contenido de `/status`/`/comments`. (Aplica en Phases 35-38: sanitizar CSI de campos no confiables antes de `<Text>`.) |
| Leak de datos en scrollback (logging de payloads) | Information Disclosure | No aplica — Phase 34 no consume payloads. ink owns la pantalla; no `console.log` de datos. |

**Resumen de seguridad Phase 34:** superficie casi nula. El único "riesgo de seguridad" real de esta fase es de robustez/hygiene (refuse non-TTY sin crash), ya cubierto por TUI-02. La inyección ANSI desde contenido no confiable es un riesgo de Phases 35+ (cuando se renderizan datos reales), anotado aquí para que el planner de esas fases lo herede.

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, ejecutado 2026-05-26) — `ink@7.0.4` latest `engines.node >=22`; `ink@6.8.0` `engines.node >=20` peer `react >=19.0.0`; `react@19.2.6` latest; `ink-text-input@6.0.0` peer `ink>=5 react>=18`; `ink-testing-library@4.0.0`.
- `src/cli.js` (repo, leído) — patrón `program.command().description().option().action(async () => await import(...))`; análogos `status` (L250-270), `logs` (L273-298), `config` (L18-63).
- `src/config.js:62-66` (repo, leído) — `server.port: 9090` default; `cmux.binary` en L47-48.
- `test/format-isolation.test.js` (repo, leído) — walker `listJsFiles` recorre todo `src/` (L59-71); aserción `importers === ['src/cli/format.js']` (L98-115). Define el invariante a extender (D-13).
- `test/version-smoke.test.js` + `test/session-of-resolver.test.js` (repo, leídos) — patrón `spawnSync(process.execPath, [KODO_BIN, ...])` para tests de subcomando E2E (análogo del test de TUI-02).
- `package.json` (repo, leído) — `type: module`, deps `commander`+`picocolors`, `engines.node >=20`, `scripts.test = node --test`.
- `node --version` → v25.9.0 (cumple floor).

### Secondary (MEDIUM-HIGH confidence — milestone research, verificado contra codebase)
- `.planning/research/STACK.md` — versiones bloqueadas, peerDeps, tensiones de build-step/Node-floor (confidence HIGH, fuentes npm + GitHub).
- `.planning/research/ARCHITECTURE.md` — partición de capas, lifecycle del attach (Phase 37), regla de color routing.
- `.planning/research/PITFALLS.md` — 13 pitfalls; los 4 (non-TTY), 9 (dirty exit), 10 (color leak) aplican a Phase 34.
- `.planning/research/SUMMARY.md` — Phase A scope (L129-137), build order.

### Tertiary (CITED — vía milestone research, no re-fetched en esta sesión)
- ink README / Context7 `/vadimdemedes/ink` — `useApp().exit()`, `useInput`, `exitOnCtrlC` default `true`, `render()` instance `{unmount, waitUntilExit}`, `patchConsole` restaura consola nativa en unmount.
- ink#166 — patrón canónico del crash non-TTY + fallback `isRawModeSupported`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versiones re-verificadas contra npm en vivo hoy; coinciden con el milestone research.
- Architecture: HIGH — patrón de subcomando verificado en `src/cli.js`; lifecycle de ink citado del README; alcance de Phase 34 acotado a `index.js`+`App.js`.
- Pitfalls: HIGH — los 3 aplicables (non-TTY, dirty exit, color leak) tienen tests de verificación especificados y análogos en el repo.
- Validation: HIGH — framework `node:test` confirmado; tests mapeados a requirements con comandos concretos; UAT manual de TUI-03 identificado como único gap no-automatizable.

**Research date:** 2026-05-26
**Valid until:** 2026-06-25 (30 días — stack estable; ink@6.8.0 es cabeza de línea, sin churn esperado). Re-verificar `ink@6` latest antes de instalar si pasan >30 días.
