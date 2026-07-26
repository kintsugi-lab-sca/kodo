// @ts-check
//
// src/cli/skill-sync.js — Action handler de `kodo skill sync`.
//
// Responsabilidades (CONTEXT §D-06, D-07, D-08):
//   1. Gate: ¿cwd es un repo kodo? (exit 2 + stderr canonical D-07).
//   2. Recorrer el registro KODO_SKILLS invocando syncSkill una vez por skill
//      (la lógica de copia vive en src/skill/sync.js — D-08 SoSoT).
//   3. Render: human (default) coloreado via createFormatter, o JSON (--json).
//   4. Exit codes: 0 (ok/noop) — 1 (fs error en alguna skill) — 2 (no kodo repo).
//
// Phase 84 (CAPT-05): el handler pasa de single-skill a multi-skill. El bucle y
// la agregación viven AQUÍ, no en syncSkill: D-06 congela esa función pura, que
// sigue siendo per-skill y no se entera de que hay un registro.
//
// Color isolation invariante (Phase 14 D-07): este archivo NUNCA importa el
// paquete de color directamente — solo createFormatter. Blindado por
// test/format-isolation.test.js y test/skill-sync.test.js (source-hygiene).

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { syncSkill } from '../skill/sync.js';
import { createFormatter } from './format.js';

/**
 * Allowlist EXPLÍCITA de las skills que kodo distribuye al HOME del operador
 * (Phase 84, D-01). El orden del array ES el orden del render y el del array
 * `skills[]` del payload `--json`: `kodo-orchestrate` primero por ser la skill
 * de identidad del repo.
 *
 * Por qué una constante y NO un listado del directorio `.claude/skills/`:
 * ese directorio contiene además skills de trabajo LOCAL del repo (hoy
 * `worktree-cleanup`), que no son un producto que kodo publique en el HOME de
 * nadie. Descubrir el registro por filesystem convertiría cualquier fichero
 * caído en `.claude/skills/` en algo que se copia al HOME de todos los
 * operadores. Con la allowlist, añadir una entrada es un acto deliberado y
 * revisable en el diff. Blindado por el test source-hygiene de
 * `test/skill-sync.test.js`, que asserta el contenido literal del registro.
 *
 * @type {ReadonlyArray<string>}
 */
const KODO_SKILLS = Object.freeze(['kodo-orchestrate', 'kodo-capture']);

/**
 * Skill que marca la identidad del repo para el gate de exit 2 (D-02). NO es una
 * comprobación por skill: un repo kodo sin `kodo-capture` sigue siendo un repo
 * kodo, y esa skill simplemente reportará su propio error.
 *
 * @type {string}
 */
const IDENTITY_SKILL = 'kodo-orchestrate';

/**
 * Nombres candidatos del entrypoint de una skill, en orden de preferencia
 * (D-07). Claude Code documenta `SKILL.md`; `kodo-orchestrate` usa histórico
 * `skill.md` en minúsculas (su rename está diferido por D-08). En macOS el
 * filesystem es case-insensitive y la discrepancia es invisible; en Linux no.
 *
 * @type {ReadonlyArray<string>}
 */
const ENTRYPOINTS = Object.freeze(['SKILL.md', 'skill.md']);

/**
 * ¿El directorio contiene el entrypoint de una skill, en cualquiera de las dos
 * grafías admitidas? (D-07).
 *
 * @private
 * @param {string} dir
 * @returns {boolean}
 */
function hasSkillEntry(dir) {
  return ENTRYPOINTS.some((entry) => existsSync(join(dir, entry)));
}

/**
 * @typedef {{ prune?: boolean, json?: boolean }} RunSkillSyncCliOpts
 *
 * @typedef {{
 *   syncFn?: typeof syncSkill,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   cwdFn?: () => string,
 *   cleanupFn?: () => Promise<void> | void,
 * }} RunSkillSyncCliDeps
 */

/**
 * Thin CLI handler que orquesta el gate D-07 + syncSkill + render.
 *
 * Si `deps.cleanupFn` se provee, se ejecuta `await deps.cleanupFn()` ANTES de
 * retornar en cada path de salida (return 0/1/2). D-04/D-05/D-08 ADVISORY-02.
 * Cuando `cleanupFn` es undefined, el comportamiento es byte-exact vs
 * pre-Phase-31 (back-compat blindada por Suite 1+2). El cleanup corre en un
 * try/finally externo que envuelve todo el cuerpo, garantizando ejecución
 * incluso en el early-gate del exit 2 y en paths de error fs (exit 1).
 *
 * D-07 invariante: NUNCA invoca el helper de exit del runtime — retorna el
 * código. bin/kodo (caller) ejecuta el exit con el returnValue post-return.
 *
 * @param {RunSkillSyncCliOpts} opts
 * @param {RunSkillSyncCliDeps} [deps]
 * @returns {Promise<number>} exit code per D-07 (0 ok/noop, 1 fs error, 2 no kodo repo).
 */
export async function runSkillSyncCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const syncFn = deps.syncFn || syncSkill;
  const cwd = deps.cwdFn ? deps.cwdFn() : process.cwd();
  // Lazy: createFormatter solo si entramos al render TTY (no se invoca para --json).
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  // ADVISORY-02 D-04/D-05: cleanupFn sin default — el `if (cleanupFn)` lo elide
  // para callers que no inyectan, preservando back-compat byte-exact.
  const cleanupFn = deps.cleanupFn;

  try {
    // Gate D-07 exit 2: anclado SOLO a la skill de identidad (D-02), nunca por
    // skill del registro. Tolerante a `SKILL.md`/`skill.md` (D-07).
    // ⚠ El literal del err(...) de abajo NO SE TOCA NI UN BYTE: está comparado
    // con assert.equal byte a byte en test/skill-sync.test.js (SKILL-04 #4).
    // Sigue mencionando `skill.md` en minúsculas aunque el gate ya acepte ambas
    // grafías — es contrato de copy, no una descripción de la condición.
    if (!hasSkillEntry(join(cwd, '.claude', 'skills', IDENTITY_SKILL))) {
      err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
      return 2;
    }

    // Bucle SECUENCIAL sobre el registro (D-01). syncSkill es síncrona: no hay
    // nada que paralelizar, y el orden secuencial hace determinista el render y
    // el array `skills[]` del payload.
    /** @type {Array<{ name: string, result: import('../skill/sync.js').SyncSkillResult, dest: string }>} */
    const perSkill = [];
    for (const name of KODO_SKILLS) {
      const source = join(cwd, '.claude', 'skills', name);
      const dest = join(homedir(), '.claude', 'skills', name);
      /** @type {import('../skill/sync.js').SyncSkillResult} */
      let result;
      try {
        result = syncFn({ source, dest, prune: opts.prune === true });
      } catch (e) {
        // D-03: una skill rota NO aborta el bucle. La excepción se normaliza al
        // mismo shape que un `status: 'error'` devuelto y la siguiente skill se
        // sincroniza igual.
        result = { status: 'error', files_changed: 0, error: /** @type {Error} */ (e).message };
      }
      perSkill.push({ name, result, dest });
    }

    // Agregación. `status` agregado: error si alguna falló; ok si alguna cambió
    // algo; noop si todas estaban al día.
    const anyError = perSkill.some((s) => s.result.status === 'error');
    const anyOk = perSkill.some((s) => s.result.status === 'ok');
    const filesChanged = perSkill.reduce((acc, s) => acc + s.result.files_changed, 0);
    const status = anyError ? 'error' : anyOk ? 'ok' : 'noop';

    // Los errores por skill van SIEMPRE a stderr, en los DOS modos: el payload
    // `--json` lleva el `status` de cada entrada pero no su mensaje, y perderlo
    // bajo `--json` sería una regresión frente al comportamiento actual.
    // El nombre va DESPUÉS del prefijo literal para preservar el assert anclado
    // `/^Error: filesystem error: /` (test/skill-sync.test.js, SKILL-04 #3).
    for (const s of perSkill) {
      if (s.result.status === 'error') {
        err(`Error: filesystem error: [${s.name}] ${s.result.error || 'unknown'}\n`);
      }
    }

    if (opts.json === true) {
      // D-06b: single-line JSON byte-deterministic (LOG-12 + DX-06 invariante).
      // ORDEN DE CLAVES = CONTRATO: las de nivel superior son el AGREGADO y
      // conservan su posición para no romper a quien hoy lee .status /
      // .files_changed; `skills[]` se añade DESPUÉS (crecimiento aditivo), y las
      // condicionales al final por asignación.
      /** @type {Record<string, any>} */
      const payload = {
        status,
        files_changed: filesChanged,
        skills: perSkill.map((s) => ({
          name: s.name,
          status: s.result.status,
          files_changed: s.result.files_changed,
        })),
      };
      if (opts.prune === true) {
        payload.files_pruned = perSkill.reduce((acc, s) => acc + (s.result.files_pruned ?? 0), 0);
      }
      if (perSkill.some((s) => s.result.symlink_replaced === true)) payload.symlink_replaced = true;
      write(JSON.stringify(payload) + '\n');
    } else {
      // Una línea por skill, en el orden del registro, sin líneas en blanco entre
      // bloques (D-05). Las que fallaron ya reportaron en stderr.
      for (const s of perSkill) {
        if (s.result.status === 'error') continue;
        renderHuman(s.result, s.dest, write, fmt, s.name);
      }
    }
    return anyError ? 1 : 0;
  } finally {
    // ADVISORY-02 D-05/D-08: cleanup corre ANTES del return value en las 3 ramas
    // (return 0 happy-path, return 1 fs error / result.error, return 2 early-gate).
    if (cleanupFn) await cleanupFn();
  }
}

/**
 * Render TTY (human-readable). NO se invoca para --json — D-06b separa branches
 * temprano para garantizar bytes deterministas.
 *
 * @private
 * @param {import('../skill/sync.js').SyncSkillResult} result
 * @param {string} dest
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 * @param {string} name nombre de la skill; se antepone como `<nombre>: ` atenuado
 *   a cada línea (D-05). Lo que va DESPUÉS del prefijo es byte-idéntico al render
 *   pre-Phase-84 — el prefijo es lo único que se añade.
 */
function renderHuman(result, dest, write, fmt, name) {
  const p = `${fmt.dim(`${name}:`)} `;
  // Warning del symlink legacy va PRIMERO (informativo, D-04).
  if (result.symlink_replaced === true) {
    write(`${p}${fmt.yellow('⚠')} Legacy symlink replaced at ${dest}\n`);
  }
  if (result.status === 'noop') {
    write(`${p}${fmt.ok('No drift')} — ${dest} up to date\n`);
  } else {
    const n = result.files_changed;
    write(`${p}${fmt.ok(`Synced ${n} file${n === 1 ? '' : 's'} to ${dest}`)}\n`);
  }
  if (result.files_pruned !== undefined && result.files_pruned > 0) {
    const k = result.files_pruned;
    write(`${p}${fmt.yellow(`Pruned ${k} foreign file${k === 1 ? '' : 's'}`)}\n`);
  }
}
