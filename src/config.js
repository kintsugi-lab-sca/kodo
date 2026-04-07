// @ts-check
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const KODO_DIR = join(homedir(), '.kodo');
const CONFIG_PATH = join(KODO_DIR, 'config.json');
const PROJECTS_PATH = join(KODO_DIR, 'projects.json');

const DEFAULT_CONFIG = {
  plane: {
    base_url: 'https://tasks.kintsugi-lab.com',
    api_key_env: 'PLANE_API_KEY',
    workspace_slug: 'k-lab',
    projects: [],
    trigger_state: 'In Progress',
    done_state: 'Done',
    review_state: 'In Review',
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
    flags: ['--dangerously-skip-permissions'],
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

/** @returns {typeof DEFAULT_CONFIG} */
export function loadConfig() {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
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

/** @returns {string|undefined} */
export function getPlaneApiKey() {
  const config = loadConfig();
  return process.env[config.plane.api_key_env];
}

export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };
