// @ts-check
//
// test/logs-follow-integration.test.js — Phase 17 UAT-01 SC#1.
//
// Convierte el UAT humano `kodo logs --follow` (live tail + cleanup limpio del
// watcher) en integration test automatizado:
//
//   1. Spawn child real `bin/kodo logs <session-id> --follow` con HOME aislado
//      (D-01 + D-02). NO importa `followFile` — debe ejercer el wiring CLI.
//   2. Pre-crea el archivo NDJSON vacío (D-07). Path "existe pero vacío"
//      (dump-0 + tail), NO "waiting for session log to appear" (deferred).
//   3. Append progresivo de 3 batches con sentinels `{event:'test.batch', seq:N,
//      timestamp:<ISO>}`, separados ≥250ms ≥ FOLLOW_INTERVAL_MS=200ms para
//      evitar coalescencia del polling watcher (D-04).
//   4. Verificación con `awaitLine` que asserta orden estricto (D-05): el child
//      DEBE emitir seq=1 ANTES de que se appendee batch 2. Si la implementación
//      buffereara y emitiera todo al final, el ordering temporal lo demostraría
//      falso (timeout en awaitLine(seq=1)).
//   5. Cleanup vía `child.kill('SIGINT')` + `await on('exit')` con timeout duro
//      2s (D-06). Assert exit code 0. `unwatchFile` corre dentro del SIGINT
//      handler real de followFile (src/logs/follow.js:67-70).
//
// Aislamiento HOME (D-02 / CR-02 Phase 16 adaptado a subprocess): el test
// crea `mkdtempSync('kodo-uat-follow-')`, lo pasa via env del child, y limpia
// con rmSync en after(). NO modifica process.env.HOME global del runner — el
// child resuelve KODO_DIR=join(homedir(), '.kodo') desde su propio env.
//
// Predicate notes (deviation Rule 1):
//   El plan sugería un predicate basado en `JSON.parse(line)`. Pero el child,
//   al no usar `--json` (D-04 prohíbe el flag), emite líneas con el formatter
//   humano de logger.js (`HH:MM:SS LEVEL component msg +k=v...`). El predicate
//   real busca el sentinel `seq=N` + `event=test.batch` dentro de la línea
//   formateada, que es lo que el formatCtxInline serializa para los campos
//   no-base. Es deterministicamente único: `event=test.batch` no choca con
//   ningún `EVENTS.*` canónico (verificado en threat register T-17-01-05).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/**
 * Helper inline: acumula chunks de stdout, parte por '\n', y resuelve cuando
 * alguna línea satisface `predicate(line)`. Rechaza con error si pasa el
 * timeout. Limpia el listener al resolver/rechazar para evitar leaks.
 *
 * D-05: el predicate aplica string-match sobre la línea humana formateada por
 * logger.js#formatLine (branch useColor=false en stdio:'pipe' del child).
 *
 * @param {NodeJS.ReadableStream} stream stream a observar (child.stdout).
 * @param {(line: string) => boolean} predicate matcher por línea.
 * @param {number} timeoutMs timeout duro.
 * @param {string} description mensaje de error si timeout.
 * @returns {Promise<string>} la línea que satisface el predicate.
 */
function awaitLine(stream, predicate, timeoutMs, description) {
  return new Promise((resolveLine, reject) => {
    let buffer = '';
    let settled = false;

    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      // Última partición sin '\n' queda en buffer para la próxima lectura.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (settled) return;
        if (predicate(line)) {
          settled = true;
          cleanup();
          resolveLine(line);
          return;
        }
      }
    };

    const onError = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`awaitLine timeout (${timeoutMs}ms): ${description}\nbuffered=${JSON.stringify(buffer)}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('error', onError);
    }

    stream.on('data', onData);
    stream.on('error', onError);
  });
}

/**
 * Helper inline: resuelve cuando el child emite 'exit', rechaza si pasa el
 * timeout. D-06 cleanup gate — si SIGINT no convierte en exit limpio en
 * `timeoutMs`, el test cae con mensaje explícito (handle leakeado o watcher
 * no desregistrado).
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null }>}
 */
function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, reject) => {
    let settled = false;
    const onExit = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExit({ code, signal });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off('exit', onExit);
      reject(new Error(`waitForExit timeout (${timeoutMs}ms) — SIGINT no produjo exit limpio (D-06)`));
    }, timeoutMs);
    child.once('exit', onExit);
  });
}

describe('UAT-01 SC#1: kodo logs --follow real tail + SIGINT cleanup', () => {
  /** @type {string} */
  let tmpHome;

  before(() => {
    // D-02: tmpdir aislado para HOME del child. mkdtempSync evita race con
    // tests paralelos del mismo runner. NO override de process.env.HOME global
    // — solo en el env del child (pasado a spawn()). Esto significa que
    // imports estáticos del test runner (state.js, logger.js) NO se ven
    // afectados; solo el subprocess kodo lo ve.
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-uat-follow-'));
    mkdirSync(join(tmpHome, '.kodo', 'logs'), { recursive: true });
  });

  after(() => {
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('dumps empty file then tails 3 progressive batches in strict order and exits cleanly on SIGINT (D-04..D-07)', async () => {
    // Session id único por test run para evitar colisiones (mismo PID + timestamp).
    const sessionId = 'uat-follow-' + process.pid + '-' + Date.now();
    const logFile = join(tmpHome, '.kodo', 'logs', sessionId + '.ndjson');

    // D-07: pre-crear archivo vacío (path "existe pero vacío" → dump-0 + tail).
    // El path "waiting for session log to appear" queda fuera de scope.
    writeFileSync(logFile, '');

    // D-01 + D-02: spawn real bin/kodo con HOME override en env del child.
    // Argv grep-friendly en una línea (acceptance_criteria literal: `spawn(process.execPath`).
    const argv = [KODO_BIN, 'logs', sessionId, '--follow'];
    const child = spawn(process.execPath, argv, {
      cwd: REPO,
      env: { ...process.env, HOME: tmpHome },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Capturar stderr para debugging local — NO se assertea contenido (D-15
    // CONTEXT discretion: stderr es prose; el contrato es exit code + stdout).
    let stderr = '';
    child.stderr.on('data', (b) => {
      stderr += b.toString('utf8');
    });

    try {
      // Buffer de startup: 350ms ≥ FOLLOW_INTERVAL_MS=200ms (50ms margen) para
      // que el child arranque, cargue módulos dinámicos (reader.js, follow.js)
      // y entre en watchFile loop. Único sleep fijo del test — los demás van
      // por await awaitLine(...) que es event-driven.
      await new Promise((r) => setTimeout(r, 350));

      // D-04 + D-05: progresión 3 batches con orden estricto.
      // Los seq son literales explícitos { seq: 1 }, { seq: 2 }, { seq: 3 }
      // (no shorthand) — facilita el grep de acceptance_criteria que busca
      // `seq: 1`, `seq: 2`, `seq: 3` y refuerza la intención del test.
      // El predicate matchea la línea humana formateada por logger.js
      // (formatCtxInline serializa `event=test.batch seq=N timestamp=...`).
      const batches = [{ seq: 1 }, { seq: 2 }, { seq: 3 }];
      for (const { seq } of batches) {
        const sentinel = JSON.stringify({
          event: 'test.batch',
          seq: seq,
          timestamp: new Date().toISOString(),
        });
        appendFileSync(logFile, sentinel + '\n');

        // D-05 strict order: si el watcher fuera fake/buffering, este await
        // expiraría antes de que llegara seq=2/3, demostrando tail real.
        await awaitLine(
          child.stdout,
          (line) => line.includes('event=test.batch') && line.includes('seq=' + seq),
          2000,
          `expected seq=${seq} not received`,
        );

        // Inter-batch sleep ≥ FOLLOW_INTERVAL_MS=200ms para evitar que
        // watchFile coalesce 2 escrituras en un solo callback (no romperia
        // el test, pero diluye la prueba de progresividad).
        if (seq < 3) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      // D-06: SIGINT cleanup. Timeout duro 2s — si followFile leakea handles
      // o no honora el SIGINT handler (líneas 67-70), el test cae con mensaje
      // específico de waitForExit. Assert exit code 0 (process.exit(0) literal
      // del SIGINT handler).
      child.kill('SIGINT');
      const { code } = await waitForExit(child, 2000);
      assert.equal(
        code,
        0,
        `SIGINT debe convertir en exit 0 limpio en <2s (D-06 cleanup sin handles abiertos). stderr=${stderr}`,
      );
    } finally {
      // Garantía extra: si el test cae antes del SIGINT (e.g. awaitLine timeout),
      // matamos el child para no dejarlo huérfano. SIGKILL incondicional aquí
      // es seguro porque ya hicimos el assert canónico arriba.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  });
});
