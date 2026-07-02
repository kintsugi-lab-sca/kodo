---
phase: 68-dashboard-setup-mode-cfgf-03-first-run
plan: 01
subsystem: config
tags: [first-run, onboarding, setup-mode, dependency-injection, tdd, cli, dashboard]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation
    provides: "managed mode sin process.exit + KODO_SETUP_REQUIRED (habilita servir setup sin crash)"
  - phase: 67-secrets-writer-masked-input
    provides: "isApiKeyConfigured (presence-check, nunca el valor) + writeEnvVar + onSaveApiKey"
  - phase: 66-kodo-up-stop-status-unificados-homebrew
    provides: "runUp orquestador con seams DI (statusDaemon/startDaemon/runDashboard)"
provides:
  - "needsSetup() — helper puro compartido de detección de first-run (config.js)"
  - "rama pre-spawn de runUp: en first-run abre el dashboard con setup:true sin arrancar el daemon (D-02)"
  - "flag setup:true propagado a runDashboard (consumido por plan 68-02)"
affects: [68-02-dashboard-setup-mode, 68-03-kodo-config-rewire]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DI puro con seams por defecto (needsSetup(providerName, _loadConfig, _configExists, _isApiKeyConfigured))"
    - "existsSync-first para first-run: la existencia del archivo precede a cualquier lectura de valores (Pitfall 12)"
    - "helper compartido único (D-01): una lógica de detección, dos consumidores (runUp + App/index)"

key-files:
  created: []
  modified:
    - src/config.js
    - src/cli/up.js
    - test/config.test.js
    - test/cli/up.test.js

key-decisions:
  - "needsSetup se apoya en existsSync(CONFIG_PATH) como PRIMERA señal, nunca en los valores de loadConfig() (Pitfall 12 — DEFAULT_CONFIG trae un plane válido → falso negativo)"
  - "Presencia de la key vía isApiKeyConfigured reusado (nunca el valor, PERSIST-04); sin re-invocar loadEnvFile (D-09/Pitfall 15)"
  - "Gate estructural base_url/workspace_slug es Plane-only (D-03); github queda fuera del guiado (D-06)"
  - "needsSetup NO incluye el webhook secret KODO_WEBHOOK_SECRET_PLANE (D-12)"
  - "runUp evalúa needsSetup() ANTES del ensure-daemon; en first-run no spawnea (evita teardown(1) del daemon, D-02)"

patterns-established:
  - "Seams DI opcionales para testabilidad sin tocar el ~/.kodo/ real (dogfooding): los tests inyectan fakes, producción usa defaults canónicos"
  - "Source-hygiene assertions: strip de comentarios antes de grep (process.exit; webhook secret; existsSync-first ordering)"

requirements-completed: [SETUP-01]

coverage:
  - id: D1
    description: "needsSetup() detecta first-run: config.json ausente (existsSync-first, held-out Pitfall 12), falta API key, o Plane sin base_url/workspace_slug"
    requirement: "SETUP-01"
    verification:
      - kind: unit
        ref: "test/config.test.js#SETUP-01 — needsSetup (detección de first-run)"
        status: pass
      - kind: unit
        ref: "test/config.test.js#SETUP-01 — needsSetup source hygiene (D-12; PERSIST-04)"
        status: pass
    human_judgment: false
  - id: D2
    description: "runUp corre needsSetup() pre-spawn: en first-run abre runDashboard {setup:true} sin startDaemon, sin health-wait, sin process.exit (D-02)"
    requirement: "SETUP-01"
    verification:
      - kind: unit
        ref: "test/cli/up.test.js#D-02 first-run (needsSetup true): runDashboard con {setup:true}, CERO startDaemon"
        status: pass
      - kind: unit
        ref: "test/cli/up.test.js#SC#1 source: src/cli/up.js no contiene process.exit ejecutable"
        status: pass
    human_judgment: false
  - id: D3
    description: "GATE MANUAL: UAT en máquina limpia (sin config.json ni .env) — kodo up sirve el modo setup sin exit(1) y la transición es honesta"
    requirement: "SETUP-01"
    verification: []
    human_judgment: true
    rationale: "El SC#1 exige verificación en máquina limpia real (terminal TTY); el modo setup renderizado (plan 68-02) y la ausencia de exit(1) end-to-end no son observables por unit tests DI. Gate manual obligatorio del ROADMAP."

# Metrics
duration: ~20min
completed: 2026-07-02
status: complete
---

# Phase 68 Plan 01: Detección de first-run (needsSetup + runUp pre-spawn) Summary

**Helper puro `needsSetup()` con existsSync-first (anti-falso-negativo Pitfall 12) reusado por la rama pre-spawn de `runUp` que, en config incompleta, abre el dashboard en modo setup sin arrancar el daemon (D-02).**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-02T12:29:00Z (aprox.)
- **Completed:** 2026-07-02T12:49:00Z (aprox.)
- **Tasks:** 2 (ambas TDD: RED → GREEN)
- **Files modified:** 4

## Accomplishments
- `needsSetup(providerName, _loadConfig, _configExists, _isApiKeyConfigured)` en `src/config.js`: contrato en 3 señales — (1) `existsSync(CONFIG_PATH)` directo como primera señal (Pitfall 12), (2) presencia de la API key vía `isApiKeyConfigured` (nunca el valor), (3) estructurales `base_url`/`workspace_slug` solo para Plane si el config existe (D-03). Puro, never-throws, sin webhook secret (D-12).
- Rama pre-spawn en `runUp` (`src/cli/up.js`): seam `_needsSetup` (`deps._needsSetup || lazy import`) evaluado ANTES del ensure-daemon; en first-run → `runDashboard({ url, setup: true }); return;` sin `startDaemon`, sin health-wait, sin `process.exit`. El guard win32 conserva precedencia.
- Held-out test Pitfall 12: `config.json` ausente devuelve `true` aunque `loadConfig()` devuelva un `DEFAULT_CONFIG` válido y la key parezca presente — prueba que existsSync-first gana.
- Tests aislados por DI: cero contacto con el `~/.kodo/` real del operador (dogfooding con secretos vivos).

## Task Commits

Cada tarea se ejecutó en TDD (RED → GREEN), commits atómicos:

1. **Task 1 (RED): needsSetup tests** - `86c53f8` (test)
2. **Task 1 (GREEN): needsSetup impl** - `a56adaf` (feat)
3. **Task 2 (RED): runUp setup-branch tests** - `4376db1` (test)
4. **Task 2 (GREEN): runUp pre-spawn branch** - `3effab0` (feat)

_TDD: cada tarea produjo un commit test + un commit feat. Sin fase refactor (código mínimo desde el molde)._

## Files Created/Modified
- `src/config.js` - Nuevo `export function needsSetup` junto a `isApiKeyConfigured`/`isReportToProviderEnabled`.
- `src/cli/up.js` - Seam `_needsSetup` + rama pre-spawn (1.5) entre baseUrl y ensure-daemon.
- `test/config.test.js` - `describe('SETUP-01 — needsSetup')` (8 casos + held-out) + `describe` source hygiene (2 casos).
- `test/cli/up.test.js` - `_needsSetup: () => false` en `makeDeps` + 5 asserts D-02/SC#1.

## Decisions Made
- **Seams DI adicionales (`_configExists`, `_isApiKeyConfigured`) más allá de la firma sugerida `(providerName, _loadConfig)`:** necesarios para aislar los tests del `~/.kodo/` real (dogfooding: config.json + .env con secretos vivos). Producción usa los defaults canónicos (`existsSync(CONFIG_PATH)`, `isApiKeyConfigured`) → comportamiento idéntico al contrato del plan; la firma pública sigue siendo `needsSetup(providerName)`. No es un cambio de comportamiento sino una extensión de testabilidad coherente con el molde DI del archivo.
- **Source-assertion de `process.exit` con strip de comentarios:** los JSDoc de `up.js` mencionan "process.exit" en prosa; el test descarta comentarios antes del grep (patrón canónico) para asertar solo código ejecutable.

## Deviations from Plan

None - plan executed exactly as written. La única extensión (seams DI extra para aislamiento de tests) está explícitamente amparada por la nota del plan "naming es discreción del planner (Assumption A2)" y por el `<dogfooding_guardrail>`, y no altera el contrato ni el comportamiento de producción.

## Issues Encountered
- El source-assertion inicial de `process.exit` daba falso positivo por las menciones en JSDoc de `up.js`. Resuelto añadiendo el strip de comentarios canónico antes del grep (mismo patrón que la source-hygiene de `config.test.js`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `needsSetup()` exportado y estable → listo para que el plan 68-02 lo consuma en `App.js`/`index.js` para decidir el render local del modo setup (D-01).
- El flag `setup:true` ya viaja de `runUp` a `runDashboard`; el plan 68-02 lo cablea a la prop de `App` y materializa la pantalla guiada.
- **GATE MANUAL pendiente (D3 coverage):** UAT en máquina limpia (sin `config.json`/`.env`) que confirme el modo setup servido sin `exit(1)` end-to-end — depende del render del plan 68-02.

## Self-Check: PASSED

- Files verified present: `src/config.js`, `src/cli/up.js`, `test/config.test.js`, `test/cli/up.test.js`, `68-01-SUMMARY.md`.
- Commits verified in git log: `86c53f8`, `a56adaf`, `4376db1`, `3effab0`.
- Full suite: 1771 pass, 0 fail (1 pre-existing todo). Target files: 37 pass, 0 fail.

---
*Phase: 68-dashboard-setup-mode-cfgf-03-first-run*
*Completed: 2026-07-02*
