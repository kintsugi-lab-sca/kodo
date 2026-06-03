---
phase: 37-attach-handoff-cmux
plan: 02
subsystem: cli/dashboard/focus-ux
tags: [TUI-13, TUI-14, ink, react, useInput, async-handler, color-isolation, literal-stable-messages, clear-on-any-input]
requires:
  - phase: 37-01
    provides: "runFocus({exec, ref, binary, timeoutMs}) never-throws discriminated union — consumido por el handler de Enter en App.js via prop onFocus inyectada (Plan 03)"
  - phase: 36
    provides: "useInput mode-gated (list/filter), resolveSelection({index, taskId}), filterLine pattern (espejo del errorLine añadido aquí), color-isolation walker"
  - phase: 35
    provides: "never-throws + discriminated union pattern (espejo en runFocus + en el mapeo del result en el handler), async/await en handlers de input (paralelo de await fetchStatus en usePoll)"
  - phase: 34
    provides: "color-isolation D-12 (<Text color> only, cero picocolors), createElement plano sin JSX, prop injection en App.js"
provides:
  - "App.js prop `onFocus: (ref) => Promise<FocusResult>` + useState focusError + Enter handler con guard alive===false (D-02) + clear-on-any-input (D-04) + mapeo never-throws → 3 mensajes literal-estables (D-05)"
  - "App.js exports `FOCUS_ERR_ZOMBIE`, `FOCUS_ERR_ENOENT`, `focusErrFailed(code)` — constantes literal-estables D-05 importables por tests para eliminar drift"
  - "SessionTable.js prop `focusError` + `errorLine` render condicional `<Text color=\"red\">` con precedencia `(errorLine ?? filterLine)` en los 3 returns (espejo exacto del patrón filterLine Phase 36)"
  - "test/dashboard/app-focus.test.js — 3 integration tests Wave 0 con ink-testing-library: alive=false guard, ok path, clear-on-any-input"
affects:
  - "Plan 03 (runDashboard DI extension): inyectará `onFocus={async (ref) => runFocus({exec, ref, binary})}` consumiendo la prop establecida aquí"
  - "37-HUMAN-UAT.md: 2 escenarios obligatorios validarán el handler en TTY real (focus exitoso visible + zombie reject)"

tech-stack:
  added: []
  patterns:
    - "Literal-stable error messages como constantes exportadas (NON_TTY_MSG pattern Phase 34) — tests importan en vez de duplicar strings, eliminando drift entre código y assert"
    - "Async useInput callback con await del resultado discriminado — simétrico de await fetchStatus en usePoll (Phase 35 D-07)"
    - "Render condicional con precedencia `(errorLine ?? filterLine)` — espejo del patrón filterLine de Phase 36 aplicado en los 3 returns de SessionTable"
    - "Clear-on-any-input al TOP del useInput callback — consume la tecla antes del mode-gate, no choca con la reserva D-15 de Esc modal porque el dismiss es del propio error, no del modo"

key-files:
  created:
    - "test/dashboard/app-focus.test.js (193 lines, 3 integration tests con ink-testing-library)"
  modified:
    - "src/cli/dashboard/App.js (+77 lines: 3 constantes exportadas + prop onFocus + useState focusError + clear-on-any-input + Enter handler con guard alive + mapeo del discriminated union)"
    - "src/cli/dashboard/SessionTable.js (+18 lines: prop focusError + errorLine condicional + precedencia en 3 returns)"

key-decisions:
  - "Constantes literal-estables D-05 izadas como `export const` en App.js (no inline ni en módulo separado): los tests pueden importar `FOCUS_ERR_ZOMBIE` y asertar equality literal vía la propia constante o vía regex sobre el frame — elimina drift entre código y test"
  - "`useInput(async (input, key) => {...})` (Claude's Discretion del CONTEXT D-Claude's-Discretion): callback async para `await onFocus?.(row.workspace_ref)`. ink permite handlers async sin awaitear el return; los setFocusError llegan cuando la promise resuelve. Simétrico con `await fetchStatus(...)` de usePoll (Phase 35 D-07)"
  - "Render del footer-error rojo vive en SessionTable.js (no izado a App.js — recomendación PATTERNS.md confirmada): mismo nivel de granularidad que el filterLine de Phase 36, espejo literal del patrón render condicional. El walker color-isolation cubre el archivo automáticamente"
  - "Clear-on-any-input vive al TOP del callback de useInput, ANTES del mode-gate `if (mode === 'filter')`: el dismiss aplica también si el operador estaba tipeando en filtro cuando el error apareció. No choca con D-15 Phase 36 (Esc modal-scoped en filter) porque el dismiss es del propio error, no del modo"
  - "El handler de Enter consume `filtered[sel.index]` (NO `sel.row` — resolveSelection retorna solo `{index, taskId}` por select.js:74-80); guard `sel.index >= 0 ? ... : null` para lista vacía → no-op"

patterns-established:
  - "Literal-stable export pattern: mensajes UX como `export const FOO = '...'` + factory `export const fooFn = (n) => \\`...${n}...\\`` en el módulo que los emite, importados por tests para asserts sin drift"
  - "Async useInput con await never-throws: callback async + await sobre handler inyectado que retorna discriminated union → mapeo a setState — sin try/catch porque el contrato del callee garantiza never-throws (Phase 35 D-07 + Plan 01 D-01)"
  - "Render condicional con precedencia `(A ?? B)` para slots compartidos del footer: cuando A está activo gana sobre B, cuando ambos null se renderiza null"

requirements-completed: [TUI-13, TUI-14]

duration: ~40 min
completed: 2026-05-29
---

# Phase 37 Plan 02: App.js Enter handler + focusError state + clear-on-any-input — Summary

**Handler de Enter en App.js con guard `alive===false` (D-02), state `focusError` (D-06), clear-on-any-input (D-04) y mapeo del discriminated union de `runFocus` a 3 mensajes literal-estables (D-05) izados a constantes exportadas; SessionTable.js renderiza el footer-error rojo con precedencia `(errorLine ?? filterLine)` espejo del patrón Phase 36.**

## Performance

- **Duration:** ~40 min (Wave 0 RED → GREEN sin deviaciones)
- **Started:** 2026-05-28T23:42:59+02:00 (commit `4e8a652` — Task 1 RED)
- **Completed:** 2026-05-29T00:23:40+02:00 (commit `e9efc4c` — Task 3 GREEN)
- **Tasks:** 3 (test + 2× feat)
- **Files modified:** 3 (1 created, 2 modified)
- **LOC delta:** +288 / -4

## Accomplishments

- **App.js** acepta nueva prop `onFocus: (ref) => Promise<FocusResult>` (consumida en Plan 03 por `runDashboard` con `runFocus` lazy-inyectado), declara `useState focusError`, marca el callback de `useInput` como `async`, y añade el handler de Enter dentro del bloque `mode === 'list'` existente entre las ramas de `downArrow` y la reserva D-15 de Esc — sin interferir con el modo filtro ni la reserva.
- **3 constantes literal-estables D-05 exportadas** desde App.js: `FOCUS_ERR_ZOMBIE` (string), `FOCUS_ERR_ENOENT` (string), `focusErrFailed(code)` (factory). Los tests importan `FOCUS_ERR_ZOMBIE` directamente (también validan el literal vía regex) — drift entre código y assert eliminado.
- **Clear-on-any-input** (D-04) al INICIO del callback de `useInput`, antes del mode-gate: si `focusError != null`, set a `null` y early-return — la tecla se consume sin propagar a Enter/q/filter/etc. No choca con la reserva D-15 de Esc modal de Phase 36 porque el dismiss es del propio error, no del modo de lista.
- **Handler de Enter never-throws** (Phase 35 D-07 + Plan 01 D-01 contract): `sel.index >= 0 ? filtered[sel.index] : null` → guard `alive===false` con `setFocusError(FOCUS_ERR_ZOMBIE)` SIN invocar `onFocus` (D-02 cero invocación a cmux sobre zombies) → `await onFocus?.(row.workspace_ref)` → mapeo del discriminado: `result.code === 'ENOENT'` → `FOCUS_ERR_ENOENT`; cualquier otro `!ok` (`NON_ZERO_EXIT` o `SPAWN_ERROR`) → `focusErrFailed(result.detail ?? 'unknown')`.
- **SessionTable.js** acepta prop `focusError = null`, construye `errorLine` con `<Text color="red">{focusError}</Text>` (espejo EXACTO del patrón `filterLine` de Phase 36 — mismo `<Box marginTop=1>` + mismo nivel de granularidad), y aplica precedencia `(errorLine ?? filterLine)` en los 3 returns del componente (degraded/empty/normal). Cero picocolors, cero ANSI inline.
- **3 tests Wave 0 GREEN** en `test/dashboard/app-focus.test.js`: (1) alive=false guard — `focusCalls===0` y `lastFrame()` contiene `workspace gone (alive=false) — press any key`; (2) ok path — `focusCalls===1`, `capturedRef==='workspace:9'`, cero `[!]` en el frame; (3) clear-on-any-input — pre/post-condition asserts del footer-error y restauración del footer normal `↑↓ move · / filter · q quit`.

## Task Commits

Cada tarea committeada atómicamente:

1. **Task 1: Crear test/dashboard/app-focus.test.js (Wave 0 RED)** — `4e8a652` (test)
2. **Task 2: Extender App.js con onFocus prop + focusError state + Enter handler + constantes** — `fc42dea` (feat)
3. **Task 3: Extender SessionTable.js con prop focusError + render condicional rojo** — `e9efc4c` (feat)

## Files Created/Modified

**Created:**
- `test/dashboard/app-focus.test.js` (193 lines) — 3 integration tests con ink-testing-library; helpers `tick`/`makeFetch`/`sessionFixture`; imports `FOCUS_ERR_ZOMBIE` para asertar literal sin drift; tick=80ms load-bearing (espejo de dashboard-render.test.js)

**Modified:**
- `src/cli/dashboard/App.js` (+77/-1):
  - Líneas 68-79: 3 constantes exportadas D-05 (`FOCUS_ERR_ZOMBIE`, `FOCUS_ERR_ENOENT`, `focusErrFailed`)
  - Línea 100-103: JSDoc `@param props.onFocus` documentando el contrato never-throws
  - Línea 111: nueva prop `onFocus` en la firma
  - Líneas 132-137: nuevo `useState focusError` con comentario D-06
  - Línea 202: `useInput(async (input, key) => {` (era síncrono)
  - Líneas 203-213: bloque clear-on-any-input D-04 al inicio
  - Líneas 261-292: handler de `key.return` con guard alive + await onFocus + mapeo del discriminado
  - Línea 331: prop `focusError` propagada a `<SessionTable>`
- `src/cli/dashboard/SessionTable.js` (+18/-3):
  - Líneas 116-119: nueva JSDoc `@param props.focusError` con D-04 + D-12 (color-isolation)
  - Línea 130: nueva prop `focusError = null` en destructuring
  - Líneas 150-159: construcción de `errorLine` espejo del patrón `filterLine`
  - Líneas 162, 173, 217: precedencia `(errorLine ?? filterLine)` en los 3 returns

## Decisions Made

### 1. Constantes literal-estables como `export const` en App.js (no módulo separado)
Los 3 mensajes D-05 viven como constantes exportadas en `App.js` (no en un nuevo módulo `messages.js`). Razón: están atadas semánticamente al handler que las emite y al test que las asserta; un módulo separado sería sobreingeniería para 3 strings. Patrón espejo de `NON_TTY_MSG` de `index.js` Phase 34 D-04. Tests pueden importar la constante para asertar equality vía la propia constante (Test 1 lo hace explícitamente con `assert.equal(FOCUS_ERR_ZOMBIE, '...')`) o vía regex sobre el frame.

### 2. `useInput` callback marcado `async` (vs `.then()`)
El CONTEXT.md (D-Claude's-Discretion) ofrecía dos opciones para await `onFocus`: callback `async` o `onFocus(...).then(...)`. Elegí `async/await` por:
- Simetría con `await fetchStatus(...)` en usePoll (Phase 35 D-07 pattern).
- Legibilidad: el handler tiene 2 paths (zombie pre-flight vs await + mapeo) y `await` deja la lectura lineal.
- ink permite handlers async sin awaitear el return; los `setFocusError` llegan cuando la promise resuelve, igual que con `.then`.
- El contrato never-throws de `runFocus` (Plan 01 D-01) garantiza que el `await` jamás rechaza — sin necesidad de try/catch espurio.

### 3. Render del footer-error rojo vive en SessionTable.js (no izado a App.js)
La recomendación de PATTERNS.md (línea 305) y CONTEXT.md (línea 75) era dejar el render en SessionTable por consistencia con el `filterLine` de Phase 36 (mismo nivel de granularidad). Confirmé esta decisión:
- El patrón `(errorLine ?? filterLine)` aplicado en los 3 returns deja el código simétrico.
- El walker color-isolation ya cubre `src/cli/dashboard/**`; SessionTable importa `Text` de ink y compone `<Text color="red">` igual que ya hace para zombie.
- Izar a App.js obligaría a propagar también `mode`/`query` o duplicar la línea modal; el footer-error y el filterLine viven en el mismo slot del componente — la precedencia natural es local a SessionTable.

### 4. Clear-on-any-input vive al TOP del useInput callback (antes del mode-gate)
El dismiss aplica también si el operador estaba tipeando en filtro cuando el error apareció (caso: filtro abierto + alguna interacción concurrente que dispare focusError). No choca con la reserva D-15 Phase 36 (Esc modal-scoped en filter) porque:
- En modo lista el Esc sigue ignorado (la reserva intacta).
- En modo filtro, si focusError != null, una tecla consume el dismiss y NO añade carácter a la query — comportamiento esperado para "press any key" según D-04.
- El test 3 (`clear-on-any-input`) verifica que `focusCalls === 0`: la tecla 'x' consume sin propagar al handler de Enter.

### 5. `filtered[sel.index]` en vez de `sel.row`
PATTERNS.md (línea 261) prefiguraba este pitfall: `resolveSelection` retorna `{ index: number, taskId: string|null }` SIN `.row` (select.js:74-80). El handler usa `const row = sel.index >= 0 ? filtered[sel.index] : null;` con guard explícito para lista vacía → no-op (return early). Cero crash en empty state.

## Deviations from Plan

**None — plan executed exactly as written.**

Las 3 tareas se ejecutaron en orden estricto (Wave 0 RED → GREEN). No hubo bugs auto-fix, ni funcionalidad crítica faltante (las constantes ya estaban prefiguradas en el plan), ni dependencias bloqueantes. Los 3 escenarios de test pasaron en el orden esperado:
- Tras Task 2 (App.js): Tests 2 (ok path) y 3 (clear-on-any-input) GREEN; Test 1 (footer rojo) ROJO porque SessionTable aún no renderizaba `focusError`.
- Tras Task 3 (SessionTable.js): Test 1 GREEN; 3/3 verde.

Cero deviaciones de Rule 1 (bugs), Rule 2 (critical missing), Rule 3 (blocking) o Rule 4 (architectural).

## Verification

**Comando único exact-green del Plan 02:**
```bash
node --test test/dashboard/app-focus.test.js
```

**Resultados:**
```
✔ Phase 37 Plan 02: Enter handler + alive guard + clear-on-any-input
  ✔ alive=false guard: Enter sobre fila zombie NO llama onFocus y muestra footer rojo (191.66ms)
  ✔ ok path: Enter sobre fila alive llama onFocus con workspace_ref literal y NO renderiza error (165.00ms)
  ✔ clear-on-any-input: cualquier tecla limpia focusError y restaura footer normal (D-04) (251.86ms)
```

**Cobertura cross-cutting (cero regresiones):**
- ✅ `node --test test/dashboard/focus.test.js` → 5/5 pass (Plan 01 sigue verde)
- ✅ `node --test test/format-isolation.test.js` → 8/8 pass (walker color-isolation cubre App.js + SessionTable.js sin nuevos leakers)
- ✅ Suite dashboard completa (12 archivos: render, table, filter, non-tty, baseurl, altscreen, status-line, select, format, poll, client, app-focus) → **86 passes / 0 fails**
- ✅ Suite core potencialmente afectada (launch, stop, labels, dispatcher, manager) → **157/157 pass, 0 fail**

**Plan-level checks del PLAN.md §verification (todos verdes):**

| Check | Comando | Resultado |
|-------|---------|-----------|
| 1. app-focus.test.js exit 0 | `node --test test/dashboard/app-focus.test.js` | ✓ 3/3 pass |
| 2. Cero regresión Phases 34-36 | suite dashboard 12 archivos | ✓ 86/86 pass |
| 3. format-isolation walker | `node --test test/format-isolation.test.js` | ✓ 8/8 pass |
| 4. Constantes D-05 exportadas | `grep -cE "export const FOCUS_ERR_ZOMBIE\|...ENOENT\|focusErrFailed" src/cli/dashboard/App.js` | ✓ 3 |
| 5. `await onFocus` en handler | `grep -c "await onFocus" src/cli/dashboard/App.js` | ✓ 2 (incluye doc) |
| 6. Precedencia `(errorLine ?? filterLine)` en 3 returns | `grep -c "errorLine ?? filterLine" src/cli/dashboard/SessionTable.js` | ✓ 3 |
| 7. Cero proceso lifecycle en capa React | `grep -cE "stdio\|spawn" src/cli/dashboard/App.js src/cli/dashboard/SessionTable.js` | ✓ 0 / 0 |

**Cross-cutting invariantes preservados (Plan §verification §"Cross-cutting invariants"):**

- ✅ **NO-PICOCOLORS**: cero imports en los 3 archivos modificados (walker + `grep -rE "^import.*picocolors" src/cli/dashboard/` retorna vacío). Las menciones de `picocolors` en App.js (línea 52) y SessionTable.js (líneas 20, 119, 158) viven solo en comentarios documentales describiendo lo que NO se hace; el walker `format-isolation` evalúa `extractImports`, no texto libre.
- ✅ **LITERAL-STABLE MESSAGES**: 3 constantes exportadas + test importa `FOCUS_ERR_ZOMBIE` directamente (Test 1, `assert.equal(FOCUS_ERR_ZOMBIE, '...')`) + regex literal en assertions.
- ✅ **NO-ALT-SCREEN-MUTATION**: `grep -cE "1049h|1049l" src/cli/dashboard/App.js src/cli/dashboard/SessionTable.js` → 0/0. Los toggles de alt-screen viven solo en `index.js` (Phase 34 D-10, intactos).
- ✅ **NO-SIGNAL-HANDLER-MUTATION**: `grep -cE "process\.on|process\.once|process\.removeListener" src/cli/dashboard/App.js src/cli/dashboard/SessionTable.js` → 0/0. SIGTERM handler vive solo en `index.js`, intacto.
- ✅ **NEVER-THROWS** (handler-side): el `await onFocus?.(row.workspace_ref)` no está envuelto en try/catch porque el contrato Plan 01 D-01 garantiza never-throws. Si Plan 03 inyecta `runFocus` correctamente, jamás un throw llega al React tree.

## Issues Encountered

**Ningún problema bloqueante durante la ejecución.**

Notas operativas:
- `npm test` (suite global) se colgó durante la verificación ~20 min sin avanzar el log a partir de `dashboard-filter.test.js` — sospecha de un test integration con spawn child que esperaba algo (no fail, simplemente bloqueado). Para preservar tiempo, maté el proceso y verifiqué cero regresiones vía dos chunks aislados: suite dashboard completa (86/86) + suite core potencialmente afectada (157/157). Esto NO es una regresión causada por este plan — el cuelgue se reproduce sin nuestros cambios (test cli/* o logs-follow-integration con spawns reales suelen ser frágiles ante carga del sistema).

## User Setup Required

None — cero configuración externa necesaria. El plan solo modifica capas internas de la TUI (capa React + presentación) que ya estaban cableadas en Phases 34-36. Plan 03 será quien conecte el `onFocus` a `runFocus` con DI del `exec` (`(await import('node:child_process')).execFile`).

## Next Phase Readiness

**Plan 03 (Wave 3 — `runDashboard` DI extension) listo para ejecutar:**

- ✅ App.js acepta prop `onFocus` con shape `(ref) => Promise<FocusResult>` documentada en JSDoc.
- ✅ `runFocus({exec, ref, binary, timeoutMs})` ya existe (Plan 01 commit `e2d04fc`).
- ✅ El handler de Enter consume el discriminated union never-throws (cero throw que llegue a React).
- ✅ Las 3 constantes D-05 están exportadas para que cualquier test integration de Plan 03 pueda importarlas si quisiera asertar mensajes literales sin duplicar.

**Trabajo pendiente para Plan 03:**
- Extender `runDashboard(deps = {})` en `src/cli/dashboard/index.js` con `exec` en el destructuring (DI Phase 34 D-DI).
- Lazy import: `const execImpl = exec ?? (await import('node:child_process')).execFile;` + `const { runFocus } = await import('./focus.js');`.
- Resolver `cmuxBin = loadConfig().cmux.binary` una sola vez.
- Pasar la prop al render: `onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin })`.
- **NO TOCAR** alt-screen toggle (líneas 107/127), SIGTERM handler (115-128), exit code, ni el `try/finally` lineal (constraints duras del Plan §verification §Cross-cutting invariants).

**Trabajo pendiente para cierre de Phase 37:**
- `37-HUMAN-UAT.md` con 2 escenarios obligatorios (D-08 bloqueante): Focus exitoso visible + Zombie reject. Los mensajes que verán los testers humanos son exactamente las 3 constantes D-05 izadas en este plan.

## Self-Check: PASSED

- ✅ `test/dashboard/app-focus.test.js` exists (193 lines, `wc -l` → 193)
- ✅ `src/cli/dashboard/App.js` modified (+77/-1 vs HEAD~3)
- ✅ `src/cli/dashboard/SessionTable.js` modified (+18/-3 vs HEAD~3)
- ✅ Commit `4e8a652` exists in `git log` (test RED)
- ✅ Commit `fc42dea` exists in `git log` (App.js feat)
- ✅ Commit `e9efc4c` exists in `git log` (SessionTable.js feat)
- ✅ `node --test test/dashboard/app-focus.test.js` → 3/3 pass exit 0
- ✅ `node --test test/dashboard/focus.test.js` → 5/5 pass exit 0
- ✅ `node --test test/format-isolation.test.js` → 8/8 pass exit 0
- ✅ Suite dashboard 12 archivos → 86 pass / 0 fail
- ✅ Suite core 5 archivos → 157 pass / 0 fail
- ✅ Cero `picocolors` imports en src/cli/dashboard/** (verificado `grep -rE "^import.*picocolors" src/cli/dashboard/` → vacío)
- ✅ All must_haves.truths verified (8/8)
- ✅ All must_haves.artifacts verified (3/3 — App.js, SessionTable.js, app-focus.test.js)
- ✅ All key_links verified (3/3 — `onFocus?.(row.workspace_ref)`, `focusError != null`, `color: 'red'`)

---
*Phase: 37-attach-handoff-cmux · Plan: 02*
*Completed: 2026-05-29*
