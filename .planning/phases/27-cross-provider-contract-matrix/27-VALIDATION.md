---
phase: 27
slug: cross-provider-contract-matrix
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
---

# Phase 27 — Validation Strategy

> Per-phase validation contract for the cross-provider contract matrix.
> Derived from `27-RESEARCH.md § "Validation Architecture"` and `27-PATTERNS.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js stdlib) + `node:assert/strict` |
| **Config file** | None — `package.json` `scripts.test` runs `node --test` |
| **Quick run command** | `node --test test/providers/contract.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | < 1s targeted, ~8s full suite (post-Phase-27 ~777-781 pass) |

---

## Sampling Rate

- **After every task commit:** `node --test test/providers/contract.test.js test/providers/github/provider.test.js test/plane-provider.test.js test/registry.test.js`
- **After every plan wave:** `npm test`
- **Phase gate:** Full suite green before `/gsd-verify-work`. Target: ≥ 777 pass (baseline 763 + 7×2=14 nuevos), 0 fail, 1 skipped (preexistente).
- **Max feedback latency:** < 1s targeted suite

---

## Per-Task Verification Map

> Phase 27 es test-only — sin cambios a producción. Task IDs `27-NN-MM` placeholder; planner asigna IDs finales.
> El test count derivado es `providers.length × N_core_asserts` (matrix loop) — recommended N=7 → 14 nuevos casos.

| Task ID | Plan | Wave | Requirement | Behavior | Test Type | Automated Command | File | Status |
|---------|------|------|-------------|----------|-----------|-------------------|------|--------|
| 27-01-NN | 01 | 1 | TEST-03 | `getProvider('plane')` y `getProvider('github')` ambos instancian con `init()` no-throw | unit (matrix loop) | `node --test test/providers/contract.test.js -g "init no-throw"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | Ambos providers exponen los 9 métodos canonical de `TASK_PROVIDER_METHODS` (`src/interface.js:11-24`) | unit (matrix loop) | `node --test test/providers/contract.test.js -g "exposes 9 methods"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | `getTask(ref)` retorna `TaskItem` con shape canónico (11 fields D-18) — verify CANONICAL_TASK_ITEM_KEYS contiene todas las keys retornadas | unit (matrix loop) | `node --test test/providers/contract.test.js -g "TaskItem shape"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | `getTask(missingRef)` lanza error (contract negativo simétrico — NO assert error.code equality entre providers) | unit (matrix loop) | `node --test test/providers/contract.test.js -g "getTask missing throws"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | `listPendingTasks()` retorna array (puede ser vacío); cada elemento si presente satisface `assertTaskItemShape` | unit (matrix loop) | `node --test test/providers/contract.test.js -g "listPendingTasks shape"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | `parseTriggerEvent({})` retorna `null` (símétrico — GitHub: webhook off → null; Plane: invalid payload → null) | unit (matrix loop) | `node --test test/providers/contract.test.js -g "parseTriggerEvent null"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | `verifySignature('', {})` retorna `false` (símétrico — GitHub: no-op false; Plane: invalid → false) | unit (matrix loop) | `node --test test/providers/contract.test.js -g "verifySignature false"` | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | Live-fetch leak guard a nivel file — `globalThis.fetch = throwLive` antes de cada test; restaura después | unit (file-level before/after) | `node --test test/providers/contract.test.js -g "live fetch"` (implícito — guard falla loud si invocado) | ❌ W0 NEW | ⬜ pending |
| 27-01-NN | 01 | 1 | TEST-03 | El test loop NO hardcodea test count (`providers.length × N` derivable; structural, no runtime assert) | grep | `grep -c "for.*of.*providers\|describe.*each\|for.*providerName" test/providers/contract.test.js` ≥ 1 | ❌ W0 NEW | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/providers/contract.test.js` — nuevo file con matrix loop iterando `['plane', 'github']`
- [ ] (opcional) `test/providers/contract-helpers.js` — extraer `CANONICAL_TASK_ITEM_KEYS`, `assertTaskItemShape`, `instantiateProvider(name)` SI el contract.test.js excede ~300 LOC
- [ ] Reusa fixtures existentes — `test/fixtures/github/issues-list.json` (Phase 24), Plane fixtures inline en `test/plane-provider.test.js` si no hay dir separado
- [ ] `test/providers/` directory ya existe (Phase 24 creó `test/providers/github/`) — solo añadir el file
- [ ] NO crear fixtures shared cross-provider — provider payloads divergen por diseño (RESEARCH Pitfall #4)

*Wave 0 = el plan único en sí — Phase 27 es test-only con 1 wave 1 plan.*

---

## Mock Strategies

### Live-fetch leak guard (file-level)
**Pattern:** Phase 24 D-37 — `before/after` que setea `globalThis.fetch = () => { throw new Error('live fetch leak') }`; restaura el original después.
**Reference:** `test/providers/github/provider.test.js:40-49`.

### Provider instantiation — DI divergence
**Pattern:** Helper `instantiateProvider(name)` oculta asimetría:
- Plane: el provider lee `globalThis.fetch` internamente (use `globalThis.fetch` stub).
- GitHub: el provider acepta `opts.client` injection (use `fakeClient`).
**Reference:** `test/plane-provider.test.js` (Plane pattern) + `test/providers/github/provider.test.js:60-110` (GitHub fakeClient pattern).

### Canonical TaskItem shape assertion
**Pattern:** Frozen array `CANONICAL_TASK_ITEM_KEYS` importado de `src/interface.js` (si exportado allí) o declarado en helper.
**Assertion:** `assertTaskItemShape(taskItem, { providerName })` — chequea que keys ⊆ canonical set; sin extra keys (D-18 leak guard from Phase 24).

### Error message grep-friendly
**Pattern:** Cada `assert.*` message prefija `[${providerName}]` — failures localizables en output `node:test`.
Example: `assert.deepEqual(taskItemKeys.sort(), CANONICAL_TASK_ITEM_KEYS, \`[${providerName}] TaskItem shape leak\`)`.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real `getProvider('plane')` end-to-end contra `tasks.kintsugi-lab.com` | TEST-03 | Live API call (excluida por Karpathy Rule simplicity + Phase 27 SC#2 "zero live API calls") | Smoke UAT — alex runs `node -e "import('./src/providers/registry.js').then(({getProvider}) => getProvider('plane').getTask('XXX'))"` manualmente si quiere validar end-to-end |
| Real `getProvider('github')` end-to-end contra GitHub Issues | TEST-03 | Live API call | Idem manual — operator dogfood |

*Otras behaviors están automatizadas via fakeClient + globalThis.fetch stubs.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify
- [ ] Sampling continuity OK (single plan, single wave)
- [ ] Wave 0 covers MISSING references (`test/providers/contract.test.js`)
- [ ] No watch-mode flags
- [ ] Feedback latency < 1s
- [ ] Zero live API calls (file-level leak guard verifies)
- [ ] Test count derivable estructuralmente (no hardcoded — Pitfall #3)
- [ ] `nyquist_compliant: true` set after sign-off

**Approval:** pending — auto-generated 2026-05-14 from `27-RESEARCH.md`.
