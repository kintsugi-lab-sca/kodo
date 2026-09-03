// @ts-check
//
// src/cli/inbox.js — Action handlers de `kodo inbox` y de sus subcomandos (Phase 83 Plan 02).
//
// Responsabilidades (83-CONTEXT §D-09..D-14, D-18; contrato 3):
//   1. `runInboxListCli` — listado de capturas: abiertas por defecto, todas con `--all`.
//      Render human coloreado via `createFormatter`, o una línea de JSON con `--json`.
//   2. `runInboxMarkCli` — cierre de una captura (`enrutada` / `descartada`) delegando en
//      `markCapture`; mapea sus `reason` a los exit codes de D-13.
//   3. Exit codes: listado 0 SIEMPRE (never-throws, D-18) — marcado 0 ok · 1 lock-timeout,
//      escritura concurrente o error de filesystem · 2 id inexistente o captura ya cerrada.
//
// EL SEAM DE ENRUTADO SIGUE SIENDO DOCUMENTAL (D-09 / CAPT-04). kodo NO decide, NO valida y NO
// ejecuta el destino de una captura. El flujo del operador es de TRES pasos manuales y
// desacoplados:
//
//     1. `kodo inbox`                    → ver las capturas abiertas y copiar el id corto
//     2. (fuera de kodo) el operador o el LLM en sesión enruta la idea a donde toque
//     3. `kodo inbox route <id> --dest <ref>` → dejar el trace pointer de vuelta en el inbox
//
// Cero acoplamiento y cero drift: este fichero no importa el módulo de procesos hijo de Node, no
// ejecuta ningún proceso externo y no importa ninguna ruta del skill de enrutado. Blindado por el
// gate source-hygiene de `test/inbox-cli.test.js`, anclado al patrón de IMPORT.
//
// KODO-76 añade `promote`, y NO es una excepción a lo anterior: es el único destino que kodo sí
// conoce —su propio tablero—, y llegar a él no pasa por el skill de enrutado ni por ningún
// proceso externo, sino por el proveedor que este binario ya usa para todo lo demás. El seam
// documental sigue siendo el camino para cualquier OTRO destino, que es para lo que se diseñó:
// un documento, un mensaje, otra herramienta. Lo que cambia es que la ref de una tarea creada
// por kodo deja de tener que teclearse a mano.
//
// Invariante de retorno (D-07 del repo, precedente `skill-sync.js:44-49`): estos handlers NUNCA
// invocan el helper de salida del runtime — RETORNAN el código. El registro de commander en
// `src/cli.js` es quien hace el exit.
//
// Invariante de color isolation (Phase 14 D-07): este fichero NUNCA importa el paquete de color
// directamente — solo `createFormatter`. Blindado por `test/format-isolation.test.js`.
//
// NOTA: no invoca la comprobación de configuración de proveedor. El inbox es filesystem local
// (`~/.kodo/inbox.md`) y no toca ningún provider — mismo precedente que `skill sync`,
// `gsd doctor` y `sidebar doctor` (ver `src/cli.js`).

import { deriveHeadline, hasMore } from '../inbox/headline.js';
import { defaultInboxPaths, listCaptures, markCapture, retagCapture } from '../inbox/store.js';
import { createFormatter } from './format.js';
import { stripControlChars } from './sanitize.js';

/**
 * Opciones del listado.
 *
 * D-14: NO existen `--project` ni `--open` ni ningún otro filtro. CAPT-F1 («filtrar el inbox»)
 * está DIFERIDO a v2 — «solo cuando el inbox tenga volumen real». La superficie no se adelanta.
 *
 * KODO-76: `--full` SÍ existe, y no contradice lo anterior. No es un filtro —no cambia QUÉ
 * capturas se listan— sino el nivel de detalle de una columna: el listado pasó a enseñar el
 * titular y `--full` recupera el texto entero.
 *
 * @typedef {{ all?: boolean, json?: boolean, full?: boolean }} RunInboxListCliOpts
 */

/**
 * @typedef {{
 *   listFn?: typeof listCaptures,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} RunInboxListCliDeps
 */

/**
 * @typedef {{
 *   markFn?: typeof markCapture,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} RunInboxMarkCliDeps
 */

/**
 * Lista las capturas del inbox.
 *
 * @param {RunInboxListCliOpts} opts
 * @param {RunInboxListCliDeps} [deps]
 * @returns {number} SIEMPRE 0 (D-18: el listado nunca es una condición de error).
 */
export function runInboxListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const listFn = deps.listFn || listCaptures;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  try {
    // 1. Los paths se resuelven en el CALL-SITE (contrato 7). `listCaptures` es un leaf
    //    never-throws: un fichero ausente es el estado inicial normal, no un error.
    const { inboxPath } = pathsFn();
    const { captures, unparsed } = listFn({ inboxPath });

    // 2. Filtrado. El checkbox es la AUTORIDAD de abierta/cerrada (D-05).
    const rows = opts.all === true ? captures : captures.filter((c) => c.open === true);
    const openCount = captures.filter((c) => c.open === true).length;

    // 3. Rama `--json` PRIMERO, antes de instanciar el formatter: así el carril máquina no puede
    //    contaminarse con ANSI por construcción, no solo por convención (DX-06 byte-determinismo).
    //
    //    SANEO DEL CARRIL DE DATOS (WR-02). Aquí vivía la afirmación de que el texto podía ir
    //    VERBATIM porque `JSON.stringify` escapaba «todo byte de control». La medición del review
    //    la refutó: el serializador escapa los C0, pero NO escapa DEL ni el bloque C1, y ambos
    //    salían íntegros. Como `~/.kodo/inbox.md` es human-editable por diseño, una línea pegada a
    //    mano con una secuencia de escritura al portapapeles llegaba entera al consumidor de este
    //    carril — que es además el que la skill del orquestador manda usar y cuya salida un modelo
    //    reemite hacia el terminal. Mismo modelo de amenaza que el render human ya cerraba: se
    //    cierra en los DOS carriles o el hueco es por diseño.
    //
    //    Solo se sanean los campos que provienen del FICHERO. El id y la fecha no lo necesitan: el
    //    parser los restringe a `[0-9a-z]+` y a `\d{4}-\d{2}-\d{2}`, alfabetos sin controles.
    if (opts.json === true) {
      /** @type {{ open: number, unparsed: number, captures: Record<string, unknown>[] }} */
      const payload = {
        open: openCount,
        unparsed,
        captures: rows.map((c) => {
          /** @type {Record<string, unknown>} */
          const o = {
            id: c.id,
            // KODO-76: `headline` se AÑADE, `text` no cambia. El consumidor de este carril es la
            // skill del orquestador, que necesita las dos cosas: el titular para enseñar la
            // bandeja y el texto entero para decidir. Derivarlo aquí evita que cada consumidor
            // se invente su propio corte y que dos superficies muestren titulares distintos de
            // la misma captura. Va tras `id` —no al final— porque el orden de claves es parte
            // del byte-determinismo de DX-06 y este es su sitio natural, junto al texto.
            headline: sanitizeJsonField(deriveHeadline(c.text)),
            text: sanitizeJsonField(c.text),
            tag: sanitizeJsonField(c.tag),
            date: c.date,
            origin: sanitizeJsonField(c.origin),
            open: c.open,
          };
          // Claves opcionales añadidas condicionalmente y en orden FIJO (molde `skill-sync.js:92`).
          if (opts.all === true) {
            o.estado = c.estado;
            // `dest` es NULABLE (una cerrada sin trace pointer, o una descartada): el null se
            // preserva tal cual — sanearlo lo convertiría en la cadena "null".
            o.dest = c.dest === null ? null : sanitizeJsonField(c.dest);
          }
          return o;
        }),
      };
      write(JSON.stringify(payload) + '\n');
      return 0;
    }

    renderHuman(
      rows,
      { all: opts.all === true, full: opts.full === true, unparsed, total: captures.length },
      write,
      formatterFn(),
    );
    return 0;
  } catch (e) {
    // Cinturón de seguridad de D-18: ni siquiera un fallo del render puede convertir un listado
    // en un exit distinto de 0. El operador ve el aviso, pero el comando no «falla».
    err(`[kodo:inbox] no se pudo renderizar el listado: ${/** @type {Error} */ (e).message}\n`);
    return 0;
  }
}

/**
 * Saneo del carril de DATOS: elimina EXCLUSIVAMENTE el rango de controles que `JSON.stringify`
 * deja pasar VERBATIM — DEL (`\u007f`) y el bloque C1 (`\u0080`-`\u009f`).
 *
 * El serializador escapa los controles C0 a `\uXXXX` y los deja inertes, pero NO toca DEL ni C1
 * (medición del review, WR-02): U+009B es el CSI de un solo byte y U+009D el OSC de un solo byte,
 * que algunos terminales interpretan SIN ESC previo. Ambos salían íntegros por este carril.
 *
 * Importa porque `~/.kodo/inbox.md` es human-editable POR DISEÑO: una línea pegada a mano con una
 * secuencia de escritura al portapapeles llega verbatim al consumidor de `--json` — que es además
 * el carril que la skill del orquestador manda usar, y cuya salida un modelo reemite hacia el
 * terminal del operador. Es el MISMO modelo de amenaza que el render human ya cierra con
 * `stripControlChars`; cerrarlo en un solo carril dejaba el otro como agujero por diseño.
 *
 * Deliberadamente MÁS ESTRECHO que `stripControlChars` (Decisión C): no re-escapa nada de lo que
 * el serializador ya cubre, no colapsa whitespace y no altera el orden ni el conjunto de claves
 * del objeto emitido — el byte-determinismo de DX-06 queda intacto.
 *
 * Never-throws: coacciona con `String(s)`.
 *
 * @private
 * @param {unknown} s
 * @returns {string}
 */
function sanitizeJsonField(s) {
  return String(s).replace(/[\u007f-\u009f]/g, '');
}

/**
 * Etiqueta de estado de una captura para el modo `--all`.
 *
 * Contrato 2: una línea hand-editada a `- [x]` SIN sufijo llega con `estado: null`. El checkbox
 * manda, así que se muestra como cerrada con cierre DESCONOCIDO — nunca como abierta.
 *
 * @private
 * @param {import('../inbox/store.js').Capture} c
 * @returns {string}
 */
function estadoLabel(c) {
  if (c.open === true) return 'abierta';
  if (c.estado === 'enrutada') {
    const dest = c.dest === null ? '' : stripControlChars(c.dest).trim();
    return dest === '' ? 'enrutada' : `enrutada → ${dest}`;
  }
  if (c.estado === 'descartada') return 'descartada';
  return 'cerrada (desconocido)';
}

/**
 * Render TTY (human-readable). NO se invoca para `--json` — la rama se separa antes para
 * garantizar bytes deterministas.
 *
 * SANEO DEL CARRIL DE RENDER (Pitfall 6 / T-83-09): el texto, el tag y el destino se pasan por
 * `stripControlChars` ANTES de pintarlos. El saneo del carril de ESCRITURA no basta, porque
 * `~/.kodo/inbox.md` es human-editable POR DISEÑO: una línea con OSC-52 pegada a mano se
 * ejecutaría en el terminal del operador (escritura a su portapapeles) al hacer `kodo inbox`.
 * El id y la fecha no lo necesitan — el parser los restringe a `[0-9a-z]+` y a `\d{4}-\d{2}-\d{2}`.
 *
 * Las filas NO se numeran a propósito: el handle que el operador copia para `route`/`discard` es
 * el ID CORTO, y numerar induciría a usar el número de fila como handle (que no es estable entre
 * invocaciones, porque el filtro por defecto cambia con cada cierre).
 *
 * @private
 * @param {import('../inbox/store.js').Capture[]} rows
 * @param {{ all: boolean, full: boolean, unparsed: number, total: number }} meta
 * @param {(s: string) => void} write
 * @param {import('./format.js').Formatter} fmt
 */
function renderHuman(rows, meta, write, fmt) {
  if (rows.length === 0) {
    if (meta.total === 0) {
      write(`${fmt.dim('El inbox está vacío.')} Captura una idea con: kodo capture "una idea"\n`);
    } else {
      write(
        `${fmt.dim('No hay capturas abiertas.')} Usa ${fmt.cyan('kodo inbox --all')} para ver la traza.\n`,
      );
    }
  } else {
    const table = rows.map((c) => {
      // KODO-76: la columna de texto es el TITULAR, no el texto entero. Una captura llega a
      // 1000 chars y volcarlos en una celda de tabla destruye la tabla —la fila envuelve, las
      // columnas dejan de alinearse y el listado deja de ser escaneable—, que es exactamente por
      // lo que los titulares «no se entendían». `--full` devuelve el comportamiento anterior, y
      // el `+` marca las capturas cuyo detalle tiene más texto del que la fila enseña.
      const text = stripControlChars(c.text);
      const cells = [
        fmt.cyan(c.id),
        meta.full ? text : deriveHeadline(text) + (hasMore(text) ? fmt.dim(' +') : ''),
        fmt.dim(stripControlChars(c.tag)),
        fmt.dim(c.date),
      ];
      if (meta.all) cells.push(fmt.gray(estadoLabel(c)));
      return cells;
    });
    write(fmt.formatTable(table) + '\n');
  }

  if (meta.unparsed > 0) {
    const n = meta.unparsed;
    write(
      `${fmt.yellow(`${n} línea${n === 1 ? '' : 's'} no parseable${n === 1 ? '' : 's'}`)} ` +
        `omitida${n === 1 ? '' : 's'} del listado y conservada${n === 1 ? '' : 's'} en el fichero\n`,
    );
  }
}

/**
 * Cierra una captura por id: `enrutada` (con trace pointer opcional) o `descartada`.
 *
 * @param {string} id
 * @param {'enrutada' | 'descartada'} estado
 * @param {{ dest?: string }} opts — `dest` es el TRACE POINTER: una string LIBRE y OPACA.
 *   Se pasa TAL CUAL al store, que la sanea y la recorta a su cota. Este handler NO comprueba
 *   que el destino exista, NO lo resuelve contra el filesystem y NO interpreta su forma: el «a
 *   dónde va» es competencia exclusiva del skill de enrutado (D-11 / CAPT-04). Sin `dest` el
 *   marcado se aplica igual y devuelve 0 — el best-effort literal de CAPT-06 (D-10).
 * @param {RunInboxMarkCliDeps} [deps]
 * @returns {number} exit code (D-13): 0 ok · 1 lock-timeout o fs · 2 not-found o already-closed.
 */
export function runInboxMarkCli(id, estado, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const markFn = deps.markFn || markCapture;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  // El id llega de argv y se pinta en los mensajes: se sanea para el render (nunca para el
  // matcheo, que va verbatim contra la línea). No se compone ningún path a partir de él —
  // los paths salen de `pathsFn()`, del home y de dos basenames fijos (T-83-10).
  const safeId = stripControlChars(id);

  const { inboxPath, lockPath } = pathsFn();

  /** @type {{ ok: true, capture: any } | { ok: false, reason: string }} */
  let result;
  try {
    result = markFn(id, estado, { dest: opts.dest ?? null, inboxPath, lockPath });
  } catch (e) {
    err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }

  if (result.ok) {
    const fmt = formatterFn();
    write(`${fmt.ok(`Captura ${safeId} ${estadoLabel(result.capture)}`)}\n`);
    return 0;
  }

  // Mapeo de los `reason` del store (D-13 + contrato 3). `lock-timeout` NO hace fail-open:
  // un marcado sin coordinación reintroduce el lost-update que D-01 cierra, así que se reporta
  // como fallo reintentable y el fichero queda intacto.
  switch (result.reason) {
    case 'not-found':
      err(`Error: capture ${safeId} not found\n`);
      return 2;
    case 'already-closed':
      err(`Error: capture ${safeId} is already closed\n`);
      return 2;
    case 'lock-timeout':
      err(
        `Error: lock-timeout — el marcado de ${safeId} NO se ha aplicado; reinténtalo en unos segundos\n`,
      );
      return 1;
    case 'concurrent-write':
      // Rama PROPIA, no conflada con `lock-timeout` (D-13). Aquí el lock SÍ se obtuvo: lo que
      // pasó es que una captura concurrente aterrizó mientras se marcaba, y el guard
      // compare-and-swap abortó la publicación PARA NO DESTRUIRLA. El fichero queda intacto y la
      // acción del operador es la misma —reintentar—, pero la causa no lo es: conflarlas dejaría
      // al siguiente mantenedor buscando contención de lock donde hay un guard funcionando
      // exactamente como debe.
      err(
        `Error: escritura concurrente — el marcado de ${safeId} se ha abortado para no perder una ` +
          `captura que aterrizó a la vez; el fichero queda intacto, reinténtalo\n`,
      );
      return 1;
    default:
      err(`Error: filesystem error: no se pudo marcar la captura ${safeId}\n`);
      return 1;
  }
}

/**
 * Reasigna el proyecto de una captura abierta (KODO-76).
 *
 * El tag nace derivado del cwd, así que una idea escrita desde otro repo nace con el proyecto
 * equivocado. Esto lo corrige — y desde que existe `promote`, corregirlo importa: el tag es el
 * proyecto de destino por defecto de la tarea.
 *
 * NO valida el tag contra `projects.json`: un tag que no mapea a ningún proyecto configurado
 * sigue siendo información útil en la bandeja (el operador puede etiquetar una idea de un
 * proyecto que aún no existe). Quien exige que el tag resuelva es `promote`, en el momento en que
 * ese tag tiene que elegir un tablero.
 *
 * @param {string} id
 * @param {string} tag
 * @param {RunInboxMarkCliDeps & { retagFn?: typeof retagCapture }} [deps]
 * @returns {number} exit code: 0 ok · 1 lock-timeout, escritura concurrente o fs · 2 id
 *   inexistente, captura cerrada o tag inválido (los tres son entrada mala, no fallo del sistema).
 */
export function runInboxRetagCli(id, tag, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const retagFn = deps.retagFn || retagCapture;
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  const safeId = stripControlChars(id);
  const { inboxPath, lockPath } = pathsFn();

  /** @type {{ ok: true, capture: any } | { ok: false, reason: string }} */
  let result;
  try {
    result = retagFn(id, tag, { inboxPath, lockPath });
  } catch (e) {
    err(`Error: filesystem error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }

  if (result.ok) {
    const fmt = formatterFn();
    write(`${fmt.ok(`Captura ${safeId} → proyecto ${stripControlChars(result.capture.tag)}`)}\n`);
    return 0;
  }

  switch (result.reason) {
    case 'not-found':
      err(`Error: capture ${safeId} not found\n`);
      return 2;
    case 'already-closed':
      err(`Error: capture ${safeId} is already closed\n`);
      return 2;
    case 'invalid-tag':
      err(`Error: el proyecto queda vacío tras el saneo — usa un nombre con al menos un carácter útil\n`);
      return 2;
    case 'lock-timeout':
      err(`Error: lock-timeout — el retag de ${safeId} NO se ha aplicado; reinténtalo en unos segundos\n`);
      return 1;
    case 'concurrent-write':
      err(
        `Error: escritura concurrente — el retag de ${safeId} se ha abortado para no perder una ` +
          `captura que aterrizó a la vez; el fichero queda intacto, reinténtalo\n`,
      );
      return 1;
    default:
      err(`Error: filesystem error: no se pudo reasignar la captura ${safeId}\n`);
      return 1;
  }
}

/**
 * Convierte una captura abierta en una TAREA del proveedor y la cierra como enrutada hacia ella.
 *
 * A diferencia del resto de este fichero, este handler SÍ toca el proveedor, así que —igual que
 * `kodo adopt`— necesita configuración válida. El registro en `src/cli.js` es quien invoca
 * `ensureConfig()`; aquí solo se resuelven las dependencias por lazy-import para que los tests
 * puedan inyectarlas sin tocar el registry real ni `~/.kodo/projects.json`.
 *
 * @param {string} id
 * @param {{ project?: string, json?: boolean }} opts `project` es el destino explícito (tag o id);
 *   sin él manda el tag de la captura.
 * @param {{
 *   promoteFn?: typeof import('../inbox/promote.js').promoteCapture,
 *   getProviderFn?: () => any,
 *   loadProjectsFn?: () => Record<string, unknown>,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   pathsFn?: () => { inboxPath: string, lockPath: string },
 * }} [deps]
 * @returns {Promise<number>} exit code: 0 ok · 1 entrada inválida, sin proyecto resoluble,
 *   proveedor incapaz o marcado fallido (recuperable a mano) · 2 el POST falló (transitorio,
 *   reintentable por script sin efecto lateral: no se ha creado nada y la captura sigue abierta).
 */
export async function runInboxPromoteCli(id, opts, deps = {}) {
  const write = deps.writeFn || ((s) => void process.stdout.write(s));
  const err = deps.errFn || ((s) => void process.stderr.write(s));
  const pathsFn = deps.pathsFn || defaultInboxPaths;
  const formatterFn = deps.formatterFn || (() => createFormatter(process.stdout));

  const safeId = stripControlChars(id);
  const { inboxPath, lockPath } = pathsFn();

  /** @type {import('../inbox/promote.js').PromoteResult} */
  let result;
  try {
    const promoteFn = deps.promoteFn || (await import('../inbox/promote.js')).promoteCapture;
    const getProviderFn =
      deps.getProviderFn || (await import('../providers/registry.js')).getProvider;
    const loadProjectsFn = deps.loadProjectsFn || (await import('../config.js')).loadProjects;
    result = await promoteFn({
      id,
      provider: getProviderFn(),
      projects: loadProjectsFn(),
      projectRef: opts.project,
      inboxPath,
      lockPath,
    });
  } catch (e) {
    // Fallo al RESOLVER las dependencias (config ausente, provider no construible). No es el POST:
    // nada se ha creado y nada se ha marcado.
    err(`Error: ${/** @type {Error} */ (e).message}\n`);
    return 1;
  }

  if (result.ok === true) {
    const ref = stripControlChars(String(result.task?.ref ?? ''));
    const url = stripControlChars(String(result.task?.url ?? ''));
    if (opts.json === true) {
      write(JSON.stringify({ ok: true, id: safeId, ref, url, project: result.projectId }) + '\n');
      return 0;
    }
    const fmt = formatterFn();
    write(`${fmt.ok(`Captura ${safeId} → ${ref}`)}${url ? ` ${fmt.dim(url)}` : ''}\n`);
    return 0;
  }

  switch (result.code) {
    case 'UNSUPPORTED':
      err(`Error: el proveedor configurado no sabe crear tareas — usa kodo inbox route ${safeId} --dest <ref>\n`);
      return 1;
    case 'NOT_FOUND':
      err(`Error: capture ${safeId} not found\n`);
      return 1;
    case 'ALREADY_CLOSED':
      err(`Error: capture ${safeId} is already closed\n`);
      return 1;
    case 'NO_PROJECT':
      err(
        `Error: «${stripControlChars(String(result.detail?.ref ?? ''))}» no resuelve a ningún proyecto ` +
          `configurado — reasigna con kodo inbox retag ${safeId} <proyecto>, o pasa --project <id>\n`,
      );
      return 1;
    case 'AMBIGUOUS_PROJECT':
      err(
        `Error: «${stripControlChars(String(result.detail?.ref ?? ''))}» resuelve a varios proyectos ` +
          `(${(result.detail?.matches ?? []).join(', ')}) — desambigua con --project <id>\n`,
      );
      return 1;
    case 'CREATE_FAILED':
      // 2 = transitorio. La captura sigue ABIERTA y no se ha creado nada: reintentar es seguro.
      err(`Error: no se pudo crear la tarea: ${stripControlChars(String(result.detail ?? ''))}\n`);
      return 2;
    case 'MARK_FAILED':
      // La tarea EXISTE. Lo único que falta es cerrar la captura, y el operador tiene la ref para
      // hacerlo a mano — por eso el mensaje lleva el comando exacto, no una descripción del fallo.
      err(
        `Error: la tarea ${stripControlChars(String(result.detail?.ref ?? ''))} SÍ se ha creado, pero la ` +
          `captura no se ha podido cerrar (${result.detail?.reason}). Ciérrala con: ` +
          `kodo inbox route ${safeId} --dest ${stripControlChars(String(result.detail?.ref ?? ''))}\n`,
      );
      return 1;
    default:
      err(`Error: no se pudo promover la captura ${safeId}\n`);
      return 1;
  }
}
