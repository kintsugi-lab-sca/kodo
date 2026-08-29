// @ts-check
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PlaneClient } from './client.js';
import { normalizeWorkItem, parseTriggerEvent } from './normalize.js';
import { KODO_LABEL_ADOPTED, isDispatchable } from '../../labels.js';
import { filterByOperator } from '../../operator.js';

/**
 * @typedef {{
 *   baseUrl: string,
 *   webUrl: string,
 *   apiKey: string,
 *   workspaceSlug: string,
 *   projects: Array<{id: string, identifier: string, name: string}>,
 *   states: {trigger: string, review: string, done: string},
 *   webhookSecret?: string,
 *   operator?: {id: string, display_name?: string},
 *   requireAssignee?: boolean,
 * }} PlaneProviderConfig
 */

/**
 * Factory that creates a TaskProvider adapter for Plane.
 *
 * `opts.persistOperatorFn` (KODO-58) es el ÚNICO camino por el que este módulo escribe
 * en disco, y llega por DI a propósito: el provider no importa `config.js` para
 * guardar, así que un test lo instancia sin tocar el `~/.kodo/config.json` real. El
 * registry cablea el escritor de verdad.
 *
 * @param {PlaneProviderConfig} config
 * @param {{
 *   logger?: import('../../logger.js').Logger,
 *   persistOperatorFn?: (operator: {id: string, display_name?: string}) => void,
 * }} [opts]
 * @returns {import('../../interface.js').TaskProvider}
 */
export function createPlaneProvider(config, opts = {}) {
  const logger = opts.logger?.child({ component: 'plane' });
  const client = new PlaneClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    workspaceSlug: config.workspaceSlug,
    logger,
  });

  /**
   * Proyectos configurados, YA resueltos contra la API (`refreshProjects`). Copia local:
   * el config del caller puede venir congelado y, en cualquier caso, la resolución es
   * estado del provider — no un efecto lateral sobre la config de quien lo construye.
   * @type {Array<any>}
   */
  let configuredProjects = Array.isArray(config.projects) ? [...config.projects] : [];

  /** @type {Array<{id: string, name: string}>} */
  let labelCache = [];
  /** @type {Map<string, string>} state UUID → state name */
  const stateCache = new Map();
  /** @type {Map<string, {name: string, group: string}>} state UUID → {name, group} */
  const stateMetaByUuid = new Map();
  /** @type {Map<string, Map<string, string>>} projectId → Map<stateName, stateId> */
  const stateByName = new Map();
  /** @type {Map<string, string>} workItem UUID → module name */
  const moduleCache = new Map();
  /** @type {Map<string, Map<string, string>>} projectId → Map<lowercased module name, moduleId> */
  const moduleByName = new Map();
  let initTimestamp = 0;
  const INIT_TTL_MS = 5 * 60 * 1000; // re-init every 5min

  /**
   * Identidad del dueño de la API key (KODO-58). Se siembra desde lo cacheado en
   * config.json y solo se resuelve por red cuando falta — ver `resolveOperator`.
   * @type {{id: string, display_name?: string}|null}
   */
  let operator = config.operator?.id ? { ...config.operator } : null;

  /**
   * Resuelve la identidad del operador CONTRA LA API y la cachea (config.json).
   *
   * `force = false` (el camino del `init`): si ya hay identidad —cacheada en config o
   * resuelta en un init anterior— NO se llama a la red. En régimen permanente esto es
   * cero peticiones; solo el primer arranque de una instalación paga el `GET /users/me`.
   *
   * `force = true` (el camino de `kodo doctor --operator`): siempre pregunta, para que
   * el operador pueda refrescar una caché obsoleta (key rotada, cuenta distinta).
   *
   * FAIL-OPEN por construcción: un fallo deja `operator` como estaba —típicamente
   * `null`, «no sé quién soy»— y `assigneeVerdict` interpreta esa ausencia dejando pasar
   * TODO. Un `/users/me` caído degrada al comportamiento anterior a KODO-58, nunca a un
   * daemon que no lanza nada.
   *
   * @param {boolean} [force]
   * @returns {Promise<{id: string, display_name?: string}|null>}
   */
  async function resolveOperator(force = false) {
    if (operator?.id && !force) return operator;
    try {
      const me = await client.getMe();
      if (!me?.id) return operator;
      operator = me;
      if (opts.persistOperatorFn) opts.persistOperatorFn(me);
    } catch (err) {
      warn(
        `No se pudo resolver la identidad del operador contra Plane (GET /users/me): ${/** @type {any} */ (err)?.message ?? err}. El filtro por asignado queda inactivo hasta la próxima vez.`,
      );
    }
    return operator;
  }

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
   * Map a Plane state ({name, group}) to the normalized provider_state vocabulary.
   *
   * Precedence (D-08): the `name` substring WINS over `group`, because "In Review" /
   * "Blocked" typically live inside Plane's `started` group — mapping by group alone
   * would lose that signal (the exact ROMAN-150 driver).
   *
   * Comparison is `String.includes` case-insensitive ONLY — NEVER a RegExp over the
   * provider-controlled name (anti-ReDoS, D-10). Returns one of the five literals; never
   * echoes the raw Plane state name (D-09).
   *
   * @param {string} [name] - state name (provider-controlled, untrusted)
   * @param {string} [group] - Plane state group: backlog|unstarted|started|completed|cancelled
   * @returns {'in_progress'|'in_review'|'blocked'|'done'|'unknown'}
   */
  function mapPlaneState(name, group) {
    const lower = (name || '').toLowerCase();
    if (lower.includes('review')) return 'in_review';
    if (lower.includes('block')) return 'blocked';
    switch (group) {
      case 'completed':
      case 'cancelled':
        return 'done';
      case 'started':
      case 'unstarted':
        return 'in_progress';
      case 'backlog':
        return 'unknown';
      default:
        return 'unknown';
    }
  }

  /**
   * Emite un aviso por el logger inyectado; sin logger, cae a stderr (mismo destino
   * que el resto de avisos no fatales de este módulo).
   * @param {string} msg
   * @param {object} [ctx]
   */
  function warn(msg, ctx) {
    if (logger) logger.warn(msg, ctx);
    else console.warn(`[kodo] ${msg}`);
  }

  /**
   * Refresca `identifier`/`name` de cada proyecto configurado contra la API (KODO-13).
   *
   * Plane MANDA: el ref `PROJECT-N` se construye con el identifier que devuelve la API,
   * no con el que quedó cacheado en `~/.kodo/config.json` el día que se configuró el
   * proyecto. Renombrar un proyecto en Plane (ITROMAN → ITCLIP) invalidaba ese cache y
   * kodo seguía emitiendo refs fantasma (`ITROMAN-1`) que no existen en el provider.
   *
   * FAIL-OPEN por construcción: si la llamada falla, o si un proyecto configurado no
   * aparece en la respuesta (borrado, permisos, respuesta parcial), se CONSERVA lo
   * cacheado — degradar un identifier que funciona por un fallo de red tumbaría el
   * dispatch entero. Única excepción: la entrada UUID-string sin resolver cae a
   * `UNKNOWN` (comportamiento previo — nunca tuvo identifier que conservar), que es
   * justo lo que `kodo doctor` reporta como `dispatched_unknown_identifier`.
   *
   * Muta `configuredProjects` in-memory; NO reescribe config.json — la divergencia
   * persistida en disco la reporta `kodo doctor --identifiers`.
   */
  async function refreshProjects() {
    if (configuredProjects.length === 0) return;

    let remote;
    try {
      remote = await client.listProjects();
    } catch (err) {
      warn(
        `No se pudieron refrescar los identifiers de proyecto contra Plane: ${/** @type {any} */ (err)?.message ?? err}. Se usan los valores cacheados en config.json.`,
      );
      return;
    }

    const byId = new Map(
      (Array.isArray(remote) ? remote : []).filter((p) => p && p.id).map((p) => [p.id, p]),
    );

    configuredProjects = configuredProjects.map((entry) => {
      const isString = typeof entry === 'string';
      const id = isString ? entry : entry?.id;
      const found = id ? byId.get(id) : undefined;

      if (!found) return isString ? { id, identifier: 'UNKNOWN', name: id } : entry;

      if (!isString && entry.identifier && entry.identifier !== found.identifier) {
        warn(
          `Identifier obsoleto en config.json para el proyecto ${id}: cacheado "${entry.identifier}", real en Plane "${found.identifier}". Se usa el de Plane; corrige el config con "kodo config" para que dejen de divergir.`,
          { project_id: id, cached_identifier: entry.identifier, provider_identifier: found.identifier },
        );
      }
      return { id: found.id, identifier: found.identifier, name: found.name };
    });
  }

  /**
   * Find the project config entry matching a given identifier prefix.
   * @param {string} prefix
   * @returns {{id: string, identifier: string, name: string}}
   */
  function findProject(prefix) {
    const proj = configuredProjects.find((p) => p.identifier === prefix);
    if (!proj) throw new Error(`No configured project with identifier "${prefix}"`);
    return proj;
  }

  /** @type {import('../../interface.js').TaskProvider} */
  const provider = {
    async init() {
      // Skip re-init if recent
      if (initTimestamp && Date.now() - initTimestamp < INIT_TTL_MS) return;

      // KODO-58: identidad del dueño de la API key. NO-OP sin red cuando ya está
      // cacheada en `providers.plane.operator` (el caso normal); never-throws, así que
      // no puede tumbar un init que hoy sí funciona.
      await resolveOperator();

      // Resolve project entries contra la API: enriquece los UUID strings sueltos a
      // { id, identifier, name } (para que el resto de métodos dependa de una sola forma)
      // Y revalida los objetos ya persistidos, cuyo identifier cacheado queda obsoleto en
      // cuanto el proyecto se renombra en Plane (KODO-13). Never-throws — ver refreshProjects.
      await refreshProjects();

      // Fetch labels for each configured project
      const allLabels = [];
      for (const proj of configuredProjects) {
        const data = await client.request(`/projects/${proj.id}/labels/`);
        const labels = data.results || data;
        allLabels.push(...labels);
      }
      labelCache = allLabels;

      // Cache states for each project (UUID ↔ name, UUID → {name, group}).
      // Las claves de byName se normalizan a lowercase: los nombres de estado de Plane
      // varían de capitalización entre proyectos ("In review" vs "In Review") y el config
      // guarda UN solo nombre — el match exacto rompía updateTaskState por proyecto
      // (mismo criterio que moduleByName, que ya es lowercase).
      for (const proj of configuredProjects) {
        const states = await client.listStates(proj.id);
        const byName = new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          stateMetaByUuid.set(s.id, { name: s.name, group: s.group });
          byName.set(s.name.toLowerCase(), s.id);
        }
        stateByName.set(proj.id, byName);
      }

      // Cache module membership per project (workItemId → moduleName)
      for (const proj of configuredProjects) {
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
        webUrl: config.webUrl,
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
      // Lookup case-insensitive: byName tiene claves lowercase (ver init) porque la
      // capitalización de los estados varía por proyecto en Plane.
      const stateKey = stateName.toLowerCase();
      let stateId = stateByName.get(task.projectId)?.get(stateKey);
      if (!stateId) {
        // Cache miss: refresh just this project's states (could be a new state).
        const states = await client.listStates(task.projectId);
        const byName = new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          byName.set(s.name.toLowerCase(), s.id);
        }
        stateByName.set(task.projectId, byName);
        stateId = byName.get(stateKey);
        if (!stateId) {
          const available = states.map((s) => s.name).join(', ');
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

    // OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected at
    // the call site via `typeof provider.getTaskState === 'function'`.
    //
    // Reads the task's CURRENT state ASSIGNMENT live via getWorkItem (the `state` UUID),
    // then resolves it against the cached state DEFINITIONS (UUID → {name, group} from
    // listStates). This Plane API does NOT populate `state_detail` even with
    // `expand=state_detail` — the work item only carries `state` as a UUID, so the prior
    // `workItem.state_detail` read was always undefined → mapped everything to 'unknown'.
    // The state definitions (workflow columns) are stable and cached at init; only the
    // task's assignment is read live, so the result stays current. Cold/stale cache (called
    // before init, or a state added since) → fetch this project's states once and retry.
    // Errors propagate; the server enrichment (Plan 02) owns fail-open. Maps via the pure
    // mapPlaneState helper (name-substring-first, then group; String.includes only, D-10).
    async getTaskState({ id, projectId }) {
      const workItem = await client.getWorkItem(projectId, id);
      const stateId = workItem?.state;
      if (stateId && !stateMetaByUuid.has(stateId)) {
        const states = await client.listStates(projectId);
        const byName = stateByName.get(projectId) || new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          stateMetaByUuid.set(s.id, { name: s.name, group: s.group });
          byName.set(s.name.toLowerCase(), s.id);
        }
        stateByName.set(projectId, byName);
      }
      const meta = stateMetaByUuid.get(stateId) || {};
      return mapPlaneState(meta.name, meta.group);
    },

    // OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected at
    // the call site via `typeof provider.createTask === 'function'`.
    //
    // Creates a work item (BIDIR-01) for an adopted ad-hoc session. The item is created
    // in the configured in-progress/trigger state (D-04 — reflects reality: the human is
    // already working it; never Backlog) and carries the `kodo:adopted` marker (D-02 /
    // Open Q1: label-UUID lookup-or-create BEFORE the POST so the marker is present at the
    // next poll tick and the dispatcher's isAdopted cut suppresses re-dispatch, even under
    // --force). The 201 is normalized back to a canonical TaskItem via the EXISTING
    // normalizeWorkItem with the FULL 6-field context (Pitfall 2 — a partial context yields
    // url/state undefined), so the returned TaskItem is shape-identical to a fetched one
    // (D-06); Phase 53's adoptSession consumes it with no special case. Errors propagate
    // LOUD (D-08); the {ok,code,detail} taxonomy belongs to Phase 53. Sanitization /
    // title-derivation is Phase 53 (BIDIR-08) — createTask receives resolved args.
    async createTask({ projectId, title, description, module }) {
      const proj = configuredProjects.find((p) => p.id === projectId);
      const html = description ? '<p>' + description.replace(/\n/g, '<br>') + '</p>' : '';

      // Resolve the trigger state UUID (D-04), mirroring updateTaskState's refresh-on-miss
      // against stateByName. Unlike updateTaskState, do NOT throw if unresolved — leave
      // `state` off the body and let Plane apply the project default.
      const triggerKey = (config.states.trigger || '').toLowerCase();
      let stateId = stateByName.get(projectId)?.get(triggerKey);
      if (!stateId) {
        const states = await client.listStates(projectId);
        const byName = stateByName.get(projectId) || new Map();
        for (const s of states) {
          stateCache.set(s.id, s.name);
          byName.set(s.name.toLowerCase(), s.id);
        }
        stateByName.set(projectId, byName);
        stateId = byName.get(triggerKey);
      }

      // Resolve/create the marker label UUID (Open Q1). Plane labels are UUIDs, so look up
      // `kodo:adopted` by name in labelCache; if absent, create it via client.createLabel
      // and record the new {id,name} so subsequent creates reuse it.
      let adoptedLabel = labelCache.find(
        (l) => l.name?.toLowerCase() === KODO_LABEL_ADOPTED,
      );
      if (!adoptedLabel) {
        const created = await client.createLabel(projectId, KODO_LABEL_ADOPTED);
        adoptedLabel = { id: created.id, name: created.name };
        labelCache.push(adoptedLabel);
      }

      // Omit description_html when empty (no description): Plane rejects an empty
      // string with `400 {"non_field_errors":["Invalid HTML passed"]}` (Phase 56 UAT
      // blocker). Mirror the optional-field idiom used for `state` below.
      const raw = await client.createWorkItem(projectId, {
        name: title,
        ...(html ? { description_html: html } : {}),
        ...(stateId ? { state: stateId } : {}),
        labels: [adoptedLabel.id],
      });

      // Module placement (Phase 57 module-placement gap-fix). `module` is a module NAME string
      // (config/cwd-derived, NOT user free-text). The work item ALREADY EXISTS at this point —
      // a module-resolution/association failure is a DEGRADED outcome (the item lands in the
      // project but not the module board), NEVER a fatal CREATE_FAILED. FAIL-OPEN by construction:
      // the whole resolve+associate is wrapped in try/catch and ALWAYS falls through to the return
      // of the created task. Mirrors the idempotent posture of the label-409 fix.
      if (typeof module === 'string' && module.length > 0) {
        try {
          const target = module.toLowerCase();
          let byName = moduleByName.get(projectId);
          let moduleId = byName?.get(target);
          if (!moduleId) {
            // Cache miss (or never warmed): list this project's modules and (re)build the name→id map.
            const modules = await client.listModules(projectId);
            byName = byName || new Map();
            for (const mod of modules) {
              byName.set((mod.name || '').toLowerCase(), mod.id);
            }
            moduleByName.set(projectId, byName);
            moduleId = byName.get(target);
          }
          if (moduleId) {
            await client.addWorkItemToModule(projectId, moduleId, raw.id);
          } else {
            console.warn(
              `[kodo] Module "${module}" not found in project ${proj?.identifier || projectId}; ` +
                `work item created without module placement.`,
            );
          }
        } catch (err) {
          // FAIL-OPEN: the work item is already created; a module failure must NOT throw out of
          // createTask (would surface as CREATE_FAILED and lose the created item from local state).
          console.warn(
            `[kodo] Module placement failed for "${module}": ${err?.message ?? err}; ` +
              `work item created without module placement.`,
          );
        }
      }

      const context = {
        labels: labelCache,
        projectIdentifier: proj?.identifier || 'UNKNOWN',
        baseUrl: config.baseUrl,
        webUrl: config.webUrl,
        workspaceSlug: config.workspaceSlug,
        stateMap: stateCache,
      };
      return normalizeWorkItem(raw, context);
    },

    async listPendingTasks() {
      const allTasks = [];
      for (const proj of configuredProjects) {
        // No expand — stateCache already maps UUID → name, project is known.
        const items = await client.listWorkItems(proj.id);
        const pending = items.filter(
          (item) => (stateCache.get(item.state) || '').toLowerCase() === (config.states.trigger || '').toLowerCase(),
        );
        const context = {
          labels: labelCache,
          projectIdentifier: proj.identifier,
          baseUrl: config.baseUrl,
          webUrl: config.webUrl,
          workspaceSlug: config.workspaceSlug,
          stateMap: stateCache,
        };
        for (const item of pending) {
          const task = normalizeWorkItem(item, context);
          // Only what the dispatcher would actually launch: `kodo`-labeled and neither
          // gsd-child nor adopted. Mirrors the GitHub provider (`labels: ['kodo']` in its
          // query). Without this cut every work item in the trigger state counted as
          // pending — `kodo check` fired the orchestrator with nothing to dispatch.
          if (!isDispatchable(task.labels)) continue;
          allTasks.push(task);
        }
      }
      // KODO-58: y solo lo que ESTE daemon lanzaría. Con dos operadores sobre los mismos
      // proyectos, las tareas del otro estaban contándose como pendientes aquí, así que
      // `kodo check` despertaba al orquestador para dispatchar trabajo que su propio gate
      // iba a rechazar. MISMA regla que el gate del dispatcher (una sola definición de
      // «esta tarea es mía»), e inerte sin identidad conocida.
      return filterByOperator(allTasks, {
        operatorId: operator?.id,
        requireAssignee: config.requireAssignee !== false,
      });
    },

    parseTriggerEvent(rawPayload) {
      return parseTriggerEvent(rawPayload, labelCache, configuredProjects);
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

    // OPTIONAL methods (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Se detectan
    // en el call site con `typeof provider.getOperator === 'function'`, igual que
    // `getTaskState` y `createTask`. KODO-58.
    //
    // `getOperator` es SÍNCRONO y sin red: devuelve lo que ya se sabe (config o init).
    // El gate del dispatcher se llama en el camino caliente de cada webhook y no puede
    // permitirse una petición HTTP por evento; `null` significa «no lo sé», y aguas
    // arriba eso deja pasar la tarea (fail-open).
    getOperator() {
      return operator ? { ...operator } : null;
    },

    // `refreshOperator` SÍ va a la red y reescribe la caché. Único consumidor:
    // `kodo doctor --operator`, opt-in como el resto de checks con red del doctor.
    async refreshOperator() {
      const me = await resolveOperator(true);
      return me ? { ...me } : null;
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
