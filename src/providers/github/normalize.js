// @ts-check

/**
 * GitHub Issue → canonical TaskItem normalizer.
 *
 * Pure transformation module — zero API calls, zero side effects (D-06).
 *
 * Key decisions (see .planning/phases/24-githubprovider-normalizer-registry/24-CONTEXT.md):
 * - D-06: `normalizeIssue(issue, context)` is a pure function — mirrors `normalizeWorkItem`.
 * - D-07: TaskItem.id = issue.node_id (opaque, stable cross-rename, NOT numeric id).
 * - D-08: TaskItem.ref = `${context.projectId}#${issue.number}` ("owner/repo#N").
 * - D-10: TaskItem.description = issue.body || '' (raw Markdown, NO HTML strip).
 * - D-11: TaskItem.labels = issue.labels.map(l => l.name) (defensive: tolerates string form).
 * - D-13: TaskItem.projectName = context.projectId (same slug — GitHub has no separate name).
 * - D-14: TaskItem.groups = [] (milestone NOT extracted — closes STATE.md open question).
 * - D-16: TaskItem.state = issue.state literal ('open'|'closed', no transformation).
 * - D-17: TaskItem.priority extracted from `priority:<value>` label, whitelist
 *         urgent/high/medium/low (case-insensitive, no aliases, default null).
 * - D-18: ZERO leaks — TaskItem has EXACTLY the 11 canonical fields, no GitHub-only
 *         fields (pull_request, assignees, milestone, user, comments, locked, etc.).
 */

import { VALID_PRIORITIES } from '../../interface.js';

// VALID_PRIORITIES is imported for symmetry with Plane normalizer and to anchor
// the whitelist in the canonical contract. The actual priority whitelist below
// is a strict subset (no 'none') because GitHub doesn't use `priority:none` as
// an idiomatic label (D-17).
void VALID_PRIORITIES;

/**
 * @typedef {{ projectId: string, baseUrl?: string }} NormalizeContext
 *
 * projectId: 'owner/repo' literal (D-08 / D-12).
 * baseUrl: optional, only for tests with fake server (not used by normalizeIssue
 *          since GitHub embeds `html_url` in each payload — D-15).
 */

/**
 * Extract priority from GitHub Issue labels by scanning for `priority:<value>` prefix.
 *
 * Whitelist (D-17): only `urgent`, `high`, `medium`, `low` — subset of VALID_PRIORITIES
 * without `none` (priority:none not idiomatic in GitHub). No aliases (p0/critical/blocker
 * are intentionally rejected). Match is case-insensitive.
 *
 * Defensive: tolerates both object labels (`{name: "..."}`) and string labels — some
 * GitHub endpoints return strings instead of objects (rare but documented).
 *
 * @param {Array<{name: string}|string>|null|undefined} labels
 * @returns {'urgent'|'high'|'medium'|'low'|null}
 */
export function extractPriority(labels) {
  if (!Array.isArray(labels)) return null;
  for (const l of labels) {
    const name = (typeof l === 'string' ? l : l?.name || '').toLowerCase();
    if (name.startsWith('priority:')) {
      const value = name.slice('priority:'.length);
      // D-17: explicit whitelist with literals — NOT VALID_PRIORITIES.includes because
      // that array contains 'none' which is not a valid GitHub priority label value.
      if (value === 'urgent' || value === 'high' || value === 'medium' || value === 'low') {
        return /** @type {'urgent'|'high'|'medium'|'low'} */ (value);
      }
    }
  }
  return null;
}

/**
 * Convert a raw GitHub Issue payload to a canonical TaskItem.
 *
 * Pure function — no API calls, no side effects (D-06).
 *
 * The returned object has EXACTLY the 11 canonical TaskItem fields (D-18):
 * id, ref, title, description, labels, projectId, projectName, groups, url,
 * priority, state. No GitHub-only fields (pull_request, assignees, milestone,
 * user, comments, locked, state_reason, created_at, updated_at, reactions, etc.)
 * leak through.
 *
 * @param {object} issue - Raw GitHub API issue payload (response from /repos/:owner/:repo/issues/:number)
 * @param {NormalizeContext} context - Resolution context (projectId = 'owner/repo')
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeIssue(issue, context) {
  // D-11: labels embedded as objects {id, node_id, name, color, ...}. Some endpoints
  // return strings (raw label names) — defensive .map tolerates both forms.
  const labels = Array.isArray(issue.labels)
    ? issue.labels
        .map((l) => (typeof l === 'string' ? l : l?.name))
        .filter(Boolean)
    : [];

  return {
    id: issue.node_id,                              // D-07: node_id (NOT numeric id)
    ref: `${context.projectId}#${issue.number}`,    // D-08: owner/repo#number
    title: issue.title,                             // D-09
    description: issue.body || '',                  // D-10: raw Markdown, body null/undefined → ''
    labels,                                         // D-11
    projectId: context.projectId,                   // D-12
    projectName: context.projectId,                 // D-13: same slug
    groups: [],                                     // D-14: hardcoded empty (milestone NOT extracted)
    url: issue.html_url,                            // D-15
    priority: extractPriority(issue.labels),        // D-17
    state: issue.state,                             // D-16: 'open'|'closed' literal
  };
}
