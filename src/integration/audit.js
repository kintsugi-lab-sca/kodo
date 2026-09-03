// @ts-check
//
// src/integration/audit.js — KODO-74: el audit gate.
//
// EL PROBLEMA. KODO-69 verifica el ARTEFACTO con herramientas: compila, pasan los tests, el
// lint calla, el diff cae dentro del alcance declarado. Es evidencia ejecutada, y es real. Pero
// hay una clase de fallo que ninguna herramienta ve: el requisito del enunciado que nadie
// implementó, el caso límite que no se consideró, el «pasan los tests» sobre tests que no
// cubren lo pedido. Contra eso no hay comando que correr — hace falta que ALGUIEN vuelva a
// leer. Este módulo compra ese turno de relectura, y lo compra en el instante exacto: justo
// antes de que la sesión cierre y encole su trabajo.
//
// ── DE DÓNDE SALE, Y QUÉ SE LE CAMBIÓ ────────────────────────────────────────────────
//
// El mecanismo original es el de swarm-forge (`swarm_handoff.bb:460-474`): la primera
// invocación válida de la puerta de entrega NO encola nada — calcula un fingerprint del
// candidato, lo persiste, incrementa un contador y imprime `AUDIT_REQUIRED` con criterios
// concretos de auto-revisión. Solo la segunda invocación, con el fingerprint idéntico, encola.
//
// Y ahí está su agujero, que hay que decir en voz alta porque decide el diseño de este fichero:
// su parte determinista solo verifica QUE INVOCASTE DOS VECES CON LOS MISMOS BYTES. No verifica
// que auditaras. Un agente que recibe `AUDIT_REQUIRED` y vuelve a teclear el comando pasa el
// gate en dos segundos sin haber leído una línea. Lo que el mecanismo compra de verdad es meter
// el texto de auditoría en la ventana de contexto en el momento correcto — inyección de prompt
// oportuna, no verificación.
//
// LA ADAPTACIÓN que lo hace verificable, y es la única diferencia sustantiva: el segundo intento
// tiene que traer ALGO DISTINTO. O un commit nuevo (arreglaste lo que encontraste), o un
// artefacto de auditoría firmado contra el fingerprint del reto (incluido el «sin hallazgos»,
// que así CUESTA algo: hay que escribirlo, y hay que escribirlo para ESTE reto). Sin ese
// requisito el gate es un doble tecleo y el `audit_count` no significa nada.
//
// ── LOS TRES ESTADOS, Y POR QUÉ SON TRES ─────────────────────────────────────────────
//
//   `audit: null`                 — SIN AUDITAR. Nadie corrió el gate sobre esta rama.
//   `audit.status: 'pending'`     — se abrió un reto y NUNCA se cerró. Se pidió la segunda
//                                   pasada y no llegó evidencia de que ocurriera.
//   `audit.status: 'audited'`     — hubo segunda pasada CON evidencia (commit o artefacto).
//
// Es la misma regla del oráculo y por la misma razón: `sin auditar` ≠ `auditado sin hallazgos`.
// Un gate que colapsara los dos en «verde» estaría pintando de verde justo lo que nadie miró.
// `findings: 0` es una afirmación firmada; `null` es la ausencia de afirmación.
//
// ── NO BLOQUEANTE POR DEFECTO ────────────────────────────────────────────────────────
// Sin el comando, el comportamiento actual queda intacto: la entrada se encola igual, marcada
// como sin auditar. `kodo integrate --require-audit` es el gate explícito, opt-in, espejo de
// `--require-oracle`. Un gate que molesta acaba apagado, y un gate apagado es peor que ninguno
// porque además da la falsa sensación de que algo vigila.
//
// ── FAIL-OPEN / NEVER-THROWS ─────────────────────────────────────────────────────────
// Ninguna función pública de este módulo lanza. Las puras son TOTALES (toda entrada tiene
// salida) y las del store devuelven uniones discriminadas. El audit gate no puede impedir que
// una sesión cierre ni que el operador integre lo que quiera integrar.

import { createHash } from 'node:crypto';
import { noopLogger } from '../logger-noop.js';
import { loadState, withStateLock } from '../session/state.js';
import { entryKey } from './queue.js';

/**
 * Versión del bloque de artefacto. Va DENTRO del marcador (`v=1`) por el mismo motivo que en
 * `kodo:scope` y `kodo:handoff`: un cambio de formato futuro no puede romper en silencio los
 * artefactos ya escritos — se distinguen por la versión, no por adivinación.
 */
export const AUDIT_VERSION = 1;

/**
 * El marcador del artefacto de auditoría, y CONTRATO DE PARSING (lo pinean los tests y lo
 * imprime el propio comando, ver `renderAuditRequired`).
 *
 *   <!-- kodo:audit v=1 fp=<fingerprint> findings=<n> at=<ISO-8601 UTC> -->
 *
 * Comentario HTML, invisible en el render del markdown, con los tres datos que el núcleo
 * necesita y ni uno más: a QUÉ reto responde (`fp`), CUÁNTOS hallazgos hubo (`findings`) y
 * CUÁNDO se escribió (`at`, informativo). Los hallazgos en sí los lee un humano; este parser
 * decide un estado, no evalúa prosa.
 *
 * `fp` es lo que hace que el artefacto no se pueda copiar de otra tarea: firma ESTE reto.
 *
 * @type {RegExp}
 */
export const AUDIT_BLOCK_RE =
  /<!--\s*kodo:audit\s+v=(\d+)\s+fp=([0-9a-f]{8,64})\s+findings=(\d{1,6})(?:\s+at=([^\s>]+))?\s*-->/g;

/**
 * Tope de retos que se guardan en `state.audit_gates`.
 *
 * Un reto es un apunte EFÍMERO: vive entre la primera invocación de `kodo audit` y el cierre de
 * la sesión, que lo sella en la entrada de la cola y lo retira. La traza durable es esa entrada,
 * no esto. Pero una sesión que muere sin cerrar deja su reto huérfano, y sin tope el bloque
 * crecería sin límite en un fichero que el dashboard y la ronda del orquestador leen en cada
 * tick. 50 es el mismo número (y el mismo razonamiento) que `RESOLVED_CAP` y el cap de
 * `history`.
 */
export const GATE_CAP = 50;

/**
 * Directorio de los artefactos de auditoría, relativo a `~/.kodo`. Hermano de `plans/`, y por
 * la misma razón: es material de la SESIÓN que tiene que sobrevivir al worktree. Un artefacto
 * dentro del repo o se commitea (y entonces el «commit nuevo» ya cerraba el reto por su cuenta,
 * con lo que el artefacto no añadiría nada) o se lo lleva por delante el cleanup del worktree
 * al cerrar. Fuera del repo no tiene ninguno de los dos problemas.
 */
export const AUDITS_DIR = 'audits';

/**
 * Un reto de auditoría, tal y como se persiste y tal y como viaja a la entrada de la cola.
 *
 * Las 10 claves están SIEMPRE presentes y en este orden: el bloque se serializa tal cual en
 * `kodo integrate --json` y `kodo audit --json`, y la determinación byte a byte del `--json` es
 * invariante del repo (DX-06). Misma disciplina que `OracleResult` y que las 19 claves de
 * `IntegrationEntry`.
 *
 * @typedef {{
 *   status: 'pending'|'audited',
 *   count: number,                      // Retos ACUMULADOS sobre este candidato. «Esta rama necesitó 3 retos» es la señal.
 *   fingerprint: string,                // Identidad del reto vigente. Lo que firma el artefacto.
 *   evidence: 'commit'|'artifact'|null, // Qué cerró el reto. `null` mientras sigue abierto.
 *   findings: number|null,              // Hallazgos declarados en el artefacto. `null` = cerrado por commit, o sin cerrar.
 *   commit: string|null,                // Punta de la rama al CERRAR el reto. El ancla: si la rama avanza después, la auditoría queda desfasada.
 *   challenge_commit: string|null,      // Punta de la rama al ABRIR el reto. Comparar con la de ahora es el criterio de «commit nuevo».
 *   base_commit: string|null,           // §2.5: base del worktree al aceptar la tarea. Entra en el fingerprint.
 *   opened_at: string,                  // ISO 8601 del primer reto.
 *   audited_at: string|null,            // ISO 8601 del cierre. `null` mientras pending.
 * }} AuditGate
 */

/**
 * La decisión del gate. Unión discriminada, y TOTAL: no hay entrada que salga por un hueco sin
 * decisión.
 *
 * @typedef {{ action: 'challenge', reason: 'first'|'stale' }
 *          | { action: 'rechallenge' }
 *          | { action: 'audited', evidence: 'commit'|'artifact', findings: number|null }
 *          | { action: 'already-audited' }} AuditDecision
 */

// ─────────────────────────────────────────────────────────────────────────────────────
// NÚCLEO PURO
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Fingerprint del candidato. PURA y determinista.
 *
 * Los ocho campos son los de swarm-forge traducidos al vocabulario de kodo: quién entrega
 * (`session_id`), qué entrega (`task_id`/`task_ref`), dónde (`project_path`/`branch`), sobre qué
 * commit canónico (`head`), desde qué base nació (`base_commit`, el acompañante §2.5) y con qué
 * hay en el árbol de trabajo sin commitear (`dirty`).
 *
 * `dirty` importa y no es decorativo: uno de los criterios de la auto-revisión es mirar los
 * cambios NO RELACIONADOS del working tree, así que forman parte del candidato. Se pasa ya
 * hasheado por el caller (el output de `git status --porcelain`), no crudo: aquí no se guarda
 * ni se imprime jamás el contenido del árbol.
 *
 * La serialización es un ARRAY en orden fijo y no un objeto: `JSON.stringify` de un objeto
 * depende del orden de inserción de las claves, y dos llamadas con las mismas claves en distinto
 * orden darían fingerprints distintos para el MISMO candidato. Un array no tiene ese problema.
 *
 * @param {{
 *   session_id?: string|null, task_id?: string|null, task_ref?: string|null,
 *   project_path?: string|null, branch?: string|null, head?: string|null,
 *   base_commit?: string|null, dirty?: string|null,
 * }} input
 * @returns {string} sha256 en hex (64 caracteres).
 */
export function computeFingerprint(input) {
  const norm = (v) => (typeof v === 'string' && v !== '' ? v : null);
  const payload = JSON.stringify([
    'kodo:audit',
    AUDIT_VERSION,
    norm(input?.session_id),
    norm(input?.task_id),
    norm(input?.task_ref),
    norm(input?.project_path),
    norm(input?.branch),
    norm(input?.head),
    norm(input?.base_commit),
    norm(input?.dirty),
  ]);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Hash del estado sucio del árbol de trabajo. PURA.
 *
 * Entrada: el stdout de `git status --porcelain`. Salida: 16 hex, o `null` si no había nada que
 * hashear (árbol limpio). `null` y no el hash de la cadena vacía porque «limpio» es un hecho, no
 * un valor: participa del fingerprint como ausencia.
 *
 * @param {unknown} porcelain
 * @returns {string|null}
 */
export function hashWorkingTree(porcelain) {
  const s = String(porcelain ?? '').trim();
  if (s === '') return null;
  return createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Forma corta del fingerprint para pantalla. 12 hex — suficiente para que dos retos vivos no
 * colisionen a ojo, corto para caber en una línea. PURA.
 *
 * @param {unknown} fp
 * @returns {string}
 */
export function shortFingerprint(fp) {
  const s = typeof fp === 'string' ? fp : '';
  return s.slice(0, 12);
}

/**
 * Nombre del fichero de artefacto de una auditoría. PURA.
 *
 * `<task_id>.md` cuando la sesión tiene tarea — así el artefacto es un HISTORIAL de la tarea,
 * append-only, hermano de su plan, y se lee entero de una vez. Sin `task_id` (sesión adoptada o
 * no registrada) cae al fingerprint: sigue habiendo un fichero determinista al que apuntar, que
 * es lo único que el gate necesita.
 *
 * El caller ES quien valida que el `task_id` sea seguro para construir una ruta (`isSafeTaskId`,
 * el guard canónico del repo). Aquí NO se revalida: dos definiciones de «task_id seguro» que
 * discrepan sobre un path traversal son peores que una sola. Esta función solo elige el nombre.
 *
 * @param {{ taskId?: string|null, fingerprint?: string|null }} input
 * @returns {string}
 */
export function auditArtifactName({ taskId, fingerprint } = {}) {
  const id = typeof taskId === 'string' && taskId !== '' ? taskId : null;
  return `${id ?? shortFingerprint(fingerprint)}.md`;
}

/**
 * Lee el artefacto de auditoría y busca un bloque firmado contra `fingerprint`. PURA y TOTAL.
 *
 * GANA EL ÚLTIMO bloque que case, con el mismo criterio que `parseScopeBlock`: el fichero es
 * append-only por contrato, así que acumula una entrada por reto y por sesión, y la vigente es
 * la última.
 *
 * La comparación del `fp` es por PREFIJO en la dirección segura: el bloque puede traer el
 * fingerprint abreviado (es lo que el comando imprime), así que vale si el fingerprint completo
 * EMPIEZA por lo que trae el bloque, y solo con ≥8 hex — un `fp=a` casaría con casi cualquier
 * reto y eso es exactamente lo que el mínimo del regex impide.
 *
 * `findings` se acepta tal cual venga (0 incluido): el artefacto es una afirmación firmada, y
 * este parser no opina sobre cuántos hallazgos «debería» haber. Un `findings=0` es el «sin
 * hallazgos» que el diseño exige que cueste escribir.
 *
 * @param {unknown} md Contenido del artefacto (markdown de un LLM: entrada NO confiable).
 * @param {unknown} fingerprint Fingerprint COMPLETO del reto vigente.
 * @returns {{ findings: number, fp: string, at: string|null }|null} `null` si no hay bloque para este reto.
 */
export function parseAuditArtifact(md, fingerprint) {
  if (typeof md !== 'string' || md === '') return null;
  const fp = typeof fingerprint === 'string' ? fingerprint : '';
  if (fp === '') return null;

  /** @type {{ findings: number, fp: string, at: string|null }|null} */
  let hit = null;
  // El regex es global y este módulo lo comparte entre llamadas: `lastIndex` se resetea a mano
  // porque un `exec` previo lo deja donde paró y la siguiente llamada empezaría a mitad.
  AUDIT_BLOCK_RE.lastIndex = 0;
  for (let m = AUDIT_BLOCK_RE.exec(md); m !== null; m = AUDIT_BLOCK_RE.exec(md)) {
    if (Number(m[1]) !== AUDIT_VERSION) continue;
    const blockFp = m[2];
    if (!fp.startsWith(blockFp)) continue;
    const findings = Number.parseInt(m[3], 10);
    if (!Number.isFinite(findings) || findings < 0) continue;
    hit = { findings, fp: blockFp, at: m[4] || null };
  }
  AUDIT_BLOCK_RE.lastIndex = 0;
  return hit;
}

/**
 * QUÉ HACER con este candidato. PURA y TOTAL — el núcleo auditable del gate.
 *
 * Es la función que hace que el comando no tenga criterio propio: recibe el reto persistido, la
 * punta de la rama AHORA y el contenido del artefacto, y devuelve una acción. Cero I/O, cero
 * reloj, cero git. Que sea pura es lo que permite congelar el contrato entero en tests; que sea
 * total es lo que garantiza que ninguna combinación se cuele sin decisión.
 *
 * Las cuatro salidas:
 *
 *   `challenge/first`  — no hay reto. Se abre uno y NO se encola nada como auditado.
 *   `challenge/stale`  — hubo auditoría, pero la rama AVANZÓ después. La auditoría describía un
 *                        código que ya no es el código que hay, así que no vale: reto nuevo.
 *                        Es el mismo razonamiento que invalida un veredicto de oráculo
 *                        desfasado o una `review/approval.md` caducada.
 *   `rechallenge`      — hay reto abierto y el segundo intento NO trae nada nuevo. Aquí es donde
 *                        el gate deja de ser un doble tecleo: no se cierra, se vuelve a retar y
 *                        el contador sube.
 *   `audited`          — hay evidencia. El artefacto manda sobre el commit cuando están los dos,
 *                        porque dice MÁS: cuántos hallazgos hubo.
 *
 * @param {{ gate?: AuditGate|null, head?: string|null, artifactMd?: string|null }} input
 * @returns {AuditDecision}
 */
export function decideAudit({ gate, head, artifactMd } = {}) {
  const now = typeof head === 'string' && head !== '' ? head : null;

  if (!gate || typeof gate !== 'object') return { action: 'challenge', reason: 'first' };

  if (gate.status === 'audited') {
    // El ancla al commit. Sin punta legible (`now === null`) NO se inventa un desfase: se
    // respeta la auditoría que hay, que es el dato del que sí consta evidencia.
    if (now && typeof gate.commit === 'string' && gate.commit !== '' && gate.commit !== now) {
      return { action: 'challenge', reason: 'stale' };
    }
    return { action: 'already-audited' };
  }

  const art = parseAuditArtifact(artifactMd, gate.fingerprint);
  if (art) return { action: 'audited', evidence: 'artifact', findings: art.findings };

  const opened = typeof gate.challenge_commit === 'string' && gate.challenge_commit !== ''
    ? gate.challenge_commit
    : null;
  if (now && opened && now !== opened) {
    return { action: 'audited', evidence: 'commit', findings: null };
  }

  return { action: 'rechallenge' };
}

/**
 * El texto de `AUDIT_REQUIRED`: los criterios concretos de la segunda pasada, más las dos
 * únicas formas de cerrar el reto. PURA.
 *
 * ES LO QUE EL GATE COMPRA DE VERDAD, y por eso vive en código y no en el prompt del
 * orquestador: es determinista, se imprime siempre igual, y aterriza en la ventana de contexto
 * en el instante exacto en que sirve de algo — con el trabajo terminado y antes de entregarlo.
 * Un criterio vago («revisa tu trabajo») no encuentra nada; estos cuatro sí, porque cada uno
 * nombra una fuente que se puede abrir.
 *
 * `AUDIT_REQUIRED` va en la primera línea y es LITERAL DE CONTRATO: es lo que un script (o el
 * propio agente) grepea para saber que el gate no está satisfecho.
 *
 * @param {{
 *   taskRef: string, branch: string, fingerprint: string, count: number,
 *   base?: string|null, artifactPath?: string|null, at?: string,
 * }} input
 * @returns {string}
 */
export function renderAuditRequired({ taskRef, branch, fingerprint, count, base, artifactPath, at }) {
  const fp = shortFingerprint(fingerprint);
  // Con base conocida (§2.5: el commit del que nació el worktree) se puede dar el comando
  // EXACTO. Sin ella NO se adivina el nombre de la rama principal — kodo no lo hace en ningún
  // otro carril, y un rango sugerido sobre un repo cuya base no es `main` mandaría a auditar el
  // diff equivocado, que es peor que no dar el comando.
  const diffCmd = base ? `\`git diff ${base}...HEAD\`` : 'el diff completo de la rama contra su base';
  const lines = [
    `AUDIT_REQUIRED  ${taskRef}  ${branch}  fp=${fp}  (reto ${count})`,
    '',
    'Este trabajo NO se encolará como auditado todavía. Antes de cerrar la sesión, haz una',
    'segunda pasada sobre lo que vas a entregar:',
    '',
    '  1. Relee el enunciado de la tarea COMPLETO y sus fuentes (el plan, los comentarios).',
    '     No de memoria: ábrelos.',
    '  2. Traza cada requisito del enunciado a la evidencia que lo cumple — fichero y línea.',
    '     El requisito que no puedas señalar es el que falta.',
    `  3. Revisa el diff ENTERO de la rama: ${diffCmd}. No el resumen: el diff.`,
    '  4. Revisa los cambios no relacionados del working tree: `git status`. Lo que sobra',
    '     también entrega.',
    '  5. Arregla todo hallazgo antes de seguir.',
    '',
    'Cuando termines, el reto se cierra de UNA de estas dos formas (y solo de estas dos):',
    '',
    '  a) Commitea los arreglos y vuelve a ejecutar `kodo audit`.',
  ];
  if (artifactPath) {
    lines.push(
      `  b) Si no encontraste nada, añade este bloque al final de ${artifactPath} y vuelve`,
      '     a ejecutar `kodo audit`:',
      '',
      `## Auditoría ${count} <!-- kodo:audit v=${AUDIT_VERSION} fp=${fp} findings=0 at=${at || '<ISO-8601 UTC>'} -->`,
      '',
      '(una línea por hallazgo; `findings=0` afirma que no hubo ninguno)',
    );
  } else {
    lines.push(
      '  b) [no disponible: esta sesión no está registrada en kodo, así que no hay artefacto',
      '     donde firmar el «sin hallazgos». Solo un commit nuevo cierra el reto.]',
    );
  }
  lines.push(
    '',
    'Volver a ejecutar `kodo audit` sin ninguna de las dos NO cierra el reto: vuelve a retar y',
    'sube el contador, que es visible en `kodo integrate`.',
  );
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────────────
// STORE — `state.audit_gates`, siempre bajo `withStateLock`
// ─────────────────────────────────────────────────────────────────────────────────────

/**
 * La clave de un reto: el par (project_path, branch), la MISMA identidad con la que
 * `integration_queue` identifica una entrada. No es casualidad y no puede diferir: el reto que
 * abre `kodo audit` sobre una rama tiene que ser el que encuentra la captura al encolar ESA
 * rama. Por eso se REUSA `entryKey` de `queue.js` en vez de reescribirlo: dos definiciones de
 * «la misma rama» que discrepen dejarían retos que nadie recoge, y el separador NUL de ese
 * helper es lo único que hace la concatenación inyectiva (un espacio no valdría — las rutas de
 * macOS llevan uno a menudo).
 *
 * @param {{ project_path?: string, branch?: string }} e
 * @returns {string}
 */
export function gateKey(e) {
  return entryKey(e || {});
}

/**
 * Lectura defensiva del bloque de retos de un state ya cargado.
 * @param {any} state
 * @returns {Record<string, AuditGate>}
 */
function gatesOf(state) {
  const g = state?.audit_gates;
  return g && typeof g === 'object' && !Array.isArray(g) ? g : {};
}

/**
 * El reto vigente de una rama, o `null`. Lectura PURA — nunca escribe.
 *
 * NEVER-THROWS: un state.json ilegible es indistinguible de «no hay reto», y la respuesta
 * conservadora en los dos casos es la misma (se abre uno).
 *
 * @param {{ project_path: string, branch: string }} target
 * @param {{ loadStateFn?: typeof loadState }} [deps]
 * @returns {AuditGate|null}
 */
export function readAuditGate(target, deps = {}) {
  const load = deps.loadStateFn || loadState;
  try {
    const gate = gatesOf(load())[gateKey(target)];
    return gate && typeof gate === 'object' ? gate : null;
  } catch {
    return null;
  }
}

/**
 * Abre (o REABRE) un reto sobre una rama.
 *
 * `count` es ACUMULATIVO por rama y no se reinicia nunca mientras el reto viva: un
 * `rechallenge` lo sube, y un reto reabierto por desfase también. Ese número es la señal que el
 * operador lee en la cola — «esta rama necesitó 3 retos» dice algo sobre la rama que ningún
 * veredicto binario dice.
 *
 * El `fingerprint` lo decide el CALLER, y la distinción importa:
 *   - reto NUEVO (primero, o reabierto tras desfase) → fingerprint recién calculado;
 *   - RE-reto (el segundo intento no trajo nada) → se REUSA el del reto abierto. Si rotara, el
 *     artefacto que el agente acabara de escribir para el reto anterior dejaría de valer justo
 *     cuando lo presenta, y el gate sería imposible de satisfacer con un árbol de trabajo vivo.
 *
 * @param {{
 *   project_path: string, branch: string, fingerprint: string,
 *   challenge_commit?: string|null, base_commit?: string|null,
 * }} input
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: AuditGate } | { ok: false, reason: 'lock-timeout' }}
 */
export function openAuditChallenge(input, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {AuditGate|undefined} */
  let persisted;

  const r = withStateLock((state) => {
    // Guard defensivo de la clave aditiva — espejo de `if (!state.tasks) state.tasks = {}`.
    // Un state.json previo a KODO-74 no la trae.
    const raw = /** @type {any} */ (state);
    if (!raw.audit_gates || typeof raw.audit_gates !== 'object' || Array.isArray(raw.audit_gates)) {
      raw.audit_gates = {};
    }
    /** @type {Record<string, AuditGate>} */
    const gates = raw.audit_gates;
    const key = gateKey(input);
    const prev = gates[key];

    persisted = {
      status: 'pending',
      count: (prev && Number.isInteger(prev.count) && prev.count > 0 ? prev.count : 0) + 1,
      fingerprint: input.fingerprint,
      evidence: null,
      findings: null,
      commit: null,
      challenge_commit: input.challenge_commit ?? null,
      base_commit: input.base_commit ?? null,
      // `opened_at` se conserva: mide desde cuándo esta rama está pidiendo la segunda pasada,
      // no cuándo se emitió el último reto (que es lo que ya cuenta `count`).
      opened_at: prev?.opened_at || ts,
      audited_at: null,
    };
    gates[key] = persisted;
    pruneGates(gates);
  });

  if (!r.ok) {
    logger.warn('integration.audit.open_failed', { branch: input.branch, reason: r.reason });
    return r;
  }
  logger.info('integration.audit.challenged', {
    branch: input.branch,
    count: persisted?.count ?? null,
    fingerprint: shortFingerprint(input.fingerprint),
  });
  return { ok: true, value: /** @type {AuditGate} */ (persisted) };
}

/**
 * Cierra el reto de una rama como AUDITADO. Solo se llama con evidencia en la mano — este
 * módulo no la juzga, la registra (quien juzga es `decideAudit`, y es pura).
 *
 * `commit` es el ancla: la punta de la rama en el momento del cierre. Si la rama avanza después,
 * `decideAudit` lo ve y reabre. Sin ancla, una auditoría sería para siempre, que es justo lo que
 * no puede ser.
 *
 * @param {{ project_path: string, branch: string }} target
 * @param {{ evidence: 'commit'|'artifact', findings?: number|null, commit?: string|null }} patch
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @param {{ now?: () => Date }} [deps]
 * @returns {{ ok: true, value: AuditGate } | { ok: false, reason: 'lock-timeout'|'not-found' }}
 */
export function closeAuditChallenge(target, patch, logger = noopLogger, deps = {}) {
  const ts = (deps.now ? deps.now() : new Date()).toISOString();
  /** @type {AuditGate|undefined} */
  let persisted;
  let found = false;

  const r = withStateLock((state) => {
    const gates = gatesOf(state);
    const hit = gates[gateKey(target)];
    if (!hit) return;
    found = true;
    hit.status = 'audited';
    hit.evidence = patch.evidence;
    hit.findings = typeof patch.findings === 'number' && patch.findings >= 0 ? patch.findings : null;
    hit.commit = patch.commit ?? null;
    hit.audited_at = ts;
    persisted = hit;
  });

  if (!r.ok) {
    logger.warn('integration.audit.close_failed', { branch: target.branch, reason: r.reason });
    return r;
  }
  if (!found) return { ok: false, reason: 'not-found' };
  logger.info('integration.audit.audited', {
    branch: target.branch,
    evidence: patch.evidence,
    findings: persisted?.findings ?? null,
    count: persisted?.count ?? null,
  });
  return { ok: true, value: /** @type {AuditGate} */ (persisted) };
}

/**
 * Retira el reto de una rama. Lo llama la captura de integración DESPUÉS de sellarlo en la
 * entrada de la cola.
 *
 * Por qué se retira, si en este repo «una entrada nunca se borra»: porque la traza durable ES la
 * entrada de la cola, y este bloque es el apunte en vuelo. Dejarlo vivo tiene un fallo concreto:
 * la siguiente sesión sobre la misma rama encontraría un reto ya cerrado y —si no llegó a
 * commitear— pasaría el gate como «ya auditado» sin haber auditado nada. Cada sesión audita lo
 * suyo.
 *
 * @param {{ project_path: string, branch: string }} target
 * @param {import('../logger-noop.js').NoopLogger} [logger]
 * @returns {{ ok: true, value: boolean } | { ok: false, reason: 'lock-timeout' }}
 */
export function clearAuditGate(target, logger = noopLogger) {
  let removed = false;
  const r = withStateLock((state) => {
    const gates = gatesOf(state);
    const key = gateKey(target);
    if (Object.prototype.hasOwnProperty.call(gates, key)) {
      delete gates[key];
      removed = true;
    }
  });
  if (!r.ok) {
    logger.warn('integration.audit.clear_failed', { branch: target.branch, reason: r.reason });
    return r;
  }
  return { ok: true, value: removed };
}

/**
 * Evicta los retos más antiguos por encima de `GATE_CAP`. MUTA el objeto en sitio (corre dentro
 * del mutador del lock).
 *
 * El orden es por `opened_at`, no por orden de inserción: un objeto no garantiza orden estable
 * para claves que se borran y se vuelven a crear, y la edad del reto sí es un dato que está en
 * la fila. Una fecha ilegible ordena como la más antigua — la candidata correcta a irse.
 *
 * @param {Record<string, AuditGate>} gates
 */
function pruneGates(gates) {
  const keys = Object.keys(gates);
  if (keys.length <= GATE_CAP) return;
  const byAge = keys.sort((a, b) => {
    const ta = Date.parse(gates[a]?.opened_at || '') || 0;
    const tb = Date.parse(gates[b]?.opened_at || '') || 0;
    return ta - tb;
  });
  for (const k of byAge.slice(0, keys.length - GATE_CAP)) delete gates[k];
}
