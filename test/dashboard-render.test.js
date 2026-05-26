// @ts-check
//
// test/dashboard-render.test.js — Phase 34 Wave 0 (TUI-01 + TUI-03 parcial).
//
// Renderiza el componente `App` del dashboard con ink-testing-library (TTY
// falso, sin necesidad de terminal real) y verifica:
//   1. El chrome D-01: banner "kodo dashboard", placeholder "starting…"
//      (U+2026, NO tres puntos ASCII) y footer hint "q quit".
//   2. (TUI-03 parcial) que pulsar `q` desmonta el componente limpio:
//      `instance.waitUntilExit()` resuelve ANTES de un timeout de ~1s.
//
// La aserción de q→exit es de comportamiento OBSERVABLE (no un stdin.write('q')
// hueco): se corre una carrera entre `waitUntilExit()` y un timeout; si el
// timeout gana, el await lanza y el test falla. Esto da cobertura automatizada
// real a TUI-03 (la restauración de terminal tras Ctrl-C/SIGTERM en TTY real
// sigue siendo UAT manual — no automatizable sin PTY).
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

  it('q triggers clean exit (waitUntilExit resolves before ~1s timeout)', async () => {
    const instance = render(createElement(App, { baseUrl: 'http://localhost:9090' }));
    instance.stdin.write('q');

    // Carrera: si `q` desmonta limpio, waitUntilExit() resuelve y gana.
    // Si NO desmonta (regresión), el timeout rechaza a ~1s y el await lanza
    // → el test falla con un mensaje accionable. Aserción de comportamiento
    // observable concreto, NO un stdin.write sin assert.
    /** @type {NodeJS.Timeout} */
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('q no salió en 1s (waitUntilExit no resolvió)')), 1000);
    });

    try {
      await Promise.race([instance.waitUntilExit(), timeout]);
    } finally {
      clearTimeout(timer);
    }
    // Si llegamos aquí sin lanzar, waitUntilExit() ganó la carrera → q desmontó.
  });
});
