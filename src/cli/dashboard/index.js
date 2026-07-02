// @ts-check
//
// src/cli/dashboard/index.js — Phase 34 Plan 02 (TUI-01..03) + Phase 36 polish (alt-screen).
//
// runDashboard: propietario del proceso del subcomando `kodo dashboard`.
// Responsabilidades (en orden):
//   1. Guard non-TTY ANTES de render() (D-03/D-04 / T-34-01): si stdout o
//      stdin NO son TTY (pipe/CI), escribe el mensaje canónico a stderr y sale
//      con exit 1 — evita el crash "Raw mode is not supported" de ink.
//   2. Resolución de baseUrl (D-05 + guard WR-01 / D-10): `deps.url` override,
//      o el default construido desde `cfg.server?.port ?? DEFAULT_CONFIG.server.port`
//      (optional chaining evita el TypeError con un config v1 migrado sin `server`).
//   3. **Alternate screen buffer** (Phase 36 polish): `\x1b[?1049h` ANTES de render
//      / `\x1b[?1049l` en el `finally` tras `waitUntilExit`. Sin esto, cada redraw
//      en un ancho de terminal distinto deja el frame previo en el scrollback como
//      artefacto (cabeceras `kodo dashboard` apiladas, bordes fragmentados). Con
//      alt-screen el dashboard renderiza sobre una pantalla alterna que se descarta
//      al salir, restaurando el scrollback original — patrón estándar (vim/htop/less/
//      tmux/claude code). Solo se enciende tras el guard non-TTY (línea 75) para no
//      mandar secuencias ANSI a pipes/CI.
//   4. render() del componente `App` (ink) con la baseUrl resuelta.
//   5. Ciclo de vida limpio (D-08..D-10): `q` → useApp().exit() (en App.js);
//      Ctrl-C → exitOnCtrlC default de ink (NO se cablea SIGINT aquí, D-09);
//      SIGTERM → handler explícito que llama app.unmount() para restaurar la
//      terminal (D-10). El `try/finally` garantiza que el alt-screen se apague
//      aunque la app crashee, y `process.exitCode = 0` (NO process.exit, deja
//      drenar stdio).
//
// Color-isolation (D-12): este módulo NO importa el helper de color del CLI
// clásico — verificado por el walker extendido de test/format-isolation.test.js.
//
// Phase 37 (este archivo): extensión DI mínima — añade `exec` a `deps`, lazy-importa
// `runFocus` y pasa `onFocus` como prop a `<App />`. CERO modificación al alt-screen toggle
// (líneas 107/127), CERO loop while(true), CERO mutación de signal handlers (SIGINT/SIGTERM
// de Phase 34 D-10 preservado al pie de la letra). El verbo `cmux select-workspace` es
// fire-and-forget RPC al socket Unix (~50ms) — NO toma el TTY (post-C-01).

// DEFAULT_CONFIG es una constante estática (sin I/O); se importa eager — su
// módulo (src/config.js) solo depende de node:fs/path/os, ni ink ni picocolors,
// así que no rompe color-isolation ni encarece el arranque. `loadConfig` (que sí
// hace I/O de disco) se mantiene lazy dentro de runDashboard (ver más abajo).
import { DEFAULT_CONFIG } from '../../config.js';

// Mensaje canónico D-04 — string EXACTO que test/dashboard-non-tty.test.js
// compara con stderr.trim(). Construido en dos líneas concatenadas.
const NON_TTY_MSG =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.';

/**
 * Resuelve el baseUrl del dashboard (D-05 + guard WR-01 / D-10).
 *
 * Helper puro y testeable (sin TTY ni ink): el override `--url` tiene
 * prioridad; en su defecto se construye el default desde `loadConfig()`. El
 * optional chaining `cfg.server?.port` evita el TypeError cuando `migrateConfig`
 * (src/config.js:82-102) reconstruyó un config v1 SIN la clave `server`; el
 * fallback usa el default conocido `DEFAULT_CONFIG.server.port` (9090).
 *
 * `loadConfig` se inyecta: runDashboard lo pasa desde el lazy import de
 * `../../config.js` (no cargar config en el arranque del CLI), los tests pasan
 * fakes herméticos. `defaultConfig` por defecto es DEFAULT_CONFIG (eager).
 *
 * @param {object} args
 * @param {string} [args.url] - Override de baseUrl (flag --url, D-05).
 * @param {() => any} args.loadConfig - Lector de config (inyectable para tests).
 * @param {{ server: { port: number } }} [args.defaultConfig] - Default conocido (DEFAULT_CONFIG).
 * @returns {string} baseUrl resuelto.
 */
export function resolveBaseUrl({ url, loadConfig, defaultConfig = DEFAULT_CONFIG }) {
  const cfg = loadConfig();
  const port = cfg.server?.port ?? defaultConfig.server.port;
  return url ?? `http://localhost:${port}`;
}

/**
 * Lanza el dashboard TUI de kodo.
 *
 * @param {object} [deps] - Dependencias inyectables (DI para testabilidad).
 * @param {NodeJS.WriteStream} [deps.stdout] - Stream de salida (default process.stdout).
 * @param {NodeJS.ReadStream} [deps.stdin] - Stream de entrada (default process.stdin).
 * @param {string} [deps.url] - Override de baseUrl (flag --url, D-05).
 * @param {(cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any} [deps.exec] - Phase 37 D-01: execFile-shaped inyectable para tests. Default lazy `node:child_process.execFile`.
 * @returns {Promise<void>}
 */
export async function runDashboard(deps = {}) {
  const { stdout = process.stdout, stdin = process.stdin, url, exec, setup = false } = deps;

  // Guard non-TTY PRIMERO (D-03), ANTES de cualquier render(): un crash de
  // raw-mode es un fallo de proceso, no de UI. A stderr (no stdout), exit 1.
  if (!stdout.isTTY || !stdin.isTTY) {
    process.stderr.write(NON_TTY_MSG + '\n');
    process.exit(1);
  }

  // Resolución de baseUrl (D-05 + guard WR-01 / D-10): --url override o default
  // config-driven. loadConfig se importa lazy (I/O de disco); resolveBaseUrl
  // aplica el optional chaining `cfg.server?.port ?? DEFAULT_CONFIG.server.port`
  // para no lanzar TypeError con un config v1 migrado (migrateConfig omite la
  // clave `server`), cayendo al default conocido 9090.
  // Phase 63 (PERSIST-02): se añade `saveConfig` al MISMO lazy import de loadConfig (NO un import
  // nuevo). El editor de ajustes escribe ~/.kodo/config.json importando saveConfig DIRECTO en el
  // proceso ink — sin shell-out a `kodo config` y sin endpoint nuevo en src/server.js (D-09):
  // contraste deliberado con la tecla `a` de Phase 62, que SÍ shelleó `kodo adopt` por su lógica
  // 0-token compleja; aquí `saveConfig` es función pura trivial (ya atómica tras Plan 01), así que
  // importarla es más simple y determinista, y preserva el invariante "cero endpoints desde v0.10".
  // Phase 67 (SETUP-03/04): se añaden `writeEnvVar` (escritor de secretos, chmod 0600 pre-rename,
  // Plan 01) e `isApiKeyConfigured` (prueba de presencia, D-09) al MISMO lazy import. El renglón de
  // API key del overlay escribe ~/.kodo/.env EN-PROCESO importando writeEnvVar DIRECTO (jamás
  // shell-out `kodo config --api-key SECRET` — Pitfall 11, el vector de fuga de mayor riesgo).
  // Phase 68 (SETUP-01/D-01): se añade `needsSetup` al MISMO lazy import compartido. El flag `setup`
  // (propagado por runUp, plan 68-01) es la señal primaria del render guiado; `needsSetupFn` es la
  // comprobación coherente-con-D-01 que App puede consultar (helper puro compartido, config.js).
  const { loadConfig, saveConfig, writeEnvVar, isApiKeyConfigured, needsSetup } = await import('../../config.js');
  const baseUrl = resolveBaseUrl({ url, loadConfig });

  // Lazy import de ink/react/App: mantiene el arranque del CLI ligero y aísla
  // las deps de ink al path del subcomando.
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const App = (await import('./App.js')).default;

  // Phase 37: runFocus (orquestador puro never-throws del verbo cmux select-workspace, Plan 01).
  // Lazy import mismo patrón que App/ink/react. Cero overhead en arranque del CLI.
  const { runFocus } = await import('./focus.js');

  // Phase 48: runOpen (lanzador puro never-throws de `open <url>`, Plan 02). Mismo patrón lazy.
  const { runOpen } = await import('./open.js');

  // Phase 56 (DETECT-02): runAdopt (orquestador puro never-throws de `kodo adopt`, Plan 01) +
  // getHost factory para instanciar el host cmux IN-PROCESS (D-01, getHost designa "el wiring del
  // dashboard" en interface.js). Mismo patrón lazy que runFocus/runOpen — cero overhead en arranque.
  const { runAdopt } = await import('./adopt.js');
  const { getHost } = await import('../../host/interface.js');

  // Phase 62 (ORCH-02): deriveAdoptionMeta (derivador LLM one-shot never-throws, Plan 01) +
  // readFileSync/existsSync de node:fs (DI del derivador — en enrich.js van inyectados, SOLO aquí
  // se resuelven los builtins reales). El LLM (claude -p --json-schema) vive SOLO en este carril
  // (D-11/D-14): el suelo determinista 0-token (adoptSession/createTask) no cambia. Mismo patrón
  // lazy que runAdopt/runFocus. execFile argv literal injection-inerte (D-13).
  const { deriveAdoptionMeta } = await import('./enrich.js');
  const { readFileSync, existsSync } = await import('node:fs');

  // Phase 64 (PROJ-01/05): registro de providers para el wrapper never-throws de listProjectsFn.
  // initRegistry registra los factories built-in (plane/github, idempotente); getProvider los instancia
  // (el factory de 'plane' construye PlaneClient, que LANZA sin API key — capturado por el wrapper).
  // Mismo patrón lazy + espejo del init de provider en cli.js:652.
  const { initRegistry, getProvider } = await import('../../providers/registry.js');

  // execFile-shaped default cuando exec no fue inyectado. Lazy: solo se carga si se cablea el TUI
  // (post-guard non-TTY), idéntico patrón a los otros lazy imports arriba.
  const execImpl = exec ?? (await import('node:child_process')).execFile;

  // Resolución del binario cmux desde la config (mismo patrón que src/cmux/client.js:5-7). El
  // default `/Applications/cmux.app/Contents/Resources/bin/cmux` viene de DEFAULT_CONFIG y se
  // sobreescribe vía ~/.kodo/config.json si el operador apunta a otro binario. Llamada extra a
  // loadConfig (cero coste real — primera invocación ya cacheó por la lectura de baseUrl arriba;
  // segunda lectura solo re-deserializa el config en memoria).
  const cmuxBin = loadConfig().cmux.binary;

  // Phase 56 D-01: host cmux IN-PROCESS (reusa el MISMO execImpl + cmuxBin ya resueltos — CERO
  // endpoint nuevo en el server, preserva el invariante "cero endpoints desde v0.10"). `listAgentSurfaces`
  // NO está en HOST_METHODS → se detecta por typeof en el prop onAdoptDiscover (fail-open a []).
  const host = getHost('cmux', { exec: execImpl, binary: cmuxBin });

  // Phase 56 D-05: mapa projectId → path para el reverse-lookup cwd→projectId (resolveProjectId en
  // App.js). Mismo loadProjects() que lee src/cli/adopt.js — el dashboard resuelve el `--project`.
  // Phase 64 (PERSIST-02): se añade `saveProjects` al MISMO lazy import (NO un import nuevo). El editor
  // de proyectos escribe ~/.kodo/projects.json importando saveProjects DIRECTO en el proceso ink —
  // sin shell-out y sin endpoint nuevo en src/server.js (D-08, espejo de saveConfig de Phase 63).
  // saveProjects ya es atómico (writeFileAtomic, Phase 63) → escritura local no-corruptiva.
  const { loadProjects, saveProjects } = await import('../../config.js');
  const projects = loadProjects();

  // Phase 64 (PROJ-01/04/05 — cableado DI del editor de proyectos, espejo de loadConfigFn/onSaveConfig).
  // El nombre del provider activo (plane/github) decide DOS cosas: (1) qué provider instancia el wrapper
  // never-throws de listProjectsFn, y (2) si listModulesFn construye un PlaneClient o es no-op (Pattern 4
  // — listModules NO está en el contrato TaskProvider, vive SOLO en PlaneClient). loadConfig ya está
  // cacheado por la lectura de baseUrl/cmuxBin arriba → esta llamada solo re-deserializa en memoria.
  const providerName = loadConfig().provider;

  // listProjectsFn (RESEARCH Pattern 2 — wrapper never-throws DISCRIMINADO {ok:true,projects}|{ok:false,error}).
  // CRÍTICO (Pitfall 1): el try/catch DEBE cubrir la CONSTRUCCIÓN del provider/PlaneClient (el factory de
  // 'plane' instancia PlaneClient, cuyo constructor LANZA sin API key — client.js:13-15) Y la llamada de
  // red (provider.listProjects() → fetch /projects/, que puede rechazar por timeout/HTTP/red). NO se hace
  // fail-open a [] (no distinguiría "0 proyectos" de "error de red" — PROJ-05): App ramifica a projects-error
  // SOLO si recibe {ok:false}. Espejo del wrapper de onSaveConfig (abajo) + del init de provider en cli.js:652.
  const listProjectsFn = async () => {
    try {
      await initRegistry();
      const provider = getProvider(providerName);
      const projects = await provider.listProjects();
      return { ok: true, projects };
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };

  // listModulesFn (RESEARCH Pattern 4 — wiring CONDICIONAL por provider, asimetría consciente). `listModules`
  // NO está en el contrato `TaskProvider` (src/interface.js): vive SOLO en `PlaneClient` (client.js:151).
  // Ampliar la interfaz tocaría github (que no tiene módulos — provider.js:224 devuelve config.repos sin
  // módulos) y la validación de getProvider (registry.js:107) → excepción consciente (RESEARCH A1): para
  // plane se construye el PlaneClient DIRECTO (espejo del wizard cli.js:704-710); para github/otros es un
  // no-op que devuelve modules:[] (App lo surfacea como footer informativo "sin módulos", no como error).
  let listModulesFn;
  if (providerName === 'plane') {
    const planeCfg = loadConfig().providers.plane;
    listModulesFn = async (projectId) => {
      try {
        const { PlaneClient } = await import('../../providers/plane/client.js');
        // La API key se LEE de process.env[api_key_env] SOLO para construir el cliente; jamás se pasa al
        // snapshot/render ni se escribe (PERSIST-04/T-64-16). El constructor LANZA sin key (client.js:13)
        // → capturado por el catch → {ok:false} sin crashear (Pitfall 1, espejo de listProjectsFn).
        const client = new PlaneClient({
          baseUrl: planeCfg.base_url,
          apiKey: process.env[planeCfg.api_key_env],
          workspaceSlug: planeCfg.workspace_slug,
        });
        const modules = await client.listModules(projectId);
        return { ok: true, modules };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    };
  } else {
    listModulesFn = async () => ({ ok: true, modules: [] });
  }

  // Phase 56 Pattern 3 / Pitfall 4: resolución del binario kodo. `bin/kodo` es un script
  // `#!/usr/bin/env node`, NO un ejecutable nativo → el binario de exec es process.execPath (node) y
  // kodoBin es argv[0] (espejo de polling.js:resolveKodoBin). DEPTH: dashboard/index.js está UN nivel
  // más abajo que cli/polling.js → TRES `..`. Path absoluto, cero PATH lookup (mitigación EoP T-56-07).
  const { fileURLToPath } = await import('node:url');
  const { join, dirname } = await import('node:path');
  const kodoBin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'bin', 'kodo');

  // Entrar al alternate screen buffer ANTES de render (post non-TTY guard, así
  // pipes/CI no reciben secuencias ANSI). Sin esto, cada redraw a un ancho de
  // terminal distinto deja el frame previo en scrollback como artefacto. El
  // `try/finally` de más abajo garantiza el `\x1b[?1049l` (alt-screen off +
  // restaura scrollback original) incluso si la app crashea.
  stdout.write('\x1b[?1049h');

  const app = render(createElement(App, {
    baseUrl,
    // Phase 37 D-01: fire-and-forget al socket cmux. runFocus es never-throws (Plan 01),
    // App.js maneja el discriminado y mapea a footer-error rojo (Plan 02 D-04/D-05). NO toca el
    // lifecycle de runDashboard — ink sigue montado durante toda la invocación (~50ms).
    onFocus: async (ref) => runFocus({ exec: execImpl, ref, binary: cmuxBin }),
    // Phase 48 D-01/D-06: espejo de onFocus. Reusa el MISMO execImpl (no re-importa
    // node:child_process). NO lee binario de config — open.js defaultea `binary` a 'open'
    // internamente (D-06, divergencia con cmuxBin). runOpen es never-throws (Plan 02 contract).
    onOpen: async (url) => runOpen({ exec: execImpl, url }),
    // Phase 56 D-01/D-03: discovery on-demand, typeof-gated (fail-open a [] si el host no soporta el
    // método — listAgentSurfaces NO está en HOST_METHODS). El handler `a` de App.js diffea el array
    // contra el snapshot vivo de /status (computeAdoptable, D-02) y abre el picker.
    onAdoptDiscover: async () =>
      typeof host.listAgentSurfaces === 'function' ? host.listAgentSurfaces() : [],
    // Phase 62 D-08/D-11 (ORCH-02): derivador LLM never-throws. El handler `a` de App.js entra en
    // 'deriving' y lo await entre el armado y el confirm; el {title,description} resuelto se fusiona
    // en armedSurface (fail-open a {} → App.js cae a surface.title/basename). El `execImpl` (execFile
    // real, ya resuelto arriba) es el spawnFn DI del derivador — execFile-shaped, NO config.cmux.binary
    // (Pitfall 3: 'claude' se resuelve por PATH dentro de spawnDerive). El timeout (~25s) vive DENTRO
    // de spawnDerive (default 25_000, Plan 01) — no se cablea aquí. fs por DI (readFileSync/existsSync).
    // El LLM vive SOLO en este carril (D-11/D-14); execFile argv literal injection-inerte (D-13).
    onDerive: async ({ cwd, sessionId }) =>
      deriveAdoptionMeta({ spawnFn: execImpl, readFileFn: readFileSync, existsSyncFn: existsSync, cwd, sessionId }),
    // Phase 56 D-06/D-07: shell never-throws de `kodo adopt`. binary = process.execPath (node) +
    // kodoBin como argv[0] (Pitfall 4). runAdopt colapsa todo fallo a {ok:false} — App.js mapea a footer.
    // Phase 62 (ORCH-02): pasa `description` (derivada por onDerive, fusionada en armedSurface) a
    // runAdopt → `kodo adopt --description` (D-10). El cuerpo at-adopt cruza injection-inerte (D-13).
    onAdopt: async ({ workspaceRef, cwd, sessionId, projectId, title, description }) =>
      runAdopt({ exec: execImpl, execPath: process.execPath, kodoBin, workspaceRef, cwd, sessionId, projectId, title, description }),
    // Phase 56 D-05: mapa para el reverse-lookup cwd→projectId (resolveProjectId en App.js).
    projects,
    // Phase 63 D-09 (PERSIST-02): cableado DI del editor de ajustes, espejo de onAdopt/onDerive.
    // loadConfigFn toma el snapshot del config real al pulsar `e` (App.js lo deep-clona internamente,
    // Plan 02). onSaveConfig es el wrapper never-throws (UX-04/D-12): saveConfig es síncrono y atómico
    // (Plan 01 → escritura local no-corruptiva, directa al filesystem, SIN red/server/shell), pero se
    // envuelve en try/catch para que un fallo de escritura devuelva {ok:false,error} y el panel ink
    // siga montado — jamás propaga un throw al árbol React.
    loadConfigFn: () => loadConfig(),
    onSaveConfig: async (cfg) => {
      try {
        saveConfig(cfg);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    // Phase 67 D-05/D-09 (Plan 02, SETUP-03/04): cableado DI del renglón de API key. onSaveApiKey es el
    // wrapper never-throws de writeEnvVar (atómico + chmod 0600 pre-rename, Plan 01): escritura
    // EN-PROCESO al ~/.kodo/.env, jamás shell-out (Pitfall 11). Tras un write con éxito actualiza
    // `process.env[key]` (cache) para que el indicador [configurado] se refleje al instante sin
    // reiniciar. writeEnvVar valida (Pitfall 14) y LANZA en input inválido → el catch lo colapsa a
    // {ok:false}. isApiKeyConfiguredFn expone SOLO la presencia (nunca el valor — Pitfall 11).
    onSaveApiKey: async (key, value) => {
      try {
        const ok = writeEnvVar(key, value);
        if (ok) process.env[key] = value; // cache in-proceso → indicador [configurado] al instante
        return { ok };
      } catch (e) {
        return { ok: false, error: String(e?.message ?? e) };
      }
    },
    isApiKeyConfiguredFn: (providerName) => isApiKeyConfigured(providerName),
    // Phase 68 D-01/D-04 (SETUP-01/02): first-run guiado. `setup` (de runUp→runDashboard) arranca App
    // en mode:'setup'; `needsSetupFn` es la comprobación coherente-con-D-01. Reusa los wrappers ya
    // cableados arriba (onSaveConfig/onSaveApiKey) — el modo setup NO introduce escritores nuevos.
    setup,
    needsSetupFn: (providerName) => needsSetup(providerName),
    // Phase 64 D-08/PERSIST-02 (PROJ-01/04/05): cableado DI del editor de proyectos, espejo de
    // loadConfigFn/onSaveConfig/onAdopt. listProjectsFn (wrapper never-throws que cubre construcción+red,
    // discriminado para distinguir 0-proyectos de error — PROJ-05) y listModulesFn (condicional plane/github)
    // se resolvieron arriba. loadProjectsFn/saveProjectsFn importan loadProjects/saveProjects de config.js
    // DIRECTO en el proceso ink — saveProjects ya es síncrono y atómico (writeFileAtomic, Phase 63) → escritura
    // local no-corruptiva, SIN red/server/shell ni endpoint nuevo (invariante "cero endpoints desde v0.10").
    listProjectsFn,
    listModulesFn,
    loadProjectsFn: () => loadProjects(),
    saveProjectsFn: (m) => saveProjects(m),
  }));

  // SIGTERM handler explícito (D-10): mismo camino de cleanup que q/Ctrl-C.
  // app.unmount() restaura la terminal (cursor/echo); NO process.exit directo
  // (saltaría el teardown de ink Y el alt-screen-off del finally). Ctrl-C lo
  // cubre el exitOnCtrlC default de ink (D-09) — NO se cablea SIGINT aquí.
  const onSigterm = () => {
    app.unmount();
  };
  process.once('SIGTERM', onSigterm);

  try {
    await app.waitUntilExit();
  } finally {
    // Apagar el alt-screen SIEMPRE (q / Ctrl-C / SIGTERM / crash). El orden
    // importa: ink ya hizo unmount/restauración de cursor antes de que
    // waitUntilExit resuelva, así que escribir `\x1b[?1049l` aquí restaura el
    // scrollback original limpio.
    stdout.write('\x1b[?1049l');
    process.removeListener('SIGTERM', onSigterm);
    process.exitCode = 0;
  }
}
