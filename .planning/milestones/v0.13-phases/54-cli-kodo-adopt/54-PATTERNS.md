# Phase 54: CLI `kodo adopt` - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 3 (1 NEW handler, 1 MODIFIED registration, 1 NEW test) + 1 MODIFIED test (callsite allowlist)
**Analogs found:** 3 / 3 (exact templates for every file)

> This is a **pure wiring phase** (RESEARCH §Summary). There is no new business logic — `adoptSession` (Phase 53, `src/adopt.js`) already owns the discriminant, sanitization, idempotency guard and atomic persist. Every file below has an **exact 1:1 template** in the codebase. The planner copies structure and renames; it does not invent.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/adopt.js` (NEW) | CLI handler (`runAdoptCli`) | request-response (argv→delegation→render) | `src/cli/gsd-verify.js` (`runGsdVerifyCli`) | **exact** (structural clone) |
| `src/cli.js` (MODIFIED) | route / command registration | request-response | `src/cli.js:331-345` (`gsd verify` block) | **exact** (commander block) |
| `test/adopt-cli.test.js` (NEW) | test (DI-stubbed unit) | request-response | `test/gsd-verify-cli-handler.test.js` | **exact** (test harness clone) |
| `test/format-isolation.test.js` (MODIFIED) | test (static invariant) | n/a | `PHASE_15_CALLSITES` array (lines 133-139) | **exact** (additive one-line edit) |

**Data-source analogs (read-only; the handler invokes/imports these, does NOT modify them):**

| Module | Used for | Reference |
|--------|----------|-----------|
| `src/adopt.js` `adoptSession` | the business call; 5-error-code + ok discriminant | signature lines 163-166; codes lines 135-140 |
| `src/providers/registry.js` `initRegistry`/`getProvider` | resolve live `provider`/`providerName` | `getProvider(name)` line 96; `initRegistry()` line 123 |
| `src/config.js` `loadConfig`/`loadProjects` | resolve `config.provider` + `projectPath` | `loadConfig` line 125; `loadProjects` line 143 |
| `src/session/manager.js` `resolveProjectPath` | **error semantics to mirror** (NOT to call) | lines 78-103 |
| `src/cli/format.js` `createFormatter` | color isolation — only color source | factory line 114; `green`/`yellow`/`red`/`ok` lines 165-173 |

## Pattern Assignments

### `src/cli/adopt.js` (NEW — CLI handler, request-response)

**Analog:** `src/cli/gsd-verify.js` (read line-by-line). Clone the handler skeleton, rename `runGsdVerifyCli`→`runAdoptCli`, `runVerifyFn`→`adoptSessionFn`, and adapt the discriminant switch + render.

**Imports pattern** (mirror `gsd-verify.js:1-18` header + import block; `// @ts-check` first):
```javascript
// @ts-check
// src/cli/adopt.js — Action handler de `kodo adopt`. (ES comments — codebase convention)
import { adoptSession } from '../adopt.js';
import { createFormatter } from './format.js';
// NOTE: provider + projectPath resolution is lazy-imported INSIDE the handler
// (mirror gsd-verify.js DI + the launch block src/cli.js:212-214) so tests
// inject getProviderFn/loadProjectsFn without touching the real registry.
```
**Color isolation invariant (LOCKED):** import `createFormatter` from `./format.js`; **never** import `picocolors`. Enforced by `test/format-isolation.test.js` once the callsite is added (see below).

**Handler skeleton + DI defaults** (mirror `gsd-verify.js:57-85` exactly):
```javascript
export async function runAdoptCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const adoptSessionFn = deps.adoptSessionFn || adoptSession;
  // lazy formatter — do NOT touch process.stdout during import (gsd-verify.js:62-64)
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  // ... resolve provider + projectPath (Pattern below) ...
  const result = await adoptSessionFn({ provider, providerName, workspaceRef, cwd,
                                        sessionId, projectId, projectPath, title, description });
  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');   // byte-deterministic, mirror gsd-verify.js:80
  } else {
    renderHuman(result, write, err, fmt);            // err passed for the PERSIST_FAILED stderr banner
  }
  return exitCodeFor(result);
}
```
**DI delta vs. gsd-verify:** `runAdoptCli` needs MORE injectable deps because it resolves provider + projectPath. Add `getProviderFn` (mirror `gsd-inspect.js:58-62`) and `loadProjectsFn` so tests never touch the real registry or `~/.kodo/projects.json`. Resolve them with the `deps.X || realX` idiom.

**Provider + projectPath resolution BEFORE the core call** (mirror the launch block `src/cli.js:212-217` for provider; mirror `resolveProjectPath` **error semantics** `manager.js:78-103` for projectPath — do NOT call `resolveProjectPath`, it takes a `task` that does not exist yet):
```javascript
const { loadConfig, loadProjects } = await import('../config.js');
const { initRegistry, getProvider } = await import('../providers/registry.js');
loadConfig(); await initRegistry();
const providerName = (deps.loadConfigFn || loadConfig)().provider;
const provider = (deps.getProviderFn || (() => getProvider(providerName)))();

// projectPath — loadProjects() returns Record<projectId, string> (config.js:142-143).
// Mirror the canonical "No local path mapped" error of resolveProjectPath (manager.js:80-84),
// but key directly on --project (no task → no module derivation; resolve flat/default only).
const projects = (deps.loadProjectsFn || loadProjects)();
const entry = projects[projectId];
if (entry === undefined) {
  err(`No local path mapped for project "${projectId}".\n` +
      `Available projects: ${Object.keys(projects).join(', ') || '(none)'}\n` +
      `Run: kodo config --map-project\n`);
  return 1;   // fail-fast usage error BEFORE any POST (RESEARCH Pitfall 2/3)
}
const projectPath = typeof entry === 'string' ? entry : (entry.default ?? '');
if (!projectPath) { err(`Project "${projectId}" mapped but no default path.\n`); return 1; }
```

**Exit-code mapping from the discriminant** (D-02 / Opción A — exhaustive switch; the contract dashboard/orchestrator consume):
```javascript
function exitCodeFor(result) {
  if (result.ok) return 0;                       // task created + row seeded
  switch (result.code) {
    case 'ALREADY_ADOPTED': return 0;            // idempotent no-op, NOT a failure (D-02)
    case 'INVALID_INPUT':   return 1;
    case 'UNSUPPORTED':     return 1;
    case 'PERSIST_FAILED':  return 1;            // orphan, LOUD, recoverable (NOT transient)
    case 'CREATE_FAILED':   return 2;            // POST failed — transient, retryable (mirror gsd-verify exit 2)
    default:                return 1;            // defensive
  }
}
```
The actual discriminant codes are verified in `src/adopt.js:135-140`: `ok:true` + 5 error codes `UNSUPPORTED` / `INVALID_INPUT` / `ALREADY_ADOPTED` / `CREATE_FAILED` / `PERSIST_FAILED`. **Six shapes, five error codes** — do NOT add a 6th case (RESEARCH Pitfall 1).

**renderHuman with color-by-severity** (mirror `gsd-verify.js:106-165` — exhaustive switch, semantic color via `fmt`; the `--json` branch bypasses this entirely):
```javascript
function renderHuman(result, write, err, fmt) {
  if (result.ok) {
    const { task, session } = result;
    write(`${fmt.ok('Adopted')}\n`);                          // fmt.ok = ✓ + green (format.js:165)
    write(`  task_id:    ${fmt.green(task.id)}\n`);
    write(`  task_url:   ${task.url}\n`);
    write(`  session_id: ${session.session_id}\n`);
    return;
  }
  switch (result.code) {
    case 'ALREADY_ADOPTED':
      write(`Already adopted (no-op). Existing task: ${result.detail.task_id}\n`); return;
    case 'PERSIST_FAILED':                                    // LOUD on stderr (Pitfall 4 / Phase 53 D-03)
      err(`${fmt.red('PERSIST_FAILED')} — provider task created but local write failed.\n`);
      err(`  task_id:  ${result.detail.task_id}\n`);
      err(`  task_url: ${result.detail.task_url}\n`);
      err(`  hint:     ${result.detail.hint}\n`); return;
    case 'CREATE_FAILED':
      err(`${fmt.yellow('CREATE_FAILED')} (transient): ${result.detail.message}\n`); return;
    case 'INVALID_INPUT':
      err(`${fmt.red('INVALID_INPUT')}: missing ${result.detail.missing.join(', ')}\n`); return;
    case 'UNSUPPORTED':
      err(`${fmt.red('UNSUPPORTED')}: provider "${result.detail.providerName}" cannot create tasks.\n`); return;
  }
}
```
**Color semantics (mirror gsd-verify D-14):** success/`task_id` = `fmt.green` / `fmt.ok`; `CREATE_FAILED` transient = `fmt.yellow`; `INVALID_INPUT`/`UNSUPPORTED`/`PERSIST_FAILED` = `fmt.red`. PERSIST_FAILED detail goes to **`err` (stderr)**, everything else success→stdout. Exact message text is Claude's Discretion (CONTEXT §Claude's Discretion) — keep ES operator messages per codebase convention.

---

### `src/cli.js` (MODIFIED — command registration, request-response)

**Analog:** the `gsd verify` block at `src/cli.js:331-345` (commander `.command`/`.option`/`.action`, `ensureConfig()` guard, lazy import, `process.exit(code)`, try/catch→exit 1). Note: `gsd verify` is nested under `gsd`; `adopt` is **top-level** (`program.command('adopt')`, D-04 / RESEARCH A1 — adoption lives at `src/adopt.js`, not `src/gsd/`).

**Command block** (clone `cli.js:331-345`, adapt to top-level + the adopt flag set):
```javascript
program
  .command('adopt')
  .description('Adopt an ad-hoc session into a persistent task (deterministic, 0-token)')
  .requiredOption('--workspace <ref>', 'Workspace reference of the live session')
  .requiredOption('--cwd <path>', 'Working directory of the session')
  .requiredOption('--session-id <id>', 'Claude Code session id')
  .requiredOption('--project <id>', 'Target project id (must be mapped in kodo config)')
  .option('--title <t>', 'Task title (default: basename(cwd), applied by the core)')
  .option('--description <d>', 'Task description (optional)')
  .option('--json', 'Emit the discriminant as JSON (scriptable, byte-deterministic)')
  .action(async (opts) => {
    try {
      await ensureConfig();                              // provider needed → guard (mirror cli.js:337)
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
**commander note (HIGH):** `--session-id` → `opts.sessionId` (commander auto-camelCases). `.requiredOption()` makes commander exit 1 before `.action` if a required flag is absent — a clean usage error layered over the core's `INVALID_INPUT` backstop (RESEARCH Pattern 4, A4 recommends `.requiredOption()` for the 4 required flags).

---

### `test/adopt-cli.test.js` (NEW — DI-stubbed unit tests, request-response)

**Analog:** `test/gsd-verify-cli-handler.test.js` (read in full). Clone the harness: `makeStdoutStub()` (lines 25-33), inline result builders (mirror `passResult()`/`failResult()` lines 39-114), `describe`/`it` exit-code blocks, the `--json` parse-vs-throw pair (C8/C9 lines 278-308), the color-ANSI assertions with an injected TTY formatter (CLR1-5 lines 419-501), and the static CLI-wiring block reading `src/cli.js` (CLI1-4 lines 657-684).

**Harness (clone `gsd-verify-cli-handler.test.js:17-33`):**
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runAdoptCli } from '../src/cli/adopt.js';
function makeStdoutStub() { let buf=''; return { write:(s)=>{buf+=s;}, get:()=>buf }; }
```

**Representative exit-code test (mirror C1/C7 lines 117-132, 213-227):**
```javascript
it('ok:true → exit 0 + task_id/task_url/session_id', async () => {
  const out = makeStdoutStub();
  const code = await runAdoptCli(
    { workspaceRef:'W', cwd:'C', sessionId:'S', projectId:'P' },
    { adoptSessionFn: async () => ({ ok:true, task:{ id:'T-1', url:'https://x/T-1' }, session:{ session_id:'S' } }),
      getProviderFn: () => ({ createTask: () => {} }),          // stub provider resolution
      loadProjectsFn: () => ({ P: '/tmp/proj' }),               // stub projectPath resolution
      writeFn: out.write, errFn: () => {} },
  );
  assert.equal(code, 0);
  assert.match(out.get(), /task_id:\s+T-1/);
});
```

**Required test coverage** (from RESEARCH §Phase Requirements→Test Map, all Wave 0):
- All 6 discriminant shapes → exit codes: `ok:true`→0, `ALREADY_ADOPTED`→0, `INVALID_INPUT`→1, `UNSUPPORTED`→1, `PERSIST_FAILED`→1, `CREATE_FAILED`→2.
- Success render shows `task_id`+`task_url`+`session_id`; `PERSIST_FAILED` LOUD on **stderr** (assert via `errFn` stub).
- `--json` byte-deterministic = `JSON.stringify(result,null,2)`, no ANSI even with an injected TTY formatter (mirror JSON1 lines 591-609).
- Unmapped `--project` → exit 1 + available-projects list, **NO POST** (inject `loadProjectsFn` returning `{}`; assert `adoptSessionFn` never called — mirror the call-count pattern C12 lines 393-411).
- Static CLI-wiring: `src/cli.js` includes `.command('adopt')`, `import('./cli/adopt.js')`, `runAdoptCli` (mirror CLI1-3 lines 660-676 — `readFileSync('src/cli.js')` + `includes`).

**DI note:** result builders return plain discriminant objects inline (mirror gsd-verify's `passResult()`/`failResult()`); no shared fixtures needed.

---

### `test/format-isolation.test.js` (MODIFIED — static invariant)

**Analog:** the `PHASE_15_CALLSITES` frozen array at lines 133-139.

**Edit (additive, one line):** add `'src/cli/adopt.js'` to the `PHASE_15_CALLSITES` array. This locks the new surface under both assertions: positive (imports `format.js`, lines 141-163) and negative (does NOT import `picocolors`, lines 165-180). The relative-import regex `/(\.\.?\/)+(cli\/)?format\.js$/` (line 152) already matches `./format.js` from `src/cli/adopt.js`, so no regex change is needed.

```javascript
const PHASE_15_CALLSITES = Object.freeze([
  'src/logger.js',
  'src/logs/reader.js',
  'src/check.js',
  'src/cli/gsd-inspect.js',
  'src/cli/gsd-verify.js',
  'src/cli/adopt.js',          // ADD — Phase 54 new callsite
]);
```

## Shared Patterns

### Color isolation (single source of color)
**Source:** `src/cli/format.js` `createFormatter` (line 114); helpers `green`/`yellow`/`red`/`ok`/`fail` (lines 165-173).
**Apply to:** `src/cli/adopt.js` (the only new color callsite).
**Invariant:** import `createFormatter` from `./format.js`; never `picocolors`. `useColor=false` (non-TTY / `NO_COLOR`) → all helpers return ANSI-free input (the basis of `--json` determinism). Enforced by `test/format-isolation.test.js` once the callsite is registered.

### DI with `*Fn` defaults
**Source:** `src/cli/gsd-verify.js:57-64` (`writeFn`/`errFn`/`runVerifyFn`/`formatterFn`); `src/cli/gsd-inspect.js:58-65` (`getProviderFn` DI).
**Apply to:** `src/cli/adopt.js` and `test/adopt-cli.test.js`.
**Pattern:** `const x = deps.xFn || realX;` — formatter resolved lazily to avoid touching `process.stdout` at import. Tests inject stubs → no real I/O (`state.json`, registry, `process.stdout`, network).

### `--json` byte-determinism
**Source:** `src/cli/gsd-verify.js:80` (`write(JSON.stringify(result, null, 2) + '\n')`).
**Apply to:** `src/cli/adopt.js`.
**Invariant:** emit the discriminant `result` **exactly as `adoptSession` returns it** — no reshape, no reorder, no color, bypass `renderHuman` entirely. Single source of truth = the core's shape.

### Command registration (commander)
**Source:** `src/cli.js:331-345` (`gsd verify`) and `:209-246` (`launch`, for the registry/`loadConfig` resolution inside `.action`).
**Apply to:** `src/cli.js` adopt block.
**Pattern:** `.command()` + options + `.action(async (opts) => { try { await ensureConfig(); const {fn}=await import(...); process.exit(await fn(...)); } catch (err) { console.error(...); process.exit(1); } })`.

### Project-path resolution error semantics (mirror, do NOT call)
**Source:** `src/session/manager.js:78-103` (`resolveProjectPath` canonical "No local path mapped" message + `kodo config --map-project` hint).
**Apply to:** the `src/cli/adopt.js` pre-flight projectId→path resolution.
**Note:** `resolveProjectPath(task, projects)` takes a `task` that does not exist at CLI time — mirror its **error message shape**, but key directly on `--project` and resolve only the flat/`default` path (no module derivation; RESEARCH Pitfall 2, A3).

## No Analog Found

None. Every file in this phase has an exact template in the codebase. The phase is pure wiring over the just-shipped Phase 53 core.

## Metadata

**Analog search scope:** `src/cli/` (handlers), `src/cli.js` (registration), `src/adopt.js` (core), `src/providers/registry.js`, `src/config.js`, `src/session/manager.js`, `src/cli/format.js`, `test/` (handler + isolation tests).
**Files scanned:** 9 source/test files read this session (full or targeted ranges).
**Pattern extraction date:** 2026-06-16
**Discriminant verified:** `src/adopt.js:135-140` — 5 error codes + `ok:true` (6 shapes). The brief/CONTEXT "6 states" wording counts `ok:true` as a state.
