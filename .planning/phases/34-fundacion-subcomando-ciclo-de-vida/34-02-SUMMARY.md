---
phase: 34-fundacion-subcomando-ciclo-de-vida
plan: 02
subsystem: ui
tags: [ink, react, tui, cli, commander, lifecycle, raw-mode]

# Dependency graph
requires:
  - phase: 34-fundacion-subcomando-ciclo-de-vida (Plan 01)
    provides: tests Nyquist en rojo (dashboard-non-tty, dashboard-render, format-isolation walker extendido) + contratos asertados (mensaje canónico D-04, substrings chrome D-01, patrón de registro lazy en cli.js)
provides:
  - "Subcomando `kodo dashboard` registrado en src/cli.js (lazy import D-07, flag --url D-05, description D-06, sin gate de provider)"
  - "runDashboard: process-owner del subcomando — guard non-TTY pre-render (D-03/D-04), resolución de baseUrl config-driven (D-05), render(App), SIGTERM handler vía unmount (D-10), exit code limpio (process.exitCode = 0)"
  - "App.js: componente root ink con chrome estático D-01/D-02 (banner / starting… / q quit), q→useApp().exit() (D-08), Esc deliberadamente no manejado (D-11), useInput gateado por isRawModeSupported, color solo de <Text> de ink (D-12)"
  - "Primitivas de lifecycle limpio (unmount / waitUntilExit / restauración de terminal) reutilizables por el handoff de attach de Phase 37"
affects: [35-datos-cliente-http-polling, 36-tabla-viva-render-seleccion-filtros, 37-attach-handoff-cmux, 38-paneles-auxiliares-comentarios-logs]

# Tech tracking
tech-stack:
  added: [ink, react, ink-testing-library]
  patterns:
    - "Process-owner / componente: index.js posee el proceso (guard, señales, exit code); App.js es UI pura ink — la separación que Phase 37 reutiliza para el handoff de attach"
    - "Guard non-TTY ANTES de render(): un crash de raw-mode es fallo de proceso (stderr + exit 1), no de UI"
    - "Lazy import de ink/react/App dentro de runDashboard: mantiene el arranque del CLI ligero y aísla las deps del subcomando"
    - "Cleanup de señales idempotente: process.once('SIGTERM', unmount) + removeListener tras waitUntilExit() — sin fugar el listener"
    - "Color-isolation TUI-04 (D-12): cero picocolors bajo src/cli/dashboard/, color exclusivamente vía props de <Text>"

key-files:
  created:
    - src/cli/dashboard/index.js
    - src/cli/dashboard/App.js
  modified:
    - src/cli.js
    - test/dashboard-render.test.js

key-decisions:
  - "SIGTERM se cablea con handler explícito (process.once → app.unmount → removeListener tras waitUntilExit); Ctrl-C usa el exitOnCtrlC default de ink (NO se cablea SIGINT propio, D-09); salida limpia con process.exitCode = 0 (NO process.exit, deja drenar stdio)"
  - "El guard non-TTY corre ANTES de cualquier render() — evita el crash 'Raw mode is not supported' de ink convirtiéndolo en exit 1 limpio con mensaje canónico a stderr"
  - "ink/react/App se importan dinámicamente (await import) dentro de runDashboard: arranque del CLI ligero + deps de ink aisladas al path del subcomando"
  - "La aserción q→exit del test de Plan 01 se ajustó (Rule 1) a un frame-diff observable de unmount porque ink-testing-library@4 no expone waitUntilExit() en su instance — firma delegada al implementador per RESEARCH A3 / Plan 01 Decisión 2"

patterns-established:
  - "Process-owner vs componente: src/cli/dashboard/index.js (proceso: guard/señales/exit) + App.js (UI ink pura)"
  - "Guard de capability (TTY) pre-render como gate de proceso, no como rama de UI"
  - "Color-isolation walker extendido (format-isolation.test.js) cubre src/cli/dashboard/ — cero picocolors"

requirements-completed: [TUI-01, TUI-02, TUI-03, TUI-04]

# Metrics
duration: ~4min (impl Tasks 1-2; checkpoint UAT manual fuera de banda)
completed: 2026-05-27
---

# Phase 34 Plan 02: Subcomando `kodo dashboard` + ciclo de vida Summary

**Esqueleto del TUI `kodo dashboard` con ink/react: chrome estático (`kodo dashboard` / `starting…` / `q quit`), guard non-TTY pre-render (exit 1 limpio) y ciclo de vida de salida intacto (q / Ctrl-C / SIGTERM restauran la terminal) — UAT manual de TUI-03 aprobado.**

## Performance

- **Duration:** Tasks 1-2 ejecutados en ~4 min (18:15→18:19 del 2026-05-26); Task 3 fue un checkpoint human-verify resuelto fuera de banda
- **Started (impl):** 2026-05-26T18:15:30+02:00 (commit e6ae74f)
- **Completed (impl):** 2026-05-26T18:19:14+02:00 (commit 372b2cf)
- **UAT aprobado:** 2026-05-27
- **Tasks:** 3 (2 auto + 1 checkpoint human-verify)
- **Files modified:** 4 (2 creados, 2 modificados)

## Accomplishments
- `runDashboard` (process-owner): guard non-TTY ANTES de render (exit 1 + mensaje canónico D-04 a stderr), resolución de baseUrl config-driven con override `--url` (D-05), render del componente ink, SIGTERM handler explícito vía `app.unmount()` (D-10), exit code limpio `process.exitCode = 0` (D-09 — sin matar el proceso).
- `App.js` (componente root ink): chrome estático D-01/D-02 (banner `kodo dashboard`, placeholder `starting…` con U+2026, footer `q quit`), `q`→`useApp().exit()` (D-08, no `process.exit`), Esc deliberadamente no manejado (D-11, reservado Phase 38), `useInput` gateado por `isRawModeSupported`, color exclusivamente vía `<Text>` de ink (D-12).
- Registro de `kodo dashboard` en `src/cli.js` con lazy import en `.action` (D-07), `--url` (D-05) y description sin alias (D-06) — sin gate de provider (el dashboard no lo necesita en Phase 34).
- UAT manual de TUI-03 aprobado por el operador: la terminal queda intacta tras los 4 escenarios.

## Task Commits

Cada task se commiteó atómicamente (Tasks 1-2 son TDD — el rojo de Plan 01 ya proveyó los tests; estos commits son la fase GREEN):

1. **Task 1: runDashboard process-owner (guard non-TTY, baseUrl, render, SIGTERM, exit code)** — `e6ae74f` (feat)
2. **Task 2: App.js chrome estático D-01/D-02 + q→exit + registro `command('dashboard')` en cli.js** — `372b2cf` (feat) — incluye el fix Rule-1 de `test/dashboard-render.test.js`
3. **Task 3: checkpoint human-verify (UAT TUI-03 en TTY real)** — sin commit de código (verificación manual; operador respondió "approved")

**Plan metadata:** este SUMMARY (docs: complete plan)

_Nota: el RED de TDD (los tests Nyquist) se commiteó en Plan 01 (Wave 0); este plan aporta el GREEN._

## Files Created/Modified
- `src/cli/dashboard/index.js` (creado) — `runDashboard(deps = {})`. Process-owner: guard non-TTY pre-render, baseUrl D-05, render(App), SIGTERM handler, exit code.
- `src/cli/dashboard/App.js` (creado) — componente root ink: chrome estático + lifecycle de salida (q→exit).
- `src/cli.js` (modificado) — bloque `program.command('dashboard')` (líneas 300-310): description D-06, `--url` D-05, `.action` con lazy import D-07; sin `ensureConfig`.
- `test/dashboard-render.test.js` (modificado) — fix Rule-1 de la aserción q→exit (ver Deviations).

### Partición final bajo `src/cli/dashboard/`

| Archivo | Rol | Responsabilidades |
|---------|-----|-------------------|
| `index.js` | **process-owner** | Guard non-TTY (D-03/D-04), resolución baseUrl (D-05), render(), SIGTERM handler (D-10), exit code (D-09). NO toca la UI. |
| `App.js` | **componente ink** | Chrome estático (D-01/D-02), binding `q`→exit (D-08), color via `<Text>` (D-12). NO toca el proceso ni las señales. |

Registro en `src/cli.js`:
```js
program
  .command('dashboard')
  .description('Live TUI dashboard of active kodo sessions')   // D-06, sin alias
  .option('--url <baseUrl>', '...')                            // D-05
  .action(async (opts) => {
    const { runDashboard } = await import('./cli/dashboard/index.js'); // D-07 lazy
    await runDashboard({ url: opts.url });
  });                                                          // sin ensureConfig (no requiere provider)
```

### `runDashboard` — firma y ciclo de vida

- **Firma DI:** `runDashboard(deps = {})` → `{ stdout = process.stdout, stdin = process.stdin, url } = deps` (stdout/stdin inyectables para testabilidad, igual que `src/cli/polling.js`).
- **Orden del guard (D-03):** `if (!stdout.isTTY || !stdin.isTTY)` corre PRIMERO, antes de cualquier `render()` — escribe `NON_TTY_MSG + '\n'` a `process.stderr` y `process.exit(1)`. Convierte el crash de raw-mode de ink en un fallo de proceso limpio (T-34-01 mitigado).
- **baseUrl (D-05):** `url ?? \`http://localhost:${loadConfig().server.port}\`` — override de `--url` o default config-driven (`server.port`, default 9090). `loadConfig` se importa lazy desde `../../config.js`.
- **SIGTERM handler (D-10):** `const onSigterm = () => { app.unmount(); }; process.once('SIGTERM', onSigterm);` — el mismo camino de cleanup que q/Ctrl-C; `app.unmount()` restaura cursor/echo/scrollback (T-34-03 mitigado). NO se llama `process.exit` directo (saltaría el teardown de ink).
- **Salida limpia:** `await app.waitUntilExit(); process.removeListener('SIGTERM', onSigterm); process.exitCode = 0;` — remueve el listener para no fugarlo y fija el exit code sin matar el proceso (deja drenar stdio). NO `process.exit(0)`.
- **SIGINT (D-09):** NO se cablea — lo cubre el `exitOnCtrlC` default de ink. Cablear un SIGINT propio saltaría el teardown (Pitfall 9).

### `App.js` — detalles

- Chrome estático D-01/D-02 vía `createElement(Box/Text, ...)` (sin JSX, sin build step): banner `kodo dashboard` (bold), placeholder central `starting…` (U+2026, dimColor, **estático** — no consume datos reales en Phase 34), footer `q quit`. El cuerpo de datos reales se hereda a Phase 36.
- `q` → `useApp().exit()` (D-08): desmonte limpio, NO `process.exit`.
- `Esc` **deliberadamente no manejado** (D-11): reservado para overlays de Phase 38; no hay rama para `key.escape`.
- `useInput(..., { isActive: isRawModeSupported })` — gateado por `useStdin().isRawModeSupported` (belt-and-suspenders, Pitfall 1) aunque el guard pre-render de index.js ya rechaza non-TTY.
- Color exclusivamente vía props de `<Text>` (`bold`/`dimColor`), cero `picocolors` (D-12, TUI-04) — verificado por el walker extendido de `test/format-isolation.test.js`.

## Decisions Made
- **SIGTERM con handler explícito vs señal sin manejar:** se eligió `process.once('SIGTERM', () => app.unmount())` + `removeListener` tras `waitUntilExit()`. SIGTERM sin handler dejaría la terminal en raw-mode (T-34-03). Ctrl-C usa el `exitOnCtrlC` default de ink (D-09 — no se duplica SIGINT). Salida limpia con `process.exitCode = 0`, no `process.exit`, para no saltar el teardown ni truncar stdio.
- **Guard non-TTY pre-render:** colocado antes de `render()` para que el rechazo de pipe/CI sea un gate de proceso (exit 1 limpio) en lugar de un crash de raw-mode de ink.
- **Lazy import de ink/react/App:** arranque del CLI ligero y deps de ink aisladas al path del subcomando (patrón del repo, análogo a `status`/`logs`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Aserción q→exit de `test/dashboard-render.test.js` sustituida por frame-diff observable de unmount**
- **Found during:** Task 2 (App.js + registro)
- **Issue:** `ink-testing-library@4.0.0` NO expone `waitUntilExit()` en el instance que retorna `render()` (solo `rerender/unmount/cleanup/stdout/stderr/stdin/frames/lastFrame`); ese método vive en el `render()` real de `ink`, no en el harness. La aserción literal heredada de Plan 01 habría fallado contra el harness, no contra la implementación.
- **Fix:** La aserción de q→exit se reescribió a un test de comportamiento **observable** y controlado: se compara el conteo de `frames` tras pulsar `q` (desmonte limpio → +1 frame de clear) contra una tecla que `App` ignora (`x` → sin re-render, D-11). Si `q` no desmontara (regresión: `process.exit` en vez de `exit()`, o binding roto), no habría frame extra y el test falla con mensaje accionable. Da cobertura automatizada real a la parte testeable de TUI-03 (la restauración de terminal en TTY real sigue siendo UAT manual, no automatizable sin PTY).
- **Justificación:** la firma concreta de esta aserción fue **delegada al implementador** por Plan 01 (RESEARCH A3 / Plan 01 Decisión 2) precisamente porque la API del harness no era conocida en tiempo de planificación. No es scope creep: es la materialización de un contrato que Plan 01 dejó abierto a propósito.
- **Files modified:** test/dashboard-render.test.js
- **Verification:** `node --test test/dashboard-render.test.js` → verde (2 tests pass); suite completa `npm test` → 900 tests / 899 pass / 0 fail / 1 skip (el skip de startup-budget es pre-existente).
- **Committed in:** `372b2cf` (parte del commit de Task 2)

---

**Total deviations:** 1 auto-fixed (1 bug — fix de aserción de test contra la API real del harness)
**Impact on plan:** El ajuste es necesario para que el test de Plan 01 verifique el comportamiento real bajo `ink-testing-library@4`. No cambia el comportamiento de producción ni el alcance del plan — materializa un contrato que Plan 01 dejó explícitamente abierto al implementador. Sin scope creep.

## Issues Encountered
- Checkpoint `human-verify` (Task 3, gate=blocking): TUI-03 (terminal intacta tras q / Ctrl-C / SIGTERM en TTY real) no es automatizable sin un PTY. La ejecución se pausó y el operador lo verificó manualmente en una terminal interactiva.

## Task 3 — UAT manual de TUI-03 (resultado)

El operador ejecutó los 4 escenarios en un TTY real y respondió **"approved"**:

1. `node bin/kodo dashboard` → chrome visible (banner / `starting…` / `q quit`), pulsa `q` → terminal **intacta** (cursor visible, echo restaurado, scrollback sin corromper). PASS.
2. Relanzar + `Ctrl-C` → terminal intacta. PASS.
3. Relanzar + `kill <pid>` (SIGTERM) desde otra terminal → terminal intacta, sin raw-mode colgado. PASS.
4. (Negativo) `node bin/kodo dashboard | cat` → mensaje canónico a stderr + exit 1, sin stack trace de raw-mode. PASS (también cubierto por `test/dashboard-non-tty.test.js`).

En los 3 caminos de salida (q / Ctrl-C / SIGTERM): cursor visible + echo + scrollback intacto = PASS. TUI-03 confirmado.

## Requirements Completed
- **TUI-01** — `kodo dashboard` monta el chrome estático D-01/D-02 en TTY.
- **TUI-02** — non-TTY → exit 1 + mensaje canónico (D-03/D-04), sin crash de raw-mode.
- **TUI-03** — q / Ctrl-C / SIGTERM dejan la terminal intacta (automático parcial vía frame-diff + UAT manual aprobado).
- **TUI-04** — cero picocolors bajo `src/cli/dashboard/`, verificado por el walker (D-12).

## Verification Results
- `node --test test/dashboard-non-tty.test.js test/dashboard-render.test.js test/format-isolation.test.js` → **11 pass / 0 fail** (re-confirmado en este cierre).
- `grep "command('dashboard')" src/cli.js` → presente (cli.js:302).
- `npm test` (suite completa) → 900 tests / 899 pass / 0 fail / 1 skip (skip pre-existente de startup-budget).
- Non-TTY spawn (`| cat`) → exit 1 + mensaje canónico D-04 a stderr, sin stack trace.

## Next Phase Readiness
- El esqueleto del subcomando, los guards de capability y el ciclo de vida limpio (unmount / waitUntilExit / restauración de terminal) quedan correctos desde el primer commit — son las primitivas que reutilizará el handoff de attach en **Phase 37**.
- El cuerpo de `App.js` es placeholder estático (`starting…`): **Phase 35** aporta el cliente HTTP/polling de datos y **Phase 36** la tabla viva (render/selección/filtros) que rellenará el chrome.
- `--url` se almacena solo como baseUrl en memoria (no alcanza red en Phase 34, T-34-02 accept); su validación/sanitización se hereda a Phase 35.
- Sin blockers.

## Self-Check: PASSED

- `src/cli/dashboard/index.js` — FOUND (en disco, `runDashboard` exportado).
- `src/cli/dashboard/App.js` — FOUND (en disco, default export del componente).
- `src/cli.js` — FOUND `command('dashboard')` en cli.js:302.
- `test/dashboard-render.test.js` — FOUND (aserción frame-diff de unmount).
- Commit `e6ae74f` (Task 1) — FOUND en git log.
- Commit `372b2cf` (Task 2) — FOUND en git log.
- 3 tests targeted — GREEN (11 pass / 0 fail), re-confirmado.
- Deviation Rule-1 (fix de aserción de test) documentada arriba.

---
*Phase: 34-fundacion-subcomando-ciclo-de-vida*
*Completed: 2026-05-27*
