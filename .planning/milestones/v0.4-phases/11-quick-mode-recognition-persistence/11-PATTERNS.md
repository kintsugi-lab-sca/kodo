# Phase 11: Quick Mode Recognition & Persistence — Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 4 source files (1 helper add, 2 in-place modifications, 1 helper signature extension)
**Analogs found:** 4 / 4 (all in-file siblings — no cross-module hunting needed)

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/labels.js` (add `getSessionMode`) | utility (pure) | transform | `src/labels.js` `getGsdMode` (lines 40-58) | exact (same file, sibling) |
| `src/session/manager.js:43` (extend spread) | service / session-builder | transform | `src/session/manager.js:43,47-48` (in-file siblings) | exact |
| `src/session/manager.js:262` (skip-perms) | service / command-builder | transform | `src/session/manager.js:262` (current literal) + `src/triggers/dispatcher.js:74` (helper consumer) | exact (helper-consumer pattern from sibling module) |
| `src/triggers/dispatcher.js:147+` (telemetry) | controller / event-emitter | event-driven | `src/triggers/dispatcher.js:210-222` (existing `gsdPhaseResolved` + `gsd.bootstrap` callsites) | exact |
| `src/logger-events.js` (extend `gsdPhaseResolved`) | utility / typed-emitter | transform | `src/logger-events.js:117-124` `stateTransition` and `:130-139` `orchestratorReview` | exact |

All five touch-points have exact in-file or in-module analogs. **No need to import patterns from RESEARCH.md** (research was skipped — polish interno).

---

## Pattern Assignments

### 1. `src/labels.js` — add `getSessionMode(session)` (D-09, D-10)

**Role:** pure utility, label/state taxonomy
**Data Flow:** transform (Session record → `'full' | 'quick' | null`)
**Analog:** `getGsdMode(flags)` in same file, lines 40-58

#### Header pattern (file-level convention)

`src/labels.js:1`:

```javascript
// @ts-check
```

No imports. File is pure. New helper goes below `getGsdMode`, keeping export order stable.

#### JSDoc + helper shape — copy verbatim from `getGsdMode`

`src/labels.js:40-58`:

```javascript
/**
 * Returns the GSD execution mode encoded in a flags array.
 * Centralized here so dispatcher, manager, hooks and tests share one definition.
 *
 *   kodo:gsd-quick → 'quick'
 *   kodo:gsd       → 'full'
 *   neither        → null
 *
 * `kodo:gsd-quick` wins if both labels are present (more specific intent).
 *
 * @param {string[]} flags
 * @returns {'full'|'quick'|null}
 */
export function getGsdMode(flags) {
  if (!Array.isArray(flags)) return null;
  if (flags.includes('gsd-quick')) return 'quick';
  if (flags.includes('gsd')) return 'full';
  return null;
}
```

**Adapt for `getSessionMode`:**
- Same JSDoc structure: 1-line summary, blank line, rule table, blank, edge-case sentence, blank, `@param`, `@returns`.
- **Critical D-08 rule to document:** `gsd_mode` ausente con `gsd:true` → `'full'` (legacy preservation). Mention "v0.4 Phase 11" in the JSDoc so reviewers can trace context.
- **Document the locality matiz from `<specifics>`:** the helper lives in `labels.js` (not `state.js`) because the regla "legacy gsd:true == full" es semánticamente parte de la taxonomía de labels.
- **Defensive shape (mirror `getGsdMode` line 54):** `if (!session?.gsd) return null;` — defends against `null`/`undefined`/missing-field, same way `getGsdMode` defends with `!Array.isArray(flags)`.
- **Body** (per D-09): `if (!session?.gsd) return null; return session.gsd_mode || 'full';`
- **Param type:** reference the typedef from state.js: `@param {import('./session/state.js').Session | null | undefined} session`.

---

### 2. `src/session/manager.js:43` — extend conditional spread to include `gsd_mode` (D-03, D-04)

**Role:** session-record builder, pure transform
**Data Flow:** CRUD-like (input params → Session record)
**Analog:** in-file siblings at lines 43, 47, 48 (Phase 8 + Phase 9 conditional spreads)

#### Existing conditional-spread pattern (canonical)

`src/session/manager.js:41-49`:

```javascript
    // D-12: GSD flag propagated from labels through dispatcher → launchWorkItem.
    // Field is omitted entirely when flags do not include 'gsd' (treated as falsy/non-GSD).
    ...(flags?.includes('gsd') ? { gsd: true } : {}),
    // Phase 9: phase_id and brief threaded from dispatcher after resolvePhase().
    // Both optional — only present on GSD sessions where the resolver produced
    // `action: 'phase'` (phaseId) or `action: 'bootstrap'` (brief). Never both.
    ...(phaseId ? { phase_id: phaseId } : {}),
    ...(brief ? { brief } : {}),
```

#### Required transformation per D-04

The new spread MUST persist `gsd:true` AND `gsd_mode` together as a single atomic decision keyed on `gsdMode`. This collapses the existing line 43 with the new field. Per D-04 wording: "Forma del spread: `...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {})`".

**Pattern to write (replaces line 43):**

```javascript
    // Phase 11 (D-03/D-04): GSD mode derived locally from flags via getGsdMode.
    // When set, gsd_mode is ALWAYS persisted alongside gsd:true (no missing-mode
    // shape post-v0.4). Legacy sessions with gsd:true and no gsd_mode are read
    // as 'full' by getSessionMode (D-08). 'kodo:gsd-quick' wins over 'kodo:gsd'.
    ...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {}),
```

#### Import-extension pattern

`src/session/manager.js:5` (current):

```javascript
import { parseKodoLabels } from '../labels.js';
```

**Adapt to** (mirror `src/triggers/dispatcher.js:5` which already imports both):

```javascript
import { parseKodoLabels, getGsdMode } from '../labels.js';
```

#### `gsdMode` derivation (where to call `getGsdMode`)

Per D-03, the firma of `buildSessionFromTask` does NOT grow — `gsdMode` is derived **locally inside the function body**, before the return:

```javascript
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags, phaseId, brief }) {
  const gsdMode = getGsdMode(flags);  // local derivation; flags is the single source of truth
  return {
    // ...
    ...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {}),
    // ...
  };
}
```

Note: this **replaces** the existing `flags?.includes('gsd')` check on line 43. Both branches are functionally equivalent for `'gsd'` and `'gsd-quick'` (both produce `gsd:true`), but the new form covers `kodo:gsd-quick` correctly.

---

### 3. `src/session/manager.js:262` — refactor `skipPerms` to use `getGsdMode` (D-01, D-02)

**Role:** command-line builder, pure
**Data Flow:** transform (flags → CLI args)
**Analog:** `src/triggers/dispatcher.js:74` — same pattern of "derive boolean from flags via helper"

#### Current literal (to replace)

`src/session/manager.js:259-263`:

```javascript
  // GSD sessions run `/gsd-execute-phase` autonomously; pedir confirmación
  // por cada tool call rompe la automatización. Por diseño, kodo:gsd implica
  // skip-permissions tal y como hace kodo:yolo explícito.
  const skipPerms = kodoFlags.includes('yolo') || kodoFlags.includes('gsd');
  const cliFlags = skipPerms ? '--dangerously-skip-permissions' : '';
```

#### Helper-consumer analog from dispatcher

`src/triggers/dispatcher.js:70-74`:

```javascript
  // GSD execution mode (full|quick|null). 'kodo:gsd-quick' takes precedence
  // over 'kodo:gsd' if both labels are present (more specific intent).
  // Both modes share lock + bootstrap paths; only the prompt and phase
  // resolution semantics diverge.
  const gsdMode = getGsdMode(kodoConfig.flags);
```

#### Required transformation per D-01, D-02

```javascript
  // Las sesiones GSD (full y quick) corren slash commands autónomos; pedir
  // confirmación por tool call rompe la automatización. Cualquier modo GSD
  // implica skip-permissions, igual que kodo:yolo explícito. Un solo punto
  // de cambio: añadir un nuevo modo a getGsdMode() basta.
  const skipPerms = kodoFlags.includes('yolo') || getGsdMode(kodoFlags) !== null;
  const cliFlags = skipPerms ? '--dangerously-skip-permissions' : '';
```

**Order-preserve invariant** (from `<specifics>`): `yolo` first (intención explícita), `getGsdMode` second (intención implícita). The `||` short-circuit makes both work and keeps human trace readable.

**Import:** `getGsdMode` is already added in change #2 above — no additional import.

---

### 4. `src/triggers/dispatcher.js:147+` — extend telemetry payloads with `mode` (D-05, D-06, D-07)

**Role:** event emitter, dispatcher control flow
**Data Flow:** event-driven (NDJSON via logger)
**Analog:** existing emits in same file at lines 185-191 (warn no-match), 210-214 (`gsdPhaseResolved`), 217-221 (`gsd.bootstrap`)

#### A. `gsd.phase.resolved` success branch — extend with `mode`

`src/triggers/dispatcher.js:210-214`:

```javascript
      if (resolverVerdict.action === 'phase') {
        gsdPhaseResolved(log, {
          phase_id: resolverVerdict.phase_id,
          match_heading: resolverVerdict.match_heading,
        });
      }
```

**Adapt to (D-05):**

```javascript
      if (resolverVerdict.action === 'phase') {
        // D-05: emit phase_id + match_heading even in quick (forensic — operator
        // can see "resolver matched phase X but session is phase-agnostic").
        // Session record itself drops phase_id when gsdMode === 'quick'.
        gsdPhaseResolved(log, {
          phase_id: resolverVerdict.phase_id,
          match_heading: resolverVerdict.match_heading,
          mode: gsdMode,  // 'full' | 'quick' — never null in this branch (guarded by gsdMode &&)
        });
      }
```

#### B. `gsd.bootstrap` — extend with `mode`

`src/triggers/dispatcher.js:215-222`:

```javascript
      } else if (resolverVerdict.action === 'bootstrap') {
        // Include brief_empty flag per D-12 for operator visibility.
        log.info('gsd.bootstrap', {
          event: 'gsd.bootstrap',
          project_path: gsdProjectPath,
          brief_empty: isBriefEmpty(task),
        });
      }
```

**Adapt to (D-07):**

```javascript
      } else if (resolverVerdict.action === 'bootstrap') {
        // D-07: mode in payload — homogeneous schema for kodo logs --event-type filtering.
        log.info('gsd.bootstrap', {
          event: 'gsd.bootstrap',
          project_path: gsdProjectPath,
          brief_empty: isBriefEmpty(task),
          mode: gsdMode,  // 'full' | 'quick'
        });
      }
```

**Carry-forward note (D-14 Phase 9):** the `gsd.bootstrap` literal stays inline; planner may decide whether to lift it into `logger-events.js` `gsdBootstrap` helper. The CONTEXT.md `<canonical_refs>` says "evaluar si moverlo al taxonomy file" — defer to plans.

#### C. `quick + no-match` — new `info` emit (D-06)

Currently the resolver's `error` branch with `gsdMode === 'quick' && code === 'no-match'` falls through with `break` (no telemetry). Per D-06 it MUST emit `gsd.phase.resolved` at `info` level with `matched: false`.

`src/triggers/dispatcher.js:165-171` (current `error` branch start):

```javascript
      case 'error':
        // Quick mode tolerates 'no-match' — `/gsd-quick` is meant for one-off
        // tasks not necessarily tied to a ROADMAP phase. roadmap-missing and
        // multi-match are still data-quality errors that fail closed.
        if (gsdMode === 'quick' && resolverVerdict.code === 'no-match') {
          break;
        }
```

**Analog for the new emit** — copy the warn-emit shape from lines 178-194 of the same file (failure path), but downgrade level to `info` and switch the field set:

`src/triggers/dispatcher.js:178-194` (existing fail-closed warn emit — analog for the new info emit):

```javascript
        // D-14: emit gsd.phase.resolved with matched:false for forensic logging.
        try {
          const { createLogger } = await import('../logger.js');
          const log = createLogger({
            sessionId: gsdSessionId || 'dispatch',
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'dispatcher', task_id: task.id });
          log.warn('gsd.phase.resolved', {
            event: 'gsd.phase.resolved',
            matched: false,
            error_code: resolverVerdict.code,
            detail: resolverVerdict.detail,
            task_ref: task.ref,
          });
        } catch {
          // silent — never block the return on logger failure
        }
```

**Adapt for quick + no-match (insert BEFORE `break` on line 170):**

```javascript
        if (gsdMode === 'quick' && resolverVerdict.code === 'no-match') {
          // D-06: quick + no-match is tolerated, not silent. Emit info-level
          // gsd.phase.resolved {matched:false, code:'no-match', tolerated:true,
          // mode:'quick'} for forensic reconstruction by `kodo logs --session-of`.
          // Dispatcher remains the single source of gsd.phase.resolved (D-14
          // Phase 9 invariant preserved).
          try {
            const { createLogger } = await import('../logger.js');
            const log = createLogger({
              sessionId: gsdSessionId || 'dispatch',
              minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
            }).child({ component: 'dispatcher', task_id: task.id });
            log.info('gsd.phase.resolved', {
              event: 'gsd.phase.resolved',
              matched: false,
              code: 'no-match',
              tolerated: true,
              mode: 'quick',
              task_ref: task.ref,
            });
          } catch {
            // silent — never block dispatch on logger failure
          }
          break;
        }
```

**Note:** the existing fail-closed warn emit on lines 185-191 also uses `error_code` field name, NOT `code`. D-06 explicitly specifies `code: 'no-match'` (not `error_code`) for the info emit, plus a `tolerated: true` flag. Planner should consider whether to reconcile field naming or keep them divergent (the warn means "fail-closed", the info means "tolerated").

#### D. Forensic warn emit (existing) — also extend with `mode`?

The existing warn emit at lines 185-191 fires for `roadmap-missing` and `multi-match` (fail-closed). D-05 says "match exitoso (cualquier modo)" gets `mode`, and D-07 says `gsd.bootstrap` does. The fail-closed warn is **not explicitly addressed** by D-05/D-06/D-07.

**Pragmatic recommendation for planner:** Since `gsdMode` is in scope and the schema homogeneity (D-07: "todos los eventos GSD emitidos por el dispatcher distinguen el modo") implies adding `mode: gsdMode` here too. Cheap, consistent, and future-proofs `kodo logs --event-type gsd.phase.resolved --json` filters. Flag this as an open decision in the plan.

---

### 5. `src/logger-events.js` — extend `gsdPhaseResolved` signature with `mode` (D-05)

**Role:** typed event emitter, taxonomy authority
**Data Flow:** transform (fields → NDJSON record)
**Analog:** sibling helpers `stateTransition` (lines 117-124) and `orchestratorReview` (lines 130-139) in same file

#### Current helper

`src/logger-events.js:141-151`:

```javascript
/**
 * @param {Logger} logger
 * @param {{ phase_id: string, match_heading: string }} fields
 */
export function gsdPhaseResolved(logger, fields) {
  logger.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    phase_id: fields.phase_id,
    match_heading: fields.match_heading,
  });
}
```

#### Sibling JSDoc shape — copy from `stateTransition` (lines 113-124)

```javascript
/**
 * @param {Logger} logger
 * @param {{ from: string, to: string, reason: string }} fields
 */
export function stateTransition(logger, fields) {
  logger.info(EVENTS.STATE_TRANSITION, {
    event: EVENTS.STATE_TRANSITION,
    from: fields.from,
    to: fields.to,
    reason: fields.reason,
  });
}
```

**Pattern characteristics:**
- One-line `@param {Logger} logger`.
- Inline object type for `fields` — no separate typedef.
- Body: `logger.info(EVENTS.X, { event: EVENTS.X, ...spread fields })`.

#### Required transformation per D-05

```javascript
/**
 * Emite el evento `gsd.phase.resolved` (success branch, matched:true).
 * Phase 11 (D-05): añade campo `mode` para distinguir 'full' vs 'quick'.
 * El dispatcher es la única fuente de este evento (D-14 Phase 9).
 *
 * @param {Logger} logger
 * @param {{ phase_id: string, match_heading: string, mode: 'full'|'quick' }} fields
 */
export function gsdPhaseResolved(logger, fields) {
  logger.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    phase_id: fields.phase_id,
    match_heading: fields.match_heading,
    mode: fields.mode,
  });
}
```

**Test impact:** `test/logger-events.test.js` constructs the helper with literal fixtures. The new `mode` field is required (not optional) per D-05 — existing tests will need updating in Phase 13 (deferred). For Phase 11 the planner should keep the current test still passing OR mark it for QUICK-08 update.

#### Open evaluation per CONTEXT.md `<canonical_refs>`

> El helper `gsd.bootstrap` actualmente es untyped (literal en dispatcher) — evaluar si moverlo al taxonomy file.

**Pattern if planner decides to lift:** mirror sibling `gsdBootstrap` helper at `src/logger-events.js:153-162` which already exists but is currently *unused* by dispatcher (dispatcher emits `log.info('gsd.bootstrap', {...})` literally instead of calling `gsdBootstrap(log, ...)`). To complete the taxonomy migration:

`src/logger-events.js:153-162` (existing unused helper):

```javascript
/**
 * @param {Logger} logger
 * @param {{ project_path: string }} fields
 */
export function gsdBootstrap(logger, fields) {
  logger.info(EVENTS.GSD_BOOTSTRAP, {
    event: EVENTS.GSD_BOOTSTRAP,
    project_path: fields.project_path,
  });
}
```

**Adapt to** (extend with `brief_empty` from current literal + `mode` per D-07):

```javascript
/**
 * @param {Logger} logger
 * @param {{ project_path: string, brief_empty: boolean, mode: 'full'|'quick' }} fields
 */
export function gsdBootstrap(logger, fields) {
  logger.info(EVENTS.GSD_BOOTSTRAP, {
    event: EVENTS.GSD_BOOTSTRAP,
    project_path: fields.project_path,
    brief_empty: fields.brief_empty,
    mode: fields.mode,
  });
}
```

And then dispatcher line 217 becomes `gsdBootstrap(log, {...})` instead of `log.info('gsd.bootstrap', {...})`. Pattern parallels `gsdPhaseResolved` consumer site.

**Decision deferred to planner:** lift now (smaller diff to Phase 12 hooks if they consume it) vs. keep literal (smaller Phase 11 diff). The pattern is the same either way.

---

## Shared Patterns

### A. `// @ts-check` + JSDoc-only typing

**Source:** all files (`src/labels.js:1`, `src/session/manager.js:1`, `src/triggers/dispatcher.js:1`, `src/logger-events.js:1`)
**Apply to:** all touch-points
**Pattern:** every file starts with `// @ts-check`. Types live in JSDoc, not TypeScript syntax.

```javascript
// @ts-check
```

### B. Helper-in-labels.js + consumer-derives-locally

**Source:** D-12 Phase 8 + D-03 Phase 11
**Apply to:** `getSessionMode` (Phase 11) and consumers in Phase 12 (deferred).
**Pattern:** function exports a rule once; consumers import and call locally rather than threading derived values through call signatures. Trade µs CPU for signature stability.

`src/triggers/dispatcher.js:74`:

```javascript
const gsdMode = getGsdMode(kodoConfig.flags);
```

### C. Conditional spread to keep JSON clean

**Source:** Phase 8 (`gsd:true`) + Phase 9 (`phase_id`, `brief`)
**Apply to:** new `gsd_mode` persistence (Phase 11) and any future optional Session field.
**Pattern:** `...(condition ? { field: value } : {})` — omit field entirely when falsy so `state.json` doesn't carry `field: undefined`.

`src/session/manager.js:43,47-48`:

```javascript
...(flags?.includes('gsd') ? { gsd: true } : {}),
...(phaseId ? { phase_id: phaseId } : {}),
...(brief ? { brief } : {}),
```

### D. Dispatcher = unique source of GSD events

**Source:** D-14 Phase 9
**Apply to:** all new emits in dispatcher (success match, no-match, bootstrap).
**Invariant:** no other module emits `gsd.phase.resolved` or `gsd.bootstrap`. Phase 11 D-06 explicitly preserves this — the new `info` log for `quick + no-match` is also dispatcher-emitted.

### E. Try/catch wrap on logger imports for forensic emits

**Source:** `src/triggers/dispatcher.js:179-194` (existing forensic warn)
**Apply to:** new `quick + no-match` info emit (D-06).
**Pattern:** dynamic import of logger inside try, silent catch — never block dispatch return on logger failure.

```javascript
try {
  const { createLogger } = await import('../logger.js');
  const log = createLogger({
    sessionId: gsdSessionId || 'dispatch',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dispatcher', task_id: task.id });
  log.X('gsd.phase.resolved', { ... });
} catch {
  // silent — never block dispatch on logger failure
}
```

### F. JSDoc style for typed-emitter helpers

**Source:** `src/logger-events.js:113-124` (`stateTransition`), `:141-151` (`gsdPhaseResolved`)
**Apply to:** extending `gsdPhaseResolved`, optionally extending `gsdBootstrap`.
**Pattern:** inline object type in `@param` (no separate typedef), helper body always `logger.info(EVENTS.X, { event: EVENTS.X, ...fields })`.

### G. Defensive nullish-coalescing on inputs

**Source:** `src/labels.js:54` `getGsdMode`: `if (!Array.isArray(flags)) return null;`
**Apply to:** `getSessionMode`: `if (!session?.gsd) return null;`
**Pattern:** at least one `!`-check at the top defending against `null`/`undefined`/missing-field; never throw on bad input.

---

## No Analog Found

None. All five touch-points have exact in-file or in-module analogs. This is a polish-internal phase (per PROJECT.md "polish interno sin nueva tecnología"), so deep search outside the GSD subsystem was unnecessary.

---

## Test Pattern (advisory — Phase 13 deferred)

**Source:** `test/labels.test.js:1-4` (existing test file, will host `getGsdMode` and `getSessionMode` cases per D-10).

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseKodoLabels } from '../src/labels.js';
```

**Pattern characteristics:**
- `node:test` + `node:assert/strict` (no Jest, no Mocha).
- `describe` per export, `it` per behavioral case.
- Plain object literals for fixtures, no factories for simple cases.
- Phase 13 will add `describe('getSessionMode', ...)` covering the 4 states from D-10:
  - `gsd:true` no `gsd_mode` → `'full'` (legacy)
  - `gsd:true, gsd_mode:'full'` → `'full'`
  - `gsd:true, gsd_mode:'quick'` → `'quick'`
  - no `gsd` field → `null`
- Plus null/undefined session input.

Phase 11 itself does NOT add tests (deferred to Phase 13 QUICK-08), but the helper MUST be unit-testable in isolation — which it is, since it has zero side effects and zero imports.

---

## Metadata

**Analog search scope:** `src/labels.js`, `src/session/manager.js`, `src/triggers/dispatcher.js`, `src/logger-events.js`, `src/session/state.js`, `test/labels.test.js`, `test/manager.test.js`, `test/logger-events.test.js`.
**Files scanned:** 8.
**Pattern extraction date:** 2026-04-28.
**No RESEARCH.md:** intentional per PROJECT.md (v0.4 polish interno).
