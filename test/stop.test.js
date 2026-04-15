// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STOP_SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'stop.js');

describe('stop.js source hygiene', () => {
  it('does not import PlaneClient', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('PlaneClient'), 'stop.js must not import PlaneClient');
    assert.ok(!source.includes("from '../plane/client.js'"), 'must not import from plane/client');
  });

  it('does not touch Plane state (no updateTaskState, no addComment calls)', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('updateTaskState'), 'hook must not move Plane state — the active session does that');
    assert.ok(!source.includes('addComment'), 'hook must not post comments — the active session does that');
  });

  it('does not import provider registry', () => {
    const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
    assert.ok(!source.includes('initRegistry'), 'hook should not initialize registry');
    assert.ok(!source.includes('getProvider'), 'hook should not fetch a provider');
  });
});
