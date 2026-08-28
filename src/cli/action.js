// @ts-check
//
// src/cli/action.js — envoltorios de handlers de commander (KODO-42).
//
// Hasta KODO-42, veinte handlers de `src/cli.js` repetían literalmente el mismo bloque:
//
//   try { ... process.exit(code); }
//   catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
//
// Aquí vive una sola vez. El handler declarado en `cli.js` se queda con lo suyo: importar
// su módulo y DEVOLVER el código; nunca termina el proceso por su cuenta.
//
// DOS envoltorios, no uno, porque el repo tiene dos carriles de salida deliberados:
//
//   - exitWithCode  → `process.exit(code)`: termina en cuanto el handler resuelve.
//   - setExitCode   → `process.exitCode = code`: FIJA el código y deja que el runtime
//     termine solo, cuando el event loop se vacía. Es el carril del bloque del inbox
//     (`capture`, `inbox`, `inbox route|discard`, `inbox-orch`, `integrate`) y del writer
//     de `config`: con la salida canalizada las escrituras a stdout son ASÍNCRONAS, y
//     terminar el proceso inmediatamente tras escribir aborta el buffer pendiente y
//     entrega exactamente 65536 bytes — JSON truncado en el carril que se anuncia como
//     scriptable (Plan 83-05 / GAP-2 / CR-01). Elegir mal el envoltorio reintroduce ese bug.

import { EXIT_ERROR } from './exit-codes.js';

/**
 * Envuelve un handler que resuelve a un exit code y TERMINA el proceso con él.
 * Un throw del handler se reporta como `Error: <mensaje>` y sale con EXIT_ERROR.
 *
 * @param {(...args: any[]) => Promise<number> | number} fn
 * @returns {(...args: any[]) => Promise<void>}
 */
export function exitWithCode(fn) {
  return async (...args) => {
    try {
      process.exit(await fn(...args));
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(EXIT_ERROR);
    }
  };
}

/**
 * Envuelve un handler que resuelve a un exit code y solo lo FIJA: el proceso termina
 * cuando el event loop se vacía, de modo que stdout drena entero (ver cabecera).
 *
 * @param {(...args: any[]) => Promise<number> | number} fn
 * @returns {(...args: any[]) => Promise<void>}
 */
export function setExitCode(fn) {
  return async (...args) => {
    try {
      process.exitCode = await fn(...args);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = EXIT_ERROR;
    }
  };
}
