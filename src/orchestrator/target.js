// @ts-check
//
// src/orchestrator/target.js — KODO-16, segunda mitad.
//
// El registro de `state.orchestrator` arregló la pregunta «¿hay que lanzar un
// orquestador?» (launch.js). Quedaban dos consumidores más de la MISMA identidad, cada
// uno con su propio `match(/(workspace:\d+)\s+kodo-orchestrator/)` inline:
//   · session/manager.js — avisar al orquestador de que se lanzó una sesión;
//   · hooks/session-end.js — el nudge de cierre, el único nudge por-evento que la
//     Phase 73 conservó al retirar el de refresh.
// Los dos fallan por lo mismo: el título es mutable (arrancar el daemon desde la tab del
// orquestador la renombra) y `workspace list` es window-scoped. Y los dos fallan EN
// SILENCIO — su `catch {}` no distingue «no hay orquestador» de «hay uno y no lo he
// encontrado», así que el aviso simplemente no llega y nadie se entera.
//
// Este módulo es la resolución compartida. Deliberadamente NO revalida contra el host:
// vive en el camino caliente del launch y del cierre de sesión, donde una llamada extra
// a cmux se paga en cada evento. En vez de comprobar, ORDENA los candidatos y deja que
// el envío decida — un ref muerto hace fallar el send y se prueba el siguiente.
//
// Cero dependencias pesadas: solo state.js, que ambos consumidores ya importan.

import { getOrchestrator } from '../session/state.js';

/**
 * Candidatos a los que enviarle texto al orquestador, en orden de preferencia y sin
 * repetidos. Puro / never-throws.
 *
 * Orden: primero el ref REGISTRADO (sobrevive al rename y es window-independiente),
 * después el que salga del título en `workspace list`. Cuando coinciden, la lista trae
 * uno solo. Cuando el registro está stale y la tab con título existe, el fallback la
 * recupera; cuando no hay registro (orquestador previo al fix), queda el comportamiento
 * de siempre.
 *
 * @param {string|null|undefined} workspaceListText - salida cruda de `workspace list`.
 * @param {{ getOrchestratorFn?: () => { workspace_ref?: string }|null }} [deps]
 * @returns {string[]} refs `workspace:N`, sin duplicados. Vacío si no consta ninguno.
 */
export function resolveOrchestratorTargets(workspaceListText, deps = {}) {
  const getOrchestratorFn = deps.getOrchestratorFn || getOrchestrator;

  /** @type {string[]} */
  const out = [];

  let registered = null;
  try {
    registered = getOrchestratorFn()?.workspace_ref || null;
  } catch {
    /* never-throws: un registro ilegible solo significa «sin candidato registrado» */
  }
  if (registered) out.push(registered);

  if (typeof workspaceListText === 'string') {
    const m = workspaceListText.match(/(workspace:\d+)\s+kodo-orchestrator/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }

  return out;
}

/**
 * Envía `text` al primer candidato que acepte el envío. never-throws.
 *
 * @param {(opts: { workspace: string, text: string }) => Promise<any>} sendFn
 * @param {string[]} targets - salida de `resolveOrchestratorTargets`.
 * @param {string} text
 * @returns {Promise<string|null>} el ref al que se entregó, o `null` si ninguno aceptó.
 */
export async function sendToOrchestrator(sendFn, targets, text) {
  for (const workspace of targets) {
    try {
      await sendFn({ workspace, text });
      return workspace;
    } catch {
      // Ref muerto o cmux caído: se prueba el siguiente candidato. Que ninguno funcione
      // es un resultado válido (null) — el aviso al orquestador nunca bloquea a su caller.
    }
  }
  return null;
}
