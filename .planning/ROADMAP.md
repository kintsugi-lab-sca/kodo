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
- ✅ **v0.13 kodo bidireccional** — Phases 52-62 (shipped 2026-06-25)
- ✅ **v0.14 Configuración editable desde el dashboard** — Phases 63-64 (shipped 2026-06-30)
- ✅ **v0.15 «kodo up» — arranque unificado + onboarding dashboard-first** — Phases 65-68 (shipped 2026-07-03)
- ✅ **v0.16 Hardening** — Phases 69-72 (shipped 2026-07-15)
- ✅ **v0.17 Plan vivo por-tarea** — Phases 74-78 (shipped 2026-07-22)

> **Phase 73 quemada.** Se creó y se retiró por eliminación el 2026-07-14 (el nudge genérico que pretendía debouncear se borró entero, commit `f4df750`). El número NO se reutiliza: la numeración salta de 72 a 74.

## Phases

<details>
<summary>✅ v0.17 Plan vivo por-tarea (Phases 74-78) — SHIPPED 2026-07-22</summary>

**Milestone Goal:** Convertir `~/.kodo/plans/<uuid>.md` de fire-and-forget en **estado vivo** de la tarea — cerrar la continuidad entre sesiones de la misma tarea y alimentar el nudge del orquestador con un `NEXT:` concreto (productor Phase 74 → consumidores Phase 75), + dos fases ortogonales: convergencia del conteo `pending` (76) y agrupación de workspaces en cmux (77). La Phase 78 saldó la deuda técnica de cierre (saneo del nudge + fixes 77-REVIEW).

- [x] Phase 74: Handoff acumulativo al cierre (8/8 plans) — LIVE-01..04 ✅ 2026-07-21
- [x] Phase 75: Superficie del `NEXT:` — dashboard y nudge (3/3 plans) — LIVE-05, LIVE-06, LIVE-07 ✅ 2026-07-17
- [x] Phase 76: Convergencia del conteo `pending` (2/2 plans) — ORCH-05, ORCH-06 ✅ 2026-07-17
- [x] Phase 77: Agrupación de workspaces en cmux (2/2 plans) — GRP-01..04 ✅ 2026-07-17
- [x] Phase 78: Address tech debt: saneo del nudge (75/WR-01) + fixes 77-REVIEW (2/2 plans) ✅ 2026-07-22

Archivo: `milestones/v0.17-ROADMAP.md` · Requirements: `milestones/v0.17-REQUIREMENTS.md` · Audit: `milestones/v0.17-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v0.16 Hardening (Phases 69-72) — SHIPPED 2026-07-15</summary>

**Milestone Goal:** Remediar los hallazgos de la auditoría adversarial (2026-07-03, re-verificados 2026-07-05) agrupados en 4 olas por causa raíz, orden risk-graded: cerrar la superficie de red, hacer segura la concurrencia multiproceso sobre `state.json`/PID, garantizar la entrega de dispatches con backstop mecánico, y saldar la higiene y la deriva documental.

- [x] Phase 69: Red y autenticación (4/4 plans) — NET-01..06 ✅ 2026-07-06
- [x] Phase 70: Concurrencia y ciclo de vida de procesos (4/4 plans) — CONC-01..09 ✅ 2026-07-06
- [x] Phase 71: Fiabilidad de entrega y backstop (5/5 plans) — DELIV-01..04 ✅ 2026-07-09
- [x] Phase 72: Higiene, DX y verdad documental (5/5 plans) — HYG-01..08 ✅ 2026-07-14

Archivo: `milestones/v0.16-ROADMAP.md` · Requirements: `milestones/v0.16-REQUIREMENTS.md` · Audit: `milestones/v0.16-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v0.15 «kodo up» — arranque unificado + onboarding dashboard-first (Phases 65-68) — SHIPPED 2026-07-03</summary>

**Milestone Goal:** kodo se pone a andar con un solo comando (`kodo up`): arranca el daemon **desacoplado** (server + polling compuestos en un proceso) en background y engancha el dashboard como **visor**; distribuible por Homebrew (`brew install` + `brew services`), y configurable de principio a fin desde el dashboard (incluida la API key enmascarada, con el boundary PERSIST-04). Dos pilares: **Pilar 1** (UP + DIST) **antes de** **Pilar 2** (SETUP).

- [x] Phase 65: Daemon Lifecycle Foundation (`src/daemon/` + `kodo daemon run` foreground + `startServer({managed})` sin `process.exit`/PID propio; `kodo start` legacy intacto) — UP-04, UP-06 ✅ 2026-07-02
- [x] Phase 66: `kodo up` + Stop/Status unificados + Homebrew (daemon desacoplado + attach dashboard idempotente + `brew install`/`brew services` → `kodo daemon run` + Windows fallback) — UP-01, UP-02, UP-03, UP-05, DIST-01, DIST-02, DIST-03 ✅ 2026-07-02
- [x] Phase 67: Secrets Writer + Masked Input (`writeEnvVar` atómico 0600 pre-rename + campo enmascarado + grep de higiene + indicador de presencia) — SETUP-03, SETUP-04 ✅ 2026-07-02
- [x] Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run (first-run sin config → modo setup sin `exit(1)` + edición provider/base_url/slug → `config.json` + `kodo config` misma fontanería) — SETUP-01, SETUP-02, SETUP-05 ✅ 2026-07-03

Archivo: `milestones/v0.15-ROADMAP.md` · Requirements: `milestones/v0.15-REQUIREMENTS.md` · Audit: `milestones/v0.15-MILESTONE-AUDIT.md`

</details>

<details>
<summary>✅ v0.14 Configuración editable desde el dashboard (Phases 63-64) — SHIPPED 2026-06-30</summary>

**Milestone Goal:** El dashboard TUI pasa de observar+gestionar sesiones a también **configurar kodo** — añadir/editar la ruta de un proyecto sin re-correr el wizard lineal, más ajustes comunes de uso diario. Escritura **local** (funciones puras de `src/config.js`), **cero endpoints nuevos** (2ª ruptura consciente de "TUI read-only" tras el dismiss de v0.10), aviso de reinicio (sin hot-reload), API keys intactas en `~/.kodo/.env`.

- [x] Phase 63: Editor de configuración — fundación + ajustes comunes (overlay + text-input editable en ink + escritura local atómica `writeFileAtomic`) — UX-01..04, CFG-01..05, PERSIST-01..05 ✅ 2026-06-29
- [x] Phase 64: Editor de proyectos en el dashboard (lista `listProjects()` en vivo + mapear/editar/quitar ruta + módulos, degradación never-throws) — PROJ-01..05 ✅ 2026-06-29

Archivo: `milestones/v0.14-ROADMAP.md` · Requirements: `milestones/v0.14-REQUIREMENTS.md`
</details>

<details>
<summary>✅ v0.13 kodo bidireccional (Phases 52-62) — SHIPPED 2026-06-25</summary>

**Milestone Goal:** Cerrar el puente en la dirección inversa `sesión → tarea`: una sesión Claude Code ad-hoc de cmux se promueve a tarea persistente del gestor. Arquitectura **"una fontanería, tres consumidores"** — base determinista 0-token (`createTask` + `adoptSession`) reusada por el CLI, la tecla del dashboard y el orquestador (único carril LLM).

- [x] Phase 52: createTask + contrato + anti-recursión — BIDIR-01/02/06 ✅ 2026-06-16
- [x] Phase 53: Fontanería `src/adopt.js` — BIDIR-03/04/05/08 ✅ 2026-06-16
- [x] Phase 54: CLI `kodo adopt` — BIDIR-07 ✅ 2026-06-16
- [x] Phase 55: Contrato `HostProvider.listAgentSurfaces()` (cmux) — DETECT-01 ✅ 2026-06-16
- [x] Phase 56: Tecla del dashboard — DETECT-02 ✅ 2026-06-18
- [x] Phase 57: Orquestador asistido — ORCH-01 (superseded por ORCH-02) ✅ 2026-06-18
- [x] Phase 58: Ciclo de vida de cierre + deuda v0.12 — LIFE-03/DEBT-01/DEBT-02 ✅ 2026-06-23
- [x] Phase 59: Liveness de sesiones adoptadas — PROG-04 ✅ 2026-06-19
- [x] Phase 60: Enriquecimiento de tareas adoptadas (orquestador) — BIDIR-F2 ✅ 2026-06-19
- [x] Phase 61: Progreso vivo para sesiones adoptadas — PROG-04 ✅ 2026-06-24
- [x] Phase 62: Adopción inteligente desde el dashboard — ORCH-02 ✅ 2026-06-25

Archivo: `milestones/v0.13-ROADMAP.md` · Requirements: `milestones/v0.13-REQUIREMENTS.md` · Audit: `milestones/v0.13-MILESTONE-AUDIT.md`
</details>

<details>
<summary>✅ v0.12 Atajos al gestor y progreso vivo (Phases 48-51 + 50.1) — SHIPPED 2026-06-15</summary>

- [x] Phase 48: Open-in-manager core (3/3 plans) — OPEN-01..04 — completed 2026-06-12
- [x] Phase 49: Live-progress spike / HARD GATE (1/1 plan) — PROG-01 (veredicto VIABLE) — completed 2026-06-12
- [x] Phase 50: Live-progress display condicional (3/3 plans) — PROG-02, PROG-03 — completed 2026-06-13
- [x] Phase 50.1: Live-progress vía STATE.md de GSD — corrige la fuente (2/2 plans) — re-realiza PROG-02/PROG-03 — completed 2026-06-15
- [x] Phase 51: Backfill Nyquist v0.11 (1/1 plan) — NYQ-03 — completed 2026-06-15

Archivo: `milestones/v0.12-ROADMAP.md` · Requirements: `milestones/v0.12-REQUIREMENTS.md`
</details>

<details>
<summary>✅ v0.11 Ventana al plan (Phases 44-47) — SHIPPED 2026-06-10</summary>

- [x] Phase 44: Overlay de plan GSD + pulido de dashboard (2/2 plans) — PLAN-01, PLAN-02, TUI-18, TUI-19
- [x] Phase 45: Inyección de plan ligero universal (1/1 plan) — PLAN-03
- [x] Phase 46: Overlay del plan ligero para sesiones quick/non-GSD (1/1 plan) — PLAN-04
- [x] Phase 47: Backfill de deuda Nyquist (1/1 plan) — NYQ-01, NYQ-02

Archivo: `milestones/v0.11-ROADMAP.md` · Requirements: `milestones/v0.11-REQUIREMENTS.md` · Audit: `milestones/v0.11-MILESTONE-AUDIT.md`
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

Detalle completo de las fases 52-62: ver `milestones/v0.13-ROADMAP.md`.
Detalle completo de las fases 63-64: ver `milestones/v0.14-ROADMAP.md`.
Detalle completo de las fases 65-68: ver `milestones/v0.15-ROADMAP.md`.
Detalle completo de las fases 69-72: ver `milestones/v0.16-ROADMAP.md`.
Detalle completo de las fases 74-78: ver `milestones/v0.17-ROADMAP.md`.

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.17 Plan vivo por-tarea | 74-78 | 17/17 | Complete | 2026-07-22 |
| v0.16 Hardening | 69-72 | 18/18 | Complete | 2026-07-15 |
| v0.15 «kodo up» | 65-68 | 14/14 | Complete | 2026-07-03 |
| v0.14 Config editable | 63-64 | 7/7 | Complete | 2026-06-30 |
| v0.13 kodo bidireccional | 52-62 | 17/17 | Complete | 2026-06-25 |

## Backlog

### Phase 999.1: kodo bidireccional (PROMOVIDO → v0.13 Phases 52-62, SHIPPED)

_Este backlog item se materializó como el milestone **v0.13 kodo bidireccional** (shipped 2026-06-25) bajo la arquitectura "una fontanería, tres consumidores"._

**Deferido a v2 (trackeado en REQUIREMENTS.md v0.17):** `Retry-After` en 429 del cliente Plane (PLANE-F1/M7) · filtro server-side por label kodo en polling (PLANE-F2/M8) · paginación del listado de work items (PLANE-F3/M9) · reconcile asíncrono fuera del event loop (PERF-F1/M21 — **medir antes de arreglar**).

**Deferred candidates (futuros milestones):** hot-reload de config en server/daemon (CFGF-01) · adapter ClickUp · adapter local (JSON/Markdown) + file watcher · webhook GitHub ingress real-time.

_(ORCH-05 salió del backlog: promovido a **Phase 76** en v0.17 con causa raíz localizada en código.)_

### Phase 999.2: Inbox de capturas global — fuera de v0.17 (feature)

> **Renumerado 2026-07-15:** este item se llamaba «Phase 75» en el backlog. Al promover la candidata Phase 74 a fase activa, v0.17 ocupa 74-76 y el número 75 quedaría ambiguo. Se renumera a 999.2 siguiendo la convención de placeholders del backlog (999.x). Recibirá número real al promoverse.

**Goal**: Dar a kodo un **buffer de captura rápida** para ideas tangenciales que surgen mid-session (un tip de config, una idea de comando, un cambio de sentido) y que NO dan para una tarea de Plane. Global y propio de kodo (`~/.kodo/inbox.md`, append-only, con tag de proyecto), capturable desde shell (`kodo capture`) y desde dentro de la sesión (skill `/kodo-capture`). Lo que hace que funcione y no se pudra es el **destino**: `kodo inbox` enruta cada captura → tarea Plane / fase roadmap / config / descartada, delegando el «a dónde va» en `gsd-capture`.

**Tipo**: Feature (NO hardening). **Fuera de v0.17 por decisión del operador (2026-07-15)** — tema ortogonal al plan vivo, no refuerza la Phase 74. Bajo blast radius (superficie nueva, aislada: comando + skill + fichero).
**Requirements**: CAPT-01, CAPT-02, CAPT-03, CAPT-04
**Depends on**: ninguna dura (aislada). Reutiliza el enrutado de `gsd-capture`/`gsd-inbox`.
**Success Criteria** (what must be TRUE):

  1. `kodo capture "idea"` desde cualquier proyecto appendea a `~/.kodo/inbox.md` una línea con `texto · tag-proyecto · fecha · origen`; escritura atómica/con lock ante capturas concurrentes. (CAPT-01)
  2. `/kodo-capture` captura mid-session desde Claude Code con el mismo formato, derivando proyecto/tarea del contexto de sesión. (CAPT-02)
  3. `kodo inbox` lista las capturas abiertas y marca cada una como `enrutada`/`descartada` al procesarla (no borra: traza de qué se convirtió en qué). (CAPT-03)
  4. El enrutado a tarea/fase/config lo hace `gsd-capture`, no una reimplementación en kodo. (CAPT-04)

**Plans**: TBD (no planificar aún)

### Phase 999.3: Higiene del sidebar de cmux — `kodo sidebar doctor` + carril orquestador (candidata v0.18)

**Origen**: conversación del operador 2026-07-20, tras cerrar Phase 76 y estrenar la agrupación de Phase 77 — fricción real: no se van a pre-crear grupos para cada módulo (caso vivo: sesiones de OptiAI sueltas porque no existía el grupo `ROMAN/OptiAI`).

**Goal**: Quitar al humano (y al launch path) la carga de mantener el sidebar de cmux: un **doctor determinista** (`kodo sidebar doctor`, espejo del patrón `src/gsd/doctor.js` — `scan` + `execute`, dry-run / `--fix`, 0 tokens) detecta y corrige grupos que faltan (crear), workspaces sueltos con grupo esperado (add), grupos disueltos por cierre de su anchor (re-crear / `set-anchor`) y grupos vacíos (`ungroup`). El **orquestador lo invoca cuando está activo** (una línea en su checklist), y queda disponible como CLI manual.

**Cambio de contrato consciente**: re-fronteriza GRP-04 — el launch path sigue SIN gestionar grupos (GRP-01..03 fail-open byte-idénticos), pero la gestión pasa a estar permitida en el carril doctor con allowlist. Resuelve de paso la frontera D-13 de Phase 77 (sesiones adoptadas y ya lanzadas también se agrupan).

**Constraints de diseño (decididos en la conversación de origen, no re-discutir):**

1. **Allowlist no destructivo**: `create`, `add`, `set-anchor`, `ungroup`. `workspace-group delete` NI SE CABLEA (cierra todos los workspaces del grupo) — guard source-hygiene que verifique su ausencia.
2. **0 tokens**: lógica 100% determinista reutilizando `deriveExpectedGroupName` (`src/session/manager.js:143`) y `listWorkspaceGroups` (`src/cmux/client.js`); el LLM no decide nada. Puerta LLM solo si aparece ambigüedad real futura (YAGNI hoy).
3. **El sidebar NO es trigger del orquestador**: la higiene va de piggyback en pases ya motivados por `kodo check` (stuck/review/pending). Consistencia eventual asumida: las sesiones aterrizan sueltas y se agrupan en el siguiente pase.
4. **Política de anchor**: los grupos cmux se disuelven al cerrarse su anchor workspace (verificado en el help de cmux 2026-07-17); el doctor re-crea/re-ancla en el siguiente pase — auto-curación eventual. Candidato: `set-anchor` al miembro más longevo.

**Requirement adicional (pedido explícito del operador 2026-07-20)**: actualizar el **skill de kodo** (`kodo-orchestrate`) y el **prompt del orquestador** (`src/orchestrator/prompt.md`) para (a) invocar `kodo sidebar doctor --fix` cuando el orquestador esté activo, y (b) **reconciliarlos con todos los últimos cambios de v0.17** que hoy no reflejan: handoff acumulativo + `NEXT:` en `state.json` (Phase 74), superficie del `NEXT:` en dashboard y nudge con contexto (Phase 75), `pending_stale`/`pending_fetched_at` en `/status` y convergencia con `kodo check` (Phase 76), agrupación `--group` de workspaces (Phase 77). Misma disciplina anti-deriva que HYG-08 aplicó al README en v0.16.

**Tipo**: Feature + reconciliación documental. Bajo blast radius (módulo nuevo aislado + edición de prompt/skill; el launch path no se toca).
**Depends on**: Phase 77 (shipped 2026-07-17).
**Success Criteria** (what must be TRUE):

  1. `kodo sidebar doctor` (dry-run) lista las acciones pendientes; `--fix` las ejecuta usando exclusivamente los verbos del allowlist; `delete` no aparece en el código (guard automático).
  2. Con el orquestador activo, un sidebar con grupos faltantes o workspaces sueltos converge al estado agrupado en ≤1 pase, sin intervención humana.
  3. El launch path queda byte-idéntico (GRP-01..03 intactos: `--group` solo si el grupo ya existe en el momento del lanzamiento, fail-open).
  4. El skill `kodo-orchestrate` y `src/orchestrator/prompt.md` mencionan el doctor y reflejan las features v0.17 — sin prometer features borradas ni omitir las nuevas.

**Plans**: TBD (no planificar aún)
