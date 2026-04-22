# Phase 10: Orchestrator Verification Gate - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Introducir el verification gate GSD en el orquestador: (a) extender `src/orchestrator/prompt.md` con una sección condicional que instruya al orquestador a reconocer sesiones GSD y leer `PROJECT.md` + `ROADMAP.md` + `phases/<n>/PLAN.md` cuando procede (GSD-07); (b) entregar un nuevo CLI determinista `kodo gsd verify <session-id>` que parsea el frontmatter de `.planning/phases/<n>/VERIFICATION.md`, computa un verdict discriminado (`pass` / `fail` / `missing` / `malformed`) y ejecuta el comentario + transición de estado en Plane vía `TaskProvider` (GSD-05, GSD-06); (c) emitir el evento `orchestrator.review` en el log NDJSON con el verdict completo. El gate es invocado por el orquestador Claude en su ronda de supervisión siguiente al cierre de la sesión GSD.

**Queda fuera:** adapters nuevos (GitHub/ClickUp/local) — v0.4+; transición automática a Done tras pass — REQUIREMENTS.md out-of-scope; slash-command re-trigger desde comentario Plane — GSD-F1 v2; multi-phase per task — GSD-F3 prohibido; file watcher sobre `VERIFICATION.md` — ADP-F5 scope creep; dashboard web del verdict — out-of-scope (NDJSON + `kodo logs --event orchestrator.review` cubren la necesidad).

</domain>

<decisions>
## Implementation Decisions

### Arquitectura del gate
- **D-01:** Nuevo CLI `kodo gsd verify <session-id>` como locus determinista del gate. Paralelo al patrón `kodo gsd inspect` de Phase 9 (D-04): misma interfaz `kodo gsd <verb> <arg>`, mismo tipo de handler thin-cli + módulo (`src/cli/gsd-verify.js` + `src/gsd/verify.js`).
- **D-02:** El orquestador Claude (singleton `launchOrchestrator`) es el actor que invoca el CLI. No el hook `stop`, ni la propia sesión GSD. El orquestador es el único supervisor y mantiene el lifecycle de decisiones post-sesión (alineado con `prompt.md:31-45`).
- **D-03:** kodo core escribe Plane. El CLI usa `getProvider()` + `TaskProvider.addComment(task, markdown)` + `TaskProvider.updateTaskState(task, stateName)`. Determinista, auditable (`plane.api.call` en NDJSON), provider-agnostic para futuros adapters.
- **D-04:** Disparo: al final de sesión GSD. El hook `stop.js` (líneas 116-125) ya envía un nudge al orquestador al cerrar cualquier sesión; Phase 10 extiende ese nudge para mencionar que si la sesión era GSD (`session.gsd === true`), el orquestador debe correr `kodo gsd verify <session-id>` en su próxima ronda. No se introduce un segundo canal de notificación.

### Parser y contrato de VERIFICATION.md
- **D-05:** El parser lee exclusivamente el **frontmatter YAML** del archivo. No escanea la tabla de must-haves ni checkboxes `[x]/[ ]`. Rationale: el frontmatter es la representación machine-readable canónica que ya emite `gsd-verify-work` / `gsd-nyquist-auditor`; la tabla es prosa para humanos.
- **D-06:** Contrato mínimo fijo de campos obligatorios: `status`, `must_haves_total`, `must_haves_verified`, `gaps_count`. Cualquier campo extra (p.ej. `requirements[]`, `human_verification_needed`, `re_verification`) se ignora para el verdict pero se conserva en el `detail` del log. Si falta uno de los 4 obligatorios → verdict `malformed`.
- **D-07:** Gate pass exige las tres condiciones simultáneas: `status === 'passed'` AND `must_haves_verified === must_haves_total` AND `gaps_count === 0`. Cualquier desviación → fail.
- **D-08:** Archivo ausente (`.planning/phases/<padded>-<slug>/<padded>-VERIFICATION.md` no existe) → verdict `missing`. Fail-closed alineado con Phase 9 D-13. El CLI NO auto-genera stub.
- **D-09:** Valores válidos de `status` (conjunto cerrado): `passed` → `pass`, `gaps_found` → `fail`, `failed` → `fail`. Cualquier otro valor → `malformed` (p.ej. `in_progress`, typo, vacío).

### Verdict y flujo Plane
- **D-10:** Verdict = **discriminated union** sobre `action`:
  - `{ action: 'pass', phase_id, must_haves, requirements_verified }`
  - `{ action: 'fail', phase_id, reason: 'gaps-found' | 'must-haves-incomplete' | 'status-failed', detail }`
  - `{ action: 'missing', phase_id }`
  - `{ action: 'malformed', phase_id, detail: 'missing field X' | 'unknown status Y' | ... }`
  - Consumidores (CLI output, logger-events formatter, plantilla Plane) usan `switch(verdict.action)` exhaustivo.
- **D-11:** Pass → kodo llama `updateTaskState(task, config.states.review)` + `addComment`. La transición a Done queda en manos del humano (mantener checkpoint, invariante REQUIREMENTS.md).
- **D-12:** `fail` / `missing` / `malformed` → kodo **NO llama `updateTaskState`** (no-op en state de la tarea; queda donde esté). Solo `addComment` con el motivo estructurado. El humano corrige `VERIFICATION.md` y re-dispara.
- **D-13:** Re-run manual: el humano edita `VERIFICATION.md` y re-dispara el flujo vía webhook Plane (cambio de estado manual). kodo no polls ni watcha.

### Comentario Plane
- **D-14:** Se postea **siempre**, en pass y fail. Cumple literal de GSD-06 ("kodo comenta con el phase_id y el resultado"). Minimiza ambigüedad ("¿corrió el gate?" se resuelve mirando Plane).
- **D-15:** Formato: **plantilla markdown determinista generada por kodo** (no LLM). Mismo verdict → mismo comentario byte-a-byte (excepto timestamp). Greppable en Plane, auditable. Prohibido delegar la redacción al orquestador Claude (perdemos determinismo).
- **D-16:** **Idioma: español.** Consistente con `src/orchestrator/prompt.md`, notificaciones cmux de `stop.js` ("sesión cerrada"), y el lenguaje operativo del proyecto. Excepción consciente respecto a Phase 8 D-04 (que usa inglés en `buildGsdContext`): el canal es distinto — el comentario Plane lo lee un humano operador, no un agente.
- **D-17:** Fallback si la API de Plane falla: el CLI emite `plane.api.call` con `level: 'error'` + `orchestrator.review` con el verdict resuelto (el parse local sigue siendo válido aunque el POST falle). El orquestador detecta el error via stderr/log y decide reintentar con su MCP. El verdict NUNCA se pierde (está en NDJSON).

### Canal de metadata GSD al orquestador
- **D-18:** Lookup desde `~/.kodo/state.json`. El `SessionRecord` ya persiste `gsd: boolean`, `phase_id: string`, `project_path: string`, `session_id: string` (Phase 8 D-10/D-11 + Phase 9 D-09). El orquestador filtra `sessions[*].gsd === true` para identificar GSD. Zero nuevos canales; zero migración.
- **D-19:** Extender `src/orchestrator/prompt.md` con **una sección GSD condicional en el mismo archivo** (sin bifurcar en `prompt-gsd.md`, sin skill separada). Indica: "si `session.gsd === true`, cuando detectas la sesión en Review, corre `kodo gsd verify <session-id>` y actúa según el verdict". Una sola fuente de instrucciones para el orquestador.
- **D-20:** Firma del CLI: `kodo gsd verify <session-id>` (session-id único, posicional obligatorio). El CLI resuelve `phase_id` + `project_path` desde `findSession({ sessionId })` (src/session/state.js, Phase 9 D-09 lo usa en hook). Alineado con la invariante CR-01 de Phase 8 (session-id como identidad end-to-end). NO se ofrece modo `--phase N --project PATH` en Phase 10 — diferido al backlog.
- **D-21:** Artefactos (`PROJECT.md`, `ROADMAP.md`, `PLAN.md`) los lee el orquestador Claude directamente con su tool `Read` (ya tiene acceso al filesystem vía cmux/Read en su workspace). El CLI NO embebe ni rutea contenido de estos archivos: retorna solo el verdict. Respeta el espíritu de Phase 9 D-18 (CLI determinista, read-only/side-effect-bound, sin payload inflado).

### Claude's Discretion
- Nombre exacto de los `reason` en `{ action: 'fail', reason }` (`gaps-found`, `must-haves-incomplete`, `status-failed` son sugerencias; planner puede consolidar o ampliar según tests).
- Implementación del parser YAML frontmatter: hand-rolled con regex + `split` + `JSON.parse` post-normalización vs. mini-parser línea-a-línea. Solo 4 campos fijos, ambos son viables en zero-deps. Planner decide.
- Exit codes del nuevo CLI: opción A — `0` si el gate corrió entregando cualquier verdict / `1` si error interno (state.json no legible, session-id no encontrado) / `2` si error de fetch/provider (paralelo a Phase 9 D-19). Opción B — `0` solo si `verdict.action === 'pass'`, `1` si cualquier otro verdict (unix-friendly, facilita scripting). Planner evalúa la mejor semántica con un test table.
- Detalle estético de la plantilla ES (emoji ✅/❌, prefijos `[kodo:gsd]`, orden de bullets, inclusion o no de link a `VERIFICATION.md` relativo).
- Idempotencia del comentario: si el orquestador re-invoca el CLI para una misma sesión, ¿detectar último comentario y deduplicar? En práctica el orquestador no re-invoca tras ver outcome; refinamiento diferible.
- Mecanismo exacto por el que el orquestador "detecta sesión en Review": `cmux read-screen` del workspace / `state.json.status === 'review'` / nudge del hook stop. Planner decide — recomendación: reutilizar el nudge existente de `stop.js:116-125` extendido con el flag GSD.
- Organización de tests: parser puro en `test/gsd-verification.test.js`, CLI con TaskProvider mock en `test/gsd-verify-cli.test.js`, side-effects Plane en suite de integración separada si hace falta.

### Folded Todos
No se identificaron todos pendientes relevantes para Phase 10 (matcher devolvió 0 en la consulta inicial).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contexto GSD acumulado (fases previas de v0.3)
- `.planning/phases/07-kodo-logs-cli-event-taxonomy/07-CONTEXT.md` — Helper `orchestratorReview(logger, { phase_id, verdict, reason })` ya definido en `src/logger-events.js` (D-09 de Phase 7). Phase 10 lo invoca desde `src/gsd/verify.js`. Componente `orchestrator` reservado en la taxonomía (D-15).
- `.planning/phases/08-gsd-label-session-plumbing/08-CONTEXT.md` — `SessionRecord.gsd: boolean` (D-10), `phase_id?: string` (D-11), `buildSessionFromTask` ya setea `gsd` desde flags (D-12). Convención slash-commands `gsd-*` (D-02). Idioma del hook en inglés (D-04) — Phase 10 elige español explícitamente para el comentario Plane (canal operador-humano, no agente).
- `.planning/phases/09-phase-resolver-bootstrap/09-CONTEXT.md` — Patrón thin-cli + handler module (D-04, Plan 09-05). Discriminated union verdict (D-02). Fail-closed para ambigüedad (D-13). Exit codes 0/1/2 (D-19). Dispatcher como fuente única de eventos (D-14). Dry-run read-only (D-18). `session.phase_id` + `session.brief` ya persistidos (D-09).

### Requisitos y roadmap
- `.planning/REQUIREMENTS.md` — GSD-05 (orquestador inspecciona VERIFICATION.md, bloquea), GSD-06 (kodo comenta con phase_id + resultado), GSD-07 (metadata GSD al spawnearse + carga artefactos). Out-of-scope explícito: auto-Done, multi-phase per task.
- `.planning/ROADMAP.md` §"Phase 10: Orchestrator Verification Gate" — Goal + success criteria 1-3. Depende de Phase 9.
- `.planning/PROJECT.md` — Zero runtime deps (parser YAML hand-rolled), provider-agnostic (`TaskProvider.addComment`/`updateTaskState` genéricos), orquestador como singleton, 0 tokens en vigilante.

### Código existente que Phase 10 toca o integra
- `src/orchestrator/prompt.md` (72 líneas) — Extender con sección "### GSD Sessions" condicional. Placeholders `{{provider}}`/`{{provider_name}}`/`{{mcp_tool}}` ya se resuelven vía `resolvePromptTemplate` (`launch.js:21`).
- `src/orchestrator/launch.js` (126 líneas) — `buildContextSummary` (línea 108) lista sesiones activas. Phase 10 la extiende para incluir `[GSD phase N]` junto al `task_ref` cuando `session.gsd === true`.
- `src/cli.js` — Registrar nuevo subcomando `kodo gsd verify <session-id>`. Patrón de Phase 9 Plan 09-05: subcomando anidado `.command('gsd').command('verify <session-id>')` delega en handler.
- `src/cli/gsd-inspect.js` (~existente, Phase 9) — Referencia del patrón: thin-cli con `runGsdInspect` handler modular. Phase 10 clona como `src/cli/gsd-verify.js` + `runGsdVerify`.
- `src/hooks/stop.js` (174 líneas) — Nudge al orquestador (líneas 116-125): `"La sesión ${task_ref} ha terminado y está en Review. Revisa el resultado..."`. Phase 10 lo condiciona: si `session.gsd`, añadir "ejecuta `kodo gsd verify <session-id>`".
- `src/session/state.js` — `findSession({ sessionId })` ya exportado y usado por `hook stop.js:45` + (via Phase 9) hook session-start. Phase 10 lo invoca desde `src/gsd/verify.js`.
- `src/providers/registry.js` + `src/interface.js` — `getProvider()` factory + `TaskProvider` typedef. `addComment(task, markdownText)` + `updateTaskState(task, stateName)` ya existen (Phase 2/3). Phase 10 no modifica la interfaz.
- `src/providers/plane/provider.js` (253 líneas) — Implementación concreta de `addComment` (líneas 182-185, convierte markdown→`<p>...<br>...</p>`) + `updateTaskState` (líneas 162-180). Phase 10 las consume sin cambios.
- `src/config.js` — `loadConfig()` expone `config.states.review`/`done`/`trigger`. Phase 10 usa `config.states.review` para la transición en el verdict `pass`.
- `src/logger-events.js` — `orchestratorReview` helper (Phase 7 D-09). Firma `{ phase_id, verdict, reason }`. Phase 10 lo invoca desde `src/gsd/verify.js`.

### Nuevos archivos que Phase 10 crea
- `src/gsd/verification.js` — Parser puro del frontmatter YAML + cómputo de verdict. Zero I/O. Exports: `parseVerificationFrontmatter(md) → { status, must_haves_total, must_haves_verified, gaps_count }`, `computeVerdict(parsed, phase_id) → Verdict` (discriminated union).
- `src/gsd/verify.js` — Orquestación: resuelve `session` desde session-id, lee `VERIFICATION.md` de `${session.project_path}/.planning/phases/${padded}-<slug>/${padded}-VERIFICATION.md`, llama `computeVerdict`, postea comentario + transición vía `TaskProvider`. Emite `orchestratorReview`.
- `src/cli/gsd-verify.js` — Thin handler CLI (paralelo a `src/cli/gsd-inspect.js`). `runGsdVerify({ sessionId, json })` delegando en `src/gsd/verify.js`.
- Tests:
  - `test/gsd-verification.test.js` — Parser puro con fixtures markdown (frontmatter válido/inválido/faltante).
  - `test/gsd-verify-cli.test.js` — CLI con `TaskProvider` mock; assert side-effects (addComment llamado con markdown determinista, updateTaskState llamado solo en pass).
  - `test/gsd-verify-integration.test.js` — Integración con state.json temp + `.planning/` sintético.
  - Extensión de `test/orchestrator-prompt.test.js` si existe, o nuevo, validando la sección GSD del prompt renderizado.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `findSession({ sessionId, cwd })` (`src/session/state.js`) — resolver SessionRecord. Ya usado en `stop.js:45` y (vía Phase 9) en hook session-start. Phase 10 lo invoca desde `src/gsd/verify.js` para obtener `phase_id` + `project_path` + `task_id`.
- `getProvider()` + `TaskProvider.addComment(task, markdown)` + `TaskProvider.updateTaskState(task, stateName)` — interfaz provider-agnostic (Phase 2/3). Phase 10 la consume, no la extiende. Nota: `addComment` requiere un `task` completo, no solo el ref — verify.js necesita `TaskProvider.getTask(task_ref)` previo.
- `orchestratorReview(logger, { phase_id, verdict, reason })` (`src/logger-events.js`) — helper listo, Phase 7 D-09. Phase 10 lo llama una vez por run (pass o fail).
- Patrón thin-cli + handler module (Phase 9 `src/cli/gsd-inspect.js` + `runGsdInspect`) — Phase 10 clona como `gsd-verify.js`.
- `resolvePromptTemplate` (`src/orchestrator/launch.js:21`) — ya reemplaza placeholders; Phase 10 añade texto nuevo al prompt.md sin necesidad de nuevos placeholders (usa `{{provider}}`/`{{provider_name}}` existentes donde mencione el sistema).
- `config.states.review` (`src/config.js`) — nombre del estado "Review" configurable por proyecto.

### Established Patterns
- ES modules, factory functions, JSDoc `@param`/`@returns`.
- CLI subcomandos GSD: `kodo gsd inspect <task-id>` (Phase 9) — Phase 10 sigue literal: `kodo gsd verify <session-id>`.
- Discriminated union sobre `action` con switch exhaustivo (Phase 9 D-02).
- Fail-closed: archivo ausente o ambigüedad → error visible con verdict explícito (Phase 9 D-13).
- Zero runtime deps: parser YAML hand-rolled para 4 campos (acepta `clave: valor` / `clave: "valor"` / números enteros).
- DI logger via `.child({ component: 'gsd' })` en `src/gsd/verify.js` (Phase 7 D-15).
- Prompt.md en español; `buildGsdContext` en inglés (Phase 8 D-04); comentario Plane en español (D-16 de esta fase).
- Tests con `node --test`, fixtures en tmp dir con cleanup.

### Integration Points
- **Orquestador Claude (prompt.md):** añadir sección `### Sesiones GSD` después de `## Responsabilidades` o dentro de `### 4. Gestionar ciclo de vida`. Instrucción: "Si `session.gsd === true`: cuando la sesión está en Review, lee `PROJECT.md` + `ROADMAP.md` + `phases/N/PLAN.md` del `project_path`; después ejecuta `kodo gsd verify <session-id>` y actúa según el verdict del stdout (pass → continúa; fail/missing/malformed → el comentario ya se posteó, no hagas nada manual)."
- **Orquestador (launch.js):** `buildContextSummary` muestra `[GSD phase <n>]` junto al `task_ref` cuando `session.gsd === true`. Mínima instrumentación para que el orquestador las identifique sin parsear state.json él mismo.
- **stop.js:** línea ~122 extiende el `text` del `cmux.send` para el orquestador: si `session.gsd`, el mensaje incluye "ejecuta `kodo gsd verify ${session.session_id}`". No cambia lógica del hook; solo texto.
- **CLI (src/cli.js):** nuevo subcomando `.command('gsd').command('verify <session-id>')` con flag `--json` (scriptable) y posiblemente `--dry-run` (imprime verdict sin postear a Plane, útil para debugging humano — Claude's Discretion).
- **TaskProvider consumption:** `verify.js` llama `provider.getTask(task_ref)` → `addComment(task, markdown)` → `updateTaskState(task, config.states.review)` (solo pass). Errores de API: logueados, no bloquean emisión del log `orchestrator.review`.
- **Log events:** `orchestratorReview` emitido en todas las ramas del verdict (tras postear o intentar postear). `plane.api.call` lo emiten las APIs del TaskProvider vía su `.child({ component: 'plane' })` ya instrumentado.

</code_context>

<specifics>
## Specific Ideas

- La plantilla ES del comentario **pass**:
  ```
  ✅ Phase N verificada — <phase_name>

  - Must-haves: X/X verificados
  - Gaps: 0
  - Transicionada a Review

  Ver: `.planning/phases/<padded>-<slug>/<padded>-VERIFICATION.md`
  ```
- La plantilla ES del comentario **fail** (según reason):
  - `gaps-found`: "❌ Phase N bloqueada — <phase_name>. Motivo: gaps_count=<N>. Corrige VERIFICATION.md y re-dispara."
  - `must-haves-incomplete`: "❌ Phase N bloqueada — must_haves_verified (<V>) < must_haves_total (<T>)..."
  - `status-failed`: "❌ Phase N bloqueada — status=<X>. Revisa el artefacto..."
- **missing**: "⚠️ VERIFICATION.md no encontrado para Phase N (<phase_name>). Ejecuta `/gsd-verify-work` y re-dispara."
- **malformed**: "⚠️ VERIFICATION.md presente pero frontmatter inválido: <detail>. Corrige y re-dispara."
- El verdict `{ action, reason, detail }` se serializa al NDJSON vía `orchestratorReview` con `verdict = action` y `reason` literal; el `detail` va en el contexto del log event para grep forense (`kodo logs --event orchestrator.review --json | jq '.reason,.detail'`).
- El orquestador detecta "sesión en Review" vía el nudge explícito del hook stop (ya existente, solo se extiende el texto). Preferido sobre polling de `state.json` — evita race conditions.
- El CLI es invocable manualmente por un humano para debugging: `kodo gsd verify abc-123 --json` imprime el verdict estructurado. Útil cuando el orquestador no está corriendo o para tests de sanity.
- Referencia a `kodo gsd inspect` en la sección GSD del prompt: "Si dudas de la resolución de fase antes del verify, puedes correr `kodo gsd inspect <task-id>` (dry-run del resolver)".
- El comentario Plane se postea una vez por dispatch; si el orquestador re-ejecuta el CLI (por error transitorio), se postea de nuevo — **aceptamos** el duplicado ocasional sobre la complejidad de una API de idempotencia en v0.3 (ver Deferred).
- El formato de `task_ref` en el comentario usa la convención de Plane (`KL-42`) que `provider.getTask` retorna en el `TaskItem.ref`.

</specifics>

<deferred>
## Deferred Ideas

- **Idempotencia estricta del comentario Plane** — Detectar último comentario de kodo en la tarea y dedup. En la práctica el orquestador no re-invoca si vio outcome; añadir sólo si se observa ruido en Plane. Backlog.
- **`kodo gsd verify --phase N --project PATH` sin session-id** — Modo filesystem-puro para debugging humano desde fuera del flujo normal. Phase 10 se limita al canal automatizado (session-id único). Backlog.
- **`kodo gsd verify --dry-run`** — Imprime verdict sin postear a Plane. Útil para testing pero expande superficie; Claude's Discretion para planner si lo considera barato.
- **Transición automática a Done tras pass** — Prohibido por REQUIREMENTS.md out-of-scope (humano mantiene checkpoint final).
- **Slash command re-trigger desde comentario Plane** — GSD-F1 v2.
- **Multi-phase per task** — GSD-F3/out-of-scope.
- **File watcher sobre `VERIFICATION.md`** — Scope creep hacia ADP-F5.
- **Comentarios Plane ricos (badges, mermaid, tablas)** — Plane markdown se serializa a HTML con `<p>`/`<br>` simple (ver `plane/provider.js:182-185`); tablas y badges no renderizan bien. Plantilla lineal es suficiente.
- **Dashboard/UI web del verdict** — `kodo logs --event orchestrator.review` + pipe a `jq` cubre la necesidad. Duplicaría infra.
- **Multi-roadmap / monorepo** — GSD-F2 v2.
- **Parser completo YAML (con anclas, alias, multilíneas)** — 4 campos fijos; escalas opcionales (JS-YAML) violarían zero-deps. Si surge necesidad de campos complejos, reevaluar en v0.4.
- **Reviewed todos (no folded)** — Ningún todo fue marcado como relevante al inicio; no hay items a listar aquí.

</deferred>

---

*Phase: 10-orchestrator-verification-gate*
*Context gathered: 2026-04-21*
