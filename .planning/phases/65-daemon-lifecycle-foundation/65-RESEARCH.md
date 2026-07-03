# Phase 65: Daemon Lifecycle Foundation - Research

**Researched:** 2026-07-02
**Domain:** Node.js daemon lifecycle refactor — generalize the shipped `polling.js` daemon pattern into `src/daemon/`, gate `startServer` into a managed mode, unify PID under `~/.kodo/kodo.pid`. Zero new deps.
**Confidence:** HIGH (grounded in direct codebase reads with file:line; milestone research already covers the domain and proposed this phase)

> Scope note: the milestone research (`.planning/research/{SUMMARY,ARCHITECTURE,PITFALLS}.md`) already covers this domain deeply and proposed this exact phase, its deliverables, and its pitfalls. This document does NOT re-derive that — it (a) pins the phase-specific surgical detail to real `file:line`, and (b) produces the REQUIRED `## Validation Architecture` section (Nyquist enabled).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** `kodo daemon run` compone `startServer(managed)` **+** `startPolling` condicional en **UN** proceso con **UN** PID file. NO spawnea server y polling como hijos PID-trackeados separados (recrearía un gestor de procesos genérico — fuera de scope LOCKED — y rompería `brew services` por doble-fork). Un único proceso foreground para launchd/`brew services`.
- **D-02:** Dos módulos nuevos: **`src/daemon/lifecycle.js`** (fontanería genérica start/stop/status, templada sobre `src/cli/polling.js`: spawn detached + `unref` :286-303, pre-flight `isPidAlive` :261, bounded wait, guardia Windows) y **`src/daemon/run.js`** (el **único** foreground funnel: compone server+polling, escribe `kodo.pid`, cleanup SIGTERM, bloquea forever con `await new Promise(() => {})`). Comando nuevo **`kodo daemon run`** (candidato a `hidden` en commander).
- **D-03:** Añadir opción `startServer({ managed })`. Bajo `managed:true`: (a) **NO** `process.exit(1)` en misconfig (`server.js:407`) — devolver/lanzar error discriminado que `run.js` maneja; (b) **NO** escribir su propio `server.pid` (`server.js:581`) — el PID lo dueña el daemon; (c) añadir handler **`.on('error')`** al `server.listen` (`server.js:576`) para EADDRINUSE limpio. El path legacy `kodo start` (managed:false, **default**) queda **byte-idéntico**. Cero regresión observable en `kodo start` (UP-06).
- **D-04:** Módulo PID **parametrizado por `name`** generalizado de `polling-daemon.js` (escritura atómica temp+rename + **`chmod 0600` pre-rename** + `isPidAlive` stale-check). El daemon usa `~/.kodo/kodo.pid`, **distinto** del `server.pid` legacy y del `polling.pid` standalone.
- **D-05:** `run.js` registra el handler SIGTERM que cierra el server (`stopServer`-equivalente in-process), detiene el polling, borra `kodo.pid` y sale. Bajo managed el server **no se auto-mata** — el proceso foreground `run.js` es el único dueño del exit.
- **D-06:** El daemon arranca `startPolling` **solo cuando el provider usa polling** (GitHub); Plane usa webhook (server). Helper `providerUsesPolling(config)`.

### Claude's Discretion
- Firmas/ubicación exactas de `lifecycle.js` / `run.js` / el módulo PID parametrizado y de `providerUsesPolling`.
- Forma exacta del error discriminado que devuelve `startServer(managed)` en misconfig/EADDRINUSE.
- Si `kodo daemon run` se marca `hidden` en commander (recomendado: sí — entrypoint interno).
- Cómo `startServer(managed)` devuelve el handle closeable a `run.js`.
- Si el módulo PID vive en `src/daemon/` o se extrae de `polling-daemon.js` in-place y ambos lo importan.

### Deferred Ideas (OUT OF SCOPE)
- `kodo up` / attach dashboard / `stop`/`status` unificados → Phase 66.
- Homebrew formula + `brew services`/launchd → Phase 66.
- `writeEnvVar` / masked input / setup mode / CFGF-03 → Phases 67-68.
- Deprecar `polling start` / `kodo start` / `server.pid` legacy → futuro (en v0.15 intactos).
- Hot-reload (CFGF-01) → v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UP-04 | El daemon expone un modo foreground supervisable (`kodo daemon run`) que bloquea sin auto-desvincularse, además del modo self-detach que usa `kodo up`. | `src/daemon/run.js` (block-forever funnel, mirror `runForegroundPolling` polling.js:350-392) + `startServer({managed})` refactor (server.js:361/407/576/581/612-618) + `kodo daemon run` wiring en cli.js (mirror `polling` group cli.js:443). Foreground = no `spawn`/`unref`; el proceso ES el daemon. |
| UP-06 | `kodo start` (server foreground legacy) sigue funcionando sin cambios tras introducir `kodo up`/daemon. | `managed` es opt-in con default `false`; los 4 puntos gateados (exit, self-PID, error handler, self-cleanup) quedan byte-idénticos cuando `managed` es falsy. Non-regresión probada por assertions de exit-code + `server.pid` (ver Validation Architecture). |
</phase_requirements>

## Summary

Phase 65 es "pura fundación": código nuevo (`src/daemon/lifecycle.js` + `run.js` + módulo PID name-parametrizado) más **un** refactor quirúrgico gateado (`startServer({managed})`). El material fuente ya existe y está testeado: `src/cli/polling.js` es el patrón daemon canónico y `src/cli/polling-daemon.js` es el molde correcto de PID (atómico + `chmod 0600` pre-rename). No hay comportamiento visible nuevo para el operador — `kodo daemon run` es un entrypoint interno que Phase 66 orquestará. El valor es habilitar Phase 66 sobre una base estable, y desbloquear el setup-mode de Phase 68 (evitando el `process.exit(1)` de server.js:407 que rompe el first-run chicken-and-egg).

El refactor `startServer(managed)` es la integración de mayor riesgo del milestone y por eso va primera. La superficie real es de **cuatro** puntos gateados, no tres: además de los tres del D-03 (no-exit :407, no-self-PID :581, handler `'error'` :576), hay un cuarto load-bearing para D-05 — los handlers `process.on('SIGTERM'/'SIGINT')` con `process.exit(0)` + `unlinkSync(PID_PATH)` de **server.js:612-618** deben saltarse bajo managed, porque `run.js` es el único dueño de las señales y del exit (dos dueños del proceso = doble teardown / race).

**Primary recommendation:** Generalizar los primitivos de `polling.js`/`polling-daemon.js` en `src/daemon/` (LOW risk, aditivo, back-compat) y hacer el refactor `startServer(managed)` con `managed` opcional default-`false`, gateando los 4 puntos y devolviendo un handle closeable `{ server, stopReconcile }`. Añadir un seam DI ligero (`_loadConfig`/`_provider`) a `startServer` para que el managed mode sea unit-testable sin red (mirror `isReportToProviderEnabled(_loadConfig)` config.js:233). NO tocar `polling.js` ni el `server.pid`/`polling.pid` legacy.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daemon detach/stop/status (fontanería) | CLI/process (`src/daemon/lifecycle.js`) | — | Generalización de polling.js; consumido por Phase 66 (`up`/`stop`/`status`). En Phase 65 se entrega pero su consumidor real es Phase 66. |
| Foreground compose (server+polling, 1 PID, block-forever) | CLI/process (`src/daemon/run.js`) | Backend (`startServer`), Polling (`startPolling`) | Único funnel foreground; lo invocan `kodo up` (detach) y launchd (directo). |
| HTTP server lifecycle | Backend (`src/server.js` `startServer`) | — | Managed mode cede la propiedad del PID y del exit al daemon; legacy mantiene su self-ownership. |
| PID file (atomic + 0600 + stale-check) | Storage (`~/.kodo/<name>.pid`) | — | Name-parametrizado; `kodo.pid` distinto de `server.pid`/`polling.pid`. |
| Polling loop (in-process timer) | Polling (`src/triggers/polling.js` `startPolling`) | — | Ya corre como timer in-process (NO proceso separado) — `runForegroundPolling` lo prueba. |
| Conditional polling decision | CLI/process (`providerUsesPolling`) | Config | Pure function sobre `config.provider`; evita polling loop inútil bajo Plane. |
| `kodo daemon run` command | CLI (`src/cli.js`) | — | Subcomando hidden mirror del grupo `polling` (cli.js:443). |

## Standard Stack

Zero nuevas dependencias. Todo built-in de Node ≥20 + reuso de código enviado.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` `spawn` | built-in (≥20) | detach spawn del daemon (en `lifecycle.startDaemon`, Phase 66 lo usará; en Phase 65 solo se generaliza el primitivo) | Ya usado verbatim en polling.js:286-302 `[VERIFIED: src/cli/polling.js:286-302]` |
| `node:fs` (`writeFileSync`/`renameSync`/`chmodSync`) | built-in | PID atómico + `chmod 0600` pre-rename | Molde correcto en polling-daemon.js:76-83 `[VERIFIED: src/cli/polling-daemon.js:76-83]` |
| `node:os` `homedir()` | built-in | resolución lazy de `~/.kodo/<name>.pid` | Patrón lazy anti-cache-de-HOME de polling-daemon.js:51-53 `[VERIFIED]` |
| `node:http` `createServer`/`server.close()` | built-in | server managed devuelve `http.Server` closeable | `startServer` ya retorna el `server` (server.js:620) `[VERIFIED: src/server.js:620]` |
| `commander` | 13.1.0 (dep existente) | registrar `kodo daemon run` hidden | `.command('run', { hidden: true })` soportado en v13 `[VERIFIED: node_modules/commander@13.1.0]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `isPidAlive` (`src/gsd/lock.js:67`) | in-repo | stale-PID liveness (`process.kill(pid,0)`, EPERM=alive) | Reuso sin cambios en el pre-flight del daemon `[VERIFIED: src/gsd/lock.js:67-74]` |
| `startPolling` (`src/triggers/polling.js:478`) | in-repo | polling loop in-process; retorna `{ stop() }` (polling.js:570-575) | `run.js` lo compone condicionalmente `[VERIFIED: src/triggers/polling.js:478,570-575]` |
| `node:test` | built-in | test runner (`npm test` = `node --test`) | Toda la validación (ver Validation Architecture) `[VERIFIED: package.json scripts.test]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Generalizar PID in-place en polling-daemon.js | Extraer a `src/daemon/pid.js` nuevo | In-place (default `name='polling'`) = cero churn en el módulo testeado; extraer = más limpio pero toca 2 imports. Discreción D-04. **Recomendado: in-place aditivo.** |
| `startServer` retorna `http.Server` crudo | Retorna `{ server, stopReconcile, close }` | El crudo ya tiene `.close()`, pero `run.js` también necesita `stopReconcile` (server.js:605) para el teardown D-05. **Recomendado: handle objeto en managed.** |
| `providerUsesPolling` = allowlist `provider==='github'` | Capability probe en el provider / shape-check `providers[p].repos` | Allowlist es simple y honesto (2 providers hoy) pero hardcodea nombres (roza provider-agnostic). Shape-check es implícito. **Recomendado: allowlist con comentario, extensible; discreción D-06.** |

**Installation:** N/A — cero paquetes nuevos.

## Package Legitimacy Audit

**N/A — esta fase NO instala paquetes externos.** Cero nuevas dependencias npm (invariante LOCKED del milestone; `.planning/STATE.md` "Cero nuevas dependencias npm"). Todo se construye sobre built-ins de Node ≥20 (`node:child_process`, `node:fs`, `node:os`, `node:http`, `node:test`) y reuso de código in-repo. No hay verdicts que reportar.

## Architecture Patterns

### System Architecture Diagram

```
  kodo up (Phase 66)          launchd / brew services (Phase 66)
        │ spawn detached+unref        │ exec directo (foreground)
        ▼                             ▼
   ┌─────────────────────── kodo daemon run  (Phase 65: src/daemon/run.js) ────────────────┐
   │  0. install SIGTERM/SIGINT handlers FIRST (mutable outer vars; precedente cli.js:146)  │
   │  1. config = loadConfig()                                                              │
   │  2. { server, stopReconcile } = await startServer({ managed:true })  ── server.js      │
   │        managed gatea: no exit(:407) · no self-PID(:581) · .on('error')(:576) · no      │
   │        self SIGTERM/exit(:612-618)                                                      │
   │  3. polling = providerUsesPolling(config)                                              │
   │        ? startPolling({provider,repos,intervalSec,logger})  ── triggers/polling.js:478 │
   │        : null                              (github→sí · plane webhook→no)               │
   │  4. writePidFile('kodo', {pid, started_at, kind:'daemon'})  ── ~/.kodo/kodo.pid (0600)  │
   │  5. cleanup = () => { polling?.stop(); stopReconcile(); server.close();                 │
   │                       removePidFile('kodo'); process.exit(0) }   ← único dueño del exit │
   │  6. await new Promise(() => {})   // block forever                                      │
   └────────────────────────────────────────────────────────────────────────────────────────┘
        │ reusa
        ▼
   src/daemon/lifecycle.js  (startDaemon/stopDaemon/statusDaemon — templado en polling.js;
                             consumidor real = Phase 66; entregado aquí)

  LEGACY (INTACTO, managed:false default):
   kodo start ── startServer() ── escribe server.pid(:581) · process.exit(1) misconfig(:407)
                                  · self SIGTERM→exit(0)+unlink(:612-618)
```

### Recommended Project Structure
```
src/
├── daemon/            # NUEVO
│   ├── lifecycle.js   # startDaemon/stopDaemon/statusDaemon genéricos (templado polling.js)
│   └── run.js         # runDaemon(): compose server+polling, kodo.pid, SIGTERM, block-forever
├── cli/
│   └── polling-daemon.js  # MODIFICADO (aditivo): getPidPath(name='polling'), payload.kind
├── server.js          # MODIFICADO: startServer({managed}) — 4 puntos gateados + handle
└── cli.js             # MODIFICADO: grupo `daemon` + `daemon run` (hidden)
```
(Ubicación de `providerUsesPolling` y del módulo PID a discreción — D-04/D-06.)

### Pattern 1: Cuatro puntos gateados en `startServer(managed)` (la pieza de mayor riesgo)
**What:** `managed` opt-in default-`false`; cada punto se gatea con `if (!opts.managed)` para que el legacy quede byte-idéntico.
**When:** siempre que `run.js` arranque el server; nunca para `kodo start`.
**Los 4 puntos exactos (verificados):**
```js
// src/server.js — startServer(opts = {})  (:361)
//   opts hoy = { port, insecure }; añadir `managed` (+ DI opcional _loadConfig/_provider).

// (1) misconfig del webhook secret — HOY:
if (!webhookSecret && !opts.insecure && !process.env.KODO_DEV) {
  console.error(...);
  process.exit(1);                       // server.js:407  ← bajo managed: throw error discriminado
}
// → managed: `throw Object.assign(new Error('missing webhook secret'), { code: 'KODO_SETUP_REQUIRED' })`
//   run.js hace try/catch y decide (Phase 65: log+exit limpio; Phase 68: sirve setup mode).

// (2) 'error' handler — HOY server.listen SIN handler (:576):
server.listen(port, () => { ...; writeFileSync(PID_PATH, String(process.pid)); ... }); // :576-587
// → managed: registrar ANTES de listen →
//   server.on('error', (err) => { if (err.code === 'EADDRINUSE') reject/throw typed; else ... });
//   Envolver listen en Promise que resuelve en 'listening', rechaza en 'error'.

// (3) self-PID — HOY dentro del listen callback (:581):
writeFileSync(PID_PATH, String(process.pid));   // server.js:581  ← managed: SKIP (daemon dueña kodo.pid)

// (4) self-cleanup / dueño del exit — HOY (:612-618):
const cleanup = () => { try{stopReconcile()}catch{}; try{unlinkSync(PID_PATH)}catch{}; process.exit(0); };
process.on('SIGTERM', cleanup); process.on('SIGINT', cleanup);   // server.js:612-618
// → managed: NO instalar estos handlers ni el process.exit. Devolver { server, stopReconcile }
//   para que run.js componga el teardown (D-05: un único dueño del exit).
```
**Retorno managed:** `{ server, stopReconcile }` (server ya es `http.Server` con `.close()`; `stopReconcile` viene de server.js:605). Legacy sigue devolviendo `server` (server.js:620) sin cambios.
**Source:** `[VERIFIED: src/server.js:361,405-408,576-587,605,612-620]`

### Pattern 2: Foreground funnel con handlers-primero + outer mutable vars
**What:** instalar SIGTERM/SIGINT ANTES del `await startServer` async, referenciando vars mutables (`let server=null; let polling=null`) — igual que `kodo orchestrate --polling` instala `cleanup` con `let pollingHandle=null` antes del setup async (cli.js:139-159), idempotente si la señal llega temprano.
**When:** en `run.js`.
**Precedent:** `[VERIFIED: src/cli.js:139-200]` (W-5 LOCKED orden estricto: handlers → setup → block-forever `await new Promise(() => {})` :192).
**Molde del block-forever + cleanup:** `runForegroundPolling` polling.js:380-391 (`process.on(SIGINT/SIGTERM, cleanup)` → `handle.stop()` + `removePidFile()` + `process.exit(0)` → `await new Promise(()=>{})`). `run.js` es la misma forma pero compone **dos** handles (server + polling) `[VERIFIED: src/cli/polling.js:350-392]`.

### Pattern 3: PID module name-parametrizado (aditivo, back-compat)
**What:** `getPidPath(name = 'polling')`, `writePidFile(name, payload)`, `readPidFile(name)`, `removePidFile(name)`. Default `'polling'` preserva a los callers actuales (polling.js importa las 4). El daemon pasa `'kodo'`.
**Shape:** el `readPidFile` defensivo solo valida `pid:number` + `started_at:string` (polling-daemon.js:100) — un payload daemon `{pid, started_at, kind:'daemon'}` (SIN `repos`) pasa sin romper el shape-check. `[VERIFIED: src/cli/polling-daemon.js:95-105]`
**Atomic + 0600:** `writeFileSync(tmp)` → `chmodSync(tmp, 0o600)` PRE-rename → `renameSync(tmp, path)` (polling-daemon.js:76-83). `writeFileAtomic` de config.js NO hace chmod (config.js:99-103) — por eso NO se reusa para el PID `[VERIFIED: src/config.js:99-103, src/cli/polling-daemon.js:76-83]`.

### Pattern 4: `providerUsesPolling(config)` — pure function
**What:** `providerUsesPolling(config) => config.provider === 'github'`. GitHub usa polling (repos + `poll_interval`, config.js:253-261); Plane usa webhook (server ingress, server.js `/webhook` :556). Registry solo registra estos 2 providers (registry.js:22-78) `[VERIFIED: src/providers/registry.js:22-78, src/config.js:253-261]`.
**Never-throws / fail-safe:** ante `config` malformado devolver `false` (no arrancar polling es el fallo seguro — el server sigue sirviendo).

### Anti-Patterns to Avoid
- **Copiar el patrón naive de server.js para el PID** (`writeFileSync(PID_PATH, String(pid))` :581, sin atomic/chmod/stale-check). Usar el de polling-daemon.js. `[CITED: PITFALLS.md Pitfall 1]`
- **Dos dueños del proceso** (server instala su SIGTERM+exit Y run.js instala el suyo). Bajo managed, server NO instala handlers; run.js es el único. `[CITED: PITFALLS.md Pitfall 4]`
- **`server.listen(port)` sin `'error'` handler bajo el daemon** → EADDRINUSE = excepción no capturada → el hijo muere pero el padre puede haber visto un PID transitorio. `[CITED: PITFALLS.md Pitfall 3]`
- **`daemon run` que se auto-desvincula.** El foreground DEBE bloquear (no `spawn`/`unref`) para que launchd lo supervise. El detach es responsabilidad exclusiva de `kodo up` (Phase 66). `[CITED: PITFALLS.md Pitfall 6]`
- **Regresionar `kodo start`** moviendo el `server.pid`/exit sin gate. `managed` default-`false` blinda el legacy (UP-06).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Escritura atómica de PID con 0600 | `writeFileSync` plano + `chmod` post-hoc | patrón polling-daemon.js:76-83 (chmod PRE-rename) | Un lector concurrente post-rename ve 0600 inmediato; sin ventana 0644. `[VERIFIED]` |
| Liveness de PID | `existsSync(pidPath)` | `isPidAlive(pid)` (lock.js:67) | Stale PID tras SIGKILL = false-positive "already running" permanente. `[CITED: PITFALLS.md Pitfall 2]` |
| Polling en proceso separado | `spawn` de un polling child | `startPolling()` in-process (timer loop, retorna `{stop}`) | Ya es un timer in-process; separarlo = doble PID + orphans. `[VERIFIED: src/triggers/polling.js:478]` |
| Path del PID resiliente a HOME | cachear `KODO_DIR` | `getPidPath()` lazy vía `homedir()` | HOME-cache es fuga de aislamiento conocida (obs. 21811/22683); lazy permite tests HOME-isolated. `[VERIFIED: src/cli/polling-daemon.js:51-53]` |
| Detach spawn (Phase 66) | fresh spawn | `spawn(process.execPath, [KODO_BIN,'daemon','run'], {detached, stdio:['ignore',fd,fd]})` + `unref()` | 6 mitigaciones ya resueltas en polling.js:286-303. `[VERIFIED]` |

**Key insight:** kodo ya contiene un patrón daemon *maduro* (`polling.js`/`polling-daemon.js`) y uno *naive* (`server.js`). El único trabajo correcto es generalizar el maduro y NO promover el naive.

## Runtime State Inventory

> Refactor phase — mostly N/A (código nuevo + refactor gateado, sin rename de strings ni migración de datos). Se documenta explícitamente por categoría.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — no se renombra ninguna clave/colección; el daemon no migra datos existentes. `state.json`/`config.json`/`.env` intactos. | Ninguna |
| Live service config | **None** — no toca n8n/launchd en Phase 65 (launchd es Phase 66). | Ninguna |
| OS-registered state | **Nuevo** `~/.kodo/kodo.pid` (JSON, 0600) creado en runtime por el daemon. **Coexiste** con `server.pid` (server.js:13) y `polling.pid` (polling-daemon.js:52) legacy — los tres son distintos por diseño (D-04). Ningún PID legacy cambia de path ni de shape. | Ninguna migración; solo un archivo nuevo |
| Secrets/env vars | **None** — Phase 65 no escribe `.env` (eso es Phase 67). El check de `KODO_WEBHOOK_SECRET_*`/`PLANE_WEBHOOK_SECRET` (server.js:398-403) se lee igual; managed solo cambia la reacción al *ausente* (throw vs exit). | Ninguna |
| Build artifacts | **None** — sin cambios de `package.json`/bin; `bin/kodo` sin cambios. | Ninguna |

**Verificado:** `~/.kodo/kodo.pid` es el único estado runtime nuevo; no hay split-brain con `server.pid`/`polling.pid` porque son paths distintos y el legacy `kodo start`/`polling start` mantiene su propiedad.

## Common Pitfalls

### Pitfall 1: El refactor managed regresiona `kodo start` (UP-06)
**What goes wrong:** al mover el `server.pid`/exit/handlers, el path legacy deja de escribir `server.pid` o deja de salir con exit 1 en misconfig.
**Why:** el gate `if (!opts.managed)` se olvida en uno de los 4 puntos, o `managed` no default-`false`.
**How to avoid:** cada uno de los 4 puntos (`:407`, `:576`, `:581`, `:612-618`) va detrás de `if (!opts.managed)`; `managed` es `undefined`/falsy por default. Assertion de non-regresión: `startServer()` sin `managed` sigue escribiendo `server.pid` y `kodo start` sin secret sigue exit 1 (ver Validation).
**Warning signs:** `kodo start` no crea `server.pid`; `kodo stop` legacy no encuentra el PID; `kodo start` sin secret ya no sale con 1.
`[CITED: SUMMARY.md pitfall 4, CONTEXT.md D-03]`

### Pitfall 2: `process.exit` dentro del test runner (managed EADDRINUSE/misconfig no testeable)
**What goes wrong:** intentar unit-testear el path misconfig con el legacy `process.exit(1)` mata el proceso `node --test`.
**Why:** `process.exit(1)` (server.js:407) es no-testeable por diseño; ES la razón por la que managed existe.
**How to avoid:** el test del path managed asume que managed **lanza un error discriminado** (no `process.exit`) — assertable con `assert.rejects`. El legacy exit-1 se prueba a nivel integración con `spawnSync` (asserta exit code), no in-process.
**Warning signs:** la suite entera aborta a mitad; "Test run aborted".

### Pitfall 3: `startServer` no es DI-friendly para provider → el unit test del managed pega a la red
**What goes wrong:** `startServer` hace `initRegistry()` + `getProvider(config.provider)` + `provider.init()` (server.js:365-367) ANTES del listen; un unit test de EADDRINUSE/managed dispara `provider.init()` real (Plane → posible red).
**Why:** hoy no hay seam de inyección de provider/config en `startServer`.
**How to avoid:** añadir DI opcional `startServer({ managed, _loadConfig, _provider })` (mirror `isReportToProviderEnabled(_loadConfig)` config.js:233 y el resolver DI de server.js:380). Producción usa los defaults. Alternativa si se quiere cero-DI: probar EADDRINUSE a nivel integración (bind puerto con `net.createServer`, spawn child `daemon run`, assert que no queda vivo). **Recomendado: DI ligero — mantiene el test unit + respeta convención DI del repo.**
**Warning signs:** unit test lento/flaky; fallos de red en CI; el test toca el `~/.kodo` real (falta HOME-isolation).

### Pitfall 4: `provider.init()` throw bajo managed no manejado
**What goes wrong:** `provider.init()` (server.js:367) puede lanzar en first-run (sin key); bajo managed eso rechaza la promise de `startServer` y, sin try/catch en `run.js`, crashea el daemon.
**Why:** el 5º punto implícito — la inicialización del provider — está fuera del D-03 estricto (el setup-mode que lo difiere es Phase 68), pero `run.js` debe envolver `startServer` en try/catch para surface limpio.
**How to avoid:** `run.js` hace `try { ...startServer } catch (e) { log; cleanup; exit }`. La deferral real de `provider.init` (setup mode) es Phase 68; Phase 65 solo garantiza que el throw no es un crash no capturado.
`[CITED: PITFALLS.md Pitfall 12 — el chicken-and-egg completo es Phase 68]`

## Code Examples

### `run.js` (sketch — compose + conditional polling + single-owner teardown)
```js
// src/daemon/run.js  (NUEVO)  — mirror runForegroundPolling (polling.js:350-392)
export async function runDaemon() {
  let server = null, stopReconcile = null, polling = null; // outer mutable (cli.js:139 precedent)
  const cleanup = () => {
    try { polling?.stop(); } catch {}
    try { stopReconcile?.(); } catch {}
    try { server?.close(); } catch {}
    removePidFile('kodo');
    process.exit(0);
  };
  process.on('SIGTERM', cleanup);              // handlers FIRST (before async)
  process.on('SIGINT', cleanup);

  const config = loadConfig();
  try {
    ({ server, stopReconcile } = await startServer({ managed: true }));
  } catch (e) { console.error(`[kodo] daemon start failed: ${e.message}`); cleanup(); return; }

  if (providerUsesPolling(config)) {
    const { initRegistry, getProvider } = await import('../providers/registry.js');
    const { startPolling } = await import('../triggers/polling.js');
    await initRegistry();
    polling = startPolling({
      provider: getProvider(config.provider),
      repos: config.providers.github.repos,
      intervalSec: config.providers.github.poll_interval || 60,
      logger,
    });
  }
  writePidFile('kodo', { pid: process.pid, started_at: new Date().toISOString(), kind: 'daemon' });
  await new Promise(() => {});   // block forever — cleanup() drains via exit
}
// Source pattern: [VERIFIED: src/cli/polling.js:350-392, src/cli.js:139-200]
```

### `kodo daemon run` wiring (cli.js — mirror `polling` group)
```js
// src/cli.js  — mirror the `polling` group (cli.js:443)
const daemon = program.command('daemon').description('Internal daemon lifecycle');
daemon
  .command('run', { hidden: true })   // commander 13.1: hidden via opts object [VERIFIED]
  .description('Run the composed daemon (server + polling) in the foreground')
  .action(async () => {
    const { runDaemon } = await import('./daemon/run.js');
    await runDaemon();               // blocks forever; no process.exit here
  });
// Source: [VERIFIED: src/cli.js:443-497 polling group shape; commander@13.1.0 hidden option]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| server.js PID plano `writeFileSync(PID_PATH, String(pid))` | polling-daemon.js atomic tmp+rename + chmod 0600 | Phase 26/28 (v0.7/v0.8) | El daemon nuevo usa el patrón maduro; el naive queda solo en el legacy `kodo start` |
| `server.listen(port, cb)` sin `'error'` handler | managed añade `server.on('error')` para EADDRINUSE | Phase 65 (esta) | Solo bajo managed; legacy sin cambios |
| Un dueño del proceso por subsistema (server, polling separados) | Un daemon compuesto, un PID, un teardown | Phase 65 (esta) | `run.js` único dueño del exit (D-05) |

**Deprecated/outdated:** ninguno en esta fase — el legacy (`kodo start`, `polling start`, `server.pid`, `polling.pid`) se mantiene intacto en v0.15 por diseño.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `providerUsesPolling` = `config.provider === 'github'` (allowlist de los 2 providers registrados) | Pattern 4 | Bajo — si aparece un 3er provider polling-based, hay que extender el allowlist; fail-safe es `false` (no polling, server sigue). Discreción D-06. |
| A2 | El error discriminado managed usa un `code` string (p.ej. `KODO_SETUP_REQUIRED`/`EADDRINUSE`) | Pattern 1 | Bajo — la forma exacta es discreción D-03; el planner la fija. Mientras sea un throw (no `process.exit`) el seam funciona. |
| A3 | `startServer` managed devuelve `{ server, stopReconcile }` | Pattern 1 / Alternatives | Bajo — discreción D-03 (cómo retorna el handle). Cualquier forma que exponga `close()` + `stopReconcile` sirve para el teardown D-05. |
| A4 | El seam DI `_loadConfig`/`_provider` en `startServer` es aceptable (para unit-testear managed sin red) | Pitfall 3 | Medio — si el planner prefiere cero-DI, el test de EADDRINUSE/managed baja a integración (spawn child). Ambos caminos documentados. |

**Nota:** ninguna assumption toca compliance/seguridad/retención — son puntos de diseño ya marcados como discreción en CONTEXT.md D-03/D-06.

## Open Questions

1. **¿El error managed de misconfig hace que `run.js` salga (Phase 65) o sirva setup-mode (Phase 68)?**
   - What we know: Phase 65 solo debe garantizar que NO hay `process.exit` dentro de server.js y que `run.js` maneja el throw limpio.
   - What's unclear: el comportamiento "quedarse vivo sirviendo el dashboard sin config" es Phase 68.
   - Recommendation: Phase 65 = `run.js` loguea + cleanup + exit limpio ante el throw. NO implementar setup-mode aquí (fuera de scope, deferred a Phase 68).

2. **¿El módulo PID se extrae a `src/daemon/` o se generaliza in-place en `polling-daemon.js`?**
   - What we know: ambos funcionan; in-place con default `name='polling'` es back-compat.
   - Recommendation: in-place aditivo (menor churn en módulo testeado); ambos consumidores importan de ahí. Discreción D-04.

## Environment Availability

> Sin dependencias externas de runtime nuevas — fase de código/refactor sobre built-ins de Node. Sección mínima.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | todo | ✓ | ≥20 (engines) | — `[VERIFIED: package.json engines]` |
| `node:test` | validación | ✓ | built-in | — |
| commander | wiring `daemon run` | ✓ | 13.1.0 (dep) | — |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** ninguna.

## Validation Architecture

> Nyquist habilitado (`.planning/config.json` `workflow.nyquist_validation: true`) — sección REQUERIDA.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node ≥20) + `node:assert/strict` |
| Config file | none — `package.json` `"test": "node --test $(find test -name '*.test.js' -type f)"` `[VERIFIED]` |
| Quick run command | `node --test test/daemon/ test/server-managed.test.js` (unit del scope de la fase) |
| Full suite command | `npm test` |
| TUI harness | **N/A para Phase 65** — no hay superficie ink/render; `ink-testing-library` no aplica aquí (es para Phases 67-68). |
| HOME isolation | `mkdtempSync` + `process.env.HOME` + dynamic `import(...?cachebust)` DESPUÉS de fijar HOME (mirror polling-daemon.test.js:38-52 y la nota de stop.test.js:8-13) `[VERIFIED]` |
| Child-process integration | `node:child_process` `spawn`/`spawnSync` con `KODO_BIN` absoluto + HOME-isolated (mirror polling.test.js:12-27) `[VERIFIED]` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| UP-04 | `daemon run` bloquea foreground (no auto-exit) y limpia ante SIGTERM (para+borra kodo.pid, exit 0) | integration (spawn child + SIGTERM) | `node --test test/daemon/daemon-run-integration.test.js` | ❌ Wave 0 |
| UP-04 | managed EADDRINUSE surface error discriminado SIN `process.exit` (no mata el runner) | unit (`assert.rejects`) | `node --test test/server-managed.test.js` | ❌ Wave 0 |
| UP-04 | managed misconfig (sin webhook secret) lanza error tipado, proceso sigue vivo | unit | `node --test test/server-managed.test.js` | ❌ Wave 0 |
| UP-04 | managed NO escribe `server.pid` y NO instala self-SIGTERM/exit | unit (HOME-isolated: assert `server.pid` ausente) | `node --test test/server-managed.test.js` | ❌ Wave 0 |
| UP-04 | `writePidFile('kodo')` atómico + 0600 en `~/.kodo/kodo.pid`, distinto de `server.pid`/`polling.pid` | unit (`statSync` mode) | `node --test test/daemon/pid-name-param.test.js` | ❌ Wave 0 (extiende polling-daemon.test.js) |
| UP-04 | `getPidPath('kodo')`→`.../kodo.pid`; `getPidPath()` default→`.../polling.pid` (back-compat) | unit | `node --test test/daemon/pid-name-param.test.js` | ❌ Wave 0 |
| UP-04 | `providerUsesPolling({provider:'github'})→true`, `{provider:'plane'}→false`, malformado→false | unit (pure) | `node --test test/daemon/provider-uses-polling.test.js` | ❌ Wave 0 |
| UP-04 | `run.js` arranca polling SOLO si `providerUsesPolling`; SIGTERM para server+polling y borra kodo.pid | unit (DI: fake startServer/startPolling/config) | `node --test test/daemon/run.test.js` | ❌ Wave 0 |
| UP-04 | `lifecycle.js` start/stop/status genérico (stop: SIGTERM→5s→SIGKILL; status: running/idle) | unit (DI, mirror polling.test) | `node --test test/daemon/lifecycle.test.js` | ❌ Wave 0 |
| UP-06 | `kodo start` (managed:false) SIGUE escribiendo `server.pid` y sirviendo (golden) | unit (HOME-isolated, `startServer({insecure,port})` → assert `server.pid` presente → `server.close()`) | `node --test test/cli/kodo-start-regression.test.js` | ❌ Wave 0 |
| UP-06 | `kodo start` sin webhook secret SIGUE saliendo con exit 1 (fail-fast legacy intacto) | integration (`spawnSync bin/kodo start`, HOME-isolated, sin `--insecure`/`KODO_DEV`) | `node --test test/cli/kodo-start-regression.test.js` | ❌ Wave 0 |
| UP-06 | `kodo start` (managed:false) NO escribe `kodo.pid` (aislamiento del PID nuevo) | unit | `node --test test/cli/kodo-start-regression.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/daemon/ test/server-managed.test.js test/cli/kodo-start-regression.test.js` (unit rápido, < 30s; excluye el integration child-spawn si es lento).
- **Per wave merge:** `npm test` (suite completa — incluye no-regresión de `polling.test.js`/`stop.test.js` que comparten los primitivos PID/HOME).
- **Phase gate:** `npm test` verde + `test/daemon/daemon-run-integration.test.js` (child-spawn + SIGTERM) verde antes de `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/daemon/run.test.js` — DI unit de `runDaemon`: compose condicional + teardown single-owner (UP-04).
- [ ] `test/daemon/lifecycle.test.js` — start/stop/status genérico (UP-04; consumidor real Phase 66 pero se entrega aquí).
- [ ] `test/daemon/pid-name-param.test.js` — `getPidPath(name)` + `writePidFile('kodo')` 0600 + distinción de paths (UP-04). Puede extender `test/cli/polling-daemon.test.js`.
- [ ] `test/daemon/provider-uses-polling.test.js` — pure function (UP-04).
- [ ] `test/server-managed.test.js` — 4 puntos gateados: no-exit (throw tipado), 'error'/EADDRINUSE, no-self-PID, no-self-SIGTERM (UP-04). Requiere HOME-isolation + (recomendado) seam DI `_loadConfig`/`_provider` para evitar red en `provider.init`.
- [ ] `test/cli/kodo-start-regression.test.js` — golden UP-06: `server.pid` presente, exit-1 sin secret, `kodo.pid` ausente en legacy.
- [ ] `test/daemon/daemon-run-integration.test.js` — process-level: `spawn bin/kodo daemon run` HOME-isolated (con `KODO_DEV=1` o secret export para pasar el gate), poll hasta `kodo.pid` escrito, assert child vivo tras N ms (foreground bloquea), `kill(child,'SIGTERM')`, assert exit 0 ≤5s + `kodo.pid` borrado (UP-04).
- [ ] Fixtures/helpers: reusar el patrón `mkdtempSync`+HOME de `test/cli/polling-daemon.test.js`; no hace falta framework nuevo.

**Nota de testabilidad (load-bearing):** el valor Nyquist central de esta fase es que **managed mode convierte en unit-testeable lo que hoy no lo es** — el `process.exit(1)` legacy (server.js:407) mata el runner, así que solo se puede probar por integración/exit-code; managed lanza un error → `assert.rejects`. Documentar esto en los tests para que el verifier entienda por qué UP-04 (managed) es unit y UP-06 (legacy exit) es integration.

## Security Domain

> `security_enforcement` ausente en `.planning/config.json` (= habilitado). Fase de plumbing interno sin nueva superficie de red/auth; sección acotada a lo aplicable.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (sin auth nueva; el webhook secret check existe, no cambia su valor) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | parcial | `readPidFile` defensive shape-check ya valida `pid:number`/`started_at:string` (polling-daemon.js:100) — reusado sin cambios `[VERIFIED]` |
| V6 Cryptography | no | — (sin secretos escritos en esta fase; `.env` es Phase 67) |
| V14 Config/File perms | **yes** | PID file `chmod 0o600` PRE-rename (polling-daemon.js:81); el `kodo.pid` hereda el mismo control `[VERIFIED]` |

### Known Threat Patterns for {daemon lifecycle}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Stale PID → `kodo stop` mata PID reusado (proceso ajeno) | Denial of Service / Elevation | `isPidAlive` + `started_at` en el payload (cross-check de reuso) `[CITED: PITFALLS.md Pitfall 2]` |
| PID file world-readable (0644) filtra metadata token-adjacent | Information Disclosure | `chmodSync(tmp, 0o600)` PRE-rename `[VERIFIED: polling-daemon.js:81]` |
| Detach spawn con PATH lookup (EOP) | Elevation of Privilege | `process.execPath` + `KODO_BIN` absoluto, argv array form (sin shell) — heredado de polling.js:283-302 (relevante en Phase 66 detach) `[VERIFIED]` |
| Windows: `detached`/SIGTERM/0600 no-POSIX | — | Guardia refuse-with-guidance (polling.js:236-240) replicada en el path detach del daemon (detach es Phase 66; Phase 65 foreground es cross-platform) `[CITED: PITFALLS.md Pitfall 17]` |

## Sources

### Primary (HIGH confidence — direct codebase reads, 2026-07-02)
- `src/cli/polling.js` — patrón daemon canónico: detach spawn :286-302, `unref` :303, pre-flight `isPidAlive` :260-268, bounded wait :315-323, `runForegroundPolling` block-forever :350-392, Windows guard :236-240.
- `src/cli/polling-daemon.js` — PID atómico + `chmod 0600` pre-rename :76-83, lazy `getPidPath` :51-53, defensive shape :95-105.
- `src/server.js` — `startServer` :361, provider.init :367, misconfig `process.exit(1)` :405-408, `server.listen` sin error handler :576-587, self-PID `writeFileSync` :581, self SIGTERM/exit cleanup :612-618, retorno `server` :620, `stopServer` :626, `PID_PATH=server.pid` :13.
- `src/config.js` — `writeFileAtomic` (sin chmod) :99-103, `KODO_DIR` :6, `getDefaultGithubProviderConfig` (repos/poll_interval) :253-261, `isReportToProviderEnabled(_loadConfig)` DI precedent :233.
- `src/gsd/lock.js` — `isPidAlive` :67-74.
- `src/triggers/polling.js` — `startPolling` :478, handle `{stop}` :570-575.
- `src/cli.js` — `start`/`stop` wiring :66-84, `orchestrate --polling` handlers-first precedent :139-200, `polling` group :443-497.
- `src/providers/registry.js` — solo `plane`+`github` registrados :22-78.
- `test/cli/polling-daemon.test.js`, `test/cli/polling.test.js`, `test/stop.test.js`, `test/config-atomic.test.js` — patrones de HOME-isolation + spawnSync + DI puro.
- `package.json` — `test` script (node --test), engines ≥20, deps (cero nuevas).

### Secondary (MEDIUM confidence — milestone research, 2026-07-01)
- `.planning/research/ARCHITECTURE.md` — reuse map polling.js→daemon (file:line), Patterns 1-4, build order.
- `.planning/research/PITFALLS.md` — Pitfalls 1-5,12,17,18 (daemon lifecycle scope).
- `.planning/research/SUMMARY.md` — Phase 65 delivers/avoids; risk-graded ordering.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps, todo built-in/in-repo verificado por file:line.
- Architecture (managed refactor surface): HIGH — 4 puntos gateados leídos directamente en server.js; el 4º (self-cleanup :612-618) es un hallazgo que extiende los 3 del D-03.
- Pitfalls: HIGH — verificados contra source + milestone research.
- Validation: HIGH — framework y patrones de test (HOME-isolation, spawnSync, DI) verificados en tests existentes; la única incertidumbre es el seam DI en `startServer` (A4, discreción del planner).

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (stable — codebase interno, sin deps externas de movimiento rápido).
