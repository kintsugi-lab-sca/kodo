# Phase 22: Tech Debt v0.5 Closure — Research

**Researched:** 2026-05-13
**Domain:** Cleanup-only — source hygiene, test defensivos, comentarios cita-por-contenido. NO behavior change.
**Confidence:** HIGH (todo verificado por `Read` directo de archivos en commit actual).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** 3 plans agrupados por phase-of-origin (22-01 Phase 14 closure, 22-02 Phase 15 closure, 22-03 Phase 16 closure), independientes y paralelos en Wave 1.
- **D-02:** Cada DEBT/WR/IN = 1 task discreta (~10-30 LOC, commit atómico, revert quirúrgico).
- **D-02b:** Excepción: IN-03 + IN-04 Phase 16 agrupados en 1 task de "comentarios obsoletos" (mismos archivos verify.js/stop.js).
- **D-03 / D-03b / D-03c:** SECURITY.md Phase 14 con frontmatter `threats_open: 0`, plantilla Phase 19/15, ubicación `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md`.
- **D-04:** Tests defensivos donde haya behavior change (DEBT-02 timeout, DEBT-03 regex + FORCE_COLOR='', WR-04 `from`, WR-05 order pre-throw, IN-02 payload shape).
- **D-04b:** Refactors puros (WR-01/03/06/08) NO requieren tests nuevos.
- **D-05 / D-05b / D-05c / D-05d / D-05e:** Retirar `ANSI_RESET` + `COLOR_BY_LEVEL` exports, eliminar tests asociados, mover constantes internas si solo `COLOR_BY_LEVEL` las consume, añadir guard a `format-isolation.test.js`, actualizar comentario en `src/cli/format.js`.
- **D-06 / D-06b:** Fixes independientes paralelos por archivo, agrupar tasks por archivo cuando comparten surface (stop.js, verify.js, dispatcher.js).
- **D-07 / D-07b:** Comentarios cita por CONTENIDO/símbolo, no por línea (convención para futuras phases).
- **D-08:** Phase 16 tasks agrupadas por archivo: stop.js (WR-01+WR-02+WR-07+IN-04 [+IN-01 doc]), verify.js (WR-03+IN-03), dispatcher.js (WR-06+IN-02), 3 archivos de test individuales (WR-04, WR-05, WR-08).
- **D-09:** Criterios de cierre por DEBT — commit cita el ID, tests pasan, suite global verde, grep negativo para DEBT-04, SECURITY.md presente para DEBT-01.

### Claude's Discretion

- Bytes exactos del SECURITY.md prosa (D-03b).
- Reordering de tasks dentro de cada plan (D-06).
- Decisión de mover `ANSI_GRAY/CYAN/YELLOW/RED` constantes locales si solo `COLOR_BY_LEVEL` las consume (D-05c).
- Borrar o ajustar `test/logger-exports.test.js` (D-05b).
- Si IN-01 Phase 16 amerita refactor de `runStopHook` o solo documentación inline (D-02b heurística).
- Comentario exacto reemplazado en `src/cli/format.js:101` (D-05e).

### Deferred Ideas (OUT OF SCOPE)

- Refactor mayor de `runStopHook` para inyectar `releaseGsdLock`/`handleOrchestratorStop` (IN-01 Phase 16) — solo documentar.
- 5 IN restantes de Phase 15 (WR-01 TRANSIENT_PATTERNS, WR-02 formatLine instancia, IN-02 raw ANSI writeNdjson, IN-03 dos formatters runCheck, IN-04 comentario lazy, IN-05 gsd inspect exit 0).
- WR-04/05/06 Phase 21 follow-up advisory — defer a v0.7+.
- Tests E2E reales contra Plane para WR-04/05.
- Audit retrospectivo SECURITY.md para Phases 15-21 (ya generadas vía `/gsd-secure-phase`).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEBT-01 | `SECURITY.md` para Phase 14 con `threats_open: 0` auditado (low-risk presentation-only). | Plantilla Phase 15/16 SECURITY.md ya existe — ver §Phase 19 SECURITY.md Template (resuelto a Phase 15 SECURITY.md por shape equivalente). |
| DEBT-02 | `test/version-smoke.test.js` recibe `timeout` explícito en `spawnSync` (WR-01 Phase 14). | Verificado: `test/version-smoke.test.js:18-22` NO tiene `timeout`. |
| DEBT-03 | Regex ANSI defensiva (IN-01) + test `FORCE_COLOR=''` (IN-02). | Verificado: `src/cli/format.js:57` regex single-param; `test/format.test.js:16-47` casos 1-7 sin caso `FORCE_COLOR=''`. |
| DEBT-04 | Retirar `ANSI_*` exports de `src/logger.js`; grep cross-repo 0 consumers. | Verificado: solo 1 sitio en `src/` cita `COLOR_BY_LEVEL` (comentario en `src/cli/format.js:101,159`). 0 imports en `src/`. |
| DEBT-05 | 8 WR Phase 16 cerrados. | Verificado línea-por-línea en stop.js, verify.js, dispatcher.js, 3 tests. |
| DEBT-06 | 4 IN Phase 16 resueltos. | Verificado: IN-01 stop.js refactor light DI, IN-02 dispatcher.js payload, IN-03 verify.js comment (resuelto parcial en CR-01), IN-04 stop.js comment. |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| SECURITY.md generation (DEBT-01) | Docs / `.planning/` | — | Threat register, no código de runtime. |
| Test defensivos (DEBT-02/03 + WR-04/05 + IN-02) | Test layer | — | Solo `test/*.test.js` se modifica. |
| Source hygiene (DEBT-04 ANSI_* retiro, WR-01/03/06/08) | Module-internal cleanup | — | No cruza tier boundaries; sin cambio de signature pública. |
| Comentarios cita-por-contenido (IN-03/IN-04) | Inline docs | — | Texto JSDoc sin behavior. |
| Tests defensivos behavior-change (WR-04 `from`, WR-05 spy order) | Test layer | Test asserts | Extiende cobertura sin tocar src/. |

## Research Summary

Phase 22 cierra deuda v0.5 acumulada: 6 DEBT requirements expandidos a 13 fix targets concretos. Investigación verifica línea-por-línea cada sitio contra el código actual del repo (no usa training data — todo es grep+Read directo).

**Estado verificado (HIGH confidence):**

- `src/logger.js` líneas 42-53: `ANSI_RESET` exportada + `ANSI_GRAY/CYAN/YELLOW/RED` privadas + `COLOR_BY_LEVEL` exportada. **`ANSI_RED`+`ANSI_RESET` SÍ se usan en `writeNdjson` línea 312** — NO se pueden retirar; solo `COLOR_BY_LEVEL` y sus referencias muertas (ANSI_GRAY/CYAN/YELLOW) son candidatos a eliminación.
- `src/cli/format.js:57` regex `/\x1b\[\d+m/g` cubre solo single-param.
- `test/version-smoke.test.js:18-22` `spawnSync` sin `timeout`.
- `test/format.test.js:16-47` cubre 7 casos `_resolveUseColor`, falta `FORCE_COLOR=''`.
- `src/hooks/stop.js`: actualizado vs Phase 16 REVIEW por intervención de Phase 19 CR-02 — varios WR Phase 16 ya parcial o totalmente resueltos. Detalles por item abajo.
- `src/gsd/verify.js`: WR-03 logger threading sigue presente (línea 110); IN-03 (comentario "header line 26") YA fue reemplazado por contenido en Phase 16 CR-01 fix (verify.js líneas 251-266).
- `src/triggers/dispatcher.js:13` eager `EVENTS` + `:307` dynamic `gsdPhaseResolved/gsdBootstrap`. WR-06 sigue vigente.
- `test/dispatcher-isolation.test.js:24-30` `stripComments` limita a líneas full-comment.

**Sorpresa relevante:** parte del scope Phase 22 ya fue resuelto colateralmente en Phase 19 (CR-02 + WR-01..WR-08 fixes). Específicamente: **WR-01 (doble logger creation), WR-02 (catch-todo), WR-07 (catch logger fail vs lookup), IN-04 (comentario "line 116")** — verificar abajo cuáles persisten realmente.

**Primary recommendation:** El planner debe re-validar `src/hooks/stop.js` y `src/gsd/verify.js` ANTES de planear tasks de Phase 16 closure — Phase 19 ya resolvió varios WR como colateral. Plan 22-03 puede quedar más liviano de lo asumido por CONTEXT.md.

## Per-Item Current State

### DEBT-01 — `SECURITY.md` Phase 14 (1 fix)

| Sitio | Estado actual | Acción |
|-------|---------------|--------|
| `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` | **EXISTE** (verificado por `find`). Pero CONTEXT.md asume que no existe. Ver §Risks. | Verificar contenido antes de re-crear; si ya cumple `threats_open: 0`, marcar DEBT-01 como satisfied-by-discovery. |

**Plantilla disponible:** `.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-SECURITY.md` — shape exacto: frontmatter `phase`/`slug`/`status: verified`/`threats_open: 0`/`asvs_level: 1`/`created`. Prosa: presentation-only, no trust boundaries nuevas. Reusable verbatim sustituyendo `phase: 15` → `phase: 14`, fecha y prosa específica de Phase 14 (picocolors install + visibleWidth/formatRow surface).

### DEBT-02 — `test/version-smoke.test.js` timeout (1 fix, WR-01 Phase 14)

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `test/version-smoke.test.js:18-22` | `const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {\n  cwd: REPO,\n  encoding: 'utf-8',\n  // No env override — we want to test the install in its real shape.\n});` | Añadir `timeout: 10_000` después de `encoding`. Sin más cambios. |

**Test defensivo (D-04):** assert wall-clock <6s opcional (CONTEXT.md menciona 6s, REVIEW menciona 10s — discrepancia menor; recomendado seguir REVIEW value `10_000`).

### DEBT-03 — `src/cli/format.js` regex + test (2 fixes Phase 14)

#### IN-01 — `visibleWidth` regex single-param

| Sitio | Texto actual (línea 57) | Acción |
|-------|-------------------------|--------|
| `src/cli/format.js:56-58` | `export function visibleWidth(s) {\n  return String(s).replace(/\\x1b\\[\\d+m/g, '').length;\n}` | Reemplazar regex por `/\\x1b\\[[\\d;]*[A-Za-z]/g` (CSI general). |

#### IN-02 — Test `FORCE_COLOR=''` en `_resolveUseColor`

| Sitio | Estado actual | Acción |
|-------|---------------|--------|
| `test/format.test.js:16-47` (suite `_resolveUseColor precedence (D-02)`) | 7 casos cubiertos (TTY+defaults, NO_COLOR='1', FORCE_COLOR='1' override, NO_COLOR>FORCE_COLOR, FORCE_COLOR='0' disable, NO_COLOR=''). FALTA: `FORCE_COLOR=''` (cadena vacía, FORCE_COLOR=null implícito → `!== '0'` = true). | Añadir caso 8: `it("case 8: TTY=false + FORCE_COLOR='' => true (any non-'0' value forces)", () => { assert.equal(_resolveUseColor({ isTTY: false }, { FORCE_COLOR: '' }), true); });`. Verifica el contrato documentado en `src/cli/format.js:44` (`FORCE_COLOR != null && FORCE_COLOR !== '0'`). |

### DEBT-04 — Retirar `ANSI_*` + `COLOR_BY_LEVEL` exports (1 surface, ~5 sitios linked) — Phase 15 IN-01

#### `src/logger.js` exports actuales (líneas 41-53)

```js
// Línea 42 — EXPORTED (consumido internamente línea 312)
export const ANSI_RESET = '\x1b[0m';
// Líneas 43-46 — PRIVATE (consumidas SOLO por COLOR_BY_LEVEL)
const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';  // ALSO consumido línea 312
// Líneas 48-53 — EXPORTED (sin consumidores externos en src/)
export const COLOR_BY_LEVEL = Object.freeze({
  debug: ANSI_GRAY,
  info: ANSI_CYAN,
  warn: ANSI_YELLOW,
  error: ANSI_RED,
});
```

#### Uso interno (NO se puede retirar)

- `src/logger.js:312` — `process.stderr.write(\`${ANSI_RED}[kodo:logger] write failed: ${msg}${ANSI_RESET}\n\`);` — esto preserva el raw ANSI por defense-in-depth (writeNdjson error path; ver Phase 15 IN-02 deferred).

#### Estrategia D-05c (line-level)

1. **Mantener:** `ANSI_RESET` + `ANSI_RED` como `const` privadas (NO exportadas) — siguen siendo necesarias para línea 312.
2. **Retirar export de `ANSI_RESET`:** cambiar `export const ANSI_RESET` → `const ANSI_RESET` línea 42.
3. **Eliminar:** `ANSI_GRAY`/`ANSI_CYAN`/`ANSI_YELLOW` (líneas 43-45) — no se referencian fuera de `COLOR_BY_LEVEL`.
4. **Eliminar:** `COLOR_BY_LEVEL` entero (líneas 48-53).

**Resultado neto líneas 41-53:**

```js
// ANSI escape codes (mismas convenciones que src/check.js).
const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
```

#### Comentario en `src/cli/format.js:101` (D-05e)

Línea actual: `*   - Level chips: debug/info/warn/error (mapeo idéntico a logger.js COLOR_BY_LEVEL).`

Acción: reemplazar por: `*   - Level chips: debug/info/warn/error (mapeo equivalente al logger NDJSON pre-Phase-15, ya no expuesto).`

#### Comentario en `src/cli/format.js:159`

Línea actual: `    // Level chips (D-03, mapping mirrors src/logger.js:37 COLOR_BY_LEVEL).`

Acción: reemplazar por: `    // Level chips (D-03, mapping mirrors el mapeo interno legacy del logger NDJSON pre-Phase-15).`

#### `test/logger-exports.test.js` (D-05b)

- **Líneas 12-15:** `it('exports ANSI_RESET as a string', () => {...})` → ELIMINAR (export retirado).
- **Líneas 17-24:** `it('exports COLOR_BY_LEVEL frozen map with 4 levels', () => {...})` → ELIMINAR (export retirado).
- **Líneas 26-38:** `it('exports formatLine(record, { useColor }) as pure function', ...)` → MANTENER (formatLine sigue exportado).
- **Líneas 40-58:** `it('formatLine with useColor=true wraps level with ANSI codes ...)` → AJUSTAR — assertion línea 57 (`assert.equal(typeof mod.ANSI_RESET, 'string')`) debe eliminarse, el resto sigue válido.
- **Líneas 60-69:** `it('formatLine omits component when record has no component field', ...)` → MANTENER.
- **Top del archivo (línea 11) describe string:** cambiar `'LOG-05/06/07 exports: formatLine + COLOR_BY_LEVEL + ANSI_RESET'` → `'LOG-05/06/07 exports: formatLine'` (refleja el surface restante).

#### Guard nuevo en `test/format-isolation.test.js` (D-05d)

Añadir un nuevo `describe` que asserta: `src/logger.js` source NO contiene `export const ANSI_` ni `export const COLOR_BY_LEVEL`. Patrón:

```js
describe('DEBT-04 source-hygiene: ANSI exports retired (Phase 15 IN-01)', () => {
  it('src/logger.js no exporta ANSI_RESET ni COLOR_BY_LEVEL (Phase 15 IN-01 closed)', () => {
    const src = readFileSync(join(SRC, 'logger.js'), 'utf-8');
    assert.equal(/export\s+const\s+ANSI_/m.test(src), false);
    assert.equal(/export\s+const\s+COLOR_BY_LEVEL/m.test(src), false);
  });
});
```

### DEBT-05 — Phase 16 WR-01..WR-08 (8 fixes, agrupados por D-08 en 6 tasks)

#### WR-01 — `src/hooks/stop.js` doble creación de logger

**Estado:** **YA RESUELTO** por Phase 19. Verificado en stop.js: solo 1 logger se crea en líneas 159-167 (`const log = ...`) y se reusa en `markSessionStatus` (línea 171) y `sessionEnd` (línea 183). **No hay doble creación.**

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `src/hooks/stop.js:159-167` | `const log = (deps && deps.loggerFactory) ? deps.loggerFactory({...}) : await (async () => { ... createLogger(...) ... }).child(...);` | **NO-OP** — verificar y marcar como satisfied-by-Phase-19. |

**Nota:** hay un SEGUNDO bloque de creación en líneas 220-228 (`cleanupLog` para worktree cleanup) que SÍ es una segunda creación. Esto NO está en el scope de WR-01 (es path Phase 19 worktree, no del sessionEnd/markSessionStatus path). Decisión: dejar como out-of-scope (introducido por Phase 19, no por Phase 16) — el planner puede capturarlo en un comentario sin commit nuevo.

#### WR-02 — `src/hooks/stop.js` catch-todo silencia errores en `markSessionStatus`

**Estado:** **YA RESUELTO** por Phase 19. Verificado:

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `src/hooks/stop.js:172-176` | `} catch (err) {\n  // WR-03: state.json mutation failure merits explicit diagnostic (NOT silent).\n  // Still fail-open — runStopHook never crashes Claude Code.\n  console.error(\`[kodo:stop] markSessionStatus failed: ${err.message}\`);\n}` | **NO-OP** — Phase 19 ya añadió `console.error` con diagnóstico explícito. WR-02 closed. |

#### WR-03 — `src/gsd/verify.js` triple child binding

**Estado:** sigue pendiente. Verificado:

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `src/gsd/verify.js:91-97` | Default `loggerFactory` retorna `createLogger({...}).child({ component: 'gsd' })`. | Triplication es: línea 110 `.child({ task_id })` + línea 267 `markSessionStatus → manager.js#child({component: 'session', task_id})`. **NO-OP en runtime** (es source-hygiene puro); **acción:** extender el memSink en `test/gsd-verify-integration.test.js:73-83` para capturar `bindings` stack (D-04b dice "refactors puros no requieren tests nuevos" pero CONTEXT.md no clasifica explícitamente WR-03 — heurística: si solo extiende cobertura del test sin modificar runtime, sí cae en D-04 defensivo). Verificar con planner: si la cobertura ya existe por integración real, NO-OP. |

**Recomendación al planner:** WR-03 es subtle — la lógica runtime es correcta (binding merge ocurre por contrato pino-like), el gap es de test coverage del binding stack. Si el merge se valida indirectamente por `from` correcto en `state.transition` de los 3 tests Phase 16, podría marcarse como satisfied-by-existing-tests.

#### WR-04 — `test/stop-state-transition.test.js` Test 4 D-04 invariante

**Estado:** sigue pendiente. Verificado:

| Líneas | Texto actual | Acción |
|--------|--------------|--------|
| `test/stop-state-transition.test.js:331-334` (Test "D-04 invariante MANDATORY") | Solo verifica `transition.fields.to === 'done'`. NO verifica `from`. | Añadir DENTRO del loop `for (const session of [fullSession, quickSession])`: `const expectedFrom = session.gsd_mode === 'full' ? 'review' : 'running'; assert.equal(transition.fields.from, expectedFrom, \`D-04 invariant: from debe ser ${expectedFrom} para modo ${session.gsd_mode}\`);` |

**Nota:** Tests 1 y 2 (líneas 154-240) YA verifican `from='review'` y `from='running'` respectivamente. Test 4 los duplica para el invariante general — el assert nuevo cierra el gap.

#### WR-05 — `test/gsd-verify-integration.test.js` T27 order pre-throw

**Estado:** sigue pendiente con caveat. Verificado:

| Líneas | Texto actual | Acción |
|--------|--------------|--------|
| `test/gsd-verify-integration.test.js:364-412` (Test "T27 SC#3 LOG-14: pass + updateTaskState fails → NO state.transition emitted") | Aserción `transition === undefined`. Cubre order PARCIAL: cubre el caso "alguien mueve markSessionStatus DESPUÉS del try". NO cubre "alguien borra markSessionStatus por accidente" — pero T20 (líneas no leídas) sí cubre presence. | Caveat: hace falta DI de `markSessionStatus` en `verify.js` para spy explícito, lo que cambia signature pública. CONTEXT.md D-04b dice "refactors puros no requieren tests nuevos" — pero WR-05 SÍ cambia behavior (test defensivo). **Recomendación práctica:** añadir comentario JSDoc en T27 aclarando "test cubre order, no presence — T20 cubre presence". El planner debe decidir: spy real (cambio API) vs. comment claration. Heurística: spy explícito requiere modificar `runGsdVerify` deps shape → out of D-04 scope. Mejor opción: comment claration. |

#### WR-06 — `src/triggers/dispatcher.js` doble import logger-events

**Estado:** sigue pendiente. Verificado:

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `src/triggers/dispatcher.js:13` | `import { EVENTS } from '../logger-events.js';` (eager) | Reemplazar por: `import { EVENTS, gsdPhaseResolved, gsdBootstrap } from '../logger-events.js';` |
| `src/triggers/dispatcher.js:307` | `const { gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js');` (dynamic) | ELIMINAR esa línea — los helpers ya quedan en scope por import eager. |

**Caveat dynamic import `createLogger`:** las líneas 254, 281, 306 invocan `await import('../logger.js')` para `createLogger`. ESTO NO se cambia — es deliberado (LOG-12 invariant: dispatcher carga logger.js solo en runtime, no en module-load).

#### WR-07 — `src/hooks/stop.js` catch no distingue logger fail vs lookup not found

**Estado:** vigente pero el sitio CAMBIÓ por Phase 19. Verificado:

| Línea | Texto actual | Acción |
|-------|--------------|--------|
| `src/hooks/stop.js:169-176` | `try { const { markSessionStatus } = await import('../session/manager.js'); markSessionStatus(session.task_id, 'done', 'session-stop', log); } catch (err) { console.error(\`[kodo:stop] markSessionStatus failed: ${err.message}\`); }` | El runtime real está en `src/session/manager.js#markSessionStatus` (no leído en este pase, CONTEXT.md cita: si `listSessions().find` no encuentra session, `current.status` cae a `'unknown'` y `state.transition` emite con `from: 'unknown'` aunque NO haya mutación). **Fix correcto:** modificar `manager.js#markSessionStatus` para `if (!current) { logger.warn('state.transition.skipped', {...}); return; }`. El sitio de stop.js NO se toca — el bug está en manager.js. CONTEXT.md D-02b D-08 NO menciona manager.js en el agrupamiento por archivo — esto puede ser fricción. |

**Recomendación planner:** WR-07 fix vive en `src/session/manager.js`, no en `src/hooks/stop.js`. Anotar en plan 22-03 como task adicional o como sub-fix dentro de la task stop.js (Karpathy regla 3: cambio quirúrgico — añadir `if (!current) return early` en manager.js es ~5 LOC).

#### WR-08 — `test/dispatcher-isolation.test.js` `stripComments` inline

**Estado:** sigue pendiente. Verificado:

| Líneas | Texto actual | Acción |
|--------|--------------|--------|
| `test/dispatcher-isolation.test.js:24-30` | `function stripComments(src) { return src.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').split('\\n').filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*')).join('\\n'); }` | Mejor opción (D-04b refactor puro): ajustar JSDoc del helper (líneas 13-22) para documentar limitación: `// NOTE: inline comments at end of code lines are NOT stripped — if you mention 'gsd.phase.resolved' in an inline comment, the test will fail. This is intentional.` Mantener implementación. Sin cambio runtime. |

### DEBT-06 — Phase 16 IN-01..IN-04 (4 fixes)

#### IN-01 — `src/hooks/stop.js` runStopHook no inyecta releaseGsdLock/handleOrchestratorStop

**Estado:** **OUT OF SCOPE (D-02b deferred)** — CONTEXT.md decide documentar como JSDoc explicando "dynamic import for lazy DI", no refactorizar signature.

| Sitio | Texto actual | Acción |
|-------|--------------|--------|
| `src/hooks/stop.js:71-97` (JSDoc de `runStopHook`) | Lista `findSessionFn`, `removeSessionFn`, `cmux`, `loggerFactory`, `gitFn` como deps. NO menciona `releaseGsdLock`/`handleOrchestratorStop`. | Añadir párrafo en JSDoc: "Note: `releaseGsdLock` y `handleOrchestratorStop` se importan dinámicamente (líneas 198, 125) por defecto y NO son inyectables. Patrón: lazy DI — la carga del módulo se difiere hasta el call-time del hook para evitar tocar gsd/lock.js en el module-load path. Refactor a DI requiere modificar la signature (breaking change para tests Phase 16 LOG-13/14/15) y se difiere a v0.7+." |

#### IN-02 — `src/triggers/dispatcher.js` test payload shape EVENTS.*

**Estado:** sigue pendiente. Verificado:

| Sitio | Estado actual | Acción |
|-------|---------------|--------|
| `test/dispatcher-isolation.test.js` | Solo afirma absence de literales + presence del import (líneas 32-63). NO valida shape del payload runtime. | Añadir test nuevo (en `dispatcher.test.js` o como suite añadida a `dispatcher-isolation.test.js`) que captura el payload del log helper en las 4 ramas (matched-true phase, matched-true bootstrap, matched-false no-match tolerated, matched-false fail-closed). Assert canonical keys: `event`, `matched`, `phase_id`/`error_code`/`code`, `mode`, `task_ref`. Sin acoplar order. |

**Recomendación planner:** Si `test/dispatcher.test.js` (no leído en este pase) ya tiene tests para los 4 callsites, IN-02 puede ser satisfied-by-existing. Investigar antes de añadir tests nuevos.

#### IN-03 — `src/gsd/verify.js` comentario "header line 26"

**Estado:** **YA RESUELTO** por Phase 16 CR-01 fix. Verificado:

| Líneas | Texto actual | Acción |
|--------|--------------|--------|
| `src/gsd/verify.js:249-265` | Comentario actual cita: "El reason 'gate-passed' espeja el verdict legacy mapping documentado en la cabecera de este archivo (sección \"Legacy verdict mapping\": pass + side-effects OK → 'approved', reason 'gate-passed')". **NO cita "line 26"** — Phase 16 Resolution Log nota que CR-01 fix resolvió esto como colateral. | **NO-OP** — verificar y marcar como satisfied-by-CR-01. |

#### IN-04 — `src/hooks/stop.js` comentario "line 116"

**Estado:** **YA RESUELTO** por Phase 19 refactor. Verificado:

| Líneas | Texto actual | Acción |
|--------|--------------|--------|
| `src/hooks/stop.js:152-158, 178-181, 193-195` | Comentarios actuales NO contienen "line 116" — citan "session.end pattern" por contenido. Los antiguos comentarios D-08/D-09 que decían "line 116" desaparecieron en el refactor Phase 19 (mismas regiones del archivo). | **NO-OP** — verificar grep `grep -n "line 116" src/hooks/stop.js` → 0 matches esperado. Marcar como satisfied-by-Phase-19. |

## External Consumers (DEBT-04 ANSI_* / COLOR_BY_LEVEL grep cross-repo result)

Grep ejecutado: `grep -rn "ANSI_RESET\|ANSI_GRAY\|ANSI_CYAN\|ANSI_YELLOW\|ANSI_RED\|COLOR_BY_LEVEL" src/ test/ bin/`

| Símbolo | Archivo:Línea | Tipo | Decisión Phase 22 |
|---------|---------------|------|--------------------|
| `ANSI_RESET` | `src/logger.js:42` | export const | Mantener `const` privado (consumido línea 312). Retirar `export`. |
| `ANSI_RESET` | `src/logger.js:312` | uso interno | **Mantener** — write failed error path. |
| `ANSI_GRAY` | `src/logger.js:43` | const privado | Eliminar (solo consumido por COLOR_BY_LEVEL). |
| `ANSI_GRAY` | `src/logger.js:49` | uso | Eliminar (COLOR_BY_LEVEL desaparece). |
| `ANSI_CYAN` | `src/logger.js:44, 50` | const + uso | Eliminar. |
| `ANSI_YELLOW` | `src/logger.js:45, 51` | const + uso | Eliminar. |
| `ANSI_RED` | `src/logger.js:46` | const privado | **Mantener** — consumido línea 312. |
| `ANSI_RED` | `src/logger.js:52` | uso COLOR_BY_LEVEL | Eliminar (la línea 52 va al desaparecer COLOR_BY_LEVEL; la línea 312 sigue). |
| `ANSI_RED` | `src/logger.js:312` | uso interno | **Mantener** — write failed error path. |
| `COLOR_BY_LEVEL` | `src/logger.js:48-53` | export const | Eliminar completo. |
| `COLOR_BY_LEVEL` | `src/cli/format.js:101` | comentario JSDoc | Reemplazar texto (D-05e). |
| `COLOR_BY_LEVEL` | `src/cli/format.js:159` | comentario inline | Reemplazar texto. |
| `ANSI_RESET` / `COLOR_BY_LEVEL` | `test/logger-exports.test.js:11-22, 55-57` | tests sobre exports | Eliminar tests (D-05b). |

**0 consumers externos a `src/logger.js`** para `ANSI_RESET` y `COLOR_BY_LEVEL` como import desde otro módulo. Las menciones en `src/cli/format.js` son SOLO en comentarios; las menciones en `test/logger-exports.test.js` son los tests que validan los exports a eliminar. Cero archivos en `bin/` mencionan los símbolos.

**Confidence:** HIGH — grep ejecutado, output verificado.

## Phase 19 SECURITY.md Template (frontmatter shape + prose pattern)

**Hallazgo:** CONTEXT.md cita "Phase 19 SECURITY.md" pero el archivo NO existe en `.planning/phases/19-worktree-cleanup-integration/`. Listado real:

```
.planning/phases/18-worktree-runtime-wiring/18-SECURITY.md     ← existe (Phase 18)
.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md  ← existe (ya creado??)
.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-SECURITY.md      ← existe (PLANTILLA IDEAL)
.planning/milestones/v0.5-phases/16-log-09-debt-cleanup/16-SECURITY.md    ← existe
```

**Plantilla recomendada:** `.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-SECURITY.md` (shape exacto, también es presentation-only sin threats).

### Frontmatter shape

```yaml
---
phase: 14
slug: cli-format-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-13
---
```

CONTEXT.md D-03 propone diferente shape:

```yaml
---
phase: 14
date: 2026-05-13
threats_open: 0
closed_by: phase-22
---
```

**Discrepancia:** ambos válidos. **Recomendación:** seguir Phase 15 SECURITY.md shape para consistencia con artefactos sister Phase 15/16. Añadir campo extra `closed_by: phase-22` propuesto por CONTEXT.md D-03 al final del frontmatter (aditivo, no breaking).

**Resultado fusionado:**

```yaml
---
phase: 14
slug: cli-format-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-13
closed_by: phase-22
---
```

### Prose pattern (de Phase 15 SECURITY.md)

Secciones canonical:

1. **Title + introductory paragraph** — qué hace la fase + por qué es presentation-only.
2. **Trust Boundaries** — tabla. Para Phase 14: 1 fila — `Process → Operator (stdout/stderr)` con cell "TTY output con colores semánticos (D-03), símbolos ✓/✗ (D-03), padding columnar (D-09/D-10), sin nuevos parsers ni input de red".
3. **Threat Register** — tabla con fila única "—" + nota "No threats identified".
4. **Accepted Risks Log** — "No accepted risks."
5. **Security Audit Trail** — tabla con `2026-05-13 | 0 | 0 | 0 | gsd-secure-phase orchestrator (...)`.
6. **Sign-Off** — checklist con 4 items, todos `[x]`.
7. **Cross-references** — bullets a `format-isolation.test.js` (LOG-12 extension), `picocolors` source-review, `_resolveUseColor` env precedence.

**Prose específica para Phase 14 (DEBT-01 D-03b):**

> Phase 14 introduce `src/cli/format.js` como factory de formatters de color para superficies CLI, usando `picocolors` como nueva dependencia de producción. Es **presentation-layer puro**: transforma data ya validada upstream para output TTY (colores semánticos, columnas alineadas, símbolos ✓/✗) sin introducir parsers, deserializers, endpoints, credenciales ni surfaces de input externo. La única dependencia nueva (`picocolors`) ya fue auditada por proxy del invariante `--json` byte-deterministic (DX-06): cuando `useColor=false`, todos los helpers devuelven la string de entrada SIN secuencias ANSI.

## Risks and Unknowns

### R-01 — `14-SECURITY.md` ya existe (HIGH risk de duplicate work)

`find .planning -name "*SECURITY*"` muestra que `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` **YA EXISTE**. CONTEXT.md asume que no. **Acción:** el planner debe leer ese archivo PRIMERO. Si ya cumple `threats_open: 0`, DEBT-01 = satisfied-by-existing. Si tiene contenido stale o incorrecto, sustituir.

### R-02 — WR-01, WR-02, WR-07, IN-03, IN-04 parcial o totalmente resueltos por Phase 19

Phase 19 (CR-02 fix + WR cleanup) relocalizó `markSessionStatus` fuera de `if (session.gsd)`, refactorizó `stop.js` comentarios D-08/D-09 (eliminando referencias "line 116"), y resolvió el doble logger creation. **Acción:** el planner debe re-validar cada WR contra el código actual antes de crear tasks. Estimación post-revalidación: Plan 22-03 podría quedar con ~3-4 tasks reales (no 12 como sugiere D-08 split por archivo).

### R-03 — WR-07 fix vive en `src/session/manager.js`, no en `src/hooks/stop.js`

CONTEXT.md D-08 agrupa WR-07 bajo "stop.js (1 task)" pero el sitio real del fix es `markSessionStatus` en manager.js. **Acción:** el planner debe expandir el agrupamiento a 2 archivos o crear una task adicional. Heurística Karpathy regla 3: ~5 LOC en manager.js, no merece task propia — extender la task "stop.js" para incluir el fix en manager.js o documentar el cross-file edit en el plan.

### R-04 — WR-03 `verify.js` puede ser satisfied-by-existing-tests

El binding stack merge se valida indirectamente por `from='review'`/`from='running'` correcto en `state.transition` (Tests 1-3 de `stop-state-transition.test.js`). **Acción:** investigar si añadir memSink que captura `bindings` aporta cobertura real vs. duplicar lo que ya verifica `from`. Decisión del planner.

### R-05 — Test fixture `transition` field "event" sigue siendo `'state.transition'` literal

`test/stop-state-transition.test.js:190, 232, 278, 331` filtra `events.find((e) => e.fields?.event === 'state.transition')` con string literal. Esto NO es bug — el test verifica el output observable del logger, no la implementación del helper. Si el planner mueve a EVENTS.* en código, los tests pueden seguir con literal (consume contract, no produce). Nota informativa.

### Unknowns

- **U-01:** ¿`test/dispatcher.test.js` (no leído) ya cubre el shape del payload runtime para los 4 callsites EVENTS.*? Si sí, IN-02 = satisfied-by-existing.
- **U-02:** ¿`test/gsd-verify-integration.test.js` T20 (no leído explícitamente, pero referenciado en REVIEW Phase 16) cubre `markSessionStatus` presence en el pass branch? Si sí, WR-05 caveat es válido — solo añadir comentario claration.
- **U-03:** ¿El contenido actual de `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` es válido? Plan debe leer antes de actuar.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in, no external test runner) |
| Config file | none — discovery via `npm test` script in `package.json` |
| Quick run command | `node --test test/<file>.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEBT-01 | SECURITY.md presence + `threats_open: 0` | smoke (file inspection) | `cat .planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md \| head -10` | ⚠ likely exists (verify R-01) |
| DEBT-02 | `spawnSync` con `timeout` no cuelga suite | smoke | `node --test test/version-smoke.test.js` | ✅ |
| DEBT-03 IN-01 | `visibleWidth` cubre `\x1b[33;1m` multi-param | unit | `node --test test/format.test.js` (extender) | ✅ |
| DEBT-03 IN-02 | `_resolveUseColor` con `FORCE_COLOR=''` → true | unit | `node --test test/format.test.js` (case 8 nuevo) | ✅ |
| DEBT-04 | `src/logger.js` no exporta `ANSI_*` ni `COLOR_BY_LEVEL` | source-hygiene | `node --test test/format-isolation.test.js` (extender) | ✅ |
| DEBT-05 WR-01..03/06/08 | refactors puros — no nuevos asserts | regression | suite global verde | ✅ existing |
| DEBT-05 WR-04 | Test 4 D-04 `from` paramétrico | unit | `node --test test/stop-state-transition.test.js` (extender) | ✅ |
| DEBT-05 WR-05 | T27 order pre-throw caveat clarificado | unit | `node --test test/gsd-verify-integration.test.js` (clarification) | ✅ |
| DEBT-05 WR-07 | `markSessionStatus` no emite state.transition si `current` undefined | unit | `node --test test/stop-state-transition.test.js` (test nuevo si manager.js cambia) | ✅ (fixture pattern reusable) |
| DEBT-06 IN-01 | JSDoc claration de `runStopHook` (documental, sin test) | manual review | n/a | n/a |
| DEBT-06 IN-02 | Payload shape de `gsd.phase.resolved` en 4 ramas | unit | `node --test test/dispatcher.test.js` (extender) | ✅ |
| DEBT-06 IN-03 | Comentario verify.js cita-por-contenido | manual review | grep `grep -c "line 26" src/gsd/verify.js` → expect 0 | ✅ |
| DEBT-06 IN-04 | Comentario stop.js cita-por-contenido | manual review | grep `grep -c "line 116" src/hooks/stop.js` → expect 0 | ✅ |

### Sampling Rate

- **Per task commit:** test del archivo tocado (~1-5s).
- **Per wave merge:** `npm test` completa (~609 tests, baseline antes de Phase 22).
- **Phase gate:** Full suite green + grep negativo D-09 (ANSI_RESET/COLOR_BY_LEVEL en `src/`).

### Wave 0 Gaps

**Ninguno** — toda la infraestructura de test ya existe:
- `test/format.test.js` para DEBT-03.
- `test/format-isolation.test.js` walker reusable para DEBT-04 guard.
- `test/stop-state-transition.test.js` mkdtempSync+HOME override pattern reusable.
- `test/gsd-verify-integration.test.js` memSink pattern reusable.
- `test/dispatcher-isolation.test.js` stripComments reusable.
- `test/version-smoke.test.js` ya existe (solo añadir `timeout`).

## Code Examples

### Pattern 1: Test defensivo `spawnSync` timeout (DEBT-02)

```javascript
// test/version-smoke.test.js:18-22 — CURRENT
const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
  cwd: REPO,
  encoding: 'utf-8',
  // No env override — we want to test the install in its real shape.
});

// AFTER fix
const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
  cwd: REPO,
  encoding: 'utf-8',
  timeout: 10_000, // 10 s — falla rápido en CI si el bin cuelga (WR-01 Phase 14)
  // No env override — we want to test the install in its real shape.
});
```

### Pattern 2: Regex ANSI defensiva (DEBT-03 IN-01)

```javascript
// src/cli/format.js:56-58 — CURRENT
export function visibleWidth(s) {
  return String(s).replace(/\x1b\[\d+m/g, '').length;
}

// AFTER fix — cubre CSI general (\x1b[33;1m, \x1b[38;5;200m)
export function visibleWidth(s) {
  return String(s).replace(/\x1b\[[\d;]*[A-Za-z]/g, '').length;
}
```

### Pattern 3: Source-hygiene guard pattern (DEBT-04, reusable)

```javascript
// test/format-isolation.test.js — ADD new describe block
describe('DEBT-04 source-hygiene: ANSI exports retired (Phase 15 IN-01 closed via Phase 22)', () => {
  it('src/logger.js no exporta ANSI_RESET ni COLOR_BY_LEVEL', () => {
    const src = readFileSync(join(SRC, 'logger.js'), 'utf-8');
    assert.equal(/export\s+const\s+ANSI_/m.test(src), false,
      'ANSI_* must not be exported from logger.js after Phase 22 (DEBT-04)');
    assert.equal(/export\s+const\s+COLOR_BY_LEVEL/m.test(src), false,
      'COLOR_BY_LEVEL must not be exported from logger.js after Phase 22 (DEBT-04)');
  });
});
```

### Pattern 4: WR-04 `from` invariante (DEBT-05)

```javascript
// test/stop-state-transition.test.js:316-339 — extend "D-04 invariante MANDATORY" test
for (const session of [fullSession, quickSession]) {
  // ... existing setup ...
  const transition = events.find((e) => e.fields?.event === 'state.transition');
  assert.ok(transition, `D-04 invariante: modo ${session.gsd_mode} debe emitir state.transition`);
  assert.equal(transition.fields.to, 'done',
    `D-04 LOCKED: to debe ser 'done' fijo (modo ${session.gsd_mode})`);
  // NEW assert (WR-04):
  const expectedFrom = session.gsd_mode === 'full' ? 'review' : 'running';
  assert.equal(transition.fields.from, expectedFrom,
    `WR-04: from debe ser ${expectedFrom} para modo ${session.gsd_mode} — Test 4 NO debe ser estructuralmente débil`);
}
```

### Pattern 5: Consolidar import eager (DEBT-05 WR-06)

```javascript
// src/triggers/dispatcher.js:13 — CURRENT
import { EVENTS } from '../logger-events.js';

// AFTER fix — consolidar helpers eager
import { EVENTS, gsdPhaseResolved, gsdBootstrap } from '../logger-events.js';

// src/triggers/dispatcher.js:307 — DELETE
// const { gsdPhaseResolved, gsdBootstrap } = await import('../logger-events.js');

// Helpers ya en scope desde línea 13. createLogger sigue como dynamic
// (LOG-12 invariant: dispatcher no carga logger.js en module-load path).
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File walker for source-hygiene | Custom AST parser | `test/format-isolation.test.js` `walkImports` + `extractImports` | Ya existe (LOG-12 extension); regex-based, suficiente para repo sin dynamic imports. |
| Logger memSink fixture | New mock library | Pattern de `test/gsd-verify-integration.test.js:73-83` y `test/stop-state-transition.test.js:70-80` | Mismo shape `child: () => logger`, pushes events array. |
| HOME override para tmpdir-isolated state.json | New env-stub helper | `before/after` pattern de `test/stop-state-transition.test.js:116-142` | mkdtempSync + dynamic import dentro de `before`. |
| `stripComments` helper | New comment parser | `test/dispatcher-isolation.test.js:24-30` | Suficiente para full-line comments; inline comments son intentional (D-08 docs). |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `test/dispatcher.test.js` (no leído) **probablemente** cubre payload shape de `gsd.phase.resolved` para matched-true path (Plan 15-04 + REVIEW Phase 16 referencias). | DEBT-06 IN-02 | Si NO cubre, hay que añadir tests nuevos para matched-false branches; aumenta scope task IN-02. |
| A2 | El refactor Phase 19 sobre `stop.js` ya resolvió IN-04 (comentarios "line 116") como subproducto del re-shaping del flujo. | DEBT-06 IN-04 | Si quedan vestigios, planner debe añadir 2-3 LOC de comment cleanup. Cheap. |
| A3 | WR-01 (doble logger) `stop.js` quedó resuelto durante Phase 19 markSessionStatus relocation (verificado por Read: solo 1 `const log = ...` en líneas 159-167 antes del bloque markSessionStatus/sessionEnd). | DEBT-05 WR-01 | Si quedó parcial (hay segundo `cleanupLog` en línea 220-228), planner decide si entra en scope. Documentado en R-02. |
| A4 | El SECURITY.md actual en `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-SECURITY.md` (R-01) **probablemente** ya tiene `threats_open: 0` por el patrón Phase 15/16. | DEBT-01 | Si está stale o vacío, planner re-genera con Phase 15 plantilla. |

## Sources

### Primary (HIGH confidence)

- `Read /Users/alex/dev/klab/kodo/src/logger.js` — verified líneas 41-53 + 312 (ANSI_* + uses).
- `Read /Users/alex/dev/klab/kodo/src/cli/format.js` — verified línea 57 (regex), 101 (comment), 159 (comment), 42-46 (_resolveUseColor logic).
- `Read /Users/alex/dev/klab/kodo/src/hooks/stop.js` — verified líneas 159-176 (single logger creation post-Phase-19), 169-176 (catch con console.error explícito), 152-195 (no "line 116" residuals).
- `Read /Users/alex/dev/klab/kodo/src/gsd/verify.js` — verified líneas 91-97 (loggerFactory default), 110 (.child{task_id}), 249-265 (CR-01 fix con cita por contenido — IN-03 already resolved).
- `Read /Users/alex/dev/klab/kodo/src/triggers/dispatcher.js` — verified línea 13 (eager EVENTS) + línea 307 (dynamic gsdPhaseResolved/gsdBootstrap).
- `Read /Users/alex/dev/klab/kodo/test/version-smoke.test.js` — verified líneas 18-22 (spawnSync sin timeout).
- `Read /Users/alex/dev/klab/kodo/test/logger-exports.test.js` — verified líneas 11-22 (tests sobre exports a retirar).
- `Read /Users/alex/dev/klab/kodo/test/stop-state-transition.test.js` — verified líneas 331-334 (Test 4 sin assert from).
- `Read /Users/alex/dev/klab/kodo/test/gsd-verify-integration.test.js:320-412` — verified T27 transition === undefined assertion.
- `Read /Users/alex/dev/klab/kodo/test/dispatcher-isolation.test.js` — verified stripComments shape.
- `Read /Users/alex/dev/klab/kodo/test/format.test.js:1-80` — verified 7 casos _resolveUseColor sin FORCE_COLOR=''.
- `Read /Users/alex/dev/klab/kodo/test/format-isolation.test.js` — verified walker pattern reusable para DEBT-04 guard.
- `Read /Users/alex/dev/klab/kodo/.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-SECURITY.md` — verified plantilla SECURITY.md.
- `Read /Users/alex/dev/klab/kodo/.planning/milestones/v0.5-phases/16-log-09-debt-cleanup/16-SECURITY.md:1-25` — verified mismo shape Phase 15.
- `Read /Users/alex/dev/klab/kodo/.planning/phases/18-worktree-runtime-wiring/18-SECURITY.md` — alternativa heavyweight (con threats), shape distinto del que necesita Phase 14.
- `Bash grep -rn "ANSI_RESET\|ANSI_GRAY\|ANSI_CYAN\|ANSI_YELLOW\|ANSI_RED\|COLOR_BY_LEVEL" src/ test/ bin/` — verified 0 consumers externos.
- `Bash find .planning -name "*SECURITY*"` — verified 4 SECURITY.md existentes (incluyendo Phase 14 inesperado — R-01).

### Secondary (MEDIUM confidence)

- `.planning/REQUIREMENTS.md` §DEBT-01..06 — coverage table.
- `.planning/milestones/v0.5-phases/14-cli-format-foundation/14-REVIEW.md` — WR-01 + IN-01 + IN-02 source.
- `.planning/milestones/v0.5-phases/15-cli-polish-wiring/15-REVIEW.md` — IN-01 ANSI exports source.
- `.planning/milestones/v0.5-phases/16-log-09-debt-cleanup/16-REVIEW.md` — WR-01..08 + IN-01..04 source + Resolution Log Iteration 1.

### Tertiary (LOW confidence — needs validation)

- A1: `test/dispatcher.test.js` content (no leído en este pase).
- A2: completeness del refactor Phase 19 sobre stop.js comentarios.
- A4: contenido actual del `14-SECURITY.md` existente.

## Metadata

**Confidence breakdown:**

- Per-Item Current State (line numbers + snippets): HIGH — todo verificado por Read directo.
- External consumers grep (DEBT-04): HIGH — comando ejecutado, output capturado.
- Phase 19 SECURITY.md template: MEDIUM — el archivo asumido por CONTEXT.md no existe; Phase 15 SECURITY.md es plantilla más cercana.
- WR/IN already-resolved heuristic (R-02): MEDIUM — verificado por Read, pero conviene grep adicional en plan-checker.
- Risks R-01..R-05: HIGH (R-01) / HIGH (R-02) / HIGH (R-03 — manager.js confirmado por CONTEXT.md texto) / MEDIUM (R-04) / HIGH (R-05).

**Research date:** 2026-05-13
**Valid until:** 2026-06-13 (30 días — cleanup-only phase, low decay risk; el código v0.5 está congelado).

## RESEARCH COMPLETE
