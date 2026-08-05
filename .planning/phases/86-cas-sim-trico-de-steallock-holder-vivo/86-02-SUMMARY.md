---
phase: 86-cas-sim-trico-de-steallock-holder-vivo
plan: 02
subsystem: infra
tags: [concurrency, file-lock, compare-and-swap, toctou, real-process-race, honesty-as-deliverable]

requires:
  - phase: 86-01
    provides: CAS simétrico en la rama PRESENT de stealLock + seam deps._afterCriticalReadFn + reason 'lock-replaced-mid-steal'
  - phase: 83-inbox-foundation
    provides: molde del harness por etapas (waitUntil, liberación en dos tiempos, guard de cobertura) y plantilla de declaración honesta de ventana residual
provides:
  - "kind gsd-holder: holder stale-pero-VIVO (TTL vencido + PID vivo) que libera bajo barrera — la siembra que el repo no sabía hacer"
  - "kind gsd-seam: stealer que se aparca DENTRO de la sección crítica por barrera, no por anchura de ventana"
  - "--release / --resume / --hold-until: flags de argv aditivas del harness compartido"
  - "raceGsdStealLiveHolder(extraStealers): orquestación de TRES tiempos con un go-file por etapa"
  - "assertCasExercised: guard de cobertura anti-degradación silenciosa de la rama del CAS"
  - "Sección Ventana residual en el JSDoc de stealLock + bullet en STATE.md §Critical Invariants (D-17)"
affects: [LOCK-05, LOCK-06, LOCK-07, verificación de fase 86, LOCK-F1 (v2)]

actuals:
  tokens: 8800
  tasks: 3
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Harness de TRES roles con liberación en TRES tiempos: el creador Case-1 no puede arrancar antes del release del holder, o el CAS no se ejercita jamás y el test queda verde-sin-medir"
    - "Seam determinista POR BARRERA en vez de por anchura de ventana calibrada — posible porque el padre observa en disco el desaparecer/reaparecer del lock"
    - "Guard de cobertura por marcador lateral (assertCasExercised), molde literal de assertFailopenExercised de 83-06"

key-files:
  created: []
  modified:
    - test/helpers/lock-race-child.mjs
    - test/gsd-lock-race.test.js
    - src/gsd/lock.js
    - .planning/STATE.md

key-decisions:
  - "86-02: el holder se siembra desde un hijo DEDICADO con pid: process.pid — un holder muerto no puede LIBERAR, y sin ese unlink la carrera de 2º orden es invisible (D-12)"
  - "86-02: el seam espera una BARRERA, no un sleepSync calibrado — el escenario deja de depender de cualquier presupuesto de tiempo (D-16/DEBT-04)"
  - "86-02: los stealers extra se sueltan SOLO tras observar stealer-parked; soltarlos antes permitiría que uno ganase el guard en su intento 0 y el seam no se dispararía jamás"
  - "86-02: la identidad en disco se asevera en N=3 (roles asimétricos por construcción) y NO en N=5 (con extras sueltos, quién ocupa el hueco lo decide el scheduler) — D-14"
  - "86-02: el JSDoc de stealLock se corrige ADEMÁS de ampliarse: su paso 2 describía la sustitución in-place incondicional y no mencionaba el CAS (deuda que 86-01 dejó explícitamente a este plan)"
  - "86-02: el criterio grep -c 'waitUntil' >= 8 es aritméticamente inconsistente con la propia secuencia de 12 pasos del plan, que solo prescribe 5 esperas; se declara en vez de rellenar el fichero con llamadas de adorno"

patterns-established:
  - "Orquestación de tres tiempos: holder-seeded → go-stealer → stealer-parked → go-extras → go-release → (el session_id en disco deja de ser el del holder) → go-creator → (lock no-holder presente) → go-resume → steal-reasons.log → go-teardown. Cada flecha es un waitUntil sobre estado de disco"
  - "Declaración honesta en DOS sitios (código + STATE.md) con los cuatro elementos: qué es · clase de riesgo nombrada · qué cambia de verdad · nunca cierre por construcción"

requirements-completed: [LOCK-05, LOCK-06, LOCK-07]

coverage:
  - id: D8
    description: "El harness siembra un holder stale-pero-VIVO (TTL vencido + PID vivo del propio hijo) y demuestra cardinalidad exacta con un release concurrente, con N=3 (LOCK-05 a/b)"
    requirement: LOCK-05
    verification:
      - kind: integration
        ref: "test/gsd-lock-race.test.js#N=3 (holder vivo + creador Case-1 + stealer aparcado) → exactamente uno adquiere"
        status: pass
    human_judgment: false
  - id: D9
    description: "La cardinalidad se mantiene en uno con dos stealers extra en presión real (N=5), sin aseverar identidad del superviviente (LOCK-05 b, D-14)"
    requirement: LOCK-05
    verification:
      - kind: integration
        ref: "test/gsd-lock-race.test.js#N=5 (dos stealers extra en presión real) → exactamente uno adquiere"
        status: pass
    human_judgment: false
  - id: D10
    description: "El escenario PRUEBA que ejerció la rama del CAS: assertCasExercised exige >= 1 marcador lock-replaced-mid-steal por iteración y falla con mensaje propio (LOCK-05 c)"
    requirement: LOCK-05
    verification:
      - kind: integration
        ref: "test/gsd-lock-race.test.js#assertCasExercised — invocado en los dos casos"
        status: pass
    human_judgment: false
  - id: D11
    description: "El holder demuestra que liberó de verdad: su veredicto es `written`, nunca `acquired`, de modo que el conteo de cardinalidad sobre el agregado sigue siendo seguro (Pitfall 9)"
    requirement: LOCK-05
    verification:
      - kind: integration
        ref: "test/gsd-lock-race.test.js — assert.equal(r.holderVerdict, 'written') en los dos casos"
        status: pass
      - kind: other
        ref: "grep -c 'process.stdout.write' test/helpers/lock-race-child.mjs = 9 (7 + uno por kind nuevo)"
        status: pass
    human_judgment: false
  - id: D12
    description: "Revertir a mano el CAS pone el harness ROJO, y la evidencia queda registrada con diff, salida roja y salida verde restaurada (LOCK-06)"
    requirement: LOCK-06
    verification:
      - kind: manual
        ref: "§La mordida canónica de este SUMMARY — diff citado, `# fail 2` con el mensaje del assert, verde tras restaurar"
        status: pass
    human_judgment: true
  - id: D13
    description: "Ningún umbral se debilitó para greenear: MAX_STEAL_ATTEMPTS sigue en 8 y STEAL_GUARD_STALE_MS en 5_000 tras la mordida (LOCK-06 b, DEBT-04)"
    requirement: LOCK-06
    verification:
      - kind: other
        ref: "grep sin comentarios: 'MAX_STEAL_ATTEMPTS = 8' = 1 · 'STEAL_GUARD_STALE_MS = 5_000' = 1 · git status --porcelain -- src/gsd/lock.js vacío"
        status: pass
    human_judgment: false
  - id: D14
    description: "La ventana residual está declarada en el JSDoc de stealLock con su clase de riesgo nombrada y sin presentarla como cierre por construcción (LOCK-07 a, D-17)"
    requirement: LOCK-07
    verification:
      - kind: other
        ref: "grep -c 'TOCTOU residual' src/gsd/lock.js = 1 · grep -c 'Phase 83' src/gsd/lock.js = 1"
        status: pass
      - kind: manual
        ref: "§Revisión de honestidad de este SUMMARY — los cuatro elementos de D-17, uno por uno"
        status: pass
    human_judgment: true
  - id: D15
    description: "La ventana residual está declarada también en .planning/STATE.md §Critical Invariants, junto al invariante del lock del inbox (LOCK-07 b)"
    requirement: LOCK-07
    verification:
      - kind: other
        ref: "grep -c 'ventana residual' .planning/STATE.md = 1 · state.validate → valid: true, warnings: [], drift: {}"
        status: pass
    human_judgment: false
  - id: D16
    description: "Los consumidores del lock no cambiaron (criterio 5) y no entró ninguna dependencia npm"
    requirement: LOCK-07
    verification:
      - kind: other
        ref: "git diff --name-only 120e5e9d..HEAD -- src/ test/ lista exactamente los 4 ficheros de la fase; los 6 consumidores prohibidos y package*.json no aparecen"
        status: pass
    human_judgment: false

duration: 11min
completed: 2026-08-05
status: complete
---

# Phase 86 Plan 02: Harness de holder VIVO + honestidad como entregable — Summary

**La carrera de segundo orden pasa de estar cerrada en el código a estar DEMOSTRADA con procesos reales: un holder stale-pero-VIVO libera el lock mientras un stealer está aparcado dentro de su sección crítica, un creador Case-1 aterriza en el hueco, y exactamente un proceso adquiere — con la reversión manual del CAS puesta, adquieren dos (N=3) y tres (N=5).**

## Performance

- **Duration:** 11 min
- **Started:** 2026-08-05T08:55:01Z
- **Completed:** 2026-08-05T09:06:05Z
- **Tasks:** 3
- **Files modified:** 4

## Task Commits

1. **Tarea 1: harness de holder VIVO — dos roles nuevos y la orquestación de tres tiempos (N=3)** — `de92aba` (test)
2. **Tarea 2: caso N=5 — presión de dos stealers extra sin degradar el escenario** — `8babb2c` (test)
3. **Tarea 3 (a+b): ventana residual declarada en el JSDoc y en STATE.md** — `2043d63` (docs)

_La Tarea 3 (c) —la mordida— y (d) —el cierre de fase— no producen ficheros: la reversión se revierte, y su producto es la evidencia citada abajo._

---

## La mordida canónica (LOCK-06 / D-15) — manual, con evidencia citada

Ejecutada sobre el HEAD final de la fase (`2043d63`), a mano y sin construir nada.
**Prohibido y no hecho:** infraestructura de mutation testing; tocar un solo assert, timeout o presupuesto.

### (a) El diff exacto de la reversión

El cambio más pequeño que desactiva el CAS — neutralizar el cálculo de `changed` para que el `renameSync` vuelva a ser incondicional:

```diff
diff --git a/src/gsd/lock.js b/src/gsd/lock.js
index 649ec63..573fc4d 100644
--- a/src/gsd/lock.js
+++ b/src/gsd/lock.js
@@ -604,11 +604,7 @@ function stealLock(lockPath, sessionInfo, reason, deps = {}) {
           // Modification TIME stays OUT of the identity comparison on purpose
           // (D-04): it is redundant against a full byte compare, and a bare `touch`
           // would produce spurious aborts. Do not "complete" this later.
-          const changed =
-            fresh.raw === null || base.raw === null
-              ? true // conservador: si no se puede comprobar, NO se publica
-              : !fresh.raw.equals(base.raw) ||
-                (base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino);
+          const changed = false;

           if (!changed) {
             renameSync(tmp, lockPath);
```

### (b) La salida ROJA del runner, con el mensaje del assert

`node --test test/gsd-lock-race.test.js` → **`# tests 6 · # pass 4 · # fail 2`**:

```
not ok 1 - N=3 (holder vivo + creador Case-1 + stealer aparcado) → exactamente uno adquiere
  ---
  location: '/Users/alex/dev/klab/kodo/test/gsd-lock-race.test.js:370:3'
  failureType: 'testCodeFailure'
  error: |-
    exactamente un proceso debe adquirir; verdicts=[written,acquired,acquired] reasons=[no-reason] finalSession=sess-54946 parkedMs=12 stages={"seeded":true,"parked":true,"released":true,"creatorLanded":true,"reasons":true}

    2 !== 1

  code: 'ERR_ASSERTION'
  expected: 1
  actual: 2
  operator: 'strictEqual'

not ok 2 - N=5 (dos stealers extra en presión real) → exactamente uno adquiere
  ---
  error: |-
    exactamente un proceso debe adquirir; verdicts=[written,acquired,acquired,acquired,blocked] reasons=[no-reason] finalSession=sess-54953 parkedMs=6 stages={"seeded":true,"parked":true,"released":true,"creatorLanded":true,"reasons":true}

    3 !== 1

  expected: 1
  actual: 3
```

**Lectura del rojo.** `verdicts=[written,acquired,acquired]` es literalmente el defecto: el stealer renombró encima del lock que el creador Case-1 acababa de publicar bajo sus pies, y **los dos se creen dueños**. Es la aserción canónica de D-14 —cardinalidad sobre el agregado— y muerde en los dos casos. Nótese además `stages` todo en `true`: el escenario **ocurrió entero** (el holder sembró, el stealer se aparcó, el release pasó, el creador aterrizó); lo que falló es el invariante, no la orquestación. Eso es lo que distingue una mordida de un harness roto.

Y el mismo commit revertido pone rojo el caso in-process de `86-01` — `node --test test/gsd-lock-guard.test.js` → **`# tests 11 · # pass 9 · # fail 2`**:

```
not ok 1 - (g) el steal ABORTA cuando el lock es reemplazado por un creador VIVO en plena sección crítica
  error: |-
    el stealer NO puede adquirir un lock que un creador Case-1 vivo publicó bajo sus pies:
    renombrar encima produce DOS OWNERS (82-REVIEW §CR-01)
not ok 2 - (h) tras el abort, el lock del creador sobrevive en disco y no queda residuo
```

### (c) La salida VERDE tras restaurar

`git checkout -- src/gsd/lock.js`, y después:

```
$ git status --porcelain -- src/gsd/lock.js
(vacío — la reversión no queda en el árbol de trabajo)

$ node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js
# tests 17
# pass 17
# fail 0
```

Umbrales intactos tras restaurar: `MAX_STEAL_ATTEMPTS = 8` → **1** · `STEAL_GUARD_STALE_MS = 5_000` → **1** (grep sin comentarios). Ningún assert, timeout ni presupuesto se tocó durante la mordida.

### (d) Conteos de suite antes y después

| Momento | `# tests` | `# pass` | `# fail` | `# skipped` |
|---|---|---|---|---|
| Baseline del milestone (`120e5e9d` / `dcddc80`) | 2590 | 2589 | 0 | 1 |
| Tras `86-01` | 2595 | 2594 | 0 | 1 |
| **Tras `86-02` (final)** | **2597** | **2596** | **0** | **1** |

El umbral que muerde era `# tests` ≥ **2591**: cumplido con **2597**. El único `skipped` es el pre-existente.

### Un matiz declarado, no maquillado

El plan anticipaba **dos rojos independientes** en el caso del holder vivo: la cardinalidad (`acquired === 2`) y `assertCasExercised` sin marcador. En la práctica **solo se materializa el primero**, porque la aserción de cardinalidad va antes en el `it` y corta la ejecución. No es que el guard de cobertura no mordiera: su insumo aparece en el propio contexto del fallo —`reasons=[no-reason]`, es decir el stealer adquirió en vez de abortar y nunca escribió `lock-replaced-mid-steal`—, que es exactamente aquello sobre lo que `assertCasExercised` habría fallado. Se registra así en vez de afirmar dos rojos que el runner no llegó a emitir. La canónica por D-14 es, en cualquier caso, la de cardinalidad.

---

## Revisión de honestidad de la ventana residual (D-17, backstop manual)

Un grep verifica presencia, no honestidad. Los cuatro elementos, localizados uno por uno en el texto que se escribió:

| Elemento de D-17 | Dónde está | Qué dice |
|---|---|---|
| **1. Qué es** | JSDoc §Ventana residual · STATE.md | «Entre la sonda de identidad FRESCA y el `renameSync` que publica quedan **dos syscalls contiguos**. Un creador Case-1 que aterrice justo en ese hueco […] sigue siendo clobbeable» |
| **2. Clase de riesgo, NOMBRADA** | JSDoc · STATE.md | «Es un **TOCTOU residual**, y no es cerrable sin soporte atómico del sistema de ficheros […] Es **la misma clase** de ventana que el guard del inbox de la **Phase 83** acepta y declara» |
| **3. Qué cambia de verdad** | JSDoc · STATE.md | «La MAGNITUD, no la existencia. […] deja de depender de ningún presupuesto de tiempo: ni ampliando `MAX_STEAL_ATTEMPTS` ni tocando `STEAL_GUARD_STALE_MS` se mueve un milímetro» |
| **4. Nunca cierre por construcción** | JSDoc · STATE.md | «NO es cierre por construcción, y no debe leerse como si lo fuera. El cierre por construcción está registrado como `LOCK-F1` y diferido a v2 […] Quien lea este bloque buscando la garantía de que dos procesos no pueden creerse dueños a la vez: esa garantía no está aquí» |

Más una línea —no una defensa— para el residual del residual (Pitfall 1): contenido byte-idéntico **con** reutilización de inodo, que implicaría el mismo `session_id` y el mismo `acquired_at` al milisegundo entre dos procesos distintos, con lo que el clobber sería semánticamente un no-op.

**Ninguna frase del texto afirma que la carrera quede cerrada.** Se revisó específicamente la cabecera del JSDoc, que decía «closing the double-acquire race by construction»: se acotó a «closing the **FIRST-order** double-acquire race — stealer against stealer — by construction», con remisión explícita a la sección nueva para el segundo orden. Sin ese acote, la cabecera y la sección se contradecían.

---

## El tiempo real de aparcamiento (A1 / Pitfall 8)

Medido instrumentando temporalmente el delta entre observar el marcador `stealer-parked` y escribir el go-file `go-resume` — el intervalo exacto durante el cual el stealer **retiene el steal-guard**:

| Caso | Corridas | Aparcamiento medido |
|---|---|---|
| N=3 | 3 | **10 ms · 9 ms · 9 ms** |
| N=5 | 3 | **5 ms · 6 ms · 6 ms** |

Contra `STEAL_GUARD_STALE_MS = 5_000` eso es un margen de **~500×**, y contra el techo de 3.000 ms del `waitForBarrier` del seam, de ~300×. El supuesto A1 queda holgadamente satisfecho: ningún stealer extra puede romper el guard por edad, y el escenario **no degrada** a medir la carrera de primer orden que la Phase 82 cerró. La instrumentación se retiró (`grep -c 'MEDIDA' test/gsd-lock-race.test.js` = 0).

---

## El gate de consumidores intactos (criterio 5)

Usando el `phase_base_sha` que `86-01-SUMMARY.md` registró — **`120e5e9d8833cc96ef3c0456a7823b5dcecba122`**, no `dcddc80`:

```
$ git diff --name-only 120e5e9d..HEAD -- src/ test/
src/gsd/lock.js
test/gsd-lock-guard.test.js
test/gsd-lock-race.test.js
test/helpers/lock-race-child.mjs
```

Exactamente los cuatro ficheros esperados. Y:

- `git diff --name-only 120e5e9d..HEAD -- src/triggers/dispatcher.js src/gsd/doctor.js src/hooks/ src/cli/polling.js src/daemon/lifecycle.js src/session/state-lock.js` → **vacío**. Ninguno de los seis consumidores prohibidos.
- `git diff --name-only 120e5e9d..HEAD -- package.json package-lock.json` → **vacío**. Cero dependencias npm nuevas.
- Los **seis consumidores del harness compartido** (`state-lock-concurrency`, `state-writers-concurrency`, `polling-start-race`, `dispatcher-dedup-crossproc`, `handoff-concurrency`, `inbox-concurrency`) corren **18 tests · 18 pass · 0 fail** sin una sola modificación: `--hold-until` es aditiva y `--hold` conserva su comportamiento idéntico.

---

## Accomplishments

- **El sesgo dead-PID deja de ser la única forma de sembrar un lock robable.** El kind `gsd-holder` escribe el lock con `pid: process.pid` y `acquired_at` retrodatado 5 h sobre `ttl_hours: 4` — el Case-3 literal de `acquireGsdLock` — y **libera de verdad** bajo barrera. Un holder muerto no puede llamar a `releaseGsdLock`, y sin ese `unlink` el hueco donde aterriza el creador Case-1 no existe: por eso esta carrera era invisible.
- **El interleaving de cinco pasos se reproduce con procesos reales y de forma determinista**, con un go-file por etapa y `waitUntil` sobre estado de disco en las cinco transiciones. Cero esperas de duración fija en el fichero (`grep -c 'sleepSync'` = 0).
- **El seam espera una BARRERA, no una anchura calibrada.** A diferencia del precedente del inbox —que necesita un `OVER_BUDGET_WINDOW_MS = 1500` con un «⚠ ESTE VALOR NO SE BAJA»—, aquí el padre observa en disco que el lock desaparece y reaparece, así que el interleaving es determinista *por construcción* y no depende de ningún presupuesto de tiempo. Esa es exactamente la propiedad que DEBT-04 premia.
- **La cobertura del CAS es demostrable, no supuesta.** `assertCasExercised` exige ≥ 1 marcador `lock-replaced-mid-steal` en `steal-reasons.log` por iteración y falla con un mensaje que nombra la reacción correcta (revisar la secuenciación de los tres tiempos) y las prohibidas (borrar la aserción, subir un umbral).
- **La honestidad quedó como entregable verificable**: mordida citada con diff y salida roja, ventana residual declarada en los dos sitios con su clase de riesgo nombrada, y la cabecera del JSDoc acotada para que no prometa más de lo que el código sostiene.

## Files Created/Modified

- `test/helpers/lock-race-child.mjs` — kinds `gsd-holder` y `gsd-seam`; flags `--release`, `--resume` y `--hold-until`; constante `HOLDER_SESSION_ID`; párrafos de cabecera por kind y entradas de `argv`. Los ocho kinds existentes y sus seis consumidores **sin tocar**.
- `test/gsd-lock-race.test.js` — `waitUntil` (copiado con su línea de procedencia), `readLockSession`, `readStealReasons`, `assertCasExercised`, `raceGsdStealLiveHolder(extraStealers)` y el `describe` nuevo **al final** con los casos N=3 y N=5, más el bloque de regla de reacción ante un rojo. Los 4 casos previos y `raceGsdChildren`/`raceGsdStealDeadHolder` **no aparecen modificados en el diff**.
- `src/gsd/lock.js` — sección **Ventana residual** en el JSDoc de `stealLock`; paso 2 reescrito para describir el CAS (deuda que `86-01` dejó explícitamente a este plan); cabecera acotada al primer orden. **Solo JSDoc: cero cambio de comportamiento.**
- `.planning/STATE.md` — bullet de la ventana residual en §Critical Invariants (cross-milestone), inmediatamente después del del lock del inbox. Editado en quirúrgico; `state.validate` → `valid: true`, `warnings: []`, `drift: {}`.

## Decisions Made

- **Exactamente UN stealer lleva el seam, también en N=5.** Que varios se aparquen a la vez es imposible por construcción (el steal-guard los serializa) y multiplicaría el riesgo de acercar el aparcamiento al umbral de edad del guard.
- **Los extras se sueltan SOLO tras observar `stealer-parked`.** Si se soltasen junto al stealer con seam, uno podría ganar el guard en su intento 0, robar legítimamente el lock del holder, y entonces el stealer con seam no entraría en la sección crítica en su intento 0 — **el seam no se dispararía jamás**.
- **La identidad en disco se asevera en N=3 y no en N=5.** En N=3 los roles son asimétricos *por construcción* (el stealer está aparcado en una barrera que controla el padre y no hay ningún otro contendiente suelto), así que el superviviente es determinista y no una coincidencia del scheduler; el comentario que lo justifica está en el fichero, o un revisor futuro lo leería como una infracción de D-14 y lo borraría. En N=5 deja de serlo — y está **medido**, ver la desviación 2.
- **El paso 2 del JSDoc se corrigió, no solo se amplió.** `86-01` lo dejó describiendo la sustitución in-place incondicional a propósito, con la advertencia de que si `86-02` no lo tocaba quedaba como deuda. Añadir solo la subsección nueva habría dejado un JSDoc cuyo cuerpo contradice su propia subsección — la clase de defecto que LOCK-07 y D-18 existen para eliminar.

## Deviations from Plan

Cero desviaciones de comportamiento y cero auto-fixes (ninguna Regla 1-4 disparada). Tres apuntes, los tres declarados en vez de silenciados:

**1. El criterio `grep -c 'waitUntil' test/gsd-lock-race.test.js` ≥ 8 es aritméticamente inconsistente con el propio plan. Valor real: 7.**

El criterio está bien etiquetado como **muerde** (HEAD: 0 → ahora 7) y su intención se cumple entera: **las cinco transiciones de etapa esperan sobre estado de disco** y el fichero no contiene una sola espera de duración fija (`sleepSync` = 0). Lo que no cuadra es el umbral. La secuencia de 12 pasos que el propio plan prescribe solo pide `waitUntil` en los pasos (1), (3), (6), (8) y (10) — **cinco llamadas**. Con la declaración de la función y la mención en el JSDoc de `raceGsdStealLiveHolder`, el total posible sin adornos es **7**:

| Línea | Aparición |
|---|---|
| 192 | declaración `async function waitUntil(pred, timeoutMs)` |
| 271 | mención en el JSDoc de la orquestación |
| 319 | espera de `holder-seeded` |
| 324 | espera de `stealer-parked` |
| 337 | espera de que el `session_id` en disco deje de ser el del holder |
| 341 | espera de que aterrice un lock no-holder |
| 350 | espera de `steal-reasons.log` |

Llegar a 8 exigiría **añadir una llamada que ninguna etapa necesita**, es decir rellenar el fichero para satisfacer un grep. Eso es la misma clase de defecto que `86-01` documentó con `mtimeMs` (un gate de token no puede medir la semántica que dice medir) y se resuelve igual: **se declara y no se maquilla**. Ningún assert, umbral ni presupuesto se tocó. **Recomendación para el verifier:** el gate semántico correcto es «cero esperas de duración fija en el fichero **y** una `waitUntil` por transición de etapa», no un conteo absoluto.

**2. En N=5 el hueco lo gana un stealer extra, no el creador — en las tres corridas medidas.** Instrumentando temporalmente el caso: `verdicts=[written,blocked,blocked,acquired,blocked]` y variantes, con `finalSession` distinto de `creatorSession` en 3 de 3. No es un defecto: es el comportamiento correcto del `O_EXCL` sobre un path ausente, la cardinalidad se mantiene en 1 (el creador sale `blocked` contra un holder vivo y fresco que espera el teardown por `--hold-until`) y el CAS sigue mordiendo igual porque el nuevo holder es vivo y fresco en ambos desenlaces. Es la **confirmación empírica** de por qué el plan prohíbe aseverar identidad en este caso, y se registra por eso.

**3. La mordida produce un rojo, no dos.** Ver «Un matiz declarado, no maquillado» arriba.

---

**Total deviations:** 0 auto-fixes · **Impact on plan:** nulo. Los tres apuntes son de medición y de calibración de criterio, no de alcance.

## Issues Encountered

Ninguno. Los dos casos entraron verdes a la primera y las tres corridas consecutivas de comprobación de flakiness salieron verdes (`# tests 6 · # pass 6 · # fail 0`, ×3).

## Verificación (los 6 puntos del plan)

1. `node --test test/gsd-lock-race.test.js` → **6 casos · 0 fail** (4 en HEAD + 2 de la fase), **tres corridas consecutivas verdes**. ✅
2. `npm test` → **`# tests 2597` · `# pass 2596` · `# fail 0` · `# skipped 1`**. Umbral `≥ 2591` superado. ✅
3. Gates de fuente. **Muerden y se cumplen:** `TOCTOU residual` = 1 · `Phase 83` = 1 (en `src/gsd/lock.js`) · `ventana residual` = 1 (en `STATE.md`) · `pid: process.pid` = 1 (helper, sin comentarios) · `gsd-holder` = 8 y `gsd-seam` = 7 (≥ 2) · `process.stdout.write` = **9** exactos · `lock-replaced-mid-steal` = 1 · `waitUntil` = **7** (declarado, ver desviación 1). **Anti-regresión, intactos:** `DEAD_PID` = 0 · `sleepSync` = 0 · `9999` = 1 · `MAX_STEAL_ATTEMPTS = 8` = 1 · `STEAL_GUARD_STALE_MS = 5_000` = 1. ✅
4. `state.validate` → `{ valid: true, warnings: [], drift: {} }`. ✅
5. Gate de consumidores: los cuatro ficheros exactos, cero de los seis prohibidos, cero `package*.json`. ✅
6. Manual-only con evidencia citada: la mordida (§ arriba, con diff, `# fail 2`, mensaje del assert y verde restaurado) y la revisión de honestidad contra los cuatro elementos de D-17 (§ arriba, tabla). ✅

## User Setup Required

Ninguno.

## Next Phase Readiness

La fase 86 queda cerrada en sus cuatro requisitos (LOCK-04 por `86-01`; LOCK-05/06/07 por este plan). Sin blockers.

- **Deuda registrada, no ocultada:** `LOCK-F1` (cierre por construcción de la ventana residual) sigue diferido a v2 con su trigger propio, y ahora está declarado en el código y en `STATE.md` para que quien lo lea no asuma lo contrario.
- **Aviso para el verifier de la fase:** el gate `waitUntil ≥ 8` está mal calibrado (desviación 1). El invariante que ese gate quiere proteger sí se cumple y es comprobable por otra vía.
- **Nota de método transferible a la Phase 87:** la mordida manual con evidencia citada costó ~3 minutos y produjo dos rojos independientes en dos ficheros distintos. Es más barata que la infraestructura que la automatizaría, y ésa es la razón de D-15.

## Self-Check: PASSED

- **Ficheros:** `test/helpers/lock-race-child.mjs`, `test/gsd-lock-race.test.js`, `src/gsd/lock.js`, `.planning/STATE.md` y este `86-02-SUMMARY.md` — los cinco existen en disco.
- **Commits:** `de92aba`, `8babb2c`, `2043d63` — los tres existen en `git log`.
- **Sin stubs:** ningún placeholder, TODO, FIXME ni valor vacío introducido. La única instrumentación temporal (medición del aparcamiento y de la composición de N=5) se retiró y está verificada a 0 coincidencias.

---
*Phase: 86-cas-sim-trico-de-steallock-holder-vivo*
*Completed: 2026-08-05*
