// @ts-check
//
// src/cli/integrate.js — KODO-26: handlers de `kodo integrate` (listado + ejecución).
//
// DOS carriles, un comando:
//   `kodo integrate [--all] [--json]`                 → LISTA la cola. Nunca falla (exit 0).
//   `kodo integrate <ref> --ff|--merge|--pr|--drop`   → EJECUTA una acción sobre una entrada.
//
// Invariante de retorno (D-07 del repo, precedente `inbox.js:24`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El registro de commander en
// `src/cli.js` es quien hace el exit.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de
// color directamente — solo `createFormatter`.
//
// LO QUE ESTE COMANDO NO HACE, POR CONTRATO:
//   - NUNCA `git push`. NUNCA `gh pr create`. `--pr` PREPARA: valida que la rama existe, marca
//     la entrada e IMPRIME el comando listo para que lo ejecute el operador. La política
//     anti-push-fantasma del repo dice que kodo no publica solo, y aquí no hay excepción.
//   - NUNCA cambia de rama. Si la base no está checkouteada, el comando ABORTA con un mensaje
//     accionable en vez de hacer `switch` por su cuenta: el checkout del operador es suyo.
//   - NUNCA borra la rama tras integrar. Eso es del carril de cleanup (KODO-21), que ya sabe
//     verificar; borrarla aquí sería una segunda fuente de verdad sobre lo mismo.
//   - NUNCA borra la entrada de la cola. La resuelve (`done`/`dropped`) y la deja como traza.
//   - NUNCA corre el oráculo (KODO-69). Lo LEE de la entrada: el listado sigue siendo cero-git
//     y cero-ejecución, y `--require-oracle` solo añade un `rev-parse` para comprobar que el
//     veredicto sigue anclado a la punta de la rama. Quien ejecuta es `kodo oracle run`.
//   - NUNCA audita (KODO-74), y aquí es imposible por construcción: el audit gate pide una
//     segunda pasada a la SESIÓN, y cuando este comando corre esa sesión hace rato que cerró.
//     Se LEE lo que `kodo audit` dejó escrito, igual que con el oráculo.
//
// Exit codes:
//   0  la acción se ejecutó (o el listado se pintó)
//   1  la acción falló: precondición no cumplida, git falló, o el lock de state.json expiró
//   2  uso incorrecto: ninguna acción o más de una, o la ref no está pendiente en la cola

import { findPendingIntegration, listIntegrationQueue, resolveIntegration } from '../integration/queue.js';
import { isOracleStale } from '../integration/oracle.js';
import { integrateAction } from '../logger-events.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/** Acciones válidas, en el orden en que se listan en la ayuda. */
const ACTIONS = /** @type {const} */ (['ff', 'merge', 'pr', 'drop']);

/**
 * `gitFn` de producción del carril CLI: devuelve stdout trimeado y LANZA si el exit code no es
 * 0. Los argumentos van SIEMPRE como array a `execFileSync` — nunca hay un shell de por medio,
 * así que un nombre de rama con metacaracteres no puede ejecutar nada.
 *
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Promise<string>}
 */
async function defaultGit(cwd, args) {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
}

/**
 * Edad legible de una entrada: `3m`, `5h`, `2d`. Pura.
 *
 * Es LA columna que motiva la cola: una rama que lleva cuatro días esperando no se distingue de
 * una de hace diez minutos si solo se ve la sugerencia.
 *
 * @param {string} iso
 * @param {Date} now
 * @returns {string} `?` si la fecha no parsea.
 */
export function formatAge(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '?';
  const mins = Math.max(0, Math.floor((now.getTime() - t) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * Celda del oráculo en el listado. PURA — no colorea (la tabla de este comando es monocroma en
 * sus datos; el color queda para `ok`/`fail` de las acciones).
 *
 * Los cuatro valores son deliberadamente distinguibles a simple vista, y ninguno de ellos miente
 * por omisión: `—` significa que NADIE ha verificado esta rama, y no se parece a un `pass`.
 *
 * @param {import('../integration/oracle.js').OracleResult|null|undefined} oracle
 * @returns {'—'|'…'|'pass'|'fail'|'?'}
 */
export function oracleCell(oracle) {
  if (!oracle || typeof oracle !== 'object') return '—';
  if (oracle.state === 'running') return '…';
  if (oracle.verdict === 'pass') return 'pass';
  if (oracle.verdict === 'fail') return 'fail';
  return '?';
}

/**
 * Celda del audit gate en el listado. PURA.
 *
 * Los tres estados del gate, en tres formas que no se confunden a simple vista:
 *
 *   `—`    SIN AUDITAR. Nadie corrió el gate sobre esta rama. NO se parece a un visto bueno.
 *   `…N`   se abrió un reto (N en total) y NUNCA se cerró: se pidió la segunda pasada y no
 *          llegó evidencia de que ocurriera.
 *   `✓N`   hubo segunda pasada con evidencia, tras N retos. Ese N es la señal que ningún
 *          veredicto binario da: «esta rama necesitó 3 retos» dice algo sobre la rama.
 *
 * El `✓` NO afirma que el trabajo esté bien — afirma que alguien volvió a mirarlo y lo firmó.
 * Es exactamente lo que el gate puede prometer, y por eso se pinta al lado del veredicto del
 * oráculo y nunca en su lugar: uno es evidencia ejecutada, el otro un turno de relectura.
 *
 * @param {import('../integration/audit.js').AuditGate|null|undefined} audit
 * @returns {string}
 */
export function auditCell(audit) {
  if (!audit || typeof audit !== 'object') return '—';
  const n = Number.isInteger(audit.count) && audit.count > 0 ? audit.count : 1;
  return `${audit.status === 'audited' ? '✓' : '…'}${n}`;
}

/**
 * @typedef {{
 *   listFn?: typeof listIntegrationQueue,
 *   findFn?: typeof findPendingIntegration,
 *   resolveFn?: typeof resolveIntegration,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   runTestsFn?: (cmd: string, cwd: string) => Promise<{ ok: boolean, detail: string }>|{ ok: boolean, detail: string },
 *   loggerFn?: () => any,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   nowFn?: () => Date,
 * }} IntegrateDeps
 */

/**
 * Lista la cola de integración.
 *
 * CERO llamadas a git: todo sale de `state.json`, que ya trae el conteo, la base y la sugerencia
 * calculados en el cierre de la sesión. Es el requisito del orquestador — puede presentar la
 * cola entera en cada ronda sin pagar un solo `git` por entrada.
 *
 * @param {{ all?: boolean, json?: boolean }} opts
 * @param {IntegrateDeps} [deps]
 * @returns {number} SIEMPRE 0 — un listado nunca es una condición de error.
 */
export function runIntegrateListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listIntegrationQueue;
  const now = (deps.nowFn || (() => new Date()))();

  try {
    const entries = listFn({ all: opts.all === true });

    // Rama `--json` PRIMERO, antes de instanciar el formatter: el carril máquina no puede
    // contaminarse con ANSI por construcción, no solo por convención (DX-06). Las entradas se
    // serializan tal cual salen del store — sus 17 claves ya están en orden fijo.
    if (opts.json === true) {
      const pending = entries.filter((e) => e.status === 'pending').length;
      write(JSON.stringify({ pending, entries }) + '\n');
      return 0;
    }

    const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
    if (entries.length === 0) {
      write(`${fmt.dim('cola de integración vacía')}\n`);
      return 0;
    }
    // `task_ref` y `branch` vienen del provider y de git: contenido externo que se proyecta a un
    // terminal, así que pasa por `stripControlChars` (invariante HYG-07 del repo).
    const rows = entries.map((e) => [
      stripControlChars(e.task_ref),
      stripControlChars(e.branch),
      e.commits_ahead === null ? '?' : String(e.commits_ahead),
      e.base_ok === true ? 'sí' : e.base_ok === false ? 'NO' : '?',
      e.suggested,
      // KODO-69: el veredicto del oráculo, JUNTO a `suggested` y nunca en su lugar. Son dos
      // lecturas distintas de la misma rama —una heurística sobre lo que TOCA, un hecho sobre
      // lo que PASA— y el operador necesita las dos a la vez para decidir. `—` es «no ha
      // corrido», que es distinto de `unknown` («corrió y no pudo saberlo»).
      oracleCell(e.oracle),
      // KODO-74: la segunda señal de la fila, y la ortogonal a la anterior. El oráculo dice si
      // el artefacto está sano; esto dice si alguien volvió a leer lo que se pidió. Un `pass`
      // del oráculo sobre una rama `—` es código que compila y que nadie releyó.
      auditCell(e.audit),
      formatAge(e.created_at, now),
      e.status === 'pending' ? '' : `${e.status}${e.action ? `/${e.action}` : ''}`,
    ]);
    write(
      fmt.formatTable(rows, { header: ['ref', 'rama', 'commits', 'base', 'sugerido', 'oráculo', 'audit', 'edad', 'estado'] }) + '\n',
    );
    return 0;
  } catch (e) {
    // Cinturón de seguridad: ni un fallo del render convierte un listado en un exit distinto de 0.
    err(`[kodo:integrate] no se pudo renderizar la cola: ${/** @type {Error} */ (e).message}\n`);
    return 0;
  }
}

/**
 * Ejecuta UNA acción sobre UNA entrada pendiente de la cola.
 *
 * @param {string} ref task_ref (o nombre de rama) de la entrada.
 * @param {{ ff?: boolean, merge?: boolean, pr?: boolean, drop?: boolean, json?: boolean, test?: string, requireOracle?: boolean, requireAudit?: boolean }} opts
 * @param {IntegrateDeps} [deps]
 * @returns {Promise<number>} exit code (0 ok · 1 fallo de ejecución · 2 uso incorrecto).
 */
export async function runIntegrateActionCli(ref, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const findFn = deps.findFn || findPendingIntegration;
  const resolveFn = deps.resolveFn || resolveIntegration;
  const git = deps.gitFn || defaultGit;
  const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);

  const chosen = ACTIONS.filter((a) => opts[a] === true);
  if (chosen.length !== 1) {
    err('[kodo:integrate] elige EXACTAMENTE una acción: --ff | --merge | --pr | --drop\n');
    return 2;
  }
  const action = chosen[0];

  const entry = findFn(ref);
  if (!entry) {
    err(`[kodo:integrate] no hay ninguna entrada PENDIENTE para '${stripControlChars(ref)}' (mira \`kodo integrate\`)\n`);
    return 2;
  }

  // El logger se construye ANTES de tocar git para que TODA salida —incluidos los fallos de
  // precondición, que ni llegan a ejecutar nada— deje su línea en el NDJSON.
  const logger = await makeLogger(deps);

  /**
   * Cierra la acción: resuelve la entrada (solo en éxito), emite el evento, pinta y devuelve el
   * código. Un fallo NO resuelve la entrada: sigue pendiente, que es la verdad.
   *
   * @param {{ ok: boolean, outcome: string, sha?: string|null, message: string }} r
   * @returns {number}
   */
  const finish = (r) => {
    const sha = r.sha ?? null;
    let outcome = r.outcome;
    let ok = r.ok;

    if (ok) {
      const res = resolveFn(
        ref,
        { action, status: action === 'drop' ? 'dropped' : 'done', sha, outcome },
        logger,
      );
      if (!res.ok) {
        // La acción SÍ ocurrió (el merge está hecho) pero la traza en state.json no. Se degrada
        // a fallo con un outcome propio: devolver 0 dejaría la entrada pendiente para siempre y
        // el operador la re-ejecutaría sobre un merge ya aplicado.
        ok = false;
        outcome = `state-${res.reason}`;
        err(`[kodo:integrate] la acción se ejecutó pero la cola no se pudo actualizar (${res.reason})\n`);
      }
    }

    emit(logger, { action, task_ref: entry.task_ref, branch: entry.branch, sha, outcome, ok });
    // El fallo de la cola sobre una acción que SÍ salió bien ya avisó por stderr arriba; no se
    // vuelve a pintar el mensaje de éxito, que sería mentira.
    if (ok) write(`${fmt.ok(r.message)}\n`);
    else if (!r.ok) err(`${fmt.fail(r.message)}\n`);

    if (opts.json === true) {
      write(JSON.stringify({ ok, action, task_ref: entry.task_ref, branch: entry.branch, sha, outcome }) + '\n');
    }
    return ok ? 0 : 1;
  };

  // ── --drop: NO toca la rama, NO toca git. Solo transiciona la entrada. ────────────────
  if (action === 'drop') {
    return finish({
      ok: true,
      outcome: 'dropped',
      message: `${entry.task_ref}: descartada de la cola (la rama ${entry.branch} sigue intacta)`,
    });
  }

  const project = entry.project_path;

  // ── Gate OPCIONAL del oráculo (KODO-69, `--require-oracle`). ─────────────────────────
  //
  // NUNCA BLOQUEANTE POR DEFECTO, y esa no es una concesión: un gate que molesta con flakies
  // acaba apagado, y un gate apagado es peor que ninguno porque además da la falsa sensación de
  // que algo vigila. Sin la flag, el veredicto se PRESENTA (columna del listado, `kodo oracle`)
  // y el operador decide con él delante.
  //
  // Con la flag, el criterio es estricto en las tres direcciones que importan:
  //   - `fail`    → no se integra. Obvio.
  //   - `unknown` → TAMPOCO. Es la regla del enunciado: no verificado ≠ verde. Incluye el
  //                 oráculo que no ha corrido (`null`), el que está corriendo, y el que corrió
  //                 sin poder determinar nada.
  //   - DESFASADO → tampoco, aunque diga `pass`: un veredicto sobre un commit que ya no es la
  //                 punta de la rama no dice nada sobre lo que se va a mergear. Es el mismo
  //                 razonamiento que invalida una `review/approval.md` caducada.
  //
  // NO se aplica a `--drop`, que es la única acción que NO hace avanzar la rama (descarta la
  // entrada y deja la rama intacta). Gatear la salida de emergencia dejaría al operador sin
  // forma de sacar de la cola una rama que el oráculo no sabe verificar.
  if (opts.requireOracle === true) {
    const gate = await evaluateOracleGate(entry, project, git);
    if (!gate.ok) {
      return finish({ ok: false, outcome: gate.outcome, message: gate.message });
    }
  }

  // ── Gate OPCIONAL del audit gate (KODO-74, `--require-audit`). ───────────────────────
  //
  // Mismo contrato que el del oráculo, y por las mismas razones: opt-in (un gate que molesta
  // acaba apagado), no aplicable a `--drop` (la salida de emergencia no se gatea), y anclado al
  // commit (una auditoría sobre código que ya no es el código que hay no dice nada).
  //
  // Va DESPUÉS del oráculo a propósito: si las dos flags están puestas, el operador ve primero
  // el fallo mecánico —el que se arregla con un comando— y no el que le pide relanzar una
  // sesión.
  if (opts.requireAudit === true) {
    const gate = await evaluateAuditGate(entry, project, git);
    if (!gate.ok) {
      return finish({ ok: false, outcome: gate.outcome, message: gate.message });
    }
  }

  // ── Precondición común: el repo destino tiene que estar limpio. ──────────────────────
  // Un merge sobre un worktree sucio mezcla el trabajo del operador con el de la rama y deja un
  // estado que nadie sabe deshacer. Se comprueba ANTES de cualquier mutación.
  let status;
  try {
    status = await git(project, ['status', '--porcelain']);
  } catch (e) {
    return finish({ ok: false, outcome: 'git-error', message: `no se pudo leer el estado de ${project}: ${/** @type {Error} */ (e).message}` });
  }
  if (String(status).trim().length > 0) {
    return finish({ ok: false, outcome: 'worktree-dirty', message: `${project} tiene cambios sin commitear — intégralo tú o limpia el worktree` });
  }

  // ── --pr: prepara y DEVUELVE el comando. Cero red, cero push. ────────────────────────
  if (action === 'pr') {
    let exists = '';
    try {
      exists = String(await git(project, ['rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`]));
    } catch {
      exists = '';
    }
    if (!exists.trim()) {
      return finish({ ok: false, outcome: 'branch-missing', message: `la rama ${entry.branch} ya no existe en ${project}` });
    }
    const base = entry.base_branch || 'main';
    write(
      `${fmt.dim('ejecuta tú (kodo no hace push ni crea PRs):')}\n` +
        `  cd ${project} && git push -u origin ${entry.branch} && gh pr create --base ${base} --head ${entry.branch} --fill\n`,
    );
    return finish({ ok: true, outcome: 'prepared', message: `${entry.task_ref}: rama lista para PR (${entry.branch} → ${base})` });
  }

  // ── --ff / --merge: la base tiene que estar checkouteada. ────────────────────────────
  if (!entry.base_branch) {
    return finish({ ok: false, outcome: 'base-unknown', message: `no se resolvió la rama base de ${project} — intégralo a mano` });
  }
  let current;
  try {
    current = String(await git(project, ['branch', '--show-current'])).trim();
  } catch (e) {
    return finish({ ok: false, outcome: 'git-error', message: `no se pudo leer la rama actual de ${project}: ${/** @type {Error} */ (e).message}` });
  }
  if (current !== entry.base_branch) {
    // kodo NO hace `switch` por su cuenta: el checkout del operador es suyo, y cambiarlo por
    // debajo es justo el tipo de sorpresa que un comando de integración no puede permitirse.
    return finish({
      ok: false,
      outcome: 'base-not-checked-out',
      message: `${project} está en '${current}', no en '${entry.base_branch}' — cambia de rama y repite`,
    });
  }

  // ── Suite opcional (`--test '<cmd>'`). Solo corre si el operador la pide. ────────────
  if (opts.test) {
    const runTests = deps.runTestsFn || defaultRunTests;
    const t = await runTests(opts.test, project);
    if (!t.ok) {
      return finish({ ok: false, outcome: 'tests-failed', message: `la suite falló, no se integra nada: ${t.detail}` });
    }
  }

  const mergeArgs =
    action === 'ff'
      ? ['merge', '--ff-only', entry.branch]
      : ['merge', '--no-ff', '-m', `Merge branch '${entry.branch}' (${entry.task_ref})`, entry.branch];
  try {
    await git(project, mergeArgs);
  } catch (e) {
    return finish({
      ok: false,
      outcome: action === 'ff' ? 'ff-failed' : 'merge-failed',
      message: `git ${action === 'ff' ? 'merge --ff-only' : 'merge --no-ff'} falló: ${/** @type {Error} */ (e).message}`,
    });
  }

  let sha = null;
  try {
    sha = String(await git(project, ['rev-parse', 'HEAD'])).trim() || null;
  } catch {
    sha = null; // el merge ya está hecho; no saber el sha no lo deshace.
  }

  return finish({
    ok: true,
    outcome: action === 'ff' ? 'fast-forwarded' : 'merged',
    sha,
    message: `${entry.task_ref}: ${entry.branch} → ${entry.base_branch} (${action === 'ff' ? 'fast-forward' : 'merge'}${sha ? ` ${sha.slice(0, 8)}` : ''})`,
  });
}

/**
 * Evalúa el gate del oráculo sobre UNA entrada. Never-throws.
 *
 * Hace UNA llamada a git (`rev-parse` de la rama) y solo cuando la flag está puesta: el listado
 * sigue siendo cero-git, y una acción SIN `--require-oracle` no paga nada. Si esa llamada falla,
 * el veredicto no se puede anclar a nada y el gate cierra — fail-CLOSED, al revés que el resto
 * del carril del oráculo, porque aquí el operador ha pedido explícitamente que se le impida
 * integrar sin verificación.
 *
 * @param {import('../integration/queue.js').IntegrationEntry} entry
 * @param {string} project
 * @param {(cwd: string, args: string[]) => Promise<string>|string} git
 * @returns {Promise<{ ok: true } | { ok: false, outcome: string, message: string }>}
 */
async function evaluateOracleGate(entry, project, git) {
  const oracle = entry.oracle;
  if (!oracle || typeof oracle !== 'object') {
    return {
      ok: false,
      outcome: 'oracle-missing',
      message: `--require-oracle: el oráculo no ha corrido sobre ${entry.branch} — \`kodo oracle run ${entry.task_ref}\``,
    };
  }
  if (oracle.state === 'running') {
    return {
      ok: false,
      outcome: 'oracle-running',
      message: `--require-oracle: el oráculo sigue corriendo sobre ${entry.branch} — espera y repite`,
    };
  }
  if (oracle.verdict === 'fail') {
    const failed = Object.entries(oracle.checks || {})
      .filter(([, c]) => c && c.status === 'fail')
      .map(([k]) => k);
    return {
      ok: false,
      outcome: 'oracle-failed',
      message: `--require-oracle: el oráculo dice fail${failed.length ? ` (${failed.join(', ')})` : ''} — \`kodo oracle ${entry.task_ref}\` para el detalle`,
    };
  }
  if (oracle.verdict !== 'pass') {
    return {
      ok: false,
      outcome: 'oracle-unknown',
      message: `--require-oracle: el oráculo no pudo verificar ${entry.branch} (unknown) — no verificado no es verde`,
    };
  }

  let head = null;
  try {
    head = String(await git(project, ['rev-parse', '--verify', '--quiet', `${entry.branch}^{commit}`])).trim() || null;
  } catch {
    head = null;
  }
  if (!head) {
    return {
      ok: false,
      outcome: 'oracle-unanchored',
      message: `--require-oracle: no se pudo leer la punta de ${entry.branch}, así que el veredicto no se puede anclar`,
    };
  }
  if (isOracleStale(oracle, head)) {
    return {
      ok: false,
      outcome: 'oracle-stale',
      message: `--require-oracle: el oráculo verificó ${String(oracle.commit).slice(0, 8)} y la rama va por ${head.slice(0, 8)} — vuelve a correrlo`,
    };
  }
  return { ok: true };
}

/**
 * Evalúa el gate del audit gate sobre UNA entrada. Never-throws.
 *
 * Espejo exacto de `evaluateOracleGate`, incluida la política fail-CLOSED cuando la punta no se
 * puede leer: el operador ha pedido explícitamente que se le impida integrar sin auditar, así
 * que la duda no pasa.
 *
 * Los tres motivos de bloqueo son los tres estados que NO son «auditado sobre esto»:
 *   - `audit: null`      → nadie corrió el gate. SIN AUDITAR ≠ auditado sin hallazgos.
 *   - `status: pending`  → se abrió un reto y nunca llegó evidencia de la segunda pasada.
 *   - DESFASADO          → se auditó, y después la rama ganó commits que nadie leyó. Es el
 *                          mismo razonamiento que invalida un veredicto de oráculo desfasado.
 *
 * @param {import('../integration/queue.js').IntegrationEntry} entry
 * @param {string} project
 * @param {(cwd: string, args: string[]) => Promise<string>|string} git
 * @returns {Promise<{ ok: true } | { ok: false, outcome: string, message: string }>}
 */
async function evaluateAuditGate(entry, project, git) {
  const audit = entry.audit;
  if (!audit || typeof audit !== 'object') {
    return {
      ok: false,
      outcome: 'audit-missing',
      message: `--require-audit: nadie pasó el audit gate sobre ${entry.branch} — la sesión cerró sin \`kodo audit\``,
    };
  }
  if (audit.status !== 'audited') {
    return {
      ok: false,
      outcome: 'audit-pending',
      message: `--require-audit: ${entry.branch} tiene un reto de auditoría abierto (${audit.count}) que nunca se cerró con evidencia`,
    };
  }

  let head = null;
  try {
    head = String(await git(project, ['rev-parse', '--verify', '--quiet', `${entry.branch}^{commit}`])).trim() || null;
  } catch {
    head = null;
  }
  if (!head) {
    return {
      ok: false,
      outcome: 'audit-unanchored',
      message: `--require-audit: no se pudo leer la punta de ${entry.branch}, así que la auditoría no se puede anclar`,
    };
  }
  if (typeof audit.commit === 'string' && audit.commit !== '' && audit.commit !== head) {
    return {
      ok: false,
      outcome: 'audit-stale',
      message: `--require-audit: se auditó ${audit.commit.slice(0, 8)} y la rama va por ${head.slice(0, 8)} — esos commits no los ha leído nadie`,
    };
  }
  return { ok: true };
}

/**
 * Ejecuta la suite que el operador pasó en `--test`. El comando es SUYO (lo teclea él en su
 * terminal, igual que lo ejecutaría a mano), así que se lanza tal cual por `sh -c`: no hay nada
 * que sanear que él no haya escrito. No se ejecuta jamás nada derivado de la cola.
 *
 * @param {string} cmd
 * @param {string} cwd
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
async function defaultRunTests(cmd, cwd) {
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('/bin/sh', ['-c', cmd], { cwd, encoding: 'utf-8', stdio: 'pipe' });
    return { ok: true, detail: '' };
  } catch (e) {
    return { ok: false, detail: String(/** @type {Error} */ (e).message).split('\n')[0] };
  }
}

/**
 * Logger del carril: `~/.kodo/logs/integrate.ndjson`.
 *
 * NEVER-THROWS: si `logger.js` no carga o `createLogger` lanza (HOME de solo lectura, por
 * ejemplo) devuelve un logger MUDO y la acción sigue su curso. El registro es auditoría, no una
 * precondición — perder la línea nunca puede impedir el merge (fail-open del enunciado).
 *
 * @param {IntegrateDeps} deps
 * @returns {Promise<any>}
 */
async function makeLogger(deps) {
  if (deps.loggerFn) return deps.loggerFn();
  /** @type {any} */
  const mute = { info() {}, warn() {}, error() {}, debug() {}, child() { return mute; } };
  try {
    const { createLogger } = await import('../logger.js');
    return createLogger({
      sessionId: 'integrate',
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'integrate' });
  } catch {
    return mute;
  }
}

/**
 * Emite el evento NDJSON de la acción. Fail-open: un sink roto NUNCA rompe la acción.
 *
 * @param {any} logger
 * @param {{ action: 'ff'|'merge'|'pr'|'drop', task_ref: string, branch: string|null, sha: string|null, outcome: string, ok: boolean }} fields
 */
function emit(logger, fields) {
  try {
    integrateAction(logger, fields);
  } catch {
    /* fail-open: el registro es auditoría, no una precondición de la acción */
  }
}
