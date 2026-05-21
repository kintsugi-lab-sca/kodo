// @ts-check
//
// src/cli/skill-sync.js — Action handler de `kodo skill sync`.
//
// Responsabilidades (CONTEXT §D-06, D-07, D-08):
//   1. Gate: ¿cwd es un repo kodo? (exit 2 + stderr canonical D-07).
//   2. Invocar syncSkill (lógica vive en src/skill/sync.js — D-08 SoSoT).
//   3. Render: human (default) coloreado via createFormatter, o JSON (--json).
//   4. Exit codes: 0 (ok/noop) — 1 (fs error) — 2 (no kodo repo).
//
// Color isolation invariante (Phase 14 D-07): este archivo NUNCA importa el
// paquete de color directamente — solo createFormatter. Blindado por
// test/format-isolation.test.js y test/skill-sync.test.js (source-hygiene).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { syncSkill } from '../skill/sync.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ prune?: boolean, json?: boolean }} RunSkillSyncCliOpts
 *
 * @typedef {{
 *   syncFn?: typeof syncSkill,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 *   cleanupFn?: () => Promise<void> | void,
 * }} RunSkillSyncCliDeps
 */

/**
 * Thin CLI handler que orquesta el gate D-07 + syncSkill + render.
 *
 * Si `deps.cleanupFn` se provee, se ejecuta `await deps.cleanupFn()` ANTES de
 * retornar en cada path de salida (return 0/1/2). D-04/D-05/D-08 ADVISORY-02.
 * Cuando `cleanupFn` es undefined, el comportamiento es byte-exact vs
 * pre-Phase-31 (back-compat blindada por Suite 1+2). El cleanup corre en un
 * try/finally externo que envuelve todo el cuerpo, garantizando ejecución
 * incluso en el early-gate del exit 2 y en paths de error fs (exit 1).
 *
 * D-07 invariante: NUNCA invoca el helper de exit del runtime — retorna el
 * código. bin/kodo (caller) ejecuta el exit con el returnValue post-return.
 *
 * @param {RunSkillSyncCliOpts} opts
 * @param {RunSkillSyncCliDeps} [deps]
 * @returns {Promise<number>} exit code per D-07 (0 ok/noop, 1 fs error, 2 no kodo repo).
 */
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  // Lazy: createFormatter solo si entramos al render TTY (no se invoca para --json).
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  // ADVISORY-02 D-04/D-05: cleanupFn sin default — el `if (cleanupFn)` lo elide
  // para callers que no inyectan, preservando back-compat byte-exact.
  const cleanupFn = deps.cleanupFn;

  const source = join(cwd, '.claude', 'skills', 'kodo-orchestrate');
  const dest = join(homedir(), '.claude', 'skills', 'kodo-orchestrate');

  try {
    // Gate D-07 exit 2: stderr canonical message exacto.
    if (!existsSync(join(source, 'skill.md'))) {
      err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
      return 2;
    }

    /** @type {import('../skill/sync.js').SyncSkillResult} */
    let result;
    try {
      result = syncFn({ source, dest, prune: opts.prune === true });
    } catch (e) {
      err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
      return 1;
    }
    if (result.status === 'error') {
      err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
      return 1;
    }

    if (opts.json === true) {
      // D-06b: single-line JSON byte-deterministic (LOG-12 + DX-06 invariante).
      /** @type {Record<string, any>} */
      const payload = {
        status: result.status,
        files_changed: result.files_changed,
      };
      if (opts.prune === true) payload.files_pruned = result.files_pruned ?? 0;
      if (result.symlink_replaced === true) payload.symlink_replaced = true;
      write(JSON.stringify(payload) + '\n');
    } else {
      renderHuman(result, dest, write, fmt);
    }
    return 0;
  } finally {
    // ADVISORY-02 D-05/D-08: cleanup corre ANTES del return value en las 3 ramas
    // (return 0 happy-path, return 1 fs error / result.error, return 2 early-gate).
    if (cleanupFn) await cleanupFn();
  }
}

/**
 * Render TTY (human-readable). NO se invoca para --json — D-06b separa branches
 * temprano para garantizar bytes deterministas.
 *
 * @private
 * @param {import('../skill/sync.js').SyncSkillResult} result
 * @param {string} dest
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(result, dest, write, fmt) {
  // Warning del symlink legacy va PRIMERO (informativo, D-04).
  if (result.symlink_replaced === true) {
    write(`${fmt.yellow('⚠')} Legacy symlink replaced at ${dest}\n`);
  }
  if (result.status === 'noop') {
    write(`${fmt.ok('No drift')} — ${dest} up to date\n`);
  } else {
    const n = result.files_changed;
    write(`${fmt.ok(`Synced ${n} file${n === 1 ? '' : 's'} to ${dest}`)}\n`);
  }
  if (result.files_pruned !== undefined && result.files_pruned > 0) {
    const k = result.files_pruned;
    write(`${fmt.yellow(`Pruned ${k} foreign file${k === 1 ? '' : 's'}`)}\n`);
  }
}
