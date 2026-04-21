// @ts-check

/**
 * Build the bootstrap brief block per CONTEXT §D-10.
 *
 * Rendered format:
 *   ## Project Brief
 *
 *   **Task:** <ref> — <title>
 *   **Source:** <url>         ← omitted if url missing
 *
 *   <description or "(no description provided)">
 *
 * D-12 fallback: when description is null, undefined, '', or whitespace-only,
 * the body becomes "(no description provided)" and the caller's event emitter
 * can flag `brief_empty: true` to surface it in gsd.bootstrap log entries.
 *
 * Pure function — no I/O, no redaction. The caller is responsible for not
 * passing untrusted descriptions into logs if they may contain secrets.
 *
 * @param {{ ref: string, title: string, url?: string, description?: string | null }} task
 * @returns {string}
 */
export function buildBriefFromTask(task) {
  const body = task.description && task.description.trim()
    ? task.description
    : '(no description provided)';

  const lines = [
    '## Project Brief',
    '',
    `**Task:** ${task.ref} — ${task.title}`,
  ];
  if (task.url) {
    lines.push(`**Source:** ${task.url}`);
  }
  lines.push('', body);

  return lines.join('\n');
}

/**
 * True when `task.description` is effectively empty (null/undefined/whitespace-only).
 * Used by the dispatcher to set `brief_empty: true` on the gsd.bootstrap event (D-12).
 *
 * @param {{ description?: string | null }} task
 * @returns {boolean}
 */
export function isBriefEmpty(task) {
  return !task.description || !task.description.trim();
}
