---
phase: 79-sidebar-doctor
plan: 03
subsystem: cli
tags: [cmux, sidebar-doctor, cli, commander, dry-run, --fix, --json, byte-determinista, color-isolation, DI]

# Dependency graph
requires:
  - phase: 79-02
    provides: "src/cmux/sidebar-doctor.js: scan(deps) async + execute(deps,{fix}) — motor determinista 0-token (allowlist no-destructivo, TOCTOU, fail-open per item)"
  - phase: 79-01
    provides: "Allowlist no-destructivo en client.js (create/add/set-anchor/ungroup) + listWorkspacesJson"
provides:
  - "src/cli/sidebar-doctor.js: runSidebarDoctor(opts, deps) — espejo fiel de runGsdDoctor; dry-run humano por categoría / --fix / --json byte-determinista; exit hasActions ? 1 : 0"
  - "Namespace `kodo sidebar doctor [--fix] [--json]` registrado en cli.js, SIN ensureConfig (0-provider preservado)"
affects: [80-orchestrator (piggyback `kodo sidebar doctor --fix` en `kodo check`)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI doctor como shell fino: toda la política vive en el módulo puro del Plan 02; runSidebarDoctor solo orquesta scan -> exitCode -> (fix) execute -> render/JSON"
    - "exitCode = report.hasActions ? 1 : 0 calculado ANTES del render (espejo D-09 de gsd-doctor); protected NUNCA afecta el exit"
    - "--json byte-determinista: JSON.stringify(report, null, 2) sin pasar por el formatter, idéntico TTY/no-TTY, cero ANSI (DX-06)"
    - "Color isolation: todo el color humano vía createFormatter inyectado; cero picocolors/ANSI inline"
    - "Registro de namespace cmux-doctor SIN ensureConfig (espejo del comentario cli.js:466-468) — el doctor no toca provider"

key-files:
  created:
    - "src/cli/sidebar-doctor.js"
    - "test/cli/sidebar-doctor-cli.test.js"
  modified:
    - "src/cli.js"

key-decisions:
  - "runSidebarDoctor await-ea scanFn/executeFn (scan del Plan 02 es async) — calco de runGsdDoctor salvo el await; exit deriva SIEMPRE de scan().hasActions, nunca de execute"
  - "El comando `sidebar` se registró como namespace propio (no bajo `gsd`) espejo del namespace gsd, SIN ensureConfig — preserva el 0-provider de SDR-03"
  - "--json bajo --fix mergea el result de execute bajo la clave `executed`; sin framing humano, byte-determinista"

patterns-established:
  - "Pattern CLI-doctor espejo: un handler `run*Doctor` con DI (write/err/fmt/scanFn/executeFn) reutilizable entre gsd-doctor y sidebar-doctor; el registro en cli.js hace import dinámico + process.exit(code)"

requirements-completed: [SDR-01, SDR-06]

coverage:
  - id: D1
    description: "runSidebarDoctor es espejo fiel de runGsdDoctor: dry-run limpio -> exit 0 render clean; report con acciones -> exit 1 render por categoría en orden D-09; dry-run nunca llama executeFn"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cli/sidebar-doctor-cli.test.js#runSidebarDoctor dry-run/--fix/exit codes (11 casos verdes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "--json byte-determinista: JSON parseable = report serializado; idéntico byte-a-byte TTY vs no-TTY, cero secuencias ANSI; bajo --fix mergea execute bajo `executed`"
    requirement: "SDR-06"
    verification:
      - kind: unit
        ref: "test/cli/sidebar-doctor-cli.test.js#--json byte-idéntico TTY/no-TTY + sin \\x1b["
        status: pass
    human_judgment: false
  - id: D3
    description: "exit code deriva de scan().hasActions incluso bajo --fix con errores; protected presente pero sin acciones -> exit 0"
    requirement: "SDR-06"
    verification:
      - kind: unit
        ref: "test/cli/sidebar-doctor-cli.test.js#exit derivation + protected no afecta exit"
        status: pass
    human_judgment: false
  - id: D4
    description: "Registro `kodo sidebar doctor [--fix] [--json]` en cli.js SIN ensureConfig; --help lista --fix/--json; source assertion sin picocolors ni import de ../cmux/client.js"
    requirement: "SDR-01"
    verification:
      - kind: unit
        ref: "test/cli/sidebar-doctor-cli.test.js#source-hygiene (sin picocolors, sin client.js)"
        status: pass
      - kind: manual_procedural
        ref: "node src/cli.js sidebar doctor --json (dry-run live, read-only) -> exit 0 sobre sidebar limpio del operador (2026-07-23 10:18)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Convergencia REAL del sidebar cmux vivo con --fix (SDR-05 observable en member_workspace_refs) + supuestos A1 (create devuelve ref) / A2 (add mueve entre grupos) / A5 (mutación bajo daemon headless) + garantía D-04 (no tocar workspaces del operador tras un fix real)"
    verification: []
    human_judgment: true
    rationale: "DIFERIDO A UAT. En vivo solo se ejerció la rama READ-ONLY (dry-run/--json/exit) contra el sidebar real: coherente y limpio. NO existía ninguna sesión kodo suelta el 2026-07-23; fabricar una habría mutado el sidebar del operador desde una cadena autónoma. La mutación real (--fix) y A1/A2/A5/D-04 post-fix quedan para el carril UAT estándar (/gsd-verify-work 79), coherente con VALIDATION.md §Manual-Only Verifications."

# Metrics
duration: 6min
completed: 2026-07-23
status: complete
---

# Phase 79 Plan 03: CLI del sidebar doctor Summary

**`src/cli/sidebar-doctor.js` — `runSidebarDoctor` espejo fiel de `runGsdDoctor`: dry-run humano por categoría / `--fix` / `--json` byte-determinista, exit `hasActions ? 1 : 0`, color aislado; y el namespace `kodo sidebar doctor [--fix] [--json]` registrado en `cli.js` SIN `ensureConfig` (0-provider preservado). Cierra con checkpoint humano donde la rama READ-ONLY se verificó en vivo y la mutación real (`--fix` + A1/A2/A5/D-04) se difiere a UAT.**

## Performance

- **Duration:** 6 min (mecánico) + checkpoint humano
- **Started:** 2026-07-23T10:16:00Z
- **Completed:** 2026-07-23T10:22:00Z
- **Tasks:** 3 (Task 1 TDD RED/GREEN, Task 2, Task 3 checkpoint)
- **Files modified:** 3 (2 creados, 1 modificado)

## Accomplishments
- `runSidebarDoctor(opts, deps)` calco literal de `runGsdDoctor`: DI (`write`/`err`/`fmt`/`scanFn`/`executeFn`) con defaults; 1) `report = await scanFn(deps)`, 2) `exitCode = report.hasActions ? 1 : 0` (ANTES del render), 3) `--fix` -> `await executeFn(deps,{fix:true})`, 4) `--json` -> serialización byte-determinista sin formatter, else `renderHuman`. El exit deriva SIEMPRE de `scan().hasActions`, nunca de execute.
- `renderHuman` agrupa las 3 categorías (`missing_group`/`loose_workspace`/`empty_group`) con la acción exacta por item en orden D-09, resumen `protected`, verdict, y bajo `--fix` la sección `executed`; todo el color vía `fmt.*` inyectado (cero picocolors inline — color isolation).
- Namespace `kodo sidebar doctor [--fix] [--json]` registrado en `cli.js` espejo del namespace `gsd`, SIN `ensureConfig` (el doctor no toca provider — preserva el 0-provider de SDR-03), con import dinámico de `runSidebarDoctor` y `process.exit(code)`.
- 11 tests CLI verdes (dry-run/`--fix`/`--json`/exit codes/source-hygiene) con DI hermético; suite completa 2346 pass / 0 fail / 1 skipped.

## Task Commits

Cada tarea se commiteó atómicamente (Task 1 TDD RED → GREEN):

1. **Task 1 RED: test CLI fallido para runSidebarDoctor** - `2f7b75a` (test)
2. **Task 1 GREEN: runSidebarDoctor handler + render humano por categoría** - `c1814b7` (feat)
3. **Task 2: Registro `kodo sidebar doctor` en cli.js (sin ensureConfig)** - `57a2c6d` (feat)

## Files Created/Modified
- `src/cli/sidebar-doctor.js` - NUEVO. `runSidebarDoctor` (espejo de runGsdDoctor) + `renderHuman`/`renderCategory` por categoría; importa `scan`/`execute` de `../cmux/sidebar-doctor.js` y `createFormatter` de `./format.js`; nunca importa `../cmux/client.js` ni picocolors.
- `src/cli.js` - +namespace `sidebar` con subcomando `doctor` (--fix/--json), SIN ensureConfig, import dinámico + process.exit(code); ningún otro comando tocado.
- `test/cli/sidebar-doctor-cli.test.js` - NUEVO. 11 tests unit puros (dry-run vs --fix, orden ['scan','execute'], --json byte-idéntico TTY/no-TTY sin ANSI, protected no afecta exit, source-hygiene sin picocolors/client.js).

## Decisions Made
- **`runSidebarDoctor` await-ea `scanFn`/`executeFn`** — el `scan` del Plan 02 es async (raws cmux `execFile`); único delta frente a `runGsdDoctor` (que es sync). El exit sigue derivando de `scan().hasActions`.
- **`sidebar` como namespace propio** (no subcomando de `gsd`), espejo del namespace `gsd`, SIN `ensureConfig` — preserva el 0-provider de SDR-03.
- **`--json` bajo `--fix`** mergea el `result` de execute bajo la clave `executed`; sin framing humano, byte-determinista.

## Deviations from Plan
None - plan executed exactly as written (Tasks 1-2 mecánicos sin deviaciones; Task 3 es checkpoint humano).

## Issues Encountered
None durante el trabajo planificado.

## Checkpoint humano (Task 3) — resolución con alcance acotado

El checkpoint `human-verify` (SDR-05, supuestos A1/A2/A5, garantía D-04) se resolvió **approved con alcance explícitamente acotado**. La distinción es material y se registra honestamente:

**VERIFICADO EN VIVO (rama READ-ONLY, contra el cmux real del operador, 2026-07-23 10:18):**
- `node src/cli.js sidebar doctor` (dry-run) → render humano coherente: *"Grupos faltantes/disueltos: none · Workspaces sueltos: none · Grupos vacíos: none · protected: 0 · ✓ clean — sidebar converged"*, exit 0.
- `node src/cli.js sidebar doctor --json` → `{"missing_group":[],"loose_workspace":[],"empty_group":[],"protected":{"sessions":[]},"hasActions":false}`, exit 0.
- `cmux workspace-group list --json` real: grupos existentes (`Kodo` workspace_group:1 con `member_workspace_refs` [workspace:3,4,36], `itclip` workspace_group:7, etc.) — coherente con el dry-run: las sesiones kodo están agrupadas, no hay deriva que corregir. El contrato de exit `hasActions ? 1 : 0` queda verificado en la rama limpia (exit 0).

**NO VERIFICADO EN VIVO — DIFERIDO A UAT (`/gsd-verify-work 79`), NO declarar como verificado:**
- `--fix` con una sesión kodo suelta real → convergencia SDR-05 observable en `member_workspace_refs`.
- Supuesto **A1** (¿`create --json` devuelve el ref?), **A2** (¿`add` mueve un workspace entre grupos?), **A5** (¿los verbos mutan bajo el daemon headless?).
- Garantía **D-04** (ningún workspace no-kodo del operador movido/re-anclado tras un `--fix` real).

**Razón de la deferencia:** el 2026-07-23 no existía ninguna sesión kodo suelta; fabricar una habría mutado el sidebar del operador desde una cadena autónoma. Se difiere al carril UAT estándar, coherente con VALIDATION.md §Manual-Only Verifications. El backstop D6 del Plan 02 (convergencia real, `human_judgment: true`) permanece abierto y converge con el D5 de este plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `kodo sidebar doctor [--fix] [--json]` está listo end-to-end como comando espejo de `gsd doctor` (SDR-06). Preparado para que la Phase 80 lo invoque de piggyback (`kodo sidebar doctor --fix`) en `kodo check`.
- **Pendiente de UAT (bloquea el cierre de fase, no el plan):** la convergencia real con `--fix` (SDR-05 en vivo) + A1/A2/A5 + D-04 post-fix deben verificarse en `/gsd-verify-work 79` con una sesión kodo suelta real.
- Sin blockers de código.

## Self-Check: PASSED

---
*Phase: 79-sidebar-doctor*
*Completed: 2026-07-23*
