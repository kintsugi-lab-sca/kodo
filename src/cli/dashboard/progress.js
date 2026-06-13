// @ts-check
//
// src/cli/dashboard/progress.js — Phase 50 Plan 03 (PROG-03; D-08/D-09).
//
// Consumidor del artefacto de progreso vivo de Phase 50 (`~/.kodo/progress/<taskId>.json`,
// productor: el hook task-progress.js del Plan 02). Leaf PURO, síncrono, never-throws — espejo
// de la FORMA de readLightPlan (plan.js:65-78), clonado (no reusado: el artefacto es JSON con
// campos, no markdown línea-a-línea).
//
// El dashboard lee SOLO este artefacto kodo (D-08), NUNCA los internals de Claude Code
// (`~/.claude/tasks/`). La lectura es CLIENT-SIDE en App.js (mold readPlan App.js:544), nunca
// server-side: cero endpoints nuevos, cero cambios en src/server.js.
//
// node:os/node:path/node:fs son builtins → preserva la leaf-isolation (misma convención que
// plan.js:41-45 y config.js:4,6). NO se importa src/config.js para no acoplar el leaf a su I/O.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * @typedef {{ status: 'ok', n: number, m: number, completed: boolean } | { status: 'no-progress' } | { status: 'error' }} ProgressResult
 */

/**
 * Lee el artefacto de progreso (`~/.kodo/progress/<taskId>.json`) de una fila del dashboard.
 * Síncrono, never-throws (D-09).
 *
 * Mapeo de status (espejo de readLightPlan): contenido JSON parseable → 'ok' (con n/m/completed);
 * ENOENT (sin artefacto) → 'no-progress' (cohorte sin tasks-dir tolerada, D-09); otro
 * (EACCES / JSON corrupto / sin .code) → 'error' (→ '?' + keep-last-good en el render, gestionado
 * por App.js, NO aquí).
 *
 * Anti-ReDoS guard del taskId: el CALLER (App.js enrich) valida `taskId` ANTES de llamar (String
 * .includes('/')/'\\'/'..', NO regex), exactamente como readPlan valida antes de readLightPlan
 * (plan.js:117-123). La ruta se CONSTRUYE con root FIJO `join(homedir(), '.kodo', 'progress')`,
 * byte-idéntica al productor (Plan 02: src/hooks/task-progress.js).
 *
 * @param {string} taskId  UUID kodo (sin separadores de ruta; validado por el caller).
 * @param {{ readFileFn?: (p: string) => string, kodoProgressDir?: string, homedirFn?: () => string }} [deps]
 *   `kodoProgressDir` aísla el HOME en tests (D-08); sin él, default `join(homedir(), '.kodo', 'progress')`.
 * @returns {ProgressResult}
 */
export function readProgress(taskId, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  // Ruta CONSTRUIDA (no derivada de input por regex, D-09). Byte-idéntica al productor
  // task-progress.js: join(homedir(), '.kodo', 'progress', `${taskId}.json`).
  const progDir = deps.kodoProgressDir || join((deps.homedirFn || homedir)(), '.kodo', 'progress');
  try {
    const raw = readFileFn(join(progDir, `${taskId}.json`));
    const o = JSON.parse(raw);
    return { status: 'ok', n: o.n, m: o.m, completed: !!o.completed };
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT') return { status: 'no-progress' }; // artefacto ausente (D-09)
    return { status: 'error' }; // EACCES / JSON corrupto / sin .code → '?' + keep-last-good (never-throws)
  }
}
