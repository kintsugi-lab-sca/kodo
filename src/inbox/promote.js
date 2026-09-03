// @ts-check
//
// src/inbox/promote.js — KODO-76.
//
// Orquestador never-throws de captura → TAREA del proveedor. Es la mitad de negocio de
// `kodo inbox promote`: el handler CLI (`src/cli/inbox.js`) solo resuelve dependencias, mapea el
// discriminante a un exit code y renderiza.
//
// Molde: `src/adopt.js#adoptSession` (Phase 53). Mismas propiedades y por las mismas razones —
// capability gate por `typeof`, taxonomía `{ok:false, code, detail}` cerrada, todo el I/O en un
// único sitio y ni un `throw` que salga de la función.
//
// ## Por qué NO es un `route --dest` mejorado
//
// `kodo inbox route <id> --dest <ref>` deja un puntero de TEXTO y nada más: kodo no valida la
// ref, no la resuelve y no la interpreta (D-09/D-11 de Phase 83). Ese seam documental sigue
// siendo el camino correcto cuando el destino es cualquier cosa —un documento, un mensaje, otra
// herramienta—. Lo que le faltaba al inbox era el ÚNICO destino que kodo sí conoce: su propio
// tablero. Aquí la ref no es opaca porque kodo acaba de crear lo que apunta.
//
// ## El orden importa: crear y LUEGO marcar
//
// El POST va antes que el marcado, y no al revés. Si el marcado falla con la tarea ya creada, el
// resultado es `MARK_FAILED`: ruidoso, con la ref en la mano, y el operador cierra la captura con
// `kodo inbox route <id> --dest <ref>` sin que se haya perdido nada. Al revés —marcar primero—
// un fallo del POST dejaría una captura cerrada apuntando a una tarea que no existe, que es la
// forma de inconsistencia que sí duele: la captura ya no está en la bandeja y nadie la echa de
// menos.

import { deriveHeadline } from './headline.js';
import { resolveProjectRef } from './project-ref.js';
import { listCaptures, markCapture } from './store.js';

/**
 * @typedef {{ ok: true, task: any, capture: any, projectId: string }
 *   | { ok: false, code: 'UNSUPPORTED' | 'NOT_FOUND' | 'ALREADY_CLOSED' | 'NO_PROJECT'
 *                      | 'AMBIGUOUS_PROJECT' | 'CREATE_FAILED' | 'MARK_FAILED', detail?: any }
 * } PromoteResult
 *
 * `MARK_FAILED` es el ÚNICO código que llega con la tarea ya creada: su `detail` lleva
 * `{ ref, url, reason }` para que el caller pueda decir exactamente qué existe y qué falta.
 */

/**
 * Convierte una captura abierta en una tarea del proveedor y la cierra como `enrutada` apuntando
 * a la ref de esa tarea.
 *
 * @param {object} args
 * @param {string} args.id Id corto de la captura.
 * @param {{ createTask?: Function }} args.provider Proveedor ya inicializado. El gate es por
 *   `typeof provider.createTask` — `createTask` es OPCIONAL en el contrato (no está en
 *   `TASK_PROVIDER_METHODS`, congelado en 9), así que un proveedor sin él no es un error de
 *   programación sino una capacidad ausente.
 * @param {Record<string, unknown>} args.projects Mapa de `loadProjects()`.
 * @param {string} [args.projectRef] Proyecto de destino explícito (tag o id). Sin él se usa el
 *   TAG de la propia captura — que es justo lo que `kodo inbox retag` sirve para corregir.
 * @param {string} args.inboxPath
 * @param {string} args.lockPath
 * @param {typeof listCaptures} [args.listFn]
 * @param {typeof markCapture} [args.markFn]
 * @returns {Promise<PromoteResult>}
 */
export async function promoteCapture({
  id,
  provider,
  projects,
  projectRef,
  inboxPath,
  lockPath,
  listFn = listCaptures,
  markFn = markCapture,
}) {
  // (a) Capability gate. Antes de leer nada: si el proveedor no sabe crear tareas, ninguna de las
  //     comprobaciones siguientes cambia el desenlace.
  if (!provider || typeof provider.createTask !== 'function') {
    return { ok: false, code: 'UNSUPPORTED' };
  }

  // (b) Localizar la captura. `listCaptures` es un leaf never-throws: un inbox ausente colapsa a
  //     lista vacía, que aquí es indistinguible de un id inexistente — y lo es de verdad.
  const { captures } = listFn({ inboxPath });
  const capture = captures.find((c) => c.id === id);
  if (!capture) return { ok: false, code: 'NOT_FOUND' };
  if (capture.open !== true) return { ok: false, code: 'ALREADY_CLOSED', detail: capture };

  // (c) Proyecto de destino. La ref explícita gana sobre el tag; el tag es el default porque es
  //     el que el operador ve en la lista, y sorprenderle con otro proyecto sería peor que fallar.
  const ref = typeof projectRef === 'string' && projectRef.trim() !== '' ? projectRef : capture.tag;
  const resolved = resolveProjectRef(ref, projects);
  if ('error' in resolved) {
    return resolved.error === 'ambiguous'
      ? { ok: false, code: 'AMBIGUOUS_PROJECT', detail: { ref, matches: resolved.matches } }
      : { ok: false, code: 'NO_PROJECT', detail: { ref } };
  }

  // (d) El POST. Único punto de red. Los errores del proveedor propagan LOUD hacia arriba (D-08
  //     de Phase 56) y aquí se colapsan a CREATE_FAILED con el mensaje original como `detail`.
  /** @type {any} */
  let task;
  try {
    task = await provider.createTask({
      projectId: resolved.projectId,
      title: deriveHeadline(capture.text),
      description: buildDescription(capture),
      // KODO-76: NUNCA el placement de adopción. Una idea del inbox es backlog, no trabajo en
      // curso — ver el comentario de `placement` en `providers/plane/provider.js`.
      placement: 'backlog',
    });
  } catch (err) {
    return { ok: false, code: 'CREATE_FAILED', detail: /** @type {any} */ (err)?.message ?? err };
  }

  const taskRef = typeof task?.ref === 'string' && task.ref !== '' ? task.ref : String(task?.id ?? '');

  // (e) Cierre de la captura. La tarea YA existe: un fallo aquí es degradado, no fatal (ver la
  //     cabecera). Se devuelve la ref para que el operador pueda cerrarla a mano.
  const marked = markFn(id, 'enrutada', { dest: taskRef, inboxPath, lockPath });
  if (marked.ok !== true) {
    return {
      ok: false,
      code: 'MARK_FAILED',
      detail: { ref: taskRef, url: task?.url ?? '', reason: marked.reason },
    };
  }

  return { ok: true, task, capture: marked.capture, projectId: resolved.projectId };
}

/**
 * Cuerpo de la tarea: el texto ÍNTEGRO de la captura más su procedencia.
 *
 * El texto va entero aunque el título ya sea su titular. El titular es un corte, y el valor de la
 * captura está justo en lo que el corte deja fuera — el diagnóstico, la medición, el paso a paso.
 *
 * La procedencia (fecha, origen, id) va al final y en una línea: es lo que permite volver del
 * tablero al inbox, y sin ella la traza es de un solo sentido.
 *
 * @param {{ text: string, date: string, origin: string, id: string }} capture
 * @returns {string}
 */
function buildDescription(capture) {
  const origin = capture.origin === '' ? 'desconocido' : capture.origin;
  return `${capture.text}\n\n—\nCapturado el ${capture.date} desde ${origin} · inbox ${capture.id}`;
}
