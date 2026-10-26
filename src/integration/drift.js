// @ts-check
//
// src/integration/drift.js — KODO-101: la cola se entera de que la rama avanzó.
//
// El síntoma (ITCLIP-169, 17-sep): una entrada encolada con 5 commits y auditada sobre
// `bade98f` seguía pintando «5 commits · audit ✓1» 51 minutos después, con la rama ya en
// `c1d7486` y dos commits que nadie había auditado — uno de ellos retiraba funcionalidad. El
// refresco de KODO-69 solo corre cuando OTRA sesión de kodo cierra sobre la misma rama; una
// sesión reanudada a mano, un commit del operador o un rebase pasaban sin que nadie lo notase.
//
// DOS consumidores, UNA función (`refreshIfMoved`):
//   - El loop del server (`startDriftLoop`): un `rev-parse` por entrada pending y tick, para que
//     el LISTADO diga la verdad sin pagar git. El listado sigue siendo cero-git: el coste vive
//     aquí, en el daemon, que es donde el enunciado decidió ponerlo.
//   - `kodo integrate <ref> --ff|--merge|--pr`, como cinturón: entre dos ticks la rama puede
//     moverse, y lo que de verdad importa es no integrar algo distinto de lo que se veía.
//
// Lo que NO hace: anular el oráculo ni la auditoría. Ver `refreshBranchHead` en queue.js — el
// desfase se DERIVA de `commit ≠ head`, y eso es lo que deja al listado distinguir «auditado»
// de «auditado sobre un HEAD anterior».

import { measureBranch } from './capture.js';
import { revParse } from './oracle.js';
import { listIntegrationQueue, refreshBranchHead, sealedHead } from './queue.js';
import { noopLogger } from '../logger-noop.js';

/** Cadencia del loop. La rama se mueve a ritmo humano: minutos, no segundos. */
export const DRIFT_INTERVAL_MS = 60 * 1000;

/** Tope de cada llamada a git del loop: un repo colgado no puede congelar el barrido. */
const GIT_TIMEOUT_MS = 10 * 1000;

/**
 * @typedef {(cwd: string, args: string[]) => Promise<string>|string} GitFn
 * @typedef {{ moved: boolean, from: string|null, to: string|null, refreshed: boolean }} DriftResult
 *   `moved`: hay ancla y la punta real es OTRA. `refreshed`: la fila se reescribió (también al
 *   sellar por primera vez una entrada anterior a KODO-101, que no cuenta como `moved`).
 */

/**
 * Compara la punta real de la rama con la que la fila avala y, si difiere, re-describe la fila.
 * Never-throws.
 *
 * Sin punta legible (`head === null`: rama borrada, repo inaccesible) NO se toca nada: no se
 * inventa un desfase que no se puede demostrar — misma regla que `isOracleStale`.
 *
 * @param {{
 *   entry: import('./queue.js').IntegrationEntry,
 *   gitFn: GitFn,
 *   head?: string|null,             // Ya leída por el caller (el CLI la reutiliza para sus gates).
 *   measureFn?: typeof measureBranch,
 *   refreshFn?: typeof refreshBranchHead,
 *   logger?: import('../logger-noop.js').NoopLogger,
 *   now?: () => Date,
 * }} args
 * @returns {Promise<DriftResult>}
 */
export async function refreshIfMoved({ entry, gitFn, head, measureFn, refreshFn, logger = noopLogger, now }) {
  const measure = measureFn || measureBranch;
  const refresh = refreshFn || refreshBranchHead;
  const sealed = sealedHead(entry);
  try {
    const tip = head === undefined
      ? await revParse({ project: entry.project_path, ref: entry.branch, gitFn })
      : head;
    if (!tip || tip === sealed) return { moved: false, from: sealed, to: tip ?? null, refreshed: false };

    const m = await measure({ project: entry.project_path, branch: entry.branch, base: entry.base_branch, gitFn });
    const r = refresh(entry, sealed, { head: tip, ...m }, logger, { now });
    return { moved: sealed !== null, from: sealed, to: tip, refreshed: r.ok };
  } catch (err) {
    logger.warn('integration.drift.error', {
      branch: entry.branch,
      detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
    });
    return { moved: false, from: sealed, to: null, refreshed: false };
  }
}

/**
 * Un pase del barrido: todas las entradas pending, en serie (son pocas y git no paraleliza
 * bien sobre el mismo repo). Never-throws.
 *
 * @param {{ gitFn: GitFn, listFn?: typeof listIntegrationQueue, logger?: any, now?: () => Date, measureFn?: typeof measureBranch, refreshFn?: typeof refreshBranchHead }} deps
 * @returns {Promise<{ checked: number, moved: number }>}
 */
export async function runDriftSweep(deps) {
  const list = deps.listFn || listIntegrationQueue;
  let checked = 0;
  let moved = 0;
  for (const entry of list()) {
    checked++;
    const r = await refreshIfMoved({ ...deps, entry });
    if (r.moved && r.refreshed) moved++;
  }
  return { checked, moved };
}

/**
 * `gitFn` del loop: ASÍNCRONO (el server atiende HTTP en el mismo proceso; un `execFileSync`
 * lo congelaría mientras git responde) y con timeout. Argumentos siempre como array, sin shell.
 *
 * @type {GitFn}
 */
async function defaultGit(cwd, args) {
  const { execFile } = await import('node:child_process');
  return await new Promise((resolve, reject) => {
    execFile('git', ['-C', cwd, ...args], { encoding: 'utf-8', timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout).trim());
    });
  });
}

/**
 * Arranca el loop de deriva. Devuelve su teardown. Single-flight y `.unref()`, mismo idiom que
 * `startOrphanSweepLoop`.
 *
 * @param {{ gitFn?: GitFn, intervalMs?: number, logger?: any, setInterval?: typeof setInterval, clearInterval?: typeof clearInterval, listFn?: typeof listIntegrationQueue }} [deps]
 * @returns {() => void}
 */
export function startDriftLoop(deps = {}) {
  const setIv = deps.setInterval ?? setInterval;
  const clearIv = deps.clearInterval ?? clearInterval;
  let running = false;
  const handle = setIv(async () => {
    if (running) return;
    running = true;
    try {
      const stats = await runDriftSweep({ gitFn: deps.gitFn || defaultGit, listFn: deps.listFn, logger: deps.logger });
      // Solo se loguea el pase que movió algo: el tick vacío es el caso común.
      if (stats.moved > 0) deps.logger?.info?.('integration.drift.sweep', stats);
      else deps.logger?.debug?.('integration.drift.sweep', stats);
    } catch (err) {
      deps.logger?.warn?.('integration.drift.sweep_error', {
        detail: String(/** @type {any} */ (err)?.message || '').slice(0, 200),
      });
    } finally {
      running = false;
    }
  }, deps.intervalMs ?? DRIFT_INTERVAL_MS);
  /** @type {any} */ (handle)?.unref?.();
  return () => clearIv(handle);
}
