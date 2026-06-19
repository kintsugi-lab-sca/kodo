---
phase: 59-liveness-de-sesiones-adoptadas
plan: 01
gap_closure: true
subsystem: session
tags: [cmux, workspace-host, adopt, reconcile, liveness, set-title]

# Dependency graph
requires:
  - phase: 38
    provides: contrato WorkspaceHost (getHost, _legacy) — la regla transversal LOCKED (cmux solo via src/host/)
  - phase: 54
    provides: CLI `kodo adopt` (runAdoptCli) — el consumidor donde vive el rename
  - phase: 56
    provides: flujo de adopción desde el dashboard que dispara la creación de la tarea
provides:
  - "_legacy.rename en el CmuxHost (passthrough a cmux/client.js rename → workspace-action set-title)"
  - "NullHost con _legacy.rename no-op (fail-open en hosts non-cmux)"
  - "runAdoptCli renombra el workspace tras una adopción nueva para que el título lleve el task_ref"
affects: [reconcile, dashboard liveness, adopt picker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Liveness por título: el side-effect de rename satisface el contrato EXISTENTE titleIdentifiesSession sin tocar reconcile"
    - "Fail-open absoluto en side-effects post-discriminante: el rename nunca cambia el exit code del adopt"

key-files:
  created: []
  modified:
    - src/host/cmux.js
    - src/host/interface.js
    - src/cli/adopt.js
    - test/adopt-cli.test.js
    - test/host/contract.test.js

key-decisions:
  - "Enfoque RENAME (no session_id): tras `kodo adopt` crear la tarea, renombrar el workspace cmux a '<ref>: <título>' → titleIdentifiesSession pasa en el próximo tick. UNA llamada cmux en adopt time; cero coste por-tick; reconcile.js intacto."
  - "El rename vive en runAdoptCli (consumidor CLI), NO en adoptSession (que sigue host-agnóstico) ni en reconcile/hooks — regla transversal LOCKED: cmux solo via src/host/ (getHost)."
  - "Fail-open absoluto: cmux caído / sin host / host non-cmux / método ausente / set-title error NUNCA falla el adopt ni cambia exitCodeFor(result). Una tarea adoptada-pero-mostrada-dead es estrictamente mejor que un adopt fallido."
  - "Rename SKIPPED cuando task.ref falta/vacío (fail-open) y en resultados non-ok (ALREADY_ADOPTED/INVALID_INPUT/CREATE_FAILED)."

patterns-established:
  - "renameWorkspaceFn DI inyectable en runAdoptCli; default lazy-importa getHost('cmux')._legacy.rename con guard typeof."

# Metrics
duration: ~20min
completed: 2026-06-19
---

# Phase 59 Plan 01: Liveness de sesiones adoptadas Summary

**`kodo adopt` ahora renombra el workspace de cmux a `"<task_ref>: <título>"` justo después de crear la tarea, de modo que el check EXISTENTE `reconcile.liveForSession`/`titleIdentifiesSession` reconoce la sesión adoptada como viva (running/idle/needs-input) en vez de dead/zombie — exactamente como las sesiones lanzadas por kodo (p.ej. ROMAN-189).**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (host-layer rename + CLI liveness rename), TDD-flavored
- **Files modified:** 5 (3 src, 2 test)

## Accomplishments

1. **`src/host/cmux.js`** — Expuesto `_legacy.rename(opts)` como passthrough fiel a `cmux/client.js` `rename` (`workspace-action --action set-title --workspace <ws> --title <t>`), espejo de los wrappers `setColor`/`send` existentes. `opts = { workspace, title }`. La función `rename` en `client.js` YA existía (línea ~69); solo faltaba exponerla en el contrato del host.

2. **`src/host/interface.js`** — `createNullHost` recibe un `_legacy.rename` no-op (`async () => {}`) para que un host non-cmux/null degrade limpio. El CLI además protege con `typeof host?._legacy?.rename === 'function'`.

3. **`src/cli/adopt.js`** — Nuevo PASO 5 en `runAdoptCli`: tras el render, si `result.ok === true` y `result.task.ref` es un string no vacío, construye el título `${result.task.ref}: ${result.task.title}` y llama `renameWorkspaceFn` (DI; default lazy-importa `getHost('cmux')._legacy.rename`). Todo envuelto en try/catch — un fallo se traga (warn como mucho) y NUNCA cambia `exitCodeFor(result)`. `adoptSession` (src/adopt.js) queda intacto y host-agnóstico; `reconcile.js` intacto.

## Por qué funciona

`reconcile.liveForSession` encuentra el workspace por ref (el workspace adoptado SÍ está vivo en `workspace list`) pero lo rechazaba porque `titleIdentifiesSession(title, task_ref)` era false: los workspaces adoptados llevan nombres cmux/usuario sin el ref. Poner el título a `"<ref>: …"` hace que el `:` tras el ref satisfaga el límite de palabra de `titleIdentifiesSession`, así que el check pasa en el próximo tick. Es exactamente el mecanismo por el que las sesiones LANZADAS por kodo (ROMAN-189) están vivas: cmux nombra su workspace con el ref.

## Tests

- `test/adopt-cli.test.js` (Phase 59 describe, 4 tests):
  - L1: adopt exitoso → `renameWorkspaceFn` llamado con `{ workspaceRef: 'W', title }` donde el título empieza por `'ROMAN-192:'` (ref word-bounded); exit 0.
  - L2: fail-open — `renameWorkspaceFn` lanza → exit 0, render de éxito presente, no throw.
  - L3: NO llamado en ALREADY_ADOPTED / INVALID_INPUT / CREATE_FAILED.
  - L4: SKIPPED (no llamado) cuando `task.ref` falta/vacío.
- `test/host/contract.test.js` (Phase 59 describe, 3 tests): cmux host expone `_legacy.rename`; NullHost expone un no-op; aserción de fuente del argv `set-title` de `client.js`.

## Self-Check

Verificado: scoped `node --test test/adopt-cli.test.js test/host/contract.test.js` → 55 pass / 0 fail; full `node --test $(find test -name '*.test.js' -type f)` → 1471 pass / 0 fail / 1 skip (pre-existente). Walkers `cmux-isolation` + `format-isolation` verdes (adopt.js entra por getHost, sin leak de cmux/client; sin picocolors nuevos).

## Limitación conocida (acción del operador)

Este fix arregla las adopciones NUEVAS de aquí en adelante. Las sesiones adoptadas YA muertas (p.ej. ROMAN-192 si fue adoptada antes de este cambio) necesitan **re-adoptar** o **renombrar el workspace manualmente** (con el `task_ref` en el título) para revivir — el reconcile no retroactiva un workspace cuyo título nunca llevó el ref.

## Deviations from Plan

None — plan ejecutado según lo escrito. La función `rename` en `cmux/client.js` ya existía, así que el trabajo en la capa de cliente se redujo a exponerla en `_legacy`.

## Commits

- `2544886` feat(59-01): expose cmux host _legacy.rename + NullHost no-op
- `2b56f6b` feat(59-01): kodo adopt renames cmux workspace to carry task_ref (liveness fix, fail-open)
