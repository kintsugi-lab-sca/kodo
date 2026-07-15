---
phase: 72-higiene-dx-y-verdad-documental
fixed_at: 2026-07-13
review_path: .planning/phases/72-higiene-dx-y-verdad-documental/72-REVIEW.md
iteration: 1
findings_in_scope: 8
fixed: 6
skipped: 2
status: partial
---

# Phase 72: Code Review Fix Report

**Fixed at:** 2026-07-13
**Source review:** `.planning/phases/72-higiene-dx-y-verdad-documental/72-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings en scope (Critical + Warnings): 8
- Fixed: 6 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05, WR-07 → 7 aplicados)
- No-fix por decisión: 1 (WR-06)
- Info (fuera de scope, no tocados): 6 (IN-01..IN-06)

> Nota de conteo: de las 8 entradas Critical+Warning, 7 recibieron fix de código
> (CR-01 + 6 WR) y 1 (WR-06) es no-fix deliberado. `fixed: 6` cuenta los WR
> arreglados; CR-01 se lista aparte como el Critical. Ver detalle abajo.

## Fixed Issues

### CR-01: B7 deep-merge mata el gate estructural de `needsSetup`

**Files modified:** `src/config.js`, `test/config.test.js`
**Commit:** `1ff783b`
**Applied fix:** Se añadió `loadRawConfig()` (parse + `migrateConfig` puro, SIN
deep-merge) y el gate estructural (3) de `needsSetup` lo consume vía nuevo seam
`_loadRawConfig`. Así el gate vuelve a distinguir "clave AUSENTE en disco" de
"clave rellenada por el default merge de B7". `loadConfig()` sigue devolviendo el
config MERGEADO para el runtime (D-10 intacto: runtime nunca ve claves ausentes,
warn-and-fallback preservado). Tests de `needsSetup` actualizados para inyectar el
5º seam; añadido repro CR-01 (loadConfig completo pero crudo sin base_url → true).

### WR-01: `deepMerge` reintroduce el vector `__proto__`

**Files modified:** `src/config.js`, `test/config-hardening.test.js`
**Commit:** `1470d5f`
**Applied fix:** `deepMerge` ahora salta `FORBIDDEN_KEYS`
(`__proto__`/`constructor`/`prototype`, reutilizadas de `config-args.js` — puro, sin
ciclo de import), coherente con M3. Añadidos tests: `{"__proto__":{...}}` ya no
produce spoofing de claves ni contamina `Object.prototype`.

### WR-02: `stripControlChars` no cubre C1 y preserva `\r`

**Files modified:** `src/cli/format.js`, `test/dashboard-format.test.js`
**Commit:** `5f53840`
**Applied fix:** Regex ampliado a `[\x00-\x08\x0b-\x1f\x7f-\x9f]` — ahora elimina
los controles C1 (`\x80-\x9f`, incl. U+009B CSI y U+009D OSC de un solo byte) y `\r`
(`\x0d`), preservando SOLO `\t` y `\n`. Docstring y tests alineados con el
comportamiento real (añadidos casos `\r` y C1).

### WR-03: M4 solo sanea comentarios — task_ref/summary llegan sin strip

**Files modified:** `src/cli/dashboard/App.js`, `test/dashboard-table.test.js`
**Commit:** `ca1bf27`
**Applied fix:** `task_ref` y `summary` (contenido externo del provider) se pasan
por `stripControlChars` en el `enriched` map de App.js (punto de proyección al
render), antes de que rowCells/select/readPlan los toquen. Corregido el comentario
«ÚNICO punto de entrada». Test de render con task_ref malicioso (CSI/OSC/C1/BEL).
**Known-limitation anotada (por directiva):** `cmux.notify(body: session.summary)`
en `session-end.js:188` NO se sanea (está fuera del render del dashboard; sanearlo
expandiría el diff más allá del render). Documentado en el comentario del fix.

### WR-04: el `.bak` de migración queda world-readable con `*_secret`

**Files modified:** `src/config.js`, `test/config-migration-atomic.test.js`
**Commit:** `4106772`
**Applied fix:** `migrateConfigIfNeeded` escribe el `.bak` vía `writeFileAtomic`
(en vez de `writeFileSync` directo), heredando la detección M5 de `*_secret` → 0600.
Test: un config v1 con `webhook_secret` produce un `.bak` en modo 0600.

### WR-05: `--set` materializa TODOS los defaults en disco (pinning)

**Files modified:** `src/cli.js`, `test/cli/config-set-raw.test.js` (nuevo)
**Commit:** `63545f6`
**Applied fix:** `kodo config --set` lee/muta/guarda el config CRUDO
(`loadRawConfig() ?? {}`) en vez del MERGED de `loadConfig()`. Persiste solo la clave
puesta (+ lo que ya había en disco); `loadConfig()` sigue mergeando en runtime. Test
e2e (subproceso, HOME aislado): `--set` no pinnea `providers.plane`/`cmux`/`server`.

### WR-07: test del gate HYG-01 flaky con `KODO_ORCHESTRATOR` heredado

**Files modified:** `test/hooks/stop-idempotency.test.js`
**Commit:** `3f3c8ea`
**Applied fix:** `delete process.env.KODO_ORCHESTRATOR` añadido al `beforeEach` del
describe del gate HYG-01. Verificado: la suite pasa incluso ejecutada con
`KODO_ORCHESTRATOR=1` heredado (antes el primer test entraba al auto-commit y fallaba).

## Skipped Issues

### WR-06: los efectos de cierre dependen ahora de un SessionEnd limpio

**File:** `src/hooks/stop.js:155-160`, `src/hooks/session-end.js:167-204`
**Reason:** NO FIX — decisión aceptada. Es la dirección deliberada del audit (HYG-04,
D-08 del CONTEXT). El REVIEW pide confirmación en UAT / posible fallback desde el
daemon; eso es una acción de verificación operativa, no un cambio de código de esta
pasada. Se deja anotado como contrato operativo pendiente de UAT (no se toca el código).

### IN-01..IN-06 (6 Info)

**Reason:** Fuera de scope por defecto (la directiva del orquestador excluye los Info
de esta pasada de fix). Sin cambios.

## Verificación

- Tests por fichero afectado: verdes tras cada fix (config, config-hardening,
  config-migration-atomic, dashboard-format, dashboard-table, config-set-raw,
  stop-idempotency).
- `npm test` completo: 2027 tests, 2024 pass, 1 skip, **2 fail** — ambos del test
  `gsd-lock-race` (flaky de timing bajo concurrencia, conocido y listado en la
  directiva). Re-ejecutado en AISLAMIENTO: `test/gsd-lock-race.test.js` → 4 pass, 0
  fail. No relacionado con los ficheros tocados (config/cli/format/App/tests).

---

_Fixed: 2026-07-13_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
