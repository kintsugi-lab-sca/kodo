// @ts-check
//
// src/inbox/store.js — Phase 83 Plan 01 (CAPT-01/03/06; D-01..D-08, D-15..D-20, D-22).
//
// Responsabilidades:
//   1. Codec de la línea del inbox (`encodeLine`) — el contrato BYTE-EXACTO que Phase 84 consume
//      (D-05, D-22). El golden vive en `test/inbox-format-golden.test.js`.
//   2. Parser anclado a la COLA (`parseLine`, D-08) — el texto del usuario es libre por diseño y
//      NO puede falsificar los campos estructurados.
//   3. Identidad de una captura: id corto opaco (D-06), fecha LOCAL (D-07), tag derivado del cwd
//      (D-15) y resolución PEREZOSA de los paths por defecto (`defaultInboxPaths`).
//   4. Reader leaf never-throws (`listCaptures`, D-18).
//   5. Append `O_APPEND` con fail-open ante lock-timeout (`appendCapture`, D-02/D-03).
//   6. Marcado RMW bajo lock con unique-tmp + rename y guard compare-and-swap contra la lectura
//      obsoleta (`markCapture`, D-01/D-04). El guard —no el presupuesto del lock— es lo que impide
//      que un append fuera de coordinación (D-03) se pierda bajo el rename.
//
// Invariantes:
//   - PROHIBIDO importar `src/config.js`. Tres razones independientes, cada una suficiente:
//     (a) evalúa `homedir()` en el CUERPO del módulo (`config.js:11`) y esa fuga contamina los
//         tests — un test que fije `HOME` después del import llega tarde (RESEARCH §Pitfall 5);
//     (b) su `writeFileAtomic` publica sobre un tmp de nombre FIJO (`path + '.tmp'`), compartido
//         entre escritores y por tanto pisable cuando el lock se roba tras su TTL de 10 s
//         (`state-lock.js:36`) — exactamente el defecto que el fix WR-02 corrigió;
//     (c) su heurístico `/"[^"]*_secret"\s*:/` chmodearía el inbox a 0600 si una captura contuviera
//         esa subcadena, contra D-20 (el inbox NO es un secreto).
//     `.planning/STATE.md:100` §Critical Invariants lo prohíbe explícitamente para todo path del
//     inbox. El acoplamiento se corta POR CONSTRUCCIÓN: este módulo no importa `config.js`, así que
//     el escritor de tmp fijo es literalmente inalcanzable desde aquí.
//   - PROHIBIDO importar el paquete de color: solo `src/cli/format.js` lo hace (D-07 Phase 14);
//     blindado por `test/format-isolation.test.js`.
//   - Ninguna ruta BORRA una captura (CAPT-03): cerrar es solo una transición de estado. La traza
//     permanente ES el feature.
//   - Toda línea distinta de la marcada se preserva BYTE A BYTE — incluidas las que NO parsean, las
//     vacías y la presencia/ausencia de newline final (D-04). El fichero es human-editable.
//   - Módulo de lógica: no emite eventos NDJSON ni hace `process.exit`; el caller (CLI) decide.

import { randomBytes, randomUUID } from 'node:crypto';
import {
  appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  realpathSync, renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { stripForKeystroke } from '../cli/format.js';
import { resolveProjectId } from '../cli/dashboard/select.js';
import { withFileLock } from '../session/state-lock.js';

/**
 * Una captura del inbox, ya parseada.
 *
 * @typedef {{
 *   id: string,
 *   text: string,
 *   tag: string,
 *   date: string,
 *   origin: string,
 *   open: boolean,
 *   estado: 'enrutada' | 'descartada' | null,
 *   dest: string | null,
 * }} Capture
 */

/** Nombre del fichero del inbox dentro de `~/.kodo/` (D-19). */
export const INBOX_FILENAME = 'inbox.md';

/** Lockfile HERMANO del inbox — la primitiva es `withFileLock`, jamás `src/gsd/lock.js` (D-01). */
export const INBOX_LOCK_FILENAME = 'inbox.lock';

/**
 * Cota del texto capturado. La atomicidad de `O_APPEND` se verificó empíricamente hasta 200 000 B
 * (RESEARCH §Code Examples), pero `appendFileSync` hace loop sobre escrituras parciales: una cota
 * explícita mantiene el write inequívocamente único (Pitfall 1).
 */
export const MAX_TEXT_LEN = 1000;

/** Cota del trace pointer `--dest`. Es una ref opaca (D-11), no un path que kodo resuelva. */
export const MAX_DEST_LEN = 200;

/**
 * Techo de intentos del ciclo read-modify-write de `markCapture`, DENTRO de una única toma del
 * lock (Plan 04, GAP-1).
 *
 * Cada intento cuesta una relectura del fichero: medida por el reviewer en 20,3 ms sobre un inbox
 * de 50 000 capturas (5,8 MB), y sub-milisegundo en el rango realista (0,6 ms a 100 capturas,
 * 1,0 ms a 1000). El techo es por tanto barato incluso en el peor caso.
 *
 * El bucle solo gira cuando el guard detecta un cambio REAL del fichero entre la lectura y el
 * rename, es decir cuando hay un escritor fuera de coordinación (el fail-open de D-03) o una
 * publicación por rename de un tercero. 5 intentos convergen salvo bajo un flujo PERPETUO de esos
 * escritores; agotado el techo, `markCapture` devuelve `concurrent-write` sin tocar el fichero.
 */
const MARK_RMW_ATTEMPTS = 5;

/**
 * Separador de campos: espacio + U+00B7 (MIDDLE DOT) + espacio.
 * Los campos ESTRUCTURADOS (tag, origen) jamás lo contienen — el sanitizador lo sustituye por
 * guion (Pitfall 4). El texto y el `dest` sí pueden: el primero porque el parseo está anclado a la
 * cola (D-08), el segundo porque va al final de la línea.
 */
const SEP = ' · ';

/** Trace pointer: espacio + U+2192 (RIGHTWARDS ARROW) + espacio (D-05, CAPT-06). */
const ARROW = ' → ';

/**
 * Gramática de la línea (D-05, D-08):
 *   - [ ] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen>
 *   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · enrutada[ → <dest>]
 *   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · descartada
 *   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen>            (hand-edit sin sufijo)
 *
 * El grupo del texto es `(.+)` GREEDY a propósito: empuja las anclas al match más a la DERECHA,
 * que es exactamente la semántica «anclado a la cola» de D-08. Consecuencia directa: un texto de
 * usuario que imite la cola (`… · kodo · 2026-07-25 · cli · descartada`) NO falsifica los campos
 * estructurados — ganan los reales, que están más a la derecha, y el forgery queda dentro de
 * `text`, verbatim. La fecha `\d{4}-\d{2}-\d{2}` es el ancla DESAMBIGUADORA: es el único campo con
 * forma fija, así que fija la posición de tag y origen aunque el texto contenga separadores.
 * `[^·]*` en tag/origen exige que esos campos NO contengan el separador (Pitfall 4) — el
 * sanitizador de campos estructurados lo garantiza en el carril de escritura.
 *
 * CONSTANTE DE MÓDULO, jamás compilada desde input (anti-ReDoS; sonda medida: 0,4 ms sobre 80 KB
 * sin match, sin backtracking catastrófico — RESEARCH §Code Examples).
 */
const LINE_RE =
  /^- \[([ x])\] ([0-9a-z]+) · (.+) · ([^·]*) · (\d{4}-\d{2}-\d{2}) · ([^·]*?)(?: · (enrutada|descartada)(?: → (.*))?)?$/;

/**
 * Paths por defecto del inbox, resueltos PEREZOSAMENTE.
 *
 * Se resuelve DENTRO de la función, jamás en el cuerpo del módulo: `src/config.js:11` evalúa
 * `homedir()` al cargar el módulo y esa fuga contamina los tests (Pitfall 5). Aquí, un test que
 * fije `process.env.HOME` antes de INVOCAR obtiene su sandbox aunque el import sea estático.
 *
 * El lockfile es HERMANO del inbox: `acquireLock` ya hace `mkdirSync(dirname(lockPath))`
 * (`state-lock.js:73`), así que tomar el lock crea `~/.kodo/` gratis.
 *
 * @returns {{ inboxPath: string, lockPath: string }}
 */
export function defaultInboxPaths() {
  const dir = join(homedir(), '.kodo');
  return {
    inboxPath: join(dir, INBOX_FILENAME),
    lockPath: join(dir, INBOX_LOCK_FILENAME),
  };
}

/**
 * ID corto opaco de 6 chars base36 (D-06).
 *
 * `randomBytes(6)` da 2^48 de entropía; `.toString(36)` produce ~10 chars y `.slice(-6)` toma los
 * dígitos de MENOR peso, que son uniformes. `.slice(0, 6)` (los de MAYOR peso) estaría SESGADO,
 * porque 2^48 no es múltiplo de 36^6. El sesgo residual de los de menor peso es ~1e-5.
 *
 * Espacio: 36^6 ≈ 2,18e9 → probabilidad de colisión (birthday) a 1000 capturas ≈ 0,023 %.
 * Comparativa medida: 6 chars hex (16^6 ≈ 1,7e7) daría ≈ 2,98 %, 130× peor.
 *
 * **Decisión de contrato 5: SIN reintento ante colisión.** Verificar unicidad exigiría leer el
 * fichero entero en CADA captura, contra el principio «la captura es instantánea y tonta». Si dos
 * capturas comparten id, `markCapture` marca la PRIMERA que casa.
 *
 * El parser acepta `([0-9a-z]+)` de cualquier longitud, así que subir a 7-8 chars en el futuro no
 * rompe las líneas ya escritas.
 *
 * @returns {string} 6 chars del alfabeto `[0-9a-z]`
 */
export function newCaptureId() {
  return randomBytes(6).readUIntBE(0, 6).toString(36).padStart(6, '0').slice(-6);
}

/**
 * Fecha `YYYY-MM-DD` LOCAL (D-07) — dato humano, mismo carril que los bloques `## Handoff` de
 * v0.17. Jamás `toISOString()`: ese es el carril máquina de `state.json` y a las 23:30 locales
 * escribiría el día siguiente.
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function todayLocal(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Forma canónica de 36 caracteres de un identificador de proveedor: cinco grupos hexadecimales
 * 8-4-4-4-12 separados por guiones. Anclada a los DOS extremos e insensible a mayúsculas.
 *
 * CONSTANTE DE MÓDULO, jamás compilada desde input (mismo criterio anti-ReDoS que `LINE_RE`):
 * `projects.json` es operator-editable y sus claves llegan aquí sin validar. Longitudes fijas y
 * cero cuantificadores anidados → sin backtracking catastrófico posible.
 */
const UUID_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ¿Tiene `s` forma de identificador de proveedor? Coacciona con `String(...)` (never-throws).
 *
 * @param {unknown} s
 * @returns {boolean}
 */
function isUuidLike(s) {
  return UUID_KEY_RE.test(String(s));
}

/**
 * Ruta del PROYECTO asociada a `projectId` en el mapa, o `''` si no hay ninguna utilizable.
 *
 * Acepta las DOS formas reales del valor (UAT Phase 56 Plan 04, ver `resolveProjectId`): una
 * cadena que ya es la ruta, o un objeto con una clave de ruta por defecto. Todo candidato que no
 * sea una cadena NO VACÍA se descarta, exactamente por la razón por la que `candidatesOf` de
 * `resolveProjectId` lo hace: el fichero es operator-editable y un `default` numérico, nulo o
 * array de un hand-edit no puede hacer lanzar a un carril never-throws.
 *
 * **NO recorre la tabla de módulos a propósito.** El tag identifica el PROYECTO; el path del
 * módulo más específico no es lo que el operador necesita leer en una fila de una lista de triage.
 * Sin ruta por defecto, el caller cae al último recurso (el nombre del directorio actual).
 *
 * @param {Record<string, unknown> | undefined} projects
 * @param {string} projectId
 * @returns {string}
 */
function mappedProjectPath(projects, projectId) {
  try {
    const value = /** @type {any} */ (projects ?? {})[projectId];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && typeof value.default === 'string') {
      return value.default;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Deriva el tag-proyecto desde el cwd (D-15). Reutiliza `resolveProjectId` (nearest-ancestor sobre
 * `projects.json`) — NO reimplementa su semántica; solo PROYECTA su resultado a algo legible.
 *
 * `resolveProjectId` tiene DOS modos de fallo, no uno: `{error:'none'}` y `{error:'ambiguous'}`
 * (Pitfall 3). La forma robusta es exigir la PRESENCIA de `projectId`; cualquier otro shape
 * (incluido uno inesperado de una futura refactorización) cae a `basename(cwd)`. Un tag no mapeado
 * es sencillamente el nombre del directorio desde el que se capturó: un solo campo, siempre
 * poblado, siempre informativo.
 *
 * ## Proyección del identificador de proveedor (GAP-3 / CR-03)
 *
 * La clave de `projects.json` es el identificador del PROVEEDOR de tareas, no un nombre elegido
 * por el operador. En la instalación real medida, las 10 claves son UUIDs canónicos de 36
 * caracteres y la mitad legible es el VALOR (la ruta). Devolver la clave cruda escribía
 * `7246e3fe-3dc4-4f24-9078-1911ad477e0d` como tag de una captura hecha desde este mismo repo:
 * deformaba la columna del listado y no comunicaba nada — que es precisamente la única función
 * del campo según D-15.
 *
 * **Decisión A — la proyección es CONDICIONAL.** Solo se proyecta cuando el identificador tiene
 * forma de UUID. Un identificador ya legible se devuelve TAL CUAL, exactamente como antes: el
 * comportamiento previo es correcto para toda configuración con claves legibles y el cierre de un
 * gap no reabre lo que ya funcionaba. Una proyección incondicional además haría depender el tag de
 * la forma del VALOR del mapa, que es operator-editable.
 *
 * **Decisión B — la ruta legible sale del MAPA, no del cwd.** El tag es el último segmento de la
 * ruta mapeada a ese identificador. El nombre del directorio actual es el ÚLTIMO recurso, no el
 * primero: capturar desde un subdirectorio del proyecto (lo normal) daría el nombre del
 * subdirectorio, que informa peor que el nombre del proyecto.
 *
 * Solo se persiste el ÚLTIMO SEGMENTO de la ruta, nunca la ruta completa (T-83-38): el grado de
 * información expuesto es el mismo que ya exponía el fallback `basename(cwd)`.
 *
 * Never-throws: `projects` sale de `~/.kodo/projects.json`, que es operator-editable y puede ser
 * `null`, un número o un array tras un hand-edit.
 *
 * @param {string} cwd
 * @param {Record<string, unknown>} [projects] — mapa de `loadProjects()`
 * @returns {string}
 */
export function deriveTag(cwd, projects) {
  const fallback = typeof cwd === 'string' ? basename(cwd) : '';
  try {
    const r = resolveProjectId(cwd, /** @type {any} */ (projects ?? {}));
    if (r && typeof r === 'object' && 'projectId' in r && typeof r.projectId === 'string') {
      if (!isUuidLike(r.projectId)) return r.projectId;
      // Identificador de proveedor: proyectar a la mitad legible del mapa (Decisiones A y B).
      const mapped = mappedProjectPath(projects, r.projectId).replace(/\/+$/, '');
      const name = mapped === '' ? '' : basename(mapped);
      return name === '' ? fallback : name;
    }
    return fallback;
  } catch {
    // `resolveProjectId` es never-throws por contrato (CR-01 Phase 56); este catch es el cinturón
    // de seguridad de D-18 por si esa garantía se rompiera aguas arriba.
    return fallback;
  }
}

/**
 * Saneo del TEXTO capturado (CAPT-01).
 *
 * `stripForKeystroke` colapsa a espacio los `\n`/`\r`/`\t` REALES **y** sus formas de escape
 * LITERAL, además de eliminar todo control C0/C1/DEL/CSI. Encima de eso neutralizamos U+2028 y
 * U+2029, que SOBREVIVEN a `stripForKeystroke` (Pitfall 10) — se hace aquí y no en `format.js`,
 * que es compartido con el carril keystroke y tiene goldens byte-idénticos que no toca mover.
 *
 * El whitespace INTERIOR no se colapsa: el texto se persiste lo más verbatim posible (CAPT-01
 * prohíbe reinterpretarlo). Solo se recortan los bordes y se aplica la cota de Pitfall 1.
 *
 * @param {unknown} s
 * @returns {string}
 */
function sanitizeText(s) {
  return stripForKeystroke(s)
    .replace(/[\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LEN);
}

/**
 * Saneo de un campo ESTRUCTURADO (tag, origen).
 *
 * Además del saneo a una línea, sustituye el separador U+00B7 por guion y colapsa runs de
 * whitespace: un campo estructurado NUNCA puede contener el separador, porque a diferencia del
 * texto no hay ancla que lo salve (Pitfall 4 — el tag sale de `projects.json`, operator-editable,
 * o de `basename(cwd)`, un nombre de directorio arbitrario).
 *
 * @param {unknown} s
 * @returns {string}
 */
function sanitizeField(s) {
  return stripForKeystroke(s)
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/·/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Saneo del trace pointer `--dest` (D-11). SÍ puede contener el separador — va al final de la
 * línea, después del ancla de estado, así que `(.*)` lo recupera completo.
 *
 * @param {unknown} s
 * @returns {string}
 */
function sanitizeDest(s) {
  return stripForKeystroke(s)
    .replace(/[\u2028\u2029]/g, ' ')
    .trim()
    .slice(0, MAX_DEST_LEN);
}

/**
 * Codifica una captura a su línea de checklist markdown (D-05). **SIN newline final** — el caller
 * añade el `\n`.
 *
 * El checkbox es la AUTORIDAD de abierta/cerrada; el sufijo solo discrimina CUÁL de los dos
 * cierres. Por eso `open:false` con `estado:null` (una línea hand-editada a `- [x]`) se codifica
 * sin sufijo alguno — decisión de contrato 2.
 *
 * ⚠ Contrato inter-fase: `test/inbox-format-golden.test.js` fija estas cadenas byte a byte y
 * Phase 84 (CAPT-02) compara contra ellas. Cambiar el separador, la flecha o el orden de los
 * campos rompe esa fase.
 *
 * @param {Capture} capture
 * @returns {string}
 */
export function encodeLine(capture) {
  const box = capture.open ? '- [ ] ' : '- [x] ';
  let line =
    box +
    capture.id +
    SEP +
    sanitizeText(capture.text) +
    SEP +
    sanitizeField(capture.tag) +
    SEP +
    capture.date +
    SEP +
    sanitizeField(capture.origin);

  if (capture.open === false && (capture.estado === 'enrutada' || capture.estado === 'descartada')) {
    line += SEP + capture.estado;
    if (capture.estado === 'enrutada' && typeof capture.dest === 'string' && capture.dest !== '') {
      const dest = sanitizeDest(capture.dest);
      if (dest !== '') line += ARROW + dest;
    }
  }
  return line;
}

/**
 * Parsea una línea del inbox. Sin match → `null` (la línea NO es una captura: heading, nota a
 * mano, línea vacía, fecha inválida…). El caller la EXCLUYE del listado y la PRESERVA en disco
 * (D-18 + D-04): no es una captura válida, pero tampoco es basura que kodo pueda tirar.
 *
 * Never-throws: coacciona con `String(line)`.
 *
 * @param {unknown} line
 * @returns {Capture | null}
 */
export function parseLine(line) {
  const m = LINE_RE.exec(String(line));
  if (!m) return null;
  return {
    id: m[2],
    text: m[3],
    tag: m[4],
    date: m[5],
    origin: m[6],
    open: m[1] === ' ',
    estado: /** @type {'enrutada' | 'descartada' | null} */ (m[7] ?? null),
    dest: m[8] ?? null,
  };
}

/**
 * Lista las capturas del inbox. **Leaf never-throws** (D-18): CUALQUIER error de lectura —
 * ENOENT (primer run), EISDIR, EACCES, lo que sea — colapsa a listado vacío. El fichero ausente
 * es el estado inicial normal, no una condición de error.
 *
 * Dualidad deliberada de una línea que NO parsea (D-18 + D-04): se **excluye** del listado
 * estructurado (no es una captura válida) y se **preserva byte a byte** en disco (tampoco es
 * basura que kodo pueda tirar — el fichero es human-editable por diseño). `unparsed` la cuenta
 * para que el CLI pueda surfacearlo sin que el reader tenga que decidir nada. Las líneas VACÍAS
 * no cuentan: son separadores legítimos de un markdown editado a mano.
 *
 * **Esta función JAMÁS escribe.** Ni normaliza, ni reordena, ni reescribe.
 *
 * @param {{ inboxPath: string }} o
 * @returns {{ captures: Capture[], unparsed: number }}
 */
export function listCaptures({ inboxPath }) {
  /** @type {string} */
  let raw;
  try {
    raw = readFileSync(inboxPath, 'utf-8');
  } catch {
    return { captures: [], unparsed: 0 };
  }

  /** @type {Capture[]} */
  const captures = [];
  let unparsed = 0;
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue;
    const c = parseLine(line);
    if (c) captures.push(c);
    else unparsed++;
  }
  return { captures, unparsed };
}

/**
 * Escritura real del append. Privada: la comparten el carril coordinado y el fail-open de D-03.
 *
 * Si el fichero ya existe, tiene tamaño > 0 y su ÚLTIMO BYTE no es el newline, el payload lleva
 * un newline por delante: una línea hand-editada sin terminador nunca puede quedar concatenada
 * con la captura nueva. La sonda del último byte va en `try/catch` porque cualquier fallo suyo
 * debe degradar a «no anteponer», jamás abortar la captura.
 *
 * Una línea = un `appendFileSync` = un `write(2)` bajo `O_APPEND` = un append atómico. Verificado
 * empíricamente hasta 200 000 B con 12 escritores concurrentes (RESEARCH §Code Examples). ⚠ La
 * garantía asume FILESYSTEM LOCAL (`~/.kodo`): `O_APPEND` NO es atómico sobre NFS.
 *
 * Degradación benigna conocida: si dos escritores concurrentes anteponen ambos el newline sobre
 * un fichero sin terminador, aparece una línea vacía extra. `listCaptures` la ignora y
 * `markCapture` la preserva byte a byte — no hay corrupción.
 *
 * @param {string} inboxPath
 * @param {string} line — línea COMPLETA ya codificada y terminada en '\n'
 * @returns {void}
 */
function appendLine(inboxPath, line) {
  let needsNewline = false;
  try {
    const st = statSync(inboxPath);
    if (st.isFile() && st.size > 0) {
      const fd = openSync(inboxPath, 'r');
      try {
        const buf = Buffer.alloc(1);
        readSync(fd, buf, 0, 1, st.size - 1);
        needsNewline = buf[0] !== 0x0a;
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    // Fichero ausente / ilegible / no regular → no anteponer. Si el append de abajo también
    // falla, el caller lo mapea a `{ok:false, reason:'fs'}`.
    needsNewline = false;
  }
  appendFileSync(inboxPath, needsNewline ? '\n' + line : line);
}

/**
 * Appendea una captura ya codificada. `line` llega terminada en '\n' (el caller hace
 * `encodeLine(c) + '\n'`).
 *
 * DOS capas independientes (D-02): el `O_APPEND` garantiza por sí solo que N capturas
 * concurrentes producen N líneas aunque el lock no existiera; el lock protege ADEMÁS contra el
 * RMW de `markCapture` (D-01). Jamás se reescribe el fichero completo.
 *
 * **Fail-open ante `lock-timeout` (D-03).** Agotado el presupuesto del lock, la captura se
 * appendea IGUAL y se emite un warn accionable. Principio GTD: una idea perdida es peor que una
 * línea escrita sin coordinación.
 *
 * ## Presupuesto de reintentos: el DEFAULT de la primitiva, y por qué (Plan 04, revierte 83-03)
 *
 * Este `withFileLock` NO pasa `retries` ni `backoffMs`: aplica los defaults de la primitiva
 * (8 × 20 ms ≈ 160 ms, `state-lock.js:34-35`). El plan 83-03 los había subido a 50 × 20 ms
 * ≈ 1000 ms afirmando que eso «cerraba» el lost-update. Tres hechos, en orden:
 *
 *   (a) **El presupuesto ya no carga ningún invariante.** Quien impide el lost-update es el guard
 *       compare-and-swap de `markCapture`, que compara el ESTADO del fichero y es independiente
 *       del reloj. Un umbral temporal solo movía la frontera: el verificador reprodujo la pérdida
 *       total (0 de 6 supervivientes, exit 0 en los 7 procesos) con un hold de 1500 ms usando el
 *       harness del propio repo, y el TTL del lock es de 10 s, así que cualquier titular vivo que
 *       se atasque abre esa ventana en producción.
 *   (b) **La medición real no justifica el presupuesto elevado.** La sección crítica del marcado
 *       mide 20,3 ms sobre un inbox de 50 000 capturas (5,8 MB) — 0,6 ms a 100 capturas, 1,0 ms a
 *       1000, 4,9 ms a 10 000. El default de 160 ms ya cubre 8× el peor caso realista; los
 *       1000 ms solo existían para superar el hold ARTIFICIAL de 300 ms de un test.
 *   (c) **La rama fail-open vuelve a ser ALCANZABLE, que es lo correcto.** Con el presupuesto
 *       recalibrado, los 18/18 hijos del test de concurrencia entraban por la rama coordinada: el
 *       test que existía para demostrar que una captura concurrente no se pierde había dejado de
 *       ejecutar el código que la perdía. Una rama inalcanzable es una rama sin cobertura, y
 *       poner una carrera en verde enmascarándola es exactamente lo que DEBT-04 (Phase 82)
 *       prohíbe por nombre.
 *
 * El riesgo residual de D-03 sigue existiendo y sigue acotado: entre el `statSync` de
 * comprobación del marcado y su `renameSync` quedan dos syscalls contiguos, y un append que
 * aterrice justo ahí puede perderse. Ningún lock puede cerrar ese hueco mientras esta rama
 * appendee deliberadamente fuera de coordinación. Ver el JSDoc de `markCapture`.
 *
 * Asimetría deliberada con `markCapture`, que NO hace fail-open: un marcado sin coordinación
 * reintroduce exactamente el lost-update que D-01 cierra; una captura sin coordinación solo
 * arriesga esa ventana residual de milisegundos.
 *
 * Contrato 6 — EXACTAMENTE UN warn: se inyecta `{ logger: { warn: () => {} } }` para silenciar el
 * `console.warn('[kodo:lock] …')` propio de la primitiva (`state-lock.js:222`) y se emite un solo
 * mensaje accionable con prefijo `[kodo:inbox]`.
 *
 * @param {string} line
 * @param {{ inboxPath: string, lockPath: string, warnFn?: (s: string) => void }} o
 * @returns {{ ok: true, coordinated: boolean } | { ok: false, reason: 'fs' }}
 */
export function appendCapture(line, { inboxPath, lockPath, warnFn }) {
  const warn = warnFn || ((/** @type {string} */ s) => process.stderr.write(s));

  // El mkdir va FUERA de la sección crítica (patrón `session-end.js:325`): no necesita el lock, y
  // en la rama fail-open el lock puede no haberse tomado nunca (Pitfall 9). `acquireLock` también
  // crearía el directorio del lockfile hermano, pero ese regalo no cubre el camino fail-open.
  try {
    mkdirSync(dirname(inboxPath), { recursive: true });
  } catch {
    return { ok: false, reason: 'fs' };
  }

  /** @type {{ ok: true, value: void } | { ok: false, reason: 'lock-timeout' }} */
  let r;
  try {
    r = withFileLock(lockPath, () => appendLine(inboxPath, line), {
      logger: { warn: () => {} },
    });
  } catch {
    // `acquireLock` propaga los errores de fs que no son EEXIST, y el `fn()` bajo lock propaga los
    // suyos. Ambos son fallos de filesystem, nunca de coordinación → NO se hace fail-open aquí:
    // el lock se tomó (o el disco está roto) y reintentar a ciegas solo duplicaría el fallo.
    return { ok: false, reason: 'fs' };
  }

  if (r.ok) return { ok: true, coordinated: true };

  try {
    appendLine(inboxPath, line);
  } catch {
    return { ok: false, reason: 'fs' };
  }
  warn('[kodo:inbox] lock-timeout — captura appendeada sin coordinación (fail-open)\n');
  return { ok: true, coordinated: false };
}

/**
 * Destino REAL de la publicación del marcado y modo a preservar (WR-01).
 *
 * `writeFileSync` + `renameSync` publica un inodo NUEVO. Sin resolver el symlink, el primer
 * marcado sobre un `~/.kodo/inbox.md` enlazado a un dotfiles lo SUSTITUYE por un fichero regular:
 * a partir de ahí el destino del operador queda congelado y kodo escribe en otro sitio, sin aviso.
 * Y sin preservar el modo, un `chmod 600` explícito del operador vuelve a 0644 en el primer
 * marcado — D-20 dice que el inbox no es un secreto, pero degradar en silencio una decisión
 * explícita del operador es otra cosa.
 *
 * Precedente del repo: `src/gsd/lock.js:190-205` resuelve el destino real antes de operar sobre
 * él por la divergencia de paths por symlink de macOS.
 *
 * NEVER-THROWS: ambas sondas van en `try/catch`.
 *   - `target`: el destino real; ante cualquier error (fichero aún inexistente, symlink roto)
 *     degrada al propio `inboxPath`.
 *   - `mode`: los 9 bits bajos del modo actual; ante cualquier error, `undefined` (fichero nuevo
 *     → que decida el umask, D-20).
 *
 * @param {string} inboxPath
 * @returns {{ target: string, mode: number | undefined }}
 */
function resolvePublishTarget(inboxPath) {
  let target = inboxPath;
  try {
    target = realpathSync(inboxPath);
  } catch {
    /* no existe aún / symlink roto → publicar sobre el propio path */
  }
  /** @type {number | undefined} */
  let mode;
  try {
    mode = statSync(target).mode & 0o777;
  } catch {
    mode = undefined;
  }
  return { target, mode };
}

/**
 * Cierra una captura por ID: `enrutada` (con trace pointer opcional) o `descartada`.
 *
 * **Cerrar NO es borrar (CAPT-03).** La línea sigue en el fichero con su id, texto, tag, fecha y
 * origen intactos; solo cambia el checkbox y se añade el sufijo de estado. No existe ninguna ruta
 * de borrado en este módulo: la traza permanente ES el feature.
 *
 * Estructura (clona el template canónico del repo, `src/hooks/session-end.js:325-391`, fix WR-02):
 *
 *   1. TODO el cuerpo va dentro de `withFileLock`. El logger inyectado silencia el warn genérico
 *      de la primitiva; el mensaje accionable lo emite el handler CLI a partir del `reason`.
 *   2. Lectura FRESCA dentro del lock. Leer ANTES de entrar sería exactamente el lost-update que
 *      D-01 cierra: una captura concurrente appendeada entre la lectura y el rename desaparecería.
 *   3. Round-trip EXACTO `split('\n')` / `join('\n')`. Sin recorte previo del contenido y sin
 *      descartar las líneas vacías: eso destruiría los separadores en blanco del markdown y el
 *      newline final, violando D-04. El array se reconstruye tal cual llegó.
 *   4. Localización POR ID recorriendo el array y parseando cada elemento — jamás por índice ni
 *      por offset de bytes: el fichero es human-editable y las posiciones no son estables (D-06).
 *      Ante ids duplicados gana la PRIMERA (contrato 5, sin reintento en la generación).
 *   5. Se sustituye SOLO ese elemento del array. Ningún otro se toca, así que toda línea ajena
 *      —incluidas las que NO parsean y las vacías— sobrevive BYTE A BYTE (D-04).
 *   6. Publicación con tmp de nombre ÚNICO + `renameSync`.
 *
 * **`already-closed` cubre los DOS cierres** (contrato 2): la cerrada con sufijo y la hand-editada
 * a `- [x]` sin sufijo. El checkbox es la autoridad. En ambos casos no se reescribe NADA.
 *
 * **Asimetría deliberada con `appendCapture` (contrato 3): el marcado NO hace fail-open.** Ante
 * `lock-timeout` devuelve `{ok:false, reason:'lock-timeout'}` sin tocar el fichero. Un marcado sin
 * coordinación reintroduce el lost-update que D-01 cierra; una captura sin coordinación solo
 * arriesga una ventana residual de milisegundos ya documentada y aceptada (D-03).
 *
 * ## Guard compare-and-swap: el invariante depende del ESTADO DEL FICHERO, no del reloj (GAP-1)
 *
 * El lock por sí solo NO impide el lost-update, porque el fail-open de D-03 appendea
 * DELIBERADAMENTE fuera de coordinación: un `renameSync` construido sobre una lectura anterior a
 * ese append lo borraría. Subir el presupuesto de reintentos de la captura tampoco lo cierra —
 * solo mueve el umbral, y el TTL del lock es de 10 s (`state-lock.js:36`), así que cualquier
 * titular vivo que se atasque abre la ventana durante segundos.
 *
 * Por eso el RMW compara ESTADO antes de publicar. El baseline se toma así, y el ORDEN es la
 * parte crítica:
 *
 *   - **bytes: de la LECTURA**, `Buffer.byteLength(raw, 'utf-8')`. JAMÁS del `size` de un
 *     `statSync` tomado por separado: un append que aterrice entre el `readFileSync` y ese stat
 *     entraría en el baseline y el guard quedaría CIEGO justo ante el caso que debe detectar.
 *   - **inodo: del destino**, tomado inmediatamente después de la lectura.
 *
 * Y la comprobación va **tras escribir el tmp y justo antes del `renameSync`**, contra un
 * `statSync` FRESCO. Como los appends solo pueden hacer CRECER el fichero y ningún otro marcado
 * puede publicar (todos toman el lock), `size !== bytesLeídos` detecta cualquier append —
 * coordinado o fail-open— que haya aterrizado en la ventana. El `ino` cubre el otro caso: una
 * publicación por rename de un tercero (un editor humano, o un marcado que robó el lock tras su
 * TTL) con el mismo tamaño. Si el guard detecta cambio, el tmp se borra y el RMW se REHACE con una
 * lectura nueva, hasta `MARK_RMW_ATTEMPTS` veces.
 *
 * `mtimeMs` queda FUERA de la comparación a propósito: es redundante (todo append cambia el
 * tamaño) y un `touch` produciría reintentos espurios. No «completar» esto más tarde.
 *
 * **Ventana residual, declarada sin adornos.** Entre el `statSync` de comprobación y el
 * `renameSync` quedan dos syscalls adyacentes. NINGÚN lock puede cerrar ese hueco mientras D-03
 * mantenga el append fail-open fuera de coordinación; este guard NO lo cierra y no debe leerse
 * como si lo hiciera. Lo que cambia es la magnitud: la ventana pasa de ser toda la sección crítica
 * del marcado (segundos, si el titular se atasca) a ser el hueco entre dos syscalls contiguos, y
 * deja de depender de ningún presupuesto de tiempo.
 *
 * **Degradación conservadora conocida.** Si el fichero contiene bytes que NO son UTF-8 válido,
 * `readFileSync(…, 'utf-8')` los sustituye por U+FFFD y `Buffer.byteLength` deja de igualar al
 * `size` de forma PERMANENTE: el marcado agota los intentos y devuelve `concurrent-write` sin
 * tocar nada. Es deliberado y es la dirección correcta del fallo — publicar habría reescrito esos
 * bytes ajenos como mojibake, violando la preservación byte a byte de D-04. El operador ve un
 * fallo ruidoso en vez de una corrupción silenciosa.
 *
 * @param {string} id
 * @param {'enrutada' | 'descartada'} estado
 * @param {{
 *   dest?: string | null,
 *   inboxPath: string,
 *   lockPath: string,
 *   _afterReadFn?: () => void,
 * }} o — `_afterReadFn` es el seam de inyección del test de concurrencia de D-21.2: permite
 *   ensanchar la ventana lectura→rename de forma determinista SIN código de test en producción.
 *   Se invoca dentro del lock, tras la lectura fresca y antes de publicar. Solo en el PRIMER
 *   intento: si se disparase en cada uno, el hold del test se multiplicaría por
 *   `MARK_RMW_ATTEMPTS` y el escenario dejaría de converger. Default no-op.
 * @returns {{ ok: true, capture: Capture }
 *          | { ok: false, reason: 'not-found' | 'already-closed' | 'lock-timeout'
 *                              | 'concurrent-write' | 'fs' }}
 *   `concurrent-write` es REINTENTABLE: el marcado no se aplicó y el fichero quedó intacto, así
 *   que repetir la operación es seguro.
 */
export function markCapture(id, estado, { dest = null, inboxPath, lockPath, _afterReadFn }) {
  /** @type {{ ok: true, value: any } | { ok: false, reason: 'lock-timeout' }} */
  let r;
  try {
    r = withFileLock(
      lockPath,
      () => {
        // El bucle vive DENTRO de la misma toma del lock: no se suelta ni se retoma entre
        // intentos. El lock sigue protegiendo contra otros marcados; lo que se reintenta es la
        // lectura frente a los appends descoordinados de D-03.
        for (let attempt = 0; attempt < MARK_RMW_ATTEMPTS; attempt++) {
          if (!existsSync(inboxPath)) return { ok: false, reason: 'not-found' };

          /** @type {string} */
          let raw;
          try {
            raw = readFileSync(inboxPath, 'utf-8');
          } catch {
            return { ok: false, reason: 'fs' };
          }

          // Baseline del guard. Los bytes salen de la LECTURA (ver el JSDoc: un stat separado
          // absorbería un append que la lectura no vio); el inodo, del destino, justo después.
          const baseBytes = Buffer.byteLength(raw, 'utf-8');
          // Destino REAL (symlink resuelto) y modo del operador: la publicación por rename debe
          // conservar ambos (WR-01). Se resuelve por intento porque un tercero puede haber
          // republicado el fichero entre dos vueltas del bucle.
          const { target, mode } = resolvePublishTarget(inboxPath);
          /** @type {number | null} */
          let baseIno = null;
          try {
            baseIno = statSync(target).ino;
          } catch {
            baseIno = null; // sin componente de inodo; el de tamaño sigue vigente
          }

          // Round-trip exacto: `join('\n')` reconstruye byte a byte, incluido el terminador.
          const lines = raw.split('\n');

          let idx = -1;
          /** @type {Capture | null} */
          let found = null;
          for (let i = 0; i < lines.length; i++) {
            const c = parseLine(lines[i]);
            if (c && c.id === id) {
              idx = i;
              found = c;
              break;
            }
          }

          // Terminales: no son condiciones de carrera, así que NO consumen intentos.
          if (idx === -1 || !found) return { ok: false, reason: 'not-found' };
          if (found.open === false) return { ok: false, reason: 'already-closed' };

          /** @type {Capture} */
          const updated = { ...found, open: false, estado, dest: dest ?? null };
          const encoded = encodeLine(updated);
          lines[idx] = encoded;
          // WR-07: se devuelve lo PERSISTIDO, re-parseado de la línea realmente escrita. `updated`
          // guarda el `dest`/`text` CRUDOS y `encodeLine` los sanea y recorta, así que devolverlo
          // haría que la confirmación del CLI anunciara un trace pointer que no está en el
          // fichero. El objeto pre-saneo solo queda como último recurso.
          const persisted = parseLine(encoded) ?? updated;
          const out = lines.join('\n');

          if (attempt === 0 && typeof _afterReadFn === 'function') _afterReadFn();

          // tmp+rename con nombre ÚNICO por escritor — patrón de `session-end.js:374` /
          // `state.js:280` (fix WR-02). NO se usa `writeFileAtomic` de `config.js`, ni siquiera
          // bajo el lock: (a) su tmp es de nombre FIJO (`path + '.tmp'`), compartido entre
          // escritores, y el lock es ROBABLE tras su TTL de 10 s (`state-lock.js:36`), así que dos
          // marcados podrían pisarse bytes parciales (Pitfall 2); (b) su heurístico de secretos
          // chmodearía el inbox a 0600 contra D-20. El invariante está en `.planning/STATE.md:100`
          // §Critical Invariants — y aquí es inalcanzable por construcción: este módulo no importa
          // `config.js`.
          //
          // ORDEN INAMOVIBLE: escribir el tmp → stat FRESCO del destino → comparar → renombrar.
          // Comparar ANTES de escribir el tmp dejaría fuera de la ventana vigilada el propio coste
          // de la escritura, que es la parte más cara del paso.
          const tmp = target + '.tmp.' + process.pid + '.' + randomUUID();
          /** @type {'published' | 'stale' | 'fs'} */
          let outcome;
          try {
            writeFileSync(tmp, out);
            // El modo va por `chmodSync` explícito, no por la opción de escritura: esa queda
            // sujeta al umask del proceso y no reproduce exactamente un 0600 del operador.
            if (mode !== undefined) chmodSync(tmp, mode);

            let changed;
            try {
              const st = statSync(target);
              changed = st.size !== baseBytes || (baseIno !== null && st.ino !== baseIno);
            } catch {
              changed = true; // conservador: si no se puede comprobar, NO se publica
            }

            if (changed) {
              rmSync(tmp, { force: true }); // sin residuo de tmp perdido
              outcome = 'stale';
            } else {
              renameSync(tmp, target);
              outcome = 'published';
            }
          } catch {
            rmSync(tmp, { force: true });
            outcome = 'fs';
          }

          if (outcome === 'published') return { ok: true, capture: persisted };
          if (outcome === 'fs') return { ok: false, reason: 'fs' };
          // 'stale' → rehacer el RMW con una lectura nueva.
        }

        // Techo agotado: el fichero queda INTACTO y el fallo es ruidoso. Nunca un clobber.
        return { ok: false, reason: 'concurrent-write' };
      },
      { logger: { warn: () => {} } },
    );
  } catch {
    // Error de filesystem propagado por `acquireLock` (código != EEXIST). Nunca es una condición
    // de coordinación, así que no se reintenta.
    return { ok: false, reason: 'fs' };
  }

  // Lock ocupado → SIN fail-open (contrato 3). El fichero queda intacto y el caller mapea el
  // `reason` a su exit code (D-13).
  if (!r.ok) return { ok: false, reason: 'lock-timeout' };
  return r.value;
}
