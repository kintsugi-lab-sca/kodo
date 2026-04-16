// @ts-check
/**
 * LOG-05/LOG-07 + D-02/D-03/D-06 contract tests for `kodo logs <session>` reader.
 *
 * Valida:
 *  - LOG-05: dump completo a stdout (3 líneas → 3 líneas).
 *  - LOG-07: `--level warn` descarta info/debug client-side.
 *  - D-02 `--component`: filtra por componente exacto.
 *  - D-02 `--event-type`: filtra por array de event types.
 *  - D-02/D-03 `--json`: imprime NDJSON crudo (pipe-friendly para jq).
 *  - D-06: línea malformada NO crashea — imprime `[malformed] <raw>` y continúa.
 *
 * `../src/logs/reader.js` no existe todavía — Plan 07-03 lo crea. Hasta entonces
 * este test falla con ERR_MODULE_NOT_FOUND (Nyquist-expected).
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpHome } from './helpers/logger-fixtures.js';
import { captureStdout, captureStderr } from './helpers/logger-sink.js';

/**
 * Semilla de un archivo `~/.kodo/logs/<sessionId>.ndjson` con las líneas dadas.
 * Cada entrada se serializa con `JSON.stringify` y se separa por `\n`.
 * @param {string} homeDir
 * @param {string} sessionId
 * @param {object[]} lines
 */
function seedLog(homeDir, sessionId, lines) {
  const dir = join(homeDir, '.kodo', 'logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.ndjson`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('LOG-05: kodo logs <id> dumps full log to stdout', () => {
  it('prints every line (3 in → 3 out)', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-1', label: 'reader' });
    after(() => fx.cleanup());
    seedLog(fx.homeDir, 'sess-reader-1', [
      {
        timestamp: '2026-04-16T10:00:00.000Z',
        level: 'info',
        msg: 'one',
        session_id: 'sess-reader-1',
      },
      {
        timestamp: '2026-04-16T10:00:01.000Z',
        level: 'warn',
        msg: 'two',
        session_id: 'sess-reader-1',
      },
      {
        timestamp: '2026-04-16T10:00:02.000Z',
        level: 'error',
        msg: 'three',
        session_id: 'sess-reader-1',
      },
    ]);
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() => runLogs({ sessionId: 'sess-reader-1' }));
    const printedLines = captured.join('').split('\n').filter(Boolean);
    assert.equal(printedLines.length, 3);
  });
});

describe('LOG-07: --level filters min level client-side', () => {
  it('--level warn drops info and debug', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-lvl', label: 'reader-lvl' });
    after(() => fx.cleanup());
    seedLog(fx.homeDir, 'sess-reader-lvl', [
      {
        timestamp: '2026-04-16T10:00:00.000Z',
        level: 'debug',
        msg: 'd',
        session_id: 'sess-reader-lvl',
      },
      {
        timestamp: '2026-04-16T10:00:01.000Z',
        level: 'info',
        msg: 'i',
        session_id: 'sess-reader-lvl',
      },
      {
        timestamp: '2026-04-16T10:00:02.000Z',
        level: 'warn',
        msg: 'w',
        session_id: 'sess-reader-lvl',
      },
      {
        timestamp: '2026-04-16T10:00:03.000Z',
        level: 'error',
        msg: 'e',
        session_id: 'sess-reader-lvl',
      },
    ]);
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId: 'sess-reader-lvl', level: 'warn' }),
    );
    const text = captured.join('');
    assert.ok(!text.includes(' d'), 'debug line should be filtered out');
    assert.ok(!text.includes(' i'), 'info line should be filtered out');
    assert.ok(text.includes(' w'));
    assert.ok(text.includes(' e'));
  });
});

describe('LOG-05: --json emits raw NDJSON (pipe-friendly)', () => {
  it('prints valid JSON lines unchanged', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-json', label: 'reader-json' });
    after(() => fx.cleanup());
    const rec = {
      timestamp: '2026-04-16T10:00:00.000Z',
      level: 'info',
      msg: 'hello',
      session_id: 'sess-reader-json',
    };
    seedLog(fx.homeDir, 'sess-reader-json', [rec]);
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId: 'sess-reader-json', json: true }),
    );
    const parsed = JSON.parse(captured.join('').trim());
    assert.equal(parsed.msg, 'hello');
  });
});

describe('D-02: --component filter', () => {
  it('keeps only matching component', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-comp', label: 'reader-comp' });
    after(() => fx.cleanup());
    seedLog(fx.homeDir, 'sess-reader-comp', [
      {
        timestamp: '2026-04-16T10:00:00.000Z',
        level: 'info',
        msg: 'a',
        session_id: 'sess-reader-comp',
        component: 'plane',
      },
      {
        timestamp: '2026-04-16T10:00:01.000Z',
        level: 'info',
        msg: 'b',
        session_id: 'sess-reader-comp',
        component: 'session',
      },
    ]);
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId: 'sess-reader-comp', component: 'plane' }),
    );
    const text = captured.join('');
    assert.ok(text.includes(' a'));
    assert.ok(!text.includes(' b'));
  });
});

describe('D-02: --event-type filter (array, repeatable)', () => {
  it('keeps only lines with event in the array', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-et', label: 'reader-et' });
    after(() => fx.cleanup());
    seedLog(fx.homeDir, 'sess-reader-et', [
      {
        timestamp: '2026-04-16T10:00:00.000Z',
        level: 'info',
        msg: 's',
        session_id: 'sess-reader-et',
        event: 'session.start',
      },
      {
        timestamp: '2026-04-16T10:00:01.000Z',
        level: 'info',
        msg: 'p',
        session_id: 'sess-reader-et',
        event: 'plane.api.call',
      },
      {
        timestamp: '2026-04-16T10:00:02.000Z',
        level: 'info',
        msg: 'e',
        session_id: 'sess-reader-et',
        event: 'session.end',
      },
    ]);
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() =>
      runLogs({
        sessionId: 'sess-reader-et',
        eventType: ['session.start', 'session.end'],
      }),
    );
    const text = captured.join('');
    assert.ok(text.includes(' s'));
    assert.ok(!text.includes(' p'));
    assert.ok(text.includes(' e'));
  });
});

describe('D-06: malformed line does not crash reader', () => {
  it('prints [malformed] prefix and continues', async () => {
    const fx = makeTmpHome({ sessionId: 'sess-reader-bad', label: 'reader-bad' });
    after(() => fx.cleanup());
    const dir = join(fx.homeDir, '.kodo', 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'sess-reader-bad.ndjson'),
      JSON.stringify({
        timestamp: '2026-04-16T10:00:00.000Z',
        level: 'info',
        msg: 'ok',
        session_id: 'sess-reader-bad',
      }) +
        '\n' +
        '{not valid json\n' +
        JSON.stringify({
          timestamp: '2026-04-16T10:00:02.000Z',
          level: 'info',
          msg: 'after',
          session_id: 'sess-reader-bad',
        }) +
        '\n',
    );
    const { runLogs } = await import('../src/logs/reader.js');
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId: 'sess-reader-bad' }),
    );
    const text = captured.join('');
    assert.ok(text.includes('[malformed]'));
    assert.ok(text.includes('ok'));
    assert.ok(text.includes('after'));
  });
});

// captureStderr is imported to keep the symbol wired for future error-path
// tests added by Plan 07-03 (e.g. session-id that does not exist as a file
// triggers a stderr warning + process.exit(1)). Referenced here so unused-import
// linters do not strip it during ecosystem churn.
void captureStderr;
