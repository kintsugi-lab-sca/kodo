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
//   6. Marcado RMW bajo lock con unique-tmp + rename (`markCapture`, D-01/D-04).
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
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync,
  renameSync, rmSync, statSync, writeFileSync,
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
 * Presupuesto de reintentos del lock para la CAPTURA (`appendCapture`), en reintentos y ms de
 * backoff: 50 × 20 ms ≈ 1000 ms, frente al default de la primitiva (8 × 20 ms ≈ 160 ms).
 *
 * **Por qué NO vale el default (evidencia empírica, `test/inbox-concurrency.test.js`).** El
 * riesgo residual de D-03 no es teórico: con el marcado sosteniendo su ventana lectura→rename
 * durante 300 ms, las 6 capturas concurrentes agotaban los ~160 ms del default, entraban por la
 * rama fail-open, appendeaban SIN coordinación y el `renameSync` del marcado —construido sobre
 * una lectura anterior a esos appends— las borraba TODAS. Cero de 6 supervivientes. Ese es
 * exactamente el lost-update que D-01 cierra y que CAPT-03 criterio 3 prohíbe.
 *
 * El arreglo es el que D-03 y `83-CONTEXT.md:184` dejan escrito de antemano: **subir el
 * presupuesto de reintentos de la captura**, jamás debilitar el test de D-21.
 *
 * Coste en el camino feliz: **cero**. El presupuesto es un TECHO, no una espera: `acquireLock`
 * devuelve en cuanto obtiene el lock, y la sección crítica del marcado real (leer, sustituir una
 * línea, escribir el tmp, renombrar) es de sub-milisegundo. Solo se paga bajo contención real, y
 * lo que se compra es que la captura NO se pierda.
 *
 * El fail-open sigue existiendo y sigue acotado (D-03): agotados los ~1000 ms, la captura se
 * escribe igual. Una idea perdida sigue siendo peor que una línea sin coordinar; lo que cambia es
 * que ahora hace falta un titular patológico (>1 s sosteniendo el lock) para llegar ahí, en vez
 * de un marcado normal.
 */
const CAPTURE_LOCK_RETRIES = 50;
const CAPTURE_LOCK_BACKOFF_MS = 20;

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
 * Deriva el tag-proyecto desde el cwd (D-15). Reutiliza `resolveProjectId` (nearest-ancestor sobre
 * `projects.json`) — NO reimplementa su semántica.
 *
 * `resolveProjectId` tiene DOS modos de fallo, no uno: `{error:'none'}` y `{error:'ambiguous'}`
 * (Pitfall 3). La forma robusta es exigir la PRESENCIA de `projectId`; cualquier otro shape
 * (incluido uno inesperado de una futura refactorización) cae a `basename(cwd)`. Un tag no mapeado
 * es sencillamente el nombre del directorio desde el que se capturó: un solo campo, siempre
 * poblado, siempre informativo.
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
      return r.projectId;
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
 * **Fail-open ante `lock-timeout` (D-03).** Agotado el presupuesto (`CAPTURE_LOCK_RETRIES` ×
 * `CAPTURE_LOCK_BACKOFF_MS` ≈ 1000 ms), la captura se appendea IGUAL y se emite un warn
 * accionable. Principio GTD: una idea perdida es peor que una línea escrita sin coordinación.
 * **Riesgo residual ACEPTADO y acotado:** la captura solo puede perderse si el timeout coincide
 * además con la ventana lectura→rename de un marcado concurrente. Ese riesgo SE MATERIALIZÓ con
 * el presupuesto por defecto (ver `CAPTURE_LOCK_RETRIES` y `test/inbox-concurrency.test.js`), y
 * se cerró subiendo el presupuesto — que es el arreglo que D-03 prescribe. Nunca se debilita el
 * test de concurrencia de D-21.
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
      retries: CAPTURE_LOCK_RETRIES,
      backoffMs: CAPTURE_LOCK_BACKOFF_MS,
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
 * @param {string} id
 * @param {'enrutada' | 'descartada'} estado
 * @param {{
 *   dest?: string | null,
 *   inboxPath: string,
 *   lockPath: string,
 *   _afterReadFn?: () => void,
 * }} o — `_afterReadFn` es el seam de inyección del test de concurrencia de D-21.2: permite
 *   ensanchar la ventana lectura→rename de forma determinista SIN código de test en producción.
 *   Se invoca dentro del lock, tras la lectura fresca y antes de publicar; default no-op.
 * @returns {{ ok: true, capture: Capture }
 *          | { ok: false, reason: 'not-found' | 'already-closed' | 'lock-timeout' | 'fs' }}
 */
export function markCapture(id, estado, { dest = null, inboxPath, lockPath, _afterReadFn }) {
  /** @type {{ ok: true, value: any } | { ok: false, reason: 'lock-timeout' }} */
  let r;
  try {
    r = withFileLock(
      lockPath,
      () => {
        if (!existsSync(inboxPath)) return { ok: false, reason: 'not-found' };

        /** @type {string} */
        let raw;
        try {
          raw = readFileSync(inboxPath, 'utf-8');
        } catch {
          return { ok: false, reason: 'fs' };
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

        if (idx === -1 || !found) return { ok: false, reason: 'not-found' };
        if (found.open === false) return { ok: false, reason: 'already-closed' };

        /** @type {Capture} */
        const updated = { ...found, open: false, estado, dest: dest ?? null };
        lines[idx] = encodeLine(updated);
        const out = lines.join('\n');

        if (typeof _afterReadFn === 'function') _afterReadFn();

        // tmp+rename con nombre ÚNICO por escritor — patrón de `session-end.js:374` /
        // `state.js:280` (fix WR-02). NO se usa `writeFileAtomic` de `config.js`, ni siquiera bajo
        // el lock: (a) su tmp es de nombre FIJO (`path + '.tmp'`), compartido entre escritores, y
        // el lock es ROBABLE tras su TTL de 10 s (`state-lock.js:36`), así que dos marcados podrían
        // pisarse bytes parciales (Pitfall 2); (b) su heurístico de secretos chmodearía el inbox a
        // 0600 contra D-20. El invariante está en `.planning/STATE.md:100` §Critical Invariants —
        // y aquí es inalcanzable por construcción: este módulo no importa `config.js`.
        const tmp = inboxPath + '.tmp.' + process.pid + '.' + randomUUID();
        try {
          writeFileSync(tmp, out);
          renameSync(tmp, inboxPath);
        } catch {
          rmSync(tmp, { force: true }); // sin residuo de tmp perdido
          return { ok: false, reason: 'fs' };
        }

        return { ok: true, capture: updated };
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
