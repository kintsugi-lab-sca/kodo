// @ts-check
//
// test/helpers/fake-cmux-groups.js — KODO-106.
//
// Simulador en memoria del modelo de workspace-groups de cmux, con la semántica de
// `workspace-group create` de cada versión que nos importa:
//
//   - '0.64.20': `create --from <ws>` levanta un ancla NUEVA y mete `<ws>` como miembro.
//   - '0.65.2' : `create --from <ws>` REUTILIZA el primer `<ws>` como ancla (la regresión
//                que dejó a LIKEN-133 / PCHAT-13 de header de su grupo).
//   - 'adopt-cwd': cmux hipotético que, SIN `--from`, adopta como ancla un workspace
//                existente con el mismo cwd. Ejercita el guard post-creación.
//
// En las tres, `create` sin `--from` (y sin workspace adoptable) crea un ancla generada
// con título `--name` y cwd `--cwd`, y `set-anchor` sobre un no-miembro lanza `not_found`
// (verificado en vivo, cmux 0.65.2). Expone los verbos con la forma de los deps del doctor.

/**
 * @param {{
 *   version?: '0.64.20' | '0.65.2' | 'adopt-cwd',
 *   workspaces?: Array<{ ref: string, name?: string, cwd?: string }>,
 *   groups?: Array<{ ref: string, name: string, anchor: string, members: string[] }>,
 * }} [opts]
 */
export function fakeCmuxGroups({ version = '0.65.2', workspaces = [], groups = [] } = {}) {
  /** @type {Map<string, { name?: string, cwd?: string }>} */
  const ws = new Map(workspaces.map((w) => [w.ref, { name: w.name, cwd: w.cwd }]));
  const gs = groups.map((g) => ({ ...g, members: [...g.members] }));
  let nextWs = 100;
  let nextGroup = 50;
  /** @type {Array<[string, any]>} */
  const calls = [];

  const spawnWs = (name, cwd) => {
    const ref = `workspace:${nextWs++}`;
    ws.set(ref, { name, cwd });
    return ref;
  };
  const groupOf = (ref) => gs.find((g) => g.ref === ref);
  const detach = (ref) => {
    for (const g of gs) g.members = g.members.filter((m) => m !== ref);
  };

  const deps = {
    listWorkspaceGroupsRaw: async () => JSON.stringify({
      groups: gs.map((g) => ({
        ref: g.ref,
        name: g.name,
        anchor_workspace_ref: g.anchor,
        member_count: g.members.length,
        member_workspace_refs: [...g.members],
      })),
    }),
    listWorkspacesRaw: async () => JSON.stringify({ workspaces: [...ws.keys()].map((ref) => ({ ref })) }),
    createWorkspaceGroup: async (/** @type {any} */ o) => {
      calls.push(['create', o]);
      const from = Array.isArray(o.from) ? o.from : [];
      let anchor;
      let members;
      if (from.length && version === '0.65.2') {
        anchor = from[0];
        members = [...from];
      } else if (from.length) {
        anchor = spawnWs(o.name, o.cwd);
        members = [anchor, ...from];
      } else {
        const adoptable = version === 'adopt-cwd'
          ? [...ws.entries()].find(([, w]) => o.cwd && w.cwd === o.cwd)?.[0]
          : undefined;
        anchor = adoptable || spawnWs(o.name, o.cwd);
        members = [anchor];
      }
      for (const m of members) detach(m);
      const ref = `workspace_group:${nextGroup++}`;
      gs.push({ ref, name: o.name, anchor, members });
      return `OK ${ref}`;
    },
    addToWorkspaceGroup: async (/** @type {any} */ o) => {
      calls.push(['add', o]);
      const g = groupOf(o.group);
      if (!g || !ws.has(o.workspace)) throw new Error('not_found');
      detach(o.workspace);
      g.members.push(o.workspace);
      return 'OK';
    },
    setWorkspaceGroupAnchor: async (/** @type {any} */ o) => {
      calls.push(['set-anchor', o]);
      const g = groupOf(o.group);
      if (!g || !g.members.includes(o.workspace)) {
        throw new Error('not_found: Group not found or workspace not a member');
      }
      g.anchor = o.workspace;
      return 'OK';
    },
    newWorkspace: async (/** @type {any} */ o) => {
      calls.push(['new-workspace', o]);
      const ref = spawnWs(o.name, o.cwd);
      if (o.group) {
        const g = groupOf(o.group);
        if (!g) throw new Error('not_found');
        g.members.push(ref);
      }
      return ref;
    },
    ungroupWorkspaceGroup: async (/** @type {any} */ o) => {
      calls.push(['ungroup', o]);
      const i = gs.findIndex((g) => g.ref === o.group);
      if (i >= 0) gs.splice(i, 1);
      return 'OK';
    },
  };

  return {
    deps,
    calls,
    /** @param {string} name */
    group: (name) => gs.find((g) => g.name.toLowerCase() === name.toLowerCase()),
    /** @param {string} ref */
    workspace: (ref) => ws.get(ref),
  };
}
