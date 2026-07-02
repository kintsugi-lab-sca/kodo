---
phase: 67-secrets-writer-masked-input
plan: 03
subsystem: security-hygiene
tags: [secrets, hygiene-test, source-grep, leak-boundary, uat, atomic-write, chmod, dotenv]

# Dependency graph
requires:
  - phase: 67-secrets-writer-masked-input (plan 01)
    provides: writeEnvVar(key, value, envPath) + boundary source-level anti-shell-out (molde del grep)
  - phase: 67-secrets-writer-masked-input (plan 02)
    provides: masked buffer + onSaveApiKey DI (carril del dashboard cubierto por el grep)
provides:
  - Grep de higiene source-level (test/hygiene-api-key.test.js) — prueba de que el VALOR del secreto nunca alcanza los 5 sinks (D-08, P11 load-bearing UAT)
  - Detector no-trivial (fixtures positivo/negativo) reutilizable para futuros carriers/sinks
  - Test de permisos 0600 vía mode & 0o177 === 0 (DI temp path)
  - Test de seguridad atómica: 100 escrituras rápidas sin residual .env.tmp
  - 67-UAT-CHECKLIST.md — 8 pasos manuales de UAT runtime (ps/logs/status/perms)
affects: [68-setup-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "grep de higiene source-level: carrier del VALOR (process.env[...], *_API_KEY/_TOKEN/_SECRET, --api-key) DENTRO de la arglist de un sink ([^)]*), nunca el NOMBRE de la key (cero falsos positivos)"
    - "detector auto-verificado: fixtures sintéticos con fuga (debe marcar los 5 sinks) y limpios (uso in-proceso del nombre no marca) prueban que el test no es trivial"
    - "stripComments antes de escanear: las menciones del secreto en comentarios/JSDoc no cuentan como fuga (molde labels-hygiene.test.js)"
    - "tests de I/O del secreto SIEMPRE con DI a mkdtemp + assert notEqual del path real (dogfooding: daemon live, 100-write loop contra el real sería catastrófico)"

key-files:
  created:
    - test/hygiene-api-key.test.js
    - .planning/phases/67-secrets-writer-masked-input/67-UAT-CHECKLIST.md
  modified: []

key-decisions:
  - "Fichero nuevo test/hygiene-api-key.test.js (no extender config.test.js): agrupa las 3 tareas de verificación de seguridad de 67-03 en un solo módulo cohesivo (grep + perms + atómico), cambio quirúrgico sin tocar tests ajenos. La ubicación es discreción del planner (D-08)"
  - "Carrier = VALOR resuelto del secreto, no el NOMBRE: process.env[...] (acceso dinámico), env vars *_API_KEY/_TOKEN/_SECRET, y flags --api-key/--token. `[^)]*` exige que el carrier esté DENTRO de la arglist del sink → no marca `apiKey: process.env[...]` (construcción de cliente in-proceso, legítima, cli.js:734 / index.js:212) ni menciones del nombre (isApiKeyConfigured, api_key_env)"
  - "5 sinks cubiertos: argv(execFile/spawn/exec/fork), console.*, logger.*/NDJSON/appendFile, saveConfig, setOverlaySnapshot. Más un bloque específico del carril dashboard: el `buffer` enmascarado (valor real en memoria) no fluye a ningún sink (solo sale por onSaveApiKey)"
  - "Detector probado NO-trivial: un `it` marca un fixture con fuga en los 5 sinks (assert 5 sinks), otro `it` verifica que el uso legítimo del nombre NO se marca. Responde al guardrail 'no escribas un test que siempre pasa'"
  - "Task 2 usa la forma exacta del plan (mode & 0o177 === 0), complementaria al mode & 0o777 === 0o600 ya cubierto en 67-01 — verifica sin bits de grupo/otros/exec"
  - "Task 3 (100 writes) es el test NUEVO que 67-01 no tenía: prueba el rename atómico bajo bombardeo, sin acumulación de líneas ni .env.tmp residual"

requirements-completed: [SETUP-03, SETUP-04]

coverage:
  - id: H1
    description: "El VALOR resuelto del secreto (process.env[...]/--api-key) nunca alcanza argv/console/logger/config.json/overlay snapshot en src/**/*.js (D-08, P11)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#grep de higiene: el valor resuelto del secreto no alcanza los 5 sinks"
        status: pass
    human_judgment: false
  - id: H2
    description: "El buffer enmascarado del dashboard (valor real en memoria) no fluye a ningún sink (App.js/SessionTable.js); solo sale por onSaveApiKey (P11/P16)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#el buffer enmascarado del dashboard no fluye a ningún sink"
        status: pass
    human_judgment: false
  - id: H3
    description: "Sin shell-out del secreto: ningún flag CLI --api-key/--token en src; config.js no importa child_process (P11, vector de mayor riesgo)"
    requirement: "SETUP-04"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#sin shell-out del secreto"
        status: pass
    human_judgment: false
  - id: H4
    description: "El detector de fugas no es trivial: marca fixtures con fuga en los 5 sinks y NO marca el uso legítimo del nombre de la key"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#el detector de fugas NO es trivial (prueba positiva y negativa)"
        status: pass
    human_judgment: false
  - id: H5
    description: "El .env tras writeEnvVar es 0600: mode & 0o177 === 0 (sin grupo/otros/exec), vía DI temp path (Pitfall 13)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#permisos del .env: sin bits de grupo/otros ni ejecución"
        status: pass
    human_judgment: false
  - id: H6
    description: "100 escrituras rápidas: sin .env.tmp residual, .env final parseable (upsert, sin acumulación) y 0600 (Pitfall 13)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/hygiene-api-key.test.js#seguridad atómica: 100 escrituras rápidas no dejan .env.tmp"
        status: pass
    human_judgment: false
  - id: H7
    description: "UAT runtime documentado (8 pasos): ps sin key en argv, logs vacíos, /status sin key, .env 0600, sin .env.tmp, otras keys preservadas"
    requirement: "SETUP-04"
    verification:
      - kind: manual_procedural
        ref: ".planning/phases/67-secrets-writer-masked-input/67-UAT-CHECKLIST.md (8 pasos, ejecución humana contra daemon vivo)"
        status: pending
    human_judgment: true

# Metrics
duration: 12min
completed: 2026-07-02
status: complete
---

# Phase 67 Plan 03: Grep de Higiene + Tests de Seguridad Summary

**Grep de higiene source-level que prueba que el VALOR de la API key nunca alcanza los 5 sinks de fuga (argv/console/logger/config.json/overlay snapshot) — con un detector auto-verificado no-trivial que distingue el VALOR resuelto del NOMBRE legítimo de la key — más tests de permisos 0600 y de seguridad atómica bajo 100 escrituras, y una checklist de UAT runtime de 8 pasos.**

## Performance
- **Duration:** ~12 min
- **Completed:** 2026-07-02
- **Tasks:** 5 (Tasks 1-3 → 1 commit de test; Task 4 → 1 commit de docs; Task 5 → nota de integración, abajo)
- **Files:** 2 creados, 0 modificados de código de producción (fase de solo-verificación)

## Accomplishments
- **Grep de higiene de los 5 sinks (D-08, P11 load-bearing):** `test/hygiene-api-key.test.js` escanea `src/**/*.js` (tras `stripComments`) buscando el carrier del VALOR resuelto del secreto (`process.env[...]`, `*_API_KEY/_TOKEN/_SECRET`, flags `--api-key/--token`) DENTRO de la arglist (`[^)]*`) de cada sink: `execFile/spawn/exec/fork`, `console.*`, `logger.*/NDJSON/appendFile`, `saveConfig`, `setOverlaySnapshot`. Falla con `file:line [sink] → snippet`. **Cero fugas ahora.**
- **Carril del dashboard cubierto:** bloque adicional que verifica que el `buffer` enmascarado (valor real en memoria en App.js/SessionTable.js) no fluye a ningún sink — su única salida es `onSaveApiKey → writeEnvVar`.
- **Sin shell-out del secreto:** ningún flag CLI `--api-key/--token` construido en `src`; `config.js` sigue sin importar `child_process` (regresión del boundary in-proceso de 67-01).
- **Detector auto-verificado (no-trivial):** un `it` prueba que un fixture con fuga se marca en los **5 sinks**; otro `it` prueba que el uso legítimo del NOMBRE (`apiKey: process.env[...]` construyendo cliente, `isApiKeyConfigured`, `api_key_env`) **no** se marca. Responde al guardrail "no escribas un test que siempre pasa".
- **Permisos 0600 (Task 2):** `mode & 0o177 === 0` tras `writeEnvVar` (forma exacta del plan; complementa el `& 0o777 === 0o600` de 67-01).
- **Seguridad atómica (Task 3):** 100 `writeEnvVar` sucesivos → sin `.env.tmp` residual, `.env` final parseable (upsert `PLANE_API_KEY=secret_99`, sin acumulación de líneas) y 0600. Test NUEVO no presente en 67-01.
- **UAT checklist (Task 4):** `67-UAT-CHECKLIST.md`, 8 pasos manuales en español (ps/logs/`/status`/perms/`.env.tmp`/preservación de keys) para sign-off runtime contra daemon vivo.
- **Aislamiento total (dogfooding):** los tests de I/O usan `mkdtemp` + DI `envPath` y **asertan** que el path no es el `~/.kodo/.env` real. El loop de 100 escrituras jamás toca el fichero real (habría sido catastrófico con el daemon live).

## Task Commits
1. **Tasks 1+2+3 (grep 5 sinks + perms 0600 + atómico 100 writes):** `9a8b6b9` (test)
2. **Task 4 (UAT checklist runtime):** `32faf91` (docs)
3. **Plan metadata (SUMMARY + STATE + ROADMAP):** (este commit de docs)

(Nota de mapeo: Tasks 1-3 se agruparon en un commit de test porque comparten el mismo módulo `test/hygiene-api-key.test.js` y cada uno deja la suite verde. Task 5 es una nota de integración documental, sin código.)

## Task 5 — Nota de integración con Phase 68 (setup mode)
Phase 68 (setup mode / first-run) **consume** los tres activos entregados por la fase 67:
`writeEnvVar` (67-01), el renglón enmascarado + `onSaveApiKey` + `isApiKeyConfigured` (67-02) y
este grep de higiene (67-03) como **pre-requisito de seguridad**. El grep de higiene
(`test/hygiene-api-key.test.js`) es la garantía source-level de que el first-run puede usar el
masked input sin filtrar el secreto a ningún vector de render/log/argv; corre en la suite estándar
(`node --test`), así que cualquier regresión de fuga introducida por Phase 68 rompe el build antes
del merge. El UAT runtime de 8 pasos (`67-UAT-CHECKLIST.md`) debe ejecutarse **tras** cablear el
setup mode end-to-end, cuando ya hay un flujo first-run real que observar contra el daemon vivo.

## Deviations from Plan
- **[Rule 3 - Ubicación de test (discreción del planner)] Tasks 2 y 3 se colocaron en `test/hygiene-api-key.test.js`, no en `test/config.test.js`.** El PLAN Task 2 sugería `config.test.js`, pero 67-01 ya centralizó los tests del writer en `config-env-writer.test.js` y el CONTEXT (D-08) deja la ubicación a discreción del planner. Agrupar las 3 verificaciones de seguridad de 67-03 (grep + perms + atómico) en un módulo cohesivo es más quirúrgico (no toca tests ajenos) y mantiene la fase autocontenida. Los tests de perms/atómico son distintos a los de 67-01 (forma `& 0o177` exacta del plan + el loop de 100 escrituras que 67-01 no tenía), no duplicados.

## Issues Encountered
- Ninguno. El diseño del detector se validó con un probe (fixtures sintéticos + escaneo real) ANTES de escribir el test, confirmando 0 falsos positivos contra `src` (los `apiKey: process.env[...]` de `cli.js:734`/`index.js:212` NO se marcan porque son propiedades de construcción de cliente, no args de un sink) y detección efectiva de fugas sintéticas.

## User Setup Required
None. La checklist `67-UAT-CHECKLIST.md` es para ejecución humana futura (opcional, tras Phase 68); los pasos destructivos NO se ejecutaron aquí contra el entorno real.

## Safety (dogfooding)
- El `~/.kodo/.env` real quedó **intacto** antes y después de la suite completa: exactamente
  `PLANE_API_KEY` + `PLANE_WEBHOOK_SECRET`, `0644`, sin `.env.tmp`. Todos los tests de I/O usan DI a
  `mkdtemp` con assert explícito de que el path != `~/.kodo/.env`.

## Next Phase Readiness
- **Phase 68 (setup mode):** sin blockers. Reusa `writeEnvVar` + renglón enmascarado + `isApiKeyConfigured`; el grep de higiene protege contra regresiones de fuga en el nuevo flujo first-run; ejecutar el UAT runtime tras cablear el setup mode.
- Fase 67 cerrada: writer (01) + masked input (02) + boundary de fuga verificado (03). SETUP-03/04 completos.

## Self-Check: PASSED
- Files verified present: `test/hygiene-api-key.test.js`, `67-UAT-CHECKLIST.md`, `67-03-SUMMARY.md`.
- Commits verified: `9a8b6b9` (test), `32faf91` (docs).
- Full suite green: 1756 pass / 0 fail / 1 skipped (pre-existente); +8 tests nuevos.
- Real `~/.kodo/.env` intacto (2 keys, 0644, sin `.env.tmp`).

---
*Phase: 67-secrets-writer-masked-input*
*Completed: 2026-07-02*
