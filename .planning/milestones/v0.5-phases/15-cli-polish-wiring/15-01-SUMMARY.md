---
phase: 15-cli-polish-wiring
plan: 01
subsystem: cli
tags: [logger, formatter, picocolors, ansi, ndjson, columnar, tty]

# Dependency graph
requires:
  - phase: 14-cli-format-foundation
    provides: "src/cli/format.js helper (createFormatter, _resolveUseColor, formatRow) + picocolors dep + LOG-12 extension blindada por test/format-isolation.test.js"
provides:
  - "src/logger.js#formatLine ahora produce shape dual: NO_COLOR byte-a-byte pre-Phase-15, TTY columnar (timestamp 8 / level 5 / component 12 widths, ' · ' separator, ANSI level chips via picocolors)"
  - "useColor source unification en logger.js + reader.js via _resolveUseColor — añade soporte FORCE_COLOR (precedencia NO_COLOR > FORCE_COLOR > stream.isTTY)"
  - "--json bypass byte-a-byte preservado en logs/reader.js — el formatter NUNCA se invoca para opts.json (SC#2)"
affects: [phase-16-log-debt-cleanup, phase-17-uat-automation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shape dual condicionado a useColor — primer helper del repo que bifurca BYTES (no solo escapes ANSI) según TTY/NO_COLOR"
    - "useColor source unification — drop-in replacement del cómputo inline `Boolean(stream.isTTY) && !env.NO_COLOR` por `_resolveUseColor(stream)` (Pattern A 15-PATTERNS)"
    - "Synthetic stream descriptor `{ isTTY: true }` para createFormatter dentro del branch TTY — evita que tests con stub de process.stderr.isTTY afecten la coherencia useColor del row coloreado"

key-files:
  created: []
  modified:
    - "src/logger.js — import format.js, COLUMNAR_WIDTHS frozen const, formatLine shape dual, useColor via _resolveUseColor (línea 204)"
    - "src/logs/reader.js — import _resolveUseColor, useColor unificada (línea 68)"
    - "test/logger.test.js — 8 tests Phase 15 (3 NO_COLOR golden bytes, 5 TTY columnar, 1 FORCE_COLOR)"
    - "test/logs-reader.test.js — 2 tests Phase 15 (--json bypass + FORCE_COLOR)"
    - "test/logger-exports.test.js — actualizado el assert que asumía ANSI_RESET literal en TTY (Phase 14 ya cambió a picocolors `\\x1b[39m`)"

key-decisions:
  - "TTY branch usa `createFormatter({ isTTY: true }, {})` con descriptor sintético para honrar deterministamente el useColor=true ya resuelto por el caller. Evita que `process.stderr.isTTY=false` durante tests rompa la coherencia del row coloreado."
  - "ANSI_RESET / COLOR_BY_LEVEL siguen exportándose por backwards-compat aunque ya no aparezcan en formatLine TTY output — `writeNdjson` (línea 253) sigue usándolos para el error handler."
  - "logger-exports.test.js (LOG-05/06/07) actualizado: el assert de `colored.includes(ANSI_RESET)` queda obsoleto post-Phase-14 (picocolors usa `\\x1b[39m`, no `\\x1b[0m`). Se cambió a aserción del escape `\\x1b[33m` (yellow) que es invariante entre raw-ANSI y picocolors."

patterns-established:
  - "Pattern A (15-PATTERNS): useColor source unification — `Boolean(stream.isTTY) && !env.NO_COLOR` → `_resolveUseColor(stream)` en 2 callsites (logger.js:204, reader.js:68). Aplicable sin cambios al resto de la Phase 15 (check.js, gsd-inspect.js, gsd-verify.js)."
  - "Pattern shape dual condicionado a useColor: branch NON-TTY preservado byte-a-byte para SC#1 + branch TTY delegado a `fmt.formatRow` con widths fijas. Reusable en cualquier formatter que necesite columnar+chrome opcional."

requirements-completed: [DX-01, DX-02]

# Metrics
duration: ~25min
completed: 2026-05-05
---

# Phase 15 Plan 01: kodo logs Wiring Summary

**`kodo logs` y stderr mirror del logger ahora producen shape columnar coloreado en TTY (timestamp · LEVEL · component · msg con widths fijas) y bytes byte-idénticos a pre-Phase-15 en NO_COLOR/non-TTY; `--json` mantiene bypass total.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-05T14:15:00Z (worktree-agent spawn)
- **Completed:** 2026-05-05T14:40:32Z
- **Tasks:** 2 / 2 (TDD: RED + GREEN por tarea)
- **Files modified:** 5 (2 source + 3 test)

## Accomplishments

- `src/logger.js#formatLine` produce **shape dual** condicionado a `useColor`:
  - `useColor=false` → bytes IDÉNTICOS pre-Phase-15 (single space, sin separator middle-dot, sin padding) — SC#1 byte-a-byte preservado.
  - `useColor=true` → shape columnar `HH:MM:SS · LEVEL · component · msg[ +k=v...]` con widths fijas (timestamp=8, level=5, component=12), separator ` · ` (default Phase 14 D-11), color por nivel via `fmt.debug/info/warn/error` (picocolors).
- `useColor` source unificada en 2 callsites via `_resolveUseColor(stream)` — añade soporte FORCE_COLOR (precedencia NO_COLOR > FORCE_COLOR > stream.isTTY) sin tocar `maybeMirrorToStderr` ni la firma de `formatLine`.
- `--json` bypass total intacto en `logs/reader.js` (líneas 74-79) — el formatter NUNCA se invoca cuando `opts.json=true`. SC#2 byte-a-byte cumplido triviamente.
- LOG-12 invariante verificada (`test/check-isolation.test.js` verde): `format.js` no importa `logger.js`, los nuevos imports de `logger.js → format.js` y `reader.js → format.js` son unidireccionales y no afectan al grafo de `check.js`.
- Smoke test CLI (`kodo logs sess-smoke` + variantes NO_COLOR/--json/FORCE_COLOR) verificado manualmente con bytes alineados: shape columnar en TTY/FORCE_COLOR, bytes pre-Phase-15 en NO_COLOR, raw NDJSON en --json.

## Task Commits

Each task was committed atomically following TDD (test → feat):

1. **Task 1 RED — failing tests for formatLine columnar + FORCE_COLOR** — `104081d` (test)
2. **Task 1 GREEN — wire format.js into logger.js** — `0918a4a` (feat)
3. **Task 2 RED — failing tests for reader.js FORCE_COLOR + --json bypass** — `d3218e8` (test)
4. **Task 2 GREEN — wire _resolveUseColor in logs/reader.js** — `c07e7f1` (feat)

## Files Created/Modified

### Modified

- `src/logger.js` — Phase 15 D-02 + Pattern A:
  - `import { createFormatter, _resolveUseColor } from './cli/format.js';` añadido tras `import { KODO_DIR } from './config.js';`.
  - Constante module-level `COLUMNAR_WIDTHS = Object.freeze({ timestamp: 8, level: 5, component: 12 })` debajo de `LEVEL_NAMES`.
  - `formatLine(record, { useColor })` reescrita: branch `if (!useColor)` con cuerpo idéntico al pre-Phase-15 + branch TTY que delega a `fmt.formatRow([time, lvlCell, compRaw, msg], [8, 5, 12])`. La 4ª cell (msg) no se padea (widths array de longitud 3).
  - Línea 204: `Boolean(process.stderr.isTTY) && !process.env.NO_COLOR` → `_resolveUseColor(process.stderr)`.
  - El TTY formatter se construye con descriptor sintético `{ isTTY: true }` y env vacío `{}` para honrar deterministamente el useColor=true ya resuelto por el caller.
- `src/logs/reader.js` — Phase 15 D-01 + Pattern A:
  - `import { _resolveUseColor } from '../cli/format.js';` añadido tras el import de `logger.js`.
  - Línea 68: `Boolean(process.stdout.isTTY) && !process.env.NO_COLOR` → `_resolveUseColor(process.stdout)`.
  - Loop `printLine`, early-return `--json` (líneas 74-79), `--follow` delegation, `--session-of` resolution: NO TOCADOS.
- `test/logger.test.js` — Tests Phase 15 añadidos al final del archivo:
  - 3 tests NO_COLOR golden bytes (Test 1 sin component, Test 2 con component, Test 3 con ctx extras + task_id excluido por BASE_RECORD_KEYS).
  - 5 tests TTY columnar (Test 4 shape baseline, Test 5 component vacío 12 espacios, Test 6 component >12 chars no truncado, Test 7 level=ERROR ANSI red, Test extra ctx suffix).
  - Test 8 FORCE_COLOR=1 + non-TTY stderr → mirror produce ANSI yellow vía createLogger (FORCE_COLOR coercido por `_resolveUseColor`).
- `test/logs-reader.test.js` — Tests Phase 15 añadidos:
  - Test 1: `--json` bypass byte-a-byte con isTTY=true + FORCE_COLOR=1 → output exacto = `<raw>\\n`, cero escapes ANSI.
  - Test 3: FORCE_COLOR=1 + isTTY=false → formatLine produce shape columnar con cyan + separator ` · `.
- `test/logger-exports.test.js` — Test "formatLine with useColor=true wraps level with ANSI codes" actualizado: el assert obsoleto `colored.includes(ANSI_RESET)` se sustituyó por aserción del escape `\\x1b[33m` (yellow), que es invariante entre raw-ANSI y picocolors. ANSI_RESET sigue exportándose y validado por separado.

## Decisions Made

1. **Synthetic stream descriptor `{ isTTY: true }` en formatLine TTY branch**: cuando el caller ya resolvió `useColor=true`, construir `createFormatter({ isTTY: true }, {})` deterministicamente fuerza el formatter a colorear sin re-inspeccionar `process.stderr.isTTY` (que puede divergir en tests con stub). Alternativa rechazada: pasar `process.stderr` y confiar en que el caller stubeó el isTTY — frágil ante cambios de orden en setUp/tearDown de test runners.
2. **Mantener `ANSI_RESET` y `COLOR_BY_LEVEL` exportados** aunque `formatLine` ya no los use directamente: `writeNdjson` (línea 253) sigue usando `ANSI_RED` para el error handler "write failed", y eliminarlos rompería consumers externos hipotéticos. Phase 15 alcance explícito (CONTEXT línea 122-133) NO los lista para eliminación.
3. **`logger-exports.test.js` Test 4 actualizado en lugar de eliminado**: el contrato del export se mantiene (formatLine retorna ANSI codes en useColor=true), pero los códigos cambiaron de `\\x1b[33m...\\x1b[0m` (raw ANSI) a `\\x1b[33m...\\x1b[39m` (picocolors color-off). El test ahora valida el escape que es estable entre mecanismos.

## Deviations from Plan

Mínimas. El plan se ejecutó casi literal, con 2 ajustes técnicos auto-fixed:

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test pre-existente (logger-exports.test.js#"formatLine with useColor=true") asumía `ANSI_RESET` literal en output coloreado**
- **Found during:** Task 1 GREEN (al ejecutar `node --test test/logger-exports.test.js`).
- **Issue:** El test escribió en Phase 7 asumía que `formatLine(rec, { useColor: true })` insertaba `COLOR_BY_LEVEL.warn` (`\\x1b[33m`) y `ANSI_RESET` (`\\x1b[0m`) literales. Phase 14 ya había cambiado el mecanismo a picocolors (que usa `\\x1b[39m` color-off, no full reset), pero el test no se actualizó porque el shape pre-Phase-15 todavía usaba el formato `${c}${lvl}${r}` inline en `formatLine`. Tras Phase 15 cambia el shape completo a columnar y el test fallaría con cualquier implementación correcta.
- **Fix:** Actualizado el assert: `colored.includes(ANSI_RESET)` → `colored.includes('\\x1b[33m')` (yellow chip, invariante entre raw-ANSI y picocolors). `ANSI_RESET` se sigue validando como string exportado por separado.
- **Files modified:** `test/logger-exports.test.js`
- **Verification:** `node --test test/logger-exports.test.js` exit 0 (3 suites, 3 tests, 0 fail) post-fix.
- **Committed in:** `0918a4a` (parte del Task 1 GREEN commit).

**2. [Rule 1 - Bug] Mi primer Test 5 (TTY component vacío) tenía un off-by-one en el conteo de espacios**
- **Found during:** Task 1 GREEN, primera ejecución del test suite.
- **Issue:** El test buscaba la sub-cadena `' ·             · '` (13 spaces entre separators), pero el formatter genera `· ` + 12 spaces (cell padding) + ` ·` = 14 spaces literal entre los `·`. El cálculo correcto es: separator suffix (1) + padCell width (12) + separator prefix (1) = 14.
- **Fix:** Test reescrito usando `' '.repeat(14)` y comentario explicando el cálculo. Cross-check añadido (`out.endsWith(' · go')`) para anclar el final.
- **Files modified:** `test/logger.test.js`
- **Verification:** Test 5 exit 0 post-fix.
- **Committed in:** `0918a4a` (parte del Task 1 GREEN — el commit incluyó el test fix porque pertenece al mismo ciclo TDD).

---

**Total deviations:** 2 auto-fixed (Rule 1 — bugs en tests obsoletos / mal contados).
**Impact on plan:** Cero scope creep. Ambos fixes son correcciones internas de los propios tests del plan o de tests pre-existentes que asumían el shape pre-Phase-14. La lógica del source no se desvió del plan.

## Issues Encountered

Ninguno bloqueante. Una observación notable durante la implementación:

- `picocolors` con `createColors(true)` devuelve `\\x1b[36m...\\x1b[39m` (color-off del foreground specifically) en lugar de `\\x1b[36m...\\x1b[0m` (full reset) que usaba el código pre-Phase-14. Esto rompe asserts pre-Phase-14 que esperaban `ANSI_RESET` en el output. **No es un bug** — `\\x1b[39m` es la forma correcta de "color off" cuando solo se cambió el foreground. Documentado en la decisión #3.

## User Setup Required

Ninguno.

## Verification

### Automated tests

```
$ node --test test/logger.test.js test/logger-redaction.test.js \
       test/logger-events.test.js test/logger-exports.test.js \
       test/check-isolation.test.js
ℹ tests 42  pass 42  fail 0

$ node --test test/logs-reader.test.js test/logs-follow.test.js \
       test/logs-session-of.test.js test/logs-head-line.test.js \
       test/check-isolation.test.js
ℹ tests 24  pass 24  fail 0

$ node --test test/**/*.test.js  # full suite
ℹ tests 470  pass 469  skipped 1  fail 0
```

(El skip es `test/startup-budget.test.js` Decisión B pre-existente, no introducido por Phase 15.)

### Manual smoke test (CLI golden bytes)

```
$ HOME=$TMP NO_COLOR=1 node bin/kodo logs sess-smoke
10:30:45 INFO plane hello
10:30:46 WARN dispatcher careful
10:30:47 ERROR boom

$ HOME=$TMP node bin/kodo logs sess-smoke --json
{"timestamp":"...","level":"info",...}    # raw NDJSON byte-a-byte

$ HOME=$TMP FORCE_COLOR=1 node bin/kodo logs sess-smoke
10:30:45 · INFO  · plane        · hello       # con ANSI cyan
10:30:46 · WARN  · dispatcher   · careful     # con ANSI yellow
10:30:47 · ERROR ·              · boom        # con ANSI red, component vacío 12 spaces
```

NO_COLOR output coincide byte-a-byte con baseline pre-Phase-15.
--json output passthrough crudo.
FORCE_COLOR output con widths fijas (level cell padded a 5 = `INFO `, `WARN `, `ERROR`; component cell padded a 12).

### Acceptance criteria (grep-based)

- `grep -c "import { createFormatter, _resolveUseColor } from './cli/format.js'" src/logger.js` = **1** ✓
- `grep -c "_resolveUseColor(process.stderr)" src/logger.js` = **1** ✓
- `grep -cE "Boolean\\(process\\.stderr\\.isTTY\\) && !process\\.env\\.NO_COLOR" src/logger.js` = **0** ✓ (cómputo inline eliminado)
- `grep -c "COLUMNAR_WIDTHS" src/logger.js` = **4** ✓ (definición + 3 usos en cells)
- `grep -c "Object.freeze({ timestamp: 8, level: 5, component: 12 })" src/logger.js` = **1** ✓
- `grep -c "fmt.formatRow" src/logger.js` = **1** ✓
- `grep -cE "if \\(!useColor\\)" src/logger.js` = **1** ✓ (shape dual present)
- `grep -c "import { _resolveUseColor } from '../cli/format.js'" src/logs/reader.js` = **1** ✓
- `grep -c "_resolveUseColor(process.stdout)" src/logs/reader.js` = **1** ✓
- `grep -cE "Boolean\\(process\\.stdout\\.isTTY\\) && !process\\.env\\.NO_COLOR" src/logs/reader.js` = **0** ✓
- `grep -c "if (opts.json)" src/logs/reader.js` = **1** ✓ (early-return preservado)

## Self-Check: PASSED

- ✓ `src/logger.js` modified — `git log --oneline 0918a4a` shows the commit.
- ✓ `src/logs/reader.js` modified — `git log --oneline c07e7f1` shows the commit.
- ✓ `test/logger.test.js` updated with 8 new Phase 15 tests — `git log --oneline 104081d 0918a4a` show RED then GREEN updates.
- ✓ `test/logs-reader.test.js` updated with 2 new Phase 15 tests — `git log --oneline d3218e8` shows RED, GREEN test passes via the source change in `c07e7f1`.
- ✓ `test/logger-exports.test.js` updated for Phase 14 picocolors compatibility — committed in `0918a4a`.
- ✓ All 4 task commits exist in `git log --oneline d16f8e4..HEAD`: `104081d`, `0918a4a`, `d3218e8`, `c07e7f1`.
- ✓ Full test suite passes: 469/470 (1 pre-existing skip).
- ✓ LOG-12 invariant verified via `test/check-isolation.test.js` exit 0.
- ✓ SC#1 (NO_COLOR golden bytes) + SC#2 (--json bypass) + DX-01 (color por nivel) + DX-02 (columnas alineadas) cumplidos.
