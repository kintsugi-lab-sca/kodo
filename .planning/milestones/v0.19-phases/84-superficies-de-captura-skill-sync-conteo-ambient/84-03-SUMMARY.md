---
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
plan: 03
subsystem: ui
tags: [tui, ink, dashboard, inbox, filesystem-leaf, anti-drift, regex, never-throws]

# Dependency graph
requires:
  - phase: 83-inbox-foundation-captura-triage
    provides: "El formato de línea congelado (`LINE_RE`, `src/inbox/store.js:126`), `listCaptures` como lector canónico y never-throws, y la semántica abierta/cerrada del checkbox (D-05)"
  - phase: 75-live-columns
    provides: "El molde `src/cli/dashboard/tasks.js` — leaf HOME-relative con la tríada de DI, y el patrón de prop `readTasksFn` con default real en App.js"
provides:
  - "`src/cli/dashboard/inbox-count.js` — leaf puro, síncrono y never-throws que cuenta las capturas ABIERTAS de `~/.kodo/inbox.md` y devuelve un `number`"
  - "El test anti-drift que ancla ese leaf a `listCaptures` sobre el mismo fixture: la deriva entre los dos lectores es un fallo de suite, no un riesgo latente"
  - "El conteo pintado como tercer hijo de la cabecera de `SessionTable`, oculto en 0"
  - "Un harness de render con ancho de terminal FIJABLE (stdout propio al `render` de ink), que `ink-testing-library` no permite"
affects: [phase-85-hardening-guard-transitivo, futuras superficies ambient del dashboard, CAPT-F2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Leaf de filesystem dentro del TUI: tríada de DI `readFileFn`/`kodoDir`/`homedirFn`, resolución perezosa del HOME, `try` de cuerpo entero con `catch` sin binding, y solo builtins"
    - "Anti-drift por oráculo: cuando el aislamiento obliga a duplicar una gramática, un test ancla las dos copias sobre el mismo fixture y convierte la deriva en rojo de suite"
    - "Backstop de overflow con ancho de terminal fijado por stdout propio pasado al `render` de ink"

key-files:
  created:
    - src/cli/dashboard/inbox-count.js
    - test/dashboard-inbox-count.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js

key-decisions:
  - "La regex del leaf es la especialización a línea ABIERTA de `LINE_RE`, no un prefijo de checkbox: la mordida se midió, no se supuso (7 vs 2 sobre el fixture adversarial)"
  - "El backstop de overflow se CIERRA en vez de diferirse: el ancho se fija con un stdout propio al `render` de ink, sin inventar aritmética de ancho en producción"
  - "Los siete ficheros de test de dashboard existentes no se tocan; el default `inboxOpen = 0` en SessionTable es lo que los mantiene verdes"

patterns-established:
  - "Duplicación deliberada + test de anclaje: el aislamiento de un grafo de imports se paga con una copia, y la copia se blinda con un oráculo"
  - "Todo dato ausente degrada al MISMO silencio: inexistente, ilegible, vacío y 0 abiertas resuelven a la cabecera de hoy sin un byte de más"

requirements-completed: [CAPT-07]

coverage:
  - id: D1
    description: "El leaf cuenta exactamente lo mismo que `listCaptures` sobre fixtures adversariales y de volumen — la deriva entre los dos lectores es un fallo de suite (D-17 + D-18)"
    requirement: CAPT-07
    verification:
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#coinciden EXACTAMENTE sobre el fixture adversarial, y el valor absoluto es 2"
        status: pass
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#coinciden sobre el fixture de regresión de 1 500 capturas (83-05)"
        status: pass
    human_judgment: false
  - id: D2
    description: "El leaf nunca lanza: fichero ausente, EACCES, un directorio en vez de un fichero y contenido binario cuentan 0 (D-20)"
    requirement: CAPT-07
    verification:
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#fichero ausente / EACCES / directorio / binario → 0, y ninguno lanza"
        status: pass
    human_judgment: false
  - id: D3
    description: "El leaf resuelve su path perezosamente: dos `kodoDir` distintos dan conteos distintos en el mismo proceso, y `homedirFn` aísla el HOME (D-19)"
    requirement: CAPT-07
    verification:
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#dos kodoDir distintos dan conteos distintos EN EL MISMO PROCESO"
        status: pass
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#con `homedirFn` inyectado resuelve bajo ese HOME simulado"
        status: pass
    human_judgment: false
  - id: D4
    description: "El conteo es estrictamente de solo lectura y tolera una lectura que cruza un `O_APPEND` concurrente: la línea parcial no casa la regex y no se cuenta (CAPT-07, T-84-18)"
    requirement: CAPT-07
    verification:
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#una lectura que cruza un O_APPEND observa una línea parcial que NO se cuenta"
        status: pass
      - kind: unit
        ref: "test/dashboard-inbox-count.test.js#el único acceso al filesystem es de LECTURA: contenido y mtime intactos"
        status: pass
    human_judgment: false
  - id: D5
    description: "El dashboard pinta `   {N} sin enrutar` en amarillo como tercer hijo del header, después del indicador de conexión (D-22)"
    requirement: CAPT-07
    verification:
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#poblado: con 4, el frame trae la copy Y el indicador sigue ANTES en la misma línea"
        status: pass
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#zero-one-many: con 1 la copy es la misma, sin ninguna rama de plural"
        status: pass
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#long-text: con 1500 el entero va CRUDO, sin separador de millares ni abreviación"
        status: pass
    human_judgment: false
  - id: D6
    description: "Con 0 capturas abiertas el elemento no se emite y la cabecera queda byte-idéntica a la actual (D-23)"
    requirement: CAPT-07
    verification:
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#la cabecera con inboxOpen=0 es BYTE-IDÉNTICA a la cabecera sin la prop"
        status: pass
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#el frame de App no contiene la copy ni un 0 en esa posición"
        status: pass
    human_judgment: false
  - id: D7
    description: "En terminal estrecho el indicador de conexión conserva su posición y el conteo, último hijo, es lo que ink envuelve — sin aritmética de anchos (backstop de 84-UI-SPEC)"
    requirement: CAPT-07
    verification:
      - kind: automated_ui
        ref: "test/dashboard-inbox-count.test.js#en terminal estrecho el indicador degradado conserva su posición y el conteo es lo que envuelve"
        status: pass
    human_judgment: false
  - id: D8
    description: "El leaf no arrastra el paquete de color al grafo de imports del TUI (T-84-17)"
    requirement: CAPT-07
    verification:
      - kind: unit
        ref: "test/format-isolation.test.js#ningún archivo de src/cli/dashboard/ importa picocolors"
        status: pass
      - kind: other
        ref: "grep -cE \"^import .* from 'node:(fs|path|os)';$\" src/cli/dashboard/inbox-count.js → 3 (= total de imports)"
        status: pass
    human_judgment: false
  - id: D9
    description: "El conteo aparece y desaparece según se capture y se triaje sobre el inbox real, y su lectura ambient no estorba la cabecera"
    requirement: CAPT-07
    verification: []
    human_judgment: true
    rationale: "La adecuación ambient del conteo —que genere presión de triage sin robar la atención de la cabecera— es un juicio perceptual sobre un TUI real, con el inbox real del operador y capturas reales. Ningún assert de frame lo cubre. El ciclo `kodo capture` ×3 → dashboard → `kodo inbox discard` ×3 → el conteo DESAPARECE en vez de mostrar 0 requiere una sesión interactiva."

# Metrics
duration: 14 min
completed: 2026-07-26
status: complete
---

# Phase 84 Plan 03: Conteo ambient de capturas sin enrutar Summary

**Leaf de filesystem never-throws que cuenta las capturas abiertas de `~/.kodo/inbox.md` con la especialización a línea abierta de `LINE_RE`, anclado por test al lector canónico, y pintado en amarillo como tercer hijo de la cabecera del dashboard — invisible cuando el conteo es 0.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-26T08:52:00Z
- **Completed:** 2026-07-26T09:06:00Z
- **Tasks:** 2
- **Files modified:** 4 (2 creados, 2 modificados)

## Accomplishments

- **La mordida de la regex de prefijo está MEDIDA, no supuesta.** El test anti-drift se escribió antes que el leaf; con la regex de prefijo que la redacción original de D-17 describía en prosa, el leaf contó **7** y el oráculo **2** sobre el fixture adversarial. Con la especialización de `LINE_RE`, **2 y 2**. La corrección post-research de D-17 queda justificada por evidencia reproducible en la suite.
- **El leaf está aislado del store Y anclado a él.** Tres imports, los tres builtins: importar `src/inbox/store.js` habría metido el paquete de color en el grafo del TUI por vía transitiva, y el guard de aislamiento —que solo mira imports directos— no lo habría detectado. La duplicación que ese aislamiento cuesta la paga el test anti-drift, que la convierte en rojo de suite.
- **Todo dato ausente degrada al mismo silencio.** Fichero inexistente, ilegible, un directorio en vez de un fichero, contenido binario, y 0 capturas abiertas resuelven todos a la cabecera de hoy, byte a byte. Comprobado contra la cabecera de REFERENCIA, no solo por ausencia de subcadena.
- **El backstop de overflow queda CERRADO, no diferido.** El plan autorizaba dejarlo declarado si el harness no permitía fijar el ancho. `ink-testing-library` fija `columns` en un getter de 100 sin override, pero un stdout propio pasado al `render` de ink sí lo permite: a 40 columnas, con la rama degradada del indicador, el indicador conserva su posición al inicio de la cabecera y el conteo —último hijo— es lo que ink envuelve. Cero aritmética de anchos en producción.
- **Cambio quirúrgico:** dos líneas de código en `SessionTable.js`, tres en `App.js`. Cero timers, cero teclas, cero endpoints, cero deps, y los siete ficheros de test de dashboard existentes intactos y verdes.

## Task Commits

1. **Task 1: El test anti-drift dicta la regex, y solo después el leaf** — `c661cb2` (feat)
2. **Task 2: Cablear el conteo al render y pintarlo en la cabecera** — `f45f2f1` (feat)

## Files Created/Modified

- `src/cli/dashboard/inbox-count.js` *(nuevo)* — el leaf. Export único `readOpenCaptureCount(deps)` que devuelve un `number`, y la constante de módulo `OPEN_LINE_RE`. Tres imports builtin, `try` de cuerpo entero, resolución perezosa del HOME dentro de la función.
- `test/dashboard-inbox-count.test.js` *(nuevo)* — 13 tests: anti-drift adversarial (con valor absoluto, no solo igualdad), anti-drift sobre 1 500 capturas, never-throws en cuatro modos, resolución perezosa, lectura parcial concurrente, solo-lectura con `mtime` intacto, y 6 de render.
- `src/cli/dashboard/App.js` — import del leaf, prop `inboxCountFn` con default real, `const inboxOpen = inboxCountFn({})` en el cuerpo del render junto a `tasks`, y la propagación a `SessionTable`.
- `src/cli/dashboard/SessionTable.js` — prop `inboxOpen = 0` con su entrada de JSDoc, y el tercer hijo condicional del header.

## Decisions Made

- **El conteo se calcula donde se calcula `tasks`, no donde se calculan los flags `any*`.** Los `any*` se derivan del set SIN filtrar precisamente porque derivan del conjunto de sesiones y parpadearían bajo una query `/`. El conteo se deriva del filesystem, así que ese problema no existe. De los `any*` hereda la política de COLAPSO en el render, no el lugar del cálculo.
- **El backstop de overflow se cierra con un harness nuevo en vez de diferirse.** La alternativa autorizada por el plan era declararlo sin cerrar; medir el wrap real a 40 columnas cuesta ~30 líneas de test y no toca producción, así que se cerró. El harness (stdout propio al `render` de ink) queda disponible para cualquier futura aserción de ancho del TUI.
- **Los siete ficheros de test de dashboard existentes no se tocan.** Siguen verdes porque sus asserts son de coincidencia parcial y el default de `inboxOpen` es 0. **Hecho conocido y aceptado, registrado aquí como observación del research:** esos siete ficheros renderizan `App` sin sandboxear `HOME`, así que con el default real del leaf leerán el `~/.kodo/inbox.md` del desarrollador que ejecute la suite. No tiene efecto sobre sus asserts (un texto extra en el header no rompe un `assert.match`), pero es una no-hermeticidad latente. El fichero nuevo inyecta `inboxCountFn` en **todos** sus tests de render.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] El fichero de test se commiteó como BINARIO por bytes de control literales**

- **Found during:** Task 1 (justo tras el primer commit)
- **Issue:** el fixture de contenido binario del test never-throws se escribio con bytes NUL **literales** en el fuente. Git clasifico `test/dashboard-inbox-count.test.js` como binario (`Bin 0 -> 11245 bytes`): el fichero quedaba sin diff, sin blame util y sin revision posible en un PR. Contradice ademas la convencion explicita del repo, que en `progress.js:33` documenta usar el escape `\uFEFF` en vez del BOM literal «para mantener la fuente sin caracteres invisibles».
- **Fix:** el fixture pasa a usar secuencias de escape (`\u0000`, `\uFFFD`) en el fuente. En disco se siguen escribiendo los mismos bytes reales, asi que el test conserva su mordida; lo que cambia es que el fuente queda ASCII y diffable. Comentario en el test explicando por que los bytes de control van escapados.
- **Files modified:** `test/dashboard-inbox-count.test.js`
- **Verification:** sonda que recorre el fichero buscando bytes de control literales → 0; `git show --stat` pasa de `Bin` a `261 +++`; los 7 tests siguen verdes.
- **Committed in:** `c661cb2` (amend del commit de Task 1)

---

**Total deviations:** 1 auto-fixed (1 bug).
**Impact on plan:** ninguno sobre el alcance. El arreglo no cambia ni una aserción; solo devuelve el fichero al carril de texto revisable.

### Criterios de aceptación con redacción inaplicable (no son huecos de implementación)

Tres criterios del plan están redactados como `grep` que ningún fichero puede satisfacer literalmente. El **intent** de los tres se cumple; se documenta la discrepancia para que la auditoría no la lea como un hueco:

1. **«las líneas de `homedir` deben ser todas posteriores a la línea del `export function`»** — inaplicable: la sentencia `import { homedir } from 'node:os'` tiene que ir en la cabecera del módulo, así que siempre precede al export. La implementación de referencia del propio research (§Code Example 4) tiene la misma forma. **Intent verificado:** la única línea de CÓDIGO que invoca `homedir()` es la `:92`, indentada dentro del cuerpo del export (`:88`); las demás apariciones son el import y prosa de comentario/JSDoc. Comprobado con una sonda que descarta líneas de comentario.
2. **«`grep -c "picocolors" src/cli/dashboard/SessionTable.js` devuelve 0»** — inaplicable: el fichero YA contenía **10** menciones de `picocolors` **antes** de esta fase, todas en comentarios que documentan el invariante de color-isolation. **Intent verificado:** cero *imports* de picocolors (`grep -cE "^import .*picocolors"` → 0), que es el invariante real y el que `test/format-isolation.test.js` guarda. El conteo se dejó en las 10 preexistentes: la redacción del comentario nuevo se ajustó para no añadir una mención más.
3. **«`npm test` sin regresión respecto al baseline (2 556 tests)»** — la cifra del plan es anterior a 84-02. El baseline vigente al arrancar este plan era **2 563 · 0 fail · 1 skipped**; el resultado es **2 576 · 0 fail · 1 skipped** = 2 563 + los 13 tests nuevos. Regresión cero.

Además, el criterio **«`grep -c "sin enrutar"` devuelve exactamente 1»** sí se cumple literalmente, pero obligó a reformular el JSDoc y el comentario del header para que no repitieran la copy: un único punto de pintado también significa una única aparición del literal en el fichero.

## Issues Encountered

- **La primera versión del backstop de overflow falló por una aserción mal formulada, no por el código.** Asumí que al colapsar el whitespace los fragmentos del conteo quedarían contiguos (`4 sin enrutar`); en realidad ink envuelve el último hijo intercalando las columnas hermanas (`4 sin` en la 1ª línea, `enrutar` en la 2ª, con `1 review` en medio). La aserción se reformuló para comprobar lo que de verdad importa: que el indicador conserva su posición, que los dos fragmentos del conteo siguen enteros y que ni el conteo ni el indicador se truncan con elipsis. El comportamiento de producción era correcto desde el principio.

## Verificación

| Comprobación | Resultado |
|---|---|
| `node --test test/dashboard-inbox-count.test.js` | 13 tests · 0 fail (7 de leaf + 6 de render) |
| `node --test test/format-isolation.test.js` | verde — el leaf pasa el guard de color automáticamente |
| `node --test dashboard-{status-line,table,render}.test.js` | verde **sin modificar** esos ficheros |
| `npm test` | **2 576 tests · 0 fail · 1 skipped** (baseline 2 563 + 13) |
| `git status --porcelain src/inbox/store.js src/cli/dashboard/usePoll.js src/server.js` | vacío — los tres ficheros congelados intactos |
| `git status --porcelain test/dashboard-*.test.js` | solo `test/dashboard-inbox-count.test.js` |
| Teclas nuevas | 0 — el diff no toca ningún manejador de input ni el keybar |
| `wc -l ~/.kodo/inbox.md` antes / después | **0 / 0** (0 bytes, `mtime` sin cambiar) — el inbox real del operador no se tocó |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **CAPT-07 satisfecho.** El operador ve la presión de triage como superficie ambient, con cero endpoints nuevos en `src/server.js`.
- **Pendiente de UAT humano (D9 del bloque `coverage`):** el ciclo `kodo capture "x"` ×3 → abrir el dashboard → comprobar que el conteo aparece junto al indicador → `kodo inbox discard <id>` ×3 → comprobar que **desaparece** en vez de mostrar `0`.
- **Deuda registrada para Phase 85 (ya prevista en el `<threat_model>`, T-84-17):** endurecer `test/format-isolation.test.js` a imports **transitivos** reutilizando el `walkImports` que ya vive en ese fichero. Hoy el aislamiento de color depende de que nadie escriba el import; con el walker dependería de la suite. Esta fase lo esquiva por disciplina, no por guard.
- **Riesgo aceptado conscientemente (T-84-16):** la lectura corre en el cuerpo del render, es decir en cada pulsación de tecla. Coste medido: décimas de milisegundo hasta 1 500 capturas. **No cachear, no memoizar** — está documentado en el JSDoc del leaf para que un futuro optimizador sepa que ya se midió. El volumen extremo queda cubierto por CAPT-F2, diferido a v2.
- **No-hermeticidad latente:** los siete ficheros de test de dashboard existentes leen el inbox real del desarrollador. Sin efecto sobre sus asserts hoy; el cambio mínimo si alguna vez molesta es una línea (`inboxCountFn: () => 0`) por fichero.

---
*Phase: 84-superficies-de-captura-skill-sync-conteo-ambient*
*Completed: 2026-07-26*

## Self-Check: PASSED

- Ficheros declarados en `key-files` presentes en disco: 4/4 (`inbox-count.js`, `dashboard-inbox-count.test.js`, `App.js`, `SessionTable.js`).
- Commits de tarea localizables en el historial: 2/2 (`c661cb2`, `f45f2f1`).
- Criterios de aceptación de ambas tareas re-ejecutados tras el último commit: todos verdes (las tres discrepancias de redacción quedan documentadas arriba, con su intent verificado).
- `<verification>` del plan re-ejecutada: `npm test` → 2 576 · 0 fail · 1 skipped.
