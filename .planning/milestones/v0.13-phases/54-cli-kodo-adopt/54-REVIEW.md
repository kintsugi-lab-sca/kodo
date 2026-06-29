---
phase: 54-cli-kodo-adopt
reviewed: 2026-06-16T15:20:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/cli/adopt.js
  - src/cli.js
  - test/adopt-cli.test.js
  - test/format-isolation.test.js
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 54: Code Review Report

**Reviewed:** 2026-06-16T15:20:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

Reviewed the `kodo adopt` CLI surface: the thin handler `runAdoptCli`
(`src/cli/adopt.js`), its commander registration (`src/cli.js`), and the two
relevant test files. The handler structure is faithful to its stated mirror
(`runGsdVerifyCli`): exit-code mapping is correct for all 6 discriminant shapes,
color isolation is intact (color flows only through `createFormatter`; the
format-isolation guard confirms no `picocolors` leak), and no business logic is
duplicated from the Phase 53 core — `title`/`description` are forwarded untouched
and sanitization stays in `adoptSession`. All 13 tests pass.

The dominant defect is a **broken `--json` byte-determinism invariant**: the
`adopt` command in `src/cli.js` calls `ensureConfig()` *before* `runAdoptCli`,
and `ensureConfig()` can emit prose (and even launch a full interactive wizard)
to **stdout** on first run — corrupting the JSON stream the invariant promises to
keep parseable. The handler-level `--json` test (JSON1) does not catch this
because it bypasses `ensureConfig` entirely (it calls `runAdoptCli` directly).

Secondary findings: the `renderHuman` switch is non-exhaustive on an unknown
`code` (silent no-op render while exit code is non-zero), the `providerName`
fallback to `'(injected)'` only fires in the test branch, and a couple of
robustness/parity gaps with the mirror.

## Critical Issues

### CR-01: `ensureConfig()` runs before `runAdoptCli`, breaking `--json` byte-determinism

**File:** `src/cli.js:259-272` (interaction with `ensureConfig`, `src/cli.js:510-523`)
**Issue:**
The `adopt` action calls `await ensureConfig()` *before* invoking `runAdoptCli`.
On a machine with no `~/.kodo/config.json`, `ensureConfig()` prints
`'Primera vez? Vamos a configurar kodo.\n'` and then runs `interactiveConfig()`,
which writes a large amount of human prose to **stdout** (`console.log` of the
provider menu, prompts, "Resumen", etc.). When the operator passed `--json`, the
documented invariant is that stdout is `JSON.stringify(result, null, 2) + '\n'`
and nothing else — a scriptable, byte-deterministic, parseable stream. With an
unconfigured environment, the `--json` consumer instead receives wizard text
followed (maybe) by JSON, so `JSON.parse(stdout)` throws. This is a contract
violation of the stated `--json` invariant, and it is silent: the byte-determinism
test (`JSON1`) calls `runAdoptCli` directly and never exercises `ensureConfig`,
so it cannot catch the regression.

Note this is not purely hypothetical: `gsd verify` / `gsd inspect` have the same
`ensureConfig()` placement, but `adopt` newly advertises `--json` as
"byte-deterministic" in its own option help text (`src/cli.js:258`), so the gap is
contractually load-bearing here.

**Fix:**
Skip the interactive wizard (and any stdout chatter) when `--json` is set —
fail closed with a JSON-or-stderr error instead. For example:

```js
.action(async (opts) => {
  try {
    if (opts.json) {
      // --json must keep stdout parseable: never launch the wizard.
      const { existsSync } = await import('node:fs');
      const { CONFIG_PATH } = await import('./config.js');
      if (!existsSync(CONFIG_PATH)) {
        console.error('Config required. Run `kodo config` first.');
        process.exit(1);
      }
    } else {
      await ensureConfig();
    }
    const { runAdoptCli } = await import('./cli/adopt.js');
    const code = await runAdoptCli({ /* ...opts... */ });
    process.exit(code);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
});
```

Alternatively, route `ensureConfig`'s first-run prose to stderr — but the
fail-closed approach above is safer for a scriptable surface.

## Warnings

### WR-01: `renderHuman` switch is non-exhaustive — unknown `code` renders nothing while exit is non-zero

**File:** `src/cli/adopt.js:189-210`
**Issue:**
`exitCodeFor` has a `default: return 1` branch (line 157-158) that defensively
maps any unrecognized `result.code` to exit 1. But `renderHuman`'s switch has
**no `default` case**: if the core ever returns a 7th shape (or a typo'd code),
the human path writes *nothing at all* to stdout or stderr, yet the process
exits 1. The operator sees a silent non-zero exit with zero diagnostic output —
the opposite of the "LOUD, recuperable" philosophy the file comments espouse.
The two error-mapping surfaces (`exitCodeFor` and `renderHuman`) have drifted:
one is defensive, the other is not.

**Fix:**
Add a `default` arm to the `renderHuman` switch that emits the raw discriminant
to stderr:

```js
default:
  err(`${fmt.red('UNKNOWN')}: unexpected result code "${result.code}".\n`);
  err(`  ${JSON.stringify(result)}\n`);
  return;
```

### WR-02: `ALREADY_ADOPTED` render writes to stdout with no `task_id` guard

**File:** `src/cli/adopt.js:190-191`
**Issue:**
`write(\`Already adopted (no-op). Existing task: ${result.detail.task_id}\n\`)`
dereferences `result.detail.task_id` without verifying `detail` exists. The core
always supplies `detail.task_id` for this shape, so this is not currently a
crash — but the handler advertises itself as a defensive boundary translating a
"never-throws discriminant", and every other branch that touches `detail`
(`PERSIST_FAILED`, `INVALID_INPUT`, `UNSUPPORTED`, `CREATE_FAILED`) has the same
unguarded assumption. If the core's shape ever regresses, the thin handler turns
a never-throws core result into a thrown `TypeError` ("Cannot read properties of
undefined"), which `src/cli.js` catches and reports as a generic `Error:` exit 1
— losing the original discriminant. This couples the handler's robustness to the
core's shape stability across module boundaries.

**Fix:**
This is acceptable as-is if the core contract is treated as frozen, but to honor
the "never-throws translation layer" intent, guard `detail` reads, e.g.
`const taskId = result.detail?.task_id ?? '(unknown)';`. At minimum, document
that `renderHuman` assumes a well-formed `detail` and relies on the cli.js outer
catch as the backstop.

### WR-03: `providerName` fallback `'(injected)'` only applies to the test branch, not production

**File:** `src/cli/adopt.js:81-87`
**Issue:**
In the `getProviderFn` (test) branch, `providerName` falls back to
`'(injected)'` when `loadConfig().provider` is falsy. In the production branch
(line 86-87), `providerName = loadConfig().provider` has **no fallback** — if
config exists but `provider` is unset/empty, `providerName` is `undefined`, and
`getProvider(undefined)` throws `Unknown provider: undefined`
(`src/providers/registry.js:100`). That throw is caught by the cli.js outer
try/catch and surfaces as `Error: Unknown provider: undefined` exit 1. The
behavior is technically safe (no crash escapes), but the error message is
opaque relative to the `UNSUPPORTED` / fail-fast diagnostics the rest of the
handler produces, and the asymmetry between the two branches is a latent
inconsistency. `providerName` also flows into `UNSUPPORTED` rendering
(`result.detail.providerName`), so an `undefined` here would render
`provider "undefined" cannot create tasks` in the unsupported path.

**Fix:**
`ensureConfig()` should guarantee a provider, but defend explicitly so the
diagnostic is actionable:

```js
providerName = (deps.loadConfigFn || loadConfig)().provider;
if (!providerName) {
  err('No provider configured. Run `kodo config`.\n');
  return 1;
}
provider = getProvider(providerName);
```

### WR-04: Empty-string `--workspace` / `--session-id` / `--cwd` bypass commander and reach the core as `INVALID_INPUT` — but `--project` empty is mishandled

**File:** `src/cli/adopt.js:95-109` and `src/cli.js:252-255`
**Issue:**
`--project ""` (explicit empty string) passes commander's `requiredOption` check
(the option is *present*, just empty). In `runAdoptCli`, `projects[""]` is almost
certainly `undefined`, so it hits the "No local path mapped for project """ path
and returns exit 1 — acceptable. But consider `--project` mapping to an entry
whose `default` is an empty string vs. the `entry === undefined` check: the code
distinguishes "unmapped" (line 97) from "mapped but no default path" (line 106).
However, a project mapped to an **empty string** (`{ P: "" }`, e.g. a corrupted
projects.json) takes the `typeof entry === 'string'` branch yielding
`projectPath = ""`, then correctly fails at line 106. Good. The real gap: the
other three required args (`workspaceRef`, `cwd`, `sessionId`) are passed through
with no CLI-level emptiness check and rely entirely on the core's `INVALID_INPUT`
guard — which is fine for byte-determinism but means the rendered error for an
empty `--cwd` is `INVALID_INPUT: missing cwd`, even though the operator *did*
pass `--cwd ""`. The message "missing" is misleading for a present-but-empty arg.

**Fix:**
Low priority. Either accept the core's wording (it is the single source of truth)
or have the core distinguish "missing" from "empty". Do not duplicate validation
in the CLI — that would violate the no-business-logic-in-handler invariant. Flagging
only because the user-facing wording can confuse operators during scripting.

## Info

### IN-01: `loadConfigFn` documented in typedef but the production `providerName` path could share the test fallback

**File:** `src/cli/adopt.js:46-51, 81-87`
**Issue:**
The `loadConfigFn` dep and the `'(injected)'` neutral fallback exist only to
serve the test branch. The duplication of `(deps.loadConfigFn || loadConfig)()`
on both lines 81 and 86 is minor repetition; resolving it once before the
`if (deps.getProviderFn)` split would be marginally cleaner and remove the
branch asymmetry behind WR-03.
**Fix:** Hoist `const cfg = (deps.loadConfigFn || loadConfig)();` above the
branch and reuse `cfg.provider` in both arms.

### IN-02: Comment references line numbers that drift (`cli.js:212-217`, `gsd-verify.js:62-64`, `adopt.js:135-140`)

**File:** `src/cli/adopt.js:27-30, 69, 72, 137-138`
**Issue:**
Several comments hard-code line-number references to other files
("espejo del bloque launch cli.js:212-217", "gsd-verify.js:62-64",
"src/adopt.js:135-140"). These are brittle — any edit to those files silently
makes the references wrong, misleading future maintainers. The repo already has a
habit of this style, so it is consistent, but it is a maintenance liability.
**Fix:** Reference symbol names (`runGsdVerifyCli`, the `launch` action) rather
than line numbers, or drop the line citations.

### IN-03: `--json` failure paths still render the full `detail` including `detail.message` — confirm no secret leak from provider errors

**File:** `src/cli/adopt.js:128-129` and core `src/adopt.js:223,236-246`
**Issue:**
On `CREATE_FAILED` / `PERSIST_FAILED`, the core puts `err?.message` verbatim into
`detail.message`, and `--json` emits the whole `result` object including that
message. Provider client errors (e.g. a 401/403 from Plane) sometimes embed
request URLs or, in pathological clients, tokens/headers in the thrown message.
The CLI faithfully forwards whatever the core produced — so this is a core/provider
concern, not strictly an `src/cli/adopt.js` defect — but since the review brief
calls out "secret-leak in rendered output", note that the CLI provides **no
redaction** on the error path (unlike `title`/`description`, which the core
sanitizes via `redactPaths`). Error `message` strings are NOT run through
`redactPaths`. If a provider client ever includes an absolute path or token in
its error text, both the human and `--json` renderers will print it unredacted.
**Fix:** Out of scope for this thin handler, but worth a follow-up: have the core
run `detail.message` through the same `redactPaths` backstop it already applies to
title/description, since these messages cross the same local→external/stdout
boundary.

---

## Cross-module note (context, not a Phase 54 finding)

The Phase 53 core's idempotency guard calls `findSession({ workspaceRef, cwd })`
(`src/adopt.js:203`), and `findSession` matches `cwd` against
`session.project_path` (`src/session/state.js:375`). But the seeded row persists
`project_path = projectPath`, **not** `cwd` (`buildSessionFromAdoption`,
`src/adopt.js:127`). When the CLI resolves `projectPath` from the project mapping
and it differs from the session's raw `cwd` (the common case — `cwd` is a
subdirectory or worktree, `projectPath` is the mapped repo root), a re-run will
match on `workspaceRef` (still keyed correctly) so idempotency holds via the
workspace key. This is fine *as long as* `workspaceRef` is stable. Flagging for
awareness only — the defect, if any, lives in `src/adopt.js` (Phase 53), which is
out of scope for this review.

---

_Reviewed: 2026-06-16T15:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
