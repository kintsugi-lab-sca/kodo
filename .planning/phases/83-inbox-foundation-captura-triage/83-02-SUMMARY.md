---
phase: 83-inbox-foundation-captura-triage
plan: 02
subsystem: cli
tags: [inbox, capture, commander, thin-handler, exit-codes, json-determinism, source-hygiene, terminal-injection]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 01)
    provides: "`src/inbox/store.js` — codec, parser, `listCaptures`, `appendCapture` y `markCapture` con sus cuatro `reason`"
  - phase: 78-saneo-keystroke
    provides: "`stripForKeystroke` (carril de escritura) y `stripControlChars` (carril de render) en `src/cli/format.js`"
  - phase: 56-resolve-project-id
    provides: "`resolveProjectId` never-throws, consumido a través de `deriveTag` del store"
  - phase: 14-color-isolation
    provides: "`createFormatter` como única puerta al color (D-07) y `test/format-isolation.test.js` como blindaje"
provides:
  - "`src/cli/capture.js`: thin handler de `kodo capture` con gate de texto vacío y `--origin` inyectable"
  - "`src/cli/inbox.js`: listado human/JSON never-throws y marcado con los exit codes de D-13"
  - "Superficie CLI LOCKED cableada: `kodo capture [--origin]` · `kodo inbox [--all|--json]` · `kodo inbox route <id> [--dest]` · `kodo inbox discard <id>`"
  - "Contrato de exit codes fijado por test de proceso real: 0 ok · 1 fs/lock-timeout · 2 id inexistente / ya cerrada / texto vacío"
  - "Gate source-hygiene del seam documental (CAPT-04) anclado al PATRÓN DE IMPORT, no al nombre suelto"
  - "Gate cero-deps: `dependencies` pinado a exactamente 4 claves"
affects: [83-03-concurrencia-y-seam, 84-superficies-de-captura, CAPT-02, CAPT-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Comando padre de commander con ACCIÓN PROPIA además de subcomandos — primera vez en este repo (verificado sobre commander 13.1.0)"
    - "Rama `--json` separada ANTES de instanciar el formatter: la ausencia de ANSI es por construcción, no por convención"
    - "Saneo en el carril de RENDER además del de escritura, porque el fichero es human-editable por diseño"
    - "Gate source-hygiene anclado al patrón de import: la documentación en prosa de la regla no puede poner roja la suite"

key-files:
  created:
    - "src/cli/capture.js"
    - "src/cli/inbox.js"
    - "test/inbox-cli.test.js"
  modified:
    - "src/cli.js"

key-decisions:
  - "83-02: el payload de `--json` fija sus claves en el orden `open` · `unparsed` · `captures`, y cada captura en `id,text,tag,date,origin,open` (+ `estado,dest` solo con `--all`) — orden verificado por `deepEqual` sobre `Object.keys`, no por inspección"
  - "83-02: el carril `--json` emite el texto VERBATIM (sin `stripControlChars`): `JSON.stringify` ya escapa todo byte C0 a `\\uXXXX` dejándolo inerte, y sanear el carril máquina sería mutación silenciosa de datos para el consumidor scriptable"
  - "83-02: el listado nunca sale con código distinto de 0, ni siquiera si el render lanza — el try/catch envuelve el cuerpo entero y degrada a un aviso por stderr (D-18 de extremo a extremo)"
  - "83-02: las filas del listado NO se numeran — el handle que el operador copia es el id corto; un número de fila no es estable entre invocaciones porque el filtro por defecto cambia con cada cierre"
  - "83-02: el `id` de argv se sanea con `stripControlChars` SOLO para pintarlo en los mensajes; el matcheo contra la línea va verbatim"

patterns-established:
  - "Sanity check del propio gate: el test del seam verifica que su regex SÍ detecta un import real y que NO detecta un comentario — sin eso, un regex roto pasaría trivialmente"
  - "Prueba de que un assert negativo es significativo: se verifica que `FORCE_COLOR` sí colorea el carril human antes de afirmar que no contamina el carril `--json`"

requirements-completed: [CAPT-01, CAPT-03, CAPT-04, CAPT-06]

coverage:
  - id: D1
    description: "`kodo capture \"idea\"` sobre un HOME limpio crea `~/.kodo/inbox.md` sin cabecera, appendea una línea y sale 0"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#primer run sobre un HOME limpio: crea el fichero SIN cabecera y sale 0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Texto vacío o solo whitespace tras el saneo → exit 2 y NI SIQUIERA se crea el fichero (contrato 4, Pitfall 8)"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#texto vacío y solo whitespace → exit 2 y NI SIQUIERA se crea el fichero"
        status: pass
      - kind: unit
        ref: "test/inbox-cli.test.js#runCaptureCli — gate de texto vacío (contrato 4, Pitfall 8)"
        status: pass
    human_judgment: false
  - id: D3
    description: "`--origin skill` produce una línea byte-idéntica salvo el campo de origen — el contrato que Phase 84 consume (D-16/CAPT-02)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#`--origin skill` produce una línea IDÉNTICA salvo el campo de origen"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#--origin skill fija el último campo estructurado (D-16 — el contrato de Phase 84)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El tag se deriva del cwd por nearest-ancestor y cae a basename(cwd) sin match ni ante match ambiguo (D-15)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#el tag sale de deriveTag(cwd, projects) — sin match cae a basename(cwd) (D-15)"
        status: pass
    human_judgment: false
  - id: D5
    description: "`kodo inbox` lista solo las abiertas; `--all` incluye las cerradas con su estado, y el hand-edit sin sufijo como cierre desconocido"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#runInboxListCli — filtrado abiertas / --all (CAPT-03, D-12)"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#route --dest: cierra con trace pointer, conserva la línea y desaparece del listado"
        status: pass
    human_judgment: false
  - id: D6
    description: "`kodo inbox --json` es una sola línea parseable, sin ANSI (ni con FORCE_COLOR) y byte-idéntica entre ejecuciones (DX-06)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#--json: UNA línea parseable, sin ANSI y byte-idéntica entre dos ejecuciones (DX-06)"
        status: pass
      - kind: unit
        ref: "test/inbox-cli.test.js#la rama --json NUNCA instancia el formatter (sin ANSI por construcción)"
        status: pass
    human_judgment: false
  - id: D7
    description: "Inbox inexistente o sin abiertas → exit 0 con copys distinguidas; un listFn que lanza tampoco rompe el never-throws (D-18)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#runInboxListCli — never-throws y copy de vacío (D-18)"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#sobre un HOME limpio sale 0 con la copy de inbox vacío (never-throws, D-18)"
        status: pass
    human_judgment: false
  - id: D8
    description: "El render human neutraliza las secuencias de escape provenientes de líneas hand-pegadas (T-83-09, Pitfall 6)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#una secuencia de escape hand-pegada NO llega al terminal del operador"
        status: pass
    human_judgment: false
  - id: D9
    description: "`route <id>` marca enrutada, con `--dest` añade el trace pointer y sin él cierra igual y sale 0 (CAPT-06, D-10)"
    requirement: CAPT-06
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#route SIN --dest sale 0 y cierra sin destino (best-effort, CAPT-06)"
        status: pass
    human_judgment: false
  - id: D10
    description: "`discard <id>` marca descartada SIN borrar la línea (CAPT-03: la traza permanente es el feature)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#discard sale 0 y la línea SIGUE en el fichero con su sufijo"
        status: pass
    human_judgment: false
  - id: D11
    description: "Los cuatro reasons del store mapean a los exit codes de D-13; id inexistente y ya-cerrada dejan el fichero byte-idéntico (sha256 antes/después)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#runInboxMarkCli — mapeo de reasons a exit codes (D-13, contrato 3)"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#id inexistente y captura ya cerrada → exit 2, con el fichero BYTE-IDÉNTICO"
        status: pass
    human_judgment: false
  - id: D12
    description: "Ningún módulo del inbox importa el módulo de procesos hijo de Node — el seam de enrutado es documental (CAPT-04/D-09)"
    requirement: CAPT-04
    verification:
      - kind: source-hygiene
        ref: "test/inbox-cli.test.js#Gate CAPT-04 / D-09 — el seam de enrutado es DOCUMENTAL"
        status: pass
    human_judgment: false
  - id: D13
    description: "La superficie diferida no se adelanta: ni `capture` ni `inbox` ni sus subcomandos exponen `--project` o `--open` (D-14/D-17)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-cli.test.js#CLI — superficie LOCKED: nada de más, nada de menos (D-12, D-14, D-17)"
        status: pass
    human_judgment: false
  - id: D14
    description: "Invariante cross-milestone de cero dependencias npm nuevas"
    requirement: CAPT-04
    verification:
      - kind: source-hygiene
        ref: "test/inbox-cli.test.js#package.json declara EXACTAMENTE 4 dependencias de producción"
        status: pass
    human_judgment: false

# Metrics
duration: 15min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 02: Superficie CLI del inbox — capture, listado y triage Summary

**`kodo capture` y `kodo inbox` (con `route`/`discard`) cableados como thin handlers sobre `src/inbox/store.js`: gate de texto vacío en exit 2, `--json` byte-determinista que jamás toca el formatter, render human que neutraliza escapes hand-pegados, y los cuatro `reason` del store mapeados a los exit codes de D-13 — con los dos gates source-hygiene de la fase anclados al patrón de import.**

## Performance

- **Duration:** 15 min
- **Tasks:** 3 (las 2 primeras en TDD RED → GREEN)
- **Files modified:** 3 creados (142 + 266 + 1066 = 1474 líneas) + 1 modificado (`src/cli.js`, +80 líneas)
- **Tests:** +61 (2455 → 2516 en `npm test`, 0 fallos)

## Accomplishments

- **Las ocho invocaciones de la tabla LOCKED funcionan de extremo a extremo**, cada una con su exit code verificado por proceso real (`spawnSync` de `bin/kodo` con HOME sandbox). El contrato de D-13 deja de ser una tabla en un documento y pasa a ser una aserción: `0` ok · `1` fs/lock-timeout · `2` id inexistente, ya cerrada o texto vacío tras el saneo.
- **`--json` es determinista POR CONSTRUCCIÓN, no por convención.** La rama se separa antes de instanciar el formatter, y el test lo demuestra de dos formas complementarias: inyectando un `formatterFn` que LANZA (si la rama lo tocara, el test moriría) y ejecutando el binario real con `FORCE_COLOR=1` — que sí colorea el carril human, verificado a mano, y deja el JSON limpio.
- **El render human cierra T-83-09.** El texto, el tag y el destino pasan por `stripControlChars` antes de pintarse: una línea con OSC-52 pegada a mano en el fichero no escribe en el portapapeles del operador al hacer `kodo inbox`. El saneo del carril de escritura no bastaba porque `~/.kodo/inbox.md` es human-editable por diseño.
- **El seam documental de CAPT-04 tiene un gate que además se auto-verifica.** El regex está anclado al patrón de import (principio de línea, o llamada a `require`/`import()`) y el propio test comprueba que SÍ detecta `import { spawnSync } from 'node:child_process'` y que NO detecta un comentario que mencione el módulo. Sin ese sanity check, un regex roto pasaría trivialmente y el gate sería decorativo.
- **Cero superficie adelantada.** Tres invocaciones de `--help` (`inbox`, `inbox route`, `inbox discard`) verifican que no existe `--project` ni `--open`, y una cuarta que `capture` no expone `--project`. D-14 y D-17 son ejecutables, no notas.
- **La preservación byte a byte del store sobrevive al carril CLI.** Un fichero sembrado con heading + captura + nota a mano: `kodo inbox` lista solo la captura, informa de las 2 líneas omitidas y conservadas, y tras un `route` las otras dos líneas siguen byte a byte idénticas.

## Task Commits

1. **Task 1: `src/cli/capture.js` — thin handler de la captura** (TDD)
   - `637006b` (test) — 17 unidades RED por DI: gate, forma de la línea, `--origin`, mapeo de errores
   - `cbf4470` (feat) — handler con gate de texto vacío, DI de id/reloj/cwd/paths y warn no duplicado
2. **Task 2: `src/cli/inbox.js` — listado human/JSON y route/discard** (TDD)
   - `b9a1ddd` (test) — 24 unidades RED: filtrado, never-throws, saneo de render, orden de claves JSON, los cuatro reasons
   - `88a0a0f` (feat) — listado never-throws, rama `--json` pre-formatter, render saneado y mapeo D-13
3. **Task 3: Registro en `src/cli.js` y suite de integración**
   - `d1bd975` (feat) — comando `capture`, grupo `inbox` con acción propia + subcomandos, y 20 casos de proceso real + 2 gates source-hygiene

## Files Created/Modified

- `src/cli/capture.js` (142 líneas, nuevo) — `runCaptureCli(opts, deps)`. 9 deps inyectables, todas con default en el cuerpo. Gate → identidad → `encodeLine` → `appendCapture` → exit code.
- `src/cli/inbox.js` (266 líneas, nuevo) — `runInboxListCli(opts, deps)` y `runInboxMarkCli(id, estado, opts, deps)`, más las privadas `renderHuman` y `estadoLabel`. La cabecera documenta el flujo de tres pasos del seam SIN nombrar ningún módulo importable.
- `test/inbox-cli.test.js` (1066 líneas, nuevo) — 61 tests en tres carriles: 41 unidades por DI (sin proceso, sin tocar `HOME`), 18 de integración con sandbox por test, y 2 gates source-hygiene.
- `src/cli.js` (+80 líneas) — bloques `capture` e `inbox` al final del área de registro, con import perezoso en cada `.action()`.

## Decisions Made

Las decisiones de contrato que este plan implementaba quedan cerradas:

| # | Decisión | Dónde se prueba |
|---|----------|-----------------|
| 2 | `- [x]` hand-editado sin sufijo → `already-closed` (exit 2) y `--all` lo muestra como cierre desconocido | «hand-edit `- [x]` SIN sufijo → route sale 2 y la línea no cambia» (sha256 igual) + «una cerrada con estado null se muestra como cierre DESCONOCIDO» |
| 3 | El marcado no hace fail-open: `lock-timeout`/`fs` → 1; `not-found`/`already-closed` → 2 | «runInboxMarkCli — mapeo de reasons a exit codes» (4 casos + excepción) |
| 4 | Texto vacío tras el saneo → exit 2 y cero escritura | Gate unit (4 vectores, incluidos escapes literales y U+2028/U+2029) + integration (el fichero ni se crea) |
| 6 | Un solo warn en el fail-open de la captura | «fail-open → exit 0 y CERO mensaje extra»: `errFn` recibe la cadena vacía |
| 7 | Los paths salen de `defaultInboxPaths()` invocado en el call-site del handler | Los tests unit inyectan `pathsFn` y assertan que el store recibe exactamente esos paths |

Decisiones menores tomadas durante la ejecución, dentro de la Claude's Discretion del plan:

- **El carril `--json` emite el texto VERBATIM, sin `stripControlChars`.** El plan solo manda sanear el render human, y el registro de amenazas acota T-83-09 a ese carril. Razón técnica que lo hace seguro: `JSON.stringify` escapa todo byte de control C0 —incluido `\u001b`— a su forma `\uXXXX` de 6 chars imprimibles, así que la salida es inerte por construcción (verificado por el assert de ausencia de ESC). Sanear además el carril máquina sería mutación silenciosa de los datos para el consumidor scriptable.
- **El never-throws del listado es de cuerpo entero, no solo del render.** El plan indicaba que `listCaptures` nunca lanza y que bastaba envolver el render; el `try/catch` envuelve todo el cuerpo y degrada cualquier fallo a un aviso por stderr con exit 0. Cubre también el caso en que un futuro `listFn` inyectado sí lance, y hay un test explícito para ello.
- **El `id` recibido por argv se sanea para el render de los mensajes de error.** No estaba pedido, pero un id con OSC pegado en la invocación se pintaba tal cual en el stderr de `not found`. El matcheo contra la línea sigue siendo verbatim: solo cambia lo que llega al terminal.
- **Las filas del listado no se numeran** (el plan lo pedía explícitamente) y la copy de vacío distingue dos casos: «el inbox está vacío» y «no hay abiertas, usa `--all`». Ambos tienen su test.

## Deviations from Plan

Ninguna deviación de alcance. Un único ajuste, dentro del trabajo de la propia tarea:

### Auto-fixed Issues

**1. [Rule 2 - Missing correctness] `text` ausente capturaba la cadena literal `undefined`**
- **Found during:** Task 1 (handler de la captura)
- **Issue:** `stripForKeystroke` coacciona con `String(s)` (verificado en RESEARCH §Pitfall 8: `null` → `'null'`, `42` → `'42'`). Un `opts.text` ausente o no-string habría atravesado el gate de texto vacío y persistido una captura con el texto `undefined`. El plan describía el gate sobre el resultado del saneo, sin cubrir la coacción previa.
- **Fix:** Normalización explícita antes del saneo: `typeof opts.text === 'string' ? opts.text : ''`. Con ello el gate lo atrapa y devuelve 2.
- **Files modified:** `src/cli/capture.js`
- **Verification:** Test dedicado «`text` ausente (no string) NO captura la cadena "undefined"» — exit 2 y `appendFn` no invocado.
- **Committed in:** `cbf4470` (commit de Task 1)

---

**Total deviations:** 1 auto-fixed (Rule 2)
**Impact on plan:** Ninguno sobre el alcance. Cero superficie nueva, cero deps.

## Issues Encountered

- **Caracteres de control literales en el source del test.** Los vectores de inyección (OSC-52, CSI, U+2028/U+2029) y las clases de carácter de los asserts entraron LITERALES en el fichero al escribirlo. Es el mismo problema de higiene que mordió en 83-01. Resuelto con una pasada de conversión a notación de escape y un escaneo que verifica **cero** literales de control en los cuatro artefactos (`capture.js`, `inbox.js`, `cli.js`, `inbox-cli.test.js`).
- **Un criterio de aceptación por grep se dispara con la documentación, no con el código.** El criterio pedía que `grep -n "ensureConfig" src/cli.js` no mostrara llamadas dentro de los bloques nuevos; los bloques contienen 2 apariciones, ambas dentro del comentario `// NOTE: NO ensureConfig() — …` que es literalmente el molde de los bloques `gsd doctor`, `sidebar doctor` y `skill sync` ya existentes. Verificado con un grep anclado a la llamada (`^\s*(await )?ensureConfig\(\)`): **0 coincidencias**. Se deja registrado para que el verificador no lo lea como un fallo. Es la misma clase de problema que la deviación 2 de 83-01, y la razón por la que el gate de CAPT-04 de este plan se ancló al patrón de import desde el principio.

## Threat Flags

Ninguna superficie de seguridad nueva fuera del `<threat_model>` del plan. Las 4 amenazas con disposición `mitigate` quedan implementadas y con aserción:

| Threat | Mitigación implementada |
|--------|-------------------------|
| T-83-09 | `stripControlChars` sobre texto/tag/dest en `renderHuman` + sobre el `id` de argv en los mensajes de error; test con OSC-52 y CSI que assertan cero bytes de control en la salida |
| T-83-10 | El `<id>` solo matchea una línea en memoria; ningún path se compone a partir de él (los paths salen de `defaultInboxPaths()`), documentado en el código |
| T-83-11 | `--dest` se pasa TAL CUAL al store, que lo sanea y recorta; el handler no lo valida, no lo resuelve y no lo interpreta. Test de `--dest` sobre la cota que no falla |
| T-83-12 | Gate source-hygiene sobre los 3 módulos del inbox, anclado al patrón de import y con sanity check del propio regex |
| T-83-SC | Cero instalaciones; `dependencies` pinado a 4 claves con mensaje de fallo que nombra el invariante cross-milestone |

## User Setup Required

None — no external service configuration required. `~/.kodo/inbox.md` se crea en el primer `kodo capture`.

## Next Phase Readiness

- **Plan 83-03 desbloqueado:** la superficie CLI existe y es estable, así que el test de concurrencia mixto puede shellear `kodo capture` como escritor real contra un `markCapture` en curso usando el seam `_afterReadFn` de 83-01.
- **Phase 84 tiene su writer único:** `kodo capture "<texto>" --origin skill` produce una línea byte-idéntica a la del carril `cli` salvo el campo de origen, verificado por aserción. El skill no tiene que duplicar el writer ni conocer el formato.
- **Sin blockers.** `npm test` completa en verde (2516 tests, 0 fallos, 1 skip pre-existente ajeno a esta fase), `git diff --stat package.json package-lock.json` sale vacío y el `~/.kodo/inbox.md` real del operador sigue sin existir tras correr la suite completa (aislamiento de HOME verificado).

---
*Phase: 83-inbox-foundation-captura-triage*
*Completed: 2026-07-25*

## Self-Check: PASSED

Verificado contra disco y git tras escribir este SUMMARY:

- **Ficheros creados:** `src/cli/capture.js`, `src/cli/inbox.js`, `test/inbox-cli.test.js` — los 3 existen. `src/cli.js` modificado.
- **Commits:** `637006b`, `cbf4470`, `b9a1ddd`, `88a0a0f`, `d1bd975` — los 5 existen en el historial.
- **`min_lines` del plan:** capture.js 142 (min 70) · inbox.js 266 (min 110) · inbox-cli.test.js 1066 (min 150) — los 3 cumplen. `src/cli.js` contiene `kodo capture`.
- **`key_links` del plan:** capture→store (`appendCapture|encodeLine`: 8) · inbox→store (`listCaptures|markCapture`: 7) · inbox→format (`createFormatter|stripControlChars`: 10) · cli.js→handlers (`await import('./cli/(capture|inbox).js')`: 4) — los 4 cableados.
- **Verificación del plan:** `node --test test/inbox-cli.test.js` 61/61 · `node --test test/format-isolation.test.js` 8/8 · `npm test` 2516 tests, 0 fallos · `node bin/kodo inbox --help` exit 0 listando `route` y `discard` · `git diff --stat package.json package-lock.json` vacío.
- **Gates de superficie:** `--project`/`--open` ausentes de los 4 helps verificados; `process.exit` ausente de ambos handlers; `picocolors` y `node:child_process` ausentes de los 3 módulos del inbox.
- **Higiene:** cero caracteres de control literales en los 4 artefactos y en este SUMMARY.

## TDD Gate Compliance

Las 2 tareas con `tdd="true"` cumplen la secuencia de gates, verificable en `git log`:

| Tarea | RED (`test:`) | GREEN (`feat:`) | REFACTOR |
|-------|---------------|-----------------|----------|
| 1 · `src/cli/capture.js` | `637006b` | `cbf4470` | no necesario |
| 2 · `src/cli/inbox.js` | `b9a1ddd` | `88a0a0f` | no necesario |

Ningún test pasó inesperadamente en fase RED: ambos fallaron por la razón correcta (`ERR_MODULE_NOT_FOUND` del módulo aún inexistente), verificado antes de cada commit de test. La Task 3 no llevaba `tdd="true"` (es cableado + suite de integración) y fue a commit único.
