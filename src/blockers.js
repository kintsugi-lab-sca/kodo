// @ts-check
//
// src/blockers.js — KODO-73. La regla de «esta tarea todavía no puede empezar», y NADA más.
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ─────────────────────────
// Mismo contrato que `src/operator.js` y `src/tasks/pending.js`. La razón es la misma:
// este módulo lo consume el dispatcher, y cualquier import arrastraría su grafo detrás.
// Todo lo que necesita la regla llega por parámetro.
//
// ── El problema ───────────────────────────────────────────────────────────────────
// kodo no tiene ningún concepto de dependencia entre tareas: lanza por prioridad y por
// slots libres. Una tarea con etiqueta `kodo` marcada como bloqueada EN EL TABLERO se
// lanzaba igual, y la sesión descubría el bloqueo a mitad de trabajo — o, peor, no lo
// descubría y construía sobre una base que aún no existe.
//
// No hace falta inventar un grafo de dependencias propio: el proveedor YA modela la
// relación (`blocked_by` en Plane). Basta con no lanzar lo que el tablero ya declara
// bloqueado. Esta es la versión mínima, y deliberadamente la única: sin contratos de
// interfaz entre tareas, sin squads, sin planificador.

/** Hay al menos un bloqueador en estado NO terminal: la tarea no arranca. */
export const SKIP_BLOCKED = 'blocked_by_open';

/**
 * El ÚNICO estado terminal del vocabulario normalizado de cinco literales
 * (`in_progress` | `in_review` | `blocked` | `done` | `unknown`).
 *
 * `unknown` NO es terminal, y eso es load-bearing, no un descuido: en Plane el grupo
 * `backlog` mapea a `unknown`, así que un bloqueador aún sin empezar caería del lado
 * «ya está resuelto» si `unknown` contara como cerrado — justo al revés de la verdad.
 * La regla es literalmente la del enunciado: bloqueadores en estado no terminal.
 */
const TERMINAL_STATE = 'done';

/**
 * @typedef {{ id?: string, ref?: string, state?: string }} Blocker
 */

/**
 * @typedef {{ blocked: false, code?: undefined, open?: undefined }
 *   | { blocked: true, code: 'blocked_by_open', open: Blocker[] }} BlockerVerdict
 */

/**
 * ¿Puede esta tarea empezar ya?
 *
 * FAIL-OPEN ante la ausencia de señal, a propósito y por el mismo motivo que
 * `assigneeVerdict`: `blockers` ausente / no-array significa «no lo sé» —el provider no
 * declara la capacidad, o la llamada falló—, y un fallo de red no puede dejar al daemon
 * sin lanzar NADA. El modo degradado correcto es el comportamiento anterior a KODO-73.
 *
 * FAIL-CLOSED, en cambio, cuando SÍ hay señal y es parcial: una relación `blocked_by`
 * cuyo estado no se reconoce cuenta como abierta. El tablero afirmó el bloqueo; no
 * poder demostrar que se resolvió no es lo mismo que que se haya resuelto.
 *
 * Comparación por igualdad EXACTA contra el literal terminal, nunca substring: los
 * estados llegan ya normalizados por el provider a un vocabulario cerrado, y un match
 * parcial haría pasar por cerrado cualquier estado que contuviera «done».
 *
 * @param {{ blockers?: any }} params
 * @returns {BlockerVerdict}
 */
export function blockerVerdict({ blockers }) {
  if (!Array.isArray(blockers)) return { blocked: false };

  const open = blockers.filter(
    (b) => b && typeof b === 'object' && b.state !== TERMINAL_STATE,
  );

  if (open.length === 0) return { blocked: false };
  return { blocked: true, code: SKIP_BLOCKED, open };
}

/**
 * Identidad estable del CONJUNTO de bloqueadores abiertos: sus refs, deduplicadas y
 * ordenadas. Dos lecturas del mismo bloqueo producen la misma firma aunque el provider
 * devuelva las relaciones en otro orden.
 *
 * Se usa para dos cosas distintas y ambas la quieren igual: el `detail` del veredicto
 * (lo que acaba en `dispatch.decision`) y la clave de dedup del comentario.
 *
 * @param {Blocker[]} [open]
 * @returns {string}
 */
export function blockerSignature(open) {
  const refs = (Array.isArray(open) ? open : [])
    .map((b) => b?.ref || b?.id)
    .filter((r) => typeof r === 'string' && r.length > 0);
  return [...new Set(refs)].sort().join(', ');
}

/**
 * El texto que se publica EN LA TAREA. Markdown/texto plano: `addComment` de cada
 * provider decide el envoltorio (Plane lo pasa por `toCommentHtml`, GitHub lo manda
 * literal), así que aquí no se emite HTML.
 *
 * Dice las tres cosas que el operador necesita para no tener que investigar: quién
 * bloquea, que no hay que hacer nada para desbloquear, y cómo forzarlo si aun así
 * quiere lanzarla.
 *
 * @param {string} taskRef
 * @param {Blocker[]} open
 * @returns {string}
 */
export function formatBlockedComment(taskRef, open) {
  const lines = (Array.isArray(open) ? open : []).map(
    (b) => `- ${b?.ref || b?.id || '(sin ref)'} — ${b?.state || 'estado desconocido'}`,
  );
  return [
    'kodo no ha lanzado sesión para esta tarea: el tablero la declara bloqueada.',
    '',
    'Bloqueadores abiertos:',
    ...lines,
    '',
    'En cuanto cierren, la tarea vuelve a ser elegible por el camino normal — no hay que tocar nada aquí.',
    `Para lanzarla igualmente: \`kodo launch ${taskRef} --force\`.`,
  ].join('\n');
}

// ───────────────────────────────────────────────────────────────────────────────────
// Dedup del aviso — estado DE PROCESO, no regla
// ───────────────────────────────────────────────────────────────────────────────────
//
// El polling revisita la misma tarea en cada tick. Sin dedup, una tarea bloqueada una
// semana acumula cientos de comentarios idénticos y el hilo deja de ser legible.
//
// Se recuerda la ÚLTIMA firma anunciada por tarea, no un simple «ya avisé»: si el
// conjunto de bloqueadores cambia (cierra uno de tres, aparece uno nuevo), eso SÍ es
// información nueva y merece comentario.
//
// En memoria del proceso, sin llamadas extra a la API. El coste asumido es que un
// reinicio del daemon repite el aviso UNA vez; releerlo del tablero costaría un
// `listComments` por lanzamiento para ahorrar un comentario cada varios días.

/** @type {Map<string, string>} task_id → última firma anunciada */
const announced = new Map();

/**
 * Techo del registro. Las entradas son una por tarea bloqueada VISTA por este proceso,
 * así que en la práctica son unidades; el cap solo existe para que un daemon de meses
 * no acumule memoria sin techo. Se poda por orden de inserción (`Map` lo conserva).
 */
const MAX_ANNOUNCED = 500;

/**
 * ¿Toca comentar este bloqueo? Devuelve `true` UNA vez por firma y la registra.
 *
 * @param {string} taskId
 * @param {string} signature
 * @returns {boolean}
 */
export function shouldAnnounceBlock(taskId, signature) {
  if (!taskId) return false;
  if (announced.get(taskId) === signature) return false;
  announced.set(taskId, signature);
  while (announced.size > MAX_ANNOUNCED) {
    const oldest = announced.keys().next().value;
    if (oldest === undefined) break;
    announced.delete(oldest);
  }
  return true;
}

/**
 * Olvida lo anunciado. Para la tarea concreta cuando deja de estar bloqueada —así un
 * bloqueo que reaparece se vuelve a anunciar— y entero en los tests.
 *
 * @param {string} [taskId] - sin argumento, limpia TODO el registro.
 */
export function forgetAnnouncedBlock(taskId) {
  if (taskId === undefined) announced.clear();
  else announced.delete(taskId);
}
