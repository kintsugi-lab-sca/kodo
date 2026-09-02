// @ts-check
//
// src/integration/scope.js — KODO-69: el check de ALCANCE del oráculo mecánico.
//
// HOJA PURA con CERO imports, misma disciplina que `suggest.js`: entran los ficheros que la
// rama tocó y el alcance que la tarea declaró, sale un veredicto. No hace I/O, no llama a git,
// no lee state.json y NUNCA lanza. Quien lee el plan de disco y quien pregunta el diff a git es
// `oracle.js`.
//
// POR QUÉ ESTE CHECK ES EL DE MÁS VALOR DEL ORÁCULO, y por qué pide diseño propio en vez de
// heurística: `build`/`tests`/`lint` responden «¿el artefacto está sano?», que es una pregunta
// que el repo ya sabe contestar por su cuenta (CI, la propia suite). El alcance contesta otra
// que NADIE contesta hoy: «¿esta rama toca lo que dijo que iba a tocar?». Es la que atrapa el
// scope creep, el fichero de auth que se coló en un cambio de docs, y la migración que aparece
// en una rama que no la anunciaba — exactamente la clase de commit que se descubre después de
// mergear.
//
// LA FUENTE DEL ALCANCE ES DECLARADA, JAMÁS INFERIDA. Un alcance adivinado (por el título de la
// tarea, por los ficheros que ya existían, por el nombre de la rama) daría un `fail` que nadie
// puede defender, y un check que grita en falso se apaga. Sin bloque declarado el veredicto es
// `skip`: no había nada contra lo que comparar, y decirlo es la respuesta honesta.
//
// EL MARCADOR es el idioma que el repo ya usa para los bloques que kodo parsea del markdown de
// un LLM (`<!-- kodo:handoff v=1 … -->`, session/handoff.js): comentario HTML, invisible en el
// render, con versión explícita para que un cambio de formato futuro no rompa los planes ya
// escritos.

/**
 * Apertura y cierre del bloque de alcance dentro del plan de la tarea
 * (`~/.kodo/plans/<task_id>.md`). CONTRATO DE PARSING — el prompt de sesión los nombra y los
 * tests los pinean; ver test/CONVENTIONS.md.
 *
 * @type {string}
 */
export const SCOPE_OPEN = '<!-- kodo:scope v=1 -->';
/** @type {string} */
export const SCOPE_CLOSE = '<!-- /kodo:scope -->';

/**
 * Tope de patrones que se aceptan de UN bloque. Un plan escrito por un LLM es texto arbitrario:
 * sin tope, un bloque degenerado de diez mil líneas se traduce en diez mil regex compiladas en
 * el camino de un hook. 200 es holgadísimo para declarar el alcance de una tarea —si de verdad
 * hacen falta más, el patrón correcto es un `**`, no la enumeración.
 */
export const MAX_SCOPE_PATTERNS = 200;

/**
 * Tope de ficheros fuera de alcance que se nombran en el `detail`. El resto se resume con un
 * `+N más`: el detalle viaja a `state.json` y de ahí al `--json` del CLI, así que una rama que
 * se salió del alcance por 400 ficheros no puede inflar el estado.
 */
export const MAX_REPORTED = 10;

/**
 * Extrae los patrones de alcance del markdown de un plan.
 *
 * GANA EL ÚLTIMO BLOQUE, no el primero ni la unión. El fichero del plan es APPEND-ONLY por
 * contrato (el prompt de sesión lo dice: «si el fichero ya existe, NO lo sobrescribas: añade tu
 * plan al final»), así que acumula el plan de cada sesión que pasó por la tarea. El alcance
 * vigente es el de la sesión que acaba de cerrar — es decir, el último. La unión de todos daría
 * un alcance que solo crece y que acabaría no excluyendo nada, que es lo mismo que no tener
 * check.
 *
 * Un bloque abierto y no cerrado NO se parsea: sin cierre no se puede saber dónde acaba el
 * alcance y dónde empieza la prosa del plan, y tragarse el resto del fichero como patrones sería
 * peor que no leer nada. Devuelve `null`, igual que si no hubiera bloque.
 *
 * NEVER-THROWS y TOTAL: cualquier entrada —`undefined`, un número, un markdown de 2 MB—
 * devuelve `string[]` o `null`.
 *
 * @param {unknown} md Markdown completo del plan (contenido de un LLM, no confiable).
 * @returns {string[]|null} Los patrones declarados (≥1), o `null` si no hay bloque utilizable.
 *   Un bloque VACÍO (marcadores sin patrones dentro) también devuelve `null`: declarar «ningún
 *   fichero» no es un alcance, es un bloque que se quedó a medias.
 */
export function parseScopeBlock(md) {
  if (typeof md !== 'string' || md.length === 0) return null;
  const open = md.lastIndexOf(SCOPE_OPEN);
  if (open === -1) return null;
  const bodyStart = open + SCOPE_OPEN.length;
  const close = md.indexOf(SCOPE_CLOSE, bodyStart);
  if (close === -1) return null; // bloque sin cerrar → no se adivina dónde acaba.

  /** @type {string[]} */
  const patterns = [];
  for (const raw of md.slice(bodyStart, close).split('\n')) {
    let line = raw.trim();
    if (!line) continue;
    // Se acepta la viñeta markdown (`- src/**`, `* src/**`) porque es como un humano y un LLM
    // escriben una lista, y también el patrón desnudo. Nada más: un bloque con prosa dentro
    // produce patrones basura que no matchean nada, y eso se ve como un `fail` ruidoso.
    if (line.startsWith('- ') || line.startsWith('* ')) line = line.slice(2).trim();
    // Backticks: el LLM que escribe ``- `src/**` `` no está declarando un fichero llamado
    // "`src/**`". Se recortan solo si envuelven la línea entera.
    if (line.length >= 2 && line.startsWith('`') && line.endsWith('`')) {
      line = line.slice(1, -1).trim();
    }
    if (!line || line.startsWith('#')) continue;
    patterns.push(line);
    if (patterns.length >= MAX_SCOPE_PATTERNS) break;
  }
  return patterns.length > 0 ? patterns : null;
}

/**
 * Escapa los metacaracteres de regex de un literal. Todo lo que no sea un comodín del glob viaja
 * por aquí, así que un fichero llamado `a+b(c).js` no puede convertirse en un patrón que matchee
 * de más — ni en uno que explote.
 *
 * @param {string} s
 * @returns {string}
 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compila UN patrón de glob a regex anclada.
 *
 * El dialecto es DELIBERADAMENTE pequeño — tres comodines y una regla de directorio:
 *
 *   `*`   cualquier cosa DENTRO de un segmento (no cruza `/`)
 *   `**`  cualquier cosa, incluidos separadores (`src/**` cubre `src/a/b/c.js`)
 *   `?`   exactamente un carácter que no sea `/`
 *   `dir/` (barra final) equivale a `dir/**` — el prefijo de directorio, que es como la gente
 *          escribe un alcance a mano
 *
 * No hay `{a,b}`, ni `[abc]`, ni negación con `!`. Cada uno de ellos añade una forma de
 * equivocarse al declarar el alcance, y ninguno hace falta: `**` cubre el 95 % de los casos y
 * dos líneas cubren el resto. Menos dialecto = menos discusiones sobre por qué un fichero cayó
 * fuera.
 *
 * ANTI-ReDoS: los patrones vienen del markdown de un LLM, así que son entrada no confiable. La
 * traducción NUNCA anida cuantificadores — `**` produce `.*` y `*` produce `[^/]*`, ambos
 * planos, y el resto del patrón es literal escapado. Sin `(a+)+` posible, no hay backtracking
 * catastrófico que provocar.
 *
 * @param {string} pattern
 * @returns {RegExp|null} `null` si el patrón es inservible (vacío tras normalizar).
 */
function globToRegExp(pattern) {
  // Un `./` inicial y las barras iniciales sobran: las rutas de `git diff --numstat` son
  // relativas a la raíz del repo y nunca empiezan por `/`.
  let p = pattern.replace(/^\.\//, '').replace(/^\/+/, '');
  if (!p) return null;
  // `src/` (barra final) ⇒ todo lo que cuelga de `src/`.
  if (p.endsWith('/')) p += '**';

  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        // `**/` al principio de un segmento debe poder matchear TAMBIÉN la cadena vacía, para
        // que `**/x.js` cubra un `x.js` en la raíz. De ahí el grupo opcional en vez de `.*/`.
        if (p[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
      continue;
    }
    if (c === '?') {
      re += '[^/]';
      continue;
    }
    re += escapeRe(c);
  }
  try {
    // Anclada en los dos extremos: un alcance `src/a.js` NO puede matchear `other/src/a.js`.
    return new RegExp(`^${re}$`);
  } catch {
    return null;
  }
}

/**
 * Compila una lista de patrones. Los inservibles se descartan en silencio — un patrón que no
 * compila es ruido del plan, no una razón para tumbar el check entero.
 *
 * @param {unknown} patterns
 * @returns {RegExp[]}
 */
export function compileScope(patterns) {
  if (!Array.isArray(patterns)) return [];
  /** @type {RegExp[]} */
  const out = [];
  for (const p of patterns.slice(0, MAX_SCOPE_PATTERNS)) {
    if (typeof p !== 'string') continue;
    const re = globToRegExp(p.trim());
    if (re) out.push(re);
  }
  return out;
}

/**
 * ¿Cae `file` dentro del alcance declarado?
 *
 * @param {string} file Ruta relativa a la raíz del repo, tal y como la da `git diff --numstat`.
 * @param {RegExp[]} compiled
 * @returns {boolean}
 */
export function inScope(file, compiled) {
  if (typeof file !== 'string' || file === '') return false;
  for (const re of compiled) {
    if (re.test(file)) return true;
  }
  return false;
}

/**
 * Veredicto del check de alcance.
 *
 * Los cuatro estados del oráculo, aplicados aquí:
 *
 *   `skip`    — la tarea no declaró alcance. No hay nada contra lo que comparar, y kodo NO lo
 *               inventa. Es el caso mayoritario mientras el bloque no se adopte, y por eso es
 *               `skip` y no `unknown`: un `unknown` arrastraría el veredicto agregado de TODA
 *               entrada a `unknown` y volvería inútil la señal del resto de checks.
 *   `unknown` — SÍ había alcance declarado, pero el diff no es inspeccionable (`files === null`:
 *               git no contestó, o no hubo base resoluble). La pregunta tiene fuente y sigue sin
 *               respuesta: eso es exactamente un unknown.
 *   `fail`    — hay ficheros fuera del alcance declarado. Se nombran (hasta `MAX_REPORTED`).
 *   `pass`    — todo lo que la rama tocó cae dentro.
 *
 * Un diff VACÍO (`files: []`) con alcance declarado da `pass`: no salirse del alcance sin tocar
 * nada es cierto, y no es trabajo de este check opinar sobre una rama sin cambios — de eso ya se
 * ocupa el gate de `commits_ahead` en la captura.
 *
 * PURA y TOTAL. Nunca lanza.
 *
 * @param {{ files?: string[]|null, patterns?: string[]|null }} [input]
 * @returns {{ status: 'pass'|'fail'|'unknown'|'skip', detail: string|null, out_of_scope: string[] }}
 *   `detail` es una línea corta y greppable; `out_of_scope` la lista acotada de infractores
 *   (siempre presente, `[]` cuando no aplica) para que el `--json` sea accionable sin reparsear
 *   la prosa.
 */
export function checkScope(input) {
  const patterns = input && Array.isArray(input.patterns) ? input.patterns : null;
  if (patterns === null || patterns.length === 0) {
    return { status: 'skip', detail: 'sin alcance declarado en el plan', out_of_scope: [] };
  }
  const files = input && Array.isArray(input.files) ? input.files : null;
  if (files === null) {
    return { status: 'unknown', detail: 'diff no inspeccionable', out_of_scope: [] };
  }

  const compiled = compileScope(patterns);
  if (compiled.length === 0) {
    // Había bloque, pero ni un patrón compiló. No es un `fail` (nadie se salió de nada
    // demostrable) ni un `skip` (la tarea SÍ intentó declarar alcance): es un unknown, y el
    // detail dice dónde mirar.
    return { status: 'unknown', detail: 'el bloque de alcance no contiene ningún patrón válido', out_of_scope: [] };
  }

  /** @type {string[]} */
  const outside = [];
  for (const f of files) {
    if (typeof f !== 'string') continue;
    if (!inScope(f, compiled)) outside.push(f);
  }
  if (outside.length === 0) {
    return { status: 'pass', detail: `${files.length} fichero(s), todos dentro del alcance`, out_of_scope: [] };
  }
  const shown = outside.slice(0, MAX_REPORTED);
  const rest = outside.length - shown.length;
  return {
    status: 'fail',
    detail: `${outside.length} fichero(s) fuera del alcance declarado: ${shown.join(', ')}${rest > 0 ? ` (+${rest} más)` : ''}`,
    out_of_scope: shown,
  };
}
