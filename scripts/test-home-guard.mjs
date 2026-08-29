#!/usr/bin/env node
// @ts-check
//
// scripts/test-home-guard.mjs — KODO-57. Runner de la suite con guarda de fuga de HOME.
//
// La suite NO debe tocar el `~/.kodo` real de quien la ejecuta. Un test que escriba el
// config del operador es un fallo de aislamiento aunque el contenido resultante sea
// idéntico: significa que ese test corre contra el estado REAL de la máquina, así que
// su veredicto depende de cómo esté configurada — exactamente la clase de fragilidad
// que F1 (KODO-57) cerró en otros cuatro tests.
//
// El síntoma es silencioso: el contenido no cambia, solo el mtime. Esta guarda lo
// convierte en un rojo. Toma una foto de `~/.kodo/config.json` antes de arrancar los
// tests y otra al terminar; si difieren —o si el fichero aparece donde no había—
// sale con código 1 aunque todos los tests hayan pasado.
//
// Uso:
//   node scripts/test-home-guard.mjs                    # descubre test/**/*.test.js
//   node scripts/test-home-guard.mjs test/foo.test.js   # subconjunto explícito
//
// Los argumentos extra se pasan tal cual a `node --test`.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/** El fichero vigilado: el config REAL del operador. */
const WATCHED = join(homedir(), '.kodo', 'config.json');

/**
 * @typedef {{ exists: boolean, mtimeMs?: number, size?: number }} Snapshot
 */

/**
 * Foto del fichero vigilado. `exists:false` es un estado legítimo (máquina limpia,
 * contenedor de CI) y NO es un fallo por sí mismo — solo lo es que cambie.
 *
 * @param {string} path
 * @returns {Snapshot}
 */
export function snapshot(path) {
  try {
    const st = statSync(path);
    return { exists: true, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { exists: false };
  }
}

/**
 * Compara dos fotos. Función PURA — es lo que ejercita test/test-home-guard.test.js.
 *
 * @param {Snapshot} before
 * @param {Snapshot} after
 * @returns {string|null} descripción del cambio, o null si no hubo ninguno.
 */
export function describeChange(before, after) {
  if (!before.exists && !after.exists) return null;
  if (!before.exists && after.exists) return 'lo CREÓ (no existía antes de la suite)';
  if (before.exists && !after.exists) return 'lo BORRÓ (existía antes de la suite)';
  if (before.mtimeMs !== after.mtimeMs) {
    const same = before.size === after.size ? ', mismo tamaño' : `, ${before.size} → ${after.size} bytes`;
    return `cambió su mtime (${new Date(/** @type {number} */ (before.mtimeMs)).toISOString()}`
      + ` → ${new Date(/** @type {number} */ (after.mtimeMs)).toISOString()}${same})`;
  }
  if (before.size !== after.size) return `cambió su tamaño (${before.size} → ${after.size} bytes)`;
  return null;
}

/**
 * Descubre los ficheros de test del repo. Sustituye al `find` del npm script: mismo
 * criterio (`test/**\/*.test.js`), sin depender del shell.
 *
 * @param {string} dir
 * @returns {string[]} rutas relativas al repo, ordenadas.
 */
function discoverTests(dir) {
  /** @type {string[]} */
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, e.name);
    if (e.isDirectory()) out.push(...discoverTests(abs));
    else if (e.isFile() && e.name.endsWith('.test.js')) out.push(relative(REPO, abs));
  }
  return out.sort();
}

/** Corre la suite y devuelve el exit code (0 = verde y sin fuga). */
function main() {
  const args = process.argv.slice(2);
  const files = args.length > 0 ? args : discoverTests(join(REPO, 'test'));

  const before = snapshot(WATCHED);
  const run = spawnSync(process.execPath, ['--test', ...files], { cwd: REPO, stdio: 'inherit' });
  const after = snapshot(WATCHED);

  const change = describeChange(before, after);
  if (change) {
    console.error('');
    console.error(`[kodo] FUGA DE HOME: la suite tocó ${WATCHED} — ${change}.`);
    console.error('[kodo] Ningún test puede escribir el ~/.kodo real: aísla HOME en un tmpdir');
    console.error('[kodo] (process.env.HOME = mkdtempSync(...) ANTES del primer import del módulo,');
    console.error('[kodo] o env: { HOME: tmpHome } si el test hace spawn).');
    return 1;
  }
  return run.status === null ? 1 : run.status;
}

// Main guard: `snapshot` y `describeChange` se importan desde test/test-home-guard.test.js,
// y sin esto el import arrancaría la suite entera de forma recursiva.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
