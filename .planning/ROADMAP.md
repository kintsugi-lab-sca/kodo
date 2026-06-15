# Roadmap: kodo

## Milestones

- ✅ **v0.2 Provider Abstraction** — Phases 1-5 (shipped 2026-04-13)
- ✅ **v0.3 GSD Integration + Structured Logging** — Phases 6-10 (shipped 2026-04-22)
- ✅ **v0.4 GSD Quick Mode** — Phases 11-13 (shipped 2026-04-30)
- ✅ **v0.5 CLI Polish & v0.3 Debt Cleanup** — Phases 14-17 + 999.1 (shipped 2026-05-11)
- ✅ **v0.6 Session Isolation & Skill Sync** — Phases 18-22 (shipped 2026-05-13)
- ✅ **v0.7 GitHub Issues Adapter** — Phases 23-27 (shipped 2026-05-14)
- ✅ **v0.8 Consolidación + GSD Provider Reporting** — Phases 28-33 (shipped 2026-05-25)
- ✅ **v0.9 kodo TUI — sesiones en vivo** — Phases 34-39 + 39.1 (shipped 2026-06-03)
- ✅ **v0.10 Higiene y estado real de sesiones** — Phases 40-43 (shipped 2026-06-08)
- ✅ **v0.11 Ventana al plan** — Phases 44-47 (shipped 2026-06-10)
- ✅ **v0.12 Atajos al gestor y progreso vivo** — Phases 48-51 + 50.1 (shipped 2026-06-15)

## Phases

<details>
<summary>✅ v0.12 Atajos al gestor y progreso vivo (Phases 48-51 + 50.1) — SHIPPED 2026-06-15</summary>

- [x] Phase 48: Open-in-manager core (3/3 plans) — OPEN-01..04 — completed 2026-06-12
- [x] Phase 49: Live-progress spike / HARD GATE (1/1 plan) — PROG-01 (veredicto VIABLE) — completed 2026-06-12
- [x] Phase 50: Live-progress display condicional (3/3 plans) — PROG-02, PROG-03 — completed 2026-06-13
- [x] Phase 50.1: Live-progress vía STATE.md de GSD — corrige la fuente (2/2 plans) — re-realiza PROG-02/PROG-03 — completed 2026-06-15
- [x] Phase 51: Backfill Nyquist v0.11 (1/1 plan) — NYQ-03 — completed 2026-06-15

Archivo: `milestones/v0.12-ROADMAP.md` · Requirements: `milestones/v0.12-REQUIREMENTS.md` · Deuda diferida al cierre: HUMAN-UAT de Phase 50.1 (display de progreso vivo, verificación en TTY real — ver STATE.md `## Deferred Items`)
</details>

<details>
<summary>✅ v0.11 Ventana al plan (Phases 44-47) — SHIPPED 2026-06-10</summary>

- [x] Phase 44: Overlay de plan GSD + pulido de dashboard (2/2 plans) — PLAN-01, PLAN-02, TUI-18, TUI-19
- [x] Phase 45: Inyección de plan ligero universal (1/1 plan) — PLAN-03
- [x] Phase 46: Overlay del plan ligero para sesiones quick/non-GSD (1/1 plan) — PLAN-04
- [x] Phase 47: Backfill de deuda Nyquist (1/1 plan) — NYQ-01, NYQ-02

Archivo: `milestones/v0.11-ROADMAP.md` · Requirements: `milestones/v0.11-REQUIREMENTS.md` · Audit: `milestones/v0.11-MILESTONE-AUDIT.md` (status: tech_debt — deuda Nyquist 44/45/46 diferida → saldada en Phase 51 de v0.12)
</details>

<details>
<summary>✅ v0.10 Higiene y estado real de sesiones (Phases 40-43) — SHIPPED 2026-06-08</summary>

- [x] Phase 40: Provider State — contrato + providers + enrichment (2/2 plans) — PSTATE-01..04
- [x] Phase 41: Doctor — módulo puro de saneo + CLI (3/3 plans) — DOCTOR-01..04
- [x] Phase 42: Dismiss — TUI read-write + server amplification (3/3 plans) — DISMISS-01..04
- [x] Phase 43: Render — provider_state en el dashboard (2/2 plans) — PSTATE-05, 06

Archivo: `milestones/v0.10-ROADMAP.md` · Requirements: `milestones/v0.10-REQUIREMENTS.md` · Audit: `milestones/v0.10-MILESTONE-AUDIT.md`
</details>

Milestones anteriores (v0.2–v0.9): ver `milestones/v<X.Y>-ROADMAP.md`.

## Backlog

### Phase 999.1: kodo bidireccional — sesión cmux → tarea persistente (BACKLOG)

**Goal:** Convertir una sesión de Claude Code creada ad-hoc directamente en cmux (no nacida de Plane/GitHub) en una **tarea persistente del gestor**, para que el trabajo ad-hoc no se evapore al cerrar el sprint.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

**Por qué (dolor real diario):** el operador abre sesiones en cmux para trabajo que no nace de una tarea; al no persistirlas, se pierden si no las cierra dentro del sprint. No hay rastro en Plane/GitHub.

**El concepto — flujo inverso:** kodo hoy hace **tarea → sesión** (Plane/GitHub lanza un Claude Code). Esto es **sesión → tarea**. Es kodo volviéndose **bidireccional**: un puente de ida y vuelta entre el gestor y el trabajo real.

**Las 4 piezas del flujo:**
1. **Detectar** la sesión ad-hoc en cmux — *único supuesto sin validar*: ¿cmux expone el proceso/cwd por workspace para identificar un `claude` que NO está en `state.json`? (spike ~30 min; encaja con la introspección de la **Fase 49**, que ya va a investigar la superficie observable de Claude Code).
2. **Crear** la tarea en el provider vía POST — la fontanería ya existe (`github/client.js` y `plane/client.js` ya hacen `POST` con auth para `addComment`); `listProjects` (en el contrato) ya permite elegir destino.
3. **Adoptar** la sesión registrándola en `state.json` con el `task_id` nuevo (kodo ya recorre este camino al lanzar; aquí al revés).
4. **Datos** — título (¿derivado del nombre del workspace/cwd, o escrito?), proyecto destino, descripción opcional.

**Decisión de diseño clave (con precedente limpio):** crear tareas NO está en los 9 métodos FROZEN del contrato `TaskProvider` (`init`/`getTask`/`updateTaskState`/`addComment`/`listPendingTasks`/`parseTriggerEvent`/`verifySignature`/`resolveRef`/`listProjects`). Añadir `createTask` como **método OPCIONAL typeof-detected** —espejo de cómo `getTaskState` se añadió en la Fase 40— mantiene el contrato "FROZEN en 9". Empezar por **un solo provider** (probablemente Plane, el día a día del operador).

**Dimensión:** NO es una feature suelta — es un **milestone propio ("kodo bidireccional")**. NO meter en v0.12 (open-in-manager + live-progress) para no descarrilar. Candidato a milestone tras v0.12. **Forma probable:** comando aparte (`kodo adopt`/`capture`) o acción/tecla en el dashboard sobre una fila no-kodo — **NO** una sección más en la tabla de tareas (un ciudadano sin `task_id`/`provider_state`/plan sería de segunda clase ahí).

**Origen:** ideado 2026-06-12 en conversación tras cerrar la Fase 48.

---
_Histórico: la anterior Phase 999.1 ("Dismiss de sesiones dead desde el dashboard ink") fue **promovida a Phase 42 y shipped en v0.10** (2026-06-08). Traza de origen completa en `milestones/v0.10-ROADMAP.md`._
