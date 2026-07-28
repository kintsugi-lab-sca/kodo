---
phase: 83-inbox-foundation-captura-triage
plan: 01
subsystem: infra
tags: [inbox, capture, file-lock, o-append, atomic-rename, markdown-codec, regex-parser, node-crypto]

# Dependency graph
requires:
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: "`withFileLock`/`acquireLock` con el steal-guard atómico — la primitiva de coordinación de D-01"
  - phase: 78-saneo-keystroke
    provides: "`stripForKeystroke` en `src/cli/format.js` — el saneo a una línea que exige CAPT-01"
  - phase: 56-resolve-project-id
    provides: "`resolveProjectId` never-throws (nearest-ancestor sobre projects.json) — la derivación del tag de D-15"
  - phase: 74-handoff-wr-02
    provides: "El template unique-tmp + rename de `session-end.js:374` — el mecanismo de publicación de D-04"
provides:
  - "`src/inbox/store.js`: codec, parser anclado a cola, reader never-throws, append O_APPEND y marcado RMW"
  - "Formato de línea del inbox fijado BYTE A BYTE en un golden (contrato inter-fase de D-22)"
  - "`appendCapture` con fail-open documentado y warn único (D-02/D-03)"
  - "`markCapture` con preservación byte a byte de toda línea ajena y publicación unique-tmp + rename (D-01/D-04)"
  - "Seam `_afterReadFn` para ensanchar la ventana lectura→rename de forma determinista (D-21.2)"
affects: [83-02-cli-capture-inbox, 83-03-concurrencia-y-seam, 84-superficies-de-captura, CAPT-02, CAPT-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Módulo de lógica pura con DI de paths obligatoria (`{inboxPath, lockPath}`) — el default es un resolvedor PEREZOSO, no una constante de módulo"
    - "Parseo anclado a la COLA con la fecha como ancla desambiguadora — el texto de usuario es libre y no puede falsificar los campos estructurados"
    - "Saneo en tres carriles diferenciados: texto (verbatim salvo bordes), campos estructurados (sin separador) y dest (cota, separador permitido)"
    - "Fail-open asimétrico: la captura appendea ante lock-timeout, el marcado NO reescribe"

key-files:
  created:
    - "src/inbox/store.js"
    - "test/inbox-store.test.js"
    - "test/inbox-format-golden.test.js"
  modified: []

key-decisions:
  - "83-01: el marcado publica con tmp de nombre ÚNICO (<path>.tmp.<pid>.<randomUUID>) + renameSync; `writeFileAtomic` de src/config.js queda inalcanzable POR CONSTRUCCIÓN (store.js no importa config.js) — STATE.md:100"
  - "83-01: `- [x]` hand-editado sin sufijo de estado se lee como cerrada con cierre desconocido; route/discard sobre ella devuelven already-closed y NO la reescriben"
  - "83-01: el marcado NO hace fail-open ante lock-timeout (asimetría deliberada frente a D-03) — un marcado sin coordinación reintroduce el lost-update que D-01 cierra"
  - "83-01: sin reintento ante colisión de ID corto (~0,023 % a 1000 capturas); markCapture marca la PRIMERA línea que casa"
  - "83-01: exactamente UN warn en el fail-open — se inyecta `{logger:{warn:()=>{}}}` en withFileLock para silenciar su console.warn"
  - "83-01: los paths del inbox viven en src/inbox/store.js como resolvedor perezoso `defaultInboxPaths()`, nunca como constante de módulo (la fuga de HOME de config.js:11 contamina los tests)"

patterns-established:
  - "Golden byte-exacto como contrato inter-fase: el fichero declara en cabecera qué fase lo consume y qué rompe cambiarlo"
  - "Sanitizador de campos estructurados que elimina el separador por construcción — un campo estructurado NUNCA puede romper el parser"
  - "Seam `_afterReadFn` inyectado: ensancha una ventana de carrera de forma determinista sin código de test en producción"

requirements-completed: [CAPT-01, CAPT-03, CAPT-06]

coverage:
  - id: D1
    description: "Codec `encodeLine` byte-exacto para las cinco formas de línea (abierta, enrutada+dest, enrutada, descartada, hand-edit) — contrato que Phase 84 consume"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-format-golden.test.js#D-22 golden — las cinco formas de la línea del inbox (contrato Phase 84)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Parser anclado a la cola: un texto de usuario que imita la cola no falsifica tag/fecha/origen (2 forgeries en la tabla de 15 vectores)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#parseLine — tabla de 15 vectores (83-RESEARCH §Code Examples)"
        status: pass
    human_judgment: false
  - id: D3
    description: "El texto escrito nunca contiene un salto de línea interior: CR/LF/TAB reales y literales colapsados, U+2028/U+2029 neutralizados, cota MAX_TEXT_LEN"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#encodeLine — saneo del carril de escritura (CAPT-01)"
        status: pass
    human_judgment: false
  - id: D4
    description: "`listCaptures` nunca lanza (ENOENT/EISDIR/EACCES → listado vacío), excluye la línea que no parsea del listado y NO la toca en disco"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#listCaptures — never-throws (D-18)"
        status: pass
    human_judgment: false
  - id: D5
    description: "`appendCapture` escribe con appendFileSync (O_APPEND) en una única llamada, crea el fichero on-demand sin cabecera y antepone newline si el último byte no lo es"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#appendCapture — O_APPEND y creación on-demand (D-02, D-19)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Fail-open ante lock-timeout: la captura se appendea igual, `coordinated:false` y EXACTAMENTE un warn accionable; el console.warn de la primitiva queda silenciado"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#appendCapture — fail-open ante lock-timeout (D-03, contrato 6)"
        status: pass
    human_judgment: false
  - id: D7
    description: "`markCapture` cierra sin borrar: la captura sigue en el fichero con id/texto/tag/fecha/origen intactos; `route` sin `--dest` cierra igualmente y devuelve ok"
    requirement: CAPT-06
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — cierre de una captura (CAPT-03, CAPT-06, D-10)"
        status: pass
    human_judgment: false
  - id: D8
    description: "Preservación BYTE A BYTE: sobre un fixture de 6 líneas (con y sin newline final) el marcado cambia exactamente UNA línea; la vacía, la no-parseable y el terminador sobreviven"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — preservación BYTE A BYTE de toda línea ajena (D-04, el invariante)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Rutas de fallo sin reescritura, verificadas por sha256 antes/después: not-found, already-closed (con sufijo y hand-edit sin sufijo), fichero inexistente, lock-timeout sin fail-open, cero residuo de tmp"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — rutas de fallo, todas sin reescribir el fichero"
        status: pass
    human_judgment: false
  - id: D10
    description: "Seam `_afterReadFn` invocado exactamente una vez, dentro del lock, tras la lectura fresca y antes del rename — la palanca del test de concurrencia mixto de 83-03"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#markCapture — seam `_afterReadFn` (D-21.2)"
        status: pass
    human_judgment: false

# Metrics
duration: 41min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 01: Inbox store — codec, parser, append y marcado Summary

**Núcleo del inbox en `src/inbox/store.js`: codec markdown byte-exacto, parser anclado a la cola resistente a forgeries, reader never-throws, append `O_APPEND` con fail-open y marcado RMW bajo `withFileLock` con publicación unique-tmp + rename que preserva byte a byte toda línea ajena.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-07-25T09:52:00Z
- **Completed:** 2026-07-25T10:33:00Z
- **Tasks:** 3 (todas TDD: RED → GREEN)
- **Files modified:** 3 creados (577 + 667 + 142 = 1386 líneas)

## Accomplishments

- **El contrato de línea queda fijado byte a byte.** `test/inbox-format-golden.test.js` congela las cinco formas de D-05 con id, tag, fecha y origen inyectados (cero entropía) y declara en cabecera que Phase 84 comparará contra ellas. El round-trip `parseLine(encodeLine(c))` se assert por forma.
- **El parser resiste la falsificación desde el texto (T-83-01).** El grupo del texto es greedy y la fecha `\d{4}-\d{2}-\d{2}` actúa de ancla desambiguadora: un texto que imite la cola queda dentro de `text`, verbatim, y ganan los campos estructurados reales. Los 2 forgeries de RESEARCH están en la tabla de 15 vectores. Complementario: el sanitizador de campos estructurados sustituye U+00B7 por guion, así que un tag/origen jamás puede romper el parser (T-83-04).
- **Concurrencia cerrada por construcción en las dos direcciones.** La captura appendea con un único `appendFileSync` (`O_APPEND`) bajo el mismo lock que el marcado (D-01/D-02); el marcado hace RMW con lectura fresca DENTRO del lock y publica con `<path>.tmp.<pid>.<randomUUID>` + `renameSync`, con `rmSync` en el catch (T-83-02/T-83-03).
- **La preservación byte a byte es un test, no una promesa.** Sobre un fixture de 6 líneas —heading, línea hand-written, línea vacía— en sus dos variantes de terminador, el marcado cambia exactamente UNA línea y conserva la presencia/ausencia del newline final. Las rutas de fallo se verifican con sha256 antes/después.
- **Cero acoplamiento a `src/config.js`**, verificado por grep: el escritor de tmp fijo prohibido por `STATE.md:100` es literalmente inalcanzable desde este módulo. Cero dependencias npm nuevas (`git diff --stat package.json package-lock.json` vacío).

## Task Commits

Cada tarea se ejecutó en TDD (RED → GREEN) con commits atómicos:

1. **Task 1: Codec, parser anclado a cola e identidad de una captura**
   - `736608f` (test) — golden RED de las cinco formas
   - `b747ab5` (feat) — `encodeLine`/`parseLine`/`newCaptureId`/`todayLocal`/`deriveTag`/`defaultInboxPaths`
2. **Task 2: Reader never-throws y append O_APPEND con fail-open**
   - `b8b1d97` (test) — unit RED de `listCaptures`/`appendCapture` + tabla de 15 vectores
   - `e504eb6` (feat) — reader never-throws, `appendLine` con newline defensivo, fail-open con warn único
3. **Task 3: markCapture — RMW bajo lock con unique-tmp + rename**
   - `b3fd2e2` (test) — unit RED de preservación byte a byte, rutas de fallo y seam
   - `555c687` (feat) — RMW bajo lock, localización por ID, publicación unique-tmp + rename

## Files Created/Modified

- `src/inbox/store.js` (577 líneas, nuevo) — 13 exports: codec (`encodeLine`, `parseLine`), identidad (`newCaptureId`, `todayLocal`, `deriveTag`, `defaultInboxPaths`), I/O (`listCaptures`, `appendCapture`, `markCapture`) y constantes (`INBOX_FILENAME`, `INBOX_LOCK_FILENAME`, `MAX_TEXT_LEN`, `MAX_DEST_LEN`) + `@typedef Capture`.
- `test/inbox-format-golden.test.js` (142 líneas, nuevo) — golden de D-22: 5 formas byte-exactas + round-trip + los 4 ejemplos literales de `83-CONTEXT.md`.
- `test/inbox-store.test.js` (667 líneas, nuevo) — 84 aserciones sobre codec, parser (15 vectores), saneo, identidad, reader, append y marcado. DI de paths a un sandbox `mkdtempSync`: no toca `HOME` en ningún punto (T-83-05).

## Decisions Made

Las **siete decisiones de contrato** de la cabecera del plan quedan implementadas, cada una con al menos una aserción:

| # | Decisión | Dónde se prueba |
|---|----------|-----------------|
| 1 | Publicación con tmp ÚNICO + rename; `writeFileAtomic` inalcanzable | `grep` de `randomUUID`/`renameSync` + ausencia de import de `config.js`; test de cero residuo tras 10 llamadas |
| 2 | `- [x]` sin sufijo → cerrada con cierre desconocido; `already-closed` sin reescribir | «hand-edit `- [x]` SIN sufijo → already-closed y NO se reescribe» (sha256 igual) |
| 3 | El marcado NO hace fail-open ante lock-timeout | «lock ocupado → lock-timeout y fichero INTACTO» |
| 4 | Texto vacío tras el saneo → exit 2 y cero escritura | Se decide en el gate del CLI (Plan 02); esta capa solo aporta el saneo (`sanitizeText` + `trim`) |
| 5 | Colisión de ID: sin reintento, gana la primera | «dos líneas con el MISMO id → se marca la primera» |
| 6 | Exactamente un warn en el fail-open | «EXACTAMENTE un warn accionable» + `consoleWarns === 0` |
| 7 | Paths del inbox perezosos, cero import de `config.js` | «defaultInboxPaths se resuelve PEREZOSAMENTE» + grep del import |

Decisiones menores tomadas durante la ejecución, dentro de la Claude's Discretion del plan:

- **`listCaptures` salta las líneas en blanco por `line.trim() === ''`, no solo las estrictamente vacías.** El plan pedía «saltar las líneas vacías sin contarlas»; una línea de solo espacios en un markdown hand-editado es semánticamente lo mismo y contarla como `unparsed` daría ruido al operador. La línea sigue preservada en disco: solo cambia si aparece en el contador.
- **Los errores de filesystem propagados por `acquireLock` (código distinto de EEXIST) se colapsan a `{ok:false, reason:'fs'}` y NO disparan el fail-open** en `appendCapture`. La primitiva se documenta como never-throws, pero su `writeFileSync` del lockfile propaga los errores que no son EEXIST; reintentar a ciegas ante un disco roto solo duplicaría el fallo. El fail-open queda reservado a su condición real: `{ok:false, reason:'lock-timeout'}`.
- **`encodeLine` no emite el trace pointer cuando el `dest` queda vacío tras el saneo** (además del caso `null`), para que `--dest "   "` no produzca una flecha huérfana al final de la línea.

## Deviations from Plan

Ninguna deviación de alcance. Dos ajustes menores, ambos dentro del propio trabajo de la tarea:

### Auto-fixed Issues

**1. [Rule 1 - Bug] El `afterEach` del fixture rompía el borrado del sandbox**
- **Found during:** Task 2 (reader never-throws y append)
- **Issue:** El `afterEach` restauraba permisos chmodeando a `0o600` **toda** entrada de primer nivel del sandbox, incluidos los DIRECTORIOS. Un directorio sin bit de ejecución no se puede recorrer, así que `rmSync` fallaba con `EACCES` en el test que crea `sub/dir/`. Fallo del fixture, no del código bajo prueba — pero enmascaraba el resultado del test.
- **Fix:** El restaurador ahora discrimina por `lstatSync` (`0o700` para directorios, `0o600` para ficheros) y recorre en profundidad.
- **Files modified:** `test/inbox-store.test.js`
- **Verification:** 68/68 en verde tras el fix; el test de EACCES sigue cubierto y el sandbox se borra limpio.
- **Committed in:** `e504eb6` (commit de Task 2)

**2. [Rule 3 - Blocking] Un comentario JSDoc tumbaba un gate de aceptación por grep**
- **Found during:** Task 3 (markCapture)
- **Issue:** El criterio `grep -nE "\.trim\(\)\.split|filter\(Boolean\)" src/inbox/store.js` debe devolver cero coincidencias. El JSDoc de `markCapture` explicaba la prohibición **citando literalmente** `filter(Boolean)`, así que el gate fallaba por la documentación de la propia regla que el código respeta.
- **Fix:** El comentario se reescribió en prosa («sin recorte previo del contenido y sin descartar las líneas vacías») conservando íntegro el razonamiento de D-04.
- **Files modified:** `src/inbox/store.js`
- **Verification:** El grep devuelve 0; el round-trip exacto `split('\n')`/`join('\n')` sigue verificado por los tests de preservación byte a byte.
- **Committed in:** `555c687` (commit de Task 3)

---

**Total deviations:** 2 auto-fixed (1 bug de fixture, 1 blocking de gate)
**Impact on plan:** Ninguno sobre el alcance. Ambos arreglos son de higiene del propio trabajo de la tarea; cero scope creep, cero superficie nueva.

## Issues Encountered

- **Caracteres invisibles literales en el source.** Al escribir los saneadores y los tests de U+2028/U+2029, los caracteres entraron LITERALES en el fichero en lugar de como escapes. Un `U+2028` literal dentro de una clase de regex es funcionalmente correcto pero ilegible en diff y dispara los detectores de inyección del pipeline (la propia `83-RESEARCH.md` lo advierte como nota de higiene). Resuelto convirtiendo todas las apariciones a notación de escape (`\u2028` / `\u2029`) y verificando con un escaneo que quedan **cero** literales en los tres ficheros.
- **Doble escape en la conversión.** El primer intento de conversión escribió `\\u2028` (dos backslashes), que en una regex significa «backslash literal seguido de u2028». Detectado porque el test de neutralización siguió pasando por la razón equivocada; corregido y re-verificado con el escaneo.

## Threat Flags

Ninguna superficie de seguridad nueva fuera del `<threat_model>` del plan. Las 5 amenazas con disposición `mitigate` quedan implementadas y con aserción:

| Threat | Mitigación implementada |
|--------|-------------------------|
| T-83-01 | Regex anclada a la cola + 2 forgeries en la tabla de vectores |
| T-83-02 | `withFileLock` compartido + lectura fresca dentro del lock (el escenario de carrera real lo ejercita 83-03) |
| T-83-03 | Tmp único `pid`+`randomUUID` + `rmSync` en el catch; test de cero residuo tras 10 llamadas mixtas |
| T-83-04 | Sanitizador de campos estructurados (U+00B7 → guion, colapso de whitespace) |
| T-83-05 | DI de paths obligatoria + `defaultInboxPaths()` perezoso; la suite no toca `HOME` |

## User Setup Required

None — no external service configuration required. El fichero `~/.kodo/inbox.md` se crea on-demand en el primer `kodo capture` (D-19), sin cabecera ni preámbulo.

## Next Phase Readiness

- **Plan 83-02 (wave 2) desbloqueado:** dispone de las firmas estables de `appendCapture`/`listCaptures`/`markCapture` y de los `reason` que debe mapear a los exit codes de D-13 (`0` ok · `1` fs · `2` not-found/already-closed). El gate de texto vacío tras el saneo (decisión de contrato 4) le corresponde a él.
- **Plan 83-03 desbloqueado:** el seam `_afterReadFn` está implementado y probado como palanca determinista para ensanchar la ventana lectura→rename del escenario mixto de D-21.2.
- **Phase 84 tiene su contrato fijado:** `test/inbox-format-golden.test.js` es la referencia byte a byte de CAPT-02 y el formato que el reader del conteo ambient (CAPT-07) consumirá.
- **Sin blockers.** `npm test` completa en verde (2455 tests, 0 fallos, 1 skip pre-existente ajeno a esta fase) y el invariante de cero deps npm se mantiene.

---
*Phase: 83-inbox-foundation-captura-triage*
*Completed: 2026-07-25*

## Self-Check: PASSED

Verificado contra disco y git tras escribir este SUMMARY:

- **Ficheros creados:** `src/inbox/store.js`, `test/inbox-store.test.js`, `test/inbox-format-golden.test.js` — los 3 existen.
- **Commits:** `736608f`, `b747ab5`, `b8b1d97`, `e504eb6`, `b3fd2e2`, `555c687` — los 6 existen en el historial.
- **`min_lines` del plan:** store.js 577 (min 200) · golden 142 (min 40) · unit 667 (min 150) — los 3 cumplen.
- **`key_links` del plan:** `withFileLock` (6 apariciones), `stripForKeystroke` (6), `resolveProjectId` (5), `randomBytes`/`randomUUID` (2/2) — los 4 enlaces cableados.
- **Verificación del plan:** `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` 84/84 · `node --test test/format-isolation.test.js` 8/8 · `npm test` 2455 tests, 0 fallos · `git diff --stat package.json package-lock.json` vacío.
- **Higiene:** cero caracteres invisibles literales en los 3 artefactos y en este SUMMARY.

## TDD Gate Compliance

Las 3 tareas llevaban `tdd="true"` y las 3 cumplen la secuencia de gates, verificable en `git log`:

| Tarea | RED (`test:`) | GREEN (`feat:`) | REFACTOR |
|-------|---------------|-----------------|----------|
| 1 · Codec y parser | `736608f` | `b747ab5` | no necesario |
| 2 · Reader y append | `b8b1d97` | `e504eb6` | no necesario |
| 3 · markCapture | `b3fd2e2` | `555c687` | no necesario |

Ningún test pasó inesperadamente en fase RED: los tres fallaron por la razón correcta (módulo o export ausente), verificado antes de cada commit de test.
