// @ts-check
//
// src/logs/head-line.js — Lectura bounded de la primera línea de un archivo.
//
// Optimización sobre un stream reader de líneas: NO abre un stream que
// dispara 'data' events para todo el archivo. Lee 4KB chunks con readSync
// hasta encontrar '\n' o alcanzar MAX_HEADLINE_BYTES (64KB). Útil para
// escanear `~/.kodo/logs/` donde cada archivo puede ser grande pero solo
// importa la cabecera (`session.start`).
//
// Zero deps, zero imports de `logger.js`: módulo puro sin grafo de riesgo
// (LOG-12 preservado).
//

import { openSync, readSync, closeSync } from 'node:fs';

/** Cap total de bytes antes de abortar la búsqueda de '\n'. */
export const MAX_HEADLINE_BYTES = 65536;

/** Tamaño de cada read syscall. */
const READ_CHUNK = 4096;

/**
 * Lee solo la primera línea de un archivo (sin el '\n' final).
 *
 * Devuelve `null` si:
 *   - archivo vacío (EOF inmediato)
 *   - no hay '\n' dentro de los primeros MAX_HEADLINE_BYTES bytes
 *
 * @param {string} filePath
 * @returns {string | null}
 */
export function readFirstLine(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(READ_CHUNK);
    let acc = '';
    let pos = 0;
    while (acc.length < MAX_HEADLINE_BYTES) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) return null; // EOF sin '\n'
      const chunk = buf.slice(0, n).toString('utf8');
      const nl = chunk.indexOf('\n');
      if (nl !== -1) return acc + chunk.slice(0, nl);
      acc += chunk;
      pos += n;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
