// @ts-check
//
// src/review/guard.js — KODO-75: la restricción de escritura del rol reviewer.
//
// LA GARANTÍA QUE DA ESTE MÓDULO. El reviewer no puede tocar código de producción, tests,
// scripts de build ni comportamiento: los únicos ficheros que consigue commitear son
// artefactos bajo `review/`. No es una instrucción del prompt —un prompt se ignora— sino una
// propiedad MECÁNICA del commit: el pathspec.
//
// POR QUÉ IMPORTA. Un reviewer que puede arreglar lo que debía criticar deja de ser un
// segundo par de ojos y vuelve a ser el mismo juez de antes: apaga el hallazgo en vez de
// escribirlo, y el artefacto que el núcleo lee para decidir se queda vacío mientras el
// problema sigue ahí, ahora además con un parche que nadie ha revisado. La restricción no
// protege al repo del reviewer; protege al REVIEW de la tentación de arreglar.
//
// PRECEDENTE EXACTO, no invención. El auto-commit de aprendizajes del orquestador
// (`hooks/stop.js` → `handleOrchestratorStop`) ya está gated por `KODO_ORCHESTRATOR=1` y usa
// pathspec restringido en `add` Y en `commit`. Este módulo es el mismo mecanismo con otro
// marcador y otro pathspec — misma forma, mismos dos pasos, misma razón de que el pathspec
// vaya en los dos sitios.
//
// ─── POR QUÉ EL PATHSPEC VA EN `add` **Y** EN `commit` ──────────────────────────────────
//
// `git add -- review/` limita lo que se AÑADE al índice, pero no lo que se COMMITEA: si el
// índice ya traía algo staged de antes, `git commit` sin pathspec se lo lleva por delante.
// `git commit -- review/` cierra ese hueco commiteando exclusivamente esas rutas, ignorando
// el resto del índice. Los dos pasos juntos son la garantía; cualquiera de ellos solo, no.
//
// ─── EL GATE `KODO_REVIEWER=1` ──────────────────────────────────────────────────────────
//
// Sin él, cualquier sesión que importara este módulo podría commitear. El marcador lo inyecta
// el lanzamiento de la sesión de revisión (`src/review/launch.js`) como prefijo de entorno del
// shell, igual que `KODO_ORCHESTRATOR=1`. Una sesión normal —o un test, o el dev— no lo trae y
// `commitReviewArtifacts` hace no-op con traza. Skip con log, NUNCA error: un commit que no
// ocurre es recuperable; uno que ocurre donde no debía, no.
//
// NEVER-THROWS. Todas las salidas son uniones discriminadas.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEW_DIR, REVIEW_PATHSPEC } from './artifacts.js';

/** Marcador de entorno que habilita el commit del reviewer. Espejo de `KODO_ORCHESTRATOR`. */
export const REVIEWER_ENV = 'KODO_REVIEWER';

/**
 * ¿Está esta ruta DENTRO del área de escritura del reviewer?
 *
 * La comparación es sobre segmentos de ruta, no sobre prefijo de cadena, y ahí está el
 * matiz que evita el agujero: `'reviewers/hack.js'.startsWith('review')` es `true`, y un
 * chequeo ingenuo dejaría pasar todo un directorio hermano. Se exige que el PRIMER segmento
 * sea exactamente `review`.
 *
 * Se normalizan las barras invertidas porque `git status --porcelain` emite `/` siempre, pero
 * un llamante en Windows puede pasar rutas del sistema.
 *
 * PURA.
 *
 * @param {string} path Ruta relativa a la raíz del repo.
 * @returns {boolean}
 */
export function isReviewPath(path) {
  if (typeof path !== 'string' || path === '') return false;
  const segments = path.replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
  // Un `..` en cualquier posición sale del árbol: se rechaza sin analizar más.
  if (segments.includes('..')) return false;
  // `review/` a secas (el directorio, sin fichero dentro) no es un cambio commiteable.
  return segments.length >= 2 && segments[0] === REVIEW_DIR;
}

/**
 * Reparte una lista de rutas en las que el reviewer PUEDE commitear y las que no.
 * PURA — es la función que hace legible una violación sin tocar disco.
 *
 * @param {string[]} paths
 * @returns {{ inside: string[], outside: string[] }}
 */
export function classifyPaths(paths) {
  const inside = [];
  const outside = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== 'string' || p === '') continue;
    (isReviewPath(p) ? inside : outside).push(p);
  }
  return { inside, outside };
}

/**
 * Extrae las rutas de una salida de `git status --porcelain`.
 *
 * Cada línea trae dos columnas de estado, un espacio, y la ruta. La ruta es TODO lo que va
 * tras la columna 3 —no el primer token—, así que los nombres con espacios sobreviven. En un
 * rename (`R  vieja -> nueva`) la que cuenta es la de DESTINO: es donde queda el contenido.
 *
 * Las comillas que git añade a rutas con caracteres raros (`core.quotePath`) se dejan tal
 * cual: una ruta citada nunca casará con `review/…`, y el lado seguro de esa duda es
 * clasificarla como FUERA.
 *
 * PURA.
 *
 * @param {string} porcelain
 * @returns {string[]}
 */
export function parsePorcelainPaths(porcelain) {
  if (typeof porcelain !== 'string') return [];
  const out = [];
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    const arrow = rest.indexOf(' -> ');
    out.push(arrow === -1 ? rest : rest.slice(arrow + 4));
  }
  return out;
}

/**
 * Inspecciona el working tree y dice si el reviewer se ha salido de su carril.
 *
 * Es la función de DIAGNÓSTICO, no la de defensa: la defensa es el pathspec del commit, que
 * funciona aunque nadie llame aquí. Ésta existe para que la violación sea VISIBLE —el
 * reviewer que editó `src/foo.js` merece que se le diga, en vez de que su cambio desaparezca
 * en silencio y él crea que lo arregló.
 *
 * NEVER-THROWS: un `git status` que falla se lee como «no se pudo inspeccionar», no como
 * «todo limpio».
 *
 * @param {string} dir
 * @param {{ gitFn?: (cwd: string, args: string[]) => string }} [deps]
 * @returns {{ ok: true, inside: string[], outside: string[] } | { ok: false, reason: 'git-failed', detail: string }}
 */
export function inspectWorkingTree(dir, deps = {}) {
  const gitFn = deps.gitFn || defaultGitSync;
  let porcelain;
  try {
    // `-uall` es OBLIGATORIO, no una preferencia. Por defecto `git status --porcelain`
    // COLAPSA un directorio entero sin trackear en una sola línea (`?? review/`), y esa línea
    // no es una ruta de fichero: `isReviewPath` la rechaza —correctamente, un directorio no es
    // un cambio commiteable— y el artefacto recién escrito aparecería reportado como si
    // estuviera FUERA del área del reviewer. El síntoma sería un mensaje que le dice al
    // reviewer que su propio artefacto no se ha commiteado, justo cuando sí se ha commiteado.
    porcelain = String(gitFn(dir, ['status', '--porcelain', '-uall']));
  } catch (err) {
    return { ok: false, reason: 'git-failed', detail: /** @type {Error} */ (err).message };
  }
  const { inside, outside } = classifyPaths(parsePorcelainPaths(porcelain));
  return { ok: true, inside, outside };
}

/**
 * Commitea los artefactos de revisión — y NADA más.
 *
 * Los tres pasos, en orden, y por qué cada uno:
 *
 *   1. GATE `KODO_REVIEWER=1`. Sin marcador no se commitea nada. Skip con traza, exit limpio.
 *   2. `git add -- review/`      → al índice entra solo el área del reviewer.
 *   3. `git commit -- review/`   → al commit entra solo el área del reviewer, aunque el
 *                                  índice trajera algo más de antes (ver cabecera).
 *
 * `-c commit.gpgsign=false` por el mismo motivo que en `handleOrchestratorStop`: un dev con
 * firma GPG global y sin TTY colgaría el hook esperando passphrase, y no se firma con la clave
 * personal del dev un commit generado por un LLM.
 *
 * DEVUELVE, además del resultado, las rutas que quedaron FUERA — para que el llamante pueda
 * decírselo al reviewer y al operador. Un cambio descartado en silencio es la única forma en
 * que esta restricción podría hacer daño, y esto es lo que la evita.
 *
 * @param {{ dir: string, message: string }} params
 * @param {{
 *   gitFn?: (cwd: string, args: string[]) => string,
 *   existsFn?: typeof existsSync,
 *   env?: Record<string, string|undefined>,
 * }} [deps]
 * @returns {{ ok: true, committed: true, sha: string|null, skipped: string[] }
 *          | { ok: true, committed: false, reason: 'nothing-to-commit', skipped: string[] }
 *          | { ok: false, reason: 'not-reviewer-session'|'git-failed', detail?: string }}
 */
export function commitReviewArtifacts(params, deps = {}) {
  const env = deps.env || process.env;
  const gitFn = deps.gitFn || defaultGitSync;
  const dir = params?.dir;
  const message = params?.message;

  // 1. Gate. Espejo literal del de `handleOrchestratorStop` (hooks/stop.js).
  if (env[REVIEWER_ENV] !== '1') {
    return { ok: false, reason: 'not-reviewer-session' };
  }
  if (typeof dir !== 'string' || dir === '' || typeof message !== 'string' || message === '') {
    return { ok: false, reason: 'git-failed', detail: 'missing dir or message' };
  }

  // Se inspecciona ANTES de tocar el índice: lo que quede fuera hay que poder contarlo, y
  // después del commit ya no se distingue «lo dejé fuera» de «nunca estuvo».
  const inspection = inspectWorkingTree(dir, { gitFn });
  const skipped = inspection.ok ? inspection.outside : [];

  // Si `review/` NO EXISTE, `git add -- review/` aborta con «pathspec did not match any
  // files». Eso no es un fallo: es el reviewer que cerró sin escribir nada —o que solo tocó
  // código, que es justo la mordida que este módulo bloquea— y merece la misma salida limpia
  // que un `review/` sin cambios.
  //
  // Se detecta comprobando el DIRECTORIO, no el mensaje de error. git está traducido: en una
  // máquina en español ese fatal sale como «ruta especificada 'review/' no concordó con ningún
  // archivo», así que cualquier regex sobre el texto inglés funcionaría en CI y fallaría en el
  // portátil del operador. La pregunta «¿existe el directorio?» no habla ningún idioma.
  const existsFn = deps.existsFn || existsSync;
  if (!existsFn(join(dir, REVIEW_DIR))) {
    return { ok: true, committed: false, reason: 'nothing-to-commit', skipped };
  }

  try {
    // 2. Pathspec en el add.
    gitFn(dir, ['add', '--', REVIEW_PATHSPEC]);

    // ¿Ha quedado algo staged DENTRO del área? `--quiet` sale 0 si no hay diferencias, 1 si
    // las hay — así que el "nada que commitear" se detecta sin parsear texto ni depender del
    // idioma de git.
    let hasStaged = false;
    try {
      gitFn(dir, ['diff', '--cached', '--quiet', '--', REVIEW_PATHSPEC]);
    } catch {
      hasStaged = true;
    }
    if (!hasStaged) {
      return { ok: true, committed: false, reason: 'nothing-to-commit', skipped };
    }

    // 3. Pathspec TAMBIÉN en el commit. Éste es el paso que cierra el hueco del índice sucio.
    gitFn(dir, ['-c', 'commit.gpgsign=false', 'commit', '-m', message, '--', REVIEW_PATHSPEC]);

    let sha = null;
    try {
      sha = String(gitFn(dir, ['rev-parse', 'HEAD'])).trim() || null;
    } catch {
      /* el commit ya ocurrió; el SHA es informativo */
    }
    return { ok: true, committed: true, sha, skipped };
  } catch (err) {
    return { ok: false, reason: 'git-failed', detail: /** @type {Error} */ (err).message };
  }
}

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function defaultGitSync(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
}
