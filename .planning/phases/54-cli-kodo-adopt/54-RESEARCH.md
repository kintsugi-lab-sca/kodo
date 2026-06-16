# Phase 54: CLI `kodo adopt` - Research

**Researched:** 2026-06-16
**Domain:** Node.js CLI handler (commander) — thin argv→delegación→render wrapper over the deterministic 0-token `adoptSession` core (Phase 53)
**Confidence:** HIGH (all claims grounded in actual source read this session; no external libraries to verify)

## Summary

Phase 54 is a **pure wiring phase**. It adds one new thin CLI handler (`src/cli/adopt.js` → `runAdoptCli(opts, deps)`) and one commander command block in `src/cli.js`. There is **no new business logic**: every hard problem (discriminant, sanitization, idempotency guard, atomic persist, title default) was already solved and shipped in Phase 53's `src/adopt.js`. The handler's entire job is: parse flags → resolve `provider`/`providerName` (registry) + `projectPath` (from `loadProjects()[projectId]`) → call `adoptSession(...)` → map the discriminant to an exit code → render human or `--json`.

The implementation has an **exact, complete template to mirror 1:1**: `src/cli/gsd-verify.js` (`runGsdVerifyCli`). It already demonstrates every pattern this phase needs — DI shape (`writeFn`/`errFn`/`formatterFn` + a `*Fn` for the business call), `--json` byte-determinism via `JSON.stringify(result, null, 2) + '\n'`, `renderHuman` with semantic color via the formatter, and the Opción A exit-code convention (0/1/2). Its test file `test/gsd-verify-cli-handler.test.js` is an equally exact template for the DI-stubbed unit tests. The command registration block (`src/cli.js:331-345`, `gsd verify`) is the template for the commander wiring.

**One correction to the brief:** the discriminant in shipped `src/adopt.js` is **5 error states + ok**, not 6. The states are `UNSUPPORTED`, `INVALID_INPUT`, `ALREADY_ADOPTED`, `CREATE_FAILED`, `PERSIST_FAILED`. The brief/CONTEXT-D-02 listed 6 because it counted `ok:true` separately or pre-counted a state that the core folded. The exit-code map below is keyed to the **actual** 5+1 shapes verified in source.

**Primary recommendation:** Clone `runGsdVerifyCli` structurally into `runAdoptCli`; clone the `gsd verify` command block into a top-level `program.command('adopt')`; resolve `projectPath` from `loadProjects()` with `resolveProjectPath`-style error semantics BEFORE invoking `adoptSession` (fail-fast, no POST); map the 6 discriminant shapes to exit codes per D-02; clone `gsd-verify-cli-handler.test.js` for DI-stubbed exit-code + render tests.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Flag parsing (`--workspace/--cwd/--session-id/--project/--title/--description/--json`) | CLI registration (`src/cli.js`) | — | commander owns argv→opts; mirror `gsd verify` block |
| Provider resolution (`getProvider(config.provider)`) | CLI handler (`src/cli/adopt.js`) | registry | core is provider-agnostic by design (0-token); the consumer resolves the live provider |
| `projectPath` resolution from `projectId` | CLI handler | `src/config.js` `loadProjects` | core receives `projectPath` as resolved DATA (Phase 53 D-04); listProjects/mapping is consumer-owned |
| Adoption logic (createTask → addSession, discriminant) | Core (`src/adopt.js`, Phase 53) | provider client | already shipped; CLI only invokes |
| Exit-code derivation from discriminant | CLI handler | — | consumer maps semantic codes → process exit (D-02) |
| Render (human + `--json`) | CLI handler | `src/cli/format.js` | color isolation invariant — handler imports format.js, never picocolors |
| Sanitization / title default | Core (`sanitizeAdoptionData`) | — | single source of truth; CLI must NOT duplicate (D-06 backstop) |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | (already a dep, used throughout `src/cli.js`) | Command + flag registration | The entire CLI is built on it; `gsd verify` is the template |
| picocolors | (already a dep, isolated to `src/cli/format.js`) | Color — **accessed ONLY via `createFormatter`** | Color-isolation invariant; never import directly |
| node:test + node:assert/strict | builtin | Unit tests | Repo standard (`test: node --test $(find test -name '*.test.js')`) |

**No new dependencies.** This phase installs nothing. The Package Legitimacy Audit and Environment Availability sections are therefore N/A (see below).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| top-level `program.command('adopt')` | `program.command('gsd').command('adopt')` | D-04 assumes top-level; adoption is not a GSD concern (the core lives at `src/adopt.js`, NOT `src/gsd/`). Top-level is correct. Confirmed by D-04 + the core's deliberate non-GSD placement. |
| `--project` required | `--cwd` fallback as `projectPath` | CONTEXT Claude's Discretion flags this open question. Recommendation: **reject the fallback**, require `--project`. Rationale: `adoptSession` already returns `INVALID_INPUT` if `projectPath` is empty; a silent `cwd`-as-path fallback would create a state.json row whose `project_path` is not a mapped project (breaks `resolveProjectPath` for every other subsystem). Keep `--project` required → unmapped projectId → CLI usage error (exit 1) BEFORE the POST. |

## Package Legitimacy Audit

**N/A — this phase installs zero external packages.** All imports are existing intra-repo modules (`src/adopt.js`, `src/providers/registry.js`, `src/config.js`, `src/cli/format.js`, `src/session/manager.js`) plus node builtins. No registry interaction, no slopcheck needed.

## Architecture Patterns

### System Architecture Diagram

```
argv: kodo adopt --workspace W --cwd C --session-id S --project P [--title T] [--description D] [--json]
   │
   ▼
src/cli.js  program.command('adopt')
   │  ensureConfig()            ── exit 1 if no config (provider needed)
   │  lazy import('./cli/adopt.js')
   ▼
runAdoptCli({ workspace, cwd, sessionId, project, title, description, json }, deps={})
   │
   ├─(1) initRegistry() + getProvider(config.provider)  → provider, providerName
   │
   ├─(2) loadProjects()[project]  ── resolve projectPath
   │        │
   │        └─ unmapped? → render usage error listing available projectIds → return 1  (FAIL-FAST, no POST)
   │
   ├─(3) await adoptSessionFn({ provider, providerName, workspaceRef, cwd,
   │                            sessionId, projectId, projectPath, title?, description? })
   │        │
   │        ▼  returns 5-state-or-ok discriminant
   │   { ok:true, task, session }
   │   { ok:false, code, detail }
   │
   ├─(4) map discriminant → exit code  (D-02 / Opción A)
   │
   └─(5) render
            ├─ --json → JSON.stringify(result, null, 2) + '\n'   (byte-deterministic; the SAME shape adoptSession returns)
            └─ human  → createFormatter(stdout): success green (task_id/task_url/session_id);
                        failure colored by severity; PERSIST_FAILED → LOUD banner on stderr
   │
   ▼
process.exit(code)   (set in the cli.js .action wrapper, mirror gsd verify)
```

### Recommended Project Structure
```
src/
├── cli.js              # ADD: program.command('adopt') block (mirror gsd verify lines 331-345)
├── cli/
│   ├── adopt.js        # NEW: runAdoptCli(opts, deps) — mirror runGsdVerifyCli
│   ├── gsd-verify.js   # TEMPLATE (read, do not edit)
│   └── format.js       # createFormatter (import, never picocolors)
└── adopt.js            # Phase 53 core — INVOKE only, do not edit

test/
├── adopt-cli.test.js   # NEW: DI-stubbed exit-code + render tests (mirror gsd-verify-cli-handler.test.js)
└── format-isolation.test.js  # EXTEND: add 'src/cli/adopt.js' to PHASE_15_CALLSITES list
```

### Pattern 1: Thin handler with DI defaults (mirror `runGsdVerifyCli`)
**What:** `runAdoptCli(opts, deps = {})` resolves each dependency to a real import via `deps.X || realX`, so tests inject stubs without touching real I/O.
**When to use:** This is the handler skeleton — copy it verbatim and rename.
```javascript
// Source: src/cli/gsd-verify.js:57-85 (verified this session) — adapt names for adopt
export async function runAdoptCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const adoptSessionFn = deps.adoptSessionFn || adoptSession;
  // lazy formatter — do not touch process.stdout during import
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  // ... resolve provider + projectPath (see Pattern 2), then:
  const result = await adoptSessionFn({ provider, providerName, workspaceRef, cwd,
                                        sessionId, projectId, projectPath, title, description });

  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');   // byte-deterministic, mirror gsd verify
  } else {
    renderHuman(result, write, err, fmt);            // err passed for the PERSIST_FAILED stderr banner
  }
  return exitCodeFor(result);
}
```

### Pattern 2: Resolve `provider` + `projectPath` BEFORE the core call
**What:** The core is provider/host-agnostic and receives resolved data. The consumer resolves the live provider from the registry and the `projectPath` from `loadProjects()`.
**When to use:** Steps (1)+(2) of the handler, before `adoptSession`.
```javascript
// provider — mirror src/cli/gsd-inspect.js:60-61 / src/session/manager.js:175
const { loadConfig, loadProjects } = await import('../config.js');
const { initRegistry, getProvider } = await import('../providers/registry.js');
const config = loadConfig();
await initRegistry();
const providerName = config.provider;
const provider = getProvider(providerName);

// projectPath — loadProjects() returns { projectId -> string | {default?, modules?} }
// (verified src/config.js:142-151). With no TaskItem yet there is no module to derive,
// so resolve the FLAT/default path. Mirror the canonical error of resolveProjectPath
// (src/session/manager.js:78-103) but key directly on the --project id.
const projects = loadProjects();
const entry = projects[projectId];
if (entry === undefined) {
  err(`No local path mapped for project "${projectId}".\n` +
      `Available projects: ${Object.keys(projects).join(', ') || '(none)'}\n` +
      `Run: kodo config --map-project\n`);
  return 1;  // INVALID_INPUT-equivalent usage error, BEFORE any POST
}
const projectPath = typeof entry === 'string' ? entry : (entry.default ?? '');
if (!projectPath) {
  err(`Project "${projectId}" is mapped but has no default path. Run: kodo config.\n`);
  return 1;
}
```
**Note (Open Question):** `resolveProjectPath` derives a *module* path from `task.groups`. There is no task at CLI time, so module-aware resolution is not applicable — resolve `default`/flat only. The planner should confirm whether a module-object mapping without a `default` is a hard usage error (recommended) vs. picking an arbitrary module.

### Pattern 3: Exit-code mapping from the discriminant (D-02 / Opción A)
**What:** Exhaustive switch over `result.code` (when `ok:false`) deriving the process exit code.
```javascript
function exitCodeFor(result) {
  if (result.ok) return 0;                       // task created + row seeded
  switch (result.code) {
    case 'ALREADY_ADOPTED': return 0;            // idempotent no-op, NOT a failure (D-02)
    case 'INVALID_INPUT':   return 1;            // missing required fields
    case 'UNSUPPORTED':     return 1;            // provider lacks createTask — config error
    case 'PERSIST_FAILED':  return 1;            // orphan, LOUD, recoverable by re-run (NOT transient)
    case 'CREATE_FAILED':   return 2;            // POST failed — transient, retryable (mirror gsd verify exit 2)
    default:                return 1;            // defensive
  }
}
```
**Exit-code parity table (the contract the dashboard/orchestrator consume):**

| Discriminant shape | Exit | Stream | Severity color |
|--------------------|------|--------|----------------|
| `{ ok:true, task, session }` | 0 | stdout | green (success) |
| `{ ok:false, code:'ALREADY_ADOPTED', detail:{ task_id } }` | 0 | stdout | neutral/yellow "ya adoptada" + existing task_id |
| `{ ok:false, code:'INVALID_INPUT', detail:{ missing } }` | 1 | stderr | red |
| `{ ok:false, code:'UNSUPPORTED', detail:{ providerName } }` | 1 | stderr | red |
| `{ ok:false, code:'PERSIST_FAILED', detail:{ task_id, task_url, hint, message } }` | 1 | **stderr LOUD banner** | red, with task_id + task_url + hint |
| `{ ok:false, code:'CREATE_FAILED', detail:{ message } }` | 2 | stderr | yellow (transient) |

### Pattern 4: Command registration (mirror `gsd verify` block)
**What:** commander command with options, `ensureConfig()` guard, lazy import, `process.exit(code)`, try/catch → exit 1.
```javascript
// Source: src/cli.js:331-345 (gsd verify) — adapt to top-level adopt
program
  .command('adopt')
  .description('Adopt an ad-hoc session into a persistent task (deterministic, 0-token)')
  .requiredOption('--workspace <ref>', 'Workspace reference of the live session')
  .requiredOption('--cwd <path>', 'Working directory of the session')
  .requiredOption('--session-id <id>', 'Claude Code session id (resume_binding.checkpoint_id)')
  .requiredOption('--project <id>', 'Target project id (must be mapped in kodo config)')
  .option('--title <t>', 'Task title (default: basename(cwd), applied by the core)')
  .option('--description <d>', 'Task description (optional)')
  .option('--json', 'Emit the discriminant as JSON (scriptable, byte-deterministic)')
  .action(async (opts) => {
    try {
      await ensureConfig();                              // provider needed → guard
      const { runAdoptCli } = await import('./cli/adopt.js');
      const code = await runAdoptCli({
        workspaceRef: opts.workspace, cwd: opts.cwd, sessionId: opts.sessionId,
        projectId: opts.project, title: opts.title, description: opts.description,
        json: opts.json || false,
      });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```
**commander note (HIGH):** `--session-id` maps to `opts.sessionId` (commander camelCases multi-word flags automatically). `.requiredOption()` makes commander itself error+exit before `.action` if a required flag is absent — this is a SECOND layer over the core's `INVALID_INPUT` guard. The planner should decide whether to lean on `.requiredOption()` (commander's own exit code is 1, message to stderr) or `.option()` + let the core return `INVALID_INPUT`. Recommendation: use `.requiredOption()` for the four required flags — it gives clean `--help`-aligned usage errors and the core's `INVALID_INPUT` remains the defense-in-depth backstop for programmatic callers.

### Anti-Patterns to Avoid
- **Re-implementing the title default or sanitization in the CLI.** `sanitizeAdoptionData` (core) owns `title ?? basename(cwd)` + path redaction. The CLI passes `title`/`description` through untouched (or omits them). Duplicating = two sources of truth (violates D-06, the specifics note in CONTEXT).
- **Re-generating / reordering the `--json` shape.** Emit `result` exactly as `adoptSession` returns it (mirror gsd verify's `JSON.stringify(result, null, 2)`). Any reshape breaks byte-determinism for the orchestrator.
- **Importing picocolors directly.** All color via `createFormatter`. `test/format-isolation.test.js` enforces single-source; adding the CLI to `PHASE_15_CALLSITES` will require it import format.js and forbid picocolors.
- **Touching `src/server.js` / adding an endpoint.** Out of scope and an explicit invariant ("cero endpoints nuevos"). The CLI lives entirely in the CLI lane.
- **Adding `createTask` to `TASK_PROVIDER_METHODS`.** FROZEN-9. The core already typeof-detects it; the CLI must not assert it exists (it relies on the core's `UNSUPPORTED` path).
- **Calling cmux / any LLM / interactive prompt.** 0-token deterministic lane. All inputs are explicit flags.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotency / double-adopt guard | A `findSession` re-check in the CLI | `adoptSession` already does it (returns `ALREADY_ADOPTED`) | Single source of truth; the core does a fresh `loadState()` read |
| Atomic state write | tmp+rename in the CLI | `addSession` (called inside the core, upgraded to tmp+rename in Phase 53 D-05) | Core owns persistence |
| Title default + path sanitization | `basename(cwd)` / regex redaction in the CLI | `sanitizeAdoptionData` (core) | D-06 backstop; CLI duplication defeats the security boundary |
| Discriminant / error taxonomy | New error codes in the CLI | The 5 codes `adoptSession` returns | The CLI only MAPS codes → exit codes |
| Color/ANSI handling | picocolors calls | `createFormatter(stream)` | Color-isolation invariant |

**Key insight:** This phase is ~90% the responsibility of *not* writing logic. Every temptation to "handle" something is already handled in the core; the CLI's only original logic is (a) resolving `provider`+`projectPath`, (b) the exit-code switch, and (c) the human render strings.

## Runtime State Inventory

N/A — this is a **greenfield additive** phase (new handler + new command block + new test file; one additive edit to `format-isolation.test.js`'s callsite list). No rename, refactor, or migration. No stored data, live-service config, OS-registered state, secrets, or build artifacts are touched.
- Stored data: **None** — verified; the CLI only invokes `adoptSession`, which itself seeds state.json (already shipped Phase 53).
- Live service config: **None** — verified.
- OS-registered state: **None** — verified; no scheduler/launchd/pm2 changes.
- Secrets/env vars: **None new** — the provider API key (`KODO_*`) is already resolved by the existing registry factory; the CLI does not read secrets directly.
- Build artifacts: **None** — no package rename; `bin/kodo` already dispatches to `src/cli.js` (verified `bin/kodo` = `import('../src/cli.js')`).

## Common Pitfalls

### Pitfall 1: The discriminant is 5 states + ok, not 6
**What goes wrong:** The brief and CONTEXT D-02 say "6 states." Source (`src/adopt.js:135-140`) defines exactly 5 error codes + `ok:true`. Planning a 6th branch (or assuming a state that doesn't exist) creates dead code or a test that can never be exercised.
**Why it happens:** Counting `ok:true` as a state, or carrying forward Phase 53 D-01's "five states" wording inconsistently.
**How to avoid:** Map exactly these 6 shapes: `ok:true`, `UNSUPPORTED`, `INVALID_INPUT`, `ALREADY_ADOPTED`, `CREATE_FAILED`, `PERSIST_FAILED`. (Six total *shapes*, five *error codes*.)
**Warning signs:** A `switch` with a 6th `case` that has no matching code string.

### Pitfall 2: `resolveProjectPath` takes a `task`, but there is no task yet
**What goes wrong:** Reusing `resolveProjectPath(task, projects)` verbatim fails — at CLI time the task hasn't been created (`adoptSession` creates it). `task.projectId` / `task.groups` don't exist.
**Why it happens:** The CONTEXT says "mirror `resolveProjectPath`" — that means mirror the **error semantics**, not call the function.
**How to avoid:** Resolve `projects[projectId]` directly (Pattern 2). Reproduce the canonical "No local path mapped" error message + the `kodo config --map-project` hint. Skip module derivation (no task → no `groups`).
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'projectId')`.

### Pitfall 3: Resolving `projectPath` fail-fast vs. the core's `INVALID_INPUT`
**What goes wrong:** If you pass an empty `projectPath` to the core, it returns `INVALID_INPUT` — but only AFTER the typeof-gate and BEFORE the POST, so it's safe; however the CLI's own pre-flight gives a *better* message (lists available projectIds). Doing the check in BOTH places is fine (defense in depth), but the CLI's pre-flight check must come first so the operator sees the helpful list, not the generic `{ missing: ['projectPath'] }`.
**How to avoid:** Resolve+validate `projectPath` in the handler (Pattern 2) and return exit 1 with the project list BEFORE calling `adoptSession`. The core's `INVALID_INPUT` remains the backstop for programmatic callers passing data directly.
**Warning signs:** Operator gets `INVALID_INPUT missing=[projectPath]` instead of "Available projects: ...".

### Pitfall 4: PERSIST_FAILED must be LOUD on stderr
**What goes wrong:** Rendering PERSIST_FAILED like any other failure (or to stdout) loses the orphan recovery coordinates. The core deliberately models it as a non-throwing code; the CONSUMER is responsible for making it loud (Phase 53 D-03).
**How to avoid:** Special-case PERSIST_FAILED in `renderHuman` → write a banner to `err` (stderr) containing `detail.task_id`, `detail.task_url`, and `detail.hint`. Exit 1 (not 2 — it's not a provider transient).
**Warning signs:** A successful provider task with no local row and a quiet exit.

### Pitfall 5: `--json` must not color or reshape
**What goes wrong:** Running the formatter over the JSON, or building a custom object, breaks byte-determinism (the orchestrator parses this).
**How to avoid:** In `--json` mode emit `JSON.stringify(result, null, 2) + '\n'` and return early — exactly the gsd-verify pattern. The formatter's `useColor=false` on non-TTY already strips ANSI, but `--json` must bypass rendering entirely regardless of TTY (gsd-verify test JSON1 asserts no ANSI even with a TTY formatter injected).
**Warning signs:** `JSON.parse` throws on the output, or ANSI escapes appear in piped output.

### Pitfall 6: format-isolation test will fail until the new callsite is registered
**What goes wrong:** `test/format-isolation.test.js` has a frozen `PHASE_15_CALLSITES` list (lines 132-139) asserting each listed file imports format.js and not picocolors. A new CLI handler that imports format.js is fine, but the planner should decide whether to ADD `src/cli/adopt.js` to that list to lock the invariant for the new surface (the brief says the test "expects new CLI callsites to import format.js").
**How to avoid:** Add `'src/cli/adopt.js'` to `PHASE_15_CALLSITES` as part of the plan (additive edit), so the new surface is covered by both the positive (imports format.js) and negative (no picocolors) assertions.
**Warning signs:** New handler imports picocolors and no test catches it.

## Code Examples

### `renderHuman` for adopt (mirror gsd-verify's color-by-severity)
```javascript
// Source pattern: src/cli/gsd-verify.js:106-165 (verified). Adapt to the adopt discriminant.
function renderHuman(result, write, err, fmt) {
  if (result.ok) {
    const { task, session } = result;
    write(`${fmt.ok('Adopted')}\n`);
    write(`  task_id:    ${fmt.green(task.id)}\n`);
    write(`  task_url:   ${task.url}\n`);
    write(`  session_id: ${session.session_id}\n`);
    return;
  }
  switch (result.code) {
    case 'ALREADY_ADOPTED':
      write(`Already adopted (no-op). Existing task: ${result.detail.task_id}\n`);
      return;
    case 'PERSIST_FAILED':
      // LOUD on stderr — orphan recovery coordinates (D-03 / Pitfall 4)
      err(`${fmt.red('PERSIST_FAILED')} — provider task created but local write failed.\n`);
      err(`  task_id:  ${result.detail.task_id}\n`);
      err(`  task_url: ${result.detail.task_url}\n`);
      err(`  hint:     ${result.detail.hint}\n`);
      return;
    case 'CREATE_FAILED':
      err(`${fmt.yellow('CREATE_FAILED')} (transient): ${result.detail.message}\n`);
      return;
    case 'INVALID_INPUT':
      err(`${fmt.red('INVALID_INPUT')}: missing ${result.detail.missing.join(', ')}\n`);
      return;
    case 'UNSUPPORTED':
      err(`${fmt.red('UNSUPPORTED')}: provider "${result.detail.providerName}" cannot create tasks.\n`);
      return;
  }
}
```

### Representative DI-stubbed unit test (mirror `gsd-verify-cli-handler.test.js`)
```javascript
// Source pattern: test/gsd-verify-cli-handler.test.js:116-149 (verified)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runAdoptCli } from '../src/cli/adopt.js';

function makeStub() { let buf=''; return { write:(s)=>{buf+=s;}, get:()=>buf }; }

describe('runAdoptCli — exit codes (D-02)', () => {
  it('ok:true → exit 0 + task_id/task_url/session_id', async () => {
    const out = makeStub();
    const code = await runAdoptCli(
      { workspaceRef:'W', cwd:'C', sessionId:'S', projectId:'P' },
      {
        adoptSessionFn: async () => ({ ok:true,
          task:{ id:'T-1', url:'https://x/T-1' }, session:{ session_id:'S' } }),
        // stub provider/projectPath resolution too (inject getProviderFn / loadProjectsFn)
        writeFn: out.write, errFn: () => {},
        formatterFn: () => createFormatter({ isTTY:false }, {}),
      },
    );
    assert.equal(code, 0);
    assert.match(out.get(), /task_id:\s+T-1/);
  });

  it('CREATE_FAILED → exit 2 (transient)', async () => {
    const code = await runAdoptCli(
      { workspaceRef:'W', cwd:'C', sessionId:'S', projectId:'P' },
      { adoptSessionFn: async () => ({ ok:false, code:'CREATE_FAILED', detail:{ message:'403' } }),
        writeFn: () => {}, errFn: () => {} },
    );
    assert.equal(code, 2);
  });
  // ... ALREADY_ADOPTED→0, INVALID_INPUT→1, UNSUPPORTED→1, PERSIST_FAILED→1 (stderr banner)
});
```
**DI note:** `runAdoptCli` needs MORE injectable deps than gsd-verify because it resolves provider + projectPath. Inject `getProviderFn` and a `loadProjectsFn` (or pass a pre-resolved `provider`/`projectPath` via deps) so tests never touch the real registry or `~/.kodo/projects.json`. Mirror how `gsd-inspect.js` makes `getProviderFn` a dep (src/cli/gsd-inspect.js:60).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "kodo no crea ni elimina tareas" | kodo CREATES tasks (delete still forbidden) | v0.13 (Phase 52) | adopt is the first task-creating CLI; orphans recovered by re-run, never deleted |
| n/a | `createTask` typeof-detected OUTSIDE FROZEN-9 | Phase 52 | CLI relies on the core's `UNSUPPORTED` path; never asserts the method |
| `saveState` plain writeFileSync | tmp+rename atomic write | Phase 53 D-05 | CLI gets atomic persistence for free via `addSession` |

**Deprecated/outdated:** None relevant. This is a fresh wiring phase over recently-shipped (this same day) Phase 53 code.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Top-level `program.command('adopt')` (not under `gsd`) | Patterns / Alternatives | Low — D-04 assumes top-level; trivially relocatable. Planner confirms. |
| A2 | `--project` required, no `cwd→projectPath` fallback | Alternatives / Pitfall 3 | Medium — CONTEXT marks this as Claude's Discretion. If the operator wants a fallback, the unmapped-project error path changes. Recommended: reject fallback. |
| A3 | Resolve only the flat/`default` path from `loadProjects()` (no module derivation, since no task exists) | Pattern 2 | Medium — if a project mapping is module-object WITHOUT a `default`, behavior is undefined; recommend hard usage error. Planner confirms. |
| A4 | Use commander `.requiredOption()` for the 4 required flags | Pattern 4 | Low — alternative is `.option()` + rely on core `INVALID_INPUT`. Either works; `.requiredOption()` gives cleaner usage errors. |
| A5 | Add `src/cli/adopt.js` to `PHASE_15_CALLSITES` in format-isolation test | Pitfall 6 | Low — additive test edit; brief explicitly expects new CLI callsites to import format.js. |

## Open Questions

1. **`--project` required vs. `--cwd` fallback** (CONTEXT Claude's Discretion)
   - What we know: `adoptSession` returns `INVALID_INPUT` on empty `projectPath`; every other subsystem resolves paths via mapped projects.
   - What's unclear: whether an operator wants to adopt into an unmapped path.
   - Recommendation: require `--project`; reject fallback (preserves `resolveProjectPath` consistency for the whole codebase).

2. **Module-object project mapping without `default`** (Pattern 2 / A3)
   - What we know: `loadProjects()` entries can be `string` or `{ default?, modules? }`; module selection needs `task.groups`, which doesn't exist pre-creation.
   - What's unclear: how to pick a path when only `modules` are mapped and no `default`.
   - Recommendation: treat as a usage error ("project mapped but no default path; run kodo config").

3. **`ALREADY_ADOPTED` exit code = 0** (D-02, reconsiderable per CONTEXT Deferred)
   - Already decided 0 (idempotent). Flag only: if a real operator wants a distinct "no-op" code, this is the single most likely future change. No action now.

## Environment Availability

N/A — no external tools, services, or runtimes. The phase is pure intra-repo JS (handler + command + tests). The only runtime is Node (already required to run kodo at all) and the existing `picocolors`/`commander` deps. A smoke test (`node bin/kodo adopt --help`) and an end-to-end run against a stub provider are valuable but require no new environment.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test + node:assert/strict (builtin) |
| Config file | none — `package.json` `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/adopt-cli.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BIDIR-07 (SC1) | Flags map to `adoptSession` inputs; task created + row seeded on `ok:true` | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 (SC2) | Each discriminant code → correct exit (0/1/2 per D-02) | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 (SC2) | `ALREADY_ADOPTED` → exit 0 (idempotent) | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 (SC2) | `CREATE_FAILED` → exit 2 (transient) | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 (SC3) | Success render shows task_id + task_url + session_id | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 (SC3) | Failure render shows code + detail; PERSIST_FAILED LOUD on stderr | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 | `--json` byte-deterministic = `JSON.stringify(result,null,2)`, no ANSI | unit | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| BIDIR-07 | Unmapped `--project` → exit 1 + available-projects list, NO POST | unit (inject `loadProjectsFn` stub) | `node --test test/adopt-cli.test.js` | ❌ Wave 0 |
| Invariant | `src/cli/adopt.js` imports format.js, not picocolors | static | `node --test test/format-isolation.test.js` | ✅ extend `PHASE_15_CALLSITES` |
| Invariant | `src/cli.js` registers `.command('adopt')` + imports `./cli/adopt.js` | static | `node --test test/adopt-cli.test.js` (CLI-wiring block) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/adopt-cli.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/adopt-cli.test.js` — covers BIDIR-07 (all 6 discriminant shapes → exit codes + renders, `--json`, projectPath resolution + usage error, static CLI-wiring assertions). Mirror `test/gsd-verify-cli-handler.test.js` structure (DI stubs for `adoptSessionFn`, `getProviderFn`/`loadProjectsFn`, `writeFn`, `errFn`, `formatterFn`).
- [ ] No new shared fixtures needed — DI stubs return plain discriminant objects inline (mirror gsd-verify's `passResult()`/`failResult()` builders).
- [ ] Framework install: none — node:test is builtin.

**Human UAT:** Not strictly required (fully unit-testable via DI). RECOMMENDED smoke checks: `node bin/kodo adopt --help` (commander wiring) and one end-to-end invocation against a stub/real provider to confirm `process.exit(code)` propagates.

## Security Domain

> `security_enforcement` not present in config.json → treated as enabled. Scope is minimal for this phase.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Provider API key already resolved by the existing registry factory; CLI does not handle credentials |
| V3 Session Management | no | n/a (no web session) |
| V4 Access Control | no | Local CLI, operator-invoked |
| V5 Input Validation | yes | Required-flag validation via commander `.requiredOption()` + core `INVALID_INPUT`; `projectId` validated against `loadProjects()` allowlist |
| V6 Cryptography | no | none |

### Known Threat Patterns for {Node CLI + external task manager POST}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Absolute-path / home-dir leak into the external task manager (title/description) | Information Disclosure | **Already mitigated in the core** (`sanitizeAdoptionData` — strip abs paths, redact home, structurally cannot forward a transcript). CLI must NOT bypass it by pre-sanitizing or reshaping. |
| Operator passing a hostile `--project` to write an unmapped state.json path | Tampering | `projectId` validated against the `loadProjects()` allowlist before any write (Pattern 2). |
| Argument injection via shelled invocation (dashboard/orchestrator `execFile`) | Tampering | Consumers use `execFile` with argv literal (no shell) — Phase 56/57 concern; the CLI's flag contract being explicit/positional-free supports it. |

## Sources

### Primary (HIGH confidence) — all read this session
- `src/adopt.js` (Phase 53 core) — `adoptSession` signature + the 5-error-code discriminant + detail shapes (lines 131-251).
- `src/cli/gsd-verify.js` — `runGsdVerifyCli` handler template: DI, exit codes, `--json`, `renderHuman` color semantics.
- `src/cli.js:331-345` — `gsd verify` command registration template; `:479-492` — `ensureConfig`; `:202-246` (launch) — registry usage pattern.
- `src/providers/registry.js` — `initRegistry` / `getProvider` (validates against FROZEN-9 `TASK_PROVIDER_METHODS`).
- `src/config.js:125-179` — `loadConfig`, `loadProjects` (returns `projectId → string | {default?, modules?}`), `getProviderApiKey`.
- `src/session/manager.js:78-114` — `resolveProjectPath` canonical error semantics + `deriveModuleName`.
- `src/cli/format.js` — `createFormatter` API (green/yellow/red/ok, TTY-aware, useColor strip).
- `src/cli/gsd-inspect.js:1-61` — second precedent; `getProviderFn` DI pattern.
- `src/interface.js:12-20` — `TaskItem` shape (`id`, `ref`, `title`, `projectId`, `projectName`, `url`).
- `test/gsd-verify-cli-handler.test.js` — DI-stubbed exit-code + render + `--json` test template.
- `test/format-isolation.test.js:131-181` — `PHASE_15_CALLSITES` invariant (callsites import format.js, no picocolors).
- `bin/kodo` — entrypoint = `import('../src/cli.js')`.
- `.planning/phases/54-cli-kodo-adopt/54-CONTEXT.md` — D-01..D-04 + Claude's Discretion + canonical refs.
- `.planning/phases/53-fontaner-a-src-adopt-js/53-CONTEXT.md` — discriminant taxonomy, D-03 LOUD PERSIST_FAILED, D-06 sanitization.
- `.planning/REQUIREMENTS.md` — BIDIR-07.

### Secondary / Tertiary
- None — no external sources needed; this is an entirely intra-codebase wiring phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all libraries already in use and verified in source.
- Architecture: HIGH — exact template (`runGsdVerifyCli`) read line-by-line; handler is a structural clone.
- Pitfalls: HIGH — derived from reading the actual core discriminant + resolveProjectPath signature mismatch + format-isolation test.

**Research date:** 2026-06-16
**Valid until:** 2026-07-16 (stable — depends only on just-shipped intra-repo code; the only churn risk is if Phase 53's `adoptSession` signature or discriminant changes, which would be a breaking change flagged by tests).
