// @ts-check
//
// src/net-host.js — KODO-29.
//
// Fuente ÚNICA de verdad para derivar hosts de `config.server.bind`. Antes de este
// módulo la normalización del bind vivía inline dentro de `startServer`
// (src/server.js), así que el tooling local no la conocía: `resolveBaseUrl`
// (dashboard) construía `http://localhost:<port>` y `probePortInUse` (`kodo up`)
// sondeaba `127.0.0.1` — ambos loopback fijo. Con `server.bind=100.x.y.z` (el bind
// a IP de Tailscale que recomienda el README para recibir el webhook desde otra
// máquina) el daemon deja de escuchar en loopback: el dashboard se engancha a un
// `localhost:9090` que no responde y la sonda cree que el puerto está libre.
//
// Dos preguntas DISTINTAS, dos helpers:
//   - `resolveListenHost` → qué le pasa el SERVIDOR a `server.listen(port, host)`.
//     `0.0.0.0` / `::` son valores legítimos aquí (escuchar en todas las interfaces).
//   - `resolveClientHost` → a qué host marca el CLIENTE local (dashboard, sonda de
//     puerto). Los wildcards NO son direcciones marcables: se colapsan al fallback.
//
// Módulo PURO: cero I/O, cero imports (ni siquiera `node:`). Consumible desde el
// dashboard sin romper el color-isolation walker de test/format-isolation.test.js.

/** Loopback IPv4 canónico: el default de `server.listen` cuando no hay bind (NET-01). */
export const LOOPBACK = '127.0.0.1';

/**
 * Wildcards de escucha: direcciones que significan "todas las interfaces". Son
 * válidas para `listen` pero NO son destinos marcables — un cliente que hace
 * `connect('0.0.0.0')` depende de un comportamiento dependiente de la plataforma,
 * y `connect('::')` falla directamente. Por eso `resolveClientHost` las colapsa.
 */
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

/**
 * Normaliza `config.server.bind` a un string útil, o `null` si está ausente.
 *
 * WR-04 (heredado de server.js): una cadena vacía o de solo espacios se trata como
 * AUSENTE, no se deja pasar — `server.listen(port, '')` bindea silenciosamente
 * `0.0.0.0` (todas las interfaces), justo la exposición a LAN que NET-01 previene.
 *
 * @param {any} config - config de kodo (tolera `undefined` y un config v1 migrado sin `server`).
 * @returns {string | null} bind recortado, o `null` si ausente/vacío/no-string.
 */
function normalizeBind(config) {
  const raw = config?.server?.bind;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/**
 * Host que el SERVIDOR pasa a `server.listen(port, host)`.
 *
 * Bindea a loopback por defecto (NET-01): un bind ausente mantiene seguros los
 * configs v0.15 migrados — exponerse en una interfaz de LAN es un opt-in explícito
 * vía `config.server.bind`. Los wildcards se respetan tal cual: aquí sí son válidos.
 *
 * @param {any} config - config de kodo.
 * @returns {string} host para `listen` (nunca vacío).
 */
export function resolveListenHost(config) {
  return normalizeBind(config) ?? LOOPBACK;
}

/**
 * Host al que el tooling LOCAL debe conectarse para hablar con el daemon.
 *
 * Reglas:
 *   - bind ausente, vacío, `0.0.0.0` o `::` → `fallback` (el daemon escucha en
 *     loopback, o en todas las interfaces — loopback incluido).
 *   - cualquier otro valor (IP concreta, `::1`, un hostname) → el propio bind, que
 *     es la ÚNICA dirección donde el daemon escucha. Conectar a una IP asignada a
 *     esta máquina desde esta misma máquina no sale del kernel: funciona igual que
 *     loopback, también con la IP de Tailscale.
 *
 * El `fallback` es explícito porque cada caller ya tiene el suyo y no deben
 * divergir de lo que hacían: la sonda de puertos quiere el literal `127.0.0.1`
 * (debe casar con lo que bindea el server, sin pasar por la resolución de
 * `localhost`, que en macOS devuelve `::1` primero), mientras que `resolveBaseUrl`
 * conserva el `localhost` legible que anuncia el help de `--url` (cli.js:398).
 *
 * @param {any} config - config de kodo.
 * @param {string} [fallback] - host a usar cuando el bind no fuerza una dirección concreta.
 * @returns {string} host marcable por un cliente local.
 */
export function resolveClientHost(config, fallback = LOOPBACK) {
  const bind = normalizeBind(config);
  if (bind === null || WILDCARD_HOSTS.has(bind)) return fallback;
  return bind;
}

/**
 * Envuelve el host en corchetes si es un literal IPv6, para poder incrustarlo en una
 * URL (`http://[::1]:9090`). Un IPv6 sin corchetes rompe el parseo: los `:` del
 * literal se confunden con el separador de puerto.
 *
 * La heurística es "contiene `:`" — ni un hostname ni una IPv4 pueden contenerlo, así
 * que solo alcanza a literales IPv6. Idempotente: un host ya entre corchetes se
 * devuelve intacto.
 *
 * @param {string} host - host resuelto (p. ej. de `resolveClientHost`).
 * @returns {string} host listo para concatenar en una URL.
 */
export function formatHostForUrl(host) {
  if (!host.includes(':')) return host;
  return host.startsWith('[') ? host : `[${host}]`;
}
