# Phase 11: Quick Mode Recognition & Persistence - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 11 cierra el data-plane de `kodo:gsd-quick`: persistir `gsd_mode='full'|'quick'` en `SessionRecord`, propagar el contrato `--dangerously-skip-permissions` a quick, y dejar el dispatcher emitiendo telemetría coherente (`gsd.phase.resolved`, `gsd.bootstrap`) que distinga ambos modos. Cubre QUICK-01..04.

**No incluye** (Phase 12): SessionStart hook bifurcation, Stop hook nudge sin verify, orchestrator launch summary tag.
**No incluye** (Phase 13): matriz de tests cross-cutting de los 4 estados de label en los 4 puntos de la cadena.
**No incluye** (out of scope per REQUIREMENTS): migración de sesiones legacy en `state.json`.

</domain>

<decisions>
## Implementation Decisions

### Skip-permissions source-hygiene (QUICK-04)

- **D-01:** `src/session/manager.js` deriva `skipPerms` desde `getGsdMode(flags)` en lugar de literal `flags.includes('gsd')`. Forma final: `const skipPerms = kodoFlags.includes('yolo') || getGsdMode(kodoFlags) !== null`. Cualquier nuevo modo GSD (`gsd-foo`) implica skip-perms automáticamente añadiéndolo a `getGsdMode()` — un solo punto de cambio.
- **D-02:** Comentario sobre el invariante en `buildClaudeCommand` se generaliza: "Las sesiones GSD (full y quick) corren slash commands autónomos; pedir confirmación por tool call rompe la automatización. Ambos modos implican skip-permissions." No listar literales.

### Persistencia de `gsd_mode` en SessionRecord (QUICK-03)

- **D-03:** `buildSessionFromTask` deriva el modo localmente vía `getGsdMode(flags)`. La firma NO crece (no se añade `gsdMode` como parámetro). Una sola fuente de verdad: `flags`. Coherente con D-01 (manager deriva localmente; dispatcher no threadea modo). El coste de llamar `getGsdMode` dos veces (dispatcher + manager) es despreciable.
- **D-04:** Cuando `gsd:true`, `gsd_mode` SIEMPRE se persiste con valor explícito (`'full'` o `'quick'`). Las sesiones legacy (pre-Phase 11) son las únicas con `gsd:true` sin `gsd_mode`. Forma del spread: `...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {})`.

### Telemetría del dispatcher (D-14 carry-forward de Phase 9)

- **D-05:** `gsd.phase.resolved` con match exitoso (cualquier modo) lleva campo `mode: 'full'|'quick'`. Para `quick + match` el evento mantiene `phase_id` y `match_heading` aunque el SessionRecord descarte `phase_id` — forense útil ("el resolver vio fase X pero la sesión es phase-agnostic").
- **D-06:** `quick + no-match` deja de ser silencio: el dispatcher emite `gsd.phase.resolved {matched: false, code: 'no-match', tolerated: true, mode: 'quick'}` a nivel `info` (no `warn` — no es error en quick). Mantiene la invariante D-14 Phase 9 ("dispatcher es única fuente de `gsd.phase.resolved`"). `kodo logs --session-of <id>` puede reconstruir por qué la sesión arrancó sin `phase_id`.
- **D-07:** `gsd.bootstrap` también lleva campo `mode: 'full'|'quick'`. Schema homogéneo: todos los eventos GSD emitidos por el dispatcher distinguen el modo. `kodo logs --event-type gsd.bootstrap --json` puede separar bootstraps quick de full.

### Contrato de lectura para Phase 12

- **D-08:** `gsd_mode` ausente con `gsd:true` se interpreta como `'full'`. Comportamiento histórico preservado: antes de v0.4 toda sesión `kodo:gsd` era full. Sesiones legacy se siguen leyendo sin migración (REQUIREMENTS out-of-scope).
- **D-09:** Phase 11 exporta el helper `getSessionMode(session)` desde `src/labels.js` (junto a `getGsdMode`). Devuelve `null | 'full' | 'quick'` aplicando la regla D-08 internamente: `if (!session?.gsd) return null; return session.gsd_mode || 'full'`. Phase 12 (hooks, orchestrator) y Phase 13 (tests) consumen este helper — no inline `session.gsd_mode || 'full'` en cada callsite.
- **D-10:** Phase 11 introduce `getSessionMode` aunque sus consumers vivan en Phase 12. Razón: el helper es testeable aislado en `test/labels.test.js` (Phase 13 QUICK-08 lo cubrirá con los 4 estados: legacy gsd:true, gsd:true+full, gsd:true+quick, sin gsd).

### Claude's Discretion

- Mensajes de log en español/inglés: el dispatcher y el manager ya están en inglés; los nuevos comentarios sobre quick mode siguen en inglés. El orchestrator (`prompt.md`, `stop.js` nudge en ES) NO se toca en Phase 11 — esa decisión vive en Phase 12 D-XX (D-04 Phase 8 + D-16 Phase 10 carry-forward).
- Granularidad y orden de plans (cuántos plan files, qué dependencies entre ellos): a decidir en `/gsd-plan-phase 11`.
- Naming exacto de campos en JSDoc del Session typedef: a decidir en planning (mantener consistencia con campos existentes `phase_id`, `brief`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Especificación de la fase
- `.planning/ROADMAP.md` §"Phase 11: Quick Mode Recognition & Persistence" — goal, success criteria, requirements
- `.planning/REQUIREMENTS.md` §"v0.4 Requirements" QUICK-01..04 — contratos exactos de label parsing, dispatch, persistence, skip-perms parity
- `.planning/PROJECT.md` §"Current Milestone: v0.4 GSD Quick Mode" — motivación, target features, key context
- `.planning/STATE.md` §"Accumulated Context" — decisions carry-forward de v0.3 + new decisions v0.4

### Decisiones carry-forward de v0.3 (relevantes para Phase 11)
- `.planning/milestones/v0.3-ROADMAP.md` — Phases 8-10 establecieron el GSD pipeline: lock per-repo, resolver discriminated union, dispatcher como única fuente de eventos
- Decisiones D-04 Phase 8 (session-start en EN, prompt orchestrator en ES) y D-14 Phase 9 (dispatcher = única fuente de `gsd.phase.resolved` y `gsd.bootstrap`) — invariantes que Phase 11 preserva

### Código a modificar
- `src/labels.js` — añadir `getSessionMode(session)` junto a `getGsdMode(flags)` (D-09)
- `src/session/manager.js:43` — `buildSessionFromTask` deriva `gsdMode` y persiste `gsd_mode` (D-03, D-04)
- `src/session/manager.js:262` — `buildClaudeCommand` deriva `skipPerms` desde `getGsdMode` (D-01, D-02)
- `src/session/state.js:26` — `Session` typedef ya tiene `gsd_mode?: 'full'|'quick'` (WIP); validar coherencia con D-04
- `src/triggers/dispatcher.js:147+` — añadir `mode` al payload de `gsd.phase.resolved` (success branch + tolerated `no-match` branch) y `gsd.bootstrap` (D-05, D-06, D-07)
- `src/logger-events.js` — ampliar firma de `gsdPhaseResolved` con campo `mode` (D-05). El helper `gsd.bootstrap` actualmente es untyped (literal en dispatcher) — evaluar si moverlo al taxonomy file

### Commit de referencia
- `004995c` — `feat(session): kodo:gsd implies --dangerously-skip-permissions` (contrato que Phase 11 extiende a `kodo:gsd-quick`)

### WIP no-committeado a integrar
- `git diff src/labels.js src/session/state.js src/triggers/dispatcher.js` — ya cubre el dispatch infrastructure (gsdMode computation, lock acquisition para ambos modos, phase_id discard en quick, no-match tolerance). Phase 11 cierra los huecos restantes (manager, telemetría completa)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`getGsdMode(flags)`** en `src/labels.js` (WIP): centraliza la regla de precedencia (`gsd-quick` > `gsd`). Phase 11 lo consume desde manager.js para D-01 y D-03.
- **`parseKodoLabels(labels)`** en `src/labels.js`: ya extrae `flags` correctamente; sin cambios.
- **`buildSessionFromTask(...)`** en `src/session/manager.js`: el spread condicional ya es el patrón canónico (`...(flags?.includes('gsd') ? {gsd:true} : {})`); Phase 11 amplía a `gsd_mode`.
- **`gsdPhaseResolved(log, ...)`** en `src/logger-events.js`: helper tipado existente; Phase 11 amplía firma con `mode`.
- **Dispatcher resolver branches** en `src/triggers/dispatcher.js`: el WIP ya distingue `gsdMode === 'full'` vs `'quick'` en los switch cases; Phase 11 sólo añade payload `mode` en los emits.

### Established Patterns
- **"Helper en labels.js + consumer downstream"** — D-12 Phase 8: una función exporta la regla, todos los consumers la importan. Phase 11 sigue este patrón con `getSessionMode`.
- **"Spread condicional en buildSessionFromTask"** — Phase 8 + Phase 9: `...(condition ? {field: value} : {})`. Phase 11 extiende a `gsd_mode`.
- **"Dispatcher = única fuente de eventos GSD"** — D-14 Phase 9: ningún otro módulo emite `gsd.phase.resolved` ni `gsd.bootstrap`. Phase 11 preserva (D-06: el `info` log también lo emite el dispatcher).
- **"Spread con campo opcional para evitar undefined en JSON"** — Phase 9: `...(phaseId ? {phase_id: phaseId} : {})` para que `state.json` no contenga `phase_id: undefined`.

### Integration Points
- **manager.js → labels.js**: ya importa `parseKodoLabels`; añadir `getGsdMode` al import (D-01, D-03).
- **dispatcher.js → labels.js**: ya importa `getGsdMode` (WIP); sin cambios de import.
- **dispatcher.js → logger-events.js**: ya importa `gsdPhaseResolved`; firma ampliada con `mode` requiere actualizar el callsite y el helper en paralelo.
- **dispatcher.js no-match branch**: hoy es `break;` mudo. Phase 11 inserta el `info` log antes del break preservando la semántica del switch (continúa al launch).

</code_context>

<specifics>
## Specific Ideas

- `getSessionMode(session)` vive en `src/labels.js` para mantener simetría con `getGsdMode(flags)`. Aunque el nombre sugiere `state.js`, la regla "legacy gsd:true == full" es semánticamente parte de la taxonomía de labels (qué label histórica equivale a qué modo). Documentar este matiz en el JSDoc del helper.
- Las llamadas `getGsdMode` redundantes (dispatcher + manager) son intencionales: prefer derivar localmente en cada módulo a threadear el modo por la firma. La duplicación de cómputo (~µs) compra desacople de firmas.
- En `manager.js:262` (skip-perms), preservar el orden actual: `yolo` primero (intención explícita del usuario), `getGsdMode` después (intención implícita por modo GSD). Si el usuario añade ambos `kodo:yolo` + `kodo:gsd`, el corto-circuito `||` da el resultado correcto y la trazabilidad humana funciona.

</specifics>

<deferred>
## Deferred Ideas

### A Phase 12 (Hook & Orchestrator Bifurcation)
- Lectura efectiva de `session.gsd_mode` vía `getSessionMode(session)` en `src/hooks/session-start.js` (`buildGsdContext` rama quick → `/gsd-quick "<title>"`).
- Lectura en `src/hooks/stop.js` (`buildStopNudgeText` sin `kodo gsd verify` cuando modo quick).
- Lectura en `src/orchestrator/launch.js:122` (`buildContextSummary` tag `[GSD quick]` vs `[GSD phase N]` vs `[GSD bootstrap]`).
- Reescritura del párrafo `## Sesiones GSD` en `src/orchestrator/prompt.md` (aclara que quick no se verifica via `kodo gsd verify`).

### A Phase 13 (Test Coverage Matrix)
- Tests aislados de `getGsdMode` y `getSessionMode` en `test/labels.test.js` (4 estados de label × 4 estados de SessionRecord).
- Tests de `buildSessionFromTask` con `flags=['gsd']`, `flags=['gsd-quick']`, `flags=['gsd','gsd-quick']`, `flags=[]`.
- Tests de dispatcher cubriendo `quick+match` (descarta phase_id), `quick+no-match` (continúa al launch + emite info log), `quick+roadmap-missing` (fail-closed).
- Tests de session-start hook (rama quick).

### Out of Scope (REQUIREMENTS)
- Migración programática de sesiones legacy en `state.json`. La regla "ausente == full" cubre la lectura sin reescribir.
- Nuevo tipo de evento NDJSON para quick (e.g., `gsd.quick.start`). Reusamos los 8 tipos existentes con campo `mode` añadido.
- Cambios al slash command `/gsd-quick`. Asumimos que existe en `~/.claude/skills/`.

### Reviewed Todos
None — este flow no atravesó cross-reference de todos.

</deferred>

---

*Phase: 11-quick-mode-recognition-persistence*
*Context gathered: 2026-04-28*
