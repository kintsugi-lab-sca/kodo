---
phase: 74
slug: handoff-acumulativo-al-cierre
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
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
| TBD | TBD | 0 | LIVE-01..04 | — | N/A (harness) | infra | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-01 | — | N/A | unit (DI) | `node --test test/hooks/session-end-handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-01 | — | Handoff aterriza ANTES de `removeSession`/worktree/promptFile (orden observable) | unit (orden de llamadas) | `node --test test/hooks/session-end-handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-01 / SC#5 | T-74-07 | Orden LOCKED `backstop → setColor → notify` intacto (D-08) | unit (regresión) | `node --test test/hooks/session-end.test.js` | ✅ extender | ⬜ pending |
| TBD | TBD | 1 | LIVE-02 | — | 2º bloque acumula; el 1º íntegro byte a byte | unit (contrato puro) | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-02 | — | `buildSessionContext` ordena preservar-y-appendear; slice sin emojis/ANSI (HOOK-01 D-02b) | unit (golden bytes) | `node --test test/session-start.test.js` | ✅ extender | ⬜ pending |
| TBD | TBD | 1 | LIVE-02 | — | `buildGsdContext` quick ordena preservar-y-appendear | unit (golden bytes) | `node --test test/gsd-context.test.js` | ✅ extender | ⬜ pending |
| TBD | TBD | 1 | LIVE-02 | — | Ramas GSD full/bootstrap SIGUEN sin instrucción (D-10) | unit (regresión) | `node --test test/gsd-context.test.js` | ✅ existe `:219`,`:224` | ⬜ pending |
| TBD | TBD | 1 | LIVE-03 | — | Sin marcador de esta sesión → bloque mecánico `— automático`, sin `NEXT:` | unit | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-03 | — | Con marcador `session=<este id>` → NO se appendea nada | unit | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-03 | — | **Caso crítico D-04:** bloque de sesión ANTERIOR + esta sesión sin escribir → SÍ appendea (detector scoped, no por conteo) | unit | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-03 | T-74-02 | `input.reason` desconocido colapsa a `other` (enum cerrado, V5 ASVS) | unit | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-04 | — | `state.tasks[task_id] = {plan_path, next, updated_at}` tras el cierre | unit (HOME isolation) | `node --test test/state/handoff-state.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-04 | — | `NEXT:` truncado a 200 chars al persistir (D-02) | unit (contrato puro) | `node --test test/session/handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-04 | — | El mutator NO toca `alive` (invariante D-04 cross-milestone) | unit | `node --test test/state/handoff-state.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | LIVE-04 | T-74-04 | **Concurrencia:** N cierres simultáneos de tareas distintas → cero escrituras perdidas en `state.tasks` | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | LIVE-04 | T-74-04 | **Concurrencia D-08:** dos escritores del MISMO plan → ambos bloques presentes (cero lost update) | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 2 | LIVE-04 | — | Aditividad: `state.tasks` sobrevive a un `reconcileTick` (spread preserva top-level) | unit (regresión anti-drop) | `node --test test/session/reconcile-*.test.js` | ✅ extender | ⬜ pending |
| TBD | TBD | 1 | SC#5 | T-74-07 | Plan ilegible (EACCES) → `log.warn`, NO throw, el cierre completa | unit (fs stub que lanza) | `node --test test/hooks/session-end-handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | SC#5 | T-74-06 | Lock ocupado (`{ok:false}`) → `log.warn`, NO bloquea el cierre | unit | `node --test test/hooks/session-end-handoff.test.js` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1 | LIVE-01 (D-09) | T-74-01 | Plan ausente → se crea con cabecera mínima + bloque; `task_id` con `/`,`\`,`..` → rechazado (guard de contención en el ESCRITOR) | unit | `node --test test/hooks/session-end-handoff.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs se rellenan al crear los PLAN.md — el mapa vive por requirement/behavior, que es lo que Nyquist muestrea.*

---

## Wave 0 Requirements

- [ ] `test/session/handoff.test.js` — contrato puro (D-01..D-04). **Cero fs, cero HOME** si el módulo del contrato es hoja pura → el test más barato y el de mayor cobertura
- [ ] `test/hooks/session-end-handoff.test.js` — orquestación vía DI. Analog: `test/hooks/session-end.test.js` (`makeSession:45`, `makeLogger:16`, `makeCmuxStub:34`)
- [ ] `test/state/handoff-state.test.js` — persistencia. Analog: `test/state/save-state-atomic.test.js:69-83` (HOME + dynamic import). **Sembrar v3** (Pitfall 5 del research: `loadState()` devuelve forma v2 si el fichero no existe → un test mal sembrado crearía un v2 con `tasks` que la siguiente migración borraría)
- [ ] `test/state/handoff-concurrency.test.js` — cross-process. Analog: `test/state/state-writers-concurrency.test.js` (barrera `go` `:100-104`, `env: {...process.env, HOME: sandbox}` `:87`, `seedV3` `:47`). **Requiere extender o clonar** `test/helpers/lock-race-child.mjs` con un `--kind handoff`
- [ ] Framework install: **ninguno** — `node:test` es built-in

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El operador abre `~/.kodo/plans/<task_id>.md` tras un cierre real y ve el handoff | LIVE-01 (SC#1) | El criterio está redactado desde la experiencia del operador («cuando el operador abre el fichero tras el cierre, el handoff está ahí»). Los tests cubren la escritura y el orden; la vivencia end-to-end con una sesión Claude Code real no es automatizable en `node:test` | Lanzar una sesión kodo real sobre una tarea, cerrar con `/exit`, abrir el fichero de plan y comprobar el bloque `## Handoff <fecha>` |
| El operador distingue de un vistazo el bloque mecánico del redactado por el LLM | LIVE-03 (SC#3) | «Distinguir de un vistazo» es un juicio visual humano; el test automatizado solo puede assertar el sufijo `— automático` | Provocar un cierre sin handoff del LLM y comprobar que el heading dice `— automático` y que se lee distinto del bloque redactado |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (4 ficheros nuevos + `lock-race-child.mjs --kind handoff`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
