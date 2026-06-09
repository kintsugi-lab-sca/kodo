// @ts-check
//
// src/cli/dashboard/plan.js — Phase 44 Plan 01 (PLAN-01/PLAN-02; D-03/D-04/D-05/D-06/D-13).
//
// Helper PURO, SÍNCRONO y NEVER-THROWS para leer el/los `PLAN.md` de la fase GSD de
// una fila del dashboard, sin tocar React ni el server (D-10: lee el filesystem como
// `focus.js` invoca cmux — cero endpoints). Espejo estructural del descubrimiento de
// directorio de fase de `src/gsd/verify.js:123-186` (NO se importa — se copia la forma)
// y del contrato never-throws de `client.js`/los overlays `c`/`l`.
//
// Contrato: readPlan(row, deps) → { status: 'ok'|'no-phase'|'no-plan'|'error', lines: string[] }
//   - 'no-phase' : la fila no resuelve a una fase GSD (sin phase_id y sin fallback útil).
//   - 'no-plan'  : la fase resuelve pero no hay árbol `.planning/phases` o ningún `*-PLAN.md`.
//   - 'error'    : la lectura del filesystem falló de forma no-ENOENT (EACCES/EMFILE/…).
//   - 'ok'       : se leyó al menos un `*-PLAN.md`; `lines` es el contenido plano concatenado.
//
// NEVER-THROWS (D-05): TODA lectura de filesystem (readdir, readFile) Y la llamada al
// fallback `resolvePhaseFn` está envuelta de modo que ningún error llegue a React. Un
// fichero ilegible degrada a una cabecera `(unreadable)` SIN abortar el resto (best-effort).
//
// Anti-ReDoS (D-13): el matching de directorio/fichero usa SOLO String.startsWith/endsWith.
// CERO compilación de regex desde nombres de fichero — el único uso de regex es el literal
// `/^\d+$/` para detectar un phase_id puramente numérico (constante, no derivada de input).
//
// Color-isolation (D-12): este módulo NO importa el helper de color del CLI ni ningún módulo de render;
// es un LEAF que solo importa `node:fs` y `node:path`. `resolvePhase` (resolver.js) NO se
// importa aquí — se inyecta vía `deps.resolvePhaseFn` (DI) desde App.js, preservando la
// testabilidad pura y manteniendo `plan.js` como hoja del grafo (WARNING-01).

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ status: 'ok'|'no-phase'|'no-plan'|'error', lines: string[] }} PlanResult
 */

/**
 * Lee el/los `PLAN.md` de la fase GSD de una fila del dashboard. Síncrono, never-throws.
 *
 * @param {{ phase_id?: string|null, project_path?: string, worktree_path?: string, summary?: string, task_ref?: string }} row
 *   Fila revalidada por task_id (spread de SessionRecord en GET /status). NO lleva task.title.
 * @param {{ readdirFn?: (p: string) => string[], readFileFn?: (p: string) => string, existsFn?: (p: string) => boolean, resolvePhaseFn?: (params: { projectPath: string|undefined, task: { title: string, ref?: string } }) => any }} [deps]
 *   Inyección de dependencias para tests; por defecto los syncs de node:fs. `resolvePhaseFn`
 *   NO tiene default — el fallback solo corre cuando el caller lo provee (App.js inyecta resolvePhase).
 * @returns {PlanResult}
 */
export function readPlan(row, deps = {}) {
  const readdirFn = deps.readdirFn || readdirSync;
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const existsFn = deps.existsFn || existsSync;
  const resolvePhaseFn = deps.resolvePhaseFn; // fallback best-effort (D-03), sin default

  // 1. phase_id primario (D-03). El fallback resolvePhase solo se usa si está ausente.
  //    NOTA (Pitfall 2): la fila NO lleva task.title, así que el fallback casi siempre
  //    devuelve no-match/bootstrap → colapsa a 'no-phase'. NO se asume que tenga éxito.
  let phaseId = row?.phase_id;
  if (phaseId == null && resolvePhaseFn) {
    try {
      const r = resolvePhaseFn({
        projectPath: row?.worktree_path ?? row?.project_path,
        task: { title: row?.summary ?? '', ref: row?.task_ref },
      });
      if (r && r.action === 'phase') phaseId = r.phase_id;
    } catch {
      // never-throws: un fallback que lanza no debe tirar el overlay. Se ignora y se
      // colapsa a 'no-phase' abajo (igual que un no-match).
    }
  }
  if (phaseId == null) return { status: 'no-phase', lines: [] };

  const base = row?.worktree_path ?? row?.project_path;
  if (!base) return { status: 'no-phase', lines: [] };

  // 2. Prefijo padded (canónico verify.js: "04" matchea "04-foo" pero NO "40-other").
  //    El regex `/^\d+$/` es una constante (no deriva de input externo) — no es ReDoS.
  const padded = /^\d+$/.test(String(phaseId))
    ? String(phaseId).padStart(2, '0')
    : String(phaseId); // "44.1" se queda como está
  const phasesRoot = join(base, '.planning', 'phases');
  if (!existsFn(phasesRoot)) return { status: 'no-plan', lines: [] };

  // 3. Listar el árbol de fases. WR-02 (verify.js:144-159): ENOENT → vacío (árbol ausente,
  //    'no-plan'); EACCES/otros → 'error' (existe pero no se puede inspeccionar).
  /** @type {string[]} */
  let entries;
  try {
    entries = readdirFn(phasesRoot);
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT') entries = [];
    else return { status: 'error', lines: [] };
  }
  // Guard de contención (WR-01): el directorio de fase debe ser un basename simple bajo
  // `phasesRoot` — sin separadores ni `..` que `join` colapsaría fuera de la raíz fija.
  // `String.includes` (NO RegExp, D-13). En la práctica readdir devuelve basenames, pero esto
  // hace literalmente cierta la afirmación "fixed root" del threat model T-44-01.
  const dir = entries.find(
    (e) => e.startsWith(`${padded}-`) && !e.includes('/') && !e.includes('\\') && !e.includes('..'),
  ); // String.startsWith (D-13)
  if (!dir) return { status: 'no-plan', lines: [] };

  // 4. Recoger los `*-PLAN.md` del directorio de fase, ordenar ascendente (D-06).
  /** @type {string[]} */
  let files;
  try {
    files = readdirFn(join(phasesRoot, dir))
      // String.endsWith, NO RegExp (D-13) + guard de contención (WR-01): basename simple,
      // sin separadores ni `..` que escapen del directorio de fase.
      .filter((f) => f.endsWith('-PLAN.md') && !f.includes('/') && !f.includes('\\') && !f.includes('..'))
      .sort(); // ascendente por nombre de fichero (D-06)
  } catch {
    return { status: 'error', lines: [] };
  }
  if (files.length === 0) return { status: 'no-plan', lines: [] };

  // 5. Leer + concatenar. Con varios ficheros se añade una cabecera `── <f> ──` por fichero
  //    (D-06). Cada readFile va en su propio try/catch: un fichero ilegible degrada a
  //    `── <f> (unreadable) ──` SIN abortar el resto (best-effort, D-05).
  const multi = files.length > 1;
  /** @type {string[]} */
  const lines = [];
  for (const f of files) {
    try {
      const md = readFileFn(join(phasesRoot, dir, f));
      if (multi) lines.push(`── ${f} ──`, '');
      for (const ln of md.split('\n')) lines.push(ln);
      if (multi) lines.push('');
    } catch {
      // Un único PLAN.md ilegible no tira el overlay entero (D-05).
      lines.push(`── ${f} (unreadable) ──`, '');
    }
  }
  return { status: 'ok', lines };
}
