---
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
plan: 02
subsystem: testing
tags: [claude-code-skills, inbox, capture, commander, golden-test, spawnSync]

requires:
  - phase: 83-inbox-foundation-captura-triage
    provides: "el writer único `kodo capture` (`runCaptureCli` con DI de idFn/clockFn/pathsFn), el codec `encodeLine`/`parseLine`, el vocabulario `--origin` (D-16) y el golden de formato `test/inbox-format-golden.test.js`"
provides:
  - "`.claude/skills/kodo-capture/SKILL.md` — la skill `/kodo-capture` con frontmatter cargable y `allowed-tools` estrecho"
  - "la invocación canónica `kodo capture --origin skill -- \"<texto>\"` congelada tras un marcador estable extraíble por test"
  - "`test/kodo-capture-skill.test.js` — 7 tests que blindan el contrato del markdown (4 estáticos + 2 de ejecución + 1 mordida)"
  - "el patrón `argvToCaptureOpts` + tokenizador shell-like para testear un contrato que vive en markdown"
affects: [84-01 (la allowlist KODO_SKILLS que distribuye esta skill), 84-03, verificación UAT de la fase 84]

tech-stack:
  added: []
  patterns:
    - "Testear un prompt por su cadena de comando: extraer el argv del markdown, congelarlo con deepEqual y ejecutarlo por dos vías complementarias"
    - "Detectores de contrato en markdown anclados a principio de línea, nunca a subcadena suelta (evita que la propia documentación ponga roja la suite)"
    - "Invariante de writer único comprobado en forma POSITIVA (unicidad + igualdad de argv), nunca por ausencia de una subcadena"

key-files:
  created:
    - .claude/skills/kodo-capture/SKILL.md
    - test/kodo-capture-skill.test.js
  modified: []

key-decisions:
  - "Placeholder `<texto>` (literal LOCKED de D-11) en vez de `$ARGUMENTS`: el modelo sustituye y escapa, que es lo que §Pitfall 3 recomienda frente a la sustitución cruda del shell"
  - "El carril in-process no toca el filesystem en absoluto: `appendFn` captura en memoria y los paths inyectados apuntan a un tmpdir que ni se crea"
  - "La fecha del carril child se deriva de la línea producida y solo se asserta su forma — nunca se recalcula con un segundo reloj (§Pitfall 10)"
  - "`KODO_BIN` se introdujo en la Task 2 (donde se usa) y no en la Task 1, para no dejar una constante muerta en el commit intermedio"

patterns-established:
  - "Contrato markdown↔test: marcador HTML estable + bloque cercado único + constante `ARGV_CANONICO` congelada"
  - "Disciplina de HOME obligatoria y declarada en la cabecera del fichero de test: sandbox vía `mkdtempSync` con `finally`+`rmSync`, o inyección de paths"

requirements-completed: [CAPT-02]

coverage:
  - id: D1
    description: "La skill `/kodo-capture` existe como skill de proyecto con frontmatter (`name`, `description`, `argument-hint`, `allowed-tools: Bash(kodo capture *)`) en `.claude/skills/kodo-capture/SKILL.md`"
    requirement: "CAPT-02"
    verification:
      - kind: unit
        ref: "test/kodo-capture-skill.test.js#frontmatter presente y `allowed-tools` con el patrón ESTRECHO (D-09, T-84-08)"
        status: pass
    human_judgment: false
  - id: D2
    description: "El fichero contiene exactamente una invocación y un solo bloque cercado — no hay un segundo camino de escritura (D-10, D-14 corolario)"
    requirement: "CAPT-02"
    verification:
      - kind: unit
        ref: "test/kodo-capture-skill.test.js#unicidad: exactamente UNA invocación en el fichero entero (corolario D-14)"
        status: pass
      - kind: unit
        ref: "test/kodo-capture-skill.test.js#un solo bloque cercado, y es el que sigue al marcador"
        status: pass
    human_judgment: false
  - id: D3
    description: "El argv extraído del markdown es exactamente `kodo capture --origin skill -- \"<texto>\"`; editarlo pone rojo el test"
    requirement: "CAPT-02"
    verification:
      - kind: unit
        ref: "test/kodo-capture-skill.test.js#igualdad de argv contra ARGV_CANONICO — la aserción de verdad (D-11)"
        status: pass
    human_judgment: false
  - id: D4
    description: "La línea del skill-path es byte-idéntica al golden de Phase 83 cambiando solo el origen a `skill`"
    requirement: "CAPT-02"
    verification:
      - kind: unit
        ref: "test/kodo-capture-skill.test.js#vía in-process — byte-identidad con el golden de Phase 83, cambiando SOLO el origen"
        status: pass
    human_judgment: false
  - id: D5
    description: "El argv sobrevive al commander real con un texto que empieza por guion, y la ausencia del separador `--` es un fallo duro observable"
    requirement: "CAPT-02"
    verification:
      - kind: integration
        ref: "test/kodo-capture-skill.test.js#vía child-process — commander real con un texto que empieza por guion (§Pitfall 4)"
        status: pass
      - kind: integration
        ref: "test/kodo-capture-skill.test.js#mordida — el MISMO argv sin el separador `--` falla duro (el `--` es load-bearing)"
        status: pass
    human_judgment: false
  - id: D6
    description: "El modelo carga la skill, la invoca mid-session y reporta el stderr verbatim ante un fallo — comportamiento de prompt"
    requirement: "CAPT-02"
    verification: []
    human_judgment: true
    rationale: "Un `SKILL.md` es un prompt: verificar que Claude Code lo carga, que `allowed-tools` evita el prompt de permiso (A2 de 84-RESEARCH.md) y que el modelo obedece las reglas de verbatim/parada exigiría ejecutar un LLM. Solo comprobable en UAT con una sesión real tras mergear 84-01."

duration: 41min
completed: 2026-07-26
status: complete
---

# Phase 84 Plan 02: Skill `/kodo-capture` Summary

**La skill de captura mid-session existe y su contrato es verificable: el test extrae la cadena de comando del propio markdown, la congela contra un argv canónico y la ejecuta por dos vías — la byte-identidad de CAPT-02 se hereda del writer único de Phase 83 en vez de reimplementarse.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-07-26T10:47:00Z
- **Completed:** 2026-07-26T11:28:00Z
- **Tasks:** 2 de 2
- **Files modified:** 2 (ambos nuevos)

## Accomplishments

- **`/kodo-capture` existe como skill de proyecto** en `.claude/skills/kodo-capture/SKILL.md`, con frontmatter completo (`name`, `description` en español con el «cuándo», `argument-hint`, `allowed-tools: Bash(kodo capture *)`) y un cuerpo de 33 líneas que hace una sola cosa: shellear el writer. Cero lógica, cero triage, cero derivación de proyecto.
- **El contrato del markdown está bajo test y su mordida está demostrada.** `test/kodo-capture-skill.test.js` aporta 7 tests: unicidad de la invocación, unicidad del bloque cercado, igualdad de argv contra `ARGV_CANONICO`, frontmatter con `allowed-tools` estrecho, byte-identidad in-process contra el golden de Phase 83, ejecución real contra commander con texto adversarial, y la mordida del separador.
- **La byte-identidad quedó probada, no razonada:** la vía in-process produce literalmente `- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · skill` — la forma 1 «abierta» del golden de Phase 83 con el único campo que esta fase cambia.
- **Suite completa verde sin regresión:** 2 563 tests · 0 fail (baseline 2 556 + los 7 nuevos), 1 skipped preexistente.

## Task Commits

1. **Task 1: Escribir el SKILL.md y las aserciones estáticas que congelan su contrato** — `e0bfda6` (feat)
2. **Task 2: Probar que el argv del markdown produce la línea del golden y sobrevive al commander real** — `91262a2` (test)

## Files Created/Modified

- `.claude/skills/kodo-capture/SKILL.md` — la skill `/kodo-capture`: frontmatter cargable, invocación canónica única precedida del marcador `<!-- kodo:capture:invocacion -->`, y siete reglas numeradas (un solo argumento, flags antes del `--`, texto verbatim, no derivar proyecto, preguntar si no hay texto, reportar stderr y parar, solo captura).
- `test/kodo-capture-skill.test.js` — 7 tests + los helpers `tokenize`, `argvToCaptureOpts`, `runKodo`, `sandboxHome` y las constantes `SKILL_MD`, `BLOCK_RE`, `INVOCATION_RE`, `FENCE_RE`, `PLACEHOLDER`, `ARGV_CANONICO`, `REPO`, `KODO_BIN`.

## Decisions Made

- **Placeholder `<texto>`, no `$ARGUMENTS`** (arbitraje ya declarado en el plan). Consecuencia conocida y aceptada: Claude Code anexa los argumentos como una línea `ARGUMENTS: <valor>` y es el modelo quien sustituye y escapa — exactamente lo que §Pitfall 3 recomienda frente al word-splitting de la sustitución cruda.
- **El carril in-process no hace un solo acceso al filesystem.** El plan pedía «`pathsFn` a paths de un tmpdir»; con `appendFn` capturando en memoria, crear el tmpdir sería un efecto sin lector. Los paths apuntan bajo `tmpdir()` a un directorio que nunca se crea: es estrictamente más seguro y no deja nada que limpiar.
- **`KODO_BIN` se introdujo en la Task 2**, donde se usa, en vez de en la Task 1. Dejarlo en el commit estático habría sido una constante muerta.

## Deviations from Plan

None — plan executed exactly as written. Las dos precisiones anotadas arriba (tmpdir no creado, `KODO_BIN` diferido a la Task 2) son discreción de implementación explícitamente cedida al ejecutor, no desviaciones del contrato.

**Total deviations:** 0
**Impact on plan:** ninguno. Cero ficheros de `src/` tocados (`git status --porcelain src/` vacío), `test/inbox-format-golden.test.js` sin modificar.

## Pruebas de mordida (exigidas por los criterios de aceptación)

Ambas ejecutadas sobre el fichero real, con backup y restauración byte-exacta verificada (`git diff --stat` vacío tras restaurar):

| Mordida | Edición | Resultado |
|---|---|---|
| 1 — separador | `kodo capture --origin skill "<texto>"` (sin `--`) | **rojo** en `igualdad de argv contra ARGV_CANONICO` → `# pass 3 / # fail 1`. Restaurado → `# pass 4 / # fail 0`. |
| 2 — segundo camino | segundo bloque cercado con `kodo capture --origin cli -- "otra variante"` | **rojo** en `unicidad` y en `un solo bloque cercado` → `# pass 2 / # fail 2`. Restaurado → `# pass 4 / # fail 0`. |

Evidencia complementaria del `--` load-bearing, medida contra el binario real con HOME sandbox:

```
kodo capture --origin skill -- "-3 % de conversión"   → exit 0 · línea escrita
kodo capture --origin skill    "-3 % de conversión"   → exit 1 · error: unknown option
```

## Disciplina de HOME — verificación exigida

El `~/.kodo/inbox.md` del operador **conserva su número de líneas**:

| Momento | `wc -l < ~/.kodo/inbox.md` |
|---|---|
| Antes de ejecutar los tests del plan | **0** |
| Tras `node --test test/kodo-capture-skill.test.js` | **0** |
| Tras `npm test` completo | **0** |

Ningún test del fichero toca el HOME real: el carril child sandboxea con `mkdtempSync` + `finally`/`rmSync`, y el carril in-process inyecta `pathsFn` y `appendFn`. La disciplina está declarada como obligatoria en la cabecera del fichero de test.

## Issues Encountered

Ninguno. La sonda inicial contra el binario real (con HOME sandbox) confirmó de una pasada tanto el comportamiento feliz como la mordida del separador, así que los tests se escribieron contra un comportamiento medido y no supuesto.

## Verificación ejecutada

- `node --test test/kodo-capture-skill.test.js` → **7 tests · 0 fail**.
- `node --test test/kodo-capture-skill.test.js test/inbox-format-golden.test.js test/inbox-cli.test.js` → **104 tests · 0 fail**.
- `npm test` → **2 563 tests · 580 suites · 0 fail · 1 skipped** (baseline 2 556 + 7 nuevos; regresión cero).
- `git status --porcelain src/` → vacío.
- Criterios de grep: invocación canónica ×1, marcador ×1, delimitadores de bloque ×2, `allowed-tools` ×1, `head -1` = `---`, 33 líneas (< 500), literal del golden ×1, `todayLocal` ×0, forma de fecha ×1, `HOME:` (1) ≥ `spawnSync(` (1).

## User Setup Required

None — no external service configuration required. Esta fase no instala ningún paquete (T-84-SC: tabla de legitimidad vacía).

## Next Phase Readiness

- **Listo para 84-01:** la skill ya existe en el path que la allowlist `KODO_SKILLS` va a distribuir. El plan 84-01 puede añadir `'kodo-capture'` al registro sin fixture pendiente.
- **Pendiente de UAT (no automatizable):** tras mergear 84-01 y ejecutar `kodo skill sync`, abrir una sesión de Claude Code en un repo cualquiera, invocar `/kodo-capture "prueba UAT 84"` y comprobar que `kodo inbox` muestra la línea con origen `skill` y el tag correcto. Cubre D6 del bloque `coverage` y la assumption A2 (que `Bash(kodo capture *)` casa la invocación con `--` y evita el prompt de permiso). Si A2 no se cumpliera, degrada la UX de fricción cero, **no** el contrato.
- **Sin bloqueos.**

## Threat Flags

Ninguno. Los ficheros creados no introducen endpoint de red, ruta de autenticación, patrón de acceso a ficheros ni cambio de esquema fuera de lo ya registrado en el `<threat_model>` del plan (T-84-06 a T-84-11 mitigados o aceptados según su disposición).

## Self-Check: PASSED

- `.claude/skills/kodo-capture/SKILL.md` — FOUND
- `test/kodo-capture-skill.test.js` — FOUND
- `.planning/phases/84-superficies-de-captura-skill-sync-conteo-ambient/84-02-SUMMARY.md` — FOUND
- commit `e0bfda6` — FOUND
- commit `91262a2` — FOUND

---
*Phase: 84-superficies-de-captura-skill-sync-conteo-ambient*
*Completed: 2026-07-26*
