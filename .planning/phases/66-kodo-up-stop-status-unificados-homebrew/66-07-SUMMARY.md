---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 07
subsystem: daemon
gap_closure: true
tags: [daemon, kodo-up, pid, cold-spawn, provider-init, tdd, hardening]

# Dependency graph
requires:
  - phase: 65-03
    provides: runDaemon (src/daemon/run.js) — funnel foreground compuesto con UN kodo.pid
  - phase: 66-01
    provides: runUp + waitForHealth (src/cli/up.js) — ensure-daemon → health-wait → attach
  - phase: 65-03
    provides: startDaemon bounded pid-wait (src/daemon/lifecycle.js) que emitía el timeout
provides:
  - "kodo.pid se escribe ANTES del await de startServer (liveness del proceso, no server-ready)"
  - "cold-spawn de `kodo up` ya no reporta 'failed to write PID file within 2000ms' con boot lento"
  - "fail-path borra el pid temprano (sin kodo.pid stale en fallo de boot)"
  - "mensaje distinto y accionable para KODO_SETUP_REQUIRED (no-config) vs error de boot genérico"
affects: [homebrew, brew-services, release-v0.15.3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PID file = liveness del PROCESO (verdadero al instante de arrancar), NO server-ready; readiness lo cubre waitForHealth contra /health"
    - "Escribir el pid antes del try/catch de boot → teardown() lo borra en el fail path → nunca queda un pid stale apuntando a un proceso que sale"
    - "Discriminar códigos de error (KODO_SETUP_REQUIRED) para mensajes accionables sin conflacionar no-config con boot error"

key-files:
  created: []
  modified:
    - src/daemon/run.js
    - test/daemon/run.test.js
    - test/cli/up.test.js

decisions:
  - "El pid representa liveness del proceso: se escribe justo tras loadConfig() (sync/rápido), antes de provider.init() (red). server-ready es otra preocupación y ya la maneja waitForHealth."
  - "waitForHealth NO se tocó: su default (10s) ya acomoda un provider.init de red y es bounded (never-hang). Se bloqueó por test (presupuesto ≥10s + boot lento-pero-200 → true)."

metrics:
  duration_min: 3
  completed: 2026-07-02

status: complete
---

# Phase 66 Plan 07: Cold-spawn PID timeout gap-closure Summary

Fix del cold-spawn de `kodo up`, que reportaba `daemon 'kodo' failed to write PID file within 2000ms` aunque el daemon SÍ arrancaba: el `kodo.pid` ahora se escribe antes del await de red de `startServer` (liveness del proceso), con limpieza en fail-path y un mensaje distinto para no-config.

## El bug (confirmado)

En cold start (sin daemon corriendo), `kodo up` daba `failed to write PID file within 2000ms`, pero el daemon arrancaba bien (escuchando en :9090, sirviendo datos reales). Causa raíz: en `src/daemon/run.js`, `writePidFile(...)` se llamaba **después** de `await startServer({managed:true})` — y `startServer` hace `provider.init()`, una **llamada de red** a la API de Plane. Cuando ese boot tardaba >2000ms, `kodo.pid` no estaba escrito antes de que el bounded-wait de `startDaemon` (`lifecycle.js`, `waitMs=2000`) se rindiera. El daemon seguía vivo (detached); solo la espera era demasiado temprana.

El path de attach (idempotencia, daemon ya corriendo) funcionaba bien — esto era exclusivo del cold-spawn.

Colateral: sin config, `startServer({managed})` lanzaba `KODO_SETUP_REQUIRED` (comportamiento Phase 65) → run.js catch → teardown → nunca escribía pid → `kodo up` daba el MISMO mensaje confuso de "failed to write PID". El mensaje conflacionaba "boot lento" y "misconfig".

## El fix

En `src/daemon/run.js` (`runDaemon`):

1. **PID temprano** — `writePidFileFn({pid, started_at, kind:'daemon'}, 'kodo')` se movió a **antes** del `await startServerFn({managed:true})`, justo tras `loadConfig()` (sync/rápido) y tras instalar los handlers de señal. Racional: el pid representa "el proceso daemon está vivo", cierto al instante de arrancar; server-ready es otra cosa que `waitForHealth` de `kodo up` ya maneja contra `/health`. Ahora el pid-wait de `kodo up` resuelve en <100ms sea cual sea la latencia de `provider.init`.
2. **Limpieza fail-path** — como el pid se escribe antes del try/catch, el `teardown(1)` del catch (que llama `removePidFile('kodo')`) borra el pid recién escrito → un boot fallido nunca deja un `kodo.pid` stale apuntando a un proceso que sale.
3. **Mensaje distinto** — cuando `startServer` lanza con `code === 'KODO_SETUP_REQUIRED'`, se loguea un mensaje accionable (`[kodo] daemon: falta configuración — corre \`kodo config\` para configurar el proveedor.`) en vez del genérico `daemon start failed: <msg>`, desambiguando no-config de un error de boot real.
4. **waitForHealth** — confirmado que el timeout por defecto (10s) ya acomoda un `provider.init` de red y es bounded (never-hang). NO se cambió; se bloqueó por test.

Preservado: never-throws, D-05 single-owner teardown, UP-06 (`kodo start` legacy intacto), `// @ts-check`, cero deps nuevas.

## Tests (TDD RED → GREEN)

RED commit `6b6cd58`, GREEN commit `641f2ab`. `node:test`, espejando los patrones de DI de `test/daemon/run.test.js`.

En `test/daemon/run.test.js` (nuevo describe `runDaemon: 66-07`):
- `writePidFile` se llama **antes** de que `startServer` resuelva (assert de call-order + flag observado por el fake de startServer).
- Fail-path: `startServer` lanza → el pid temprano se **borra** (orden `['write','startServer-throw','remove']`) → `{ok:false}` + `exit(1)`, sin pid stale.
- Rama `KODO_SETUP_REQUIRED`: loguea el mensaje distinto de config (menciona "configuración" y "kodo config"), NO el genérico.
- (Se ajustó el test genérico existente para lanzar un error sin `code` y seguir cubriendo `daemon start failed`.)

En `test/cli/up.test.js` (nuevo describe `waitForHealth: 66-07`):
- El default (10s) acomoda ≥10s de boot (reloj virtual: no-200 se rinde solo tras ≥10000ms, bounded).
- Un boot lento-pero-eventualmente-200 (~5s) resuelve `true`.

Suite completa verde: **1708 pass / 0 fail / 1 skip** (baseline tras 66-06 era 1703 pass). UP-06 golden (`test/cli/kodo-start-regression.test.js`) verde (3/3).

## Re-validación

Este fix necesita un **re-release v0.15.3** para re-validar el cold-spawn end-to-end bajo Homebrew/brew services (el spike original corría contra un build previo). El path de attach ya funcionaba; esto arregla solo el cold-spawn.

## Deviations from Plan

None - plan executed exactly as written (RED→GREEN, mismo orden de fix del spec).

## Self-Check: PASSED
