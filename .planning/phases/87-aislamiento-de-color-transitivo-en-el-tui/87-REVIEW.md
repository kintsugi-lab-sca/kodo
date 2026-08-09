---
phase: 87-aislamiento-de-color-transitivo-en-el-tui
reviewed: 2026-08-09T22:38:23Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/cli/sanitize.js
  - src/cli/format.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/markdown.js
  - src/cli/dashboard/inbox-count.js
  - src/cli/inbox.js
  - src/cli/capture.js
  - src/hooks/stop.js
  - src/inbox/store.js
  - src/session/manager.js
  - test/format-isolation.test.js
  - test/dashboard-format.test.js
  - test/dashboard-inbox-count.test.js
  - test/manager.test.js
findings:
  critical: 1
  warning: 6
  info: 6
  total: 13
status: issues_found
---

# Phase 87: Code Review Report

**Reviewed:** 2026-08-09T22:38:23Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

El movimiento en sí está bien hecho y lo verifiqué byte a byte: `stripControlChars` y
`stripForKeystroke` salieron de `src/cli/format.js:60-123` (rango citado en `sanitize.js:6`,
confirmado contra `git show f00aabd:src/cli/format.js`) sin tocar una sola regex, `sanitize.js`
es efectivamente una hoja de cero imports, NO hay shim de re-export, y los siete importadores de
producción (`capture.js`, `App.js`, `markdown.js`, `inbox.js`, `stop.js`, `store.js`,
`manager.js`) importan la función correcta del módulo correcto, sin imports muertos y con los
dos `split` de import (`capture.js`, `inbox.js`) bien partidos. Las suites relacionadas pasan
(254 tests en `dashboard-format` + `manager` + `dashboard-inbox-count` + `inbox-cli` + `stop` +
`check-isolation`, 14 en `format-isolation`).

Re-medí TODAS las cifras que la fase declara y salen exactas: 99 ficheros `.js` en `src/`, 129
`import()` con specifier literal en 26 ficheros, 0 computados; `markdown.js` recupera 4 imports
con el orden nuevo de `stripComments` y 0 con el orden verbatim del hermano; la clausura de
`src/cli/dashboard/format.js` es 1; la clausura de `src/inbox/store.js` (6 ficheros) ya no
alcanza `picocolors` por ningún camino. La prohibición de `inbox-count.js` sigue intacta y su
premisa reescrita es cierta.

Dicho eso, la fase se juzga por sus guards, y ahí hay problemas reales. El sustrato sobre el que
descansan TODOS los guards nuevos —`extractImports`— es ciego a cuatro formas de import ESM
perfectamente válidas, y el texto que la fase acaba de escribir afirma exactamente lo contrario
(CR-01). Además, dos aserciones nuevas pueden pasar vacías o no pueden fallar en absoluto
(WR-01, WR-03), la declaración de cobertura de `import()` literal es falsa para las aristas que
salen del directorio del TUI y lo demuestro con cuatro casos concretos (WR-02), y quedan dos
premisas caducadas del mismo tipo que la fase existía para retirar (WR-05, WR-06).

## Critical Issues

### CR-01: `extractImports` es ciego a cuatro formas de import ESM válidas — todos los guards nuevos pueden quedarse VERDES con la invariante rota

**File:** `test/format-isolation.test.js:47-48` (regexes), `:65-70` (helper), consumido por `:121-133`, `:159-161`, `:174-196`, `:360-379`, `:395-426`, `:440-458`, `:477-535`

**Issue:** `IMPORT_FROM_RE` exige `from\s+['"]` y `IMPORT_BARE_RE` exige `import\s+['"]`. El
`\s+` es obligatorio, pero ESM no lo requiere. Verificado ejecutando las dos regex del fichero:

```
"import pc from\"picocolors\";"  -> []
"import\"picocolors\";"          -> []
"export{a}from'./b.js';"         -> []
"import{x}from'./b.js';"         -> []
"import pc from 'picocolors';"   -> ["picocolors"]
```

Consecuencias medibles, todas sobre entregables de ESTA fase:

- **ISO-02** (`:440-458`): un `import{createColors}from'picocolors'` en `src/cli/sanitize.js`
  deja `imports` vacío → `assert.deepEqual(imports, [])` pasa. El guard que la fase creó para
  congelar la hoja no ve la única regresión que importa.
- **ISO-01 estático** (`:360-379`): `walkImports` e `importsPicocolors` usan el mismo helper, así
  que una arista escrita en forma compacta es invisible al walker transitivo.
- **ISO-03** (`:483-516`): idem para `relatives`, `outsiders` y la clausura.
- **D-07 single-source** (`:224-240`): idem.

Agrava el hallazgo que la fase escribe dos afirmaciones nuevas que niegan este agujero:

1. `:25-27` — «CUBRE: imports ESTÁTICOS: `import … from`, `import 'x'` sin binding, y
   re-exports `export … from`». Falso para las formas sin espacio.
2. `:506-507` — «El assert que de verdad MUERDE: los dos de arriba son de FORMA y sobrevivirían
   a una sintaxis de import que las dos regex no vieran; éste es de ALCANZABILIDAD y no». Falso:
   la clausura se calcula con esas mismas dos regex (ver WR-03).

Es literalmente el fallo que la propia fase define como el peor posible («un guard que puede
ponerse verde mientras la invariante está violada es peor que no tener guard»), y la fase lo
documenta como resuelto.

**Fix:** relajar el whitespace obligatorio en ambas regex (una arista de cada una) y añadir un
caso de meta-test que ate la forma compacta, en el molde de ISO-04:

```js
const IMPORT_FROM_RE = /^\s*(?:import|export)\s*[\s\S]*?from\s*['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s*['"]([^'"]+)['"]/gm;
```

```js
// ISO-05: el sustrato ve las formas compactas (sin whitespace) — si no, TODOS los
// guards de este fichero se pueden burlar con `import{x}from'./y.js'`.
it('extractImports ve las formas de import sin whitespace', () => {
  assert.deepEqual(extractImports(`import pc from"picocolors";`), ['picocolors']);
  assert.deepEqual(extractImports(`import"picocolors";`), ['picocolors']);
  assert.deepEqual(extractImports(`import{x}from'./b.js';`), ['./b.js']);
  assert.deepEqual(extractImports(`export{a}from'./b.js';`), ['./b.js']);
});
```

Ojo al relajar `IMPORT_FROM_RE`: con `\s*` tras `import|export`, `exportFoo` o `importar` podrían
casar. Añadir `\b` (`/^\s*(?:import|export)\b\s*[\s\S]*?from\s*['"]([^'"]+)['"]/gm`) y re-medir
las cifras del encabezado tras el cambio.

## Warnings

### WR-01: ISO-01 (los dos casos) puede pasar VACÍO — no hay assert de lista no vacía

**File:** `test/format-isolation.test.js:361`, `:396`

**Issue:** `const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'))`. Si
`src/cli/dashboard/` se renombra, se mueve o desaparece, `dashFiles` queda `[]`, `chains` queda
`[]` y `assert.deepEqual(chains, [])` pasa; lo mismo con `violations` en el caso dinámico. Hoy
son 16 ficheros (medido), pero nada lo asevera.

La asimetría es lo que lo convierte en defecto y no en preferencia: las TRES suites nuevas
hermanas sí se blindan contra la vacuidad — ISO-02 (`:443-447`), ISO-03 (`:485-489`) y ISO-04
(`:554-558`) hacen `existsSync` antes de aseverar, con el mensaje «otherwise this test passes
trivially». ISO-01 es la única que no, y es la que más muerde. El comentario de TUI-04
(`:330-333`) ya normalizó en su día el «pasa trivialmente»; ISO-01 hereda esa grieta sin
declararla.

**Fix:** antes de recorrer, en ambos casos:

```js
assert.ok(
  dashFiles.length > 0,
  'src/cli/dashboard/ no contiene ficheros .js — el guard ISO-01 estaría pasando en VACÍO ' +
    '(¿se ha renombrado o movido el directorio del TUI?)',
);
```

### WR-02: la declaración «CUBRE `import()` con specifier LITERAL» es falsa para las aristas dinámicas que salen del directorio del TUI

**File:** `test/format-isolation.test.js:28-30` (declaración), `:32-36` (residual declarado), `:364-366` (justificación D-05), `:395-426` (guard dinámico)

**Issue:** el fichero declara UN solo punto ciego residual (specifier computado) y afirma que el
`import()` con specifier literal queda cubierto por el source-grep. No es así para las aristas
dinámicas cuyo destino cae FUERA de `src/cli/dashboard/`:

- El walker no sigue aristas dinámicas (a propósito, D-06).
- El source-grep solo lee ficheros que ya están en la unión de clausuras ESTÁTICAS, y solo busca
  el literal `import('…picocolors…')` dentro de ellos.

Medido sobre el árbol actual, `src/cli/dashboard/index.js` tiene cuatro aristas dinámicas con
specifier LITERAL hacia fuera del directorio:

| arista | ¿entry del walker? | ¿en la unión de clausuras (32 ficheros)? |
|---|---|---|
| `index.js:137` → `../../config.js` | no | sí (por otra vía estática) |
| `index.js:157` → `../../host/interface.js` | no | **no** |
| `index.js:171` → `../../providers/registry.js` | no | **no** |
| `index.js:233` → `../../providers/plane/client.js` | no | **no** |

Los tres últimos NO son leídos por ningún guard del fichero. La justificación D-05 de `:364-366`
(«CADA fichero es entry point. Iterarlos todos es lo que hace innecesario seguir aristas
dinámicas dentro del walker: `index.js` carga `./App.js` con `import()`, pero `App.js` también es
entry») solo se sostiene para aristas INTRA-directorio; está redactada como si fuese general.
`registry.js`, además, encadena sus propios `await import('../config.js')` y
`await import('./plane/provider.js')` (`:27-28`, `:57-58`) — todo ese subárbol es invisible.

No hay violación viva hoy: medí la clausura estática de los cuatro destinos y ninguno alcanza
`picocolors`. Por eso es WARNING y no BLOCKER — lo roto es la DECLARACIÓN, que es el entregable
que esta fase se propuso hacer honesto («Un fichero no puede declarar un punto ciego apoyándose
en una premisa que no se sostiene»).

**Fix:** o bien sembrar la clausura con los destinos literales de `import()` de los ficheros del
TUI (barato y cierra el hueco de verdad):

```js
const DYNAMIC_SPEC_RE = /\bimport\s*\(\s*['"](\.[^'"]*)['"]\s*\)/g;
for (const file of dashFiles) {
  walkImports(file, graph);
  for (const m of stripComments(readFileSync(file, 'utf-8')).matchAll(DYNAMIC_SPEC_RE)) {
    walkImports(resolve(dirname(file), m[1]), graph); // arista dinámica LITERAL → clausura
  }
}
```

o bien, si se mantiene D-06 tal cual, corregir el bloque «NO CUBRE» para nombrar este segundo
residual con sus cuatro casos medidos y su fecha, exactamente como se hizo con el computado.

### WR-03: el tercer assert de ISO-03 (`closure.size === 1`) no puede fallar — está implicado por el primero

**File:** `test/format-isolation.test.js:506-515`

**Issue:** el comentario dice que los dos primeros asserts son «de FORMA» y que éste es «de
ALCANZABILIDAD» y por tanto sobreviviría a una sintaxis de import que las regex no vieran. Es
falso: `walkImports` calcula la clausura invocando `extractImports` y siguiendo solo los
specifiers que empiezan por `.` — la MISMA llamada de la que sale `relatives` cinco líneas antes.
Si `relatives` es `[]`, la clausura es necesariamente `{formatPath}` y `size === 1`. El assert
está tautológicamente implicado por el primero y no puede ponerse rojo por su cuenta.

Peor: un `import pc from 'picocolors'` en `src/cli/dashboard/format.js` dejaría `relatives = []`
y `closure.size === 1` — los dos asserts que el comentario presenta como los fuertes pasan; lo
único que lo atraparía es el assert de `outsiders`, que es de FORMA. La jerarquía que describe el
comentario está invertida.

**Fix:** o eliminar el tercer assert y quedarse con los dos de forma (honesto), o convertirlo en
un assert que realmente mida algo independiente, p. ej. aseverar el CONTENIDO de la clausura y
que ninguno de sus miembros importa `picocolors`:

```js
const closure = walkImports(formatPath);
assert.deepEqual(
  [...closure].map((p) => relative(REPO, p)),
  ['src/cli/dashboard/format.js'],
  'la clausura de dashboard/format.js debe ser exactamente él mismo',
);
assert.deepEqual(
  [...closure].filter(importsPicocolors).map((p) => relative(REPO, p)),
  [],
  'ningún miembro de la clausura puede importar picocolors',
);
```

En cualquier caso, corregir el comentario `:506-507`, que hoy afirma algo que el código no hace.

### WR-04: los dientes de ISO-04 dependen de una precondición que no se asevera, y su cifra `4` es frágil

**File:** `test/format-isolation.test.js:551-569`

**Issue:** el caso mide que `stripComments` recupera 4 imports de `src/cli/dashboard/markdown.js`
y explica que con el orden verbatim daría 0. Confirmado empíricamente (4 vs 0). Pero el
disparador de esa diferencia es que `markdown.js:14` siga conteniendo la secuencia `/**` (viene
de la glob `src/cli/dashboard/**`), y eso NO se asevera en ninguna parte. Si alguien reescribe
ese comentario —p. ej. a `src/cli/dashboard/`— el meta-test pasa con AMBOS órdenes y se convierte
en verde-y-vacío en silencio: el guard-del-guard deja de guardar sin decirlo. Es el mismo patrón
de vacuidad que la fase persigue en ISO-01/ISO-03.

Segundo problema, menor pero real: `assert.equal(imports.length, 4)` congela un número que no
pertenece a este contrato. Añadir un quinto import legítimo a `markdown.js` pone rojo un
meta-test sobre `stripComments`, y el mensaje de error apuntará al helper equivocado.

**Fix:** aseverar la precondición y comparar contra el helper hermano en vez de contra una
constante:

```js
const src = readFileSync(markdownPath, 'utf-8');
assert.ok(
  src.includes('src/cli/dashboard/**'),
  'markdown.js debe conservar la glob `src/cli/dashboard/**` en un comentario de LÍNEA: es el ' +
    'disparador que hace medible la divergencia de orden de stripComments. Sin ella este ' +
    'meta-test pasa con AMBOS órdenes y deja de guardar nada.',
);
const verbatim = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
assert.equal(extractImports(verbatim(src)).length, 0, 'el orden del molde hermano ciega el fichero');
assert.ok(extractImports(stripComments(src)).length > 0, 'el orden de este fichero lo recupera');
```

### WR-05: `src/inbox/store.js:301` conserva la premisa caducada que la fase existía para retirar

**File:** `src/inbox/store.js:299-301`

**Issue:** el JSDoc de `sanitizeText` sigue diciendo:

> «se hace aquí y no en `format.js`, que es compartido con el carril keystroke y tiene goldens
> byte-idénticos que no toca mover»

Tras la Phase 87 `format.js` ya NO es compartido con el carril de keystroke — no contiene ningún
saneador. La justificación de por qué el strip de U+2028/U+2029 vive en `store.js` apunta a un
módulo equivocado, y un mantenedor que la siga irá a buscar los saneadores a `format.js` y no los
encontrará. Es exactamente la misma clase de defecto que la fase corrigió con cuidado en
`inbox-count.js:9-26`, en un fichero que esta misma fase editó (`:46`).

**Fix:**

```js
 * U+2029, que SOBREVIVEN a `stripForKeystroke` (Pitfall 10) — se hace aquí y no en
 * `sanitize.js`, que es la hoja compartida por los dos carriles y tiene goldens
 * byte-idénticos que no toca mover.
```

### WR-06: la prohibición mantenida en `inbox-count.js` se queda sin NINGÚN guard automático, y el comentario invita a creer lo contrario

**File:** `src/cli/dashboard/inbox-count.js:9-26`

**Issue:** el comentario está correctamente reescrito (la premisa de color está retirada y la
prohibición se mantiene por `withFileLock` / `resolveProjectId`), pero deja un hueco de
verificación. Antes, el único mecanismo que HABRÍA podido detectar `inbox-count.js` →
`store.js` era la alcanzabilidad transitiva a `picocolors`; esta fase la eliminó a propósito
(medido: la clausura de `store.js` ya no llega al paquete). Busqué un guard que asevere la
prohibición y no existe: `test/dashboard-inbox-count.test.js` importa `listCaptures` como ORÁCULO
(`:46`) pero no comprueba en ningún sitio que el leaf no importe el store. La prohibición pasa a
ser disciplina pura.

Lo agrava la redacción: `:18-21` invoca la suite ISO-01 dentro del mismo bloque «PROHIBIDO», lo
que induce a leer que ISO-01 cubre esta prohibición. No la cubre — ISO-01 solo mide
alcanzabilidad a `picocolors`, y `store.js` ya no lo alcanza. Por el propio estándar de la fase
(«una premisa que nadie mide es disciplina, no invariante»), esto pide guard o pide decirlo.

**Fix:** un caso de tres líneas en `test/dashboard-inbox-count.test.js`, molde de ISO-02:

```js
it('D-17: inbox-count.js NO importa src/inbox/store.js (ni transitivamente)', () => {
  const src = readFileSync(join(REPO, 'src/cli/dashboard/inbox-count.js'), 'utf-8');
  assert.ok(
    !/from\s*['"][^'"]*inbox\/store\.js['"]/.test(src),
    'importar el store arrastraría withFileLock y resolveProjectId a un leaf que solo cuenta ' +
      'líneas (D-17). Desde la Phase 87 esta prohibición NO la cubre ningún otro guard.',
  );
});
```

## Info

### IN-01: el walker estático no aplica `stripComments`; el guard dinámico sí

**File:** `test/format-isolation.test.js:121-133`, `:159-161` vs `:409-415`

**Issue:** `walkImports` e `importsPicocolors` leen el fuente CRUDO. D-11 («la prosa que nombra
el paquete no puede poner roja la suite», `:54-57`) solo está implementado en el carril dinámico
—por el anclaje al patrón `import(`— y en el saneo previo. En el carril estático, una línea
dentro de un bloque `/* … */` que empiece por `import … from 'picocolors'` produciría una arista
FANTASMA y pondría ISO-01 rojo por prosa. Hoy es benigno (medí la unión de clausuras: 32
ficheros, cero falsos positivos), pero la asimetría no está declarada.

**Fix:** aplicar `stripComments` dentro de `extractImports`, o documentar la asimetría en el
bloque «CUBRE / NO CUBRE» del encabezado.

### IN-02: el filtro de línea extra del guard dinámico es código muerto

**File:** `test/format-isolation.test.js:409-415`

**Issue:** tras `stripComments` (que ya elimina líneas `//`, bloques `/* */` y líneas `*`), el
`.filter()` posterior sobre `//`, `*` y `/*` no puede descartar nada más. El propio comentario
lo admite («dan EXACTAMENTE el mismo resultado… quien hace el trabajo es `stripComments`»). Se
mantiene deliberadamente por D-11 literal, pero conviene que el lector sepa que es inerte.

**Fix:** ninguno obligatorio; si se conserva, marcarlo como redundante-por-contrato en una línea
en vez de en siete.

### IN-03: dos citas de línea introducidas por esta fase apuntan a la línea equivocada, y las mediciones fechadas conviven desincronizadas

**File:** `test/format-isolation.test.js:55-56`, `:78-82`, `:401-402`

**Issue:**
- `:55` cita «prosa que nombra el paquete en `src/cli/dashboard/format.js:17`» — la línea 17 de
  ese fichero habla de zombies y magenta; la prosa con `picocolors` está en `:16`.
- `:56` cita `src/cli/dashboard/inbox-count.js:21` — tras la reescritura de esta misma fase la
  línea 21 es `// paquete.`; las menciones a `picocolors` quedaron en `:11` y `:18`.
- `markdown.js:13` sí es correcta.
- El encabezado re-mide al 2026-08-10 (99 ficheros, 129 literales) pero `:79` sigue diciendo «98
  ficheros (2026-08-05)» y `:402` sigue diciendo «128 coincidencias (2026-08-05)», que hoy son
  129. Ambas van fechadas, así que no son mentiras, pero conviven tres cifras distintas del mismo
  árbol en un fichero cuyo argumento central es la exactitud de las mediciones.

**Fix:** corregir las dos citas (`:16` y `:11`/`:18`) y re-medir o marcar explícitamente como
histórica la cifra de `:402`.

### IN-04: el recuento de consumidores en `sanitize.js` y su enumeración en ISO-02 no cuadran

**File:** `src/cli/sanitize.js:24`, `test/format-isolation.test.js:452-455`

**Issue:** `sanitize.js:24` dice «Los ocho consumidores importan de aquí»; los importadores de
PRODUCCIÓN son siete (`capture.js`, `App.js`, `markdown.js`, `inbox.js`, `stop.js`, `store.js`,
`manager.js`) — ocho solo si se cuenta `test/dashboard-format.test.js`. El mensaje de ISO-02
enumera seis y omite `src/cli/inbox.js` (el carril de render de `kodo inbox`, que sí importa
`stripControlChars`).

**Fix:** «Los siete consumidores de producción» y añadir `el listado de `kodo inbox`` a la
enumeración de ISO-02.

### IN-05: la cobertura de comportamiento de los saneadores vive en un fichero con nombre de otro sujeto

**File:** `test/dashboard-format.test.js:27`, `:353-457`

**Issue:** las suites HYG-07 (M4) y WR-02 —la única cobertura de COMPORTAMIENTO de
`stripControlChars`/`stripForKeystroke`, es decir de la superficie de seguridad— siguen alojadas
en `test/dashboard-format.test.js`, cuyo sujeto declarado es `src/cli/dashboard/format.js`. Ahora
que el sujeto real es `src/cli/sanitize.js`, un futuro split o borrado de ese fichero de test se
llevaría por delante los goldens de inyección de terminal sin que nada lo señale.

**Fix:** mover las dos suites a `test/sanitize.test.js` junto con el import de `:27`, o dejar en
la cabecera de `dashboard-format.test.js` una nota explícita de que aloja el contrato de
`src/cli/sanitize.js`.

### IN-06: el JSDoc movido de `stripForKeystroke` no nombra el residual U+2028/U+2029

**File:** `src/cli/sanitize.js:55-79`

**Issue:** el JSDoc se movió verbatim (correcto para la fase) y por tanto sigue sin mencionar que
U+2028/U+2029 SOBREVIVEN al saneo. Esa advertencia solo existe hoy en un consumidor
(`src/inbox/store.js:299-301`), y solo `store.js` los neutraliza; los carriles de keystroke de
`src/hooks/stop.js:59,83` y `src/session/manager.js:543` no lo hacen. Es preexistente (Phase 78),
no una regresión de esta fase, pero ahora que `sanitize.js` es el dueño canónico del contrato el
residual debería estar declarado ahí y no solo en uno de sus clientes.

**Fix:** añadir al JSDoc de `stripForKeystroke` una línea «Residual conocido: U+2028/U+2029
sobreviven (Pitfall 10) — los neutraliza `src/inbox/store.js`; los carriles de `stop.js` y
`manager.js` no».

---

_Reviewed: 2026-08-09T22:38:23Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
