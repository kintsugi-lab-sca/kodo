// @ts-check
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PlaneClient } from './client.js';
import { normalizeWorkItem, parseTriggerEvent } from './normalize.js';

/**
 * @typedef {{
 *   baseUrl: string,
 *   apiKey: string,
 *   workspaceSlug: string,
 *   projects: Array<{id: string, identifier: string, name: string}>,
 *   states: {trigger: string, review: string, done: string},
 *   webhookSecret?: string,
 * }} PlaneProviderConfig
 */

/**
 * Factory that creates a TaskProvider adapter for Plane.
 *
 * @param {PlaneProviderConfig} config
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createPlaneProvider(config) {
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
  });

  /** @type {Array<{id: string, name: string}>} */
  let labelCache = [];
  /** @type {Map<string, string>} state UUID → state name */
  const stateCache = new Map();
  /** @type {Map<string, Map<string, string>>} projectId → Map<stateName, stateId> */
  const stateByName = new Map();
  /** @type {Map<string, string>} workItem UUID → module name */
  const moduleCache = new Map();
  let initTimestamp = 0;
  const INIT_TTL_MS = 5 * 60 * 1000; // re-init every 5min

  /**
   * Parse a human-readable ref like "KL-42" into identifier prefix and sequence number.
   * @param {string} ref
   * @returns {{ prefix: string, sequenceId: number }}
   */
  function parseRef(ref) {
    const match = ref.match(/^([A-Z]+)-(\d+)$/i);
    if (!match) throw new Error(`Invalid task ref: ${ref}. Expected format: KL-42`);
    return { prefix: match[1].toUpperCase(), sequenceId: parseInt(match[2], 10) };
  }

  /**
   * Find the project config entry matching a given identifier prefix.
   * @param {string} prefix
   * @returns {{id: string, identifier: string, name: string}}
   */
  function findProject(prefix) {
    const proj = config.projects.find((p) => p.identifier === prefix);
    if (!proj) throw new Error(`No configured project with identifier "${prefix}"`);
    return proj;
  }

  /** @type {import('../../interface.js').TaskProvider} */
  const provider = {
    async init() {
      // Skip re-init if recent
      if (initTimestamp && Date.now() - initTimestamp < INIT_TTL_MS) return;

      // Resolve project entries: if config has plain UUID strings, enrich
      // them with { id, identifier, name } from the API so that all other
      // methods can rely on the object shape.
      if (config.projects.length > 0 && typeof config.projects[0] === 'string') {
        const allProjects = await client.listProjects();
        config.projects = config.projects.map((entry) => {
          const id = typeof entry === 'string' ? entry : entry.id;
          const found = allProjects.find((p) => p.id === id);
          if (found) return { id: found.id, identifier: found.identifier, name: found.name };
          return { id, identifier: 'UNKNOWN', name: id };
        });
      }

      // Fetch labels for each configured project
      const allLabels = [];
      for (const proj of config.projects) {
        const data = await client.request(`/projects/${proj.id}/labels/`);
        const labels = data.results || data;
        allLabels.push(...labels);
      }
      labelCache = allLabels;

      // Cache states for each project (UUID ↔ name)
      for (const proj of config.projects) {
        const states = await client.listStates(proj.id);
        const byName = new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          byName.set(s.name, s.id);
        }
        stateByName.set(proj.id, byName);
      }

      // Cache module membership per project (workItemId → moduleName)
      for (const proj of config.projects) {
        try {
          const modules = await client.listModules(proj.id);
          for (const mod of modules) {
            if (mod.total_issues === 0) continue;
            const items = await client.request(`/projects/${proj.id}/modules/${mod.id}/module-issues/`);
            const results = items.results || items;
            for (const item of results) {
              moduleCache.set(item.id, mod.name);
            }
          }
        } catch (err) {
          console.warn(`[kodo] Could not cache modules for project ${proj.identifier}: ${err.message}`);
        }
      }

      initTimestamp = Date.now();
    },

    async getTask(ref) {
      const { prefix, sequenceId } = parseRef(ref);
      const proj = findProject(prefix);

      const workItem = await client.getWorkItemBySequence(proj.id, sequenceId);
      if (!workItem) throw new Error(`Work item ${ref} not found`);

      const context = {
        labels: labelCache,
        projectIdentifier: proj.identifier,
        baseUrl: config.baseUrl,
        workspaceSlug: config.workspaceSlug,
        stateMap: stateCache,
      };

      const task = normalizeWorkItem(workItem, context);

      // Try to resolve module (group). Fall back to on-demand lookup when the
      // cache (built at init) does not yet know about this work item — e.g.
      // tasks created after the last init. Populate the cache on hit so the
      // slow path runs at most once per new task.
      let moduleName = moduleCache.get(workItem.id) || null;
      if (!moduleName) {
        try {
          moduleName = await client.getWorkItemModule(proj.id, workItem.id);
          if (moduleName) moduleCache.set(workItem.id, moduleName);
        } catch (err) {
          console.warn(`[kodo] Module lookup failed for ${ref}: ${err.message}`);
        }
      }
      if (moduleName) {
        task.groups = [moduleName];
      }

      return task;
    },

    async updateTaskState(task, stateName) {
      let stateId = stateByName.get(task.projectId)?.get(stateName);
      if (!stateId) {
        // Cache miss: refresh just this project's states (could be a new state).
        const states = await client.listStates(task.projectId);
        const byName = new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          byName.set(s.name, s.id);
        }
        stateByName.set(task.projectId, byName);
        stateId = byName.get(stateName);
        if (!stateId) {
          const available = [...byName.keys()].join(', ');
          throw new Error(`State "${stateName}" not found. Available: ${available}`);
        }
      }
      await client.updateWorkItem(task.projectId, task.id, { state: stateId });
    },

    async addComment(task, markdownText) {
      const html = '<p>' + markdownText.replace(/\n/g, '<br>') + '</p>';
      await client.createComment(task.projectId, task.id, html);
    },

    async listComments(task) {
      const raw = await client.listComments(task.projectId, task.id);
      return raw.map((c) => ({
        id: c.id,
        actor: c.actor_detail?.display_name || c.actor || 'unknown',
        text: (c.comment_html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
        created_at: c.created_at,
      }));
    },

    async listPendingTasks() {
      const allTasks = [];
      for (const proj of config.projects) {
        // No expand — stateCache already maps UUID → name, project is known.
        const items = await client.listWorkItems(proj.id);
        const pending = items.filter((item) => stateCache.get(item.state) === config.states.trigger);
        const context = {
          labels: labelCache,
          projectIdentifier: proj.identifier,
          baseUrl: config.baseUrl,
          workspaceSlug: config.workspaceSlug,
          stateMap: stateCache,
        };
        for (const item of pending) {
          allTasks.push(normalizeWorkItem(item, context));
        }
      }
      return allTasks;
    },

    parseTriggerEvent(rawPayload) {
      return parseTriggerEvent(rawPayload, labelCache, config.projects);
    },

    verifySignature(rawBody, headers) {
      const signature = headers['x-plane-signature'];
      if (!signature || !config.webhookSecret) return false;
      const expected = createHmac('sha256', config.webhookSecret)
        .update(rawBody)
        .digest('hex');
      try {
        return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      } catch {
        return false;
      }
    },

    async listProjects() {
      const rawProjects = await client.listProjects();
      return rawProjects.map((p) => ({
        id: p.id,
        identifier: p.identifier,
        name: p.name,
      }));
    },

    async resolveRef(humanRef) {
      const { prefix, sequenceId } = parseRef(humanRef);
      const proj = findProject(prefix);
      const workItem = await client.getWorkItemBySequence(proj.id, sequenceId);
      if (!workItem) throw new Error(`Work item ${humanRef} not found`);
      return workItem.id;
    },
  };

  return provider;
}
