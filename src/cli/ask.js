// @ts-check
//
// src/cli/ask.js — KODO-108: handler de `kodo ask "<pregunta>"`.
//
// Lo ejecuta la SESIÓN cuando necesita una respuesta del humano, además de preguntarlo en el
// chat. Deja la pregunta en `state.json` (`pending_question`) para que el dashboard la pinte en
// la fila, y la refleja en el sidebar del host vía `setDescription`. La respuesta sigue yendo
// en el chat; la pregunta se borra cuando el humano la envía (hook `UserPromptSubmit`, ver
// src/session/pending-question.js para el ciclo de vida completo).
//
// La sesión se resuelve con el MISMO mecanismo que `kodo audit` (`readGitFacts` +
// `resolveSession`, unique-or-null): una pregunta imputada a la sesión equivocada saldría en la
// fila de otra tarea, que es peor que no salir.
//
// Invariante de retorno (precedente `audit.js`): este handler NUNCA invoca el helper de salida
// del runtime — RETORNA el código.
//
// Exit codes (contrato del repo, `cli/exit-codes.js`):
//   0  la pregunta quedó persistida (el sidebar es cosmético: si falla se avisa y se sigue)
//   1  fuera de una sesión de kodo, o no se pudo persistir
//   2  pregunta vacía

import { readGitFacts, resolveSession } from './audit.js';
import { normalizeQuestion, setPendingQuestion, sidebarDescription } from '../session/pending-question.js';
import { EXIT_ERROR, EXIT_SUCCESS, EXIT_USAGE } from './exit-codes.js';

/**
 * @typedef {{
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   cwdFn?: () => string,
 *   loadStateFn?: () => any,
 *   setQuestionFn?: typeof setPendingQuestion,
 *   setDescriptionFn?: (opts: { workspace: string, description: string }) => Promise<unknown>,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   nowFn?: () => Date,
 * }} AskDeps
 */

/**
 * Mismo `gitFn` de producción que `cli/audit.js`: argumentos como array, sin shell.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function defaultGit(cwd, args) {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * `setDescription` del host ACTIVO. Import perezoso: el host arrastra su cliente y config, y el
 * camino de error (fuera de sesión) no debe pagarlo.
 *
 * @param {{ workspace: string, description: string }} opts
 */
async function defaultSetDescription(opts) {
  const { getHost, resolveHostName } = await import('../host/interface.js');
  return getHost(resolveHostName())._legacy.setDescription(opts);
}

/**
 * @param {string|string[]|null|undefined} question — commander entrega los args variádicos como array.
 * @param {AskDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runAskCli(question, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const raw = Array.isArray(question) ? question.join(' ') : question;
  const text = normalizeQuestion(raw);
  if (!text) {
    err('[kodo:ask] uso: kodo ask "<pregunta>" — la pregunta no puede estar vacía\n');
    return EXIT_USAGE;
  }

  const cwd = (deps.cwdFn || (() => process.cwd()))();
  const facts = await readGitFacts({ cwd, gitFn: deps.gitFn || defaultGit });
  const session = facts.project || facts.toplevel
    ? resolveSession({
      project: facts.project,
      toplevel: facts.toplevel,
      branch: facts.branch,
      ref: null,
      loadStateFn: deps.loadStateFn,
    })
    : null;
  if (!session) {
    err('[kodo:ask] este directorio no pertenece a ninguna sesión de kodo — `kodo ask` solo funciona dentro de una (pregunta en el chat)\n');
    return EXIT_ERROR;
  }

  const set = (deps.setQuestionFn || setPendingQuestion)(session.task_id, text, { now: deps.nowFn });
  if (!set.ok) {
    err(`[kodo:ask] no se pudo guardar la pregunta (${set.reason}) — sigue preguntando en el chat\n`);
    return EXIT_ERROR;
  }

  // Cosmético y fail-open: la pregunta ya está en el estado, que es lo que pinta el dashboard.
  if (session.workspace_ref) {
    try {
      await (deps.setDescriptionFn || defaultSetDescription)({
        workspace: session.workspace_ref,
        description: sidebarDescription(session, text),
      });
    } catch (e) {
      err(`[kodo:ask] la pregunta se guardó, pero el sidebar no se pudo actualizar (${String(/** @type {Error} */ (e)?.message || e).slice(0, 120)})\n`);
    }
  }

  write(`✓ ${session.task_ref}: pregunta registrada — visible en el dashboard hasta que respondan en el chat\n`);
  return EXIT_SUCCESS;
}
