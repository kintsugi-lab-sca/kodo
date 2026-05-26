# Phase 34: Fundación — subcomando + ciclo de vida - Context

**Gathered:** 2026-05-26
**Status:** Ready for planning

<domain>
## Phase Boundary

El operador puede lanzar y salir del panel `kodo dashboard` de forma segura. Esta fase
establece el esqueleto mínimo (`render()`), los guards (refuse non-TTY antes de `render()`),
el ciclo de vida limpio (`q` / Ctrl-C / SIGTERM dejan la terminal intacta) y la invariante de
color-isolation — **antes** de cualquier lógica de negocio.

Cubre TUI-01, TUI-02, TUI-03, TUI-04 (Phase A del research).

**Fuera de esta fase (fases posteriores):** cliente HTTP + polling (Phase 35), tabla/selección/
filtros + header de contadores + indicador "live" (Phase 36), attach a cmux (Phase 37), overlays
de comentarios/logs (Phase 38). No se renderiza ningún dato real en Phase 34 — el cuerpo es un
placeholder.

</domain>

<decisions>
## Implementation Decisions

### Esqueleto mínimo (TUI-01)
- **D-01:** El render inicial muestra chrome estético desde el primer commit: una línea de
  título/banner `kodo dashboard` arriba, un placeholder central `starting…`, y un footer con el
  hint de teclas `q quit`. No es un marco vacío ni solo-título.
- **D-02:** El header con contadores por estado + indicador "live" (TUI-11) y el cuerpo con datos
  reales pertenecen a Phase 36 — Phase 34 solo deja el marco listo para que esas fases lo rellenen.
  El placeholder `starting…` es estático (no hay polling todavía).

### Refuse non-TTY (TUI-02)
- **D-03:** El guard se ejecuta **antes** de `render()` (vía `isRawModeSupported` / chequeo de TTY).
  Si stdout no es un TTY (pipe/CI), se imprime a **stderr** un mensaje accionable y se sale con
  **exit code 1**.
- **D-04:** Mensaje canónico (único para todos los casos non-TTY, sin diferenciar pipe vs raw-mode):
  `kodo dashboard requires an interactive terminal (TTY). Run it directly in your terminal, not in a pipe or CI.`
  Este string es estable — el test de spawn-piped lo asierta.

### Superficie CLI (TUI-01)
- **D-05:** Subcomando config-driven: por defecto construye la base URL desde
  `loadConfig().server.port` (default 9090, ver `src/config.js:62-66`). Se expone **un único flag
  de escape**: `--url <baseUrl>` para apuntar a otro host/puerto sin tocar config (útil para
  debugging). No hay `--port`/`--host` separados.
- **D-06:** Description del comando: `Live TUI dashboard of active kodo sessions`. Sin alias.
- **D-07:** Registro vía `commander` con lazy import del módulo dashboard, idéntico al patrón de
  `config`/`status`/`logs` en `src/cli.js` (la `.action` hace `await import('./cli/dashboard/index.js')`).

### Bindings de salida / ciclo de vida (TUI-03)
- **D-08:** `q` sale vía `useApp().exit()`.
- **D-09:** Ctrl-C usa el `exitOnCtrlC` default de ink (ink desmonta y restaura la terminal). No se
  sobrescribe.
- **D-10:** SIGTERM tiene **handler propio explícito** que invoca el mismo camino de cleanup
  (`exit()` / `unmount()`) para garantizar terminal intacta — no se confía en el default de Node.
- **D-11:** `Esc` **NO** sale en el root. Se reserva deliberadamente para "volver a la tabla" en los
  overlays de Phase 38 — fijar esta semántica desde ahora evita reeducar al operador y cambiar el
  binding más adelante.

### Color-isolation (TUI-04)
- **D-12:** Cero imports de `picocolors` bajo `src/cli/dashboard/**`. Todo el color del TUI proviene
  exclusivamente de `<Text color>` de ink. No pre-colorear strings con `createFormatter` antes de
  pasarlos a `<Text>` (doble-encoda ANSI y rompe el width math de ink).
- **D-13:** La verificación extiende el walker del `test/format-isolation.test.js` existente para
  cubrir el directorio TUI (criterio de éxito #4 del ROADMAP) — no se crea un test nuevo separado.

### Claude's Discretion
- Estructura exacta de archivos dentro de `src/cli/dashboard/` (el research sugiere
  `index.js`/`App.js`/`components/` pero la partición fina es criterio de implementación).
- Ubicación precisa del chequeo de TTY (en `index.js` `runDashboard` antes de `render()`).
- Detalles de markup del banner/footer (uso de `<Box>` con/ sin borde, padding) mientras respete D-01.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (build order, stack, pitfalls — verificado contra el codebase)
- `.planning/research/SUMMARY.md` — resumen ejecutivo; Phase A scope (líneas 129-137), invariantes de
  stack, regla de routing de colores, gaps a resolver (port desde config, walker de isolation).
- `.planning/research/STACK.md` — versiones bloqueadas y peerDeps (`ink@6.8.0`, `react@19.2`, sin build step).
- `.planning/research/ARCHITECTURE.md` — partición de 4 capas (`index.js`/`App.js`/`client.js`/`select.js`).
- `.planning/research/PITFALLS.md` — pitfalls 4 (non-TTY crash), 9 (dirty exit / raw-mode leak), 10
  (color-isolation leak) son los que esta fase debe evitar.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — TUI-01..TUI-04 (Fundación), stack decidido (Opción A), Out of Scope.
- `.planning/ROADMAP.md` §"Phase 34" — Goal, Success Criteria (4), Stack invariants no negociables.

### Codebase (verificado en scout)
- `src/cli.js` — patrón de registro de subcomandos con `commander` + lazy import (`config`/`status`/`logs`).
- `src/config.js:62-66` — `server.port: 9090` default; el dashboard lee de aquí salvo override `--url`.
- `test/format-isolation.test.js:98-129` — walker de color-isolation a extender (grep por specifier `'picocolors'`).
- `.planning/PROJECT.md` — constraints: no build step, no new endpoints, DI-for-testability, Node `>=20`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `commander` `program.command().description().option().action(async …)` con lazy import: el subcomando
  `dashboard` se añade siguiendo exactamente este patrón (ver `src/cli.js` líneas 19-282).
- `loadConfig()` (`src/config.js`): provee `server.port`; reusar en lugar de literal 9090.

### Established Patterns
- Color-isolation single-source: `picocolors` solo vía `createFormatter`; `test/format-isolation.test.js`
  ya escanea `src/`. El TUI no debe importar `picocolors` — ink trae su propio sistema de color.
- "No build step": `.js` plano, `React.createElement` (no JSX). El binario corre directo bajo `node`.
- Lazy imports en `.action`: mantiene el arranque del CLI ligero y aísla las deps de ink al subcomando.

### Integration Points
- `src/cli.js` — un nuevo `program.command('dashboard')` (~8 líneas, lazy import a
  `./cli/dashboard/index.js`).
- `src/cli/dashboard/index.js` (`runDashboard`) — propietario del proceso: resuelve base URL
  (config + `--url`), guard non-TTY, `render()`, handler SIGTERM, exit code.
- `test/format-isolation.test.js` — extender el walker para incluir `src/cli/dashboard/**`.

</code_context>

<specifics>
## Specific Ideas

- Esqueleto preferido (mockup aprobado por el usuario):
  ```
  ┌──────────────────────────────┐
   kodo dashboard

     starting…

   q quit
  └──────────────────────────────┘
  ```
- Mensaje non-TTY canónico (string exacto, asertado por test):
  `kodo dashboard requires an interactive terminal (TTY). Run it directly in your terminal, not in a pipe or CI.`

</specifics>

<deferred>
## Deferred Ideas

- Exit codes diferenciados por causa de non-TTY (1 piped vs 2 raw-mode) — descartado por
  over-engineering en v1; un único exit 1 es suficiente.
- Flags `--port`/`--host` separados — descartados a favor de un único `--url`.
- Alias del subcomando (`dash`, `ui`) — no en v1.
- Header con contadores + indicador "live" + cuerpo con datos reales — Phase 36 (TUI-11), no Phase 34.

</deferred>

---

*Phase: 34-fundacion-subcomando-ciclo-de-vida*
*Context gathered: 2026-05-26*
