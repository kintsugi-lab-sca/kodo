// @ts-check
//
// src/cli.js — la SUPERFICIE del CLI: qué comandos existen, qué flags aceptan y a qué
// módulo de `cli/` delega cada uno. Nada más (KODO-42).
//
// Reglas de este fichero:
//   - La lógica de cada acción vive en `src/cli/<comando>.js` y DEVUELVE un exit code;
//     nunca se escribe aquí inline.
//   - Los códigos de salida son las constantes de `cli/exit-codes.js` — cero literales
//     numéricos, para poder cruzar el contrato del README con un grep.
//   - `exitWithCode` / `setExitCode` (cli/action.js) eligen el carril de salida. NO son
//     intercambiables: el bloque del inbox y el writer de `config` usan `setExitCode`
//     porque un exit inmediato trunca stdout canalizado a 65536 bytes.
//   - Los imports de los módulos de acción son DINÁMICOS dentro de cada handler: el
//     arranque del CLI no paga el coste de un stack (ink, polling, git) que no va a usar.

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { exitWithCode, setExitCode } from './cli/action.js';
import { EXIT_ERROR } from './cli/exit-codes.js';
import { ensureConfig } from './cli/config-cmd.js';

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
  .action(setExitCode(async (opts) => {
    const { runConfigCli } = await import('./cli/config-cmd.js');
    return runConfigCli(opts);
  }));

// --- kodo up --- (Phase 66 / UP-01 / D-01 LOCKED)
// Comando NUEVO (no toca `kodo start`, D-03): arranca el daemon detached en
// background (server + polling vía `daemon run` hidden) y engancha el dashboard
// como VISOR. Al cerrar el dashboard el daemon PERSISTE (modelo LOCKED): runUp NO
// registra handlers que señalen al daemon — su aislamiento de process group lo da
// `detached:true` en startDaemon (lifecycle.js).
//
// SIN ensureConfig(): el wizard/first-run es Phase 68 (D-01) — `up` no debe forzar setup
// aquí. SIN salida explícita: el daemon queda vivo en su propio process group y runUp
// retorna al cerrar el visor. runUp es never-throws/fail-open y resuelve baseUrl
// config-driven internamente (resolveBaseUrl → DEFAULT_CONFIG.server.port).
program
  .command('up')
  .description('Arranca el daemon en background y engancha el dashboard como visor')
  .action(async () => {
    const { runUp } = await import('./cli/up.js');
    await runUp();
  });

// --- kodo start ---
program
  .command('start')
  .description('Start the webhook server')
  .option('-p, --port <port>', 'Port to listen on')
  .option('--insecure', 'Skip webhook secret verification (requires KODO_ALLOW_INSECURE=1)')
  .action(async (opts) => {
    // KODO-52: doble señal para el modo inseguro (flag + KODO_ALLOW_INSECURE=1).
    // Va ANTES de ensureConfig() para que el rechazo sea inmediato y sin ruido.
    (await import('./cli/insecure-gate.js')).enforceInsecureGate(opts.insecure);
    await ensureConfig();
    const { startServer } = await import('./server.js');
    await startServer({ port: opts.port ? parseInt(opts.port, 10) : undefined, insecure: opts.insecure });
  });

// --- kodo stop --- (Phase 66 / UP-05 / D-04 LOCKED)
// DAEMON-FIRST: tumba el daemon 'kodo' (kodo.pid) vía runStopUnified
// (SIGTERM→5s→SIGKILL). Preserva el comportamiento observable legacy: si NO hay
// daemon pero existe server.pid, runStopUnified cae al fallback que tumba el
// server legacy (back-compat de `kodo start`). `polling stop` standalone intacto.
program
  .command('stop')
  .description('Stop the kodo daemon (fallback: legacy webhook server)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    const { runStopUnified } = await import('./cli/stop-status.js');
    process.exit(await runStopUnified({ json: opts.json || false }));
  });

// --- kodo check ---
program
  .command('check')
  .description('Quick health check — launches orchestrator if action needed (no LLM, no tokens)')
  .option('--dry-run', 'Only report, don\'t launch orchestrator')
  .action(async (opts) => {
    await ensureConfig();
    const { runCheck, runCheckAndAct } = await import('./check.js');
    if (!opts.dryRun) {
      await runCheckAndAct();
      return;
    }
    const result = await runCheck();
    console.log(result.summary);
    if (result.needsOrchestrator) {
      console.log(`Would launch orchestrator: ${result.reasons.join('; ')}`);
    }
  });

// --- kodo install ---
// Dos carriles bajo el mismo verbo: por defecto instala los hooks de Claude Code, y con
// `--systemd` instala la unidad de usuario que supervisa el daemon en Linux (KODO-59) —
// el equivalente de `brew services start kodo` en macOS. Son instalaciones independientes:
// ninguna implica la otra.
program
  .command('install')
  .description('Install kodo hooks into Claude Code settings')
  .option('--systemd', 'Instead: install/refresh the systemd user unit and enable it (Linux only)')
  .action(async (opts) => {
    if (opts.systemd) {
      const { runInstallSystemd } = await import('./cli/systemd.js');
      process.exit(await runInstallSystemd());
    }
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
// El orden LOCKED (handlers de señal → polling setup → launch → block-forever) vive
// entero en `cli/orchestrate.js`: aquí solo se declara la superficie.
program
  .command('orchestrate')
  .description('Launch the orchestrator Claude session')
  .option(
    '--polling',
    'Arranca polling integrado en el orchestrator (mismo proceso). NO usar con `kodo polling start` simultáneo sobre el mismo repo — mutex implícito vía lock per-repo Phase 8 GSD-10.',
  )
  .option(
    '--force',
    'Descarta un registro de orquestador hecho bajo OTRO cliente y lanza uno nuevo en el activo (KODO-18). Úsalo solo tras comprobar que el del cliente anterior está cerrado: dos supervisores comparten state.json y la cola.',
  )
  .action(async (opts) => {
    const { runOrchestrateCli } = await import('./cli/orchestrate.js');
    await runOrchestrateCli(opts);
  });

// --- kodo launch ---
// ensureConfig() FUERA del handler delegado (contrato previo a KODO-42): un fallo del
// gate no se reescribe como el `Error: <mensaje>` del launch.
program
  .command('launch <ref>')
  .description('Launch a Claude Code session for a task (e.g. KL-42)')
  .option('--model <model>', 'Override Claude model')
  .option('--yolo', 'Skip confirmation prompts')
  .option('--force', 'Skip kodo label requirement')
  .action(async (ref, opts) => {
    await ensureConfig();
    const { runLaunchCli } = await import('./cli/launch.js');
    await runLaunchCli(ref, opts);
  });

// --- kodo adopt ---
program
  .command('adopt')
  .description('Adopt an ad-hoc session into a persistent task (deterministic, 0-token)')
  .requiredOption('--workspace <ref>', 'Workspace reference of the live session')
  .requiredOption('--cwd <path>', 'Working directory of the session')
  .requiredOption('--session-id <id>', 'Claude Code session id')
  .requiredOption('--project <id>', 'Target project id (must be mapped in kodo config)')
  .option('--title <t>', 'Task title (default: basename(cwd), applied by the core)')
  .option('--description <d>', 'Task description (optional)')
  .option('--module <name>', 'Plane module to place the task in (default: auto-derived from --cwd)')
  .option('--task-url <url>', 'Recovery: task_url from a prior PERSIST_FAILED, to reconcile without a second createTask')
  .option('--task-id <id>', 'Recovery: task_id from a prior PERSIST_FAILED')
  .option('--json', 'Emit the discriminant as JSON (scriptable, byte-deterministic)')
  .action(exitWithCode(async (opts) => {
    await ensureConfig();
    const { runAdoptCli } = await import('./cli/adopt.js');
    return runAdoptCli({
      workspaceRef: opts.workspace,
      cwd: opts.cwd,
      sessionId: opts.sessionId,
      projectId: opts.project,
      title: opts.title,
      description: opts.description,
      module: opts.module,
      taskUrl: opts.taskUrl,
      taskId: opts.taskId,
      json: opts.json || false,
    });
  }));

// --- kodo comment ---
program
  .command('comment <ref>')
  .description('Post a summary comment on an existing task (backfill enrichment, deterministic, 0-token)')
  .requiredOption('--body <text>', 'Comment body (markdown; sanitized by the core before POST)')
  .option('--json', 'Emit the result as JSON (scriptable)')
  .action(exitWithCode(async (ref, opts) => {
    await ensureConfig();
    const { runCommentCli } = await import('./cli/comment.js');
    return runCommentCli({ ref, body: opts.body, json: opts.json || false });
  }));

// --- kodo status --- (Phase 66 / UP-05 / D-04 LOCKED)
// DAEMON-FIRST: reporta el estado del daemon 'kodo' (running/stopped) vía
// runStatusUnified, con `--json` byte-determinista ({status,pid}).
// CAMBIO DE COMPORTAMIENTO CONSCIENTE (D-04 LOCKED): `kodo status` pasa a ser un
// booleano de vida del SERVICIO — ya NO lista las sesiones activas (listSessions).
// El detalle de sesiones vive ahora en el dashboard (`kodo dashboard`) y en
// `GET /status`. `kodo polling status` standalone queda intacto.
program
  .command('status')
  .description('Show kodo daemon status (running|stopped); --json byte-deterministic')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(async (opts) => {
    const { runStatusUnified } = await import('./cli/stop-status.js');
    process.exit(await runStatusUnified({ json: opts.json || false }));
  });

// --- kodo logs ---
// Sin salida explícita en éxito: `--follow` bloquea y el dump termina cuando el runtime
// vacía el event loop (stdout drena entero al canalizarlo).
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
      process.exit(EXIT_ERROR);
    }
  });

// --- kodo dashboard ---
// Sin gate de provider (D-07) — el dashboard resuelve baseUrl en memoria y no
// requiere provider configurado en Phase 34. Lazy import aísla ink al subcomando.
program
  .command('dashboard')
  .description('Live TUI dashboard of active kodo sessions')
  .option('--url <baseUrl>', 'Base URL del server kodo (default: http://localhost:<config.server.port>)')
  .action(async (opts) => {
    const { runDashboard } = await import('./cli/dashboard/index.js');
    await runDashboard({ url: opts.url });
  });

// --- kodo doctor --- (KODO-10)
// Cruza ~/.kodo/config.json ↔ ~/.kodo/projects.json y detecta la desalineación que hace
// morir los webhooks de un proyecto mapeado-pero-no-configurado con "No configured project
// ... UNKNOWN". Por defecto PURO/offline; --states verifica trigger/review/done por red.
// SIN ensureConfig(): doctor DIAGNOSTICA la config, no exige que esté completa (mismo
// precedente que `gsd doctor` / `skill sync`).
program
  .command('doctor')
  .description('Diagnose config.json ↔ projects.json alignment (dispatch-enabled vs mapped-only); --states also checks trigger/review/done per project')
  .option('--states', 'Also verify each configured project has the required states (trigger/review/done) — hits the provider API')
  .option('--identifiers', 'Also verify each configured project identifier still matches the provider (stale cache → phantom refs) — hits the provider API')
  .option('--operator', 'Re-resolve the API key owner and refresh the cached operator identity used by the assignee filter — hits the provider API')
  .option('--json', 'Emit the structured report as JSON (scriptable, byte-deterministic)')
  .action(exitWithCode(async (opts) => {
    const { runDoctor } = await import('./cli/doctor.js');
    return runDoctor({
      states: opts.states || false,
      identifiers: opts.identifiers || false,
      operator: opts.operator || false,
      json: opts.json || false,
    });
  }));

// --- kodo gsd <subcommand> ---
const gsd = program.command('gsd').description('GSD subcommands (inspect resolver, etc.)');

gsd
  .command('inspect <task-id>')
  .description('Dry-run the phase resolver for a task (read-only, no lock/state/cmux)')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(exitWithCode(async (taskId, opts) => {
    await ensureConfig();
    const { runGsdInspect } = await import('./cli/gsd-inspect.js');
    return runGsdInspect({ taskId, json: opts.json || false });
  }));

gsd
  .command('verify <session-id>')
  .description('Verify phase closure: parses VERIFICATION.md, posts verdict comment and transitions task to Review on pass (idempotent — duplicates accepted, CONTEXT Deferred)')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(exitWithCode(async (sessionId, opts) => {
    await ensureConfig();
    const { runGsdVerifyCli } = await import('./cli/gsd-verify.js');
    return runGsdVerifyCli({ sessionId, json: opts.json || false });
  }));

gsd
  .command('doctor')
  .description('Detect (dry-run) and sanitize (--fix) session lifecycle garbage: orphan worktrees, zombie sessions, hung locks, old logs')
  .option('--fix', 'Sanitize the detected garbage (the only opt-in to mutate; no prompt)')
  .option('--json', 'Emit the structured report as JSON (scriptable, byte-deterministic)')
  .action(exitWithCode(async (opts) => {
    // NOTE: NO `ensureConfig()` — doctor sanea el filesystem local (worktrees,
    // locks, logs, state.json) y NO toca ningún provider (D-02 / CONTEXT línea
    // 104). Mismo precedente que `skill sync` y `polling start`.
    const { runGsdDoctor } = await import('./cli/gsd-doctor.js');
    return runGsdDoctor({ fix: opts.fix || false, json: opts.json || false });
  }));

// --- kodo sidebar <subcommand> ---
const sidebar = program
  .command('sidebar')
  .description('cmux sidebar hygiene (workspace groups)');

sidebar
  .command('doctor')
  .description('Detect (dry-run) and fix (--fix) workspace-group drift: missing/dissolved groups, loose workspaces, empty groups')
  .option('--fix', 'Converge the sidebar (the only opt-in to mutate; non-destructive allowlist, no prompt)')
  .option('--json', 'Emit the structured report as JSON (scriptable, byte-deterministic)')
  .action(exitWithCode(async (opts) => {
    // NOTE: NO `ensureConfig()` — el doctor lee state.json/projects.json/cmux y
    // NO toca ningún provider (preserva el 0-provider de SDR-03). Mismo
    // precedente que `gsd doctor`.
    const { runSidebarDoctor } = await import('./cli/sidebar-doctor.js');
    return runSidebarDoctor({ fix: opts.fix || false, json: opts.json || false });
  }));

// --- kodo skill <subcommand> ---
const skill = program.command('skill').description('Skill management subcommands (sync, etc.)');

skill
  .command('sync')
  .description('Sync kodo distributable skills (kodo-orchestrate, kodo-capture) from <repo>/.claude/skills/ → ~/.claude/skills/')
  .option('--prune', 'Remove foreign files in home that are not in repo (destructive; opt-in)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(exitWithCode(async (opts) => {
    // NOTE: NO `ensureConfig()` — kodo skill sync no requiere provider configurado
    // (RESEARCH §Open Question 1; gate D-07 exit 2 sustituye al check de config).
    const { runSkillSyncCli } = await import('./cli/skill-sync.js');
    return runSkillSyncCli({ prune: opts.prune || false, json: opts.json || false });
  }));

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
  .action(exitWithCode(async (opts) => {
    // NO ensureConfig() — el handler tiene su propio gate D-14 exit 2 para
    // config missing (providers.github.repos vacío o GITHUB_TOKEN no set).
    const { runPollingStartCli } = await import('./cli/polling.js');
    return runPollingStartCli({
      // commander: `--no-daemon` se exposes como `opts.daemon === false`.
      noDaemon: opts.daemon === false,
      json: opts.json || false,
      // Phase 28 D-07/D-08: --verbose is orthogonal to --daemon.
      verbose: opts.verbose || false,
    });
  }));

polling
  .command('stop')
  .description('Stop polling daemon via PID file (SIGTERM + 5s wait + SIGKILL fallback)')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(exitWithCode(async (opts) => {
    const { runPollingStopCli } = await import('./cli/polling.js');
    return runPollingStopCli({ json: opts.json || false });
  }));

polling
  .command('status')
  .description('Show polling daemon status (running|idle); --json byte-deterministic')
  .option('--json', 'Emit structured result as JSON (scriptable)')
  .action(exitWithCode(async (opts) => {
    const { runPollingStatusCli } = await import('./cli/polling.js');
    return runPollingStatusCli({ json: opts.json || false });
  }));

// --- kodo daemon <subcommand> --- (Plan 65-04 / D-02 / UP-04)
// Grupo INTERNO: `kodo up` (detached, Phase 66) y launchd/`brew services` (directo,
// Phase 66) invocan `daemon run`; NO es para uso directo del operador → `run` va
// hidden en commander (13.1.0 soporta el options-object form { hidden: true }).
const daemon = program.command('daemon').description('Internal daemon lifecycle');

daemon
  .command('run', { hidden: true })
  .description('Run the composed daemon (server + polling) in the foreground')
  .option(
    '--catch-up',
    'Con polling activo: en el primer tick de cada proyecto lanza también lo que YA estaba en el estado trigger, en vez de solo apuntar el watermark (KODO-60).',
  )
  .action(async (opts) => {
    // La action SÓLO awaita runDaemon — NO fija ni fuerza código de salida: runDaemon
    // bloquea para siempre y es el ÚNICO dueño del exit (D-05); terminar aquí
    // derrotaría el foreground funnel supervisable.
    const { runDaemon } = await import('./daemon/run.js');
    await runDaemon({ catchUp: opts.catchUp === true });
  });

// --- kodo capture --- (Phase 83 / CAPT-01 / D-15, D-16, D-17)
// `setExitCode` (no `exitWithCode`) en los CUATRO handlers del bloque del inbox y en los de
// `inbox-orch` e `integrate`: fijan el código y dejan drenar stdout. El porqué, con el bug
// reproducido, está en la cabecera de `cli/action.js` (Plan 83-05 / GAP-2 / CR-01).
program
  .command('capture')
  .description('Capturar una idea al inbox (~/.kodo/inbox.md) sin salir de lo que estás haciendo')
  .argument(
    '<text>',
    'Texto de la captura: se persiste VERBATIM, saneado a una sola línea. Si el texto empieza ' +
      'por guion, antepón el separador de argumentos — `kodo capture -- "-3 % de conversión"`: ' +
      'sin él el parser lo interpreta como una opción desconocida y la captura se aborta',
  )
  .option(
    '--origin <valor>',
    'Origen de la captura — USO INTERNO (lo fija el skill de captura al shellear a este mismo writer); default: cli',
    'cli',
  )
  .action(setExitCode(async (text, opts) => {
    // NOTE: NO `ensureConfig()` — el inbox es filesystem local (~/.kodo/inbox.md) y NO toca
    // ningún provider. Mismo precedente que `skill sync`, `gsd doctor` y `sidebar doctor`.
    const { runCaptureCli } = await import('./cli/capture.js');
    return runCaptureCli({ text, origin: opts.origin });
  }));

// --- kodo inbox [route|discard] --- (Phase 83 / CAPT-03, CAPT-06 / D-09..D-14)
//
// DESVIACIÓN DELIBERADA del molde de grupos de este fichero: a diferencia de `gsd`, `sidebar`,
// `skill`, `polling` y `daemon`, el comando padre lleva ACCIÓN PROPIA además de subcomandos
// (`kodo inbox` lista; `kodo inbox route|discard <id>` marcan). La forma quedó verificada
// empíricamente sobre commander 13.1.0 en `83-RESEARCH.md` §Pattern 4: las 6 invocaciones
// (`inbox`, `inbox --all`, `inbox --json`, `route <id>`, `route <id> --dest <ref>`,
// `discard <id>`) resuelven al handler correcto sin conflicto.
//
// D-14: SIN `--project`, SIN `--open` y sin ningún otro filtro, ni en el padre ni en los
// subcomandos. CAPT-F1 está DIFERIDO a v2 — la superficie no se adelanta.
const inbox = program
  .command('inbox')
  .description('Triage del inbox de capturas (~/.kodo/inbox.md): lista, enruta y descarta')
  .option('--all', 'Incluir también las capturas cerradas (la traza permanente)')
  .option('--json', 'Emitir el listado como JSON (scriptable, byte-determinista)')
  .option('--full', 'Mostrar el texto ÍNTEGRO de cada captura en vez del titular')
  .action(setExitCode(async (opts) => {
    const { runInboxListCli } = await import('./cli/inbox.js');
    return runInboxListCli({ all: opts.all || false, json: opts.json || false, full: opts.full || false });
  }));

inbox
  .command('route <id>')
  .description('Marcar una captura como enrutada (nunca la borra: cerrar es una transición de estado)')
  .option(
    '--dest <ref>',
    'Trace pointer al destino: ref OPACA best-effort — kodo no la valida, no la resuelve y no la interpreta',
  )
  .action(setExitCode(async (id, opts) => {
    const { runInboxMarkCli } = await import('./cli/inbox.js');
    return runInboxMarkCli(id, 'enrutada', { dest: opts.dest });
  }));

inbox
  .command('discard <id>')
  .description('Marcar una captura como descartada (nunca la borra: la traza permanente es el feature)')
  .action(setExitCode(async (id) => {
    const { runInboxMarkCli } = await import('./cli/inbox.js');
    return runInboxMarkCli(id, 'descartada', {});
  }));

// KODO-76: `retag` y `promote`. Siguen la MISMA forma que `route`/`discard` (el padre lista, el
// subcomando actúa sobre una captura por id), con una sola divergencia: `promote` toca el
// proveedor y por tanto SÍ lleva `ensureConfig()`, como `adopt` y `comment`. Es el único
// subcomando del inbox que sale de la máquina.
inbox
  .command('retag <id> <proyecto>')
  .description('Reasignar el proyecto de una captura abierta (el tag nace derivado del cwd, no del destino)')
  .action(setExitCode(async (id, proyecto) => {
    const { runInboxRetagCli } = await import('./cli/inbox.js');
    return runInboxRetagCli(id, proyecto);
  }));

inbox
  .command('promote <id>')
  .description('Crear una tarea en el tablero a partir de una captura y cerrarla apuntando a ella')
  .option(
    '--project <ref>',
    'Proyecto de destino: tag legible o id del proveedor. Por defecto, el tag de la propia captura',
  )
  .option('--json', 'Emitir el resultado como JSON (scriptable)')
  .action(setExitCode(async (id, opts, cmd) => {
    // MISMA colisión de flag largo que `oracle run`, `review commit` e `inbox-orch ack --all`
    // (ver sus comentarios): el padre `inbox` declara `--json` para el listado, así que un
    // `--json` tecleado DESPUÉS del subcomando aterriza en las opciones del padre. Se lee de los
    // dos niveles. Verificado en UAT: sin esto, `kodo inbox promote <id> --json` emitía el render
    // human y el `--json` se perdía en silencio.
    const json = opts?.json === true || cmd?.optsWithGlobals?.()?.json === true;
    await ensureConfig();
    const { runInboxPromoteCli } = await import('./cli/inbox.js');
    return runInboxPromoteCli(id, { project: opts.project, json });
  }));

// --- kodo inbox-orch [ack] --- (KODO-53: la bandeja del ORQUESTADOR)
//
// NOMBRE SEPARADO A PROPÓSITO, no un subcomando de `kodo inbox`. Son dos bandejas con dos
// almacenes, dos productores y dos consumidores distintos: `kodo inbox` son las capturas
// del OPERADOR en `~/.kodo/inbox.md`; esto son los eventos del ciclo de vida hacia el
// ORQUESTADOR en `state.orchestrator_inbox`. Colgarlo de `inbox` sugeriría que
// `kodo inbox --all` las lista todas, y no es así.
//
// Misma forma que `inbox`: el padre lista, el subcomando cierra. El consumidor habitual es
// la RONDA del orquestador —que ya lee la bandeja en el `cat state.json` del paso 1 y aquí
// solo viene a ackear—, así que `ack --all` es el camino corto y esperado.
//
// NO `ensureConfig()`: la bandeja es estado local y no toca ningún provider. Mismo
// precedente que `inbox`, `integrate`, `skill sync` y `gsd doctor`.
const inboxOrch = program
  .command('inbox-orch')
  .description('Bandeja del orquestador (state.orchestrator_inbox): eventos de ciclo de vida sin ver')
  .option('--all', 'Incluir también los eventos ya vistos (la traza)')
  .option('--json', 'Emitir el listado como JSON (scriptable, byte-determinista)')
  .action(setExitCode(async (opts) => {
    const { runInboxOrchListCli } = await import('./cli/inbox-orch.js');
    return runInboxOrchListCli({ all: opts.all || false, json: opts.json || false });
  }));

inboxOrch
  .command('ack [ids...]')
  .description('Marcar eventos como vistos (nunca los borra: cerrar es una transición de estado)')
  .option('--all', 'Marcar TODOS los eventos sin ver — el camino normal al cerrar una ronda')
  .action(setExitCode(async (ids, opts, cmd) => {
    // COLISIÓN DE FLAG LARGO, verificada en vivo sobre commander 13.1.0: cuando el
    // comando PADRE declara el mismo `--all` (y aquí lo declara, para el listado), el
    // `--all` tecleado DESPUÉS del subcomando aterriza en las opciones del padre y el
    // `opts` del subcomando llega VACÍO — sin error de opción desconocida, o sea en
    // silencio. `kodo inbox-orch ack --all` marcaba cero eventos y salía con 2.
    //
    // Se lee de los DOS niveles en vez de renombrar uno de los flags: `--all` es el
    // nombre correcto en ambos sitios, y `optsWithGlobals()` es justo el lector que
    // commander expone para este caso. Efecto lateral aceptado: `kodo inbox-orch --all
    // ack` también acka todo — misma frase, mismo resultado.
    const all = opts?.all === true || cmd?.optsWithGlobals?.()?.all === true;
    const { runInboxOrchAckCli } = await import('./cli/inbox-orch.js');
    return runInboxOrchAckCli(ids || [], { all });
  }));

// --- kodo integrate --- (KODO-26: cola de integración)
//
// MISMA forma que `inbox` y por la MISMA razón: el padre lista, y la acción sobre una entrada
// concreta viaja como argumento + flag. Aquí no hay subcomandos — `kodo integrate KODO-26 --ff`
// se lee como la frase que el operador diría en voz alta, y `kodo integrate` a secas es el
// listado que el orquestador consulta en cada ronda.
//
// NO `ensureConfig()`: la cola es filesystem local (`~/.kodo/state.json`) + git, y no toca
// ningún provider. Mismo precedente que `inbox`, `skill sync` y `gsd doctor`.
program
  .command('integrate [ref]')
  .description(
    'Cola de integración: sin argumentos LISTA lo que espera integración; con <ref> ejecuta la acción indicada',
  )
  .option('--all', 'En el listado: incluir también las entradas ya resueltas (la traza)')
  .option('--json', 'Emitir el resultado como JSON (scriptable, byte-determinista)')
  .option('--ff', 'Integrar con fast-forward (falla si no es posible; nunca crea un merge commit)')
  .option('--merge', 'Integrar con merge commit explícito (--no-ff)')
  .option('--pr', 'Preparar la rama para PR: valida y DEVUELVE el comando gh listo. NO hace push ni crea la PR')
  .option('--drop', 'Descartar la entrada de la cola SIN tocar la rama')
  .option('--test <cmd>', 'Correr esta suite en el repo antes de integrar; si falla, no se integra nada')
  .option('--require-oracle', 'Abortar si el oráculo mecánico no dice `pass` sobre la punta de la rama (KODO-69)')
  .action(setExitCode(async (ref, opts) => {
    const mod = await import('./cli/integrate.js');
    if (!ref) {
      return mod.runIntegrateListCli({ all: opts.all || false, json: opts.json || false });
    }
    return mod.runIntegrateActionCli(ref, {
      ff: opts.ff || false,
      merge: opts.merge || false,
      pr: opts.pr || false,
      drop: opts.drop || false,
      json: opts.json || false,
      test: opts.test,
      requireOracle: opts.requireOracle || false,
    });
  }));

// --- kodo oracle [run] --- (KODO-69: el oráculo mecánico)
//
// SUBCOMANDO para la acción y no una flag, con el mismo criterio que `review` y a diferencia de
// `integrate`: listar/mirar y EJECUTAR una verificación son sujetos distintos, no dos variantes
// de lo mismo. `kodo oracle` a secas es la vista que el orquestador consulta, y por contrato no
// ejecuta absolutamente nada — la ronda del orquestador jamás corre suites.
//
// NO `ensureConfig()`: el oráculo es estado local (`~/.kodo/state.json`) + git + comandos del
// operador, y no toca ningún provider. Mismo precedente que `inbox`, `integrate`, `review`,
// `skill sync` y `gsd doctor`.
const oracle = program
  .command('oracle [ref]')
  .description('Oráculo mecánico: sin argumentos LISTA el veredicto de la cola; con <ref> muestra los cinco checks de esa entrada')
  .option('--all', 'En el listado: incluir también las entradas ya resueltas (la traza)')
  .option('--json', 'Emitir el resultado como JSON (scriptable, byte-determinista)')
  .action(setExitCode(async (ref, opts) => {
    const mod = await import('./cli/oracle.js');
    if (!ref) return mod.runOracleListCli({ all: opts.all || false, json: opts.json || false });
    return mod.runOracleStatusCli(ref, { json: opts.json || false });
  }));

oracle
  .command('run <ref>')
  .description('EJECUTAR la verificación sobre la rama de <ref> (worktree desechable) y persistir el veredicto en la cola')
  .option('--json', 'Emitir el resultado como JSON')
  .action(setExitCode(async (ref, opts, cmd) => {
    // MISMA colisión de flag largo que `review commit` e `inbox-orch ack --all` (ver sus
    // comentarios): el padre `oracle` declara `--json`, así que un `--json` tecleado DESPUÉS
    // del subcomando aterriza en las opciones del padre. Se lee de los dos niveles.
    const json = opts?.json === true || cmd?.optsWithGlobals?.()?.json === true;
    const mod = await import('./cli/oracle.js');
    return mod.runOracleRunCli(ref, { json });
  }));

// --- kodo review [start|commit] --- (KODO-75: el rol reviewer adversarial)
//
// SUBCOMANDOS y no flags, a diferencia de `integrate`: las tres acciones tienen sujetos
// distintos (el operador lista, el operador arranca, el REVIEWER cierra) y ninguna es la
// variante de otra. `kodo review` a secas es el listado que el orquestador consulta.
//
// NO `ensureConfig()`: los ciclos son estado local (`~/.kodo/state.json`) + git, y no tocan
// ningún provider. Mismo precedente que `inbox`, `integrate`, `skill sync` y `gsd doctor`.
const review = program
  .command('review [ref]')
  .description('Revisión adversarial (kodo:review): sin argumentos LISTA los ciclos; con <ref> muestra el estado derivado de los artefactos')
  .option('--all', 'En el listado: incluir también los ciclos ya aprobados (la traza)')
  .option('--json', 'Emitir el resultado como JSON (scriptable)')
  .action(setExitCode(async (ref, opts) => {
    const mod = await import('./cli/review.js');
    if (!ref) return mod.runReviewListCli({ all: opts.all || false, json: opts.json || false });
    return mod.runReviewStatusCli(ref, { json: opts.json || false });
  }));

review
  .command('start <ref>')
  .description('Lanzar la sesión de revisión sobre la rama de <ref> (worktree propio, escritura restringida a review/)')
  .option('--json', 'Emitir el resultado como JSON')
  .option('--max-rounds <n>', 'Tope de rondas para este ciclo (default: review.max_rounds, o 3)')
  .action(setExitCode(async (ref, opts) => {
    const mod = await import('./cli/review.js');
    const parsed = Number.parseInt(opts.maxRounds, 10);
    return mod.runReviewStartCli(ref, {
      json: opts.json || false,
      maxRounds: Number.isInteger(parsed) ? parsed : undefined,
    });
  }));

review
  .command('commit')
  .description('CIERRE DEL REVIEWER: commitea los artefactos con pathspec restringido a review/ y reporta lo que quedó fuera')
  .option('-m, --message <msg>', 'Mensaje del commit')
  .option('--json', 'Emitir el resultado como JSON')
  .action(setExitCode(async (opts, cmd) => {
    // MISMA colisión de flag largo que `inbox-orch ack --all` (ver su comentario): el padre
    // `review` declara `--json` para el listado, así que un `--json` tecleado DESPUÉS del
    // subcomando aterriza en las opciones del padre. Se lee de los dos niveles.
    const json = opts?.json === true || cmd?.optsWithGlobals?.()?.json === true;
    const mod = await import('./cli/review.js');
    return mod.runReviewCommitCli({ message: opts.message, json });
  }));

program.parse();
