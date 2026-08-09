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
//     `export … from` (ESM los resuelve como imports, y el walker los sigue).
//   - `import()` dinámico con specifier LITERAL, fuera de comentarios: lo cubre el guard de
//     source-grep de la suite ISO-01 sobre la unión de las clausuras del TUI, con
//     `stripComments` aplicado ANTES del match (ver la cabecera de ese helper).
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
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

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
describe('ISO-01 (Phase 87): cero picocolors TRANSITIVO bajo src/cli/dashboard/', () => {
  it('ningún fichero del TUI alcanza picocolors por ninguna cadena de imports estáticos', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    const chains = [];
    for (const file of dashFiles) {
      // D-05: CADA fichero es entry point. Iterarlos todos es lo que hace innecesario
      // seguir aristas dinámicas dentro del walker: `index.js` carga `./App.js` con
      // `import()`, pero `App.js` también es entry y saldría rojo por sí mismo.
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
  // sobre la MISMA lista que el walker devuelve. Seguir aristas dinámicas DENTRO del walker
  // ensancharía la clausura y pondría rojos guards vecinos por motivos espurios — y la
  // reacción natural a un rojo espurio es debilitarlos.
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
    const graph = new Set();
    for (const file of dashFiles) walkImports(file, graph); // unión de las clausuras
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
// — la clausura transitiva del sujeto es exactamente 1 (él mismo), y el tercer assert de
// abajo lo comprueba en vez de suponerlo. D-16: ésta es la ÚNICA allowlist admitida en toda
// la fase; ninguna otra excepción entra «para que pase».
describe('ISO-03 (Phase 87 / UF-02): src/cli/dashboard/format.js es una HOJA pura', () => {
  // Congelada LITERALMENTE, jamás derivada del fichero sujeto: una allowlist calculada a
  // partir de lo que el sujeto importa no asevera nada — siempre saldría verde.
  /** @type {readonly string[]} */
  const ALLOWED_BUILTINS = Object.freeze(['node:path']);

  it('cero imports relativos; builtins solo los de la allowlist; clausura de 1', () => {
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
    // El assert que de verdad MUERDE: los dos de arriba son de FORMA y sobrevivirían a una
    // sintaxis de import que las dos regex no vieran; éste es de ALCANZABILIDAD y no.
    const closure = walkImports(formatPath);
    assert.equal(
      closure.size,
      1,
      `la CLAUSURA transitiva de dashboard/format.js debe ser exactamente 1 (él mismo): es lo ` +
        `que hace que node:path no cuente como grafo. Clausura medida (${closure.size}):\n  ` +
        `${[...closure].map((p) => relative(REPO, p)).join('\n  ')}`,
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
  it('stripComments recupera los 4 imports estáticos de src/cli/dashboard/markdown.js', () => {
    const markdownPath = join(SRC, 'cli', 'dashboard', 'markdown.js');
    assert.equal(
      existsSync(markdownPath),
      true,
      'src/cli/dashboard/markdown.js must exist — otherwise this meta-test passes trivially',
    );
    const stripped = stripComments(readFileSync(markdownPath, 'utf-8'));
    const imports = extractImports(stripped);
    assert.equal(
      imports.length,
      4,
      `stripComments debe conservar los 4 imports estáticos de markdown.js. Si este número es ` +
        `0, el orden del helper se ha revertido al del molde hermano y el guard dinámico está ` +
        `CIEGO sobre este fichero (D-09/D-10). Recuperados (${imports.length}): ` +
        `${imports.join(', ')}`,
    );
  });
});
