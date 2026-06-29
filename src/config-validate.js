// @ts-check
//
// Validadores PUROS para el editor de configuración del dashboard (Phase 63, D-06).
//
// Contrato (D-06/CFG-05): cada validador es una función pura, sin I/O, que NUNCA
// lanza ante input arbitrario y devuelve uno de dos shapes:
//   - { ok: true,  value: <valor saneado> }
//   - { ok: false, error: <mensaje en español, copy estable> }
//
// La validación corre SIEMPRE antes de `saveConfig` (D-05): un valor inválido jamás
// alcanza el disco (T-63-01). Los mensajes de error están en español y son estables
// para que los tests puedan asertar igualdad si hiciera falta.
//
// Este módulo es 100% determinista: no importa `node:fs`, ni ink, ni picocolors —
// preserva la color-isolation y el invariante 0-I/O del carril local de Phase 63.

/**
 * @typedef {{ ok: true, value: any } | { ok: false, error: string }} ValidationResult
 */

/**
 * @typedef {{ path: string, label: string, kind: 'positiveInt'|'model'|'nonEmpty'|'cmuxColor' }} EditableField
 */

// Set estricto de modelos soportados por kodo (D-07). kodo pasa este valor literal
// a `claude --model` (launch.js:198, manager.js:310). NOTA (Pitfall 6/A2): el binario
// `claude` también acepta ids completos (`claude-opus-4-x`), pero v1 fija el set corto
// por simetría con CONTEXT D-07 — un id completo manual se rechazaría conscientemente.
const MODELS = new Set(['opus', 'sonnet', 'haiku']);

// Set de los 16 colores nombrados de cmux (VERIFIED contra el binario real,
// `cmux workspace-action --help`). v1 acepta SOLO los nombrados (no hex `#RRGGBB`),
// que es lo que usan los defaults de kodo (Amber/Green/Crimson/Blue). El cycle-through
// y el soporte hex quedan diferidos a v2 (CONTEXT deferred).
const CMUX_COLORS = new Set([
  'Red', 'Crimson', 'Orange', 'Amber', 'Olive', 'Green', 'Teal', 'Aqua',
  'Blue', 'Navy', 'Indigo', 'Purple', 'Magenta', 'Rose', 'Brown', 'Charcoal',
]);

/**
 * Valida un entero estrictamente positivo (>= 1). Cubre `max_parallel`,
 * `idle_threshold_min`, `stuck_threshold_min` (CFG-01/CFG-03).
 *
 * Anti-ReDoS (T-63-05): se exige `/^\d+$/` sobre el string ya recortado (input corto,
 * regex acotada — nunca se compila una regex desde el input del operador).
 *
 * @param {any} raw - valor crudo del buffer (string, pero never-throws ante cualquier tipo).
 * @returns {ValidationResult}
 */
export function validatePositiveInt(raw) {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return { ok: false, error: 'debe ser un entero positivo' };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'debe ser un entero positivo' };
  return { ok: true, value: n };
}

/**
 * Valida que el modelo pertenezca al set estricto `{opus, sonnet, haiku}` (CFG-01, D-07).
 *
 * LÍMITE CONOCIDO (Pitfall 6/A2): un id completo `claude-*` válido para el binario
 * `claude --model` se rechaza en v1. Es una decisión de diseño aceptada por simetría
 * con CONTEXT D-07, no un bug.
 *
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateModel(raw) {
  const s = String(raw).trim();
  return MODELS.has(s)
    ? { ok: true, value: s }
    : { ok: false, error: `modelo debe ser uno de: ${[...MODELS].join(', ')}` };
}

/**
 * Valida un string no-vacío tras recortar espacios. Cubre `states.trigger/review/done`
 * del provider activo (CFG-02).
 *
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateNonEmpty(raw) {
  const s = String(raw).trim();
  return s.length > 0
    ? { ok: true, value: s }
    : { ok: false, error: 'no puede estar vacío' };
}

/**
 * Valida un color de cmux contra el set de 16 nombrados (CFG-04). Case-sensitive:
 * `amber` (minúscula) se rechaza; solo `Amber` es válido.
 *
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateCmuxColor(raw) {
  const s = String(raw).trim();
  return CMUX_COLORS.has(s)
    ? { ok: true, value: s }
    : { ok: false, error: 'color de cmux desconocido (ver lista de colores nombrados)' };
}

/**
 * Despacha la validación según `field.kind`. Never-throws ante field/raw arbitrarios.
 *
 * @param {EditableField} field
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateField(field, raw) {
  switch (field?.kind) {
    case 'positiveInt': return validatePositiveInt(raw);
    case 'model':       return validateModel(raw);
    case 'nonEmpty':    return validateNonEmpty(raw);
    case 'cmuxColor':   return validateCmuxColor(raw);
    default:            return { ok: false, error: 'campo no editable' };
  }
}

/**
 * Lee un valor anidado por path dotted (`a.b.c`). Puro, never-throws: devuelve
 * `undefined` si algún tramo intermedio no existe.
 *
 * @param {any} obj
 * @param {string} dotted
 * @returns {any}
 */
export function getByPath(obj, dotted) {
  const keys = String(dotted).split('.');
  let current = obj;
  for (const k of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[k];
  }
  return current;
}

/**
 * Escribe un valor anidado por path dotted MUTANDO `obj` (el consumidor pasa siempre
 * un `structuredClone` — ver Plan 02/Pitfall 1). NO reusa `setNestedValue` de cli.js
 * (que muta su input bajo otro contrato): aquí se replica solo la lógica split-by-dot
 * como variante para el clon. Never-throws.
 *
 * @param {any} obj - objeto destino (idealmente un clon, nunca DEFAULT_CONFIG).
 * @param {string} dotted
 * @param {any} value
 * @returns {void}
 */
export function setByPath(obj, dotted, value) {
  const keys = String(dotted).split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] == null || typeof current[keys[i]] !== 'object') {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Devuelve el REGISTRO de los 11 campos editables del editor de config (D-11/PERSIST-04).
 *
 * La lista está restringida EXPLÍCITAMENTE por construcción: NUNCA incluye descriptores
 * de `api_key_env`, `base_url`, `workspace_slug` ni `provider` (esas keys viven solo en
 * `~/.kodo/.env` o no son editables). Los paths de `states.*` se resuelven contra el
 * provider ACTIVO (`config.provider`) — solo el activo (discreción A3).
 *
 * @param {{ provider: string }} config - snapshot de config (se usa solo `config.provider`).
 * @returns {EditableField[]} exactamente 11 descriptores `{path,label,kind}`.
 */
export function getEditableFields(config) {
  const provider = config?.provider ?? 'plane';
  return [
    { path: 'claude.default_model', label: 'Modelo por defecto', kind: 'model' },
    { path: 'claude.max_parallel', label: 'Máximo en paralelo', kind: 'positiveInt' },
    { path: `providers.${provider}.states.trigger`, label: 'Estado: trigger', kind: 'nonEmpty' },
    { path: `providers.${provider}.states.review`, label: 'Estado: review', kind: 'nonEmpty' },
    { path: `providers.${provider}.states.done`, label: 'Estado: done', kind: 'nonEmpty' },
    { path: 'server.idle_threshold_min', label: 'Umbral idle (min)', kind: 'positiveInt' },
    { path: 'server.stuck_threshold_min', label: 'Umbral stuck (min)', kind: 'positiveInt' },
    { path: 'cmux.colors.running', label: 'Color: running', kind: 'cmuxColor' },
    { path: 'cmux.colors.done', label: 'Color: done', kind: 'cmuxColor' },
    { path: 'cmux.colors.error', label: 'Color: error', kind: 'cmuxColor' },
    { path: 'cmux.colors.review', label: 'Color: review', kind: 'cmuxColor' },
  ];
}

export { MODELS, CMUX_COLORS };
