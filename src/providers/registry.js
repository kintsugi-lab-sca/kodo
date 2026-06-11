// @ts-check
import { TASK_PROVIDER_METHODS } from '../interface.js';

/** @type {Map<string, () => import('../interface.js').TaskProvider>} */
const factories = new Map();

/** @type {Map<string, import('../interface.js').TaskProvider>} */
const instances = new Map();

let defaultsRegistered = false;

/**
 * Lazily register built-in provider factories (defaults: plane + github).
 *
 * Deferred so that test code calling clearRegistry() + registerProvider()
 * does not trigger config file reads or module resolution errors.
 *
 * Phase 24 D-29 / Pitfall #6: el bloque github vive en su propio try/catch
 * separado del bloque plane — un fallo en `import('./github/provider.js')`
 * NO debe abortar el registro de plane (fail-isolation por-provider).
 */
async function registerDefaults() {
  if (defaultsRegistered) return;
  defaultsRegistered = true;

  try {
    const { loadConfig, getPlaneApiKey } = await import('../config.js');
    const { createPlaneProvider } = await import('./plane/provider.js');

    factories.set('plane', () => {
      const config = loadConfig();
      const plane = config.providers.plane;
      const secretEnv = 'KODO_WEBHOOK_SECRET_PLANE';
      const webhookSecret = process.env[secretEnv] || process.env.PLANE_WEBHOOK_SECRET || plane.webhook_secret;
      return createPlaneProvider({
        baseUrl: plane.base_url,
        // OPEN-04 / D-06 resolve-on-read default: a config without web_url (every
        // existing on-disk config) falls back to base_url, producing byte-identical
        // browse URLs on unified deploys. On a split deploy the operator sets web_url
        // and the browse URL points at the web host instead of the API host.
        webUrl: plane.web_url ?? plane.base_url,
        apiKey: getPlaneApiKey(),
        workspaceSlug: plane.workspace_slug,
        projects: plane.projects || [],
        states: plane.states,
        webhookSecret,
      });
    });
  } catch {
    // Config or provider module not available — skip default registration
  }

  // Phase 24 D-29: bloque github en try/catch separado (Pitfall #6 fail-isolation).
  // `loadConfig` se re-importa porque cada try debe ser auto-contenido si el
  // anterior falló.
  try {
    const { loadConfig } = await import('../config.js');
    const { createGitHubProvider } = await import('./github/provider.js');

    factories.set('github', () => {
      const config = loadConfig();
      // D-31: optional chaining — config v0.6 sin clave github devuelve undefined;
      // el GitHubClient constructor (Phase 23 D-04) lanzará el mensaje canonical
      // si lo invoca un caller real. Phase 24 verde implica config con github
      // presente.
      const github = config.providers?.github;
      // D-29: snake_case raw passthrough — el factory consume el sub-objeto tal
      // cual; sin transformación a camelCase (divergencia justificada vs plane).
      // logger se inyecta vía opts en callers (precedente PlaneProvider — el
      // registry no construye logger aquí).
      return createGitHubProvider(github);
    });
  } catch {
    // Config or provider module not available — skip github registration
  }
}

/**
 * Register a provider factory.
 *
 * @param {string} name - Provider identifier (e.g. 'plane')
 * @param {() => import('../interface.js').TaskProvider} factory - Factory function
 */
export function registerProvider(name, factory) {
  factories.set(name, factory);
  instances.delete(name);
}

/**
 * Get a provider instance by name. Creates via factory on first call,
 * returns cached singleton thereafter. Validates interface compliance.
 *
 * @param {string} name - Provider identifier
 * @returns {import('../interface.js').TaskProvider}
 */
export function getProvider(name) {
  if (instances.has(name)) return /** @type {any} */ (instances.get(name));

  if (!factories.has(name)) {
    throw new Error(`Unknown provider: ${name}`);
  }

  const factory = /** @type {Function} */ (factories.get(name));
  const provider = factory();

  // Validate interface compliance
  for (const method of TASK_PROVIDER_METHODS) {
    if (typeof provider[method] !== 'function') {
      throw new Error(`Provider "${name}" missing method: ${method}`);
    }
  }

  instances.set(name, provider);
  return provider;
}

/**
 * Initialize the registry with default provider factories.
 * Call this once at application startup (not needed in tests).
 *
 * @returns {Promise<void>}
 */
export async function initRegistry() {
  await registerDefaults();
}

/**
 * Clear all registered factories and cached instances.
 * Primarily for test isolation.
 */
export function clearRegistry() {
  factories.clear();
  instances.clear();
  defaultsRegistered = false;
}
