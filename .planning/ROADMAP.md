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
- 🚧 **v0.16 Hardening** — Phases 69-72 (in progress)

## Phases

**v0.16 Hardening — remediación de la auditoría adversarial (4 olas por causa raíz, orden risk-graded):**

- [x] **Phase 69: Red y autenticación** - Bind seguro por defecto (`127.0.0.1`) + bearer en el carril no-webhook + límite de body pre-auth + errores 500 neutros + `sessionId` validado (Ola 1 — cierra la única exposición externa) (completed 2026-07-06)
- [ ] **Phase 70: Concurrencia y ciclo de vida de procesos** - `withStateLock` sobre los ~6 escritores + `acquireGsdLock` atómico + PID ownership + un zombi libera su slot de `max_parallel` (Ola 2 — la más delicada)
- [ ] **Phase 71: Fiabilidad de entrega y backstop** - Cursor de polling solo avanza con dispatch confirmado + centinela de primer tick + `adopt` idempotente + backstop mecánico de "In Review" en `SessionEnd` (Ola 3)
- [ ] **Phase 72: Higiene, DX y verdad documental** - Marcador `KODO_ORCHESTRATOR=1` + borrar `up --url`/`startHealthLoop` + efectos de cierre a `SessionEnd` + batch de config/BAJAS + pasada de README (Ola 4 — paralelizable)

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

## Phase Details (v0.16 activo)

### Phase 69: Red y autenticación

**Goal**: Cerrar la superficie de red — el server deja de escuchar en toda interfaz por defecto y el carril no-webhook exige autenticación, sin filtrar datos ni errores a un atacante externo. Es la ola más barata y cierra la única exposición a atacantes externos (causa raíz T3), por eso va primera.
**Depends on**: Nothing (primera fase del milestone; construye sobre el codebase v0.15 shipped)
**Requirements**: NET-01, NET-02, NET-03, NET-04, NET-05, NET-06
**Success Criteria** (what must be TRUE):

  1. Desde otro nodo de la LAN, `GET /status` y `DELETE /sessions/:id` devuelven **401** sin `Authorization: Bearer <token>`; con el token de config responden normal, y el dashboard Ink lo lee de config y lo envía en cada petición. (NET-02)
  2. El server bindea a `127.0.0.1` por defecto (inaccesible desde otra interfaz); poner `config.server.bind` a una IP tailscale lo expone **explícitamente**, y por ese carril el webhook de Plane sigue entrando con su HMAC intacto (topología multi-nodo documentada). (NET-01, NET-06)
  3. Un POST con body de 2 MB se corta con **413** antes de autenticar; `/webhook` conserva HMAC y `/health` sigue abierto sin token. (NET-03, NET-02)
  4. Un error 500 devuelve un mensaje **neutro** al cliente (el `err.message` solo va al log), y un `sessionId` con caracteres fuera de `/^[A-Za-z0-9_-]+$/` se rechaza antes de tocar el filesystem. (NET-04, NET-05)

**Plans**: 4/4 plans complete

Plans:
**Wave 1**

- [x] 69-01-PLAN.md — Auth primitives module (`src/server/auth.js`: parseBearer/timingSafeTokenEqual/isOpenRoute/getOrCreateApiToken/MAX_BODY_BYTES) + `config.server.bind` default (Wave 1)
- [x] 69-03-PLAN.md — Ink dashboard bearer attachment + 401 visible state (`UNAUTHORIZED_MESSAGE`) (Wave 1)
- [x] 69-04-PLAN.md — `sessionId` allowlist guard (reader.js hard / logger.js soft) + README «Topología multi-nodo» (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 69-02-PLAN.md — Server wiring: default-deny bearer middleware + bind host + 1 MB→413 pre-auth + neutral 500 + web-dashboard `?token=` (Wave 2, depends on 69-01)

### Phase 70: Concurrencia y ciclo de vida de procesos

**Goal**: Hacer segura la concurrencia multiproceso sobre `state.json` y el ciclo de vida de PID/procesos — locks reales donde hoy hay escrituras a ciegas, ownership del PID antes de matar nada, y liberación del slot de `max_parallel` cuando una sesión muere (causas raíz T1 y T2). Es la ola más delicada: tocar locks exige tests de proceso real.
**Depends on**: Phase 69 (secuencia risk-graded; Ola 1 cierra la exposición externa antes de tocar los locks delicados — sin acoplamiento de código directo)
**Requirements**: CONC-01, CONC-02, CONC-03, CONC-04, CONC-05, CONC-06, CONC-07, CONC-08, CONC-09
**Success Criteria** (what must be TRUE):

  1. Un test que lanza **2 procesos concurrentes** contra el mismo repo verifica un solo `{acquired:true}`: `acquireGsdLock` es atómico (`flag:'wx'`, `EEXIST`→tomado) con `stealLock` vía tmp+rename, y dos `polling start` concurrentes no arrancan dos daemons (lock `O_EXCL`). (CONC-02, CONC-06)
  2. Los ~6 escritores de `state.json` pasan por `withStateLock(fn)` (re-lee→muta→guarda bajo lockfile `O_EXCL` con retry) — sin escrituras perdidas bajo concurrencia — y el comentario falso "ÚNICO escritor" de `server.js:682` queda corregido en el mismo commit. (CONC-01)
  3. Matar una sesión con `kill -9` → en el siguiente tick reconcile libera su slot: `state:'dead'` deriva `status:'idle'` (o el gate de `max_parallel` filtra por `alive`), y kodo vuelve a admitir sesiones en vez de quedar parado hasta 30 días. (CONC-03)
  4. `teardown` solo borra `kodo.pid` si `payload.pid === process.pid` (el PID se escribe **post-bind**), y antes de un SIGKILL se compara `started_at` del payload con el arranque real (`ps -o lstart=`), abortando si no cuadra — kodo nunca mata un proceso ajeno. (CONC-04, CONC-05)
  5. La migración v1→v2 escribe vía `writeFileAtomic`, el dedup de sesiones no-GSD es cross-proceso (lock por `task_id`), y la ubicación real de los worktrees queda verificada empíricamente con una sesión GSD viva y documentada (cierra M13). (CONC-07, CONC-08, CONC-09)

**Plans**: 4 plans (2 waves)

Plans:
**Wave 1**

- [ ] 70-01-PLAN.md — Primitiva advisory-lock `state-lock.js` (D-01) + `acquireGsdLock` atómico (`flag:'wx'`, `stealLock` tmp+rename) + test de carrera 2 procesos (Criterio 1) — CONC-01, CONC-02 (Wave 1)
- [ ] 70-03-PLAN.md — Guardas de ciclo de vida: zombi libera slot (`alive`), teardown solo borra su PID (post-bind conservado), anti-PID-reuse `ps -o lstart=` pre-SIGKILL, migración config atómica — CONC-03, CONC-04, CONC-05, CONC-07 (Wave 1)

**Wave 2** *(blocked on Wave 1)*

- [ ] 70-02-PLAN.md — `withStateLock` sobre los escritores de `state.json` + reconcile snapshot-fuera/aplica-dentro + corregir comentario falso `server.js` — CONC-01 (Wave 2, depends 70-01)
- [ ] 70-04-PLAN.md — Consumidores de la primitiva: lock `O_EXCL` en `polling start` + dedup no-GSD por `task_id` + verificación empírica de worktrees (checkpoint diferible) — CONC-06, CONC-08, CONC-09 (Wave 2, depends 70-01, 70-03)

### Phase 71: Fiabilidad de entrega y backstop

**Goal**: Garantizar la entrega de dispatches y el cierre del ciclo de vida: el cursor de polling deja de saltarse issues cuyo dispatch no confirmó, y "In Review" gana un backstop mecánico que ya no depende de que el LLM lo haga (causas raíz T4/T5 — fire-and-forget donde hay obligación de entrega, y ciclo de vida delegado al LLM sin fallback).
**Depends on**: Phase 70 (secuencia; Ola 3 reordena `SessionEnd` — mejor sobre los locks/reconcile de Ola 2 ya asentados)
**Requirements**: DELIV-01, DELIV-02, DELIV-03, DELIV-04
**Success Criteria** (what must be TRUE):

  1. Simular un `launchWorkItem` que **rechaza** → el `updated_at` de ese issue NO se incorpora a `maxUpdatedAt` y el issue se reintenta en el siguiente tick (`await` + timeout); el webhook sigue fire-and-forget (Plane re-entrega). (DELIV-01)
  2. El primer tick de polling distingue "cache ausente" de "primer tick observado" vía centinela — no re-dispara todo lo visto ni se salta issues nuevos. (DELIV-02)
  3. `adopt` sobre una tarea ya adoptada (mismo `task_url`) **no crea un duplicado** — busca por `task_url` antes de `createTask`. (DELIV-03)
  4. Matar una sesión sin que el LLM transicione la tarea → al `SessionEnd`, si la tarea sigue "In Progress" y la sesión terminó limpia, el hook la pasa a **"In Review"** y comenta "cierre automático"; la instrucción al LLM pasa a ser optimización, no única vía. (DELIV-04)

**Plans**: TBD

### Phase 72: Higiene, DX y verdad documental

**Goal**: Saldar la higiene mecánica y la deriva documental: quitar features muertas, blindar el auto-commit del stop hook contra commits fantasma, mover los efectos de cierre al hook correcto, endurecer la config, aplicar el batch de BAJAS y reconciliar el README con la realidad del código. Es la ola paralelizable y de menor riesgo.
**Depends on**: Phase 71 (Ola 4 es paralelizable con cualquiera, pero se coloca al final: HYG-04 mueve efectos a `SessionEnd`, el mismo hook que DELIV-04 de Ola 3 reordena — secuenciar evita conflictos de merge)
**Requirements**: HYG-01, HYG-02, HYG-03, HYG-04, HYG-05, HYG-06, HYG-07, HYG-08
**Success Criteria** (what must be TRUE):

  1. El stop hook solo auto-commitea si `KODO_ORCHESTRATOR=1` está presente (inyectada al lanzar el workspace orquestador) y con pathspec completo (`git commit -- .claude/skills/kodo-orchestrate/`) — se acaban los commits fantasma por turno sobre lo que el dev tuviera staged. (HYG-01)
  2. `kodo up --url` y `startHealthLoop` **ya no existen** (borrados, no cableados) y el README no los promete; el coloreado de workspace, notify y nudge se disparan en `SessionEnd`, no en `Stop`. (HYG-02, HYG-03, HYG-04)
  3. El batch de endurecimiento de config está aplicado (rechazo de `__proto__|constructor|prototype`, chmod 0600 si hay `*_secret`, `split` con `join` del resto, B5, B7) y el dashboard hace strip de `\x1b` en el contenido externo (comentarios). (HYG-05, HYG-07)
  4. El batch de BAJAS mecánicas (B1, B2, B3, B4, B8, B9, B12 + M12 `[-–—]` en roadmap) queda aplicado en diffs de 1–5 líneas. (HYG-06)
  5. El README refleja la realidad: stop hook real, `kodo status` vs `dashboard`, rutas `src/providers/…`, owner del repo, comandos indocumentados y `--dangerously-skip-permissions` documentado en sesiones GSD. (HYG-08)

**Plans**: TBD

## Progreso (v0.16)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 69. Red y autenticación | 4/4 | Complete    | 2026-07-06 |
| 70. Concurrencia y ciclo de vida de procesos | 0/4 | Not started | - |
| 71. Fiabilidad de entrega y backstop | 0/? | Not started | - |
| 72. Higiene, DX y verdad documental | 0/? | Not started | - |

## Backlog

### Phase 999.1: kodo bidireccional (PROMOVIDO → v0.13 Phases 52-62, SHIPPED)

_Este backlog item se materializó como el milestone **v0.13 kodo bidireccional** (shipped 2026-06-25) bajo la arquitectura "una fontanería, tres consumidores"._

**Deferido a v2 (trackeado en REQUIREMENTS.md v0.16):** `Retry-After` en 429 del cliente Plane (PLANE-F1/M7) · filtro server-side por label kodo en polling (PLANE-F2/M8) · paginación del listado de work items (PLANE-F3/M9) · reconcile asíncrono fuera del event loop (PERF-F1/M21 — **medir antes de arreglar**).

**Deferred candidates (futuros milestones):** hot-reload de config en server/daemon (CFGF-01) · adapter ClickUp · adapter local (JSON/Markdown) + file watcher · webhook GitHub ingress real-time.
