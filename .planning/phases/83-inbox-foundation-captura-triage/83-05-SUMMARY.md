---
phase: 83-inbox-foundation-captura-triage
plan: 05
subsystem: cli
tags: [inbox, cli, stdout-drain, pipe-truncation, exit-codes, gap-closure, dx-06, capt-01]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 02)
    provides: "`src/cli/capture.js` y `src/cli/inbox.js` — los handlers que RETORNAN el código, y el registro de commander en `src/cli.js` que hacía el exit"
  - phase: 83-inbox-foundation-captura-triage (plan 02)
    provides: "`test/inbox-cli.test.js` con sus tres carriles y el helper `kodo()` de `spawnSync` con HOME sandbox — el carril no-TTY que sufría el truncado"
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: "DEBT-04: un defecto nunca se pone verde enmascarándolo — aquí, recortando el fixture por debajo del umbral"
provides:
  - "Los cuatro handlers del inbox (`capture`, `inbox`, `inbox route`, `inbox discard`) fijan `process.exitCode` y dejan drenar stdout: el carril `--json` es consumible de verdad por una pipe"
  - "El carril human canalizado tampoco se corta (paginador, `head`, captura a fichero)"
  - "Regresión de integración con un inbox de ~230 KB que parsea la salida canalizada entera y exige el identificador de la ÚLTIMA captura sembrada"
  - "Helper `seedLargeInbox(home, n, {closedTail})` — siembra de N capturas válidas de UNA sola escritura, devuelve bytes"
  - "La ayuda de `kodo capture` declara el separador de argumentos para textos con guion inicial (WR-05)"
affects: [84-superficies-de-captura, CAPT-01, CAPT-03, CAPT-06, 83-06, 83-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "En una pipe las escrituras a stdout son ASÍNCRONAS: un handler que escribe y termina el proceso de inmediato aborta el buffer a los 65536 bytes. La forma correcta es fijar `process.exitCode` y dejar que el runtime termine cuando el event loop se vacía"
    - "Un gate source-hygiene sobre un fichero con decenas de comandos se acota a la REGIÓN (`sed` entre dos anclas) y filtra los comentarios antes de contar — un gate de fichero completo sería incorrecto por construcción cuando la regla aplica solo a un bloque"
    - "Un assert de no-truncado no se conforma con «parsea»: exige el conteo exacto de elementos Y el identificador del ÚLTIMO elemento sembrado, que es lo que distingue una salida completa de un corte afortunado"
    - "Una limitación conocida se fija con un test que documenta el comportamiento REAL, etiquetado como limitación: si algún día se arregla, el test se pone rojo y obliga a actualizar la expectativa de forma consciente"

key-files:
  created: []
  modified:
    - "src/cli.js"
    - "test/inbox-cli.test.js"

key-decisions:
  - "83-05: los cuatro handlers del inbox pasan de terminar el proceso a fijar `process.exitCode`. El defecto NO estaba en los handlers de `src/cli/` —esos ya retornaban el código, invariante correcto desde 83-02— sino en el registro de commander de `src/cli.js`, que hacía el exit inmediato tras la escritura"
  - "83-05: el cambio se acota deliberadamente a los cuatro comandos del inbox. `polling`, `daemon`, `gsd`, `sidebar` y `skill` conservan su mecanismo actual: emiten payloads acotados muy por debajo de 64 KB y cambiarlos ampliaría el radio de explosión de un cierre de gaps a media superficie CLI. Diferido como deuda para un barrido propio"
  - "83-05: el gate de la Task 1 se acota por `sed` a la región entre el marcador de sección de `kodo capture` y `program.parse`, y filtra las líneas de comentario antes de contar. Un gate de fichero completo sería negativo por construcción (37 usos legítimos en el resto del fichero), y uno sin filtro pondría roja la suite por el propio comentario que documenta la regla — el mismo fallo que ya mordió en 83-01 y que 83-02 fijó como patrón"
  - "83-05: el comentario que explica el drenaje se redacta POR CONCEPTO, sin reproducir el nombre de la llamada retirada, para que el gate no cuente su propia documentación"
  - "83-05: el fixture de la regresión es de 1500 capturas (~230 KB de fichero, ~257 KB de salida). No se recorta «por rapidez»: por debajo del umbral el caso pasaría con y sin el arreglo, que es exactamente el enmascaramiento que DEBT-04 prohíbe. La prohibición está escrita en la cabecera del bloque de tests"
  - "83-05: WR-05 se cierra DOCUMENTANDO la forma segura en la ayuda del propio comando, no interceptando el error de opción desconocida de commander. Interceptarlo exige tocar el manejo global de errores del parser y cambia el comportamiento de la superficie entera; la forma con separador ya funciona y es la que Phase 84 emitirá por contrato"
  - "83-05: la limitación de WR-05 se fija en un test etiquetado como LIMITACIÓN CONOCIDA (exit distinto de 0 + cero escritura), no en un comentario. Registrar la limitación en la memoria de alguien es cómo se pierde una idea dos veces"

patterns-established:
  - "Un carril que se anuncia como scriptable y byte-determinista tiene que ser consumible con volumen REAL, no solo en fixtures de tres líneas — y el test que lo demuestra tiene que fallar cuando el arreglo se quita"
  - "Antes de dar por hecha una regresión de carrera o de truncado: revertir el arreglo a mano y comprobar que se pone ROJA. Un test que pasa con y sin el fix no prueba nada"

requirements-completed: [CAPT-01, CAPT-03, CAPT-06]

coverage:
  - id: D1
    description: "`kodo inbox --json` canalizado a un consumidor no-TTY emite el JSON COMPLETO con un inbox muy por encima de 64 KB: la salida supera 65536 bytes, `JSON.parse` la acepta, el conteo de capturas es exacto y el identificador de la ÚLTIMA captura sembrada está presente"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#--json: la salida canalizada parsea ENTERA y trae las N capturas, con la ÚLTIMA presente (fixture 1500 capturas / 230 KB, salida 257 KB)"
        status: pass
      - kind: manual
        ref: "Repro directo con el binario: `kodo inbox --json | <consumidor>` sobre 1500 capturas → 256 930 bytes, parse OK, 1500 capturas, última `00017n`"
        status: pass
    human_judgment: false
  - id: D2
    description: "La regresión MUERDE: revirtiendo a mano el cambio de `src/cli.js`, los tres casos de tamaño se ponen ROJOS con «se cortó en 65536 bytes». Restaurado el arreglo, verdes de nuevo"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "Revert manual de los 8 puntos de terminación → `node --test test/inbox-cli.test.js` → 62 pass / 3 fail (casos --json, --all --json y human) · `git checkout -- src/cli.js` → 65 pass / 0 fail"
        status: pass
    human_judgment: false
  - id: D3
    description: "`--all --json` canalizado tampoco se corta y el trace pointer (`dest`) de la última captura cerrada llega íntegro — CAPT-06 viaja por el mismo carril"
    requirement: CAPT-06
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#--all --json: la traza completa tampoco se corta y el dest de la última cerrada llega íntegro (1500 capturas, 300 cerradas con estado + dest)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El render human canalizado tampoco se corta: la salida supera 65536 bytes y el identificador de la última fila aparece en el texto"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#el carril HUMAN canalizado tampoco se corta (un paginador es el mismo camino asíncrono)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Los exit codes deterministas de D-13 se conservan exactamente tras el cambio de mecanismo de terminación: 0 ok · 1 error de filesystem o lock · 2 id inexistente, captura ya cerrada o texto vacío"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#los exit codes deterministas de D-13 sobreviven al cambio de mecanismo de terminación (id inexistente → 2 · route válido → 0 con confirmación terminada en newline · re-cerrar → 2), sobre el fixture grande"
        status: pass
      - kind: integration
        ref: "Los 61 tests previos de `test/inbox-cli.test.js` siguen verdes SIN modificar ninguna aserción, incluidos los de exit 2 de `capture \"\"`, `route <inexistente>` y `already-closed`"
        status: pass
      - kind: manual
        ref: "Con HOME sandbox: `kodo inbox` → 0 · `kodo inbox route zzzzzz` → 2 · `kodo capture \"\"` → 2 sin crear el fichero"
        status: pass
    human_judgment: false
  - id: D6
    description: "El drenaje se consigue fijando el código de salida, no forzando la terminación: 8 asignaciones a `process.exitCode` en la región del inbox y CERO llamadas de terminación inmediata en esa misma región (comentarios filtrados)"
    requirement: CAPT-03
    verification:
      - kind: source-hygiene
        ref: "`sed -n '/--- kodo capture ---/,/^program\\.parse/p' src/cli.js | grep -v '^\\s*//' | grep -c 'process\\.exit('` → 0 · `| grep -c 'process\\.exitCode = '` → 8"
        status: pass
    human_judgment: false
  - id: D7
    description: "Ningún comando ajeno al inbox se ha tocado: el resto de `src/cli.js` conserva sus 37 usos del mecanismo anterior y el diff se limita a los cuatro bloques del inbox más el comentario de sección y la descripción del argumento"
    requirement: CAPT-03
    verification:
      - kind: source-hygiene
        ref: "`grep -c 'process\\.exit(' src/cli.js` → 37 (> 0) · `git diff --stat` de la fase: `src/cli.js` 34 líneas tocadas, todas dentro del bloque del inbox"
        status: pass
    human_judgment: false
  - id: D8
    description: "`kodo capture -- \"<texto que empieza por guion>\"` captura la idea VERBATIM (guion inicial incluido) y sale con 0 — la forma que Phase 84 usará por contrato"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#texto que empieza por guion CON el separador `--`: captura verbatim y sale 0 (CAPT-01) — verificado por `parseLine` de la única línea, no por subcadena"
        status: pass
    human_judgment: false
  - id: D9
    description: "La limitación conocida está fijada en código: sin el separador, el mismo texto sale con código distinto de 0, el parser lo reporta como opción desconocida y el inbox NI SIQUIERA se crea"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#LIMITACIÓN CONOCIDA (no deseada): sin `--`, el mismo texto NO se captura y no toca el disco"
        status: pass
    human_judgment: false
  - id: D10
    description: "La ayuda del comando de captura declara explícitamente la forma con separador, de modo que la limitación no se descubra perdiendo una idea"
    requirement: CAPT-01
    verification:
      - kind: manual
        ref: "`kodo capture --help` → la descripción del argumento `text` incluye «antepón el separador de argumentos — `kodo capture -- \"-3 % de conversión\"`». El test D-17 (`--help` no expone `--project`) sigue verde"
        status: pass
    human_judgment: true
  - id: D11
    description: "Invariante cero-dependencias intacto y suite completa en verde"
    requirement: CAPT-03
    verification:
      - kind: source-hygiene
        ref: "`git diff --stat package.json package-lock.json` vacío · gate cero-deps (4 claves) verde"
        status: pass
      - kind: integration
        ref: "`npm test` → 2538 tests, 2537 pass, 0 fail, 1 skipped (el skip es preexistente) · `node --test test/inbox-store.test.js test/inbox-format-golden.test.js test/inbox-concurrency.test.js` → 100/100"
        status: pass
    human_judgment: false

# Metrics
duration: 10min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 05: Drenaje de la salida del inbox Summary

**GAP-2 se cierra sustituyendo la terminación inmediata del proceso por la asignación de `process.exitCode` en los cuatro handlers del inbox —en una pipe las escrituras a stdout son asíncronas y matar el proceso las abortaba en exactamente 65536 bytes—, respaldado por una regresión con un inbox de 1500 capturas que se pone ROJA cuando el arreglo se revierte; además, la ayuda de `kodo capture` declara ahora el separador de argumentos que salva una idea con guion inicial (WR-05).**

## Performance

- **Duration:** 10 min
- **Tasks:** 3 (3 commits)
- **Files:** 2 modificados (`src/cli.js` 936 líneas · `test/inbox-cli.test.js` 1269 líneas)
- **Suite:** 2536 → 2538 tests; `test/inbox-cli.test.js` 61 → 67

## Qué se construyó

### Task 1 — Los cuatro handlers drenan stdout

Los ocho puntos de terminación del bloque del inbox de `src/cli.js` —los cuatro del camino feliz y
los cuatro del `catch`— pasan a asignar el código a `process.exitCode`, dejando que el runtime
termine el proceso cuando el event loop se vacía:

| Handler | Camino feliz | `catch` |
|---------|--------------|---------|
| `kodo capture` | `process.exitCode = runCaptureCli({...})` | `process.exitCode = 1` |
| `kodo inbox` (padre) | `process.exitCode = runInboxListCli({...})` | `process.exitCode = 1` |
| `kodo inbox route <id>` | `process.exitCode = runInboxMarkCli(id, 'enrutada', {...})` | `process.exitCode = 1` |
| `kodo inbox discard <id>` | `process.exitCode = runInboxMarkCli(id, 'descartada', {})` | `process.exitCode = 1` |

**El defecto no estaba donde parecía.** Los handlers de `src/cli/capture.js` y `src/cli/inbox.js`
ya cumplían su invariante desde 83-02: RETORNAN el código, nunca terminan el proceso. El defecto
vivía una capa más arriba, en el registro de commander, que hacía el exit inmediato con ese valor
retornado — y ese exit inmediato es el que abortaba el buffer.

Un comentario de sección encima del bloque de `kodo capture` declara el porqué, la reproducción
medida y —explícitamente— que el resto de comandos del fichero queda fuera del cambio. Está
redactado por concepto, sin nombrar la llamada retirada, para que el gate no cuente su propia
documentación.

### Task 2 — Regresión con volumen real

Helper `seedLargeInbox(home, n, {closedTail})`: construye `n` líneas válidas y deterministas (id
base36 del índice padded a 6, texto largo fijo, tag/origen/fecha fijos) y las escribe de **una sola
llamada**; devuelve los bytes. Con `closedTail` las últimas N nacen cerradas con su sufijo de estado
y su trace pointer. No se usa el binario para sembrar: 1500 spawns harían el test inutilizable.

Cuatro casos sobre `N = 1500` (fichero 230 776 bytes):

1. **`--json` canalizado** — exit 0, salida > 65536 bytes, `JSON.parse` OK, 1500 capturas exactas y
   el id de la última (`00017n`) presente en el objeto parseado.
2. **`--all --json`** — ídem sobre la traza completa, con `open` = 1200 y el `dest` de la última
   cerrada íntegro (`.planning/todos/TODO-00017n.md`).
3. **Carril human** — la salida sin `--json` también supera 65536 bytes y contiene la última fila.
4. **Exit codes** — sobre el mismo fixture: id inexistente → 2, `route` válido → 0 con la
   confirmación terminada en su newline, re-cerrar → 2.

### Task 3 — WR-05: la idea con guion inicial

`src/cli.js` amplía la descripción del argumento de texto de `kodo capture` para declarar la forma
segura. `test/inbox-cli.test.js` añade el caso positivo (con `--`, exit 0, texto verbatim
comprobado por `parseLine`) y el caso que fija la **limitación conocida** (sin `--`, exit distinto
de 0, `unknown option` en stderr y el inbox ni siquiera creado).

## Evidencia decisiva — la regresión muerde

Revirtiendo a mano los ocho puntos de terminación en `src/cli.js` y volviendo a ejecutar la suite
del fichero:

| Estado de `src/cli.js` | Resultado de `node --test test/inbox-cli.test.js` |
|------------------------|----------------------------------------------------|
| **Con el arreglo** | 67 pass · 0 fail |
| **Arreglo REVERTIDO a mano** | 62 pass · **3 fail** |

Los tres fallos son exactamente los casos de tamaño, con el mensaje que los delata:

```
not ok - --json: la salida canalizada parsea ENTERA y trae las N capturas, con la ÚLTIMA presente
  error: 'la salida canalizada se cortó en 65536 bytes — el truncado de la pipe está en 65536'
not ok - --all --json: la traza completa tampoco se corta y el dest de la última cerrada llega íntegro
  error: 'la traza canalizada se cortó en 65536 bytes — el truncado de la pipe está en 65536'
not ok - el carril HUMAN canalizado tampoco se corta (un paginador es el mismo camino asíncrono)
  error: 'el render human se cortó en 65536 bytes — el truncado de la pipe está en 65536'
```

`git checkout -- src/cli.js` restauró el arreglo y la suite volvió a 67/67 sin residuo (`git status
--short src/cli.js` vacío antes de continuar).

Repro directo con el binario, fuera de la suite:

```
bytes fichero: 196890          # 1500 capturas sembradas
bytes stdout:  256930          # kodo inbox --json | <consumidor>
OK parse, captures: 1500 ultima: 00015n
```

Antes del arreglo ese mismo carril entregaba 65536 bytes y `JSON.parse` fallaba con «Unterminated
string in JSON at position 65536».

## Deviations from Plan

None — el plan se ejecutó exactamente como estaba escrito. Los tres criterios de aceptación
numéricos (`0` terminaciones inmediatas en la región, `8` asignaciones al código de salida, `> 0`
usos en el resto del fichero) salieron a la primera, y los tres gates de grep del test
(`seedLargeInbox` ≥ 4 → 5 · `65536` ≥ 3 → 9 · `'--'` ≥ 1 → 1) también.

Nota de forma, sin impacto: los criterios de aceptación usan `grep -v '^\s*//'`. Se comprobó que
`\s` funciona en el `grep` de esta máquina, así que el criterio literal del plan es ejecutable tal
cual; durante la ejecución se usó también la forma portable `[[:space:]]` y ambas dan el mismo
resultado.

## Diferidos con razón explícita

- **El mismo defecto en el resto de comandos de `src/cli.js`** (`polling status --json`, `skill sync
  --json`, `gsd doctor --json`, etc.): diferido por decisión del plan. Todos emiten payloads
  acotados muy por debajo de 64 KB; cambiarlos ampliaría el radio de explosión de un cierre de gaps
  a media superficie CLI. **Deuda registrada para un barrido propio.**
- **Interceptar el error de opción desconocida de commander (WR-05 en su forma completa):**
  diferido. Requiere tocar el manejo global de errores del parser. La forma con separador ya
  funciona, es la que Phase 84 emitirá por contrato, y ahora está documentada en la ayuda y fijada
  por dos tests.

## Interfaces para los siguientes planes

- **Superficie CLI: sin cambios.** Ningún flag nuevo, ningún subcomando nuevo, ninguna aridad
  alterada. La única edición de texto visible es la descripción del argumento de `kodo capture`.
- **Para 83-07:** el `default` del `switch` de `runInboxMarkCli` sigue mapeando el `reason:
  'concurrent-write'` que introdujo 83-04 a exit 1; la copia dedicada para ese reason es trabajo de
  83-07, no de este plan. El mecanismo de terminación ya no interfiere: cualquier código que el
  handler retorne se preserva con la salida drenada.
- **Para Phase 84:** la skill de captura debe shellear con el separador de argumentos
  (`kodo capture --origin skill -- "<texto>"`) si el texto puede empezar por guion. La forma está
  ahora en la ayuda del propio comando y cubierta por test.

## Self-Check: PASSED

- `src/cli.js` — FOUND (936 líneas, 8 asignaciones a `process.exitCode` en la región del inbox)
- `test/inbox-cli.test.js` — FOUND (1269 líneas, > 1100 exigidas por el contrato de artefactos)
- Commit `e3ab94b` — FOUND (Task 1)
- Commit `2251517` — FOUND (Task 2)
- Commit `b70f423` — FOUND (Task 3)
- `npm test` — 2538 tests, 0 fail
