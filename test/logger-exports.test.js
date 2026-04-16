import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTmpHome } from './helpers/logger-fixtures.js';

// Reservar HOME antes de cargar logger.js (evaluate-time side effects).
const fixture = makeTmpHome({ sessionId: 'sess-logger-exports', label: 'logger-exports' });
after(() => fixture.cleanup());

const mod = await import('../src/logger.js');

describe('LOG-05/06/07 exports: formatLine + COLOR_BY_LEVEL + ANSI_RESET', () => {
  it('exports ANSI_RESET as a string', () => {
    assert.equal(typeof mod.ANSI_RESET, 'string');
    assert.equal(mod.ANSI_RESET, '\x1b[0m');
  });

  it('exports COLOR_BY_LEVEL frozen map with 4 levels', () => {
    assert.equal(typeof mod.COLOR_BY_LEVEL, 'object');
    assert.equal(Object.isFrozen(mod.COLOR_BY_LEVEL), true);
    for (const lvl of ['debug', 'info', 'warn', 'error']) {
      assert.equal(typeof mod.COLOR_BY_LEVEL[lvl], 'string');
      assert.ok(mod.COLOR_BY_LEVEL[lvl].startsWith('\x1b['));
    }
  });

  it('exports formatLine(record, { useColor }) as pure function', () => {
    assert.equal(typeof mod.formatLine, 'function');
    const rec = {
      timestamp: '2026-04-16T10:30:45.123Z',
      level: 'info',
      msg: 'hello',
      session_id: 'sess-x',
      component: 'plane',
      extra: 'field',
    };
    const plain = mod.formatLine(rec, { useColor: false });
    assert.equal(plain, '10:30:45 INFO plane hello +extra=field');
  });

  it('formatLine with useColor=true wraps level with ANSI codes', () => {
    const rec = {
      timestamp: '2026-04-16T10:30:45.123Z',
      level: 'warn',
      msg: 'careful',
      session_id: 'sess-x',
    };
    const colored = mod.formatLine(rec, { useColor: true });
    assert.ok(colored.includes(mod.COLOR_BY_LEVEL.warn));
    assert.ok(colored.includes(mod.ANSI_RESET));
    assert.ok(colored.includes('WARN'));
    assert.ok(colored.includes('careful'));
  });

  it('formatLine omits component when record has no component field', () => {
    const rec = {
      timestamp: '2026-04-16T10:30:45.123Z',
      level: 'debug',
      msg: 'no comp',
      session_id: 'sess-x',
    };
    const plain = mod.formatLine(rec, { useColor: false });
    assert.equal(plain, '10:30:45 DEBUG no comp');
  });
});
