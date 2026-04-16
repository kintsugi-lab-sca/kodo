import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../src/logs/follow.js');

describe('LOG-06: src/logs/follow.js structural exports', () => {
  it('exports FOLLOW_INTERVAL_MS constant equal to 200', () => {
    assert.equal(typeof mod.FOLLOW_INTERVAL_MS, 'number');
    assert.equal(mod.FOLLOW_INTERVAL_MS, 200);
  });

  it('exports followFile(filePath, onLine) function', () => {
    assert.equal(typeof mod.followFile, 'function');
    assert.equal(mod.followFile.length, 2);
  });
});
