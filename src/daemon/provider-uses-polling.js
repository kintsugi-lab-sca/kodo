// @ts-check
//
// src/daemon/provider-uses-polling.js — Plan 65-01 Task 2 / D-06.
//
// `providerUsesPolling(config)` es un helper PURO (sin FS/red, never-throws) que
// decide si el daemon kodo debe arrancar el loop de polling.
//
// Dos razones INDEPENDIENTES para arrancar el loop:
//
//   1. `provider === 'github'` — GitHub es polling-based por naturaleza (repos[] +
//      poll_interval): sin el loop no hay ingesta ninguna.
//
//   2. `polling.enabled === true` (KODO-60) — el operador ELIGE polling para un
//      provider que también sabe recibir webhooks. Es el caso de Plane en una máquina
//      sin URL pública: sin este carril habría que montar un túnel, un secreto HMAC y
//      un webhook por operador solo para que una segunda máquina se entere de nada.
//      El knob es global (`polling.*`) porque describe a la MÁQUINA, no al tablero.
//
// No son excluyentes ni se anulan: con `provider: 'github'` el loop arranca aunque
// `polling.enabled` sea false (comportamiento previo intacto, cero regresión), y con
// `polling.enabled: true` arranca sea cual sea el provider. Que el server siga
// sirviendo `/webhook` mientras tanto es DELIBERADO — los dos carriles conviven y el
// dedup por task_id (KODO-48) impide el doble lanzamiento.
//
// Convención repo never-throws / fail-open: cualquier config ausente o malformed
// (undefined, null, {}, {provider:42}) devuelve `false`. NO arrancar polling es el
// fallo SEGURO — el server sigue sirviendo webhooks aunque la decisión falle. El
// operador `===` sobre `config?.provider` nunca lanza: el optional chaining
// cortocircuita a `undefined` cuando `config` es null/undefined, y `undefined`/
// non-string !== 'github' → false.

/**
 * Decide si el daemon debe arrancar el loop de polling.
 *
 * @param {{ provider?: unknown, polling?: { enabled?: unknown } } | null | undefined} config
 *   — config de kodo (untrusted).
 * @returns {boolean} `true` para el provider polling-based 'github' o para cualquier
 *   provider con `polling.enabled === true`; `false` en cualquier otro caso, incluida
 *   una config ausente o malformed (fail-safe: no arrancar el loop deja el server
 *   sirviendo webhooks).
 */
export function providerUsesPolling(config) {
  // `=== true` estricto, NO truthiness: un `"false"` string —el bug de config que
  // KODO-58 ya se comió una vez— no debe activar el polling por la puerta de atrás.
  if (config?.polling?.enabled === true) return true;
  return config?.provider === 'github';
}
