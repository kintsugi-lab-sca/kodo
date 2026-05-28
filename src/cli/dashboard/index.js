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
 * @returns {Promise<void>}
 */
export async function runDashboard(deps = {}) {
  const { stdout = process.stdout, stdin = process.stdin, url } = deps;

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

  // Entrar al alternate screen buffer ANTES de render (post non-TTY guard, así
  // pipes/CI no reciben secuencias ANSI). Sin esto, cada redraw a un ancho de
  // terminal distinto deja el frame previo en scrollback como artefacto. El
  // `try/finally` de más abajo garantiza el `\x1b[?1049l` (alt-screen off +
  // restaura scrollback original) incluso si la app crashea.
  stdout.write('\x1b[?1049h');

  const app = render(createElement(App, { baseUrl }));

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
