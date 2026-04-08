// @ts-check
import { TASK_PROVIDER_METHODS } from '../interface.js';

/** @type {Map<string, () => import('../interface.js').TaskProvider>} */
const factories = new Map();

/** @type {Map<string, import('../interface.js').TaskProvider>} */
const instances = new Map();

let defaultsRegistered = false;

/**
 * Lazily register built-in provider factories.
 * Deferred so that test code calling clearRegistry() + registerProvider()
 * does not trigger config file reads or module resolution errors.
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
      return createPlaneProvider({
        baseUrl: plane.base_url,
        apiKey: getPlaneApiKey(),
        workspaceSlug: plane.workspace_slug,
        projects: plane.projects || [],
        states: plane.states,
        webhookSecret: plane.webhook_secret,
      });
    });
  } catch {
    // Config or provider module not available — skip default registration
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
