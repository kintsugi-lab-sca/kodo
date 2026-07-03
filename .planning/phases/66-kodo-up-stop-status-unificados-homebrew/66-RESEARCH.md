# Phase 66: `kodo up` + Stop/Status unificados + Homebrew - Research

**Researched:** 2026-07-02
**Domain:** Node.js CLI daemon orchestration (`kodo up` = ensure-daemon → health-wait → attach dashboard) + Homebrew `service do` distribution (launchd) + unified `stop`/`status` over the Phase 65 `src/daemon/` foundation
**Confidence:** HIGH (código real verificado file:line contra el árbol vivo; Homebrew DSL verificado contra docs oficiales); MEDIUM en detalles empíricos de launchd bajo `brew services` (no unit-testable → spike obligatorio)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `kodo up` (nuevo comando en `src/cli.js`): (1) **ensure-daemon** — `statusDaemon('kodo')` + sonda de puerto; si NO corre → `startDaemon('kodo', ['daemon','run'], deps)` (detached, Phase 65); si YA corre → attach directo; (2) **health-wait** — poll `GET /health` (`server.js:439`) hasta ready o timeout bounded, never-throws; (3) **attach** — `runDashboard({ url })` (`dashboard/index.js:85`) como visor; (4) al salir el dashboard → **return dejando el daemon vivo** (modelo persistente LOCKED — `kodo up` NO registra handlers que señalen al daemon; process groups distintos por `detached:true`).
- **D-02 (UP-03):** Idempotencia: antes de spawnear, `statusDaemon('kodo')` (PID vivo) **+** sonda `node:net` de puerto-en-uso (ECONNREFUSED = libre) → attach sin doble-spawn ni colisión de puerto. Reusa `isPidAlive` pre-flight de Phase 65.
- **D-03 (UP-06 heredado):** `kodo up` es comando **nuevo**; `kodo start` (server foreground, `server.pid`) queda **sin cambios**. `up` usa `kodo.pid`, `start` usa `server.pid`.
- **D-04 (UP-05):** `kodo stop`/`kodo status` pasan a **daemon-first** vía `stopDaemon('kodo')`/`statusDaemon('kodo')` (stop = SIGTERM→5s→SIGKILL; status determinista running/stopped **`--json`** byte-estable, molde `runPollingStatusCli` `polling.js:538`). **Fallback legacy preservado:** si no hay daemon pero existe `server.pid`, `stop` sigue tumbando el server legacy. `polling start/stop/status` standalone intactos. Forma exacta del fallback = discreción del planner.
- **D-05 (DIST-01/02):** Fórmula Homebrew en **repo tap separado** (recomendado `kintsugi-lab/homebrew-kodo`; owner = discreción), NO homebrew-core. `depends_on "node"` (≥20). Install vía `std_npm_args` → `libexec` + `bin.install_symlink`. Servicio con DSL `service do` (Homebrew renderiza el plist — nunca `.plist`/`def plist` a mano): `run [opt_bin/"kodo", "daemon", "run"]` + `keep_alive true` + `log_path`/`error_log_path`. **CRÍTICO (Pitfall 6):** el plist invoca `kodo daemon run`, **NUNCA `kodo up`** (self-detach → crash-loop ~10s bajo launchd+KeepAlive). `opt_bin` resuelve Apple Silicon (`/opt/homebrew`) vs Intel (`/usr/local`). Secretos siguen en `~/.kodo/.env` — nunca en `environment_variables`.
- **D-06 (DIST-03):** En `win32`, `kodo up` degrada a **foreground documentado sin crashear** (equivalente a `kodo daemon run`) con aviso, misma guardia que el daemon de polling.
- **D-07:** Plan incluye `checkpoint:human-verify` para el ciclo real de `brew services` en macOS (install → start → list → relogin → stop), no automatizable. En `--auto` se **pausa para el operador** (NO se auto-aprueba).

### Claude's Discretion
- Owner exacto del tap (`kintsugi-lab/homebrew-kodo` recomendado).
- Forma exacta del fallback legacy de `kodo stop`/`status`.
- Timeout del health-wait y detalles de la sonda de puerto (`node:net`).
- Si el health-wait usa `/health` o `/status`.
- Estructura exacta del repo tap y del `Formula/kodo.rb`.

### Deferred Ideas (OUT OF SCOPE)
- `writeEnvVar` / masked input / setup mode / CFGF-03 → Phases 67-68.
- Publicación en homebrew-core (vs tap) → futuro.
- Deprecar `kodo start`/`polling start`/`server.pid` legacy → futuro; en v0.15 intactos.
- Hot-reload de config (CFGF-01) → v2.
- Semántica compose-style (Ctrl-C mata daemon) → rechazada (LOCKED).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UP-01 | `kodo up` arranca el daemon compuesto en background + abre dashboard como visor | §Pattern 1 (orchestration) — `startDaemon('kodo',['daemon','run'])` (`lifecycle.js:86`) + health-wait `/health` (`server.js:439`) + `runDashboard` (`dashboard/index.js:85`) |
| UP-02 | Daemon persistente: cerrar dashboard NO mata el daemon | §Pattern 3 — `detached:true` (`lifecycle.js:125`) aísla el process group; `kodo up` NO registra handlers que señalen al daemon |
| UP-03 | `kodo up` idempotente: attach-if-running, sin doble-spawn ni colisión de puerto | §Pattern 2 — `statusDaemon('kodo')` (`lifecycle.js:207`) + sonda `node:net` (ECONNREFUSED=libre); doble-guarda con el pre-flight interno de `startDaemon` (`lifecycle.js:111-118`) |
| UP-05 | `kodo stop`/`status` daemon-first + `--json` scriptable | §Unified stop/status — `stopDaemon`/`statusDaemon('kodo')` (`lifecycle.js:163/207`) + molde `--json` (`polling.js:544-553`) + fallback `server.pid` |
| DIST-01 | `brew install kodo` (tap, `depends_on node` ≥20, sin bundlear runtime) | §Homebrew formula — `std_npm_args`→`libexec` + `bin.install_symlink` (verificado docs.brew.sh) |
| DIST-02 | `brew services start kodo` (launchd, plist → `kodo daemon run`, restart on crash) | §Homebrew formula — `service do { run [opt_bin/"kodo","daemon","run"]; keep_alive true }` (verificado Homebrew::Service API) |
| DIST-03 | Windows: `kodo up` degrada a foreground sin crashear | §Windows fallback — guardia `process.platform==='win32'` espejo de `polling.js:237-240` + `lifecycle.js:102-108` |
</phase_requirements>

## Summary

Phase 66 es **orquestación pura sobre la fundación ya enviada de Phase 65**, más **un artefacto de packaging externo (la fórmula Ruby)**. Cero código de daemon nuevo: `startDaemon`/`stopDaemon`/`statusDaemon` (`src/daemon/lifecycle.js:86/163/207`) y `runDaemon` (`src/daemon/run.js:60`) ya existen, testeados con DI, name-parametrizados a `'kodo'` → `~/.kodo/kodo.pid`. `kodo up` **compone** estas piezas; NO reimplementa spawn/PID/kill. La única primitiva genuinamente nueva es la **sonda `node:net` de puerto** (~10 líneas, cero deps) para la idempotencia (UP-03), y el **health-wait loop** que reusa el patrón never-throws de `fetchStatus` (`client.js:49-60`) contra `/health` (`server.js:439`).

⚠️ **Divergencia crítica research↔código enviado:** `STACK.md` (research de milestone, pre-Phase-65) propone `run [opt_bin/"kodo", "up", "--foreground"]` y un PID `~/.kodo/kodod.pid`. **Eso está OBSOLETO.** Phase 65 envió el entrypoint foreground como `kodo daemon run` (comando **hidden** en `cli.js:508-518`) y el PID unificado como `~/.kodo/kodo.pid` (name `'kodo'`). `CONTEXT.md` D-05 y `ARCHITECTURE.md:71` ya reflejan la realidad enviada. **La fórmula DEBE usar `run [opt_bin/"kodo", "daemon", "run"]`** — no `--foreground`, no `kodod.pid`. Este documento pinta contra el código vivo, no contra el research obsoleto.

La zona de mayor incertidumbre es **launchd bajo `brew services`**: el DSL `service do` está verificado contra docs oficiales, pero el comportamiento real (PATH mínimo, `opt_bin` en Apple Silicon vs Intel, RunAtLoad tras relogin, crash-restart) **NO es unit-testable** → `checkpoint:human-verify` obligatorio (D-07).

**Primary recommendation:** Escribe `src/cli/up.js` (`runUp(deps)`) que orqueste `statusDaemon('kodo')` + sonda de puerto → (attach | `startDaemon('kodo',['daemon','run'])`) → `waitForHealth()` never-throws → `runDashboard({url})` → return. Vuelve `stop`/`status` de `cli.js` daemon-first sobre `lifecycle.js` con fallback `server.pid`. Publica `Formula/kodo.rb` en un tap con `run [opt_bin/"kodo","daemon","run"]`. Testea todo con DI/fakes salvo el ciclo `brew services`, que va tras `checkpoint:human-verify`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Orquestación `kodo up` (ensure→wait→attach→exit) | CLI (`src/cli/up.js` nuevo) | — | Compone lifecycle + dashboard; sin lógica de negocio propia |
| Spawn detached del daemon | Daemon foundation (`lifecycle.js:86` `startDaemon`) | — | Ya enviado Phase 65; `kodo up` es un consumidor |
| Entrypoint foreground supervisado | Daemon foundation (`run.js:60` `runDaemon` vía `kodo daemon run`) | launchd/brew (supervisor externo) | Único funnel foreground; lo invocan tanto `up` (detached) como launchd (directo) |
| Idempotencia (attach-if-running) | CLI (`up.js`) | `node:net` port probe (nuevo built-in) + `statusDaemon` | Decisión de proceso: PID-alive primario, puerto secundario |
| Health readiness gate | CLI (`up.js` health-wait) | HTTP server (`/health` `server.js:439`) | El puerto liga después del PID; hay que sondear HTTP |
| `stop`/`status` unificados | CLI (`cli.js` handlers) | Daemon foundation (`stopDaemon`/`statusDaemon`) + legacy `server.pid` | Daemon-first, fallback legacy |
| Distribución/supervisión OS | Homebrew formula + launchd (tap externo) | `kodo daemon run` | El binario NO se auto-supervisa; launchd es el supervisor |
| Windows fallback | CLI (`up.js` guard) | — | Sin launchd/detach; foreground documentado |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:net` (built-in) | Node ≥20 | Sonda de puerto-en-uso para idempotencia (UP-03) | [VERIFIED: STACK.md + docs] La única primitiva que falta en `polling.js`. `net.connect(port)`→`ECONNREFUSED`=libre; connect OK=ocupado. Cero deps. |
| `node:child_process` `spawn`+`detached`+`unref` (built-in) | Node ≥20 | Self-detach del daemon | [VERIFIED: código] Ya envuelto en `startDaemon` (`lifecycle.js:121-131`). `kodo up` no lo toca directo. |
| `globalThis.fetch` (built-in) | Node ≥20 | Health-wait poll `GET /health` | [VERIFIED: código] Mismo patrón never-throws que `fetchStatus` (`client.js:49-60`). |
| PID trio `writePidFile`/`readPidFile`/`removePidFile` | — | Guard single-instance (name `'kodo'`) | [VERIFIED: código] `polling-daemon.js:94/119/141`, name param default `'polling'`; Phase 65 pasa `'kodo'`. |
| `isPidAlive` | — | Liveness (`process.kill(pid,0)`, ESRCH=muerto) | [VERIFIED: código] `gsd/lock.js:67`. |
| Homebrew formula (Ruby DSL) | Homebrew ≥4.x | `brew install` + `brew services` | [VERIFIED: docs.brew.sh] `service do` renderiza el plist; nunca XML a mano. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:http` | Node ≥20 | Alternativa a `fetch` para health-wait si se quiere control fino de socket timeout | Solo si `fetch`+`AbortController` resulta insuficiente; `fetch` es suficiente (precedente `client.js`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `node:net` port probe | `detect-port` / `get-port` (npm) | [CITED: STACK.md:158] Nunca — ~10 líneas de `net.connect` eliminan la dep |
| `service do` DSL | `def plist` XML a mano | [VERIFIED: docs.brew.sh] `def plist` es legacy/deprecado; frágil entre `/usr/local` y `/opt/homebrew` |
| Self-detach para `up` | `pm2`/`forever`/`daemonize` | [CITED: STACK.md:159] Nunca — supervisores externos duplican launchd + el patrón PID existente |
| `depends_on "node"` | Bundlear Node (`node --sea`, `pkg`) | [CITED: STACK.md:154] Solo si hay que shipear a máquinas sin Node; +decenas de MB, overkill para audiencia brew |

**Installation:**
```bash
# Runtime deps kodo: NINGUNA nueva. package.json se queda: commander ^13, ink ^6.8, react ^19.2, picocolors ^1.1
# Distribución (usuarios finales):
brew tap kintsugi-lab/kodo
brew install kodo          # depends_on node ≥20
brew services start kodo   # launchd supervisa `kodo daemon run`
# Sin brew:
kodo up                    # self-detacha el daemon + engancha el dashboard
```

**Version verification:**
```
$ node -e "console.log(process.version)"   → v20+ (engines floor confirmado en package.json:22-24)
# Sin instalaciones npm nuevas en esta fase (cero deps — invariante LOCKED del milestone).
```

## Package Legitimacy Audit

**No se instalan paquetes npm nuevos en esta fase** (invariante LOCKED «cero nuevas dependencias npm»). Todas las primitivas son built-ins de Node (`node:net`, `node:child_process`, `node:http`, `globalThis.fetch`) o código ya enviado. La fórmula Ruby (`Formula/kodo.rb`) NO es una dependencia npm — es metadata de packaging que vive en un repo tap SEPARADO, fuera del árbol de kodo.

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| *(ninguno)* | — | N/A | Sin instalaciones — auditoría de legitimidad no aplica |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                    ┌─────────────────────────────────────────────────────────┐
  operador          │  CLI ENTRYPOINTS (src/cli.js)                            │
    │               │  ┌──────────┐ ┌───────────────┐ ┌────────┐ ┌──────────┐ │
    ├── kodo up ───►│  │ up.js    │ │ daemon run    │ │ stop / │ │ start    │ │
    │               │  │ (NEW:    │ │ (hidden,      │ │ status │ │ (LEGACY  │ │
    │               │  │ detach   │ │  Phase 65)    │ │(daemon-│ │  fg srv, │ │
    │               │  │ +attach) │ │               │ │ first) │ │ UNCHANGED)│ │
    │               │  └────┬─────┘ └───────┬───────┘ └───┬────┘ └────┬─────┘ │
    │               └───────┼───────────────┼─────────────┼───────────┼───────┘
    │                       │ spawn detached │             │           │
    │                       │ [node,kodo,    │             │           │
    │                       │  daemon,run]   ▼             │           ▼
    │                       │        ┌──────────────────┐  │    ┌─────────────┐
    │                       └───────►│ runDaemon()      │◄─┼────│ launchd /   │
    │                                │ run.js:60        │  │    │ brew services│
    │                                │ (THE foreground  │  │    │ run [opt_bin/│
    │                                │  funnel)         │  │    │ kodo,daemon, │
    │                                │ startServer +    │  │    │ run]         │
    │                                │ startPolling(cond)│ │    └─────────────┘
    │                                │ writePidFile('kodo')  │
    │                                │ block forever    │  │
    │                                └────────┬─────────┘  │
    │                                         │ serves     │ SIGTERM→5s→SIGKILL
    │  health-wait: GET /health ◄─────────────┤ HTTP :9090 │ (stopDaemon('kodo'))
    │  (fetch, never-throws)                   │ /health :439                  │
    │                                          │ /status :445                  │
    ▼                                          ▼                               │
  ┌───────────────────────────────┐    ┌──────────────────────┐              │
  │ runDashboard({url})           │    │ node:net port probe  │              │
  │ dashboard/index.js:85         │    │ net.connect(port)    │              │
  │ pure /status viewer,          │    │ ECONNREFUSED = libre │◄─ idempotency│
  │ owns nothing, detach-safe     │    │ (attach vs spawn)    │   pre-flight │
  └───────────────────────────────┘    └──────────────────────┘              │
       │ on quit (q/Ctrl-C)                                                    │
       └──► up EXITS. Daemon SURVIVES (separate process group, detached:true) ─┘
```

Trazado del caso primario (`kodo up`, daemon frío): operador → `up.js` → sonda puerto (libre) + `statusDaemon` (idle) → `startDaemon('kodo',['daemon','run'])` detached → `runDaemon` bloquea sirviendo `/health` → `up.js` health-wait ve 200 → `runDashboard({url})` → operador pulsa `q` → `up` retorna, el daemon sigue vivo en su propio process group.

### Recommended Project Structure
```
src/
├── cli/
│   ├── up.js          # NEW: runUp(deps) — ensure-daemon → health-wait → attach → exit
│   └── dashboard/
│       ├── index.js   # runDashboard :85 (reusado tal cual — visor)
│       └── client.js  # fetchStatus :49 (molde del health-wait never-throws)
├── daemon/
│   ├── lifecycle.js   # startDaemon :86 / stopDaemon :163 / statusDaemon :207 (Phase 65)
│   └── run.js         # runDaemon :60 (lo que `kodo daemon run` ejecuta)
└── cli.js             # registra `up`; vuelve `stop`/`status` daemon-first

# FUERA del árbol kodo (repo tap separado):
homebrew-kodo/
└── Formula/
    └── kodo.rb        # NEW: depends_on node + std_npm_args + service do { run [...,"daemon","run"] }
```

### Pattern 1: `kodo up` orchestration (UP-01/02) — `runUp(deps)`
**What:** Un orquestador puro never-throws en `src/cli/up.js` que compone piezas existentes. NO reimplementa spawn/PID.
**When to use:** El handler de `kodo up` en `cli.js`.
**Example:**
```javascript
// Source: composición de lifecycle.js:86 + server.js:439 + dashboard/index.js:85 + client.js:49
// src/cli/up.js (NUEVO)
export async function runUp(deps = {}) {
  const platform = deps._platform || process.platform;
  const statusFn = deps._statusDaemon || statusDaemon;      // lifecycle.js:207
  const startFn  = deps._startDaemon  || startDaemon;        // lifecycle.js:86
  const probeFn  = deps._probePort    || probePortInUse;    // node:net (Pattern nuevo, abajo)
  const waitFn   = deps._waitForHealth|| waitForHealth;     // fetch loop never-throws
  const dashFn   = deps._runDashboard || runDashboard;      // dashboard/index.js:85
  const loadCfg  = deps._loadConfig   || loadConfig;

  const port = loadCfg().server?.port ?? DEFAULT_CONFIG.server.port; // 9090 default (mirror resolveBaseUrl)
  const baseUrl = `http://localhost:${port}`;

  // D-06: Windows → foreground documentado, sin detach (NO crashea).
  if (platform === 'win32') {
    process.stderr.write('kodo up: Windows sin daemon en background. Corriendo en foreground (Ctrl-C para salir).\n');
    return runDaemon();  // run.js:60 — bloquea aquí; no attach de dashboard separado.
  }

  // (1) ensure-daemon (D-01/D-02 idempotencia): PID-alive primario + puerto secundario.
  const st = statusFn('kodo');                 // {status:'running'|'idle', pid}
  const portBusy = await probeFn(port);        // true si algo escucha (ECONNREFUSED=false)
  if (st.status !== 'running' && !portBusy) {
    const res = await startFn('kodo', ['daemon', 'run']);  // detached; su propio pre-flight re-guarda (lifecycle.js:111-118)
    if (!res.ok) { process.stderr.write(`kodo up: no se pudo arrancar el daemon: ${res.message}\n`); return; }
  }
  // si st.running || portBusy → ATTACH directo (idempotente, sin doble-spawn)

  // (2) health-wait: never-throws sobre /health hasta ready o timeout.
  const healthy = await waitFn(baseUrl, { timeoutMs: 10000, intervalMs: 200 });
  if (!healthy) process.stderr.write('kodo up: daemon no respondió a /health a tiempo; abriendo dashboard de todos modos.\n');

  // (3) attach como visor. runDashboard es cliente HTTP puro; owns nothing.
  await dashFn({ url: baseUrl });

  // (4) return. NO signal handlers hacia el daemon. detached:true ya lo aisló → persiste (UP-02).
}
```

### Pattern 2: `node:net` port probe (UP-03) — la única primitiva nueva
**What:** Sonda ~10 líneas: intenta conectar al puerto; `ECONNREFUSED` = libre, connect OK = ocupado.
**When to use:** Señal secundaria de idempotencia (la PID-alive de `statusDaemon` es la primaria).
**Example:**
```javascript
// Source: node:net (STACK.md:126) — cero deps
import net from 'node:net';
function probePortInUse(port, host = '127.0.0.1', timeoutMs = 500) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (busy) => { sock.destroy(); resolve(busy); };
    sock.once('connect', () => done(true));                 // algo escucha → ocupado
    sock.once('error', (e) => done(e.code !== 'ECONNREFUSED' ? true : false)); // ECONNREFUSED=libre
    sock.setTimeout(timeoutMs, () => done(false));          // timeout → trátalo como libre (never-hang)
  });
}
```
**Nota de diseño:** El PID-alive (`statusDaemon('kodo')`) es la guarda **primaria** (identidad de proceso, no "algo tiene el puerto"). La sonda de puerto evita colisionar con un `kodo start` legacy que ya escuche en el mismo puerto (Pitfall 3): si el puerto está ocupado pero no hay `kodo.pid`, es más seguro attach-and-serve que spawnear y chocar con `EADDRINUSE`.

### Pattern 3: Dashboard como visor detach-safe (UP-02)
**What:** `runDashboard` (`dashboard/index.js:85`) es un cliente HTTP puro de `/status` (`client.js:49-60`) que no posee nada. `kodo up` lo llama tras health-ready; al retornar, `up` sale y el daemon persiste.
**When:** La mitad "attach" de `up`.
**Trade-offs:** (+) El modelo persistente LOCKED sale **gratis** de `detached:true` (`lifecycle.js:125`): Ctrl-C en la terminal que corrió `up` nunca alcanza el process group del daemon. `up` **NO debe** registrar handlers que señalen al daemon. El propio `runDashboard` gestiona su ciclo (`q`→`useApp().exit()`, Ctrl-C→`exitOnCtrlC` de ink, SIGTERM→`app.unmount()` en `index.js:299-302`, `process.exitCode=0` en `:313`) — todos apagan el DASHBOARD, ninguno señala al daemon. (−) Ninguno material.

### Unified stop/status (UP-05) — daemon-first + fallback legacy (D-04)
**What:** `kodo stop`/`kodo status` en `cli.js` pasan a operar sobre el daemon `'kodo'`, preservando el fallback `server.pid`.

`cli.js:78-84` (legacy `stop` = `stopServer()`) y `cli.js:304-325` (legacy `status` = `listSessions()`) se **reemplazan por** lógica daemon-first:

```javascript
// kodo stop (daemon-first + fallback legacy server.pid)
async function runStopUnified(opts, deps = {}) {
  const stopFn = deps._stopDaemon || stopDaemon;            // lifecycle.js:163
  const res = await stopFn('kodo');                          // SIGTERM→5s→SIGKILL→removePidFile
  if (res.stopped || res.stale) { /* daemon tumbado */ return 0; }
  // res.notRunning → NO hay daemon 'kodo'. Fallback legacy: back-compat de `kodo start`.
  const { stopServer } = await import('./server.js');        // usa server.pid legacy
  stopServer();
  return 0;
}
```

```javascript
// kodo status (daemon-first, --json byte-determinista; molde polling.js:544-553)
function runStatusUnified(opts, deps = {}) {
  const statusFn = deps._statusDaemon || statusDaemon;       // lifecycle.js:207
  const st = statusFn('kodo');                                // {status:'running'|'idle', pid}
  if (opts.json === true) {
    // SIEMPRE las mismas keys (Pitfall #10 / DX-06 byte-determinismo). NO createFormatter.
    process.stdout.write(JSON.stringify({ status: st.status, pid: st.pid }) + '\n');
  } else {
    const fmt = createFormatter(process.stdout);             // color-isolation (solo desde format.js)
    process.stdout.write(st.status === 'running' ? `${fmt.ok('running')} pid: ${st.pid}\n` : `${fmt.dim('stopped')}\n`);
  }
  return 0;
}
```

**Discreción del planner (D-04):** la forma exacta del fallback — p.ej. si `status` reporta también el estado del `server.pid` legacy cuando no hay daemon, o solo el del daemon. Recomendación: `status` reporta el daemon `'kodo'`; el `server.pid` legacy se consulta vía `kodo start`/`stop` como antes. `stop` SÍ hace fallback (para no regresionar `kodo start`→`kodo stop`).

### Homebrew formula (DIST-01/02) — DEEPENED

**Forma canónica verificada** (docs.brew.sh Node-for-Formula-Authors + Homebrew::Service API), corregida a la realidad enviada (`kodo daemon run`, NO `--foreground`):

```ruby
# Source: docs.brew.sh/Node-for-Formula-Authors + docs.brew.sh/rubydoc/Homebrew/Service.html
# Repo tap: kintsugi-lab/homebrew-kodo  →  Formula/kodo.rb
class Kodo < Formula
  desc "Automated Claude Code sessions from task-management systems"
  homepage "https://github.com/kintsugi-lab/kodo"
  url "https://github.com/kintsugi-lab/kodo/archive/refs/tags/v0.15.0.tar.gz"
  sha256 "…"                       # sha256 del tarball del tag
  license "MIT"

  depends_on "node"                # NO bundlear runtime; satisface engines ">=20" (package.json:22-24)

  def install
    system "npm", "install", *std_npm_args   # instala pkg+deps a libexec, exes en libexec/bin
    bin.install_symlink libexec.glob("bin/*") # expone `kodo` en PATH; node_modules aislado en libexec
  end

  service do
    run [opt_bin/"kodo", "daemon", "run"]     # ⚠ FOREGROUND supervisado — NUNCA "up" (Pitfall 6)
    keep_alive true                            # reinicia si muere (launchd es el supervisor)
    log_path       var/"log/kodo.log"          # launchd NO hereda tu terminal → captura stdout
    error_log_path var/"log/kodo.log"          # mismo fichero preserva interleaving cronológico
    working_dir    var                         # cosmético; kodo lee ~/.kodo absoluto
    # environment_variables: OMITIR — secretos van a ~/.kodo/.env (0600), nunca al plist plaintext
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kodo --version")
  end
end
```

**Puntos que importan (verificados):**
- **`std_npm_args` sin `prefix: false`** [VERIFIED: docs.brew.sh] — es la forma CLI-app. Instala en estilo global-npm con prefijo a `libexec`, exes en `libexec/bin`. `prefix: false` es solo para el caso librería/multi-step — NO usar aquí.
- **`bin.install_symlink libexec.glob("bin/*")`** [VERIFIED: docs.brew.sh] — expone `kodo` en el PATH de Homebrew manteniendo `node_modules` aislado en `libexec` (sin polución global).
- **`run [opt_bin/"kodo", "daemon", "run"]`** — forma array (sin shell). `opt_bin` = `$(brew --prefix)/opt/kodo/bin`, path ESTABLE que resuelve **Apple Silicon `/opt/homebrew`** vs **Intel `/usr/local`** automáticamente [CITED: Pitfall 9 / STACK.md]. La divergencia con el research: `daemon run`, NO `up --foreground`.
- **`keep_alive`** [VERIFIED: Homebrew::Service API] — acepta boolean (`true`→`{always: true}`) o hash con keys `:always`/`:successful_exit`/`:crashed`/`:path`. `keep_alive true` reinicia siempre; `keep_alive crashed: true` reinicia solo en salida no-cero (opción más conservadora para la ventana de onboarding — ver Pitfall P10/P7 abajo).
- **`run_type`** — dejar default `:immediate` [VERIFIED: API valores `:immediate`/`:interval`/`:cron`]. Es un servicio long-running, no interval/cron.
- **Native addons:** kodo NO tiene (deps JS puras: commander, ink, react, picocolors) → NO hace falta `depends_on "python" => :build`. Si una dep futura tira de `node-gyp`, añadir esa línea [CITED: STACK.md:77].
- **Tap vs core:** shipear en tap. homebrew-core tiene gates de notabilidad/mantenimiento que una herramienta personal no pasa; un tap es first-class para `brew services` [CITED: STACK.md:78].

**Estructura del repo tap:**
```
kintsugi-lab/homebrew-kodo/          # el prefijo "homebrew-" es OBLIGATORIO en el repo
└── Formula/
    └── kodo.rb
# Uso: brew tap kintsugi-lab/kodo && brew install kodo && brew services start kodo
```

### Anti-Patterns to Avoid
- **Reimplementar el daemon desde cero** (fresh spawn/PID) en vez de usar `startDaemon` — pierde `unref()`, pre-flight stale-PID, bounded-wait, argv absoluto (Pitfall 1). Usa `lifecycle.js:86`.
- **Plist invocando `kodo up`** — self-detach → crash-loop launchd cada ~10s (Pitfall 6, load-bearing). Usa `kodo daemon run`.
- **`up` registrando SIGINT/SIGTERM que señalen al daemon** — mataría el daemon al cerrar el dashboard (viola UP-02 LOCKED). `detached:true` ya aísla el process group.
- **Reusar `server.pid` para el daemon `up`** — colisiona con `kodo start` legacy. Usa `kodo.pid` (Phase 65 ya lo hace).
- **Secretos en `environment_variables` del plist** — el plist es plaintext world-readable en `~/Library/LaunchAgents/`. Deja los secretos en `~/.kodo/.env` (kodo ya lo carga en runtime).
- **`def plist` XML a mano** — deprecado, frágil entre prefijos. Usa `service do`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spawn detached + PID + kill | Nuevo spawn/PID/SIGTERM | `startDaemon`/`stopDaemon` (`lifecycle.js:86/163`) | Ya templado línea a línea sobre polling maduro; DI-testeado |
| Liveness de PID | `existsSync(pidfile)` | `isPidAlive` (`gsd/lock.js:67`) | `existsSync` no detecta stale PID (Pitfall 2) |
| Health poll HTTP | fetch a pelo con try/catch ad-hoc | Patrón `fetchStatus` (`client.js:49-60`) | Never-throws probado; colapsa ECONNREFUSED/abort/parse |
| Detección de puerto | `detect-port`/`get-port` | `node:net` `net.connect` (~10 líneas) | Cero deps; determinista |
| Generación del plist launchd | `def plist` XML | DSL `service do` | Homebrew renderiza el plist correcto por prefijo |
| Supervisión del proceso | `pm2`/`forever` | launchd (`brew services`) + `keep_alive` | Duplicaría el supervisor del OS |

**Key insight:** Phase 66 es 90% composición. El único código genuinamente nuevo es `probePortInUse` (`node:net`, ~10 líneas), `waitForHealth` (~15 líneas mirror de `fetchStatus`), el orquestador `runUp` (composición pura), el rewire daemon-first de `stop`/`status`, y la fórmula Ruby (fuera del árbol). Todo lo demás ya está enviado y testeado.

## Runtime State Inventory

> Phase 66 NO es un rename/refactor puro, pero introduce estado OS-registrado (launchd) y un PID nuevo. Inventario relevante:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Ninguno nuevo en datastores. El PID `~/.kodo/kodo.pid` ya lo escribe `runDaemon` (`run.js:140-143`) — Phase 66 no lo cambia. | None — verificado en `run.js:140` |
| Live service config | **launchd registra `~/Library/LaunchAgents/homebrew.mxcl.kodo.plist`** al hacer `brew services start kodo`. NO vive en git; lo genera Homebrew desde `service do`. | Manual/spike: verificar que `brew services list` lo muestra `started` y que persiste tras relogin |
| OS-registered state | launchd LaunchAgent (arriba). Bajo `sudo brew services` sería LaunchDaemon con HOME=`/var/root` → split-brain de `~/.kodo` (Pitfall 8). | Documentar: instalar como **user agent** (sin sudo); el spike valida `homedir()` correcto |
| Secrets/env vars | `~/.kodo/.env` (secretos) — kodo ya lo carga en runtime vía `config.js`. launchd NO hereda env del shell (Pitfall 7). | None de código; el spike valida que el daemon bajo launchd lee `~/.kodo/.env` |
| Build artifacts | Bajo brew: `libexec/` con `node_modules` + symlink en `bin/kodo`. El `opt_bin` estable apunta al symlink. | Ninguno en el árbol kodo; el spike valida `opt_bin` correcto por arquitectura |

**Nada encontrado en category "Stored data nuevo":** Correcto — el PID unificado `kodo.pid` ya existe desde Phase 65 (`run.js:140`), Phase 66 solo lo consume.

## Common Pitfalls

### Pitfall 1: launchd foreground trap (P6 — LOAD-BEARING)
**What goes wrong:** El plist invoca `kodo up`, que self-detacha (spawn+unref) y el shim foreground sale 0 inmediato. launchd ve morir el proceso que arrancó y con `keep_alive` lo reinicia en crash-loop (~cada 10s, el ThrottleInterval default de launchd). El daemon real detached corre sin supervisar, invisible a `brew services stop`.
**Why it happens:** El MISMO comando necesita comportamientos opuestos: bajo `kodo up` (shell) debe backgroundearse; bajo launchd debe quedarse foreground. Los devs testean `up` interactivo (donde detach es correcto) y solo descubren el conflicto tras publicar la fórmula.
**How to avoid:** El plist invoca `kodo daemon run` (foreground supervisado, `run.js:60`, bloquea con `await blockFn()` en `run.js:147`), **NUNCA `kodo up`**. Ya está resuelto en el diseño: `daemon run` es el único funnel foreground; `up` es el único que detacha.
**Warning signs:** `brew services list` muestra `error` o parpadea `started`↔`stopped`; logs con reinicios cada ~10s; el daemon "funciona" con `kodo up` pero no con `brew services`.

### Pitfall 2: PATH mínimo bajo launchd — `node` no encontrado (P7)
**What goes wrong:** El plist corre `kodo` (script con shebang Node); launchd arranca con PATH mínimo (`/usr/bin:/bin:/usr/sbin:/sbin`) que excluye `/opt/homebrew/bin` (Apple Silicon) o `/usr/local/bin` (Intel) y cualquier node de nvm/asdf. Falla con "env: node: No such file or directory" → crash-loop.
**Why it happens:** Los shells interactivos cargan `~/.zprofile`; launchd no. `depends_on "node"` garantiza que node está *instalado*, no que el PATH del plist incluya su bin.
**How to avoid:** `run [opt_bin/"kodo", "daemon", "run"]` usa el path absoluto del symlink de Homebrew (resuelto por arquitectura). El shebang `#!/usr/bin/env node` de `bin/kodo` aún necesita `node` en PATH — el spike DEBE verificar esto; si falla, la fórmula puede necesitar `EnvironmentVariables.PATH` incluyendo `Formula["node"].opt_bin`, o invocar node absoluto. **Alto riesgo, verificar en spike.**
**Warning signs:** Funciona desde terminal, falla solo bajo `brew services`; syslog muestra "spawn node ENOENT".

### Pitfall 3: KeepAlive convierte cualquier fallo de arranque en crash-loop (P10)
**What goes wrong:** Con `keep_alive true`, cada salida no-cero se vuelve reinicio infinito: secreto webhook ausente (`server.js:431-433` lanza `KODO_SETUP_REQUIRED` bajo managed), `provider.init()` fallando en first-run sin API key, `EADDRINUSE`. launchd throttlea a ~1/10s pero nunca desiste.
**Why it happens:** first-run (sin config) es exactamente cuando el daemon puede fallar, y first-run es exactamente cuando un usuario nuevo instala por brew.
**How to avoid:** `runDaemon` (`run.js:104-111`) YA captura el throw de `startServer({managed})` como superficie limpia + `teardown(1)` (no uncaught crash). Aun así, bajo KeepAlive un `teardown(1)` recurrente = crash-loop. El setup-mode real (no salir con exit 1 en first-run) es **Phase 68** (fuera de scope). Para Phase 66: considerar `keep_alive crashed: true` (solo reinicia en no-cero) y documentar que el first-run limpio requiere Phase 68. **El spike debe probar el arranque con config VÁLIDA** (no first-run) para aislar el gate de brew del gate de setup.
**Warning signs:** Reinicios cada 10s tras `brew services start` en una máquina sin `~/.kodo/config.json`.

### Pitfall 4: `opt_bin` incorrecto por arquitectura (P9)
**What goes wrong:** Un path hardcodeado a `/usr/local` falla en Apple Silicon (`/opt/homebrew`) y viceversa.
**How to avoid:** `opt_bin` (helper de Homebrew) resuelve el prefijo correcto automáticamente. NO hardcodear. **El spike DEBE correr en al menos una arquitectura y verificar `readlink $(brew --prefix)/opt/kodo/bin/kodo`.**
**Warning signs:** "No such file or directory" en el path del plist en una arquitectura pero no en otra.

### Pitfall 5: double-spawn / colisión de puerto (P3)
**What goes wrong:** `kodo up` spawnea aunque el daemon ya corra → `EADDRINUSE` o dos daemons.
**How to avoid:** Doble guarda: (1) `statusDaemon('kodo')` PID-alive primario; (2) sonda `node:net` de puerto secundaria. Además `startDaemon` tiene su propio pre-flight interno (`lifecycle.js:111-118`). Si el daemon ya corre → attach, no spawn.
**Warning signs:** `EADDRINUSE` en logs; `runDaemon` fallando al bind.

### Pitfall 6: detach que no detacha (P2/P5)
**What goes wrong:** Sin `child.unref()` el padre (`kodo up`) cuelga; el daemon muere al cerrar la terminal.
**How to avoid:** Ya cubierto — `startDaemon` llama `child.unref()` (`lifecycle.js:131`, "sin esto el padre cuelga"). `kodo up` no toca esto porque delega en `startDaemon`.

## Code Examples

### Health-wait never-throws (health readiness gate)
```javascript
// Source: mirror de fetchStatus (client.js:49-60) contra /health (server.js:439)
// src/cli/up.js
async function waitForHealth(baseUrl, { timeoutMs = 10000, intervalMs = 200 } = {}, fetchFn = globalThis.fetch) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      const res = await fetchFn(`${baseUrl}/health`);   // {status:'ok',uptime} (server.js:439-442)
      if (res.ok) return true;
    } catch { /* ECONNREFUSED durante boot — never-throws, sigue sondeando */ }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  } while (true);
  return false;
}
```

### `startDaemon` invocación (composición, NO reimplementación)
```javascript
// Source: lifecycle.js:86 — firma real
const res = await startDaemon('kodo', ['daemon', 'run']);
// res: { ok, alreadyRunning?, started?, timedOut?, unsupported?, pid?, message? }
// win32 → { ok:false, unsupported:true } (lifecycle.js:102-108) — el guard de up.js lo maneja antes
// alreadyRunning → { ok:true, alreadyRunning:true, pid } (idempotencia interna, lifecycle.js:112-114)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `run [opt_bin/"kodo","up","--foreground"]` (research STACK.md) | `run [opt_bin/"kodo","daemon","run"]` | Phase 65 (2026-07-02) envió `daemon run` hidden | La fórmula DEBE usar `daemon run`; `--foreground` nunca se implementó |
| PID `~/.kodo/kodod.pid` (research) | PID `~/.kodo/kodo.pid` (name `'kodo'`) | Phase 65 (`run.js:140`, `polling-daemon.js:58` name param) | `up`/`stop`/`status` operan sobre name `'kodo'` |
| `def plist` XML | DSL `service do` | Homebrew ≥4.x | Nunca escribir XML; Homebrew renderiza |

**Deprecated/outdated:**
- `STACK.md` líneas 61, 88, 93, 122, 130, 166, 178, 182 (`kodo up --foreground`, `kodod.pid`): OBSOLETO — usar `kodo daemon run` + `kodo.pid`. `ARCHITECTURE.md:71` y `CONTEXT.md` D-05 ya corregidos.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bin/kodo` (shebang `#!/usr/bin/env node`) resuelve `node` bajo el PATH mínimo de launchd cuando `node` está instalado por brew | Pitfall 2 | Alto — crash-loop bajo `brew services`; el spike DEBE verificar y quizá añadir `EnvironmentVariables.PATH` a la fórmula |
| A2 | `keep_alive true` es aceptable para v0.15 asumiendo config válida en el spike; el first-run limpio (crash-loop sin config) se difiere a Phase 68 | Pitfall 3 | Medio — un usuario nuevo con `brew services start` sin config vería crash-loop hasta Phase 68; considerar `keep_alive crashed:true` o documentar |
| A3 | El default `keep_alive true` no reinicia en salida limpia esperada del daemon (el daemon bloquea forever, no sale limpio salvo SIGTERM) | Homebrew formula | Bajo — el daemon no sale voluntariamente; SIGTERM de `brew services stop` es esperado |
| A4 | El owner del tap será `kintsugi-lab/homebrew-kodo` | Homebrew formula | Bajo — cosmético; el operador confirma (discreción D-05) |
| A5 | `working_dir var` es cosmético porque kodo lee `~/.kodo` absoluto vía `homedir()` | Homebrew formula | Bajo — verificado que `config.js` usa `homedir()`; salvo escenario `sudo` (Pitfall 8) |
| A6 | El puerto para la sonda/health-wait sale de `config.server.port` (default 9090) igual que `resolveBaseUrl` (`dashboard/index.js:69-73`) | Pattern 1/2 | Bajo — verificado en código |

## Open Questions

1. **¿El shebang `node` resuelve bajo launchd? (A1)**
   - Lo que sabemos: `opt_bin/"kodo"` da path absoluto al symlink; `bin/kodo` es shebang `#!/usr/bin/env node`.
   - Lo que no está claro: si el PATH mínimo de launchd incluye el `node` de brew para que `env node` lo encuentre.
   - Recomendación: el spike (D-07) verifica esto explícitamente; si falla, añadir `EnvironmentVariables { "PATH" => "#{Formula["node"].opt_bin}:#{ENV["PATH"]}" }` o equivalente a la fórmula. NO es unit-testable.

2. **¿`keep_alive true` o `keep_alive crashed: true`?**
   - Lo que sabemos: `true` reinicia siempre; `crashed:true` solo en salida no-cero.
   - Lo que no está claro: si conviene conservador hasta que Phase 68 arregle el first-run.
   - Recomendación: `keep_alive true` para v0.15 (el daemon bloquea forever, no debería salir limpio); documentar que el first-run sin config puede crash-loopear hasta Phase 68. Decisión de discuss/plan.

3. **¿`status` reporta también el `server.pid` legacy?** (discreción D-04)
   - Recomendación: `status` daemon-first sobre `'kodo'`; el legacy se consulta por su propio camino. `stop` SÍ hace fallback a `server.pid`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Todo | ✓ (asumido) | ≥20 (package.json:22-24) | — |
| `node:net` / `node:child_process` / `fetch` | up.js port probe + health-wait | ✓ built-in | Node ≥20 | — |
| Homebrew | DIST-01/02 (spike) | ✗ verificar en spike | ≥4.x requerido | — (blocker del spike si ausente) |
| launchd | DIST-02 (spike) | ✓ macOS | sistema | Windows → foreground (D-06) |

**Missing dependencies with no fallback:**
- Homebrew ≥4.x en la máquina del spike — sin él no se valida DIST-01/02 (el `checkpoint:human-verify` lo requiere).

**Missing dependencies with fallback:**
- launchd/brew en Windows → `kodo up` foreground (D-06), distribución brew out-of-scope para Windows.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none — `package.json:10` script: `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/cli/up.test.js` (o el fichero tocado) |
| Full suite command | `npm test` |
| Test dir precedent | `test/daemon/` (Phase 65: `lifecycle.test.js`, `run.test.js`, `pid-name-param.test.js` — todo DI, sin procesos reales) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UP-01 | `runUp` compone start→wait→attach en orden con daemon frío | unit (DI fakes) | `node --test test/cli/up.test.js` | ❌ Wave 0 |
| UP-02 | `runUp` NO registra handlers que señalen al daemon; retorna dejándolo vivo | unit (spy sobre process.on) | `node --test test/cli/up.test.js` | ❌ Wave 0 |
| UP-03 | Idempotencia: daemon vivo → attach, cero spawn; puerto ocupado → attach | unit (fake statusDaemon/probePort/startDaemon) | `node --test test/cli/up.test.js` | ❌ Wave 0 |
| UP-03 | `probePortInUse`: ECONNREFUSED=libre, connect=ocupado, timeout=libre | unit (server efímero real en puerto random, o fake net) | `node --test test/cli/port-probe.test.js` | ❌ Wave 0 |
| UP-01 | `waitForHealth`: 200→true, ECONNREFUSED never-throws→retry→timeout=false | unit (fake fetchFn) | `node --test test/cli/health-wait.test.js` | ❌ Wave 0 |
| UP-05 | `stop` daemon-first: daemon presente→stopDaemon; ausente→fallback stopServer | unit (fake stopDaemon + spy import server) | `node --test test/cli/stop-unified.test.js` | ❌ Wave 0 |
| UP-05 | `status --json` byte-determinista: keys fijas running/idle | unit (fake statusDaemon + capture stdout) | `node --test test/cli/status-unified.test.js` | ❌ Wave 0 |
| DIST-03 | win32 guard: `runUp` platform=win32 → foreground, no detach, no crash | unit (`_platform:'win32'`) | `node --test test/cli/up.test.js` | ❌ Wave 0 |
| DIST-01/02 | Fórmula pasa `brew audit --new --strict` + `brew style` (lint estático) | static lint (si brew disponible en CI) | `brew audit --new --strict Formula/kodo.rb; brew style Formula/kodo.rb` | ❌ Wave 0 (repo tap) |
| DIST-01/02 | Ciclo real: install→start→list→relogin→crash-restart→stop | **MANUAL (spike)** | **`checkpoint:human-verify` — NO automatizable** | N/A |

### Automatable vs Manual boundary (crítico para scope del checkpoint D-07)

**AUTOMATABLE (unit, DI/fakes, sin procesos ni brew reales):**
- `runUp` orchestration: fakes de `_statusDaemon`/`_probePort`/`_startDaemon`/`_waitForHealth`/`_runDashboard`/`_loadConfig`/`_platform`. Verifica orden, ramas attach-vs-spawn, guard win32, ausencia de signal handlers hacia el daemon. Espejo directo de `test/daemon/lifecycle.test.js` (todo DI).
- `probePortInUse`: contra un `net.createServer` efímero en puerto random (real, aislado, <50ms) — cubre connect/ECONNREFUSED/timeout. O fake de `net.connect`.
- `waitForHealth`: fake `fetchFn` que devuelve secuencia [throw ECONNREFUSED, throw, {ok:true}] → verifica retry + never-throws + resolución true; y [throw…timeout] → false.
- `stop`/`status` unificados: fakes de `stopDaemon`/`statusDaemon` + captura de stdout para `--json` byte-determinismo. Fallback: spy sobre el import dinámico de `server.js` (o inyección `_stopServer`).
- **Lint estático de la fórmula** (`brew audit --new --strict`, `brew style`): SI brew está en el runner. Cheap gate en el repo tap. **PERO** `brew audit` NO detecta el bug "el proceso se auto-daemoniza bajo launchd" (Pitfall 6) — eso es solo runtime.

**MANUAL (spike → `checkpoint:human-verify`, NO unit-testable):**
- `brew install kodo` real (resuelve `depends_on node`, corre `npm install *std_npm_args`, symlink).
- `brew services start kodo` → `brew services list` muestra `started` (no `error`/parpadeo).
- **Verificar `opt_bin` por arquitectura:** `readlink $(brew --prefix)/opt/kodo/bin/kodo` correcto en Apple Silicon (`/opt/homebrew`) vs Intel (`/usr/local`).
- **RunAtLoad tras relogin:** cerrar sesión / reiniciar → el daemon vuelve a arrancar.
- **Crash-restart:** `kill` el daemon → launchd lo reinicia (`keep_alive`).
- **Resolución de `node` bajo launchd** (A1): confirmar que NO hay "node ENOENT" en `var/log/kodo.log`.
- **`~/.kodo/.env` leído bajo launchd** (Pitfall 7): el daemon obtiene sus secretos.
- `brew services stop kodo` limpio.

El planner DEBE poner UN `checkpoint:human-verify` que enumere estos 8 chequeos manuales, después de que todo el código (`up`/`stop`/`status`/fórmula) esté implementado y con sus unit tests verdes. En `--auto`, este checkpoint se PAUSA para el operador (D-07).

### Sampling Rate
- **Per task commit:** `node --test test/cli/<fichero-tocado>.test.js`
- **Per wave merge:** `npm test` (suite completa, 85+ ficheros)
- **Phase gate:** `npm test` verde + `checkpoint:human-verify` del ciclo brew aprobado por el operador antes de cerrar la fase.

### Wave 0 Gaps
- [ ] `test/cli/up.test.js` — cubre UP-01, UP-02, UP-03 (attach-vs-spawn), DIST-03 (win32 guard). DI fakes espejo de `test/daemon/lifecycle.test.js`.
- [ ] `test/cli/port-probe.test.js` — cubre UP-03 (sonda `node:net`). Server efímero real o fake net.
- [ ] `test/cli/health-wait.test.js` — cubre UP-01 (readiness never-throws). Fake fetchFn.
- [ ] `test/cli/stop-unified.test.js` — cubre UP-05 (stop daemon-first + fallback). Fake stopDaemon + spy server import.
- [ ] `test/cli/status-unified.test.js` — cubre UP-05 (status `--json` byte-determinista). Fake statusDaemon.
- [ ] `Formula/kodo.rb` en repo tap + (opcional) CI `brew audit`/`brew style` — cubre DIST-01/02 estáticamente.
- [ ] Framework install: ninguno — `node:test` es built-in; patrón HOME-isolation (`mkdtempSync(join(tmpdir(),'kodo-…'))`) ya establecido (`test/config-atomic.test.js:15`, `test/gsd-lock.test.js:54`) si algún test toca FS real. La mayoría no lo necesita (todo DI).

## Security Domain

> `security_enforcement` no explícito → tratado como habilitado. Fase de bajo perfil de seguridad (orquestación de proceso local + packaging), pero con vectores reales.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sin auth de usuario en esta fase |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | parcial | Puerto de config (numérico); argv del spawn en forma array (sin shell) |
| V6 Cryptography | no | Sin cripto nueva (secretos siguen en `.env`, boundary de Phase 67) |
| V7 Errors/Logging | sí | `log_path`/`error_log_path` del plist NO deben capturar secretos; kodo ya loguea sin key |
| V10 Malicious Code / Config | sí | Fórmula Ruby (packaging) — auditar con `brew audit`; sha256 del tarball |
| V14 Configuration | sí | Secretos fuera del plist (world-readable); `opt_bin` absoluto (no PATH lookup) |

### Known Threat Patterns for kodo daemon + Homebrew

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secreto en plist plaintext (`~/Library/LaunchAgents/*.plist` world-readable) | Information Disclosure | OMITIR `environment_variables`; secretos en `~/.kodo/.env` (0600) |
| EoP vía PATH lookup del spawn | Elevation of Privilege | argv absoluto `process.execPath`+`KODO_BIN` (ya en `lifecycle.js:120-131`); `opt_bin` en el plist |
| Split-brain de `~/.kodo` bajo `sudo brew services` (HOME=`/var/root`) | Tampering | Instalar como user LaunchAgent (sin sudo); documentar; spike valida `homedir()` |
| Tarball de la fórmula alterado | Tampering | `sha256` fijo en `Formula/kodo.rb` + `brew audit --new --strict` |
| Secreto en logs del daemon bajo launchd | Information Disclosure | kodo ya loguea sin key (PERSIST-04); `log_path` captura el mismo stdout sanitizado |

## Sources

### Primary (HIGH confidence)
- Código vivo kodo: `src/daemon/lifecycle.js` (startDaemon:86/stopDaemon:163/statusDaemon:207), `src/daemon/run.js` (runDaemon:60, writePidFile:140), `src/cli/dashboard/index.js` (runDashboard:85, resolveBaseUrl:69, guards:90/299/313), `src/cli/dashboard/client.js` (fetchStatus:49-60), `src/cli/polling.js` (runPollingStopCli:492, runPollingStatusCli:538, daemon spawn:283-323, win32 guard:237), `src/server.js` (/health:439, /status:445, managed throw:431), `src/cli.js` (stop:78, status:304, dashboard:356, polling:443, daemon run hidden:508), `src/gsd/lock.js` (isPidAlive:67), `src/cli/polling-daemon.js` (PID trio name param:58/94/119/141), `package.json` (bin:6, engines:22) — todo verificado por lectura directa
- [docs.brew.sh/Node-for-Formula-Authors](https://docs.brew.sh/Node-for-Formula-Authors) — `std_npm_args` (sin `prefix:false` para CLI), `libexec`, `bin.install_symlink`, `depends_on "node"` — VERIFIED via WebFetch
- [docs.brew.sh/rubydoc/Homebrew/Service.html](https://docs.brew.sh/rubydoc/Homebrew/Service.html) — `service do` DSL: `run`/`keep_alive` (bool + hash `:always`/`:successful_exit`/`:crashed`/`:path`)/`run_type` (`:immediate`/`:interval`/`:cron`)/`log_path`/`error_log_path`/`working_dir`/`opt_bin` — VERIFIED via WebFetch

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md` (research de milestone) — pitfalls P2/P5/P6/P7/P8/P9/P10, patrones; **con la corrección `daemon run`/`kodo.pid` sobre el `up --foreground`/`kodod.pid` obsoleto**
- Comportamiento launchd (ThrottleInterval ~10s, PATH mínimo, LaunchAgent vs LaunchDaemon HOME) — conocimiento establecido, no unit-testable → spike

### Tertiary (LOW confidence)
- Resolución exacta del shebang `node` bajo el PATH mínimo de launchd (A1) — requiere verificación empírica en el spike

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todo built-in o código enviado, verificado file:line
- Architecture (`kodo up` orchestration, stop/status): HIGH — composición pura sobre Phase 65 verificado
- Homebrew formula DSL: HIGH — verificado contra docs oficiales
- launchd runtime behavior: MEDIUM — DSL verificado, comportamiento real no unit-testable (spike)
- Pitfalls: HIGH (codebase) / MEDIUM (launchd)

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (30 días — stack estable; Homebrew DSL estable; re-verificar solo si Homebrew ≥5 cambia el service DSL)
