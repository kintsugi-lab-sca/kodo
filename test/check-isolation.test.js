import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');
const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;

/** Walk transitivo de imports relativos desde un entry source file. */
function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  if (!existsSync(entry)) return visited; // imports a archivos inexistentes no crashean el walker
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const match of src.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    // Resolver con extensión explícita (ESM puro requiere .js)
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}

describe('LOG-12: vigilante isolation (import-graph)', () => {
  it('kodo check does not import src/logger.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const hit = [...graph].find(p => p.endsWith('/logger.js') && !p.endsWith('logger-noop.js'));
    assert.equal(hit, undefined, `check.js transitively imports ${hit}`);
  });

  it('logger-noop.js is allowed in check.js transitive graph (zero-dep stub)', () => {
    // Smoke: si logger-noop.js existe y aparece en el grafo, no debe importar nada más
    const noopPath = join(SRC, 'logger-noop.js');
    if (!existsSync(noopPath)) return; // todavía no creado — Plan 02
    const src = readFileSync(noopPath, 'utf-8');
    const imports = [...src.matchAll(IMPORT_RE)].map(m => m[1]);
    assert.deepEqual(imports, [], `logger-noop.js must have zero imports, found: ${imports.join(', ')}`);
  });
});
