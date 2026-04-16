// @ts-check
//
// src/logs/follow.js — Tail-follow de NDJSON logs (`kodo logs --follow`).
//
// Semántica (D-04, D-05):
//   - Polling con fs.watchFile (NO fs.watch — edge cases inotify/FSEvents por plataforma).
//   - Dump completo desde byte 0 + tail en vivo (como `tail -f`).
//   - Si el archivo no existe aún, espera hasta que aparezca (poll) — no falla.
//   - Buffer de partial-line: guarda fragmento tras último '\n' para reparsear cuando
//     llegue más bytes. Cubre appendFileSync flush intermedio.
//   - SIGINT → unwatchFile + exit(0) limpio.
//
// Aislamiento del vigilante (LOG-12): NO importar src/logger.js. Este módulo
// sólo es alcanzable desde src/cli.js (no desde src/check.js) — confirmado por
// test/check-isolation.test.js.
//

import {
  watchFile,
  unwatchFile,
  openSync,
  readSync,
  closeSync,
  existsSync,
  statSync,
} from 'node:fs';

/**
 * Interval en ms del polling de watchFile. Exportado para override en tests.
 * Default 200ms — trade-off entre responsiveness humana y CPU (D-04).
 */
export const FOLLOW_INTERVAL_MS = 200;

/**
 * Tail-follow de un archivo append-only NDJSON con buffer para líneas parciales.
 * Semántica `tail -f`: dump completo + live append. Si el archivo no existe,
 * espera hasta que aparezca (poll).
 *
 * @param {string} filePath absolute path al archivo a seguir
 * @param {(line: string) => void} onLine callback por cada línea completa (sin '\n')
 */
export function followFile(filePath, onLine) {
  let readFrom = 0;
  let buffer = '';

  if (existsSync(filePath)) {
    drainFrom(0);
    readFrom = statSync(filePath).size;
  } else {
    process.stderr.write('waiting for session log to appear...\n');
  }

  watchFile(filePath, { interval: FOLLOW_INTERVAL_MS }, (curr, prev) => {
    // Archivo aún no existe — watchFile fires con size=0 placeholder.
    if (curr.size === 0 && prev.size === 0 && !existsSync(filePath)) return;
    // Truncate / rename — reset al inicio.
    if (curr.size < prev.size) {
      readFrom = 0;
      buffer = '';
    }
    if (curr.size > readFrom) {
      drainFrom(readFrom);
      readFrom = curr.size;
    }
  });

  process.on('SIGINT', () => {
    unwatchFile(filePath);
    process.exit(0);
  });

  /**
   * Lee bytes [start..EOF], concatena al buffer, corta por '\n' y emite líneas.
   * La última parte (fragmento sin '\n') queda en buffer para la próxima iteración.
   * @param {number} start byte offset
   */
  function drainFrom(start) {
    if (!existsSync(filePath)) return;
    const fd = openSync(filePath, 'r');
    try {
      const size = statSync(filePath).size - start;
      if (size <= 0) return;
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, start);
      buffer += buf.toString('utf8');
      const parts = buffer.split('\n');
      buffer = /** @type {string} */ (parts.pop());
      for (const line of parts) if (line) onLine(line);
    } finally {
      closeSync(fd);
    }
  }
}
