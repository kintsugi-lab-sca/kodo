// @ts-check
//
// test/review/cycle.test.js — KODO-75: el bucle coder ↔ reviewer, su tope y su escalada.
//
// Lo que congela este fichero es el contrato «NUNCA en silencio»: no hay entrada que salga de
// `deriveCycleDisposition` por un hueco sin decisión, y las tres formas de quedarse sin salida
// automática (tope agotado, reviewer mudo, artefacto ilegible) acaban las tres en una escalada
// visible en la bandeja del orquestador.
//
// AISLAMIENTO DEL HOME OBLIGATORIO, con la misma trampa que documentan
// `test/integration/queue.test.js:5-13` y `test/state/handoff-state.test.js:11-17`:
// `config.js` evalúa `join(homedir(), '.kodo')` en MODULE-LOAD y `state.js` deriva STATE_PATH
// de ahí. Un import ESTÁTICO de cycle.js en la cabecera escribiría en el `~/.kodo` REAL del
// operador en cada `npm test`. De ahí el `process.env.HOME = tmpHome` ANTES del
// `await import(...)` dentro de `before()`.
//
// SEMBRADO v3 igual de obligatorio (misma referencia): sin fichero en disco `loadState`
// devuelve la forma v2, y la siguiente carga dispararía `migrateStateV2toV3`, cuya
// reconstrucción exhaustiva DESCARTA toda clave desconocida — `review_cycles` incluida.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
/** @type {typeof import('../../src/review/cycle.js').openReviewCycle} */
let openReviewCycle;
/** @type {typeof import('../../src/review/cycle.js').recordReviewOutcome} */
let recordReviewOutcome;
/** @type {typeof import('../../src/review/cycle.js').deriveCycleDisposition} */
let deriveCycleDisposition;
/** @type {typeof import('../../src/review/cycle.js').listReviewCycles} */
let listReviewCycles;
/** @type {typeof import('../../src/review/cycle.js').getReviewCycle} */
let getReviewCycle;
/** @type {typeof import('../../src/review/cycle.js').resolveMaxRounds} */
let resolveMaxRounds;
/** @type {typeof import('../../src/review/cycle.js').buildEscalationText} */
let buildEscalationText;
let DEFAULT_MAX_ROUNDS;

const STATE_REL = ['.kodo', 'state.json'];

function writeSeed(extra = {}) {
  writeFileSync(
    join(tmpHome, ...STATE_REL),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2) + '\n',
  );
}

function readRawState() {
  return JSON.parse(readFileSync(join(tmpHome, ...STATE_REL), 'utf-8'));
}

/** Estado de revisión sintético — la entrada que `review/artifacts.js` produciría. */
function rs(state, round = 0, extra = {}) {
  return /** @type {any} */ ({ state, round, ...extra });
}

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-cycle-home-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeSeed();
  const mod = await import('../../src/review/cycle.js');
  ({
    openReviewCycle, recordReviewOutcome, deriveCycleDisposition,
    listReviewCycles, getReviewCycle, resolveMaxRounds, buildEscalationText,
    DEFAULT_MAX_ROUNDS,
  } = mod);
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  writeSeed();
});

/** Abre un ciclo estándar. */
function open(overrides = {}) {
  return openReviewCycle({
    task_id: 'uuid-75',
    task_ref: 'KODO-75',
    project_path: '/repo/kodo',
    branch: 'feat/review',
    ...overrides,
  });
}

describe('KODO-75 — deriveCycleDisposition es PURA y TOTAL', () => {
  it('aprobación cierra el ciclo venga de la fase que venga', () => {
    for (const phase of /** @type {const} */ (['post-coder', 'post-reviewer'])) {
      assert.deepEqual(
        deriveCycleDisposition({ reviewState: rs('approved', 1), phase, maxRounds: 3 }),
        { action: 'approve' },
      );
    }
  });

  it('tras el coder, sin revisar todavía → lanzar reviewer (lo normal)', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('none', 0), phase: 'post-coder', maxRounds: 3 }),
      { action: 'relaunch-reviewer', round: 0 },
    );
  });

  it('tras el reviewer, cambios pedidos por debajo del tope → devolver el trabajo al coder', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('changes-requested', 1), phase: 'post-reviewer', maxRounds: 3 }),
      { action: 'relaunch-coder', round: 1 },
    );
  });

  it('EL TOPE: cambios pedidos EN la ronda del tope → escalada, no una cuarta vuelta', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('changes-requested', 3), phase: 'post-reviewer', maxRounds: 3 }),
      { action: 'escalate', reason: 'max-rounds' },
    );
  });

  it('EL SILENCIO: un reviewer que cierra SIN artefacto escala — jamás se lee como aprobación tácita', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('none', 0), phase: 'post-reviewer', maxRounds: 3 }),
      { action: 'escalate', reason: 'no-artifact' },
    );
  });

  it('FAIL-CLOSED: un artefacto ilegible escala en las DOS fases', () => {
    for (const phase of /** @type {const} */ (['post-coder', 'post-reviewer'])) {
      assert.deepEqual(
        deriveCycleDisposition({ reviewState: rs('malformed', 0, { detail: 'x' }), phase, maxRounds: 3 }),
        { action: 'escalate', reason: 'malformed-artifact' },
      );
    }
  });

  it('una aprobación caducada manda a revisar de nuevo, con el mismo tope', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('stale-approval', 1), phase: 'post-reviewer', maxRounds: 3 }),
      { action: 'relaunch-reviewer', round: 1 },
    );
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('stale-approval', 3), phase: 'post-reviewer', maxRounds: 3 }),
      { action: 'escalate', reason: 'max-rounds' },
    );
  });

  it('tras el coder con el tope ya agotado → escalada (no se abre otra ronda de revisión)', () => {
    assert.deepEqual(
      deriveCycleDisposition({ reviewState: rs('changes-requested', 3), phase: 'post-coder', maxRounds: 3 }),
      { action: 'escalate', reason: 'max-rounds' },
    );
  });

  it('TOTAL: ninguna combinación de estado × fase cae por un hueco sin decisión', () => {
    const estados = ['approved', 'changes-requested', 'stale-approval', 'none', 'malformed', 'inventado'];
    const acciones = new Set(['approve', 'relaunch-reviewer', 'relaunch-coder', 'escalate']);
    for (const state of estados) {
      for (const phase of /** @type {const} */ (['post-coder', 'post-reviewer'])) {
        for (const round of [0, 1, 3, 99]) {
          const d = deriveCycleDisposition({ reviewState: rs(state, round), phase, maxRounds: 3 });
          assert.ok(acciones.has(d.action), `sin decisión para ${state}/${phase}/${round}`);
        }
      }
    }
  });

  it('un maxRounds inválido cae al default en vez de desactivar el tope', () => {
    for (const bad of [0, -1, null, undefined, 'tres']) {
      const d = deriveCycleDisposition({
        reviewState: rs('changes-requested', DEFAULT_MAX_ROUNDS),
        phase: 'post-reviewer',
        maxRounds: /** @type {any} */ (bad),
      });
      assert.deepEqual(d, { action: 'escalate', reason: 'max-rounds' }, `maxRounds=${bad}`);
    }
  });
});

describe('KODO-75 — resolveMaxRounds', () => {
  it('lee review.max_rounds de la config', () => {
    assert.equal(resolveMaxRounds({ review: { max_rounds: 5 } }), 5);
  });

  it('un valor ≤ 0 no es «desactivar la feature»: cae al default', () => {
    assert.equal(resolveMaxRounds({ review: { max_rounds: 0 } }), DEFAULT_MAX_ROUNDS);
    assert.equal(resolveMaxRounds({ review: { max_rounds: -3 } }), DEFAULT_MAX_ROUNDS);
    assert.equal(resolveMaxRounds({}), DEFAULT_MAX_ROUNDS);
    assert.equal(resolveMaxRounds(undefined), DEFAULT_MAX_ROUNDS);
  });
});

describe('KODO-75 — persistencia del ciclo en state.json', () => {
  it('abre el ciclo bajo la clave aditiva review_cycles, keyed por task_id', () => {
    const r = open();
    assert.equal(r.ok, true);
    const state = readRawState();
    assert.ok(state.review_cycles, 'la clave aditiva existe');
    assert.equal(state.review_cycles['uuid-75'].task_ref, 'KODO-75');
    assert.equal(state.review_cycles['uuid-75'].status, 'pending');
    assert.equal(state.review_cycles['uuid-75'].round, 0);
  });

  it('un state.json SIN la clave se lee como «cero ciclos», no como error', () => {
    writeSeed(); // sin review_cycles
    assert.deepEqual(listReviewCycles(), []);
    assert.equal(getReviewCycle('uuid-75'), null);
  });

  it('reabrir preserva created_at, round y max_rounds — no se regala una ronda por reabrir', () => {
    open({ max_rounds: 2 });
    recordReviewOutcome({ task_id: 'uuid-75', reviewState: rs('changes-requested', 1), phase: 'post-reviewer' });
    const first = getReviewCycle('uuid-75');

    open({ max_rounds: 99 }); // el operador cambia el tope; el ciclo vivo no lo hereda
    const second = getReviewCycle('uuid-75');

    assert.equal(second.created_at, first.created_at);
    assert.equal(second.round, 1, 'la ronda alcanzada se conserva');
    assert.equal(second.max_rounds, 2, 'el tope queda congelado al de la apertura');
  });

  it('el ciclo aprobado NO se borra: transiciona (la traza ES el feature)', () => {
    open();
    recordReviewOutcome({ task_id: 'uuid-75', reviewState: rs('approved', 1), phase: 'post-reviewer' });
    const c = getReviewCycle('uuid-75');
    assert.equal(c.status, 'approved');
    assert.ok(c.resolved_at, 'queda fechado');
    assert.ok(readRawState().review_cycles['uuid-75'], 'sigue en state.json');
  });

  it('registrar sobre una tarea sin ciclo devuelve not-found en vez de inventarse uno', () => {
    const r = recordReviewOutcome({ task_id: 'fantasma', reviewState: rs('approved', 0), phase: 'post-reviewer' });
    assert.equal(r.ok, false);
    assert.equal(/** @type {any} */ (r).reason, 'not-found');
  });
});

describe('KODO-75 — la ESCALADA llega a la bandeja del orquestador', () => {
  it('agotar el tope encola un evento review-escalated con el ref y el motivo', () => {
    open({ max_rounds: 2 });
    const encolados = [];
    const r = recordReviewOutcome(
      { task_id: 'uuid-75', reviewState: rs('changes-requested', 2), phase: 'post-reviewer' },
      undefined,
      { enqueueFn: (e) => { encolados.push(e); return { ok: true, value: e }; } },
    );

    assert.equal(/** @type {any} */ (r).value.disposition.action, 'escalate');
    assert.equal(getReviewCycle('uuid-75').status, 'escalated');
    assert.equal(getReviewCycle('uuid-75').escalation_reason, 'max-rounds');
    assert.equal(encolados.length, 1, 'la escalada NO es silenciosa');
    assert.equal(encolados[0].kind, 'review-escalated');
    assert.equal(encolados[0].task_ref, 'KODO-75');
    assert.match(encolados[0].text, /tope de 2 rondas/);
  });

  it('un reviewer mudo también escala, con su propio motivo', () => {
    open();
    const encolados = [];
    recordReviewOutcome(
      { task_id: 'uuid-75', reviewState: rs('none', 0), phase: 'post-reviewer' },
      undefined,
      { enqueueFn: (e) => { encolados.push(e); return { ok: true, value: e }; } },
    );
    assert.equal(getReviewCycle('uuid-75').escalation_reason, 'no-artifact');
    assert.match(encolados[0].text, /SIN escribir artefacto/);
  });

  it('una acción que NO es escalada no encola nada', () => {
    open();
    const encolados = [];
    recordReviewOutcome(
      { task_id: 'uuid-75', reviewState: rs('changes-requested', 1), phase: 'post-reviewer' },
      undefined,
      { enqueueFn: (e) => { encolados.push(e); return { ok: true, value: e }; } },
    );
    assert.equal(encolados.length, 0);
    assert.equal(getReviewCycle('uuid-75').status, 'pending');
  });

  it('FAIL-OPEN: si la bandeja revienta, el ciclo YA quedó marcado escalated en state.json', () => {
    open({ max_rounds: 1 });
    const r = recordReviewOutcome(
      { task_id: 'uuid-75', reviewState: rs('changes-requested', 1), phase: 'post-reviewer' },
      undefined,
      { enqueueFn: () => { throw new Error('bandeja rota'); } },
    );
    assert.equal(r.ok, true, 'el fallo de la bandeja no tumba el registro');
    assert.equal(getReviewCycle('uuid-75').status, 'escalated');
  });

  it('el texto de la escalada dice qué pasó, dónde mirar y qué se pide', () => {
    const cycle = /** @type {any} */ ({
      task_ref: 'KODO-75', project_path: '/repo/kodo', branch: 'feat/x', max_rounds: 3,
    });
    const t = buildEscalationText(cycle, 'max-rounds');
    assert.match(t, /KODO-75/);
    assert.match(t, /feat\/x/);
    assert.match(t, /review\/recommendations/, 'dice DÓNDE están las recomendaciones');
    assert.match(t, /Decide tú/, 'y qué se le pide al operador');
  });
});

describe('KODO-75 — listado: una escalada que hay que pedir con un flag es una escalada invisible', () => {
  it('los escalados salen en el listado POR DEFECTO; los aprobados no', () => {
    open();
    recordReviewOutcome(
      { task_id: 'uuid-75', reviewState: rs('none', 0), phase: 'post-reviewer' },
      undefined,
      { enqueueFn: () => ({ ok: true, value: /** @type {any} */ ({}) }) },
    );
    openReviewCycle({ task_id: 'uuid-otro', task_ref: 'KODO-99', project_path: '/r', branch: 'b' });
    recordReviewOutcome({ task_id: 'uuid-otro', reviewState: rs('approved', 1), phase: 'post-reviewer' });

    const porDefecto = listReviewCycles().map((c) => c.task_ref).sort();
    assert.deepEqual(porDefecto, ['KODO-75'], 'el aprobado se oculta, el escalado NO');

    const todos = listReviewCycles({ all: true }).map((c) => c.task_ref).sort();
    assert.deepEqual(todos, ['KODO-75', 'KODO-99']);
  });
});
