---
phase: 65
slug: daemon-lifecycle-foundation
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-01
---

# Phase 65 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivada de `65-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node ≥20) + `node:assert/strict` |
| **Config file** | none — `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| **Quick run command** | `node --test test/daemon/ test/server-managed.test.js test/cli/kodo-start-regression.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20–35 s (suite completa; el integration child-spawn añade unos segundos) |
| **HOME isolation** | `mkdtempSync` + `process.env.HOME` + dynamic `import(...?cachebust)` DESPUÉS de fijar HOME (molde `polling-daemon.test.js:38-52`) |
| **Child-process integration** | `node:child_process` `spawn`/`spawnSync` con `KODO_BIN` absoluto + HOME-isolated (molde `polling.test.js:12-27`) |

---

## Sampling Rate

- **After every task commit:** `node --test test/daemon/ test/server-managed.test.js test/cli/kodo-start-regression.test.js` (unit rápido < 30 s)
- **After every plan wave:** `npm test` (incluye no-regresión de `polling.test.js`/`stop.test.js` que comparten los primitivos PID/HOME)
- **Before `/gsd-verify-work`:** `npm test` verde + `test/daemon/daemon-run-integration.test.js` (child-spawn + SIGTERM) verde
- **Max feedback latency:** ~35 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 65-XX-XX | TBD | 0 | UP-04 | — | `getPidPath('kodo')`→`kodo.pid`; default→`polling.pid`; `writePidFile('kodo')` atómico + `0600` distinto de `server.pid` | unit (`statSync` mode) | `node --test test/daemon/pid-name-param.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 0 | UP-04 | — | `providerUsesPolling({provider:'github'})→true`, `plane→false`, malformado→false | unit (pure) | `node --test test/daemon/provider-uses-polling.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-04 | V5 | managed EADDRINUSE → error discriminado SIN `process.exit` (no mata el runner) | unit (`assert.rejects`) | `node --test test/server-managed.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-04 | — | managed misconfig (sin webhook secret) lanza error tipado, proceso sigue vivo | unit | `node --test test/server-managed.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-04 | — | managed NO escribe `server.pid` y NO instala self-SIGTERM/exit (4º punto gateado) | unit (HOME-isolated) | `node --test test/server-managed.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 2 | UP-04 | — | `lifecycle.js` start/stop/status genérico (stop: SIGTERM→5s→SIGKILL; status: running/idle) | unit (DI) | `node --test test/daemon/lifecycle.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 2 | UP-04 | — | `run.js`: arranca polling SOLO si `providerUsesPolling`; SIGTERM para server+polling y borra `kodo.pid` (single-owner del exit) | unit (DI: fake startServer/startPolling/config) | `node --test test/daemon/run.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 2 | UP-04 | — | `kodo daemon run` bloquea foreground (no auto-exit) y limpia ante SIGTERM (para+borra `kodo.pid`, exit 0 ≤5 s) | integration (spawn child + SIGTERM) | `node --test test/daemon/daemon-run-integration.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-06 | — | `kodo start` (managed:false) SIGUE escribiendo `server.pid` y sirviendo (golden) | unit (HOME-isolated) | `node --test test/cli/kodo-start-regression.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-06 | — | `kodo start` sin webhook secret SIGUE saliendo con exit 1 (fail-fast legacy intacto) | integration (`spawnSync bin/kodo start`) | `node --test test/cli/kodo-start-regression.test.js` | ❌ W0 | ⬜ pending |
| 65-XX-XX | TBD | 1 | UP-06 | — | `kodo start` (managed:false) NO escribe `kodo.pid` (aislamiento del PID nuevo) | unit | `node --test test/cli/kodo-start-regression.test.js` | ❌ W0 | ⬜ pending |

*Task IDs se concretan en PLAN.md. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/daemon/pid-name-param.test.js` — `getPidPath(name)` + `writePidFile('kodo')` `0600` + distinción de paths (UP-04). Puede extender `test/cli/polling-daemon.test.js`.
- [ ] `test/daemon/provider-uses-polling.test.js` — pure function allowlist github (UP-04).
- [ ] `test/server-managed.test.js` — los **4 puntos gateados**: no-exit (throw tipado), `'error'`/EADDRINUSE, no-self-`server.pid`, no-self-SIGTERM (UP-04). Requiere HOME-isolation + (recomendado) seam DI `_loadConfig`/`_provider` para evitar red en `provider.init`.
- [ ] `test/cli/kodo-start-regression.test.js` — golden UP-06: `server.pid` presente, exit-1 sin secret, `kodo.pid` ausente en legacy.
- [ ] `test/daemon/lifecycle.test.js` — start/stop/status genérico (UP-04; consumidor real Phase 66, se entrega aquí).
- [ ] `test/daemon/run.test.js` — DI unit de `runDaemon`: compose condicional + teardown single-owner (UP-04).
- [ ] `test/daemon/daemon-run-integration.test.js` — process-level: `spawn bin/kodo daemon run` HOME-isolated (con `KODO_DEV=1`/secret para pasar el gate), poll hasta `kodo.pid`, assert child vivo tras N ms (foreground bloquea), `kill SIGTERM`, assert exit 0 ≤5 s + `kodo.pid` borrado (UP-04).
- [ ] Framework ya presente: `node:test` — sin instalación. Reusar el patrón `mkdtempSync`+HOME de `polling-daemon.test.js`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | Ninguna | Phase 65 es 100% automatizable (código puro + refactor gateado, sin superficie TUI ni provider en vivo). Los gates manuales del milestone son Phase 66 (brew services install real) y Phase 68 (clean-machine UAT). |

---

## Nota de testabilidad (load-bearing)

El valor Nyquist central de esta fase: **managed mode convierte en unit-testeable lo que hoy no lo es**. El `process.exit(1)` legacy (`server.js:407`) mata el runner → solo testeable por integración/exit-code; **managed lanza un error tipado → `assert.rejects`**. Por eso **UP-04 (managed) es unit** y **UP-06 (legacy exit) es integration** (`spawnSync bin/kodo start`). El seam DI en `startServer` (`_loadConfig`/`_provider`, molde `isReportToProviderEnabled(_loadConfig)` config.js:233) permite unit-testear managed sin pegar a red en `provider.init()` — discreción del planner.

Aislamiento: `KODO_DIR`/`PID_PATH` se resuelven al import de `config.js`/`server.js` vía `homedir()`; los tests fijan `HOME` ANTES de un `import(...?cachebust)` dinámico (molde `polling-daemon.test.js`). El módulo PID parametrizado recibe `name` como argumento → testeable sin tocar `HOME` para la distinción de paths.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (pid-name-param, provider-uses-polling, server-managed, kodo-start-regression, lifecycle, run, daemon-run-integration)
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
