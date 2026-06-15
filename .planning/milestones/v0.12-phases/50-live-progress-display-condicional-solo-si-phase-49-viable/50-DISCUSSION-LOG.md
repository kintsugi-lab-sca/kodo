# Phase 50: Live-progress display (CONDICIONAL — solo si Phase 49 = VIABLE) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-12
**Phase:** 50-live-progress-display-condicional-solo-si-phase-49-viable
**Areas discussed:** Formato y ubicación del display, Semántica del progreso, Ciclo de vida del artefacto, Estrategia para el riesgo A2

---

## Formato y ubicación del display

| Option | Description | Selected |
|--------|-------------|----------|
| Columna condicional 'prog' | Columna estrecha (~width 5) entre status y age, aparece solo si alguna sesión reporta progreso (espejo deriveAnyGsd) | ✓ |
| Columna dedicada siempre visible | Columna fija siempre presente (espejo literal de 'task' width 12 Phase 43) | |
| Overlay bajo tecla | Sin columna; tecla nueva abre overlay (estilo plan 'p') | |

**User's choice:** Columna condicional 'prog'
**Notes:** Ambient sin acción del operador; la mayoría de sesiones quick/non-execute no tienen todos, así que la columna condicional no desperdicia ancho permanente.

## Formato de la celda 'prog'

| Option | Description | Selected |
|--------|-------------|----------|
| 'N/M' crudo, sin adornos | Siempre 'N/M' sin color ni glyph extra | |
| 'N/M' + marca al completar | 'N/M', añade '✓' al llegar a M/M (ej. '3/3✓') | ✓ |
| Barra mini + N/M | Mini progress bar ASCII + N/M | |

**User's choice:** 'N/M' + marca al completar
**Notes:** `1/3` → `3/3✓`. Reservar ancho para el sufijo `✓`; mantener truncado anti-DoS.

---

## Semántica del progreso (qué cuenta N/M)

| Option | Description | Selected |
|--------|-------------|----------|
| Acumulado de sesión, leído del tasks-dir | N=completed, M=total en ~/.claude/tasks/<session_id>/, lectura autoritativa por refresh; self-healing | ✓ |
| Contadores de eventos hook | M=count(TaskCreated), N=count(TaskCompleted) incrementados sin leer dir; frágil ante misses | |
| Por-wave / por-fase (reset por ola) | Resetear N/M por wave; requiere acoplar a internals GSD, no alcanzable con la superficie validada | |

**User's choice:** Acumulado de sesión, leído autoritativo del tasks-dir
**Notes:** El hook dispara el refresh; la verdad sale del dir (sobrevive eventos perdidos, refleja cambios de status). N/M acumulado de toda la sesión, monótono. Por-wave queda deferred (rompe provider-agnostic).

---

## Ciclo de vida del artefacto

| Option | Description | Selected |
|--------|-------------|----------|
| Persiste, N/M final congelado | El artefacto queda; keep-last-good; cero integración nueva; espejo de ~/.kodo/plans/ | ✓ |
| Limpieza integrada en dismiss/doctor | dismiss (Phase 42) / doctor (Phase 41) también borran progress/<task_id>.json | |
| TTL / auto-expiry por antigüedad | Sweeper que limpia artefactos viejos | |

**User's choice:** Persiste, N/M final congelado
**Notes:** Simétrico con plan-ligero (que tampoco se limpia). Limpieza integrada queda deferred si la acumulación molesta a futuro.

---

## Estrategia para el riesgo A2

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmar A2 como PRIMERA tarea, luego construir | Primer plan instrumenta execute-phase real y confirma disparo de TaskCreate antes de invertir en captura+display | ✓ |
| Construir tolerante + confirmar en dogfooding al cierre | Postura literal del roadmap; columna condicional amortigua un miss total | |
| No confirmar A2 explícitamente | Construir asumiendo que dispara | |

**User's choice:** Confirmar A2 como PRIMERA tarea, luego construir
**Notes:** A2 (que TaskCreate dispare en un worktree real de execute-phase) es load-bearing para todo el valor de la fase; el spike solo lo infirió. Confirmar cuesta una corrida; construir sobre el supuesto cuesta la fase. Si falla → PROG-02/03 difieren a v2 (PROG-F1) sin penalización. Claude (revisor) fue crítico aquí en vez de seguir el roadmap por inercia, y el usuario coincidió.

## Claude's Discretion

- Registro del hook separado vía `installHooks()` (nuevo script `src/hooks/task-progress.js` + nuevo evento, sin tocar golden-bytes HOOK-02 de `session-start.js`).
- Forma exacta del JSON del artefacto `~/.kodo/progress/<task_id>.json` (campos).
- Forma exacta de la columna condicional `prog` (header, ancho fino 6 vs 7, gestión del `✓`) alineada con `COLS` en `SessionTable.js`.
- Reusar el anti-ReDoS `task_id` guard de `readLightPlan` (no reinventar).

## Deferred Ideas

- Progreso por-wave / por-fase (reset por ola) — requiere acoplar a internals GSD; no alcanzable con tasks-dir plano por session_id.
- Limpieza / TTL del artefacto `~/.kodo/progress/` — integrar barrido en dismiss/doctor o auto-expiry; diferido (plans/ y logs/ tampoco se limpian).
- Barra de progreso visual / % — sobreingeniería para un número pequeño.
