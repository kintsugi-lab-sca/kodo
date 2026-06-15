# Phase 50: Live-progress display (CONDICIONAL — solo si Phase 49 = VIABLE) - Context

**Gathered:** 2026-06-12
**Status:** Ready for planning
**Gate:** Phase 49 = **VIABLE** (confirmado en `49-SPIKE.md`) — Phase 50 procede.

<domain>
## Phase Boundary

kodo **captura + persiste** el progreso `N/M` de tareas de cada sesión a un artefacto
kodo-controlado (`~/.kodo/progress/<task_id>.json`) y el **dashboard lo muestra**. El mecanismo
de captura ya está locked por el spike (Phase 49): la fase clarifica **CÓMO** mostrarlo y
gestionarlo, no si capturarlo.

**In scope:** hook de captura separado (TaskCreated/TaskCompleted → lee `~/.claude/tasks/` →
escribe el artefacto kodo), display del `N/M` en el dashboard vía lectura filesystem-style, estados
degradados honestos, y la confirmación empírica del riesgo A2 (que `TaskCreate` dispara en un
execute-phase real) como apertura del plan.

**Out of scope (capacidades nuevas → otras fases):** progreso por-wave/por-fase (requiere acoplar a
internals de GSD — no alcanzable con la superficie validada; deferred); limpieza/TTL de artefactos;
cualquier endpoint nuevo en el server (invariante: cero endpoints nuevos).

</domain>

<decisions>
## Implementation Decisions

### Riesgo A2 — confirmación primero (gate de apertura)
- **D-01:** La **primera tarea/plan** de Phase 50 instrumenta un `claude --worktree` real de
  `execute-phase` y confirma empíricamente que `TaskCreate` dispara durante sus waves de agentes
  ANTES de invertir en captura+persist+display+tests. El spike probó las 4 condiciones VIABLE con
  evidencia cruda; lo único inferido (no re-medido) es A2: que el flujo de kodo **invoque**
  `TaskCreate` en una sesión worktree (el spike disparó en primera persona en el orquestador, `cwd`
  = repo, no `.bg-shell/<sid>/`). A2 es load-bearing para TODO el valor de la fase.
- **D-02:** Si A2 **confirma** → proceder al resto del plan. Si A2 **falla** (cero disparo en
  execute-phase real) → cortar: PROG-02/03 difieren a v2 vía **PROG-F1**, el milestone cierra con
  OPEN-* + NYQ-03 sin penalización. Gastar UNA corrida en vez de la fase entera.

### Captura — superficie y estrategia de escritura (locked por spike, refinado aquí)
- **D-03:** **Hook separado** `TaskCreated`/`TaskCompleted` (NO añadir bloques a `session-start.js`
  — preserva golden-bytes HOOK-02). El hook es el ÚNICO que lee internals de Claude Code.
- **D-04:** En cada disparo, el hook lee **autoritativo** el dir plano `~/.claude/tasks/<session_id>/`
  (never-throws, **sin tomar el `.lock`**), deriva `N = count(status=="completed")`,
  `M = total de tareas`, y escribe el snapshot a `~/.kodo/progress/<task_id>.json`. **Self-healing:**
  sobrevive eventos hook perdidos y refleja cambios de status (NO acumular contadores de eventos —
  rechazado por frágil ante misses). El `N/M` es **acumulado de toda la sesión**, monótono.
- **D-05:** Correlación `session_id → task_id` vía `findSession({sessionId})` (`src/session/state.js`)
  — el payload del hook aporta `session_id` directamente (round-trip ya demostrado en el spike, cero
  código de producción nuevo para la correlación).

### Display — ubicación y formato
- **D-06:** **Columna condicional `prog`** (~width 6-7, entre `status` y `age`) que aparece SOLO
  cuando alguna sesión reporta progreso y recupera el ancho cuando ninguna — **espejo exacto del
  patrón `deriveAnyGsd`** que ya oculta `phasemode` (Phase 44). La mayoría de sesiones (quick/
  non-execute) no tienen todos, así que no se desperdicia ancho permanente. Visibilidad ambient,
  sin acción del operador.
- **D-07:** Formato de celda: **`N/M` crudo + `✓` al completar** (`1/3` → `3/3✓`). Sin color
  (color-isolation, espejo de la columna no-color `provider_state` Phase 43). Truncado anti-DoS de
  la columna (un payload absurdo no desborda la tabla — patrón T-43-03). Reservar ancho para el
  sufijo `✓`.
- **D-08:** El dashboard lee **solo** el artefacto kodo `~/.kodo/progress/<task_id>.json`
  filesystem-style (mold de `readLightPlan`, path byte-idéntico al productor, never-throws, anti-ReDoS
  guard del `task_id`), **NUNCA** los internals de Claude Code. **Cero endpoints nuevos** (invariante).

### Estados degradados honestos (patrón provider_state Phase 43)
- **D-09:** Sin todos / sin artefacto (ENOENT) → la columna no muestra esa fila (o `—`, según el
  mold de columna condicional). Fallo transiente de captura/lectura → `?` + **keep-last-good** (último
  N/M conocido). Cohorte legacy / sesiones de `Task*`-tools sin progreso → tolerada (no rompe la
  tabla), igual que la columna no-color `provider_state` tolera providers sin `getTaskState`.

### Ciclo de vida del artefacto
- **D-10:** Al morir / dismiss / completar la sesión, `~/.kodo/progress/<task_id>.json` **persiste**
  con el N/M final congelado (keep-last-good: `3/3✓` si terminó, `2/3` si murió a medias).
  **Sin limpieza nueva** — simétrico con `~/.kodo/plans/<task_id>.md` (light plan), que hoy tampoco
  se limpia. No integrar barrido en doctor (Phase 41) ni dismiss (Phase 42) en esta fase (evita
  acoplar a dos sistemas y romper la simetría; deferred si la acumulación molesta a futuro).

### Claude's Discretion
- Registro del hook separado vía `installHooks()` (`src/hooks/install.js`): nuevo script (p. ej.
  `src/hooks/task-progress.js`) + nuevo evento de hook, instalado junto a SessionStart/Stop **sin
  tocar** los golden-bytes de `session-start.js`. Nombre exacto del evento de hook (`TaskCreated`/
  `TaskCompleted` por el spike) y forma exacta del JSON del artefacto (campos, p. ej.
  `{ n, m, updated_at, ... }`) — researcher/planner deciden.
- Forma exacta de la columna condicional `prog` (header, ancho fino 6 vs 7, gestión del `✓` dentro
  del ancho) — planner decide alineado con `COLS` en `SessionTable.js`.
- Anti-ReDoS guard del `task_id`: **reusar** el de `readLightPlan` (`src/cli/dashboard/plan.js`), no
  reinventar.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Gate, scope & requirements
- `.planning/ROADMAP.md` — bloque Phase 50 (goal, Success Criteria 1-3, `UI hint: yes`) + la nota de
  **GATE DURO** Phase 49→50 (línea 23: INVIABLE corta limpio; VIABLE procede).
- `.planning/REQUIREMENTS.md` — `PROG-02` (captura + persist), `PROG-03` (display `N/M` + estados
  degradados), `PROG-F1` (fallback si A2 fallara → defer a v2 sin penalización).

### El veredicto del spike (mecanismo locked — leer ANTES de planificar)
- `.planning/phases/49-live-progress-spike-hard-gate/49-SPIKE.md` — veredicto **VIABLE**, Evidence Map
  4×3, payload crudo del hook, schema de `~/.claude/tasks/<session_id>/N.json`, round-trip
  `session_id → task_id`, decisión de gate (superficie de captura + artefacto write-owner + riesgo A2).
- `.planning/phases/49-live-progress-spike-hard-gate/49-CONTEXT.md` — D-04/D-05 (bias INVIABLE,
  seam productor↔consumidor `~/.kodo/`, correlación por `task_id`).

### Mirror pattern — seam plan-ligero v0.11 (precedente explícito del display)
- `src/cli/dashboard/plan.js` — `readLightPlan`: consumidor filesystem-style never-throws, path
  byte-idéntico al productor, anti-ReDoS `task_id` guard. **El patrón que Phase 50 reusa para leer
  `~/.kodo/progress/<task_id>.json`.**
- `src/hooks/session-start.js` — golden-bytes HOOK-02 que el hook de captura NO debe perturbar
  (es hook SEPARADO).
- `src/hooks/install.js` — `installHooks()`: mecanismo de registro de hooks en `~/.claude/settings.json`
  (hoy SessionStart + Stop). Punto de extensión para el nuevo hook de captura.
- `src/config.js` — `KODO_DIR` (`~/.kodo/`): root del artefacto. Artefactos hermanos:
  `~/.kodo/plans/<task_id>.md`, `~/.kodo/logs/<session>.ndjson`, `~/.kodo/polling-state.json`.

### Mirror pattern — columna no-color provider_state v0.10 (precedente del display)
- `src/cli/dashboard/SessionTable.js` — `COLS = { ..., status: 18, task: 12, age: 7 }` (línea 54);
  columna `task` (Phase 43, provider_state) entre `status` y `age` + truncado anti-DoS T-43-03. La
  columna `prog` se añade con el mismo molde.
- `src/cli/dashboard/derive.js` / `format.js` — `deriveAnyGsd(sorted)` que oculta `phasemode` cuando
  ninguna sesión es GSD (patrón de columna condicional que `prog` reusa).

### Correlación y sesión
- `src/session/state.js` — `findSession({sessionId})`: round-trip `session_id → task_id` (fuente de
  correlación, demostrada en el spike).

### Codebase orientation
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/INTEGRATIONS.md` — forma del sistema,
  puntos de integración hook/`~/.kodo/`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readLightPlan` (`src/cli/dashboard/plan.js`) — consumidor filesystem-style never-throws + anti-ReDoS
  `task_id` guard; **reusar tal cual** para leer `~/.kodo/progress/<task_id>.json`.
- `installHooks()` (`src/hooks/install.js`) — registro de hooks en `~/.claude/settings.json` sin
  clobber; extender para el nuevo hook de captura (evento Task*).
- `findSession({sessionId})` (`src/session/state.js`) — correlación `session_id → task_id` ya probada.
- `KODO_DIR` (`src/config.js`) — root `~/.kodo/` para el artefacto `progress/<task_id>.json`.
- `COLS` + molde de celda en `SessionTable.js`; `deriveAnyGsd` para la lógica de columna condicional.

### Established Patterns
- **Seam productor↔consumidor byte-idéntico** (v0.11 Phase 45/46): el hook escribe `~/.kodo/progress/
  <task_id>.json`, el dashboard lo lee con ruta byte-idéntica. Never-throws en ambos lados.
- **Columna condicional** (`deriveAnyGsd`/`phasemode`, Phase 44): aparece/desaparece según los datos,
  recupera ancho.
- **Columna no-color con estados degradados** (`provider_state`/`task`, Phase 43): `—` sin dato,
  `?` + keep-last-good en fallo transiente, anti-DoS truncado.
- **Golden-bytes HOOK-02** (`session-start.js`): el nuevo hook es SEPARADO, no append a este.
- **Invariante:** cero endpoints nuevos en `src/server.js` — todo es lectura filesystem.

### Integration Points
- Hook de captura (nuevo) → lee `~/.claude/tasks/<session_id>/` (READ surface, never-throws, sin
  `.lock`) → escribe `~/.kodo/progress/<task_id>.json` (write-owner kodo).
- Dashboard → lee `~/.kodo/progress/<task_id>.json` filesystem-style (mold `readLightPlan`) →
  columna condicional `prog` en `SessionTable.js`.
- `installHooks()` → registra el hook en `~/.claude/settings.json` junto a SessionStart/Stop.

</code_context>

<specifics>
## Specific Ideas

- El display es el espejo barato de DOS precedentes ya shipped: seam plan-ligero (Phase 45/46) para
  la lectura del artefacto, y columna no-color `provider_state` (Phase 43) para la presentación con
  estados degradados. El coste vivía en la captura, que el spike resolvió.
- "Avance vivo de un vistazo": la columna `prog` es **ambient** (sin acción del operador), por eso se
  rechazó el overlay-bajo-tecla.
- Honestidad ante el riesgo A2: el spike fue explícito en que el disparo en worktree real no se
  re-midió. Confirmarlo primero (D-01) cuesta una corrida; construir sobre el supuesto cuesta la fase.

</specifics>

<deferred>
## Deferred Ideas

- **Progreso por-wave / por-fase (reset por ola)** — conceptualmente más útil pero requiere acoplar
  kodo a internals de GSD (la superficie validada es un tasks-dir plano por `session_id`, sin límites
  de wave). Rompe provider-agnostic. Re-evaluar si Claude Code expone estructura de wave a futuro.
- **Limpieza / TTL del artefacto `~/.kodo/progress/`** — integrar barrido en dismiss (Phase 42) o
  doctor (Phase 41), o auto-expiry por antigüedad. Diferido: hoy `~/.kodo/plans/` y `logs/` tampoco
  se limpian; abordar solo si la acumulación molesta.
- **Barra de progreso visual / %** — descartado por sobreingeniería para un número pequeño; revisitar
  solo si el `N/M` crudo resulta insuficiente en uso real.

### Reviewed Todos (not folded)
None — discussion stayed within phase scope.

</deferred>

---

*Phase: 50-live-progress-display-condicional-solo-si-phase-49-viable*
*Context gathered: 2026-06-12*
