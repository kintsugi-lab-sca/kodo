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
 * @typedef {{ path: string, label: string, kind: 'positiveInt'|'model'|'nonEmpty'|'cmuxColor'|'hostName'|'nudgeMode' }} EditableField
 */

// Set estricto de modelos soportados por kodo (D-07). kodo pasa este valor literal
// a `claude --model` (launch.js:198, manager.js:310). NOTA (Pitfall 6/A2): el binario
// `claude` también acepta ids completos (`claude-opus-4-x`), pero v1 fija el set corto
// por simetría con CONTEXT D-07 — un id completo manual se rechazaría conscientemente.
//
// KODO-12: `fable` entra al set porque es el default de `claude.orchestrator_model`.
// VERIFICADO contra el binario: `claude --help` lo documenta como alias de `--model`
// ("Provide an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')").
const MODELS = new Set(['fable', 'opus', 'sonnet', 'haiku']);

// Set de los 16 colores nombrados de cmux (VERIFIED contra el binario real,
// `cmux workspace-action --help`). v1 acepta SOLO los nombrados (no hex `#RRGGBB`),
// que es lo que usan los defaults de kodo (Amber/Green/Crimson/Blue). El cycle-through
// y el soporte hex quedan diferidos a v2 (CONTEXT deferred).
const CMUX_COLORS = new Set([
  'Red', 'Crimson', 'Orange', 'Amber', 'Olive', 'Green', 'Teal', 'Aqua',
  'Blue', 'Navy', 'Indigo', 'Purple', 'Magenta', 'Rose', 'Brown', 'Charcoal',
]);

// KODO-18: hosts (WorkspaceHost) elegibles desde `config.host`. FUENTE ÚNICA DE VERDAD
// — `src/host/interface.js` la IMPORTA de aquí en vez de duplicarla, y este módulo es
// el destino correcto de la constante por ser el puro (0 imports → sin ciclo con
// config.js, que sí importa a este). `'null'` NO está: es un host mock-only del
// contract test, jamás una elección del operador.
// KODO-31: `bb` es el tercero. A diferencia de cmux y orca NO es un terminal — lanza
// Claude Code por el Agent SDK sobre un thread propio— pero el eje es el mismo: un
// cliente donde vive la sesión.
const HOST_NAMES = Object.freeze(['cmux', 'orca', 'bb']);

// KODO-53: cómo llegan al orquestador los eventos del ciclo de vida. FUENTE ÚNICA DE
// VERDAD del set — `config.js` documenta la SEMÁNTICA de cada modo en el default;
// aquí vive solo el alfabeto válido, para que el validador no dependa de config.js
// (este módulo es puro, 0 imports → sin ciclo).
const NUDGE_MODES = Object.freeze(['inbox', 'keystroke', 'off']);

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
 * Valida que el modelo pertenezca al set estricto `{fable, opus, sonnet, haiku}` (CFG-01, D-07).
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
 * Valida el host (cliente) activo contra el set `{cmux, orca}` (KODO-18). Case-sensitive
 * y sin alias: el valor se compara luego por igualdad en `resolveHostName()` y en la
 * factory `getHost()`.
 *
 * Consecuencia deseada de estar en `getEditableFields`: `mergeAndValidateConfig` lo
 * valida al CARGAR, así que un `"host": "tmux"` escrito a mano cae al default `'cmux'`
 * con un warn NDJSON en vez de reventar el arranque del daemon con `Unknown host`.
 *
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateHostName(raw) {
  const s = String(raw).trim();
  return HOST_NAMES.includes(s)
    ? { ok: true, value: s }
    : { ok: false, error: `host debe ser uno de: ${HOST_NAMES.join(', ')}` };
}

/**
 * Valida el modo de aviso al orquestador (KODO-53): `inbox` | `keystroke` | `off`.
 *
 * Está en `getEditableFields` por la MISMA consecuencia deseada que `host`:
 * `mergeAndValidateConfig` lo valida al CARGAR, así que un `"nudges": "todos"` escrito a
 * mano cae al default `'inbox'` con un warn NDJSON en vez de dejar el carril de avisos en
 * un estado indefinido que solo se descubriría al cerrar una sesión.
 *
 * @param {any} raw
 * @returns {ValidationResult}
 */
export function validateNudgeMode(raw) {
  const s = String(raw).trim();
  return NUDGE_MODES.includes(s)
    ? { ok: true, value: s }
    : { ok: false, error: `nudges debe ser uno de: ${NUDGE_MODES.join(', ')}` };
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
    case 'hostName':    return validateHostName(raw);
    case 'nudgeMode':   return validateNudgeMode(raw);
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
 * Devuelve el REGISTRO de los 15 campos editables del editor de config (D-11/PERSIST-04).
 *
 * La lista está restringida EXPLÍCITAMENTE por construcción: NUNCA incluye descriptores
 * de `api_key_env`, `base_url`, `workspace_slug` ni `provider` (esas keys viven solo en
 * `~/.kodo/.env` o no son editables). Los paths de `states.*` se resuelven contra el
 * provider ACTIVO (`config.provider`) — solo el activo (discreción A3).
 *
 * KODO-18: `host` sí es editable (es el selector de cliente), y los 4 campos de
 * presentación por estado se resuelven contra el host ACTIVO — misma discreción A3 que
 * `states.*` con el provider. Un usuario de cmux ve sus 4 colores; uno de Orca, sus 4
 * columnas de tablero. El total NO crece con cada host nuevo.
 *
 * KODO-53: 13 → 14. El +1 es `orchestrator.nudges` — el carril por el que los eventos del
 * ciclo de vida llegan al orquestador. Entra en el registro por la validación al cargar,
 * no por vocación de crecer la lista: un valor inválido debe caer al default con un warn.
 *
 * KODO-67: 14 → 15. El +1 es `orchestrator.recycle_mb` — el umbral de transcript que
 * dispara la sugerencia de reciclado. Mismo criterio de entrada que el anterior: un
 * `"recycle_mb": "mucho"` escrito a mano tiene que caer al default con un warn en vez de
 * dejar la vigilancia en un estado indefinido que solo se descubriría meses después,
 * cuando el aviso que debía llegar no llegue.
 *
 * KODO-75: 15 → 16. El +1 es `review.max_rounds` — el tope del bucle coder ↔ reviewer.
 * Mismo criterio de entrada que los dos anteriores, y con una razón propia para no quedarse
 * fuera: un `"max_rounds": 0` escrito a mano no debe leerse como «sin tope», que es
 * exactamente el fallo del modelo original que esta clave existe para cerrar.
 *
 * @param {{ provider?: string, host?: string }} config - snapshot de config (solo se usan
 *   `config.provider` y `config.host`).
 * @returns {EditableField[]} descriptores `{path,label,kind}`: 16 con cmux u orca, 15 con
 *   bb (ese host no tiene canal de presentación por estado — ver `stateFields`).
 */
export function getEditableFields(config) {
  const provider = config?.provider ?? 'plane';
  const host = HOST_NAMES.includes(config?.host) ? config.host : 'cmux';
  // Presentación por estado del host ACTIVO: mismo eje semántico, distinto canal.
  /** @type {EditableField[]} */
  // KODO-31: `bb` rompe el patrón «4 campos de presentación por estado» y lo hace a
  // propósito: BB no tiene canal de presentación (ni color de tab ni columna de tablero),
  // así que inventarle cuatro campos para cuadrar el total sería mentirle al operador
  // sobre una capacidad que no existe. En su lugar el editor expone los 3 knobs que este
  // host SÍ tiene, y el total baja en uno — el registro sigue la capacidad real del host,
  // no un número.
  const stateFields = host === 'bb'
    ? [
        { path: 'bb.binary', label: 'Binario de BB', kind: 'nonEmpty' },
        { path: 'bb.server_url', label: 'URL del servidor BB', kind: 'nonEmpty' },
        { path: 'bb.idle_close_grace_s', label: 'Gracia de autocierre (s)', kind: 'positiveInt' },
      ]
    : host === 'orca'
    ? [
        { path: 'orca.statuses.running', label: 'Estado Orca: running', kind: 'nonEmpty' },
        { path: 'orca.statuses.done', label: 'Estado Orca: done', kind: 'nonEmpty' },
        { path: 'orca.statuses.error', label: 'Estado Orca: error', kind: 'nonEmpty' },
        { path: 'orca.statuses.review', label: 'Estado Orca: review', kind: 'nonEmpty' },
      ]
    : [
        { path: 'cmux.colors.running', label: 'Color: running', kind: 'cmuxColor' },
        { path: 'cmux.colors.done', label: 'Color: done', kind: 'cmuxColor' },
        { path: 'cmux.colors.error', label: 'Color: error', kind: 'cmuxColor' },
        { path: 'cmux.colors.review', label: 'Color: review', kind: 'cmuxColor' },
      ];
  return [
    { path: 'host', label: 'Cliente (host)', kind: 'hostName' },
    { path: 'claude.default_model', label: 'Modelo por defecto', kind: 'model' },
    // KODO-12: modelo del ORQUESTADOR, independiente del de las sesiones de trabajo.
    { path: 'claude.orchestrator_model', label: 'Modelo del orquestador', kind: 'model' },
    { path: 'claude.max_parallel', label: 'Máximo en paralelo', kind: 'positiveInt' },
    { path: `providers.${provider}.states.trigger`, label: 'Estado: trigger', kind: 'nonEmpty' },
    { path: `providers.${provider}.states.review`, label: 'Estado: review', kind: 'nonEmpty' },
    { path: `providers.${provider}.states.done`, label: 'Estado: done', kind: 'nonEmpty' },
    { path: 'server.idle_threshold_min', label: 'Umbral idle (min)', kind: 'positiveInt' },
    { path: 'server.stuck_threshold_min', label: 'Umbral stuck (min)', kind: 'positiveInt' },
    // KODO-53: carril de avisos al orquestador (bandeja / teclado / nada).
    { path: 'orchestrator.nudges', label: 'Avisos al orquestador', kind: 'nudgeMode' },
    // KODO-67: umbral de transcript (MB) que dispara la sugerencia de reciclado.
    { path: 'orchestrator.recycle_mb', label: 'Reciclar orquestador (MB)', kind: 'positiveInt' },
    // KODO-75: tope de rondas del bucle coder ↔ reviewer antes de escalar al operador.
    { path: 'review.max_rounds', label: 'Tope de rondas de revisión', kind: 'positiveInt' },
    ...stateFields,
  ];
}

export { MODELS, CMUX_COLORS, HOST_NAMES, NUDGE_MODES };
