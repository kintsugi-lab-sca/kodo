---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
plan: 02
subsystem: infra
tags: [cmux, workspace-group, session-manager, unicode-nfc, log-injection, fail-open, tdd]

# Dependency graph
requires:
  - phase: 77-workspace-groups-cmux
    provides: "deriveExpectedGroupName / resolveWorkspaceGroup / newWorkspaceWithGroupFallback (cadena fail-open GRP-01/02/03/04)"
provides:
  - "deriveExpectedGroupName endurecida: deriva sobre ref trimeado (IN-01) y fail-open null cuando el identifier derivado colapsa a vacío (WR-01)"
  - "resolveWorkspaceGroup con shape guard /^workspace_group:\\d+$/ sobre g.ref (IN-02, defensa contra forja de líneas de log)"
  - "launchWorkItem: llamada cmux workspace-group list guardada por if (expectedName) (IN-04) y log de degradación con motivo acotado (IN-03)"
  - "Red de regresión: invariante Unicode NFC (WR-02) y backstop del slice GRP-04 (IN-05); JSDoc de newWorkspace alineado con group? (IN-06)"
affects: [cmux, session-launch, workspace-grouping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-open explícito por eslabón: un null en deriveExpectedGroupName lanza la sesión SIN --group (nunca a un grupo arbitrario)"
    - "Shape guard de entrada externa (g.ref) antes de devolver/loguear — defensa contra log injection en el límite cmux→kodo"
    - "Guard de coste (if (expectedName)) para evitar llamadas cmux garantizadas-inútiles"

key-files:
  created: []
  modified:
    - src/session/manager.js
    - src/host/cmux.js
    - test/session/group-resolve.test.js
    - test/manager.test.js

key-decisions:
  - "Conservar el rechazo por typeof-string en deriveExpectedGroupName en vez del literal String(task?.ref ?? '') del plan — la coacción rompería el invariante preexistente ref:42/{} → null (19 tests)"
  - "El regex IN-02 usa exactamente /^workspace_group:\\d+$/ (según plan); acota shape anómalo y refs con contenido tras \\n"

patterns-established:
  - "Regresión Unicode con dientes: construir NFD via escapes explícitos (\\u0327) para garantizar diferencia byte-a-byte antes de normalizar"
  - "Backstop de slice: assert end > start ANTES de usar el body para que el regex negativo no pase vacuo si se reordenan funciones"

requirements-completed: ["77/WR-01", "77/WR-02", "77/IN-01", "77/IN-02", "77/IN-03", "77/IN-04", "77/IN-05", "77/IN-06"]

coverage:
  - id: D1
    description: "deriveExpectedGroupName deriva sobre ref trimeado y devuelve null cuando el identifier derivado colapsa a vacío ('#7'→null, '-9'→null, 'KODO-9 '→'KODO')"
    requirement: "77/WR-01"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#identifier derivado colapsa a vacío → null (WR-01)"
        status: pass
      - kind: unit
        ref: "test/session/group-resolve.test.js#trim del ref antes de derivar (IN-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveWorkspaceGroup rechaza g.ref anómalo (shape distinto o con \\n) vía /^workspace_group:\\d+$/ antes de devolverlo/loguearlo"
    requirement: "77/IN-02"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#IN-02: g.ref debe cumplir /^workspace_group:\\d+$/"
        status: pass
    human_judgment: false
  - id: D3
    description: "resolveWorkspaceGroup matchea name en NFD contra expectedName en NFC (invariante Unicode con red de regresión que se pone roja si se borra .normalize('NFC'))"
    requirement: "77/WR-02"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#WR-02: invariante Unicode NFC"
        status: pass
    human_judgment: false
  - id: D4
    description: "launchWorkItem no ejecuta host._legacy.listWorkspaceGroups() cuando expectedName es null (guard if (expectedName)) y el log de degradación incluye String(err?.message).slice(0,80)"
    requirement: "77/IN-04"
    verification:
      - kind: unit
        ref: "test/manager.test.js#Phase 77 (GRP-01/GRP-03): launchWorkItem resuelve el grupo (asserts IN-04 + IN-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "JSDoc de _legacy.newWorkspace documenta group?: string y el backstop assert end > start protege el slice GRP-04"
    requirement: "77/IN-06"
    verification:
      - kind: unit
        ref: "test/manager.test.js#Phase 77 (GRP-04): buildSessionFromTask NO gana ningún campo de grupo (assert end > start)"
        status: pass
    human_judgment: false

# Metrics
duration: 4min
completed: 2026-07-21
status: complete
---

# Phase 78 Plan 02: Endurecer resolución de grupos cmux (77-REVIEW fixes) Summary

**Cierre de tres modos de fallo silencioso en la resolución de grupos cmux — identifier bogus, ref anómalo (log injection) y pérdida de grupo por whitespace de borde — más guard de coste, log diagnosticable, JSDoc alineado y red de regresión Unicode/slice; fail-open GRP-03 y D-10 intactos.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-07-21T23:33:46Z
- **Completed:** 2026-07-21T23:37:10Z
- **Tasks:** 2 (Task 1 TDD)
- **Files modified:** 4

## Accomplishments
- `deriveExpectedGroupName` deriva sobre `ref` trimeado (IN-01) y fail-open a `null` cuando el identifier derivado colapsa a vacío (`'#7'`→null, `'-9'`→null), impidiendo que un ref bogus matchee un grupo whitespace-only (WR-01).
- `resolveWorkspaceGroup` exige `/^workspace_group:\d+$/` sobre `g.ref` antes de devolverlo — un ref anómalo de cmux (otro shape o con `\n`) queda rechazado antes de loguearse (IN-02, defensa contra forja de líneas de log).
- `launchWorkItem` guarda la llamada `host._legacy.listWorkspaceGroups()` tras `if (expectedName)` (evita la llamada cmux garantizada-inútil, IN-04) y su `catch (err)` adjunta `String(err?.message).slice(0,80)` al log de degradación (IN-03, D-11 preservado).
- Red de regresión añadida: invariante Unicode NFC↔NFD con dientes (WR-02), backstop `end > start` del slice GRP-04 (IN-05) y JSDoc de `newWorkspace` con `group?: string` (IN-06).

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): casos de regresión** - `70f6fce` (test)
2. **Task 1 (GREEN): endurecer funciones puras** - `048ed60` (feat)
3. **Task 2: guard IN-04 + log IN-03 + JSDoc IN-06 + backstop IN-05** - `428d78a` (feat)

**Plan metadata:** (docs commit — this SUMMARY + STATE/ROADMAP)

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified
- `src/session/manager.js` - `deriveExpectedGroupName` (trim + guard identifier vacío), `resolveWorkspaceGroup` (shape guard), bloque de resolución en `launchWorkItem` (guard + log con motivo)
- `src/host/cmux.js` - JSDoc de `_legacy.newWorkspace` con `group?: string`
- `test/session/group-resolve.test.js` - casos WR-01/IN-01/IN-02/WR-02
- `test/manager.test.js` - backstop `end > start` (IN-05) + source-hygiene IN-04/IN-03

## Decisions Made
- **typeof-string guard sobre `String()` coerción:** El plan (Task 1, step 3) especifica `const ref = String(task?.ref ?? '').trim()`. Aplicarlo literal rompería el invariante preexistente `ref:42 → null` y `ref:{} → null` (coacciona `42`→`'42'`, `{}`→`'[object Object]'` → identifier bogus). Se conservó `if (typeof rawRef !== 'string') return null; const ref = rawRef.trim();` — cumple IN-01 (trim antes de derivar) y WR-01 (guard del identifier vacío) SIN regresar los 19 tests preexistentes. Ver Deviations.
- El regex IN-02 se dejó exactamente como el plan lo pide (`/^workspace_group:\d+$/`); cubre el caso del test (`\ninject` tras el número). Un ref con solo `\n` final es un edge no ejercido y fuera del scope acordado.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preservar el rechazo por tipo en `deriveExpectedGroupName` en vez de la coerción `String()`**
- **Found during:** Task 1 (endurecer funciones puras)
- **Issue:** El plan indica derivar `ref` con `String(task?.ref ?? '').trim()`. Aplicado literal, `ref:42` y `ref:{}` dejan de ser `null` (se coaccionan a `'42'` / `'[object Object]'` → identifier no vacío), regresando dos de los 19 tests preexistentes (`no-string (número) → null`, `no-string (objeto) → null`) que el propio plan exige mantener verdes (`must_haves.truths`).
- **Fix:** Mantener el guard `if (typeof rawRef !== 'string') return null;` y luego `const ref = rawRef.trim();`. Cumple IN-01 (trim) y WR-01 (identifier derivado vacío → null) sin coaccionar no-strings.
- **Files modified:** src/session/manager.js
- **Verification:** `node --test test/session/group-resolve.test.js` → 37/37 pass (incl. los 2 casos no-string y los nuevos WR-01/IN-01).
- **Committed in:** `048ed60`

---

**Total deviations:** 1 auto-fixed (1 bug/regresión evitada)
**Impact on plan:** El fix respeta la intención declarada (trim IN-01 + guard WR-01) y prioriza el invariante `must_haves` (19 tests verdes) sobre la forma literal del snippet. Sin scope creep.

## Issues Encountered
- Los literales NFD/NFC en el test WR-02 eran indistinguibles byte-a-byte al escribirse como caracteres precompuestos en el fichero. Se reconstruyeron con escapes explícitos (`'Trac' + '̧' + 'a'` vs `'Tra' + 'ç' + 'a'`) para garantizar `assert.notEqual(nameNFD, expectedNFC)` antes de normalizar. Resuelto.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Los 8 hallazgos accionables de 77-REVIEW quedan saldados; cero dependencias nuevas.
- `newWorkspaceWithGroupFallback` (D-10) y los guards GRP-04 intactos (verificado por diff y source-hygiene).
- IN-07 (retry D-10 duplica workspace ante timeout) permanece como riesgo residual LOCKED, fuera de scope.
- Suite completa verde: `npm test` → 2296 pass / 0 fail / 1 skip.

## Self-Check: PASSED

---
*Phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review*
*Completed: 2026-07-21*
