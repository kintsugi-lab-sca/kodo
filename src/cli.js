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

// --- kodo orchestrate --- (Phase 26 Plan 03 / CFG-04 / D-16..19 / W-5 LOCKED)
program
  .command('orchestrate')
  .description('Launch the orchestrator Claude session')
  .option(
    '--polling',
    'Arranca polling integrado en el orchestrator (mismo proceso). NO usar con `kodo polling start` simultáneo sobre el mismo repo — mutex implícito vía lock per-repo Phase 8 GSD-10.',
  )
  .action(async (opts) => {
    // W-5 LOCKED — ORDEN ESTRICTO:
    //   PASO 0: SIGINT/SIGTERM handlers ANTES de cualquier setup async (T-26-04 race mitigation).
    //   PASO 1: runOrchestratePollingSetup({...}) ANTES de launchOrchestrator.
    //   PASO 2: launchOrchestrator(opts) DESPUÉS de polling activo.
    //   PASO 3: outer catch limpia pollingHandle?.stop() antes de process.exit(1).
    //   PASO 4: cleanup() handler invoca pollingHandle?.stop() + process.exit(0); idempotente.
    /** @type {{ stop: () => void } | null} */
    let pollingHandle = null;

    // PASO 0: instalar SIGINT/SIGTERM handlers antes de cualquier async work.
    // Idempotente: si SIGINT llega antes de `pollingHandle = await ...`, el handler
    // ve `pollingHandle === null` y solo hace process.exit(0). Si llega después,
    // invoca handle.stop() envuelto en try/catch (T-26-CRASH).
    const cleanup = () => {
      try { if (pollingHandle) pollingHandle.stop(); } catch { /* idempotent */ }
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    try {
      // PASO 1: polling setup ANTES de launchOrchestrator (W-5 LOCKED).
      // Razón: si SIGINT llega durante launchOrchestrator setup, cleanup ya limpia polling.
      if (opts.polling) {
        const { runOrchestratePollingSetup } = await import('./cli/orchestrate.js');
        try {
          pollingHandle = await runOrchestratePollingSetup({ polling: true });
        } catch (e) {
          // exitCode propagated por el helper (2 si config gate, undefined si crash).
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
        const { launchOrchestrator } = await import('./orchestrator/launch.js');
        const result = await launchOrchestrator();
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
      // El cleanup() handler instalado en PASO 0 hará process.exit(0) cuando llegue.
      if (opts.polling) {
        await new Promise(() => { /* block forever — cleanup() exit drains it */ });
      }
    } catch (err) {
      // W-5 LOCKED PASO 3+4: outer catch limpia pollingHandle antes de exit 1.
      try { if (pollingHandle) pollingHandle.stop(); } catch { /* idempotent */ }
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

// --- kodo logs ---
program
  .command('logs [session-id]')
  .description('Inspect a session log (dump, tail, filter)')
  .option('-f, --follow', 'Tail live output (like tail -f)')
  .option('-l, --level <level>', 'Min log level: debug|info|warn|error')
  .option('-c, --component <name>', 'Filter by component')
  .option('-e, --event-type <type...>', 'Filter by event type (repeatable)')
  .option('--json', 'Emit raw NDJSON (pipe-friendly)')
  .option('--session-of <task-id>', 'Resolve session-id from task id')
  .action(async (sessionId, opts) => {
    try {
      const { runLogs } = await import('./logs/reader.js');
      await runLogs({
        sessionId,
        follow: opts.follow || false,
        level: opts.level,
        component: opts.component,
        eventType: opts.eventType,
        json: opts.json || false,
        sessionOf: opts.sessionOf,
      });
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- kodo gsd <subcommand> ---
const gsd = program.command('gsd').description('GSD subcommands (inspect resolver, etc.)');

gsd
  .command('inspect <task-id>')
  .description('Dry-run the phase resolver for a task (read-only, no lock/state/cmux)')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(async (taskId, opts) => {
    try {
      await ensureConfig();
      const { runGsdInspect } = await import('./cli/gsd-inspect.js');
      const code = await runGsdInspect({ taskId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

gsd
  .command('verify <session-id>')
  .description('Verify phase closure: parses VERIFICATION.md, posts verdict comment and transitions task to Review on pass (idempotent — duplicates accepted, CONTEXT Deferred)')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(async (sessionId, opts) => {
    try {
      await ensureConfig();
      const { runGsdVerifyCli } = await import('./cli/gsd-verify.js');
      const code = await runGsdVerifyCli({ sessionId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- kodo skill <subcommand> ---
const skill = program.command('skill').description('Skill management subcommands (sync, etc.)');

skill
  .command('sync')
  .description('Sync canonical skill <repo>/.claude/skills/kodo-orchestrate/ → ~/.claude/skills/kodo-orchestrate/')
  .option('--prune', 'Remove foreign files in home that are not in repo (destructive; opt-in)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    try {
      // NOTE: NO `ensureConfig()` — kodo skill sync no requiere provider configurado
      // (RESEARCH §Open Question 1; gate D-07 exit 2 sustituye al check de config).
      const { runSkillSyncCli } = await import('./cli/skill-sync.js');
      const code = await runSkillSyncCli({ prune: opts.prune || false, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

// --- kodo polling <subcommand> --- (Plan 26-02 / CFG-03 / D-09..15)
const polling = program.command('polling').description('GitHub polling daemon (start/stop/status)');

polling
  .command('start')
  .description('Start polling daemon (default: detached background; mac/linux only)')
  .option('--no-daemon', 'Run in foreground; SIGINT/SIGTERM cancel cleanly (cross-platform)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .option(
    '--verbose',
    'Emit polling.tick.summary line per tick to stdout (foreground) or logfile (daemon). Orthogonal to --daemon. Phase 28 DAEMON-01.',
    false,
  )
  .action(async (opts) => {
    try {
      // NO ensureConfig() — el handler tiene su propio gate D-14 exit 2 para
      // config missing (providers.github.repos vacío o GITHUB_TOKEN no set).
      const { runPollingStartCli } = await import('./cli/polling.js');
      const code = await runPollingStartCli({
        // commander: `--no-daemon` se exposes como `opts.daemon === false`.
        noDaemon: opts.daemon === false,
        json: opts.json || false,
        // Phase 28 D-07/D-08: --verbose is orthogonal to --daemon.
        verbose: opts.verbose || false,
      });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

polling
  .command('stop')
  .description('Stop polling daemon via PID file (SIGTERM + 5s wait + SIGKILL fallback)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    try {
      const { runPollingStopCli } = await import('./cli/polling.js');
      process.exit(await runPollingStopCli({ json: opts.json || false }));
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });

polling
  .command('status')
  .description('Show polling daemon status (running|idle); --json byte-deterministic')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    try {
      const { runPollingStatusCli } = await import('./cli/polling.js');
      process.exit(await runPollingStatusCli({ json: opts.json || false }));
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
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
  const availableProviders = ['plane', 'github'];  // D-01 (Phase 26)
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

  // ── Phase 26 D-01..D-06: provider:github branch ──
  // Delegado a helper exportado en src/cli/polling.js (DI-zable para tests).
  // D-20 LOCKED: TODOS los outputs user-facing del branch van via createFormatter
  // (color isolation invariante v0.5). Cero `console.log` raw aquí.
  // D-08: providers.github se inicializa SOLO en runtime (no en DEFAULT_CONFIG).
  if (selectedProvider === 'github') {
    const { configureGithubProvider } = await import('./cli/polling.js');
    const { getDefaultGithubProviderConfig } = await import('./config.js');
    const { createFormatter } = await import('./cli/format.js');
    const fmt = createFormatter(process.stdout);

    // D-08 runtime-only inject (NO modificar DEFAULT_CONFIG)
    config.providers.github = config.providers.github || getDefaultGithubProviderConfig();
    // Preservar api_key_env ya capturado en la línea 378 (gate pre-check)
    config.providers.github.api_key_env = providerConfig.api_key_env;
    await configureGithubProvider({ ask, providerConfig: config.providers.github });

    // D-05 resumen final — todos los outputs via fmt.* (D-20 LOCKED)
    process.stdout.write('\n  ' + fmt.cyan('Resumen:') + '\n');
    for (const r of config.providers.github.repos) {
      process.stdout.write('    ' + fmt.dim('- ') + r.owner + '/' + r.repo + '\n');
    }
    process.stdout.write('  ' + fmt.dim('poll_interval: ') + config.providers.github.poll_interval + 's\n');

    const okRaw = await ask('\n  Guardar? [S/n]: ');
    const okAns = okRaw.trim().toLowerCase();
    if (okAns !== '' && okAns !== 's') {
      process.stdout.write('  ' + fmt.warn('Abortado sin guardar.') + '\n');
      rl.close();
      return;
    }
    saveConfig(config);
    process.stdout.write('  ' + fmt.ok('Configuracion guardada en ~/.kodo/') + '\n');
    rl.close();
    return;  // Pattern H — NO caer al Plane projects listing, NO recursión
  }

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

    // Map project paths (with optional module support)
    for (const p of selectedProjects) {
      const current = projects[p.id];
      const currentDisplay = typeof current === 'string' ? current : current?.default || null;
      const path = await ask(`    Path local para ${p.identifier} (Enter para ${currentDisplay ? 'mantener' : 'saltar'}): `);

      if (path.trim()) {
        if (!existsSync(path.trim())) {
          console.log(`    ✗ "${path.trim()}" no existe, ignorado\n`);
          continue;
        }
        projects[p.id] = path.trim();
        console.log(`    ✓ Mapeado`);
      } else if (!currentDisplay) {
        console.log('');
        continue;
      }

      // Ask about modules
      const mapModules = await ask(`    ¿Tiene módulos con carpetas independientes? (s/N): `);
      if (mapModules.trim().toLowerCase() === 's') {
        try {
          const { PlaneClient } = await import('./providers/plane/client.js');
          const planeClient = new PlaneClient({
            baseUrl: providerConfig.base_url,
            apiKey: process.env[providerConfig.api_key_env],
            workspaceSlug: providerConfig.workspace_slug,
          });
          const modules = await planeClient.listModules(p.id);
          if (modules.length === 0) {
            console.log(`    No se encontraron módulos en ${p.identifier}\n`);
            continue;
          }

          console.log(`\n    Módulos de ${p.identifier}:`);
          for (let j = 0; j < modules.length; j++) {
            console.log(`      ${j + 1}. ${modules[j].name}`);
          }

          const defaultPath = typeof projects[p.id] === 'string' ? projects[p.id] : projects[p.id]?.default || path.trim();
          const moduleMap = {};

          for (const mod of modules) {
            const modPath = await ask(`      Path para ${mod.name} (Enter para saltar): `);
            if (modPath.trim()) {
              if (existsSync(modPath.trim())) {
                moduleMap[mod.name] = modPath.trim();
                console.log(`      ✓ ${mod.name} mapeado`);
              } else {
                console.log(`      ✗ "${modPath.trim()}" no existe, ignorado`);
              }
            }
          }

          if (Object.keys(moduleMap).length > 0) {
            projects[p.id] = { default: defaultPath, modules: moduleMap };
            console.log(`    ✓ ${Object.keys(moduleMap).length} módulo(s) mapeados\n`);
          } else {
            console.log('');
          }
        } catch (err) {
          console.log(`    ✗ Error listando módulos: ${err.message}\n`);
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
