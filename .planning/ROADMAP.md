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
- 🚧 **v0.17 Plan vivo por-tarea** — Phases 74-76 (in progress)

> **Phase 73 quemada.** Se creó y se retiró por eliminación el 2026-07-14 (el nudge genérico que pretendía debouncear se borró entero, commit `f4df750`). El número NO se reutiliza: la numeración salta de 72 a 74.

## Phases

**v0.17 Plan vivo por-tarea — el plan de la tarea pasa de fire-and-forget a estado vivo (productor → consumidores), + una fase ortogonal de convergencia del conteo:**

- [ ] **Phase 74: Handoff acumulativo al cierre** - `SessionEnd` appendea `## Handoff <fecha>` (`Hecho / Pendiente / NEXT:`) al plan de la tarea antes del cleanup destructivo, con autoría LLM + backstop mecánico, y persiste puntero + `NEXT:` en `state.json` bajo `withStateLock` — LIVE-01..04
- [ ] **Phase 75: Superficie del `NEXT:` — dashboard y nudge** - El dashboard lista el `NEXT:` por tarea desde `state.json` y abre el plan completo renderizado en la rama `phaseId == null`; el nudge del orquestador usa el `NEXT:` como contexto — LIVE-05, LIVE-06, LIVE-07
- [ ] **Phase 76: Convergencia del conteo `pending`** - `/status` y `kodo check` reportan el mismo `pending_count`, y con el provider caído `/status` deja de servir un conteo caducado como si fuera fresco — ORCH-05, ORCH-06

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

## Phase Details (v0.17 activo)

### Phase 74: Handoff acumulativo al cierre

**Goal**: Al cerrar una sesión, la tarea deja **estado vivo**: su plan gana un bloque de handoff que se acumula sesión tras sesión (nunca se pisa), y `state.json` guarda el puntero al plan + el `NEXT:` de una línea. Es el productor de todo el milestone: sin este dato, ni el dashboard ni el nudge tienen nada que enseñar.
**Depends on**: v0.16 Phase 70 (shipped) — el hook de cierre es un escritor más de `state.json` y está obligado a pasar por `withStateLock`
**Requirements**: LIVE-01, LIVE-02, LIVE-03, LIVE-04
**Success Criteria** (what must be TRUE):

  1. Al cerrar una sesión de una tarea, `~/.kodo/plans/<task_id>.md` gana un bloque `## Handoff <fecha>` con `Hecho / Pendiente / NEXT:`, escrito **ANTES** del cleanup terminal destructivo de `SessionEnd` (`removeSession` + worktree + promptFile) — cuando el operador abre el fichero tras el cierre, el handoff está ahí. (LIVE-01)
  2. Una segunda sesión de la misma tarea acumula un segundo bloque y el primero sigue íntegro en el fichero — la instrucción de `session-start.js:85` deja de ordenar *«sobrescribe si ya existe»* y pasa a preservar-y-appendear. (LIVE-02)
  3. Si el LLM cierra sin escribir handoff, el fichero gana igualmente un bloque mecánico mínimo (fecha + resultado de la sesión, sin `NEXT:`): ninguna sesión cerrada deja el plan sin traza, y el operador distingue el bloque mecánico del redactado por el LLM. (LIVE-03)
  4. Tras el cierre, `state.json` refleja para esa tarea el puntero al plan y el `NEXT:` de una línea; bajo escrituras concurrentes (hook + reconcile + server) ninguna se pierde, porque el hook pasa por `withStateLock` y `reconcileTick` sigue siendo el único escritor de `alive`. (LIVE-04)
  5. Un handoff que falla (plan ilegible, formato inesperado, lock ocupado) **no** crashea Claude Code ni bloquea el cierre: el hook sigue never-throw y el orden de efectos `backstop → setColor → notify` (D-08, LOCKED) permanece intacto.

**Plans**: 5/5 plans complete · +1 gap closure plan pendiente (LIVE-04)

Plans:
**Wave 1**

- [x] 74-01-PLAN.md — Contrato de formato: `src/session/handoff.js` como hoja pura (D-01..D-04, D-13) + guard de aislamiento del grafo de imports [wave 1]
- [x] 74-02-PLAN.md — `upsertTaskHandoff`: escritor de `state.tasks` bajo `withStateLock`, aditivo sin bump de schema (D-05, D-06) [wave 1]
- [x] 74-03-PLAN.md — Invertir las dos instrucciones de `session-start.js` a preservar-y-appendear + contrato de handoff en el prompt (D-10, D-11) [wave 1]

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 74-04-PLAN.md — `writeHandoff` cableado en el seam `session-end.js:97`: RMW bajo `withFileLock`, create-if-missing, persistencia (D-07..D-09) [wave 2]

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 74-05-PLAN.md — Carreras cross-process: `state.tasks` sin escrituras perdidas y el mismo plan sin lost update (D-08) [wave 3]

**Gap closure** *(de `74-VERIFICATION.md` — LIVE-04 parcial: WR-02)*

- [ ] 74-06-PLAN.md — `upsertTaskHandoff` preserva el `NEXT:` previo cuando el entrante es ausente: un cierre mecánico posterior ya no borra el `NEXT:` real de una sesión anterior (WR-02) [gap]

### Phase 75: Superficie del `NEXT:` — dashboard y nudge

**Goal**: El operador y el orquestador **consumen** el estado vivo sin abrir ficheros a mano: el `NEXT:` de cada tarea se ve en la lista del dashboard, el plan completo se abre renderizado desde la fila, y el nudge del orquestador deja de ser genérico. Es la cara visible del dato que produce la Phase 74.
**Depends on**: Phase 74 (consume el `NEXT:` de `state.json` y el bloque de handoff del plan)
**Requirements**: LIVE-05, LIVE-06, LIVE-07
**Success Criteria** (what must be TRUE):

  1. El dashboard muestra el `NEXT:` por tarea en la lista, leyéndolo de `state.json` — la TUI **no** abre N ficheros de plan para pintar la tabla, y no aparece ningún endpoint nuevo en `src/server.js`. (LIVE-05)
  2. Desde la fila de una sesión no-GSD (`phaseId == null`), el operador abre el markdown completo del plan renderizado y de **solo lectura** (no editable), y `Esc` vuelve a la lista preservando el cursor por `task_id`. (LIVE-06)
  3. Las filas GSD siguen abriendo su overlay de plan GSD exactamente igual que hoy: D-02 intacto, el handoff no se surface en esa rama aunque sí se haya escrito en disco. (LIVE-06)
  4. Con un `NEXT:` presente, el nudge del orquestador lo usa como contexto concreto en vez del genérico. (LIVE-07)
  5. Sin `NEXT:` (tarea recién creada, handoff mecánico sin `NEXT:`, plan ausente o ilegible), el dashboard y el nudge degradan limpio — celda vacía y nudge sin contexto, TUI never-throws, cero ruido.

**Plans**: TBD
**UI hint**: yes

### Phase 76: Convergencia del conteo `pending`

**Goal**: El conteo de tareas `pending` que ve el orquestador converge con el que reporta `kodo check`, y con el provider caído `/status` deja de presentar un dato caducado como si fuera fresco. Ortogonal a los LIVE (vive en `src/server.js` y `src/check.js`, no toca hooks ni planes) → paralelizable.
**Depends on**: Nothing (independiente de 74/75; puede ejecutarse en paralelo)
**Requirements**: ORCH-05, ORCH-06
**Success Criteria** (what must be TRUE):

  1. Con el provider sano, `/status` y `kodo check` reportan el **mismo** `pending_count` sobre la misma realidad — la ventana de divergencia de hasta 30s (`pendingCache` TTL en `server.js:591` vs `listPendingTasks()` fresco en `check.js:37`) desaparece por convergencia de los caminos de lectura, no por cuadrar números a mano. (ORCH-05)
  2. Con el provider caído, `/status` no sirve un conteo `pending` arbitrariamente viejo como si fuera fresco: la rama de error de `server.js:599` deja de devolver `pendingCache.data` sin comprobar TTL. (ORCH-06)
  3. El operador y el orquestador distinguen **«0 pendientes»** de **«no se pudo saber»** — el fallo del provider es visible en la respuesta, no solo un `console.warn` en la consola del server. (ORCH-06)
  4. El arreglo no introduce endpoints nuevos ni un bus de invalidación por evento (fuera de alcance explícito): el comportamiento observable cambia sin rediseñar el `pendingCache`.

**Plans**: TBD

## Progreso (v0.17)

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 74. Handoff acumulativo al cierre | 5/5 | Complete   | 2026-07-15 |
| 75. Superficie del `NEXT:` — dashboard y nudge | 0/? | Not started | - |
| 76. Convergencia del conteo `pending` | 0/? | Not started | - |

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
