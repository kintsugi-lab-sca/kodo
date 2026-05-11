# Phase 14: CLI Format Foundation - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Crear el helper `src/cli/format.js` (factory de color/format con TTY detection por descriptor + respeto a `NO_COLOR`/`FORCE_COLOR`) y añadir `picocolors` como dependencia. Phase 14 NO modifica ningún callsite — `kodo logs`, `kodo check`, `gsd inspect`, `gsd verify` se cablean en Phase 15 (DX-01..05).

**Queda fuera de Phase 14:** wire del helper en cualquier surface (kodo logs columnas DX-02, gsd-inspect/verify color DX-03/DX-04, kodo check OK/FAIL DX-05), modificación de `src/logger.js` (`formatLine` + `COLOR_BY_LEVEL` siguen donde están), refactor del logger para consumir `format.js`. Todo eso es Phase 15.

</domain>

<decisions>
## Implementation Decisions

### API shape del helper

- **D-01:** Factory `createFormatter(stream, env?)` bound al descriptor — el helper devuelve un objeto con métodos `{ debug, info, warn, error, ok, fail, formatRow, formatTable, green, yellow, red, cyan, gray, dim }` ya bound al stream pasado. Cumple SC#1 literal ("TTY detection a partir del descriptor pasado") sin ambigüedad. Caller: `const fmt = createFormatter(process.stdout); fmt.ok('done')`.
- **D-02:** Precedencia: **`NO_COLOR` gana sobre `FORCE_COLOR`**. Si `NO_COLOR` está set (cualquier valor) → `useColor = false`. Si `NO_COLOR` no está set y `FORCE_COLOR` está set (cualquier valor no-`'0'`) → `useColor = true`. Else → `stream.isTTY`. Coincide con la lógica interna de picocolors y con no-color.org.
- **D-03:** Set de helpers expuestos por el formatter:
  - **Por nivel:** `debug` (gris), `info` (cyan), `warn` (amarillo), `error` (rojo) — coherente con DX-01 + Phase 7 D-03.
  - **Sintácticos:** `ok(text)` con símbolo `✓` embebido, `fail(text)` con símbolo `✗` embebido.
  - **Tabular:** `formatRow(cells, widths, opts?)`, `formatTable(rows, opts?)`.
  - **Colores genéricos:** `green`, `yellow`, `red`, `cyan`, `gray`, `dim` — escape hatch mínimo para casos como gsd-verify (DX-04) donde `info=cyan` no aplica para "pass=verde".
- **D-04:** `useColor` se evalúa **eager** una vez en `createFormatter(stream, env)` y se captura en closure. No se re-lee `process.env` ni `stream.isTTY` por llamada. Más rápido (cero env lookups), más testeable (mock `env` una sola vez), más simple.

### Convivencia con `formatLine` de `logger.js`

- **D-05:** **`logger.js` queda intocable.** `formatLine(record, { useColor })` y `COLOR_BY_LEVEL` siguen ahí (`src/logger.js:82, src/logger.js:37`); `src/logs/reader.js:24` los sigue consumiendo. `format.js` NO los importa (LOG-12) y duplica los color primitives vía picocolors. `kodo logs` Phase 15 sigue usando `formatLine` para el shape NDJSON record-aware; `format.js` cubre los OTROS surfaces (gsd-inspect/verify, kodo check, level chip genérico). Mínima superficie tocada en Phase 14, LOG-12 trivialmente preservado.
- **D-06:** El walker LOG-12 contra `src/cli/format.js` vive en **`test/format-isolation.test.js`** (archivo nuevo), NO en `check-isolation.test.js`. Esto agrupa todos los guards de hygiene de format.js en un solo archivo (cohesión por sujeto: format.js); `check-isolation.test.js` queda con su guard original `check.js → logger.js`. El walker es el mismo `walkImports()` reutilizado/copiado.

### Picocolors: única superficie de color

- **D-07:** **`format.js` es la ÚNICA superficie de color en kodo.** `picocolors` NO se re-exporta. Cualquier callsite que necesite color va por `createFormatter(...)`. Si falta un helper, se añade a `format.js`. Coherente con D-09/D-10/D-11 source-hygiene pattern de fases anteriores.
- **D-08:** Test source-hygiene grep contra `picocolors` imports vive en **`test/format-isolation.test.js`** (mismo archivo que D-06). Asserta que solo `src/cli/format.js` importa `picocolors`; cualquier otro import en `src/` falla el test.

### Column formatter

- **D-09:** **Dos APIs**: `fmt.formatRow(cells, widths, opts?)` para streaming (kodo logs no conoce todos los rows a tail-time, widths constantes razonables) y `fmt.formatTable(rows, opts?)` para render completo con widths auto-calculados (kodo check tabla, gsd inspect verdict por sección). Ambas comparten internals de padding y separator.
- **D-10:** **Strip-aware width interno.** `format.js` define `visibleWidth(s) = s.replace(/\x1b\[\d+m/g, '').length` y la usa internamente en `padCell()`. El caller pasa cells ya coloreadas (`fmt.cyan('INFO')`); la alineación funciona transparentemente. Una sola fuente de verdad para "qué cuenta como ancho".
- **D-11:** Separador con default `' · '` (espacio + middle dot + espacio) — match literal de DX-02 — pero **configurable** via `opts.separator`. Surfaces avanzados pueden pasar otro (ej. `'  '` para densidad mayor o `' | '` para tabla técnica).

### Claude's Discretion

- Estructura interna del módulo (un solo archivo `src/cli/format.js` o split si supera ~250 LoC).
- Implementación exacta del resolver `useColor`: vía `picocolors/createColors(useColor)` factory con bool explícito vs custom wrapper que descarte el output si `useColor=false`.
- Versión exacta de `picocolors` (rango caret coherente con `commander@^13.0.0` — sugerencia `^1.0.0` sin pin).
- Forma exacta del walker en `test/format-isolation.test.js`: copiar el walker de `check-isolation.test.js` o extraer a un helper compartido (`test/helpers/import-walker.js`).
- Behavior de `visibleWidth` con strings multi-byte / emoji / wide-chars CJK: por ahora `String.length` post-strip; si hay regresión visible, considerar `Intl.Segmenter` o `string-width` (otra dep). Default conservador: ASCII puro en cells de tabla.
- Default widths sensatos para `formatRow` cuando se invoca desde `kodo logs` (timestamp=8, level=5, component≈12). Phase 15 los fija al cablear.
- Naming exacto de los métodos del formatter: `formatRow` vs `row`, `formatTable` vs `table`. Convención del repo (camelCase verbosa) sugiere `formatRow`/`formatTable`.

### Folded Todos

Ninguno — `gsd-tools todo match-phase 14` devolvió 0 matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements (Phase 14 alcance)
- `.planning/ROADMAP.md` §"Phase 14: CLI Format Foundation" — Goal + 5 success criteria observables.
- `.planning/REQUIREMENTS.md` §DX — DX-06 (helper centraliza color/format con `--json` determinismo), DX-07 (picocolors como dep + PROJECT.md doc).
- `.planning/PROJECT.md` §Constraints — picocolors trade-off ya aceptado a nivel milestone (2ª dep externa después de commander).
- `.planning/STATE.md` §"Critical Invariants to Preserve" — LOG-12 guard + `--json` determinismo + lock release idempotente (Phase 16, no Phase 14).

### Contexto de fases previas (cross-decisions que Phase 14 hereda)
- `.planning/milestones/v0.3-phases/06-structured-logger-foundation/06-CONTEXT.md` — LOG-12 isolation (Decisión B + walker en `test/check-isolation.test.js`). Phase 14 **debe preservar** y **extiende** el guard a `src/cli/format.js`.
- `.planning/milestones/v0.3-phases/07-kodo-logs-cli-event-taxonomy/07-CONTEXT.md` D-03 — colores semánticos por nivel (debug=gris, info=cyan, warn=amarillo, error=rojo) y `--json` passthrough crudo. Phase 14 hereda los mismos colores en sus level helpers.
- `.planning/milestones/v0.4-phases/13-test-coverage-matrix/13-CONTEXT.md` — pattern source-hygiene D-09/D-10/D-11 (single source of truth via test grep). Phase 14 lo replica para "single source of color".

### Código existente que Phase 14 referencia (NO MODIFICA)
- `src/logger.js:82` — `formatLine(record, { useColor })`. **Intocable Phase 14.** Referencia para entender qué hace el reformat actual de `kodo logs` (record-shaped).
- `src/logger.js:37` — `COLOR_BY_LEVEL = { debug: gray, info: cyan, warn: yellow, error: red }`. Replicar mismos códigos en `format.js`.
- `src/logger.js:204` — patrón actual `useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR`. Phase 14 lo generaliza con descriptor por argumento + soporte `FORCE_COLOR`.
- `src/logs/reader.js:24` — consumer de `formatLine`. **Phase 14 no lo toca**; Phase 15 puede refactorizarlo.
- `src/check.js:15-17` — ANSI inline (`ANSI_YELLOW`/`ANSI_RED`/`ANSI_RESET`). **Phase 14 no lo toca**; Phase 15 lo migra a `createFormatter(process.stderr).ok/fail`.
- `src/cli/gsd-inspect.js`, `src/cli/gsd-verify.js` — handlers actuales con `--json` ya cableado (no usan color hoy). Phase 15 los cablea.
- `bin/kodo` + `src/cli.js` — entry point + commander. SC#4 dice "`kodo --version` sigue funcionando sin warnings" — añadir picocolors no debe romper la carga del CLI.
- `package.json` — Phase 14 añade `picocolors` a `dependencies`; `package-lock.json` se regenera.

### Tests
- `test/check-isolation.test.js` — walker LOG-12 actual (`check.js → logger.js`). Phase 14 lo deja intacto; el walker se replica para el guard de format.js en archivo nuevo.
- `test/format-isolation.test.js` — **NUEVO archivo Phase 14**. Agrupa: (a) walker LOG-12 contra `src/cli/format.js` (D-06), (b) grep contra `picocolors` imports en `src/` (D-08).
- `test/logger.test.js`, `test/logger-redaction.test.js`, `test/logs-reader.test.js` — tests de logger/logs ya existentes; Phase 14 no los toca pero deben seguir pasando (línea base 414/415).

### Dependencia externa nueva
- [picocolors v1.x](https://github.com/alexeyraspopov/picocolors) — single-purpose, ~100 LOC, zero deps, exporta `createColors(useColor: boolean)` factory que acepta el bool explícito (clave para D-04 eager + descriptor-aware). Tamaño install: ~3KB.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Patrón de DI por descriptor:** `src/cli/gsd-inspect.js:51-52` y `src/cli/gsd-verify.js:56-57` ya inyectan `writeFn`/`errFn` en sus deps; el factory `createFormatter(stream)` encaja con el mismo estilo (DI explícito, testeable con fake stream).
- **Walker de imports:** `test/check-isolation.test.js:30-50` (`walkImports` + `extractImports`) es replicable casi verbatim para `test/format-isolation.test.js`.
- **Convenciones ANSI:** `src/logger.js:31-42` define `ANSI_RESET` y los 4 códigos por nivel — útil de referencia para asegurar coherencia visual entre `formatLine` (mirror stderr de logger.js) y los level helpers de `format.js`.

### Established Patterns
- ES modules puros (`"type": "module"`). `format.js` exporta named `createFormatter` (+ posibles re-exports tests-only: `visibleWidth`, `_resolveUseColor` con underscore prefix para señalizar internal).
- Factory functions sobre classes (estilo `createLogger`, `parseKodoLabels`). Factory pure que devuelve objeto con métodos, sin `this`.
- JSDoc `@param`/`@returns` obligatorio en API público.
- Tests con `node:test` + `node:assert/strict`. No fixtures externas para format.js — golden bytes se assertan inline.
- **Convención de filename**: `src/cli/` usa kebab-case (`gsd-inspect.js`, `gsd-verify.js`); `format.js` (single word) sigue la convención.
- **`@ts-check` obligatorio** al inicio de cada archivo `src/**/*.js`.

### Integration Points
- **Entry point del helper:** `src/cli/format.js`. Exporta `createFormatter(stream, env?)` como named export. Posibles re-exports tests-only: `visibleWidth`, `_resolveUseColor` (prefix `_` = internal).
- **Phase 15 callsites previstos** (NO se tocan en Phase 14):
  - `src/check.js` — sustituye ANSI inline por `createFormatter(process.stderr).fail/ok`.
  - `src/cli/gsd-inspect.js` — colorea verdict por sección (✓/✗) + exit code visible (DX-03).
  - `src/cli/gsd-verify.js` — colorea pass=green / soft-fail=yellow / hard-fail=red (DX-04).
  - `src/logs/reader.js` — opcional: usa `formatRow` para alineación columnas DX-02; el level chip puede pasar por `fmt.cyan(...)` antes de meterse a la línea.
- **Picocolors carga**: import en `src/cli/format.js` solamente. Cargado lazily (cuando algún surface importe `format.js`). Phase 14 no lo carga en path de `kodo check` — eso pasa en Phase 15 (se preserva LOG-12 si format.js no importa logger.js).

</code_context>

<specifics>
## Specific Ideas

- **El factory acepta `env` opcional** (default `process.env`) para tests determinísticos: `createFormatter(fakeStream, { NO_COLOR: '1' })`.
- **Fake stream para tests**: un objeto literal `{ isTTY: true|false }` basta. No hace falta `Writable` real.
- **Matriz de 4 estados validada por test (SC#1)**: TTY+default → color; no-TTY+default → sin color; `NO_COLOR=1` (cualquier valor) → sin color; `FORCE_COLOR=1` + no-TTY → con color; `NO_COLOR=1 + FORCE_COLOR=1` → sin color (D-02 precedencia). Una tabla de 5 casos en el test.
- **Golden bytes test (SC#3)**: para cada helper (`info`, `ok`, `fail`, `green`, etc.), assert que con `useColor=false` devuelve el string original SIN escapes ANSI. Inline `assert.equal()`, no fixture file.
- **`kodo --version` smoke (SC#4)**: test que ejecuta `node bin/kodo --version` via `child_process.spawnSync` y assertea exit 0 + stdout contiene `"0.1.0"` + stderr vacío. Detecta cualquier rotura por importar picocolors.
- **No usar picocolors auto-detection global**: por D-04 (eager + descriptor-aware), el factory llama `createColors(useColor)` de picocolors, no `import pc from 'picocolors'`. Así colores fuerzados a estado conocido.
- **`fmt.dim('text')`** se incluye en colores genéricos para casos como label "(skipped)" o metadata secundaria que no encaja en debug pero debe atenuarse.
- **El test que `kodo --version` no warn-ea** capta indirectamente cualquier deprecation de picocolors o npm warning de install.
- **Documentación PROJECT.md SC#4**: añadir en `## Constraints` una línea explicando el bump (commander → commander+picocolors) — la sección ya menciona "mínimas dependencias externas" y debe reflejar la nueva 2ª dep.

</specifics>

<deferred>
## Deferred Ideas

- **Refactor de `logger.js` para consumir `format.js`** — más limpio (single source de color total), pero rompe "no callsites en Phase 14" y duplica el churn. Posible Phase 15.5 o post-milestone v0.5.
- **`string-width` o `Intl.Segmenter` para wide-chars CJK / emoji** — si en el futuro las cells de tabla contienen multi-byte. Default ASCII-puro es suficiente para los 4 surfaces de v0.5.
- **Themes / paletas configurables** — explícitamente Out of Scope en REQUIREMENTS.md (YAGNI personal CLI).
- **`fmt.bold`, `fmt.italic`, `fmt.underline`** — no requeridos por los SCs de Phase 14/15. Si Phase 15 los pide, se añaden.
- **Wrapping de líneas largas** — fuera de scope. Las líneas de `kodo logs` se asumen one-line por record; si exceden ancho del terminal, el terminal hace el wrap natural.
- **Tests de regression visual (snapshot tests por archivo)** — overkill para 4 surfaces. Inline asserts cubren los SCs.

### Reviewed Todos (not folded)
N/A — `gsd-tools todo match-phase 14` devolvió 0 matches.

</deferred>

---

*Phase: 14-cli-format-foundation*
*Context gathered: 2026-05-04*
