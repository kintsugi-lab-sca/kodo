---
phase: 83-inbox-foundation-captura-triage
plan: 07
subsystem: inbox
tags: [inbox, deriveTag, projects-json, uuid, saneo, c1-controls, json-lane, fail-open, seam, gap-closure, doc-drift]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 04)
    provides: "El `reason` `concurrent-write` de `markCapture` y el retorno del presupuesto de la captura al default (que vuelve alcanzable la rama fail-open)"
  - phase: 83-inbox-foundation-captura-triage (plan 05)
    provides: "Los cuatro handlers del inbox fijando `process.exitCode` — cualquier código que devuelva el handler de marcado se preserva con stdout drenado"
  - phase: 83-inbox-foundation-captura-triage (plan 02)
    provides: "`deriveTag`, el carril `--json` y los handlers `runCaptureCli` / `runInbox*Cli`"
provides:
  - "`deriveTag` proyecta un identificador de proveedor con forma de UUID al nombre del proyecto derivado de la ruta MAPEADA — el campo vuelve a comunicar algo en la instalación real (GAP-3 / CR-03)"
  - "Cobertura con la forma REAL de `projects.json` (claves UUID, valores `{default, modules}`), la que ningún fixture previo usaba"
  - "`sanitizeJsonField`: el carril de datos neutraliza DEL y el bloque C1, que `JSON.stringify` NO escapa (WR-02)"
  - "Rama propia del `reason` de escritura concurrente en el mapeo a copy y exit code: exit 1 reintentable, causa distinguible del lock ocupado (D-13)"
  - "El aviso del fail-open viaja por el seam inyectable del handler y está observado sobre el binario real (WR-08)"
  - "Documentación del orquestador sin la afirmación de solo-append, con el modo de fallo nuevo y la forma segura de capturar texto con guion inicial (IN-02, WR-05)"
affects: [84-superficies-de-captura, CAPT-01, CAPT-03, CAPT-04, CAPT-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proyección CONDICIONAL de un identificador opaco: solo se traduce cuando tiene la forma que lo delata (UUID canónico); un identificador ya legible se devuelve tal cual, así que ninguna configuración que funcionaba cambia"
    - "El fixture ES la prueba: un test que inventa la forma cómoda del dato reproduce el punto ciego en vez de cerrarlo — la forma real del fichero del operador es la aserción"
    - "Saneo por carril con alcance MEDIDO: el saneador del carril de datos es deliberadamente más estrecho que el del carril human (solo lo que el serializador deja pasar), así el byte-determinismo no se toca"
    - "Comprobación de mordida por revert manual antes de dar una tarea por hecha; y cuando un cambio NO puede morder en un carril, decirlo y añadir el carril donde sí muerde"

key-files:
  created: []
  modified:
    - "src/inbox/store.js"
    - "src/cli/inbox.js"
    - "src/cli/capture.js"
    - "test/inbox-store.test.js"
    - "test/inbox-cli.test.js"
    - "README.md"
    - ".claude/skills/kodo-orchestrate/skill.md"

key-decisions:
  - "83-07: la clave de `projects.json` es el identificador del PROVEEDOR, no un nombre; con forma de UUID el tag pasa a ser el último segmento de la ruta MAPEADA, y el nombre del directorio actual queda como ÚLTIMO recurso (Decisión B) — capturar desde un subdirectorio es lo normal y su basename informa peor"
  - "83-07: la proyección es CONDICIONAL (Decisión A). Un identificador ya legible se devuelve tal cual: el comportamiento previo es correcto para toda configuración con claves legibles y el cierre de un gap no reabre lo que ya funcionaba"
  - "83-07: `mappedProjectPath` NO recorre la tabla de módulos — el tag identifica el PROYECTO. Filtra todo candidato que no sea cadena no vacía, espejando `candidatesOf` de `resolveProjectId`, porque el fichero es operator-editable y el carril es never-throws"
  - "83-07 [REVIERTE contexto acumulado de 83-02]: la afirmación «el carril --json puede ir verbatim porque JSON.stringify escapa los bytes C0» es FALSA. El serializador escapa los C0 pero NO DEL ni el bloque C1, y ambos salían íntegros por el carril que la skill del orquestador manda usar"
  - "83-07: el saneo del carril de datos es más ESTRECHO que `stripControlChars` a propósito (Decisión C) — no re-escapa nada que el serializador ya cubra, no colapsa whitespace y no altera orden ni conjunto de claves: DX-06 intacto"
  - "83-07: `concurrent-write` gana rama propia con copy que nombra la causa real (un guard que aborta para no destruir una captura concurrente) y conserva el exit 1 reintentable; conflarlo con el lock ocupado dejaría al siguiente mantenedor buscando contención donde hay un guard funcionando"
  - "83-07 [desviación]: el test de integración del fail-open sobre el binario NO muerde — el default del store escribe al mismo `process.stderr` que el test lee. Se declara y se añade un unit que SÍ muerde sobre la propagación del seam, en vez de presentar un caso ciego como evidencia"

patterns-established:
  - "Un fixture que inventa la forma cómoda del dato de producción no cierra un punto ciego: lo reproduce. Cuando el defecto es 'la suite está verde y el binario falla', la forma real del fichero del operador ES la aserción que faltaba"
  - "Cuando un cambio no puede morder en el carril donde se probó, decirlo en el propio test y añadir el carril donde sí muerde — nunca dejar pasar un caso ciego como cobertura"
  - "Un modelo de amenaza cerrado en un solo carril de salida es un agujero por diseño: si dos carriles emiten el mismo contenido no confiable, o se sanean los dos o el que queda abierto es precisamente el que el consumidor automatizado usa"

requirements-completed: [CAPT-01, CAPT-03, CAPT-04, CAPT-06]

coverage:
  - id: D1
    description: "Con la forma REAL de `projects.json` (clave UUID de proveedor, valor `{default, modules}`), el tag de una captura es el nombre del proyecto derivado de la ruta mapeada, nunca la cadena de 36 caracteres (CAPT-01, D-15, GAP-3)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#deriveTag — forma REAL de projects.json: clave UUID de proveedor (GAP-3, D-15)"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#el tag persistido es el NOMBRE del proyecto, no el identificador de proveedor (GAP-3)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Un identificador de proyecto ya legible produce exactamente el mismo tag que antes: ninguna configuración que funcionaba cambia (Decisión A)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-store.test.js#una clave LEGIBLE se devuelve TAL CUAL: ninguna configuración que ya funcionaba cambia"
        status: pass
      - kind: unit
        ref: "test/inbox-store.test.js#una clave que SE PARECE a un UUID pero no lo es NO se proyecta"
        status: pass
    human_judgment: false
  - id: D3
    description: "El carril de datos neutraliza los bytes de control que el serializador NO escapa (DEL y bloque C1), sin perder byte-determinismo ni introducir color (CAPT-03, WR-02, T-83-37)"
    requirement: CAPT-03
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#runInboxListCli — --json saneado: lo que el serializador NO escapa (WR-02, T-83-37)"
        status: pass
      - kind: integration
        ref: "test/format-isolation.test.js (color isolation intacta) + test/inbox-cli.test.js#--json: UNA línea parseable, sin ANSI y byte-idéntica entre dos ejecuciones (DX-06)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El operador recibe un mensaje distinguible cuando el marcado no se aplica por escritura concurrente frente a lock ocupado; ambos salen con 1 y dejan el fichero intacto (D-13, T-83-41)"
    requirement: CAPT-06
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#concurrent-write → 1, nombra la CAUSA y difiere del mensaje de lock ocupado (D-13)"
        status: pass
    human_judgment: false
  - id: D5
    description: "El aviso del fail-open de la captura viaja por el seam inyectable del handler y es observable en el binario real con exit 0 (CAPT-01, D-03, WR-08, T-83-42)"
    requirement: CAPT-01
    verification:
      - kind: unit
        ref: "test/inbox-cli.test.js#el seam de salida de error se propaga al store junto con los paths (WR-08)"
        status: pass
      - kind: integration
        ref: "test/inbox-cli.test.js#con el lock TOMADO por un proceso vivo: exit 0, la línea SÍ se escribe y avisa (D-03)"
        status: pass
    human_judgment: false
  - id: D6
    description: "La documentación del orquestador no describe el fichero con una garantía de concurrencia que el marcado no da, e incluye el modo de fallo por escritura concurrente y la forma segura de capturar texto con guion inicial (CAPT-04, IN-02, WR-05)"
    requirement: CAPT-04
    verification:
      - kind: manual_procedural
        ref: "grep -ci 'append-only' .claude/skills/kodo-orchestrate/skill.md → 0 · grep -c 'solo crece' → 1 · bloque de tres pasos intacto en orden (listar, enrutar fuera de kodo, marcar) · grep -c '--origin' README.md → 0 · grep -c '--project|--open' README.md → 0"
        status: pass
    human_judgment: true
    rationale: "La corrección es de PROSA dirigida a un agente: los greps prueban que la afirmación falsa desapareció y que no se adelantó superficie, pero que el texto nuevo describa el modelo real sin inducir otra asunción errónea es un juicio de lectura, no una aserción automatizable"

# Metrics
duration: 12min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 07: Cierre de GAP-3 y de los tres warnings de su superficie — Summary

**El tag de una captura vuelve a decir el nombre del proyecto en la instalación real del operador (donde las 10 claves de `projects.json` son UUIDs de 36 caracteres), el carril `--json` deja de emitir los controles C1/DEL que el serializador no escapa, el marcado abortado por escritura concurrente se distingue del lock ocupado, y la copy del orquestador deja de llamar solo-append a un fichero que el marcado reescribe entero.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-25T16:23:48Z
- **Completed:** 2026-07-25T16:36:00Z
- **Tasks:** 3 (la 1 en TDD: RED → GREEN)
- **Files modified:** 7

## Accomplishments

- **GAP-3 cerrado con evidencia sobre la configuración real.** `deriveTag` proyecta ahora un identificador con forma de UUID al último segmento de la ruta **mapeada**. Comprobado contra el `~/.kodo/projects.json` real de esta máquina: antes `7246e3fe-3dc4-4f24-9078-1911ad477e0d`, ahora `kodo`.
- **El fixture que faltaba.** El bloque nuevo de `test/inbox-store.test.js` usa claves UUID con valores `{default, modules}` —la forma que el operador tiene en disco— en lugar de las claves legibles inventadas que hacían el defecto invisible a una suite verde. 6 casos rojos antes del arreglo.
- **WR-02 cerrado en el carril que la skill manda usar.** `sanitizeJsonField` elimina DEL y el bloque C1 de texto, tag, origen y destino. El comentario que afirmaba que el serializador escapaba «todo byte de control» se sustituye por la medición real del review.
- **D-13 completado.** El `reason` de escritura concurrente que 83-04 introdujo tenía rama por defecto («filesystem error»); ahora tiene copy propia que nombra la causa —un guard que aborta para no destruir una captura concurrente— con el mismo exit 1 reintentable.
- **WR-08 cerrado con el carril que muerde.** El aviso del fail-open sale por el seam inyectable del handler y hay dos pruebas: una que observa el mensaje sobre el binario con el lock tomado por un proceso vivo, y un unit que detecta si la propagación se pierde.
- **IN-02 y WR-05 en la documentación.** El skill describe el modelo real del fichero (solo crece; el marcado lo reescribe entero bajo lock), el modo de fallo nuevo, y la regla de anteponer `--` al shellear `kodo capture`.

## Task Commits

1. **Task 1 (RED): fixture con la forma REAL de `projects.json`** — `f23b5e3` (test)
2. **Task 1 (GREEN): proyección del identificador de proveedor** — `b3f2689` (feat)
3. **Task 2: saneo del carril de datos + mapeo del `reason` concurrente** — `8bf9dbb` (fix)
4. **Task 3: seam del fail-open + corrección de la documentación** — `1a66b5f` (docs)

## Files Created/Modified

- `src/inbox/store.js` — `isUuidLike` (constante de módulo anclada, anti-ReDoS) + `mappedProjectPath` (acepta valor cadena u objeto con ruta por defecto, filtra no-cadenas, no recorre módulos); `deriveTag` cablea la proyección condicional dentro de su `try/catch` y documenta las Decisiones A y B.
- `src/cli/inbox.js` — `sanitizeJsonField` (solo `\u007f`-`\u009f`, en notación de escape) aplicado a texto, tag, origen y destino nulable del carril de datos; rama `concurrent-write` en el mapeo a copy y exit code.
- `src/cli/capture.js` — el canal de error del handler viaja a `appendCapture` como `warnFn`.
- `test/inbox-store.test.js` — bloque `deriveTag` con la forma real del mapa: 9 casos (cwd exacto, subdirectorio profundo, valor cadena, mayúsculas, barra final, sin ruta utilizable, clave legible, near-misses de UUID, sin match / ambiguo / corrupto).
- `test/inbox-cli.test.js` — espejo del saneo sobre el carril de datos con vectores en notación de escape + determinismo + `dest` nulo; caso de `concurrent-write`; unit de propagación del seam; integración del fail-open con el lock tomado; E2E del tag persistido. `kodo()` acepta un `cwd` opcional.
- `.claude/skills/kodo-orchestrate/skill.md` — tres ediciones quirúrgicas en la sección de triage; el resto del fichero intacto.
- `README.md` — forma segura del texto con guion inicial + el exit 1 del marcado enumera la escritura concurrente.

## Decisions Made

Las siete decisiones están en el frontmatter (`key-decisions`). Las tres que un lector futuro necesita primero:

1. **La proyección del tag es condicional, no incondicional.** Solo se traduce lo que tiene forma de UUID; lo legible se devuelve tal cual. Cerrar un gap no reabre lo que ya funcionaba.
2. **La ruta legible sale del mapa, no del cwd.** El basename del directorio actual es el último recurso: capturar desde un subdirectorio es lo normal y su nombre informa peor que el del proyecto.
3. **Reversión de contexto acumulado de 83-02.** La entrada de `STATE.md` que afirma «el carril `--json` emite el texto VERBATIM porque `JSON.stringify` ya escapa los bytes C0» es **factualmente falsa** y este plan la invalida: el serializador escapa los C0 pero deja pasar DEL y el bloque C1. Registrado aquí para que el carril de estado deje de propagarla.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] El test de integración del fail-open no muerde; se añade el unit que sí**
- **Found during:** Task 3
- **Issue:** El caso de integración que el plan prescribe (lock tomado por un proceso vivo → observar el aviso en el stderr del binario) pasa **igual con y sin** la propagación del seam: el default de `appendCapture` escribe a `process.stderr`, que es exactamente el stream que el test lee. Comprobado revirtiendo la propagación a mano: 0 rojos. Presentarlo como evidencia del cambio habría sido un caso ciego — el patrón que DEBT-04 prohíbe por nombre.
- **Fix:** Se conserva el caso de integración (prueba lo que sí prueba: que el operador REAL ve el mensaje sobre el binario, que era el hueco de WR-08) y se añade un unit que asserta que el store recibe un `warnFn` **inyectable** y que lo emitido por él sale por el `errFn` del handler. Ese sí muerde: revertida la propagación, 1 rojo. La limitación queda escrita en el comentario del propio test para que nadie la re-descubra.
- **Files modified:** `test/inbox-cli.test.js`
- **Verification:** Mordida medida en los dos sentidos (con propagación: 75 pass / 0 fail; sin ella: 74 pass / 1 fail).
- **Committed in:** `1a66b5f`

**2. [Rule 2 - Missing Critical] El E2E del tag persistido, exigido por los criterios de la Task 1, vive en `test/inbox-cli.test.js`**
- **Found during:** Task 1
- **Issue:** El bloque `<files>` de la Task 1 solo lista `src/inbox/store.js` y `test/inbox-store.test.js`, pero su criterio de aceptación exige una comprobación extremo a extremo con HOME sandbox sobre el campo REALMENTE persistido — que es el carril de integración del otro fichero.
- **Fix:** El caso se añade al carril de integración de `test/inbox-cli.test.js` y el helper `kodo()` gana un `cwd` opcional (necesario para invocar desde una ruta mapeada; el resto de casos siguen corriendo desde el repo, sin cambio de comportamiento).
- **Files modified:** `test/inbox-cli.test.js`
- **Verification:** Mordida verificada revirtiendo la proyección a mano (1 rojo).
- **Committed in:** `b3f2689`

**3. [Rule 2 - Missing Critical] El README enumeraba las causas del exit 1 del marcado y se había quedado incompleto**
- **Found during:** Task 3
- **Issue:** La tabla de superficie decía «`1` error de fs o lock ocupado». Tras añadir la rama de escritura concurrente, esa enumeración describía menos modos de fallo de los que el código tiene — y el plan exige que los exit codes sean idénticos entre README y skill.
- **Fix:** La celda pasa a «`1` error de fs, lock ocupado o escritura concurrente». Cambio de una celda; ni la tabla ni ninguna otra sección se reescriben.
- **Files modified:** `README.md`
- **Verification:** `grep -c '--origin' README.md` → 0 y `grep -c '--project|--open' README.md` → 0 (no se adelanta superficie diferida, D-14/D-16).
- **Committed in:** `1a66b5f`

---

**Total deviations:** 3 auto-fixed (3 missing critical)
**Impact on plan:** Ninguna amplía el alcance. Dos añaden la cobertura que los criterios de aceptación del propio plan exigían, y la tercera mantiene la coherencia documental que el plan declara obligatoria. Cero dependencias nuevas, cero superficie de CLI nueva.

## Issues Encountered

- **Bytes de control literales colándose en el source.** La cabecera de `test/inbox-cli.test.js` exige cero caracteres de control literales (son ilegibles en diff y disparan detectores de inyección). Al escribir los vectores y las clases de caracteres, los bytes entraron literales. Resuelto convirtiéndolos a notación de escape (`\u007f`, `\u009b`, `\u009d`…) y verificando con una sonda que ni `src/cli/inbox.js` ni `test/inbox-cli.test.js` conservan ninguno.
- **El E2E del tag medía el fallback, no la proyección.** En macOS, `mkdtempSync` devuelve `/var/folders/…` pero el `process.cwd()` del proceso hijo llega resuelto a `/private/var/folders/…`: el path del mapa no era ancestro del cwd. Resuelto aplicando `realpathSync` al sandbox, con la razón escrita en el propio test.
- **`git stash push` revirtió trabajo sin commitear.** Un intento de aislar un revert temporal usando el stash deshizo las ediciones de la Task 3 aún sin commitear. Recuperado con `git stash pop` (la entrada era verificablemente la recién creada sobre `8bf9dbb`, en el árbol principal, no en un worktree). Los reverts de comprobación de mordida posteriores se hicieron con copia de fichero, no con el stash.

## Verificación agregada

- `node --test test/inbox-store.test.js test/inbox-cli.test.js test/inbox-concurrency.test.js test/format-isolation.test.js test/inbox-format-golden.test.js` → **193 pass / 0 fail**.
- `npm test` → **2556 tests, 2555 pass, 0 fail, 1 skipped** (baseline previo: 2549).
- `git diff --stat package.json package-lock.json` → vacío (invariante cero dependencias).
- Comprobación sobre la configuración REAL del operador: `deriveTag(cwd, loadProjects())` devuelve `kodo` (4 chars) donde antes devolvía el UUID de 36. **Se ha verificado por lectura, sin escribir en el `~/.kodo/inbox.md` real** — la comprobación manual de una línea que el plan sugería habría dejado una captura de prueba en el buffer del operador; el E2E con HOME sandbox aporta la misma evidencia sobre el campo persistido sin ese efecto.

## Cierre de la fase — los tres gaps

| Gap | Plan | Evidencia |
|-----|------|-----------|
| GAP-1 — captura concurrente destruida por el marcado | 83-04 + 83-06 | `test/inbox-concurrency.test.js` verde con el escenario de 1500 ms y su guard de cobertura |
| GAP-2 — carril de datos truncado en 64 KB | 83-05 | Regresión con inbox > 64 KB canalizado |
| GAP-3 — tag ilegible en la instalación real | **83-07 Task 1** | Cobertura con la forma real del mapa + E2E del campo persistido + comprobación sobre la config real |

## Deuda registrada (diferida con razón, sin cambios respecto al plan)

- **WR-04** — el codificador de línea no valida su propio contrato: el arreglo cambia un contrato inter-fase byte-exacto que Phase 84 aún no existe para absorber.
- **WR-06** — CRLF y BOM rompen el parser en silencio: exige tocar la misma superficie que 83-04 acaba de reescribir, manteniendo el round-trip byte a byte de D-04.
- **IN-01, IN-03, IN-04** — higiene sin impacto observable.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Los tres gaps de `83-VERIFICATION.md` quedan cerrados; la fase puede ir a verificación.
- **Phase 84 (CAPT-02/05/07) desbloqueada:** el contrato byte-exacto de `encodeLine` no se ha tocado y el carril `--json` conserva orden y conjunto de claves. Lo único que cambia para un consumidor es que el campo `tag` es ahora legible y que los campos de texto ya no pueden llevar controles C1/DEL.
- **Acción para el carril de estado:** `STATE.md` §Accumulated Context sigue registrando de 83-02 la afirmación falsa sobre el saneo del carril `--json`. Este SUMMARY la revierte explícitamente; la corrección del fichero es competencia del workflow.

---
*Phase: 83-inbox-foundation-captura-triage*
*Completed: 2026-07-25*

## Self-Check: PASSED

- 7 ficheros modificados verificados en disco + `83-07-SUMMARY.md` presente.
- 5 commits verificados en `git log`: `f23b5e3` (test RED), `b3f2689` (feat GREEN), `8bf9dbb` (fix), `1a66b5f` (docs), `63ace58` (SUMMARY).
