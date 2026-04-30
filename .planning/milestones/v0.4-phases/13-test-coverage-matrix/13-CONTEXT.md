# Phase 13: Test Coverage Matrix - Context

**Gathered:** 2026-04-29
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 13 cierra v0.4 con la matriz de tests cross-cutting que blinda los 4 estados de label (`none`, `gsd`, `gsd-quick`, ambos `gsd`+`gsd-quick`) en los 4 puntos de la cadena GSD (`labels` helper, `manager` builder, `dispatcher` resolver, `session-start` hook). El scope se amplía respecto al ROADMAP original para cerrar v0.4 sin huecos: también cubre `getSessionMode` aislado (Phase 11 D-09/D-10), `stop.js buildStopNudgeText` switch exhaustivo (Phase 12 D-07/D-08) y `launch.js buildContextSummary` gsdTag (Phase 12 D-11). Cubre QUICK-08 + scope extendido.

**No incluye** (ya completado en Phase 11 + Phase 12): código productivo de label parsing, persistencia de `gsd_mode`, dispatch infrastructure, hooks bifurcation, orchestrator visibility. Phase 13 es pura cobertura de tests sobre código ya shipped.

**No incluye** (out of scope per REQUIREMENTS): tests E2E de `kodo logs --session-of` con sesiones quick (es deuda LOG-09 carry-forward), migración programática de sesiones legacy, nuevos eventos NDJSON.

**No incluye** (deferred a v0.5+): tests de `kodo gsd inspect` o `kodo gsd verify` específicos para sesiones quick (CLI no soporta quick por D-04 v0.3 + REQUIREMENTS Out of Scope), tests de slash command `/gsd-quick` (vive en `~/.claude/skills/`).

</domain>

<decisions>
## Implementation Decisions

### Forma de la matriz (Área 1)

- **D-01:** Matriz **selectiva por afectación**: cubrir un estado en un sitio solo si afecta su branching. Ej: estado `none` en dispatcher se considera cubierto por el test no-GSD existente (`test/dispatcher.test.js:623 'does NOT call resolver for non-GSD tasks'`); `gsd-quick + gsd` (precedencia) solo se prueba en `test/labels.test.js`. Resultado esperado: ~10-12 tests nuevos efectivos, todos con propósito. ROADMAP success criteria 1-4 quedan 100% cubiertos por behavior.
- **D-02:** Enumeración inline de flags por test: `flags: ['gsd-quick']`, `flags: ['gsd']`, `flags: ['gsd', 'gsd-quick']`, `flags: []`. NO se introduce un helper compartido `LABEL_SCENARIOS`. Razón: alineado con el patrón actual de `manager.test.js` (`describe('GSD flag propagation (D-12)')` ya usa flags inline), grep-friendly (`grep gsd-quick test/`), cada test legible aislado. Coste aceptado: ~16 líneas repetidas a lo largo de los 4 archivos.
- **D-03:** Precedencia `gsd-quick > gsd` (ambos labels presentes) se valida **solo** en `test/labels.test.js` sobre el helper `getGsdMode([gsd, gsd-quick]) === 'quick'`. Los otros 3 sitios prueban cada modo aislado (`'full'`, `'quick'`), no la regla de precedencia. Coherente con D-09/D-10 Phase 11: el helper es la única fuente de la regla; los consumers no replican lógica.

### Scope ampliado: cerrar v0.4 sin huecos (Área 2)

- **D-04:** Tests aislados de `getSessionMode(session)` en `test/labels.test.js` cubren los 4 estados de SessionRecord: (a) `gsd:false` o ausente → `null`, (b) `gsd:true` legacy sin `gsd_mode` → `'full'` (regla Phase 11 D-08), (c) `gsd:true` + `gsd_mode:'full'` → `'full'`, (d) `gsd:true` + `gsd_mode:'quick'` → `'quick'`. Caso (b) es crítico: previene regresión silenciosa para sesiones v0.3 persistidas en `state.json` antes del rollout v0.4.
- **D-05:** Tests de `buildStopNudgeText` en `test/stop.test.js` cubren los 3 cases del switch exhaustivo (Phase 12 D-07): `case 'quick'` (assert: NO menciona `kodo gsd verify`, sí pide revisión manual, idioma ES), `case 'full'` (assert: SÍ menciona `kodo gsd verify <session-id>`, ternary phase_id correcto), `default` (assert: texto no-GSD original Phase 10). Cierra QUICK-06 con behavior coverage directo.
- **D-06:** Tests de `buildContextSummary` (gsdTag) en `test/orchestrator-gsd.test.js` cubren las 3 etiquetas según matriz mode + phase_id: (a) `gsd_mode:'quick'` → `[GSD quick]` (con o sin phase_id residual — defensa en profundidad Phase 12 D-11), (b) `gsd_mode:'full'` + `phase_id:'9'` → `[GSD phase 9]`, (c) `gsd_mode:'full'` sin `phase_id` → `[GSD bootstrap]`, (d) sesión no-GSD → cadena vacía (status quo Phase 10 D-19 preservado). Cierra QUICK-07 success criterion 3.
- **D-07:** ROADMAP §"Phase 13" se actualiza con success criteria 6-8 reflejando el scope ampliado (`getSessionMode`, `stop.js`, `launch.js`). REQUIREMENTS.md QUICK-08 puede dejarse como spec a alto nivel (el detalle vive en ROADMAP). Mantiene coherencia entre lo que la fase promete y lo que se testea.

### Behavior + source-hygiene selectivo (Área 3)

- **D-08:** Estilo dominante: **behavior tests**. Los nuevos tests afirman el resultado observable (`buildGsdContext({...session, gsd_mode:'quick'}, {})` contiene `/gsd-quick "TASK-X"` y NO contiene `/gsd-plan-phase`). Source-hygiene regex se usa **selectivamente** donde un cambio futuro rompería el invariante silenciosamente. Mismo patrón probado en `manager.test.js` (que ya combina ambos: `assert.equal(session.gsd, true)` + regex `/getGsdMode\(kodoFlags\)\s*!==\s*null/`).
- **D-09:** Source-hygiene invariante #1: **anti-inline `|| 'full'`** en `src/hooks/session-start.js`, `src/hooks/stop.js`, `src/orchestrator/launch.js`. Regex falla si el archivo contiene `/session\.gsd_mode\s*\|\|\s*['"]full['"]/`. Fuerza uso de `getSessionMode` en cualquier callsite futuro. Phase 11 <specifics> lo prohibió explícitamente como micro-violación de DRY.
- **D-10:** Source-hygiene invariante #2: **anti-acceso directo a `session.gsd_mode`** en los 3 sitios consumers (session-start, stop, launch). Regex falla si `/\.gsd_mode\b/.test(source)` en esos archivos. Excepción explícita: `src/labels.js` (donde `getSessionMode` lee el campo legítimamente). El test debe documentar la excepción en su mensaje de fallo. Refuerza D-09: el helper es la única puerta al campo.
- **D-11:** Source-hygiene invariante #3 en `test/stop.test.js`: el bloque del `case 'quick'` (capturado por regex sobre el source de `src/hooks/stop.js`) debe NO contener la subcadena `kodo gsd verify`. Complementa el behavior test D-05 (que assert sobre el output) con un guard sobre la fuente — si alguien refactoriza el switch y reintroduce el verify nudge en quick, ambos tests fallan.
- **D-12:** Source-hygiene invariante #4 en `test/manager.test.js`: extender el regex existente con un test gemelo que valida que `gsd_mode` se persiste vía helper `getGsdMode(flags)` en `buildSessionFromTask`, no inline `flags.includes('gsd-quick') ? 'quick' : 'full'`. Patrón paralelo al test existente para `skipPerms` (línea 304).

### Organización de tests (Área 4)

- **D-13:** Estilo de organización: **mezcla**. Tests *nuevos* (escenarios completamente nuevos de la matriz) van en un bloque `describe('QUICK-08 — quick mode coverage')` por archivo. Tests que *extienden* casos existentes (ej: añadir caso `'gsd-quick'` al describe `'GSD flag propagation (D-12)'` en `manager.test.js`) se añaden al bloque existente. Regla operativa: "nuevo escenario aislado → bloque QUICK-08; extensión de patrón existente → describe original".
- **D-14:** Naming de tests con prefijo `QUICK-08:` cuando relevante. Ej: `it('QUICK-08: parseKodoLabels detects gsd-quick label', ...)`, `it('QUICK-08: buildGsdContext renders /gsd-quick "<title>" for quick session', ...)`. Alineado con patrón existente (`'Test 1:'`, `'Phase 9:'`, `'D-01'`, `'CR-01'`). Solo en tests donde aporta trazabilidad — no en cada test.
- **D-15:** **NO** se añade un test "meta" que verifique el ROADMAP success criterion 5 (`node --test reporta 0 fallos`). Ese criterio se cumple corriendo `npm test` como verificación final del plan; un test individual no puede asegurarlo sin circularidad. El plan documentará "ejecutar `npm test` y verificar 0 fallos" en VERIFICATION.md.

### Claude's Discretion

- Granularidad y orden de plans (¿1 plan por archivo de test? ¿1 plan por área de la matriz? ¿1 plan combinado?): a decidir en `/gsd-plan-phase 13`.
- Mensajes exactos de fallo en los regex de source-hygiene: deben ser autoexplicativos pero el wording lo decide el agente ejecutor siguiendo el patrón existente (ver `test/session-start.test.js:127` "Hardcoded 'Plane' found in non-comment line").
- Estructura de fixtures internos (helpers `makeSession()` con `gsd_mode` en stop.test.js si no existe ya): seguir convenciones del archivo destino.
- Si el helper `gsd-resolver` necesita stubs específicos para los nuevos escenarios dispatcher (`quick + no-match`, `quick + roadmap-missing`): lo decide el agente examinando `makeDeps()` actual en `dispatcher.test.js:532`.

### Folded Todos

None — `gsd-tools todo match-phase 13` devolvió 0 matches.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Especificación de la fase
- `.planning/ROADMAP.md` §"Phase 13: Test Coverage Matrix" — goal + success criteria 1-5 (originales) + criteria 6-8 (ampliados por D-04..D-07 de este CONTEXT)
- `.planning/REQUIREMENTS.md` §"v0.4 Requirements" QUICK-08 — spec a alto nivel; el detalle de la matriz vive en ROADMAP
- `.planning/PROJECT.md` §"Current Milestone: v0.4 GSD Quick Mode" — motivación
- `.planning/STATE.md` §"Accumulated Context" — decisions carry-forward de Phase 11 + Phase 12

### Decisiones de Phase 11 + Phase 12 que Phase 13 testea
- `.planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md` §"Implementation Decisions":
  - D-01/D-02: `skipPerms` derivado de `getGsdMode(kodoFlags) !== null` — testeado por D-12 de este CONTEXT
  - D-03/D-04: `gsd_mode` siempre persistido con valor explícito cuando `gsd:true` — testeado por extensión del describe `'GSD flag propagation'`
  - D-08: legacy `gsd:true` sin `gsd_mode` == `'full'` — testeado por D-04 de este CONTEXT (`getSessionMode` case b)
  - D-09/D-10: `getSessionMode(session)` aislado, testeable — Phase 13 es el primer consumer del helper en tests
- `.planning/phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md` §"Implementation Decisions":
  - D-04: escape de comillas (`title.replace(/"/g, "'")`) en branch quick de `buildGsdContext` — assertion concreta
  - D-06: `if (mode === 'quick') { … } else if (session.phase_id) { … } else { … }` — orden del switch a verificar (quick gana sobre phase_id residual)
  - D-07/D-08: switch exhaustivo en `buildStopNudgeText` con 3 cases — testeado por D-05 de este CONTEXT
  - D-11/D-12/D-13: gsdTag computation con prioridad mode-first inline en `buildContextSummary` — testeado por D-06 de este CONTEXT
  - <deferred> §"A Phase 13" — lista exhaustiva de test ideas concretas que Phase 13 implementa

### Convenciones de testing
- `.planning/codebase/TESTING.md` — runner `node:test`, asserts `node:assert/strict`, ubicación `test/*.test.js`, sin mocks de módulos (DI), tests aislados por `beforeEach`, no fixtures globales

### Código productivo a testear (no se modifica)
- `src/labels.js` `parseKodoLabels`, `getGsdMode`, `getSessionMode` — exportados, helpers puros
- `src/session/manager.js:43` `buildSessionFromTask` — persiste `gsd: true` y `gsd_mode`
- `src/session/manager.js:262` `buildClaudeCommand` — deriva `skipPerms` de `getGsdMode`
- `src/triggers/dispatcher.js:147+` — resolver branches: `phase` (descarta `phase_id` en quick), `error code:'no-match'` (tolerated en quick, fail-closed en full), `error code:'roadmap-missing'` (fail-closed en ambos)
- `src/hooks/session-start.js:82` `buildGsdContext` — branch quick: `/gsd-quick "<safe-title>"`, brief FIRST si existe, header común `# kodo TASK-X — GSD Mode`
- `src/hooks/stop.js:39` `buildStopNudgeText` — switch exhaustivo `quick` / `full` / `default`
- `src/orchestrator/launch.js:122` `buildContextSummary` — gsdTag mode-first

### Archivos de test a extender (existen)
- `test/labels.test.js` (67 líneas hoy) — añadir `describe` para `getGsdMode` y `getSessionMode` (4 estados c/u)
- `test/manager.test.js` (330 líneas hoy) — extender `describe('GSD flag propagation (D-12)')` con `gsd_mode` cases + extender `describe('manager.js source hygiene')` con regex `gsd_mode` (D-12)
- `test/dispatcher.test.js` (638 líneas hoy) — extender `describe('Phase 9 resolver integration')` o añadir `describe('QUICK-08 — quick mode resolver tolerance')`
- `test/session-start.test.js` (185 líneas hoy) — añadir `describe('QUICK-08 — quick mode buildGsdContext')`
- `test/stop.test.js` — añadir `describe('QUICK-08 — buildStopNudgeText switch')`
- `test/orchestrator-gsd.test.js` — añadir `describe('QUICK-08 — buildContextSummary gsdTag')` o ubicación equivalente

### Commits de referencia
- Phase 11 (commits del milestone v0.4): persistencia de `gsd_mode`, helper `getSessionMode`, telemetría dispatcher con `mode`
- Phase 12 (commits del milestone v0.4): `buildGsdContext` quick branch, `buildStopNudgeText` switch, `buildContextSummary` gsdTag
- `004995c` (v0.3): contrato `kodo:gsd` implica skip-permissions — Phase 13 testea su extensión a `kodo:gsd-quick`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Patrón behavior + source-hygiene dual** ya probado en `test/manager.test.js`:
  - Behavior: `describe('GSD flag propagation (D-12)')` con `assert.equal(session.gsd, true)` (líneas 83-118)
  - Source-hygiene: `describe('manager.js source hygiene')` con regex sobre el archivo (líneas 271-322). Phase 13 replica el patrón en session-start, stop, launch.
- **`makeTask()` factory** en `test/manager.test.js` y similares — patrón establecido para fixtures inline. Los nuevos tests pueden definir `makeSession({gsd_mode: 'quick'})` con spread sobre defaults.
- **`makeDeps()` con `_inspect()`** en `test/dispatcher.test.js:532` — patrón DI ya establecido para resolver branches. Phase 13 reusa para los 3 nuevos casos: `quick+no-match` (info log + continúa), `quick+roadmap-missing` (fail-closed), `quick+match` (descarta phase_id).
- **`buildSessionContext` invariants pattern** en `test/session-start.test.js:99` — `describe('… source invariants')` con `readFileSync` + regex sobre el source. Phase 13 replica para D-09/D-10 (anti-inline `|| 'full'`, anti-acceso directo a `gsd_mode`).

### Established Patterns
- **"Test 1:" / "Phase 9:" / "QUICK-08:" prefix naming** — convención de trazabilidad ya viva. D-14 sigue el patrón.
- **"describe semánticos por feature/D-XX, no por requisito"** — en general, los describes nombran un comportamiento (`GSD flag propagation`), no un requisito. Phase 13 introduce un híbrido (`describe('QUICK-08 — ...')` por archivo) por cohesión por fase, manteniendo extensiones en describes existentes cuando aplica (D-13).
- **"Sin mocks de módulos (DI puro)"** — todos los tests existentes inyectan dependencias por parámetro o factory. Phase 13 sigue el patrón en dispatcher (verdict, deps).
- **"Tests aislados por beforeEach"** — sin estado global compartido. Phase 13 sigue.
- **"Inline JSDoc + @ts-check en tests"** — algunos archivos tienen `// @ts-check` (session-start.test.js); Phase 13 lo preserva donde existe.

### Integration Points
- **`test/labels.test.js` → `src/labels.js`**: import existente solo de `parseKodoLabels`. Phase 13 amplía con `getGsdMode` y `getSessionMode`.
- **`test/manager.test.js` → `src/session/manager.js`**: ya importa `buildSessionFromTask` lazy en `beforeEach`. Phase 13 no añade imports nuevos productivos; los nuevos tests usan los mismos.
- **`test/dispatcher.test.js` → `src/triggers/dispatcher.js`**: import lazy via `await import(...)` para mockear deps. Phase 13 reusa.
- **`test/session-start.test.js` → `src/hooks/session-start.js`**: import existente de `buildSessionContext` y `buildGsdContext` (firma `(session, opts={})` Phase 9 D-09). Phase 13 reusa.
- **`test/stop.test.js` → `src/hooks/stop.js`**: ya existe (verificado en `ls test/`). Phase 13 extiende.
- **`test/orchestrator-gsd.test.js` → `src/orchestrator/launch.js` / `prompt.md`**: ya existe (verificado). Phase 13 extiende con tests de gsdTag.

</code_context>

<specifics>
## Specific Ideas

- En el case `'quick'` del switch en stop.js (D-05), el assertion debe verificar **idioma ES** (per D-08 Phase 12) y la presencia de `\\n` final (per <specifics> Phase 12). El nudge tiene forma esperada: `"La sesión TASK-X (summary) ha terminado y está en Review. Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n"`. Test puede usar `assert.match(nudge, /sin VERIFICATION\.md/)` y `assert.ok(!nudge.includes('kodo gsd verify'))`.
- El test de escape de comillas en `buildGsdContext` (Phase 12 D-04) usa fixture `summary: 'TASK-X "with quotes"'` y assert `context.includes('/gsd-quick "TASK-X \'with quotes\'"')`. Sólo en branch quick — phase_id branches no inyectan título.
- Para `buildContextSummary` defensivo (Phase 12 D-11), incluir el caso edge: sesión con `gsd:true, gsd_mode:'quick', phase_id:'9'` (residual). Assert `tag === '[GSD quick]'` (no `[GSD phase 9]`). Documenta el invariante "mode wins over phase_id" en comentario del test.
- El regex anti-acceso directo a `gsd_mode` (D-10) tiene una excepción documentada en su mensaje de fallo: "Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js:84)."
- En `test/dispatcher.test.js`, el caso `quick + no-match` (Phase 11 D-06) requiere assert que el dispatcher emite `gsd.phase.resolved` con `{matched: false, code: 'no-match', tolerated: true, mode: 'quick'}` a nivel `info`. Si la suite no captura emits hoy, el plan puede añadir un `logFn` mock al `makeDeps()` o assert sobre el side-effect downstream (sesión arranca igual, `launchCalledWith.phase_id === undefined`).
- En `test/dispatcher.test.js`, `quick + match` debe assert que `launchCalledWith.phase_id === undefined` (descarta phase_id) **y** que el log `gsd.phase.resolved` lleva `mode: 'quick'` con `phase_id` y `match_heading` presentes (forense útil per Phase 11 D-05).
- Source-hygiene tests (D-09, D-10, D-11, D-12) viven en bloques separados `describe('… source hygiene')` por archivo, no mezclados con behavior. Mantiene la separación visual del patrón manager.test.js.

</specifics>

<deferred>
## Deferred Ideas

### A futuras milestones (v0.5+)
- Tests E2E de `kodo logs --session-of <task-id>` para sesiones quick verificando que la cadena `state.json → head-line scan` funciona con `gsd_mode:'quick'` persistido. Hoy: deuda LOG-09 + Phase 7 UATs pendientes (PROJECT.md Active section).
- Snapshot tests del prompt orchestrator renderizado (`resolvePromptTemplate` con sesión quick) — útiles cuando v0.5+ añada nuevos placeholders. Hoy YAGNI.
- Helper `LABEL_SCENARIOS` exportado desde `test/helpers/` — si v0.5 introduce un quinto modo (`kodo:gsd-research`?), la matriz crece y la indirección se justifica. Hoy: YAGNI por D-02.
- Coverage report (c8/nyc) integrado al CI — TESTING.md lo lista como missing infrastructure. Útil para validar que QUICK-08 no deja líneas no cubiertas pero hoy no es bloqueante.

### Out of Scope (REQUIREMENTS)
- Migración programática de sesiones legacy en `state.json` — la regla "ausente == full" (Phase 11 D-08, testeada por D-04 de este CONTEXT) cubre la lectura sin reescribir.
- Tests del slash command `/gsd-quick` — vive en `~/.claude/skills/`, no en este repo.
- Nuevos eventos NDJSON específicos para quick — Phase 11 D-05/D-07 ya añadió campo `mode` a los 8 tipos existentes; tests del campo `mode` ya cubiertos en `test/logger-events.test.js` (carry-forward Phase 11).

### Reviewed Todos
None — `gsd-tools todo match-phase 13` devolvió 0 matches.

</deferred>

---

*Phase: 13-test-coverage-matrix*
*Context gathered: 2026-04-29*
