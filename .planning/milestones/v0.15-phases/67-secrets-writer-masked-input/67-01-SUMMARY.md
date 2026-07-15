---
phase: 67-secrets-writer-masked-input
plan: 01
subsystem: infra
tags: [secrets, dotenv, atomic-write, chmod, config, node-fs]

# Dependency graph
requires:
  - phase: 65-daemon-lifecycle-foundation
    provides: writePidFile chmod-pre-rename atomic pattern (polling-daemon.js:94-101)
  - phase: 63-config-editor-foundation
    provides: writeFileAtomic + DI-por-parámetro convention en config.js
provides:
  - writeEnvVar(key, value, envPath=ENV_PATH) — escritor único de secretos a ~/.kodo/.env
  - validateEnvKey / validateEnvValue — validadores puros (Pitfall 14)
  - Patrón parse-merge-write que preserva otras keys verbatim (no clobber)
  - chmod 0600 pre-rename para el .env (Pitfall 13)
  - ENV_PATH exportado desde el barrel de config.js
affects: [67-02-masked-input, 67-03-hygiene-grep, 68-setup-mode]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "chmod-0600-pre-rename para ficheros sensibles (espejo de writePidFile, NO writeFileAtomic)"
    - "parse-merge-write: upsert de una key preservando el resto de líneas verbatim"
    - "validar+rechazar caracteres especiales en vez de escapar (Pitfall 14)"
    - "DI del path por parámetro para aislar tests de KODO_DIR cacheado al import (Pitfall 21811)"
    - "contrato de fallo dual: throw en input inválido, never-throws (false) en I/O"

key-files:
  created:
    - test/config-env-writer.test.js
  modified:
    - src/config.js

key-decisions:
  - "writeEnvVar NO reusa writeFileAtomic (sin chmod → fuga 0644); implementa su propia secuencia espejo de writePidFile con chmod 0600 pre-rename (Pitfall 13 LOAD-BEARING)"
  - "Validación estricta: rechaza #, =, y TODO whitespace (superset de 'leading spaces'; el \\n/\\r es el vector real de inyección de líneas) + vacío. Las API keys reales no usan estos caracteres, así que la restricción es zero-cost"
  - "envPath como parámetro DI (default ENV_PATH) para aislar tests del ~/.kodo/.env real sin depender del redirect de HOME (Pitfall 21811)"
  - "Contrato de fallo dual: throw TypeError en input inválido (bug del caller, pre-validable), never-throws (return false) ante fallo de I/O"
  - "Test file nuevo (config-env-writer.test.js) en vez de extender config.test.js — molde de config-atomic.test.js, mantiene el foco (discreción del planner sobre ubicación del test)"

patterns-established:
  - "Secret writer boundary: escritura in-proceso siempre, jamás shell-out (guard source-level anti child_process/exec/spawn/console) — base del grep de higiene de 67-03"
  - "mkdirSync(dirname(path), {recursive, mode:0o700}) + writeFileSync(tmp,{mode:0o600}) + chmodSync(tmp,0o600) + renameSync"

requirements-completed: []  # SETUP-03 solo parcialmente (writer); masked input + hygiene grep en 67-02/03. No se marca completa aún.

coverage:
  - id: D1
    description: "writeEnvVar crea/upserta una key en ~/.kodo/.env preservando las demás (parse-merge-write, no clobber)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#writeEnvVar: write / upsert / merge"
        status: pass
    human_judgment: false
  - id: D2
    description: "El .env final es 0600 (rw-------) inmediatamente tras el write, sin .env.tmp residual (Pitfall 13 atómico)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#permisos 0600 (Pitfall 13, LOAD-BEARING)"
        status: pass
      - kind: unit
        ref: "test/config-env-writer.test.js#atomicidad (Pitfall 13 rename)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Validación rechaza #, =, whitespace y vacío; writeEnvVar throws TypeError y no crea el fichero (Pitfall 14)"
    requirement: "SETUP-03"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#validateEnvKey / validateEnvValue"
        status: pass
      - kind: unit
        ref: "test/config-env-writer.test.js#writeEnvVar rechaza input inválido (throw TypeError)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Boundary in-proceso: config.js no importa child_process; writeEnvVar no hace exec/spawn ni console-logea el valor (Pitfall 11 argv leak)"
    requirement: "SETUP-04"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#boundary de fuga (Pitfall 11): writeEnvVar es in-proceso"
        status: pass
    human_judgment: false
  - id: D5
    description: "Aislamiento DI: envPath inyectado mantiene el write en tmpdir; el ~/.kodo/.env real queda intacto (Pitfall 21811)"
    verification:
      - kind: unit
        ref: "test/config-env-writer.test.js#invariante DI (Pitfall 21811: KODO_DIR cacheado al import)"
        status: pass
      - kind: manual_procedural
        ref: "ls -l ~/.kodo/.env + grep TEST_KEY/SENTINEL tras la suite completa (2 keys, 0644, sin artefactos)"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-07-02
status: complete
---

# Phase 67 Plan 01: writeEnvVar Module Foundation Summary

**`writeEnvVar` — escritor único de secretos a `~/.kodo/.env`: parse-merge-write que no clobbea otras keys + chmod 0600 pre-rename atómico + validación estricta, con DI de path para aislamiento total del `.env` real.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-02T10:08:00Z (aprox.)
- **Completed:** 2026-07-02T10:15:00Z (aprox.)
- **Tasks:** 4
- **Files modified:** 2 (1 creado, 1 modificado)

## Accomplishments
- `writeEnvVar(key, value, envPath=ENV_PATH)` en `src/config.js`: lee el `.env` con el mismo parser naive de `loadEnvFile`, hace **upsert** de la key objetivo y **preserva verbatim** el resto (otras keys, comentarios, líneas en blanco). Crea el `.env` si no existe. Idempotente.
- Secuencia atómica **espejo de `writePidFile`** (NO `writeFileAtomic`): `writeFileSync(tmp,{mode:0o600})` → `chmodSync(tmp,0o600)` **pre-rename** → `renameSync`. El fichero final es 0600 el instante en que aparece (Pitfall 13 LOAD-BEARING).
- `validateEnvKey`/`validateEnvValue`: rechazan `#`, `=`, whitespace (incl. `\n`/`\r`) y vacío (Pitfall 14, validar+rechazar).
- 32 tests nuevos, todos aislados vía `mkdtemp` + DI `envPath` — el `~/.kodo/.env` real (daemon live en dogfooding) **nunca se toca**.
- Guard source-level anti-shell-out (no `child_process`/`exec`/`spawn`/`console` en el writer): base del grep de higiene de 67-03 (Pitfall 11).

## Task Commits

Cada tarea se comiteó atómicamente:

1. **Task 1: Core `writeEnvVar` + validadores + export** - `694bade` (feat)
2. **Task 2: Tests de validación (Pitfall 14)** - `dacbf7b` (feat)
3. **Task 3: Tests de comportamiento (merge, 0600, atómico, idempotencia)** - `8026114` (feat)
4. **Task 4: Invariantes DI (21811) + boundary de fuga (11)** - `d710478` (feat)

**Plan metadata:** (este commit de docs)

## Files Created/Modified
- `src/config.js` - Añade `writeEnvVar`, `validateEnvKey`, `validateEnvValue`; importa `chmodSync`/`dirname`; exporta `ENV_PATH` desde el barrel.
- `test/config-env-writer.test.js` - 32 tests: validación, write/upsert/merge, permisos 0600, atomicidad, never-throws, idempotencia, aislamiento DI y boundary de fuga.

## Decisions Made
- **No reusar `writeFileAtomic`** (Pitfall 13): ese helper no hace `chmod`, dejaría el `.env` a 0644 world-readable y un `.tmp` con el secreto en claro. `writeEnvVar` implementa su propia secuencia con chmod 0600 pre-rename.
- **Validar+rechazar** (Pitfall 14) en vez de escapar: rechaza `#`, `=`, whitespace, vacío. Interpreté "leading spaces" del spec como **todo** whitespace, porque el vector realmente peligroso para el merge es el `\n`/`\r` embebido (inyectaría/clobbearía líneas). Las API keys reales de Plane/GitHub no usan ninguno de estos caracteres → restricción zero-cost.
- **DI del path** (`envPath` parámetro, default `ENV_PATH`): resuelve Pitfall 21811 (KODO_DIR cacheado al import) sin depender del redirect de HOME. Los tests inyectan un tmpdir y verifican explícitamente que el `.env` real no se toca.
- **Contrato de fallo dual**: throw `TypeError` en input inválido (contrato del caller, pre-validable con los helpers exportados que usará el masked input de 67-02) + never-throws (`return false`) ante fallo de I/O (coherente con el invariante TUI never-throws).
- **`{mode:0o600}` en `writeFileSync`** además del `chmodSync`: defense-in-depth para cerrar la ventana breve del `.tmp` a 0644; el `chmodSync` sigue siendo la garantía load-bearing (no sujeto a umask).

## Deviations from Plan

None - plan executed exactly as written. Las decisiones de discreción del planner (validar vs escapar, ubicación del test, modo del dir) se resolvieron con las recomendaciones del CONTEXT.

## Issues Encountered
- El primer intento del test de never-throws (destino como directorio) quedó enrevesado; se simplificó a un directorio no-vacío como `envPath` que fuerza el fallo de `renameSync`, capturado → `false`.

## User Setup Required
None - sin configuración de servicios externos. `writeEnvVar` aún no está cableado a ninguna UI (el masked input llega en 67-02).

## Next Phase Readiness
- **67-02 (masked input):** puede cablear `onSaveApiKey` → `writeEnvVar`; los validadores exportados (`validateEnvKey`/`validateEnvValue`) permiten pre-validar antes de escribir (evita el throw).
- **67-03 (hygiene grep):** el guard source-level anti-shell-out ya establece el molde; el grep de los 5 vectores extiende esta base.
- Sin blockers. El `~/.kodo/.env` real verificado intacto (2 keys, 0644, sin `TEST_KEY`/`SENTINEL`, sin `.env.tmp`).

## Self-Check: PASSED

- Files verified present: `src/config.js`, `test/config-env-writer.test.js`, `67-01-SUMMARY.md`.
- Commits verified: `694bade`, `dacbf7b`, `8026114`, `d710478`.
- Full suite green: 1740 pass / 0 fail / 1 skipped (pre-existente).
- Real `~/.kodo/.env` intacto: 2 keys, 0644, sin `TEST_KEY`/`SENTINEL`, sin `.env.tmp`.

---
*Phase: 67-secrets-writer-masked-input*
*Completed: 2026-07-02*
