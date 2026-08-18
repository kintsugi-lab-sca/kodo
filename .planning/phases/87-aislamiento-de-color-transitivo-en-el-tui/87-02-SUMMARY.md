---
phase: 87-aislamiento-de-color-transitivo-en-el-tui
plan: 02
subsystem: testing
tags: [import-graph, color-isolation, guards, honest-declaration, meta-test, source-hygiene]

# Dependency graph
requires:
  - phase: 87-01
    provides: "stripComments con el orden corregido, extractImports, walkImports, listJsFiles y las suites ISO-01/ISO-02"
  - phase: 85-check-isolation
    provides: "molde de la declaración honesta ya corregida (check-isolation.test.js:14-17, :51-59) y precedente D-06/WR-03"
  - phase: 76-convergencia
    provides: "molde del aserto positivo de convergencia ORCH-05 (check-isolation.test.js:287-300)"
  - phase: 74-handoff
    provides: "molde del guard de hoja (check-isolation.test.js:241-258)"
provides:
  - "ISO-03: pureza de src/cli/dashboard/format.js congelada por test — 2 asserts de forma + 1 de alcanzabilidad (clausura = 1)"
  - "ALLOWED_BUILTINS: la única allowlist de toda la fase (node:path), congelada a un elemento y escrita con su medición"
  - "Aserto positivo de convergencia D-14: select.js alcanza ./format.js, así que ISO-03 no puede degradar a guard huérfano"
  - "Declaración honesta ISO-04: CUBRE / NO CUBRE (residual nombrado, no cerrado) / MEDICIÓN FECHADA re-tomada en sesión"
  - "Meta-test ISO-04: stripComments recupera los 4 imports de markdown.js — revertir el orden es fallo de suite, no silencio"
  - "Los tres comentarios que ISO-01/ISO-02 vuelven falsos, corregidos en su premisa con la prohibición intacta"
affects: [87-VERIFICATION, DEBT-04, deferred stripComments de los ficheros hermanos]

actuals:
  tokens: 3654
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Guard de hoja CON allowlist congelada de un elemento: divergencia del molde de cero-imports documentada con su medición, nunca derivada del sujeto"
    - "Triple assert de hoja: dos de FORMA (regex-dependientes) + uno de ALCANZABILIDAD (clausura), donde el tercero es el que muerde"
    - "Meta-test del helper de un guard (guard del guard): ata un helper divergente a un sujeto concreto para que 'arreglar' la divergencia sea rojo"
    - "Declaración honesta en tres bloques (CUBRE / NO CUBRE residual / MEDICIÓN FECHADA) con la cifra re-medida en la sesión que la escribe"

key-files:
  created: []
  modified:
    - test/format-isolation.test.js
    - src/cli/dashboard/inbox-count.js
    - test/dashboard-inbox-count.test.js

key-decisions:
  - "La premisa retirada se describe por su CONTENIDO y jamás se cita: citarla la reintroduciría en el fichero y el criterio de fuente volvería a contarla (87-RESEARCH §Code 5 proponía un texto que sí la citaba)"
  - "La cifra de la declaración honesta se re-midió en esta sesión (129 literales / 26 ficheros / 0 computados sobre 99 ficheros, 2026-08-10), no se transcribió: la investigación contó 128 el 2026-08-05"
  - "Los tres comentarios de zona gris (OQ-2) entran en alcance en vez de diferirse: tres ediciones de comentario contra el coste de cerrar la fase creando tres premisas falsas nuevas"
  - "Se corrige la PREMISA de la prohibición de inbox-count.js, nunca su conclusión: sobrevive por withFileLock y resolveProjectId"

patterns-established:
  - "Una prohibición puede sobrevivir a que se evapore su premisa principal; lo que no puede es seguir apoyándose en ella — y eso se escribe en el propio comentario"

requirements-completed: [ISO-03, ISO-04]

coverage:
  - id: D1
    description: "src/cli/dashboard/format.js queda congelado como hoja: cero imports relativos, builtins solo los de una allowlist de un elemento, y clausura transitiva exactamente 1"
    requirement: ISO-03
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#cero imports relativos; builtins solo los de la allowlist; clausura de 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "select.js sigue consumiendo ./format.js — aserto positivo de convergencia, sin el cual ISO-03 congelaría un módulo huérfano"
    requirement: ISO-03
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#select.js consume ./format.js (convergencia, D-14)"
        status: pass
    human_judgment: false
  - id: D3
    description: "test/format-isolation.test.js ya no declara ningún punto ciego en falso: la premisa retirada no queda ni citada"
    requirement: ISO-04
    verification:
      - kind: other
        ref: "grep -c \"el repo no lo usa\\|el repo no los usa\" test/format-isolation.test.js → 0 (era 2)"
        status: pass
    human_judgment: false
  - id: D4
    description: "La cabecera enumera lo que CUBRE, nombra el punto ciego residual sin presentarlo como cerrado, y fecha una medición re-tomada en la sesión"
    requirement: ISO-04
    verification:
      - kind: other
        ref: "grep -c 'CUBRE' → 3; grep -c 'NO CUBRE' → 1; grep -cE '2026-[0-9]{2}-[0-9]{2}' → 5; grep -c 'providers/registry.js' → 1"
        status: pass
      - kind: manual_procedural
        ref: "revisión de honestidad sobre el bloque citado abajo (§La declaración honesta, verbatim)"
        status: pass
    human_judgment: true
    rationale: "Ningún assert puede comprobar que un texto es honesto. Los greps acreditan la FORMA (que hay bloque CUBRE, bloque NO CUBRE, fecha y citas); que el residual no se venda como cerrado y que la cifra no sea heredada se revisa leyendo, y por eso la cabecera va citada verbatim en este SUMMARY."
  - id: D5
    description: "El helper stripComments con el orden corregido no ciega al guard: el meta-test recupera los 4 imports estáticos de markdown.js"
    requirement: ISO-04
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#stripComments recupera los 4 imports estáticos de src/cli/dashboard/markdown.js"
        status: pass
      - kind: manual_procedural
        ref: "mordida C (helper revertido al orden del molde hermano) — ROJO con «Recuperados (0):», revertida VERDE"
        status: pass
    human_judgment: false
  - id: D6
    description: "Los tres comentarios que ISO-01/ISO-02 vuelven falsos quedan corregidos, conservando íntegra la prohibición que argumentaban"
    requirement: ISO-04
    verification:
      - kind: other
        ref: "grep -c 'imports DIRECTOS' en los dos ficheros → 0 y 0; grep -c 'PROHIBIDO importar' inbox-count.js → 2; git diff -U0 doc-only"
        status: pass
      - kind: integration
        ref: "node --test test/dashboard-inbox-count.test.js → # tests 14 # fail 0"
        status: pass
    human_judgment: false

# Metrics
duration: 21 min
completed: 2026-08-10
status: complete
---

# Phase 87 Plan 02: Congelar la pureza de `dashboard/format.js` y retirar la premisa falsa Summary

**Los dos guards que impiden que lo demostrado por el `87-01` regrese en silencio: la pureza de `src/cli/dashboard/format.js` deja de ser una premisa afirmada por un comentario y pasa a ser tres asserts (dos de forma, uno de alcanzabilidad) más un aserto positivo de convergencia; y la cabecera del propio fichero de guard cambia una premisa falsa por una declaración de tres bloques con el punto ciego residual nombrado y una medición re-tomada en esta sesión.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-08-09T22:05:00Z (aprox.)
- **Completed:** 2026-08-09T22:26:00Z (= 2026-08-10 00:26 CEST, fecha local de la sesión)
- **Tasks:** 2
- **Files modified:** 3 (0 creados, 3 modificados)

## `phase_base_sha`

```
e4a3945   (HEAD del plan 87-01, tras su ledger de broken windows)
```

Todos los baselines del plan se re-midieron en vivo contra `e4a3945` antes de tocar nada.
Coinciden con los del plan **salvo uno**, documentado abajo en §Deviations.

| Medición | Baseline del plan (`61a5c95`) | Medido en `e4a3945` |
|---|---|---|
| `test/format-isolation.test.js` | 11 (post-`87-01`) | 11 / 0 fail |
| `test/check-isolation.test.js` | 12 | 12 / 0 fail |
| `test/dashboard-inbox-count.test.js` | 14 | 14 / 0 fail |
| `grep -c "el repo no lo usa\|el repo no los usa"` | 2 | **2** |
| `grep -c 'imports DIRECTOS' src/cli/dashboard/inbox-count.js` | 2 | **1** ← divergencia |
| `grep -c 'imports DIRECTOS' test/dashboard-inbox-count.test.js` | 1 | **1** |
| `grep -c 'PROHIBIDO importar' src/cli/dashboard/inbox-count.js` | ≥ 2 | **2** |
| `grep -c 'ALLOWED_BUILTINS' test/format-isolation.test.js` | 0 | **0** |
| `grep -c 'walkImports' test/format-isolation.test.js` | — | **7** |
| imports estáticos de `src/cli/dashboard/markdown.js` | 4 | **4** |
| imports de `src/cli/dashboard/format.js` | 1 (`node:path`) | **1** (`node:path`) |

## Task Commits

1. **Tarea 1: congelar la pureza de `dashboard/format.js` y su convergencia con `select.js`** — `4b980b2` (test)
2. **Tarea 2: la declaración honesta y los tres comentarios que la fase vuelve falsos** — `792f5eb` (docs)

## La re-medición, con su comando y su salida literal

El plan **prohíbe transcribir** las cifras de la investigación: la declaración honesta no puede
retirar una premisa no verificada apoyándose en otra. El método está fijado por el plan
(recorrer los `.js` de `src/`, aplicar `stripComments`, contar `import(` con specifier
entrecomillado y sin él, y los ficheros distintos con al menos un literal) y se implementó como
script de un solo uso en el scratchpad, con el **mismo `stripComments` de orden corregido** que
usa el fichero de guard.

```
$ date "+%Y-%m-%d %H:%M %Z" && node remedir-dinamicos.mjs /Users/alex/dev/klab/kodo
2026-08-10 00:21 CEST
ficheros .js bajo src/: 99
import() con specifier LITERAL: 129 en 26 ficheros
import() con specifier COMPUTADO: 0
```

**Validación del método, porque el `0` es la cifra delicada.** El regex de literales acepta
comilla simple, doble **y backtick**, así que un `import(\`./${n}.js\`)` —que es COMPUTADO— se
contaría como literal y falsearía el cero. Se comprobó aparte que no existe ninguno:

```
$ grep -rnE "import\s*\(\s*\`" src/
(sin salida)
$ grep -rcE "import\s*\(\s*\`" src/ | grep -v ':0' | wc -l
0
```

Con 0 backticks en `import(`, la clasificación no puede haber caído en ese error y el `0` de
computados se sostiene.

**La divergencia respecto de la investigación es el argumento, no un problema.** `87-RESEARCH.md`
§Hallazgo 6 midió **128 literales en 26 ficheros sobre 98 ficheros el 2026-08-05**. Cinco días
después son **129 en 26 sobre 99**. El fichero de más es `src/cli/sanitize.js`, que creó el plan
`87-01`; el literal de más es del mismo movimiento. Una cifra que se mueve en cinco días es
exactamente por qué se escribe fechada y por qué el plan prohíbe heredarla.

**La fecha escrita en la cabecera es `2026-08-10`**, la fecha local de la sesión (CEST). En UTC
la medición cae en `2026-08-09T22:21Z`; se deja constancia aquí para que no haya ambigüedad en
la revisión de honestidad.

## La declaración honesta, verbatim (para la revisión de honestidad del VERIFICATION)

`test/format-isolation.test.js:14-46`. Se citan las tres partes exigidas por D-12, íntegras:

```js
// ── Qué CUBRE este fichero y qué no (Phase 87 / ISO-04) ─────────────────────────────────
//
// Hasta esta fase, aquí y en el JSDoc de `walkImports` había una línea que descartaba el
// punto ciego de la carga dinámica apoyándose en una afirmación sobre cuánto usa el repo
// `import()`. Esa afirmación era FALSA ya cuando se escribió: `src/providers/registry.js`
// (`:27`, `:28`, `:57`, `:58`) y `src/session/state.js:247` hacen `await import()` desde
// antes. Un fichero no puede declarar un punto ciego apoyándose en una premisa que no se
// sostiene: induce a no verificar justo donde hay que verificar. La premisa se retira; en su
// lugar va esta declaración.
//
// CUBRE:
//   - imports ESTÁTICOS: `import … from`, `import 'x'` sin binding, y re-exports
//     `export … from` (ESM los resuelve como imports, y el walker los sigue).
//   - `import()` dinámico con specifier LITERAL, fuera de comentarios: lo cubre el guard de
//     source-grep de la suite ISO-01 sobre la unión de las clausuras del TUI, con
//     `stripComments` aplicado ANTES del match (ver la cabecera de ese helper).
//
// NO CUBRE — punto ciego RESIDUAL, nombrado y NO cerrado:
//   - `import()` con specifier COMPUTADO (una variable, una concatenación, un template con
//     interpolación). Ningún regex lo resuelve sin ejecutar el módulo, y ejecutar módulos
//     dentro de un guard de test es justo lo que D-06 evita. No está mitigado ni acotado:
//     simplemente no se ve.
//
// MEDICIÓN FECHADA, NO GARANTÍA (2026-08-10, re-medida en la sesión que escribe esto, sobre
// los 99 ficheros .js de `src/`, con el `stripComments` de abajo aplicado al fuente):
//   - 129 `import()` con specifier literal, repartidos en 26 ficheros.
//   - 0 `import()` con specifier computado.
// Es una FOTO del árbol de hoy, no una promesa sobre el de mañana: el `0` de arriba dice que
// hoy no hay ninguno, NO que no pueda haberlo. La investigación de esta fase contó 128
// literales el 2026-08-05 y cinco días después son 129 — la cifra caduca, y por eso va
// fechada y por eso no se hereda de otro documento sin volver a medirla. El día que aparezca
// el primer specifier computado, este fichero no lo verá y seguirá verde.
```

**La trampa que el plan marcó como el riesgo mayor, evitada.** `87-RESEARCH.md` §Code 5 proponía
un texto que **citaba literalmente** la frase retirada. Seguirlo habría devuelto
`grep -c "el repo no lo usa"` a 1 y roto el propio criterio de aceptación de ISO-04. La premisa
se describe aquí por su contenido («una afirmación sobre cuánto usa el repo `import()`») y en
ningún punto se reproduce.

Y el JSDoc de `walkImports` (`:107-111`) pasa de **negar que existan** aristas dinámicas a decir
**por qué no se siguen**:

```js
 * NO sigue `import()` dinámico, y es A PROPÓSITO (D-06, precedente locked de la Phase 85 /
 * WR-03): seguir aristas dinámicas aquí ensancharía la clausura y pondría rojos guards
 * vecinos por motivos espurios — y la reacción natural a un rojo espurio es debilitarlos. El
 * punto ciego lo cubre el source-grep sobre esta MISMA clausura (suite ISO-01); el residual
 * —specifier computado— queda declarado en la cabecera de este fichero, sin cerrar.
```

## Conteo de tests del fichero de guard, antes y después

| Momento | `node --test test/format-isolation.test.js` |
|---|---|
| Baseline `87-01` (`e4a3945`) | `# tests 11 · # suites 7 · # fail 0` |
| Tras Tarea 1 (ISO-03: pureza + convergencia) | `# tests 13 · # fail 0` (**+2**) |
| Tras Tarea 2 (meta-test ISO-04) | `# tests 14 · # suites 9 · # fail 0` (**+1**) |

Total **+3**, exactamente lo que exige el `VERIFICATION` del plan (2 de la Tarea 1 + 1 de la
Tarea 2).

## Evidencia — Mordida C: el meta-test de `stripComments` muerde

El meta-test existe para que revertir la divergencia del helper al orden del molde hermano sea
un **fallo de suite** y no un guard verde y ciego (T-87-10). Se comprobó aplicando el orden
verbatim de `test/check-isolation.test.js:23-29` al helper:

```diff
 function stripComments(src) {
   return src
+    .replace(/\/\*[\s\S]*?\*\//g, '')
     .split('\n')
-    .filter((line) => !line.trim().startsWith('//'))
-    .join('\n')
-    .replace(/\/\*[\s\S]*?\*\//g, '')
-    .split('\n')
-    .filter((line) => !line.trim().startsWith('*'))
+    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
     .join('\n');
 }
```

Corrida ROJA (`node --test test/format-isolation.test.js`, **exit 1**):

```
# tests 14
# pass 13
# fail 1
```

Mensaje verbatim:

```
stripComments debe conservar los 4 imports estáticos de markdown.js. Si este número es 0, el
orden del helper se ha revertido al del molde hermano y el guard dinámico está CIEGO sobre
este fichero (D-09/D-10). Recuperados (0):
```

`Recuperados (0)` es el punto: con el orden del molde, `markdown.js` pierde el **100 %** de sus
imports y el guard dinámico de ISO-01 no vería un `import('picocolors')` inyectado ahí.

**Revertida:** el fichero se restauró desde la copia previa a la mordida →
`# tests 14 · # pass 14 · # fail 0`.

## Por qué los tres comentarios de zona gris entraron en alcance en vez de diferirse

`87-RESEARCH.md` §Open Questions 2 dejó abierto si corregir aquí los comentarios que ISO-01 e
ISO-02 vuelven falsos o diferirlos a otra fase. **Se corrigen aquí**, y la razón es de coste
asimétrico, no de comodidad:

- **El coste de hacerlo es despreciable y acotado.** Son **tres ediciones de comentario**, cero
  comportamiento, en **dos ficheros que ningún otro plan de la fase toca**. El gate de que el
  cambio es doc-only está verificado mecánicamente: ninguna línea del `git diff -U0` de esos dos
  ficheros añade o quita código ejecutable, y `node --test test/dashboard-inbox-count.test.js`
  sigue en 14/0.
- **El coste de diferirlo es mayor que el de arreglarlo.** Diferir exige entrada en
  `deferred-items.md` con trigger escrito — más trabajo del que cuesta la corrección.
- **Y el coste real es el que no se mide en tiempo.** Esta fase existe porque un comentario
  declaraba un punto ciego que no tapaba. Cerrarla **dejando tres premisas falsas recién
  creadas** en el mismo repo sería reabrir el mismo pecado en otro fichero, con la fase que lo
  retira como testigo. La Phase 88 los encontraría y la corrección costaría lo mismo, más el
  descrédito del guard.

Lo que **no** se hizo, y es la mitad importante: se corrigió la **premisa**, jamás la
conclusión. La prohibición de importar `src/inbox/store.js` desde
`src/cli/dashboard/inbox-count.js` **se conserva íntegra**, con sus motivos vigentes escritos
(`withFileLock` y `resolveProjectId` en un módulo que solo cuenta líneas), y el comentario deja
constancia explícita de que *una prohibición puede sobrevivir a que se evapore su premisa
principal; lo que no puede es seguir apoyándose en ella*. El criterio
`grep -c 'PROHIBIDO importar' src/cli/dashboard/inbox-count.js` sigue en **2**, que existe justo
para que «corregir la premisa» no derive en «borrar la prohibición».

La evaporación de la premisa está **medida**, no supuesta: la clausura de `src/inbox/store.js`
son 6 ficheros y **ninguno** importa `picocolors` (el `:46` trae `stripForKeystroke` de
`../cli/sanitize.js` desde el plan `87-01`).

## Files Created/Modified

- `test/format-isolation.test.js` — **+152/-12**. Cabecera reescrita (declaración honesta de
  tres bloques), línea del JSDoc de `walkImports` reescrita, suite `ISO-03` con
  `ALLOWED_BUILTINS` y sus dos casos, suite `ISO-04` con el meta-test.
- `src/cli/dashboard/inbox-count.js` — **doc-only**. Premisa del bloque de prohibición
  corregida; la prohibición y sus dos motivos vigentes, intactos.
- `test/dashboard-inbox-count.test.js` — **doc-only**. Misma corrección en la cabecera; el
  argumento de fondo de D-17/D-18 (la duplicación de la gramática y su contrapartida) se
  conserva íntegro.

## Decisions Made

- **La allowlist se congela a un elemento y se declara literalmente**, nunca derivada del
  sujeto: una allowlist calculada a partir de lo que el sujeto importa siempre sale verde y no
  asevera nada (D-13/D-16). Es la única de toda la fase.
- **Tres asserts, no dos.** Los dos de forma dependen de que las regex vean la sintaxis; el de
  alcanzabilidad (`walkImports(...).size === 1`) sobreviviría a una forma de import que no
  vieran. El comentario lo dice para que nadie lo lea como redundante y lo borre.
- **El aserto positivo de convergencia no es decoración.** Sin él, mover `nextCell` fuera de
  `format.js` dejaría ISO-03 verde sobre un módulo huérfano: un guard de prohibición sobre algo
  que no usa nadie es verde y vacío (D-14).
- **La premisa retirada se describe, no se cita.** Es la trampa que el plan marcó como riesgo
  mayor y la que habría roto el criterio de aceptación de ISO-04.

## Deviations from Plan

Ninguna que altere el contrato. Una corrección de baseline, medida:

1. **`grep -c 'imports DIRECTOS' src/cli/dashboard/inbox-count.js` daba `1`, no `2`.** El plan
   escribió «HEAD: 2 y 1» para los dos ficheros; medido en `e4a3945` es **1 y 1**. La causa es
   que `grep -c` cuenta **líneas** con coincidencia, y en `inbox-count.js` la frase cabía en una
   sola línea (`:13`). No afecta al criterio, que exige `0` en ambos y se cumple; se registra
   porque este plan prohíbe dar por buena una cifra sin re-medirla, y eso vale también para las
   suyas.

**Total deviations:** 0 auto-fixes bajo las Reglas 1-4. Cero alcance añadido, cero dependencias,
cero asserts debilitados.

## Prohibiciones respetadas (verificadas, no afirmadas)

- `git diff --exit-code -- src/cli/dashboard/format.js src/cli/dashboard/select.js` → **0**.
  ISO-03 **congela**, no modifica: los dos ficheros que la suite asevera están sin tocar.
- `git diff --exit-code -- src/cli/dashboard/SessionTable.js src/cli/dashboard/index.js` → **0**
  (D-04).
- `git diff --exit-code -- test/check-isolation.test.js test/dispatcher-isolation.test.js` →
  **0**. El `stripComments` con bug de orden de los ficheros hermanos sigue **sin corregir** y
  no se extrajo ningún helper compartido — diferido con trigger escrito.
- `git diff --exit-code -- package.json package-lock.json` → **0**. Cero dependencias npm
  nuevas (invariante cross-milestone).
- **Ninguna allowlist nueva** más allá de `node:path` en el guard de hoja de ISO-03, justificada
  por medición. DEBT-04 sigue LOCKED y ningún assert se debilitó ni se relajó un umbral.
- **La prohibición de `inbox-count.js` no se retiró ni se debilitó**: solo su premisa.
- El punto ciego residual **no** se presenta como cerrado, mitigado ni improbable en ningún
  punto de la cabecera.

## Verificación final

| Comando | Resultado |
|---|---|
| `npm test` | `# tests 2612 · # suites 595 · # pass 2611 · # fail 0 · # skipped 1` (era 2609; criterio ≥ 2589) |
| `node --test test/format-isolation.test.js` | `# tests 14 · # suites 9 · # fail 0` (era 11) |
| `node --test test/check-isolation.test.js` | `# tests 12 · # fail 0` (sin tocar) |
| `node --test test/dashboard-inbox-count.test.js` | `# tests 14 · # fail 0` |
| `grep -c "el repo no lo usa\|el repo no los usa" test/format-isolation.test.js` | `0` (era 2) |
| `grep -c 'CUBRE'` / `grep -c 'NO CUBRE'` | `3` / `1` (era 0 / 0) |
| `grep -cE '2026-[0-9]{2}-[0-9]{2}' test/format-isolation.test.js` | `5` (era 0) |
| `grep -c 'providers/registry.js' test/format-isolation.test.js` | `1` (era 0) |
| `grep -c 'ALLOWED_BUILTINS' test/format-isolation.test.js` | `3` (era 0), declaración de **un** elemento |
| `grep -c 'walkImports' test/format-isolation.test.js` | `9` (era 7) |
| `grep -c 'imports DIRECTOS'` en los dos ficheros de zona gris | `0` y `0` (era 1 y 1) |
| `grep -c 'PROHIBIDO importar' src/cli/dashboard/inbox-count.js` | `2` (sin cambio — la prohibición sobrevive) |
| `git diff -U0` de los dos ficheros de zona gris | **doc-only**: ninguna línea `+`/`-` fuera de `//` |
| `git status --porcelain -- src test` | vacío tras la mordida C (árbol restaurado) |

## Issues Encountered

Ninguno. El `# skipped 1` de `npm test` es preexistente y no lo introdujo esta ejecución.

## Known Stubs

Ninguno. Los tres artefactos de este plan son asserts reales sobre sujetos reales, y el único
texto que no puede aseverar un test —la honestidad de la cabecera— va citado verbatim arriba
para su revisión humana, declarado como `backstop` en el plan y como `human_judgment: true` en
`coverage.D4`.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **La fase 87 queda cerrada en sus cuatro requisitos.** ISO-01/ISO-02 los cerró el `87-01`;
  ISO-03 e ISO-04 se cierran aquí.
- **Diferido vivo, con trigger:** el `stripComments` con bug de orden de
  `test/check-isolation.test.js:23-29` y `test/dispatcher-isolation.test.js:24-30` sigue sin
  corregir. Su trigger es el escrito en el `87-01`: se aborda cuando un guard de esos ficheros
  necesite ver imports de un fichero cegado por el orden. El meta-test de este plan protege
  **solo** la copia de `test/format-isolation.test.js`.
- **Punto ciego residual declarado y abierto:** `import()` con specifier computado. Hoy hay 0 en
  `src/`; el día que aparezca el primero, ningún guard del repo lo verá. Está escrito en la
  cabecera para que quien lo introduzca lo lea.

---
*Phase: 87-aislamiento-de-color-transitivo-en-el-tui*
*Completed: 2026-08-10*

## Self-Check: PASSED

- `.planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-02-SUMMARY.md` existe en disco.
- Los dos commits de tarea existen en el historial: `4b980b2`, `792f5eb`.
- Los tres ficheros modificados existen y están commiteados: `test/format-isolation.test.js`,
  `src/cli/dashboard/inbox-count.js`, `test/dashboard-inbox-count.test.js`.
