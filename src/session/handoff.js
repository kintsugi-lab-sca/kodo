// @ts-check
//
// src/session/handoff.js — Phase 74 Plan 01. El módulo ÚNICO dueño del contrato de
// formato del handoff (D-13): writer y parser viven JUNTOS porque la Phase 75 debe
// parsear exactamente lo que la Phase 74 escribe — dos implementaciones del formato
// divergirían. El hook (`session-end.js`) queda como I/O + orquestación; aquí solo
// hay funciones PURAS: reciben datos, no los buscan.
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ─────────────────────────
// Ni `node:fs`, ni `node:path`, ni `node:os`, ni `../config.js`, ni `./state.js`.
// Todo lo que necesite llega por parámetro. Mismo contrato que `src/logger-noop.js`.
// Razón dura: la Phase 75 importará este parser desde `src/cli/dashboard/plan.js`,
// que es un LEAF deliberado; un import de `config.js` (que computa KODO_DIR en
// module-load) arrastraría su grafo entero hasta el dashboard y rompería LOG-12.
// Si hiciera falta una ruta, se replica la convención a mano — jamás se importa
// `KODO_DIR`. Guardián runtime: `test/check-isolation.test.js` asserta cero imports.
//
// ── SOLO OPERACIONES DE STRING (anti-ReDoS) ───────────────────────────────────────
// `startsWith`/`includes`/`indexOf`/`split`/`slice`/`trim`. CERO construcciones de
// expresión regular en todo el módulo: el markdown del plan es texto arbitrario
// escrito por un LLM y este módulo no debe ofrecer superficie de retroceso
// catastrófico (T-74-09). Precedente: `plan.js:119-121` (D-13 Phase 44).
//
// ── D-12: SIN PODA NI CAP ─────────────────────────────────────────────────────────
// Este módulo NO implementa recorte de bloques antiguos. Los handoffs se acumulan sin
// límite en v0.17 (una tarea típica vive 1-3 sesiones; podar ahora es especulativo —
// precedente «medir antes de arreglar», M21). Revisitar en v0.18 con datos reales.

/** Prefijo del marcador HTML de D-01. Abre el comentario y nombra el contrato. */
const MARKER_OPEN = '<!-- kodo:handoff';
/** Cierre del comentario HTML. */
const MARKER_CLOSE = '-->';
/** Prefijo de la línea de heading de un bloque de handoff (D-01). */
const HEADING_PREFIX = '## Handoff ';
/** Prefijo de la línea del NEXT dentro de un bloque (D-02). */
const NEXT_PREFIX = '**NEXT:**';
/** Truncado del NEXT al persistir en state.json (D-02). */
const NEXT_MAX_LEN = 200;

/**
 * Enum CERRADO de motivos de cierre (D-03). `input.reason` llega por stdin de Claude
 * Code (entrada NO confiable) y acaba interpolado en markdown: se valida contra esta
 * lista ANTES de tocar el fichero. Misma disciplina que T-71-12.
 * @type {readonly string[]}
 */
export const HANDOFF_REASONS = Object.freeze([
  'clear',
  'logout',
  'prompt_input_exit',
  'bypass_permissions_disabled',
  'other',
]);

/**
 * Colapsa cualquier motivo desconocido a `'other'` (D-03, mitigación T-74-02).
 * Espejo de shape de `labels.js:28-31` (array literal + `.includes()`, desconocido → default).
 *
 * @param {unknown} reason  Motivo crudo (típicamente `input.reason` de stdin).
 * @returns {string} Un miembro garantizado de `HANDOFF_REASONS`.
 */
export function normalizeReason(reason) {
  if (typeof reason !== 'string') return 'other';
  return HANDOFF_REASONS.includes(reason) ? reason : 'other';
}

/**
 * Aplana un texto no confiable a UNA sola línea acotada (mitigación T-74-03).
 *
 * `session.summary` y `session.task_ref` vienen del provider remoto y NO están
 * cubiertos por el enum de D-03. Colapsar los saltos de línea impide que un summary
 * hostil inyecte una línea `## Handoff … <!-- kodo:handoff … -->` forjada que haría
 * creer a D-04 que el LLM ya escribió su bloque — matando el backstop de LIVE-03.
 *
 * Decisión explícita: NO se escapan backticks ni `#`. Es markdown en un fichero
 * local, no HTML ni shell; el único riesgo ESTRUCTURAL es el salto de línea.
 *
 * @param {unknown} text     Texto crudo.
 * @param {number} [maxLen]  Tope de longitud (por defecto 120).
 * @returns {string} Una línea sin CR/LF, con runs de espacios colapsados, de ≤ maxLen. Nunca lanza.
 */
export function sanitizeInline(text, maxLen = 120) {
  if (typeof text !== 'string') return '';
  // split/join en vez de .replace(/\r|\n/g, ' ') — cero regex (T-74-09).
  const flat = text.split('\r').join(' ').split('\n').join(' ');
  // filter(Boolean) sobre los trozos hace trim y colapsa los runs en un solo paso.
  const collapsed = flat
    .split(' ')
    .filter((part) => part.length > 0)
    .join(' ');
  // El trim final solo puede acortar → la salida nunca supera maxLen.
  return collapsed.slice(0, maxLen).trim();
}

/**
 * Guard de contención de ruta (mitigación T-74-01). Espejo verbatim de `plan.js:119-121`
 * (`String.includes`, NUNCA RegExp).
 *
 * D-09 convierte el hook en ESCRITOR: este guard ya no evita solo LEER fuera de
 * `~/.kodo/plans/` — evita CREAR ficheros fuera del root.
 *
 * @param {unknown} taskId  Identificador de tarea del provider.
 * @returns {boolean} `true` solo si es seguro construir `<plansDir>/<taskId>.md` con él.
 */
export function isSafeTaskId(taskId) {
  if (typeof taskId !== 'string' || taskId.length === 0) return false;
  return !taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..');
}

/**
 * Cabecera mínima del create-if-missing de D-09. Devuelve el string; no escribe nada
 * (este módulo no tiene fs — el I/O vive en el hook).
 *
 * @param {{ taskRef?: unknown, summary?: unknown }} input  Campos del provider (no confiables → saneados).
 * @returns {string} `# <taskRef> — <summary>\n`
 */
export function buildPlanHeader({ taskRef, summary }) {
  return `# ${sanitizeInline(taskRef)} — ${sanitizeInline(summary)}\n`;
}

/**
 * Relleno a dos dígitos para la fecha local del heading. Sin regex, sin padStart sobre
 * input externo — solo composición de string.
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Compone la fecha-hora LOCAL `YYYY-MM-DD HH:MM` del heading (D-01). Local porque la
 * lee un humano; el `at=` del marcador va en UTC para las máquinas.
 * @param {Date} at
 * @returns {string}
 */
function formatLocalStamp(at) {
  const y = at.getFullYear();
  const mo = pad2(at.getMonth() + 1);
  const d = pad2(at.getDate());
  const h = pad2(at.getHours());
  const mi = pad2(at.getMinutes());
  return `${y}-${mo}-${d} ${h}:${mi}`;
}

/**
 * Construye el bloque MECÁNICO de handoff (D-03) — el backstop de LIVE-03 que corre
 * cuando el LLM no escribió el suyo. Contenido determinista, SIN red y SIN LLM.
 *
 * Visualmente distinguible sin depender del marcador (que hoy se ve crudo en el
 * overlay, pero que la Phase 75 dejará de pintar): heading `— automático` + `author=auto`.
 *
 * **Sin `NEXT:`** — LIVE-03 lo exige explícitamente: un backstop mecánico no puede
 * inventarse el siguiente paso, y `extractNext` sobre este bloque debe devolver `null`.
 *
 * @param {{ sessionId?: string, reason?: unknown, status?: unknown, at?: Date }} input
 *   `at` se INYECTA (default `new Date()`) para que los tests sean deterministas.
 * @returns {string} El bloque completo, listo para appendear al plan.
 */
export function buildHandoffBlock({ sessionId, reason, status, at = new Date() }) {
  // D-01: heading + marcador en la MISMA línea. El marcador es la única vía fiable
  // para D-04 (saber DE QUÉ SESIÓN es un bloque) — sin él, la acumulación de LIVE-02
  // haría indistinguibles los bloques y LIVE-03 no podría existir.
  const marker = `${MARKER_OPEN} v=1 session=${sessionId} author=auto at=${at.toISOString()} ${MARKER_CLOSE}`;
  const heading = `${HEADING_PREFIX}${formatLocalStamp(at)} — automático ${marker}`;
  // normalizeReason ANTES de interpolar (D-03/T-74-02); sanitizeInline sobre el status
  // para que nada pueda romper el bloque en líneas nuevas (T-74-03).
  const hecho = `**Hecho:** Sesión cerrada (motivo: ${normalizeReason(reason)}, estado: ${sanitizeInline(status)})`;
  const pendiente = '**Pendiente:** Sin handoff del LLM — revisar la tarea manualmente';
  return `${heading}\n\n${hecho}\n${pendiente}\n`;
}
