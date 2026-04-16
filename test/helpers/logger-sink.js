// @ts-check
/**
 * Test helper: captura stdout/stderr writes durante `fn()` y devuelve los chunks
 * como array. Restaura el write original con try/finally — incluso si `fn` throws.
 *
 * Usage:
 *   const { captured, result } = await captureStdout(() => runLogs(...));
 *   assert.ok(captured.join('').includes('foo'));
 *
 * NO es un test file: no importa `node:test` ni `node:assert`.
 * Se consume desde test/logs-reader.test.js y test/logs-session-of.test.js.
 */

/**
 * Captura cada call a `process.stdout.write` durante `fn()`. Las escrituras se
 * acumulan en un array de strings (chunks coerced con `String(chunk)`). El
 * `process.stdout.write` original se restaura en el `finally`, incluso si
 * `fn` lanza.
 *
 * La función devuelve siempre un `Promise<{ captured, result }>` — el caller
 * hace `await` sobre el resultado. Aceptamos `fn` sync o async indistintamente.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<{ captured: string[], result: T }>}
 */
export function captureStdout(fn) {
  const captured = [];
  const original = process.stdout.write.bind(process.stdout);
  // @ts-ignore — reasignamos deliberadamente el write para interceptar en tests
  process.stdout.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    const maybe = fn();
    return Promise.resolve(maybe)
      .then((result) => ({ captured, result }))
      .finally(() => {
        // @ts-ignore — restauración simétrica tras fn async
        process.stdout.write = original;
      });
  } catch (err) {
    // fn throw sincrono — restaurar y rethrow
    // @ts-ignore — restauración simétrica
    process.stdout.write = original;
    throw err;
  }
}

/**
 * Análogo a `captureStdout` pero sobre `process.stderr.write`. Mismo contrato:
 * acumula chunks, restaura el original en `finally`, devuelve `Promise<{ captured, result }>`.
 *
 * @template T
 * @param {() => T | Promise<T>} fn
 * @returns {Promise<{ captured: string[], result: T }>}
 */
export function captureStderr(fn) {
  const captured = [];
  const original = process.stderr.write.bind(process.stderr);
  // @ts-ignore — reasignamos deliberadamente el write para interceptar en tests
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  try {
    const maybe = fn();
    return Promise.resolve(maybe)
      .then((result) => ({ captured, result }))
      .finally(() => {
        // @ts-ignore — restauración simétrica tras fn async
        process.stderr.write = original;
      });
  } catch (err) {
    // fn throw sincrono — restaurar y rethrow
    // @ts-ignore — restauración simétrica
    process.stderr.write = original;
    throw err;
  }
}
