# Project Research Summary

**Project:** kodo v0.15 "kodo up"
**Domain:** Node.js CLI — unified daemon entrypoint + Homebrew/launchd distribution + dashboard-first onboarding con entrada enmascarada de secretos
**Researched:** 2026-07-01
**Confidence:** HIGH

## Executive Summary

v0.15 se construye en dos pilares con dependencia estricta: **Pilar 1** (lifecycle + brew, shippable solo) y **Pilar 2** (onboarding dashboard-first, requiere Pilar 1). La investigación confirma que *no se necesitan nuevas dependencias npm*: todo el nuevo comportamiento se construye sobre primitivas ya enviadas en `src/cli/polling.js` + `src/cli/polling-daemon.js`, el texto enmascarado extiende el input existente de Phase 63, y Homebrew se distribuye vía tap (no homebrew-core). El milestone entrega un único comando `kodo up` que arranca el daemon (server + polling compuestos en un proceso) y adjunta el dashboard como viewer desacoplado — si el daemon ya corre, lo adjunta en lugar de hacer doble spawn.

La decisión de arquitectura más cargada es la **"doble-modo del daemon"**: `kodo up` sin flags se auto-desvincula (spawn detached + unref, patrón verbatim de polling.js), pero el mismo daemon debe poder correr en modo foreground (`kodo daemon run`) para que launchd lo supervise. Si el plist de brew services invoca `kodo up` en lugar de `kodo daemon run`, launchd ve al proceso padre salir inmediatamente y entra en un bucle de reinicios cada 10 s. Este es el único pitfall que puede hacer irreversible un `brew install kodo` para un usuario nuevo.

Los tres vectores de riesgo accionables son: (1) la refactorización de `startServer` a modo managed (ningún `process.exit`, ningún PID propio bajo el daemon — la integración de mayor riesgo y por eso va primera), (2) la garantía de que el valor del API key nunca cruza a `config.json`/`/status`/logs (PERSIST-04, requiere un single sink `writeEnvVar` + chmod 0600 pre-rename + grep test de higiene), y (3) que el primer arranque en máquina sin config sirva el dashboard en setup mode en lugar de salir con exit 1 (el chicken-and-egg de onboarding que conecta Pilar 1 con Pilar 2).

---

## Key Findings

### Recommended Stack

Zero nuevas dependencias npm. El stack en runtime permanece idéntico a v0.14: commander, ink, react, picocolors. La única pieza genuinamente "nueva" es el archivo `Formula/kodo.rb` (Ruby DSL de Homebrew), que vive en un tap repo separado y no es una dependencia de kodo. Los primitivos de Node que se añaden son built-ins estables (≥20): `node:net` para la detección de puerto-en-uso (la sonda ECONNREFUSED, ~10 líneas, substituye a cualquier npm pkg), y `node:child_process` para el spawn detached que ya usa polling.js verbatim.

**Core technologies:**
- `node:net` (built-in): port-in-use detection para idempotencia de `kodo up` — cero deps, determinista
- `node:child_process` spawn+detached+unref (built-in): auto-desvinculación del daemon — patrón verbatim de polling.js líneas 286-302
- PID-file trio de `polling-daemon.js`: generalizado con parámetro `name` para `~/.kodo/kodo.pid` distinto de `server.pid`
- Homebrew `service do` DSL (≥4.x): genera el launchd plist; nunca escribir raw XML; `depends_on "node"` (no bundlear runtime)
- In-house ink text-input (Phase 63): extendido con render mask `•` — no añadir ink-text-input como dep

**Lo que NO se usa:** pm2/forever/nodemon, detect-port/get-port, ink-text-input/ink-password-input, def plist (legacy Homebrew), secretos en plist environment_variables, reutizar server.pid para el daemon up, nuevos endpoints en server.js.

### Expected Features

**Must have — Pilar 1 (tabla stakes, shippable sin Pilar 2):**
- `kodo up`: arranca daemon (server + polling compuestos) + adjunta dashboard como viewer; idempotente (attach-if-running)
- Daemon dual-mode: self-detach para `kodo up` bare; foreground-supervised (`kodo daemon run`) para launchd/brew
- `kodo stop` / `kodo status` unificados: daemon completo, salida idempotente, exit codes deterministas + `--json`
- Dashboard-as-viewer: cerrar con q/Ctrl-C deja el daemon corriendo (LOCKED persistent-daemon model)
- Homebrew formula (`brew install kodo`, `depends_on node ≥20`) + `brew services start kodo` (launchd plist)
- Windows: foreground fallback documentado (misma guardia que polling.js)

**Must have — Pilar 2 (onboarding, requiere Pilar 1):**
- Dashboard setup mode en primer arranque (sin config → pantalla guiada, no crash)
- CFGF-03: editar provider/base_url/workspace_slug desde el dashboard → config.json
- Campo API key enmascarado (`•` por char, toggle reveal, soporte paste) → nuevo `writeEnvVar` → `~/.kodo/.env`
- Indicador "ya configurado" sin revelar el valor (`[configurado]`, prueba de presencia, nunca el valor)
- Aviso de reinicio tras cambio de provider/key (sin hot-reload, consistente con v0.14)
- `kodo config` (wizard readline) rewired al mismo writer único

**Defer (v2+):**
- Hot-reload de config en el daemon corriendo
- Gestión de secretos genérica (múltiples keys, vault, rotación)
- Gestor de procesos genérico (múltiples servicios, dependency graph)
- Ctrl-C en el terminal mata el daemon (semántica docker compose up foreground) — explícitamente rechazado

**Anti-features confirmadas (no implementar):**
- No auto-daemonize bajo launchd
- No hot-reload
- No compose-style Ctrl-C-kills-daemon
- No nuevos endpoints en server.js
- No key round-trip (leer el valor de vuelta al render)

### Architecture Approach

La arquitectura centraliza el lifecycle en un nuevo directorio `src/daemon/` con dos módulos: `lifecycle.js` (fontanería genérica: startDaemon/stopDaemon/statusDaemon, templada en polling.js) y `run.js` (el único foreground funnel: compone startServer(managed) + startPolling condicional, escribe `~/.kodo/kodo.pid`, bloquea forever con `await new Promise(()=>{})`). El dashboard (`runDashboard`) no cambia — es un cliente HTTP puro de `/status` sin estado propio. Los secretos tienen un único sink nuevo: `writeEnvVar` en `config.js` (atómico + chmod 0600 pre-rename, espejo de polling-daemon.js). La integración de mayor riesgo es la refactorización de `startServer` a modo managed: eliminar su `process.exit(1)` (server.js:405-408) y su escritura de PID (server.js:581) cuando corre bajo el daemon — se hace primero para que todo lo demás se construya sobre una base estable.

**Major components:**
1. `src/daemon/lifecycle.js` (NUEVO) — startDaemon/stopDaemon/statusDaemon genéricos, templados en polling.js:212-564
2. `src/daemon/run.js` (NUEVO) — foreground entrypoint único; compone startServer(managed)+startPolling, escribe kodo.pid, SIGTERM cleanup, block-forever
3. `src/cli/up.js` (NUEVO) — runUp(): setup-if-first-run → ensure-daemon → wait /health → runDashboard → exit (daemon persiste)
4. `src/server.js` startServer managed mode (MODIFICADO) — no process.exit, no self-PID; retorna handle closeable; legacy `kodo start` sin cambios
5. `src/config.js` writeEnvVar (MODIFICADO, aditivo) — único writer de secretos: tmp+rename+chmod 0600, parse-merge-write para no clobber otras keys
6. `src/cli/dashboard/` setup mode (MODIFICADO) — CFGF-03 + masked input extendiendo Phase 63 text-input; onSaveApiKey DI prop
7. Homebrew tap `Formula/kodo.rb` (NUEVO, repo separado) — `service do { run [opt_bin/"kodo", "daemon", "run"]; keep_alive true; log_path/error_log_path }`

### Critical Pitfalls

1. **Launchd foreground trap (Pitfall 6)** — el plist DEBE invocar `kodo daemon run` (foreground), NO `kodo up` (self-detach). Si `kodo up` corre bajo launchd+KeepAlive, el padre sale inmediatamente → crash-loop cada 10 s. Requiere spike de install real en macOS (no unit-testable).

2. **Secret leak PERSIST-04 (Pitfall 11)** — el API key puede filtrarse por 5 vectores: argv de subprocess (ps-visible), NDJSON logs, `/status` JSON, `config.json.bak`, y scrollback del TUI. Prevención: `writeEnvVar` en-proceso (nunca vía execFile argv), key exclusivamente en `~/.kodo/.env`, render `•`, grep test de higiene fuente.

3. **First-run chicken-and-egg (Pitfall 12)** — `server.js:405-408` hace `process.exit(1)` cuando falta el webhook secret; el daemon muere antes de que el dashboard pueda mostrar el setup mode. Prevención: managed mode no hace `process.exit`; el daemon arranca en setup state sirviendo el dashboard sin inicializar el provider.

4. **startServer managed refactor es la integración más riesgosa (Pitfalls 3+4)** — server.js actualmente: escribe su propio PID (línea 581), hace `process.exit(1)` en misconfig (líneas 405-408), y `server.listen()` sin handler `'error'` (EADDRINUSE → excepción no capturada). Refactorizar primero, verificar que `kodo start` legacy sigue intacto.

5. **`.env` writer — chmod y merge (Pitfalls 13+14)** — `writeFileAtomic` NO hace chmod (0644 world-readable). Patrón correcto: `chmodSync(tmp, 0o600)` PRE-rename (espejo de polling-daemon.js). El writer debe leer-merge-escribir para no clobber `GITHUB_TOKEN` y otras keys existentes.

---

## Implications for Roadmap

Based on research, el roadmapper debe estructurar v0.15 en 4 fases: 2 de Pilar 1 (lifecycle + brew) y 2 de Pilar 2 (secretos + onboarding setup mode). Pilar 1 es shippable sin Pilar 2.

### Phase 65: Daemon Lifecycle Foundation (Pilar 1a)

**Rationale:** Todo lo demás depende de este módulo. Es pura refactorización y código nuevo sin cambios de comportamiento visible — el momento de menor riesgo para sentar la base. La refactorización de `startServer` managed mode se hace aquí porque es la integración de mayor riesgo y conviene validarla antes de añadir capas encima.

**Delivers:**
- `src/daemon/lifecycle.js` — startDaemon/stopDaemon/statusDaemon (reusa polling.js primitivos)
- `src/daemon/run.js` — foreground entrypoint unificado (`kodo daemon run`)
- `src/cli/polling-daemon.js` generalizado con parámetro `name`
- `startServer({managed})` refactor en server.js — no process.exit, no self-PID, handler 'error' para EADDRINUSE
- `~/.kodo/kodo.pid` como PID file unificado del daemon

**Addresses:** Features de daemon dual-mode; prerequisito de `kodo up`

**Avoids:** Pitfalls 1, 3, 4, 5, 18

**Research flag:** Patrones bien documentados + codebase como fuente principal. Omitir research-phase; ejecutar directamente.

---

### Phase 66: `kodo up` + Unified Stop/Status + Homebrew (Pilar 1b)

**Rationale:** Con el foreground entrypoint estable de Phase 65, esta fase añade la orquestación (up/stop/status) y el packaging. Se agrupa Homebrew aquí porque la fórmula invoca `kodo daemon run` — que ya existe tras Phase 65 — y porque los pitfalls de launchd deben resolverse mientras el lifecycle está fresco.

**Delivers:**
- `src/cli/up.js` — runUp(): ensure-daemon (spawn o attach) → wait /health → runDashboard → exit
- `kodo stop` / `kodo status` unificados sobre lifecycle.js
- Dashboard-as-viewer: Ctrl-C/q desvincula el viewer, daemon persiste
- Windows: foreground fallback documentado
- Homebrew tap `Formula/kodo.rb` con `service do { run [bin, "daemon", "run"]; keep_alive true }`
- Node path absoluto en plist (no PATH lookup)

**Addresses:** Todas las features de Pilar 1; cierra la promesa central del milestone

**Avoids:** Pitfalls 2, 5, 6, 7, 8, 9, 10, 17, 19

**Research flag:** Pitfalls 6 y 9 REQUIEREN spike de install real en macOS (`brew install` → `brew services start` → `brew services list` → relogin → `brew services stop`). No son unit-testables. Gate obligatorio antes de mergear la fase.

---

### Phase 67: Secrets Writer + Masked Input (Pilar 2a)

**Rationale:** El writer de `.env` es la única pieza genuinamente nueva de bajo nivel que Pilar 2 necesita. Se separa de la UI para poder testearlo en aislamiento y añadir el grep test de higiene antes de que el valor del key toque ningún path de render.

**Delivers:**
- `writeEnvVar(name, value)` en config.js — atómico + chmod 0600 pre-rename + parse-merge-write
- Masked text-input: extensión render-only del Phase 63 input (render `•`, toggle reveal Ctrl-R, paste burst)
- Indicador "ya configurado" (prueba de presencia en .env, nunca el valor)
- Source-hygiene grep test: el key value nunca llega a saveConfig / console.* / logger.* / execFile argv

**Addresses:** CFGF-03 secret entry; PERSIST-04 boundary enforcement

**Avoids:** Pitfalls 11, 13, 14, 16

**Research flag:** Patrones claros de codebase. Omitir research-phase. UAT crítico: grep de higiene post-implementación.

---

### Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run Wiring (Pilar 2b)

**Rationale:** Depende de los tres módulos anteriores. La detección de first-run modifica el comportamiento de `kodo up` — requiere que el daemon managed mode de Phase 65 ya no haga process.exit en misconfig. Es la fase más compleja de UX y la que cierra el objetivo de onboarding dashboard-first.

**Delivers:**
- Dashboard `mode:'setup'` — pantalla guiada con campos provider/base_url/workspace_slug + masked key
- First-run detection en runUp(): `!existsSync(CONFIG_PATH) || !getProviderApiKey()` → setup mode antes de startDaemon
- `kodo config` wizard rewired al mismo `writeEnvVar` + `saveConfig` (single-writer invariant)
- Aviso de reinicio tras cambio de provider/key
- Transición setup→running: restart nudge honesto (no hot-reload)

**Addresses:** Dashboard-first onboarding; CFGF-03 completo; cierra el milestone

**Avoids:** Pitfalls 12, 15, 16

**Research flag:** La transición setup→running necesita validación manual. UAT gate: máquina limpia sin config.json ni .env.

---

### Phase Ordering Rationale

- **Phase 65 primero** porque `startServer(managed)` es la integración de mayor riesgo — hacerla primero protege todo lo que viene después.
- **Phase 66 antes de Pilar 2** porque el onboarding requiere que `kodo up` exista y porque los pitfalls de launchd son bloqueantes para declarar Pilar 1 shippable.
- **Phase 67 antes de Phase 68** para testear el writer y el boundary guard en aislamiento antes de que el valor del key toque el árbol de render.
- **Pilar 1 shippable sin Pilar 2:** Phase 65+66 entregan `kodo up`/stop/status/brew funcionales. Si el tiempo es limitado, Pilar 2 puede diferirse a v0.15.1.

### Research Flags

Fases que necesitan spike/UAT manual (no unit-testable):
- **Phase 66:** Spike real de `brew services install` en macOS — ciclo completo install → start → list → relogin → stop. Pitfalls 6 y 9 no se detectan con tests.
- **Phase 68:** UAT en máquina limpia (sin config.json ni .env) — verificar que `kodo up` sirve setup mode sin ningún exit(1).

Fases con patrones bien documentados (omitir research-phase):
- **Phase 65:** Los primitivos de polling.js son la fuente; la refactorización es local y bien entendida.
- **Phase 67:** El writer de .env tiene un modelo claro en polling-daemon.js; el grep test es mecánico.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Codebase verificado. No nuevas deps. Homebrew DSL confirmado en docs oficiales. |
| Features | HIGH | Pilar 1 muy bien delimitado por LOCKED constraints. Pilar 2 tiene un punto de diseño abierto (transición setup→running). |
| Architecture | HIGH | Grounded en el codebase shipped; run.js/lifecycle.js son generalizaciones directas de patrones probados. |
| Pitfalls | HIGH (Pilar 1) / MEDIUM (brew/launchd) | Pilar 1 pitfalls verificados contra source. Pitfalls de launchd son conocimiento de plataforma establecido pero sin fórmula kodo real aún. |

**Overall confidence:** HIGH

### Gaps to Address

- **Transición setup→running (Pitfall 15):** Restart nudge honesto + leer el valor directamente del archivo recién escrito (no via loadEnvFile no-override). Diseño fino durante Phase 68.
- **¿`kodo stop`/`status` deprecan `polling start` standalone?:** Mantener legacy, añadir daemon unificado como path principal; revisar deprecación en fase futura.
- **¿El daemon siempre corre polling?:** `startPolling` condicional en `providerUsesPolling(config)` (Plane webhook vs GitHub polling). Confirmar antes de Phase 65.
- **Homebrew tap location:** `kintsugi-lab/homebrew-kodo` vs `alexnunez/homebrew-tap`. Confirmar antes de Phase 66.
- **Spike launchd node/PATH:** Validar durante Phase 66 que el absolute `opt_bin` path es correcto en Apple Silicon (`/opt/homebrew`) vs Intel (`/usr/local`).

---

## Sources

### Primary (HIGH confidence)
- `src/cli/polling.js` (verificado 2026-07-01) — daemon pattern canónico: spawn detached+unref, PID, stop SIGTERM+SIGKILL, bounded wait, Windows guard
- `src/cli/polling-daemon.js` (verificado 2026-07-01) — atomic PID write + chmod 0600 pre-rename + defensive shape
- `src/config.js` (verificado 2026-07-01) — writeFileAtomic (sin chmod), loadEnvFile (no-override), ausencia de .env writer
- `src/server.js` (verificado 2026-07-01) — naive PID write, listen sin error handler, process.exit(1) en misconfig
- `src/cli.js` (verificado 2026-07-01) — command wiring, orchestrate signal ordering precedent
- `.planning/PROJECT.md` v0.15 (verificado 2026-07-01) — LOCKED constraints, PERSIST-04, Out of Scope
- [Homebrew: Node for Formula Authors](https://docs.brew.sh/Node-for-Formula-Authors) — std_npm_args, libexec, depends_on node
- [Homebrew::Service Ruby API](https://docs.brew.sh/rubydoc/Homebrew/Service.html) — service DSL, keep_alive, foreground requirement
- [ink-text-input](https://github.com/vadimdemedes/ink-text-input) — mask prop confirmado; usado para justificar la extensión in-house

### Secondary (MEDIUM confidence)
- [Homebrew/brew Services System (DeepWiki)](https://deepwiki.com/Homebrew/brew/11.2-services-system) — cómo brew services genera/consume el launchd plist
- [docker compose up docs](https://docs.docker.com/reference/cli/docker/compose/up/) — Ctrl-C = SIGINT, foreground vs -d (informa diseño viewer-detach)
- [Supabase CLI getting started](https://supabase.com/docs/guides/local-development/cli/getting-started) — single-command up, first-run vs warm-start
- [Textual (Real Python)](https://realpython.com/python-textual/) — masked-by-default, reveal toggle, `•` glyphs

### Tertiary (LOW confidence — requieren validación con install spike)
- Comportamiento real de launchd KeepAlive throttle, PATH mínimo, y HOME bajo brew services — establecido como conocimiento de plataforma pero no verificado contra una fórmula kodo real. **Gate: spike de install real en Phase 66.**

---
*Research completed: 2026-07-01*
*Ready for roadmap: yes*
