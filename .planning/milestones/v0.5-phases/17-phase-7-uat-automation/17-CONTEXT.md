# Phase 17: Phase 7 UAT Automation - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Convertir los 3 UATs humanos pendientes de v0.3 Phase 7 (`07-HUMAN-UAT.md`) en integration tests automatizados con fixtures NDJSON progresivos y `state.json` sintético, eliminando el TODO humano sin reescribir el subsistema `kodo logs`. Los 3 UATs:

- **UAT-01** — `kodo logs --follow` con tail real (dump + live append) y cleanup limpio del watcher.
- **UAT-02** — `session.start` con los 6 campos canónicos D-10 (`session_id`, `task_id`, `provider`, `project_path`, `transcript_path`, `started_at`).
- **UAT-03** — `kodo logs --session-of <plane-task-id>` resolución two-step (state.json index → head-line scan) + exit codes deterministas.

Salidas: 3 archivos `test/*.test.js` nuevos en el runner `node:test`, `07-HUMAN-UAT.md` reducido a redirect, MILESTONES.md v0.3 entry actualizada al cierre de la fase.

</domain>

<decisions>
## Implementation Decisions

### Spawn shape (transversal a UAT-01/02/03)

- **D-01:** **Subprocess real** con `spawn(process.execPath, [...], opts)`. UAT-01 y UAT-03 spawnean `bin/kodo` (ruta absoluta vía `path.resolve(repoRoot, 'bin/kodo')`); UAT-02 spawnea `src/hooks/session-start.js` directamente porque ese es el entry point que Claude Code invoca en producción (no via `bin/kodo`). NO usar import directo de `followFile`/`sessionStart` — perdería el wiring CLI/hook que la UAT debe ejercer.
- **D-02:** **Aislamiento HOME** vía `spawn(..., { env: { ...process.env, HOME: tmpHome } })`. `tmpHome = mkdtempSync(join(tmpdir(), 'kodo-uat-'))`. Kodo computa `KODO_DIR = join(homedir(), '.kodo')` al import-time — el override de `HOME` en el child env es suficiente para que el subprocess resuelva `state.json` y `logs/` dentro del tmpdir. Cleanup en `after()` con `rmSync(tmpHome, { recursive: true, force: true })`. Mismo patrón filosófico que CR-02 Phase 16 (`test/stop-state-transition.test.js`), adaptado a subprocess.
- **D-03:** No introducir `KODO_DIR` env público ni `cwd` override. Añade superficie de configuración pública que no estaba pedida y rompe la convención `~/.kodo`.

### UAT-01 — `kodo logs --follow`

- **D-04:** **Progresión 3 batches con setInterval ~250ms.** Cada batch `appendFileSync(logFile, line + '\n')` con un sentinel propio (`event: 'test.batch', seq: 1|2|3`) para reconocer orden. 250ms ≥ `FOLLOW_INTERVAL_MS=200ms` evita coalescencia del watcher poll y mantiene el test ágil (~750ms total de escritura). NO override de `FOLLOW_INTERVAL_MS` por env: añadiría superficie test-only.
- **D-05:** **Verificación incremental con `awaitLine(child.stdout, sentinel, timeoutMs)`.** Helper async que escucha chunks de stdout, acumula buffer, resuelve cuando aparece el sentinel esperado, rechaza con timeout. Asserts orden estricto: `await awaitLine('seq:1')` antes de escribir batch 2, etc. Detecta tail real (no fake) — si todo apareciera de golpe al final, el orden temporal con respecto a las escrituras lo demostraría falso.
- **D-06:** **Cleanup vía `child.kill('SIGINT')` + `await on('exit')` con timeout duro 2s.** Assert exit code 0. `unwatchFile` corre dentro del SIGINT handler real de `followFile` (`src/logs/follow.js:67-70`) — no se mockea ni se inspeccionan handles. Si SIGINT no convierte en exit limpio en 2s, el test falla por timeout. Cubre SC#1 cleanup limpio sin handles abiertos.
- **D-07:** **Setup: pre-crear archivo NDJSON vacío** con `writeFileSync(logFile, '')` antes del spawn. Path principal de la UAT (existe pero sin contenido → dump-0 + tail). El path "waiting for session log to appear" queda fuera de scope (deferred).

### UAT-02 — `session.start` con campos canónicos

- **D-08:** **Driver: state.json sintético + stdin con session_id.** Pre-poblar `${tmpHome}/.kodo/state.json` vía `addSession()` (importado dinámicamente DESPUÉS de fijar HOME, mismo truco que CR-02 Phase 16). Spawn `node src/hooks/session-start.js` pasando por stdin JSON `{ session_id, transcript_path: '/tmp/fake-transcript.jsonl' }`. Mismo path que Claude Code en producción — el hook lee `findSessionBySessionId(session_id)` y emite el evento.
- **D-09:** **Asserts contra contrato del helper `sessionStart()` en `src/logger-events.js`.** Importar `EVENTS.SESSION_START` y la signature. Asserts: `event === EVENTS.SESSION_START` + presencia de las 6 keys canónicas (`session_id`, `task_id`, `provider`, `project_path`, `transcript_path`, `started_at`) + tipos correctos. Cambiar el contrato del helper rompe el test (objetivo SC#2: assertar contra contrato, no contra fixture estático).
- **D-10:** **Fail-loud compensando el silent on failure del hook.** Tras `await child.on('exit')`, el test lee `${tmpHome}/.kodo/logs/<session-id>.ndjson`:
  - Si archivo ausente → `assert.fail('hook did not emit session.start NDJSON file')`.
  - Si primera línea no parsea como JSON → `assert.fail('first line malformed')`.
  - Si `event !== EVENTS.SESSION_START` → `assert.fail('first event is not session.start')`.
  Compensa el outer `try { ... } catch {}` del hook (`src/hooks/session-start.js:223-225`) que tragaría el crash silenciosamente.
- **D-11:** **Sesión sintética no-GSD** (`session.gsd = false`). Aísla UAT-02 del builder GSD/quick context. `session.start` es invariante al modo según el contrato del hook (líneas 198-205) — basta una variante. Las variantes GSD full/quick quedan deferred si surge regresión.

### UAT-03 — `kodo logs --session-of <task-id>` E2E

- **D-12:** **Cobertura: los 3 casos de SC#3 + happy path step-2.** Cuatro escenarios:
  1. **state.json hit (step-1)** — sesión presente con `task_id` matching → exit 0, stdout con log content.
  2. **step-1 miss + step-2 hit** — sesión NO en state.json (eliminada o persistencia perdida) pero `<sessionId>.ndjson` existe en `logs/` con head-line `event=session.start, task_id=<expected>` → step-2 head-line scan resuelve → exit 0.
  3. **task ausente totalmente** — ni state.json ni log files contienen el task_id → exit code != 0, stderr con mensaje.
  4. **task en state.json apuntando a sessionId sin .ndjson file** — edge: `state.json` resuelve session_id pero `logs/<session_id>.ndjson` no existe → comportamiento actual del CLI (verificar exit code real).
- **D-13:** **Verificar exit codes ACTUALES del CLI tal cual existen.** El test descubre los exit codes desde el comportamiento real del CLI hoy y los assertea. SC#3 dice "verificar exit codes deterministas", NO "definir nuevos". Si los exit codes actuales no son deterministas, el plan documentará la divergencia y el ejecutor decidirá si entra en scope o no — pero NO se rediseña en discuss-phase.
- **D-14:** **Multi-match (D-21 LOG-11)** queda fuera de scope. SC#3 no lo enuncia y aumentaría 1 test extra + setup complejo. Deferable a un plan de hardening si surge.

### Fate de `07-HUMAN-UAT.md` y MILESTONES.md (SC#4)

- **D-15:** **`07-HUMAN-UAT.md` reducido a redirect.** Sobrescribir el archivo con front-matter `status: superseded` + breve nota: "Los 3 UATs se automatizaron en Phase 17. Ver `test/<file>.test.js` para cada UAT". Preserva enlaces inversos y trazabilidad histórica. NO borrar.
- **D-16:** **MILESTONES.md v0.3 entry actualizada dentro de Phase 17 al cierre.** Touch mínimo: quitar mención de los 3 UATs como deferred y añadir referencia al phase 17. Cierra SC#4 dentro del scope de la fase en lugar de diferirlo a `/gsd-complete-milestone v0.5`.

### Claude's Discretion

Áreas donde el builder decide sin re-preguntar:

- **Naming de los 3 archivos test:** sugerencia `test/logs-follow-integration.test.js`, `test/session-start-event.test.js`, `test/session-of-resolver.test.js`. Patrón paralelo a `test/dispatcher-isolation.test.js`, `test/stop-state-transition.test.js`. El planner/executor escoge nombres definitivos; el contenido es lo que importa.
- **Helper `awaitLine()`:** vivirá inline en el primer test que lo use o en `test/_helpers.js` (si surgen 2+ usos). No crear infraestructura test compartida proactivamente.
- **Sentinels concretos del NDJSON de UAT-01:** `{event:'test.batch', seq:1}` o equivalente. Cualquier shape parseable que no choque con eventos canónicos del logger sirve.
- **Cleanup pattern:** `before/after` o `beforeEach/afterEach`, mkdtempSync por test o compartido por suite. Preferencia por aislamiento por test (sin contaminación cruzada) si el coste de setup es bajo.
- **stderr capture en los 3 tests:** capturar para debugging local pero no afirmar contenido (el contrato es exit code + stdout/NDJSON; stderr es prose).
- **Cómo verifica UAT-03 case 4** ("sessionId resolvido sin .ndjson file"): el plan determina si el comportamiento actual del CLI es razonable o si requiere un fix mínimo. Si requiere fix, el ejecutor escala antes de implementar.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §Phase 17 — goal + 5 success criteria + dependencies (Phase 16 estabiliza state.transition fixtures que UAT-02 referencia).
- `.planning/REQUIREMENTS.md` UAT-01/UAT-02/UAT-03 — contratos de los 3 tests.
- `.planning/milestones/v0.3-phases/07-kodo-logs-cli-event-taxonomy/07-HUMAN-UAT.md` — origen de los 3 UATs humanos. SE REDUCE a redirect en esta fase (D-15).

### Source files implicados (read-only, NO se modifican salvo D-15/D-16)
- `src/logs/follow.js` — `followFile(filePath, onLine)`, `FOLLOW_INTERVAL_MS=200`, SIGINT handler con `unwatchFile + process.exit(0)`. UAT-01 ejerce este path.
- `src/logs/session-lookup.js` — `resolveSessionIdFromTaskId(taskId)` two-step (state.json index → head-line scan). UAT-03 ejerce este path.
- `src/logs/head-line.js` — `readFirstLine(filePath)` consumido por session-lookup. UAT-03 indirect.
- `src/hooks/session-start.js` líneas 188-208 — emisión de `session.start` con los 6 campos D-10. UAT-02 ejerce este path. Outer `try { ... } catch {}` líneas 223-225 traga errores → D-10 fail-loud.
- `src/logger-events.js` — `EVENTS.SESSION_START`, helper `sessionStart(logger, fields)`. UAT-02 importa para asserts contra contrato (D-09).
- `src/cli.js` — definición del comando `logs --follow` y `logs --session-of`. UAT-01 y UAT-03 lo invocan via `bin/kodo`.
- `src/session/state.js` — `addSession()`, `loadState()`, `KODO_DIR = join(homedir(), '.kodo')` calculado al import-time. UAT-02 usa `addSession()`; los 3 tests dependen de que HOME override surta efecto en el child.

### Test patterns to mirror
- `test/stop-state-transition.test.js` — patrón **mkdtempSync + HOME override + import dinámico** (CR-02 Phase 16). Replicar literalmente para los 3 tests, adaptando al subprocess en lugar de import del módulo bajo test.
- `test/gsd-verify-integration.test.js` — patrón memSink + child setup + asserts NDJSON canon. Referencia para el shape de los asserts.
- `test/dispatcher.test.js` — fake logger / spy patterns existentes.
- `test/version-smoke.test.js` — precedente de spawn `bin/kodo` desde el test runner (sin mocking del CLI).

### Prior decisions a preservar
- **D-04 Phase 8 + D-16 Phase 10**: hook session-start está en inglés (parte del contrato session.start emitido). Asserts en UAT-02 deben coincidir con strings inglesas si se compara contenido.
- **D-21 LOG-11** (multi-match): Phase 17 lo deja fuera (D-14). El test de UAT-03 NO debe romper si en el futuro el resolver añade el comportamiento multi-match — afirmar mínimo estricto, no exhaustivo.
- **Phase 14 D-07** (`--json` byte-determinista): UAT-01 y UAT-03 NO usan `--json` (no aplica). Si el plan añade asserts sobre `--json` para reforzar SC, mantener el contrato byte-idéntico.
- **CR-02 Phase 16** (HOME override + import dinámico): contrato técnico replicado en D-02. Los imports de `state.js` (vía `addSession`/`loadState`) y cualquier módulo que computa paths derivados de `homedir()` al import-time deben hacerse DESPUÉS de fijar `HOME` en el `before` block. Tanto en el test runner como en el subprocess.

### Stack y test runner
- `.planning/codebase/TESTING.md` — `node:test` runner, `node:assert/strict`, `npm test = node --test test/**/*.test.js`. Sin frameworks externos, sin mocking library.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`addSession(session)`** y **`loadState()`** en `src/session/state.js` — UAT-02 los usa para pre-poblar `state.json` sintético. Se importan dinámicamente DESPUÉS de fijar HOME (CR-02 pattern).
- **`EVENTS.SESSION_START`** y **`sessionStart(logger, fields)`** en `src/logger-events.js` — UAT-02 los importa estáticamente (no dependen de HOME).
- **`process.execPath`** — node ejecutable que corre el test; usar como argv[0] del spawn garantiza paridad de versión.
- **`mkdtempSync(join(tmpdir(), 'kodo-uat-'))`** — primitiva nativa, no requiere helper.

### Established Patterns
- **mkdtempSync + HOME override + import dinámico** (`test/stop-state-transition.test.js:38-46`): patrón canónico para aislar `~/.kodo/`. UAT-01/02/03 lo replican adaptando a subprocess.
- **Fake logger memSink** (`test/gsd-verify-integration.test.js:73-83`): no aplica directamente a UAT-02 (el hook escribe NDJSON real al filesystem) pero el shape de los asserts (presencia de keys + tipos) es 1:1.
- **`silent on failure` en hooks** (`src/hooks/session-start.js:223-225`): obliga al test a fail-loud desde fuera (D-10).
- **Subprocess + bin/kodo** (`test/version-smoke.test.js`): precedente de spawn ejecutable desde el runner sin mocks.

### Integration Points
- **UAT-01 (`kodo logs --follow`)**: spawn `node bin/kodo logs <session-id> --follow` con HOME override → `followFile` lee `<tmpHome>/.kodo/logs/<session-id>.ndjson`. Test escribe progresivamente, child emite a stdout, test verifica con `awaitLine`. SIGINT cierra child.
- **UAT-02 (`session.start`)**: spawn `node src/hooks/session-start.js` con HOME override + stdin JSON `{ session_id, transcript_path }`. Hook lee `addSession`-pre-poblada session, emite NDJSON. Test verifica `<tmpHome>/.kodo/logs/<session-id>.ndjson` post-exit.
- **UAT-03 (`--session-of`)**: spawn `node bin/kodo logs --session-of <task-id>` con HOME override + state.json + logs/ pre-poblados. CLI ejecuta two-step resolver, sale con código determinista.

</code_context>

<specifics>
## Specific Ideas

- **Sentinels NDJSON UAT-01:** `{"event":"test.batch","seq":1,"timestamp":"<ISO>"}` con `seq` 1/2/3. Parseable como NDJSON canon, no choca con `EVENTS.*` reservados.
- **Stdin JSON UAT-02:** mínimo `{"session_id":"<known>","transcript_path":"/tmp/fake.jsonl"}`. El hook lee el resto desde state.json. Si el contrato del hook cambia y exige más campos en stdin, el test debe romper de forma reconocible (D-10).
- **Casos UAT-03 nombrados:** `step-1 hit`, `step-2 hit (state.json miss)`, `not-found`, `state-points-to-missing-log`. Usar como sufijos del `it()` para legibilidad.

</specifics>

<deferred>
## Deferred Ideas

- **UAT-01 path "waiting for session log to appear":** spawn primero, archivo después. Cubre la rama `existsSync(filePath) === false` de `followFile`. Fuera de SC#1 (que pide tail real, no descubrimiento). Plan de hardening separado.
- **UAT-02 variantes GSD full y quick:** session.start es invariante al modo según contrato. Cubrir si surge regresión que rompe la invarianza (no en este plan).
- **UAT-03 multi-match (D-21 LOG-11):** 2+ logs con misma task_id en head-line scan → warn stderr + escoger más reciente. SC#3 no lo enuncia. Deferable.
- **Override de `FOLLOW_INTERVAL_MS` por env:** aceleraría UAT-01 ~30% pero añade superficie de configuración test-only. No justificado.
- **Helper compartido `test/_helpers.js`:** crear si surgen 2+ usos de `awaitLine`/`spawnKodo`/etc. No proactivo.

</deferred>

---

*Phase: 17-phase-7-uat-automation*
*Context gathered: 2026-05-07*
