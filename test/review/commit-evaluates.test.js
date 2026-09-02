// @ts-check
//
// test/review/commit-evaluates.test.js — regresión del review de la PR #4, hallazgo (2).
//
// EL FALLO: `recordReviewOutcome` y `deriveCycleDisposition` no tenían NINGÚN llamador en
// producción. El tope de rondas y la escalada estaban implementados y probados en aislamiento,
// pero nada los invocaba: en producción el ciclo se abría con `kodo review start` y ya no lo
// evaluaba nadie. La garantía «termina por aprobación o por tope con escalada, nunca en
// silencio» era cierta sobre el papel del módulo y falsa sobre el sistema.
//
// Lo que se congela aquí es el CABLE, no la lógica —esa ya la cubre `cycle.test.js`—: que
// `kodo review commit` evalúa el ciclo, y que lo hace también cuando el reviewer NO escribió
// nada, que es el caso `no-artifact` y el único que detecta el silencio.
//
// AISLAMIENTO DEL HOME OBLIGATORIO: el handler toca `state.review_cycles` vía `cycle.js`, que
// deriva su path de `homedir()` en MODULE-LOAD. De ahí el `process.env.HOME = tmpHome` ANTES
// del `await import(...)`. Mismo patrón y misma razón que `test/review/cycle.test.js`.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
/** @type {typeof import('../../src/cli/review.js').runReviewCommitCli} */
let runReviewCommitCli;
/** @type {typeof import('../../src/review/cycle.js').openReviewCycle} */
let openReviewCycle;
/** @type {typeof import('../../src/review/cycle.js').getReviewCycle} */
let getReviewCycle;
/** @type {typeof import('../../src/review/cycle.js').findOpenCycleByBranch} */
let findOpenCycleByBranch;

const BRANCH = 'feat/revisada';

function writeSeed() {
  writeFileSync(
    join(tmpHome, '.kodo', 'state.json'),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [] }, null, 2) + '\n',
  );
}

before(async () => {
  origHome = process.env.HOME;
  tmpHome = mkdtempSync(join(tmpdir(), 'kodo-eval-home-'));
  process.env.HOME = tmpHome;
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
  writeSeed();
  ({ runReviewCommitCli } = await import('../../src/cli/review.js'));
  ({ openReviewCycle, getReviewCycle, findOpenCycleByBranch } = await import('../../src/review/cycle.js'));
});

after(() => {
  if (origHome === undefined) delete process.env.HOME;
  else process.env.HOME = origHome;
  rmSync(tmpHome, { recursive: true, force: true });
});

beforeEach(() => {
  writeSeed();
});

/** Abre un ciclo sobre BRANCH con el tope indicado. */
function openCycle(maxRounds = 3) {
  return openReviewCycle({
    task_id: 'uuid-x',
    task_ref: 'KODO-99',
    project_path: '/repo/x',
    branch: BRANCH,
    max_rounds: maxRounds,
  });
}

/**
 * Ejecuta el handler con los seams inyectados. El commit y la derivación se simulan; lo que
 * se prueba es el CABLE entre ellos y el ciclo.
 */
function runCommit({ committed = true, reviewState, out = [] } = {}) {
  const code = runReviewCommitCli(
    { json: true },
    {
      writeFn: (s) => out.push(s),
      errFn: (s) => out.push(s),
      env: { KODO_REVIEWER: '1' },
      commitFn: () => (committed
        ? { ok: true, committed: true, sha: 'a'.repeat(40), skipped: [] }
        : { ok: true, committed: false, reason: 'nothing-to-commit', skipped: [] }),
      currentBranchFn: () => BRANCH,
      deriveReviewStateFn: () => /** @type {any} */ (reviewState),
    },
  );
  return { code, json: JSON.parse(out.join('')) };
}

describe('PR #4 (2) — `kodo review commit` EVALÚA el ciclo', () => {
  it('una aprobación cierra el ciclo: sin cable, esto se quedaba `pending` para siempre', () => {
    openCycle();
    const { json } = runCommit({ reviewState: { state: 'approved', round: 1 } });

    assert.equal(json.cycle.action, 'approve');
    assert.equal(getReviewCycle('uuid-x').status, 'approved');
  });

  it('cambios pedidos por debajo del tope devuelven el trabajo al coder y dejan el ciclo abierto', () => {
    openCycle(3);
    const { json } = runCommit({ reviewState: { state: 'changes-requested', round: 1 } });

    assert.equal(json.cycle.action, 'relaunch-coder');
    assert.equal(json.cycle.round, 1);
    assert.equal(getReviewCycle('uuid-x').status, 'pending');
  });

  it('EL TOPE se ejecuta de verdad: la ronda del límite escala y marca el ciclo', () => {
    openCycle(2);
    const { json } = runCommit({ reviewState: { state: 'changes-requested', round: 2 } });

    assert.equal(json.cycle.action, 'escalate');
    assert.equal(json.cycle.reason, 'max-rounds');
    const c = getReviewCycle('uuid-x');
    assert.equal(c.status, 'escalated');
    assert.equal(c.escalation_reason, 'max-rounds');
  });

  it('EL SILENCIO: sin artefacto y sin commit, se evalúa igual y ESCALA', () => {
    // El caso que se perdería si la evaluación colgara de `committed === true`. Un reviewer
    // que cierra sin escribir nada es exactamente lo que el contrato prohíbe dejar pasar.
    openCycle();
    const { json } = runCommit({ committed: false, reviewState: { state: 'none', round: 0 } });

    assert.equal(json.committed, false);
    assert.equal(json.cycle.action, 'escalate');
    assert.equal(json.cycle.reason, 'no-artifact');
    assert.equal(getReviewCycle('uuid-x').status, 'escalated');
  });

  it('un artefacto ilegible escala como `malformed-artifact`', () => {
    openCycle();
    const { json } = runCommit({ reviewState: { state: 'malformed', round: 0, detail: 'x' } });
    assert.equal(json.cycle.reason, 'malformed-artifact');
  });
});

describe('PR #4 (2) — degradación cuando no hay ciclo', () => {
  it('sin ciclo abierto para la rama, el commit ocurre igual y la evaluación es null', () => {
    // El reviewer corriendo a mano, sin que nadie abriera el ciclo con `kodo review start`.
    const { code, json } = runCommit({ reviewState: { state: 'approved', round: 1 } });
    assert.equal(code, 0);
    assert.equal(json.committed, true, 'el commit del artefacto es lo que importa y ocurre');
    assert.equal(json.cycle, null);
  });

  it('un ciclo YA cerrado no se reabre por un commit tardío de artefactos', () => {
    openCycle();
    runCommit({ reviewState: { state: 'approved', round: 1 } });
    assert.equal(getReviewCycle('uuid-x').status, 'approved');

    const { json } = runCommit({ reviewState: { state: 'changes-requested', round: 2 } });
    assert.equal(json.cycle, null, 'findOpenCycleByBranch solo devuelve ciclos `pending`');
    assert.equal(getReviewCycle('uuid-x').status, 'approved');
  });
});

describe('PR #4 (2) — findOpenCycleByBranch', () => {
  it('encuentra el ciclo abierto por rama, que es lo único que el reviewer sabe de sí mismo', () => {
    openCycle();
    assert.equal(findOpenCycleByBranch(BRANCH)?.task_id, 'uuid-x');
  });

  it('devuelve null para una rama sin ciclo, y para entrada degenerada', () => {
    openCycle();
    assert.equal(findOpenCycleByBranch('otra/rama'), null);
    assert.equal(findOpenCycleByBranch(''), null);
    assert.equal(findOpenCycleByBranch(/** @type {any} */ (null)), null);
  });
});
