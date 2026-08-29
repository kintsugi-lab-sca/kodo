// src/host/bb.js
// BbHost — implementación del contrato WorkspaceHost (D-03) sobre threads de BB (KODO-31).
//
// Hermano exacto de src/host/cmux.js y src/host/orca.js: mismos 4 métodos del contrato,
// mismo bloque `_legacy` de lifecycle, mismo criterio never-throws + caché 1-tick. ÚNICO
// punto de la base de código (fuera de src/bb/) autorizado a hablar con el binario bb.
//
// NO importa src/logger.js (LOG-12): el logger se inyecta vía opts.logger.
//
// Diferencias materiales frente a cmux y orca — TODAS verificadas en vivo contra una
// instancia real de bb-app, no inferidas de la documentación:
//
//   · IDENTIDAD ESTABLE. El ref es el id del thread (`thr_…`) y BB no lo recicla. Como en
//     orca, toda la defensa de Phase 43 contra el reciclaje de `workspace:N` sobra aquí,
//     pero `title` se sigue exponiendo porque `reconcile` lo consume genéricamente.
//
//   · AISLAMIENTO PROPIO. `thread spawn --new-environment worktree` materializa un
//     checkout git. Por eso `bb` entra en `HOSTS_WITH_OWN_WORKTREE` y `session/manager.js`
//     OMITE `claude --worktree`: anidar un segundo worktree desalinearía `worktree_path`
//     en state.json y dejaría un cleanup fantasma en session-end.
//
//   · EL PROMPT VIAJA EN EL SPAWN. BB no es un terminal: no hay shell donde teclear
//     `claude …`. `--prompt` es obligatorio en `thread spawn`, así que el prompt se
//     entrega al crear el workspace y NO hay `send` posterior en el launch path — ver
//     `hostDeliversPrompt` en `./interface.js`. `_legacy.send` (`thread tell`) queda para
//     los mensajes POSTERIORES: el nudge del orquestador y la reapertura tras el cierre.
//
//   · CIERRE EXPLÍCITO. Al terminar el turno BB deja el thread en `idle` con el proceso
//     `claude` VIVO; `SessionEnd` solo dispara con `bb thread stop`. Ese verbo se expone
//     como `_legacy.close` y lo invoca el carril de autocierre de `session/reconcile.js`.
//     Ningún otro host lo necesita, y por eso el consumidor lo detecta por `typeof`.
//
//   · SIN ADOPCIÓN. `listAgentSurfaces` NO se implementa, misma razón que en orca: BB no
//     publica en su CLI el session_id de Claude Code (lo genera por dentro y lo expone
//     solo dentro del proceso hijo, como `CLAUDE_CODE_SESSION_ID`), así que no hay forma
//     honesta de reconstruir la identidad de un thread ad-hoc desde fuera. El método es
//     OPCIONAL y se detecta por `typeof` en los call sites → el descubrimiento de adopción
//     degrada a `[]` sin romper nada.
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';

const TIMEOUT_MS = 20_000;

/**
 * Ejecuta un comando bb y retorna stdout.
 *
 * A diferencia del `execFileSync` de cmux/orca aquí se usa `execFile` ASÍNCRONO: el
 * binario de BB habla con el servidor por HTTP y el reconcile loop del daemon lo invoca
 * cada ~2,5 s; bloquear el event loop del server durante ese round-trip es exactamente lo
 * que el loop single-flight intenta evitar. La caché 1-tick es idéntica a la de sus
 * hermanos.
 *
 * @param {string} binary
 * @param {Function} [execImpl] - execFile inyectable (DI de tests).
 * @returns {(args: string[]) => Promise<string>}
 */
function makeRun(binary, execImpl) {
  const exec = execImpl || execFile;
  return (args) =>
    new Promise((resolve, reject) => {
      exec(
        binary,
        args,
        {
          encoding: 'utf-8',
          timeout: TIMEOUT_MS,
          maxBuffer: 8 * 1024 * 1024,
          // BB_SERVER_URL desde la config de kodo: el daemon no debe depender de qué
          // exportó la shell del operador. Se limpian BB_THREAD_ID/BB_ENVIRONMENT_ID por
          // la misma razón que en src/bb/client.js — si kodo corre DENTRO de un thread de
          // BB, heredarlas haría que los subcomandos apuntaran al thread equivocado.
          env: bbEnv(),
        },
        (err, stdout, stderr) => {
          if (err) {
            reject(Object.assign(new Error(String(stderr || err.message).slice(0, 300)), { code: err.code }));
            return;
          }
          resolve(String(stdout));
        },
      );
    });
}

/**
 * Entorno del proceso hijo. Ver la nota de `makeRun`.
 * @returns {NodeJS.ProcessEnv}
 */
function bbEnv() {
  const env = { ...process.env, BB_SERVER_URL: loadConfig().bb?.server_url || 'http://127.0.0.1:38886' };
  delete env.BB_THREAD_ID;
  delete env.BB_ENVIRONMENT_ID;
  return env;
}

/**
 * ¿Está vivo el workspace del thread? PURA.
 *
 * PRESENCIA = VIDA, como en cmux y al contrario que en orca. `bb thread list` excluye por
 * defecto los threads archivados y los borrados, así que aparecer en el listado ya
 * significa «este workspace sigue ahí». Los campos `archivedAt`/`deletedAt` se comprueban
 * igualmente porque el listado los expone y `--archived`/`--include-hidden` podrían
 * traerlos en una llamada futura.
 *
 * NO SE DERIVA DEL STATUS, y esto es una decisión con evidencia detrás. La ficha proponía
 * `alive ← status ∈ {starting, active} o idle con runtime vivo`, pero al verificar el
 * esquema real de BB resulta que `runtime` es `{displayStatus, hostReconnectGraceExpiresAt}`
 * y `displayStatus` REFLEJA `status` (`idle|starting|active|stopping|error`, más
 * `provisioning|host-reconnecting|waiting-for-host`): NO hay ningún campo que distinga un
 * thread idle con el runtime cargado de uno con el runtime ya liberado. Inventar esa
 * distinción a partir del status sería marcar MUERTA toda sesión que simplemente ha
 * terminado su turno — el mismo falso «dead» (ROMAN-151/152) que el carril de reconcile
 * existe para evitar, y que ya mordió al host orca en su UAT.
 *
 * La vitalidad del PROCESO no se pierde: la aporta el `pgrep` por session_id que
 * `runReconcileTick` hace por su cuenta, que no depende del cliente. Y el thread que se
 * queda idle para siempre lo cierra el carril de autocierre, no una heurística de status.
 *
 * Enum observado de `status`: `idle` · `starting` · `active` · `stopping` · `error`.
 *
 * @param {any} t - fila de `thread list --json`.
 * @returns {boolean}
 */
export function deriveAlive(t) {
  if (t?.archivedAt != null) return false;
  if (t?.deletedAt != null) return false;
  return true;
}

/**
 * ¿Espera este thread input del humano? PURA.
 *
 * `hasPendingInteraction` es la señal NATIVA de BB para «el agente ha hecho una pregunta y
 * espera respuesta» — no un proxy derivado como el `unread` que orca ofrecía y que se
 * descartó allí por generar falsos positivos. Se compara con `=== true` estricto: bajo el
 * threat model de stdout no confiable, un `"true"` string no debe colarse.
 *
 * @param {any} t - fila de `thread list --json`.
 * @returns {boolean}
 */
export function deriveNeedsInput(t) {
  return t?.hasPendingInteraction === true;
}

/**
 * Normaliza el timestamp de actividad de BB (epoch en MILISEGUNDOS) a ISO 8601, que es lo
 * que declara el typedef `WorkspaceInfo.last_activity`. PURA.
 *
 * `latestAttentionAt` (última vez que el thread reclamó atención) es la señal que la
 * propia app usa para ordenar la lista, así que gana a `updatedAt` (que se mueve también
 * con toques de metadatos como marcar leído). Un valor no-numérico, negativo o no finito →
 * `null` en vez de un `Invalid Date` propagado al dashboard.
 *
 * @param {any} t
 * @returns {string|null}
 */
export function deriveLastActivity(t) {
  for (const raw of [t?.latestAttentionAt, t?.updatedAt]) {
    const ms = Number(raw);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  return null;
}

/**
 * Título legible del thread. PURA.
 *
 * `title` es el que kodo fija en el spawn (lleva el `task_ref`, que es lo que
 * `titleIdentifiesSession` de reconcile verifica); `titleFallback` es el que BB deriva del
 * prompt cuando no hay título explícito. Se prefiere el explícito.
 *
 * @param {any} t
 * @returns {string|undefined}
 */
export function deriveTitle(t) {
  if (typeof t?.title === 'string' && t.title) return t.title;
  if (typeof t?.titleFallback === 'string' && t.titleFallback) return t.titleFallback;
  return undefined;
}

/**
 * Normaliza la salida ya parseada de `thread list --json` a `WorkspaceInfo[]`. PURA y
 * defensiva (never-throws): filas falsy o sin `id` string se OMITEN — mismo patrón
 * fila-a-fila que `normalizeWorkspaces` (orca) y `normalizeSurface` (cmux).
 *
 * `thread list --json` devuelve un array PLANO, sin sobre: a diferencia de orca no hay
 * `{ok, result}` que desempaquetar.
 *
 * @param {any} listResult - salida ya parseada de `thread list --json`.
 * @returns {import('./interface.js').WorkspaceInfo[]}
 */
export function normalizeWorkspaces(listResult) {
  const threads = Array.isArray(listResult) ? listResult : [];
  const out = [];
  for (const t of threads) {
    if (!t || typeof t.id !== 'string') continue;
    out.push({
      workspace_ref: t.id,
      alive: deriveAlive(t),
      needs_input: deriveNeedsInput(t),
      last_activity: deriveLastActivity(t),
      title: deriveTitle(t),
    });
  }
  return out;
}

/**
 * Factory de BbHost.
 * @param {Object} [opts]
 * @param {Function} [opts.run] - función async (args) => stdout (DI de tests).
 * @param {Function} [opts.exec] - execFile inyectable (alternativa a run).
 * @param {string}   [opts.binary] - path al binario bb; default loadConfig().bb.binary.
 * @param {Object}   [opts.logger] - logger inyectado (opcional). NO se importa (LOG-12).
 * @returns {Object} WorkspaceHost (4 métodos) + _legacy (lifecycle BB-specific).
 */
export function createBbHost(opts = {}) {
  const binary = opts.binary || loadConfig().bb?.binary || 'bb';
  const run = opts.run || makeRun(binary, opts.exec);
  const logger = opts.logger;

  // Caché 1-tick, idéntica a la de cmux y orca: listWorkspaces la puebla;
  // isAlive/needsInput leen de aquí sin volver a hablar con BB.
  const lastSnapshot = new Map(); // ref -> WorkspaceInfo

  /**
   * Lista los workspaces normalizados a WorkspaceInfo. never-throws.
   *
   * UNA sola llamada al binario (`thread list --json`), como orca y frente a las dos de
   * cmux: BB ya entrega presencia, atención y estado de interacción en la misma vista.
   *
   * @returns {Promise<import('./interface.js').WorkspaceInfo[]>}
   */
  async function listWorkspaces() {
    const started = Date.now();
    let raw;
    try {
      raw = await run(['thread', 'list', '--json']);
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: err?.code || 'EXEC_ERROR',
        detail: String(err?.message || '').trim().slice(0, 200),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: 'PARSE_ERROR',
        detail: String(err?.message || '').trim().slice(0, 200),
        duration_ms: Date.now() - started,
      });
      return [];
    }

    // Un payload que NO es array no es «lista vacía»: es un shape inesperado (un binario
    // que imprimió otra cosa, una versión de bb incompatible). Se trata como fallo para no
    // borrar el snapshot con datos falsos — mismo criterio que el `ok:false` de orca.
    if (!Array.isArray(parsed)) {
      logger?.warn?.('host.list_workspaces.fail', {
        code: 'NOT_AN_ARRAY',
        detail: `thread list devolvió ${typeof parsed}`,
        duration_ms: Date.now() - started,
      });
      return [];
    }

    const out = normalizeWorkspaces(parsed);
    lastSnapshot.clear();
    for (const info of out) lastSnapshot.set(info.workspace_ref, info);
    logger?.debug?.('host.list_workspaces.ok', { count: out.length, duration_ms: Date.now() - started });
    return out;
  }

  /**
   * Trae el foco de la app de BB al thread. never-throws: devuelve el MISMO shape
   * `{ok:true} | {ok:false, code, detail}` que sus hermanos, para que el dashboard no
   * distinga hosts.
   *
   * @param {string} ref
   * @returns {Promise<{ok:true}|{ok:false,code:string,detail:string}>}
   */
  async function selectWorkspace(ref) {
    try {
      const { focusWorkspace } = await import('../bb/client.js');
      await focusWorkspace({ workspace: ref });
      return { ok: true };
    } catch (err) {
      return { ok: false, code: err?.code || 'BB_FOCUS_FAILED', detail: String(err?.message || '').slice(0, 200) };
    }
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function isAlive(ref) {
    return lastSnapshot.get(ref)?.alive ?? false;
  }

  /** Lee del snapshot cacheado (1-tick). never-throws. @returns {Promise<boolean>} */
  async function needsInput(ref) {
    return lastSnapshot.get(ref)?.needs_input ?? false;
  }

  // _legacy: passthroughs FIELES a src/bb/client.js, espejo 1:1 del bloque homónimo de los
  // hosts cmux y orca. Firmas idénticas salvo donde el capability gap lo impide
  // (setColor / setStatus / listWorkspaceGroups), documentado en cada método. El cliente se
  // carga lazy vía import() — confinado a este archivo.
  const _legacy = {
    /**
     * @param {{ name: string, cwd?: string, prompt?: string, model?: string,
     *           skipPermissions?: boolean, command?: string, group?: string }} opts
     * @returns {Promise<string>} id del thread
     */
    async newWorkspace(opts) {
      return (await import('../bb/client.js')).newWorkspace(opts);
    },
    /**
     * NO-OP. BB no tiene color por thread. A diferencia de orca —donde `setColor` es no-op
     * pero `setStatus` SÍ tiene canal real (la columna del tablero)— aquí lo son los dos:
     * BB agrupa por secciones, que son una organización del operador, no un reflejo del
     * estado de la sesión. El estado sigue siendo visible en el dashboard de kodo y en el
     * provider, que es donde el operador lo mira.
     * @param {{ workspace: string, color: string }} _opts
     */
    async setColor(_opts) {
      return null;
    },
    /**
     * NO-OP fail-open (ver `setColor`). Se conserva el método para que el launch path
     * compartido no tenga que ramificar por host ni protegerse con un `typeof`.
     * @param {{ workspace: string, status: 'running'|'done'|'error'|'review' }} _opts
     */
    async setStatus(_opts) {
      return null;
    },
    /**
     * Path del checkout que BB materializó para este thread (`environment.path`).
     *
     * OPCIONAL: solo lo expone un host que cree su propio worktree (ver
     * `HOSTS_WITH_OWN_WORKTREE`). El caller lo detecta por `typeof`, mismo idiom que
     * `listAgentSurfaces`. `session/manager.js` lo usa para rellenar `worktree_path`, que
     * es lo que hace que el overlay de progreso del dashboard lea el `.planning/` de la
     * sesión y no el del repo principal.
     *
     * @param {string} ref
     * @returns {Promise<string|null>}
     */
    async workspaceCwd(ref) {
      return (await import('../bb/client.js')).workspacePathFromRef(ref);
    },
    /**
     * NO-OP. La «descripción» de cmux/orca es una línea secundaria en el sidebar; BB no
     * tiene ese hueco (el subtítulo del thread es el `titleFallback` derivado del prompt,
     * que BB gestiona). El marcador de «sesión gestionada por kodo» viaja en el TÍTULO,
     * que sí lleva el `task_ref`.
     * @param {{ workspace: string, description: string }} _opts
     */
    async setDescription(_opts) {
      return null;
    },
    /**
     * NO-OP. `bb thread update --title` existe, pero el título de un thread de kodo se fija
     * en el spawn y no vuelve a cambiar: el único consumidor de `rename` es `kodo adopt`
     * (Phase 59), y la adopción está fuera de alcance en este host (ver `listAgentSurfaces`).
     * Se conserva el método por el mismo motivo que el `rename` no-op del NullHost:
     * degradar en vez de romper con "is not a function".
     * @param {{ workspace: string, title: string }} _opts
     */
    async rename(_opts) {
      return null;
    },
    /**
     * Mensaje de seguimiento (`thread tell`). NO es el carril del primer prompt —ese viaja
     * en `newWorkspace`—: cubre el nudge del orquestador y la reapertura de un thread
     * parado (verificado: `tell` sobre un thread detenido lo reanuda).
     * @param {{ workspace: string, text: string }} opts
     */
    async send(opts) {
      return (await import('../bb/client.js')).send(opts);
    },
    /**
     * Para el thread y libera el runtime (`bb thread stop`) — el verbo que hace disparar
     * `SessionEnd` y con él todo el camino de cierre existente.
     *
     * OPCIONAL y typeof-detected, como `workspaceCwd`: es el ÚNICO host que lo necesita.
     * En cmux y orca el proceso `claude` muere cuando el humano cierra la tab, así que no
     * hay nada que kodo tenga que parar; en BB el proceso sobrevive al fin del turno y el
     * thread se queda `idle` para siempre si nadie lo detiene.
     *
     * NO archiva el thread ni toca el worktree: la rama sigue bajo el gate de integración
     * de kodo, y el archivado es decisión del humano.
     *
     * @param {string} ref
     * @returns {Promise<any>}
     */
    async close(ref) {
      return (await import('../bb/client.js')).close({ workspace: ref });
    },
    /**
     * NO-OP (BB no expone notificaciones de SO en su CLI). Resuelve en vacío para no
     * obligar al launch path a ramificar por host — mismo criterio que orca.
     * @param {{ title: string, body?: string, workspace?: string }} opts
     */
    async notify(opts) {
      return (await import('../bb/client.js')).notify(opts);
    },
    /** @param {{ workspace: string, lines?: number }} opts @returns {Promise<string>} */
    async readScreen(opts) {
      return (await import('../bb/client.js')).readScreen(opts);
    },
    /** @returns {Promise<string>} texto `<ref>  <título>` (espejo de `cmux workspace list`) */
    async listWorkspaces() {
      return (await import('../bb/client.js')).listWorkspaces();
    },
    /**
     * Vista cross-window para la revalidación de identidad del orquestador, en el mismo
     * shape que `cmux tree --all --json`. En BB se SINTETIZA desde `thread list` — ver
     * `buildTreeFromThreads`.
     * @returns {Promise<string>} JSON serializado
     */
    async listTree() {
      return (await import('../bb/client.js')).listTree();
    },
    /** @returns {Promise<string>} `'{"groups":[]}'` — BB no tiene grupos (no-op fail-open) */
    async listWorkspaceGroups() {
      return (await import('../bb/client.js')).listWorkspaceGroups();
    },
  };

  return { listWorkspaces, selectWorkspace, isAlive, needsInput, _legacy };
}
