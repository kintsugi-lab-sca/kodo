// @ts-check
//
// Phase 18 D-06 source-hygiene guard.
// Asegura que src/orchestrator/launch.js NO emite --worktree en su cmd
// claude. El comentario in-file sí puede mencionarlo (stripComments).
//
// Driver: launchOrchestrator necesita cwd=repo para auto-cargar
// .claude/skills/kodo-orchestrate/skill.md (Phase 999.1 D-05 constraint
// registrado en PROJECT.md §Constraints).
//
// Patrón: mirror de test/dispatcher-isolation.test.js (Phase 16 LOG-13).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'src', 'orchestrator', 'launch.js');

/**
 * Strip block-comments (slash-star-star-slash) and line-comments (//)
 * + JSDoc continuation lines starting with *. Preserves runtime tokens.
 * Mirror de test/dispatcher-isolation.test.js:24-30.
 *
 * @param {string} src
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

describe('orchestrator/launch.js — Phase 18 D-06 source-hygiene', () => {
  it('NEVER emits --worktree in runtime code (only in comments)', () => {
    const source = readFileSync(SRC, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes('--worktree'),
      'src/orchestrator/launch.js MUST NOT include --worktree in runtime code ' +
        '(Phase 18 D-06: cwd=repo for skill auto-load — Phase 999.1 D-05 constraint).',
    );
  });

  it('preserves cwd: process.cwd() (orchestrator opens in repo)', () => {
    const source = readFileSync(SRC, 'utf-8');
    assert.ok(
      /cwd:\s*process\.cwd\(\)/.test(source),
      'src/orchestrator/launch.js MUST set cwd: process.cwd() ' +
        '(Phase 999.1 D-05 — auto-load .claude/skills/kodo-orchestrate/skill.md).',
    );
  });

  it('documents Phase 18 D-06 exclusion in a comment', () => {
    const source = readFileSync(SRC, 'utf-8');
    assert.ok(
      /Phase 18 D-06/.test(source),
      'src/orchestrator/launch.js MUST document the D-06 exclusion as in-file ' +
        'comment for future maintainers.',
    );
  });
});
