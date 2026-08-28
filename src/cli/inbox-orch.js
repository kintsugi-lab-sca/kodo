// @ts-check
//
// src/cli/inbox-orch.js — Action handlers de `kodo inbox-orch` (KODO-53).
//
// NO CONFUNDIR CON `kodo inbox`. Son dos bandejas distintas y el nombre lo dice a
// propósito:
//   · `kodo inbox`      → capturas del OPERADOR en `~/.kodo/inbox.md` (ideas sueltas que
//                         se enrutan a mano; Phase 83).
//   · `kodo inbox-orch` → eventos del CICLO DE VIDA hacia el ORQUESTADOR, en
//                         `state.orchestrator_inbox` (fin de sesión, sesión lanzada).
// Comparten forma —listar + cerrar por id, sin borrar nunca— y nada más: distinto
// productor, distinto consumidor, distinto almacén.
//
// El consumidor real de esta superficie es la RONDA del orquestador, no un humano: el
// paso 1 lee `state.json` (donde la bandeja ya viene incluida) y luego acka con
// `kodo inbox-orch ack --all`. El render human existe para que el operador pueda mirar
// la bandeja sin abrir el JSON.
//
// Invariante de retorno (D-07 del repo, precedente `skill-sync.js`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El registro de commander
// en `src/cli.js` es quien fija `process.exitCode`.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de
// color directamente — solo `createFormatter`.
//
// NOTA: no invoca la comprobación de configuración de proveedor. La bandeja es estado
// local (`~/.kodo/state.json`) y no toca ningún provider — mismo precedente que
// `skill sync`, `gsd doctor` y `kodo inbox`.

import { ackOrchestratorEvents, listOrchestratorInbox } from '../orchestrator/inbox.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/**
 * @typedef {{
 *   listFn?: typeof listOrchestratorInbox,
 *   ackFn?: typeof ackOrchestratorEvents,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} InboxOrchDeps
 */

/**
 * Lista la bandeja del orquestador.
 *
 * @param {{ all?: boolean, json?: boolean }} opts `all` incluye las ya vistas (la traza).
 * @param {InboxOrchDeps} [deps]
 * @returns {number} SIEMPRE 0 — listar nunca es una condición de error (mismo contrato
 *   que `runInboxListCli`, D-18: ni un fallo del render cambia el código de salida).
 */
export function runInboxOrchListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listOrchestratorInbox;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  try {
    const rows = listFn({ all: opts.all === true });
    const unseen = opts.all === true ? rows.filter((e) => e.seen !== true).length : rows.length;

    // Rama `--json` PRIMERO, antes de instanciar el formatter: así el carril máquina no
    // puede contaminarse con ANSI por construcción, no solo por convención (DX-06).
    //
    // El texto NO necesita el saneo extra de `sanitizeJsonField` que sí hace el inbox de
    // capturas: allí el fichero es human-editable POR DISEÑO y una línea pegada a mano
    // llega verbatim; aquí el productor es `buildOrchestratorEvent`, que ya aplicó
    // `stripForKeystroke` (más estricto que `stripControlChars`: cubre C0, C1, DEL y
    // además `\n`/`\t`). Un `state.json` editado a mano sí podría saltárselo, y por eso el
    // render human de abajo vuelve a sanear — pero el carril JSON no reemite a un terminal.
    if (opts.json === true) {
      write(JSON.stringify({ unseen, total: rows.length, events: rows }) + '\n');
      return 0;
    }

    renderHuman(rows, { all: opts.all === true, unseen }, write, formatterFn());
    return 0;
  } catch (e) {
    err(`[kodo:inbox-orch] no se pudo renderizar la bandeja: ${/** @type {Error} */ (e).message}\n`);
    return 0;
  }
}

/**
 * Render TTY. NO se invoca para `--json`.
 *
 * SANEO DEL CARRIL DE RENDER: `task_ref` y `text` se pasan por `stripControlChars` antes
 * de pintarlos, aunque el productor ya los saneó. `state.json` es editable a mano y el
 * único saneo que protege al terminal del operador es el que corre JUSTO ANTES de escribir
 * en él. El `id`, el `kind` y las fechas no lo necesitan — el store los restringe a
 * alfabetos sin controles.
 *
 * @private
 * @param {import('../orchestrator/inbox.js').OrchestratorEvent[]} rows
 * @param {{ all: boolean, unseen: number }} meta
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(rows, meta, write, fmt) {
  if (rows.length === 0) {
    write(
      meta.all
        ? `${fmt.dim('La bandeja del orquestador está vacía.')}\n`
        : `${fmt.dim('Nada sin ver.')} Usa ${fmt.cyan('kodo inbox-orch --all')} para ver la traza.\n`,
    );
    return;
  }

  const table = rows.map((e) => {
    const cells = [
      fmt.cyan(e.id),
      fmt.dim(String(e.ts).slice(0, 19).replace('T', ' ')),
      fmt.gray(String(e.kind)),
      stripControlChars(e.task_ref),
      stripControlChars(e.text),
    ];
    if (meta.all) cells.push(fmt.gray(e.seen === true ? 'vista' : 'sin ver'));
    return cells;
  });
  write(fmt.formatTable(table) + '\n');

  if (!meta.all && rows.length > 0) {
    write(`${fmt.dim(`Márcalas vistas con: kodo inbox-orch ack --all`)}\n`);
  }
}

/**
 * Marca eventos como vistos. Sin `ids` y sin `--all` NO hace nada: un ack implícito de
 * toda la bandeja por omisión sería justo el borrado accidental que el diseño evita.
 *
 * @param {string[]} ids
 * @param {{ all?: boolean }} opts
 * @param {InboxOrchDeps} [deps]
 * @returns {number} 0 ok · 1 lock-timeout · 2 selector vacío o ids inexistentes.
 */
export function runInboxOrchAckCli(ids, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const ackFn = deps.ackFn || ackOrchestratorEvents;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  const list = Array.isArray(ids) ? ids.filter((s) => typeof s === 'string' && s !== '') : [];
  if (opts.all !== true && list.length === 0) {
    err('Error: indica al menos un id, o usa --all para marcar toda la bandeja\n');
    return 2;
  }

  const result = ackFn({ ids: list, all: opts.all === true });
  if (!result.ok) {
    err(
      `Error: lock-timeout — el ack NO se ha aplicado; reinténtalo en unos segundos\n`,
    );
    return 1;
  }

  const fmt = formatterFn();
  const { acked, missing } = result.value;
  write(`${fmt.ok(`${acked.length} evento(s) marcados como vistos`)}\n`);

  if (missing.length > 0) {
    // Exit 2, no 0: el operador pidió ackear algo que no existe y merece enterarse. Los
    // ids que SÍ existían quedan ackeados igual — el ack es por entrada, no transaccional.
    err(`Error: id(s) inexistentes: ${missing.map((m) => stripControlChars(m)).join(', ')}\n`);
    return 2;
  }
  return 0;
}
