---
phase: 87-aislamiento-de-color-transitivo-en-el-tui
fixed_at: 2026-08-09T22:54:16Z
review_path: .planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 87: Informe de correcciones del code review

**Corregido:** 2026-08-09T22:54:16Z
**Review de origen:** `.planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-REVIEW.md`
**Iteración:** 1

**Resumen:**

- Hallazgos en alcance (`critical_warning`): 7 — CR-01, WR-01..WR-06
- Corregidos: 7
- Omitidos: 0
- Los seis `IN-*` quedan fuera de alcance por configuración (`fix_scope: critical_warning`)

**DEBT-04 respetado:** ningún assert se ha debilitado, ningún umbral se ha movido, no se ha
añadido ninguna allowlist. Los dos cambios que tocan asserts existentes (WR-03, WR-04) los dejan
ESTRICTAMENTE MÁS FUERTES, y se justifica abajo por qué en cada caso. La única allowlist del
fichero sigue siendo el `node:path` de ISO-03, con un elemento.

**Dónde se verificó qué (importante para reproducir):**

- **Por corrección, dentro del worktree aislado** (`/tmp/sv-87-reviewfix-*`, rama temporal
  `gsd-reviewfix/87-*`): `node --check` + `node --test test/format-isolation.test.js`. Esa suite
  es dependency-free (solo builtins `node:*`), así que corre íntegra sin `node_modules`.
- **Suite COMPLETA: en el checkout principal**, después del fast-forward. El worktree no tiene
  `node_modules` y `npm test` arrastra `ink`/`react`, así que los números de la gate NO son
  reproducibles desde el worktree — se midieron en `/Users/alex/dev/klab/kodo`.

| gate | antes (baseline) | después |
|---|---|---|
| `npm test` (checkout principal) | 2612 tests / 0 fail / 1 skipped | **2615 tests / 0 fail / 1 skipped** |
| `test/format-isolation.test.js` | 14 tests | **17 tests** |

Los +3 son los dos casos de ISO-05 (CR-01) y el de ISO-06 (WR-06). El `1 skipped` es el mismo de
la baseline, no lo introduce esta pasada.

## La mordida sigue mordiendo (verificación obligatoria de la fase)

Reintroducido a mano `import { stripControlChars } from '../format.js';` en
`src/cli/dashboard/markdown.js` (sustituyendo el import real a `../sanitize.js`):

- **ROJO**, con la cadena impresa. ISO-01 estático nombra las tres cadenas, la más corta
  primero: `src/cli/dashboard/markdown.js → src/cli/format.js`, y las que pasan por
  `App.js → SessionTable.js → markdown.js → src/cli/format.js`.
- El caso dinámico de ISO-01 **también** se pone rojo ahora, por el assert de simetría que
  añade WR-02: `src/cli/format.js` entra en la unión y se detecta como importador ESTÁTICO de
  `picocolors`. Antes de esta pasada ese segundo rojo no existía.
- Revertido el import → **VERDE**, 17/17. `git status` limpio: la inyección no ha quedado en el
  árbol.

Se repitieron además tres inyecciones de prueba más, todas revertidas (`git status` limpio tras
cada una), documentadas en su hallazgo: `registry.js` con `await import("picocolors")`,
`registry.js` con `import _pc from "picocolors"`, y la glob de `markdown.js` reescrita.

## Correcciones aplicadas

### CR-01: `extractImports` era ciego a cuatro formas de import ESM válidas

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `8782356`

Confirmado de forma independiente antes de tocar nada: las dos regex exigían `\s+` obligatorio y
devolvían `[]` para `import pc from"picocolors";`, `import"picocolors";`, `import{x}from'./b.js';`
y `export{a}from'./b.js';`.

**Divergencia respecto del fix propuesto en el review, con su medición.** El review proponía
`\s*` + `\b`. Lo probé y **introduce un falso positivo real**: con `from\s*['"]`,
`src/cmux/client.js:155` (`export async function createWorkspaceGroup({ name, from })`) alcanza el
`args.push('--from', from.join(','))` de `:158` y produce la arista fantasma `, from.join(`. Un
falso positivo es tan grave como un falso negativo aquí: pone rojos guards vecinos por motivos
espurios, y la reacción natural a un rojo espurio es debilitarlos (D-06). Las regex finales:

```js
const IMPORT_FROM_RE = /^\s*(?:import|export)(?=[\s{*'"])[^'"]*?from\s*['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import(?=[\s'"])\s*['"]([^'"]+)['"]/gm;
```

- `(?=[\s{*'"])` en vez de `\b`: admite las seis formas (`import x`, `import{`, `import*`,
  `import'`, `import"`, `export{`) y excluye `import(` e `import.meta`, que con `\b` a secas
  entraban en el barrido perezoso.
- `[^'"]*?` en vez de `[\s\S]*?`: prohíbe cruzar una comilla entre el keyword y su `from`, que es
  lo que mata el fantasma de `cmux/client.js`. Sigue admitiendo el import multilínea. Clase que
  no retrocede sobre sí misma, en el mismo criterio anti-ReDoS que el resto del fichero.

**Re-medido tras el cambio, como exige la fase:** sobre los 284 ficheros `.js` de `src/` +
`test/`, la lista de specifiers extraídos es **idéntica** a la de las regex antiguas — cero
aristas nuevas, cero fantasmas. El ensanchamiento es exclusivamente sobre formas que hoy el repo
no escribe. Las cifras fechadas del encabezado se re-midieron y **no cambian**: 99 ficheros `.js`
en `src/`, 129 `import()` literales en 26 ficheros, 0 computados.

Añadida la suite **ISO-05** (molde de ISO-04, el guard del guard): un caso ata las ocho formas
positivas y otro ata tres negativas, incluida la línea real de `cmux/client.js` que produjo el
fantasma. Y corregida la declaración `CUBRE:` del encabezado, que afirmaba exactamente la
cobertura que el sustrato no daba.

### WR-01: ISO-01 podía pasar en VACÍO

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `a8793a7`

Helper `assertTuiNoVacio(dashFiles)` invocado en los dos casos de ISO-01, antes de recorrer nada.
Se asevera la LISTA y no `existsSync` del directorio porque lo que ISO-01 recorre es la lista.

**Probado que muerde:** con el filtro apuntado a `/cli/dashboard-RENOMBRADO/`, los dos casos de
ISO-01 se ponen rojos (14 pass / 2 fail) en vez de pasar sobre cero ficheros.

Deliberadamente NO se ha tocado el guard TUI-04 de imports directos, que tiene la misma forma:
su vacuidad está DECLARADA en su comentario `:330-333` desde Wave 1, y el review no lo señala.

### WR-02: la declaración de cobertura de `import()` literal era falsa hacia fuera del TUI

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `8d1f6be`

**Opción elegida: ENSANCHAR el guard, no narrar el hueco.** Razón: es la opción que el propio
review llama «barato y cierra el hueco de verdad», cabe dentro del alcance de la fase (los entry
points siguen siendo exactamente `src/cli/dashboard/`), y **no toca `walkImports`** — D-06 queda
intacto: el walker sigue siendo estático y la siembra vive en el guard, que es donde el
precedente locked de la Phase 85 la pone. Narrar el hueco habría sido igual de legítimo, pero deja
tres ficheros que el TUI carga de verdad sin que ningún guard llegue a leerlos.

Nuevo helper `unionClausurasTui(dashFiles)`: unión de clausuras estáticas + **punto fijo**
siguiendo las aristas `import()` con specifier LITERAL y RELATIVO, con `stripComments` aplicado
ANTES del match (D-11). El punto fijo es necesario porque los destinos encadenan sus propias
aristas dinámicas, que es justo lo que el review señala de `registry.js`.

**Medido (2026-08-10):** 16 ficheros de TUI → 32 por clausura estática → **42 con la siembra**,
siguiendo 5 aristas: `index.js` → `host/interface.js`, `providers/registry.js`,
`providers/plane/client.js`; y `registry.js` → `plane/provider.js`, `github/provider.js`. Los 10
ficheros nuevos **no alcanzan `picocolors` por ninguna vía**: el guard se ensancha en VERDE.

Añadido en el mismo caso un assert de simetría: ahora que la siembra mete esos ficheros en la
unión, sería incoherente leerlos y buscar solo la forma dinámica. Un `import pc from 'picocolors'`
en `registry.js` mete color en el grafo del TUI igual que un `import('picocolors')`, y el caso
estático no lo ve porque su walker no cruza la arista dinámica.

**Probado que muerde**, con dos inyecciones en `src/providers/registry.js` (fichero alcanzable
SOLO por arista dinámica, invisible para todos los guards antes de esta corrección):

- `await import("picocolors")` → ROJO, `src/providers/registry.js → import('picocolors')`. Antes
  de esta corrección: VERDE.
- `import _pc from "picocolors"` → ROJO por el assert de simetría (y también por el single-source
  de D-07).

Corregidas además las dos piezas de prosa que el review señala como el entregable roto: el bloque
`CUBRE:` del encabezado y la justificación D-05 de `:364-366`, que estaba redactada como general
cuando solo se sostiene para aristas INTRA-directorio.

### WR-03: el tercer assert de ISO-03 no podía fallar y el comentario invertía la jerarquía

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `076b9b6`

Confirmado: `walkImports` calcula la clausura llamando a `extractImports`, la misma llamada de la
que sale `relatives`; si `relatives` es `[]`, `closure.size === 1` es necesario.

Aplicada la **segunda** opción del review (no la de borrar). `closure.size === 1` pasa a ser un
`deepEqual` sobre el CONTENIDO de la clausura, y se añade un assert de que ningún miembro importa
`picocolors` — que es la premisa literal que `select.js:30-34` da por buena. El cambio es
estrictamente más fuerte (`size` + identidad, y un assert nuevo), así que no roza DEBT-04.

El comentario se reescribe para decir lo que el código hace: los tres asserts de este caso son de
FORMA sobre el mismo fuente, quien los protege de una sintaxis invisible es ISO-05, y el tercero
se conserva como redundancia DECLARADA porque documenta de forma medible lo que la allowlist
afirma (que `node:path` no aporta grafo). Actualizada también la cabecera del `describe`, que
citaba «la clausura es exactamente 1» y el nombre del `it`.

### WR-04: los dientes de ISO-04 dependían de una precondición no aseverada, y su `4` era frágil

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `9326170`

Dos cambios, ambos del review:

1. **Precondición aseverada:** `src.includes('src/cli/dashboard/**')`. Es el disparador que hace
   MEDIBLE la divergencia de orden; sin él el meta-test pasa con AMBOS órdenes y deja de guardar
   nada en silencio. El mensaje dice qué hacer si el comentario cambia (reapuntar a `enrich.js` o
   `session-lookup.js`), no invita a borrar el assert.
2. **`assert.equal(imports.length, 4)` fuera.** El contrato de ISO-04 es «este orden recupera lo
   que el otro ciega», no «markdown.js tiene N imports». Se implementa `stripCommentsVerbatim`
   (el orden del molde hermano) dentro del caso y se compara: el orden hermano debe dar `[]` y
   éste debe dar `> 0`. Un quinto import legítimo en `markdown.js` ya no pone rojo un meta-test
   sobre `stripComments` con el mensaje apuntando al helper equivocado.

No es un debilitamiento: se sustituye una constante frágil por la relación que el caso realmente
quiere aseverar, y se añade un assert (`conOrdenHermano === []`) que antes no existía.

**Probado que muerde:** reescrita la glob de `markdown.js:14` a `el directorio del TUI`, la
precondición se pone ROJA (15 pass / 1 fail). Antes de esta corrección, ese mismo cambio dejaba el
meta-test verde-y-vacío.

### WR-05: premisa caducada en el JSDoc de `sanitizeText`

**Ficheros:** `src/inbox/store.js`
**Commit:** `0fc7749`

El JSDoc apuntaba a `format.js` como «compartido con el carril keystroke», y tras la Phase 87 ahí
ya no queda ningún saneador. Reapuntado a `src/cli/sanitize.js`, y añadida una frase que deja
constancia del cambio de dueño en vez de borrar el rastro — mismo criterio que la fase aplicó en
`inbox-count.js`.

### WR-06: la prohibición D-17 se quedaba sin ningún guard automático

**Ficheros:** `test/format-isolation.test.js`, `src/cli/dashboard/inbox-count.js`
**Commit:** `ba4f675`

**Se ha construido el guard, NO se ha diferido.** El criterio de la fase era diferir si cerrarlo
exigía maquinaria nueva; no la exige: `walkImports` ya está en el fichero. Reutilizarlo da un
guard **transitivo** en cuatro líneas.

Nueva suite **ISO-06**: la clausura de `src/cli/dashboard/inbox-count.js` no puede contener
`src/inbox/store.js`. Se ancla al FICHERO prohibido y no a `picocolors`, porque la razón viva de
la prohibición ya no es el color sino el peso del grafo (`withFileLock`, `resolveProjectId`).

**Divergencia respecto del fix propuesto**, a mejor: el review proponía un source-grep de primer
nivel (`/from\s*['"][^'"]*inbox\/store\.js['"]/`) en `test/dashboard-inbox-count.test.js`. Ese
regex se burla interponiendo un módulo puente, y el propio nombre del caso que proponía decía «ni
transitivamente». El guard vive por tanto en `format-isolation.test.js`, junto a su molde
(ISO-02/ISO-03) y junto al walker que lo hace transitivo.

Corregido además el comentario `:16-26` del leaf, que invocaba ISO-01 dentro del bloque
«PROHIBIDO» e inducía a leer una cobertura que no existe. Ahora nombra a ISO-06 como quien la mide
y dice explícitamente que ISO-01 **no** la cubre y por qué.

**Probado que muerde:** inyectado `import { listCaptures } from '../../inbox/store.js';` en el
leaf → ROJO con el grafo impreso. Revertido → VERDE.

### Extra: recolocación de bloques (defecto introducido por mí en `8782356`)

**Ficheros:** `test/format-isolation.test.js`
**Commit:** `6ef8081`

Al insertar ISO-05 antes de ISO-04 en el commit de CR-01, partí el comentario de cabecera de
ISO-04 de su `describe`. Movido el bloque ISO-05 completo detrás de ISO-04. Sin cambios de
comportamiento: 16/16 antes y después del movimiento.

## Restricciones respetadas

- **NO tocados:** `src/cli/dashboard/SessionTable.js`, `src/cli/dashboard/index.js`.
- **NO añadida** ninguna dependencia de AST/acorn: todo sigue siendo regex constante.
- **NO generalizado** el guard fuera de `src/cli/dashboard/`: los entry points siguen siendo
  exactamente los 16 ficheros del TUI. Lo que se ensancha (WR-02) es la CLAUSURA que se recorre
  desde ellos, siguiendo aristas que el TUI ya ejecuta en producción.
- **NO tocado** el `stripComments` de `test/check-isolation.test.js` ni el de
  `test/dispatcher-isolation.test.js` (diferido con trigger).
- **NO tocadas** las regex saneadoras de `src/cli/sanitize.js`. El único cambio en código de
  producción son dos comentarios (`store.js`, `inbox-count.js`); cero cambios de comportamiento.

## Para verificación humana

Dos puntos que pido que ratifique el dueño de la fase antes de cerrar, porque son decisiones de
criterio y no de sintaxis:

1. **WR-02 — radio de acción del guard.** Al sembrar la unión con las aristas dinámicas
   literales, `src/providers/registry.js`, `src/providers/plane/*`, `src/providers/github/*`,
   `src/host/interface.js`, `src/interface.js` y `src/labels.js` entran en el universo que ISO-01
   vigila. Hoy está verde y medido. Consecuencia futura: si algún día uno de esos módulos importa
   `picocolors` —directa o transitivamente vía `src/cli/format.js`— ISO-01 se pondrá rojo aunque
   el cambio se haya hecho pensando solo en el carril CLI. **Sostengo que ese rojo sería
   correcto** (el TUI carga esos módulos de verdad, así que el color entraría en su grafo: es
   exactamente la clase de leak que la fase cerró), pero amplía el radio de la invariante más allá
   del directorio del TUI y merece una ratificación explícita.
2. **WR-03/WR-04 — asserts reescritos.** Ninguno se debilita y lo argumento arriba caso por caso,
   pero son los dos únicos sitios donde esta pasada modifica un assert existente en vez de añadir
   uno. Segunda lectura recomendada.

## Fuera de alcance en esta pasada

Los seis `IN-*` no se han tocado (`fix_scope: critical_warning`). Dos de ellos rozan lo corregido
y conviene tenerlos presentes en la próxima iteración:

- **IN-01** (`extractImports` no aplica `stripComments`, el guard dinámico sí). Sigue abierto y
  sigue siendo benigno: tras ensanchar las regex, re-medí la unión sobre los 284 ficheros de
  `src/` + `test/` y no aparece ni un falso positivo por prosa. El ensanchamiento **no** ha
  agravado esta asimetría.
- **IN-03** (dos citas de línea desincronizadas). Las líneas `:55-56` que cita el review siguen
  apuntando donde apuntaban; mis cambios han desplazado la numeración del fichero, así que si se
  aborda, conviene re-localizarlas antes que fiarse de los números del review.

---

_Corregido: 2026-08-09T22:54:16Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteración: 1_
