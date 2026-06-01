// @ts-check
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MANAGER_SOURCE_PATH = join(__dirname, '..', 'src', 'session', 'manager.js');

/** @type {import('../src/session/manager.js')['buildSessionFromTask']} */
let buildSessionFromTask;
/** @type {import('../src/session/manager.js')['resolveProjectPath']} */
let resolveProjectPath;
/** @type {import('../src/session/manager.js')['deriveModuleName']} */
let deriveModuleName;
/** @type {import('../src/session/manager.js')['resolveTaskAndLaunchContext']} */
let resolveTaskAndLaunchContext;
/** @type {import('../src/session/manager.js')['buildClaudeCommand']} */
let buildClaudeCommand;

/** @returns {import('../src/interface.js').TaskItem} */
function makeTask(overrides = {}) {
  return {
    id: 'uuid-task',
    ref: 'KL-42',
    title: 'Fix login bug',
    description: 'Some markdown description',
    labels: ['kodo', 'kodo:sonnet'],
    projectId: 'proj-uuid',
    projectName: 'Kodo Lab',
    groups: ['auth-module'],
    url: 'https://example.com/KL-42',
    priority: 'medium',
    ...overrides,
  };
}

describe('manager — pure helpers', () => {
  beforeEach(async () => {
    ({
      buildSessionFromTask,
      resolveProjectPath,
      deriveModuleName,
      resolveTaskAndLaunchContext,
      buildClaudeCommand,
    } = await import('../src/session/manager.js'));
  });

  describe('buildSessionFromTask', () => {
    it('saves generic task fields (task_id, task_ref, provider, project_id)', () => {
      const task = makeTask();
      const session = buildSessionFromTask({
        task,
        providerName: 'test',
        projectPath: '/tmp/proj',
        workspaceRef: 'workspace:42',
        sessionId: 'sess-uuid',
      });

      assert.equal(session.task_id, 'uuid-task');
      assert.equal(session.task_ref, 'KL-42');
      assert.equal(session.provider, 'test');
      assert.equal(session.project_id, 'proj-uuid');
      assert.equal(session.summary, 'Fix login bug');
      assert.equal(session.workspace_ref, 'workspace:42');
      assert.equal(session.session_id, 'sess-uuid');
      assert.equal(session.project_path, '/tmp/proj');
      assert.equal(session.status, 'running');
      assert.ok(session.started_at, 'should set started_at');
    });

    it('does not include legacy plane_id / plane_identifier fields', () => {
      const task = makeTask();
      const session = buildSessionFromTask({
        task,
        providerName: 'test',
        projectPath: '/tmp/proj',
        workspaceRef: 'workspace:42',
        sessionId: 'sess-uuid',
      });
      assert.equal(/** @type {any} */ (session).plane_id, undefined);
      assert.equal(/** @type {any} */ (session).plane_identifier, undefined);
    });

    describe('GSD flag propagation (D-12)', () => {
      it('sets gsd: true when flags include gsd', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd'],
        });
        assert.equal(session.gsd, true);
      });

      it('omits gsd field when flags do not include gsd', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['yolo'],
        });
        assert.equal(session.gsd, undefined);
      });

      it('omits gsd field when flags is undefined', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
        });
        assert.equal(session.gsd, undefined);
      });

      it('QUICK-08: persists gsd_mode:"full" when flags include "gsd"', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'full');
      });

      it('QUICK-08: persists gsd_mode:"quick" when flags include "gsd-quick"', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd-quick'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'quick');
      });

      it('QUICK-08: gsd-quick wins over gsd when both flags present (precedence via getGsdMode)', () => {
        // La regla de precedencia vive en getGsdMode (Phase 11 D-09).
        // buildSessionFromTask no la replica — sólo deriva localmente.
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd', 'gsd-quick'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'quick');
      });

      it('QUICK-08: omits gsd_mode when flags include neither gsd nor gsd-quick', () => {
        // Phase 11 D-04: gsd_mode SIEMPRE acompaña a gsd:true; nunca se persiste
        // gsd_mode sin gsd:true y nunca gsd:true sin gsd_mode (post-v0.4).
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['yolo'],
        });
        assert.equal(session.gsd, undefined);
        assert.equal(session.gsd_mode, undefined);
      });
    });

    describe('worktree_path persistence (Phase 18 WT-02, D-03)', () => {
      it('persists worktree_path when worktreePath param is provided', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          worktreePath: '/tmp/proj/.bg-shell/sess-uuid',
        });
        assert.equal(session.worktree_path, '/tmp/proj/.bg-shell/sess-uuid');
      });

      it('omits worktree_path key entirely when worktreePath is undefined (legacy compat — D-03c aditivo opcional)', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          // worktreePath omitido — conditional spread debe NO añadir el campo
        });
        assert.equal('worktree_path' in session, false,
          'worktree_path key must be absent from session (conditional spread, not null)');
      });

      it('omits worktree_path key when worktreePath is explicit undefined', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          worktreePath: undefined,
        });
        assert.equal('worktree_path' in session, false);
      });

      it('does not regress pre-existing fields when worktree_path is set (byte-shape stable)', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          flags: ['gsd'],
          worktreePath: '/tmp/proj/.bg-shell/sess-uuid',
        });
        assert.equal(session.task_id, 'uuid-task');
        assert.equal(session.session_id, 'sess-uuid');
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'full');
        assert.equal(session.worktree_path, '/tmp/proj/.bg-shell/sess-uuid');
      });
    });

    // CR-01 regression guard: launchWorkItem threads opts.sessionId into
    // buildSessionFromTask via the sessionId param. We validate the
    // identity-preservation at the buildSessionFromTask seam because
    // launchWorkItem itself performs real cmux/provider I/O (tested
    // elsewhere via the dispatcher integration tests).
    describe('launchWorkItem — opts.sessionId threading (CR-01 fix)', () => {
      it('buildSessionFromTask persists the sessionId passed verbatim (even if it looks like a uuid)', () => {
        const externalUuid = '01234567-89ab-4cde-8f01-23456789abcd';
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/r',
          workspaceRef: 'w:1',
          sessionId: externalUuid,
          flags: ['gsd'],
        });
        assert.equal(
          session.session_id,
          externalUuid,
          'session_id must be the externally-provided UUID, not regenerated',
        );
        assert.equal(session.gsd, true);
      });

      it('UUID shape check: randomUUID() output matches the v4 pattern used by the dispatcher', async () => {
        // Defensive tripwire — if Node ever changes randomUUID output, the
        // whole contract of "lock.session_id is a v4 UUID" breaks silently.
        const uuidV4Re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const { randomUUID } = await import('node:crypto');
        assert.match(randomUUID(), uuidV4Re);
      });
    });
  });

  describe('resolveProjectPath', () => {
    it('returns path from loadProjects() matching task.projectId', () => {
      const task = makeTask({ projectId: 'proj-uuid' });
      const path = resolveProjectPath(task, { 'proj-uuid': '/tmp/proj' });
      assert.equal(path, '/tmp/proj');
    });

    it('throws with helpful message when no path mapped', () => {
      const task = makeTask({ projectId: 'missing-proj' });
      assert.throws(
        () => resolveProjectPath(task, {}),
        { message: /No local path mapped/ },
      );
    });

    it('resolves module path from object entry', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['FVF'] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj/fvf');
    });

    it('falls back to default when module not in map', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['unknown-mod'] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj');
    });

    it('falls back to default when task has no module', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: [] });
      const projects = { 'proj-uuid': { default: '/tmp/proj', modules: { FVF: '/tmp/proj/fvf' } } };
      assert.equal(resolveProjectPath(task, projects), '/tmp/proj');
    });

    it('throws when object entry has no default and module not found', () => {
      const task = makeTask({ projectId: 'proj-uuid', groups: ['unknown'] });
      const projects = { 'proj-uuid': { modules: { FVF: '/tmp/proj/fvf' } } };
      assert.throws(
        () => resolveProjectPath(task, projects),
        { message: /No path for module/ },
      );
    });
  });

  describe('deriveModuleName', () => {
    it('returns first group when present', () => {
      const task = makeTask({ groups: ['auth-module', 'extras'] });
      assert.equal(deriveModuleName(task), 'auth-module');
    });

    it('returns null when no groups', () => {
      const task = makeTask({ groups: [] });
      assert.equal(deriveModuleName(task), null);
    });
  });

  describe('resolveTaskAndLaunchContext', () => {
    it('calls provider.init() and provider.getTask() with identifier', async () => {
      const calls = { init: 0, getTask: /** @type {string[]} */ ([]) };
      const provider = {
        async init() {
          calls.init++;
        },
        async getTask(ref) {
          calls.getTask.push(ref);
          return makeTask({ ref });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });

      assert.equal(calls.init, 1, 'provider.init() must be called');
      assert.deepEqual(calls.getTask, ['KL-42']);
      assert.equal(result.task.ref, 'KL-42');
      assert.equal(result.projectPath, '/tmp/proj');
      assert.equal(result.moduleName, 'auth-module');
    });

    it('parses labels via parseKodoLabels receiving {name} objects', async () => {
      const provider = {
        async init() {},
        async getTask() {
          return makeTask({ labels: ['kodo', 'kodo:sonnet', 'kodo:yolo'] });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });

      assert.equal(result.model, 'sonnet', 'model should come from kodo:sonnet label');
      assert.ok(result.flags.includes('yolo'), 'flags should include yolo');
    });

    it('uses task.description directly (no stripHtml)', async () => {
      const provider = {
        async init() {},
        async getTask() {
          return makeTask({ description: 'Plain markdown description' });
        },
      };

      const result = await resolveTaskAndLaunchContext({
        provider,
        identifier: 'KL-42',
        projects: { 'proj-uuid': '/tmp/proj' },
      });
      assert.equal(result.description, 'Plain markdown description');
    });
  });

  describe('buildClaudeCommand cmd shape (Phase 18 WT-01)', () => {
    /** @returns {ReturnType<import('../src/config.js').loadConfig>} */
    function makeConfig() {
      // Minimal shape — buildClaudeCommand only reads config.claude.default_model.
      return /** @type {any} */ ({
        provider: 'plane',
        claude: { default_model: 'sonnet' },
      });
    }

    it('emits --worktree <sessionId> immediately after --session-id (D-01: explicit, never bare)', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'abc-123',
        makeTask(),
        'desc',
        null,
        [],
        null,
      );
      assert.match(cmd, /--session-id abc-123 --worktree abc-123/,
        '--worktree must follow --session-id with a single space and the same sessionId arg');
    });

    it('--worktree precedes --dangerously-skip-permissions when GSD flags imply skip-perms', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'abc-123',
        makeTask(),
        'desc',
        null,
        ['gsd'],
        null,
      );
      assert.match(cmd, /--worktree abc-123 --dangerously-skip-permissions/,
        'flag order must be --worktree before --dangerously-skip-permissions (golden-bytes QUICK-07)');
    });

    it('worktree arg is the sessionId verbatim, not = syntax, not bare', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'sess-uuid-xyz',
        makeTask(),
        'desc',
        null,
        [],
        null,
      );
      assert.ok(cmd.includes('--worktree sess-uuid-xyz'),
        '--worktree must be followed by an explicit sessionId arg');
      assert.ok(!cmd.includes('--worktree='),
        'no `=` syntax (D-01: explicit positional arg)');
      // No `--worktree` followed by anything other than the sessionId (no bare flag).
      assert.ok(!/--worktree(?!\s+sess-uuid-xyz)/.test(cmd),
        'no bare --worktree without an explicit sessionId');
    });

    it('preserves --model … --session-id … --worktree … flag ORDER (golden-bytes QUICK-07)', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'abc-123',
        makeTask(),
        'desc',
        null,
        ['gsd-quick'],
        null,
      );
      assert.match(
        cmd,
        /^claude --model sonnet --session-id abc-123 --worktree abc-123 --dangerously-skip-permissions /,
        'header order must be --model → --session-id → --worktree → [--dangerously-skip-permissions] → prompt',
      );
    });

    it('--worktree present for non-GSD sessions too (D-06b universal)', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'abc-123',
        makeTask(),
        'desc',
        null,
        [], // no flags — non-GSD
        null,
      );
      assert.match(cmd, /--worktree abc-123/,
        '--worktree must be present for non-GSD sessions (Phase 18 D-06b universal)');
      // And no --dangerously-skip-permissions for non-GSD/no-yolo.
      assert.ok(!cmd.includes('--dangerously-skip-permissions'),
        'non-GSD non-yolo sessions must not get skip-perms');
    });
  });
});

describe('manager.js source hygiene', () => {
  it('does not import PlaneClient', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'manager.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import plane/client');
  });

  it('imports getProvider from providers/registry', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /getProvider.*from ['"]\.\.\/providers\/registry\.js['"]/.test(source),
      'manager.js must import getProvider from providers/registry',
    );
  });

  it('does not use legacy plane_id / plane_identifier on sessions', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!/\bplane_id\b/.test(source), 'plane_id should be replaced with task_id');
    assert.ok(!/\bplane_identifier\b/.test(source), 'plane_identifier should be replaced with task_ref');
  });

  it('does not call stripHtml on task description', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('stripHtml'), 'stripHtml no longer needed — description is Markdown');
  });

  it('cualquier modo GSD implica --dangerously-skip-permissions (Phase 11 D-01: kodo:gsd y kodo:gsd-quick)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Phase 11 D-01/D-02: skipPerms se deriva de getGsdMode(kodoFlags) !== null
    // en lugar del literal kodoFlags.includes('gsd'). Esto extiende el contrato
    // a kodo:gsd-quick (y a cualquier modo futuro registrado en getGsdMode)
    // con un solo punto de cambio.
    assert.ok(
      /getGsdMode\(kodoFlags\)\s*!==\s*null/.test(source),
      'buildClaudeCommand debe derivar skip-permissions de getGsdMode(kodoFlags) !== null',
    );
    // El literal viejo NO debe seguir presente — si vuelve, el refactor D-01
    // ha sido revertido y kodo:gsd-quick deja de heredar skip-perms.
    assert.ok(
      !/kodoFlags\.includes\(['"]gsd['"]\)/.test(source),
      'el literal kodoFlags.includes("gsd") fue reemplazado por getGsdMode (no debe regresar)',
    );
    // Garantiza que la condición sigue cubriendo 'yolo' explícito también.
    assert.ok(
      /kodoFlags\.includes\(['"]yolo['"]\)/.test(source),
      'buildClaudeCommand debe seguir respetando kodo:yolo explícito',
    );
    // Phase 11 <specifics>: yolo va PRIMERO en el `||` para preservar la
    // trazabilidad humana ("yolo es intención explícita; GSD es implícita").
    assert.ok(
      /kodoFlags\.includes\(['"]yolo['"]\)\s*\|\|\s*getGsdMode/.test(source),
      'el orden de short-circuit debe ser yolo primero, getGsdMode después',
    );
    // Sanity: --dangerously-skip-permissions sigue vivo en el comando.
    assert.ok(
      source.includes('--dangerously-skip-permissions'),
      'el flag CLI debe seguir siendo --dangerously-skip-permissions',
    );
  });

  it('Phase 18 WT-01: imports computeWorktreePath from session/state.js (single source of truth)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /import\s+\{[^}]*\bcomputeWorktreePath\b[^}]*\}\s+from\s+['"]\.\/state\.js['"]/.test(source),
      'manager.js must import computeWorktreePath from ./state.js (Plan 01 helper)',
    );
    // No re-implementation inline — Plan 01 is the single source of truth.
    assert.ok(
      !/\.bg-shell['"]\s*,\s*sessionId/.test(source),
      'manager.js must NOT inline path.join(... , ".bg-shell", sessionId) — use computeWorktreePath',
    );
  });

  it('Phase 18 WT-01: launchWorkItem computes worktreePath from (projectPath, sessionId)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /computeWorktreePath\(\s*projectPath\s*,\s*sessionId\s*\)/.test(source),
      'launchWorkItem must invoke computeWorktreePath(projectPath, sessionId) verbatim',
    );
  });

  it('Phase 18 WT-02: buildSessionFromTask spreads worktree_path conditionally (D-03c aditivo)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Same idiom as phase_id/brief (line 54-55) — `worktreePath ? { worktree_path: worktreePath } : {}`.
    assert.ok(
      /worktreePath\s*\?\s*\{\s*worktree_path:\s*worktreePath\s*\}/.test(source),
      'buildSessionFromTask must use conditional spread `worktreePath ? { worktree_path: worktreePath } : {}`',
    );
  });

  it('Phase 18 WT-01: buildClaudeCommand emits --worktree ${sessionId} in template', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /--worktree\s+\$\{sessionId\}/.test(source),
      'buildClaudeCommand template must contain `--worktree ${sessionId}` verbatim',
    );
    // Order check: --session-id must precede --worktree in the template (golden-bytes QUICK-07).
    assert.ok(
      /--session-id\s+\$\{sessionId\}\s+--worktree\s+\$\{sessionId\}/.test(source),
      '--session-id ${sessionId} must precede --worktree ${sessionId} in the template',
    );
  });

  it('Phase 18 D-03: addSession runs BEFORE the workspace send (PRE-spawn persistence ordering)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    const addIdx = source.indexOf('addSession(task.id, session)');
    // Phase 38 SC#5: el send migró de `cmux.send` a `host._legacy.send` (cmux
    // confinado a src/host/). El invariante de ORDEN (persist antes de enviar el
    // comando claude) es idéntico — solo cambia el punto de entrada del cliente.
    const sendIdx = source.indexOf('host._legacy.send({ workspace: workspaceRef, text: claudeCmd })');
    assert.ok(addIdx > 0, 'addSession(task.id, session) must be present in launchWorkItem');
    assert.ok(sendIdx > 0, 'host._legacy.send({ workspace: workspaceRef, text: claudeCmd }) must be present');
    assert.ok(
      addIdx < sendIdx,
      `Phase 18 D-03: addSession(task.id, session) must precede the workspace send (got addSession@${addIdx}, send@${sendIdx})`,
    );
  });

  it('Phase 18 D-04 invariant: newWorkspace still uses cwd: projectPath (NOT worktree path)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Phase 38 SC#5: newWorkspace migró a host._legacy.newWorkspace; el invariante
    // D-04 (cwd: projectPath, NO worktreePath) se preserva literal.
    assert.ok(
      /host\._legacy\.newWorkspace\(\s*\{[^}]*cwd:\s*projectPath/.test(source),
      'host._legacy.newWorkspace must keep `cwd: projectPath` (D-04 lockeado — worktree lo materializa claude)',
    );
    // Defensive: no accidental swap to worktreePath
    assert.ok(
      !/host\._legacy\.newWorkspace\(\s*\{[^}]*cwd:\s*worktreePath/.test(source),
      'host._legacy.newWorkspace must NOT receive cwd: worktreePath',
    );
  });

  it('QUICK-08: gsd_mode derivation uses getGsdMode helper, not inline includes (Phase 13 D-12)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Phase 11 D-03: buildSessionFromTask deriva gsdMode localmente vía
    // getGsdMode(flags). Si alguien reintroduce derivación inline tipo
    // `flags.includes('gsd-quick') ? 'quick' : 'full'`, la regla de
    // precedencia centralizada se duplica y diverge silenciosamente.
    // Single point of change: añadir un nuevo modo a getGsdMode() basta.
    assert.ok(
      /const gsdMode = getGsdMode\(flags\)/.test(source),
      'buildSessionFromTask debe derivar gsdMode vía `const gsdMode = getGsdMode(flags)` (Phase 11 D-03)',
    );
    // El literal alternativo NO debe estar presente — si vuelve, el refactor
    // D-03 fue revertido y la precedencia se duplica.
    assert.ok(
      !/flags\.includes\(['"]gsd-quick['"]\)\s*\?/.test(source),
      'la derivación inline `flags.includes("gsd-quick") ? ...` no debe existir — usa getGsdMode',
    );
    // El campo persistido se llama gsd_mode (no mode ni gsdMode) en el spread.
    // Sanity check: buildSessionFromTask spreaded el campo con ese nombre exacto.
    assert.ok(
      /gsd_mode:\s*gsdMode/.test(source),
      'el campo persistido debe ser `gsd_mode: gsdMode` (no renombrar a mode/gsdMode)',
    );
    // Sanity: el spread es condicional (sólo cuando hay modo) — Phase 11 D-04.
    assert.ok(
      /\.\.\.\(gsdMode\s*\?\s*\{\s*gsd:\s*true,\s*gsd_mode:\s*gsdMode\s*\}/.test(source),
      'gsd_mode debe persistirse SIEMPRE junto a gsd:true en el spread condicional (Phase 11 D-04)',
    );
  });
});
