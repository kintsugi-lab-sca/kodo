// @ts-check
//
// src/orchestrator/inbox.js — KODO-53: la BANDEJA del orquestador.
//
// EL PROBLEMA. Hasta aquí, dos eventos del ciclo de vida viajaban al orquestador por el
// carril de TECLADO (`sendToOrchestrator` → `send`): el cierre de sesión
// (`buildStopNudgeText`, disparado desde `hooks/session-end.js`) y el lanzamiento
// (`Nueva sesión lanzada: …`, desde `session/manager.js`). Claude Code encola el texto
// tecleado como si lo hubiera escrito el operador, así que:
//
//   (a) llegan TARDE — el hook corre al cerrar, pero la ronda ya había leído el
//       comentario final en el provider y la pantalla; el nudge cuenta algo que el
//       orquestador ya sabía, a veces con la tarea mergeada y en Done;
//   (b) el de lanzamiento avisa de algo que el propio orquestador acaba de ejecutar con
//       `kodo launch`;
//   (c) si el orquestador está en un turno largo se ACUMULAN y aparecen todos juntos,
//       desordenados respecto de la realidad;
//   (d) el texto largo ensucia el prompt del operador, que los borra a mano.
//
// Medido en producción (28-ago, dos días de orquestación sobre ITCLIP: 13 sesiones,
// 9 PRs): ninguno de los ~10 nudges recibidos aportó información que la ronda no tuviera.
//
// LO QUE SÍ HACE FALTA y hoy iba mezclado con ese ruido: DESPERTAR al orquestador cuando
// nadie está haciendo rondas. Ese valor no se pierde — se separa: la bandeja guarda el
// QUÉ (persistido, leído en la ronda) y el aviso de una línea guarda el CUÁNDO (solo si
// el orquestador está idle). El despertador de verdad, `kodo check → needsOrchestrator`,
// no lo toca esta fase.
//
// CLAVE ADITIVA `state.orchestrator_inbox` (array), mismo idiom que `tasks` (Phase 74
// D-05), `orchestrator` (KODO-16) e `integration_queue` (KODO-26): SIN bump de
// `schema_version`, y todo lector usa el guard defensivo
// `Array.isArray(state.orchestrator_inbox) ? … : []` — un state.json previo a KODO-53 se
// lee como bandeja vacía.
//
// INVARIANTES:
//   - TODA escritura pasa por `withStateLock` (invariante cross-milestone de STATE.md:171).
//     Este módulo NUNCA hace `saveState` por su cuenta ni escribe state.json a mano.
//   - Una entrada NO SE BORRA al verse: `ack` la TRANSICIONA (`seen` + `seen_at`). Mismo
//     patrón que el inbox de capturas (CAPT-03) y que la cola de integración (KODO-26):
//     la traza permanente ES el feature. El único borrado es la eviction FIFO de las YA
//     VISTAS por encima del cap; las NO vistas jamás se evictan (perderlas sería perder
//     justo el trabajo que la bandeja existe para no perder).
//   - Este módulo NO habla con el host y NO importa `logger.js` (recibe el logger por
//     parámetro, default el noop, igual que el resto de mutadores de `state.js`). El
//     carril de efectos —`readScreen` + el aviso— vive en `orchestrator/notify.js`.
//   - Los helpers de la mitad de arriba son PUROS: cero I/O, cero reloj propio (el `now`
//     se inyecta). Son los que fijan el contrato en tests sin tocar disco.

import { noopLogger } from '../logger-noop.js';
import { loadState, withStateLock } from '../session/state.js';
import { stripForKeystroke } from '../cli/sanitize.js';

/**
 * Una entrada de la bandeja del orquestador.
 *
 * Las 9 claves están SIEMPRE presentes y en ESTE orden, con `null` donde no aplica —
 * misma regla que `IntegrationEntry` (integration/queue.js) y por el mismo motivo:
 * `kodo inbox-orch --json` serializa la entrada tal cual, y el byte-determinismo del
 * `--json` es invariante del repo (DX-06).
 *
 * @typedef {{
 *   id: string,                 // Id corto opaco, el handle que el operador copia para `ack`.
 *   ts: string,                 // ISO 8601 del evento.
 *   kind: OrchestratorEventKind,
 *   task_ref: string,           // Referencia humana ("KODO-53"). Cadena vacía si el evento no la trae.
 *   session_id: string|null,    // session-id de Claude, cuando el evento lo conoce.
 *   text: string,               // El texto LARGO (p.ej. buildStopNudgeText). Se LEE en la ronda, no se teclea.
 *   seen: boolean,              // false hasta que una ronda lo acka.
 *   seen_at: string|null,       // ISO 8601 del ack. null mientras está sin ver.
 *   notified_at: string|null,   // ISO 8601 del último aviso de una línea que lo incluyó. Ancla del debounce.
 * }} OrchestratorEvent
 *
 * @typedef {'session-end'|'session-launched'|'integration'|'integration-pressure'|'recycle-suggested'} OrchestratorEventKind
 */

/**
 * Los `kind` admitidos. Un `kind` desconocido NO se rechaza (la bandeja jamás debe
 * bloquear un cierre de sesión): se normaliza a `'session-end'`, el genérico.
 *
 * `'integration'` está soportado pero HOY NO TIENE PRODUCTOR, y es deliberado:
 * `captureIntegration` solo se invoca desde `hooks/session-end.js`, así que una entrada
 * en `integration_queue` nunca ocurre sin su evento `session-end` — encolarla aparte
 * duplicaría en la bandeja algo que la ronda ya lee dos veces (`integration_queue` en el
 * paso 1 y `kodo integrate` en el 5b) sin ganar ni durabilidad ni capacidad de despertar.
 * El `kind` existe para el día que haya un productor independiente.
 *
 * KODO-67 añade `'recycle-suggested'`: el aviso de que el transcript del ORQUESTADOR ha
 * cruzado `orchestrator.recycle_mb` y conviene reciclarlo (handoff + sesión fresca). Es el
 * primer evento de la bandeja que no habla de una SESIÓN DE TRABAJO sino del propio
 * supervisor, y por eso entra aquí y no por un carril nuevo: el orquestador ya lee esta
 * bandeja en el paso 1 de cada ronda, así que el aviso llega sin inventarle otro sitio
 * donde mirar. Su productor vive en `orchestrator/recycle.js`.
 *
 * KODO-72 añade `'integration-pressure'`, y es el productor independiente que le faltaba a la
 * familia — pero NO al `kind` `'integration'`, porque no dice lo mismo. `'integration'` diría
 * «esta rama entró en la cola» (redundante con su `session-end`); `'integration-pressure'` dice
 * «la tarea que ACABO de lanzar va a un repo que YA acumula N ramas sin integrar». El sujeto es
 * la tarea entrante, no la rama saliente, y por eso el evento nace en el DISPATCHER y no en el
 * hook de cierre. Es un aviso, jamás un bloqueo: el lanzamiento ya ha ocurrido cuando el
 * orquestador lo lee.
 *
 * @type {ReadonlySet<OrchestratorEventKind>}
 */
export const ORCHESTRATOR_EVENT_KINDS = Object.freeze(
  new Set(/** @type {OrchestratorEventKind[]} */ ([
    'session-end', 'session-launched', 'integration', 'integration-pressure', 'recycle-suggested',
  ])),
);

/**
 * Techo de entradas YA VISTAS que se conservan en state.json (FIFO, se evictan las más
 * antiguas). Las NO vistas no cuentan y NUNCA se evictan.
 *
 * Mismo número y mismo razonamiento que `RESOLVED_CAP` (integration/queue.js:70) y que el
 * cap de `history` (state.js): el bloque de state.json es la ventana reciente que la
 * ronda lee en cada tick, no el registro permanente — ese es el NDJSON de `~/.kodo/logs/`.
 */
export const SEEN_CAP = 50;

/**
 * Ventana de debounce del aviso de una línea, en ms.
 *
 * Tres cierres seguidos deben producir UN aviso, no tres. El ancla es `notified_at` sobre
 * las propias entradas (no un contador aparte): así el debounce sobrevive al proceso que
 * lo fijó — cada hook de cierre es un proceso distinto y efímero, y un temporizador en
 * memoria no vería a sus hermanos.
 */
export const NOTICE_DEBOUNCE_MS = 30_000;

/** Cota del texto largo persistido. Protege el tamaño de state.json (lo lee cada tick del TUI). */
export const MAX_EVENT_TEXT_LEN = 2000;

/**
 * Cuántos `task_ref` se nombran en el aviso de una línea antes de resumir con «y N más».
 * Tres caben en una línea de terminal sin envolver; más deja de ser un aviso y pasa a ser
 * el listado que la ronda ya hace.
 */
const NOTICE_MAX_REFS = 3;

// ── Helpers PUROS ─────────────────────────────────────────────────────────────

/**
 * Resuelve `config.orchestrator.nudges` a uno de los tres modos. PURA y FAIL-SAFE: un
 * config ausente, ilegible o con un valor desconocido cae a `'inbox'`, el default.
 *
 * Recibe el config por PARÁMETRO en vez de importar `config.js`: así este módulo no
 * adquiere el `homedir()` en module-load de `config.js:11` (la fuga que contamina los
 * tests, RESEARCH §Pitfall 5 de la Phase 83), y el caller —que ya tiene el config
 * resuelto o inyectado— no paga una segunda lectura.
 *
 * NOTA: `loadConfig` ya valida y hace fallback de este campo (`config-validate` →
 * `nudgeMode`), así que esta guarda es la segunda capa, no la única — mismo criterio que
 * `resolveHostName` (host/interface.js).
 *
 * @param {{ orchestrator?: { nudges?: string } }|null|undefined} config
 * @returns {'inbox'|'keystroke'|'off'}
 */
export function resolveNudgeMode(config) {
  const mode = config?.orchestrator?.nudges;
  return mode === 'keystroke' || mode === 'off' ? mode : 'inbox';
}

/**
 * Lectura defensiva del bloque de bandeja de un state ya cargado. Pura.
 * @param {any} state
 * @returns {OrchestratorEvent[]}
 */
function inboxOf(state) {
  return Array.isArray(state?.orchestrator_inbox) ? state.orchestrator_inbox : [];
}

/**
 * Id corto opaco derivado del par (ts, secuencia). PURO — el `seq` lo aporta el caller
 * desde la longitud de la bandeja bajo el lock, así que no hace falta aleatoriedad ni,
 * por tanto, `randomBytes`: dos entradas del mismo milisegundo no pueden compartir `seq`
 * porque ambas se construyen dentro de la MISMA sección crítica.
 *
 * @param {string} ts ISO 8601
 * @param {number} seq
 * @returns {string} 8 caracteres de `[0-9a-z]`
 */
export function buildEventId(ts, seq) {
  // base36 del timestamp (ms) + base36 del seq, recortado por la izquierda a 6+2.
  const t = Number.isFinite(Date.parse(ts)) ? Date.parse(ts) : 0;
  const head = t.toString(36).slice(-6).padStart(6, '0');
  const tail = (Number.isFinite(seq) ? Math.abs(Math.trunc(seq)) : 0).toString(36).slice(-2).padStart(2, '0');
  return head + tail;
}

/**
 * Construye una entrada COMPLETA (9 claves, orden fijo) desde el input del productor.
 * PURA: no toca disco ni el reloj — `ts` y `seq` los aporta el caller.
 *
 * SANEO EN EL PUNTO DE CONSTRUCCIÓN (invariante STATE.md:176, Phase 78). `task_ref` y
 * `text` vienen de datos NO confiables (LLM, títulos del provider, state.json
 * hand-editable) y acaban en dos sitios peligrosos: el render de `kodo inbox-orch` y —vía
 * `summarizeInbox`— el carril de KEYSTROKE del aviso. Se sanea con `stripForKeystroke`,
 * que es el saneador ESTRICTO (neutraliza CSI/OSC/C0/C1/DEL/CR y además `\n`/`\t`, reales
 * y en su forma de escape literal). Sobre ASCII limpio es la identidad, así que el texto
 * de `buildStopNudgeText` cruza byte-idéntico y sus goldens no se mueven.
 *
 * @param {{ kind?: string, task_ref?: string, session_id?: string|null, text?: string }} input
 * @param {string} ts ISO 8601
 * @param {number} seq posición dentro de la bandeja, para el id
 * @returns {OrchestratorEvent}
 */
export function buildOrchestratorEvent(input, ts, seq) {
  const kind = /** @type {OrchestratorEventKind} */ (
    ORCHESTRATOR_EVENT_KINDS.has(/** @type {any} */ (input?.kind)) ? input.kind : 'session-end'
  );
  return {
    id: buildEventId(ts, seq),
    ts,
    kind,
    task_ref: stripForKeystroke(String(input?.task_ref ?? '')).trim().slice(0, 80),
    session_id: typeof input?.session_id === 'string' && input.session_id ? input.session_id : null,
    // `.trim()` DESPUÉS del saneo, y no es cosmético: `buildStopNudgeText` termina en el
    // `\n` LITERAL (dos chars) que necesitaba el `cmux send`, y `stripForKeystroke` lo
    // colapsa a un espacio. En la bandeja ese terminador ya no significa nada — el texto
    // se LEE en la ronda, no se teclea — así que se recorta en vez de persistirlo.
    text: stripForKeystroke(String(input?.text ?? '')).trim().slice(0, MAX_EVENT_TEXT_LEN),
    seen: false,
    seen_at: null,
    notified_at: null,
  };
}

/**
 * ¿El orquestador está IDLE según su pantalla? PURA, y FAIL-CLOSED por diseño.
 *
 * El criterio: la última línea NO VACÍA es su prompt (`❯`/`>`/`$`/`%` a secas, o con solo
 * espacios detrás) o contiene el marcador `[kodo:idle]` que la propia skill le manda
 * escribir cuando no hay nada pendiente.
 *
 * DIVERGE A PROPÓSITO de `detectIdle` (session/health.js:139) en dos puntos, y la
 * diferencia es la razón de no reutilizarla:
 *
 *   1. Pantalla vacía o ilegible → NO idle. `detectIdle` devuelve `true` ahí porque su
 *      consumidor quiere detectar sesiones muertas; el nuestro quiere decidir si TECLEAR
 *      en el terminal de alguien. Ante la duda, no se teclea: la bandeja ya tiene el
 *      evento y la siguiente ronda lo verá igual.
 *   2. `startsWith('>')` no basta: el prompt de Claude Code con texto YA ESCRITO empieza
 *      también por `>`/`❯`. Aquí se exige que no quede nada detrás del símbolo — un
 *      prompt con un borrador a medias es un operador escribiendo, no un idle.
 *
 * @param {string|null|undefined} screen salida cruda de `readScreen`.
 * @returns {boolean}
 */
export function isOrchestratorIdle(screen) {
  if (typeof screen !== 'string') return false;
  const lines = screen.split('\n').map((l) => l.trim()).filter((l) => l !== '');
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1];
  if (last.includes('[kodo:idle]')) return true;
  // Prompt VACÍO: solo el símbolo (con o sin adornos de box-drawing alrededor, que es
  // como cmux devuelve el marco del prompt de Claude Code).
  return /^[│|]?\s*[❯>$%]\s*[│|]?$/.test(last);
}

/**
 * ¿Toca avisar? PURA. `true` solo si hay entradas SIN VER y ninguna de ellas fue incluida
 * en un aviso dentro de la ventana de debounce.
 *
 * El ancla es el `notified_at` MÁS RECIENTE del conjunto sin ver: tres cierres seguidos
 * comparten la ventana del primero, así que producen UN aviso. Pasada la ventana, un
 * evento nuevo vuelve a abrir la puerta y el aviso reagrupa TODO lo que siga sin ver
 * (incluido lo ya notificado) — eso es correcto: «N eventos nuevos» cuenta lo que el
 * orquestador no ha mirado, no lo que se le anunció.
 *
 * @param {OrchestratorEvent[]} entries bandeja completa.
 * @param {number} nowMs
 * @param {number} [debounceMs]
 * @returns {boolean}
 */
export function shouldNotify(entries, nowMs, debounceMs = NOTICE_DEBOUNCE_MS) {
  const unseen = (Array.isArray(entries) ? entries : []).filter((e) => e && e.seen !== true);
  if (unseen.length === 0) return false;
  for (const e of unseen) {
    const t = typeof e.notified_at === 'string' ? Date.parse(e.notified_at) : NaN;
    if (Number.isFinite(t) && nowMs - t < debounceMs) return false;
  }
  return true;
}

/**
 * El AVISO: una sola línea, con el conteo y hasta 3 refs. PURA.
 *
 * Forma: `[kodo] 2 evento(s) nuevos — KODO-53 en Review, KODO-54 lanzada. Ronda.`
 *
 * Deliberadamente NO lleva el texto largo de los eventos: ese vive en la bandeja y se LEE
 * en la ronda. Lo que se teclea es el mínimo que hace falta para que el orquestador sepa
 * que tiene que mirar — todo lo demás es justo el ruido que KODO-53 retira.
 *
 * Sale por el carril de KEYSTROKE, así que se cierra con `stripForKeystroke` aunque los
 * `task_ref` ya se saneen al construir el evento: un state.json editado a mano puede
 * meter una entrada sin pasar por `buildOrchestratorEvent`, y el saneo del punto de
 * composición es el que la cadena de custodia exige (invariante STATE.md:176).
 *
 * @param {OrchestratorEvent[]} entries bandeja completa; se resumen SOLO las sin ver.
 * @returns {string} línea sin `\n`. Cadena vacía si no hay nada sin ver.
 */
export function summarizeInbox(entries) {
  const unseen = (Array.isArray(entries) ? entries : []).filter((e) => e && e.seen !== true);
  if (unseen.length === 0) return '';

  const parts = [];
  for (const e of unseen.slice(0, NOTICE_MAX_REFS)) {
    const ref = stripForKeystroke(String(e.task_ref ?? '')).trim() || 'sesión';
    parts.push(`${ref} ${verbForKind(e.kind)}`);
  }
  const rest = unseen.length - parts.length;
  if (rest > 0) parts.push(`y ${rest} más`);

  const n = unseen.length;
  return `[kodo] ${n} evento${n === 1 ? '' : 's'} nuevo${n === 1 ? '' : 's'} — ${parts.join(', ')}. Ronda.`;
}

/**
 * Verbo corto por `kind` para el aviso. PURO.
 * @param {string} kind
 * @returns {string}
 */
function verbForKind(kind) {
  switch (kind) {
    case 'session-launched': return 'lanzada';
    case 'integration': return 'en cola de integración';
    // KODO-72: el sujeto vuelve a ser el `task_ref` de la tarea LANZADA, así que
    // `summarizeInbox` compone «KODO-71 va a un repo con cola pendiente». El número exacto
    // NO entra en el aviso de una línea: ese vive en el `text` del evento, que la ronda lee.
    case 'integration-pressure': return 'va a un repo con cola pendiente';
    // KODO-67: el `task_ref` de este evento es la palabra «orquestador», así que
    // `summarizeInbox` lo compone como «orquestador conviene reciclarlo» — el sujeto lo
    // pone el ref, igual que en los demás kinds.
    case 'recycle-suggested': return 'conviene reciclarlo';
    default: return 'en Review';
  }
}

/**
 * Eviction FIFO de las entradas YA VISTAS por encima del cap. Muta el array en sitio
 * (misma técnica que `pruneResolved` de integration/queue.js). PURA respecto del reloj.
 *
 * Las NO vistas nunca se cuentan ni se evictan.
 *
 * @param {OrchestratorEvent[]} inbox
 * @returns {void}
 */
function pruneSeen(inbox) {
  let excess = inbox.filter((e) => e && e.seen === true).length - SEEN_CAP;
  if (excess <= 0) return;
  for (let i = 0; i < inbox.length && excess > 0; ) {
    if (inbox[i] && inbox[i].seen === true) {
      inbox.splice(i, 1);
      excess--;
    } else {
      i++;
    }
  }
}

// ── Mutadores (todo bajo `withStateLock`) ─────────────────────────────────────

/**
 * Encola un evento en la bandeja del orquestador.
 *
 * FAIL-OPEN por contrato: el caller es un hook de cierre o el dispatcher del launch, y
 * ninguno de los dos puede fallar porque la bandeja no se pueda escribir. En lock-timeout
 * se emite el warn y se devuelve el discriminado — nunca lanza.
 *
 * @param {{ kind?: string, task_ref?: string, session_id?: string|null, text?: string }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: OrchestratorEvent } | { ok: false, reason: 'lock-timeout' }}
 */
export function enqueueOrchestratorEvent(input, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {OrchestratorEvent|undefined} */
  let persisted;

  const r = withStateLock((state) => {
    // Guard defensivo de la clave aditiva — espejo de `if (!state.tasks) state.tasks = {}`
    // (state.js) y del de `integration_queue` (queue.js). Un state.json anterior a
    // KODO-53 no la trae.
    if (!Array.isArray(/** @type {any} */ (state).orchestrator_inbox)) {
      /** @type {any} */ (state).orchestrator_inbox = [];
    }
    const inbox = /** @type {OrchestratorEvent[]} */ (/** @type {any} */ (state).orchestrator_inbox);
    persisted = buildOrchestratorEvent(input, ts, inbox.length);
    inbox.push(persisted);
    pruneSeen(inbox);
  });

  if (!r.ok) {
    logger.warn('orchestrator.inbox.enqueue_failed', {
      kind: input?.kind ?? null,
      task_ref: input?.task_ref ?? null,
      reason: r.reason,
    });
    return r;
  }
  // Telemetría INVARIANTE: nunca el `text` (contenido LLM), solo la forma del evento —
  // mismo criterio que `state.task.handoff_saved` (state.js) con el `next`.
  logger.info('orchestrator.inbox.enqueued', {
    id: /** @type {OrchestratorEvent} */ (persisted).id,
    kind: /** @type {OrchestratorEvent} */ (persisted).kind,
    task_ref: /** @type {OrchestratorEvent} */ (persisted).task_ref,
  });
  return { ok: true, value: /** @type {OrchestratorEvent} */ (persisted) };
}

/**
 * Lee la bandeja. Leaf never-throws: una bandeja ausente es el estado inicial normal, no
 * un error (mismo contrato que `listCaptures` del inbox de capturas, D-18).
 *
 * @param {{ all?: boolean }} [opts] `all: true` incluye las ya vistas (la traza).
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {OrchestratorEvent[]}
 */
export function listOrchestratorInbox(opts = {}, deps = {}) {
  try {
    const loadStateFn = deps.loadStateFn || loadState;
    const all = inboxOf(loadStateFn());
    return opts.all === true ? all : all.filter((e) => e && e.seen !== true);
  } catch {
    return [];
  }
}

/**
 * Marca entradas como VISTAS. Cerrar es una transición, jamás un borrado.
 *
 * @param {{ ids?: string[], all?: boolean }} selector `all: true` acka todas las sin ver;
 *   si no, solo los `ids` dados (los desconocidos se ignoran y se reportan en `missing`).
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: { acked: string[], missing: string[] } } | { ok: false, reason: 'lock-timeout' }}
 */
export function ackOrchestratorEvents(selector, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  const wanted = new Set(Array.isArray(selector?.ids) ? selector.ids : []);
  /** @type {string[]} */
  let acked = [];
  /** @type {string[]} */
  let missing = [];

  const r = withStateLock((state) => {
    acked = [];
    const inbox = inboxOf(state);
    const found = new Set();
    for (const e of inbox) {
      if (!e) continue;
      const target = selector?.all === true ? e.seen !== true : wanted.has(e.id);
      if (wanted.has(e.id)) found.add(e.id);
      if (!target || e.seen === true) continue;
      e.seen = true;
      e.seen_at = ts;
      acked.push(e.id);
    }
    // Un id que existe pero YA estaba visto NO es `missing`: el ack es idempotente por
    // diseño (dos rondas solapadas no deben verse como un error del operador).
    missing = [...wanted].filter((id) => !found.has(id));
    pruneSeen(/** @type {OrchestratorEvent[]} */ (/** @type {any} */ (state).orchestrator_inbox || []));
  });

  if (!r.ok) {
    logger.warn('orchestrator.inbox.ack_failed', { reason: r.reason });
    return r;
  }
  logger.info('orchestrator.inbox.acked', { count: acked.length, missing: missing.length });
  return { ok: true, value: { acked, missing } };
}

/**
 * Sella `notified_at` sobre las entradas que acaban de entrar en un aviso. Es el ancla
 * PERSISTIDA del debounce — a propósito, y no un temporizador en memoria: cada hook de
 * cierre es un proceso distinto y efímero, así que un temporizador no vería a sus
 * hermanos y tres cierres seguidos volverían a producir tres avisos.
 *
 * @param {string[]} ids
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: number } | { ok: false, reason: 'lock-timeout' }}
 */
export function markOrchestratorEventsNotified(ids, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  const wanted = new Set(Array.isArray(ids) ? ids : []);
  let count = 0;

  const r = withStateLock((state) => {
    count = 0;
    for (const e of inboxOf(state)) {
      if (!e || !wanted.has(e.id)) continue;
      e.notified_at = ts;
      count++;
    }
  });

  if (!r.ok) {
    logger.warn('orchestrator.inbox.notify_mark_failed', { reason: r.reason });
    return r;
  }
  return { ok: true, value: count };
}
