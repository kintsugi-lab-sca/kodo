# Requirements: kodo — Milestone v0.17 «Plan vivo por-tarea»

**Defined:** 2026-07-15
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

**Milestone Goal:** Convertir `~/.kodo/plans/<uuid>.md` de fire-and-forget (solo se escribe al arranque) en **estado vivo** de la tarea — cerrar la continuidad entre sesiones de la misma tarea (hoy inexistente) y alimentar el nudge del orquestador con un `NEXT:` concreto.

**Origen:** Phase 74 pre-redactada en el Backlog de `ROADMAP.md` (LIVE-01..04) + ORCH-05 (ex-Phase 73, retirada por eliminación 2026-07-14), aquí con causa raíz localizada en código.

---

## v1 Requirements

Requirements de este milestone. Cada uno mapea a exactamente una fase del roadmap.

### Plan vivo (LIVE)

- [ ] **LIVE-01**: Al cerrar una sesión de una tarea, `~/.kodo/plans/<task_id>.md` gana un bloque `## Handoff <fecha>` con `Hecho / Pendiente / NEXT:`
- [x] **LIVE-02**: Una segunda sesión de la misma tarea acumula otro bloque de handoff sin pisar el anterior (incluye invertir la instrucción de `session-start.js:85`, que hoy ordena *"sobrescribe si ya existe"*)
- [ ] **LIVE-03**: Si al cierre el LLM no ha escrito un bloque de handoff, el hook appendea uno mecánico mínimo (fecha + resultado de la sesión, sin `NEXT:`) — la instrucción al LLM es optimización, no única vía
- [ ] **LIVE-04**: Tras el cierre, `state.json` refleja para esa tarea el puntero al plan + el `NEXT:` de una línea, escrito bajo `withStateLock`
- [ ] **LIVE-05**: El usuario ve el `NEXT:` por tarea en la lista del dashboard sin que la TUI abra N ficheros de plan
- [ ] **LIVE-06**: El usuario abre el markdown completo del plan desde la vista del dashboard, renderizado (no editable), en la rama `phaseId == null`
- [ ] **LIVE-07**: Con un `NEXT:` presente, el nudge del orquestador lo usa como contexto en vez del genérico

### Conteo de tareas pendientes (ORCH)

- [ ] **ORCH-05**: El conteo de tareas `pending` que ve el orquestador converge con el que reporta `kodo check` — hoy `/status` sirve desde `pendingCache` (TTL 30s, `server.js:591`) y `check.js:37` lee fresco sin caché, divergiendo hasta 30s
- [ ] **ORCH-06**: Con el provider caído, `/status` no presenta un conteo `pending` viejo como si fuera fresco — hoy `server.js:599` devuelve `pendingCache.data` en el catch **sin comprobar TTL**, sirviendo datos arbitrariamente antiguos con solo un `console.warn` de rastro

---

## Constraints (aplican a todos los requirements)

Derivados de invariantes cross-milestone vivos en `STATE.md` y `PROJECT.md` §Key Decisions:

| Constraint | Origen |
|------------|--------|
| El handoff debe escribirse **ANTES** del cleanup terminal destructivo de `SessionEnd` (`removeSession` + worktree + promptFile) | `src/hooks/session-end.js` |
| Orden de efectos `backstop → setColor → notify` en `SessionEnd` es **LOCKED** | D-08 (v0.16 Phase 71) |
| Toda escritura a `state.json` pasa por `withStateLock` — el hook de cierre es un escritor más | v0.16 Phase 70 (CONC) |
| `reconcileTick` sigue siendo el **único escritor** de `alive` | D-04 |
| **D-02 intacto**: `readPlan` da prioridad a GSD; el plan ligero solo se lee en la rama `phaseId == null` | v0.11 Phase 46 |
| Hooks **never-throw** — jamás crashear Claude Code | D-4 (v0.13 Phase 58) |
| TUI never-throws · color isolation (`picocolors` solo desde `src/cli/format.js`) | cross-milestone |
| **Cero endpoints nuevos** en `src/server.js` (desde v0.10) | cross-milestone |
| **Cero dependencias npm nuevas** | cross-milestone |
| Escritura no-corruptiva (temp+rename atómico) | PERSIST |
| El formato del handoff debe ser **parseable con contrato** — el hook necesita detectar «¿hay bloque nuevo?» (para LIVE-03) y extraer el `NEXT:` (para LIVE-04). El formato exacto se clava en `/gsd-discuss-phase` | Hueco detectado 2026-07-15 |

---

## v2 Requirements

Reconocidos pero fuera de este roadmap.

### Inbox de capturas (CAPT) — Phase 999.2, sigue en Backlog

- **CAPT-01**: `kodo capture "idea"` appendea a `~/.kodo/inbox.md` con `texto · tag-proyecto · fecha · origen`
- **CAPT-02**: `/kodo-capture` captura mid-session con el mismo formato
- **CAPT-03**: `kodo inbox` lista capturas abiertas y las marca `enrutada`/`descartada`
- **CAPT-04**: El enrutado a tarea/fase/config lo hace `gsd-capture`, no una reimplementación

### Otros diferidos vivos

- **CFGF-01**: hot-reload de config en server/daemon
- **PLANE-F1/M7**: `Retry-After` en 429 del cliente Plane · **PLANE-F2/M8**: filtro server-side por label kodo · **PLANE-F3/M9**: paginación del listado
- **PERF-F1/M21**: reconcile asíncrono — **medir antes de arreglar**
- Adapter ClickUp · adapter local (JSON/Markdown) + file watcher · webhook GitHub ingress real-time

---

## Out of Scope

Exclusiones explícitas, documentadas para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Poda/cap de handoffs antiguos | Decisión 2026-07-15: acumular sin límite en v0.17. Una tarea típica de kodo vive 1-3 sesiones; podar ahora es especulativo. Precedente «medir antes de arreglar» (M21). Revisitar en v0.18 con datos reales de crecimiento |
| Handoff en sesiones muertas por SIGKILL/crash | El backstop de LIVE-03 vive en el hook `SessionEnd`; si el proceso muere sin hook, no hay handoff. Límite estructural conocido y aceptado — mismo modelo de fallo que el backstop de «In Review» de v0.16 |
| Surface del handoff en el overlay de filas **GSD** | Rompería D-02 (prioridad GSD sobre plan ligero), decisión LOCKED de v0.11 que hoy funciona. Las sesiones GSD ya tienen continuidad propia (STATE.md, `/gsd-pause-work`, `/gsd-resume-work`). El handoff sí se escribe en disco para ellas y sí alimenta el nudge — solo no se pinta en el overlay |
| Edición del handoff desde la TUI | El plan se renderiza, no se edita a mano (criterio 3 de Phase 74). El editor de config de v0.14 no se extiende aquí |
| Endpoint nuevo para servir el `NEXT:` | Cero endpoints nuevos desde v0.10. El `NEXT:` viaja en `state.json`, que la TUI ya lee |
| Rediseño del `pendingCache` a invalidación por evento | ORCH-05/06 se resuelven convergiendo caminos de lectura y arreglando la rama de error. Un bus de invalidación es sobreingeniería para un TTL de 30s |
| Debounce/idempotencia del nudge de refresh | El nudge genérico se **eliminó** el 2026-07-14 (commit f4df750) — no hay síntoma que debouncear. LIVE-07 define el nudge con contexto, que es otra cosa |

---

## Traceability

Qué fases cubren qué requirements. Se rellena durante la creación del roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| LIVE-01 | Phase 74 | Pending |
| LIVE-02 | Phase 74 | Complete |
| LIVE-03 | Phase 74 | Pending |
| LIVE-04 | Phase 74 | Pending |
| LIVE-05 | Phase 75 | Pending |
| LIVE-06 | Phase 75 | Pending |
| LIVE-07 | Phase 75 | Pending |
| ORCH-05 | Phase 76 | Pending |
| ORCH-06 | Phase 76 | Pending |

**Coverage:**

- v1 requirements: 9 total
- Mapped to phases: 9 ✓
- Unmapped: 0

Sin huérfanos y sin duplicados: cada requirement mapea a exactamente una fase.

- **Phase 74** — Handoff acumulativo al cierre (productor): LIVE-01, LIVE-02, LIVE-03, LIVE-04
- **Phase 75** — Superficie del `NEXT:` — dashboard y nudge (consumidores): LIVE-05, LIVE-06, LIVE-07
- **Phase 76** — Convergencia del conteo `pending` (ortogonal, paralelizable): ORCH-05, ORCH-06

---
*Requirements defined: 2026-07-15*
*Last updated: 2026-07-15 after roadmap creation (Phases 74-76)*
