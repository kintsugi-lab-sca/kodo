---
phase: 85
slug: saneo-de-deuda-nyquist-retroactivo
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-27
---

# Phase 85 — UI Design Contract

> Contrato visual y de interacción de la fase. Generado por `gsd-ui-researcher`, verificado por `gsd-ui-checker`.

---

## Alcance real de la superficie visible

**Esta es una fase de saneo de deuda, no de producto.** La detección de «frontend» disparó porque la fase toca `src/cli/dashboard/select.js`, pero la superficie visible que modifica es diminuta y está acotada a **dos** puntos. Este documento los fija con precisión y marca todo lo demás N/A con su razón. Un UI-SPEC grande aquí sería un defecto, no exhaustividad.

| # | Superficie | Requirement | Fichero | Naturaleza del delta |
|---|-----------|-------------|---------|----------------------|
| **S-1** | **Presencia** de la columna `next` de la tabla del dashboard TUI | DEBT-06 | `src/cli/dashboard/select.js:258` (`deriveAnyNext`) | Una columna que hoy aparece **vacía** deja de aparecer. Cero cambios de render, ancho, posición o color. |
| **S-2** | Una línea **nueva** por stderr en el piggyback de `kodo check` | DEBT-07 / WR-01 | `src/check.js:156-166` | Texto plano nuevo en un carril automático. Cero cambios en las 3 líneas existentes. |

**Sin superficie visible alguna (N/A explícito, no omisión):**

| Requirement | Por qué no aporta superficie |
|-------------|------------------------------|
| **DEBT-05** | Doc-only sobre un comentario JSDoc (`src/session/state.js:53`). Un typedef no se renderiza a ningún usuario. |
| **NYQ-01 / NYQ-02** | Editan 6 ficheros `.planning/**/{N}-VALIDATION.md` en directorios archivados. Artefactos de planificación, **cero superficie de usuario**. |
| **DEBT-07 / WR-02** | Test nuevo en `test/check.test.js`. Un test no tiene superficie. |
| **DEBT-07 / WR-03** | Refuerzo de guard en `test/check-isolation.test.js` + corrección de un comentario. Sin superficie. |

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none** — no aplica |
| Preset | not applicable |
| Component library | **ink 6.8** (`<Box>` / `<Text>`) para el TUI · texto plano para el CLI |
| Icon library | ninguna (terminal) |
| Font | la del emulador de terminal del operador — **no la controla el proyecto** |

**Gate shadcn: NO EJECUTADO, por inaplicabilidad categórica.** No existe `components.json`, `tailwind.config.*` ni `postcss.config.*`, y no deben existir: shadcn es una librería de DOM web y este proyecto no renderiza DOM. `package.json` declara 4 dependencias de runtime (`commander`, `ink`, `picocolors`, `react`) y el constraint **cero deps npm nuevas** está LOCKED en CONTEXT.md. Proponer `npx shadcn init` aquí sería un error de detección propagado a una instalación real.

**Constraints heredados vigentes sobre estas dos superficies** (LOCKED en `85-CONTEXT.md`):

- **color-isolation** — `picocolors` **jamás** bajo `src/cli/dashboard/**`. El color del TUI sale de ink (`<Text dimColor>` / `bold`). Verificado: `src/cli/dashboard/format.js:25` importa solo `node:path`, y el guard §TUI-04 de `test/format-isolation.test.js:200-218` cubre **cada fichero del directorio por separado** — por eso D-04 puede importarlo.
- **TUI never-throws** — S-1 vive en un leaf que nunca lanza.
- **exit codes deterministas 0/1/2** — S-2 es fail-open: informa, jamás bloquea ni altera el exit code.
- **LOG-12** — el grafo de `check.js` no alcanza `src/logger.js`; S-2 **no puede** usar el logger estructurado.

---

## Superficie S-1 — Presencia de la columna `next` (DEBT-06)

### Contrato de presencia

> **Una fila cuyo `next` colapsa a cadena vacía NO enciende la columna `next`.**

`deriveAnyNext(rows)` sigue devolviendo un `boolean` estructural. Su nuevo predicado delega en `nextCell` (D-04 LOCKED):

| Entrada de `r.next` | `nextCell(r)` | ¿Enciende la columna? |
|---------------------|---------------|------------------------|
| `'Escribir el test RED'` | `'Escribir el test RED'` | **sí** |
| `''` | `''` | no |
| `null` / `undefined` / campo ausente | `''` | no |
| no-string (`42`, `{}`) | `''` | no (never-throws) |
| **`'   '`** | **`''`** | **no** ← RED hoy (`true`) |
| **`'\n\t'`** | **`''`** | **no** ← RED hoy (`true`) |
| **`' \r\n '`** | **`''`** | **no** ← RED hoy (`true`) |

### Lo que NO cambia (y el checker no debe pedir)

- **El render de la celda.** `nextCell` (`src/cli/dashboard/format.js:264`) no se toca: sigue colapsando `/\s+/g` + `trim`, sigue devolviendo `''` sin placeholder ruidoso, sigue siendo texto **PLANO sin color propio** (color-isolation D-12 de Phase 75).
- **El layout de la tabla.** `SessionTable.js` no se toca: `COLS.next = 40` (`:99`), posición **al final tras `age`** (`:1044`, `:1107`), cabecera `dimColor` (`:1046`), celda con `truncate: true` (`:1112`). Cuando la columna se omite, **ink recupera el ancho vía flex** — comportamiento ya existente, no un estado nuevo.
- **El consumidor.** `src/cli/dashboard/App.js:820` (`deriveAnyNext(enriched)`) **no se toca** (D-05): el flag se sigue computando sobre el set **SIN filtrar**, de modo que la columna **no parpadea** al teclear una query `/` (Pitfall 4 de Phase 75).

### Precedente de la política «colapsar cuando no hay nada que mostrar»

`anyGsd` / `anyProgress` / `anyNext` son los tres flags estructurales hermanos (`src/cli/dashboard/App.js:814-820`). La política ya establecida es: **una columna sin ningún dato que mostrar se omite, no se pinta vacía**. DEBT-06 no introduce política nueva — corrige la única de las tres que la incumplía por un desajuste entre el predicado y el render.

---

## Superficie S-2 — Línea de fallos del piggyback del sidebar (DEBT-07 / WR-01)

### El problema que la línea resuelve

Hoy `[kodo:check] Sidebar: 0 acción(es) aplicadas` significa **dos cosas opuestas** — «no había nada que arreglar» o «cmux caído, 3 acciones fallidas» — y el operador no puede distinguirlas: el piggyback lee `r.added` / `r.ungrouped` pero **nunca inspecciona `r.errors`**, y con `deps = {}` el logger es el `noopLogger` obligado por LOG-12.

### Literal EXACTO (contrato anclable)

```
[kodo:check] Sidebar: 2 acción(es) fallida(s) (fail-open)
```

Forma en código:

```js
const failed = (r.errors || []).length;
if (failed > 0) {
  errorFn(`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`);
}
```

| Propiedad | Valor contractual |
|-----------|-------------------|
| **Anclaje** | **Anclado a inicio de línea.** La línea empieza exactamente con `[kodo:check] Sidebar: `. Regex de assert admisible: `/^\[kodo:check\] Sidebar: \d+ acción\(es\) fallida\(s\) \(fail-open\)$/` |
| **Canal** | **`errorFn` → stderr. NUNCA `logFn`.** Restricción LOCKED (D-07): un fallo escrito en el canal del éxito sigue siendo invisible en un pipe. |
| **Condición** | `(r.errors || []).length > 0`. Con `errors: []` (o `errors` ausente) **no se emite nada**. |
| **Orden en el código** | **Inmediatamente después** del `logFn` de acciones aplicadas y **antes** de la rama `hasAdvisories` — las dos líneas derivadas de `r` (execute) quedan juntas; la de advisories deriva de `report` (scan). Es el orden que D-07 enuncia literalmente. |
| **Singular / plural** | **Sin ramificación.** `acción(es) fallida(s)` con el paréntesis, exactamente como el hermano `acción(es) aplicadas`. Con `failed === 1` se renderiza `1 acción(es) fallida(s) (fail-open)`. Coherencia > gramática, porque es la convención ya establecida en el fichero. |
| **Estilo** | **Texto plano.** Sin `picocolors`, sin ANSI, sin emoji, sin `src/logger.js` (LOG-12). Es un carril automático de 0 tokens con `noopLogger`. |
| **Efecto lateral** | **Ninguno.** No re-entra a `reasons`, no toca el gate `needsOrchestrator` (D-04 de Phase 80), no altera el exit code, no bloquea el check ni el launch. |

> **Por qué el anclaje se declara explícitamente:** Phase 84 perdió tiempo con un assert anclado (`/^Error: filesystem error: /`) que se rompió por un desajuste de prefijo entre UI-SPEC y RESEARCH. Aquí el literal y su anclaje quedan fijados en el mismo documento que el planner y el ejecutor leen.

### Familia completa de líneas del piggyback (3 existentes + 1 nueva)

| # | Literal | Canal | Condición | Estado |
|---|---------|-------|-----------|--------|
| 1 | `[kodo:check] Sidebar: ${applied} acción(es) aplicadas` | `logFn` → stdout | siempre que el piggyback corre | **existente — no se toca** |
| 2 | **`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`** | **`errorFn` → stderr** | **`(r.errors \|\| []).length > 0`** | **NUEVA** |
| 3 | `[kodo:check] Sidebar advisories: ${report.missing_group.length} (acción de operador)` | `logFn` → stdout | `report && report.hasAdvisories` | **existente — no se toca** |
| 4 | `[kodo:check] Sidebar doctor error: ${err.message}` | `errorFn` → stderr | `catch` del piggyback | **existente — no se toca** |

**Los tres números son distintos por diseño** en el escenario de test de D-08 (`applied = 3`, `failed = 2`, `advisories = 1`): ningún falso verde por coincidencia numérica.

### Advertencia de contrato para el test

**El orden RELATIVO entre canales NO es contractual.** stdout y stderr son streams independientes; su interleaving en un pipe no está garantizado. El test de D-08 captura `logFn` y `errorFn` en **arrays separados** y debe aseverar pertenencia dentro de cada array — **nunca** una secuencia mezclada de las cuatro líneas. Un assert de orden cross-canal sería flaky por construcción.

---

## Spacing Scale

**N/A — el medio no tiene escala de espaciado.** El TUI se renderiza sobre la rejilla de caracteres del terminal; los anchos son enteros de columna fijados desde Phase 75 en `COLS` (`src/cli/dashboard/SessionTable.js:99`: `gutter: 2, state: 18, task_ref: 10, repo: 18, phasemode: 11, status: 18, prog: 7, task: 12, age: 7, next: 40`). **Esta fase no modifica ni un valor de `COLS`**, ni añade `<Box>`, ni cambia márgenes. Las líneas de S-2 son texto de una línea sin indentación.

Excepciones: ninguna.

---

## Typography

**N/A — el proyecto no controla la tipografía.** La fuente, su tamaño y su interlineado los fija el emulador de terminal del operador. No hay `font-size`, `font-weight` ni `line-height` que declarar ni que cumplir.

El único eje de énfasis disponible en el TUI son los atributos de ink (`bold`, `dimColor`), y **esta fase no cambia ninguno**: la cabecera `next` sigue con `dimColor` y la celda sigue con `bold` solo en la fila seleccionada. Las líneas de S-2 son texto plano sin ningún atributo.

---

## Color

**N/A — esta fase no introduce, cambia ni retira un solo color.**

Para el checker, el estado vigente (no modificado aquí):

| Rol | Realidad en este proyecto |
|-----|---------------------------|
| Superficie / fondo | La del terminal del operador — no la fija el proyecto |
| Atenuado | `dimColor` de ink (cabeceras de columna, incluida `next`) |
| Énfasis | `bold` de ink (fila seleccionada) |
| Celda `next` | **Sin color propio, deliberadamente** — color-isolation D-12 de Phase 75: el color queda reservado, no se pinta acento en esta celda |
| Líneas de `kodo check` | **Texto plano, sin ANSI** |

**Restricción vinculante:** `picocolors` **NO** puede aparecer bajo `src/cli/dashboard/**` — el import que D-04 añade (`./format.js`, módulo puro cuyo único import es `node:path`) no lo introduce, y el guard §TUI-04 de `test/format-isolation.test.js` lo custodia por fichero. La línea nueva de `src/check.js` **tampoco** se colorea, pese a que `check.js` sí tiene `picocolors` alcanzable vía `src/cli/format.js`: las 3 líneas hermanas son planas y la nueva las iguala.

---

## Copywriting Contract

Toda la copy de usuario de esta fase es **español, texto plano, sin emoji**, con el prefijo `[kodo:*]` que exige `.planning/codebase/CONVENTIONS.md`.

| Elemento | Copy | Canal |
|----------|------|-------|
| **CTA primaria** | **N/A** — fase sin acción de usuario. `kodo check` es un carril automático (hook, 0 tokens); no hay botón, prompt ni confirmación. |
| **Estado vacío (S-1)** | **Ausencia total de la columna `next`.** Cuando ninguna sesión tiene un `next` que colapse a no vacío, la columna **se omite** — cabecera incluida — e ink recupera el ancho vía flex. **Sin placeholder, sin cabecera huérfana, sin celda vacía.** |
| **Estado vacío (celda individual)** | `''` — cadena vacía sin placeholder (SC5, degradación limpia de Phase 75). **No se toca.** |
| **Estado de error (S-2)** | `[kodo:check] Sidebar: {N} acción(es) fallida(s) (fail-open)` → **stderr**. Problema: N acciones del doctor del sidebar no se aplicaron. Camino de salida: el sufijo `(fail-open)` le dice al operador que el check y el launch **siguieron adelante** — no hay nada bloqueado; la causa típica es cmux caído y se resuelve reintentando el check. |
| **Error preexistente (no se toca)** | `[kodo:check] Sidebar doctor error: {err.message}` → stderr |
| **Acciones destructivas** | **Ninguna.** La fase no borra ni sobrescribe dato de usuario. Las ediciones son a comentarios JSDoc, un predicado booleano, tests y 6 `VALIDATION.md` archivados. **Cero diálogos de confirmación.** |
| **Keybindings** | **Ninguna tecla nueva** (D-24 de Phase 84, LOCKED). El dashboard no gana ni pierde un solo atajo. |

**Registro de la copy:** la línea nueva se ciñe al registro de sus tres hermanas — prefijo, sustantivo `Sidebar`, dos puntos, conteo, sustantivo con `(es)`/`(s)` parentético. Nada de mayúsculas de énfasis, nada de exclamaciones, nada de sugerir una acción que el operador no pueda ejecutar.

---

## UI Considerations

Applicable state considerations resolved: **5 covered, 0 backstop, 0 unresolved** (2 categorías N/A por el medio).

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | columna `next` (S-1) | ✅ covered | Un `next` de solo whitespace (`'   '`, `'\n\t'`, `' \r\n '`) hace que `deriveAnyNext` devuelva `false` y la columna se omita por completo. Test RED **antes** del fix, en el bloque LIVE-05 de `test/dashboard-select.test.js:471` (D-06). |
| populated | columna `next` (S-1) | ✅ covered | Los 8 asserts LIVE-05 existentes (`test/dashboard-select.test.js:473-497`) siguen verdes **sin tocarlos**; si alguno cambia, la delegación está mal hecha (D-06). |
| zero-one-many | línea de fallos (S-2) | ✅ covered | `failed === 0` ⇒ **no se emite ninguna línea** por `errorFn`; `failed >= 1` ⇒ exactamente **una** línea con el conteo. La rama de silencio necesita su assert propio: los casos A/D de `test/check.test.js` pasan `errorFn: () => {}` y descartan el output, así que hoy nadie asevera que con `errors: []` no salga nada. |
| error | línea de fallos (S-2) | ✅ covered | La línea sale por **`errorFn`** y **no** por `logFn`. El test de D-08 asevera ambas mitades: pertenencia en `errs[]` **y** ausencia de `fallida` en `logs[]` — sin la segunda, una regresión de canal pasaría en verde. |
| overflow / long-text | celda `next` | ✅ covered | Ya resuelto y **no modificado**: `nextCell` colapsa `/\s+/g` + `trim` (DEBT-03) y `SessionTable` trunca a `COLS.next = 40` con `truncate: true` (`:1112`). Esta fase no ensancha ni estrecha ese contrato. |
| loading | — | N/A | No hay estado de carga: `deriveAnyNext` es una función pura síncrona y el piggyback de `check` es un carril batch sin render intermedio. |
| partial | — | N/A | Ninguna de las dos superficies tiene estado parcial: S-1 es un booleano, S-2 es una línea que sale o no sale. |

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| *(ninguno)* | — | **N/A** |

**Sin registries.** No hay shadcn (`components.json` ausente y categóricamente inaplicable a un TUI de ink), no hay bloques de terceros y **no se instala nada**: el constraint **cero deps npm nuevas** está LOCKED en `85-CONTEXT.md`, y `85-RESEARCH.md` §Package Legitimacy Audit lo confirma con veredicto vacío (0 paquetes evaluados, 0 SLOP, 0 SUS). El planner **no debe** insertar ningún `checkpoint:human-verify` de instalación.

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — literal S-2 anclado + estado vacío de S-1 + N/A justificados (sin CTA, sin destructivas)
- [ ] Dimension 2 Visuals: PASS — ningún componente, pantalla ni layout nuevo; el delta es la presencia de una columna existente
- [ ] Dimension 3 Color: PASS — N/A justificado; color-isolation preservada por construcción (import de módulo puro) y custodiada por §TUI-04
- [ ] Dimension 4 Typography: PASS — N/A justificado; el proyecto no controla la fuente del terminal
- [ ] Dimension 5 Spacing: PASS — N/A justificado; `COLS` intacto, cero `<Box>` nuevos
- [ ] Dimension 6 Registry Safety: PASS — sin registries, cero deps npm nuevas (constraint LOCKED)

**Approval:** pending

---

*Phase: 85 — Saneo de deuda + Nyquist retroactivo*
*UI-SPEC: 2026-07-27 · Fuentes: `85-CONTEXT.md` (D-04/D-05/D-06/D-07/D-08), `85-RESEARCH.md` (§Sonda 2, §Sonda 3), código a HEAD*
