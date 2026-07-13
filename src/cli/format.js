// @ts-check
//
// src/cli/format.js — Color/format helper factory para CLI surfaces (DX-06).
//
// Responsabilidades:
//   1. Factory createFormatter(stream, env?) bound al descriptor (D-01).
//   2. Resolución eager de useColor con precedencia NO_COLOR > FORCE_COLOR > stream.isTTY (D-02, D-04).
//   3. Helpers por nivel (debug/info/warn/error), sintácticos (ok/fail), genéricos (green/yellow/red/cyan/gray/dim) (D-03).
//   4. formatRow / formatTable con padding strip-aware via visibleWidth() (D-09, D-10).
//
// Aislamiento del vigilante (LOG-12 extension): este archivo NO importa src/logger.js
// ni nada que lo arrastre — ver test/format-isolation.test.js.
//
// Single source of color (D-07): picocolors solo se importa aquí. Cualquier callsite
// que necesite color va por createFormatter(stream) — ver test/format-isolation.test.js.
//

import { createColors } from 'picocolors';

/** @type {string} */
export const OK_SYMBOL = '✓';

/** @type {string} */
export const FAIL_SYMBOL = '✗';

/** @type {string} */
const DEFAULT_SEPARATOR = ' · ';

/**
 * Resuelve `useColor` aplicando la precedencia documentada en CONTEXT D-02:
 *   1. NO_COLOR (cualquier valor, incluido cadena vacía) gana sobre todo lo demás.
 *   2. FORCE_COLOR='0' deshabilita; cualquier otro valor (incluida cadena vacía) fuerza color.
 *   3. Fallback: `stream.isTTY` boolean coercido.
 *
 * Underscore prefix indica re-export sólo para tests — production callers usan
 * los métodos del objeto devuelto por `createFormatter`.
 *
 * @param {{ isTTY?: boolean }} stream
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function _resolveUseColor(stream, env = process.env) {
  if (env.NO_COLOR != null) return false;
  if (env.FORCE_COLOR != null) return env.FORCE_COLOR !== '0';
  return Boolean(stream && stream.isTTY);
}

/**
 * Cuenta caracteres visibles de una string ignorando secuencias ANSI CSI
 * (ej. `\x1b[36m`, `\x1b[0m`). Necesario para padding correcto cuando el
 * cell ya viene coloreado (D-10).
 *
 * @param {string} s
 * @returns {number}
 */
export function visibleWidth(s) {
  return String(s).replace(/\x1b\[[\d;]*[A-Za-z]/g, '').length;
}

/**
 * Neutraliza la inyección de terminal desde contenido externo NO confiable
 * (p.ej. comentarios de Plane) antes de renderizarlo en el dashboard Ink
 * (HYG-07/M4, STRIDE Tampering). Función PURA — no importa/usa color.
 *
 * El regex CSI de `visibleWidth` (:57, `\x1b\[[\d;]*[A-Za-z]`) solo cubre CSI y
 * NO el vector OSC (`\x1b]…`, p.ej. OSC-52 = escritura al portapapeles del
 * operador). Este helper es un strip AMPLIO e independiente (Don't-Hand-Roll):
 *   1. Elimina las secuencias CSI completas (deja el texto visible limpio).
 *   2. Elimina TODO byte de control C0 y C1 + `\x7f` (DEL) — incluido `\x1b` (ESC),
 *      `\x07` (BEL), `\x0d` (CR), y los C1 `\x80-\x9f` (WR-02): U+009B (CSI de un
 *      solo byte) y U+009D (OSC) que algunos terminales interpretan SIN ESC previo.
 *      Con ello cualquier OSC/secuencia de escape queda inerte.
 * PRESERVA únicamente `\t` (`\x09`) y `\n` (`\x0a`). `\r` (`\x0d`) SÍ se elimina
 * (WR-02: evita que un contenido externo reescriba visualmente el inicio de su línea).
 * Nunca lanza: coacciona con `String(s)`.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function stripControlChars(s) {
  return String(s)
    // 1. Secuencias CSI completas (`\x1b[…letra`) → fuera, dejando el texto.
    .replace(/\x1b\[[\d;]*[A-Za-z]/g, '')
    // 2. Bytes de control C0 (incl. ESC `\x1b`, BEL `\x07`, CR `\x0d`) + DEL + C1
    //    (`\x80-\x9f`), preservando SOLO `\t` (\x09) y `\n` (\x0a).
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

/**
 * Right-pads una celda con espacios hasta alcanzar `width` medido por
 * `visibleWidth`. Si la celda ya excede el width, se devuelve sin truncar
 * (D-10 — no truncation).
 *
 * @param {string} cell
 * @param {number} width
 * @returns {string}
 */
function padCell(cell, width) {
  const w = visibleWidth(cell);
  if (w >= width) return cell;
  return cell + ' '.repeat(width - w);
}

/**
 * @typedef {{ isTTY?: boolean }} StreamLike
 *
 * @typedef {{
 *   debug:  (s: string) => string,
 *   info:   (s: string) => string,
 *   warn:   (s: string) => string,
 *   error:  (s: string) => string,
 *   ok:     (s: string) => string,
 *   fail:   (s: string) => string,
 *   green:  (s: string) => string,
 *   yellow: (s: string) => string,
 *   red:    (s: string) => string,
 *   cyan:   (s: string) => string,
 *   gray:   (s: string) => string,
 *   dim:    (s: string) => string,
 *   formatRow:   (cells: string[], widths: number[], opts?: { separator?: string }) => string,
 *   formatTable: (rows: string[][], opts?: { separator?: string, header?: string[] }) => string,
 * }} Formatter
 */

/**
 * Factory de formatters bound al `stream` descriptor. Resuelve `useColor`
 * eager (D-04 — captured en closure, no se re-lee en cada llamada).
 *
 * Methods devueltos:
 *   - Level chips: debug/info/warn/error (mapeo equivalente al logger NDJSON pre-Phase-15, ya no expuesto).
 *   - Syntactic: ok (✓ + green), fail (✗ + red).
 *   - Raw color escape hatches: green/yellow/red/cyan/gray/dim.
 *   - Tabular: formatRow(cells, widths, opts?), formatTable(rows, opts?).
 *
 * Cuando `useColor=false` (no-TTY o NO_COLOR set), TODOS los helpers devuelven
 * la string de entrada SIN secuencias ANSI (golden bytes contract — base del
 * `--json` determinismo en Phase 15).
 *
 * @param {StreamLike} stream
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Formatter}
 */
export function createFormatter(stream, env = process.env) {
  const useColor = _resolveUseColor(stream, env);
  const pc = createColors(useColor);
  const sep = DEFAULT_SEPARATOR;

  /**
   * @param {string[]} cells
   * @param {number[]} widths
   * @param {{ separator?: string }} [opts]
   * @returns {string}
   */
  function formatRow(cells, widths, opts) {
    const s = (opts && opts.separator) || sep;
    const out = cells.map((c, i) => {
      const cell = String(c);
      const w = widths[i];
      if (w == null) return cell;
      return padCell(cell, w);
    });
    return out.join(s);
  }

  /**
   * @param {string[][]} rows
   * @param {{ separator?: string, header?: string[] }} [opts]
   * @returns {string}
   */
  function formatTable(rows, opts) {
    const s = (opts && opts.separator) || sep;
    const allRows = opts && opts.header ? [opts.header, ...rows] : rows;
    if (allRows.length === 0) return '';
    const cols = Math.max(...allRows.map((r) => r.length));
    /** @type {number[]} */
    const widths = [];
    for (let c = 0; c < cols; c++) {
      let max = 0;
      for (const r of allRows) {
        max = Math.max(max, visibleWidth(String(r[c] ?? '')));
      }
      widths.push(max);
    }
    return allRows.map((r) => formatRow(r, widths, { separator: s })).join('\n');
  }

  return {
    // Level chips (D-03, mapping mirrors el mapeo interno legacy del logger NDJSON pre-Phase-15).
    debug: (s) => pc.gray(s),
    info: (s) => pc.cyan(s),
    warn: (s) => pc.yellow(s),
    error: (s) => pc.red(s),
    // Syntactic con glyphs embebidos (D-03).
    ok: (s) => `${OK_SYMBOL} ${pc.green(s)}`,
    fail: (s) => `${FAIL_SYMBOL} ${pc.red(s)}`,
    // Raw color escape hatches (D-03 — needed by gsd-verify pass=green per DX-04).
    green: (s) => pc.green(s),
    yellow: (s) => pc.yellow(s),
    red: (s) => pc.red(s),
    cyan: (s) => pc.cyan(s),
    gray: (s) => pc.gray(s),
    dim: (s) => pc.dim(s),
    // Tabular (D-09).
    formatRow,
    formatTable,
  };
}
