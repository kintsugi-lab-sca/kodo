# Phase 9: Phase Resolver + Bootstrap - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Detectar si el repo destino tiene `.planning/PROJECT.md`, parsear `ROADMAP.md`, resolver la fase correspondiente a la tarea Plane con match 1:1 estricto (fail-closed), inyectar el brief del bootstrap en `buildGsdContext` cuando `.planning/` falta, y entregar `kodo gsd inspect <task-id>` como dry-run del resolver. Cubre GSD-02, GSD-03, GSD-08, GSD-09.

**Queda fuera de Phase 9:** verificación de `VERIFICATION.md` en el orquestador (Phase 10), comentario Plane con phase_id resuelto (Phase 10), attachments de tareas Plane (diferido a v0.4), soporte multi-roadmap / monorepo (v2 GSD-F2).

</domain>

<decisions>
## Implementation Decisions

### Arquitectura del resolver
- **D-01:** Dos módulos separados:
  - `src/gsd/roadmap.js` — parser **puro**: `parseRoadmap(md)` → `{ phases: [{ n, title, heading, line }] }`. Sin I/O. Tests unitarios sin filesystem.
  - `src/gsd/resolver.js` — orquestación: `resolvePhase({ projectPath, task })` → lee filesystem, llama parser, aplica normalización, decide verdict. Tests con fixtures de directorios.
- **D-02:** `resolvePhase()` retorna un **discriminated union** sobre `action`:
  - `{ action: 'phase', phase_id, match_heading, match_reason }` — match 1:1 encontrado, ruta happy-path.
  - `{ action: 'bootstrap', reason: 'no-planning-dir' }` — `.planning/PROJECT.md` ausente (guard estricto de GSD-02).
  - `{ action: 'error', code, detail?, matches? }` — fail-closed; `code` ∈ `{ 'no-match', 'multi-match', 'roadmap-missing' }`.
  - Exhaustive `switch(result.action)` en consumidores (dispatcher, CLI inspect, logger-events formatters).
- **D-03:** El resolver corre **en el dispatcher** (`src/triggers/dispatcher.js`), inmediatamente después de adquirir el GSD lock y antes de llamar `launchWorkItem`. Paraleliza el patrón Phase 8 de threading `sessionId`: ahora también thread `phase_id` cuando `action === 'phase'`. Si `action === 'error'`, dispatcher **libera el lock GSD** y retorna `{ action: 'resolver_failed', code, detail }`.
- **D-04:** `kodo gsd inspect <task-id>` llama **la misma `resolvePhase()`** que el dispatcher — garantiza consistencia dispatcher/CLI. El CLI añade formatters humanos/JSON, pero la lógica es única.

### Parser ROADMAP.md
- **D-05:** Regex tolerante acepta niveles `##` y `###` (el ROADMAP actual usa `###`; la spec originalmente dice `##`, pero renombrar todos los headings es riesgo gratuito). Pattern tentativo: `/^(##{2,3})\s+Phase\s+(\d+(?:\.\d+)?)\s*[:\-]\s*(.+)$/gm`. Niveles `#` y `####` no se aceptan — reduce colisión con notas informales.
- **D-06:** Extracción de título: del heading `### Phase N: <title>` el parser extrae `<title>` limpio. El match compara **título limpio vs `task.title`** (no el heading completo). Rationale: humanos crean tasks Plane con sólo el título de la fase; exigir `'Phase N: <title>'` en task.title es fricción innecesaria.
- **D-07:** Normalización mínima para comparar: `trim() → collapse runs de whitespace → toLowerCase()`. **Nada más.** Puntuación y backticks se mantienen. Rationale: la spec dice "1:1 estricto"; stripping agresivo convierte dos fases con puntuación distinta en colisión. Si el título Plane tiene ' en vez de `, el humano corrige.
- **D-08:** Regex captura enteros Y decimales (`9`, `72.1`) — forward-compatible con `gsd-insert-phase`. Rangos tipo `Phase 1-5` en headings se ignoran explícitamente (no matchean el regex, no se añaden al `phases[]`).

### Bootstrap brief (GSD-08)
- **D-09:** Canal de entrega: **inline en `additionalContext`** del hook SessionStart. `buildGsdContext(session, { brief })` se extiende para recibir el brief opcional y renderizarlo antes de los comandos. Cero I/O extra, transcript completo lo preserva.
- **D-10:** Contenido del brief: `task.title` + `task.description` + `task.url`. Estructura:
  ```
  ## Project Brief

  **Task:** <task.ref> — <task.title>
  **Source:** <task.url>

  <task.description>
  ```
- **D-11:** Orden dentro de `buildGsdContext`: **brief primero, comandos después**. Claude lee contexto → ejecuta `/gsd-new-project`. Orden natural de lectura.
- **D-12:** `task.description` vacía (null/empty): inyectar solo título+URL con nota `(no description provided)`. Emitir `gsd.bootstrap` con field `brief_empty: true` para visibilidad en logs. No bloquea launch — `/gsd-new-project` tiene su propio flow interactivo.

### Failure modes
- **D-13:** 0 matches, >1 matches, y `ROADMAP.md` ausente (con `.planning/PROJECT.md` presente) → **todos bloquean el launch**. Dispatcher recibe `{ action: 'error', code }`, libera lock GSD, retorna `{ action: 'resolver_failed', code, detail }`. Fail-closed alineado con GSD-03 success criteria #2.
- **D-14:** Evento `gsd.phase.resolved` se emite en ambos casos: con `matched: true, phase_id` cuando el resolver acierta; con `matched: false, error_code, detail` cuando falla. Una sola entry por dispatch, útil para `kodo logs` forense.
- **D-15:** El humano resuelve el error corrigiendo el título Plane o el ROADMAP, y dispara de nuevo el webhook. No hay comentario Plane automático en Phase 9 (eso vive en Phase 10 — GSD-06 cubre el comentario de resultado de verificación; el comentario de error de resolver también puede encajar allí).

### `kodo gsd inspect <task-id>` CLI
- **D-16:** Formato por defecto: **humano**. Secciones: (1) task resolution (ref, title, labels, project path resuelto), (2) presencia `.planning/PROJECT.md`, (3) verdict del resolver (phase/bootstrap/error con detalle), (4) **preview del `buildGsdContext` renderizado** (exactamente lo que se inyectaría en la sesión Claude).
- **D-17:** Flag `--json` emite el verdict estructurado completo (misma forma que el discriminated union de `resolvePhase()` más metadata: task ref, project_path, brief). Scriptable.
- **D-18:** Dry-run estricto — **no toca lock, state, ni cmux**. No adquiere ni chequea el GSD lock. Pure read-only. Rationale: `inspect` se usa para debugging durante troubleshooting; que nunca cause side effects es una invariante.
- **D-19:** Exit codes: `0` si `action === 'phase'` o `'bootstrap'`; `1` si `action === 'error'`. Permite scripts tipo `kodo gsd inspect PLA-42 && webhook-fire`.

### Claude's Discretion
- Nombre del flag `action` para el error dispatcher (`resolver_failed` es sugerencia; planner puede consolidar con otros errores si la tabla crece).
- Formato exacto del header del preview en `kodo gsd inspect` (separadores, colores si el TTY lo soporta).
- Si `parseRoadmap` también expone el `## Progress` table o solo el listado de phases (depende de si hace falta para algo más).
- Organización de tests: unit del parser con fixtures markdown, integración del resolver con directorios temp.

### Folded Todos
No hay todos pendientes relevantes para Phase 9 (matcher devolvió 0).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contexto GSD acumulado (fases previas de v0.3)
- `.planning/phases/08-gsd-label-session-plumbing/08-CONTEXT.md` — Lock GSD, `phase_id?` field ya en SessionRecord (D-11 de Phase 8, vacío hasta ahora), `buildGsdContext` bifurca en `session.phase_id`. Phase 9 llena el campo y extiende el hook para recibir brief.
- `.planning/phases/07-kodo-logs-cli-event-taxonomy/07-CONTEXT.md` — Event helpers `gsdPhaseResolved` y `gsdBootstrap` ya definidos en `src/logger-events.js`. Phase 9 los emite desde dispatcher/hook.
- `.planning/phases/06-structured-logger-foundation/06-CONTEXT.md` — Contrato del logger (NDJSON, redactor, campos).

### Requisitos y roadmap
- `.planning/REQUIREMENTS.md` — GSD-02, GSD-03, GSD-08, GSD-09 (bootstrap detection, ROADMAP parser, brief channel, title inference).
- `.planning/ROADMAP.md` §"Phase 9: Phase Resolver + Bootstrap" — Goal + success criteria 1-4 (incluye `kodo gsd inspect`).
- `.planning/PROJECT.md` — Zero runtime deps, provider-agnostic.

### Código existente que Phase 9 toca o integra
- `src/triggers/dispatcher.js` (199 líneas) — Guard chain tras GSD lock acquisition. Phase 9 añade llamada al resolver después de `acquireGsdLockFn` y antes de `launchWorkItemFn`. Thread `phase_id` + `brief` vía `opts`.
- `src/session/manager.js` (276 líneas) — `buildSessionFromTask` (añadir `phase_id` al record si llega en params), `launchWorkItem` (aceptar `phase_id`/`brief` en `opts`).
- `src/session/state.js` — `Session` typedef ya tiene `phase_id?` (Phase 8 D-11). Añadir `brief?` si se persiste, o pasarlo transitoriamente (dispatcher → manager → hook-via-session-lookup).
- `src/hooks/session-start.js` (208 líneas) — `buildGsdContext` se extiende para recibir y renderizar brief. Actualmente ya bifurca en `session.phase_id`. La emisión de `gsd.phase.resolved` (líneas 180-181) se movería al dispatcher donde vive la resolución real; el hook solo emitiría `session.start` + opcional `gsd.bootstrap` si `!phase_id`.
- `src/logger-events.js` — Helpers `gsdPhaseResolved` (línea 143) y `gsdBootstrap` (línea 155) ya definidos. Phase 9 los invoca desde dispatcher.
- `src/cli.js` — Registrar nuevo subcomando `kodo gsd inspect <task-id>` con flag `--json`. Sigue el patrón de `kodo logs` (Phase 7).
- `src/providers/plane/provider.js` — Ya expone `task.description` y `task.url` (no requiere cambios).
- `src/labels.js` — `parseKodoLabels` ya emite `flags: ['gsd']` (sin cambios).
- `src/gsd/lock.js` (222 líneas) — Phase 9 libera lock adicional en el camino de error del resolver.

### Nuevos archivos que Phase 9 crea
- `src/gsd/roadmap.js` — parser puro.
- `src/gsd/resolver.js` — orquestación.
- `src/cli/gsd-inspect.js` (o inline en `cli.js`) — CLI subcommand.
- Tests: `test/gsd-roadmap.test.js`, `test/gsd-resolver.test.js`, `test/gsd-inspect-cli.test.js`, y extensión de `test/dispatcher.test.js` con casos de resolver failure + lock release.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `acquireGsdLock` / `releaseGsdLock` (`src/gsd/lock.js`) — Ya con semántica idempotente y TTL. Phase 9 solo añade un call path de release en el caso `resolver_failed` del dispatcher (similar al WR-01 fix de Phase 8).
- `buildGsdContext` (`src/hooks/session-start.js:77`) — Ya bifurca en `session.phase_id`. Phase 9 extiende la signature para aceptar `brief` opcional y renderizarlo en el bloque `no phase_id` (bootstrap).
- `buildSessionFromTask` (`src/session/manager.js:25`) — Factory pura extensible. Añadir `phase_id` y (si se decide persistir) `brief` es aditivo.
- Event helpers `gsdPhaseResolved`, `gsdBootstrap` (`src/logger-events.js:143-155`) — listos, Phase 9 solo los llama.
- `resolveProjectPath` (`src/session/manager.js:54`) — Ya exportada y usada por el dispatcher para el lock (Phase 8). Phase 9 reusa el mismo path resuelto para detectar `.planning/PROJECT.md`.
- Pattern de threading vía `opts` entre dispatcher → launchWorkItem (sessionId de Phase 8 CR-01) — Phase 9 clona el pattern para `phase_id` y `brief`.

### Established Patterns
- ES modules, factory functions sobre classes, JSDoc `@param`/`@returns`.
- Guards en dispatcher retornan `{ action: '<name>', ...info }` — Phase 9 añade `'resolver_failed'`.
- DI en dispatcher vía `DispatchDeps` — Phase 9 añade `resolvePhaseFn` al object para testabilidad sin filesystem.
- Hook files con best-effort try/catch silencioso — el render del brief sigue la convención.
- CLI subcommands en `cli.js` usando commander, con flags aditivos tipo `kodo logs --json`, `--follow` (Phase 7).

### Integration Points
- **Dispatcher:** nuevo call tras `acquireGsdLockFn`. Si falla el resolver, release + return `{ action: 'resolver_failed' }`. Si acierta, thread `phase_id` y `brief` en `launchOpts` (paralelo a `sessionId`).
- **Manager:** `launchWorkItem` acepta `opts.phase_id` y `opts.brief`, los pasa a `buildSessionFromTask`.
- **State typedef:** `Session` ya tiene `phase_id?`; decidir si añadir `brief?` persistente o pasarlo transitoriamente vía el render inicial del hook (el hook lee `findSession()` que retorna el record — si `brief` se persiste, el hook lo recoge allí).
- **Hook SessionStart:** `buildGsdContext(session, { brief: session.brief })` renderiza el bloque adicional. Emisión de `gsd.phase.resolved` migra al dispatcher (fuente de verdad del resolver).
- **CLI:** nuevo comando `kodo gsd inspect <task-id>` con `--json` opt-in. Dry-run puro (sin lock, sin state, sin cmux).

</code_context>

<specifics>
## Specific Ideas

- El ROADMAP.md actual del propio kodo usa `###` headings (`### Phase 6:`, `### Phase 7:`, etc.) — el parser tiene que funcionar con el formato real del repo donde vive. Tests unitarios deben cubrir `##` y `###` como fixtures válidos; `#` y `####` como fixtures rechazados.
- El discriminated union permite que `kodo gsd inspect` imprima mensajes específicos por `error.code`: `no-match` → "Title '<task.title>' did not match any Phase heading"; `multi-match` → "Title '<task.title>' matched N phases: [list]"; `roadmap-missing` → "ROADMAP.md not found at <path>".
- El preview de `buildGsdContext` dentro de `inspect` debe renderizarse con un `session` sintético (no requiere crear estado real). Usa los mismos campos que el dispatcher construiría.
- Eventos `gsd.phase.resolved` con `matched: false` llevan `error_code` en el NDJSON → `kodo logs --event gsd.phase.resolved` se convierte en la herramienta forense principal para investigar dispatches fallidos.
- La transición del emit `gsd.phase.resolved` del hook (líneas 180-181 de `session-start.js`) al dispatcher es un refactor con cuidado: el hook ya no debe emitirlo (duplicado si se mantiene); solo emite `session.start` y `gsd.bootstrap` si `!phase_id`.

</specifics>

<deferred>
## Deferred Ideas

- **Attachments de tareas Plane en el brief** — Requiere extender `TaskItem` interface (contrato v0.2), añadir llamada API a Plane para listar attachments, política de entrega (URLs, download, paths). Candidato fuerte para **v0.4**; anotar como ADP-like requirement cuando llegue.
- **Comentario automático Plane ante error de resolver** — GSD-06 en Phase 10 cubrirá comentarios de outcome de verificación; el comentario de "title mismatch" puede encajar allí o en post-milestone si el patrón se repite.
- **Normalización agresiva de títulos (strip puntuación, diacríticos)** — Rechazada por debilitar el 1:1 estricto. Si surgen falsos negativos frecuentes, reevaluar como feature opt-in con flag `--fuzzy-match` en v0.4.
- **Soporte multi-roadmap (monorepo `.planning/` roots)** — GSD-F2 v2 requirement. Out of scope v0.3.
- **Persistencia del brief en disco** — Rechazada (inline en additionalContext es suficiente, evita ensuciar `.planning/`).
- **Auto-crear tarea Plane siguiente al completar fase** — GSD-F3 v2.

</deferred>

---

*Phase: 09-phase-resolver-bootstrap*
*Context gathered: 2026-04-20*
