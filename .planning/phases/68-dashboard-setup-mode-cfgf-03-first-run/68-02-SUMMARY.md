---
phase: 68-dashboard-setup-mode-cfgf-03-first-run
plan: 02
subsystem: cli-dashboard
tags: [first-run, onboarding, setup-mode, tui, ink, masked-input, state-machine]

# Dependency graph
requires:
  - phase: 68-01
    provides: "needsSetup() helper + flag setup:true propagado por runUp→runDashboard"
  - phase: 67-secrets-writer-masked-input
    provides: "onSaveApiKey→writeEnvVar + masked field molde (App.js:1029-1057) + API_KEY_* constants"
  - phase: 63-config-editor-foundation
    provides: "renderConfigOverlay molde + onSaveConfig/loadConfigFn wrappers + config-edit text-input"
provides:
  - "mode:'setup' — 15º modo de la state-machine del dashboard (wizard lineal de 4 pasos, D-04)"
  - "16 constantes SETUP_* exportadas de App.js (copy literal-estable, español)"
  - "renderSetupOverlay (SessionTable.js) — molde exacto de renderConfigOverlay con máscara '•' + degradación non-TTY"
  - "runDashboard({ setup }) cableado + needsSetupFn prop (circuito runUp→index→App)"
affects: [68-03-kodo-config-rewire]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wizard lineal como sub-máquina de un modo terminal (setupStep provider/base_url/workspace_slug/apikey/complete)"
    - "Reuso ~90%: text-input de config-edit + masked field de Phase 67 + molde renderConfigOverlay; único código nuevo = rama setup + selector + copy"
    - "Máscara incondicional del secreto en el paso apikey del render (defensa T-68-04, no depende de un flag colgable)"

key-files:
  created:
    - test/dashboard/app-setup.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/index.js

key-decisions:
  - "El paso terminal 'complete' es un sub-estado del modo setup (no focusError) → SETUP_COMPLETE_RESTART + SETUP_WEBHOOK_NOTE se pintan estables sin que el clear-on-any-input los consuma"
  - "SETUP_GITHUB_REDIRECT usa focusError/footerColor (aviso transitorio yellow) — semántica idéntica a los avisos existentes; no avanza el guiado ni escribe estructurales (D-06)"
  - "Validación base_url/workspace_slug con substring puro (includes ' '/'#'/'=' + no-vacío) — anti-ReDoS, jamás compila regex del input"
  - "D-09 honrado: la confirmación tras guardar la key NO re-invoca loadEnvFile (única mención de loadEnvFile en App.js es el comentario que lo prohíbe)"
  - "El render del paso apikey enmascara SIEMPRE ('•'.repeat(buffer.length)) — el valor jamás cruza a lastFrame (T-68-04, held-out verde)"

patterns-established:
  - "SETUP_PROVIDERS exportado de App.js (fuente única del selector ['plane','github']) → mata el drift entre handler y render"
  - "Efecto de montaje congela configSnapshot en setup (structuredClone(loadConfigFn())) → los saves estructurales mutan solo el clon"

requirements-completed: [SETUP-02]

coverage:
  - id: D1
    description: "El dashboard entra en mode:'setup' en first-run (título + paso 1/4 provider), no en la tabla (D-01/D-04)"
    requirement: "SETUP-01"
    verification:
      - kind: unit
        ref: "test/dashboard/app-setup.test.js#(a) mount con setup:true entra en modo setup"
        status: pass
    human_judgment: false
  - id: D2
    description: "Selector provider: plane guarda config.provider vía onSaveConfig y avanza; github muestra SETUP_GITHUB_REDIRECT y no avanza (D-05/D-06)"
    requirement: "SETUP-02"
    verification:
      - kind: unit
        ref: "test/dashboard/app-setup.test.js#(b) Enter en plane / #(c) Enter en github"
        status: pass
    human_judgment: false
  - id: D3
    description: "base_url/workspace_slug persisten a providers.plane.* vía onSaveConfig (SETUP-02)"
    requirement: "SETUP-02"
    verification:
      - kind: unit
        ref: "test/dashboard/app-setup.test.js#(d) base_url y workspace_slug persisten al path correcto"
        status: pass
    human_judgment: false
  - id: D4
    description: "API key enmascarada '•' (valor nunca en lastFrame, T-68-04), persiste vía onSaveApiKey, aviso de reinicio honesto (D-08/D-11)"
    requirement: "SETUP-02"
    verification:
      - kind: unit
        ref: "test/dashboard/app-setup.test.js#(e) apikey se enmascara y persiste + held-out de no-fuga"
        status: pass
    human_judgment: false
  - id: D5
    description: "non-TTY degrada a SETUP_NO_RAWMODE dentro del render, never-throws (D-13); guard index.js intacto"
    requirement: "SETUP-01"
    verification:
      - kind: unit
        ref: "test/dashboard/app-setup.test.js#(f) rawModeSupported:false → SETUP_NO_RAWMODE"
        status: pass
    human_judgment: false
  - id: D6
    description: "GATE MANUAL: UAT en máquina limpia (TTY real) — el modo setup renderiza el wizard completo y la transición es honesta end-to-end"
    requirement: "SETUP-01/02"
    verification: []
    human_judgment: true
    rationale: "El render TUI real (ink en terminal) y la escritura efectiva a ~/.kodo/ no son observables por unit tests DI (dogfooding con secretos vivos). Gate manual heredado del ROADMAP (D3 de 68-01)."

# Metrics
duration: ~7min
completed: 2026-07-02
status: complete
---

# Phase 68 Plan 02: Modo setup del dashboard (wizard lineal de 4 pasos) Summary

**Nuevo `mode:'setup'` en la state-machine del dashboard: wizard lineal de 4 pasos (provider → base_url → workspace_slug → API key enmascarada, D-04) con 16 constantes `SETUP_*` exportadas, `renderSetupOverlay` molde-exacto de `renderConfigOverlay` (máscara `•` + degradación non-TTY honesta), reusando ~90% de las piezas de Phases 63/67 sin escritores nuevos.**

## Performance

- **Duration:** ~7 min
- **Tasks:** 3 (Task 1 RED, Task 2 GREEN, Task 3 wiring)
- **Files modified:** 3 · **Files created:** 1

## Accomplishments

- **App.js:** 16 constantes `SETUP_*` exportadas (+ `SETUP_PROVIDERS`), `mode:'setup'` con sub-pasos `provider/base_url/workspace_slug/apikey/complete`. El selector de provider (clamp sin wrap) enruta `plane`→guiado / `github`→`SETUP_GITHUB_REDIRECT` (D-06, sin escritura estructural). Los pasos estructurales guardan vía `structuredClone(configSnapshot)+setByPath+onSaveConfig`; el paso apikey reusa LITERAL el flujo de Phase 67 (`onSaveApiKey`→éxito limpia buffer+máscara→estado terminal `complete`). Esc never-throws (en apikey limpia el secreto de memoria).
- **SessionTable.js:** `renderSetupOverlay` (gutter width:2 + label width:24 + título cyan/bold + cabecera de paso dim + cursor inverse + máscara `'•'.repeat`) importando las `SETUP_*` de App.js (mata el drift). Rama de dispatch `mode==='setup'`. Degradación non-TTY (`!rawModeSupported → SETUP_NO_RAWMODE`) dentro del render (D-13).
- **index.js:** `runDashboard({ setup })` propaga el flag como prop; `needsSetup` añadido al lazy import compartido de `config.js` → prop `needsSetupFn` (D-01). Reuso de los wrappers `onSaveConfig`/`onSaveApiKey`/`isApiKeyConfiguredFn` — cero escritores nuevos. Guard non-TTY de `index.js` intacto (D-13).
- **Seguridad (T-68-04):** el paso apikey enmascara SIEMPRE en el render; el held-out asserta que el valor tecleado NUNCA aparece en `lastFrame()`. El grep de higiene de Phase 67 sigue verde.

## Task Commits

1. **Task 1 (RED):** `5ee5af3` — `test(68-02)` app-setup.test.js con 6 casos (a)-(f) + held-out T-68-04, RED por `SETUP_*`/`mode:'setup'` ausentes.
2. **Task 2 (GREEN):** `7be6ff7` — `feat(68-02)` 16 `SETUP_*` + `mode:'setup'` (App.js) + `renderSetupOverlay` (SessionTable.js); app-setup verde + app-dismiss sin regresión.
3. **Task 3 (wiring):** `4c72144` — `feat(68-02)` `runDashboard({ setup })` + `needsSetupFn` en index.js; circuito runUp→index→App verde.

## Files Created/Modified

- `test/dashboard/app-setup.test.js` (nuevo) — state-machine del modo setup (ink-testing-library), 6 casos + held-out de no-fuga del secreto.
- `src/cli/dashboard/App.js` — 16 constantes `SETUP_*` + `SETUP_PROVIDERS` exportadas; `mode:'setup'` + sub-pasos; efecto de montaje que congela `configSnapshot`; rama `mode==='setup'` en `useInput`; props `setupStep`/`providerCursor` al dispatch.
- `src/cli/dashboard/SessionTable.js` — import de las `SETUP_*`; `renderSetupOverlay`; rama de dispatch `mode==='setup'`; props `setupStep`/`providerCursor`.
- `src/cli/dashboard/index.js` — `setup` en deps + prop de App; `needsSetup` en el lazy import + `needsSetupFn` prop; guard non-TTY intacto.

## Decisions Made

- **Paso terminal `complete` como sub-estado (no `focusError`):** garantiza que `SETUP_COMPLETE_RESTART` + `SETUP_WEBHOOK_NOTE` se pinten estables tras guardar la key, sin que el `clear-on-any-input` (que consume `focusError`) los borre. Alinea con el requisito de "aviso honesto de dos líneas" del UI-SPEC.
- **`SETUP_GITHUB_REDIRECT` vía `focusError`/`footerColor` (yellow transitorio):** semántica idéntica a los avisos existentes (`CONFIG_SAVED_RESTART`/`DISMISS_*`); no avanza el guiado ni escribe estructurales (D-06). Con solo un Enter en el flujo github, el aviso permanece visible para la aserción.
- **Máscara incondicional en el render del paso apikey:** el setup apikey es SIEMPRE una entrada de secreto → `renderSetupOverlay` deriva `'•'.repeat(buffer.length)` sin depender del flag `maskValue` (que se mantiene por paridad con Phase 67 pero no es load-bearing para la pintura). Defensa en profundidad contra T-68-04.
- **`SETUP_PROVIDERS` exportado (17ª constante):** fuente única del selector `['plane','github']` consumida por el handler (clamp) y el render (lista) → mata el drift. El plan pedía 16 constantes de copy; `SETUP_PROVIDERS` es el array-helper del selector referenciado explícitamente en el propio plan/UI-SPEC.

## Deviations from Plan

None de comportamiento — plan ejecutado según lo escrito. Dos precisiones de implementación amparadas por el plan (mecanismo a discreción):

1. **[Rule 2 - Robustez] Efecto de montaje para `configSnapshot` en setup:** el plan asume `configSnapshot` disponible para `setByPath`; se añadió un `useEffect` que lo congela (`structuredClone(loadConfigFn())`) al arrancar en setup, con fail-open defensivo (`configSnapshot ?? structuredClone(loadConfigFn())`) en el handler. Necesario para que los saves estructurales muten un clon propio (Pitfall 1). No altera el contrato.
2. **Estado terminal `complete` añadido al union de `setupStep`:** el plan lista 4 sub-pasos (provider/base_url/workspace_slug/apikey); se añadió `complete` como estado terminal del aviso de reinicio (D-08). Es la materialización natural de "al completar el setup se muestra el aviso" del plan.

## Issues Encountered

- Error de sintaxis inicial en el test (backtick anidado dentro de un template literal en el mensaje de aserción de la máscara). Resuelto reemplazando el mensaje por texto plano ("máscara de puntos").

## User Setup Required

None — sin configuración de servicio externo. **GATE MANUAL pendiente (D6):** UAT en máquina limpia (TTY real) que confirme el wizard renderizado end-to-end y la escritura efectiva a `~/.kodo/` — heredado del ROADMAP (no observable por unit tests DI con secretos vivos).

## Next Phase Readiness

- `mode:'setup'` + `renderSetupOverlay` + el circuito `runUp→index→App` listos → plan 68-03 puede re-cablear `kodo config` sobre estas piezas.
- El boundary PERSIST-04/T-68-04 se mantiene: el valor de la API key nunca cruza al render (held-out verde), y el grep de higiene de Phase 67 (los 5 sinks) sigue verde — 68-03 lo re-verifica.

## Self-Check: PASSED

- Files verified present: `test/dashboard/app-setup.test.js`, `src/cli/dashboard/App.js`, `src/cli/dashboard/SessionTable.js`, `src/cli/dashboard/index.js`, `68-02-SUMMARY.md`.
- Commits verified in git log: `5ee5af3`, `7be6ff7`, `4c72144`.
- Suites: app-setup + app-dismiss + up = 27 pass, 0 fail; dashboard completo = 363 pass, 0 fail; higiene-api-key = 40 pass, 0 fail.

---
*Phase: 68-dashboard-setup-mode-cfgf-03-first-run*
*Completed: 2026-07-02*
