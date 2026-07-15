---
phase: 74-handoff-acumulativo-al-cierre
plan: 04
subsystem: hooks
tags: [handoff, session-end, locking, rmw, di, security, home-isolation]
status: complete

requires:
  - "src/session/handoff.js (Plan 01) — el contrato de formato: isSafeTaskId, buildPlanHeader, buildHandoffBlock, findSessionBlock, extractNext"
  - "upsertTaskHandoff (Plan 02) — el escritor fail-safe de state.tasks"
  - "withFileLock (src/session/state-lock.js) — el advisory lock O_EXCL de D-08"
  - "KODO_DIR (src/config.js) — único símbolo importado; la raíz de la ruta del plan"
provides:
  - "writeHandoff — export nuevo de src/hooks/session-end.js: el RMW del plan bajo withFileLock (LIVE-01/03/04)"
  - "el seam cableado en session-end.js:143 con try/catch propio — el hook por fin escribe bytes"
  - "claves nuevas en el shape deps de runSessionEndHook: plansDir, fs, stateWriterFn, now"
affects:
  - "Plan 05 (handoff-concurrency) — correrá writeHandoff bajo carrera cross-process real"
  - "Phase 75 (dashboard) — leerá los bloques que este plan escribe"

tech-stack:
  added: []
  patterns:
    - "fn de withFileLock 100% SÍNCRONO (precedente reconcile.js:357-359, sleepSync de state-lock.js:39-48)"
    - "tmp+rename de nombre único por escritor: path + '.tmp.' + process.pid + '.' + randomUUID() (espejo verbatim de saveState:280, fix WR-02)"
    - "try/catch propio en el seam además del outer never-throws (espejo del bloque backstop :148-173)"
    - "deps.X || <default real> — el patrón DI del fichero"
    - "guard de contención como PRIMERA sentencia (T-74-01)"
    - "aislamiento del HOME por DI, no por process.env.HOME (config.js:11 evalúa homedir() en module-load)"

key-files:
  created:
    - test/hooks/session-end-handoff.test.js   # 26 casos: writeHandoff (17) + el seam (9)
  modified:
    - src/hooks/session-end.js                 # writeHandoff + el seam en :143 + JSDoc de deps
    - test/hooks/session-end.test.js           # aislamiento del HOME en las 17 invocaciones + regresión D-08

decisions:
  - "El criterio `grep -c \"'.tmp.' + process.pid\"` obligó a la concatenación literal en vez de un template literal — se resolvió a favor del criterio Y del precedente: `saveState:280` usa esa forma exacta, así que el grep estaba midiendo fidelidad al patrón WR-02, no sintaxis arbitraria"
  - "El tmpdir de la suite preexistente se nombra `handoffTmpdir`, NO `plansDir`, para que el criterio `grep -c 'runSessionEndHook(' == grep -c 'plansDir'` mida invocaciones-aisladas y no ruido de cabecera"
  - "writeHandoff PROPAGA el EACCES en vez de capturarlo: quien lo captura es el try/catch del seam. Duplicar el catch escondería el fallo al caller sin ganar nada"

metrics:
  duration: ~5 min
  tasks: 3
  commits: 5
  files: 3
  tests-added: 27          # 26 en la suite nueva + 1 regresión D-08 en la preexistente
  suite_total: 2123        # 2122 pass · 0 fail · 1 skipped
  completed: 2026-07-15
---

# Phase 74 Plan 04: `writeHandoff` — el hook por fin escribe bytes Summary

`session-end.js` pasa de escribir **cero bytes** a aterrizar un bloque `## Handoff` en
`~/.kodo/plans/<task_id>.md` en **toda** sesión que cierre — bajo `withFileLock`, con el
puntero + `NEXT:` en `state.tasks`, y **antes** del cleanup terminal destructivo.

## What Was Built

**Task 1 — `writeHandoff`** (`42473b8` RED 17/17 rojo, `b477040` GREEN 17/17 verde): función
**síncrona** exportada que hace el RMW del plan bajo `withFileLock` sobre `<plan>.md.lock`:
guard `isSafeTaskId` como primera sentencia → ruta construida → `mkdir` fuera de la sección
crítica → dentro del lock: leer-o-crear-cabecera (D-09), detector scoped de D-04, append del
bloque mecánico (LIVE-03), tmp+rename de nombre único por escritor → `stateWriterFn` con
`{plan_path, next, updated_at}` (LIVE-04).

**Task 2 — el seam** (`58f8c6c` RED 5/9 rojo, `292140a` GREEN 26/26 verde): la llamada
insertada en `session-end.js:143`, entre la construcción del `log` (`:115-117`) y el
comentario del Review backstop (`:148`), con try/catch propio. Queda **66 líneas** por
delante de `performTerminalCleanup` (`:209`).

**Task 3 — la fuga de HOME** (`b19c1a3`): `plansDir` + `stateWriterFn` inyectados en las **17**
invocaciones de `test/hooks/session-end.test.js`, más el caso de regresión de D-08.

## La fuga de HOME no era hipotética — la reproduje

El plan advertía de T-74-15 en condicional. **Ocurrió de verdad**, y merece constar porque es
la clase de fallo que un test verde no delata:

Tras cablear el seam (Task 2) y antes del Task 3, corrí `test/hooks/session-end.test.js` para
comprobar que no había regresiones. Salió **19/19 verde**. Y sin embargo, esa misma ejecución
había escrito en el `~/.kodo` **REAL** de mi operador:

```
$ ls -la ~/.kodo/plans/kodo-end-1.md
.rw-r--r-- alex staff 287 B Jul 15 12:29  /Users/alex/.kodo/plans/kodo-end-1.md
$ node -e "...state.json..."
tasks: {"kodo-end-1":{"plan_path":"/Users/alex/.kodo/plans/kodo-end-1.md","next":null,...}}
```

Un fichero de una sesión de test (`kodo-end-1`) en el directorio de planes real, y su entrada
en el `state.json` real. **Cero señales**: la suite verde, el exit 0. Sin el Task 3, cada
`npm test` de cada colaborador habría ensuciado su HOME en silencio.

El residuo se limpió (fichero borrado + entrada de `state.tasks` eliminada del `state.json`
real, que quedó **byte-idéntico** al baseline), y el cierre se verificó por hash:

| | plans | state.json |
|---|---|---|
| Antes de `npm test` | 25 | `d528f99f…` |
| Después de `npm test` | 25 | `d528f99f…` (IDÉNTICO) |

Esto también valida la razón que el plan daba: `config.js:11` evalúa `homedir()` en
**module-load**, así que pisar `process.env.HOME` no habría cerrado nada desde un fichero con
imports estáticos. La DI era la única salida.

## Key Decisions

**`writeHandoff` propaga el EACCES; no lo captura.** El `<behavior>` del Task 1 lo pide y es
coherente: el try/catch del seam es el punto ÚNICO de captura (SC#5). Un catch aquí dentro
escondería el fallo al caller sin ganar nada — y el caller es quien tiene el `console.error`.

**El tmp se construye por concatenación literal, no con template literal.** Mi primera versión
usó `` `${planPath}.tmp.` + process.pid + … `` y el criterio `grep -c "'.tmp.' + process.pid"`
dio **0**. Reescrito a `planPath + '.tmp.' + process.pid + '.' + randomUUID()`. No fue ceder a
un grep: es la forma **exacta** de `saveState:280`, así que el criterio estaba midiendo
fidelidad al patrón WR-02, que es justo lo que el plan quería asegurar.

**El tmpdir de la suite preexistente se llama `handoffTmpdir`.** El criterio de Task 3
(`grep -c 'runSessionEndHook(' == grep -c 'plansDir'`) es un proxy de «cada invocación
aislada». Nombrar el tmpdir `plansDir` habría metido líneas de cabecera en el contador y roto
el balance sin que nada estuviera mal. Con `handoffTmpdir`, el literal `plansDir` aparece
**exactamente una vez por invocación** → 18 == 18, y el proxy mide lo que dice medir.

## Deviations from Plan

**Cero desviaciones de código.** Ningún auto-fix de las Reglas 1-3 fue necesario; el plan se
ejecutó como está escrito. Dos ajustes de *forma* (no de comportamiento), ambos documentados
arriba en Key Decisions: la concatenación literal del tmp y el nombre del tmpdir.

**Una nota sobre el criterio del seam.** El plan lo llama «el seam `:97`». Tras añadir los
imports estáticos nuevos (`node:path`, `node:crypto`, `node:fs`, `state-lock.js`, `handoff.js`,
`config.js`) y extender el JSDoc de `deps`, la línea real es la **143**. La **posición
semántica** — que es lo que el plan bloquea — está intacta y verificada: tras la construcción
del `log`, antes del `// ── Review backstop`, muy por delante de `performTerminalCleanup`.

### Requirements NO marcados completos — a propósito (LIVE-01, LIVE-03, LIVE-04)

El frontmatter declara `requirements: [LIVE-01, LIVE-03, LIVE-04]` y este plan **sí** los hace
verdad en código. Aun así los dejo **Pending**, por consistencia con los Planes 01 y 02, que
razonaron lo mismo: `REQUIREMENTS.md` los traza a nivel de **fase**, y la fase no está cerrada
— el **Plan 05** (verificación de concurrencia cross-process) es parte del contrato de LIVE-01
(que el dato aterrice **siempre**, también bajo carrera). Marcarlos ahora, con el Plan 05 sin
correr, sería reclamar un éxito que aún no está verificado de punta a punta — el mismo
**WR-01** («nunca reclamar un éxito falso») sobre el que está construida esta fase. Corresponde
marcarlos al cierre de la fase, tras el Plan 05 / `/gsd-verify-work`.

## Verification

| Gate | Resultado |
|---|---|
| `node --test test/hooks/session-end-handoff.test.js` | **26/26 pass** |
| `node --test test/hooks/session-end.test.js` | **20/20 pass** (19 preexistentes sin modificar + 1 regresión D-08) |
| `npm test` | **2122 pass · 0 fail · 1 skipped** (2123 total) — cero regresiones |
| `git diff --stat package.json package-lock.json` | vacío — **cero deps npm nuevas** (T-74-SC) |
| Higiene del HOME tras `npm test` | `plans` 25 → 25; `state.json` **byte-idéntico** (md5); sin residuo `.lock`/`.tmp.` |

**Success criteria del plan: 10/10.**

| Criterio | Evidencia |
|---|---|
| `writeHandoff` existe, síncrona, cableada con try/catch propio | `writeHandoff.constructor.name === 'Function'` asserted; seam en `:143` |
| El handoff aterriza antes de `removeSession` | `iHandoff < iRemove` sobre el array `calls` compartido |
| Orden `removeSession → setColor → notify` intacto | asserted en ambas suites |
| Plan ausente → se crea (D-09, universal) | asserted, incluida la rama GSD (`gsd: true`) |
| Marcador de esta sesión → cero cambios | fichero **idéntico byte a byte** asserted |
| Bloque de sesión anterior → sí appendea | dos bloques, el primero íntegro |
| Plan ilegible o lock ocupado → warn, sin throw | `doesNotReject` + cleanup y trío presentes |
| `state.tasks[task_id]` poblado | `{plan_path, next, updated_at}` asserted |
| `npm test` no toca el `~/.kodo` real | verificado por hash md5 |
| Cero dependencias npm nuevas | `git diff --stat` vacío |

**Criterios de fuente:** `writeFileAtomic` en código = **0**; único import de `../config.js` =
**`KODO_DIR`**; `export function writeHandoff` = **1**; `'.tmp.' + process.pid` = **1**;
invocaciones == aisladas = **18 == 18**.

## Threat Mitigations Applied

| Threat | Mitigación implementada y testeada |
|---|---|
| T-74-01 | `isSafeTaskId` como PRIMERA sentencia. Test con `task_id='../../evil'`: `plansDir` vacío, ningún fichero fuera, `stateWriterFn` sin llamar, warn emitido |
| T-74-02 | `normalizeReason` dentro de `buildHandoffBlock`. Test: `'valor-inventado-hostil'` → `motivo: other` y el valor crudo **no aparece** en el markdown |
| T-74-04 | RMW bajo `withFileLock` con `fn` **síncrono** (asserted por `constructor.name`); tmp+rename único por escritor; **nunca** `writeFileAtomic` (asserted = 0) |
| T-74-05 | Toda escritura de state vía `stateWriterFn` → `upsertTaskHandoff` → `withStateLock` |
| T-74-06 | Lock ocupado → `{ok:false}` → warn → return. Test con lockfile de pid vivo: sin throw, sin state, el cierre completa |
| T-74-07 | try/catch propio en el seam. Test con `fs` stub que lanza EACCES: el hook **completa** y `removeSession`/`setColor`/`notify` corren igual |
| T-74-08 | Logs con solo `{task_id, reason}`. Test dedicado: un `summary` centinela nunca aparece en los campos |
| T-74-14 | `fn` síncrono y corto; tmp único limita el daño incluso si el lock se robara tras el TTL |
| T-74-15 | **La fuga se reprodujo y se cerró** — ver la sección dedicada. Verificado por hash del `state.json` real |
| T-74-SC | Cero paquetes instalados; `git diff --stat package.json package-lock.json` vacío |

**OQ2 (no re-litigada, como manda el plan):** `detectHungLocks` (`doctor.js:341`) solo escanea
`join(projectPath, '.planning/.kodo.lock')` sobre rutas de proyecto — jamás `~/.kodo/plans/`.
El `<plan>.md.lock` nuevo no puede confundirlo. Sin cambios en `doctor.js`.

## TDD Gate Compliance

Tasks 1 y 2 (`tdd="true"`) cumplen la secuencia en git log, con el RED **verificado fallando**
antes de cada implementación:

1. `42473b8` **test** RED — falla al importar (`writeHandoff` no existe).
2. `b477040` **feat** GREEN — 17/17.
3. `58f8c6c` **test** RED — 5 de los 9 casos nuevos en rojo (los 4 restantes son guards de
   regresión: el trío LOCKED y los guards de idempotencia, que deben seguir verdes **antes y
   después** de la inserción — que pasaran en rojo habría sido la señal de alarma).
4. `292140a` **feat** GREEN — 26/26.

Ningún test pasó inesperadamente en un gate RED. REFACTOR no fue necesario. Task 3 no es TDD
(aísla una suite, no añade comportamiento).

## Known Stubs

Ninguno. `writeHandoff` está completamente cableado: el hook escribe en disco y persiste en
`state.json` en cada cierre. Nada quedó tras un flag ni con datos vacíos.

## Deferred Issues

| Item | Estado |
|---|---|
| `test/gsd-lock-race.test.js` «concurrent dead-holder steal (CR-01)» — flaky preexistente (~1/3 runs) | **Verde en este run.** Fuera de alcance, no tocado (un fix a ciegas podría enmascarar una carrera real del lock que el invariante de v0.16 Phase 70 protege). Ya registrado en `deferred-items.md` por el Plan 01 |

## Notes for Next Plan

- **Plan 05** ejercitará `writeHandoff` bajo carrera cross-process. Dos avisos útiles: (a) la
  firma es `writeHandoff({session, input, log}, {plansDir, fs, stateWriterFn, now})` y el
  `plansDir` **debe** ser un tmpdir; (b) el lockfile es `<task_id>.md.lock` **dentro** de
  `plansDir`, y un lock de pid vivo hace que `acquireLock` agote reintentos en ~160 ms — útil
  para modelar la contención sin sleeps arbitrarios.
- El `fn` síncrono es el invariante que el Plan 05 debe poder romper para probar sus teeth: si
  alguien lo vuelve `async`, el lock se libera antes de la escritura y el *lost update* de
  T-74-04 reaparece. El assert `constructor.name !== 'AsyncFunction'` ya lo vigila.

## Self-Check: PASSED

- Ficheros: `src/hooks/session-end.js` FOUND · `test/hooks/session-end-handoff.test.js` FOUND ·
  `test/hooks/session-end.test.js` FOUND
- Commits `42473b8`, `b477040`, `58f8c6c`, `292140a`, `b19c1a3` — todos FOUND en git log
- HOME real: `~/.kodo/plans/` 25 ficheros y `state.json` byte-idéntico al baseline tras la
  ejecución completa; residuo de la fuga limpiado
