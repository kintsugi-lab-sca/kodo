// @ts-check
//
// test/dashboard-render.test.js — Phase 34 Wave 0 (TUI-01 + TUI-03 parcial).
//
// Renderiza el componente `App` del dashboard con ink-testing-library (TTY
// falso, sin necesidad de terminal real) y verifica:
//   1. El chrome D-01: banner "kodo dashboard", el nodo central de arranque
//      (Phase 35: "waiting for server" — reemplazó el placeholder "starting…"
//      de Phase 34) y footer hint "q quit". La cobertura de los estados vivos
//      live/stale de la status line vive en test/dashboard-status-line.test.js.
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

// fetchFn no-op (Phase 35): el placeholder estático `starting…` de Phase 34 se reemplazó por la
// status line viva (Plan 03). En el frame inicial — antes de que resuelva el primer poll — la
// status line muestra `waiting for server` (estado de arranque sin dato bueno, D-06). Inyectamos
// un fetchFn que nunca resuelve para que el chrome se asserte sobre ese frame inicial sin tocar la
// red (la cobertura de la status line viva vive en test/dashboard-status-line.test.js).
const NEVER_FETCH = () => new Promise(() => {});

describe('TUI-01: dashboard chrome (D-01)', () => {
  it('renders banner + waiting placeholder + q quit footer', () => {
    const { lastFrame } = render(
      createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: NEVER_FETCH }),
    );
    const frame = lastFrame();
    assert.match(frame, /kodo dashboard/, `banner missing\nframe:\n${frame}`);
    // Phase 35: el nodo central inicial es la status line de arranque `waiting for server`
    // (reemplaza el `starting…` de Phase 34). Cobertura de los estados live/stale en
    // test/dashboard-status-line.test.js.
    assert.match(frame, /waiting for server/, `status line de arranque "waiting for server" missing\nframe:\n${frame}`);
    // Phase 56: la línea de hints se extendió con `· a adopt`; a este ancho ink la envuelve a dos
    // líneas, partiendo `q quit`. Se colapsan bordes (│) + whitespace para tolerar el wrap.
    assert.match(frame.replace(/[│\s]+/g, ' '), /q quit/, `footer hint "q quit" missing\nframe:\n${frame}`);
  });

  it('q triggers clean exit (extra unmount frame vs an ignored key)', async () => {
    // Espera breve para que ink procese el keystroke y re-renderice/desmonte.
    const tick = () => new Promise((r) => setTimeout(r, 80));

    // Control: una tecla que App ignora (D-11 — solo `q` sale). No re-render.
    // fetchFn NEVER_FETCH (Phase 35): el poll nunca resuelve → ningún re-render por onResult
    // contamina el conteo de frames (test hermético, sin red).
    const ignored = render(createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: NEVER_FETCH }));
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
    const quitting = render(createElement(App, { baseUrl: 'http://localhost:9090', fetchFn: NEVER_FETCH }));
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
