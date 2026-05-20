# Phase 29: GSD Provider Reporting Integration — Research

**Researched:** 2026-05-20
**Domain:** Cherry-pick integration de rama paralela `gsd-provider-reporting` (HEAD `cb28994`) sobre `main` HEAD `fc5ceb1` (post-Phase-28)
**Confidence:** HIGH (todo verificado contra git tree + lectura directa de archivos)
**Mode:** Drift reconnaissance — NO investigación generalista. La intención es mapear conflict surface real, no recopilar best practices.

## Summary

El branch divergió en `ad2cd887` (pre-v0.6, 2026-05-08). Desde entonces `main` evolucionó por las Phases 18 (worktree always-on), 20 (HOOK-01), 21 (skill-sync auto), 24-26 (GitHub adapter + wizard) y 28 (TaskItem 13 fields + daemon logfile). Los 9 SHAs de la rama tocan **5 archivos `src/`** y **4 archivos `test/`**.

Inspección byte-a-byte:
- **`src/labels.js`** — base idéntico a main. Append puro al final del archivo. **Clean cherry-pick.**
- **`src/triggers/dispatcher.js`** — main añadió imports + Phase 18 worktree_collision block. Pero el punto de inserción del guard REPORT-01 (entre `console.log('[kodo:dispatch] Task:...')` y `if (!opts.force)`) está LIMPIO en main. **Cherry-pick aplicará con un conflict trivial en el import line (añadir `isGsdChild` a un import que main ya modificó añadiendo `computeWorktreePath` en `state.js` import — son archivos distintos, sin colisión real).**
- **`src/config.js`** — Phase 26 añadió `getDefaultGithubProviderConfig` ENTRE `getPlaneApiKey` y el `export { ... }` final. El branch añade `isReportToProviderEnabled` en el mismo slot. **Conflict moderado — manual reapply: insertar ANTES de `getDefaultGithubProviderConfig`.**
- **`src/orchestrator/prompt.md`** — main fue **reescrito completamente** en Phase 999.1 (commit 18926, 2026-05-11) a un formato condensado de 39 líneas. El cherry-pick de `7c28c06` + `d030547` aplicó sobre la versión vieja de 80+ líneas que YA NO EXISTE. **Severe — manual reapply obligatorio: extraer el bloque `<!-- BEGIN reporting -->...<!-- END reporting -->` desde el HEAD del branch e insertarlo TRAS la sección `## Sesiones GSD` actual.**
- **`src/orchestrator/launch.js`** — main añadió bloque Phase 21 auto-sync entre `log?.info(...)` y `// Check if orchestrator is already running` (líneas 48-87) + import de `homedir`/`syncSkill`/skill events + `KODO_ROOT_FOR_SKILL` constant + comentario Phase 18 D-06. El branch añade 3 cosas ortogonales (import `isReportToProviderEnabled`, helper `applyReportingGate`, wrap `basePrompt`). **Conflict moderado — 3 puntos de inserción todos pacíficos: import line, helper antes de `launchOrchestrator`, asignación de `basePrompt` línea 113-114.**

Tests:
- `test/labels.test.js` (existe, 169 líneas) → append 9 tests al final. **Clean.**
- `test/dispatcher.test.js` (existe, 1038 líneas) → append 9 tests al final. **Clean.**
- `test/config.test.js` (no existe) → new file. **Clean.**
- `test/launch.test.js` (no existe — el branch lo crea en `test/launch.test.js`, NO `test/orchestrator/launch.test.js`) → new file. **Clean.**
- `test/orchestrator-gsd.test.js` (existe, 6 describes) → append 21 tests RC1..RC15 + RA1..RA6. **Clean.**
- `test/prompt.test.js` (existe, 3 describes) → append 6 tests SR1..SR6. **Clean.**
- `test/labels-hygiene.test.js` (no existe — propuesto en CONTEXT D-17, NO viene del branch) → new file generated por la phase. **Clean.**

**Primary recommendation:** Aplicar los 9 SHAs en orden cronológico exacto. 8 de 9 son cherry-pick directo con resolución trivial. El único cherry-pick que NO funcionará byte-a-byte es `d030547` (placeholder → prosa ES) porque el placeholder lo introdujo `7c28c06` sobre el prompt.md viejo. **Estrategia consolidada para `prompt.md`**: SQUASH conceptual de `7c28c06` + `d030547` en un único commit "reaplicado manualmente" que inserta el bloque final (con prosa ES, sin paso intermedio por placeholder) tras la sección `## Sesiones GSD` actual.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 [auto]:** Aplicar los 9 SHAs de código documentados en `.planning/PENDING-INTEGRATIONS.md` en orden cronológico exacto: `5a41d8f` → `cbd8f9c` → `e1f82c9` → `7c28c06` → `5feb578` → `38c7a2e` → `d030547` → `4d67312` → `81c848c`. **NO** se mergea la rama directamente.
- **D-02 [auto]:** Cherry-pick se aplica sobre `main` post-Phase-28 (baseline actual: commit `29875d5`, suite 806 pass + 1 skip + 0 fail). NO rebase de la rama. El branch `gsd-provider-reporting` se preserva intacto como audit trail.
- **D-03 [auto]:** Cherry-pick **plan-by-plan**, no en bloque único. Cada plan de Phase 29 aplica su cluster de SHAs + verifica suite verde antes del próximo plan.
- **D-04 [auto]:** **4 plans** mapeando los clusters naturales de commits de la rama (29-01: anti-recursión / 29-02: config helper / 29-03: gate infrastructure / 29-04: prose + content).
- **D-05 [auto]:** Cada plan persiste un PLAN.md y SUMMARY.md propios (numeración 29-NN). **VERIFICATION.md** es phase-level único. **VALIDATION.md** SÍ se genera (nyquist enabled en `.planning/config.json`).
- **D-06..D-08:** Anti-recursión: filtro entre log "Task" y `if (!opts.force)`; log line literal `[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)`; `isGsdChild` única fuente de verdad.
- **D-09..D-11:** `isReportToProviderEnabled` strict equality + DI opcional + DEFAULT_CONFIG sin key `workflow` (anti-mutation D-03 invariant).
- **D-12..D-14:** Markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->`; `applyReportingGate` pure idempotente; wire-up en launch.js ANTES del template render.
- **D-15..D-16:** Prosa ES provider-agnostic via `{{provider_name}}`; 6 conceptos canónicos (just-in-time creation, label canónica via constante, plan-by-plan comments, lifecycle abstracto, append-only, HARD STEP); RC1..RC15 + RA1..RA6 content asserts.
- **D-17..D-18:** Test grep en `src/` que retorna 0 matches inline para `'kodo:gsd-child'` fuera de `src/labels.js`. Nuevo archivo `test/labels-hygiene.test.js`.
- **D-19..D-21:** PLAN.md antes del cherry-pick + SUMMARY.md después; VERIFICATION.md phase-level con shape Phase 28.
- **D-22..D-23:** Target real ≥844 pass (806 + 38). Floor mínimo 818 si dedup. Verificación incremental tras cada plan.
- **D-24..D-25:** Conflict trivial → resolver inline; semántico → reaplicar manual con nota `[cherry-picked from <sha>, manual resolution]`; estructural → detener + documentar + reaplicar como commit nuevo. **No `git cherry-pick --strategy=ours`.**

### Claude's Discretion

- Orden interno de aplicación de los SHAs dentro de cada plan (atomicidad de los commits resultantes en main).
- Squash vs preservar SHAs individuales — recomendado: preservar separados para audit trail, pero squash aceptable.
- Numeración interna de tests (e.g., `test/dispatcher.test.js` confirmado en main).
- Sub-task "cleanup post-merge" (e.g., reformatear tras conflict resolution) → añadir como Plan 29-05 sin pedir confirmación.
- Verificación de no-overlap entre 38 tests heredados y tests pre-existentes en main.

### Deferred Ideas (OUT OF SCOPE)

- Webhook GitHub real-time para sub-issues (PROJECT.md out-of-scope).
- `kodo gsd doctor` para sub-issues huérfanos → v0.9+.
- Tests E2E de MCP real → out of scope.
- Detección automática de drift entre prompt.md y prosa heredada → operador verifica manualmente; SR1..SR6 es la red.
- Métrica de uso del flag `workflow.report_to_provider` → no objetivo v0.8.
- Migración v0.2 → v0.8 del config para añadir `workflow` block default → explícitamente RECHAZADO (D-09 anti-mutation).
- Validación de sub-issue formato/contenido por kodo → fail-open; kodo confía en el agente.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **REPORT-01** | Dispatcher filtra `kodo:gsd-child` anti-recursión, cortes ANTES de parseKodoLabels/lock/resolver/launch incluso bajo `--force`. | Branch SHAs `5a41d8f` (labels.js export) + `cbd8f9c` (dispatcher.js guard + tests). Drift inventory §labels y §dispatcher confirman cherry-pick limpio. |
| **REPORT-02** | `isReportToProviderEnabled()` strict equality `=== true`; DEFAULT_CONFIG sin key `workflow`. | Branch SHA `e1f82c9` (config.js helper + test/config.test.js NEW). Drift §config confirma conflict moderado por Phase 26 `getDefaultGithubProviderConfig` — manual insertion antes de ese helper. |
| **REPORT-03** | `applyReportingGate(prompt, enabled)` pure idempotente entre markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->`. | Branch SHAs `7c28c06` (markers + placeholder) + `5feb578` (helper + wire-up) + `38c7a2e` (test/launch.test.js NEW). Drift §prompt.md severo — squash recomendado con `d030547`. Drift §launch.js moderado — 3 inserciones pacíficas. |
| **REPORT-04** | Prosa ES provider-agnostic vía `{{provider_name}}` cubriendo 6 conceptos canónicos + HARD STEP + log literal `[kodo:reporting] MCP failure on phase N: <error>`. | Branch SHAs `d030547` (prosa) + `4d67312` (SR1..SR6 prompt.test.js append) + `81c848c` (RC1..RC15 + RA1..RA6 orchestrator-gsd.test.js append). Drift §prompt.md severo (manual reapply). `{{provider_name}}` ya manejado en `resolvePromptTemplate` línea 28-36 — sin cambios. |
| **REPORT-05** | `KODO_LABEL_GSD_CHILD` exportado desde `src/labels.js` + source-hygiene `test/labels-hygiene.test.js`. | Cubierto por `5a41d8f` + `cbd8f9c` (source-hygiene en `test/dispatcher.test.js` describe REPORT-01 — branch). `test/labels-hygiene.test.js` NO viene del branch — generado nuevo por la phase (CONTEXT D-17), mirroring `test/dispatcher-isolation.test.js` Phase 16 pattern (verified at `/Users/alex/dev/klab/kodo/test/dispatcher-isolation.test.js`). |
| **REPORT-06** | 9 SHAs aplicados con planning artifacts (PLAN/SUMMARY/VERIFICATION/VALIDATION) numerados Phase 29. Suite ≥818 (target ≥844). | Plan ordering en §"Plan Ordering Recommendation"; cherry-pick audit trail via `git log --grep="(cherry picked from commit"`. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Anti-recursión guard | API/Backend (`src/triggers/dispatcher.js`) | — | Dispatcher es punto único de entrada para webhook/polling/CLI. Filtrar aquí cubre los 3 canales por construcción. |
| Label constant + helper | Domain layer (`src/labels.js`) | — | Single source of truth para taxonomía de labels (Phase 8 + Phase 11 invariant). Defensive parser ya pattern-establecido. |
| Opt-in config flag | Config layer (`src/config.js`) | DI seam para tests | Strict equality + DI opcional sigue patrón Phase 14 W-4 + Phase 17 UAT-03. |
| Prompt template gating | Orchestrator render path (`src/orchestrator/launch.js`) | Markdown markers (`src/orchestrator/prompt.md`) | Pure transformation ANTES del cmux.send. Idempotente — composable con `resolvePromptTemplate`. |
| Sub-issue lifecycle prose | Instruction (`src/orchestrator/prompt.md` gated section) | — | Instruction-driven design: kodo NO crea/lee/borra issues. Toda la lógica vive en la prosa que Claude consume. Provider-agnostic via `{{provider_name}}`. |
| Source-hygiene guard | Test infra (`test/labels-hygiene.test.js` NEW) | Mirror `test/dispatcher-isolation.test.js` | Comment-aware grep walker bloquea inline `'kodo:gsd-child'` fuera de `src/labels.js`. |

## Drift Inventory Table (5 src/ touch files)

| File | Branch ADD/MODIFY | Current Main Delta (since `ad2cd88`) | Conflict Severity | Recommended Resolution |
|------|---|---|---|---|
| **`src/labels.js`** | Append 5 líneas: const `KODO_LABEL_GSD_CHILD = 'kodo:gsd-child'` + helper `isGsdChild(labels)` defensive (string[]/Array<{name}>/null tolerant, case-insensitive, exact-match). Doc-comment Phase 14 D-09. | Zero changes desde `ad2cd88`. Branch base byte-identical a main. | **Clean** | **Cherry-pick literal `5a41d8f`** — apply directo. Zero conflict. |
| **`src/triggers/dispatcher.js`** | (a) Modify import line: `import { parseKodoLabels, getGsdMode, isGsdChild } from '../labels.js';` (era `parseKodoLabels, getGsdMode`). (b) Insertar 10 líneas guard entre `console.log('[kodo:dispatch] Task: ...')` (línea base 54) y `if (!opts.force)`. Return `{action: 'ignored', code: 'gsd_child'}`. | Main añadió: `import { existsSync } from 'node:fs'`, `computeWorktreePath` en import de session/state.js, `EVENTS, gsdPhaseResolved, gsdBootstrap` import de logger-events.js, `existsSyncFn` en DispatchDeps typedef, bloque Phase 18 D-05 worktree_collision (líneas 147-215) ENTRE el lock block y el resolver block. **El punto de inserción del guard (entre log "Task" línea 61 y `if (!opts.force)` línea 64) está limpio en main.** | **Minor** | **Cherry-pick `cbd8f9c`** — el conflict será solo en la línea del import (3-way merge resolverá auto si Git lo detecta; si no, manual: añadir `isGsdChild` al import existente). Guard insertion clean. Tests append clean. |
| **`src/config.js`** | (a) Doc-comment 22 líneas + (b) export function `isReportToProviderEnabled(_loadConfig = loadConfig)` con strict equality `=== true`. Insertado ANTES de `export { KODO_DIR, ... }` final (línea base 174). | Main (Phase 26) añadió `getDefaultGithubProviderConfig` (líneas 176-200) ENTRE `getPlaneApiKey` y el export final. **Branch base punto-de-inserción coincide con el slot que ahora ocupa el helper Phase 26.** DEFAULT_CONFIG sigue sin key `workflow` → D-09 anti-mutation invariant preservado. | **Moderate** | **Cherry-pick `e1f82c9` + manual conflict resolution**: insertar `isReportToProviderEnabled` ANTES de `getDefaultGithubProviderConfig` (no después). Test file `test/config.test.js` es nuevo, sin conflict. Documentar en SUMMARY como `[cherry-picked from e1f82c9, manual resolution: insertion point shifted above getDefaultGithubProviderConfig (Phase 26)]`. |
| **`src/orchestrator/prompt.md`** | (a) `7c28c06`: insertar 6 líneas (markers + placeholder `_Section body added in plan 15-02._`) TRAS `## Sesiones GSD`. (b) `d030547`: replace placeholder con prosa ES de 65 líneas (~70 LOC). | Main fue **completamente reescrito** en Phase 999.1 (commit 18926, 2026-05-11). Versión vieja tenía 80+ líneas con secciones detalladas; versión actual tiene 39 líneas condensadas. La sección `## Sesiones GSD` actual (líneas 30-38) NO contiene el texto-anclas del branch base. **El cherry-pick literal de `7c28c06` y `d030547` fallará** porque el patch context ya no existe. | **Severe** | **Manual reapply (squash conceptual)**: NO cherry-pick `7c28c06` ni `d030547` separados. En su lugar: extract bloque del branch HEAD: `git show gsd-provider-reporting:src/orchestrator/prompt.md` líneas `<!-- BEGIN reporting -->` … `<!-- END reporting -->` (66 líneas) e insertarlo TRAS la línea 38 actual (último item de `## Sesiones GSD`) como un único bloque. SR2 invariant (heading-after-`## Sesiones GSD`) preservado. Documentar en SUMMARY como `[squash of 7c28c06+d030547, manual resolution: branch base prompt.md no longer exists in main]`. |
| **`src/orchestrator/launch.js`** | (a) Modify import line 7 (base): `import { loadConfig, isReportToProviderEnabled } from '../config.js';`. (b) Add export `applyReportingGate(prompt, enabled)` pure function (15 LOC) ANTES de `launchOrchestrator`. (c) Modify `basePrompt = ...` assignment (línea base 62): envolver con `applyReportingGate(..., isReportToProviderEnabled())`. | Main añadió: `homedir` import, `syncSkill` + `skillSyncAuto`/`skillSyncAutoError` imports, `KODO_ROOT_FOR_SKILL` const línea 19, bloque Phase 21 auto-sync (líneas 48-87), bloque comentario Phase 18 D-06 (líneas 130-148). El sitio del wire-up (`const basePrompt = resolvePromptTemplate(...)` línea 114 main) está limpio — Phase 21 inserta antes, Phase 18 D-06 después. | **Moderate** | **Cherry-pick `5feb578` + manual conflict resolution**: 3 inserciones todas resolubles 3-way: (1) import line 7 — añadir `isReportToProviderEnabled` al import existente; (2) helper `applyReportingGate` antes de `launchOrchestrator` (slot pacífico — Phase 21 + Phase 18 D-06 no tocan esta región); (3) wrap `basePrompt` en línea 114 main. Documentar en SUMMARY como `[cherry-picked from 5feb578, manual resolution: 3 hunks rebased onto post-Phase-21 launch.js]`. |

## Test File Mapping (6 archivos)

| Branch-expected Path | Current Main Path | Append vs New | Conflict Severity | Notes |
|---|---|---|---|---|
| `test/labels.test.js` | `test/labels.test.js` (169 líneas, 4 describes existentes) | **Append** | **Clean** | `5a41d8f` añade 1 describe `'REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD'` con 9 tests al final. Modifica import line 3 para añadir `isGsdChild, KODO_LABEL_GSD_CHILD` al import existente. |
| `test/dispatcher.test.js` | `test/dispatcher.test.js` (1038 líneas, 7 describes existentes incluido Phase 18 worktree_collision describe) | **Append** | **Clean** | `cbd8f9c` añade 1 describe `'REPORT-01 — kodo:gsd-child anti-recursion filter'` con 6 tests + 1 describe `'REPORT-01 — dispatcher.js source hygiene'` con 3 tests al final. Modifica línea 4 para añadir `import { readFileSync } from 'node:fs';` (trivial). |
| `test/config.test.js` | NO EXISTE | **New file** | **Clean** | `e1f82c9` crea `test/config.test.js` con 10 tests: 8 REPORT-02 behavior (5-state matrix + edge cases) + 1 anti-mutation invariant (DEFAULT_CONFIG.workflow === undefined) + 1 source-hygiene multi-archivo recursivo en `src/`. |
| `test/launch.test.js` | NO EXISTE | **New file** | **Clean** | `38c7a2e` crea `test/launch.test.js` (NOT `test/orchestrator/launch.test.js`) con 11 tests: 8 REPORT-03 applyReportingGate behavior (LG1..LG8) + 3 launch.js source-hygiene (LH1..LH3). Tests son PURE — pass `enabled` directo, no DI loadConfig, no `~/.kodo/config.json`. |
| `test/orchestrator-gsd.test.js` | `test/orchestrator-gsd.test.js` (6 describes existentes con QUICK-08 patrón source-hygiene línea 239-271 referenciado en branch commit) | **Append** | **Clean** | `81c848c` añade 1 describe REPORT-04..08 content asserts (RC1..RC15 + RA1..RA6) al final = 21 tests. Imports KODO_LABEL_GSD_CHILD desde src/labels.js (acopla cross-phase a Phase 14 D-09). Imports applyReportingGate + resolvePromptTemplate desde launch.js. |
| `test/prompt.test.js` | `test/prompt.test.js` (3 describes existentes: 'orchestrator prompt template', 'resolvePromptTemplate', placeholder asserts) | **Append** | **Clean** | `4d67312` añade 1 describe `'REPORT-03 — sub-issue reporting section gating'` con 6 tests SR1..SR6 al final. |
| `test/labels-hygiene.test.js` (CONTEXT D-17, NO viene del branch) | NO EXISTE | **New file** | **Clean** | Generated nuevo por la phase. Mirror exacto de `test/dispatcher-isolation.test.js` (70 líneas, verified `/Users/alex/dev/klab/kodo/test/dispatcher-isolation.test.js`) y `test/format-isolation.test.js` (197 líneas). Walker comment-aware: grep `'kodo:gsd-child'` recursivo en `src/`, excluye `src/labels.js`, expecta 0 matches. |

## Concrete Code Excerpts (regiones críticas en main)

### Dispatcher guard placement region (current main)

`/Users/alex/dev/klab/kodo/src/triggers/dispatcher.js` líneas 55-71 (current):

```javascript
55  const existsSyncFn = deps.existsSyncFn || existsSync;
56
57  // 1. Resolve task via provider
58  const provider = getProviderFn(event.provider);
59  console.log(`[kodo:dispatch] Resolving taskRef: ${event.taskRef}`);
60  const task = await provider.getTask(event.taskRef);
61  console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${task.labels.join(', ')}]`);
62
63  // 2. Check kodo labels (skip if force=true)
64  if (!opts.force) {
65    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
66    console.log(`[kodo:dispatch] isKodo: ${kodoConfig.isKodo}, model: ${kodoConfig.model}`);
67    if (!kodoConfig.isKodo) {
68      console.log(`[kodo:dispatch] Ignored — no kodo label`);
69      return { action: 'ignored' };
70    }
71  }
```

**Inserción REPORT-01:** entre línea 61 (log "Task:") y línea 63 (comentario `// 2. Check kodo labels`). 10 líneas a insertar:

```javascript
  // 1b. Anti-recursion guard — kodo:gsd-child labels mark sub-issues created
  // by the agent (Phase 15+) for progress reporting. Drop them BEFORE any
  // further processing, even under opts.force. Hard safety property: see
  // Phase 14 D-06 (cuts before parseKodoLabels) and D-07 (--force does NOT
  // bypass). Cuts before lock acquisition and resolver to avoid wasted work.
  if (isGsdChild(task.labels)) {
    console.log(`[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)`);
    return { action: 'ignored', code: 'gsd_child' };
  }
```

**Import line modification (línea 6 current main):**

```javascript
// Current:
import { parseKodoLabels, getGsdMode } from '../labels.js';
// Target:
import { parseKodoLabels, getGsdMode, isGsdChild } from '../labels.js';
```

### Launch.js applyReportingGate wire-up region (current main)

`/Users/alex/dev/klab/kodo/src/orchestrator/launch.js` líneas 110-115 (current):

```javascript
110  // Build context summary
111  const sessions = listSessions();
112  const contextSummary = buildContextSummary(sessions, config);
113
114  // Read orchestrator prompt and resolve provider placeholders
115  const rawPrompt = readFileSync(PROMPT_PATH, 'utf-8');
116  const basePrompt = resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' });
```

**Modificación REPORT-03 (wrap línea 116):**

```javascript
  const basePrompt = applyReportingGate(
    resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' }),
    isReportToProviderEnabled(),
  );
```

**Import line modification (línea 7 current main):**

```javascript
// Current:
import { loadConfig } from '../config.js';
// Target:
import { loadConfig, isReportToProviderEnabled } from '../config.js';
```

**Helper `applyReportingGate` insertion site:** entre línea 36 (cierre de `resolvePromptTemplate`) y línea 38 (JSDoc de `launchOrchestrator`). Zero conflict — región totalmente limpia. Helper en sí (16 LOC):

```javascript
/**
 * Strip the reporting section from the prompt when reporting is disabled.
 * Block delimiters: <!-- BEGIN reporting --> ... <!-- END reporting -->
 * Markers included in the strip. When enabled === true, returns the prompt
 * unchanged. Idempotent: applying with enabled=false twice on the same
 * prompt yields identical output.
 *
 * @param {string} prompt - Prompt content (may already be post-resolvePromptTemplate)
 * @param {boolean} enabled - true keeps the section, false strips it (markers included)
 * @returns {string}
 */
export function applyReportingGate(prompt, enabled) {
  if (enabled) return prompt;
  return prompt.replace(
    /<!-- BEGIN reporting -->[\s\S]*?<!-- END reporting -->\n?/g,
    '',
  );
}
```

## Prompt.md Section Ordering

**Current main `src/orchestrator/prompt.md` (39 líneas, 4 secciones):**

1. Intro (líneas 1-3): `"Eres el orquestador de kodo..."` + canonical extended source pointer (Phase 999.1).
2. `## Contexto mínimo` (líneas 5-9): workspace cmux + MCP namespace + state.json.
3. `## Loop de supervisión` (líneas 11-20): 8-step loop.
4. `## Reglas mínimas` (líneas 22-28): máximo 3 sesiones, Opus default, etc.
5. `## Sesiones GSD` (líneas 30-38): full / quick / verify gate. **Último heading actual.**

**Recommended position for `## Sub-issue reporting` block:** inmediatamente DESPUÉS de la sección `## Sesiones GSD` (al final del archivo). El test SR2 del branch asserta literal: `'reporting block sits AFTER "## Sesiones GSD" (D-03 slot topológico)'`. Insertion como sección final preserva ese invariant.

**Final structure post-Phase-29:**

1. Intro
2. `## Contexto mínimo`
3. `## Loop de supervisión`
4. `## Reglas mínimas`
5. `## Sesiones GSD`
6. `<!-- BEGIN reporting -->` + `## Sub-issue reporting` (prosa ES de 65 líneas) + `<!-- END reporting -->`

## `{{provider_name}}` Substitution

**Already handled.** `/Users/alex/dev/klab/kodo/src/orchestrator/launch.js` líneas 28-36:

```javascript
export function resolvePromptTemplate(template, config) {
  const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
  const mcpTool = `${providerName} MCP server`;

  return template
    .replaceAll('{{provider_name}}', providerName)
    .replaceAll('{{provider}}', config.provider)
    .replaceAll('{{mcp_tool}}', mcpTool);
}
```

El branch commit `5feb578` específicamente comenta: *"resolvePromptTemplate runs FIRST so any future `{{provider_name}}` placeholders inside the block are resolved before the gate decides whether to strip — keeps the helper purely textual and order-independent of placeholder resolution."*

**Conclusión:** El wire-up en launch.js (línea 116 current → wrap con `applyReportingGate`) preserva el orden correcto. `resolvePromptTemplate` corre INSIDE `applyReportingGate`, garantizando que los `{{provider_name}}` del bloque reporting se sustituyen ANTES del gate. Cero código adicional.

## Plan Ordering Recommendation (validación CONTEXT D-04)

CONTEXT D-04 propone 4 plans:

- **29-01** — Anti-recursion foundation: `5a41d8f` + `cbd8f9c` (15 tests)
- **29-02** — Opt-in config helper: `e1f82c9` (10 tests)
- **29-03** — Reporting gate infrastructure: `7c28c06` + `5feb578` + `38c7a2e` (6 tests)
- **29-04** — Sub-issue reporting prose: `d030547` + `4d67312` + `81c848c` (21 tests)

**Validación del orden:**

| Plan | Depende de | Justificación |
|------|-----------|---------------|
| 29-01 | (independiente) | `KODO_LABEL_GSD_CHILD` + `isGsdChild` son self-contained en labels.js. Tests dispatcher requieren helper, no requieren config ni launch. |
| 29-02 | (independiente) | `isReportToProviderEnabled` es self-contained en config.js. Tests no requieren dispatcher ni launch. |
| 29-03 | 29-02 | El wire-up `applyReportingGate(..., isReportToProviderEnabled())` en launch.js requiere que `isReportToProviderEnabled` exista. `test/launch.test.js` LH1 asserta literal `import isReportToProviderEnabled from ../config.js`. |
| 29-04 | 29-03 | Prosa entre markers requiere markers (introducidos por 29-03 vía `7c28c06`). SR1..SR6 ya valida que markers existen + heading interna; RC1..RC15 + RA1..RA6 valida contenido. |

**Validation final:** CONTEXT D-04 ordering es **correcto**. 29-03 estrictamente depende de 29-02; 29-04 estrictamente depende de 29-03. 29-01 puede correr en paralelo o secuencial pero por simplicidad (suite verde tras cada plan) se ejecuta first.

**Caveat sobre 29-03 vs 29-04 (squash recomendado para prompt.md):**

CONTEXT D-04 lista `7c28c06` (markers + placeholder) en 29-03 y `d030547` (prosa replace) en 29-04. Como detalla §"Drift Inventory" §prompt.md, el cherry-pick literal de `7c28c06` solo NO funcionará porque el patch context (la sección vieja de `## Sesiones GSD` con 30+ líneas) ya no existe. **Recomendación operacional:**

- **En 29-03**: aplicar `7c28c06` como manual reapply insertando SOLO los markers (BEGIN/END) + placeholder vacío después de `## Sesiones GSD` actual. Esto satisface el contrato SR1..SR6 (markers presentes, prose vacía = `## Sub-issue reporting` ausente cuando gate=false → SR4 cuando flag=true mantiene placeholder), wire-up `5feb578` + tests `38c7a2e` aplican directo.
- **En 29-04**: aplicar `d030547` como manual replace del placeholder por la prosa ES de 65 líneas. Tests `4d67312` + `81c848c` aplican directo.

**Alternativa:** SQUASH conceptual de `7c28c06` + `d030547` en un único patch dentro de 29-03 que inserta el bloque final completo en una sola operación. Reduce riesgo de estado intermedio con placeholder visible, pero rompe el separation-of-concerns entre 29-03 (infra) y 29-04 (content). **Decisión recomendada:** preservar D-04 (no squash) — la diferencia operacional es trivial y el audit trail vale más.

## Common Pitfalls (cherry-pick específico)

### Pitfall 1: Cherry-pick `7c28c06` falla con "patch does not apply"

**What goes wrong:** El patch espera contexto del prompt.md viejo (80+ líneas, Phase 5 era) que fue reescrito en Phase 999.1. Git intentará el patch y abortará con "could not apply" o producirá un conflict marker en un sitio sin sentido.

**Why it happens:** El "context lines" del diff (las líneas no modificadas que rodean el `+` lines) ya no existen byte-a-byte en main.

**How to avoid:** NO usar `git cherry-pick 7c28c06`. En su lugar: `git show 7c28c06 -- src/orchestrator/prompt.md` para ver el diff, luego manual insert de los markers + placeholder en main. Commit message: `feat(29-03): markers reporting block in prompt.md [manual reapply of 7c28c06, branch base prompt.md no longer exists in main]`.

**Warning signs:** mensaje `error: could not apply 7c28c06...`. Resultado de `git status` mostrando ambos files modified pero sin contenido coherente.

### Pitfall 2: Cherry-pick `5feb578` produce conflict trivial en import line

**What goes wrong:** Branch base modificó `import { loadConfig } from '../config.js'` a `import { loadConfig, isReportToProviderEnabled } from '../config.js'`. Main añadió otros imports en líneas adyacentes pero el import específico de `../config.js` está intacto. Git 3-way merge debería resolver auto.

**Why it happens:** Múltiples cambios en regiones adyacentes pueden activar el conflict marker incluso cuando el patch es semánticamente compatible.

**How to avoid:** Si Git lanza conflict, manual resolve: añadir `isReportToProviderEnabled` al import existente. Verificar con `node -c src/orchestrator/launch.js` (syntax check).

### Pitfall 3: `test/launch.test.js` LG7/LG8 fail porque tests leen prompt.md real

**What goes wrong:** Tests LG7 y LG8 (del commit `38c7a2e`) leen `src/orchestrator/prompt.md` real y assertan transformaciones. Si en el commit ORDER `38c7a2e` se aplica ANTES de `d030547` (la prosa), LG7 ("strips section completely") fallaría porque la sección apenas tiene un placeholder.

**Why it happens:** D-04 ordering pone `38c7a2e` en 29-03 y `d030547` en 29-04. Tests LG7/LG8 dentro de 29-03 corren contra el prompt.md con placeholder, no con prosa.

**How to avoid:** Verificar las aserts exactas de LG7/LG8 (`git show 38c7a2e -- test/launch.test.js`). Si LG7/LG8 assertan presencia de strings específicos de la prosa ES (e.g., "Sub-issue reporting" heading), el test fallará en 29-03. **Mitigación:** revisar los tests durante 29-03 y, si la asserción es sobre presencia/ausencia del heading (no de prosa específica), aceptar el test como-es; si asserta prosa específica, mover esos 2 tests específicos al wave de 29-04. La definición exacta lo decide el branch HEAD: leer `git show gsd-provider-reporting:test/launch.test.js`.

### Pitfall 4: 38 tests heredados contienen duplicados con tests pre-existentes en main

**What goes wrong:** Si Phase 16 D-13/D-14 (Phase 14 source-hygiene reciente) ya agregó un test de hygiene contra `'kodo:gsd-child'` (improbable, ya verificado: `grep -r 'gsd-child' src/ test/` retornó 0 matches), el cherry-pick podría producir 2 tests con el mismo nombre.

**How to avoid:** Verificación previa ya hecha en este research: `grep -rn 'gsd-child\|isGsdChild\|kodo:gsd-child' src/ test/` retorna 0 matches en main actual. Confirmed safe.

**Warning signs:** Suite reporta tests con nombre duplicado o describe block duplicado.

### Pitfall 5: Cherry-pick `cbd8f9c` requiere `readFileSync` import en test/dispatcher.test.js

**What goes wrong:** El test añadido por `cbd8f9c` usa `readFileSync` (los 3 source-hygiene tests leen `dispatcher.js`). Branch añadió `import { readFileSync } from 'node:fs';` en línea 4. Main ya tiene otros imports en esa zona (verificar línea 2 actual: `import { describe, it, beforeEach, afterEach } from 'node:test';`).

**How to avoid:** Verificar tras cherry-pick que línea 4 quedó `import { readFileSync } from 'node:fs';` no duplicado (Phase 28 puede haberlo añadido para otros tests — verificar).

## Open Questions

1. **¿Squash o no squash de `7c28c06` + `d030547`?**
   - What we know: Cherry-pick literal de `7c28c06` falla (Pitfall 1). Manual reapply funciona. `d030547` literal también falla (depende del placeholder de `7c28c06`).
   - What's unclear: Si squashear conceptualmente reduce risk o destruye audit trail.
   - Recommendation: Preservar separados (CONTEXT D-04 mantenido). Aplicar 29-03 con manual reapply de markers + placeholder vacío; 29-04 con manual replace del placeholder por la prosa. Commit message documenta `[manual reapply of <sha>]` en cada uno.

2. **¿Aplicar el cherry-pick directamente en main o usar worktree?**
   - What we know: Worktree always-on Phase 18 lo recomienda. CONTEXT no especifica. Plan-by-plan implica 4 cherry-pick clusters secuenciales.
   - What's unclear: Si conviene un worktree por plan o uno único para los 4 planes.
   - Recommendation: Worktree único `worktree-phase-29-cherry-picks/` con commits cronológicos preservados. Merge a main solo cuando 29-04 termina y suite verde.

3. **¿Tests LG7/LG8 (commit `38c7a2e`) son sensibles al orden 29-03 vs 29-04?**
   - What we know: Pitfall 3 documenta la inquietud. Sin leer el contenido exacto del test, no se puede confirmar.
   - What's unclear: Si LG7 asserta "Sub-issue reporting" heading explícitamente.
   - Recommendation: Como **acción primera del plan 29-03**, leer `git show gsd-provider-reporting:test/launch.test.js` y mapear cada test LG1..LG8 + LH1..LH3 a aserciones concretas. Si LG7/LG8 dependen de la prosa, moverlos a 29-04 (con nota en SUMMARY).

4. **¿Rollback strategy si 29-03 lands y suite rojo en 29-04?**
   - What we know: D-23 dice "detener y diagnosticar antes de avanzar". Cherry-pick produce commits separados → `git reset --hard HEAD~N` o `git revert <sha>` son opciones.
   - What's unclear: Si conviene revertir 29-03 también o solo 29-04.
   - Recommendation: Si suite rojo SOLO por aserts de prosa (RC1..RC15), revertir solo 29-04. Si rojo por aserts de markers (SR1..SR6) o gate (LG1..LG8), revertir 29-03 + 29-04. Marcar phase como blocked, abrir Plan 29-05 cleanup.

5. **¿`test/labels-hygiene.test.js` (CONTEXT D-17, NEW) puede ser parte de 29-01 o requiere plan separado?**
   - What we know: CONTEXT D-17 dice "nuevo archivo `test/labels-hygiene.test.js` mirroring patrón Phase 14 `test/format-isolation.test.js` + Phase 16 `test/dispatcher-isolation.test.js`". El test NO viene del branch.
   - What's unclear: Si la phase debe escribir este test, en qué plan, y si conta hacia los "38 tests heredados".
   - Recommendation: Incluir como Task final del plan **29-01** (junto al cherry-pick de `5a41d8f` + `cbd8f9c`). NO cuenta hacia los 38 heredados — es test net-nuevo (suma a la baseline). Target suite ajustado: 806 + 38 + 3-5 hygiene tests = ~847-849.

6. **¿Phase 28 mutó `test/dispatcher.test.js` haciendo que el append de `cbd8f9c` colisione?**
   - What we know: Phase 28 introdujo `polling.tick.summary` evento, TaskItem 13 fields. Es plausible (pero no verificado en este research) que añadiera tests al dispatcher.
   - What's unclear: Si el cherry-pick de `cbd8f9c` (que añade tests al final del archivo) entrará en conflict con tests Phase 28.
   - Recommendation: Verificar con `git log --oneline --since="2026-05-15" -- test/dispatcher.test.js`. Si Phase 28 modificó las últimas líneas, manual append en su lugar al cherry-pick.

7. **¿El comportamiento del dispatcher con `--force` y un label `kodo:gsd-child` interactúa con el bloque Phase 18 worktree_collision?**
   - What we know: El guard REPORT-01 corta ANTES del lock (línea base 64-72 dispatcher pre-Phase 18). Phase 18 worktree_collision check vive DESPUÉS del lock (líneas main 147-215). Filtrado REPORT-01 retornará antes de tocar worktree.
   - What's unclear: Si un test heredado hace asserts sobre comportamiento Phase 18 worktree que ahora se cortocircuita.
   - Recommendation: Confirmed safe — el guard REPORT-01 corta tan temprano que worktree_collision nunca se evalúa para `kodo:gsd-child` tasks. No hay regresión.

8. **¿La línea-literal del log `[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)` está blindada contra typos?**
   - What we know: CONTEXT D-07 fija el log line literal. Test SC#1 espera grepear esta línea.
   - What's unclear: Si tests dependen del em-dash (`—` U+2014) vs hyphen (`-`).
   - Recommendation: Branch HEAD uses em-dash explícito (verificado en `git show cbd8f9c`). Cherry-pick preserva bytes. Si el test usa regex `—` o em-dash literal, no hay drift.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js built-in `node:test` (suite estándar kodo desde Phase 6) |
| Config file | `package.json` script `test` |
| Quick run command | `node --test test/labels.test.js test/dispatcher.test.js test/config.test.js test/launch.test.js test/prompt.test.js test/orchestrator-gsd.test.js test/labels-hygiene.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REPORT-01 | `isGsdChild` defensive, exact-match, case-insensitive | unit | `node --test test/labels.test.js` (describe 'REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD', 9 tests) | ❌ Wave 0 (cherry-pick `5a41d8f` append) |
| REPORT-01 | Dispatcher filtra antes de parseKodoLabels/lock/resolver/launch incluso bajo `--force` | unit (DI) | `node --test test/dispatcher.test.js` (describe 'REPORT-01 — kodo:gsd-child anti-recursion filter', 6 tests + 3 source-hygiene) | ❌ Wave 0 (cherry-pick `cbd8f9c` append) |
| REPORT-02 | `isReportToProviderEnabled` strict equality matriz 5 estados + DEFAULT_CONFIG anti-mutation | unit (DI) | `node --test test/config.test.js` (10 tests) | ❌ Wave 0 (new file via `e1f82c9`) |
| REPORT-03 | `applyReportingGate` 8 LG behavior + 3 LH source-hygiene + idempotencia | unit | `node --test test/launch.test.js` (LG1..LG8 + LH1..LH3, 11 tests) | ❌ Wave 0 (new file via `38c7a2e`) |
| REPORT-03 | Markers presentes en prompt.md + heading inside markers + section after `## Sesiones GSD` | unit | `node --test test/prompt.test.js` (SR1..SR6, 6 tests append) | ❌ Wave 0 (append via `4d67312`) |
| REPORT-04 | Prosa ES content asserts (RC1..RC15) + anti-leak asserts (RA1..RA6) | unit | `node --test test/orchestrator-gsd.test.js` (RC1..RC15 + RA1..RA6, 21 tests append) | ❌ Wave 0 (append via `81c848c`) |
| REPORT-05 | Source-hygiene grep walker — 0 matches inline `'kodo:gsd-child'` en `src/` fuera de `labels.js` | unit | `node --test test/labels-hygiene.test.js` (5-10 tests TBD durante plan 29-01) | ❌ Wave 0 (new file generated por phase) |
| REPORT-06 | 9 SHAs aplicados + suite ≥818 pass + 4 PLAN/SUMMARY artifacts + VERIFICATION phase-level | manual + scripted | `git log --grep="(cherry picked from commit\|manual reapply of" --since="2026-05-20" \| wc -l` + `npm test` | N/A (verification gate) |

### Sampling Rate

- **Per task commit:** `node --test <file-modificado>` (correr SOLO los archivos modificados en el commit; <5s típico).
- **Per wave merge (cada plan 29-NN):** `npm test` completo (suite full ~30-60s).
- **Phase gate:** Full suite green + 9 SHAs trazables + 4 PLAN/SUMMARY committed + VERIFICATION.md COMPLETE antes de `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/config.test.js` — REPORT-02 (10 tests, viene de `e1f82c9`)
- [ ] `test/launch.test.js` — REPORT-03 helper + source-hygiene (11 tests, viene de `38c7a2e`)
- [ ] `test/labels-hygiene.test.js` — REPORT-05 source-hygiene (5-10 tests, generated nuevo)
- [ ] Cherry-pick infraestructura (no test framework gap — `node:test` ya en uso)

*(No framework install needed — `node:test` built-in, ya en uso post-Phase-6.)*

## Open Questions

(see numbered list above)

## Sources

### Primary (HIGH confidence)

- `/Users/alex/dev/klab/kodo/src/labels.js` (current) + `git show ad2cd88:src/labels.js` + `git show gsd-provider-reporting:src/labels.js` — drift confirmed byte-zero.
- `/Users/alex/dev/klab/kodo/src/triggers/dispatcher.js` (current) + `git show ad2cd88:src/triggers/dispatcher.js` + `git show gsd-provider-reporting:src/triggers/dispatcher.js` — guard placement region clean.
- `/Users/alex/dev/klab/kodo/src/config.js` + `git show ad2cd88:src/config.js` + `git show gsd-provider-reporting:src/config.js` — Phase 26 `getDefaultGithubProviderConfig` insertion confirmed.
- `/Users/alex/dev/klab/kodo/src/orchestrator/launch.js` + `git show ad2cd88:src/orchestrator/launch.js` + `git show gsd-provider-reporting:src/orchestrator/launch.js` — Phase 21 auto-sync + Phase 18 D-06 deltas confirmed.
- `/Users/alex/dev/klab/kodo/src/orchestrator/prompt.md` + `git show ad2cd88:src/orchestrator/prompt.md` + `git show gsd-provider-reporting:src/orchestrator/prompt.md` — Phase 999.1 rewrite confirmed (severe drift).
- `/Users/alex/dev/klab/kodo/test/labels.test.js` + branch counterpart — append-only drift confirmed.
- `/Users/alex/dev/klab/kodo/test/dispatcher.test.js` (7 describes, 1038 líneas) + `test/dispatcher-isolation.test.js` (mirror pattern para labels-hygiene).
- `/Users/alex/dev/klab/kodo/test/orchestrator-gsd.test.js` (6 describes) + `/Users/alex/dev/klab/kodo/test/prompt.test.js` (3 describes) — append-only confirmed.
- `/Users/alex/dev/klab/kodo/.planning/config.json` — `nyquist_validation: true` confirmed (VALIDATION.md required).
- `git show <sha> --stat` para los 9 SHAs (5a41d8f, cbd8f9c, e1f82c9, 7c28c06, 5feb578, 38c7a2e, d030547, 4d67312, 81c848c).
- `.planning/PENDING-INTEGRATIONS.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/phases/29-gsd-provider-reporting-integration/29-CONTEXT.md`.

### Secondary (MEDIUM confidence)

- N/A — research basado 100% en código tree, no en sources externas.

### Tertiary (LOW confidence)

- N/A.

## Metadata

**Confidence breakdown:**

- Drift inventory: **HIGH** — todos los 5 archivos inspeccionados byte-a-byte main vs ad2cd88 vs HEAD branch.
- Conflict severity per file: **HIGH** — basado en tree real, no asunción.
- Test file mapping: **HIGH** — paths verificados en main; counts de describes verificados.
- Plan ordering recommendation: **HIGH** — dependencies entre planes derivadas de imports y aserts literales.
- Squash recommendation (`7c28c06` + `d030547`): **MEDIUM** — la decisión operacional depende de preferencia entre audit trail granular vs reducción de risk.
- Test LG7/LG8 pitfall: **MEDIUM** — depende del contenido exacto del test que no fue leído byte-a-byte (recomendación: leer en plan 29-03 Wave 0).

**Research date:** 2026-05-20

**Valid until:** 2026-05-27 (7 días — el branch `gsd-provider-reporting` está congelado pero `main` puede recibir commits que invalidan el drift inventory).

## RESEARCH COMPLETE
