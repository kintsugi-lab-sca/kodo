---
gsd_state_version: 1.0
milestone: v0.19
milestone_name: Inbox de capturas + fix stealLock + saneo de deuda
current_phase: 83
current_phase_name: inbox-foundation-captura-triage
status: executing
stopped_at: Completed 83-05-PLAN.md
last_updated: "2026-07-25T16:09:00.030Z"
last_activity: 2026-07-25
last_activity_desc: Phase 83 execution started
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 9
  completed_plans: 7
  percent: 25
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.19 «Inbox de capturas + fix stealLock + saneo de deuda»** — roadmap creado 2026-07-24 (Phases 82-85, 15/15 requirements mapeados, granularidad `coarse`). **Awaiting plan** de la Phase 82 (`/gsd-plan-phase 82`). Tres workstreams independientes: fix real de `stealLock` (Phase 82, R-81-01 resuelta = fix), inbox de capturas global (Phases 83-84), barrido de deuda doc/Nyquist (Phase 85).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-24 after v0.18).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega e higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux; **v0.18 quitó al humano la carga de mantener el sidebar de cmux** — un doctor determinista lo cura, el orquestador lo invoca de piggyback, y la deuda menor de v0.17 quedó saldada. **v0.19 da a kodo su primer buffer de captura global** + cierra la carrera de `stealLock` diagnosticada en v0.18 + salda la deuda doc/Nyquist de v0.16+v0.18.

**Current focus:** Phase 83 — inbox-foundation-captura-triage

## Current Position

Phase: 83 (inbox-foundation-captura-triage) — EXECUTING
Plan: 5 of 7
Status: Ready to execute
Last activity: 2026-07-25 — Phase 83 execution started

## Most recent shipped milestone

**v0.18 Higiene del sidebar de cmux** — shipped 2026-07-24 (3 phases 79-81, 9 plans; audit `tech_debt` sin blockers — 12/12 reqs · 3/3 fases verificadas · integración 8/8 · flujos E2E 4/4; suite 2309 → 2364 tests; 86 commits en 3 días). El sidebar de cmux se mantiene solo: **Phase 79** — `kodo sidebar doctor [--fix|--json]` determinista 0-tokens (allowlist `add`/`ungroup`, `missing_group` advisory tras G-79-1: `execute()` jamás emite `create`/`set-anchor`, guard source-hygiene contra `delete`, launch path byte-idéntico, UAT 4/4 en vivo). **Phase 80** — piggyback in-process del doctor en pases motivados de `kodo check` (gate `needsOrchestrator`, fail-open, sidebar NO trigger — D-04) + skill `kodo-orchestrate`/`prompt.md` reconciliados con v0.17. **Phase 81** — deuda v0.17 saldada: contrato tres-estados del `next` por presencia (DEBT-01), doc-drift 75 (DEBT-02), colapso de whitespace render-only en `nextCell` (DEBT-03), y diagnóstico de causa raíz del flaky `gsd-lock-race`: **carrera real en `stealLock`**, fix → decisión de mantenedor (DEBT-04/R-81-01, resuelta al abrir v0.19 = fix real → Phase 82).

- Roadmap archive: `milestones/v0.18-ROADMAP.md`
- Requirements archive: `milestones/v0.18-REQUIREMENTS.md`
- Audit: `milestones/v0.18-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.18-phases/`

(Anterior: **v0.17 Plan vivo por-tarea**, shipped 2026-07-22 — archivos en `milestones/v0.17-*`.)

## Deferred Items

Baseline al cierre de v0.18 (2026-07-24). **Varios items quedan ahora programados en el roadmap v0.19** y se cerrarán al completar sus fases: la carrera de `stealLock` **YA CERRADA** — fix real shippeado en **Phase 82** (commit `16d60b6`); 81-REVIEW WR-01/WR-02 (R-81-02) → **Phase 85** (DEBT-05/06); Nyquist draft de 79/80/81 y 69/71/72 → **Phase 85** (NYQ-01/02). El resto sigue diferido con su trigger real.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Concurrencia | **Carrera real confirmada en `stealLock`** (`src/gsd/lock.js`): el move-aside `renameSync` dejaba `lockPath` ausente una ventana en la que dos `O_EXCL` podían ganar a la vez → doble adquisición con N≥2 procesos robando el mismo lock muerto. Diagnóstico completo en `.planning/debug/resolved/gsd-lock-race-cr01.md` + `81-DEBT-04-DIAGNOSIS.md`. | ✅ **Cerrada** — fix real en Phase 82 (commits `588a5cb` + rework `16d60b6`): move-aside eliminado (propiedad solo por `renameSync(tmp→lockPath)`), steal-guard `O_EXCL` publicado atómicamente vía `linkSync` (sin ventana briefly-empty en el guard); CR-01 verde determinista 100/100 bajo carga (+300 iters rework), suite 2370 verde. R-81-01 saldada = fix. | v0.18 Phase 81 (DEBT-04) |
| Concurrencia | **82-REVIEW CR-01 (carrera de segundo orden en `stealLock`, holder VIVO):** el branch PRESENT del steal hace `renameSync(tmp→lockPath)` incondicional y los creadores Case-1 no pasan por el guard — con un holder stale VIVO (TTL expirado / corrupt-live) que hace `release` en plena sección crítica, el stealer puede clobbear a un creador fresco legítimo → dos owners. Fuera del criterio literal LOCK-01 (holder MUERTO, cerrado y probado); invisible al harness (siembra solo dead-PID). Fix por construcción exige serializar Case-1/release con el guard (rediseño del primitivo). Detalle en `82-REVIEW.md` CR-01 (+ WR-01/WR-02/IN-01/IN-02 menores). | **Pendiente de decisión del mantenedor (R-82-01)** — fix con gate vs riesgo aceptado documentado; NO aplicar parche apresurado (T-81-03-02) | v0.19 Phase 82 (code review) |
| Doc/consistencia | 81-REVIEW WR-01 (typedef `TaskHandoff` en `state.js:53` documenta la semántica PRE-DEBT-01) · WR-02 (`deriveAnyNext` en `select.js:258` no colapsa whitespace al decidir presencia de columna) — aceptados en UAT 81 como deuda conocida | **Programado → v0.19 Phase 85** (DEBT-05/06, salda R-81-02) | v0.18 Phase 81 |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION | **Programado → v0.19 Phase 85** (NYQ-02) | v0.16 |
| Nyquist | VALIDATION.md en draft (seeded, nunca reconciliado) en Phases 79/80/81 — cobertura real sí evidenciada en cada VERIFICATION (suite 2364) | **Programado → v0.19 Phase 85** (NYQ-01) | v0.18 |
| Observabilidad | 3 warnings de 80-REVIEW.md (observabilidad/cobertura) — a resolver o re-aceptar individualmente | **Programado → v0.19 Phase 85** (DEBT-07) | v0.18 Phase 80 |
| Operación | El grupo cmux `SCP-CMRi` del operador no matchea el identifier derivado `SCP` — tareas SCP se lanzan sin grupo (fail-open correcto); renombrar el grupo a `SCP` para agruparlas | Acción de operador (fuera de scope) | v0.17 Phase 77 |
| Riesgo aceptado | IN-07 / R-77-D10 (LOCKED D-10): el retry TOCTOU de `newWorkspaceWithGroupFallback` puede duplicar workspace ante timeout | Aceptado y documentado (78-SECURITY.md §Accepted Risks) | v0.17 Phase 77 |
| Verificación empírica | CONC-09 — sign-off humano de la ubicación real de worktrees (`.bg-shell` vs `.claude/worktrees`); `doctor --fix` scan path sin cambiar hasta confirmarlo en sesión GSD viva | Diferido por diseño (D-15, precedente 50.1) | v0.16 Phase 70 |
| UAT | Backstop GitHub real (nunca cierra issues) — skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria | Abierto (requiere repo GitHub real) | v0.16 Phase 71 |
| Cliente Plane | B12b — throttle epoch-vs-delta (`x-ratelimit-reset` no confirmable barato en Plane self-hosted) | Diferido con nota (D-02) | v0.16 Phase 72 |
| Evidencia en vivo | Round-trip completo `kodo sidebar doctor --fix` sobre sesión suelta real (79/SDR-05) y convergencia ≤1 pase del piggyback contra cmux vivo (80/ORCH-07) — cableado y unit verificados; falta solo el escenario real con deriva | Pendiente de que aparezca deriva real (no fabricar estado en el sidebar del operador) | v0.18 Phases 79-80 |
| Cliente Plane | `Retry-After`/filtro kodo/paginación (M7-M9) | v2 (fuera de roadmap) | — |
| Rendimiento | Reconcile asíncrono (M21) — **medir antes de arreglar** | v2 (solo si `/health` muestra latencia real) | — |

## Accumulated Context

### Decisions

Log completo en `PROJECT.md` §Key Decisions — v0.18 añadió 5 filas (`missing_group` report-only tras G-79-1, piggyback in-process gated/fail-open, reconciliación documental asimétrica, contrato tres-estados del `next` por presencia, colapso whitespace render-only, DEBT-04 diagnóstico-sin-fix con `lock.js` READ-ONLY). Las decisiones per-plan y los constraints LOCKED de v0.18 quedaron archivados con sus fases en `milestones/v0.18-phases/` y en `milestones/v0.18-ROADMAP.md`.

**Decisión de apertura v0.19 (2026-07-24):** R-81-01 resuelta por el mantenedor = **fix real** de la carrera de `stealLock` (no aceptación definitiva), coherente con el espíritu hardening de v0.16/v0.18. Constraint heredado del diagnóstico: el test `gsd-lock-race` NO se greenea enmascarando — solo con el fix real de la ventana.

**Decisión abierta a resolver en discuss/plan de Phase 83 (research SUMMARY, no defaultear):** modelo de estado del marcado del inbox — lock compartido `withFileLock` + token in-place vs. event-log append-only. Determina si el append necesita compartir lock o queda `O_APPEND` puro.

**Frontera vigente cross-milestone (v0.18):** la gestión de grupos cmux (`create`/`add`/`set-anchor`/`ungroup`) SOLO existe en el carril doctor; `workspace-group delete` jamás se cablea (guard source-hygiene); el launch path sigue solo-`list` + `--group` fail-open; el sidebar NO es trigger del orquestador; `missing_group` es advisory del operador — el doctor nunca crea/ancla grupos en sesiones vivas.

- [Phase ?]: 82-01: stealLock cierra la carrera por construcción con steal-guard O_EXCL + renameSync(tmp->lockPath); move-aside eliminado (D-01/D-02)
- [Phase ?]: 82-01: guard breakable por PID muerto (primario) o edad>5000ms (backstop); discriminar presente(rename)/ausente(O_EXCL) con existsSync para preservar Case 5 corrupt (D-08)
- [Phase ?]: 82-01 rework: publicar el steal-guard atómicamente vía linkSync(tmp->guardPath); writeFileSync(wx) reabria la ventana briefly-empty en el guard (doble adquisicion reproducible). guardIsStale no rompe por parse-failure, solo por PID/edad. Validado: 300 iters CR-01 sin fallos.
- [Phase ?]: 82-02: CR-01 verde determinista validado (100/100 bajo carga 4x, suite 2370 verde) sobre el rework de 82-01 (linkSync atomic guard publish, 16d60b6); R-81-01 saldada = fix real, debug session en resolved/, fila Deferred cerrada
- [Phase ?]: 83-01: el marcado del inbox publica con tmp de nombre ÚNICO (<path>.tmp.<pid>.<randomUUID>) + renameSync; writeFileAtomic de src/config.js inalcanzable POR CONSTRUCCIÓN (store.js no importa config.js) — STATE.md:100
- [Phase ?]: 83-01: '- [x]' hand-editado sin sufijo de estado se lee como cerrada con cierre desconocido; route/discard devuelven already-closed y NO reescriben la línea (contrato 2)
- [Phase ?]: 83-01: el marcado NO hace fail-open ante lock-timeout — asimetría deliberada frente al fail-open de la captura (D-03); un marcado sin coordinación reintroduce el lost-update que D-01 cierra
- [Phase ?]: 83-01: sin reintento ante colisión de ID corto (~0,023% a 1000 capturas); markCapture marca la PRIMERA línea que casa (contrato 5)
- [Phase ?]: 83-01: los paths del inbox son un resolvedor PEREZOSO defaultInboxPaths(), nunca constante de módulo — la fuga de HOME de config.js:11 contamina los tests (contrato 7)
- [Phase ?]: 83-02: el carril --json emite el texto VERBATIM (JSON.stringify ya escapa los bytes C0); el saneo agresivo vive solo en el render human, que es el que llega al terminal
- [Phase ?]: 83-02: el listado del inbox nunca sale con código distinto de 0, ni siquiera si el render lanza (never-throws de cuerpo entero, D-18)
- [Phase ?]: 83-02: los gates source-hygiene se anclan al PATRÓN DE IMPORT, no al nombre suelto del módulo — un comentario que documente la regla no puede poner roja la suite
- [Phase ?]: 83-03: el riesgo residual de D-03 se materializó — con el presupuesto de lock por defecto (~160 ms) las 6 capturas concurrentes a un marcado hacían fail-open y el rename las borraba TODAS (0/6). Arreglo: CAPTURE_LOCK_RETRIES=50 × 20 ms ≈ 1000 ms en appendCapture, el fix que D-03 prescribía; el test NO se debilitó — **SUPERSEDED por 83-04: ese arreglo NO cerró el lost-update, solo movió el umbral (0/6 supervivientes de nuevo con un hold de 1500 ms); las dos constantes ya no existen**
- [Phase ?]: 83-03: el presupuesto de lock de la captura es un TECHO, no una espera — coste cero en el camino feliz; el fail-open de D-03 no se elimina, solo se aleja (hace falta >1 s sosteniendo el lock para alcanzarlo) — **SUPERSEDED por 83-04: el presupuesto vuelve al default y el fail-open es deliberadamente alcanzable; mantenerlo lejos era enmascarar la carrera (DEBT-04)**
- [Phase ?]: 83-03: el seam de enrutado queda documentado como delegación pura — README y skill del orquestador llevan el mismo bloque de tres pasos byte a byte y afirman que kodo no invoca, no importa y no reimplementa la lógica de destinos
- [Phase ?]: 83-04: el lost-update del inbox se cierra con un guard compare-and-swap dentro del lock (bytes de la LECTURA + inodo del destino, comprobados justo antes del renameSync), NO con un presupuesto de reintentos — revierte la decisión central de 83-03
- [Phase ?]: 83-04: CAPTURE_LOCK_RETRIES/BACKOFF eliminadas — appendCapture vuelve a los defaults de withFileLock y la rama fail-open vuelve a ser ALCANZABLE (una rama inalcanzable es una rama sin cobertura, DEBT-04)
- [Phase ?]: 83-04: la publicación del marcado resuelve el destino real (realpathSync) y reaplica el modo con chmodSync antes del rename — el symlink y el chmod 0600 del operador sobreviven (WR-01)
- [Phase ?]: 83-05: el truncado del carril --json no estaba en los handlers de src/cli/ (que ya retornaban el codigo desde 83-02) sino en el registro de commander de src/cli.js — los cuatro handlers del inbox fijan process.exitCode y dejan drenar stdout
- [Phase ?]: 83-05: el cambio se acota a los cuatro comandos del inbox; polling/daemon/gsd/sidebar/skill conservan el mecanismo actual (payloads muy por debajo de 64 KB) — deuda registrada para un barrido propio
- [Phase ?]: 83-05: el gate source-hygiene se acota por sed a la REGION del inbox y filtra comentarios antes de contar — un gate de fichero completo seria incorrecto por construccion (37 usos legitimos en el resto del fichero)
- [Phase ?]: 83-05: fixture de regresion de 1500 capturas (~230 KB) que NO se recorta por rapidez; mordida verificada revirtiendo el arreglo a mano (3 casos rojos con 'se corto en 65536 bytes')
- [Phase ?]: 83-05: WR-05 se cierra DOCUMENTANDO el separador de argumentos en la ayuda de kodo capture, no interceptando el error de opcion desconocida de commander (diferido); la limitacion conocida queda fijada por un test etiquetado, no por un comentario

### Open Blockers

Ninguno. v0.18 cerró con audit `tech_debt` sin blockers (verified closeout).

### Critical Invariants to Preserve (cross-milestone)

- **`/webhook` conserva HMAC y `/health` queda abierto** — la auth bearer es SOLO para el carril no-webhook.
- **Boundary PERSIST-04:** API key y bearer token solo en `~/.kodo/.env` (0600); nunca renderizados/logueados/en `/status`/en argv.
- **Server loopback-first:** bind `127.0.0.1` por defecto; exponer requiere `config.server.bind` explícito (topología multi-nodo en README).
- **Modelo daemon PERSISTENTE:** solo `kodo stop` lo tumba; PID ownership de v0.16 (CONC-04/05) no puede regresionar esto.
- **Escrituras de `state.json` bajo `withStateLock`** — cualquier escritor nuevo DEBE pasar por la primitiva (`src/session/state.js`); `reconcileTick` sigue siendo el único escritor de `alive`.
- **Lock del inbox (v0.19):** la primitiva es `withFileLock` (`src/session/state-lock.js:215`), NUNCA `src/gsd/lock.js`; los appends usan `O_APPEND`, cualquier rewrite usa unique-tmp-name + rename — jamás `writeFileAtomic` (fixed tmp) para paths del inbox.
- **D-02 (v0.11 Phase 46):** `readPlan` da prioridad a GSD; el plan ligero (y el handoff) solo se surface en la rama `phaseId == null`. El handoff se escribe en disco para TODA sesión, pero no se pinta en el overlay GSD.
- **El handoff se escribe ANTES del cleanup terminal destructivo de `SessionEnd`** (`removeSession` + worktree + promptFile) — v0.17 Phase 74.
- **Contenido LLM hacia terminal/keystroke SIEMPRE saneado** (`stripControlChars` en composición, `stripForKeystroke` en el carril keystroke) — v0.17 Phase 78; simetría con HYG-07. Aplica al texto capturado del inbox (CAPT-01).
- **kodo consume grupos cmux — la gestión (`create`/`add`/`set-anchor`/`ungroup`) se permite SOLO en el nuevo carril doctor de v0.18 (GRP-04 re-fronterizado); el launch path sigue solo-`list` + `--group`, refs `workspace_group:N` nunca persistidos, y `workspace-group delete` jamás cableado** — v0.17 Phase 77 → re-fronterizado en v0.18 Phase 79.
- **Backstop de «In Review» en `SessionEnd` con gate de estado no-terminal** — jamás transicionar a un estado terminal (GitHub `closed`); el orden de efectos `backstop→setColor→notify` es LOCKED (D-08).
- **Auto-commit del orquestador gated por `KODO_ORCHESTRATOR=1` + pathspec** — sin la var → skip (cero commits fantasma).
- **`kodo start` legacy intacto** · **Cero endpoints nuevos en `src/server.js` (desde v0.10)** · **Cero nuevas dependencias npm** (locks vía `node:fs` built-in) · **TaskProvider contract FROZEN en 9** + métodos opcionales por `typeof` · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**.

### Roadmap Evolution

- 2026-07-24 — Roadmap v0.19 creado: 3 workstreams independientes → 4 fases (granularidad `coarse`). **Phase 82** fix de la carrera de `stealLock` (LOCK-01..03, promueve el hallazgo DEBT-04/R-81-01); **Phase 83** inbox foundation — `kodo capture` + `kodo inbox` triage + seam `gsd-capture` (CAPT-01/03/04/06, candidata backlog 999.2 promovida y ampliada); **Phase 84** superficies de captura — `/kodo-capture` + skill-sync multi-skill + conteo ambient (CAPT-02/05/07, depende de 83); **Phase 85** saneo de deuda + Nyquist retroactivo (DEBT-05/06/07 + NYQ-01/02). 15/15 requirements mapeados, cero orphans. Backlog 999.2 renumerado a Phases 83-84; la candidata trazaba CAPT-01..04, el milestone amplió con CAPT-05/06/07.
- 2026-07-22 — Roadmap v0.18 creado: candidata backlog 999.3 promovida a Phases 79-80; los 4 items de deuda menor del audit v0.17 absorbidos como Phase 81 (DEBT-01..04). Granularidad `coarse` → 3 fases. 12/12 requirements mapeados.

## Session Continuity

**Last session:** 2026-07-25T16:09:00.022Z

**Resume file:**

None

- **Stopped at:** Completed 83-05-PLAN.md
- **Next action:** `/gsd-plan-phase 82` — planificar el fix de la carrera de `stealLock` (workstream independiente, primero por prioridad). Las Phases 83-85 son independientes entre sí salvo 84→83.
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-24 after v0.18; milestone v0.19 declarado)
  - `.planning/ROADMAP.md` (v0.19 activo Phases 82-85 + Phase Details; v0.18 colapsado; Backlog con 999.1 shipped + 999.2 promovida a 83-84 + 999.3 shipped)
  - `.planning/REQUIREMENTS.md` (15/15 requirements mapeados; traceability completa)
  - `.planning/research/SUMMARY.md` (research del inbox de capturas — decisión del modelo de estado flagged para discuss/plan de Phase 83)
  - `.planning/MILESTONES.md` (entrada v0.18 completa; v0.19 en curso)

## Operator Next Steps

- Planificar la Phase 82 con `/gsd-plan-phase 82` (fix de la carrera de `stealLock`)
- En discuss/plan de la Phase 83: **decidir explícitamente el modelo de estado del inbox** (lock compartido `withFileLock` vs event-log append-only) — flagged por el research, no defaultear
- `git push` (+ tag v0.18) sigue pendiente de decisión del operador — v0.18 es local

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (baseline post-v0.18 — métricas per-plan de v0.18 archivadas en `milestones/v0.18-phases/`; medias v0.18: ~8 min/plan, 9 plans; medias v0.17: ~12 min/plan, 17 plans) |
**Per-Plan Metrics:**

| Plan | Duration | Tasks | Files |
|------|----------|-------|-------|
| Phase 82 P01 | 20min | 2 tasks | 3 files |
| Phase 82 P02 | 15min | 2 tasks | 2 files |
| Phase 83 P01 | 41min | 3 tasks | 3 files |
| Phase 83 P02 | 15min | 3 tasks | 4 files |
| Phase 83 P03 | 8min | 3 tasks | 5 files |
| Phase 83 P04 | 6min | 2 tasks | 2 files |
| Phase 83 P05 | 10min | 3 tasks | 2 files |

### Blockers

- Ninguno. (El blocker de 82-02 «el fix de 82-01 no cierra CR-01» quedó **resuelto 2026-07-25** por el rework de 82-01 — commit `16d60b6`, publicación atómica del steal-guard vía `linkSync`; CR-01 verde determinista 100/100 bajo carga, suite 2370 verde.)
