import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpHome } from './helpers/logger-fixtures.js';

// Reservar HOME antes de cargar cualquier módulo que dependa de KODO_DIR.
const fixture = makeTmpHome({ sessionId: 'sess-reader-dump', label: 'reader' });
after(() => fixture.cleanup());

// Escribir un NDJSON de 5 líneas con 4 niveles, 2 components, 2 events,
// y una línea malformada intercalada.
const logsDir = join(fixture.homeDir, '.kodo', 'logs');
mkdirSync(logsDir, { recursive: true });

const LINES = [
  { timestamp: '2026-04-16T10:00:00.100Z', level: 'debug', session_id: 'sess-reader-dump', component: 'session', msg: 'debug line', custom: 'a' },
  { timestamp: '2026-04-16T10:00:01.200Z', level: 'info',  session_id: 'sess-reader-dump', component: 'plane',   msg: 'info line',  event: 'plane.api.call', method: 'GET' },
  { timestamp: '2026-04-16T10:00:02.300Z', level: 'warn',  session_id: 'sess-reader-dump', component: 'session', msg: 'warn line',  event: 'session.start' },
  { timestamp: '2026-04-16T10:00:03.400Z', level: 'error', session_id: 'sess-reader-dump', component: 'plane',   msg: 'error line' },
];
const MALFORMED = '{not json';

const filePath = join(logsDir, 'sess-reader-dump.ndjson');
writeFileSync(
  filePath,
  LINES.slice(0, 2).map((l) => JSON.stringify(l)).join('\n') +
    '\n' + MALFORMED + '\n' +
    LINES.slice(2).map((l) => JSON.stringify(l)).join('\n') + '\n',
);

const { runLogs } = await import('../src/logs/reader.js');

/**
 * Helper: mock stdout and stderr.write, run action, return captured strings.
 * @param {import('node:test').TestContext} t
 * @param {() => Promise<void>} fn
 */
async function captureIO(t, fn) {
  const stdout = [];
  const stderr = [];
  t.mock.method(process.stdout, 'write', (chunk) => {
    stdout.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  t.mock.method(process.stderr, 'write', (chunk) => {
    stderr.push(typeof chunk === 'string' ? chunk : chunk.toString());
    return true;
  });
  await fn();
  return { stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('LOG-05: runLogs dump (no filters)', () => {
  it('prints all valid lines and flags malformed inline', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump' }),
    );
    // 4 pretty lines + 1 malformed
    assert.ok(stdout.includes('debug line'), 'debug line missing');
    assert.ok(stdout.includes('info line'), 'info line missing');
    assert.ok(stdout.includes('warn line'), 'warn line missing');
    assert.ok(stdout.includes('error line'), 'error line missing');
    assert.ok(stdout.includes('[malformed] {not json'), 'malformed tag missing');
  });
});

describe('LOG-07: runLogs --level filter', () => {
  it('level=warn drops debug/info, keeps warn/error', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump', level: 'warn' }),
    );
    assert.equal(stdout.includes('debug line'), false);
    assert.equal(stdout.includes('info line'), false);
    assert.ok(stdout.includes('warn line'));
    assert.ok(stdout.includes('error line'));
  });
});

describe('D-02: --component filter (client-side)', () => {
  it('component=plane keeps only plane component lines', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump', component: 'plane' }),
    );
    assert.ok(stdout.includes('info line'));
    assert.ok(stdout.includes('error line'));
    assert.equal(stdout.includes('debug line'), false);
    assert.equal(stdout.includes('warn line'), false);
  });
});

describe('D-02: --event-type filter (variadic)', () => {
  it('eventType=[session.start, plane.api.call] keeps only those events', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump', eventType: ['session.start', 'plane.api.call'] }),
    );
    assert.ok(stdout.includes('info line')); // plane.api.call
    assert.ok(stdout.includes('warn line')); // session.start
    assert.equal(stdout.includes('debug line'), false); // no event
    assert.equal(stdout.includes('error line'), false); // no event
  });
});

describe('D-02: --json raw output', () => {
  it('json=true prints raw NDJSON lines (starts with {)', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump', json: true }),
    );
    const lines = stdout.split('\n').filter(Boolean);
    // 4 JSON + 1 malformed passthrough (not json, but --json dumps raw)
    assert.equal(lines.length, 5);
    // First line must be raw JSON for "debug line"
    assert.ok(lines[0].startsWith('{'));
    assert.ok(lines[0].includes('"debug line"'));
  });
});

describe('D-06: malformed lines graceful', () => {
  it('prints [malformed] tag then continues to next line', async (t) => {
    const { stdout } = await captureIO(t, () =>
      runLogs({ sessionId: 'sess-reader-dump' }),
    );
    // malformed line should appear between info and warn
    const malformedIdx = stdout.indexOf('[malformed]');
    const warnIdx = stdout.indexOf('warn line');
    assert.ok(malformedIdx > 0, 'malformed missing');
    assert.ok(warnIdx > malformedIdx, 'reader did not continue after malformed');
  });
});
