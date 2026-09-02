// @ts-check
//
// src/integration/oracle.js — KODO-69: el oráculo mecánico.
//
// EL PROBLEMA. Hoy el veredicto duro sobre el trabajo de una sesión depende de lo que la propia
// sesión AFIRMA: «la suite está verde», «el lint pasa», «solo he tocado docs». Es un juez que se
// evalúa a sí mismo, y el fallo no es la mentira deliberada — es la sesión que corrió la suite
// hace veinte turnos, siguió tocando código y cerró recordando el verde de entonces.
//
// LO QUE ESTE MÓDULO CAMBIA. kodo EJECUTA la verificación por su cuenta, sobre la rama, después
// de que la sesión haya cerrado, y persiste el resultado en la entrada de `integration_queue`.
// La señal deja de ser una frase en pantalla y pasa a ser evidencia con commit, timestamp y
// código de salida. 100 % determinista, y por eso vive en el CLI/daemon y JAMÁS en el prompt del
// orquestador: un LLM al que se le pregunta «¿pasan los tests?» contesta, y su respuesta no es
// verificable.
//
// ── LOS CUATRO ESTADOS, Y POR QUÉ SON CUATRO ─────────────────────────────────────────
//
//   'pass'    — el check corrió y salió bien.
//   'fail'    — el check corrió y salió mal.
//   'unknown' — el check ESTABA pedido y no se pudo determinar (timeout, binario ausente,
//               worktree que no se pudo crear, diff no inspeccionable).
//   'skip'    — este repo no pidió este check.
//
// El enunciado exige un tercer estado honesto: `unknown` ≠ `pass`, nunca pintar verde lo no
// verificado. La cuarta rama (`skip`) no lo diluye, lo hace VIABLE: sin ella, un repo que solo
// configura `tests` tendría `build`/`lint`/`schema` en `unknown` para siempre, su veredicto
// agregado sería `unknown` eternamente y la señal no distinguiría nada de nada. El operador
// apagaría la feature en una semana — y una señal apagada es peor que ninguna.
//
// La diferencia entre las dos es exactamente la que importa: `skip` = «no te lo pedí»,
// `unknown` = «te lo pedí y no lo sé». La primera no baja el veredicto; la segunda sí.
//
// ── QUÉ SIGNIFICA `verdict: 'pass'` ──────────────────────────────────────────────────
// «Pasó TODO lo que se le pidió comprobar». NO «todo está bien». Es lo mismo que significa un
// check verde en CI, y por eso el `--json` y la vista de detalle llevan SIEMPRE los cinco checks
// con su estado: quien lee `pass` puede ver, en la misma pantalla, qué se comprobó y qué no.
//
// ── EL ANCLA AL COMMIT ───────────────────────────────────────────────────────────────
// Un veredicto sin commit no significa nada: la rama sigue viva y puede ganar trabajo. `commit`
// fija a QUÉ estado del código corresponde el resultado, y `isOracleStale` compara contra la
// punta de ahora. Mismo criterio que el ancla de `review/approval.md` (KODO-75): sin ancla, una
// aprobación es para siempre y eso es justo lo que no puede ser.
//
// ── FAIL-OPEN DE CUERPO ENTERO ───────────────────────────────────────────────────────
// Ninguna ruta de este módulo lanza. Un oráculo que no puede correr devuelve `unknown`, que es
// la respuesta honesta y la que hace que el gate opcional falle CERRADO. Nunca puede impedir un
// cierre de sesión ni una integración que el operador pida sin `--require-oracle`.

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripControlChars } from '../cli/sanitize.js';
import { checkScope, parseScopeBlock } from './scope.js';

/**
 * Los cinco checks, en ORDEN FIJO. El orden es contrato: el objeto `oracle` se serializa tal
 * cual en `kodo integrate --json` y `kodo oracle --json`, y la determinación byte a byte de
 * `--json` es invariante del repo (DX-06).
 *
 * `scope` va el último a propósito: es el único que no necesita comando ni checkout, así que
 * leerlo al final de la fila es leer «…y además, ¿tocó lo que dijo?».
 *
 * @type {readonly ['build','tests','lint','schema','scope']}
 */
export const CHECK_KEYS = /** @type {const} */ (['build', 'tests', 'lint', 'schema', 'scope']);

/**
 * Los cuatro checks que se resuelven ejecutando un comando del operador. `scope` queda fuera:
 * no hay comando que configurar, sale del diff y del plan.
 *
 * @type {readonly ['build','tests','lint','schema']}
 */
export const COMMAND_CHECKS = /** @type {const} */ (['build', 'tests', 'lint', 'schema']);

/**
 * Timeout por defecto de CADA comando, en segundos. Es por comando y no por corrida entera:
 * cuatro suites lentas son un repo lento, no un cuelgue, y un tope global las cortaría a mitad
 * sin decir cuál se pasó.
 *
 * 600 s (10 min) es holgado por diseño. Este runner corre DETACHED después de que la sesión
 * haya cerrado: nadie lo está esperando, así que apretar el tope solo compraría falsos
 * `unknown`.
 */
export const DEFAULT_TIMEOUT_S = 600;

/**
 * Tope de caracteres del `detail` de cada check. El detalle viaja a `state.json` y de ahí al
 * `--json` y a la tabla del CLI: un backtrace de 4 000 líneas metido en el estado lo hace más
 * caro de leer para TODOS los consumidores (dashboard, ronda del orquestador) a cambio de nada
 * — el log completo del fallo lo tiene el operador corriendo el comando a mano.
 */
export const MAX_DETAIL = 240;

/**
 * Un check resuelto.
 *
 * @typedef {{
 *   status: 'pass'|'fail'|'unknown'|'skip',
 *   detail: string|null,
 *   ms: number|null,
 * }} OracleCheck
 */

/**
 * El bloque `oracle` de una entrada de la cola. Claves SIEMPRE presentes y en este orden
 * (misma disciplina que las 17 claves de `IntegrationEntry`).
 *
 * @typedef {{
 *   state: 'running'|'done'|'error',
 *   verdict: 'pass'|'fail'|'unknown',
 *   commit: string|null,
 *   checks: Record<'build'|'tests'|'lint'|'schema'|'scope', OracleCheck>,
 *   started_at: string,
 *   finished_at: string|null,
 * }} OracleResult
 */

/**
 * Un check en su estado neutro.
 *
 * @param {'pass'|'fail'|'unknown'|'skip'} status
 * @param {string|null} [detail]
 * @param {number|null} [ms]
 * @returns {OracleCheck}
 */
function check(status, detail = null, ms = null) {
  return { status, detail: detail === null ? null : truncateDetail(detail), ms };
}

/**
 * Sanea y acota el detalle de un check. El texto sale de stderr de un comando arbitrario, así
 * que es contenido NO confiable que acabará proyectado en un terminal: pasa por
 * `stripControlChars` (invariante HYG-07 del repo) antes de recortarse.
 *
 * @param {unknown} s
 * @returns {string}
 */
function truncateDetail(s) {
  const clean = stripControlChars(String(s ?? '')).replace(/\s+/g, ' ').trim();
  return clean.length > MAX_DETAIL ? `${clean.slice(0, MAX_DETAIL - 1)}…` : clean;
}

/**
 * Los cinco checks en `skip`. Punto de partida de toda corrida.
 *
 * @param {string|null} [detail]
 * @returns {Record<'build'|'tests'|'lint'|'schema'|'scope', OracleCheck>}
 */
function skippedChecks(detail = null) {
  return {
    build: check('skip', detail),
    tests: check('skip', detail),
    lint: check('skip', detail),
    schema: check('skip', detail),
    scope: check('skip', detail),
  };
}

/**
 * Veredicto agregado. PURO.
 *
 * El orden de precedencia es el único defendible:
 *   1. Un `fail` manda sobre todo. Da igual qué más pasara.
 *   2. Un `unknown` degrada: había una pregunta pedida y sin respuesta.
 *   3. `pass` exige que ALGO se haya comprobado. Cinco `skip` es un oráculo que no verificó
 *      nada, y eso es `unknown` — es literalmente la regla del enunciado («sin oráculo
 *      configurado ≠ pass»).
 *
 * @param {Record<string, OracleCheck>|null|undefined} checks
 * @returns {'pass'|'fail'|'unknown'}
 */
export function aggregateVerdict(checks) {
  if (!checks || typeof checks !== 'object') return 'unknown';
  let anyPass = false;
  let anyUnknown = false;
  for (const k of CHECK_KEYS) {
    const s = checks[k]?.status;
    if (s === 'fail') return 'fail';
    if (s === 'unknown') anyUnknown = true;
    else if (s === 'pass') anyPass = true;
  }
  if (anyUnknown) return 'unknown';
  return anyPass ? 'pass' : 'unknown';
}

/**
 * El marcador que el runner escribe ANTES de empezar: «esto está corriendo».
 *
 * Existe para que la ventana entre el cierre de la sesión y el final de la corrida no se lea
 * como «el oráculo no ha corrido» (`oracle: null`). Su veredicto es `unknown`, no `pass`: una
 * corrida en curso no ha verificado nada todavía.
 *
 * SI EL PROCESO MUERE (OOM, reinicio) la entrada se queda en `running` para siempre. Es
 * deliberado y es seguro: `running` ⇒ `verdict: 'unknown'` ⇒ el gate `--require-oracle` falla
 * CERRADO, y `kodo oracle <ref>` reescribe el bloque entero en cuanto se vuelva a lanzar. Un
 * barrido automático de corridas zombis compraría complejidad para arreglar un estado que ya es
 * el conservador.
 *
 * @param {string} ts ISO 8601
 * @returns {OracleResult}
 */
export function runningOracle(ts) {
  return {
    state: 'running',
    verdict: 'unknown',
    commit: null,
    checks: skippedChecks('corrida en curso'),
    started_at: ts,
    finished_at: null,
  };
}

/**
 * Resuelve los comandos configurados PARA ESTE REPO.
 *
 * La clave del mapa es el path ABSOLUTO del repo, comparado por igualdad exacta de string. Es la
 * MISMA definición de «mismo repo» que usan `entryKey` (identidad de una entrada) y
 * `countPendingForProject` (aviso de presión de integración). Normalizar aquí —resolve,
 * realpath, case-folding— introduciría una tercera definición, y un desacuerdo entre ellas sería
 * bastante peor que una config que no se encuentra y se ve al instante.
 *
 * POR QUÉ NO VIVE DENTRO DEL REPO (un `.kodo/oracle.json` versionado, que sería más cómodo):
 * esto son comandos que kodo EJECUTA sola, en un proceso detached, al cerrar una sesión. Leerlos
 * de un fichero del árbol de trabajo convertiría «hacer checkout de una rama» en «ejecutar lo
 * que esa rama diga». El config del operador vive fuera de todo repo y solo lo edita él.
 *
 * @param {any} config El config completo de kodo (`loadConfig()`).
 * @param {string} projectPath Path absoluto del repo.
 * @returns {{ setup: string|null, build: string|null, tests: string|null, lint: string|null, schema: string|null, timeout_s: number }}
 */
export function resolveRepoCommands(config, projectPath) {
  const oracle = config && typeof config === 'object' ? config.oracle : null;
  const repos = oracle && typeof oracle.repos === 'object' && oracle.repos ? oracle.repos : {};
  const entry = typeof projectPath === 'string' ? repos[projectPath] : null;
  const cmd = (v) => (typeof v === 'string' && v.trim() !== '' ? v : null);
  const rawTimeout = entry && Number(entry.timeout_s) > 0 ? Number(entry.timeout_s)
    : oracle && Number(oracle.timeout_s) > 0 ? Number(oracle.timeout_s)
      : DEFAULT_TIMEOUT_S;
  return {
    setup: entry ? cmd(entry.setup) : null,
    build: entry ? cmd(entry.build) : null,
    tests: entry ? cmd(entry.tests) : null,
    lint: entry ? cmd(entry.lint) : null,
    schema: entry ? cmd(entry.schema) : null,
    timeout_s: Math.floor(rawTimeout),
  };
}

/**
 * ¿Está el oráculo activo? PURA.
 *
 * SOLO el literal `false` lo apaga. Un `"no"`, un `0` o una clave con forma rara caen a
 * ACTIVO, y es deliberado: el oráculo por defecto no ejecuta un solo comando (sin `repos`
 * configurados corre únicamente el check de alcance, que es lectura pura), así que el coste de
 * un fail-open aquí es un `skip` de más. El fail-closed —apagar la verificación porque una
 * clave venía torcida— sí tendría coste: dejaría de mirarse una rama sin que nadie lo pidiera.
 *
 * `oracle.enabled` no entra en `getEditableFields` (no hay `kind` booleano y el bloque se edita
 * a mano), así que `mergeAndValidateConfig` no lo normaliza. Esta función ES esa normalización.
 *
 * @param {any} config
 * @returns {boolean}
 */
export function oracleEnabled(config) {
  return config?.oracle?.enabled !== false;
}

/**
 * ¿Está el oráculo desfasado respecto a la punta de la rama? PURA.
 *
 * `true` solo cuando hay las dos cosas y NO coinciden. Sin `commit` en el oráculo o sin `head`
 * conocido la respuesta es `false`: «no consta que esté desfasado» — no se inventa un desfase
 * que no se puede demostrar, y el veredicto ya será `unknown` por su cuenta en el caso que
 * importa.
 *
 * @param {OracleResult|null|undefined} oracle
 * @param {string|null|undefined} head SHA de la punta de la rama AHORA.
 * @returns {boolean}
 */
export function isOracleStale(oracle, head) {
  const c = oracle?.commit;
  if (typeof c !== 'string' || c === '') return false;
  if (typeof head !== 'string' || head === '') return false;
  return c !== head;
}

/**
 * Ejecutor por defecto de un comando del operador.
 *
 * `sh -c` con el comando TAL CUAL, mismo criterio (y mismo precedente) que `--test` de
 * `kodo integrate`: el comando lo escribe el operador en SU config, es exactamente lo que
 * teclearía a mano, y no hay nada que sanear que él no haya escrito. NUNCA se ejecuta nada
 * derivado de la cola, del plan ni del provider.
 *
 * `spawnSync` y no `execFileSync` por una razón que decide el veredicto: `execFileSync` LANZA
 * tanto con exit code ≠ 0 como con timeout, y confundir «el test falló» con «no pude
 * comprobarlo» es justo lo que este módulo no puede hacer. `spawnSync` devuelve `status`,
 * `signal` y `error` por separado, así que cada uno cae en su estado.
 *
 * @param {string} cmd
 * @param {string} cwd
 * @param {number} timeoutMs
 * @returns {Promise<{ status: 'pass'|'fail'|'unknown', detail: string }>}
 */
async function defaultExec(cmd, cwd, timeoutMs) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('/bin/sh', ['-c', cmd], {
    cwd,
    encoding: 'utf-8',
    timeout: timeoutMs,
    // Sin heredar stdio: este runner es detached y su stdout va a /dev/null. Capturar acota
    // además la memoria (maxBuffer) frente a un comando charlatán.
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.error) {
    const code = /** @type {any} */ (r.error).code;
    return {
      status: 'unknown',
      detail: code === 'ETIMEDOUT' ? `timeout tras ${Math.round(timeoutMs / 1000)}s` : String(r.error.message || code),
    };
  }
  // Matado por señal sin `error`: tampoco es un fallo del comando, es una corrida interrumpida.
  if (r.signal) return { status: 'unknown', detail: `interrumpido por ${r.signal}` };
  if (r.status === 0) return { status: 'pass', detail: '' };
  return { status: 'fail', detail: `exit ${r.status}: ${lastLine(r.stderr) || lastLine(r.stdout)}` };
}

/**
 * Última línea no vacía de una salida. Es la que casi siempre lleva el resumen del fallo
 * (`3 failing`, `error TS2345: …`, `Command failed`), y cabe en el `detail`.
 *
 * @param {unknown} out
 * @returns {string}
 */
function lastLine(out) {
  const lines = String(out ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

/**
 * Crea un worktree DESECHABLE sobre el commit de la rama, corre `fn` dentro y lo destruye.
 *
 * POR QUÉ UN WORKTREE PROPIO Y NO EL DE LA SESIÓN. El worktree de la sesión lo borra
 * `performTerminalCleanup` tres líneas después de la captura en `SessionEnd`. Un runner detached
 * que dependiese de él correría sobre un directorio que se está evaporando: unas veces
 * funcionaría y otras no, que es la peor propiedad posible en algo que produce un veredicto.
 *
 * POR QUÉ NO EL REPO PRINCIPAL. Ahí está checkouteada otra rama —normalmente `main`—, así que
 * verificaría código distinto del que dice verificar. Y hacer `switch` por debajo del operador
 * está prohibido en este carril (mismo contrato que `kodo integrate`).
 *
 * `--detach` y no la rama: la rama puede estar checkouteada en otro worktree, y `git worktree
 * add <dir> <branch>` fallaría. Al oráculo le da igual el nombre — verifica un COMMIT.
 *
 * `--force` en el remove: el propio comando del operador pudo dejar el árbol sucio
 * (`node_modules`, artefactos de build). Sin él, el worktree desechable quedaría en disco y en
 * `git worktree list` para siempre.
 *
 * @template T
 * @param {{ project: string, commit: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string, tmpRootFn?: () => string }} args
 * @param {(dir: string) => Promise<T>} fn
 * @returns {Promise<{ ok: true, value: T } | { ok: false, detail: string }>}
 */
async function withDisposableWorktree({ project, commit, gitFn, tmpRootFn }, fn) {
  const root = (tmpRootFn || tmpdir)();
  const dir = join(root, `kodo-oracle-${randomUUID()}`);
  try {
    await gitFn(project, ['worktree', 'add', '--detach', dir, commit]);
  } catch (e) {
    return { ok: false, detail: `no se pudo crear el worktree del oráculo: ${/** @type {Error} */ (e).message}` };
  }
  try {
    return { ok: true, value: await fn(dir) };
  } finally {
    // El cleanup NUNCA puede tumbar la corrida: si `remove` falla, el veredicto ya está y solo
    // queda un directorio huérfano que `git worktree prune` recoge.
    try {
      await gitFn(project, ['worktree', 'remove', '--force', dir]);
    } catch { /* fail-open: el veredicto vale igual */ }
  }
}

/**
 * Corre el oráculo sobre la rama de una entrada de la cola.
 *
 * SECUENCIA:
 *   1. Punta de la rama (`rev-parse <branch>`) — el ancla del veredicto. Si no se resuelve, no
 *      hay nada que verificar y todo sale `unknown`.
 *   2. `scope`, que no necesita checkout: diff contra la base + alcance declarado en el plan.
 *   3. Si hay AL MENOS un comando configurado, worktree desechable, `setup` opcional y los
 *      cuatro comandos en orden fijo. Sin comandos, ni se crea el worktree.
 *
 * TODO ES DI. `gitFn`, `execFn`, `now` y `readPlanFn` entran por parámetro, así que la suite
 * ejercita las cinco ramas sin un repo real ni un `sh` de verdad.
 *
 * NEVER-THROWS: el `catch` de cuerpo entero devuelve `state: 'error'` con los cinco checks en
 * `unknown`. Un oráculo roto informa de que está roto; jamás propaga.
 *
 * @param {{
 *   project: string,
 *   branch: string,
 *   base?: string|null,
 *   commands: { setup: string|null, build: string|null, tests: string|null, lint: string|null, schema: string|null, timeout_s: number },
 *   planMd?: string|null,
 *   gitFn: (cwd: string, args: string[]) => Promise<string>|string,
 *   execFn?: (cmd: string, cwd: string, timeoutMs: number) => Promise<{ status: 'pass'|'fail'|'unknown', detail: string }>,
 *   tmpRootFn?: () => string,
 *   now?: () => Date,
 * }} args
 * @returns {Promise<OracleResult>}
 */
export async function runOracle({ project, branch, base, commands, planMd, gitFn, execFn, tmpRootFn, now }) {
  const clock = now || (() => new Date());
  const startedAt = clock().toISOString();
  const exec = execFn || defaultExec;
  const timeoutMs = Math.max(1, commands?.timeout_s || DEFAULT_TIMEOUT_S) * 1000;

  try {
    const commit = await revParse({ project, ref: branch, gitFn });
    if (!commit) {
      return {
        state: 'error',
        verdict: 'unknown',
        commit: null,
        checks: mapChecks(() => check('unknown', `la rama ${branch} no resuelve a ningún commit`)),
        started_at: startedAt,
        finished_at: clock().toISOString(),
      };
    }

    const checks = skippedChecks();

    // ── scope: cero shell, cero checkout ────────────────────────────────────────────
    const t0 = Date.now();
    const files = base ? await readChangedFiles({ project, branch, base, gitFn }) : null;
    const patterns = parseScopeBlock(planMd);
    const scope = checkScope({ files, patterns });
    checks.scope = check(scope.status, scope.detail, Date.now() - t0);

    // ── comandos del operador ───────────────────────────────────────────────────────
    const configured = COMMAND_CHECKS.filter((k) => commands && commands[k]);
    if (configured.length > 0) {
      const r = await withDisposableWorktree({ project, commit, gitFn, tmpRootFn }, async (dir) => {
        // `setup` NO es un check: es la precondición para que los checks signifiquen algo (un
        // worktree recién creado no tiene `node_modules`, ni `vendor/bundle`, ni `.venv`). Si
        // falla, los cuatro comandos quedan `unknown` y NO `fail`: un `npm ci` que no llega al
        // registro no dice nada sobre si los tests pasan.
        if (commands.setup) {
          const s = await exec(commands.setup, dir, timeoutMs);
          if (s.status !== 'pass') {
            for (const k of configured) {
              checks[k] = check('unknown', `setup falló: ${s.detail}`);
            }
            return;
          }
        }
        for (const k of configured) {
          const started = Date.now();
          const res = await exec(/** @type {string} */ (commands[k]), dir, timeoutMs);
          checks[k] = check(res.status, res.detail || null, Date.now() - started);
        }
      });
      if (!r.ok) {
        for (const k of configured) checks[k] = check('unknown', r.detail);
      }
    }

    return {
      state: 'done',
      verdict: aggregateVerdict(checks),
      commit,
      checks,
      started_at: startedAt,
      finished_at: clock().toISOString(),
    };
  } catch (err) {
    return {
      state: 'error',
      verdict: 'unknown',
      commit: null,
      checks: mapChecks(() => check('unknown', `el oráculo falló: ${/** @type {Error} */ (err).message}`)),
      started_at: startedAt,
      finished_at: clock().toISOString(),
    };
  }
}

/**
 * Construye el mapa de los cinco checks con la misma fábrica. Preserva el ORDEN de `CHECK_KEYS`.
 *
 * @param {(k: string) => OracleCheck} make
 * @returns {Record<'build'|'tests'|'lint'|'schema'|'scope', OracleCheck>}
 */
function mapChecks(make) {
  const out = /** @type {any} */ ({});
  for (const k of CHECK_KEYS) out[k] = make(k);
  return out;
}

/**
 * SHA de una ref. `null` si no resuelve. Never-throws.
 *
 * @param {{ project: string, ref: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<string|null>}
 */
export async function revParse({ project, ref, gitFn }) {
  try {
    const out = String(await gitFn(project, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Ficheros que la rama toca respecto a su base.
 *
 * `diff --name-only <base>...<branch>` (TRES puntos) mide desde el merge-base, igual que
 * `readDiffSummary` en capture.js y por la misma razón: los commits que la base ganó por debajo
 * no son cambios de la rama, y contarlos como tales convertiría cada `main` que avanza en un
 * `fail` de alcance.
 *
 * @param {{ project: string, branch: string, base: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<string[]|null>} `null` = diff no inspeccionable.
 */
export async function readChangedFiles({ project, branch, base, gitFn }) {
  try {
    const out = String(await gitFn(project, ['diff', '--name-only', `${base}...${branch}`]));
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}
