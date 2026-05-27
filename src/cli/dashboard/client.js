// @ts-check
//
// src/cli/dashboard/client.js — Phase 35 Plan 01 (TUI-05 + TUI-06).
//
// Cliente HTTP puro del dashboard: data layer React-free que consume `GET /status`
// del server kodo y NUNCA LANZA. Es la capa más baja del slice de datos de Phase 35;
// `usePoll` (Plan 02) y `App` (Plan 03) construyen sobre este contrato.
//
// Decisión D-07 / Pattern 1 — never-throws {ok}:
//   El invariante "no crash" de TUI-06 es ESTRUCTURAL aquí, no en los componentes React.
//   ECONNREFUSED, HTTP no-ok (5xx/4xx), JSON corrupto/parcial/HTML y shape inválida
//   colapsan TODOS al discriminante:
//       { ok: true,  data }   — payload /status válido
//       { ok: false, error }  — cualquier modo de fallo (copy unificado por clase de error)
//   Jamás una excepción que llegue a React (Pitfall 12).
//
// Divergencia intencional respecto a los clients existentes:
//   `src/providers/plane/client.js:72` y `src/providers/github/client.js` LANZAN
//   (`throw new Error(...)`) ante respuestas no-ok. Este cliente hace lo CONTRARIO:
//   copia la FORMA del fetch inyectable (`opts.fetch || globalThis.fetch`) y la lectura
//   de `res.ok` / `res.status` / `res.json()`, pero NO la propagación de excepciones —
//   las atrapa y las degrada al discriminante {ok:false}.
//
// Color-isolation (invariante cross-milestone): este módulo NO importa `picocolors`
// ni ningún módulo de color. El color del dashboard sale exclusivamente de los <Text>
// de ink (App.js). `test/format-isolation.test.js` lo verifica vía walker automático.
//
// Scope (YAGNI): solo `fetchStatus`. `fetchComments` / `fetchLogs` quedan diferidos a
// Phases 36/38 — no se añaden aquí.

/**
 * Resultado discriminado de `fetchStatus` (D-07).
 *
 * @typedef {{ ok: true, data: any } | { ok: false, error: string }} FetchStatusResult
 */

/**
 * Consume `GET {baseUrl}/status` del server kodo. NEVER-THROWS: colapsa todo modo de
 * fallo (ECONNREFUSED/abort, HTTP no-ok, JSON corrupto, shape inválida) al discriminante
 * `{ ok:false, error }` (D-07, Pattern 1).
 *
 * @param {string} baseUrl — base del server kodo (p. ej. 'http://localhost:9090').
 * @param {typeof globalThis.fetch} [fetchFn] — fetch inyectable (test/DI). Default `globalThis.fetch`.
 * @param {AbortSignal} [signal] — abort opcional (cancelación del poll en Plan 02).
 * @returns {Promise<FetchStatusResult>}
 */
export async function fetchStatus(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/status`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json(); // puede lanzar (JSON corrupto) → cae al catch (Pitfall 12)
    if (!Array.isArray(data.sessions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    // Cubre ECONNREFUSED / abort / parse error — jamás propaga a React.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
