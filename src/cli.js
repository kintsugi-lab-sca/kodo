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
  .description('kodo — automated Claude Code sessions from task management systems')
  .version(pkg.version);

// --- kodo config ---
program
  .command('config')
  .description('Configure provider API key, workspace, and project mappings')
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

// --- kodo start ---
program
  .command('start')
  .description('Start the webhook server')
  .option('-p, --port <port>', 'Port to listen on')
  .option('--insecure', 'Skip webhook secret verification (development only)')
  .action(async (opts) => {
    await ensureConfig();
    const { startServer } = await import('./server.js');
    await startServer({ port: opts.port ? parseInt(opts.port, 10) : undefined, insecure: opts.insecure });
  });

// --- kodo stop ---
program
  .command('stop')
  .description('Stop the webhook server')
  .action(async () => {
    const { stopServer } = await import('./server.js');
    stopServer();
  });

// --- kodo check ---
program
  .command('check')
  .description('Quick health check — launches orchestrator if action needed (no LLM, no tokens)')
  .option('--dry-run', 'Only report, don\'t launch orchestrator')
  .action(async (opts) => {
    await ensureConfig();
    if (opts.dryRun) {
      const { runCheck } = await import('./check.js');
      const result = await runCheck();
      console.log(result.summary);
      if (result.needsOrchestrator) {
        console.log(`Would launch orchestrator: ${result.reasons.join('; ')}`);
      }
    } else {
      const { runCheckAndAct } = await import('./check.js');
      await runCheckAndAct();
    }
  });

// --- kodo install ---
program
  .command('install')
  .description('Install kodo hooks into Claude Code settings')
  .action(async () => {
    const { installHooks } = await import('./hooks/install.js');
    installHooks();
  });

// --- kodo uninstall ---
program
  .command('uninstall')
  .description('Remove kodo hooks from Claude Code settings')
  .action(async () => {
    const { uninstallHooks } = await import('./hooks/install.js');
    uninstallHooks();
  });

// --- kodo orchestrate ---
program
  .command('orchestrate')
  .description('Launch the orchestrator Claude session')
  .action(async () => {
    try {
      const { launchOrchestrator } = await import('./orchestrator/launch.js');
      const result = await launchOrchestrator();
      if (result.existing) {
        console.log(`Orchestrator already running at ${result.workspace}`);
      } else {
        console.log(`✓ Orchestrator launched at ${result.workspace}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- kodo launch ---
program
  .command('launch <ref>')
  .description('Launch a Claude Code session for a task (e.g. KL-42)')
  .option('--model <model>', 'Override Claude model')
  .option('--yolo', 'Skip confirmation prompts')
  .option('--force', 'Skip kodo label requirement')
  .action(async (ref, opts) => {
    await ensureConfig();
    try {
      const { initRegistry, getProvider } = await import('./providers/registry.js');
      const { loadConfig } = await import('./config.js');
      const { dispatchTrigger } = await import('./triggers/dispatcher.js');

      const config = loadConfig();
      await initRegistry();

      const event = {
        taskRef: ref.toUpperCase(),
        action: 'manual',
        provider: config.provider,
        raw: { source: 'cli', model: opts.model, yolo: opts.yolo },
      };

      const result = await dispatchTrigger(event, {
        model: opts.model || null,
        flags: opts.yolo ? ['yolo'] : [],
        force: opts.force || false,
      });

      if (result.action === 'launched' || result.action === 'stale_relaunch') {
        console.log(`\u2713 Launched session for ${ref.toUpperCase()}`);
        console.log(`  Workspace: ${result.session.workspace_ref}`);
        console.log(`  Session ID: ${result.session.session_id}`);
        console.log(`  Path: ${result.session.project_path}`);
      } else if (result.action === 'ignored') {
        console.log(`Ignored: ${ref.toUpperCase()} \u2014 no kodo label (use --force to override)`);
      } else if (result.action === 'already_active') {
        console.log(`Session already active for ${ref.toUpperCase()}`);
      }
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
    await ensureConfig();
    const { listSessions } = await import('./session/state.js');
    const sessions = listSessions();

    if (sessions.length === 0) {
      console.log('No active sessions.');
      return;
    }

    console.log(`Active sessions (${sessions.length}):\n`);
    for (const s of sessions) {
      const elapsed = timeSince(s.started_at);
      console.log(`  ${s.task_ref}  ${s.summary}`);
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

/**
 * Checks if config.json exists. If not, launches the interactive wizard.
 * Used as a guard at the top of commands that need a provider.
 */
async function ensureConfig() {
  const { existsSync } = await import('node:fs');
  const { CONFIG_PATH } = await import('./config.js');

  if (!existsSync(CONFIG_PATH)) {
    console.log('Primera vez? Vamos a configurar kodo.\n');
    await interactiveConfig();

    if (!existsSync(CONFIG_PATH)) {
      console.error('Config requerida.');
      process.exit(1);
    }
  }
}

async function interactiveConfig() {
  const { createInterface } = await import('node:readline');
  const { existsSync } = await import('node:fs');
  const { loadConfig, saveConfig, loadProjects, saveProjects, getProviderApiKey } = await import('./config.js');
  const config = loadConfig();

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log('\n  kodo config\n');

  // Step 1: Select provider
  const availableProviders = ['plane'];
  console.log('  Proveedores disponibles:');
  for (let i = 0; i < availableProviders.length; i++) {
    console.log(`    ${i + 1}. ${availableProviders[i]}`);
  }
  const providerChoice = await ask(`\n  Selecciona proveedor [1]: `);
  const providerIndex = parseInt(providerChoice.trim() || '1', 10) - 1;
  const selectedProvider = availableProviders[providerIndex] || availableProviders[0];
  config.provider = selectedProvider;

  console.log(`\n  Proveedor: ${selectedProvider}\n`);

  // Step 2: Provider-specific config
  if (!config.providers) config.providers = {};
  if (!config.providers[selectedProvider]) {
    config.providers[selectedProvider] = {};
  }
  const providerConfig = config.providers[selectedProvider];

  // API key env var
  const defaultEnvVar = providerConfig.api_key_env || `${selectedProvider.toUpperCase()}_API_KEY`;
  const envVarName = await ask(`  Variable de entorno para API key [${defaultEnvVar}]: `);
  providerConfig.api_key_env = envVarName.trim() || defaultEnvVar;

  // Check API key is set
  const apiKey = getProviderApiKey(selectedProvider);
  if (!apiKey) {
    console.log(`\n  ✗ ${providerConfig.api_key_env} no esta configurada.`);
    console.log(`  Configura la variable y vuelve a ejecutar kodo config.\n`);
    rl.close();
    return;
  }
  console.log(`  ✓ API key configurada\n`);

  // Workspace slug (provider-specific)
  if (selectedProvider === 'plane') {
    const defaultSlug = providerConfig.workspace_slug || '';
    const slug = await ask(`  Workspace slug [${defaultSlug}]: `);
    providerConfig.workspace_slug = slug.trim() || defaultSlug;

    // Base URL
    const defaultUrl = providerConfig.base_url || 'https://tasks.kintsugi-lab.com';
    const baseUrl = await ask(`  Base URL [${defaultUrl}]: `);
    providerConfig.base_url = baseUrl.trim() || defaultUrl;
  }

  // States config (defaults)
  if (!providerConfig.states) {
    providerConfig.states = { trigger: 'In Progress', review: 'In review', done: 'Done' };
  }

  // Step 3: Validate connection
  console.log('\n  Validando conexion...');
  try {
    const { initRegistry, getProvider } = await import('./providers/registry.js');
    await initRegistry();
    const provider = getProvider(selectedProvider);
    await provider.init();
    console.log('  ✓ Conexion validada\n');

    // Step 4: List projects
    const remoteProjects = await provider.listProjects();
    const projects = loadProjects();

    console.log(`  Encontrados ${remoteProjects.length} proyectos:\n`);

    for (let i = 0; i < remoteProjects.length; i++) {
      const p = remoteProjects[i];
      const current = projects[p.id];
      const label = current ? `[${current}]` : '[sin mapear]';
      console.log(`    ${i + 1}. ${p.identifier} — ${p.name} ${label}`);
    }

    const selection = await ask(`\n  Proyectos a seguir (numeros separados por coma, Enter para todos): `);
    let selectedProjects;
    if (selection.trim()) {
      const indices = selection.split(',').map((s) => parseInt(s.trim(), 10) - 1);
      selectedProjects = indices
        .filter((i) => i >= 0 && i < remoteProjects.length)
        .map((i) => remoteProjects[i]);
    } else {
      selectedProjects = remoteProjects;
    }

    // Map project paths
    for (const p of selectedProjects) {
      const current = projects[p.id];
      const path = await ask(`    Path local para ${p.identifier} (Enter para ${current ? 'mantener' : 'saltar'}): `);
      if (path.trim()) {
        if (existsSync(path.trim())) {
          projects[p.id] = path.trim();
          console.log(`    ✓ Mapeado\n`);
        } else {
          console.log(`    ✗ "${path.trim()}" no existe, ignorado\n`);
        }
      } else {
        console.log('');
      }
    }

    saveProjects(projects);

    // Save selected projects to provider config
    providerConfig.projects = selectedProjects.map((p) => ({ id: p.id, identifier: p.identifier, name: p.name }));
    saveConfig(config);
    console.log('  ✓ Configuracion guardada en ~/.kodo/\n');
  } catch (err) {
    console.error(`\n  ✗ Error validando conexion: ${err.message}`);
    const retry = await ask('  Reintentar? (s/N): ');
    if (retry.trim().toLowerCase() === 's') {
      rl.close();
      return interactiveConfig();
    }
  }

  rl.close();
}
