---
gsd_state_version: 1.0
milestone: v0.19
milestone_name: Inbox de capturas + fix stealLock + saneo de deuda
current_phase: 85
current_phase_name: Saneo de deuda + Nyquist retroactivo
status: milestone complete
stopped_at: Phase 85 complete, milestone v0.19 al 100% — listo para archivar
last_updated: "2026-07-28T10:41:00.607Z"
last_activity: 2026-07-28
last_activity_desc: Phase 85 complete; milestone v0.19 al 100% (4/4 fases, 17/17 planes)
progress:
  total_phases: 4
  completed_phases: 4
  total_plans: 17
  completed_plans: 17
  percent: 100
---

# Project State

**Project:** kodo
**Estado:** Milestone **v0.19 «Inbox de capturas + fix stealLock + saneo de deuda»** — roadmap creado 2026-07-24 (Phases 82-85, 15/15 requirements mapeados, granularidad `coarse`). **Phases 82, 83 y 84 completas**: carrera de `stealLock` cerrada con fix real (LOCK-01..03, 2026-07-25), buffer de captura global operativo con su invariante de concurrencia cerrado por guard compare-and-swap tras un ciclo de gap-closure (CAPT-01/03/04/06, 2026-07-25), y **superficies de captura completas** (CAPT-02/05/07, 2026-07-26): `/kodo-capture` mid-session, `kodo skill sync` multi-skill con allowlist congelada y conteo ambient de capturas sin enrutar en el dashboard — UAT 25/25 pass, suite 2586 verde. **Awaiting plan** de la Phase 85 (`/gsd-plan-phase 85`), última del milestone. Tres workstreams independientes: fix real de `stealLock` (Phase 82 ✓), inbox de capturas global (Phases 83 ✓ + 84 ✓), barrido de deuda doc/Nyquist (Phase 85).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-26 after Phase 84).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9-v0.14 profundizaron el dashboard (observabilidad → gestión → ventana al plan → puente inverso → configuración); v0.15 unificó el arranque (`kodo up`) y el onboarding dashboard-first; **v0.16 endureció** red, concurrencia, entrega e higiene; **v0.17 hizo del plan por-tarea estado vivo** (handoff acumulativo + `NEXT:` → dashboard y nudge) + convergencia de `pending` + agrupación de workspaces cmux; **v0.18 quitó al humano la carga de mantener el sidebar de cmux** — un doctor determinista lo cura, el orquestador lo invoca de piggyback, y la deuda menor de v0.17 quedó saldada. **v0.19 da a kodo su primer buffer de captura global** + cierra la carrera de `stealLock` diagnosticada en v0.18 + salda la deuda doc/Nyquist de v0.16+v0.18.

**Current focus:** Milestone v0.19 COMPLETO (4/4 fases) — listo para /gsd-complete-milestone v0.19

## Current Position

Phase: 85 — Saneo de deuda + Nyquist retroactivo
Plan: Not started
Status: milestone complete — listo para /gsd-complete-milestone v0.19
Last activity: 2026-07-28 — Phase 85 complete; milestone v0.19 al 100% (4/4 fases, 17/17 planes)

## Most recent shipped milestone

**v0.18 Higiene del sidebar de cmux** — shipped 2026-07-24 (3 phases 79-81, 9 plans; audit `tech_debt` sin blockers — 12/12 reqs · 3/3 fases verificadas · integración 8/8 · flujos E2E 4/4; suite 2309 → 2364 tests; 86 commits en 3 días). El sidebar de cmux se mantiene solo: **Phase 79** — `kodo sidebar doctor [--fix|--json]` determinista 0-tokens (allowlist `add`/`ungroup`, `missing_group` advisory tras G-79-1: `execute()` jamás emite `create`/`set-anchor`, guard source-hygiene contra `delete`, launch path byte-idéntico, UAT 4/4 en vivo). **Phase 80** — piggyback in-process del doctor en pases motivados de `kodo check` (gate `needsOrchestrator`, fail-open, sidebar NO trigger — D-04) + skill `kodo-orchestrate`/`prompt.md` reconciliados con v0.17. **Phase 81** — deuda v0.17 saldada: contrato tres-estados del `next` por presencia (DEBT-01), doc-drift 75 (DEBT-02), colapso de whitespace render-only en `nextCell` (DEBT-03), y diagnóstico de causa raíz del flaky `gsd-lock-race`: **carrera real en `stealLock`**, fix → decisión de mantenedor (DEBT-04/R-81-01, resuelta al abrir v0.19 = fix real → Phase 82).

- Roadmap archive: `milestones/v0.18-ROADMAP.md`
- Requirements archive: `milestones/v0.18-REQUIREMENTS.md`
- Audit: `milestones/v0.18-MILESTONE-AUDIT.md`
- Phases: `milestones/v0.18-phases/`

(Anterior: **v0.17 Plan vivo por-tarea**, shipped 2026-07-22 — archivos en `milestones/v0.17-*`.)

## Deferred Items

Baseline al cierre de v0.18 (2026-07-24). **Los items programados en el roadmap v0.19 quedan cerrados:** la carrera de `stealLock` — fix real shippeado en **Phase 82** (commit `16d60b6`); 81-REVIEW WR-01/WR-02 (R-81-02) → **Phase 85 / DEBT-05/06** (plan `85-01`); los 3 warnings de 80-REVIEW → **Phase 85 / DEBT-07** (plan `85-02`); Nyquist draft de 79/80/81 → **Phase 85 / NYQ-01** (plan `85-03`) y de 69/71/72 → **Phase 85 / NYQ-02** (plan `85-04`). El resto sigue diferido con su trigger real.

**Lo que la Phase 85 evaluó y decidió NO cerrar** — razón y trigger en `.planning/phases/85-saneo-de-deuda-nyquist-retroactivo/deferred-items.md`: el **`format-isolation` transitivo** (D-18, pese a estar anotado como «candidato natural de la Phase 85») junto con **OQ-1** (el mismo comentario de premisa falsa que `85-02` retiró de `check-isolation.test.js` sigue verbatim en `test/format-isolation.test.js:14,33`) — se corrigen **juntos**; **`IN-01` de 80-REVIEW** (es *info*, no warning — D-10); el refresco de **`.planning/codebase/TESTING.md`** (D-20); y **R-82-01** (D-19: la fase no abre `src/gsd/lock.js`). Las filas de **«Evidencia en vivo»** y de **UAT / backstop GitHub real** quedaron mejor **contabilizadas** por `85-03`/`85-04` (manual-only con su evidencia citada), lo cual **no es resolverlas**: siguen abiertas con su trigger original.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| Concurrencia | **Carrera real confirmada en `stealLock`** (`src/gsd/lock.js`): el move-aside `renameSync` dejaba `lockPath` ausente una ventana en la que dos `O_EXCL` podían ganar a la vez → doble adquisición con N≥2 procesos robando el mismo lock muerto. Diagnóstico completo en `.planning/debug/resolved/gsd-lock-race-cr01.md` + `81-DEBT-04-DIAGNOSIS.md`. | ✅ **Cerrada** — fix real en Phase 82 (commits `588a5cb` + rework `16d60b6`): move-aside eliminado (propiedad solo por `renameSync(tmp→lockPath)`), steal-guard `O_EXCL` publicado atómicamente vía `linkSync` (sin ventana briefly-empty en el guard); CR-01 verde determinista 100/100 bajo carga (+300 iters rework), suite 2370 verde. R-81-01 saldada = fix. | v0.18 Phase 81 (DEBT-04) |
| Concurrencia | **82-REVIEW CR-01 (carrera de segundo orden en `stealLock`, holder VIVO):** el branch PRESENT del steal hace `renameSync(tmp→lockPath)` incondicional y los creadores Case-1 no pasan por el guard — con un holder stale VIVO (TTL expirado / corrupt-live) que hace `release` en plena sección crítica, el stealer puede clobbear a un creador fresco legítimo → dos owners. Fuera del criterio literal LOCK-01 (holder MUERTO, cerrado y probado); invisible al harness (siembra solo dead-PID). Fix por construcción exige serializar Case-1/release con el guard (rediseño del primitivo). Detalle en `82-REVIEW.md` CR-01 (+ WR-01/WR-02/IN-01/IN-02 menores). | **Pendiente de decisión del mantenedor (R-82-01)** — fix con gate vs riesgo aceptado documentado; NO aplicar parche apresurado (T-81-03-02) | v0.19 Phase 82 (code review) |
| Doc/consistencia | 81-REVIEW WR-01 (typedef `TaskHandoff` en `state.js:53` documenta la semántica PRE-DEBT-01) · WR-02 (`deriveAnyNext` en `select.js:258` no colapsa whitespace al decidir presencia de columna) — aceptados en UAT 81 como deuda conocida | ✅ **Cerrada** — saldada por **DEBT-05** y **DEBT-06** en el plan `85-01` (commits `b9624e1` typedef · `8cc703c` test RED · `ba69110` delegación). WR-01: el typedef enuncia ahora el contrato tres-estados por PRESENCIA, con la cita a `handoff-state.test.js:265/288/307` como evidencia (doc-only, D-01/D-03). WR-02: `deriveAnyNext` **delega** en `nextCell` (`rows.some((r) => nextCell(r).length > 0)`), así que la incoherencia deja de ser posible por construcción, no por disciplina (D-04). Auditoría D-02 **cerrada vacía y verificada** (0 hits fuera de `state.js` en `src/`, `README.md`, `.planning/codebase/`, `.claude/skills/`). **R-81-02 saldada.** | v0.18 Phase 81 |
| Nyquist | VALIDATION.md en draft (mapa por-task vacío) en Phases 69/71/72 — cobertura real de tests sí evidenciada en VERIFICATION | ✅ **Cerrada** — saldada por **NYQ-02** en el plan `85-04` (commits `4418515` /69 · `264904b` /71 · `43f0386` /72): las tres pasan a `status: validated` + flag Nyquist en **true**, **citation-based**, con las **23 filas** de sus Per-Task Verification Maps citando fichero + sección + conteo (17/14/15 referencias a su `VERIFICATION.md` respectivo) y **5 items** no automatizables contabilizados como Manual-Only. Cero tests generados y cero re-corridas de suite (D-12); `MILESTONE-AUDIT.md` de v0.16 intacto (D-15). El `skipped: 1` del UAT de 71 (GitHub real) se citó **como skip**, nunca doblado a pass. | v0.16 |
| Nyquist | VALIDATION.md en draft (seeded, nunca reconciliado) en Phases 79/80/81 — cobertura real sí evidenciada en cada VERIFICATION (suite 2364) | ✅ **Cerrada** — saldada por **NYQ-01** en el plan `85-03` (commits `64de09b` /81 · `3eec586` /80 · `adabb94` /79): las tres pasan a `status: validated` + `nyquist_compliant: true`, **citation-based**, con las **20 filas** de sus Per-Task Verification Maps citando fichero + sección + conteo (13/14/14 referencias a su `VERIFICATION.md`) y **4 items** no automatizables como Manual-Only. `audit-milestone §5.5` las lee ahora COMPLIANT en vez de NOT-VALIDATED. Cero tests generados y cero re-corridas de suite (D-12); `MILESTONE-AUDIT.md` de v0.18 intacto (D-15). | v0.18 |
| Observabilidad | 3 warnings de 80-REVIEW.md (observabilidad/cobertura) — a resolver o re-aceptar individualmente | ✅ **Cerrada** — saldada por **DEBT-07** en el plan `85-02` (commits `60458a4` RED · `c50d5b0` GREEN · `4abacbc` guard). **Los 3 se RESOLVIERON; ninguno se re-aceptó.** WR-01: el piggyback emite por `errorFn` (stderr) `[kodo:check] Sidebar: N acción(es) fallida(s) (fail-open)` — gate, orden y fail-open intactos, LOG-12 sin inyectar logger. WR-02: Test F y Test G cruzan por fin `needsOrchestrator: true` × `hasAdvisories: true`, la combinación que ningún caso previo alcanzaba. WR-03: comentario de premisa falsa retirado (`06-RESEARCH A3` → 0 hits en el fichero) y guard reforzado con source-grep sobre la salida de `walkImports`, con **mordida verificada** (violación inyectada → RC=1 → revert). **`IN-01` queda DIFERIDO**: está clasificado *info*, no warning, y el criterio literal decía «los 3 warnings» (D-10) → `85/deferred-items.md`. | v0.18 Phase 80 |
| Distribución de skills | **D-08b** — el carril de auto-sync del orquestador (`src/orchestrator/launch.js`) sigue sincronizando SOLO `kodo-orchestrate`; un operador que use `kodo orchestrate` y nunca ejecute `kodo skill sync` **no recibirá** `/kodo-capture`. Blindado en la dirección contraria por el guard source-hygiene de `test/skill-sync.test.js` (impide "terminar el trabajo" por inercia). · **D-08** — rename `kodo-orchestrate/skill.md` → `SKILL.md`: cambia el path de distribución (fichero huérfano en el HOME de cada operador sin `--prune`) y rompe `SKILL_PATH` (`src/hooks/stop.js:21`). Riesgo A1 **no verificado**: es plausible que `skill.md` en minúsculas no cargue en filesystem case-sensitive (Linux/CI); esta fase mitigó su mitad (gate case-tolerante en los dos sitios, D-07) | Diferidos con trigger: D-08b → primer operador que reporte que `/kodo-capture` no le aparece; D-08 → próximo toque de esa skill o barrido con `--prune` documentado. Detalle en `84/deferred-items.md` | v0.19 Phase 84 |
| Higiene de tests | **format-isolation transitivo** — el guard de color-isolation sigue imports directos, no transitivos; el walker (`walkImports`) ya existe en el fichero pero no se ha medido el radio de ficheros del dashboard que se pondrían rojos al activarlo · **D-24** tecla del dashboard para triar el inbox desde el conteo (CAPT-07 pide conteo, no navegación) · **D-13** `task_ref` en la línea de captura (exige abrir el formato congelado en Phase 83 y romper su golden) **ABIERTOS.** format-isolation → **evaluado y DIFERIDO por la Phase 85 (D-18)**, pese a estar anotado aquí como «candidato natural de la Phase 85»: no es ninguno de los 5 requisitos de esa fase y **no se ha medido** el radio de ficheros del dashboard que se pondrían rojos — una fase declarada mecánica no es el sitio para descubrirlo. Se corregirá **junto con OQ-1** (el mismo comentario de premisa falsa que `85-02` retiró de `check-isolation.test.js` sigue verbatim en `test/format-isolation.test.js:14,33`; arreglar solo el comentario dejaría el guard sin cubrir el caso que su comentario ya no niega). Trigger y razón completa en `85/deferred-items.md`. · D-24 → que el conteo demuestre presión real y el operador pida el atajo; D-13 → caso de uso que `deriveTag` no cubra | v0.19 Phase 84 |
| Operación | El grupo cmux `SCP-CMRi` del operador no matchea el identifier derivado `SCP` — tareas SCP se lanzan sin grupo (fail-open correcto); renombrar el grupo a `SCP` para agruparlas | Acción de operador (fuera de scope) | v0.17 Phase 77 |
| Riesgo aceptado | IN-07 / R-77-D10 (LOCKED D-10): el retry TOCTOU de `newWorkspaceWithGroupFallback` puede duplicar workspace ante timeout | Aceptado y documentado (78-SECURITY.md §Accepted Risks) | v0.17 Phase 77 |
| Verificación empírica | CONC-09 — sign-off humano de la ubicación real de worktrees (`.bg-shell` vs `.claude/worktrees`); `doctor --fix` scan path sin cambiar hasta confirmarlo en sesión GSD viva | Diferido por diseño (D-15, precedente 50.1) | v0.16 Phase 70 |
| UAT | Backstop GitHub real (nunca cierra issues) — skip reconocido por el operador 2026-07-09; mock de 3 capacidades como cobertura compensatoria **ABIERTA** (requiere repo GitHub real). La Phase 85 la dejó mejor **contabilizada**, no cerrada: `85-04` la registró en el Manual-Only de `71-VALIDATION.md` con `result: skipped` textual, su fecha de reconocimiento (2026-07-09) y su cobertura compensatoria, y anotó allí mismo que el backfill **no la cierra** | v0.16 Phase 71 |
| Cliente Plane | B12b — throttle epoch-vs-delta (`x-ratelimit-reset` no confirmable barato en Plane self-hosted) | Diferido con nota (D-02) | v0.16 Phase 72 |
| Evidencia en vivo | Round-trip completo `kodo sidebar doctor --fix` sobre sesión suelta real (79/SDR-05) y convergencia ≤1 pase del piggyback contra cmux vivo (80/ORCH-07) — cableado y unit verificados; falta solo el escenario real con deriva **ABIERTA.** Pendiente de que aparezca deriva real (no fabricar estado en el sidebar del operador). **La Phase 85 la contabilizó, NO la resolvió:** `85-03` la declaró Manual-Only en los `VALIDATION.md` de 79 y 80 citando evidencia más fuerte de la prevista — `79-UAT.md` test 4 con `result: pass` (round-trip completo vía el binario `kodo` con deriva real, 2026-07-23) y la convergencia de 80 como pass en su UAT —, y dejó anotado dentro de esos ficheros que esta fila **no se cierra**. Contabilizar no es resolver | v0.18 Phases 79-80 |
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
- [Phase ?]: 83-06: el escenario de concurrencia por encima de TODO presupuesto (hold 1500 ms, 6 capturas, x3) entra en la suite y se verifica su MORDIDA: con el guard compare-and-swap de 83-04 revertido a mano sobreviven 0 de 6 con exit 0 en los 7 procesos; restaurado, 6 de 6
- [Phase ?]: 83-06: guard de cobertura de la rama fail-open en los DOS escenarios mixtos — cada hijo de captura registra su rama en capture-branches.log y la suite exige >=1 failopen por iteracion; perder cobertura pasa a ser un fallo en vez de un silencio (WR-03/DEBT-04)
- [Phase ?]: 83-06: la cabecera de test/inbox-concurrency.test.js ELIMINA 'subir el presupuesto de reintentos del lock' de los arreglos admitidos ante una carrera roja; el unico admitido es corregir el invariante en produccion
- [Phase ?]: 83-06 [desviacion]: los escenarios mixtos se liberan en DOS TIEMPOS (el marcado primero, las capturas solo cuando el lockfile existe) — con un barrier unico las capturas podian ganar el lock y el escenario no media la colision; lo destapo el propio guard (coordinated=6, failopen=0). Endurece: hold, hijos y aserciones intactos
- [Phase ?]: 83-07: la clave de projects.json es el identificador del PROVEEDOR — con forma de UUID el tag pasa a ser el último segmento de la ruta MAPEADA (Decisión B); el basename del cwd queda como ÚLTIMO recurso. Verificado sobre la config real: 7246e3fe-... -> kodo
- [Phase ?]: 83-07: la proyección del tag es CONDICIONAL (Decisión A) — un identificador ya legible se devuelve tal cual; cerrar un gap no reabre lo que ya funcionaba
- [Phase ?]: 83-07 [REVIERTE 83-02]: es FALSO que el carril --json pueda ir verbatim porque JSON.stringify escapa los C0 — el serializador NO escapa DEL ni el bloque C1 y ambos salían íntegros. sanitizeJsonField los elimina en texto, tag, origen y dest
- [Phase ?]: 83-07: concurrent-write gana rama propia (exit 1 reintentable) con copy que nombra la causa real — un guard que aborta para no destruir una captura concurrente, no contención de lock (D-13)
- [Phase ?]: 83-07 [desviación]: el test de integración del fail-open sobre el binario NO muerde (el default del store escribe al mismo process.stderr que el test lee); se declara en el propio test y se añade un unit sobre la propagación del seam que sí muerde
- [Phase ?]: 84-02: la skill /kodo-capture usa el placeholder <texto> (literal LOCKED D-11), no $ARGUMENTS — el modelo sustituye y escapa, evitando el word-splitting de la sustitución cruda
- [Phase ?]: 84-02: el contrato del SKILL.md se testea extrayendo el argv del markdown y congelándolo contra ARGV_CANONICO; la byte-identidad se hereda del writer único de Phase 83
- [Phase ?]: 84-02: la fecha del carril child-process se deriva de la línea producida y solo se asserta su forma — nunca se recalcula con un segundo reloj (flake de medianoche)
- [Phase 84]: La regex del leaf de conteo es la especializacion a linea ABIERTA de LINE_RE, no un prefijo de checkbox — Medido sobre el fixture adversarial de D-18: el prefijo cuenta 7 y el oraculo listCaptures cuenta 2. Un "- [ ] comprar leche" escrito a mano basta para desalinear los dos lectores, y el inbox es human-editable por diseno.
- [Phase 84]: El backstop de overflow del dashboard se cierra con un stdout propio pasado al render de ink — ink-testing-library fija columns en un getter de 100 sin override. El plan autorizaba dejar el backstop declarado sin cerrar; medir el wrap real a 40 columnas cuesta ~30 lineas de test y no toca produccion, asi que se cerro sin inventar aritmetica de ancho.
- [Phase 84]: Los siete ficheros de test de dashboard existentes no se tocan: el default inboxOpen = 0 en SessionTable es lo que los mantiene verdes — Cambio quirurgico. Consecuencia conocida y aceptada: esos siete renderizan App sin sandboxear HOME, asi que leen el inbox real del desarrollador; sin efecto sobre sus asserts, que son de coincidencia parcial.
- [Phase 84]: El registro de skills distribuibles es una allowlist literal congelada (KODO_SKILLS), nunca un listado de .claude/skills/ — es el control de acceso al HOME del operador — Un listado de directorio convertiría cualquier fichero caído en .claude/skills/ (hoy worktree-cleanup, una skill de trabajo local) en algo que se copia al HOME de todos los operadores. Con la allowlist, añadir una entrada es un acto deliberado y revisable en diff, asertado por un test source-hygiene.
- [Phase 84]: El prefijo de error por skill lleva el nombre DESPUÉS de los dos puntos: Error: filesystem error: [skill] mensaje — La forma alternativa de 84-RESEARCH desplazaba los dos puntos y habría roto el assert anclado /^Error: filesystem error: / de test/skill-sync.test.js. Arbitraje de 84-PATTERNS a favor de 84-UI-SPEC.
- [Phase 84]: D-07 se aplica en los DOS gates de entrypoint: el del handler y el interno de syncSkill (src/skill/sync.js:67) — Sin el gate case-tolerante dentro de syncSkill, en Linux kodo-capture/SKILL.md pasaría el gate del handler y syncSkill devolvería source skill not found. El cambio es una condición más permisiva: no toca firma ni contrato de retorno, así que es compatible con D-06 leído literalmente.
- [Phase ?]: 85-01: D-04: deriveAnyNext delega en nextCell — el que decide la presencia de la columna consume al que la pinta, en vez de duplicar su regla (DEBT-06, cierra 81-REVIEW WR-02)
- [Phase ?]: 85-01: D-01/D-03: DEBT-05 se salda doc-only — cero comportamiento, cero tests nuevos; la evidencia del contrato es la cita a handoff-state.test.js:265/288/307 (cierra 81-REVIEW WR-01)
- [Phase ?]: 85-02 D-07: la línea de fallos del piggyback sale por errorFn (stderr), nunca por logFn
- [Phase ?]: 85-02 D-09: el guard LOG-12 se refuerza con un source-grep sobre la salida de walkImports, sin modificar el walker
- [Phase ?]: 85-03 (NYQ-01): backfill Nyquist de v0.18 citation-based — 79/80/81 pasan a validated + nyquist_compliant: true citando su VERIFICATION.md, sin generar tests ni re-ejecutar la suite (D-12)
- [Phase ?]: 85-03: un behavior_unverified del VERIFICATION no es hueco de sampling — va a Manual-Only con razón y evidencia parcial (precedente 41-VALIDATION.md, nyquist-compliant CON fila manual-only)
- [Phase ?]: 85-04 (NYQ-02): backfill Nyquist de v0.16 citation-based — 69/71/72 pasan a validated + flag en true citando su VERIFICATION.md; D-17 se resolvió por fase, con los 5 items no automatizables a Manual-Only
- [Phase ?]: 85-04: los comentarios de lifecycle de 79/80/81 NO se anaden a 69/71/72 — son ficheros anteriores a esa convencion y homogeneizarlos reescribiria su historia
- [Phase ?]: 85-04: requirement de ausencia (HYG-02/HYG-03) — la celda Automated Command es el guard real (CLI help / grep sobre el modulo), no un unit test inventado; inventarlo seria un true sin cita
- [Phase ?]: 85-04: evidencia adversa citada sin redondeo — el skipped:1 del UAT de 71 (GitHub real) y el flake pre-existente gsd-lock-race de la corrida de 72 (2025 pass / 1 fail / 1 skip) aparecen tal cual; la fila de STATE de GitHub real sigue ABIERTA y este plan no la cierra
- [Phase ?]: 85-05: el §Deferred Items de STATE.md es una seccion CURADA del SDK (state-transition.cjs:1284, rebuildCore la preserva verbatim) y NO hay handler que direccione sus filas de 4 columnas — state.patch/state.update resuelven por tableRowPattern, que solo casa filas de 2 celdas (probado en copia aislada); la mutacion fue por Edit y state.validate sale valid:true sin drift
- [Phase ?]: 85-05: la fila del format-isolation transitivo NO se cierra pese a que su propio texto invitaba a hacerlo (candidato natural de la Phase 85) — D-18; se reescribe a 'evaluado y DIFERIDO' con su trigger, enlazada con OQ-1 para corregirse a la vez
- [Phase ?]: 85-05: contabilizar no es resolver — las filas de Evidencia en vivo y de backstop GitHub real quedaron mejor citadas por 85-03/85-04 y siguen ABIERTAS; la distincion se escribe en la propia celda para que el siguiente audit no la confunda con un cierre

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

**Last session:** 2026-07-28

**Resume file:** None

- **Stopped at:** Phase 85 complete, milestone v0.19 al 100% — listo para archivar
- **Next action:** `/gsd-plan-phase 85` — planificar el saneo de deuda + Nyquist retroactivo (última fase de v0.19).
- **Files of record:**
  - `.planning/PROJECT.md` (updated 2026-07-26 after Phase 84; milestone v0.19 en curso)
  - `.planning/ROADMAP.md` (v0.19 activo Phases 82-85 + Phase Details; v0.18 colapsado; Backlog con 999.1 shipped + 999.2 promovida a 83-84 + 999.3 shipped)
  - `.planning/REQUIREMENTS.md` (15/15 requirements mapeados; traceability completa)
  - `.planning/research/SUMMARY.md` (research del inbox de capturas — decisión del modelo de estado flagged para discuss/plan de Phase 83)
  - `.planning/MILESTONES.md` (entrada v0.18 completa; v0.19 en curso)

## Operator Next Steps

- Planificar la Phase 85 con `/gsd-plan-phase 85` (saneo de deuda + Nyquist retroactivo) — última fase de v0.19
- **R-82-01 sigue abierta:** decidir sobre la carrera de segundo orden de `stealLock` con holder VIVO (82-REVIEW CR-01) — fix con gate vs riesgo aceptado documentado
- `git push` (+ tag v0.18) sigue pendiente de decisión del operador — v0.18 y todo v0.19 son locales

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
| Phase 83 P06 | 8min | 2 tasks | 2 files |
| Phase 83 P07 | 12min | 3 tasks | 7 files |
| Phase 84 P02 | 41min | 2 tasks | 2 files |
| Phase 84 P03 | 14 min | 2 tasks | 4 files |
| Phase 84 P01 | 9 min | 3 tasks | 5 files |
| Phase 85 P01 | 8min | 3 tasks | 3 files |
| Phase 85 P02 | 3min | 3 tasks | 3 files |
| Phase 85 P03 | 24 | 3 tasks | 3 files |
| Phase 85 P04 | 31 | 3 tasks | 3 files |
| Phase 85 P05 | 9min | 2 tasks | 2 files |

### Blockers

- Ninguno. (El blocker de 82-02 «el fix de 82-01 no cierra CR-01» quedó **resuelto 2026-07-25** por el rework de 82-01 — commit `16d60b6`, publicación atómica del steal-guard vía `linkSync`; CR-01 verde determinista 100/100 bajo carga, suite 2370 verde.)
