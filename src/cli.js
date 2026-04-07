// @ts-check
import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('kodo')
  .description('Plane-cmux bridge — automated Claude Code sessions from kanban tasks')
  .version(pkg.version);

// --- kodo config ---
program
  .command('config')
  .description('Configure Plane API key, workspace, and project mappings')
  .option('--show', 'Show current config')
  .option('--set <key=value>', 'Set a config value (dot notation: plane.workspace_slug=klab)')
  .option('--map-project <projectId:path>', 'Map a Plane project ID to a local path')
  .action(async (opts) => {
    const { loadConfig, saveConfig, loadProjects, saveProjects } = await import('./config.js');

    if (opts.show) {
      const config = loadConfig();
      const projects = loadProjects();
      console.log('Config:', JSON.stringify(config, null, 2));
      console.log('\nProject mappings:', JSON.stringify(projects, null, 2));
      return;
    }

    if (opts.set) {
      const [key, value] = opts.set.split('=');
      if (!key || value === undefined) {
        console.error('Usage: --set key=value (e.g. plane.workspace_slug=klab)');
        process.exit(1);
      }
      const config = loadConfig();
      setNestedValue(config, key, value);
      saveConfig(config);
      console.log(`Set ${key} = ${value}`);
      return;
    }

    if (opts.mapProject) {
      const [projectId, localPath] = opts.mapProject.split(':');
      if (!projectId || !localPath) {
        console.error('Usage: --map-project projectId:/local/path');
        process.exit(1);
      }
      const projects = loadProjects();
      projects[projectId] = localPath;
      saveProjects(projects);
      console.log(`Mapped project ${projectId} → ${localPath}`);
      return;
    }

    // Interactive config: list Plane projects and let user map them
    await interactiveConfig();
  });

// --- kodo launch ---
program
  .command('launch <identifier>')
  .description('Launch a Claude Code session for a Plane work item (e.g. KL-42)')
  .action(async (identifier) => {
    try {
      const { launchWorkItem } = await import('./session/manager.js');
      const session = await launchWorkItem(identifier.toUpperCase());
      console.log(`✓ Launched session for ${session.plane_identifier}`);
      console.log(`  Workspace: ${session.workspace_ref}`);
      console.log(`  Session ID: ${session.session_id}`);
      console.log(`  Path: ${session.project_path}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- kodo status ---
program
  .command('status')
  .description('Show active sessions')
  .action(async () => {
    const { listSessions } = await import('./session/state.js');
    const sessions = listSessions();

    if (sessions.length === 0) {
      console.log('No active sessions.');
      return;
    }

    console.log(`Active sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      const elapsed = timeSince(s.started_at);
      console.log(`  ${s.plane_identifier}  ${s.summary}`);
      console.log(`    Status: ${s.status}  |  Workspace: ${s.workspace_ref}  |  ${elapsed}`);
      console.log(`    Path: ${s.project_path}`);
      console.log();
    }
  });

program.parse();

// --- Helpers ---

/**
 * @param {object} obj
 * @param {string} path
 * @param {any} value
 */
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/** @param {string} isoDate */
function timeSince(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  return `${hrs}h ${min % 60}m ago`;
}

async function interactiveConfig() {
  const { loadConfig, saveConfig, loadProjects, saveProjects, getPlaneApiKey } = await import('./config.js');
  const config = loadConfig();

  const apiKey = getPlaneApiKey();
  if (!apiKey) {
    console.log(`Set ${config.plane.api_key_env} env var first, then re-run kodo config.`);
    console.log(`  export ${config.plane.api_key_env}=your-api-key`);
    return;
  }

  console.log('Fetching Plane projects...');
  try {
    const { PlaneClient } = await import('./plane/client.js');
    const plane = new PlaneClient();
    const planeProjects = await plane.listProjects();
    const projects = loadProjects();

    console.log(`\nFound ${planeProjects.length} projects:\n`);
    for (const p of planeProjects) {
      const mapped = projects[p.id] ? ` → ${projects[p.id]}` : ' (not mapped)';
      console.log(`  ${p.identifier}  ${p.name}  [${p.id}]${mapped}`);
    }

    console.log('\nMap projects with:');
    console.log('  kodo config --map-project <projectId>:/local/path');

    // Save project IDs to config
    config.plane.projects = planeProjects.map((p) => p.id);
    saveConfig(config);
  } catch (err) {
    console.error(`Error connecting to Plane: ${err.message}`);
  }
}
