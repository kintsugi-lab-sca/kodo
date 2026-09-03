// @ts-check
//
// src/cli/audit.js — KODO-74: handler de `kodo audit`.
//
// UN carril, un comando: `kodo audit [ref] [--json]`. No hay subcomandos y no hay flags de
// acción, a diferencia de `oracle` y `review`, porque aquí no hay dos sujetos — hay UNO (la
// sesión que va a entregar) haciendo UNA cosa (pasar el gate), y lo que cambia entre la primera
// y la segunda invocación no lo decide quien teclea: lo decide el estado del reto.
//
// POR QUÉ ES UN COMANDO Y NO UN HOOK. El gate necesita que alguien haga una segunda pasada, así
// que necesita que haya alguien. Cuando corre `SessionEnd` la sesión YA cerró: no hay a quién
// pedirle nada, y un `AUDIT_REQUIRED` impreso ahí no lo lee nadie. Por eso esto es un paso
// EXPLÍCITO previo al `/exit` que el prompt de sesión ya prescribe, y por eso el hook de cierre
// solo LEE lo que este comando dejó escrito.
//
// Invariante de retorno (precedente `inbox.js` / `integrate.js` / `oracle.js`): este handler
// NUNCA invoca el helper de salida del runtime — RETORNA el código.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de color
// directamente — solo `createFormatter`.
//
// LO QUE ESTE COMANDO NO HACE, POR CONTRATO:
//   - NO commitea, NO hace push, NO toca la rama ni el árbol de trabajo. Solo LEE git.
//   - NO escribe el artefacto de auditoría por ti. Lo escribe quien audita; si lo escribiera
//     kodo, el gate volvería a ser un doble tecleo con pasos extra.
//   - NO encola nada. La cola la escribe el hook de cierre; esto deja el veredicto listo.
//   - NO bloquea el cierre de la sesión. Sin este comando, el trabajo se encola igual —
//     marcado como SIN AUDITAR, que es la verdad.
//
// Exit codes (contrato del repo, `cli/exit-codes.js`):
//   0  el reto está cerrado: el trabajo se encolará como AUDITADO
//   1  no se pudo determinar nada (git mudo, fuera de un repo) o el reto no se pudo persistir
//   2  AUDIT_REQUIRED — hay un reto abierto y el gate NO está satisfecho

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { KODO_DIR } from '../config.js';
import {
  AUDITS_DIR,
  auditArtifactName,
  closeAuditChallenge,
  computeFingerprint,
  decideAudit,
  hashWorkingTree,
  openAuditChallenge,
  readAuditGate,
  renderAuditRequired,
  shortFingerprint,
} from '../integration/audit.js';
import { isSafeTaskId } from '../session/handoff.js';
import { loadState } from '../session/state.js';
import { EXIT_ERROR, EXIT_SUCCESS, EXIT_USAGE } from './exit-codes.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/**
 * @typedef {{
 *   gitFn?: (cwd: string, args: string[]) => Promise<string>|string,
 *   cwdFn?: () => string,
 *   loadStateFn?: typeof loadState,
 *   readGateFn?: typeof readAuditGate,
 *   openGateFn?: typeof openAuditChallenge,
 *   closeGateFn?: typeof closeAuditChallenge,
 *   readArtifactFn?: (path: string) => string|null,
 *   mkdirFn?: (path: string, opts: { recursive: boolean }) => unknown,
 *   loggerFn?: () => any,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   nowFn?: () => Date,
 * }} AuditDeps
 */

/**
 * `gitFn` de producción, calcado del de `cli/oracle.js` y `cli/integrate.js`: stdout trimeado,
 * LANZA si el exit code no es 0, y los argumentos SIEMPRE como array a `execFileSync` — nunca
 * hay un shell de por medio, así que un nombre de rama con metacaracteres no puede ejecutar
 * nada.
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
 * Lee un fichero de texto, o `null`. Never-throws — un artefacto que no existe todavía es el
 * caso NORMAL (es justo lo que el reto pide escribir), no un error.
 *
 * @param {string} path
 * @returns {string|null}
 */
function defaultReadArtifact(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Los hechos que git sabe del candidato, leídos desde el directorio de trabajo de la sesión.
 *
 * `--git-common-dir` es lo que hace que esto funcione DENTRO de un worktree y fuera de él con la
 * misma línea: en un worktree devuelve el `.git` del repo PRINCIPAL, que es exactamente el
 * `project_path` con el que la cola identifica una entrada. Derivarlo del layout
 * (`<project>/.claude/worktrees/<sid>`) habría atado el comando a una convención que ya cambió
 * una vez en este repo (`.bg-shell` → `.claude/worktrees`, KODO-30).
 *
 * `status --porcelain` entra en el fingerprint HASHEADO, nunca crudo: el árbol sucio forma parte
 * del candidato (uno de los criterios de la auto-revisión es mirarlo), pero su contenido no
 * tiene por qué acabar en state.json.
 *
 * `--show-toplevel` viaja al lado por un motivo que se cobró en la primera prueba de campo: git
 * RESUELVE los symlinks y `state.json` no. Un repo alcanzado por `/var/…` se lee aquí como
 * `/private/var/…`, y comparar esos dos strings por igualdad da `false` aunque sean el mismo
 * sitio. Se guardan los dos para que la resolución de sesión pueda probar ambos.
 *
 * NEVER-THROWS: cualquier fallo devuelve el campo en `null` y el caller decide. Solo `branch` y
 * uno de los dos paths son imprescindibles.
 *
 * @param {{ cwd: string, gitFn: (cwd: string, args: string[]) => Promise<string>|string }} args
 * @returns {Promise<{ project: string|null, toplevel: string|null, branch: string|null, head: string|null, dirty: string|null }>}
 */
export async function readGitFacts({ cwd, gitFn }) {
  const ask = async (/** @type {string[]} */ argv) => {
    try {
      return String(await gitFn(cwd, argv)).trim();
    } catch {
      return '';
    }
  };
  const commonDir = await ask(['rev-parse', '--path-format=absolute', '--git-common-dir']);
  // `<repo>/.git` → `<repo>`. Un repo bare no tiene árbol de trabajo, así que no puede ser el
  // cwd de una sesión y no hace falta contemplarlo.
  const project = commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : null;
  const toplevel = (await ask(['rev-parse', '--show-toplevel'])) || null;
  const branch = (await ask(['branch', '--show-current'])) || null;
  const head = (await ask(['rev-parse', 'HEAD'])) || null;
  const dirty = hashWorkingTree(await ask(['status', '--porcelain']));
  return { project, toplevel, branch, head, dirty };
}

/**
 * Encuentra la sesión de kodo a la que pertenece este candidato, para sacarle `task_id`,
 * `task_ref` y `base_commit`.
 *
 * UNIQUE-OR-NULL, la misma disciplina de KODO-27: un fallback ambiguo NO responde. Aquí las
 * consecuencias de acertar mal son menores que en un hook de cierre (se degradaría el nombre del
 * artefacto y el `task_ref` de una línea de pantalla, no se corrompería estado ajeno), pero la
 * regla es la del repo y no hay razón para tener dos.
 *
 * Cascada, ESTRICTAMENTE de más específica a menos. El orden no es cosmético — se cobró en el
 * primer uso real: cinco sesiones vivas compartían el mismo `project_path` (un repo con varias
 * tareas en vuelo es lo NORMAL en kodo), así que un `project_path` no identifica nada. Un
 * `worktree_path` sí: es de una sola sesión por construcción.
 *
 *   1. `ref` explícito (`kodo audit KODO-74`) — el desempate que el operador teclea.
 *   2. WORKTREE: `worktree_path` igual a lo que git reporta como raíz. Un worktree pertenece a
 *      UNA sesión, así que esto es identidad, no heurística.
 *   3. RAMA. También es de una sola sesión, pero llega después porque `session.branch` lo sella
 *      el hook Stop y puede no estar todavía.
 *   4. REPO: `project_path`, y solo si hay UNA sesión en él. Es el fallback honesto para las
 *      sesiones adoptadas, que trabajan en el repo principal sin worktree propio, y para el
 *      repo alcanzado por un symlink (git resuelve `/var` → `/private/var` y `state.json` no)
 *      — que no se arregla con un `realpath` aquí porque eso introduciría una TERCERA
 *      definición de «mismo repo»: el repo ya tiene dos, `entryKey` y `listSessionsForPath`, y
 *      las dos son igualdad exacta. Un desacuerdo entre ellas sería peor que un fallback que a
 *      veces no responde.
 *
 * `null` no es un error: el gate sigue funcionando con la evidencia de commit, que no necesita
 * saber nada de la tarea. Lo que se pierde es el artefacto (no hay dónde firmar el «sin
 * hallazgos») y la garantía de que el veredicto llegue a la cola bajo la misma clave — y las dos
 * cosas se DICEN por stderr, no se esconden.
 *
 * @param {{ project?: string|null, toplevel?: string|null, branch?: string|null, ref?: string|null, loadStateFn?: typeof loadState }} args
 * @returns {import('../session/state.js').Session|null}
 */
export function resolveSession({ project, toplevel, branch, ref, loadStateFn }) {
  const load = loadStateFn || loadState;
  /** @type {import('../session/state.js').Session[]} */
  let sessions;
  try {
    sessions = Object.values(load().sessions || {}).filter(Boolean);
  } catch {
    return null;
  }
  if (sessions.length === 0) return null;

  /** Unique-or-null: la disciplina de KODO-27 aplicada a cada peldaño. */
  const unique = (/** @type {import('../session/state.js').Session[]} */ hits) => (hits.length === 1 ? hits[0] : null);

  if (ref) return unique(sessions.filter((s) => s.task_ref === ref || s.task_id === ref));

  const paths = new Set([project, toplevel].filter(Boolean));
  const byWorktree = unique(sessions.filter((s) => s.worktree_path && paths.has(s.worktree_path)));
  if (byWorktree) return byWorktree;

  const byBranch = branch ? unique(sessions.filter((s) => s.branch === branch)) : null;
  if (byBranch) return byBranch;

  return unique(sessions.filter((s) => paths.has(s.project_path)));
}

/**
 * Ruta ABSOLUTA del artefacto de auditoría, o `null` cuando no hay ninguna segura que construir.
 *
 * `isSafeTaskId` es el guard CANÓNICO del repo para componer una ruta a partir de un `task_id`
 * (el mismo que usa `session-end.js` para el fichero de plan). Un `task_id` que no lo pasa NO
 * cae a «sin artefacto»: cae al nombre derivado del fingerprint, que es 12 hex y por tanto
 * seguro por construcción. Perder el artefacto por un id raro haría el gate más difícil de
 * satisfacer justo en el caso en que menos culpa tiene la sesión.
 *
 * @param {{ taskId?: string|null, fingerprint: string }} args
 * @returns {string}
 */
export function auditArtifactPath({ taskId, fingerprint }) {
  const safe = isSafeTaskId(taskId) ? taskId : null;
  return join(KODO_DIR, AUDITS_DIR, auditArtifactName({ taskId: safe, fingerprint }));
}

/**
 * El audit gate: abre el reto, o lo cierra si el segundo intento trae evidencia.
 *
 * @param {string|null|undefined} ref Desempate opcional (`task_ref` o `task_id`).
 * @param {{ json?: boolean }} opts
 * @param {AuditDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runAuditCli(ref, opts = {}, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const git = deps.gitFn || defaultGit;
  const cwd = (deps.cwdFn || (() => process.cwd()))();
  const clock = deps.nowFn || (() => new Date());
  const readGate = deps.readGateFn || readAuditGate;
  const openGate = deps.openGateFn || openAuditChallenge;
  const closeGate = deps.closeGateFn || closeAuditChallenge;
  const readArtifact = deps.readArtifactFn || defaultReadArtifact;
  const logger = deps.loggerFn ? deps.loggerFn() : muteLogger();

  const facts = await readGitFacts({ cwd, gitFn: git });
  if ((!facts.project && !facts.toplevel) || !facts.branch) {
    // Sin repo o en detached HEAD no hay candidato que retar, y tampoco habrá entrada en la
    // cola: la captura salta por el mismo motivo (`reason: 'detached'`). Se dice y se sale.
    err('[kodo:audit] no hay rama que auditar aquí (¿fuera de un repo, o detached HEAD?)\n');
    return EXIT_ERROR;
  }
  const branch = facts.branch;

  const session = resolveSession({
    project: facts.project,
    toplevel: facts.toplevel,
    branch,
    ref: typeof ref === 'string' && ref.trim() !== '' ? ref.trim() : null,
    loadStateFn: deps.loadStateFn,
  });

  // LA CLAVE DEL RETO SALE DE LA SESIÓN cuando la hay, y no de git. No es un detalle: la captura
  // de integración guarda la entrada bajo `session.project_path`, así que si aquí se guardara la
  // forma resuelta por git (`/private/var/…` donde el estado dice `/var/…`), el reto y la
  // entrada vivirían bajo claves distintas y el veredicto no llegaría nunca a la cola. Sin
  // sesión no hay con qué acordar, y se usa lo que git diga.
  const project = /** @type {string} */ (session?.project_path || facts.project || facts.toplevel);
  const taskRef = session?.task_ref || branch;
  const taskId = session?.task_id ?? null;
  const baseCommit = session?.base_commit ?? null;

  if (!session) {
    // No es un error —el gate funciona igual con evidencia de commit— pero SÍ es una degradación
    // que el operador tiene que ver: sin sesión no hay artefacto donde firmar el «sin hallazgos»
    // y el veredicto podría no aterrizar en la cola. Callarlo sería fingir que todo va bien.
    err(`[kodo:audit] esta rama no se pudo asociar a ninguna sesión de kodo — el reto se abre igual, pero el veredicto podría no llegar a la cola (prueba \`kodo audit <ref>\`)\n`);
  }

  const gate = readGate({ project_path: project, branch });
  // El artefacto se lee contra el fingerprint del reto ABIERTO, no contra uno recalculado: es
  // ese reto el que el agente firmó. Sin reto abierto no hay nada que leer.
  const artifactPath = gate ? auditArtifactPath({ taskId, fingerprint: gate.fingerprint }) : null;
  const decision = decideAudit({
    gate,
    head: facts.head,
    artifactMd: artifactPath ? readArtifact(artifactPath) : null,
  });

  const fmt = deps.formatterFn ? deps.formatterFn() : createFormatter(process.stdout);
  const emit = (/** @type {any} */ payload) => {
    if (opts.json === true) write(JSON.stringify(payload) + '\n');
  };

  // ── Ya auditado y la rama no se ha movido: idempotente. ──────────────────────────────
  if (decision.action === 'already-audited') {
    const g = /** @type {import('../integration/audit.js').AuditGate} */ (gate);
    if (opts.json === true) {
      emit({ ok: true, action: 'already-audited', task_ref: taskRef, branch, project_path: project, audit: g });
    } else {
      write(`${fmt.ok(`${stripControlChars(taskRef)}: ya auditado`)} ${describeAudit(g)}\n`);
    }
    return EXIT_SUCCESS;
  }

  // ── Hay evidencia: se cierra el reto. ────────────────────────────────────────────────
  if (decision.action === 'audited') {
    const closed = closeGate(
      { project_path: project, branch },
      { evidence: decision.evidence, findings: decision.findings, commit: facts.head },
      logger,
      { now: clock },
    );
    if (!closed.ok) {
      // La auditoría SÍ ocurrió pero su registro no. Se dice y se sale con 1: devolver 0
      // dejaría a la sesión creyendo que va a encolar como auditado cuando no es así.
      err(`[kodo:audit] el reto se satisfizo pero no se pudo persistir (${closed.reason})\n`);
      emit({ ok: false, action: 'audited', task_ref: taskRef, branch, project_path: project, audit: null });
      return EXIT_ERROR;
    }
    if (opts.json === true) {
      emit({ ok: true, action: 'audited', task_ref: taskRef, branch, project_path: project, audit: closed.value });
    } else {
      write(`${fmt.ok(`${stripControlChars(taskRef)}: auditado`)} ${describeAudit(closed.value)}\n`);
    }
    return EXIT_SUCCESS;
  }

  // ── No hay evidencia: se reta (o se vuelve a retar). ─────────────────────────────────
  //
  // El fingerprint se REUSA en un `rechallenge` y se RECALCULA en un reto nuevo. La diferencia
  // decide si el gate es satisfacible: si rotara en cada re-reto, el artefacto que el agente
  // acaba de escribir para el reto anterior dejaría de valer justo al presentarlo, porque
  // cualquier edición del árbol de trabajo mueve el fingerprint.
  const fingerprint = decision.action === 'rechallenge' && gate
    ? gate.fingerprint
    : computeFingerprint({
      session_id: session?.session_id ?? null,
      task_id: taskId,
      task_ref: taskRef,
      project_path: project,
      branch,
      head: facts.head,
      base_commit: baseCommit,
      dirty: facts.dirty,
    });

  const opened = openGate(
    {
      project_path: project,
      branch,
      fingerprint,
      // El commit del reto es la punta de AHORA en un reto nuevo, y la del reto original en un
      // re-reto: es el listón contra el que se mide «commit nuevo», y moverlo en cada
      // invocación lo volvería inalcanzable.
      challenge_commit: decision.action === 'rechallenge' && gate ? gate.challenge_commit : facts.head,
      base_commit: baseCommit,
    },
    logger,
    { now: clock },
  );
  if (!opened.ok) {
    err(`[kodo:audit] no se pudo abrir el reto de auditoría (${opened.reason})\n`);
    emit({ ok: false, action: 'challenge', task_ref: taskRef, branch, project_path: project, audit: null });
    return EXIT_ERROR;
  }

  const path = auditArtifactPath({ taskId, fingerprint });
  // El directorio se crea al EMITIR el reto, no al leerlo: el texto que sigue manda a escribir
  // en él, y hacer que esa instrucción falle por un directorio ausente sería poner una piedra
  // en el único camino que el gate ofrece para el «sin hallazgos». Fail-open — si no se puede
  // crear, el reto se emite igual y quien escriba el artefacto lo creará.
  if (session) ensureDir(path, deps);
  if (opts.json === true) {
    emit({
      ok: true,
      action: decision.action,
      task_ref: taskRef,
      branch,
      project_path: project,
      artifact_path: session ? path : null,
      audit: opened.value,
    });
    return EXIT_USAGE;
  }

  write(renderAuditRequired({
    taskRef: stripControlChars(taskRef),
    branch: stripControlChars(branch),
    fingerprint,
    count: opened.value.count,
    // §2.5 cobrando: con la base del worktree persistida al arrancar, el reto nombra el rango de
    // diff EXACTO en vez de mandar a adivinarlo.
    base: baseCommit,
    // Sin sesión registrada no hay `task_id`, y el nombre por fingerprint seguiría siendo
    // válido — pero apuntar a un artefacto que nadie va a asociar con ninguna tarea es peor
    // que decir que esa vía no está disponible. Se ofrece SOLO cuando hay tarea.
    artifactPath: session ? path : null,
    at: clock().toISOString(),
  }) + '\n');
  return EXIT_USAGE;
}

/**
 * Crea el directorio del artefacto. Never-throws — es una conveniencia, no una precondición.
 *
 * @param {string} artifactPath Ruta COMPLETA del fichero; se crea su directorio padre.
 * @param {AuditDeps} deps
 */
function ensureDir(artifactPath, deps) {
  try {
    (deps.mkdirFn || mkdirSync)(dirname(artifactPath), { recursive: true });
  } catch { /* fail-open: el reto se emite igual */ }
}

/**
 * Resumen de una línea de un reto cerrado. PURA.
 *
 * @param {import('../integration/audit.js').AuditGate} g
 * @returns {string}
 */
export function describeAudit(g) {
  const parts = [`reto ${g.count}`];
  parts.push(g.evidence === 'artifact' ? 'evidencia: artefacto' : 'evidencia: commit nuevo');
  if (typeof g.findings === 'number') {
    parts.push(g.findings === 0 ? 'sin hallazgos (firmado)' : `${g.findings} hallazgo(s)`);
  }
  const anchor = g.commit ? ` @ ${String(g.commit).slice(0, 8)}` : '';
  return `(${parts.join(', ')}) fp=${shortFingerprint(g.fingerprint)}${anchor}`;
}

/**
 * Logger MUDO. El registro del gate es auditoría, no una precondición: perder la línea no puede
 * impedir que el reto se abra o se cierre. Mismo criterio (y mismo shape) que en
 * `cli/oracle.js` y `cli/integrate.js`.
 *
 * @returns {any}
 */
function muteLogger() {
  /** @type {any} */
  const mute = { info() {}, warn() {}, error() {}, debug() {}, child() { return mute; } };
  return mute;
}
