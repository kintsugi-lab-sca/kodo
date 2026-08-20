// @ts-check
//
// src/host/workspace-id.js — KODO-22.
//
// Resolución de la IDENTIDAD ESTABLE de un workspace del host: el UUID que cmux
// expone en `tree --all --json` y que dentro de la tab vale `CMUX_WORKSPACE_ID`.
// Los refs `workspace:N` NO sirven de identidad — cmux los RECICLA al cerrar y
// crear tabs.
//
// Estas dos funciones nacieron en `orchestrator/launch.js` (KODO-16) para
// revalidar el registro del orquestador. KODO-22 las necesita también en el
// camino de lanzamiento de SESIONES (`session/manager.js`), y ese camino no puede
// importar `launch.js`: es el módulo pesado del arranque del orquestador (lee
// prompt.md, sincroniza la skill, habla con el provider) y vive en el tramo
// caliente del dispatch. Es la misma razón por la que existe `orchestrator/target.js`.
//
// Viven en `src/host/` porque son conocimiento del HOST (la shape de su árbol de
// workspaces), no del orquestador. `launch.js` las re-exporta, así que sus tests
// y call sites siguen intactos.
//
// Ambas son puras / never-throws. El cliente cmux SOLO se toca como default lazy
// de `listTreeFn` (import dinámico, mismo idiom que `host/cmux.js` `_legacy`):
// los callers de `src/session/` inyectan `host._legacy.listTree` y nunca alcanzan
// `cmux/client.js` — invariante cmux-isolation (Phase 38 SC#5).

/**
 * Busca un workspace en el árbol de `cmux tree --all --json` recorriendo TODOS los
 * windows. Puro / never-throws: un shape inesperado devuelve `null`, no lanza.
 *
 * Precedencia de identidad DELIBERADA: si se pasa `id`, el match es SOLO por `id`.
 * NO cae a `ref` cuando el `id` no aparece — cmux recicla los `workspace:N`, así que
 * ese fallback confundiría «mi workspace murió y otro heredó su número» con «mi
 * workspace sigue vivo», que es precisamente el falso positivo que hay que evitar.
 * El match por `ref` queda reservado para registros sin UUID (degradado).
 *
 * @param {any} treeJson - salida YA PARSEADA de `cmux tree --all --json`.
 * @param {{ id?: string|null, ref?: string|null }} identity
 * @returns {{ ref: string, id: string|null, title: string|null }|null}
 */
export function findWorkspaceInTree(treeJson, identity = {}) {
  const wantId = typeof identity.id === 'string' && identity.id ? identity.id : null;
  const wantRef = typeof identity.ref === 'string' && identity.ref ? identity.ref : null;
  if (!wantId && !wantRef) return null;

  const windows = Array.isArray(treeJson?.windows) ? treeJson.windows : [];
  for (const win of windows) {
    const workspaces = Array.isArray(win?.workspaces) ? win.workspaces : [];
    for (const ws of workspaces) {
      if (!ws || typeof ws !== 'object') continue;
      const id = typeof ws.id === 'string' ? ws.id : null;
      const ref = typeof ws.ref === 'string' ? ws.ref : null;
      const hit = wantId ? id === wantId : ref === wantRef;
      if (!hit) continue;
      // El ref del árbol GANA al registrado: es el que cmux reconoce ahora mismo.
      return { ref: ref || wantRef || '', id, title: typeof ws.title === 'string' ? ws.title : null };
    }
  }
  return null;
}

/**
 * Resuelve el UUID de un `workspace:N` consultando el árbol cross-window.
 * never-throws → `null` si cmux falla, el JSON no parsea o el ref no está.
 *
 * El `null` es un valor de PRIMERA CLASE, no un error tragado: los dos callers
 * (registro del orquestador y SessionRecord) lo persisten tal cual y degradan al
 * match por `workspace_ref`. Ninguno aborta su lanzamiento por no resolverlo.
 *
 * @param {string} ref - `workspace:N`.
 * @param {{ listTreeFn?: () => Promise<string> }} [deps] - `listTreeFn` inyectado por
 *   los callers que ya tienen host (`host._legacy.listTree`); sin él cae al host
 *   ACTIVO vía `./interface.js` (KODO-18: con `host: orca` el árbol se sintetiza
 *   desde `worktree ps` — este default no debe cablear cmux).
 * @returns {Promise<string|null>}
 */
export async function resolveWorkspaceId(ref, deps = {}) {
  try {
    const listTreeFn =
      deps.listTreeFn ||
      (async () => {
        const { getHost, resolveHostName } = await import('./interface.js');
        return getHost(resolveHostName())._legacy.listTree();
      });
    const hit = findWorkspaceInTree(JSON.parse(await listTreeFn()), { ref });
    return hit ? hit.id : null;
  } catch {
    return null;
  }
}
