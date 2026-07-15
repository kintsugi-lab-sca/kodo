---
phase: 74-handoff-acumulativo-al-cierre
plan: 05
subsystem: testing-concurrency
tags: [handoff, concurrency, cross-process, locking, lost-update, home-isolation, teeth]
status: complete

requires:
  - "writeHandoff (Plan 04) — exportada y SÍNCRONA a propósito para que el hijo pueda ejercer la sección crítica exacta cross-process sin levantar el hook entero"
  - "upsertTaskHandoff (Plan 02) — el escritor de state.tasks que la Carrera 1 mide"
  - "hasSessionHandoff / findSessionBlock (Plan 01) — hoja pura sin fs: el ÚNICO import estático permitido en la suite"
  - "test/helpers/lock-race-child.mjs — el harness multi-modo de v0.16 Phase 70"
provides:
  - "modo --kind handoff (+ argumento --task) en el harness compartido — sexto modo"
  - "test/state/handoff-concurrency.test.js — 7 casos: las dos carreras + higiene"
  - "la evidencia cross-process de LIVE-04 (SC#4) y D-08"
affects:
  - "Cierre de la Phase 74 — este plan es la última pieza; LIVE-01/03/04 quedan listos para /gsd-verify-work"
  - "Phase 75 (dashboard) — consume los bloques cuya supervivencia bajo carrera queda aquí probada"

tech-stack:
  added: []
  patterns:
    - "Barrera `go` liberada tras el evento 'spawn' de TODOS los hijos (no síncronamente tras el bucle, como el analog)"
    - "env: {...process.env, HOME: sandbox} por hijo + dynamic import POST-HOME (Pitfall 6)"
    - "Semilla v3 explícita — comprobada empíricamente, no asumida (Pitfall 5)"
    - "Assert sobre el AGREGADO, jamás sobre quién gana"
    - "Teeth verificadas por mutación: el lock se bypassea, el test DEBE fallar, se revierte"

key-files:
  created:
    - test/state/handoff-concurrency.test.js   # 7 casos: Carrera 1 (3) + Carrera 2 (3) + higiene (1)
  modified:
    - test/helpers/lock-race-child.mjs         # modo --kind handoff + --task; registrado en los 3 sitios

decisions:
  - "La barrera se libera tras el evento 'spawn' de todos los hijos, NO síncronamente tras el bucle como hace el analog (:100-104). `spawn()` retorna antes de que el hijo arranque, así que el go-file del analog existe antes de que nadie llegue a la barrera — la contención del analog viene del boot paralelo, no de la barrera. El plan pedía explícitamente «esperar a que estén todos creados»"
  - "El verdicto `written` del hijo significa «writeHandoff no lanzó», NO «escribió»: ante lock-timeout writeHandoff hace warn + return sin lanzar (D-06). El assert que carga el peso es el CONTEO DE BLOQUES, no el verdicto — y así lo pide el plan («assert sobre el agregado»)"
  - "La Carrera 1 sigue VERDE con el lock del plan bypasseado, y es correcto: mide withStateLock (intacto), no withFileLock. Que fallaran las tres de la Carrera 2 y ninguna de la 1 es la prueba de que cada carrera mide su propia garantía"

metrics:
  duration: ~18 min
  tasks: 2
  commits: 2
  files: 2
  tests-added: 7
  suite_total: 2130        # 2129 pass · 0 fail · 1 skipped
  completed: 2026-07-15
---

# Phase 74 Plan 05: las dos carreras cross-process Summary

Las dos garantías de concurrencia sobre las que se apoyan LIVE-04 y D-08 quedan probadas con
**procesos reales** compitiendo por los mismos ficheros — y el test está **verificado por
mutación**: sin el lock, falla.

## What Was Built

**Task 1 — `--kind handoff`** (`b80819d`): sexto modo del harness compartido, espejo estructural
del bloque `--kind writer`. Hace **dynamic import** de `session-end.js` y llama a
`writeHandoff({session, input, log}, {})` con los deps **vacíos**, para que los defaults resuelvan
a `join(KODO_DIR, 'plans')` y `upsertTaskHandoff` reales dentro del sandbox. El argumento nuevo
`--task` es el que permite las dos carreras desde un único modo: `--task` distinto por hijo →
carrera sobre `state.json`; el **mismo** `--task` para todos → carrera sobre el **mismo plan**.
Registrado en los tres sitios de convención (lista de invocadores, argv, dispatch).

**Task 2 — la suite** (`d81a20d`): 7 casos en `test/state/handoff-concurrency.test.js` —
Carrera 1 (3), Carrera 2 (3), higiene (1).

## El test tiene teeth — verificado, no asumido

Un test de concurrencia verde no prueba nada por sí solo: podría pasar porque los hijos nunca
llegaron a solaparse. Sustituí la llamada a `withFileLock` de `writeHandoff` por la RMW desnuda
y corrí la suite **5 veces**:

| | Con lock (HEAD) | Lock bypasseado |
|---|---|---|
| Carrera 1 (state.tasks) | 3/3 verde | **3/3 verde** — correcto: mide `withStateLock`, que NO muté |
| Carrera 2 (mismo plan) | 3/3 verde | **0/3 — las tres FALLAN, en 5/5 runs** |

Que fallen exactamente las tres de la Carrera 2 y **ninguna** de la Carrera 1 es la prueba doble:
la contención es real (no es un test vacuo) **y** cada carrera mide su propia garantía y no la de
al lado. `src/hooks/session-end.js` quedó **byte-idéntico a HEAD** tras revertir
(`git diff --stat` vacío, verificado también contra copia de seguridad).

## La barrera del analog no es una barrera (y por qué la mía sí)

El analog escribe el go-file **síncronamente** tras el bucle de spawn (`:100-104`), con el
comentario *«All children spawned and waiting on the barrier»*. Pero `spawn()` **retorna antes de
que el hijo arranque**: el go-file existe ya cuando el primer hijo evalúa `existsSync(goFile)`, así
que ningún hijo espera nunca. La contención del analog viene del **boot paralelo**, no de la
barrera — funciona por accidente afortunado.

El plan pedía explícitamente *«esperar a que estén todos creados, y solo entonces escribir el
go-file»*. Mi versión espera el evento `'spawn'` de los N hijos antes de liberar, sin tocar el
`waitForBarrier` del harness (que el plan manda reutilizar tal cual). El resultado se ve en la
tabla de teeth: con la barrera así, el bypass del lock falla **5/5**, no 1 de cada 3.

## Pitfall 5 confirmado empíricamente (no lo di por bueno)

Antes de sembrar v3 comprobé que la trampa es real. Corriendo el hijo con un HOME limpio y **sin
semilla**, esto es lo que aterriza en disco:

```json
{ "schema_version": 2, "sessions": {}, "tasks": { "task-0": { ... } } }
```

Un fichero **v2 con `tasks`** — exactamente el input que `migrateStateV2toV3:139-143` descartaría
en la siguiente lectura. La semilla v3 explícita no es ceremonia: sin ella la suite fallaría por
una razón que no es la que mide.

## Key Decisions

**`written` significa «no lanzó», no «escribió».** Ante un lock-timeout, `writeHandoff` hace
`warn` + `return` sin lanzar (D-06, fail-safe deliberado), así que el hijo imprimiría `written`
igualmente. El verdicto es por tanto un assert **débil** por construcción; el que carga el peso es
el **conteo de bloques** / de entradas en `state.tasks` — que es justo lo que el plan ordena
(«assertar sobre el agregado, jamás sobre quién gana»). Mantuve el contrato de verdicto del plan
(espejo del modo `writer`) y dejo la sutileza anotada aquí para quien lea los asserts.

**Un único import estático: `hasSessionHandoff`.** Es una hoja pura sin fs que no resuelve rutas en
module-load, así que no puede romper el aislamiento de HOME. Cero imports estáticos de `state.js`
o `session-end.js` en la suite (asserted = 0).

## Deviations from Plan

**Cero desviaciones de código.** Ningún auto-fix de las Reglas 1-3 fue necesario.

**Un refinamiento de andamiaje sobre el analog** (documentado arriba): la barrera se libera tras el
evento `'spawn'` de todos los hijos en vez de síncronamente tras el bucle. No es una desviación del
plan — es lo que el plan pide literalmente; es una mejora **sobre el analog**, cuya barrera es un
no-op. El `waitForBarrier` del harness queda intacto, como el Task 1 manda.

## Verification

| Gate | Resultado |
|---|---|
| `node --test test/state/handoff-concurrency.test.js` | **7/7 pass** |
| Estabilidad — 3 ejecuciones consecutivas | **7/7 · 7/7 · 7/7** — no flaky |
| Teeth por mutación (lock bypasseado) | **3/3 casos de la Carrera 2 fallan, 5/5 runs**; revertido byte-idéntico |
| `node --test` sobre las 3 suites del harness compartido | verde (ver Deferred Issues) |
| `npm test` | **2129 pass · 0 fail · 1 skipped** (2130) — baseline 2123 + 7 nuevos, cero regresiones |
| `git diff --stat package.json package-lock.json` | vacío — **cero deps npm nuevas** (T-74-SC) |
| Higiene del HOME real | `state.json` **byte-idéntico** antes/después de la suite; `state.tasks` = `{}` |

**Success criteria del plan: 7/7.**

| Criterio | Evidencia |
|---|---|
| `--kind handoff` existe; los 5 modos previos verdes | 6 modos; las 3 suites del harness pasan |
| N=5 tareas distintas → 5 entradas, cero perdidas (LIVE-04) | `Object.keys(state.tasks).length == 5` + los 5 verdicts `written` |
| N=2 y N=4 misma tarea → todos los bloques (D-08) | conteo == N + `hasSessionHandoff` por sesión |
| Cero `.tmp.` / `.lock` huérfanos | `readdirSync` filtrado, ambos `[]` |
| `~/.kodo` real intacto | diff byte a byte antes/después; ver abajo |
| No flaky | 3 runs consecutivos verdes |
| Cero deps npm | `git diff --stat` vacío |

**Criterios de fuente:** `kind === 'handoff'` = **1** · imports estáticos de `session-end.js` en el
harness = **0** · menciones de `handoff` en el harness = **8** (≥3) · `schema_version: 3` en la
suite = **1** · `HOME: sandbox` = **1** · imports estáticos de `state.js`/`session-end.js` en la
suite = **0**.

**CLI:** `HOME=$(mktemp -d) node test/helpers/lock-race-child.mjs --kind handoff --idx 0` imprime
exactamente `written`, exit **0**, y los ficheros aterrizan en `<sandbox>/.kodo/`.

## Un susto de HOME que NO era una fuga (investigado hasta el fondo)

Tras `npm test`, `~/.kodo/plans/` pasó de **25 a 26** ficheros y el md5 de `state.json` cambió. Dado
el precedente del Plan 04 (que reprodujo una fuga real y silenciosa), lo investigué antes de dar
nada por bueno. **No es una fuga:**

- El fichero nuevo es `913d22aa-…-.md` → una **sesión real y viva** del operador: `task_ref`
  **ROMAN-218** («cambiar ordenación de entrevistas»), provider `plane`, `status: running`,
  presente en `state.sessions`. Contenido: contexto real del proyecto. **Cero bloques `## Handoff`**
  → `writeHandoff` nunca corrió contra él.
- `state.tasks` del HOME real = **`{}`** — vacío. Una fuga de esta suite habría dejado ahí
  `task-0…task-4` o `shared-task` (writeHandoff escribe plan **y** state).
- Cero ficheros con nombre de test en `~/.kodo/plans/`; cero residuo `.lock`/`.tmp.`.
- **La prueba definitiva:** snapshot de `state.json` y del listado de `plans/` inmediatamente antes
  y después de correr **mi** suite → **idénticos byte a byte**.

El cambio es actividad genuina del kodo del operador (dos sesiones vivas escribiendo), concurrente
con mi ejecución. El aislamiento por `env: {HOME: sandbox}` + dynamic import POST-HOME funciona.

## Threat Mitigations Applied

| Threat | Estado |
|---|---|
| T-74-04 (lost update del plan) | **Verificado, no solo mitigado:** Carrera 2 con N=2 y N=4 cross-process → todos los bloques. Y el test **falla** si se quita el lock (5/5) |
| T-74-05 (`state.tasks` bajo contención) | Carrera 1 con N=5 → las 5 entradas. `withStateLock` (carga fresca dentro del lock) hace su trabajo para la clave nueva |
| T-74-14 (lock robado por TTL) | No observado: la sección crítica es una RMW síncrona de ~ms frente a un TTL de 10 s. `--hold` queda disponible en el harness si algún día hace falta modelar un holder lento |
| T-74-15 (harness escribiendo en el `~/.kodo` real) | `env: {...process.env, HOME: sandbox}` + dynamic import POST-HOME. Asserted por fuente (0 imports estáticos) y por diff byte a byte del HOME real antes/después |
| T-74-SC (supply chain) | Cero paquetes instalados; `git diff --stat package.json package-lock.json` vacío. Solo `node:child_process`/`node:fs` |

## Known Stubs

Ninguno. Las dos carreras ejercen el carril de escritura **real** (`writeHandoff` con deps por
defecto), no un doble ni un mock.

## Deferred Issues

| Item | Estado |
|---|---|
| `test/gsd-lock-race.test.js` → «concurrent dead-holder steal (CR-01)» → *5 processes observing the SAME dead-PID stale lock* | **Flaky preexistente confirmado**, reproducido ~1 de cada 9-12 runs durante este plan. **Fuera de alcance, no tocado**: un fix a ciegas podría enmascarar una carrera real del lock que el invariante de v0.16 Phase 70 protege. Es fichero DISTINTO del que crea este plan. Ya registrado en `deferred-items.md` por el Plan 01. Verde en el `npm test` final |

## Notes for Next Plan

- **La fase queda lista para `/gsd-verify-work`.** LIVE-01/03/04 siguen **Pending** por la
  disciplina que los Planes 01/02/04 razonaron: `REQUIREMENTS.md` los traza a nivel de **fase**.
  Este plan cierra la última pieza técnica (la verificación bajo carrera), así que corresponde
  marcarlos al cierre de la fase, tras las verificaciones manuales de `<human-check>`.
- **La ventana 74→75 (RESEARCH §Pitfall 7) sigue abierta y NO es un bug:** hasta que la Phase 75
  renderice markdown (LIVE-06), `readLightPlan` hace `md.split('\n')` y el marcador HTML se verá
  crudo en el overlay `phaseId == null`. Un reporte de UAT «veo basura HTML» es esto, no un defecto.
- **Para quien extienda el harness:** el sexto modo ya está; añadir un séptimo cuesta tres sitios
  (lista de invocadores, argv, dispatch). Y si alguien vuelve `writeHandoff` `async`, el lock se
  liberaría antes de la escritura y T-74-04 reaparecería — la Carrera 2 lo detectaría.

## Self-Check: PASSED

- Ficheros: `test/helpers/lock-race-child.mjs` FOUND · `test/state/handoff-concurrency.test.js` FOUND
- Commits `b80819d`, `d81a20d` — ambos FOUND en git log
- `src/hooks/session-end.js` — sin diff vs HEAD (mutación de teeth revertida limpiamente)
- HOME real: `state.tasks` = `{}`, cero artefactos de test, `state.json` byte-idéntico antes/después
  de la suite
