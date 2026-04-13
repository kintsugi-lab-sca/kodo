# Phase 5: Config + Cleanup - Research

**Researched:** 2026-04-13
**Domain:** Provider-agnostic configuration, interactive wizard, prompt templating, legacy cleanup
**Confidence:** HIGH

## Summary

Phase 5 completes the kodo v0.2 migration by making configuration provider-agnostic, rewriting the interactive config wizard, neutralizing the orchestrator prompt, and removing legacy Plane-coupled code from generic modules. The infrastructure is already substantially in place from phases 1-4: `config.js` has `migrateConfig()` and the `providers.*` schema, `registry.js` handles provider factories, and `interface.js` defines the `TaskProvider` contract.

The main work is: (1) adding `listProjects()` to `TaskProvider` interface and implementing it in `PlaneProvider`, (2) rewriting `interactiveConfig()` in `cli.js` to be provider-first and use the registry, (3) replacing hardcoded Plane references in `prompt.md` with `{{placeholders}}` and doing string replacement in `launch.js`, (4) replacing `getPlaneApiKey()` with generic `getProviderApiKey(name)`, (5) removing `src/plane/` legacy directory, and (6) cleaning up `planeId` parameter names in `state.js` and `health.js`.

**Primary recommendation:** Split into two plans: (A) config schema + wizard + provider API key genericization, (B) prompt neutralization + legacy cleanup + variable renaming. Both are low-risk refactors with clear scope boundaries.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Wizard flow: provider-first selection, then provider-specific config (API key, workspace, projects)
- Project listing uses `TaskProvider.listProjects()` interface method, not direct adapter access
- Orchestrator prompt parametrized with placeholders (`{{provider}}`, `{{mcp_tool}}`) via template string replacement at runtime in `launch.js`
- Legacy `src/plane/` directory will be removed; all functional code already migrated to `src/providers/plane/`
- `getPlaneApiKey()` replaced with generic `getProviderApiKey(name)` that reads env vars by active provider
- First-run experience auto-launches wizard when `config.json` absent; only check, launch, server, status commands trigger wizard
- Help, version, and config commands operate without config.json
- Config connection validation required before save; invalid config rejected with error + retry

### Claude's Discretion
- Exact approach for MCP tool references in orchestrator prompt (generic + note vs all parametrized)
- `labels.js`: review and decide if there's real Plane coupling to clean
- Error handling when configured provider has no adapter available
- Implementation details of auto-resume after wizard completes

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | Campo `provider` en config.json selecciona el adapter activo | `config.js` already has `provider: 'plane'` in DEFAULT_CONFIG and `migrateConfig()` sets it. Registry already reads `config.provider`. Need to verify wizard writes this field correctly. |
| CONF-02 | Config existente (plane.*) migra transparentemente al nuevo schema | `migrateConfig()` already implemented and tested (test/migration.test.js). Verified: maps `plane.*` to `providers.plane.*` and adds `provider: 'plane'`. Working. |
| CONF-03 | `kodo config` wizard actualizado para soportar seleccion de provider | Current `interactiveConfig()` in cli.js (lines 237-303) is fully hardcoded to Plane. Must be rewritten to use registry + TaskProvider.listProjects(). |
| CONF-04 | Orchestrator prompt neutral (sin referencias directas a Plane) | `prompt.md` has 8+ Plane references. `launch.js` reads prompt as plain text with no substitution. Must add placeholder replacement. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:readline | built-in | Interactive wizard prompts | Already used in current `interactiveConfig()`, no deps needed |
| node:fs | built-in | Config file I/O | Already used everywhere |
| commander | ^13.0.0 | CLI command framework | Already in package.json |

### Supporting
No additional libraries needed. All work is refactoring existing code with built-in Node.js modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:readline | inquirer/prompts | Adds dependency for little benefit; readline is sufficient for this simple wizard |

## Architecture Patterns

### Recommended Changes to Project Structure
```
src/
├── config.js              # getProviderApiKey(name) replaces getPlaneApiKey()
├── cli.js                 # interactiveConfig() rewritten provider-agnostic
├── interface.js           # Add listProjects() to TaskProvider typedef
├── labels.js              # resolveLabels() JSDoc type updated (discretionary)
├── plane/                 # DELETE entire directory
├── providers/
│   ├── registry.js        # Update to use getProviderApiKey(name)
│   └── plane/
│       ├── provider.js    # Add listProjects() implementation
│       ├── client.js      # Already has listProjects() on PlaneClient
│       └── normalize.js   # Unchanged
├── session/
│   ├── state.js           # Rename planeId params to taskId
│   └── health.js          # Rename planeId to taskId, plane_identifier to task_ref
└── orchestrator/
    ├── prompt.md           # Parametrize with {{provider}}, {{mcp_tool}}, etc.
    └── launch.js           # Add placeholder replacement, fix plane_identifier ref
```

### Pattern 1: Generic Provider API Key Resolution
**What:** Replace `getPlaneApiKey()` with `getProviderApiKey(name)` that reads the `api_key_env` from the active provider's config.
**When to use:** Anywhere that needs the current provider's API key.
**Example:**
```javascript
// config.js
export function getProviderApiKey(providerName) {
  const config = loadConfig();
  const name = providerName || config.provider;
  const providerConfig = config.providers?.[name];
  if (!providerConfig?.api_key_env) return undefined;
  return process.env[providerConfig.api_key_env];
}

// Keep getPlaneApiKey as deprecated wrapper for backward compatibility during transition
export function getPlaneApiKey() {
  return getProviderApiKey('plane');
}
```

### Pattern 2: Provider-First Wizard Flow
**What:** Config wizard selects provider first, then delegates to provider-specific config.
**When to use:** `kodo config` interactive mode.
**Example:**
```javascript
async function interactiveConfig() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n  kodo config\n');

  // 1. Provider selection
  const availableProviders = ['plane']; // extensible
  console.log('  Providers disponibles:');
  availableProviders.forEach((p, i) => console.log(`    ${i + 1}. ${p}`));
  const choice = await ask(`\n  Selecciona provider [1]: `);
  const providerName = availableProviders[parseInt(choice || '1', 10) - 1];

  // 2. Provider-specific config
  const config = loadConfig();
  config.provider = providerName;
  // ... provider-specific prompts (API key env, workspace, etc.)

  // 3. Validate connection
  await initRegistry();
  const provider = getProvider(providerName);
  await provider.init(); // throws if invalid

  // 4. List projects via interface
  const projects = await provider.listProjects();
  // ... map projects to local paths

  saveConfig(config);
  rl.close();
}
```

### Pattern 3: Prompt Template Replacement
**What:** Read `prompt.md` as template, replace `{{placeholders}}` at runtime.
**When to use:** Orchestrator launch.
**Example:**
```javascript
// launch.js
function resolvePromptTemplate(template, config) {
  const replacements = {
    '{{provider}}': config.provider,
    '{{provider_name}}': config.provider.charAt(0).toUpperCase() + config.provider.slice(1),
    '{{mcp_tool}}': `${config.provider} MCP server`,
  };
  let result = template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
  }
  return result;
}
```

### Pattern 4: First-Run Auto-Wizard
**What:** Commands requiring a provider check for config.json and auto-launch wizard if absent.
**When to use:** `check`, `launch`, `server`, `status` commands.
**Example:**
```javascript
// cli.js - in command actions for check, launch, server, status
async function ensureConfig() {
  const { existsSync } = await import('node:fs');
  const { CONFIG_PATH } = await import('./config.js');
  if (!existsSync(CONFIG_PATH)) {
    console.log('  Primera vez? Vamos a configurar kodo.\n');
    await interactiveConfig();
    // If still no config after wizard, exit
    if (!existsSync(CONFIG_PATH)) {
      console.error('  Config requerida para este comando.');
      process.exit(1);
    }
  }
}
```

### Anti-Patterns to Avoid
- **Accessing PlaneClient directly from generic code:** Always go through `TaskProvider` interface via registry
- **Hardcoding provider names in conditional logic:** Use the registry pattern; never `if (provider === 'plane') { ... }`
- **Reading config.plane.* from generic modules:** Always use `config.providers[config.provider].*`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Interactive prompts | Custom stdin handler | node:readline `createInterface` | Already used, handles edge cases (SIGINT, piping) |
| Template replacement | Regex-based template engine | Simple `String.replaceAll()` | Only 3-4 placeholders needed; no need for mustache/handlebars |
| Config validation | Complex schema validator | Try provider.init() + catch | Connection test IS the validation; schema is simple enough for manual checks |

## Common Pitfalls

### Pitfall 1: Legacy PlaneClient in src/plane/ Has Import Consumers
**What goes wrong:** Deleting `src/plane/` breaks imports.
**Why it happens:** `cli.js:268` imports `./plane/client.js` directly; `labels.js:44` has JSDoc type import.
**How to avoid:** Search all imports BEFORE deleting. The cli.js import must be replaced with registry-based access. The labels.js reference is JSDoc-only.
**Warning signs:** `node --test test/**/*.test.js` failures after deletion.

### Pitfall 2: state.js/health.js Still Use `planeId` Parameter Names
**What goes wrong:** Confusing API that uses "planeId" for what is now a generic task ID.
**Why it happens:** Phase 1 migrated the Session typedef fields but didn't rename function parameters (low risk, non-breaking).
**How to avoid:** Rename `planeId` → `taskId` in function signatures and JSDoc. Also rename `plane_identifier` → `task_ref` in health.js HealthReport typedef.
**Warning signs:** Grep for `planeId` and `plane_identifier` in generic modules.

### Pitfall 3: providers/plane/client.js Falls Back to config.plane.*
**What goes wrong:** The PlaneClient constructor reads `config.plane.base_url` (v1 schema path) as fallback.
**Why it happens:** `src/providers/plane/client.js` was copied from legacy before config migration and still has v1 fallbacks.
**How to avoid:** Since PlaneClient is always instantiated by `createPlaneProvider()` which passes explicit config, the fallback paths in the constructor are dead code. However, they should be cleaned: change fallbacks to read from `config.providers.plane.*` or remove fallbacks entirely (the factory always provides explicit values).
**Warning signs:** PlaneClient working even when provider factory passes undefined values.

### Pitfall 4: launch.js Uses `s.plane_identifier` for Context Summary
**What goes wrong:** The `buildContextSummary` function reads `session.plane_identifier` which was renamed to `task_ref` in Phase 1.
**Why it happens:** `launch.js` wasn't updated during state migration.
**How to avoid:** Change `s.plane_identifier` to `s.task_ref` in launch.js line 98.
**Warning signs:** Orchestrator context summary showing "undefined" for task refs.

### Pitfall 5: prompt.md State Schema Documentation Is Outdated
**What goes wrong:** Line 60 of prompt.md documents the old state schema with `planeId` and `plane_identifier`.
**Why it happens:** The prompt was not updated when state.js was migrated.
**How to avoid:** Update the schema documentation in prompt.md to match the v2 Session typedef.

### Pitfall 6: Config Wizard Writes to config.plane.* (v1 path)
**What goes wrong:** Current `interactiveConfig()` writes `config.plane.workspace_slug` and `config.plane.projects` -- v1 schema paths.
**Why it happens:** The wizard was never updated to use the v2 `providers.*` schema.
**How to avoid:** Rewrite wizard to write `config.providers[providerName].*` paths.

## Code Examples

### Adding listProjects() to TaskProvider Interface
```javascript
// src/interface.js - add to TaskProvider typedef
/**
 * @typedef {{
 *   init: () => Promise<void>,
 *   getTask: (ref: string) => Promise<TaskItem>,
 *   updateTaskState: (task: TaskItem, stateName: string) => Promise<void>,
 *   addComment: (task: TaskItem, markdownText: string) => Promise<void>,
 *   listPendingTasks: () => Promise<TaskItem[]>,
 *   listProjects: () => Promise<Array<{id: string, identifier: string, name: string}>>,
 *   parseTriggerEvent: (rawPayload: object) => TriggerEvent|null,
 *   verifySignature: (rawBody: string, headers: object) => boolean,
 *   resolveRef: (humanRef: string) => Promise<string>,
 * }} TaskProvider
 */

// Also add to TASK_PROVIDER_METHODS:
export const TASK_PROVIDER_METHODS = Object.freeze([
  'init', 'getTask', 'updateTaskState', 'addComment',
  'listPendingTasks', 'listProjects', 'parseTriggerEvent',
  'verifySignature', 'resolveRef',
]);
```

### PlaneProvider.listProjects() Implementation
```javascript
// src/providers/plane/provider.js - add to provider object
async listProjects() {
  const data = await client.listProjects();
  return data.map((p) => ({
    id: p.id,
    identifier: p.identifier,
    name: p.name,
  }));
},
```

### Neutralized prompt.md (key sections)
```markdown
Eres el orquestador de kodo. Tu trabajo es supervisar y coordinar las sesiones de Claude Code que estan trabajando en tareas de {{provider_name}}.

## Contexto

- Tienes acceso a {{provider_name}} via {{mcp_tool}} para leer y gestionar work items
- El archivo de estado esta en ~/.kodo/state.json

## Estado actual

Las sesiones activas se leen de ~/.kodo/state.json:
{sessions: {taskId: {workspace_ref, task_ref, provider, summary, status, started_at, project_path}}}

Para {{provider_name}}, usa el {{mcp_tool}} disponible en tu sesion.
```

### labels.js Assessment (Claude's Discretion)
```javascript
// Current state of labels.js:
// - parseKodoLabels(): GENERIC - no Plane coupling, works with any label array
// - resolveLabels(): PLANE-COUPLED - takes PlaneClient as param, calls plane.request()
//
// Recommendation: resolveLabels() is used ONLY inside PlaneProvider (via normalize.js).
// Since it's already Plane-specific, it should be MOVED into src/providers/plane/
// rather than remaining in the generic src/labels.js file.
// parseKodoLabels() stays in src/labels.js as it's provider-agnostic.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `config.plane.*` (v1) | `config.providers.plane.*` (v2) | Phase 1 | migrateConfig() handles transparently |
| `plane_id` / `plane_identifier` in state | `task_id` / `task_ref` in state | Phase 1 | Session typedef updated, param names lagging |
| PlaneClient direct usage | TaskProvider via registry | Phase 2-3 | Most consumers rewired; cli.js config wizard still direct |
| `getPlaneApiKey()` | (pending) `getProviderApiKey(name)` | Phase 5 | 4 call sites to update |

**Already completed (do NOT redo):**
- `migrateConfig()` - pure function, tested, working
- `migrateConfigIfNeeded()` - I/O wrapper with backup, working
- `DEFAULT_CONFIG` - already has `provider` field and `providers.*` structure
- Provider registry with lazy defaults
- Session state v2 schema with `task_id`, `task_ref`, `provider` fields

## Open Questions

1. **Should `resolveLabels()` move to `src/providers/plane/`?**
   - What we know: It takes a `PlaneClient` parameter and calls `plane.request()`. Only used for Plane label resolution.
   - What's unclear: Whether future providers will need a similar label resolution pattern.
   - Recommendation: Move it now. If future providers need it, they can implement their own or we can extract a common pattern then.

2. **Provider not in registry error handling**
   - What we know: `getProvider(name)` throws `Unknown provider: ${name}`.
   - What's unclear: How to handle gracefully in wizard vs runtime.
   - Recommendation: Wizard should show available providers from registry. Runtime should show error message suggesting `kodo config` to reconfigure.

3. **Auto-resume after first-run wizard**
   - What we know: User types `kodo launch KL-42`, wizard runs, then command should continue.
   - What's unclear: Whether to re-parse args or call the action function directly.
   - Recommendation: After wizard completes, simply return and let the command action continue (it already lazy-loads config). The `loadConfig()` call after wizard will pick up the new config.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node 20+) |
| Config file | none (scripts.test in package.json) |
| Quick run command | `node --test test/**/*.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | config.provider selects active adapter | unit | `node --test test/migration.test.js` | Partially (config migration tested, provider selection not) |
| CONF-02 | Legacy plane.* config migrates transparently | unit | `node --test test/migration.test.js` | Yes - already passing |
| CONF-03 | Wizard supports provider selection | manual-only | N/A (interactive readline) | N/A |
| CONF-04 | Prompt has no Plane references | unit | `node --test test/prompt.test.js` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/**/*.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/prompt.test.js` -- covers CONF-04 (verify no hardcoded Plane references in resolved prompt)
- [ ] `test/migration.test.js` -- extend to cover CONF-01 (provider field presence and registry selection)
- [ ] `test/interface.test.js` -- extend to include `listProjects` in TASK_PROVIDER_METHODS check

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection: `src/config.js`, `src/cli.js`, `src/interface.js`, `src/orchestrator/prompt.md`, `src/orchestrator/launch.js`, `src/providers/registry.js`, `src/providers/plane/provider.js`, `src/plane/client.js`, `src/labels.js`, `src/session/state.js`, `src/session/health.js`, `src/server.js`, `src/triggers/dispatcher.js`
- Existing tests: `test/migration.test.js` (config + state migration verified)

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions from user discussion session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all Node.js built-ins
- Architecture: HIGH - patterns follow established Phase 2-4 conventions (DI, registry, pure functions)
- Pitfalls: HIGH - all identified via direct grep of codebase, every reference traced
- Wizard flow: MEDIUM - interactive readline testing is inherently manual; architecture clear but integration untestable in CI

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable domain, no external dependencies)
