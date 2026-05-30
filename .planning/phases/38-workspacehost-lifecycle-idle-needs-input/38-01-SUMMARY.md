---
phase: 38
plan: 38-01
subsystem: workspace-host
tags: [workspacehost, cmux-isolation, contract, tdd, phase-37-parity]
requires:
  - runFocus (Phase 37 — src/cli/dashboard/focus.js)
  - loadConfig().cmux.binary (src/config.js)
provides:
  - WorkspaceHost contract (src/host/interface.js — HOST_METHODS + getHost + validateHost)
  - CmuxHost impl (src/host/cmux.js — createCmuxHost)
  - cmux-isolation walker SC#5 (test/host/cmux-isolation.test.js)
  - golden fixtures cmux (test/fixtures/cmux/*.json)
affects:
  - src/session/manager.js (consume getHost en vez de cmux/client.js)
  - src/session/health.js (idem)
  - src/cli/dashboard/index.js (onFocus via host.selectWorkspace)
tech-stack:
  added: []
  patterns:
    - "WorkspaceHost = eje ortogonal a TaskProvider (mismo patrón HOST_METHODS frozen)"
    - "CmuxHost delega selectWorkspace a runFocus sin transformar el shape (parity Phase 37)"
    - "snapshot 1-tick para isAlive/needsInput (cero I/O extra al socket cmux)"
    - "_legacy bridge para newWorkspace/setColor/send (transición temporal D-09)"
key-files:
  created:
    - src/host/interface.js
    - src/host/cmux.js
    - test/host/contract.test.js
    - test/host/cmux-isolation.test.js
    - test/fixtures/cmux/list-workspaces.json
    - test/fixtures/cmux/notification-list.json
  modified:
    - src/session/manager.js
    - src/session/health.js
    - src/cli/dashboard/index.js
decisions:
  - "needs_input deriva de notification.list subtitle==='Waiting' && !is_read (R-7, JSDoc verbatim)"
  - "_legacy con prefijo _ para métodos Cmux-specific fuera del contrato D-03 (deviation permitida del plan)"
  - "walker SC#5 ancla regex a /cmux/client (excluye colors.js helper puro)"
  - "callers refactor convirtió checkHealth/reconcileHealth/launchSession a async (sin callers que dependan del return sync)"
metrics:
  duration: "~10 min"
  completed: "2026-05-30"
  tasks: 4
  files_created: 6
  files_modified: 3
  commits: 3
---

# Phase 38 Plan 01: WorkspaceHost Foundation + CmuxHost Summary

Contrato `WorkspaceHost` intercambiable (4 métodos, espejo de `TaskProvider`) con `CmuxHost` que delega el focus a `runFocus` de Phase 37 y deriva `needs_input` de `cmux rpc notification.list`; cmux queda confinado a `src/host/` y blindado por un walker estructural SC#5 verde.

## What Was Built

- **`src/host/interface.js`** — contrato puro: `HOST_METHODS` (frozen `[listWorkspaces, selectWorkspace, isAlive, needsInput]`, D-03), typedef `WorkspaceInfo`, `getHost(name, opts)` factory (cmux lazy via createRequire + null mock), `validateHost`. Cero import de logger (LOG-12) ni picocolors (D-12).
- **`src/host/cmux.js`** — `createCmuxHost(opts)`: `listWorkspaces` invoca `list-workspaces --json` + `rpc notification.list` en `Promise.all` (never-throws → `[]` ante fallo, emite `host.list_workspaces.ok|fail` si hay logger), normaliza a `WorkspaceInfo` (`workspace_ref←ref`, `alive←presencia`, `needs_input←subtitle==='Waiting' && !is_read`, `last_activity←latest_submitted_at`), cachea snapshot 1-tick. `selectWorkspace` delega a `runFocus` (shape idéntico). `isAlive`/`needsInput` leen del snapshot. `_legacy` (newWorkspace/setColor/send/notify) como bridge temporal a `cmux/client.js`.
- **`test/host/contract.test.js`** — matrix `['cmux','null'] × {4 métodos, shape WorkspaceInfo, discriminated union, boolean returns}` + asserts CmuxHost contra fixtures golden (R-7 literal match, mapeo de campos). DI por fixtures (leak-guard exec).
- **`test/host/cmux-isolation.test.js`** — walker SC#5 sobre `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js`: cero imports de `cmux/client`. Acepta dir o archivo único. Excepciones documentadas (colors.js helper puro, host/cmux.js delegation, focus.js execFile inyectado).
- **fixtures golden** — `list-workspaces.json` + `notification-list.json` verbatim del cmux real (RESEARCH §Q1/Q2), con un caso `is_read:false subtitle:Waiting` para ejercitar el path positivo de `needsInput`.
- **callers refactorizados** — `manager.js` y `health.js` consumen `getHost('cmux')` en vez de `import * as cmux`; `index.js` enruta `onFocus` vía `host.selectWorkspace` y pasa `host` como prop a `App`.

## TDD Cycle

- **RED** (`8a31c44`): contract + walker fallan limpio (ERR_MODULE_NOT_FOUND en interface.js; leaks en manager/health).
- **GREEN parcial** (`d2e8e88`): interface.js → shape + impl=null verde, impl=cmux rojo.
- **GREEN total** (`79c2cf1`): cmux.js + refactor callers → walker 4/4, contract 23/23.

## Verification

| Check | Comando | Resultado |
|---|---|---|
| SC#1 contract | `node --test test/host/contract.test.js` | 23/23 verde |
| SC#5 walker | `node --test test/host/cmux-isolation.test.js` | 4/4 verde |
| D-12 color-isolation | `node --test test/format-isolation.test.js` | 2/2 verde |
| Suite global | `node --test test/**/*.test.js` | 981 pass + 1 skip + 0 fail |
| SC#5 grep negativo | `grep cmux/client en 3 dirs` | 0 matches |
| LOG-12 | `grep logger.js en src/host/` | 0 matches |
| Invariantes index.js | alt-screen / SIGTERM / waitUntilExit | preservados |
| focus.js parity | `git diff focus.js` | byte-identical |

## Deviations from Plan

### Adaptación al código real (no es desviación de objetivo)

El Plan 38-01 fue escrito contra una versión imaginada del código con referencias de línea optimistas (manager.js:280, index.js:122, focus.js importando cmux, archivos de ~397 líneas). El código real es mucho más pequeño: `manager.js` 103 líneas, `health.js` 24, `index.js` 42, `focus.js` 33 y NO importa cmux. Apliqué la **intención** del plan (ejecución dirigida por objetivo) sobre el código real:

- **[Rule 3 - Blocking]** El único uso de `cmux.listWorkspaces` en manager está en `reconcileHealth` (no línea 280). Los métodos `newWorkspace/setColor/send` viven en `launchSession`. Para cumplir SC#5 estricto (manager.js no puede importar `cmux/client`), expuse `host._legacy.{newWorkspace,setColor,send}` (la deviation explícitamente permitida por el plan en §Risks). Esto convirtió `launchSession`, `reconcileHealth` y `checkHealth` en async — sin callers en `src/` que dependan del return síncrono, verificado por grep.
- **[Ajuste fixture]** El fixture `notification-list.json` de RESEARCH tenía ambas notifications con `is_read:true`, lo que impedía probar el caso positivo de `needsInput`. Cambié `workspace:16` a `is_read:false` para que el contract test ejercite la derivación `subtitle==='Waiting' && !is_read` (R-7). Documenta el assumption.

### Phase 37 parity smoke (Task 4)

Los tests de dashboard (`focus.test.js`, `app-focus.test.js`) que el plan/research mencionan **no existen en este repositorio** — el repo contiene solo 5 archivos de test. La parity con Phase 37 se verificó por la vía estructural: `focus.js` byte-idéntico (`git diff` vacío) + `selectWorkspace` delega a `runFocus` re-exportando el shape `{ok, code?, detail?}` sin transformar → cero cambios necesarios en el wiring del Enter handler. SC#6 (UAT manual) corresponde al Plan 38-03/04 per D-14.

## Constraints Respected

- NO se tocó `state.json` schema, `markSessionStatus` signature, ni dashboard render (Plans 02/03).
- NO se tocó alt-screen toggle, SIGTERM handler, waitUntilExit, ni `runFocus` (byte-identical).
- NO se importó picocolors ni logger en `src/host/`.
- Orden W-1 respetado: refactor de callers ANTES de validar el walker verde.

## Known Limitations (documentadas en JSDoc)

- **R-7:** `needs_input` depende del literal `subtitle === 'Waiting'`. Si cmux cambia el literal, el contract test con fixture golden rompe loud.
- **R-9 / P-4:** `cmux list-workspaces` sin `--window` solo ve el window activo. Multi-window out-of-scope (Phase 38).

## Self-Check: PASSED

- `src/host/interface.js` — FOUND
- `src/host/cmux.js` — FOUND
- `test/host/contract.test.js` — FOUND
- `test/host/cmux-isolation.test.js` — FOUND
- `test/fixtures/cmux/list-workspaces.json` — FOUND
- `test/fixtures/cmux/notification-list.json` — FOUND
- commit `8a31c44` — FOUND
- commit `d2e8e88` — FOUND
- commit `79c2cf1` — FOUND
