// @ts-check
//
// test/dashboard/text-input-atomic.test.js — regresión de la TRANSPOSICIÓN del text-input.
//
// EL BUG. `buffer` y `cursor` son dos estados de React, pero toda edición los toca a la vez y el
// nuevo buffer DEPENDE del cursor. Los handlers los escribían con dos updaters independientes:
//
//     ctx.setBuffer((b) => b.slice(0, ctx.cursor) + input + b.slice(ctx.cursor));  // ctx.cursor OBSOLETO
//     ctx.setCursor((c) => c + input.length);                                      // c fresco
//
// El updater de `buffer` recibe `b` fresco pero lee `cursor` del CLOSURE del render. Dos
// pulsaciones en el MISMO batch de React —teclear rápido, un paste, o un runner de CI lento— y la
// segunda inserta en la posición anterior: los caracteres salen TRANSPUESTOS.
//
// CÓMO SE CAZÓ. Como flake de `app-setup.test.js` en `node 24 · macos-latest`, con el assert
// `onSaveApiKey recibe el valor tecleado` fallando por `sks-ecret-123` en vez de `sk-secret-123`.
// No era del test: los otros 3 jobs pasaban solo porque su drain de 80 ms alcanzaba a vaciar el
// batch. El síntoma real es de PRODUCCIÓN — un operador tecleando deprisa su API key en el wizard
// la guardaba barajada.
//
// LA PRUEBA. `stdin.write` DOS VECES SIN drain entre medias fuerza el batch de forma determinista:
// antes del arreglo esto rendía `ba`; ahora rinde `ab`. Es la única forma de fijar el bug sin
// depender de la velocidad de la máquina, que es justo lo que lo hacía flaky.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, { SETUP_STEP_BASE_URL, SETUP_STEP_APIKEY, SETUP_STEP_WORKSPACE } from '../../src/cli/dashboard/App.js';

const SETUP_CONFIG_FIXTURE = {
  provider: 'plane',
  providers: { plane: { base_url: '', workspace_slug: '', api_key_env: 'PLANE_API_KEY' } },
};

function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nextTimeoutHandle = 10000;
  return {
    schedule: (/** @type {Function} */ fn) => { const handle = nextHandle++; pending.push({ handle, fn }); return handle; },
    cancel: (/** @type {number} */ handle) => { pending = pending.filter((p) => p.handle !== handle); },
    scheduleTimeout: () => nextTimeoutHandle++,
    cancelTimeout: () => {},
    now: () => startMs,
  };
}

function injectProps(clock, extra = {}) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ count: 0, sessions: [] }) }),
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
    setup: true,
    loadConfigFn: () => structuredClone(SETUP_CONFIG_FIXTURE),
    ...extra,
  };
}

const drain = () => new Promise((resolve) => setTimeout(resolve, 80));

/** Teclea la cadena entera SIN drain: todas las pulsaciones caen en el mismo batch. */
function typeBurst(stdin, text) {
  for (const ch of text) stdin.write(ch);
}

/**
 * VALOR del renglón editado, aislado del resto del frame.
 *
 * Load-bearing para los asserts negativos: el marco pinta la ETIQUETA del campo (`base_url`), que
 * ya contiene subcadenas como `ba`. Buscar la firma del bug en el frame entero daría un falso
 * positivo por la propia etiqueta, así que se recorta a lo que hay DESPUÉS de `<campo>:`.
 *
 * @param {string} frame
 * @param {string} field
 * @returns {string}
 */
function fieldValue(frame, field) {
  const line = frame.split('\n').find((l) => l.includes(`${field}:`)) ?? '';
  return line.slice(line.indexOf(`${field}:`) + field.length + 1).replace(/[│|]/g, '').trim();
}

describe('text-input del dashboard: (buffer, cursor) se mutan de forma ATÓMICA', () => {
  it('dos teclas en un mismo batch NO se transponen (antes: "ab" → "ba")', async () => {
    const clock = makeFakeClock();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock)));
    try {
      await drain();
      stdin.write('\r'); // plane → base_url
      await drain();
      assert.ok(lastFrame().includes(SETUP_STEP_BASE_URL), 'precondición: estamos en base_url');

      typeBurst(stdin, 'ab');
      await drain();

      const frame = lastFrame();
      assert.equal(fieldValue(frame, 'base_url'), 'ab', `el campo debe valer "ab"; "ba" es la firma exacta del bug de cursor obsoleto\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('una ráfaga larga preserva el ORDEN completo (el caso del CI: sk-secret-123)', async () => {
    const clock = makeFakeClock();
    /** @type {string[]} */
    const saved = [];
    const { lastFrame, stdin, unmount } = render(
      createElement(App, injectProps(clock, {
        onSaveConfig: async () => ({ ok: true }),
        onSaveApiKey: async (/** @type {string} */ _k, /** @type {string} */ v) => { saved.push(v); return { ok: true }; },
      })),
    );
    const SECRET = 'sk-secret-123';
    try {
      await drain();
      stdin.write('\r');
      await drain();
      typeBurst(stdin, 'https://tasks.test');
      await drain();
      stdin.write('\r');
      await drain();
      assert.ok(lastFrame().includes(SETUP_STEP_WORKSPACE), 'precondición: paso workspace_slug');
      typeBurst(stdin, 'my-workspace');
      await drain();
      stdin.write('\r');
      await drain();
      assert.ok(lastFrame().includes(SETUP_STEP_APIKEY), 'precondición: paso apikey');

      // La ráfaga que reventaba en CI, ahora en el peor caso posible: cero drains intermedios.
      typeBurst(stdin, SECRET);
      await drain();
      stdin.write('\r');
      await drain();
      await drain(); // ink no awaitea el handler async

      assert.deepEqual(saved, [SECRET], 'onSaveApiKey debe recibir el secreto en el ORDEN tecleado');
    } finally {
      unmount();
    }
  });

  it('el backspace en ráfaga borra desde el final, sin comerse caracteres de más', async () => {
    const clock = makeFakeClock();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock)));
    try {
      await drain();
      stdin.write('\r');
      await drain();
      typeBurst(stdin, 'abcde');
      await drain();

      // Tres backspaces en el mismo batch: cada uno debe ver el cursor que dejó el anterior.
      typeBurst(stdin, '\x7f\x7f\x7f');
      await drain();

      const frame = lastFrame();
      assert.equal(fieldValue(frame, 'base_url'), 'ab', `tres backspaces sobre "abcde" deben dejar "ab"\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('mover el cursor y luego insertar en ráfaga respeta la posición (inserción en medio)', async () => {
    const clock = makeFakeClock();
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock)));
    try {
      await drain();
      stdin.write('\r');
      await drain();
      typeBurst(stdin, 'ad');
      await drain();

      stdin.write('\x1b[D'); // ← una posición: el cursor queda entre `a` y `d`
      await drain();

      typeBurst(stdin, 'bc'); // inserción EN medio, en un solo batch
      await drain();

      const frame = lastFrame();
      assert.equal(fieldValue(frame, 'base_url'), 'abcd', `la inserción en medio debe dar "abcd"\n${frame}`);
    } finally {
      unmount();
    }
  });
});
