// @ts-check
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KODO_DIR = join(homedir(), '.kodo');
const CONFIG_PATH = join(KODO_DIR, 'config.json');
const PROJECTS_PATH = join(KODO_DIR, 'projects.json');
const ENV_PATH = join(KODO_DIR, '.env');

// Load ~/.kodo/.env into process.env (simple KEY=VALUE parser)
function loadEnvFile() {
  if (!existsSync(ENV_PATH)) return;
  try {
    const content = readFileSync(ENV_PATH, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {}
}

loadEnvFile();

const DEFAULT_CONFIG = {
  provider: 'plane',
  providers: {
    plane: {
      base_url: 'https://tasks.kintsugi-lab.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'k-lab',
      projects: [],
      states: {
        trigger: 'In Progress',
        review: 'In review',
        done: 'Done',
      },
    },
  },
  cmux: {
    binary: '/Applications/cmux.app/Contents/Resources/bin/cmux',
    colors: {
      running: 'Amber',
      done: 'Green',
      error: 'Crimson',
      review: 'Blue',
    },
  },
  claude: {
    binary: '/Applications/cmux.app/Contents/Resources/bin/claude',
    default_model: 'opus',
    max_parallel: 3,
    flags: [],
  },
  server: {
    port: 9090,
    idle_threshold_min: 5,
    stuck_threshold_min: 30,
  },
};

function ensureDir() {
  if (!existsSync(KODO_DIR)) {
    mkdirSync(KODO_DIR, { recursive: true });
  }
}

/**
 * Migra un config object del schema v1 (plane.*) al v2 (providers.plane.*).
 * Función pura — no hace I/O.
 *
 * @param {object} rawConfig
 * @returns {object}
 */
export function migrateConfig(rawConfig) {
  if (rawConfig.providers) return rawConfig;
  const { plane: planeOld = {}, ...rest } = rawConfig;
  return {
    ...rest,
    provider: 'plane',
    providers: {
      plane: {
        base_url: planeOld.base_url,
        // OPEN-04 / D-06: a migrated split-deploy config defaults the web host to the
        // API host (current pre-fix behavior) until the operator explicitly sets it —
        // no behavior change vs today for migrated configs. The resolve-on-read default
        // for configs WITHOUT this key lives at the consumer (registry.js, Task 2).
        web_url: planeOld.base_url,
        api_key_env: planeOld.api_key_env,
        workspace_slug: planeOld.workspace_slug,
        projects: planeOld.projects || [],
        states: {
          trigger: planeOld.trigger_state || 'In Progress',
          review: planeOld.review_state || 'In review',
          done: planeOld.done_state || 'Done',
        },
      },
    },
  };
}

/**
 * Si el config cargado usa el schema v1, crea backup y migra.
 * @private
 * @param {object} rawConfig
 * @returns {object}
 */
function migrateConfigIfNeeded(rawConfig) {
  if (rawConfig.providers) return rawConfig;
  writeFileSync(CONFIG_PATH + '.bak', JSON.stringify(rawConfig, null, 2) + '\n');
  const newConfig = migrateConfig(rawConfig);
  writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2) + '\n');
  console.log('[kodo] Config migrada al nuevo schema (backup: config.json.bak)');
  return newConfig;
}

/** @returns {typeof DEFAULT_CONFIG} */
export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return migrateConfigIfNeeded(parsed);
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/** @param {typeof DEFAULT_CONFIG} config */
export function saveConfig(config) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

/** @returns {Record<string, string>} projectId -> local path */
export function loadProjects() {
  ensureDir();
  if (!existsSync(PROJECTS_PATH)) return {};
  try {
    return JSON.parse(readFileSync(PROJECTS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

/** @param {Record<string, string>} projects */
export function saveProjects(projects) {
  ensureDir();
  writeFileSync(PROJECTS_PATH, JSON.stringify(projects, null, 2) + '\n');
}

/**
 * Returns the API key for a given provider by reading the env var name from config.
 *
 * @param {string} [providerName] - Provider name. Defaults to config.provider.
 * @returns {string|undefined}
 */
export function getProviderApiKey(providerName) {
  const config = loadConfig();
  const name = providerName || config.provider;
  const envVarName = config.providers?.[name]?.api_key_env;
  if (!envVarName) return undefined;
  return process.env[envVarName];
}

/**
 * @deprecated Use getProviderApiKey('plane') instead.
 * @returns {string|undefined}
 */
export function getPlaneApiKey() {
  return getProviderApiKey('plane');
}

/**
 * Returns true iff the user has opted into provider sub-issue reporting via
 * `~/.kodo/config.json` `workflow.report_to_provider: true`.
 *
 * Default-safe (Phase 14 D-03): missing config file, missing `workflow`
 * section, missing `report_to_provider` key, or non-boolean values all
 * return `false`. Strict equality `=== true` is fail-closed against string
 * `"true"` and number `1` — only the JSON boolean `true` activates the flag.
 *
 * Phase 14 D-04: única fuente para el check. Cualquier consumer (Phase 15
 * orchestrator prompt builder) DEBE llamar a este helper, NO leer
 * `config.workflow.report_to_provider` inline. Source-hygiene D-05 blinda
 * el invariante anti-inline en `src/**\/*.js \ {config.js}`.
 *
 * El parámetro `_loadConfig` es DI opcional para testabilidad (research
 * Open Question 1 — research recomienda esta variante sobre fixture
 * filesystem por menor invasividad y zero-touch sobre `~/.kodo/config.json`
 * real del dev). Producción siempre usa el default `loadConfig`.
 *
 * @param {() => typeof DEFAULT_CONFIG} [_loadConfig] - Optional injected loader for tests.
 * @returns {boolean}
 */
export function isReportToProviderEnabled(_loadConfig = loadConfig) {
  return _loadConfig().workflow?.report_to_provider === true;
}

/**
 * Factory para el shape default de `providers.github` (D-06 verbatim).
 *
 * D-08 LOCKED: NO se inyecta en `DEFAULT_CONFIG` — eso forzaría a configs v0.6
 * (Plane only) a tener la clave aunque no la usen, rompiendo el invariante
 * CFG-02 zero-breaking-change. El wizard `interactiveConfig` llama este factory
 * sólo cuando el operador elige `provider: github`.
 *
 * @returns {{
 *   api_key_env: string,
 *   repos: Array<{owner: string, repo: string}>,
 *   poll_interval: number,
 *   mcp_hint: string,
 *   states: { review: string },
 * }}
 */
export function getDefaultGithubProviderConfig() {
  return {
    api_key_env: 'GITHUB_TOKEN',
    repos: [],
    poll_interval: 60,
    mcp_hint: 'GitHub MCP server',
    states: { review: 'closed' },
  };
}

export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };
