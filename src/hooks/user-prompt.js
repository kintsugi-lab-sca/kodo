#!/usr/bin/env node
// @ts-check
//
// Claude Code UserPromptSubmit hook for kodo — KODO-108.
//
// Un único trabajo: cuando el humano envía un prompt a una sesión que tenía una pregunta
// pendiente (`kodo ask`), la sesión vuelve a trabajar y la pregunta deja de estar pendiente —
// se borra de `state.json` y el sidebar recupera su descripción «⬢ <ref> · <título>».
//
// POR QUÉ ESTE HOOK Y NO STOP: Stop dispara al final del MISMO turno en que la sesión ejecutó
// `kodo ask`; limpiar ahí borraría la pregunta en el instante en que se hace. UserPromptSubmit
// es la única señal del ciclo que significa «el humano respondió».
//
// STDOUT VACÍO, SIEMPRE: lo que un hook UserPromptSubmit imprime en stdout Claude Code lo
// añade como contexto al prompt. Este hook no tiene nada que decirle al modelo.
//
// Barato y fail-open: corre en CADA prompt de CADA sesión de Claude Code de la máquina. La
// inmensa mayoría no son de kodo o no tienen pregunta, y salen tras una lectura de
// `state.json` sin lock y sin escribir nada. Nunca lanza, siempre sale con 0.

import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { clearPendingQuestion, sidebarDescription } from '../session/pending-question.js';

const STDIN_TIMEOUT = 3000;

async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}

/**
 * `setDescription` del host ACTIVO, importado solo cuando hay algo que restaurar.
 *
 * @param {{ workspace: string, description: string }} opts
 */
async function defaultSetDescription(opts) {
  const { getHost, resolveHostName } = await import('../host/interface.js');
  return getHost(resolveHostName())._legacy.setDescription(opts);
}

/**
 * @param {{ session_id?: string }} input — input crudo del hook.
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   clearQuestionFn?: typeof clearPendingQuestion,
 *   setDescriptionFn?: (opts: { workspace: string, description: string }) => Promise<unknown>,
 * }} [deps]
 * @returns {Promise<{ cleared: boolean }>}
 */
export async function runUserPromptHook(input, deps = {}) {
  try {
    // Lookup por IDENTIDAD, sin fallback por cwd (KODO-27): es camino de escritura, y un
    // prompt del orquestador en la raíz del repo no debe borrar la pregunta de una sesión.
    const sessionId = input?.session_id;
    if (!sessionId) return { cleared: false };
    const result = (deps.findSessionFn || findSession)({ sessionId });
    if (!result || result.source !== 'sessions' || !result.session.pending_question) {
      return { cleared: false };
    }
    const { session } = result;

    const r = (deps.clearQuestionFn || clearPendingQuestion)(result.id);
    if (!r.ok || !r.cleared) return { cleared: false };

    if (session.workspace_ref) {
      try {
        await (deps.setDescriptionFn || defaultSetDescription)({
          workspace: session.workspace_ref,
          description: sidebarDescription(session, null),
        });
      } catch { /* cosmético — el estado ya está limpio, que es lo que pinta el dashboard */ }
    }
    return { cleared: true };
  } catch (err) {
    console.error(`[kodo] UserPromptSubmit hook error: ${/** @type {Error} */ (err)?.message}`);
    return { cleared: false };
  }
}

async function main() {
  let input = {};
  try {
    input = JSON.parse(await readStdin());
  } catch { /* input ilegible → no-op */ }
  await runUserPromptHook(input);
  process.exit(0);
}

// Only run main() when invoked as CLI (not when imported for testing)
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainEntry) {
  main();
}
