// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeIssue,
  extractPriority,
} from '../../../src/providers/github/normalize.js';

import issueFixture from '../../fixtures/github/issue.json' with { type: 'json' };
import issuePriorityFixture from '../../fixtures/github/issue-with-priority.json' with { type: 'json' };
import issueKodoFixture from '../../fixtures/github/issue-with-kodo.json' with { type: 'json' };
import issueClosedFixture from '../../fixtures/github/issue-closed.json' with { type: 'json' };
import issueNoBodyFixture from '../../fixtures/github/issue-no-body.json' with { type: 'json' };
import issueNoLabelsFixture from '../../fixtures/github/issue-no-labels.json' with { type: 'json' };

/** @type {import('../../../src/providers/github/normalize.js').NormalizeContext} */
const defaultContext = { projectId: 'octocat/hello-world' };

// D-18 leak guard (W9): TaskItem must have EXACTLY these 11 canonical fields,
// no GitHub-only leaks (pull_request, assignees, user, milestone, comments, etc.).
const CANONICAL_KEYS = [
  'id',
  'ref',
  'title',
  'description',
  'labels',
  'projectId',
  'projectName',
  'groups',
  'url',
  'priority',
  'state',
];

describe('normalizeIssue', () => {
  it('converts GitHub Issue to canonical TaskItem (issue.json base fixture)', () => {
    const result = normalizeIssue(issueFixture, defaultContext);

    assert.equal(result.id, 'I_kwTEST001', 'D-07: id must be issue.node_id');
    assert.equal(result.ref, 'octocat/hello-world#42', 'D-08: ref = owner/repo#number');
    assert.equal(result.title, 'Test issue', 'D-09');
    assert.equal(result.description, 'Issue body markdown', 'D-10: body markdown literal');
    assert.deepEqual(result.labels, ['kodo'], 'D-11: labels as strings');
    assert.equal(result.projectId, 'octocat/hello-world', 'D-12');
    assert.equal(result.projectName, 'octocat/hello-world', 'D-13: same slug as projectId');
    assert.deepEqual(result.groups, [], 'D-14: groups always empty');
    assert.equal(
      result.url,
      'https://github.com/kodo-test/fixture-repo/issues/42',
      'D-15: html_url literal',
    );
    assert.equal(result.state, 'open', 'D-16: state literal');
    assert.equal(result.priority, null, 'D-17: no priority label → null');
  });

  it('D-18 leak guard: result has EXACTLY 11 canonical TaskItem keys, no GitHub-only fields', () => {
    const result = normalizeIssue(issueFixture, defaultContext);
    const actualKeys = Object.keys(result).sort();
    assert.deepEqual(
      actualKeys,
      [...CANONICAL_KEYS].sort(),
      'D-18: TaskItem must have exactly the 11 canonical fields (no pull_request, assignees, user, comments, locked, state_reason, created_at, updated_at, milestone, etc.)',
    );
  });

  it('D-07: id is node_id (string), never the numeric id', () => {
    const result = normalizeIssue(issueFixture, defaultContext);
    assert.equal(typeof result.id, 'string', 'id must be string');
    assert.equal(result.id, 'I_kwTEST001');
    assert.notEqual(result.id, 1, 'id must not be the numeric id field');
    assert.notEqual(result.id, '1', 'id must not be the numeric id stringified');
  });

  it('D-10: body=null → description === ""', () => {
    const result = normalizeIssue(issueNoBodyFixture, defaultContext);
    assert.equal(result.description, '');
  });

  it('D-10: body=undefined (deleted) → description === ""', () => {
    const issue = { ...issueFixture };
    delete issue.body;
    const result = normalizeIssue(issue, defaultContext);
    assert.equal(result.description, '');
  });

  it('D-11: labels=[] → labels: [] and priority: null', () => {
    const result = normalizeIssue(issueNoLabelsFixture, defaultContext);
    assert.deepEqual(result.labels, []);
    assert.equal(result.priority, null);
  });

  it('D-11: labels in string form (defensive .map) extracts strings without crash', () => {
    const issue = { ...issueFixture, labels: ['foo', 'bar'] };
    const result = normalizeIssue(issue, defaultContext);
    assert.deepEqual(result.labels, ['foo', 'bar']);
  });

  it('D-16: state="closed" literal passthrough', () => {
    const result = normalizeIssue(issueClosedFixture, defaultContext);
    assert.equal(result.state, 'closed');
  });

  it('D-17: priority:high label → priority="high"', () => {
    const result = normalizeIssue(issuePriorityFixture, defaultContext);
    assert.equal(result.priority, 'high');
  });

  it('D-11 + D-17: kodo + kodo:sonnet labels exposed as strings, priority null', () => {
    const result = normalizeIssue(issueKodoFixture, defaultContext);
    assert.deepEqual(result.labels, ['kodo', 'kodo:sonnet']);
    assert.equal(result.priority, null);
  });

  it('D-17: priority:invalid → priority=null (whitelist enforced)', () => {
    const issue = {
      ...issueFixture,
      labels: [{ name: 'priority:invalid' }],
    };
    const result = normalizeIssue(issue, defaultContext);
    assert.equal(result.priority, null);
  });

  it('D-17: case-insensitive Priority:HIGH → priority="high"', () => {
    const issue = {
      ...issueFixture,
      labels: [{ name: 'Priority:HIGH' }],
    };
    const result = normalizeIssue(issue, defaultContext);
    assert.equal(result.priority, 'high');
  });

  it('D-17: alias priority:p0 → priority=null (no aliases supported)', () => {
    const issue = {
      ...issueFixture,
      labels: [{ name: 'priority:p0' }],
    };
    const result = normalizeIssue(issue, defaultContext);
    assert.equal(result.priority, null);
  });

  it('D-14: groups always [] even when issue has a milestone', () => {
    const issue = {
      ...issueFixture,
      milestone: { id: 1, title: 'v1.0', number: 1 },
    };
    const result = normalizeIssue(issue, defaultContext);
    assert.deepEqual(result.groups, []);
  });

  it('D-17: all priority whitelist values (urgent/high/medium/low) extracted correctly', () => {
    for (const p of ['urgent', 'high', 'medium', 'low']) {
      const issue = {
        ...issueFixture,
        labels: [{ name: `priority:${p}` }],
      };
      const result = normalizeIssue(issue, defaultContext);
      assert.equal(result.priority, p, `priority:${p} must extract to ${p}`);
    }
  });
});

describe('extractPriority', () => {
  it('returns null for null input', () => {
    assert.equal(extractPriority(null), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(extractPriority(undefined), null);
  });

  it('returns null for empty array', () => {
    assert.equal(extractPriority([]), null);
  });

  it('returns null for invalid value (alias p0)', () => {
    assert.equal(extractPriority([{ name: 'priority:p0' }]), null);
  });

  it('extracts priority from string-form labels (defensive)', () => {
    assert.equal(extractPriority(['priority:medium']), 'medium');
  });

  it('returns the matched whitelisted value (case-insensitive)', () => {
    assert.equal(extractPriority([{ name: 'Priority:HIGH' }]), 'high');
    assert.equal(extractPriority([{ name: 'PRIORITY:urgent' }]), 'urgent');
  });

  it('returns null when no priority: label is present', () => {
    assert.equal(
      extractPriority([{ name: 'kodo' }, { name: 'bug' }]),
      null,
    );
  });

  it('first whitelisted match wins when multiple priority: labels present', () => {
    const result = extractPriority([
      { name: 'priority:high' },
      { name: 'priority:low' },
    ]);
    assert.equal(result, 'high');
  });
});
