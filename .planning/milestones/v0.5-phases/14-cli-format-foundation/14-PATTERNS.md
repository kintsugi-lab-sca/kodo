# Phase 14: CLI Format Foundation — Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 4 (2 new, 2 modified)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | New/Mod | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|---------|------|-----------|----------------|---------------|
| `src/cli/format.js` | NEW | utility (factory) | transform (string→ANSI), DI-by-descriptor | `src/logger.js` (factory + ANSI) + `src/cli/gsd-inspect.js` (DI by descriptor) | exact (split: factory shape from logger, descriptor DI from gsd-inspect) |
| `test/format-isolation.test.js` | NEW | test (source-hygiene guard) | static graph walk (read-only) | `test/check-isolation.test.js` | exact (verbatim walker) |
| `package.json` | MOD | config | dependency manifest | `package.json` itself (commander entry) | exact (additive sibling under `dependencies`) |
| `.planning/PROJECT.md` | MOD | doc | constraints prose | `.planning/PROJECT.md` §Constraints existing bullets | exact (sibling bullet) |

## Pattern Assignments

### `src/cli/format.js` (utility / factory, transform + DI)

**Two analogs combined**: factory + ANSI conventions from `src/logger.js`; descriptor-injected `writeFn`/`errFn` shape from `src/cli/gsd-inspect.js` and `src/cli/gsd-verify.js`.

#### File header pattern

**Source:** `src/logger.js:1-14` (header comment + `@ts-check` + module docstring describing responsibilities and constraints).

```javascript
// @ts-check
//
// src/logger.js — NDJSON structured logger con pretty-print stderr mirror.
//
// Responsabilidades:
//   1. Factory createLogger({ sessionId, minLevel }) con child bindings (estilo pino).
//   2. Sink NDJSON a ~/.kodo/logs/<session>.ndjson via appendFileSync.
//   ...
//
// Aislamiento del vigilante (LOG-12): src/check.js NO importa este archivo — ver
// test/check-isolation.test.js.
```

**Apply to format.js**: same `// @ts-check` first line, then header citing responsibilities (factory, useColor resolution, helpers, formatRow/formatTable) and the LOG-12 isolation invariant ("este archivo NO importa src/logger.js — ver test/format-isolation.test.js"), plus the picocolors single-source clause ("ÚNICA superficie de color en kodo — ver test/format-isolation.test.js").

#### ANSI / level color reference

**Source:** `src/logger.js:30-42` (canonical ANSI codes per level — must match for visual coherence with `formatLine`).

```javascript
// ANSI escape codes (mismas convenciones que src/check.js).
export const ANSI_RESET = '\x1b[0m';
const ANSI_GRAY = '\x1b[90m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_RED = '\x1b[31m';

export const COLOR_BY_LEVEL = Object.freeze({
  debug: ANSI_GRAY,
  info: ANSI_CYAN,
  warn: ANSI_YELLOW,
  error: ANSI_RED,
});
```

**Apply to format.js**: use **picocolors `createColors(useColor)`** (per CONTEXT D-04 + D-07) instead of inline ANSI literals — but the level→color mapping (`debug=gray, info=cyan, warn=yellow, error=red`) MUST match. The mapping is the contract; the implementation is picocolors.

```javascript
// Inside createFormatter(stream, env)
import { createColors } from 'picocolors';
// ...
const pc = createColors(useColor);  // useColor=false → identity functions
const byLevel = {
  debug: pc.gray,
  info: pc.cyan,
  warn: pc.yellow,
  error: pc.red,
};
```

#### useColor resolution (precedence)

**Source:** `src/logger.js:204` (current pattern — Phase 14 generalizes it).

```javascript
const useColor = Boolean(process.stderr.isTTY) && !process.env.NO_COLOR;
```

**Apply to format.js** (CONTEXT D-02 + D-04 — generalized, eager, descriptor-aware, with FORCE_COLOR support):

```javascript
/**
 * @param {{ isTTY?: boolean }} stream
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
function _resolveUseColor(stream, env = process.env) {
  // NO_COLOR (any value, including '') wins.
  if (env.NO_COLOR != null) return false;
  // FORCE_COLOR='0' explicitly disables; any other set value forces on.
  if (env.FORCE_COLOR != null) return env.FORCE_COLOR !== '0';
  return Boolean(stream.isTTY);
}
```

Eager evaluation (closure-captured) — never re-read inside helpers.

#### Factory shape (return object literal of bound methods)

**Source:** `src/logger.js:213-222` (`makeNode` builds an object with method properties bound to closure state — no `this`).

```javascript
function makeNode(boundFields) {
  /** @type {any} */
  const node = {
    child(extra) { return makeNode({ ...boundFields, ...extra }); },
  };
  for (const name of LEVEL_NAMES) {
    node[name] = (msg, ctx) => emit(name, msg, ctx, boundFields);
  }
  return node;
}
```

**Apply to format.js**: same shape — `createFormatter(stream, env)` returns a plain object literal of methods captured over closure (`useColor`, `pc`). No classes, no `this`. Methods: `debug, info, warn, error` (level chips), `ok, fail` (with `✓`/`✗` embedded), `green, yellow, red, cyan, gray, dim` (raw escape hatches), `formatRow(cells, widths, opts?)`, `formatTable(rows, opts?)`.

#### DI-by-descriptor pattern (writeFn/errFn shape)

**Source:** `src/cli/gsd-inspect.js:50-52` and `src/cli/gsd-verify.js:55-57` (consumer-side: how callers wire descriptors today; format.js mirrors this shape but receives the descriptor itself rather than a write fn).

```javascript
// gsd-inspect.js:50-52
export async function runGsdInspect(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
```

**Apply to format.js**: caller in Phase 15 will do `const fmt = createFormatter(process.stdout)` (or `process.stderr` for gsd-verify, or a fake `{ isTTY: true }` in tests). This is the symmetric pattern: instead of passing `writeFn`, the surface passes the underlying descriptor and lets `format.js` compute `useColor` from it. Tests inject `{ isTTY: true|false }` literals — no `Writable` needed (CONTEXT §specifics line 128).

#### JSDoc `@typedef` pattern for the returned shape

**Source:** `src/logger.js:175-184` (typedef block declaring the public Logger shape next to the factory).

```javascript
/**
 * @typedef {'debug'|'info'|'warn'|'error'} LogLevel
 * @typedef {{ sessionId: string, minLevel?: LogLevel }} LoggerOpts
 * @typedef {{
 *   debug(msg: string, ctx?: object): void,
 *   info(msg: string, ctx?: object): void,
 *   warn(msg: string, ctx?: object): void,
 *   error(msg: string, ctx?: object): void,
 *   child(bindings: object): Logger,
 * }} Logger
 */
```

**Apply to format.js**: declare a `Formatter` typedef next to `createFormatter`, listing all methods with their signatures (string→string for level/sym/colors, `formatRow(cells, widths, opts?)`, `formatTable(rows, opts?)`).

#### `Object.freeze` for exposed read-only constants

**Source:** `src/logger.js:25, 28, 37` (any cross-cutting table is frozen — typo-guard at runtime).

```javascript
export const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
export const LEVEL_NAMES = Object.freeze(['debug', 'info', 'warn', 'error']);
export const COLOR_BY_LEVEL = Object.freeze({ debug: ANSI_GRAY, /* ... */ });
```

**Apply to format.js**: if format.js exports any internal table (e.g., default widths for `kodo logs` columns, default separator), wrap with `Object.freeze`. Symbols `OK_SYMBOL = '✓'` and `FAIL_SYMBOL = '✗'` should be `const` at module top.

#### Internal helper underscore-prefix convention

**Source:** CONTEXT §code_context line 106 explicitly mandates `_resolveUseColor` and `visibleWidth` as test-only re-exports with underscore prefix.

**Apply to format.js**: `export function _resolveUseColor(stream, env)` and `export function visibleWidth(s)` — prefix `_` signals "internal, consumed only by tests; production callers use the factory's returned methods". Matches `noopLogger` re-export style at `src/logger.js:22`.

---

### `test/format-isolation.test.js` (test / source-hygiene guard, static graph walk)

**Analog:** `test/check-isolation.test.js` — verbatim. CONTEXT §Claude's Discretion permits either copying the walker inline or extracting to a shared helper. Default per repo convention: copy verbatim (lower coupling, fewer files; this guard rarely changes).

#### Imports + path setup

**Source:** `test/check-isolation.test.js:1-9`.

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
```

**Apply verbatim to format-isolation.test.js**.

#### Walker + extractor (verbatim)

**Source:** `test/check-isolation.test.js:14-52`.

```javascript
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function extractImports(src) {
  const out = [];
  for (const m of src.matchAll(IMPORT_FROM_RE)) out.push(m[1]);
  for (const m of src.matchAll(IMPORT_BARE_RE)) out.push(m[1]);
  return out;
}

function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  if (!existsSync(entry)) return visited;
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const spec of extractImports(src)) {
    if (!spec.startsWith('.')) continue;
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}
```

**Copy verbatim**. Two regex (with-binding + bare side-effect import). No dynamic `import()` support — the repo doesn't use it (verified Phase 6 RESEARCH A3).

#### LOG-12 guard test (adapted: target = format.js; prohibited = logger.js)

**Source:** `test/check-isolation.test.js:75-88` (the `kodo check does not import src/logger.js transitively` test).

```javascript
it('kodo check does not import src/logger.js transitively', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  const violators = [...graph].filter((p) => /\/logger\.js$/.test(p));
  const relViolators = violators.map((p) => relative(REPO, p));
  const relGraph = [...graph].map((p) => relative(REPO, p));
  assert.deepEqual(
    violators,
    [],
    `check.js transitively imports src/logger.js via:\n  ${relViolators.join('\n  ')}\n` +
      `Full graph from check.js:\n  ${relGraph.join('\n  ')}`,
  );
});
```

**Apply to format-isolation.test.js** (CONTEXT D-06 — guard against `src/cli/format.js` reaching `src/logger.js`):

```javascript
it('src/cli/format.js does not import src/logger.js transitively (LOG-12 extension)', () => {
  const graph = walkImports(join(SRC, 'cli', 'format.js'));
  const violators = [...graph].filter((p) => /\/logger\.js$/.test(p));
  // ... same assertion shape with the same diagnostic message construction
});
```

Note the regex `/\/logger\.js$/` distinguishes `logger.js` (prohibited) from `logger-noop.js` (allowed) — copy this exact distinction.

#### Picocolors single-source grep test (D-08)

**No direct analog** — this is novel for Phase 14. Pattern source: CONTEXT §canonical_refs line 75 ("source-hygiene D-09/D-10/D-11" from Phase 13). Closest sibling in repo to study for structure: search of `src/` files for a forbidden literal. The walker already iterates `src/`; the new test reuses `readdirSync` over `src/` recursively + `readFileSync` + `extractImports`, asserting that the only file whose import list contains `'picocolors'` is `src/cli/format.js`.

```javascript
it('only src/cli/format.js imports picocolors (single source of color)', () => {
  // Walk src/ recursively; for each .js file, extract imports; assert that
  // no file other than src/cli/format.js declares 'picocolors' as a specifier.
  // Reuse extractImports() from the walker block above.
});
```

This grouping (LOG-12 extension + picocolors single-source) in a single file is exactly D-06 + D-08.

---

### `package.json` (MODIFIED — config / dependency manifest)

**Analog:** the file itself. Current `dependencies` block:

```json
"dependencies": {
  "commander": "^13.0.0"
}
```

**Apply Phase 14 modification** (CONTEXT D-07 + Claude's Discretion line 49 — `^1.0.0` no pin):

```json
"dependencies": {
  "commander": "^13.0.0",
  "picocolors": "^1.0.0"
}
```

Additive sibling, alphabetical (commander → picocolors). `package-lock.json` regenerates via `npm install picocolors`. No other field changes.

---

### `.planning/PROJECT.md` (MODIFIED — doc / constraints prose)

**Analog:** existing bullet at `.planning/PROJECT.md:120`:

```markdown
- **Logger aislado del vigilante**: `kodo check` no debe cargar `src/logger.js` transitivamente (LOG-12 guard)
```

(plus line 121 about source-hygiene). Format: bold lead, colon, prose explanation, optional invariant tag in parentheses.

**Apply Phase 14 modification** — append a sibling bullet under §Constraints (after the existing list, around line 121-122):

```markdown
- **Color isolation**: `picocolors` solo se importa desde `src/cli/format.js`. Cualquier callsite que necesite color va por `createFormatter(stream)` — test/format-isolation.test.js blinda la single-source con grep + walker (LOG-12 extension + D-07/D-08 source-hygiene).
```

Tone match: Spanish prose, bold lead, comma-separated invariant tags in parens. Same length as existing bullets.

The §"Current Milestone: v0.5..." block (line 27 already mentions picocolors as 2nd dep) needs **no edit** — already covers the milestone-level statement. Phase 14 only adds the constraint-level invariant.

---

## Shared Patterns

### `@ts-check` + JSDoc on every src/ file

**Source:** `src/logger.js:1`, `src/cli/gsd-inspect.js:1`, `src/cli/gsd-verify.js:1` — universal repo convention.

```javascript
// @ts-check
```

**Apply to:** `src/cli/format.js` line 1. Plus full JSDoc `@param`/`@returns` blocks on `createFormatter`, `_resolveUseColor`, `visibleWidth`, `formatRow`, `formatTable`. (Test files do NOT use `@ts-check` — confirmed by `test/check-isolation.test.js:1` which has no pragma.)

### Factory functions (no classes)

**Source:** `src/logger.js:192` (`createLogger`), and the rest of the repo (see PROJECT.md §code_context line 107).

```javascript
export function createLogger({ sessionId, minLevel = 'info' }) { /* returns object literal */ }
```

**Apply to:** `src/cli/format.js` — `export function createFormatter(stream, env)`. Pure factory, returns object literal of methods, no `this`.

### Dependency injection of `env`/`process.env` for testability

**Source:** `src/logger.js:204` accesses `process.env.NO_COLOR` directly today (Phase 14 generalizes). The DI shape comes from `gsd-inspect.js:50-62` (deps with default fallbacks).

```javascript
export async function runGsdInspect(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  // ...
```

**Apply to:** `createFormatter(stream, env = process.env)`. Default to real `process.env`; tests inject `{ NO_COLOR: '1' }` etc. The matrix of 4-5 cases (CONTEXT §specifics line 129) is asserted by mutating only this `env` arg per case.

### Test convention (`node:test` + `node:assert/strict`)

**Source:** `test/check-isolation.test.js:1-2`.

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
```

**Apply to:** `test/format-isolation.test.js` — identical imports. No third-party test framework.

### File naming convention

**Source:** `src/cli/gsd-inspect.js`, `src/cli/gsd-verify.js` — kebab-case for compound names. `src/logger.js`, `src/check.js` — single-word lowercase.

**Apply to:** `src/cli/format.js` (single word → bare lowercase, matches the convention).

---

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| (none) | — | All Phase 14 surfaces have direct analogs. |

The picocolors-grep portion of `test/format-isolation.test.js` is novel-in-shape but the *technique* (read src/ recursively, extract imports, assert single-source) is a direct application of the Phase 13 source-hygiene D-09/D-10/D-11 pattern referenced in CONTEXT §canonical_refs line 75 — no new architectural ground.

---

## Metadata

**Analog search scope:** `src/`, `src/cli/`, `test/`, `package.json`, `.planning/PROJECT.md`.
**Files read (analogs):** `src/logger.js`, `src/cli/gsd-inspect.js`, `src/cli/gsd-verify.js`, `test/check-isolation.test.js`, `package.json`, `src/check.js` (header sample for ANSI cross-check), `.planning/PROJECT.md` (Constraints section).
**Pattern extraction date:** 2026-05-04.
