// @ts-check
//
// src/daemon/polling-scopes.js — KODO-60.
//
// Helper PURO (sin FS/red, never-throws) que traduce la config de kodo a los
// argumentos que `startPolling` necesita: qué unidades polear, cada cuánto, con qué
// nombre de provider y si hay que ponerse al día con el backlog.
//
// Vive aparte de `run.js` por la misma razón que `provider-uses-polling.js`: es la
// única parte de la composición del daemon que tiene REGLAS (precedencia de
// intervalos, forma de los scopes por provider), y esas reglas se prueban mejor
// contra un objeto literal que arrancando un daemon.
//
// Convención never-throws / fail-open del repo: cualquier config ausente o malformed
// devuelve una lista de scopes VACÍA. Un loop con cero scopes tickea y no hace nada
// —ruido cero, cero peticiones— que es el fallo seguro; lanzar aquí tumbaría el
// daemon entero y con él el server de webhooks, que no tiene culpa de nada.

/** Intervalo por defecto (s) cuando la config no dice otra cosa. */
const DEFAULT_INTERVAL_S = 60;

/**
 * Normaliza un intervalo en segundos. Rechaza lo que no sea un entero ≥ 1: un `0` o un
 * negativo convertirían el `setTimeout` recursivo en un bucle caliente contra la API
 * del provider, y un intervalo así no es «raro», es un incidente.
 *
 * Acepta también el string de dígitos porque `kodo config set` persiste TAL CUAL lo
 * que le teclean y solo coerciona `true`/`false` (config-args.js): un
 * `kodo config set polling.interval_s 120` deja `"120"` en el JSON. Rechazarlo aquí
 * sería el mismo trap silencioso que KODO-58 arregló para los booleanos — el operador
 * ve el ajuste aceptado y el daemon sigue con 60.
 *
 * @param {unknown} raw
 * @returns {number | null}
 */
function normalizeInterval(raw) {
  const n = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * @typedef {{
 *   providerName: string,
 *   scopes: Array<{ owner: string, repo: string, id?: string }>,
 *   intervalSec: number,
 *   catchUp: boolean,
 * }} PollingPlan
 */

/**
 * Resuelve el plan de polling desde la config.
 *
 * Scopes por provider:
 *   - **github** — un scope por repo configurado, con la clave histórica `owner/repo`
 *     (sin `id`): el path `client` de `polling.js` sigue funcionando igual.
 *   - **plane** — un scope por proyecto configurado. `owner`/`repo` son el slug del
 *     workspace y el identifier del proyecto, y sirven SOLO para que la NDJSON se lea
 *     (`k-lab/KODO` en vez de un UUID). La clave real del cursor es `id`, el UUID del
 *     proyecto, porque es lo único que trae `TaskItem.projectId` y por tanto lo único
 *     contra lo que el filtro del loop puede comparar.
 *
 * Precedencia del intervalo: `providers.github.poll_interval` gana para github (es la
 * clave que ese provider ya documentaba y que un operador puede tener puesta), y
 * `polling.interval_s` es el default general. Para plane solo existe `polling.interval_s`.
 *
 * @param {any} config — config de kodo (untrusted).
 * @returns {PollingPlan}
 */
export function resolvePollingPlan(config) {
  const providerName = typeof config?.provider === 'string' ? config.provider : 'plane';
  const globalInterval = normalizeInterval(config?.polling?.interval_s);
  const catchUp = config?.polling?.catch_up === true;

  if (providerName === 'github') {
    const repos = Array.isArray(config?.providers?.github?.repos)
      ? config.providers.github.repos
      : [];
    return {
      providerName,
      scopes: repos
        .filter((r) => r && typeof r.owner === 'string' && typeof r.repo === 'string')
        .map((r) => ({ owner: r.owner, repo: r.repo })),
      intervalSec:
        normalizeInterval(config?.providers?.github?.poll_interval) ??
        globalInterval ??
        DEFAULT_INTERVAL_S,
      catchUp,
    };
  }

  if (providerName === 'plane') {
    const plane = config?.providers?.plane || {};
    const workspace = typeof plane.workspace_slug === 'string' ? plane.workspace_slug : 'plane';
    const projects = Array.isArray(plane.projects) ? plane.projects : [];
    return {
      providerName,
      // Una entrada sin `id` no es poleable: sin UUID no hay nada contra lo que filtrar
      // `TaskItem.projectId`, y un scope que jamás casa es peor que no tenerlo (tickea,
      // pide, y descarta todo en silencio). Se cae fuera, y `kodo doctor` es quien
      // reporta un config de proyectos a medio resolver.
      scopes: projects
        .filter((p) => p && typeof p.id === 'string' && p.id.length > 0)
        .map((p) => ({
          owner: workspace,
          repo: typeof p.identifier === 'string' && p.identifier ? p.identifier : p.id,
          id: p.id,
        })),
      intervalSec: globalInterval ?? DEFAULT_INTERVAL_S,
      catchUp,
    };
  }

  // Provider desconocido: sin scopes. El loop arranca (si algo lo pidió) y no hace nada.
  return { providerName, scopes: [], intervalSec: globalInterval ?? DEFAULT_INTERVAL_S, catchUp };
}
