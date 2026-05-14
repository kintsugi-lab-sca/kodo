// @ts-check
/**
 * GitHubProvider — TaskProvider adapter para GitHub Issues (Phase 24 GH-02).
 *
 * Implementa los **9 métodos REALES** de `src/interface.js#TASK_PROVIDER_METHODS`:
 * `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`,
 * `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects` (D-01).
 *
 * Divergencias justificadas vs `PlaneProvider` (mismo orden, mismo shape, diff mínimo):
 *
 *   - D-19: `init()` es **no-op completo**. GitHub no requiere cache (labels embedded
 *     en cada issue payload, states son `'open'`/`'closed'` fijos, sin modules
 *     análogos a Plane). El registry valida `init` existe como función — basta.
 *
 *   - D-22: `parseRef` regex strict `/^([^/]+)\/([^#]+)#(\d+)$/` rechaza KL-42, URLs
 *     completas y refs parciales (`#42`, `owner/repo`). Mensaje canonical
 *     `Invalid GitHub ref: <ref>. Expected owner/repo#number` (grep-friendly).
 *
 *   - D-23: `updateTaskState` passthrough HARD. Acepta `'open'`/`'closed'` literal,
 *     o cualquier nombre en `Object.values(config.states)`. Otros → throw
 *     `Unknown state: <name>. Configured: <list>`. Los callers (verify.js,
 *     dispatcher) resuelven `config.states.X` antes de invocar — el provider NO
 *     hace mapping silencioso.
 *
 *   - D-24: `addComment` envía Markdown LITERAL — sin el HTML paragraph+linebreak
 *     wrap que aplica Plane. GitHub API acepta Markdown nativo (client.js:285).
 *
 *   - D-26 / D-27: `parseTriggerEvent → null` y `verifySignature → false`
 *     deterministicos. GitHub usa polling-only en v0.7 (REQUIREMENTS §Out of Scope);
 *     ambos métodos existen solo para satisfacer el contrato `TaskProvider`. Sin
 *     HMAC code path → sin riesgo timing-attack.
 *
 *   - D-28: `listProjects()` devuelve `config.repos.map(...)` con **cero API calls**.
 *     GitHub no tiene "nombre humano" separado del slug — `id`/`identifier`/`name`
 *     se duplican (todos = `owner/repo`).
 *
 * Para detalles completos: ver `.planning/phases/24-githubprovider-normalizer-registry/24-CONTEXT.md`.
 */

import { GitHubClient } from './client.js';
import { normalizeIssue } from './normalize.js';

/**
 * @typedef {{
 *   base_url: string,
 *   api_key_env: string,
 *   repos: Array<{owner: string, repo: string}>,
 *   states: {trigger: string, review: string, done: string},
 * }} GitHubProviderConfig
 *
 * snake_case en lugar de camelCase porque el factory consume el sub-objeto raw
 * `config.providers.github` (D-29, registry NO transforma — divergencia vs Plane).
 */

/**
 * Factory that creates a TaskProvider adapter for GitHub.
 *
 * @param {GitHubProviderConfig} config — Raw `config.providers.github` block.
 * @param {{
 *   logger?: import('../../logger.js').Logger,
 *   client?: import('./client.js').GitHubClient,
 * }} [opts] — `client` is injectable for tests (D-36); without injection, factory
 *   constructs `new GitHubClient(...)` and that constructor calls
 *   `getProviderApiKey('github')` internally (Phase 23 client.js:84).
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createGitHubProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'github' });
  const client = opts.client || new GitHubClient({
    baseUrl: config.base_url,
    // token undefined → GitHubClient resolves via getProviderApiKey('github') (Phase 23 D-04).
    logger,
  });

  /**
   * Parse a GitHub ref of the form `owner/repo#number` into its components.
   *
   * Strict — D-22: NO tolerancia a variaciones (KL-42, `#N`, full URLs,
   * `owner/repo` sin `#N`). Error message canonical para grep en logs.
   *
   * @param {string} ref
   * @returns {{ owner: string, repo: string, number: number }}
   */
  function parseRef(ref) {
    const match = typeof ref === 'string' ? ref.match(/^([^/]+)\/([^#]+)#(\d+)$/) : null;
    if (!match) {
      throw new Error(`Invalid GitHub ref: ${ref}. Expected owner/repo#number`);
    }
    return {
      owner: match[1],
      repo: match[2],
      number: parseInt(match[3], 10),
    };
  }

  /** @type {import('../../interface.js').TaskProvider} */
  const provider = {
    // D-19: no-op. Sin cache, sin warmup, sin TTL guard (vs Plane's 56-line init).
    async init() {},

    // D-20: parseRef → client.getIssue → normalizeIssue with projectId='owner/repo'.
    // Errores del cliente (Error.code='not_found' en 404) se propagan directo.
    async getTask(ref) {
      const { owner, repo, number } = parseRef(ref);
      const issue = await client.getIssue(owner, repo, number);
      return normalizeIssue(issue, { projectId: `${owner}/${repo}` });
    },

    // D-23: passthrough HARD — callers resuelven config.states.X antes.
    async updateTaskState(task, stateName) {
      const { owner, repo, number } = parseRef(task.ref);

      if (stateName !== 'open' && stateName !== 'closed') {
        const configured = Object.values(config.states || {});
        if (!configured.includes(stateName)) {
          throw new Error(
            `Unknown state: ${stateName}. Configured: ${configured.join(', ')}`,
          );
        }
      }

      await client.updateIssue(owner, repo, number, { state: stateName });
    },

    // D-24: Markdown literal — GitHub API acepta Markdown nativo, sin HTML wrap.
    async addComment(task, markdownText) {
      const { owner, repo, number } = parseRef(task.ref);
      await client.addComment(owner, repo, number, markdownText);
    },

    // D-25: itera config.repos, server-side filter labels=kodo + state=open,
    //       filtra PRs (Pitfall #2: issues con .pull_request != null), normaliza.
    async listPendingTasks() {
      /** @type {import('../../interface.js').TaskItem[]} */
      const allTasks = [];
      for (const r of config.repos || []) {
        const result = await client.listIssues(r.owner, r.repo, {
          labels: ['kodo'],
          state: 'open',
        });
        for (const issue of result.items || []) {
          if (issue.pull_request) continue; // Pitfall #2: PRs intermixed con issues.
          allTasks.push(normalizeIssue(issue, { projectId: `${r.owner}/${r.repo}` }));
        }
      }
      return allTasks;
    },

    // D-26: GitHub polling-only en v0.7. Webhook ingress fuera de scope.
    parseTriggerEvent(_rawPayload) {
      return null;
    },

    // D-27: webhook off → sin secret → sin HMAC. Sin timing-attack surface.
    verifySignature(_rawBody, _headers) {
      return false;
    },

    // D-21: resolveRef → client.getIssue → issue.node_id (D-07 anchor).
    async resolveRef(humanRef) {
      const { owner, repo, number } = parseRef(humanRef);
      const issue = await client.getIssue(owner, repo, number);
      return issue.node_id;
    },

    // D-28: cero API calls. Phase 26 wizard puede enriquecer llamando al client directo.
    async listProjects() {
      return (config.repos || []).map((r) => ({
        id: `${r.owner}/${r.repo}`,
        identifier: `${r.owner}/${r.repo}`,
        name: `${r.owner}/${r.repo}`,
      }));
    },
  };

  return provider;
}
