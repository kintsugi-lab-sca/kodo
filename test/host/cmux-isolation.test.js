// test/host/cmux-isolation.test.js
// Phase 38 SC#5 (cmux-isolation) — walker estructural análogo a
// test/format-isolation.test.js (color-isolation Phase 34 D-12).
//
// Garantiza CERO referencias directas a `src/cmux/client.js` desde las 3
// carpetas/archivos de D-09: src/cli/dashboard/, src/session/, src/cli/polling.js.
// cmux confinado a src/host/cmux.js (delegation a cmux/client.js permitida).
//
// Excepciones documentadas (D-09):
//   - src/cmux/colors.js es un helper de formato PURO (no es el cliente cmux);
//     importarlo NO es un leak del WorkspaceHost contract.
//   - src/host/cmux.js puede importar cmux/client.js (es el único punto de
//     delegation permitido).
//   - src/cli/dashboard/focus.js (Phase 37) existe pero NO importa cmux/ — usa
//     execFile inyectado, por tanto el walker lo deja pasar verde.
//
// W-1 hard-blocking (R-5 research): el refactor de los callers (manager.js,
// health.js) en Task 3 desbloquea el verde de este test. Antes de Task 3 este
// test FALLA rojo porque manager.js:6 y health.js:4 importan '../cmux/client.js'.
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

function extractImports(src) {
  const out = [];
  let m;
  while ((m = IMPORT_FROM_RE.exec(src)) !== null) out.push(m[1]);
  while ((m = IMPORT_BARE_RE.exec(src)) !== null) out.push(m[1]);
  return out;
}

/** Lista recursiva de .js. Acepta tanto un directorio como un archivo único. */
function listJsFiles(pathArg) {
  if (!existsSync(pathArg)) return [];
  const st = statSync(pathArg);
  if (st.isFile()) return pathArg.endsWith('.js') ? [pathArg] : [];
  const out = [];
  function walk(d) {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const s = statSync(full);
      if (s.isDirectory()) walk(full);
      else if (entry.endsWith('.js')) out.push(full);
    }
  }
  walk(pathArg);
  return out;
}

// Detecta import del CLIENTE cmux (no del helper puro colors.js).
// Regex /\/cmux\/client/ ancla específicamente al wrapper de I/O.
function leaksCmuxClient(specifier) {
  return /\/cmux\/client/.test(specifier);
}

// KODO-18 amplía la lista: `orchestrator/`, `triggers/dispatcher.js` y `hooks/stop.js`
// dejaron de importar cmux/client.js al migrar al contrato del host, así que entran al
// walker para que no puedan volver a hacerlo sin que el test lo cante.
const SCANNED = [
  join(SRC, 'cli', 'dashboard'),
  join(SRC, 'session'),
  join(SRC, 'cli', 'polling.js'),
  join(SRC, 'orchestrator'),
  join(SRC, 'triggers', 'dispatcher.js'),
  join(SRC, 'hooks', 'stop.js'),
];

// Los DOS módulos que a día de hoy siguen importando cmux/client.js a propósito. Se
// listan aquí —y NO en SCANNED— para que la deuda quede contada, no escondida:
//
//   · src/hooks/session-end.js — lo conserva SOLO como fail-safe: `resolveHostClient()`
//     cae al módulo cmux si la resolución del host falla, y la rama de degradación
//     `setColor(colorForStatus('review'))` cubre a los clientes sin `setStatus`.
//   · src/server.js — marca la tab PROPIA del daemon (nombre + color Indigo) partiendo de
//     `process.env.CMUX_WORKSPACE_ID`, una variable que solo existe dentro de una tab de
//     cmux. Con otro host la variable no está y el bloque entero se salta: es inerte, no
//     roto. Portarlo exigiría un equivalente por host (`orca worktree current`) y es
//     cosmética del daemon, no del ciclo de vida de las sesiones.
const KNOWN_DIRECT_CMUX_CONSUMERS = ['src/hooks/session-end.js', 'src/server.js'];

describe('Phase 38 SC#5 (cmux-isolation): cero refs a cmux/client.js fuera de src/host/', () => {
  for (const target of SCANNED) {
    const label = relative(REPO, target);
    test(`${label} no importa src/cmux/client.js`, () => {
      const files = listJsFiles(target);
      const leakers = files
        .filter((f) => extractImports(readFileSync(f, 'utf-8')).some(leaksCmuxClient))
        .map((f) => relative(REPO, f));
      assert.deepEqual(
        leakers,
        [],
        `cmux leak (SC#5): ${leakers.join(', ')} importan cmux/client.js. ` +
          'Refactorizar para consumir getHost(\'cmux\') de src/host/interface.js. ' +
          '(Task 3 del Plan 38-01 desbloquea este verde.)',
      );
    });
  }

  test('src/host/cmux.js SÍ puede delegar a cmux/client.js (excepción D-09)', () => {
    const cmuxHost = join(SRC, 'host', 'cmux.js');
    assert.ok(existsSync(cmuxHost), 'src/host/cmux.js debe existir');
    // No assertamos que importe; solo documentamos que es el único path permitido.
  });

  test('la lista de consumidores directos de cmux/client.js no crece (KODO-18)', () => {
    // Ratchet: fija el inventario REAL. Si un módulo nuevo importa el cliente cmux, este
    // test lo caza aunque no esté en SCANNED; si uno de los dos conocidos se migra, hay
    // que quitarlo de la lista — el test también lo exige, así que la lista no se
    // queda desfasada hacia ninguno de los dos lados.
    const actual = listJsFiles(SRC)
      .filter((f) => f !== join(SRC, 'host', 'cmux.js'))
      .filter((f) => extractImports(readFileSync(f, 'utf-8')).some(leaksCmuxClient))
      .map((f) => relative(REPO, f))
      .sort();
    assert.deepEqual(
      actual,
      [...KNOWN_DIRECT_CMUX_CONSUMERS].sort(),
      'cambió el inventario de módulos que importan cmux/client.js directamente',
    );
  });
});
