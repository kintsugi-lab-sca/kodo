# Phase 29 — Pattern Map

> Per-file analog mapping + concrete code excerpts. Planner reads this to write `<read_first>` and `<action>` blocks with concrete identifiers for each plan 29-01..29-04.

**Created:** 2026-05-20
**Source:** 29-CONTEXT.md (25 decisions D-01..D-25) + 29-RESEARCH.md (drift inventory + concrete excerpts)
**Touch surface:** 5 `src/` files + 5 `test/` files (3 NEW)
**Cherry-pick source:** branch `gsd-provider-reporting` HEAD `cb28994` — 9 SHAs (5a41d8f, cbd8f9c, e1f82c9, 7c28c06, 5feb578, 38c7a2e, d030547, 4d67312, 81c848c)

---

## Touch File 1: `src/labels.js` (REPORT-01, REPORT-05)

**Plan:** 29-01
**Role:** pure-helper (defensive label parser + boolean predicate)
**Data flow:** in: `Array<any>` (string[] | Array<{name}> | null | undefined) → out: `boolean`. No side effects.
**Cherry-pick source:** `5a41d8f` feat(14-01): export KODO_LABEL_GSD_CHILD + isGsdChild
**Conflict severity:** **Zero** — RESEARCH §"Drift Inventory" confirma `src/labels.js` byte-idéntico entre `ad2cd88` y main HEAD `fc5ceb1`. Cherry-pick literal aplica.

### Closest Analog
`src/labels.js` (mismo archivo) — la pareja `parseKodoLabels` (lines 12-38) + `getGsdMode` (lines 53-58) ya establece:
- Export shape ESM con JSDoc + `@param` / `@returns`
- Defensive normalization tolerante a `string[]`, `Array<{name}>`, `null`/`undefined`
- Case-insensitive (`.toLowerCase()`)
- Standalone consts colocadas en la cabecera de su sección lógica

### Existing Pattern Excerpt (`src/labels.js:12-38`):

```javascript
/**
 * Parse kodo labels from a work item's label data.
 * Labels can arrive as:
 * - Array of objects with .name: [{name: "kodo"}, {name: "kodo:opus"}]
 * - Array of strings (IDs): ["uuid1", "uuid2"] — needs resolution
 *
 * @param {Array<any>} labels
 * @returns {{ isKodo: boolean, model: string|null, flags: string[] }}
 */
export function parseKodoLabels(labels) {
  const result = { isKodo: false, model: null, flags: [] };
  if (!Array.isArray(labels) || labels.length === 0) return result;

  // Extract label names — handle both object and string formats
  const names = labels
    .map((l) => (typeof l === 'object' && l !== null ? l.name : null))
    .filter(Boolean)
    .map((n) => n.toLowerCase());
  // ...
}
```

### What to Add (extracted from branch SHA `5a41d8f`):

```javascript
/**
 * Sub-issue marker label. Tasks tagged with this label are sub-issues created
 * by the agent (Phase 15+) for GSD progress reporting. The dispatcher (Phase 14
 * D-06) drops them BEFORE any further processing — even under --force — to
 * prevent a webhook-triggered recursion loop where the agent's own report
 * spawns another Claude session.
 * Phase 14 D-09: standalone constant (not nested in a KODO_LABELS object) —
 * the rest of label literals are intentionally NOT touched in Phase 14.
 */
export const KODO_LABEL_GSD_CHILD = 'kodo:gsd-child';

/**
 * Returns true iff the labels array contains the `kodo:gsd-child` marker.
 * Defensive parity with `parseKodoLabels`: tolerates both `string[]` and
 * `Array<{name: string}>` inputs. Case-insensitive.
 * Phase 14 D-08: única fuente de verdad para el check `gsd-child`.
 * @param {Array<any>} labels
 * @returns {boolean}
 */
export function isGsdChild(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const name =
      typeof l === 'object' && l !== null ? l.name :
      typeof l === 'string' ? l :
      null;
    return typeof name === 'string' && name.toLowerCase() === KODO_LABEL_GSD_CHILD;
  });
}
```

### Invariants the implementation MUST preserve:
- **No mutación** de `parseKodoLabels` / `getGsdMode` / `getSessionMode` (Phase 8/11/13 cross-milestone invariants).
- **Defensive shape:** `string[]`, `Array<{name}>`, `null`, `undefined`, primitives sueltas (number, boolean) → `false` salvo match exacto.
- **Case-insensitive** (`KODO`, `Kodo:Gsd-Child` → match).
- **Exact match** post-lowercase contra `KODO_LABEL_GSD_CHILD` const — `'kodo:gsd-children'`, `'kodo:gsd-quick-child'`, `'gsd-child'` (sin prefix) → `false`.
- **Child wins ordering** (label coexistente con `kodo:gsd` → child gana, anti-recursión wins por construcción del filtro en dispatcher).
- **Export ESM parity:** standalone `export const` + `export function`, no namespace wrapping.

---

## Touch File 2: `src/triggers/dispatcher.js` (REPORT-01)

**Plan:** 29-01
**Role:** dispatcher-guard (early-return filter)
**Data flow:** in: `TriggerEvent` + `opts` + `deps` → out: `{action: 'ignored', code: 'gsd_child'}` discriminated union. Side: `console.log` stdout.
**Cherry-pick source:** `cbd8f9c` feat(14-01): anti-recursion filter
**Conflict severity:** **Minor** — el bloque worktree_collision Phase 18 (lines 147-215) está después del punto de inserción del guard (entre log "Task:" línea 61 y `if (!opts.force)` línea 64). Import line añade `isGsdChild` al import existente.

### Closest Analog
`src/triggers/dispatcher.js` (mismo archivo) — el patrón Phase 18 `worktree_collision` (lines 187-214) es el referente directo: guard + early-return + discriminated union extendiendo `@returns`, con `console.log` canonical de stdout siguiendo el prefix `[kodo:dispatch] <action> — <ref> <razon> ...`.

### Existing Pattern Excerpt (current main, `src/triggers/dispatcher.js:57-71`):

```javascript
  // 1. Resolve task via provider
  const provider = getProviderFn(event.provider);
  console.log(`[kodo:dispatch] Resolving taskRef: ${event.taskRef}`);
  const task = await provider.getTask(event.taskRef);
  console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${task.labels.join(', ')}]`);

  // 2. Check kodo labels (skip if force=true)
  if (!opts.force) {
    const kodoConfig = parseKodoLabels(task.labels.map((name) => ({ name })));
    console.log(`[kodo:dispatch] isKodo: ${kodoConfig.isKodo}, model: ${kodoConfig.model}`);
    if (!kodoConfig.isKodo) {
      console.log(`[kodo:dispatch] Ignored — no kodo label`);
      return { action: 'ignored' };
    }
  }
```

Mirror pattern para guard + early return (Phase 18 worktree_collision, lines 203-214):

```javascript
    if (pathExists) {
      // Release lock if GSD acquired one ...
      console.log(`[kodo:dispatch] worktree_collision — ${task.ref} blocked by existing worktree at ${worktreePath}`);
      return { action: 'worktree_collision', code: 'worktree_exists', detail: worktreePath };
    }
```

### What to Add (extracted from RESEARCH §"Concrete Code Excerpts" + branch SHA `cbd8f9c`):

**Import line (`src/triggers/dispatcher.js:6` current main):**
```javascript
// Current:
import { parseKodoLabels, getGsdMode } from '../labels.js';
// Target:
import { parseKodoLabels, getGsdMode, isGsdChild } from '../labels.js';
```

**Guard insertion (entre línea 61 log "Task" y línea 63 comentario `// 2. Check kodo labels`):**

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

**JSDoc `@returns` update (line 41):** extend discriminated union to include `'ignored' | ... | 'gsd_child'` — `code: 'gsd_child'` se reutiliza con `action: 'ignored'` (CONTEXT D-06: NO añadir action nuevo, solo code nuevo).

### Invariants the implementation MUST preserve:
- **Guard fuera del `if (!opts.force)` branch** — funciona bajo `--force=true` (CONTEXT D-06 hard safety, RESEARCH §"Specifics" SC#1).
- **Cuts BEFORE** `parseKodoLabels` / `acquireGsdLockFn` / `resolvePhaseFn` / `launchWorkItemFn` / `removeSessionFn` (5 callsites downstream — test `REPORT-01: filter cuts BEFORE ...` lo asserta con spies).
- **Log line literal** `[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)` con **em-dash U+2014** (CONTEXT D-07, RESEARCH §"Pitfall 8" — preservar bytes literales).
- **Return shape literal** `{action: 'ignored', code: 'gsd_child'}` — discriminated union extiende `action: 'ignored'` con field `code` (NO action nuevo).
- **Phase 18 worktree_collision preservado**: el guard REPORT-01 corta tan temprano que worktree_collision nunca se evalúa para `kodo:gsd-child` tasks (RESEARCH §"Open Q 7" confirmed safe).
- **Phase 8 GSD-10 lock per-repo invariant preservado** — guard corta ANTES de lock acquire.
- **Source-hygiene blindado por test:** no `task.labels.some(l => ... 'kodo:gsd-child' ...)` inline en dispatcher.js post-stripComments.

---

## Touch File 3: `src/config.js` (REPORT-02)

**Plan:** 29-02
**Role:** helper-with-DI (opt-in config flag reader, fail-closed strict equality)
**Data flow:** in: optional `_loadConfig` fn (DI seam) → out: `boolean`. Side: lectura `~/.kodo/config.json` via `loadConfig` real en producción.
**Cherry-pick source:** `e1f82c9` feat(14-02): isReportToProviderEnabled + tests
**Conflict severity:** **Moderate** — Phase 26 añadió `getDefaultGithubProviderConfig` (lines 176-200) en el slot que el branch espera. Manual reapply: insertar `isReportToProviderEnabled` ANTES de `getDefaultGithubProviderConfig` (RESEARCH §"Drift Inventory" §config + Pitfall guidance).

### Closest Analog
`src/config.js:160-174` — `getProviderApiKey` + `getPlaneApiKey` muestran el patrón `export function X(...) { const config = loadConfig(); /* lectura defensiva con optional chaining */ }`.

`src/config.js:192-200` — `getDefaultGithubProviderConfig` (Phase 26) muestra el patrón export aditivo + JSDoc + slot antes del `export { ... }` final.

### Existing Pattern Excerpt (`src/config.js:160-174`):

```javascript
/**
 * Returns the API key for a given provider by reading the env var name from config.
 *
 * @param {string} [providerName] - Provider name. Defaults to config.provider.
 * @returns {string|undefined}
 */
export function getProviderApiKey(providerName) {
  const config = loadConfig();
  const name = providerName || config.provider;
  const envVarName = config.providers?.[name]?.api_key_env;
  if (!envVarName) return undefined;
  return process.env[envVarName];
}
```

DI-pattern referente (Phase 14 W-4 stop.js, Phase 17 UAT-03 spawnSync — patrón `_param = realParam`):

```javascript
export function someHelper(_loadConfigInjected = loadConfig) {
  const config = _loadConfigInjected();
  // ...
}
```

### What to Add (extracted from branch SHA `e1f82c9`):

**Insertion point:** entre `getPlaneApiKey` (`src/config.js:172-174`) y `getDefaultGithubProviderConfig` (line 192 — el patch original esperaba el slot que Phase 26 ocupó; insertar ANTES preserva la cronología D-09 anti-mutation).

```javascript
/**
 * Returns true iff the operator has explicitly opted into provider reporting
 * by setting `workflow.report_to_provider: true` in ~/.kodo/config.json.
 *
 * Fail-closed: strict equality `=== true` + optional chaining. Any of the
 * following returns false:
 *   - missing `workflow` section (default — DEFAULT_CONFIG has no key)
 *   - missing `report_to_provider` key inside `workflow`
 *   - `report_to_provider: false` (explicit)
 *   - `report_to_provider: "true"` (string — fail-closed against typos)
 *   - `report_to_provider: 1` (number — fail-closed against typos)
 *   - JSON corruption (loadConfig fallback to { ...DEFAULT_CONFIG })
 *
 * Phase 14 D-03 anti-mutation invariant: DEFAULT_CONFIG does NOT contain a
 * `workflow` key. Operators opt in manually by editing config.json.
 *
 * @param {() => typeof DEFAULT_CONFIG} [_loadConfig] - DI seam for tests
 * @returns {boolean}
 */
export function isReportToProviderEnabled(_loadConfig = loadConfig) {
  const config = _loadConfig();
  return config?.workflow?.report_to_provider === true;
}
```

### Invariants the implementation MUST preserve:
- **Strict equality `=== true`** — boolean true only; `"true"`, `1`, truthy strings/numbers → `false`.
- **DEFAULT_CONFIG NO contiene key `workflow`** (D-09 anti-mutation invariant CFG-02 zero-breaking-change). El test `REPORT-02: DEFAULT_CONFIG must NOT contain workflow key` lo asserta.
- **DI opcional `_loadConfig = loadConfig`** — patrón Phase 14 W-4 / Phase 17 UAT-03; tests no tocan filesystem (RESEARCH §Pitfall 3).
- **Optional chaining defensivo** (`config?.workflow?.report_to_provider`) — soporta JSON corruption fallback de `loadConfig` (líneas 126-128 src/config.js).
- **Inserción ANTES de `getDefaultGithubProviderConfig`** — preserva cronología Phase 14 → Phase 26 (RESEARCH §"Drift Inventory" §config recomendación).
- **Export aditivo en barrel final** — añadir al `export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG }` línea 202 si aplica (verificar — branch SHA exporta directamente desde la función `export function`).
- **Documentar en SUMMARY:** `[cherry-picked from e1f82c9, manual resolution: insertion point shifted above getDefaultGithubProviderConfig (Phase 26)]`.

---

## Touch File 4: `src/orchestrator/prompt.md` (REPORT-03, REPORT-04)

**Plan:** 29-03 (markers + heading) + 29-04 (prosa ES de 65 líneas)
**Role:** prompt-template (markdown gated section con marcadores idempotentes)
**Data flow:** in: file estático leído por `readFileSync` en launch.js → out: string template. Consumido por `resolvePromptTemplate` + `applyReportingGate`.
**Cherry-pick source:** `7c28c06` (markers + placeholder, **manual reapply obligatorio**) + `d030547` (prosa ES, **manual reapply**)
**Conflict severity:** **Severe** — Phase 999.1 (commit 18926, 2026-05-11) reescribió `prompt.md` completo. Versión vieja del branch (80+ líneas) ya no existe. **NO usar `git cherry-pick 7c28c06`** — fallará con "patch does not apply" (RESEARCH §Pitfall 1).

### Closest Analog
`src/orchestrator/prompt.md` (mismo archivo) — la sección `## Sesiones GSD` (lines 30-38) es el referente estructural:
- Heading h2 + prosa ES
- Uso consistente de `{{provider_name}}` / `{{mcp_tool}}` placeholders
- Backticks para identificadores (`kodo gsd verify`, `kodo:gsd-quick`)
- No frases inglesas prohibidas (PM7 invariant — `you must`, `please`, `execute your`).

### Existing Pattern Excerpt (`src/orchestrator/prompt.md:30-38` — patrón de sección condicional/temática):

```markdown
## Sesiones GSD

Las sesiones con `gsd: true` siguen un flujo estructurado de fase. Cuando entran a Review:

- Ejecuta `kodo gsd verify <session-id>`. El CLI lee `VERIFICATION.md`, postea el comentario en {{provider_name}} y transiciona el work item. Verdicts canónicos en stdout/JSON: `pass`, `fail`, `missing` (VERIFICATION.md ausente), `malformed` (frontmatter inválido). Exit codes del CLI: `0` gate corrió (verdict en stdout), `1` error interno, `2` fetch transient retryable.
- Artefactos GSD canónicos en `.planning/`: `PROJECT.md`, `ROADMAP.md`, `PLAN.md` (por fase) y `VERIFICATION.md` (gate de la fase). El CLI sólo consume `VERIFICATION.md`; el resto es contexto para humanos y para `kodo gsd inspect`.
- Las sesiones con tag `[GSD quick]` (lanzadas por `kodo:gsd-quick`) son one-shot y **NO** soportan `kodo gsd verify` — revísalas manualmente como cualquier sesión no-GSD.
- Para dudas previas al verify: `kodo gsd inspect <task-id>` (dry-run forense del resolver).
- **No dupliques el gate** en comentarios manuales al provider — el CLI es la única fuente para `gsd verify`.
```

### What to Add (extracted from branch HEAD via `git show gsd-provider-reporting:src/orchestrator/prompt.md`):

**Insertion point:** TRAS la línea 38 actual (último item de `## Sesiones GSD`), append al **final del archivo** (preserva SR2 invariant: "reporting block sits AFTER `## Sesiones GSD`").

**Plan 29-03 inserta (markers + heading + placeholder vacío — SHA `7c28c06` manual reapply):**

```markdown
<!-- BEGIN reporting -->
## Sub-issue reporting

_Section body added in plan 29-04._
<!-- END reporting -->
```

**Plan 29-04 reemplaza placeholder con prosa ES de 65 líneas (SHA `d030547` manual reapply). Estructura literal del bloque (extracto canónico — el bloque completo viene del branch HEAD line-by-line):**

```markdown
<!-- BEGIN reporting -->
## Sub-issue reporting

Cuando supervises sesiones GSD (`gsd: true` en `state.json`), refleja el progreso de cada fase como un sub-issue informativo en {{provider_name}} vía tu MCP. Esto es **best-effort** — nunca bloquea el avance de fases ni transiciones de la task padre.

La granularidad es fija: **una fase = un sub-issue**, **un plan = un comentario**.

### Crear el sub-issue al arrancar cada fase
[...]
- `labels`: incluye `kodo:gsd-child` obligatoriamente — el dispatcher filtra por esta label para evitar recursión.

En sesiones GSD `quick` (`[GSD quick]`) NO crees sub-issue: quick es one-shot.

### Narrar plan-by-plan como comentarios
[Formato literal "## Plan N-MM: <título del PLAN.md>" + "Plan = comentario. Phase = sub-issue."]

### Transicionar el status del sub-issue
[lifecycle abstracto: `in progress` / `done` / `verified` con pragmatic Plane parens (en {{provider_name}}: `In Progress` / `In Review` / `Done`)]

### Política append-only ante re-planificación
[transitions a `cancelled` proveedor; **NUNCA llames a `delete-issue`**]

### Validar antes de cada transición
**HARD STEP.** ANTES de cualquier transición de fase ...

### Manejo de fallos
- **MCP falla**: emite `[kodo:reporting] MCP failure on phase N: <error>`
- **Provider sin capability**: emite `[kodo:reporting] Provider MCP lacks sub-issue capability — reporting disabled`
<!-- END reporting -->
```

### Invariants the implementation MUST preserve:
- **Markers únicos**: `<!-- BEGIN reporting -->` y `<!-- END reporting -->` aparecen exactamente 1 vez cada uno (SR1).
- **Topología**: bloque DESPUÉS de `## Sesiones GSD` (SR2 invariant — `indexOf('<!-- BEGIN reporting -->') > indexOf('## Sesiones GSD')`).
- **Heading dentro de markers**: `## Sub-issue reporting` vive ENTRE BEGIN y END (SR3).
- **Provider-agnostic via `{{provider_name}}`**: prosa NO menciona "Plane" / "GitHub" / "ClickUp" inline fuera del paréntesis pragmático `(en {{provider_name}}: ...)` que tras `resolvePromptTemplate` muestra "Plane" o "Github".
- **`kodo:gsd-child` literal en el bloque**: exactamente 2 menciones (Crear + Dedup) — RC1 cross-phase coupling test importa `KODO_LABEL_GSD_CHILD` desde `src/labels.js`.
- **HARD STEP capitalized** + **NUNCA capitalized** cerca de `delete-issue` (≤200 chars distance — RC7).
- **Log literals byte-exact**:
  - `[kodo:reporting] MCP failure on phase N: <error>` (em-dash NO, colon SÍ — RC10).
  - `[kodo:reporting] Provider MCP lacks sub-issue capability — reporting disabled` (em-dash SÍ — RC11).
- **Body fields literales**: `Goal:`, `PLAN dir:`, `Plans:` (RC13 D-12).
- **Lifecycle vocabulary**: `in progress`, `done`, `verified` (RC5 D-06), `cancelled` (RC8 D-07).
- **Quick clarificado**: en quick sessions NO crear sub-issue (RC12 D-08).
- **Plan = comentario. Phase = sub-issue.** literal (RC4 D-11).
- **PM7 invariant**: sin frases inglesas (`you must`, `please`, `execute your`) DENTRO del bloque (SR6 / RC15).
- **Documentar en SUMMARY:** `[manual reapply of 7c28c06, branch base prompt.md no longer exists in main — Phase 999.1 rewrite]` y `[manual reapply of d030547, prose inserted in 29-04 over the placeholder from 29-03]`.

---

## Touch File 5: `src/orchestrator/launch.js` (REPORT-03)

**Plan:** 29-03
**Role:** helper-with-DI (pure textual transformation) + wire-up en render path
**Data flow:** `applyReportingGate` in: `(prompt: string, enabled: boolean)` → out: `string`. Pure: no side effects. Wire-up en `launchOrchestrator` ANTES del template render final.
**Cherry-pick source:** `5feb578` feat(15-01): applyReportingGate + wire-up
**Conflict severity:** **Moderate** — 3 inserciones pacíficas (RESEARCH §"Drift Inventory" §launch.js). Phase 21 auto-sync (lines 48-87) y Phase 18 D-06 comment block (lines 130-148) NO tocan las regiones de inserción.

### Closest Analog
`src/orchestrator/launch.js` (mismo archivo):
- `resolvePromptTemplate` (lines 28-36) — patrón pure transformation textual + replaceAll + provider-agnostic placeholders.
- Import line existente (line 7): `import { loadConfig } from '../config.js';` — extender con `isReportToProviderEnabled`.
- Wire-up region (lines 113-114): `const rawPrompt = readFileSync(PROMPT_PATH, 'utf-8'); const basePrompt = resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' });` — wrap con `applyReportingGate`.

### Existing Pattern Excerpt (`src/orchestrator/launch.js:28-36`):

```javascript
/**
 * Resolve {{placeholder}} tokens in the orchestrator prompt template.
 *
 * @param {string} template  Raw prompt.md content
 * @param {{ provider: string }} config  Active provider config
 * @returns {string} Prompt with all placeholders replaced
 */
export function resolvePromptTemplate(template, config) {
  const providerName = config.provider.charAt(0).toUpperCase() + config.provider.slice(1);
  const mcpTool = `${providerName} MCP server`;

  return template
    .replaceAll('{{provider_name}}', providerName)
    .replaceAll('{{provider}}', config.provider)
    .replaceAll('{{mcp_tool}}', mcpTool);
}
```

Wire-up region (`src/orchestrator/launch.js:108-114`):

```javascript
  // Build context summary
  const sessions = listSessions();
  const contextSummary = buildContextSummary(sessions, config);

  // Read orchestrator prompt and resolve provider placeholders
  const rawPrompt = readFileSync(PROMPT_PATH, 'utf-8');
  const basePrompt = resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' });
```

### What to Add (extracted from branch SHA `5feb578`):

**1) Import line (line 7 current main):**

```javascript
// Current:
import { loadConfig } from '../config.js';
// Target:
import { loadConfig, isReportToProviderEnabled } from '../config.js';
```

**2) Helper definition (insertion site: entre `resolvePromptTemplate` cierre línea 36 y JSDoc de `launchOrchestrator` línea 38 — slot pacífico):**

```javascript
/**
 * Strip the reporting section from the prompt when reporting is disabled.
 * Block delimiters: <!-- BEGIN reporting --> ... <!-- END reporting -->
 * Markers included in the strip. When enabled === true, returns the prompt
 * unchanged. Idempotent: applying with enabled=false twice on the same
 * prompt yields identical output.
 *
 * Composition note: resolvePromptTemplate runs FIRST so any future
 * {{provider_name}} placeholders inside the block are resolved before the gate
 * decides whether to strip — keeps the helper purely textual and
 * order-independent of placeholder resolution.
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

**3) Wire-up (`src/orchestrator/launch.js:114` current main — wrap `basePrompt` assignment):**

```javascript
// Current:
const basePrompt = resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' });

// Target:
const basePrompt = applyReportingGate(
  resolvePromptTemplate(rawPrompt, { provider: config.provider || 'plane' }),
  isReportToProviderEnabled(),
);
```

### Invariants the implementation MUST preserve:
- **Pure function**: `applyReportingGate` no I/O, no logs, no side effects (test LG6 — same input + flag → same output).
- **Idempotente**: aplicar 2 veces consecutivas con `enabled=false` produce bytes idénticos (LG4 — sin trailing whitespace fugitivo, regex incluye `\n?`).
- **`enabled=true` → identity**: byte-idéntico al input (LG1 / LG8 / SR4).
- **`enabled=false` strips markers + body**: regex `/<!-- BEGIN reporting -->[\s\S]*?<!-- END reporting -->\n?/g` global flag — non-greedy + trailing newline opcional.
- **Composition order:** `resolvePromptTemplate` corre INSIDE `applyReportingGate` para que `{{provider_name}}` dentro del bloque se sustituya ANTES del gate (RESEARCH §"{{provider_name}} Substitution" caveat).
- **Fail-open en orchestrator path:** si `isReportToProviderEnabled()` lanza, NO bloquea el launch (defensive — pero `isReportToProviderEnabled` ya es total con optional chaining, así que no debería lanzar).
- **Phase 21 auto-sync (lines 48-87) PRESERVADO** — el helper se inserta arriba (línea ~38), el wire-up abajo (línea ~114), sin tocar el bloque skill-sync.
- **Phase 18 D-06 worktree exclusion comment (lines 130-148) PRESERVADO** — el wire-up está antes (línea 114).
- **Source-hygiene:** launch.js NO accede a `.report_to_provider` directo — solo via `isReportToProviderEnabled()` (LH2).
- **Documentar en SUMMARY:** `[cherry-picked from 5feb578, manual resolution: 3 hunks rebased onto post-Phase-21 launch.js]`.

---

## Touch File 6: `test/labels.test.js` (REPORT-01)

**Plan:** 29-01
**Role:** test-content-assert (defensive helper unit tests)
**Data flow:** Append 1 describe `'REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD'` con 9 tests al final del archivo. Modifica import line 3 para añadir `isGsdChild, KODO_LABEL_GSD_CHILD` al import existente.
**Cherry-pick source:** `5a41d8f` test portion
**Conflict severity:** **Clean** — append puro al final del archivo de 169 líneas (4 describes existentes).

### Closest Analog
`test/labels.test.js` (mismo archivo) — los 3 describes existentes (`parseKodoLabels` lines 5-67, `QUICK-08 — getGsdMode` lines 69-93, `QUICK-08 — getSessionMode` lines 95-126, `GH-05 — GitHub TaskItem cross-provider` lines 132-169) establecen el shape canónico:
- `describe('<REQ-ID> — <subject>', () => { ... })` con prefix de Phase/REQ-ID
- `it('<REQ-ID>: <expected behavior>', () => { assert.equal(...) })`
- `assert.deepEqual` para shapes; `assert.equal` para booleanos/strings
- Edge cases en último test (null/undefined defensive)

### Existing Pattern Excerpt (`test/labels.test.js:69-93`):

```javascript
describe('QUICK-08 — getGsdMode 4-state matrix', () => {
  it('QUICK-08: returns null when no GSD flags present', () => {
    assert.equal(getGsdMode([]), null);
  });

  it('QUICK-08: returns "full" for ["gsd"] only', () => {
    assert.equal(getGsdMode(['gsd']), 'full');
  });

  it('QUICK-08: returns "quick" for ["gsd-quick"] only', () => {
    assert.equal(getGsdMode(['gsd-quick']), 'quick');
  });

  it('QUICK-08: gsd-quick wins over gsd when both present (precedence rule, Phase 13 D-03)', () => {
    assert.equal(getGsdMode(['gsd', 'gsd-quick']), 'quick');
    assert.equal(getGsdMode(['gsd-quick', 'gsd']), 'quick', 'order-independent');
  });

  it('QUICK-08: returns null defensively for non-array input', () => {
    assert.equal(getGsdMode(null), null);
    assert.equal(getGsdMode(undefined), null);
  });
});
```

### What to Add (extracted from branch SHA `5a41d8f`):

**Import line 3 update:**
```javascript
import { parseKodoLabels, getGsdMode, getSessionMode, isGsdChild, KODO_LABEL_GSD_CHILD } from '../src/labels.js';
```

**Append at end of file — 1 describe with 9 tests:**

```javascript
describe('REPORT-01 — isGsdChild + KODO_LABEL_GSD_CHILD', () => {
  it('REPORT-01: KODO_LABEL_GSD_CHILD const value is "kodo:gsd-child"', () => {
    assert.equal(KODO_LABEL_GSD_CHILD, 'kodo:gsd-child');
  });

  it('REPORT-01: isGsdChild([]) returns false (empty array)', () => {
    assert.equal(isGsdChild([]), false);
  });

  it('REPORT-01: isGsdChild defensive — null/undefined/non-array returns false', () => {
    assert.equal(isGsdChild(null), false);
    assert.equal(isGsdChild(undefined), false);
    assert.equal(isGsdChild('kodo:gsd-child'), false, 'plain string is not an array');
    assert.equal(isGsdChild(42), false);
  });

  it('REPORT-01: isGsdChild(["kodo:gsd-child"]) returns true (string form)', () => {
    assert.equal(isGsdChild(['kodo:gsd-child']), true);
  });

  it('REPORT-01: isGsdChild([{name: "kodo:gsd-child"}]) returns true (object form)', () => {
    assert.equal(isGsdChild([{ name: 'kodo:gsd-child' }]), true);
  });

  it('REPORT-01: isGsdChild case-insensitive (string and object forms)', () => {
    assert.equal(isGsdChild(['KODO:GSD-CHILD']), true);
    assert.equal(isGsdChild([{ name: 'Kodo:Gsd-Child' }]), true);
  });

  it('REPORT-01: isGsdChild(["kodo:gsd", "kodo:gsd-child"]) returns true (child wins, D-07 structural)', () => {
    assert.equal(isGsdChild(['kodo:gsd', 'kodo:gsd-child']), true);
    assert.equal(isGsdChild(['kodo:gsd-child', 'kodo:gsd']), true, 'order-independent');
  });

  it('REPORT-01: isGsdChild rejects similar-but-different labels', () => {
    assert.equal(isGsdChild(['kodo:gsd-children']), false, 'plural is not the marker');
    assert.equal(isGsdChild(['kodo:gsd-quick-child']), false, 'compound is not the marker');
    assert.equal(isGsdChild(['gsd-child']), false, 'missing kodo: prefix');
  });

  it('REPORT-01: isGsdChild tolerates mixed garbage in array', () => {
    assert.equal(isGsdChild([null, undefined, 42, true, 'kodo:gsd-child']), true);
    assert.equal(isGsdChild([null, undefined, 42, true, {}, { name: null }]), false);
  });
});
```

### Invariants the implementation MUST preserve:
- Append-only (no mutación de los 4 describes existentes).
- Prefix `REPORT-01:` en cada `it()` (paridad con QUICK-08/GH-05).
- Edge cases incluyen exact-match (children, compound, missing prefix), case-insensitivity, child-wins, mixed-garbage tolerance.

---

## Touch File 7: `test/dispatcher.test.js` (REPORT-01)

**Plan:** 29-01
**Role:** test-content-assert (DI-mocked dispatcher + spies sobre callsites downstream + source-hygiene)
**Data flow:** Append 2 describes (6 behavior tests + 3 source-hygiene tests = 9 totales) al final del archivo de 1038 líneas (7 describes existentes).
**Cherry-pick source:** `cbd8f9c` test portion
**Conflict severity:** **Clean** — append puro. Modifica línea 4 para añadir `import { readFileSync } from 'node:fs';` (trivial; verificar si Phase 28 ya añadió este import — RESEARCH §Pitfall 5).

### Closest Analog
`test/dispatcher.test.js` (mismo archivo):
- `describe('dispatchTrigger — Phase 18 worktree_collision (D-05, D-05b, D-06b)', ...)` (lines 739-1037) — patrón directo para el behavior describe (6 tests con DI deps factory, spies sobre `acquireGsdLockFn` / `launchWorkItemFn` / `removeSessionFn`).
- `describe('dispatchTrigger', ...)` (lines 64-300) — establece `createFakeProvider`, mocking infrastructure (lines 9-32).
- Patrón `t.mock.method(console, 'log', ...)` (Phase 18 Test 7 lines 921-952) para capture stdout.

### Existing Pattern Excerpt (`test/dispatcher.test.js:789-808`):

```javascript
  it('Test 1 — worktree_collision shape (GSD): returns {action, code, detail} when path exists', async () => {
    const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
    let launchCalled = false;
    const result = await dispatchTrigger(baseEvent, {}, {
      getProviderFn: () => makeFakeProvider(gsdTask()),
      launchWorkItemFn: async () => { launchCalled = true; return launchWorkItemResult; },
      listSessionsFn: () => [],
      listWorkspacesFn: async () => '',
      removeSessionFn: () => {},
      acquireGsdLockFn: () => ({ acquired: true }),
      releaseGsdLockFn: () => {},
      resolveProjectPathFn: () => '/tmp/test-repo',
      existsSyncFn: () => true,
    });
    assert.equal(result.action, 'worktree_collision');
    assert.equal(result.code, 'worktree_exists');
    assert.ok(result.detail, 'detail must be populated with worktree path');
    assert.match(result.detail, /\/tmp\/test-repo\/\.bg-shell\/[a-f0-9-]+$/);
    assert.equal(launchCalled, false, 'launchWorkItemFn must NOT be invoked on collision');
  });
```

### What to Add (extracted from branch SHA `cbd8f9c`):

**Import line 4 update (verificar duplicación tras Phase 28 — RESEARCH §Pitfall 5):**
```javascript
import { readFileSync } from 'node:fs';
```

**Append: 2 describes — `REPORT-01 — kodo:gsd-child anti-recursion filter` (6 tests con DI factory `makeDeps` + spies sobre `acquireGsdLock/resolvePhase/launchWorkItem/removeSession`) + `REPORT-01 — dispatcher.js source hygiene` (3 tests: import contract, anti-inline D-08, D-06 estructural `filterIdx < forceIdx`).**

Tests behavior:
1. Returns `{action: 'ignored', code: 'gsd_child'}` para `kodo:gsd-child` task.
2. Filter cuts BEFORE `acquireGsdLockFn` / `resolvePhaseFn` / `launchWorkItemFn` / `removeSessionFn` (4 spies all uncalled).
3. Filter applies bajo `opts.force: true` (D-07 hard safety).
4. Filter applies cuando `kodo:gsd-child` + `kodo:gsd` coexisten (child wins).
5. `t.mock.method(console, 'log')` capture: log line matches `/\[kodo:dispatch\] Ignored —/` && `/gsd-child/i` && `/anti-recursion|filtered/i`.
6. Control test: non-child `kodo:gsd` task DOES reach the resolver (no false positive).

Tests source-hygiene:
7. `dispatcher.js` imports `isGsdChild` from `'../labels.js'` (regex match en source).
8. NO inline `labels.some(... gsd-child ...)` post-stripComments (D-08 anti-inline).
9. `source.indexOf('isGsdChild(task.labels)') < source.search(/if\s*\(!opts\.force\)/)` (D-06 estructural).

### Invariants the implementation MUST preserve:
- DI factory `makeDeps` reutilizable across 6 tests (patrón Phase 18 worktree_collision).
- Spies devuelven `_inspect()` snapshot — no estado global cross-test.
- `t.mock.method(console, 'log', ...)` con restore en `t.afterEach` o try/finally (patrón Phase 18 Test 7 lines 921-952).
- Source-hygiene usa `stripComments` (regex `\/\*[\s\S]*?\*\/` + filter `// `/`* `) — patrón canónico `test/dispatcher-isolation.test.js:30-36`.
- D-06 estructural check `filterIdx < forceIdx` — usa `source.indexOf` + `source.search(/regex/)`.
- Append-only — no mutación de los 7 describes existentes.

---

## Touch File 8: `test/labels-hygiene.test.js` (REPORT-05, **NEW FILE**)

**Plan:** 29-01
**Role:** test-walker (source-hygiene multi-archivo grep walker comment-aware)
**Data flow:** in: `src/` filesystem recorrido recursivamente → out: `assert.deepEqual(violations, [])`. Excluye `src/labels.js` (legítimo).
**Cherry-pick source:** **NEW — no viene del branch** (CONTEXT D-17 propone este archivo, generado por la phase).
**Conflict severity:** **Clean** — new file.

### Closest Analog
**Direct analog (1):** `test/dispatcher-isolation.test.js` (70 líneas, 3 tests Phase 16 LOG-13) — mismo shape exacto: `stripComments` helper + readFileSync de UN archivo objetivo + assert literal-absence.

**Direct analog (2):** `test/format-isolation.test.js` (197 líneas) — patrón walker multi-archivo (`listJsFiles` recursivo + `extractImports` + assert `importers === [path-único-legítimo]`).

### Existing Pattern Excerpt (`test/dispatcher-isolation.test.js:1-70` — single-file source-hygiene):

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
const DISPATCHER_PATH = join(SRC, 'triggers', 'dispatcher.js');

/**
 * Strip block comments + line comments + JSDoc continuation lines.
 * Comments documenting the historical contract are tolerated — this helper filters them out.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('LOG-13: dispatcher source hygiene (Phase 16 SC#1)', () => {
  it('does not contain literal "gsd.phase.resolved" in non-comment code', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes("'gsd.phase.resolved'") && !stripped.includes('"gsd.phase.resolved"'),
      'src/triggers/dispatcher.js must not contain literal "gsd.phase.resolved" in code (use EVENTS.GSD_PHASE_RESOLVED).',
    );
  });
});
```

**Multi-file walker analog (`test/format-isolation.test.js:59-71` + `:99-115`):**

```javascript
/** Recursively list all .js files under a directory. */
function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (st.isFile() && full.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

it('only src/cli/format.js imports picocolors (single source of color)', () => {
  const allFiles = listJsFiles(SRC);
  const importers = [];
  for (const file of allFiles) {
    const src = readFileSync(file, 'utf-8');
    const specs = extractImports(src);
    if (specs.includes('picocolors')) {
      importers.push(relative(REPO, file));
    }
  }
  assert.deepEqual(
    importers,
    ['src/cli/format.js'],
    `picocolors must be imported from EXACTLY ONE file (src/cli/format.js — D-07).`,
  );
});
```

### What to Write (NEW FILE):

```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
const LABELS_FILE = join(SRC, 'labels.js'); // legitimate sole source of the literal

/**
 * Strip block comments + line comments + JSDoc continuation lines.
 * Mirror canónico de test/dispatcher-isolation.test.js:30-36 (Phase 16 LOG-13)
 * y test/stop.test.js:62-67 (Phase 13 source-hygiene).
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

/** Recursively list all .js files under SRC, excluding the legitimate source file. */
function listJsFilesExcept(dir, excludePath) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFilesExcept(full, excludePath));
    } else if (st.isFile() && full.endsWith('.js') && full !== excludePath) {
      out.push(full);
    }
  }
  return out;
}

describe('REPORT-05 — labels source hygiene (Phase 29 D-17)', () => {
  it('REPORT-05: no inline "kodo:gsd-child" literal outside src/labels.js (post-stripComments)', () => {
    const files = listJsFilesExcept(SRC, LABELS_FILE);
    const violations = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const stripped = stripComments(source);
      if (stripped.includes("'kodo:gsd-child'") || stripped.includes('"kodo:gsd-child"')) {
        violations.push(relative(REPO, file));
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Inline 'kodo:gsd-child' literal found in: ${violations.join(', ')}.\n` +
        `Use KODO_LABEL_GSD_CHILD const + isGsdChild(labels) helper from src/labels.js.`,
    );
  });

  it('REPORT-05: src/labels.js (the legitimate source) DOES export KODO_LABEL_GSD_CHILD and isGsdChild', () => {
    const source = readFileSync(LABELS_FILE, 'utf-8');
    assert.match(source, /export\s+const\s+KODO_LABEL_GSD_CHILD\s*=\s*['"]kodo:gsd-child['"]/);
    assert.match(source, /export\s+function\s+isGsdChild\s*\(/);
  });
});
```

### Invariants the implementation MUST preserve:
- **Excluye `src/labels.js`** (legítimo, fuente única) del walker.
- **`stripComments` canonical** (3 capas: block, line `//`, JSDoc cont `*`) — copia del mirror dispatcher-isolation.test.js.
- **Sanity test**: el archivo legítimo `src/labels.js` SÍ contiene el const + helper (caso edge: si refactor del helper desplaza el literal a otro archivo, el test guía hacia el fix).
- **0 violations en estado verde** — pre-Phase 29: 0 (verified `grep -rn 'gsd-child' src/` → 0 matches). Post-Phase 29-01 cherry-picks: 0 (constant + helper son la única ocurrencia).
- **NO viene del branch** — escrito net-new en plan 29-01. Documentar en SUMMARY como `[net-new, NOT cherry-picked — Phase 29 D-17 guard against future inline leaks]`.

---

## Touch File 9: `test/config.test.js` (REPORT-02, **NEW FILE**)

**Plan:** 29-02
**Role:** test-content-assert (helper DI tests + anti-mutation invariant + source-hygiene)
**Data flow:** in: factory `fakeLoad(overrides)` que retorna `{...DEFAULT_CONFIG, ...overrides}` (no filesystem) → out: 10 tests across 3 describes.
**Cherry-pick source:** `e1f82c9` test portion
**Conflict severity:** **Clean** — new file.

### Closest Analog
**No `test/config.test.js` existe en main.** Analogs próximos:
- `test/labels.test.js` (estructura describe + REQ-ID prefix).
- `test/dispatcher-isolation.test.js` (stripComments + recursive walker single-keyword).
- DI factory pattern: `test/dispatcher.test.js` `makeDeps` (lines 758-810) + `test/skill-sync.test.js` (DI seam Phase 21).

### Existing Pattern Excerpt (DI factory canonical — `test/dispatcher.test.js:758-810`):

```javascript
function makeDeps({
  verdict,
  acquireResult = { acquired: true },
  launchResult = { session_id: 'sess-1' },
  task = childTask,
} = {}) {
  const inspectState = { /* ... */ };
  return {
    getProviderFn: () => ({ getTask: async () => task, /* ... */ }),
    resolveProjectPathFn: () => '/tmp/fake-project',
    /* ... 8 más deps mocked */
    _inspect: () => inspectState,
  };
}
```

### What to Write (NEW FILE — extracted from branch SHA `e1f82c9`):

```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isReportToProviderEnabled, DEFAULT_CONFIG } from '../src/config.js';

describe('REPORT-02 — isReportToProviderEnabled', () => {
  // Factory: returns a fake loadConfig that overrides DEFAULT_CONFIG.
  // Avoids fixture filesystem (Pitfall 3 — would touch ~/.kodo/config.json real).
  const fakeLoad = (overrides = {}) => () => ({ ...DEFAULT_CONFIG, ...overrides });

  it('REPORT-02: returns false when config has no workflow section (DEFAULT_CONFIG baseline)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad()), false);
  });

  it('REPORT-02: returns false when loadConfig falls back to DEFAULT_CONFIG (JSON corrupto path)', () => {
    const corruptFallback = () => ({ ...DEFAULT_CONFIG });
    assert.equal(isReportToProviderEnabled(corruptFallback), false);
  });

  it('REPORT-02: returns false when config has providers but no workflow', () => {
    const noWorkflow = () => ({ ...DEFAULT_CONFIG, provider: 'plane', providers: { plane: { /* ... */ } } });
    assert.equal(isReportToProviderEnabled(noWorkflow), false);
  });

  it('REPORT-02: returns false for workflow:{} (sección vacía)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: {} })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: false (explícito)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: false } })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: "true" (string — strict equality)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: 'true' } })), false);
  });

  it('REPORT-02: returns false for workflow.report_to_provider: 1 (number — strict equality)', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: 1 } })), false);
  });

  it('REPORT-02: returns true ONLY for boolean true', () => {
    assert.equal(isReportToProviderEnabled(fakeLoad({ workflow: { report_to_provider: true } })), true);
  });
});

describe('REPORT-02 — DEFAULT_CONFIG anti-mutation (D-03)', () => {
  it('REPORT-02: DEFAULT_CONFIG must NOT contain `workflow` key', () => {
    assert.equal(
      Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'workflow'),
      false,
      'D-03: configs existentes no se reescriben para añadir workflow.{}; helper depende de optional chaining',
    );
  });
});

describe('REPORT-02 — source hygiene (D-05): .report_to_provider only inside src/config.js', () => {
  const SRC_DIR = 'src';
  const HELPER_FILE = join('src', 'config.js');

  function listSrcJsFiles(dir = SRC_DIR) {
    const out = [];
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out.push(...listSrcJsFiles(full));
      else if (entry.endsWith('.js') && full !== HELPER_FILE) out.push(full);
    }
    return out;
  }

  it('REPORT-02: no other src/**/*.js accesses .report_to_provider directly', () => {
    const files = listSrcJsFiles();
    const violations = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const stripped = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
        .join('\n');
      if (/\.report_to_provider\b/.test(stripped)) violations.push(file);
    }
    assert.deepEqual(violations, [], `Direct access to .report_to_provider found in: ${violations.join(', ')}.`);
  });
});
```

### Invariants the implementation MUST preserve:
- **5-state matrix** explícito: `true` (only true), `"true"` (string), `1` (number), `false`, missing key, `workflow:{}` (sección vacía). Total: 8 behavior tests.
- **DEFAULT_CONFIG anti-mutation** — `Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, 'workflow')` MUST be `false`.
- **Multi-archivo recursive walker** (`listSrcJsFiles`) excluyendo `src/config.js`.
- **DI factory `fakeLoad(overrides)`** — patrón evita filesystem touching real (`~/.kodo/config.json`).
- **Comment-aware** stripComments — permite menciones de `report_to_provider` en JSDoc de `src/config.js#isReportToProviderEnabled` (no que importa porque el archivo está excluido del walker).
- Append-only viable (futuro): si emerge un 4° describe en Phase 29+, se añade sin tocar los 3 existentes.

---

## Touch File 10: `test/launch.test.js` + appends a `test/orchestrator-gsd.test.js` + `test/prompt.test.js` (REPORT-03 + REPORT-04, **launch.test.js NEW**)

**Plan:** 29-03 (`test/launch.test.js` LG1..LG8 + LH1..LH3) + 29-04 (RC1..RC15 + RA1..RA6 en `test/orchestrator-gsd.test.js`; SR1..SR6 en `test/prompt.test.js`)
**Role:** test-content-assert (helper unit + content asserts del prompt rendered + source-hygiene)
**Data flow:** in: `applyReportingGate` + `resolvePromptTemplate` + `KODO_LABEL_GSD_CHILD` + raw prompt.md → out: byte-level content asserts.

### Sub-touch A: `test/launch.test.js` (NEW FILE, plan 29-03)

**Cherry-pick source:** `38c7a2e` test(15-01): launch.test.js (NEW file)
**Conflict severity:** **Clean** — new file. **Path crítico:** `test/launch.test.js`, NO `test/orchestrator/launch.test.js` (RESEARCH §"Test File Mapping").

#### Closest Analog
- `test/prompt.test.js` (lines 36-70) — pure helper unit tests con `import { applyReportingGate } from '../src/orchestrator/launch.js'` + `readFileSync` del prompt.md real.
- `test/format-isolation.test.js` (lines 73-96) — source-hygiene single-file.

#### What to Write — 11 tests (LG1..LG8 behavior + LH1..LH3 source-hygiene)

LG1..LG8 (pure helper):
- LG1: `enabled=true` preserves block byte-identical.
- LG2: `enabled=false` strips block AND markers (no `<!-- BEGIN`, no `<!-- END`, no `## Sub-issue reporting`, no `Reporting body.`).
- LG3: `enabled=false` preserves prose outside markers.
- LG4: idempotent — 2× con `enabled=false` → identical.
- LG5: prompt sin markers + `enabled=false` = no-op.
- LG6: pure function — same input + flag → same output.
- LG7: aplicado al `src/orchestrator/prompt.md` real con `flag=false` → `Sub-issue reporting` ausente + markers ausentes. **CAVEAT Pitfall 3:** LG7/LG8 dependen de la prosa presente en 29-04, no en 29-03. RESEARCH §Pitfall 3 recomienda: verificar exact aserts del branch — si LG7/LG8 dependen de la prosa específica (sí, dependen del heading "Sub-issue reporting"), pueden adelantarse en 29-03 si el placeholder ya tiene ese heading. Lectura del branch confirma: `'Sub-issue reporting'` aparece en el placeholder de 29-03 (heading se inserta en 29-03, no en 29-04). **LG7 funciona desde 29-03.**
- LG8: aplicado al real prompt con `flag=true` → byte-idéntico al raw.

LH1..LH3 (source-hygiene):
- LH1: `launch.js` imports `isReportToProviderEnabled` from `'../config.js'` (regex match).
- LH2: `launch.js` NO accede `.report_to_provider` directo (post-stripComments).
- LH3: `launch.js` compone `applyReportingGate(..., isReportToProviderEnabled())` literal (regex `/applyReportingGate\([\s\S]*?isReportToProviderEnabled\(\)/`).

### Sub-touch B: `test/prompt.test.js` (append SR1..SR6, plan 29-03)

**Cherry-pick source:** `4d67312` test(15-02)
**Conflict severity:** **Clean** — append a archivo de 70 líneas (2 describes existentes).

#### Closest Analog
`test/prompt.test.js` (mismo archivo) lines 11-34 (`describe('orchestrator prompt template')` con `readFileSync(PROMPT_PATH)` + asserts byte-level del raw).

#### What to Add — 6 tests SR1..SR6

- SR1: markers `<!-- BEGIN reporting -->` y `<!-- END reporting -->` aparecen exactamente 1 vez each.
- SR2: `indexOf('<!-- BEGIN reporting -->') > indexOf('## Sesiones GSD')` (D-03 slot topológico).
- SR3: heading `## Sub-issue reporting` vive ENTRE BEGIN y END.
- SR4: `applyReportingGate(raw, true)` preserves heading + BEGIN marker; `applyReportingGate(raw, false)` strips ambos + heading.
- SR5: stripped output preserves `## Sesiones GSD` section + `kodo gsd verify <session-id>`.
- SR6: PM7 invariant — no `you must` / `please` / `execute your` en el raw completo.

### Sub-touch C: `test/orchestrator-gsd.test.js` (append RC1..RC15 + RA1..RA6, plan 29-04)

**Cherry-pick source:** `81c848c` test(15-02): RC1..RC15 + RA1..RA6
**Conflict severity:** **Clean** — append a archivo de 271 líneas (6 describes existentes incluyendo QUICK-08 launch.js source hygiene).

#### Closest Analog
`test/orchestrator-gsd.test.js` (mismo archivo):
- `describe('prompt.md — sección GSD renderizada')` (lines 6-44) — patrón canónico: `readFileSync('src/orchestrator/prompt.md')` + content asserts directos (`prompt.includes(...)`, `new RegExp(...).test(prompt)`).
- `describe('QUICK-08 — launch.js source hygiene')` (lines 239-271) — patrón de import `applyReportingGate` + `resolvePromptTemplate` + `KODO_LABEL_GSD_CHILD` desde labels.js (cross-phase coupling).

#### Existing Pattern Excerpt (`test/orchestrator-gsd.test.js:6-44`):

```javascript
describe('prompt.md — sección GSD renderizada', () => {
  const prompt = readFileSync('src/orchestrator/prompt.md', 'utf-8');

  it('PM1: contiene heading literal "## Sesiones GSD"', () => {
    assert.ok(prompt.includes('## Sesiones GSD'),
      'heading "## Sesiones GSD" debe estar presente');
  });

  it('PM3: menciona los 4 verdicts como palabras literales', () => {
    for (const v of ['pass', 'fail', 'missing', 'malformed']) {
      assert.ok(new RegExp(`\\b${v}\\b`).test(prompt),
        `verdict "${v}" ausente en prompt.md`);
    }
  });
  // ...
});
```

#### What to Add — 21 tests (15 content + 6 absence)

Setup compartido (al inicio del bloque appended):
```javascript
import { applyReportingGate, resolvePromptTemplate } from '../src/orchestrator/launch.js';
import { KODO_LABEL_GSD_CHILD } from '../src/labels.js';

describe('REPORT-04..08 — Sub-issue reporting block content', () => {
  const raw = readFileSync('src/orchestrator/prompt.md', 'utf-8');
  const resolved = applyReportingGate(resolvePromptTemplate(raw, { provider: 'plane' }), true);
  const beginIdx = resolved.indexOf('<!-- BEGIN reporting -->');
  const endIdx = resolved.indexOf('<!-- END reporting -->');
  const block = resolved.substring(beginIdx, endIdx);
  // 15 it() asserts RC1..RC15 sobre `block`
});

describe('REPORT-03 — Sub-issue reporting block ABSENT when flag=false', () => {
  const raw = readFileSync('src/orchestrator/prompt.md', 'utf-8');
  const stripped = applyReportingGate(resolvePromptTemplate(raw, { provider: 'plane' }), false);
  // 6 it() asserts RA1..RA6 sobre `stripped`
});
```

Tests RC1..RC15:
- **RC1**: `KODO_LABEL_GSD_CHILD === 'kodo:gsd-child'` sanity + `block.includes(KODO_LABEL_GSD_CHILD)`. **Cross-phase hard coupling** — if Phase 14 cambia el constant value, test rompe inmediato.
- **RC2**: `block.includes('parent_id')`.
- **RC3**: `block.includes('Phase N:')`.
- **RC4**: `Plan N-MM` + `comentario` (plan = comentario).
- **RC5**: lifecycle `in progress` + `done` + `verified` (boundary regex `\bword\b`).
- **RC6**: pragmatic Plane parens (`Plane` + `In Progress` + `Done`).
- **RC7**: `NUNCA` capitalized + `delete-issue` mention + abs(distance) < 200 chars.
- **RC8**: `cancelled` word boundary.
- **RC9**: `HARD STEP` capitalized.
- **RC10**: `block.includes('[kodo:reporting] MCP failure on phase N:')` exact.
- **RC11**: `block.includes('[kodo:reporting] Provider MCP lacks sub-issue capability — reporting disabled')` exact con em-dash.
- **RC12**: `quick` + `(no\s+cre|no\s+se\s+crea|no\s+aplica)` dentro de 200 chars.
- **RC13**: `Goal:`, `PLAN dir:`, `Plans:` literales.
- **RC14**: `list-issues` + `REUSA|dedup|reuses?|reusar`.
- **RC15**: PM7 sub-scoped — no `you must` / `please` / `execute your` en block.

Tests RA1..RA6:
- **RA1**: `!stripped.includes('Sub-issue reporting')`.
- **RA2**: `!stripped.includes('kodo:gsd-child')`.
- **RA3**: `!/\bNUNCA\b/.test(stripped)`.
- **RA4**: `!/HARD STEP/.test(stripped)`.
- **RA5**: `!stripped.includes('[kodo:reporting]')`.
- **RA6**: `stripped.includes('## Sesiones GSD')` + `kodo gsd verify <session-id>` + `Sesiones quick` (pre-existente preservado).

### Invariants the implementation MUST preserve:
- **Provider-agnostic resolution antes del gate**: `applyReportingGate(resolvePromptTemplate(raw, { provider: 'plane' }), true)` — RC6 (pragmatic Plane parens) requiere que `{{provider_name}}` sea sustituido a "Plane".
- **`block` substring extracted via `indexOf` BEGIN/END** — todos los asserts RC1..RC15 operan sobre el block, no sobre todo el prompt resolved.
- **`stripped` operación con `enabled=false`** — RA1..RA6 verifican que las menciones específicas del bloque desaparecen.
- **Cross-phase coupling explícito** via `import { KODO_LABEL_GSD_CHILD } from '../src/labels.js'` — RC1 garantiza consistencia entre Phase 29-01 const y Phase 29-04 prosa.
- **PM7 sub-scope**: RC15 chequea contra `block`, no contra todo el prompt — SR6 chequea contra el raw.
- **LG7 dependency on prose**: en 29-03 (placeholder pre-29-04), LG7 verifica que `Sub-issue reporting` heading existe — el heading viene de 29-03 commit `7c28c06` (manual reapply markers + heading + placeholder). RESEARCH §Pitfall 3 ya validado.
- **Documentar en SUMMARY 29-03:** `[cherry-picked from 38c7a2e, NEW file test/launch.test.js]` + `[cherry-picked from 4d67312, append SR1..SR6 to test/prompt.test.js]`.
- **Documentar en SUMMARY 29-04:** `[cherry-picked from 81c848c, append RC1..RC15 + RA1..RA6 to test/orchestrator-gsd.test.js]`.

---

## Shared Patterns (cross-cutting)

### Pattern S1: Defensive label parsing
**Source:** `src/labels.js:12-38` (`parseKodoLabels`)
**Apply to:** `isGsdChild` in Touch File 1 — same defensive shape (tolerate string[], Array<{name}>, null, undefined, non-array primitives).
```javascript
if (!Array.isArray(labels)) return false; // baseline guard
const names = labels.map(/* extract per shape */).filter(Boolean).map((n) => n.toLowerCase());
```

### Pattern S2: DI optional seam with default
**Source:** `src/orchestrator/launch.js` (Phase 21 D-08 `KODO_ROOT_FOR_SKILL`), `src/triggers/dispatcher.js:44-55` (`DispatchDeps`), Phase 14 W-4 stop.js, Phase 17 UAT-03 spawnSync
**Apply to:** `isReportToProviderEnabled(_loadConfig = loadConfig)` — single optional param with default for test seam.

### Pattern S3: Source-hygiene grep walker (comment-aware)
**Source:** `test/dispatcher-isolation.test.js:30-36` `stripComments` helper + single-file readFileSync; `test/format-isolation.test.js:59-71` recursive `listJsFiles`
**Apply to:** `test/labels-hygiene.test.js` (Touch File 8) — recursive walker excluding the legitimate sole source.
```javascript
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

### Pattern S4: Dispatcher guard + early-return + discriminated union
**Source:** `src/triggers/dispatcher.js:187-214` (Phase 18 worktree_collision), `:140-143` (Phase 8 gsd_locked), `:297-302` (Phase 9 resolver_failed)
**Apply to:** REPORT-01 anti-recursion filter (Touch File 2) — `console.log` canonical line + `return { action, code, ... }`.

### Pattern S5: DI mocking factory + spies + `_inspect`
**Source:** `test/dispatcher.test.js:758-810` `makeDeps` (Phase 18 worktree_collision); spies pattern across all 7 existing describes
**Apply to:** REPORT-01 dispatcher tests (Touch File 7) — factory `makeDeps({task, verdict})` retornando deps con spies + `_inspect()` snapshot.

### Pattern S6: Pure textual transformation con idempotency
**Source:** `src/orchestrator/launch.js:28-36` `resolvePromptTemplate` (no side effects, replaceAll determinístico)
**Apply to:** `applyReportingGate(prompt, enabled)` (Touch File 5) — single regex `replace` + `if (enabled) return prompt;` fast path.

### Pattern S7: Content assert sobre prompt rendered
**Source:** `test/orchestrator-gsd.test.js:6-44` `describe('prompt.md — sección GSD renderizada')` + `test/prompt.test.js:36-70` `describe('resolvePromptTemplate')`
**Apply to:** SR1..SR6 (Touch File 10 sub B) + RC1..RC15 + RA1..RA6 (Touch File 10 sub C) — `readFileSync + applyReportingGate + resolvePromptTemplate` → string content asserts.

### Pattern S8: Comment block anchored to phase + decision IDs
**Source:** `src/triggers/dispatcher.js:147-176` (Phase 18 D-05, D-05b, D-06b worktree_collision comment block) — verbose multi-line block JSDoc explaining the WHY + invariants
**Apply to:** Anti-recursion guard comment block (Touch File 2) — same multi-line style citing Phase 14 D-06/D-07/D-08.

---

## Summary Table

| # | Plan | File | Role | Analog | Conflict | Key Invariants |
|---|------|------|------|--------|----------|----------------|
| 1 | 29-01 | `src/labels.js` | pure-helper | self (`parseKodoLabels`/`getGsdMode` patrón) | **Zero** | Defensive shape + exact match + case-insensitive + child wins + NO mutación helpers existentes |
| 2 | 29-01 | `src/triggers/dispatcher.js` | dispatcher-guard | self (Phase 18 worktree_collision lines 187-214) | **Minor** | Guard fuera `!opts.force` + log literal em-dash + corta antes de 5 callsites downstream |
| 3 | 29-01 | `test/labels.test.js` | test-content-assert | self (4 describes existentes + QUICK-08 / GH-05 pattern) | **Clean append** | 9 tests REPORT-01: const value, 8 edge cases |
| 4 | 29-01 | `test/dispatcher.test.js` | test-content-assert | self (Phase 18 makeDeps + worktree_collision describe) | **Clean append** | 6 behavior + 3 source-hygiene + spies on 4 callsites + console.log capture |
| 5 | 29-01 | `test/labels-hygiene.test.js` | test-walker | `test/dispatcher-isolation.test.js` + `test/format-isolation.test.js` | **NEW file** | Recursive walker excluyendo src/labels.js + stripComments + 0 violations + sanity test del archivo legítimo |
| 6 | 29-02 | `src/config.js` | helper-with-DI | self (Phase 26 `getDefaultGithubProviderConfig` + Phase 14 W-4 DI pattern) | **Moderate** | Strict equality `=== true` + DI opcional + DEFAULT_CONFIG sin key `workflow` + insertar antes Phase-26 helper |
| 7 | 29-02 | `test/config.test.js` | test-content-assert | (no existe analog directo — `test/labels.test.js` shape + DI factory pattern de `dispatcher.test.js`) | **NEW file** | 5-state matrix + anti-mutation invariant + source-hygiene walker excluyendo config.js |
| 8 | 29-03 | `src/orchestrator/prompt.md` | prompt-template | self (`## Sesiones GSD` section Phase 10) | **Severe (manual reapply)** | Markers únicos + after-GSD topology + heading dentro markers + log literals byte-exact + PM7 invariant + provider-agnostic |
| 9 | 29-03 | `src/orchestrator/launch.js` | helper-with-DI + wire-up | self (`resolvePromptTemplate` patrón pure + Phase 21 import pattern) | **Moderate (3 hunks)** | Pure idempotent + composition order + fail-open + Phase 21/18 D-06 preserved |
| 10a | 29-03 | `test/launch.test.js` | test-content-assert | `test/prompt.test.js` (resolvePromptTemplate) + `test/format-isolation.test.js` (source-hygiene) | **NEW file** | 8 LG behavior + 3 LH source-hygiene + path = `test/launch.test.js` (NO `test/orchestrator/launch.test.js`) |
| 10b | 29-03 | `test/prompt.test.js` (append) | test-content-assert | self (lines 11-34 raw asserts) | **Clean append** | SR1..SR6 markers + topology + gating behavior + PM7 |
| 10c | 29-04 | `test/orchestrator-gsd.test.js` (append) | test-content-assert | self (lines 6-44 prompt.md content asserts + lines 239-271 source-hygiene pattern) | **Clean append** | RC1..RC15 content + RA1..RA6 absence + cross-phase coupling via KODO_LABEL_GSD_CHILD import |

---

## Cross-Phase Dependencies (per plan ordering)

| Plan | Hard depends on | Tests reference |
|------|----------------|-----------------|
| 29-01 | (independent) | Tests in labels.test.js + dispatcher.test.js + labels-hygiene.test.js |
| 29-02 | (independent of 29-01 in code, but TEST `REPORT-02: no other src/**/*.js accesses .report_to_provider directly` walker passes only if 29-03 code is NOT yet committed OR uses helper) | Tests in config.test.js |
| 29-03 | 29-02 (`launch.js` imports `isReportToProviderEnabled` from `../config.js`; LH1 asserta el import literal) | Tests in launch.test.js + prompt.test.js append (SR1..SR6) |
| 29-04 | 29-03 (prosa entre markers requiere markers introducidos por 29-03; RC1..RC15 corren sobre `block` extracted via indexOf BEGIN/END; RC1 cross-phase requires `KODO_LABEL_GSD_CHILD` from 29-01) | Tests in orchestrator-gsd.test.js append (RC1..RC15 + RA1..RA6) |

---

## Verification Hooks (for planner's `<verify>` blocks)

### Per-plan quick-test command (RESEARCH §"Validation Architecture")

```bash
# 29-01
node --test test/labels.test.js test/dispatcher.test.js test/labels-hygiene.test.js

# 29-02
node --test test/config.test.js

# 29-03
node --test test/launch.test.js test/prompt.test.js

# 29-04
node --test test/orchestrator-gsd.test.js
```

### Phase gate (after 29-04)

```bash
npm test  # expect ≥844 pass (CONTEXT D-22 target real; floor 818 from ROADMAP)
git log --grep="(cherry picked from commit\|manual reapply of" --since="2026-05-20" | wc -l
# expect ≥9 (audit trail for 9 SHAs)
```

### Source-hygiene grep (manual smoke)

```bash
grep -rEn "'kodo:gsd-child'|\"kodo:gsd-child\"" src/ | grep -v "src/labels.js"
# expect: empty output (REPORT-05 SC#3)

grep -rEn "\.report_to_provider\b" src/ | grep -v "src/config.js"
# expect: empty output (REPORT-02 D-05 source-hygiene)
```

---

## PATTERN MAPPING COMPLETE

**Phase 29 Pattern Map complete.** Planner: use Touch File N excerpts in PLAN.md `<read_first>` arrays and `<action>` blocks with concrete line numbers + literal code snippets. Cross-reference Touch File numbers in `<verify>` against the per-plan quick-test commands above.

- Files classified: **10** (5 src/ + 5 test/, of which 3 test/ are NEW: `test/labels-hygiene.test.js`, `test/config.test.js`, `test/launch.test.js`)
- Analogs found: **10/10** (100% coverage — every touch file has either same-file analog or named mirror test pattern)
- Conflict severity distribution: 2× Zero, 2× Clean append, 3× NEW file, 2× Minor/Moderate, 1× Severe (manual reapply)
- Cross-phase dependencies: 29-03 → 29-02 hard (import); 29-04 → 29-03 hard (markers + heading); 29-04 → 29-01 soft (cross-phase coupling via `KODO_LABEL_GSD_CHILD` import in RC1)
- Key shared patterns identified: 8 (S1..S8) — defensive parsing, DI seam, source-hygiene walker, dispatcher guard, mocking factory, pure transformation, content asserts, decision-anchored comments
