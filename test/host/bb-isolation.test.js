// test/host/bb-isolation.test.js
// KODO-31 — walker estructural, hermano de test/host/cmux-isolation.test.js y
// test/host/orca-isolation.test.js.
//
// Garantiza que el binario de BB se habla desde UN ÚNICO punto: `src/host/bb.js`. La regla
// es tan estricta como la de orca (y más que la de cmux, que arrastra deuda histórica):
// el carril de BB nace limpio, así que se cierra entero desde el día uno.
//
// EXCEPCIÓN ÚNICA: `src/cli/doctor.js` importa `doctor()` del cliente. No es una fuga del
// carril de lifecycle —no crea, no para ni enfoca threads: solo pregunta si el servidor
// está en pie— y hacerlo pasar por `getHost()` obligaría a meter un verbo de diagnóstico
// en el contrato WorkspaceHost, que está congelado en 4 métodos. Está en el allowlist de
// forma EXPLÍCITA para que cualquier import nuevo siga poniendo el test en rojo.
//
// Si este test se pone rojo, la corrección es consumir `getHost(resolveHostName())` de
// `src/host/interface.js`, NUNCA añadir una excepción aquí.
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
 * `@param {import('../logger.js').Logger}`, que no es una dependencia en runtime y daría
 * un falso positivo en el guard de LOG-12.
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

/** Detecta un import del CLIENTE bb (no de otros módulos que pudieran vivir en src/bb/). */
function leaksBbClient(specifier) {
  return /\/bb\/client(\.js)?$/.test(specifier);
}

// El punto de delegación del lifecycle + la excepción documentada del doctor.
const ALLOWED = join(SRC, 'host', 'bb.js');
const ALLOWED_DIAGNOSTIC = join(SRC, 'cli', 'doctor.js');

describe('KODO-31 (bb-isolation): src/bb/client.js solo se consume desde src/host/bb.js', () => {
  test('ningún módulo de src/ fuera del allowlist importa el cliente bb', () => {
    const leakers = listJsFiles(SRC)
      .filter((f) => f !== ALLOWED && f !== ALLOWED_DIAGNOSTIC)
      .filter((f) => extractImports(readFileSync(f, 'utf-8')).some(leaksBbClient))
      .map((f) => relative(REPO, f));
    assert.deepEqual(
      leakers,
      [],
      `bb leak: ${leakers.join(', ')} importan src/bb/client.js. ` +
        'Consumir getHost(resolveHostName()) de src/host/interface.js en su lugar.',
    );
  });

  test('src/host/bb.js SÍ delega en el cliente (es el punto permitido)', () => {
    assert.ok(existsSync(ALLOWED), 'src/host/bb.js debe existir');
    const imports = extractImports(readFileSync(ALLOWED, 'utf-8'));
    assert.ok(imports.some(leaksBbClient), 'host/bb.js debe delegar en ../bb/client.js');
  });

  test('el doctor solo importa el cliente para DIAGNOSTICAR, nunca para el lifecycle', () => {
    // La excepción es estrecha a propósito: si el doctor empezara a crear o parar threads,
    // el confinamiento se habría roto de facto aunque el walker siguiera verde.
    const src = readFileSync(ALLOWED_DIAGNOSTIC, 'utf-8');
    assert.match(src, /import\('\.\.\/bb\/client\.js'\)\)\.doctor/, 'el doctor debe importar SOLO `doctor`');
    for (const verb of ['newWorkspace', 'send(', 'close(', 'focusWorkspace']) {
      assert.ok(!src.includes(`bb/client.js')).${verb}`), `el doctor no debe usar ${verb} del cliente bb`);
    }
  });

  test('src/bb/client.js no importa src/logger.js (LOG-12, igual que sus hermanos)', () => {
    const imports = extractImports(readFileSync(join(SRC, 'bb', 'client.js'), 'utf-8'));
    assert.ok(
      !imports.some((i) => /\/logger(\.js)?$/.test(i)),
      'el logger se inyecta por opts, no se importa',
    );
  });

  test('src/host/bb.js no importa src/logger.js (LOG-12)', () => {
    const imports = extractImports(readFileSync(ALLOWED, 'utf-8'));
    assert.ok(!imports.some((i) => /\/logger(\.js)?$/.test(i)), 'el logger se inyecta vía opts.logger');
  });

  test('el cliente bb NO cablea verbos destructivos (`thread archive` / `thread delete`)', () => {
    // Espejo del guard de `worktree rm` en el carril de orca, y de `workspace-group delete`
    // en el del sidebar doctor. `thread stop` SÍ se cablea: suelta el runtime, no destruye
    // nada — la distinción es justamente lo que este test fija. Archivar un thread es lo
    // que se lleva por delante el worktree y la rama, y eso NO puede ser un efecto
    // colateral de un tick del daemon: la rama de BB está bajo el gate de integración de
    // kodo (mergeada → borrada; no mergeada → conservada) y archivar antes de integrar
    // perdería trabajo sin revisar.
    const src = readFileSync(join(SRC, 'bb', 'client.js'), 'utf-8');
    for (const verb of ['archive', 'delete']) {
      assert.ok(
        !new RegExp(`'thread',\\s*'${verb}'`).test(src),
        `src/bb/client.js no debe cablear \`thread ${verb}\``,
      );
    }
    assert.ok(!/'project',\s*'delete'/.test(src), 'src/bb/client.js no debe cablear `project delete`');
    // El verbo NO destructivo sí debe estar: es el que dispara SessionEnd.
    assert.ok(/'thread',\s*'stop'/.test(src), '`thread stop` es el verbo del autocierre y debe existir');
  });

  test('el cliente bb NUNCA usa shell: todo argv va por execFile (anti-inyección)', () => {
    // El prompt y el título de una tarea son contenido NO confiable (LLM/Plane) y viajan
    // como argumentos de `thread spawn`. Con execFile cada uno es un elemento de array y
    // jamás se interpola en una línea de shell.
    const src = readFileSync(join(SRC, 'bb', 'client.js'), 'utf-8');
    assert.ok(!/\bexec\s*\(/.test(src), 'nada de child_process.exec (shell)');
    assert.ok(!/execSync\s*\(/.test(src), 'nada de execSync (shell)');
    assert.match(src, /import \{ execFile \} from 'node:child_process'/, 'debe usar execFile');
  });
});
