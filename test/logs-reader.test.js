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
 * HOME se fija en un tmp ANTES de cualquier dynamic import (los módulos resuelven
 * KODO_DIR en tiempo de load). Todas las tests comparten el mismo HOME; cada
 * test usa un `session_id` distinto para aislar su archivo NDJSON.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmpHome } from './helpers/logger-fixtures.js';
import { captureStdout, captureStderr } from './helpers/logger-sink.js';

// Fijar HOME ANTES de cargar reader.js. Shared HOME, per-test session_ids.
const fixture = makeTmpHome({ sessionId: '_bootstrap', label: 'reader' });
after(() => fixture.cleanup());

const { runLogs } = await import('../src/logs/reader.js');

/**
 * Semilla de un archivo `~/.kodo/logs/<sessionId>.ndjson` con las líneas dadas.
 * @param {string} sessionId
 * @param {object[]} lines
 */
function seedLog(sessionId, lines) {
  const dir = join(fixture.homeDir, '.kodo', 'logs');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${sessionId}.ndjson`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
}

describe('LOG-05: kodo logs <id> dumps full log to stdout', () => {
  it('prints every line (3 in → 3 out)', async () => {
    const sessionId = 'sess-reader-1';
    seedLog(sessionId, [
      { timestamp: '2026-04-16T10:00:00.000Z', level: 'info', msg: 'one', session_id: sessionId },
      { timestamp: '2026-04-16T10:00:01.000Z', level: 'warn', msg: 'two', session_id: sessionId },
      { timestamp: '2026-04-16T10:00:02.000Z', level: 'error', msg: 'three', session_id: sessionId },
    ]);
    const { captured } = await captureStdout(() => runLogs({ sessionId }));
    const printedLines = captured.join('').split('\n').filter(Boolean);
    assert.equal(printedLines.length, 3);
  });
});

describe('LOG-07: --level filters min level client-side', () => {
  it('--level warn drops info and debug', async () => {
    const sessionId = 'sess-reader-lvl';
    seedLog(sessionId, [
      { timestamp: '2026-04-16T10:00:00.000Z', level: 'debug', msg: 'd', session_id: sessionId },
      { timestamp: '2026-04-16T10:00:01.000Z', level: 'info', msg: 'i', session_id: sessionId },
      { timestamp: '2026-04-16T10:00:02.000Z', level: 'warn', msg: 'w', session_id: sessionId },
      { timestamp: '2026-04-16T10:00:03.000Z', level: 'error', msg: 'e', session_id: sessionId },
    ]);
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId, level: 'warn' }),
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
    const sessionId = 'sess-reader-json';
    const rec = {
      timestamp: '2026-04-16T10:00:00.000Z',
      level: 'info',
      msg: 'hello',
      session_id: sessionId,
    };
    seedLog(sessionId, [rec]);
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId, json: true }),
    );
    const parsed = JSON.parse(captured.join('').trim());
    assert.equal(parsed.msg, 'hello');
  });
});

// ---------------------------------------------------------------------------
// Phase 15 DX-01/DX-02 — Tests para src/logs/reader.js
//   Test 1: --json bypass byte-a-byte (SC#2: bytes idénticos sin importar TTY/FORCE_COLOR).
//   Test 3: FORCE_COLOR=1 + non-TTY stdout → output coloreado (D-02 Phase 14 precedence).
// ---------------------------------------------------------------------------

describe('Phase 15 SC#2: --json bypass byte-idéntico (TTY-independent, FORCE_COLOR-independent)', () => {
  it('Test 1 — --json escribe la línea NDJSON cruda sin parsear ni colorear', async () => {
    const sessionId = 'sess-reader-json-bypass';
    const rec = {
      timestamp: '2026-05-05T10:30:45.123Z',
      level: 'info',
      msg: 'x',
      session_id: sessionId,
    };
    const rawLine = JSON.stringify(rec);
    seedLog(sessionId, [rec]);

    // Stub stdout.isTTY=true + FORCE_COLOR=1 → si el formatter se invocara,
    // produciría escapes ANSI; con --json el bypass debe ignorarlos.
    const prevForce = process.env.FORCE_COLOR;
    const prevNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    try {
      const { captured } = await captureStdout(() => runLogs({ sessionId, json: true }));
      const out = captured.join('');
      // Bytes idénticos: '<raw>\n' sin tocar.
      assert.equal(out, rawLine + '\n', `expected raw NDJSON pass-through, got: ${JSON.stringify(out)}`);
      // Cero ANSI escapes — el formatter no se invoca para --json (D-03 bypass total).
      assert.equal(out.includes('\x1b['), false, `--json output must contain zero ANSI escapes, got: ${JSON.stringify(out)}`);
    } finally {
      if (prevForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prevForce;
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
      if (desc) Object.defineProperty(process.stdout, 'isTTY', desc);
      else delete process.stdout.isTTY;
    }
  });
});

describe('Phase 15 DX-02: FORCE_COLOR support en runLogs (no-TTY → coloreado vía _resolveUseColor)', () => {
  it('Test 3 — FORCE_COLOR=1 + isTTY=false → formatLine produce shape columnar (ANSI cyan)', async () => {
    const sessionId = 'sess-reader-force-color';
    const rec = {
      timestamp: '2026-05-05T10:30:45.123Z',
      level: 'info',
      msg: 'forced',
      session_id: sessionId,
      component: 'plane',
    };
    seedLog(sessionId, [rec]);

    const prevForce = process.env.FORCE_COLOR;
    const prevNoColor = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    const desc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    try {
      const { captured } = await captureStdout(() => runLogs({ sessionId }));
      const out = captured.join('');
      // FORCE_COLOR='1' debe forzar useColor=true incluso con isTTY=false.
      // El shape columnar incluye separador ' · ' y ANSI cyan (\x1b[36m) para info.
      assert.ok(out.includes('\x1b[36m'), `expected ANSI cyan (FORCE_COLOR coerced useColor=true), got: ${JSON.stringify(out)}`);
      assert.ok(out.includes(' · '), `expected columnar separator ' · ', got: ${JSON.stringify(out)}`);
    } finally {
      if (prevForce === undefined) delete process.env.FORCE_COLOR;
      else process.env.FORCE_COLOR = prevForce;
      if (prevNoColor === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNoColor;
      if (desc) Object.defineProperty(process.stdout, 'isTTY', desc);
      else delete process.stdout.isTTY;
    }
  });
});

describe('D-02: --component filter', () => {
  it('keeps only matching component', async () => {
    const sessionId = 'sess-reader-comp';
    seedLog(sessionId, [
      { timestamp: '2026-04-16T10:00:00.000Z', level: 'info', msg: 'a', session_id: sessionId, component: 'plane' },
      { timestamp: '2026-04-16T10:00:01.000Z', level: 'info', msg: 'b', session_id: sessionId, component: 'session' },
    ]);
    const { captured } = await captureStdout(() =>
      runLogs({ sessionId, component: 'plane' }),
    );
    const text = captured.join('');
    assert.ok(text.includes(' a'));
    assert.ok(!text.includes(' b'));
  });
});

describe('D-02: --event-type filter (array, repeatable)', () => {
  it('keeps only lines with event in the array', async () => {
    const sessionId = 'sess-reader-et';
    seedLog(sessionId, [
      { timestamp: '2026-04-16T10:00:00.000Z', level: 'info', msg: 's', session_id: sessionId, event: 'session.start' },
      { timestamp: '2026-04-16T10:00:01.000Z', level: 'info', msg: 'p', session_id: sessionId, event: 'plane.api.call' },
      { timestamp: '2026-04-16T10:00:02.000Z', level: 'info', msg: 'e', session_id: sessionId, event: 'session.end' },
    ]);
    const { captured } = await captureStdout(() =>
      runLogs({
        sessionId,
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
    const sessionId = 'sess-reader-bad';
    const dir = join(fixture.homeDir, '.kodo', 'logs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${sessionId}.ndjson`),
      JSON.stringify({ timestamp: '2026-04-16T10:00:00.000Z', level: 'info', msg: 'ok', session_id: sessionId }) +
        '\n' +
        '{not valid json\n' +
        JSON.stringify({ timestamp: '2026-04-16T10:00:02.000Z', level: 'info', msg: 'after', session_id: sessionId }) +
        '\n',
    );
    const { captured } = await captureStdout(() => runLogs({ sessionId }));
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
