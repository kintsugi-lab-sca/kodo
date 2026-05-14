import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
// Dos regex para cubrir las formas ESM que usa el repo:
//   1. `import X from 'Y'` / `import { X } from 'Y'` / `export ... from 'Y'` (con binding)
//   2. `import 'Y'` (side-effect import, sin binding) — hay que detectarlo porque es
//      la forma más corta de colar un logger.js al grafo del vigilante.
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
 * Ignora specifiers bare (`node:fs`, `commander`) — fuera del grafo del proyecto.
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

describe('LOG-12: vigilante isolation (import-graph)', () => {
  it('src/logger.js exists (sanity: test is meaningful only when the prohibited module is real)', () => {
    assert.equal(
      existsSync(join(SRC, 'logger.js')),
      true,
      'src/logger.js must exist after Plan 06-02 — otherwise this isolation test passes trivially',
    );
  });

  it('src/logger-noop.js exists and has zero imports', () => {
    const noopPath = join(SRC, 'logger-noop.js');
    assert.equal(existsSync(noopPath), true, 'src/logger-noop.js must exist after Plan 06-02');
    const src = readFileSync(noopPath, 'utf-8');
    const imports = extractImports(src);
    assert.deepEqual(
      imports,
      [],
      `logger-noop.js must have zero imports (including node: builtins), found: ${imports.join(', ')}`,
    );
  });

  it('kodo check does not import src/logger.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    // Distinguir logger.js del logger-noop.js: ambos terminan en "logger" pero
    // sólo uno está prohibido. `/\/logger\.js$/` matchea el primero y no el segundo.
    const violators = [...graph].filter((p) => /\/logger\.js$/.test(p));
    const relViolators = violators.map((p) => relative(REPO, p));
    const relGraph = [...graph].map((p) => relative(REPO, p));
    assert.deepEqual(
      violators,
      [],
      `check.js transitively imports src/logger.js via:\n  ${relViolators.join('\n  ')}\n` +
        `Full graph from check.js:\n  ${relGraph.join('\n  ')}`,
    );
  });

  it('logger-noop.js is allowed in the check.js graph (explicit whitelist)', () => {
    // Meta-test: documenta la distinción clara entre logger.js (prohibido) y
    // logger-noop.js (permitido). Si en algún momento algo del path de check.js
    // importa logger-noop.js, el test principal (con regex `/\/logger\.js$/`)
    // no rompe — y aquí re-validamos que el noop sigue siendo zero-import
    // incluso cuando se alcanza transitivamente.
    const graph = walkImports(join(SRC, 'check.js'));
    const noopHits = [...graph].filter((p) => p.endsWith('/logger-noop.js'));
    for (const hit of noopHits) {
      const src = readFileSync(hit, 'utf-8');
      const imports = extractImports(src);
      assert.deepEqual(
        imports,
        [],
        `logger-noop.js (reachable from check.js) must still have zero imports, found: ${imports.join(', ')}`,
      );
    }
  });

  // Phase 24 LOG-12 extension: el provider de GitHub carga config.js (vía GitHubClient
  // constructor) y normalize.js carga interface.js — ambos fuera del árbol permitido
  // de `kodo check`. Mantener `check.js` light-weight como en v0.5 (precedente del
  // logger.js prohibido) es invariante cross-phase (STATE.md).
  it('kodo check does not import src/providers/github/provider.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const violators = [...graph].filter((p) => p.endsWith('/providers/github/provider.js'));
    assert.deepEqual(
      violators,
      [],
      `check.js transitively imports github/provider.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`,
    );
  });

  it('kodo check does not import src/providers/github/normalize.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const violators = [...graph].filter((p) => p.endsWith('/providers/github/normalize.js'));
    assert.deepEqual(
      violators,
      [],
      `check.js transitively imports github/normalize.js via:\n  ${violators.map((p) => relative(REPO, p)).join('\n  ')}`,
    );
  });
});
