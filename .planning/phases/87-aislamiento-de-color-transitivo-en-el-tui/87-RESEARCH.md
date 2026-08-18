# Phase 87: Aislamiento de color transitivo en el TUI - Research

**Researched:** 2026-08-05
**Domain:** Guards de aislamiento de grafo de imports sobre ESM puro (`node:test`), refactor de extracción de módulo-hoja
**Confidence:** HIGH — todas las mediciones del discuss se re-ejecutaron en esta sesión sobre el árbol real; el movimiento de D-01 se simuló entero y se corrió la suite completa (2589 tests) sobre la simulación.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Cierre de los leaks (ISO-02)**

- **D-01:** Los saneadores **puros de texto** salen de `src/cli/format.js` a un **módulo nuevo sin color**: `stripControlChars` (`format.js:80-97`) y `stripForKeystroke` (`format.js:114-125`, que llama a la primera) se mueven **juntos y byte a byte**, sin reescribir sus regex. El módulo nuevo es una **hoja**: cero imports, cero `picocolors`. Es el mismo movimiento que ya hicieron `src/session/handoff.js` y `src/tasks/pending.js` — módulos-contrato con cero imports para que un leaf del dashboard pueda importarlos sin arrastrar grafo (`test/check-isolation.test.js:231-258, 260-285`). — **Reversibility:** costly — mover una función exportada toca 5 call sites; deshacerlo los toca otra vez.
  - **Call sites a actualizar (medidos, son 5):** `src/cli/dashboard/App.js:73` · `src/cli/dashboard/markdown.js:27` · `src/cli/inbox.js:36` · `src/session/manager.js:12` · `test/dashboard-format.test.js` (importa **las dos** funciones desde `../src/cli/format.js`).

- **D-02:** **Sin shim de re-export** en `format.js`. Un `export { stripControlChars } from './sanitize.js'` mantendría viva y legítima la arista `dashboard → format.js`: el guard endurecido la seguiría cazando, pero el objetivo de la fase es que el camino correcto sea el **único** disponible, no que exista un atajo que dispare la alarma. Son 5 líneas de import; el coste de la limpieza es menor que el de la ambigüedad. — **Reversibility:** reversible.

- **D-03:** `visibleWidth` **no se mueve**. Medido: cero consumidores fuera de `src/cli/format.js` (`:135`, `:216`, ambos internos). Mover «ya que estamos» amplía el diff sin cerrar ninguna arista. — **Reversibility:** reversible.

- **D-04:** **No se toca `SessionTable.js` ni `index.js`.** Son leakers derivativos (medido): cerrar las 2 aristas primarias los cierra. Si tras el fix alguno sigue rojo, eso **no** es una invitación a parchearlo — es señal de una arista que la medición no vio, y se mide antes de tocar nada.

**Arquitectura del guard transitivo (ISO-01)**

- **D-05:** El guard endurecido reutiliza el `walkImports` **que ya vive en `test/format-isolation.test.js:40-52`** y lo aplica **por cada fichero de `src/cli/dashboard/`** como entry point, no solo sobre uno. La aserción es: para todo fichero del TUI, **ningún fichero de su clausura transitiva importa `picocolors`**. — **Reversibility:** reversible.
  - Iterar **todos** los ficheros como entry es lo que hace innecesario seguir aristas dinámicas: el leak de `index.js` (dinámico → `App.js`) queda cubierto porque `App.js` **también** es entry y sale rojo por sí mismo.

- **D-06:** `walkImports` **sigue siendo estático**; las aristas dinámicas se cubren con un **source-grep separado sobre la MISMA lista de ficheros que el walker devuelve**. Es el precedente **locked** de la Phase 85 D-09 (`test/check-isolation.test.js:192-228`), con su razón escrita: meter aristas dinámicas dentro del walker ensancha la clausura y pone rojos guards vecinos por motivos espurios — «*y la reacción natural a un rojo espurio es debilitarlos*». — **Reversibility:** reversible.

- **D-07:** El assert se ancla a **`picocolors`** (el paquete, requisito literal de ISO-01), no a `src/cli/format.js`. Hoy son equivalentes porque el test hermano (`format-isolation.test.js:99-115`) asevera que `format.js` es el único importador; pero si mañana aparece un segundo importador, el ancla al paquete lo caza y el ancla al fichero no. El mensaje de fallo debe imprimir la **cadena** (fichero del TUI → … → fichero que importa `picocolors`), no solo el conjunto: un guard transitivo cuyo mensaje no dice el camino se arregla a ciegas.

- **D-08:** El test **directo** actual (`TUI-04 (D-13)`, `:209-220`) **se conserva intacto**. El endurecido es **aditivo**, no un reemplazo: cuesta cero y su mensaje de fallo es más legible cuando el leak es directo.

**`stripComments`: NO copiar el precedente verbatim (ISO-04)**

- **D-09:** El helper `stripComments` de `test/check-isolation.test.js:23-29` **no se copia tal cual**. Borra los bloques `/* … */` **antes** de filtrar las líneas `//`, así que un comentario de línea que contenga la glob `src/cli/dashboard/**` abre un bloque falso que se traga todo hasta el siguiente `*/`. — **Reversibility:** reversible.
  - **Medido sobre `src/` (98 ficheros): 3 pierden el 100% de sus imports estáticos** — `src/cli/dashboard/enrich.js` (3→0), `src/cli/dashboard/markdown.js` (4→0), `src/logs/session-lookup.js` (5→0). **Dos de los tres están en el scope de esta fase, y uno es un leaker primario.**
  - Un guard construido sobre ese helper saldría **verde con el leak vivo** — exactamente el fallo que esta fase existe para terminar.

- **D-10:** Orden correcto, verificado: **líneas `//` primero → bloques `/* */` después → líneas `*` al final**. Recupera el 100% de los imports en los 3 ficheros afectados. La divergencia respecto al verbatim se documenta **con la medición citada**, no como preferencia de estilo.

- **D-11:** El match del `import()` dinámico exige, además de specifier **literal**, que la línea **no empiece por `//`, `*` ni `/*`**. — **Reversibility:** reversible.
  - **Medido:** sin excluir `/*` se cuelan **11 aristas fantasma** de `@type {import('…')}` de una sola línea (139 matches → 128), **9 con specifier relativo**. Entre ellas `src/cli/polling.js → '../logger.js'`: un import **de tipo**, borrado en runtime, que apunta justo al módulo que el guard hermano prohíbe. Los imports de tipo no son aristas.

- **D-12:** El comentario de premisa falsa de `:14` y `:33` (*«No cubre `import()` dinámico — el repo no lo usa»*) se **retira y se sustituye** por la declaración honesta, en el registro de la Phase 86 D-17/D-18:
  - **Qué cubre:** imports estáticos (`import … from`, `import 'x'`, re-exports `export … from`) + `import()` dinámico con specifier **literal** fuera de comentarios.
  - **Qué NO cubre, nombrado como punto ciego residual:** `import()` con specifier **computado** (`import(ruta)`), que ningún regex resuelve sin ejecutar el módulo.
  - **Medición fechada, no garantía:** hoy (2026-08-05) hay **0** `import()` con specifier no literal en `src/`, y **128** con specifier literal en 30 ficheros. Se escribe como medición con fecha — jamás como «el repo no lo usa», que es el pecado que se está retirando.
  - **Prohibido** presentar el punto ciego como cerrado.

**Pureza de `src/cli/dashboard/format.js` (ISO-03)**

- **D-13:** Se congela como **hoja de cero imports relativos**, con **allowlist explícita de builtins**. Medido hoy: su clausura transitiva es **exactamente 1 fichero (él mismo)**; su único import es `basename` de `node:path` (`:25`), que no arrastra nada. Precedente literal de redacción: los guards de `handoff.js` y `pending.js` (`test/check-isolation.test.js:242-257`, `:270-285`) — que exigen cero imports **incluidos builtins**; aquí la allowlist es la única divergencia y se escribe con su razón. — **Reversibility:** reversible.

- **D-14:** Además, **aserto positivo de convergencia**: `src/cli/dashboard/select.js:35` importa `./format.js`. Espejo de ORCH-05 (`check-isolation.test.js:292-294`). Sin él, la premisa que ISO-03 protege («*`select.js` puede importarlo sin arrastrar color*») se puede regresar en silencio moviendo `nextCell` a otro sitio: el guard de pureza seguiría verde sobre un módulo que ya no consume nadie.

**Mordida y disciplina (ISO-01, DEBT-04)**

- **D-15:** La mordida se verifica **a mano y se registra como evidencia citada** en el `SUMMARY`/`VERIFICATION`: diff exacto del leak reintroducido + salida roja (test que falla, mensaje, conteo). Precedente del repo: Phases 82, 83, 85 (WR-03) y 86 (D-15). **No** se construye infraestructura de mutation testing — el milestone es saneo puro, sin feature nueva. — **Reversibility:** reversible.
  - **Leak a reintroducir:** el de `markdown.js:27` — su grafo es de 3 ficheros, así que el mensaje de fallo cabe entero y es legible como evidencia. El de `App.js` arrastra 25 y produce un muro.

- **D-16:** **DEBT-04 es LOCKED.** Ningún assert se debilita, ningún guard se relaja para acomodar el estado actual, ninguna excepción/allowlist se añade «para que pase». Si el guard endurecido sale rojo, se cierra el leak. La única allowlist admitida es la de D-13 (`node:path`), justificada por medición.

**Cero regresión de comportamiento (criterio 5)**

- **D-17:** El movimiento de D-01 es **puro**: misma función, mismo cuerpo, mismos consumidores. Los goldens y tests de render existentes deben pasar **sin tocarse** — `test/dashboard-markdown.test.js:92` (T-75-02: cada línea pasa por `stripControlChars`), `test/inbox-format-golden.test.js`, `test/format.test.js`, `test/stop.test.js:347-439` (carril de keystroke). **Si un golden cambia, el movimiento dejó de ser puro** y hay que revisarlo, no actualizar el golden.

- **D-18:** Baseline verde registrado antes de tocar nada: `node --test test/format-isolation.test.js` → **8 tests / 5 suites / 0 fail** (2026-08-05). El guard endurecido añade tests; ninguno de los 8 existentes puede quedar rojo.

### Claude's Discretion

- Nombre y ubicación exacta del módulo nuevo de D-01 (`src/cli/sanitize.js`, `src/cli/text.js`, …) — el planner elige respetando las convenciones del repo.
- Formato exacto del mensaje de fallo del guard, siempre que imprima la **cadena** (D-07).
- Reparto en planes. Restricción de orden: el guard endurecido debe poder ponerse **rojo** antes del fix (o mordido a mano después), así que el orden natural es guard-primero o guard-y-fix-en-el-mismo-plan con la evidencia de la mordida al final.
- Si `stripComments` y el walker endurecido se extraen a un helper compartido entre los dos ficheros de guard, o se duplican con su razón escrita — con una condición: **no** propagar la versión con el bug de D-09.

### Deferred Ideas (OUT OF SCOPE)

- **El mismo bug de `stripComments` vive en `test/check-isolation.test.js:23-29` y en su origen `test/dispatcher-isolation.test.js:24-30`.** Fuera de scope: esta fase endurece `format-isolation.test.js`. **Medido y tranquilizador:** ninguno de los 3 ficheros afectados está hoy en el grafo estático de `check.js` (23 ficheros), así que el guard hermano **no** está ciego ahora mismo. **Trigger:** que un fichero con `/**` dentro de un comentario de línea entre en el grafo de `check.js`, o el próximo toque de cualquiera de esos dos ficheros de guard. Si D-01 crea un helper compartido, la corrección llega gratis — pero propagar el helper **con** el bug queda prohibido (D-09).
- **Extraer el walker de aislamiento a un helper de test compartido** (`test/helpers/import-graph.mjs`) para los 3+ ficheros de guard que hoy lo duplican. Es refactor de infraestructura de tests, no cierre de deuda trazada: fuera del milestone «saneo puro». **Trigger:** el cuarto fichero de guard que necesite copiarlo.
- **`visibleWidth` sigue en `format.js`** (D-03). Si algún día un fichero del TUI lo necesita, reabriría exactamente esta arista. **Trigger:** primer consumidor de `visibleWidth` bajo `src/cli/dashboard/`.

### Prohibiciones explícitas heredadas del prompt de investigación

NO se propone: infraestructura de mutation testing · dependencia de un parser AST · shim de re-export en `format.js` · generalizar el guard más allá de `src/cli/dashboard/`.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Descripción (verbatim `REQUIREMENTS.md`) | Soporte de esta investigación |
|----|------------------------------------------|-------------------------------|
| **ISO-01** | El guard de color-isolation detecta el arrastre **transitivo** de picocolors al grafo del TUI, no solo el import directo. Hoy el guard directo está verde mientras el leak existe. | §Patrón 1 (guard transitivo con cadena) — código completo escrito y **validado ROJO a HEAD / VERDE post-fix** en esta sesión; §Patrón 2 (reconstrucción de cadena por BFS sin tocar `walkImports`). |
| **ISO-02** | Los **3 leaks reales medidos** quedan cerrados: `App.js:73` y `markdown.js:27` dejan de alcanzar `src/cli/format.js`, y `SessionTable.js` deja de heredarlo por ambas vías. | §Hallazgo 1 (radio re-medido) · §Hallazgo 2 (**8 call sites, no 5**) · §Hallazgo 3 (bloque movible contiguo, líneas 60-123) · §Hallazgo 4 (**2 asserts que se rompen, en un fichero que D-17 no nombra**). Simulación completa del movimiento con suite entera corrida. |
| **ISO-03** | La pureza de `src/cli/dashboard/format.js` queda **congelada por un test** (UF-02). | §Patrón 3 (hoja con allowlist de builtins) + §Patrón 4 (convergencia `select.js`), ambos escritos y verificados **VERDES a HEAD** (congelan el estado actual). |
| **ISO-04** | El guard cubre `import()` dinámico **o** declara con honestidad lo que no cubre — el comentario de premisa falsa de `:14` y `:33` desaparece. | §Hallazgo 5 (bug de `stripComments` con evidencia **superior** a la del discuss) · §Hallazgo 6 (mediciones de `import()` re-verificadas, con **dos correcciones**) · §Código 5 (texto de la declaración honesta con las citas verificadas). |
</phase_requirements>

---

## Summary

Las mediciones del discuss son **correctas en lo esencial y están re-verificadas una a una en esta sesión**. La arquitectura que CONTEXT.md prescribe funciona: escribí el guard endurecido completo y lo corrí contra el árbol real (**ROJO**, con las 3 cadenas impresas) y contra una simulación byte-fiel del fix (**VERDE**), incluidas las dos mordidas — la estática de `markdown.js:27` y una dinámica `await import('picocolors')`. El planner puede copiar ese código casi tal cual; está en §Code Examples.

Pero la investigación encontró **cuatro divergencias respecto a CONTEXT.md que cambian el plan**, y una es grave:

1. **Los call sites son 8, no 5.** D-01 omite `src/cli/capture.js:38`, `src/hooks/stop.js:16` y `src/inbox/store.js:46`. Los tres importan `stripForKeystroke` de `../cli/format.js`. Sin shim (D-02), los tres se rompen en tiempo de carga — no es una regresión sutil, es un `SyntaxError`/`undefined` en tres carriles vivos (captura CLI, hook de Stop, escritura del inbox). Un plan dimensionado a 5 ficheros deja 3 sin tocar.
2. **El movimiento rompe exactamente 2 asserts, y viven en un fichero que D-17 no nombra:** `test/manager.test.js:835` y `:867`, dos guards source-grep anclados literalmente a `from '../cli/format.js'`. Lo verifiqué corriendo la suite entera (2589 tests) sobre la simulación: 4 fallos, de los cuales 2 son artefactos del directorio scratch (sin `.git`, sin `.claude/`) y **2 son exactamente esos**. Los 5 ficheros que D-17 sí nombra pasan **sin tocarse**, con conteos idénticos al baseline. Actualizar esos 2 asserts **no** es debilitar un guard (DEBT-04 intacto): siguen exigiendo import canónico, solo cambia cuál es el carril canónico.
3. **La evidencia del bug de `stripComments` puede ser mucho más fuerte que el conteo de imports.** Medido: inyectando un `await import('picocolors')` en `markdown.js` — que es a la vez uno de los 3 ficheros que el helper verbatim ciega **y** un leaker primario —, el helper verbatim da **0 hits (guard ciego)** y el corregido da **1 hit (rojo)**. Ese es el argumento que cierra ISO-04, no «3 ficheros pierden imports».
4. **`stripComments` corregido subsume por completo el filtro de línea de D-11**: los dos métodos dan exactamente **128** matches. `stripComments` es además estrictamente más fuerte (caza bloques `/* … */` multilínea cuyas líneas interiores no empiezan por `*`, que el filtro de línea deja pasar). D-11 sigue siendo implementable y correcto; lo que la medición dice es que el trabajo lo hace `stripComments`.

**Primary recommendation:** un plan de guard-primero (ISO-01/03/04 sobre `test/format-isolation.test.js`, dejándolo ROJO y con la cadena impresa) seguido del fix (ISO-02: hoja nueva + **8** call sites + **2** asserts de `manager.test.js`), cerrando con la mordida de `markdown.js:27` registrada como evidencia citada. La hoja se llama `src/cli/sanitize.js` (nombre libre, verificado sin colisión) y se crea copiando **las líneas 60-123 de `src/cli/format.js` verbatim** — un bloque contiguo, sin reescribir una sola regex.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detección transitiva del leak de color (ISO-01) | Test / guard estático (`test/format-isolation.test.js`) | — | Es un invariante de **estructura del código fuente**, no de runtime. Ningún tier de producción puede aseverarlo: solo un lector del árbol de ficheros. Precedente: los 4 guards de `test/check-isolation.test.js`. |
| Saneo de texto no confiable (`stripControlChars` / `stripForKeystroke`) | Módulo-hoja puro (`src/cli/sanitize.js`, nuevo) | — | Función pura sin I/O ni color. Hoy vive por accidente histórico en el módulo de color; es la única razón por la que el TUI alcanza `picocolors`. |
| Color del CLI no-TUI (`createFormatter`, `visibleWidth`) | `src/cli/format.js` | `picocolors` (paquete) | Single-source-of-color D-07, invariante cross-milestone. No se toca. |
| Color del TUI | `ink` (`<Text color>`) | — | Invariante D-12 Phase 34. Ningún fichero de `src/cli/dashboard/` produce ANSI. |
| Cobertura de aristas `import()` dinámicas | Source-grep sobre la clausura del walker | — | D-06 locked: meterlo dentro del walker ensancha la clausura y pone rojos guards vecinos por motivos espurios. |
| Congelado de la pureza de `dashboard/format.js` (ISO-03) | Test / guard estático | — | Espejo de los guards de hoja de `handoff.js` y `pending.js`. |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | built-in (Node ≥ 20) | Runner de la suite | Framework único del repo; 181 ficheros `*.test.js`, 2589 tests. `[VERIFIED: package.json scripts.test = "node --test $(find test -name '*.test.js' -type f)"]` |
| `node:assert/strict` | built-in | Aserciones | `assert.deepEqual` sobre arrays vacíos es el idioma del repo para guards de prohibición — el mensaje lista los violadores. `[VERIFIED: test/check-isolation.test.js:108-113, test/format-isolation.test.js:214-219]` |
| `node:fs` / `node:path` | built-in | Lectura del árbol y resolución de specifiers | El walker existente ya los usa. `[VERIFIED: test/format-isolation.test.js:3-5]` |

### Supporting

**Ninguna.** Esta fase **no instala nada**.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex `IMPORT_FROM_RE`/`IMPORT_BARE_RE` | Parser AST (`acorn`, `es-module-lexer`) | **PROHIBIDO por el prompt de la fase y por el invariante cross-milestone «Cero nuevas dependencias npm»** (`STATE.md:175`). Además rompería el precedente de los 3 ficheros de guard que ya usan regex. |
| Mordida manual (D-15) | Mutation testing (`stryker`) | **PROHIBIDO por D-15 + prompt.** El milestone es saneo puro, sin feature nueva. |
| Sin shim | `export { stripControlChars } from './sanitize.js'` en `format.js` | **PROHIBIDO por D-02 + prompt.** |

**Installation:** ninguna. `[VERIFIED: package.json dependencies = commander, ink, picocolors, react; devDependencies = @types/react, ink-testing-library]`

---

## Package Legitimacy Audit

**No aplica — esta fase no instala ningún paquete externo.** `[VERIFIED: package.json leído esta sesión; el invariante «Cero nuevas dependencias npm (locks vía node:fs built-in)» es cross-milestone — STATE.md:175]`

- Packages removed due to `[SLOP]` verdict: **none**
- Packages flagged as suspicious `[SUS]`: **none**

---

## Hallazgos de la verificación (lo que el plan necesita)

Todas las cifras de esta sección se produjeron ejecutando scripts contra el árbol real el **2026-08-05**. Cada una lleva su método.

### Hallazgo 1 — Radio re-medido: 3 ficheros rojos por el walker estático, 2 aristas primarias

`[VERIFIED: script propio sobre src/cli/dashboard/, walker idéntico al de test/format-isolation.test.js:40-52]`

| Fichero del TUI | Tamaño de su clausura | ¿Alcanza `picocolors`? | Cadena más corta |
|---|---|---|---|
| `src/cli/dashboard/App.js` | **24** | **SÍ** | `App.js → src/cli/format.js` |
| `src/cli/dashboard/SessionTable.js` | **24** | **SÍ** | `SessionTable.js → markdown.js → src/cli/format.js` |
| `src/cli/dashboard/markdown.js` | **3** | **SÍ** | `markdown.js → src/cli/format.js` |
| `src/cli/dashboard/index.js` | 6 | **NO por vía estática** | (solo vía `import()` dinámico de `./App.js`, `index.js:144`) |
| `enrich.js` | 10 | no | — |
| `select.js` | **2** | no | — |
| `dashboard/format.js` | **1** | no | — |
| `adopt.js`, `client.js`, `focus.js`, `inbox-count.js`, `open.js`, `plan.js`, `progress.js`, `tasks.js`, `usePoll.js` | 1 cada uno | no | — |

**Total: 16 ficheros bajo `src/cli/dashboard/`.** Unión de las 16 clausuras = **32 ficheros**, e incluye `src/cli/format.js` a HEAD.

**Correcciones respecto a CONTEXT.md:**

- La clausura de `App.js` es **24**, no 25 (CONTEXT.md D-15 dice «arrastra 25»). Diferencia menor, pero D-15 la usa como argumento. `[VERIFIED]`
- CONTEXT.md dice «4 ficheros rojos». Con el walker **estático** que D-05/D-06 prescriben, son **3**. `index.js` solo aparece si se siguen aristas dinámicas — y D-06 prohíbe expresamente meterlas en el walker. **El guard que esta fase construye verá 3, no 4.** La observación de CONTEXT.md sigue siendo cierta (D-05 lo cubre: `App.js` es entry por sí mismo), pero el `VERIFICATION` debe contar **3 rojos por el guard**, no 4, o quedará describiendo un fallo que el test no produce. `[VERIFIED]`
- El conteo de `REQUIREMENTS.md` ISO-02 («3 leaks») coincide con la medición estática. El del roadmap también.

### Hallazgo 2 — **Los call sites son 8, no 5** (la corrección más importante)

`[VERIFIED: grep -rn "^import.*strip(ControlChars|ForKeystroke)" src test]`

| # | Fichero | Línea | Import actual | ¿En D-01? |
|---|---------|-------|---------------|-----------|
| 1 | `src/cli/dashboard/App.js` | 73 | `import { stripControlChars } from '../format.js';` | sí |
| 2 | `src/cli/dashboard/markdown.js` | 27 | `import { stripControlChars } from '../format.js';` | sí |
| 3 | `src/cli/inbox.js` | 36 | `import { createFormatter, stripControlChars } from './format.js';` | sí |
| 4 | `src/session/manager.js` | 12 | `import { stripForKeystroke, stripControlChars } from '../cli/format.js';` | sí |
| 5 | `test/dashboard-format.test.js` | 27 | `import { stripControlChars, stripForKeystroke } from '../src/cli/format.js';` | sí |
| **6** | **`src/cli/capture.js`** | **38** | `import { createFormatter, stripForKeystroke } from './format.js';` | **NO** |
| **7** | **`src/hooks/stop.js`** | **16** | `import { stripForKeystroke } from '../cli/format.js';` | **NO** |
| **8** | **`src/inbox/store.js`** | **46** | `import { stripForKeystroke } from '../cli/format.js';` | **NO** |

Los tres omitidos consumen `stripForKeystroke` en carriles **vivos y no triviales**: `capture.js:96` (saneo del texto de `kodo capture`), `stop.js:59,83` (nudge de keystroke al orquestador), `store.js:311,329,344` (saneo de los 3 campos de la línea del inbox). Sin shim (D-02), no actualizarlos es un fallo de carga, no una degradación silenciosa.

**Nota:** `src/cli/inbox.js` y `src/cli/capture.js` importan **también** `createFormatter` en la misma línea. Ahí el edit no es sustituir el path, es **partir el import en dos** — `createFormatter` se queda en `./format.js` y el saneador pasa a `./sanitize.js`. Dos ficheros con esa forma; los otros seis son sustitución de path pura.

### Hallazgo 3 — El bloque movible es contiguo: **líneas 60-123** de `src/cli/format.js`

`[VERIFIED: src/cli/format.js:57-126 leídas esta sesión]`

```
 :57-58   fin de visibleWidth()                     ← NO se mueve (D-03)
 :59      línea en blanco                            ← separador
 :60-79   JSDoc de stripControlChars
 :80-87   export function stripControlChars(s) {…}
 :88      línea en blanco
 :89-113  JSDoc de stripForKeystroke
 :114-123 export function stripForKeystroke(s) {…}
 :124     línea en blanco                            ← separador
 :125-…   JSDoc de padCell()                         ← NO se mueve
```

El movimiento byte-idéntico es un corte de **un solo bloque contiguo de 64 líneas** (60-123). CONTEXT.md D-01 cita `:80-97` y `:114-125`; los rangos reales de cuerpo de función son **`:80-87`** y **`:114-123`** (los rangos de CONTEXT parecen incluir parte del JSDoc siguiente). Usar 60-123 mueve JSDoc + cuerpo de las dos funciones sin tocar nada más. `[VERIFIED]`

**`src/cli/format.js` no se rompe al perderlas:** ninguna otra función del fichero las llama. Verificado en la simulación: `format.js` post-corte queda sin ninguna mención de `strip*`, y `test/format.test.js` sigue **44/44 verde**. `[VERIFIED: node --test test/format.test.js sobre la simulación]`

**Nombre del módulo:** `src/cli/sanitize.js`, `src/cli/text.js` y cualquier `src/cli/strip*.js` están **libres** — `find src -name "sanitize*" -o -name "text*" -o -name "strip*"` no devuelve nada. `[VERIFIED]` `src/cli/` es plano (18 ficheros + `dashboard/`), así que la ubicación es natural.

### Hallazgo 4 — **Exactamente 2 asserts se rompen, y D-17 no nombra su fichero**

Método: copié `src/` + `test/` a un directorio scratch, apliqué el movimiento completo (hoja nueva con el bloque 60-123 verbatim + los 8 call sites) y corrí **la suite entera**.

`[VERIFIED: node --test $(find test -name '*.test.js' -type f) sobre la simulación → # tests 2589 · # pass 2584 · # fail 4 · # skipped 1]`

De los 4 fallos:

| Fallo | Causa | ¿Regresión real? |
|---|---|---|
| `test/manager.test.js:828` «Phase 78 (WR-01/WR-02) … stripForKeystroke» | `assert.ok(/import\s*\{[^}]*\bstripForKeystroke\b[^}]*\}\s*from\s*['"]\.\.\/cli\/format\.js['"]/.test(source))` — anclado al **path** `../cli/format.js` | **SÍ — hay que actualizar el path del regex** |
| `test/manager.test.js:862` «Phase 78 (IN-04) … stripControlChars» | mismo patrón, para `stripControlChars` | **SÍ — ídem** |
| `test/manager.test.js:610` «isGitRepo … repo real de este propio proyecto» | el directorio scratch no es un repo git | no — artefacto del entorno de simulación |
| `test/kodo-capture-skill.test.js` | lee `.claude/skills/kodo-capture/SKILL.md`, que no copié | no — artefacto del entorno de simulación |

**Los 5 ficheros que D-17 nombra pasan sin tocarse, con conteos idénticos al baseline:**

| Fichero | HEAD | Post-move | |
|---|---|---|---|
| `test/dashboard-markdown.test.js` | 9/0 | **9/0** | idéntico |
| `test/inbox-format-golden.test.js` | 22/0 | **22/0** | idéntico |
| `test/format.test.js` | 44/0 | **44/0** | idéntico |
| `test/stop.test.js` | 33/0 | **33/0** | idéntico |
| `test/dashboard-format.test.js` | 58/0 | **58/0** | idéntico (tras actualizar su `:27`, que D-01 ya cuenta) |

**Y además, verificados verdes post-move sin tocarse:** `test/dashboard-table.test.js` 48/0 · `test/dashboard-inbox-count.test.js` 14/0 · `test/inbox-cli.test.js` 75/0 · `test/check-isolation.test.js` 12/0 · `test/format-isolation.test.js` **8/0** (D-18 preservado).

**Por qué actualizar esos 2 asserts no viola DEBT-04 (D-16):** no se debilita nada. Ambos siguen exigiendo que `manager.js` importe el saneador **desde el carril canónico** y que lo aplique a los mismos campos; lo único que cambia es cuál es el carril canónico. La forma del assert, su mensaje y el resto de sus aserciones (las de interpolación y las negativas de regresión) quedan intactas. El planner debe escribir esa distinción en el commit, porque un revisor que vea «tocar un guard» sin contexto leerá relajación.

**Un tercer test NO se rompe, aunque lo parezca:** `test/inbox-cli.test.js:866` hace `assert.ok(/stripControlChars/.test(src))` sobre `src/cli/inbox.js` — está anclado al **identificador**, no al path, y el identificador sobrevive al movimiento. `[VERIFIED: simulado y corrido — 75/0]`

### Hallazgo 5 — El bug de `stripComments`, con la evidencia que de verdad cierra ISO-04

**Reproducción del conteo de CONTEXT.md — exacta.** `[VERIFIED: script propio sobre los 98 ficheros de src/]`

| Fichero | imports reales | con `stripComments` **verbatim** (bug) | con orden **corregido** (D-10) |
|---|---|---|---|
| `src/cli/dashboard/enrich.js` | 3 | **0** | 3 |
| `src/cli/dashboard/markdown.js` | 4 | **0** | 4 |
| `src/logs/session-lookup.js` | 5 | **0** | 5 |
| los otros 95 ficheros | — | sin cambio | sin cambio |

98 ficheros escaneados · **3 afectados** · **3 pierden el 100%** con el verbatim · **0 pierden nada** con el corregido. Coincide dígito a dígito con D-09/D-10.

**Las líneas que abren el bloque falso, identificadas:** `[VERIFIED: lectura directa]`

- `src/cli/dashboard/markdown.js:14` → `// imports de src/cli/dashboard/**.`
- `src/cli/dashboard/enrich.js:26` → `// verificado por test/format-isolation.test.js que escanea src/cli/dashboard/**).`
- `src/logs/session-lookup.js:14` → `//   2. Fallback: scan de ~/.kodo/logs/*.ndjson.`

Los dos primeros confirman la observación de `<specifics>`: **el comentario que documenta la invariante es el que cegaría al guard que la protege.** El tercero muestra que el disparador no es solo la glob `dashboard/**` — cualquier `/*` dentro de un comentario de línea sirve (aquí, `logs/*.ndjson`). Eso amplía la clase del bug y merece quedar escrito.

**La evidencia superior (recomendada para el fichero de test y para el `VERIFICATION`):**

Inyectando un `const pc = await import('picocolors');` en `src/cli/dashboard/markdown.js` — que es simultáneamente uno de los 3 ficheros cegados **y** un leaker primario:

| Helper | Hits del regex de `import()` de picocolors | Veredicto del guard |
|---|---|---|
| `stripComments` **verbatim** (`check-isolation.test.js:23-29`) | **0** | **CIEGO — verde con el leak vivo** |
| `stripComments` **corregido** (D-10) | **1** | **ROJO** |

`[VERIFIED: script propio, 2026-08-05]` Este es el argumento que cierra ISO-04: no «3 ficheros pierden imports», sino «el guard que esta fase construye habría salido verde sobre el leak dinámico si hubiéramos copiado el helper verbatim».

**Consecuencia adicional que el plan debe tener en cuenta — dónde va (y dónde NO va) `stripComments`:**

Si el helper con bug se usara **dentro del walker**, el desastre es mayor: `[VERIFIED]`

| Fichero | clausura RAW (hoy) | con `stripComments` corregido | con `stripComments` **verbatim** |
|---|---|---|---|
| `markdown.js` | 3 | 3 | **1 — la arista del leak desaparece** |
| `enrich.js` | 10 | 10 | **1** |
| `App.js` | 24 | 24 | 23 |
| `SessionTable.js` | 24 | 24 | 23 |

Con el verbatim en el walker, `markdown.js` pasaría a tener clausura de 1 fichero (él mismo) y **el guard transitivo lo declararía limpio**.

**Y el dato tranquilizador:** el walker **no necesita** `stripComments` en absoluto. RAW y corregido dan clausuras **idénticas en los 16 ficheros del dashboard**. `[VERIFIED]` Razón estructural: `IMPORT_FROM_RE` está anclado con `^\s*(?:import|export)`, así que un `// import x from './y.js'` no matchea (el `//` no es whitespace).

→ **Recomendación al planner:** aplicar `stripComments` **solo al source-grep dinámico** (el precedente exacto de WR-03, `check-isolation.test.js:212`), y dejar `walkImports` leyendo el fuente crudo, tal y como está hoy. Si aun así se decide aplicarlo también al walker, tiene que ser el corregido — y hay que escribir por qué en el fichero.

### Hallazgo 6 — Mediciones de `import()` dinámico: confirmadas, con dos correcciones

`[VERIFIED: script propio sobre los 98 ficheros de src/, 2026-08-05]`

| Medición | CONTEXT.md D-11/D-12 | Verificado |
|---|---|---|
| matches excluyendo solo líneas `//` y `*` | 139 | **139** ✓ |
| matches excluyendo además `/*` | 128 | **128** ✓ |
| aristas fantasma que `/*` recorta | 11 | **11** ✓ |
| … de ellas con specifier relativo | 9 | **9** ✓ |
| `import()` con specifier **NO literal** en `src/` | 0 | **0** ✓ |
| ficheros con los 128 literales | **30** | **26** ← **corrección** |
| `import()` dinámico de `picocolors` en `src/` | — | **0** |

**Corrección 1 — son 26 ficheros, no 30.** Verificado por los dos métodos (filtro de línea y `stripComments`), ambos dan 128 matches en **26** ficheros. La declaración honesta de D-12 debe escribir 26, o nace con un número falso — que es exactamente el pecado que ISO-04 retira.

**Corrección 2 — `stripComments` corregido y el filtro de línea de D-11 dan el mismo resultado: 128.** `[VERIFIED]` Es decir: **el filtro de línea de D-11 es redundante si se aplica `stripComments`**, y `stripComments` es estrictamente más fuerte, porque también neutraliza un bloque como

```js
/*
  await import('picocolors')
*/
```

cuyas líneas interiores no empiezan por `//`, `*` ni `/*` y que el filtro de línea dejaría pasar como arista real. D-11 sigue siendo una decisión válida y su **intención** (los imports de tipo no son aristas) queda satisfecha; la medición solo dice cuál de los dos mecanismos hace el trabajo. Implementar los dos cuesta una línea y no molesta; implementar solo el filtro de línea sería más débil.

Los 11 fantasmas verificados, para citarlos en el fichero:

```
src/cli/dashboard/SessionTable.js:485  /** @type {import('react').ReactElement} */
src/cli/dashboard/markdown.js:51       /** @type {import('react').ReactElement[]} */
src/cli/polling.js:417                 /** @type {import('../logger.js').Logger} */        ← apunta al módulo que el guard hermano PROHÍBE
src/cli/skill-sync.js:132, :137        /** @type {… import('../skill/sync.js') …} */
src/providers/github/provider.js:115, :153   /** @type {import('../../interface.js')…} */
src/providers/plane/client.js:5        /** @param {{ … logger?: import('../../logger.js')… }} */
src/providers/plane/provider.js:105    /** @type {import('../../interface.js').TaskProvider} */
src/providers/registry.js:4, :7        /** @type {… import('../interface.js') …} */
```

**Y las citas para la declaración honesta de D-12, verificadas literalmente:** `[VERIFIED: lectura directa]`

```
src/providers/registry.js:27  const { loadConfig, getPlaneApiKey } = await import('../config.js');
src/providers/registry.js:28  const { createPlaneProvider } = await import('./plane/provider.js');
src/providers/registry.js:57  const { loadConfig } = await import('../config.js');
src/providers/registry.js:58  const { createGitHubProvider } = await import('./github/provider.js');
src/session/state.js:247      import('../logger-events.js')
```

Las cinco existen y son `import()` dinámicos reales. La premisa «el repo no lo usa» de `:14` y `:33` es, en efecto, **falsa**.

### Hallazgo 7 — El fix funciona: 0 ficheros del TUI alcanzan `picocolors`

`[VERIFIED: walker corrido sobre la simulación post-move]`

| | HEAD | Post-move |
|---|---|---|
| Ficheros del dashboard que alcanzan `picocolors` | **3** | **0** |
| Clausura de `App.js` | 24 | 24 |
| Clausura de `markdown.js` | 3 | 3 |
| Clausura de `SessionTable.js` | 24 | 24 |
| Unión de las 16 clausuras contiene `src/cli/format.js` | **sí** | **no** |
| `src/cli/sanitize.js` (hoja nueva) — imports | — | **`[]`** (cero, incluidos builtins) |
| `src/cli/dashboard/format.js` — imports | `["node:path"]` | `["node:path"]` |

Las clausuras **no encogen**: la arista `../format.js` se sustituye por `../sanitize.js`, que es una hoja. El grafo mantiene su tamaño y pierde el color. **D-04 confirmado:** cerrar las 2 aristas primarias cierra los 3 ficheros; `SessionTable.js` no se toca y queda limpio.

**Efecto colateral verificado:** post-move, `src/inbox/store.js` **deja de alcanzar `picocolors`** (su única vía era `../cli/format.js`). Ver §Runtime State Inventory — vuelve tres comentarios del repo parcialmente falsos.

### Hallazgo 8 — El guard endurecido, escrito y validado en las dos direcciones

Escribí el guard completo (§Code Examples) y lo corrí contra HEAD y contra la simulación:

| Escenario | Resultado |
|---|---|
| **HEAD** (leaks vivos) | `# pass 3 · # fail 1` — falla ISO-01 transitivo, con las **3 cadenas impresas** |
| **Post-move** | `# pass 4 · # fail 0` |
| **Mordida A** — reintroducir `markdown.js:27` sobre el fix | **ROJO**, 3 cadenas (`markdown.js` · `SessionTable.js→markdown.js` · `App.js→SessionTable.js→markdown.js`), 9 líneas de mensaje |
| **Mordida B** — `await import('picocolors')` en `markdown.js` | **ROJO** en el guard dinámico: `src/cli/dashboard/markdown.js -> import('picocolors')` |
| **Restaurado** | `# pass 4 · # fail 0` |

Los guards de ISO-03/D-14 salen **verdes ya a HEAD** — congelan el estado actual, que es su función.

**Matiz medido sobre D-15 (la elección de la mordida):** D-15 descarta `App.js` porque «arrastra 25 y produce un muro». Con el mensaje basado en **cadenas** que D-07 exige, ese problema desaparece: la mordida de `App.js` produce **2 cadenas / 5 líneas** y la de `markdown.js` **3 cadenas / 9 líneas** — es decir, `App.js` sería incluso *más* corto. `markdown.js` sigue siendo una elección perfectamente buena (D-15 es LOCKED y no hay razón para removerlo), pero el `VERIFICATION` no debe justificarla por el tamaño del muro, porque D-07 ya lo eliminó. Justificarla por lo que es: es el leak con la cadena más corta y el único que también ejercita la herencia por `SessionTable.js`. `[VERIFIED]`

---

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────── ANTES (HEAD) ────────────────────────┐

  src/cli/dashboard/App.js ──────────┐
                                     ├──► src/cli/format.js ──► picocolors   ✗ LEAK
  src/cli/dashboard/markdown.js ─────┘            ▲
          ▲                                       │
          │                                       │
  src/cli/dashboard/SessionTable.js ──────────────┘  (herencia por AMBAS vías)

  src/cli/index.js ──import()──► App.js                (arista dinámica, fuera del walker)

  src/inbox/store.js ──► src/cli/format.js ──► picocolors
  src/cli/capture.js ──► src/cli/format.js ──► picocolors
  src/hooks/stop.js  ──► src/cli/format.js ──► picocolors
  src/cli/inbox.js   ──► src/cli/format.js ──► picocolors
  src/session/manager.js ─► src/cli/format.js ─► picocolors


                       ┌──────────────────────── DESPUÉS ─────────────────────────────┐

  ENTRADA: los 16 ficheros de src/cli/dashboard/, cada uno como entry point (D-05)
      │
      ├─► [walkImports estático]  ──► clausura por fichero
      │        │
      │        ├─► ¿algún fichero de la clausura importa 'picocolors'?
      │        │        SÍ ──► [findChain: BFS con mapa de padres] ──► imprime la CADENA (D-07) ──► ROJO
      │        │        NO ──► verde
      │        │
      │        └─► unión de las 16 clausuras (32 ficheros)
      │                 │
      │                 └─► [stripComments ORDEN CORREGIDO (D-10)]
      │                          └─► [regex import() literal (D-11)] ──► ¿picocolors? ──► ROJO
      │
      └─► [guard de hoja]  src/cli/dashboard/format.js: cero imports relativos,
               builtins ⊆ allowlist {node:path} (D-13), clausura == 1
           [guard de convergencia]  select.js ∈ clausura ∋ dashboard/format.js (D-14)


  src/cli/format.js ──► picocolors        (single source of color, INTACTO)
      ▲   ▲
      │   └── createFormatter / visibleWidth / formatRow / formatTable
      │
      └── consumidores de color: logger.js, logs/reader.js, check.js, gsd-*.js, adopt.js, inbox.js, capture.js

  src/cli/sanitize.js  ◄── HOJA NUEVA, CERO imports, CERO color
      ▲
      ├── src/cli/dashboard/App.js          (stripControlChars)
      ├── src/cli/dashboard/markdown.js     (stripControlChars)
      ├── src/cli/inbox.js                  (stripControlChars)   ← import PARTIDO en dos
      ├── src/cli/capture.js                (stripForKeystroke)   ← import PARTIDO en dos
      ├── src/hooks/stop.js                 (stripForKeystroke)
      ├── src/inbox/store.js                (stripForKeystroke)
      ├── src/session/manager.js            (ambas)
      └── test/dashboard-format.test.js     (ambas)
```

### Recommended Project Structure

```
src/cli/
├── format.js         # color: createFormatter, visibleWidth, formatRow/Table, OK/FAIL. Único importador de picocolors.
├── sanitize.js       # NUEVO — hoja de CERO imports: stripControlChars, stripForKeystroke.
└── dashboard/
    ├── format.js     # hoja de presentación pura (solo node:path) — congelada por ISO-03
    └── …             # 15 ficheros más, ninguno alcanza picocolors tras el fix

test/
└── format-isolation.test.js   # fichero objetivo: +ISO-01 transitivo, +ISO-01 dinámico, +ISO-03, +D-14
```

### Pattern 1: Guard transitivo por-entry con `walkImports` reutilizado (D-05/D-06/D-07)

**What:** iterar cada fichero de `src/cli/dashboard/` como entry, obtener su clausura con el `walkImports` que ya existe, y asertar que ningún fichero de esa clausura importa `picocolors`.
**When to use:** siempre que el invariante sea «X no debe alcanzar Y», con X un directorio y no un único fichero.
**Molde del repo:** `test/check-isolation.test.js:101-114` (mismo `assert.deepEqual(violators, [], msg)` sobre la salida del walker), generalizado de un entry a N entries.

### Pattern 2: Reconstrucción de la cadena por BFS **sin tocar `walkImports`** (D-07)

**What:** `walkImports` devuelve un `Set` — no guarda padres, así que no puede decir el camino. La solución que respeta D-05 («reutiliza el walker, no lo reescribas») es un helper **aditivo** de ~14 líneas que hace BFS con un `Map` de padres y se invoca **solo cuando ya hay violación**, para construir el mensaje.
**When to use:** cuando el assert es de alcanzabilidad transitiva y el mensaje debe ser accionable.
**Por qué BFS y no DFS:** BFS da la cadena **más corta**, que es la que el desarrollador querrá cortar. Verificado: produce `SessionTable.js → markdown.js → src/cli/format.js` (3 nodos) en vez de un camino largo cualquiera.
**Coste:** el guard ya paga el walk; el BFS solo corre en el camino de fallo. Cero impacto en la suite verde.

### Pattern 3: Guard de hoja con allowlist de builtins (ISO-03 / D-13)

**What:** asertar `imports.filter(s => s.startsWith('.')) === []` **y** `imports.filter(s => !ALLOWLIST.includes(s)) === []`, más `walkImports(p).size === 1`.
**Divergencia respecto al molde:** `handoff.js` (`check-isolation.test.js:242-257`) y `pending.js` (`:270-285`) exigen `imports === []` a secas, **incluidos builtins**. Aquí no se puede: `dashboard/format.js:25` importa `basename` de `node:path`. La allowlist es la única divergencia, es de un elemento, y se escribe con su razón medida (`node:path` no arrastra nada; la clausura sigue siendo 1). D-16 la admite explícitamente.
**El tercer assert (`walkImports(p).size === 1`) es el que de verdad muerde:** los dos primeros son de forma, ese es de alcanzabilidad y sobreviviría a un `import` con una sintaxis que el regex no viera.

### Pattern 4: Aserto positivo de convergencia (D-14)

**What:** `assert.ok(walkImports(select.js).has(dashboard/format.js))`.
**Molde literal:** ORCH-05 en `check-isolation.test.js:292-300` y ORCH-07 en `:182-190`. Ambos usan `assert.ok(graph.has(path), msg + graph completo)`.
**Por qué:** un guard de prohibición sobre un módulo huérfano es verde y vacío. Este assert impide que ISO-03 degrade a decoración si alguien mueve `nextCell` a otro sitio.

### Pattern 5: Source-grep dinámico sobre la salida del walker (D-06)

**What:** recorrer la **misma lista de ficheros** que el walker devolvió y aplicar un regex de `import()` con specifier literal, tras `stripComments`.
**Molde literal:** `check-isolation.test.js:208-228` (WR-03), incluida su justificación escrita de por qué no se mete en el walker.
**Adaptación:** cambiar `DYNAMIC_LOGGER_IMPORT_RE` por su equivalente de `picocolors` y la lista de entrada de `walkImports(check.js)` a la **unión** de las 16 clausuras del dashboard (32 ficheros medidos).
**Anti-patrón que este molde ya evita:** anclar al identificador suelto en vez de al patrón de import — «prosa que mencione `picocolors` no puede poner roja la suite» (`check-isolation.test.js:207`). Crítico aquí: `src/cli/dashboard/format.js:17`, `markdown.js:13` e `inbox-count.js:21` mencionan `picocolors` en prosa.

### Anti-Patterns to Avoid

- **Copiar `stripComments` verbatim** — deja el guard ciego sobre `markdown.js`, que es a la vez leaker primario y uno de los 3 ficheros que el bug ciega (§Hallazgo 5).
- **Meter `stripComments` (aunque sea el corregido) dentro de `walkImports`** — es un no-op medido hoy (clausuras idénticas en los 16 ficheros) que solo añade superficie de fallo. Y si alguien lo cambia por el verbatim después, la clausura de `markdown.js` cae de 3 a 1 y el guard se queda ciego.
- **Seguir aristas dinámicas dentro del walker** — D-06 locked, con la razón escrita del repo.
- **Anclar el assert a `src/cli/format.js` en vez de a `picocolors`** — D-07: un segundo importador futuro escaparía.
- **Mensaje de fallo que imprime el conjunto en vez de la cadena** — el molde LOG-12 (`format-isolation.test.js:92-93`) imprime el grafo entero; para `App.js` eso serían 24 líneas de las que ninguna dice cuál es la arista a cortar.
- **Actualizar un golden porque cambió** — D-17: si un golden cambia, el movimiento dejó de ser puro. La simulación demuestra que ninguno cambia.
- **Añadir el shim de re-export «solo para no tocar 8 ficheros»** — D-02 lo prohíbe explícitamente; el número real de ficheros (8, no 5) hace la tentación mayor, no menor.

---

## Don't Hand-Roll

| Problema | No construir | Usar en su lugar | Por qué |
|---|---|---|---|
| Recorrer el grafo de imports | Un walker nuevo | `walkImports` de `test/format-isolation.test.js:40-52` | Ya existe **en el fichero objetivo**, ya maneja ciclos (`visited`), ficheros inexistentes y re-exports. D-05 lo exige. |
| Parsear imports | Un parser AST / dependencia nueva | `IMPORT_FROM_RE` + `IMPORT_BARE_RE` (`:15-16`) | Prohibido añadir dependencias (invariante cross-milestone). Las dos regex ya cubren las 3 formas ESM que usa el repo. |
| Listar `.js` recursivamente | Un `readdirSync` propio | `listJsFiles` (`:59-71`) | Ya existe en el fichero. |
| Filtrar comentarios | Un `stripComments` nuevo desde cero | El de `check-isolation.test.js:23-29` **con el orden corregido de D-10** | El patrón es correcto; solo el orden está mal. Reescribirlo desde cero pierde la trazabilidad al precedente. |
| Detectar `import()` dinámico | Ejecutar el módulo / instrumentar el loader | Source-grep con regex constante (`check-isolation.test.js:33`) | Anti-ReDoS por construcción (regex nunca compilada desde input, clases `[^'"]*` que no retroceden). Ejecutar módulos en un guard de test es lo que D-06 evita. |
| Verificar la mordida | Mutation testing | Reintroducción manual + evidencia citada | D-15 + precedentes 82/83/85/86. |

**Key insight:** esta fase **no necesita infraestructura nueva**. Los cuatro patrones que requiere (walker, source-grep sobre la clausura, guard de hoja, aserto de convergencia) ya existen escritos y probados en `test/check-isolation.test.js`. Lo único genuinamente nuevo son 14 líneas de BFS para la cadena de D-07. Un plan que proponga andamiaje está trabajando de más.

---

## Runtime State Inventory

Esta es una fase de **refactor** (movimiento de dos funciones exportadas). El inventario es obligatorio.

| Categoría | Encontrado | Acción requerida |
|---|---|---|
| **Stored data** | **Nada.** Ningún dato persistido codifica el path `src/cli/format.js` ni los nombres de las funciones. `state.json`, `~/.kodo/inbox.md` y los logs NDJSON almacenan **salida** de los saneadores, no referencias a ellos. La salida es byte-idéntica (mismo cuerpo). `[VERIFIED: grep de "cli/format" sobre src/ y test/; los únicos hits son imports y prosa]` | ninguna |
| **Live service config** | **Nada.** No hay servicio externo (n8n, Datadog, Cloudflare) que referencie estos módulos. | ninguna |
| **OS-registered state** | **Nada.** Ninguna task de scheduler, plist ni proceso pm2 nombra estos ficheros. | ninguna |
| **Secrets/env vars** | **Nada.** Ninguna var de entorno referencia estos módulos. `NO_COLOR`/`FORCE_COLOR` los lee `_resolveUseColor` en `format.js`, que **no se mueve**. | ninguna |
| **Build artifacts** | **Nada.** Repo ESM puro sin build step (`"type": "module"`, sin `dist/`, sin transpilación). `[VERIFIED: package.json — solo script "test"]` | ninguna |
| **Documentación / comentarios que quedan FALSOS** ← *categoría añadida, no vacía* | **5 sitios.** Ver tabla abajo. | **edición de comentarios (obligatoria — es el objeto de ISO-04)** |

### Comentarios que la fase vuelve falsos

| Sitio | Texto | Por qué queda falso | ¿En scope? |
|---|---|---|---|
| `test/format-isolation.test.js:14` | `// No cubre import() dinámico — el repo no lo usa (verificado en 06-RESEARCH A3).` | Falso **hoy**: 128 `import()` literales en 26 ficheros. | **SÍ — ISO-04 / D-12** |
| `test/format-isolation.test.js:33` | `* No sigue dynamic import() (el repo no los usa — verificado por grep en 06-RESEARCH A3).` | Ídem. | **SÍ — ISO-04 / D-12** |
| `src/cli/dashboard/inbox-count.js:13-14` | `…test/format-isolation.test.js NO lo detectaría — su walker de dashboard comprueba imports DIRECTOS, no transitivos…` | Falso **tras ISO-01**: el walker pasa a ser transitivo. | **Zona gris — decidir en el plan** |
| `src/cli/dashboard/inbox-count.js:9-12` | `PROHIBIDO importar src/inbox/store.js … porque store.js:46 importa stripForKeystroke de ../cli/format.js, que importa picocolors` | Falso **tras ISO-02**: `store.js` deja de alcanzar `picocolors` (verificado). La prohibición **sigue siendo correcta** por los otros motivos que el mismo comentario da (`withFileLock`, `resolveProjectId`), pero su argumento principal se evapora. | **Zona gris — decidir en el plan** |
| `test/dashboard-inbox-count.test.js:7-8` | `…importar src/inbox/store.js metería picocolors en el grafo del TUI … y test/format-isolation.test.js NO lo detectaría porque solo mira imports DIRECTOS` | Falso por partida doble tras ISO-01 **y** ISO-02. | **Zona gris — decidir en el plan** |

**Nota de disciplina para el planner:** esta fase existe porque un comentario declaraba un punto ciego que no tapaba. Dejar tres comentarios nuevos declarando algo falso sería reabrir el mismo pecado en otro fichero — y la fase 88 los encontraría. La corrección son 3 ediciones de comentario, cero comportamiento. Si el planner los deja fuera, tienen que ir a `deferred-items.md` **con su trigger escrito**, no simplemente omitidos.

---

## Common Pitfalls

### Pitfall 1: Dimensionar el plan a 5 call sites

**Qué sale mal:** `src/cli/capture.js`, `src/hooks/stop.js` y `src/inbox/store.js` quedan importando una función que ya no existe. Sin shim (D-02), es un fallo de carga en tres carriles vivos.
**Por qué pasa:** D-01 dice «medidos, son 5» y el número tiene autoridad. Los 3 omitidos importan `stripForKeystroke` (no `stripControlChars`), que es el consumidor menos visible.
**Cómo evitarlo:** la tarea de fix lleva un criterio de verificación de **conteo**: `grep -rn "strip\(ControlChars\|ForKeystroke\)" src test | grep "from.*cli/format"` → **0 hits**.
**Señal temprana:** cualquier test de `capture`, `stop` o `inbox/store` que falle con un error de import.

### Pitfall 2: Creer que ningún test se rompe

**Qué sale mal:** `test/manager.test.js` sale rojo al final de la fase y la reacción natural (con la suite ya verde en todo lo demás) es dudar del fix.
**Por qué pasa:** D-17 promete «los goldens y tests de render existentes deben pasar sin tocarse» y nombra 4 ficheros — ninguno es `manager.test.js`. La promesa es cierta *para los ficheros que nombra*; `manager.test.js` no es un golden ni un test de render, es un **guard source-grep**, otra categoría.
**Cómo evitarlo:** la tarea de fix incluye explícitamente los edits de `test/manager.test.js:835` y `:867`, con la nota de que el assert no se debilita — solo cambia el path canónico.
**Señal temprana:** el mensaje de fallo es literal: `manager.js debe importar stripForKeystroke desde ../cli/format.js`.

### Pitfall 3: Copiar `stripComments` verbatim «porque es el precedente»

**Qué sale mal:** el guard sale verde con el leak vivo. Es el fallo exacto que la fase existe para terminar, reproducido dentro del arreglo.
**Por qué pasa:** el repo tiene una norma fuerte de «copia el molde». Aquí el molde tiene un bug y CONTEXT.md D-09 lo dice, pero la inercia es real: el helper está en dos ficheros (`check-isolation.test.js:23-29`, `dispatcher-isolation.test.js:24-30`) con el mismo bug, así que parece consolidado.
**Cómo evitarlo:** el helper corregido lleva **encima** el comentario con la medición (3 ficheros, 100% de imports perdidos, y el caso de `markdown.js` ciego ante `import('picocolors')`).
**Señal temprana:** si el guard transitivo sale verde a HEAD **antes** del fix, el helper está mal.

### Pitfall 4: Aplicar `stripComments` al walker

**Qué sale mal:** con el corregido, nada (medido: no-op). Con el verbatim, la clausura de `markdown.js` cae de 3 a 1 y el leak desaparece del grafo.
**Por qué pasa:** parece coherente aplicar el mismo saneo en los dos sitios.
**Cómo evitarlo:** dejar `walkImports` exactamente como está — leyendo el fuente crudo (D-05: «reutiliza el que ya vive ahí»). `stripComments` solo en el source-grep dinámico, igual que WR-03.

### Pitfall 5: Mensaje de fallo con el conjunto en vez de la cadena

**Qué sale mal:** el guard dice qué está mal pero no dónde cortar. Para `App.js` son 24 ficheros de ruido.
**Por qué pasa:** el molde que el fichero ya tiene (`:92-93`, LOG-12) imprime el grafo completo, porque ahí el entry es uno solo y el grafo es pequeño.
**Cómo evitarlo:** D-07 lo exige; §Pattern 2 da el helper.

### Pitfall 6: Anclar el regex de `picocolors` al identificador suelto

**Qué sale mal:** la prosa que documenta la invariante pone roja la suite. Hay al menos 3 comentarios que dicen `picocolors` bajo `src/cli/dashboard/` (`format.js:17`, `markdown.js:13`, `inbox-count.js:21`).
**Cómo evitarlo:** anclar al **patrón de import**, como `check-isolation.test.js:207` ya prescribe. Es exactamente la lección de `83-05` en `STATE.md:101`: «los gates source-hygiene se anclan al PATRÓN DE IMPORT, no al nombre suelto del módulo».

### Pitfall 7: Reescribir las regex de los saneadores «ya que se mueven»

**Qué sale mal:** los goldens cambian y D-17 se rompe. Las regex de `stripControlChars` tienen 3 fases documentadas (CSI, C0/C1/DEL, preservación de `\t`/`\n`) afinadas en dos fases distintas (72 y 78, con WR-02).
**Cómo evitarlo:** el movimiento es un corte del bloque contiguo `:60-123`. Criterio de verificación: `diff` del bloque nuevo contra las líneas 60-123 del `format.js` original → vacío.

### Pitfall 8: Contar «4 ficheros rojos» en el `VERIFICATION`

**Qué sale mal:** el documento describe un fallo que el guard no produce. El guard estático ve **3**; `index.js` solo aparece siguiendo aristas dinámicas, que D-06 excluye del walker a propósito.
**Cómo evitarlo:** el `VERIFICATION` cita el conteo del guard (3) y explica en una línea que `index.js` queda cubierto por la iteración por-entry de D-05, no por una arista.

---

## Code Examples

Todo el código de esta sección se **ejecutó** en esta sesión: rojo contra HEAD, verde contra la simulación del fix. `[VERIFIED]`

### 1. `stripComments` con el orden corregido (D-09/D-10)

```js
// stripComments — DIVERGE A PROPÓSITO del helper de `test/check-isolation.test.js:23-29`
// y de su origen `test/dispatcher-isolation.test.js:24-30`. Aquellos borran los bloques
// `/* … */` ANTES de filtrar las líneas `//`, así que un comentario DE LÍNEA que contenga
// `/*` (p. ej. la glob `src/cli/dashboard/**`) abre un bloque falso que se traga el fichero
// hasta el siguiente `*/`.
//
// Medido sobre los 98 ficheros de `src/` (2026-08-05): con el orden verbatim, TRES ficheros
// pierden el 100% de sus imports estáticos — `src/cli/dashboard/enrich.js` (3→0),
// `src/cli/dashboard/markdown.js` (4→0) y `src/logs/session-lookup.js` (5→0). Los
// disparadores son `markdown.js:14` («imports de src/cli/dashboard/**.»), `enrich.js:26`
// (misma glob) y `session-lookup.js:14` («~/.kodo/logs/*.ndjson»).
//
// Lo que de verdad importa: `markdown.js` es a la vez uno de los tres cegados Y un leaker
// primario de esta fase. Con un `await import('picocolors')` inyectado ahí, el helper
// verbatim da 0 hits (guard CIEGO) y este da 1 (ROJO). Un guard construido sobre el
// verbatim saldría verde sobre el leak que esta fase existe para cerrar.
//
// Orden correcto: líneas `//` primero → bloques `/* */` después → líneas `*` al final.
// Recupera el 100% de los imports en los tres, y no cambia nada en los otros 95.
function stripComments(src) {
  return src
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('*'))
    .join('\n');
}
```

### 2. Reconstrucción de la cadena — aditiva, no toca `walkImports` (D-07)

```js
// Regex CONSTANTE (anti-ReDoS: jamás compilada desde input). Molde: check-isolation.test.js:33.
const DYNAMIC_PICOCOLORS_RE = /\bimport\s*\(\s*['"]([^'"]*picocolors[^'"]*)['"]\s*\)/g;

/** @param {string} file @returns {boolean} */
function importsPicocolors(file) {
  return extractImports(readFileSync(file, 'utf-8')).includes('picocolors');
}

/**
 * Reconstruye la cadena MÁS CORTA de imports desde `entry` hasta el primer fichero que
 * importa `picocolors`. BFS con mapa de padres — deliberadamente SEPARADO de `walkImports`,
 * que devuelve un `Set` sin información de padres y NO se reescribe (D-05).
 *
 * Solo se invoca en el camino de FALLO, para construir el mensaje: la suite verde no lo paga.
 * BFS y no DFS porque la cadena más corta es la que nombra la arista que hay que cortar.
 *
 * @param {string} entry
 * @returns {string[]|null} paths relativos al repo, de `entry` al importador de picocolors
 */
function findChainToPicocolors(entry) {
  const parent = new Map();
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (importsPicocolors(cur)) {
      const chain = [];
      for (let n = cur; n !== undefined; n = parent.get(n)) chain.unshift(relative(REPO, n));
      return chain;
    }
    for (const spec of extractImports(readFileSync(cur, 'utf-8'))) {
      if (!spec.startsWith('.')) continue;
      const resolved = resolve(dirname(cur), spec);
      if (!existsSync(resolved) || seen.has(resolved)) continue;
      seen.add(resolved);
      parent.set(resolved, cur);
      queue.push(resolved);
    }
  }
  return null;
}
```

### 3. El guard transitivo (ISO-01 / D-05/D-06/D-07)

```js
// ISO-01 (Phase 87): el guard TUI-04 de arriba (`:209-220`) mira imports DIRECTOS. Salía
// VERDE mientras tres ficheros del TUI alcanzaban `picocolors` por vía TRANSITIVA — el
// walker que lo detecta lleva 150 líneas más arriba en este mismo fichero, sin usar.
//
// Se conserva el directo (D-08): es aditivo y su mensaje es más legible cuando el leak es
// de primer nivel. Éste es el que muerde de verdad.
//
// El ancla es el PAQUETE `picocolors`, no `src/cli/format.js` (D-07). Hoy son equivalentes
// —`:99-115` asevera que format.js es su único importador— pero un segundo importador
// futuro escaparía a un ancla al fichero.
describe('ISO-01: cero picocolors TRANSITIVO bajo src/cli/dashboard/', () => {
  it('ningún fichero del TUI alcanza picocolors por ninguna cadena de imports estáticos', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    const chains = [];
    for (const file of dashFiles) {
      // D-05: CADA fichero es entry point. Iterarlos todos es lo que hace innecesario
      // seguir aristas dinámicas: `index.js` carga `./App.js` con `import()`, pero `App.js`
      // también es entry y sale rojo por sí mismo.
      if (![...walkImports(file)].some(importsPicocolors)) continue;
      const chain = findChainToPicocolors(file);
      chains.push(chain ? chain.join('\n     → ') : relative(REPO, file));
    }
    assert.deepEqual(
      chains,
      [],
      `Color del TUI debe salir de ink <Text>, no de picocolors (D-12) — ni por vía TRANSITIVA.\n` +
        `Cadenas de import que alcanzan picocolors:\n  - ${chains.join('\n  - ')}\n` +
        `Corta la PRIMERA arista de cada cadena: el saneador de texto vive en src/cli/sanitize.js ` +
        `(hoja sin color), no en src/cli/format.js.`,
    );
  });

  // D-06 (precedente locked: Phase 85 D-09 / WR-03, check-isolation.test.js:192-228):
  // `walkImports` sigue siendo ESTÁTICO y las aristas dinámicas se cubren con un source-grep
  // sobre la MISMA lista que el walker devuelve. Seguir aristas dinámicas DENTRO del walker
  // ensancharía la clausura y pondría rojos guards vecinos por motivos espurios — y la
  // reacción natural a un rojo espurio es debilitarlos.
  //
  // `stripComments` va ANTES del match y es OBLIGATORIO: sin él se cuelan aristas fantasma
  // de `@type {import('…')}`, que son imports de TIPO borrados en runtime, no aristas.
  // Medido sobre `src/` (2026-08-05): 139 matches → 128 al descartar los de una sola línea
  // `/** … */`; 11 fantasmas, 9 con specifier relativo (entre ellos `src/cli/polling.js:417
  // → '../logger.js'`, que apunta justo al módulo que el guard hermano prohíbe).
  // El assert está anclado al PATRÓN DE IMPORT, nunca al identificador suelto: la prosa de
  // `dashboard/format.js:17`, `markdown.js:13` e `inbox-count.js:21` menciona `picocolors`
  // y no puede poner roja la suite.
  it('ningún fichero del grafo del TUI hace import() DINÁMICO de picocolors (ISO-01/ISO-04)', () => {
    const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
    const graph = new Set();
    for (const file of dashFiles) walkImports(file, graph); // unión de las clausuras
    const violations = [];
    for (const file of graph) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const m of stripped.matchAll(DYNAMIC_PICOCOLORS_RE)) {
        violations.push(`${relative(REPO, file)} → import('${m[1]}')`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      `un fichero del grafo del TUI carga picocolors por import() dinámico (la invariante ` +
        `de color-isolation se rompería con el guard estático en verde) vía:\n  ${violations.join('\n  ')}`,
    );
  });
});
```

**Salida real contra HEAD** `[VERIFIED]`:

```
Cadenas de import que alcanzan picocolors:
  - src/cli/dashboard/App.js
     → src/cli/format.js
  - src/cli/dashboard/SessionTable.js
     → src/cli/dashboard/markdown.js
     → src/cli/format.js
  - src/cli/dashboard/markdown.js
     → src/cli/format.js
```

### 4. Pureza de `dashboard/format.js` + convergencia (ISO-03 / D-13/D-14)

```js
// ISO-03 (Phase 87 / UF-02): `src/cli/dashboard/format.js` es la capa de presentación PURA
// del dashboard, y su pureza es la PREMISA sobre la que descansa que `select.js` pueda
// importarlo sin arrastrar color (DEBT-06 lo cableó en la Phase 85; el comentario de
// `select.js:30-35` afirma esa pureza, y hasta hoy NINGÚN test la aseveraba).
//
// Molde de redacción: los guards de hoja de `src/session/handoff.js`
// (check-isolation.test.js:242-257) y `src/tasks/pending.js` (:270-285). DIVERGENCIA ÚNICA
// y medida: aquellos exigen CERO imports incluidos builtins; éste admite una allowlist de
// UN elemento, `node:path` (`format.js:25` importa `basename`). Razón: `node:path` es un
// builtin sin efectos de módulo y no arrastra nada — medido, la clausura transitiva de este
// fichero es exactamente 1 (él mismo). La allowlist es la única admitida por D-16.
describe('ISO-03: src/cli/dashboard/format.js es una HOJA pura (UF-02)', () => {
  /** @type {readonly string[]} */
  const ALLOWED_BUILTINS = Object.freeze(['node:path']);

  it('cero imports relativos; builtins solo los de la allowlist; clausura de 1', () => {
    const formatPath = join(SRC, 'cli', 'dashboard', 'format.js');
    assert.equal(existsSync(formatPath), true, 'debe existir — si no, este test pasa trivialmente');
    const imports = extractImports(readFileSync(formatPath, 'utf-8'));
    assert.deepEqual(
      imports.filter((s) => s.startsWith('.')),
      [],
      `dashboard/format.js debe ser una HOJA: cero imports relativos, para que select.js lo ` +
        `importe sin arrastrar grafo ni color. Encontrados: ${imports.filter((s) => s.startsWith('.')).join(', ')}`,
    );
    assert.deepEqual(
      imports.filter((s) => !ALLOWED_BUILTINS.includes(s)),
      [],
      `builtins fuera de la allowlist [${ALLOWED_BUILTINS.join(', ')}]: ${imports.join(', ')}`,
    );
    // El assert que de verdad muerde: los dos de arriba son de FORMA, éste de ALCANZABILIDAD.
    assert.equal(
      walkImports(formatPath).size,
      1,
      'la clausura transitiva de dashboard/format.js debe ser exactamente él mismo',
    );
  });

  // D-14 — CONVERGENCIA (espejo de ORCH-05, check-isolation.test.js:292-300). Sin este
  // assert positivo, la premisa que ISO-03 protege se puede regresar EN SILENCIO moviendo
  // `nextCell` a otro sitio: el guard de pureza seguiría verde sobre un módulo huérfano.
  it('select.js consume ./format.js (convergencia — la pureza tiene consumidor)', () => {
    const graph = walkImports(join(SRC, 'cli', 'dashboard', 'select.js'));
    const formatPath = join(SRC, 'cli', 'dashboard', 'format.js');
    assert.ok(
      graph.has(formatPath),
      `select.js debe importar ./format.js (DEBT-06 / D-04 de la Phase 85: deriveAnyNext delega ` +
        `en nextCell). Sin este consumidor, ISO-03 congela un módulo que no usa nadie.\n` +
        `Grafo desde select.js:\n  ${[...graph].map((p) => relative(REPO, p)).join('\n  ')}`,
    );
  });
});
```

### 5. La declaración honesta que sustituye a `:14` y `:33` (ISO-04 / D-12)

Con los números **corregidos** de §Hallazgo 6 (26 ficheros, no 30):

```js
// Dos regex para cubrir las formas ESM que usa el repo:
//   1. `import X from 'Y'` / `import { X } from 'Y'` / `export ... from 'Y'` (con binding)
//   2. `import 'Y'` (side-effect import, sin binding) — hay que detectarlo porque es
//      la forma más corta de colar un logger.js al grafo del helper de formato.
//
// ── Qué cubre este fichero, y qué NO (Phase 87 / ISO-04) ──────────────────────────
// Hasta la Phase 87 estas dos líneas decían «No cubre `import()` dinámico — el repo no lo
// usa». Era FALSO: `src/providers/registry.js:27,28,57,58` y `src/session/state.js:247`
// hacen `await import()` desde antes de que ese comentario se escribiera. Un fichero no
// puede declarar un punto ciego apoyándose en una premisa que no se sostiene.
//
// CUBRE:
//   - imports estáticos: `import … from`, `import 'x'`, re-exports `export … from`.
//   - `import()` dinámico con specifier LITERAL, fuera de comentarios (guard de source-grep
//     del final del fichero; `stripComments` va antes del match, ver su cabecera).
//
// NO CUBRE — punto ciego RESIDUAL, nombrado, no cerrado:
//   - `import()` con specifier COMPUTADO (`import(ruta)`, `import(`./${n}.js`)`). Ningún
//     regex lo resuelve sin ejecutar el módulo, y ejecutar módulos dentro de un guard de
//     test es justo lo que D-06 evita.
//
// MEDICIÓN FECHADA, NO GARANTÍA (2026-08-05, sobre los 98 ficheros de `src/`):
//   - 0 `import()` con specifier no literal.
//   - 128 `import()` con specifier literal, repartidos en 26 ficheros.
// Es una foto, no una promesa: mañana puede aparecer el primero computado y este fichero
// no lo verá. Se escribe así a propósito — «el repo no lo usa» es exactamente el pecado
// que ISO-04 retira.
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;
```

Y en el JSDoc de `walkImports` (`:33`), sustituir la línea falsa por:

```
 * NO sigue `import()` dinámico — a propósito (D-06, precedente Phase 85 / WR-03). Seguir
 * aristas dinámicas aquí ensancharía la clausura y pondría rojos guards vecinos por motivos
 * espurios. El punto ciego lo cubre el source-grep sobre esta misma clausura; el residual
 * (specifier computado) queda declarado en la cabecera del fichero.
```

### 6. El módulo-hoja nuevo — cabecera propuesta

```js
// @ts-check
//
// src/cli/sanitize.js — Phase 87 Plan 0X (ISO-02).
//
// HOJA de CERO imports. Saneadores PUROS de texto no confiable, movidos VERBATIM desde
// `src/cli/format.js:60-123` (Phases 72/78) sin tocar una sola regex.
//
// ── Por qué existe este fichero (no es organización, es una invariante) ────────────
// Vivían en `src/cli/format.js`, el ÚNICO importador de `picocolors` (D-07). Eso hacía que
// `src/cli/dashboard/App.js` y `src/cli/dashboard/markdown.js` —que solo querían sanear
// texto— arrastrasen el paquete de color al grafo del TUI, rompiendo la invariante
// color-isolation (D-12 Phase 34) con el guard directo en VERDE.
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ──────────────────────────
// Ni `node:*`, ni relativos. Mismo contrato que `src/session/handoff.js`,
// `src/tasks/pending.js` y `src/logger-noop.js`. Si este módulo deja de ser hoja,
// reabre por la puerta de atrás la arista que la Phase 87 cerró.
// Aseverado por test/format-isolation.test.js.
//
// ── PROHIBIDO el shim de re-export (D-02) ──────────────────────────────────────────
// `src/cli/format.js` NO re-exporta estas funciones. Mantener viva esa arista dejaría un
// atajo legítimo que dispara la alarma sin ser un error; el objetivo es que el camino
// correcto sea el ÚNICO disponible.

/* …bloque :60-123 de format.js, byte a byte… */
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Guard de import directo (`extractImports(f).includes('picocolors')`) | Guard **transitivo** por-entry con `walkImports` | Phase 87 (esta) | Detecta la clase de leak que llevaba abierta desde la Phase 75 |
| Mensaje de fallo = grafo completo (`format-isolation.test.js:92-93`) | Mensaje = **cadena más corta** por BFS | Phase 87 (D-07) | El mensaje nombra la arista a cortar en vez de listar 24 ficheros |
| `stripComments` verbatim (bloques antes de líneas) — `dispatcher-isolation` → `check-isolation` | Orden corregido (líneas → bloques → `*`) | Phase 87 (D-09/D-10) | Recupera el 100% de los imports en 3 ficheros; deja de cegar el guard sobre un leaker primario |
| Comentario «el repo no lo usa» sobre `import()` | Declaración honesta con **medición fechada** + punto ciego residual nombrado | Phase 85 (`check-isolation.js`) → Phase 86 (`lock.js:455-457`) → **Phase 87** (tercero de la serie) | La honestidad de los comentarios de guard es ya un patrón consolidado del repo |
| Lógica compartida importada del «módulo gordo» | **Módulo-contrato hoja** de cero imports + guard | Phase 74 (`handoff.js`) → Phase 76 (`pending.js`) → **Phase 87** (`sanitize.js`, el tercero) | Patrón establecido; esta fase solo lo aplica una vez más |

**Deprecado / retirado por esta fase:**

- `test/format-isolation.test.js:14` y `:33` — premisa falsa (los dos comentarios que dan nombre a OQ-1).
- `src/cli/format.js` como fuente de `stripControlChars` / `stripForKeystroke` — pasa a `src/cli/sanitize.js`, **sin shim** (D-02).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|---|---|---|
| A1 | `src/cli/sanitize.js` es el mejor nombre para la hoja nueva | §Hallazgo 3, §Code 6 | Ninguno funcional — es discreción explícita del planner (CONTEXT §Claude's Discretion). Verificado: el path está libre. |
| A2 | Los 3 comentarios de zona gris (`inbox-count.js:9-14`, `dashboard-inbox-count.test.js:7-8`) deben corregirse en esta fase | §Runtime State Inventory | Si se dejan, la fase cierra dejando comentarios falsos en el mismo repo cuyo pecado corrige. Riesgo bajo (doc-only) pero contradice el espíritu de ISO-04. **Decisión del planner** — si se difieren, con trigger escrito. |
| A3 | Actualizar `test/manager.test.js:835` y `:867` no viola DEBT-04 | §Hallazgo 4 | Si se leyera como relajación, el `VERIFICATION` sería impugnable. Mitigación: escribir la distinción en el commit (el assert exige lo mismo, cambia el path canónico). Riesgo real: bajo — el assert no pierde ni una condición. |
| A4 | Con el chain-message de D-07, la elección de `markdown.js` para la mordida (D-15) no depende ya del tamaño del grafo | §Hallazgo 8 | Ninguno — D-15 es LOCKED y `markdown.js` sigue siendo válido. Solo afecta a cómo se **justifica** la elección en el `VERIFICATION`. |
| A5 | El repo no tiene `CLAUDE.md` de proyecto ni `rules/` en `.claude/skills/` | §Project Constraints | Verificado por `ls`. Si apareciera uno después, sus directivas prevalecerían. |

---

## Open Questions

1. **¿`stripComments` y el walker endurecido se extraen a un helper compartido?**
   - Lo que sabemos: CONTEXT §Claude's Discretion lo deja abierto, con la condición dura de **no propagar la versión con bug**. `deferred-items` tiene ya una entrada para extraer el walker a `test/helpers/import-graph.mjs`, con trigger «el cuarto fichero de guard».
   - Lo que no está claro: si crear el helper ahora adelanta ese diferido (bien) o mete refactor de infraestructura en un milestone de saneo puro (mal).
   - Recomendación: **duplicar con la razón escrita**, no extraer. Motivo medido: el helper corregido y el verbatim **deben coexistir** mientras `check-isolation.test.js` y `dispatcher-isolation.test.js` sigan con el suyo (su corrección está explícitamente diferida). Un helper compartido obligaría a tocar los tres ficheros — que es exactamente lo que el diferido evita. La duplicación es de 8 líneas y lleva su medición encima.

2. **¿Se implementa el filtro de línea de D-11 además de `stripComments`?**
   - Lo que sabemos: los dos métodos dan **exactamente 128** matches; `stripComments` es estrictamente más fuerte (§Hallazgo 6, corrección 2).
   - Lo que no está claro: si D-11 pide el filtro de línea **como mecanismo** o solo su resultado (que los imports de tipo no cuenten como aristas).
   - Recomendación: implementar `stripComments` como el mecanismo y **satisfacer D-11 literalmente** añadiendo el filtro de línea, que cuesta un `.filter()` y no cambia el resultado. Documentar con la medición que el trabajo lo hace `stripComments` — para que un lector futuro no crea que el filtro de línea basta y lo use solo.

3. **¿El `VERIFICATION` cuenta 3 leaks o 4 ficheros?**
   - Lo que sabemos: el guard estático ve 3; CONTEXT `<specifics>` pide contar 4.
   - Recomendación: **contar 3 como salida del guard** y mencionar `index.js` como cubierto-por-construcción vía D-05, con una línea de explicación. Escribir «4 rojos» describiría un fallo que el test no produce.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Node.js (`node:test`, `node:assert/strict`) | toda la suite | ✓ | ejecutado con éxito esta sesión (2589 tests) | — |
| `npm test` (`node --test $(find test -name '*.test.js' -type f)`) | gate de fase | ✓ | — | — |
| `git` | commits, mordida | ✓ | repo en `main` | — |
| Dependencias npm nuevas | — | **N/A** | — | La fase no instala nada; invariante cross-milestone lo prohíbe |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** ninguna.

---

## Validation Architecture

`workflow.nyquist_validation: true` `[VERIFIED: .planning/config.json leído esta sesión]`

### Test Framework

| Property | Value |
|---|---|
| Framework | `node:test` + `node:assert/strict` (built-in, Node ≥ 20) |
| Config file | ninguno — el runner se invoca por CLI |
| Quick run command | `node --test test/format-isolation.test.js` |
| Full suite command | `npm test` (= `node --test $(find test -name '*.test.js' -type f)`) |
| Baseline del fichero objetivo | **8 tests / 5 suites / 0 fail** `[VERIFIED 2026-08-05 — coincide con D-18]` |
| Baseline de la suite | **2589 tests / 588 suites / 1 skipped** `[VERIFIED sobre la simulación]` |

### Phase Requirements → Test Map

| Req | Comportamiento observable | Tipo | Comando automatizado | ¿Existe? |
|---|---|---|---|---|
| **ISO-01** | Un fichero del TUI con cadena transitiva a `picocolors` pone el guard rojo | unit (guard estático) | `node --test test/format-isolation.test.js` → suite `ISO-01`, test transitivo | ❌ Wave 0 (a crear) |
| **ISO-01** | El mensaje de fallo imprime la **cadena**, no el conjunto | unit — aserción sobre el mensaje | mismo comando; observable en la salida de la mordida | ❌ Wave 0 |
| **ISO-01** | Un `import()` dinámico de `picocolors` en el grafo del TUI pone el guard rojo | unit (source-grep) | mismo comando, test dinámico | ❌ Wave 0 |
| **ISO-01** | **Mordida:** reintroducir `markdown.js:27` → rojo; revertir → verde | **manual-only** (D-15 prohíbe infraestructura de mutación) | evidencia citada en `VERIFICATION`: diff + salida roja + conteo | manual |
| **ISO-02** | Los 3 ficheros del TUI dejan de alcanzar `picocolors` | unit | mismo comando (el guard de ISO-01 **es** la verificación de ISO-02) | ❌ Wave 0 |
| **ISO-02** | Cero imports de los saneadores desde `cli/format.js` | source-grep | `grep -rn "strip\(ControlChars\|ForKeystroke\)" src test \| grep "from.*cli/format"` → 0 hits | ❌ Wave 0 (criterio de tarea) |
| **ISO-02** | Cero regresión de comportamiento (criterio 5) | integration | `npm test` verde; conteos idénticos en los 5 ficheros de D-17 | ✅ existen |
| **ISO-02** | El movimiento es byte-idéntico | source-diff | `diff <(sed -n '60,123p' <format.js@HEAD>) <(sed -n '<rango>p' src/cli/sanitize.js)` → vacío | ❌ Wave 0 (criterio de tarea) |
| **ISO-03** | `dashboard/format.js` tiene cero imports relativos y builtins ⊆ allowlist | unit | `node --test test/format-isolation.test.js` → suite `ISO-03` | ❌ Wave 0 |
| **ISO-03** | Su clausura transitiva es exactamente 1 | unit | ídem | ❌ Wave 0 |
| **ISO-03 (D-14)** | `select.js` sigue consumiendo `./format.js` | unit (convergencia) | ídem | ❌ Wave 0 |
| **ISO-04** | Los comentarios de `:14` y `:33` ya no afirman «el repo no lo usa» | source-grep | `grep -c "el repo no lo usa\|no los usa" test/format-isolation.test.js` → **0** | ❌ Wave 0 (criterio de tarea) |
| **ISO-04** | La declaración honesta nombra el punto ciego residual con medición fechada | **manual-only** (revisión de prosa) | inspección en `VERIFICATION`, cita de la sección | manual |
| **ISO-04** | `stripComments` corregido recupera los imports de los 3 ficheros | unit (meta-test opcional, recomendado) | assert de que `extractImports(stripComments(markdown.js)).length === 4` | ❌ Wave 0 (opcional pero barato) |

### Sampling Rate

- **Por commit de tarea:** `node --test test/format-isolation.test.js` (≈76 ms) + el fichero tocado por la tarea.
- **Por merge de wave:** `node --test test/format-isolation.test.js test/manager.test.js test/dashboard-format.test.js test/dashboard-markdown.test.js test/format.test.js test/stop.test.js test/inbox-cli.test.js test/inbox-format-golden.test.js test/dashboard-table.test.js test/dashboard-inbox-count.test.js test/check-isolation.test.js` (los 11 ficheros con exposición medida).
- **Gate de fase:** `npm test` completo verde (~24 s) antes de `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/format-isolation.test.js` — suite `ISO-01` transitiva (con `findChainToPicocolors`) — cubre ISO-01/ISO-02
- [ ] `test/format-isolation.test.js` — test de `import()` dinámico + `stripComments` corregido — cubre ISO-01/ISO-04
- [ ] `test/format-isolation.test.js` — suite `ISO-03` (hoja + allowlist + clausura 1) y aserto de convergencia D-14 — cubre ISO-03
- [ ] `test/format-isolation.test.js` — cabecera reescrita (declaración honesta) — cubre ISO-04
- [ ] **Sin instalación de framework:** `node:test` es built-in y la suite ya tiene 181 ficheros.

**Nota de muestreo:** el fichero objetivo corre en 76 ms. No hay ninguna razón para no ejecutarlo en **todos** los commits de esta fase.

---

## Security Domain

`security_enforcement` no aparece en `.planning/config.json` → tratado como habilitado.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | La fase no toca auth |
| V3 Session Management | no | No toca sesiones HTTP |
| V4 Access Control | no | — |
| **V5 Input Validation / Output Encoding** | **SÍ — es el corazón de la fase** | `stripControlChars` / `stripForKeystroke` son los saneadores de **contenido externo no confiable** (comentarios de Plane, títulos de tarea, `next` persistido por un LLM). Se mueven **byte a byte**, sin reescribir una regex. Cualquier cambio en su cuerpo es un cambio de superficie de seguridad. |
| V6 Cryptography | no | — |
| V7 Error Handling / Logging | marginal | Los saneadores son never-throws (`String(s)`); esa propiedad se preserva por el movimiento verbatim |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation | Estado en esta fase |
|---|---|---|---|
| Inyección de terminal por CSI (`\x1b[…`) | Tampering | `stripControlChars` fase 1 | **Se mueve verbatim** — cubierto por `test/dashboard-format.test.js:360-413` (58 tests) |
| OSC-52 (escritura al portapapeles del operador) | Tampering / Info Disclosure | `stripControlChars` fase 2 (borra `\x1b` completo) | **Se mueve verbatim** |
| C1 de un solo byte (`\x9b` CSI, `\x9d` OSC) sin ESC previo | Tampering | `stripControlChars` fase 2 (rango `\x7f-\x9f`) — WR-02 Phase 78 | **Se mueve verbatim** |
| Enter espurio en el carril de keystroke (`\n` real o literal `\`+`n`) | Tampering | `stripForKeystroke` (colapso a espacio) — WR-02 Phase 78 | **Se mueve verbatim**; `test/stop.test.js:413-439` tiene los tests con dientes |
| ReDoS en las regex del guard | DoS | Regex **constantes**, nunca compiladas desde input; clases `[^'"]*` que no retroceden | Molde de `check-isolation.test.js:31-33`, replicado en `DYNAMIC_PICOCOLORS_RE` |
| **Regresión de saneo por refactor** ← el riesgo específico de esta fase | Tampering | Movimiento byte-idéntico + los 5 ficheros de test de D-17 sin tocar | **Verificado empíricamente**: 58/9/22/44/33 idénticos post-move |

**Verificación de seguridad clave:** el mayor riesgo de esta fase no es un fallo de aislamiento, es que alguien «aproveche» el movimiento para limpiar las regex de saneo. Los tres carriles afectados (`store.js` para el inbox, `stop.js`/`manager.js` para el keystroke al orquestador, `App.js`/`markdown.js` para el render) reciben contenido de un LLM o de un provider externo. El criterio `diff` vacío del bloque movido no es burocracia: es el control.

---

## Project Constraints (from CLAUDE.md)

**No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en este repo.** `[VERIFIED: ls]`
**No existe `rules/` en `.claude/skills/`** — las tres skills (`kodo-capture`, `kodo-orchestrate`, `worktree-cleanup`) no aportan directivas de código. `[VERIFIED: find .claude/skills -maxdepth 2 -type d]`

Las restricciones vinculantes vienen de `STATE.md` §Critical Invariants (cross-milestone) y aplican a esta fase:

| Invariante | Aplicación aquí |
|---|---|
| **Color isolation** (`picocolors` solo desde `src/cli/format.js`) | Se **preserva**: `format.js` sigue siendo el único importador (`format-isolation.test.js:99-115` sigue verde). |
| **Cero nuevas dependencias npm** | Ninguna. Prohíbe el parser AST. |
| **TUI never-throws** | El movimiento no toca ninguna rama de error; los saneadores siguen coaccionando con `String(s)`. |
| **`--json` byte-determinismo (DX-06)** | Los saneadores son puros; salida byte-idéntica. Verificado por los goldens. |
| **Contenido LLM hacia terminal/keystroke SIEMPRE saneado** (`stripControlChars` en composición, `stripForKeystroke` en keystroke) | Se preserva por construcción: mismas funciones, mismos call sites, mismos cuerpos. |
| **DEBT-04 LOCKED** (D-16) | Ningún assert se debilita. Los 2 edits de `manager.test.js` cambian el path canónico, no la condición. |
| **Documentación en español** | `RESEARCH.md`, `PLAN.md`, `VERIFICATION.md` en español; código, paths e identificadores en su idioma actual. |

---

## Sources

### Primary (HIGH confidence) — medición directa sobre el árbol real, esta sesión

- **Scripts de scouting propios** (walker, `stripComments` A/B, regex de `import()`, reconstrucción de cadena) ejecutados contra `/Users/alex/dev/klab/kodo` — §Hallazgos 1, 5, 6, 7.
- **Simulación completa del movimiento** (copia de `src/` + `test/`, hoja creada con el bloque `:60-123` verbatim, 8 call sites actualizados) con la suite entera corrida — §Hallazgos 2, 3, 4, 7.
- **Guard endurecido escrito y ejecutado** contra HEAD (rojo, 3 cadenas) y contra la simulación (verde), más las dos mordidas — §Hallazgo 8, §Code Examples.
- **Ficheros leídos íntegros:** `test/format-isolation.test.js` (222 líneas) · `test/check-isolation.test.js` (302) · `src/cli/format.js` (244) · `src/cli/dashboard/format.js` (290) · `package.json` · `.planning/config.json`.
- **Ficheros leídos parcialmente con cita de línea:** `src/cli/dashboard/App.js:60-80` · `src/cli/dashboard/markdown.js:1-35` · `src/cli/dashboard/select.js:30-40` · `src/cli/dashboard/SessionTable.js:23-78` · `src/cli/dashboard/index.js:137-257` · `src/cli/dashboard/inbox-count.js:1-30` · `test/manager.test.js:826-880` · `test/inbox-cli.test.js:850-880` · `test/dashboard-inbox-count.test.js:1-40` · `src/tasks/pending.js:1-20` · `src/providers/registry.js:27,28,57,58` · `src/session/state.js:247`.

### Secondary (MEDIUM confidence) — artefactos de planificación del propio repo

- `.planning/phases/87-*/87-CONTEXT.md` — las 18 decisiones locked.
- `.planning/REQUIREMENTS.md` §Aislamiento de color en el TUI — ISO-01..04 verbatim.
- `.planning/STATE.md` §Deferred Items («Higiene de tests»), §Critical Invariants, §Accumulated Context.
- `.planning/ROADMAP.md` §Phase 87 — goal + criterios.

### Tertiary (LOW confidence)

Ninguna. **No se consultó ninguna fuente externa ni web:** el dominio es enteramente interno al repo (guards propios, patrones propios, código propio) y toda afirmación de esta investigación se apoya en lectura o ejecución sobre el árbol real.

---

## Metadata

**Confidence breakdown:**

| Área | Nivel | Razón |
|---|---|---|
| Radio y cadenas del leak | **HIGH** | Walker re-ejecutado; cadenas impresas; 1 corrección menor (App.js 24 vs 25) |
| Call sites (8, no 5) | **HIGH** | `grep` exhaustivo + simulación que los ejercita todos |
| Tests que se rompen | **HIGH** | Suite entera (2589 tests) corrida sobre la simulación; los 2 fallos reales aislados de los 2 artefactos de entorno |
| Bug de `stripComments` | **HIGH** | Reproducido dígito a dígito + evidencia superior (guard ciego ante `import('picocolors')` en `markdown.js`) |
| Mediciones de `import()` | **HIGH** | Confirmadas 5 de 6; 1 corrección (26 ficheros, no 30) |
| Forma del guard endurecido | **HIGH** | Código escrito y ejecutado en las dos direcciones + 2 mordidas |
| Nombre/ubicación del módulo nuevo | **MEDIUM** | Discreción explícita del planner; solo verifiqué que el path está libre |
| Alcance de la corrección de comentarios de zona gris | **MEDIUM** | Depende de una decisión de scope del planner (A2) |
| Ausencia de dependencias/entorno | **HIGH** | `package.json` y `config.json` leídos |

**Research date:** 2026-08-05
**Valid until:** 2026-09-04 (30 días — dominio interno y estable; el único evento que invalidaría las mediciones es un toque a `src/cli/format.js`, `src/cli/dashboard/**` o a los ficheros de guard)

---

*Phase: 87 — Aislamiento de color transitivo en el TUI*
*Investigación: 2026-08-05 — mediciones del discuss verificadas y extendidas; 4 divergencias documentadas*
