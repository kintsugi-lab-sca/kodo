// @ts-check
import { VALID_PRIORITIES } from '../../interface.js';
import { parseKodoLabels } from '../../labels.js';

/**
 * @typedef {{
 *   labels: Array<{id: string, name: string}>,
 *   projectIdentifier: string,
 *   baseUrl: string,
 *   webUrl?: string,
 *   workspaceSlug: string,
 *   stateMap?: Map<string, string>,
 * }} NormalizeContext
 */

/**
 * Strip HTML tags and collapse whitespace to produce plain text.
 *
 * KODO-13: los tags se sustituyen por un ESPACIO, no por vacío. Plane no deja whitespace
 * entre bloques (`<p>uno</p><p>dos</p>`), así que borrarlos a secas pegaba la última
 * palabra de un párrafo con la primera del siguiente ("…clipping (roman)Contexto y rol…")
 * y convertía el brief de arranque en un muro ilegible. El colapso de whitespace posterior
 * absorbe los espacios sobrantes, así que el resto de la salida no cambia.
 *
 * @param {string|null|undefined} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve work item label IDs (UUIDs) or label objects to human-readable names.
 *
 * Handles two formats:
 * - Array of objects with .name → extract names directly
 * - Array of UUID strings → look up each in labelsMap by id
 *
 * @param {Array<any>|null|undefined} labelIds
 * @param {Array<{id: string, name: string}>} labelsMap
 * @returns {string[]}
 */
export function resolveWorkItemLabels(labelIds, labelsMap) {
  if (!Array.isArray(labelIds) || labelIds.length === 0) return [];

  // If first element is an object with .name, extract names directly
  if (typeof labelIds[0] === 'object' && labelIds[0] !== null && labelIds[0].name) {
    return labelIds.map((l) => l.name);
  }

  // UUIDs — look up in labelsMap
  const mapById = new Map(labelsMap.map((l) => [l.id, l.name]));
  return labelIds
    .map((id) => mapById.get(id))
    .filter(Boolean);
}

/**
 * Resolve a work item's `assignees` to an array of user-UUID strings (KODO-58).
 *
 * Plane devuelve `assignees` como array de UUIDs, pero algunas respuestas (y los
 * payloads de webhook) traen objetos `{id, display_name, …}` en su lugar. Se aceptan
 * las dos formas — mismo criterio defensivo que `resolveWorkItemLabels`, que ya
 * tolera UUID-string y objeto para el mismo tipo de campo.
 *
 * NO se resuelve el UUID a nombre: la comparación aguas arriba es contra el `id` de
 * `GET /users/me`, y traducir a display_name solo añadiría un punto donde dos personas
 * con el mismo nombre visible colisionan.
 *
 * @param {Array<any>|null|undefined} assignees
 * @returns {string[]}
 */
export function resolveAssignees(assignees) {
  if (!Array.isArray(assignees)) return [];
  return assignees
    .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' ? a.id : null))
    .filter((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Convert a raw Plane API work item to a canonical TaskItem.
 *
 * Pure function — no API calls, no side effects.
 *
 * @param {object} workItem - Raw Plane API work item response
 * @param {NormalizeContext} context - Resolution context (labels, project info, URLs)
 * @returns {import('../../interface.js').TaskItem}
 */
export function normalizeWorkItem(workItem, context) {
  const ref = `${context.projectIdentifier}-${workItem.sequence_id}`;

  // OPEN-04 / D-08: a work item whose project identifier is unresolved (falsy or the
  // literal 'UNKNOWN', mirroring parseTriggerEvent's UNKNOWN fallback) has no reliable
  // browse path — emit NO url rather than a dead .../browse/UNKNOWN-<seq> link. The
  // launcher (Plan 48-02) stays dumb: the row simply arrives with no task_url.
  const identifierUnresolved =
    !context.projectIdentifier || context.projectIdentifier === 'UNKNOWN';

  // OPEN-04 / D-06 / D-07: route the browse URL through the web host. webUrl falls back
  // to baseUrl when unset (resolve-on-read) → unified deploys stay byte-identical; split
  // deploys point at the web host instead of the API host.
  const browseHost = context.webUrl ?? context.baseUrl;

  return {
    id: workItem.id,
    ref,
    title: workItem.name,
    description: stripHtml(workItem.description_html || ''),
    labels: resolveWorkItemLabels(workItem.labels, context.labels),
    projectId: workItem.project_detail?.id || workItem.project,
    projectName: workItem.project_detail?.name || '',
    groups: [],
    url: identifierUnresolved
      ? undefined
      : `${browseHost}/${context.workspaceSlug}/browse/${ref}`,
    priority: VALID_PRIORITIES.includes(workItem.priority) ? workItem.priority : null,
    assignees: resolveAssignees(workItem.assignees),   // KODO-58: UUIDs de usuario
    state: workItem.state_detail?.name || context.stateMap?.get(workItem.state) || undefined,
    updated_at: workItem.updated_at,    // D-03 Phase 28: paridad cross-provider
    created_at: workItem.created_at,    // D-03 Phase 28: paridad cross-provider
  };
}

/**
 * Parse a Plane webhook payload into a canonical TriggerEvent.
 *
 * Returns null if the event type is not a work item event.
 * Pure, synchronous function — uses cached label data for resolution.
 *
 * @param {object} rawPayload - The webhook body object
 * @param {Array<{id: string, name: string}>} labelCache - Cached project labels
 * @param {Array<{id: string, identifier: string, name: string}>} [projects] - Configured projects for identifier lookup
 * @returns {import('../../interface.js').TriggerEvent|null}
 */
export function parseTriggerEvent(rawPayload, labelCache, projects = []) {
  if (rawPayload.event !== 'issue' && rawPayload.event !== 'work_item') {
    return null;
  }

  const data = rawPayload.data;
  // Resolve project identifier: prefer project_detail (API), fall back to projects config (webhook)
  let projectIdentifier = data.project_detail?.identifier;
  if (!projectIdentifier && data.project && projects.length > 0) {
    const proj = projects.find((p) => p.id === data.project);
    projectIdentifier = proj?.identifier;
  }
  const taskRef = `${projectIdentifier || 'UNKNOWN'}-${data.sequence_id}`;

  // Resolve labels and extract kodo configuration
  const resolvedNames = resolveWorkItemLabels(data.labels, labelCache);
  const resolvedLabelObjects = resolvedNames.map((name) => ({ name }));
  const kodoConfig = parseKodoLabels(resolvedLabelObjects);

  return {
    taskRef,
    action: rawPayload.action,
    provider: 'plane',
    raw: { ...rawPayload, kodoConfig },
  };
}

/**
 * Etiqueta HTML ESCAPADA al principio del body (`&lt;p&gt;`, `&lt;/ul&gt;`, `&lt;h2 …`).
 * Ancla en el inicio a propósito: la señal es «el body ENTERO es HTML escapado», no
 * «contiene una entidad suelta».
 */
const ESCAPED_TAG_LEADING = /^\s*&lt;\/?[a-z]/i;

/** Etiqueta HTML CRUDA al principio del body — el body ya viene en HTML. */
const RAW_TAG_LEADING = /^\s*<\/?[a-z]/i;

/**
 * Cualquier etiqueta cruda en el body. Veto del des-escape: un body MIXTO (HTML crudo
 * + entidades que el autor escapó a propósito para MOSTRAR `<p>` como texto) no se
 * des-escapa — ahí las entidades son contenido, no un error de codificación.
 * Clase negada (no `.*`) para que el match sea lineal (anti-ReDoS, igual que D-10).
 */
const RAW_TAG_ANYWHERE = /<\/?[a-z][^>]*>/i;

/**
 * Des-escapa UN nivel de entidades HTML básicas.
 *
 * El orden es load-bearing: `&amp;` va el ÚLTIMO. Al revés, `&amp;lt;` se convertiría
 * primero en `&lt;` y después en `<` — dos niveles de des-escape donde solo había uno,
 * destruyendo un `&lt;` que el autor escribió como contenido literal.
 *
 * @param {string} s
 * @returns {string}
 */
export function unescapeHtmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Convierte el body de un comentario en el `comment_html` que Plane CE espera (HTML
 * crudo — no acepta Markdown ni entidades). PURA. Tres carriles, en este orden:
 *
 *   1. **Body escapado entero** (`&lt;p&gt;…`, sin ninguna etiqueta cruda): se des-escapa
 *      UNA vez. Este es el bug KODO-62 — quien redacta el comentario (sesión LLM vía el
 *      MCP de Plane, o `kodo comment --body`) escribió entidades donde tocaba HTML, y
 *      Plane las guarda y las renderiza literales (`&lt;p&gt;` visible en la tarea).
 *      Backstop deliberadamente estrecho: no hay ningún escape MECÁNICO en el camino
 *      (kodo, el MCP y Plane hacen passthrough byte a byte — verificado por REST contra
 *      la instancia real), así que esto corrige una ENTRADA mal formada, no un
 *      doble-escape del transporte.
 *   2. **Body ya HTML** (crudo, o recién des-escapado por el carril 1): se manda TAL CUAL.
 *      Sin este carril el des-escape produciría `<p><p>…</p></p>`.
 *   3. **Texto plano / Markdown**: envoltura histórica `<p>` + `\n`→`<br>`, intacta. Es
 *      el carril de los comentarios que genera el propio kodo (backstop de cierre,
 *      barrido de huérfanas), que empiezan por emoji o texto.
 *
 * @param {string|null|undefined} body
 * @returns {string} HTML listo para `comment_html`
 */
export function toCommentHtml(body) {
  let html = typeof body === 'string' ? body : '';

  if (ESCAPED_TAG_LEADING.test(html) && !RAW_TAG_ANYWHERE.test(html)) {
    html = unescapeHtmlEntities(html);
  }

  if (RAW_TAG_LEADING.test(html)) return html;

  return '<p>' + html.replace(/\n/g, '<br>') + '</p>';
}
