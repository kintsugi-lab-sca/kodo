---
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
plan: 01
subsystem: cli
tags: [skill-sync, allowlist, control-de-acceso, multi-skill, resiliencia, json-contract, source-hygiene]

# Dependency graph
requires:
  - phase: 84-superficies-de-captura-skill-sync-conteo-ambient
    plan: "02"
    provides: "`.claude/skills/kodo-capture/SKILL.md` — la segunda entrada del registro. Sin ella el bucle tendría una sola skill real que distribuir"
  - phase: 21-skill-sync
    provides: "`syncSkill` (copia diferencial por hash, per-skill y pura), el gate de exit 2 con su literal canonical y el contrato `--json` de orden de claves fijo"
  - phase: 31-advisories
    provides: "La DI de `cleanupFn` con su `try/finally` externo y la de `onConsoleWarn`, que este plan conserva intactas"
provides:
  - "`KODO_SKILLS` — allowlist explícita y congelada de las skills que kodo distribuye al HOME del operador. Es el control de acceso de la fase: lo único que impide que una skill de trabajo local del repo acabe copiada al HOME de todos"
  - "`kodo skill sync` multi-skill con resiliencia por skill: una entrada rota no impide que la otra llegue a su destino, y el exit agregado es 1"
  - "El payload `--json` con `skills[]`, aditivo y de orden de claves fijo — quien hoy lee `.status` o `.files_changed` sigue funcionando"
  - "El gate de entrypoint case-tolerante (`SKILL.md` / `skill.md`) en los DOS sitios: el handler y `syncSkill`"
  - "Un guard source-hygiene que impide generalizar los tres consumidores single-skill que D-08b deja deliberadamente fuera"
affects: [phase-85-saneo, futuras skills distribuibles de kodo, el auto-sync del orquestador si algún día se generaliza]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Allowlist congelada como control de acceso: el registro de lo que se copia al HOME del operador es una constante literal revisable en diff, jamás un listado de directorio — y un test source-hygiene lo asserta"
    - "Resiliencia por iteración en un bucle de efectos: `try/catch` que normaliza la excepción al mismo shape que el error devuelto, agregación posterior, y exit code derivado del agregado"
    - "Crecimiento aditivo de un contrato `--json`: las claves del agregado conservan su posición, la clave nueva se añade después y las condicionales al final por asignación"
    - "Guard anclado al patrón de import, nunca al identificador suelto: un comentario que documenta la regla no puede poner roja la suite"

key-files:
  created:
    - .planning/phases/84-superficies-de-captura-skill-sync-conteo-ambient/deferred-items.md
  modified:
    - src/cli/skill-sync.js
    - src/skill/sync.js
    - src/cli.js
    - test/skill-sync.test.js

key-decisions:
  - "El prefijo de error por skill es `Error: filesystem error: [{skill}] {msg}` (forma de 84-UI-SPEC), no la de 84-RESEARCH §Code Example 2: mover los dos puntos habría roto el assert anclado `/^Error: filesystem error: /`"
  - "`src/skill/sync.js:67` ENTRA en alcance: D-07 necesita el gate case-tolerante en los dos sitios o `kodo-capture/SKILL.md` falla en Linux. No cambia firma ni contrato de retorno, así que es compatible con D-06 leído literalmente"
  - "Los errores por skill se emiten a stderr en LOS DOS modos, también bajo `--json`: el payload lleva el `status` de cada entrada pero no su mensaje, y silenciarlo bajo `--json` habría sido una regresión de información"
  - "El fixture creció ANTES de tocar el handler, en su propio commit y con la suite verde: los 6 asserts anclados salieron a la luz juntos en vez de uno a uno en rojo"

patterns-established:
  - "Cuando un mecanismo single-skill se generaliza, el registro es el control de acceso — y el control de acceso se testea, no se documenta"
  - "Prueba de mordida de un guard en AMBOS sentidos (el falso positivo que debe seguir verde y el verdadero positivo que debe ponerse rojo), registrada en el SUMMARY"

requirements-completed: [CAPT-05]

coverage:
  - id: D1
    description: "`kodo skill sync` distribuye las DOS skills del registro en la misma invocación, en el orden de `KODO_SKILLS`, con una línea por skill (D-01, D-05)"
    requirement: CAPT-05
    verification:
      - kind: integration
        ref: "test/skill-sync.test.js#SKILL-04 #1: ok (first sync) → exit 0, una línea por skill con su prefijo"
        status: pass
      - kind: integration
        ref: "test/skill-sync.test.js#SKILL-04 #2: noop (segundo run sin drift) → exit 0, `No drift` por skill"
        status: pass
      - kind: other
        ref: "HOME=$(mktemp -d) node bin/kodo skill sync --json contra el repo real → status ok y skills[] de dos entradas; el destino sandbox contiene kodo-orchestrate y kodo-capture, y NO worktree-cleanup"
        status: pass
    human_judgment: false
  - id: D2
    description: "El registro es una allowlist literal congelada y NUNCA se descubre por directorio: `worktree-cleanup` no se distribuye (D-01, mitigación de T-84-01)"
    requirement: CAPT-05
    verification:
      - kind: unit
        ref: "test/skill-sync.test.js#D-01 source-hygiene: el registro es una allowlist LITERAL y nunca se descubre por directorio"
        status: pass
      - kind: other
        ref: "grep -cE 'readdirSync|globSync|\\bglob\\(' src/cli/skill-sync.js → 0"
        status: pass
    human_judgment: false
  - id: D3
    description: "Resiliencia por skill: una entrada en error —devuelto o lanzado— no aborta el bucle; la otra se sincroniza y el exit agregado es 1 (D-03, mitigación de T-84-04)"
    requirement: CAPT-05
    verification:
      - kind: unit
        ref: "test/skill-sync.test.js#D-03 resiliencia: `status: error` en la primera skill NO aborta el bucle — exit agregado 1"
        status: pass
      - kind: unit
        ref: "test/skill-sync.test.js#D-03 excepción: un `syncFn` que LANZA se normaliza a error y el bucle continúa igual"
        status: pass
      - kind: integration
        ref: "test/skill-sync.test.js#SKILL-04 #3: fs error (dest file unreadable) → exit 1, stderr canonical"
        status: pass
    human_judgment: false
  - id: D4
    description: "El gate de exit 2 sigue anclado SOLO a `kodo-orchestrate` y su literal de stderr es byte-idéntico, comparado con `assert.equal` (D-02, T-84-05)"
    requirement: CAPT-05
    verification:
      - kind: integration
        ref: "test/skill-sync.test.js#SKILL-04 #4: not a kodo repo → exit 2 + stderr canonical exacto"
        status: pass
      - kind: other
        ref: "git diff test/skill-sync.test.js | grep -c 'not a kodo repository' → 0 (el assert byte a byte no se tocó)"
        status: pass
    human_judgment: false
  - id: D5
    description: "El payload `--json` crece de forma ADITIVA con orden de claves fijo: `status` y `files_changed` conservan su posición como agregado (D-04, DX-06)"
    requirement: CAPT-05
    verification:
      - kind: integration
        ref: "test/skill-sync.test.js#D-06b --json: byte-deterministic single-line, sin ANSI"
        status: pass
    human_judgment: false
  - id: D6
    description: "El gate de entrypoint acepta `SKILL.md` y `skill.md`, en ese orden, en el handler y dentro de `syncSkill` (D-07)"
    requirement: CAPT-05
    verification:
      - kind: unit
        ref: "test/skill-sync.test.js#D-07 case-tolerance: el entrypoint vale como `SKILL.md` o `skill.md` en los DOS gates"
        status: pass
    human_judgment: true
    rationale: "En macOS el test pasa TRIVIALMENTE: el filesystem es case-insensitive, así que `existsSync(join(dir,'skill.md'))` devuelve true aunque en disco solo exista `SKILL.md`. La mordida real solo es observable en un filesystem case-sensitive (CI o operador Linux), que no está disponible aquí. El test se conserva por eso, y su comentario lo declara."
  - id: D7
    description: "Cero regresión: los 8 unit de `syncSkill`, las 2 de `onConsoleWarn`, las 3 de `cleanupFn ordering` y los tres consumidores single-skill siguen exactamente como estaban (D-06, D-08b)"
    requirement: CAPT-05
    verification:
      - kind: unit
        ref: "node --test test/orchestrator-auto-sync.test.js test/skill-auto-commit.test.js test/orchestrator-launch-isolation.test.js → 11 tests · 0 fail"
        status: pass
      - kind: unit
        ref: "test/skill-sync.test.js#D-08b source-hygiene: los consumidores single-skill NO importan el registro"
        status: pass
      - kind: other
        ref: "npm test → 2 581 tests · 0 fail · 1 skipped (baseline 2 576 + 5 nuevos)"
        status: pass
    human_judgment: false
  - id: D8
    description: "La ayuda de commander habla en plural y nombra ambas skills y su destino"
    requirement: CAPT-05
    verification:
      - kind: other
        ref: "node bin/kodo skill --help | grep -c 'kodo-capture' → 1; git diff --stat src/cli.js → 1 línea"
        status: pass
    human_judgment: false
  - id: D9
    description: "Los seis ítems diferidos de la fase quedan registrados con su trigger real"
    requirement: CAPT-05
    verification:
      - kind: other
        ref: "deferred-items.md existe y menciona D-08b, D-08, D-24, D-13, format-isolation y 83-05, cada uno con su columna de Trigger"
        status: pass
    human_judgment: false

# Metrics
duration: 9 min
completed: 2026-07-26
status: complete
---

# Phase 84 Plan 01: Generalización multi-skill de `kodo skill sync` Summary

**`kodo skill sync` pasa de distribuir una skill a recorrer una allowlist congelada de dos, con resiliencia por skill, `--json` aditivo de orden fijo y una línea de render por entrada — y la allowlist es el control de acceso que impide que las skills de trabajo local del repo acaben en el HOME de nadie.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-26T09:10:48Z
- **Completed:** 2026-07-26T09:20:10Z
- **Tasks:** 3
- **Files modified:** 5 (1 creado, 4 modificados)

## Accomplishments

- **El registro es un control de acceso, y se testea como tal.** `KODO_SKILLS` es una constante literal `Object.freeze`d de dos entradas. Lo importante no es lo que incluye, sino lo que un listado de directorio habría incluido: `.claude/skills/` contiene también `worktree-cleanup`, una skill de trabajo local que kodo no publica. Un `readdirSync` habría convertido cualquier fichero caído ahí en algo que se copia al HOME de todos los operadores. El test source-hygiene asserta el contenido literal del registro **y** que el fichero no usa `readdirSync`/`glob` — verificado end-to-end: contra el repo real con HOME sandboxed, el destino recibe exactamente `kodo-orchestrate` y `kodo-capture`, y nada más.
- **La resiliencia D-03 está probada en las tres formas en que puede fallar.** Un `status:'error'` devuelto, una excepción lanzada, y un EACCES real de filesystem end-to-end: en los tres el bucle recorre las dos entradas, la skill sana llega a su destino, el exit agregado es 1 y el `2` queda reservado al gate. El test in-process asserta explícitamente que el stub se invocó **dos** veces, que es lo que distingue «no abortó» de «da la casualidad de que el código coincide».
- **El fixture creció ANTES de tocar producción, y eso hizo visible lo que la investigación no había visto.** Con la suite verde tras la Task 1, generalizar el handler puso rojo **un solo** assert: el `--json`, anclado a ambos extremos. Los otros cinco del inventario de §Pitfall 1 sobrevivieron por ser regex sin anclar (`/Synced 2 files? to /` sigue casando con el prefijo delante). Se endurecieron igualmente a `^{skill}: .*` con flag `m`, que es lo que de verdad verifica el contrato de D-05: **una línea por skill**, no «en algún sitio del stdout aparece el texto».
- **Los dos arbitrajes del planner se aplicaron y quedaron escritos en el código.** El prefijo de error lleva el nombre **después** de los dos puntos (`Error: filesystem error: [kodo-orchestrate] boom`), con un comentario que explica por qué no puede moverse; y `src/skill/sync.js` lleva en su única línea modificada un comentario que declara por qué entrar ahí es compatible con D-06 y no un descuido.
- **El guard anti-generalización se probó mordiendo en ambos sentidos.** No basta con que un guard esté verde: hay que demostrar que puede ponerse rojo. Ver la sección de verificación.

## Task Commits

1. **Task 1: Sembrar las dos skills en el fixture antes de tocar el handler** — `06c00b3` (test)
2. **Task 2: Generalizar el handler a la allowlist y adaptar los asserts anclados** — `e8abe91` (feat)
3. **Task 3: Ayuda en plural, guard anti-generalización y registro de diferidos** — `a726eb8` (docs)

## Files Created/Modified

- `src/cli/skill-sync.js` — tres constantes de módulo nuevas (`KODO_SKILLS`, `IDENTITY_SKILL`, `ENTRYPOINTS`), la función privada `hasSkillEntry(dir)`, el bucle secuencial con `try/catch` por iteración, la agregación (`anyError`/`anyOk`/`filesChanged`/`status`) y el render dual sobre `perSkill`. La firma `runSkillSyncCli(opts, deps)`, todas sus deps de DI y el `try/finally` externo del `cleanupFn` quedan intactos.
- `src/skill/sync.js` — **una sola condición**: el gate de entrypoint pasa de `existsSync(join(source,'skill.md'))` a aceptar `['SKILL.md','skill.md']`. Firma y contrato de retorno sin tocar; los 8 tests unit de la Suite 1 siguen verdes **sin modificarse**.
- `src/cli.js` — **una sola línea**: el `.description()` del subcomando `sync`. El bloque `.action()`, las opciones y el comentario sobre `ensureConfig()` intactos.
- `test/skill-sync.test.js` — `makeFixture()` siembra ambas skills, `destOf`/`sourceOf` parametrizados, el `afterEach` de la Suite 2 restaura ambos destinos, 6 asserts anclados actualizados y una Suite 3 nueva con 5 tests (resiliencia ×2, case-tolerance, allowlist y guard D-08b).
- `.planning/phases/84-.../deferred-items.md` *(nuevo)* — seis ítems en tabla con su trigger, más la nota de riesgo A1 sobre D-08 y la sección de ajenos por construcción.

## Decisions Made

1. **Prefijo de error `Error: filesystem error: [{skill}] {msg}`** (arbitraje 1 de 84-PATTERNS). La forma de 84-RESEARCH §Code Example 2 desplazaba los dos puntos y habría puesto rojo el assert anclado `/^Error: filesystem error: /`. El código lleva el comentario que lo advierte, y el test asserta ambas cosas: el prefijo anclado y que el mensaje nombra la skill culpable.
2. **`src/skill/sync.js` entra en alcance** (arbitraje 2). Sin el gate case-tolerante en su interior, en Linux `kodo-capture/SKILL.md` pasaría el gate del handler y `syncSkill` devolvería `source skill not found`. El cambio es una condición más permisiva: no toca firma ni contrato de retorno, así que es compatible con D-06 leído literalmente.
3. **Los errores por skill se emiten a stderr en los dos modos, también bajo `--json`.** Ver Deviations.
4. **Los asserts de render se endurecieron aunque no estuvieran rojos.** `/Synced 2 files? to /` seguía casando con el prefijo delante; anclarlo a `^kodo-orchestrate: .*Synced 2 files to ` con flag `m` es lo que convierte «el texto aparece» en «hay una línea por skill».

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Los errores por skill se emiten a stderr también bajo `--json`**

- **Found during:** Task 2, al construir el render dual.
- **Issue:** El plan sitúa la escritura del error a stderr **dentro de la rama human**. Siguiéndolo al pie de la letra, un `kodo skill sync --json` con una skill en error habría emitido un payload cuyas entradas llevan `status:'error'` pero **no el mensaje** (el orden de claves de `skills[]` está congelado en `{name, status, files_changed}` por DX-06), y nada en stderr. El diagnóstico se perdería por completo — hoy, en cambio, un error bajo `--json` sí emite stderr.
- **Fix:** el bucle de errores a stderr se ejecuta **antes** del branch, para los dos modos; la rama human se limita a renderizar las entradas no fallidas. El resultado en modo human es byte-idéntico a lo que el plan describe.
- **Files modified:** `src/cli/skill-sync.js`
- **Verification:** `grep -c 'filesystem error: \[' src/cli/skill-sync.js` → 1 (un solo sitio de emisión, como exige el criterio de aceptación); `test/skill-sync.test.js#D-03 resiliencia` asserta el contenido exacto de stderr.
- **Commit:** `e8abe91`

**Total deviations:** 1 auto-fixed (1 × Rule 2). **Impact:** ninguno sobre el contrato de copy ni sobre el orden de claves del payload; evita una pérdida de información en el carril scriptable.

### Precisión sobre el inventario de §Pitfall 1 (no es una desviación)

El inventario de la investigación anticipaba **6 asserts en rojo**. Con el fixture ya sembrado, solo se puso rojo **1** (el `--json`, anclado a `^…$`). Los otros cinco eran regex sin anclar y siguieron verdes con el prefijo delante. Se actualizaron igualmente porque un assert que pasa con y sin la característica no verifica la característica. Registrado aquí para que la próxima fase que lea ese inventario no lo dé por exacto.

## Issues Encountered

- **Ninguno bloqueante.** El único punto de fricción fue de redacción del plan, no de código: 84-VALIDATION y 84-PATTERNS citan las líneas de `test/skill-sync.test.js` con offsets de la versión pre-Task-1, así que tras el primer commit los números ya no coinciden. Los asserts se localizaron por contenido, no por línea.

## Verificación

| Comprobación | Resultado |
|---|---|
| `node --test test/skill-sync.test.js` | **26 tests · 0 fail** (21 previos + 5 nuevos) |
| `node --test test/inbox-cli.test.js test/format-isolation.test.js` | verde — gate de cero deps y color isolation intactos |
| `node --test test/orchestrator-auto-sync.test.js test/skill-auto-commit.test.js test/orchestrator-launch-isolation.test.js` | **11 tests · 0 fail** — los tres consumidores single-skill sin cambio de comportamiento |
| `npm test` | **2 581 tests · 0 fail · 1 skipped** (baseline post-84-02/03: 2 576) |
| `grep -cE "^const KODO_SKILLS = Object\.freeze\(\['kodo-orchestrate', 'kodo-capture'\]\);"` | 1 |
| `grep -cE "readdirSync\|globSync\|\bglob\("` en `src/cli/skill-sync.js` | **0** |
| `grep -c 'filesystem error: \['` / `grep -c 'filesystem error \['` | **1 / 0** — el nombre va después de los dos puntos, nunca antes |
| `git diff test/skill-sync.test.js \| grep -c "not a kodo repository"` | **0** — el `assert.equal` byte a byte del gate no se tocó |
| `git diff --stat src/cli.js` | 1 línea (solo el `.description()`) |
| `node bin/kodo skill --help \| grep -c "kodo-capture"` | 1 |
| **E2E contra el repo real, HOME sandboxed** | `{"status":"ok","files_changed":2,"skills":[{"name":"kodo-orchestrate",...},{"name":"kodo-capture",...}]}` · exit 0 · segundo run: dos líneas `No drift` · destino con **exactamente** las dos skills, sin `worktree-cleanup` |
| `~/.claude/skills/` real del operador, antes / después | **362 ficheros / 362 ficheros, mismo checksum `09f5a084`** — ningún test ni comprobación tocó el HOME real |

### Prueba de mordida del guard D-08b (obligatoria por el criterio de aceptación)

| Edición manual sobre `src/orchestrator/launch.js` | Resultado esperado | Resultado observado |
|---|---|---|
| (a) **Comentario** que nombra `KODO_SKILLS` y `src/cli/skill-sync.js` | verde (un comentario no puede poner roja la suite) | ✅ `ok 5 - D-08b source-hygiene…`, 26 pass / 0 fail |
| (b) **Import real**: `import { KODO_SKILLS } from '../cli/skill-sync.js';` | rojo | ✅ `not ok 5` con el mensaje `src/orchestrator/launch.js no debe importar el registro…`, 25 pass / 1 fail |

Ambas ediciones revertidas; `git diff --stat src/orchestrator/launch.js` vacío antes del commit.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **CAPT-05 satisfecho.** El operador que ejecute `kodo skill sync` recibe `/kodo-capture` en su HOME, y la generalización es **explícita**: allowlist en código, no descubrimiento por directorio.
- **Consecuencia conocida y aceptada (D-08b), registrada en `deferred-items.md`:** el auto-sync del orquestador (`src/orchestrator/launch.js`) sigue siendo single-skill. Quien solo use `kodo orchestrate` y **nunca** ejecute `kodo skill sync` no recibirá `/kodo-capture`. El trigger para cerrarlo es el primer operador que lo reporte.
- **Riesgo diferido con prioridad elevada (D-08 + A1):** `kodo-orchestrate/skill.md` sigue en minúsculas. Es **plausible y no verificable en macOS** que no cargue como skill en un filesystem case-sensitive. Esta fase mitiga la mitad que le toca (el gate acepta ambas grafías, así que `kodo-capture` se distribuye bien en Linux); el rename queda diferido porque tiene coste de migración en el HOME del operador.
- **Para Phase 85 (saneo):** endurecer `test/format-isolation.test.js` a imports transitivos — el walker ya existe en el fichero, falta medir el radio. Registrado en `deferred-items.md`.
- **Medición para 83-05:** el payload `--json` de `skill sync`, ya con `skills[]`, son **160 bytes**. Tres órdenes de magnitud por debajo del umbral de 64 KB, así que esta fase **no** abre el barrido del drenaje de stdout.
- **Pendiente de UAT humano (D6 del bloque `coverage`):** la tolerancia de case solo muerde en un filesystem case-sensitive. Si algún día hay CI en Linux, ese test es el que hay que mirar primero.

---
*Phase: 84-superficies-de-captura-skill-sync-conteo-ambient*
*Completed: 2026-07-26*

## Self-Check: PASSED

- Ficheros declarados en `key-files` presentes en disco: 5/5.
- Commits declarados presentes en `git log`: `06c00b3`, `e8abe91`, `a726eb8`.
- Criterios de aceptación de las 3 tareas re-ejecutados tras el último commit: todos PASS.
- `npm test` → 2 581 tests · 0 fail · 1 skipped.
- `~/.claude/skills/` real del operador con el mismo recuento y checksum que antes de empezar.
