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

      // Cache states for each project (UUID → name)
      for (const proj of config.projects) {
        const states = await client.listStates(proj.id);
        for (const s of states) {
          stateCache.set(s.id, s.name);
        }
      }
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

      // Try to resolve module (group)
      const moduleName = await client.getWorkItemModule(proj.id, workItem.id);
      if (moduleName) {
        task.groups = [moduleName];
      }

      return task;
    },

    async updateTaskState(task, stateName) {
      const states = await client.listStates(task.projectId);
      const state = states.find((s) => s.name === stateName);
      if (!state) {
        const available = states.map((s) => s.name).join(', ');
        throw new Error(`State "${stateName}" not found. Available: ${available}`);
      }
      await client.updateWorkItem(task.projectId, task.id, { state: state.id });
    },

    async addComment(task, markdownText) {
      const html = '<p>' + markdownText.replace(/\n/g, '<br>') + '</p>';
      await client.createComment(task.projectId, task.id, html);
    },

    async listPendingTasks() {
      const allTasks = [];
      for (const proj of config.projects) {
        const items = await client.listWorkItems(proj.id, {
          expand: 'state_detail,project_detail',
        });
        // Filter by trigger state name (resolve UUID via stateCache if state_detail missing)
        const pending = items.filter((item) => {
          const stateName = item.state_detail?.name || stateCache.get(item.state);
          return stateName === config.states.trigger;
        });
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
