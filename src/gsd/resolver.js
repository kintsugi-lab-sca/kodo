// @ts-check
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRoadmap, normalizeTitle } from './roadmap.js';

/**
 * GSD phase resolver.
 *
 * Implements:
 *   - D-01: module orchestrates filesystem + pure parser (roadmap.js).
 *   - D-02: discriminated union return (ResolveResult).
 *   - D-03: consumed by the dispatcher after lock acquisition and before launch.
 *   - D-06: matches normalized title vs phase titles (NOT full heading).
 *   - D-07: normalizeTitle rules (trim + collapse + lowercase).
 *   - D-13: fail-closed — 0 matches, >1 matches, and missing ROADMAP.md all
 *           return an `error` verdict (the caller releases the lock).
 *
 * GSD-02 guard (strict presence): returns `bootstrap` when .planning/PROJECT.md
 * is absent, WITHOUT inspecting ROADMAP.md. This prevents overwriting a repo
 * that has a half-initialized .planning/ (only ROADMAP but no PROJECT).
 *
 * NO side effects: only `existsSync` + `readFileSync`. Never writes.
 * NO realpathSync: the dispatcher resolved projectPath already; a second
 * realpath here would duplicate work and risk diverging from lock.js behavior.
 */

/**
 * @typedef {{ action: 'phase', phase_id: string, match_heading: string, match_reason: string }} PhaseVerdict
 * @typedef {{ action: 'bootstrap', reason: 'no-planning-dir' }} BootstrapVerdict
 * @typedef {{ action: 'error', code: 'no-match' | 'multi-match' | 'roadmap-missing', detail?: string, matches?: string[] }} ErrorVerdict
 * @typedef {PhaseVerdict | BootstrapVerdict | ErrorVerdict} ResolveResult
 */

/**
 * Resolve which GSD phase (if any) corresponds to the given task.
 *
 * @param {{ projectPath: string, task: { title: string, ref?: string } }} params
 * @returns {ResolveResult}
 */
export function resolvePhase({ projectPath, task }) {
  // GSD-02: strict presence guard. If PROJECT.md is missing, trigger bootstrap.
  // We DO NOT check ROADMAP.md here — a repo with only ROADMAP but no PROJECT
  // is considered uninitialized.
  const projectMd = join(projectPath, '.planning', 'PROJECT.md');
  if (!existsSync(projectMd)) {
    return { action: 'bootstrap', reason: 'no-planning-dir' };
  }

  // PROJECT.md present but ROADMAP.md absent → fail-closed error (D-13).
  const roadmapMd = join(projectPath, '.planning', 'ROADMAP.md');
  if (!existsSync(roadmapMd)) {
    return { action: 'error', code: 'roadmap-missing', detail: roadmapMd };
  }

  // Parse and match. Empty ROADMAP returns { phases: [] } → no-match.
  const md = readFileSync(roadmapMd, 'utf-8');
  const { phases } = parseRoadmap(md);

  const needle = normalizeTitle(task.title);
  const matches = phases.filter((p) => normalizeTitle(p.title) === needle);

  if (matches.length === 0) {
    return { action: 'error', code: 'no-match' };
  }
  if (matches.length > 1) {
    return {
      action: 'error',
      code: 'multi-match',
      matches: matches.map((m) => `Phase ${m.n}: ${m.title}`),
    };
  }

  const hit = matches[0];
  return {
    action: 'phase',
    phase_id: hit.n,
    match_heading: hit.heading,
    match_reason: 'exact title match (normalized)',
  };
}
