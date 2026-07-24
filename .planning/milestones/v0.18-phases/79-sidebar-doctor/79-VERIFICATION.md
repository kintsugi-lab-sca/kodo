---
phase: 79-sidebar-doctor
verified: 2026-07-23T11:31:07Z
status: passed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 5/6
  gaps_closed:

    - "G-79-1 (blocker): kodo sidebar doctor --fix ya no ancla un grupo recién creado en una sesión kodo viva (absorción de identidad del anchor). execute() eliminó por completo el bucle missing_group -> create/set-anchor; missing_group pasa a report-only/advisory (hasAdvisories); hasActions ya no lo cuenta. Ratificado por checkpoint:decision (Opción A) en 79-04-PLAN.md, verificado por test de regresión y por inspección de código."
  gaps_remaining: []
  regressions: []
behavior_unverified_items:

  - truth: "SDR-05: una sesión kodo suelta cuyo grupo esperado YA EXISTE converge a member_workspace_refs de ese grupo tras `kodo sidebar doctor --fix` real (round-trip completo por el binario kodo, no solo el verbo cmux crudo)."
    test: "Con >=1 sesión kodo real cuyo workspace esté suelto de un grupo ya existente, correr `node src/cli.js sidebar doctor` (debe listar `add`), luego `node src/cli.js sidebar doctor --fix`, luego `cmux workspace-group list --json` y confirmar que el workspace aparece en member_workspace_refs; una 2ª pasada del dry-run debe salir limpia (exit 0)."
    why_human: "Requiere mutar el sidebar cmux real; el 2026-07-23 no existía ninguna sesión kodo suelta con grupo ya existente para ejercitar el round-trip sin fabricar estado en el sidebar del operador desde una cadena autónoma. El verbo `cmux workspace-group add` en sí YA se validó manualmente en 79-UAT.md (A2, pass) y el argv exacto que emite `execute()` está probado por spy en unit — pero el camino completo vía `kodo sidebar doctor --fix` end-to-end contra un cmux vivo queda sin ejercitar."
human_verification:

  - test: "Con >=1 sesión kodo real cuyo workspace esté suelto de un grupo ya existente, correr `node src/cli.js sidebar doctor` (debe listar `add`), luego `node src/cli.js sidebar doctor --fix`, luego `cmux workspace-group list --json`."
    expected: "El workspace de la sesión suelta aparece en member_workspace_refs del grupo esperado; una 2ª pasada del dry-run sale exit 0 (converged); ningún workspace no-kodo del operador fue movido o re-anclado (D-04); NINGUNA sesión viva pierde su fila/título (no debe aparecer ningún grupo nuevo creado — G-79-1 ya no debería poder reproducirse porque execute() no emite create/set-anchor)."
    why_human: "Requiere mutar el sidebar cmux real; los verbos del allowlist no se ejecutan contra un binario cmux vivo en unit tests (DI/spy solamente). El 2026-07-23 (dry-run en vivo, read-only) el sidebar del operador estaba limpio (protected: 1 sesión, 0 loose/missing/empty) — no hay estado de deriva disponible para ejercitar la rama mutante sin fabricarlo artificialmente."
gaps: []
---

# Phase 79: Sidebar Doctor Verification Report

**Phase Goal:** `kodo sidebar doctor` quita al humano y al launch path la carga de mantener el sidebar de cmux: un doctor determinista (espejo de `src/gsd/doctor.js` — `scan` + `execute`, dry-run por defecto / `--fix`, 0 tokens) detecta y corrige grupos que faltan, workspaces sueltos con grupo esperado (`add`), grupos disueltos por cierre de su anchor y grupos vacíos (`ungroup`). La gestión de grupos pasa a estar permitida SOLO en este carril, con allowlist.

**IMPORTANTE — política ratificada durante gap closure (G-79-1):** el texto literal del ROADMAP (`create` auto-arreglable / `set-anchor` al miembro más longevo) fue SUPERADO por un checkpoint bloqueante ratificado por el operador en el plan 79-04. `missing_group` pasa a **report-only/advisory**: `execute()` ya NO emite `create` ni `set-anchor` bajo ninguna rama — el doctor nunca ancla un grupo en una sesión kodo viva (causa raíz del blocker G-79-1: en cmux 0.64.20 el header del grupo ES la fila sidebar del anchor). Esta verificación evalúa el código contra la política RATIFICADA, no contra el texto literal pre-gap-closure del ROADMAP.

**Verified:** 2026-07-23
**Status:** human_needed
**Re-verification:** Sí — tras el cierre del gap G-79-1 (plan 79-04)

## Goal Achievement

### Observable Truths

| # | Truth (re-scopeada a la política ratificada) | Status | Evidencia |
|---|---|--------|-----------|
| 1 | SDR-01: `kodo sidebar doctor` (dry-run) lista las 3 categorías clasificadas (missing_group=advisory, loose_workspace→add, empty_group→ungroup) sin ejecutar nada | ✓ VERIFIED | `renderHuman`/`renderAdvisory` en `src/cli/sidebar-doctor.js`; `test/cli/sidebar-doctor-cli.test.js` (dry-run nunca llama executeFn); ejecutado en vivo read-only 2026-07-23 11:2x contra el cmux real del operador: `node src/cli.js sidebar doctor` → render coherente ("Grupos faltantes (advisory...): none · Workspaces sueltos: none · Grupos vacíos: none · protected: 1 · clean"), exit 0 |
| 2 | SDR-02: `--fix` ejecuta EXCLUSIVAMENTE el allowlist no-destructivo; `delete`/`remove`/`rename` de workspace-group NO están cableados (guard mecánico); superficie REDUCIDA aún más por el gap closure — `create`/`set-anchor` ya NUNCA se emiten | ✓ VERIFIED | `test/sidebar-doctor-hygiene.test.js` guard + detector-no-trivial (17/17 pass); `src/cmux/sidebar-doctor.js` execute() no contiene el bucle missing_group (código inspeccionado línea 369-373: comentario explícito + ausencia del bucle); test de regresión G-79-1 en `test/cmux/sidebar-doctor.test.js` confirma `calls` vacío de create/set-anchor con spy |
| 3 | SDR-05 (re-scopeada): una sesión kodo suelta cuyo grupo esperado YA EXISTE converge vía `add`; un grupo faltante es un ADVISORY (no auto-arreglable) — el operador crea el grupo una vez y el doctor lo mantiene poblado | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | El código está presente, wireado y probado a nivel unit con spy de argv (`test/cmux/sidebar-doctor.test.js`, 22/22, incluye loose→add, empty→ungroup, TOCTOU, idempotencia); el verbo crudo `cmux workspace-group add` fue validado manualmente contra cmux real en 79-UAT.md (A2: pass); pero el round-trip COMPLETO vía `kodo sidebar doctor --fix` real (binario kodo, no el verbo cmux aislado) no fue ejercitado — no había ninguna sesión suelta real el día de esta verificación (dry-run en vivo: 0 loose_workspace) |
| 4 | SDR-04: el golden del launch path sigue byte-idéntico — `--group` solo si el grupo ya existe, fail-open en 2 capas, GRP-01..03 intactos, launch nunca gestiona grupos | ✓ VERIFIED | `src/session/manager.js` sin commits de la Phase 79 (`git log -- src/session/manager.js` confirma último touch en `e1bdb01`, Phase 78); `test/manager.test.js` + `test/session/group-resolve.test.js` pasan sin modificación; `test/sidebar-doctor-hygiene.test.js` SDR-04 (3 tests) afirma forma literal de `newWorkspaceWithGroupFallback`/`buildNewWorkspaceArgs` |
| 5 | SDR-03/SDR-06: detección 100% determinista y 0 tokens; CLI espejo de `gsd doctor` con `--json` byte-determinista (incluye `hasAdvisories` en el shape) y exit codes deterministas | ✓ VERIFIED | `src/cmux/sidebar-doctor.js` no importa provider/LLM/logger.js (source assertion test pasa); `node src/cli.js sidebar doctor --json` en vivo produce `{"missing_group":[],"loose_workspace":[],"empty_group":[],"protected":{...},"hasActions":false,"hasAdvisories":false}`, exit 0; `test/cli/sidebar-doctor-cli.test.js` --json TTY/no-TTY idéntico sin `\x1b[`; `exitCode = report.hasActions ? 1 : 0` calculado antes del render (hasActions excluye missing_group) |
| 6 | G-79-1 (gap closure): `execute()` NUNCA emite `create` ni `set-anchor` anclado en el workspace_ref de una sesión kodo viva — cero absorción de identidad | ✓ VERIFIED | Código inspeccionado: el bucle `for (const g of report.missing_group)` fue eliminado de `execute()` (queda solo un comentario explicando por qué); `createWorkspaceGroup`/`setGroupAnchor` permanecen en `resolveDeps` únicamente para que los tests los espíen (nunca se invocan en el cuerpo de `execute`); test de regresión dedicado en `test/cmux/sidebar-doctor.test.js` pasa; addendum "Post-UAT correction (G-79-1)" en `79-RESEARCH.md` documenta el modelo header-is-anchor y la supersesión ratificada de D-07/D-08 |

**Score:** 5/6 truths verificados (1 presente y cableado a nivel unit + parcialmente validado en vivo con el verbo crudo, pero sin round-trip completo del binario kodo)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cmux/client.js` | 4 passthroughs allowlist + `listWorkspacesJson` + docstring GRP-04 re-fronterizado | ✓ VERIFIED | Los 5 `export async function` presentes; docstring re-fronterizado en línea 106 |
| `test/sidebar-doctor-hygiene.test.js` | Guard SDR-02 + evidencia SDR-04 | ✓ VERIFIED | 17 tests, todos pasan (incluye detector-no-trivial) |
| `src/cmux/sidebar-doctor.js` | `scan`/`execute`/`taskLikeFrom` puros, never-throws, DI, con `hasActions`/`hasAdvisories` re-definidos post gap-closure | ✓ VERIFIED | 403 líneas; `hasActions = loose+empty` (línea 303), `hasAdvisories = missing_group.length>0` (línea 304); `execute()` sin el bucle missing_group (líneas 369-373 solo comentario) |
| `src/logger-events.js` | eventos `sidebarDoctorScan/Fix/FixError` + `EVENTS.SIDEBAR_DOCTOR_*` | ✓ VERIFIED | Presentes y usados; taxonomía canónica 34 tipos, test pasa |
| `test/cmux/sidebar-doctor.test.js` | Unit puro con fixtures + spy de argv, incluyendo regresión G-79-1 | ✓ VERIFIED | 22 tests, incluye el caso de regresión G-79-1 (execute no emite create/set-anchor) |
| `src/cli/sidebar-doctor.js` | `runSidebarDoctor` espejo de `runGsdDoctor` + render advisory de missing_group | ✓ VERIFIED | `renderAdvisory()` presente (línea 197); veredicto de 3 estados (drift/advisory/clean, líneas 138-144); nunca importa `../cmux/client.js` ni picocolors |
| `src/cli.js` | Namespace `sidebar doctor` sin `ensureConfig` | ✓ VERIFIED | Comentario explícito "sin ensureConfig"; grep confirma ausencia de la llamada en el bloque |
| `test/cli/sidebar-doctor-cli.test.js` | dry-run/--fix/--json/exit codes + caso advisory-only | ✓ VERIFIED | 15 tests, todos pasan (incluye advisory-only exit 0 y hasAdvisories en --json) |
| `.planning/phases/79-sidebar-doctor/79-RESEARCH.md` | Addendum "Post-UAT correction (G-79-1)" | ✓ VERIFIED | Presente (líneas 489-493), documenta el modelo header-is-anchor y la supersesión de D-07/D-08 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cmux/sidebar-doctor.js` | `src/cmux/client.js` | import de los 4 passthroughs + `listWorkspacesJson` | ✓ WIRED | `resolveDeps` usa los exports reales como default lazy; `createWorkspaceGroup`/`setGroupAnchor` siguen importados (para spy de tests) pero NO se invocan en `execute()` |
| `src/cmux/sidebar-doctor.js` | `src/session/manager.js` | `deriveExpectedGroupName`/`resolveWorkspaceGroup` reutilizados VERBATIM | ✓ WIRED | Import directo, sin reimplementación; `manager.js` no modificado por la fase |
| `src/cli/sidebar-doctor.js` | `src/cmux/sidebar-doctor.js` | `scan as realScan, execute as realExecute` | ✓ WIRED | Import confirmado; nunca importa `../cmux/client.js` |
| `src/cli.js` | `src/cli/sidebar-doctor.js` | import dinámico + `process.exit(code)` | ✓ WIRED | Confirmado; `node src/cli.js sidebar doctor` y `--json` ejecutados en vivo con resultado coherente 2026-07-23 |
| `execute()` | `report.missing_group` | NO consumido — bucle eliminado | ✓ WIRED (ausencia verificada) | El bucle que consumía `missing_group` para `create`/`set-anchor` fue eliminado por completo; solo queda un comentario explicativo |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| SDR-01 | 79-02, 79-03, 79-04 | Dry-run lista acciones/advisories clasificadas sin ejecutar | ✓ SATISFIED | `scan()` clasifica, `renderHuman`/`renderAdvisory` renderizan; tests unit + live read-only |
| SDR-02 | 79-01, 79-02, 79-04 | `--fix` usa solo el allowlist; verbo destructivo ausente + guard; superficie reducida (create/set-anchor ya no se emiten) | ✓ SATISFIED | `client.js` sin `delete`; guard + detector-no-trivial pasan; regresión G-79-1 verificada |
| SDR-03 | 79-02 | 100% determinista, 0 tokens; reutiliza `deriveExpectedGroupName`/`resolveWorkspaceGroup` | ✓ SATISFIED | Source assertion test confirma 0 imports de provider/LLM |
| SDR-04 | 79-01 | Launch path byte-idéntico, GRP-01..03 intactos | ✓ SATISFIED | `manager.js` no tocado; golden tests pasan sin modificar |
| SDR-05 | 79-02, 79-04 | Sesiones sueltas convergen al grupo esperado (re-scopeado: solo cuando el grupo YA EXISTE; grupo faltante es advisory) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unit-level convergencia probada (spy) + verbo crudo validado en vivo (79-UAT.md A2); round-trip completo vía CLI kodo diferido — sin sesión suelta real disponible el día de esta verificación |
| SDR-06 | 79-03 | CLI espejo `gsd doctor` — `--json` byte-determinista, exit codes deterministas | ✓ SATISFIED | Tests de `--json` TTY/no-TTY + exit derivation pasan; confirmado en vivo |

Ningún requirement de REQUIREMENTS.md mapeado a Phase 79 (SDR-01..06) queda huérfano — los 6 están declarados en `requirements:` de al menos un plan (incluido 79-04 para SDR-01/SDR-05) y todos tienen evidencia.

### Anti-Patterns Found

Ninguno. Escaneados `src/cmux/client.js`, `src/cmux/sidebar-doctor.js`, `src/cli/sidebar-doctor.js`, `src/cli.js` (bloque nuevo), y los 3 ficheros de test de la fase (incluyendo los tocados por 79-04): sin `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` (el único hit de `TODO` en `cli.js` es la palabra española "TODOS", falso positivo, no relacionado con la fase), sin implementaciones vacías, sin datos hardcodeados que fluyan a render.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Guard source-hygiene pasa sobre `src/` real | `node --test test/sidebar-doctor-hygiene.test.js` | 17/17 pass | ✓ PASS |
| Motor scan/execute pasa (incluye regresión G-79-1) | `node --test test/cmux/sidebar-doctor.test.js` | 22/22 pass | ✓ PASS |
| CLI handler pasa (dry-run/--fix/--json/exit/advisory-only) | `node --test test/cli/sidebar-doctor-cli.test.js` | 15/15 pass | ✓ PASS |
| Golden launch path intacto | `node --test test/manager.test.js test/session/group-resolve.test.js` | pass | ✓ PASS |
| Walker de aislamiento no roto por client.js | `node --test test/host/cmux-isolation.test.js` | pass | ✓ PASS |
| Dry-run real read-only contra el sidebar del operador | `node src/cli.js sidebar doctor` | "Grupos faltantes (advisory...): none · Workspaces sueltos: none · Grupos vacíos: none · protected: 1 · ✓ clean", exit 0 | ✓ PASS |
| `--json` real read-only con `hasAdvisories` en el shape | `node src/cli.js sidebar doctor --json` | `{"missing_group":[],"loose_workspace":[],"empty_group":[],"protected":{"sessions":[{"ref":"workspace:43","group":"workspace_group:11","name":"LIKEN"}]},"hasActions":false,"hasAdvisories":false}`, exit 0 | ✓ PASS |
| Suite completa | `npm test` | 2348 pass / 0 fail / 1 skip | ✓ PASS |

### Probe Execution

No aplica — la fase no declara probes (`scripts/*/tests/probe-*.sh`); ninguno referenciado en PLAN/SUMMARY. SKIPPED (sin probes declarados).

### Human Verification Required

1. **Round-trip completo de `kodo sidebar doctor --fix` sobre una sesión suelta real con grupo YA EXISTENTE (SDR-05, re-scopeado post gap-closure)**
   - **Test:** Con ≥1 sesión kodo real cuyo workspace esté suelto de un grupo esperado que YA EXISTE, correr `node src/cli.js sidebar doctor` (debe listar `add`), luego `node src/cli.js sidebar doctor --fix`, luego `cmux workspace-group list --json`.
   - **Expected:** El workspace de la sesión suelta aparece en `member_workspace_refs` del grupo esperado; una 2ª pasada del dry-run sale exit 0 (converged); ningún workspace no-kodo del operador fue movido o re-anclado (D-04); ninguna sesión viva pierde su fila/título (no debería poder reproducirse G-79-1, porque `execute()` ya no emite `create`/`set-anchor` bajo ninguna rama).
   - **Por qué humano:** Requiere mutar el sidebar cmux real; los verbos del allowlist no se ejecutan contra un binario cmux vivo en unit tests. El 2026-07-23 el sidebar del operador estaba limpio (dry-run en vivo: `protected: 1`, 0 loose/missing/empty) — no había deriva real disponible para ejercitar la rama mutante sin fabricar estado artificialmente desde una cadena autónoma. El verbo crudo (`cmux workspace-group add`) ya se validó manualmente en 79-UAT.md (A2: pass); lo que falta es el round-trip vía el binario `kodo` mismo.

### Gaps Summary

**El blocker G-79-1 reportado en el UAT anterior está CERRADO.** `execute()` ya no contiene ninguna rama que emita `create` ni `set-anchor` — el bucle que anclaba el grupo recién creado en la sesión kodo viva más antigua fue eliminado por completo (no "arreglado", eliminado: cero superficie de mutación insegura). Esto se verificó por:

- Inspección directa del código (`src/cmux/sidebar-doctor.js` líneas 358-402): el cuerpo de `execute()` solo contiene los bucles `loose_workspace → add` y `empty_group → ungroup`.
- Un test de regresión dedicado que usa un spy de argv y confirma cero llamadas a `createWorkspaceGroup`/`setGroupAnchor` ante un fixture `missing_group`.
- Una ratificación explícita del operador vía `checkpoint:decision` (Opción A, report-only) documentada en `79-04-PLAN.md` y `79-04-SUMMARY.md`.
- Ejecución en vivo (read-only) del dry-run y `--json` contra el sidebar real del operador, confirmando el nuevo render advisory y el shape `hasAdvisories`.

No hay gaps de código: los 6 requirements (SDR-01..06) están implementados, cableados y cubiertos por 54 tests unit propios de la fase (17+22+15) más los golden preexistentes (manager.test.js, group-resolve.test.js, cmux-isolation.test.js), todos verdes, y la suite completa (2348/2349, 1 skip) pasa sin regresiones.

Lo que falta es puramente de **evidencia en vivo del round-trip completo, no de código ni de la corrección del gap**: SDR-05 (convergencia `loose_workspace → add` cuando el grupo ya existe) está probada a nivel unit con spy y el verbo crudo de cmux ya se validó manualmente en el UAT previo (A2: pass), pero el camino completo `kodo sidebar doctor --fix` extremo a extremo contra un cmux vivo con una sesión suelta real no se pudo ejercitar el 2026-07-23 porque el sidebar del operador no tenía deriva real que corregir. Este residual es de MENOR riesgo que el gap cerrado: ya no existe ninguna rama de mutación que pueda robar el título/fila de una sesión viva (la causa raíz de G-79-1 fue eliminada por construcción); lo pendiente es solo confirmar el camino `add` en un escenario real con el binario `kodo`, no una regresión de seguridad.

---

_Verified: 2026-07-23_
_Verifier: Claude (gsd-verifier)_
