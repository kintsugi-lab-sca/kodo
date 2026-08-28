// @ts-check
//
// test/helpers/fake-host-binary.js — KODO-50
//
// Seam de test para los clientes de host (`src/cmux/client.js`, `src/orca/client.js`).
//
// Por qué un binario FAKE y no un mock de `execFile`: ninguno de los dos clientes
// expone un seam de inyección sobre `run()` — resuelven el binario desde
// `loadConfig()` y llaman a `execFile` importado directamente. `mock.module` de
// node:test tampoco es viable: el script `npm test` no pasa
// `--experimental-test-module-mocks`. Así que se ataca por la única puerta que los
// clientes SÍ dejan abierta: el path del binario en `~/.kodo/config.json`.
//
// El fake es un script node ejecutable que vuelca su `process.argv.slice(2)` a
// `argv.json` y emite el stdout/stderr/exit code que el test le dicte por `ctl.json`.
// Eso convierte cada export async del cliente en un aserto sobre el argv EXACTO que
// sale hacia el binario real — que es justo lo que los tests de funciones puras no
// pueden cubrir (`run()` no es pura y el argv de la mayoría de comandos se construye
// inline en el propio export).
//
// Uso (el orden importa: `HOME` debe estar puesto ANTES de importar el cliente, que
// arrastra `src/config.js`, que calcula `CONFIG_PATH` al evaluarse):
//
//   const host = createFakeHost({ host: 'cmux', cmux: { binary: null } });
//   process.env.HOME = host.home;
//   const cmux = await import('../../src/cmux/client.js');
//
// `binary: null` es el marcador que el helper sustituye por el path del fake.
//
// Cada fichero de test corre en su propio proceso (node:test aísla por fichero), así
// que reescribir `process.env.HOME` aquí no contamina a los demás.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FAKE_SOURCE = `#!/usr/bin/env node
// Binario fake generado por test/helpers/fake-host-binary.js — NO editar a mano.
//
// Registra CADA invocación (una línea JSON por llamada en argv.jsonl) y responde
// según ctl.json. El índice de la invocación sale de las líneas ya escritas, así que
// un export que encadena varios comandos (p. ej. orca send = terminal list + terminal
// send) puede recibir una respuesta distinta por paso.
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const logPath = join(dir, 'argv.jsonl');

const previous = existsSync(logPath)
  ? readFileSync(logPath, 'utf-8').split('\\n').filter(Boolean).length
  : 0;
appendFileSync(logPath, JSON.stringify(process.argv.slice(2)) + '\\n');

const ctlPath = join(dir, 'ctl.json');
const ctl = existsSync(ctlPath) ? JSON.parse(readFileSync(ctlPath, 'utf-8')) : {};
const queue = Array.isArray(ctl.responses) ? ctl.responses : null;
// Fuera de la cola se repite la ÚLTIMA respuesta: un test que solo declara los pasos
// que le importan no revienta si el cliente hace una llamada extra fail-open.
const res = (queue ? (queue[previous] ?? queue[queue.length - 1]) : ctl.default) || {};

if (res.stderr) process.stderr.write(String(res.stderr));
if (res.stdout) process.stdout.write(String(res.stdout));
process.exit(Number(res.code) || 0);
`;

/**
 * Sustituye recursivamente los `null` del patch por `binPath`. Permite escribir
 * `{ cmux: { binary: null } }` sin repetir el path del fake en cada test.
 * @param {any} value
 * @param {string} binPath
 * @returns {any}
 */
function fillBinary(value, binPath) {
  if (value === null) return binPath;
  if (Array.isArray(value)) return value.map((v) => fillBinary(v, binPath));
  if (value && typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fillBinary(v, binPath);
    return out;
  }
  return value;
}

/**
 * Monta un `$HOME` temporal con `~/.kodo/config.json` y un binario fake ejecutable.
 *
 * @param {Record<string, any>} configPatch config parcial; cada `null` se sustituye
 *   por el path del binario fake (ver `fillBinary`). Se escribe tal cual: `loadConfig()`
 *   deep-mergea sobre `DEFAULT_CONFIG`, así que basta con las claves relevantes.
 * @returns {{
 *   home: string,
 *   binPath: string,
 *   argv: () => string[],
 *   calls: () => string[][],
 *   setResponse: (r: { stdout?: string, stderr?: string, code?: number }) => void,
 *   setResponses: (rs: Array<{ stdout?: string, stderr?: string, code?: number }>) => void,
 *   reset: () => void,
 *   cleanup: () => void,
 * }}
 */
export function createFakeHost(configPatch) {
  const home = mkdtempSync(join(tmpdir(), 'kodo-fakehost-'));
  const binDir = join(home, 'bin');
  mkdirSync(binDir, { recursive: true });

  // Extensión `.mjs`: el fake usa ESM y vive fuera del árbol del paquete (tmpdir),
  // donde no hay `package.json` con `"type": "module"` que lo cubra.
  const binPath = join(binDir, 'fake-host.mjs');
  writeFileSync(binPath, FAKE_SOURCE);
  chmodSync(binPath, 0o755);

  mkdirSync(join(home, '.kodo'), { recursive: true });
  writeFileSync(
    join(home, '.kodo', 'config.json'),
    JSON.stringify(fillBinary(configPatch, binPath), null, 2) + '\n',
  );

  const logPath = join(binDir, 'argv.jsonl');
  const ctlPath = join(binDir, 'ctl.json');

  /** @returns {string[][]} */
  function calls() {
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  return {
    home,
    binPath,

    /** argv de la ÚLTIMA invocación. Lanza si el binario no llegó a ejecutarse. */
    argv() {
      const all = calls();
      if (!all.length) throw new Error('fake-host: el binario no llegó a ejecutarse');
      return all[all.length - 1];
    },

    /** argv de TODAS las invocaciones desde el último `reset()`, en orden. */
    calls,

    /** Misma respuesta para todas las invocaciones. */
    setResponse({ stdout = '', stderr = '', code = 0 }) {
      writeFileSync(ctlPath, JSON.stringify({ default: { stdout, stderr, code } }));
    },

    /**
     * Una respuesta por invocación, en orden. Agotada la cola se repite la última —
     * así un test declara solo los pasos que le importan.
     */
    setResponses(responses) {
      writeFileSync(
        ctlPath,
        JSON.stringify({
          responses: responses.map(({ stdout = '', stderr = '', code = 0 }) => ({ stdout, stderr, code })),
        }),
      );
    },

    /** Borra el registro de llamadas y la respuesta configurada. */
    reset() {
      rmSync(logPath, { force: true });
      rmSync(ctlPath, { force: true });
    },

    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}
