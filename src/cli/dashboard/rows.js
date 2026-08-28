// @ts-check
//
// src/cli/dashboard/rows.js — KODO-40 (extracción de App.js).
//
// Pipeline de derivación de FILAS del dashboard: de las sesiones crudas de `/status` a lo que
// SessionTable pinta. Vivía inline en el cuerpo de `App()` (~110 LOC entre estado y `useInput`);
// aquí es una función que React invoca en cada render exactamente igual que antes, pero testeable
// sin montar el árbol ink.
//
// Orden OBLIGATORIO (Pitfall 3 / D-16) — no reordenar:
//   sortSessions (copia, DESC, tiebreak task_id)
//     → enrich (saneo del contenido del provider + NEXT: de state.json + progreso GSD del STATE.md)
//     → deriveAny* (flags estructurales sobre el set SIN filtrar — Pitfall 4/5)
//     → applyFilter (AND, String.includes — jamás regex del input)
//     → resolveSelection (índice derivado por IDENTIDAD, clamp al vecino del índice previo)
//
// Todas las lecturas de filesystem son SÍNCRONAS y never-throws (mold readLightPlan): el render
// nunca lanza ni bloquea el árbol ink.

import { existsSync } from 'node:fs';
import {
  sortSessions,
  applyFilter,
  parseFilter,
  resolveSelection,
  countByStatus,
  deriveAnyGsd,
  deriveAnyProgress,
  deriveAnyNext,
} from './select.js';
import { deriveRepo } from './format.js';
import { stripControlChars } from '../sanitize.js';
import { readGsdProgress } from './progress.js';
import { computeRealWorktreePath } from '../../session/state.js';

/**
 * Phase 50.1 (PROG-03, DG-03/DG-04/DG-06/DG-07): enrich CLIENT-SIDE de una fila. Lectura filesystem
 * SÍNCRONA never-throws, SIN await, SIN server.js (cero endpoints nuevos, DG-06). La FUENTE del
 * progreso es el bloque `progress:` del STATE.md que GSD mantiene dentro del worktree REAL de la
 * sesión (`.claude/worktrees/<session_id>`), localizado con computeRealWorktreePath(project_path,
 * session_id) — NUNCA `row.worktree_path` persistido (apunta a la ruta `.bg-shell` equivocada,
 * Pitfall 1).
 *
 * Keep-last-good (DG-07): el mapa `lastGood` está re-keyed por `session_id`. Un fallo transiente
 * ('error') con un last-good presente expone el último N/M conocido (progCell pinta N/M, no '?');
 * sin last-good, expone 'error' (→'?'). Un 'ok' refresca el mapa. Un 'no-progress' (ENOENT /
 * STATE.md parcial) → '—'.
 *
 * @param {any} rawRow - fila cruda de `/status`.
 * @param {Record<string, any>} tasks - bloque `tasks` de ~/.kodo/state.json (para el NEXT:).
 * @param {Map<string, { n: number, m: number, completed: boolean }>} lastGood - memoria entre polls.
 * @returns {any} la fila enriquecida con `next` y `progress`.
 */
function enrichRow(rawRow, tasks, lastGood) {
  // WR-03/M4: el contenido externo NO confiable del provider (task_ref renderizado en la
  // columna task_ref; summary usado en filtro/plan y como task.title) pasa por
  // stripControlChars en su punto de proyección al render — mismo patrón que los comentarios.
  // Neutraliza OSC-52/CSI/C1 antes de que cualquier consumidor downstream (rowCells, select,
  // readPlan) lo toque. Known-limitation: cmux.notify(body: session.summary) en session-end.js
  // NO se sanea aquí (fuera del render del dashboard, ver REVIEW WR-03).
  // Phase 75 (LIVE-05, T-75-01): el NEXT: es dato de la TAREA (por task_id), no de la sesión.
  // Se toma tasks[task_id]?.next SOLO si task_id es truthy; el contenido es LLM (state.json),
  // así que pasa por stripControlChars — mismo saneo que task_ref/summary — cuando es string
  // no vacío, neutralizando OSC-52/CSI/C1 ANTES de proyectarse a la celda. Cualquier otro caso
  // (ausente / null / no-string) colapsa a null → celda vacía (nextCell → '').
  const rawNext = rawRow.task_id ? tasks[rawRow.task_id]?.next : null;
  const next = typeof rawNext === 'string' && rawNext.length > 0 ? stripControlChars(rawNext) : null;
  const row = {
    ...rawRow,
    ...(rawRow.task_ref != null ? { task_ref: stripControlChars(rawRow.task_ref) } : {}),
    ...(rawRow.summary != null ? { summary: stripControlChars(rawRow.summary) } : {}),
    next,
  };
  const projectPath = row.project_path;
  const sessionId = row.session_id;
  // DG-04: la ruta del STATE.md se deriva de project_path + session_id, NUNCA de
  // row.worktree_path (Pitfall 1). Guard anti-traversal del sessionId ANTES de construir la ruta
  // (T-501-traversal, defensa en profundidad): String.includes, NO regex (anti-ReDoS, mold
  // plan.js:120-121). El session_id es UUID por construcción (manager.js); falta o no usable → '—'.
  const usable =
    sessionId &&
    projectPath &&
    !sessionId.includes('/') &&
    !sessionId.includes('\\') &&
    !sessionId.includes('..');
  if (!usable) return { ...row, progress: { status: 'no-progress' } };
  // Phase 61 (PROG-04, D-2): resolución de path con FALLBACK. Sesión LANZADA por kodo →
  // su STATE.md vive en el worktree aislado (`.claude/worktrees/<sid>`, computeRealWorktreePath,
  // preserva Pitfall 1). Sesión ADOPTADA → no tiene worktree de kodo; su STATE.md vive en
  // `<project_path>/.planning/STATE.md`. Si el dir del worktree existe usamos ese; si no, project_path.
  const worktreeBase = computeRealWorktreePath(projectPath, sessionId);
  const base = existsSync(worktreeBase) ? worktreeBase : projectPath;
  // Phase 61 (PROG-04, D-1): gate DINÁMICO. El progreso se muestra si hay un STATE.md GSD legible
  // en el path resuelto, SIN depender del flag `gsd` persistido (una sesión adoptada que se vuelve
  // GSD después se enciende sola). readGsdProgress es never-throws: 'no-progress' (ENOENT / sin
  // progress:) → '—'; 'error' → keep-last-good; 'ok' → N/M. Reemplaza el corte por flag (DG-03).
  const res = readGsdProgress(base, {}); // never-throws (mold readLightPlan)
  if (res.status === 'ok') {
    lastGood.set(sessionId, { n: res.n, m: res.m, completed: res.completed });
    return { ...row, progress: res };
  }
  if (res.status === 'error') {
    const prev = lastGood.get(sessionId);
    // last-good presente → sobrevive el N/M (status 'ok'); ausente → 'error' (progCell pinta '?').
    return { ...row, progress: prev ? { status: 'ok', ...prev } : { status: 'error' } };
  }
  return { ...row, progress: res }; // 'no-progress' → '—'
}

/**
 * Pipeline de derivación OBLIGATORIO (orden fijo — Pitfall 3 / D-16). La query EN VIVO (no '')
 * alimenta el filtro en cada render (D-13): teclear re-filtra al instante. El clamp de D-06 usa el
 * índice posicional previo (`prevIndex`) para caer al vecino correcto si la fila desaparece.
 *
 * Los flags `anyGsd`/`anyProgress`/`anyNext` se derivan del set SIN filtrar (`enriched`, NO
 * `filtered` — Pitfall 4/5): sus columnas no deben parpadear cuando una query `/` vacía
 * temporalmente ese subconjunto.
 *
 * @param {object} args
 * @param {Array<any>} args.sessions - lista cruda del último poll OK (keep-last-good ya aplicado).
 * @param {string} args.query - filtro EN VIVO.
 * @param {string|null} args.selectedTaskId - cursor por IDENTIDAD (nunca un índice).
 * @param {number} args.prevIndex - último índice visible real (ancla del clamp D-06).
 * @param {Record<string, any>} args.tasks - bloque `tasks` de ~/.kodo/state.json.
 * @param {Map<string, { n: number, m: number, completed: boolean }>} args.lastGood - memoria del progreso.
 */
export function deriveRows({ sessions, query, selectedTaskId, prevIndex, tasks, lastGood }) {
  const sorted = sortSessions(sessions);
  // Se enriquece ANTES de deriveAny*/applyFilter para que `row.progress` y `row.next` estén
  // presentes en los flags estructurales, en el filtro y en rowCells.
  const enriched = sorted.map((rawRow) => enrichRow(rawRow, tasks, lastGood));
  const filtered = applyFilter(enriched, parseFilter(query), deriveRepo);
  return {
    enriched,
    filtered,
    anyGsd: deriveAnyGsd(enriched),
    anyProgress: deriveAnyProgress(enriched),
    anyNext: deriveAnyNext(enriched),
    sel: resolveSelection(filtered, selectedTaskId, prevIndex),
    counts: countByStatus(filtered),
    // hasQuery distingue los dos estados vacíos en SessionTable (D-12): `no sessions match` (hay
    // query activa que oculta todo) vs `no active sessions` (lista realmente vacía).
    hasQuery: query.trim().length > 0,
  };
}
