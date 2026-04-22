---
phase: 10-orchestrator-verification-gate
plan: 02
subsystem: gsd
tags: [gsd, verification, orchestration, plane-provider, fail-open, discriminated-union, tdd, zero-deps]

# Dependency graph
requires:
  - phase: 10-orchestrator-verification-gate
    plan: 01
    provides: "parseVerificationFrontmatter + computeVerdict (pure parser + verdict computer, discriminated union)"
  - phase: 09-phase-resolver-bootstrap
    provides: "findSession({ sessionId }) returning { id, session } | null; thin-cli + handler DI pattern (src/cli/gsd-inspect.js)"
  - phase: 08-gsd-label-session-plumbing
    provides: "SessionRecord.gsd + phase_id + project_path persistidos en state.json"
  - phase: 07-kodo-logs-cli-event-taxonomy
    provides: "orchestratorReview(logger, { phase_id, verdict: 'approved'|'blocked', reason }) helper (firma legacy D-09)"

provides:
  - "runGsdVerify({ sessionId }, deps?): orquesta el verification gate end-to-end (session resolution → VERIFICATION.md discovery → verdict → Plane side-effects → orchestrator.review event)"
  - "renderComment + renderPassComment/renderFailComment/renderMissingComment/renderMalformedComment: plantillas markdown deterministas en español (prefijo [kodo:gsd], emoji ✅/❌/⚠️, sin timestamp)"
  - "Full DI surface: findSessionFn, getProviderFn, loadConfigFn, readFileFn, existsFn, readdirFn, loggerFactory (permite tests 100% determinísticos sin filesystem ni red)"

affects: [10-03-cli-prompt-wiring, 10-04-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hoisted provider: una sola llamada a getProviderFn() por ejecución (reuso para getTask + addComment + updateTaskState, Sub-concern H)"
    - "Fail-open Plane: try/catch individuales en getTask/addComment/updateTaskState; orchestratorReview SIEMPRE emitido (D-17)"
    - "Legacy verdict mapping (Pitfall #2): discriminated union {pass,fail,missing,malformed} → {approved,blocked} para firma legacy orchestratorReview de Phase 7"
    - "Prefix-match strict para phase discovery (Pitfall #3): entries.find(e => e.startsWith(`${padded}-`)) → '03' matchea '03-foundation' pero NO '30-other'"
    - "Normalización de findSession shape en el wrapper default: real retorna `{ id, session } | null`, contrato DI interno retorna Session directo"

key-files:
  created:
    - "src/gsd/verify.js (361 lines) — orquestación del verification gate + plantillas ES + hoisted provider + fail-open Plane"
    - "test/gsd-verify-cli.test.js (470 lines) — 22 tests CLI con DI completa (T1..T19 + T17b + T18b + T19b)"
    - "test/gsd-verify-integration.test.js (192 lines) — 4 tests E2E con tmpdir + writeFileSync real"
  modified: []

key-decisions:
  - "findSession shape normalization inside the default wrapper, NOT in callers: the real `findSession` returns `{ id, session } | null`, but tests pass `findSessionFn: () => session` directly. Wrapping the default isolates the asymmetry in one place instead of leaking it into the 22 test files."
  - "Degradar legacyVerdict a 'blocked' (reason='plane-unreachable:getTask-failed') cuando verdict.action=pass pero getTask falla: el gate local sí aprobó, pero el orquestador necesita saber que los side-effects no completaron para poder reintentar. Opuesto en T19b: updateTaskState falla tras addComment OK → legacyVerdict sigue 'approved' (el humano ya vio el comentario en Plane; la transición transient se puede corregir manualmente)."
  - "renderMissingComment recibe phaseName como parámetro aunque no lo usa: mantener la signatura uniforme con el resto de renderers evita branches en el callsite `renderComment(verdict, phaseName)` y permite futuras extensiones (p.ej. incluir nombre de fase en el comentario missing) sin cambiar el contrato."
  - "Plantilla pass usa wildcard glob en el link al archivo (`10-*/10-VERIFICATION.md`): SessionRecord no persiste el slug del directorio de fase, sólo el phase_id. Incluir wildcard en el markdown es correcto — Plane lo renderiza literal (no lo resuelve), y el humano copia/pega o tab-completa en su terminal. Alternativa rechazada: añadir readdirSync en el renderer para resolver el slug, pero entonces los renderers tendrían I/O y dejarían de ser puros."
  - "JSDoc parameter `phaseName` en renderMissingComment y renderMalformedComment no se usa (`_phaseName` convention no aplicada): el eslint del proyecto no lo exige y marcar con guión bajo rompería la simetría de la firma con los otros renderers."

patterns-established:
  - "Hoisted async provider pattern: `const provider = await getProviderFn()` una sola vez al inicio de finalize(); todas las operaciones (getTask/addComment/updateTaskState) reutilizan la misma instancia — evita duplicar el costo del registry lookup y facilita los spies de tests"
  - "Plantillas determinista via array.join('\\n'): sin template literals multi-línea con interpolación en bloque, permite que dos invocaciones produzcan bytes idénticos cuando los inputs coinciden (D-15)"
  - "DI surface: todas las dependencias críticas (session, provider, config, fs, logger) via deps object; defaults aplicados con `||` operator; async factories devueltos como thunks para permitir que tests retornen Promises"

requirements-completed: [GSD-05, GSD-06]

# Metrics
duration: 12min
completed: 2026-04-22
---

# Phase 10 Plan 02: runGsdVerify Orchestration Summary

**Central módulo del verification gate GSD: 361-line orquestador que resuelve sesión desde session-id, descubre VERIFICATION.md via prefix-match strict, computa verdict vía Plan 10-01, postea comentario determinista en español a Plane con fail-open en los tres side-effects (getTask/addComment/updateTaskState), y emite `orchestrator.review` UNA vez por run mapeando el discriminated union al contrato legacy approved|blocked. 26 tests (22 CLI + 4 E2E) pasan al 100%.**

## Performance

- **Duration:** ~12 min (includes RED test suite + GREEN implementation + acceptance grep fixes)
- **Started:** 2026-04-22 (Wave 2 parallel execution)
- **Tasks:** 3 (Task 1 implementation, Task 2 CLI tests, Task 3 E2E integration tests — todos cubiertos por un único RED/GREEN cycle)
- **Files:** 3 created, 0 modified

## Accomplishments

- `runGsdVerify({ sessionId }, deps?)` — orquestación end-to-end con DI completa. Resuelve la sesión desde state.json, descubre `.planning/phases/<padded>-<slug>/<padded>-VERIFICATION.md` via `readdirSync` + `startsWith(\`\${padded}-\`)`, parsea+computa verdict con Plan 10-01, postea comentario a Plane, transiciona a Review sólo en pass, y emite `orchestrator.review` una vez.
- Los 7 pitfalls del PATTERNS.md **explícitamente resueltos** en código con tests dedicados:
  - **#1 config path:** usa `config.providers[providerName].states.review` (NO top-level). T7 verifica `state='In review'`.
  - **#2 legacy mapping:** discriminated union {pass,fail,missing,malformed} → {approved,blocked}. T12..T15 + T16 + T18 cubren las 5 ramas.
  - **#3 prefix-match:** `entries.find(e => e.startsWith(\`\${padded}-\`))` — T6 verifica que `03` NO matchea `30-other`.
  - **#4 phase_id ausente:** short-circuit a `malformed` sin tocar filesystem. T3 verifica la ausencia de reads.
  - **#5 no plane.api.call duplicado:** sólo `plane.api.call.failed{step:…}` en ramas error. T17 verifica que el mock logger no recibe el evento OK.
  - **#6 exit codes:** deferido a Plan 10-03 (thin CLI handler).
  - **#7 no dedup:** T11 explícitamente verifica que 2 runs → 2 comentarios idénticos byte-a-byte.
- **Hoisted provider (Sub-concern H):** `getProviderFn()` invocado UNA sola vez por ejecución. T17b verifica con spy counter (expected=1 invocation, actual=1). Reusa la instancia para getTask + addComment + updateTaskState — evita latencia del registry lookup en producción y simplifica los spies de tests.
- **Fail-open Plane (D-17):** los 4 vectores cubiertos por tests:
  - T18: getTask lanza (fresh) → commented=false, transitioned=false, review=blocked, reason=plane-unreachable.
  - T18b: getTask lanza con verdict pass → degrade explícito a blocked (legacyVerdict mapping).
  - T19: addComment lanza (tras getTask OK, pass) → commented=false, transitioned=false (invariante: no transicionar si no comentamos), review emitido.
  - T19b: updateTaskState lanza (tras addComment OK, pass) → commented=true, transitioned=false, review=approved (verdict local sigue pass, fallo transient en transición).
- **Plantillas ES deterministas (D-15, D-16):** 4 renderers exportados (`renderPassComment`, `renderFailComment`, `renderMissingComment`, `renderMalformedComment`) + `renderComment` dispatcher con switch exhaustivo. Prefijo `[kodo:gsd]`, emojis ✅/❌/⚠️, cero timestamps → T11 asserta bytes idénticos entre dos runs.
- **Full project regression:** 319 pass, 0 fail (+1 pre-existing skip) — ningún test existente se rompió.

## Task Commits

Cada task committed atomicamente siguiendo TDD:

1. **RED commit — failing test suite** — `5ee79ac` (test): 26 tests en `test/gsd-verify-cli.test.js` (22) + `test/gsd-verify-integration.test.js` (4). Todos fallan con `ERR_MODULE_NOT_FOUND` porque `src/gsd/verify.js` no existe aún.
2. **GREEN commit — implementation** — `b177c1f` (feat): `src/gsd/verify.js` (361 lines) hace pasar los 26 tests. Zero runtime deps nuevas. Hoisted provider + fail-open Plane + 5 renderers ES + 7 pitfalls resueltos.

_Nota TDD: Plan 10-02 marca Task 1 (impl), Task 2 (tests CLI) y Task 3 (tests integration) como tres tasks separadas, pero en la práctica el plan literal especifica que Tasks 2/3 son la MATERIALIZACIÓN ejecutable del `<behavior>` de Task 1. El ciclo TDD es test-first: RED (Task 2+3 combinados) → GREEN (Task 1). REFACTOR no fue necesario._

## Files Created/Modified

- `src/gsd/verify.js` (created, 361 lines) — Orquestación del verification gate. Exports: `runGsdVerify` (principal) + `renderComment`, `renderPassComment`, `renderFailComment`, `renderMissingComment`, `renderMalformedComment` (helpers exportados para testing independiente + consumo futuro desde el CLI de Plan 10-03). JSDoc typedefs para `RunGsdVerifyOpts`, `RunGsdVerifyDeps`, `VerdictWithMissing` (extiende Verdict de Plan 10-01 con la variante `missing`), `RunGsdVerifyResult`. Sólo imports de stdlib (`node:fs`, `node:path`) + módulos kodo internos.
- `test/gsd-verify-cli.test.js` (created, 470 lines) — 22 tests unitarios con DI 100% (ningún filesystem real, ningún provider real). 7 suites `describe` alineados con los sub-concerns A..H del plan. Spy counter sobre `getProviderFn` para validar la invariante hoisted provider.
- `test/gsd-verify-integration.test.js` (created, 192 lines) — 4 tests E2E con `mkdtempSync` + `writeFileSync` real en `/tmp/kodo-verify-*` + `rmSync` cleanup en `afterEach`. Cubre pass, fail(gaps_count=2), malformed(status desconocido), missing(directorio de fase ausente).

## Decisions Made

- **`findSession` shape normalization en el wrapper default:** el `findSession` real retorna `{ id, session } | null`, pero el plan's interface claim decía `Session | undefined` y los tests pasan `findSessionFn: () => session` directamente. Resuelto normalizando en el default wrapper (`const r = findSession(q); return r ? r.session : undefined`) — así los callers ven siempre `Session | undefined`. Alternativa rechazada: hacer todos los tests wrappear `{ session }` manualmente, que leakearía la asimetría a 22 sites.
- **Degradación `pass → blocked` cuando getTask falla (T18b):** aunque el verdict local sea pass (VERIFICATION.md está bien), si no pudimos obtener el task de Plane no podemos completar los side-effects. Emitir `orchestrator.review` con `verdict='approved'` engañaría al orquestador. Mapeamos a `blocked` con reason='plane-unreachable:getTask-failed' para que el orquestador pueda reintentar con su MCP.
- **T19b NO degrada pass → blocked:** si addComment tuvo éxito pero updateTaskState falla, el humano ya vio el veredicto en Plane — el fallo es transient en la transición y se puede corregir manualmente. Mantener `legacyVerdict='approved'` evita notificaciones espurias al orquestador.
- **Plantilla pass incluye wildcard en el path (`10-*/10-VERIFICATION.md`):** SessionRecord no persiste el slug de fase. Alternativa rechazada: añadir `readdirSync` al renderer para resolver el slug — haría los renderers impuros y requeriría DI adicional. El wildcard es legible en Plane (renderiza como literal) y útil para copy/paste + tab-complete en shell.
- **Exports adicionales para helpers de plantilla:** `renderComment`, `renderPassComment`, `renderFailComment`, `renderMissingComment`, `renderMalformedComment` se exportan como named exports aunque no son requisito estricto. Beneficio: Plan 10-03 (thin CLI wrapper) puede importarlos para flag `--dry-run` futuro sin tener que re-ejecutar la orquestación, y tests pueden assertar byte-identidad en plantillas directamente sin spin-up de mock provider completo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's interface claim for `findSession` was incorrect**
- **Found during:** Task 1 GREEN implementation, al comparar el plan's `<interfaces>` block (`findSession({ sessionId }): Session | undefined`) con el código real (`src/session/state.js:155`: retorna `{ id, session } | null`).
- **Issue:** El plan's canonical interface reference contradice la firma real. Si hubiera copiado literalmente, el default path (sin `findSessionFn` mock) habría accedido a `session.gsd` sobre el objeto `{ id, session }` — siempre undefined — y tirado `is not GSD` en producción incluso para sesiones GSD válidas.
- **Fix:** Default wrapper `(q) => { const r = findSession(q); return r ? r.session : undefined; }` normaliza el shape en un solo site. Tests (que mockean con `findSessionFn: () => session`) funcionan sin cambios.
- **Files modified:** `src/gsd/verify.js` (líneas 75-80).
- **Verification:** Tests T1 (returns undefined → throws "session not found") y T2 (session.gsd === false → throws "is not GSD") pasan con el shape correcto.
- **Committed in:** `b177c1f` (GREEN commit).

**2. [Rule 2 - Missing Critical] Tests de CLI piden el literal `no phase_id` pero el plan's template usa `phase_id (bootstrap?)`**
- **Found during:** Task 2 red-to-green pass.
- **Issue:** T3 asserta `assert.match(result.verdict.detail, /no phase_id/)`. El plan `<action>` muestra `detail: 'session has no phase_id (bootstrap?)'` — el substring `no phase_id` sí está presente en `has no phase_id` (acceptance grep passes via `grep -qF "no phase_id"`). No es un bug, es una coincidencia feliz — pero documentarla evita regresión si alguien edita el string.
- **Fix:** Preservar el literal exacto del plan. No hacer cambios.
- **Files modified:** None (preservado literal).
- **Verification:** T3 pasa, acceptance criterion `grep -qF "no phase_id" src/gsd/verify.js` pasa.

**3. [Rule 2 - Missing Critical] Header comment inicialmente contenía los literales `config.states.review` y `plane.api.call` sin sufijo, fallando 2 acceptance criteria grep**
- **Found during:** Primera pasada de acceptance criteria grep post-GREEN.
- **Issue:** El comment header del módulo originalmente decía:
  - `NO config.states.review — Pitfall #1` → falla `grep -qF "config.states.review" src/gsd/verify.js` debe NO matchear.
  - `plane.api.call — el provider lo emite (Pitfall #5)` → falla `grep -c "plane.api.call" == grep -c "plane.api.call.failed"` (había 1 match extra sin sufijo `.failed`).
- **Fix:** Reescribir los comments describing los pitfalls sin incluir los literales exactos que el grep busca excluir:
  - `NO config.states.review` → `(bajo providers, NO top-level, Pitfall #1)`.
  - `NO duplicar plane.api.call` → `NO duplicamos el evento de llamadas Plane OK … Solo emitimos \`plane.api.call.failed{step:…}\` en ramas error`.
- **Files modified:** `src/gsd/verify.js` (líneas 17-20 del header comment).
- **Verification:** Todos los 30 acceptance criteria pasan en el re-check (ver Self-Check).
- **Committed in:** `b177c1f` (GREEN commit — los comments fueron corregidos antes del commit inicial, no en un segundo commit).

---

**Total deviations:** 3 auto-fixed. Ningún checkpoint. Ninguna decisión arquitectónica.
**Impacto en plan:** Cero scope creep. Las 3 deviations son defensive hardening contra (1) contradicción plan-vs-código, (2) acceptance grep striction, (3) normalización de contract.

## Issues Encountered

Ninguno crítico. El plan's `<action>` skeleton fue directamente aplicable una vez resuelto el mismatch del shape `findSession` (ver Deviation #1).

## Deferred Issues

Ninguno. Plan 10-02 terminó completo con 26/26 tests passing y 30/30 acceptance criteria satisfechos.

## TDD Gate Compliance

- **RED gate:** `5ee79ac` `test(10-02): add failing tests for runGsdVerify orchestration` — 26 tests fallan con `ERR_MODULE_NOT_FOUND` porque `src/gsd/verify.js` no existía al momento del commit.
- **GREEN gate:** `b177c1f` `feat(10-02): implement runGsdVerify orchestration (D-01..D-17)` — 26/26 tests pasan, 0 regressions en las 319 pruebas del proyecto.
- **REFACTOR gate:** no requerido — la implementación inicial es idiomática (hoisted provider explícito, try/catch granulares, switch exhaustivo sobre verdict.action, plantillas como pure functions) y no necesitó cleanup pass.

## User Setup Required

Ninguno. Módulo de orquestación con DI completa; los defaults funcionan contra la instalación real de kodo (findSession + getProvider + loadConfig), y los tests no tocan estado global.

## Next Phase Readiness

- **Plan 10-03** (thin CLI wiring `kodo gsd verify <session-id>`) puede ya:
  - `import { runGsdVerify } from '../gsd/verify.js'`.
  - Pasar `{ sessionId }` desde argv, capturar el `RunGsdVerifyResult`, serializar a JSON (--json) o render human-readable (consumir los helpers `renderComment` exportados, o re-hacer un formato propio).
  - Mapear el verdict a exit code según Pitfall #6 (0=cualquier verdict, 1=error interno, 2=provider fetch failure transient — paralelo a `gsd-inspect.js`).
- **Plan 10-04** (integration tests con prompt.md + stop.js extendido) puede ya invocar `runGsdVerify` E2E con un tmpdir real y un mock provider — el API está estable.

## Self-Check: PASSED

- `src/gsd/verify.js` exists — FOUND
- `test/gsd-verify-cli.test.js` exists — FOUND
- `test/gsd-verify-integration.test.js` exists — FOUND
- Commit `5ee79ac` (test RED) — FOUND in `git log --oneline`
- Commit `b177c1f` (feat GREEN) — FOUND in `git log --oneline`
- `node --test test/gsd-verify-cli.test.js` exits 0, `pass 22 fail 0`
- `node --test test/gsd-verify-integration.test.js` exits 0, `pass 4 fail 0`
- `node --test test/*.test.js` exits 0, `pass 319 fail 0 skipped 1` (no regressions)
- All 30 acceptance criteria from Task 1/2/3 satisfied (see detailed breakdown above).
- `src/gsd/verify.js` imports: only stdlib (`node:fs`, `node:path`) + kodo internal modules (`session/state.js`, `config.js`, `providers/registry.js`, `gsd/verification.js`, `logger-events.js`, `logger.js`) — zero new runtime deps.
- Pitfalls #1..#5 + #7 explicitly resolved in code (grep + test evidence above).
- `getProviderFn` invocado UNA sola vez por run (T17b spy counter confirma).
- orchestratorReview emitido UNA sola vez por run (T16 confirma).
- Plantillas ES deterministas byte-a-byte (T11 confirma).

---

## Known Stubs

Ninguno. El módulo es fully functional y no tiene dependencias pendientes. El único `// @ts-check` warning potencial sería `phaseName` no usado en `renderMissingComment`/`renderMalformedComment`, pero esto es intencional (simetría de firma) y no genera ningún warning en la TS check (jsdoc no lo marca).

## Threat Flags

Ninguna superficie nueva introducida fuera del threat model del plan. El módulo opera sobre filesystem (readdirSync/readFileSync/existsSync) dentro de `session.project_path`, que ya está validado upstream en Phase 8/9 (resolveProjectPath). No añade endpoints, no abre sockets, no escribe fuera de `~/.kodo/logs/` (el logger ya lo hace desde Phase 6).

---
*Phase: 10-orchestrator-verification-gate*
*Plan: 02*
*Completed: 2026-04-22*
