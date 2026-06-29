// @ts-check
//
// Validador de ruta-DIRECTORIO para el editor de proyectos del dashboard (Phase 64, D-04).
//
// POR QUÉ ESTE MÓDULO ES ADYACENTE A `config-validate.js` Y NO DENTRO DE ÉL:
// `config-validate.js` declara explícitamente en su cabecera (`:14-15`) el invariante
// 0-I/O: "no importa `node:fs`... preserva el invariante 0-I/O del carril local". Meter
// aquí `existsSync`/`statSync` rompería ese invariante y contaminaría su test unit
// hermético. Por eso este validador —el ÚNICO con I/O del milestone v0.14— vive en su
// propio módulo (concesión consciente D-04, RESEARCH Pitfall 4 / A2).
//
// Contrato (idéntico al de los validadores de `config-validate.js`):
//   - { ok: true,  value: <ruta saneada> }
//   - { ok: false, error: <mensaje en español, copy estable> }
// Corre SIEMPRE antes de `saveProjects` (D-04): una ruta inexistente/no-dir jamás
// alcanza el disco (T-64-01). NUNCA lanza ante ningún input (T-64-02).
import { existsSync, statSync } from 'node:fs';

/**
 * @typedef {{ ok: true, value: string } | { ok: false, error: string }} ValidationResult
 */

/**
 * Valida que `raw` sea una ruta a un directorio EXISTENTE (PROJ-02 / D-04).
 *
 * Never-throws (T-64-02): `existsSync` es false-silencioso, pero `statSync` LANZA en
 * symlink roto, permisos denegados o race (borrado entre exists y stat) — Pitfall 2.
 * El try/catch convierte ese throw en `{ ok:false }`. `String(raw)` es defensivo ante
 * cualquier tipo (el buffer del text-input siempre es string, pero el contrato never-throws
 * cubre input arbitrario). Anti-ReDoS (T-64-04): solo FS calls + comparaciones + trim,
 * nunca una regex compilada desde el input.
 *
 * @param {any} raw - buffer del text-input (string, pero never-throws ante cualquier tipo).
 * @returns {ValidationResult}
 */
export function validateExistingDir(raw) {
  const s = String(raw).trim();
  if (s.length === 0) return { ok: false, error: 'la ruta no puede estar vacía' };
  try {
    if (!existsSync(s)) return { ok: false, error: `"${s}" no existe` };
    if (!statSync(s).isDirectory()) return { ok: false, error: `"${s}" no es un directorio` };
    return { ok: true, value: s };
  } catch {
    // symlink roto / permisos denegados / race — statSync propaga, aquí se neutraliza.
    return { ok: false, error: `no se pudo acceder a "${s}"` };
  }
}
