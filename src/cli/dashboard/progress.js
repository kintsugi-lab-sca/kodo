// @ts-check
//
// src/cli/dashboard/progress.js — Phase 50.1 Plan 01 (PROG-02; DG-01/DG-02/DG-07).
//
// Lector del progreso vivo de una sesión GSD. La FUENTE es el bloque `progress:`
// del `STATE.md` que GSD mantiene por disk-scan dentro del worktree de la sesión
// (DG-02). NO se leen las superficies HOME-relative de Claude Code ni de kodo —
// están vacías en sesiones GSD reales (usan `Agent`, no `TaskCreate`), por lo que
// el hook de captura 50-02 quedó demotado (DG-08).
//
// Leaf PURO, síncrono, never-throws (DG-07) — espejo de la FORMA de readLightPlan
// (plan.js:65-78). N/M = FASES (DG-01): m=total_phases, n=completed_phases ?? 0.
//
// node:fs/node:path son builtins → preserva la leaf-isolation (misma convención que
// plan.js:41-45). NO se importa src/config.js para no acoplar el leaf a su I/O.
//
// Mini-parser hand-rolled con regex CONSTANTES (DG-02): cero dependencias YAML.
// Las keys son una allowlist literal fija → NUNCA se compila un regex desde input
// externo (anti-ReDoS, espejo del `/^\d+$/` constante de plan.js:131).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{ status: 'ok', n: number, m: number, completed: boolean } | { status: 'no-progress' } | { status: 'error' }} ProgressResult
 */

// Regex de frontmatter CONSTANTE: aísla el PRIMER bloque `--- ... ---` (non-greedy).
// Tolera \r\n (CRLF). No deriva de input externo → sin vector ReDoS.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

// Allowlist LITERAL FIJA de keys numéricas del bloque progress:. Las keys son
// constantes del código, NUNCA input externo (DG-02 anti-ReDoS).
const PROGRESS_KEYS = /** @type {const} */ (['total_phases', 'completed_phases']);

// Regex CONSTANTE que aísla el bloque `progress:` dentro del frontmatter: desde su
// header (top-level, sin indentar) hasta la siguiente key top-level (no indentada)
// o el fin del frontmatter. Solo sus hijos indentados se escanean por keys (WR-01).
// No deriva de input externo y es lineal (cuantificadores anidados sin solape de
// clases) → sin vector ReDoS.
const PROGRESS_BLOCK_RE = /^progress:\s*\r?\n((?:[ \t]+.*(?:\r?\n|$))*)/m;

/**
 * Parser del bloque `progress:` del STATE.md. Aísla el primer frontmatter con un
 * regex CONSTANTE, ACOTA el bloque `progress:` (solo sus hijos indentados, WR-01) y
 * extrae cada key de la allowlist literal con un regex constante por key (la key es
 * literal de allowlist → no es input externo). Devuelve solo las keys encontradas.
 * Sin frontmatter → null.
 *
 * El acotado al bloque `progress:` impide que una key allowlisted indentada bajo OTRO
 * bloque YAML (p.ej. `other:`) alimente el N/M del dashboard (WR-01). Sin bloque
 * `progress:` → no se considera ninguna key (objeto vacío).
 *
 * Las keys del bloque progress: son CONDICIONALES (el generador GSD añade cada una
 * con `if (x !== null)`) → la ausencia se tolera (la key simplemente no aparece en
 * el objeto devuelto).
 *
 * @param {string} md  contenido completo del STATE.md.
 * @returns {Record<string, number> | null}  keys numéricas encontradas, o null si no hay frontmatter.
 */
export function parseProgressBlock(md) {
  const fm = FRONTMATTER_RE.exec(md);
  if (!fm) return null; // sin frontmatter --- ... --- → corrupto/no parseable
  // Acota al bloque `progress:` (WR-01): solo sus hijos indentados son candidatos.
  // Sin bloque `progress:` → body vacío → ninguna key se extrae.
  const blockHit = PROGRESS_BLOCK_RE.exec(fm[1]);
  const body = blockHit ? blockHit[1] : '';
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of PROGRESS_KEYS) {
    // Regex CONSTANTE por key: la key es un literal de la allowlist (no input
    // externo) → no es vector ReDoS. Captura el primer entero asociado a la key
    // dentro del bloque progress: (indentado a 2 espacios bajo `progress:`).
    const re = new RegExp(`^\\s+${key}:\\s*(\\d+)`, 'm');
    const hit = re.exec(body);
    if (hit) out[key] = Number(hit[1]);
  }
  return out;
}

/**
 * Lee el bloque `progress:` del STATE.md del worktree GSD y deriva el progreso por
 * FASES (DG-01). Síncrono, never-throws (DG-07).
 *
 * Mapeo de status (espejo de readLightPlan):
 *   - bloque con total_phases → 'ok' (n = completed_phases ?? 0, m = total_phases,
 *     completed = m>0 && n===m);
 *   - STATE.md presente pero sin total_phases (parcial) → 'no-progress';
 *   - ENOENT (sin STATE.md) → 'no-progress';
 *   - EACCES / contenido corrupto sin frontmatter → 'error' (never-throws).
 *
 * La ruta se CONSTRUYE con root FIJO `join(worktreeBase, '.planning', 'STATE.md')`.
 * El guard anti-traversal del worktreeBase vive en el CALLER (App.js, Plan 02 —
 * mold plan.js:120-121, String.includes NO regex); aquí worktreeBase ya viene
 * validado (T-501-traversal).
 *
 * @param {string} worktreeBase  raíz del worktree GSD (validada por el caller).
 * @param {{ readFileFn?: (p: string) => string }} [deps]
 *   `readFileFn` aísla el disco en tests.
 * @returns {ProgressResult}
 */
export function readGsdProgress(worktreeBase, deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  try {
    const md = readFileFn(join(worktreeBase, '.planning', 'STATE.md'));
    const block = parseProgressBlock(md);
    // Sin frontmatter parseable → contenido corrupto → 'error' (no 'no-progress').
    if (!block) return { status: 'error' };
    // Sin denominador (total_phases ausente — STATE.md parcial) → no hay progreso.
    if (block.total_phases == null) return { status: 'no-progress' };
    const m = block.total_phases;
    const n = block.completed_phases ?? 0; // condicional → default 0 (0/M válido)
    return { status: 'ok', n, m, completed: m > 0 && n === m };
  } catch (err) {
    const code = /** @type {NodeJS.ErrnoException} */ (err)?.code;
    if (code === 'ENOENT') return { status: 'no-progress' }; // STATE.md ausente (DG-07)
    return { status: 'error' }; // EACCES / sin .code → '?' + keep-last-good (never-throws)
  }
}
