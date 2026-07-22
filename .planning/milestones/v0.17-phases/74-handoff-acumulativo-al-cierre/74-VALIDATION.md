---
phase: 74
slug: handoff-acumulativo-al-cierre
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
validated: 2026-07-22
---

# Phase 74 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `74-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node ≥20) — cero instalación |
| **Config file** | none — script en `package.json:10` |
| **Quick run command** | `node --test test/session-start.test.js test/gsd-context.test.js test/hooks/session-end.test.js` |
| **Full suite command** | `npm test` (→ `node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~10 s quick · ~30-60 s full (precedente `71-VALIDATION.md`) |
| **Baseline** | 2027 tests al cierre de v0.16 |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/session-start.test.js test/gsd-context.test.js test/hooks/session-end.test.js` + el fichero nuevo de la task (< 10 s)
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 74-01 | 01 | 0 | LIVE-01..04 | — | N/A (harness) | infra | `node --test test/session/handoff.test.js` | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-01 | — | N/A | unit (DI) | `node --test test/hooks/session-end-handoff.test.js` (`:545` cierre completo) | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-01 | — | Handoff aterriza ANTES de `removeSession`/worktree/promptFile (orden observable) | unit (orden de llamadas) | `node --test test/hooks/session-end-handoff.test.js` (`:560`) | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-01 / SC#5 | T-74-07 | Orden LOCKED `backstop → setColor → notify` intacto (D-08) | unit (regresión) | `node --test test/hooks/session-end-handoff.test.js` (`:581`; aterrizó aquí, no en `session-end.test.js`) | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-02 | — | 2º bloque acumula; el 1º íntegro byte a byte | unit | `node --test test/hooks/session-end-handoff.test.js` (`:195` acumulación) + `test/session/handoff.test.js` (`:241` dos bloques) | ✅ | ✅ green |
| 74-03 | 03 | 1 | LIVE-02 | — | `buildSessionContext` ordena preservar-y-appendear; slice sin emojis/ANSI (HOOK-01 D-02b) | unit (golden bytes) | `node --test test/session-start.test.js` (`:139` describe LIVE-02/D-10 ES) | ✅ | ✅ green |
| 74-03 | 03 | 1 | LIVE-02 | — | `buildGsdContext` quick ordena preservar-y-appendear | unit (golden bytes) | `node --test test/gsd-context.test.js` (`:243` describe LIVE-02/D-10 EN) | ✅ | ✅ green |
| 74-03 | 03 | 1 | LIVE-02 | — | Ramas GSD phase/bootstrap SIGUEN sin instrucción (D-10) | unit (regresión) | `node --test test/gsd-context.test.js` (`:278` phase, `:287` bootstrap) | ✅ | ✅ green |
| 74-01 | 01 | 1 | LIVE-03 | — | Sin marcador de esta sesión → bloque mecánico `— automático`, sin `NEXT:` | unit | `node --test test/session/handoff.test.js` (`:150`, `:180`) | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-03 | — | Con marcador `session=<este id>` → NO se appendea nada | unit | `node --test test/hooks/session-end-handoff.test.js` (`:144`) | ✅ | ✅ green |
| 74-01 | 01+04 | 1 | LIVE-03 | — | **Caso crítico D-04:** bloque de sesión ANTERIOR + esta sesión sin escribir → SÍ appendea (detector scoped, no por conteo) | unit | `node --test test/session/handoff.test.js` (`:231`) + `test/hooks/session-end-handoff.test.js` (`:168`) | ✅ | ✅ green |
| 74-01 | 01 | 1 | LIVE-03 | T-74-02 | `input.reason` desconocido colapsa a `other` (enum cerrado, V5 ASVS) | unit | `node --test test/session/handoff.test.js` (`:48`) + `test/hooks/session-end-handoff.test.js` (`:496`) | ✅ | ✅ green |
| 74-02 | 02 | 1 | LIVE-04 | — | `state.tasks[task_id] = {plan_path, next, updated_at}` tras el cierre | unit (HOME isolation) | `node --test test/state/handoff-state.test.js` (`:94`) | ✅ | ✅ green |
| 74-04 | 04 | 1 | LIVE-04 | — | `NEXT:` truncado a 200 chars al persistir (D-02) | unit | `node --test test/hooks/session-end-handoff.test.js` (`:332`, `:357`) | ✅ | ✅ green |
| 74-02 | 02 | 1 | LIVE-04 | — | El mutator NO toca `alive` (invariante D-04 cross-milestone) | unit | `node --test test/state/handoff-state.test.js` (`:413`) | ✅ | ✅ green |
| 74-05 | 05 | 2 | LIVE-04 | T-74-04 | **Concurrencia:** N cierres simultáneos de tareas distintas → cero escrituras perdidas en `state.tasks` | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` (`:154`) | ✅ | ✅ green |
| 74-05 | 05 | 2 | LIVE-04 | T-74-04 | **Concurrencia D-08:** dos escritores del MISMO plan → ambos bloques presentes (cero lost update) | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` (`:211`, escalado ×4 `:236`) | ✅ | ✅ green |
| 74-02 | 02 | 2 | LIVE-04 | — | Aditividad: `state.tasks` sobrevive a un `reconcileTick` (spread preserva top-level) | unit (regresión anti-drop) | `node --test test/session/reconcile-lock.test.js` (`:135-204`) | ✅ | ✅ green |
| 74-04 | 04 | 1 | SC#5 | T-74-07 | Plan ilegible (EACCES) → `log.warn`, NO throw, el cierre completa | unit (fs stub que lanza) | `node --test test/hooks/session-end-handoff.test.js` (`:414` propaga, `:599` hook completa) | ✅ | ✅ green |
| 74-04 | 04 | 1 | SC#5 | T-74-06 | Lock ocupado (`{ok:false}`) → `log.warn`, NO bloquea el cierre | unit | `node --test test/hooks/session-end-handoff.test.js` (`:440`, `:628`) | ✅ | ✅ green |
| 74-01 | 01+04 | 1 | LIVE-01 (D-09) | T-74-01 | Plan ausente → se crea con cabecera mínima + bloque; `task_id` con `/`,`\`,`..` → rechazado (guard de contención en el ESCRITOR) | unit | `node --test test/session/handoff.test.js` (`:103-115`) + `test/hooks/session-end-handoff.test.js` (`:106`, `:380`) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Cobertura adicional no prevista en el draft** (planes 06-07, gap-closure posterior):

| Task ID | Plan | Requirement | Secure Behavior | Automated Command | Status |
|---------|------|-------------|-----------------|-------------------|--------|
| 74-06 | 06 | LIVE-04 (WR-02) | Merge asimétrico de `next`: un `NEXT:` real sobrevive a un cierre mecánico posterior; uno nuevo no nulo sigue pisando | `node --test test/state/handoff-state.test.js` (`:147`, `:182`) | ✅ green |
| 74-07 | 07 | LIVE-04 (G-74-4) | `checkHookRegistration` detecta deriva instalación↔settings por-evento; sección hooks en `kodo doctor` | `node --test test/hooks/install.test.js test/cli/doctor.test.js` | ✅ green |

---

## Wave 0 Requirements

- [x] `test/session/handoff.test.js` — contrato puro (D-01..D-04). **Cero fs, cero HOME** si el módulo del contrato es hoja pura → el test más barato y el de mayor cobertura
- [x] `test/hooks/session-end-handoff.test.js` — orquestación vía DI. Analog: `test/hooks/session-end.test.js` (`makeSession:45`, `makeLogger:16`, `makeCmuxStub:34`)
- [x] `test/state/handoff-state.test.js` — persistencia. Analog: `test/state/save-state-atomic.test.js:69-83` (HOME + dynamic import). **Sembrar v3** (Pitfall 5 del research: `loadState()` devuelve forma v2 si el fichero no existe → un test mal sembrado crearía un v2 con `tasks` que la siguiente migración borraría)
- [x] `test/state/handoff-concurrency.test.js` — cross-process. Analog: `test/state/state-writers-concurrency.test.js` (barrera `go` `:100-104`, `env: {...process.env, HOME: sandbox}` `:87`, `seedV3` `:47`). Harness extendido: `test/helpers/lock-race-child.mjs` con `--kind handoff` (sexto modo)
- [x] Framework install: **ninguno** — `node:test` es built-in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El operador abre `~/.kodo/plans/<task_id>.md` tras un cierre real y ve el handoff | LIVE-01 (SC#1) | El criterio está redactado desde la experiencia del operador («cuando el operador abre el fichero tras el cierre, el handoff está ahí»). Los tests cubren la escritura y el orden; la vivencia end-to-end con una sesión Claude Code real no es automatizable en `node:test` | Lanzar una sesión kodo real sobre una tarea, cerrar con `/exit`, abrir el fichero de plan y comprobar el bloque `## Handoff <fecha>` |
| El operador distingue de un vistazo el bloque mecánico del redactado por el LLM | LIVE-03 (SC#3) | «Distinguir de un vistazo» es un juicio visual humano; el test automatizado solo puede assertar el sufijo `— automático` | Provocar un cierre sin handoff del LLM y comprobar que el heading dice `— automático` y que se lee distinto del bloque redactado |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 ficheros nuevos + `lock-race-child.mjs --kind handoff`)
- [x] No watch-mode flags
- [x] Feedback latency < 60s (suite objetivo: 191 tests en ~0.8 s; reconcile+doctor: 32 tests en ~0.1 s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validated 2026-07-22 (audit retroactivo `/gsd-validate-phase 74`)

---

## Validation Audit 2026-07-22

| Metric | Count |
|--------|-------|
| Filas auditadas (draft pre-ejecución) | 21 |
| COVERED (test existe, apunta al behavior, green) | 21 |
| Gaps found | 0 |
| Resolved (tests generados en esta auditoría) | 0 |
| Escalated → manual-only | 0 |

Notas del audit:

- El draft se escribió pre-ejecución (task IDs `TBD`, todo `⬜ pending`) y nunca se actualizó tras los 8 planes. Esta auditoría reconcilió el mapa contra los tests reales: 223 tests verdes en la órbita de la fase (`handoff`, `session-end-handoff`, `handoff-state`, `handoff-concurrency`, `session-end`, `session-start`, `gsd-context`, `reconcile-lock`, `install`, `doctor`), 0 fallos.
- Dos filas aterrizaron en ficheros distintos a los previstos: el orden LOCKED `backstop → setColor → notify` y la acumulación LIVE-02 viven en `test/hooks/session-end-handoff.test.js`, no en `session-end.test.js` / `handoff.test.js`. Cubiertas igualmente; rutas corregidas en el mapa.
- Cobertura extra no prevista en el draft: merge asimétrico de `next` (Plan 06, WR-02) y detector de deriva de hooks (Plan 07, G-74-4). Añadida como tabla suplementaria.
- La primera verificación manual-only (operador abre el plan tras un cierre real, LIVE-01/SC#1) quedó ejecutada de facto el 2026-07-21 vía Plan 08 D3: cierre real end-to-end con `state.tasks` poblado y telemetría `state.task.handoff_saved` de sesión real.
