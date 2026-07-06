---
gsd_state_version: 1.0
milestone: v0.16
milestone_name: activo)
current_phase: 70
current_phase_name: Concurrencia y ciclo de vida de procesos
status: verifying
stopped_at: Completed 70-03-PLAN.md
last_updated: "2026-07-06T12:40:35.175Z"
last_activity: 2026-07-06
last_activity_desc: Phase 70 execution started
progress:
  total_phases: 2
  completed_phases: 2
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.16 Hardening** — roadmap creado (4 phases 69-72, 27/27 requirements mapeados). Listo para planificar la primera fase con `/gsd-plan-phase 69`. v0.15 «kodo up» shipped 2026-07-03 (ver `## Most recent shipped milestone`).

## Project Reference

See: `.planning/PROJECT.md` (Current Milestone: v0.16 Hardening).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first. **v0.16 endurece: cierra la superficie de red, hace segura la concurrencia multiproceso, garantiza la entrega de dispatches con backstop mecánico, y salda la higiene y la deriva documental** (remediación de la auditoría adversarial 2026-07-03, 9 ALTA re-verificados 2026-07-05).

**Current focus:** Phase 70 — Concurrencia y ciclo de vida de procesos

## Current Position

Phase: 70 (Concurrencia y ciclo de vida de procesos) — EXECUTING
Plan: 4 of 4
Status: Phase complete — ready for verification
Last activity: 2026-07-06 — Phase 70 execution started

## Roadmap v0.16 (activo)

Estructura: **4 olas por causa raíz = 4 fases**, orden **risk-graded** (LOCKED). Numeración **continua** desde Phase 68 (v0.15) → primera fase **Phase 69** (NO reset). Fuente: `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` + `REQUIREMENTS.md` (este milestone no tuvo research — skip explícito del operador).

| Phase | Goal | Requirements | Riesgo / Nota |
|-------|------|--------------|---------------|
| 69. Red y autenticación (Ola 1) | Bind `127.0.0.1` por defecto (`server.bind`) + bearer en carril no-webhook (401 sin token; `/webhook` HMAC, `/health` abierto) + body 1 MB→413 + 500 neutro + `sessionId` validado + doc topología multi-nodo | NET-01..06 (6) | **Bajo** — aditivo, la ola más barata; cierra la única exposición externa (T3) — **va primera** |
| 70. Concurrencia y ciclo de vida de procesos (Ola 2) | `withStateLock(fn)` sobre los ~6 escritores (+ corregir comentario falso `server.js:682`) + `acquireGsdLock` atómico (`wx`) + zombi libera slot de `max_parallel` + PID ownership (post-bind, `started_at` pre-SIGKILL) + lock en `polling start` + migración v1→v2 atómica + dedup no-GSD cross-proceso + M13 empírico | CONC-01..09 (9) | **Medio** — la más delicada; tocar locks exige tests de proceso real (T1, T2) |
| 71. Fiabilidad de entrega y backstop (Ola 3) | Cursor de polling solo avanza con dispatch confirmado (`await`+timeout) + centinela de primer tick + `adopt` idempotente (busca por `task_url`) + backstop mecánico de "In Review" en `SessionEnd` | DELIV-01..04 (4) | **Medio** — cambia semántica de polling y `SessionEnd` (T4, T5) |
| 72. Higiene, DX y verdad documental (Ola 4) | Marcador `KODO_ORCHESTRATOR=1` + pathspec en auto-commit + **borrar** `up --url`/`startHealthLoop` + efectos de cierre a `SessionEnd` + strip `\x1b` + batch config (M3/M5/M14/B5/B7) + batch BAJAS + pasada de README | HYG-01..08 (8) | **Bajo** — paralelizable; se coloca al final por compartir `SessionEnd` con Ola 3 |

- **Ola 1 primero** no por ser la más grave en probabilidad, sino por ser la más barata de cerrar y eliminar la única exposición a atacantes externos. Olas 2 y 3 arreglan el producto para el usuario legítimo. Ola 4 puede solaparse con cualquiera pero se secuencia al final (HYG-04 mueve efectos a `SessionEnd`, el mismo hook que DELIV-04 reordena → evita conflictos de merge).
- **4 phases con granularidad `coarse` (2-4):** se elige el borde superior porque cada ola es una causa raíz distinta, cerrable y verificable de forma independiente (la propuesta lo estructura así). Ninguna es relleno: cada fase agrupa 4-9 hallazgos por causa raíz.

## Most recent shipped milestone

**v0.15 «kodo up» — arranque unificado + onboarding dashboard-first** — shipped 2026-07-03 (4 phases 65-68, 14 plans, 39 tasks; audit PASSED 14/14 reqs · 9/9 seams · 3/3 flujos E2E; suite 1788 pass + 1 skip). `kodo up` arranca el daemon compuesto (server+polling) desacoplado + dashboard como visor (idempotente/persistente); `kodo stop`/`status --json` + `kodo daemon run` foreground; `kodo start` legacy intacto. Distribución Homebrew (`brew install` + `brew services start kodo` → `kodo daemon run` server-only bajo launchd). Onboarding dashboard-first: first-run sin config → modo setup sin `exit 1` → provider/base_url/slug + API key enmascarada → `config.json` + `.env` 0600, boundary PERSIST-04 intacto; `kodo config` headless converge en la misma fontanería.

- Roadmap archive: `milestones/v0.15-ROADMAP.md`
- Requirements archive: `milestones/v0.15-REQUIREMENTS.md`
- Audit: `milestones/v0.15-MILESTONE-AUDIT.md`

## Deferred Items

Reset al baseline de v0.16. v0.15 cerró con audit PASSED (GATE MANUAL aprobado) sin deuda viva que bloquee v0.16.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera del roadmap v0.16) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions (Roadmap v0.16)

- **Numeración continua (NO reset):** v0.16 continúa desde Phase 68 (v0.15) → primera fase **Phase 69**.
- **4 phases = 4 olas por causa raíz:** la propuesta agrupa los ~40 hallazgos de la auditoría en 4 causas raíz (T1-T5); una fase GSD por ola, cada una cerrable y verificable de forma independiente. Granularidad `coarse` (2-4) → borde superior justificado (no relleno: 6/9/4/8 reqs por fase).
- **Orden risk-graded LOCKED:** Ola 1 (red) primero — la más barata, cierra la única exposición externa; Ola 2 (concurrencia/PID) la más delicada — locks exigen tests de proceso real; Ola 3 (entrega/backstop) cambia semántica de polling y `SessionEnd`; Ola 4 (higiene) paralelizable, al final por compartir `SessionEnd` con Ola 3.
- **Sin research (skip explícito del operador):** `.planning/research/` es STALE del milestone v0.15 y NO aplica a v0.16. Fuente de verdad = `REQUIREMENTS.md` + `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md`.
- **Decisiones de producto del mantenedor (2026-07-05) ya horneadas en los requirements:** (1) default bind `127.0.0.1` + doc de bind a IP tailscale (el webhook de Plane SÍ llega desde otro nodo) → NET-01/NET-06; (2) backstop mecánico de "In Review" ACEPTADO — la instrucción al LLM pasa a ser optimización (cambio de contrato de producto) → DELIV-04; (3) `up --url` y `startHealthLoop` se **borran**, no se cablean → HYG-02/HYG-03.
- **Fuera de alcance explícito:** rediseño "un solo escritor de estado" (el lockfile CONC-01 cubre el riesgo a ~1/20 del coste), M21 (medir antes de arreglar), M4 antes de la Ola 1 (tras cerrar la red exige colaborador malicioso en tu Plane → strip barato como HYG-07), M7-M9 a v2.
- **M13 (ubicación real de worktrees) se resuelve empíricamente en Ola 2 (CONC-09):** hoy no hay ningún worktree vivo que lo delate; lanzar una sesión GSD real y observar dónde aparece.

### Roadmap Evolution

- **v0.16 roadmap creado (2026-07-06):** 4 phases (69-72), numeración continua desde v0.15 (NO reset). Estructura 1:1 con las 4 olas de la propuesta, orden risk-graded LOCKED. 27/27 requirements mapeados (Phase 69: 6 · 70: 9 · 71: 4 · 72: 8), 100% cobertura, 0 orphans, 0 duplicados. Sin research (skip del operador). Granularidad `coarse`, borde superior justificado por causa raíz. `.planning/ROADMAP.md` reemplazado (v0.15 colapsado a `<details>`, ya archivado en `milestones/v0.15-ROADMAP.md`).
- **v0.15 roadmap creado (2026-07-02):** 4 phases (65-68), numeración continua desde v0.14. Pilar 1 (UP+DIST) antes de Pilar 2 (SETUP), orden risk-graded LOCKED.

### Open Blockers

Ninguno. v0.15 cerró con audit PASSED y GATE MANUAL aprobado.

### Open Questions (se resuelven al planificar/discutir cada fase, no bloquean el roadmap)

- **Phase 69:** ¿de dónde sale el bearer token — se genera al primer arranque y se persiste en `config.server.token`, o lo introduce el operador? ¿El dashboard lo lee de `config.json` o de `.env`? Decidir en discuss/plan.
- **Phase 70:** primitiva única `withStateLock` (lockfile `O_EXCL` + retry) reusada por los ~6 escritores Y por `polling start` (M20) Y por el dedup no-GSD (M17); confirmar el retry/timeout y el comportamiento ante lock huérfano (steal). Los tests de 2 procesos concurrentes reales son obligatorios (no unit-mocks).
- **Phase 71:** timeout del `await dispatchFn` en el path de polling (¿qué valor?, ¿qué pasa si el dispatch tarda más que el tick?). El webhook se queda fire-and-forget a propósito (Plane re-entrega).
- **Phase 72:** confirmar la lista exacta de BAJAS del batch HYG-06 (B1-B4, B8, B9, B12, M12) contra `AUDITORIA-ADVERSARIAL-2026-07-03.md` antes de tocar código.

### Critical Invariants to Preserve (cross-milestone, must survive este milestone)

- **`/webhook` conserva HMAC y `/health` queda abierto:** la auth bearer de Ola 1 es SOLO para el carril no-webhook. No romper el ingreso del webhook de Plane ni el probe de salud.
- **Boundary PERSIST-04:** API key solo en `~/.kodo/.env` (0600); nunca renderizada/logueada/en `/status`/en argv. El bearer token de Ola 1 es un secreto distinto — aplicarle el mismo cuidado (no filtrarlo a logs/`/status`).
- **Modelo daemon PERSISTENTE:** el daemon sobrevive al cierre del dashboard; solo `kodo stop` lo tumba. El PID ownership de Ola 2 (CONC-04/05) no puede regresionar esto.
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** — Ola 1 endurece los endpoints existentes, no añade ninguno.
- **Cero nuevas dependencias npm:** locks vía `node:fs` (`O_EXCL`/`flag:'wx'`) built-in; nada de `proper-lockfile`/`lockfile`.
- **TaskProvider contract FROZEN en 9** + getTaskState/createTask opcionales · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico — CONC-07 lo extiende a la migración de config) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

## Session Continuity

**Resume file:** None

- **Last session:** 2026-07-06T12:40:25.774Z
- **Stopped at:** Completed 70-03-PLAN.md
- **Next action:** `/gsd-plan-phase 69` — planificar la Ola 1 (Red y autenticación).
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.16 Hardening)
  - `.planning/ROADMAP.md` (v0.16 activo Phases 69-72; v0.10-v0.15 colapsados/archivados)
  - `.planning/REQUIREMENTS.md` (v0.16, traceability 27/27 → Phases 69-72)
  - `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` (fuente: 4 olas por causa raíz)
  - `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` (hallazgos A1-A9, M1-M21, B1-B12)
  - `.planning/MILESTONES.md` (entrada v0.15 completa)

## Operator Next Steps

- Planificar la primera fase con `/gsd-plan-phase 69`

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (sin planes ejecutados aún en v0.16) |
| Phase 69 P01 | 3min | 2 tasks | 4 files |
| Phase 69 P03 | 5min | 2 tasks | 6 files |
| Phase 69 P04 | 18min | 2 tasks | 4 files |
| Phase 69 P02 | 24 | 3 tasks | 6 files |
| Phase 70 P01 | 6 | 3 tasks | 6 files |
| Phase 70 P03 | 9 | 3 tasks | 8 files |
| Phase 70 P02 | 15 | 3 tasks | 6 files |
| Phase 70 P04 | 16 | 4 tasks | 8 files |

## Decisions

- [Roadmap v0.16]: 4 phases (69-72) = 4 olas por causa raíz de la auditoría, orden risk-graded LOCKED (red → concurrencia → entrega/backstop → higiene). Granularidad `coarse`, borde superior justificado.
- [Roadmap v0.16]: Sin research — `.planning/research/` es STALE de v0.15; fuente de verdad `REQUIREMENTS.md` + `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md`.
- [Roadmap v0.16]: Numeración continua desde Phase 68 → primera fase Phase 69 (NO reset).
- [Roadmap v0.16]: Decisiones de producto del mantenedor (2026-07-05) ya horneadas en requirements — default bind `127.0.0.1` (NET-01), backstop mecánico de In Review aceptado (DELIV-04), `up --url`/`startHealthLoop` borrados no cableados (HYG-02/03).
- [Phase ?]: [69-01] Auth primitives en src/server/auth.js (parseBearer, timingSafeTokenEqual length-guarded, isOpenRoute default-deny, getOrCreateApiToken CSPRNG 64-hex 0600, MAX_BODY_BYTES) — cero deps npm nuevas.
- [Phase ?]: [69-01] config.server.bind default 127.0.0.1 aditivo; configs v0.15 migradas sin la key siguen cargando (Plan 02 resuelve con ?? '127.0.0.1').
- [Phase ?]: [69-04] sessionId path-traversal guard: HARD reject (exit 2) at kodo logs CLI edge, SOFT non-throwing guard in logger.js (disk sink off) para preservar el reconcile loop — allowlist /^[A-Za-z0-9_-]+/ (NET-05, D-10)
- [Phase ?]: 69-02: drain-and-discard oversized bodies (not req.destroy) so clients read a clean 413
- [Phase ?]: 69-02: ?token= query param is HTML-route only; the API rail is bearer-header only (D-05)
- [Phase ?]: 70-01: Advisory-lock primitive state-lock.js (O_EXCL/wx + steal tmp+rename + Atomics.wait backoff); acquireGsdLock now atomic. Zero new deps.
- [Phase ?]: 70-01: state-lock steals only on parseable-but-stale (dead pid / TTL); corrupt/partial read retries to keep the O_EXCL create race single-winner.
- [Phase ?]: Phase 70-03: SIGKILL anti-PID-reuse tolerance = 8000ms; pre-bind PID write preserved (D-10 REVISED); gate reads alive via exported isSchedulable.
