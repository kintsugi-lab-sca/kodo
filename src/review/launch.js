// @ts-check
//
// src/review/launch.js — KODO-75: la SEGUNDA sesión, la del reviewer.
//
// LA TOPOLOGÍA, Y POR QUÉ ES SECUENCIAL. El criterio de aceptación dice «una tarea etiquetada
// para revisión produce, TRAS la sesión de trabajo, una sesión de revisión sobre la misma
// rama». Ese «tras» es la decisión de diseño que abarata el milestone entero: coder cierra →
// reviewer arranca. No hay dos sesiones vivas a la vez sobre la misma tarea, así que
// `state.sessions` —que keyea por `task_id`— no necesita rediseño: la fila del coder ya la
// liberó `removeSession` en SessionEnd cuando el reviewer va a existir.
//
// EL LÍMITE, dicho en voz alta: si algún día hacen falta coder y reviewer VIVOS a la vez
// (revisión incremental mientras se trabaja), esto no basta y hay que tocar el modelo de
// estado. No es el caso que pide el criterio, y adelantarlo sería pagar la parte cara sin
// necesitarla todavía.
//
// ─── EL WORKTREE: por qué NO `claude --worktree` ────────────────────────────────────────
//
// Toda sesión de trabajo de kodo se aísla con `claude --worktree <sid>`, que crea un worktree
// Y UNA RAMA NUEVA. Para un reviewer eso es exactamente lo contrario de lo que hace falta: su
// trabajo entero consiste en mirar —y anotar sobre— la rama que el coder dejó. Una rama nueva
// dejaría los artefactos donde nadie los va a leer y el `reviewedHead` apuntando a otra
// historia.
//
// Así que el worktree lo provisiona kodo: `git worktree add <path> <branch>` hace CHECKOUT de
// la rama existente. Git impide por su cuenta que dos worktrees tengan la misma rama a la vez,
// lo cual aquí es una red de seguridad gratis: si el worktree del coder sigue vivo, el
// comando falla con un mensaje claro en vez de dejar dos sesiones pisándose.
//
// ─── EL MARCADOR `KODO_REVIEWER=1` ──────────────────────────────────────────────────────
//
// Va como prefijo de entorno de la línea que se teclea en el workspace, exactamente igual que
// `KODO_ORCHESTRATOR=1` en `orchestrator/launch.js`. El shell lo exporta al proceso del agente
// y a sus hijos, que es lo que permite a `kodo review commit` (ejecutado DENTRO de esa sesión)
// pasar el gate de `review/guard.js`. Ninguna otra sesión lo trae, así que ninguna otra puede
// commitear artefactos de revisión aunque llame a la función.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripControlChars, stripForKeystroke } from '../cli/sanitize.js';
import { getAgentDef } from '../config.js';
import { REVIEW_PATHSPEC } from './artifacts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Plantilla del rol reviewer. Hermana de `orchestrator/prompt.md`. */
const PROMPT_PATH = join(__dirname, 'prompt.md');

/**
 * Prefijo del directorio del worktree de revisión.
 *
 * Vive bajo `.claude/worktrees/` —el mismo sitio que los worktrees de las sesiones de
 * trabajo— para que el cleanup, el `.gitignore` y la vista del dashboard no necesiten conocer
 * un segundo lugar. El prefijo `review-` lo distingue del `<sessionId>` pelado de una sesión
 * de trabajo, que es lo que permite barrerlos por separado sin tocar los del coder.
 */
export const REVIEW_WORKTREE_PREFIX = 'review-';

/**
 * Path determinístico del worktree de revisión. PURA — no crea nada.
 *
 * Determinístico por la misma razón que `computeRealWorktreePath` (session/state.js): el
 * cleanup tiene que poder derivar el path sin leer estado, porque el estado es justo lo que
 * puede haberse perdido cuando hace falta limpiar.
 *
 * @param {string} projectPath
 * @param {string} sessionId
 * @returns {string}
 */
export function computeReviewWorktreePath(projectPath, sessionId) {
  return join(projectPath, '.claude', 'worktrees', `${REVIEW_WORKTREE_PREFIX}${sessionId}`);
}

/**
 * Materializa el worktree de revisión sobre la rama EXISTENTE.
 *
 * NEVER-THROWS: devuelve una unión discriminada. El caso `branch-busy` merece su propia razón
 * porque es el único fallo esperable en operación normal —el worktree del coder todavía
 * vivo— y el operador necesita distinguirlo de «git está roto»: la acción correcta es esperar
 * a que la sesión de trabajo cierre, no diagnosticar nada.
 *
 * @param {{ projectPath: string, branch: string, sessionId: string }} params
 * @param {{ gitFn?: (cwd: string, args: string[]) => string, existsFn?: typeof existsSync }} [deps]
 * @returns {{ ok: true, path: string, created: boolean }
 *          | { ok: false, reason: 'branch-busy'|'git-failed'|'bad-input', detail?: string }}
 */
export function provisionReviewWorktree(params, deps = {}) {
  const gitFn = deps.gitFn || defaultGitSync;
  const existsFn = deps.existsFn || existsSync;
  const { projectPath, branch, sessionId } = params || {};
  if (!projectPath || !branch || !sessionId) {
    return { ok: false, reason: 'bad-input', detail: 'projectPath, branch y sessionId son obligatorios' };
  }

  const path = computeReviewWorktreePath(projectPath, sessionId);
  // Idempotencia: un relanzamiento con el mismo sessionId reutiliza el worktree en vez de
  // fallar. `git worktree add` sobre un directorio existente aborta, y ese aborto no aporta
  // nada — el directorio ya es lo que queríamos crear.
  if (existsFn(path)) return { ok: true, path, created: false };

  // ¿La rama ya está checkouteada en otro worktree? Se PREGUNTA antes de intentar, en vez de
  // deducirlo del mensaje de error de git. git está traducido: el «is already used by
  // worktree» que sale en CI es «ya está siendo usado por el árbol de trabajo» en una máquina
  // en español, y una regex sobre el texto inglés convertiría el único fallo esperable de
  // operación normal (el worktree del coder todavía vivo) en un `git-failed` genérico que
  // manda al operador a diagnosticar un git que está perfectamente.
  //
  // `worktree list --porcelain` emite `branch refs/heads/<nombre>` — formato de máquina,
  // estable y no traducido, que es para lo que existe el `--porcelain`.
  const busy = branchInUse(projectPath, branch, gitFn);
  if (busy.checked && busy.inUse) {
    return { ok: false, reason: 'branch-busy', detail: `${branch} ya está checkouteada en ${busy.where}` };
  }

  try {
    gitFn(projectPath, ['worktree', 'add', path, branch]);
    return { ok: true, path, created: true };
  } catch (err) {
    return { ok: false, reason: 'git-failed', detail: String(/** @type {Error} */ (err)?.message ?? '') };
  }
}

/**
 * ¿Está `branch` checkouteada en algún worktree del repo? Lectura de `--porcelain`, sin
 * depender del idioma de git. NEVER-THROWS.
 *
 * `checked: false` significa «no se ha podido saber» (git mudo), y el llamante entonces deja
 * que el `worktree add` lo intente: fallar por el camino largo es mejor que negarse a lanzar
 * por una comprobación que no se pudo hacer.
 *
 * @param {string} projectPath
 * @param {string} branch
 * @param {(cwd: string, args: string[]) => string} gitFn
 * @returns {{ checked: boolean, inUse: boolean, where: string }}
 */
function branchInUse(projectPath, branch, gitFn) {
  let out;
  try {
    out = String(gitFn(projectPath, ['worktree', 'list', '--porcelain']));
  } catch {
    return { checked: false, inUse: false, where: '' };
  }
  // Bloques separados por línea en blanco: `worktree <path>` … `branch refs/heads/<name>`.
  let currentPath = '';
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) currentPath = line.slice('worktree '.length).trim();
    else if (line.trim() === `branch refs/heads/${branch}`) {
      return { checked: true, inUse: true, where: currentPath };
    }
  }
  return { checked: true, inUse: false, where: '' };
}

/**
 * Retira el worktree de revisión. NEVER-THROWS.
 *
 * `--force` porque el reviewer deja artefactos sin commitear cuando cierra a medias, y un
 * worktree que no se puede retirar bloquea la rama para la siguiente ronda — que es peor que
 * perder un borrador que, por construcción, solo podía ser un fichero de `review/`.
 *
 * @param {{ projectPath: string, path: string }} params
 * @param {{ gitFn?: (cwd: string, args: string[]) => string, existsFn?: typeof existsSync }} [deps]
 * @returns {{ ok: true, removed: boolean } | { ok: false, reason: 'git-failed', detail: string }}
 */
export function removeReviewWorktree(params, deps = {}) {
  const gitFn = deps.gitFn || defaultGitSync;
  const existsFn = deps.existsFn || existsSync;
  const { projectPath, path } = params || {};
  if (!projectPath || !path) return { ok: true, removed: false };
  // Un worktree que ya no está es el estado deseado, no un fallo. Se comprueba el DIRECTORIO
  // en vez de leer el mensaje de git por el mismo motivo que en `provisionReviewWorktree`: git
  // está traducido y el «is not a working tree» de CI no es el texto de una máquina en español.
  if (!existsFn(path)) return { ok: true, removed: false };
  try {
    gitFn(projectPath, ['worktree', 'remove', '--force', path]);
    return { ok: true, removed: true };
  } catch (err) {
    return { ok: false, reason: 'git-failed', detail: String(/** @type {Error} */ (err)?.message ?? '') };
  }
}

/**
 * Rellena la plantilla del rol reviewer. PURA respecto del reloj y de la red; lee la
 * plantilla del disco (inyectable).
 *
 * Los placeholders se sustituyen con `replaceAll` sobre literales, igual que
 * `resolvePromptTemplate` (orchestrator/launch.js) — sin motor de plantillas y sin
 * interpolar nada que venga del proveedor sin sanear (aquí solo entran refs, ramas y SHAs,
 * que el llamante ya resolvió del repo, no del tablero).
 *
 * `ocr_section` es la excepción a «solo refs, ramas y SHAs»: llega YA saneada y con tope de
 * `renderOcrSection`, y vacía (el caso sin OCR) deja el prompt byte a byte como antes de KODO-92.
 *
 * @param {{
 *   task_ref: string, branch: string, project_path: string, reviewed_head: string,
 *   base_branch?: string|null, round: number, max_rounds: number, next_recommendation: string,
 *   ocr_section?: string,
 * }} ctx
 * @param {{ readFn?: (p: string) => string }} [deps]
 * @returns {string}
 */
export function buildReviewerPrompt(ctx, deps = {}) {
  const readFn = deps.readFn || ((p) => readFileSync(p, 'utf-8'));
  let out = readFn(PROMPT_PATH);
  /** @type {Record<string, string>} */
  const values = {
    task_ref: ctx.task_ref ?? '',
    branch: ctx.branch ?? '',
    project_path: ctx.project_path ?? '',
    reviewed_head: ctx.reviewed_head ?? '',
    // Sin base resuelta, el prompt sigue siendo útil: `main` es el nombre por defecto y el
    // reviewer sabe corregirlo con un `git log`. Dejar el placeholder crudo sería peor.
    base_branch: ctx.base_branch || 'main',
    round: String(ctx.round ?? 1),
    max_rounds: String(ctx.max_rounds ?? 3),
    next_recommendation: ctx.next_recommendation ?? '001-recommendations.md',
    ocr_section: ctx.ocr_section ?? '',
  };
  for (const [k, v] of Object.entries(values)) out = out.replaceAll(`{{${k}}}`, v);
  return out;
}

/**
 * Construye la línea de comando de la sesión de revisión. PURA (sin I/O).
 *
 * Espejo estructural de `buildOrchestratorCommand` (orchestrator/launch.js), y por los mismos
 * motivos en cada detalle:
 *
 *   - prefijo `KODO_REVIEWER=1` → el shell del workspace lo exporta al agente y a sus hijos,
 *     que es lo que abre el gate de `review/guard.js` para `kodo review commit`;
 *   - el prompt va entre comillas SIMPLES con las suyas escapadas (`'` → `'\''`): el comando
 *     se TECLEA por `send`, así que las simples son las únicas que neutralizan `$`, backtick
 *     y `$(...)` del texto;
 *   - `--dangerously-skip-permissions` NO se emite. El reviewer no necesita saltarse permisos
 *     —no ejecuta slash commands autónomos— y dárselo ampliaría gratis la superficie del rol
 *     cuya razón de ser es tenerla estrecha.
 *
 * EL MODELO es `claude.default_model`, el mismo que las sesiones de trabajo — y NO una clave
 * propia tipo `review_model`. Revisar bien es al menos tan caro cognitivamente como
 * implementar: un reviewer con un modelo más barato encuentra menos, y un reviewer que
 * encuentra menos no es un ahorro, es una revisión que no sirve. Si algún día hace falta
 * desacoplarlo, la clave se añade entonces; inventarla ahora sería un knob sin caso de uso.
 *
 * @param {ReturnType<import('../config.js').loadConfig>} config
 * @param {string} sessionId
 * @param {string} prompt Prompt del reviewer SIN escapar.
 * @returns {string}
 */
export function buildReviewerCommand(config, sessionId, prompt) {
  const escaped = String(prompt).replace(/'/g, "'\\''");
  const agent = getAgentDef(config);
  return [
    'KODO_REVIEWER=1',
    agent.binary,
    agent.model_flag, config.claude.default_model,
    agent.session_id_flag, sessionId,
    `'${escaped}'`,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Resuelve la rama base contra la que el reviewer debe diffear. NEVER-THROWS.
 *
 * Mismo orden de preferencia que usa la captura de integración (`integration/capture.js`):
 * `origin/HEAD` → `main` → `master`. Se devuelve `null` si ninguna existe, y el prompt cae a
 * `main` con una nota — un diff contra la base equivocada es peor que un reviewer que resuelve
 * la base él mismo con un `git log`.
 *
 * @param {string} dir
 * @param {{ gitFn?: (cwd: string, args: string[]) => string }} [deps]
 * @returns {string|null}
 */
export function resolveBaseBranch(dir, deps = {}) {
  const gitFn = deps.gitFn || defaultGitSync;
  try {
    const head = String(gitFn(dir, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    if (head) return head;
  } catch { /* sin origin/HEAD */ }
  for (const candidate of ['main', 'master']) {
    try {
      gitFn(dir, ['rev-parse', '--verify', '--quiet', candidate]);
      return candidate;
    } catch { /* siguiente candidato */ }
  }
  return null;
}

// ─── KODO-92: el spec de open-code-review ───────────────────────────────────────────────
//
// `ocr delegate` es la mitad DETERMINISTA de OCR: qué ficheros del rango merecen revisión (con
// exclusiones y motivo) y qué checklist aplica a cada uno según `rule.json`. Sin LLM. Aquí se
// pega como sección del prompt para acotarle al reviewer por dónde empezar; el diff real lo
// sigue leyendo él, y sigue escribiendo solo en `review/`.
//
// Vive en la sesión del REVIEWER y no como hook de la sesión de trabajo: ahí sería la sesión
// revisándose a sí misma, que es justo lo que KODO-69 separó. Y no hay «auto-fix» de OCR: el
// reviewer no arregla (ver prompt.md).
//
// FAIL-OPEN entero: sin regla configurada, sin `ocr` en PATH, con error o timeout, la sección
// se omite y `kodo review start` sigue. Un checklist es ayuda, no una precondición.

/**
 * Tope de la sección OCR, en caracteres. El prompt entero se TECLEA por `cmux send`: el del
 * orquestador (~15 KB) es el precedente que se sabe que funciona, y el del reviewer ya ronda
 * 5 KB. Los checklists de sistema de OCR pesan ~3 KB por lenguaje, así que un diff políglota
 * sin tope se iría de las manos.
 */
export const OCR_SECTION_MAX_CHARS = 10_000;

/** Encabezado de la sección. Exportado para que los tests anclen en él y no en la prosa. */
export const OCR_SECTION_HEADING = '## Ficheros y checklist (open-code-review)';

/**
 * Tope de ficheros listados por bloque (revisables / excluidos). Un diff normal cabe entero; en
 * uno de cientos, el resto lo da `git diff --stat` y el presupuesto se queda para los checklists.
 */
const OCR_MAX_LISTED_FILES = 40;

/**
 * Tope de ficheros en el «aplica a» de cada checklist. Esa lista repite la de revisables, y sin
 * tope, en un diff grande, se come el presupuesto de la sección y deja fuera los checklists
 * — que son lo único que no está en otro sitio.
 */
const OCR_MAX_GROUP_FILES = 8;

/** `ocr delegate` no llama a ningún LLM: tarda décimas. 20 s es un cuelgue, no un repo grande. */
const OCR_TIMEOUT_MS = 20_000;

/**
 * Ruta del `rule.json` de OCR configurada para un repo, o `null`. PURA.
 *
 * Vive en `oracle.repos[<path>].ocr_rule`, junto a los comandos del oráculo: es la misma
 * config por repo, claveada por la misma igualdad exacta de path, y escrita a mano por el
 * operador. Relativa → contra el repo (así un `.opencodereview/rule.json` versionado se
 * declara igual en cualquier máquina); `~/` → home; absoluta tal cual.
 *
 * @param {any} config
 * @param {string} projectPath
 * @returns {string|null}
 */
export function resolveOcrRulePath(config, projectPath) {
  const raw = config?.oracle?.repos?.[projectPath]?.ocr_rule;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const p = raw.trim();
  if (p === '~' || p.startsWith('~/')) return join(homedir(), p.slice(1));
  return isAbsolute(p) ? p : resolve(projectPath, p);
}

/**
 * Corre `ocr delegate preview` + `ocr delegate rule` y devuelve la sección ya renderizada.
 * NEVER-THROWS.
 *
 * `--repo` es el repo del proyecto y NO el worktree de revisión: los refs son los mismos, y así
 * la capa `<repo>/.opencodereview/rule.json` que OCR lee por su cuenta es la de la copia
 * principal y no la de la rama revisada — la sesión que se revisa no elige su checklist.
 *
 * @param {{ projectPath: string, base: string, branch: string, rulePath: string|null }} params
 * @param {{ ocrFn?: (args: string[]) => string, existsFn?: typeof existsSync }} [deps]
 * @returns {{ ok: true, section: string }
 *          | { ok: false, reason: 'no-rule'|'rule-missing'|'bad-input'|'ocr-missing'|'ocr-failed', detail?: string }}
 */
export function collectOcrSpec(params, deps = {}) {
  const ocrFn = deps.ocrFn || defaultOcrSync;
  const existsFn = deps.existsFn || existsSync;
  const { projectPath, base, branch, rulePath } = params || {};
  if (!rulePath) return { ok: false, reason: 'no-rule' };
  if (!existsFn(rulePath)) return { ok: false, reason: 'rule-missing', detail: rulePath };
  if (!projectPath || !base || !branch) return { ok: false, reason: 'bad-input' };

  const common = ['--repo', projectPath, '--rule', rulePath, '--format', 'json', '--color', 'never'];
  try {
    const preview = JSON.parse(ocrFn(['delegate', 'preview', ...common, '--from', base, '--to', branch]));
    if (!preview || !Array.isArray(preview.reviewable_files)) {
      return { ok: false, reason: 'ocr-failed', detail: 'preview sin reviewable_files' };
    }
    const paths = preview.reviewable_files.map((f) => f?.path).filter((p) => typeof p === 'string');
    let groups = [];
    if (paths.length > 0) {
      // `--` antes de las rutas: un fichero llamado `-x` es un nombre, no un flag.
      const rules = JSON.parse(ocrFn(['delegate', 'rule', ...common, '--', ...paths]));
      groups = Array.isArray(rules?.groups) ? rules.groups : [];
    }
    return { ok: true, section: renderOcrSection({ preview, groups, rulePath }) };
  } catch (err) {
    const e = /** @type {any} */ (err);
    if (e?.code === 'ENOENT') return { ok: false, reason: 'ocr-missing' };
    if (e?.code === 'ETIMEDOUT' || e?.signal === 'SIGTERM') {
      return { ok: false, reason: 'ocr-failed', detail: `timeout (${OCR_TIMEOUT_MS / 1000}s)` };
    }
    const stderr = stripForKeystroke(String(e?.stderr ?? '')).trim();
    return { ok: false, reason: 'ocr-failed', detail: (stderr || String(e?.message ?? err)).slice(0, 300) };
  }
}

/**
 * Renderiza la sección «Ficheros y checklist». PURA.
 *
 * TODO lo que sale de OCR se sanea para el carril por el que viaja el prompt: se TECLEA con
 * `cmux send`, que convierte `\t`/`\n`/`\r` LITERALES en Tab/Enter — y un Tab dentro de la
 * línea dispara el autocompletado del shell a mitad del prompt. Las rutas vienen de la rama
 * revisada (las elige quien la escribió), así que además se aplanan a una línea y pierden
 * los backticks: no pueden salirse de su code span ni fingir una sección del prompt.
 *
 * @param {{ preview: any, groups: any[], rulePath: string }} params
 * @returns {string} Termina en `\n\n` para encajar entre dos secciones de prompt.md.
 */
export function renderOcrSection({ preview, groups, rulePath }) {
  const line = (/** @type {unknown} */ s) => stripForKeystroke(s).replace(/`/g, "'");
  const block = (/** @type {unknown} */ s) => stripControlChars(s).replace(/\t/g, '  ').replace(/\\([nrt])/g, '\\ $1');
  const reviewable = Array.isArray(preview?.reviewable_files) ? preview.reviewable_files : [];
  const excluded = Array.isArray(preview?.excluded_files) ? preview.excluded_files : [];

  /** @param {any[]} files @param {(f: any) => string} fmt */
  const list = (files, fmt) => {
    const shown = files.slice(0, OCR_MAX_LISTED_FILES).map((f) => `- \`${line(f?.path)}\` ${fmt(f)}`);
    if (files.length > OCR_MAX_LISTED_FILES) shown.push(`- … y ${files.length - OCR_MAX_LISTED_FILES} más`);
    return shown.join('\n');
  };

  const out = [
    OCR_SECTION_HEADING,
    '',
    `Spec determinista de \`ocr delegate\` (sin LLM) para \`${line(preview?.from ?? '')}...${line(preview?.to ?? '')}\`. ` +
      'Te dice **por dónde empezar**, no sustituye al diff: léelo entero igualmente, y un fichero excluido aquí también puede esconder el problema. ' +
      'Los checklists son orientativos; lo que no aplique a este cambio, ignóralo.',
    '',
    `### Revisables (${reviewable.length})`,
    '',
    reviewable.length > 0
      ? list(reviewable, (f) => `(${line(f?.status)}, +${Number(f?.insertions) || 0} −${Number(f?.deletions) || 0})`)
      : '- Ninguno: OCR no encuentra ficheros revisables en el rango. Revisa el diff igualmente.',
  ];
  if (excluded.length > 0) {
    out.push('', `### Excluidos por OCR (${excluded.length})`, '', list(excluded, (f) => `— ${line(f?.exclude_reason)}`));
  }

  const head = out.join('\n');
  const parts = [];
  const omitted = [];
  let size = head.length;
  for (const g of groups) {
    const all = Array.isArray(g?.files) ? g.files : [];
    const files = all.slice(0, OCR_MAX_GROUP_FILES).map((f) => `\`${line(f)}\``).join(', ') +
      (all.length > OCR_MAX_GROUP_FILES ? ` y ${all.length - OCR_MAX_GROUP_FILES} más` : '');
    const text =
      `\n\n**Checklist \`${line(g?.pattern)}\`** (${line(g?.source)}) — aplica a: ${files}\n\n${block(g?.rule ?? '').trim()}`;
    if (size + text.length > OCR_SECTION_MAX_CHARS) {
      omitted.push(g);
      continue;
    }
    parts.push(text);
    size += text.length;
  }
  if (groups.length > 0) parts.unshift('\n\n### Checklist por tipo de fichero');
  if (omitted.length > 0) {
    const names = omitted.map((g) => `\`${line(g?.pattern)}\``).join(', ');
    parts.push(
      `\n\n_Checklist omitida por tamaño para ${names}._ Pídela con ` +
        `\`ocr delegate rule --rule ${line(rulePath)} <ficheros>\`.`,
    );
  }
  return `${head}${parts.join('')}\n\n`;
}

/**
 * @param {string[]} args
 * @returns {string}
 */
function defaultOcrSync(args) {
  return execFileSync('ocr', args, { encoding: 'utf-8', timeout: OCR_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Ficheros que el reviewer NO debe encontrarse ya modificados al arrancar.
 *
 * Se exporta para que el CLI pueda avisar: si el worktree recién creado trae cambios sueltos
 * fuera de `review/`, es que la rama los tiene commiteados a medias o que alguien está
 * trabajando ahí. No bloquea el lanzamiento —el pathspec ya garantiza que no se commitearán—
 * pero merece salir por pantalla.
 *
 * @type {string}
 */
export const REVIEWER_WRITABLE_PATHSPEC = REVIEW_PATHSPEC;

/**
 * @param {string} cwd
 * @param {string[]} args
 * @returns {string}
 */
function defaultGitSync(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' });
}
