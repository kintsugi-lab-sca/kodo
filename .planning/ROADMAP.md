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
- 🚧 **v0.13 kodo bidireccional** — Phases 52-58 (en construcción)

## Phases

### 🚧 v0.13 kodo bidireccional (Phases 52-58)

**Milestone Goal:** Cerrar el puente en la dirección inversa `sesión → tarea`: una sesión Claude Code creada ad-hoc en cmux (no nacida de una tarea Plane/GitHub) se promueve a una **tarea persistente** del gestor, para que el trabajo ad-hoc no se evapore al cerrar el sprint. Arquitectura **"una fontanería, tres consumidores"**: una base determinista 0-token (`createTask` + `adoptSession`) reusada por el CLI, la tecla del dashboard (gated) y el orquestador (único carril LLM) — ninguno dueño del flujo.

**Build order (research-validated):** `createTask + contrato + anti-recursión` → `fontanería src/adopt.js` → `CLI kodo adopt` → `SPIKE detección cmux (HARD GATE)` → `tecla dashboard (condicional/cuttable)` → `orquestador asistido` → `deuda v0.12 (tail independiente)`. La base determinista ships antes que cualquier consumidor; la tecla del dashboard queda GATED tras el spike (espejo Phase 49→50 de v0.12).

- [ ] **Phase 52: createTask + contrato + anti-recursión** — `createTask` opcional typeof-detected en Plane+GitHub (FROZEN-at-9 intacto), anti-recursión shipped junto al método
- [ ] **Phase 53: Fontanería `src/adopt.js`** — base determinista 0-token (`adoptSession` + guard double-adopt + atomicidad LOUD + datos sanitizados), inverso exacto de `manager.launchWorkItem`
- [ ] **Phase 54: CLI `kodo adopt`** — consumidor determinista que recibe workspace/cwd explícito; ships sí o sí, independiente del spike
- [ ] **Phase 55: SPIKE detección cmux (HARD GATE)** — veredicto empírico VIABLE/INVIABLE sobre detectar sesiones `claude` ad-hoc ausentes de `state.json`; gobierna Phase 56
- [ ] **Phase 56: Tecla del dashboard (condicional/cuttable)** — *(solo si Phase 55 = VIABLE)* tecla `a` descubre + adopta sesiones ad-hoc shelleando `kodo adopt`; cero endpoints nuevos
- [ ] **Phase 57: Orquestador asistido** — el orquestador (único carril LLM) deriva un título inteligente del contexto real y shellea el mismo `kodo adopt`; consumidor no dueño
- [ ] **Phase 58: Deuda heredada de v0.12** — hardening XSS WR-01 (`src/server.js`) + cierre del HUMAN-UAT diferido de Phase 50.1; tail independiente

<details>
<summary>✅ v0.12 Atajos al gestor y progreso vivo (Phases 48-51 + 50.1) — SHIPPED 2026-06-15</summary>

- [x] Phase 48: Open-in-manager core (3/3 plans) — OPEN-01..04 — completed 2026-06-12
- [x] Phase 49: Live-progress spike / HARD GATE (1/1 plan) — PROG-01 (veredicto VIABLE) — completed 2026-06-12
- [x] Phase 50: Live-progress display condicional (3/3 plans) — PROG-02, PROG-03 — completed 2026-06-13
- [x] Phase 50.1: Live-progress vía STATE.md de GSD — corrige la fuente (2/2 plans) — re-realiza PROG-02/PROG-03 — completed 2026-06-15
- [x] Phase 51: Backfill Nyquist v0.11 (1/1 plan) — NYQ-03 — completed 2026-06-15

Archivo: `milestones/v0.12-ROADMAP.md` · Requirements: `milestones/v0.12-REQUIREMENTS.md` · Deuda diferida al cierre: HUMAN-UAT de Phase 50.1 (display de progreso vivo, verificación en TTY real — ver STATE.md `## Deferred Items`) → saldada en **Phase 58** de v0.13
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

## Phase Details

### Phase 52: createTask + contrato + anti-recursión
**Goal**: kodo gana la capacidad de **crear** tareas (primera vez en su historia) sin romper el contrato FROZEN-at-9. `createTask` aterriza como método opcional typeof-detected en ambos adapters, y la anti-recursión que protege contra re-despacho viaja con él como propiedad de corrección del núcleo.
**Depends on**: Nothing (primera fase de v0.13; reusa el transporte POST con auth ya existente en `plane/client.js` + `github/client.js`)
**Requirements**: BIDIR-01, BIDIR-02, BIDIR-06
**Success Criteria** (what must be TRUE):
  1. El adapter Plane crea una work-item vía `createTask` (`POST .../work-items/`, solo `name` required) y normaliza la respuesta 201 a un `TaskItem` canónico vía `normalizeWorkItem`.
  2. El adapter GitHub crea una issue vía `createTask` (`POST /repos/{o}/{r}/issues`, solo `title` required, body Markdown) con el scope PAT mínimo documentado.
  3. `TASK_PROVIDER_METHODS` permanece FROZEN en 9: el loop de validación de `registry.js` queda intacto y un `it()` capability-gated en la contract matrix Plane+GitHub espeja el test B8 de `getTaskState`.
  4. Una tarea recién creada **NUNCA** es re-despachada por el poller/webhook (anti-recursión: corte espejo de `isGsdChild` ANTES de lock/resolver/launch + creación en estado no-trigger para que `listPendingTasks` no la devuelva; ni `--force` la bypasea).
**Plans**: TBD

### Phase 53: Fontanería `src/adopt.js`
**Goal**: Existe la base determinista 0-token de la adopción — el inverso exacto de `manager.launchWorkItem` (`createTask → addSession`). Es un módulo top-level provider-agnostic que los tres consumidores reusan sin poseer; nunca usa LLM, nunca rompe la invariante "`reconcileTick` único escritor de `alive`".
**Depends on**: Phase 52 (llama a `provider.createTask`)
**Requirements**: BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08
**Success Criteria** (what must be TRUE):
  1. `adoptSession()` ejecuta capability-gate → `createTask` → normalize → `addSession` y retorna el discriminante never-throws universal `{ ok:true, task, session } | { ok:false, code, detail }`, sembrando la fila en `state.json` vía el `addSession` existente (sin escribir `dead_since`/`last_seen_alive`).
  2. Un re-run sobre una sesión ya adoptada retorna `ALREADY_ADOPTED` **sin** crear tarea (guard `findSession({workspaceRef, cwd})` ANTES del POST + re-check TOCTOU con `loadState()` fresco; cero duplicados).
  3. La secuencia es POST-primero, escritura local último (tmp+rename atómico); si el POST tiene éxito pero la escritura local falla, el fallo es **LOUD** con `task_id` + `task_url` en el mensaje y es recuperable por re-run idempotente.
  4. Los datos de la tarea se auto-derivan y sanean antes del POST: título default `basename(cwd)` editable, proyecto destino vía `listProjects`, descripción opcional; se hace strip de rutas absolutas / redacción del home dir / nunca se embeben bodies de transcript; el estado inicial es sano (no "sin triar").
**Plans**: TBD

### Phase 54: CLI `kodo adopt`
**Goal**: El operador puede adoptar una sesión ad-hoc desde la línea de comandos con input explícito. Es el consumidor determinista de referencia (0-token) que la tecla del dashboard y el orquestador shellean; ships sí o sí con independencia del veredicto del spike.
**Depends on**: Phase 53 (consume `adoptSession`)
**Requirements**: BIDIR-07
**Success Criteria** (what must be TRUE):
  1. `kodo adopt --workspace <ref> --cwd <path> --title <t> --project <p> --description <d>` crea la tarea y registra la sesión, recibiendo el workspace/cwd **explícito** (no depende de detección automática).
  2. El comando deriva sus exit codes deterministas directamente del discriminante de `adoptSession` (espejo de `kodo gsd verify`).
  3. En éxito, el feedback muestra el `task_id` + `task_url` de la tarea creada; en fallo, el `code`/`detail` legible.
**Plans**: TBD

### Phase 55: SPIKE detección cmux (HARD GATE)
**Goal**: Veredicto empírico escrito **VIABLE / INVIABLE** sobre si las sesiones `claude` ad-hoc (ausentes de `state.json`) son detectables de forma fiable en la build instalada de cmux. Su deliverable es la evidencia cruda + el verdict, no código de producción. Gobierna un gate duro sobre Phase 56 (espejo exacto del spike de Phase 49 en v0.12).
**Depends on**: Phase 54 (el consumidor que la tecla shelleará ya existe; el spike no lo necesita para correr pero ordena el milestone)
**Requirements**: DETECT-01
**Success Criteria** (what must be TRUE):
  1. El veredicto VIABLE/INVIABLE queda escrito con evidencia cruda capturada de la build instalada de cmux (`list-workspaces --json` → `current_directory` + UUID estable; `list-panels --json` → `resume_binding.kind === "claude"`).
  2. VIABLE exige que el set-difference contra `state.json` se endurezca con `current_directory`/UUID estable (NO el `workspace_ref` reciclable — defensa contra el bug de Phase 43).
  3. El fixture JSON queda capturado y asertado vía el `run` DI de `src/host/cmux.js`, de modo que un cambio de contrato de cmux falle ruidosamente.
  4. El veredicto determina si cmux expone el `--session-id` de la sesión ad-hoc (gobierna la precisión del liveness en reconcile).
**Plans**: TBD

### Phase 56: Tecla del dashboard (condicional/cuttable)
**Goal**: *(CONDICIONAL — solo se planifica/ejecuta si Phase 55 concluye VIABLE)* El operador descubre y adopta sesiones ad-hoc desde el dashboard con una tecla. Si Phase 55 sale INVIABLE, este requirement se **difiere a BIDIR-F1 sin penalizar el cierre del milestone** — el núcleo + CLI + orquestador + deuda ya entregan el milestone.
**Depends on**: Phase 55 (GATE DURO: solo si VIABLE) + Phase 54 (shelleará `kodo adopt`)
**Requirements**: DETECT-02
**Success Criteria** (what must be TRUE):
  1. Una tecla dedicada (`a`) sobre una sesión ad-hoc descubierta shellea `kodo adopt` vía `execFile` sin shell (argv literal, espejo de `focus.js`/`runOpen`).
  2. El descubrimiento es on-demand al pulsar la tecla (NO un poll loop) y se confirma con double-confirm (espejo del dismiss de Phase 42).
  3. **Cero endpoints nuevos** en `src/server.js` (preserva el invariante "cero endpoints nuevos desde v0.10") y never-throws (el panel ink permanece montado).
**Plans**: TBD
**UI hint**: yes

### Phase 57: Orquestador asistido
**Goal**: El orquestador (único carril con LLM) propone proactivamente adoptar una sesión ad-hoc y deriva un título *inteligente* del contexto real, mucho mejor que `basename(cwd)`. Es un **consumidor** de la misma fontanería, no dueño ni mecanismo paralelo; no depende del spike (toma input explícito).
**Depends on**: Phase 54 (shellea `kodo adopt`); paralelizable con Phase 56 (independiente del gate)
**Requirements**: ORCH-01
**Success Criteria** (what must be TRUE):
  1. El orquestador propone adoptar una sesión ad-hoc y deriva un título inteligente del contexto real (cwd / commits / transcript).
  2. El título derivado pasa por el sanitizador del núcleo (BIDIR-08) y se confirma (humano/CLI) antes de crear la tarea.
  3. La implementación shellea el mismo `kodo adopt --title "<derived>"` (el carril 0-token del núcleo se preserva; el LLM vive estrictamente en el consumidor) — prosa del skill `kodo-orchestrate` actualizada, cero lógica de negocio nueva en el orquestador.
**Plans**: TBD

### Phase 58: Deuda heredada de v0.12
**Goal**: Saldar los dos items diferidos al cierre de v0.12 (`## Deferred Items` de STATE.md). Tail independiente, schedulable en paralelo a cualquier fase de adopción; bajo riesgo.
**Depends on**: Nothing (independiente del flujo de adopción; schedulable en cualquier momento)
**Requirements**: DEBT-01, DEBT-02
**Success Criteria** (what must be TRUE):
  1. El carril HTML del dashboard (`src/server.js`) aplica la allowlist de protocolo `http(s)` (con `new URL()`) + escaping antes de renderizar `task_url` como `<a href>`, cerrando el XSS latente WR-01 (`javascript:`/`data:` ya no inyectable).
  2. Los 3 escenarios + `50.1-VERIFICATION.md` del display de progreso vivo `N/M` quedan verificados visualmente en un TTY real con una sesión GSD viva (HUMAN-UAT de Phase 50.1 cerrado).
**Plans**: TBD

## Backlog

### Phase 999.1: kodo bidireccional (PROMOVIDO → v0.13 Phases 52-58)

_Este backlog item **se materializó** como el milestone activo **v0.13 kodo bidireccional** (iniciado 2026-06-15). Las 4 piezas (detectar / crear / adoptar / datos) están desplegadas en las Phases 52-58 bajo la arquitectura "una fontanería, tres consumidores". `createTask` se añade como método OPCIONAL typeof-detected (espejo `getTaskState` Phase 40), manteniendo el contrato FROZEN en 9. La detección de cmux quedó como SPIKE / HARD GATE (Phase 55) gobernando la tecla del dashboard (Phase 56, condicional/cuttable). Origen: ideado 2026-06-12 en conversación tras cerrar la Fase 48._

---
_Histórico: la **anterior** Phase 999.1 ("Dismiss de sesiones dead desde el dashboard ink") fue **promovida a Phase 42 y shipped en v0.10** (2026-06-08). Traza de origen completa en `milestones/v0.10-ROADMAP.md`._

## Progress

**Execution Order:**
Las fases ejecutan en orden numérico: 52 → 53 → 54 → 55 → 56 → 57 → 58. Phase 56 está GATED tras el veredicto VIABLE de Phase 55. Phase 57 es paralelizable con Phase 56. Phase 58 (deuda) es independiente y schedulable en cualquier momento.

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 52. createTask + contrato + anti-recursión | v0.13 | 0/TBD | Not started | - |
| 53. Fontanería `src/adopt.js` | v0.13 | 0/TBD | Not started | - |
| 54. CLI `kodo adopt` | v0.13 | 0/TBD | Not started | - |
| 55. SPIKE detección cmux (HARD GATE) | v0.13 | 0/TBD | Not started | - |
| 56. Tecla del dashboard (condicional/cuttable) | v0.13 | 0/TBD | Not started | - |
| 57. Orquestador asistido | v0.13 | 0/TBD | Not started | - |
| 58. Deuda heredada de v0.12 | v0.13 | 0/TBD | Not started | - |
