---
phase: 52-createtask-contrato-anti-recursi-n
verified: 2026-06-16T09:46:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
human_verification_resolved:
  - test: "POST real contra Plane CE para validar la forma del 201 de createWorkItem (checkpoint D-07)"
    resolved: "2026-06-16 — el operador ejecutó el smoke test (colección Bruno `bruno/plane-ce-smoke/`, request 05 contra `tasks.kintsugi-lab.com` / workspace `k-lab`) y confirmó OK. El 201 trae la forma esperada; `normalizeWorkItem` la consume correctamente. BIDIR-01 marcado completo."
---

# Phase 52: createTask + contrato + anti-recursión — Verification Report

**Phase Goal:** kodo gana la capacidad de **crear** tareas (primera vez en su historia) sin romper el contrato FROZEN-at-9. `createTask` aterriza como método opcional typeof-detected en ambos adapters, y la anti-recursión que protege contra re-despacho viaja con él como propiedad de corrección del núcleo.
**Verified:** 2026-06-16T09:46:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Plane adapter crea work-item vía `createTask` y normaliza 201 a `TaskItem` canónico | ? UNCERTAIN | Código existe y suite verde (18/18 contract tests con mock 201); forma real del 201 de Plane CE NO validada — checkpoint D-07 PENDING |
| 2 | GitHub adapter crea issue vía `createTask`, LOUD en 403/404, sin swallow | ✓ VERIFIED | `src/providers/github/client.js:321-328` — `createIssue` propaga Error canónico con `.code`/`.status` desde `request()` sin try/catch |
| 3 | `TASK_PROVIDER_METHODS` permanece FROZEN en 9; `createTask` ausente; negative-assert en contract test | ✓ VERIFIED | `src/interface.js:52-62` — 9 métodos, sin `createTask`; `registry.js` loop intacto; `contract.test.js:494-503` B1 negative-assert pasa para ambos providers |
| 4 | Anti-recursión: `isAdopted` corta ANTES de `if (!opts.force)`, `--force` NO bypasea | ✓ VERIFIED | `src/triggers/dispatcher.js:82-85` — corte en paso 1c (filterIdx=4828) antes de forceIdx=5044; test `BIDIR-06: filter applies even under opts.force:true` pasa (line 1261) |
| 5 | No hay literal `'kodo:adopted'` inline fuera de `labels.js` | ✓ VERIFIED | `grep -rn "'kodo:adopted'" src/ \| grep -v labels.js` → sin resultados |
| 6 | Suite verde: 1335 pass / 0 fail / 1 skip | ✓ VERIFIED | `npm test` → `# pass 1335 # fail 0 # skipped 1` (baseline +2 vs pre-phase 1333) |

**Score:** 5/6 truths verified (1 UNCERTAIN — checkpoint D-07 pendiente de validación humana)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/labels.js` | `KODO_LABEL_ADOPTED` const + `isAdopted` helper | ✓ VERIFIED | Lines 138-162: const exportado, helper tolerante a `string[]` y `{name}[]`, case-insensitive, mirror byte-identical de `isGsdChild` |
| `src/triggers/dispatcher.js` | Import `isAdopted` + corte step 1c antes de force-skip | ✓ VERIFIED | Line 6: import; lines 82-85: `if (isAdopted(task.labels)) return {action:'ignored',code:'adopted'}` antes de `if (!opts.force)` |
| `src/providers/plane/client.js` | `createWorkItem` + `createLabel` POST transport | ✓ VERIFIED | Lines 201-224: ambos métodos, trailing slash en work-items (load-bearing), sin swallow, `request()` lanza en non-ok |
| `src/providers/plane/provider.js` | `createTask` typeof-detected; importa `KODO_LABEL_ADOPTED`; lookup-or-create label; normalize full 6-field context | ✓ VERIFIED | Line 5: import; lines 280-327: método present en object literal FUERA de TASK_PROVIDER_METHODS, label lookup-or-create, normalizeWorkItem con los 6 campos |
| `src/providers/github/client.js` | `createIssue` POST transport, sin trailing slash, LOUD en 403/404 | ✓ VERIFIED | Lines 321-328: mirror de `addComment`, path `/repos/${o}/${r}/issues` sin trailing slash, propaga error canónico |
| `src/providers/github/provider.js` | `createTask` typeof-detected; importa `KODO_LABEL_ADOPTED`; marker como string plano; normalize trivial context | ✓ VERIFIED | Line 42: import; lines 196-204: `createIssue` con `labels: [KODO_LABEL_ADOPTED]`, `normalizeIssue` con context trivial |
| `test/providers/contract.test.js` | B9 capability-gated `createTask it()` + FROZEN-9 negative-assert | ✓ VERIFIED | Lines 572-581: B9 `it()` capability-gated, corre (no skip) para ambos providers; lines 494-503: negative-assert `TASK_PROVIDER_METHODS.length === 9` + `!includes('createTask')` |
| `test/labels.test.js` | Truth-table `isAdopted` + `KODO_LABEL_ADOPTED` | ✓ VERIFIED | `node --test test/labels.test.js test/labels-hygiene.test.js test/dispatcher.test.js` → 100/100 pass |
| `test/labels-hygiene.test.js` | No-inline-literal + export asserts para marker adoptado | ✓ VERIFIED | Mismo run — 100 pass; hygiene test escanea todo `src/` |
| `test/dispatcher.test.js` | `BIDIR-06` behavior block + source-hygiene + ordering | ✓ VERIFIED | Lines 1191-1344: 7 tests BIDIR-06 (truth-table, force bypass, marker-wins, ordering) — todos pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `dispatcher.js` | `labels.js` | `import { isAdopted }` | ✓ WIRED | Line 6; corte en line 82 usa `isAdopted(task.labels)` |
| `plane/provider.js` | `labels.js` | `import { KODO_LABEL_ADOPTED }` | ✓ WIRED | Line 5; usado en line 303 para lookup-or-create |
| `github/provider.js` | `labels.js` | `import { KODO_LABEL_ADOPTED }` | ✓ WIRED | Line 42; usado en line 201 como string directo |
| `plane/provider.js` | `plane/client.js` | `createWorkItem` + `createLabel` calls | ✓ WIRED | Lines 306, 311 en createTask body |
| `github/provider.js` | `github/client.js` | `createIssue` call | ✓ WIRED | Line 198 en createTask body |
| `plane/provider.js` | `normalize.js` | `normalizeWorkItem` full 6-field context | ✓ WIRED | Lines 318-326: context con `labels, projectIdentifier, baseUrl, webUrl, workspaceSlug, stateMap` |
| `github/provider.js` | `normalize.js` | `normalizeIssue` trivial context | ✓ WIRED | Line 203: `normalizeIssue(raw, { projectId })` |
| `contract.test.js` | `interface.js` | `TASK_PROVIDER_METHODS` import | ✓ WIRED | Line 39; B1 asserta `length === 9` + `!includes('createTask')` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `plane/provider.js:createTask` | `raw` (201 body) | `client.createWorkItem()` → POST `/projects/{id}/work-items/` | En tests: mockeado con fixture; en producción: Plane CE live — **NO validado contra instancia real** | ⚠ UNCERTAIN (D-07 pending) |
| `github/provider.js:createTask` | `raw` (201 body) | `client.createIssue()` → POST `/repos/{o}/{r}/issues` | Forma del 201 de GitHub Issues es pública y estable (misma que `getIssue`); `normalizeIssue` ya probado con fixtures reales | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Contract matrix B9 corre (no skip) para ambos providers | `node --test test/providers/contract.test.js 2>&1 \| grep createTask` | `ok 9 - createTask (if supported) round-trips a 201 to a canonical TaskItem` × 2 | ✓ PASS |
| FROZEN-9 intacto runtime | `node --input-type=module -e "import {TASK_PROVIDER_METHODS} from ..."` | `count: 9, has createTask: false` | ✓ PASS |
| isAdopted cut antes de forceIdx | Script ordenamiento de índices en fuente | `filterIdx=4828 < forceIdx=5044` | ✓ PASS |
| No literal inline fuera de labels.js | `grep -rn "'kodo:adopted'" src/ \| grep -v labels.js` | Sin resultados | ✓ PASS |
| Suite completa | `npm test` | `# pass 1335 # fail 0 # skipped 1` | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| BIDIR-01 | 52-02, 52-03 | Plane createTask con normalización 201 | ? UNCERTAIN | Código y tests mockeados completos; forma live del 201 no confirmada (D-07 pending) |
| BIDIR-02 | 52-03 | GitHub createTask LOUD en 403/404 | ✓ SATISFIED | `createIssue` propaga error canónico; contract test B9 pasa; BIDIR-02 marcado completo en SUMMARY |
| BIDIR-06 | 52-01 | Anti-recursión: isAdopted corte antes de --force | ✓ SATISFIED | Corte verificado en código y runtime; 7 tests BIDIR-06 pasan incluyendo force bypass |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | Ninguno detectado |

No se encontraron TBD, FIXME, XXX, placeholders ni retornos vacíos no justificados en los archivos modificados.

---

### Human Verification Required

#### 1. Checkpoint D-07 — Validación live de la forma del 201 de Plane CE (BLOQUEANTE para BIDIR-01)

**Test:** Con credenciales reales de Plane CE (`PLANE_API_KEY`, URL base, workspace slug, un `projectId` de test), ejecutar:

```
POST {baseUrl}/api/v1/workspaces/{slug}/projects/{projectId}/work-items/
Header: X-API-Key: {key}
Body: { "name": "kodo adopt smoke test" }
```

**Expected:** Respuesta 201 cuyo JSON contiene:
- `id` — UUID del nuevo work item
- `sequence_id` — número entero (el que `normalizeWorkItem` usa como parte de `ref`)
- `state` — UUID resoluble contra el `stateCache` del provider, o `state_detail.name` embebido
- `project_detail` o campo `project` resoluble

El resultado de `normalizeWorkItem(raw, context)` sobre ese 201 debe producir un `TaskItem` con todos los campos canónicos (`id`, `ref`, `title`, `url`, `state`, `updated_at`, `created_at`, etc.) sin `undefined`.

**Why human:** La única fuente de incertidumbre en toda la fase. El Plan 52-02 lo identificó como Assumption A1 (MEDIUM-confidence) porque `POST /work-items/` nunca había sido ejecutado contra la instancia real del operador. Todos los tests usan el fixture `planeWorkItem` como mock del 201. Si la forma real diverge (p.ej. `sequence_id` ausente, `state` en sub-objeto diferente), la normalización debe ajustarse antes de marcar BIDIR-01 completo.

**Señal de reanudación:** "approved" con el `sequence_id` observado, o pegar el JSON raw del 201 si la forma diverge.

---

### Gaps Summary

No hay gaps bloqueantes de código. La única incertidumbre es un checkpoint de validación live (D-07) que el propio Plan 52-02 dejó explícitamente pendiente por requerir credenciales reales. Los 5/6 must-haves verificables programáticamente pasan. La suite es verde.

---

_Verified: 2026-06-16T09:46:00Z_
_Verifier: Claude (gsd-verifier)_
