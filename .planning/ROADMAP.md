### Phase 39.1: Cierre de gaps v0.9 — wiring host↔TUI + fuente única de alive + statusColor v3 (INSERTED)

**Goal:** Saldar la deuda del audit v0.9 antes de cerrar el milestone: eliminar el código muerto del wiring host (TUI-17, blocker), unificar la fuente de verdad de `alive` (TUI-13/14), hacer `statusColor` v3-aware (TUI-10), distinguir "provider sin soporte" de "sin comentarios" en el overlay (TUI-15), y reconciliar el bookkeeping verificable.
**Requirements**: TUI-17 (blocker), TUI-13, TUI-14, TUI-10, TUI-15 (+ bookkeeping TUI-16)
**Depends on:** Phase 39
**Plans:** 5/5 plans complete

Plans:
- [x] 39.1-01-PLAN.md — TUI-17: eliminar el código muerto del wiring host (index.js/App.js/SessionTable.js + test)
- [x] 39.1-02-PLAN.md — TUI-13/14: fuente única de `alive` (quitar override legacy en GET /status)
- [x] 39.1-03-PLAN.md — TUI-10: `statusColor` v3-aware (deriva del estado v3 reusando STATE_BADGES)
- [x] 39.1-04-PLAN.md — TUI-15: overlay de comentarios distingue unsupported vs vacío (campo aditivo `supported`)
- [x] 39.1-05-PLAN.md — Bookkeeping D-10: reconciliar REQUIREMENTS.md (TUI-15/16 [x], traceability Status)

## Backlog

### Phase 999.1: Dismiss de sesiones dead desde el dashboard ink (BACKLOG)

**Goal:** Dar al operador una forma de descartar sesiones `dead`/zombie desde la TUI ink (tecla `d`), cerrando la asimetría con la web (que ya puede). Promueve TUI-F4 (dismissal) de v2 a candidato v1.0, restringido al caso seguro. Origen: una sesión `dead` (ROMAN-22, 40h+) se queda atascada en el dashboard sin forma de limpiarla.
**Requirements:** TUI-F4 (promoción desde v2) — a formalizar como TUI-* de v1.0 en discuss/plan
**Plans:** 0 plans

**Por qué NO entró en v0.9:** v0.9 se definió como "TUI read-only del contrato existente". Una mutación cambia la identidad del milestone → `DELETE /sessions/<id>` como acción del TUI estaba explícitamente en *Out of Scope* y TUI-F4 diferido a v2. Material de v1.0.

**Contexto técnico (verificado en código, 2026-06-03):**
- `DELETE /sessions/{taskId}` YA EXISTE (`src/server.js:451` → `removeSession`). NO requiere endpoint nuevo.
- La vista HTML web legacy YA lo consume (`src/server.js:163`). Asimetría: la web descarta, la TUI ink no.
- `removeSession` (`src/session/state.js`) es bookkeeping-only: quita de `state.json` sessions/history (FIFO 50-slot). NO mata proceso ni limpia worktree.
- Guard `row.alive === false` ya existe en `App.js:412` (hoy bloquea Enter sobre dead/zombie).

**Diseño propuesto (MVP seguro):**
- Tecla `d` sobre la fila seleccionada.
- GUARD INVERSO al de Enter: `d` solo actúa si `row.alive === false`; sobre sesión VIVA rechaza con footer-error. Preserva la protección anti-ROMAN-132 (olvidar una sesión viva reintroduce la desincronización de estado).
- Llama al endpoint existente `DELETE /sessions/{task_id}`, never-throws, dashboard sigue montado (patrón focus de Phase 37).
- Probable confirmación inline anti-borrado-accidental.

**Decisiones de alcance pendientes (para discuss/plan):**
1. ¿El dismiss limpia también el worktree huérfano en disco, o solo olvida del `state.json`? (lo segundo = lo que hace hoy la web; lo primero acerca al diferido `kodo gsd doctor`).
2. ¿Solo `dead`, o también zombies `running + !alive`?

**Relacionado:** WARNING-02/D-09 del `v0.9-MILESTONE-AUDIT.md` — la web UI recomputa `idle` con heurística propia divergente del estado v3; al tocar la web para el dismiss, considerar reconciliar esa divergencia.

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
