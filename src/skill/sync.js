// @ts-check
//
// src/skill/sync.js — Phase 21 D-08: módulo único de sincronización canonical → home.
//
// Responsabilidades:
//   1. Detectar drift por hash SHA-256 archivo por archivo (D-02 — no mtime).
//   2. Detectar y reemplazar symlink legacy en dest (D-04).
//   3. Copiar archivos cambiados; preservar foráneos salvo opts.prune (D-05).
//   4. Return { status, files_changed, files_pruned?, symlink_replaced?, error? }.
//      NO emite eventos (caller decide — D-08 SoSoT).
//
// Invariantes:
//   - lstatSync (NO statSync) detecta symlink sin seguirlo (Phase 19 D-02 patrón).
//   - rmSync(symlinkPath, { force: true }) borra solo el link, no el target.
//   - syncSkill es función pura testeable: NO emite eventos; el caller los emite (D-08).
//   - Walker manual recursivo (NO fs.cp) para control fino sobre diff hash + prune list.

import { createHash } from 'node:crypto';
import {
  readFileSync, writeFileSync, readdirSync, mkdirSync,
  lstatSync, rmSync, unlinkSync, existsSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';

/**
 * @typedef {{
 *   source: string,
 *   dest: string,
 *   prune?: boolean,
 *   logger?: import('../logger.js').Logger,
 *   onConsoleWarn?: (msg: string) => void,
 * }} SyncSkillOpts
 *
 * @typedef {{
 *   status: 'ok' | 'noop' | 'error',
 *   files_changed: number,
 *   files_pruned?: number,
 *   symlink_replaced?: boolean,
 *   error?: string,
 * }} SyncSkillResult
 */

/**
 * Sincroniza la skill canonical `<repo>/.claude/skills/kodo-orchestrate/` → home
 * (D-01). Función pura: NO emite eventos NDJSON; el caller decide qué hacer con el
 * return value (D-08 single-source-of-truth).
 *
 * Cuando `opts.onConsoleWarn` se inyecta, reemplaza la llamada a `console.warn` del
 * prune; D-01 ADVISORY-01. Si no se provee, default fallback a `console.warn`
 * directo (back-compat byte-exact con callers pre-Phase-31).
 *
 * @param {SyncSkillOpts} opts
 * @returns {SyncSkillResult}
 */
export function syncSkill(opts) {
  const { source, dest, prune = false, onConsoleWarn } = opts;
  // ADVISORY-01 D-01: callback opcional para warning de prune. Default
  // `console.warn` preserva back-compat byte-exact (D-03). El callback recibe
  // el string ya formateado — el módulo no importa color libraries (color isolation).
  const warn = onConsoleWarn ?? console.warn;
  let filesChanged = 0;
  let filesPruned = 0;
  let symlinkReplaced = false;

  try {
    // 1. Validar source: skill.md DEBE existir (D-07 traducción a 'error').
    if (!existsSync(join(source, 'skill.md'))) {
      return { status: 'error', files_changed: 0, error: 'source skill not found' };
    }

    // 2. D-04: detectar y reemplazar symlink legacy (lstatSync NO sigue el link).
    // Usar unlinkSync (no rmSync) — `rmSync({force:true})` sobre un symlink que
    // apunta a un directorio real puede borrar contenido del target en algunas
    // versiones de Node. unlinkSync siempre borra solo el link (POSIX unlink(2)).
    try {
      const st = lstatSync(dest);
      if (st.isSymbolicLink()) {
        unlinkSync(dest);
        mkdirSync(dest, { recursive: true });
        symlinkReplaced = true;
      }
    } catch (err) {
      // ENOENT: dest no existe — mkdirSync más abajo lo crea (idempotente).
      // Otros errores: fall-through; mkdirSync re-lanzará el error real al caller.
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') {
        throw err;
      }
    }

    // 3. Asegurar dest existe (idempotente).
    mkdirSync(dest, { recursive: true });

    // 4. Walker recursivo del source → array de rel paths (regular files only).
    const sourceFiles = walkFiles(source);

    // 5. Hash + diff por archivo. Recolectamos el Set para reusar en prune.
    /** @type {Set<string>} */
    const sourceSet = new Set(sourceFiles);
    for (const relPath of sourceFiles) {
      const srcAbs = join(source, relPath);
      const destAbs = join(dest, relPath);
      const srcContent = readFileSync(srcAbs);
      const srcHash = createHash('sha256').update(srcContent).digest('hex');

      let needsCopy = false;
      if (!existsSync(destAbs)) {
        needsCopy = true;
      } else {
        const destHash = createHash('sha256').update(readFileSync(destAbs)).digest('hex');
        if (destHash !== srcHash) needsCopy = true;
      }

      if (needsCopy) {
        mkdirSync(dirname(destAbs), { recursive: true });
        writeFileSync(destAbs, srcContent); // reuso srcContent — evita doble I/O
        filesChanged += 1;
      }
    }

    // 6. D-05 prune (opt-in destructivo, default false).
    if (prune === true) {
      const destFiles = walkFiles(dest);
      for (const relPath of destFiles) {
        if (!sourceSet.has(relPath)) {
          // D-05b: warn explícito ANTES de borrar para que el operador vea qué se pierde.
          warn(`[kodo skill sync --prune] removing foreign: ${relPath}`);
          rmSync(join(dest, relPath), { force: true });
          filesPruned += 1;
        }
      }
    }

    // 7. Status: ok si hubo cambios o symlink replaced; noop si no.
    const status = (filesChanged > 0 || symlinkReplaced) ? 'ok' : 'noop';
    /** @type {SyncSkillResult} */
    const result = { status, files_changed: filesChanged };
    if (prune === true) result.files_pruned = filesPruned;
    if (symlinkReplaced) result.symlink_replaced = true;
    return result;
  } catch (err) {
    return {
      status: 'error',
      files_changed: filesChanged,
      error: /** @type {Error} */ (err).message,
    };
  }
}

/**
 * Walker recursivo de archivos regulares. Returns relative paths from `root`.
 * Symlinks dentro del árbol son ignorados (defense in depth — la skill canonical
 * no los tiene).
 *
 * @param {string} root
 * @returns {string[]}
 */
function walkFiles(root) {
  /** @type {string[]} */
  const out = [];
  function recurse(currentAbs) {
    const entries = readdirSync(currentAbs, { withFileTypes: true });
    for (const e of entries) {
      const abs = join(currentAbs, e.name);
      if (e.isDirectory()) {
        recurse(abs);
      } else if (e.isFile()) {
        out.push(relative(root, abs));
      }
      // Symlinks dentro del árbol: ignorados intencionalmente.
    }
  }
  if (existsSync(root)) recurse(root);
  return out.sort(); // determinismo (D-02 — hash + orden estable)
}
