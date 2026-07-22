# Phase 74: Handoff acumulativo al cierre - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-15
**Phase:** 74-handoff-acumulativo-al-cierre
**Areas discussed:** Contrato del bloque de handoff, Detección de autoría y backstop mecánico, Ubicación del `NEXT:` en `state.json`, Punto de escritura y concurrencia, Cobertura de ramas e instrucción al LLM
**Mode:** `--auto` — todas las áreas auto-seleccionadas; en cada pregunta se eligió la opción recomendada sin prompt interactivo. Pase único (cap `workflow.max_discuss_passes = 3`, consumido 1).

---

## Contrato del bloque de handoff

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Heading + marcador HTML por sesión | `## Handoff <fecha> <!-- kodo:handoff v=1 session=… author=llm at=… -->`. Invisible al renderizar, parseable, scoped por sesión | ✓ |
| Heading pelado + parsing por líneas | `## Handoff <fecha>` y buscar `NEXT:` por texto. Más simple, pero sin saber de qué sesión es cada bloque | |
| Frontmatter YAML acumulado | Metadatos estructurados arriba del fichero. Choca con la semántica de acumulación (LIVE-02) | |

**Elección auto:** Heading + marcador HTML por sesión (recomendada) → D-01, D-02.
**Notas:** El marcador es lo que hace posible LIVE-03 sin falsos positivos (ver área siguiente) y no ensucia el render de LIVE-06. `v=1` deja la puerta abierta a evolucionar el formato sin romper ficheros existentes. `NEXT:` se trunca a 200 caracteres al persistir para no engordar `state.json` ni reventar la celda de tabla de la Phase 75.

---

## Detección de autoría y backstop mecánico

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Marcador scoped por `session_id` | Buscar `kodo:handoff` con `session=<esta sesión>`; ausente → append mecánico | ✓ |
| Contar bloques `## Handoff` antes/después | Si no creció el conteo, el LLM no escribió | |
| Comparar `mtime` del fichero | Si no se tocó durante la sesión, el LLM no escribió | |

**Elección auto:** Marcador scoped por `session_id` (recomendada) → D-04, D-03.
**Notas:** Las dos alternativas se rompen precisamente con la acumulación que exige LIVE-02: en la segunda sesión de una tarea, el bloque de la primera ya está en el fichero, así que un conteo o un mtime concluyen en falso que «ya hay handoff» y LIVE-03 nunca dispararía. El bloque mecánico se distingue **visualmente** (`— automático` en el heading), no solo por el marcador, porque el marcador es invisible al renderizar. `input.reason` se valida contra su enum cerrado antes de interpolarlo en markdown.

---

## Ubicación del puntero + `NEXT:` en `state.json`

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Top-level `state.tasks[task_id]` | `{plan_path, next, updated_at}`, aditivo, sin bump de schema. Sobrevive a `removeSession` | ✓ |
| Campos en el registro de sesión | `session.plan_path` / `session.next` escritos antes del cleanup | |
| Solo en la entrada de `history` | Aprovechar que `removeSession` archiva `{...removed}` | |

**Elección auto:** Top-level `state.tasks[task_id]` (recomendada) → D-05, D-06.
**Notas:** Hallazgo del scout que decide el área: `performTerminalCleanup` → `removeSession` **archiva la sesión a `history` (cap FIFO 50) y borra la fila de `state.sessions`**. Un `NEXT:` guardado en el registro de sesión desaparecería de la lista al cerrar y sería desalojable a los 50 cierres. El dato es de la **tarea**, no de la sesión: su valor entero está en sobrevivir a la sesión que lo produjo para que la siguiente lo encuentre. Precedente de aditivo sin bump: `history` (Phase 30) y `worktree_path` (Phase 18 D-03c).

---

## Punto de escritura y concurrencia

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Tras los guards, ANTES de `runReviewBackstop` | Disco primero; si el backstop se atasca en red, el handoff ya aterrizó | ✓ |
| Entre el backstop y el cleanup terminal | Respeta el bloque autónomo del backstop tal cual está hoy | |
| Justo antes de `performTerminalCleanup` | Lo más tarde posible sin entrar en lo destructivo | |

**Elección auto:** Tras los guards, antes del backstop (recomendada) → D-07, D-08.
**Notas:** Ninguna de las tres viola el orden LOCKED `backstop → setColor → notify` (D-08 de v0.16) — insertar antes del trío no lo reordena. Se elige la primera porque el handoff es una escritura a disco barata y sin red, y es el dato más valioso de la fase. Concurrencia: el read-modify-write del plan va bajo `withFileLock` reutilizando la primitiva de `state-lock.js` (import, cero deps nuevas); un `temp+rename` solo no evita el *lost update* de dos cierres simultáneos de la misma tarea — que perdería justo el bloque que este milestone construye.

---

## Cobertura de ramas e instrucción al LLM

| Opción | Descripción | Elegida |
|--------|-------------|---------|
| Invertir `:85` y `:145` + create-if-missing | Las dos ramas productoras arregladas; el hook crea el plan si no existe (GSD full/bootstrap) | ✓ |
| Invertir solo `:85` | Ceñirse a la línea que nombra LIVE-02 | |
| Append-only si el fichero existe | Sin create-if-missing; las sesiones GSD sin plan ligero no ganan handoff | |

**Elección auto:** Invertir ambas + create-if-missing (recomendada) → D-09, D-10, D-11.
**Notas:** El scout encontró que **hay dos** instrucciones «sobrescribe si ya existe»: `session-start.js:85` (no-GSD, ES) y `:145` (GSD quick, EN). Es el mismo bug; LIVE-02 solo nombra la 85 porque es donde se detectó. Las ramas GSD full/bootstrap no emiten instrucción de plan, así que sin create-if-missing no tendrían fichero al que appendear — y el invariante de STATE.md dice literalmente «el handoff se escribe en disco para TODA sesión» (D-02 prohíbe *pintarlo* en el overlay GSD, no escribirlo). Coste conocido y contabilizado: tocar `:85`/`:145` rompe los golden bytes de HOOK-02, que hasta ahora se satisfacían por construcción appendeando al final. No es regresión — es el cambio que pide LIVE-02 — pero debe ser tarea explícita del plan, no un test roto descubierto a media ejecución.

---

## Claude's Discretion

- Nombre y ubicación exactos del módulo del contrato (D-13, p. ej. `src/session/handoff.js`) y de sus funciones puras.
- Estructura de los tests (fixtures de plan, aislamiento de `HOME` siguiendo `kodoPlansDir`/`homedirFn` de `plan.js`).
- Formato interno de `Hecho`/`Pendiente` (bullets vs prosa), más allá de que `NEXT:` sea una única línea.
- Si `plan_path` se persiste absoluto o derivado.

## Deferred Ideas

- **Poda/cap de handoffs antiguos** — v0.18 con datos reales de crecimiento (ya en Out of Scope de REQUIREMENTS.md).
- **Surface del handoff en el overlay de filas GSD** — rompería D-02 (LOCKED desde v0.11).
- **Handoff en sesiones muertas por SIGKILL/crash** — límite estructural aceptado (sin hook, no hay handoff).
- **Migración/backfill de planes existentes** al nuevo formato — no hace falta: el appendeo funciona sobre markdown plano y `v=1` permite evolucionar sin romper ficheros viejos.
