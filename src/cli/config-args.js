// @ts-check
//
// src/cli/config-args.js — Plan 72-02 (HYG-05 M3 + M14).
//
// Helpers PUROS de parsing/escritura para los args de `kodo config` (`--set`,
// `--map-project`). Se extraen de src/cli.js porque ese módulo ejecuta
// `program.parse()` al import (no es importable en tests): aislar estas piezas
// puras aquí permite cubrir M3/M14 por unit test sin ejecutar el CLI, y mantiene
// cli.js como un thin wrapper (mismo precedente que src/config-validate.js).
//
// - M3 (T-72-04): `setNestedValue` RECHAZA `__proto__`/`constructor`/`prototype`
//   (nunca escapa/sanea) → corta prototype pollution vía `kodo config --set`.
// - M14 (T-72-07): parsing por `indexOf`+`slice` (no `split`) → preserva `=`/`:`
//   internos en valores (`token=a=b=c`) y rutas (`id:/a:b:c`).

/** Claves que romperían el prototype chain si se caminaran como propiedades. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Escribe un valor anidado por path dotted MUTANDO `obj`. RECHAZA (M3, T-72-04) las
 * claves de prototype pollution en CUALQUIER tramo del path: lanza un `Error` explícito
 * antes de caminar/crear ninguna rama — nunca escapa ni sanea (Anti-Pattern del RESEARCH).
 *
 * @param {object} obj - objeto destino.
 * @param {string} path - path dotted (`a.b.c`).
 * @param {any} value - valor a escribir en la hoja.
 * @throws {Error} si algún tramo del path es `__proto__`/`constructor`/`prototype`.
 */
export function setNestedValue(obj, path, value) {
  const keys = String(path).split('.');
  // Rechazo PRE-walk: valida el path completo antes de mutar nada.
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error(`Clave de config prohibida: ${k}`);
    }
  }
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Parsea el arg de `--set key=value` (M14). Parte SOLO por el PRIMER `=`: el `value`
 * conserva cualquier `=` interno (`token=a=b=c` → value `a=b=c`). Sin `=`, `value` es
 * `undefined` (el caller lo trata como uso inválido).
 *
 * @param {string} raw - el string crudo de `--set`.
 * @returns {{ key: string, value: string | undefined }}
 */
export function parseSetArg(raw) {
  const s = String(raw);
  const eq = s.indexOf('=');
  return {
    key: eq === -1 ? s : s.slice(0, eq),
    value: eq === -1 ? undefined : s.slice(eq + 1),
  };
}

/**
 * Parsea el arg de `--map-project projectId:path` (M14). Parte SOLO por el PRIMER `:`:
 * el `localPath` conserva cualquier `:` interno (`id:/a:b:c` → localPath `/a:b:c`). Sin
 * `:`, `localPath` es `undefined` (el caller lo trata como uso inválido).
 *
 * @param {string} raw - el string crudo de `--map-project`.
 * @returns {{ projectId: string, localPath: string | undefined }}
 */
export function parseMapProjectArg(raw) {
  const s = String(raw);
  const colon = s.indexOf(':');
  return {
    projectId: colon === -1 ? s : s.slice(0, colon),
    localPath: colon === -1 ? undefined : s.slice(colon + 1),
  };
}

export { FORBIDDEN_KEYS };
