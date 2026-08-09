import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
// Dos regex para cubrir las formas ESM que usa el repo:
//   1. `import X from 'Y'` / `import { X } from 'Y'` / `export ... from 'Y'` (con binding)
//   2. `import 'Y'` (side-effect import, sin binding) — hay que detectarlo porque es
//      la forma más corta de colar un logger.js al grafo del helper de formato.
//
// ── Qué CUBRE este fichero y qué no (Phase 87 / ISO-04) ─────────────────────────────────
//
// Hasta esta fase, aquí y en el JSDoc de `walkImports` había una línea que descartaba el
// punto ciego de la carga dinámica apoyándose en una afirmación sobre cuánto usa el repo
// `import()`. Esa afirmación era FALSA ya cuando se escribió: `src/providers/registry.js`
// (`:27`, `:28`, `:57`, `:58`) y `src/session/state.js:247` hacen `await import()` desde
// antes. Un fichero no puede declarar un punto ciego apoyándose en una premisa que no se
// sostiene: induce a no verificar justo donde hay que verificar. La premisa se retira; en su
// lugar va esta declaración.
//
// CUBRE:
//   - imports ESTÁTICOS: `import … from`, `import 'x'` sin binding, y re-exports
//     `export … from` (ESM los resuelve como imports, y el walker los sigue), CON O SIN
//     whitespace alrededor del keyword y del `from` — `import{x}from'./y.js'` cuenta igual
//     que `import { x } from './y.js'`. La suite ISO-05 lo ata forma por forma; hasta la
//     corrección de CR-01 esta línea afirmaba una cobertura que el sustrato no daba.
//   - `import()` dinámico con specifier LITERAL, fuera de comentarios: lo cubre el guard de
//     source-grep de la suite ISO-01 sobre la unión de las clausuras del TUI, con
//     `stripComments` aplicado ANTES del match (ver la cabecera de ese helper). Esa unión se
//     SIEMBRA con los destinos literales de `import()`, INCLUIDOS los que salen del directorio
//     del TUI y los que ellos mismos encadenan (`unionClausurasTui`, Phase 87 / WR-02). Hasta
//     esa corrección esta línea era falsa para las aristas dinámicas hacia fuera: tres
//     destinos de `src/cli/dashboard/index.js` no entraban en la unión por ninguna vía
//     estática y ningún guard llegaba a leerlos.
//
// NO CUBRE — punto ciego RESIDUAL, nombrado y NO cerrado:
//   - `import()` con specifier COMPUTADO (una variable, una concatenación, un template con
//     interpolación). Ningún regex lo resuelve sin ejecutar el módulo, y ejecutar módulos
//     dentro de un guard de test es justo lo que D-06 evita. No está mitigado ni acotado:
//     simplemente no se ve.
//
// MEDICIÓN FECHADA, NO GARANTÍA (2026-08-10, re-medida en la sesión que escribe esto, sobre
// los 99 ficheros .js de `src/`, con el `stripComments` de abajo aplicado al fuente):
//   - 129 `import()` con specifier literal, repartidos en 26 ficheros.
//   - 0 `import()` con specifier computado.
// Es una FOTO del árbol de hoy, no una promesa sobre el de mañana: el `0` de arriba dice que
// hoy no hay ninguno, NO que no pueda haberlo. La investigación de esta fase contó 128
// literales el 2026-08-05 y cinco días después son 129 — la cifra caduca, y por eso va
// fechada y por eso no se hereda de otro documento sin volver a medirla. El día que aparezca
// el primer specifier computado, este fichero no lo verá y seguirá verde.
//
// EL WHITESPACE NO ES OBLIGATORIO EN ESM (Phase 87 / CR-01 / ISO-05). Hasta esta corrección
// ambas regex exigían `\s+` («import<espacio>», «from<espacio>»), y ESM no lo requiere: cuatro
// formas perfectamente válidas eran INVISIBLES para el sustrato del que dependen TODOS los
// guards de este fichero (`import pc from"picocolors"`, `import"picocolors"`,
// `import{x}from'./b.js'`, `export{a}from'./b.js'`). Un `import{createColors}from'picocolors'`
// en cualquier hoja dejaba la lista vacía y todos los asserts VERDES sobre la invariante rota
// — el fallo que este fichero define como el peor posible. La suite ISO-05 de abajo ata las
// seis formas para que no se pueda volver a estrechar sin ponerse roja.
//
// Dos precisiones que NO son cosmética, cada una atrapando un falso positivo MEDIDO al relajar:
//   - `(?=[\s{*'"])` en vez de `\b`: con `\b` a secas, `import(` a principio de línea entra en
//     el barrido perezoso y puede capturar un `from '…'` posterior como arista FANTASMA. El
//     lookahead admite las seis formas (`import x`, `import{`, `import*`, `import'`, `import"`,
//     `export{`) y excluye `import(` e `import.meta`.
//   - `[^'"]*?` en vez de `[\s\S]*?` entre el keyword y el `from`: con `\s*` tras `from`, el
//     barrido cruzaba comillas y `src/cmux/client.js:155` (`export async function
//     createWorkspaceGroup({ name, from })`) alcanzaba el `'--from', from.join(` de `:158` y
//     producía la arista fantasma `, from.join(`. Prohibir la comilla dentro del barrido lo
//     corta de raíz, y sigue permitiendo el import multilínea (que no contiene comillas entre
//     el keyword y su `from`). Clase que no retrocede sobre sí misma, como el resto del fichero.
//
// MEDIDO al aplicar el cambio: sobre los 284 ficheros .js de `src/` + `test/`, la lista de
// specifiers extraídos es IDÉNTICA a la de las regex antiguas — cero aristas nuevas, cero
// fantasmas. El ensanchamiento es exclusivamente sobre formas que hoy el repo no escribe.
const IMPORT_FROM_RE = /^\s*(?:import|export)(?=[\s{*'"])[^'"]*?from\s*['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import(?=[\s'"])\s*['"]([^'"]+)['"]/gm;

// Regex CONSTANTE (anti-ReDoS: jamás compilada desde input). Clases `[^'"]*` que no
// retroceden sobre sí mismas; opera solo sobre fuentes del propio repo. Molde:
// test/check-isolation.test.js:31-34.
//
// El ancla es el PATRÓN DE IMPORT (`import(` + specifier LITERAL entre comillas), nunca el
// identificador suelto: hay prosa que nombra el paquete en `src/cli/dashboard/format.js:17`,
// `src/cli/dashboard/markdown.js:13` y `src/cli/dashboard/inbox-count.js:21`, y esa prosa no
// puede poner roja la suite (Phase 87 / D-11).
const DYNAMIC_PICOCOLORS_RE = /\bimport\s*\(\s*['"]([^'"]*picocolors[^'"]*)['"]\s*\)/g;

/**
 * Extrae todos los specifiers de import (con y sin binding) de un source string.
 * @param {string} src
 * @returns {string[]}
 */
function extractImports(src) {
  const out = [];
  for (const m of src.matchAll(IMPORT_FROM_RE)) out.push(m[1]);
  for (const m of src.matchAll(IMPORT_BARE_RE)) out.push(m[1]);
  return out;
}

// stripComments — DIVERGE A PROPÓSITO del helper de `test/check-isolation.test.js:23-29`
// y de su origen `test/dispatcher-isolation.test.js:24-30`. Aquéllos borran los bloques
// `/* … */` ANTES de filtrar las líneas `//`, así que un comentario DE LÍNEA que contenga
// la secuencia de apertura de bloque (p. ej. la glob `src/cli/dashboard/**`) abre un bloque
// FALSO que se traga el fichero hasta el siguiente cierre.
//
// Medido sobre los 98 ficheros de `src/` (2026-08-05): con el orden verbatim, TRES ficheros
// pierden el 100 % de sus imports estáticos — `src/cli/dashboard/enrich.js` (3→0),
// `src/cli/dashboard/markdown.js` (4→0) y `src/logs/session-lookup.js` (5→0). Los
// disparadores son `markdown.js:14` («imports de src/cli/dashboard/**.»), `enrich.js:26`
// (misma glob) y `session-lookup.js:14` («~/.kodo/logs/*.ndjson»).
//
// Lo que de verdad importa: `markdown.js` es a la vez uno de los tres cegados Y un leaker
// primario de esta fase. Con un `await import('picocolors')` inyectado ahí, el helper
// verbatim da 0 hits (guard CIEGO) y éste da 1 (ROJO). Un guard construido sobre el verbatim
// saldría verde justo sobre el leak que esta fase existe para cerrar. NO «arregles» esta
// divergencia alineándola con los ficheros hermanos: eso devuelve el bug.
//
// Orden correcto: líneas `//` primero → bloques `/* */` después → líneas `*` al final.
// Recupera el 100 % de los imports en los tres, y no cambia nada en los otros 95.
/**
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('*'))
    .join('\n');
}

/**
 * Walker transitivo de imports relativos (`./x.js`, `../y.js`).
 * Ignora specifiers bare (`node:fs`, `commander`, `picocolors`) — fuera del grafo del proyecto.
 * NO sigue `import()` dinámico, y es A PROPÓSITO (D-06, precedente locked de la Phase 85 /
 * WR-03): seguir aristas dinámicas aquí ensancharía la clausura y pondría rojos guards
 * vecinos por motivos espurios — y la reacción natural a un rojo espurio es debilitarlos. El
 * punto ciego lo cubre el source-grep sobre esta MISMA clausura (suite ISO-01); el residual
 * —specifier computado— queda declarado en la cabecera de este fichero, sin cerrar.
 * También sigue `export ... from 'X'` (re-exports) porque ESM los resuelve como imports.
 *
 * @param {string} entry absolute path al archivo source
 * @param {Set<string>} [visited]
 * @returns {Set<string>} todos los archivos alcanzables transitivamente
 */
function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  if (!existsSync(entry)) return visited; // imports a archivos inexistentes no crashean el walker
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const spec of extractImports(src)) {
    if (!spec.startsWith('.')) continue;
    // Resolver con extensión explícita (ESM puro requiere .js en el specifier)
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}

/**
 * Recursively list all .js files under a directory.
 * @param {string} dir
 * @returns {string[]} absolute paths
 */
function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFiles(full));
    } else if (st.isFile() && full.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Predicado de import DIRECTO: ¿este fichero importa el paquete de color?
 * @param {string} file absolute path
 * @returns {boolean}
 */
function importsPicocolors(file) {
  return extractImports(readFileSync(file, 'utf-8')).includes('picocolors');
}

/**
 * Reconstruye la cadena MÁS CORTA de imports desde `entry` hasta el primer fichero que
 * importa `picocolors`. BFS con mapa de padres — deliberadamente ADITIVO y SEPARADO de
 * `walkImports`, que devuelve un `Set` sin información de padres y NO se reescribe (D-05).
 *
 * Solo se invoca en el camino de FALLO, para construir el mensaje: la suite verde no lo paga.
 * BFS y no DFS porque la cadena más corta es la que nombra la arista que hay que cortar.
 *
 * @param {string} entry absolute path
 * @returns {string[]|null} paths relativos al repo, de `entry` al importador de picocolors
 */
function findChainToPicocolors(entry) {
  /** @type {Map<string, string>} */
  const parent = new Map();
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = /** @type {string} */ (queue.shift());
    if (importsPicocolors(cur)) {
      const chain = [];
      for (let n = cur; n !== undefined; n = parent.get(n)) chain.unshift(relative(REPO, n));
      return chain;
    }
    for (const spec of extractImports(readFileSync(cur, 'utf-8'))) {
      if (!spec.startsWith('.')) continue;
      const resolved = resolve(dirname(cur), spec);
      if (!existsSync(resolved) || seen.has(resolved)) continue;
      seen.add(resolved);
      parent.set(resolved, cur);
      queue.push(resolved);
    }
  }
  return null;
}

describe('LOG-12 extension: src/cli/format.js isolation (D-06)', () => {
  it('src/cli/format.js exists (sanity: test is meaningful only when the subject is real)', () => {
    assert.equal(
      existsSync(join(SRC, 'cli', 'format.js')),
      true,
      'src/cli/format.js must exist after Plan 14-01 — otherwise this isolation test passes trivially',
    );
  });

  it('src/cli/format.js does not import src/logger.js transitively (LOG-12 extension)', () => {
    const graph = walkImports(join(SRC, 'cli', 'format.js'));
    // Distinguir logger.js (prohibido) de logger-noop.js (permitido).
    // El regex /\/logger\.js$/ matchea el primero y no el segundo.
    const violators = [...graph].filter((p) => /\/logger\.js$/.test(p));
    const relViolators = violators.map((p) => relative(REPO, p));
    const relGraph = [...graph].map((p) => relative(REPO, p));
    assert.deepEqual(
      violators,
      [],
      `format.js transitively imports src/logger.js via:\n  ${relViolators.join('\n  ')}\n` +
        `Full graph from format.js:\n  ${relGraph.join('\n  ')}`,
    );
  });
});

describe('Single source of color (D-07, D-08): picocolors imports', () => {
  it('only src/cli/format.js imports picocolors (single source of color)', () => {
    const allFiles = listJsFiles(SRC);
    const importers = [];
    for (const file of allFiles) {
      const src = readFileSync(file, 'utf-8');
      const specs = extractImports(src);
      if (specs.includes('picocolors')) {
        importers.push(relative(REPO, file));
      }
    }
    assert.deepEqual(
      importers,
      ['src/cli/format.js'],
      `picocolors must be imported from EXACTLY ONE file (src/cli/format.js — D-07).\n` +
        `Found importers: ${importers.length === 0 ? '(none — has format.js been refactored to remove the import?)' : importers.join(', ')}`,
    );
  });

  it('picocolors is imported by at least one file under src/ (Plan 14-01 sanity)', () => {
    const allFiles = listJsFiles(SRC);
    let found = false;
    for (const file of allFiles) {
      const specs = extractImports(readFileSync(file, 'utf-8'));
      if (specs.includes('picocolors')) {
        found = true;
        break;
      }
    }
    assert.equal(found, true, 'No file under src/ imports picocolors — Plan 14-01 contract broken');
  });
});

describe('Phase 15 cableado: callsites importan format.js (positive) + no picocolors leak (negative)', () => {
  /** @type {readonly string[]} */
  const PHASE_15_CALLSITES = Object.freeze([
    'src/logger.js',
    'src/logs/reader.js',
    'src/check.js',
    'src/cli/gsd-inspect.js',
    'src/cli/gsd-verify.js',
    'src/cli/adopt.js',
  ]);

  it('Phase 15 callsites import src/cli/format.js (cableado verificado tras Plans 15-01..15-04)', () => {
    const missingImports = [];
    for (const rel of PHASE_15_CALLSITES) {
      const full = join(REPO, rel);
      const specs = extractImports(readFileSync(full, 'utf-8'));
      // Match relative imports a format.js — paths varían según ubicación del archivo:
      //   - desde src/logger.js → './cli/format.js'
      //   - desde src/logs/reader.js → '../cli/format.js'
      //   - desde src/check.js → './cli/format.js'
      //   - desde src/cli/gsd-inspect.js → './format.js'
      //   - desde src/cli/gsd-verify.js → './format.js'
      const hasFormatImport = specs.some((s) => /(\.\.?\/)+(cli\/)?format\.js$/.test(s));
      if (!hasFormatImport) {
        missingImports.push(rel);
      }
    }
    assert.deepEqual(
      missingImports,
      [],
      `Phase 15 callsites missing the format.js import:\n  ${missingImports.join('\n  ')}\n` +
        `Each callsite must import { createFormatter } and/or { _resolveUseColor } from src/cli/format.js.`,
    );
  });

  it('Phase 15 callsites do NOT import picocolors directly (D-07 single-source preserved)', () => {
    const leakers = [];
    for (const rel of PHASE_15_CALLSITES) {
      const full = join(REPO, rel);
      const specs = extractImports(readFileSync(full, 'utf-8'));
      if (specs.includes('picocolors')) {
        leakers.push(rel);
      }
    }
    assert.deepEqual(
      leakers,
      [],
      `picocolors must be imported only via src/cli/format.js (D-07 single-source).\n` +
        `Leakers detected:\n  ${leakers.join('\n  ')}`,
    );
  });
});

describe('DEBT-04 source-hygiene: ANSI exports retired (Phase 15 IN-01 closed via Phase 22)', () => {
  it('src/logger.js no exporta ANSI_RESET ni COLOR_BY_LEVEL', () => {
    const src = readFileSync(join(SRC, 'logger.js'), 'utf-8');
    assert.equal(
      /export\s+const\s+ANSI_/m.test(src),
      false,
      'ANSI_* must not be exported from logger.js after Phase 22 (DEBT-04)',
    );
    assert.equal(
      /export\s+const\s+COLOR_BY_LEVEL/m.test(src),
      false,
      'COLOR_BY_LEVEL must not be exported from logger.js after Phase 22 (DEBT-04)',
    );
  });
});

describe('TUI-04 (D-13): cero picocolors bajo src/cli/dashboard/', () => {
  // Invariante D-12: todo el color del TUI sale de ink <Text color>, CERO
  // picocolors bajo src/cli/dashboard/**. Reutiliza los helpers existentes
  // (listJsFiles / extractImports / REPO / SRC) — no redefine nada.
  //
  // En Wave 1 src/cli/dashboard/ aún no existe → listJsFiles no lo encuentra
  // → la lista filtrada es vacía → este test pasa trivialmente. Gana mordida
  // cuando Plan 02 cree los archivos del TUI: si alguno importase picocolors
  // (directo), este test se pondría rojo.
  it('ningún archivo de src/cli/dashboard/ importa picocolors', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    const leakers = dashFiles
      .filter((f) => extractImports(readFileSync(f, 'utf-8')).includes('picocolors'))
      .map((f) => relative(REPO, f));
    assert.deepEqual(
      leakers,
      [],
      `Color del TUI debe salir de ink <Text>, no de picocolors (D-12).\n` +
        `Archivos bajo src/cli/dashboard/ que importan picocolors:\n  ${leakers.join('\n  ')}`,
    );
  });
});

// ISO-01 (Phase 87): el guard TUI-04 de arriba mira imports DIRECTOS. Salía VERDE mientras
// TRES ficheros del TUI alcanzaban `picocolors` por vía TRANSITIVA — el walker que lo detecta
// lleva 150 líneas más arriba en este mismo fichero, sin usar. Una invariante que no se puede
// medir no es una invariante.
//
// Se conserva el directo (D-08): es aditivo y su mensaje es más legible cuando el leak es de
// primer nivel. Éste es el que muerde de verdad.
//
// El ancla es el PAQUETE `picocolors`, no `src/cli/format.js` (D-07). Hoy son equivalentes
// —la suite de single-source de arriba asevera que format.js es su único importador— pero un
// segundo importador futuro escaparía a un ancla al fichero.
/**
 * Anti-vacuidad de ISO-01 (Phase 87 / WR-01). Los dos casos de ISO-01 derivan su universo de
 * un `filter` sobre el árbol: si `src/cli/dashboard/` se renombra, se mueve o desaparece, la
 * lista queda `[]`, `chains`/`violations` quedan `[]` y AMBOS `deepEqual(…, [])` pasan sobre
 * cero ficheros. Las tres suites hermanas (ISO-02 `existsSync`, ISO-03 `existsSync`, ISO-04
 * `existsSync`) ya se blindan contra esto con el mismo argumento; ISO-01 era la única que no,
 * y es la que más muerde. Se asevera la lista y no `existsSync` del directorio porque lo que
 * ISO-01 recorre es la lista, no el directorio.
 *
 * @param {string[]} dashFiles
 * @returns {void}
 */
function assertTuiNoVacio(dashFiles) {
  assert.ok(
    dashFiles.length > 0,
    'src/cli/dashboard/ no contiene ficheros .js — el guard ISO-01 estaría pasando en VACÍO ' +
      '(¿se ha renombrado o movido el directorio del TUI?). Un guard que recorre cero ficheros ' +
      'es verde y vacío: apunta el filtro al directorio nuevo en vez de dejarlo pasar.',
  );
}

// Regex CONSTANTE (mismo criterio anti-ReDoS que DYNAMIC_PICOCOLORS_RE). Captura el specifier
// LITERAL y RELATIVO de un `import()` dinámico: los bare (`import('picocolors')`) no son
// aristas del grafo de ficheros del proyecto y ya los cubre DYNAMIC_PICOCOLORS_RE.
const DYNAMIC_REL_SPEC_RE = /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g;

/**
 * Unión de las clausuras del TUI, SEMBRADA con los destinos literales de `import()` (Phase 87
 * / WR-02).
 *
 * El agujero que cierra: hasta esta corrección la unión se construía solo con `walkImports`
 * (estático), y la cabecera declaraba que el `import()` con specifier LITERAL «lo cubre el
 * guard de source-grep sobre la unión de las clausuras del TUI». Eso era cierto únicamente
 * para las aristas dinámicas INTRA-directorio: `src/cli/dashboard/index.js` tiene cuatro
 * aristas dinámicas literales hacia FUERA, y tres de sus destinos (`src/host/interface.js`,
 * `src/providers/registry.js`, `src/providers/plane/client.js`) no entraban en la unión por
 * ninguna vía estática, así que NINGÚN guard del fichero llegaba a leerlos. `registry.js`
 * encadena además sus propios `await import()`, y todo ese subárbol era invisible.
 *
 * La justificación D-05 («CADA fichero es entry point, por eso no hace falta seguir aristas
 * dinámicas») solo se sostiene para aristas INTRA-directorio: un destino de fuera no es entry
 * de nadie. Se corrige sembrando, no relajando.
 *
 * D-06 SIGUE INTACTO: `walkImports` no se toca y sigue sin seguir aristas dinámicas. La
 * siembra vive AQUÍ, en el guard, que es donde el precedente locked (Phase 85 D-09) la pone.
 * El punto fijo es necesario porque los destinos encadenan sus propias aristas dinámicas.
 *
 * MEDIDO (2026-08-10): 16 ficheros de TUI → 32 ficheros por clausura estática → 42 con la
 * siembra, siguiendo 5 aristas dinámicas literales (`index.js` → `host/interface.js`,
 * `providers/registry.js`, `providers/plane/client.js`; `registry.js` → `plane/provider.js`,
 * `github/provider.js`). Los 10 ficheros nuevos NO alcanzan `picocolors` por ninguna vía: el
 * guard se ensancha en VERDE, no se estrecha la invariante para que pase.
 *
 * @param {string[]} dashFiles entry points del TUI
 * @returns {Set<string>} unión de clausuras, con las aristas dinámicas literales seguidas
 */
function unionClausurasTui(dashFiles) {
  const graph = new Set();
  for (const file of dashFiles) walkImports(file, graph);
  let creció = true;
  while (creció) {
    creció = false;
    for (const file of [...graph]) {
      // `stripComments` ANTES del match, igual que en el source-grep: un `@type {import('…')}`
      // es un import de TIPO borrado en runtime, no una arista (D-11).
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const m of stripped.matchAll(DYNAMIC_REL_SPEC_RE)) {
        const destino = resolve(dirname(file), m[1]);
        if (graph.has(destino) || !existsSync(destino)) continue;
        walkImports(destino, graph);
        creció = true;
      }
    }
  }
  return graph;
}

describe('ISO-01 (Phase 87): cero picocolors TRANSITIVO bajo src/cli/dashboard/', () => {
  it('ningún fichero del TUI alcanza picocolors por ninguna cadena de imports estáticos', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    assertTuiNoVacio(dashFiles);
    const chains = [];
    for (const file of dashFiles) {
      // D-05: CADA fichero es entry point. Iterarlos todos es lo que hace innecesario seguir
      // aristas dinámicas dentro del walker MIENTRAS EL DESTINO CAIGA DENTRO del directorio:
      // `index.js` carga `./App.js` con `import()`, pero `App.js` también es entry y saldría
      // rojo por sí mismo. Para los destinos de FUERA el argumento no se sostiene —no son
      // entry de nadie— y por eso el caso dinámico de abajo siembra la unión con ellos
      // (WR-02). Este caso sigue siendo estrictamente estático a propósito: es el que
      // reconstruye la CADENA, y `findChainToPicocolors` solo sabe nombrar aristas estáticas.
      if (![...walkImports(file)].some(importsPicocolors)) continue;
      const chain = findChainToPicocolors(file);
      chains.push(chain ? chain.join('\n     → ') : relative(REPO, file));
    }
    assert.deepEqual(
      chains,
      [],
      `Color del TUI debe salir de ink <Text>, no de picocolors (D-12) — ni por vía TRANSITIVA.\n` +
        `Cadenas de import que alcanzan picocolors:\n  - ${chains.join('\n  - ')}\n` +
        `Corta la PRIMERA arista de cada cadena: el saneador de texto vive en src/cli/sanitize.js ` +
        `(hoja sin color), no en src/cli/format.js.`,
    );
  });

  // D-06 (precedente locked: Phase 85 D-09 / WR-03, test/check-isolation.test.js:192-228):
  // `walkImports` sigue siendo ESTÁTICO y las aristas dinámicas se cubren con un source-grep
  // sobre la lista que el walker devuelve, SEMBRADA con los destinos literales de `import()`
  // (ver `unionClausurasTui`, WR-02). Seguir aristas dinámicas DENTRO del walker ensancharía
  // la clausura de TODOS sus llamantes y pondría rojos guards vecinos por motivos espurios —
  // y la reacción natural a un rojo espurio es debilitarlos. Por eso la siembra vive aquí.
  //
  // `stripComments` es obligatorio y va ANTES del match: sin él se cuelan aristas fantasma de
  // `@type {import('…')}`, que son imports de TIPO borrados en runtime, no aristas. Medido
  // sobre `src/` (2026-08-05): 139 coincidencias → 128 al descartar las de una sola línea de
  // bloque de documentación; 11 fantasmas, 9 con specifier relativo (entre ellos
  // `src/cli/polling.js:417 → '../logger.js'`, que apunta justo al módulo que el guard
  // hermano prohíbe).
  //
  // SIN allowlist: aquí no hay equivalente legítimo de `logger-noop.js` (D-16).
  it('ningún fichero del grafo del TUI hace import() DINÁMICO de picocolors (ISO-01/ISO-04)', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    assertTuiNoVacio(dashFiles);
    const graph = unionClausurasTui(dashFiles); // clausuras + aristas dinámicas literales
    const violations = [];
    for (const file of graph) {
      // Dos mecanismos, ambos exigidos por D-11. Medido el 2026-08-05: dan EXACTAMENTE el
      // mismo resultado (128 coincidencias), así que quien hace el trabajo es `stripComments`;
      // el filtro de línea se implementa para satisfacer D-11 literalmente y porque cuesta una
      // línea. `stripComments` es ESTRICTAMENTE MÁS FUERTE: también neutraliza un bloque
      // `/* … */` multilínea cuyas líneas interiores no empiecen por `//`, `*` ni `/*`, que el
      // filtro de línea dejaría pasar como arista real. No concluyas que el filtro de línea
      // basta por sí solo y elimines el saneo de comentarios. La intención de D-11 —que los
      // imports de TIPO no cuentan como aristas— la satisfacen ambos.
      const stripped = stripComments(readFileSync(file, 'utf-8'))
        .split('\n')
        .filter((line) => {
          const t = line.trim();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');
      for (const m of stripped.matchAll(DYNAMIC_PICOCOLORS_RE)) {
        violations.push(`${relative(REPO, file)} → import('${m[1]}')`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `un fichero del grafo del TUI carga picocolors por import() dinámico (la invariante de ` +
        `color-isolation se rompería con el guard estático en VERDE) vía:\n  ${violations.join('\n  ')}`,
    );

    // Simetría (WR-02): ahora que la siembra mete en la unión los destinos de las aristas
    // dinámicas que SALEN del directorio del TUI, sería incoherente leer esos ficheros y
    // buscar solo la forma dinámica. Un `import pc from 'picocolors'` en
    // `src/providers/registry.js` mete color en el grafo del TUI exactamente igual que un
    // `import('picocolors')`, y el caso estático de arriba no lo ve porque su walker no cruza
    // la arista dinámica que lleva hasta ahí.
    const estaticos = [...graph].filter(importsPicocolors).map((p) => relative(REPO, p));
    assert.deepEqual(
      estaticos,
      [],
      `un fichero alcanzable desde el TUI (siguiendo también las aristas dinámicas LITERALES) ` +
        `importa picocolors de forma estática:\n  ${estaticos.join('\n  ')}\n` +
        `Es el mismo leak que ISO-01 cierra, escondido detrás de un import() — el caso ` +
        `estático no lo ve porque su walker no cruza aristas dinámicas (D-06).`,
    );
  });
});

// ISO-02 (Phase 87): `src/cli/sanitize.js` es el módulo dueño de los saneadores PUROS de
// texto no confiable (`stripControlChars`, `stripForKeystroke`) y debe seguir siendo una HOJA
// de cero imports — el mismo contrato que `src/session/handoff.js`, `src/tasks/pending.js` y
// `src/logger-noop.js`.
//
// Por qué existe este guard y no basta con la disciplina: estas dos funciones vivían en
// `src/cli/format.js`, el ÚNICO importador de `picocolors`. Eso hacía que dos ficheros del TUI
// que solo querían sanear texto arrastrasen el paquete de color al grafo, rompiendo la
// invariante color-isolation con el guard directo en VERDE. Si este módulo deja de ser hoja
// —p. ej. importando el formateador «porque le viene bien»— reabre por la puerta de atrás
// exactamente la arista que la Phase 87 cerró.
describe('ISO-02 (Phase 87): src/cli/sanitize.js es una HOJA de cero imports', () => {
  it('src/cli/sanitize.js existe y tiene cero imports (incluidos builtins)', () => {
    const sanitizePath = join(SRC, 'cli', 'sanitize.js');
    assert.equal(
      existsSync(sanitizePath),
      true,
      'src/cli/sanitize.js must exist after Plan 87-01 — otherwise this isolation test passes trivially',
    );
    const imports = extractImports(readFileSync(sanitizePath, 'utf-8'));
    assert.deepEqual(
      imports,
      [],
      `sanitize.js debe tener CERO imports (incluidos los builtins node:*) para que sus ` +
        `consumidores —App.js y markdown.js del TUI, la captura CLI, el hook de Stop, la ` +
        `escritura del inbox y el manager de sesiones— saneen texto sin arrastrar grafo ni ` +
        `color (ISO-02). Sin allowlist. found: ${imports.join(', ')}`,
    );
  });
});

// ISO-03 (Phase 87 / UF-02): `src/cli/dashboard/format.js` es la capa de presentación PURA
// del dashboard (React-free, ink-free), y su pureza es la PREMISA sobre la que descansa que
// `select.js` pueda importarlo sin arrastrar la capa de color. DEBT-06 cableó ese import en
// la Phase 85; el comentario de `select.js:30-34` afirma literalmente que `./format.js` es
// puro y no arrastra color — y hasta esta fase NINGÚN test lo aseveraba. Una premisa que
// nadie mide es disciplina, no invariante.
//
// Molde de redacción: los guards de hoja de `src/session/handoff.js`
// (test/check-isolation.test.js:241-258) y `src/tasks/pending.js` (:269-285).
//
// DIVERGENCIA ÚNICA respecto de ese molde, documentada CON SU MEDICIÓN: aquéllos exigen cero
// imports INCLUIDOS los builtins; éste admite una allowlist de UN elemento, `node:path`,
// porque `src/cli/dashboard/format.js:25` importa `basename` para derivar el repo. Razón
// medida, no preferencia: `node:path` es un builtin sin efectos de módulo y no arrastra nada
// — la clausura transitiva del sujeto es exactamente él mismo, y el tercer assert de abajo lo
// comprueba en vez de suponerlo (redundante por construcción con el primero, y así lo dice su
// comentario: WR-03). D-16: ésta es la ÚNICA allowlist admitida en toda la fase; ninguna otra
// excepción entra «para que pase».
describe('ISO-03 (Phase 87 / UF-02): src/cli/dashboard/format.js es una HOJA pura', () => {
  // Congelada LITERALMENTE, jamás derivada del fichero sujeto: una allowlist calculada a
  // partir de lo que el sujeto importa no asevera nada — siempre saldría verde.
  /** @type {readonly string[]} */
  const ALLOWED_BUILTINS = Object.freeze(['node:path']);

  it('cero imports relativos; builtins solo los de la allowlist; clausura = él mismo, sin color', () => {
    const formatPath = join(SRC, 'cli', 'dashboard', 'format.js');
    assert.equal(
      existsSync(formatPath),
      true,
      'src/cli/dashboard/format.js must exist — otherwise this isolation test passes trivially',
    );
    const imports = extractImports(readFileSync(formatPath, 'utf-8'));
    const relatives = imports.filter((s) => s.startsWith('.'));
    assert.deepEqual(
      relatives,
      [],
      `dashboard/format.js debe ser una HOJA: cero imports RELATIVOS, para que select.js lo ` +
        `importe sin arrastrar grafo ni color (ISO-03 / UF-02). found: ${relatives.join(', ')}`,
    );
    const outsiders = imports.filter((s) => !ALLOWED_BUILTINS.includes(s));
    assert.deepEqual(
      outsiders,
      [],
      `dashboard/format.js solo puede importar builtins de la allowlist ` +
        `[${ALLOWED_BUILTINS.join(', ')}] (D-13, la única de la fase). ` +
        `Fuera de la allowlist: ${outsiders.join(', ')}. Imports del fichero: ${imports.join(', ')}`,
    );
    // NO es «el assert que muerde» (Phase 87 / WR-03). Hasta esta corrección aquí había un
    // `closure.size === 1` con un comentario que lo vendía como el fuerte —de ALCANZABILIDAD,
    // superviviente a una sintaxis de import que las regex no vieran— y era FALSO en los dos
    // sentidos: `walkImports` calcula la clausura llamando a `extractImports`, la MISMA llamada
    // de la que sale `relatives` cinco líneas arriba, así que si `relatives` es `[]` la
    // clausura es necesariamente `{formatPath}` y `size === 1` no puede fallar por su cuenta.
    // La jerarquía estaba invertida: los TRES asserts de este caso son de FORMA sobre el mismo
    // fuente, y quien los protege de una sintaxis invisible es la suite ISO-05, no éste.
    //
    // Se conserva —reforzado de `size` a CONTENIDO— porque documenta de forma medible lo que
    // la allowlist afirma: que `node:path` no aporta grafo. Es redundancia DECLARADA, no un
    // assert que finge independencia.
    const closure = walkImports(formatPath);
    assert.deepEqual(
      [...closure].map((p) => relative(REPO, p)),
      ['src/cli/dashboard/format.js'],
      `la CLAUSURA transitiva de dashboard/format.js debe ser exactamente él mismo: es lo que ` +
        `hace que node:path no cuente como grafo. Clausura medida (${closure.size}):\n  ` +
        `${[...closure].map((p) => relative(REPO, p)).join('\n  ')}`,
    );
    const conColor = [...closure].filter(importsPicocolors).map((p) => relative(REPO, p));
    assert.deepEqual(
      conColor,
      [],
      `ningún miembro de la clausura de dashboard/format.js puede importar picocolors — es la ` +
        `premisa literal que select.js:30-34 da por buena. Miembros con color:\n  ` +
        `${conColor.join('\n  ')}`,
    );
  });

  // D-14 — CONVERGENCIA (espejo literal de ORCH-05, test/check-isolation.test.js:287-300).
  // Los asserts de prohibición de arriba prueban que `format.js` no arrastra nada; éste
  // prueba que alguien lo consume de verdad. Sin él, la premisa que ISO-03 protege se puede
  // regresar EN SILENCIO moviendo `nextCell` a otro sitio: el guard de pureza seguiría verde
  // sobre un módulo huérfano. Un guard de prohibición sobre un módulo que no usa nadie es
  // verde y vacío.
  it('select.js consume ./format.js (convergencia, D-14)', () => {
    const graph = walkImports(join(SRC, 'cli', 'dashboard', 'select.js'));
    const formatPath = join(SRC, 'cli', 'dashboard', 'format.js');
    assert.ok(
      graph.has(formatPath),
      `select.js debe importar transitivamente ./format.js (DEBT-06 / D-04 de la Phase 85: ` +
        `deriveAnyNext delega en nextCell). Sin este consumidor, ISO-03 congela un módulo que ` +
        `no usa nadie.\nGrafo desde select.js:\n  ` +
        `${[...graph].map((p) => relative(REPO, p)).join('\n  ')}`,
    );
  });
});

// ISO-04 (Phase 87): el guard del GUARD. `stripComments` de este fichero diverge a propósito
// del helper de `test/check-isolation.test.js:23-29` (líneas `//` primero, bloques después),
// y esa divergencia parece un descuido cuando se lee al lado del hermano — la tentación de
// «arreglarla» alineándola con el molde es exactamente lo que devuelve el bug.
//
// El sujeto del caso no es arbitrario: `src/cli/dashboard/markdown.js` es a la vez uno de los
// TRES ficheros que el orden verbatim ciega al 100 % (su `:14` contiene la glob
// `src/cli/dashboard/**`, que abre un bloque de comentario falso que se traga el fichero) Y
// un leaker primario de esta fase. Con el orden del molde, `stripComments` devuelve un fuente
// sin ninguno de sus imports y el guard dinámico da 0 hits sobre él: verde y ciego, justo
// sobre el leak que la Phase 87 existe para cerrar.
//
// Por eso el caso ata el helper al sujeto concreto: si alguien revierte el orden, este número
// cae a 0 y la suite lo DICE, en vez de quedarse verde.
describe('ISO-04 (Phase 87): stripComments no ciega al guard', () => {
  /**
   * El orden del molde hermano (`test/check-isolation.test.js:23-29`): borra los bloques
   * PRIMERO y filtra las líneas de comentario después. Es el orden que abre un bloque falso
   * desde un comentario DE LÍNEA que contenga la secuencia de apertura de bloque. Se
   * implementa aquí, dentro del caso, para comparar los dos órdenes sobre el mismo fuente en
   * vez de congelar una constante.
   *
   * @param {string} src
   * @returns {string}
   */
  function stripCommentsVerbatim(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
  }

  it('stripComments recupera los imports de markdown.js que el orden hermano ciega', () => {
    const markdownPath = join(SRC, 'cli', 'dashboard', 'markdown.js');
    assert.equal(
      existsSync(markdownPath),
      true,
      'src/cli/dashboard/markdown.js must exist — otherwise this meta-test passes trivially',
    );
    const src = readFileSync(markdownPath, 'utf-8');

    // PRECONDICIÓN, aseverada y no supuesta (Phase 87 / WR-04). El disparador de toda la
    // divergencia es que `markdown.js` conserve la glob `src/cli/dashboard/**` DENTRO de un
    // comentario de LÍNEA: eso es lo que abre el bloque falso con el orden hermano. Si alguien
    // reescribe ese comentario (p. ej. a `src/cli/dashboard/`), los dos órdenes pasan a dar el
    // MISMO resultado y este meta-test se vuelve verde-y-vacío en silencio — el guard del
    // guard dejaría de guardar sin decirlo, que es justo la vacuidad que ISO-01/ISO-03
    // persiguen.
    assert.ok(
      src.includes('src/cli/dashboard/**'),
      'markdown.js debe conservar la glob `src/cli/dashboard/**` en un comentario de LÍNEA: es ' +
        'el disparador que hace MEDIBLE la divergencia de orden de stripComments. Sin ella, ' +
        'este meta-test pasa con AMBOS órdenes y deja de guardar nada. Si el comentario ha ' +
        'cambiado, busca otro fichero disparador (enrich.js, session-lookup.js) y reapunta el ' +
        'caso — no borres el assert.',
    );

    // Comparación relativa, no una constante congelada: el contrato de ISO-04 es «este orden
    // recupera lo que el otro ciega», no «markdown.js tiene exactamente N imports». Con
    // `assert.equal(imports.length, 4)` un quinto import legítimo en markdown.js ponía rojo un
    // meta-test sobre `stripComments`, con el mensaje apuntando al helper equivocado.
    const conEsteOrden = extractImports(stripComments(src));
    const conOrdenHermano = extractImports(stripCommentsVerbatim(src));
    assert.deepEqual(
      conOrdenHermano,
      [],
      `el orden del molde hermano debería CEGAR markdown.js al 100 % (es la premisa de ` +
        `D-09/D-10). Si recupera algo, el disparador del bloque falso ha cambiado y esta ` +
        `comparación ya no mide la divergencia. Recuperados: ${conOrdenHermano.join(', ')}`,
    );
    assert.ok(
      conEsteOrden.length > 0,
      `stripComments debe conservar los imports estáticos de markdown.js. Si esta lista queda ` +
        `VACÍA, el orden del helper se ha revertido al del molde hermano y el guard dinámico ` +
        `está CIEGO sobre este fichero (D-09/D-10) — verde justo sobre el leak que la Phase 87 ` +
        `existe para cerrar. Recuperados (${conEsteOrden.length}): ${conEsteOrden.join(', ')}`,
    );
  });
});

// ISO-05 (Phase 87 / CR-01): el guard del SUSTRATO. `extractImports` es la base de la que
// dependen TODOS los guards de este fichero — ISO-01 (estático y dinámico), ISO-02, ISO-03 y
// el single-source de D-07 llaman al mismo helper. Un agujero aquí no rompe un caso: los
// vuelve a todos verdes-y-ciegos a la vez.
//
// El agujero real que este caso cierra: ambas regex exigían whitespace obligatorio, así que
// `import{createColors}from'picocolors'` en `src/cli/sanitize.js` dejaba `imports` vacío y
// `assert.deepEqual(imports, [])` de ISO-02 PASABA sobre la única regresión que ese guard
// existe para ver. Molde de redacción: ISO-04, el guard del helper `stripComments`.
describe('ISO-05 (Phase 87): extractImports ve las formas ESM sin whitespace', () => {
  it('las seis formas de import/export estático, compactas y espaciadas', () => {
    /** @type {ReadonlyArray<readonly [string, string[]]>} */
    const FORMAS = Object.freeze([
      ['import pc from"picocolors";', ['picocolors']],
      ["import pc from 'picocolors';", ['picocolors']],
      ['import"picocolors";', ['picocolors']],
      ["import{x}from'./b.js';", ['./b.js']],
      ["export{a}from'./b.js';", ['./b.js']],
      ["export*from'./c.js';", ['./c.js']],
      ["import a,{b}from'./d.js';", ['./d.js']],
      ["import {\n  a,\n  b,\n} from './multi.js';", ['./multi.js']],
    ]);
    for (const [src, esperado] of FORMAS) {
      assert.deepEqual(
        extractImports(src),
        esperado,
        `extractImports es CIEGO a ${JSON.stringify(src)}. Con este agujero, TODOS los guards ` +
          `de este fichero (ISO-01/02/03 y D-07) se pueden burlar escribiendo el import en esa ` +
          `forma: se quedan VERDES con la invariante rota. No estreches las regex sin ` +
          `re-medir aquí.`,
      );
    }
  });

  it('no confunde identificadores ni `import(` con imports estáticos', () => {
    /** @type {readonly string[]} */
    const NO_SON_IMPORTS = Object.freeze([
      'exportFoo from "nope";',
      "importar from 'nope';",
      // `export async function f({ name, from }) { … args.push('--from', from.join(',')) }`
      // es el patrón REAL de `src/cmux/client.js:155-158`: relajar el whitespace tras `from`
      // sin prohibir la comilla dentro del barrido lo convertía en la arista fantasma
      // `, from.join(`.
      "export async function f({ name, from }) {\n  args.push('--from', from.join(','));\n}",
    ]);
    for (const src of NO_SON_IMPORTS) {
      assert.deepEqual(
        extractImports(src),
        [],
        `extractImports inventa una arista FANTASMA sobre ${JSON.stringify(src)}. Un falso ` +
          `positivo pone rojos guards vecinos por motivos espurios, y la reacción natural a un ` +
          `rojo espurio es debilitarlos (D-06).`,
      );
    }
  });
});
