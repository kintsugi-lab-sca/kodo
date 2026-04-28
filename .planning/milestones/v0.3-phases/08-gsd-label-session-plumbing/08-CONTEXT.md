# Phase 8: GSD Label + Session Plumbing - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Propagar el flag `kodo:gsd` desde la label de la tarea hasta la sesión de Claude Code (`SessionRecord.gsd = true`), inyectar instrucciones GSD condicionadas en el hook SessionStart, y proteger contra sesiones GSD concurrentes en el mismo repo con un lock file. Cubre GSD-01, GSD-04, GSD-10.

**Queda fuera de Phase 8:** Phase resolver + ROADMAP.md parser (Phase 9), orchestrator verification gate (Phase 10), bootstrap de `.planning/` (Phase 9 — Phase 8 solo prepara el placeholder de inyección).

</domain>

<decisions>
## Implementation Decisions

### Inyección GSD en hook (GSD-04)
- **D-01:** Placeholder condicionado en `session-start.js`: si `session.phase_id` existe → inyecta la cadena de comandos GSD (`/gsd-plan-phase <n>` → `/gsd-execute-phase <n>` → `/gsd-verify-work`); si `phase_id` ausente → inyecta instrucciones de bootstrap (`/gsd-new-project` usando descripción de la tarea como brief).
- **D-02:** Las instrucciones de bootstrap son skill invocation directa, determinista: literal `/gsd-new-project`. **Los comandos usan la forma `gsd-new-project` (guion), no `gsd:new-project` (dos puntos).**
- **D-03:** El contexto GSD **reemplaza** completamente las instrucciones genéricas actuales de `buildSessionContext`. No coexisten — el flujo GSD es incompatible con el genérico (no hay "comenta tu plan" ni "mueve a Review" manuales; GSD maneja el ciclo completo). Datos comunes (task_ref, project_path, session_id) se mantienen.
- **D-04:** Idioma del contexto GSD inyectado: **inglés**. Los skills GSD operan internamente en inglés; inyectar en inglés evita fricción de traducción. Los datos (task ref, summary) se mantienen en su idioma original.

### Lock por repo (GSD-10)
- **D-05:** Lock file en `.planning/.kodo.lock` (sentinel en el repo destino, no en `~/.kodo/`). Solo aplica a sesiones con flag `gsd` — sesiones normales no adquieren lock.
- **D-06:** Contenido del lock: JSON con `session_id`, `task_id`, `task_ref`, `pid` (process.pid del server/CLI que lanzó), `acquired_at` (ISO-8601), `ttl_hours` (default 4).
- **D-07:** Semántica de adquisición (TTL auto-release, sin `kodo unlock`):
  1. Lock no existe → crear y adquirir
  2. Lock existe + PID muerto (`kill -0` falla) → robar automáticamente
  3. Lock existe + PID vivo + TTL expirado → robar + warn a stderr
  4. Lock existe + PID vivo + TTL OK → rechazar (return `{ action: 'gsd_locked', holder }`)
- **D-08:** La verificación del lock se hace en **dispatcher.js** (centraliza toda la lógica de guards), como guard adicional después del inFlight check. Solo se evalúa cuando `kodoConfig.flags.includes('gsd')`.
- **D-09:** La liberación del lock se hace en **hook stop** (`src/hooks/stop.js`). Garantía: siempre se libera si Claude cierra, independientemente del resultado. TTL cubre el caso de crash donde el hook no dispara. `releaseGsdLock` es idempotente (verifica que el `session_id` coincide antes de borrar).

### Schema de SessionRecord (GSD-01)
- **D-10:** Campo booleano simple `gsd?: boolean` en SessionRecord. Aditivo — sesiones existentes sin el campo se tratan como `gsd=false` (falsy check). Sin migración de schema.
- **D-11:** `phase_id?: string` se añade como campo separado (preparación para Phase 9, Phase 8 no lo rellena).
- **D-12:** `buildSessionFromTask` en `manager.js` recibe `flags` del label parsing y setea `gsd: flags.includes('gsd')`.

### Claude's Discretion
- Nombre exacto del módulo de lock (`src/gsd/lock.js`, `src/locks.js`, etc.) y organización interna.
- TTL default (4h es sugerencia; planner puede ajustar según duración típica de sesiones GSD).
- Formato exacto del warn a stderr cuando se roba un lock por TTL expirado.
- Si `buildGsdContext` vive en el mismo archivo que `buildSessionContext` o en un módulo aparte.
- Mecanismo de PID check (kill -0 vs /proc check) — lo que sea más portable en macOS.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contexto de fases previas
- `.planning/phases/06-structured-logger-foundation/06-CONTEXT.md` — Contrato del logger (API, campos NDJSON, redacción). Phase 8 emite eventos tipados vía el logger.
- `.planning/phases/07-kodo-logs-cli-event-taxonomy/07-CONTEXT.md` — Taxonomía de eventos (7 tipos), DI del logger, helpers de eventos. Phase 8 usa `gsd.phase.resolved` y `gsd.bootstrap` ya definidos.

### Requisitos y roadmap
- `.planning/REQUIREMENTS.md` — GSD-01, GSD-04, GSD-10 (label flag, session plumbing, per-repo lock).
- `.planning/ROADMAP.md` §"Phase 8" — Goal + success criteria + dependency on Phase 6.
- `.planning/PROJECT.md` — Principios zero-runtime-deps, provider-agnostic architecture.

### Código existente que Phase 8 toca o integra
- `src/labels.js` — `parseKodoLabels` ya produce `flags: ['gsd']` para label `kodo:gsd`. No necesita cambios (ya funciona).
- `src/triggers/dispatcher.js` — Guard chain donde se añade el repo lock check. Ya tiene `inFlight` set y session-active guard.
- `src/session/manager.js` — `buildSessionFromTask` (añadir `gsd` field), `buildClaudeCommand` (añadir GSD flag handling), `launchWorkItem` (pasar flags al session record).
- `src/hooks/session-start.js` — `buildSessionContext` (bifurcar GSD vs genérico), emisión de `session.start` event.
- `src/hooks/stop.js` — Añadir `releaseGsdLock` al flujo de cleanup.
- `src/session/state.js` — Session typedef (añadir `gsd?`, `phase_id?` opcionales).
- `src/logger-events.js` — Helpers `gsdPhaseResolved`, `gsdBootstrap` ya definidos (emitir desde los nuevos code paths).
- `src/config.js` — `KODO_DIR` y project path resolution.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `parseKodoLabels` (`src/labels.js`) — Ya maneja `kodo:gsd` → `flags: ['gsd']`. No requiere cambios.
- `inFlight` set (`src/triggers/dispatcher.js`) — Patrón de guard por task_id; el repo lock sigue el mismo patrón pero keyed por `realpath(project_path)`.
- Logger DI ya establecido — `createLogger` + `.child({ component })` disponible en todos los consumers (Phase 7).
- Event helpers `gsdPhaseResolved` y `gsdBootstrap` ya definidos en `src/logger-events.js` (Phase 7).
- `buildSessionFromTask` factory pura — extensible con campos adicionales sin side effects.

### Established Patterns
- ES modules puros, factory functions sobre classes, JSDoc `@param`/`@returns`.
- Guards en dispatcher siguen patrón: check → return `{ action: '<name>' }` con info. Nuevo `gsd_locked` sigue la convención.
- Hook files son scripts ejecutables con `main()` + `if (import.meta.url === ...)` guard. Best-effort logging con try/catch silencioso.
- DI vía argumentos para testabilidad — dispatcher ya usa `DispatchDeps` pattern.

### Integration Points
- **Dispatcher:** Nuevo guard entre inFlight check y launch. Necesita acceso a `projects` map (actualmente solo en manager).
- **SessionStart hook:** Bifurcación `if (session.gsd)` antes de construir el contexto.
- **Stop hook:** Añadir `releaseGsdLock` condicionalmente cuando `session.gsd === true`.
- **State typedef:** Extensión aditiva del Session type con campos opcionales.

</code_context>

<specifics>
## Specific Ideas

- Los comandos GSD usan formato `gsd-new-project`, `gsd-plan-phase`, `gsd-execute-phase`, `gsd-verify-work` (con guiones, no dos puntos).
- El lock file `.planning/.kodo.lock` vive en el repo destino (no en `~/.kodo/`) para que sea visible y asociado al proyecto.
- El contexto GSD inyectado en inglés sigue el formato de preview acordado: header "GSD Mode", datos de la tarea, secuencia de comandos numerada, instrucción explícita de no comentar ni mover estado manualmente.
- El dispatcher retorna `{ action: 'gsd_locked', holder: { task_ref, session_id } }` cuando el lock está tomado — el caller puede reportar quién tiene el lock.

</specifics>

<deferred>
## Deferred Ideas

- **`kodo unlock` CLI command** — No incluido en Phase 8 (TTL auto-release es suficiente). Si la práctica muestra que 4h de TTL es problemático, añadir como tarea menor en post-milestone.
- **Lint rule anti-interpolación de secretos** — Heredada de deuda Fase 6→7. No es scope de Phase 8. Backlog.
- **Refactor `src/check.js` (separar snapshot/act)** — Heredada de Fase 6. Post-milestone.
- **Lock multi-tier (repo + workspace)** — Research mencionó two-tier lock. Phase 8 implementa tier 1 (repo). Si surge necesidad de tier 2 (workspace), evaluar en v0.4.

</deferred>

---

*Phase: 08-gsd-label-session-plumbing*
*Context gathered: 2026-04-17*
