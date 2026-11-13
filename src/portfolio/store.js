// @ts-check
//
// src/portfolio/store.js — Portafolio: la «situación» de cada proyecto en marcha.
//
// Un fichero JSON por proyecto en `~/.kodo/portfolio/<slug>.json`. Lo ESCRIBE el orquestador
// (vía `kodo portfolio set|step|event`) y lo LEE MyTasks, que vigila el directorio y repinta.
// El fichero es el contrato entre ambos: un cambio INCOMPATIBLE de forma sube `SCHEMA_VERSION`;
// un campo nuevo opcional (como `events`) no, y el lector lo trata como ausente = vacío.
//
// Qué guarda y qué NO: solo la narrativa que no se puede derivar (titular, siguiente paso, a
// quién se espera, bloqueos, hitos externos, últimos pasos). Los contadores de tareas y las
// fechas de vencimiento salen de Plane en el lector — duplicarlos aquí los dejaría rancios.
//
// Un «proyecto» del portafolio apunta a un proyecto de Plane y, opcionalmente, a uno de sus
// módulos por NOMBRE (misma clave que `projects.json`): Aparca&Go es un módulo de Roman;
// Clipping es un proyecto entero.
//
// Escritura atómica (tmp + rename) y SIN lock: el escritor habitual es uno (el orquestador) y
// el único otro es el archivado desde MyTasks. Una carrera read-modify-write pierde como mucho
// un campo, que el siguiente `set` repone.

import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { kodoPath } from '../paths.js';

export const SCHEMA_VERSION = 1;

/** Vocabulario cerrado del semáforo. */
export const STATUSES = ['on_track', 'at_risk', 'blocked', 'waiting', 'paused', 'done'];

/** Tope de la cronología: se conservan los pasos más recientes. */
export const MAX_STEPS = 30;

/** Tope de reuniones y correos: se conservan los más recientes. */
export const MAX_EVENTS = 20;

/** Tipos de evento externo que admite una ficha. */
export const EVENT_KINDS = ['meeting', 'email'];

/** Tope de longitud de cualquier texto libre. */
export const MAX_TEXT_LEN = 500;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @typedef {{ date: string, label: string }} PortfolioDate
 * @typedef {{ at: string, text: string, source: string | null }} PortfolioStep
 * @typedef {{ kind: string, date: string, title: string, summary: string | null, ref: string | null }} PortfolioEvent
 * @typedef {{
 *   schema_version: number,
 *   slug: string,
 *   name: string,
 *   plane: { project_id: string, module: string | null },
 *   archived: boolean,
 *   status: string | null,
 *   headline: string | null,
 *   next_step: string | null,
 *   waiting_on: string | null,
 *   blockers: string[],
 *   dates: PortfolioDate[],
 *   steps: PortfolioStep[],
 *   events?: PortfolioEvent[],
 *   updated_at: string,
 *   updated_by: string | null,
 * }} PortfolioEntry
 *
 * Parche de `set`: `undefined` = no tocar; cadena vacía = borrar el campo opcional.
 * `blockers` y `dates` REEMPLAZAN la lista entera (el escritor declara la verdad actual).
 *
 * @typedef {{
 *   name?: string,
 *   planeProject?: string,
 *   module?: string,
 *   status?: string,
 *   headline?: string,
 *   nextStep?: string,
 *   waitingOn?: string,
 *   blockers?: string[],
 *   dates?: string[],
 *   archived?: boolean,
 *   source?: string,
 * }} PortfolioPatch
 */

/** Error de ENTRADA (slug, estado, fecha…): el handler lo mapea a EXIT_USAGE. */
export class PortfolioUsageError extends Error {}

/** @returns {string} `~/.kodo/portfolio`, resuelto en la llamada. */
export function defaultPortfolioDir() {
  return kodoPath('portfolio');
}

/**
 * Texto libre a una sola línea: colapsa espacios y caracteres de control, y recorta.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function cleanText(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f\s]+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

/**
 * @param {string} slug
 * @returns {string} el slug, validado.
 */
export function assertSlug(slug) {
  if (!SLUG_RE.test(slug)) {
    throw new PortfolioUsageError(`slug inválido «${slug}»: minúsculas, dígitos y guiones (máx. 40)`);
  }
  return slug;
}

/**
 * @param {string} dir
 * @param {string} slug
 * @returns {PortfolioEntry | null} `null` si no existe. Lanza si el JSON está corrupto.
 */
export function readEntry(dir, slug) {
  let raw;
  try {
    raw = readFileSync(join(dir, `${assertSlug(slug)}.json`), 'utf-8');
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return null;
    throw e;
  }
  return JSON.parse(raw);
}

/**
 * Todas las fichas legibles, ordenadas por nombre. Un fichero corrupto se omite: el listado
 * no debe caerse por una ficha rota.
 *
 * @param {string} dir
 * @returns {PortfolioEntry[]}
 */
export function listEntries(dir) {
  let names;
  try {
    names = readdirSync(dir);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return [];
    throw e;
  }
  const entries = [];
  for (const file of names) {
    if (!file.endsWith('.json')) continue;
    try {
      entries.push(JSON.parse(readFileSync(join(dir, file), 'utf-8')));
    } catch {
      // ficha ilegible: se omite
    }
  }
  return entries.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * @param {string} dir
 * @param {PortfolioEntry} entry
 */
export function writeEntry(dir, entry) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${assertSlug(entry.slug)}.json`);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n');
  renameSync(tmp, path); // swap atómico intra-fs
}

/** @param {string} date @returns {boolean} `YYYY-MM-DD` que existe en el calendario. */
function isValidDate(date) {
  if (!DATE_RE.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

/**
 * `YYYY-MM-DD=etiqueta` → hito. La fecha debe existir en el calendario.
 *
 * @param {string} raw
 * @returns {PortfolioDate}
 */
function parseDate(raw) {
  const eq = raw.indexOf('=');
  const date = eq === -1 ? raw : raw.slice(0, eq);
  const label = eq === -1 ? '' : cleanText(raw.slice(eq + 1));
  if (!isValidDate(date) || label === '') {
    throw new PortfolioUsageError(`fecha inválida «${raw}»: se espera YYYY-MM-DD=etiqueta`);
  }
  return { date, label };
}

/** @param {string | undefined} v @returns {string | null | undefined} */
function optionalText(v) {
  if (v === undefined) return undefined;
  const text = cleanText(v);
  return text === '' ? null : text;
}

/**
 * Aplica un parche sobre la ficha existente (o crea una nueva). Puro: no toca disco.
 *
 * @param {PortfolioEntry | null} current
 * @param {string} slug
 * @param {PortfolioPatch} patch
 * @param {string} now - instante ISO 8601.
 * @returns {PortfolioEntry}
 */
export function applyPatch(current, slug, patch, now) {
  assertSlug(slug);
  if (patch.status !== undefined && patch.status !== '' && !STATUSES.includes(patch.status)) {
    throw new PortfolioUsageError(`estado inválido «${patch.status}»: ${STATUSES.join(' | ')}`);
  }

  /** @type {PortfolioEntry} */
  const entry = current
    ? { ...current, plane: { ...current.plane } }
    : {
        schema_version: SCHEMA_VERSION,
        slug,
        name: '',
        plane: { project_id: '', module: null },
        archived: false,
        status: null,
        headline: null,
        next_step: null,
        waiting_on: null,
        blockers: [],
        dates: [],
        steps: [],
        updated_at: now,
        updated_by: null,
      };

  if (patch.name !== undefined) entry.name = cleanText(patch.name);
  if (patch.planeProject !== undefined) entry.plane.project_id = cleanText(patch.planeProject);
  const module = optionalText(patch.module);
  if (module !== undefined) entry.plane.module = module;
  if (patch.status !== undefined) entry.status = patch.status === '' ? null : patch.status;
  const headline = optionalText(patch.headline);
  if (headline !== undefined) entry.headline = headline;
  const nextStep = optionalText(patch.nextStep);
  if (nextStep !== undefined) entry.next_step = nextStep;
  const waitingOn = optionalText(patch.waitingOn);
  if (waitingOn !== undefined) entry.waiting_on = waitingOn;
  if (patch.blockers !== undefined) entry.blockers = patch.blockers.map(cleanText).filter(Boolean);
  if (patch.dates !== undefined) {
    entry.dates = patch.dates.map(parseDate).sort((a, b) => a.date.localeCompare(b.date));
  }
  if (patch.archived !== undefined) entry.archived = patch.archived;

  if (entry.name === '' || entry.plane.project_id === '') {
    throw new PortfolioUsageError(
      `«${slug}» no existe todavía: para crearlo hacen falta --name y --plane-project`,
    );
  }

  entry.updated_at = now;
  entry.updated_by = optionalText(patch.source) ?? null;
  return entry;
}

/**
 * Antepone un paso a la cronología (el más reciente primero) y recorta a `MAX_STEPS`. Puro.
 *
 * @param {PortfolioEntry} entry
 * @param {string} text
 * @param {string | undefined} source - quién lo registra (sesión, tarea…).
 * @param {string} now
 * @returns {PortfolioEntry}
 */
export function addStep(entry, text, source, now) {
  const clean = cleanText(text);
  if (clean === '') throw new PortfolioUsageError('el texto del paso está vacío');
  const by = optionalText(source) ?? null;
  return {
    ...entry,
    steps: [{ at: now, text: clean, source: by }, ...(entry.steps || [])].slice(0, MAX_STEPS),
    updated_at: now,
    updated_by: by,
  };
}

/**
 * Registra una reunión o un correo relevante (el más reciente primero) y recorta a
 * `MAX_EVENTS`. Con `ref`, un evento del mismo tipo y la misma `ref` se REEMPLAZA: repetir
 * el barrido no duplica. Puro.
 *
 * @param {PortfolioEntry} entry
 * @param {{ kind?: string, date?: string, title?: string, summary?: string, ref?: string, source?: string }} event
 * @param {string} now
 * @returns {PortfolioEntry}
 */
export function addEvent(entry, event, now) {
  const kind = String(event.kind ?? '');
  if (!EVENT_KINDS.includes(kind)) {
    throw new PortfolioUsageError(`tipo inválido «${kind}»: ${EVENT_KINDS.join(' | ')}`);
  }
  const date = String(event.date ?? '');
  if (!isValidDate(date)) {
    throw new PortfolioUsageError(`fecha inválida «${date}»: se espera YYYY-MM-DD`);
  }
  const title = cleanText(event.title);
  if (title === '') throw new PortfolioUsageError('el título del evento está vacío');
  const ref = optionalText(event.ref) ?? null;
  const rest = (entry.events || []).filter((e) => !(ref !== null && e.kind === kind && e.ref === ref));
  const events = [{ kind, date, title, summary: optionalText(event.summary) ?? null, ref }, ...rest]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_EVENTS);
  return { ...entry, events, updated_at: now, updated_by: optionalText(event.source) ?? null };
}
