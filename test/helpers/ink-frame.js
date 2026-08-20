// @ts-check
//
// test/helpers/ink-frame.js — sincronización con el repintado de Ink en los tests del dashboard.
//
// Problema que resuelve (KODO-25): los tests de `App` renderizado con ink-testing-library leían
// `lastFrame()` tras un número FIJO de turnos del event loop. Ese número basta con la máquina
// holgada, pero el pipeline que va desde el kick-off del poll hasta el repintado —microtasks del
// `await fetchFn()`, el `setState`, el scheduling del render de React (MessageChannel) y la
// escritura del frame— no tiene una profundidad de turnos garantizada. Con la suite completa
// repartida por CPU (node --test) el frame leído podía ser el ANTERIOR al repintado, y la
// aserción rompía contra el estado inicial. Misma familia de defecto que KODO-24: suponer que una
// señal implica que el trabajo ya ocurrió, en vez de esperar el estado.
//
// Regla de uso:
//   - Render con teclado                → `renderInk` + su `press(...)` (nunca `stdin.write`).
//   - Se espera un CAMBIO en el frame   → `waitForFrame` (espera sobre el estado observado).
//   - El estado NO vive en el frame     → `waitUntil` (p. ej. que un spy inyectado ya se llamara).
//   - Se espera AUSENCIA de cambio      → `drain` (turnos fijos); ahí drenar de menos solo resta
//     sensibilidad, nunca genera un falso rojo.

import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';

// Re-export: los tests que renderizan un componente SIN teclado (SessionTable suelto, cabeceras)
// siguen usando `render` directamente y así importan todo desde un único sitio.
export { render };

/** Techo por defecto de la espera de estado. Generoso: solo se agota en un rojo real. */
const DEFAULT_TIMEOUT_MS = 5000;

/** Turnos del drenaje fijo. Un único valor para todos los ficheros (antes: 2 aquí, 6 allá). */
const DRAIN_TURNS = 6;

/** Turnos consecutivos sin frame nuevo que se consideran render quiescido (ver `press`). */
const QUIET_TURNS = 3;

/**
 * Un turno completo del event loop: `setImmediate` (fase check, tras vaciar microtasks) y, a
 * partir del turno `slow`, además un `setTimeout(0)` para ceder también a timers y a los
 * mensajes del scheduler de React. El camino feliz sale en el primer turno sin pagar el timer.
 *
 * @param {boolean} withTimer
 */
async function turn(withTimer) {
  await new Promise((resolve) => setImmediate(resolve));
  if (withTimer) await new Promise((resolve) => setTimeout(resolve, 1));
}

/**
 * Espera a que el frame renderizado cumpla `expected`, sondeando `lastFrame()` hasta que la
 * condición se cumpla o venza `timeoutMs`. Devuelve el frame que la cumplió, para encadenar
 * aserciones sobre ESE frame sin volver a leer (evita releer un frame ya repintado por un tick
 * posterior).
 *
 * Al vencer el techo falla con el frame completo en el mensaje: el rojo distingue "el repintado
 * no llegó" de "llegó y el estado es el equivocado".
 *
 * @param {() => string | undefined} lastFrame  `lastFrame` del handle de `render()`.
 * @param {RegExp | ((frame: string) => boolean)} expected  Patrón o predicado sobre el frame.
 * @param {string} message  Qué se esperaba, en la voz del test.
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>} El frame que cumple la condición.
 */
export async function waitForFrame(lastFrame, expected, message, options = {}) {
  const matches = typeof expected === 'function' ? expected : (/** @type {string} */ frame) => expected.test(frame);
  let frame = '';
  await waitUntil(
    () => {
      frame = lastFrame() ?? '';
      return matches(frame);
    },
    () => `${message}\n(el frame de abajo es el último repintado)\n${frame}`,
    options,
  );
  return frame;
}

/**
 * Espera a que `predicate` sea cierto, cediendo el event loop entre sondeos. Es la primitiva de
 * `waitForFrame` para el estado que NO vive en el frame (p. ej. que el `fetchFn` inyectado ya haya
 * sido invocado). Al vencer el techo falla con `message`.
 *
 * @param {() => boolean} predicate
 * @param {string | (() => string)} message  Qué se esperaba (perezoso si es función).
 * @param {{ timeoutMs?: number }} [options]
 */
export async function waitUntil(predicate, message, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  for (let i = 0; ; i++) {
    if (predicate()) return;
    if (Date.now() >= deadline) {
      const text = typeof message === 'function' ? message() : message;
      assert.fail(`${text}\n(la condición no se cumplió en ${timeoutMs} ms)`);
    }
    await turn(i >= 2);
  }
}

/**
 * Renderiza con ink-testing-library y devuelve su handle MÁS un `press(sequence)` que teclea de
 * forma segura (ver `press` abajo). Es el punto de entrada de los tests que conducen el teclado.
 *
 * @param {import('react').ReactElement} element
 */
export function renderInk(element) {
  const view = render(element);
  return {
    ...view,
    /** @param {string} sequence */
    press: (sequence) => press(view, sequence),
  };
}

/**
 * Teclea `sequence` en el stdin fake, esperando ANTES a que la UI esté lista para recibirlo. Dos
 * condiciones, ambas observadas (no contadas):
 *
 *   1. Ink debe tener suscrito su handler de input. El stdin fake es un EventEmitter y `write()`
 *      emite `readable` de inmediato: si nadie escucha, la tecla se pierde en silencio. Ink se
 *      suscribe al activar raw mode desde un passive effect de `useInput`, que React ejecuta
 *      DESPUÉS del commit — el frame puede mostrar ya la tabla con el teclado aún desconectado.
 *   2. El render debe haber quiescido (ink dejó de emitir frames). Los passive effects pendientes
 *      del último commit incluyen el write-back de la selección (D-07): si la tecla entra en esa
 *      ventana, el handler mueve el cursor y el effect lo pisa acto seguido — la pulsación se
 *      pierde sin dejar rastro. Los effects ya están encolados cuando el commit se pintó, así que
 *      ceder turnos completos del event loop hasta que no aparezcan frames nuevos los drena.
 *
 * @param {{ stdin: any, frames: string[] }} view  Handle de `render()` de ink-testing-library.
 * @param {string} sequence  Secuencia cruda (↑ = '\x1b[A', ↓ = '\x1b[B', Esc = '\x1b', Enter = '\r').
 */
async function press(view, sequence) {
  const { stdin, frames } = view;

  await waitUntil(
    () => typeof stdin.listenerCount !== 'function' || stdin.listenerCount('readable') > 0,
    'ink debe tener el handler de input suscrito (raw mode activo) antes de teclear',
  );

  // Si el render no llegara a quiescer (una app que repinta sin parar), se teclea igualmente al
  // vencer el techo: colgar el test aquí no diría nada; la aserción posterior sí dirá qué falta.
  let seen = frames.length;
  let quiet = 0;
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  while (quiet < QUIET_TURNS && Date.now() < deadline) {
    await turn(quiet >= 2);
    if (frames.length === seen) quiet++;
    else {
      seen = frames.length;
      quiet = 0;
    }
  }

  stdin.write(sequence);
}

/**
 * Drena turnos del event loop sin condición de parada. Úsalo SOLO cuando se afirma que el frame
 * NO cambia (p. ej. el clamp de la navegación: un ↓ en el extremo inferior no debe mover nada) o
 * cuando no hay un estado observable que esperar. Para todo lo demás: `waitForFrame`.
 *
 * @param {number} [turns]
 */
export async function drain(turns = DRAIN_TURNS) {
  for (let i = 0; i < turns; i++) await turn(true);
}
