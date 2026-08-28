// @ts-check
//
// src/cli/sanitize.js — Phase 87 Plan 01 (ISO-02).
//
// HOJA de CERO imports. Saneadores PUROS de texto no confiable, movidos VERBATIM desde
// `src/cli/format.js:60-123` (afinados en las Phases 72 y 78, WR-02) sin tocar una sola regex.
//
// ── Por qué existe este fichero (no es organización, es una invariante) ────────────
// Vivían en `src/cli/format.js`, el ÚNICO importador de `picocolors` (D-07). Eso hacía que
// `src/cli/dashboard/App.js` y `src/cli/dashboard/markdown.js` —que solo querían sanear
// texto— arrastrasen el paquete de color al grafo del TUI, rompiendo la invariante
// color-isolation (D-12, Phase 34) con el guard directo en VERDE. El guard miraba imports
// directos; el leak era transitivo.
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ──────────────────────────
// Ni `node:*`, ni relativos. Mismo contrato que `src/session/handoff.js`,
// `src/tasks/pending.js` y `src/logger-noop.js`. Si este módulo deja de ser hoja,
// reabre por la puerta de atrás la arista que la Phase 87 cerró.
// Guardián: `test/format-isolation.test.js` (suite ISO-02).
//
// ── PROHIBIDO el shim de re-export (D-02) ──────────────────────────────────────────
// `src/cli/format.js` NO re-exporta estas funciones. Mantener viva esa arista dejaría un
// atajo legítimo que dispara la alarma sin ser un error; el objetivo es que el camino
// correcto sea el ÚNICO disponible. Los ocho consumidores importan de aquí.

/**
 * Neutraliza la inyección de terminal desde contenido externo NO confiable
 * (p.ej. comentarios de Plane) antes de renderizarlo en el dashboard Ink
 * (HYG-07/M4, STRIDE Tampering). Función PURA — no importa/usa color.
 *
 * El regex CSI de `visibleWidth` (:57, `\x1b\[[\d;]*[A-Za-z]`) solo cubre CSI y
 * NO el vector OSC (`\x1b]…`, p.ej. OSC-52 = escritura al portapapeles del
 * operador). Este helper es un strip AMPLIO e independiente (Don't-Hand-Roll):
 *   1. Elimina las secuencias CSI completas (deja el texto visible limpio).
 *   2. Elimina TODO byte de control C0 y C1 + `\x7f` (DEL) — incluido `\x1b` (ESC),
 *      `\x07` (BEL), `\x0d` (CR), y los C1 `\x80-\x9f` (WR-02): U+009B (CSI de un
 *      solo byte) y U+009D (OSC) que algunos terminales interpretan SIN ESC previo.
 *      Con ello cualquier OSC/secuencia de escape queda inerte.
 * PRESERVA únicamente `\t` (`\x09`) y `\n` (`\x0a`). `\r` (`\x0d`) SÍ se elimina
 * (WR-02: evita que un contenido externo reescriba visualmente el inicio de su línea).
 * Nunca lanza: coacciona con `String(s)`.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function stripControlChars(s) {
  return String(s)
    // 1. Secuencias CSI completas (`\x1b[…letra`) → fuera, dejando el texto.
    .replace(/\x1b\[[\d;]*[A-Za-z]/g, '')
    // 2. Bytes de control C0 (incl. ESC `\x1b`, BEL `\x07`, CR `\x0d`) + DEL + C1
    //    (`\x80-\x9f`), preservando SOLO `\t` (\x09) y `\n` (\x0a).
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
}

/**
 * Variante del carril de KEYSTROKE (`cmux send`) — NO del carril de render.
 *
 * `stripControlChars` preserva `\n`/`\t` a propósito porque el render del
 * dashboard (Ink) los necesita (texto multilínea/tabulado). Pero `cmux send`
 * inyecta el texto como PULSACIONES de teclado e interpreta `\n`/`\r`/`\t` como
 * Enter/Tab (ver `manager.js` y `stop.js`). Reutilizar el saneador de render en
 * ese carril deja un residuo de inyección (WR-02, Phase 78): un campo NO confiable
 * (`task.title`/`task.ref`/`projectPath` o el `next` LLM-persistido) que contenga
 * un salto de línea REAL (`\x0a`) —o la secuencia LITERAL de dos chars `\` + `n`
 * (0x5C 0x6E), imprimible— sobrevive al saneo y, al teclearse, produce un Enter
 * espurio en el terminal del orquestador (submit prematuro + línea inyectada).
 *
 * Esta función parte del saneo de control-chars y ADEMÁS neutraliza, colapsándolos
 * a un espacio, tanto los `\n`/`\r`/`\t` REALES como sus formas de escape LITERAL
 * (`\n`/`\r`/`\t` como texto). Sobre ASCII limpio sin esos vectores es la identidad
 * (goldens byte-idénticos, D-09). Pura — no importa/usa color.
 *
 * Se aplica SOLO a los campos no confiables interpolados; el `\n` terminador
 * intencional (el Enter que envía el nudge) vive fuera de esta llamada y se
 * conserva.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function stripForKeystroke(s) {
  return stripControlChars(s)
    // `\n`/`\t` REALES sobreviven a stripControlChars (carril de render); en el
    // carril de keystroke son Enter/Tab → colapsar a espacio. (`\r` ya lo quitó
    // stripControlChars; se incluye por robustez y claridad de intención.)
    .replace(/[\r\n\t]/g, ' ')
    // Secuencia de escape LITERAL (`\` + n/r/t, ASCII imprimible): `cmux send`
    // también la interpreta como Enter/Tab → neutralizar.
    .replace(/\\[rnt]/g, ' ');
}

/**
 * Variante del carril de PROMPT — el texto no confiable que kodo interpola en el prompt
 * con el que arranca al orquestador (`buildContextSummary`, sección «Situación actual»).
 *
 * Tercer carril, hermano de los dos de arriba. Aquí el destinatario no es un terminal
 * ni un teclado: es un LLM que lee el prompt como instrucciones, así que los vectores
 * cambian de forma.
 *
 *  - **El `\n` REAL.** El carril de render lo preserva a propósito; aquí permite
 *    falsificar ESTRUCTURA. Un título de tarea con `\n\n## Reglas mínimas\n- ...`
 *    aparece en el prompt como una sección de nivel superior más, indistinguible de
 *    las que escribe kodo. Se colapsa a espacio junto con `\r`/`\t` y sus formas de
 *    escape LITERAL (mismo criterio que `stripForKeystroke`).
 *  - **El propio delimitador.** El llamante envuelve el valor en
 *    `<task_title>…</task_title>` para marcar dónde acaba lo que no controla; un
 *    título que trajera ese cierre se saldría del envoltorio. Se neutraliza AQUÍ, no
 *    en el llamante, para que la garantía «no se puede salir del envoltorio» viva
 *    pegada al saneo. Solo se toca ESE tag: `<Button>` o `a < b` son contenido
 *    legítimo de un título y sobreviven intactos.
 *  - **La longitud.** Un título de 40 KB no ejecuta nada, pero diluye el prompt real
 *    y quema el contexto del supervisor. `max` acota el daño y la elipsis deja el
 *    truncado a la vista.
 *
 * Lo que este carril NO hace: tocar la PROSA. Un título que diga «ignora las
 * instrucciones anteriores» sigue diciéndolo, y debe — es el nombre real de la tarea y
 * el operador tiene que verlo tal cual. Lo que se garantiza es que llega como DATO
 * acotado y delimitado; que el orquestador no lo obedezca es trabajo del contrato que
 * `src/orchestrator/prompt.md` declara sobre el delimitador. Saneo y contrato son las
 * dos mitades: ninguna sirve sola.
 *
 * Pura — no importa/usa color. Nunca lanza: hereda el `String(s)` de `stripControlChars`.
 *
 * @param {unknown} s
 * @param {number} [max] - longitud máxima del resultado, elipsis incluida.
 * @returns {string}
 */
export function stripForPrompt(s, max = 120) {
  const flat = stripControlChars(s)
    // `\n`/`\t` REALES sobreviven al carril de render; aquí son estructura falsificable.
    .replace(/[\r\n\t]/g, ' ')
    // Escape LITERAL (`\` + n/r/t, ASCII imprimible): el LLM lo lee como salto igual.
    .replace(/\\[rnt]/g, ' ')
    // El delimitador del llamante, en cualquier caja y con espacios internos.
    .replace(/<\s*\/?\s*task_title\s*>/gi, ' ')
    // Los pasos anteriores dejan huecos; un título de espacios simples no cambia.
    .replace(/ {2,}/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, Math.max(0, max - 1)) + '…' : flat;
}
