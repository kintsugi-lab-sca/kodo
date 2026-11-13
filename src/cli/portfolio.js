// @ts-check
//
// src/cli/portfolio.js — Action handlers de `kodo portfolio` (list · show · set · step · event).
//
// THIN handlers: argv → store → render. La forma del fichero y sus reglas viven en
// `src/portfolio/store.js`. Cada handler RETORNA el exit code; nunca termina el proceso.
//
// Exit codes: 0 ok · 1 error de filesystem o ficha corrupta · 2 entrada inválida (slug,
// estado, fecha) o ficha inexistente.
//
// NO invoca la comprobación de configuración de proveedor: el portafolio es filesystem local
// (`~/.kodo/portfolio/`) y no toca ningún provider — mismo precedente que `capture`.

import {
  PortfolioUsageError,
  addEvent,
  addStep,
  applyPatch,
  defaultPortfolioDir,
  listEntries,
  readEntry,
  writeEntry,
} from '../portfolio/store.js';
import { EXIT_ERROR, EXIT_SUCCESS, EXIT_USAGE } from './exit-codes.js';

/**
 * Dependencias inyectables, todas opcionales.
 *
 * @typedef {{
 *   dirFn?: () => string,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   clockFn?: () => string,
 * }} PortfolioDeps
 */

/** @param {PortfolioDeps} deps */
function resolve(deps) {
  return {
    dir: (deps.dirFn || defaultPortfolioDir)(),
    write: deps.writeFn || ((s) => void process.stdout.write(s)),
    err: deps.errFn || ((s) => void process.stderr.write(s)),
    now: (deps.clockFn || (() => new Date().toISOString()))(),
  };
}

/**
 * Ejecuta `fn` mapeando los errores al contrato de exit codes.
 *
 * @param {(s: string) => void} err
 * @param {() => number} fn
 * @returns {number}
 */
function guarded(err, fn) {
  try {
    return fn();
  } catch (e) {
    err(`Error: ${/** @type {Error} */ (e).message}\n`);
    return e instanceof PortfolioUsageError ? EXIT_USAGE : EXIT_ERROR;
  }
}

/**
 * `kodo portfolio` — lista las fichas (sin las archivadas salvo `all`).
 *
 * @param {{ all?: boolean, json?: boolean }} opts
 * @param {PortfolioDeps} [deps]
 * @returns {number}
 */
export function runPortfolioListCli(opts, deps = {}) {
  const { dir, write, err } = resolve(deps);
  return guarded(err, () => {
    const entries = listEntries(dir).filter((e) => opts.all || !e.archived);
    if (opts.json) {
      write(JSON.stringify(entries, null, 2) + '\n');
      return EXIT_SUCCESS;
    }
    if (entries.length === 0) {
      write('Portafolio vacío — kodo portfolio set <slug> --name … --plane-project …\n');
      return EXIT_SUCCESS;
    }
    for (const e of entries) {
      const flags = [e.status || '—', e.archived ? 'archivado' : ''].filter(Boolean).join(' · ');
      write(`${e.slug}  [${flags}]  ${String(e.updated_at).slice(0, 10)}  ${e.headline || '(sin titular)'}\n`);
    }
    return EXIT_SUCCESS;
  });
}

/**
 * `kodo portfolio show <slug>` — vuelca la ficha como JSON.
 *
 * @param {string} slug
 * @param {PortfolioDeps} [deps]
 * @returns {number}
 */
export function runPortfolioShowCli(slug, deps = {}) {
  const { dir, write, err } = resolve(deps);
  return guarded(err, () => {
    const entry = readEntry(dir, slug);
    if (!entry) throw new PortfolioUsageError(`no existe «${slug}» en el portafolio`);
    write(JSON.stringify(entry, null, 2) + '\n');
    return EXIT_SUCCESS;
  });
}

/**
 * `kodo portfolio set <slug> …` — crea la ficha o actualiza los campos indicados.
 *
 * @param {string} slug
 * @param {import('../portfolio/store.js').PortfolioPatch} patch
 * @param {PortfolioDeps} [deps]
 * @returns {number}
 */
export function runPortfolioSetCli(slug, patch, deps = {}) {
  const { dir, write, err, now } = resolve(deps);
  return guarded(err, () => {
    writeEntry(dir, applyPatch(readEntry(dir, slug), slug, patch, now));
    write(`Portafolio actualizado: ${slug}\n`);
    return EXIT_SUCCESS;
  });
}

/**
 * `kodo portfolio step <slug> <texto>` — añade un paso a la cronología.
 *
 * @param {string} slug
 * @param {string} text
 * @param {{ source?: string }} opts
 * @param {PortfolioDeps} [deps]
 * @returns {number}
 */
export function runPortfolioStepCli(slug, text, opts, deps = {}) {
  const { dir, write, err, now } = resolve(deps);
  return guarded(err, () => {
    const entry = readEntry(dir, slug);
    if (!entry) throw new PortfolioUsageError(`no existe «${slug}» en el portafolio`);
    writeEntry(dir, addStep(entry, text, opts.source, now));
    write(`Paso registrado en ${slug}\n`);
    return EXIT_SUCCESS;
  });
}

/**
 * `kodo portfolio event <slug> …` — registra una reunión o un correo relevante.
 *
 * @param {string} slug
 * @param {{ kind?: string, date?: string, title?: string, summary?: string, ref?: string, source?: string }} event
 * @param {PortfolioDeps} [deps]
 * @returns {number}
 */
export function runPortfolioEventCli(slug, event, deps = {}) {
  const { dir, write, err, now } = resolve(deps);
  return guarded(err, () => {
    const entry = readEntry(dir, slug);
    if (!entry) throw new PortfolioUsageError(`no existe «${slug}» en el portafolio`);
    writeEntry(dir, addEvent(entry, event, now));
    write(`Evento registrado en ${slug}\n`);
    return EXIT_SUCCESS;
  });
}
