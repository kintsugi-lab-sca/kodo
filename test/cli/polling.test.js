// @ts-check
//
// test/cli/polling.test.js — Wave 0 scaffold (Plan 26-01).
//
// Casos unit para los pure helpers de `src/cli/polling.js`:
//   - parseGitHubRemote(url) — 6 fixtures verbatim (RESEARCH §Example 5, 26-PATTERNS líneas 540-553)
//   - detectOriginRepo(execGitRemote?) — fail-open Pitfall #6
//
// Los handlers CLI del daemon (`runPollingStartCli`, etc.) llegan en Plan 26-02
// y NO viven en este test file todavía.
//
// Plan 26-01 / Task 1 — RED state esperado hasta Task 2 GREEN.
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseGitHubRemote, detectOriginRepo } from '../../src/cli/polling.js';

describe('parseGitHubRemote', () => {
  /** @type {Array<[string, ({owner: string, repo: string} | null)]>} */
  const FIXTURES = [
    ['git@github.com:owner/repo.git',               { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo',                { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo.git',            { owner: 'owner', repo: 'repo' }],
    ['https://gitlab.com/owner/repo.git',            null],
    ['',                                              null],
    ['https://github.enterprise.example.com/o/r',     null],
  ];

  for (const [url, expected] of FIXTURES) {
    const label = url === '' ? '(empty)' : url;
    it(`parses ${label}`, () => {
      assert.deepEqual(parseGitHubRemote(url), expected);
    });
  }
});

describe('detectOriginRepo', () => {
  it('returns parsed remote when execGitRemote returns a github SSH url', () => {
    const exec = () => 'git@github.com:klab/kodo.git\n';
    assert.deepEqual(detectOriginRepo(exec), { owner: 'klab', repo: 'kodo' });
  });

  it('returns parsed remote when execGitRemote returns a github HTTPS url', () => {
    const exec = () => 'https://github.com/klab/kodo\n';
    assert.deepEqual(detectOriginRepo(exec), { owner: 'klab', repo: 'kodo' });
  });

  it('returns null when execGitRemote returns a non-github url', () => {
    const exec = () => 'https://gitlab.com/foo/bar.git\n';
    assert.equal(detectOriginRepo(exec), null);
  });

  it('fail-open: returns null when execGitRemote throws (Pitfall #6)', () => {
    const exec = () => { throw new Error('not a git repo'); };
    assert.equal(detectOriginRepo(exec), null);
  });

  it('returns null when execGitRemote returns empty string', () => {
    const exec = () => '';
    assert.equal(detectOriginRepo(exec), null);
  });
});
