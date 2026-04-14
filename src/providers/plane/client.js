// @ts-check
import { loadConfig, getPlaneApiKey } from '../../config.js';

export class PlaneClient {
  /** @param {{ baseUrl?: string, apiKey?: string, workspaceSlug?: string }} [opts] */
  constructor(opts = {}) {
    const config = loadConfig();
    this.baseUrl = (opts.baseUrl || config.plane.base_url).replace(/\/$/, '');
    this.apiKey = opts.apiKey || getPlaneApiKey();
    this.workspaceSlug = opts.workspaceSlug || config.plane.workspace_slug;

    if (!this.apiKey) {
      throw new Error(`Plane API key not found. Set ${config.plane.api_key_env} env var.`);
    }
  }

  /**
   * @param {string} path
   * @param {{ method?: string, body?: object, params?: Record<string,string> }} [opts]
   * @returns {Promise<any>}
   */
  async request(path, opts = {}) {
    const url = new URL(`${this.baseUrl}/api/v1/workspaces/${this.workspaceSlug}${path}`);
    if (opts.params) {
      for (const [k, v] of Object.entries(opts.params)) {
        url.searchParams.set(k, v);
      }
    }

    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Plane API ${res.status}: ${path} — ${text}`);
    }

    return res.json();
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
    const data = await this.request(`/projects/${projectId}/work-items/`, {
      params: { expand: 'state_detail,project_detail' },
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

  async listProjects() {
    const data = await this.request('/projects/');
    return data.results || data;
  }

  /**
   * Resolve "KL-42" style identifier to { projectId, sequenceId }
   * @param {string} identifier e.g. "KL-42"
   */
  async resolveIdentifier(identifier) {
    const match = identifier.match(/^([A-Z]+)-(\d+)$/i);
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
