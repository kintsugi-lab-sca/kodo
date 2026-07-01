// @ts-check
//
// src/daemon/provider-uses-polling.js — Plan 65-01 Task 2 / D-06.
//
// `providerUsesPolling(config)` es un helper PURO (sin FS/red, never-throws) que
// decide si el daemon kodo debe arrancar el loop de polling.
//
// Allowlist explícita contra 'github': entre los DOS providers registrados hoy
// (src/providers/registry.js — 'plane' + 'github'), solo GitHub es polling-based
// (repos[] + poll_interval per src/config.js:253-261). Plane usa webhook ingress
// en el server (server.js /webhook), así que NO necesita el polling loop — su
// ingesta llega push, no pull. La allowlist es extensible si un tercer provider
// polling-based se registra en el futuro (añadir su id al set).
//
// Convención repo never-throws / fail-open: cualquier config ausente o malformed
// (undefined, null, {}, {provider:42}) devuelve `false`. NO arrancar polling es el
// fallo SEGURO — el server sigue sirviendo webhooks aunque la decisión falle. El
// operador `===` sobre `config?.provider` nunca lanza: el optional chaining
// cortocircuita a `undefined` cuando `config` es null/undefined, y `undefined`/
// non-string !== 'github' → false.

/**
 * Decide si el provider configurado requiere el loop de polling del daemon.
 *
 * @param {{ provider?: unknown } | null | undefined} config — config de kodo (untrusted).
 * @returns {boolean} `true` solo para el provider polling-based 'github'; `false`
 *   para 'plane' (webhook) y cualquier config ausente/malformed (fail-safe).
 */
export function providerUsesPolling(config) {
  return config?.provider === 'github';
}
