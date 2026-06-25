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
  const { stdout = process.stdout, stdin = process.stdin, url, exec } = deps;

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
  const { loadConfig } = await import('../../config.js');
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
  const { loadProjects } = await import('../../config.js');
  const projects = loadProjects();

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
