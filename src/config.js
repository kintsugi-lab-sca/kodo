// @ts-check
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
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
 * Escritura atómica no-corruptiva (Phase 63, D-08/PERSIST-05). Helper interno
 * reusado por `saveConfig`/`saveProjects` (y futuro editor de proyectos de Phase 64).
 *
 * Escribe `data` a `path + '.tmp'` y luego `renameSync(tmp, path)`. Si la serialización
 * o el `writeFileSync` previo fallan, el `renameSync` no se ejecuta y `path` queda
 * INTACTO byte-a-byte (PERSIST-05). El lector nunca observa un fichero a medias.
 *
 * El `.tmp` se crea SIEMPRE en el mismo directorio que el destino: `rename(2)` solo
 * es atómico intra-filesystem (un rename cross-fs lanza EXDEV — Pitfall 4). Por eso
 * NUNCA se usa `os.tmpdir()`.
 *
 * `path` se recibe como PARÁMETRO (DI puro) para que los tests lo ejerciten contra un
 * tmpdir sin depender de `KODO_DIR` (que este módulo cachea al import — fuga de
 * aislamiento conocida, obs. 21811/22683).
 *
 * `fsync` se omite en v1 (A1): `rename` solo basta para crash-safety de PROCESO; la
 * durabilidad ante corte de energía (fsync del fichero + del dir) se difiere — el
 * config se regenera trivialmente.
 *
 * @param {string} path - destino final.
 * @param {string} data - contenido ya serializado (incluye el `\n` final).
 * @returns {void}
 */
function writeFileAtomic(path, data) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, data); // si lanza, `path` no se tocó
  renameSync(tmp, path);    // swap atómico intra-fs
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
  writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
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
  writeFileAtomic(PROJECTS_PATH, JSON.stringify(projects, null, 2) + '\n');
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
 * Prueba de PRESENCIA de la API key del provider — SETUP-04/D-09. Devuelve `true` si
 * la env var del provider (`config.providers[provider].api_key_env`) existe con valor
 * NO-vacío en `process.env` (el cache que `loadEnvFile` pobló al import + cualquier
 * actualización in-proceso tras `writeEnvVar`).
 *
 * D-09 (discreción del planner): consulta el `process.env` cacheado en vez de re-leer
 * el `.env`. Es coherente con el resto de lecturas del runtime (`getProviderApiKey`) y
 * refleja al instante un save del masked input que actualiza `process.env[key]` — el
 * indicador `[configurado]` se recalcula en el próximo render sin tocar disco.
 *
 * NUNCA devuelve ni expone el VALOR (PERSIST-04/Pitfall 11): solo el booleano de presencia.
 *
 * @param {string} [providerName] - provider a comprobar. Default `config.provider`.
 * @returns {boolean} true si la key existe y no está vacía.
 */
export function isApiKeyConfigured(providerName) {
  const key = getProviderApiKey(providerName);
  return typeof key === 'string' && key.length > 0;
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

/**
 * Valida una CLAVE de variable de entorno destinada a `~/.kodo/.env`.
 *
 * El parser de `loadEnvFile` (config.js:12-28) es naive: `trim`, `split` en el
 * PRIMER `=`, y salta líneas vacías o que empiezan por `#`. Por eso se RECHAZAN
 * (Pitfall 14 — validar+rechazar, NUNCA escapar) las claves que romperían el
 * round-trip parse→write→parse o el merge:
 *   - vacías,
 *   - con `#` (el parser saltaría la línea entera),
 *   - con `=` (el parser partiría la clave por el primer `=`),
 *   - con CUALQUIER whitespace, incluido `\n`/`\r` (inyectaría o clobbearía otras
 *     líneas del `.env` — el vector de mayor riesgo para el merge) y espacios
 *     (el `trim` del parser desalinearía la clave). Superset de "leading spaces".
 *
 * Las API keys reales de los providers (Plane `plane_api_...`, GitHub `ghp_...`)
 * no usan ninguno de estos caracteres, así que la restricción es zero-cost.
 *
 * @param {string} key
 * @returns {boolean} true si la clave es segura para el formato naive del `.env`.
 */
export function validateEnvKey(key) {
  return typeof key === 'string' && key.length > 0 && !/[#=\s]/.test(key);
}

/**
 * Valida un VALOR de variable de entorno destinado a `~/.kodo/.env`.
 *
 * Mismas reglas que {@link validateEnvKey} (Pitfall 14 — validar+rechazar): se
 * rechazan valores vacíos o con `#`, `=`, o whitespace. El `\n`/`\r` es el más
 * crítico: un valor multilínea inyectaría líneas nuevas en el `.env` y podría
 * clobbear `GITHUB_TOKEN`/`PLANE_WEBHOOK_SECRET` (rompe el boundary PERSIST-04).
 *
 * @param {string} value
 * @returns {boolean} true si el valor es seguro para el formato naive del `.env`.
 */
export function validateEnvValue(value) {
  return typeof value === 'string' && value.length > 0 && !/[#=\s]/.test(value);
}

/**
 * Escritor ÚNICO de secretos (API keys) a `~/.kodo/.env` — Boundary PERSIST-04.
 *
 * Es el 3er escritor de la fontanería de `config.js` junto a `saveConfig`/
 * `saveProjects` (SETUP-05), pero NO reusa `writeFileAtomic` (Pitfall 13 —
 * LOAD-BEARING): ese helper hace `writeFileSync(tmp)`+`renameSync` SIN `chmod`,
 * dejando el `.env` a umask (0644 world-readable) y un `.env.tmp` 0644 con el
 * secreto en claro. En su lugar, `writeEnvVar` es espejo directo de `writePidFile`
 * (polling-daemon.js:94-101): `writeFileSync(tmp)` → **`chmodSync(tmp, 0o600)`
 * PRE-rename** → `renameSync(tmp, envPath)`. El fichero final es 0600 el instante
 * en que aparece; el `.tmp` además se crea ya con `mode:0o600` (defense-in-depth).
 *
 * Escritura **parse-merge-write** (D-03), nunca full-rewrite de una sola key:
 * lee el `.env` con el MISMO parser naive que `loadEnvFile`, hace **upsert** de la
 * key objetivo (reemplaza in-place si existe, append si no) y **preserva verbatim**
 * el resto de líneas (otras keys, comentarios, líneas en blanco). Si no existe el
 * `.env`, lo crea solo con esa key. Idempotente: escribir la misma key dos veces
 * produce el mismo contenido.
 *
 * `envPath` se recibe como PARÁMETRO (DI puro, default `ENV_PATH`) para que los
 * tests lo ejerciten contra un tmpdir SIN depender de `KODO_DIR`/`HOME` (que este
 * módulo cachea al import — fuga de aislamiento conocida, obs. 21811/22683) y sin
 * tocar el `~/.kodo/.env` real del dev.
 *
 * Contrato de fallo dual:
 *   - Input inválido (Pitfall 14) → **throw `TypeError`** (bug del caller; el
 *     masked input de Phase 67-02 pre-valida con `validateEnvKey`/`validateEnvValue`).
 *   - Fallo de I/O (mkdir/write/rename) → **never-throws**, devuelve `false`.
 *   - Éxito → devuelve `true`.
 *
 * @param {string} key - nombre de la env var (p.ej. `PLANE_API_KEY`). Ver {@link validateEnvKey}.
 * @param {string} value - valor del secreto. Ver {@link validateEnvValue}.
 * @param {string} [envPath=ENV_PATH] - destino final; DI para tests.
 * @returns {boolean} true si el write se completó; false ante fallo de I/O.
 * @throws {TypeError} si `key` o `value` no pasan validación.
 */
export function writeEnvVar(key, value, envPath = ENV_PATH) {
  if (!validateEnvKey(key)) {
    throw new TypeError(
      `writeEnvVar: clave inválida (vacía, o contiene '#', '=' o whitespace): ${JSON.stringify(key)}`,
    );
  }
  if (!validateEnvValue(value)) {
    throw new TypeError(
      "writeEnvVar: valor inválido (vacío, o contiene '#', '=' o whitespace)",
    );
  }

  try {
    // Parse-merge: lee el .env existente con el MISMO parser naive que loadEnvFile.
    const raw = existsSync(envPath) ? readFileSync(envPath, 'utf-8') : '';
    const lines = raw.length ? raw.split('\n') : [];
    // Descarta el ÚNICO '' final que produce split() sobre un trailing '\n', para
    // no acumular líneas en blanco a través de escrituras sucesivas (idempotencia).
    if (lines.length && lines[lines.length - 1] === '') lines.pop();

    let replaced = false;
    const out = lines.map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line; // preserva verbatim
      const eq = trimmed.indexOf('=');
      if (eq === -1) return line; // línea sin '=' → preserva verbatim
      if (trimmed.slice(0, eq).trim() === key) {
        replaced = true;
        return `${key}=${value}`; // upsert in-place (forma canónica)
      }
      return line; // OTRA key → preserva verbatim (nunca se clobbea)
    });
    if (!replaced) out.push(`${key}=${value}`); // append si no existía

    const content = out.join('\n') + '\n';

    // Atomic + chmod 0600 PRE-rename (espejo de writePidFile, Pitfall 13).
    mkdirSync(dirname(envPath), { recursive: true, mode: 0o700 });
    const tmp = envPath + '.tmp';
    writeFileSync(tmp, content, { mode: 0o600 }); // mode sujeto a umask
    chmodSync(tmp, 0o600); // garantía exacta 0600 (no sujeto a umask), PRE-rename
    renameSync(tmp, envPath); // swap atómico intra-fs
    return true;
  } catch {
    return false; // never-throws ante fallo de I/O
  }
}

export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, ENV_PATH, DEFAULT_CONFIG, writeFileAtomic };
