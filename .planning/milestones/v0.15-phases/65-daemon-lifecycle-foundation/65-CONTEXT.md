# Phase 65: Daemon Lifecycle Foundation - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas con la opción recomendada del research; revisar antes de planificar)

<domain>
## Phase Boundary

Sentar la **base de bajo nivel** del milestone v0.15: un daemon que puede correr como **proceso foreground supervisable** (`kodo daemon run`), sobre el que Phase 66 construirá `kodo up`. Esta fase (1) refactoriza `startServer` a un **modo managed** (sin `process.exit`, sin escribir su propio PID, con handler `'error'` para EADDRINUSE), (2) centraliza el ciclo de vida del daemon en un nuevo directorio `src/daemon/` generalizando los primitivos ya probados de `src/cli/polling.js` / `polling-daemon.js`, y (3) escribe un único PID file `~/.kodo/kodo.pid` distinto del `server.pid` legacy. **Es la integración de mayor riesgo del milestone** y por eso va primera: el refactor managed también desbloquea el setup mode de Phase 68 (evita el `process.exit(1)` que rompe el first-run chicken-and-egg).

**En alcance (UP-04, UP-06):** `src/daemon/lifecycle.js` + `src/daemon/run.js` + comando `kodo daemon run` (foreground funnel único); refactor `startServer({ managed })`; PID unificado `~/.kodo/kodo.pid` (módulo PID parametrizado por `name`); apagado limpio ante SIGTERM; arranque condicional de polling.

**Fuera de alcance:** `kodo up` / attach del dashboard / `stop`/`status` unificados → Phase 66; Homebrew/launchd → Phase 66; `writeEnvVar` / masked input / setup mode → Phases 67-68. Esta fase NO expone `kodo up` todavía — solo el `kodo daemon run` interno que Phase 66 orquestará.

> **Research/Spike:** patrones bien documentados (los primitivos de `polling.js`/`polling-daemon.js` son la fuente) — el research de milestone ya cubre esta fase; `/gsd-plan-phase` puede omitir research-phase. Sin gate manual en esta fase (los gates son Phase 66 brew-spike y Phase 68 clean-machine UAT).

</domain>

<decisions>
## Implementation Decisions

> Auto-seleccionadas en modo `--auto` con la opción recomendada por `SUMMARY.md`/`ARCHITECTURE.md`. Marcadas `[auto]`.

### Composición del daemon (un proceso, no supervisión de hijos)
- **D-01 `[auto]`:** `kodo daemon run` compone `startServer(managed)` **+** `startPolling` condicional en **UN** proceso con **UN** PID file. NO spawnea server y polling como hijos PID-trackeados separados (eso recrearía un gestor de procesos genérico — fuera de scope LOCKED — y rompería `brew services` por doble-fork). Razón: launchd/`brew services` deben supervisar un único proceso foreground.
  - *Descartado:* supervisión de hijos separados; reusar el `server.pid` legacy para el daemon.

### Módulos nuevos `src/daemon/`
- **D-02 `[auto]`:** Dos módulos nuevos: **`src/daemon/lifecycle.js`** (fontanería genérica start/stop/status del daemon, templada línea a línea sobre `src/cli/polling.js`: spawn detached + `unref` :286-303, pre-flight `isPidAlive` :261, bounded wait, guardia Windows) y **`src/daemon/run.js`** (el **único** foreground funnel: compone server+polling, escribe `kodo.pid`, cleanup SIGTERM, bloquea forever con `await new Promise(() => {})`). Comando nuevo **`kodo daemon run`** (subcomando interno, candidato a `hidden` en commander) que Phase 66 invoca en modo detach y que launchd invoca directo. Un foreground entrypoint, dos llamadores — espejo exacto del self-spawn `kodo polling start --no-daemon` (`polling.js:286-302`).

### Refactor `startServer` a modo managed (la integración de mayor riesgo — UP-04)
- **D-03 `[auto]`:** Añadir opción `startServer({ managed })` a `src/server.js`. Bajo `managed:true`: (a) **NO** `process.exit(1)` en misconfig (`server.js:407`) — devolver/lanzar un error discriminado que `run.js` maneja (habilita el setup mode sin crash, Pitfall 12); (b) **NO** escribir su propio `server.pid` (`server.js:581`) — el PID lo dueña el daemon (`kodo.pid`); (c) añadir un handler **`.on('error')`** al `server.listen` (`server.js:576`, hoy sin handler → EADDRINUSE es excepción no capturada, Pitfall 4) que reporta EADDRINUSE limpio. El path legacy `kodo start` (managed:false, **default**) queda **byte-idéntico**: sigue haciendo `process.exit`, sigue escribiendo `server.pid`. Cambio quirúrgico gateado por la opción — cero regresión observable en `kodo start` (UP-06).
  - *Descartado:* refactor destructivo del path legacy; mover el PID del server sin gate (rompería `kodo start`/`kodo stop` legacy).

### PID unificado `~/.kodo/kodo.pid` (UP-04)
- **D-04 `[auto]`:** Módulo PID **parametrizado por `name`** generalizado de `polling-daemon.js` (escritura atómica temp+rename + **`chmod 0600` pre-rename** + `isPidAlive` stale-check de `src/gsd/lock.js`). El daemon usa `~/.kodo/kodo.pid`, **distinto** del `server.pid` legacy (intacto) y del PID del polling daemon standalone. Es el prerequisito de la idempotencia de `kodo up` (Phase 66).

### Apagado limpio (UP-04)
- **D-05 `[auto]`:** `run.js` registra el handler SIGTERM que cierra el server (`stopServer`-equivalente in-process), detiene el polling, borra `kodo.pid` y sale. Bajo managed **el server no se auto-mata** — el proceso foreground `run.js` es el único dueño del exit. Molde: el cleanup + `unlinkSync(PID)` de `server.js:614` y el shutdown de polling.

### Arranque condicional de polling (open question resuelta)
- **D-06 `[auto]`:** El daemon arranca `startPolling` **solo cuando el provider usa polling** (GitHub); Plane usa webhook (server). Helper `providerUsesPolling(config)`. Razón: evita un polling loop inútil bajo Plane. (Resuelve la open question del roadmapper.) El planner fija la firma exacta del helper y dónde vive (discreción).

### Claude's Discretion
- Firmas/ubicación exactas de `lifecycle.js` / `run.js` / el módulo PID parametrizado y de `providerUsesPolling`.
- Forma exacta del error discriminado que devuelve `startServer(managed)` en misconfig/EADDRINUSE.
- Si `kodo daemon run` se marca `hidden` en commander (recomendado: sí — es un entrypoint interno, no de uso directo del operador).
- Cómo `startServer(managed)` devuelve el handle closeable a `run.js`.
- Si el módulo PID vive en `src/daemon/` o se extrae de `polling-daemon.js` in-place y ambos lo importan.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 65 (Goal, 4 Success Criteria, UP-04/UP-06) + contexto del milestone v0.15.
- `.planning/REQUIREMENTS.md` §UP (UP-04, UP-06) + Out of Scope (no gestor de procesos genérico, no reemplazar legacy).

### Research del milestone (leer — cubre esta fase)
- `.planning/research/SUMMARY.md` — síntesis; Phase 65 = "Daemon Lifecycle Foundation", avoids Pitfalls 1/3/4/5/18, orden risk-graded.
- `.planning/research/ARCHITECTURE.md` — mapa de integración (polling.js → daemon, file:line), 4 patrones, `startServer` managed como mayor riesgo.
- `.planning/research/PITFALLS.md` — P3/P4 (startServer naive: self-PID, exit, listen sin handler), P12 (chicken-and-egg del first-run), P5 (stale PID), P18.
- `.planning/research/STACK.md` — cero deps nuevas; `node:child_process` spawn detached; PID trio de polling-daemon.js.

### Activos de código a reusar / refactorizar (verificados en scout 2026-07-01)
- `src/cli/polling.js` — el patrón daemon canónico a generalizar: `spawn(..., { detached:true })` :286, `child.unref()` :303, pre-flight `isPidAlive(existing.pid)` :261, `runForegroundPolling` (path `--no-daemon`) :233, guardia Windows :238, bounded wait :315-319.
- `src/cli/polling-daemon.js` — escritura atómica de PID + `chmod 0600` pre-rename (el molde correcto para D-04; `writeFileAtomic` de config.js NO hace chmod).
- `src/server.js` — `startServer(opts)` :361 (target del refactor D-03), `provider.init()` :367, `process.exit(1)` :407 (a gatear bajo managed), `server.listen(port, cb)` :576 (añadir `.on('error')`), `writeFileSync(PID_PATH, ...)` :581 (a gatear), `stopServer` :626, `PID_PATH = server.pid` :13 (legacy, intacto), cleanup `unlinkSync(PID_PATH)` :614.
- `src/config.js` — `KODO_DIR` :6, `writeFileAtomic` :99 (referencia; para PID usar el patrón con chmod de polling-daemon.js), `ensureDir` :69.
- `src/gsd/lock.js` — `isPidAlive` (reusar para el stale-check del PID).
- `src/cli.js` — wiring de comandos (`start` :67, `stop` :79, grupo `polling` :443) donde se registra `kodo daemon run`.

### Convenciones del proyecto
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md` — provider-agnostic, never-throws, DI, "una fontanería, varios consumidores".

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `polling.js` daemon lifecycle (detached spawn + unref + PID + bounded wait + Windows guard + SIGTERM→5s→SIGKILL stop): la fuente a generalizar en `src/daemon/lifecycle.js`.
- `polling-daemon.js` atomic PID write + chmod 0600 pre-rename: el molde correcto para `kodo.pid` (D-04).
- `startServer`/`stopServer` (`server.js`): se refactoriza `startServer` con opción `managed` (D-03); `kodo start` legacy usa el default sin cambios.
- `isPidAlive` (`src/gsd/lock.js`): stale-PID check reusado.
- `runForegroundPolling` (`polling.js:233`): precedente del "foreground blocking mode" que `run.js` replica para el daemon compuesto.

### Established Patterns
- Doble modo detach/foreground ya existe en polling (`--no-daemon`) — se generaliza, no se inventa.
- Escritura de PID atómica + chmod 0600 (polling-daemon.js) vs plana (server.js:581) — usar la primera.
- never-throws / fail-open; guardia Windows explícita; argv absoluto en spawn (mitigación EOP).

### Integration Points
- `src/daemon/run.js` compone `startServer(managed)` + `startPolling` condicional → `kodo.pid` → block-forever.
- `src/daemon/lifecycle.js` es consumido por Phase 66 (`kodo up`/`stop`/`status`) — diseñar su API pensando en ese consumidor.
- `kodo daemon run` se registra en `src/cli.js` (hidden).
- `startServer({managed})` es el único cambio en `server.js`; `kodo start` prueba la no-regresión (UP-06).

</code_context>

<specifics>
## Specific Ideas

- Esta fase es "pura fundación": código nuevo + un refactor gateado, sin comportamiento visible nuevo para el operador (el operador aún no usa `kodo daemon run` directo). El valor es habilitar Phase 66 sobre base estable.
- El `startServer(managed)` refactor es explícitamente la pieza de mayor riesgo del milestone — el research la puso primera a propósito. La no-regresión de `kodo start` (UP-06) es el criterio de seguridad load-bearing.
- El PID `kodo.pid` separado del `server.pid` evita colisiones con el `kodo start`/`kodo stop` legacy y con el polling daemon standalone.

</specifics>

<deferred>
## Deferred Ideas

- `kodo up` (detach + attach dashboard, idempotencia) + `stop`/`status` unificados → Phase 66.
- Homebrew formula + `brew services`/launchd (invoca `kodo daemon run`) → Phase 66.
- `writeEnvVar` + masked input + setup mode + CFGF-03 → Phases 67-68.
- Deprecar `polling start` / `kodo start` / `server.pid` legacy → futuro; en v0.15 se mantienen intactos.
- Hot-reload (CFGF-01) → v2.

None — la discusión (auto-resuelta) se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 65-daemon-lifecycle-foundation*
*Context gathered: 2026-07-01*
