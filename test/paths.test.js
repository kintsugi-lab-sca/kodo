// test/paths.test.js — KODO-43.
//
// Dos cosas distintas se aseveran aquí, y conviene no confundirlas:
//
//   PATHS-01..03  el CONTRATO de `src/paths.js`: qué compone, que es lazy, que es hoja.
//   PATHS-04      el guard ANTI-DRIFT: que el literal `'.kodo'` no reaparezca en `src/`.
//
// El segundo es el que da valor a la tarea. Sin él, KODO-43 borra doce duplicados hoy y
// mañana entra el decimotercero sin que nadie se entere: exactamente la situación de partida.
// El primero protege la propiedad de la que depende que los leafs puedan importarlo.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { homedir } from 'node:os';

import { KODO_DIRNAME, kodoDir, kodoPath } from '../src/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
const PATHS_MODULE = join(SRC, 'paths.js');

describe('PATHS-01: composición', () => {
  it('KODO_DIRNAME es el literal del directorio, no una ruta', () => {
    assert.equal(KODO_DIRNAME, '.kodo');
  });

  it('kodoDir compone HOME + KODO_DIRNAME', () => {
    assert.equal(kodoDir(), join(homedir(), KODO_DIRNAME));
  });

  it('kodoPath compone subrutas bajo la raíz', () => {
    assert.equal(kodoPath('logs', 'daemon.log'), join(homedir(), KODO_DIRNAME, 'logs', 'daemon.log'));
    assert.equal(kodoPath(), kodoDir(), 'sin segmentos → la propia raíz');
  });
});

describe('PATHS-02: kodoDir es LAZY, no una constante congelada', () => {
  // La razón entera por la que este módulo exporta funciones y no consts (ver su cabecera).
  // Si alguien lo "simplifica" a `export const KODO_DIR = join(homedir(), '.kodo')`, este test
  // se pone rojo ANTES de que se pongan rojos los ~30 tests HOME-isolated que lo pagarían.
  it('acepta un resolvedor de HOME inyectado', () => {
    assert.equal(kodoDir(() => '/tmp/sandbox-a'), join('/tmp/sandbox-a', '.kodo'));
    assert.equal(kodoDir(() => '/tmp/sandbox-b'), join('/tmp/sandbox-b', '.kodo'));
  });

  it('sin inyección resuelve el HOME EN LA LLAMADA, no al importar el módulo', () => {
    // El import de arriba es estático y ya ocurrió. Si `kodoDir` hubiera capturado el HOME
    // entonces, pisarlo ahora no cambiaría nada — que es justo la fuga de `config.js:11`.
    const original = process.env.HOME;
    try {
      process.env.HOME = '/tmp/home-cambiado-despues-del-import';
      assert.equal(kodoDir(), join('/tmp/home-cambiado-despues-del-import', '.kodo'));
    } finally {
      if (original === undefined) delete process.env.HOME;
      else process.env.HOME = original;
    }
  });

  it('undefined cae al default (permite `kodoDir(deps.homedirFn)` sin ternario en el caller)', () => {
    assert.equal(kodoDir(undefined), join(homedir(), '.kodo'));
  });
});

describe('PATHS-03: src/paths.js es una HOJA pura', () => {
  // Molde: ISO-02/ISO-03 de test/format-isolation.test.js. Es la PREMISA sobre la que descansa
  // que los cuatro leafs del dashboard (que prohíben `src/config.js` por su I/O y su
  // `loadEnvFile()` en module-load) puedan importarlo sin romper su aislamiento.
  //
  // Allowlist CONGELADA literalmente, jamás derivada del fichero sujeto: una allowlist
  // calculada a partir de lo que el sujeto importa siempre saldría verde.
  const ALLOWED_BUILTINS = Object.freeze(['node:os', 'node:path']);

  it('existe (si no, todo lo de abajo pasaría en vacío)', () => {
    assert.equal(existsSync(PATHS_MODULE), true, 'src/paths.js debe existir');
  });

  it('cero imports relativos; builtins solo los de la allowlist', () => {
    const imports = extractImports(readFileSync(PATHS_MODULE, 'utf-8'));
    const relatives = imports.filter((s) => s.startsWith('.'));
    assert.deepEqual(
      relatives,
      [],
      `src/paths.js debe ser HOJA: cero imports relativos, para que los leafs del dashboard lo ` +
        `importen sin arrastrar grafo. found: ${relatives.join(', ')}`,
    );
    const outsiders = imports.filter((s) => !ALLOWED_BUILTINS.includes(s));
    assert.deepEqual(
      outsiders,
      [],
      `src/paths.js solo puede importar [${ALLOWED_BUILTINS.join(', ')}]. ` +
        `Fuera de la allowlist: ${outsiders.join(', ')}`,
    );
  });

  it('cero I/O: no menciona node:fs ni ninguna primitiva de filesystem', () => {
    // Ancla al SÍMBOLO, no al import: un `require`/`import()` dinámico de fs también muerde.
    const src = stripComments(readFileSync(PATHS_MODULE, 'utf-8'));
    for (const forbidden of ['node:fs', 'readFileSync', 'writeFileSync', 'mkdirSync', 'existsSync']) {
      assert.ok(
        !src.includes(forbidden),
        `src/paths.js hace I/O (${forbidden}). Es un módulo de composición de rutas: si toca ` +
          `disco, deja de ser importable desde los leafs que existen para NO tocarlo.`,
      );
    }
  });
});

describe('PATHS-04 (anti-drift): el literal `.kodo` vive SOLO en src/paths.js', () => {
  // El guard que da valor a KODO-43. Los comentarios se recortan ANTES de buscar: la cabecera
  // de `src/config.js` y la de `src/orchestrator/launch.js` citan el literal para explicar QUÉ
  // sustituyeron, y esa cita es documentación, no una ruta que el runtime construya.
  it('ningún otro fichero de src/ construye la ruta a mano', () => {
    const files = walkJsFiles(SRC);
    assert.ok(
      files.length > 10,
      `src/ tiene ${files.length} ficheros .js — el guard estaría pasando casi en vacío. ` +
        `¿Se ha movido el directorio?`,
    );
    const offenders = [];
    for (const file of files) {
      if (file === PATHS_MODULE) continue; // la definición canónica, la única permitida
      if (stripComments(readFileSync(file, 'utf-8')).includes("'.kodo'")) {
        offenders.push(relative(REPO, file));
      }
    }
    assert.deepEqual(
      offenders,
      [],
      `Estos ficheros vuelven a construir la ruta de kodo a mano en vez de usar ` +
        `\`kodoDir()\`/\`kodoPath()\` de src/paths.js (KODO-43). Es la duplicación que esa ` +
        `tarea cerró: con doce copias, un cambio de layout de \`~/.kodo\` hay que aplicarlo ` +
        `doce veces y nadie lo mide.\n  ${offenders.join('\n  ')}`,
    );
  });

  it('los consumidores del literal lo obtienen de paths.js (convergencia)', () => {
    // Anti-vacuidad del assert de arriba: sin esto, borrar TODO uso de `~/.kodo` de src/ dejaría
    // PATHS-04 verde sobre un módulo que ya no usa nadie.
    const consumers = walkJsFiles(SRC).filter((f) => {
      if (f === PATHS_MODULE) return false;
      const src = stripComments(readFileSync(f, 'utf-8'));
      return /from\s*['"][^'"]*paths\.js['"]/.test(src);
    });
    assert.ok(
      consumers.length >= 10,
      `Solo ${consumers.length} ficheros de src/ importan paths.js; se esperaban los ~12 sitios ` +
        `migrados en KODO-43. Si el número bajó, alguien deshizo la centralización.\n  ` +
        consumers.map((f) => relative(REPO, f)).join('\n  '),
    );
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────

/**
 * Recorta comentarios de línea y de bloque. Divergencia deliberada respecto del de
 * `test/format-isolation.test.js`: aquí NO hace falta preservar strings, porque lo único que se
 * busca DENTRO del código es un literal entrecomillado (`'.kodo'`) y un `from '…paths.js'`.
 *
 * @param {string} src
 * @returns {string}
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Extrae los specifiers de import/export estáticos. Misma clase de regex que
 * `test/format-isolation.test.js` (CR-01): admite las formas ESM SIN whitespace.
 *
 * @param {string} src
 * @returns {string[]}
 */
function extractImports(src) {
  const stripped = stripComments(src);
  const out = [];
  const withFrom = /^\s*(?:import|export)(?=[\s{*'"])[^'"]*?from\s*['"]([^'"]+)['"]/gm;
  const sideEffect = /^\s*import\s*['"]([^'"]+)['"]/gm;
  for (const m of stripped.matchAll(withFrom)) out.push(m[1]);
  for (const m of stripped.matchAll(sideEffect)) out.push(m[1]);
  return out;
}

/**
 * Todos los `.js` bajo `dir`, recursivo.
 *
 * @param {string} dir
 * @returns {string[]} rutas absolutas
 */
function walkJsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkJsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
