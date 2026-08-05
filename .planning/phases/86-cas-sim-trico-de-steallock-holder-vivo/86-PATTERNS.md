# Phase 86: CAS simétrico de `stealLock` — holder VIVO · Mapa de patrones

**Mapeado:** 2026-08-05
**Ficheros analizados:** 4 (3 de código + 1 documental)
**Análogos encontrados:** 4 / 4 (todos exactos — fase de hardening sobre ficheros existentes, cero módulos nuevos)

> Nota de encuadre para el planner: **no hay scaffolding greenfield en esta fase.** Cada bloque de
> abajo dice *qué código existente hay que reflejar* y *junto a qué línea concreta va el cambio*.

---

## File Classification

| Fichero a modificar | Rol | Data flow | Análogo más cercano | Calidad del match |
|---------------------|-----|-----------|---------------------|-------------------|
| `src/gsd/lock.js` (rama PRESENT de `stealLock`, `:453-471`) | primitivo de concurrencia / file-I/O | transform + compare-and-swap sobre fichero | `src/inbox/store.js` → `markCapture` (`:710-839`, guard en `:790-822`) | **exacto** — mismo patrón CAS ya en producción |
| `src/gsd/lock.js` (lector interno `{raw, content, ino}`) | utility privada del módulo | file-I/O never-throws | `src/inbox/store.js:603-618` (`resolvePublishTarget`) + baseline `:733-744` | **exacto en forma, divergente en contenido** (D-02) |
| `src/gsd/lock.js` (seam `deps` + firma de `acquireGsdLock`) | contrato del módulo / DI | request-response | `src/inbox/store.js:698-703, 710, 776` (`_afterReadFn`) y `src/triggers/dispatcher.js:72-80` (`deps = {}`) | **exacto** |
| `src/gsd/lock.js` (typedef `AcquireResult` `:52`, JSDoc LOCK-07) | contrato / documentación | — | `src/inbox/store.js:678-683` (ventana residual) y `:704-708` (typedef con `reason`) | **exacto** |
| `test/helpers/lock-race-child.mjs` (kinds nuevos) | test helper / proceso hijo | event-driven (barrera + canal lateral) | mismo fichero: `--kind mark` (`:264-282`), `--kind capture` (`:209-255`), `--kind gsd` (`:402-410`) | **exacto** |
| `test/gsd-lock-race.test.js` (`describe` nuevo, D-13) | test de integración multi-proceso | orquestación de procesos reales | `test/inbox-concurrency.test.js:132-253` (`waitUntil`, `raceChildren` con `gate`, `readBranchCounts`, `assertFailopenExercised`) + `raceGsdStealDeadHolder` (`:74-118`) | **exacto** (se combinan dos moldes) |
| `.planning/STATE.md` (D-17b) | documentación de estado | — | `.planning/STATE.md:149-163` §Critical Invariants (`:156`, invariante del lock del inbox) | **role-match** |

---

## Pattern Assignments

### 1. `src/gsd/lock.js` — el lector interno de una pasada (D-01)

**Análogo:** `src/inbox/store.js:603-618` (never-throws con degradación) + el baseline de
`markCapture` `:731-744`.

**Excerpt a reflejar** — `src/inbox/store.js:731-744` (la regla de orden que se copia literal):

```js
// Baseline del guard. Los bytes salen de la LECTURA (ver el JSDoc: un stat separado
// absorbería un append que la lectura no vio); el inodo, del destino, justo después.
const baseBytes = Buffer.byteLength(raw, 'utf-8');
const { target, mode } = resolvePublishTarget(inboxPath);
/** @type {number | null} */
let baseIno = null;
try {
  baseIno = statSync(target).ino;
} catch {
  baseIno = null; // sin componente de inodo; el de tamaño sigue vigente
}
```

**Qué transfiere y qué no:**

| Regla del análogo | Cita | Transferencia |
|---|---|---|
| Bytes de la LECTURA, jamás de un `statSync` separado | `store.js:662-665` | **literal** (D-01) |
| `ino` del destino, inmediatamente después de la lectura | `store.js:665` | **literal** |
| `statSync` fallido → `baseIno = null`, sigue el componente de bytes | `store.js:740-744` | **literal** |
| `Buffer.byteLength(raw,'utf-8')` como detector | `store.js:733, 802` | **NO** — D-02 sustituye `size` por `Buffer` crudo comparado con `.equals()` |
| `resolvePublishTarget` (`realpathSync` + `chmod`) | `store.js:603-618` | **NO transfiere** — `lockPathFor` (`src/gsd/lock.js:199-201`) ya resolvió el symlink sobre el *projectPath*; una segunda resolución sondearía un path distinto del que el `renameSync` toca |

**Dónde va:** junto a `readLockContent` en `src/gsd/lock.js` (zona de helpers privados, vecina de
`isStaleLock` en `:259-264`). `readLockContent` **se conserva** para el resto de call sites.

---

### 2. `src/gsd/lock.js` — el CAS en la rama PRESENT (D-02, D-03, D-05, D-06)

**Análogo:** `src/inbox/store.js:790-822` — **el excerpt más importante de toda la fase**.

```js
// ORDEN INAMOVIBLE: escribir el tmp → stat FRESCO del destino → comparar → renombrar.
// Comparar ANTES de escribir el tmp dejaría fuera de la ventana vigilada el propio coste
// de la escritura, que es la parte más cara del paso.
const tmp = target + '.tmp.' + process.pid + '.' + randomUUID();
/** @type {'published' | 'stale' | 'fs'} */
let outcome;
try {
  writeFileSync(tmp, out);
  if (mode !== undefined) chmodSync(tmp, mode);

  let changed;
  try {
    const st = statSync(target);
    changed = st.size !== baseBytes || (baseIno !== null && st.ino !== baseIno);
  } catch {
    changed = true; // conservador: si no se puede comprobar, NO se publica
  }

  if (changed) {
    rmSync(tmp, { force: true }); // sin residuo de tmp perdido
    outcome = 'stale';
  } else {
    renameSync(tmp, target);
    outcome = 'published';
  }
} catch {
  rmSync(tmp, { force: true });
  outcome = 'fs';
}

if (outcome === 'published') return { ok: true, capture: persisted };
if (outcome === 'fs') return { ok: false, reason: 'fs' };
// 'stale' → rehacer el RMW con una lectura nueva.
```

**El código exacto que se sustituye** — `src/gsd/lock.js:453-471` (HEAD, verbatim):

```js
      if (existsSync(lockPath)) {
        // Present (stale or corrupt) → atomic in-place replacement. `lockPath` is
        // never briefly-empty: rename swaps the inode atomically (POSIX). No fresh
        // Case-1 creator can race here — its O_EXCL create fails EEXIST while any
        // bytes are present, so the guard fully serializes us.
        const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
        try {
          writeFileSync(tmp, serializeLockContent(sessionInfo));
          renameSync(tmp, lockPath);
        } catch (err) {
          try {
            unlinkSync(tmp);
          } catch {
            /* best-effort */
          }
          throw err;
        }
        return { acquired: true };
      }
```

Las líneas `455-457` (`No fresh Case-1 creator can race here…`) son la **premisa falsa de D-18**:
se retiran. La primera frase (`rename swaps the inode atomically (POSIX)`) es cierta y **se conserva**.

**Reglas de traducción `store.js` → `lock.js`:**

| En `store.js` | En `lock.js` |
|---|---|
| `st.size !== baseBytes \|\| (baseIno !== null && st.ino !== baseIno)` | `!fresh.raw.equals(base.raw) \|\| (base.ino !== null && fresh.ino !== null && fresh.ino !== base.ino)` (D-02, Pitfall 1: reutilización de inodo) |
| `rmSync(tmp, { force: true })` | `try { unlinkSync(tmp); } catch {}` — el módulo del lock **ya** usa `unlinkSync` best-effort (`lock.js:463-467, 485-489`); no introducir `rmSync` |
| `catch { changed = true; }` | idéntico + añadir `raw === null` → `changed = true` (D-03, Pitfall 3) |
| `outcome = 'stale'` → siguiente vuelta del `for` | `continue` desde **dentro** del `try` (el `finally` de `:484-490` suelta el guard; Pitfall 5) |
| `target` (destino resuelto por `realpathSync`) | `lockPath` **tal cual** — la sonda debe apuntar exactamente al destino del `rename` (Pitfall 4) |
| `MARK_RMW_ATTEMPTS` | `MAX_STEAL_ATTEMPTS = 8`, **sin subir** (D-07/D-16) |

**Rama espejo a imitar en forma** — `src/gsd/lock.js:473-483` (la ABSENT, ya correcta):

```js
      // Absent (holder released mid-steal) → respect a fresh creator via O_EXCL
      // rather than clobbering it (Pitfall 2).
      try {
        writeFileSync(lockPath, serializeLockContent(sessionInfo), { flag: 'wx' });
        return { acquired: true };
      } catch (e) {
        if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
        const holder = readLockContent(lockPath);
        if (holder && !isStaleLock(holder)) return { acquired: false, holder };
        // A stale/corrupt lock reappeared → fall through to re-contend.
      }
```

El «simétrico» del título es literal: **`¿vivo? → rechazar : re-contender`**. D-06 es exactamente
`if (holder && !isStaleLock(holder)) return {acquired:false, holder}`, reutilizando el parse que la
sonda fresca ya hizo (`fresh.content`), más el `reason`.

---

### 3. `src/gsd/lock.js` — seam de test por `deps` (D-10, D-11)

**Análogo A — el contrato del seam:** `src/inbox/store.js:698-703` (JSDoc, verbatim):

```
 *   _afterReadFn?: () => void,
 * }} o — `_afterReadFn` es el seam de inyección del test de concurrencia de D-21.2: permite
 *   ensanchar la ventana lectura→rename de forma determinista SIN código de test en producción.
 *   Se invoca dentro del lock, tras la lectura fresca y antes de publicar. Solo en el PRIMER
 *   intento: si se disparase en cada uno, el hold del test se multiplicaría por
 *   `MARK_RMW_ATTEMPTS` y el escenario dejaría de converger. Default no-op.
```

**Análogo B — el disparo guardado:** `src/inbox/store.js:776`:

```js
if (attempt === 0 && typeof _afterReadFn === 'function') _afterReadFn();
```

Copiar el guard `attempt === 0` **tal cual**: aquí importa más que en el inbox, porque cada vuelta
extra retiene el steal-guard y se acerca al techo `STEAL_GUARD_STALE_MS = 5_000` (`lock.js:65`).

**Análogo C — DI por tercer parámetro opcional:** `src/triggers/dispatcher.js:72-80`:

```js
export async function dispatchTrigger(event, opts = {}, deps = {}) {
  const getProviderFn = deps.getProviderFn || ((name) => getProvider(name || event.provider));
  const launchWorkItemFn = deps.launchWorkItemFn || launchWorkItem;
  ...
```

**Dónde va:** firma `acquireGsdLock(projectPath, sessionInfo, deps = {})` (`lock.js:116`), propagado
a `stealLock` en sus **tres** call sites: `:137` (corrupto), `:142` (PID muerto), `:154` (TTL vencido).
El disparo, dentro del `try` de la sección crítica, entre la lectura del baseline (sustituye a `:448`)
y el `existsSync(lockPath)` de `:453`.

---

### 4. `src/gsd/lock.js` — typedef y declaración de la ventana residual (D-08, D-17)

**Análogo del typedef con `reason`:** `src/inbox/store.js:704-708`:

```
 * @returns {{ ok: true, capture: Capture }
 *          | { ok: false, reason: 'not-found' | 'already-closed' | 'lock-timeout'
 *                              | 'concurrent-write' | 'fs' }}
```

**Línea a ampliar aditivamente** — `src/gsd/lock.js:52` (HEAD, verbatim):

```js
 * @typedef {{ acquired: true } | { acquired: false, holder: LockContent }} AcquireResult
```

Único consumidor de la variante rechazada: `src/triggers/dispatcher.js:202` →
`return { action: 'gsd_locked', holder: lockResult.holder }`. Solo lee `.holder`: **cero cambios**.

**Plantilla literal de la ventana residual** — `src/inbox/store.js:678-683`, verbatim:

```
 * **Ventana residual, declarada sin adornos.** Entre el `statSync` de comprobación y el
 * `renameSync` quedan dos syscalls adyacentes. NINGÚN lock puede cerrar ese hueco mientras D-03
 * mantenga el append fail-open fuera de coordinación; este guard NO lo cierra y no debe leerse
 * como si lo hiciera. Lo que cambia es la magnitud: la ventana pasa de ser toda la sección crítica
 * del marcado (segundos, si el titular se atasca) a ser el hueco entre dos syscalls contiguos, y
 * deja de depender de ningún presupuesto de tiempo.
```

Se calca la estructura (qué es · qué NO cierra · qué cambia de verdad) añadiendo el elemento que
D-17 exige y el precedente no nombra: **la clase de riesgo — TOCTOU residual no cerrable sin soporte
atómico del FS, la misma clase que la ventana del inbox de la Phase 83**. Va en el JSDoc de
`stealLock`, que hoy ocupa `src/gsd/lock.js:388-423`, como sección propia junto a los tres pasos
numerados de `:397-412`.

---

### 5. `test/helpers/lock-race-child.mjs` — kinds nuevos (D-12)

**Análogo A — el kind que inyecta el seam:** `--kind mark`, `:264-282`:

```js
  if (args.kind === 'mark') {
    let written = false;
    try {
      const { defaultInboxPaths, markCapture } = await import('../../src/inbox/store.js');
      const { inboxPath, lockPath } = defaultInboxPaths();
      const holdMs = Number(args.hold || 300);
      const res = markCapture(args.id, 'enrutada', {
        dest: args.dest ?? null,
        inboxPath,
        lockPath,
        _afterReadFn: () => sleepSync(holdMs),
      });
      written = res.ok === true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }
```

El stealer aparcado es este molde con `sleepSync(holdMs)` sustituido por
`() => { markerAppend('stealer-parked'); waitForBarrier(args.resume, 3000); }` — barrera en vez de
sleep (RESEARCH §Patrón 4), con timeout **claramente por debajo de 5.000 ms**.

**Análogo B — el kind base del lock:** `--kind gsd`, `:402-410`:

```js
    } else if (args.kind === 'gsd') {
      const { acquireGsdLock } = await import('../../src/gsd/lock.js');
      const result = acquireGsdLock(args.repo, {
        session_id: 'sess-' + process.pid,
        task_id: 'task-' + process.pid,
        task_ref: 'KL-' + process.pid,
      });
      acquired = result.acquired === true;
    }
```

**CRÍTICO — disciplina de import dinámico post-HOME:** los kinds nuevos mantienen
`await import('../../src/gsd/lock.js')` dinámico. La razón está documentada en el propio helper
(`:166-168`): «The import MUST stay dynamic and POST-HOME … a static import would write to the
operator's REAL ~/.kodo». Para `gsd/lock.js` la fuga de HOME no aplica (opera sobre `--repo`), pero
romper la norma en un fichero donde es norma invita a copiarla mal.

**Análogo C — el canal lateral (marcadores):** `:241-252`:

```js
    // Marcador cross-proceso de rama (Plan 83-06, WR-03). Canal LATERAL: va después del
    // veredicto lógico, en su propio try/catch, y su fallo nunca cambia lo que este hijo
    // imprime ni lo hace lanzar.
    if (branch !== null && args.sandbox) {
      try {
        const { appendFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        appendFileSync(join(args.sandbox, 'capture-branches.log'), branch + '\n');
      } catch {
        /* el marcador es diagnóstico, jamás un veredicto */
      }
    }
```

Molde exacto para `steal-reasons.log` (el `reason` de D-09) y para `stealer-parked` / `holder-seeded`.

**Análogo D — barrera y hold:** `:120-130` (`waitForBarrier`, spin `Atomics.wait` de 1 ms, timeout
5000), `:115-118` (`sleepSync`), `:417-420` (`--hold` del ganador). El creador Case-1 usa `--hold`
para que su PID siga vivo mientras el stealer evalúa `isStaleLock`.

**Contrato de stdout (Pitfall 9):** un único `process.stdout.write` por hijo. El rol **holder** no
adquiere nada → imprime `written`/`failed` (vocabulario de `:159, 197, 253, 280`), **nunca**
`acquired`, para que `verdicts.filter(v => v === 'acquired').length` siga siendo seguro sobre todos
los hijos. El bloque de cabecera del fichero (`:1-94`) documenta cada kind y sus flags: **los kinds
nuevos deben añadir su párrafo ahí y sus flags a la lista de `argv` (`:72-94`)** — es la convención
del fichero, no un extra.

---

### 6. `test/gsd-lock-race.test.js` — orquestación de tres tiempos (D-13, D-14)

**Análogo A — el esqueleto de siembra + spawn + agregación:** `raceGsdStealDeadHolder` (`:74-118`).
La parte a conservar tal cual (Pitfall 4, resolución de symlink):

```js
  mkdirSync(repoDir, { recursive: true });
  // acquireGsdLock resolves the repo via realpathSync, so seed at the realpath'd location.
  const planning = join(realpathSync(repoDir), '.planning');
  mkdirSync(planning, { recursive: true });
```

La parte a **no** copiar: el `pid: 99999999` de `:88` — es el sesgo `DEAD_PID` que esta fase corrige.
La siembra nueva es TTL vencido + `pid: process.pid` desde el hijo holder (molde literal de
`test/gsd-lock.test.js:117-127`).

Y el bloque de spawn/agregación, reutilizable literal (`:101-117`):

```js
  for (let i = 0; i < count; i++) {
    const child = spawn(
      process.execPath,
      [CHILD, '--kind', 'gsd', '--repo', repoDir, '--barrier', goFile, '--hold', '500'],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    child.stdout.on('data', (d) => { outputs[i] += d.toString(); });
    children.push(child);
  }
  const done = Promise.all(children.map((c) => new Promise((resolve) => c.on('close', resolve))));
  writeFileSync(goFile, '1');
  return done.then(() => outputs.map((o) => o.trim()));
```

**Análogo B — la espera acotada del padre:** `test/inbox-concurrency.test.js:132-140`:

```js
/** Espera acotada, no bloqueante, hasta que `pred()` sea cierto. Devuelve si llegó a serlo. */
async function waitUntil(pred, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 2));
  }
  return pred();
}
```

**Análogo C — la liberación por etapas (aquí, TRES en vez de dos):**
`test/inbox-concurrency.test.js:142-192` (`raceChildren` con `gate`). El JSDoc `:145-157` es el
razonamiento a heredar y a re-redactar para los tres tiempos:

```
 * **Liberación en DOS TIEMPOS (`gate`) — por qué existe.** Con un único barrier, los 7 hijos …
 * la carrera la decide el scheduler … el escenario que dice medir «captura DURANTE el marcado» no
 * mide nada … Está MEDIDO, no supuesto: el guard de cobertura de este plan lo puso rojo en el acto
 * (`coordinated=6, failopen=0`) …
```

Y la disciplina de `:159-160`: «Pasado el margen se suelta igualmente al resto: dejar hijos colgados
enmascararía el fallo». Un **go-file por rol**, nunca compartido.

**Análogo D — lector de marcadores + guard de cobertura:**
`test/inbox-concurrency.test.js:210-224` (`readBranchCounts`, NEVER-THROWS, devuelve ceros si falta
el fichero) y `:241-253` (`assertFailopenExercised`) — molde literal de `assertCasExercised`:

```js
function assertFailopenExercised(dir, ctx) {
  const branches = readBranchCounts(dir);
  assert.ok(
    branches.failopen >= 1,
    'COBERTURA PERDIDA: ninguna de las capturas de esta iteración entró por la rama fail-open ' +
      `(coordinated=${branches.coordinated}, failopen=${branches.failopen}). ` +
      'Este escenario existe para ejercitar el camino que PERDÍA datos: si todas las capturas ' +
      'se coordinan, sigue verde sin probar nada … El arreglo es revisar el presupuesto de ' +
      'reintentos del lock o el ancho del hold, JAMÁS borrar ni relajar esta aserción.\n' + ctx,
  );
}
```

**Análogo E — la forma canónica de la aserción (D-14):** `test/gsd-lock-race.test.js:143-151`:

```js
    const verdicts = await raceGsdStealDeadHolder(2);
    const acquired = verdicts.filter((v) => v === 'acquired').length;
    assert.equal(acquired, 1, `exactly one process must steal a shared dead-PID lock; got: ${verdicts.join(',')}`);
```

Y la disciplina de la cabecera del fichero (`:8`): «Asserts on the AGGREGATE, never on which child
wins». La aserción adicional sobre el `session_id` en disco necesita un **comentario que justifique
por qué no la viola** (roles asimétricos por construcción, no por scheduling — Pitfall 10).

**Dónde va:** `describe` nuevo al final del fichero, tras `:162`, reutilizando el
`beforeEach`/`afterEach` de `:24-33`.

---

### 7. `.planning/STATE.md` — declaración de la ventana residual (D-17b)

**Análogo:** `.planning/STATE.md:149-163` §*Critical Invariants to Preserve (cross-milestone)*, donde
ya vive el invariante del lock del inbox (`:156`) y el de cero dependencias npm (`:163`).

**Aviso operativo heredado** (`STATE.md:141`): `state.patch`/`state.update` resuelven por
`tableRowPattern`, que solo casa filas de 2 celdas; la mutación de 85-05 se hizo por `Edit` con
`state.validate` → `valid:true`. El planner debe verificar qué handler de `gsd-tools` cubre la
sección elegida **antes** de asumir que `state.patch` sirve.

---

## Shared Patterns

### Never-throws en las sondas
**Fuente:** `src/inbox/store.js:803-805` · **Aplicar a:** todo `readFileSync`/`statSync` nuevo en `lock.js`.
```js
} catch {
  changed = true; // conservador: si no se puede comprobar, NO se publica
}
```
Precedente equivalente ya dentro de `lock.js`: `guardIsStale` (`:350-356`) degrada `statSync` fallido
a «desaparecido → rompible», y `readLockContent`/`readGuard` devuelven `null` ante parse fallido.

### Publicación con tmp único + rename, nunca in-place
**Fuente:** `src/gsd/lock.js:458` · **Aplicar a:** el CAS, sin cambios.
```js
const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
```
El CAS **no** altera el modelo de ownership: sigue publicándose por `renameSync`; solo se le antepone
una condición.

### Limpieza best-effort del `tmp` en todos los caminos
**Fuente:** `src/gsd/lock.js:462-468` y `:484-490` · **Aplicar a:** el camino del abort del CAS.
```js
try { unlinkSync(tmp); } catch { /* best-effort */ }
```

### Presupuesto acotado con epílogo que rechaza en vez de forzar
**Fuente:** `src/gsd/lock.js:429` (`MAX_STEAL_ATTEMPTS`) y `:493-507` (epílogo) ·
**Aplicar a:** el `continue` de D-05, que consume del presupuesto **existente**.
El epílogo de `:493-507` **no se toca**. Subir el presupuesto es DEBT-04 (LOCKED).

### Observabilidad con prefijo de módulo
**Fuente:** `src/gsd/lock.js:150-153, 425` · **Aplicar a:** el `console.error` del `reason` (D-09).
```js
console.error(
  `[kodo:lock] Stealing expired lock from ${existing.task_ref} ` +
    `(acquired ${existing.acquired_at}, TTL ${ttlHours}h exceeded)`,
);
```
Interpolar **solo** campos ya interpolados hoy (`task_ref`), nunca el contenido crudo del lock: el
`.kodo.lock` es editable a mano y sería un vector de control chars hacia el terminal.

### Marcador cross-proceso por canal lateral
**Fuente:** `test/helpers/lock-race-child.mjs:241-252` · **Aplicar a:** todos los kinds nuevos.
El fallo del marcador nunca cambia el veredicto por stdout ni hace lanzar al hijo.

### `// @ts-check` en cabecera de test
**Fuente:** `test/gsd-lock-race.test.js:1` · **Aplicar a:** el fichero al extenderlo (ya lo lleva).

---

## No Analog Found

Ninguno. Los tres ficheros de código de la fase existen y tienen análogo exacto; el único artefacto
sin análogo directo de *implementación* es la evidencia manual de la mordida (LOCK-06), que no es
código sino formato de registro — su molde documental está en
`.planning/milestones/v0.19-phases/83-.../83-VERIFICATION.md:78` y `.planning/STATE.md:113`:

> «83-06: … se verifica su MORDIDA: con el guard compare-and-swap de 83-04 revertido a mano
> sobreviven 0 de 6 con exit 0 en los 7 procesos; restaurado, 6 de 6»

---

## Divergencias deliberadas respecto al análogo principal (documentar en el código)

| Punto | `src/inbox/store.js` | Esta fase | Por qué |
|---|---|---|---|
| Detector de cambio | `size !== baseBytes` | `Buffer.equals(raw)` completo | El lock se reemplaza entero; dos contenidos distintos caben en el mismo tamaño (D-02, Pitfall 1) |
| Lectura del baseline | `readFileSync(path, 'utf-8')` | `readFileSync(path)` → `Buffer` | Elimina la clase de fallos por transcodificación U+FFFD (Pitfall 2). La degradación documentada en `store.js:685-690` **no transfiere**: allí se compara lectura contra `stat`; aquí, lectura contra lectura |
| Resolución del destino | `resolvePublishTarget` (`realpathSync` + `chmod`) | ninguna — se usa `lockPath` tal cual | `lockPathFor` ya resolvió el symlink sobre el projectPath; una segunda resolución haría sondear un path distinto del que el `rename` toca (Pitfall 4) |
| Borrado del `tmp` | `rmSync(tmp, {force:true})` | `try { unlinkSync(tmp); } catch {}` | Convención vigente del módulo del lock (`:463-467`) |
| Salida del camino «changed» | siguiente vuelta del `for` interno, dentro del mismo lock | `continue` del `for` externo, soltando el guard por el `finally` | El guard debe liberarse entre intentos o el siguiente se estrella contra sí mismo (Pitfall 5) |
| Seam | `sleepSync(holdMs)` fijo | espera a fichero-barrera, timeout < `STEAL_GUARD_STALE_MS` | La contraparte aquí **sí** es observable desde el padre; elimina la dependencia de anchura de ventana (Pitfall 8) |

---

## Metadata

**Alcance de la búsqueda de análogos:** `src/gsd/`, `src/inbox/`, `src/triggers/`, `test/`,
`test/helpers/`.
**Ficheros leídos íntegros o en rangos dirigidos:** `src/gsd/lock.js` (`:40-209`, `:250-270`,
`:340-360`, `:390-509`), `src/inbox/store.js` (`:590-839`), `test/gsd-lock-race.test.js` (completo),
`test/helpers/lock-race-child.mjs` (completo), `test/inbox-concurrency.test.js` (`:95-269`),
`src/triggers/dispatcher.js` (`:60-85`, `:195-205`).
**Fecha de extracción:** 2026-08-05
