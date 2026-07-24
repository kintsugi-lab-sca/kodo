# Debug: flaky `gsd-lock-race` «concurrent dead-holder steal» (CR-01) — doble adquisición real en el CAS steal

**Fecha:** 2026-07-24
**Gap:** DEBT-04 (v0.18 Phase 81) — flaky preexistente de v0.16 Phase 70 (CONC-02), diferido como deuda hasta este diagnóstico.
**Metodología:** `/gsd-debug` ejecutado inline. Repro bajo carga (loops cold del fichero + suite completa en paralelo) + experimento instrumentado que replica el harness `raceGsdStealDeadHolder(5)` importando una **copia instrumentada** de `src/gsd/lock.js` (en scratchpad, con marcadores de rama en cada paso del CAS). **`src/gsd/lock.js` de producción NUNCA se tocó** (`git diff --quiet` verde en todo momento). Toda la evidencia es reproducida, no inferida.

## Síntoma

`test/gsd-lock-race.test.js:142` — `describe('gsd lock steal race — concurrent dead-holder steal (CR-01)')`, caso `:153` (5 procesos) — falla de forma no determinista con **exactamente 2 `acquired`** en lugar de 1:

```
not ok 2 - 5 processes observing the SAME dead-PID stale lock → exactly one steals
    exactly one process must steal a shared dead-PID lock; got: acquired,blocked,blocked,acquired,blocked
```

El invariante v0.16 asevera «exactamente uno de N stealers concurrentes adquiere». El test lo viola bajo carga: **dos procesos reciben ambos `{ acquired: true }`** para el mismo repo.

## Evidencia (verificada, no inferida)

**Condiciones:** Node v22.22.3 · macOS Darwin 25.5.0 · 12 cores · load avg ~5–8 durante las corridas.

### 1. Repro tasa alta en loop aislado (cold, sobre máquina ya cargada)

- Loop de 50x el fichero (`node --test test/gsd-lock-race.test.js`): **13/50 fallaron** (primer batch); un segundo batch de 40: **19/40 fallaron (~48%)**.
- **El 100% de los fallos son en el caso N=5**; **cero fallos en cualquier caso N=2** (18/19 en `raceGsdStealDeadHolder` :153, 1/19 en el `raceGsdChildren` :131).
- **Todos los fallos son exactamente 2 `acquired`** (nunca 3+). El invariante se estresa solo con N≥2 concurrentes; con N=2 la ventana rara vez solapa (0 fallos observados).

### 2. La causa NO es hold-expiry/spawn-jitter (harness) — es una ventana de carrera real

Experimento instrumentado (réplica de `raceGsdStealDeadHolder(5)`, 20–25 iters por hold), midiendo por hijo: `attemptDelayMs` (latencia spawn→barrier), el estado del lock al empezar (`preState`/`preAlive`), y la **rama del CAS** que tomó:

| `--hold` | iters con doble-adquisición | interpretación |
|----------|-----------------------------|----------------|
| 100 ms   | 13/20 (65%)                 | — |
| 500 ms (default del harness) | 10–12 / 20–25 (~48%) | — |
| 3000 ms (6×) | 8/20 (40%) | **NO baja a ~0** |

Si la causa fuera el ganador saliendo antes de que un rezagado evalúe (hold-expiry), subir el hold 6× llevaría los fallos a ~0. **Se mantienen altos.** Además `attemptDelayMs` es uniformemente ~25–38 ms para los 5 hijos (jitter minúsculo, muy por debajo del hold de 500 ms), y **ambos ganadores observan `preAlive=false` (el dead-PID pre-sembrado) al arrancar, simultáneamente** — los dos están vivos durante su intento. Descarta el timing del harness para CR-01.

### 3. Traza del CAS: dos O_EXCL-create independientes ganan a la vez

Marcadores de rama en la copia instrumentada. En cada iteración con doble-adquisición, los DOS ganadores son alguna combinación de `{FRESH_CREATE_WON, STEAL_CREATE_WON, FALLBACK_CREATE_WON}` — es decir, **dos procesos distintos ejecutaron `writeFileSync(lockPath, {flag:'wx'})` (O_EXCL) y AMBOS tuvieron éxito**. Ejemplo canónico (iter con dos creates frescos):

```
pid=5365 acquired  trace=[FRESH_CREATE_WON]
pid=5366 acquired  trace=[FRESH_CREATE_WON]
pid=5364 blocked   trace=[MOVEASIDE_WON.a0 EEXIST_REJECT_LIVE.a0]
pid=5367 blocked   trace=[MOVEASIDE_WON.a0 ABA_RESTORE_REJECT.a0]
pid=5368 blocked   trace=[ENOENT_RECONTEND.a0 ... ENOENT_REJECT_LIVE.a5]
```

Dos O_EXCL-create sobre la **misma ruta** solo pueden tener éxito ambos si el fichero fue **eliminado entre los dos creates**. El único que elimina `lockPath` es el paso 1 de `stealLock`: `renameSync(lockPath, aside)` (move-aside). Los `MOVEASIDE_WON` de los otros hijos son quienes abren esas ventanas.

## Root Cause

**Carrera de producto en `stealLock` (`src/gsd/lock.js:283-351`): la secuencia move-aside → O_EXCL-create NO es atómica, y abre una «ventana briefly-empty» en `lockPath` que un create concurrente puede ganar. Con N≥2 procesos robando el MISMO lock stale/muerto a la vez, dos ventanas de move-aside solapadas dejan que dos creadores O_EXCL independientes ganen ambos → dos procesos reciben `{ acquired: true }`.**

Interleaving mínimo que produce dos ganadores (probado por la traza «dos `FRESH_CREATE_WON`»):

1. Estado inicial: `lockPath` = L0 (dead, pid 99999999).
2. Stealer A: `renameSync(lockPath → asideA)` ⇒ **`lockPath` VACÍO** (ventana 1). `asideA` = L0.
3. F1 (`acquireGsdLock` top, Caso 1): `writeFileSync(lockPath, {wx})` ⇒ **éxito** (vacío) ⇒ `lockPath` = F1-live. **F1 → `acquired: true` (`FRESH_CREATE_WON`).**
4. Stealer B: `renameSync(lockPath → asideB)` ⇒ éxito ⇒ **`lockPath` VACÍO otra vez** (ventana 2). `asideB` = F1-live (¡lock vivo movido a un lado!).
5. F2: `writeFileSync(lockPath, {wx})` ⇒ **éxito** (vacío) ⇒ `lockPath` = F2-live. **F2 → `acquired: true` (`FRESH_CREATE_WON`).**
   → **F1 y F2 ya devolvieron ambos `acquired: true`. Dos agentes GSD «vivos» sobre el mismo repo.**
6. Stealer A: `asideA`=L0 dead ⇒ create ⇒ `EEXIST` (F2) ⇒ rechaza. Stealer B: `asideB`=F1-live ⇒ ABA guard restaura F1 (o rechaza). El estado en disco converge a **un** lock, pero **dos procesos fueron informados de que lo poseen**.

**Por qué la guarda ABA no lo cierra:** la ABA guard (paso 2) protege al *propio* stealer de pisar un lock vivo que ÉL movió a un lado (lo restaura). NO protege a `lockPath` de que un **tercer** proceso lo cree mientras está vacío por el move-aside de OTRO stealer. La exclusión de O_EXCL solo garantiza mutua exclusión para creates que compiten en el MISMO instante — no para creates separados por un move-aside intermedio que vacía el fichero. El CAS **no es linealizable** para steals concurrentes.

**Clasificación: bug de PRODUCTO, no del harness.** El test asevera correctamente el invariante; lo que falla es la primitiva. Toca el TOP THREAT de la fase (T-81-03-01: doble adquisición → dos agentes GSD sobre un repo → corrupción de estado). El flaky quedó latente/no confirmado desde Phase 70; este diagnóstico lo **confirma** como carrera real.

**Segundo mecanismo, distinto y benigno (solo `raceGsdChildren` :131, sin pre-siembra):** ahí no hay dead lock inicial; el ganador fresco retiene 500 ms y los demás rechazan (holder vivo). La única forma de una 2ª adquisición es que el ganador SALGA (hold expirado por spawn-jitter) dejando un lock muerto que un rezagado roba legítimamente — **eso sí** es timing del harness (raro, 1/40 observado). No confundir con la carrera de producto de CR-01.

## Files Involved

- `src/gsd/lock.js:283-351` — `stealLock`, la carrera (move-aside no atómico con el create). **READ-ONLY (D-09) — NO modificado en este diagnóstico** (`git diff --quiet -- src/gsd/lock.js` verde).
- `src/gsd/lock.js:108-151` — `acquireGsdLock`, cuyo create de Caso 1 (`:117`) gana en la ventana abierta por un stealer concurrente.
- `test/gsd-lock-race.test.js:142-162` — el harness `raceGsdStealDeadHolder` (:74-118) y los casos CR-01 que exponen la carrera. El test es CORRECTO; no se toca.
- `test/helpers/lock-race-child.mjs` — el hijo (imprime `acquired`/`blocked`). Sin cambios.

## Suggested Fix Direction

> **GATE (D-09, LOCKED):** este item es DIAGNÓSTICO. El fix altera la semántica del steal de v0.16 ⇒ FUERA DE ALCANCE de DEBT-04. Requiere decisión del mantenedor (cambio arquitectónico, Rule 4). Un «arreglo» descuidado que debilite el CAS es el TOP THREAT (T-81-03-02) — no aplicar a ciegas. Se documenta como follow-up con la deuda diferida.

Direcciones para un futuro esfuerzo con gate (no implementar aquí):

1. **Steal atómico sin ventana vacía.** Sustituir move-aside→create por una operación que nunca deje `lockPath` ausente para terceros: p. ej. crear el nuevo lock en un tmp único y `link()`/`rename()` atómico sobre `lockPath` SOLO condicionado a que el inodo actual siga siendo el stale observado (CAS por inodo/`ino` real), o un lock basado en **directorio** (`mkdir` es atómico y no tiene ventana briefly-empty).
2. **Verificación de posesión post-adquisición.** Tras «ganar», re-leer `lockPath` y confirmar que el `session_id`/`pid` en disco es el propio antes de proceder; si no, ceder. Reduce la ventana pero no la elimina (TOCTOU residual).
3. **Serializar el steal con un lock de exclusión** (p. ej. el `withStateLock` de v0.16 u otro `O_EXCL` guard alrededor de toda la sección crítica del steal), de modo que a lo sumo un stealer esté en move-aside→create a la vez.

Opción de la propia deuda: si el coste del fix no se justifica frente a la frecuencia real (multi-steal simultáneo del MISMO dead lock es un peor-caso sintético; en producción un dead lock lo roba quien pasa), **aceptar el riesgo documentado** y dejar el test como red-esperado hasta el esfuerzo con gate. La decisión es del mantenedor.

## Outcome

- **Causa raíz CONFIRMADA** (carrera de producto, ventana briefly-empty en el move-aside del CAS steal), con evidencia reproducida (traza de dos O_EXCL-create ganadores + insensibilidad al hold).
- **`src/gsd/lock.js` intacto** (invariante v0.16 protegido, D-09). **Sin remedios a ciegas** (cero retries/`.skip`/timeouts subidos/edición de producción).
- **El test permanece flaky-red a propósito**: captura un bug real; ponerlo verde sería enmascarar la carrera (prohibido, T-81-03-02). Los casos CR-01 NO quedan `.skip`.
- **No se añadió instrumentación al helper**: la instrumentación de la rama CAS exige tocar `lock.js` (READ-ONLY) para exponer la rama, y el test ya vuelca `verdicts` al fallar; una instrumentación cara/arriesgada no se justifica con la causa ya confirmada (D-10 aplica a no-repro; aquí SÍ reprodujo).
