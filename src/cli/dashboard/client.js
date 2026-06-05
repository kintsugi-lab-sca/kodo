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
// Scope: `fetchStatus` (Phase 35), más `fetchComments` / `fetchLogs` (Phase 39, TUI-15/TUI-16) —
// los clientes de los dos overlays auxiliares. Comparten la FORMA never-throws de fetchStatus.
// `fetchComments` AÑADE un discriminante `code` ('not-found' | 'http' | 'network') porque App.js
// debe distinguir 404 ("task not found") de 5xx/red ("error fetching comments") (D-07 crítico).

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

/**
 * Resultado discriminado de `fetchComments` (D-07, TUI-15). A diferencia de fetchStatus, el
 * fallo HTTP/red incluye un `code` para que App.js distinga 404 (task ausente) de 5xx/red.
 *
 * `data.supported` (D-07, TUI-15) es un campo ADITIVO opcional: `false` cuando el provider
 * no implementa `listComments` (estado permanente), `true`/ausente cuando sí (la ausencia de
 * comentarios es transitoria). El runtime hace pass-through de `data` entero (la guard de shape
 * solo valida `data.comments`), así que `supported` viaja sin lógica extra — App.js lo consume.
 *
 * @typedef {(
 *   { ok: true, data: { comments: any[], supported?: boolean } }
 *   | { ok: false, error: string, code?: 'not-found' | 'http' | 'network', status?: number }
 * )} FetchCommentsResult
 */

/**
 * Consume `GET {baseUrl}/comments/{taskId}` del server kodo. NEVER-THROWS (D-07).
 *
 * El server resuelve por `task_id` (D-02) y responde 200 `{comments:[...]}`, 404 `{error}` si
 * la sesión no existe, o 500 `{error}`. El resultado de fallo lleva un discriminante `code`:
 *   - 404 → `{ ok:false, code:'not-found', status:404 }` (overlay vacío honesto, no es un error
 *     de red — el operador navegó a una tarea sin sesión registrada).
 *   - otro HTTP no-ok → `{ ok:false, code:'http', status }`.
 *   - red/abort/JSON corrupto → `{ ok:false, code:'network' }`.
 * `comments:[]` (vacío) es `{ ok:true }` — la ausencia de comentarios es estado de UI, no error.
 * La respuesta 200 incluye además `supported` (D-07, aditivo): pasa-through dentro de `data`.
 *
 * @param {string} baseUrl — base del server kodo.
 * @param {string} taskId — id de tarea; se codifica con `encodeURIComponent` (T-39-01, va en el path).
 * @param {typeof globalThis.fetch} [fetchFn] — fetch inyectable (test/DI).
 * @param {AbortSignal} [signal] — abort opcional.
 * @returns {Promise<FetchCommentsResult>}
 */
export async function fetchComments(baseUrl, taskId, fetchFn = globalThis.fetch, signal) {
  try {
    // T-39-01: el task_id cruza en el path → encodeURIComponent OBLIGATORIO (anti path-traversal
    // / inyección de segmentos de URL). El server hace decodeURIComponent simétrico.
    const res = await fetchFn(`${baseUrl}/comments/${encodeURIComponent(taskId)}`, { signal });
    if (!res.ok) {
      // D-07 crítico: discriminar 404 ("task not found") de 5xx ("error fetching comments").
      return {
        ok: false,
        error: `HTTP ${res.status}`,
        status: res.status,
        code: res.status === 404 ? 'not-found' : 'http',
      };
    }
    const data = await res.json(); // puede lanzar (JSON corrupto) → cae al catch (code:'network')
    if (!Array.isArray(data.comments)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    // Red / abort / parse error: jamás propaga a React. code:'network' (no es un 404 semántico).
    return { ok: false, error: err instanceof Error ? err.message : String(err), code: 'network' };
  }
}

/**
 * Resultado discriminado de `fetchLogs` (D-07, TUI-16).
 *
 * @typedef {{ ok: true, data: { logs: any[] } } | { ok: false, error: string }} FetchLogsResult
 */

/**
 * Consume `GET {baseUrl}/logs` del server kodo. NEVER-THROWS (D-07). Trae el buffer COMPARTIDO
 * crudo (ring newest-first, sin `session_id` por línea); el grep por sesión es un paso SEPARADO
 * en `select.js#grepLogs`. No necesita discriminante de status: `/logs` siempre existe (no hay
 * caso 404 semántico).
 *
 * @param {string} baseUrl — base del server kodo.
 * @param {typeof globalThis.fetch} [fetchFn] — fetch inyectable (test/DI).
 * @param {AbortSignal} [signal] — abort opcional.
 * @returns {Promise<FetchLogsResult>}
 */
export async function fetchLogs(baseUrl, fetchFn = globalThis.fetch, signal) {
  try {
    const res = await fetchFn(`${baseUrl}/logs`, { signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const data = await res.json(); // puede lanzar (JSON corrupto) → cae al catch
    if (!Array.isArray(data.logs)) return { ok: false, error: 'bad shape' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resultado discriminado de `dismissSession` (D-10, DISMISS-03). Espejo de la forma
 * never-throws de `fetchComments`/`fetchLogs`, con `method:'DELETE'`.
 *
 * @typedef {(
 *   { ok: true, data: { removed: string, actions: Array<{ type: string, result: string }> } }
 *   | { ok: false, error: string }
 * )} DismissResult
 */

/**
 * Descarta (dismiss) la sesión `taskId` vía `DELETE {baseUrl}/sessions/{taskId}`.
 * NEVER-THROWS (D-10, DISMISS-03): es el calque verbatim de `fetchComments` con
 * `{ method:'DELETE' }`. Colapsa CUALQUIER fallo de red/HTTP/JSON al discriminante
 * `{ ok:false, error }` — ningún throw llega a React (invariante v0.9, SC#4). Por eso
 * el handler `useInput` puede `await`-earlo sin try/catch.
 *
 * El server amplificado (Plan 01) responde:
 *   - 200 `{ ok:true, removed, actions:[{type,result}] }` — saneo delegado en doctor.
 *   - 409 `{ ok:false, error:'alive' }` — guard server-side TOCTOU (D-07/D-08): el target
 *     revivió entre arm y confirm; el race se caza y se surface honestamente en el footer.
 *   - 5xx `{ error }` — error genérico.
 * El fallo HTTP lee el body para un error HONESTO: por defecto `HTTP <status>`, pero si el
 * body trae `{error}` (p.ej. 'alive'), ese reason gana — el operador ve por qué falló.
 *
 * @param {string} baseUrl — base del server kodo.
 * @param {string} taskId — id de tarea; se codifica con `encodeURIComponent` (T-39-01/V5, va en
 *   el path). El server hace `decodeURIComponent` simétrico (anti path-traversal).
 * @param {typeof globalThis.fetch} [fetchFn] — fetch inyectable (test/DI).
 * @returns {Promise<DismissResult>}
 */
export async function dismissSession(baseUrl, taskId, fetchFn = globalThis.fetch) {
  try {
    // T-39-01/V5: el task_id cruza en el path → encodeURIComponent OBLIGATORIO (anti
    // path-traversal / inyección de segmentos de URL). El server decodifica simétrico.
    const res = await fetchFn(`${baseUrl}/sessions/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      // Error HONESTO: default `HTTP <status>`; si el body trae {error} (409 'alive', etc.)
      // ese reason gana para que el footer surface el race cazado (D-07/D-08).
      let error = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        if (b && b.error) error = b.error;
      } catch {
        /* body no-JSON → conserva `HTTP <status>` */
      }
      return { ok: false, error };
    }
    const data = await res.json(); // puede lanzar (JSON corrupto) → cae al catch
    if (!Array.isArray(data.actions)) return { ok: false, error: 'bad shape' };
    return { ok: true, data: { removed: data.removed, actions: data.actions } };
  } catch (err) {
    // Red / abort / parse error: jamás propaga a React.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
