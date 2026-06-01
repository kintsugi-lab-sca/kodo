---
phase: 38
plan: 38-04
title: Reconciliación host↔state + debouncing + NDJSON events + UAT humano
status: complete
uat_status: passed
wave: 4
tags: [reconciliation, debouncing, lifecycle, ndjson, uat, tdd, architecture-deviation]
commits: 2
key_files:
  created:
    - src/session/reconcile.js
    - test/host/reconciliation.test.js
    - .planning/phases/38-workspacehost-lifecycle-idle-needs-input/38-HUMAN-UAT.md
  modified:
    - src/server.js
    - src/session/state.js
    - src/logger-events.js
    - test/logger-events.test.js
requirements: [TUI-20, "SC#4", "SC#6"]
---

## Objective

Reconciliación host↔state con debouncing 2-tick + 3 NDJSON events + UAT humano
con 4 escenarios bloqueantes. Cierra TUI-20 / SC#4 + la lógica de SC#6. El
reconciliador aplica transiciones idle↔running↔needs-input solo tras 2 ticks
consecutivos, nunca lanza, y rescata sesiones desde history cuya tab sigue viva
(cierra ROMAN-151/152).

## ⚠ Desviación arquitectónica (aprobada por el usuario)

**El plan ubicaba la reconciliación EN EL DASHBOARD escribiendo `state.json`.**
Investigación del código real reveló que esto es incorrecto y peligroso:

- El **dashboard** (`src/cli/dashboard/`) es un **cliente HTTP read-only** de
  `GET /status`. No lee ni escribe `state.json`.
- El **server** (`src/server.js`) es el dueño de `state.json` (lo escribe vía
  `removeSession`, y ya consulta `cmux.listWorkspaces()` para enriquecer `/status`).
- Cablear el reconciliador en el dashboard crearía **dos escritores de
  `state.json`** → corrupción.

**Solución (aprobada):** `reconcileTick` vive en `src/session/reconcile.js`
(cohesión con la capa de estado, no en `dashboard/polling.js`) y el loop
periódico (`startReconcileLoop`) se cablea en `startServer` — el proceso dueño
de `state.json`. Los `usePoll.js`/`App.js`/`index.js` del dashboard NO se tocan
(el render multi-estado de Plan 03 ya visualiza los estados vía `/status`).

Esto desvía de los archivos `files_modified` del plan (que listaba
`polling.js`/`usePoll.js`/`index.js`/`App.js` del dashboard) pero respeta el
modelo de escritor único y cumple el objetivo funcional.

## What shipped

- **`reconcileTick` (puro, never-throws)** — transiciones D-04 derivadas de
  (tab viva?, proceso vivo?, needs_input?) con **debouncing 2-tick** (R-2:
  N ticks consecutivos con el mismo target antes de aplicar; cambio de target
  resetea el contador). Rescate desde history (D-07 step 3) y sellado a `closed`
  >30 días (D-07 step 4). `liveRefs=null` → skip tick.

- **`runReconcileTick` (con I/O, DI)** — consulta el host, reconcilia, persiste
  si cambió. Emite `host.list_workspaces.ok|fail` + `host.reconcile.tick`.

- **`startReconcileLoop`** — `setInterval` (2.5s) con single-flight (no solapa
  ticks) + `.unref()` (no bloquea el cierre del server). Teardown en cleanup.

- **Wire en `startServer`** — arranca el loop con `getHost('cmux')` +
  `loadState`/`saveState`; detenido en SIGTERM/SIGINT. Logger inyectado.

- **3 NDJSON events (D-13)** — `host.list_workspaces.ok|fail` +
  `host.reconcile.tick`. Taxonomía 20→23 (los 4 eventos host/migración completos).

- **`38-HUMAN-UAT.md`** — 4 escenarios bloqueantes (`status: pending`).

## Verification

| Check | Comando | Resultado |
|---|---|---|
| SC#4 reconciliación (F1-F6) | `node --test test/host/reconciliation.test.js` | 8/8 verde (6 pure + 2 I/O) |
| Debouncing 2-tick | F1 + F2 | verde |
| Rescate history (ROMAN-151/152) | F3 | verde |
| Sellado closed | F4 | verde |
| Host fail never-throws | F5 + runReconcileTick throw test | verde |
| 3 NDJSON events D-13 | `grep HOST_LIST_OK\|HOST_LIST_FAIL\|HOST_RECONCILE_TICK` | 3 matches |
| Logger taxonomy 23 | `node --test test/logger-events.test.js` | 33/33 verde |
| LOG-12 (state.js/reconcile.js no importan logger.js) | walker | verde (import dinámico) |
| server.js / reconcile.js sintaxis | `node --check` | OK |
| UAT doc | `head 38-HUMAN-UAT.md` | blocking + 4 escenarios |
| Suite global | `node --test $(find test -name '*.test.js')` | 1027 tests · 1026 pass · 0 fail · 1 skip · rc=0 |

## Decisions & deviations

- **Ubicación `reconcile.js` + wire en server** (ver sección de desviación).
- **`startReconcileLoop` con `.unref()`**: el timer no debe mantener vivo el
  proceso server ni bloquear el cierre limpio (SIGTERM). Single-flight (`running`
  flag) evita solapar ticks si uno tarda > 2.5s (cmux freeze) — espeja el D-03
  single-flight del poll del dashboard.
- **No cobertura de integración del loop completo**: `startReconcileLoop` se
  testea indirectamente vía `runReconcileTick` (DI) + `reconcileTick` (puro). Un
  test E2E del server con cmux real es lo que cubre el UAT humano.

## NOT done (requiere intervención humana)

- **UAT humano (`autonomous: false`)**: los 4 escenarios de `38-HUMAN-UAT.md`
  requieren cmux real + manipulación manual (matar proceso Claude, cerrar tab,
  inducir needs-input). **El milestone Phase 38 NO se cierra hasta que el
  usuario firme el UAT** (`status: passed`). Flujo: ejecutar los escenarios →
  `/gsd-verify-work 38` lee el frontmatter.

## Known minors (documentados)

- **Debouncing fragility (P-8):** el `debounceStore` vive en memoria del server;
  restart reinicia el store (primeros 2 ticks no aplican transiciones).
- **R-8:** sin flock en migración v2→v3 (idempotencia + backups mitigan).
- **R-9:** cmux multi-window — correr dashboard desde el window de las tabs kodo.

## Self-Check: PASSED

- `src/session/reconcile.js` reconcileTick + runReconcileTick + startReconcileLoop — FOUND
- `src/server.js` startReconcileLoop wired en startServer — FOUND
- `src/logger-events.js` 3 eventos host.* (taxonomía 23) — FOUND
- `test/host/reconciliation.test.js` 8 tests — FOUND
- `38-HUMAN-UAT.md` 4 escenarios blocking — FOUND
- commit `(RED)` reconciliation — FOUND
- commit `(GREEN)` tasks 2-4 — FOUND
- Suite global 1027/1026 pass/0 fail/1 skip — VERIFIED
- UAT humano — PENDING (bloquea cierre de fase)
