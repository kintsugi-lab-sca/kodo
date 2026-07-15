# Phase 66: `kodo up` + Stop/Status unificados + Homebrew - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas con la opción recomendada del research; revisar antes de planificar)

<domain>
## Phase Boundary

Cerrar la **promesa central de Pilar 1** (shippable standalone): un solo comando `kodo up` arranca el daemon **desacoplado** (server + polling, vía el `kodo daemon run` de Phase 65) en background y engancha el dashboard como **visor**; al cerrar el dashboard el daemon **persiste** (modelo LOCKED); `kodo stop`/`status` gestionan el daemon completo; y kodo se distribuye por **Homebrew** (`brew install` + `brew services`). Construye enteramente sobre la fundación de Phase 65 (`src/daemon/lifecycle.js` `startDaemon`/`stopDaemon`/`statusDaemon` + `runDaemon` + `kodo daemon run` hidden).

**En alcance (UP-01, UP-02, UP-03, UP-05, DIST-01, DIST-02, DIST-03):** comando `kodo up` (ensure-daemon detached + health-wait + attach `runDashboard` + salida dejando el daemon vivo); idempotencia (attach-if-running, sin doble-spawn ni colisión de puerto); `kodo stop`/`status` unificados sobre el daemon (`--json`); fórmula Homebrew vía tap + `brew services` (launchd, plist invoca `kodo daemon run`); fallback foreground en Windows.

**Fuera de alcance:** `writeEnvVar` / masked input / setup mode / CFGF-03 → Phases 67-68; `kodo start` (server foreground) y `polling start/stop/status` legacy **se mantienen intactos** (no se reemplazan); hot-reload (CFGF-01).

> **⚠ GATE MANUAL OBLIGATORIO (spike):** el ciclo real de `brew services` en macOS (`brew install` → `brew services start` → `brew services list` → relogin → `brew services stop`) **NO es unit-testable** (Pitfalls 6/9: launchd foreground trap + KeepAlive throttle). El plan DEBE incluir un `checkpoint:human-verify` para un install real (validando el `opt_bin` absoluto: Apple Silicon `/opt/homebrew` vs Intel `/usr/local`) antes de dar la fase por cerrada.

</domain>

<decisions>
## Implementation Decisions

> Auto-seleccionadas en modo `--auto` con la opción recomendada por `SUMMARY.md`/`ARCHITECTURE.md`/`FEATURES.md`. Marcadas `[auto]`.

### Mecánica de `kodo up` (UP-01/02/03)
- **D-01 `[auto]`:** `kodo up` (nuevo comando en `src/cli.js`) hace: (1) **ensure-daemon** — `statusDaemon('kodo')` + sonda de puerto; si NO corre → `startDaemon('kodo', ['daemon','run'], deps)` (detached, reusa la fundación de Phase 65); si YA corre → attach directo (idempotencia D-02); (2) **health-wait** — poll `GET /health` (`server.js:439`) hasta ready o timeout bounded, never-throws; (3) **attach** — `runDashboard({ url })` (`dashboard/index.js:85`) como visor; (4) al salir el dashboard (`q`/Ctrl-C) → **return dejando el daemon vivo** (modelo persistente LOCKED — `kodo up` NO registra handlers que señalen al daemon; su proceso y el del daemon están en process groups distintos gracias a `detached:true`).
- **D-02 `[auto]` (UP-03):** Idempotencia: antes de spawnear, `statusDaemon('kodo')` (PID vivo) **+** sonda `node:net` de puerto-en-uso (ECONNREFUSED = libre) — si el daemon ya corre, **attach sin doble-spawn ni colisión de puerto**. Reusa el pre-flight `isPidAlive` del patrón de Phase 65.

### `kodo start` legacy intacto + comando nuevo
- **D-03 `[auto]` (UP-06 heredado):** `kodo up` es un **comando nuevo**; `kodo start` (server foreground, `server.pid`) queda **sin cambios**. Cero colisión: `up` usa `kodo.pid`, `start` usa `server.pid`.

### `kodo stop` / `kodo status` unificados (UP-05)
- **D-04 `[auto]`:** `kodo stop` y `kodo status` pasan a ser **daemon-first**: operan sobre el daemon (`kodo.pid`) vía `stopDaemon('kodo')` / `statusDaemon('kodo')` de Phase 65 (stop = SIGTERM→5s→SIGKILL; status determinista running/stopped **`--json`** byte-estable, molde `runPollingStatusCli` `polling.js:538`). Se preserva un **fallback legacy**: si no hay daemon pero existe `server.pid`, `stop` sigue tumbando el server legacy (back-compat de `kodo start`). `polling start/stop/status` standalone se mantienen. El planner decide la forma exacta del fallback (discreción).
  - *Descartado:* reemplazar/borrar el `kodo stop`/`status`/`polling` legacy (LOCKED: se mantienen).

### Distribución Homebrew (DIST-01/02)
- **D-05 `[auto]`:** Fórmula Homebrew en un **repo tap separado** (recomendado `kintsugi-lab/homebrew-kodo`; el operador confirma el owner — discreción), NO homebrew-core (notability gates). `depends_on "node"` (≥20, sin bundlear runtime); install vía `std_npm_args` → `libexec` + `bin.install_symlink`. Servicio con el **DSL `service do`** (Homebrew renderiza el plist — nunca escribir `.plist`/`def plist` a mano): `run [opt_bin/"kodo", "daemon", "run"]` + `keep_alive true` + `log_path`/`error_log_path`. **CRÍTICO (Pitfall 6):** el plist invoca `kodo daemon run` (foreground supervisado), **NUNCA `kodo up`** (que se auto-desvincula → crash-loop cada ~10s bajo launchd+KeepAlive). `opt_bin` absoluto resuelve Apple Silicon (`/opt/homebrew`) vs Intel (`/usr/local`) automáticamente. Secretos siguen en `~/.kodo/.env` — nunca en el plist `environment_variables`.

### Fallback Windows (DIST-03)
- **D-06 `[auto]`:** En `win32` (sin el patrón detach/launchd), `kodo up` degrada a **modo foreground documentado sin crashear** — corre el daemon en foreground (equivalente a `kodo daemon run`) con un aviso, misma guardia que el daemon de polling de Phase 65.

### Gate manual (spike)
- **D-07 `[auto]`:** El plan incluye un **`checkpoint:human-verify`** para el ciclo real de `brew services` en macOS (install → start → list → relogin → stop), no automatizable (Pitfalls 6/9). En la corrida `--auto` este checkpoint se **pausa para el operador** (NO se auto-aprueba como pasado — es una validación de despliegue real). El resto del código (`kodo up`/`stop`/`status`, la fórmula) se implementa y se testea autónomo.

### Claude's Discretion
- Owner exacto del tap (`kintsugi-lab/homebrew-kodo` recomendado).
- Forma exacta del fallback legacy de `kodo stop`/`status` (daemon-first + server.pid fallback vs solo daemon).
- Timeout del health-wait y detalles de la sonda de puerto (`node:net`).
- Si el health-wait usa `/health` o `/status`.
- Estructura exacta del repo tap y del `Formula/kodo.rb` (fichero fuera del árbol de kodo).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 66 (Goal, 5 Success Criteria, UP-01/02/03/05 + DIST-01/02/03, spike gate) + milestone v0.15.
- `.planning/REQUIREMENTS.md` §UP + §DIST + Out of Scope (mantener legacy, no gestor genérico).

### Research del milestone (leer — cubre esta fase)
- `.planning/research/SUMMARY.md` — Phase 66 = "kodo up + Stop/Status + Homebrew"; el brew-spike gate; avoids Pitfalls 2/5/6/7/8/9/10/17/19.
- `.planning/research/STACK.md` — Homebrew `service do` DSL, `depends_on node`, tap; `node:net` port probe (cero deps).
- `.planning/research/ARCHITECTURE.md` — `kodo up` = ensure-daemon → wait /health → runDashboard → exit; el dashboard se desengancha gratis (detached:true).
- `.planning/research/PITFALLS.md` — P6 (launchd foreground trap), P9 (PATH/opt_bin), P2 (unref/orphan), P5 (stale PID), P7/P8/P10 (launchd KeepAlive/env).

### Fundación de Phase 65 (base directa — leer)
- `.planning/milestones/v0.14-phases/...` N/A; usar el codebase vivo:
- `src/daemon/lifecycle.js` — `startDaemon(name, argv, deps)` :86, `stopDaemon(name, deps)` :163, `statusDaemon(name, deps)` :207 (la API que `kodo up`/`stop`/`status` consumen).
- `src/daemon/run.js` — `runDaemon(deps)` :60 (lo que `kodo daemon run` ejecuta; `kodo up` lo lanza detached).
- `.planning/phases/65-daemon-lifecycle-foundation/65-SUMMARY` (varios) + `65-VERIFICATION.md` — qué quedó construido.

### Activos de código a reusar (verificados en scout 2026-07-01)
- `src/cli/dashboard/index.js:85` — `runDashboard(deps)` (el visor; `kodo up` lo llama tras health-wait; `kodo dashboard` cli.js:364 es el precedente de invocación).
- `src/cli/polling.js:492,538` — `runPollingStopCli`/`runPollingStatusCli` (molde de stop SIGTERM→5s→SIGKILL y status `--json` determinista para el unificado).
- `src/server.js:439` `/health`, `:445` `/status` (readiness probe del health-wait); `:361` startServer(managed) de Phase 65.
- `src/cli.js` — `stop` :79 (legacy server), `status` :305 (legacy), `dashboard` :357, `polling` :443, `daemon` group :506 (Phase 65, hidden `run`). `kodo up` se registra aquí; `stop`/`status` se vuelven daemon-first.
- `src/gsd/lock.js` — `isPidAlive` (pre-flight de idempotencia).

### Convenciones
- `.planning/codebase/CONVENTIONS.md`, `ARCHITECTURE.md` — never-throws, DI, "una fontanería, varios consumidores", Windows guard, argv absoluto en spawn.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `startDaemon`/`stopDaemon`/`statusDaemon` (`src/daemon/lifecycle.js`, Phase 65): toda la fontanería de `kodo up`/`stop`/`status` — no se reimplementa, se orquesta.
- `runDaemon` (`src/daemon/run.js`): lo que el daemon detached ejecuta; `kodo up` lo lanza vía `startDaemon('kodo', ['daemon','run'])`.
- `runDashboard` (`dashboard/index.js:85`): el visor, reusado tal cual tras el health-wait.
- `runPollingStopCli`/`runPollingStatusCli` (`polling.js`): moldes del stop/status `--json` determinista.
- `/health` + `/status` (`server.js:439/445`): readiness del health-wait.

### Established Patterns
- Detach + unref + PID + Windows guard (Phase 65/polling): `kodo up` lo hereda vía `startDaemon`.
- `--json` byte-determinista para status scriptable.
- never-throws/fail-open; el dashboard es un cliente HTTP puro sin estado propio → desenganche gratis.

### Integration Points
- `kodo up`/`stop`/`status` nuevos/modificados en `src/cli.js` sobre `src/daemon/lifecycle.js`.
- El plist de `brew services` invoca `kodo daemon run` (hidden, Phase 65) — NUNCA `kodo up`.
- Sonda `node:net` de puerto-en-uso: pieza nueva de bajo nivel para la idempotencia.
- La fórmula `Formula/kodo.rb` vive en un repo tap SEPARADO (fuera del árbol de kodo).

</code_context>

<specifics>
## Specific Ideas

- Esta fase cierra Pilar 1: tras ella, `brew install kodo && kodo up` (o `brew services start kodo`) deja kodo funcionando — la promesa central del milestone.
- El pitfall load-bearing es el **launchd foreground trap** (D-05): el plist DEBE usar `kodo daemon run`, nunca `kodo up`. Es lo único que puede hacer irreversible un `brew install` para un usuario nuevo.
- El daemon persistente (dashboard = visor) sale "gratis" del `detached:true` de Phase 65 — `kodo up` solo debe NO registrar handlers que maten al daemon.
- Divergencia consciente de `docker compose up`: cerrar el dashboard NO mata el daemon (a diferencia del Ctrl-C de compose foreground). Documentarlo para no sorprender la memoria muscular.

</specifics>

<deferred>
## Deferred Ideas

- `writeEnvVar` + masked API key input + setup mode + CFGF-03 (provider/base_url/workspace) → Phases 67-68.
- Publicación en homebrew-core (vs tap) → futuro (notability gates).
- Deprecar `kodo start`/`polling start`/`server.pid` legacy → futuro; en v0.15 intactos.
- Hot-reload de config (CFGF-01) → v2.
- Semántica compose-style (Ctrl-C mata daemon) → rechazada (LOCKED).

None — la discusión (auto-resuelta) se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 66-kodo-up-stop-status-unificados-homebrew*
*Context gathered: 2026-07-01*
