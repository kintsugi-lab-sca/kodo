# Phase 70: Concurrencia y ciclo de vida de procesos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 70-Concurrencia y ciclo de vida de procesos
**Mode:** --auto (todas las áreas grises auto-seleccionadas; opción recomendada elegida sin AskUserQuestion)
**Areas discussed:** Primitiva withStateLock, Puente zombi→slot (A4), Atomicidad acquireGsdLock (A3), PID ownership + SIGKILL (A5/A6), Reuso de lock (polling/dedup, M20/M17), Migración config atómica (M16), Verificación worktrees (M13/CONC-09)

---

## Primitiva `withStateLock` y granularidad del lock (CONC-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Primitiva de lock compartida (una para state + polling + dedup) envolviendo load→mutate→save | Un módulo de lockfile `O_EXCL`+retry reusado por los 3 consumidores; `withStateLock(fn)` re-lee bajo lock | ✓ |
| Lock ad-hoc duplicado en cada escritor | Cada sitio implementa su propio lockfile | |
| Mover toda mutación a HTTP (single writer vía server) | La solución «correcta» del informe: reescribe hooks/CLI/doctor | |

**Auto-selección:** Primitiva compartida + `withStateLock(fn)` load→mutate→save (recomendada). El single-writer-vía-HTTP está **fuera de alcance explícito** de v0.16 (PROJECT.md: lockfile a ~1/20 del coste).
**Notes:** El `saveState` actual (tmp+rename atómico) se conserva como paso de escritura dentro del lock. Fallo de adquisición → warn + abort observable (D-03). Comentario falso «ÚNICO escritor» corregido en el mismo commit (D-04).

---

## Puente zombi → slot de `max_parallel` (A4 / CONC-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Gate filtra por `alive` | `manager.js:178` cuenta `status==='running' && alive!==false`; el gate LEE, no escribe | ✓ |
| Reconcile deriva `status:'idle'` cuando `state:'dead'` | reconcile escribe también `status` | |

**Auto-selección:** Gate filtra por `alive` (recomendada).
**Notes:** Se elige el gate porque `alive` es el campo de liveness cuyo **único escritor es `reconcileTick`** (invariante v0.9/v0.10) y `status` es outcome (redefinido v0.10). Escribir `status` desde reconcile violaría esa separación. La auditoría acepta ambas vías.

---

## Atomicidad de `acquireGsdLock` (A3 / CONC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| `flag:'wx'` (O_EXCL) + EEXIST→lógica existente; `stealLock` tmp+rename | Elimina el TOCTOU del Caso 1 (`!existsSync`→write) | ✓ |
| Dejar `existsSync`+write (statu quo) | Mantiene la condición de carrera | |

**Auto-selección:** `flag:'wx'` + `stealLock` atómico (recomendada; literal de la auditoría).
**Notes:** Casos 2–5 (steal PID-muerto/TTL/corrupto, reject PID-vivo) intactos. `decideLock` de `doctor.js:223` es espejo exacto — debe seguir cuadrando.

---

## PID ownership + seguridad del SIGKILL (A5, A6 / CONC-04, CONC-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Ownership por PID + escritura post-bind + `ps -o lstart=` antes de SIGKILL | teardown borra solo su PID; verificar arranque real antes de matar | ✓ |
| SIGKILL directo por PID del fichero (statu quo) | Riesgo de matar PID reciclado | |

**Auto-selección:** Ownership + verificación de `started_at` (recomendada).
**Notes:** macOS-first (`ps -o lstart=`); si `ps` falta o no parsea → no matar por defecto + warn (never-throws). PID escrito solo tras bind OK.

---

## Reuso de la primitiva: `polling start` (M20 / CONC-06) y dedup no-GSD (M17 / CONC-08)

| Option | Description | Selected |
|--------|-------------|----------|
| Reusar la primitiva de lock (`O_EXCL` en polling start; lock por `task_id` en dedup) | Un solo daemon; dedup cross-proceso | ✓ |
| Guard in-process (statu quo dedup) / sin lock (polling) | Ventana de carrera cross-proceso | |

**Auto-selección:** Reusar la primitiva (recomendada).
**Notes:** Espejo del lock per-repo GSD (GSD-10) para el carril no-GSD.

---

## Migración de config v1→v2 atómica (M16 / CONC-07)

| Option | Description | Selected |
|--------|-------------|----------|
| `writeFileAtomic` (tmp+rename) | Fontanería v0.14 ya usada por saveConfig/saveState | ✓ |
| `writeFileSync` directo (statu quo) | Crash a mitad → config truncado | |

**Auto-selección:** `writeFileAtomic` (recomendada).
**Notes:** Consistente con el patrón atómico del proyecto.

---

## Verificación empírica de worktrees (M13 / CONC-09)

| Option | Description | Selected |
|--------|-------------|----------|
| Verificación empírica en sesión GSD viva + documentar/corregir | Confirmar ubicación real vs `computeRealWorktreePath` | ✓ |
| Inferir de código sin sesión viva | Riesgo de repetir la discrepancia de obs. 23450 | |

**Auto-selección:** Verificación empírica + documentación (recomendada).
**Notes:** Si no puede montarse una sesión GSD real en el cierre, se difiere la firma humana (patrón 50.1) entregando el análisis del código.

---

## Claude's Discretion

- Nombre/ubicación del módulo de la primitiva de lock; si `withStateLock` es wrapper fino o vive junto a `saveState`.
- Parámetros de retry/backoff y TTL del lockfile de estado.
- Estructura del filtro del gate (`alive !== false` inline vs helper).
- Parseo de `ps -o lstart=` y margen de skew tolerado al comparar `started_at`.
- Ubicación/estilo de los tests (`node:test`, tests de concurrencia con procesos hijos reales).

## Deferred Ideas

- Rediseño single-writer vía HTTP — fuera de alcance explícito de v0.16.
- M21 (medir antes de arreglar), M7–M9 — diferidos (PROJECT.md).
- Verificación humana de worktrees en sesión GSD viva — se difiere si no puede montarse en el cierre.
