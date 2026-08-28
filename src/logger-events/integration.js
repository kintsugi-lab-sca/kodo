// @ts-check
//
// src/logger-events/integration.js — canales de entrada externos — polling, webhook, dispatch e integrate.
//
// Eventos de los carriles que entran desde fuera: polling de repos (Phase 25/28),
// webhook HTTP + decisión del dispatcher (KODO-28) y el CLI `kodo integrate`.
// Emisores: `src/triggers/*`, `src/cli/polling.js`, `src/cli/integrate.js`.
//
// Cada helper es pure transform (campos → record) y delega en logger.info/warn/error.
// Whitelist EXPLÍCITO field-by-field — NUNCA spread `...fields` — para que ningún campo
// extra del caller alcance el sink NDJSON append-only.

import { EVENTS } from './events.js';

/**
 * @typedef {import('../logger.js').Logger} Logger
 */

// ─── Phase 25: polling trigger channel ─────────────────────────────────────
//
// Tres helpers que espejan el patrón Phase 23 (`githubApiCall` /
// `githubApiCallFailed`): payload con campos whitelisted, JSDoc typedef
// explícito, level fijo por evento (info / info / warn).
//
// Invariante de seguridad T-25-02: `pollingDispatch` SOLO acepta y emite
// `{event, owner, repo, ref, pattern}`. Cualquier campo extra del caller
// queda descartado silenciosamente — no se accede a contenido de usuario
// (body, título, raw object) ni en la firma JSDoc ni en el cuerpo del
// helper. El sink NDJSON (`~/.kodo/logs/*.ndjson`) es append-only y queda
// expuesto al consumer (`kodo logs`); por tanto cualquier filtración aquí
// persiste en disco.
//
// Invariante LOG-12: cero imports nuevos. Los únicos imports runtime de todo el
// subárbol siguen siendo `node:os` + `node:path`, en `logger-events/events.js`.

/**
 * Emitido en cada tick del polling loop por (owner, repo). El consumer
 * (`src/triggers/polling.js`, Plan 25-02) llama a este helper exactamente
 * una vez por repo por tick, después de procesar el response del client
 * (200 = lista de items o 304 = cursor preservado). `dispatched` es el
 * count de issues que dispararon `dispatchTrigger` en este tick (0 cuando
 * `first_tick:true` o cuando no hubo deltas).
 *
 * `first_tick:true` se emite solo en el primer tick por repo del proceso
 * (post-warmup, antes de aplicar el cursor) — patrón "skip-first-tick"
 * de POLL-03 para evitar storm de dispatches en arranque.
 *
 * @param {Logger} logger
 * @param {{
 *   owner: string,
 *   repo: string,
 *   status: number,
 *   dispatched: number,
 *   first_tick?: boolean,
 * }} fields
 */
export function pollingTick(logger, fields) {
  logger.info(EVENTS.POLLING_TICK, {
    event: EVENTS.POLLING_TICK,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    dispatched: fields.dispatched,
    ...(fields.first_tick ? { first_tick: true } : {}),
  });
}

/**
 * Emitido cada vez que el polling loop dispara `dispatchTrigger(event)`
 * para una issue (pattern a/b/c de POLL-03: new label, updated since cursor,
 * state change). El payload es estrictamente de identificación — `owner`,
 * `repo`, `ref` (formato `owner/repo#number`), `pattern` (literal a-new /
 * b-updated / c-state).
 *
 * Invariante de seguridad T-25-02: NO se incluye ningún campo de contenido
 * de usuario (body, título, raw object). El helper toma SOLO los 4 campos
 * de identificación; cualquier campo extra del caller queda descartado.
 *
 * @param {Logger} logger
 * @param {{ owner: string, repo: string, ref: string, pattern: string }} fields
 */
export function pollingDispatch(logger, fields) {
  logger.info(EVENTS.POLLING_DISPATCH, {
    event: EVENTS.POLLING_DISPATCH,
    owner: fields.owner,
    repo: fields.repo,
    ref: fields.ref,
    pattern: fields.pattern,
  });
}

/**
 * Emitido (warn) en cualquier branch de error del polling loop: 429, 5xx,
 * timeout, abort, o exhaustion tras N retries (POLL-04). `attempt` es el
 * intento 1-indexed dentro de la secuencia de retry exponencial; cuando
 * el loop hace warn-and-continue post-3-retries, se emite un último evento
 * con `attempt:3`. `error` opcional contiene un snippet truncado del mensaje
 * (el caller en polling.js debe truncar a ≤ 200 chars para evitar fugas).
 *
 * Nivel `warn` (no `error`) porque el loop es fail-open: un tick fallido
 * NO termina el proceso; el siguiente tick se agenda igual. El operador
 * detecta el patrón vía `kodo logs | grep polling.error`.
 *
 * @param {Logger} logger
 * @param {{
 *   owner: string,
 *   repo: string,
 *   status: number,
 *   attempt: number,
 *   error?: string,
 * }} fields
 */
export function pollingError(logger, fields) {
  logger.warn(EVENTS.POLLING_ERROR, {
    event: EVENTS.POLLING_ERROR,
    owner: fields.owner,
    repo: fields.repo,
    status: fields.status,
    attempt: fields.attempt,
    ...(fields.error ? { error: fields.error } : {}),
  });
}

/**
 * Emitido AL FINAL de cada tick agregado del polling loop, una vez por tick
 * (D-10 Phase 28). Mientras `pollingTick` emite per-repo (granular drill-down),
 * este emite cross-repo (agregado) para soportar el `--verbose` foreground
 * summary line y el resumen estructurado en el logfile del daemon.
 *
 * Shape D-10 canónico:
 *   {
 *     event: 'polling.tick.summary',
 *     repos_polled: number,          // count, NO la lista en sí
 *     total_dispatches: number,      // suma cross-repo de dispatches en este tick
 *     rate_limit_remaining: number | null,  // D-12: mínimo cross-repo (más conservador);
 *                                            // null cuando ningún repo retornó header
 *     repos: string[],               // lista de keys `owner/repo` polled en este tick
 *   }
 *
 * D-11 (preserve drill-down): `pollingTick` per-repo se sigue emitiendo
 * sin cambios — el dispatcher/--verbose es aditivo, no reemplaza al granular.
 *
 * D-12 (rate_limit_remaining null fallback): si ningún repo del tick retornó
 * `rate_limit_remaining` (p.ej. todos los repos pasaron por path provider-only
 * que no propaga rate-limit, o todos errored antes del envelope), el caller
 * pasa `null` explícito. El helper lo preserva tal cual — NO sustituye por 0.
 *
 * Invariante T-25-02 (Information disclosure): el helper SOLO emite contadores
 * + lista de repos string keys (`owner/repo`). JAMÁS body, título, ref completo
 * (esa info ya viaja en `pollingDispatch` per-event), ni payload raw del issue.
 * Whitelist explícito field-by-field — NO spread `...fields` para evitar leaks
 * accidentales si el caller pasa propiedades extra.
 *
 * @param {Logger} logger
 * @param {{
 *   repos_polled: number,
 *   total_dispatches: number,
 *   rate_limit_remaining: number | null,
 *   repos: string[],
 * }} fields
 */
export function pollingTickSummary(logger, fields) {
  logger.info(EVENTS.POLLING_TICK_SUMMARY, {
    event: EVENTS.POLLING_TICK_SUMMARY,
    repos_polled: fields.repos_polled,
    total_dispatches: fields.total_dispatches,
    rate_limit_remaining: fields.rate_limit_remaining,
    repos: fields.repos,
  });
}

/**
 * Emite `integrate.action` — el registro DETERMINISTA de lo que `kodo integrate` ejecutó sobre
 * una rama (KODO-26). Uno por invocación, incluido `--drop`.
 *
 * Complementario, no redundante: las observaciones de claude-mem son la memoria narrativa del
 * LLM; esta línea es el hecho verificable («qué acción, sobre qué rama, con qué resultado»),
 * append-only en `~/.kodo/logs/integrate.ndjson` y greppable meses después. También es la traza
 * PERMANENTE de la cola, cuyo bloque en state.json evicta las resueltas más antiguas.
 *
 * Se emite SIEMPRE, en éxito y en fallo — lo que cambia es `outcome`. Un intento que no llegó a
 * tocar git (worktree sucio, rama base no checkouteada) deja su línea igual: saber qué NO se
 * pudo hacer es parte del registro. `sha` es `null` en todo lo que no produce un commit nuevo
 * (`--pr`, `--drop`, cualquier fallo).
 *
 * Nivel: `info` en éxito, `warn` en fallo — así un filtro por `warn` sobre el log saca
 * exactamente las acciones que no salieron.
 *
 * LOG-12: whitelist explícito — no `...fields` spread. El `timestamp` lo pone el sink.
 *
 * @param {Logger} logger
 * @param {{
 *   action: 'ff'|'merge'|'pr'|'drop',
 *   task_ref: string,
 *   branch: string|null,
 *   sha: string|null,
 *   outcome: string,
 *   ok: boolean,
 * }} fields
 */
export function integrateAction(logger, fields) {
  const record = {
    event: EVENTS.INTEGRATE_ACTION,
    action: fields.action,
    task_ref: fields.task_ref,
    branch: fields.branch,
    sha: fields.sha,
    outcome: fields.outcome,
  };
  if (fields.ok) logger.info(EVENTS.INTEGRATE_ACTION, record);
  else logger.warn(EVENTS.INTEGRATE_ACTION, record);
}

// ─── KODO-28: carril webhook → dispatch ──────────────────────────────────────
//
// Antes de KODO-28 este carril SOLO existía como `console.log` en server.js y
// dispatcher.js, y el daemon detached mandaba su stdout/stderr a /dev/null
// (lifecycle.js `deps._logFd ?? 'ignore'`) — así que desde julio de 2026 no
// quedaba rastro auditable de si un webhook llegó, si lo rechazó el HMAC, ni
// qué decidió el dispatcher. Estos 4 eventos son la fuente de verdad del audit;
// el `console.log` sigue existiendo solo para el ring buffer de `/logs`.
//
// Invariante de seguridad (mismo criterio que T-25-02 en pollingDispatch): NADA
// de contenido de usuario en el payload. Ni body crudo, ni título, ni labels —
// solo identificación (`task_ref`), taxonomía (`action`, `reason`, `code`) y
// tamaño (`bytes`). El body del webhook es precisamente lo que NO se persiste.

/**
 * Emitido cuando un webhook pasa la verificación de firma Y se parsea a un
 * TriggerEvent — es decir, justo antes del dispatch fire-and-forget.
 *
 * `action` es el tipo de evento del proveedor (p.ej. `issue.updated`), NO la
 * decisión del dispatcher: el campo se llama `action` y no `event` porque
 * `event` ya está tomado por el nombre del propio evento del logger en todos
 * los records de la taxonomía.
 *
 * `bytes` es la longitud del body crudo, no el body. Sirve para correlacionar
 * con el 413 de `readBody` (NET-03) sin persistir payload alguno.
 *
 * @param {Logger} logger
 * @param {{ provider: string, action: string, task_ref: string, bytes: number }} fields
 */
export function webhookReceived(logger, fields) {
  logger.info(EVENTS.WEBHOOK_RECEIVED, {
    event: EVENTS.WEBHOOK_RECEIVED,
    provider: fields.provider,
    action: fields.action,
    task_ref: fields.task_ref,
    bytes: fields.bytes,
  });
}

/**
 * Emitido (warn) cuando un webhook NO llega a dispatch. Tres motivos cerrados:
 *
 *   - `signature` → `provider.verifySignature()` devolvió false (401). Cubre
 *     tanto firma inválida como header/secret ausente — el provider no
 *     distingue, y distinguirlo aquí filtraría al operador qué mitad del HMAC
 *     falló.
 *   - `parse`     → el body no es JSON válido (400).
 *   - `payload`   → JSON válido pero `parseTriggerEvent` devolvió null: el
 *     evento no es de los que kodo despacha (200 + `ignored:true`). NO es un
 *     error — es el caso mayoritario en un webhook de Plane con `issue.*`
 *     genérico — pero se emite igual porque el punto ciego que abre KODO-28 es
 *     precisamente "no sé si llegó y se descartó, o si no llegó".
 *
 * @param {Logger} logger
 * @param {{ provider: string, reason: 'signature' | 'parse' | 'payload', bytes: number }} fields
 */
export function webhookRejected(logger, fields) {
  logger.warn(EVENTS.WEBHOOK_REJECTED, {
    event: EVENTS.WEBHOOK_REJECTED,
    provider: fields.provider,
    reason: fields.reason,
    bytes: fields.bytes,
  });
}

/**
 * Emitido (warn) cuando el webhook contesta 503 para que el provider REINTENTE
 * la entrega (KODO-34).
 *
 * Es el único rastro de esa decisión: `dispatch.error` ya cuenta que el dispatch
 * murió, pero no que kodo pidió el reintento en vez de tragarse el evento. Sin
 * este evento, un 503 solo es visible en el ring buffer in-memory de `/logs`,
 * que muere con el proceso — exactamente el punto ciego que abrió KODO-28.
 *
 * `error` es el `err.message`, que el caller DEBE truncar (mismo contrato de
 * ≤ 200 chars que `dispatchError` / `pollingError`).
 *
 * @param {Logger} logger
 * @param {{ provider: string, task_ref: string, error: string }} fields
 */
export function webhookDispatchRetry(logger, fields) {
  logger.warn(EVENTS.WEBHOOK_DISPATCH_RETRY, {
    event: EVENTS.WEBHOOK_DISPATCH_RETRY,
    provider: fields.provider,
    task_ref: fields.task_ref,
    error: fields.error,
  });
}

/**
 * Emitido en CADA return de `dispatchTrigger` — el veredicto del dispatcher.
 * `action` es el discriminante del propio return (`launched`, `ignored`,
 * `already_active`, `stale_relaunch`, `cleaned`, `gsd_locked`,
 * `resolver_failed`, `worktree_collision`); `code`/`detail` viajan cuando el
 * return los trae (p.ej. `code:'gsd_child'`, `detail:<worktree path>`).
 *
 * Las claves opcionales se omiten cuando no aplican (truthy-spread, mismo
 * patrón que `first_tick` en pollingTick) para que el NDJSON no se llene de
 * `code:null`.
 *
 * @param {Logger} logger
 * @param {{
 *   provider: string,
 *   task_ref: string,
 *   action: string,
 *   code?: string,
 *   detail?: string,
 * }} fields
 */
export function dispatchDecision(logger, fields) {
  logger.info(EVENTS.DISPATCH_DECISION, {
    event: EVENTS.DISPATCH_DECISION,
    provider: fields.provider,
    task_ref: fields.task_ref,
    action: fields.action,
    ...(fields.code ? { code: fields.code } : {}),
    ...(fields.detail ? { detail: fields.detail } : {}),
  });
}

/**
 * Emitido (error) cuando `dispatchTrigger` lanza en vez de devolver veredicto:
 * el provider no resuelve el ref, `launchWorkItem` falla, config rota, etc.
 *
 * `error` es el `err.message`, que el caller DEBE truncar (≤ 200 chars, mismo
 * contrato que `pollingError`). El stack no se persiste aquí — para eso está
 * `~/.kodo/logs/daemon.log`, que captura stdout/stderr crudo del daemon.
 *
 * @param {Logger} logger
 * @param {{ provider: string, task_ref: string, error: string }} fields
 */
export function dispatchError(logger, fields) {
  logger.error(EVENTS.DISPATCH_ERROR, {
    event: EVENTS.DISPATCH_ERROR,
    provider: fields.provider,
    task_ref: fields.task_ref,
    error: fields.error,
  });
}
