---
phase: 64
slug: editor-de-proyectos-en-el-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 64 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivada de `64-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (builtin, Node 22.x) + `ink-testing-library@4.0.0` |
| **Config file** | none — `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| **Quick run command** | `node --test test/<fichero-tocado>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15–30 segundos (suite completa) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<fichero-tocado>.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 64-XX-XX | TBD | 0 | PROJ-02 | V5 | `validateExistingDir`: dir existe→ok / archivo→error / no-existe→error / symlink-roto→error / vacío→error, never-throws | unit | `node --test test/path-validate.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 0 | PERSIST-01, PROJ-03 | V12 | Editar entrada-objeto preserva `modules` (solo cambia `default`); remove = `delete` key; forma dual `string`/`{default,modules}` intacta | unit | `node --test test/projects-shape.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 1 | PROJ-01 | — | `m` abre → `listProjectsFn` ok → lista con estado `[ruta]`/`[sin mapear]` | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 1 | PROJ-02 (UI) | V5 | Ruta inválida → footer rojo, NO escribe, sigue en edición | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 1 | PROJ-03 | V12 | Tecla quitar → `delete` + `saveProjectsFn` llamado con el mapa sin la key | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 1 | PROJ-05 | DoS | `listProjectsFn` `{ok:false}` → `projects-error`; `r` reintenta; `Esc` sale; panel montado; `saveProjectsFn` NUNCA llamado | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 1 | PROJ-05 (race) | — | `Esc` durante `projects-loading` invalida el fetch en vuelo (resultado tardío descartado vía `projectsReqRef`) | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |
| 64-XX-XX | TBD | 2 | PROJ-04 | V5 | Tecla módulos → `listModulesFn` ok → mapa `{default,modules}`; github/vacío → footer "sin módulos", no-op | integration | `node --test test/dashboard-projects.test.js` | ❌ W0 | ⬜ pending |

*Task IDs se concretan en PLAN.md. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/path-validate.test.js` — cubre PROJ-02: usar `mkdtempSync(os.tmpdir())` para un dir real; tabla dir-existe→ok, archivo→error, no-existe→error, vacío→error, symlink-roto→error (never-throws con try/catch — `statSync` lanza en symlink roto/permisos).
- [ ] `test/projects-shape.test.js` — cubre PERSIST-01/PROJ-03: preservación de forma dual al editar (objeto conserva `modules`) + remove (delete key). Funciones puras de mutación de mapa (sin ink). Si la mutación vive inline en App.js, extraer a helper puro testeable (espejo de `setByPath`/`mapDismissResult`).
- [ ] `test/dashboard-projects.test.js` — cubre PROJ-01/02-UI/03/04/05 + race (molde `test/dashboard-config.test.js` + `test/dashboard-overlay.test.js`: `injectProps` extendido con los 4 `*Fn`; `drain()`/settle async; fakes que resuelven y devuelven `{ok:false}`).
- [ ] Framework ya presente: `node:test` + `ink-testing-library` — sin instalación.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Lista en vivo real del provider (Plane/GitHub) | PROJ-01 | El test integration inyecta un `listProjectsFn` fake; la llamada de red real va al Plane API | UAT: con `~/.kodo/.env` válido, abrir el editor con `m`, confirmar que aparecen los proyectos reales del workspace con su estado de mapeo |
| Degradación real con provider caído | PROJ-05 | El test inyecta `{ok:false}`; el fallo de red/key real ocurre fuera del árbol ink | UAT: sin conexión o sin API key, pulsar `m`, confirmar `projects-error` + retry + que el dashboard NO crashea |
| Aviso de reinicio efectivo | PERSIST-03 | El reinicio real del daemon está fuera del árbol ink | UAT: mapear un proyecto, guardar, reiniciar `kodo server`, confirmar que el mapeo nuevo se aplica |
| Render visual del cursor/sub-overlay de módulos en terminal real | PROJ-04 | `ink-testing-library` asierta contenido, no el rendering ANSI ni el layout | UAT: abrir el sub-overlay de módulos en terminal real, confirmar layout y truncado de rutas largas |

---

## Nota de aislamiento de tests (memoria del proyecto, verificada)

`src/config.js` resuelve `KODO_DIR`/`PROJECTS_PATH` **al import** (líneas 6-8) vía `homedir()`. Tests que redirigen `process.env.HOME` DESPUÉS del import NO ven el cambio (path ya cacheado). Para `path-validate.test.js`: el validador es I/O puro sobre una ruta recibida como argumento (DI) → testeable con un dir real de `mkdtempSync` sin tocar `HOME`. Para `projects-shape.test.js`: las mutaciones de mapa son funciones puras (reciben el mapa, devuelven el nuevo) → sin filesystem. El carril de red (`listProjectsFn`/`listModulesFn`) se inyecta como fake — los tests nunca tocan la red ni `~/.kodo`.

---

## Observabilidad clave (sampling points)

- (a) El discriminante `{ok:true,projects}|{ok:false,error}` del wrapper `listProjectsFn` es el punto de muestreo del éxito/fallo del fetch (PROJ-01/PROJ-05).
- (b) El spy de `saveProjectsFn` es el punto de muestreo de que un carril de fallo NUNCA escribe (PROJ-05) y de que remove/edit persisten la forma correcta (PROJ-03).
- (c) El `projectsReqRef` (incremento por apertura) es el punto de muestreo de la staleness — un test encola dos aperturas y verifica que solo la última aplica (PROJ-05 race).

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (path-validate, projects-shape, dashboard-projects)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
