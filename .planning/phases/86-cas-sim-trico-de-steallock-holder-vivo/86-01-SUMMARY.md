---
phase: 86-cas-sim-trico-de-steallock-holder-vivo
plan: 01
subsystem: infra
tags: [concurrency, file-lock, compare-and-swap, toctou, tdd, node-fs]

requires:
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: steal-guard O_EXCL publicado atómicamente vía linkSync + ownership solo por renameSync(tmp→lockPath)
  - phase: 83-inbox-foundation
    provides: patrón CAS bytes+ino dentro del lock (src/inbox/store.js markCapture) y el seam _afterReadFn
provides:
  - "readLockIdentity(path) → { raw, content, ino }: lector interno de UNA pasada en src/gsd/lock.js"
  - "CAS simétrico en la rama PRESENT de stealLock: sonda fresca de identidad justo antes del renameSync"
  - "reason: 'lock-replaced-mid-steal' — valor canónico y único del campo aditivo AcquireResult.reason"
  - "deps = {} como tercer parámetro opcional de acquireGsdLock (cuarto de stealLock) con el seam _afterCriticalReadFn"
  - "5 casos in-process deterministas del interleaving de 2º orden en test/gsd-lock-guard.test.js"
  - "phase_base_sha para el gate de consumidores intactos del plan 86-02"
affects: [86-02, LOCK-05, LOCK-06, LOCK-07, harness de procesos reales, declaración de ventana residual]

actuals:
  tokens: 4300
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "Compare-and-swap de identidad por bytes crudos (Buffer.equals) + ino, transportado de src/inbox/store.js a src/gsd/lock.js con la divergencia deliberada size→bytes"
    - "Seam de inyección de test en producción por tercer parámetro opcional de deps, disparado solo con attempt === 0"

key-files:
  created: []
  modified:
    - src/gsd/lock.js
    - test/gsd-lock-guard.test.js

key-decisions:
  - "86-01: el baseline del CAS sale de readLockIdentity dentro de la sección crítica — una sola pasada, bytes de LA LECTURA y jamás de un statSync separado (D-01)"
  - "86-01: la detección es por Buffer.equals sobre bytes crudos + ino, no por size — el lock se reemplaza entero y dos contenidos distintos caben en el mismo tamaño (D-02, divergencia deliberada del análogo del inbox)"
  - "86-01: detectar cambio NO retorna — borra el tmp, suelta el guard por el finally y hace continue; el bucle ya resuelve los tres estados del path (D-05). Solo el holder VIVO y fresco corta con reason (D-06)"
  - "86-01: el continue consume un intento del presupuesto EXISTENTE; MAX_STEAL_ATTEMPTS sigue en 8 y el epílogo no se toca (D-07/DEBT-04)"
  - "86-01: el criterio grep -c 'mtimeMs' = 3 mide el TOKEN, no la semántica — se cumplió reformulando un comentario a 'modification TIME', no eliminando la documentación de D-04 (declarado como hallazgo, no silenciado)"
  - "86-01: la premisa falsa de :455-457 se retira nombrando el hecho real — el guard serializa STEALERS, no creadores (D-18)"

patterns-established:
  - "CAS de identidad en lock.js: baseline (readLockIdentity) → writeFileSync(tmp) → sonda fresca (readLockIdentity) → renombrar o abortar. ORDEN INAMOVIBLE heredado de src/inbox/store.js:787-789"
  - "Abort conservador: si cualquiera de las dos sondas no tiene bytes, changed = true y NO se publica"

requirements-completed: [LOCK-04]

coverage:
  - id: D1
    description: "El steal aborta con reason 'lock-replaced-mid-steal' y holder del creador cuando el lock es reemplazado por un holder VIVO en plena sección crítica (LOCK-04 a/b)"
    requirement: LOCK-04
    verification:
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(g) el steal ABORTA cuando el lock es reemplazado por un creador VIVO en plena sección crítica"
        status: pass
    human_judgment: false
  - id: D2
    description: "El renameSync destructivo NO se ejecuta: el lock del creador Case-1 sobrevive en disco y el camino del abort no deja residuo de tmp ni de steal-guard (LOCK-04 a, D-03)"
    requirement: LOCK-04
    verification:
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(h) tras el abort, el lock del creador sobrevive en disco y no queda residuo"
        status: pass
    human_judgment: false
  - id: D3
    description: "Un lock corrupto sigue siendo robable con el CAS puesto y NUNCA puede producir reason — content: null no se convierte en un bloqueo (LOCK-04 d, IN-01 no empeora)"
    requirement: LOCK-04
    verification:
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(i) un lock corrupto sigue siendo robable con el CAS puesto (seam no-op)"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(i2) corrupto SUSTITUIDO por otro corrupto en la ventana → re-contiende y roba, sin reason"
        status: pass
      - kind: unit
        ref: "test/gsd-lock.test.js#steals lock when file contains corrupt JSON"
        status: pass
    human_judgment: false
  - id: D4
    description: "El CAS no aborta cuando nada cambió: los 25 casos previos de los tres ficheros de lock siguen verdes sin tocarlos (LOCK-04 c)"
    requirement: LOCK-04
    verification:
      - kind: unit
        ref: "node --test test/gsd-lock-guard.test.js test/gsd-lock.test.js test/gsd-lock-race.test.js"
        status: pass
    human_judgment: false
  - id: D5
    description: "El tercer parámetro deps es opcional y aditivo: los consumidores de la firma de 2 argumentos no cambian ni necesitan cambio (D-08/D-11, criterio 5)"
    requirement: LOCK-04
    verification:
      - kind: unit
        ref: "node --test test/gsd-concurrency.test.js test/dispatcher.test.js test/stop.test.js test/gsd-inspect-cli.test.js"
        status: pass
      - kind: unit
        ref: "test/gsd-lock-guard.test.js#(j) sin seam, cero cambio de comportamiento: el holder stale-pero-VIVO se roba como siempre"
        status: pass
    human_judgment: false
  - id: D6
    description: "El seam es superficie de test, no característica: ningún fichero de src/ fuera de src/gsd/lock.js lo nombra ni lo pasa (D-10, T-86-06)"
    requirement: LOCK-04
    verification:
      - kind: other
        ref: "grep -rln '_afterCriticalReadFn' src/  → src/gsd/lock.js (única línea)"
        status: pass
    human_judgment: false
  - id: D7
    description: "La premisa falsa de src/gsd/lock.js:455-457 desaparece y la frase verdadera sobre la atomicidad del rename se conserva (D-18)"
    requirement: LOCK-04
    verification:
      - kind: other
        ref: "grep -c 'Case-1 creator can race here' = 0 · grep -c 'guard fully serializes us' = 0 · grep -c 'rename swaps the inode atomically' = 1"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-05
status: complete
---

# Phase 86 Plan 01: CAS simétrico de `stealLock` — holder VIVO Summary

**El `renameSync` destructivo de la rama PRESENT deja de ser incondicional: una sonda fresca de identidad (bytes crudos + `ino`) tomada justo antes del rename detecta al creador Case-1 que aterrizó en el hueco que abrió el `release` del holder vivo, y el stealer se retira con `reason: 'lock-replaced-mid-steal'` en vez de clobbearlo.**

## `phase_base_sha`

```
phase_base_sha: 120e5e9d8833cc96ef3c0456a7823b5dcecba122
```

**Aviso obligatorio: NO es `dcddc80`.** El plan advierte que si `phase_base_sha` difiere de `dcddc80` hay que **re-medir** los criterios antes de darlos por buenos. Se re-midieron los **once** valores de fuente y el conteo de tests contra `120e5e9d` **antes de la primera edición**, y **todos coinciden exactamente** con los que el plan atribuye a `dcddc80`:

| Criterio | Valor del plan (`dcddc80`) | Medido en `120e5e9d` | Clase |
|---|---|---|---|
| `# tests` de los tres ficheros de lock | 25 (6+15+4) | **25** · 0 fail | muerde |
| `grep -c 'Case-1 creator can race here'` | 1 | **1** | muerde |
| `grep -c 'guard fully serializes us'` | 1 | **1** | muerde |
| `grep -c 'rename swaps the inode atomically'` | 1 | **1** | anti-regresión |
| `grep -c 'lock-replaced-mid-steal'` | 0 | **0** | muerde |
| `grep -c 'attempt === 0'` | 0 | **0** | muerde |
| `grep -rln '_afterCriticalReadFn' src/` | sin coincidencias | **sin coincidencias** (rc=1) | muerde |
| `MAX_STEAL_ATTEMPTS = 8` (sin comentarios) | 1 | **1** | anti-regresión |
| `STEAL_GUARD_STALE_MS = 5_000` (sin comentarios) | 1 | **1** | anti-regresión |
| `grep -c 'mtimeMs'` | 3 | **3** | anti-regresión |
| `grep -c 'rmSync'` | 0 | **0** | anti-regresión |

`120e5e9d` es un commit de documentación de planning posterior a `dcddc80`; no toca `src/` ni `test/`, que es por lo que el baseline es idéntico. El plan `86-02` debe consumir **`120e5e9d8833cc96ef3c0456a7823b5dcecba122`** para su gate de consumidores intactos.

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-05T08:43:35Z
- **Completed:** 2026-08-05T08:55:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **La carrera de 2º orden de `82-REVIEW.md` §CR-01 está cerrada en el punto donde vive el defecto.** El CAS compara la identidad del `lockPath` (bytes crudos con `Buffer.equals` **y** `ino`) contra el baseline leído al entrar en la sección crítica, en la posición exacta que manda el precedente: tras escribir el `tmp` y justo antes del `renameSync`.
- **El desenlace del escenario es el correcto y es observable:** el creador Case-1 legítimo conserva su lock, el stealer tardío devuelve `{ acquired: false, holder, reason: 'lock-replaced-mid-steal' }` y emite un `[kodo:lock] Steal aborted: …` que interpola **solo** `task_ref`.
- **El interleaving de 5 pasos se reproduce de forma determinista in-process**, sin sleeps ni N iteraciones: los pasos 3 y 4 (release del holder vivo + create `O_EXCL` del creador) se disparan desde `deps._afterCriticalReadFn`, dentro de la propia sección crítica del stealer.
- **La premisa falsa se retiró nombrando el hecho real.** Donde el comentario afirmaba que ningún creador Case-1 podía correr ahí, ahora se lee que el steal-guard serializa **stealers, no creadores**, y que el `unlink` del holder abre precisamente el hueco donde el creador aterriza.
- **Cero coste para los consumidores:** `dispatcher.js`, `doctor.js`, `hooks/`, `polling.js`, `lifecycle.js`, `state-lock.js`, `package.json` y `package-lock.json` con `git diff --exit-code` a 0; los siete ficheros de test que consumen la superficie del lock pasan **sin una sola modificación**.
- **Suite completa: 2595 tests · 2594 pass · 0 fail · 1 skipped** (baseline del milestone: 2590 · 2589 · 0 · 1). Por encima del baseline, con el mismo único skip pre-existente.

## Task Commits

1. **Tarea 1 (movimientos 1-3): lector de una pasada, seam y typedef** — `1ee273d` (feat)
2. **Tarea 1 (movimiento 5): el caso in-process, RED** — `6b6bc8a` (test)
3. **Tarea 1 (movimiento 4): el CAS, GREEN** — `90d6ab7` (feat)
4. **Tarea 2: no-regresión del contrato** — `5083a5b` (test)

_La Tarea 1 es `type="tracer" tdd="true"`, de ahí los tres commits: el primero es andamiaje sin cambio de comportamiento (25/25 verdes), el segundo es el rojo verificado, el tercero lo pone verde._

## El paso RED — mensaje del assert que falló

El plan exige registrar el mensaje literal. Con los movimientos 1-3 aplicados (seam operativo) y **sin** el CAS, `node --test test/gsd-lock-guard.test.js` dio **10 tests · 8 pass · 2 fail**:

```
not ok 1 - (g) el steal ABORTA cuando el lock es reemplazado por un creador VIVO en plena sección crítica
  ---
  location: 'test/gsd-lock-guard.test.js:322:3'
  failureType: 'testCodeFailure'
  error: |-
    el stealer NO puede adquirir un lock que un creador Case-1 vivo publicó bajo sus pies: renombrar encima produce DOS OWNERS (82-REVIEW §CR-01)

    true !== false

  code: 'ERR_ASSERTION'
  expected: false
  actual: true
  operator: 'strictEqual'

not ok 2 - (h) tras el abort, el lock del creador sobrevive en disco y no queda residuo
  ---
  location: 'test/gsd-lock-guard.test.js:341:3'
  error: |-
    Expected values to be strictly equal:

    true !== false
```

**Lectura del rojo:** `actual: true` es literalmente el defecto. El stealer **adquirió** un lock que un creador vivo acababa de publicar bajo sus pies — los dos owners de CR-01, reproducidos de forma determinista y no probabilística. Los casos `(i)` (corrupto robable) y `(j)` (sin seam) pasaban ya en rojo: son anti-regresión y no acreditan trabajo.

Nota de alcance: esta es la **primera evidencia de mordida**, tomada sobre el andamiaje sin CAS. La mordida **canónica** de LOCK-06 —reversión manual del CAS sobre el HEAD final, con diff y salida roja citados— es del plan `86-02` (D-15).

## El espejo de `doctor.decideLock` — por qué el CAS no lo rompe

Comprobación de razonamiento con cita, exigida por la Tarea 2(c). **No se inventó ningún test para ella**, y `src/gsd/doctor.js` no se tocó.

`decideLock` (`src/gsd/doctor.js:240-258`) es un **predicado puro sobre un `LockContent`**: recibe un lock ya leído, `isPidAlive` y `nowMs`, y devuelve `'steal'` o `'keep'` según las mismas tres reglas que `acquireGsdLock` (PID muerto → `steal`; TTL vencido → `steal`; PID vivo + TTL ok → `keep`). Su JSDoc lo declara «espejo EXACTO de `acquireGsdLock` (D-13)», y ese espejo es sobre **la robabilidad de un lock**, no sobre el protocolo de publicación del stealer.

Sus dos call sites confirman el alcance: en `detectHungLocks` (`src/gsd/doctor.js:349`) la llamada es `decideLock(lock, d.isPidAlive, nowMs)` sobre el resultado de `d.readLock(projectPath)` — **un snapshot**, leído fuera de cualquier sección crítica y sin escribir nada; y en el carril `execute` (`:556`) el lock se **re-lee** (`lock = d.readLock(projectPath); // RE-read (D-06) — no snapshot`) antes de volver a decidir. En los dos casos la entrada es un `LockContent` parseado y la salida es una etiqueta.

El CAS **no cambia ninguna de esas tres reglas**: reutiliza `isStaleLock` (`src/gsd/lock.js:259-264`) tal cual para evaluar D-06, así que el predicado de robabilidad sigue siendo bit a bit el mismo en ambos lados. Lo que el CAS añade es qué hace el stealer **cuando el fichero cambió de identidad entre su lectura y su rename** — un estado que `decideLock` **nunca observa**, porque no participa en el steal, no toma el guard, no escribe y no ve más que un `LockContent` congelado. El campo `reason` nuevo tampoco le llega: `decideLock` produce su propio `reason` de diagnóstico (`PID N dead`, `TTL Nh exceeded`) y no consume el de `AcquireResult`. El espejo, por tanto, se conserva.

## Files Created/Modified

- `src/gsd/lock.js` — `readLockIdentity(path)` (lector de una pasada, vecino de `readLockContent`, que se conserva intacto); tercer parámetro `deps = {}` en `acquireGsdLock` propagado a los tres call sites de `stealLock`; `AcquireResult` con `reason?: string`; el CAS completo en la rama PRESENT; premisa falsa retirada.
- `test/gsd-lock-guard.test.js` — `describe` nuevo con 5 casos: `(g)` abort con `reason`, `(h)` estado de disco e higiene del abort, `(i)` corrupto robable con seam no-op, `(i2)` corrupto sustituido por corrupto → `continue` sin `reason`, `(j)` sin seam cero cambio de comportamiento.

## Decisions Made

- **El baseline es una sola pasada.** `readLockIdentity` sustituye al `readLockContent` de la sección crítica y sirve a la vez a la comprobación de frescura (`.content`) y al CAS (`.raw`/`.ino`). Los bytes salen de **la lectura**; el `ino`, de un `statSync` inmediatamente posterior que degrada a `null` sin invalidar el componente de bytes.
- **`Buffer` sin encoding, a propósito.** Leer con `'utf-8'` colapsaría bytes inválidos a U+FFFD y dos contenidos distintos compararían iguales (Pitfall 2). La degradación documentada en `store.js:685-690` no transfiere: allí se compara lectura contra `stat`; aquí, lectura contra lectura.
- **Bytes *y* `ino`, no solo `ino`.** La reutilización de inodo tras `unlink`+create —que es exactamente la secuencia de los pasos 3-4 del interleaving— cegaría a un detector que solo mirase el inodo.
- **`continue`, no `return`, cuando cambió sin holder vivo.** El path queda en uno de tres estados y el bucle ya sabe resolver los tres; un `return` trataría «ausente» como fallo cuando la rama ABSENT lo resolvería adquiriendo legítimamente.
- **Ningún umbral se movió.** `MAX_STEAL_ATTEMPTS` sigue en 8, `STEAL_GUARD_STALE_MS` en 5_000, y el epílogo de `:493-507` está intacto. El `continue` consume del presupuesto existente.

## Deviations from Plan

Ninguna desviación de comportamiento. Dos apuntes de ejecución, ambos declarados en vez de silenciados:

**1. `phase_base_sha` ≠ `dcddc80`.** Ver la sección `phase_base_sha` arriba. El plan prevé este caso y manda re-medir; se re-midió y los once valores coinciden, así que ningún criterio se dio por bueno sin comprobar.

**2. El criterio `grep -c 'mtimeMs' src/gsd/lock.js` = 3 mide el token, no la semántica.** Al documentar en el CAS **por qué** el tiempo de modificación queda fuera de la comparación (que es lo que D-04 pide que no se «complete» más tarde), el comentario mencionaba el identificador `mtimeMs` y el conteo subió a **4**, poniendo el criterio en rojo. El criterio declara su función explícitamente: «si el conteo sube de 3, el CAS lo introdujo». En este caso el CAS **no** lo introdujo en la comparación — lo nombraba en una frase que dice justo lo contrario. Se resolvió reformulando el comentario a «modification TIME stays OUT of the identity comparison on purpose (D-04)», conservando íntegra la documentación de la decisión y devolviendo el conteo a 3.

Esto **no es enmascaramiento** —no se debilitó ningún assert, umbral ni presupuesto (DEBT-04 intacto)— pero **sí es un hallazgo sobre el criterio**, y como tal se registra: un grep de token no puede distinguir «`mtimeMs` entró en la comparación» de «un comentario explica que `mtimeMs` no entra». El invariante real (el tiempo de modificación no participa en la identidad) se verifica leyendo el `const changed = …` de `src/gsd/lock.js:560-564`, donde solo aparecen `raw` e `ino`. **Recomendación para `86-02` y para el verifier:** el gate semántico correcto es acotar el grep al cuerpo del CAS o exigir que las tres apariciones vivan dentro de `guardIsStale`, no contar apariciones en todo el fichero.

---

**Total deviations:** 0 auto-fixes (ninguna Regla 1-4 disparada)
**Impact on plan:** Nulo. Los dos apuntes son de medición y de redacción, no de alcance.

## Issues Encountered

Ninguno. El CAS entró verde a la primera sobre los 25 casos previos y los 4 nuevos.

## Verificación (los 5 puntos del plan)

1. `node --test test/gsd-lock-guard.test.js test/gsd-lock.test.js test/gsd-lock-race.test.js` → **29 tests · 29 pass · 0 fail**. `# tests` **29 > 25**. ✅
2. `node --test test/gsd-concurrency.test.js test/dispatcher.test.js test/stop.test.js test/gsd-inspect-cli.test.js` → 0 fail, **sin haber modificado ninguno** (`git diff --exit-code` sobre los seis ficheros de test de consumidores → rc 0). Agregado de los siete ficheros: **136 tests · 136 pass · 0 fail**. ✅
3. Los greps de fuente devuelven los valores exactos: `Case-1 creator can race here` = **0**, `guard fully serializes us` = **0**, `rename swaps the inode atomically` = **1**, `lock-replaced-mid-steal` = **2** (≥ 1, literal), `attempt === 0` = **1**, `_afterCriticalReadFn` en `src/` = solo `src/gsd/lock.js`, `MAX_STEAL_ATTEMPTS = 8` = **1**, `STEAL_GUARD_STALE_MS = 5_000` = **1**, `mtimeMs` = **3**, `rmSync` = **0**. ✅
4. `git diff --exit-code -- src/triggers/dispatcher.js src/gsd/doctor.js src/hooks/ src/cli/polling.js src/daemon/lifecycle.js src/session/state-lock.js package.json package-lock.json` → **rc 0**. Cero dependencias npm nuevas. ✅
5. Este SUMMARY registra `phase_base_sha`, el mensaje del assert del paso RED y el párrafo del espejo de `decideLock` con sus tres citas. ✅

Suite completa: `npm test` → **2595 tests · 2594 pass · 0 fail · 1 skipped** (baseline 2590 · 2589 · 0 · 1).

## User Setup Required

Ninguno.

## Next Phase Readiness

Listo para `86-02`, que expande desde este tracer:

- **`phase_base_sha` disponible:** `120e5e9d8833cc96ef3c0456a7823b5dcecba122`. Es lo que el gate de consumidores intactos (criterio 5) necesita para ser comprobable.
- **El seam está puesto y probado:** `deps._afterCriticalReadFn` se dispara dentro de la sección crítica con guard `attempt === 0`. Los kinds `gsd-holder` / `gsd-seam` de `test/helpers/lock-race-child.mjs` lo consumen tal cual; el timeout de la barrera del stealer debe quedar **claramente por debajo** de `STEAL_GUARD_STALE_MS = 5_000`.
- **`reason` es observable por dos vías:** el valor de retorno y el `console.error` con prefijo `[kodo:lock]`. El marcador lateral `steal-reasons.log` del harness puede escribirse desde el hijo con el `reason` del retorno, sin depender de capturar stderr.
- **Pendiente de `86-02`, no de este plan:** la sección **Ventana residual** en el JSDoc de `stealLock` (D-17a) y su bullet en `.planning/STATE.md` §Critical Invariants (D-17b). El JSDoc de `stealLock` en su paso 2 sigue describiendo la sustitución in-place sin mencionar el CAS — **deliberadamente no se tocó** porque `86-02` reescribe ese bloque completo; si `86-02` no lo hace, esa incompletud queda como deuda de esta fase.
- **Sin blockers.**

## Self-Check: PASSED

- Ficheros: `src/gsd/lock.js`, `test/gsd-lock-guard.test.js`, `86-01-SUMMARY.md` — los tres existen en disco.
- Commits: `1ee273d`, `6b6bc8a`, `90d6ab7`, `5083a5b` — los cuatro existen en `git log`.
- Sin stubs: ningún placeholder, TODO ni valor vacío introducido en los dos ficheros de este plan.

---
*Phase: 86-cas-sim-trico-de-steallock-holder-vivo*
*Completed: 2026-08-05*
</content>
</invoke>
