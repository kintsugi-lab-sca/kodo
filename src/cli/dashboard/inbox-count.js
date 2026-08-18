// @ts-check
//
// src/cli/dashboard/inbox-count.js — Phase 84 Plan 03 (CAPT-07; D-16..D-21).
//
// Leaf PURO, SÍNCRONO y NEVER-THROWS del conteo de capturas ABIERTAS de `~/.kodo/inbox.md`.
// Molde de la resolución HOME-relative y de la tríada de DI: `tasks.js:39-48`.
// Molde de la regex como constante de módulo: `progress.js:28-44`.
//
// PROHIBIDO importar `src/inbox/store.js`. Sería la opción obvia (cero duplicación del
// formato), y su argumento ORIGINAL (Phase 84) era el color: `store.js` traía
// `stripForKeystroke` de `../cli/format.js`, único importador de picocolors, así que un leaf
// del dashboard que importase el store metía el paquete de color en el grafo del TUI por vía
// transitiva — y el guard de entonces, que solo miraba los imports de primer nivel de cada
// fichero del dashboard, se habría quedado en VERDE mientras la invariante se erosionaba.
//
// Ese argumento ya NO se sostiene, y aquí se deja constancia en vez de arrastrarlo: la
// Phase 87 cortó la arista —los saneadores viven en `src/cli/sanitize.js`, hoja sin color, y
// la clausura de `store.js` ya no alcanza picocolors por ningún camino (medido)—.
//
// La prohibición SE MANTIENE, por la parte de su argumento que sigue siendo cierta:
// importar el store arrastraría `withFileLock` y `resolveProjectId` a un módulo que solo
// tiene que contar líneas. Una prohibición puede sobrevivir a que se evapore su premisa
// principal; lo que no puede es seguir apoyándose en ella.
//
// Quién la MIDE ahora: la suite ISO-06 de `test/format-isolation.test.js`, que asevera que la
// clausura de este fichero no contiene `src/inbox/store.js`. NO la cubre ISO-01: ISO-01 solo
// mide alcanzabilidad a `picocolors`, y `store.js` ya no lo alcanza — al cortar esa arista,
// esta fase le quitó de rebote a D-17 el único mecanismo que la detectaba, y ISO-06 es su
// reemplazo explícito. Una premisa que nadie mide es disciplina, no invariante.
//
// PROHIBIDO importar `src/config.js`: evalúa `homedir()` en el cuerpo del módulo
// (`config.js:11`) y esa fuga contamina los tests (lección de 83-01).
//
// Color-isolation (invariante D-12 de Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. Nada de este módulo llega al frame salvo un `number`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Especialización a línea ABIERTA de `LINE_RE` (`src/inbox/store.js:126`): la MISMA gramática,
 * restringida al checkbox abierto `- [ ]` y sin grupos de captura. No es un segundo parser del
 * formato — es leer el bit más estable del contrato.
 *
 * (a) **La duplicación es DELIBERADA** para no arrastrar el paquete de color al grafo del TUI
 *     por vía transitiva (ver cabecera del módulo, D-17).
 * (b) **La deriva la impide el test anti-drift** de D-18 (`test/dashboard-inbox-count.test.js`):
 *     sobre el mismo fixture, este conteo debe ser EXACTAMENTE igual al de
 *     `listCaptures(...).captures.filter(c => c.open).length`. Si alguien cambia una de las dos
 *     gramáticas sin la otra, la suite se pone roja.
 * (c) **El prefijo `/^- \[ \] / NO basta.** `~/.kodo/inbox.md` es human-editable por diseño
 *     (83 D-04/D-19: sin cabecera, lista pura de checklist markdown), así que un
 *     `- [ ] comprar leche` escrito a mano es el hand-edit MÁS probable, no un vector
 *     artificial — y el prefijo lo contaría como presión de triage falsa. Medido sobre el
 *     fixture adversarial de D-18: **prefijo 7, oráculo 2**; con esta regex, **2 y 2**.
 *     `parseLine` es `LINE_RE.exec()` y nada más, así que la equivalencia es exacta.
 * (d) **Coste ya medido, no optimizar:** décimas de milisegundo hasta 1 500 capturas
 *     (0,070 ms a 100 · 0,425 ms a 1 500). NO cachear, NO memoizar, NO añadir un `stat` con
 *     caché de `mtimeMs`: sería meter estado en un leaf que el contrato define como puro a
 *     cambio de una fracción de milisegundo.
 *
 * CONSTANTE DE MÓDULO, jamás compilada desde input externo (anti-ReDoS; sonda: 0,082 ms sobre
 * 80 KB sin match, sin backtracking catastrófico).
 *
 * Una línea `- [ ]` CON sufijo de estado (hand-edit incoherente) la cuentan los dos lectores:
 * el checkbox es la autoridad (83, decisión de contrato 2), y coincidir es todo lo que D-18 pide.
 */
const OPEN_LINE_RE =
  /^- \[ \] [0-9a-z]+ · .+ · [^·]* · \d{4}-\d{2}-\d{2} · [^·]*?(?: · (?:enrutada|descartada)(?: → .*)?)?$/;

/**
 * Cuenta las capturas ABIERTAS del inbox — las que siguen sin enrutar. `enrutada` y
 * `descartada` cierran ambas el checkbox (83 D-05) y por tanto no cuentan: una descartada ya
 * fue triada (D-16).
 *
 * **Never-throws de cuerpo entero (D-20):** fichero ausente, ilegible, sin permisos, que es un
 * directorio o con contenido binario → **0**. Nunca un throw, nunca un banner. Un inbox que no
 * se puede leer es indistinguible de un inbox vacío A EFECTOS DE PRESIÓN DE TRIAGE, y el
 * dashboard no es el sitio para diagnosticar el filesystem.
 *
 * **Solo lectura.** Esta función jamás abre el inbox para escritura, jamás toma el lock y jamás
 * lo renombra. Compite con `kodo capture` (append en `O_APPEND`) y con el `renameSync` del
 * marcado sin coordinarse: una lectura que cruza el rename observa el fichero anterior o el
 * posterior —el rename es atómico—, jamás uno a medias; una lectura que cruza un append puede
 * observar una última línea PARCIAL, que no casa `OPEN_LINE_RE` y simplemente no se cuenta. El
 * conteo es eventualmente consistente y nunca incorrecto por corrupción: el peor caso es
 * quedarse corto en uno durante menos de un ciclo de render.
 *
 * **Cadencia:** se invoca en el cuerpo del render de `App.js`, es decir en CADA re-render
 * (incluida cada pulsación de tecla), no una vez por tick de `usePoll`. En la práctica hace
 * piggyback sobre ese tick (cero timers nuevos, cero cambios en el scheduler), pero no está
 * limitada a él. Ver la nota (d) de `OPEN_LINE_RE` sobre por qué NO hay que optimizarlo.
 *
 * @param {{ readFileFn?: (p: string) => string, kodoDir?: string, homedirFn?: () => string }} [deps]
 *   `readFileFn`/`kodoDir`/`homedirFn` aíslan el HOME real en tests SIN tocar `process.env`
 *   (molde `tasks.js:39-41`); sin ellos, default `readFileSync` + `join(homedir(), '.kodo')`,
 *   que replica `defaultInboxPaths` (`src/inbox/store.js:141`) sin importarlo.
 * @returns {number} capturas abiertas, o 0 ante cualquier fallo.
 */
export function readOpenCaptureCount(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  try {
    // PEREZOSO (D-19): `homedir()` se evalúa AQUÍ, jamás en el cuerpo del módulo. Un test que
    // fije su directorio antes de INVOCAR obtiene su sandbox aunque el import sea estático.
    //
    // DENTRO del try (84-REVIEW WR-01): la resolución del path también puede lanzar —
    // `homedirFn` inyectado que falle, o un `kodoDir` que no sea string y haga estallar a
    // `join`. Resolverla fuera dejaba una grieta en el never-throws de cuerpo entero (D-20)
    // que este mismo JSDoc promete, y un throw aquí tumba el árbol de ink entero.
    const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
    const raw = readFileFn(join(kodoDir, 'inbox.md'));
    let n = 0;
    for (const line of raw.split('\n')) if (OPEN_LINE_RE.test(line)) n++;
    return n;
  } catch {
    // ENOENT (fichero o directorio ausente) / EISDIR (el path es un directorio) / EACCES
    // (sin permisos) / cualquier otro fallo de lectura → 0 (never-throws, D-20). El
    // contenido binario no llega aquí: no lanza, simplemente no casa la regex.
    return 0;
  }
}
