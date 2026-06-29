---
gsd_state_version: 1.0
milestone: v0.14
milestone_name: Configuración editable desde el dashboard
current_phase: 63
current_phase_name: editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co
status: executing
stopped_at: Phase 63 context gathered
last_updated: "2026-06-29T13:34:55.396Z"
last_activity: 2026-06-29
last_activity_desc: Phase 63 execution started
progress:
  total_phases: 2
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# Project State

**Project:** kodo
**Active milestone:** **v0.14 Configuración editable desde el dashboard** (iniciado 2026-06-29, roadmap creado). El dashboard TUI gana la capacidad de **configurar kodo** sin re-correr el wizard lineal: editor de proyectos (listar del provider + mapear ruta/módulos → `~/.kodo/projects.json`) y editor de ajustes comunes (claude model/max_parallel, states, server thresholds, cmux colors → `~/.kodo/config.json`). 2 phases (63-64), 19/19 requirements mapeados, 100% cobertura. Escritura local, cero endpoints nuevos, aviso de reinicio, API keys intactas.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-29 — Current Milestone: v0.14 Configuración editable desde el dashboard).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9 añadió observabilidad en terminal (`kodo dashboard`); v0.10 la promovió a gestión (dismiss); v0.11 abrió la ventana al plan; v0.12 profundizó desde la fila (abrir la tarea + progreso vivo); v0.13 cerró el puente inverso `sesión → tarea`. **v0.14 promueve el dashboard a superficie de configuración** de kodo.

**Current focus:** Phase 63 — editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co

## Current Position

Phase: 63 (editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 63
Last activity: 2026-06-29 — Phase 63 execution started

## Roadmap v0.14 (active)

Build order (risk-graded): **fundación + ajustes comunes (carril 100% local, menor riesgo) → editor de proyectos (mayor riesgo, `listProjects()` en vivo)**. La base de bajo nivel — overlay de configuración + text-input editable en ink + fontanería de escritura local no-corruptiva (reuso de `saveConfig`/`saveProjects` de `src/config.js`) — se construye y se prueba end-to-end con el editor de ajustes comunes (todo local), luego el editor de proyectos la reusa. Numeración **continua** desde Phase 62 (v0.13) → primera fase **Phase 63** (NO reset). El sub-trabajo text-input/overlay de Phase 63 es candidato a `/gsd-ui-phase`.

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 63. Editor config — fundación + ajustes comunes | Overlay + text-input editable en ink + escritura local no-corruptiva (reuso `saveConfig`), probado con el editor de ajustes comunes (claude model/max_parallel, states, server thresholds, cmux colors → `config.json`) | UX-01..04, CFG-01..05, PERSIST-01..05 (14) | medio (text-input es patrón de UX NUEVO; los overlays actuales son read-only) |
| 64. Editor de proyectos | Lista `listProjects()` en vivo + mapear/editar/quitar ruta local (+ módulos) → `projects.json`, reusando la fundación de 63; degrada con gracia si el provider cae | PROJ-01..05 (5) | mayor (depende de conexión al provider en vivo) |

- **Fundación antes que el segundo consumidor (63 antes de 64):** la base de bajo nivel (overlay + text-input + escritura local) vive en Phase 63 y se prueba con el editor de ajustes comunes (carril 100% local, sin provider). El editor de proyectos (64) la reusa para mapear rutas. Dentro de Phase 63, plan-phase debe secuenciar el text-input/overlay PRIMERO (es la pieza de UX nueva y candidata a `/gsd-ui-phase`).
- **2ª ruptura consciente de "TUI read-only":** el dismiss de sesiones dead (v0.10) fue la 1ª; este editor es la 2ª. La config NO vive en el server (vive en `~/.kodo/config.json` + `projects.json`), así que el dashboard la escribe **localmente** (filesystem / shell-out a las funciones puras de `src/config.js`) — preserva "cero endpoints nuevos desde v0.10". Precedente directo: la tecla `a` de v0.13 ya escribe shelleando `kodo adopt` vía `execFile`.
- **El editor de proyectos requiere conexión** (`listProjects()` en vivo, uno de los 9 métodos FROZEN); por eso es el carril de mayor riesgo y DEBE degradar con gracia (PROJ-05) — TUI never-throws sigue en pie.

## Most recent shipped milestone

**v0.13 kodo bidireccional** — shipped 2026-06-25 (11 phases 52-62, 17 plans, UAT 4/4). Flujo inverso `sesión → tarea`: una sesión Claude Code ad-hoc de cmux se promueve a tarea persistente del gestor. Arquitectura "una fontanería 0-token (`createTask` + `adoptSession`), tres consumidores" (CLI `kodo adopt`, tecla `a` del dashboard, orquestador asistido por LLM). El cierre (Phase 62, ORCH-02) movió la derivación inteligente de título/descripción al dashboard, superando el bloqueo de UAT de ORCH-01.

- Roadmap archive: `milestones/v0.13-ROADMAP.md`
- Requirements archive: `milestones/v0.13-REQUIREMENTS.md`
- Audit: `milestones/v0.13-MILESTONE-AUDIT.md`

## Deferred Items

Reset al baseline de v0.14. La deuda de v0.12/v0.13 quedó saldada al cierre de v0.13: DEBT-01 (XSS WR-01, mitigado + test de regresión), DEBT-02 (HUMAN-UAT 50.1, ✅ PASSED 2026-06-23), y la deuda Nyquist de v0.11 (Phases 44/45/46) saldada en Phase 51 de v0.12. No hay items diferidos abiertos heredados que bloqueen v0.14.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| — | (ninguno abierto al iniciar v0.14) | — | — |

## Accumulated Context

### Decisions (Roadmap v0.14)

- **Numeración continua (NO reset):** v0.14 continúa desde Phase 62 (v0.13) → primera fase es **Phase 63**.
- **Fundación + ajustes comunes plegados en UNA fase (63), no en dos:** granularidad `coarse` (2-4 phases). Una fase de fundación pura (solo plumbing, sin nada editable observable) sería un anti-patrón de capa horizontal con criterios que leen como tareas; en su lugar, la base (overlay + text-input + escritura local) se construye Y se prueba end-to-end editando los ajustes comunes (carril 100% local, menor riesgo). El sub-trabajo text-input/overlay queda señalado como candidato a `/gsd-ui-phase` dentro de la fase.
- **Editor de proyectos como segunda fase (64), de mayor riesgo:** depende de `listProjects()` en vivo (conexión al provider) — superficie de riesgo distinta del editor 100% local de ajustes. Merece su propia fase para aislar la degradación-con-gracia (PROJ-05) y la validación de rutas en filesystem. Reusa la fundación de 63 (overlay + text-input + escritura no-corruptiva), nunca la reimplementa.
- **Escritura LOCAL, cero endpoints nuevos (invariante LOCKED preservado):** el dashboard persiste reusando `saveConfig`/`saveProjects` de `src/config.js` (filesystem / shell-out), nunca un `POST /config` en `src/server.js`. 2ª ruptura consciente de "TUI read-only" tras el dismiss de v0.10; precedente: la tecla `a` de v0.13 ya escribe shelleando `kodo adopt` vía `execFile`.
- **API keys intactas (invariante de seguridad LOCKED):** el editor NUNCA muestra ni edita secrets; siguen viviendo exclusivamente en `~/.kodo/.env`. PERSIST-04 lo enfuerza por construcción (no hay campo editable de keys).
- **Escritura no-corruptiva (PERSIST-05):** si la escritura falla, el `config.json`/`projects.json` previo se preserva intacto — nunca un archivo a medias. Apoyado en la atomicidad ya usada por la fontanería de v0.13 (`adoptSession` escribió atómico).
- **Text-input en ink es patrón de UX NUEVO:** los overlays actuales (`c`/`l`/`p`) son read-only y la única mutación previa (dismiss) es un double-confirm sin texto. Capturar rutas/valores requiere un componente de text-input controlado (vía `useInput` o dep tipo `ink-text-input`) — decisión de diseño a resolver en `/gsd-discuss-phase 63` (componente controlado propio vs dependencia).

### Roadmap Evolution

- **v0.14 roadmap creado (2026-06-29):** 2 phases (63-64), numeración continua desde v0.13 (NO reset). Build order fundación+ajustes comunes (local, menor riesgo) → editor de proyectos (mayor riesgo, `listProjects()` en vivo). 19/19 requirements mapeados, 100% cobertura, 0 duplicados. Granularidad `coarse`.
- **v0.13 roadmap creado (2026-06-15):** 7 phases base (52-58) → expandido a 11 (52-62) durante ejecución. Arquitectura "una fontanería, tres consumidores".
- **v0.12 roadmap creado (2026-06-11):** 4 phases (48-51). Build order OPEN CORE → SPIKE → DISPLAY CONDICIONAL → NYQUIST.

### Open Blockers

Ninguno. v0.13 cerró sin deuda viva heredada que bloquee v0.14.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 63 (decisión de diseño central):** componente de text-input — ¿controlado propio (gestionado vía `useInput`, sin dep nueva, máximo control) o dependencia `ink-text-input` (más rápido, 5ª dep prod)? Forma del overlay de configuración (un único overlay con secciones navegables vs sub-overlays por grupo). Reglas exactas de validación por campo (`max_parallel`/thresholds enteros positivos; set conocido de `default_model`; formato de `cmux.colors`). Cómo se materializa el "aviso de reinicio" (footer transitorio vs línea persistente). Mecanismo de escritura: filesystem directo vía `saveConfig` (in-process) vs shell-out a `kodo config` (espejo del precedente `kodo adopt`).
- **Phase 64:** UX del flujo lista→selección→edición de ruta (overlay anidado vs reuso del text-input de 63). Si `listProjects()` se cachea o se refetcha en cada apertura. Modos de fallo concretos del provider (timeout, sin auth, sin conexión) y su copy de degradación. Validación de existencia de ruta (`existsSync` síncrono vs check más rico). Forma exacta del soporte de módulos (espejo del wizard).

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState/createTask opcionales** (canonical en `src/interface.js`): `TASK_PROVIDER_METHODS` FROZEN en 9. v0.14 reusa `listProjects()` (uno de los 9) en vivo para el editor de proyectos — NO añade métodos.
- **Cero endpoints nuevos desde v0.10:** **v0.14 lo preserva — la escritura de config es LOCAL (filesystem / shell-out a `src/config.js`), nunca `POST /config` en `src/server.js`.**
- **TUI never-throws** (el editor degrada con gracia, el panel ink permanece montado ante config ilegible / provider caído / escritura fallida — UX-04, PROJ-05) · **Selección por identidad `task_id`** (preservada al entrar/salir del editor — UX-03) · **API keys solo en `~/.kodo/.env`** (nunca editadas ni mostradas — PERSIST-04, invariante de seguridad) · **Escritura no-corruptiva** (el archivo previo se preserva si falla — PERSIST-05).
- **Color isolation** (`picocolors` solo desde `src/cli/format.js`; el dashboard usa color solo de `<Text>` de ink) · **`--json` byte-determinismo** (DX-06) · **Tokens: vigilante/server 0 tokens; solo el orquestador usa LLM** (el editor es determinista, no usa LLM) · **`execFile` fire-and-forget sin shell** (si se opta por shell-out a `kodo config`, argv literal nunca shell) · **`reconcileTick` único escritor de `alive`** · **Worktree always-on (Phase 18)** · **LOG-12 guard** · **Todo lo cmux-específico entra por `HostProvider`**. v0.14 no rompe estos carriles.

## Session Continuity

**Resume file:** .planning/phases/63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co/63-CONTEXT.md

- **Last session:** 2026-06-29T12:56:06.807Z
- **Stopped at:** Phase 63 context gathered
- **Next action:** `/gsd-plan-phase 63` (o `/gsd-discuss-phase 63` primero para resolver la decisión de diseño del text-input: componente controlado propio vs dep `ink-text-input`). La parte text-input/overlay de Phase 63 es candidata a `/gsd-ui-phase`.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.14 Configuración editable desde el dashboard)
  - `.planning/ROADMAP.md` (v0.14 activo Phases 63-64; v0.10-v0.13 colapsados/archivados)
  - `.planning/REQUIREMENTS.md` (v0.14, traceability 19/19 → Phases 63-64)
  - `.planning/MILESTONES.md` (entrada v0.13 completa)

## Operator Next Steps

- Planificar la primera fase con `/gsd-plan-phase 63` (opcionalmente `/gsd-discuss-phase 63` antes para la decisión de diseño del text-input).
