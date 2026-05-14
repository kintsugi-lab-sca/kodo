// @ts-check
/**
 * GitHubClient — REST wrapper sobre `https://api.github.com` (Phase 23 GH-01).
 *
 * Mirror estructural de `PlaneClient` con 3 divergencias justificadas:
 *
 *   1. **No retry interno (D-11)** — un solo fetch por request. Phase 25 polling (POLL-04)
 *      es la capa de retry con backoff exponencial.
 *
 *   2. **Fetch inyectable (D-06)** — `opts.fetch ?? globalThis.fetch`. Permite testing sin
 *      `globalThis` mutation (anti-pattern del PlaneClient test, ver
 *      `test/plane-provider.test.js:62-77`).
 *
 *   3. **Envelope 304 en `listIssues` (D-19)** — el `request()` privado detecta 304 y devuelve
 *      `{status, items:[], etag, rate_limit_remaining}` SIN throw. Phase 25 persiste etag.
 *
 * Métodos públicos (D-22):
 *   - getIssue(owner, repo, number)        → raw GitHub issue payload
 *   - listIssues(owner, repo, opts?)       → {status, items, etag, rate_limit_remaining}
 *   - addComment(owner, repo, number, md)  → raw comment 201
 *   - updateIssue(owner, repo, number, u)  → raw issue payload tras PATCH
 *   - listLabels(owner, repo)              → array de labels raw
 *
 * Errores canonical (D-12): el cliente lanza `Error` plano con `.code`, `.status`,
 * `.retryAfter`. Códigos: `unauthorized`, `forbidden`, `not_found`, `rate_limit_exceeded`,
 * `github_api_error`.
 *
 * LOG-12 invariant: este módulo importa `getProviderApiKey` (config), `githubApiCall` y
 * `githubApiCallFailed` (logger-events via dynamic import). `src/check.js` NO carga este
 * archivo — `test/check-isolation.test.js` lo verifica.
 */

import { getProviderApiKey } from '../../config.js';

/**
 * Parse `Retry-After` header — RFC 7231 permite entero (segundos) o HTTP-date.
 * GitHub históricamente usa entero, pero el spec admite ambos (Pitfall #4).
 *
 * @param {string|null} header
 * @returns {number|undefined}
 */
function parseRetryAfter(header) {
  if (!header) return undefined;
  const trimmed = header.trim();
  const asInt = parseInt(trimmed, 10);
  if (!isNaN(asInt) && String(asInt) === trimmed) return asInt;
  const asDate = Date.parse(trimmed);
  if (!isNaN(asDate)) return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  return undefined;
}

/**
 * Mapea HTTP status → código canonical de `Error.code` (D-12 + 23-RESEARCH.md Error Mapping Table).
 *
 * @param {number} status
 * @param {{ get(name: string): string|null }} headers
 * @param {number|undefined} retryAfter
 * @returns {'unauthorized'|'forbidden'|'not_found'|'rate_limit_exceeded'|'github_api_error'}
 */
function mapErrorCode(status, headers, retryAfter) {
  if (status === 401) return 'unauthorized';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limit_exceeded';
  if (status === 403) {
    const remaining = headers.get('x-ratelimit-remaining');
    if (remaining === '0' || retryAfter !== undefined) return 'rate_limit_exceeded';
    return 'forbidden';
  }
  return 'github_api_error';
}

/**
 * @typedef {object} GitHubClientOpts
 * @property {string} [baseUrl] — Default 'https://api.github.com'. Override para fake-server tests.
 * @property {string} [token] — PAT override. Si undefined, llama `getProviderApiKey('github')`.
 * @property {typeof globalThis.fetch} [fetch] — Inyección para test (D-06).
 * @property {import('../../logger.js').Logger} [logger] — Optional. Sin él, NDJSON es no-op.
 */

export class GitHubClient {
  /** @param {GitHubClientOpts} [opts] */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || 'https://api.github.com').replace(/\/$/, '');
    this.token = opts.token || getProviderApiKey('github');
    this.fetch = opts.fetch || globalThis.fetch;
    this.logger = opts.logger;

    if (!this.token) {
      throw new Error('GitHub token not found. Set GITHUB_TOKEN env var.');
    }
  }

  /**
   * Internal HTTP transport. Centraliza fetch + auth + timeout + rate-limit headers +
   * NDJSON emission + error mapping. CERO retry (D-11), CERO proactive throttle (D-29).
   *
   * @param {string} path — Path relativo a `baseUrl` (e.g. `/repos/octocat/hello-world/issues/42`).
   * @param {{
   *   method?: string,
   *   body?: object,
   *   params?: Record<string,string>,
   *   etag?: string,
   * }} [opts]
   * @returns {Promise<any>}
   */
  async request(path, opts = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url.searchParams.set(k, v);
      }
    }

    /** @type {Record<string,string>} */
    const headers = {
      'Authorization': `token ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'kodo/0.7.x',
    };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.etag) headers['If-None-Match'] = opts.etag;

    const started = Date.now();
    const method = opts.method || 'GET';
    const res = await this.fetch(url, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    // Rate-limit header parsing (null-safe — Pitfall #8). String|null → number|undefined.
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);
    if (reset !== null) this._rateReset = parseInt(reset, 10);

    // 304 path (D-19): envelope, no throw. Solo `listIssues` se aprovecha — los demás métodos
    // no envían `If-None-Match`, así que GitHub no devuelve 304. Pero centralizamos aquí porque
    // los headers ya están parseados.
    if (res.status === 304) {
      const etagHeader = res.headers.get('etag');
      // Emit success-side NDJSON aunque sea 304 (D-15: cuenta como api.call, status=304).
      if (this.logger) {
        try {
          const { githubApiCall } = await import('../../logger-events.js');
          githubApiCall(this.logger, {
            method,
            path,
            status: 304,
            duration_ms: Date.now() - started,
            rate_limit_remaining: this._rateRemaining,
          });
        } catch {
          // silent — nunca interferir con el response flow.
        }
      }
      return {
        status: 304,
        items: [],
        etag: etagHeader ?? opts.etag,
        rate_limit_remaining: this._rateRemaining,
      };
    }

    // Error path: emit failure NDJSON + throw canonical Error.
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const snippet = text.slice(0, 200);
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const code = mapErrorCode(res.status, res.headers, retryAfter);

      if (this.logger) {
        try {
          const { githubApiCallFailed } = await import('../../logger-events.js');
          githubApiCallFailed(this.logger, {
            method,
            path,
            status: res.status,
            error: snippet,
          });
        } catch {
          // silent
        }
      }

      const err = /** @type {Error & { code?: string, status?: number, retryAfter?: number }} */ (
        new Error(`GitHub API ${res.status}: ${path} — ${snippet}`)
      );
      err.code = code;
      err.status = res.status;
      if (retryAfter !== undefined) err.retryAfter = retryAfter;
      throw err;
    }

    // Success path: emit NDJSON + return raw json.
    if (this.logger) {
      try {
        const { githubApiCall } = await import('../../logger-events.js');
        githubApiCall(this.logger, {
          method,
          path,
          status: res.status,
          duration_ms: Date.now() - started,
          rate_limit_remaining: this._rateRemaining,
        });
      } catch {
        // silent
      }
    }

    // Stash ETag para que listIssues lo pueda envolver sin re-parsear headers.
    this._lastEtag = res.headers.get('etag') ?? undefined;

    return res.json();
  }

  /**
   * GET /repos/{owner}/{repo}/issues/{number} → raw issue payload.
   * `body` puede ser `null` cuando la issue se creó sin descripción (Pitfall #1).
   *
   * @param {string} owner
   * @param {string} repo
   * @param {number} number
   * @returns {Promise<any>}
   */
  async getIssue(owner, repo, number) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    return this.request(`/repos/${o}/${r}/issues/${number}`);
  }

  /**
   * GET /repos/{owner}/{repo}/issues → envelope `{status, items, etag, rate_limit_remaining}`.
   *
   * **Pitfall #2:** GitHub considera PRs como "issues con `pull_request` ≠ null".
   * Este endpoint devuelve ambos intermixed. Phase 24 normalizer filtra los PRs.
   *
   * **Pitfall #6:** El ETag está calculado sobre el conjunto exacto de query params.
   * Si Phase 25 cambia `labels` o `state` entre llamadas, el ETag ya no aplica.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {{
   *   labels?: string[],
   *   state?: 'open'|'closed'|'all',
   *   since?: string,
   *   etag?: string,
   *   per_page?: number,
   * }} [opts]
   * @returns {Promise<{ status: 200 | 304, items: any[], etag: string | undefined, rate_limit_remaining: number | undefined }>}
   */
  async listIssues(owner, repo, opts = {}) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    /** @type {Record<string,string>} */
    const params = {};
    if (opts.state) params.state = opts.state;
    if (opts.labels && opts.labels.length > 0) params.labels = opts.labels.join(',');
    if (opts.since) params.since = opts.since;
    params.per_page = String(opts.per_page ?? 100);

    const result = await this.request(`/repos/${o}/${r}/issues`, {
      params,
      etag: opts.etag,
    });

    // 304 path: `request()` ya construyó el envelope.
    if (result && typeof result === 'object' && result.status === 304) {
      return result;
    }

    // 200 path: envuelve el array raw en envelope.
    return {
      status: 200,
      items: Array.isArray(result) ? result : [],
      etag: this._lastEtag,
      rate_limit_remaining: this._rateRemaining,
    };
  }

  /**
   * POST /repos/{owner}/{repo}/issues/{number}/comments → raw comment 201.
   * Body **markdown** (no HTML — diferencia con Plane).
   *
   * @param {string} owner
   * @param {string} repo
   * @param {number} number
   * @param {string} markdownBody
   * @returns {Promise<any>}
   */
  async addComment(owner, repo, number, markdownBody) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    return this.request(`/repos/${o}/${r}/issues/${number}/comments`, {
      method: 'POST',
      body: { body: markdownBody },
    });
  }

  /**
   * PATCH /repos/{owner}/{repo}/issues/{number} → raw issue payload.
   * `updates.labels` es REPLACE, no merge.
   *
   * @param {string} owner
   * @param {string} repo
   * @param {number} number
   * @param {{ state?: 'open'|'closed', state_reason?: string|null, title?: string, body?: string, labels?: string[], assignees?: string[] }} updates
   * @returns {Promise<any>}
   */
  async updateIssue(owner, repo, number, updates) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    return this.request(`/repos/${o}/${r}/issues/${number}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  /**
   * GET /repos/{owner}/{repo}/labels → array de labels raw.
   *
   * @param {string} owner
   * @param {string} repo
   * @returns {Promise<any[]>}
   */
  async listLabels(owner, repo) {
    const o = encodeURIComponent(owner);
    const r = encodeURIComponent(repo);
    return this.request(`/repos/${o}/${r}/labels`, { params: { per_page: '100' } });
  }
}
