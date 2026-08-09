---
phase: 87-aislamiento-de-color-transitivo-en-el-tui
verified: 2026-08-10T00:00:00Z
status: human_needed
score: 5/5 criterios ROADMAP verificados (17/17 must_haves.truths de los dos planes verificados; 1 ítem de ratificación humana, no un gap)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Ratificar si el radio de ISO-01 debe extenderse a `src/providers/*`, `src/host/interface.js`, `src/interface.js` y `src/labels.js` (32 → 42 ficheros en la unión de clausuras del TUI), consecuencia de la siembra WR-02 que sigue aristas `import()` dinámicas con specifier literal fuera de `src/cli/dashboard/`."
    expected: "El dueño de la fase confirma por escrito (comentario de commit, entrada en STATE.md o equivalente) que acepta que un futuro import de `picocolors` en cualquiera de esos 10 ficheros ponga ISO-01 en rojo, aunque el cambio se haya hecho pensando solo en el carril CLI/proveedores y no en el TUI."
    why_human: "Es una decisión de alcance/criterio sobre el radio de una invariante cross-milestone (color-isolation, D-12), no un hecho verificable por grep o por ejecución de test. El propio `87-REVIEW-FIX.md` la marca explícitamente como pendiente de ratificación del dueño de la fase, distinta de las correcciones mecánicas del resto del review."
---

# Phase 87: Aislamiento de color transitivo en el TUI Verification Report

**Phase Goal:** La invariante color-isolation vuelve a ser verdad **medible**: ningún fichero de `src/cli/dashboard/` alcanza `picocolors`, ni siquiera transitivamente, y el guard lo detecta. Hoy el guard directo está verde mientras el leak existe en 3 ficheros.
**Verified:** 2026-08-10
**Status:** human_needed
**Re-verification:** No — verificación inicial

## Resumen del método

No me he fiado de los dos SUMMARY, del REVIEW ni del REVIEW-FIX como evidencia. Para cada afirmación clave he re-ejecutado el comando yo mismo, o he reconstruido el walker del grafo de imports de forma independiente y lo he corrido contra el árbol real, o he reintroducido a mano los dos leaks (mordida A y B) para comprobar que el guard efectivamente se pone rojo y que revertirlos lo deja verde, sin dejar el árbol sucio.

## Goal Achievement

### Observable Truths (Success Criteria del ROADMAP)

| # | Truth (ROADMAP SC) | Status | Evidencia |
|---|---|---|---|
| 1 | Un fichero del TUI que arrastre `picocolors` por una cadena transitiva pone el guard rojo (ISO-01), verificado reintroduciendo un leak real | ✓ VERIFIED | Reintroduje `import { stripControlChars } from '../format.js';` en `src/cli/dashboard/markdown.js` (revirtiendo el import real a `../sanitize.js`) → `node --test test/format-isolation.test.js` da `# tests 17 · # pass 15 · # fail 2`. Revertido → `17/17 · fail 0`. `git status --porcelain` limpio tras la mordida. |
| 2 | Los 3 leaks medidos están cerrados: `App.js`, `markdown.js`, `SessionTable.js` dejan de alcanzar `src/cli/format.js`; verde con el fix, rojo sin él | ✓ VERIFIED | Walker de imports reconstruido desde cero (no el del repo) y ejecutado contra `src/cli/dashboard/`: **NO STATIC LEAK FOUND** — ningún fichero del TUI alcanza `picocolors` por ninguna cadena de imports relativos. `grep -rnE "^import .*(stripControlChars\|stripForKeystroke)" src test \| grep -c "cli/format"` → `0`. |
| 3 | La pureza de `src/cli/dashboard/format.js` congelada por un test; una regresión que la rompa falla | ✓ VERIFIED | Leído `test/format-isolation.test.js:651-727` (suite ISO-03): `src/cli/dashboard/format.js` tiene un único import (`node:path`, allowlist de un elemento, congelada literalmente), su clausura transitiva es exactamente él mismo (`assert.deepEqual` sobre el CONTENIDO, no solo `size`, tras el fix de WR-03), y ningún miembro de la clausura importa `picocolors`. Aserto positivo de convergencia (`select.js` sigue consumiendo `./format.js`) presente y verde. |
| 4 | `test/format-isolation.test.js` no declara ningún punto ciego en falso; el comentario «el repo no lo usa» de `:14` y `:33` desaparece | ✓ VERIFIED | `grep -c "el repo no lo usa" test/format-isolation.test.js` → `0`. `grep -c "el repo no los usa"` → `0`. La cabecera (`:15-63`) contiene un bloque CUBRE/NO CUBRE/MEDICIÓN FECHADA que nombra el residual (`import()` con specifier computado) sin presentarlo como cerrado. |
| 5 | El dashboard renderiza idéntico y `stripControlChars` sigue disponible para todo consumidor legítimo — cero regresión, suite verde | ✓ VERIFIED | `npm test` → `# tests 2615 · # fail 0 · # skipped 1`. Los 5 ficheros de baseline (D-17) dan `183` tests combinados (`9+44+33+22+75`) con `0` fallos, y `git log` confirma que ninguno de esos 4 goldens fue tocado por ningún commit de la fase (`c68136a..ba4f675`). |

**Score:** 5/5 criterios ROADMAP verificados. 0 present-behavior-unverified.

### Cobertura granular (must_haves.truths de los dos planes)

Verificación adicional, no solo de los 5 SC del ROADMAP sino de los ~17 must_haves.truths declarados en el frontmatter de `87-01-PLAN.md` y `87-02-PLAN.md`, con re-medición propia allí donde era mecánicamente posible:

| Plan | Truth | Status | Evidencia propia |
|---|---|---|---|
| 87-01 | Guard transitivo, mensaje con cadena (no conjunto) | ✓ VERIFIED | Código en `:469-494` construye `chains` con `findChainToPicocolors` (BFS con mapa de padres) y las une con `→`; confirmado en la mordida A que el mensaje imprime cadenas, no un `Set`. |
| 87-01 | `import()` dinámico pone rojo con `stripComments` de orden corregido | ✓ VERIFIED | Mordida B independiente: inyecté `const _pc = await import('picocolors');` tras `const FENCE` en `markdown.js` → `17 tests, 1 fail`. Revertido → `17/17`. |
| 87-01 | `sanitize.js` hoja de cero imports, saneadores byte-idénticos | ✓ VERIFIED | `diff <(git show 61a5c95:src/cli/format.js \| sed -n '60,123p') <(sed -n '26,89p' src/cli/sanitize.js)` → salida vacía (ejecutado por mí, no citado del SUMMARY). Leí el fichero completo: cero imports, ningún `node:*`. |
| 87-01 | Cero imports residuales de saneadores desde `cli/format.js`; 8 consumidores intactos | ✓ VERIFIED | `grep -rnE "^import .*(stripControlChars\|stripForKeystroke)" src test \| grep -c "cli/format"` → `0`; `grep -rlnE` de los mismos → 17 ficheros listados (incluye tests), consistente con "ningún consumidor perdido". |
| 87-01 | Los 2 guards de `manager.test.js` re-anclados sin perder condiciones | ✓ VERIFIED | `grep -nE "cli\\\\/format\\\\.js\|cli\\\\/sanitize\\\\.js" test/manager.test.js` → ambas líneas (`:865`, `:899`) apuntan a `sanitize.js`; `node --test test/manager.test.js` en la corrida combinada dio 0 fallos. |
| 87-01 | Suite completa ≥ 2589, `# fail 0` | ✓ VERIFIED | `npm test` → 2615/0 fail (medido por mí, no transcrito). |
| 87-02 | `format.js` congelado: 0 relativos, allowlist `node:path`, clausura = él mismo | ✓ VERIFIED | Leído código `:657-708`; `node --test` sobre el fichero pasa. |
| 87-02 | `select.js` sigue consumiendo `./format.js` (convergencia D-14) | ✓ VERIFIED | Código `:716-726`, `walkImports(select.js).has(formatPath)`. |
| 87-02 | Sin premisa falsa; cabecera CUBRE/NO CUBRE/fechada | ✓ VERIFIED | Grep en `0`; leída la cabecera completa (`:15-63`), no cita literalmente la premisa retirada (la describe por contenido), fecha `2026-08-10`. |
| 87-02 | Meta-test `stripComments` no ciega sobre `markdown.js`, con precondición aseverada | ✓ VERIFIED | Código `:743-808`: aserta que `markdown.js` conserva la glob `src/cli/dashboard/**` como disparador, compara el orden corregido (`>0` imports) contra el orden hermano (`[]` imports) en vez de congelar una constante — corrige exactamente el defecto WR-04 señalado por el review. |
| 87-02 | Los 3 comentarios que ISO-01/02 vuelven falsos, corregidos sin perder la prohibición | ✓ VERIFIED | `grep -c 'imports DIRECTOS'` → `0` en ambos ficheros; `grep -c 'PROHIBIDO importar' src/cli/dashboard/inbox-count.js` → `2`; leído el bloque completo, la prohibición sobrevive con sus motivos (`withFileLock`, `resolveProjectId`). |
| 87-02 | Cero regresión `dashboard-inbox-count.test.js` (14/0) | ✓ VERIFIED | `node --test test/dashboard-inbox-count.test.js` → `14 tests, 0 fail`. |
| 87-01/02 | Mordidas backstop (manual-only, D-15) | ✓ VERIFIED | Reproducidas de forma independiente por mí (no las del SUMMARY), ver filas 1 y 2 de la tabla de criterios ROADMAP arriba. |
| 87-02 | Revisión de honestidad de la cabecera (backstop, human_judgment) | ✓ VERIFIED (juicio propio) | Leída la cabecera verbatim: nombra las pruebas de que la premisa retirada era falsa (`registry.js:27,28,57,58`, `state.js:247`), no la cita literalmente, declara el residual (specifier computado) sin venderlo como cerrado, y la cifra va fechada. Re-medí el método yo mismo (ver tabla siguiente) y coincide exactamente. |

### Re-medición independiente de la cifra fechada de la cabecera

La cabecera de `test/format-isolation.test.js:46-49` afirma «99 ficheros `.js` de `src/`, 129 `import()` con specifier literal en 26 ficheros, 0 computados, medido el 2026-08-10». Implementé el mismo método (recorrer `.js` de `src/`, aplicar el `stripComments` de orden corregido, contar `import(` con y sin specifier entrecomillado) en un script separado, sin usar ningún código del propio fichero de guard:

```
files: 99
literal import(): 129 in 26 files
computed-ish import(: 0
```

Coincide exactamente con lo declarado. No es una cifra transcrita ni del SUMMARY ni de `87-RESEARCH.md` (que medía 128/26/98 el 2026-08-05) — es una medición mía, hecha hoy, con mi propia implementación del método.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/cli/sanitize.js` | Módulo nuevo, hoja de cero imports, `stripControlChars` + `stripForKeystroke` byte-idénticos | ✓ VERIFIED | Existe, 89 líneas, cero imports; `diff` byte a byte contra `61a5c95:src/cli/format.js:60-123` vacío (ejecutado por mí). |
| `test/format-isolation.test.js` — suites ISO-01..ISO-06 | Guard transitivo, guard dinámico, hoja `sanitize.js`, pureza `format.js`, declaración honesta, guard del guard, guard del sustrato, prohibición D-17 | ✓ VERIFIED | Las 6 suites nuevas existen y están implementadas (no solo nombradas): confirmado leyendo el código de cada una, líneas 469-865. |
| `src/cli/dashboard/inbox-count.js` | Premisa de la prohibición corregida, conclusión intacta | ✓ VERIFIED | Comentario reescrito (`:9-26`), `grep -c 'PROHIBIDO importar'` → 2. |
| `test/dashboard-inbox-count.test.js` | Cabecera corregida | ✓ VERIFIED | Comentario reescrito (`:5-16`), sin la doble falsedad. |
| `src/inbox/store.js` | JSDoc de `sanitizeText` re-apunta a `sanitize.js` (fix WR-05) | ✓ VERIFIED | Línea `:300` dice «se hace aquí y no en `sanitize.js`, que es la hoja compartida…», con nota explícita del cambio de dueño. |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `src/cli/dashboard/App.js`, `markdown.js`, `SessionTable.js` (indirecto) | `src/cli/sanitize.js` | import re-apuntado | ✓ WIRED | Confirmado con grep y lectura de código; ningún fichero de producción importa el saneador desde `cli/format.js`. |
| `test/format-isolation.test.js` (ISO-01) | grafo de `src/cli/dashboard/` | `listJsFiles` + `walkImports` por-entry + `unionClausurasTui` (sembrada) | ✓ WIRED | Reconstruido el walker de forma independiente y ejecutado: 16 ficheros TUI → 32 en clausura estática → 42 en la unión sembrada (WR-02). Cifras idénticas a las declaradas en `87-REVIEW-FIX.md`, verificadas con mi propia implementación, no citadas. |
| `test/manager.test.js` | `src/cli/sanitize.js` | regex de source-grep re-anclada | ✓ WIRED | Los dos `assert.ok` (`:865`, `:899`) casan contra `'../cli/sanitize.js'`; `git diff -U0` (leído, no re-ejecutado por mí porque el árbol ya está en HEAD tras merge) toca solo esas líneas más comentarios, según lo documentado y consistente con el resto de asserts intactos que sí ejecuté. |
| `src/cli/dashboard/select.js` | `src/cli/dashboard/format.js` | import estático, aserto positivo D-14 | ✓ WIRED | Confirmado en el código de ISO-03, caso `select.js consume ./format.js`. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Guard transitivo muerde (mordida A, reproducida por el verificador) | Reintroducir import estático del saneador desde `../format.js` en `markdown.js`, correr `node --test test/format-isolation.test.js` | `17 tests · 15 pass · 2 fail` → revertido → `17/17 · 0 fail` | ✓ PASS |
| Guard dinámico muerde (mordida B, reproducida por el verificador) | Inyectar `const _pc = await import('picocolors');` en `markdown.js`, correr el mismo comando | `17 tests · 16 pass · 1 fail` → revertido → `17/17 · 0 fail` | ✓ PASS |
| Ningún fichero de `src/cli/dashboard/` alcanza `picocolors` (walker independiente) | Script propio (no el del repo) recorriendo `src/cli/dashboard/` con `extractImports`/`walkImports` reimplementados | `NO STATIC LEAK FOUND` | ✓ PASS |
| Cifra fechada de la cabecera (re-medición independiente) | Script propio aplicando el método descrito en la cabecera sobre `src/` | `99 files, 129 literal in 26 files, 0 computed` — coincide exactamente | ✓ PASS |
| Suite completa | `npm test` | `# tests 2615 · # fail 0 · # skipped 1` | ✓ PASS |
| `format-isolation.test.js` en solitario | `node --test test/format-isolation.test.js` | `# tests 17 · # fail 0` | ✓ PASS |
| Baseline de los 5 ficheros de D-17 + `inbox-cli` | `node --test test/dashboard-markdown.test.js test/format.test.js test/stop.test.js test/inbox-format-golden.test.js test/inbox-cli.test.js` | `# tests 183 · # fail 0` (9+44+33+22+75) | ✓ PASS |
| Sin edición de goldens durante la fase | `git log --oneline c68136a..ba4f675 -- test/dashboard-markdown.test.js test/format.test.js test/stop.test.js test/inbox-format-golden.test.js` | sin salida | ✓ PASS |
| Sin debt markers en ficheros tocados | `grep -nE "TBD\|FIXME\|XXX"` sobre los ficheros modificados | sin salida | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| ISO-01 | 87-01 | Guard detecta arrastre transitivo, no solo import directo | ✓ SATISFIED | Suite ISO-01 (estática + dinámica), mordidas A y B reproducidas independientemente. |
| ISO-02 | 87-01 | Los 3 leaks reales medidos quedan cerrados | ✓ SATISFIED | Walker independiente: `NO STATIC LEAK FOUND`; grep de imports residuales → 0. |
| ISO-03 | 87-02 | Pureza de `dashboard/format.js` congelada por test | ✓ SATISFIED | Suite ISO-03: 0 relativos, allowlist de 1, clausura = él mismo, convergencia con `select.js`. |
| ISO-04 | 87-01 + 87-02 | Guard cubre `import()` dinámico o declara con honestidad lo que no cubre | ✓ SATISFIED | Cabecera reescrita (grep en 0 de la premisa falsa), residual nombrado sin cerrarlo, cifra re-medida por mí y coincidente. |

No hay requisitos huérfanos: los cuatro IDs de `REQUIREMENTS.md` (`ISO-01..04`) aparecen en el `requirements:` de al menos uno de los dos planes, y las cuatro filas de `REQUIREMENTS.md` ya están marcadas `[x]` / `Complete`.

### Anti-Patterns Found

Ninguno bloqueante. Se revisó adicionalmente el propio proceso de code review de la fase: `87-REVIEW.md` encontró 1 Critical (`CR-01`, el sustrato `extractImports` era ciego a 4 formas ESM válidas sin whitespace, lo que dejaba **todos** los guards nuevos vulnerables a burlarse — el peor fallo posible para esta fase) y 6 Warnings (asserts que podían pasar vacíos o estaban tautológicamente implicados, más 2 comentarios con premisas caducadas). `87-REVIEW-FIX.md` documenta los 7 corregidos con evidencia de mordida por cada uno. Verifiqué independientemente que las correcciones están en el código actual y no solo en el reporte:

- **CR-01** (regex sin whitespace obligatorio): confirmado en `test/format-isolation.test.js:80-81` — las regex actuales usan lookahead en vez de `\s+` obligatorio, y la suite ISO-05 (`:819-865`) ata 8 formas positivas y 3 negativas, incluida la línea real de `cmux/client.js` que produjo el falso positivo al primer intento de fix.
- **WR-01** (ISO-01 podía pasar vacío): confirmado, `assertTuiNoVacio` (`:404-411`) se invoca en ambos casos de ISO-01 antes de recorrer nada.
- **WR-02** (radio del guard dinámico limitado al TUI): confirmado y re-medido por mí de forma independiente — `unionClausurasTui` amplía la unión de 32 a 42 ficheros siguiendo aristas dinámicas literales; ver ítem de ratificación humana abajo.
- **WR-03** (tercer assert de ISO-03 tautológico): confirmado, el assert actual compara CONTENIDO de la clausura y añade un assert de "ningún miembro importa picocolors", no solo `size === 1`.
- **WR-04** (meta-test ISO-04 con precondición no aseverada): confirmado, el caso actual asevera `src.includes('src/cli/dashboard/**')` antes de comparar.
- **WR-05** (JSDoc caducado en `store.js`): confirmado, reapunta a `sanitize.js`.
- **WR-06** (prohibición D-17 sin guard automático): confirmado, existe la suite ISO-06 nueva (`:612-631`) que hace la clausura de `inbox-count.js` y comprueba que no contiene `store.js`.

Los 6 `IN-*` (info) quedaron fuera de alcance de la pasada de fix por configuración explícita (`fix_scope: critical_warning`) — son mejoras de calidad menores (asimetría de `stripComments` en el walker estático, código muerto declarado, citas de línea desincronizadas, discrepancia 7-vs-8 en un comentario, ubicación de tests de comportamiento, JSDoc sin mencionar un residual preexistente). Ninguno de ellos compromete el goal de la fase ni está en el radio de los requisitos ISO-01..04; no los elevo a gap.

## Ítem de ratificación humana (no es un gap)

`87-REVIEW-FIX.md` marca explícitamente un punto para que lo ratifique el dueño de la fase, no para que lo resuelva el ejecutor ni el verificador: la corrección WR-02 amplía la unión de clausuras que ISO-01 vigila de 32 a 42 ficheros, siguiendo las aristas `import()` dinámicas con specifier literal que salen de `src/cli/dashboard/` (`index.js → host/interface.js, providers/registry.js, providers/plane/client.js`; `registry.js → plane/provider.js, github/provider.js`). Verifiqué la cifra de forma independiente (32 estático → 42 sembrado, ver tabla de Key Links) y confirmo que hoy no hay ninguna violación viva en los 10 ficheros nuevos.

La consecuencia declarada es real y no está mitigada por ningún mecanismo automático: si en el futuro cualquiera de esos 10 ficheros (`src/providers/*`, `src/host/interface.js`, `src/interface.js`, `src/labels.js`) importa `picocolors` — pensando solo en el carril CLI, sin tener en mente el TUI — ISO-01 se pondrá rojo. El propio informe de fix argumenta que ese rojo sería correcto (el TUI carga esos módulos de verdad en producción, así que el color entraría en su grafo), pero es una decisión de radio de la invariante que amplía su alcance más allá del directorio literal `src/cli/dashboard/`, y por eso queda como ítem de ratificación humana en vez de como hallazgo cerrado por mí.

## Gaps Summary

Ninguno. Los 5 criterios de éxito del ROADMAP y los ~17 must_haves.truths de los dos planes están verificados con evidencia propia (no transcrita de los SUMMARY), incluidas las dos mordidas manuales reproducidas de forma independiente y la re-medición de la cifra fechada de la cabecera. El único punto pendiente es una ratificación de alcance explícitamente delegada al dueño de la fase por el propio proceso de code-review, no un defecto.

---

_Verified: 2026-08-10_
_Verifier: Claude (gsd-verifier)_
