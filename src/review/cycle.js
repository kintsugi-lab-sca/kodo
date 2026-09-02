// @ts-check
//
// src/review/cycle.js — KODO-75: el BUCLE coder ↔ reviewer, con tope y con salida.
//
// EL FALLO DEL MODELO ORIGINAL QUE ESTE MÓDULO ARREGLA. En swarm-forge el bucle coder ↔
// reviewer no tiene tope: el reviewer decide cuándo está satisfecho y nada impide que pida
// cambios indefinidamente. Dos agentes pueden sostener esa conversación durante horas sin
// converger y sin que nadie se entere — y cada vuelta cuesta dinero. Aquí hay un máximo y una
// ESCALADA al operador, y la regla que gobierna el módulo entero es:
//
//   el bucle termina por aprobación o por tope de rondas con escalada. NUNCA en silencio.
//
// «Nunca en silencio» es literal y tiene tres caras, las tres implementadas en
// `deriveCycleDisposition`:
//   - un reviewer que cierra SIN escribir artefacto no es una aprobación tácita: escala;
//   - un artefacto que no se entiende no es una aprobación: escala;
//   - agotar el tope no deja la tarea parada esperando a que alguien mire: escala.
//
// CLAVE ADITIVA `state.review_cycles` (objeto keyed por task_id), mismo idiom que `tasks`
// (Phase 74 D-05), `orchestrator` (KODO-16), `integration_queue` (KODO-26) y
// `orchestrator_inbox` (KODO-53): SIN bump de `schema_version`, y todo lector usa el guard
// defensivo — un state.json previo a KODO-75 se lee como «cero ciclos».
//
// POR QUÉ KEYED POR `task_id` Y NO POR (project_path, branch). La cola de integración se
// keyea por rama porque una entrada de cola es un hecho de la RAMA. Un ciclo de revisión no:
// es la conversación sobre un WORK ITEM, la misma que el operador etiquetó con `kodo:review`,
// y es la que hay que escalarle si no converge. La rama se guarda dentro de la fila porque el
// núcleo la necesita para leer los artefactos, no porque sea la identidad.
//
// INVARIANTES:
//   - TODA escritura pasa por `withStateLock` (invariante cross-milestone, STATE.md:171).
//     Este módulo NUNCA hace `saveState` por su cuenta.
//   - Un ciclo NO SE BORRA al cerrarse: transiciona a `approved` o `escalated`. La traza ES
//     el feature, igual que en la cola de integración y en las dos bandejas.
//   - `deriveCycleDisposition` es PURA y TOTAL: cero I/O, y ninguna combinación de entradas
//     cae por un hueco sin decisión. Es la función que hace auditable el bucle.
//   - Este módulo NO importa `logger.js` (lo recibe por parámetro, default noop) ni habla con
//     git: el estado de revisión se lo pasan ya derivado desde `review/artifacts.js`.

import { noopLogger } from '../logger-noop.js';
import { loadState, withStateLock } from '../session/state.js';
import { enqueueOrchestratorEvent } from '../orchestrator/inbox.js';

/**
 * Tope de rondas por defecto.
 *
 * TRES, y el número tiene razón. Una ronda es lo normal (el reviewer encuentra cosas, el
 * coder las cierra). Dos pasa cuando el arreglo de la primera abre algo nuevo. A la tercera
 * sin converger, el problema ya no es el código: es que los dos agentes no están de acuerdo
 * sobre qué hay que hacer, y eso lo desempata un humano más barato y mejor que una cuarta
 * vuelta. El operador puede subirlo con `review.max_rounds` en la config.
 */
export const DEFAULT_MAX_ROUNDS = 3;

/**
 * @typedef {{
 *   task_id: string,               // Identidad del ciclo. Un work item, un ciclo de revisión.
 *   task_ref: string,              // Referencia humana ("KODO-75"), para el listado y la escalada.
 *   project_path: string,          // Repo donde vive la rama.
 *   branch: string,                // Rama revisada. Dónde leer los artefactos, no la identidad.
 *   round: number,                 // Rondas de recomendaciones escritas. DERIVADO de los artefactos.
 *   max_rounds: number,            // Tope vigente cuando se abrió el ciclo (congelado: subirlo a mitad no debe reabrir un ciclo ya escalado).
 *   status: 'pending'|'approved'|'escalated',
 *   last_state: string|null,       // El `ReviewState.state` de la última evaluación. Diagnóstico.
 *   reviewed_head: string|null,    // Ancla de la última evaluación (ver review/artifacts.js).
 *   created_at: string,            // ISO 8601 de la apertura.
 *   updated_at: string,            // ISO 8601 de la última evaluación.
 *   resolved_at: string|null,      // ISO 8601 del cierre (aprobación o escalada). null mientras pending.
 *   escalation_reason: string|null,// Por qué se escaló. null si no se escaló.
 * }} ReviewCycle
 *
 * @typedef {'approve'|'relaunch-reviewer'|'relaunch-coder'|'escalate'} CycleAction
 * @typedef {{ action: 'approve' }
 *          | { action: 'relaunch-reviewer', round: number }
 *          | { action: 'relaunch-coder', round: number }
 *          | { action: 'escalate', reason: 'max-rounds'|'no-artifact'|'malformed-artifact' }} CycleDisposition
 */

/**
 * Tope de rondas vigente según la config, con el default como suelo.
 *
 * Un `max_rounds` de 0 o negativo se ignora y cae al default: «cero rondas de revisión» no es
 * una configuración, es desactivar la feature, y para eso está no poner la etiqueta.
 *
 * @param {{ review?: { max_rounds?: number } }} [config]
 * @returns {number}
 */
export function resolveMaxRounds(config) {
  const n = Number(config?.review?.max_rounds);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_ROUNDS;
}

/**
 * Decide QUÉ HACER a partir del estado de revisión leído del repo. PURA y TOTAL.
 *
 * Es el núcleo determinista del bucle: recibe un `ReviewState` que salió de leer ficheros y
 * git —nunca de preguntarle a un modelo— y devuelve una acción. Que sea pura es lo que
 * permite congelar el contrato entero en tests sin tocar disco, y que sea total es lo que
 * garantiza el «nunca en silencio»: no hay entrada que salga por un hueco sin decisión.
 *
 * `phase` dice quién acaba de cerrar, y es imprescindible: la ausencia de artefactos significa
 * cosas OPUESTAS según quién haya trabajado. Tras el coder es lo normal (aún no ha revisado
 * nadie) y toca lanzar al reviewer; tras el reviewer es un fallo (cerró sin dejar nada) y toca
 * escalar. Sin este parámetro, un reviewer mudo se leería como «todavía no ha revisado nadie»
 * y el bucle lo relanzaría para siempre.
 *
 * @param {{
 *   reviewState: import('./artifacts.js').ReviewState,
 *   phase: 'post-coder'|'post-reviewer',
 *   maxRounds?: number,
 * }} params
 * @returns {CycleDisposition}
 */
export function deriveCycleDisposition(params) {
  const maxRounds = Number.isInteger(params?.maxRounds) && /** @type {number} */ (params.maxRounds) > 0
    ? /** @type {number} */ (params.maxRounds)
    : DEFAULT_MAX_ROUNDS;
  const rs = params?.reviewState;
  const round = Number.isInteger(/** @type {any} */ (rs)?.round) ? /** @type {any} */ (rs).round : 0;

  // Una aprobación anclada al código actual cierra el ciclo venga de donde venga. Es el único
  // final feliz, y no depende de la fase: si el coder cierra y la aprobación sigue cubriendo
  // su código, es que no cambió nada revisable.
  if (rs?.state === 'approved') return { action: 'approve' };

  // Un artefacto ilegible NO es una aprobación ni una petición de cambios: es un fallo del
  // ciclo, y el fail-closed manda escalarlo en vez de adivinar cuál de los dos era.
  if (rs?.state === 'malformed') return { action: 'escalate', reason: 'malformed-artifact' };

  if (params.phase === 'post-coder') {
    // El coder cerró. Falta revisar — salvo que el tope ya esté agotado, en cuyo caso lanzar
    // otro reviewer sería empezar la vuelta que este módulo existe para no dar.
    if (round >= maxRounds) return { action: 'escalate', reason: 'max-rounds' };
    return { action: 'relaunch-reviewer', round };
  }

  // phase === 'post-reviewer'
  switch (rs?.state) {
    case 'changes-requested':
      // Hay trabajo pendiente. Si esta ronda ya es la del tope, el bucle se acaba aquí: el
      // operador recibe las recomendaciones y decide, en vez de pagar otra vuelta.
      if (round >= maxRounds) return { action: 'escalate', reason: 'max-rounds' };
      return { action: 'relaunch-coder', round };
    case 'stale-approval':
      // Aprobó, pero el código se movió después. Toca revisar lo nuevo — con el mismo tope.
      if (round >= maxRounds) return { action: 'escalate', reason: 'max-rounds' };
      return { action: 'relaunch-reviewer', round };
    default:
      // 'none' — el reviewer cerró SIN escribir nada. Ni aprobó ni pidió cambios. Tratarlo
      // como aprobación sería exactamente el juez-que-se-evalúa-a-sí-mismo que este milestone
      // elimina; relanzarlo sería un bucle mudo. Escala.
      return { action: 'escalate', reason: 'no-artifact' };
  }
}

/**
 * Lectura defensiva del bloque de ciclos.
 * @param {any} state
 * @returns {Record<string, ReviewCycle>}
 */
function cyclesOf(state) {
  const c = state?.review_cycles;
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
}

/**
 * Abre (o REFRESCA) el ciclo de revisión de una tarea.
 *
 * Idempotente por `task_id`: un segundo cierre de sesión sobre la misma tarea no crea otro
 * ciclo, refresca el existente conservando `created_at` (la edad del ciclo, que es lo que el
 * operador quiere ver) y `max_rounds` (congelado a propósito — ver el typedef).
 *
 * Un ciclo YA CERRADO (`approved`/`escalated`) sí se REABRE si vuelve a haber trabajo: la
 * rama que acumula commits después de una aprobación necesita otra mirada, y ese es
 * precisamente el caso `stale-approval`. Reabrir preserva `round`, así que el tope sigue
 * contando desde donde estaba y no se regala una ronda gratis por reabrir.
 *
 * @param {{ task_id: string, task_ref: string, project_path: string, branch: string, max_rounds?: number }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: ReviewCycle } | { ok: false, reason: 'lock-timeout'|'missing-task-id' }}
 */
export function openReviewCycle(input, logger = noopLogger, deps = {}) {
  if (!input?.task_id) return { ok: false, reason: 'missing-task-id' };
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {ReviewCycle|undefined} */
  let persisted;

  const r = withStateLock((state) => {
    const s = /** @type {any} */ (state);
    if (!s.review_cycles || typeof s.review_cycles !== 'object' || Array.isArray(s.review_cycles)) {
      s.review_cycles = {};
    }
    const prev = s.review_cycles[input.task_id];
    persisted = {
      task_id: input.task_id,
      task_ref: input.task_ref ?? prev?.task_ref ?? '',
      project_path: input.project_path ?? prev?.project_path ?? '',
      branch: input.branch ?? prev?.branch ?? '',
      round: prev?.round ?? 0,
      max_rounds: prev?.max_rounds ?? (Number.isInteger(input.max_rounds) && /** @type {number} */ (input.max_rounds) > 0
        ? /** @type {number} */ (input.max_rounds)
        : DEFAULT_MAX_ROUNDS),
      status: 'pending',
      last_state: prev?.last_state ?? null,
      reviewed_head: prev?.reviewed_head ?? null,
      created_at: prev?.created_at ?? ts,
      updated_at: ts,
      resolved_at: null,
      escalation_reason: null,
    };
    s.review_cycles[input.task_id] = persisted;
  });

  if (!r.ok) {
    logger.warn('review.cycle.open_failed', { task_id: input.task_id, reason: r.reason });
    return r;
  }
  logger.info('review.cycle.opened', {
    task_id: input.task_id,
    task_ref: /** @type {ReviewCycle} */ (persisted).task_ref,
    max_rounds: /** @type {ReviewCycle} */ (persisted).max_rounds,
  });
  return { ok: true, value: /** @type {ReviewCycle} */ (persisted) };
}

/**
 * Registra el resultado de una evaluación y APLICA su disposición al ciclo.
 *
 * Es el único escritor del veredicto: recibe el `ReviewState` ya derivado del repo, llama a
 * `deriveCycleDisposition` (pura) y persiste el resultado. La escalada, cuando toca, se
 * encola en la BANDEJA del orquestador — que es el sitio donde el operador ya mira en cada
 * ronda, y por tanto lo contrario de «en silencio».
 *
 * FAIL-OPEN sobre la bandeja: si encolar el evento falla, el ciclo YA quedó marcado
 * `escalated` en state.json. Se prefiere una escalada visible en el estado sin aviso, a una
 * escritura de estado abortada por un fallo de la bandeja.
 *
 * @param {{
 *   task_id: string,
 *   reviewState: import('./artifacts.js').ReviewState,
 *   phase: 'post-coder'|'post-reviewer',
 * }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date, enqueueFn?: typeof enqueueOrchestratorEvent }} [deps]
 * @returns {{ ok: true, value: { cycle: ReviewCycle, disposition: CycleDisposition } }
 *          | { ok: false, reason: 'lock-timeout'|'missing-task-id'|'not-found' }}
 */
export function recordReviewOutcome(input, logger = noopLogger, deps = {}) {
  if (!input?.task_id) return { ok: false, reason: 'missing-task-id' };
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {ReviewCycle|undefined} */
  let persisted;
  /** @type {CycleDisposition|undefined} */
  let disposition;
  let found = false;

  const r = withStateLock((state) => {
    const cycles = cyclesOf(state);
    const cycle = cycles[input.task_id];
    if (!cycle) return;
    found = true;

    disposition = deriveCycleDisposition({
      reviewState: input.reviewState,
      phase: input.phase,
      maxRounds: cycle.max_rounds,
    });

    // `round` es DERIVADO del repo, no un contador que este módulo incrementa. Si alguien
    // borra una ronda a mano, el estado del ciclo sigue a los ficheros y no a una cuenta
    // paralela que ya nadie podría auditar.
    const rs = /** @type {any} */ (input.reviewState);
    if (Number.isInteger(rs?.round)) cycle.round = rs.round;
    cycle.last_state = rs?.state ?? null;
    cycle.reviewed_head = rs?.reviewed_head ?? cycle.reviewed_head ?? null;
    cycle.updated_at = ts;

    if (disposition.action === 'approve') {
      cycle.status = 'approved';
      cycle.resolved_at = ts;
      cycle.escalation_reason = null;
    } else if (disposition.action === 'escalate') {
      cycle.status = 'escalated';
      cycle.resolved_at = ts;
      cycle.escalation_reason = disposition.reason;
    } else {
      cycle.status = 'pending';
      cycle.resolved_at = null;
      cycle.escalation_reason = null;
    }
    persisted = cycle;
  });

  if (!r.ok) {
    logger.warn('review.cycle.record_failed', { task_id: input.task_id, reason: r.reason });
    return r;
  }
  if (!found) return { ok: false, reason: 'not-found' };

  const cycle = /** @type {ReviewCycle} */ (persisted);
  const d = /** @type {CycleDisposition} */ (disposition);

  logger.info('review.cycle.evaluated', {
    task_id: cycle.task_id,
    task_ref: cycle.task_ref,
    phase: input.phase,
    review_state: cycle.last_state,
    round: cycle.round,
    max_rounds: cycle.max_rounds,
    action: d.action,
    reason: d.action === 'escalate' ? d.reason : null,
  });

  if (d.action === 'escalate') {
    try {
      const enqueueFn = deps.enqueueFn || enqueueOrchestratorEvent;
      enqueueFn(
        {
          kind: 'review-escalated',
          task_ref: cycle.task_ref,
          session_id: null,
          text: buildEscalationText(cycle, d.reason),
        },
        logger,
      );
    } catch {
      /* fail-open: el ciclo ya está marcado `escalated` en state.json (ver docblock) */
    }
  }

  return { ok: true, value: { cycle, disposition: d } };
}

/**
 * Texto de la escalada que lee el orquestador en su ronda. PURA.
 *
 * Dice las tres cosas que el operador necesita para decidir sin abrir nada: qué pasó, dónde
 * mirar, y qué se le está pidiendo. Sin la ruta del artefacto la escalada obligaría a buscar,
 * y una escalada que da trabajo extra se ignora.
 *
 * @param {ReviewCycle} cycle
 * @param {'max-rounds'|'no-artifact'|'malformed-artifact'} reason
 * @returns {string}
 */
export function buildEscalationText(cycle, reason) {
  const where = `${cycle.project_path || '<repo>'} · rama ${cycle.branch || '<rama>'}`;
  switch (reason) {
    case 'max-rounds':
      return (
        `Revisión de ${cycle.task_ref}: tope de ${cycle.max_rounds} rondas agotado sin aprobación ` +
        `(${where}). Las recomendaciones vivas están en review/recommendations/. ` +
        `Decide tú: cerrar los puntos a mano, aceptar la rama como está, o subir review.max_rounds.`
      );
    case 'no-artifact':
      return (
        `Revisión de ${cycle.task_ref}: la sesión de revisión cerró SIN escribir artefacto ` +
        `(${where}). No hay aprobación ni recomendaciones — no cuenta como revisada. ` +
        `Relanza la revisión o revisa la rama a mano.`
      );
    case 'malformed-artifact':
      return (
        `Revisión de ${cycle.task_ref}: el artefacto de revisión no se puede leer ` +
        `(${where}). Falta el \`commit:\` del frontmatter o no es un SHA. ` +
        `Arregla review/approval.md o relanza la revisión.`
      );
  }
}

/**
 * Lee el ciclo de una tarea. Pure read — never-throws.
 * @param {string} taskId
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {ReviewCycle|null}
 */
export function getReviewCycle(taskId, deps = {}) {
  try {
    const load = deps.loadStateFn || loadState;
    return cyclesOf(load())[taskId] ?? null;
  } catch {
    return null;
  }
}

/**
 * Encuentra el ciclo ABIERTO de una rama. Pure read — never-throws.
 *
 * Existe por el cierre del reviewer (review PR #4, hallazgo ALTA): `kodo review commit` corre
 * DENTRO del worktree de revisión, donde lo único que se sabe con certeza es la rama —
 * `git branch --show-current`—, no el `task_id`. Sin este lookup, `recordReviewOutcome` no
 * tenía forma de ser llamado desde el único sitio donde el artefacto acaba de existir, y el
 * tope de rondas quedaba implementado pero sin disparar nunca.
 *
 * Solo devuelve ciclos `pending`: uno ya aprobado o escalado no debe reabrirse por un commit
 * de artefactos tardío. Ante dos ciclos abiertos sobre la misma rama —que no debería ocurrir,
 * porque git impide dos worktrees sobre una rama— gana el más reciente por `updated_at`.
 *
 * @param {string} branch
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {ReviewCycle|null}
 */
export function findOpenCycleByBranch(branch, deps = {}) {
  if (typeof branch !== 'string' || branch === '') return null;
  let all;
  try {
    const load = deps.loadStateFn || loadState;
    all = Object.values(cyclesOf(load()));
  } catch {
    return null;
  }
  const hits = all.filter((c) => c && c.branch === branch && c.status === 'pending');
  if (hits.length === 0) return null;
  return hits.sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))[0];
}

/**
 * Lista los ciclos. Pure read — never-throws.
 * @param {{ all?: boolean }} [opts] `all: true` incluye los cerrados (la traza). Default: solo `pending` y `escalated` — los que piden algo de alguien.
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {ReviewCycle[]}
 */
export function listReviewCycles(opts = {}, deps = {}) {
  let all;
  try {
    const load = deps.loadStateFn || loadState;
    all = Object.values(cyclesOf(load()));
  } catch {
    return [];
  }
  if (opts.all === true) return all;
  // Los `escalated` se listan por defecto A PROPÓSITO: una escalada que hay que pedir con un
  // flag es una escalada que nadie ve, y eso es justo el silencio que el módulo prohíbe.
  return all.filter((c) => c && c.status !== 'approved');
}
