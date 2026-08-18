---
phase: 86-cas-sim-trico-de-steallock-holder-vivo
reviewed: 2026-08-05T09:20:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/gsd/lock.js
  - test/gsd-lock-guard.test.js
  - test/gsd-lock-race.test.js
  - test/helpers/lock-race-child.mjs
findings:
  critical: 1
  warning: 7
  info: 3
  total: 11
status: issues_found
---

# Phase 86: Code Review Report

**Reviewed:** 2026-08-05T09:20:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

El compare-and-swap de la rama PRESENT hace lo que dice hacer para el escenario que la fase eligió: el baseline sale de la lectura de la propia sección crítica (`src/gsd/lock.js:567`), la sonda fresca está tras el `tmp` e inmediatamente antes del `renameSync` (`:601`/`:614`), el `continue` sale por dentro del `try` y el `finally` suelta el guard, y no hay fuga de `tmp` ni de guard en ninguno de los caminos de abort. El harness de tres tiempos es sólido: cinco corridas limpias en frío y tres más con la máquina a 12 procesos de carga, sin flakes; el `assertCasExercised` es real y muerde; la reversión manual documentada en `86-02-SUMMARY.md` se corresponde con el código.

**Pero la degradación conservadora del CAS rompe una semántica documentada del módulo y lo hace en silencio.** `readLockIdentity` colapsa «fichero ausente» y «fichero ilegible» en el mismo `{raw:null}`; el CAS convierte ese `null` en `changed = true` incondicional; y el resultado es que un lock **presente pero ilegible** (EACCES, EISDIR, ELOOP, EMFILE) deja de ser robable —contra el Caso 5 del propio encabezado del módulo, `:30`— y `acquireGsdLock` acaba **lanzando un `EEXIST`** al llamante tras quemar los 8 intentos. Está verificado a mano contra `120e5e9d`: antes devolvía `{acquired:true}`, ahora lanza. Ningún test cubre esa subclase de «corrupto», que es exactamente por qué pasó desapercibida.

El resto son avisos: dos afirmaciones en comentarios nuevos que el código no sostiene (justo la clase de defecto que LOCK-07 dice erradicar), un sumidero de escapes de terminal con `task_ref` remoto, la ausencia de validación de forma en el corte de D-06, y varias señales que el harness mide y luego tira.

---

## Structural Findings (fallow)

No se aportó bloque `<structural_findings>` para esta revisión.

---

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: El CAS vuelve INROBABLE un lock presente pero ilegible, y `acquireGsdLock` acaba lanzando `EEXIST` — regresión verificada contra el Caso 5

**File:** `src/gsd/lock.js:290-297`, `:607-611`, `:680-690`
**Severity:** BLOCKER

**Issue.**
`readLockIdentity` hace `return { raw: null, content: null, ino: null }` para **cualquier** fallo de `readFileSync`, sin distinguir `ENOENT` («no está») de `EACCES`/`EISDIR`/`ELOOP`/`EMFILE` («está, pero no lo puedo leer»), y además abandona el `statSync` —que en el caso `EACCES` **sí** habría dado un `ino` perfectamente utilizable—.

El CAS traduce ese `null` a la dirección conservadora sin salida:

```js
const changed =
  fresh.raw === null || base.raw === null
    ? true // conservador: si no se puede comprobar, NO se publica
    : ...
```

Cuando el fallo de lectura es **persistente** (permisos, path convertido en directorio, agotamiento de descriptores), la rama PRESENT no puede publicar **jamás**: cada vuelta escribe un `tmp`, lo borra, y hace `continue` (`:645`) sin backoff. Agotados los 8 intentos, el epílogo (`:680-690`) hace `readLockContent` → `null` → `writeFileSync(..., 'wx')` → `EEXIST` → relee → `null` → **`throw e`**. El `EEXIST` escapa de `stealLock` y de `acquireGsdLock`.

Esto contradice tres afirmaciones del propio módulo:
- `:30` — «*5. Lock file is corrupt JSON -> treat as stale and steal*».
- `:283-285` (JSDoc nuevo de `readLockIdentity`) — «*un lock corrupto sigue siendo robable*».
- `:153` — la única razón por la que se llega aquí es `stealLock(..., 'corrupt lock file')`, es decir: el llamante ya decidió que era robable.

**Evidencia medida (antes/después, mismo probe).**

```
# HEAD (con el CAS)
[kodo:lock] Lock stolen: corrupt lock file
EACCES lock THREW: EEXIST  ms= 13     <- 8 ciclos tmp write+unlink, luego throw
EISDIR lock THREW: EEXIST

# 120e5e9d (sin el CAS)
[kodo:lock] Lock stolen: corrupt lock file
EACCES lock -> {"acquired":true}  ms= 3
```

**Impacto.** Un `.planning/.kodo.lock` ilegible (repo compartido, fichero de otro usuario, ACL, `.kodo.lock` convertido en directorio, o `EMFILE` transitorio bajo carga) pasa de «se roba y el trabajo continúa» a «bloqueo permanente + error críptico». En `kodo dispatch` el usuario ve literalmente `Error: EEXIST: file already exists, open .../.planning/.kodo.lock` (`src/cli.js:281-283`), que no describe el problema real. No hay ninguna vía de recuperación desde el producto: el propio `stealLock` es el mecanismo de recuperación y ha dejado de funcionar.

**Fix.** Distinguir «ausente» de «ilegible» en el lector, conservar el `ino` cuando la lectura falla pero el `stat` no, y tratar «ilegible antes **e** ilegible ahora, mismo inodo» como identidad **sin cambios** (que es lo que semánticamente es):

```js
/**
 * @returns {{ raw: Buffer|null, content: LockContent|null, ino: number|null,
 *             missing: boolean }}
 */
function readLockIdentity(path) {
  /** @type {Buffer|null} */ let raw = null;
  /** @type {boolean} */ let missing = false;
  try {
    raw = readFileSync(path);
  } catch (e) {
    // ENOENT: no está. Cualquier otro errno: está, pero no se puede leer —
    // sigue siendo un lock ROBABLE (Caso 5), no un motivo para no publicar.
    missing = /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT';
  }

  /** @type {number|null} */ let ino = null;
  try {
    ino = statSync(path).ino; // se toma TAMBIÉN cuando la lectura falló: en
  } catch {                   // EACCES el stat sigue siendo válido.
    ino = null;
  }

  /** @type {LockContent|null} */ let content = null;
  if (raw !== null) {
    try {
      content = /** @type {LockContent} */ (JSON.parse(raw.toString('utf-8')));
    } catch {
      content = null;
    }
  }
  return { raw, content, ino, missing };
}
```

y en el CAS:

```js
const bothUnreadablePresent =
  base.raw === null && fresh.raw === null && !base.missing && !fresh.missing;

const changed = bothUnreadablePresent
  // «ilegible + presente» ANTES y AHORA, con el mismo inodo → identidad
  // sin cambios: el lock ilegible sigue siendo robable (Caso 5, :30).
  ? !(base.ino !== null && fresh.ino !== null && fresh.ino === base.ino)
  : fresh.raw === null || base.raw === null
    ? true
    : !fresh.raw.equals(base.raw) ||
      (base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino);
```

**Y añadir el test que falta** (ver WR-06): la subclase «presente pero ilegible» de lock corrupto no está cubierta por ningún caso de `test/gsd-lock.test.js` ni de `test/gsd-lock-guard.test.js`.

---

## Warnings

### WR-01: Inyección de caracteres de control de terminal vía `task_ref`, con un comentario que afirma la mitigación contraria

**File:** `src/gsd/lock.js:626-633`
**Severity:** WARNING

**Issue.** El comentario nuevo dice:

> `// Only `task_ref` is interpolated — never the raw lock body, which is`
> `// hand-editable and would be a control-char vector towards the terminal.`

`task_ref` **es un campo del cuerpo del lock**, igual de editable a mano que el resto, y además llega desde el proveedor remoto (`src/triggers/dispatcher.js:198` → `task_ref: task.ref`). Interpolarlo en un `console.error` que va a la terminal del operador es exactamente el vector que el comentario dice estar evitando: un `task.ref` con secuencias ANSI/CSI puede reposicionar el cursor, borrar líneas o falsificar salida previa. La mitigación declarada es ilusoria, y el mismo patrón ya existe en `:167` (pre-existente).

**Fix.** Sanear en el punto de emisión y ajustar el comentario a lo que el código hace:

```js
/** Strip C0/C1 control chars and cap length — el lock es editable a mano y
 *  `task_ref` llega del proveedor remoto. */
const safeRef = String(fresh.content.task_ref ?? '')
  .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
  .slice(0, 64);
console.error(
  `[kodo:lock] Steal aborted: lock replaced mid-steal by a live holder (${safeRef})`,
);
```

---

### WR-02: «closing the FIRST-order double-acquire race … by construction» no lo sostiene el código

**File:** `src/gsd/lock.js:456-460` (cabecera nueva), en relación con `:409-423` y `:667-673`
**Severity:** WARNING

**Issue.** La cabecera reescrita en esta fase afirma que la carrera de primer orden queda cerrada **por construcción**. No lo está: la serialización de stealers depende de un **presupuesto de tiempo**, no de una construcción atómica.

1. `guardIsStale` (`:413`) rompe un guard cuyo dueño está **vivo** en cuanto `Date.now() - guard.ts > STEAL_GUARD_STALE_MS` (5 s). Un stealer detenido más de 5 s (swap, SIGSTOP, FS lento, o el propio seam de esta fase) es adelantado y un segundo stealer entra a la sección crítica.
2. El `finally` (`:667-673`) hace `unlinkSync(guardPath)` **sin comprobar quién es el dueño actual**. En la secuencia del punto 1, el stealer adelantado borra al despertar el guard de su sucesor, y un tercero puede publicar el suyo mientras el sucesor sigue dentro. Dos stealers concurrentes en la sección crítica.

El CAS mitiga el daño (el segundo detecta el cambio y aborta), pero eso es precisamente «por CAS», no «por construcción». Es la misma clase de afirmación-que-excede-al-código que D-18 retiró de `:455-457` y que `86-CONTEXT.md` §Specifics declara defecto de esta fase.

La misma sobreafirmación aparece en `:66-71`: «*a live stealer inside the guard is never broken by age (A2)*» — «never» es un supuesto de temporización, y el seam que esta fase añade retiene el guard hasta 3 s (`test/helpers/lock-race-child.mjs:406`), dentro del mismo orden de magnitud que el umbral de 5 s, no «orders of magnitude» por debajo del «~1ms critical section» que el comentario declara.

**Fix.** Acotar la redacción y, en el `finally`, soltar solo el guard propio:

```js
// Cabecera: «…closing the FIRST-order double-acquire race — stealer against
// stealer — for any critical section shorter than STEAL_GUARD_STALE_MS.
// Beyond that bound the guard is breakable by age and the CAS of step 2 is the
// remaining line of defence; it is NOT closed by construction.»

} finally {
  try {
    // Solo el guard PROPIO: si el nuestro fue roto por edad y un sucesor
    // publicó el suyo, borrarlo lo expulsaría de su sección crítica.
    const g = readGuard(guardPath);
    if (!g || g.pid === process.pid) unlinkSync(guardPath);
  } catch {
    /* best-effort */
  }
}
```

---

### WR-03: El corte de D-06 confía en `fresh.content` sin validar su forma — un lock parseable pero malformado bloquea para siempre

**File:** `src/gsd/lock.js:624`, con causa raíz en `:86-93` y `:325-330`
**Severity:** WARNING

**Issue.** `readLockIdentity` acepta como `content` **cualquier** JSON válido. `isStaleLock` no valida nada:

- `isPidAlive(undefined)` → `process.kill(undefined, 0)` lanza `ERR_INVALID_ARG_TYPE`, que no es `ESRCH`, luego devuelve **`true`** («vivo»). Medido: `isPidAlive(undefined|NaN|0|-1) === true` en los cuatro casos.
- `new Date(undefined).getTime()` → `NaN` → `Number.isFinite(NaN)` es falso → **nunca vence el TTL**.

Resultado: un lock con `{}` (o `[]`, o `5`, o `pid:-1`) es clasificado como holder **vivo y fresco**, para siempre. Medido:

```
A) empty-object lock: {"acquired":false,"holder":{}}
```

En la ruta nueva eso se traduce en `{ acquired:false, holder:{}, reason:'lock-replaced-mid-steal' }` y en un `console.error` que imprime `(undefined)`. El dispatcher propaga `{ action:'gsd_locked', holder:{} }` (`src/triggers/dispatcher.js:202`). El `decideLock` de `src/gsd/doctor.js:246-256` —«espejo EXACTO»— devuelve `keep` por el mismo motivo, así que `kodo doctor` tampoco lo limpia: no hay salida del bloqueo salvo borrar el fichero a mano. (El comportamiento base es pre-existente en el Caso 4; lo nuevo es que la rama del CAS lo replica y que `holder` puede ahora no ser ni un objeto.)

**Fix.** Un validador de forma en el lector, aplicado en los dos consumidores de `content`:

```js
/** @param {unknown} v @returns {v is LockContent} */
function isWellFormedLock(v) {
  return (
    !!v && typeof v === 'object' && !Array.isArray(v) &&
    Number.isInteger(/** @type {any} */ (v).pid) && /** @type {any} */ (v).pid > 0
  );
}
// readLockIdentity: content = isWellFormedLock(parsed) ? parsed : null;
// → un lock malformado vuelve a ser robable, como el corrupto (`:30`).
```

y endurecer `isPidAlive` para que un `pid` no entero devuelva `false` en vez de `true`.

---

### WR-04: La rama PRESENT/ABSENT se decide con un `existsSync` independiente del baseline, no con `base`

**File:** `src/gsd/lock.js:580`
**Severity:** WARNING

**Issue.** Tras leer la identidad baseline (`:567`), el código vuelve a observar la presencia del path con un `existsSync` separado. Las dos observaciones pueden discrepar, y cuando discrepan en el sentido «baseline ausente/ilegible + `existsSync` verdadero» se entra en una rama PRESENT que **por construcción no puede publicar** (`base.raw === null → changed = true`, `:608`): escribe un `tmp`, lo borra y consume un intento del presupuesto de 8 garantizadamente en balde. Es el mismo mecanismo que en CR-01 se vuelve terminal cuando el fallo de lectura es persistente.

Además desalinea la propia documentación de la sección crítica, que presenta `base` como *la* observación del path (`:565-566`, «read ONCE»).

**Fix.** Derivar la rama del baseline ya leído, que es lo que el CAS va a comparar:

```js
// PRESENT ⟺ el baseline vio bytes. Un `existsSync` independiente puede
// discrepar del baseline y meter al CAS en una rama que no puede publicar.
if (base.raw !== null) {
  ...
}
```

(con el `missing` de CR-01, la condición exacta es `if (!base.missing)`).

---

### WR-05: El harness mide `parkedMs` y los `stages` de las tres últimas etapas y no aserta ninguno

**File:** `test/gsd-lock-race.test.js:337-355`, `:378-386`, `:415-420`
**Severity:** WARNING

**Issue.** La orquestación captura cinco señales y solo aserta dos:

| Señal | ¿Aserta? |
|---|---|
| `stages.seeded` | sí (`:378`, `:415`) |
| `stages.parked` | sí (`:379`, `:416`) |
| `stages.released` | **no** |
| `stages.creatorLanded` | **no** |
| `stages.reasons` | **no** |
| `parkedMs` | **no** (`:348-349`, con comentario explícito de que no se aserta) |

`parkedMs` es precisamente el dato que §Pitfall 8 y el supuesto A1 declaran como restricción **dura**: si el aparcamiento roza `STEAL_GUARD_STALE_MS = 5_000`, el escenario degrada a medir la carrera de **primer** orden que la Phase 82 ya cerró. El harness lo calcula y lo tira. Peor: el techo real no lo pone el padre sino el `waitForBarrier(args.resume, 3000)` del hijo (`test/helpers/lock-race-child.mjs:406`); si esa espera **expira**, el stealer reanuda por su cuenta antes del release y el rojo resultante se leerá como «el CAS no muerde» en vez de «la barrera venció».

El `assert.equal(r.holderVerdict, 'written', 'el holder no completó su release')` (`:386`, `:420`) es más débil que su mensaje: `releaseGsdLock` es idempotente y **no-op** cuando el `session_id` en disco no casa (`src/gsd/lock.js:203-206`), así que `written` prueba «la llamada no lanzó», no «el `unlink` ocurrió». Lo que sí prueba el `unlink` es `stages.released`, que no se aserta.

**Fix.** Asertar lo que ya se mide (no relaja ningún umbral, no añade ninguno nuevo — cumple D-16):

```js
assert.ok(r.stages.released, `el holder no llegó a liberar de verdad. ${ctx}`);
assert.ok(r.stages.creatorLanded, `el creador Case-1 no llegó a aterrizar. ${ctx}`);
// A1 / Pitfall 8: si el aparcamiento se acerca a STEAL_GUARD_STALE_MS el
// escenario deja de medir la carrera de 2º orden. Medido en 5-10 ms; el techo
// del hijo es 3000 ms. Un rojo AQUÍ dice «la barrera venció», no «el CAS falló».
assert.ok(r.parkedMs < 3000, `el aparcamiento venció la barrera del seam. ${ctx}`);
```

---

### WR-06: Ningún test cubre la subclase «presente pero ilegible» de lock corrupto — la brecha por la que pasó CR-01

**File:** `test/gsd-lock-guard.test.js:362-377` (caso `(i)`), `test/gsd-lock.test.js:136-147`
**Severity:** WARNING

**Issue.** El caso `(i)` se titula «*un lock corrupto sigue siendo robable con el CAS puesto*» y el JSDoc de `readLockIdentity` (`src/gsd/lock.js:283-285`) hace la misma afirmación general. Ambos solo ejercitan la subclase **parse-failure** (`'{not valid json'`), donde `readFileSync` **sí** devuelve bytes. La subclase **read-failure** —el fichero existe pero `readFileSync` lanza— no está cubierta en ninguno de los cuatro ficheros de la fase ni en `test/gsd-lock.test.js`, y es exactamente donde la afirmación es falsa (CR-01). El test da confianza sobre un enunciado más ancho de lo que verifica.

**Fix.** Añadir el caso que muerde, junto a `(i)`:

```js
it('(i3) lock PRESENTE pero ILEGIBLE sigue siendo robable (Caso 5, src/gsd/lock.js:30)', () => {
  mkdirSync(join(tmpDir, '.planning'), { recursive: true });
  const lockPath = join(tmpDir, LOCK_FILE);
  writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID }));
  chmodSync(lockPath, 0o000); // readFileSync → EACCES, no ENOENT

  const result = acquireGsdLock(tmpDir, makeSessionInfo({ session_id: 'sess-unreadable' }));
  assert.equal(result.acquired, true, 'un lock ilegible NO puede volverse inrobable');

  const entries = planningEntries(tmpDir);
  assert.ok(!entries.some((e) => e.includes('.tmp.')), `sin residuo de tmp; got: ${entries}`);
});
```

(hoy este test lanza `EEXIST` en vez de fallar el assert — ver CR-01.)

---

### WR-07: `[kodo:lock] Lock stolen: …` se emite antes de intentar el robo, y ahora miente en el camino de abort

**File:** `src/gsd/lock.js:541`
**Severity:** WARNING

**Issue.** El `console.error('[kodo:lock] Lock stolen: ${reason}')` es la **primera** instrucción de `stealLock`, antes de contender por el guard y muy antes de cualquier `renameSync`. Con la rama de abort que esta fase añade, la secuencia observable por el operador pasa a ser:

```
[kodo:lock] Lock stolen: TTL expired
[kodo:lock] Steal aborted: lock replaced mid-steal by a live holder (KL-CREATOR)
```

es decir: se afirma un robo que no ocurrió, y se desmiente dos líneas después. Lo mismo con el rechazo de `:578`, con el epílogo de `:681` y con el retorno de `:664`. En una fase cuyo entregable declarado es «*la honestidad es un entregable*», un log que afirma más de lo que ocurrió es del mismo género que el comentario que D-18 retiró.

**Fix.** Mover la traza al punto en que el robo se consuma, o degradarla a intención:

```js
// En :541 — declara la INTENCIÓN, no el hecho.
console.error(`[kodo:lock] Attempting steal: ${reason}`);
// …y en el único punto donde el robo se consuma (:614 y :660):
console.error(`[kodo:lock] Lock stolen: ${reason}`);
```

---

## Info

### IN-01: Aserción tautológica en el caso `(i2)`

**File:** `test/gsd-lock-guard.test.js:400-403`
**Issue:** `assert.ok(!('reason' in result), ...)` no puede fallar: el `assert.equal(result.acquired, true)` de la línea 399 ya excluye la variante rechazada, que es la única que lleva `reason` (`src/gsd/lock.js:52-53`). La rama D-05 vs D-06 queda probada por el `acquired === true` solo.
**Fix:** Sustituir por la aserción que sí discrimina: que se necesitó **más de un intento** (p. ej. observando por canal lateral) o, si no es observable sin tocar producción, dejar solo el `acquired === true` con el comentario que ya explica el porqué.

### IN-02: `test/gsd-lock-guard.test.js` `(h)` reejecuta íntegro el escenario de `(g)`

**File:** `test/gsd-lock-guard.test.js:322-360`
**Issue:** `(g)` y `(h)` siembran lo mismo, inyectan el mismo seam y llaman igual; solo divergen en qué asertan (resultado vs estado en disco + higiene). Es duplicación de escenario, no de cobertura: un cambio en `releaseThenFreshCreator` obliga a revalidar ambos.
**Fix:** Fusionar en un `it` con los dos bloques de aserciones, o extraer el `arrange+act` a un helper local y dejar dos `it` que solo asertan.

### IN-03: `stealLock` es ahora un bloque de ~150 líneas con 5 niveles de anidamiento y 9 puntos de salida

**File:** `src/gsd/lock.js:540-691`
**Issue:** `for` → `try` → `if (existsSync)` → `try` → `if (!changed)` / `if (fresh.content …)`, con `continue`, `return` y `throw` repartidos y un `finally` que hay que tener presente en las nueve salidas. Los defectos CR-01 y WR-04 viven precisamente en la interacción entre esos niveles. No es un problema de estilo: es la razón por la que una degradación conservadora se volvió terminal sin que ningún test lo notara.
**Fix:** Extraer la sección crítica a una función privada `attemptGuardedSteal(lockPath, sessionInfo, base)` que devuelva `{ outcome: 'acquired'|'reject'|'retry', result? }`, dejando el bucle con la contención del guard y el `finally`. Fuera del alcance de esta fase; anótese como deuda junto a `LOCK-F1`.

---

_Reviewed: 2026-08-05T09:20:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
