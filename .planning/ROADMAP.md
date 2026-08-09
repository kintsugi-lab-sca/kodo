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
- ✅ **v0.19 Inbox de capturas + fix stealLock + saneo de deuda** — Phases 82-85 (shipped 2026-07-28)
- 🚧 **v0.20 Cierre de deuda trazada** — Phases 86-88 (en curso desde 2026-08-02)

> **Phase 73 quemada.** Se creó y se retiró por eliminación el 2026-07-14 (el nudge genérico que pretendía debouncear se borró entero, commit `f4df750`). El número NO se reutiliza: la numeración salta de 72 a 74. La Phase 73 no vuelve a usarse — v0.18 continuó desde la Phase 79 (última shipped: Phase 78), v0.19 continuó desde la Phase 82 (última shipped: Phase 81) y v0.20 continúa desde la **Phase 86** (última shipped: Phase 85).

## Active Milestone: v0.20 Cierre de deuda trazada

**Milestone Goal:** Cerrar los cuatro items de deuda que v0.19 dejó abiertos **con trigger explícito** — saneo puro, **sin feature nueva**. Los cuatro entran con causa raíz localizada en fichero y línea; ninguno es especulativo. Precedente: Phase 85 (v0.19) y Phase 81 (v0.18) hicieron lo mismo a menor escala.

**Granularidad:** `coarse` → 3 fases. **Cobertura:** 12/12 requirements mapeados, cero orphans.

**Orden por riesgo, no por dependencia:** los cuatro workstreams son **independientes entre sí** — no comparten ficheros ni tienen dependencias duras. La **Phase 86** va primera porque toca el primitivo de concurrencia que consumen dispatcher, orchestrator y polling. Las **Phases 87 y 88** son ortogonales entre sí y paralelizables.

**Constraints LOCKED (heredados — no re-discutir):**

- **DEBT-04:** ningún test se greenea enmascarando — ni debilitando asserts, ni subiendo timeouts, ni ampliando presupuestos de reintento. El harness de LOCK-05 debe ponerse **ROJO** con el CAS revertido a mano (LOCK-06).
- **El rediseño del primitivo de lock está FUERA DE ALCANCE** (decisión del mantenedor 2026-08-02; LOCK-F1 → v2): el fix es el **CAS simétrico en la rama PRESENT**, análogo exacto del `O_EXCL`+re-check que la rama ABSENT ya hace. Serializar Case-1/release con el guard es un milestone propio.
- **La ventana residual de 2 syscalls se DECLARA** — nunca se oculta ni se presenta como cierre por construcción (LOCK-07).
- **El auto-sync consume la MISMA allowlist congelada** que `kodo skill sync` (fuente única), jamás una lista paralela.
- **Cero deps npm nuevas · cero endpoints nuevos en `src/server.js`.**
- **DOC-01 refresca el INVENTARIO, no la guía:** framework (`node:test` + `node:assert/strict`), inyección de dependencias y `beforeEach`/cleanup de `TESTING.md` son correctos y no se reescriben.

- [x] **Phase 86: CAS simétrico de `stealLock` — holder VIVO** - Re-validar identidad del `lockPath` antes del rename destructivo, harness que siembra holder vivo, mordida verificada y ventana residual declarada — LOCK-04..07 (completed 2026-08-05)
- [ ] **Phase 87: Aislamiento de color transitivo en el TUI** - Guard transitivo con mordida + cierre de los 3 leaks medidos + pureza de `dashboard/format.js` congelada + fin del punto ciego declarado en falso — ISO-01..04
- [ ] **Phase 88: Distribución de skills por el orquestador + verdad del inventario de tests** - El auto-sync del launch consume la allowlist congelada completa (fuente única) y `TESTING.md` vuelve a describir el `test/` real — SYNC-01..03, DOC-01

## Phase Details

### Phase 86: CAS simétrico de `stealLock` — holder VIVO

**Goal**: Con un holder stale pero **VIVO** que libera el lock en plena sección crítica del steal, el lock que queda en disco es el del creador Case-1 legítimo — el stealer que llega tarde aborta con un `reason` discriminado en vez de clobbearlo. Nunca dos owners.
**Depends on**: Nada (workstream independiente). Cierra R-82-01, hallazgo de 2º orden de `82-REVIEW.md` CR-01 (interleaving de 5 pasos en `.planning/milestones/v0.19-phases/82-fix-de-la-carrera-de-steallock/82-REVIEW.md`). Decisión del mantenedor 2026-08-02: **CAS simétrico, no rediseño del primitivo**.
**Requirements**: LOCK-04, LOCK-05, LOCK-06, LOCK-07
**Success Criteria** (what must be TRUE):

  1. Con un holder stale VIVO que hace `release` en plena sección crítica del steal y un creador Case-1 legítimo compitiendo, el lock que sobrevive en disco es el del creador: la rama PRESENT de `stealLock` (`src/gsd/lock.js:453-471`) re-valida `ino` + bytes del `lockPath` (baseline tomado de la lectura de su propia sección crítica) inmediatamente antes del `renameSync` destructivo y **aborta con un `reason` discriminado** en vez de sobrescribir. (LOCK-04)
  2. El harness de carrera siembra un holder **VIVO** — no solo el dead-PID de `DEAD_PID`/`writeStaleDeadLock`, que es exactamente por qué esta carrera es hoy invisible — y demuestra **cardinalidad exacta**: con N≥2 procesos y un release concurrente, adquiere **uno solo**. (LOCK-05)
  3. Revertir a mano el CAS del criterio 1 pone el harness **ROJO**, y la evidencia de esa mordida queda registrada. La verificación no debilita ningún assert, no sube timeouts y no amplía presupuestos de reintento (DEBT-04, LOCKED). (LOCK-06)
  4. Quien lea el JSDoc de `stealLock` o el `STATE.md` encuentra **declarada** la ventana residual de 2 syscalls contiguos entre la comprobación de identidad y el `renameSync`, con su clase de riesgo nombrada — la misma clase que la ventana residual aceptada en el guard del inbox de Phase 83. Nunca presentada como cierre por construcción. (LOCK-07)
  5. La suite completa sigue verde y los consumidores del lock (dispatcher, orchestrator, polling) no cambian de comportamiento — el camino caliente queda intacto y el rediseño del primitivo sigue fuera de alcance.

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 86-01-PLAN.md — CAS simétrico end-to-end en la rama PRESENT de `stealLock` (lector de una pasada, seam de test, typedef aditivo, premisa falsa retirada) + caso in-process determinista que lo muerde — LOCK-04

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 86-02-PLAN.md — Harness de holder VIVO con orquestación de tres tiempos y guard de cobertura (N=3 y N=5), mordida registrada con evidencia citada, y ventana residual declarada en el JSDoc y en STATE.md — LOCK-05, LOCK-06, LOCK-07

### Phase 87: Aislamiento de color transitivo en el TUI

**Goal**: La invariante color-isolation vuelve a ser verdad **medible**: ningún fichero de `src/cli/dashboard/` alcanza `picocolors`, ni siquiera transitivamente, y el guard lo detecta. Hoy el guard directo está verde mientras el leak existe en 3 ficheros.
**Depends on**: Nada (workstream independiente). Radio ya medido al abrir el milestone: importador directo de picocolors = solo `src/cli/format.js`; leaks transitivos reales = `src/cli/dashboard/App.js:73` y `src/cli/dashboard/markdown.js:27` (importan `stripControlChars` de `../format.js`), heredados por `src/cli/dashboard/SessionTable.js` por ambas vías. El walker `walkImports` ya existe en `test/format-isolation.test.js`.
**Requirements**: ISO-01, ISO-02, ISO-03, ISO-04
**Success Criteria** (what must be TRUE):

  1. Un fichero del TUI que arrastre `picocolors` por una **cadena transitiva** de imports pone el guard rojo — no solo el import directo. La mordida se verifica reintroduciendo a mano uno de los leaks reales medidos. (ISO-01)
  2. Los **3 leaks medidos están cerrados**: `App.js`, `markdown.js` y `SessionTable.js` dejan de alcanzar `src/cli/format.js`. El guard endurecido pasa verde **con el fix** y rojo sin él — el guard no se relaja para acomodar el estado actual. (ISO-02)
  3. La pureza de `src/cli/dashboard/format.js` queda **congelada por un test**: es la premisa sobre la que descansa que `select.js` pueda importarlo sin arrastrar color, y hoy ningún test la asevera. Una regresión que la rompa falla. (ISO-03)
  4. `test/format-isolation.test.js` no declara ningún punto ciego en falso: o el guard cubre `import()` dinámico, o el fichero declara **con honestidad** lo que no cubre. El comentario «el repo no lo usa» de `:14` y `:33` desaparece, porque es falso hoy (`src/providers/registry.js:27,28,57,58`, `src/session/state.js:247`). (ISO-04)
  5. El dashboard sigue renderizando idéntico y `stripControlChars` sigue disponible para todo consumidor legítimo — cero regresión de comportamiento en el TUI, suite verde.

**Plans**: 2 plans

Plans:
**Wave 1**

- [x] 87-01-PLAN.md — Tracer: guard transitivo con cadena (ISO-01/ISO-04) + hoja `src/cli/sanitize.js` y los 8 call sites (ISO-02), cerrando con las dos mordidas registradas

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 87-02-PLAN.md — Congelar la pureza de `dashboard/format.js` + convergencia `select.js` (ISO-03) y la declaración honesta de la cabecera (ISO-04)

### Phase 88: Distribución de skills por el orquestador + verdad del inventario de tests

**Goal**: Un operador que **nunca** ejecuta `kodo skill sync` a mano recibe igualmente todas las skills de la allowlist congelada, y `.planning/codebase/TESTING.md` vuelve a describir el `test/` que existe de verdad.
**Depends on**: Nada dura (workstreams independientes). Va **última a propósito**: el inventario de DOC-01 se recuenta cuando las Phases 86 y 87 ya han añadido/tocado sus ficheros de test, de modo que no nazca desfasado. Boundary conocido: `src/cli/skill-sync.js:43` tiene la allowlist congelada `KODO_SKILLS`; `src/orchestrator/launch.js:163-165` hardcodea `kodo-orchestrate`; el guard D-08b de `test/skill-sync.test.js:815` **asevera hoy lo contrario** de SYNC-02 (prohíbe que `launch.js` importe el registro) — hay que **invertirlo para `launch.js`, conservándolo para `src/hooks/stop.js`**, cuyo auto-commit con pathspec sigue deliberadamente single-skill.
**Requirements**: SYNC-01, SYNC-02, SYNC-03, DOC-01
**Success Criteria** (what must be TRUE):

  1. Un operador que solo usa `kodo orchestrate` y jamás ejecuta `kodo skill sync` termina con **todas** las skills de la allowlist congelada en su HOME — `/kodo-capture` (v0.19 Phase 84) incluida, que hoy no le llega nunca. (SYNC-01)
  2. Añadir una skill futura a la allowlist congelada la distribuye por **ambos** carriles sin volver a tocar `launch.js`: la fuente única está aseverada por test, y el guard D-08b queda invertido para `launch.js` y conservado para `stop.js` con su razón escrita. (SYNC-02)
  3. Con una skill que falla al sincronizar, las demás se sincronizan igual y **el orquestador arranca**: resiliencia por skill y fail-open respecto al launch, con el fallo observable por el evento existente (`skill.sync.auto.error`) en vez de silencioso. (SYNC-03)
  4. `.planning/codebase/TESTING.md` describe el inventario **real** de `test/` — hoy lista 2 ficheros (congelado desde 2026-04-07) frente a 181 ficheros `*.test.js` / 2590 tests medidos al abrir el milestone; el documento cita el comando de recuento que lo produce, para que el próximo desfase sea comprobable en un shell. La guía (framework `node:test` + `node:assert/strict`, inyección de dependencias, `beforeEach`/cleanup) queda **intacta**: es correcta. (DOC-01)

**Plans**: TBD

## Phases

<details>
<summary>✅ v0.19 Inbox de capturas + fix stealLock + saneo de deuda (Phases 82-85) — SHIPPED 2026-07-28</summary>

**Milestone Goal:** Dar a kodo su primer buffer de captura global (candidata backlog 999.2 promovida), cerrar con un fix real la carrera de `stealLock` diagnosticada en v0.18 (R-81-01 resuelta por el mantenedor = fix, no aceptación), y saldar la deuda doc/Nyquist acumulada de v0.16 y v0.18. Tres workstreams independientes; el inbox es la única feature nueva.

- [x] Phase 82: Fix de la carrera de `stealLock` (2/2 plans) — LOCK-01..03 ✅ 2026-07-25 (fix por construcción: move-aside eliminado + steal-guard `O_EXCL` vía `linkSync`; CR-01 100/100 determinista. Deja abierta R-82-01: carrera de 2º orden con holder VIVO)
- [x] Phase 83: Inbox foundation — captura + triage (7/7 plans) — CAPT-01, CAPT-03, CAPT-04, CAPT-06 ✅ 2026-07-25 (3 planes originales + 4 de cierre de gaps: el guard compare-and-swap sustituyó al umbral temporal tras destapar 0/6 supervivientes)
- [x] Phase 84: Superficies de captura — skill, sync, conteo ambient (3/3 plans) — CAPT-02, CAPT-05, CAPT-07 ✅ 2026-07-26
- [x] Phase 85: Saneo de deuda + Nyquist retroactivo (5/5 plans) — DEBT-05..07, NYQ-01, NYQ-02 ✅ 2026-07-28 (6 fases retro-validadas citation-based, cero tests generados)

Archivo: `milestones/v0.19-ROADMAP.md` · Requirements: `milestones/v0.19-REQUIREMENTS.md` · Fases: `milestones/v0.19-phases/`

</details>

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
Detalle completo de las fases 82-85: ver `milestones/v0.19-ROADMAP.md`.

## Progress

| Milestone | Phases | Plans | Status | Shipped |
|-----------|--------|-------|--------|---------|
| v0.20 Cierre de deuda trazada | 86-88 | 0/TBD | In progress | - |
| v0.19 Inbox de capturas + fix stealLock + saneo de deuda | 82-85 | 17/17 | Complete | 2026-07-28 |
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

### Phase 999.2: Inbox de capturas global — feature (PROMOVIDO → v0.19 Phases 83-84, SHIPPED)

> **Renumerado 2026-07-15:** este item se llamaba «Phase 75» en el backlog. Al promover la candidata Phase 74 a fase activa, v0.17 ocupó 74-76 y el número 75 quedaría ambiguo. Se renumeró a 999.2 siguiendo la convención de placeholders del backlog (999.x). Promovido a fases reales al abrir v0.19 (2026-07-24).

_Esta candidata se materializó como el núcleo del milestone **v0.19 Inbox de capturas + fix stealLock + saneo de deuda** (shipped 2026-07-28). El store + `kodo capture` + `kodo inbox` triage → **Phase 83** (CAPT-01/03/04/06); el skill `/kodo-capture` + generalización de `kodo skill sync` + conteo ambient en el dashboard → **Phase 84** (CAPT-02/05/07). La candidata trazaba CAPT-01..04; el milestone amplió el scope con **CAPT-05** (skill-sync multi-skill), **CAPT-06** (trace pointer best-effort) y **CAPT-07** (superficie ambient contra el inbox rot). Detalle completo en `milestones/v0.19-ROADMAP.md`._

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
