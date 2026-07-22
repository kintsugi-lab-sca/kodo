---
phase: 74-handoff-acumulativo-al-cierre
plan: 03
subsystem: hooks
tags: [session-start, prompt, handoff, LIVE-02, D-10]
requires:
  - "src/session/handoff.js (Plan 01) — el contrato de formato D-01 que esta instrucción describe al LLM"
provides:
  - "Instrucción ES (buildSessionContext) preservar-y-appendear + contrato de handoff con session_id resuelto"
  - "Instrucción EN quick (buildGsdContext) preservar-y-appendear + contrato de handoff con session_id resuelto"
affects:
  - "Plan 04 (writeHandoff): el bloque mecánico solo se appendea si el LLM NO escribió el suyo — esta instrucción es la mitad optimista del par"
  - "Phase 75: los bloques que el LLM escriba siguiendo este formato son los que parseará"
tech-stack:
  added: []
  patterns:
    - "LLM + backstop mecánico (precedente v0.16 Phase 71 D-10..D-14)"
    - "Instrucción por rama en el idioma de la rama; contrato de formato en un solo idioma (ES)"
key-files:
  created: []
  modified:
    - src/hooks/session-start.js
    - test/session-start.test.js
    - test/gsd-context.test.js
decisions:
  - "El contrato de formato NO alterna idioma con la instrucción: **Hecho:**/**Pendiente:**/**NEXT:** van en español en ambas ramas porque el parser de D-02 y el bloque mecánico de D-03 son español"
  - "session-start.js NO importa src/session/handoff.js: la instrucción es un prompt (texto para el LLM), no una construcción de bloque — importar arrastraría el módulo hoja a un consumidor que no lo ejecuta"
  - "El guard de emojis EN preexistente no cubría la instrucción quick (corta desde '## No automatic push', que va DESPUÉS) — el caso nuevo corta desde la instrucción de plan"
metrics:
  duration: 12m
  completed: 2026-07-15
status: complete
---

# Phase 74 Plan 03: Invertir las instrucciones de plan a preservar-y-appendear Summary

Las dos ramas productoras de `session-start.js` dejan de ordenar «sobrescribe si ya existe» y pasan a preservar-y-appendear, entregando además el formato exacto del bloque de handoff de D-01 con el `session_id` ya resuelto.

## Qué se hizo

**Task 1 — `src/hooks/session-start.js`** (commit `295ebeb`)

Las dos instrucciones invertidas, conservando ambos prefijos literales:

| Rama | Función | Idioma | Antes | Ahora |
|------|---------|--------|-------|-------|
| no-GSD | `buildSessionContext` | ES | `(sobrescribe si ya existe)` | «Si el fichero ya existe, NO lo sobrescribas: añade tu plan al final…» |
| GSD quick | `buildGsdContext` (dentro del `if (mode === 'quick')`) | EN | `(overwrite if it exists)` | «If the file already exists, do NOT overwrite it: append your plan at the end…» |

Ambas ganan a continuación la instrucción de handoff con el formato de D-01:

```markdown
## Handoff <fecha-hora local YYYY-MM-DD HH:MM> <!-- kodo:handoff v=1 session=sess-abc author=llm at=<timestamp ISO-8601 UTC> -->

**Hecho:** …
**Pendiente:** …
**NEXT:** …
```

El `session_id` va **interpolado y resuelto** (`session.session_id`), no templated — es lo que permite a `findSessionBlock` (Plan 01, D-04) reconocer el bloque como de esta sesión. Si el LLM escribiera un placeholder, la detección de autoría fallaría y el Plan 04 appendearía un bloque mecánico duplicado.

Comentarios obsoletos actualizados: la justificación «D-06 escribir al empezar (re-dispatch sobrescribe, latest-wins)» de Phase 45 queda muerta con D-10 y se sustituye por la razón nueva (D-10 + LIVE-02: el historial de la tarea es el dato; D-01: el formato del bloque).

Ramas GSD **full** y **bootstrap** sin tocar, por diseño (D-10) — las cubre el backstop mecánico de D-03 y esas sesiones ya tienen continuidad propia vía GSD. Verificado: `git diff | grep -c 'gsd-plan-phase\|gsd-new-project'` == 0.

**Task 2 — cobertura** (commit `82f7a04`)

11 casos nuevos, 110 inserciones, **cero deleciones** — ningún caso preexistente modificado:

- ES + EN: la semántica de sobrescritura desapareció del **string construido** (no del source — importa lo que recibe el LLM).
- ES + EN: se ordena explícitamente no sobrescribir y añadir al final.
- ES + EN: el marcador lleva el `session_id` de la sesión inyectada (`sess-abc`), no un placeholder.
- ES + EN: las tres etiquetas del formato.
- EN: exclusión **phase** y **bootstrap** de la instrucción de handoff (D-10).
- EN: guard de emojis/ANSI sobre la cola quick.

## Decisiones tomadas

**Las etiquetas del formato no alternan idioma.** La instrucción EN dice «what you completed in this session», pero la etiqueta sigue siendo `**Hecho:**`. Lo que alterna por rama es la instrucción (D-08 Phase 45), no el contrato: `extractNext` busca `**NEXT:**` y `buildHandoffBlock` escribe español. Un `**Done:**` en la rama EN produciría bloques que el parser de la Phase 75 no vería.

**`session-start.js` no importa `src/session/handoff.js`.** El módulo del contrato (D-13) es una hoja de cero imports blindada por `test/check-isolation.test.js`, y aquí no se construye ningún bloque: se describe el formato en un prompt. Reutilizar el módulo obligaría a exportar constantes de formato para interpolarlas en texto, acoplando el prompt al writer sin ganar nada verificable. El acoplamiento real (que el formato descrito coincida con el que parsea D-04) queda cubierto por el assert del marcador literal `<!-- kodo:handoff v=1 session=sess-abc author=llm at=`.

**El guard de emojis EN preexistente no cubría la instrucción quick.** `gsd-context.test.js:189` corta desde `lastIndexOf('## No automatic push')`, que en la rama quick va **después** de la instrucción de plan (el bloque común vive fuera del `if/else`). El slice, por tanto, nunca la incluyó. El caso nuevo corta desde `'Also, at the start write a short plan'` hasta el final, con un assert de sanidad (`tail.includes('kodo:handoff')`) que garantiza que la región cubierta es la correcta. En ES sí estaba cubierta de entrada: el guard corta desde `## Anti-push-fantasma` hasta el final del string.

## Deviations from Plan

None — el plan se ejecutó tal como estaba escrito.

Nota sobre D-11: el plan anticipaba que la premisa original («tocar `:85`/`:145` rompe golden bytes de HOOK-02») era falsa. **Confirmado empíricamente**: los 58 tests preexistentes de los dos ficheros pasaron sin modificar ni uno solo tras el Task 1. Las asserts reales son de prefijo, ruta resuelta y orden; conservando los prefijos no se rompe nada.

## Verificación

| Criterio | Resultado |
|----------|-----------|
| `node --test test/session-start.test.js test/gsd-context.test.js` | 69/69 pass (58 preexistentes + 11 nuevos) |
| `npm test` | 2096 tests, 2093 pass, 1 skip — cero regresiones |
| `grep -c "Además, al empezar escribe un plan corto"` | 1 (prefijo ES conservado) |
| `grep -c "Also, at the start write a short plan"` | 1 (prefijo EN conservado) |
| `grep -c 'kodo:handoff v=1 session='` | 2 (una por rama productora) |
| `grep -c 'session.session_id'` | 6 (>= 3: el `:108` preexistente + las dos interpolaciones nuevas + logger) |
| `git diff --stat package.json package-lock.json` | vacío — cero dependencias npm (T-74-SC) |
| Teeth de los casos nuevos | Con Task 1 revertido: **9 de 11 fallan**. Los 2 que pasan son las exclusiones phase/bootstrap — correcto: vigilan lo que **no** debe cambiar (D-10), así que pasan en ambos sentidos por diseño |
| `git diff` de tests | 110 inserciones, **0 deleciones** — puramente aditivo |

## Known Stubs

Ninguno.

## Threat Flags

Ninguno. El plan no introduce superficie nueva: no hay endpoint, ni ruta, ni ejecución. La ruta del plan se sigue resolviendo con `join(KODO_DIR, 'plans', ...)` y nunca se emite templated (T-74-11 mitigado, asserted por `gsd-context.test.js:212-217` y por el caso ES `PLAN-03 sin literal`). Cero paquetes instalados (T-74-SC).

## Issues encontrados (fuera de alcance, no arreglados)

`test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» falló en 1 de 3 runs completos de `npm test` (los otros 2 runs: `# fail 0`). Es el flaky preexistente ya registrado en `deferred-items.md` por el Plan 74-01 y en STATE.md §Deferred Items. **No se tocó**: un arreglo a ciegas podría enmascarar una carrera real del lock de la que depende el invariante de v0.16 Phase 70.

## Para el Plan 04

`writeHandoff` es la otra mitad del par LLM+backstop que este plan abre. Contrato que hereda:

- El LLM recibe el formato con `author=llm`; el bloque mecánico escribe `author=auto` + sufijo ` — automático` en el heading (D-03, ya implementado en `buildHandoffBlock`).
- La detección va por `hasSessionHandoff(md, session.session_id)` (D-04) — nunca por conteo de bloques.
- Las ramas GSD **full** y **bootstrap** no reciben instrucción: para ellas el backstop mecánico es la única fuente de handoff, y D-09 (create-if-missing) es lo que garantiza que exista fichero al que appendear.

## Self-Check: PASSED

- `src/hooks/session-start.js` — FOUND (modificado)
- `test/session-start.test.js` — FOUND (modificado)
- `test/gsd-context.test.js` — FOUND (modificado)
- Commit `295ebeb` — FOUND
- Commit `82f7a04` — FOUND
