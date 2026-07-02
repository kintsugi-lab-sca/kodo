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
- 🚧 **v0.15 «kodo up» — arranque unificado + onboarding dashboard-first** — Phases 65-68 (ACTIVE, iniciado 2026-07-01)

## Phases

### v0.15 «kodo up» — ACTIVE (Phases 65-68)

**Milestone Goal:** kodo se pone a andar con un solo comando (`kodo up`): arranca el daemon **desacoplado** (server + polling compuestos en un proceso) en background y engancha el dashboard como **visor**; distribuible por Homebrew (`brew install` + `brew services`), y configurable de principio a fin desde el dashboard (incluida la API key enmascarada, con el boundary PERSIST-04). Dos pilares con dependencia estricta: **Pilar 1** (UP + DIST — ciclo de vida + distribución, shippable solo) **antes de** **Pilar 2** (SETUP — onboarding dashboard-first, requiere Pilar 1).

- [ ] **Phase 65: Daemon Lifecycle Foundation** - `src/daemon/` (lifecycle + `kodo daemon run` foreground) + refactor `startServer({managed})` sin `process.exit`/PID propio; `kodo start` legacy intacto — UP-04, UP-06
- [ ] **Phase 66: `kodo up` + Stop/Status unificados + Homebrew** - `kodo up` (daemon desacoplado + attach dashboard, idempotente) + `stop`/`status` unificados + `brew install`/`brew services` (plist invoca `kodo daemon run`) + Windows fallback — UP-01, UP-02, UP-03, UP-05, DIST-01, DIST-02, DIST-03
- [ ] **Phase 67: Secrets Writer + Masked Input** - `writeEnvVar` (atómico + chmod 0600 pre-rename + merge) + campo enmascarado (extiende el text-input de Phase 63) + grep de higiene + indicador "configurado" (presencia sin revelar) — SETUP-03, SETUP-04
- [ ] **Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run** - primer arranque sin config → dashboard en modo setup (sin `exit(1)`) + edición provider/base_url/workspace_slug → `config.json` + `kodo config` rewired al mismo writer — SETUP-01, SETUP-02, SETUP-05

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

## Phase Details (v0.15 activo)

### Phase 65: Daemon Lifecycle Foundation

**Goal**: El daemon puede correr como un proceso foreground supervisable — la base estable sobre la que se construye `kodo up`. Se refactoriza `startServer` a modo managed (sin `process.exit`, sin PID propio, con handler `'error'` para EADDRINUSE) y se centraliza el ciclo de vida en `src/daemon/`, todo sin alterar el `kodo start` legacy. Es la integración de mayor riesgo del milestone y por eso va primera (Pilar 1a).
**Depends on**: Nothing (primera fase del milestone; construye sobre el codebase v0.14)
**Requirements**: UP-04, UP-06
**Success Criteria** (what must be TRUE):

  1. `kodo daemon run` arranca server + polling compuestos en UN proceso foreground que **bloquea** (sin auto-desvincularse) y se apaga limpio ante SIGTERM. (UP-04)
  2. `kodo start` (server foreground legacy) se comporta exactamente igual que antes — cero regresión observable tras el refactor managed. (UP-06)
  3. Bajo managed mode, una colisión de puerto (EADDRINUSE) o una config incompleta se reporta como error limpio **sin** `process.exit`/crash-loop (habilita el setup mode de Phase 68 y evita el chicken-and-egg del first-run). (UP-04)
  4. El daemon escribe un único PID file `~/.kodo/kodo.pid`, distinto del `server.pid` legacy (prerequisito de la idempotencia de `kodo up`). (UP-04)

**Plans**: 4/4 plans complete
Plans:
**Wave 1**

- [x] 65-01-PLAN.md — Primitivas puras: módulo PID name-parametrizado (`kodo.pid`) + `providerUsesPolling` (Wave 1)
- [x] 65-02-PLAN.md — Refactor `startServer({managed})` (4 puntos gateados) + golden de no-regresión de `kodo start` (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 65-03-PLAN.md — `src/daemon/lifecycle.js` + `run.js` (compose server+polling, un PID, teardown single-owner) (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 65-04-PLAN.md — `kodo daemon run` (hidden) + test de integración child-spawn foreground/SIGTERM (Wave 3)

**Research/Spike note**: patrones bien documentados (los primitivos de `src/cli/polling.js`/`polling-daemon.js` son la fuente) — omitir research-phase, ejecutar directamente. Es la refactorización de mayor riesgo del milestone: verificar que `kodo start` legacy sigue intacto antes de construir cualquier capa encima. Evita Pitfalls 1, 3, 4, 5, 18.

### Phase 66: `kodo up` + Stop/Status unificados + Homebrew

**Goal**: Un solo comando `kodo up` arranca el daemon desacoplado en background y engancha el dashboard como visor; `stop`/`status` gestionan el daemon completo; distribuible por Homebrew con `brew services`. Cierra la promesa central de Pilar 1 (shippable standalone).
**Depends on**: Phase 65 (requiere el foreground entrypoint `kodo daemon run` + `lifecycle.js` estables)
**Requirements**: UP-01, UP-02, UP-03, UP-05, DIST-01, DIST-02, DIST-03
**Success Criteria** (what must be TRUE):

  1. `kodo up` arranca el daemon (server + polling) en background y abre el dashboard como **visor**; al cerrar el dashboard (`q` / Ctrl-C) el daemon **sigue corriendo** en background reaccionando a triggers (modelo persistente LOCKED). (UP-01, UP-02)
  2. `kodo up` es idempotente: si el daemon ya corre, adjunta el dashboard al daemon existente **sin doble-spawn ni colisión de puerto**. (UP-03)
  3. `kodo stop` tumba el daemon completo (server + polling) limpiamente y `kodo status` reporta running/stopped de forma determinista con salida `--json` scriptable. (UP-05)
  4. `brew install kodo` (fórmula vía tap, `depends_on node` ≥20, sin bundlear runtime) instala kodo, y `brew services start kodo` lo registra como servicio del sistema invocando `kodo daemon run` (foreground) — **NUNCA `kodo up`** — arrancando al login y reiniciándose si crashea. (DIST-01, DIST-02)
  5. En una plataforma sin el patrón detach/launchd (Windows), `kodo up` degrada a modo foreground documentado **sin crashear** (misma guardia que el daemon de polling). (DIST-03)

**Plans**: TBD
**Spike/UAT note**: **GATE MANUAL OBLIGATORIO** — el ciclo real de `brew services` en macOS (`brew install` → `brew services start` → `brew services list` → relogin → `brew services stop`) **no es unit-testable** (Pitfalls 6 y 9: launchd foreground trap + throttle). Requiere un spike de install real (validar el `opt_bin` absoluto en Apple Silicon `/opt/homebrew` vs Intel `/usr/local`) antes de mergear la fase. Evita Pitfalls 2, 5, 6, 7, 8, 9, 10, 17, 19.

### Phase 67: Secrets Writer + Masked Input

**Goal**: El operador puede introducir la API key del provider en un campo enmascarado que se persiste a `~/.kodo/.env` (0600) y que **NUNCA** se renderiza de vuelta ni cruza a `config.json` / `/status` / logs. Se separa de la UI de setup para poder testear el writer y el boundary en aislamiento antes de que el valor del key toque ningún path de render (Pilar 2a).
**Depends on**: Phase 66 (build order LOCKED: Pilar 1 debe ser shippable antes de Pilar 2). Reusa el text-input editable en ink de Phase 63 (ya enviado) como base del campo enmascarado.
**Requirements**: SETUP-03, SETUP-04
**Success Criteria** (what must be TRUE):

  1. El operador escribe la API key en un campo **enmascarado** (`•` por carácter) y se persiste a `~/.kodo/.env` con permisos `0600` vía un único writer `writeEnvVar` (atómico, `chmod 0600` **pre-rename**, parse-merge-write que no clobbea `GITHUB_TOKEN` ni otras keys). (SETUP-03)
  2. El valor de la key NUNCA se renderiza de vuelta ni aparece en `config.json`, `/status` ni en los logs — verificado por un **grep test de higiene de fuente** (el valor no llega a `saveConfig` / `console.*` / `logger.*` / argv de `execFile`). (SETUP-03, boundary PERSIST-04)
  3. El dashboard indica si la key **ya está configurada** (prueba de presencia en `.env`, sin revelar el valor: `[configurado]`) y avisa de reiniciar el daemon tras cambiar la key (sin hot-reload). (SETUP-04)

**Plans**: TBD
**UI hint**: yes
**Research/UAT note**: patrones claros de codebase (`writeEnvVar` es espejo directo del chmod-pre-rename de `polling-daemon.js`; el masked input es una extensión render-only del text-input de Phase 63) — omitir research-phase. UAT crítico: el **grep de higiene** post-implementación (el valor del key no aparece en ningún path de render/log/argv, los 5 vectores de fuga del Pitfall 11). Evita Pitfalls 11, 13, 14, 16.

### Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run

**Goal**: El primer arranque sin configuración entra al dashboard en **modo setup** (en lugar de salir con `exit 1`), donde el operador edita provider/base_url/workspace_slug (+ la key enmascarada de Phase 67) y arranca kodo de principio a fin; `kodo config` comparte la misma fontanería de escritura. Cierra el objetivo de onboarding dashboard-first (Pilar 2b).
**Depends on**: Phase 65 (managed mode sin `process.exit` para que el first-run sirva el setup mode), Phase 66 (`kodo up` debe existir para cablear la detección de first-run) y Phase 67 (masked input + `writeEnvVar`).
**Requirements**: SETUP-01, SETUP-02, SETUP-05
**Success Criteria** (what must be TRUE):

  1. En el primer arranque sin configuración (no existe `config.json` **o** falta la API key), `kodo up` sirve el dashboard en **modo setup** — pantalla guiada — **sin ningún `exit(1)`**. (SETUP-01)
  2. El operador edita el `provider` activo, `base_url` y `workspace_slug` desde el dashboard y se persisten a `~/.kodo/config.json` (cierra CFGF-03 en su parte no-secreta). (SETUP-02)
  3. El wizard `kodo config` (readline, headless) escribe a través de la **MISMA fontanería** que el dashboard (`saveConfig` / `saveProjects` / `writeEnvVar` como únicos escritores) — el camino headless y el TUI no divergen. (SETUP-05)
  4. Tras completar el setup, la transición setup→running muestra un aviso de reinicio **honesto** (sin hot-reload, coherente con v0.14). (SETUP-02; apoya SETUP-04)

**Plans**: TBD
**UI hint**: yes
**Spike/UAT note**: **GATE MANUAL OBLIGATORIO** — UAT en **máquina limpia** (sin `config.json` ni `.env`): verificar que `kodo up` sirve el setup mode sin ningún `exit(1)` y que la transición setup→running es honesta (leer el valor recién escrito directamente del archivo, no vía `loadEnvFile` no-override — Pitfall 15). Es la fase de mayor complejidad de UX. Evita Pitfalls 12, 15, 16.

## Progreso (v0.15)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 65. Daemon Lifecycle Foundation | 4/4 | Complete   | 2026-07-02 |
| 66. `kodo up` + Stop/Status + Homebrew | 0/? | Not started | - |
| 67. Secrets Writer + Masked Input | 0/? | Not started | - |
| 68. Setup Mode + CFGF-03 + First-Run | 0/? | Not started | - |

## Backlog

### Phase 999.1: kodo bidireccional (PROMOVIDO → v0.13 Phases 52-62, SHIPPED)

_Este backlog item se materializó como el milestone **v0.13 kodo bidireccional** (shipped 2026-06-25) bajo la arquitectura "una fontanería, tres consumidores"._

**Deferred candidates (futuros milestones):** hot-reload de config en server/daemon (CFGF-01) · `kodo config` CLI no-lineal compartiendo fontanería con el editor del dashboard (CFGF-02) · edición TUI de campos estructurales del provider `base_url`/`workspace_slug`/`api_key_env`/provider activo (CFGF-03) · adapter ClickUp · adapter local (JSON/Markdown) + file watcher · webhook GitHub ingress real-time.
