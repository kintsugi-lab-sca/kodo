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
