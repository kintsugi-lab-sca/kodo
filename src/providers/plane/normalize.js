// @ts-check
import { VALID_PRIORITIES } from '../../interface.js';
import { parseKodoLabels } from '../../labels.js';

/**
 * @typedef {{
 *   labels: Array<{id: string, name: string}>,
 *   projectIdentifier: string,
 *   baseUrl: string,
 *   workspaceSlug: string,
 * }} NormalizeContext
 */

/**
 * Strip HTML tags and collapse whitespace to produce plain text.
 *
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve work item label IDs (UUIDs) or label objects to human-readable names.
 *
 * Handles two formats:
 * - Array of objects with .name → extract names directly
 * - Array of UUID strings → look up each in labelsMap by id
 *
 * @param {Array<any>|null|undefined} labelIds
 * @param {Array<{id: string, name: string}>} labelsMap
 * @returns {string[]}
 */
export function resolveWorkItemLabels(labelIds, labelsMap) {
  if (!Array.isArray(labelIds) || labelIds.length === 0) return [];

  // If first element is an object with .name, extract names directly
  if (typeof labelIds[0] === 'object' && labelIds[0] !== null && labelIds[0].name) {
    return labelIds.map((l) => l.name);
  }

  // UUIDs — look up in labelsMap
  const mapById = new Map(labelsMap.map((l) => [l.id, l.name]));
  return labelIds
    .map((id) => mapById.get(id))
    .filter(Boolean);
}

/**
 * Convert a raw Plane API work item to a canonical TaskItem.
 *
 * Pure function — no API calls, no side effects.
 *
 * @param {object} workItem - Raw Plane API work item response
 * @param {NormalizeContext} context - Resolution context (labels, project info, URLs)
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeWorkItem(workItem, context) {
  const ref = `${context.projectIdentifier}-${workItem.sequence_id}`;

  return {
    id: workItem.id,
    ref,
    title: workItem.name,
    description: stripHtml(workItem.description_html || ''),
    labels: resolveWorkItemLabels(workItem.labels, context.labels),
    projectId: workItem.project_detail?.id || workItem.project,
    projectName: workItem.project_detail?.name || '',
    groups: [],
    url: `${context.baseUrl}/${context.workspaceSlug}/browse/${ref}`,
    priority: VALID_PRIORITIES.includes(workItem.priority) ? workItem.priority : null,
  };
}

/**
 * Parse a Plane webhook payload into a canonical TriggerEvent.
 *
 * Returns null if the event type is not a work item event.
 * Pure, synchronous function — uses cached label data for resolution.
 *
 * @param {object} rawPayload - The webhook body object
 * @param {Array<{id: string, name: string}>} labelCache - Cached project labels
 * @returns {import('../../interface.js').TriggerEvent|null}
 */
export function parseTriggerEvent(rawPayload, labelCache) {
  if (rawPayload.event !== 'issue' && rawPayload.event !== 'work_item') {
    return null;
  }

  const data = rawPayload.data;
  const taskRef = `${data.project_detail?.identifier}-${data.sequence_id}`;

  // Resolve labels and extract kodo configuration
  const resolvedNames = resolveWorkItemLabels(data.labels, labelCache);
  const resolvedLabelObjects = resolvedNames.map((name) => ({ name }));
  const kodoConfig = parseKodoLabels(resolvedLabelObjects);

  return {
    taskRef,
    action: rawPayload.action,
    provider: 'plane',
    raw: { ...rawPayload, kodoConfig },
  };
}
