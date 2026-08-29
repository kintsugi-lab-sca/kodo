// @ts-check
//
// src/operator.js — KODO-58. La regla de elegibilidad por operador, y NADA más.
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ─────────────────────────
// Mismo contrato que `src/tasks/pending.js` y `src/logger-noop.js`. Razón dura:
// `src/check.js` importa de aquí, y cualquier import arrastraría su grafo al de
// `kodo check` — rompiendo LOG-12 (blindado por test/check-isolation). Todo lo que
// necesita la regla llega por parámetro.
//
// ── El problema ───────────────────────────────────────────────────────────────────
// Dos daemons de kodo (dos máquinas, dos operadores) apuntando a los mismos proyectos
// del provider reciben LOS MISMOS eventos: cada cambio de etiqueta o de estado lanzaba
// la sesión en las dos. `max_parallel` (KODO-55) y `state.json` no ayudan — son por
// máquina, y cada máquina cree tener el trabajo para ella sola.
//
// La única señal que YA distingue a un operador de otro en el tablero, sin inventar
// coordinación entre máquinas, es a quién está ASIGNADA la tarea. De ahí la regla:
// una tarea es de este daemon solo si sus `assignees` incluyen al usuario dueño de la
// API key con la que este daemon firma.

/** La tarea no tiene a nadie asignado: NADIE la lanza, y por eso no se duplica. */
export const SKIP_UNASSIGNED = 'unassigned';

/** La tarea está asignada, pero a otro operador: es de su daemon, no del nuestro. */
export const SKIP_ASSIGNED_TO_OTHER = 'assigned_to_other';

/**
 * @typedef {{ eligible: true, code?: undefined } | { eligible: false, code: 'unassigned'|'assigned_to_other' }} AssigneeVerdict
 */

/**
 * ¿Es esta tarea de este daemon?
 *
 * FAIL-OPEN en los dos ejes de desconocimiento, a propósito:
 *
 *   1. `requireAssignee === false` — el operador solitario que no quiere el filtro
 *      (`dispatch.require_assignee: false`) recupera el comportamiento anterior a
 *      KODO-58 exacto.
 *   2. `operatorId` ausente — NO sabemos quién somos (el `GET /users/me` falló, o el
 *      provider no expone identidad). Un fallo de red no puede dejar al daemon sin
 *      lanzar NADA; el modo degradado correcto es el de antes de esta tarea, no el
 *      silencio total. El coste del fail-open es el doble lanzamiento que ya existía.
 *
 * Lo que NO es fail-open: una tarea SIN asignado con identidad conocida. Ahí el
 * silencio es el objetivo — es justo lo que fuerza a asignar y lo que evita que las
 * dos máquinas se lancen a la vez sobre una tarea que nadie ha reclamado.
 *
 * Comparación por igualdad EXACTA de strings, nunca substring ni regex: los ids son
 * UUIDs (Plane) o logins (GitHub) controlados por el provider, y un match parcial
 * haría elegible la tarea de otro.
 *
 * @param {{ assignees?: any, operatorId?: string|null, requireAssignee?: boolean }} params
 * @returns {AssigneeVerdict}
 */
export function assigneeVerdict({ assignees, operatorId, requireAssignee = true }) {
  if (requireAssignee === false) return { eligible: true };
  if (!operatorId || typeof operatorId !== 'string') return { eligible: true };

  const ids = Array.isArray(assignees)
    ? assignees.filter((a) => typeof a === 'string' && a.length > 0)
    : [];

  if (ids.length === 0) return { eligible: false, code: SKIP_UNASSIGNED };
  if (ids.includes(operatorId)) return { eligible: true };
  return { eligible: false, code: SKIP_ASSIGNED_TO_OTHER };
}

/**
 * Hermano estructural de `excludeActiveTasks` (src/tasks/pending.js): deja pasar solo
 * las tareas que este daemon lanzaría de verdad, para que `kodo check` no cuente como
 * pendiente —ni despierte al orquestador por— trabajo de otro operador.
 *
 * Aplica la MISMA `assigneeVerdict` que el gate del dispatcher: una sola definición de
 * «esta tarea es mía», así que la lista de pendientes y lo que el dispatcher lanza no
 * pueden divergir.
 *
 * @template {{ assignees?: any }} T
 * @param {T[]} tasks
 * @param {{ operatorId?: string|null, requireAssignee?: boolean }} params
 * @returns {T[]}
 */
export function filterByOperator(tasks, { operatorId, requireAssignee = true }) {
  if (requireAssignee === false || !operatorId) return tasks;
  return (tasks || []).filter(
    (t) => assigneeVerdict({ assignees: t?.assignees, operatorId, requireAssignee }).eligible,
  );
}
