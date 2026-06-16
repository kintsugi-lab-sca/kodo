---
phase: 54-cli-kodo-adopt
plan: 01
subsystem: cli
tags: [cli, adopt, bidirectional, thin-handler, exit-codes, color-isolation]
requires:
  - "src/adopt.js adoptSession (Phase 53 core — 6-shape discriminant)"
  - "src/cli/format.js createFormatter (color isolation single-source)"
  - "src/providers/registry.js initRegistry/getProvider"
  - "src/config.js loadConfig/loadProjects"
provides:
  - "runAdoptCli(opts, deps) — thin CLI handler argv->delegation->render"
  - "kodo adopt CLI command (flag + exit-code contract for Phase 56/57)"
affects:
  - "src/cli.js (new top-level adopt command)"
  - "test/format-isolation.test.js (new callsite under color guard)"
tech-stack:
  added: []
  patterns:
    - "thin CLI handler (argv -> delegation -> render) — clone of runGsdVerifyCli"
    - "DI with *Fn defaults (adoptSessionFn/getProviderFn/loadProjectsFn/writeFn/errFn/formatterFn)"
    - "discriminant -> exit code map (Opcion A, exhaustive switch)"
    - "--json byte-deterministic bypass of renderHuman"
    - "projectPath fail-fast pre-POST (mirror resolveProjectPath error semantics)"
    - "color isolation (createFormatter only, never picocolors)"
key-files:
  created:
    - "src/cli/adopt.js"
    - "test/adopt-cli.test.js"
  modified:
    - "src/cli.js"
    - "test/format-isolation.test.js"
decisions:
  - "CREATE_FAILED -> exit 2 (transient, retryable), mirror gsd-verify exit-2 semantics"
  - "ALREADY_ADOPTED -> exit 0 (idempotent no-op, not a failure) per D-02"
  - "PERSIST_FAILED render goes to stderr (LOUD), not stdout"
  - "--project unmapped fails fast (exit 1 + available projectIds) BEFORE any POST"
  - "title/description passed untouched to the core (sanitization is core's job, BIDIR-08)"
metrics:
  duration: ~12m
  tasks: 3
  files: 4
  completed: "2026-06-16"
requirements_completed: [BIDIR-07]
---

# Phase 54 Plan 01: CLI `kodo adopt` Summary

Thin `kodo adopt` CLI handler (`runAdoptCli`) — the first consumer and contract reference of the deterministic 0-token `adoptSession` plumbing (Phase 53). Structural 1:1 clone of `runGsdVerifyCli`: argv → resolve provider/projectPath → delegate to the core → render → exit code. Closes BIDIR-07 and fixes the flag + exit-code contract that the dashboard key (Phase 56) and orchestrator (Phase 57) will shell via `execFile`.

## What Was Built

- **`src/cli/adopt.js` (NEW)** — `runAdoptCli(opts, deps)`: resolves `provider`/`providerName` (registry, lazy-imported) + `projectPath` (`loadProjects()[projectId]`, fail-fast when unmapped), delegates to `adoptSession`, then renders. `exitCodeFor` maps the 6-shape discriminant to exit codes (exactly 5 error cases — no 6th). `renderHuman` colors by severity and routes `PERSIST_FAILED` to stderr; `--json` byte-deterministically dumps the raw discriminant, bypassing `renderHuman` entirely (no color, no reshape).
- **`src/cli.js` (MODIFIED)** — top-level `program.command('adopt')` (NOT under `gsd`) with `.requiredOption` for `--workspace/--cwd/--session-id/--project`, `.option` for `--title/--description/--json`, `ensureConfig()` guard, lazy `import('./cli/adopt.js')`, `process.exit(code)`, try/catch → exit 1.
- **`test/adopt-cli.test.js` (NEW)** — DI-stubbed handler tests: 6 discriminant shapes → exit codes, success render (task_id/task_url/session_id), PERSIST_FAILED LOUD on stderr, `--json` byte-determinism (no ANSI even with injected TTY formatter), `--project` unmapped fail-fast (asserts `adoptSession` never invoked), and static `src/cli.js` wiring (command('adopt') + import + runAdoptCli).
- **`test/format-isolation.test.js` (MODIFIED)** — added `'src/cli/adopt.js'` to `PHASE_15_CALLSITES`, locking the new callsite under both the positive (imports `format.js`) and negative (no `picocolors` leak) assertions.

## TDD Flow

- **RED** (`6b778bb`): wrote `test/adopt-cli.test.js`; failed because `src/cli/adopt.js` did not exist yet.
- **GREEN** (`7164a6d`): implemented `runAdoptCli` + registered the command; all 13 handler tests pass.
- **Task 3** (`fd29c7e`): registered the callsite in the color-isolation guard; full suite green.

No REFACTOR commit was needed — the GREEN implementation was already minimal and clean.

## Verification

- `node --test test/adopt-cli.test.js` → 13/13 pass.
- `node --test test/format-isolation.test.js` → 8/8 pass.
- `npm test` (full suite) → 1377 pass / 0 fail / 1 skip (pre-existing startup-budget skip, unchanged).
- `grep -c picocolors src/cli/adopt.js` → 0 (imports `createFormatter` from `./format.js`).
- `node bin/kodo adopt --help` → usage renders all flags (--workspace/--cwd/--session-id/--project/--title/--description/--json).
- `exitCodeFor` has exactly 5 error cases (no 6th — Pitfall 1).

### Success Criteria (BIDIR-07)

- **SC1:** `kodo adopt --workspace W --cwd C --session-id S --project P [--title T] [--description D]` creates the task + seeds the row via `adoptSession` with explicit input (verified by the ok:true test + projectPath resolution assertion).
- **SC2:** exit codes derive deterministically from the discriminant (ok/ALREADY_ADOPTED→0, INVALID_INPUT/UNSUPPORTED/PERSIST_FAILED→1, CREATE_FAILED→2).
- **SC3:** success shows task_id + task_url + session_id; failure shows code + detail (PERSIST_FAILED LOUD on stderr); --json byte-deterministic.
- **Color isolation:** `src/cli/adopt.js` imports `format.js`, never `picocolors` (guard green).

## Deviations from Plan

None of Rules 1-4 triggered. One minor adjustment: the plan's Task 2 acceptance criterion required `grep -c picocolors src/cli/adopt.js` to return 0, but an explanatory comment originally contained the bare word "picocolors". Rephrased the comment ("el paquete de color") so the literal grep returns 0 while preserving the intent. This is cosmetic, not a behavior change.

The handler adds `getProviderFn`/`loadConfigFn`/`loadProjectsFn` as injectable deps (as the plan specifies). In the injected-provider test path, `providerName` falls back to `'(injected)'` when no config provider is set, so tests never touch the real registry — consistent with the DI intent.

## Invariants Preserved

- Cero endpoints nuevos (src/server.js untouched).
- 0-token deterministic (no LLM/prompts/cmux in the CLI).
- FROZEN-9 (createTask stays typeof-detected; the UNSUPPORTED core path covers it).
- --json byte-determinism (raw `JSON.stringify(result, null, 2) + '\n'`, no color).
- Color isolation single-source (createFormatter only).

## Known Stubs

None. The handler is fully wired to the Phase 53 core; no placeholder data paths.

## Self-Check: PASSED

- FOUND: src/cli/adopt.js
- FOUND: test/adopt-cli.test.js
- FOUND: commit 6b778bb (RED test)
- FOUND: commit 7164a6d (GREEN handler + command)
- FOUND: commit fd29c7e (color-isolation guard)
