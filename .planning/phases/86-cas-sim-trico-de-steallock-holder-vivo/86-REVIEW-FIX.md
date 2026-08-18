---
phase: 86-cas-sim-trico-de-steallock-holder-vivo
fixed_at: 2026-08-05T00:00:00Z
review_path: .planning/phases/86-cas-sim-trico-de-steallock-holder-vivo/86-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 86: Code Review Fix Report

**Source review:** `.planning/phases/86-cas-sim-trico-de-steallock-holder-vivo/86-REVIEW.md`
**Iteration:** 1

**Resumen:**
- Findings en alcance: 5 (CR-01, WR-06, WR-01, WR-02, WR-05)
- Corregidos: 5
- Saltados: 0
- Suite: **2599 tests · 2598 pass · 0 fail · 1 skipped** (baseline 2597/2596/0/1)
- `src/triggers/dispatcher.js` y `src/gsd/doctor.js`: **0 líneas de diff**
- `MAX_STEAL_ATTEMPTS = 8` y `STEAL_GUARD_STALE_MS = 5_000`: intactos

**Dónde se ejecutaron las verificaciones:** los tests unitarios y de carrera se
ejecutaron en el worktree aislado (con el `node_modules` del checkout principal
enlazado por symlink); la suite completa (`npm test`) se ejecutó **además** en el
checkout principal tras el fast-forward, con resultado idéntico. Los números son
reproducibles desde el checkout principal.

## Fixed Issues

### CR-01 (BLOCKER): lock presente pero ILEGIBLE volvía INROBABLE

**Ficheros:** `src/gsd/lock.js`
**Commit:** `e9f8155`

`readLockIdentity` devuelve ahora `missing` (cierto **solo** con `ENOENT`) y toma
el `statSync` **también cuando la lectura falla** — en `EACCES` el stat sigue
siendo válido y su `ino` es lo único que permite comparar la identidad. El CAS
trata «ilegible antes **e** ilegible ahora, mismo inodo» como identidad **sin
cambios** (`sameUnreadableFile`), en vez de degradar a `changed = true` para
siempre.

Evidencia medida (mismo probe, lock `0o000` con PID muerto):

```
--- HEAD (con el fix):        EACCES lock -> {"acquired":true}  ms= 4
--- main (con el defecto):    EACCES lock THREW: EEXIST         ms= 12
--- 120e5e9d (pre-fase):      EACCES lock -> {"acquired":true}  ms= 3
```

### WR-06: cobertura de la subclase read-failure

**Ficheros:** `test/gsd-lock-guard.test.js`
**Commit:** `9407af8`

`(i3)` siembra un lock `0o000` y exige que se robe. `(i4)` es su mitad simétrica:
un baseline ilegible **no** autoriza a clobbear al creador vivo que ocupó el path
en la ventana. Precondición explícita: si el proceso puede leer un `0o000` (root),
el caso se **salta**; nunca se relaja la aserción.

Rojo contra el defecto / verde tras el fix:

```
# antes:  not ok 5 - (i3) ...
#         error: "EEXIST: file already exists, open '.../.kodo.lock'"
#         stack: stealLock (src/gsd/lock.js:683)   <- el epílogo
#         # tests 13 # pass 12 # fail 1
# después: # tests 28 # pass 28 # fail 0
```

### WR-01: mitigación ilusoria en el comentario de `task_ref`

**Ficheros:** `src/gsd/lock.js`
**Commit:** `4057d88`

`task_ref` se sanea en el punto de emisión (`/\p{Cc}/gu` + tope de 64) y el
comentario describe lo que el código hace, incluido lo que **no** mitiga: el
mismo patrón sin sanear sigue vivo en `:167` (pre-existente, fuera de alcance).

### WR-02: «by construction» retirado

**Ficheros:** `src/gsd/lock.js`
**Commit:** `7a3579f`

Cabecera de `stealLock` y comentario de `STEAL_GUARD_STALE_MS` reescritos: la
carrera de primer orden queda **acotada** a secciones críticas más cortas que el
umbral, no cerrada por construcción. Cambio de comentarios: cero cambio de
comportamiento.

### WR-05: las cinco señales medidas, asertadas

**Ficheros:** `test/gsd-lock-race.test.js`
**Commit:** `d229b55`

`assertScenarioStaged` aserta `released`, `creatorLanded`, `reasons` y
`parkedMs < 3000`, y corrige el mensaje de `holderVerdict`. Mordida verificada
suprimiendo la escritura de `goRelease`.

## Deliberadamente NO hecho

- **WR-03** (`isPidAlive(undefined|NaN|0|-1) === true`): fuera de alcance por
  instrucción del orquestador — pre-existente y con blast radius sobre
  `doctor.decideLock`.
- **WR-04, WR-07, IN-01..03**: fuera de alcance.
- **La mitad conductual de WR-02** (soltar en el `finally` solo el guard propio):
  es un cambio de conducta del primitivo del guard, pre-existente a esta fase; la
  redacción honesta ahora lo nombra en vez de taparlo.
- **El caso EISDIR de WR-06**: un directorio **no** es robable por `rename` (POSIX
  `EISDIR`), ni antes ni después de esta fase — no es regresión, y un test que
  afirmase lo contrario sería falso. Con el fix, además, falla en el **primer**
  intento con `EISDIR` en vez de quemar los 8 y salir con un `EEXIST` engañoso.

---

_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
