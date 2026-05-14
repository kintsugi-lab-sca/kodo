// @ts-check
//
// src/cli/orchestrate.js — Phase 26 Plan 03 (CFG-04 / D-16..19).
//
// Exports:
//   - runOrchestratePollingSetup(opts, deps?) — DI-zable helper que valida config
//     (D-14 exit 2 gates) y arranca `startPolling` integrado en el mismo proceso
//     del orchestrator. Caller en src/cli.js instala SIGINT/SIGTERM cleanup.
//
// Pattern: DI canonical Phase 25 — todas las deps inyectables vía deps; default
// path resuelve los módulos canonical via dynamic import. Esto habilita tests
// in-process spy (B-3 LOCKED) sin requerir integration NDJSON variant.
//
// Color isolation (Pattern A invariante v0.5): NO importar `picocolors` aquí.
// Este módulo no escribe a stdout — el caller en `src/cli.js` decide formato.

/**
 * @typedef {{ polling?: boolean }} OrchestrateOpts
 *
 * @typedef {{
 *   startPollingFn?: (args: any) => { stop: () => void },
 *   configLoader?: () => any,
 *   getProviderApiKeyFn?: (name: string) => (string | undefined),
 *   initRegistryFn?: () => Promise<void>,
 *   getProviderFn?: (name: string) => any,
 * }} OrchestrateDeps
 */

/**
 * Setup helper para `kodo orchestrate --polling`. Exportado para DI testing (B-3 LOCKED).
 *
 * Pre-flight gates (lanzan Error con `.exitCode` que el caller propaga a `process.exit`):
 *   - exitCode=2 si `providers.github.repos` está vacío (D-14 gate).
 *   - exitCode=2 si `getProviderApiKey('github')` retorna falsy (D-14 gate).
 *
 * Returns:
 *   - `{ stop: () => void }` el polling handle (caller instala SIGINT/SIGTERM cleanup).
 *   - `null` si `opts.polling` es false/undefined (D-19 zero breaking change).
 *
 * Threat mitigations:
 *   - T-26-04 (SIGINT race): el caller instala el SIGINT handler ANTES de invocar este helper
 *     (W-5 LOCKED PASO 0); el handler es idempotente vía check `if (pollingHandle)`.
 *   - T-26-CRASH: si initRegistryFn o getProviderFn throw, el error propaga al caller con
 *     stack original (sin exitCode → outer catch hace exit 1).
 *   - T-26-06 (token leak): NUNCA imprime el value del token; solo chequea `!getProviderApiKey('github')`.
 *
 * @param {OrchestrateOpts} opts
 * @param {OrchestrateDeps} [deps]
 * @returns {Promise<{ stop: () => void } | null>}
 */
export async function runOrchestratePollingSetup(opts, deps = {}) {
  // D-19: opts.polling falsy → no-op, retorna null (zero breaking change).
  if (!opts.polling) return null;

  // Resolver deps (DI o defaults via dynamic import).
  const configLoader = deps.configLoader
    || (await import('../config.js')).loadConfig;
  const getProviderApiKeyFn = deps.getProviderApiKeyFn
    || (await import('../config.js')).getProviderApiKey;
  const initRegistryFn = deps.initRegistryFn
    || (await import('../providers/registry.js')).initRegistry;
  const getProviderFn = deps.getProviderFn
    || (await import('../providers/registry.js')).getProvider;
  const startPollingFn = deps.startPollingFn
    || (await import('../triggers/polling.js')).startPolling;

  // D-14 gate 1: providers.github.repos no vacío.
  const config = configLoader();
  const repos = config?.providers?.github?.repos || [];
  if (repos.length === 0) {
    const err = new Error('providers.github.repos is empty. Run `kodo config` first.');
    /** @type {any} */ (err).exitCode = 2;
    throw err;
  }

  // D-14 gate 2: GITHUB_TOKEN (o api_key_env) set.
  if (!getProviderApiKeyFn('github')) {
    const err = new Error('GITHUB_TOKEN not set. Export it or add to ~/.kodo/.env.');
    /** @type {any} */ (err).exitCode = 2;
    throw err;
  }

  // Provider init + startPolling.
  await initRegistryFn();
  const provider = getProviderFn('github');

  const handle = startPollingFn({
    provider,
    repos,
    intervalSec: config?.providers?.github?.poll_interval || 60,
  });

  return handle;
}
