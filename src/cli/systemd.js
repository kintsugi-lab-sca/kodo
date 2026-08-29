// @ts-check
//
// src/cli/systemd.js — KODO-59 (F3 del port a Linux). Unidad systemd de USUARIO y los
// tres comandos que tienen que saber que existe.
//
// ── QUÉ ES ESTO Y POR QUÉ NO ES `brew services` ───────────────────────────────────────────
//
// En macOS el ciclo de vida desatendido de kodo lo lleva launchd, renderizado por el
// `service do` de `packaging/homebrew/Formula/kodo.rb`. En Linux el equivalente idiomático
// NO es Homebrew (existe, pero exigirlo para instalar un paquete de npm es fricción sin
// contrapartida): es una **unidad systemd de usuario** en `~/.config/systemd/user/`, con
// kodo instalado por `npm install -g`.
//
// El proceso supervisado es el MISMO en las dos plataformas: `kodo daemon run`
// (`src/daemon/run.js`), que ya está escrito para vivir bajo un supervisor — no hace doble
// fork, es dueño único de SIGTERM/SIGINT y traga el EPIPE del stdout roto. Nunca el comando
// interactivo, que se auto-detacha y dejaría al supervisor en crash-loop.
//
// ── EL PATH ES LOAD-BEARING, NO COSMÉTICO ─────────────────────────────────────────────────
//
// Mismo razonamiento (y misma cicatriz) que el `environment_variables PATH:` de la fórmula:
// systemd NO hereda el PATH del shell de login. El manager de usuario arranca sus servicios
// con un PATH mínimo, y ahí no hay nada de npm ni de nvm. Eso rompe DOS cosas distintas:
//
//   1. El intérprete. `bin/kodo` lleva `#!/usr/bin/env node`; `npm install -g` NO reescribe
//      ese shebang (a diferencia de lo que hace la instalación de Homebrew), así que el
//      kernel ejecuta `/usr/bin/env node` y `node` tiene que estar en el PATH del servicio.
//      Por eso el instalador antepone el directorio de `process.execPath`: es el node que
//      está corriendo el `kodo install --systemd`, es decir, el que el operador usa.
//   2. Los subprocesos del daemon, que se resuelven POR NOMBRE: `git` al preparar los
//      worktrees de sesión y `claude` al lanzarla. Sin PATH el daemon arranca y falla más
//      tarde, en el peor sitio posible.
//
// ── NADA DE SECRETOS EN LA UNIDAD ─────────────────────────────────────────────────────────
//
// El fichero de la unidad es legible por el usuario y acaba en `~/.config`, así que respeta
// el mismo boundary que el plist (PERSIST-04): SOLO `PATH`. La API key vive en `~/.kodo/.env`
// (0600) y la carga `config.js` en runtime.
//
// ── ESPEJO IN-TREE ────────────────────────────────────────────────────────────────────────
//
// `renderUnit()` es la ÚNICA fuente del texto de la unidad. `packaging/systemd/kodo.service`
// es su espejo revisable —el mismo patrón que el mirror de la fórmula Homebrew— y
// `test/cli/systemd.test.js` falla si los dos divergen. El fichero del repo usa los
// specifiers de systemd (`%h`) para ser machine-independent; el instalador renderiza con las
// rutas YA RESUELTAS de la máquina, que es lo honesto cuando el prefix de npm puede ser
// `~/.local`, `/usr/local` o un directorio de nvm.
//
// never-throws / fail-open y TODO efecto (fs, subprocesos, plataforma, stdout) detrás de
// seams `_dep` inyectables, como el resto de `src/cli/`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { createFormatter } from './format.js';

/**
 * Nombre canónico de la unidad. Es el único literal `kodo.service` del árbol: todo lo demás
 * (ruta de instalación, argumentos de `systemctl`) se deriva de aquí.
 * @type {string}
 */
export const UNIT_NAME = 'kodo.service';

/**
 * ExecStart de la PLANTILLA del repo. `%h` es el specifier de systemd para el home del
 * usuario, y `~/.local/bin` es donde deja los binarios un `npm install -g` con prefix de
 * usuario (la instalación que recomienda `packaging/linux/README.md`, porque no necesita
 * sudo). El instalador NO usa este valor: resuelve el binario real de la máquina.
 * @type {string}
 */
const TEMPLATE_EXEC_START = '%h/.local/bin/kodo daemon run';

/**
 * PATH de la PLANTILLA del repo. Sin el directorio de node porque ese sí depende de la
 * máquina (nvm, NodeSource, distro) y no se puede escribir a mano sin mentir.
 * @type {string}
 */
const TEMPLATE_PATH = '%h/.local/bin:/usr/local/bin:/usr/bin:/bin';

/**
 * Segmentos de PATH que el instalador añade DESPUÉS del directorio de node. Fijos y en este
 * orden: primero lo del usuario (donde npm deja `kodo` y `claude`), luego lo del sistema.
 * @type {ReadonlyArray<string>}
 */
const SYSTEM_PATH_SEGMENTS = ['/usr/local/bin', '/usr/bin', '/bin'];

/**
 * Cita un valor para un fichero de unidad si lo necesita.
 *
 * systemd parte `ExecStart=` por espacios, así que una ruta con espacios (un home tipo
 * `/home/jj perez`) rompería la línea en dos argumentos silenciosamente. Las comillas dobles
 * son la forma canónica de agrupar; no hace falta escapar nada más para rutas de fichero.
 *
 * @param {string} value
 * @returns {string} `value`, entrecomillado solo si contiene espacios.
 */
function quoteIfNeeded(value) {
  return /\s/.test(value) ? `"${value}"` : value;
}

/**
 * Renderiza el texto COMPLETO de la unidad. PURA: sin I/O, sin `process`, determinista.
 *
 * @param {{ execStart?: string, path?: string }} [opts]
 *   `execStart` — línea completa de `ExecStart=` (binario + args). `path` — valor de
 *   `Environment=PATH=`. Los defaults son los de la plantilla del repo (`%h`).
 * @returns {string} contenido del `.service`, terminado en newline.
 */
export function renderUnit({ execStart = TEMPLATE_EXEC_START, path = TEMPLATE_PATH } = {}) {
  // `Environment=` admite entrecomillar la asignación ENTERA (`Environment="PATH=/a b:/c"`),
  // que es la única forma de que un directorio con espacios no parta el valor.
  const envLine = /\s/.test(path) ? `Environment="PATH=${path}"` : `Environment=PATH=${path}`;
  return `# kodo — systemd user unit (KODO-59).
#
# Generado por \`kodo install --systemd\`. Editarlo a mano funciona, pero la próxima
# instalación lo sobrescribe: los cambios permanentes van en \`~/.kodo/config.json\`.
#
# Instalar / refrescar:  kodo install --systemd
# Ver el log:            journalctl --user-unit kodo.service -f
# Que sobreviva al logout: loginctl enable-linger \$USER
#
# NOTA sobre el ordenado: una unidad de USUARIO no puede depender de targets del sistema
# como network-online.target (el manager de usuario tiene su propio namespace), así que aquí
# no hay After=. No hace falta: el daemon es never-throws al arrancar y Restart=always cubre
# el caso de haber arrancado antes que la red.

[Unit]
Description=kodo daemon (webhook + polling)
Documentation=https://github.com/kintsugi-lab-sca/kodo
# Freno del bucle infinito. Una config incompleta (típicamente KODO_WEBHOOK_SECRET_<PROVIDER>
# ausente en ~/.kodo/.env SIN polling activo) hace que \`daemon run\` salga con 1, y Restart=always lo relanzaría
# para siempre sin más señal que el journal. Con este límite, 5 arranques en 300s dejan la
# unidad en \`failed\` — que \`kodo status\` SÍ enseña y el operador puede accionar.
#
# La ventana es de 300s y NO de 60s por una medida, no por gusto: un arranque fallido por
# config incompleta tarda ~10s (los reintentos de red del provider) más los 5s de RestartSec,
# o sea ~15s por intento. Cinco intentos son ~75s, así que con una ventana de 60s el contador
# se reseteaba antes de llegar al quinto y el bucle era, en la práctica, infinito.
# Recuperarse de \`failed\`: arregla el .env y vuelve a correr \`kodo install --systemd\`
# (hace \`reset-failed\` antes de arrancar).
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
# SIEMPRE \`daemon run\` (foreground supervisable), NUNCA el comando interactivo: ese se
# auto-detacha, systemd vería exit 0 inmediato y entraría en bucle de reinicios.
ExecStart=${execStart}
Restart=always
RestartSec=5
# PATH explícito: systemd no hereda el del shell de login. Lo necesitan el shebang
# \`#!/usr/bin/env node\` del binario de npm Y los subprocesos que el daemon resuelve por
# nombre (\`git\` para los worktrees, \`claude\` para lanzar la sesión).
${envLine}
# Solo PATH. Los secretos viven en ~/.kodo/.env (0600) y los carga config.js en runtime;
# este fichero es legible y no es sitio para una API key.

[Install]
WantedBy=default.target
`;
}

/**
 * Directorio de unidades de usuario: `$XDG_CONFIG_HOME/systemd/user`, con el default
 * `~/.config/systemd/user`. Es la ruta que systemd mira, y honrar `XDG_CONFIG_HOME` importa
 * porque hay quien lo mueve (y porque permite testear sin tocar el home real).
 *
 * @param {{ _env?: NodeJS.ProcessEnv, _homedir?: () => string }} [deps]
 * @returns {string}
 */
export function unitDir(deps = {}) {
  const env = deps._env || process.env;
  const home = (deps._homedir || homedir)();
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && isAbsolute(xdg) ? xdg : join(home, '.config');
  return join(base, 'systemd', 'user');
}

/**
 * Ruta absoluta del fichero de la unidad instalada.
 * @param {{ _env?: NodeJS.ProcessEnv, _homedir?: () => string }} [deps]
 * @returns {string}
 */
export function unitPath(deps = {}) {
  return join(unitDir(deps), UNIT_NAME);
}

/**
 * Compone el PATH del servicio para ESTA máquina: el directorio del node que está
 * ejecutando kodo (el que resolverá el shebang), luego `~/.local/bin` (donde `npm i -g`
 * con prefix de usuario deja `kodo` y `claude`), luego el PATH mínimo del sistema.
 * Deduplica preservando el orden — con NodeSource, `dirname(execPath)` YA es `/usr/bin`
 * y repetirlo solo ensucia el fichero.
 *
 * @param {{ _execPath?: string, _homedir?: () => string }} [deps]
 * @returns {string}
 */
export function resolveServicePath(deps = {}) {
  const execPath = deps._execPath || process.execPath;
  const home = (deps._homedir || homedir)();
  const segments = [dirname(execPath), join(home, '.local', 'bin'), ...SYSTEM_PATH_SEGMENTS];
  return [...new Set(segments)].join(':');
}

/**
 * Resuelve la ruta ABSOLUTA del ejecutable `kodo` que debe supervisar systemd.
 *
 * `process.argv[1]` es la ruta del script tal y como lo invocó el shell, ya absolutizada por
 * node y —esto es lo importante— SIN resolver el symlink: con `npm install -g` apunta al
 * shim estable `<prefix>/bin/kodo`, no al directorio versionado de `node_modules`. Es
 * exactamente lo que queremos en `ExecStart`, porque sobrevive a un `npm update`.
 *
 * Fallback al default de la plantilla si argv[1] no sirve (ejecución embebida, REPL): un
 * ExecStart que quizá no exista es mejor que ninguno, y systemd lo dirá alto y claro en el
 * primer `start` en vez de fallar en silencio.
 *
 * @param {{ _argv?: string[], _homedir?: () => string }} [deps]
 * @returns {string}
 */
export function resolveKodoExecutable(deps = {}) {
  const argv = deps._argv || process.argv;
  const candidate = argv && argv[1];
  if (typeof candidate === 'string' && isAbsolute(candidate)) return candidate;
  return join((deps._homedir || homedir)(), '.local', 'bin', 'kodo');
}

/**
 * Lanza un `systemctl --user …` que solo importa por su éxito o su fallo.
 *
 * @param {string[]} args — argumentos DESPUÉS de `--user`.
 * @param {(...a: any[]) => any} exec — seam (execFileSync-shaped).
 * @returns {{ ok: boolean, message?: string }}
 */
function systemctlRun(args, exec) {
  try {
    exec('systemctl', ['--user', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (e) {
    const stderr = e && e.stderr != null ? String(e.stderr).trim() : '';
    return { ok: false, message: stderr || (e && e.message) || 'systemctl falló' };
  }
}

/**
 * Lanza un `systemctl --user …` del que importa el STDOUT.
 *
 * Clave: `is-active` / `is-enabled` salen con código ≠ 0 cuando la respuesta no es
 * `active` / `enabled`. Eso NO es un error — es la respuesta, y viene por stdout igual.
 * Por eso el catch rescata `e.stdout` en vez de tratar el exit code como fallo.
 * `systemctl` ausente (ENOENT) no trae stdout → `null`.
 *
 * @param {string[]} args
 * @param {(...a: any[]) => any} exec
 * @returns {string | null}
 */
function systemctlQuery(args, exec) {
  try {
    return String(exec('systemctl', ['--user', ...args], { encoding: 'utf8' })).trim();
  } catch (e) {
    const out = e && e.stdout != null ? String(e.stdout).trim() : '';
    return out || null;
  }
}

/**
 * @typedef {Object} UnitState
 * @property {boolean} installed - existe `~/.config/systemd/user/kodo.service`.
 * @property {string | null} active - salida de `is-active` (`active` / `inactive` /
 *   `failed` / `activating`), o `null` si no se pudo preguntar.
 * @property {string | null} enabled - salida de `is-enabled`, o `null`.
 */

/**
 * Estado de la unidad. NEVER-THROWS, y en no-linux devuelve el estado vacío SIN tocar el FS
 * ni lanzar subprocesos: es el guard que hace que añadir conciencia de systemd a `up`,
 * `stop` y `status` cueste exactamente cero en macOS.
 *
 * La presencia se decide por FS (`existsSync`) y no por `systemctl`, a propósito: es una
 * llamada barata que responde la pregunta que gobierna las decisiones de `up`/`stop`
 * («¿gestiona systemd este daemon?») sin pagar dos forks cuando la respuesta es no.
 *
 * @param {{
 *   _platform?: string,
 *   _exec?: (...a: any[]) => any,
 *   _exists?: (p: string) => boolean,
 *   _env?: NodeJS.ProcessEnv,
 *   _homedir?: () => string,
 * }} [deps]
 * @returns {UnitState}
 */
export function unitState(deps = {}) {
  const platform = deps._platform || process.platform;
  if (platform !== 'linux') return { installed: false, active: null, enabled: null };

  const exists = deps._exists || existsSync;
  let installed = false;
  try {
    installed = exists(unitPath(deps));
  } catch {
    /* fail-open: un home ilegible NO puede tumbar `kodo status` */
  }
  if (!installed) return { installed: false, active: null, enabled: null };

  const exec = deps._exec || execFileSync;
  return {
    installed: true,
    active: systemctlQuery(['is-active', UNIT_NAME], exec),
    enabled: systemctlQuery(['is-enabled', UNIT_NAME], exec),
  };
}

/**
 * Pre-vuelo del SERVICIO: qué le falta a esta máquina para que `daemon run` no salga con 1
 * en cuanto systemd lo arranque. Devuelve una lista de avisos (vacía = todo en orden).
 *
 * Existe por un fallo observado en la verificación en VM: con `~/.kodo/.env` a medias, el
 * daemon sale con 1, `Restart=always` lo relanza y el operador se queda con un servicio que
 * «está instalado» y no funciona, sin más pista que el journal. Un aviso que NOMBRA la
 * variable que falta convierte eso en un arreglo de diez segundos.
 *
 * Las dos señales NO son la misma y por eso se comprueban las dos:
 *   - `needsSetup()` cubre provider / base_url / workspace_slug / API key.
 *   - El secreto de webhook queda FUERA de `needsSetup` por diseño (D-12), pero es un gate
 *     DURO de `startServer` bajo `managed` (server.js) — el que mata al daemon. KODO-66:
 *     ese gate ya NO aplica con `polling.enabled`, así que el aviso tampoco.
 *
 * AVISA, no bloquea: instalar la unidad y configurar después es un flujo legítimo.
 *
 * @param {{
 *   _loadConfig?: () => any,
 *   _needsSetup?: () => boolean,
 *   _env?: NodeJS.ProcessEnv,
 * }} [deps]
 * @returns {Promise<string[]>}
 */
export async function servicePreflight(deps = {}) {
  const warnings = [];
  try {
    // Import lazy: `config.js` hace I/O y `loadEnvFile()` en module-load. Solo lo paga
    // `install`; `unitState` (que sí corre en cada `kodo status`) no lo arrastra.
    const mod = deps._loadConfig && deps._needsSetup ? null : await import('../config.js');
    const loadConfigFn = deps._loadConfig || mod.loadConfig;
    const needsSetupFn = deps._needsSetup || mod.needsSetup;
    const env = deps._env || process.env;

    if (needsSetupFn()) {
      warnings.push('config incompleta (provider / base_url / API key) — corre `kodo check` antes de usar el servicio');
    }
    const config = loadConfigFn();
    const provider = config?.provider;
    // KODO-66: con `polling.enabled` el secreto ya NO es un gate — el daemon arranca
    // con `/webhook` apagado (server.js) y se entera de los cambios preguntando. Avisar
    // ahí mandaría a generar un secreto para un endpoint que nadie va a llamar.
    const pollingEnabled = config?.polling?.enabled === true;
    if (provider && !pollingEnabled) {
      const secretVar = `KODO_WEBHOOK_SECRET_${String(provider).toUpperCase()}`;
      if (!env[secretVar]) {
        warnings.push(
          `falta ${secretVar} en ~/.kodo/.env — sin él (y sin polling) el daemon sale con 1 nada ` +
            'más arrancar. Genera uno (openssl rand -hex 32) o activa el polling: ' +
            '`kodo config set polling.enabled true`',
        );
      }
    }
  } catch {
    /* fail-open: el pre-vuelo es una cortesía, no puede impedir la instalación */
  }
  return warnings;
}

/**
 * `systemctl --user start kodo.service`. Lo usa `kodo up` cuando la unidad existe pero está
 * parada: arrancar ahí un daemon detached crearía un proceso que systemd no conoce, y el
 * siguiente `systemctl --user start` moriría con EADDRINUSE contra su propio daemon.
 *
 * @param {{ _exec?: (...a: any[]) => any }} [deps]
 * @returns {{ ok: boolean, message?: string }}
 */
export function systemctlStartUnit(deps = {}) {
  return systemctlRun(['start', UNIT_NAME], deps._exec || execFileSync);
}

/**
 * `systemctl --user stop kodo.service`. Lo usa `kodo stop`: con `Restart=always`, un SIGTERM
 * al PID no para el daemon — systemd lo levanta otra vez.
 *
 * @param {{ _exec?: (...a: any[]) => any }} [deps]
 * @returns {{ ok: boolean, message?: string }}
 */
export function systemctlStopUnit(deps = {}) {
  return systemctlRun(['stop', UNIT_NAME], deps._exec || execFileSync);
}

/**
 * `kodo install --systemd` — instala (o refresca) la unidad de usuario y la deja arrancada.
 *
 * IDEMPOTENTE por construcción: renderiza el texto, lo compara con lo que hay en disco y
 * solo escribe si cambió. Sobre esa comparación se decide también el `restart` — un
 * `enable --now` sobre una unidad YA activa no recarga el fichero, así que sin este paso un
 * refresco de la unidad no llegaría al proceso vivo hasta el siguiente reinicio.
 *
 * Secuencia: guard de plataforma → guard de `systemctl` → escribir → `daemon-reload` →
 * avisos del pre-vuelo → `reset-failed` → `enable --now` → `restart` si el fichero cambió y
 * ya estaba activa.
 *
 * @param {{}} [opts] — sin opciones; presente por paridad de firma con el resto de handlers.
 * @param {{
 *   _preflight?: (deps?: any) => Promise<string[]>,
 *   _platform?: string,
 *   _exec?: (...a: any[]) => any,
 *   _exists?: (p: string) => boolean,
 *   _read?: (p: string, enc: string) => string,
 *   _write?: (p: string, data: string, opts?: any) => any,
 *   _mkdir?: (p: string, opts?: any) => any,
 *   _out?: (s: string) => any,
 *   _err?: (s: string) => any,
 *   _stdout?: { isTTY?: boolean },
 *   _env?: NodeJS.ProcessEnv,
 *   _homedir?: () => string,
 *   _execPath?: string,
 *   _argv?: string[],
 * }} [deps]
 * @returns {Promise<number>} exit code (0 = instalada y arrancada).
 */
export async function runInstallSystemd(opts = {}, deps = {}) {
  const platform = deps._platform || process.platform;
  const out = deps._out || ((s) => process.stdout.write(s));
  const err = deps._err || ((s) => process.stderr.write(s));
  const fmt = createFormatter(deps._stdout || process.stdout);

  // (1) Guard de plataforma. Las unidades de usuario solo existen en Linux; en macOS el
  // carril equivalente es `brew services`, y decirlo aquí ahorra el viaje a la doc.
  if (platform !== 'linux') {
    err(
      `${fmt.fail('kodo install --systemd')}: las unidades systemd de usuario solo existen en Linux ` +
        `(plataforma detectada: ${platform}).\n` +
        `  En macOS el equivalente es Homebrew: brew services start kodo\n`,
    );
    return 1;
  }

  const exec = deps._exec || execFileSync;

  // (2) Guard de systemctl. Un Linux sin systemd (o un contenedor sin PID 1 systemd) no es
  // un crash: es una instalación que no aplica, y se dice.
  const probe = systemctlQuery(['--version'], exec);
  if (probe === null) {
    err(
      `${fmt.fail('kodo install --systemd')}: no se pudo ejecutar \`systemctl --user\`.\n` +
        `  ¿systemd de usuario disponible? Comprueba: systemctl --user is-system-running\n`,
    );
    return 1;
  }

  // (3) Render con las rutas REALES de esta máquina (no las `%h` de la plantilla).
  const execStart = `${quoteIfNeeded(resolveKodoExecutable(deps))} daemon run`;
  const unit = renderUnit({ execStart, path: resolveServicePath(deps) });

  // (4) Escribir solo si cambió → idempotencia observable, no solo «no rompe».
  const target = unitPath(deps);
  const exists = deps._exists || existsSync;
  const read = deps._read || readFileSync;
  const writeFile = deps._write || writeFileSync;
  const mkdir = deps._mkdir || mkdirSync;

  let previous = null;
  try {
    if (exists(target)) previous = String(read(target, 'utf8'));
  } catch {
    /* ilegible → trátalo como ausente y reescribe */
  }
  const changed = previous !== unit;

  try {
    mkdir(dirname(target), { recursive: true });
    if (changed) writeFile(target, unit, { mode: 0o644 });
  } catch (e) {
    err(`${fmt.fail('kodo install --systemd')}: no se pudo escribir ${target}: ${e && e.message}\n`);
    return 1;
  }
  out(`${changed ? fmt.ok(previous === null ? 'creada' : 'actualizada') : fmt.dim('sin cambios')} ${target}\n`);

  // (5) daemon-reload SIEMPRE: barato, y sin él systemd sigue viendo la unidad anterior.
  const reload = systemctlRun(['daemon-reload'], exec);
  if (!reload.ok) {
    err(`${fmt.fail('systemctl --user daemon-reload')}: ${reload.message}\n`);
    return 1;
  }

  // (6) Pre-vuelo ANTES de arrancar: si falta configuración, `enable --now` levanta un daemon
  // condenado a salir con 1. Decirlo aquí es la diferencia entre un arreglo de diez segundos
  // y un servicio «instalado» que nunca funcionó.
  const preflight = deps._preflight || servicePreflight;
  for (const w of await preflight(deps)) {
    err(`${fmt.warn('aviso')}: ${w}\n`);
  }

  // (7) Estado ANTES de enable --now: decide si además hay que reiniciar.
  const wasActive = systemctlQuery(['is-active', UNIT_NAME], exec) === 'active';

  // `reset-failed` antes de arrancar: una unidad que agotó StartLimitBurst queda en `failed`
  // y RECHAZA cualquier `start` hasta que se limpie el contador. Sin esto, el flujo natural
  // de recuperación —arreglar el .env y reinstalar— no arrancaría nada. Es no-op si la unidad
  // no está en `failed`, y su fallo no importa: lo que manda es el `enable --now` de después.
  systemctlRun(['reset-failed', UNIT_NAME], exec);

  const enable = systemctlRun(['enable', '--now', UNIT_NAME], exec);
  if (!enable.ok) {
    err(`${fmt.fail(`systemctl --user enable --now ${UNIT_NAME}`)}: ${enable.message}\n`);
    return 1;
  }

  // (8) `enable --now` NO recarga el ExecStart de una unidad que ya estaba corriendo.
  if (changed && wasActive) {
    const restart = systemctlRun(['restart', UNIT_NAME], exec);
    if (!restart.ok) {
      err(`${fmt.fail(`systemctl --user restart ${UNIT_NAME}`)}: ${restart.message}\n`);
      return 1;
    }
    out(`${fmt.ok('reiniciada')} la unidad ya corría y el fichero cambió\n`);
  }

  out(`${fmt.ok('enabled + started')} ${UNIT_NAME}\n`);
  out(`${fmt.dim('log:')} journalctl --user-unit kodo.service -f\n`);

  // (9) Linger. Sin él, systemd tumba el manager de usuario al cerrar sesión y el daemon se
  // va con él — justo lo contrario de lo que se acaba de pedir. Se AVISA, no se ejecuta:
  // `loginctl enable-linger` necesita privilegios y es una decisión del operador.
  out(
    `${fmt.dim('nota:')} para que sobreviva al logout, una vez: loginctl enable-linger $USER\n`,
  );
  return 0;
}
