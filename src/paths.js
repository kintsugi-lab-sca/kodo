// @ts-check
//
// src/paths.js — KODO-43. Definición CANÓNICA y ÚNICA de la raíz `~/.kodo` y sus subrutas.
//
// El problema que cierra: hasta esta tarea, 12 sitios de `src/` reconstruían
// `join(homedir(), '.kodo', …)` a mano pese a existir `KODO_DIR` en `config.js:11`. El literal
// vivía duplicado, así que cualquier cambio de layout del directorio de kodo tenía que
// aplicarse a mano en doce sitios y nadie lo medía. Este módulo es el único que escribe
// `'.kodo'`; `test/paths.test.js` (PATHS-04) mantiene esa unicidad.
//
// ── POR QUÉ FUNCIONES LAZY Y NO CONSTANTES ────────────────────────────────────────────────
//
// El enunciado de KODO-43 pedía «un módulo de solo-constantes». No se ha hecho así, y la razón
// es un invariante del repo, no una preferencia de estilo.
//
// `config.js:11` evalúa `join(homedir(), '.kodo')` en el CUERPO del módulo. Esa evaluación
// eager es una FUGA documentada: `homedir()` queda congelado al primer import, así que un test
// que pise `process.env.HOME` DESPUÉS ya no puede redirigirla. De ahí que los ficheros de abajo
// prohíban explícitamente importar `config.js` y reconstruyan la ruta por llamada:
// `cli/dashboard/inbox-count.js:31`, `cli/dashboard/plan.js:44`, `cli/dashboard/queue-count.js:12`,
// `cli/polling-daemon.js:17`, `cli/polling-logfile.js:17`, `daemon/logfile.js:47`,
// `inbox/store.js:20`. Del lado de los tests, ~30 ficheros de `test/` hacen import DINÁMICO y
// POST-HOME por esta misma causa.
//
// Es decir: la duplicación que KODO-43 quiere borrar y la evasión de la evaluación eager son
// dos cosas distintas que comparten síntoma. Un `export const KODO_DIR = join(homedir(), '.kodo')`
// aquí borraría la duplicación REINTRODUCIENDO la fuga en los doce sitios — cambiaría un
// problema de mantenimiento por uno de corrección, y pondría en rojo los tests HOME-isolated.
//
// Por eso el literal SÍ es una constante (`KODO_DIRNAME`) y su composición con el HOME es una
// FUNCIÓN. Cada consumidor conserva la semántica que ya tenía: `config.js` sigue cacheando en
// module-load (`kodoDir()` llamado una vez en su cuerpo), y los leafs siguen resolviendo por
// llamada. Lo único que cambia es de dónde sale el literal.
//
// ── HOJA DEL GRAFO ────────────────────────────────────────────────────────────────────────
//
// CERO imports relativos y CERO I/O: solo `node:os` y `node:path`, ambos builtins sin efectos
// de módulo. Es la condición para que los leafs del dashboard —que rechazan `config.js` justo
// por su I/O y su `loadEnvFile()` en module-load (`config.js:56`)— puedan importarlo sin
// romper ni su aislamiento (ISO-01/ISO-06 de `test/format-isolation.test.js`) ni sus tests.
// Al ser hoja, tampoco puede participar en un ciclo de imports.

import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Nombre del directorio raíz de kodo dentro del HOME del usuario.
 *
 * Ésta es la ÚNICA aparición del literal `'.kodo'` en `src/`. El guard PATHS-04 de
 * `test/paths.test.js` falla si reaparece en cualquier otro fichero.
 *
 * @type {string}
 */
export const KODO_DIRNAME = '.kodo';

/**
 * Raíz de kodo: `~/.kodo`. Equivalente a `KODO_DIR` de `config.js`, pero resuelto EN LA
 * LLAMADA, no al importar el módulo.
 *
 * `homedirFn` es el seam de DI que los leafs del dashboard ya exponían como `deps.homedirFn`
 * (`tasks.js:41`, `queue-count.js:54`, `inbox-count.js:111`, `plan.js:72`): permite aislar el
 * HOME en un test SIN tocar `process.env` ni depender del orden de imports. Pasar `undefined`
 * cae al default, así que `kodoDir(deps.homedirFn)` funciona con o sin inyección.
 *
 * NO cachea a propósito: cachear aquí recrearía la fuga que este módulo existe para evitar.
 * `homedir()` es una lectura de `process.env.HOME` (o de la passwd del sistema), barata y
 * estable dentro de una sesión de producción.
 *
 * @param {() => string} [homedirFn=homedir] - resolvedor del HOME; DI para tests.
 * @returns {string} ruta absoluta de `~/.kodo`.
 */
export function kodoDir(homedirFn = homedir) {
  return join(homedirFn(), KODO_DIRNAME);
}

/**
 * Subruta dentro de `~/.kodo`, p. ej. `kodoPath('logs', 'daemon.log')` → `~/.kodo/logs/daemon.log`.
 *
 * Sin seam de DI por diseño: los sitios que necesitan inyectar el HOME (los cuatro leafs del
 * dashboard) resuelven el directorio con `kodoDir(deps.homedirFn)` y componen ellos el resto,
 * porque ya exponen además un override del directorio completo (`deps.kodoDir`). Añadir aquí
 * un parámetro que nadie usa sería una abstracción especulativa.
 *
 * @param {...string} segments - segmentos a concatenar bajo la raíz de kodo.
 * @returns {string} ruta absoluta.
 */
export function kodoPath(...segments) {
  return join(kodoDir(), ...segments);
}
