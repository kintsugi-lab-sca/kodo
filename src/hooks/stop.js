#!/usr/bin/env node
// @ts-check
//
// Claude Code Stop hook for kodo
// Mechanical cleanup when a kodo-tracked Claude session ends: removes
// the session from local state and marks the cmux workspace as review.
// The active Claude session owns all provider-side interactions
// (comments, state transitions) so the hook never touches Plane.
// Also detects when the orchestrator session ends and auto-commits
// skill changes.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { traceUnmatchedClose } from './close-guard.js';
import { getSessionMode } from '../labels.js';
import { stripForKeystroke } from '../cli/sanitize.js';
import { getHost, resolveHostName } from '../host/interface.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_ROOT = process.env.KODO_ROOT || join(__dirname, '..', '..');
const SKILL_PATH = join(KODO_ROOT, '.claude', 'skills', 'kodo-orchestrate', 'skill.md');

const STDIN_TIMEOUT = 3000;

/**
 * Build the orchestrator nudge text for a session that just ended.
 * Pure function — no I/O. Exported for testing.
 *
 * Phase 12 D-07: switch exhaustivo sobre getSessionMode(session) con tres cases:
 *   - 'quick' → texto que NO sugiere `kodo gsd verify` (CLI no soporta quick).
 *               Es one-shot sin VERIFICATION.md; orchestrator revisa manualmente.
 *   - 'full'  → texto Phase 10 D-04: apunta a `kodo gsd verify <session-id>`.
 *               phase_id puede estar ausente (bootstrap, Phase 9 D-11) → fallback "bootstrap".
 *   - default → null (no-GSD): texto original "Revisa el resultado y decide…".
 *
 * Idioma: español (D-16 Phase 10).
 *
 * Phase 75 LIVE-07 (D-08/D-09/D-10): 2º parámetro OPCIONAL `next`. Cuando la tarea
 * tiene un `NEXT:` persistido (threadeado por session-end.js, NUNCA leído aquí — la
 * función sigue PURA, cero I/O, D-08), se añade UNA línea ES al final del texto
 * por-modo, en los TRES modos (quick/full/no-GSD, D-10). Sin `next` (null / '' /
 * undefined / no-string) el texto queda BYTE-IDÉNTICO al de cada rama original —
 * degradación limpia que protege la no-regresión de los tests por-modo (D-09).
 *
 * @param {import('../session/state.js').Session} session
 * @param {string|null} [next] NEXT: persistido de la tarea (post-asimetría). Falsy → sin línea.
 * @returns {string}
 */
export function buildStopNudgeText(session, next) {
  // Phase 78 (T-78-01, 75/WR-01): sanear los campos LLM en el punto de composición
  // (Opción 1 de RESEARCH §Scope A). task_ref/summary cruzan de datos no confiables
  // (LLM / state.json hand-editable) al terminal del orquestador vía cmuxClient.send;
  // Phase 78 (WR-02): este texto va a cmuxClient.send (carril de KEYSTROKE), no al
  // render. stripForKeystroke neutraliza CSI/OSC/C0/C1/DEL/CR Y ADEMÁS los `\n`/`\t`
  // (reales y su forma de escape literal), que en `cmux send` serían Enter/Tab — un
  // salto de línea en task_ref/summary inyectaría un Enter espurio en el terminal del
  // orquestador. Es pura → la función SIGUE pura; sobre ASCII limpio es la identidad
  // → goldens byte-idénticos (D-09).
  const base = `La sesión ${stripForKeystroke(session.task_ref)} (${stripForKeystroke(session.summary)}) ha terminado y está en Review.`;
  let text;
  switch (getSessionMode(session)) {
    case 'quick':
      // D-08: texto ES, NO sugiere verify. Escape literal `\\n` preservado (D-04 Phase 10).
      text = `${base} Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n`;
      break;
    case 'full': {
      // Texto Phase 10 D-04 preservado verbatim.
      const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
      text = `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
      break;
    }
    default:
      // null → sesión no-GSD. Texto original preservado.
      text = `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
  }
  // LIVE-07: con un NEXT: persistido, una única línea ES al final (los 3 modos, D-10).
  // Guard estricto `typeof === 'string' && length > 0`: null/''/undefined/no-string
  // NO añaden nada → `text` queda byte-idéntico a la rama original (D-09).
  if (typeof next === 'string' && next.length > 0) {
    // Phase 78 (T-78-01 / WR-02): el `next` (NEXT: persistido, origen LLM/hand-editable)
    // se sanea con stripForKeystroke antes de interpolarse — carril de keystroke, así que
    // un `\n` embebido no puede convertirse en Enter. El guard estricto se mantiene tal cual.
    text += `Siguiente paso sugerido por la sesión: ${stripForKeystroke(next)}\\n`;
  }
  return text;
}

async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}


/**
 * Sella en `state.json` la rama sobre la que trabaja la sesión (KODO-30).
 *
 * POR QUÉ AQUÍ Y NO AL CERRAR: el nombre de la rama solo se puede leer del worktree, y
 * para cuando corre `SessionEnd` el worktree puede haber desaparecido — al salir, Claude
 * Code ofrece «Remove worktree» y, si el operador acepta, borra el directorio ANTES de que
 * el hook arranque (observado en el cierre de KODO-29). `Stop` dispara al final de CADA
 * turno, con el directorio todavía vivo, así que es el último punto del ciclo en el que la
 * pregunta tiene respuesta. Sin este sellado, el cierre de una sesión mergeada deja la
 * rama huérfana (el cleanup no sabe cuál borrar) y la cola de integración no encola nada
 * (la captura lee `detached`).
 *
 * TAMPOCO al lanzar: la rama la crea `claude --worktree` DESPUÉS del spawn, y su nombre lo
 * elige el agente (`feat/itclip-81-…`). En `launchWorkItem` todavía no existe.
 *
 * Escribe solo cuando el valor CAMBIA — un turno normal no toca `state.json`, y el
 * `state.session.updated` del logger marca de verdad un cambio de rama.
 *
 * FAIL-OPEN de cuerpo entero: ninguna rama de esta función lanza. Un hook JAMÁS debe
 * crashear Claude Code, y la rama es un dato de conveniencia — sin él, el cleanup degrada
 * a «no tocar ninguna rama», que es el lado seguro.
 *
 * @param {import('../session/state.js').Session} session
 * @param {{
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   existsFn?: (path: string) => boolean,
 *   updateSessionFn?: (taskId: string, updates: object, logger?: any) => any,
 *   logger?: any,
 * }} [deps]
 * @returns {Promise<string|null>} La rama persistida en esta llamada, o `null` si no se
 *   escribió nada (sin worktree, worktree ausente, git mudo, o rama sin cambios).
 */
export async function persistSessionBranch(session, deps = {}) {
  try {
    // Sin worktree no hay dónde leer (sesión adoptada o proyecto no-git): la captura de
    // integración ya lee del propio repo en ese caso, así que no hay nada que sellar.
    if (!session?.worktree_path || !session.project_path || !session.task_id) return null;

    const existsFn = deps.existsFn || existsSync;
    const { resolveEffectiveWorktree, defaultGitFn } = await import('./terminal-cleanup.js');
    // MISMA resolución que usan el cleanup y la captura: dos criterios distintos de «cuál
    // es el worktree de esta sesión» podrían sellar la rama de otro directorio.
    const wt = resolveEffectiveWorktree(session, existsFn);
    if (!existsFn(wt)) return null;

    const gitFn = deps.gitFn || defaultGitFn;
    const out = await gitFn(session.project_path, ['-C', wt, 'branch', '--show-current']);
    const branch = String(out ?? '').trim();
    // Vacío = detached HEAD. No se sella: un valor viejo correcto vale más que uno nuevo
    // vacío, y machacarlo dejaría al cleanup sin rama justo cuando más falta hace.
    if (!branch || branch === session.branch) return null;

    const { updateSession } = await import('../session/state.js');
    const updateSessionFn = deps.updateSessionFn || updateSession;
    updateSessionFn(session.task_id, { branch }, deps.logger);
    return branch;
  } catch (err) {
    console.error(`[kodo:stop] persistSessionBranch failed: ${/** @type {Error} */ (err).message}`);
    return null;
  }
}

/**
 * Test-friendly entry point for the stop hook.
 * Pure-ish function over (input, deps) — used by tests with memSink loggerFactory.
 * Production callers should use main() which parses stdin first.
 *
 * Phase 16 LOG-15: añade el bloque `markSessionStatus(...)` PRE-release dentro
 * de la rama "session.gsd" del cleanup. Phase 38 D-12: el estado pasó de 'done'
 * a 'idle' ('session-stop:lock-released') — el stop hook ya no marca la sesión
 * como muerta, sino como "lock liberado, esperando humano". El refactor light a (input, deps)
 * permite a tests inyectar memSink logger sin spawn de child process — mismo
 * patrón que `runGsdVerify(opts, deps)` en src/gsd/verify.js.
 *
 * W-4 deps enumeration:
 *   - findSessionFn: mandatory para tests (lookup en fixture sintético)
 *   - cmux: aceptado por compatibilidad de firma; Phase 72 HYG-04 movió los
 *           efectos cmux (setColor/notify/send) a SessionEnd, así que runStopHook
 *           ya NO lo consume (los tests legacy aún lo inyectan sin efecto).
 *   - loggerFactory: mandatory para captura de state.transition
 *
 * Phase 58 LIFE-03: `removeSessionFn` ya NO es dep de Stop — el cleanup destructivo
 * (removeSession/worktree) migró a SessionEnd (session-end.js). KODO-30 reintroduce
 * `gitFn`/`existsFn`, pero solo para LEER: `persistSessionBranch` sella la rama de la
 * sesión mientras el worktree existe. Ningún camino de Stop borra nada.
 *
 * @param {{session_id: string, cwd?: string, transcript_path?: string}} input
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   cmux?: typeof cmux,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   listSessionsForPathFn?: (cwd: string) => {id: string, session: any}[],
 *   unmatchedLoggerFactory?: () => any,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   existsFn?: (path: string) => boolean,
 * }} [deps]
 * @returns {Promise<void>}
 *
 * **Lazy DI pattern (IN-01 Phase 16 documentado vía Phase 22):**
 *
 * Los siguientes módulos se importan dinámicamente y NO son inyectables vía `deps`:
 *
 *   - `markSessionStatus` — dynamic import for lazy DI from `../session/manager.js`
 *   - `releaseGsdLock`    — dynamic import for lazy DI from `../gsd/lock.js`
 *   - `handleOrchestratorStop` (orchestrator branch) — dynamic import lazy
 *
 * Razón: lazy DI difiere la carga del módulo hasta call-time del hook, evitando que
 * `gsd/lock.js` o `session/manager.js` entren al module-load graph de `stop.js`. Esto
 * mantiene `stop.js` ligero al import-time (relevante para tests Phase 16 LOG-13/14/15
 * que importan `runStopHook` sin requerir `gsd/lock.js` en su grafo).
 *
 * Refactor a DI explícito requiere ampliar la signature `deps` (breaking change para
 * tests Phase 16) — diferido a v0.7+. Esta nota cierra DEBT-06 IN-01 por documentación
 * (D-02b Phase 22 CONTEXT.md: documentar > refactor cuando el refactor implica breaking).
 */
export async function runStopHook(input, deps = {}) {
  // W-4: defaults vía OR — runtime productivo usa los imports estáticos.
  // Phase 72 HYG-04: `deps.cmux` ya NO se consume en runStopHook (los efectos
  // cmux migraron a SessionEnd); se acepta en la firma por compatibilidad con
  // los tests existentes que aún lo inyectan.
  const findSessionFn = deps.findSessionFn || findSession;
  try {
    const sessionId = input.session_id;
    const cwd = input.cwd || process.cwd();

    // KODO-27 — lookup por IDENTIDAD, sin fallback por cwd. Stop muta state.json
    // (markSessionStatus) y libera el lock GSD: es camino de ESCRITURA, así que ante
    // un `session_id` desconocido hace no-op en vez de adivinar.
    //
    // El fallback por cwd que había aquí comparaba `input.cwd` contra
    // `session.project_path` y devolvía la primera coincidencia. Nunca acertaba por
    // mérito propio: una sesión lanzada por kodo corre en su worktree
    // (`<repo>/.claude/worktrees/<sid>`), NO en `project_path`, así que jamás se
    // matchea a sí misma por esa vía — sólo matcheaba sesiones AJENAS lanzadas en la
    // raíz del repo (el orquestador, una sesión ad-hoc, un subagente), y les imputaba
    // el cierre a una tarea viva. El 20-ago a las 13:23 eso marcó KODO-26 idle, le
    // escribió un handoff automático falso y la movió a review 8 s después de
    // arrancar, con el agente todavía ejecutando herramientas.
    //
    // Fail-closed a propósito: un cierre perdido se recupera (el reconcile ve el
    // proceso muerto); un cierre imputado a la sesión equivocada, no. Esto NO cambia
    // el camino de una sola sesión por repo — kodo genera el UUID en el dispatcher y
    // lo pasa a Claude Code con `--session-id`, así que el match por identidad es el
    // que ya resolvía en producción.
    console.error(`[kodo:stop] Looking for session: sessionId=${sessionId}`);
    let result = findSessionFn({ sessionId });

    if (!result) {
      console.error(`[kodo:stop] No matching session found`);
      // KODO-27: traza del no-op — sólo si había sesiones vivas en este cwd, o sea
      // si el fallback de antes habría cerrado una tarea ajena. Never-throws.
      await traceUnmatchedClose({ hook: 'stop', sessionId, cwd }, deps);
      // Check if this is the orchestrator session (cwd = kodo repo)
      const isOrchestratorSession = cwd && (
        cwd === KODO_ROOT ||
        cwd.startsWith(KODO_ROOT + '/')
      );
      if (isOrchestratorSession) {
        await handleOrchestratorStop(input);
      }
      return;
    }

    // Phase 30 LIFE-01 CR-01: findSession ahora escanea state.history. El stop
    // hook NO debe re-procesar sesiones archivadas — el primer trigger ya hizo
    // cleanup. Re-procesar emite eventos duplicados (state.transition, session.end,
    // segundo nudge) y puede tocar workspaces reasignados o worktrees ya removidos.
    if (result && result.source === 'history') {
      console.error(`[kodo:stop] Session ${result.session.task_ref} already archived — skip`);
      return;
    }

    const { session } = result;

    // Phase 72 HYG-04: los efectos de cierre COSMÉTICOS (setColor review, notify
    // "cerrada", nudge al orquestador) se MOVIERON a runSessionEndHook — disparan
    // UNA vez al cierre real, no al final de cada turno. Stop conserva SOLO el
    // estado ligero: markSessionStatus('idle') + releaseGsdLock. La sesión sigue
    // "viva" en el dashboard entre turnos; el cierre real (SessionEnd) hace el
    // resto.

    // Phase 19 CR-02 fix: markSessionStatus aplica a TODAS las sesiones (GSD + no-GSD)
    // para que el observable NDJSON refleje el estado real per-turn (idle/lock-released).
    // REVIEW.md CR-02 + WR-03 mandatan console.error (no silent) porque markSessionStatus
    // muta state.json — un fallo merece diagnóstico explícito. Phase 58 LIFE-03: el typed
    // session.end event migró a SessionEnd; aquí el logger sirve a markSessionStatus (y al
    // nudge). El mark aplica a todas las sesiones (antes dentro de if (session.gsd)).
    const log = (deps && deps.loggerFactory)
      ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          return createLogger({
            sessionId: session.session_id,
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook', task_id: session.task_id });
        })();

    try {
      const { markSessionStatus } = await import('../session/manager.js');
      // Phase 33-03 LIFE-02-FOLLOWUP: consumir el return discriminado (D-05) en vez
      // de descartarlo. Si ok === false (task_id falsy → 'missing-task-id'), emitir
      // warn observable y continuar — log+continue simétrico con verify.js (D-01).
      // Optional chaining defensivo; producción siempre retorna el union. Vive DENTRO
      // del try WR-03 existente; markSessionStatus es non-throwing por contrato.
      const markResult = markSessionStatus(session.task_id, 'idle', 'session-stop:lock-released', log, session.session_id);
      if (!markResult?.ok) {
        log.warn('markSessionStatus.skipped', {
          reason: markResult?.reason,
          session_id: session.session_id,
        });
      }
    } catch (err) {
      // WR-03: state.json mutation failure merits explicit diagnostic (NOT silent).
      // Still fail-open — runStopHook never crashes Claude Code.
      console.error(`[kodo:stop] markSessionStatus failed: ${/** @type {Error} */ (err).message}`);
    }

    // KODO-30: sellar la rama MIENTRAS el worktree existe. Va aquí, en el carril ligero
    // per-turn, porque es el único momento del ciclo en el que el directorio está vivo
    // garantizado: al cerrar (`SessionEnd`) Claude Code ya puede haberlo borrado, y
    // entonces ni el cleanup ni la cola de integración pueden averiguar qué rama era.
    // Never-throws por contrato — no necesita try/catch aquí.
    await persistSessionBranch(session, { gitFn: deps.gitFn, existsFn: deps.existsFn, logger: log });

    // Phase 58 LIFE-03: el typed session.end event (status done) se MOVIÓ al hook
    // SessionEnd (src/hooks/session-end.js) — refleja el cierre REAL una vez, no el
    // fin de cada turno. Stop ya no lo emite (antes disparaba per-turn).

    // Release GSD lock if applicable (D-09: idempotent, verifies session_id).
    // Phase 19 CR-02: markSessionStatus ya corrió ANTES de este bloque para
    // todas las sesiones; aquí solo queda el lock release para sesiones GSD.
    if (session.gsd) {
      try {
        const { releaseGsdLock } = await import('../gsd/lock.js');
        releaseGsdLock(session.project_path, session.session_id);
      } catch (err) {
        console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
      }
    }

    // Phase 58 LIFE-03: el cleanup terminal DESTRUCTIVO (worktree cleanup +
    // removePromptFile + removeSession) se MOVIÓ al hook SessionEnd
    // (src/hooks/session-end.js → performTerminalCleanup). Stop dispara al final de
    // CADA turno y ya NO archiva la sesión: solo deja el estado ligero (idle, lock
    // liberado, color review, nudge). Así una sesión en review/needs-input permanece
    // viva en el dashboard entre turnos sin depender del rescate desde history de
    // reconcileTick; el cleanup terminal ocurre UNA vez al cierre real (`/exit`).

    // Phase 72 HYG-04: el nudge al orquestador (buildStopNudgeText) se MOVIÓ a
    // runSessionEndHook — dispara al cierre real, no por turno. buildStopNudgeText
    // permanece EXPORTADA aquí (la importan tests y ahora session-end.js).

    // Session stays in state with status "review" — orchestrator or human removes it after approval
  } catch (err) {
    console.error(`[kodo] Stop hook error: ${err.message}`);
  }
}

async function main() {
  const input = JSON.parse(await readStdin());
  await runStopHook(input);
  // Preserve the historical exit semantics — main() always exits 0 (the hook
  // must not crash Claude Code). runStopHook ya envuelve su cuerpo en try/catch
  // top-level que silencia errores. El branch `no session found + orchestrator`
  // ahora retorna en lugar de process.exit(0); main() simplemente termina.
  process.exit(0);
}

/**
 * Vigilancia del TAMAÑO del transcript del orquestador (KODO-67).
 *
 * Separada de `handleOrchestratorStop` a propósito: aquella está detrás del gate
 * `KODO_ORCHESTRATOR=1` porque hace un COMMIT (un efecto destructivo que jamás debe
 * dispararse en la sesión de un dev que casualmente trabaja en el repo kodo). Ésta solo
 * MIDE un fichero y, como mucho, encola un aviso en una bandeja — así que compartir el
 * gate del commit no aporta seguridad, pero sí perdería la medición en cualquier
 * orquestador lanzado antes de que la env var existiera.
 *
 * Aun así se aplica el MISMO gate, y la razón es distinta: sin él, la sesión de un dev en
 * el repo kodo cuyo transcript pase de 8 MB encolaría en la bandeja del operador un aviso
 * de reciclar un orquestador que no es ella. Un evento falso en la bandeja no rompe nada,
 * pero la bandeja existe justo para no tener ruido.
 *
 * NEVER-THROWS. El import es dinámico por el mismo patrón de lazy DI del resto del hook:
 * `orchestrator/recycle.js` arrastra `session/state.js` (locks, I/O) y `stop.js` debe
 * seguir siendo barato de importar.
 *
 * @param {{ transcript_path?: string }} input - input crudo del hook Stop.
 * @returns {Promise<void>}
 */
async function checkOrchestratorRecycle(input) {
  if (process.env.KODO_ORCHESTRATOR !== '1') return;
  if (!input?.transcript_path) return;
  try {
    const [{ maybeSuggestRecycle }, { loadConfig }] = await Promise.all([
      import('../orchestrator/recycle.js'),
      import('../config.js'),
    ]);
    const r = maybeSuggestRecycle({ transcriptPath: input.transcript_path, config: loadConfig() });
    if (r.suggested) {
      console.error(
        `[kodo] Transcript del orquestador en ${(Number(r.bytes) / (1024 * 1024)).toFixed(1)} MB — ` +
          'reciclado sugerido (evento en la bandeja)',
      );
    }
  } catch (err) {
    console.error(`[kodo] Stop: no se pudo evaluar el reciclado — ${/** @type {Error} */ (err).message}`);
  }
}

/**
 * Called when the orchestrator session ends.
 * Auto-commits any pending changes in .claude/skills/ to preserve learnings.
 *
 * KODO-67: además evalúa si el transcript ha cruzado `orchestrator.recycle_mb`. Se hace
 * ANTES del gate del auto-commit y de su `try`, para que ninguno de los dos caminos de
 * salida temprana de aquel (sin marcador, sin cambios en la skill) se lleve por delante la
 * medición — son dos preguntas independientes que casualmente comparten disparador.
 *
 * @param {{ transcript_path?: string }} [input] - input crudo del hook Stop.
 */
async function handleOrchestratorStop(input = {}) {
  await checkOrchestratorRecycle(input);

  // HYG-01 gate (D-06): el auto-commit SOLO corre en la sesión orquestadora,
  // marcada con la env var inyectada al lanzar el workspace (launch.js). Sin el
  // marcador, una sesión normal del dev en el repo kodo NO debe commitear nada
  // (evita commits fantasma que arrastren lo que el dev tuviera staged). Espejo
  // del early-return-con-log de session-end.js. Skip silencioso con log, NO error.
  // El gate cubre TODO el bloque add+commit de abajo.
  if (process.env.KODO_ORCHESTRATOR !== '1') {
    console.error('[kodo] Stop: no es sesión orquestadora (marcador ausente) — skip auto-commit');
    return;
  }

  const { execSync } = await import('node:child_process');

  try {
    // Check if there are uncommitted changes in the orchestrator skill subdir.
    // HYG-01 (D-07): se consulta el MISMO subdirectorio que el pathspec del
    // commit, para que el "no changes to commit" sea coherente con lo que se
    // commitea (no el árbol entero de .claude/skills/).
    const status = execSync('git status --porcelain .claude/skills/kodo-orchestrate/', {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    }).trim();

    if (!status) {
      console.error('[kodo] Orchestrator session ended — no skill changes to commit');
      return;
    }

    // Auto-commit skill changes.
    // `-c commit.gpgsign=false` evita cuelgues si el dev tiene firma GPG global
    // sin TTY (gpg-agent bloquearía pidiendo passphrase) y no firma commits
    // generados por LLM con la clave personal del dev (WR-01 999.1-REVIEW).
    const date = new Date().toISOString().slice(0, 10);
    // HYG-01 (D-07): pathspec restringido al subdirectorio de la skill en AMBOS
    // pasos (add Y commit) — nunca al árbol entero de .claude/skills/. Así el
    // commit jamás arrastra otros cambios staged que el dev tuviera pendientes.
    execSync(`git -c commit.gpgsign=false add -- .claude/skills/kodo-orchestrate/ && git -c commit.gpgsign=false commit -m "skill: orchestrator learnings ${date}" -- .claude/skills/kodo-orchestrate/`, {
      cwd: KODO_ROOT,
      encoding: 'utf-8',
    });

    console.error('[kodo] Orchestrator skill changes auto-committed');

    // KODO-18: aviso por el host ACTIVO. En orca `notify` es un no-op documentado (su
    // CLI no expone notificaciones de SO), así que el aviso queda en el `console.error`
    // de arriba — el auto-commit en sí no depende de esto.
    await getHost(resolveHostName())._legacy.notify({
      title: 'kodo: skill actualizado',
      body: `Aprendizajes del orquestador guardados (${date})`,
    });
  } catch (err) {
    console.error(`[kodo] Error auto-committing skill: ${err.message}`);
  }
}

// Only run main() when invoked as CLI (not when imported for testing)
const isMainEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainEntry) {
  main();
}
