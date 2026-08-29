// @ts-check
//
// test/helpers/orchestrator-inbox-seams.js — KODO-53.
//
// LOS SEAMS DE AISLAMIENTO DE LA BANDEJA DEL ORQUESTADOR. Obligatorios en TODA invocación
// de `runSessionEndHook` que llegue al bloque de efectos de cierre, y NO son cosméticos:
// sin ellos el hook usa sus defaults reales, que son
//
//   · `enqueueOrchestratorEvent` → ESCRIBE en el `~/.kodo/state.json` del operador;
//   · `maybeNotifyOrchestrator`  → lee la pantalla del orquestador vivo de la máquina y,
//                                  si está idle, le TECLEA un aviso en su terminal; y
//   · el `provider` perezoso      → instancia el provider REAL y SALE A LA RED contra la
//                                  instancia de producción, autenticado (KODO-57, ver
//                                  `offlineProvider` más abajo).
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
 * Provider OFFLINE — KODO-57. El tercer escape del mismo hook, y el que salía de la máquina.
 *
 * `runSessionEndHook` resuelve `deps.provider` de forma perezosa contra el registry REAL
 * (src/hooks/session-end.js:304-311) cuando no se le inyecta uno. Sin este seam, el review
 * backstop instanciaba el provider Plane de verdad: `DEFAULT_CONFIG` apunta a la instancia
 * de producción del operador (`https://tasks.kintsugi-lab.com`, workspace `k-lab`,
 * src/config.js:78), así que `getTaskState` disparaba un PATCH/GET REAL contra Plane —
 * autenticado, porque `loadEnvFile` deja la `PLANE_API_KEY` del `~/.kodo/.env` en
 * `process.env`. Medido durante `npm test`: peticiones a
 * `.../work-items/kodo-end-1/`, `.../kodo-test-stop-idem-1/` y `.../task-1/`.
 *
 * El stub tiene los 3 métodos que el backstop exige (`getTaskState`/`updateTaskState`/
 * `addComment`, session-end.js:777-783) y `getTaskState` RECHAZA a propósito: reproduce
 * exactamente el camino que ya recorría la suite —entrar al backstop, fallar al leer el
 * estado, `log.warn('session.backstop.getstate_failed')` y salir fail-open (:808-814)—
 * pero sin red y sin credenciales. Un provider ausente (`null`) también sería no-op, pero
 * saltándose el backstop entero: cubriría menos código del que se cubre hoy.
 */
const offlineProvider = Object.freeze({
  getTaskState: async () => {
    throw new Error('provider offline (stub de test): ningún test debe salir a la red');
  },
  updateTaskState: async () => {
    throw new Error('provider offline (stub de test): ningún test debe salir a la red');
  },
  addComment: async () => {
    throw new Error('provider offline (stub de test): ningún test debe salir a la red');
  },
});

/**
 * Stubs no-op de los dos seams de la bandeja, MÁS el provider offline. Se espera con
 * `...ORCH_INBOX_SEAMS` dentro del objeto de deps.
 *
 * Los de la bandeja devuelven el discriminado con la forma REAL (`{ok:true, value}` /
 * `{sent, reason}`) para que un caso que sí quiera asertar sobre ellos pueda sustituirlos
 * sin cambiar de contrato. `provider`/`config` van aquí por la misma razón que el resto:
 * la hermeticidad se decide una vez, en las deps base, no caso a caso. Un test que quiera
 * su propio provider lo pone DESPUÉS del spread y gana.
 */
export const ORCH_INBOX_SEAMS = Object.freeze({
  provider: offlineProvider,
  // Config mínimo: corta el `loadConfig()` real del mismo bloque perezoso. El backstop no
  // lo consulta antes de `getTaskState`, así que basta con que exista.
  config: Object.freeze({ provider: 'test', providers: Object.freeze({}) }),
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
    // KODO-57: el seam del provider viaja también por esta variante — si no, los casos
    // que graban la bandeja perdían la hermeticidad de red que gana el resto.
    provider: ORCH_INBOX_SEAMS.provider,
    config: ORCH_INBOX_SEAMS.config,
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
