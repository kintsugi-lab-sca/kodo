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

  it('formatLine with useColor=true wraps level with ANSI codes (Phase 15: columnar shape via picocolors)', () => {
    const rec = {
      timestamp: '2026-04-16T10:30:45.123Z',
      level: 'warn',
      msg: 'careful',
      session_id: 'sess-x',
    };
    const colored = mod.formatLine(rec, { useColor: true });
    // Phase 15 D-02: en TTY shape columnar, level chip va por createFormatter().warn
    // (picocolors), que usa escape `\x1b[33m...\x1b[39m` (color-off, NO full reset).
    // Validamos presencia del escape ANSI yellow (33) que es invariante entre
    // mecanismos (raw ANSI inline pre-Phase-15 y picocolors post-Phase-14).
    assert.ok(colored.includes('\x1b[33m'), `expected ANSI yellow escape, got: ${JSON.stringify(colored)}`);
    assert.ok(colored.includes('WARN'));
    assert.ok(colored.includes('careful'));
    // ANSI_RESET sigue exportándose para writeNdjson y backwards-compat (Phase 15
    // no toca esa surface), aunque ya no aparezca en formatLine TTY output.
    assert.equal(typeof mod.ANSI_RESET, 'string');
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
