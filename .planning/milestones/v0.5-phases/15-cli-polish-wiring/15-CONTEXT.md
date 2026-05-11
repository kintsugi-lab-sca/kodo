# Phase 15: CLI Polish Wiring - Context

**Gathered:** 2026-05-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Cablear `src/cli/format.js` (helper Phase 14 ya en main, factory `createFormatter(stream, env?)` con picocolors single-source D-07) en los **4 surfaces TTY del CLI**:

1. `kodo logs` → vía `src/logger.js#formatLine` + `src/logs/reader.js`
2. `kodo gsd inspect <task-id>` → `src/cli/gsd-inspect.js#renderHuman`
3. `kodo gsd verify <session-id>` → `src/cli/gsd-verify.js#renderHuman`
4. `kodo check` → `src/check.js` (sustitución de ANSI inline)

**Queda fuera:** todo lo que no sea cablear el helper en estos 4 sitios. En particular:
- LOG-09 cleanup (literales dispatcher → `EVENTS.*`, `markSessionStatus` en verify.js + stop.js) → Phase 16.
- UAT automation (UAT-01..03 → integration tests con NDJSON fixtures) → Phase 17.
- Refactor de adapters, polling triggers, file-watcher → v0.6+.

</domain>

<decisions>
## Implementation Decisions

### Render path de `kodo logs` (DX-01, DX-02)

- **D-01:** **`src/logger.js#formatLine` se modifica para delegar en `src/cli/format.js`**. Single source de visual layout entre el stderr-mirror runtime del logger y el dump de `kodo logs <session-id>`. Phase 14 D-05 ("logger.js intocable") aplicaba sólo a Phase 14; Phase 15 lo libera. `logger.js` adquiere un `import { createFormatter } from './cli/format.js'`. **LOG-12 sigue verde** porque `check.js` no importa `logger.js` (test-graph guard cubre exactamente eso).
- **D-02:** **Shape dual condicionado a `useColor`**:
  - **`useColor=false` (non-TTY o `NO_COLOR`):** se preserva el shape actual byte-a-byte: `HH:MM:SS LEVEL[ component] msg[ +k=v ...]` (single space, sin `·`, sin padding). Cumple SC#1 literal "los bytes coinciden con el output anterior a Phase 14".
  - **`useColor=true` (TTY + color):** shape columnar nuevo: `HH:MM:SS · LEVEL · component · msg` con widths fijas y separador ` · ` (default de format.js D-11). Color por nivel via `fmt.debug/info/warn/error` (mapping idéntico a logger.js#COLOR_BY_LEVEL).
- **D-03:** **`kodo logs --json` bypass TOTAL antes de invocar formatter**. `reader.js` mantiene el early-return existente (`if (opts.json) { stdout.write(raw + '\n'); return; }`). El formatter NUNCA se invoca para `--json`. Fácil de auditar; el golden bytes test pre/post Phase 15 compara bytes sin tocar `--json` path. SC#2 cumplida triviamente.
- **D-04:** **Stderr-mirror runtime del logger comparte el render de D-02**. `maybeMirrorToStderr` sigue invocando `formatLine(record, { useColor })`; el `useColor` del runtime se calcula igual que ahora (eager via `_resolveUseColor(process.stderr)` movido a format.js — lo que Phase 14 ya generalizó). Resultado: una sola implementación de columnar para los dos consumers.

### Widths y truncation (DX-02)

- **D-05:** **Widths fijas (TTY-only)**: `timestamp=8` (HH:MM:SS), `level=5` (max 'ERROR'), `component=12`. **Pad-only, sin truncate** — coincide con el contrato `padCell` de Phase 14 D-10 (si la cell excede width, se devuelve sin truncar). Componente largo desborda esa fila pero las demás siguen alineadas.
- **D-06:** **Record SIN `component`** → en TTY mode se rellena con 12 espacios (col vacía). Mantiene alineación vertical estricta entre filas con/sin component. En non-TTY mode el component se omite igual que ahora (preservación bytes).
- **D-07:** **Separator** = `' · '` (default DEFAULT_SEPARATOR de format.js, exactamente lo que el roadmap SC#1 pide). No se sobrescribe via `opts.separator`.
- **D-08:** **Streaming `--follow` usa los mismos widths fijos**. Sin pasada previa de cálculo dinámico; widths constantes razonables para los 4 niveles + componentes típicos del repo (`dispatcher`, `gsd-bootstrap`, `health`, `lock`, etc — todos ≤12).

### Shape de `kodo check` (DX-05)

- **D-09:** **Conservar líneas `[kodo:check] ...`**. La palabra "tabla" del SC#5 se interpreta como "tabla lógica" (varias filas), NO migración a `formatTable`. Bytes en NO_COLOR/non-TTY = idénticos a los actuales (los tests de `runCheck`/`runCheckAndAct` siguen verdes sin tocar snapshots).
- **D-10:** **Sustituir ANSI inline (`ANSI_YELLOW`/`ANSI_RED`/`ANSI_RESET` en `src/check.js:15-17`) por helpers del formatter**. `[kodo:check] N pending kodo task(s) ...` pasa a `[kodo:check] ${fmt.yellow('N pending ...')}`; errores `[kodo:check] Error: ...` pasa a `${fmt.red(...)}`. Línea `[kodo:check] All clear ✓` pasa a `[kodo:check] ${fmt.ok('All clear')}` (el `✓` viene embebido por `fmt.ok` de Phase 14 D-03).
- **D-11:** **Stream del formatter para `kodo check`** = `process.stdout` (que es donde `runCheckAndAct` escribe via `console.log`). Inyectable via dep `formatterFn` para tests determinísticos (mismo patrón que `getProviderFn` actual en `checkPendingTasks`).

### Render de verdicts (DX-03 + DX-04)

#### `gsd inspect` (DX-03)

- **D-12:** **4 secciones literales del SC#3 con `fmt.ok('OK')` / `fmt.fail('FAIL')` por sección**:
  1. **config** → `resolveProjectPath(task)` no lanzó → ✓ OK; lanzó → ✗ FAIL.
  2. **fetch** → `provider.getTask(taskId)` no lanzó → ✓ OK; lanzó → ✗ FAIL.
  3. **roadmap** → `existsSync('.planning/PROJECT.md')` true → ✓ OK; false → ✗ FAIL.
  4. **match** → `verdict.action !== 'error'` → ✓ OK (incluye phase y bootstrap); 'error' → ✗ FAIL.

  Las 3 secciones actuales del `renderHuman` (Task / .planning / Verdict) se reorganizan a este formato. La preview de `buildGsdContext` se mantiene como bloque opcional al final cuando `verdict.action === 'bootstrap'` (sigue siendo útil para auditoría del operador), no se elimina.

- **D-13:** **Línea final `Exit: N`** se imprime ANTES del `return verdict.action === 'error' ? 1 : 0` para que el operador vea en stdout el código que el handler va a devolver. Coincide con la semántica D-19 del Phase 9 (0=ok|bootstrap, 1=config|verdict-error, 2=fetch). El N visible nunca diverge del N que el proceso retorna.

#### `gsd verify` (DX-04)

- **D-14:** **Mapping verdict → 3 colores**:
  - `verdict.action === 'pass'` → `fmt.green('pass')` + (opcional) `fmt.ok` prefix en sección Verdict.
  - `verdict.action === 'fail'` → `fmt.yellow('fail')` (soft-fail: gate corrió, must-haves no cumplidas — recoverable por el agente).
  - `verdict.action === 'missing'` o `'malformed'` → `fmt.red(action)` (hard-fail: estructura ausente o rota — operador interviene).

  Aliñado con la semántica de Phase 10 (parser determinista). El cuerpo (phase_id, must_haves, reason, detail) se imprime en color neutro.

- **D-15:** **Resumen del comentario Plane** = **header determinista + verdict line (2-3 líneas)**, no body completo. Concretamente: las dos primeras líneas de `verification.js#renderComment(verdict)` (header `## Verificación GSD — phase NN` + línea `**Verdict**: <action>`). Se imprime DESPUÉS de la sección Verdict, ANTES de `Plane: commented=X transitioned=Y`. Compacto pero suficiente para auditar qué se posteó. **Determinismo del comentario byte-a-byte (Pitfall #2 Phase 10) intacto** — el resumen es solo eco del primer slice del body, no se rerendea.

### Claude's Discretion

- **Estructura del refactor de `formatLine`**: si extraer la lógica columnar a una función helper `_renderColumnar(rec, fmt, widths)` interna a logger.js, o inlinearla. Phase 15 puede elegir según LoC.
- **Helpers de format.js a añadir si faltan**: si `formatTable` o `formatRow` necesitan un wrapper específico para "header padding" en `gsd inspect` 4-secciones, se añaden a format.js (D-07 single-source). No abrir picocolors fuera de format.js.
- **Naming de las secciones**: el orden literal del SC#3 es `config, fetch, roadmap, match`. Si el orden de ejecución del handler difiere (hoy: fetch primero — `provider.getTask`, luego config — `resolveProjectPath`), se reordena el render para que coincida con el orden de chequeo real (que es el orden de fallo). Las labels son "config", "fetch", "roadmap", "match" exactas; mejor consistencia con el SC.
- **Truncation con ellipsis**: si por alguna razón aparece un component >12 chars en producción y la alineación se vuelve incómoda, Phase 15 puede añadir `truncate=true` opt al `formatRow` con sufijo `…`. No es necesario en v0.5.
- **Tests source-hygiene**: extender `test/format-isolation.test.js` (Phase 14) para asegurar que el grep contra `picocolors` sigue verde tras Phase 15 (los nuevos imports de `format.js` desde callsites NO usan `picocolors`). Trivial — no hay nuevo grep necesario, el guard ya cubre todo `src/`.
- **`reader.js` change footprint**: si tras D-01 el `formatLine` ya delega correctamente, `reader.js#runLogs` sólo cambia su `useColor` source (de inline `Boolean(process.stdout.isTTY) && !process.env.NO_COLOR` a `_resolveUseColor(process.stdout)` reexport de format.js). Cero churn en filtros/loop.
- **Pruebas TTY mode**: usar fake stream `{ isTTY: true }` + env mock para asertar bytes columnares (mismo pattern que Phase 14 §specifics line 128-129).

### Folded Todos

Ninguno — `gsd-tools todo match-phase 15` devolvió 0 matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements (Phase 15 alcance)

- `.planning/ROADMAP.md` §"Phase 15: CLI Polish Wiring" — Goal + 5 success criteria observables.
- `.planning/REQUIREMENTS.md` §DX — DX-01..05 (5 reqs mapeadas a Phase 15: kodo logs color/columnas, gsd inspect ✓/✗, gsd verify color, kodo check OK/FAIL).
- `.planning/STATE.md` §"Critical Invariants to Preserve" — LOG-12 guard + `--json` determinismo + lock release idempotente (último es Phase 16, no 15).

### Contexto Phase 14 (foundation que Phase 15 consume)

- `.planning/phases/14-cli-format-foundation/14-CONTEXT.md` — D-01..D-11 del helper. Phase 15 hereda:
  - D-01 factory `createFormatter(stream, env?)`
  - D-02 precedencia `NO_COLOR > FORCE_COLOR > stream.isTTY`
  - D-03 helpers expuestos (level chips, ok/fail, raw colors, formatRow/formatTable)
  - D-04 useColor eager
  - D-05 logger.js queda intocable EN PHASE 14 (Phase 15 libera esta restricción explícitamente)
  - D-07/D-08 picocolors single-source — Phase 15 NO abre picocolors en ningún callsite
  - D-09/D-10 strip-aware widths via `visibleWidth`
  - D-11 default separator `' · '`
- `.planning/phases/14-cli-format-foundation/14-PATTERNS.md` — patrones reutilizables: factory shape, DI por descriptor, JSDoc typedef.
- `src/cli/format.js` — código del helper en main; lectura completa obligatoria para entender la API que se va a cablear.

### Contexto fases anteriores (cross-decisions que Phase 15 hereda)

- `.planning/milestones/v0.3-phases/06-structured-logger-foundation/06-CONTEXT.md` — LOG-12 isolation. Phase 15 NO modifica el guard; sólo verifica que sigue verde.
- `.planning/milestones/v0.3-phases/07-kodo-logs-cli-event-taxonomy/07-CONTEXT.md` D-03 — colores semánticos por nivel. Phase 15 los aplica via `fmt.debug/info/warn/error` (que internamente mapean a los mismos códigos).
- `.planning/milestones/v0.3-phases/09-gsd-phase-resolver-bootstrap/09-CONTEXT.md` — D-19 exit codes de `gsd inspect` (0/1/2). **Phase 15 D-13 visualiza el código pero NO lo altera**.
- `.planning/milestones/v0.3-phases/10-orchestrator-verification/10-CONTEXT.md` — Pitfall #6 Opción A exit codes de `gsd verify` + Pitfall #2 determinismo del comentario Plane. **Phase 15 D-15 NO rerendea el comentario**, solo eco del primer slice.
- `.planning/milestones/v0.4-phases/13-test-coverage-matrix/13-CONTEXT.md` — pattern source-hygiene D-09/D-10/D-11. Phase 15 NO añade nuevo guard; el de Phase 14 (`test/format-isolation.test.js`) ya cubre.

### Código existente que Phase 15 modifica

- `src/logger.js:82` — `formatLine(record, { useColor })`. **MODIFICAR** (D-01): delegar en `format.js`. Shape dual D-02. Mantiene la firma actual (`(record, { useColor })`) para no tocar callsites.
- `src/logger.js:204` — patrón `useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR`. **REEMPLAZAR** por `_resolveUseColor(process.stderr)` (export interno de format.js, con FORCE_COLOR support D-02 Phase 14).
- `src/logger.js:271` — `maybeMirrorToStderr` sigue invocando `formatLine(record, { useColor })`. **NO TOCAR la firma**; el render columnar lo añade D-01.
- `src/logs/reader.js:24,68,99` — consumer de `formatLine` y `useColor`. **MODIFICAR mínimo** (D-01 + D-04): mover el cálculo de `useColor` a `_resolveUseColor(process.stdout)` reexport de format.js. El loop de `printLine` no cambia.
- `src/logs/reader.js:74-78` — early return de `--json`. **PRESERVAR exactamente** (D-03 bypass total).
- `src/check.js:15-17` — ANSI inline. **ELIMINAR** y sustituir por uso de `createFormatter(process.stdout)` (D-10).
- `src/check.js:32,42,47,105` — uso de los ANSI literals. **REESCRIBIR** llamadas a `fmt.yellow/red/ok/fail` (D-10).
- `src/cli/gsd-inspect.js:116-164` — `renderHuman`. **REFACTOR** a 4 secciones literales del SC#3 con ✓/✗ por sección + `Exit: N` final (D-12, D-13).
- `src/cli/gsd-verify.js:87-116` — `renderHuman`. **REFACTOR** mapping verdict→color (D-14) + summary del comment Plane (D-15).
- `src/gsd/verification.js#renderComment` — **NO TOCAR**. Phase 15 D-15 sólo lee las 2 primeras líneas que ya devuelve esta función.

### Código existente que Phase 15 NO modifica

- `src/cli/format.js` — helper Phase 14, ya en main. **Read-only desde Phase 15**. Si surgen helpers adicionales (ej. truncate variant) se añaden aquí (D-07 single-source).
- `src/gsd/resolver.js` — verdict no cambia.
- `src/gsd/verify.js` — runGsdVerify no cambia (Phase 16 lo tocará para `markSessionStatus`).
- `src/triggers/dispatcher.js` — Phase 16 lo toca para LOG-09.
- `src/hooks/stop.js`, `src/hooks/session-start.js` — Phase 16 toca stop.js.
- `package.json` — Phase 14 ya añadió picocolors. Phase 15 no añade deps.

### Tests

- `test/format-isolation.test.js` (Phase 14) — guard LOG-12 extension + picocolors single-source. **PRESERVAR verde** tras los nuevos imports de `format.js` desde `logger.js`, `reader.js`, `check.js`, `gsd-inspect.js`, `gsd-verify.js`.
- `test/check-isolation.test.js` (Phase 6) — guard LOG-12 original (`check.js → logger.js`). **PRESERVAR verde** — `check.js` solo añade `import { createFormatter } from './cli/format.js'`, no llega a logger.js.
- `test/logger.test.js` — bytes pre-Phase 15 de `formatLine` con useColor=false. **GOLDEN BYTES**: SC#1 obliga a que con NO_COLOR los bytes sean idénticos. Test debe pasar sin actualizar fixtures. Si hay snapshot tests con bytes coloreados (TTY), se actualizan a la nueva shape columnar.
- `test/logs-reader.test.js` — bytes de `kodo logs --json`. **GOLDEN BYTES** (D-03): bypass total → cero cambios.
- `test/check.test.js` — bytes de `runCheck()`. **GOLDEN BYTES en NO_COLOR** (D-09): conservación del shape `[kodo:check] ...`.
- `test/gsd-inspect-cli.test.js` — bytes de `runGsdInspect`. **CAMBIA** (D-12, D-13): refactor a 4 secciones requiere actualizar asserts. Exit code semántico (D-19) se preserva.
- `test/gsd-verify-cli.test.js` — bytes de `runGsdVerifyCli`. **CAMBIA** (D-14, D-15): mapping de colores y summary nuevo.

### Dependencias externas

- Ninguna nueva. `picocolors` ya en `package.json` desde Phase 14.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`createFormatter(stream, env?)` factory de format.js (Phase 14)** — produce todos los helpers que Phase 15 necesita: `debug/info/warn/error/ok/fail/green/yellow/red/cyan/gray/dim/formatRow/formatTable`. Sin abrir picocolors fuera (D-07).
- **`_resolveUseColor(stream, env?)` exportado para tests/internal de format.js** — sustituye el patrón inline `Boolean(stream.isTTY) && !process.env.NO_COLOR` actualmente en `logger.js:204` y `reader.js:68`. Generaliza con FORCE_COLOR (Phase 14 D-02).
- **`OK_SYMBOL = '✓'` / `FAIL_SYMBOL = '✗'` constantes exportadas** — disponibles si un callsite necesita el símbolo crudo sin pasar por `fmt.ok/fail`. En Phase 15 se prefieren los helpers (`fmt.ok`/`fmt.fail`) que ya embeben símbolo + color.
- **DI-by-descriptor pattern** — `gsd-inspect.js:50-52` y `gsd-verify.js:55-57` ya inyectan `writeFn`/`errFn`. Phase 15 puede añadir `formatterFn` con default `() => createFormatter(process.stdout)` para tests determinísticos.
- **`runCheck()` separa `lines` de `summary`** — la lista de líneas se compone primero, luego se hace `lines.join('\n')`. Phase 15 puede colorizar cada línea individualmente sin tocar el join.

### Established Patterns

- ES modules puros, factory functions sobre classes, `@ts-check` obligatorio, JSDoc en API público (Phase 14 §Established Patterns).
- Tests con `node:test` + `node:assert/strict`. No fixtures externas para bytes; asserts inline.
- Convención de filename: `src/cli/` kebab-case, `src/logger.js` y `src/check.js` single-word lowercase.
- `Object.freeze` para tablas read-only que se exportan.
- **Branching shape dual por `useColor` interno**: `logger.js#formatLine` ya tiene un patrón `c = useColor ? color : ''` (line 85-86). Phase 15 lo extiende a "shape dual" (no solo color sino layout).
- **Exit code visible al final de un handler**: precedente en otras CLI tools (gh, jq) — alineado con D-13 visibility-without-altering-semantics.

### Integration Points

- **`logger.js → format.js`**: nuevo import. **NO debe romper LOG-12** (verificado por test/check-isolation.test.js que sigue ejecutándose; check.js no llega a logger.js).
- **`logs/reader.js → format.js`**: nuevo import (vía `_resolveUseColor` re-export). **NO afecta LOG-12** porque reader.js no está en el grafo de check.js.
- **`check.js → format.js`**: nuevo import directo. **LOG-12 sigue verde** porque format.js no importa logger.js (test/format-isolation.test.js Phase 14 D-06).
- **`cli/gsd-inspect.js → format.js`**, **`cli/gsd-verify.js → format.js`**: nuevos imports. Sin impacto LOG-12.
- **bin/kodo + cli.js**: smoke test `node bin/kodo --version` Phase 14 SC#4 sigue verde (Phase 15 no modifica entry point ni dispatch de comandos).

### Possible regressions to watch

- **TTY detection en CI**: tests del CI corren con `stdin.isTTY === false`, lo que activa el shape NON-TTY (preservación bytes). Bien — los snapshots NO_COLOR siguen verdes. Si algún test fuerza `isTTY=true` para asertar color, se actualizan asserts a la shape columnar.
- **`KODO_LOG_LEVEL=debug` en runtime**: `maybeMirrorToStderr` empieza a emitir más records. Con TTY+color = más output con shape columnar. NO afecta bytes determinísticos del NDJSON sink.
- **Componentes >12 chars en logs reales**: actualmente los componentes del repo son `dispatcher` (10), `gsd-bootstrap` (13 → desborda 1 char), `gsd-resolver` (12 borderline). D-05 acepta el desborde sin truncate; documentar como expected.

</code_context>

<specifics>
## Specific Ideas

- **Golden bytes test crítico (SC#1, SC#2)**: para `kodo logs` añadir un test que arme un record sintético, llame `formatLine(rec, { useColor: false })` y assert que la string devuelta es **byte-a-byte igual** a la pre-Phase 15. Un fixture inline con el output exacto. Si falla, la regresión se detecta antes del merge.
- **Matriz TTY × NO_COLOR × FORCE_COLOR para `kodo logs`** (extiende la matriz Phase 14 §specifics line 129):
  - TTY+default → columnar + color.
  - non-TTY+default → shape actual (bytes idénticos).
  - `NO_COLOR=1` (cualquier valor) → shape actual.
  - `FORCE_COLOR=1` + non-TTY → columnar + color.
  - `NO_COLOR=1 + FORCE_COLOR=1` → shape actual (D-02 Phase 14 precedence).
- **Matriz para `kodo check`**: solo dos casos relevantes — TTY → líneas con `fmt.yellow/red/ok` (color); non-TTY → bytes IDÉNTICOS al pre-Phase 15 (los strings sin ANSI).
- **`gsd inspect` regression test crítico (D-13)**: assert que la línea final imprimida `Exit: N` coincide con el valor de retorno del handler. Para los 4 escenarios: phase, bootstrap, error (verdict), config error (resolveProjectPath throws), fetch error (provider.getTask throws). 5 casos, 5 asserts.
- **`gsd verify` regression test (D-14)**: para cada uno de los 4 verdicts (pass/fail/missing/malformed), capturar el output y asertar que contiene el helper esperado (`fmt.green('pass')` cuando pass, etc.). Smoke test con TTY mock.
- **Regression del comentario Plane (Pitfall #2 Phase 10)**: assert separado que el resumen mostrado en stdout NO afecta el `addComment` body. Ambos vienen de `renderComment(verdict)`; el resumen es solo un slice de las 2 primeras líneas. Si alguien refactoriza para reutilizar el render, se rompe el contrato — el test cubre.
- **Test source-hygiene Phase 14 (`test/format-isolation.test.js`)**: añadir aserción adicional que `src/logger.js`, `src/check.js`, `src/cli/gsd-inspect.js`, `src/cli/gsd-verify.js`, `src/logs/reader.js` SI importan `src/cli/format.js` (positive assertion — confirma que el cableado se hizo). Y que NINGUNO importa `picocolors` (negative — D-07 single-source preserved).
- **`kodo --version` smoke test (Phase 14 SC#4)**: sigue verde tras Phase 15. No se reescribe; solo se confirma en CI.
- **Componente largo desborda alineación**: añadir una nota en el README o el helper para que los nuevos componentes que se añadan al logger respeten ≤12 chars. No bloquea Phase 15.

</specifics>

<deferred>
## Deferred Ideas

- **Truncation con ellipsis** (`fmt.formatRow(cells, widths, { truncate: true })`) — solo si surge necesidad real en producción tras Phase 15. No requerido por SCs.
- **Migración de `kodo check` a `formatTable` semántico** — la opción rechazada en Área 3 D-09 puede revisitarse si la legibilidad sufre. Posible Phase 15.5 o post v0.5.
- **Body completo del comentario Plane en `gsd verify`** — la opción rechazada en Área 4 D-15. Si los operadores reportan que necesitan el body completo, se añade flag `--full-comment`. Out of scope v0.5.
- **`fmt.bold`, `fmt.italic`, `fmt.underline`** — no requeridos por SCs Phase 15. Si Phase 16/17 los pide, se añaden a format.js.
- **Snapshot tests por archivo (golden bytes file fixtures)** — overkill para 4 surfaces. Inline asserts suficientes.
- **Themes / paletas configurables** — explícitamente Out of Scope en REQUIREMENTS.md (YAGNI personal CLI).
- **Wide-char / emoji widths con `Intl.Segmenter`** — los componentes del logger son ASCII puro; no aplica.

### Reviewed Todos (not folded)

N/A — `gsd-tools todo match-phase 15` devolvió 0 matches.

</deferred>

---

*Phase: 15-cli-polish-wiring*
*Context gathered: 2026-05-05*
