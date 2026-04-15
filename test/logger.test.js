import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';

// Set HOME before dynamic import of logger.js (module evaluates KODO_DIR at load time)
const fixture = makeTmpHome({ sessionId: 'sess-logger-unit', label: 'logger-unit' });
after(() => fixture.cleanup());

const { createLogger } = await import('../src/logger.js');

describe('LOG-01: createLogger factory + level filtering', () => {
  it('exports debug/info/warn/error methods on root logger', () => {
    const log = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    for (const lvl of ['debug', 'info', 'warn', 'error']) {
      assert.equal(typeof log[lvl], 'function', `${lvl} must be a function`);
    }
  });

  it('filters events below minLevel (info logger drops debug)', () => {
    const log = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'info' });
    log.debug('dropped');
    log.info('kept');
    const lines = readAllLines(fixture.logPath);
    assert.equal(lines.every(l => l.msg !== 'dropped'), true);
    assert.equal(lines.some(l => l.msg === 'kept'), true);
  });

  it('throws on invalid minLevel', () => {
    assert.throws(() => createLogger({ sessionId: 's', minLevel: 'trace' }));
  });
});

describe('LOG-02: NDJSON shape', () => {
  it('writes one JSON object per line with timestamp, level, msg, session_id', () => {
    const log = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    log.info('hello', { foo: 'bar' });
    const lines = readAllLines(fixture.logPath);
    const line = lines[lines.length - 1];
    assert.match(line.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(line.level, 'info');
    assert.equal(line.msg, 'hello');
    assert.equal(line.session_id, 'sess-logger-unit');
    assert.equal(line.foo, 'bar');
  });

  it('ctx fields merge at top-level (not nested under "ctx")', () => {
    const log = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    log.info('merge', { custom_field: 42 });
    const lines = readAllLines(fixture.logPath);
    assert.equal(lines[lines.length - 1].custom_field, 42);
    assert.equal('ctx' in lines[lines.length - 1], false);
  });
});

describe('LOG-03: per-session file + child bindings', () => {
  it('creates ~/.kodo/logs/<sessionId>.ndjson and is idempotent on re-open', () => {
    createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' }); // re-creates same file
    assert.equal(existsSync(fixture.logPath), true);
  });

  it('child() merges plane_task_id and phase_id bindings into every line', () => {
    const root = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    const child = root.child({ component: 'plane.client', plane_task_id: 'KL-42', phase_id: '06' });
    child.info('api call');
    const lines = readAllLines(fixture.logPath);
    const line = lines[lines.length - 1];
    assert.equal(line.component, 'plane.client');
    assert.equal(line.plane_task_id, 'KL-42');
    assert.equal(line.phase_id, '06');
  });
});

describe('LOG-04: stderr pretty-print anti-duplication', () => {
  it('stderr emits warn/error in pretty format (no line starts with "{")', (t) => {
    const captured = [];
    t.mock.method(process.stderr, 'write', (chunk) => {
      captured.push(chunk.toString());
      return true;
    });
    const log = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    log.warn('oops', { nested: { authorization: 'Bearer x' } });
    log.error('boom');
    for (const line of captured.join('').split('\n').filter(Boolean)) {
      assert.notEqual(line.trimStart()[0], '{', `stderr emitted JSON: ${line}`);
    }
    assert.ok(captured.join('').includes('WARN'));
    assert.ok(captured.join('').includes('ERROR'));
  });

  it('disk NDJSON still contains the same events (no duplication loss)', () => {
    const lines = readAllLines(fixture.logPath);
    assert.ok(lines.some(l => l.level === 'warn' && l.msg === 'oops'));
    assert.ok(lines.some(l => l.level === 'error' && l.msg === 'boom'));
  });
});
