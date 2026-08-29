// @ts-check
import { loadConfig, getPlaneApiKey } from '../../config.js';

/** Primer escalón del backoff exponencial (ms). */
const RETRY_BASE_MS = 1000;
/** Techo del backoff exponencial (ms) — preexistente, se conserva. */
const RETRY_CAP_MS = 8000;

/**
 * Métodos HTTP que se pueden reintentar ante un 5xx sin arriesgar un efecto duplicado.
 *
 * POST está FUERA a propósito: un 502/503 significa que la petición SÍ llegó al servidor
 * (o a su proxy) y pudo haberse aplicado antes de romperse la respuesta — reintentar
 * duplicaría el comentario / work item / label. PATCH sí entra porque los únicos PATCH del
 * cliente (`updateWorkItem`) son un set ABSOLUTO de campos: aplicarlo dos veces deja el
 * mismo estado. Los errores de transporte NO pasan por esta lista (ver `request`).
 */
const RETRY_ON_5XX_METHODS = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'PATCH']);

/**
 * Espera antes del siguiente intento.
 *
 * Prioridad 1 — `Retry-After` del servidor: se respeta TAL CUAL, sin jitter. Si Plane dice
 * "vuelve en N s", adelantarse reproduce el 429 y retrasarse no aporta nada.
 *
 * Prioridad 2 — backoff exponencial con *equal jitter*: la mitad de la espera es fija (el
 * backoff sigue creciendo: ≥500ms, ≥1s, ≥2s, ≥4s) y la otra mitad es aleatoria. Sin jitter,
 * N sesiones de kodo que golpean Plane a la vez reintentan en el MISMO milisegundo y se
 * auto-sincronizan ronda tras ronda (thundering herd) en lugar de dispersarse.
 *
 * @param {number} attempt — 0-based.
 * @param {number} [retryAfterSec] — 0 si el servidor no mandó `Retry-After`.
 * @param {() => number} [rnd] — inyectable en tests; devuelve [0,1).
 * @returns {number} ms a esperar.
 */
export function computeBackoffMs(attempt, retryAfterSec = 0, rnd = Math.random) {
  if (retryAfterSec > 0) return retryAfterSec * 1000;
  const base = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_CAP_MS);
  return Math.round(base / 2 + rnd() * (base / 2));
}

export class PlaneClient {
  /**
   * @param {{
   *   baseUrl?: string,
   *   apiKey?: string,
   *   workspaceSlug?: string,
   *   logger?: import('../../logger.js').Logger,
   *   fetch?: typeof fetch,
   *   sleep?: (ms: number) => Promise<void>,
   * }} [opts]
   *   `fetch` y `sleep` son seams de test (mismo patrón D-06 que `GitHubClient`): permiten
   *   ejercitar el loop de retry sin red y sin esperas reales.
   */
  constructor(opts = {}) {
    const config = loadConfig();
    // B2 (Phase 72): leer del schema v2 `config.providers.plane.*`. Tras la
    // migración v1→v2 (config.js migrateConfig), el bloque legacy top-level de
    // plane es `undefined` — las lecturas legacy lanzaban un TypeError críptico.
    const planeCfg = (config.providers && config.providers.plane) || {};
    this.baseUrl = (opts.baseUrl || planeCfg.base_url).replace(/\/$/, '');
    this.apiKey = opts.apiKey || getPlaneApiKey();
    this.workspaceSlug = opts.workspaceSlug || planeCfg.workspace_slug;
    this.logger = opts.logger; // undefined if not provided — emission uses optional chain
    this.fetch = opts.fetch || globalThis.fetch;
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

    if (!this.apiKey) {
      throw new Error(`Plane API key not found. Set ${planeCfg.api_key_env} env var.`);
    }
  }

  /**
   * Transporte HTTP con retry y backoff exponencial + jitter (cap 8s).
   *
   * Se reintenta ante:
   *  - **429** — cualquier método. `Retry-After` del servidor tiene prioridad sobre el backoff.
   *  - **5xx** — solo métodos de `RETRY_ON_5XX_METHODS`. Un 502/503 de Plane detrás de nginx es
   *    típicamente transitorio (reinicio, worker saturado) y antes mataba la cadena al primer
   *    intento; POST queda excluido porque la petición ya llegó al servidor y podría duplicarse.
   *  - **errores de transporte** — `TypeError: fetch failed` (DNS, ECONNREFUSED, socket cortado)
   *    y el `TimeoutError` de `AbortSignal.timeout`. Se reintentan para CUALQUIER método, POST
   *    incluido: sin respuesta, el modo de fallo dominante es que la petición nunca se cursó.
   *    RIESGO RESIDUAL asumido: un timeout de 10s no garantiza la no-entrega — si Plane sí
   *    procesó el POST, el reintento duplica el efecto. Se acepta porque los POST de este
   *    cliente son de bajo daño ante duplicado (comentario repetido) y `createLabel` ya es
   *    idempotente ante el 409 de nombre.
   *
   * `opts.root` (KODO-58) saca la petición del prefijo `/workspaces/<slug>`: casi toda la
   * API de Plane cuelga del workspace, pero la identidad del dueño de la key NO
   * (`/api/v1/users/me/`) — es una propiedad del token, no de un workspace. Se resuelve
   * con un flag y no con un método aparte para que ese endpoint herede TAL CUAL el retry,
   * el backoff, el throttle de rate-limit y el manejo de errores de aquí.
   *
   * @param {string} path
   * @param {{ method?: string, body?: object, params?: Record<string,string>, maxRetries?: number, root?: boolean }} [opts]
   * @returns {Promise<any>}
   */
  async request(path, opts = {}) {
    const prefix = opts.root ? `${this.baseUrl}/api/v1` : `${this.baseUrl}/api/v1/workspaces/${this.workspaceSlug}`;
    const url = new URL(`${prefix}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url.searchParams.set(k, v);
      }
    }

    const maxRetries = opts.maxRetries ?? 3;
    const method = (opts.method || 'GET').toUpperCase();
    const retryOn5xx = RETRY_ON_5XX_METHODS.has(method);
    let attempt = 0;

    // Proactive throttle: if the previous response left us with very few
    // tokens, sleep until the bucket resets before issuing the next request.
    if (this._rateRemaining !== undefined && this._rateRemaining < 5 && this._rateReset) {
      const waitMs = this._rateReset * 1000 - Date.now();
      if (waitMs > 0 && waitMs < 65_000) {
        console.warn(`[kodo] Plane rate budget low (${this._rateRemaining} left), pausing ${waitMs}ms`);
        await this.sleep(waitMs);
      }
    }

    while (true) {
      const started = Date.now();
      let res;
      try {
        res = await this.fetch(url, {
          method,
          headers: {
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
          },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
      } catch (err) {
        // Sin respuesta: error de transporte o timeout. Se reintenta para todo método
        // (ver el contrato en el JSDoc). Agotados los intentos, el error original se
        // propaga TAL CUAL — envolverlo perdería la `cause` de undici.
        if (attempt >= maxRetries) throw err;
        const waitMs = computeBackoffMs(attempt);
        const detail = err instanceof Error ? err.message : String(err);
        console.warn(`[kodo] Plane network error on ${method} ${path} (${detail}), retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(waitMs);
        attempt++;
        continue;
      }

      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);
      if (reset !== null) this._rateReset = parseInt(reset, 10);

      const isRateLimit = res.status === 429;
      const isRetryable5xx = res.status >= 500 && res.status <= 599 && retryOn5xx;
      if ((isRateLimit || isRetryable5xx) && attempt < maxRetries) {
        // `Retry-After` solo se consulta en el 429: en un 5xx el header, si viene, suele ser
        // del proxy y no describe una ventana de rate limit.
        const retryAfter = isRateLimit ? parseInt(res.headers.get('retry-after') || '0', 10) || 0 : 0;
        const waitMs = computeBackoffMs(attempt, retryAfter);
        const reason = isRateLimit ? 'rate limit' : `server error ${res.status}`;
        console.warn(`[kodo] Plane ${reason} on ${method} ${path}, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
        await this.sleep(waitMs);
        attempt++;
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
      }

      // Emit typed plane.api.call event on successful response (best-effort)
      if (this.logger) {
        try {
          const { planeApiCall } = await import('../../logger-events.js');
          planeApiCall(this.logger, {
            method,
            path,
            status: res.status,
            duration_ms: Date.now() - started,
          });
        } catch {
          // silent — never interfere with the actual API response flow
        }
      }

      return res.json();
    }
  }

  /** @param {string} projectId */
  async listStates(projectId) {
    const data = await this.request(`/projects/${projectId}/states/`);
    return data.results || data;
  }

  /**
   * @param {string} projectId
   * @param {{ expand?: string }} [opts]
   */
  async listWorkItems(projectId, opts = {}) {
    const params = { per_page: '100' };
    if (opts.expand) params.expand = opts.expand;
    const data = await this.request(`/projects/${projectId}/work-items/`, { params });
    return data.results || data;
  }

  /**
   * @param {string} projectId
   * @param {string} workItemId
   */
  async getWorkItem(projectId, workItemId) {
    return this.request(`/projects/${projectId}/work-items/${workItemId}/`, {
      params: { expand: 'state_detail,project_detail' },
    });
  }

  /**
   * @param {string} projectId
   * @param {number} sequenceId
   */
  async getWorkItemBySequence(projectId, sequenceId) {
    // F2 fix (2026-06-22): expandir `labels` para que la work-item los traiga como
    // OBJETOS (con `name`) en vez de UUIDs. Sin esto, getTask los resuelve contra el
    // `labelCache` (built en init, TTL) que puede no contener el id → labels:[] →
    // tarea vista como no-kodo (launch ignorado). Con expand, resolveWorkItemLabels
    // mapea `.name` directo, sin depender del cache. Verificado contra la API live.
    const data = await this.request(`/projects/${projectId}/work-items/`, {
      params: { expand: 'state_detail,project_detail,labels' },
    });
    const results = data.results || data;
    return results.find((item) => item.sequence_id === sequenceId) || null;
  }

  /**
   * @param {string} projectId
   * @param {string} workItemId
   * @param {object} updates
   */
  async updateWorkItem(projectId, workItemId, updates) {
    return this.request(`/projects/${projectId}/work-items/${workItemId}/`, {
      method: 'PATCH',
      body: updates,
    });
  }

  /** @param {string} projectId */
  async listModules(projectId) {
    const data = await this.request(`/projects/${projectId}/modules/`);
    return data.results || data;
  }

  /**
   * Find which module a work item belongs to
   * @param {string} projectId
   * @param {string} workItemId
   * @returns {Promise<string|null>} module name or null
   */
  async getWorkItemModule(projectId, workItemId) {
    const modules = await this.listModules(projectId);
    for (const mod of modules) {
      if (mod.total_issues === 0) continue;
      const items = await this.request(`/projects/${projectId}/modules/${mod.id}/module-issues/`);
      const results = items.results || items;
      if (results.some((item) => item.id === workItemId)) {
        return mod.name;
      }
    }
    return null;
  }

  /**
   * Associate a work item to a module (BIDIR-01, Phase 57 module-placement gap-fix). POSTs to the
   * `module-issues` collection — the EXACT same endpoint shape the cache build / `getWorkItemModule`
   * already GET at client.js:161, confirming `/projects/<id>/modules/<id>/module-issues/` is the
   * membership collection. The body is `{ issues: [<workItemId>] }` (Plane accepts a batch of
   * work-item UUIDs on the module). Same authenticated `request()` POST (X-API-Key, 10s timeout,
   * rate-limit retry, error throw centralized). Does NOT swallow — the CALLER (provider.createTask)
   * owns the fail-open posture so a missing module never downgrades a created work item.
   *
   * @param {string} projectId
   * @param {string} moduleId
   * @param {string} workItemId
   * @returns {Promise<any>} raw response
   */
  async addWorkItemToModule(projectId, moduleId, workItemId) {
    return this.request(`/projects/${projectId}/modules/${moduleId}/module-issues/`, {
      method: 'POST',
      body: { issues: [workItemId] },
    });
  }

  /**
   * @param {string} projectId
   * @param {string} workItemId
   * @param {string} commentHtml
   */
  async createComment(projectId, workItemId, commentHtml) {
    return this.request(`/projects/${projectId}/work-items/${workItemId}/comments/`, {
      method: 'POST',
      body: { comment_html: commentHtml },
    });
  }

  async listComments(projectId, workItemId) {
    const data = await this.request(`/projects/${projectId}/work-items/${workItemId}/comments/`);
    return data.results || data;
  }

  /**
   * Create a work item (BIDIR-01). Mirror of `createComment` — same authenticated
   * `request()` POST (X-API-Key, 10s timeout, rate-limit retry, error throw all
   * centralized). The path is byte-identical to `listWorkItems` (trailing slash is
   * load-bearing: Plane is trailing-slash-strict; `POST .../work-items` without `/`
   * 404s only on create). Does NOT wrap/swallow — create is a mutation that fails
   * LOUD (D-08): `request()` already throws on non-ok.
   *
   * @param {string} projectId
   * @param {{ name: string, description_html?: string, state?: string, labels?: string[] }} fields
   *   `name` required; `state` is a state UUID (not a name); `labels` is an array of
   *   label UUIDs; `description_html` is HTML.
   * @returns {Promise<any>} raw 201 work item
   */
  async createWorkItem(projectId, fields) {
    return this.request(`/projects/${projectId}/work-items/`, {
      method: 'POST',
      body: fields,
    });
  }

  /**
   * Create a project label (BIDIR-01 / Open Q1). Same authenticated `request()` POST
   * pattern. The `kodo:adopted` marker is a label UUID that must exist before the
   * work-item POST — `provider.createTask` looks it up or creates it via this method.
   *
   * IDEMPOTENT on name-conflict 409 ONLY (Phase 56 Plan 04, UAT blocker): Plane rejects a
   * duplicate label name with `Plane API 409: /projects/<id>/labels/ — Label with the same
   * name already exists in the project`. That happens when the label already exists (a prior
   * adopt attempt, or the project was never warmed into labelCache) — a NON-ERROR for our
   * lookup-or-create flow. On that specific 409 we re-list the project's labels and RETURN the
   * existing one (case-insensitive name match), so `createTask` proceeds instead of fatally
   * failing with CREATE_FAILED. If the label is somehow absent after re-listing, the original
   * 409 is re-thrown (don't mask a genuine failure). EVERY OTHER failure (other statuses, a
   * 409 that isn't the name-conflict shape) still propagates LOUD (D-08 contract preserved).
   *
   * @param {string} projectId
   * @param {string} name - label name
   * @param {string} [color] - hex color (defaults to a neutral gray)
   * @returns {Promise<any>} raw label with `id` (UUID)
   */
  async createLabel(projectId, name, color) {
    try {
      return await this.request(`/projects/${projectId}/labels/`, {
        method: 'POST',
        body: { name, color: color || '#6b7280' },
      });
    } catch (e) {
      // Detect the label-already-exists 409 ONLY. Anything else fails LOUD (D-08).
      const msg = e instanceof Error ? e.message : String(e);
      // B12c (Phase 72): estrechar el predicado. El `|| msg.includes('labels/')`
      // se tragaba CUALQUIER 409 cuyo path contuviera `labels/` (p.ej. un 409 no
      // relacionado con el name-conflict). El único 409 recuperable es el
      // "Label with the same name already exists".
      const isNameConflict409 =
        msg.includes('Plane API 409') && msg.includes('already exists');
      if (!isNameConflict409) throw e;
      // Re-list and reuse the existing label by case-insensitive name (more robust than
      // regex-parsing the id out of the 409 body).
      const data = await this.request(`/projects/${projectId}/labels/`);
      const labels = data.results || data;
      const target = (name || '').toLowerCase();
      const existing = Array.isArray(labels)
        ? labels.find((l) => (l.name || '').toLowerCase() === target)
        : undefined;
      if (existing) return existing;
      // No match after re-listing → the 409 was not a recoverable name-conflict; re-throw LOUD.
      throw e;
    }
  }

  async listProjects() {
    const data = await this.request('/projects/');
    return data.results || data;
  }

  /**
   * Identidad del dueño de la API key (KODO-58) — `GET /api/v1/users/me/`.
   *
   * VERIFICADO 200 contra la instancia CE v1.3.0: devuelve
   * `{id, first_name, last_name, email, avatar, display_name}`. Va con `root: true`
   * porque NO cuelga del workspace (ver la nota de `request`).
   *
   * Se devuelven SOLO `id` y `display_name`: el `id` es lo único que se compara (contra
   * los `assignees` del work item) y el `display_name` es lo único que se enseña. El
   * email queda fuera a propósito — este valor se cachea en `~/.kodo/config.json`, un
   * fichero que se pega en issues y se comparte al depurar, y no necesita PII para
   * cumplir su función.
   *
   * Los errores se PROPAGAN: el fail-open lo decide el caller (`provider.init()`), que es
   * quien sabe si puede degradar a «identidad desconocida» o no.
   *
   * @returns {Promise<{ id: string, display_name: string }>}
   */
  async getMe() {
    const me = await this.request('/users/me/', { root: true });
    return { id: me?.id, display_name: me?.display_name || me?.email || me?.id };
  }

  /**
   * Resolve "KL-42" style identifier to { projectId, sequenceId }
   * @param {string} identifier e.g. "KL-42"
   */
  async resolveIdentifier(identifier) {
    // B8 (Phase 72): el prefijo puede contener dígitos internos (`K2-42`). El
    // `[A-Za-z]+` original NO capturaba el `2` de `K2`, así que un identificador
    // válido como `K2-42` no resolvía (el `/i` no salva: la clase no incluye
    // dígitos). Prefijo = letra inicial + alfanuméricos.
    const match = identifier.match(/^([A-Za-z][A-Za-z0-9]*)-(\d+)$/);
    if (!match) throw new Error(`Invalid identifier: ${identifier}. Expected format: KL-42`);

    const prefix = match[1].toUpperCase();
    const sequenceId = parseInt(match[2], 10);

    const projects = await this.listProjects();
    const project = projects.find((p) => p.identifier === prefix);
    if (!project) throw new Error(`No project found with identifier "${prefix}"`);

    const workItem = await this.getWorkItemBySequence(project.id, sequenceId);
    if (!workItem) throw new Error(`Work item ${identifier} not found`);

    return { project, workItem };
  }
}
