---
gsd_state_version: 1.0
milestone: v0.13
milestone_name: kodo bidireccional
status: executing
stopped_at: v0.13 CODE-complete (52-60). Única pendiente: DEBT-02 (HUMAN-UAT 50.1) requiere TTY real con sesión GSD viva
last_updated: "2026-06-19T12:55:00.000Z"
last_activity: 2026-06-19 -- cierre de cola v0.13 (autónomo): 59 formalizada, 60 implementada, 58 LIFE-03+DEBT-01 hechos
progress:
  total_phases: 9
  completed_phases: 9
  total_plans: 16
  completed_plans: 16
  percent: 99
---

# Project State

**Project:** kodo
**Active milestone:** **v0.13 kodo bidireccional** (iniciado 2026-06-15, roadmap creado). Flujo inverso `sesión → tarea`: una sesión Claude Code ad-hoc de cmux se promueve a tarea persistente del gestor. 7 phases (52-58), 13/13 requirements mapeados, 100% cobertura.

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-06-15 — v0.13 iniciado; Current Milestone: kodo bidireccional).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9 añadió observabilidad en terminal (`kodo dashboard`); v0.10 la promovió a gestión (dismiss); v0.11 abrió la ventana al plan; v0.12 profundizó desde la fila (abrir la tarea + progreso vivo). **v0.13 cierra el puente en la dirección inversa** `sesión → tarea`.

**Current focus:** Cierre de cola v0.13 — Phases 58 (deuda), 59 (liveness, gap-fix mergeado), 60 (enriquecimiento, registrada)

## Current Position

Phases 52-57: COMPLETE (núcleo bidireccional `sesión → tarea` entregado).
Phase 58 (deuda v0.12 + LIFE-03): NOT STARTED — sin directorio.
Phase 59 (liveness sesiones adoptadas): 59-01 mergeado a main (SUMMARY en disco), SIN PLAN formal ni cierre/UAT — entró por gap-fix.
Phase 60 (enriquecimiento orquestador / BIDIR-F2): registrada (directorio vacío), surgió del UAT 56/57.
Last activity: 2026-06-19 -- liveness gap-fix mergeado + Phase 60 registrada

## Roadmap v0.13 (active)

Build order (research-validated): **createTask + contrato + anti-recursión → fontanería `src/adopt.js` → CLI `kodo adopt` → SPIKE detección cmux (HARD GATE) → tecla dashboard (condicional/cuttable) → orquestador asistido → deuda v0.12 (tail independiente)**. La base determinista 0-token ships antes que cualquier consumidor ("consumers reuse the base, never own it"); la tecla del dashboard queda GATED tras el spike (espejo Phase 49→50 de v0.12). Numeración continua desde Phase 51 → primera fase **Phase 52** (NO reset).

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 52. createTask + contrato + anti-recursión | `createTask` opcional typeof-detected Plane+GitHub (FROZEN-at-9 intacto) + anti-recursión shipped junto al método | BIDIR-01, BIDIR-02, BIDIR-06 | bajo (POST plumbing ya existe; espejo `getTaskState` Phase 40) |
| 53. Fontanería `src/adopt.js` | Base determinista 0-token (`adoptSession` + double-adopt guard + atomicidad LOUD + datos sanitizados); inverso exacto de `manager.launchWorkItem` | BIDIR-03, BIDIR-04, BIDIR-05, BIDIR-08 | medio (núcleo reusado por 3 consumidores) |
| 54. CLI `kodo adopt` | Consumidor determinista con workspace/cwd explícito; **ships sí o sí**, independiente del spike | BIDIR-07 | bajo (consumo de la base; espejo `launch <ref>`) |
| 55. Contrato `HostProvider.describeSurface()` (cmux) | Método opcional typeof-detected sobre `cmux surface resume show --json` → `{cwd, sessionId, kind}` por surface, fixture-locked + fail-open. Ya NO spike (viabilidad probada, CMUX-CAPABILITIES.md P0) | DETECT-01 | bajo/medio (contrato concreto, no research) |
| 56. Tecla del dashboard | tecla `a` descubre (vía describeSurface) + adopta shelleando `kodo adopt`; cero endpoints nuevos. Ya NO gated | DETECT-02 | medio (consumidor de DETECT-01) |
| 57. Orquestador asistido | Título inteligente del contexto real → shellea el mismo `kodo adopt`; consumidor no dueño; paralelizable con 56 | ORCH-01 | bajo (prosa skill + shell-out; LLM solo en el consumidor) |
| 58. Deuda heredada de v0.12 | Hardening XSS WR-01 (`src/server.js`) + cierre HUMAN-UAT diferido Phase 50.1; tail independiente | DEBT-01, DEBT-02 | bajo (independiente del flujo de adopción) |

- **✅ GATE RESUELTO Phase 55 → 56 (2026-06-16):** el spike quedó probado **VIABLE** empíricamente — `.planning/research/CMUX-CAPABILITIES.md` (P0, cmux 0.64.15): `cmux surface resume show --json` da `cwd` + `resume_binding.checkpoint_id` (= `session_id`) + `kind` por surface. Phase 55 se **reconvirtió** de "SPIKE research abierto" a **contrato `HostProvider.describeSurface()`** (código de producción, no veredicto), y Phase 56 **dejó de estar gated**. BIDIR-F1 (fallback INVIABLE) queda moot. La superficie se fixture-lockea (no docs-pinned) para que un cambio de cmux falle ruidosamente.
- **CLI ships sí o sí (Phase 54):** `kodo adopt` toma workspace/cwd explícito → base host-agnóstica. Debe existir antes que sus consumidores shell-out (Phase 56 dashboard + Phase 57 orquestador). **Opcional (post-55):** puede auto-derivar `--cwd`/`session_id` vía `describeSurface()` — el operador solo aporta lo que cmux no sabe (tarea/proyecto destino). El path explícito sigue siendo la interfaz canónica (mantiene el núcleo testeable sin cmux).
- **Anti-recursión (BIDIR-06) ships CON `createTask` en Phase 52,** no como follow-up — es una propiedad de corrección del núcleo (precedente: anti-recursión shipped con el reporting en Phase 29).
- **Phase 58 (deuda) independiente:** DEBT-01 (XSS) + DEBT-02 (HUMAN-UAT 50.1) son schedulables en paralelo / como low-risk tail; ni bloquean ni son bloqueadas por el flujo de adopción.

## Most recent shipped milestone

**v0.12 Atajos al gestor y progreso vivo** — shipped 2026-06-15 (5 phases 48-51 + 50.1 / 10 plans / 90 commits / suite 1307 pass + 1 skip). Cerrado con deuda reconocida (HUMAN-UAT del display 50.1 diferido a TTY real + XSS latente WR-01 en `src/server.js`) → **ambos saldados en Phase 58 de v0.13**. **Sin audit formal de milestone** (`/gsd:audit-milestone` no se corrió antes del cierre). Previo: **v0.11 Ventana al plan** shipped 2026-06-10.

- Roadmap archive: `milestones/v0.12-ROADMAP.md`
- Requirements archive: `milestones/v0.12-REQUIREMENTS.md`
- Phase artifacts: `.planning/phases/` (48-51 + 50.1 — NO archivados a `milestones/v0.12-phases/`, siguen en `phases/`; usar `/gsd:cleanup` para archivar retroactivamente)

## Deferred Items

Items reconocidos y diferidos (ninguno bloqueante). Los 2 items de deuda viva de v0.12 (XSS WR-01 + HUMAN-UAT 50.1) están **agendados en Phase 58 de v0.13** (DEBT-01, DEBT-02). La deuda Nyquist de v0.11 (Phases 44/45/46) quedó saldada en **Phase 51** (NYQ-03, citation-based).

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| uat | Phase 50.1 (v0.12) `50.1-HUMAN-UAT.md` 3 escenarios + `50.1-VERIFICATION.md` `human_needed` (8/8 must-haves auto-verificados) — display de progreso vivo `N/M`; requiere TTY real con sesión GSD viva | → agendado **Phase 58** (DEBT-02) | v0.12 close |
| security | Phase 48 (v0.12) XSS latente WR-01 — `src/server.js` renderiza `task_url` como `<a href>` sin allowlist `http(s)` | ✓ **RESUELTO** (estaba ya mitigado en commit `77a5c0c` T-48-10: allowlist `safeHref` http(s) vía `new URL()` en los 3 renders; el item estaba **stale**). Test de regresión añadido `976f8a6` (DEBT-01) | v0.12 close |
| nyquist | Phase 44 (v0.11) `44-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 44-VERIFICATION.md passed 10/10) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 45 (v0.11) `45-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 45-VERIFICATION.md passed 7/7) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| nyquist | Phase 46 (v0.11) `46-VALIDATION.md` → status=approved, nyquist_compliant=true (cita 46-VERIFICATION.md passed 6/6 + 46-HUMAN-UAT.md 2/2) | ✓ saldado Phase 51 (NYQ-03) | v0.11 close |
| frontmatter | `requirements_completed: []` vacío en summaries de 46-01 y 47-01 (v0.11) — cobertura verificada por VERIFICATION + integration + traceability | cosmético | v0.11 close |
| verification | Phase 37/38 (v0.9) sin VERIFICATION.md formal — cerradas vía UAT/HUMAN-UAT passed | covered-by-UAT | v0.9 close |
| code | Ciclo de import ESM App.js ↔ SessionTable.js (constantes OVERLAY_*) — resuelto en runtime, suite verde, frágil | WARNING-01 | v0.9 close |

## Accumulated Context

### Decisions (Roadmap v0.13)

- **Numeración continua (NO reset):** v0.13 continúa desde Phase 51 (v0.12) → primera fase es **Phase 52**. El número del spike (Phase 55) flota con la secuencia, no es hardcoded.
- **`createTask` opcional typeof-detected FUERA de los 9 FROZEN (Phase 52):** espejo exacto de `getTaskState` (Phase 40) — el contrato `TaskProvider` sigue FROZEN en 9, el loop de validación de `registry.js` queda intacto, un `it()` capability-gated en la contract matrix espeja el test B8. Primera vez que kodo *crea* tareas (revisa conscientemente el Out of Scope histórico "kodo no crea ni elimina tareas"; **nunca elimina** sigue en pie).
- **Anti-recursión (BIDIR-06) shipped CON `createTask` en Phase 52,** no como follow-up: propiedad de corrección del núcleo (corte espejo `isGsdChild` ANTES de lock/resolver/launch + creación en estado no-trigger). Precedente: anti-recursión shipped con el reporting en Phase 29.
- **BIDIR-06 ENTREGADO (Plan 52-01, 2026-06-16):** `KODO_LABEL_ADOPTED='kodo:adopted'` + `isAdopted(labels)` en `src/labels.js` (espejo byte-a-byte de `isGsdChild`, `parseKodoLabels` intacto) + corte `isAdopted(task.labels)` en `dispatcher.js` (step 1c) que devuelve `{action:'ignored', code:'adopted'}` ANTES del bloque force-skip → `--force` NO lo bypasea (Pitfall 1: `kodo:adopted` es `isKodo:true`, el corte es LOAD-BEARING). Source-hygiene: el literal solo vive en `labels.js`, ordering `filterIdx < forceIdx` testeado. Suite: 1333 pass / 0 fail / 1 skip. Plans 02/03 DEBEN importar `KODO_LABEL_ADOPTED` (nunca inline).
- **Fontanería antes que consumidores (Phase 53 antes de 54/56/57):** "consumers reuse the base, never own it". `src/adopt.js` es módulo top-level provider-agnostic (NO bajo `src/gsd/`), inverso exacto de `manager.launchWorkItem`, determinista 0-token (preserva "solo el orquestador usa LLM"). Siembra la fila vía el `addSession` existente; NO escribe `dead_since`/`last_seen_alive` (preserva "`reconcileTick` único escritor de `alive`").
- **BIDIR-08 (datos sanitizados) en la fontanería (Phase 53), no en el CLI:** el sanitizador (strip rutas absolutas, redacción home dir, nunca embeber transcript) es una propiedad del núcleo que los 3 consumidores reusan — incluido el orquestador (ORCH-01 pasa su título derivado por ese mismo sanitizador).
- **CLI `kodo adopt` ships sí o sí (Phase 54),** independiente del spike: toma workspace/cwd explícito. Debe existir antes que la tecla del dashboard (56) y el orquestador (57), que lo shellean vía `execFile`.
- **DETECT-01 reconvertido de SPIKE → contrato `HostProvider.describeSurface()` (2026-06-16):** el research empírico `CMUX-CAPABILITIES.md` (P0, cmux 0.64.15) probó la viabilidad sin ambigüedad — `cmux surface resume show --json` da `cwd` + `resume_binding.checkpoint_id` (= `session_id`) + `kind` por surface. Phase 55 deja de ser research abierto y pasa a ser un método opcional typeof-detected en `src/host/cmux.js`, fixture-locked + fail-open. **DETECT-02 (Phase 56) deja de estar gated/condicional**; BIDIR-F1 (fallback INVIABLE) queda moot. Defensa Phase 43 preservada: el set-difference se keyea por `sessionId`/`cwd` estable, nunca por `workspace_ref` reciclable. Decisión transversal LOCKED: todo cmux entra por `HostProvider` (ver Critical Invariants).
- **ORCH-01 (Phase 57) NO depende del spike → paralelizable con Phase 56:** el orquestador es el único carril con LLM; deriva el título inteligente y shellea `kodo adopt --title "<derived>"` con input explícito. El LLM vive estrictamente en el consumidor, el núcleo sigue 0-token. Cero lógica de negocio nueva en el orquestador (solo prosa del skill `kodo-orchestrate`).
- **DEBT-01 + DEBT-02 plegados en UNA fase tail (58):** ambos independientes del flujo de adopción y entre sí, schedulables en paralelo / como low-risk tail. Granularidad coarse → no se padean en dos fases.
- **Cero endpoints nuevos preservado:** la adopción vive en CLI + acción de dashboard que shellea el CLI vía `execFile` (no `POST /adopt` en `src/server.js`). Invariante "cero endpoints nuevos desde v0.10" intacto.

### Roadmap Evolution

- **v0.13 roadmap creado (2026-06-15):** 7 phases (52-58), numeración continua desde v0.12 (NO reset). Build order createTask+contrato+anti-recursión → fontanería → CLI → SPIKE(gate) → tecla dashboard(condicional) → orquestador → deuda. 13/13 requirements mapeados, 100% cobertura. Phase 56 GATED tras veredicto VIABLE de Phase 55. Backlog Phase 999.1 ("kodo bidireccional") materializado en este milestone.
- **v0.12 roadmap creado (2026-06-11):** 4 phases (48-51). Build order OPEN CORE → SPIKE → DISPLAY CONDICIONAL → NYQUIST.
- **v0.11 roadmap creado (2026-06-09):** 4 phases (44-47). Build order OVERLAY+POLISH → SPIKE → CAPTURA CONDICIONAL → NYQUIST.

### Open Blockers

**DEBT-02 (HUMAN-UAT 50.1) — BLOQUEADO POR UPSTREAM (2026-06-22).** La validación del progreso vivo `N/M` no se puede completar porque ninguna sesión llega a la combinación necesaria (`gsd:true` + worktree con STATE.md poblado). El **read-path del progreso está probado** (el dashboard lee el `progress:` del worktree STATE.md correctamente); el fallo está aguas arriba, en que el flag `gsd` no se setea en los caminos de launch probados. Tres hallazgos de la UAT:

- **F2 (✅ RESUELTO 2026-06-22, commit `c87baad`) — `getTask` devolvía `labels: []` para KODO-4 pese a tener el label `kodo` en Plane.** Fix: `getWorkItemBySequence` ahora expande `labels` → vienen como objetos con `name` → `resolveWorkItemLabels` los mapea directo, sin depender del `labelCache`. Probe live confirmó la causa (la work-item traía el label como UUID; con expand viene el objeto) + regresión con labelCache vacío. **Requiere reiniciar el daemon/server kodo para que el fix surta efecto en launches vivos.** Detalle del root-cause original: Evidencia: `kodo launch KODO-4` → `Task: KODO-4 — labels: []` / `isKodo: false`, mientras `list_work_items` (expand=labels) muestra el label `kodo` (id `1c7ff1c9`). **Root cause (2026-06-22):** `getWorkItemBySequence` (`src/providers/plane/client.js:125`) NO expande `labels` → la work-item trae labels como UUIDs; `getTask` los resuelve vía `resolveWorkItemLabels(uuids, labelCache)` (`normalize.js`), y `labelCache` se construye en `init()` (`provider.js:124-131`) por proyecto configurado con TTL (`INIT_TTL_MS`). Si el `labelCache` está stale o no cubre ese label → se cae a `[]`. **Fix direction:** `getTask` ya tiene fallback on-miss para módulos (`getWorkItemModule`, `provider.js:187-195`); replicar el mismo patrón para labels (re-fetch del label en cache-miss) o expandir `labels` en `getWorkItemBySequence`.
- **F3 (CORREGIDO — NO es bug) — `gsd:undefined` en KODO-4 es comportamiento CORRECTO.** Mi registro inicial era erróneo. El modo GSD sale de un label `kodo:gsd`/`kodo:gsd-quick` (`getGsdMode`, `dispatcher.js:104`). KODO-4 solo tiene `kodo` → no es tarea GSD → `gsd:undefined` correcto; no hay `gsd.bootstrap` porque no debe haberlo. `--force` solo salta el gate `isKodo`, no inventa modo GSD. **Lección para DEBT-02:** validar el progreso vivo requiere una tarea con label `kodo:gsd`/`kodo:gsd-quick` EN un proyecto con `.planning/STATE.md` ya poblado.
- **F4 (verificar si by-design) — El worktree se crea desde el último commit PUSHEADO, no desde `main` local.** Evidencia: worktree de `e3d7c49c…` en `6830b4b chore: archive v0.12 milestone`; `main` local en `7eaccd9`. Como no se ha hecho `git push` en toda la sesión, el worktree (y su STATE.md → `5/6`) está 30+ commits stale. Posiblemente by-design (branch desde `origin/main`), pero sorprendente; verificar la elección de base branch en el launch. Dónde mirar: `src/session/manager.js` (creación del worktree / base ref).

**Nota:** el único bug confirmado es **F2** (labels). F3 era falso (corregido). DEBT-02 sigue bloqueado para validación porque ninguna sesión a mano cumple `kodo:gsd`-label + `.planning` poblado a la vez — pero el read-path del progreso está probado.

### Open Questions

Decisiones discuss-phase (no bloquean el roadmap; se resuelven al planificar cada fase):

- **Phase 52:** confirmar el path exacto del endpoint Plane `POST .../work-items/` + el shape del body GitHub Markdown; pin del scope PAT mínimo (`issues:write`/`repo`); el estado "no-trigger" exacto en que se crea la tarea para que `listPendingTasks` no la devuelva (label-aware en Plane vs state inicial en GitHub).
- **Phase 53:** forma exacta del discriminante `{ok:false, code, detail}` (taxonomía de `code`); la regla de sanitización (allowlist vs blocklist) y el alcance de la redacción del home dir; estado inicial "sano" concreto por provider.
- **Phase 55 (contrato, ya NO spike):** nombre exacto del método (`describeSurface(ref)` vs `listAgentSurfaces()`); qué campos de `resume_binding` se consumen y su estabilidad entre reinicios de cmux; capturar el fixture JSON real de `cmux surface resume show --json` (cmux 0.64.15) y asertarlo vía el `run` DI; modos de fallo fail-open (`cleared:true`, `resume_binding` ausente, `source!=agent-hook`, socket caído). Fuente: `research/CMUX-CAPABILITIES.md` P0.
- **Phase 56 (ya NO condicional):** descubrimiento on-demand (set-difference por `sessionId`/`cwd` estable, NUNCA `workspace_ref` reciclable); UX del double-confirm; si la sesión ad-hoc se muestra en un overlay efímero o inline.
- **Phase 58 (LIFE-03) — decisión central:** mapear EMPÍRICAMENTE el baile actual `Stop`↔`reconcileTick`-rescue↔`needs-input` ANTES de mover el cleanup. Hoy `runStopHook` (`stop.js`) hace el cleanup destructivo completo (`removeSession`) en CADA invocación del hook `Stop` (que dispara por turno, sin guard de "fin de sesión"); el dashboard no se vacía porque (a) las sesiones kodo son agénticas single-turn y (b) `reconcileTick` **rescata desde `history`** (`reconcile.js:195-222`, Phase 38 / ROMAN-151/152) las sesiones cuyo `workspace_ref` sigue vivo en cmux. Mover `removeSession` de `Stop` a `SessionEnd` (decisión confirmada por el operador) debe: (1) verificar que `needs-input` sigue visible SIN depender del rescate; (2) decidir si el rescate desde `history` se simplifica o se conserva; (3) mantener `Stop` solo para el estado ligero (`idle`); (4) idempotencia entre los dos hooks. NO es "mover una línea" — es re-coreografiar el lifecycle.

### Critical Invariants to Preserve (cross-milestone, must survive next milestone)

- **TaskProvider contract: 9 obligatorios + getTaskState/createTask opcionales** (canonical en `src/interface.js`): `TASK_PROVIDER_METHODS` FROZEN en 9. **v0.13: `createTask` se añade typeof-detected FUERA de los 9 (espejo `getTaskState`); el loop de validación de `registry.js` queda intacto.**
- **kodo NUNCA elimina tareas:** v0.13 introduce la creación (`createTask`) pero NO el delete — un huérfano de proveedor se resuelve por re-run idempotente (BIDIR-04/05), no por delete.
- **Tokens: vigilante/server 0 tokens; solo el orquestador usa LLM.** **v0.13: la fontanería (`createTask` + `adoptSession`) es determinista 0-token; el LLM vive estrictamente en el consumidor orquestador (ORCH-01).**
- **Cero endpoints nuevos desde v0.10:** **v0.13 lo preserva — la adopción vive en CLI + acción de dashboard que shellea el CLI vía `execFile`, no `POST /adopt`.**
- **`reconcileTick` único escritor de `alive`** (v0.9 Phase 38): **v0.13: `adoptSession` siembra la fila vía `addSession`, NO escribe `dead_since`/`last_seen_alive`.**
- **`execFile` fire-and-forget sin shell** (v0.9 Phase 37): **v0.13: la tecla del dashboard (56) y el orquestador (57) shellean `kodo adopt` con argv literal, nunca shell.**
- **Todo lo cmux-específico entra por `HostProvider`** (LOCKED 2026-06-16, extiende color/cmux-isolation de Phase 38): las capacidades de cmux (incl. la detección de surfaces `describeSurface()`, Phase 55) viven en `src/host/interface.js` (contrato) + `src/host/cmux.js` (única implementación/llamador autorizado, never-throws, `run` DI), detectadas por `typeof` para degradar fail-open. `adopt.js`/`reconcile.js`/hooks permanecen **host-agnósticos** — reciben `{cwd, sessionId, kind}` como datos, JAMÁS llaman a `cmux`. Preserva la abstracción intercambiable cmux→orca. Fuente: `research/CMUX-CAPABILITIES.md`.
- **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **TUI never-throws** (la tecla del dashboard never-throws, panel ink permanece montado) · **Selección por identidad `task_id`** · **TUI read-only salvo dismiss-de-dead** (la adopción shellea el CLI, no escribe desde la TUI) · **Worktree always-on Phase 18** · **LOG-12 guard** · **`--json` byte-determinismo** (DX-06). v0.13 no rompe estos carriles.

## Session Continuity

- **Last session:** 2026-06-19 (cierre de cola v0.13 en modo autónomo)
- **Stopped at:** Phases 52-57, 59, 60 COMPLETE. Phase 58 PARCIAL: DEBT-01 (XSS) cerrado; **LIFE-03 + DEBT-02 pendientes — bloqueados en decisión/TTY humano**.
- **Next action:** Cerrar Phase 58, que NO se pudo terminar en autónomo por dos razones legítimas:
  1. **LIFE-03 (hook `SessionEnd`)** — cirugía de lifecycle Tier-3 (mover `removeSession` de `Stop` per-turn a `SessionEnd` terminal, re-coreografiando el rescate desde `history` de `reconcileTick`). 4 sub-decisiones abiertas (ver §Open Questions Phase 58). NO se debe implementar a ciegas: requiere `/gsd:discuss-phase 58` y verificación en TTY real.
  2. **DEBT-02 (HUMAN-UAT 50.1)** — los 3 escenarios del display de progreso vivo `N/M` requieren un TTY real con sesión GSD viva. Solo el operador puede ejecutarlo (`50.1-HUMAN-UAT.md`).
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.13 kodo bidireccional)
  - `.planning/ROADMAP.md` (v0.13 activo Phases 52-58; v0.10/v0.11/v0.12 colapsados en archived; backlog 999.1 materializado)
  - `.planning/REQUIREMENTS.md` (v0.13, traceability 13/13 → Phases 52-58)
  - `.planning/research/` (ARCHITECTURE, FEATURES, PITFALLS, STACK — research v0.13 completo; build order en ARCHITECTURE.md §"Suggested Build Order")
  - `.planning/MILESTONES.md` (entrada v0.12 completa)

## Operator Next Steps

v0.13 tiene las fases 52-60 entregadas en código (suite 1499 verde). Pendientes:

- **DEBT-02 (HUMAN-UAT 50.1): BLOQUEADO POR UPSTREAM** (ver §Open Blockers F2/F3/F4, 2026-06-22). El read-path del progreso está probado, pero el flag `gsd` no se setea en los launches probados → la columna se queda en `—`. Desbloquear requiere arreglar F2 (labels) / F3 (gsd en launch) primero.
- **Phase 61 (NUEVA, registrada desde UAT 2026-06-22):** progreso vivo para sesiones **adoptadas**. Hallazgo del UAT de DEBT-02: una sesión GSD adoptada NO muestra `N/M` porque (1) la adopción no marca `gsd` (`buildSessionFromAdoption` lo omite → gate `App.js:419`) y (2) el lector asume worktree de kodo (`computeRealWorktreePath`, `App.js:433`) que una adoptada no tiene. Sin planificar — `/gsd:discuss-phase 61`.

Tras DEBT-02 (y decidir si Phase 61 entra en v0.13 o se difiere): `/gsd:audit-milestone` → `/gsd:complete-milestone v0.13`.

Lo cerrado en autónomo (2026-06-19): Phase 59 formalizada (`c47362f`), Phase 60 implementada (`b09be90`/`9124cfa`/`93271d9`), Phase 58 LIFE-03 hook SessionEnd (`5a8c2a0`/`0e2e7f8`/`b8129eb`) + DEBT-01 XSS test (`976f8a6`). Todo local, **sin push**.
