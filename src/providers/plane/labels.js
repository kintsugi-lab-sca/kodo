// @ts-check

/**
 * Resolve label IDs to label objects via Plane API.
 * Only needed if webhook sends raw IDs instead of objects.
 *
 * @param {import('./client.js').PlaneClient} plane
 * @param {string} projectId
 * @param {Array<any>} labels
 * @returns {Promise<Array<{name: string, id: string}>>}
 */
export async function resolveLabels(plane, projectId, labels) {
  if (!Array.isArray(labels) || labels.length === 0) return [];

  // If already objects with names, return as-is
  if (typeof labels[0] === 'object' && labels[0]?.name) return labels;

  // Labels are IDs — fetch all project labels and match
  const allLabels = await plane.request(`/projects/${projectId}/labels/`);
  const resolved = allLabels.results || allLabels;
  const labelIds = new Set(labels.map((l) => (typeof l === 'string' ? l : l?.id)));

  return resolved.filter((l) => labelIds.has(l.id));
}
