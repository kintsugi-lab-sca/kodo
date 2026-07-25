---
phase: 83-inbox-foundation-captura-triage
plan: 04
subsystem: inbox
tags: [inbox, concurrency, compare-and-swap, lost-update, rmw, symlink-identity, file-mode, gap-closure, debt-04]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 01)
    provides: "`src/inbox/store.js` con `markCapture`, el seam `_afterReadFn` y la publicación tmp+rename"
  - phase: 83-inbox-foundation-captura-triage (plan 03)
    provides: "`test/inbox-concurrency.test.js` y los kinds `capture`/`mark` del harness — la evidencia multi-proceso que este plan deja verde de verdad"
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: "DEBT-04: una carrera nunca se pone verde enmascarándola"
  - phase: 70-lock-primitive
    provides: "`withFileLock` y sus defaults (8 × 20 ms, TTL 10 s) — la primitiva a la que vuelve el presupuesto de la captura"
provides:
  - "Guard compare-and-swap en `markCapture`: el invariante de CAPT-03 crit 3 depende del ESTADO del fichero (bytes de la lectura + inodo del destino), no del reloj"
  - "Reintento acotado del RMW (`MARK_RMW_ATTEMPTS = 5`) dentro de una única toma del lock"
  - "`reason: 'concurrent-write'` — fallo ruidoso y reintentable con el fichero INTACTO, en vez de clobber silencioso con exit 0"
  - "`markCapture` devuelve la captura PERSISTIDA, re-parseada de la línea escrita (WR-07)"
  - "`resolvePublishTarget`: la publicación conserva el inodo real (symlink) y el modo del operador (WR-01)"
  - "Presupuesto del lock de la captura de vuelta al default de la primitiva: la rama fail-open vuelve a ser ALCANZABLE (WR-03)"
affects: [84-superficies-de-captura, CAPT-01, CAPT-03, CAPT-06, 83-06, 83-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Compare-and-swap sobre estado de fichero con el baseline de bytes tomado de la LECTURA (`Buffer.byteLength(raw)`), nunca de un `statSync` separado que podría absorber el append que se busca detectar"
    - "Reintento acotado del RMW DENTRO de una sola toma del lock: el lock protege contra otros marcados, el reintento contra los escritores descoordinados"
    - "Publicación por rename que resuelve el destino real (`realpathSync`) y reaplica el modo con `chmodSync` explícito — la opción `mode` de la escritura queda sujeta al umask"
    - "Provocar el agotamiento de un bucle acotado con una condición de estado PERMANENTE (byte UTF-8 inválido) en vez de con un seam por intento: cero código de test en producción, cero dependencia del reloj"

key-files:
  created: []
  modified:
    - "src/inbox/store.js"
    - "test/inbox-store.test.js"

key-decisions:
  - "83-04: REVIERTE la decisión central de 83-03. El lost-update NO se cerró subiendo `CAPTURE_LOCK_RETRIES` de 8 a 50 (~160 ms → ~1000 ms): eso solo movió el umbral. El verificador reprodujo la pérdida TOTAL (0 de 6 supervivientes, exit 0 en los 7 procesos) con un hold de 1500 ms usando el harness del propio repo. Las dos entradas de §Accumulated Context de STATE.md que afirman ese cierre quedan FALSIFICADAS"
  - "83-04: el invariante pasa a ser un guard compare-and-swap dentro del lock. Baseline = `Buffer.byteLength(raw, 'utf-8')` (de la LECTURA) + `ino` del destino; comprobación contra un `statSync` FRESCO tras escribir el tmp y justo antes del `renameSync`"
  - "83-04: el baseline de bytes NO sale de un `statSync` previo — ése es el error del snippet de 83-REVIEW §CR-02. Un stat tomado por separado puede absorber un append que la lectura no vio y volver el guard ciego justo ante el caso que debe detectar"
  - "83-04: `mtimeMs` queda FUERA de la comparación a propósito — es redundante (todo append cambia el tamaño) y un `touch` produciría reintentos espurios"
  - "83-04: el seam `_afterReadFn` se dispara solo en el PRIMER intento; si se disparase en cada uno, el hold del test de concurrencia se multiplicaría por `MARK_RMW_ATTEMPTS` y el escenario dejaría de converger"
  - "83-04: `not-found` y `already-closed` son terminales y NO consumen intentos — no son condiciones de carrera"
  - "83-04: presupuesto del lock de la captura de vuelta al default. Ya no carga ningún invariante, la medición real de la sección crítica es 20,3 ms sobre 5,8 MB (el default cubre 8× el peor caso realista) y la rama fail-open vuelve a ser alcanzable — una rama inalcanzable es una rama sin cobertura (DEBT-04)"
  - "83-04: la ventana residual entre el `statSync` de comprobación y el `renameSync` (dos syscalls contiguos) se DECLARA en el JSDoc en vez de omitirse. Ningún lock puede cerrarla mientras D-03 mantenga el append fail-open fuera de coordinación; lo que cambia es la magnitud, no la existencia"
  - "83-04: la degradación conservadora ante bytes no-UTF-8 (agotamiento → `concurrent-write`, fichero intacto) se acepta y se documenta: publicar habría reescrito esos bytes ajenos como mojibake, violando D-04. El arreglo estructural (RMW sobre `Buffer`) queda en `deferred-items.md`"

patterns-established:
  - "Un fix de carrera que solo mueve un umbral temporal no es un fix: el invariante tiene que poder enunciarse sin mencionar el reloj"
  - "El JSDoc declara la ventana residual que el código NO cierra — un comentario que promete un cierre inexistente desarma al siguiente mantenedor y es peor que la ausencia de comentario"

requirements-completed: [CAPT-01, CAPT-03, CAPT-06]

coverage:
  - id: D1
    description: "Un append que aterriza en la ventana lectura→rename NO se pierde: el guard lo detecta por tamaño y el RMW se rehace sobre el fichero nuevo; el fichero final contiene la línea marcada Y la appendeada"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#un append en la ventana lectura→rename NO se pierde: el RMW se rehace sobre el fichero nuevo"
        status: pass
      - kind: integration
        ref: "Repro exacto del verificador con el harness del repo (1 `mark --hold 1500` + 6 `capture`): 6 de 6 supervivientes contra 0 de 6 en el baseline pre-83-04"
        status: pass
    human_judgment: false
  - id: D2
    description: "Toda línea ajena sobrevive byte a byte AUNQUE el RMW se rehaga: el reintento vuelve a leer y vuelve a sustituir SOLO la línea marcada (D-04)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#toda línea ajena sobrevive byte a byte AUNQUE el RMW se rehaga (D-04 a través del reintento)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Una publicación por rename de un tercero con el MISMO tamaño exacto se detecta por el componente `ino` del baseline y también rehace el RMW"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#una publicación por rename de un tercero con el MISMO tamaño se detecta por INODO"
        status: pass
    human_judgment: false
  - id: D4
    description: "Agotados los intentos acotados, `markCapture` devuelve `{ok:false, reason:'concurrent-write'}`, el fichero queda byte-idéntico (sha256), la línea objetivo sigue ABIERTA y no queda ningún tmp residual"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#agotados los intentos → concurrent-write, fichero byte-idéntico y línea objetivo ABIERTA · #el agotamiento no deja NINGÚN fichero temporal residual · #agotamiento CON un append en la ventana"
        status: pass
    human_judgment: false
  - id: D5
    description: "`markCapture` devuelve exactamente la captura PERSISTIDA: un `dest` por encima de `MAX_DEST_LEN` vuelve ya recortado, `descartada` no conserva un `dest` que la línea no contiene y un texto hand-editado largo vuelve recortado (CAPT-06 / WR-07)"
    requirement: CAPT-06
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — devuelve la captura PERSISTIDA, no el objeto pre-saneo (WR-07, CAPT-06) — 3 casos, todos con `deepEqual` contra `parseLine` del fichero"
        status: pass
    human_judgment: false
  - id: D6
    description: "El presupuesto del lock de la captura es el default de la primitiva: con el lock tomado, `appendCapture` alcanza el fail-open en menos de 700 ms de pared y devuelve `coordinated:false`"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#el presupuesto del lock es el DEFAULT de la primitiva, no el recalibrado de 83-03 (WR-03)"
        status: pass
      - kind: source-hygiene
        ref: "`grep -v '^\\s*\\*' src/inbox/store.js | grep -v '^\\s*//' | grep -c 'CAPTURE_LOCK_RETRIES'` → 0 · ídem `CAPTURE_LOCK_BACKOFF_MS` → 0"
        status: pass
    human_judgment: false
  - id: D7
    description: "La publicación conserva la identidad del destino: un inbox symlinkeado sigue siendo un symlink y el fichero real recibe la línea marcada; un `chmod 0600` explícito sobrevive; el modo por umask de un fichero recién creado no se altera"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — la publicación preserva la identidad del destino (WR-01) — 3 casos"
        status: pass
    human_judgment: false
  - id: D8
    description: "`test/inbox-concurrency.test.js` sigue en verde SIN haber sido modificado, ahora con las capturas entrando de verdad por la rama fail-open (el presupuesto ya no las mantiene en el carril coordinado)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "`node --test test/inbox-concurrency.test.js` exit 0 · `git diff --stat test/inbox-concurrency.test.js` vacío"
        status: pass
    human_judgment: false
  - id: D9
    description: "Ningún comentario del módulo afirma un cierre de riesgo que el código no dé: el JSDoc de `markCapture` declara la ventana residual entre el `statSync` y el `renameSync`, y el de `appendCapture` sustituye la narrativa de cierre de 83-03 por la medición real"
    requirement: CAPT-03
    verification:
      - kind: manual
        ref: "Revisión del JSDoc de `markCapture` (§Guard compare-and-swap, §Ventana residual, §Degradación conservadora) y de `appendCapture` (§Presupuesto de reintentos, puntos a/b/c)"
        status: pass
    human_judgment: true

# Metrics
duration: 6min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 04: Guard compare-and-swap del marcado Summary

**GAP-1 se cierra sustituyendo el umbral temporal de 83-03 por un guard compare-and-swap dentro del lock —baseline de bytes tomado de la LECTURA más el inodo del destino, comprobado justo antes del `renameSync`— con reintento acotado a 5 y un `concurrent-write` ruidoso que deja el fichero intacto; el presupuesto del lock de la captura vuelve al default de la primitiva y la publicación deja de destruir el symlink y los permisos del operador.**

## Performance

- **Duration:** 6 min
- **Tasks:** 2 (4 commits: RED/GREEN por tarea)
- **Files:** 2 modificados (`src/inbox/store.js` 762 líneas · `test/inbox-store.test.js` 919 líneas)

## Qué se construyó

### Task 1 — Guard compare-and-swap y reintento acotado del RMW

El cuerpo de `markCapture` pasa a ser un bucle de `MARK_RMW_ATTEMPTS = 5` intentos **dentro de una
única toma del lock** (no se suelta ni se retoma: el lock sigue protegiendo contra otros marcados;
lo que se reintenta es la lectura frente a los appends descoordinados de D-03).

Por intento:

1. lectura fresca → `baseBytes = Buffer.byteLength(raw, 'utf-8')` y `baseIno = statSync(target).ino`;
2. localización por id, sustitución de SOLO ese elemento, `encoded = encodeLine(updated)` y
   `persisted = parseLine(encoded) ?? updated`;
3. `_afterReadFn` solo si `attempt === 0`;
4. escribir el tmp → `statSync` FRESCO → comparar `size` y `ino` → `renameSync` o descartar el tmp
   y volver a empezar.

`not-found` y `already-closed` se devuelven inmediatamente sin consumir intentos. Agotado el techo,
`{ok:false, reason:'concurrent-write'}` sin haber tocado el fichero.

**El orden es el fix.** El snippet de `83-REVIEW.md` §CR-02 toma el `statSync` del baseline
*después* del `readFileSync`; con ese orden un append que aterrice entre ambos entra en el baseline
y el guard queda ciego justo ante el caso que debe detectar. El baseline de bytes sale de la
lectura misma, y eso está escrito en el JSDoc para que nadie lo «optimice» más tarde. `mtimeMs`
queda fuera de la comparación a propósito (redundante, y un `touch` produciría reintentos
espurios).

### Task 2 — Presupuesto al default e identidad de la publicación

- **`CAPTURE_LOCK_RETRIES` y `CAPTURE_LOCK_BACKOFF_MS` eliminadas.** `appendCapture` ya no pasa
  `retries`/`backoffMs` a `withFileLock`; la primitiva aplica sus defaults (8 × 20 ms ≈ 160 ms). Su
  JSDoc registra ahora tres hechos en vez de una narrativa de cierre: (a) el presupuesto no carga
  ningún invariante, (b) la sección crítica real mide 20,3 ms sobre 5,8 MB y el default cubre 8× ese
  peor caso, (c) la rama fail-open vuelve a ser alcanzable, que es lo correcto.
- **`resolvePublishTarget(inboxPath)`** (privado, never-throws) devuelve `{target, mode}` con el
  destino real (`realpathSync`, degradando al propio path) y los 9 bits bajos del modo. El tmp se
  construye sobre `target`, el `chmodSync` explícito se aplica al tmp **antes** del rename (la
  opción `mode` de la escritura queda sujeta al umask y no reproduce un 0600 del operador) y el
  `renameSync` publica sobre `target`.

## Evidencia decisiva

Repro exacto del verificador con el harness del propio repo (`test/helpers/lock-race-child.mjs`),
1 `mark --hold 1500` + 6 `capture`, HOME en sandbox:

| Store | Veredictos | Supervivientes de las 6 capturas |
|-------|-----------|----------------------------------|
| `f8daf58` (pre-83-04) | 7 × `written`, exit 0 | **0 de 6** |
| `9da1044` (post-83-04) | 7 × `written`, exit 0 | **6 de 6** |

El hold de 1500 ms está por encima de cualquier presupuesto de reintentos, así que la diferencia no
la produce el reloj: la produce el guard.

## Corrección de contexto acumulado

`.planning/STATE.md` §Accumulated Context contiene dos entradas de 83-03 que este plan
**falsifica** y que no deben seguir propagándose:

1. «el lost-update se cerró subiendo `CAPTURE_LOCK_RETRIES` a 50» → **falso**. El umbral solo se
   movió; con un hold de 1500 ms la pérdida es total. Quien cierra el lost-update es el guard
   compare-and-swap, y las dos constantes ya no existen.
2. «el presupuesto solo aleja el fail-open» → **obsoleto**. El presupuesto vuelve al default y el
   fail-open es deliberadamente alcanzable otra vez: mantenerlo inalcanzable era enmascarar la
   carrera, que es lo que DEBT-04 (Phase 82) prohíbe por nombre.

## Deviations from Plan

Ninguna desviación de contrato. Dos concreciones que el plan delegaba explícitamente al ejecutor:

**1. Variante elegida para probar el agotamiento del RMW.** El plan dejaba abierta la forma de
provocar «cambio en todos los intentos» y solo exigía que no requiriera código de test en
producción. El seam `_afterReadFn` pertenece al primer intento por diseño, y espiar el `statSync`
del guard no es viable con imports estáticos de `node:fs`. La variante adoptada es una condición de
estado **permanente y libre de reloj**: un byte `0x80` huérfano en una línea ajena hace que
`readFileSync(…, 'utf-8')` lo sustituya por U+FFFD, así que `Buffer.byteLength(raw)` nunca puede
igualar el `size` y el guard reporta «cambiado» en los 5 intentos. Está documentado en el propio
test.

**2. [Rule 2 — honestidad del comentario] Degradación conservadora documentada.** Esa misma
variante revela una consecuencia real del guard: un inbox con bytes no-UTF-8 no se puede marcar
(devuelve `concurrent-write` y deja el fichero intacto). Se acepta y se declara en el JSDoc porque
la alternativa —publicar— reescribiría esos bytes ajenos como mojibake, violando D-04. El arreglo
estructural (RMW sobre `Buffer` en vez de sobre `string`) queda registrado en
`deferred-items.md` de la fase, no se improvisa aquí.

## Verification

- `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` → 98 tests, 0 fallos.
- `node --test test/inbox-concurrency.test.js test/inbox-cli.test.js` → 63 tests, 0 fallos, **sin
  modificar ninguno de los dos ficheros**.
- `npm test` → 2531 pass, 0 fail, 1 skip.
- `git diff --stat package.json package-lock.json` → vacío (invariante cero deps).
- Greps de contrato: `concurrent-write` 5 · `MARK_RMW_ATTEMPTS` 4 · `Buffer.byteLength` 3 ·
  `parseLine(encoded` 1 · `resolvePublishTarget` 2 · `realpathSync` 2 · `chmodSync` 3 ·
  `renameSync(tmp, target)` 1 · `withFileLock` 6 · `CAPTURE_LOCK_RETRIES` fuera de comentarios 0 ·
  `\.trim\(\)\.split|filter\(Boolean\)` 0.

## Known Stubs

Ninguno. No hay valores vacíos hardcodeados, placeholders ni componentes sin fuente de datos: los
dos ficheros tocados son lógica de dominio y su unit.

## Riesgo residual declarado (no es una omisión)

Entre el `statSync` de comprobación y el `renameSync` quedan dos syscalls adyacentes. Un append
fail-open que aterrice exactamente ahí sigue pudiendo perderse, y **ningún lock puede cerrar ese
hueco** mientras D-03 mantenga ese append deliberadamente fuera de coordinación. Lo que cambia con
este plan es la magnitud: la ventana pasa de ser toda la sección crítica del marcado (segundos, si
el titular del lock se atasca dentro de su TTL de 10 s) a ser el hueco entre dos syscalls contiguos,
y deja de depender de ningún presupuesto de tiempo. Está escrito así en el JSDoc de `markCapture`,
sin prometer un cierre total.

## Para el siguiente plan

- **83-06** debe añadir el escenario multi-proceso con hold POR ENCIMA de cualquier presupuesto
  (≥ 1500 ms) — el que hoy se ha reproducido a mano y que el test de 83-03 dejó de cubrir.
- **83-07** debe mapear `concurrent-write` a su copy propia en `src/cli/inbox.js`; hasta entonces la
  rama `default` del handler ya lo lleva a exit 1, así que el exit code es correcto desde este
  commit y solo la copy es genérica.

## Self-Check: PASSED

- Ficheros declarados presentes en disco: `src/inbox/store.js`, `test/inbox-store.test.js`,
  `83-04-SUMMARY.md`, `deferred-items.md`.
- Commits declarados presentes en el historial: `f6c5e7f`, `a35469b`, `57906d8`, `9da1044`.
- `git diff --stat test/inbox-concurrency.test.js test/helpers/lock-race-child.mjs` vacío: la
  evidencia multi-proceso de 83-03 sigue en verde sin haber sido tocada.
