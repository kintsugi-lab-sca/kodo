---
phase: 85-saneo-de-deuda-nyquist-retroactivo
reviewed: 2026-07-27T11:42:15Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/check.js
  - src/cli/dashboard/select.js
  - src/session/state.js
  - test/check-isolation.test.js
  - test/check.test.js
  - test/dashboard-select.test.js
findings:
  critical: 0
  warning: 7
  info: 7
  total: 14
status: issues_found
---

# Phase 85: Code Review Report

**Reviewed:** 2026-07-27T11:42:15Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Barrido de deuda con tres cambios de producción muy pequeños (uno de ellos comment-only) y tres de test. Lo que la fase dice haber hecho, lo ha hecho: verifiqué a mano cada afirmación load-bearing del brief y todas se sostienen.

Verificado como CORRECTO (no son hallazgos, son el resultado del contra-chequeo):

- `src/session/state.js` es literalmente comment-only (`git diff` = 1 línea del typedef). La tabla que describe coincide con el merge real de `upsertTaskHandoff` (`:449-462`: ausente/undefined → preserve, `null` → clear, string → overwrite). Las referencias cruzadas son exactas: el docblock canónico está en `:405-410` y los tres tests congelados están en `test/state/handoff-state.test.js:265` (CLEAR), `:288` (PRESERVE), `:307` (OVERWRITE). Las referencias `src/providers/registry.js:27,28,57,58` y `src/session/state.js:247` también son exactas.
- `deriveAnyNext` delegando en `nextCell` es coherente con el render: `rowCells` (`format.js:287`) usa la misma función y `App.js:820` la alimenta con el set SIN filtrar. `nextCell` colapsa `/\s+/g` + `trim`, así que el whitespace-only ya no enciende la columna. No hay ciclo (`format.js` solo importa `node:path`) ni regresión de never-throws.
- `walkImports` NO fue modificado (el diff solo toca su docblock). Los 8 asserts previos de LIVE-05 en `test/dashboard-select.test.js` son intactos: el diff es adición pura.
- El gate `needsOrchestrator`, el fail-open y la no-reentrada del resultado del doctor en `reasons` siguen intactos en `check.js`; `deps = {}` sigue resolviendo a `noopLogger`. `kodo check --dry-run` (`src/cli.js:131-138`) NO pasa por el piggyback, así que la escritura del doctor no se cuela en el modo report-only.
- Los 4 ficheros de test/producción tocados pasan en verde (86 tests entre `check.test.js`, `check-isolation.test.js`, `dashboard-select.test.js` y `format-isolation.test.js`).

Lo que NO se sostiene es el **alcance** que la propia fase se atribuye. Los tres warnings principales son de remediación incompleta, no de código roto: (a) el escenario que justifica la línea nueva de `check.js` es inalcanzable con el `scan()` actual, (b) el nuevo guard de `import()` dinámico no cubre el punto ciego que dice cubrir, y (c) la afirmación falsa que la fase corrigió sigue viva, verbatim, en el fichero hermano. Ninguno es un BLOCKER: nada de lo introducido produce comportamiento incorrecto.

## Warnings

### WR-01: La línea de fallos no se dispara en el escenario que la justifica (cmux caído)

**File:** `src/check.js:160-172`
**Issue:** El comentario afirma que sin esta línea `0 acción(es) aplicadas` significa a la vez «no había nada que arreglar» y «cmux caído, N acciones fallidas». Ese segundo caso **no puede llegar** al nuevo código. Con cmux caído, `execute()` (`src/cmux/sidebar-doctor.js:367`) re-escanea, y `scan()` obtiene sus dos entradas vía `parseRaw` (`:153-162`), que traga el error y devuelve el fallback `{ workspaces: [] }` / `{ groups: [] }`. Con `liveWorkspaceRefs` vacío, el bucle de `:239-252` descarta TODAS las sesiones → `loose_workspace` y `empty_group` vacíos → cero intentos de mutación → `result.errors === []` → `failed === 0` → **silencio**. La única vía real a `r.errors` no vacío es que cmux responda a las LECTURAS y falle en las ESCRITURAS (`addToWorkspaceGroup` / `ungroupWorkspaceGroup`, `:381`/`:391`), o el catch top-level de `:398`. Es decir: la ambigüedad se cierra para fallos de escritura por-item, y sigue exactamente igual de abierta para el modo de fallo más probable (cmux abajo), que es el que el comentario nombra.
**Fix:** o bien acotar el comentario a lo que el código realmente cubre, o bien propagar la degradación del scan. Lo segundo, mínimo:
```js
// sidebar-doctor.js: parseRaw marca el fallback
async function parseRaw(rawFn, fallback, d, category) {
  try { /* ... */ } catch (err) {
    d.logger?.warn?.('sidebar.doctor.scan', { category, error: errMsg(err) });
    return { ...fallback, __degraded: true };
  }
}
// check.js, junto al conteo de fallos:
if (report && report.degraded) {
  errorFn(`[kodo:check] Sidebar: scan degradado (cmux no responde) — 0 aplicadas NO significa "nada que arreglar"`);
}
```

### WR-02: El guard de `import()` dinámico no cubre el punto ciego que dice cubrir

**File:** `test/check-isolation.test.js:14-17`, `:56-59`, `:208-228`
**Issue:** Dos comentarios afirman «el punto ciego lo cubre el guard de source-grep del final de este fichero». No lo cubre. El grep itera `walkImports(check.js)`, es decir, la clausura ESTÁTICA (23 ficheros, verificado). Los módulos que se cargan SOLO dinámicamente — `src/providers/plane/provider.js` y `src/providers/github/provider.js`, cargados por `registry.js:28`/`:58` desde `check.js:103` — **no están en esa lista**, así que el grep jamás los mira, ni a ellos ni a su clausura estática. Un `await import('../../logger.js')` dentro de `github/provider.js` rompería LOG-12 en runtime con los 4 guards de prohibición Y el guard nuevo en verde. El propio docblock reconoce que esos ficheros «SÍ se cargan en runtime» y se apoya en una verificación manual puntual («el dato tranquilizador, verificado») que ningún test congela.
**Fix:** sembrar la lista greppeada con la clausura de los entrypoints dinámicos, sin tocar los guards de prohibición:
```js
const DYNAMIC_ENTRYPOINTS = [
  join(SRC, 'providers', 'plane', 'provider.js'),
  join(SRC, 'providers', 'github', 'provider.js'),
];
const scanned = walkImports(join(SRC, 'check.js'));
for (const e of DYNAMIC_ENTRYPOINTS) walkImports(e, scanned); // solo para el grep
```

### WR-03: El guard no ve `createRequire`, y el repo lo usa dentro del grafo de `check.js`

**File:** `test/check-isolation.test.js:33`
**Issue:** `DYNAMIC_LOGGER_IMPORT_RE` solo casa `import(` seguido de un string literal entre `'` o `"`. Dos evasiones concretas:
1. `src/host/interface.js:10-12` hace `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);` y **ese fichero está en el grafo estático de `check.js`** (verificado). Un `require('../logger.js')` ahí burla simultáneamente el walker (no es un import ESM) y el grep nuevo (no es `import(`).
2. Un template literal sin interpolación — `import(\`../logger.js\`)` — tampoco casa, y es una forma de escritura habitual.
El guard queda por tanto anclado a una única sintaxis mientras el repo demuestra que usa al menos dos formas de carga tardía.
**Fix:**
```js
const DYNAMIC_LOGGER_IMPORT_RE = /\b(?:import|require)\s*\(\s*['"`]([^'"`]*logger[^'"`]*\.js)['"`]/g;
```

### WR-04: La afirmación falsa que la fase corrige sobrevive verbatim en el fichero hermano

**File:** `test/format-isolation.test.js:14`, `:33`
**Issue:** El item de deuda era un comentario falso: «No cubre `import()` dinámico — el repo no lo usa (verificado en 06-RESEARCH A3)». Se corrigió en `check-isolation.test.js` y se dejó **idéntico, palabra por palabra, en `test/format-isolation.test.js`** (dos apariciones). Peor: ese fichero vigila `src/cli/format.js`, el ÚNICO dueño de `picocolors` (`:99-115`), y no tiene guard de source-grep equivalente, así que su walker tiene el mismo punto ciego sin ninguna mitigación. La remediación cerró una copia de la falsedad y dejó la otra en pie, en el fichero que además es más sensible.
**Fix:** aplicar la misma corrección de texto en `:14` y `:33`, y portar el guard de source-grep (una vez extraído a helper compartido, ver IN-02) al grafo de `src/cli/format.js`.

### WR-05: Dos comentarios adyacentes y contradictorios sobre el mismo guard

**File:** `src/cli/dashboard/select.js:27-28` (vs `:30-35`)
**Issue:** La cabecera pre-existente dice «test/format-isolation.test.js lo verifica vía **walker automático**». El comentario NUEVO, tres líneas más abajo, dice — correctamente — que el guard §TUI-04 «comprueba cada fichero de src/cli/dashboard/ **por separado**». Solo uno puede ser cierto, y es el nuevo: `format-isolation.test.js:209-220` filtra `listJsFiles(SRC)` y hace `extractImports` fichero a fichero; el `walkImports` de ese fichero (`:40`) NUNCA se usa para el guard de dashboard. La afirmación vieja era inocua cuando `select.js` tenía cero imports; ahora que tiene una arista, describe una garantía transitiva que no existe. En una fase cuyo objeto es la exactitud de los comentarios, dejar la contradicción intacta a tres líneas del comentario nuevo es el hallazgo.
**Fix:** sustituir en `:27-28` «lo verifica vía walker automático» por «lo verifica por fichero (guard §TUI-04, no transitivo)».

### WR-06: La premisa load-bearing del nuevo import no está congelada por ningún test

**File:** `src/cli/dashboard/select.js:30-35`
**Issue:** El comentario justifica el import con «`./format.js` es PURO — su único import es `node:path`». Es cierto HOY (`format.js:25`), pero ningún test lo asevera. El guard §TUI-04 solo busca el specifier literal `'picocolors'` fichero a fichero: si mañana `src/cli/dashboard/format.js` importara `../format.js` (la capa de color, que sí importa picocolors), `select.js` alcanzaría picocolors transitivamente y **los dos guards seguirían verdes**. Antes de este cambio `select.js` era estructuralmente inmune (cero imports); ahora su invariante depende de una propiedad no aseverada de un vecino. El repo ya usa exactamente este patrón de congelación para `logger-noop.js`, `handoff.js` y `pending.js` (`check-isolation.test.js:89`, `:242`, `:270`), así que no hay excusa de precedente.
**Fix:** añadir el guard que falta, espejo de los tres existentes:
```js
it('src/cli/dashboard/format.js solo importa node:path (premisa del import de select.js, DEBT-06)', () => {
  const imports = extractImports(readFileSync(join(SRC, 'cli', 'dashboard', 'format.js'), 'utf-8'));
  assert.deepEqual(imports, ['node:path'],
    'select.js importa format.js confiando en que es puro; si deja de serlo, la color-isolation D-12 se rompe en silencio');
});
```

### WR-07: El contrato de tres estados no documenta el string vacío, que el código trata como OVERWRITE

**File:** `src/session/state.js:53` (y el docblock canónico `:405-410`)
**Issue:** La tabla enumera «string no vacío → OVERWRITE · `null` explícito → CLEAR · campo AUSENTE → PRESERVE» y proclama que la discriminación es por PRESENCIA «NO por truthiness». Pero el merge (`:456-462`) es un `if/else if/else`: `''` cae en el `else` y **sobrescribe con cadena vacía**. Queda un cuarto estado no documentado en el único comentario cuya razón de existir es describir el contrato de forma exhaustiva — y es el estado más plausible de un caller que extraiga un `NEXT:` vacío del bloque de handoff. El resultado en disco (`next: ''`) es además indistinguible en el TUI de `null` (`nextCell` devuelve `''` en ambos), pero NO en el merge posterior (`''` no se preserva, `undefined` sí).
**Fix:** o documentar la fila, o normalizar. Lo segundo es más honesto con el título «tres estados»:
```js
} else if (entry.next === null || entry.next.trim() === '') {
  nextValue = null; // null explícito o string vacío → clear deliberado
}
```

## Info

### IN-01: Referencia de línea incorrecta en el comentario de `stripComments`

**File:** `test/check-isolation.test.js:21-22`
**Issue:** «stripComments verbatim de test/dispatcher-isolation.test.js:24-30». La función vive en `:30-36` de ese fichero; `:24-30` cae dentro de su docblock. Es la única referencia cruzada de la fase que no verifica (las otras cinco que comprobé son exactas).
**Fix:** corregir a `:30-36`.

### IN-02: Undécima copia idéntica de `stripComments`

**File:** `test/check-isolation.test.js:23-29`
**Issue:** `stripComments` está ya duplicado en 10 ficheros de `test/` (`dispatcher-isolation`, `orchestrator-launch-isolation`, `sidebar-doctor-hygiene`, `hygiene-api-key`, `skill-sync`, `labels-hygiene`, `gsd-concurrency`, `orchestrator-auto-sync`, `cmux/sidebar-doctor`). Este cambio añade la número 11. Un fix futuro del helper (p. ej. el de IN-06) habría que aplicarlo 11 veces.
**Fix:** extraer a `test/helpers/source-hygiene.js` y que los ficheros nuevos lo importen; migrar los antiguos de forma oportunista.

### IN-03: `stripComments` no elimina comentarios de fin de línea — falso positivo posible en el guard nuevo

**File:** `test/check-isolation.test.js:23-29`, `:213`
**Issue:** El filtro solo descarta líneas cuyo `trim()` EMPIEZA por `//` o `*`. Una línea de código con comentario colgante — `foo(); // ojo: nada de import('../logger.js')` — sobrevive al strip y dispararía el guard. El docblock original en `dispatcher-isolation.test.js:22-25` advierte explícitamente de esto («mantén las menciones literales en líneas dedicadas»); la copia nueva pierde esa advertencia justo cuando el comentario de `:207` promete que «prosa que mencione logger.js no puede poner roja la suite».
**Fix:** portar la advertencia al comentario de `:21-22`, o filtrar también con `line.replace(/\/\/.*$/, '')`.

### IN-04: El fixture de errores del Test F usa categorías que `pushError` nunca produce

**File:** `test/check.test.js:481-484`
**Issue:** El test fabrica `errors: [{ category: 'loose_workspace', ... }, { category: 'empty_group', ... }]`. La forma del objeto sí coincide con la real (`sidebar-doctor.js:341` empuja `{ category, target, reason }`), pero los VALORES no: las categorías reales son `'add'`, `'ungroup'` y `'execute'` (`:381`, `:391`, `:398`). Hoy da igual porque producción solo lee `.length`, pero si mañana se filtra por categoría (p. ej. «no contar el error top-level de execute»), el test pasaría verde sobre datos que no existen.
**Fix:** usar `category: 'add'` y `category: 'ungroup'`.

### IN-05: `assert.doesNotReject` es tautológico en el Test G(b)

**File:** `test/check.test.js:518-529`
**Issue:** El comentario dice que ese bloque «congela el guard `|| []` defensivo». No lo hace `doesNotReject`: `runCheckAndAct` es fail-open y NUNCA rechaza (todo el piggyback está en el try/catch de `check.js:154-179`), así que el assert pasaría igual con un `TypeError` dentro. Quien realmente muerde es el `deepEqual(errsAbsent, [])` de la línea siguiente, porque el catch emitiría «Sidebar doctor error». La cobertura es correcta; la atribución del comentario, no.
**Fix:** reescribir el comentario para apuntar al `deepEqual`, o quitar el `doesNotReject`.

### IN-06: Los guards de `github/provider.js` y `github/normalize.js` quedan documentados como decorativos pero conservan su nombre

**File:** `test/check-isolation.test.js:139-157` (contexto: `:52-59`)
**Issue:** El docblock nuevo de `walkImports` admite que esos ficheros «SÍ se cargan en runtime pese a que su guard de prohibición sigue verde». Los nombres de los tests (`kodo check does not import src/providers/github/provider.js transitively`) siguen afirmando en presente una propiedad que el propio fichero declara falsa a nivel de runtime. Un lector que solo vea el nombre en la salida verde saca la conclusión contraria.
**Fix:** renombrar a `... does not import github/provider.js in its MODULE-LOAD graph (static)`, que es lo que el guard mide de verdad.

### IN-07: La suite completa es flaky y enmascara regresiones (pre-existente, no de esta fase)

**File:** `test/dashboard/app-setup.test.js`, `test/inbox-concurrency.test.js`, `test/dashboard/app-open.test.js`
**Issue:** `npm test` falla en HEAD (6 fallos) y también en el base `2ca5080` (3 fallos), con subtests DISTINTOS entre corridas; los mismos ficheros pasan en verde ejecutados en aislamiento en ambos commits. Es decir: no es una regresión de la Phase 85, pero significa que la señal de la suite completa no distingue una regresión real de ruido. Lo dejo anotado porque cualquier guard nuevo de este barrido hereda esa falta de señal.
**Fix:** fuera del alcance de esta fase; abrir deuda para aislar el estado compartido de esos tres ficheros (probablemente `HOME`/`KODO_DIR` compartido bajo `--test-concurrency`).

---

_Reviewed: 2026-07-27T11:42:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
