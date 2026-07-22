---
phase: 74-handoff-acumulativo-al-cierre
plan: 02
subsystem: session-state
tags: [state, handoff, persistence, additive-schema, locking]
status: complete

requires:
  - withStateLock (src/session/state.js:317) — la primitiva anti-clobber (carga fresca DENTRO del lock)
  - withFileLock (src/session/state-lock.js) — el advisory lock O_EXCL que consume withStateLock
  - noopLogger (src/logger-noop.js) — LOG-12: state.js jamás importa logger.js
provides:
  - upsertTaskHandoff(taskId, entry, logger) — el escritor de state.tasks (LIVE-04)
  - typedef TaskHandoff — {plan_path, next: string|null, updated_at}
  - clave top-level state.tasks — aditiva, opcional, SIN bump de schema_version
affects:
  - Plan 04 (session-end.js) — consumirá upsertTaskHandoff como stateWriterFn
  - Plan 05 (handoff-concurrency) — correrá el escritor bajo carrera real
  - Phase 75 (dashboard) — lee state.tasks[task_id].next; hereda la Open Question de cómo llega a la TUI

tech-stack:
  added: []          # cero dependencias npm nuevas
  patterns:
    - "Mutator espejo de addSession: default noopLogger → withStateLock síncrono → if (!r.ok) warn + return r → telemetría de éxito gated → return r"
    - "Guard defensivo del campo aditivo (if (!state.tasks) state.tasks = {}) — espejo del guard de history en removeSession:361"
    - "Aislamiento de HOME en tests: process.env.HOME antes de un import DINÁMICO de state.js (STATE_PATH se cachea en module-load)"
    - "Semilla v3 explícita en tests — evita la trampa v2 de loadState:257"

key-files:
  created:
    - test/state/handoff-state.test.js    # 14 casos: shape, upsert, aditividad, fail-safe, T-74-08, D-04, supervivencia a la relectura
  modified:
    - src/session/state.js                # upsertTaskHandoff + typedef TaskHandoff + clave tasks? en State
    - test/session/reconcile-lock.test.js # +1 caso de regresión anti-drop (con teeth verificadas por mutación)

decisions:
  - "El criterio de aceptación `git diff | grep -c '^[-+].*schema_version' == 0` del Task 1 es insatisfacible tal y como está escrito: el propio `<action>` ordena incluir la frase literal «NO bump de schema_version» en el comentario del typedef. Se resolvió a favor de la INTENCIÓN (ninguna línea de CÓDIGO toca el schema), verificada con un grep que excluye comentarios → 0."
  - "El caso anti-drop del Task 3 DEBE forzar una transición: con cero cambios reconcile.js:233 devuelve `state` referencialmente y el caso preservaría `tasks` trivialmente — sería vacuo. Se reutiliza la sesión muerta que el fichero ya modela para que corra el rebuild de :238."
  - "Las teeth del caso anti-drop se verificaron por mutación (sustituir el spread por un rebuild explícito → falla), no solo por verde. Un test verde no prueba nada sobre lo que vigila."

metrics:
  duration: 14m
  completed: 2026-07-15
  tasks: 3
  commits: 4
  files: 3
  tests_added: 15        # 14 en la suite nueva + 1 caso de regresión en reconcile-lock
  suite_total: 2085      # 2084 pass · 0 fail · 1 skipped
---

# Phase 74 Plan 02: `upsertTaskHandoff` — el escritor de `state.tasks` Summary

El `NEXT:` ya sobrevive a la sesión que lo produjo: `upsertTaskHandoff` persiste el puntero al plan en la clave top-level aditiva `state.tasks` bajo `withStateLock`, con fail-safe ante lock-timeout y dos suites que vigilan que el dato no muera ni en la migración ni en el tick de reconciliación.

## What Was Built

**`upsertTaskHandoff(taskId, entry, logger = noopLogger)`** (`src/session/state.js`) — espeja verbatim los 5 elementos no negociables de `addSession:331-348`:

1. `logger = noopLogger` como default param (LOG-12 — `state.js` jamás importa `logger.js`).
2. `withStateLock` con mutator **síncrono** que muta en sitio.
3. `if (!r.ok)` → `logger.warn` → **`return r`** — el fail-safe se propaga, jamás lanza (D-06).
4. Telemetría de éxito **gated** tras ese guard (WR-01: nunca reclamar un éxito falso).
5. `return r` final.

Dentro del mutator, el guard defensivo del campo aditivo (`if (!state.tasks) state.tasks = {}`) es el espejo de `if (!Array.isArray(state.history)) state.history = [];` (`:361`). El mutator toca **solo** `state.tasks`.

**Typedef `TaskHandoff` + clave `tasks?` en `State`** — aditiva y opcional, con la frase literal del precedente `worktree_path`: **NO bump de `schema_version`**.

## Why It Matters (la razón dura, verificada)

`performTerminalCleanup` llama a `removeSession`, que archiva la sesión a `history` (cap FIFO 50) y borra la fila de `state.sessions` (`state.js:355-376`). Un `NEXT:` guardado en el registro de sesión **desaparecería de la lista al cerrar** y sería desalojable a los 50 cierres. El dato es de la **tarea**, no de la sesión: su valor entero es sobrevivir a la sesión que lo produjo.

## Key Decisions

| Decisión | Razón |
|---|---|
| `next: entry.next ?? null` | El bloque mecánico de D-03 no trae `NEXT:`; `null` es un valor válido y esperado, no una ausencia |
| `updated_at` generado si falta | El campo nunca falta — la Phase 75 lo pintará sin guards extra |
| Logs con solo `{task_id, reason}` | El `next` es contenido redactado por un LLM; los logs no llevan contenido de usuario (precedente T-71-18, mitiga T-74-08) |
| Los tests siembran v3 explícito | Ver «La trampa que este plan esquivó» abajo |

## La trampa que este plan esquivó (RESEARCH §Pitfall 5)

El fallo silencioso de este plan era real y estaba a un descuido de distancia:

`loadState():257` devuelve la forma **v2** (`{schema_version: 2, sessions: {}}`) cuando el fichero no existe. Un test que no sembrara nada haría que `withStateLock` mutara ese v2, `saveState` escribiera en disco un fichero **v2 con `tasks`**, y el siguiente `loadState` disparara `migrateStateV2toV3`, cuya reconstrucción exhaustiva (`:139-143`) **descarta toda clave desconocida, `tasks` incluida**. El carril es inalcanzable desde el hook real (sin fichero → `findSession` no matchea → `session-end.js:72-75` retorna), pero **totalmente alcanzable desde el test**.

Mitigado en dos capas: semilla `{schema_version: 3, sessions: {}, history: []}` en `beforeEach`/`afterEach`, y un caso explícito que lee los **bytes crudos del disco** y assertea que ya son v3 — la prueba directa de que la migración nunca se dispara en la relectura.

## El test con teeth verificadas (Task 3)

Toda la decisión D-05 se apoya en que `reconcile.js:238` (`{...state, sessions, history}`) reconstruye con spread y por tanto preserva claves top-level desconocidas. Eso estaba verificado **por lectura de código y vigilado por nada**.

Dos sutilezas que el caso tuvo que resolver para no ser decorativo:

1. **Forzar la transición.** Con cero cambios, `reconcile.js:233` devuelve `state` referencialmente — `tasks` se preservaría trivialmente y el caso sería **vacuo**. El caso reutiliza la sesión muerta que el fichero ya modela para que corra el rebuild de `:238`.
2. **Verificar las teeth por mutación.** Se sustituyó temporalmente el spread por `{schema_version, sessions, history}` explícito: el caso **falla** exactamente en la assert de `tasks` (los otros 2 siguen verdes). Revertido después; `reconcile.js` queda byte-idéntico a HEAD.

## Deviations from Plan

### 1. [Criterio de aceptación insatisfacible — resuelto a favor de la intención] Task 1

- **Found during:** Task 1, verificación de acceptance criteria.
- **Issue:** El criterio `git diff src/session/state.js | grep -c '^[-+].*schema_version'` == 0 **contradice el propio `<action>` del mismo task**, que ordena cerrar el comentario del typedef con la frase literal del precedente `worktree_path`: «**NO bump de `schema_version`**». Cumplir la acción hace que el grep dé 1 (matchea el comentario); cumplir el grep literal obliga a omitir la frase que la acción exige.
- **Resolución:** A favor de la **intención** del criterio («el aditivo no toca el schema»), verificada con un grep que excluye líneas de comentario → **0 líneas de CÓDIGO** tocan `schema_version`; `migrateState`/`migrateStateV2toV3` intactos (0 hits en el diff); y el test `never modifies schema_version` assertea el invariante por comportamiento (sigue siendo 3 tras el upsert).
- **Files modified:** ninguno (es un conflicto de redacción del plan, no de código).
- **Commit:** aaa999c

### 2. [Ajuste de frontera entre Task 1 y Task 2] TDD

- **Found during:** Task 1 (`tdd="true"`), cuyo `<verify>` apunta a `test/state/handoff-state.test.js` — el artefacto que el Task 2 declara crear.
- **Issue:** El gate RED del Task 1 exige que el test exista **antes** de la implementación; el Task 2 lo crea después. Orden imposible tal cual.
- **Resolución:** El gate RED del Task 1 creó la suite cubriendo sus `<behavior>` (13 casos, 13/13 en rojo → commit `test`), luego GREEN implementó (13/13 verde → commit `feat`). El Task 2 conservó su objeto propio: el caso explícito anti-migration-drop que su acceptance criteria pide (supervivencia a la relectura + bytes crudos v3), commiteado por separado.
- **Commits:** 126dc3f (RED), aaa999c (GREEN), 831f1ae (Task 2).

## TDD Gate Compliance

Secuencia completa y verificable en git log:

1. **RED** — `126dc3f test(74-02): add failing tests for upsertTaskHandoff` → 13/13 fallan (`upsertTaskHandoff is not a function`). Ningún test pasó inesperadamente.
2. **GREEN** — `aaa999c feat(74-02): add upsertTaskHandoff writer for state.tasks` → 13/13 verde.
3. **REFACTOR** — no necesario (el mutator es un espejo directo de `addSession`; limpiarlo lo alejaría del analog).

## Verification

| Gate | Resultado |
|---|---|
| `node --test test/state/handoff-state.test.js` | 14/14 pass |
| `node --test test/session/reconcile-lock.test.js` | 3/3 pass (2 preexistentes verdes) |
| `npm test` | **2084 pass · 0 fail · 1 skipped** (2085 total) |
| `git diff --stat package.json package-lock.json` | vacío — **cero dependencias npm nuevas** |
| `node --test test/check-isolation.test.js` (LOG-12) | 8/8 pass |
| HOME real intacto | `~/.kodo/state.json` sin clave `tasks`, sin residuo `.lock`/`.tmp.` |

**Success criteria del plan:** 6/6 cumplidos.

- `upsertTaskHandoff` escribe `state.tasks[task_id] = {plan_path, next, updated_at}` bajo `withStateLock` ✓
- `schema_version` sin tocar; typedef documenta `tasks?` como aditivo opcional ✓
- El mutator no toca `alive` (asserted — la fila de sesión queda byte-idéntica) ✓
- Lock-timeout → warn + fail-safe, sin excepción (asserted) ✓
- `state.tasks` sobrevive a `runReconcileTick` (asserted, con teeth verificadas por mutación) ✓
- Cero dependencias npm nuevas ✓

## Threat Mitigations Applied

| Threat | Estado |
|---|---|
| T-74-05 (Tampering → `state.json`) | Escritura exclusiva vía `withStateLock` (carga fresca dentro del lock). Mutator toca solo `state.tasks` |
| T-74-06 (DoS → lock-timeout) | `{ok:false}` → warn → `return r`. Nunca throw. Test explícito con el lock ocupado |
| T-74-08 (Info Disclosure → logs) | Solo `{task_id, reason}`. Test dedicado: un `next` centinela nunca aparece en la telemetría |
| T-74-10 (Pérdida silenciosa en migración) | Semilla v3 + assert de bytes crudos en disco + regresión anti-drop sobre el spread del tick |
| T-74-SC (Supply chain) | Cero instalaciones. `git diff --stat package.json package-lock.json` vacío |

### 3. [Requirement NO marcado completo — a propósito] LIVE-04

- **Found during:** state updates, al ejecutar `requirements.mark-complete`.
- **Issue:** El frontmatter del plan declara `requirements: [LIVE-04]`, pero LIVE-04 dice: «**Tras el cierre**, `state.json` refleja para esa tarea el puntero al plan + el `NEXT:` de una línea, escrito bajo `withStateLock`». Es un **resultado observable tras un cierre de sesión**. Este plan construye el escritor y lo prueba, pero **nadie lo llama todavía**: el cableado en `session-end.js` (como `stateWriterFn`) es del **Plan 04**. Hoy, tras un cierre real, `state.json` NO refleja nada.
- **Resolución:** LIVE-04 se deja **Pending**. Marcarlo completo ahora sería exactamente el **éxito falso que WR-01 prohíbe** — la misma disciplina sobre la que está construido este plan (la telemetría de éxito va gated tras el guard del lock precisamente para no reclamar lo que no ocurrió). Lo cierra el Plan 04, que es quien lo hace verdad. El requirement mapea a la **Phase 74 entera**, no al plan 02, así que dejarlo pendiente es consistente con la traceability.
- **Files modified:** ninguno.

## Known Stubs

Ninguno. `upsertTaskHandoff` está completamente cableado y testeado. Su **consumidor** (`session-end.js`) llega en el Plan 04 — dependencia planificada, no un stub: el escritor es funcional y verificable por sí solo hoy.

## Deferred Issues

| Item | Estado |
|---|---|
| `test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» — flaky preexistente (~1/3 runs) | **Verde en este run.** Fuera de alcance, no tocado. Ya registrado en `deferred-items.md` por el Plan 01 |

## Notes for Next Plan

- **Plan 04** inyecta `upsertTaskHandoff` como `stateWriterFn`. La firma es `(taskId, {plan_path, next?, updated_at?}, logger?)` y **devuelve** `{ok:true}|{ok:false, reason:'lock-timeout'}` — el caller debe seguir el cierre igualmente ante `{ok:false}` (D-06), nunca abortar.
- El truncado del `next` a 200 (D-02) vive en `extractNext` (Plan 01), **no** aquí: `upsertTaskHandoff` persiste lo que le den. El caller es quien pasa el valor ya truncado.
- **Phase 75** hereda la Open Question real (descubierta por el research): `/status` sirve `listSessions()` (`server.js:589`), no el `state.json` entero — `state.tasks` **no viaja hoy** hasta la TUI. Ninguna salida requiere endpoint nuevo (la TUI ya lee el filesystem en `plan.js`, precedente D-10 Phase 44).

## Self-Check: PASSED

- `src/session/state.js` — FOUND (`upsertTaskHandoff` exportado: 1 hit; `tasks?:` en typedef: 1 hit)
- `test/state/handoff-state.test.js` — FOUND (14 casos, 0 imports estáticos de `state.js`, siembra v3 explícita)
- `test/session/reconcile-lock.test.js` — FOUND (3 casos)
- Commits `126dc3f`, `aaa999c`, `831f1ae`, `471b58c` — FOUND en git log
- `src/session/reconcile.js` — sin diff vs HEAD (mutación de prueba revertida limpiamente)
