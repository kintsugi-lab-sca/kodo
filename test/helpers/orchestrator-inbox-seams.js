// @ts-check
//
// test/helpers/orchestrator-inbox-seams.js — KODO-53.
//
// LOS SEAMS DE AISLAMIENTO DE LA BANDEJA DEL ORQUESTADOR. Obligatorios en TODA invocación
// de `runSessionEndHook` que llegue al bloque de efectos de cierre, y NO son cosméticos:
// sin ellos el hook usa sus defaults reales, que son
//
//   · `enqueueOrchestratorEvent` → ESCRIBE en el `~/.kodo/state.json` del operador; y
//   · `maybeNotifyOrchestrator`  → lee la pantalla del orquestador vivo de la máquina y,
//                                  si está idle, le TECLEA un aviso en su terminal.
//
// La fuga se midió: la primera pasada de la suite con el carril cableado y sin estos stubs
// dejó 59 eventos falsos (`KL-end-1`, `KODO-26` — los fixtures sintéticos de las suites) en
// el `state.json` real. Misma clase que T-74-15 (`plansDir`/`stateWriterFn`) y que KODO-20
// (`getOrchestratorFn`), y el mismo remedio: el seam va en las deps BASE, no caso a caso —
// la hermeticidad no se decide por test.
//
// Vive en `test/helpers/` y no duplicado en cada fichero porque son CUATRO las suites que
// lo necesitan (session-end, session-end-handoff, session-end-integrate,
// stop-worktree-cleanup) y una copia por fichero es una copia que se olvida de actualizar.

/**
 * Stubs no-op de los dos seams de la bandeja. Se espera con `...ORCH_INBOX_SEAMS` dentro
 * del objeto de deps.
 *
 * Devuelven el discriminado con la forma REAL (`{ok:true, value}` / `{sent, reason}`) para
 * que un caso que sí quiera asertar sobre ellos pueda sustituirlos sin cambiar de contrato.
 */
export const ORCH_INBOX_SEAMS = Object.freeze({
  enqueueOrchestratorEventFn: () => ({
    ok: /** @type {const} */ (true),
    value: {
      id: 'stub0000',
      ts: '2026-01-01T00:00:00.000Z',
      kind: /** @type {const} */ ('session-end'),
      task_ref: '',
      session_id: null,
      text: '',
      seen: false,
      seen_at: null,
      notified_at: null,
    },
  }),
  maybeNotifyOrchestratorFn: async () => ({ sent: false, reason: /** @type {const} */ ('nothing-unseen') }),
});

/**
 * Variante que REGISTRA en `calls` lo que el hook encoló y si pidió avisar. Para los casos
 * que asertan sobre el carril nuevo en vez de solo aislarse de él.
 *
 * @param {Array<{fn: string, args?: any}>} calls
 * @param {{ notifyResult?: { sent: boolean, reason: string } }} [opts]
 */
export function recordingInboxSeams(calls, opts = {}) {
  return {
    enqueueOrchestratorEventFn: (input) => {
      calls.push({ fn: 'enqueue', args: input });
      return ORCH_INBOX_SEAMS.enqueueOrchestratorEventFn();
    },
    maybeNotifyOrchestratorFn: async (o) => {
      calls.push({ fn: 'maybeNotify', args: o });
      return opts.notifyResult || { sent: false, reason: 'nothing-unseen' };
    },
  };
}
