// @ts-check
//
// src/platform-defaults.js — KODO-56 (F2 del port a Linux). Resolvedor ÚNICO de los defaults
// que dependen de la plataforma.
//
// ── EL FALLO QUE CIERRA ───────────────────────────────────────────────────────────────────
//
// `orca.binary` defaulteaba a `/usr/local/bin/orca` y, cuando ese path no existe, los dos
// call sites que resuelven el binario caían a `'orca'` por PATH. En macOS eso es correcto.
// En Linux, `orca` por PATH es el LECTOR DE PANTALLA de GNOME: no da ENOENT — arranca otro
// programa. Es el peor modo de fallo posible (silencioso y con efecto), y por eso este
// módulo existe: el binario del host Orca en Linux es `orca-ide`, no `orca`.
//
// Los otros dos defaults son del mismo eje y por eso viven aquí y no dispersos:
//   - `host`: el default de fábrica `'cmux'` apunta a `/Applications/cmux.app/…` — un path
//     de macOS. Un first-run en Linux nacía apuntando a un binario inexistente.
//   - el lanzador de URLs de la tecla `o` del dashboard: `open` es de macOS; en el resto
//     el equivalente freedesktop es `xdg-open`.
//
// ── POR QUÉ UN MÓDULO Y NO `process.platform` REPARTIDO ───────────────────────────────────
//
// Un `process.platform === 'darwin' ? … : …` por call site no se puede testear con la
// plataforma inyectada sin monkey-patchear `process` (global, contaminante entre tests), y
// multiplica los sitios donde alguien puede escribir el literal equivocado. Aquí la
// plataforma es un PARÁMETRO con default `process.platform`: el mismo patrón que ya usan
// `src/cli/up.js` (`deps._platform`) y `src/daemon/lifecycle.js`.
//
// HOJA PURA: cero imports (ni builtins), cero side-effects al cargar. Es requisito, no
// estilo — lo importan `src/config.js` (que no puede aceptar ciclos), `src/check.js` (cuyo
// grafo de module-load está congelado por `test/check-isolation.js`, LOG-12) y
// `src/cli/dashboard/open.js` (bajo la prohibición de color-isolation de `src/cli/dashboard/**`).
//
// ── EL EJE ES darwin / NO-darwin, NO linux / RESTO ────────────────────────────────────────
//
// Los tres defaults se bifurcan por «¿es macOS?», no por «¿es Linux?». Windows está fuera de
// alcance por decisión tomada (el código lo rechaza explícitamente en `up.js`, `lifecycle.js`
// y la fórmula), así que la rama no-darwin describe el mundo POSIX-no-Apple: ahí `orca-ide`
// y `xdg-open` son los nombres correctos en Linux y en los BSD, y `cmux` no existe en
// ninguno. Bifurcar por `=== 'linux'` dejaría a los demás sin default definido sin ganar
// nada a cambio.

/**
 * @typedef {Object} PlatformDefaults
 * @property {string} host - `config.host` de fábrica: `'cmux'` en macOS, `'orca'` fuera.
 * @property {string} orcaBinary - `config.orca.binary` de fábrica. En no-darwin es `'orca-ide'`
 *   (por PATH, a propósito): `'orca'` a secas ejecutaría el lector de pantalla de GNOME.
 * @property {string} openBinary - lanzador de URLs del dashboard: `open` (macOS) / `xdg-open`.
 */

/**
 * Resuelve los defaults dependientes de plataforma. PURA y never-throws (solo comparaciones
 * de string); devuelve un objeto NUEVO en cada llamada, así que un caller que lo mute no
 * puede contaminar a otro.
 *
 * @param {string} [platform=process.platform] - valor con la semántica de `process.platform`
 *   (`'darwin'`, `'linux'`, …). Parámetro para poder testear ambas ramas sin tocar el global.
 * @returns {PlatformDefaults}
 */
export function platformDefaults(platform = process.platform) {
  const isDarwin = platform === 'darwin';
  return {
    host: isDarwin ? 'cmux' : 'orca',
    orcaBinary: isDarwin ? '/usr/local/bin/orca' : 'orca-ide',
    openBinary: isDarwin ? 'open' : 'xdg-open',
  };
}
