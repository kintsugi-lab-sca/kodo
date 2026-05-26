// @ts-check
//
// src/cli/dashboard/index.js — Phase 34 Plan 02 (TUI-01..03).
//
// runDashboard: propietario del proceso del subcomando `kodo dashboard`.
// Responsabilidades (en orden):
//   1. Guard non-TTY ANTES de render() (D-03/D-04 / T-34-01): si stdout o
//      stdin NO son TTY (pipe/CI), escribe el mensaje canónico a stderr y sale
//      con exit 1 — evita el crash "Raw mode is not supported" de ink.
//   2. Resolución de baseUrl (D-05): `deps.url` override, o el default
//      construido desde `loadConfig().server.port`.
//   3. render() del componente `App` (ink) con la baseUrl resuelta.
//   4. Ciclo de vida limpio (D-08..D-10): `q` → useApp().exit() (en App.js);
//      Ctrl-C → exitOnCtrlC default de ink (NO se cablea SIGINT aquí, D-09);
//      SIGTERM → handler explícito que llama app.unmount() para restaurar la
//      terminal (D-10). Salida limpia → process.exitCode = 0 (NO process.exit,
//      deja drenar stdio).
//
// Color-isolation (D-12): este módulo NO importa el helper de color del CLI
// clásico — verificado por el walker extendido de test/format-isolation.test.js.

// Mensaje canónico D-04 — string EXACTO que test/dashboard-non-tty.test.js
// compara con stderr.trim(). Construido en dos líneas concatenadas.
const NON_TTY_MSG =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.';

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

  // Resolución de baseUrl (D-05): --url override o default config-driven.
  const { loadConfig } = await import('../../config.js');
  const baseUrl = url ?? `http://localhost:${loadConfig().server.port}`;

  // Lazy import de ink/react/App: mantiene el arranque del CLI ligero y aísla
  // las deps de ink al path del subcomando.
  const { render } = await import('ink');
  const { createElement } = await import('react');
  const App = (await import('./App.js')).default;

  const app = render(createElement(App, { baseUrl }));

  // SIGTERM handler explícito (D-10): mismo camino de cleanup que q/Ctrl-C.
  // app.unmount() restaura la terminal (cursor/echo/scrollback); NO process.exit
  // directo (saltaría el teardown de ink). Ctrl-C lo cubre el exitOnCtrlC
  // default de ink (D-09) — NO se cablea SIGINT aquí.
  const onSigterm = () => {
    app.unmount();
  };
  process.once('SIGTERM', onSigterm);

  await app.waitUntilExit();

  // Salida limpia: remover el listener para no fugarlo y fijar el exit code sin
  // matar el proceso (deja drenar stdio).
  process.removeListener('SIGTERM', onSigterm);
  process.exitCode = 0;
}
