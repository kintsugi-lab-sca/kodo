// @ts-check
//
// src/cli/dashboard/App.js — Phase 35 Plan 03 (TUI-06).
//
// Componente root ink del dashboard. En Phase 35 reemplaza el placeholder estático
// del cuerpo (Phase 34) por una STATUS LINE VIVA (D-01): indicador de conexión
// (`● live` / `⚠ server caído`), contador `N sessions` y banner de degradación con
// la edad del último dato bueno. Cablea `usePoll(fetchStatus, …)` (Planes 01+02) y
// mantiene en React el estado de keep-last-good + connection + edad.
//
// Status line viva D-01 (capa de presentación del slice de datos):
//   - banner `kodo dashboard` (arriba) — conservado de Phase 34.
//   - status line central (← reemplaza el placeholder estático del cuerpo de Phase 34):
//       · `● live`            (Text color green)  + `N sessions`   cuando el último poll fue ok.
//       · `⚠ server caído`    (Text color yellow) + `N sessions (last update Ns ago, retrying…)`
//                              cuando el server cayó a mitad pero ya hubo dato bueno (keep-last-good).
//       · `waiting for server` (dimColor, sin contador) al arrancar sin dato bueno.
//   - footer hint `q quit` (abajo) — conservado de Phase 34.
//
// Dos estados de degradación (D-06, Pattern 3 RESEARCH:248-271):
//   - never had good (`lastGoodAt == null`) + !connected → 'waiting for server' (sin contador).
//   - had good + !connected                              → 'stale'  → ⚠ + edad + retrying (keep-last-good).
//   - connected                                          → 'live'   → ● live + N sessions.
// Keep-last-good (D-06, Pitfall 5): en un poll fallido NO se toca `lastGoodCount`/`lastGoodAt` →
// el operador conserva el contexto del último dato bueno en vez de ver un blanqueo.
// Edad (D-08, Pitfall 8): se recalcula en cada intento de poll (`lastAttemptAt - lastGoodAt`),
// NUNCA con un timer de 1s — el `onResult` actualiza `lastAttemptAt` por tick.
//
// JSON corrupto / ECONNREFUSED / HTTP no-ok (D-07): `fetchStatus` (client.js) los colapsa TODOS
// al discriminante `{ok:false}` never-throws → llegan aquí como un poll fallido más, jamás como
// un throw que tire el árbol ink (T-35-05).
//
// Lifecycle de salida (conservado de Phase 34):
//   - `q` → useApp().exit() (D-08): desmonta limpio, NO process.exit.
//   - `Esc` deliberadamente NO sale (D-11): reservado para overlays de Phase 38.
//   - useInput gateado por useStdin().isRawModeSupported (belt-and-suspenders, Pitfall 1).
//
// Color-isolation (D-12): todo el color sale de props de <Text> de ink; cero import del helper
// de color del CLI clásico / picocolors. Markup via React.createElement plano (no JSX, no build).

import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { createElement, useCallback, useState } from 'react';
import { fetchStatus } from './client.js';
import { usePoll } from './usePoll.js';

/**
 * Componente root del dashboard TUI.
 *
 * `fetchFn` + las opciones de clock (`now`/`schedule`/`cancel`/`scheduleTimeout`/`cancelTimeout`/
 * `baseMs`/`maxMs`) son props de INYECCIÓN opcionales: en runtime caen al `globalThis.fetch` /
 * `Date.now` / timers reales (defaults de `fetchStatus` y `usePoll`); en tests se inyectan fakes
 * para un render hermético sin red ni timers reales (igual que `baseUrl` ya se inyectaba en
 * Phase 34).
 *
 * @param {object} props
 * @param {string} props.baseUrl - Base URL del server kodo (resuelta en index.js).
 * @param {typeof globalThis.fetch} [props.fetchFn] - fetch inyectable. Default `globalThis.fetch`.
 * @param {() => number} [props.now] - reloj para la edad (D-08). Default `Date.now`.
 * @param {(fn: () => void, ms: number) => any} [props.schedule] - re-arme del tick (usePoll opt).
 * @param {(handle: any) => void} [props.cancel] - cancela el timer del tick (usePoll opt).
 * @param {(fn: () => void, ms: number) => any} [props.scheduleTimeout] - timeout de abort (usePoll opt).
 * @param {(handle: any) => void} [props.cancelTimeout] - cancela el timeout de abort (usePoll opt).
 * @param {number} [props.baseMs] - override del intervalo base del backoff (usePoll opt).
 * @param {number} [props.maxMs] - override del cap del backoff (usePoll opt).
 * @returns {import('react').ReactElement}
 */
export default function App({
  baseUrl,
  fetchFn,
  now = Date.now,
  schedule,
  cancel,
  scheduleTimeout,
  cancelTimeout,
  baseMs,
  maxMs,
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  useInput(
    (input) => {
      // `q` sale via exit() (D-08): clean unmount, NO process.exit.
      // `Esc` deliberadamente NO se maneja (D-11): reservado Phase 38.
      if (input === 'q') exit();
    },
    { isActive: isRawModeSupported },
  );

  // Keep-last-good + connection + edad (Discretion Open Question 2: este estado vive en App, no
  // en el hook). `lastGoodAt == null` ⇒ nunca hubo dato bueno (arranque).
  const [lastGoodCount, setLastGoodCount] = useState(/** @type {number | null} */ (null));
  const [lastGoodAt, setLastGoodAt] = useState(/** @type {number | null} */ (null));
  const [connected, setConnected] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [lastError, setLastError] = useState(/** @type {string | null} */ (null));
  const [lastAttemptAt, setLastAttemptAt] = useState(/** @type {number | null} */ (null));

  // onResult: en ok refresca el contador/at/connected; en fallo NO toca lastGoodCount/lastGoodAt
  // (keep-last-good, D-06/Pitfall 5). Siempre actualiza lastAttemptAt (edad por poll, D-08).
  const onResult = useCallback(
    (/** @type {{ ok: boolean, data?: any, error?: string }} */ result) => {
      const t = now();
      if (result.ok) {
        setLastGoodCount(result.data.count ?? result.data.sessions.length);
        setLastGoodAt(t);
        setConnected(true);
        setLastError(null);
      } else {
        setConnected(false);
        setLastError(result.error ?? null);
        // keep-last-good: NO se tocan lastGoodCount/lastGoodAt.
      }
      setLastAttemptAt(t);
    },
    [now],
  );

  usePoll(
    (signal) => fetchStatus(baseUrl, fetchFn, signal),
    onResult,
    [baseUrl],
    { schedule, cancel, scheduleTimeout, cancelTimeout, baseMs, maxMs },
  );

  // Derivación pura del estado de render (D-06):
  //   connected            → live  (● live + N sessions)
  //   had good + !connected → stale (⚠ server caído + N sessions + edad + retrying)
  //   never had good        → waiting (waiting for server, sin contador)
  let statusNode;
  if (connected) {
    statusNode = createElement(
      Text,
      null,
      createElement(Text, { color: 'green' }, '● live'),
      `  ${lastGoodCount} sessions`,
    );
  } else if (lastGoodAt != null) {
    // stale: keep-last-good. Edad = (lastAttemptAt - lastGoodAt) recalculada por poll (D-08).
    const ageSec = Math.round(((lastAttemptAt ?? lastGoodAt) - lastGoodAt) / 1000);
    statusNode = createElement(
      Text,
      null,
      createElement(Text, { color: 'yellow' }, '⚠ server caído'),
      `  ${lastGoodCount} sessions (last update ${ageSec}s ago, retrying…)`,
    );
  } else {
    statusNode = createElement(Text, { dimColor: true }, 'waiting for server');
  }

  return createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
    createElement(Text, { bold: true }, 'kodo dashboard'),
    createElement(Box, { marginY: 1, paddingX: 1 }, statusNode),
    createElement(Text, { dimColor: true }, 'q quit'),
  );
}
