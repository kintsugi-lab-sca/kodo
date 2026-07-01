---
phase: 64-editor-de-proyectos-en-el-dashboard
plan: 04
subsystem: tui-dashboard
tags: [tui, ink, di-wiring, provider, plane-client, projects-json, never-throws, zero-endpoints]

# Dependency graph
requires:
  - phase: 64-02
    provides: "carril async base del editor de proyectos (modos projects/loading/edit/error), projectsReqRef, text-input + validateExistingDir, props DI listProjectsFn/loadProjectsFn/saveProjectsFn consumidas por App"
  - phase: 64-03
    provides: "sub-editor de módulos + prop DI listModulesFn (discriminado {ok}); asimetría no-contrato documentada — el cableado condicional plane/github lo cierra este plan"
provides:
  - "index.js: cableado DI real de los 4 *Fn en createElement(App,...): listProjectsFn (wrapper never-throws construcción+red), listModulesFn (condicional plane/github), loadProjectsFn/saveProjectsFn (import directo de config.js)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrapper never-throws discriminado que envuelve CONSTRUCCIÓN del cliente + llamada de red (no solo la red — Pitfall 1: PlaneClient lanza sin API key)"
    - "Wiring DI condicional por provider para un método fuera del contrato (listModules solo en PlaneClient): plane construye el cliente directo, github/otros no-op modules:[]"
    - "Escritura local in-process por import directo de config.js (sin endpoint nuevo en server.js, sin shell-out) — invariante cero-endpoints preservado"

key-files:
  created: []
  modified:
    - src/cli/dashboard/index.js

key-decisions:
  - "listProjectsFn envuelve initRegistry+getProvider+listProjects en un solo try/catch para cubrir la construcción del provider (el factory plane instancia PlaneClient, que LANZA sin API key — client.js:13-15) Y la llamada de red; discriminado {ok:true,projects}|{ok:false,error}, sin fail-open a [] (no distinguiría 0-proyectos de error de red — PROJ-05)"
  - "listModulesFn se wira CONDICIONAL: providerName==='plane' construye PlaneClient directo (espejo del wizard cli.js) y llama listModules; github/otros devuelven {ok:true, modules:[]} — listModules NO está en el contrato TaskProvider, ampliarlo tocaría github+getProvider (excepción consciente, RESEARCH A1)"
  - "loadProjectsFn/saveProjectsFn importan loadProjects/saveProjects de config.js DIRECTO (saveProjects añadido al MISMO lazy import existente de loadProjects, NO un import nuevo) — escritura atómica local (writeFileAtomic, Phase 63), sin endpoint en server.js (PERSIST-02, D-08)"
  - "La API key se lee de process.env[api_key_env] SOLO para construir PlaneClient; jamás se pasa al snapshot/render ni se escribe (PERSIST-04/T-64-16)"

patterns-established:
  - "Cierre del carril DI: el proceso real (runDashboard/index.js) inyecta las dependencias que App consumió con fakes en los planes anteriores, espejo exacto del cableado de onAdopt/onSaveConfig/loadConfigFn"

requirements-completed: [PROJ-01, PROJ-04, PROJ-05]

coverage:
  - id: W1
    description: "index.js cablea los 4 *Fn (listProjectsFn/listModulesFn/loadProjectsFn/saveProjectsFn) en createElement(App,...); el contrato DI que index inyecta coincide con el que App consume"
    requirement: "PROJ-01"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js (10 pass / 0 fail)"
        status: pass
      - kind: manual
        ref: "64-VALIDATION.md §Manual-Only — lista en vivo real del provider"
        status: pending
    human_judgment: true
  - id: W2
    description: "listProjectsFn never-throws cubre construcción+red y devuelve discriminado {ok}; un provider caído/sin key degrada a projects-error sin crash ni escritura"
    requirement: "PROJ-05"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-05 (fake {ok:false})"
        status: pass
      - kind: manual
        ref: "64-VALIDATION.md §Manual-Only — degradación real con provider caído"
        status: pending
    human_judgment: true
  - id: W3
    description: "listModulesFn condicional: plane construye PlaneClient.listModules; github/otros modules:[]"
    requirement: "PROJ-04"
    verification:
      - kind: integration
        ref: "test/dashboard-projects.test.js#PROJ-04 (fakes)"
        status: pass
      - kind: manual
        ref: "64-VALIDATION.md §Manual-Only — render visual del cursor/sub-overlay de módulos en terminal real"
        status: pending
    human_judgment: true
  - id: W4
    description: "saveProjectsFn/loadProjectsFn importan de config.js sin endpoint nuevo; server.js intacto"
    requirement: "PROJ-01"
    verification:
      - kind: automated
        ref: "git diff --quiet src/server.js (exit 0)"
        status: pass
    human_judgment: false

# Metrics
duration: 8min
completed: 2026-06-29
status: complete
---

# Phase 64 Plan 04: Cableado DI del editor de proyectos en el dashboard real Summary

**El editor de proyectos queda cableado al proceso REAL del dashboard (`src/cli/dashboard/index.js`): los 4 `*Fn` se inyectan en `createElement(App,...)` espejo de `onAdopt`/`onSaveConfig`/`loadConfigFn` — `listProjectsFn` (wrapper never-throws discriminado que cubre la CONSTRUCCIÓN del provider/PlaneClient, que lanza sin API key, Y la llamada de red — PROJ-05/Pitfall 1), `listModulesFn` (condicional: plane construye `PlaneClient.listModules` directo, github/otros no-op `modules:[]`), y `loadProjectsFn`/`saveProjectsFn` (import directo de `config.js`, atómico, sin endpoint nuevo ni shell-out — PERSIST-02/D-08); `server.js` intacto. Verificación automatizada verde; la UAT manual end-to-end (9 pasos, requiere provider en vivo + TTY real) queda PENDIENTE — NO se ejecutó en esta corrida autónoma.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-06-29
- **Completed:** 2026-06-29
- **Tasks:** 1 código (Task 1) + 1 checkpoint (Task 2, auto-aprobado en --auto)
- **Files modified:** 1 (`src/cli/dashboard/index.js`, 0 creados)

## Accomplishments

- **Cableado DI completo (Task 1, commit `c52bdf8`):** los 4 `*Fn` del editor de proyectos están inyectados en el `createElement(App,...)` real, cerrando el carril que los planes 02/03 dejaron funcionando con DI fakes.
- **`listProjectsFn` never-throws (PROJ-01/05):** `async () => { try { await initRegistry(); const provider = getProvider(providerName); const projects = await provider.listProjects(); return {ok:true,projects}; } catch (e) { return {ok:false, error}; } }`. El try/catch cubre la **construcción** del provider (el factory `plane` instancia `PlaneClient`, cuyo constructor LANZA sin API key — `client.js:13-15`, Pitfall 1) **y** la llamada de red. Discriminado `{ok:true,projects}|{ok:false,error}` — sin fail-open a `[]` (no distinguiría 0-proyectos de error — PROJ-05). `initRegistry`/`getProvider` añadidos como lazy import desde `registry.js` (espejo de `cli.js:652`).
- **`listModulesFn` condicional (PROJ-04 / asimetría no-contrato):** si `providerName === 'plane'` → wrapper never-throws que `import('../../providers/plane/client.js')`, construye `new PlaneClient({ baseUrl, apiKey: process.env[api_key_env], workspaceSlug })` y llama `.listModules(projectId)` → `{ok:true,modules}|{ok:false,error}`; si no → `async () => ({ ok:true, modules:[] })`. Comentario denso documenta por qué es wiring condicional y NO provider-agnostic uniforme: `listModules` NO está en el contrato `TaskProvider` (`interface.js`), vive solo en `PlaneClient` (`client.js:151`); ampliarlo tocaría github y `getProvider` (excepción consciente, RESEARCH A1).
- **`loadProjectsFn`/`saveProjectsFn` import directo (PERSIST-02/D-08):** `saveProjects` añadido al MISMO lazy import existente de `loadProjects` (`const { loadProjects, saveProjects } = await import('../../config.js')`, NO un import nuevo). `loadProjectsFn: () => loadProjects()`, `saveProjectsFn: (m) => saveProjects(m)` — escritura local atómica (writeFileAtomic, Phase 63), SIN red/server/shell ni endpoint nuevo.
- **Invariante cero-endpoints preservado:** `git diff --quiet src/server.js` exits 0 — `server.js` sin tocar (PERSIST-02, T-64-15).
- **API keys intactas (PERSIST-04/T-64-16):** la key se lee de `process.env[api_key_env]` SOLO para construir el cliente; nunca se pasa al snapshot/render ni se escribe.

## Verificación automatizada (PASÓ)

Las 3 comprobaciones automatizadas del plan están verdes en esta corrida:

1. `node --test test/dashboard-projects.test.js` → **10 pass / 0 fail** (el contrato DI que index cablea coincide con el que App consume).
2. `git diff --quiet src/server.js` → **exit 0** (server.js intacto, invariante cero-endpoints — PERSIST-02).
3. `npm test` (suite completa) → **1639 pass / 0 fail / 1 skip** (skip pre-existente, sin regresión).

## Pendiente — UAT manual (NO ejecutada en esta corrida autónoma)

> **Honestidad explícita:** el Task 2 era un `checkpoint:human-verify` (`gate="blocking"`) con 9 pasos de verificación end-to-end sobre el dashboard real. En esta corrida `--auto` el checkpoint fue **auto-aprobado**, NO verificado por un humano. **No hay provider en vivo ni TTY interactivo en esta sesión autónoma**, por lo que los 9 pasos NO se ejecutaron y NO puede afirmarse que pasen. Quedan PENDIENTES de `/gsd-verify-work 64` con un provider real (Plane/GitHub) y un terminal interactivo.

Pasos manuales pendientes (de `64-04-PLAN.md` §Task 2 `how-to-verify` y `64-VALIDATION.md` §Manual-Only Verifications):

1. **(PROJ-01)** `m` abre el overlay → lista REAL del provider con estado de mapeo (`[ruta]`/`[sin mapear]`), sin salir del dashboard; NO se muestra ninguna API key / api_key_env / base_url (PERSIST-04).
2. **(PROJ-02)** Editar ruta de un proyecto sin mapear con el cursor visible, backspace y ←/→ a mitad de string; ruta que EXISTE → aviso de reinicio + la fila muestra la ruta.
3. **(PROJ-02 inválido)** Ruta inexistente → footer rojo, el archivo NO se escribe, sigues editando sin perder la siguiente tecla.
4. **(PROJ-03)** Tecla quitar (`x`) sobre fila mapeada → vuelve a `[sin mapear]` + aviso de reinicio.
5. **(PROJ-04)** Tecla módulos sobre proyecto Plane → sub-overlay de módulos; mapear ruta de un módulo a dir real → se guarda. (GitHub / sin módulos → footer "sin módulos", sin crash.)
6. **(Persistencia)** `cat ~/.kodo/projects.json` → forma dual correcta (string o `{default,modules}`), JSON completo y bien formado, entradas de otros proyectos sin tocar.
7. **(PROJ-05 degradación REAL)** Provider caído / sin conexión / key inválida → `projects-error` (panel rojo) con retry (`r`)/salir (`Esc`); el dashboard NO crashea y `~/.kodo/projects.json` queda INTACTO.
8. **(PERSIST-03)** Reiniciar `kodo server` y confirmar que el nuevo mapeo se aplica (sin hot-reload — el aviso de reinicio era necesario).
9. **(Render visual)** Layout y truncado de rutas largas del cursor/sub-overlay de módulos en terminal real (`ink-testing-library` asierta contenido, no ANSI/layout).

**Acción recomendada:** ejecutar `/gsd-verify-work 64` con `~/.kodo/.env` válido en un terminal real para cerrar estas 4 verificaciones manual-only (lista en vivo, degradación real, aviso de reinicio, render del cursor/módulos).

## Task Commits

1. **Task 1: Cableado DI de los 4 *Fn de proyectos en index.js** — `c52bdf8` (feat) — committed antes de este agente de continuación.
2. **Task 2: Checkpoint humano end-to-end** — auto-aprobado en `--auto` (sin commit de código; UAT manual pendiente, ver arriba).

## Files Created/Modified

- `src/cli/dashboard/index.js` — lazy import de `initRegistry`/`getProvider` (registry.js); `saveProjects` añadido al lazy import existente de `loadProjects` (config.js); `const providerName = loadConfig().provider`; `listProjectsFn` (wrapper never-throws construcción+red); `listModulesFn` (condicional plane PlaneClient / github no-op); los 4 `*Fn` (`listProjectsFn`, `listModulesFn`, `loadProjectsFn`, `saveProjectsFn`) inyectados en `createElement(App,...)`. +75/-1 líneas.

## Decisions Made

- `listProjectsFn` envuelve construcción + red en un único try/catch (Pitfall 1: un proyecto sin key crashearía el handler si solo se envolviera la llamada). Discriminado, sin fail-open.
- `listModulesFn` condicional por provider (no provider-agnostic): `listModules` está fuera del contrato `TaskProvider`; excepción consciente para no tocar github + `getProvider`.
- `saveProjects` añadido al lazy import existente, no un import nuevo (cambio quirúrgico).
- API key solo para construir el cliente; nunca renderizada ni escrita (PERSIST-04).

## Deviations from Plan

None — el código se ejecutó tal cual está escrito (Task 1). El Task 2 (checkpoint humano) fue auto-aprobado por el modo `--auto`; la UAT manual queda explícitamente documentada como pendiente (ver sección "Pendiente — UAT manual").

## Issues Encountered

None en el carril de código. Limitación de entorno: la sesión autónoma no tiene provider en vivo ni TTY interactivo → la verificación humana end-to-end no es ejecutable aquí.

## User Setup Required

Para cerrar la UAT manual: `~/.kodo/.env` con credenciales válidas del provider, `kodo server` corriendo y `kodo dashboard` en un terminal REAL (TTY). Luego `/gsd-verify-work 64`.

## Known Stubs

None — el cableado DI es real (provider en vivo + import directo de config.js). Los defaults inertes de App.js (de planes anteriores) son fallbacks para tests sin DI, no stubs de UI.

## Threat Flags

None — sin nueva superficie de seguridad. El plan preserva los mitigantes del threat register (T-64-14 DoS cubierto por el wrapper never-throws; T-64-15 EoP/Tampering evitado por cero-endpoints; T-64-16 Info Disclosure por key solo-construcción; T-64-17 Tampering por escritura atómica).

## Self-Check: PASSED

- `src/cli/dashboard/index.js` modificado y commiteado en `c52bdf8` (FOUND).
- Commit `c52bdf8` existe en el historial (FOUND).
- `listProjectsFn`/`listModulesFn`/`loadProjectsFn`/`saveProjectsFn` presentes en `createElement(App,...)` (verificado en el diff).
- Automated verify verde (10 pass dashboard-projects; server.js intacto exit 0; 1639 pass suite completa).

---
*Phase: 64-editor-de-proyectos-en-el-dashboard*
*Completed: 2026-06-29*
