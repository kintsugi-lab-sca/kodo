---
phase: 67-secrets-writer-masked-input
plan: 02
subsystem: cli-dashboard
tags: [secrets, masked-input, tui, ink, config-editor, di-callback, dotenv]

# Dependency graph
requires:
  - phase: 67-secrets-writer-masked-input (plan 01)
    provides: writeEnvVar(key, value, envPath) + isApiKeyConfigured consumido vía onSaveApiKey/indicador
  - phase: 63-config-editor-foundation
    provides: text-input controlado buffer/cursor + máquina config/config-edit + DI onSaveConfig
provides:
  - Renglón enmascarado de API key en el overlay de config (mask → `•` por char, valor real solo en memoria)
  - onSaveApiKey DI callback → writeEnvVar (en-proceso, jamás shell-out) + update de process.env cache
  - isApiKeyConfigured(provider) en config.js — prueba de presencia (nunca el valor)
  - Indicador [configurado]/[sin configurar] (D-09) + degradación non-TTY (Pitfall 16)
affects: [67-03-hygiene-grep, 68-setup-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "campo secreto = renglón APPEND fuera de getEditableFields (secreto nunca en config.json/PERSIST-04)"
    - "render enmascarado deriva `•` del length del buffer; el valor real vive solo en el state de App"
    - "DI puro del save (onSaveApiKey) → writeEnvVar en-proceso, jamás shell-out (Pitfall 11)"
    - "no duplicar validación en la UI: trust writeEnvVar; wrapper never-throws → {ok:false}"
    - "buffer + maskValue se limpian tras save Y cancel (Pitfall 6: sin secreto colgado en memoria)"

key-files:
  created:
    - test/dashboard-mask.test.js
  modified:
    - src/config.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/index.js

key-decisions:
  - "El campo de API key es un renglón DEDICADO APPEND tras los 11 campos de getEditableFields (índice fields.length), NO un campo editable normal → el secreto jamás entra a getEditableFields ni a config.json (PERSIST-04 intacto), pero tiene un hogar real, usable y testeable para el masked input + indicador + onSaveApiKey"
  - "APPEND (no PREPEND) para preservar los índices 0..10 → dashboard-config.test.js (que navega por índice) sigue verde sin tocarlo"
  - "NO se duplica validateEnvKey/validateEnvValue en App (instrucción del orquestador): onSaveApiKey confía en writeEnvVar para validar; el wrapper never-throws colapsa TypeError/false a {ok:false} → API_KEY_SAVE_FAILED. Único guard en App: buffer vacío → API_KEY_INVALID (afordancia UX, no re-implementa el regex)"
  - "isApiKeyConfigured consulta process.env cacheado (D-09 discreción) en vez de re-leer el .env: coherente con getProviderApiKey y refleja al instante el save (onSaveApiKey actualiza process.env[key])"
  - "El buffer del secreto arranca VACÍO al entrar al renglón (nunca precarga/lee el valor actual) — a diferencia de los campos normales que precargan getByPath (Pitfall 6/11)"

requirements-completed: []  # SETUP-03/04: masked input + indicador entregados aquí; hygiene grep pendiente en 67-03 → no se marca completa

coverage:
  - id: M1
    description: "mask=true pinta `•` por char y jamás el valor raw; mask=false pinta el buffer tal cual"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/dashboard-mask.test.js#render: máscara del text-input de API key"
        status: pass
    human_judgment: false
  - id: M2
    description: "onSaveApiKey recibe (api_key_env del provider, valor REAL); una sola llamada; aviso de reinicio"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/dashboard-mask.test.js#integración: onSaveApiKey recibe (api_key_env, valorReal)"
        status: pass
    human_judgment: false
  - id: M3
    description: "Indicador [configurado]/[sin configurar] refleja la presencia (D-09), nunca el valor"
    requirement: "SETUP-04"
    verification:
      - kind: unit
        ref: "test/dashboard-mask.test.js#render: indicador de presencia + integración isApiKeyConfiguredFn"
        status: pass
    human_judgment: false
  - id: M4
    description: "Degradación non-TTY (rawModeSupported=false) muestra el aviso a `kodo config` y gana al indicador (Pitfall 16, never-throws)"
    requirement: "SETUP-04"
    verification:
      - kind: unit
        ref: "test/dashboard-mask.test.js#render: degradación non-TTY"
        status: pass
    human_judgment: false
  - id: M5
    description: "El buffer se limpia tras cancelar (Esc): re-entrar muestra el campo vacío, sin secreto colgado (Pitfall 6)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/dashboard-mask.test.js#integración: buffer se limpia tras cancelar"
        status: pass
    human_judgment: false
  - id: M6
    description: "isApiKeyConfigured(provider) en config.js: true si process.env[api_key_env] no vacío; nunca expone el valor"
    requirement: "SETUP-04"
    verification:
      - kind: manual_procedural
        ref: "node -e import config.js → isApiKeyConfigured('plane') booleano (valor jamás impreso)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-02
status: complete
---

# Phase 67 Plan 02: Masked Input Component (Dashboard) Summary

**Campo enmascarado de API key en el overlay de config: renglón dedicado (fuera de `getEditableFields` → el secreto nunca cruza a `config.json`) que pinta `•` por carácter manteniendo el valor real solo en memoria, con save por DI `onSaveApiKey` → `writeEnvVar` en-proceso (jamás shell-out), indicador `[configurado]` de presencia y degradación non-TTY.**

## Performance
- **Duration:** ~8 min
- **Completed:** 2026-07-02
- **Tasks:** 7
- **Files modified:** 4 (1 creado, 3 modificados)

## Accomplishments
- **`isApiKeyConfigured(provider)`** en `src/config.js`: prueba de presencia (reusa `getProviderApiKey` sobre el cache de `process.env`), devuelve solo el booleano — nunca el valor (Pitfall 11).
- **Render enmascarado** en `SessionTable.renderConfigOverlay`: renglón APPEND de API key (índice `fields.length`) con tres pinturas en precedencia — degradación non-TTY (dim), edición enmascarada (`•` derivado del length del buffer, cursor `inverse` sobre la máscara), o indicador de presencia. El valor real jamás se renderiza raw.
- **Máquina config/config-edit** extendida en `App.js`: clamp de navegación sube a `fields.length` para alcanzar el renglón; Enter entra a `config-edit` con `maskValue=true` y **buffer VACÍO** (nunca precarga el secreto); Enter de guardado enruta a `onSaveApiKey`; Esc y save limpian buffer + máscara (Pitfall 6).
- **Cableado DI** en `index.js`: `onSaveApiKey` wrapper never-throws → `writeEnvVar` (atómico + chmod 0600 pre-rename, 67-01) **en-proceso, jamás shell-out** (Pitfall 11), + update de `process.env[key]` para que `[configurado]` se refleje al instante. `isApiKeyConfiguredFn` → `isApiKeyConfigured`.
- **8 tests nuevos** (`test/dashboard-mask.test.js`): render directo de SessionTable (máscara/indicador/degradación) + integración con App (callback recibe el valor real, buffer-clear tras cancelar, indicador). El callback es un **spy puro** → el `~/.kodo/.env` real (daemon vivo en dogfooding) **nunca se toca**; **no** se re-testea `writeEnvVar` (eso es 67-01).

## Task Commits
1. **Task 4 (helper presencia):** `2e97a60` — `isApiKeyConfigured` en config.js
2. **Task 2 (constantes + state + DI props):** `81189ac` — App.js
3. **Tasks 1+5 (render máscara + indicador + degradación):** `e23696b` — SessionTable.js
4. **Tasks 3+6 (handlers save + buffer cleanup):** `33a6e53` — App.js
5. **Wiring runtime:** `febae68` — index.js
6. **Task 7 (tests):** `ea16d00` — test/dashboard-mask.test.js

(Nota de mapeo: los 7 subtasks del PLAN se agruparon en 6 commits atómicos por dependencia — cada commit deja la suite verde. Tasks 1 y 5 comparten `renderConfigOverlay`; Tasks 3 y 6 comparten los handlers de `config-edit`. Más el commit de metadata de docs.)

## Deviations from Plan
- **[Rule 3 - Interpretación de scope] El campo de API key se implementó como renglón dedicado del overlay de config, no como uno de los campos editables.** El PLAN Task 2 dice "set maskValue=true al entrar a config-edit para el campo de API key", pero la lista de campos editables (`getEditableFields`) excluye deliberadamente los secretos (PERSIST-04, D-11 de Phase 63). Resolución: se añade un renglón APPEND separado que enruta a `writeEnvVar`/`.env` (no a `config.json`) — respeta PERSIST-04 y satisface todos los success criteria con una feature real y testeable. La UI de setup/first-run completa que consume esto es Phase 68 (aislamiento deliberado del CONTEXT).
- **[Rule 3 - Instrucción del orquestador] No se duplicó la validación de la key en App.** El orquestador indicó "trust writeEnvVar to validate; surface its error gracefully rather than duplicating validation". Se sigue esa vía: `onSaveApiKey` deja que `writeEnvVar` valide (Pitfall 14) y el wrapper never-throws colapsa el fallo a `{ok:false}` → `API_KEY_SAVE_FAILED`. Único guard en App: buffer vacío → `API_KEY_INVALID` (afordancia UX trivial, no re-implementa el regex).

## Issues Encountered
- Ninguno bloqueante. La navegación por índice del test existente (`dashboard-config.test.js`) exigía APPEND (no PREPEND) del renglón para no desplazar los índices 0..10 — se verificó verde.

## User Setup Required
None. El renglón queda cableado en el dashboard; la key se puede introducir con `e` → ↓ hasta "API key del provider" → Enter → teclear → Enter. Tras cambiarla hay que reiniciar el server/daemon (sin hot-reload en v0.15).

## Safety (dogfooding)
- El `~/.kodo/.env` real quedó **intacto** antes y después de toda la suite: exactamente `PLANE_API_KEY` + `PLANE_WEBHOOK_SECRET`, `0644`, sin `.env.tmp`.
- Leak-vector check: cero `console.*`/`execFile`/`spawn` del buffer/valor en App.js/SessionTable.js; el save es 100% en-proceso vía `writeEnvVar`.

## Next Phase Readiness
- **67-03 (hygiene grep):** el boundary en-proceso (sin shell-out, sin console del valor) ya está establecido en el carril del masked input — el grep de los 5 vectores puede extender el guard source-level de 67-01 cubriendo también App.js/SessionTable.js.
- **68 (setup mode):** puede reusar el renglón enmascarado + `onSaveApiKey` + `isApiKeyConfigured` para el first-run.
- Sin blockers.

## Self-Check: PASSED
- Files verified present: `src/config.js`, `src/cli/dashboard/App.js`, `src/cli/dashboard/SessionTable.js`, `src/cli/dashboard/index.js`, `test/dashboard-mask.test.js`, `67-02-SUMMARY.md`.
- Commits verified: `2e97a60`, `81189ac`, `e23696b`, `33a6e53`, `febae68`, `ea16d00`.
- Full suite green: 1748 pass / 0 fail / 1 skipped (pre-existente); +8 tests nuevos.
- Real `~/.kodo/.env` intacto (2 keys, 0644, sin `.env.tmp`).

---
*Phase: 67-secrets-writer-masked-input*
*Completed: 2026-07-02*
