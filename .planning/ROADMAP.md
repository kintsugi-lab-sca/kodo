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
- ✅ **v0.18 Higiene del sidebar de cmux** — Phases 79-81 (shipped 2026-07-24)
- 🚧 **v0.19 Inbox de capturas + fix stealLock + saneo de deuda** — Phases 82-85 (en curso desde 2026-07-24)

> **Phase 73 quemada.** Se creó y se retiró por eliminación el 2026-07-14 (el nudge genérico que pretendía debouncear se borró entero, commit `f4df750`). El número NO se reutiliza: la numeración salta de 72 a 74. La Phase 73 no vuelve a usarse — v0.18 continuó desde la Phase 79 (última shipped: Phase 78) y v0.19 continúa desde la Phase 82 (última shipped: Phase 81).

## Active Milestone: v0.19 Inbox de capturas + fix stealLock + saneo de deuda

**Milestone Goal:** Dar a kodo su primer buffer de captura global (candidata backlog 999.2 promovida), cerrar con un fix real la carrera de `stealLock` diagnosticada en v0.18 (decisión R-81-01 resuelta por el mantenedor 2026-07-24 = fix, no aceptación), y saldar la deuda doc/Nyquist acumulada de v0.16 y v0.18. Tres workstreams independientes; el inbox es la única feature nueva (superficie aislada: comando + skill + fichero, bajo blast radius).

**Granularidad:** `coarse` → 4 fases. **Cobertura:** 15/15 requirements mapeados.

- [x] **Phase 82: Fix de la carrera de `stealLock`** - Cerrar con un fix real la ventana no-atómica move-aside→`O_EXCL` de `stealLock` y greenear `gsd-lock-race` — LOCK-01..03 (completed 2026-07-25)
- [ ] **Phase 83: Inbox foundation — captura + triage** - Store + `kodo capture` (append atómico) + `kodo inbox` triage (list/mark sin borrar) + seam de enrutado a `gsd-capture` — CAPT-01, CAPT-03, CAPT-04, CAPT-06
- [ ] **Phase 84: Superficies de captura — skill, sync, conteo ambient** - `/kodo-capture` mid-session + `kodo skill sync` multi-skill + conteo de capturas sin enrutar en el dashboard — CAPT-02, CAPT-05, CAPT-07
- [ ] **Phase 85: Saneo de deuda + Nyquist retroactivo** - Deuda doc de v0.18 (WR-01/WR-02, 80-REVIEW) + Nyquist retroactivo de 79/80/81 y 69/71/72 — DEBT-05..07, NYQ-01, NYQ-02

## Phase Details

### Phase 82: Fix de la carrera de `stealLock`

**Goal**: Con N≥2 procesos robando el mismo lock GSD muerto, exactamente uno adquiere — la ventana no-atómica move-aside→`O_EXCL` de `stealLock` queda cerrada con un fix real (no enmascarando) y el test lo prueba en verde de forma determinista.
**Depends on**: Nada (workstream independiente; resuelve R-81-01, decisión del mantenedor 2026-07-24 = fix real, coherente con el espíritu hardening de v0.16/v0.18)
**Requirements**: LOCK-01, LOCK-02, LOCK-03
**Success Criteria** (what must be TRUE):

  1. Ejecutar N≥2 procesos que roban el mismo lock GSD muerto resulta en exactamente una adquisición — nunca dos (la ventana no-atómica move-aside→`O_EXCL` de `stealLock`, `src/gsd/lock.js:283-351`, está cerrada). (LOCK-01)
  2. El test `gsd-lock-race` pasa verde de forma determinista en ejecuciones repetidas, validando la garantía real sin debilitar el assert ni enmascarar la carrera (constraint heredado de DEBT-04: greenear enmascarando está prohibido). (LOCK-02)
  3. La suite completa sigue verde tras el fix, sin regresiones en el resto de `src/gsd/lock.js` ni en sus consumidores.
  4. R-81-01 y la debug session `gsd-lock-race-cr01` figuran formalmente cerradas con la resolución documentada (STATE.md Deferred Items + fichero de la debug session). (LOCK-03)

**Plans**: 2 plans
**Wave 1**

- [x] 82-01-PLAN.md — Reescribir `stealLock` (steal-guard `O_EXCL` + reemplazo in-place atómico) + unit tests del guard + docblock (LOCK-01, LOCK-02) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 82-02-PLAN.md — Evidencia de verde determinista bajo estrés + cierre documental (debug session → resolved/, fila STATE.md) (LOCK-02, LOCK-03) [wave 2]

### Phase 83: Inbox foundation — captura + triage

**Goal**: kodo gana su primer buffer de captura global — `kodo capture "idea"` appendea una línea atómica a `~/.kodo/inbox.md` y `kodo inbox` lista y marca capturas (`enrutada`/`descartada`) sin borrarlas jamás. Aquí se concentra el riesgo de concurrencia: el modelo de estado se decide explícitamente antes de construir cualquier consumidor.
**Depends on**: Nada dura (superficie nueva aislada). Reutiliza `withFileLock` (`src/session/state-lock.js:215`, NO `src/gsd/lock.js`), `stripForKeystroke` (`src/cli/format.js`) y la resolución cwd→proyecto de `src/cli/adopt.js`
**Requirements**: CAPT-01, CAPT-03, CAPT-04, CAPT-06
**Success Criteria** (what must be TRUE):

  1. `kodo capture "idea"` desde cualquier proyecto añade a `~/.kodo/inbox.md` una línea `texto · tag-proyecto · fecha · origen`; N capturas concurrentes producen N líneas sin pérdidas (append atómico O_APPEND, nunca `writeFileAtomic`) y el texto queda saneado a una sola línea vía `stripForKeystroke`. (CAPT-01)
  2. `kodo inbox` lista las capturas abiertas y permite marcar cada una como `enrutada`/`descartada` sin borrarla jamás — se conserva la traza permanente de qué se convirtió en qué. (CAPT-03)
  3. Una captura concurrente durante el marcado nunca se pierde; el modelo de estado (lock compartido `withFileLock` vs event-log append-only) queda decidido explícitamente en discuss-phase, no por defecto silencioso de un implementador. (CAPT-03)
  4. Una captura `enrutada` conserva un trace pointer `→ destino` en su línea cuando el flujo de enrutado aporta una ref barata; si `gsd-capture` no devuelve ref, la marca `enrutada` queda sin destino sin bloquear el enrutado (best-effort explícito). (CAPT-06)
  5. La documentación describe el seam de enrutado (`kodo inbox` → `/gsd-capture` → marcar `enrutada`) delegando el «a dónde va» en `gsd-capture`, sin import ni reimplementación de su lógica de destinos en kodo. (CAPT-04)

**Plans**: 3 plans

**Wave 1**

- [x] 83-01-PLAN.md — `src/inbox/store.js`: codec, parser anclado a cola, reader never-throws, append `O_APPEND` con fail-open y marcado RMW bajo lock con unique-tmp + rename (CAPT-01, CAPT-03, CAPT-06) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 83-02-PLAN.md — Superficie CLI: `kodo capture` + `kodo inbox` (listado human/`--json`, `route`, `discard`), registro commander e integración por proceso real (CAPT-01, CAPT-03, CAPT-04, CAPT-06) [wave 2]
- [x] 83-03-PLAN.md — Evidencia de concurrencia con procesos reales (D-21: N→N y captura durante el marcado) + documentación del seam de enrutado (CAPT-01, CAPT-03, CAPT-04) [wave 2]

### Phase 84: Superficies de captura — skill, sync, conteo ambient

**Goal**: La captura mid-session y la presión de triage cierran el ciclo — `/kodo-capture` captura desde dentro de una sesión Claude Code con formato byte-idéntico al CLI, y el operador ve el conteo de capturas sin enrutar como superficie ambient contra el inbox rot.
**Depends on**: Phase 83 (el skill shellea el `kodo capture` ya shippeado — jamás escribe el fichero; el conteo lee el formato de `~/.kodo/inbox.md` ya definido)
**Requirements**: CAPT-02, CAPT-05, CAPT-07
**Success Criteria** (what must be TRUE):

  1. `/kodo-capture` captura mid-session derivando proyecto/tarea del contexto de sesión de forma determinista y shelleando a `kodo capture`; el formato de línea es byte-idéntico al del CLI (un solo writer — el skill jamás escribe `inbox.md` directamente), verificado con golden test skill-path↔CLI-path. (CAPT-02)
  2. `kodo skill sync` distribuye tanto `kodo-orchestrate` como `kodo-capture` — el mecanismo hoy single-skill queda generalizado a multi-skill de forma explícita. (CAPT-05)
  3. El operador ve en el dashboard TUI el conteo de capturas sin enrutar, leído de `~/.kodo/inbox.md` (reader leaf never-throws, cero endpoints nuevos en `src/server.js`) — presión ambient contra el inbox rot. (CAPT-07)

**Plans**: TBD

### Phase 85: Saneo de deuda + Nyquist retroactivo

**Goal**: La deuda documental de v0.18 y la columna Nyquist de v0.16+v0.18 quedan saldadas — barrido ligero, mayormente mecánico y doc-only.
**Depends on**: Nada (workstream independiente; doc/debt sweep)
**Requirements**: DEBT-05, DEBT-06, DEBT-07, NYQ-01, NYQ-02
**Success Criteria** (what must be TRUE):

  1. El typedef `TaskHandoff` (`src/session/state.js`) documenta la semántica post-DEBT-01 — el contrato tres-estados del `next` por presencia del campo (string sobrescribe / `null` borra / ausente preserva) — cerrando 81-REVIEW WR-01. (DEBT-05)
  2. `deriveAnyNext` (`src/cli/dashboard/select.js`) colapsa whitespace al decidir la presencia de la columna `next`, coherente con el render de `nextCell`; con la crit 1 salda R-81-02, cerrando 81-REVIEW WR-02. (DEBT-06)
  3. Los 3 warnings de 80-REVIEW.md (observabilidad/cobertura) quedan resueltos o re-aceptados individualmente con razón documentada. (DEBT-07)
  4. Phases 79/80/81 tienen `VALIDATION.md` `nyquist_compliant: true` citation-based (`/gsd-validate-phase` retroactivo, evidencia de la suite existente sin re-derivar). (NYQ-01)
  5. Phases 69/71/72 tienen `VALIDATION.md` `nyquist_compliant: true` citation-based — salda la columna Nyquist de v0.16 en Deferred Items. (NYQ-02)

**Plans**: TBD

## Phases

<details>
<summary>✅ v0.18 Higiene del sidebar de cmux (Phases 79-81) — SHIPPED 2026-07-24</summary>

**Milestone Goal:** Quitar al humano (y al launch path) la carga de mantener el sidebar de cmux — un doctor determinista (0 tokens) lo detecta y corrige con allowlist no destructivo, el orquestador lo invoca de piggyback en pases ya motivados por `kodo check` (el sidebar NO es trigger), skill `kodo-orchestrate` + `prompt.md` se reconcilian con la realidad post-v0.17, y se salda la deuda menor del audit v0.17.

- [x] Phase 79: Sidebar Doctor (4/4 plans) — SDR-01..06 ✅ 2026-07-23 (G-79-1 cerrado: `missing_group` report-only/advisory, ratificado por checkpoint)
- [x] Phase 80: Carril orquestador + reconciliación documental (2/2 plans) — ORCH-07, ORCH-08 ✅ 2026-07-23
- [x] Phase 81: Saneo de deuda v0.17 (3/3 plans) — DEBT-01..04 ✅ 2026-07-24 (DEBT-04: carrera real en `stealLock` diagnosticada; fix → decisión de mantenedor, R-81-01)

Archivo: `milestones/v0.18-ROADMAP.md` · Requirements: `milestones/v0.18-REQUIREMENTS.md` · Audit: `milestones/v0.18-MILESTONE-AUDIT.md`

</details>

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
Detalle completo de las fases 79-81: ver `milestones/v0.18-ROADMAP.md`.

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.19 Inbox de capturas + fix stealLock + saneo de deuda | 82-85 | 0/TBD | In progress | - |
| v0.18 Higiene del sidebar de cmux | 79-81 | 9/9 | Complete | 2026-07-24 |
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

### Phase 999.2: Inbox de capturas global — feature (PROMOVIDO → v0.19 Phases 83-84)

> **Renumerado 2026-07-15:** este item se llamaba «Phase 75» en el backlog. Al promover la candidata Phase 74 a fase activa, v0.17 ocupó 74-76 y el número 75 quedaría ambiguo. Se renumeró a 999.2 siguiendo la convención de placeholders del backlog (999.x). Promovido a fases reales al abrir v0.19 (2026-07-24).

_Esta candidata se materializó como el núcleo del milestone **v0.19 Inbox de capturas + fix stealLock + saneo de deuda** (en curso desde 2026-07-24). El store + `kodo capture` + `kodo inbox` triage → **Phase 83** (CAPT-01/03/04/06); el skill `/kodo-capture` + generalización de `kodo skill sync` + conteo ambient en el dashboard → **Phase 84** (CAPT-02/05/07). La candidata trazaba CAPT-01..04; el milestone amplió el scope con **CAPT-05** (skill-sync multi-skill), **CAPT-06** (trace pointer best-effort) y **CAPT-07** (superficie ambient contra el inbox rot). Detalle vivo en `## Phase Details`._

**Constraints heredados (research SUMMARY 2026-07-24, no re-discutir a ciegas):**

- Cero deps npm nuevas · cero endpoints nuevos en `src/server.js` (el dashboard lee filesystem).
- Primitiva de lock del inbox = `withFileLock` (`src/session/state-lock.js:215`), **NUNCA** `src/gsd/lock.js` (ése es el lock per-repo GSD que arregla la Phase 82 — el inbox no debe acoplarse a él).
- Nunca `writeFileAtomic` (fixed tmp) para paths del inbox: los appends usan `O_APPEND`; cualquier rewrite usa unique-tmp-name + rename (patrón en `src/hooks/session-end.js:331-389`).
- El skill `/kodo-capture` shellea `kodo capture`, jamás escribe el fichero (single-writer-by-construction + golden test).
- El enrutado lo hace `gsd-capture`, no una reimplementación en kodo (CAPT-04, seam documental).
- **Decisión abierta a resolver en discuss/plan de Phase 83** (no defaultear silenciosamente): modelo de estado del marcado — lock compartido `withFileLock` + token in-place vs. event-log append-only.

**Diferido a v2 (trazado en REQUIREMENTS.md):** filtro `--project`/`--open` en `kodo inbox` (CAPT-F1, solo con volumen real) · archival/rotación del inbox (CAPT-F2, solo si el fichero crece hasta molestar).

### Phase 999.3: Higiene del sidebar de cmux (PROMOVIDO → v0.18 Phases 79-81, SHIPPED)

_Esta candidata se materializó como el milestone **v0.18 Higiene del sidebar de cmux** (shipped 2026-07-24). El `kodo sidebar doctor` + su re-fronterización de GRP-04 → **Phase 79**; el carril orquestador + reconciliación skill/prompt → **Phase 80**. Los 4 items de deuda menor del audit v0.17 entraron con ella como **Phase 81** (DEBT-01..04)._

**Constraints LOCKED heredados a v0.18 (histórico):** allowlist no destructivo `create`/`add`/`set-anchor`/`ungroup` sin `delete` (guard source-hygiene) · 0 tokens (determinista, reutiliza `deriveExpectedGroupName` + `listWorkspaceGroups`) · el sidebar NO es trigger del orquestador (piggyback en `kodo check`) · launch path byte-idéntico (GRP-01..03 fail-open) · política de anchor por re-anclaje eventual.
