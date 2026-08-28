// @ts-check
//
// src/cli/orchestrate.js — Phase 26 Plan 03 (CFG-04 / D-16..19).
//
// Exports:
//   - runOrchestratePollingSetup(opts, deps?) — DI-zable helper que valida config
//     (D-14 exit 2 gates) y arranca `startPolling` integrado en el mismo proceso
//     del orchestrator.
//   - runOrchestrateCli(opts) — el handler completo del comando (KODO-42), que instala
//     el cleanup de SIGINT/SIGTERM y ejecuta el orden W-5 LOCKED.
//
// Pattern: DI canonical Phase 25 — todas las deps inyectables vía deps; default
// path resuelve los módulos canonical via dynamic import. Esto habilita tests
// in-process spy (B-3 LOCKED) sin requerir integration NDJSON variant.
//
// Color isolation (Pattern A invariante v0.5): NO importar `picocolors` aquí. Lo que este
// módulo escribe (KODO-42: las dos líneas de estado del orquestador) va sin color, igual
// que iba cuando el handler vivía en `src/cli.js`.

import { EXIT_SUCCESS, EXIT_ERROR } from './exit-codes.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// runOrchestrateCli — el handler de `kodo orchestrate` (KODO-42).
//
// Vivía inline en `src/cli.js` (Phase 26 Plan 03 / CFG-04 / D-16..19 / W-5 LOCKED); se
// mueve verbatim, con el orden LOCKED intacto y los literales de salida sustituidos por
// las constantes de `exit-codes.js`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lanza la sesión del orquestador, opcionalmente con polling integrado en el mismo proceso.
 *
 * W-5 LOCKED — ORDEN ESTRICTO:
 *   PASO 0: SIGINT/SIGTERM handlers ANTES de cualquier setup async (T-26-04 race mitigation).
 *   PASO 1: runOrchestratePollingSetup({...}) ANTES de launchOrchestrator.
 *   PASO 2: launchOrchestrator(opts) DESPUÉS de polling activo.
 *   PASO 3: outer catch limpia pollingHandle?.stop() antes de salir con EXIT_ERROR.
 *   PASO 4: cleanup() handler invoca pollingHandle?.stop() + salida EXIT_SUCCESS; idempotente.
 *
 * @param {{ polling?: boolean, force?: boolean }} opts
 * @returns {Promise<void>} No retorna con `--polling`: bloquea hasta SIGINT/SIGTERM.
 */
export async function runOrchestrateCli(opts) {
  /** @type {{ stop: () => void } | null} */
  let pollingHandle = null;

  // PASO 0: instalar SIGINT/SIGTERM handlers antes de cualquier async work.
  // Idempotente: si SIGINT llega antes de `pollingHandle = await ...`, el handler
  // ve `pollingHandle === null` y solo termina con EXIT_SUCCESS. Si llega después,
  // invoca handle.stop() envuelto en try/catch (T-26-CRASH).
  const cleanup = () => {
    try { if (pollingHandle) pollingHandle.stop(); } catch { /* idempotent */ }
    process.exit(EXIT_SUCCESS);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  try {
    // PASO 1: polling setup ANTES de launchOrchestrator (W-5 LOCKED).
    // Razón: si SIGINT llega durante launchOrchestrator setup, cleanup ya limpia polling.
    if (opts.polling) {
      try {
        pollingHandle = await runOrchestratePollingSetup({ polling: true });
      } catch (e) {
        // exitCode propagated por el helper (EXIT_USAGE si config gate, undefined si crash).
        if (e && /** @type {any} */ (e).exitCode) {
          console.error(`Error: ${e.message}`);
          process.exit(/** @type {any} */ (e).exitCode);
        }
        throw e;
      }
    }

    // PASO 2: launchOrchestrator — el polling YA está corriendo en este punto.
    // Si --polling está activo, un fallo de launchOrchestrator NO debe matar el
    // polling: el operador pidió polling integrado explícitamente; orchestrator
    // session es la capa opcional. Log + continuamos al block-forever (Pattern D).
    // Sin --polling, comportamiento idéntico a hoy (D-19 zero breaking change).
    try {
      const { launchOrchestrator } = await import('../orchestrator/launch.js');
      const result = await launchOrchestrator({ force: opts.force });
      if (result.existing) {
        console.log(`Orchestrator already running at ${result.workspace}`);
      } else {
        console.log(`✓ Orchestrator launched at ${result.workspace}`);
      }
    } catch (launchErr) {
      if (!opts.polling) throw launchErr; // D-19: comportamiento idéntico sin --polling.
      // Con --polling: log + sigue. El polling ya está activo y SIGINT lo limpiará.
      console.error(`Warning: orchestrator launch failed (${launchErr.message}); polling continúa activo.`);
    }

    // Si --polling, mantener el proceso vivo hasta SIGINT/SIGTERM (Pattern D).
    // El cleanup() handler instalado en PASO 0 hará la salida cuando llegue.
    if (opts.polling) {
      await new Promise(() => { /* block forever — cleanup() exit drains it */ });
    }
  } catch (err) {
    // W-5 LOCKED PASO 3+4: outer catch limpia pollingHandle antes de salir con error.
    try { if (pollingHandle) pollingHandle.stop(); } catch { /* idempotent */ }
    console.error(`Error: ${err.message}`);
    process.exit(EXIT_ERROR);
  }
}
