---
phase: 87-aislamiento-de-color-transitivo-en-el-tui
plan: 01
subsystem: testing
tags: [import-graph, color-isolation, picocolors, sanitize, source-hygiene, guards]

# Dependency graph
requires:
  - phase: 34-dashboard-tui
    provides: "invariante D-12 color-isolation (todo el color del TUI sale de ink <Text>)"
  - phase: 72-hygiene
    provides: "stripControlChars con las tres fases de saneo (CSI / C0 / C1)"
  - phase: 78-keystroke-hardening
    provides: "stripForKeystroke (WR-02) y los guards source-grep de manager.test.js"
  - phase: 85-check-isolation
    provides: "precedente locked del source-grep de import() dinámico sobre la salida del walker (D-09 / WR-03)"
provides:
  - "Guard TRANSITIVO ISO-01: los 16 ficheros de src/cli/dashboard/ como entry point, con mensaje de CADENA (no de conjunto)"
  - "Guard DINÁMICO ISO-01/ISO-04: source-grep de import() con specifier literal sobre la unión de las clausuras del TUI"
  - "stripComments con el ORDEN CORREGIDO (líneas // → bloques → líneas *) y su medición citada"
  - "findChainToPicocolors: BFS aditivo con mapa de padres, cadena más corta, solo en el camino de fallo"
  - "src/cli/sanitize.js: hoja de cero imports con stripControlChars y stripForKeystroke byte-idénticos"
  - "Los 3 leaks transitivos del TUI cerrados (App.js, markdown.js, SessionTable.js)"
affects: [87-02, ISO-03, ISO-04, dashboard/format.js, declaración honesta de la cabecera]

actuals:
  tokens: 86650
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Guard transitivo por-entry: iterar CADA fichero del directorio como entry point hace innecesario seguir aristas dinámicas dentro del walker"
    - "Reconstrucción de cadena por BFS separado del walker, invocado SOLO en el camino de fallo"
    - "Módulo-contrato hoja de cero imports (cuarto del repo, tras handoff.js, pending.js y logger-noop.js)"

key-files:
  created:
    - src/cli/sanitize.js
  modified:
    - test/format-isolation.test.js
    - src/cli/format.js
    - src/cli/dashboard/App.js
    - src/cli/dashboard/markdown.js
    - src/cli/inbox.js
    - src/cli/capture.js
    - src/hooks/stop.js
    - src/inbox/store.js
    - src/session/manager.js
    - test/dashboard-format.test.js
    - test/manager.test.js

key-decisions:
  - "El ancla del guard es el PAQUETE picocolors, no src/cli/format.js: un segundo importador futuro escaparía a un ancla al fichero (D-07)"
  - "stripComments diverge a propósito de los helpers hermanos: su orden verbatim ciega el guard justo sobre markdown.js, leaker primario de esta fase (D-09/D-10)"
  - "Sin shim de re-export en format.js (D-02): los 8 call sites se actualizan y el camino correcto es el único disponible"
  - "El bloque movible es contiguo (format.js:60-123), no los dos rangos separados que citaba D-01: cortarlos partiría el JSDoc y rompería la byte-identidad"
  - "Los dos asserts de manager.test.js cambian de carril canónico sin perder ni una condición — no es relajación de DEBT-04"

patterns-established:
  - "Guard de alcanzabilidad (walkImports) además de guards de forma (extractImports): el primero es el que muerde"
  - "Mordida manual documentada con diff + mensaje + conteo en vez de infraestructura de mutation testing (D-15)"

requirements-completed: [ISO-01, ISO-02, ISO-04]

coverage:
  - id: D1
    description: "Un fichero del TUI que arrastre picocolors por una cadena TRANSITIVA de imports pone el guard rojo, y el mensaje imprime la cadena, no el conjunto"
    requirement: ISO-01
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#ningún fichero del TUI alcanza picocolors por ninguna cadena de imports estáticos"
        status: pass
      - kind: manual_procedural
        ref: "mordida A (reintroducción del import estático en markdown.js) — ROJO con 3 cadenas, revertida VERDE"
        status: pass
    human_judgment: false
  - id: D2
    description: "Un import() DINÁMICO de picocolors dentro del grafo del TUI también pone el guard rojo, con stripComments de orden corregido delante del match"
    requirement: ISO-04
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#ningún fichero del grafo del TUI hace import() DINÁMICO de picocolors (ISO-01/ISO-04)"
        status: pass
      - kind: manual_procedural
        ref: "mordida B (await import('picocolors') en markdown.js) — ROJO con la violación impresa, revertida VERDE"
        status: pass
    human_judgment: false
  - id: D3
    description: "Los 3 leaks medidos están cerrados: App.js, markdown.js y SessionTable.js dejan de alcanzar picocolors"
    requirement: ISO-02
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#ningún fichero del TUI alcanza picocolors por ninguna cadena de imports estáticos"
        status: pass
      - kind: other
        ref: "grep -rnE \"^import .*(stripControlChars|stripForKeystroke)\" src test | grep -c \"cli/format\" → 0"
        status: pass
    human_judgment: false
  - id: D4
    description: "Los saneadores viven en una hoja de cero imports (src/cli/sanitize.js) y llegan a sus ocho consumidores sin shim"
    requirement: ISO-02
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#src/cli/sanitize.js existe y tiene cero imports (incluidos builtins)"
        status: pass
      - kind: other
        ref: "node -e import('./src/cli/sanitize.js') → exports stripControlChars y stripForKeystroke; 8 ficheros consumidores"
        status: pass
    human_judgment: false
  - id: D5
    description: "El movimiento es byte-idéntico: ni una regex de saneo reescrita, ni un golden actualizado"
    requirement: ISO-02
    verification:
      - kind: other
        ref: "diff <(git show 61a5c95:src/cli/format.js | sed -n '60,123p') <(sed -n '26,$p' src/cli/sanitize.js) → salida vacía"
        status: pass
      - kind: integration
        ref: "npm test → # tests 2609 # fail 0; los 5 ficheros de D-17 con conteos idénticos al baseline"
        status: pass
    human_judgment: false
  - id: D6
    description: "Ningún assert se debilitó: los dos guards de manager.test.js conservan todas sus condiciones y solo cambian de carril canónico"
    requirement: ISO-02
    verification:
      - kind: other
        ref: "git diff -U0 -- test/manager.test.js → solo 2 líneas de regex, 2 mensajes y 2 bloques de comentario"
        status: pass
    human_judgment: true
    rationale: "El diff acredita el alcance mecánicamente, pero que un cambio de carril canónico NO sea una relajación de DEBT-04 es un juicio de revisor; el párrafo de justificación está escrito abajo y en el commit."

# Metrics
duration: 16 min
completed: 2026-08-09
status: complete
---

# Phase 87 Plan 01: El guard que ve la cadena + la hoja `src/cli/sanitize.js` Summary

**Guard de import-graph que detecta `picocolors` por vía transitiva e imprime la cadena exacta, y el corte real del leak: los dos saneadores puros salen de `src/cli/format.js` (único importador del paquete de color) a una hoja nueva de cero imports, con los 8 call sites re-apuntados y el movimiento verificado byte a byte.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-08-09T21:58:00Z (aprox.)
- **Completed:** 2026-08-09T22:14:50Z
- **Tasks:** 3
- **Files modified:** 12 (1 creado, 11 modificados)

## `phase_base_sha`

```
f00aabd897096e1f40788889447e75fd12e0d796   (f00aabd)
```

**Nota de re-medición.** Todos los valores del plan se midieron contra `61a5c95`. El SHA base
real de esta ejecución es `f00aabd`, que trae cambios en `src/session/manager.js` y
`test/manager.test.js` (Phase 86). Se re-midieron en vivo **todos** los baselines relevantes
antes de tocar nada, y **coinciden uno a uno** con los del plan:

| Fichero | Baseline del plan (`61a5c95`) | Medido en `f00aabd` |
|---|---|---|
| `test/format-isolation.test.js` | 8 / 0 fail | 8 / 0 fail |
| `test/dashboard-format.test.js` | 58 | 58 |
| `test/dashboard-markdown.test.js` | 9 | 9 |
| `test/format.test.js` | 44 | 44 |
| `test/stop.test.js` | 33 | 33 |
| `test/inbox-format-golden.test.js` | 22 | 22 |
| `test/manager.test.js` | 62 | 62 |
| `test/inbox-cli.test.js` | 75 | 75 |
| `test/check-isolation.test.js` | 12 | 12 |
| call sites que importan un saneador desde `cli/format.js` | 8 | 8 |

Además, el bloque `src/cli/format.js:60-123` es **byte-idéntico** en `f00aabd` y en `61a5c95`
(verificado con `diff` sobre `git show`), así que el criterio de byte-identidad del plan se
pudo aplicar literalmente contra `61a5c95` tal como estaba escrito.

## Accomplishments

- **El guard ve la cadena.** `test/format-isolation.test.js` pasa de 8 a 11 tests: guard
  transitivo por-entry (los 16 ficheros del TUI como entry point), guard de `import()`
  dinámico sobre la unión de las clausuras, y guard de hoja de cero imports para el módulo
  nuevo. El mensaje de fallo imprime la **cadena** de imports, no el conjunto del grafo.
- **Los 3 leaks están cerrados.** `App.js`, `markdown.js` y `SessionTable.js` ya no alcanzan
  `picocolors` por ninguna cadena de imports estáticos.
- **El movimiento es byte-idéntico.** El bloque contiguo `format.js:60-123` (JSDoc + cuerpo de
  `stripControlChars`, línea en blanco, JSDoc + cuerpo de `stripForKeystroke`) está en
  `src/cli/sanitize.js` carácter a carácter. `diff` contra `git show 61a5c95` sale vacío.
- **Los 8 call sites, no 5.** Los tres que D-01 no contaba (`capture.js`, `hooks/stop.js`,
  `inbox/store.js`) consumen `stripForKeystroke` en carriles vivos; sin shim (D-02), omitir
  cualquiera habría sido un fallo en **tiempo de carga**.
- **El guard muerde, demostrado.** Dos mordidas manuales con diff, mensaje y conteo citados
  abajo; ambas revertidas y el árbol restaurado.

## Task Commits

1. **Tarea 1: guard transitivo + dinámico, escrito y ROJO** — `c68136a` (test)
2. **Tarea 2: la hoja `src/cli/sanitize.js` y los OCHO call sites** — `04a75d9` (refactor)
3. **Tarea 3: re-anclar los dos guards de `manager.test.js`** — `40e5a49` (test)

## Evidencia — Tarea 1: la corrida ROJA contra el árbol pre-fix

`node --test test/format-isolation.test.js`, **exit 1**:

```
# tests 11
# suites 7
# pass 9
# fail 2
```

Las **tres** cadenas impresas, verbatim (no cuatro: `index.js` no aparece porque su arista a
`App.js` es dinámica y el walker es estático a propósito — D-06):

```
Color del TUI debe salir de ink <Text>, no de picocolors (D-12) — ni por vía TRANSITIVA.
Cadenas de import que alcanzan picocolors:
  - src/cli/dashboard/App.js
     → src/cli/format.js
  - src/cli/dashboard/SessionTable.js
     → src/cli/dashboard/markdown.js
     → src/cli/format.js
  - src/cli/dashboard/markdown.js
     → src/cli/format.js
Corta la PRIMERA arista de cada cadena: el saneador de texto vive en src/cli/sanitize.js (hoja sin color), no en src/cli/format.js.
```

El segundo fallo es el assert anti-vacuidad de la suite ISO-02:

```
src/cli/sanitize.js must exist after Plan 87-01 — otherwise this isolation test passes trivially
```

El guard **dinámico** salió VERDE en esta corrida, por construcción (0 `import()` dinámicos de
`picocolors` en `src/`). Su mordida es la B, más abajo.

Gates de alcance de la Tarea 1, todos verificados: `walkImports` (`:40-52` en `61a5c95`) queda
**byte-idéntico** (`diff` vacío), el bloque TUI-04 (`:200-221`) queda **byte-idéntico**
(`diff` vacío), y `git diff --exit-code -- src/ package.json package-lock.json` sale 0 — la
tarea no tocó producción ni añadió dependencias.

## Evidencia — Mordida A (estática): D-15

Diff exacto de la reintroducción del leak en `src/cli/dashboard/markdown.js`:

```diff
@@ -24,7 +24,7 @@
 import { Text } from 'ink';
 import { createElement as h } from 'react';
 import { stripHandoffMarker } from '../../session/handoff.js';
-import { stripControlChars } from '../sanitize.js';
+import { stripControlChars } from '../format.js';

 /** Delimitador de code fence (triple comilla invertida). */
 const FENCE = '```';
```

Conteo de la corrida roja (`node --test test/format-isolation.test.js`, **exit 1**):

```
# tests 11
# suites 7
# pass 10
# fail 1
```

Mensaje de fallo íntegro, con las **tres** cadenas:

```
Color del TUI debe salir de ink <Text>, no de picocolors (D-12) — ni por vía TRANSITIVA.
Cadenas de import que alcanzan picocolors:
  - src/cli/dashboard/App.js
     → src/cli/dashboard/SessionTable.js
     → src/cli/dashboard/markdown.js
     → src/cli/format.js
  - src/cli/dashboard/SessionTable.js
     → src/cli/dashboard/markdown.js
     → src/cli/format.js
  - src/cli/dashboard/markdown.js
     → src/cli/format.js
Corta la PRIMERA arista de cada cadena: el saneador de texto vive en src/cli/sanitize.js (hoja sin color), no en src/cli/format.js.
```

Nótese que aquí la cadena de `App.js` pasa por `SessionTable.js → markdown.js` (3 saltos), no
directa: con el leak concentrado en `markdown.js`, la cadena más corta desde `App.js` es la que
hereda. Es exactamente la propiedad que justifica la elección de `markdown.js` como sujeto de la
mordida — **no** por el tamaño del muro de salida (con el mensaje basado en cadenas de D-07 esa
razón desapareció), sino porque es el leak con la cadena más corta y el único que además
ejercita la herencia por `SessionTable.js`.

**Revertida:** `git checkout -- src/cli/dashboard/markdown.js` → `# tests 11 # fail 0`.

## Evidencia — Mordida B (dinámica)

Diff exacto de la inyección:

```diff
@@ -28,6 +28,7 @@ import { stripControlChars } from '../sanitize.js';

 /** Delimitador de code fence (triple comilla invertida). */
 const FENCE = '```';
+const _pc = await import('picocolors');

 /**
  * Renderiza un array de líneas de markdown a un array de `<Text>` (uno por línea), en el
```

Conteo de la corrida roja (**exit 1**):

```
# tests 11
# suites 7
# pass 10
# fail 1
```

La línea de violación, con la forma exigida:

```
un fichero del grafo del TUI carga picocolors por import() dinámico (la invariante de color-isolation se rompería con el guard estático en VERDE) vía:
  src/cli/dashboard/markdown.js → import('picocolors')
```

Lo decisivo: el guard **estático** se quedó VERDE en esta corrida (1 solo fallo, el dinámico).
Eso es precisamente el punto ciego que ISO-04 cierra. Y queda demostrado que `stripComments`
con el orden corregido **no** ciega el guard sobre este fichero — con el helper verbatim de
`test/check-isolation.test.js:23-29`, el comentario de línea de `markdown.js:14` abriría un
bloque falso que se traga el fichero y la corrida daría **0 hits**.

**Revertida:** `git checkout -- src/cli/dashboard/markdown.js` → `# tests 11 # suites 7 # pass 11 # fail 0`.
`git status --porcelain -- src/cli/dashboard/markdown.js` no muestra nada: el árbol quedó
restaurado tras ambas mordidas.

## Por qué actualizar los dos asserts de `test/manager.test.js` NO debilita ningún guard

DEBT-04 está **LOCKED** y esta ejecución no lo toca. Los dos `assert.ok` de
`test/manager.test.js` que cambiaron exigen exactamente lo mismo que antes: que
`src/session/manager.js` importe el saneador desde el **carril canónico** —no que lo tenga
suelto, no que lo recree inline, no que lo traiga de `cmux/client.js` (invariante
cmux-isolation)—. Lo único que se movió es **cuál es ese carril**: los saneadores dejaron de
vivir en `cli/format.js` y viven en `cli/sanitize.js`. Un assert anclado al carril viejo no
sería un guard más estricto; sería un guard que describe un carril que ya no existe, es decir
un guard que se puede satisfacer sin cumplir la invariante que protege.

La prueba de que no hubo relajación es lo que **no** se tocó, y es comprobable con
`git diff -U0 -- test/manager.test.js`, cuyo diff toca únicamente **dos líneas de regex, sus
dos mensajes y dos bloques de comentario**:

- Los dos asserts de **interpolación** siguen intactos: `task.ref`, `task.title` y
  `projectPath` deben seguir envueltos en `stripForKeystroke` en el nudge de lanzamiento, y
  `task.title` en `stripControlChars` en los carriles de render (nombre de workspace, body del
  notify).
- Los dos **negativos de regresión** siguen intactos: el campo crudo sin sanear no puede
  reaparecer en el `send`, y `stripControlChars` (que preserva `\n`) sigue prohibido dentro del
  carril de keystroke — el residuo de Enter espurio que WR-02 cerró.

Ni un assert menos, ni un umbral movido, ni una allowlist añadida, ni un golden actualizado.
`node --test test/manager.test.js` da `# tests 62 # fail 0`, idéntico al baseline. La distinción
está escrita también en el mensaje del commit `40e5a49`, para que un revisor que vea «tocar un
guard» sin contexto no lo lea como relajación.

## Files Created/Modified

- `src/cli/sanitize.js` — **NUEVO**. Hoja de cero imports (cuarto módulo-contrato del repo tras
  `handoff.js`, `pending.js` y `logger-noop.js`). Cabecera con los cinco elementos del molde,
  incluida la prohibición explícita del shim de re-export (D-02). Cuerpo = `format.js:60-123`
  byte a byte.
- `src/cli/format.js` — Se elimina el bloque `60-123`. Conserva `createFormatter`,
  `_resolveUseColor`, `visibleWidth`, `padCell`, `formatRow`, `formatTable` y el import de
  `picocolors` de `:18`: sigue siendo su único importador (guard single-source verde).
- `test/format-isolation.test.js` — `+201` líneas: `stripComments` (orden corregido),
  `DYNAMIC_PICOCOLORS_RE`, `importsPicocolors`, `findChainToPicocolors`, suites ISO-01 y ISO-02.
- `src/cli/dashboard/App.js`, `src/cli/dashboard/markdown.js`, `src/hooks/stop.js`,
  `src/inbox/store.js`, `src/session/manager.js`, `test/dashboard-format.test.js` — sustitución
  de path pura.
- `src/cli/inbox.js`, `src/cli/capture.js` — el import se **parte en dos**: `createFormatter`
  se queda en `./format.js`, el saneador pasa a `./sanitize.js`.
- `test/manager.test.js` — los dos asserts source-grep re-anclados al carril canónico nuevo.

## Decisions Made

- **Ancla al paquete, no al fichero.** El guard busca `picocolors`, no `src/cli/format.js`. Hoy
  son equivalentes, pero un segundo importador futuro escaparía a un ancla al fichero (D-07).
- **`stripComments` diverge a propósito** del helper de `check-isolation.test.js:23-29`, con la
  medición y el argumento escritos encima de la función para que nadie «arregle» la
  divergencia. El helper verbatim ciega el guard justo sobre `markdown.js`.
- **Los dos mecanismos de D-11** (saneo de comentarios + filtro de línea) se implementan ambos,
  con el comentario que deja escrito que dan el mismo resultado medido y que `stripComments` es
  **estrictamente más fuerte** — para que un lector futuro no elimine el saneo creyendo que el
  filtro de línea basta.
- **El bloque movible es contiguo `60-123`**, no los dos rangos separados de D-01: cortarlos
  habría partido el JSDoc de `stripForKeystroke` y roto la byte-identidad.

## Deviations from Plan

Ninguna que altere el contrato del plan. Dos precisiones de ejecución, ambas anticipadas por el
propio plan:

1. **El SHA base es `f00aabd`, no `61a5c95`.** El plan lo previó explícitamente («si el SHA base
   difiere, re-medirlos antes de dar un criterio por bueno»). Se re-midieron los diez baselines
   y los ocho call sites: coinciden uno a uno (tabla arriba). El bloque `60-123` de `format.js`
   es byte-idéntico entre ambos SHAs, así que los criterios de byte-identidad se aplicaron
   contra `61a5c95` tal cual estaban escritos.
2. **Los números de línea de `test/manager.test.js` volvieron a moverse** (`:856`/`:890` para
   los comentarios, `:861`/`:893` para los asserts, en lugar de los `:860`/`:892` del plan). Se
   ancló por **contenido**, que es justo lo que el plan manda tras haber visto la cifra cambiar
   tres veces.

**Total deviations:** 0 auto-fixes bajo las Reglas 1-4.
**Impact on plan:** ninguno. Cero alcance añadido, cero dependencias, cero guards relajados.

## Prohibiciones respetadas (verificadas, no afirmadas)

- `git diff --exit-code -- src/cli/dashboard/SessionTable.js src/cli/dashboard/index.js` → **0**
  (D-04). Los dos leakers derivativos se cerraron solos al cortar las dos aristas primarias, sin
  tocarlos.
- `git diff --exit-code -- test/check-isolation.test.js test/dispatcher-isolation.test.js` → **0**.
  El helper con bug de orden de los ficheros hermanos sigue **sin corregir**, como manda el
  diferido.
- `git diff --exit-code -- package.json package-lock.json` → **0**. Cero dependencias npm nuevas.
- `git diff --exit-code` sobre los cuatro goldens (`dashboard-markdown`, `format`, `stop`,
  `inbox-format-golden`) → **0**. Ninguno se actualizó; ninguno se movió.
- Sin shim de re-export en `format.js`, sin allowlist en el guard de la hoja, sin infraestructura
  de mutation testing, sin `stripComments` dentro de `walkImports`, sin helper de test compartido.

## Verificación final

| Comando | Resultado |
|---|---|
| `npm test` | `# tests 2609 · # suites 593 · # pass 2608 · # fail 0 · # skipped 1` (≥ 2589) |
| `node --test test/format-isolation.test.js` | `# tests 11 · # suites 7 · # fail 0` (era 8) |
| `node --test test/manager.test.js` | `# tests 62 · # fail 0` |
| `grep -rnE "^import .*(strip…)" src test \| grep -c "cli/format"` | `0` (era 8) |
| `grep -rlnE "^import .*(strip…)" src test \| wc -l` | `8` (ningún consumidor perdido) |
| `diff` bloque movido vs `git show 61a5c95:src/cli/format.js` `60,123` | salida vacía |
| `git status --porcelain -- src test` | vacío (árbol limpio tras las dos mordidas) |

Los cinco ficheros de D-17 con conteos idénticos al baseline: `dashboard-format` 58,
`dashboard-markdown` 9, `format` 44, `stop` 33, `inbox-format-golden` 22 — todos `# fail 0`.
Los anti-regresión adyacentes: `inbox-cli` 75/0 (su assert de `:866` está anclado al
identificador, no al path, y sobrevivió al movimiento) y `check-isolation` 12/0.

## Issues Encountered

Ninguno. La suite `npm test` da 2609 tests (baseline del plan: ≥ 2589) con 1 skipped
preexistente, no introducido por esta ejecución.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Listo para `87-02`.** Este plan deja el andamiaje que el hermano expande: `stripComments`,
  `extractImports`, `walkImports` y `listJsFiles` ya están en el fichero, y la única allowlist
  de la fase (`node:path`, para `ISO-03`) pertenece al `87-02`, no a éste.
- **Sin tocar:** los comentarios de premisa falsa de `test/format-isolation.test.js:14` y del
  JSDoc de `walkImports` (`:33`) siguen intactos — la **declaración honesta** que los sustituye
  es ISO-04 del plan `87-02`.
- **Sin bloqueos.** `src/cli/dashboard/format.js` (sujeto de ISO-03) no se tocó y su pureza
  sigue sin aseverar, que es exactamente lo que el `87-02` viene a cerrar.

---
*Phase: 87-aislamiento-de-color-transitivo-en-el-tui*
*Completed: 2026-08-09*

## Self-Check: PASSED

- `src/cli/sanitize.js` existe en disco.
- `.planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-01-SUMMARY.md` existe en disco.
- Los cuatro commits existen en el historial: `c68136a`, `04a75d9`, `40e5a49`, `fdfff01`.
