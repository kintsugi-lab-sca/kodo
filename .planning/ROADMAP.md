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
- 🚧 **v0.14 Configuración editable desde el dashboard** — Phases 63-64 (activo, iniciado 2026-06-29)

## Phases

### 🚧 v0.14 Configuración editable desde el dashboard (Phases 63-64)

**Milestone Goal:** El dashboard TUI pasa de observar+gestionar sesiones a también **configurar kodo** — principalmente añadir/editar la ruta de un proyecto sin re-correr el wizard lineal (donde los proyectos están al final tras pasos obligatorios), más un puñado de ajustes comunes de uso diario. Escritura **local** (filesystem / shell-out a las funciones puras de `src/config.js`), **cero endpoints nuevos** (2ª ruptura consciente de "TUI read-only" tras el dismiss de v0.10), aviso de reinicio (sin hot-reload), API keys intactas en `~/.kodo/.env`.

**Build order (risk-graded):** `fundación + ajustes comunes` → `editor de proyectos`. La **base de bajo nivel** (overlay + text-input editable en ink + fontanería de escritura local no-corruptiva reusando `saveConfig`/`saveProjects`) se construye y se prueba end-to-end con el **editor de ajustes comunes** (carril 100% local, sin conexión al provider, menor riesgo). El **editor de proyectos** (mayor riesgo: depende de `listProjects()` en vivo) es el segundo consumidor que reusa esa base. Numeración **continúa** desde Phase 62 (v0.13) → primera fase **Phase 63** (NO reset). La parte text-input/overlay de Phase 63 es candidata a `/gsd-ui-phase`.

- [ ] **Phase 63: Editor de configuración en el dashboard — fundación + ajustes comunes** — overlay + text-input editable en ink + escritura local no-corruptiva (reuso `saveConfig`), probado con el editor de ajustes comunes (claude model/max_parallel, states, server thresholds, cmux colors) — UX-01..04, CFG-01..05, PERSIST-01..05
- [ ] **Phase 64: Editor de proyectos en el dashboard** — lista `listProjects()` en vivo + mapear/editar/quitar ruta local (+ módulos), reusando la fundación de Phase 63; degrada con gracia si el provider cae — PROJ-01..05

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

## Phase Details

### Phase 63: Editor de configuración en el dashboard — fundación + ajustes comunes

**Goal**: El operador edita los ajustes comunes de kodo desde el dashboard mediante un overlay con campo de texto editable, y los cambios se persisten localmente a `~/.kodo/config.json` de forma no-corruptiva, sin re-correr `kodo config` ni añadir endpoints al server. Esta fase construye la **base de bajo nivel** del milestone — el overlay de configuración (UX-01), el componente de text-input editable en ink (UX-02, patrón de UX NUEVO: los overlays actuales `c`/`l`/`p` son read-only), el cancel que preserva la selección (UX-03), la degradación never-throws (UX-04), y la fontanería de escritura local no-corruptiva reusando `saveConfig`/`loadConfig` (PERSIST-01..05) — y la prueba end-to-end con el editor de **ajustes comunes** (carril 100% local, sin conexión al provider, menor riesgo). El sub-trabajo text-input/overlay es candidato a `/gsd-ui-phase`.
**Depends on**: Nothing (primera fase de v0.14; reusa `loadConfig`/`saveConfig` + `migrateConfig` de `src/config.js` y la infra de overlays `mode:` del dashboard `useInput` mode-gated)
**Requirements**: UX-01, UX-02, UX-03, UX-04, CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, PERSIST-01, PERSIST-02, PERSIST-03, PERSIST-04, PERSIST-05
**Success Criteria** (what must be TRUE):

  1. El operador pulsa una tecla dedicada en el dashboard y se abre un overlay de edición de configuración, sin salir del dashboard ni re-correr `kodo config`. (UX-01)
  2. El operador escribe/edita un valor en un campo de texto en ink (cursor, backspace) y lo confirma; o pulsa `Esc` para cancelar sin guardar y volver al dashboard con la misma sesión seleccionada por identidad `task_id`. (UX-02, UX-03)
  3. El operador edita `claude.default_model`/`max_parallel`, `states.trigger`/`review`/`done`, `server.idle_threshold_min`/`stuck_threshold_min` y `cmux.colors`; un valor inválido (p.ej. `max_parallel`/thresholds no enteros positivos, `default_model` fuera del set conocido) se rechaza con mensaje y el archivo NO se escribe. (CFG-01..05)
  4. Al guardar, el cambio se persiste a `~/.kodo/config.json` vía `saveConfig` (preservando formato y migración de schema), de forma **local sin endpoint nuevo** en `src/server.js`, y el dashboard avisa de reiniciar server/daemon para aplicar (sin hot-reload). (PERSIST-01, PERSIST-02, PERSIST-03)
  5. Ante un error (config ilegible, escritura fallida) el dashboard degrada con gracia — never-throws, el panel ink permanece montado, el `config.json` previo se preserva intacto (escritura no-corruptiva), y las API keys nunca se muestran ni se editan (siguen solo en `~/.kodo/.env`). (UX-04, PERSIST-04, PERSIST-05)

**Plans**: 3/3 plans complete
Plans:
**Wave 1**

- [x] 63-01-PLAN.md — Fundación pura: validadores (config-validate.js) + escritura atómica (writeFileAtomic) [Wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 63-02-PLAN.md — Editor UI: modos config/config-edit + text-input con cursor + validación/guardado (App.js, SessionTable.js) [Wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 63-03-PLAN.md — Cableado DI end-to-end (index.js) + checkpoint humano [Wave 3]

**UI hint**: yes

### Phase 64: Editor de proyectos en el dashboard

**Goal**: El operador añade, edita o quita el mapeo de un proyecto del provider a una ruta local (+ módulos opcionales) desde el dashboard, reusando la fundación de edición de Phase 63 y la lista en vivo `listProjects()`, persistiendo a `~/.kodo/projects.json`. Es el carril de **mayor riesgo** (depende de conexión al provider) y debe degradar con gracia si la conexión falla. Resuelve la fricción central del milestone: añadir un proyecto sin pasar por proveedor/api-key/workspace primero en el wizard lineal.
**Depends on**: Phase 63 (reusa el overlay + text-input + la fontanería de escritura local no-corruptiva; aquí el destino es `saveProjects`/`loadProjects`)
**Requirements**: PROJ-01, PROJ-02, PROJ-03, PROJ-04, PROJ-05
**Success Criteria** (what must be TRUE):

  1. El operador ve la lista de proyectos del provider en vivo (`listProjects()` Plane/GitHub) con su estado de mapeo actual (ruta local o "sin mapear"). (PROJ-01)
  2. El operador asigna o edita la ruta local de un proyecto y la ruta se valida (debe existir en el filesystem) antes de aceptarse. (PROJ-02)
  3. El operador quita el mapeo de un proyecto (lo deja sin seguir) y, opcionalmente, mapea carpetas de módulos independientes, espejo del soporte de módulos del wizard. (PROJ-03, PROJ-04)
  4. Los cambios se persisten a `~/.kodo/projects.json` vía `saveProjects` (local, sin endpoint nuevo, no-corruptivo) con el mismo aviso de reinicio que el editor de ajustes. (reuso de la base PERSIST de Phase 63)
  5. Si `listProjects()` falla (sin conexión / provider caído), el editor lo comunica y permite reintentar o salir, sin crashear (never-throws, panel ink montado) ni corromper el mapeo existente. (PROJ-05)

**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 63 → 64

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 63. Editor config — fundación + ajustes comunes | 3/3 | Complete   | 2026-06-29 |
| 64. Editor de proyectos | 0/TBD | Not started | - |

## Backlog

### Phase 999.1: kodo bidireccional (PROMOVIDO → v0.13 Phases 52-62, SHIPPED)

_Este backlog item se materializó como el milestone **v0.13 kodo bidireccional** (shipped 2026-06-25) bajo la arquitectura "una fontanería, tres consumidores"._

**Deferred candidates (futuros milestones):** hot-reload de config en server/daemon (CFGF-01) · `kodo config` CLI no-lineal compartiendo fontanería con el editor del dashboard (CFGF-02) · edición TUI de campos estructurales del provider `base_url`/`workspace_slug`/`api_key_env`/provider activo (CFGF-03) · adapter ClickUp · adapter local (JSON/Markdown) + file watcher · webhook GitHub ingress real-time.
