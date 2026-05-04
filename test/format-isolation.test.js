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
// No cubre `import()` dinámico — el repo no lo usa (verificado en 06-RESEARCH A3).
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;

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

/**
 * Walker transitivo de imports relativos (`./x.js`, `../y.js`).
 * Ignora specifiers bare (`node:fs`, `commander`, `picocolors`) — fuera del grafo del proyecto.
 * No sigue dynamic `import()` (el repo no los usa — verificado por grep en 06-RESEARCH A3).
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
