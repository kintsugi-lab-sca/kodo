// test/host/orca-isolation.test.js
// KODO-18 — walker estructural, hermano de test/host/cmux-isolation.test.js.
//
// Garantiza que el binario de Orca se habla desde UN ÚNICO punto: `src/host/orca.js`.
// La regla es MÁS ESTRICTA que la de cmux (que solo vigila 3 carpetas por deuda
// histórica: session-end.js y orchestrator/launch.js aún importan cmux/client.js
// directo): el carril de Orca nace limpio, así que se cierra entero desde el día uno.
//
// Si este test se pone rojo, la corrección es consumir `getHost(resolveHostName())`
// de `src/host/interface.js`, NUNCA añadir una excepción aquí.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const SRC = join(REPO, 'src');

const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;
// import() dinámico — el bloque `_legacy` del host lo usa para el lazy-load.
const IMPORT_DYNAMIC_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Elimina comentarios antes de buscar imports. Imprescindible desde que el walker mira
 * también los `import()` dinámicos: los JSDoc del repo usan la forma TYPE-ONLY
 * `@param {import('../logger.js').Logger}`, que no es una dependencia en runtime y
 * daría un falso positivo en el guard de LOG-12.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function extractImports(src) {
  const code = stripComments(src);
  const out = [];
  for (const re of [IMPORT_FROM_RE, IMPORT_BARE_RE, IMPORT_DYNAMIC_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code)) !== null) out.push(m[1]);
  }
  return out;
}

/** Lista recursiva de .js bajo un directorio. */
function listJsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  (function walk(d) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.js')) out.push(full);
    }
  })(dir);
  return out;
}

/** Detecta un import del CLIENTE orca (no de otros módulos que pudieran vivir en src/orca/). */
function leaksOrcaClient(specifier) {
  return /\/orca\/client(\.js)?$/.test(specifier);
}

// El ÚNICO punto de delegación permitido.
const ALLOWED = join(SRC, 'host', 'orca.js');

describe('KODO-18 (orca-isolation): src/orca/client.js solo se consume desde src/host/orca.js', () => {
  test('ningún módulo de src/ fuera de host/orca.js importa el cliente orca', () => {
    const leakers = listJsFiles(SRC)
      .filter((f) => f !== ALLOWED)
      .filter((f) => extractImports(readFileSync(f, 'utf-8')).some(leaksOrcaClient))
      .map((f) => relative(REPO, f));
    assert.deepEqual(
      leakers,
      [],
      `orca leak: ${leakers.join(', ')} importan src/orca/client.js. ` +
        "Consumir getHost(resolveHostName()) de src/host/interface.js en su lugar.",
    );
  });

  test('src/host/orca.js SÍ delega en el cliente (es el punto permitido)', () => {
    assert.ok(existsSync(ALLOWED), 'src/host/orca.js debe existir');
    const imports = extractImports(readFileSync(ALLOWED, 'utf-8'));
    assert.ok(imports.some(leaksOrcaClient), 'host/orca.js debe delegar en ../orca/client.js');
  });

  test('src/orca/client.js no importa src/logger.js (LOG-12, igual que su hermano cmux)', () => {
    const imports = extractImports(readFileSync(join(SRC, 'orca', 'client.js'), 'utf-8'));
    assert.ok(
      !imports.some((i) => /\/logger(\.js)?$/.test(i)),
      'el logger se inyecta por opts, no se importa',
    );
  });

  test('src/host/orca.js no importa src/logger.js (LOG-12)', () => {
    const imports = extractImports(readFileSync(ALLOWED, 'utf-8'));
    assert.ok(!imports.some((i) => /\/logger(\.js)?$/.test(i)), 'el logger se inyecta vía opts.logger');
  });

  test('el cliente orca NO cablea `worktree rm` (verbo destructivo: borra el checkout)', () => {
    // Espejo del guard de sidebar-doctor sobre `workspace-group delete`. kodo crea
    // worktrees en Orca; destruirlos es decisión del humano desde la app, no un efecto
    // colateral de un tick del daemon.
    const src = readFileSync(join(SRC, 'orca', 'client.js'), 'utf-8');
    assert.ok(!/'worktree',\s*'rm'/.test(src), "src/orca/client.js no debe cablear `worktree rm`");
    assert.ok(!/'repo',\s*'rm'/.test(src), "src/orca/client.js no debe cablear `repo rm`");
  });
});
