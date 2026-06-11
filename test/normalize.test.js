// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeWorkItem,
  parseTriggerEvent,
  stripHtml,
  resolveWorkItemLabels,
} from '../src/providers/plane/normalize.js';

import workItemFixture from './fixtures/plane-workitem.json' with { type: 'json' };
import webhookFixture from './fixtures/plane-webhook.json' with { type: 'json' };
import labelsFixture from './fixtures/plane-labels.json' with { type: 'json' };

/** @type {import('../src/providers/plane/normalize.js').NormalizeContext} */
const defaultContext = {
  labels: labelsFixture,
  projectIdentifier: 'KL',
  baseUrl: 'https://plane.klab.dev',
  workspaceSlug: 'klab',
};

describe('stripHtml', () => {
  it('removes HTML tags and collapses whitespace', () => {
    const result = stripHtml('<p>Hello <strong>world</strong></p>');
    assert.equal(result, 'Hello world');
  });

  it('handles null/undefined input', () => {
    assert.equal(stripHtml(null), '');
    assert.equal(stripHtml(undefined), '');
    assert.equal(stripHtml(''), '');
  });

  it('collapses multiple whitespace and trims', () => {
    const result = stripHtml('<p>  lots   of   space  </p>');
    assert.equal(result, 'lots of space');
  });
});

describe('resolveWorkItemLabels', () => {
  it('resolves UUID array to label names using labelsMap', () => {
    const uuids = [
      '11111111-aaaa-bbbb-cccc-000000000001',
      '33333333-aaaa-bbbb-cccc-000000000003',
    ];
    const result = resolveWorkItemLabels(uuids, labelsFixture);
    assert.deepEqual(result, ['kodo', 'bug']);
  });

  it('resolves already-object labels to names', () => {
    const objectLabels = [{ name: 'kodo', id: '111' }, { name: 'bug', id: '333' }];
    const result = resolveWorkItemLabels(objectLabels, labelsFixture);
    assert.deepEqual(result, ['kodo', 'bug']);
  });

  it('returns empty array for null/empty input', () => {
    assert.deepEqual(resolveWorkItemLabels(null, labelsFixture), []);
    assert.deepEqual(resolveWorkItemLabels([], labelsFixture), []);
  });

  it('skips UUIDs not found in labelsMap', () => {
    const uuids = ['11111111-aaaa-bbbb-cccc-000000000001', 'unknown-uuid'];
    const result = resolveWorkItemLabels(uuids, labelsFixture);
    assert.deepEqual(result, ['kodo']);
  });
});

describe('normalizeWorkItem', () => {
  it('converts Plane work item to canonical TaskItem', () => {
    const result = normalizeWorkItem(workItemFixture, defaultContext);

    assert.equal(result.id, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    assert.equal(result.ref, 'KL-42');
    assert.equal(result.title, 'Fix login redirect after session timeout');
    assert.equal(typeof result.description, 'string');
    assert.ok(!result.description.includes('<'), 'description should not contain HTML');
    assert.deepEqual(result.labels, ['kodo', 'kodo:sonnet']);
    assert.equal(result.projectId, 'p0p0p0p0-1111-2222-3333-444444444444');
    assert.equal(result.projectName, 'Kodo Lab');
    assert.deepEqual(result.groups, []);
    assert.equal(result.url, 'https://plane.klab.dev/klab/browse/KL-42');
    assert.equal(result.priority, 'medium');
  });

  it('strips HTML from description', () => {
    const result = normalizeWorkItem(workItemFixture, defaultContext);
    assert.ok(!result.description.includes('<p>'));
    assert.ok(!result.description.includes('<strong>'));
    assert.ok(result.description.includes('redirect'));
  });

  it('handles missing description_html', () => {
    const item = { ...workItemFixture, description_html: null };
    const result = normalizeWorkItem(item, defaultContext);
    assert.equal(result.description, '');
  });

  it('handles undefined description_html', () => {
    const item = { ...workItemFixture };
    delete item.description_html;
    const result = normalizeWorkItem(item, defaultContext);
    assert.equal(result.description, '');
  });

  it('handles empty labels', () => {
    const item = { ...workItemFixture, labels: [] };
    const result = normalizeWorkItem(item, defaultContext);
    assert.deepEqual(result.labels, []);
  });

  it('handles missing priority', () => {
    const item = { ...workItemFixture, priority: null };
    const result = normalizeWorkItem(item, defaultContext);
    assert.equal(result.priority, null);
  });

  it('returns null priority for invalid priority value', () => {
    const item = { ...workItemFixture, priority: 'critical' };
    const result = normalizeWorkItem(item, defaultContext);
    assert.equal(result.priority, null);
  });

  it('uses project UUID fallback when project_detail missing', () => {
    const item = { ...workItemFixture, project_detail: undefined };
    const result = normalizeWorkItem(item, defaultContext);
    assert.equal(result.projectId, 'p0p0p0p0-1111-2222-3333-444444444444');
    assert.equal(result.projectName, '');
  });

  // OPEN-04 / D-07: unified deploy (webUrl unset) → url byte-identical to today.
  it('unified deploy: url uses baseUrl when webUrl absent', () => {
    const result = normalizeWorkItem(workItemFixture, defaultContext);
    assert.equal(result.url, 'https://plane.klab.dev/klab/browse/KL-42');
  });

  // OPEN-04 / D-07: split deploy (webUrl ≠ baseUrl) → url points at the web host,
  // never the API host.
  it('split deploy: url uses webUrl when webUrl ≠ baseUrl', () => {
    const splitContext = {
      ...defaultContext,
      baseUrl: 'https://api.klab.dev',
      webUrl: 'https://web.klab.dev',
    };
    const result = normalizeWorkItem(workItemFixture, splitContext);
    assert.equal(result.url, 'https://web.klab.dev/klab/browse/KL-42');
    assert.ok(result.url.includes('web.klab.dev'), 'url must use the web host');
    assert.ok(!result.url.includes('api.klab.dev'), 'url must NOT use the API host');
  });

  // OPEN-04 / D-08: unresolved project identifier (UNKNOWN) → NO url emitted,
  // never a dead browse/UNKNOWN-<seq> link.
  it('UNKNOWN identifier: no url emitted', () => {
    const unknownContext = { ...defaultContext, projectIdentifier: 'UNKNOWN' };
    const result = normalizeWorkItem(workItemFixture, unknownContext);
    assert.equal(result.url, undefined);
    assert.ok(
      !JSON.stringify(result).includes('browse/UNKNOWN'),
      'a dead browse/UNKNOWN link must never appear in the result',
    );
  });

  it('falsy identifier: no url emitted', () => {
    const falsyContext = { ...defaultContext, projectIdentifier: '' };
    const result = normalizeWorkItem(workItemFixture, falsyContext);
    assert.equal(result.url, undefined);
  });
});

describe('parseTriggerEvent', () => {
  it('converts webhook payload to TriggerEvent', () => {
    const result = parseTriggerEvent(webhookFixture, labelsFixture);

    assert.equal(result.taskRef, 'KL-42');
    assert.equal(result.action, 'updated');
    assert.equal(result.provider, 'plane');
    assert.ok(result.raw.kodoConfig, 'raw should contain kodoConfig');
    assert.equal(result.raw.kodoConfig.isKodo, true);
    assert.equal(result.raw.kodoConfig.model, 'sonnet');
  });

  it('returns null for non-issue events', () => {
    const payload = { ...webhookFixture, event: 'project' };
    assert.equal(parseTriggerEvent(payload, labelsFixture), null);
  });

  it('returns null for unrecognized event types', () => {
    const payload = { ...webhookFixture, event: 'cycle' };
    assert.equal(parseTriggerEvent(payload, labelsFixture), null);
  });

  it('handles work_item event type', () => {
    const payload = { ...webhookFixture, event: 'work_item' };
    const result = parseTriggerEvent(payload, labelsFixture);
    assert.ok(result !== null);
    assert.equal(result.taskRef, 'KL-42');
  });
});
