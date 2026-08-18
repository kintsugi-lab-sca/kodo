// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkPendingTasks, runCheckAndAct } from '../src/check.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECK_SOURCE_PATH = join(__dirname, '..', 'src', 'check.js');

/**
 * Build a fake provider with all TaskProvider methods. Only listPendingTasks is
 * meaningfully overridden for each test.
 * @param {{ listPendingTasks?: () => Promise<any[]> }} overrides
 */
function createFakeProvider(overrides = {}) {
  return {
    init: async () => {},
    getTask: async () => ({}),
    updateTaskState: async () => {},
    addComment: async () => {},
    listPendingTasks: overrides.listPendingTasks || (async () => []),
    parseTriggerEvent: () => null,
    verifySignature: () => false,
    resolveRef: async () => '',
  };
}

const BASE_CONFIG = {
  provider: 'test',
  providers: { test: {} },
  claude: { max_parallel: 3 },
};

describe('check.js — checkPendingTasks (pure)', () => {
  it('Test 1: calls provider.listPendingTasks() and reports count when pending > 0 and slots available', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [
        { id: '1', ref: 'KL-1' },
        { id: '2', ref: 'KL-2' },
      ],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 1,
      getProviderFn: () => provider,
    });

    assert.match(result.lines.join('\n'), /2 pending/);
    assert.ok(
      result.reasons.some((r) => r.includes('2 tarea')),
      `Expected reasons to include "2 tarea", got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('does not add reasons when no slots available', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 3, // max_parallel reached
      getProviderFn: () => provider,
    });

    assert.equal(result.reasons.length, 0);
  });

  it('does not add reasons when no pending tasks', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    assert.equal(result.reasons.length, 0);
  });

  it('Test 3: handles provider error gracefully (no throw, includes error in output)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('network down');
      },
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    const output = result.lines.join('\n');
    assert.match(output, /Error checking tasks/);
    assert.match(output, /network down/);
  });

  it('Test 4: skips pending check when provider not configured (no crash)', async () => {
    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => {
        throw new Error('Unknown provider: test');
      },
    });

    // Should return gracefully with an error line, not throw
    assert.ok(result);
    assert.equal(result.reasons.length, 0);
    assert.match(result.lines.join('\n'), /Error checking tasks/);
  });

  it('Test 5a: pending output uses yellow ANSI color (via formatter, TTY)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      // env={} so the test does not inherit NO_COLOR / FORCE_COLOR=0 from the caller.
      formatterFn: () => createFormatter({ isTTY: true }, {}),
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[33m/,
      'Expected yellow (\\x1b[33m) for pending warning',
    );
  });

  it('Test 5b: error output uses red ANSI color (via formatter, TTY)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('boom');
      },
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: true }, {}),
    });

    assert.match(
      result.lines.join('\n'),
      /\x1b\[31m/,
      'Expected red (\\x1b[31m) for error',
    );
  });

  it('Test 5d: no ANSI escapes when formatter is non-TTY (NO_COLOR-equivalent)', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }],
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: false }, {}),
    });

    const out = result.lines.join('\n');
    assert.doesNotMatch(out, /\x1b\[/, 'No ANSI escapes expected with isTTY=false');
    assert.match(
      out,
      /\[kodo:check\] 1 pending kodo task\(s\)/,
      'Plain text shape preserved',
    );
  });

  it('Test 5d-error: no ANSI escapes for error path when non-TTY', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('boom');
      },
    });
    const { createFormatter } = await import('../src/cli/format.js');

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
      formatterFn: () => createFormatter({ isTTY: false }, {}),
    });

    const out = result.lines.join('\n');
    assert.doesNotMatch(out, /\x1b\[/, 'No ANSI escapes expected with isTTY=false');
    assert.match(
      out,
      /\[kodo:check\] Error checking tasks: boom/,
      'Plain text error shape preserved',
    );
  });

  // Phase 76 Plan 02 (ORCH-05 / D-07): after routing through fetchFreshPending the sane
  // `/N pending/` line must stay byte-identical, and the red error line must still carry
  // the REAL err.message (fetchFreshPending propagates the throw raw — no wrapping).
  it('ORCH-05: routes through fetchFreshPending, sane /N pending/ line byte-identical', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => [{ id: '1', ref: 'KL-1' }, { id: '2', ref: 'KL-2' }],
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    const out = result.lines.join('\n');
    assert.match(out, /\[kodo:check\] 2 pending kodo task\(s\), 3 slot\(s\) available/);
    assert.ok(
      result.reasons.some((r) => r.includes('2 tarea')),
      `Expected reasons to include "2 tarea", got: ${JSON.stringify(result.reasons)}`,
    );
  });

  it('ORCH-05/D-07: fetchFreshPending propagates the throw — real err.message in red line', async () => {
    const provider = createFakeProvider({
      listPendingTasks: async () => {
        throw new Error('network down');
      },
    });

    const result = await checkPendingTasks({
      config: BASE_CONFIG,
      runningCount: 0,
      getProviderFn: () => provider,
    });

    assert.match(
      result.lines.join('\n'),
      /\[kodo:check\] Error checking tasks: network down/,
      'real err.message must survive fetchFreshPending (raw propagation, D-07)',
    );
  });
});

describe('check.js — source invariants', () => {
  it('Test 2: source file does NOT import or reference PlaneClient', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.ok(
      !source.includes('PlaneClient'),
      'check.js must not reference PlaneClient',
    );
    assert.ok(
      !source.includes("from './plane/client.js'"),
      'check.js must not import from ./plane/client.js',
    );
  });

  it('imports initRegistry and getProvider from providers/registry.js', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(source, /initRegistry/, 'check.js must reference initRegistry');
    assert.match(source, /getProvider/, 'check.js must reference getProvider');
    assert.match(
      source,
      /from ['"]\.\/providers\/registry\.js['"]/,
      'check.js must import from ./providers/registry.js',
    );
  });

  it('Test 5c: imports createFormatter from ./cli/format.js (Phase 15 wiring)', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /import \{ createFormatter \} from ['"]\.\/cli\/format\.js['"]/,
      'check.js must import createFormatter from ./cli/format.js',
    );
  });

  it('Test 5c: contains no ANSI inline literals (D-09 cleanup)', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.doesNotMatch(
      source,
      /ANSI_(YELLOW|RED|RESET)/,
      'check.js must not declare ANSI_* literals (use formatter instead)',
    );
    assert.doesNotMatch(
      source,
      /\\x1b\[/,
      'check.js must not contain raw \\x1b ANSI escapes (use formatter instead)',
    );
  });

  it('Test 5e: All clear path uses fmt.ok with ✓-leading order (D-10 byte-order change)', () => {
    // runCheck() does not accept formatterFn DI (Option A — fmt local). The visible
    // ✓-leading bytes are produced by `fmt.ok('All clear')` in src/check.js, which
    // expands to `${OK_SYMBOL} ${pc.green(s)}` per format.js:165.
    // Color (green) is covered by test/format.test.js Phase 14; here we only assert
    // the source uses fmt.ok and that the pre-Phase-15 trailing-✓ shape is gone.
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    assert.match(
      source,
      /fmt\.ok\(['"]All clear['"]\)/,
      'check.js must call fmt.ok(\'All clear\') (✓ is prepended by the helper)',
    );
    assert.doesNotMatch(
      source,
      /All clear ✓/,
      'Pre-Phase-15 trailing-✓ shape must be gone',
    );
  });
});

// Phase 80 Plan 01 (ORCH-07): el carril orquestador ejecuta el `--fix` del sidebar
// doctor IN-PROCESS de piggyback en `runCheckAndAct`, gated por `needsOrchestrator`,
// ANTES de `launchOrchestrator`, fail-open, y sin alimentar jamás el gate (D-03/04/05).
describe('check.js — runCheckAndAct sidebar doctor piggyback (ORCH-07)', () => {
  /** SidebarResult vacío (0 acciones). */
  function emptyResult() {
    return { created: 0, added: 0, ungrouped: 0, errors: [] };
  }

  it('Test A: gate ON — executeFn recibe { fix: true } y corre ANTES de launchFn (orden D-05)', async () => {
    const order = [];
    let execArgs = null;
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
      executeFn: async (_deps, opts) => { order.push('execute'); execArgs = opts; return emptyResult(); },
      launchFn: async () => { order.push('launch'); },
      logFn: () => {},
      errorFn: () => {},
    });

    assert.deepEqual(execArgs, { fix: true }, 'executeFn debe recibir { fix: true }');
    assert.ok(
      order.indexOf('execute') < order.indexOf('launch'),
      `execute debe correr ANTES de launch (D-05), got: ${JSON.stringify(order)}`,
    );
  });

  it('Test B: gate OFF (All clear) — cero llamadas a execute/launch (edge a, D-03)', async () => {
    const calls = [];
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: false, reasons: [], summary: 's' }),
      executeFn: async () => { calls.push('execute'); return emptyResult(); },
      launchFn: async () => { calls.push('launch'); },
      logFn: () => {},
      errorFn: () => {},
    });

    assert.deepEqual(calls, [], 'con needsOrchestrator=false el carril NO corre (edge a)');
  });

  it('Test C: invariante D-04 (edge c) — un sidebar sucio con check limpio NO dispara el carril', async () => {
    const calls = [];
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: false, reasons: [], summary: 's' }),
      // El doctor CONVERGERÍA 3 categorías si corriera; con el gate cerrado ni se le llama.
      executeFn: async () => { calls.push('execute'); return { created: 1, added: 1, ungrouped: 1, errors: [] }; },
      launchFn: async () => { calls.push('launch'); },
      logFn: () => {},
      errorFn: () => {},
    });

    // El drift del doctor NUNCA re-entra al gate: needsOrchestrator=false ⇒ nada corre.
    assert.deepEqual(calls, [], 'el resultado del doctor jamás convierte el gate en true (D-04)');
  });

  it('Test D: fail-open (edge b) — executeFn que lanza NO propaga y launchFn corre igual (D-05)', async () => {
    const order = [];
    await assert.doesNotReject(
      runCheckAndAct({
        runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
        executeFn: async () => { throw new Error('boom'); },
        launchFn: async () => { order.push('launch'); },
        logFn: () => {},
        errorFn: () => {},
      }),
    );
    assert.deepEqual(order, ['launch'], 'launch corre pese al throw de execute (fail-open)');
  });

  it('Test E: runCheck() byte-idéntico — su cuerpo NO contiene líneas Sidebar (Pitfall 4)', () => {
    const source = readFileSync(CHECK_SOURCE_PATH, 'utf-8');
    const runCheckStart = source.indexOf('export async function runCheck(');
    const runCheckAndActStart = source.indexOf('export async function runCheckAndAct(');
    assert.ok(runCheckStart >= 0 && runCheckAndActStart > runCheckStart, 'ambas funciones deben existir');
    const runCheckBody = source.slice(runCheckStart, runCheckAndActStart);
    assert.doesNotMatch(
      runCheckBody,
      /Sidebar/,
      'runCheck() no debe contener el piggyback (vive solo en runCheckAndAct)',
    );
  });

  // Phase 85 D-08 (WR-01 de 80-REVIEW): los literales del piggyback no tenían un solo
  // assert en toda la suite. Los dos `it` siguientes cierran ese hueco y fijan el canal
  // de la línea de fallos.
  //
  // stdout y stderr se capturan en DOS arrays SEPARADOS y se aseveran por pertenencia
  // dentro de cada uno: el orden RELATIVO entre canales NO es contractual (streams
  // independientes), así que un assert de secuencia mezclada sería flaky por
  // construcción (85-UI-SPEC §S-2, «Advertencia de contrato para el test»).
  it('Test F: gate ON + fallos por-item — las 2 líneas salen por su canal (WR-01)', async () => {
    const logs = [];
    const errs = [];
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
      // KODO-14: `created` cuenta en `applied` — el doctor vuelve a crear grupos
      // (`create --from`), así que omitirlo escondería una categoría entera del conteo.
      // Los tres sumandos son DISTINTOS por diseño (1/2/3 → applied=6, failed=2) para que
      // ningún falso verde pase por coincidencia numérica.
      executeFn: async () => ({
        created: 1,
        added: 2,
        ungrouped: 3,
        errors: [
          { category: 'loose_workspace', target: 'workspace:2', reason: 'cmux no responde' },
          { category: 'empty_group', target: 'workspace_group:3', reason: 'cmux no responde' },
        ],
      }),
      launchFn: async () => {},
      logFn: (m) => logs.push(m),
      errorFn: (m) => errs.push(m),
    });

    assert.ok(
      logs.includes('[kodo:check] Sidebar: 6 acción(es) aplicadas'),
      `applied debe sumar created + added + ungrouped (1 + 2 + 3 = 6). logs: ${JSON.stringify(logs)}`,
    );
    assert.ok(
      errs.some((m) => m.includes('2 acción(es) fallida(s)')),
      `r.errors debe hacerse visible por errorFn (WR-01): hoy 0 aplicadas significa a la vez ` +
        `«nada que arreglar» y «cmux caído». errs: ${JSON.stringify(errs)}`,
    );
    assert.ok(
      !logs.some((m) => m.includes('fallida')),
      `la línea de fallos NO puede salir por logFn: un fallo escrito en el canal del éxito sigue ` +
        `siendo invisible en un pipe. Sin esta mitad, una regresión de canal pasaría en verde. ` +
        `logs: ${JSON.stringify(logs)}`,
    );
  });

  it('Test G: gate ON sin fallos — errors vacío o ausente NO emite ninguna línea por errorFn (WR-01)', async () => {
    // (a) errors: [] ⇒ silencio. Hoy nadie asevera esta rama: los casos A/D pasan
    // `errorFn: () => {}` y descartan el output.
    const errsEmpty = [];
    await runCheckAndAct({
      runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
      executeFn: async () => emptyResult(),
      launchFn: async () => {},
      logFn: () => {},
      errorFn: (m) => errsEmpty.push(m),
    });
    assert.deepEqual(errsEmpty, [], 'con errors: [] no se emite ninguna línea por errorFn');

    // (b) objeto SIN campo `errors` ⇒ tampoco lanza (congela el guard `|| []` defensivo
    // que la Task 2 escribe; sin él sería un TypeError tragado por el catch fail-open,
    // que emitiría la línea «Sidebar doctor error» y falsearía el silencio).
    const errsAbsent = [];
    await assert.doesNotReject(
      runCheckAndAct({
        runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
        executeFn: async () => ({ created: 0, added: 0, ungrouped: 0 }),
        launchFn: async () => {},
        logFn: () => {},
        errorFn: (m) => errsAbsent.push(m),
      }),
    );
    assert.deepEqual(errsAbsent, [], 'un result sin campo errors se trata como cero fallos, nunca como throw');
  });
});
