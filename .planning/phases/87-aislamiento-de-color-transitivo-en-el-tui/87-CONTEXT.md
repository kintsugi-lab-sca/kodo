# Phase 87: Aislamiento de color transitivo en el TUI - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Mode:** `--auto` (todas las gray areas auto-resueltas con la opción recomendada; log completo en `87-DISCUSSION-LOG.md`)

<domain>
## Phase Boundary

Devolver a la invariante **color-isolation** su condición de verdad **medible**: ningún fichero de `src/cli/dashboard/` alcanza `picocolors`, **ni siquiera transitivamente**, y el guard lo detecta. Hoy el guard de `test/format-isolation.test.js:209-220` solo mira imports **directos** — sale verde mientras el leak existe.

**Las cuatro piezas:**

1. **ISO-01** — endurecer el guard a transitivo, con mordida verificada reintroduciendo un leak real.
2. **ISO-02** — cerrar los leaks medidos: el TUI deja de alcanzar `src/cli/format.js` (único importador de `picocolors`).
3. **ISO-03** — congelar por test la pureza de `src/cli/dashboard/format.js`, premisa sobre la que descansa que `select.js` lo importe sin arrastrar color.
4. **ISO-04** — retirar la premisa falsa de `:14` y `:33` («el repo no lo usa» sobre `import()` dinámico) cubriendo el caso o declarando con honestidad lo que queda fuera.

**Radio REAL medido en este discuss** (script de scouting, walker transitivo + variantes de regex — supera al conteo del roadmap):

| Fichero del TUI | Estado | Vía |
|---|---|---|
| `src/cli/dashboard/App.js:73` | **LEAK primario** | `import { stripControlChars } from '../format.js'` |
| `src/cli/dashboard/markdown.js:27` | **LEAK primario** | `import { stripControlChars } from '../format.js'` |
| `src/cli/dashboard/SessionTable.js` | LEAK **derivativo** | `:26 → ./markdown.js` **y** `:73 → ./App.js` (ambas vías) |
| `src/cli/dashboard/index.js` | LEAK **derivativo** | `import()` dinámico de `./App.js` (solo visible si se siguen aristas dinámicas) |
| Los 12 ficheros restantes de `src/cli/dashboard/` | limpios | grafo ≤ 10, ninguno alcanza `picocolors` |

**Solo hay 2 aristas primarias.** Cerrar `App.js:73` y `markdown.js:27` cierra los 4 ficheros. El roadmap habla de «3 leaks»; la medición dice **4 ficheros rojos, 2 aristas**. Un plan que toque 3 ficheros de forma independiente estaría trabajando de más.

**Fuera de alcance:** rediseñar el helper de color, tocar el render del TUI, generalizar el guard a otros directorios, arreglar el mismo bug de `stripComments` en `test/check-isolation.test.js` (ver Deferred).

**Requirements:** ISO-01, ISO-02, ISO-03, ISO-04.

</domain>

<decisions>
## Implementation Decisions

### Cierre de los leaks (ISO-02)

- **D-01:** Los saneadores **puros de texto** salen de `src/cli/format.js` a un **módulo nuevo sin color**: `stripControlChars` (`format.js:80-97`) y `stripForKeystroke` (`format.js:114-125`, que llama a la primera) se mueven **juntos y byte a byte**, sin reescribir sus regex. El módulo nuevo es una **hoja**: cero imports, cero `picocolors`. Es el mismo movimiento que ya hicieron `src/session/handoff.js` y `src/tasks/pending.js` — módulos-contrato con cero imports para que un leaf del dashboard pueda importarlos sin arrastrar grafo (`test/check-isolation.test.js:231-258, 260-285`). — **Reversibility:** costly — mover una función exportada toca 5 call sites; deshacerlo los toca otra vez.
  - **Call sites a actualizar — CORREGIDO POR `87-RESEARCH.md` §Hallazgo 2: son 8, no 5.** El discuss contó solo los de `stripControlChars` y se dejó tres de `stripForKeystroke`. La lista vinculante es la del RESEARCH:
    `src/cli/dashboard/App.js:73` · `src/cli/dashboard/markdown.js:27` · `src/cli/inbox.js:36` · `src/session/manager.js:12` · `test/dashboard-format.test.js` · **`src/cli/capture.js:38`** · **`src/hooks/stop.js:16`** · **`src/inbox/store.js:46`**.
    Sin shim (D-02), los tres omitidos **fallan en tiempo de carga** en carriles vivos (captura CLI, hook de Stop, escritura del inbox). Dos de los ocho (`inbox.js`, `capture.js`) importan `createFormatter` en la misma línea: ahí el edit **parte el import en dos**, no sustituye el path.

- **D-02:** **Sin shim de re-export** en `format.js`. Un `export { stripControlChars } from './sanitize.js'` mantendría viva y legítima la arista `dashboard → format.js`: el guard endurecido la seguiría cazando, pero el objetivo de la fase es que el camino correcto sea el **único** disponible, no que exista un atajo que dispare la alarma. Son 5 líneas de import; el coste de la limpieza es menor que el de la ambigüedad. — **Reversibility:** reversible.

- **D-03:** `visibleWidth` **no se mueve**. Medido: cero consumidores fuera de `src/cli/format.js` (`:135`, `:216`, ambos internos). Mover «ya que estamos» amplía el diff sin cerrar ninguna arista. — **Reversibility:** reversible.

- **D-04:** **No se toca `SessionTable.js` ni `index.js`.** Son leakers derivativos (medido): cerrar las 2 aristas primarias los cierra. Si tras el fix alguno sigue rojo, eso **no** es una invitación a parchearlo — es señal de una arista que la medición no vio, y se mide antes de tocar nada.

### Arquitectura del guard transitivo (ISO-01)

- **D-05:** El guard endurecido reutiliza el `walkImports` **que ya vive en `test/format-isolation.test.js:40-52`** y lo aplica **por cada fichero de `src/cli/dashboard/`** como entry point, no solo sobre uno. La aserción es: para todo fichero del TUI, **ningún fichero de su clausura transitiva importa `picocolors`**. — **Reversibility:** reversible.
  - Iterar **todos** los ficheros como entry es lo que hace innecesario seguir aristas dinámicas: el leak de `index.js` (dinámico → `App.js`) queda cubierto porque `App.js` **también** es entry y sale rojo por sí mismo.

- **D-06:** `walkImports` **sigue siendo estático**; las aristas dinámicas se cubren con un **source-grep separado sobre la MISMA lista de ficheros que el walker devuelve**. Es el precedente **locked** de la Phase 85 D-09 (`test/check-isolation.test.js:192-228`), con su razón escrita: meter aristas dinámicas dentro del walker ensancha la clausura y pone rojos guards vecinos por motivos espurios — «*y la reacción natural a un rojo espurio es debilitarlos*». — **Reversibility:** reversible.

- **D-07:** El assert se ancla a **`picocolors`** (el paquete, requisito literal de ISO-01), no a `src/cli/format.js`. Hoy son equivalentes porque el test hermano (`format-isolation.test.js:99-115`) asevera que `format.js` es el único importador; pero si mañana aparece un segundo importador, el ancla al paquete lo caza y el ancla al fichero no. El mensaje de fallo debe imprimir la **cadena** (fichero del TUI → … → fichero que importa `picocolors`), no solo el conjunto: un guard transitivo cuyo mensaje no dice el camino se arregla a ciegas.

- **D-08:** El test **directo** actual (`TUI-04 (D-13)`, `:209-220`) **se conserva intacto**. El endurecido es **aditivo**, no un reemplazo: cuesta cero y su mensaje de fallo es más legible cuando el leak es directo.

### `stripComments`: NO copiar el precedente verbatim (ISO-04)

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

### Pureza de `src/cli/dashboard/format.js` (ISO-03)

- **D-13:** Se congela como **hoja de cero imports relativos**, con **allowlist explícita de builtins**. Medido hoy: su clausura transitiva es **exactamente 1 fichero (él mismo)**; su único import es `basename` de `node:path` (`:25`), que no arrastra nada. Precedente literal de redacción: los guards de `handoff.js` y `pending.js` (`test/check-isolation.test.js:242-257`, `:270-285`) — que exigen cero imports **incluidos builtins**; aquí la allowlist es la única divergencia y se escribe con su razón. — **Reversibility:** reversible.

- **D-14:** Además, **aserto positivo de convergencia**: `src/cli/dashboard/select.js:35` importa `./format.js`. Espejo de ORCH-05 (`check-isolation.test.js:292-294`). Sin él, la premisa que ISO-03 protege («*`select.js` puede importarlo sin arrastrar color*») se puede regresar en silencio moviendo `nextCell` a otro sitio: el guard de pureza seguiría verde sobre un módulo que ya no consume nadie.

### Mordida y disciplina (ISO-01, DEBT-04)

- **D-15:** La mordida se verifica **a mano y se registra como evidencia citada** en el `SUMMARY`/`VERIFICATION`: diff exacto del leak reintroducido + salida roja (test que falla, mensaje, conteo). Precedente del repo: Phases 82, 83, 85 (WR-03) y 86 (D-15). **No** se construye infraestructura de mutation testing — el milestone es saneo puro, sin feature nueva. — **Reversibility:** reversible.
  - **Leak a reintroducir:** el de `markdown.js:27` — su grafo es de 3 ficheros, así que el mensaje de fallo cabe entero y es legible como evidencia. El de `App.js` arrastra 25 y produce un muro.

- **D-16:** **DEBT-04 es LOCKED.** Ningún assert se debilita, ningún guard se relaja para acomodar el estado actual, ninguna excepción/allowlist se añade «para que pase». Si el guard endurecido sale rojo, se cierra el leak. La única allowlist admitida es la de D-13 (`node:path`), justificada por medición.

### Cero regresión de comportamiento (criterio 5)

- **D-17:** El movimiento de D-01 es **puro**: misma función, mismo cuerpo, mismos consumidores. Los goldens y tests de render existentes deben pasar **sin tocarse** — `test/dashboard-markdown.test.js:92` (T-75-02: cada línea pasa por `stripControlChars`), `test/inbox-format-golden.test.js`, `test/format.test.js`, `test/stop.test.js:347-439` (carril de keystroke). **Si un golden cambia, el movimiento dejó de ser puro** y hay que revisarlo, no actualizar el golden.
  - **COMPLETADO POR `87-RESEARCH.md` §Hallazgo 4:** la promesa se cumple para los ficheros nombrados arriba (verificado corriendo la suite entera sobre una simulación del movimiento: conteos idénticos al baseline). Pero **hay 2 asserts que sí se rompen y viven en un fichero que este CONTEXT no nombró**: `test/manager.test.js:835` y `:867`, dos guards source-grep anclados literalmente a `from '../cli/format.js'`. Actualizar su path **no viola DEBT-04**: el assert sigue exigiendo el import canónico, solo cambia cuál es el carril canónico. Son otra categoría (guard source-grep), no goldens ni tests de render.

- **D-18:** Baseline verde registrado antes de tocar nada: `node --test test/format-isolation.test.js` → **8 tests / 5 suites / 0 fail** (2026-08-05). El guard endurecido añade tests; ninguno de los 8 existentes puede quedar rojo.

### Claude's Discretion

- Nombre y ubicación exacta del módulo nuevo de D-01 (`src/cli/sanitize.js`, `src/cli/text.js`, …) — el planner elige respetando las convenciones del repo.
- Formato exacto del mensaje de fallo del guard, siempre que imprima la **cadena** (D-07).
- Reparto en planes. Restricción de orden: el guard endurecido debe poder ponerse **rojo** antes del fix (o mordido a mano después), así que el orden natural es guard-primero o guard-y-fix-en-el-mismo-plan con la evidencia de la mordida al final.
- Si `stripComments` y el walker endurecido se extraen a un helper compartido entre los dos ficheros de guard, o se duplican con su razón escrita — con una condición: **no** propagar la versión con el bug de D-09.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### El requisito y su historia
- `.planning/ROADMAP.md` §Phase 87 — los 5 success criteria verbatim y el radio anotado al abrir el milestone.
- `.planning/REQUIREMENTS.md` §Aislamiento de color en el TUI (D-18 + OQ-1 + UF-02) — ISO-01..04 literales.
- `.planning/STATE.md` §Deferred Items, fila «Higiene de tests» — por qué la Phase 85 evaluó este item y decidió **no** cerrarlo, y por qué D-18 y OQ-1 se corrigen **juntos** («arreglar solo el comentario dejaría el guard sin cubrir el caso que su comentario ya no niega»).
- `.planning/milestones/v0.19-phases/85-saneo-de-deuda-nyquist-retroactivo/deferred-items.md` — trigger y razón completa del diferimiento.

### El fichero que se endurece
- `test/format-isolation.test.js` — objetivo de la fase. `:10-16` regex de imports · `:14` y `:33` **los dos comentarios de premisa falsa a retirar** · `:23-28` `extractImports` · `:40-52` `walkImports` (ya existe, se reutiliza) · `:59-71` `listJsFiles` · `:98-129` guard de single-source de `picocolors` · `:200-221` guard **directo** TUI-04 (D-13), el que se endurece.

### El precedente a copiar — y el bug que NO se copia
- `test/check-isolation.test.js:192-228` — Phase 85 D-09 / WR-03: **el patrón exacto** de source-grep de `import()` dinámico sobre la lista que el walker devuelve, con su razón escrita de por qué NO se mete en el walker. **Fuente primaria de D-06.**
- `test/check-isolation.test.js:23-29` — `stripComments`. **Contiene el bug de orden medido en D-09** (borra bloques antes de filtrar líneas `//`). Se lee para entender el patrón, **no** se copia verbatim.
- `test/dispatcher-isolation.test.js:24-30` — origen del helper (misma forma, mismo bug).
- `test/check-isolation.test.js:231-258` (`handoff.js`) y `:260-294` (`pending.js`) — plantilla de redacción de los guards de **hoja de cero imports** (D-13) y del **aserto positivo de convergencia** ORCH-05 (D-14).

### El código que se toca
- `src/cli/format.js:18` (`import { createColors } from 'picocolors'` — la raíz del leak) · `:80-97` `stripControlChars` · `:114-125` `stripForKeystroke` · `:56-58` `visibleWidth` (**no** se mueve, D-03).
- `src/cli/dashboard/App.js:73` — leak primario 1.
- `src/cli/dashboard/markdown.js:27` — leak primario 2 (y `:11-14` el comentario de color-isolation cuya glob `dashboard/**` dispara el bug de D-09).
- `src/cli/dashboard/format.js:25` (único import, `node:path`) — el módulo cuya pureza se congela (ISO-03).
- `src/cli/dashboard/select.js:35` — el consumidor que da sentido a ISO-03 (D-14).
- Call sites restantes: `src/cli/inbox.js:36` · `src/session/manager.js:12` · `test/dashboard-format.test.js`.

### Los tests que no pueden cambiar
- `test/dashboard-markdown.test.js:92` — T-75-02, `stripControlChars` por línea.
- `test/inbox-format-golden.test.js` · `test/format.test.js` · `test/stop.test.js:347-439` — goldens y carril de keystroke (D-17).

### Precedente de honestidad y de mordida
- `.planning/phases/86-cas-sim-trico-de-steallock-holder-vivo/86-CONTEXT.md` §D-15..D-18 — cómo se registra una mordida manual y cómo se declara un punto ciego residual sin venderlo como cierre. Misma fase, mismo milestone, mismo estándar.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`walkImports` / `extractImports` / `listJsFiles`** (`test/format-isolation.test.js:23-71`): el walker transitivo **ya vive en el fichero objetivo**. ISO-01 no necesita infraestructura nueva: necesita aplicarlo donde hoy no se aplica (`:209-220` mira imports directos teniendo el walker 150 líneas más arriba).
- **Patrón source-grep sobre el grafo** (`test/check-isolation.test.js:208-228`): resuelto, probado y con su razón documentada. Se adapta cambiando el regex de `logger` a `picocolors`.
- **Guards de hoja de cero imports** (`handoff.js`, `pending.js`): redacción lista para ISO-03, incluido el mensaje que explica *por qué* existe el guard y qué degradación previene.

### Established Patterns
- **Single source of color (D-07)**: `picocolors` se importa **exactamente** en `src/cli/format.js`, aseverado por `format-isolation.test.js:99-115`. Todo el color del TUI sale de `<Text color>` de ink (D-12). Esto hace que «alcanzar `format.js`» y «alcanzar `picocolors`» sean hoy equivalentes — pero el guard se ancla al paquete (D-07).
- **Módulos-contrato hoja**: cuando un leaf del dashboard necesita lógica compartida, el repo crea un módulo de **cero imports** y lo congela con un guard, en vez de importar del módulo gordo. `handoff.js` y `pending.js` son los dos precedentes; el módulo de D-01 es el tercero.
- **Honestidad de los comentarios de guard**: la Phase 85 ya retiró un comentario de premisa falsa de `check-isolation.test.js` y la Phase 86 retiró otro de `lock.js:455-457`. Este es el tercero de la serie, y el que le dio nombre a OQ-1.

### Integration Points
- `src/cli/format.js` deja de exportar 2 funciones → 5 call sites (4 en `src/`, 1 en `test/`).
- El grafo del TUI pierde su única arista hacia `src/cli/`: tras el fix, `src/cli/dashboard/**` no alcanza `src/cli/format.js` por ningún camino estático.
- Ningún consumidor de color cambia: `createFormatter`, `_resolveUseColor`, `visibleWidth`, `formatRow`/`formatTable` se quedan donde están.

</code_context>

<specifics>
## Specific Ideas

- **El conteo del roadmap está desfasado por defecto, no por exceso.** «3 leaks medidos» → la medición de este discuss dice **4 ficheros rojos** (aparece `index.js` al seguir aristas dinámicas) y **2 aristas primarias**. El planner trabaja sobre las 2 aristas; el `VERIFICATION` cuenta los 4 ficheros.
- **El bug de `stripComments` lo dispara la propia glob de los comentarios de color-isolation** (`src/cli/dashboard/**`). Es decir: los comentarios que documentan la invariante son los que cegarían al guard que la protege. Merece quedar escrito en el fichero, no solo en este CONTEXT.
- **`markdown.js` es el leak de la mordida** (D-15): grafo de 3 ficheros, mensaje de fallo legible.

</specifics>

<deferred>
## Deferred Ideas

- **El mismo bug de `stripComments` vive en `test/check-isolation.test.js:23-29` y en su origen `test/dispatcher-isolation.test.js:24-30`.** Fuera de scope: esta fase endurece `format-isolation.test.js`. **Medido y tranquilizador:** ninguno de los 3 ficheros afectados está hoy en el grafo estático de `check.js` (23 ficheros), así que el guard hermano **no** está ciego ahora mismo. **Trigger:** que un fichero con `/**` dentro de un comentario de línea entre en el grafo de `check.js`, o el próximo toque de cualquiera de esos dos ficheros de guard. Si D-01 crea un helper compartido, la corrección llega gratis — pero propagar el helper **con** el bug queda prohibido (D-09).
- **Extraer el walker de aislamiento a un helper de test compartido** (`test/helpers/import-graph.mjs`) para los 3+ ficheros de guard que hoy lo duplican. Es refactor de infraestructura de tests, no cierre de deuda trazada: fuera del milestone «saneo puro». **Trigger:** el cuarto fichero de guard que necesite copiarlo.
- **`visibleWidth` sigue en `format.js`** (D-03). Si algún día un fichero del TUI lo necesita, reabriría exactamente esta arista. **Trigger:** primer consumidor de `visibleWidth` bajo `src/cli/dashboard/`.

</deferred>

---

*Phase: 87-Aislamiento de color transitivo en el TUI*
*Context gathered: 2026-08-05*
