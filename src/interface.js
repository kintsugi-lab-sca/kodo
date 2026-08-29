// @ts-check

/**
 * Provider-agnostic task data contracts for kodo v0.2.
 *
 * These typedefs define the canonical shapes that every TaskProvider adapter
 * must produce/consume. No runtime logic — only constants and JSDoc types.
 *
 * KODO-58: `assignees` es el 14º campo canónico. Es la ÚNICA señal del tablero que
 * distingue el trabajo de un operador del de otro sin inventar coordinación entre
 * máquinas, así que sube al contrato en vez de quedarse como extra de un provider.
 * Cada adapter emite los ids con los que SU provider identifica a una persona: UUIDs
 * de usuario en Plane, logins en GitHub. kodo NUNCA los interpreta — solo compara por
 * igualdad contra el id del dueño de la API key (ver src/operator.js).
 */

/**
 * @typedef {{
 *   id: string,
 *   ref: string,
 *   title: string,
 *   description: string,
 *   labels: string[],
 *   projectId: string,
 *   projectName: string,
 *   groups: string[],
 *   url: string,
 *   priority: 'urgent'|'high'|'medium'|'low'|'none'|null,
 *   assignees: string[],  // KODO-58: ids de los operadores asignados. REQUIRED (array, [] si nadie).
 *   state?: string,
 *   updated_at: string,    // D-01 Phase 28: REQUIRED ISO 8601 UTC string
 *   created_at: string,    // D-01 Phase 28: REQUIRED ISO 8601 UTC string
 * }} TaskItem
 */

/**
 * @typedef {{
 *   taskRef: string,
 *   action: string,
 *   provider: string,
 *   raw: object,
 * }} TriggerEvent
 */

/**
 * @typedef {{
 *   init: () => Promise<void>,
 *   getTask: (ref: string) => Promise<TaskItem>,
 *   updateTaskState: (task: TaskItem, stateName: string) => Promise<void>,
 *   addComment: (task: TaskItem, markdownText: string) => Promise<void>,
 *   listPendingTasks: () => Promise<TaskItem[]>,
 *   parseTriggerEvent: (rawPayload: object) => TriggerEvent|null,
 *   verifySignature: (rawBody: string, headers: object) => boolean,
 *   resolveRef: (humanRef: string) => Promise<string>,
 *   listProjects: () => Promise<Array<{id: string, identifier: string, name: string}>>,
 * }} TaskProvider
 */

/** @type {readonly string[]} */
export const TASK_PROVIDER_METHODS = Object.freeze([
  'init',
  'getTask',
  'updateTaskState',
  'addComment',
  'listPendingTasks',
  'parseTriggerEvent',
  'verifySignature',
  'resolveRef',
  'listProjects',
]);

/** @type {readonly string[]} */
export const VALID_PRIORITIES = Object.freeze([
  'urgent',
  'high',
  'medium',
  'low',
  'none',
]);
