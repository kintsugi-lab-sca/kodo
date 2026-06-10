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
// Contrato: readPlan(row, deps) → { status: 'ok'|'no-phase'|'no-plan'|'no-light-plan'|'error', lines: string[] }
//   - 'no-phase'      : la fila no resuelve a una fase GSD (sin phase_id) Y sin task_id utilizable.
//   - 'no-plan'       : la fase GSD resuelve pero no hay árbol `.planning/phases` o ningún `*-PLAN.md`.
//   - 'no-light-plan' : Phase 46 — fila quick/non-GSD (phaseId == null) con task_id, pero el artefacto
//                       de plan ligero `~/.kodo/plans/<task_id>.md` aún no existe (ENOENT). Copy honesta
//                       distinta de no-phase/no-plan (D-04); es informativo, no un error.
//   - 'error'         : la lectura del filesystem falló de forma no-ENOENT (EACCES/EMFILE/…).
//   - 'ok'            : se leyó el plan; `lines` es el contenido plano (GSD: *-PLAN.md concatenados;
//                       light: el markdown del artefacto línea a línea).
//
// FALLBACK PLAN LIGERO (Phase 46 PLAN-04, D-01..D-09): cuando phaseId queda `null` (rama no-phase) pero
// la fila lleva un `task_id`, readPlan delega en `readLightPlan` que lee el artefacto de Phase 45
// (`~/.kodo/plans/<task_id>.md`). GSD tiene prioridad (D-02): el fallback solo dispara en la rama
// phaseId==null; las filas con phase_id siguen leyendo su PLAN.md exactamente igual. Mapeo D-05:
// contenido→'ok', ENOENT→'no-light-plan', otro→'error'. Leaf-isolation preservada (D-07): se importa
// `homedir` de `node:os` (builtin), NO `src/config.js` — se replica la convención `join(homedir(),'.kodo')`.
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
// D-07: node:os es builtin → preserva la leaf-isolation. Misma convención que config.js:4,6
// (`join(homedir(), '.kodo')`). NO se importa src/config.js para no acoplar el leaf a su I/O.
import { homedir } from 'node:os';

/**
 * @typedef {{ status: 'ok'|'no-phase'|'no-plan'|'no-light-plan'|'error', lines: string[] }} PlanResult
 */

/**
 * Lee el artefacto de plan ligero de Phase 45 (`~/.kodo/plans/<taskId>.md`) para una fila
 * quick/non-GSD. Privado (no exportado), síncrono, never-throws (D-05/D-09).
 *
 * Mapeo D-05: contenido → 'ok' (render plano línea a línea, igual que un PLAN.md);
 * ENOENT → 'no-light-plan' (artefacto ausente, copy honesta D-04); otro (EACCES/sin .code) → 'error'.
 * El caller (readPlan) ya garantiza que `taskId` es truthy y sin separadores de ruta (guard D-09),
 * así que la ruta construida `join(plansDir, taskId + '.md')` nunca escapa del root fijo.
 *
 * @param {string} taskId  UUID del provider (sin separadores de ruta; validado por el caller).
 * @param {{ readFileFn?: (p: string) => string, kodoPlansDir?: string, homedirFn?: () => string }} deps
 *   `kodoPlansDir` aísla el HOME en tests (D-08); sin él, default `join(homedir(), '.kodo', 'plans')`.
 * @returns {PlanResult}
 */
function readLightPlan(taskId, deps) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  // Ruta CONSTRUIDA (no derivada de input por regex, D-09). Byte-idéntica al productor
  // session-start.js:85,145: join(homedir(), '.kodo', 'plans', `${task_id}.md`).
  const plansDir = deps.kodoPlansDir || join((deps.homedirFn || homedir)(), '.kodo', 'plans');
  try {
    const md = readFileFn(join(plansDir, `${taskId}.md`));
    return { status: 'ok', lines: md.split('\n') }; // render plano (igual que plan.js:126)
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT') return { status: 'no-light-plan', lines: [] }; // ausente → honesta (D-04)
    return { status: 'error', lines: [] }; // EACCES/sin .code → error (never-throws)
  }
}

/**
 * Lee el/los `PLAN.md` de la fase GSD de una fila del dashboard. Síncrono, never-throws.
 *
 * @param {{ phase_id?: string|null, task_id?: string, project_path?: string, worktree_path?: string, summary?: string, task_ref?: string }} row
 *   Fila revalidada por task_id (spread de SessionRecord en GET /status). NO lleva task.title.
 * @param {{ readdirFn?: (p: string) => string[], readFileFn?: (p: string) => string, existsFn?: (p: string) => boolean, resolvePhaseFn?: (params: { projectPath: string|undefined, task: { title: string, ref?: string } }) => any, kodoPlansDir?: string, homedirFn?: () => string }} [deps]
 *   Inyección de dependencias para tests; por defecto los syncs de node:fs. `resolvePhaseFn`
 *   NO tiene default — el fallback GSD solo corre cuando el caller lo provee (App.js inyecta resolvePhase).
 *   `kodoPlansDir`/`homedirFn` (D-08): aíslan el HOME del fallback de plan ligero en tests.
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
  // Phase 46 (D-02/D-03/D-06): GSD tiene prioridad. Solo cuando phaseId queda `null` se intenta el
  // fallback de plan ligero. El guard de contención (D-09) vive AQUÍ, en el call-site, para mantener
  // un solo punto de decisión: un task_id ausente/falsy O con separadores de ruta degrada a 'no-phase'
  // terminal (D-06), y readLightPlan solo se invoca con un taskId ya validado (nunca lee fuera del root).
  if (phaseId == null) {
    const taskId = row?.task_id;
    // String.includes (NO RegExp, D-13/anti-ReDoS) — espejo del guard WR-01 de las líneas de abajo.
    const usable =
      taskId && !taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..');
    if (usable) return readLightPlan(taskId, deps); // mapeo D-05 dentro del helper
    return { status: 'no-phase', lines: [] }; // terminal: sin task_id utilizable (D-06)
  }

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
