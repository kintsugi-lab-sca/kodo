---
phase: 46-overlay-del-plan-ligero-para-sesiones-quick-non-gsd
verified: 2026-06-10T12:20:00+02:00
status: passed
score: 6/6 must-haves verified
human_verification_result: passed (2/2 via 46-HUMAN-UAT.md, 2026-06-10) — overlay quick/non-GSD confirmado en terminal real (sesión ROMAN-173); copy `session has not written a plan yet` en dim, no rojo
overrides_applied: 0
human_verification:
  - test: "Abrir el dashboard real con una sesión quick/non-GSD activa, pulsar `p` y confirmar que el plan ligero aparece con snapshot congelado, scroll con ↑↓, y `Esc` restaura el cursor sobre la misma fila por task_id"
    expected: "El overlay muestra el contenido de ~/.kodo/plans/<task_id>.md con la misma UX visual que el overlay GSD — cabecera 'plan · <task_ref>', cuerpo con el contenido del artefacto, footer '↑↓ scroll · Esc close', y tras Esc el cursor vuelve a la fila seleccionada"
    why_human: "El snapshot congelado, el comportamiento del scroll reactivo y la fidelidad visual del dim vs rojo no son verificables mediante grep ni node --test; requieren terminal real con sesión viva"
  - test: "Con una sesión quick/non-GSD activa que aún no ha escrito su plan ligero (artefacto ausente), pulsar `p` y confirmar que el mensaje dim es 'session has not written a plan yet' (no rojo)"
    expected: "El copy aparece atenuado (dim), NO en rojo, y es visualmente distinto de 'not a GSD session / no phase resolved'"
    why_human: "La diferencia visual entre dim y color:'red' en una terminal real no es comprobable por test automático de frame ink"
---

# Phase 46: Overlay del Plan Ligero para Sesiones Quick/Non-GSD — Informe de Verificación

**Phase Goal:** El overlay de plan de Phase 44 lee el artefacto de plan ligero (Phase 45) y lo muestra para sesiones quick/non-GSD con la misma UX (snapshot congelado, `Esc` preserva cursor por `task_id`, never-throws) que para sesiones GSD.
**Verified:** 2026-06-10T11:30:00+02:00
**Status:** human_needed
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Con sesión quick/non-GSD seleccionada (sin phase_id) y artefacto presente, `p` muestra el plan ligero de `~/.kodo/plans/<task_id>.md` con la misma UX que el overlay GSD | ✓ VERIFIED | Test de integración Ink `PLAN-04: p sobre fila quick/non-GSD con artefacto presente` en `test/dashboard-overlay.test.js:522-551` pasa (18/18); asserta `plan · KL-1` y `first do this` en el frame con HOME aislado vía `process.env.HOME` |
| 2 | Una sesión quick/non-GSD sin artefacto muestra copy honesta 'session has not written a plan yet', dim, no roja | ✓ VERIFIED | `OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet'` en `App.js:118`; rama `no-light-plan` en `SessionTable.js:160-165` NO asigna `color` (cae a `dimColor:true` en línea 181); test end-to-end `PLAN-04: ... SIN artefacto` en `overlay.test.js:553-576` asserta la constante y verifica que NO es `OVERLAY_PLAN_NO_PHASE` |
| 3 | Una fila sin phase_id Y sin task_id sigue mostrando `OVERLAY_PLAN_NO_PHASE` (caso terminal D-06 preservado) | ✓ VERIFIED | `plan.js:117-123` — guard `usable` requiere `taskId` truthy; sin task_id la rama devuelve `{ status: 'no-phase' }`. Test `p sobre fila sin phase_id NI task_id → OVERLAY_PLAN_NO_PHASE` en `overlay.test.js:505-520` usa `planStatus({ omitTaskId: true })` (Option A) y pasa |
| 4 | Un artefacto ilegible (EACCES/no-ENOENT) muestra `OVERLAY_PLAN_ERROR` (rojo); ningún error de fichero crashea el panel (never-throws + anti-ReDoS) | ✓ VERIFIED | `readLightPlan` en `plan.js:65-78` tiene try/catch propio; `err.code !== 'ENOENT'` → `{ status: 'error' }`; test DI `task_id + EACCES → status error` en `dashboard-plan.test.js:284-297` pasa; test never-throws con `assert.doesNotThrow` en líneas 305-318 pasa; test estructural `plan.js no compila ningún new RegExp` pasa |
| 5 | Las filas GSD con phase_id siguen leyendo su PLAN.md exactamente igual; el fallback solo dispara en la rama phaseId==null (cero regresión) | ✓ VERIFIED | `plan.js:117` — `if (phaseId == null)` encierra toda la rama del fallback; la lógica GSD (líneas 126-188) queda inalterada. `node --test test/dashboard-plan.test.js` → 21 pass / 0 fail incluyendo todos los tests GSD existentes |
| 6 | Cero endpoints nuevos en `src/server.js`; el overlay sigue read-only | ✓ VERIFIED | `git diff --stat -- src/server.js HEAD~4..HEAD` vacío (sin output); `plan.js` solo importa `node:fs`, `node:path`, `node:os` — confirmado `grep -n "from './config.js'"` devuelve vacío |

**Score:** 6/6 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/dashboard/plan.js` | Helper privado `readLightPlan` + fallback en rama phaseId==null; import `homedir` de `node:os`; sin `config.js`; sin `new RegExp` | ✓ VERIFIED | `function readLightPlan` en línea 65 (no exportada); `import { homedir } from 'node:os'` en línea 45; greps de config.js y new RegExp devuelven vacío; contención D-09 en call-site (líneas 120-121) |
| `src/cli/dashboard/App.js` | Constante exportada `OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet'` | ✓ VERIFIED | Línea 118 exacta: `export const OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet';` |
| `src/cli/dashboard/SessionTable.js` | Rama de render dim para `no-light-plan`; importa `OVERLAY_PLAN_NO_LIGHT` de `./App.js`; sin `color='red'` | ✓ VERIFIED | Importada en línea 36; rama `else if (snap.status === 'no-light-plan')` en línea 160; `copy = OVERLAY_PLAN_NO_LIGHT` sin asignar `color` (verificado en líneas 160-165) |
| `test/dashboard-plan.test.js` | 6 casos DI puros del fallback (ok/no-light-plan/error/no-phase/never-throws/contención) | ✓ VERIFIED | `describe('readPlan — fallback plan ligero (D-05/D-08/D-09)')` con 6 casos; suite pasa 21/21 |
| `test/dashboard-overlay.test.js` | Fix Option A (fila sin task_id preserva no-phase puro) + 2 tests de integración Ink con HOME aislado | ✓ VERIFIED | `planStatus({ omitTaskId: true })` en línea 510; 2 tests PLAN-04 con `process.env.HOME` aislado (líneas 522-576); suite pasa 18/18 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `plan.js` (readPlan, rama phaseId == null) | `readLightPlan(row.task_id, deps)` | llamada cuando `row.task_id` es truthy y pasa el guard | ✓ WIRED | Línea 122: `if (usable) return readLightPlan(taskId, deps);` |
| `plan.js` (readLightPlan) | `~/.kodo/plans/<task_id>.md` | `join(plansDir, taskId + '.md')` + `deps.readFileFn` | ✓ WIRED | Líneas 69-71: `plansDir = deps.kodoPlansDir || join((deps.homedirFn || homedir)(), '.kodo', 'plans')` → `readFileFn(join(plansDir, taskId + '.md'))` |
| `SessionTable.js` (renderOverlay) | `OVERLAY_PLAN_NO_LIGHT` (importado de App.js) | rama `status === 'no-light-plan'` | ✓ WIRED | Import en línea 36; uso en línea 165: `copy = OVERLAY_PLAN_NO_LIGHT` sin asignar `color` |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `SessionTable.js` renderOverlay | `snap.status` / `snap.lines` | `readPlan(row, deps)` → `readLightPlan` → `readFileSync(join(plansDir, taskId+'.md'))` | Sí — lee el artefacto real de disco; test de integración con HOME aislado y archivo escrito confirma que `lines` contiene el contenido | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `readPlan` fallback: task_id + artefacto → ok | `node --test test/dashboard-plan.test.js` | 21 pass / 0 fail | ✓ PASS |
| `readPlan` fallback: ENOENT → no-light-plan | idem (incluido en suite) | 21 pass / 0 fail | ✓ PASS |
| `readPlan` fallback: EACCES → error | idem | 21 pass / 0 fail | ✓ PASS |
| never-throws: Error sin .code → `assert.doesNotThrow` | idem | 21 pass / 0 fail | ✓ PASS |
| Overlay end-to-end con HOME aislado | `node --test test/dashboard-overlay.test.js` | 18 pass / 0 fail | ✓ PASS |
| Color-isolation: plan.js sin picocolors | `node --test test/format-isolation.test.js` | 8 pass / 0 fail | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PLAN-04 | 46-01-PLAN.md | El overlay de plan lee el artefacto de plan ligero y lo muestra para sesiones quick/non-GSD con la misma UX (snapshot congelado, copy honesta, `Esc` preserva cursor por `task_id`, never-throws); cero endpoints nuevos; overlay read-only | ✓ SATISFIED | `readLightPlan` implementado; 6 truths verificadas; tests pasan 21+18/0 fail; `server.js` sin cambios |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cli/dashboard/App.js` | 5, 13 | "placeholder" en comentarios históricos de Phase 35 | ℹ️ Info | Pre-existente; describe la sustitución del placeholder original. No introducido por Phase 46 |
| `src/cli/dashboard/SessionTable.js` | 19 | "TODO" en comentario de color-isolation (D-12 Phase 34) | ℹ️ Info | Pre-existente; "TODO el color sale de props" es expresión coloquial, no un marcador de deuda. No introducido por Phase 46 |

Sin `TBD`, `FIXME`, ni `XXX` en ningún archivo modificado por esta phase.

---

### Hallazgos Advisory del Code Review (46-REVIEW.md) — No Blockers

Los 4 `WARNING` del review son hallazgos de robustez, no fallos del objetivo de la phase. Se documentan como seguimiento informativo:

- **WR-01** (`plan.js:120-121`): La contención del `task_id` usa denylist (`String.includes`) en lugar de post-join `startsWith(plansDir)`. Para los UUIDs reales de provider (sin separadores) no hay ruta de escape; el riesgo es de mantenibilidad futura. Sugerencia: añadir verificación post-join `resolve(target).startsWith(resolve(plansDir) + sep)`.
- **WR-02** (`plan.js:103-106`): Una fila quick sin `project_path` pasa `projectPath: undefined` a `resolvePhaseFn`, que llama `join(undefined, ...)` y lanza `TypeError`. El `try/catch` lo atrapa (never-throws se mantiene), pero es control-flow vía excepción. Sugerencia: guarda `if (base)` antes de llamar al resolver.
- **WR-03** (`plan.js:65-77`): El branch de plan ligero no consulta `existsFn` antes de leer (va directo a capturar ENOENT). Funcionalmente correcto; inconsistente con la rama GSD que usa `existsFn`. Sugerencia: documentar la divergencia intencional (evita TOCTOU) o usar `existsFn` por simetría.
- **WR-04** (`test/dashboard-overlay.test.js:526-576`): Los 2 tests de integración PLAN-04 mutan `process.env.HOME` en lugar de un seam DI. Funcionalmente correcto con `finally` restore; es flake-source potencial bajo `--test-concurrency`. Sugerencia: exponer `planDeps` en App.js para inyectar `kodoPlansDir` sin mutar globals.

Ninguno de estos es un gap del objetivo de la phase.

---

### Human Verification Required

#### 1. Overlay plan ligero en sesión quick/non-GSD real — artefacto presente

**Test:** Con una sesión quick activa (sin phase_id) cuyo `task_id` tenga un artefacto escrito en `~/.kodo/plans/<task_id>.md`, abrir el dashboard, seleccionar esa sesión y pulsar `p`.
**Expected:** El overlay abre mostrando `plan · <task_ref>` en la cabecera, el contenido del artefacto en el cuerpo (snapshot congelado bajo el poll vivo), `↑↓ scroll · Esc close` en el footer, y al pulsar `Esc` el cursor vuelve a la misma fila.
**Why human:** El snapshot congelado, el scroll reactivo y la fidelidad visual son comportamientos de terminal real que los tests Ink no cubren completamente.

#### 2. Copy dim (no roja) para `no-light-plan` en terminal real

**Test:** Con una sesión quick/non-GSD activa sin artefacto de plan ligero, pulsar `p`.
**Expected:** Aparece el texto `session has not written a plan yet` visualmente atenuado (dim), no en rojo, y distinto del texto `not a GSD session / no phase resolved`.
**Why human:** La distinción visual entre `dimColor:true` y `color:'red'` requiere terminal real; los tests de frame ink no validan atributos de color renderizados.

---

### Gaps Summary

Sin gaps. Todas las truths verificadas contra el código real. Los hallazgos del Code Review son advisory (no blockers del objetivo) y se documentan arriba como seguimiento.

---

_Verified: 2026-06-10T11:30:00+02:00_
_Verifier: Claude (gsd-verifier)_
