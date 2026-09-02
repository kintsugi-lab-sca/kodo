// @ts-check

/**
 * Parse kodo labels from a work item's label data.
 * Labels can arrive as:
 * - Array of objects with .name: [{name: "kodo"}, {name: "kodo:opus"}]
 * - Array of strings (IDs): ["uuid1", "uuid2"] — needs resolution
 *
 * @param {Array<any>} labels
 * @returns {{ isKodo: boolean, model: string|null, flags: string[] }}
 */
export function parseKodoLabels(labels) {
  const result = { isKodo: false, model: null, flags: [] };

  if (!Array.isArray(labels) || labels.length === 0) return result;

  // Extract label names — handle both object and string formats
  const names = labels
    .map((l) => (typeof l === 'object' && l !== null ? l.name : null))
    .filter(Boolean)
    .map((n) => n.toLowerCase());

  for (const name of names) {
    if (name === 'kodo') {
      result.isKodo = true;
    } else if (name.startsWith('kodo:')) {
      result.isKodo = true;
      const tag = name.slice(5); // after "kodo:"
      if (['opus', 'sonnet', 'haiku'].includes(tag)) {
        result.model = tag;
      } else {
        result.flags.push(tag);
      }
    }
  }

  return result;
}

/**
 * Returns the GSD execution mode encoded in a flags array.
 * Centralized here so dispatcher, manager, hooks and tests share one definition.
 *
 *   kodo:gsd-quick → 'quick'
 *   kodo:gsd       → 'full'
 *   neither        → null
 *
 * `kodo:gsd-quick` wins if both labels are present (more specific intent).
 *
 * @param {string[]} flags
 * @returns {'full'|'quick'|null}
 */
export function getGsdMode(flags) {
  if (!Array.isArray(flags)) return null;
  if (flags.includes('gsd-quick')) return 'quick';
  if (flags.includes('gsd')) return 'full';
  return null;
}

/**
 * Returns the GSD execution mode encoded in a persisted Session record.
 * Centralized here (paired with getGsdMode) so hooks, orchestrator and tests
 * share one definition of "what mode is this session?".
 *
 *   gsd:true, gsd_mode:'quick' → 'quick'
 *   gsd:true, gsd_mode:'full'  → 'full'
 *   gsd:true, no gsd_mode      → 'full'   // legacy preservation (Phase 11 D-08):
 *                                          //   sesiones pre-v0.4 con `gsd:true`
 *                                          //   eran siempre full por contrato.
 *   gsd:false / missing        → null     // non-GSD session
 *
 * El helper vive en labels.js (no en session/state.js) porque la regla
 * "legacy gsd:true == full" es semánticamente parte de la taxonomía de
 * labels: define qué label histórica equivale a qué modo (matiz Phase 11
 * <specifics>).
 *
 * Defensivo: nunca lanza para session null/undefined/sin campos.
 *
 * @param {import('./session/state.js').Session | null | undefined} session
 * @returns {'full'|'quick'|null}
 */
export function getSessionMode(session) {
  if (!session?.gsd) return null;
  return session.gsd_mode || 'full';
}

/**
 * Etiqueta de OPT-IN al rol reviewer adversarial (KODO-75).
 *
 * `kodo:review` no es un modo de ejecución del agente de trabajo —como `gsd`/`gsd-quick`—
 * sino la petición de una SEGUNDA sesión, con otro rol, sobre la misma rama, cuando la
 * primera ya ha cerrado. Aun así vive en `flags` y no como campo propio de
 * `parseKodoLabels` por la misma razón que aquéllas: es una decisión de MODO tomada en el
 * tablero, no un valor de operador (que es lo que justifica el campo `model`).
 *
 * JAMÁS DEFAULT, y la razón es económica, no de gusto: cada revisión duplica el coste de la
 * tarea. Su sitio son las tareas de alto blast radius —migraciones, auth, primitivos de
 * concurrencia—, o sea el Tier 3 de la política de merge. Que sea el operador quien la
 * ponga es parte del diseño, no una limitación pendiente de quitar.
 *
 * Espejo estructural de KODO_LABEL_GSD_CHILD/KODO_LABEL_ADOPTED: constante suelta, única
 * fuente de verdad del literal.
 */
export const KODO_LABEL_REVIEW = 'kodo:review';

/**
 * Devuelve true si el array de flags pide revisión adversarial (`kodo:review`).
 * Hermano estructural de `getGsdMode` y `getAgentName`: centralizado aquí para que
 * dispatcher, CLI de review, hooks y tests compartan UNA definición.
 *
 * El flag llega ya sin el prefijo `kodo:` (lo recorta `parseKodoLabels`), así que la
 * comparación es contra `'review'`. Tolerante a entradas no-array y a elementos no-string.
 *
 * @param {string[]} flags
 * @returns {boolean}
 */
export function wantsReview(flags) {
  if (!Array.isArray(flags)) return false;
  return flags.some((f) => typeof f === 'string' && f.toLowerCase() === 'review');
}

/**
 * Sub-issue marker label. Tasks tagged with this label are sub-issues created
 * by the agent (Phase 15+) for GSD progress reporting. The dispatcher (Phase 14
 * D-06) drops them BEFORE any further processing — even under --force — to
 * prevent a webhook-triggered recursion loop where the agent's own report
 * spawns another Claude session.
 *
 * Phase 14 D-09: standalone constant (not nested in a KODO_LABELS object) —
 * the rest of label literals ('kodo', 'sonnet', 'haiku', 'gsd', 'gsd-quick')
 * are intentionally NOT touched in Phase 14 to avoid scope creep. Refactor
 * to an aggregate object becomes worthwhile when a 4th/5th label appears.
 */
export const KODO_LABEL_GSD_CHILD = 'kodo:gsd-child';

/**
 * Returns true iff the labels array contains the `kodo:gsd-child` marker.
 * Defensive parity with `parseKodoLabels`: tolerates both `string[]` and
 * `Array<{name: string}>` inputs (dispatcher passes string[]; provider
 * adapters typically pass {name} objects). Case-insensitive.
 *
 * Phase 14 D-08: única fuente de verdad para el check `gsd-child`. Callsites
 * MUST use this helper, not `task.labels.some(l => l === 'kodo:gsd-child')`
 * inline. Source-hygiene blinda el invariante en `src/triggers/*.js`.
 *
 * @param {Array<any>} labels
 * @returns {boolean}
 */
export function isGsdChild(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const name =
      typeof l === 'object' && l !== null ? l.name :
      typeof l === 'string' ? l :
      null;
    return typeof name === 'string' && name.toLowerCase() === KODO_LABEL_GSD_CHILD;
  });
}

/**
 * Adopted-session marker label. Tasks created by `createTask` for an adopted
 * ad-hoc session (Phase 52 BIDIR-06, Plans 02/03) carry this marker. The
 * dispatcher (Phase 52 D-02) drops them BEFORE lock/resolver/launch — even
 * under --force — so a freshly adopted task is NEVER re-dispatched into a
 * second, colliding session. The marker also makes the task's provenance
 * (origin = adopted session) visible/filterable (D-03) — an honest signal,
 * not just a guard.
 *
 * Mirror of KODO_LABEL_GSD_CHILD: standalone constant, single source of truth
 * for the literal. Source-hygiene (labels-hygiene.test.js) enforces that no
 * inline 'kodo:adopted' lives outside this file.
 */
export const KODO_LABEL_ADOPTED = 'kodo:adopted';

/**
 * Returns true iff the labels array contains the `kodo:adopted` marker.
 * Defensive parity with `isGsdChild`: tolerates both `string[]` and
 * `Array<{name: string}>` inputs (dispatcher passes string[]; provider
 * adapters typically pass {name} objects). Case-insensitive.
 *
 * Phase 52 D-02: única fuente de verdad para el check `adopted`. Callsites
 * MUST use this helper, not `task.labels.some(l => l === 'kodo:adopted')`
 * inline. Source-hygiene blinda el invariante.
 *
 * @param {Array<any>} labels
 * @returns {boolean}
 */
export function isAdopted(labels) {
  if (!Array.isArray(labels)) return false;
  return labels.some((l) => {
    const name =
      typeof l === 'object' && l !== null ? l.name :
      typeof l === 'string' ? l :
      null;
    return typeof name === 'string' && name.toLowerCase() === KODO_LABEL_ADOPTED;
  });
}

/**
 * Returns true iff a task with these labels is eligible for auto-dispatch:
 * carries `kodo` (or any `kodo:*` flag) AND is neither a `kodo:gsd-child`
 * sub-issue nor a `kodo:adopted` marker. Same three gates the dispatcher
 * applies (src/triggers/dispatcher.js steps 1b/1c/2), centralized so a
 * provider's `listPendingTasks()` can return ONLY what the dispatcher would
 * actually launch. Tolerates `string[]` and `Array<{name: string}>`.
 *
 * @param {Array<any>} labels
 * @returns {boolean}
 */
export function isDispatchable(labels) {
  if (!Array.isArray(labels)) return false;
  if (isGsdChild(labels) || isAdopted(labels)) return false;
  const asObjects = labels.map((l) => (typeof l === 'string' ? { name: l } : l));
  return parseKodoLabels(asObjects).isKodo;
}

/**
 * Mapa etiqueta → id de agente del registro `config.agents.registry` (KODO-19).
 *
 * Las etiquetas de agente son NO REACTIVAS: no disparan nada por sí solas —el
 * dispatcher sigue exigiendo `kodo`/`kodo:*` para lanzar— solo se LEEN en el
 * momento del lanzamiento para decidir con qué CLI se abre la sesión. Por eso
 * viven en `flags`, igual que `gsd`/`gsd-quick`, y no como campo propio de
 * `parseKodoLabels`: ese campo lo tiene `model` porque es un valor de operador,
 * mientras que el agente es un MODO de ejecución, como GSD.
 *
 * Se aceptan forma corta y larga a propósito: `kodo:oc` es lo que se teclea a
 * diario en el tablero, `kodo:opencode` es lo que se lee sin contexto. Las
 * claves están en minúsculas porque es como salen de `parseKodoLabels`.
 */
export const AGENT_LABELS = /** @type {Record<string, 'claude-code'|'opencode'>} */ ({
  cc: 'claude-code',
  'claude-code': 'claude-code',
  oc: 'opencode',
  opencode: 'opencode',
});

/**
 * Devuelve el id de agente codificado en un array de flags, o `null` si no hay
 * ninguna etiqueta de agente. Hermano estructural de `getGsdMode`: centralizado
 * aquí para que dispatcher, manager, hooks y tests compartan UNA definición.
 *
 *   kodo:oc / kodo:opencode    → 'opencode'
 *   kodo:cc / kodo:claude-code → 'claude-code'
 *   ninguna                    → null   // el caller cae a `config.agents.default`
 *
 * `null` (ausencia) NO es lo mismo que `'claude-code'` explícito: el caller
 * traduce la ausencia al default DEL CONFIG, que el operador puede haber movido
 * con `kodo config set agents.default …`. Devolver `'claude-code'` aquí
 * cortocircuitaría ese ajuste.
 *
 * PRECEDENCIA: si conviven etiquetas de dos agentes distintos (`kodo:cc` +
 * `kodo:oc`), gana `claude-code`. Es la elección conservadora — ante una tarea
 * ambigua se lanza el agente con el ciclo de vida COMPLETO (hooks, cleanup de
 * worktree, comentario de cierre), no el degradado.
 *
 * @param {string[]} flags
 * @returns {'claude-code'|'opencode'|null}
 */
export function getAgentName(flags) {
  if (!Array.isArray(flags)) return null;
  /** @type {Set<'claude-code'|'opencode'>} */
  const found = new Set();
  for (const flag of flags) {
    if (typeof flag !== 'string') continue;
    const agent = AGENT_LABELS[flag.toLowerCase()];
    if (agent) found.add(agent);
  }
  if (found.size === 0) return null;
  // Conservador ante etiquetas en conflicto — ver PRECEDENCIA arriba.
  return found.has('claude-code') ? 'claude-code' : [...found][0];
}
