// @ts-check
//
// Ficheros de prompt de sesión — uno por sessionId bajo `tmpdir()/kodo-prompts/`.
//
// buildClaudeCommand (manager.js) escribe el prompt aquí y el comando de lanzamiento
// solo lo referencia vía `"$(cat <path>)"`, en vez de teclear el prompt entero como
// keystrokes por `cmux send` (que interpreta \n/\r/\t como Enter/Tab y puede perder
// caracteres durante el init del shell del workspace). El stop hook borra el fichero
// cuando la sesión termina.
//
// Módulo sin dependencias de host/cmux/logger por diseño: escritor (manager.js) y
// borrador (hooks/stop.js) lo comparten sin acoplarse entre sí.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** @returns {string} directorio de los ficheros de prompt */
function promptDir() {
  return path.join(tmpdir(), 'kodo-prompts');
}

/**
 * Path absoluto del fichero de prompt de una sesión.
 *
 * @param {string} sessionId
 * @returns {string}
 */
export function promptFilePath(sessionId) {
  return path.join(promptDir(), `${sessionId}.txt`);
}

/**
 * Escribe el prompt de una sesión a su fichero temporal y devuelve el path.
 *
 * Un fichero por sessionId (UUID): únicos por sesión, sin clobber concurrente.
 * No se borra al leer — si el tecleo del comando falla y el operador lo
 * re-ejecuta a mano, el fichero sigue disponible. El stop hook lo limpia.
 *
 * @param {string} sessionId
 * @param {string} prompt
 * @returns {string} path absoluto al fichero de prompt
 */
export function writePromptFile(sessionId, prompt) {
  const dir = promptDir();
  mkdirSync(dir, { recursive: true });
  const file = promptFilePath(sessionId);
  writeFileSync(file, prompt, 'utf8');
  return file;
}

/**
 * Borra el fichero de prompt de una sesión. Fail-open: ausencia o error de
 * filesystem NUNCA propaga (el stop hook no debe crashear por esto).
 *
 * @param {string|undefined|null} sessionId
 * @param {import('../logger.js').Logger} [logger]
 */
export function removePromptFile(sessionId, logger) {
  if (!sessionId) return;
  try {
    rmSync(promptFilePath(sessionId), { force: true });
  } catch (err) {
    logger?.warn?.('prompt-file.remove.fail', {
      session_id: sessionId,
      error: String(/** @type {any} */ (err)?.message || err),
    });
  }
}
