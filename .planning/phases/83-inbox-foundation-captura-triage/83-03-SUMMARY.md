---
phase: 83-inbox-foundation-captura-triage
plan: 03
subsystem: test
tags: [inbox, concurrency, real-process-race, barrier-file, lock-budget, lost-update, home-isolation, documental-seam]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage (plan 01)
    provides: "`src/inbox/store.js` con el seam `_afterReadFn` — la palanca determinista de la ventana lectura→rename"
  - phase: 83-inbox-foundation-captura-triage (plan 02)
    provides: "La superficie CLI LOCKED que la documentación describe (`kodo capture` · `kodo inbox` · `route` · `discard`)"
  - phase: 82-fix-de-la-carrera-de-steallock
    provides: "El precedente DEBT-04: una carrera nunca se pone verde enmascarándola"
  - phase: 74-handoff-wr-02
    provides: "`test/helpers/lock-race-child.mjs` y su disciplina de import dinámico POST-HOME"
provides:
  - "`test/inbox-concurrency.test.js`: los dos escenarios de D-21 con procesos reales y barrier file"
  - "`--kind capture` y `--kind mark` en el harness compartido, con id determinista `cap<idx>`"
  - "EVIDENCIA de que una captura concurrente al marcado no se pierde — el criterio 3 de CAPT-03 deja de ser una decisión escrita"
  - "Presupuesto de lock de la captura subido a ~1000 ms: cierra el lost-update que el default de 160 ms dejaba abierto"
  - "Seam de enrutado documentado como delegación pura en README y en el skill del orquestador, con flujo byte-idéntico"
affects: [84-superficies-de-captura, CAPT-01, CAPT-03, CAPT-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Ensanchar una ventana de carrera por SEAM INYECTADO (`_afterReadFn`) en vez de por timing hack — la carrera es reproducible, no probabilística"
    - "ID determinista derivado del índice del hijo (`cap<idx>`): el padre asserta IDENTIDAD por línea, no solo el conteo"
    - "Bucle de repetición DENTRO del caso de test con sandbox nuevo por iteración y contexto de fallo que incluye iteración + contenido del fichero"
    - "Presupuesto de lock asimétrico y justificado por medida: la captura espera ~1000 ms antes de hacer fail-open; el marcado sigue con el default y NO hace fail-open"

key-files:
  created:
    - "test/inbox-concurrency.test.js"
  modified:
    - "test/helpers/lock-race-child.mjs"
    - "src/inbox/store.js"
    - "README.md"
    - ".claude/skills/kodo-orchestrate/skill.md"

key-decisions:
  - "83-03: el riesgo residual de D-03 SE MATERIALIZÓ — con el presupuesto por defecto (8 × 20 ms ≈ 160 ms) las 6 capturas concurrentes agotaban el lock, hacían fail-open y el rename del marcado las borraba TODAS (0/6 supervivientes). Arreglo aplicado: `CAPTURE_LOCK_RETRIES = 50` × `CAPTURE_LOCK_BACKOFF_MS = 20` ≈ 1000 ms, que es literalmente el fix que D-03 y 83-CONTEXT.md:184 prescriben de antemano"
  - "83-03: el presupuesto es un TECHO, no una espera — `acquireLock` devuelve en cuanto obtiene el lock y la sección crítica real del marcado es sub-milisegundo, así que el coste en el camino feliz es cero"
  - "83-03: el fail-open NO se elimina (sigue siendo D-03) — solo se aleja: ahora hace falta un titular patológico (>1 s con el lock) para llegar a él, en vez de un marcado normal"
  - "83-03: el hijo de captura silencia el `warnFn` porque en esta carrera el fail-open es un RESULTADO ESPERADO, no un error; el veredicto del hijo no se usa para decidir corrección — la aserción es sobre el fichero"
  - "83-03: `--hold` se REUTILIZA como ancho de la ventana lectura→rename en `--kind mark` en vez de inventar un sinónimo; su semántica («sostener la sección crítica») es la misma"
  - "83-03: el padre importa `parseLine`/`listCaptures` estáticamente (no escribe en el inbox) pero JAMÁS invoca `defaultInboxPaths()` — todos los paths del fixture se construyen con `join(sandbox, '.kodo', …)`"

patterns-established:
  - "Un test de carrera que se pone rojo es un hallazgo de producto, no de test: la cabecera del fichero enumera los DOS arreglos admitidos (presupuesto de reintentos, RMW) y prohíbe por nombre los seis enmascaramientos habituales"
  - "Verificación del aislamiento como paso explícito: se comprueba que `~/.kodo/inbox.md` del operador sigue sin existir DESPUÉS de correr la suite completa"

requirements-completed: [CAPT-01, CAPT-03, CAPT-04]

coverage:
  - id: D1
    description: "8 procesos `kodo capture` reales liberados por un barrier producen exactamente 8 líneas: 8 ids deterministas distintos, cero líneas partidas, cero sin parsear, las 8 abiertas"
    requirement: CAPT-01
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#escenario 1 — 8 capturas concurrentes producen 8 líneas, cero pérdidas (CAPT-01, D-21.1)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Con un marcado sosteniendo la ventana lectura→rename 300 ms, las 6 capturas concurrentes sobreviven al RMW: el fichero contiene las 6 nuevas MÁS la marcada con su estado, dest, texto, tag, fecha y origen intactos"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#escenario 2 — captura concurrente DURANTE el marcado (aserciones 1, 2 y 4)"
        status: pass
    human_judgment: false
  - id: D3
    description: "En ese mismo escenario toda línea ajena sobrevive BYTE A BYTE — la segunda captura, el heading y la nota escrita a mano, ninguna de las dos últimas parseable (D-04)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#escenario 2 — aserción 3 (`lines.includes(foreign)` sobre las 3 líneas sembradas)"
        status: pass
    human_judgment: false
  - id: D4
    description: "El escenario mixto pasa en 5 iteraciones dentro del caso, en 3 ejecuciones seguidas del fichero y en 4 ejecuciones PARALELAS (precedente Phase 82: una carrera que pasa una vez no prueba nada)"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js (MIXED_ITERATIONS = 5) + 3 corridas secuenciales exit 0 + 4 corridas paralelas exit 0"
        status: pass
    human_judgment: false
  - id: D5
    description: "Cero residuo de ficheros temporales del marcado en el directorio del sandbox tras la carrera"
    requirement: CAPT-03
    verification:
      - kind: integration
        ref: "test/inbox-concurrency.test.js#escenario 2 — aserción 5 (`readdirSync` filtrado por `.tmp.`)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Los hijos escriben EXCLUSIVAMENTE en el HOME sandbox: import dinámico POST-HOME en el harness y cero import estático del store; el `~/.kodo/inbox.md` real del operador sigue sin existir tras `npm test`"
    requirement: CAPT-01
    verification:
      - kind: source-hygiene
        ref: "grep -nE '^import .*inbox/store\\.js' test/helpers/lock-race-child.mjs → 0 coincidencias"
        status: pass
      - kind: integration
        ref: "Comprobación manual del harness con HOME temporal + verificación de `~/.kodo/inbox.md` tras la suite completa"
        status: pass
    human_judgment: false
  - id: D7
    description: "La documentación describe el seam como un flujo de tres pasos operado por el humano o el LLM en sesión, con el paso del medio fuera de kodo, y afirma explícitamente que kodo no invoca, no importa y no reimplementa la lógica de destinos"
    requirement: CAPT-04
    verification:
      - kind: manual
        ref: "README.md §«El enrutado lo decide gsd-capture, no kodo» + skill.md §«Triage del inbox de capturas» — bloque de tres pasos byte-idéntico en ambos"
        status: pass
    human_judgment: true
  - id: D8
    description: "El README documenta los ficheros nuevos de `~/.kodo/` y la superficie CLI completa de la tabla LOCKED con sus exit codes, sin anunciar superficie inexistente ni el flag interno de origen"
    requirement: CAPT-04
    verification:
      - kind: source-hygiene
        ref: "grep de `--origin` → 0 · grep de `--project|--open` → 0 (baseline 0, sin aumento) · `inbox.md` y `inbox.lock` presentes en el árbol de ficheros"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-07-25
status: complete
---

# Phase 83 Plan 03: Concurrencia real del inbox y seam de enrutado Summary

**El escenario mixto de D-21 —6 capturas concurrentes durante un marcado con la ventana lectura→rename sostenida 300 ms— destapó que el riesgo residual de D-03 era real y total (0 de 6 supervivientes: el `rename` del marcado borraba todas las capturas que habían hecho fail-open), y se cerró subiendo el presupuesto de lock de la captura a ~1000 ms, que es exactamente el arreglo que D-03 dejaba prescrito; el seam de enrutado queda documentado como delegación pura en README y en el skill del orquestador.**

## Performance

- **Duration:** 8 min
- **Tasks:** 3
- **Files:** 1 creado (251 líneas) + 4 modificados
- **Tests:** +2 casos (2516 → 2518 en `npm test`, 0 fallos)

## Accomplishments

- **El criterio 3 de CAPT-03 deja de ser una decisión escrita y pasa a ser evidencia ejecutable.** El escenario 2 lanza 1 proceso de marcado y 6 de captura contra el mismo barrier, y asserta sobre el agregado: las 6 líneas nuevas presentes por id determinista, la marcada cerrada con su estado y su `dest`, y las 3 líneas ajenas byte a byte. Una revisión de esta fase ya puede *demostrar* por qué una captura concurrente al marcado no se pierde.
- **Y la primera respuesta fue que SÍ se perdía.** Con el presupuesto por defecto el test dio `captura cap000 PERDIDA por el RMW del marcado` y el fichero final contenía las 4 líneas del fixture y **ninguna** de las 6 capturas. No es un fallo de test: es el lost-update que D-01 dice cerrar, materializado. La ventana de 300 ms supera los ~160 ms del presupuesto por defecto, así que las 6 capturas hacían fail-open (D-03), appendeaban sin coordinación, y el `renameSync` del marcado —construido sobre una lectura anterior a esos appends— las borraba todas.
- **El arreglo es el que estaba escrito de antemano.** `83-CONTEXT.md:184` y el propio JSDoc de `appendCapture` decían, desde 83-01, que si el riesgo residual se materializaba el fix era *subir el presupuesto de reintentos de la captura, nunca debilitar el test de D-21*. Aplicado literalmente: `CAPTURE_LOCK_RETRIES = 50` × 20 ms ≈ 1000 ms. Cero enmascaramiento — la aserción, el hold y el número de hijos quedaron exactamente como se planificaron.
- **La ventana es determinista, no probabilística.** El seam `_afterReadFn` de 83-01 se usa tal cual: el hijo de marcado duerme síncronamente dentro del lock, entre la lectura fresca y el rename. Sin `sleep` a ciegas, sin reintentos, sin código de test en producción.
- **Repetición al nivel que exige el precedente de Phase 82.** 5 iteraciones dentro del caso (sandbox nuevo por iteración), 3 ejecuciones secuenciales del fichero y 4 ejecuciones **en paralelo**: exit 0 en todas.
- **El aislamiento se verificó, no se asumió.** Los dos kinds nuevos importan `src/inbox/store.js` dinámicamente y después de que el padre fije `HOME` (`grep -nE '^import .*inbox/store\.js'` → 0). Comprobado a mano con un `HOME` temporal, y comprobado tras la suite completa: el `~/.kodo/inbox.md` del operador sigue sin existir.
- **El seam documental cierra la puerta a acoplar kodo al skill de enrutado.** README y skill llevan el **mismo bloque de tres pasos, byte a byte**, con el paso del medio explícitamente fuera de kodo y la afirmación literal de que kodo «no invoca, no importa y no reimplementa» la lógica de destinos.

## Task Commits

1. **Task 1: Ampliar el harness de carrera** — `a114cc6`
   `--kind capture` (id determinista `cap<idx>`, `warnFn` silenciado) y `--kind mark` (`_afterReadFn` que duerme `--hold` ms dentro del lock), ambos con import dinámico POST-HOME. Cabecera de consumidores y bloque de argv actualizados. Los seis consumidores previos intactos.
2. **Task 2: `test/inbox-concurrency.test.js` + el arreglo que destapó** — `c237ca1`
   Los dos escenarios de D-21, más la subida del presupuesto de lock en `src/inbox/store.js`.
3. **Task 3: Documentar el seam de enrutado** — `0c72614`
   README (bloque de comandos, subsección del inbox con la tabla LOCKED y sus exit codes, árbol de `~/.kodo/`) y `.claude/skills/kodo-orchestrate/skill.md` (sección operativa de triage).

## Files Created/Modified

- `test/inbox-concurrency.test.js` (251 líneas, nuevo) — 2 casos. Cabecera de 30 líneas que declara qué criterio literal prueba cada escenario, la disciplina de aserción sobre el agregado, los **dos** arreglos admitidos si se pone rojo y los **seis** enmascaramientos prohibidos por nombre.
- `test/helpers/lock-race-child.mjs` (+105 líneas) — dos kinds nuevos y un `sleepSync` compartido. `await import(` pasa de 11 a 13 (uno por kind nuevo).
- `src/inbox/store.js` (+48/-11) — `CAPTURE_LOCK_RETRIES` / `CAPTURE_LOCK_BACKOFF_MS` con el razonamiento y la medida empírica que los justifican; `appendCapture` los pasa a `withFileLock`.
- `README.md` (+58) — 2 entradas en el bloque de comandos, subsección `### kodo capture / kodo inbox` (qué es el inbox, tabla de la superficie LOCKED con exit codes, flujo de tres pasos, garantías del fichero human-editable) y 2 entradas en el árbol de `~/.kodo/`.
- `.claude/skills/kodo-orchestrate/skill.md` (+44) — sección `## Triage del inbox de capturas` al mismo nivel que diagnóstico e higiene del sidebar.

## Decisions Made

| # | Decisión | Dónde se justifica / prueba |
|---|----------|------------------------------|
| 1 | Presupuesto de lock de la captura a 50 × 20 ms ≈ 1000 ms | JSDoc de `CAPTURE_LOCK_RETRIES` con la medida empírica (0/6 supervivientes con el default) + el escenario 2 en verde ×5 |
| 2 | El presupuesto es un techo, no una espera → coste cero en el camino feliz | `acquireLock` devuelve al obtener el lock; la sección crítica real del marcado es sub-ms (`npm test` no se alarga: 21,5 s antes y después) |
| 3 | El fail-open de D-03 NO se elimina, solo se aleja | La rama fail-open sigue en `appendCapture` con su warn único; lo que cambia es el umbral para alcanzarla |
| 4 | `--hold` reutilizado como ancho de la ventana en `--kind mark` | El plan pedía no inventar sinónimos; la semántica («sostener la sección crítica») es la misma que en los kinds previos |
| 5 | El veredicto del hijo de captura no decide corrección | `warnFn` silenciado porque el fail-open es un resultado esperado de la carrera; la aserción es sobre el fichero final |
| 6 | El marcado conserva el presupuesto por defecto y su no-fail-open | Contrato 3 de 83-01: un marcado sin coordinación reintroduce el lost-update. El test asserta que el marcado completa (`verdicts[0] === 'written'`), sin enmascarar un `failed` |

Decisiones menores dentro de la Claude's Discretion del plan:

- **El id determinista es `cap<idx>` con `padStart(3,'0')`** (`cap000`…`cap007`): 6 chars dentro del alfabeto `[0-9a-z]+` que el parser acepta, así que las líneas del test son indistinguibles en forma de las reales.
- **El escenario 2 asserta también que la línea original a marcar NO aparece duplicada** (`lines.filter(l => l === LINE_TO_MARK).length === 0`): sin eso, un RMW que appendease la versión marcada en vez de sustituirla pasaría las otras aserciones.
- **Los mensajes de fallo llevan iteración, veredictos y el contenido íntegro del inbox de esa iteración**, para que un fallo en CI sea diagnosticable sin reproducir.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] El fail-open de la captura perdía TODAS las capturas concurrentes a un marcado**

- **Found during:** Task 2 (escenario 2 de D-21, en su primera ejecución)
- **Issue:** El presupuesto de lock por defecto de `appendCapture` (8 reintentos × 20 ms ≈ 160 ms) es **menor** que una ventana lectura→rename de 300 ms. Consecuencia medida: los 6 hijos de captura agotaban el presupuesto, entraban por la rama fail-open de D-03 y appendeaban sin coordinación **dentro** de la ventana; el `renameSync` del marcado publicaba un contenido derivado de una lectura anterior a esos appends y las borraba las 6. Resultado literal del primer run: `captura cap000 PERDIDA por el RMW del marcado`, con el fichero final conteniendo solo las 4 líneas del fixture. Es el lost-update que D-01 dice cerrar y que CAPT-03 criterio 3 prohíbe — un fallo de producto, no de test.
- **Fix:** `CAPTURE_LOCK_RETRIES = 50` y `CAPTURE_LOCK_BACKOFF_MS = 20` (≈ 1000 ms), pasados explícitamente a `withFileLock` desde `appendCapture`. Es literalmente el arreglo que D-03, `83-CONTEXT.md:184` y el JSDoc previo de `appendCapture` prescribían para este caso. **Ni la aserción, ni el hold de 300 ms, ni los 6 hijos se tocaron.**
- **Files modified:** `src/inbox/store.js`
- **Verification:** Escenario 2 verde en 5 iteraciones internas, 3 ejecuciones secuenciales y 4 ejecuciones paralelas; `npm test` 2518/2518 con la misma duración total que antes del cambio.
- **Committed in:** `c237ca1` (commit de Task 2)

---

**Total deviations:** 1 auto-fixed (Rule 1). Cero deviaciones de alcance, cero superficie nueva, cero dependencias.

## Issues Encountered

- **La primera versión del escenario 2 fue roja, y esa fue la señal correcta.** El plan anticipaba exactamente este resultado (`<action>`: *«un tiempo de retención… por encima del presupuesto de reintentos del lock para que algunos hijos de captura entren por la rama fail-open»*) y prescribía el arreglo. Se deja registrado para el verificador: el rojo no fue un error de escritura del test, fue el hallazgo.
- **Riesgo de flakiness descartado empíricamente, no por argumento.** La preocupación era que el hijo de marcado perdiese la carrera del lock frente a 6 capturas y agotase su propio presupuesto (que sigue siendo el default, y sin fail-open). Se midió con 5 iteraciones × 3 corridas secuenciales × 4 corridas paralelas: `verdicts[0] === 'written'` en todas. No se subió el presupuesto del marcado porque no hizo falta.
- **Nota de higiene para el verificador:** el escáner de inyección marcó `README.md` con `MD-LINK-TOKEN-IN-QUERY:?token=`. Es un falso positivo sobre contenido **preexistente** (la URL del dashboard web local, `README.md:164`), ajeno a las tres ediciones de este plan.

## Threat Flags

Ninguna superficie de seguridad nueva fuera del `<threat_model>` del plan. Las 5 amenazas con disposición `mitigate` quedan implementadas y con aserción:

| Threat | Mitigación implementada |
|--------|-------------------------|
| T-83-15 | Todo `spawn` lleva `env: {...process.env, HOME: sandbox}`; los dos kinds nuevos importan el store dinámicamente POST-HOME (0 imports estáticos, verificado por grep); los paths del fixture se construyen con `join(sandbox, '.kodo', …)` y nunca con `defaultInboxPaths()`; verificado tras la suite que el inbox real del operador sigue sin existir |
| T-83-16 | Es el escenario 2. **Detectó una pérdida real** y forzó el arreglo del presupuesto; ahora verde con aserción sobre el agregado y ≥5 iteraciones |
| T-83-17 | Cabecera del test que enumera los dos arreglos admitidos y prohíbe por nombre los seis enmascaramientos (relajar assert, reducir hijos, bajar el hold, subir el timeout, `.skip`, reintentos). El precedente DEBT-04 se cita explícitamente |
| T-83-18 | README y skill afirman literalmente que kodo «no invoca, no importa y no reimplementa» la lógica de destinos, y el skill añade la regla dura de no automatizar el paso 2 ni escribir el fichero directamente |
| T-83-SC | Cero instalaciones: los dos escenarios usan solo built-ins (`node:child_process`, `node:fs`, `Atomics`). `git diff --stat package.json package-lock.json` vacío |

T-83-19 (hijos colgados) queda `accept` como planificado: el barrier tiene espera acotada, los hijos salen siempre con 0 por contrato, y el caso lleva `timeout: 180_000`.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **La fase 83 queda cerrada en sus tres planes.** El modelo de estado de D-01 tiene evidencia empírica, la superficie CLI está cableada y el seam de enrutado documentado.
- **Phase 84 hereda un writer más seguro de lo planificado.** El skill de captura shellea `kodo capture --origin skill`; con el presupuesto subido, una captura del skill concurrente a un triage del operador ya no puede perderse por el camino del fail-open.
- **Nota para `/gsd-verify-work`:** el gate de fase de RESEARCH §Sampling Rate («corrida repetida del escenario mixto») ya está cubierto — 5 iteraciones internas + 3 secuenciales + 4 paralelas, todas verde.
- **Sin blockers.** `npm test` 2518 tests, 0 fallos, 1 skip preexistente ajeno a esta fase. Cero dependencias npm nuevas.

---
*Phase: 83-inbox-foundation-captura-triage*
*Completed: 2026-07-25*

## Self-Check: PASSED

Verificado contra disco y git tras escribir este SUMMARY:

- **Ficheros:** `test/inbox-concurrency.test.js` creado (251 líneas, `min_lines` 120 ✓). Modificados y presentes: `test/helpers/lock-race-child.mjs`, `src/inbox/store.js`, `README.md`, `.claude/skills/kodo-orchestrate/skill.md`.
- **Commits:** `a114cc6`, `c237ca1`, `0c72614` — los 3 existen en el historial. Ninguno borra ficheros (`git diff --diff-filter=D` vacío en los tres).
- **`artifacts` del plan:** harness contiene `--kind` ✓ · test 251 líneas ✓ · README contiene `kodo capture` (4) ✓ · skill contiene `kodo inbox` (7) ✓.
- **`key_links` del plan:** test → harness (`lock-race-child`, 3 refs de `--kind` + spawn con `HOME` sandbox) ✓ · harness → store (`await import(.*inbox/store\.js`, 2 coincidencias, 0 imports estáticos) ✓ · README ↔ skill (`kodo inbox route`, bloque de tres pasos byte-idéntico) ✓.
- **Gates por grep:** kinds nuevos = 2 · `await import(` 11 → 13 · `^import .*inbox/store\.js` = 0 · `inbox-concurrency` en la cabecera del harness = 1 · README `--origin` = 0 · README `--project|--open` = 0 (baseline 0, sin aumento) · README `inbox.md` = 4, `inbox.lock` = 1.
- **Verificación del plan:** `node --test test/inbox-concurrency.test.js` exit 0 ×3 secuenciales y ×4 paralelas · `node --test test/inbox-cli.test.js test/inbox-store.test.js` 123/123 · `npm test` 2518 tests, 0 fallos · `git diff --stat package.json package-lock.json` vacío.
- **Aislamiento:** `~/.kodo/inbox.md` del operador **no existe** tras correr la suite completa.
