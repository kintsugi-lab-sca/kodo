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
