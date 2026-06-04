// @ts-check
import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// NO importar stop.js estáticamente: arrastra state.js → config.js, que calcula
// KODO_DIR = join(homedir(), '.kodo') al module-load. Si se carga ANTES de que
// un test fije process.env.HOME=tmpHome, KODO_DIR queda apuntando al ~/.kodo REAL
// y runStopHook/addSession corrompen el state del usuario al correr la suite
// (bug cazado en UAT live de Phase 38). Los símbolos de stop.js se cargan
// dinámicamente DESPUÉS de aislar HOME (ver before() de cada describe).

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOP_SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'stop.js');
// Phase 41 Plan 01 (D-11): el bloque de saneo del worktree se factorizó verbatim
// a src/hooks/worktree-cleanup.js. Los source-guards de los invariantes Phase 19
// (orden branch-before-remove, lstatSync symlink-safe) ahora apuntan al helper,
// donde el código vive — el comportamiento sigue siendo idéntico (el test
// contractual stop-worktree-cleanup.test.js permanece verde sin cambios).
const CLEANUP_SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'worktree-cleanup.js');

describe('stop.js source hygiene', () => {
  it('does not import PlaneClient', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'stop.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import from plane/client');
  });

  it('does not touch Plane state (no updateTaskState, no addComment calls)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('updateTaskState'), 'hook must not move Plane state — the active session does that');
    assert.ok(!source.includes('addComment'), 'hook must not post comments — the active session does that');
  });

  it('does not import provider registry', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('initRegistry'), 'hook should not initialize registry');
    assert.ok(!source.includes('getProvider'), 'hook should not fetch a provider');
  });

  it('imports releaseGsdLock from gsd/lock.js for GSD cleanup (D-09)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /releaseGsdLock/, 'stop.js must reference releaseGsdLock for GSD lock cleanup');
  });

  it('guards lock release behind session.gsd check', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /session\.gsd/, 'lock release must be conditional on session.gsd');
  });

  it('releases lock before removeSession (order matters)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
    // Phase 16 (LOG-15): main() refactor a runStopHook(input, deps) renombró el
    // call site de removeSession(id) a removeSessionFn(id). Aceptamos ambas
    // variantes — lo crítico es el orden, no el nombre del binding local.
    const removeFnIdx = source.indexOf('removeSessionFn(id)');
    const removeIdx = removeFnIdx >= 0 ? removeFnIdx : source.indexOf('removeSession(id)');
    assert.ok(removeIdx > 0, 'must find removeSessionFn(id) or removeSession(id) call');
    assert.ok(lockIdx < removeIdx, 'releaseGsdLock must come before remove call');
  });

  it('uses dynamic import for gsd/lock.js (lazy load)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.match(source, /await import\(.*gsd\/lock/, 'must use dynamic import for lock module');
  });

  it('QUICK-08: no inline `session.gsd_mode || "full"` (Phase 13 D-09 anti-inline)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(
      !/session\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
      'stop.js must use getSessionMode(session), not inline `session.gsd_mode || "full"` (Phase 13 D-09)',
    );
  });

  it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    assert.ok(
      !/\.gsd_mode\b/.test(stripped),
      'src/hooks/stop.js must not access .gsd_mode directly. Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
    );
  });

  it('QUICK-08: case "quick" block in source does NOT contain `kodo gsd verify` (Phase 13 D-11 source guard complementing behavior test)', () => {
    // Captura el bloque del case 'quick' por regex y verifica que no
    // contiene la subcadena `kodo gsd verify`. Si alguien refactoriza
    // el switch y reintroduce el verify nudge en quick, este test
    // falla además del behavior test.
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const quickCaseMatch = source.match(/case\s+['"]quick['"]:[\s\S]*?(?=case\s+['"]full['"]|case\s+['"]default['"]|\bdefault\s*:)/);
    assert.ok(quickCaseMatch, 'must find case "quick" block in source');
    assert.ok(
      !quickCaseMatch[0].includes('kodo gsd verify'),
      'case "quick" block must NOT contain `kodo gsd verify` (CLI does not support quick mode)',
    );
  });

  it('Phase 19 D-07: worktree cleanup happens AFTER releaseGsdLock', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const lockIdx = source.indexOf('releaseGsdLock(session.project_path');
    assert.ok(lockIdx > 0, 'must find releaseGsdLock call site');
    // Phase 41 D-11: el cleanup se delega al helper compartido `cleanupWorktree`.
    // El call site en stop.js es el marker del orden — si alguien reordena y el
    // saneo queda antes de releaseGsdLock, este test falla.
    const cleanupIdx = source.indexOf('cleanupWorktree({');
    assert.ok(cleanupIdx > 0, 'must find cleanupWorktree({ call site in stop.js');
    assert.ok(
      lockIdx < cleanupIdx,
      'cleanup must come AFTER releaseGsdLock (Phase 19 D-07)',
    );
  });

  it('Phase 19 D-08 / Pitfall #2: branch --show-current is read BEFORE worktree remove (helper)', () => {
    // Phase 41 D-11: el orden branch-before-remove vive ahora en el helper
    // worktree-cleanup.js (verbatim desde stop.js). El source-guard sigue el
    // código a su nueva ubicación; el comportamiento es idéntico.
    const source = readFileSync(CLEANUP_SOURCE_PATH, 'utf-8');
    const showCurrentIdx = source.indexOf("'--show-current'");
    const removeMatches = [];
    const re = /'worktree',\s*'remove'/g;
    let m;
    while ((m = re.exec(source)) !== null) removeMatches.push(m.index);
    const removeIdx = removeMatches[0] ?? -1;
    assert.ok(showCurrentIdx > 0, 'must reference branch --show-current');
    assert.ok(removeIdx > 0, 'must reference worktree remove');
    assert.ok(
      showCurrentIdx < removeIdx,
      'branch --show-current must precede worktree remove (Pitfall #2 / D-08)',
    );
  });

  it('Phase 19 D-05 (WT-05 satisfied-by-design): handleOrchestratorStop preserves cwd: KODO_ROOT', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    const match = source.match(/async function handleOrchestratorStop[\s\S]*?\n}/);
    assert.ok(match, 'must find handleOrchestratorStop function');
    assert.ok(
      match[0].includes('cwd: KODO_ROOT'),
      'handleOrchestratorStop must preserve cwd: KODO_ROOT (Phase 19 D-05; auto-commit excluded from worktree per Phase 18 D-06)',
    );
  });

  it('Phase 19 CR-02 / Phase 38 D-12: markSessionStatus invoked OUTSIDE the if (session.gsd) block, con estado idle', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    // Phase 38 D-12: el caller migró de 'done'/'session-stop' a
    // 'idle'/'session-stop:lock-released' — el stop hook ya no marca la sesión
    // como muerta sino como "lock liberado, esperando humano" (fix raíz de
    // ROMAN-151/152). El invariante de UBICACIÓN de CR-02 (mark FUERA del bloque
    // if (session.gsd), aplica a todas las sesiones) se preserva.
    const markIdx = source.indexOf("markSessionStatus(session.task_id, 'idle', 'session-stop:lock-released'");
    assert.ok(markIdx > 0, "must find markSessionStatus con estado 'idle' (Phase 38 D-12)");
    // Buscar el `if (session.gsd) {` que contiene `releaseGsdLock`. Patrón robusto:
    // captura el bloque if (session.gsd) seguido (en pocas líneas) de releaseGsdLock.
    const ifGsdRegex = /if\s*\(session\.gsd\)\s*\{[\s\S]{0,500}releaseGsdLock/;
    const ifMatch = ifGsdRegex.exec(source);
    assert.ok(ifMatch, 'must find if (session.gsd) { ... releaseGsdLock block');
    assert.ok(
      markIdx < ifMatch.index,
      'markSessionStatus must be invoked BEFORE the if (session.gsd) { releaseGsdLock } block (Phase 19 CR-02 ubicación preservada)',
    );
    // Phase 38 D-12: el caller real ya NO emite 'done' (el shim solo cubre
    // callers legacy externos). Sanity: ningún caller real en stop.js emite 'done'.
    assert.equal(
      source.indexOf("markSessionStatus(session.task_id, 'done'"),
      -1,
      "Phase 38 D-12: stop.js ya no emite 'done' (migrado a 'idle')",
    );
  });

  it('Phase 19 CR-03: dirty target pre-check uses lstatSync (NOT existsSync) — symlink-safe (helper)', () => {
    // Phase 41 D-11: el pre-check symlink-safe vive ahora en el helper
    // worktree-cleanup.js. El source-guard sigue el código a su nueva ubicación.
    const source = readFileSync(CLEANUP_SOURCE_PATH, 'utf-8');
    assert.ok(
      source.includes('lstatSync(target)'),
      'pre-check must use lstatSync(target) per Phase 19 CR-03 (symlink-safe)',
    );
    // existsSync NO debe aparecer en el helper — el único uso era el pre-check
    // que se sustituyó por lstatSync (CR-03). Si reaparece, regresión.
    assert.equal(
      source.indexOf('existsSync'),
      -1,
      'existsSync must NOT appear in worktree-cleanup.js after CR-03 fix (symlink-following risk)',
    );
    // Sanity: el comentario referencia la decisión.
    assert.ok(
      /Phase 19 CR-03/.test(source),
      'comment must reference Phase 19 CR-03 for traceability',
    );
  });
});

describe('QUICK-08 — buildStopNudgeText switch', () => {
  // HOME-isolation + carga dinámica POST-HOME: buildStopNudgeText es pura, pero
  // importar stop.js arrastra state.js (KODO_DIR al module-load). Aislamos HOME
  // antes de cargarlo para no fijar KODO_DIR al ~/.kodo real (ni siquiera estos
  // tests puros deben tocar el state del usuario al cargar el módulo).
  let tmpHome;
  let origHome;
  let buildStopNudgeText;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-stop-nudge-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    ({ buildStopNudgeText } = await import('../src/hooks/stop.js'));
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  function makeQuickSession(overrides = {}) {
    return {
      workspace_ref: 'workspace:1',
      session_id: 'sess-quick-123',
      task_id: 'tid',
      task_ref: 'KL-42',
      provider: 'plane',
      project_id: 'p1',
      summary: 'Quick task',
      status: 'review',
      started_at: '2026-04-29T00:00:00.000Z',
      project_path: '/tmp/proj',
      ...overrides,
    };
  }

  it('QUICK-08: case "quick" — text omits `kodo gsd verify`, mentions sin VERIFICATION.md, asks manual review, idioma ES (Phase 12 D-08)', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'quick' }));
    assert.ok(!text.includes('kodo gsd verify'), 'quick case must NOT mention `kodo gsd verify` (CLI does not support quick)');
    assert.match(text, /sin VERIFICATION\.md/, 'quick case must mention sin VERIFICATION.md');
    assert.match(text, /Revísala manualmente/, 'quick case must ask for manual review');
    assert.match(text, /La sesión KL-42/, 'preserves base sentence opener');
    assert.match(text, /Es una sesión GSD quick/, 'identifies session as GSD quick');
    // Idioma ES (D-16 Phase 10 carry-forward)
    assert.ok(!/\bplease\b|\byou must\b/i.test(text), 'must be Spanish, no English keywords');
    // Phase 10 \\n literal preservado (cmux.send interpreta como Enter)
    assert.ok(text.endsWith('\\n'), 'must end with literal \\\\n (cmux Enter)');
  });

  it('QUICK-08: case "full" with phase_id — includes `kodo gsd verify <session-id>` and `fase N` (Phase 10 D-04 preserved)', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full', phase_id: '10' }));
    assert.match(text, /kodo gsd verify sess-quick-123/, 'must include session-id in verify command');
    assert.match(text, /fase 10/, 'phase_id renders as "fase N"');
    assert.match(text, /actúa según el verdict/, 'instructive ES text preserved');
  });

  it('QUICK-08: case "full" without phase_id (bootstrap) — verify command + "bootstrap" fallback', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full' }));
    assert.match(text, /kodo gsd verify sess-quick-123/);
    assert.match(text, /\(bootstrap\)/, 'phase_label fallback "bootstrap" when phase_id absent');
  });

  it('QUICK-08: legacy gsd:true without gsd_mode reads as full (Phase 11 D-08) — verify nudge present', () => {
    // Sesión v0.3 legacy persistida en state.json antes de Phase 11.
    // getSessionMode aplica la regla "ausente == full" → cae en case 'full'.
    const text = buildStopNudgeText(makeQuickSession({ gsd: true, phase_id: '5' /* sin gsd_mode */ }));
    assert.match(text, /kodo gsd verify sess-quick-123/, 'legacy session reads as full → verify nudge');
    assert.match(text, /fase 5/);
  });

  it('QUICK-08: default (non-GSD) — original Phase 10 text, no verify, no quick mention', () => {
    const text = buildStopNudgeText(makeQuickSession({ gsd: false }));
    assert.match(text, /Revisa el resultado y decide si pasa a Done/);
    assert.ok(!text.includes('kodo gsd verify'), 'non-GSD must not suggest verify');
    assert.ok(!text.includes('quick'), 'non-GSD must not mention quick');
  });
});

// Phase 33-03 LIFE-02-FOLLOWUP (Bloque C): el callsite de markSessionStatus en
// runStopHook consume el return discriminado {ok, reason} (simétrico con verify.js,
// D-01). Cuando ok === false (task_id falsy → 'missing-task-id'), stop.js emite
// log.warn('markSessionStatus.skipped', {reason, session_id}) DENTRO del try WR-03
// existente y continúa (fail-open preservado, cero throws nuevos).
//
// Patrón de logger memSink + cmux stub + HOME override idéntico a
// test/stop-state-transition.test.js (DI completa W-4 vía runStopHook).
describe('Phase 33-03: stop hook consume markSessionStatus return (markSessionStatus.skipped)', () => {
  let tmpHome;
  let origHome;
  let addSession;
  let removeSession;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-test-stop-skipped-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    const stateMod = await import('../src/session/state.js');
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  const writtenTaskIds = [];
  afterEach(() => {
    while (writtenTaskIds.length > 0) {
      const tid = writtenTaskIds.pop();
      try { removeSession(tid); } catch {}
    }
  });

  function makeLogger() {
    const events = [];
    const logger = {
      info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
      warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
      error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
      debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
      child: () => logger,
    };
    return { logger, events };
  }

  function makeCmuxStub() {
    return {
      setColor: async () => {},
      notify: async () => {},
      listWorkspaces: async () => '',
      send: async () => {},
    };
  }

  it('Phase 33-03: markSessionStatus ok===false → emite markSessionStatus.skipped con {reason, session_id}', async () => {
    // task_id '' (falsy) → markSessionStatus early-return {ok:false,
    // reason:'missing-task-id'} sin tocar state.json.
    const session = {
      session_id: 's-skip-1',
      task_id: '',
      task_ref: 'KL-skip-1',
      gsd: true,
      gsd_mode: 'full',
      status: 'review',
      project_path: '/tmp/repo-skip',
      provider: 'plane',
      project_id: 'p-skip',
      workspace_ref: 'workspace:1',
      started_at: new Date().toISOString(),
      summary: 'test session skipped',
    };
    const { logger, events } = makeLogger();
    const findSessionFn = ({ sessionId }) =>
      sessionId === session.session_id ? { id: session.task_id, session } : null;
    const removeSessionFn = () => {};

    const { runStopHook } = await import('../src/hooks/stop.js');
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      { findSessionFn, removeSessionFn, cmux: makeCmuxStub(), loggerFactory: () => logger },
    );

    const skipped = events.find((e) => e.msg === 'markSessionStatus.skipped');
    assert.ok(skipped, 'debe emitir markSessionStatus.skipped cuando ok === false');
    assert.equal(skipped.level, 'warn', 'markSessionStatus.skipped es nivel warn');
    assert.equal(skipped.fields.reason, 'missing-task-id', 'payload reason del union discriminado');
    assert.equal(skipped.fields.session_id, session.session_id, 'payload session_id en scope local');
  });

  it('Phase 33-03: markSessionStatus ok===true → NO emite markSessionStatus.skipped (no-regresión happy path)', async () => {
    const session = {
      session_id: 's-ok-1',
      task_id: 'kodo-test-stop-skipped-ok-1',
      task_ref: 'KL-ok-1',
      gsd: true,
      gsd_mode: 'full',
      status: 'review',
      project_path: '/tmp/repo-ok',
      provider: 'plane',
      project_id: 'p-ok',
      workspace_ref: 'workspace:2',
      started_at: new Date().toISOString(),
      summary: 'test session ok',
    };
    writtenTaskIds.push(session.task_id);
    addSession(session.task_id, session); // persistido → ok:true
    const { logger, events } = makeLogger();
    const findSessionFn = ({ sessionId }) =>
      sessionId === session.session_id ? { id: session.task_id, session } : null;
    const removeSessionFn = () => {};

    const { runStopHook } = await import('../src/hooks/stop.js');
    await runStopHook(
      { session_id: session.session_id, cwd: session.project_path },
      { findSessionFn, removeSessionFn, cmux: makeCmuxStub(), loggerFactory: () => logger },
    );

    // Sanity: el happy path sí emite state.transition (markSessionStatus ok).
    const transition = events.find((e) => e.fields?.event === 'state.transition');
    assert.ok(transition, 'happy path debe emitir state.transition (markSessionStatus ok)');
    const skipped = events.find((e) => e.msg === 'markSessionStatus.skipped');
    assert.equal(skipped, undefined, 'happy path (ok===true) NO debe emitir markSessionStatus.skipped');
  });
});
