# Phase 84: Superficies de captura — skill, sync, conteo ambient - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-26
**Phase:** 84-superficies-de-captura-skill-sync-conteo-ambient
**Areas discussed:** Registro multi-skill de `skill sync` · Naming del fichero de entrada · Contrato `--json` agregado · Naturaleza y derivación de `/kodo-capture` · Verificabilidad de la byte-identidad · Fuente del conteo ambient · Cadencia y ubicación del conteo
**Mode:** `--auto` — sin `AskUserQuestion`; en cada pregunta se seleccionó la opción recomendada. Este log conserva las alternativas descartadas y por qué.

---

## Área A1 — Registro de skills distribuibles

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Allowlist explícita en código | Constante `KODO_SKILLS = ['kodo-orchestrate','kodo-capture']`; añadir una skill al carril de distribución es un acto revisable | ✓ |
| Glob de `.claude/skills/*` | Descubrimiento por directorio; cero mantenimiento del registro | |
| Config en `~/.kodo/config.json` | Registro configurable por operador | |

**Selección:** Allowlist explícita (D-01).
**Notas:** decisiva la evidencia del scout — `.claude/skills/worktree-cleanup/` YA existe en el repo y no es un producto que kodo distribuya. El glob la publicaría en el `~/.claude/skills/` de todos los operadores en la siguiente sync, en silencio. La opción de config se descartó por añadir superficie de configuración a un problema que tiene exactamente dos elementos conocidos.

---

## Área A2 — Nombre del fichero de entrada de una skill

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Gate case-tolerant (`SKILL.md` \|\| `skill.md`), `kodo-capture` en `SKILL.md`, sin renombrar `kodo-orchestrate` | Cierra la trampa de portabilidad sin mover paths de distribución | ✓ |
| Renombrar `kodo-orchestrate/skill.md` → `SKILL.md` y unificar | Convención limpia de una vez | |
| Dejar `skill.md` hardcodeado y escribir `kodo-capture` en minúsculas | Cambio cero | |

**Selección:** gate tolerante + `SKILL.md` para la skill nueva (D-07, D-08).
**Notas:** `syncSkill:67` codifica `'skill.md'`. En macOS el filesystem es case-insensitive y la discrepancia con `worktree-cleanup/SKILL.md` es invisible; en Linux sería fallo duro. El rename se descartó **en esta fase** porque cambia el path de distribución y deja un huérfano en el home de cada operador salvo `--prune` → diferido con su trigger.

---

## Área A3 — Contrato `--json` con N skills

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Aditivo: mantener `status`/`files_changed` como agregado + array `skills[]` | Nadie que lea las claves actuales se rompe | ✓ |
| Array puro de resultados por skill | Más limpio conceptualmente | |

**Selección:** aditivo (D-04).
**Notas:** el consumidor que solo quiere «¿hubo drift?» sigue leyendo `.status`. Romper el contrato por estética no compra nada. Agregación: `error` > `ok` > `noop`; `files_changed` suma.

**Decisión asociada (D-03):** ante el fallo de una skill, el bucle **no** aborta — las demás se sincronizan igual y el exit code agrega a 1. Una skill rota no puede secuestrar la distribución de la otra. El gate de exit 2 sigue anclado solo a `kodo-orchestrate` (D-02), que es el marcador de identidad del repo.

**Decisión asociada (D-06):** `syncSkill` no cambia de firma. La generalización vive entera en el handler → los tests de `src/skill/sync.js` quedan intactos.

---

## Área B1 — Qué es `/kodo-capture` y cuánto deriva

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Skill que solo shellea `kodo capture --origin skill -- "<texto>"`, sin derivar nada | El tag sale del cwd vía `deriveTag`, que ya existe y ya está probada | ✓ |
| Skill que deriva proyecto/tarea del contexto de sesión y los pasa por flags | Cumple CAPT-02 «deriva … del contexto de sesión» de forma literal | |
| Slash command en vez de skill | Más ligero | |

**Selección:** shell puro sin derivación (D-09..D-13).
**Notas:** la derivación en el prompt sería **un LLM decidiendo el tag** — una segunda fuente de verdad no determinista, justo lo que la byte-identidad prohíbe. El «derivar del contexto de sesión» se satisface por herencia del cwd. Slash command descartado: CAPT-05 exige que `kodo skill sync` la distribuya, y el mecanismo distribuye directorios de skill.
Se fijó además el **orden de argumentos**: flags antes del `--` (`--origin skill -- "<texto>"`), porque tras el `--` commander leería `--origin` como texto; el `--` es obligatorio por WR-05 de `83-05` (texto que empieza por guion).
**Descartado — campo de tarea en la línea:** no existe slot en el formato congelado; abrirlo rompe golden, parser y el reader de CAPT-07 (D-13, diferido).

---

## Área B2 — Cómo se verifica la byte-identidad de un fichero markdown

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Golden que **extrae del `SKILL.md`** la invocación canónica y la ejecuta, comparando la línea byte a byte contra el golden de Phase 83 | La cadena de comando del markdown pasa a ser un artefacto testeado | ✓ |
| Documentar el invariante en el `SKILL.md` y confiar en la revisión | Coste cero | |
| Test end-to-end con una sesión LLM real | Verificación «de verdad» | |

**Selección:** extracción + ejecución del comando canónico (D-14).
**Notas:** un `SKILL.md` es un prompt, no código: no se puede unit-testear ejecutando un LLM (ni de forma determinista ni barata). Lo que sí se blinda es **la cadena que la skill le dice al modelo que ejecute**. Corolario adoptado: el test falla también si aparece más de una invocación de `kodo capture` en el fichero — dos comandos serían dos caminos, y la ambigüedad es exactamente lo que el invariante de un solo writer cierra. Sin este mecanismo, el criterio de éxito 1 («verificado con golden test skill-path↔CLI-path») quedaría sin cumplir literalmente.

---

## Área C1 — Fuente del conteo

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Leaf propio con regex constante sobre el checkbox, solo builtins + test anti-drift contra `listCaptures` | Aísla el TUI y ancla los dos lectores con un test | ✓ |
| Importar `listCaptures` de `src/inbox/store.js` | Cero duplicación del formato | |
| Nuevo endpoint `GET /inbox` en el server | Una sola fuente de verdad servida | |

**Selección:** leaf propio + test anti-drift (D-17 + D-18, indivisibles).
**Notas:** el endpoint estaba prohibido de entrada (invariante cero endpoints nuevos, criterio 3 literal de CAPT-07). La opción «importar el store» parecía la obvia y se descartó por evidencia del scout: `src/inbox/store.js:46` importa `../cli/format.js`, **que importa picocolors** — un leaf del dashboard que importe el store mete el paquete de color en el grafo del TUI, y `test/format-isolation.test.js:209-218` no lo detectaría porque comprueba imports **directos**, no transitivos. El invariante se erosionaría en silencio. Arrastraría además `withFileLock` y `resolveProjectId` a un módulo que solo cuenta líneas.
Contrapartida obligatoria: sin el test anti-drift, D-17 cambiaría un riesgo de acoplamiento por uno de deriva silenciosa. Se adopta la pareja, no la mitad.

---

## Área C2 — Cadencia, ubicación y comportamiento del conteo

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Piggyback en el tick de `usePoll`, cabecera de `SessionTable`, oculto en 0 | Cero timers nuevos, zona de estado ambient ya establecida | ✓ |
| Timer propio para el fichero | Cadencia independiente del server | |
| En el keybar del pie | Siempre visible | |
| Siempre visible incluso en 0 | Consistencia de layout | |

**Selección:** piggyback + cabecera + oculto en 0 (D-21, D-22, D-23).
**Notas:** el timer propio se descartó por añadir un segundo scheduler a un TUI que ya tiene uno con single-flight y backoff cuidadosamente probados. El keybar ya lleva 12 teclas y es la zona de **acciones**, no de estado. El ocultado en 0 sigue el precedente estructural de `anyGsd`/`anyProgress`/`anyNext`: un `0 sin enrutar` permanente enseña al ojo a ignorar la zona, que es lo contrario de la presión ambient que el requisito busca.
**Decisiones asociadas:** se cuentan solo las abiertas — una descartada ya fue triada (D-16); fichero ausente/ilegible → 0 sin banner (D-20); cero teclas nuevas (D-24, diferido).

---

## Claude's Discretion

Nombre/ubicación de la constante del registro · orden de las skills · copy exacta del render por skill y del conteo · color del conteo dentro de la paleta del TUI · marcador del bloque cercado que el golden extrae · redacción del prompt de `kodo-capture` salvo la invocación canónica · nombre del fichero del leaf y sus exports · N y forma de los fixtures del test anti-drift · secuencialidad del bucle de sync.

## Deferred Ideas

- Renombrar `kodo-orchestrate/skill.md` → `SKILL.md` (huérfano en el home sin `--prune`).
- Tecla del dashboard para abrir/triar el inbox.
- Vincular una captura a una tarea (`task_ref` en la línea) — exige abrir el formato congelado.
- CAPT-F1 (filtros de `kodo inbox`) y CAPT-F2 (archival/rotación) — v2.
- Barrido del drenaje de stdout a los comandos no-inbox (deuda de `83-05`) — el payload de `skill sync` con `skills[]` sigue muy por debajo del umbral, no lo justifica.
- R-82-01 y el RMW UTF-8 de `83/deferred-items.md` — ajenos por construcción.
