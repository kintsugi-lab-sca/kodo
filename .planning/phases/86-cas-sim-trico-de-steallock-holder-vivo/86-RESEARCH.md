# Phase 86: CAS simétrico de `stealLock` — holder VIVO · Research

**Researched:** 2026-08-05
**Domain:** Concurrencia de ficheros en Node.js — compare-and-swap sobre un primitivo de lock por-repo; harness de carrera con procesos reales
**Confidence:** HIGH (todo el hallazgo es in-repo, leído y citado con rango de líneas en esta sesión; cero superficie web)

---

<user_constraints>
## User Constraints (de `86-CONTEXT.md`)

### Decisiones LOCKED

**Forma del CAS (LOCK-04)**

- **D-01:** El baseline de identidad se toma de **la lectura que ya hace la sección crítica** (`src/gsd/lock.js:448`), no de una lectura adicional. Se introduce un lector interno que devuelve en una sola pasada `{ raw, content, ino }`: `raw` = bytes crudos del `readFileSync`, `content` = el parse (o `null` si es corrupto — la rama PRESENT debe seguir tratando el corrupto como robable), `ino` = `statSync(lockPath).ino` tomado **inmediatamente después** de la lectura. `readLockContent` se conserva para el resto de call sites; el lector nuevo es aditivo. — *Reversibility: reversible.*
  - **Orden crítico, heredado del precedente:** los bytes salen de **la lectura**, jamás de un `statSync` tomado por separado.
- **D-02:** La comparación es **contenido crudo completo + `ino`**, no `size` + `ino`. Divergencia deliberada respecto al precedente del inbox y hay que documentarla: allí el fichero solo puede crecer; aquí el lock se **reemplaza entero**, de modo que dos contenidos distintos pueden tener el mismo tamaño. El lock son ~200 bytes: releerlo entero elimina ese falso negativo. — *Reversibility: reversible.*
- **D-03:** La comprobación va **tras escribir el `tmp` y justo antes del `renameSync`**, contra un `readFileSync` + `statSync` **frescos** — misma posición exacta que `src/inbox/store.js:799-810`. Si cualquiera de las dos sondas falla, `changed = true`: **conservador, no se publica nunca a ciegas**. El `tmp` se borra en ese caso. — *Reversibility: reversible.*
- **D-04:** `mtimeMs` queda **fuera** de la comparación, igual que en el inbox. No «completarlo» más tarde.

**Semántica del abort (LOCK-04)**

- **D-05:** Detectar cambio **no retorna directamente**: borra el `tmp`, suelta el guard por el `finally` existente y hace **`continue`**. Es el espejo exacto de lo que la rama ABSENT ya hace con su `EEXIST`. — *Reversibility: reversible.*
- **D-06:** **Corte inmediato si el nuevo contenido es un holder VIVO y fresco:** en la re-lectura posterior al abort, si `isStaleLock()` es falso → `{ acquired: false, holder, reason: 'lock-replaced-mid-steal' }` sin consumir más presupuesto.
- **D-07:** **`MAX_STEAL_ATTEMPTS` (8) NO se sube.** El `continue` de D-05 consume un intento del presupuesto **existente**. Ampliarlo sería el enmascaramiento que **DEBT-04 prohíbe (LOCKED)**. — *Reversibility: reversible.*

**Superficie del `reason` discriminado (LOCK-04)**

- **D-08:** El typedef `AcquireResult` (`src/gsd/lock.js:52`) se amplía de forma **aditiva**: `{ acquired: false, holder: LockContent, reason?: string }`. **Cero cambios en dispatcher, orchestrator, polling y `doctor.js`.** — *Reversibility: reversible.*
- **D-09:** El `reason` es además **observable**: `console.error` con el prefijo `[kodo:lock]`. Valor canónico: `'lock-replaced-mid-steal'`. **Un único valor nuevo**, no una taxonomía.

**Harness de holder VIVO (LOCK-05)**

- **D-10:** El determinismo se consigue con un **seam de inyección en producción**, no con sleeps ni con repetir N iteraciones. Precedente literal: `_afterReadFn` de `markCapture` (`src/inbox/store.js:698-703`). Hook opcional invocado **dentro de la sección crítica del steal, tras la lectura del baseline y antes de escribir el `tmp`**, default no-op. — *Reversibility: costly.*
  - **Solo en el primer intento del bucle**, igual que el precedente.
  - Documentado en JSDoc **como seam de test**, no como característica.
- **D-11:** El seam entra por un **tercer parámetro opcional de deps** en `acquireGsdLock(projectPath, sessionInfo, deps = {})`, propagado a `stealLock`. **No** variables de entorno, **no** mocks de `node:fs`. — *Reversibility: costly.*
- **D-12:** El harness usa **procesos reales**, extendiendo `test/helpers/lock-race-child.mjs` con un `kind` nuevo para los tres roles. — *Reversibility: reversible.*
  - «Stale pero vivo» se siembra por **TTL expirado con PID vivo**. **No** con `DEAD_PID`.
  - El contrato de stdout del helper (`acquired` / `blocked`, exactamente una vez, nunca lanza) **se respeta**; cualquier señal extra va por **canal lateral** en fichero.
- **D-13:** Los casos nuevos **extienden `test/gsd-lock-race.test.js`** con un `describe` propio. — *Reversibility: reversible.*
- **D-14:** La aserción es de **cardinalidad exacta sobre el agregado** (`acquired === 1`), nunca sobre *quién* gana. N≥2 y N=5.

**Mordida verificada (LOCK-06)**

- **D-15:** La mordida se verifica **a mano y se registra como evidencia citada** en el `SUMMARY`/`VERIFICATION`: diff exacto del CAS revertido + salida roja del harness. **No** se construye infraestructura de mutation testing. — *Reversibility: reversible.*
- **D-16:** **DEBT-04 es LOCKED y se aplica al pie de la letra:** ningún assert se debilita, ningún timeout sube, ningún presupuesto de reintento se amplía para greenear.

**Declaración de la ventana residual (LOCK-07)**

- **D-17:** La ventana residual se declara en **dos sitios**: (a) sección propia en el JSDoc de `stealLock`, y (b) entrada en `.planning/STATE.md`. Qué es: dos syscalls contiguos entre la sonda de identidad y el `renameSync`. Clase de riesgo, nombrada: TOCTOU residual no cerrable sin soporte atómico del FS — **la misma clase** que la ventana aceptada en el guard del inbox de la Phase 83. Qué cambia de verdad: la magnitud. **Prohibido:** presentarla como cierre por construcción.
- **D-18:** El comentario **falso** de `src/gsd/lock.js:455-457` se **retira y se sustituye** por la descripción real.

### Claude's Discretion

- Nombres concretos de identificadores (el lector interno, el campo del seam, el `kind` del helper) — el planner elige, respetando las convenciones del módulo.
- Reparto en planes: uno o dos planes. Restricción: el harness debe poder ponerse **rojo** con el CAS revertido → orden natural harness-primero, o CAS-y-harness-en-el-mismo-plan con evidencia de la mordida al final.

### Deferred Ideas (FUERA DE ALCANCE)

- **`LOCK-F1` — rediseño del primitivo de lock** (serializar Case-1 y `release` con el mismo steal-guard). Descartado por el mantenedor 2026-08-02. Va a **v2**.
- **Mutation testing automatizado.** Infraestructura nueva; contradice el «saneo puro, sin feature nueva» de v0.20.
- **Unificar el patrón CAS de `store.js` y `lock.js` en un helper compartido.** Trigger: una **tercera** aparición del patrón.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Descripción (literal de `.planning/REQUIREMENTS.md:12-15`) | Soporte de esta research |
|----|------------------------------------------------------------|--------------------------|
| **LOCK-04** | Con un holder stale pero VIVO que libera el lock en plena sección crítica del steal, un stealer NO puede sobrescribir el lock fresco de un creador Case-1 legítimo — la rama PRESENT re-valida la identidad del `lockPath` (`ino` + bytes, baseline tomado de la lectura de la propia sección crítica) inmediatamente antes del `renameSync` destructivo y aborta con un `reason` discriminado si cambió. | §Anatomía del CAS · §Patrón 1 · §Ejemplos de código · §Pitfalls 1-6 |
| **LOCK-05** | El harness de carrera siembra un holder VIVO y demuestra cardinalidad exacta: con N≥2 procesos y un release concurrente, adquiere **uno solo**. | §Patrón 3 (orquestación de 3 roles en tres tiempos) · §Patrón 4 (seam) · §Pitfalls 7-10 |
| **LOCK-06** | El guard tiene **mordida verificada**: revertir a mano el CAS pone el harness ROJO. Sin debilitar asserts, sin subir timeouts, sin ampliar presupuestos. | §Patrón 5 (mordida) · §Validation Architecture §Manual-Only |
| **LOCK-07** | La ventana residual (2 syscalls contiguos) queda **declarada** en el JSDoc de `stealLock` y en `STATE.md`, con su clase de riesgo nombrada. Nunca como cierre por construcción. | §Patrón 6 (declaración honesta) · §Ejemplo de redacción |
</phase_requirements>

---

## Summary

Esta fase no tiene superficie tecnológica nueva: **cero dependencias npm** (`package.json` solo declara `commander`, `ink`, `picocolors`, `react` en runtime y `@types/react` + `ink-testing-library` en dev) [VERIFIED: package.json, leído esta sesión], todo el trabajo ocurre sobre `node:fs` síncrono y el runner nativo `node:test`. El presupuesto de research se ha gastado íntegro en el código: `src/gsd/lock.js` completo (510 líneas), el guard CAS de `src/inbox/store.js:590-839`, los tres ficheros de test implicados y los consumidores del lock.

**El hallazgo central es que el CAS es la parte fácil y el harness es la parte difícil.** El CAS son ~15 líneas dentro de la rama PRESENT con un precedente literal en el repo que ya sobrevivió a una verificación adversarial (Phase 83-04/83-06). El harness, en cambio, tiene que orquestar **tres procesos reales en un orden estricto de tres tiempos** — y el repo ya aprendió por las malas (83-06, guard WR-03) que un escenario de concurrencia liberado con un único barrier degrada **en silencio** a un test verde que no mide nada. Con un solo barrier, el creador Case-1 arrancaría antes de que el holder libere, entraría él mismo en `stealLock`, se estrellaría contra el guard del stealer aparcado y terminaría en `blocked`: el escenario seguiría verde sin haber ejercitado jamás el CAS.

La segunda observación de peso es que el **seam de D-10 no tiene por qué ser un `sleep`**. En el precedente del inbox el seam duerme un número fijo de milisegundos porque la contraparte (los appends fail-open) no es observable desde el padre. Aquí sí lo es: el seam es una función inyectada por el test y puede **esperar a un fichero-barrera** que el padre escribe cuando ya ha comprobado en disco que el creador tiene el lock. Eso convierte el interleaving de 5 pasos en determinista **por construcción**, no por anchura de ventana — y hace que el escenario deje de depender de ningún presupuesto temporal, que es exactamente lo que DEBT-04 exige. Contrapartida medida y acotada: la ventana de aparcamiento **debe quedar por debajo de `STEAL_GUARD_STALE_MS` (5.000 ms)** o los stealers adicionales del caso N=5 romperían el guard del aparcado por edad y entrarían dos a la sección crítica.

**Recomendación primaria:** implementar el CAS como transporte literal de `src/inbox/store.js:790-822` con la única divergencia de D-02 (comparar `Buffer` crudo en vez de `size`), y construir el harness como *tres tiempos* con marcador de rama por canal lateral — el marcador es lo que impide que un futuro ajuste apague la cobertura en silencio, exactamente igual que `capture-branches.log` hace hoy en el inbox.

*(Esta fase no es un rename/refactor/migración: no hay estado de runtime que inventariar — ni datastores, ni config de servicios vivos, ni registros del SO, ni secretos, ni artefactos de build afectados. El §Runtime State Inventory se omite por no aplicar.)*

---

## Architectural Responsibility Map

| Capacidad | Tier primario | Tier secundario | Razón |
|-----------|---------------|-----------------|-------|
| Re-validación de identidad antes del `renameSync` (CAS) | **Primitivo de concurrencia** (`src/gsd/lock.js`, rama PRESENT de `stealLock`) | — | El invariante «nunca dos owners» solo puede sostenerse donde vive el `renameSync` destructivo. Ningún consumidor puede repararlo desde fuera. |
| Semántica del abort (`continue` vs corte con `reason`) | **Primitivo de concurrencia** (bucle de `stealLock`) | — | El bucle ya discrimina PRESENT/ABSENT correctamente; la decisión pertenece al mismo bucle, no al llamante. |
| Superficie del `reason` en el resultado | **Contrato del módulo** (typedef `AcquireResult`) | Observabilidad (`console.error` con prefijo `[kodo:lock]`) | D-08: aditivo y opcional. El dispatcher lee solo `.holder`, así que el campo no obliga a nadie. |
| Determinismo del interleaving | **Seam en producción** (`deps._afterRead…`) + **orquestación en el padre del test** | — | El precedente del repo (`_afterReadFn`) ya estableció que ensanchar la ventana desde producción es preferible a los sleeps del test. La secuenciación de roles vive en el padre. |
| Siembra del holder stale-pero-VIVO | **Proceso hijo del harness** (`test/helpers/lock-race-child.mjs`) | — | Un PID vivo solo lo puede aportar un proceso vivo. Escribir el lock desde el padre con el PID del hijo funcionaría, pero el hijo también debe ejecutar `releaseGsdLock` de verdad. |
| Declaración de la ventana residual | **JSDoc de `stealLock`** + **`.planning/STATE.md`** | — | D-17. Un solo sitio deja al lector del código o al lector del estado sin la información. |
| Verificación de la mordida | **Manual con evidencia citada** (`SUMMARY`/`VERIFICATION`) | — | D-15. Automatizarlo es mutation testing = feature nueva, prohibida en v0.20. |

---

## Standard Stack

### Core

| Librería | Versión | Propósito | Por qué es la estándar aquí |
|----------|---------|-----------|------------------------------|
| `node:fs` (síncrono) | built-in, Node ≥20 | `readFileSync`, `statSync`, `writeFileSync`, `renameSync`, `linkSync`, `unlinkSync` | Ya es el único mecanismo del módulo. `src/gsd/lock.js:2-12` importa exactamente estos [VERIFIED: src/gsd/lock.js:2-12]. |
| `node:test` + `node:assert/strict` | built-in, Node ≥20 | Runner y aserciones | Convención del repo, sin fichero de configuración: `"test": "node --test $(find test -name '*.test.js' -type f)"` [VERIFIED: package.json scripts, leído esta sesión]. |
| `node:child_process` (`spawn`) | built-in | Procesos reales del harness | `test/gsd-lock-race.test.js:12` y `test/inbox-concurrency.test.js:66` ya lo usan [VERIFIED: ambos ficheros leídos esta sesión]. |
| `Atomics.wait` sobre `SharedArrayBuffer` | built-in | Espera síncrona dentro de una sección crítica síncrona | `sleepShort` en `src/gsd/lock.js:380-386` y `sleepSync`/`waitForBarrier` en `test/helpers/lock-race-child.mjs:115-130`. No hay alternativa: la sección crítica es 100 % síncrona y un `await` la partiría. |

### Alternativas consideradas

| En vez de | Se podría usar | Tradeoff |
|-----------|----------------|----------|
| Comparación de contenido crudo + `ino` | `flock`/`fcntl` advisory locks vía addon nativo | Dependencia nueva (prohibida) y cambio del primitivo (LOCK-F1, diferido a v2). |
| Comparación de contenido crudo + `ino` | `renameat2(RENAME_NOREPLACE)` / `link`+`unlink` condicional | `RENAME_NOREPLACE` es Linux-only y no está expuesto por `node:fs`; el repo corre en macOS. Es literalmente el «soporte atómico del sistema de ficheros» cuya ausencia D-17 obliga a declarar. |
| `Buffer.equals` sobre los bytes | `size` + `ino` (precedente inbox literal) | **Rechazado por D-02:** aquí el fichero se reemplaza entero, así que dos contenidos distintos caben en el mismo tamaño. |
| Seam con `sleep` fijo (precedente inbox) | Seam con espera a fichero-barrera | Recomendado el segundo — ver §Patrón 4. Elimina toda dependencia de anchura de ventana. |

### Instalación

```bash
# Ninguna. Cero dependencias nuevas — invariante cross-milestone de STATE.md:163:
# "Cero nuevas dependencias npm (locks vía node:fs built-in)"
```

---

## Package Legitimacy Audit

**No aplica a esta fase: cero paquetes externos se instalan.** El invariante cross-milestone lo declara literalmente en `.planning/STATE.md:163` — «**Cero nuevas dependencias npm** (locks vía `node:fs` built-in)» [VERIFIED: .planning/STATE.md:163, leído esta sesión]. Todo el trabajo se hace con built-ins de Node y ficheros ya existentes del repo.

- Paquetes retirados por veredicto `[SLOP]`: ninguno (no se evaluó ninguno).
- Paquetes marcados `[SUS]`: ninguno.
- El planner **no debe** insertar ningún `checkpoint:human-verify` de instalación: no hay instalación.

---

## Architecture Patterns

### Diagrama del sistema — el interleaving que se cierra

```
                     ┌──────────────────────────────────────────────────┐
                     │  lockPath = <repo>/.planning/.kodo.lock           │
                     └──────────────────────────────────────────────────┘
                                    ▲            ▲            ▲
        ┌───────────────────────────┘            │            └──────────────────┐
        │                                        │                               │
  ┌─────┴──────┐                        ┌────────┴────────┐              ┌───────┴────────┐
  │  HOLDER A  │                        │   CREADOR B     │              │   STEALER S    │
  │ stale+VIVO │                        │ acquireGsdLock  │              │ acquireGsdLock │
  │            │                        │   Case-1 O_EXCL │              │  → stealLock   │
  └─────┬──────┘                        └────────┬────────┘              └───────┬────────┘
        │                                        │                               │
        │                        NO pasa por el steal-guard ──┐                  │
        │                                        │            │      ┌───────────┴───────────┐
        │                                        │            │      │ 1. gana el steal-guard│
        │                                        │            │      │    (linkSync atómico) │
        │                                        │            │      ├───────────────────────┤
        │                                        │            │      │ 2. lee baseline       │
        │                                        │            │      │    {raw, content, ino}│
        │                                        │            │      │    A = stale → sigue  │
        │                                        │            │      ├───────────────────────┤
        │                                        │            │      │ ══ SEAM (D-10) ══     │
        │                                        │            │      │    aparcado           │
        ▼                                        │            │      │                       │
  3. releaseGsdLock                              │            │      │                       │
     unlinkSync(lockPath) ─────► path AUSENTE    │            │      │                       │
                                                 ▼            │      │                       │
                                 4. O_EXCL create ÉXITO ──────┘      │                       │
                                    B = holder fresco y VIVO         │                       │
                                                                     ├───────────────────────┤
                                                                     │ 3. escribe tmp        │
                                                                     │ 4. ══ CAS (LOCK-04) ══│
                                                                     │    relee raw+ino      │
                                                                     │    ¿≠ baseline? SÍ    │
                                                                     │ 5a. borra tmp         │
                                                                     │ 5b. ¿B vivo+fresco?   │
                                                                     │     SÍ → ABORTA con   │
                                                                     │  'lock-replaced-mid-  │
                                                                     │        steal'         │
                                                                     └───────────────────────┘
                                                                          finally: suelta guard

   ANTES (hoy):  paso 5 = renameSync incondicional → B CLOBBEADO → dos owners
   DESPUÉS:      paso 5 = CAS → S se retira limpiamente → el lock en disco es el de B
```

### Estructura de ficheros tocados

```
src/gsd/lock.js                     # el CAS (rama PRESENT), el lector interno,
                                    # el seam, el typedef, el JSDoc de LOCK-07
test/helpers/lock-race-child.mjs    # kind(s) nuevo(s): holder vivo, stealer aparcado
test/gsd-lock-race.test.js          # describe nuevo (D-13), orquestación de 3 tiempos
.planning/STATE.md                  # declaración de la ventana residual (D-17b)
```

**Ficheros que NO se tocan** (criterio 5): `src/triggers/dispatcher.js`, `src/gsd/doctor.js`, `src/hooks/stop.js`, `src/hooks/session-end.js`, `src/daemon/lifecycle.js`, `src/cli/polling.js`, `src/session/state-lock.js`, `test/gsd-lock.test.js`, `test/gsd-lock-guard.test.js`, `test/gsd-concurrency.test.js`, `test/dispatcher.test.js`.

---

### Patrón 1 — Anatomía del CAS (transporte literal del precedente del inbox)

**Qué:** baseline en la lectura → escribir el `tmp` → **sonda fresca** → comparar → publicar-o-abortar.
**Cuándo:** dentro de la rama PRESENT de `stealLock`, y solo ahí.

**Las cinco reglas de orden del precedente, y cuáles transfieren:**

| Regla del inbox | Cita | ¿Transfiere a `lock.js`? |
|-----------------|------|--------------------------|
| Los bytes del baseline salen de **la lectura**, jamás de un `statSync` separado | `src/inbox/store.js:662-665` (« JAMÁS del `size` de un `statSync` tomado por separado: un append que aterrice entre el `readFileSync` y ese stat entraría en el baseline y el guard quedaría CIEGO justo ante el caso que debe detectar ») | **Sí, sin cambios.** Es exactamente D-01. |
| El `ino` se toma **del destino, inmediatamente después de la lectura** | `src/inbox/store.js:665` («**inodo: del destino**, tomado inmediatamente después de la lectura») | **Sí, sin cambios.** |
| La comprobación va **tras escribir el `tmp`**, no antes | `src/inbox/store.js:787-789` («ORDEN INAMOVIBLE: escribir el tmp → stat FRESCO del destino → comparar → renombrar. Comparar ANTES de escribir el tmp dejaría fuera de la ventana vigilada el propio coste de la escritura, que es la parte más cara del paso.») | **Sí, sin cambios.** Es D-03. |
| `mtimeMs` queda fuera | `src/inbox/store.js:675-676` | **Sí, sin cambios.** Es D-04. |
| El detector es `size !== baseBytes \|\| ino !== baseIno` | `src/inbox/store.js:802` | **NO — se adapta.** El lock se reemplaza entero (`unlink`+create, o rename de un tercero), así que el tamaño no es un detector suficiente. D-02 sustituye `size` por comparación de bytes crudos. |
| El destino se resuelve con `realpathSync` + se reaplica el modo (`resolvePublishTarget`, `src/inbox/store.js:603-618`) | `src/inbox/store.js:603-618` | **NO transfiere.** Ver §Pitfall 4: la resolución de symlink ya la hace `lockPathFor` (`src/gsd/lock.js:199-201`) sobre el **projectPath**; añadir un segundo `realpathSync` sobre el `lockPath` haría que el CAS sondease un path distinto del que el `renameSync` va a reemplazar — introduciría el desajuste que pretende cerrar. **El CAS debe sondear exactamente el mismo path que el `rename` toca.** El `chmod` del inbox tampoco aplica: el lock no lleva modo del operador. |
| Baseline `ino` degradable a `null` si el `statSync` falla, siguiendo con el componente de bytes | `src/inbox/store.js:740-744` («`baseIno = null; // sin componente de inodo; el de tamaño sigue vigente`») | **Sí, adaptado:** si el `statSync` del baseline falla, se compara solo `raw`. |

### Patrón 2 — Semántica del abort: `continue` con corte por holder vivo

**Qué:** el abort no retorna directamente (D-05) salvo cuando el contenido nuevo es un holder vivo y fresco (D-06).

**Detalle de implementación que ahorra una syscall y hace D-06 exacto:** la sonda fresca del CAS **ya ha leído los bytes nuevos**. Parsearlos ahí mismo sirve simultáneamente para (a) decidir `changed` y (b) evaluar `isStaleLock` para el corte de D-06. No hace falta una tercera lectura.

```
CAS detecta changed
   │
   ├─ el contenido nuevo parsea y !isStaleLock(nuevo)
   │     → borra tmp, console.error('[kodo:lock] …'),
   │       return { acquired:false, holder:nuevo, reason:'lock-replaced-mid-steal' }
   │       (el `finally` suelta el guard igual — un `return` dentro del `try` lo ejecuta)
   │
   └─ el contenido nuevo no parsea, o es stale, o la sonda falló
         → borra tmp, `continue`  (consume 1 intento del presupuesto de 8)
```

**Por qué `continue` y no `return` en el caso general:** tras el abort el path puede quedar en tres estados (creador vivo / ausente / stale reaparecido) y el bucle ya resuelve los tres — en particular la rama ABSENT (`src/gsd/lock.js:473-483`) adquiriría legítimamente un path ausente, cosa que un `return` convertiría en fallo espurio.

**El `continue` dentro del `try…finally`:** el `finally` de `src/gsd/lock.js:484-490` hace `unlinkSync(guardPath)` y se ejecuta también en la salida por `continue` (semántica estándar de JS: `continue` es una salida abrupta del bloque `try`). El guard queda liberado antes de la siguiente vuelta, que vuelve a contender por él. Sin esto, el segundo intento se estrellaría contra su propio guard.

### Anti-patrones a evitar

- **Añadir un `sleepShort` en el camino del abort.** D-05 no lo pide, el presupuesto ya está acotado en 8 y cada vuelta hace syscalls reales. Un backoff aquí es tiempo muerto sin invariante detrás.
- **Comparar sobre `readFileSync(path, 'utf-8')` en vez de sobre `Buffer`.** Ver §Pitfall 2.
- **Hacer que el seam se dispare en cada vuelta del bucle.** El precedente lo guarda con `attempt === 0` (`src/inbox/store.js:776`: `if (attempt === 0 && typeof _afterReadFn === 'function') _afterReadFn();`) y su JSDoc explica por qué (`:701-703`).
- **Disparar el seam fuera de la sección crítica** (en la rama de guard ocupado, o en la rama ABSENT). D-10 lo sitúa dentro de la sección crítica y tras la lectura del baseline.
- **Aprovechar el viaje para arreglar WR-01/WR-02/IN-01/IN-02 de `82-REVIEW.md`.** Ver §Fuera de alcance.

---

### Patrón 3 — Harness de tres roles con **liberación en TRES tiempos**

**Qué:** el padre secuencia holder → creador → stealer de forma estricta, verificando en disco entre etapas.
**Cuándo:** en el `describe` nuevo de `test/gsd-lock-race.test.js` (D-13).

**Precedente del repo, y por qué hay que extenderlo:** `test/inbox-concurrency.test.js:145-160` documenta la liberación en **dos** tiempos y por qué existe — «Con un único barrier, los 7 hijos de un escenario mixto compiten por el lock a la vez y la carrera la decide el scheduler… Está MEDIDO, no supuesto: el guard de cobertura de este plan lo puso rojo en el acto (`coordinated=6, failopen=0`)» [VERIFIED: test/inbox-concurrency.test.js:145-151].

Aquí hacen falta **tres** tiempos porque el creador Case-1 no puede arrancar antes de que el holder haya liberado. Si lo hiciera:

> El creador encuentra el lock presente → `writeLockFile` con `wx` da `EEXIST` (`src/gsd/lock.js:124-130`) → lee el holder → PID vivo pero TTL vencido → **entra él mismo en `stealLock`** (`:154`) → el guard lo tiene el stealer aparcado, vivo y fresco → `guardIsStale` falso → lee el lock, holder stale → `sleepShort(2·(attempt+1))` → agota los 8 intentos en ~72 ms → epílogo `:497-498` → `{acquired:false, holder}` → imprime `blocked`.
>
> Resultado: `acquired === 1` **seguiría cumpliéndose** (nadie adquiere salvo… nadie), el test seguiría verde y **el CAS no se habría ejercitado jamás**. Es el mismo modo de fallo silencioso que 83-06 destapó.

**Secuencia recomendada:**

| t | Actor | Acción | Señal que el padre espera antes de seguir |
|---|-------|--------|-------------------------------------------|
| t0 | padre | `mkdirSync(repoDir)`; spawn de los 3 roles, cada uno aparcado en **su propio** barrier | — |
| t1 | padre | suelta el **holder** | marcador `holder-seeded` en el sandbox |
| t2 | holder | siembra el lock: `pid: process.pid` (vivo), `acquired_at` retrodatado > `ttl_hours`, `session_id` constante conocida; escribe el marcador; espera su barrier de release | — |
| t3 | padre | suelta el **stealer** | marcador `stealer-parked`, escrito **desde dentro del seam** |
| t4 | stealer | `acquireGsdLock` → `EEXIST` → TTL vencido → `stealLock` → gana el guard → lee baseline → **seam**: escribe `stealer-parked` y espera el barrier `resume` | — |
| t5 | padre | escribe el barrier de release del **holder** | `!existsSync(lockPath)` — el `unlinkSync` ya ocurrió |
| t6 | holder | `releaseGsdLock(repo, SESSION_HOLDER)` → imprime su veredicto → sale | — |
| t7 | padre | suelta el **creador** | el lock existe **y** su `session_id` es el del creador |
| t8 | creador | `acquireGsdLock` → Case-1 `O_EXCL` → `acquired` → `--hold` para seguir vivo | — |
| t9 | padre | escribe el barrier `resume` | cierre de los 3 hijos |
| t10 | stealer | sale del seam → escribe `tmp` → **CAS** → aborta → `blocked` + marcador de `reason` | — |

**Todas las esperas del padre son `waitUntil(pred, timeoutMs)` acotadas** — el helper ya existe en `test/inbox-concurrency.test.js:133-140` y se puede replicar. Al vencer el margen se continúa igualmente: dejar hijos colgados enmascararía el fallo (misma disciplina que `raceChildren`, `:159-160`).

**Primitivas de sincronización disponibles (inventario verificado):**

| Primitiva | Dónde vive | Uso aquí |
|-----------|-----------|----------|
| `--barrier <goFile>` + `waitForBarrier` (spin con `Atomics.wait` de 1 ms, timeout 5000 ms) | `test/helpers/lock-race-child.mjs:86, 120-130` | Un go-file **por rol**, no compartido. |
| `--hold <ms>` (el ganador sigue vivo tras adquirir) | `test/helpers/lock-race-child.mjs:87-94, 417-420` | El creador lo usa para que su PID siga vivo mientras el stealer evalúa `isStaleLock`. |
| `sleepSync(ms)` con `Atomics.wait` | `test/helpers/lock-race-child.mjs:115-118` | Fallback del seam si se opta por hold fijo. |
| Marcador cross-proceso por `appendFileSync` (canal lateral) | `test/helpers/lock-race-child.mjs:241-252` (`capture-branches.log`) | `stealer-parked`, `holder-seeded` y el **marcador de `reason`**. |
| Agregación de ramas + guard de cobertura | `test/inbox-concurrency.test.js:210-253` | Molde literal para el guard de cobertura del CAS. |
| `waitUntil(pred, timeoutMs)` | `test/inbox-concurrency.test.js:133-140` | Todas las esperas de disco del padre. |
| `env: { ...process.env, HOME: home }` en el spawn | `test/inbox-concurrency.test.js:174` | **No hace falta aquí:** `acquireGsdLock` opera sobre `--repo`, no sobre `$HOME`. El `kind: 'gsd'` actual no aísla HOME y no lo necesita. |

**Receta exacta de siembra «stale pero VIVO»** (el punto que LOCK-05 exige y que hoy no existe):

```js
// En el hijo holder — el PID DEBE ser el de un proceso vivo, así que lo escribe él mismo.
// Retrodatar `acquired_at` por encima de `ttl_hours` es el Case-3 de acquireGsdLock:145-155.
const planning = join(realpathSync(repo), '.planning');   // realpath: gsd-lock-race.test.js:79
mkdirSync(planning, { recursive: true });
writeFileSync(
  join(planning, '.kodo.lock'),
  JSON.stringify({
    session_id: 'sess-live-holder',        // constante conocida → el release puede casarla
    task_id: 'uuid-live-holder',
    task_ref: 'KL-live',
    pid: process.pid,                      // VIVO. Jamás DEAD_PID (99999999).
    acquired_at: new Date(Date.now() - 5 * 3600_000).toISOString(),  // > ttl_hours
    ttl_hours: 4,
  }, null, 2) + '\n',
);
```

El patrón de retrodatado es literal de `test/gsd-lock.test.js:117-127` (`const fiveHoursAgo = new Date(Date.now() - 5 * 3600_000).toISOString();` con `pid: process.pid, // alive, but TTL exceeded`) [VERIFIED: test/gsd-lock.test.js:117-127]. El sesgo que esta fase corrige está en `test/gsd-lock-guard.test.js:39` (`const DEAD_PID = 99999999;`) y `:80-89` (`writeStaleDeadLock`) [VERIFIED: test/gsd-lock-guard.test.js:39, 79-89].

**Alternativa descartada:** que el padre siembre el lock con `pid: process.ppid` (el runner, vivo durante toda la carrera) — truco que el `kind: 'polling'` ya usa (`test/helpers/lock-race-child.mjs:307-313`). Funcionaría para el `isPidAlive`, pero LOCK-05 pide un holder VIVO que **libere** en plena sección crítica: hace falta un actor real que ejecute `releaseGsdLock`, y hacerlo desde un hijo dedicado es más fiel al escenario de producción (`src/hooks/stop.js:238-239` y `src/hooks/session-end.js:206-207` son quienes liberan de verdad).

**Contrato de stdout del helper (D-12) — vocabularios verificados:**

| `kind` | Veredictos | Cita |
|--------|-----------|------|
| `gsd`, `state` | `acquired` / `blocked` | `test/helpers/lock-race-child.mjs:422` — `process.stdout.write(acquired ? 'acquired' : 'blocked');` |
| `writer`, `handoff`, `capture`, `mark` | `written` / `failed` | `test/helpers/lock-race-child.mjs:159, 197, 253, 280` |
| `polling` | `started` / `already_starting` / `already_running` / `timed_out` / `error` | `test/helpers/lock-race-child.mjs:319-326` |
| `dispatch` | el `action` del dispatcher, o `error:<msg>` | `test/helpers/lock-race-child.mjs:388-392` |

El rol **holder** no adquiere nada, así que **no debe** imprimir `acquired`: el precedente para «hice mi trabajo / fallé» es `written`/`failed`. Con eso, contar `verdicts.filter(v => v === 'acquired').length` sobre **todos** los hijos sigue siendo seguro.

### Patrón 4 — Seam determinista por barrera, no por anchura de ventana

**Qué:** el seam de D-10 recibe una función que (1) escribe el marcador `stealer-parked` y (2) **espera un fichero-barrera**, en vez de dormir N ms.

**Por qué:** el precedente del inbox duerme (`_afterReadFn: () => sleepSync(holdMs)`, `test/helpers/lock-race-child.mjs:274`) y necesita constantes calibradas con una advertencia explícita de no bajarlas (`OVER_BUDGET_WINDOW_MS = 1500`, `test/inbox-concurrency.test.js:105-108`: «⚠ ESTE VALOR NO SE BAJA»). Esa calibración existe porque la contraparte del inbox —los appends fail-open— no es observable desde el padre. **Aquí sí lo es:** el padre puede comprobar en disco que el lock desapareció y que reapareció con el `session_id` del creador. Esperar a una barrera hace el escenario independiente de cualquier presupuesto temporal, que es la propiedad que DEBT-04 premia.

**Restricción dura y medida — la ventana de aparcamiento debe quedar por debajo de `STEAL_GUARD_STALE_MS`:**

`src/gsd/lock.js:65` declara `const STEAL_GUARD_STALE_MS = 5_000;` [VERIFIED: src/gsd/lock.js:65]. Mientras el stealer está aparcado **retiene el steal-guard**. En el caso N=5 con stealers adicionales, cualquiera de ellos evalúa `guardIsStale(guardPath, STEAL_GUARD_STALE_MS)` (`:434`) y, pasados 5 s desde el `ts` del guard, lo rompería y entraría **también** a la sección crítica → dos stealers renombrando a la vez, que es la carrera de PRIMER orden que la Phase 82 cerró. El test mediría entonces otra cosa.

Consecuencias para el planner:
- El timeout del `waitForBarrier` del seam debe ser **claramente inferior a 5.000 ms** (sugerencia: 3.000 ms) y, al vencer, el hijo continúa (fallo ruidoso, nunca cuelgue).
- Los tres hijos se **spawnean antes** de la primera liberación, de modo que el `spawn` + el import dinámico ya están pagados y dentro de la ventana solo queda el trabajo real (un `unlinkSync` y un `O_EXCL` create) — decenas de ms.
- **Subir `STEAL_GUARD_STALE_MS` para que el escenario quepa sería enmascaramiento (D-16).** No es una salida.

**Disciplina del import dinámico post-HOME:** los `kind` nuevos deben mantener el `await import('../../src/gsd/lock.js')` **dinámico**, como el `kind: 'gsd'` actual (`test/helpers/lock-race-child.mjs:403`). La razón general está documentada en el propio helper (`:204-207`: «El import MUST stay dynamic and POST-HOME… un import estático evaluaría `homedir()` en module-load»). Para `gsd/lock.js` el riesgo de fuga de HOME no aplica (opera sobre `--repo`), pero romper la disciplina en un fichero donde ya es norma invita a copiarla mal en el siguiente.

### Patrón 5 — Mordida verificada y registrada (LOCK-06)

**Qué:** revertir a mano el CAS, correr el harness, capturar la salida roja, restaurar, registrar ambas cosas.
**Precedente literal en el repo** (dos, ambos de v0.19):

- `.planning/milestones/v0.19-phases/83-.../83-VERIFICATION.md:78` — «El comentario del bloque documenta la mordida comprobada a mano (revertido el fix → caso 1 rojo)» [VERIFIED: fichero leído esta sesión].
- `STATE.md:113` — «83-06: … se verifica su MORDIDA: con el guard compare-and-swap de 83-04 revertido a mano sobreviven 0 de 6 con exit 0 en los 7 procesos; restaurado, 6 de 6» [VERIFIED: .planning/STATE.md:113].
- `STATE.md:66` (DEBT-07/85-02) — «guard reforzado con source-grep …, con **mordida verificada** (violación inyectada → RC=1 → revert)».

**Qué produce la mordida aquí, exactamente:** con el CAS revertido, el stealer ejecuta el `renameSync` incondicional → clobbea a B → **ambos** imprimen `acquired` → `acquired === 2` y la aserción de cardinalidad falla con el mensaje del `assert.equal`. Además el lock en disco lleva el `session_id` del stealer. Son dos evidencias independientes de la misma mordida; la de cardinalidad es la canónica (D-14).

**Formato de registro recomendado** (calcado del precedente): en el `SUMMARY` del plan, un bloque con (a) el `diff` exacto de la reversión, (b) la salida `# fail N` del runner con el mensaje del assert, (c) la salida verde tras restaurar, (d) el conteo de la suite completa antes y después.

### Patrón 6 — Declaración honesta de la ventana residual (LOCK-07)

**Qué:** un bloque de JSDoc en `stealLock` + una entrada en `STATE.md`, ambos sin adornos.
**Plantilla literal** — `src/inbox/store.js:678-683` [VERIFIED, transcrito verbatim]:

> «**Ventana residual, declarada sin adornos.** Entre el `statSync` de comprobación y el `renameSync` quedan dos syscalls adyacentes. NINGÚN lock puede cerrar ese hueco mientras D-03 mantenga el append fail-open fuera de coordinación; este guard NO lo cierra y no debe leerse como si lo hiciera. Lo que cambia es la magnitud: la ventana pasa de ser toda la sección crítica del marcado (segundos, si el titular se atasca) a ser el hueco entre dos syscalls contiguos, y deja de depender de ningún presupuesto de tiempo.»

**Traducción exacta al caso del lock** (los cuatro elementos que D-17 exige):

1. **Qué es:** entre la sonda de identidad (`readFileSync` + `statSync` frescos) y el `renameSync` quedan dos syscalls contiguos. Un creador Case-1 que aterrice justo ahí sigue siendo clobbeable.
2. **Clase de riesgo, nombrada:** TOCTOU residual, no cerrable sin soporte atómico del sistema de ficheros (`rename` POSIX no admite condición; `renameat2(RENAME_NOREPLACE)` es Linux-only y `node:fs` no lo expone). **Misma clase** que la ventana residual aceptada en el guard del inbox de la Phase 83.
3. **Qué cambia de verdad:** la magnitud. Deja de ser toda la sección crítica del steal —que dura lo que dure el proceso vivo del holder— y pasa a ser el hueco entre dos syscalls contiguos, sin depender de ningún presupuesto de tiempo.
4. **Lo prohibido:** presentarla como cierre por construcción. El cierre por construcción es `LOCK-F1`, diferido a v2 con su trigger propio (`.planning/REQUIREMENTS.md:40`).

**El comentario falso a retirar** (D-18) — `src/gsd/lock.js:455-457`, verbatim:

> `// never briefly-empty: rename swaps the inode atomically (POSIX). No fresh`
> `// Case-1 creator can race here — its O_EXCL create fails EEXIST while any`
> `// bytes are present, so the guard fully serializes us.`

La primera frase (`rename` intercambia el inodo atómicamente) **es cierta y se conserva**. Las dos siguientes son falsas y se sustituyen: el paso 3 del interleaving retira esos bytes.

**Dónde va en `STATE.md`:** el candidato natural es §*Critical Invariants to Preserve (cross-milestone)* (`.planning/STATE.md:149-163`), donde ya vive el invariante del lock del inbox (`:156`). Aviso operativo heredado: `STATE.md:141` registra que «el §Deferred Items de STATE.md es una sección CURADA del SDK … y NO hay handler que direccione sus filas de 4 columnas — `state.patch`/`state.update` resuelven por `tableRowPattern`, que solo casa filas de 2 celdas», y que la mutación de 85-05 se hizo por `Edit` con `state.validate` saliendo `valid:true` sin drift. El planner debe verificar qué handler de `gsd-tools` cubre la sección elegida antes de asumir que `state.patch` sirve.

---

## Don't Hand-Roll

| Problema | No construyas | Usa en su lugar | Por qué |
|----------|---------------|-----------------|---------|
| Comparar identidad de fichero antes de publicar | Un esquema de versión/generación dentro del JSON del lock | El patrón bytes+`ino` de `src/inbox/store.js:731-744, 799-813` | Ya está en producción, ya sobrevivió a una verificación adversarial (0/6 → 6/6) y ya tiene su ventana residual documentada. Un esquema de versión requiere que **todos** los escritores cooperen — y el creador Case-1 por definición no coopera. |
| Ensanchar la ventana de forma determinista | `sleep` en el test, o repetir la carrera N veces a ver si cae | El seam inyectado (`_afterReadFn`, `src/inbox/store.js:698-703`) | Es el precedente aprobado del repo para meter determinismo sin código de test en producción. Los sleeps del padre no pueden entrar dentro de una sección crítica síncrona de otro proceso. |
| Inyectar dependencias en el módulo de lock | Variables de entorno, mocks de `node:fs`, `require` interceptado | Parámetro opcional de deps (`dispatcher.js:72` `deps = {}`, `store.js:710`) | Patrón único del repo; una env var sería estado global compartido entre tests paralelos y un mock de `node:fs` invalidaría precisamente el comportamiento de FS que se está probando. |
| Espera acotada sobre estado de disco | `setTimeout` con margen «generoso» | `waitUntil(pred, timeoutMs)` (`test/inbox-concurrency.test.js:133-140`) | Convierte una espera de duración fija en una condición observable; el margen solo actúa como techo. |
| Demostrar que el escenario ejerció la rama | Confiar en que el interleaving cayó bien | Marcador de rama por canal lateral + guard de cobertura (`test/helpers/lock-race-child.mjs:241-252`, `test/inbox-concurrency.test.js:241-253`) | 83-06 lo aprendió midiendo: sin el guard, la cobertura se apaga en silencio (18/18 coordinadas) y el test sigue verde sin probar nada. |
| Verificar la mordida | Framework de mutation testing | Reversión manual + evidencia citada (D-15) | Es infraestructura nueva; v0.20 es saneo puro. Ya está diferido con trigger en `86-CONTEXT.md` §Deferred. |
| Sincronía dentro de una sección crítica | `await`/`setTimeout` | `Atomics.wait` sobre `SharedArrayBuffer` (`src/gsd/lock.js:380-386`) | Toda la ruta del lock es síncrona; un `await` partiría la sección crítica y cambiaría el invariante. |

**Insight clave:** en este dominio la tentación no es escribir código de más, es escribir *test* de más — repetir la carrera hasta que caiga, o subir holds hasta que el escenario «funcione». Ambas cosas son enmascaramiento con otro nombre, y el repo ya revirtió una vez por eso (`STATE.md:102-103`: «SUPERSEDED por 83-04: ese arreglo NO cerró el lost-update, solo movió el umbral»).

---

## Common Pitfalls

### Pitfall 1 — Reutilización de inodo tras `unlink` + create

**Qué sale mal:** el CAS compara `ino` y concluye «sin cambios» porque el sistema de ficheros reasignó el mismo número de inodo al fichero nuevo del creador.
**Por qué ocurre:** `unlink` + `create` en el mismo directorio y con el mismo tamaño de bloque es un caso de reutilización favorable en ext4/APFS.
**Cómo evitarlo:** es **exactamente** la razón de D-02. La condición es `raw ≠ baseRaw` **O** `ino ≠ baseIno`; basta con que una de las dos dispare. El contenido del creador difiere en `session_id`, `task_id`, `task_ref`, `pid` y `acquired_at` (con milisegundos), así que la componente de bytes es la que aguanta el peso.
**Señales de alarma:** un test de mordida que salga verde con el CAS revertido apuntaría a que solo se está comparando `ino`.
**Residual declarado:** si el contenido nuevo fuese byte-idéntico **y** reutilizase el inodo, el CAS quedaría ciego. Un lock byte-idéntico implica mismo `session_id` y mismo `acquired_at` al milisegundo entre dos procesos distintos: no reproducible en la práctica, y el clobber resultante sería semánticamente un no-op. Merece una línea en el JSDoc, no una defensa.

### Pitfall 2 — `readFileSync(…, 'utf-8')` destruye bytes no-UTF-8

**Qué sale mal:** el inbox documenta la degradación exacta en `src/inbox/store.js:685-690`: «Si el fichero contiene bytes que NO son UTF-8 válido, `readFileSync(…, 'utf-8')` los sustituye por U+FFFD y `Buffer.byteLength` deja de igualar al `size` de forma PERMANENTE» [VERIFIED, verbatim].
**Por qué aquí es distinto:** el inbox compara *lectura contra `stat`*, así que la sustitución rompe la igualdad de forma permanente. El CAS del lock compara *lectura contra lectura*: la sustitución es **simétrica** y la igualdad se conserva. **La degradación del precedente NO transfiere.**
**Pero queda un agujero más fino:** dos contenidos distintos cuyos bytes inválidos colapsen ambos a U+FFFD compararían iguales.
**Cómo evitarlo (recomendación, dentro de la discreción de D-01):** leer **sin encoding** — `readFileSync(lockPath)` devuelve un `Buffer` — y comparar con `Buffer.prototype.equals`. El parse se hace aparte sobre `buf.toString('utf-8')` dentro del `try/catch` que ya existe. Coste: cero. Beneficio: la clase entera de fallos por transcodificación desaparece, y «bytes crudos del `readFileSync`» (D-01) se cumple **literalmente**. Un lock corrupto sigue dando `content: null` y sigue siendo robable.

### Pitfall 3 — `statSync` sobre un path que desapareció a mitad de la comprobación

**Qué sale mal:** entre el `readFileSync` fresco y el `statSync` fresco, el holder puede haber hecho `unlink`. `statSync` lanza `ENOENT` y, sin `try/catch`, el error escapa de `stealLock`.
**Cómo evitarlo:** ambas sondas frescas dentro de `try/catch` y degradación a `changed = true` (D-03), literal de `src/inbox/store.js:803-805` (`catch { changed = true; // conservador: si no se puede comprobar, NO se publica }`). Lo mismo en el baseline: `statSync` fallido → `baseIno = null` y se compara solo `raw` (molde de `src/inbox/store.js:740-744`).
**Regla del módulo que hay que respetar:** `86-CONTEXT.md` §Established Patterns lo enuncia como «Never-throws en las sondas: todo `statSync`/`readFileSync` de comprobación va en `try/catch` y degrada a la dirección conservadora».
**Caso límite adicional:** si el **baseline** falla al leer (`raw === null` con `existsSync` verdadero — p. ej. `EACCES`), el CAS no tiene con qué comparar → `changed = true` es la única salida conservadora. Un lock *corrupto* no cae aquí: se lee bien y falla solo al parsear.

### Pitfall 4 — Divergencia de path por symlink en macOS (`/tmp` → `/private/tmp`)

**Qué sale mal:** el harness siembra el lock en `<repoDir>/.planning/.kodo.lock` mientras `acquireGsdLock` opera sobre `<realpath(repoDir)>/.planning/.kodo.lock`: dos ficheros distintos, escenario muerto.
**Por qué ocurre:** `lockPathFor` resuelve el proyecto — `src/gsd/lock.js:199-201`: `return join(realpathSync(projectPath), LOCK_FILE);` [VERIFIED]. Y `mkdtempSync(join(tmpdir(), …))` en macOS entrega rutas bajo `/var/folders/…`, donde `/var` es symlink de `/private/var`.
**Cómo evitarlo:** el harness ya tiene el molde — `test/gsd-lock-race.test.js:79`: `const planning = join(realpathSync(repoDir), '.planning');`, con el comentario `// acquireGsdLock resolves the repo via realpathSync, so seed at the realpath'd location` [VERIFIED: test/gsd-lock-race.test.js:77-80]. **Toda** ruta que el padre o los hijos usen para sembrar, sondear (`waitUntil`) o assertar debe pasar por `realpathSync(repoDir)`.
**Y en producción, la cara opuesta:** **no** replicar `resolvePublishTarget` (`src/inbox/store.js:603-618`) dentro del CAS. Allí resuelve el symlink porque el *fichero del inbox* puede serlo por decisión del operador. Aquí el `renameSync` apunta a `lockPath` tal cual; si el CAS sondease un path resuelto distinto, estaría comprobando un fichero y renombrando otro. **La sonda tiene que apuntar exactamente al destino del `rename`.**

### Pitfall 5 — El `finally` del guard y la salida por `continue`

**Qué sale mal:** una implementación que suelte el guard «a mano» antes del `continue`, o que mueva el `continue` fuera del `try`, deja el guard colgado o lo suelta dos veces.
**Cómo evitarlo:** dejar el `finally` de `src/gsd/lock.js:484-490` intacto y salir por `continue` desde dentro del `try`. `continue` es una salida abrupta del bloque, así que el `finally` corre. El `unlinkSync(guardPath)` ya es best-effort (`catch {}`), de modo que un doble unlink tampoco rompería — pero el diseño correcto es no tener que apoyarse en eso.
**Señal de alarma:** que el segundo intento del bucle acabe sistemáticamente en la rama «guard ocupado» → el guard no se soltó.

### Pitfall 6 — El seam disparándose en cada vuelta

**Qué sale mal:** el hold del test se multiplica por `MAX_STEAL_ATTEMPTS`; con una espera por barrera, el segundo disparo se quedaría esperando un barrier que el padre ya escribió (inocuo) o uno que nunca llegará (timeout × 8).
**Por qué importa aquí más que en el inbox:** cada vuelta extra mantiene el guard tomado más tiempo, acercándose al techo de 5.000 ms de §Patrón 4.
**Cómo evitarlo:** guardar con `attempt === 0`, literal de `src/inbox/store.js:776` — el propio JSDoc del precedente explica el porqué (`:701-703`: «Solo en el PRIMER intento: si se disparase en cada uno, el hold del test se multiplicaría por `MARK_RMW_ATTEMPTS` y el escenario dejaría de converger»).

### Pitfall 7 — Un único barrier: el escenario degrada a verde-sin-medir

**Qué sale mal:** ya desarrollado en §Patrón 3. El creador arranca antes de que el holder libere, entra él mismo en `stealLock`, se estrella contra el guard del aparcado y sale `blocked`. `acquired === 1` se cumple y el CAS no se ejecuta.
**Cómo evitarlo:** tres tiempos + `waitUntil` sobre estado de disco entre etapas + **guard de cobertura** que exija ver el marcador `lock-replaced-mid-steal` al menos una vez por iteración.
**Señales de alarma:** el marcador ausente; o el escenario pasando también con el CAS revertido.
**Precedente que lo hace obligatorio:** `test/inbox-concurrency.test.js:26-31` — «Sin este guard, subir el presupuesto del lock (o estrechar el hold) apaga la cobertura EN SILENCIO: el escenario sigue verde mientras deja de recorrer el código que perdía datos. No es hipotético» [VERIFIED, verbatim].

### Pitfall 8 — El aparcamiento superando `STEAL_GUARD_STALE_MS`

**Qué sale mal:** con N=5, los stealers extra rompen por edad el guard del aparcado (`guardIsStale`, `src/gsd/lock.js:434`, umbral `5_000` ms de `:65`) y entran dos a la sección crítica. El test pasa a medir la carrera de primer orden, ya cerrada.
**Cómo evitarlo:** spawnear los tres roles antes de la primera liberación (el `spawn` y el import dinámico quedan fuera de la ventana), acotar el `waitForBarrier` del seam por debajo de 5.000 ms, y no meter esperas gratuitas en el camino del padre entre t5 y t9.
**Prohibido:** subir `STEAL_GUARD_STALE_MS`. Es exactamente «subir un timeout para que el test pase» (D-16 / DEBT-04).

### Pitfall 9 — Contaminar el contrato de stdout del hijo

**Qué sale mal:** el nuevo `kind` imprime dos veces, o imprime diagnósticos por stdout, y el padre —que hace `outputs[i] += d.toString()` y luego `.trim()`— agrega basura al veredicto.
**Cómo evitarlo:** un único `process.stdout.write` por hijo; todo lo demás por canal lateral en fichero, con su propio `try/catch`, después del veredicto lógico. El molde está en `test/helpers/lock-race-child.mjs:241-252` con su comentario: «Canal LATERAL: va después del veredicto lógico, en su propio try/catch, y su fallo nunca cambia lo que este hijo imprime ni lo hace lanzar» [VERIFIED, verbatim].
**Ojo con stderr:** los hijos se spawnean con `stdio: ['ignore','pipe','inherit']` (`test/gsd-lock-race.test.js:52`), así que los `console.error` de `[kodo:lock]` —incluido el `reason` nuevo de D-09— salen por la consola del runner. Es ruido esperado, no un fallo; el `reason` **no** debe assertarse capturando stderr sino por el marcador de canal lateral.

### Pitfall 10 — Asertar sobre quién gana

**Qué sale mal:** un assert del tipo «el stealer sale `blocked`» ata el test al scheduling.
**El matiz de esta fase:** el criterio 1 de la ROADMAP pide que «el lock que sobrevive en disco es el del creador». Eso **no** es asertar sobre el ganador de una carrera: en este escenario los roles son asimétricos **por construcción** (el stealer está aparcado por una barrera que el padre controla), así que el resultado es determinista, no una coincidencia de scheduling. Recomendación para el planner: la aserción **canónica** es la de cardinalidad (`acquired === 1`, D-14); la del `session_id` en disco se añade **con un comentario que justifique por qué no viola D-14**. Sin ese comentario, un revisor futuro la leerá como una infracción y la borrará.
**Disciplina heredada:** `test/gsd-lock-race.test.js:8` — «Asserts on the AGGREGATE, never on which child wins» [VERIFIED].

---

## Code Examples

> Todos los fragmentos siguientes son **esqueletos derivados** de los patrones citados, con los nombres de identificador dejados a la discreción del planner (`86-CONTEXT.md` §Claude's Discretion). Los valores literales (`8`, `5_000`, `'lock-replaced-mid-steal'`, `.steal-guard`) están citados en §Standard Stack y §User Constraints.

### El lector interno de una pasada (D-01)

```js
/**
 * Lee el lock en UNA pasada y devuelve su identidad completa:
 *   raw     — los bytes CRUDOS (Buffer, sin transcodificar), base de la comparación de D-02
 *   content — el parse, o `null` si es corrupto (la rama PRESENT lo trata como robable)
 *   ino     — statSync(path).ino tomado INMEDIATAMENTE DESPUÉS de la lectura, o null
 *
 * ORDEN CRÍTICO (src/inbox/store.js:662-665): los bytes salen de LA LECTURA, jamás de un
 * statSync separado. Un cambio que aterrice entre el readFileSync y ese stat entraría en el
 * baseline y dejaría el guard ciego justo ante el caso que debe detectar.
 *
 * @param {string} path
 * @returns {{ raw: Buffer|null, content: LockContent|null, ino: number|null }}
 */
function readLockIdentity(path) {
  /** @type {Buffer|null} */ let raw = null;
  try { raw = readFileSync(path); } catch { raw = null; }

  /** @type {LockContent|null} */ let content = null;
  if (raw !== null) {
    try { content = JSON.parse(raw.toString('utf-8')); } catch { content = null; }
  }

  /** @type {number|null} */ let ino = null;
  try { ino = statSync(path).ino; } catch { ino = null; } // sin componente de inodo; raw sigue vigente

  return { raw, content, ino };
}
```

### El CAS en la rama PRESENT (D-02, D-03, D-05, D-06, D-09)

```js
// ── Sección crítica, serializada por el guard ──
try {
  const base = readLockIdentity(lockPath);          // D-01: baseline de LA lectura
  const current = base.content;

  // Seam de test (D-10): solo en el primer intento, dentro de la sección crítica,
  // tras la lectura del baseline y antes de escribir el tmp. Default no-op.
  if (attempt === 0 && typeof deps._afterCriticalReadFn === 'function') {
    deps._afterCriticalReadFn();
  }

  if (current && !isStaleLock(current)) return { acquired: false, holder: current };

  if (existsSync(lockPath)) {
    const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
    let aborted = null;                              // holder fresco detectado, o null
    let changed;
    try {
      writeFileSync(tmp, serializeLockContent(sessionInfo));

      // ORDEN INAMOVIBLE (src/inbox/store.js:787-789): escribir el tmp → sonda FRESCA →
      // comparar → renombrar. Comparar antes del tmp dejaría fuera de la ventana vigilada
      // el propio coste de la escritura.
      const fresh = readLockIdentity(lockPath);
      if (fresh.raw === null || base.raw === null) {
        changed = true;                              // D-03: sin poder comprobar, NO se publica
      } else {
        changed = !fresh.raw.equals(base.raw)
          || (base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino);
      }

      if (changed) {
        try { unlinkSync(tmp); } catch { /* best-effort */ }
        // D-06: si el contenido nuevo es un holder VIVO y fresco, corte inmediato.
        // Reutiliza el parse de la sonda fresca — no hace falta una tercera lectura.
        if (fresh.content && !isStaleLock(fresh.content)) aborted = fresh.content;
      } else {
        renameSync(tmp, lockPath);
      }
    } catch (err) {
      try { unlinkSync(tmp); } catch { /* best-effort */ }
      throw err;
    }

    if (aborted) {
      console.error(
        `[kodo:lock] Steal abortado: el lock fue reemplazado durante la sección crítica ` +
        `(ahora lo tiene ${aborted.task_ref})`,
      );
      return { acquired: false, holder: aborted, reason: 'lock-replaced-mid-steal' };
    }
    if (changed) continue;                           // D-05: re-contender; el finally suelta el guard
    return { acquired: true };
  }

  // … rama ABSENT sin cambios (src/gsd/lock.js:473-483) …
} finally {
  try { unlinkSync(guardPath); } catch { /* best-effort */ }
}
```

### El typedef ampliado aditivamente (D-08)

```js
/**
 * @typedef {{ acquired: true }
 *          | { acquired: false, holder: LockContent, reason?: string }} AcquireResult
 *
 * `reason` es ADITIVO y OPCIONAL. Único valor por ahora: 'lock-replaced-mid-steal'.
 * El único consumidor de la variante rechazada (src/triggers/dispatcher.js:200-203) lee
 * solo `.holder`, así que ningún call site cambia.
 */
```

### El seam propagado por deps (D-11)

```js
/**
 * @param {string} projectPath
 * @param {SessionInfo} sessionInfo
 * @param {{ _afterCriticalReadFn?: () => void }} [deps] — SEAM DE TEST, no característica.
 *   Se invoca dentro de la sección crítica del steal, tras la lectura del baseline y antes de
 *   escribir el tmp; SOLO en el primer intento del bucle (si se disparase en cada uno, la ventana
 *   se multiplicaría por MAX_STEAL_ATTEMPTS y el escenario dejaría de converger — mismo motivo
 *   que src/inbox/store.js:701-703). Default no-op.
 * @returns {AcquireResult}
 */
export function acquireGsdLock(projectPath, sessionInfo, deps = {}) { … }
```

Los **tres** call sites internos de `stealLock` deben propagar `deps`: `src/gsd/lock.js:137` (corrupto), `:142` (PID muerto) y `:154` (TTL vencido) [VERIFIED: src/gsd/lock.js:137, 142, 154].

### El guard de cobertura del harness (molde de `test/inbox-concurrency.test.js:241-253`)

```js
/**
 * GUARD DE COBERTURA. El escenario existe para ejercitar el CAS; si ninguna iteración
 * registra el reason discriminado, está verde SIN haber probado nada — exactamente el modo
 * de fallo que 83-06 midió (18/18 coordinadas, cero fail-open).
 * El arreglo ante un rojo aquí es revisar la SECUENCIACIÓN de los tres tiempos, JAMÁS borrar
 * ni relajar esta aserción.
 */
function assertCasExercised(dir, ctx) {
  const reasons = readReasonMarkers(dir);            // canal lateral: steal-reasons.log
  assert.ok(
    reasons.filter((r) => r === 'lock-replaced-mid-steal').length >= 1,
    `COBERTURA PERDIDA: ninguna adquisición abortó por CAS en esta iteración …\n${ctx}`,
  );
}
```

---

## Blast Radius — consumidores y qué NO puede cambiar (criterio 5)

**Inventario completo de importadores de `src/gsd/lock.js`** [VERIFIED: grep sobre `src/` y `test/` esta sesión, más lectura directa de cada call site]:

| Consumidor | Qué importa | Qué lee del resultado | Impacto del cambio |
|------------|-------------|------------------------|--------------------|
| `src/triggers/dispatcher.js:10` | `acquireGsdLock`, `releaseGsdLock` | `lockResult.acquired` (`:200`) y `lockResult.holder` (`:202`: `return { action: 'gsd_locked', holder: lockResult.holder }`) | **Ninguno.** `reason` es opcional y nadie hace check exhaustivo. **Único lector de `.holder` en todo el repo.** |
| `src/triggers/dispatcher.js:51` (typedef `DispatchDeps`) | Firma inline `(projectPath, sessionInfo) => {acquired: boolean, holder?: object}` | — | **Ninguno.** Un tercer parámetro **opcional** sigue siendo asignable a una firma de dos parámetros (regla estructural: la fuente no puede tener más parámetros *requeridos* que el destino). Además el repo no tiene `tsconfig.json` ni script de typecheck [VERIFIED: `ls tsconfig.json jsconfig.json` sin resultados; `package.json` solo declara `test`], así que `// @ts-check` es advisory de editor. **No tocar el typedef del dispatcher** (D-08). |
| `src/hooks/stop.js:238-239` | `releaseGsdLock` (import dinámico) | — | **Ninguno.** `releaseGsdLock` no se toca. |
| `src/hooks/session-end.js:206-207` | `releaseGsdLock` (import dinámico) | — | **Ninguno.** |
| `src/cli/polling.js:32`, `src/daemon/lifecycle.js:38`, `src/session/state-lock.js:11` | solo `isPidAlive` | — | **Ninguno.** `isPidAlive` no se toca. |
| `src/gsd/doctor.js:240-258` (`decideLock`) | Espejo declarado de `acquireGsdLock` («espejo EXACTO … PID muerto → 'steal'; TTL vencido → 'steal'; PID vivo + TTL ok → 'keep'») | — | **Ninguno, y verificado:** `decideLock` es un predicado puro sobre un `LockContent` y decide **si un lock es robable**. El CAS no cambia esa decisión: cambia **qué hace el stealer cuando el fichero cambió bajo sus pies**, que es un estado que `decideLock` nunca observa (lee un snapshot vía `d.readLock`, `:349` y `:556`). El espejo sigue siendo espejo. |
| `src/gsd/doctor.js:349, 556` | `readLock` (por deps) | `LockContent` | **Ninguno.** `readLock` no se toca. |
| `test/helpers/lock-race-child.mjs:403-409` | `acquireGsdLock` con 2 argumentos | `result.acquired` | **Ninguno** para el `kind: 'gsd'` existente; los `kind` nuevos añaden el tercer argumento. |
| `test/gsd-lock.test.js`, `test/gsd-lock-guard.test.js`, `test/gsd-concurrency.test.js`, `test/dispatcher.test.js` | `acquireGsdLock` con 2 argumentos, o stubs `acquireGsdLockFn` | `.acquired`, `.holder` | **Ninguno.** Ningún stub necesita devolver `reason`; ningún assert lo exige. |

**Guards de código fuente que el planner debe respetar:**

- `test/gsd-concurrency.test.js:483-520` — guard cross-callsite que hace `/acquireGsdLockFn?\s*\([^)]*worktree/i` sobre `dispatcher.js`, `manager.js` y `stop.js` [VERIFIED: leído esta sesión]. Como D-11 es aditivo y **ningún call site de producción pasa deps**, el guard queda intacto. Si el planner decidiese pasar deps desde el dispatcher (no hace falta), el argumento no puede contener la subcadena `worktree`.
- `test/gsd-inspect-cli.test.js:296-297` — asegura que `src/cli/gsd-inspect.js` **no** importa `acquireGsdLock`/`releaseGsdLock`. No afectado.
- `test/stop.test.js:47-170` — asserts de orden sobre `releaseGsdLock(session.project_path` en `session-end.js`. No afectado.
- `test/check-isolation.test.js:160` menciona `gsd/lock.js` en un comentario de exclusión. No afectado.

**Documentación:** ni `.planning/codebase/*.md` ni `README.md` mencionan `gsd/lock`, `stealLock` ni `.kodo.lock` [VERIFIED: grep sin resultados esta sesión]. La única superficie documental a actualizar es la que D-17 nombra: el JSDoc de `stealLock` y `.planning/STATE.md`.

---

## Fuera de alcance — hallazgos vecinos que NO se arreglan

`82-REVIEW.md` dejó cuatro hallazgos menores además de CR-01. **Ninguno está en LOCK-04..07** y v0.20 es saneo puro sin feature nueva: el propio `86-CONTEXT.md` §Specific Ideas ordena que «cualquier cosa que parezca "ya que estamos" debe ir a `<deferred>`». Se listan aquí para que el planner los reconozca y los deje pasar deliberadamente:

| Hallazgo | Estado a HEAD | Por qué no entra |
|----------|---------------|------------------|
| **WR-01** — `stealLock` loguea `Lock stolen` como primera sentencia (`src/gsd/lock.js:425`) incluso cuando acaba rechazando | **Sigue vigente** [VERIFIED: src/gsd/lock.js:425] | Es observabilidad, no el invariante. Tocarlo cambia la salida que otros tests podrían leer. |
| **WR-02** — guard parseable con `pid` finito y `ts` no finito nunca es rompible por edad (`:345-348`) | **Sigue vigente** [VERIFIED: src/gsd/lock.js:343-357] | Es la máquina del **guard**, no la rama PRESENT. |
| **IN-01** — el JSON parseado no se valida como objeto (`:103, 135, 246, 275`) | **Sigue vigente** | Pre-existente. **Caveat para el planner:** el lector nuevo de D-01 no debe *empeorarlo* — con `content` a `null` ante parse fallido queda al mismo nivel que `readLockContent`. |
| **IN-02** — el caso (e) de `gsd-lock-guard.test.js` no asserta `result.holder` | **Sigue vigente** [VERIFIED: test/gsd-lock-guard.test.js:203-215] | Fichero fuera del alcance de D-13, que dirige los casos nuevos a `gsd-lock-race.test.js`. |

---

## State of the Art (linaje interno del invariante)

| Enfoque anterior | Enfoque actual | Cuándo cambió | Impacto |
|------------------|----------------|---------------|---------|
| Move-aside con `renameSync` dejando `lockPath` ausente una ventana | Propiedad **solo** por `renameSync(tmp→lockPath)`; move-aside eliminado | Phase 82 (`STATE.md:90`) | Cerró la carrera de primer orden (dos `O_EXCL` ganando a la vez). |
| Steal-guard publicado con `writeFileSync({flag:'wx'})` | Steal-guard publicado atómicamente en contenido vía `linkSync(tmp→guardPath)` | Phase 82 rework, commit `16d60b6` (`STATE.md:92`) | El `wx` abría un fichero vacío y luego escribía: un lector concurrente veía un guard vacío, lo declaraba stale y rompía un guard VIVO. |
| Cerrar el lost-update del inbox subiendo el presupuesto de reintentos | **Guard compare-and-swap anclado al estado del fichero** (bytes + `ino`), presupuesto devuelto a los defaults | Phase 83-04, revirtiendo 83-03 (`STATE.md:102-106`) | «Ese arreglo NO cerró el lost-update, solo movió el umbral». Es el precedente que esta fase transporta. |
| Confiar en que el escenario de concurrencia ejerció la rama que dice ejercer | Marcador de rama por canal lateral + guard de cobertura + liberación en dos tiempos | Phase 83-06 (`STATE.md:114, 116`) | Sin el guard, la cobertura se apagó en silencio (18/18 coordinadas). |
| Rama PRESENT con `renameSync` incondicional + comentario que niega la carrera | **CAS simétrico + comentario retirado** | **Esta fase** | Cierra R-82-01 sin rediseñar el primitivo. |

**Obsoleto tras esta fase:**
- El comentario de `src/gsd/lock.js:455-457` («No fresh Case-1 creator can race here…»). D-18.
- La afirmación implícita de que el harness de carrera cubre el steal: solo cubre el **dead-PID** steal (`test/gsd-lock-race.test.js:74-118`, `raceGsdStealDeadHolder`).

---

## Environment Availability

| Dependencia | Requerida por | Disponible | Versión | Fallback |
|-------------|---------------|-----------|---------|----------|
| Node.js | Todo | ✓ | Engine declarado `>=20.0.0` [VERIFIED: package.json engines] — la suite corrió verde esta sesión, así que el runtime local lo cumple | — |
| `node:test` runner | Suite | ✓ | built-in | — |
| `Atomics.wait` / `SharedArrayBuffer` | Barreras y holds síncronos | ✓ | built-in | `sleepShort` ya degrada con `catch { /* SharedArrayBuffer unavailable — skip the backoff */ }` (`src/gsd/lock.js:381-385`); el helper de test no degrada — es requisito duro allí, y ya lo era antes de esta fase |
| Filesystem POSIX con `link(2)` y `rename(2)` atómicos | El guard y la publicación del lock | ✓ | APFS local / ext4 en CI | — |
| Servicios externos (red, DB, Docker, GitHub, Plane) | — | N/A | — | Esta fase no toca ninguno |

**Dependencias ausentes sin fallback:** ninguna.
**Dependencias ausentes con fallback:** ninguna.

---

## Validation Architecture

*(`nyquist_validation` está activo: `.planning/config.json` declara `"workflow": { …, "nyquist_validation": true }` [VERIFIED: .planning/config.json, leído esta sesión].)*

### Test Framework

| Propiedad | Valor |
|-----------|-------|
| Framework | `node:test` (runner nativo) + `node:assert/strict` |
| Fichero de config | ninguno — convención `test/**/*.test.js` |
| Quick run command | `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js test/gsd-lock.test.js` |
| Full suite command | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| Runtime estimado | ~5 s (quick, con los escenarios nuevos) · ~22 s (suite completa) |
| **Baseline a HEAD** | **2.590 tests · 2.589 pass · 0 fail · 1 skipped · 588 suites · 21,6 s** [VERIFIED: `npm test` ejecutado esta sesión] |
| Baseline del subconjunto de lock | `gsd-lock.test.js` + `gsd-lock-guard.test.js`: 33 pass / 0 fail (2,3 s); `gsd-lock-race.test.js`: 4 pass / 0 fail (2,3 s) [VERIFIED: ejecutados esta sesión] |

### Mapa Requisito → Test

| Req | Comportamiento | Tipo de test | Comando automatizado | ¿Existe el fichero? |
|-----|----------------|--------------|----------------------|---------------------|
| **LOCK-04** (a) | El CAS aborta en vez de clobbear con holder VIVO que libera + creador Case-1 legítimo; el lock en disco es el del creador | **integración, procesos reales** (extiende) | `node --test test/gsd-lock-race.test.js` | ✅ `test/gsd-lock-race.test.js` — se extiende con `describe` propio (D-13) |
| **LOCK-04** (b) | El abort devuelve `reason: 'lock-replaced-mid-steal'` y lo emite por `[kodo:lock]` | **integración**, vía marcador de canal lateral | `node --test test/gsd-lock-race.test.js` (guard de cobertura `assertCasExercised`) | ✅ se extiende |
| **LOCK-04** (c) | El CAS **no** aborta cuando nada cambió (sin regresión del steal dead-PID) | **regresión existente** | `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js` (los 4 + 6 casos actuales siguen verdes) | ✅ existen, no se tocan |
| **LOCK-04** (d) | El corrupto sigue siendo robable con el CAS puesto (`content: null` no bloquea la rama PRESENT) | **unit** (extiende) | `node --test test/gsd-lock.test.js` (caso `steals lock when file contains corrupt JSON`, `:136-148`) | ✅ existe; el planner decide si añade un caso explícito con el seam |
| **LOCK-05** (a) | Se siembra un holder **VIVO** (TTL vencido + PID vivo), nunca `DEAD_PID` | **source-assert** + integración | `grep -c 'DEAD_PID' test/gsd-lock-race.test.js` = 0 · `node --test test/gsd-lock-race.test.js` | ✅ se extiende |
| **LOCK-05** (b) | Cardinalidad exacta con N≥2 y N=5 | **integración, procesos reales** | `node --test test/gsd-lock-race.test.js` | ✅ se extiende |
| **LOCK-05** (c) | El escenario ejercitó de verdad la rama del CAS (anti-degradación silenciosa) | **guard de cobertura** | incluido en el mismo comando; falla con mensaje propio si el marcador no aparece | ➕ se crea (marcador + lector) |
| **LOCK-06** | Revertir el CAS a mano pone el harness **ROJO** | **MANUAL-ONLY con evidencia citada (D-15)** | `git stash`/edición manual → `node --test test/gsd-lock-race.test.js` debe salir `# fail ≥1` → revert. Evidencia (diff + salida roja + salida verde restaurada) en el `SUMMARY` | N/A — no automatizable sin mutation testing, diferido |
| **LOCK-06** (b) | No se debilitó ningún assert, timeout ni presupuesto | **source-assert** | `grep -c 'MAX_STEAL_ATTEMPTS = 8' src/gsd/lock.js` = 1 · `grep -c 'STEAL_GUARD_STALE_MS = 5_000' src/gsd/lock.js` = 1 · `git diff` sobre los asserts existentes vacío | ✅ existen |
| **LOCK-07** (a) | La ventana residual está declarada en el JSDoc de `stealLock` con su clase de riesgo nombrada | **source-assert** | `grep -c 'TOCTOU' src/gsd/lock.js` ≥ 1 · `grep -c 'Phase 83' src/gsd/lock.js` ≥ 1 (referencia a la misma clase de ventana) | ✅ existe |
| **LOCK-07** (b) | Está declarada también en `STATE.md` | **source-assert** | `grep -c 'ventana residual' .planning/STATE.md` ≥ 1 + `gsd-tools query state.validate` → `valid: true` | ✅ existe |
| **LOCK-07** (c) | El comentario de premisa falsa desapareció (D-18) | **source-assert** | `grep -c 'No fresh Case-1 creator can race here' src/gsd/lock.js` = 0 | ✅ existe |
| **Criterio 5** | Suite completa verde y consumidores intactos | **suite completa + source-assert** | `npm test` → ≥ 2.590 tests, 0 fail · `git diff --exit-code src/triggers/dispatcher.js src/gsd/doctor.js src/hooks/` | ✅ existe |

### Sampling Rate

- **Por commit de tarea:** `node --test test/gsd-lock-race.test.js test/gsd-lock-guard.test.js test/gsd-lock.test.js` (~5 s).
- **Por merge de wave:** `npm test` (~22 s).
- **Phase gate:** suite completa verde (≥ 2.590 tests, 0 fail) antes de `/gsd-verify-work`, **más** la evidencia manual de la mordida (LOCK-06) ya registrada en el `SUMMARY`.
- **Latencia máxima de feedback:** ~22 s.

### Wave 0 Gaps

- [ ] `test/helpers/lock-race-child.mjs` — `kind`(s) nuevo(s): holder stale-pero-vivo con release bajo barrera, y stealer con seam. Cubre LOCK-05.
- [ ] `test/gsd-lock-race.test.js` — orquestación de tres tiempos + lector de marcadores + `assertCasExercised`. Cubre LOCK-04/05.
- [ ] Marcador de canal lateral (p. ej. `steal-reasons.log`) y su lector en el padre. Cubre LOCK-04(b)/05(c).

*(No hay hueco de framework: `node:test` ya cubre todo y no se instala nada.)*

### Manual-Only (contabilizado, no ocultado)

| Item | Por qué no es automatizable | Evidencia exigida |
|------|------------------------------|-------------------|
| **LOCK-06** — la mordida | Automatizarla es mutation testing = infraestructura nueva, prohibida en v0.20 y ya diferida con trigger en `86-CONTEXT.md` §Deferred | Diff exacto de la reversión + salida `# fail` del runner con el mensaje del assert + salida verde tras restaurar, citados en el `SUMMARY`/`VERIFICATION` (precedente: `83-VERIFICATION.md:78`, `STATE.md:113`) |
| **LOCK-07** — que la redacción sea honesta | Un `grep` verifica presencia, no honestidad | Revisión del texto en el `VERIFICATION`, comprobando los 4 elementos de D-17 (qué es · clase nombrada · qué cambia · no-cierre-por-construcción) |

---

## Security Domain

*(`security_enforcement` no aparece en `.planning/config.json`; ausente = habilitado.)*

### Categorías ASVS aplicables

| Categoría ASVS | ¿Aplica? | Control estándar aquí |
|----------------|----------|------------------------|
| V2 Authentication | no | El lock no autentica a nadie; la identidad es un `session_id` local |
| V3 Session Management | **parcial** | El `session_id` del lock **es** el token de propiedad. `releaseGsdLock` solo borra si `existing.session_id === sessionId` (`src/gsd/lock.js:187-189`). El CAS **refuerza** esta propiedad: impide que un tercero se convierta en owner sobre un lock ajeno |
| V4 Access Control | no | Sin roles ni permisos |
| V5 Input Validation | **sí** | El contenido del lock es JSON no confiable (fichero editable a mano). Se valida con `JSON.parse` en `try/catch` → `null` = corrupto = robable. **IN-01 sigue abierto** (un primitivo JSON pasa el parse); esta fase no debe empeorarlo |
| V6 Cryptography | no | Nada criptográfico. `randomUUID()` se usa para unicidad de nombre de `tmp`, no como secreto |
| V12 Files & Resources | **sí** | Toda la fase. Ver tabla de amenazas |

### Patrones de amenaza conocidos para este stack

| Patrón | STRIDE | Mitigación estándar |
|--------|--------|----------------------|
| **TOCTOU en publicación por rename** (la carrera de esta fase) | Tampering | Compare-and-swap sobre identidad de fichero inmediatamente antes del `rename` + degradación conservadora. Ventana residual **declarada** (LOCK-07), no silenciada |
| Reutilización de inodo tras `unlink`+create | Tampering | Comparación de bytes crudos **además** del `ino` (D-02) |
| Fichero temporal predecible / colisión de `tmp` | Tampering | Nombre único por escritor: `` `${lockPath}.tmp.${process.pid}.${randomUUID()}` `` (`src/gsd/lock.js:458`). Ya en vigor; el CAS lo conserva |
| Residuo de `tmp` en fallo | Information disclosure (menor) / higiene | `unlinkSync(tmp)` best-effort en **todos** los caminos, incluido el abort del CAS (D-03) |
| Guard huérfano bloqueando el steal para siempre | Denial of service | Rompible por PID muerto (primario) o edad (`STEAL_GUARD_STALE_MS`). **WR-02 de 82-REVIEW documenta un agujero residual** (`ts` no finito) — fuera de alcance, no reintroducir |
| Doble owner del lock GSD | Tampering / integridad | El invariante de la fase. Aserción de cardinalidad exacta con procesos reales |
| Escalada por symlink en el destino del `rename` | Tampering | `lockPathFor` resuelve el proyecto con `realpathSync`. **No** añadir una segunda resolución sobre el `lockPath` — ver §Pitfall 4 |

**Nota de superficie:** la fase **no** introduce entrada de red, ni ejecución de comandos, ni contenido de LLM hacia terminal. El invariante «Contenido LLM hacia terminal/keystroke SIEMPRE saneado» (`.planning/STATE.md:159`) no se ve afectado. El `reason` nuevo es una constante literal del propio módulo, no contenido de terceros — pero el `console.error` que lo acompaña **no debe interpolar el contenido crudo del lock** más allá de campos ya interpolados hoy (`existing.task_ref` en `:151`), para no abrir un vector de inyección de control chars por un `.kodo.lock` editado a mano.

---

## Assumptions Log

| # | Afirmación | Sección | Riesgo si es incorrecta |
|---|-----------|---------|--------------------------|
| A1 | Un `waitForBarrier` dentro del seam mantiene el aparcamiento del stealer holgadamente por debajo de los 5.000 ms de `STEAL_GUARD_STALE_MS` en la máquina de CI, dado que `spawn` e import dinámico se pagan antes de la ventana | §Patrón 4, §Pitfall 8 | Con máquinas muy cargadas, un stealer extra del caso N=5 podría romper el guard por edad y el escenario mediría la carrera de primer orden. **Mitigación:** el guard de cobertura lo detecta (dejaría de aparecer el marcador de `reason`), y el planner puede acotar N=5 a *un solo* stealer + 3 observadores no-stealer si hiciera falta |
| A2 | El marcador `stealer-parked` escrito desde dentro del seam es un indicador estrictamente más fuerte que la existencia del `.steal-guard` para el `ready()` del padre | §Patrón 3 t3 | Si se optase por el guard, hay un caso de lectura ambigua (el guard podría venir de un intento previo). No es un riesgo de corrección, sí de flakiness |
| A3 | `Buffer.prototype.equals` sobre ~200 bytes es coste despreciable frente al `readFileSync` que ya se paga | §Pitfall 2 | Ninguno práctico; si se midiera lo contrario, `size`+`ino` sigue disponible pero reintroduce el falso negativo que D-02 cierra |
| A4 | Ningún consumidor futuro hará `switch` exhaustivo sobre la variante rechazada de `AcquireResult` | §Blast Radius | Un `reason` opcional no rompería nada aunque lo hicieran; el riesgo es cero en la práctica |
| A5 | La sección de `STATE.md` donde aterriza la declaración de LOCK-07 (§Critical Invariants) es direccionable por algún handler de `gsd-tools` | §Patrón 6 | `STATE.md:141` documenta que §Deferred Items **no** lo es. Si §Critical Invariants tampoco lo fuera, el precedente de 85-05 (mutación por `Edit` + `state.validate`) es la salida ya aceptada |

---

## Open Questions

1. **¿Un plan o dos?** (`86-CONTEXT.md` lo deja a discreción del planner.)
   - Lo que se sabe: la restricción es que el harness pueda ponerse rojo con el CAS revertido.
   - Lo que no está claro: si el harness sin CAS es escribible de forma útil antes de que exista el seam — **no lo es**: el seam vive en producción (D-10/D-11) y sin él no hay determinismo. Un «harness-primero» estricto exigiría el seam primero.
   - Recomendación: **un solo plan con tres tareas ordenadas** — (T1) seam + lector interno + typedef, sin CAS; (T2) harness completo, que debe salir **ROJO** contra T1 (es la mordida, capturada en el momento en que es natural capturarla); (T3) CAS + JSDoc + `STATE.md`, que pone T2 verde. Así LOCK-06 se documenta sin una reversión artificial posterior — aunque D-15 exige igualmente la reversión manual a HEAD final como evidencia canónica. Alternativa igualmente válida: dos planes con la mordida al final del segundo.

2. **¿Qué composición exacta para el caso N=5 de D-14?**
   - Lo que se sabe: `acquired === 1` sobre el agregado; los roles asimétricos son 1 holder + 1 creador + M stealers.
   - Lo que no está claro: si los stealers extra deben ir todos con seam (aparcados) o solo el primero.
   - Recomendación: **un solo stealer con seam**; los demás sin seam, que contenderán por el guard y saldrán `blocked` por presupuesto. Que varios se aparquen a la vez es imposible por construcción (el guard los serializa) y multiplicaría el riesgo de A1.

3. **¿Se añade un unit determinista in-process además del test de procesos reales?**
   - Lo que se sabe: `test/gsd-lock-guard.test.js:11-16` declara que los casos in-process son deterministas por diseño y que la propiedad concurrente **no** se cubre ahí.
   - Recomendación: opcional y de bajo coste — con el seam se puede escribir un unit in-process donde el propio callback del seam hace `unlinkSync(lockPath)` + `writeFileSync(lockPath, <lock fresco de otro>)`, y assertar `{acquired:false, reason:'lock-replaced-mid-steal'}` sin ningún proceso hijo. Sería el test **más rápido y más determinista** de toda la fase, y muerde igual de bien. **No sustituye** al de procesos reales que LOCK-05 exige literalmente («harness … con N≥2 procesos»), pero lo complementa muy barato. Fichero natural: `test/gsd-lock-guard.test.js` — salvo que D-13 se lea como exclusivo, en cuyo caso va al `describe` nuevo de `gsd-lock-race.test.js`.

---

## Project Constraints (de CLAUDE.md)

**No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en este repo** [VERIFIED: `ls` sin resultados esta sesión]. Aplican las instrucciones globales del operador, de las que son accionables aquí:

- **Cambios quirúrgicos:** tocar solo lo necesario; no «mejorar» código adyacente, comentarios ni formato. Refuerza el §Fuera de alcance de esta research.
- **Simplicidad primero:** código mínimo que resuelva el problema, sin abstracciones para un solo uso. Refuerza el diferido de «unificar el patrón CAS en un helper compartido».
- **Sé crítico:** no dar la razón por defecto. Aplicado en esta research a D-01 (se recomienda `Buffer` en vez de string) y al seam (se recomienda barrera en vez de sleep) — ambas dentro del margen de discreción, ninguna contradice una decisión LOCKED.
- **Documentación en español** para el corpus `.planning/`; código, identificadores y paths en inglés.

**Skills del proyecto** (`.claude/skills/`): `kodo-orchestrate`, `kodo-capture`, `worktree-cleanup` [VERIFIED: `ls` esta sesión]. Ninguna aporta reglas que condicionen esta fase; `worktree-cleanup` es local y no distribuible (ver la allowlist congelada de Phase 84).

---

## Sources

### Primarias (HIGH confidence) — código leído esta sesión con `Read`

- `src/gsd/lock.js` (510 líneas, íntegro) — `acquireGsdLock:116-159`, `releaseGsdLock:174-191`, `lockPathFor:199-201`, `readLockContent:244-250`, `isStaleLock:259-264`, `acquireStealGuard:303-321`, `guardIsStale:343-357`, `stealLock:424-508`, constantes `:55-65`, typedef `:36-53`.
- `src/inbox/store.js:590-839` — `resolvePublishTarget:603-618`, JSDoc del guard CAS `:651-709`, seam `_afterReadFn:698-703`, implementación `:710-839`.
- `test/gsd-lock-race.test.js` (163 líneas, íntegro) — `raceGsdChildren:41-64`, `raceGsdStealDeadHolder:74-118`.
- `test/helpers/lock-race-child.mjs` (427 líneas, íntegro) — contrato `:14-18`, argv `:72-94`, `sleepSync:115-118`, `waitForBarrier:120-130`, marcador lateral `:241-252`, `kind gsd:402-409`, hold `:415-420`.
- `test/gsd-lock-guard.test.js` (239 líneas, íntegro) — `DEAD_PID:39`, `writeStaleDeadLock:80-89`, casos (a)-(f).
- `test/inbox-concurrency.test.js:1-255` — cabecera y disciplina `:1-62`, constantes `:85-115`, `waitUntil:133-140`, `raceChildren:142-192`, `readBranchCounts:210-224`, `assertFailopenExercised:226-253`.
- `test/gsd-concurrency.test.js:478-521` — guard source-hygiene WT-03.
- `test/gsd-lock.test.js:95-160` — recetas de siembra (dead-PID, TTL vencido con PID vivo, corrupto).
- `src/triggers/dispatcher.js:40-89, 185-224` — typedef `DispatchDeps`, resolución de deps, call site del lock.
- `src/gsd/doctor.js:228-277` — `decideLock`.
- `package.json`, `.planning/config.json` — scripts, deps, engines, toggles de workflow.
- **Ejecución real esta sesión:** `npm test` → 2.589 pass / 0 fail / 1 skipped / 588 suites / 21,6 s. `node --test test/gsd-lock.test.js test/gsd-lock-guard.test.js` → 33 pass. `node --test test/gsd-lock-race.test.js` → 4 pass.

### Primarias — corpus de planificación leído esta sesión

- `.planning/phases/86-*/86-CONTEXT.md` — D-01..D-18, canonical refs, deferred.
- `.planning/REQUIREMENTS.md` — LOCK-04..07 literales `:12-15`; `LOCK-F1` diferido `:40`; Out of Scope `:57-64`.
- `.planning/STATE.md` — invariantes cross-milestone `:149-163`, linaje de decisiones `:90-143`, fila R-82-01 `:62`, caveat de mutación `:141`.
- `.planning/milestones/v0.19-phases/82-*/82-REVIEW.md` — CR-01 íntegro con el interleaving de 5 pasos, WR-01, WR-02, IN-01, IN-02.
- `.planning/milestones/v0.19-phases/83-*/83-VERIFICATION.md` — formato de registro de mordida.
- `.planning/milestones/v0.19-phases/85-*/85-VALIDATION.md` — molde de Per-Task Verification Map y de fila Manual-Only.

### Secundarias (MEDIUM)

Ninguna. **No se ha hecho ninguna búsqueda web ni consulta a documentación externa**: la fase es hardening puro sobre código propio y el brief lo ordenaba explícitamente. Las afirmaciones sobre POSIX (`rename` atómico, `renameat2` Linux-only) son conocimiento de entrenamiento y están marcadas como tales.

### Terciarias (LOW) — conocimiento de entrenamiento, sin verificar en esta sesión

- `rename(2)` POSIX es atómico dentro del mismo sistema de ficheros y no admite condición. [ASSUMED]
- `renameat2(RENAME_NOREPLACE)` existe solo en Linux y `node:fs` no lo expone. [ASSUMED]
- La reutilización de inodo tras `unlink`+create es un comportamiento real de ext4/APFS. [ASSUMED]
- `continue` dentro de un `try` ejecuta el `finally` asociado (semántica ECMAScript de salida abrupta). [ASSUMED]
- En TypeScript, una función con un tercer parámetro **opcional** es asignable a un tipo de función de dos parámetros. [ASSUMED] — irrelevante en la práctica: el repo no tiene typecheck en CI [VERIFIED].

---

## Metadata

**Desglose de confianza:**

- **Stack estándar:** HIGH — cero dependencias nuevas, verificado contra `package.json` y contra el invariante de `STATE.md:163`.
- **Arquitectura (forma del CAS):** HIGH — transporte literal de un patrón en producción, leído línea a línea, con la única divergencia que D-02 ya decidió y justificó.
- **Arquitectura (orquestación del harness):** MEDIUM-HIGH — la secuencia de tres tiempos es una extensión razonada de un precedente de dos tiempos que el repo midió; las anchuras concretas dependen de la máquina (ver A1) y por eso se recomienda el guard de cobertura como red.
- **Pitfalls:** HIGH — 8 de 10 están documentados verbatim en el propio repo (inbox JSDoc, cabecera de `inbox-concurrency.test.js`, comentarios de `lock.js`); los otros 2 (reutilización de inodo, techo del guard) se derivan de constantes leídas.
- **Blast radius:** HIGH — inventario exhaustivo por grep + lectura de cada call site; el único lector de `.holder` está identificado y no cambia.
- **Validation Architecture:** HIGH — baseline medido esta sesión, no citado de memoria.

**Fecha de research:** 2026-08-05
**Válido hasta:** 2026-09-04 (30 días — dominio interno y estable; solo caduca si `src/gsd/lock.js`, `src/inbox/store.js` o el harness cambian antes de ejecutar la fase)
