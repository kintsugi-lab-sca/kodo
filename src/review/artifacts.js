// @ts-check
//
// src/review/artifacts.js — KODO-75: los artefactos del rol reviewer y su lectura DETERMINISTA.
//
// EL PROBLEMA QUE RESUELVE. Hoy la verificación de una sesión es autodeclarada: la propia
// sesión escribe `VERIFICATION.md` y `kodo gsd verify` lo lee. Es un juez que se evalúa a sí
// mismo. Ni verificar el artefacto con herramientas ni forzar una relectura del mismo agente
// cambian eso — falta un segundo par de ojos INDEPENDIENTE. Este módulo es la mitad del
// núcleo que hace legible ese segundo par de ojos SIN volver a preguntarle a un LLM.
//
// EL CONTRATO. El reviewer escribe DOS clases de artefacto bajo `review/`:
//
//   review/approval.md                            → «he terminado y estoy satisfecho»
//   review/recommendations/NNN-recommendations.md  → «hay trabajo pendiente, ronda NNN»
//
// y el núcleo deriva de ahí, con `git` y expresiones regulares, el estado de la cola:
//
//   existe approval.md anclado al head revisado → la entrada de la cola SUBE de confianza
//   existe un NNN-recommendations.md nuevo      → hay trabajo pendiente, relanzar
//
// CERO LLM en este módulo. Es el punto entero: si para saber si una rama está aprobada
// hubiera que preguntarle a un modelo, habríamos cambiado un juez que se evalúa a sí mismo
// por dos jueces que se evalúan entre ellos, y el núcleo seguiría sin poder decidir nada.
//
// ─── EL ANCLA: `reviewedHead`, no `HEAD` ────────────────────────────────────────────────
//
// La tentación es anclar la aprobación al HEAD de la rama: «approval.md apunta a HEAD →
// aprobado». No funciona, y el motivo es circular: el reviewer COMMITEA su approval.md, y ese
// commit mueve HEAD. El `commit:` que acaba de escribir sería stale un segundo después de
// escribirlo, y ninguna rama estaría jamás aprobada.
//
// El ancla correcta es el último commit que tocó algo FUERA de `review/` — lo que aquí se
// llama el `reviewedHead`: el estado del CÓDIGO que el reviewer miró. Propiedades que salen
// gratis de esa elección:
//
//   - los commits de artefactos del propio reviewer NO invalidan su aprobación (no mueven el
//     reviewedHead: solo tocan `review/`);
//   - un commit nuevo del coder SÍ la invalida al instante, porque mueve el reviewedHead y el
//     `commit:` del approval deja de coincidir. Eso es `stale-approval`, y NO cuenta como
//     aprobado: una aprobación de código que ya no es el código que hay es exactamente el
//     fallo que este milestone existe para no tener;
//   - el orden entre approval y recomendaciones se resuelve solo, sin timestamps ni mtimes:
//     si el reviewer aprueba después de pedir cambios, su approval apunta al reviewedHead
//     vigente y gana; si el coder trabaja después de aprobar, el approval queda stale.
//
// FAIL-CLOSED de cuerpo entero: un artefacto ausente, ilegible, con frontmatter roto o con un
// `commit:` que no parece un SHA JAMÁS produce `approved`. La duda degrada a «sin revisar»,
// nunca a «revisado» — el lado seguro de la asimetría es no dejar pasar código.
//
// NEVER-THROWS: toda función pública devuelve una unión discriminada. Este módulo lo consumen
// el CLI, la cola de integración y (en el futuro) el dispatcher; ninguno debe caerse porque
// un fichero de review esté a medias.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Directorio raíz de los artefactos de revisión, relativo a la raíz del repo. */
export const REVIEW_DIR = 'review';

/** Ruta relativa del artefacto de aprobación. */
export const APPROVAL_REL = 'review/approval.md';

/** Ruta relativa del directorio de recomendaciones. */
export const RECOMMENDATIONS_REL = 'review/recommendations';

/**
 * El pathspec ÚNICO que el reviewer puede escribir. Vive aquí, junto a la definición de los
 * artefactos, y no en el guard, porque es la misma frase dicha una vez: «los artefactos de
 * revisión son esto, y esto es lo único que el reviewer commitea». El guard lo IMPORTA.
 *
 * La barra final es significativa para git: `review/` es el directorio (y todo su contenido),
 * no un fichero llamado `review`.
 */
export const REVIEW_PATHSPEC = 'review/';

/**
 * Nombre de fichero de una ronda de recomendaciones: exactamente 3 dígitos, guion,
 * `recommendations.md`. Anclado en ambos extremos — `12-recommendations.md` y
 * `0001-recommendations.md` NO son rondas válidas, y tratarlos como tales rompería el
 * orden lexicográfico que hace que `ls` y el orden numérico coincidan.
 */
const RECOMMENDATION_RE = /^(\d{3})-recommendations\.md$/;

/**
 * Un SHA de git tal y como lo emite `--format=%H`: 40 hex en minúscula. La validación es
 * estricta a propósito. El `commit:` del frontmatter lo escribe un LLM, y un valor como
 * `HEAD`, `abc123 (aprox)` o `el último commit` debe leerse como frontmatter ROTO —
 * no compararse laxamente con el reviewedHead hasta que por casualidad coincida.
 *
 * Se aceptan también los prefijos abreviados de ≥7 hex, que es lo que un humano copia de
 * `git log --oneline`; la comparación entonces es por prefijo (ver `sameCommit`).
 */
const SHA_RE = /^[0-9a-f]{7,40}$/;

/**
 * Claves escalares que se extraen del frontmatter de un artefacto de revisión.
 * Todo lo demás (prosa, tablas, la lista «Things To Address») se ignora en silencio: este
 * parser decide el ESTADO, y el contenido del review lo lee un humano.
 */
const FRONTMATTER_KEYS = /** @type {const} */ (['branch', 'commit', 'round']);

/**
 * @typedef {{ branch: string|null, commit: string, round: number|null }} ReviewFrontmatter
 * @typedef {{ error: string }} ReviewParseError
 *
 * @typedef {{ seq: number, name: string, path: string, frontmatter: ReviewFrontmatter|ReviewParseError }} RecommendationFile
 *
 * @typedef {{ state: 'approved', commit: string, reviewed_head: string, round: number, path: string }} ApprovedState
 * @typedef {{ state: 'stale-approval', commit: string, reviewed_head: string, round: number, path: string }} StaleApprovalState
 * @typedef {{ state: 'changes-requested', round: number, path: string, commit: string|null, reviewed_head: string|null }} ChangesRequestedState
 * @typedef {{ state: 'none', round: 0 }} NoneState
 * @typedef {{ state: 'malformed', detail: string, round: number }} MalformedState
 * @typedef {ApprovedState | StaleApprovalState | ChangesRequestedState | NoneState | MalformedState} ReviewState
 */

/**
 * Parsea el frontmatter YAML de un artefacto de revisión.
 *
 * Reconoce SOLO asignaciones escalares de primer nivel (`clave: valor`) para las tres claves
 * de `FRONTMATTER_KEYS`. No hay dependencia de YAML y no la habrá: el mismo criterio, y por el
 * mismo motivo, que `src/gsd/verification.js` — un parser de 4 escalares no justifica arrastrar
 * un parser de YAML completo al grafo de imports del núcleo.
 *
 * `commit` es la única clave OBLIGATORIA: es la que ancla el artefacto a un estado del código.
 * `branch` es informativa (el núcleo ya sabe sobre qué rama está mirando) y `round` es
 * redundante con el nombre del fichero, así que su ausencia no invalida nada.
 *
 * NEVER-THROWS.
 *
 * @param {string} md Contenido crudo del artefacto.
 * @returns {ReviewFrontmatter | ReviewParseError}
 */
export function parseReviewFrontmatter(md) {
  if (typeof md !== 'string') return { error: 'input must be string' };

  const fm = md.match(/^---\s*\n([\s\S]*?)\n---(?:\s|$)/);
  if (!fm) return { error: 'no frontmatter block' };

  /** @type {Record<string, string>} */
  const parsed = Object.create(null);
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^([A-Za-z_]\w*):\s*"?(.*?)"?\s*$/);
    if (!m) continue;
    const key = m[1];
    if (!FRONTMATTER_KEYS.includes(/** @type {any} */ (key))) continue;
    // Comentario YAML inline: `#` que abre el valor, o precedido de espacio. Mismo criterio
    // que verification.js — un `#` pegado a texto (`feat/a#b`) es literal, no comentario.
    let value = m[2];
    if (value.startsWith('#')) value = '';
    else {
      const hash = value.search(/\s#/);
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    if (value === '') continue;
    parsed[key] = value;
  }

  const commit = parsed.commit ? parsed.commit.toLowerCase() : '';
  if (!commit) return { error: 'missing field commit' };
  if (!SHA_RE.test(commit)) return { error: `field commit not a sha: ${parsed.commit}` };

  let round = null;
  if (parsed.round !== undefined) {
    const n = parseInt(parsed.round, 10);
    // Un `round` presente pero no numérico NO invalida el artefacto: el número de ronda
    // canónico es el del NOMBRE del fichero, y éste es una comodidad de lectura.
    if (!Number.isNaN(n) && String(n) === parsed.round.trim()) round = n;
  }

  return { branch: parsed.branch ?? null, commit, round };
}

/**
 * Extrae el número de ronda del nombre de un fichero de recomendaciones.
 * @param {string} name
 * @returns {number|null} `null` si el nombre no es una ronda válida.
 */
export function recommendationSeq(name) {
  if (typeof name !== 'string') return null;
  const m = name.match(RECOMMENDATION_RE);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/**
 * Nombre canónico del fichero de la ronda `seq`, con relleno a 3 dígitos.
 * @param {number} seq
 * @returns {string}
 */
export function formatRecommendationName(seq) {
  return `${String(seq).padStart(3, '0')}-recommendations.md`;
}

/**
 * Siguiente nombre de ronda dado el listado de ficheros ya existentes.
 *
 * Numera desde el MÁXIMO + 1, no desde «cuántos hay»: un hueco (la ronda 002 borrada a mano)
 * no debe hacer que la 004 se llame 003 y pise la traza de la que sí queda.
 *
 * @param {string[]} names Nombres de fichero (no rutas) del directorio de recomendaciones.
 * @returns {string}
 */
export function nextRecommendationName(names) {
  const max = highestRound(Array.isArray(names) ? names : []);
  return formatRecommendationName(max + 1);
}

/**
 * @param {string[]} names
 * @returns {number} 0 si no hay ninguna ronda válida.
 */
function highestRound(names) {
  let max = 0;
  for (const n of names) {
    const seq = recommendationSeq(n);
    if (seq !== null && seq > max) max = seq;
  }
  return max;
}

/**
 * Lee TODOS los artefactos de revisión presentes bajo `<dir>/review/`.
 *
 * Lectura pura de filesystem, sin git y sin red. NEVER-THROWS: un directorio ausente o
 * ilegible se lee como «no hay artefactos», que es indistinguible de la verdad para el
 * llamante y siempre el lado seguro.
 *
 * @param {string} dir Raíz del repo o del worktree.
 * @param {{ existsFn?: typeof existsSync, readFn?: (p: string) => string, readdirFn?: (p: string) => string[] }} [deps]
 * @returns {{ approval: { path: string, frontmatter: ReviewFrontmatter|ReviewParseError }|null, recommendations: RecommendationFile[] }}
 */
export function readReviewArtifacts(dir, deps = {}) {
  const existsFn = deps.existsFn || existsSync;
  const readFn = deps.readFn || ((p) => readFileSync(p, 'utf-8'));
  const readdirFn = deps.readdirFn || ((p) => readdirSync(p));

  /** @type {{ path: string, frontmatter: ReviewFrontmatter|ReviewParseError }|null} */
  let approval = null;
  const approvalPath = join(dir, APPROVAL_REL);
  try {
    if (existsFn(approvalPath)) {
      approval = { path: approvalPath, frontmatter: parseReviewFrontmatter(readFn(approvalPath)) };
    }
  } catch (err) {
    approval = { path: approvalPath, frontmatter: { error: `unreadable: ${/** @type {Error} */ (err).message}` } };
  }

  /** @type {RecommendationFile[]} */
  const recommendations = [];
  const recsDir = join(dir, RECOMMENDATIONS_REL);
  try {
    if (existsFn(recsDir)) {
      for (const name of readdirFn(recsDir)) {
        const seq = recommendationSeq(name);
        if (seq === null) continue;
        const path = join(recsDir, name);
        let frontmatter;
        try {
          frontmatter = parseReviewFrontmatter(readFn(path));
        } catch (err) {
          frontmatter = { error: `unreadable: ${/** @type {Error} */ (err).message}` };
        }
        recommendations.push({ seq, name, path, frontmatter });
      }
    }
  } catch {
    /* directorio ilegible → sin recomendaciones, mismo lado seguro que arriba */
  }
  // Orden ascendente por ronda. `readdir` no garantiza orden en ningún sistema de ficheros,
  // y el consumidor lee «la última ronda» del final del array.
  recommendations.sort((a, b) => a.seq - b.seq);

  return { approval, recommendations };
}

/**
 * ¿Son el mismo commit? Comparación por PREFIJO cuando uno de los dos viene abreviado.
 *
 * Un humano copia `a1b2c3d` de `git log --oneline`; `--format=%H` emite los 40. Exigir
 * igualdad exacta convertiría una aprobación legítima escrita a mano en `stale-approval`,
 * que es un falso negativo caro (obliga a otra ronda entera). El prefijo mínimo son 7 hex,
 * que ya lo impone `SHA_RE`.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function sameCommit(a, b) {
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.startsWith(short);
}

/**
 * Resuelve el `reviewedHead`: el último commit de la rama que tocó algo FUERA de `review/`.
 *
 * Es el ancla de toda la derivación (ver la cabecera del módulo). Se calcula con
 * `git log -1 --format=%H -- . ':(exclude)review'` — magic pathspec de git, disponible desde
 * la 1.9 y sin dependencia de shell porque los argumentos van en array.
 *
 * DEGRADACIÓN: si git no contesta, o si la rama entera solo tiene commits de `review/`
 * (imposible en un repo real, posible en un fixture), cae a `HEAD`. Devuelve `null` solo si
 * git no responde a NADA — y entonces la derivación entera degrada a `malformed`, que
 * fail-closed significa «no aprobado».
 *
 * @param {string} dir
 * @param {{ gitFn?: (cwd: string, args: string[]) => string }} [deps]
 * @returns {string|null} SHA en minúscula, o `null`.
 */
export function resolveReviewedHead(dir, deps = {}) {
  const gitFn = deps.gitFn || defaultGitSync;
  try {
    const out = String(gitFn(dir, ['log', '-1', '--format=%H', '--', '.', ':(exclude)review'])).trim();
    if (SHA_RE.test(out.toLowerCase())) return out.toLowerCase();
  } catch {
    /* cae al HEAD pelado */
  }
  try {
    const head = String(gitFn(dir, ['rev-parse', 'HEAD'])).trim().toLowerCase();
    return SHA_RE.test(head) ? head : null;
  } catch {
    return null;
  }
}

/**
 * `git` síncrono por defecto. Síncrono y no `async` a propósito: la derivación la consumen
 * un CLI y un formateador de cola que ya son síncronos, y volverla asíncrona obligaría a
 * propagar `await` por toda la cadena de lectura sin ganar nada (son dos invocaciones de
 * milisegundos, no I/O de red). Los argumentos van en array — sin shell, sin quoting, así
 * que el magic pathspec `:(exclude)review` viaja literal.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function defaultGitSync(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
}

/**
 * Deriva el ESTADO DE REVISIÓN de una rama a partir de sus artefactos. El corazón del
 * módulo: es la función que permite al núcleo decidir sin preguntarle a ningún LLM.
 *
 * PRECEDENCIA (documentada porque dos condiciones pueden darse a la vez):
 *   1. approval.md con frontmatter roto            → 'malformed'  (fail-closed)
 *   2. approval.md anclado al reviewedHead         → 'approved'
 *   3. approval.md anclado a OTRO commit           → 'stale-approval'
 *   4. sin approval, con ≥1 ronda de recomendaciones → 'changes-requested'
 *   5. nada                                        → 'none'
 *
 * Que (2) gane a (4) no es arbitrario: un approval que apunta al reviewedHead VIGENTE se
 * escribió necesariamente después de la última ronda de recomendaciones, porque cualquier
 * commit de código posterior habría movido el reviewedHead y lo habría dejado stale. El
 * orden temporal se deduce del ancla, sin mirar mtimes (que un checkout reescribe).
 *
 * NEVER-THROWS.
 *
 * @param {{ dir: string, reviewedHead?: string|null }} params `reviewedHead` inyectable para
 *   tests y para el llamante que ya lo resolvió; si se omite, se resuelve con git.
 * @param {{ existsFn?: typeof existsSync, readFn?: (p: string) => string, readdirFn?: (p: string) => string[], gitFn?: (cwd: string, args: string[]) => string }} [deps]
 * @returns {ReviewState}
 */
export function deriveReviewState(params, deps = {}) {
  const dir = params?.dir;
  if (typeof dir !== 'string' || dir === '') {
    return { state: 'malformed', detail: 'missing dir', round: 0 };
  }

  const { approval, recommendations } = readReviewArtifacts(dir, deps);
  const round = recommendations.length > 0 ? recommendations[recommendations.length - 1].seq : 0;

  if (!approval) {
    if (round === 0) return { state: 'none', round: 0 };
    const last = recommendations[recommendations.length - 1];
    const fmt = /** @type {any} */ (last.frontmatter);
    return {
      state: 'changes-requested',
      round,
      path: last.path,
      commit: fmt?.error === undefined ? fmt.commit : null,
      reviewed_head: null,
    };
  }

  const fm = /** @type {any} */ (approval.frontmatter);
  if (fm.error !== undefined) {
    // Fail-closed explícito: un approval ilegible NO aprueba nada, y se distingue de «no hay
    // approval» para que el operador pueda arreglar el fichero en vez de pedir otra ronda.
    return { state: 'malformed', detail: `approval.md: ${fm.error}`, round };
  }

  const reviewedHead =
    params.reviewedHead !== undefined
      ? (params.reviewedHead ? String(params.reviewedHead).toLowerCase() : null)
      : resolveReviewedHead(dir, deps);

  if (!reviewedHead) {
    return { state: 'malformed', detail: 'cannot resolve reviewed head (git silent)', round };
  }

  if (sameCommit(fm.commit, reviewedHead)) {
    return { state: 'approved', commit: fm.commit, reviewed_head: reviewedHead, round, path: approval.path };
  }
  return { state: 'stale-approval', commit: fm.commit, reviewed_head: reviewedHead, round, path: approval.path };
}

/**
 * Traduce un `ReviewState` a la CONFIANZA que merece una entrada de la cola de integración.
 *
 * PURA. Se lee en el momento de listar la cola, y deliberadamente NO se persiste como clave
 * nueva de `IntegrationEntry`: esa entrada tiene 17 claves en un orden que es contrato del
 * `--json` (invariante DX-06), y un dato DERIVABLE de la rama no justifica romperlo. Además
 * un valor persistido envejecería —el reviewedHead se mueve con cada commit del coder— y una
 * confianza caducada es peor que ninguna.
 *
 *   'reviewed'          — hay un segundo par de ojos y cubre el código actual. Sube confianza.
 *   'changes-requested' — el reviewer pidió cambios y nadie los ha cerrado. NO integrar.
 *   'stale'             — hubo aprobación, pero el código ha cambiado desde entonces.
 *   'unreviewed'        — sin artefactos, o con artefactos rotos (fail-closed).
 *
 * @param {ReviewState} reviewState
 * @returns {'reviewed'|'changes-requested'|'stale'|'unreviewed'}
 */
export function reviewConfidence(reviewState) {
  switch (reviewState?.state) {
    case 'approved':
      return 'reviewed';
    case 'changes-requested':
      return 'changes-requested';
    case 'stale-approval':
      return 'stale';
    default:
      // 'none' y 'malformed' comparten salida a propósito: la asimetría del fail-closed dice
      // que un artefacto que no se entiende vale lo mismo que un artefacto que no existe.
      return 'unreviewed';
  }
}
