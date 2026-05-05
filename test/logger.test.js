import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';

// Set HOME before dynamic import of logger.js (module evaluates KODO_DIR at load time)
const fixture = makeTmpHome({ sessionId: 'sess-logger-unit', label: 'logger-unit' });
after(() => fixture.cleanup());

const { createLogger, formatLine } = await import('../src/logger.js');

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

  it('child() merges task_id and phase_id bindings into every line', () => {
    const root = createLogger({ sessionId: 'sess-logger-unit', minLevel: 'debug' });
    const child = root.child({ component: 'plane.client', task_id: 'KL-42', phase_id: '06' });
    child.info('api call');
    const lines = readAllLines(fixture.logPath);
    const line = lines[lines.length - 1];
    assert.equal(line.component, 'plane.client');
    assert.equal(line.task_id, 'KL-42');
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

// ---------------------------------------------------------------------------
// Phase 15 — DX-01 / DX-02: shape dual condicionado a useColor (D-02 Phase 15)
// + FORCE_COLOR support via _resolveUseColor (D-02 Phase 14).
// ---------------------------------------------------------------------------

describe('Phase 15 DX-01/DX-02: formatLine NO_COLOR branch (golden bytes preservation, SC#1)', () => {
  it('Test 1 — sin component, sin ctx: bytes pre-Phase-15 byte-a-byte', () => {
    const out = formatLine(
      { timestamp: '2026-05-05T10:30:45.123Z', level: 'info', msg: 'hello' },
      { useColor: false },
    );
    assert.equal(out, '10:30:45 INFO hello');
  });

  it('Test 2 — con component: single space, sin separator middle-dot', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'info',
        component: 'dispatcher',
        msg: 'go',
      },
      { useColor: false },
    );
    assert.equal(out, '10:30:45 INFO dispatcher go');
  });

  it('Test 3 — con ctx extras: task_id excluido (BASE_RECORD_KEYS), `extra` se anexa como +k=v', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'warn',
        component: 'lock',
        msg: 'busy',
        task_id: 'KL-1',
        extra: 7,
      },
      { useColor: false },
    );
    assert.equal(out, '10:30:45 WARN lock busy +extra=7');
  });
});

describe('Phase 15 DX-02: formatLine TTY branch (columnar shape with widths fijas)', () => {
  it('Test 4 — shape columnar: timestamp + " · " separator x3 + component padded a 12 + ANSI cyan around level', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'info',
        component: 'dispatcher',
        msg: 'go',
      },
      { useColor: true },
    );
    // (a) timestamp literal presente
    assert.ok(out.includes('10:30:45'), `timestamp missing: ${JSON.stringify(out)}`);
    // (b) separator ' · ' aparece exactamente 3 veces (timestamp · level · component · msg)
    const sepCount = out.split(' · ').length - 1;
    assert.equal(sepCount, 3, `expected 3 separators, got ${sepCount} in ${JSON.stringify(out)}`);
    // (c) component 'dispatcher' (10 chars) padded a 12 con 2 espacios trailing
    assert.ok(
      out.includes('dispatcher  '),
      `component not padded to 12: ${JSON.stringify(out)}`,
    );
    // (d) ANSI cyan (\x1b[36m) alrededor del nivel info
    assert.ok(out.includes('\x1b[36m'), `ANSI cyan missing for info level: ${JSON.stringify(out)}`);
    assert.ok(out.includes('INFO'), `level upper-cased present`);
  });

  it('Test 5 — TTY component vacío: columna se rellena con 12 espacios (alineación vertical D-06)', () => {
    const out = formatLine(
      { timestamp: '2026-05-05T10:30:45.123Z', level: 'info', msg: 'go' },
      { useColor: true },
    );
    // Esperamos: <time> · <colored INFO> · <12 spaces> · go
    // El campo component vacío se debe presentar como 12 espacios literales,
    // delimitados por separators ` · ` (espacio + middle-dot + espacio).
    // Entre los dos middle-dots: 1 (separator suffix) + 12 (cell) + 1 (separator prefix) = 14 espacios.
    const fourteenSpaces = ' '.repeat(14);
    assert.ok(
      out.includes(`·${fourteenSpaces}·`),
      `expected 12-space empty component cell padded between separators, got: ${JSON.stringify(out)}`,
    );
    // Cross-check: msg literal aparece después del último separator
    assert.ok(out.endsWith(' · go'), `expected ' · go' at tail, got: ${JSON.stringify(out)}`);
  });

  it('Test 6 — TTY component >12 chars no truncado (D-05 pad-only)', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'info',
        component: 'gsd-bootstrap', // 13 chars
        msg: 'go',
      },
      { useColor: true },
    );
    // El component se preserva intacto (sin truncate), separator literal después.
    assert.ok(
      out.includes('gsd-bootstrap · go'),
      `component truncated or padded: ${JSON.stringify(out)}`,
    );
  });

  it('Test 7 — TTY level=ERROR contiene ANSI rojo (\\x1b[31m)', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'error',
        component: 'plane',
        msg: 'kaboom',
      },
      { useColor: true },
    );
    assert.ok(out.includes('\x1b[31m'), `ANSI red missing for error level: ${JSON.stringify(out)}`);
    assert.ok(out.includes('ERROR'));
  });

  it('Test (extra) — TTY ctx extras: se anexan tras el row con prefix " +k=v"', () => {
    const out = formatLine(
      {
        timestamp: '2026-05-05T10:30:45.123Z',
        level: 'warn',
        component: 'lock',
        msg: 'busy',
        extra: 7,
      },
      { useColor: true },
    );
    assert.ok(
      out.endsWith('busy +extra=7'),
      `expected ctx suffix ' +extra=7' at end, got: ${JSON.stringify(out)}`,
    );
  });
});

describe('Phase 15 DX-02: FORCE_COLOR support via _resolveUseColor in createLogger', () => {
  it('Test 8 — FORCE_COLOR=1 + non-TTY stderr → mirror writes ANSI-colored output', (t) => {
    // Stub stderr.isTTY=false + FORCE_COLOR='1' before createLogger; assert
    // stderr mirror output contains ANSI escape (yellow for warn).
    const prevForce = process.env.FORCE_COLOR;
    const prevNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';

    // Stub isTTY=false on stderr
    const desc = Object.getOwnPropertyDescriptor(process.stderr, 'isTTY');
    Object.defineProperty(process.stderr, 'isTTY', { value: false, configurable: true });

    const captured = [];
    t.mock.method(process.stderr, 'write', (chunk) => {
      captured.push(chunk.toString());
      return true;
    });

    try {
      const log = createLogger({ sessionId: 'sess-force-color', minLevel: 'debug' });
      log.warn('forced color check');
      const out = captured.join('');
      // FORCE_COLOR='1' debe forzar useColor=true incluso con isTTY=false → ANSI yellow.
      assert.ok(
        out.includes('\x1b[33m'),
        `expected ANSI yellow (FORCE_COLOR coerced useColor=true), got: ${JSON.stringify(out)}`,
      );
    } finally {
      // Restaurar env
      if (prevForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prevForce;
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
      // Restaurar isTTY descriptor
      if (desc) Object.defineProperty(process.stderr, 'isTTY', desc);
      else delete process.stderr.isTTY;
    }
  });
});
