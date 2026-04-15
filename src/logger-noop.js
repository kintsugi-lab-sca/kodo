// @ts-check
//
// No-op logger stub. MUST have zero imports (not even node: builtins, not
// relative files) so that src/check.js — o cualquier módulo en el camino del
// vigilante — puede importarlo sin arrastrar src/logger.js al grafo.
//
// Guardián runtime: test/check-isolation.test.js asserta que logger-noop.js
// no contiene imports.
//

/**
 * @typedef {{
 *   debug(msg: string, ctx?: object): void,
 *   info(msg: string, ctx?: object): void,
 *   warn(msg: string, ctx?: object): void,
 *   error(msg: string, ctx?: object): void,
 *   child(bindings: object): NoopLogger,
 * }} NoopLogger
 */

/** @type {NoopLogger} */
export const noopLogger = Object.freeze({
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() { return noopLogger; },
});
