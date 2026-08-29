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
/** @type {import('../src/session/manager.js')['isGitRepo']} */
let isGitRepo;

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
      isGitRepo,
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

    // KODO-22 — el SessionRecord sella el UUID del workspace, no solo su ref.
    //
    // El guard de branding del daemon (shouldBrandWorkspace, server.js) compara
    // CMUX_WORKSPACE_ID —un UUID— contra los campos del registro. Mientras el record
    // solo llevaba `workspace_ref` ("workspace:N"), ese brazo del guard no casaba nunca
    // y `kodo up` desde la tab de una sesión viva la rebautizaba `心動 kodo service`.
    describe('workspace_id (KODO-22)', () => {
      const WS_UUID = '0AE8A07E-B73A-40EB-B168-2270EEE03683';

      it('persiste el UUID resuelto tal cual', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          workspaceId: WS_UUID,
        });
        assert.equal(session.workspace_id, WS_UUID);
        // El ref NO se sustituye: los dos conviven (ref para focus/logs, id para identidad).
        assert.equal(session.workspace_ref, 'workspace:42');
      });

      it('persiste null —no omite la clave— cuando el host no lo resolvió (fail-open)', () => {
        // A DIFERENCIA de worktree_path (spread condicional), este campo se escribe
        // SIEMPRE: `null` significa "sesión lanzada, host sin contestar" y AUSENTE
        // significa "sesión legacy anterior a KODO-22". Son estados distintos.
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          workspaceId: null,
        });
        assert.equal('workspace_id' in session, true, 'la clave debe estar presente');
        assert.equal(session.workspace_id, null);
      });

      it('null también cuando el param se omite por completo', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
        });
        assert.equal(session.workspace_id, null);
      });

      it('no regresiona el resto del shape', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:42',
          sessionId: 'sess-uuid',
          workspaceId: WS_UUID,
          flags: ['gsd'],
          worktreePath: '/tmp/proj/.bg-shell/sess-uuid',
        });
        assert.equal(session.task_id, 'uuid-task');
        assert.equal(session.session_id, 'sess-uuid');
        assert.equal(session.status, 'running');
        assert.equal(session.gsd, true);
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

    // Bugfix: el prompt ya NO se teclea inline. `cmux send` inyecta el comando
    // como keystrokes e interpreta \n/\r/\t como Enter/Tab (y puede perder
    // caracteres durante el init del shell), partiendo el comando a mitad. El
    // prompt se escribe a un fichero y el comando solo lo referencia vía
    // `"$(cat …)"`, así la línea tecleada es corta, ASCII y sin escapes.
    it('referencia el prompt por fichero (`$(cat …)`), no lo teclea inline', () => {
      const cmd = buildClaudeCommand(
        makeConfig(),
        'sess-fileref',
        makeTask(),
        'desc',
        null,
        [],
        null,
      );
      assert.match(cmd, /"\$\(cat .+\)"$/,
        'el comando debe terminar en `"$(cat <path>)"` (prompt por fichero)');
      // No debe quedar el prompt entre comillas simples inline (regresión al
      // tecleo del prompt completo como keystrokes).
      assert.ok(!/'.*Trabaja en:/.test(cmd),
        'el prompt no debe ir inline entre comillas simples');
    });

    it('el fichero de prompt conserva el contenido VERBATIM (escapes, comillas, multibyte)', () => {
      // Veneno: \n y \t literales, backslashes de ruta, comilla simple, em-dash, acentos.
      const description = "Ruta C:\\new\\tabla, regex \\t, 'única' opción 4–5 fotografías.";
      const cmd = buildClaudeCommand(
        makeConfig(),
        'sess-verbatim',
        makeTask({ title: "Hero 'difícil'" }),
        description,
        null,
        ['yolo'],
        'FVF',
      );
      const m = cmd.match(/"\$\(cat (.+)\)"$/);
      assert.ok(m, 'el comando debe referenciar un fichero de prompt');
      const written = readFileSync(m[1], 'utf-8');
      const expected = `Trabaja en: Hero 'difícil'. Módulo: FVF. Descripción: ${description}`;
      assert.equal(written, expected,
        'el fichero debe contener el prompt exacto, sin escapar ni colapsar nada');
    });

    // KODO-9: `claude --worktree` exige un repo git y aborta si no lo hay. En
    // proyectos no-git el flag debe OMITIRSE por completo; en git se mantiene
    // exactamente igual que antes (sin regresión). Cubrimos ambas ramas.
    describe('git vs non-git worktree branch (KODO-9)', () => {
      it('non-git (isGitRepo=false): omite --worktree por completo', () => {
        const cmd = buildClaudeCommand(
          makeConfig(),
          'abc-123',
          makeTask(),
          'desc',
          null,
          [],
          null,
          false, // isGitRepo — proyecto NO-git
        );
        assert.ok(!cmd.includes('--worktree'),
          'un proyecto no-git no debe emitir --worktree (claude --worktree aborta sin repo git)');
        // El resto del header se mantiene intacto y sin dobles espacios residuales.
        assert.match(cmd, /^claude --model sonnet --session-id abc-123 "\$\(cat .+\)"$/,
          'header sin --worktree: --model → --session-id → prompt, sin hueco doble');
      });

      it('non-git + GSD: sin --worktree pero conserva --dangerously-skip-permissions', () => {
        const cmd = buildClaudeCommand(
          makeConfig(),
          'abc-123',
          makeTask(),
          'desc',
          null,
          ['gsd'],
          null,
          false, // isGitRepo — proyecto NO-git
        );
        assert.ok(!cmd.includes('--worktree'), 'no-git no debe emitir --worktree ni en modo GSD');
        assert.ok(cmd.includes('--dangerously-skip-permissions'),
          'GSD sigue implicando skip-perms independientemente del git-ness');
        assert.match(cmd, /^claude --model sonnet --session-id abc-123 --dangerously-skip-permissions /,
          'sin --worktree, skip-perms sube justo tras --session-id (sin hueco doble)');
      });

      it('git (isGitRepo=true explícito): emite --worktree igual que el default', () => {
        const cmd = buildClaudeCommand(
          makeConfig(),
          'abc-123',
          makeTask(),
          'desc',
          null,
          [],
          null,
          true, // isGitRepo — proyecto git
        );
        assert.match(cmd, /--session-id abc-123 --worktree abc-123/,
          'proyecto git debe emitir --worktree exactamente como el comportamiento por defecto');
      });

      it('default (arg omitido) mantiene --worktree — backward-compat', () => {
        const cmd = buildClaudeCommand(makeConfig(), 'abc-123', makeTask(), 'desc', null, [], null);
        assert.match(cmd, /--worktree abc-123/,
          'omitir el 8º arg debe comportarse como git (default true) — cero regresión');
      });
    });
  });

  describe('isGitRepo (KODO-9)', () => {
    it('devuelve true cuando `git rev-parse --is-inside-work-tree` imprime "true"', () => {
      const calls = [];
      const gitFn = (cwd, args) => {
        calls.push({ cwd, args });
        return 'true';
      };
      assert.equal(isGitRepo('/some/git/project', gitFn), true);
      assert.deepEqual(calls, [{ cwd: '/some/git/project', args: ['rev-parse', '--is-inside-work-tree'] }],
        'debe invocar `git -C <path> rev-parse --is-inside-work-tree`');
    });

    it('devuelve false cuando el gitFn lanza (cwd no es repo git → git sale con error)', () => {
      const gitFn = () => {
        throw new Error('fatal: not a git repository');
      };
      assert.equal(isGitRepo('/some/non-git/project', gitFn), false,
        'fail-safe: cualquier error del git = no-git (lanzar sin --worktree siempre es válido)');
    });

    it('devuelve false ante output distinto de "true" (defensivo)', () => {
      assert.equal(isGitRepo('/x', () => 'false'), false);
      assert.equal(isGitRepo('/x', () => ''), false);
    });

    it('detecta correctamente el repo real de este propio proyecto (default gitFn)', () => {
      // El repo kodo ES git — smoke test del path real sin inyección.
      assert.equal(isGitRepo(process.cwd()), true);
    });

    it('un directorio no-git real (p. ej. /tmp) devuelve false con el gitFn por defecto', () => {
      // /tmp normalmente no es un working tree git — verifica que el error real
      // de git se traga y devuelve false (no propaga la excepción).
      assert.equal(isGitRepo('/tmp'), false);
    });
  });
});

describe('KODO-18 — buildSessionFromTask sella el host de la sesión', () => {
  const task = {
    id: 't-1', ref: 'KODO-1', title: 'x', projectId: 'p1', labels: [],
    state: 'In Progress', url: 'u', projectName: 'kodo', description: '',
  };
  const base = { task, providerName: 'plane', projectPath: '/dev/kodo', workspaceRef: 'ws:1', sessionId: 's-1' };

  it('persiste `host` cuando se pasa', () => {
    assert.equal(buildSessionFromTask({ ...base, hostName: 'orca' }).host, 'orca');
  });

  it('OMITE el campo cuando no se pasa (spread condicional, shape legacy intacto)', () => {
    const session = buildSessionFromTask(base);
    assert.ok(!('host' in session), 'sin hostName el campo no debe aparecer');
  });

  it('el campo es el que consume la guarda por host de reconcileTick', async () => {
    // Contrato de extremo a extremo entre los dos módulos: lo que escribe el launch es
    // exactamente lo que lee la guarda que evita degradar sesiones del otro cliente.
    const { reconcileTick } = await import('../src/session/reconcile.js');
    const session = buildSessionFromTask({ ...base, hostName: 'cmux' });
    const state = { schema_version: 3, sessions: { 't-1': session } };
    const { state: out } = reconcileTick(state, [], {
      debounceStore: new Map(), tick: 1, now: Date.now(), hostName: 'orca',
    });
    assert.equal(out.sessions['t-1'], session, 'intacta: el snapshot de orca no la juzga');
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

  it('Phase 18 WT-01 + KODO-30: imports computeRealWorktreePath from session/state.js (single source of truth)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /import\s+\{[^}]*\bcomputeRealWorktreePath\b[^}]*\}\s+from\s+['"]\.\/state\.js['"]/.test(source),
      'manager.js must import computeRealWorktreePath from ./state.js (Plan 01 helper)',
    );
    // No re-implementation inline — Plan 01 is the single source of truth.
    assert.ok(
      !/\.bg-shell['"]\s*,\s*sessionId/.test(source),
      'manager.js must NOT inline path.join(... , ".bg-shell", sessionId) — use computeRealWorktreePath',
    );
  });

  it('Phase 18 WT-01 + KODO-30: launchWorkItem computes worktreePath from (projectPath, sessionId)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /computeRealWorktreePath\(\s*projectPath\s*,\s*sessionId\s*\)/.test(source),
      'launchWorkItem must invoke computeRealWorktreePath(projectPath, sessionId) verbatim',
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

  it('KODO-9 (supersedes Phase 18 WT-01): buildClaudeCommand emits --worktree ${sessionId} gated by isGitRepo', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // El flag sigue existiendo verbatim en la plantilla (ahora dentro del
    // worktreeFlag condicional). KODO-9 lo OMITE en proyectos no-git.
    assert.ok(
      /--worktree\s+\$\{sessionId\}/.test(source),
      'buildClaudeCommand template must contain `--worktree ${sessionId}` verbatim',
    );
    // KODO-9: el flag debe derivar de isGitRepo — NO incondicional. Si vuelve a
    // ser incondicional, los proyectos no-git vuelven a romperse al arrancar.
    assert.ok(
      /isGitRepo\s*\?\s*`--worktree \$\{sessionId\}`\s*:\s*''/.test(source),
      'el --worktree debe estar gobernado por `isGitRepo ? `--worktree ${sessionId}` : \'\'` (KODO-9)',
    );
    // Order check (runtime): el flag de session-id precede al worktreeFlag en el
    // header (golden-bytes QUICK-07 preservado — con isGitRepo=true el orden es
    // idéntico). Post config.agents: el flag sale del registro de agentes
    // (`agent.session_id_flag`, que para claude-code ES `--session-id`), así que
    // la plantilla lo interpola en vez de llevar el literal.
    assert.ok(
      /\$\{agent\.session_id_flag\}\s+\$\{sessionId\}\s+\$\{worktreeFlag\}/.test(source),
      '${agent.session_id_flag} ${sessionId} must precede ${worktreeFlag} in the header template',
    );
  });

  it('KODO-9: launchWorkItem detecta git-ness y la cablea en buildClaudeCommand', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // launchWorkItem debe computar el flag desde projectPath...
    assert.ok(
      /gitBacked\s*=\s*isGitRepo\(\s*projectPath\s*\)/.test(source),
      'launchWorkItem must compute `gitBacked = isGitRepo(projectPath)`',
    );
    // KODO-18: el 8º arg de buildClaudeCommand ya NO es `gitBacked` a secas sino
    // `isolateWithClaude` = gitBacked && !hostOwnsWorktree. El invariante KODO-9 sigue
    // vivo (un proyecto no-git nunca emite --worktree) porque gitBacked es un factor del
    // AND; lo que se añade es el segundo motivo para omitirlo: que el host ya aísle.
    assert.ok(
      /isolateWithClaude\s*=\s*gitBacked\s*&&\s*!hostOwnsWorktree/.test(source),
      'launchWorkItem debe derivar `isolateWithClaude = gitBacked && !hostOwnsWorktree`',
    );
    assert.ok(
      /hostOwnsWorktree\s*=\s*hostIsolatesWorktree\(\s*hostName\s*\)/.test(source),
      'hostOwnsWorktree debe salir de hostIsolatesWorktree(hostName) — no de un literal por host',
    );
    // ...y pasarlo como 8º arg a buildClaudeCommand.
    assert.ok(
      /buildClaudeCommand\([^)]*,\s*isolateWithClaude\s*\)/.test(source),
      'buildClaudeCommand debe recibir isolateWithClaude como último argumento',
    );
    // Y worktreePath solo se computa cuando el aislamiento lo pone claude (no cleanup
    // fantasma ni en no-git ni cuando el worktree lo crea el host).
    assert.ok(
      /isolateWithClaude\s*\?\s*computeRealWorktreePath\(\s*projectPath\s*,\s*sessionId\s*\)\s*:\s*null/.test(source),
      'worktreePath debe ser `isolateWithClaude ? computeRealWorktreePath(projectPath, sessionId) : null`',
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

  it('KODO-22: launchWorkItem resuelve el workspace_id vía host._legacy y ANTES del addSession', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');

    // La resolución se importa del módulo hoja de host/, NO de orchestrator/launch.js:
    // ese módulo arrastra el arranque completo del orquestador (prompt.md, sync de la
    // skill, provider) al camino caliente del dispatch. Misma frontera que target.js.
    assert.ok(
      /import\s*\{[^}]*\bresolveWorkspaceId\b[^}]*\}\s*from\s*['"]\.\.\/host\/workspace-id\.js['"]/.test(source),
      'manager.js debe importar resolveWorkspaceId desde ../host/workspace-id.js',
    );
    assert.ok(
      !/from\s*['"]\.\.\/orchestrator\/launch\.js['"]/.test(source),
      'manager.js NO debe importar orchestrator/launch.js (módulo pesado del camino caliente)',
    );

    // El árbol se pide por host._legacy (invariante cmux-isolation SC#5: src/session/
    // nunca toca cmux/client.js), y un host sin árbol degrada a null sin caer al cliente.
    assert.ok(
      /const\s+listTreeFn\s*=\s*host\._legacy\?\.listTree/.test(source),
      'el listTreeFn debe salir de host._legacy?.listTree (SC#5)',
    );
    assert.ok(
      /listTreeFn\s*\?\s*await resolveWorkspaceId\(\s*workspaceRef\s*,\s*\{\s*listTreeFn\s*\}\s*\)\s*:\s*null/.test(source),
      'sin listTree en el host, workspaceId debe degradar a null (nunca al cliente cmux)',
    );

    // El UUID viaja al record por el MISMO addSession PRE-spawn — no por un
    // updateSession posterior, que dejaría una ventana en la que la sesión ya existe
    // y el guard de branding aún no ve su identidad.
    const resolveIdx = source.indexOf('await resolveWorkspaceId(workspaceRef');
    const buildIdx = source.indexOf('const session = buildSessionFromTask({');
    const addIdx = source.indexOf('addSession(task.id, session)');
    assert.ok(resolveIdx > 0, 'launchWorkItem debe resolver el workspace_id');
    assert.ok(
      resolveIdx < buildIdx && buildIdx < addIdx,
      `la resolución debe preceder a buildSessionFromTask y al addSession (got resolve@${resolveIdx}, build@${buildIdx}, add@${addIdx})`,
    );
    assert.ok(
      /workspaceId,/.test(source.slice(buildIdx, addIdx)),
      'buildSessionFromTask debe recibir workspaceId',
    );

    // Fail-open: el UUID es cosmético frente a la carga útil. Ni throw ni return por
    // no resolverlo (resolveWorkspaceId ya es never-throws; esto blinda el call site).
    assert.ok(
      !/resolveWorkspaceId\([^)]*\)[\s\S]{0,120}?throw/.test(source),
      'no resolver el workspace_id NUNCA debe abortar el lanzamiento',
    );
  });

  it('Phase 18 D-04 invariant: newWorkspace still uses cwd: projectPath (NOT worktree path)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Phase 77: la llamada directa a host._legacy.newWorkspace migró a
    // newWorkspaceWithGroupFallback, pero el objeto de opts sigue llevando
    // `cwd: projectPath` LITERAL (D-04 lockeado). El invariante se comprueba ahora
    // sobre ese objeto de opts, no sobre la llamada directa (que ya no existe).
    assert.ok(
      /\{[^}]*name:\s*workspaceName[^}]*cwd:\s*projectPath/.test(source),
      'el newWorkspace opts debe mantener `cwd: projectPath` (D-04 — worktree lo materializa claude)',
    );
    // Defensive: no accidental swap to worktreePath
    assert.ok(
      !/newWorkspace[^;]*cwd:\s*worktreePath/.test(source),
      'newWorkspace opts must NOT receive cwd: worktreePath',
    );
  });

  it('marca kodo (sidebar 2026-08): launchWorkItem fija description "⬢ <ref> · <título>" fail-open tras el setStatus', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // El canal description es el marcador machine-readable de sesión kodo. Va por
    // host._legacy (walker cmux-isolation) y DENTRO de try/catch: es cosmético y
    // no debe abortar el dispatch si el cmux instalado no soporta set-description.
    assert.ok(
      /try\s*\{\s*await host\._legacy\.setDescription\(\{/.test(source),
      'launchWorkItem debe llamar host._legacy.setDescription dentro de try/catch (fail-open)',
    );
    // El contenido lleva el marcador ⬢ + task.ref y sanea el título con el mismo
    // saneador RENDER que workspaceName (contenido no confiable → arg CLI).
    assert.ok(
      /description:\s*`⬢ \$\{task\.ref\} · \$\{truncate\(stripControlChars\(task\.title\),\s*60\)\}`/.test(source),
      'la description debe ser `⬢ ${task.ref} · ${truncate(stripControlChars(task.title), 60)}`',
    );
    // Orden: después del marcado de estado 'running' (que conserva su semántica previa;
    // la marca es aditiva). KODO-18: ese marcado dejó de ser `setColor(colorForStatus(…))`
    // —vocabulario cmux— y pasó a `setStatus({status:'running'})`, host-agnóstico: cmux
    // lo resuelve a color, orca a columna de tablero.
    const statusIdx = source.indexOf("setStatus({ workspace: workspaceRef, status: 'running' })");
    const descIdx = source.indexOf('host._legacy.setDescription({');
    assert.ok(statusIdx > 0, 'el setStatus running debe seguir presente');
    assert.ok(descIdx > statusIdx, 'setDescription debe ir tras el setStatus running');
    // El launch path NO debe volver a hablar el vocabulario de colores de cmux: si
    // `colorForStatus` reaparece aquí, el host orca se queda sin su canal de estado.
    assert.ok(
      !source.includes('colorForStatus'),
      'manager.js no debe importar ni usar colorForStatus (vocabulario cmux) — usa setStatus',
    );
  });

  it('Phase 77 (GRP-01/GRP-03): launchWorkItem resuelve el grupo vía host._legacy.listWorkspaceGroups en try/catch (capa 1 fail-open)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // La resolución pasa SIEMPRE por host._legacy (nunca cmux/client.js — walker).
    assert.ok(
      /host\._legacy\.listWorkspaceGroups\(\)/.test(source),
      'launchWorkItem debe invocar host._legacy.listWorkspaceGroups() (D-06, vía _legacy)',
    );
    // La derivación y el parseo defensivo se cablean con las funciones puras.
    assert.ok(
      /deriveExpectedGroupName\(\s*task\s*,\s*entry\s*,\s*projectPath\s*\)/.test(source),
      'debe derivar el nombre esperado con deriveExpectedGroupName(task, entry, projectPath)',
    );
    assert.ok(
      /resolveWorkspaceGroup\(\s*JSON\.parse\(\s*raw\s*\)\s*,\s*expectedName\s*\)/.test(source),
      'debe resolver el ref con resolveWorkspaceGroup(JSON.parse(raw), expectedName)',
    );
    // Capa 1 fail-open: la resolución vive en un try/catch que degrada a groupRef=null.
    assert.ok(
      /let\s+groupRef\s*=\s*null/.test(source),
      'groupRef debe inicializarse a null (capa 1 fail-open: sin match → sin --group)',
    );
    // D-11: el log de degradación lleva solo el motivo, sin contenido de usuario.
    assert.ok(
      /group_skipped — resolucion_fallo/.test(source),
      'el catch de resolución debe loguear `group_skipped — resolucion_fallo` (D-11, sin user content)',
    );
    // IN-04 (Phase 78): la llamada cmux `listWorkspaceGroups()` está GUARDADA por
    // `if (expectedName)` — cuando no hay nombre esperado se evita la llamada
    // garantizada-inútil. El guard debe englobar la llamada dentro del try.
    assert.ok(
      /if\s*\(\s*expectedName\s*\)\s*\{[\s\S]*?host\._legacy\.listWorkspaceGroups\(\)/.test(source),
      'la llamada listWorkspaceGroups() debe vivir dentro de un guard `if (expectedName)` (IN-04)',
    );
    // IN-03 (Phase 78): el catch captura `err` y adjunta el motivo acotado al log.
    assert.ok(
      /catch\s*\(\s*err\s*\)[\s\S]*?String\(\s*err\?\.message\s*\)\.slice\(\s*0\s*,\s*80\s*\)/.test(
        source,
      ),
      'el catch debe capturar `err` y loguear String(err?.message).slice(0,80) (IN-03)',
    );
  });

  it('KODO-54: sin grupo resuelto, launchWorkItem converge el sidebar TRAS crear el workspace (fail-open, vía host._legacy)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // La convergencia NO duplica la lógica del doctor: reusa su `convergeProject`.
    assert.ok(
      /import\(\s*'\.\.\/cmux\/sidebar-doctor\.js'\s*\)/.test(source),
      'la convergencia debe reusar convergeProject de src/cmux/sidebar-doctor.js (no duplicar el doctor)',
    );
    // Import DINÁMICO: evita el ciclo estático manager ↔ sidebar-doctor y no carga nada
    // cuando el grupo ya existía. Un `import ... from '../cmux/sidebar-doctor.js'`
    // estático reintroduciría el ciclo.
    assert.ok(
      !/^\s*import\s+[\s\S]*?from\s+'\.\.\/cmux\/sidebar-doctor\.js'/m.test(source),
      'sidebar-doctor.js debe importarse DINÁMICAMENTE (ciclo manager ↔ doctor)',
    );
    // Gate de ejecución: solo cuando había nombre esperado y NO se resolvió grupo.
    assert.ok(
      /if\s*\(\s*expectedName\s*&&\s*!groupRef\s*\)/.test(source),
      'la convergencia debe estar guardada por `if (expectedName && !groupRef)` (cero coste si el grupo ya existía)',
    );
    // Orden: DESPUÉS de crear el workspace (necesita el ref recién nacido).
    const wsIdx = source.indexOf('const workspaceRef = await newWorkspaceWithGroupFallback(');
    const convIdx = source.indexOf('if (expectedName && !groupRef)');
    assert.ok(wsIdx > 0 && convIdx > wsIdx, 'la convergencia debe ir DESPUÉS del newWorkspaceWithGroupFallback');
    // SC#5: los verbos mutadores salen de host._legacy, jamás de cmux/client.js.
    assert.ok(
      /host\._legacy\?\.createWorkspaceGroup/.test(source) && /host\._legacy\?\.addToWorkspaceGroup/.test(source),
      'los verbos create/add deben salir de host._legacy (walker cmux-isolation SC#5)',
    );
    // Allowlist no-destructivo: el launch jamás disuelve grupos.
    assert.ok(
      !/ungroupWorkspaceGroup/.test(source),
      'launchWorkItem no debe emitir ungroup — disolver grupos es del pase del doctor',
    );
    // Fail-open: todo el bloque en try/catch con log de una línea; nunca aborta el launch.
    assert.ok(
      /group_skipped — convergencia_fallo/.test(source),
      'el fallo de convergencia debe loguear `group_skipped — convergencia_fallo` (D-11, sin user content)',
    );
  });

  it('KODO-53: el aviso de "Nueva sesión lanzada" YA NO va por el carril de teclado — va a la bandeja', () => {
    // ESTE GATE SUSTITUYE al de la Phase 78 (WR-01/WR-02), que exigía envolver
    // task.ref/task.title/projectPath con `stripForKeystroke` en el texto de un
    // `host._legacy.send`. Ya no hay tal send: KODO-53 lo retiró por completo porque su
    // contenido era vacío por construcción — cuando el lanzamiento lo hace el orquestador
    // (el caso normal, `kodo launch` desde su propia ronda) le anunciaba algo que acababa
    // de ejecutar él mismo.
    //
    // La invariante de saneo NO se relaja, se MUEVE: el texto entra a la bandeja y su
    // saneo vive ahora en `buildOrchestratorEvent` (orchestrator/inbox.js), que aplica el
    // MISMO `stripForKeystroke` al `text` y al `task_ref` enteros — y es el sitio correcto,
    // porque el resumen de una línea que sale de ahí SÍ se teclea. Su cobertura está en
    // test/orchestrator-inbox.test.js §'SANEA task_ref y text'.
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Lección de la Phase 83-02, aplicada aquí: los gates negativos filtran los COMENTARIOS
    // antes de buscar. Los dos símbolos retirados se NOMBRAN en el comentario que explica
    // por qué se fueron, y un comentario que documenta la regla no puede poner roja la
    // suite — si no, la única salida es borrar la explicación.
    const code = source.replace(/^\s*\/\/.*$/gm, '');

    // 1. Nada del texto de lanzamiento puede viajar por un `send`.
    assert.ok(
      !/sendToOrchestrator/.test(code),
      'manager.js NO debe teclear nada al orquestador (sendToOrchestrator retirado, KODO-53)',
    );
    assert.ok(
      !/resolveOrchestratorTargets/.test(code),
      'sin keystroke no hay destinatario que resolver — resolveOrchestratorTargets fuera del código',
    );

    // 2. El evento SÍ existe: se encola, con su kind y sus tres campos.
    assert.ok(
      /import\s*\{[^}]*\benqueueOrchestratorEvent\b[^}]*\}\s*from\s*['"]\.\.\/orchestrator\/inbox\.js['"]/.test(source),
      'manager.js debe importar enqueueOrchestratorEvent desde ../orchestrator/inbox.js',
    );
    assert.ok(
      /kind:\s*'session-launched'/.test(source),
      'el evento de lanzamiento debe encolarse con kind session-launched',
    );
    assert.ok(
      /Nueva sesión lanzada: \$\{task\.ref\} \(\$\{task\.title\}\)[\s\S]*?Path: \$\{projectPath\}/.test(source),
      'el texto del evento conserva los mismos tres campos que llevaba el nudge',
    );

    // 3. El seam de aislamiento sobre la ESCRITURA: sin él, un test de ejecución de
    //    launchWorkItem encolaría en el ~/.kodo/state.json real (la fuga que KODO-20 cerró
    //    sobre la LECTURA, ahora en el otro sentido).
    assert.ok(
      /opts\.enqueueOrchestratorEventFn\s*\|\|\s*enqueueOrchestratorEvent/.test(source),
      'el encolado debe pasar por el seam opts.enqueueOrchestratorEventFn',
    );
  });

  it('Phase 78 (IN-04): los carriles NO-keystroke (nombre de workspace y body de notify) sanean task.title con stripControlChars', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // stripControlChars debe estar importado desde el carril canónico (cli/sanitize.js),
    // junto a stripForKeystroke. NO se importa cmux/client.js (invariante cmux-isolation).
    // Phase 87 (ISO-02): mismo cambio de carril que el caso de arriba — el saneador se
    // movió verbatim a la hoja `cli/sanitize.js`. El assert no pierde ni una condición.
    assert.ok(
      /import\s*\{[^}]*\bstripControlChars\b[^}]*\}\s*from\s*['"]\.\.\/cli\/sanitize\.js['"]/.test(source),
      'manager.js debe importar stripControlChars desde ../cli/sanitize.js (carril de render, IN-04)',
    );
    // El nombre del workspace (arg CLI de newWorkspace) sanea task.title ANTES de truncar.
    assert.ok(
      /workspaceName\s*=\s*`[^`]*\$\{truncate\(stripControlChars\(task\.title\)\s*,\s*40\)\}/.test(source),
      'workspaceName debe envolver task.title con stripControlChars antes de truncate (IN-04)',
    );
    // El body de la notificación de SO sanea task.title.
    assert.ok(
      /body:\s*`Lanzada sesión para: \$\{stripControlChars\(task\.title\)\}`/.test(source),
      'el body del notify debe envolver task.title con stripControlChars (IN-04)',
    );
    // Regresión negativa: task.title crudo NO debe reaparecer en esos dos sinks.
    assert.ok(
      !/\$\{truncate\(task\.title\s*,/.test(source),
      'task.title crudo (sin sanear) NO debe interpolarse en workspaceName (IN-04)',
    );
    assert.ok(
      !/Lanzada sesión para: \$\{task\.title\}/.test(source),
      'task.title crudo (sin sanear) NO debe interpolarse en el body del notify (IN-04)',
    );
  });

  it('Phase 77 (D-10): el newWorkspace usa newWorkspaceWithGroupFallback con host._legacy.newWorkspace y groupRef', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // La llamada directa a host._legacy.newWorkspace({...}) se sustituyó por el helper
    // de fallback, que recibe el fn como 1er arg y groupRef como 3er arg (capa 2).
    assert.ok(
      /newWorkspaceWithGroupFallback\(\s*host\._legacy\.newWorkspace\s*,\s*\{[^}]*\}\s*,\s*groupRef\s*,?\s*\)/.test(source),
      'launchWorkItem debe llamar newWorkspaceWithGroupFallback(host._legacy.newWorkspace, {...}, groupRef)',
    );
    // La llamada directa antigua NO debe reaparecer (o el retry D-10 se pierde).
    assert.ok(
      !/await\s+host\._legacy\.newWorkspace\(/.test(source),
      'la llamada directa `await host._legacy.newWorkspace(...)` debe pasar por el fallback (D-10)',
    );
  });

  it('Phase 77 GRP-04 · KODO-54: manager.js solo emite el allowlist NO-destructivo de grupos, y siempre vía host._legacy', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Sigue PROHIBIDO construir argv crudo de cmux: el vocabulario del binario vive en
    // src/cmux/client.js, y manager.js habla el contrato del host (SC#5).
    assert.ok(
      !/workspace-group['"\s]*[,\s]+['"]?(create|rename|delete|add|ungroup)/.test(source),
      'manager.js NO debe construir argv `workspace-group <verbo>` (el argv vive en cmux/client.js)',
    );
    // KODO-54 abre GRP-04 de forma ESTRECHA: el launch converge el grupo del proyecto
    // nuevo, así que `createWorkspaceGroup`/`addToWorkspaceGroup` pasan a ser admisibles.
    // Los DESTRUCTIVOS siguen fuera — disolver/renombrar/borrar grupos jamás es del launch.
    assert.ok(
      !/\b(renameWorkspaceGroup|deleteWorkspaceGroup|ungroupWorkspaceGroup|ungroupWorkspace)\b/.test(source),
      'manager.js NO debe invocar verbos destructivos de grupos (rename/delete/ungroup)',
    );
    // Y los dos admisibles SOLO pueden llegar por el passthrough del host: un uso suelto
    // (import de cmux/client.js, execFile propio) reabriría el leak que cierra el walker.
    for (const verb of ['createWorkspaceGroup', 'addToWorkspaceGroup']) {
      const uses = source.match(new RegExp(verb, 'g')) || [];
      const viaHost = source.match(new RegExp('host\\._legacy\\??\\.' + verb, 'g')) || [];
      // La otra forma admisible es la CLAVE del objeto de deps que se le pasa a
      // convergeProject (`createWorkspaceGroup: (o) => host._legacy...`): es el nombre
      // del slot de DI del doctor, no una invocación a cmux.
      const asDepKey = source.match(new RegExp(verb + '\\s*:\\s*\\(', 'g')) || [];
      assert.ok(uses.length > 0, `${verb} debe usarse (la convergencia KODO-54 lo necesita)`);
      assert.equal(
        uses.length,
        viaHost.length + asDepKey.length,
        `cada uso de ${verb} en manager.js debe salir de host._legacy.${verb} o ser la clave de deps (SC#5)`,
      );
    }
  });

  it('Phase 77 (GRP-04): buildSessionFromTask NO gana ningún campo de grupo (nada se persiste)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    // Aislar el cuerpo de buildSessionFromTask y verificar que ninguna clave
    // persistida contiene `group`. El ref workspace_group:N se pasa a newWorkspace
    // y se DESCARTA — nunca aterriza en el Session record (GRP-04, defensa Phase 43).
    const start = source.indexOf('export function buildSessionFromTask');
    assert.ok(start >= 0, 'buildSessionFromTask debe existir');
    const end = source.indexOf('export function resolveProjectPath');
    // IN-05 (Pitfall 4): el delimitador del slice debe seguir a buildSessionFromTask.
    // Si un futuro reorden pone resolveProjectPath ANTES, `end` (-1 o < start) haría que
    // `source.slice(start, end)` devuelva '' y el regex negativo pasaría VACUO con el
    // guard apagado. Este assert va ANTES de usar `body`.
    assert.ok(
      end > start,
      'resolveProjectPath debe seguir a buildSessionFromTask (delimitador del slice GRP-04)',
    );
    const body = source.slice(start, end);
    assert.ok(
      !/\bgroup\w*\s*:/.test(body),
      'buildSessionFromTask NO debe introducir ningún campo cuyo nombre contenga `group` (GRP-04)',
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

// ─────────────────────────────────────────────────────────────────────────────
// KODO-31 — el carril de los hosts que ENTREGAN el prompt al crear el workspace.
// ─────────────────────────────────────────────────────────────────────────────
describe('KODO-31 — buildSessionPrompt y el guard del send', () => {
  it('buildSessionPrompt produce EXACTAMENTE el prompt que buildClaudeCommand incrusta', async () => {
    // El invariante que hace segura la extracción: el prompt que se le manda a BB en el
    // spawn es, byte a byte, el que cmux/orca reciben dentro del `$(cat …)`.
    const { buildSessionPrompt } = await import('../src/session/manager.js');
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /const prompt = buildSessionPrompt\(task, description, moduleName\);/.test(source),
      'buildClaudeCommand debe consumir el helper, no duplicar la plantilla',
    );
    assert.equal(
      buildSessionPrompt(makeTask({ title: 'Fix login bug' }), 'Some markdown description', 'auth-module'),
      'Trabaja en: Fix login bug. Módulo: auth-module. Descripción: Some markdown description',
    );
  });

  it('buildSessionPrompt omite el módulo y la descripción cuando no los hay', async () => {
    const { buildSessionPrompt } = await import('../src/session/manager.js');
    assert.equal(buildSessionPrompt(makeTask({ title: 'X' }), '', null), 'Trabaja en: X.');
  });

  it('el send del launch path está guardado por `claudeCmd !== null`', () => {
    // Sin el guard, un host que ya entregó el prompt recibiría por `thread tell` el texto
    // literal `claude --model … "$(cat …)"` como si fuera un mensaje del humano.
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /if \(claudeCmd !== null\) \{\s*\n\s*await host\._legacy\.send\(\{ workspace: workspaceRef, text: claudeCmd \}\);/.test(source),
      'el send debe estar dentro de `if (claudeCmd !== null)`',
    );
  });

  it('el prompt del spawn se calcula ANTES de crear el workspace', () => {
    // `bb thread spawn --prompt` es obligatorio: si `spawnOpts` se resolviera después del
    // newWorkspace, el spawn saldría sin prompt y fallaría en el binario.
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    const spawnOptsIdx = source.indexOf('const spawnOpts = deliversPrompt');
    const newWsIdx = source.indexOf('const workspaceRef = await newWorkspaceWithGroupFallback(');
    assert.ok(spawnOptsIdx > 0 && newWsIdx > spawnOptsIdx, 'spawnOpts debe resolverse antes del newWorkspace');
  });

  it('el permiso viaja como booleano host-agnóstico, no como el literal de BB', () => {
    // El vocabulario de permisos de cada host vive en su adapter (`permissionModeFor`).
    // Un `'full'` literal aquí ataría manager.js al dialecto de BB.
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(/skipPermissions:/.test(source), 'debe pasar skipPermissions');
    assert.ok(
      !/permissionMode:\s*['"]/.test(source),
      "manager.js no debe cablear literales de permission-mode ('full'/'accept-edits')",
    );
  });

  it('spawnOpts es {} para los hosts que NO entregan el prompt (cero regresión)', () => {
    const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
    assert.ok(
      /const spawnOpts = deliversPrompt[\s\S]{0,800}?\n\s*: \{\};/.test(source),
      'la rama else de spawnOpts debe ser el objeto vacío',
    );
  });
});
