# Phase 65: Daemon Lifecycle Foundation - Discussion Log

> **Audit trail only.** Decisiones en CONTEXT.md; este log preserva alternativas consideradas.

**Date:** 2026-07-01
**Phase:** 65-daemon-lifecycle-foundation
**Mode:** `--auto` (gray areas auto-seleccionadas; opción recomendada del research del milestone)
**Areas discussed:** Composición del daemon, Módulos src/daemon/, Refactor startServer managed, PID unificado, Apagado limpio, Arranque condicional de polling

---

## Composición del daemon (GA-1)
| Option | Selected |
|--------|----------|
| Un proceso compuesto (server+polling), un PID | ✓ |
| Supervisión de hijos PID-trackeados separados | |
**Auto:** un proceso (D-01). **Notes:** hijos separados = gestor genérico (fuera de scope) + rompe brew services por doble-fork.

## Refactor startServer managed (GA-2)
| Option | Selected |
|--------|----------|
| Opción `{managed}` gateada; legacy default intacto | ✓ |
| Refactor destructivo del path legacy | |
**Auto:** opción gateada (D-03). **Notes:** managed = no exit, no self-PID, `.on('error')` EADDRINUSE; `kodo start` legacy byte-idéntico (UP-06).

## PID unificado (GA-3)
| Option | Selected |
|--------|----------|
| `~/.kodo/kodo.pid` (módulo PID parametrizado por name, chmod 0600) | ✓ |
| Reusar `server.pid` legacy | |
**Auto:** kodo.pid distinto (D-04). **Notes:** prerequisito de la idempotencia de `kodo up`.

## Arranque condicional de polling (GA-4)
| Option | Selected |
|--------|----------|
| `startPolling` solo si el provider usa polling (github) | ✓ |
| Siempre arrancar polling | |
**Auto:** condicional (D-06). **Notes:** Plane usa webhook; evita polling loop inútil. Resuelve open question del roadmapper.

## Módulos src/daemon/ + apagado (GA-5)
**Auto:** `lifecycle.js` (fontanería genérica) + `run.js` (foreground funnel único, block-forever, cleanup SIGTERM) + comando `kodo daemon run` (hidden) (D-02/D-05). Molde: self-spawn `kodo polling start --no-daemon`.

---

## Claude's Discretion
- Firmas/ubicación de lifecycle.js/run.js/módulo PID/providerUsesPolling.
- Forma del error discriminado de startServer(managed).
- `kodo daemon run` hidden en commander.
- Cómo startServer(managed) devuelve el handle closeable.

## Deferred Ideas
- `kodo up` / stop / status unificados → Phase 66.
- Homebrew/launchd → Phase 66.
- writeEnvVar / masked input / setup mode → Phases 67-68.
- Deprecar legacy (server.pid/kodo start/polling start) → futuro.
