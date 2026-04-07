# Testing Patterns

**Analysis Date:** 2026-04-07

## Test Framework

**Runner:**
- Node.js built-in `node:test` module (no external test runner dependency)
- Version: Node 20+ (as specified in `package.json` engines)
- Config: None (uses Node.js defaults)

**Assertion Library:**
- `node:assert/strict` — strict equality and deep comparison assertions

**Run Commands:**
```bash
npm test                   # Run all test/**/*.test.js files
node --test test/**/*.test.js  # Direct node test invocation
```

## Test File Organization

**Location:**
- Tests colocated in `test/` directory at project root (not co-located with source)
- Pattern: `test/[feature].test.js` mirrors source feature names

**Naming:**
- Test files suffixed with `.test.js`: `state.test.js`, `labels.test.js`
- One test file per feature/module
- No separate test subdirectories

**Structure:**
```
test/
├── state.test.js           # Session state management tests
├── labels.test.js          # Label parsing tests
└── (no other test infrastructure files)
```

## Test Structure

**Suite Organization:**
```javascript
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('state store', () => {
  beforeEach(() => {
    // Setup for each test
    mkdirSync(TEST_DIR, { recursive: true });
    writeState({ sessions: {} });
  });

  it('reads empty state', () => {
    const state = readState();
    assert.deepEqual(state.sessions, {});
  });

  it('adds and retrieves session', () => {
    // Test implementation
  });
});
```

**Patterns:**

**Setup with beforeEach:**
- Creates temporary test directory once per test
- Initializes test data (empty state JSON)
- Each test is isolated and independent

```javascript
const TEST_DIR = join(tmpdir(), `kodo-test-${Date.now()}`);
const TEST_STATE = join(TEST_DIR, 'state.json');

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  writeState({ sessions: {} });
});
```

**Cleanup:**
- Final test performs cleanup: `rmSync(TEST_DIR, { recursive: true, force: true })`
- Uses `force: true` to ignore missing files

```javascript
it('cleanup', () => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
```

**Test Data:**
Tests construct minimal data objects inline:
```javascript
const session = {
  workspace_ref: 'workspace:1',
  session_id: 'test-uuid',
  plane_id: 'plane-123',
  plane_identifier: 'KL-42',
  project_id: 'proj-1',
  summary: 'Test task',
  status: 'running',
  started_at: new Date().toISOString(),
  project_path: '/tmp/test',
};
```

## Test Coverage

**Current Tests:**

**State Management (`test/state.test.js`):**
- Reads empty state
- Adds and retrieves sessions
- Removes sessions
- Finds sessions by field (project_path, workspace_ref)
- Cleanup (final test)

**Label Parsing (`test/labels.test.js`):**
- Returns isKodo=false when no labels
- Returns isKodo=false when no kodo label
- Detects kodo label (case-insensitive)
- Detects model overrides (kodo:sonnet, kodo:haiku)
- Parses unknown kodo: tags into flags
- Handles mixed labels
- Ignores non-object labels (strings/UUIDs)
- Handles null/undefined input

**What's NOT Tested:**
- HTTP webhook server (`src/server.js`)
- CLI commands (`src/cli.js`)
- Plane API client (`src/plane/client.js`)
- cmux integration (`src/cmux/client.js`)
- Session launch orchestration (`src/session/manager.js`)
- Health check logic (`src/session/health.js`)
- Config I/O (`src/config.js`)

**Test Coverage Gaps:**
- No integration tests (webhook → session launch)
- No API mock tests (PlaneClient behavior)
- No subprocess/cmux tests (child_process execution)
- No error path testing (API failures, missing files)
- No concurrent session tests

**Priority for Testing:**
1. **High:** `PlaneClient` request/retry logic, `parseKodoLabels()` edge cases
2. **Medium:** Session state mutations, cmux command execution
3. **Low:** CLI argument parsing, HTTP status codes

## Mocking

**Framework:** Not currently used (tests use file system instead)

**What's Mocked:**
- Test data is written to temporary JSON files
- No HTTP mocking framework (would need for PlaneClient tests)
- No cmux binary mocking (would need for integration tests)

**Approach for Adding Mocks:**
To test without side effects, would need:
```javascript
// Example (not in codebase yet):
import { mock } from 'node:test';

// Mock execFile from child_process
mock.method(childProcess, 'execFile', (cmd, args, opts, cb) => {
  cb(null, 'workspace:1', ''); // Mock success response
});
```

## Assertion Patterns

**Deep Equality:**
```javascript
assert.deepEqual(state.sessions, {});  // Compare objects
assert.deepEqual(result.flags, ['review']);  // Compare arrays
```

**Strict Equality:**
```javascript
assert.equal(result.isKodo, false);         // === comparison
assert.equal(loaded.sessions['plane-123'].status, 'running');
```

**Truthiness:**
```javascript
assert.ok(found);  // Truthy check
assert.ok(loaded.sessions['plane-456']);  // Check object existence
```

**Falsy Check:**
```javascript
assert.equal(result.model, null);  // Explicitly check null
```

**Exception Testing:**
No exception tests currently in codebase. Pattern would be:
```javascript
// Not currently used, but would follow this pattern:
assert.throws(() => {
  PlaneClient.create({ apiKey: null });
}, (err) => err.message.includes('API key not found'));
```

## Async Testing

**Pattern:**
Tests use synchronous file operations (readFileSync, writeFileSync).

If async tests needed (e.g., testing `PlaneClient`):
```javascript
it('fetches project', async () => {
  const plane = new PlaneClient();
  const projects = await plane.listProjects();
  assert.ok(Array.isArray(projects));
});
```

The test framework (`node:test`) automatically detects async test functions and awaits them.

## Test Execution Flow

**Isolated Tests:**
Each test is independent:
1. `beforeEach` creates fresh test directory
2. Test runs with isolated data
3. No data carries over to next test
4. Final `cleanup` test removes temporary directory

**No Global State:**
- Tests read/write JSON files to temporary directory
- Multiple test runs can execute in parallel (different directories)
- No database or shared resource contention

## Missing Test Infrastructure

**Not Implemented:**
- Fixtures/factories (test data generators)
- Test utilities library (assertions helpers)
- Code coverage tools (nyc, c8)
- Snapshot testing
- Performance benchmarks
- Concurrent execution safeguards

## Recommended Testing Patterns for New Code

**For New Modules:**

**1. File I/O Operations:**
```javascript
describe('loadProjects', () => {
  let testDir;
  
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'kodo-'));
  });
  
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });
  
  it('reads projects from JSON', () => {
    const projectsPath = join(testDir, 'projects.json');
    writeFileSync(projectsPath, JSON.stringify({ 'proj-1': '/path' }));
    const result = loadProjects(projectsPath);
    assert.deepEqual(result, { 'proj-1': '/path' });
  });
});
```

**2. Pure Function Testing:**
```javascript
describe('parseKodoLabels', () => {
  it('handles edge case', () => {
    const result = parseKodoLabels([{ name: 'kodo:unknown' }]);
    assert.equal(result.isKodo, true);
    assert.deepEqual(result.flags, ['unknown']);
  });
});
```

**3. Error Condition Testing:**
```javascript
describe('PlaneClient', () => {
  it('throws on missing API key', () => {
    const config = { plane: { api_key_env: 'MISSING' } };
    delete process.env.MISSING;
    
    assert.throws(() => {
      new PlaneClient({ apiKey: undefined });
    }, /API key not found/);
  });
});
```

---

*Testing analysis: 2026-04-07*
