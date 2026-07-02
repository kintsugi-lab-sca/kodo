---
phase: 68-dashboard-setup-mode-cfgf-03-first-run
plan: 03
subsystem: cli-config
tags: [setup-05, single-writer, source-hygiene, persist-04, secret-boundary, gate-manual]

# Dependency graph
requires:
  - phase: 68-02
    provides: "mode:'setup' + renderSetupOverlay (máscara '•') + onSaveApiKey→writeEnvVar cableado"
  - phase: 67-secrets-writer-masked-input
    provides: "writeEnvVar (0600) + grep de higiene de los 5 sinks (test/config-env-writer.test.js:320-342)"
  - phase: 26
    provides: "interactiveConfig (kodo config) con lista canónica ['plane','github'] + presence-check getProviderApiKey"
provides:
  - "test/cli/config-writers.test.js — source-hygiene del invariante single-writer del wizard (SETUP-05)"
  - "Boundary PERSIST-04 re-verificado tras el modo setup: held-out extendido a las rutas de render/handler de 68-02"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Source-hygiene por recorte de índice + doesNotMatch sobre el cuerpo de una función (molde config.test.js:85-105 + config-env-writer.test.js:320-342)"
    - "Invariante single-writer blindado por lectura de fuente: ausencia de writeEnvVar en el wizard ⇒ el valor del secreto entra SOLO por el campo enmascarado del dashboard (D-11)"

key-files:
  created:
    - test/cli/config-writers.test.js
  modified:
    - test/config-env-writer.test.js

key-decisions:
  - "Rewire de interactiveConfig = no-op documentado (Assumption A4 confirmada): el wizard YA persiste solo vía saveConfig/saveProjects, YA comprueba presencia con getProviderApiKey sin capturar el valor, YA usa la lista canónica ['plane','github']. Cero cambios a src/cli.js — el trabajo es el test que lo mantiene verdadero."
  - "El held-out de PERSIST-04 (Phase 67) se EXTIENDE, no se reescribe: los asserts sobre writeEnvVar quedan intactos; se añaden asserts source-level sobre renderSetupOverlay (máscara '•'.repeat) y el handler del paso apikey (setBuffer('') + no-onSaveConfig + no-console + no-loadEnvFile)."
  - "La ausencia de writeEnvVar en el cuerpo de interactiveConfig es la aserción central de no-captura: el wizard nunca escribe el secreto; el valor es exclusivo del campo enmascarado del dashboard (D-11)."

patterns-established:
  - "Un test de source-hygiene fija el invariante single-writer sin ejecutar el wizard (readline no es DI-zable sin un TTY simulado): leer src/cli.js y asseverar doesNotMatch de los vectores de divergencia/fuga sobre el cuerpo de la función."

requirements-completed: [SETUP-05]

coverage:
  - id: D1
    description: "interactiveConfig persiste config/proyectos SOLO vía saveConfig/saveProjects (sin writers directos de config.json/.env) — SETUP-05/D-10"
    requirement: "SETUP-05"
    verification:
      - kind: unit
        ref: "test/cli/config-writers.test.js#persiste config/proyectos SOLO vía saveConfig/saveProjects"
        status: pass
    human_judgment: false
  - id: D2
    description: "El wizard comprueba PRESENCIA de la key (getProviderApiKey) sin capturar su valor ni escribirla (writeEnvVar ausente) — D-10/D-11/T-68-08"
    requirement: "SETUP-05"
    verification:
      - kind: unit
        ref: "test/cli/config-writers.test.js#comprueba la PRESENCIA de la key sin capturar su valor"
        status: pass
    human_judgment: false
  - id: D3
    description: "interactiveConfig no shell-out del secreto (sin child_process/execFile/spawn/exec) — T-68-08/Pitfall 11"
    requirement: "SETUP-05"
    verification:
      - kind: unit
        ref: "test/cli/config-writers.test.js#NO shell-out del secreto"
        status: pass
    human_judgment: false
  - id: D4
    description: "Boundary PERSIST-04 (5 sinks) verde tras el modo setup: máscara '•' en el render, buffer limpiado, sin config.json/console/loadEnvFile del valor — T-68-09"
    requirement: "SETUP-05"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#el modo setup (68-02) no amplía la superficie de fuga (5 sinks)"
        status: pass
    human_judgment: false
  - id: D5
    description: "GATE MANUAL LOCKED: UAT del ciclo first-run en máquina limpia (TTY real + disco limpio + 2º arranque KODO_DEV=1) — los 6 pasos del checkpoint"
    requirement: "SETUP-01/02/05"
    verification: []
    human_judgment: true
    rationale: "El ciclo real (TTY + ~/.kodo/ limpio en disco + spawn del daemon + webhook secret) NO es observable por unit tests DI (dogfooding con secretos vivos). GATE MANUAL LOCKED heredado del ROADMAP. PENDIENTE de aprobación humana — la fase NO se declara cerrada hasta 'approved'."

# Metrics
duration: ~11min
completed: 2026-07-02
status: awaiting-human-gate
---

# Phase 68 Plan 03: Cierre de SETUP-05 + re-verificación PERSIST-04 (single-writer) Summary

**SETUP-05 cerrado por source-hygiene: `test/cli/config-writers.test.js` fija que el wizard `kodo config` (interactiveConfig) persiste SOLO vía `saveConfig`/`saveProjects`, comprueba la PRESENCIA de la key (`getProviderApiKey`) sin capturar su valor ni escribirla (`writeEnvVar` ausente del wizard, D-11) y no shell-out del secreto; el held-out de PERSIST-04 de Phase 67 se extiende a las rutas del modo setup de 68-02 (máscara `'•'`, buffer limpiado, sin sinks config.json/console/loadEnvFile). El rewire de interactiveConfig fue un no-op documentado (ya cumplía). GATE MANUAL LOCKED (UAT máquina limpia) PENDIENTE de aprobación humana.**

## Performance

- **Duration:** ~11 min
- **Tasks:** 3 (Task 1 + Task 2 automatizados y committeados; Task 3 = GATE MANUAL pendiente de humano)
- **Files created:** 1 · **Files modified:** 1 (`src/cli.js` sin cambios — no-op verificado)

## Accomplishments

- **SETUP-05 (Task 1):** verificado que `interactiveConfig` (src/cli.js:576-793) YA converge en los escritores compartidos — no hay `writeFileSync`/`writeFileAtomic`/`renameSync` directo sobre `config.json`/`.env` (todo por `saveConfig`/`saveProjects`), la comprobación de la key es de PRESENCIA (`getProviderApiKey`, cli.js:613) sin `rl.question` del valor, y la lista de proveedores es la canónica `['plane','github']` (cli.js:588). Assumption A4 confirmada → **cero cambios de código**; el deliverable es `test/cli/config-writers.test.js` (5 asserts) que mantiene el invariante verdadero. La ausencia de `writeEnvVar` en el cuerpo del wizard es la aserción central de no-captura del secreto (D-11).
- **PERSIST-04 (Task 2):** el held-out de higiene de Phase 67 (`test/config-env-writer.test.js`) se **extiende** a las superficies añadidas en 68-02 sin debilitar los asserts previos: (a) `renderSetupOverlay` enmascara SIEMPRE el paso apikey (`setupStep === 'apikey' ? '•'.repeat(buffer.length) : buffer`) — el buffer raw jamás se pinta (sink overlay-snapshot); (b) el handler del paso apikey limpia el buffer (`setBuffer('')`) tras guardar (sink memoria, Pitfall 6); (c) el save enruta a `onSaveApiKey` (→`writeEnvVar`/`.env`), NO a `onSaveConfig` (sink config.json); (d) ni el render ni el handler loguean el valor (sink console/logger); (e) App.js no re-invoca `loadEnvFile` (D-09, única mención = comentario prohibitivo). Los asserts de Phase 67 sobre `writeEnvVar` (in-proceso, sin shell-out, sin console) permanecen intactos.
- **Suites:** `test/cli/config-writers.test.js` 5/5 · `test/config-env-writer.test.js` 38/38 (+6 nuevos) · `npm test` completo **1788 pass / 0 fail / 1 skipped** — el modo setto no regresiona ninguna higiene.

## Task Commits

1. **Task 1:** `7e36469` — `test(68-03)` `test/cli/config-writers.test.js`: single-writer + presence-only + no-shell-out + lista canónica (SETUP-05/D-10/D-11).
2. **Task 2:** `5e4e884` — `test(68-03)` extiende el held-out de PERSIST-04 a las rutas del modo setup (5 sinks) sin tocar `writeEnvVar`.

## Files Created/Modified

- `test/cli/config-writers.test.js` (nuevo) — source-hygiene del cuerpo de `interactiveConfig`: 5 asserts (existe · saveConfig/saveProjects únicos escritores · getProviderApiKey presencia + writeEnvVar ausente · no child_process/execFile/spawn/exec · lista `['plane','github']`).
- `test/config-env-writer.test.js` — nuevo bloque `describe('PERSIST-04 — el modo setup (68-02) no amplía la superficie de fuga (5 sinks)')`: 6 asserts source-level sobre `renderSetupOverlay` (SessionTable.js) y el handler del paso apikey (App.js).
- `src/cli.js` — **sin cambios** (rewire = no-op verificado; ya cumplía SETUP-05/D-10/D-11).

## Decisions Made

- **Rewire de interactiveConfig = no-op documentado (Assumption A4):** el plan preveía "verificar y ajustar solo si diverge". No diverge — el wizard ya usa los escritores compartidos, ya comprueba presencia sin capturar el valor y ya usa la lista canónica. El valor de SETUP-05 es el test que blinda ese estado, no un cambio de código.
- **Ausencia de `writeEnvVar` en el wizard como aserción de no-captura:** en vez de intentar grep-negar infinitas formas de "capturar el valor", el invariante robusto es estructural — el wizard nunca escribe el secreto (solo el campo enmascarado del dashboard lo hace, D-11). `doesNotMatch(/writeEnvVar\s*\(/)` sobre el cuerpo lo fija sin fragilidad.
- **Extender, no reescribir, el held-out de Phase 67:** los asserts sobre `writeEnvVar` (el ESCRITOR) quedan intactos; se añade cobertura de las rutas de RENDER/HANDLER que 68-02 introdujo, manteniendo el test como la red de seguridad única de PERSIST-04.
- **Disciplina Pitfall 11 en los mensajes del test:** los sinks se describen por concepto (argv/console/logger/config.json/overlay); ninguna cadena incrusta el nombre literal de la env var del secreto ni su valor.

## Deviations from Plan

None de comportamiento — plan ejecutado según lo escrito. Task 1 resultó un no-op de código (esperado por Assumption A4): la verificación confirmó conformidad, así que el único artefacto de Task 1 es el test. No se tocó `src/cli.js`.

## Issues Encountered

Ninguno. Las dos suites objetivo y la suite completa pasaron a la primera.

## User Setup Required

**GATE MANUAL LOCKED pendiente (D5, Task 3) — la fase NO se declara cerrada hasta aprobación humana.** UAT del ciclo first-run en **máquina limpia** (HOME/entorno temporal sin `~/.kodo/config.json` ni `~/.kodo/.env`), 6 pasos:

1. `kodo up` en TTY real → sirve el dashboard en modo setup SIN `exit(1)`, no arranca el daemon (D-02), no crashea.
2. Completar los 4 pasos (provider `plane` → base_url → workspace_slug → API key en campo enmascarado, SOLO `•` por carácter) → aviso de reinicio honesto + nota del webhook secret (D-08/D-12).
3. Inspeccionar disco: `~/.kodo/config.json` con provider/base_url/workspace_slug; `~/.kodo/.env` con permisos `0600` y la key (NO en config.json). El valor NO aparece en scrollback / `~/.kodo/logs` / `ps`.
4. Transición honesta (Pitfall 15/D-09): el indicador de presencia se refleja al instante (leído del estado fresco, no de caché).
5. 2º arranque `KODO_DEV=1 kodo up` (o `--insecure`, D-12): `needsSetup()` false → daemon arranca → tabla viva. (Sin `KODO_DEV=1`, documentar que el daemon requiere `KODO_WEBHOOK_SECRET_PLANE` por fuera — NO es fallo del setup.)
6. Caso non-TTY (D-13): `kodo up | cat` NO cuelga ni crashea; degrada con mensaje que remite a `kodo config`.

**Dogfooding:** la UAT debe correr en un HOME temporal limpio — NUNCA mutar el `~/.kodo/` real (daemon vivo + secretos reales).

## Next Phase Readiness

- SETUP-05 cerrado a nivel de código/tests: wizard y dashboard convergen en `saveConfig`/`saveProjects`/`writeEnvVar`; el boundary PERSIST-04 sigue verde tras el modo setup.
- **Cierre del milestone v0.15 bloqueado por el GATE MANUAL LOCKED** (Task 3) — al aprobarse ("approved"), la fase 68 y v0.15 quedan listas para `/gsd-complete-milestone`.

## Self-Check: PASSED

- Files verified present: `test/cli/config-writers.test.js`, `test/config-env-writer.test.js`, `68-03-SUMMARY.md`.
- Commits verified in git log: `7e36469`, `5e4e884`.
- Suites: config-writers 5/5 · config-env-writer 38/38 · `npm test` completo 1788 pass / 0 fail / 1 skipped.

---
*Phase: 68-dashboard-setup-mode-cfgf-03-first-run*
*Automated tasks completed: 2026-07-02 · GATE MANUAL (Task 3) pendiente de aprobación humana*
