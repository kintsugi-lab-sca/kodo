// @ts-check
//
// src/cli/config-cmd.js — la superficie de `kodo config` y el gate de configuración (KODO-42).
//
// Exports:
//   - runConfigCli(opts)   — el writer no interactivo: `--show`, `--set`, `--map-project`.
//                            Sin flags cae al wizard. Devuelve el exit code, nunca sale.
//   - ensureConfig()       — guard al principio de los comandos que necesitan provider:
//                            si no hay config.json lanza el wizard, y si sigue sin haberla
//                            termina el proceso (única salida propia del módulo).
//   - interactiveConfig()  — el wizard headless de readline.
//
// Los tres vivían inline en `src/cli.js`; se mueven verbatim salvo por el retorno de código
// en `runConfigCli` (antes `process.exit(1)`, ahora `return EXIT_ERROR`: el exit lo hace el
// registro de commander) y por las rutas de import, ahora relativas a `src/cli/`.
//
// SETUP-05 — invariante single-writer del wizard: persiste EXCLUSIVAMENTE vía
// `saveConfig`/`saveProjects` de `config.js`, comprueba la PRESENCIA de la API key
// (`getProviderApiKey`) sin capturar nunca su VALOR (D-10/D-11: el valor entra solo por el
// campo enmascarado del dashboard) y no hace shell-out. Blindado en
// `test/cli/config-writers.test.js`, que lee el cuerpo de `interactiveConfig` de este fichero.

import { EXIT_SUCCESS, EXIT_ERROR } from './exit-codes.js';

/**
 * `kodo config [--show|--set|--map-project]`. Sin flags, delega en el wizard interactivo.
 *
 * @param {{ show?: boolean, set?: string, mapProject?: string }} opts
 * @returns {Promise<number>} exit code
 */
export async function runConfigCli(opts) {
  const { loadConfig, loadRawConfig, saveConfig, loadProjects, saveProjects } = await import('../config.js');
  const { setNestedValue, parseSetArg, parseMapProjectArg } = await import('./config-args.js');

  if (opts.show) {
    const config = loadConfig();
    const projects = loadProjects();
    console.log('Config:', JSON.stringify(config, null, 2));
    console.log('\nProject mappings:', JSON.stringify(projects, null, 2));
    return EXIT_SUCCESS;
  }

  if (opts.set) {
    // M14: parseo por indexOf → el value preserva `=` internos (token=a=b=c).
    const { key, value } = parseSetArg(opts.set);
    if (!key || value === undefined) {
      console.error('Usage: --set key=value (e.g. plane.workspace_slug=klab)');
      return EXIT_ERROR;
    }
    // WR-05: se lee/muta/guarda el config CRUDO de disco (loadRawConfig), NO loadConfig().
    // Tras B7, loadConfig() devuelve el merge completo con DEFAULT_CONFIG; persistir ESO
    // congelaría todos los defaults en ~/.kodo/config.json (pinning: los cambios futuros de
    // DEFAULT_CONFIG dejarían de aplicar, y amplificaría CR-01 persistiendo el host hardcodeado).
    // Config ausente → {} (solo se persiste la clave puesta; loadConfig mergea en runtime).
    const config = loadRawConfig() ?? {};
    try {
      // M3: setNestedValue rechaza __proto__/constructor/prototype (prototype pollution).
      setNestedValue(config, key, value);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return EXIT_ERROR;
    }
    saveConfig(config);
    console.log(`Set ${key} = ${value}`);
    return EXIT_SUCCESS;
  }

  if (opts.mapProject) {
    // M14: parseo por indexOf → localPath preserva `:` internos (rutas absolutas).
    const { projectId, localPath } = parseMapProjectArg(opts.mapProject);
    if (!projectId || !localPath) {
      console.error('Usage: --map-project projectId:/local/path');
      return EXIT_ERROR;
    }
    const projects = loadProjects();
    projects[projectId] = localPath;
    saveProjects(projects);
    console.log(`Mapped project ${projectId} → ${localPath}`);
    return EXIT_SUCCESS;
  }

  // Interactive config: list Plane projects and let user map them
  await interactiveConfig();
  return EXIT_SUCCESS;
}

/**
 * Checks if config.json exists. If not, launches the interactive wizard.
 * Used as a guard at the top of commands that need a provider.
 */
export async function ensureConfig() {
  const { existsSync } = await import('node:fs');
  const { CONFIG_PATH } = await import('../config.js');

  if (!existsSync(CONFIG_PATH)) {
    console.log('Primera vez? Vamos a configurar kodo.\n');
    await interactiveConfig();

    if (!existsSync(CONFIG_PATH)) {
      console.error('Config requerida.');
      process.exit(EXIT_ERROR);
    }
  }
}

export async function interactiveConfig() {
  const { createInterface } = await import('node:readline');
  const { existsSync } = await import('node:fs');
  const { loadConfig, saveConfig, loadProjects, saveProjects, getProviderApiKey } = await import('../config.js');
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
    const { configureGithubProvider } = await import('./polling.js');
    const { getDefaultGithubProviderConfig } = await import('../config.js');
    const { createFormatter } = await import('./format.js');
    const fmt = createFormatter(process.stdout);

    // D-08 runtime-only inject (NO modificar DEFAULT_CONFIG)
    config.providers.github = config.providers.github || getDefaultGithubProviderConfig();
    // Preservar el api_key_env ya capturado arriba (gate pre-check de presencia)
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
    const { initRegistry, getProvider } = await import('../providers/registry.js');
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
          const { PlaneClient } = await import('../providers/plane/client.js');
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
