// @ts-check
//
// src/net-host.js — KODO-29.
//
// SINGLE source of truth for deriving hosts from `config.server.bind`. Before this
// module, bind normalisation lived inline inside `startServer`
// (src/server.js), so local tooling did not know about it: `resolveBaseUrl`
// (dashboard) built `http://localhost:<port>` and `probePortInUse` (`kodo up`)
// probed `127.0.0.1` — both hardcoded loopback. With `server.bind=100.x.y.z` (the
// Tailscale-IP bind the README recommends for receiving the webhook from another
// machine) the daemon stops listening on loopback: the dashboard hooks onto a
// `localhost:9090` that does not answer and the probe believes the port is free.
//
// Two DIFFERENT questions, two helpers:
//   - `resolveListenHost` → what the SERVER passes to `server.listen(port, host)`.
//     `0.0.0.0` / `::` are legitimate values here (listen on every interface).
//   - `resolveClientHost` → which host the local CLIENT dials (dashboard, port
//     probe). Wildcards are NOT dialable addresses: they collapse to the fallback.
//
// PURE module: zero I/O, zero imports (not even `node:`). Consumable from the
// dashboard without breaking the color-isolation walker in test/format-isolation.test.js.

/** Canonical IPv4 loopback: `server.listen`'s default when there is no bind (NET-01). */
export const LOOPBACK = '127.0.0.1';

/**
 * Listen wildcards: addresses meaning "every interface". They are
 * valid for `listen` but they are NOT dialable destinations — a client doing
 * `connect('0.0.0.0')` relies on platform-dependent behaviour,
 * and `connect('::')` fails outright. That is why `resolveClientHost` collapses them.
 */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

/**
 * Normalises `config.server.bind` into a usable string, or `null` when absent.
 *
 * WR-04 (inherited from server.js): an empty or whitespace-only string is treated as
 * ABSENT, never passed through — `server.listen(port, '')` silently binds
 * `0.0.0.0` (every interface), exactly the LAN exposure NET-01 prevents.
 *
 * @param {any} config - kodo config (tolerates `undefined` and a migrated v1 config with no `server`).
 * @returns {string | null} trimmed bind, or `null` when absent/empty/non-string.
 */
function normalizeBind(config) {
  const raw = config?.server?.bind;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Host the SERVER passes to `server.listen(port, host)`.
 *
 * Binds to loopback by default (NET-01): an absent bind keeps migrated v0.15
 * configs safe — exposing yourself on a LAN interface is an explicit opt-in
 * via `config.server.bind`. Wildcards are honoured as-is: here they ARE valid.
 *
 * @param {any} config - kodo config.
 * @returns {string} host for `listen` (never empty).
 */
export function resolveListenHost(config) {
  return normalizeBind(config) ?? LOOPBACK;
}

/**
 * Host LOCAL tooling must connect to in order to talk to the daemon.
 *
 * Rules:
 *   - bind absent, empty, `0.0.0.0` or `::` → `fallback` (the daemon listens on
 *     loopback, or on every interface — loopback included).
 *   - any other value (a concrete IP, `::1`, a hostname) → the bind itself, which
 *     is the ONLY address the daemon listens on. Connecting to an IP assigned to
 *     this machine from this same machine never leaves the kernel: it works just like
 *     loopback, Tailscale IP included.
 *
 * The `fallback` is explicit because every caller already has its own and they must not
 * diverge from what they used to do: the port probe wants the literal `127.0.0.1`
 * (it must match what the server binds, without going through `localhost`
 * resolution, which on macOS returns `::1` first), while `resolveBaseUrl`
 * keeps the readable `localhost` advertised by the `--url` help (cli.js:398).
 *
 * @param {any} config - kodo config.
 * @param {string} [fallback] - host to use when the bind does not force a concrete address.
 * @returns {string} host a local client can dial.
 */
export function resolveClientHost(config, fallback = LOOPBACK) {
  const bind = normalizeBind(config);
  if (bind === null || WILDCARD_HOSTS.has(bind)) return fallback;
  return bind;
}

/**
 * Wraps the host in brackets when it is an IPv6 literal, so it can be embedded in a
 * URL (`http://[::1]:9090`). An IPv6 without brackets breaks parsing: the literal's
 * `:` characters get confused with the port separator.
 *
 * The heuristic is "contains `:`" — neither a hostname nor an IPv4 can contain one, so
 * it only reaches IPv6 literals. Idempotent: a host already bracketed is
 * returned untouched.
 *
 * @param {string} host - resolved host (e.g. from `resolveClientHost`).
 * @returns {string} host ready to concatenate into a URL.
 */
export function formatHostForUrl(host) {
  if (!host.includes(':')) return host;
  return host.startsWith('[') ? host : `[${host}]`;
}
