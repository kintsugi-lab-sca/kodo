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
      if (['sonnet', 'haiku'].includes(tag)) {
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
