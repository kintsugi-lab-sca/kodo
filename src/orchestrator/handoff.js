// @ts-check
//
// src/orchestrator/handoff.js — KODO-67: el HANDOFF del orquestador saliente.
//
// EL PROBLEMA. Un orquestador de larga vida acumula contexto que no necesita. Medido el
// 01-sep sobre esta misma instalación: tras cuatro días de rondas, la sesión iba por el 72 %
// (683 k tokens de mensajes) con la única compactación ya gastada. Casi todo ese peso son
// SALIDAS DE HERRAMIENTAS históricas — `cat state.json` de hace tres días, `read-screen` de
// sesiones ya cerradas, diffs de PRs mergeados. El estado durable NO vive ahí: vive en el
// provider, en `state.json`, en git y en el NDJSON.
//
// Compactar es caro y con pérdida (resume TODO, incluido lo que ya no importa, y borra
// justo los ids calientes que sí). Reciclar es barato: un handoff pequeño + un orquestador
// fresco de ~15 k tokens. Este módulo es la mitad DURABLE de ese reciclado.
//
// ── EL FORMATO NO VIVE AQUÍ (invariante) ──────────────────────────────────────────────
// Qué secciones lleva el handoff lo define la skill `kodo-orchestrate` (§Reciclado), no
// este código. Aquí el fichero es TEXTO OPACO: se lee, se acota, se sanea y se pega. Esa
// es la razón de que el orquestador pueda cambiar el formato editando su skill sin tocar
// kodo — mismo criterio con el que el bloque de handoff por tarea (`session/handoff.js`)
// separa el CONTRATO del marcador de lo que el LLM escribe dentro.
//
// ── SANEO: `stripControlChars`, NO `stripForPrompt` ───────────────────────────────────
// El carril de prompt de KODO-38 (`stripForPrompt`) está pensado para CAMPOS no confiables
// que se interpolan dentro de una frase: colapsa `\n` a espacio y trunca a 120 chars.
// Aplicárselo a un fichero entero lo destruiría — el handoff ES multilínea y ESA es su
// forma. Lo que sí aplica es la capa de abajo, `stripControlChars`: mata CSI/OSC/C0/C1/DEL
// preservando `\n` y `\t`. La estructura Markdown sobrevive; una secuencia de escape
// inyectada, no.
//
// El vector que queda vivo a propósito es la PROSA: el handoff lo escribe el orquestador
// SALIENTE, o sea el mismo agente al que se le va a entregar. No es una frontera de
// confianza — es una nota que se deja a sí mismo. Lo que se acota es el tamaño (para que
// un fichero corrupto o gigante no se coma el contexto que el reciclado existe para
// liberar) y los bytes de control (para que no pueda reescribir el terminal por el camino,
// ya que el prompt viaja por `cmux send`).
//
// ── NEVER-THROWS DE CUERPO ENTERO ─────────────────────────────────────────────────────
// El consumidor es `launchOrchestrator`. Ni un fichero ilegible, ni un `rename` que falla,
// ni un disco lleno pueden impedir que el orquestador arranque: sin handoff arranca como
// siempre, que es exactamente el comportamiento anterior a KODO-67.

import { renameSync, readFileSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { kodoPath } from '../paths.js';
import { stripControlChars } from '../cli/sanitize.js';

/**
 * Ruta canónica del handoff. LAZY (función, no constante) por la misma razón que
 * `src/paths.js` documenta: `homedir()` congelado en module-load es una fuga que impide
 * aislar el HOME en un test.
 *
 * @returns {string} `~/.kodo/handoff.md`
 */
export function handoffPath() {
  return kodoPath('handoff.md');
}

/**
 * Cota DURA del handoff, en bytes. Por encima se ignora el fichero entero (no se trunca).
 *
 * 32 KB ≈ 8 k tokens. El número sale del objetivo: un orquestador reciclado debe arrancar
 * en ~15 k tokens contando su skill y su prompt, así que el handoff no puede pasar de un
 * tercio de eso sin devolver el problema que viene a resolver. Un handoff de 32 KB ya es
 * una señal de que el saliente está volcando historia en vez de estado.
 *
 * IGNORAR y no TRUNCAR es deliberado: un handoff cortado por la mitad es peor que ninguno
 * — el entrante lo leería como completo y actuaría sobre un estado a medias. El fichero se
 * queda en disco sin consumir, así que el operador lo ve y lo arregla.
 */
export const MAX_HANDOFF_BYTES = 32 * 1024;

/**
 * Encabezado con el que el handoff entra en el prompt del orquestador entrante.
 *
 * Es una sección de nivel `##`, igual que «Situación actual», y va DESPUÉS de ella: el
 * handoff es lo más fresco y lo más específico, y la recencia ayuda a que el entrante lo
 * trate como su punto de partida y no como anexo.
 */
export const HANDOFF_HEADING = '## Handoff del orquestador anterior';

/**
 * Lee el handoff si existe, cabe y tiene contenido. NEVER-THROWS.
 *
 * Devuelve `null` —no un discriminado— en los cuatro casos de «no hay handoff» porque el
 * consumidor no distingue entre ellos: sin handoff, arranca como siempre. La razón sí se
 * loguea, que es donde importa.
 *
 * @param {{ path?: string, maxBytes?: number, logger?: import('../logger-noop.js').NoopLogger }} [opts]
 * @returns {{ text: string, path: string, bytes: number }|null}
 */
export function readHandoff(opts = {}) {
  const path = opts.path || handoffPath();
  const maxBytes = typeof opts.maxBytes === 'number' ? opts.maxBytes : MAX_HANDOFF_BYTES;
  try {
    // `statSync` ANTES de leer: un fichero de 500 MB no debe entrar en memoria solo para
    // descubrir que se iba a descartar.
    const st = statSync(path);
    if (!st.isFile()) return null;
    if (st.size > maxBytes) {
      opts.logger?.warn?.('orchestrator.handoff.too_large', { bytes: st.size, max: maxBytes });
      return null;
    }
    const text = stripControlChars(readFileSync(path, 'utf-8')).trim();
    if (text === '') return null;
    return { text, path, bytes: st.size };
  } catch {
    // ENOENT es el camino NORMAL (no hay handoff pendiente), no un error que reportar.
    return null;
  }
}

/**
 * Pega el handoff al final del prompt. PURA — cero I/O, es la mitad testeable del módulo.
 *
 * Sin `text` (null / '' / no-string) devuelve el prompt IDÉNTICO, byte a byte. Ese es el
 * contrato que mantiene intactos los goldens del prompt del orquestador: el 100 % de los
 * arranques anteriores a KODO-67 pasa por esta rama.
 *
 * @param {string} prompt
 * @param {string|null|undefined} text
 * @returns {string}
 */
export function appendHandoff(prompt, text) {
  if (typeof text !== 'string' || text.trim() === '') return prompt;
  return `${prompt}\n\n${HANDOFF_HEADING}\n\n${text.trim()}\n`;
}

/**
 * Nombre del fichero consumido para un instante dado. PURO.
 *
 * Los `:` del ISO se sustituyen por `-`: son legales en APFS/ext4 pero el Finder de macOS
 * los presenta como `/`, y un nombre que se lee distinto de como se llama es una trampa
 * para el operador que va a mirar este directorio justo cuando algo ha ido mal.
 *
 * @param {Date} now
 * @returns {string} p.ej. `handoff-consumed-2026-09-01T09-48-15.123Z.md`
 */
export function consumedName(now) {
  return `handoff-consumed-${now.toISOString().replace(/:/g, '-')}.md`;
}

/**
 * Renombra el handoff a `handoff-consumed-<ts>.md`. NEVER-THROWS.
 *
 * RENOMBRA, no borra: el fichero es la única copia del razonamiento del saliente, y si el
 * entrante arranca mal el operador necesita poder leerlo. Además el rename es la garantía
 * de NO-REINYECCIÓN — sin él, cada relanzamiento del daemon volvería a pegar el mismo
 * handoff, cada vez más viejo, hasta que alguien lo borrase a mano.
 *
 * SE LLAMA DESPUÉS DEL SPAWN, no antes. Si el `send` al workspace falla, el handoff sigue
 * en su sitio y el siguiente intento lo vuelve a inyectar — que es lo correcto: el
 * orquestador entrante nunca llegó a leerlo.
 *
 * @param {string} path - ruta devuelta por `readHandoff`.
 * @param {{ now?: () => Date, logger?: import('../logger-noop.js').NoopLogger }} [deps]
 * @returns {{ ok: true, to: string } | { ok: false, reason: string }}
 */
export function consumeHandoff(path, deps = {}) {
  const now = deps.now ? deps.now() : new Date();
  // Al LADO del original, no en `kodoPath(...)` fijo: así el rename respeta la ruta que el
  // caller usó de verdad (un test con HOME aislado, un `path` inyectado) en vez de mover el
  // fichero a un directorio distinto del que se leyó.
  const to = join(dirname(path), consumedName(now));
  try {
    renameSync(path, to);
    deps.logger?.info?.('orchestrator.handoff.consumed', { to });
    pruneConsumed(dirname(path), deps);
    return { ok: true, to };
  } catch (err) {
    const reason = /** @type {Error} */ (err).message;
    deps.logger?.warn?.('orchestrator.handoff.consume_failed', { reason });
    return { ok: false, reason };
  }
}

/**
 * Cuántos `handoff-consumed-*.md` se conservan tras cada consume. Los consumidos son
 * forense (≤32 KB cada uno), pero sin rotación crecen uno por reciclado para siempre.
 */
export const MAX_CONSUMED_KEPT = 5;

/**
 * Borra los `handoff-consumed-*.md` más antiguos dejando los `MAX_CONSUMED_KEPT` más
 * recientes. NEVER-THROWS: el orden lo da el timestamp ISO del nombre (lexicográfico),
 * sin stat; un unlink que falla se loguea y no detiene el barrido.
 *
 * @param {string} dir
 * @param {{ logger?: import('../logger-noop.js').NoopLogger }} [deps]
 */
export function pruneConsumed(dir, deps = {}) {
  try {
    const stale = readdirSync(dir)
      .filter((f) => /^handoff-consumed-.*\.md$/.test(f))
      .sort()
      .slice(0, -MAX_CONSUMED_KEPT);
    for (const f of stale) {
      try {
        unlinkSync(join(dir, f));
        deps.logger?.info?.('orchestrator.handoff.pruned', { file: f });
      } catch (err) {
        deps.logger?.warn?.('orchestrator.handoff.prune_failed', {
          file: f,
          reason: /** @type {Error} */ (err).message,
        });
      }
    }
  } catch {
    // readdir que falla (dir ausente en tests, permisos): el prune es cosmético.
  }
}
