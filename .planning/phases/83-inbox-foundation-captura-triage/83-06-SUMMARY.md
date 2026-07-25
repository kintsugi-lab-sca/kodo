---
phase: 83-inbox-foundation-captura-triage
plan: 06
subsystem: inbox
tags: [inbox, concurrency, lost-update, coverage-guard, anti-masking, debt-04, gap-closure, multiproceso]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 04)
    provides: "El guard compare-and-swap de `markCapture` — el invariante que este plan intenta romper"
  - phase: 83-inbox-foundation-captura-triage (plan 03)
    provides: "`test/inbox-concurrency.test.js` y los kinds `capture`/`mark` del harness compartido"
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: "DEBT-04: una carrera nunca se pone verde enmascarándola"
provides:
  - "Escenario 3: 1 marcado con hold de 1500 ms + 6 capturas × 3 iteraciones — el caso que destruye 6 de 6 capturas sin el guard de 83-04, ahora EN la suite"
  - "Guard de cobertura de la rama fail-open en los DOS escenarios mixtos: la suite se pone ROJA si la rama que perdía datos deja de ejercitarse"
  - "`capture-branches.log`: marcador cross-proceso de rama por hijo de captura, canal lateral del harness compartido"
  - "Liberación en dos tiempos (`gate` de `raceChildren`): la colisión marcado↔captura pasa de accidental a segura"
  - "Comprobación de mordida MEDIDA: 0 de 6 supervivientes sin el guard, 6 de 6 con él, desde la propia suite"
affects: [84-superficies-de-captura, CAPT-01, CAPT-03, 83-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard de cobertura: un test de carrera mide y assertá QUÉ RAMA recorrió, no solo su resultado — así perder cobertura se convierte en un fallo en vez de en un silencio"
    - "Marcador cross-proceso por append a un fichero del sandbox como CANAL LATERAL: el contrato de salida por stdout no cambia y los consumidores previos del harness no se enteran"
    - "Liberación en dos tiempos de una carrera multi-proceso: se suelta al titular del lock, se espera a que el lockfile exista y solo entonces se suelta a los contendientes — la colisión deja de depender del scheduler"
    - "Comprobación de mordida obligatoria: revertir el arreglo a mano y exigir que el escenario se ponga ROJO antes de dar la tarea por hecha"

key-files:
  created: []
  modified:
    - "test/helpers/lock-race-child.mjs"
    - "test/inbox-concurrency.test.js"

key-decisions:
  - "83-06: el escenario 3 fija el hold en 1500 ms y ese valor NO se baja — está por encima del default de la primitiva (160 ms) Y del presupuesto elevado de 83-03 (~1000 ms), así que ningún ajuste temporal del lock puede sacar a las capturas de la ventana"
  - "83-06: el guard de cobertura lee un marcador cross-proceso REAL (`capture-branches.log`), no infiere la rama del resultado — el resultado es idéntico en las dos ramas, que es precisamente por qué el apagón de cobertura de 83-03 fue invisible"
  - "83-06: la cabecera del fichero de test ELIMINA «subir el presupuesto de reintentos del lock» de la lista de arreglos admitidos; el único admitido pasa a ser corregir el invariante en producción"
  - "83-06 [desviación]: los escenarios mixtos pasan a una liberación en DOS TIEMPOS. Con un único barrier las 6 capturas podían tomar el lock antes que el marcado y terminar antes de que la ventana se abriera: el escenario no medía la colisión que dice medir. Lo destapó el propio guard nada más añadirlo (`coordinated=6, failopen=0`). Endurece, no relaja: hold, número de hijos y aserciones intactos"
  - "83-06: el marcador es un canal LATERAL con su propio try/catch — un fallo al escribirlo jamás cambia el veredicto del hijo ni lo hace lanzar, y el contrato de stdout del que dependen seis suites queda byte a byte"

patterns-established:
  - "Un test de carrera que no mide su propia cobertura puede apagarse en silencio: assertar el resultado NO basta cuando las dos ramas producen el mismo resultado en el camino feliz"
  - "Antes de dar por buena una prueba de regresión de concurrencia, revertir el arreglo y exigir el ROJO. Si pasa con y sin el arreglo, no es evidencia de nada"

requirements-completed: [CAPT-01, CAPT-03]

coverage:
  - id: D1
    description: "Existe en la suite un escenario multi-proceso cuyo titular del lock sostiene la ventana lectura→rename POR ENCIMA de cualquier presupuesto de reintentos (1500 ms) y en el que ninguna de las 6 capturas concurrentes se pierde (CAPT-03 crit 3)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#escenario 3 — captura concurrente con la ventana POR ENCIMA de cualquier presupuesto (1500 ms), ×3"
        status: pass
    human_judgment: false
  - id: D2
    description: "Ese escenario CAE si el invariante se revierte: con el guard compare-and-swap desactivado a mano en `src/inbox/store.js`, sobreviven 0 de 6 capturas con exit 0 en los 7 procesos"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "Comprobación de mordida — `changed = false` en el guard → escenario 3 ROJO en la iteración 1 por `captura cap000 PERDIDA`; restaurado → verde"
        status: pass
    human_judgment: false
  - id: D3
    description: "Los dos escenarios mixtos DEMUESTRAN de forma medida que la rama fail-open se ejercita: al menos un hijo de captura reporta haber entrado por ella en cada iteración"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#assertFailopenExercised, aplicado en el escenario 2 y en el escenario 3 · medición directa: 6 de 6 `failopen` con hold 300 ms y con hold 1500 ms"
        status: pass
    human_judgment: false
  - id: D4
    description: "Si la rama fail-open dejara de alcanzarse, la suite se pone ROJA en vez de perder cobertura en silencio"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "El guard falló de verdad en su primera ejecución (`COBERTURA PERDIDA … coordinated=6, failopen=0`) antes de la liberación en dos tiempos — la mordida del propio guard está medida, no supuesta"
        status: pass
    human_judgment: false
  - id: D5
    description: "El escenario por encima del presupuesto pasa en ejecuciones REPETIDAS (3 iteraciones internas × 3 ejecuciones consecutivas del fichero)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "`node --test test/inbox-concurrency.test.js` × 3 → exit 0, `# pass 3 / # fail 0` las tres veces"
        status: pass
    human_judgment: false
  - id: D6
    description: "Toda línea ajena preexistente sobrevive byte a byte al escenario, incluidas las que no parsean, aunque el marcado haya tenido que rehacer su RMW (D-04); y no queda residuo de tmp"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "Bloques 3 y 6 del escenario 3 (fixture byte-exacto de 4 líneas + `readdirSync` filtrando `.tmp.`)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Los procesos hijo escriben exclusivamente en un HOME sandbox: el inbox real del operador nunca se toca al correr la suite"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "sha256 de `~/.kodo/inbox.md` idéntico antes y después de `npm test`; 0 líneas con `kodo-race`/`captura concurrente`. Invocación manual del harness: el inbox y el marcador se crean dentro del temporal"
        status: pass
    human_judgment: false
  - id: D8
    description: "Los seis consumidores previos del harness compartido siguen en verde: el contrato de salida por stdout de los kinds existentes no cambia"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "`npm test` → 2538 pass / 0 fail · `git diff -U0 test/helpers/lock-race-child.mjs` con hunks solo en la cabecera y en el bloque del kind `capture`"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 06: Escenario por encima del presupuesto y guard de cobertura Summary

**GAP-1 queda decidido con evidencia y no con confianza: la suite incorpora el escenario de 1500 ms que destruía 6 de 6 capturas —se pone ROJO en cuanto el guard compare-and-swap de 83-04 se revierte a mano— y un guard de cobertura que lee un marcador cross-proceso real y falla si la rama fail-open deja de ejercitarse; ese mismo guard destapó, nada más añadirse, que la colisión marcado↔captura dependía del scheduler, y ahora se fuerza con una liberación en dos tiempos.**

## Performance

- **Duration:** 8 min
- **Tasks:** 2 (2 commits)
- **Files:** 2 modificados (`test/helpers/lock-race-child.mjs` 426 líneas · `test/inbox-concurrency.test.js` 549 líneas)

## Qué se construyó

### Task 1 — El kind de captura registra la rama que tomó (`482b3f2`)

`--kind capture` pasa a leer el flag `--sandbox` que el harness ya documentaba para los kinds
`polling` y `dispatch`. Cuando está presente, tras la llamada a `appendCapture` el hijo appendea
UNA línea a `<sandbox>/capture-branches.log` con `coordinated` (obtuvo el lock) o `failopen`
(lock-timeout, D-03), usando la misma primitiva de append que esos dos kinds.

Tres propiedades lo hacen seguro para un harness con seis consumidores previos:

1. **Canal lateral.** El contrato de salida por stdout (`written` / `failed`) y el exit 0 quedan
   byte a byte. Ningún padre tiene que parsear un formato nuevo.
2. **Nunca un veredicto.** El append del marcador vive en su propio `try/catch`, después de fijar
   el veredicto lógico. Si falla, el hijo imprime exactamente lo mismo y no lanza.
3. **Sin marca ante fallo.** Si `appendCapture` devuelve `ok:false` o lanza, no se escribe línea:
   el veredicto por stdout ya cubre ese caso y una marca ahí falsearía el recuento.

El diff está confinado a la cabecera y al bloque del kind `capture` (`git diff -U0` → hunks en 46,
65, 211, 233, 239; el bloque `capture` ocupa 210-250). Los kinds `state`, `gsd`, `writer`,
`handoff`, `polling` y `dispatch` no tienen ni una línea tocada.

### Task 2 — Escenario 3 y guard de cobertura (`5f59c3f`)

- **`OVER_BUDGET_WINDOW_MS = 1500`** con el porqué escrito al lado: es el hold con el que el
  verificador reprodujo la pérdida total y con el que 83-04 midió su antes/después. Está por encima
  del default de la primitiva (160 ms) **y** del presupuesto elevado de 83-03 (~1000 ms), así que
  ningún ajuste temporal del lock puede sacar a las capturas de la ventana. Queda escrito que no se
  baja. **`OVER_BUDGET_ITERATIONS = 3`**: el hold domina el tiempo de pared y tres repeticiones ya
  descartan una coincidencia de scheduling.
- **Escenario 3**, hermano del 2: mismo fixture byte-exacto de 4 líneas, 1 marcado con trace
  pointer + 6 capturas, y seis bloques de aserción — las 6 capturas presentes, abiertas y con su
  texto íntegro (la que decide el gap); el marcado cerrado, enrutado y con su identidad completa;
  las 3 líneas ajenas byte a byte y la original sustituida, no duplicada; el total de líneas de
  captura; el guard de cobertura; y cero residuo de tmp pese al RMW rehecho.
- **`assertFailopenExercised`**, aplicado a los **dos** escenarios mixtos, sobre el recuento real
  del marcador. Su mensaje explica el porqué y nombra el arreglo admitido (revisar presupuesto o
  hold) y el prohibido (borrar o relajar la aserción).
- **Cabecera reescrita.** «Subir el presupuesto de reintentos del lock» queda **eliminada** de la
  lista de arreglos admitidos, con la razón: no cierra nada —con 1500 ms la pérdida vuelve a ser
  total— y es el enmascaramiento que DEBT-04 prohíbe por nombre. La lista de lo que NUNCA se hace
  se amplía con «borrar el guard de cobertura es esa misma jugada con otro nombre».

## Evidencia decisiva

**Comprobación de mordida (obligatoria).** Guard compare-and-swap desactivado a mano en
`src/inbox/store.js` (`changed = false`, sustituyendo el `statSync` fresco y su comparación),
`node --test test/inbox-concurrency.test.js`:

| Store | Veredictos | Supervivientes de las 6 | Escenario 3 |
|-------|------------|--------------------------|-------------|
| Guard revertido a mano | 7 × `written`, exit 0 | **0 de 6** | **ROJO** — `captura cap000 PERDIDA por el RMW del marcado con la ventana por encima del presupuesto`, iteración 1/3; el inbox final solo conserva las 4 líneas del fixture |
| Guard restaurado (`git checkout`) | 7 × `written`, exit 0 | **6 de 6** | **VERDE** ×3 ejecuciones |

El escenario 2 (hold 300 ms) también cae con el guard revertido: la liberación en dos tiempos le
devolvió su mordida, que el barrier único le había quitado a medias.

**Cobertura de la rama fail-open, medida.** Marcador leído tras una carrera con la misma
liberación en dos tiempos: `failopen ×6` con hold 1500 ms y `failopen ×6` con hold 300 ms — la
rama que perdía datos se recorre en las 6 capturas de cada iteración, frente a los 18/18
`coordinated` que 83-REVIEW §WR-03 midió tras la recalibración de 83-03.

## Deviations from Plan

### 1. [Rule 1 — Bug] Los escenarios mixtos pasan a una liberación en DOS TIEMPOS

- **Encontrado durante:** Task 2, en la PRIMERA ejecución con el guard de cobertura puesto.
- **Problema:** el plan justificaba el guard como determinista porque «el hold está por encima del
  presupuesto, así que un hijo que arranca dentro de la ventana agota su presupuesto sí o sí». La
  premisa que falla es *«que arranca dentro de la ventana»*: con un único barrier los 7 hijos
  compiten por el lock a la vez, y si las 6 capturas lo toman ANTES que el marcado terminan antes
  de que la ventana llegue a abrirse. El guard lo puso rojo en el acto —`coordinated=6,
  failopen=0`— en la iteración 2/5 del escenario 2 y en la 1/3 del escenario 3. Es decir: el
  escenario 2 preexistente **ya era una moneda al aire**, y algunas de sus iteraciones no medían
  nada. Sin el guard eso habría seguido invisible, exactamente como el apagón de 83-03.
- **Arreglo:** `raceChildren` acepta un `gate` opcional. El hijo de cabeza (el marcado) se suelta
  con su propio barrier; el resto no se suelta hasta que `existsSync(<sandbox>/.kodo/inbox.lock)`
  confirma que el lock está tomado, con margen acotado de 4000 ms. Los dos escenarios mixtos
  assertan además `gate.fired`: si la confirmación no llegó, la iteración se declara no-evidencia
  en vez de darse por buena.
- **Por qué NO es enmascarar:** no se toca el hold, ni el número de hijos, ni una sola aserción.
  Hace SEGURA una colisión que dependía del scheduler — es lo contrario de relajar el caso. Está
  documentado en la cabecera del fichero y en el JSDoc de `raceChildren` para que el siguiente
  mantenedor no lo lea como un truco de temporización.
- **Ficheros:** `test/inbox-concurrency.test.js` · **Commit:** `5f59c3f`

### 2. Criterio de aceptación `grep -c "it(" == 3` — imposible por construcción, verificado con el grep anclado

`grep -c "it("` cuenta LÍNEAS que contengan la subcadena, y `split(` la contiene: el fichero ya
devolvía 4 antes de este plan (2 casos + 2 `raw.split('\n')`). Tras el plan devuelve 7 (3 casos +
4 `split(`). El criterio se verifica con el grep anclado, que sí expresa la intención:
`grep -cE '^  it\(' test/inbox-concurrency.test.js` → **3**, y `grep -c '\.skip\|\.todo'` → **0**
(la propia cabecera dejó de contener el token literal al reescribir la lista de prohibiciones,
como el plan pedía). No se ha ajustado nada del código para satisfacer un grep.

## Verification

| Gate | Resultado |
|------|-----------|
| `node --test test/inbox-concurrency.test.js` | exit 0 · `# tests 3 / # pass 3 / # fail 0` |
| Tres ejecuciones seguidas | exit 0 las tres · `# pass 3 / # fail 0` |
| `npm test` | **2538 pass · 0 fail · 1 skip** (2537 antes de la Task 2 → +1 caso) |
| Mordida con el guard revertido | escenario 3 ROJO por capturas perdidas; restaurado → verde |
| `OVER_BUDGET_WINDOW_MS` | 5 apariciones · valor `1500` · `OVER_BUDGET_ITERATIONS = 3` |
| `capture-branches` en el test / en el harness | 4 / 3 |
| `failopen` en el test / en el harness · `coordinated` en el harness | 7 / 3 · 5 |
| `'--sandbox'` en el test | 2 (los dos escenarios mixtos) |
| `^  it\(` · `\.skip\|\.todo` | 3 · 0 |
| Líneas de `test/inbox-concurrency.test.js` | 549 (mínimo exigido 320) |
| Import estático de `inbox/store.js` en el harness | 0 — sigue siendo dinámico y post-HOME |
| Aislamiento | sha256 de `~/.kodo/inbox.md` idéntico antes/después de `npm test` · 0 líneas de test en el inbox real · invocación manual del harness crea inbox y marcador dentro del temporal |
| `git diff --stat package.json package-lock.json` | vacío (invariante cero deps) |

## Known Stubs

Ninguno. Los dos ficheros son harness de test y su suite; no hay valores vacíos hardcodeados,
placeholders ni componentes sin fuente de datos.

## Riesgo residual declarado (no es una omisión)

La ventana residual entre el `statSync` de comprobación y el `renameSync` que 83-04 declaró en su
JSDoc **sigue existiendo** y este plan no la cierra ni pretende medirla: dos syscalls contiguos no
son observables desde un test multi-proceso sin un seam nuevo en producción, y añadirlo sería
código de test en el módulo. Lo que este plan demuestra es que la ventana ANCHA —la que dependía
del titular del lock y llegaba a segundos— está cerrada por el guard, y que la rama que la
explotaba sigue siendo recorrida por la suite.

## Para el siguiente plan

- **83-07** mapea `concurrent-write` a su copy propia en `src/cli/inbox.js`. El escenario 3 no lo
  alcanza (el RMW converge en el primer o segundo intento), así que su cobertura sigue siendo la
  unit de 83-04.
- Cobertura deseable diferida con razón, ya registrada en el plan: un escenario con **dos marcados
  concurrentes**. Ambos toman el lock, así que el segundo espera o falla con lock-timeout; no
  ejercita la ventana fail-open, que es el vector de este gap.

## Self-Check: PASSED

- Ficheros declarados presentes en disco: `test/helpers/lock-race-child.mjs`,
  `test/inbox-concurrency.test.js`, `83-06-SUMMARY.md`.
- Commits declarados presentes en el historial: `482b3f2`, `5f59c3f`.
- `git status --short src/inbox/store.js` vacío: la reversión temporal de la comprobación de
  mordida quedó deshecha con `git checkout --` y el guard compare-and-swap está intacto en el
  código (`store.js:725`).
