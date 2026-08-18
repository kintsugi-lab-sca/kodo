# Phase 87: Aislamiento de color transitivo en el TUI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-05
**Phase:** 87-Aislamiento de color transitivo en el TUI
**Mode:** `--auto` — todas las gray areas auto-seleccionadas; en cada pregunta se eligió la opción recomendada. Cero `AskUserQuestion`.
**Areas discussed:** Forma del cierre de los leaks · Arquitectura del guard transitivo · Cobertura de `import()` dinámico · Forma de congelar la pureza de `dashboard/format.js` · Mordida y disciplina DEBT-04

`[--auto] Selected all gray areas: cierre-leaks, arquitectura-guard, cobertura-dinamica, pureza-format, mordida.`

---

## Forma del cierre de los leaks (ISO-02)

| Opción | Descripción | Seleccionada |
|--------|-------------|--------------|
| Extraer los saneadores puros a un módulo hoja nuevo, sin shim | `stripControlChars` + `stripForKeystroke` salen de `format.js` a un módulo de cero imports; se actualizan los 5 call sites | ✓ |
| Extraer + dejar re-export shim en `format.js` | Cero call sites que tocar, pero la arista `dashboard → format.js` sigue siendo un camino legítimo disponible | |
| Duplicar `stripControlChars` bajo `src/cli/dashboard/` | Cierra la arista sin tocar a nadie, a costa de dos copias de una regex de seguridad | |
| Mover los saneadores a `src/cli/dashboard/format.js` | Invierte la dependencia: `inbox.js` y `manager.js` (no-TUI) pasarían a importar del dashboard | |

**Elección (auto):** módulo hoja nuevo, sin shim (D-01, D-02).
**Notas:** el precedente del repo son `src/session/handoff.js` y `src/tasks/pending.js` — módulos-contrato de cero imports creados exactamente para que un leaf del dashboard consuma lógica compartida sin arrastrar grafo, y congelados con guard. Duplicar quedó descartado sin discusión: la regex de `stripControlChars` es el saneador anti-inyección de terminal (OSC-52/CSI/C1); dos copias divergen. El shim se descartó porque deja vivo el atajo que la fase quiere eliminar. Medición que decidió el alcance: **5 call sites**, uno de ellos en `test/dashboard-format.test.js`.

---

## Arquitectura del guard transitivo (ISO-01)

| Opción | Descripción | Seleccionada |
|--------|-------------|--------------|
| Walker estático por-fichero + source-grep de dinámicos sobre su salida | Precedente locked de la Phase 85 D-09 (`check-isolation.test.js:192-228`), con su razón escrita | ✓ |
| Convertir `walkImports` en seguidor de aristas dinámicas | Más alcance en un solo mecanismo, a costa de ensanchar la clausura y arriesgar rojos espurios en guards vecinos | |
| Guard sobre un único entry point (`index.js`) | Un solo walk, más barato — pero deja fuera a los ficheros que nadie importa desde `index.js` | |

**Elección (auto):** walker estático por-fichero + source-grep (D-05, D-06).
**Notas:** iterar **todos** los ficheros de `src/cli/dashboard/` como entry point es lo que hace innecesario seguir aristas dinámicas — el leak de `index.js` (dinámico → `App.js`) queda cubierto porque `App.js` es entry por sí mismo. La razón escrita del precedente pesó: *«seguir aristas dinámicas dentro de `walkImports` mete `github/provider.js` y `github/normalize.js` en la clausura y pone ROJOS dos guards vecinos — y la reacción natural a un rojo espurio es debilitarlos»*. Decidido también anclar el assert a `picocolors` (el paquete) y no a `src/cli/format.js` (D-07), y conservar el guard directo actual como aditivo (D-08).

---

## Cobertura de `import()` dinámico (ISO-04)

| Opción | Descripción | Seleccionada |
|--------|-------------|--------------|
| Cubrir specifiers literales + declarar el punto ciego residual con medición fechada | Cubre el 100% de lo que hay hoy (128 casos) y nombra lo que ningún regex resuelve | ✓ |
| Solo declarar honestamente, sin cubrir nada | Cumple la letra de ISO-04 con el mínimo diff, pero deja la cobertura donde está | |
| Parser real (acorn/AST) para el grafo | Cero falsos positivos y negativos, a costa de meter una dependencia en un milestone de saneo puro | |

**Elección (auto):** cubrir literales + declaración honesta (D-11, D-12).
**Notas:** esta área generó la medición más cara del discuss y **dos hallazgos que cambian el plan**:

1. **El `stripComments` del precedente tiene un bug de orden medido.** Borra los bloques `/* … */` antes de filtrar las líneas `//`, así que un comentario de línea con la glob `src/cli/dashboard/**` abre un bloque falso. Sobre `src/` (98 ficheros), **3 pierden el 100% de sus imports estáticos**: `enrich.js` (3→0), `markdown.js` (4→0), `logs/session-lookup.js` (5→0). Dos están en scope y uno es leaker primario → un guard construido sobre ese helper saldría **verde con el leak vivo**. Orden corregido (`//` → bloques → `*`) recupera 3/3. (D-09, D-10.)
2. **Los imports de tipo no son aristas.** Sin excluir las líneas que empiezan por `/*`, se cuelan **11 aristas fantasma** de `@type {import('…')}` de una línea (139 → 128 matches), **9 con specifier relativo** — entre ellas `src/cli/polling.js → '../logger.js'`, que apunta justo al módulo que el guard hermano prohíbe.

Medición de cierre: **0** `import()` con specifier no literal en `src/` a 2026-08-05. Se escribe con fecha, nunca como «el repo no lo usa» — que es literalmente la frase que la fase retira.

El parser AST se descartó por el mismo criterio que rechazó la infra de mutation testing en la Phase 86: milestone de saneo puro, sin feature nueva ni dependencias.

---

## Forma de congelar la pureza de `dashboard/format.js` (ISO-03)

| Opción | Descripción | Seleccionada |
|--------|-------------|--------------|
| Hoja de cero imports relativos + allowlist explícita de builtins, más aserto positivo de convergencia | Copia la redacción de los guards de `handoff.js`/`pending.js` y añade el espejo de ORCH-05 | ✓ |
| Solo «no alcanza `picocolors`» | Ya queda subsumido por el guard endurecido de ISO-01 — no congelaría nada nuevo | |
| Cero imports absolutos, incluidos builtins | Literal al precedente, pero hoy sería rojo: `format.js:25` usa `basename` de `node:path` | |

**Elección (auto):** hoja de cero imports relativos + allowlist + convergencia (D-13, D-14).
**Notas:** medido, la clausura transitiva de `src/cli/dashboard/format.js` es **exactamente 1 fichero (él mismo)**. El aserto positivo de convergencia (que `select.js:35` lo importa de verdad) se añadió porque sin él la premisa que ISO-03 protege se puede regresar en silencio: mover `nextCell` a otro sitio dejaría el guard de pureza verde sobre un módulo que ya no consume nadie.

---

## Mordida y disciplina (ISO-01, DEBT-04)

| Opción | Descripción | Seleccionada |
|--------|-------------|--------------|
| Mordida manual con diff + salida roja citada en SUMMARY/VERIFICATION | Precedente de las Phases 82, 83, 85 y 86 — evidencia citada, cero infra nueva | ✓ |
| Infraestructura de mutation testing | Mordida reproducible en CI, a costa de feature nueva en un milestone de saneo | |

**Elección (auto):** mordida manual registrada (D-15).
**Notas:** se reintroduce el leak de `markdown.js:27` y no el de `App.js:73` — grafo de 3 ficheros frente a 25, así que el mensaje de fallo cabe entero y sirve de evidencia legible. DEBT-04 queda reafirmado como LOCKED (D-16): la única allowlist admitida en toda la fase es `node:path` en D-13, y está justificada por medición.

---

## Claude's Discretion

- Nombre y ubicación del módulo nuevo (`src/cli/sanitize.js`, `src/cli/text.js`, …).
- Formato exacto del mensaje de fallo del guard, con la condición de que imprima la **cadena** de imports, no solo el conjunto.
- Reparto en planes, con la restricción de orden de la mordida (guard-primero, o guard-y-fix juntos con evidencia al final).
- Si `stripComments` y el walker se extraen a un helper compartido o se duplican con su razón escrita — prohibido propagar la versión con el bug.

## Deferred Ideas

- El mismo bug de `stripComments` en `test/check-isolation.test.js:23-29` y `test/dispatcher-isolation.test.js:24-30`. Medido: hoy **no** ciega al guard hermano (0 de los 3 ficheros afectados está en el grafo estático de `check.js`). Trigger: que uno entre en ese grafo, o el próximo toque de esos ficheros.
- Extraer el walker de aislamiento a `test/helpers/import-graph.mjs` para los 3+ guards que lo duplican. Trigger: el cuarto fichero de guard que lo necesite.
- `visibleWidth` se queda en `format.js`. Trigger: primer consumidor bajo `src/cli/dashboard/`.
