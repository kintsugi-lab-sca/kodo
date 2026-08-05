# Phase 86: CAS simétrico de `stealLock` — holder VIVO - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Mode:** `--auto` (todas las gray areas auto-resueltas con la opción recomendada; log completo en `86-DISCUSSION-LOG.md`)

<domain>
## Phase Boundary

Cerrar la carrera de **segundo orden** de `stealLock` (R-82-01, `82-REVIEW.md` CR-01) añadiendo un **compare-and-swap simétrico en la rama PRESENT** de `src/gsd/lock.js:453-471`: re-validar la identidad del `lockPath` inmediatamente antes del `renameSync` destructivo y **abortar** en vez de clobbear cuando cambió. Más el harness que siembra un holder **VIVO** (hoy solo se siembra dead-PID, que es exactamente por qué la carrera es invisible), la mordida verificada del guard, y la declaración honesta de la ventana residual.

**El interleaving que se cierra** (5 pasos, todos hoy alcanzables):

1. Stealer entra en la sección crítica guardada, `readLockContent` → holder **stale pero VIVO** (TTL expirado o corrupto) → no rechaza.
2. `existsSync(lockPath)` → `true` → toma la rama PRESENT.
3. El holder vivo ejecuta `releaseGsdLock` → `unlinkSync(lockPath)` (su `session_id` coincide). El path queda ausente.
4. Un `acquireGsdLock` **Case-1 fresco y legítimo** (`:124-126`) crea el lock con `O_EXCL` — **no pasa por el steal-guard**, por diseño.
5. El stealer, ciego, ejecuta `renameSync(tmp → lockPath)` **incondicional** → clobbea al creador legítimo. **Dos owners.**

La premisa escrita hoy en `src/gsd/lock.js:455-457` — *«No fresh Case-1 creator can race here — its O_EXCL create fails EEXIST while any bytes are present, so the guard fully serializes us»* — **es falsa**: el paso 3 quita esos bytes. Retirarla forma parte de la fase.

**Fuera de alcance (LOCKED, decisión del mantenedor 2026-08-02):** el **rediseño del primitivo** — serializar Case-1/`release` con el mismo steal-guard, que cerraría la carrera *por construcción* sin ventana residual. Es `LOCK-F1` → v2, con trigger propio: que la ventana residual de LOCK-07 se manifieste en uso real. Esta fase hace el **análogo exacto** del `O_EXCL`+re-check que la rama ABSENT (`:473-483`) ya hace, en la rama PRESENT — de ahí «simétrico».

**Requirements:** LOCK-04, LOCK-05, LOCK-06, LOCK-07.

</domain>

<decisions>
## Implementation Decisions

### Forma del CAS (LOCK-04)

- **D-01:** El baseline de identidad se toma de **la lectura que ya hace la sección crítica** (`src/gsd/lock.js:448`), no de una lectura adicional. Se introduce un lector interno que devuelve en una sola pasada `{ raw, content, ino }`: `raw` = bytes crudos del `readFileSync`, `content` = el parse (o `null` si es corrupto — la rama PRESENT debe seguir tratando el corrupto como robable), `ino` = `statSync(lockPath).ino` tomado **inmediatamente después** de la lectura. `readLockContent` se conserva para el resto de call sites; el lector nuevo es aditivo. — **Reversibility:** reversible — el lector es privado del módulo.
  - **Orden crítico, heredado del precedente:** los bytes salen de **la lectura**, jamás de un `statSync` tomado por separado. Un cambio que aterrice entre el `readFileSync` y ese stat entraría en el baseline y dejaría el guard **ciego justo ante el caso que debe detectar** (`src/inbox/store.js:662-665`).

- **D-02:** La comparación es **contenido crudo completo + `ino`**, no `size` + `ino`. **Divergencia deliberada respecto al precedente del inbox** y hay que documentarla: en `markCapture` el fichero solo puede **crecer** (los appends de D-03), así que `size !== baseBytes` es un detector suficiente y barato sobre un fichero que puede ser grande. Aquí el lock se **reemplaza entero** (`unlink` + create, o rename de un tercero), de modo que dos contenidos distintos pueden tener el mismo tamaño — un lock JSON de otro creador cabe fácilmente en los mismos bytes. El lock son ~200 bytes: releerlo entero cuesta un `readFileSync` y elimina ese falso negativo. — **Reversibility:** reversible.

- **D-03:** La comprobación va **tras escribir el `tmp` y justo antes del `renameSync`**, contra un `readFileSync` + `statSync` **frescos** — misma posición exacta que `src/inbox/store.js:799-810`. Si cualquiera de las dos sondas falla (fichero ausente, ilegible), `changed = true`: **conservador, no se publica nunca a ciegas**. El `tmp` se borra en ese caso (sin residuo). — **Reversibility:** reversible.

- **D-04:** `mtimeMs` queda **fuera** de la comparación, igual que en el inbox: es redundante y un `touch` produciría abortos espurios. No «completarlo» más tarde.

### Semántica del abort (LOCK-04)

- **D-05:** Detectar cambio **no retorna directamente**: borra el `tmp`, suelta el guard por el `finally` existente y hace **`continue`** — re-contendiendo dentro del bucle, que ya distingue PRESENT/ABSENT correctamente. Razón: el escenario real deja el path en uno de tres estados (creador vivo fresco / ausente / stale reaparecido) y el bucle ya sabe resolver los tres. Un `return` directo trataría el caso «ausente» como fallo cuando la rama ABSENT (`:473-483`) lo resolvería adquiriendo legítimamente. Es el **espejo exacto** de lo que la rama ABSENT ya hace con su `EEXIST` → releer → *¿vivo?* rechazar : re-contender. — **Reversibility:** reversible.

- **D-06:** **Corte inmediato si el nuevo contenido es un holder VIVO y fresco:** en la re-lectura posterior al abort, si `isStaleLock()` es falso → `{ acquired: false, holder, reason: 'lock-replaced-mid-steal' }` sin consumir más presupuesto. Ese es el desenlace del escenario de la fase: el creador Case-1 legítimo conserva el lock y el stealer tardío se retira limpiamente.

- **D-07:** **`MAX_STEAL_ATTEMPTS` (8) NO se sube.** El `continue` de D-05 consume un intento del presupuesto **existente**. Ampliarlo sería exactamente el enmascaramiento que **DEBT-04 prohíbe (LOCKED)**. Si el presupuesto se agota, el epílogo actual (`:493-507`) ya rechaza o adquiere atómicamente sin clobbear — no se toca. — **Reversibility:** reversible.

### Superficie del `reason` discriminado (LOCK-04)

- **D-08:** El typedef `AcquireResult` (`src/gsd/lock.js:52`) se amplía de forma **aditiva**: `{ acquired: false, holder: LockContent, reason?: string }`. El único consumidor de la variante es `src/triggers/dispatcher.js:202` (`return { action: 'gsd_locked', holder: lockResult.holder }`), que solo lee `.holder` — **cero cambios en dispatcher, orchestrator, polling y `doctor.js`**, que es el criterio 5 de la fase (camino caliente intacto). — **Reversibility:** reversible — campo opcional; ningún consumidor hace check exhaustivo.

- **D-09:** El `reason` es además **observable**: `console.error` con el prefijo `[kodo:lock]` ya establecido en `stealLock:425`. Valor canónico: `'lock-replaced-mid-steal'`. No se inventa una taxonomía de reasons: **un único valor nuevo**, el que esta fase necesita.

### Harness de holder VIVO (LOCK-05)

- **D-10:** El determinismo se consigue con un **seam de inyección en producción**, no con sleeps ni con repetir N iteraciones a ver si cae la carrera. Precedente literal del repo: `_afterReadFn` de `markCapture` (`src/inbox/store.js:698-703`) — «permite ensanchar la ventana lectura→rename de forma determinista SIN código de test en producción». Aquí: un hook opcional invocado **dentro de la sección crítica del steal, tras la lectura del baseline y antes de escribir el `tmp`**, default no-op. — **Reversibility:** costly — es superficie nueva en un módulo de concurrencia; deshacerlo obliga a reescribir el harness que lo consume.
  - **Solo en el primer intento del bucle**, igual que el precedente: si se disparase en cada vuelta, el hold del test se multiplicaría por `MAX_STEAL_ATTEMPTS` y el escenario dejaría de converger.
  - Documentado en JSDoc **como seam de test**, no como característica.

- **D-11:** El seam entra por un **tercer parámetro opcional de deps** en `acquireGsdLock(projectPath, sessionInfo, deps = {})`, propagado a `stealLock`. Es el patrón de DI por parámetro opcional que el repo ya usa en todas partes (`dispatcher.js:78`, `store.js:710`). **No** variables de entorno, **no** mocks de `node:fs`. Aditivo: las dos llamadas existentes siguen compilando sin tocarse. — **Reversibility:** costly — cambia la firma de una función exportada consumida por dispatcher y helpers de test.

- **D-12:** El harness usa **procesos reales**, extendiendo `test/helpers/lock-race-child.mjs` con un `kind` nuevo para los tres roles del interleaving: (1) holder stale-pero-**VIVO** que hace `release` bajo barrera, (2) creador Case-1 legítimo, (3) stealer que se duerme en el seam de D-10. Con el stealer detenido dentro de la sección crítica, los roles 1 y 2 tienen ventana de sobra: el interleaving de 5 pasos se reproduce **determinista**, no probabilísticamente. — **Reversibility:** reversible.
  - «Stale pero vivo» se siembra por **TTL expirado con PID vivo** (`acquired_at` retrodatado más allá de `ttl_hours`), que es el Case-3 de `acquireGsdLock:145-155`. **No** con `DEAD_PID`: ese es precisamente el sesgo que hace la carrera invisible hoy.
  - El contrato de stdout del helper (`acquired` / `blocked`, exactamente una vez, nunca lanza) **se respeta**; cualquier señal extra va por **canal lateral** en fichero, como ya hacen los kinds `polling`, `dispatch` y `capture` (marcador `capture-branches.log`, `store.js` / helper §WR-03).

- **D-13:** Los casos nuevos **extienden `test/gsd-lock-race.test.js`** con un `describe` propio, en vez de crear un fichero nuevo: mismo dominio, mismo sandbox `beforeEach`/`afterEach`, y los helpers `raceGsd*` ya viven ahí. — **Reversibility:** reversible.

- **D-14:** La aserción es de **cardinalidad exacta sobre el agregado** (`acquired === 1`), nunca sobre *quién* gana — invariante que el fichero ya sostiene en sus 4 tests actuales. N≥2 y N=5, en paralelo con los casos existentes.

### Mordida verificada (LOCK-06)

- **D-15:** La mordida se verifica **a mano y se registra como evidencia citada** en el `SUMMARY`/`VERIFICATION` de la fase: diff exacto del CAS revertido + salida roja del harness (test que falla, mensaje, conteo). Precedente del repo: así se registraron las mordidas de las Phases 82 y 83. **No** se construye infraestructura de mutation testing — el milestone es saneo puro, sin feature nueva. — **Reversibility:** reversible.

- **D-16:** **DEBT-04 es LOCKED y se aplica al pie de la letra:** ningún assert se debilita, ningún timeout sube, ningún presupuesto de reintento se amplía para greenear. Si el harness sale rojo con el CAS puesto, el fallo está en el CAS o en el harness — nunca en el umbral.

### Declaración de la ventana residual (LOCK-07)

- **D-17:** La ventana residual se declara en **dos sitios**: (a) sección propia en el JSDoc de `stealLock`, y (b) entrada en `.planning/STATE.md`. Redacción sin adornos, calcada del registro honesto del precedente (`src/inbox/store.js:678-683`):
  - **Qué es:** entre la sonda de identidad (`readFileSync` + `statSync`) y el `renameSync` quedan **dos syscalls contiguos**.
  - **Clase de riesgo, nombrada:** TOCTOU residual no cerrable sin soporte atómico del sistema de ficheros — **la misma clase** que la ventana aceptada en el guard del inbox de la Phase 83.
  - **Qué cambia de verdad:** la magnitud. Deja de ser toda la sección crítica del steal (que puede durar lo que dure el proceso vivo del holder) y pasa a ser el hueco entre dos syscalls contiguos, sin depender de ningún presupuesto de tiempo.
  - **Prohibido:** presentarla como cierre por construcción. El cierre por construcción es `LOCK-F1` y está fuera de alcance.

- **D-18:** El comentario **falso** de `src/gsd/lock.js:455-457` (*«No fresh Case-1 creator can race here…»*) se **retira y se sustituye** por la descripción real: el creador Case-1 sí puede aterrizar aquí en cuanto el holder vivo libera, y eso es exactamente lo que el CAS detecta. Dejarlo sería el mismo pecado que la Phase 85 retiró de `check-isolation.test.js` y que la Phase 87 va a retirar de `format-isolation.test.js:14,33` — un comentario de premisa falsa que ciega a quien lo lee. — **Reversibility:** reversible.

### Claude's Discretion

- Nombres concretos de identificadores (el lector interno, el campo del seam, el `kind` del helper) — el planner elige, respetando las convenciones del módulo.
- Reparto en planes: el planner decide si el CAS y el harness van en uno o dos planes. Restricción: el harness debe poder ponerse **rojo** con el CAS revertido, así que el orden natural es harness-primero o CAS-y-harness-en-el-mismo-plan con evidencia de la mordida al final.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### El defecto y su decisión
- `.planning/milestones/v0.19-phases/82-fix-de-la-carrera-de-steallock/82-REVIEW.md` §CR-01 — el hallazgo de 2º orden con el interleaving completo. **Fuente primaria de esta fase.**
- `.planning/REQUIREMENTS.md` §Concurrencia del lock GSD (R-82-01) — LOCK-04..07 literales; §Deferred: `LOCK-F1` (rediseño del primitivo, descartado explícitamente a favor del CAS).
- `.planning/PROJECT.md` §Current Milestone → bullet R-82-01 — decisión del mantenedor 2026-08-02 y los constraints LOCKED.
- `.planning/ROADMAP.md` §Phase 86 — los 5 success criteria verbatim.
- `.planning/debug/resolved/gsd-lock-race-cr01.md` — diagnóstico de la carrera de **primer** orden (cerrada en Phase 82). Contexto histórico: explica por qué el guard existe y qué NO cubre.

### El precedente a copiar (patrón CAS bytes+ino y seam de test)
- `src/inbox/store.js:651-709` — JSDoc del guard compare-and-swap de `markCapture`: orden del baseline, por qué el `size` sale de la lectura y no de un stat separado, por qué `mtimeMs` queda fuera, y la **declaración honesta de la ventana residual**. Es la plantilla literal de D-01..D-04 y D-17.
- `src/inbox/store.js:790-822` — la implementación del guard: posición exacta de la comprobación (tras el `tmp`, antes del `rename`), degradación conservadora, borrado del `tmp` y reintento.
- `src/inbox/store.js:698-703` — el seam `_afterReadFn`: contrato, «solo en el primer intento», y por qué no es código de test en producción.

### El código que se toca
- `src/gsd/lock.js:424-508` — `stealLock`: guard, sección crítica, rama PRESENT (`:453-471`, el objetivo) y rama ABSENT (`:473-483`, el análogo a replicar).
- `src/gsd/lock.js:116-159` — `acquireGsdLock`: Case-1 `O_EXCL` (`:124-126`, el creador que hoy no pasa por el guard) y Case-3 TTL expirado (`:145-155`, cómo se siembra un holder stale-pero-vivo).
- `src/gsd/lock.js:174-191` — `releaseGsdLock`: el `unlinkSync` del paso 3 del interleaving.
- `src/gsd/lock.js:52` — typedef `AcquireResult`, a ampliar aditivamente (D-08).

### Los tests
- `test/gsd-lock-race.test.js` — harness de procesos reales; `raceGsdStealDeadHolder` (`:74-118`) es la base a la que se le añade el rol de holder vivo.
- `test/helpers/lock-race-child.mjs` — contrato del hijo (stdout exactamente una vez, nunca lanza), patrón de barrera `--barrier`, de hold `--hold`, y de marcador cross-proceso por canal lateral.
- `test/gsd-lock-guard.test.js:39,80-95` — `DEAD_PID` / `writeStaleDeadLock`: **el sesgo que esta fase corrige**, no el patrón a copiar.

### Consumidores a no romper (criterio 5)
- `src/triggers/dispatcher.js:195-202` — único lector de `lockResult.holder`.
- `src/gsd/doctor.js:240` — `decideLock`, espejo declarado de `acquireGsdLock` (D-13 de esa fase). Si el CAS cambiase la máquina de estados observable, el espejo dejaría de serlo — **no la cambia**, pero el planner debe verificarlo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Guard CAS de `markCapture`** (`src/inbox/store.js`): patrón completo baseline→escritura de tmp→re-sonda→publica-o-aborta, ya en producción y probado bajo carga real. Esta fase lo transporta a `lock.js` con una sola divergencia justificada (contenido crudo en vez de `size`, D-02).
- **`_afterReadFn`**: precedente aprobado de seam de test en código de producción; da cobertura de diseño a D-10/D-11 sin abrir debate nuevo.
- **`test/helpers/lock-race-child.mjs`**: barrera de arranque (`--barrier`), hold del ganador (`--hold`), marcadores cross-proceso por fichero, y `sleepSync` con `Atomics.wait`. Todo lo que el harness nuevo necesita ya existe; se añade un `kind`.
- **`test/gsd-lock-race.test.js`**: sandbox por test, spawn de N hijos, agregación de veredictos. Se extiende, no se reescribe.
- **`isStaleLock`** (`src/gsd/lock.js:259-264`): predicado ya compartido por `acquireGsdLock`, `stealLock` y `doctor.decideLock`. D-06 lo reutiliza tal cual.

### Established Patterns
- **Ownership por rename, nunca por escritura in-place** — `lockPath` no debe quedar briefly-empty (D-01/D-02 de la Phase 82). El CAS **no** altera esto: sigue publicándose con `tmp` + `renameSync`; solo se le antepone una condición.
- **DI por parámetro opcional de deps**, nunca por env ni por mock de módulo (`dispatcher.js`, `store.js`).
- **Never-throws en las sondas**: todo `statSync`/`readFileSync` de comprobación va en `try/catch` y degrada a la dirección conservadora.
- **Presupuestos acotados** (`MAX_STEAL_ATTEMPTS`, `MARK_RMW_ATTEMPTS`) con epílogo que **rechaza en vez de forzar**.
- **Tests de concurrencia con procesos reales + barrera**, aserción sobre el agregado, nunca sobre el ganador.

### Integration Points
- El CAS vive **enteramente dentro** de la rama PRESENT de `stealLock`. Ningún consumidor cambia: dispatcher, orchestrator, polling y `doctor.js` ven la misma máquina de estados observable, con un campo `reason` opcional añadido que ninguno lee hoy.
- El tercer parámetro de deps de `acquireGsdLock` (D-11) es opcional: las llamadas existentes (`dispatcher.js:195`, helper de test) no se tocan.
- `.planning/STATE.md` recibe la declaración de la ventana residual (D-17b) — vía `gsd-tools`, nunca por edición directa.

</code_context>

<specifics>
## Specific Ideas

- **«CAS simétrico» es literal:** la rama ABSENT ya hace `O_EXCL` + re-lectura + *¿vivo?* rechazar : re-contender. La rama PRESENT debe hacer lo mismo con la herramienta que tiene a mano (comparación de identidad + abortar : re-contender). El objetivo de forma es que ambas ramas se lean como espejo la una de la otra.
- **La honestidad es un entregable, no un adorno.** Tres de los cuatro requirements se pueden cumplir a medias sin que nadie lo note; LOCK-07 existe para que no se haga. Un comentario que afirma más de lo que el código garantiza (`:455-457` hoy) cuenta como defecto en esta fase, igual que en la 85 y la 87.
- El milestone entero es **saneo puro, sin feature nueva**: cualquier cosa que parezca «ya que estamos» debe ir a `<deferred>`.

</specifics>

<deferred>
## Deferred Ideas

- **`LOCK-F1` — rediseño del primitivo de lock:** serializar `acquireGsdLock` Case-1 y `releaseGsdLock` con el mismo steal-guard, cerrando la carrera *por construcción* y eliminando la ventana residual. **Descartado explícitamente por el mantenedor (2026-08-02)** a favor del CAS: toca el camino caliente de dispatcher, orchestrator y polling. Va a **v2**, con trigger propio: que la ventana residual de LOCK-07 se manifieste en uso real. Ya registrado en `.planning/REQUIREMENTS.md` §Deferred → Concurrencia.
- **Mutation testing automatizado** para verificar mordidas de guards sin intervención manual. Sería infraestructura nueva; contradice el «saneo puro, sin feature nueva» de v0.20. Trigger: que el registro manual de mordidas se vuelva la fricción dominante de una fase de hardening.
- **Unificar el patrón CAS de `store.js` y `lock.js` en un helper compartido.** Tras esta fase habrá dos implementaciones del mismo patrón con divergencias deliberadas (`size` vs contenido crudo). Extraerlo ahora acoplaría dos módulos de concurrencia por un parecido de forma, no por un requisito. Trigger: una **tercera** aparición del patrón.

</deferred>

---

*Phase: 86-cas-sim-trico-de-steallock-holder-vivo*
*Context gathered: 2026-08-05*
