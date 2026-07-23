---
phase: 79-sidebar-doctor
verified: 2026-07-23T00:00:00Z
status: human_needed
score: 5/6 must-haves verified
behavior_unverified: 1
overrides_applied: 0
human_verification:
  - test: "Con ≥1 sesión kodo suelta real (workspace sin su grupo esperado): correr `node src/cli.js sidebar doctor` (confirmar que aparece como `add` o `create+add+set-anchor`), luego `node src/cli.js sidebar doctor --fix`, luego `cmux workspace-group list --json`."
    expected: "El workspace de la sesión suelta aparece ahora en `member_workspace_refs` del grupo esperado (SDR-05 en vivo); si el grupo se creó, el anchor es el miembro más longevo y no hay grupos duplicados; ningún workspace no-kodo del operador aparece movido o re-anclado (D-04)."
    why_human: "Requiere mutar el sidebar cmux real con `--fix`; los verbos del allowlist (create/add/set-anchor/ungroup) no se ejecutan contra un cmux vivo en unit tests (DI/spy solamente). El 2026-07-23 no existía ninguna sesión kodo suelta real para ejercitar la rama mutante sin fabricar estado artificial en el sidebar del operador — explícitamente diferido a UAT por el propio plan (79-03-SUMMARY.md, 79-VALIDATION.md §Manual-Only Verifications)."
  - test: "Verificar el supuesto A1 (¿`workspace-group create --json` devuelve el ref del grupo nuevo en el stdout?) — informativo, el código NO depende de esto (usa re-list, OQ1), pero confirma robustez."
    expected: "No es bloqueante para la fase — el re-list vía `listWorkspaceGroupsRaw` + `resolveWorkspaceGroup` es el mecanismo real usado por `execute()`; A1 es solo una nota de RESEARCH."
    why_human: "Requiere ejecutar `create` contra el cmux real y leer su stdout; no ejercitado en unit (execute nunca parsea el stdout de create)."
  - test: "Verificar el supuesto A2 (¿`workspace-group add` mueve un workspace desde OTRO grupo, o falla si ya pertenece a uno?) y A5 (¿los verbos mutan correctamente bajo el daemon cmux headless usado por kodo?)."
    expected: "El comportamiento observado no debe mover ni corromper ningún workspace no gestionado por kodo bajo ninguna combinación de estos supuestos."
    why_human: "Solo observable mutando el cmux real; el mock/DI de los tests no puede simular la semántica exacta del binario cmux."
gaps: []
---

# Phase 79: Sidebar Doctor Verification Report

**Phase Goal:** `kodo sidebar doctor` quita al humano y al launch path la carga de mantener el sidebar de cmux: un doctor determinista (espejo de `src/gsd/doctor.js` — `scan` + `execute`, dry-run por defecto / `--fix`, 0 tokens) detecta y corrige grupos que faltan (`create`), workspaces sueltos con grupo esperado (`add`), grupos disueltos por cierre de su anchor (`set-anchor` al miembro más longevo / re-crear) y grupos vacíos (`ungroup`). La gestión de grupos —hasta hoy prohibida— pasa a estar permitida SOLO en este carril, con allowlist. Launch path byte-idéntico (GRP-01..03 intactos).

**Verified:** 2026-07-23
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criteria del ROADMAP) | Status | Evidencia |
|---|---------------------------------------|--------|-----------|
| 1 | SDR-01: `kodo sidebar doctor` (dry-run) lista las acciones pendientes clasificadas (create/add/set-anchor/ungroup) sin ejecutar nada | ✓ VERIFIED | `src/cli/sidebar-doctor.js` `renderHuman` renderiza las 3 categorías con acción exacta en orden D-09; `test/cli/sidebar-doctor-cli.test.js` (11 tests) prueba dry-run nunca llama `executeFn`; ejecutado en vivo read-only 2026-07-23 10:18 contra el cmux real del operador con resultado coherente (79-03-SUMMARY.md) |
| 2 | SDR-02: `--fix` ejecuta EXCLUSIVAMENTE el allowlist (create/add/set-anchor/ungroup); `workspace-group delete` no existe en el código y un guard source-hygiene falla si aparece | ✓ VERIFIED | `src/cmux/client.js` solo expone `createWorkspaceGroup/addToWorkspaceGroup/setGroupAnchor/ungroupWorkspaceGroup` (grep confirma ausencia de `delete`); `test/sidebar-doctor-hygiene.test.js` guard + bloque detector-no-trivial pasan (17/17); WR-01 (add+ungroup contradictorios sobre el mismo grupo) detectado en code review y corregido en commit `433574e` con test de regresión |
| 3 | SDR-05: tras un pase de `--fix`, una sesión suelta aparece agrupada bajo su grupo esperado — verificable en `cmux workspace-group list --json` | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | El código está presente y cableado (`loose_workspace` → `addToWorkspaceGroup`, `missing_group` → `create+add+set-anchor`) y probado a nivel unit con spy de argv (`test/cmux/sidebar-doctor.test.js`, 22/22); pero la convergencia REAL contra un cmux vivo (mutación efectiva de `member_workspace_refs`) no fue ejercitada por ningún test ni verificación en vivo — explícitamente diferida a UAT (79-03-SUMMARY.md: "NO declarar como verificado"; 79-VALIDATION.md §Manual-Only Verifications) |
| 4 | SDR-04: el golden del launch path sigue byte-idéntico — `--group` solo si el grupo ya existe, fail-open en 2 capas, GRP-01..03 intactos | ✓ VERIFIED | `src/session/manager.js` no fue tocado (git log confirma 0 commits de la fase modifican `manager.js`); `test/manager.test.js` + `test/session/group-resolve.test.js` pasan sin modificación; `test/sidebar-doctor-hygiene.test.js` SDR-04 (3 tests) afirma la forma literal de `newWorkspaceWithGroupFallback`/`buildNewWorkspaceArgs` |
| 5 | SDR-03/SDR-06: detección 100% determinista y 0 tokens; CLI espejo de `gsd doctor` con `--json` byte-determinista y exit codes deterministas | ✓ VERIFIED | `src/cmux/sidebar-doctor.js` no importa provider/LLM/logger.js (source assertion test pasa); `src/cli/sidebar-doctor.js` produce JSON idéntico TTY/no-TTY sin `\x1b[` (test pasa); `exitCode = report.hasActions ? 1 : 0` calculado antes del render, `protected` nunca lo afecta (test pasa) |

**Score:** 5/6 truths verificados (1 presente y cableado, comportamiento real no ejercitado)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cmux/client.js` | 4 passthroughs allowlist + `listWorkspacesJson` + docstring GRP-04 re-fronterizado | ✓ VERIFIED | Los 5 exports existen, delegan en `run()` con argv plano (array, no template strings); docstring re-fronterizado confirmado por lectura directa (líneas 106-119) |
| `test/sidebar-doctor-hygiene.test.js` | Guard SDR-02 + evidencia SDR-04 | ✓ VERIFIED | 175 líneas, 17 tests, todos pasan; incluye bloque detector-no-trivial (fixture con/sin cableado prohibido) |
| `src/cmux/sidebar-doctor.js` | `scan`/`execute`/`taskLikeFrom` puros, never-throws, DI | ✓ VERIFIED | 425 líneas; `scan` never-throws (try/catch por input), `execute` re-detecta TOCTOU llamando `scan(deps)` fresco, allowlist emitido en orden D-09; WR-01 fix presente (líneas 285-294) |
| `src/logger-events.js` | eventos `sidebarDoctorScan/Fix/FixError` + `EVENTS.SIDEBAR_DOCTOR_*` | ✓ VERIFIED | Importados y usados por `sidebar-doctor.js`; `test/logger-events.test.js` actualizado a 34 tipos canónicos, pasa |
| `test/cmux/sidebar-doctor.test.js` | Unit puro con fixtures + spy de argv | ✓ VERIFIED | 352 líneas, 22 tests, incluye el caso de regresión WR-01 |
| `src/cli/sidebar-doctor.js` | `runSidebarDoctor` espejo de `runGsdDoctor` | ✓ VERIFIED | 181 líneas; scan→exitCode→(fix)execute→render; `--json` sin formatter; nunca importa `../cmux/client.js` ni picocolors (grep confirma) |
| `src/cli.js` | Namespace `sidebar doctor` sin `ensureConfig` | ✓ VERIFIED | Líneas 478-500; comentario explícito "NO ensureConfig"; grep confirma ausencia de la llamada en el bloque |
| `test/cli/sidebar-doctor-cli.test.js` | dry-run/--fix/--json/exit codes | ✓ VERIFIED | 244 líneas, 11 tests, todos pasan |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cmux/sidebar-doctor.js` | `src/cmux/client.js` | import de los 4 passthroughs + `listWorkspacesJson` | ✓ WIRED | `resolveDeps` usa los exports reales como default lazy |
| `src/cmux/sidebar-doctor.js` | `src/session/manager.js` | `deriveExpectedGroupName`/`resolveWorkspaceGroup` reutilizados VERBATIM | ✓ WIRED | Import directo, sin reimplementación; `manager.js` no fue modificado por la fase |
| `src/cli/sidebar-doctor.js` | `src/cmux/sidebar-doctor.js` | `scan as realScan, execute as realExecute` | ✓ WIRED | Import confirmado; NUNCA importa `../cmux/client.js` (aislamiento respetado) |
| `src/cli.js` | `src/cli/sidebar-doctor.js` | import dinámico + `process.exit(code)` en el action del subcomando `doctor` | ✓ WIRED | Confirmado en cli.js:493-495; ejecutado en vivo `node src/cli.js sidebar doctor --json` con resultado coherente |
| `test/sidebar-doctor-hygiene.test.js` | `src/**/*.js` | walker recursivo comment-stripped que escanea TODO src/ | ✓ WIRED | Guard corre contra el árbol real, no un subconjunto — protege toda la fase |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|--------------|--------|----------|
| SDR-01 | 79-02, 79-03 | Dry-run lista acciones clasificadas sin ejecutar | ✓ SATISFIED | `scan()` clasifica, `renderHuman` renderiza; tests unit + live read-only |
| SDR-02 | 79-01, 79-02 | `--fix` usa solo el allowlist; verbo destructivo ausente + guard | ✓ SATISFIED | `client.js` sin `delete`; guard + detector-no-trivial pasan; WR-01 corregido |
| SDR-03 | 79-02 | 100% determinista, 0 tokens; reutiliza `deriveExpectedGroupName`/`resolveWorkspaceGroup` | ✓ SATISFIED | Source assertion test confirma 0 imports de provider/LLM |
| SDR-04 | 79-01 | Launch path byte-idéntico, GRP-01..03 intactos | ✓ SATISFIED | `manager.js` no tocado; golden tests pasan sin modificar |
| SDR-05 | 79-02 | Sesiones adoptadas/lanzadas convergen al grupo esperado | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Unit-level convergencia probada (spy); convergencia REAL diferida a UAT |
| SDR-06 | 79-03 | CLI espejo `gsd doctor` — `--json` byte-determinista, exit codes deterministas | ✓ SATISFIED | Tests de `--json` TTY/no-TTY + exit derivation pasan |

Ningún requirement de REQUIREMENTS.md mapeado a Phase 79 (SDR-01..06) queda huérfano — los 6 están declarados en `requirements:` de al menos un plan y todos tienen evidencia.

### Anti-Patterns Found

Ninguno. Escaneados `src/cmux/client.js`, `src/cmux/sidebar-doctor.js`, `src/cli/sidebar-doctor.js`, `src/cli.js` (bloque nuevo), y los 3 ficheros de test nuevos: sin `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`, sin implementaciones vacías, sin datos hardcodeados que fluyan a render. Las únicas coincidencias de "delete/remove/rename" son menciones en comentarios/docstrings (documentando la prohibición LOCKED), correctamente excluidas por `stripComments` del propio guard.

El único defecto de correctitud real encontrado en code review (WR-01: `add` + `ungroup` contradictorios sobre el mismo grupo transitoriamente vacío) fue corregido en commit `433574e` con test de regresión dedicado, verificado independientemente en esta sesión (`node --test test/cmux/sidebar-doctor.test.js` → 22/22 pass, incluye el caso WR-01).

Los 3 findings `info` del review (IN-01 subreporte de `created` en un caso raro de re-list fallido, IN-02 exit 1 tras un `--fix` exitoso — comportamiento espejo intencional de `gsd doctor`, IN-03 acceso sin optional-chaining a `report.protected.sessions.length` en un `scanFn` inyectado hipotético) quedan sin corregir por decisión explícita del reviewer (no bloqueantes, robustez menor). No se re-flagea aquí: ninguno afecta el goal de la fase ni introduce riesgo de seguridad o pérdida de datos.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Los 5 exports de client.js (allowlist + listWorkspacesJson) resuelven como funciones | `node -e "import('./src/cmux/client.js').then(...)"` (equivalente re-ejecutado) | Confirmado por lectura directa del fichero — los 5 `export async function` presentes | ✓ PASS |
| Guard source-hygiene pasa sobre `src/` real | `node --test test/sidebar-doctor-hygiene.test.js` | 17/17 pass | ✓ PASS |
| Motor scan/execute pasa (incluye WR-01) | `node --test test/cmux/sidebar-doctor.test.js` | 22/22 pass | ✓ PASS |
| CLI handler pasa (dry-run/--fix/--json/exit) | `node --test test/cli/sidebar-doctor-cli.test.js` | 11/11 pass | ✓ PASS |
| Golden launch path intacto | `node --test test/manager.test.js test/session/group-resolve.test.js` | pass (98 casos, sin modificar) | ✓ PASS |
| Walker de aislamiento no roto por client.js | `node --test test/host/cmux-isolation.test.js` | pass | ✓ PASS |
| Suite completa | `npm test` | 2347 pass / 0 fail / 1 skip | ✓ PASS |

### Probe Execution

No aplica — la fase no declara probes (`scripts/*/tests/probe-*.sh`); ninguno referenciado en PLAN/SUMMARY. SKIPPED (sin probes declarados).

### Human Verification Required

1. **Convergencia real de una sesión kodo suelta tras `--fix` (SDR-05 en vivo)**
   - **Test:** Con ≥1 sesión kodo real cuyo workspace esté suelto (sin su grupo esperado), correr `node src/cli.js sidebar doctor` (confirmar que se lista `add` o `create+add+set-anchor`), luego `node src/cli.js sidebar doctor --fix`, luego `cmux workspace-group list --json`.
   - **Expected:** El workspace de la sesión aparece en `member_workspace_refs` del grupo esperado; si el grupo se creó, el anchor es el miembro más longevo; ningún workspace no-kodo del operador fue movido o re-anclado (D-04); sin grupos duplicados.
   - **Por qué humano:** Requiere mutar el sidebar cmux real; los verbos del allowlist no se ejecutan contra un binario cmux vivo en unit tests. El 2026-07-23 no existía sesión suelta real y fabricar una habría mutado el sidebar del operador desde una cadena autónoma — explícitamente diferido por el propio plan (79-03-SUMMARY.md, 79-VALIDATION.md §Manual-Only Verifications).

2. **Supuestos A1/A2/A5 (semántica exacta del binario cmux)**
   - **Test:** A1 — tras un `--fix` que crea un grupo, ¿el `create --json` hubiera devuelto el ref directamente? (informativo, no bloqueante — el código usa re-list, no depende de esto). A2 — ¿`workspace-group add` mueve un workspace desde OTRO grupo o falla? A5 — ¿los verbos mutan correctamente bajo el daemon headless que usa kodo?
   - **Expected:** El comportamiento observado no debe mover ni corromper ningún workspace no gestionado por kodo bajo ninguna combinación de estos supuestos.
   - **Por qué humano:** Solo observable ejecutando los verbos contra el cmux real; el DI/spy de los tests no puede simular la semántica exacta del binario.

### Gaps Summary

No hay gaps de código: los 6 requirements (SDR-01..06) están implementados, cableados y cubiertos por 50 tests unit propios de la fase (17+22+11) más los golden preexistentes (manager.test.js, group-resolve.test.js, cmux-isolation.test.js), todos verdes, y la suite completa (2347/2348, 1 skip) pasa sin regresiones. El único code-review finding de severidad `warning` (WR-01) fue corregido con test de regresión antes de este verificador.

Lo que falta es puramente de **evidencia en vivo, no de código**: la convergencia real de `--fix` contra un cmux vivo (SDR-05) y los supuestos A1/A2/A5/D-04 post-fix. El propio equipo de ejecución identificó correctamente esta frontera y la documentó como diferida a UAT en lugar de reclamarla como verificada — la SUMMARY.md de 79-03 es honesta al respecto ("NO declarar como verificado"). Este verificador respeta esa honestidad: no se cuenta como VERIFIED sin evidencia de comportamiento real, y se enruta a `human_verification` en lugar de `gaps_found`, porque el código está presente, cableado, y probado a nivel unit — solo el comportamiento runtime contra el binario cmux real queda pendiente de confirmación humana.

---

_Verified: 2026-07-23_
_Verifier: Claude (gsd-verifier)_
