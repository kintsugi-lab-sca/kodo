---
phase: 72-higiene-dx-y-verdad-documental
plan: 02
subsystem: config-pipeline
tags: [hygiene, security, dead-code, config, prototype-pollution, file-permissions]
requires: []
provides:
  - "src/cli/config-args.js — setNestedValue con rechazo de prototype pollution + parsers indexOf/slice"
  - "loadConfig endurecido: deep-merge sobre DEFAULT_CONFIG + validación warn-and-fallback (mergeAndValidateConfig exportada)"
  - "loadEnvFile con strip de comillas emparejadas (exportada, envPath DI)"
  - "writeFileAtomic con chmod 0600 condicional a claves *_secret"
affects: [src/cli.js, src/cli/up.js (sin cambios necesarios), src/session/health.js, src/config.js]
tech-stack:
  added: []
  patterns:
    - "Rechazar, no sanear (M3): claves __proto__/constructor/prototype lanzan Error pre-walk"
    - "Warn NDJSON directo a stderr para módulos sin logger (config.js no puede importar logger.js — ciclo)"
    - "structuredClone(DEFAULT_CONFIG) como base del merge — el resultado nunca comparte refs con los defaults"
key-files:
  created:
    - src/cli/config-args.js
    - test/config-hardening.test.js
  modified:
    - src/cli.js
    - src/session/health.js
    - src/config.js
    - test/cli/health-wait.test.js
decisions:
  - "M3/M14 extraídos a src/cli/config-args.js (módulo puro importable): cli.js ejecuta program.parse() al import y no es testeable por unit test"
  - "B7 usa warn NDJSON directo a stderr (patrón lifecycle.js:254) — logger.js importa config.js, un import inverso crearía ciclo"
  - "mergeAndValidateConfig clona DEFAULT_CONFIG (structuredClone) antes del merge para que mutar el config devuelto no contamine los defaults in-proceso"
metrics:
  duration: ~45 min
  completed: 2026-07-13
status: complete
---

# Phase 72 Plan 02: Higiene CLI/health + endurecimiento del pipeline de config Summary

Borrados HYG-02/HYG-03 (flag `up --url` muerto y loop de health sin importadores) y batch HYG-05 completo: prototype pollution rechazado en `config --set`, parsing que preserva `=`/`:` internos, strip de comillas del `.env`, deep-merge+validación never-crash en `loadConfig` reutilizando `config-validate.js`, y chmod 0600 condicional a `*_secret` en `writeFileAtomic`.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | HYG-02 + HYG-03 — borrar `up --url` y el loop de health | 8d7ed89 | src/cli.js, src/session/health.js, test/cli/health-wait.test.js |
| 2 | HYG-05 (cli.js) — M3 prototype pollution + M14 indexOf | 50a93db | src/cli.js, src/cli/config-args.js, test/config-hardening.test.js |
| 3 | HYG-05 (config.js) — B5 comillas + B7 merge/valida + M5 chmod | ea5b9f7 | src/config.js, test/config-hardening.test.js |

## What Was Built

**HYG-02 (A9):** `kodo up` ya no expone `--url` y `runUp` se invoca sin argumentos. `runUp` nunca leyó `deps.url` (baseUrl es config-driven vía `resolveBaseUrl`), así que `src/cli/up.js` no necesitó cambios — la lectura muerta estaba solo en el callsite de cli.js. El `--url` de `kodo dashboard` (flag vivo) queda intacto, con test que lo asserta.

**HYG-03 (M18):** borrados `startHealthLoop`, `stopHealthLoop`, `runHealthCheck` y el `healthInterval` module-level de `src/session/health.js` (cero importadores, verificado por grep). `checkHealth`/`actOnHealth`/`detectIdle` intactas — `check.js` las sigue consumiendo. Verificación por import en test (no grep de fichero).

**HYG-05 (V5/V12/V14 ASVS):**
- **M3 (T-72-04):** `setNestedValue` rechaza `__proto__`/`constructor`/`prototype` en cualquier tramo del path con `Error` explícito, PRE-walk (no muta nada antes de validar). Rechazo, nunca saneo.
- **M14 (T-72-07):** `--set` parte por el PRIMER `=` (`token=a=b=c` → value `a=b=c`); `--map-project` por el PRIMER `:` (rutas con `:` preservadas). El parser `.env` no se tocó para M14 (ya usaba indexOf; Pitfall #1 del RESEARCH).
- **B5 (T-72-07):** `loadEnvFile` hace strip conservador de comillas emparejadas (misma comilla en inicio Y fin); comillas sueltas/desparejadas se preservan.
- **B7 (T-72-06, D-10):** `loadConfig` deep-mergea la config parseada sobre `DEFAULT_CONFIG` y valida los 11 campos editables reutilizando `config-validate.js` (`getEditableFields`+`validateField`+`getByPath`/`setByPath` — cero validadores nuevos). Valor inválido → default + warn NDJSON; nunca lanza. Sub-objetos parciales preservan hermanas ausentes.
- **M5 (T-72-05):** `writeFileAtomic` detecta claves `*_secret` en el contenido JSON (`/"[^"]*_secret"\s*:/`) y en ese caso crea el `.tmp` con `mode:0o600` + `chmodSync` PRE-rename (espejo exacto de `writeEnvVar`, que NO se modificó). Sin secreto, permisos como hoy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] M3/M14 extraídos a `src/cli/config-args.js` en vez de inline en cli.js**
- **Found during:** Task 2
- **Issue:** `src/cli.js` ejecuta `program.parse()` al import — importarlo desde un test consume el argv del test runner e imprime el help. Los acceptance criteria exigen unit-tests directos de `setNestedValue` y los parsers.
- **Fix:** helpers puros extraídos a `src/cli/config-args.js` (mismo precedente que `config-validate.js`); cli.js los importa lazy en la action de `config`. El `setNestedValue` local de cli.js se eliminó.
- **Files modified:** src/cli.js, src/cli/config-args.js
- **Commit:** 50a93db

**2. [Rule 2 - Missing critical] `mergeAndValidateConfig` clona `DEFAULT_CONFIG` antes del merge**
- **Found during:** Task 3
- **Issue:** un deep-merge con `{...base}` comparte referencias de las ramas no tocadas: un caller que mutara el config devuelto (p.ej. `interactiveConfig`) contaminaría `DEFAULT_CONFIG` in-proceso.
- **Fix:** la base del merge es `structuredClone(DEFAULT_CONFIG)`; test dedicado que muta el resultado y asserta que los defaults no cambian.
- **Files modified:** src/config.js
- **Commit:** ea5b9f7

**3. [Rule 3 - Blocking] Task 1 no tocó `src/cli/up.js` (declarado en files del plan)**
- **Found during:** Task 1
- **Issue:** el plan preveía eliminar "cualquier lectura/destructuring de `deps.url`" en up.js, pero no existe ninguna — `runUp` siempre fue config-driven. El comentario del plan (:78-79) estaba en cli.js, no en up.js.
- **Fix:** solo se actualizó el comentario del bloque `up` en cli.js; up.js queda byte-idéntico. Cubierto por test de comportamiento (deps con `url` inyectada no altera el baseUrl).
- **Commit:** 8d7ed89

## Authentication Gates

None.

## Verification Results

- `node --test test/config-hardening.test.js test/cli/health-wait.test.js` → 30/30 pass.
- `npm test` (suite completa, 1982 tests) → 1981 pass, 0 fail, 1 skipped (pre-existente).
- `node -e "import('./src/session/health.js')..."` → loop funcs `undefined`, `checkHealth`/`actOnHealth` funciones. Exit 0.
- `kodo --help` carga sin errores tras los cambios de cli.js.

## Known Stubs

None — sin placeholders ni datos hardcodeados nuevos.

## Threat Flags

None — no se introdujo superficie nueva fuera del threat model del plan (T-72-04/05/06/07 mitigados; T-72-SC respetado: cero deps npm nuevas).

## Decisions Made

- Warn NDJSON de B7 emitido directo a stderr con el patrón de `lifecycle.js:254` — `config.js` no puede importar `logger.js` (logger.js importa config.js → ciclo de imports).
- Los valores VÁLIDOS no se normalizan en B7 (p.ej. `max_parallel: "3"` string se deja tal cual) — cambio quirúrgico: solo los inválidos caen al default.
- Campos sin default en `DEFAULT_CONFIG` (p.ej. `providers.github.*`, D-08) con valor inválido: warn sin fallback (no hay default al que caer, y escribir `undefined` rompería al consumidor).

## Self-Check: PASSED

- src/cli/config-args.js — FOUND
- test/config-hardening.test.js — FOUND
- 72-02-SUMMARY.md — FOUND
- Commit 8d7ed89 — FOUND
- Commit 50a93db — FOUND
- Commit ea5b9f7 — FOUND
