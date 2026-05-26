// @ts-check
//
// test/dashboard-render.test.js — Phase 34 Wave 0 (TUI-01 + TUI-03 parcial).
//
// Renderiza el componente `App` del dashboard con ink-testing-library (TTY
// falso, sin necesidad de terminal real) y verifica:
//   1. El chrome D-01: banner "kodo dashboard", placeholder "starting…"
//      (U+2026, NO tres puntos ASCII) y footer hint "q quit".
//   2. (TUI-03 parcial) que pulsar `q` dispara un desmonte limpio vía
//      useApp().exit() (D-08): ink emite un frame de unmount adicional que una
//      tecla ignorada (p. ej. `x`) NO produce.
//
// La aserción de q→exit es de comportamiento OBSERVABLE (no un stdin.write('q')
// hueco) y CONTROLADA: se compara el conteo de frames tras `q` (desmonte → +1
// frame) contra una tecla que App ignora (sin re-render). Si `q` no desmontara
// (regresión: process.exit en vez de exit(), o binding roto), no habría frame
// extra y el test falla. Esto da cobertura automatizada real a TUI-03 (la
// restauración de terminal tras Ctrl-C/SIGTERM en TTY real sigue siendo UAT
// manual — no automatizable sin PTY).
//
// NOTA (Plan 02 — RESEARCH A3 / Plan 01 Decisión 2): la firma concreta de la
// aserción q→exit se delegó al implementador. `ink-testing-library@4.0.0` NO
// expone `waitUntilExit()` en el instance que retorna (solo rerender/unmount/
// cleanup/stdout/stderr/stdin/frames/lastFrame); ese método vive en el render()
// real de `ink`, no en el harness. La aserción observable equivalente bajo este
// harness es el frame de unmount que `exit()` emite.
//
// Estado Wave 0: ROJO por diseño hasta que Plan 02 cree
// `src/cli/dashboard/App.js` (default export del componente). Hoy el import
// falla porque el archivo no existe — es la mordida esperada del Nyquist gate.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

describe('TUI-01: dashboard chrome (D-01)', () => {
  it('renders banner + starting placeholder + q quit footer', () => {
    const { lastFrame } = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    const frame = lastFrame();
    assert.match(frame, /kodo dashboard/, `banner missing\nframe:\n${frame}`);
    // "starting…" usa U+2026 (HORIZONTAL ELLIPSIS), NO tres puntos ASCII.
    assert.match(frame, /starting…/, `placeholder "starting…" (U+2026) missing\nframe:\n${frame}`);
    assert.match(frame, /q quit/, `footer hint "q quit" missing\nframe:\n${frame}`);
  });

  it('q triggers clean exit (extra unmount frame vs an ignored key)', async () => {
    // Espera breve para que ink procese el keystroke y re-renderice/desmonte.
    const tick = () => new Promise((r) => setTimeout(r, 80));

    // Control: una tecla que App ignora (D-11 — solo `q` sale). No re-render.
    const ignored = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    const baselineFrames = ignored.frames.length; // render inicial
    ignored.stdin.write('x');
    await tick();
    assert.equal(
      ignored.frames.length,
      baselineFrames,
      `una tecla ignorada NO debe producir frames extra\nframes: ${ignored.frames.length} (baseline ${baselineFrames})`,
    );
    ignored.unmount();

    // `q` → useApp().exit() → ink desmonta y emite un frame adicional (clear).
    // Si `q` NO desmontara (regresión: process.exit en vez de exit(), o binding
    // roto), no habría frame extra → este assert falla con mensaje accionable.
    const quitting = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    const beforeQuit = quitting.frames.length; // render inicial (== baseline)
    quitting.stdin.write('q');
    await tick();
    assert.ok(
      quitting.frames.length > beforeQuit,
      `q debe disparar un desmonte limpio (frame extra de unmount)\n` +
        `frames antes: ${beforeQuit}, después: ${quitting.frames.length}`,
    );
    quitting.unmount();
  });
});
