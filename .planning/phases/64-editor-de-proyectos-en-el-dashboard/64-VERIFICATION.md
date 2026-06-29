---
phase: 64-editor-de-proyectos-en-el-dashboard
verified: 2026-06-29T16:29:59Z
status: human_needed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Con ~/.kodo/.env válido y kodo server corriendo, ejecutar `kodo dashboard` en un terminal REAL (TTY). Pulsar `m` — debe abrirse el overlay de proyectos: breve cargando, luego la lista REAL del provider (Plane/GitHub) con su estado de mapeo ([ruta] o [sin mapear]), sin salir del dashboard. Confirmar que NO aparece ninguna API key / api_key_env / base_url (PERSIST-04)."
    expected: "El overlay muestra los proyectos reales del workspace con su estado de mapeo correcto. Ningún secreto visible en el overlay."
    why_human: "La integración test inyecta un fake de listProjectsFn. La llamada de red real va al Plane/GitHub API y el rendering es en ink-testing-library (no en una TTY real)."
  - test: "Degradación real: sin conexión o con API key inválida, abrir el dashboard y pulsar `m`. El overlay debe mostrar projects-error (panel rojo) con opción de reintentar (`r`) o salir (`Esc`). El dashboard NO debe crashear. Verificar que ~/.kodo/projects.json queda INTACTO (no se escribió nada en el carril de error)."
    expected: "Panel projects-error visible, dashboard no cuelga, projects.json sin cambios tras el intento."
    why_human: "Los tests inyectan un fake {ok:false}. Un fallo de red/key real ocurre fuera del árbol ink y no puede simularse con DI en el test."
  - test: "Mapear un proyecto, guardar (aviso de reinicio en footer), luego reiniciar kodo server. Confirmar que el nuevo mapeo se aplica en el server reiniciado (el aviso de reinicio era necesario — sin hot-reload). Verificar también `cat ~/.kodo/projects.json` antes y después: la forma dual (string o {default,modules}) debe ser correcta y el JSON bien formado, con las otras entradas intactas."
    expected: "Tras reinicio, el mapeo nuevo se usa. projects.json tiene forma dual correcta y las demás entradas sin tocar."
    why_human: "El reinicio real del daemon está fuera del árbol ink y de los tests unitarios. La efectividad del aviso de reinicio solo se puede confirmar manualmente."
  - test: "Sobre un proyecto de Plane, pulsar `m` para abrir el sub-overlay de módulos en una terminal REAL. Confirmar: (1) el layout y el cursor visible en ink (texto inverse) se muestran correctamente, (2) truncado de rutas largas sin desbordamiento, (3) mapear la ruta de un módulo a un dir real guarda con la forma {default, modules:{[name]:ruta}}. Si el provider es GitHub / el proyecto no tiene módulos, confirmar footer 'este provider no tiene módulos', sin crash."
    expected: "Sub-overlay renderiza correctamente en TTY real. Módulos se mapean y persisten con forma dual. GitHub/sin módulos degrada con footer, sin abrir sub-overlay."
    why_human: "ink-testing-library asierta contenido de texto, no el rendering ANSI ni el layout físico en TTY. El truncado de rutas y los colores inverse solo son verificables en terminal real."
---

# Phase 64: Editor de proyectos en el dashboard — Verification Report

**Phase Goal:** El operador añade, edita o quita el mapeo de un proyecto del provider a una ruta local (+ módulos opcionales) desde el dashboard, reusando la fundación de edición de Phase 63 y la lista en vivo `listProjects()`, persistiendo a `~/.kodo/projects.json`. Carril de mayor riesgo (depende de conexión al provider) y debe degradar con gracia si la conexión falla.
**Verified:** 2026-06-29T16:29:59Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El operador ve la lista de proyectos del provider en vivo con su estado de mapeo actual (PROJ-01) | VERIFIED | `m` handler en App.js llama `listProjectsFn` → `projectsSnapshot{remote,map}` congelado → `SessionTable.renderProjectsOverlay` itera `snapshot.remote` con `getProjectPath` para mostrar ruta o `PROJECTS_UNMAPPED`. Integration test PROJ-01 pasa. DI wired en index.js con wrapper real `initRegistry+getProvider+listProjects`. |
| 2 | El operador asigna o edita la ruta local de un proyecto y la ruta se valida antes de aceptarse (PROJ-02) | VERIFIED | `validateExistingDir(buffer)` (L1128 App.js) llamado ANTES de `saveProjectsFn(next)` (L1138) en el handler de Enter en `projects-edit`. Unit tests 9/9 pass (symlink roto, vacío, archivo, inexistente, dir existente). Integration tests PROJ-02 válido + inválido pasan: ruta inválida → `projectsEditError` estado dedicado, `saveProjectsFn` NO llamado. |
| 3 | El operador quita el mapeo de un proyecto y mapea carpetas de módulos independientes (PROJ-03, PROJ-04) | VERIFIED | Quitar: tecla `x` → `removeProjectMapping(snapshot.map, item.id)` → `saveProjectsFn(next)` (L1048-1055 App.js). Módulos: 2º hop `listModulesFn(projectId)` guardado con `projectsReqRef` dedicado → `projects-modules` → `setModulePath` preserva `{default, modules}`. Tests: `removeProjectMapping` unit 3/3 pass; `setModulePath` unit 4/4 pass; integration PROJ-03 (spy sin la key) y PROJ-04 (deepEqual spy muestra `{default, modules:{core:...}}`) pasan. |
| 4 | Los cambios se persisten a `~/.kodo/projects.json` vía `saveProjects`, sin endpoint nuevo, no-corruptivo, con aviso de reinicio (PERSIST) | VERIFIED | `saveProjectsFn: (m) => saveProjects(m)` importa `saveProjects` de `config.js` directo en el proceso ink (L292 index.js). `git diff --quiet src/server.js` → exit 0 (cero endpoints). Constante `PROJECTS_SAVED_RESTART` surfaceada en `focusError` tras guardar (L1143 App.js). `saveProjects` usa `writeFileAtomic` heredado de Phase 63 (no-corruptivo). |
| 5 | Si `listProjects()` falla, el editor lo comunica y permite reintentar o salir, sin crashear ni corromper el mapeo (PROJ-05) | VERIFIED | `listProjectsFn` en index.js tiene try/catch que cubre construcción del provider/PlaneClient (que lanza sin API key — Pitfall 1) Y la llamada de red → `{ok:false, error}`. App.js: `{ok:false}` → `projects-error`; `r` → `runProjectsFetch()`; Esc → `setMode('list')`. `saveProjectsFn` NUNCA se llama en `projects-error`. Integration tests PROJ-05 error+retry (2 tests) y race (1 test) pasan. |

**Score:** 5/5 truths verified (behavior_unverified: 0)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/path-validate.js` | `validateExistingDir(raw)` never-throws, {ok,value}\|{ok,error} | VERIFIED | Exports `validateExistingDir`. Wraps `statSync` in try/catch. No ink/picocolors. 47 lines, commit `cb35907`. |
| `src/projects-shape.js` | Helpers puros de forma dual sin FS/ink/red | VERIFIED | Exports `setProjectPath`, `removeProjectMapping`, `setModulePath`, `getProjectPath`, `getModuleMap`. No `node:fs` import. 99 lines, commit `6498974`. |
| `test/path-validate.test.js` | Tabla dir/archivo/no-existe/vacío/symlink-roto never-throws con mkdtempSync | VERIFIED | 9 tests, 9 pass. Covers all cases including symlink roto. Uses `mkdtempSync`, NO toca HOME. |
| `test/projects-shape.test.js` | Preservación forma dual, pureza por referencia | VERIFIED | 19 tests, 19 pass. Asserts modules preserved, delete-key, setModulePath, and reference immutability. |
| `src/cli/dashboard/App.js` | Modos projects*, handler `m`, projectsReqRef dedicado, props DI, constantes PROJECTS_*, footer hint | VERIFIED | Modes `projects`/`projects-loading`/`projects-edit`/`projects-error`/`projects-modules-loading`/`projects-modules`/`projects-modules-edit` present. `projectsReqRef = useRef(0)` dedicado (L524). Props DI: `listProjectsFn`/`loadProjectsFn`/`saveProjectsFn`/`listModulesFn`. Exports: `PROJECTS_OVERLAY_TITLE`, `PROJECTS_LOADING`, `PROJECTS_UNMAPPED`, `PROJECTS_SAVED_RESTART`, `PROJECTS_REMOVED`, `PROJECTS_LOAD_FAILED`, `PROJECTS_MODULES_TITLE`, `PROJECTS_NO_MODULES`. Footer: `m projects` en L1615. |
| `src/cli/dashboard/SessionTable.js` | `renderProjectsOverlay`, `renderModulesOverlay`, early-returns por modo | VERIFIED | Functions `renderProjectsOverlay` (L397) y `renderModulesOverlay` (L491) presentes. Early-returns en L656-671. Cursor vía `<Text inverse>` (no picocolors). |
| `test/dashboard-projects.test.js` | 6+ integration tests cubriendo PROJ-01/02/03/04/05 + race | VERIFIED | 10 tests (9 suites), 10 pass. Cubre PROJ-01/02-UI-válido/02-UI-inválido/03/05-error/05-race/04-módulos/04-sin-módulos/04-staleness. DI fakes, `mkdtempSync` para dir real. |
| `src/cli/dashboard/index.js` | 4 *Fn cableados en `createElement(App,...)` | VERIFIED | `listProjectsFn` (L180-190, wrapper never-throws initRegistry+getProvider+listProjects), `listModulesFn` (L197-219, condicional plane/github), `loadProjectsFn`/`saveProjectsFn` (L291-292) inyectados en `createElement(App,{...})` L236-293. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `App.js` | `src/path-validate.js` | `import validateExistingDir` (L81); llamado en L1128 y L1244 antes de saveProjectsFn | WIRED | Grep confirma: `validateExistingDir` importado y usado en ambos carriles de edición (proyecto + módulo) ANTES de escribir. |
| `App.js` | `src/projects-shape.js` | `import {setProjectPath, removeProjectMapping, getProjectPath}` (L84) y `import {setModulePath, getModuleMap}` (L88) | WIRED | Todas las funciones importadas y usadas en los handlers de modo correspondientes. |
| `App.js` | Props DI `listProjectsFn`/`loadProjectsFn`/`saveProjectsFn`/`listModulesFn` | `runProjectsFetch` (L652-664) usa `listProjectsFn`; handlers usan `saveProjectsFn`; `loadProjectsFn` al congelar snapshot | WIRED | Código completo, flujo trazable. |
| `SessionTable.js` | `App.js` | `import {...PROJECTS_*} from './App.js'` (L27+); consume `projectsSnapshot`/`projectsError`/`projectsEditError`/`buffer`/`cursor`/`fieldCursor` | WIRED | Importaciones presentes; early-returns en L656-671 ramifican a los helpers de render con las props correctas. |
| `index.js` | `src/providers/registry.js` | `import {initRegistry, getProvider}` (L140) dentro de `listProjectsFn` | WIRED | Lazy import presente. El wrapper never-throws lo llama. |
| `index.js` | `src/providers/plane/client.js` | `import {PlaneClient}` (L202) dentro de `listModulesFn` cuando `providerName === 'plane'` | WIRED | Import condicional dentro del wrapper never-throws. |
| `index.js` | `src/config.js` | `const {loadProjects, saveProjects} = await import('../../config.js')` (L164) | WIRED | `saveProjects` añadido al lazy import existente de `loadProjects`. Ambas usadas en las props `loadProjectsFn`/`saveProjectsFn`. |
| `index.js` | `App.js` | `createElement(App, {..., listProjectsFn, listModulesFn, loadProjectsFn, saveProjectsFn})` (L289-292) | WIRED | Todas las 4 props presentes en el objeto de props. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `SessionTable.js` / `renderProjectsOverlay` | `snapshot.remote`, `snapshot.map` | `listProjectsFn()` (red → provider) + `loadProjectsFn()` (disk → projects.json) congelados en `projectsSnapshot` | Sí: provider real en index.js; tests con fake que devuelve estructura real | FLOWING |
| `SessionTable.js` / `renderModulesOverlay` | `snapshot.modules`, `snapshot.map` | `listModulesFn(projectId)` (red → PlaneClient) congelado en `projectsSnapshot.modules` | Sí: PlaneClient real en index.js para plane, modules:[] para github | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| validateExistingDir unit tests | `node --test test/path-validate.test.js` | 9 pass / 0 fail | PASS |
| projects-shape unit tests | `node --test test/projects-shape.test.js` | 19 pass / 0 fail | PASS |
| Integration projects editor (PROJ-01..05 + race + módulos) | `node --test test/dashboard-projects.test.js` | 10 pass / 0 fail | PASS |
| Full suite (sin regresión) | `npm test` | 1639 pass / 0 fail / 1 skip pre-existente | PASS |
| server.js invariante cero-endpoints | `git diff --quiet src/server.js` | exit 0 | PASS |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| PROJ-01 | 64-02, 64-04 | Lista de proyectos del provider en vivo con estado de mapeo | SATISFIED | Handler `m` en App.js + DI wired en index.js + integration test PROJ-01 |
| PROJ-02 | 64-01, 64-02 | Asignar/editar ruta local validada antes de aceptar | SATISFIED | `validateExistingDir` antes de `saveProjectsFn`; unit + integration tests |
| PROJ-03 | 64-01, 64-02 | Quitar el mapeo de un proyecto | SATISFIED | `removeProjectMapping` + tecla `x` + integration test PROJ-03 |
| PROJ-04 | 64-01, 64-02, 64-03, 64-04 | Mapear módulos independientes de un proyecto | SATISFIED | `setModulePath` + 2º hop `listModulesFn` + integration tests PROJ-04 (mapear/sin-módulos/staleness) |
| PROJ-05 | 64-02, 64-04 | Degradación graciosa ante fallo de `listProjects()` | SATISFIED | `projects-error` + retry + never-throws wrapper en index.js + integration tests PROJ-05 |

No orphaned requirements for Phase 64 — REQUIREMENTS.md traceability table mapea exactamente PROJ-01..05 a Phase 64, todos cubiertos.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX sin referencia en ningún archivo modificado de esta fase | — | — |
| — | — | No stubs detectados: `return null`/`return []` solo en defaults inertes de DI (no fluyen a render sin override del caller) | — | — |
| — | — | `src/projects-shape.js`: confirmado sin `node:fs`/ink/picocolors (módulo puro) | — | — |
| — | — | `src/path-validate.js`: confirmado sin ink/picocolors; solo `node:fs` (módulo con I/O aislado) | — | — |

Scan de debt markers limpio en todos los archivos modificados: `src/path-validate.js`, `src/projects-shape.js`, `src/cli/dashboard/App.js`, `src/cli/dashboard/SessionTable.js`, `src/cli/dashboard/index.js`, `test/path-validate.test.js`, `test/projects-shape.test.js`, `test/dashboard-projects.test.js`.

### Human Verification Required

Los 4 comportamientos manual-only documentados en `64-VALIDATION.md §Manual-Only Verifications` y `64-04-SUMMARY.md §Pendiente — UAT manual`. El código está correctamente cableado y los tests con DI fakes pasan; estas verificaciones requieren un provider en vivo y un terminal TTY real.

#### 1. Lista en vivo real del provider (PROJ-01 + PERSIST-04)

**Test:** Con `~/.kodo/.env` válido y `kodo server` corriendo, ejecutar `kodo dashboard` en terminal REAL. Pulsar `m`. Ver el overlay cargando y luego la lista REAL de proyectos del workspace con su estado de mapeo (`[ruta]` o `[sin mapear]`). Sin salir del dashboard.
**Expected:** Lista real del provider visible. NO aparece ninguna API key / api_key_env / base_url en ningún punto del overlay.
**Why human:** El test de integración inyecta un `listProjectsFn` fake. La llamada de red real va al API del provider (Plane/GitHub). El rendering visual en una TTY real (colores, layout) no es ejercitado por `ink-testing-library`.

#### 2. Degradación real con provider caído (PROJ-05)

**Test:** Sin conexión o con API key inválida, lanzar `kodo dashboard` y pulsar `m`. Luego pulsar `r` (reintentar) y `Esc` (salir). Confirmar que `~/.kodo/projects.json` queda INTACTO.
**Expected:** Panel `projects-error` visible con mensaje y opciones. Dashboard no crashea (panel ink montado). `projects.json` sin cambios tras el intento.
**Why human:** Los tests inyectan `{ok:false}` directamente. Un fallo real de red/key ocurre fuera del árbol ink y no puede simularse con DI en el test.

#### 3. Aviso de reinicio efectivo y persistencia real (PERSIST-03)

**Test:** Mapear un proyecto (Enter → ruta real → Enter → aviso de reinicio). Verificar `cat ~/.kodo/projects.json` → forma dual correcta (string o `{default,modules}`), JSON bien formado, otras entradas intactas. Reiniciar `kodo server` y confirmar que el nuevo mapeo se aplica.
**Expected:** JSON correcto, mapeo propagado tras reinicio del server/daemon.
**Why human:** La efectividad del aviso de reinicio (que el mapeo realmente se aplica tras reiniciar) requiere el proceso real del server y un ecosistema de sesiones activo.

#### 4. Render visual del cursor y sub-overlay de módulos (PROJ-04 + render)

**Test:** Sobre un proyecto de Plane, pulsar `m` para abrir el sub-overlay de módulos en terminal REAL. Verificar: (a) layout y cursor visible (`<Text inverse>` en ink); (b) truncado de rutas largas sin desbordamiento; (c) mapear un módulo a dir real → guarda con `{default, modules:{[name]:ruta}}`. Si GitHub / sin módulos → footer `este provider no tiene módulos`, sin crash.
**Expected:** Sub-overlay se renderiza correctamente en TTY. Módulos mapeados y persistidos con forma dual. GitHub degrada con footer, sin abrir sub-overlay.
**Why human:** `ink-testing-library` asierta contenido de texto plano, no el rendering ANSI ni el layout físico en una TTY. El truncado de rutas y los colores `inverse` solo son verificables en terminal real.

---

### Gaps Summary

No gaps. Los 5 criterios de éxito del ROADMAP están verificados a nivel de código: tests unitarios e integración todos verdes (1639/0/1 skip pre-existente). El cableado DI es completo. El invariante cero-endpoints se preserva. No hay stubs ni debt markers.

Las 4 verificaciones manual-only documentadas en `64-VALIDATION.md` y `64-04-SUMMARY.md §Pendiente — UAT manual` son el único elemento pendiente — son comportamientos que requieren un provider en vivo y una TTY real, condiciones no disponibles en una sesión autónoma. El ejecutor los documentó honestamente; no son gaps de implementación sino verificaciones de despliegue.

---

_Verified: 2026-06-29T16:29:59Z_
_Verifier: Claude (gsd-verifier)_
