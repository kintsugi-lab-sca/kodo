---
phase: 77-agrupaci-n-de-workspaces-en-cmux
plan: 02
subsystem: session
tags: [cmux, workspace-groups, fail-open, pure-functions, session-launch, TOCTOU]

# Dependency graph
requires:
  - phase: 77-agrupaci-n-de-workspaces-en-cmux
    provides: "host._legacy.listWorkspaceGroups + flag --group en newWorkspace (Plan 01)"
provides:
  - "deriveExpectedGroupName(task, entry, resolvedPath): función pura que deriva el nombre de grupo esperado por path resuelto (GRP-02); ref degenerado → null"
  - "resolveWorkspaceGroup(groupsJson, expectedName): función pura defensiva nombre→ref, never-throws, first-wins (GRP-01/GRP-03 capa 1)"
  - "newWorkspaceWithGroupFallback(fn, base, group, log): helper de fail-open capa 2 con retry único sin --group (GRP-03/D-10)"
  - "cableado en launchWorkItem: resolución en fresco por lanzamiento + fail-open en dos capas (D-09/D-10/D-12)"
affects: [session-manager-launch, sidebar-grouping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Función pura defensiva never-throws con type-check por campo (calca normalizeSurface/buildTitleMap)"
    - "Helper de fallback con fn/log inyectados → el retry TOCTOU tiene dientes reales en test (no solo source-hygiene)"
    - "Capa 1 fail-open englobante (try/catch sobre list+parse+derivación) → groupRef=null degrada al comportamiento actual"

key-files:
  created:
    - test/session/group-resolve.test.js
  modified:
    - src/session/manager.js
    - test/manager.test.js
    - .planning/phases/77-agrupaci-n-de-workspaces-en-cmux/77-VALIDATION.md

key-decisions:
  - "Las 3 funciones viven en manager.js junto a deriveModuleName (D-08), no en un módulo aparte — misma casa, mismo estilo"
  - "Normalización del match = NFC + lowercase + trim (cubre Traça Web y Kodo↔KODO)"
  - "host._legacy.newWorkspace se pasa desreferenciado al fallback: su cuerpo no usa `this` (solo importa y delega), seguro"
  - "El groupRef se pasa a newWorkspace y se DESCARTA — cero persistencia (GRP-04, defensa Phase 43)"

patterns-established:
  - "Fail-open en dos capas: capa 1 (resolución en try/catch → null) + capa 2 (retry único sin --group ante TOCTOU)"
  - "Guarda de entrada degenerada como primera línea de la función pura → null limpio propaga end-to-end sin nombre bogus"

requirements-completed: [GRP-01, GRP-02, GRP-03, GRP-04]

coverage:
  - id: D1
    description: "deriveExpectedGroupName deriva el nombre esperado por path resuelto: flat/path==default → identifier a secas; módulo con path propio → IDENTIFIER/Módulo; ref degenerado → null (GRP-02)"
    requirement: "GRP-02"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#deriveExpectedGroupName"
        status: pass
    human_judgment: false
  - id: D2
    description: "resolveWorkspaceGroup matchea nombre→ref (NFC+lowercase+trim, first-wins) contra el fixture live y devuelve null ante shapes inesperados sin lanzar (GRP-01/GRP-03 capa 1)"
    requirement: "GRP-01"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#resolveWorkspaceGroup"
        status: pass
    human_judgment: false
  - id: D3
    description: "newWorkspaceWithGroupFallback reintenta EXACTAMENTE una vez sin --group ante un fallo con --group, emite una línea group_skipped sin contenido de usuario, y propaga el fallo del reintento (GRP-03 capa 2 / D-10 / D-11)"
    requirement: "GRP-03"
    verification:
      - kind: unit
        ref: "test/session/group-resolve.test.js#newWorkspaceWithGroupFallback"
        status: pass
    human_judgment: false
  - id: D4
    description: "El cableado en launchWorkItem resuelve el grupo en fresco (una sola llamada cmux vía host._legacy, cero en reconcile) y no persiste ningún ref workspace_group:N ni ejecuta verbos de gestión de grupos (GRP-01/GRP-04/D-12)"
    requirement: "GRP-04"
    verification:
      - kind: source-hygiene
        ref: "test/manager.test.js (Phase 77 asserts) + test/host/cmux-isolation.test.js (walker)"
        status: pass
    human_judgment: false

# Metrics
duration: ~6min
completed: 2026-07-16
status: complete
---

# Phase 77 Plan 02: Resolución de grupo cmux en el launch con fail-open en dos capas Summary

**Tres funciones puras nuevas en `manager.js` (`deriveExpectedGroupName`, `resolveWorkspaceGroup`, `newWorkspaceWithGroupFallback`) cableadas en `launchWorkItem`: cada sesión de tarea aterriza en el grupo cmux de su path resuelto (GRP-01/GRP-02), sin poder perder nunca una sesión por la agrupación (GRP-03, fail-open en 2 capas) y sin gestionar ni persistir grupos (GRP-04).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-16T08:19Z
- **Completed:** 2026-07-16T08:26Z
- **Tasks:** 2
- **Files modified:** 3 (2 modificados, 1 creado) + VALIDATION.md

## Accomplishments
- `deriveExpectedGroupName(task, entry, resolvedPath)`: función pura que deriva el nombre de grupo esperado del `task.ref` (Plane `IDENT-<seq>` → `IDENT`; GitHub `owner/repo#n` → basename) y decide default-vs-módulo comparando `resolvedPath` contra `entry.default` (D-01/D-02). Guarda de entrada degenerada como primera línea: `task.ref` vacío/whitespace/undefined/no-string → `null` de inmediato, sin nombre bogus.
- `resolveWorkspaceGroup(groupsJson, expectedName)`: función pura defensiva calcada de `normalizeSurface`/`buildTitleMap`. Match NFC+lowercase+trim, first-wins ante empate (D-03), never-throws ante shapes inesperados (`null`, `{}`, `groups` no-array, `name`/`ref` no-string) → `null` (D-07).
- `newWorkspaceWithGroupFallback(fn, base, group, log)`: fail-open capa 2 con `fn`/`log` inyectados. Sin grupo → una llamada; con grupo → intento con `--group`, y ante rechazo un reintento ÚNICO sin `--group` + una línea `group_skipped` (D-10/D-11). El fallo del reintento propaga.
- Cableado en `launchWorkItem`: resolución en fresco por lanzamiento envuelta en la capa 1 fail-open (try/catch sobre `list` + `JSON.parse` + derivación → `groupRef=null`). Una sola llamada cmux extra (D-12), siempre vía `host._legacy` (walker `cmux-isolation` verde), y el `newWorkspace` pasa por el helper de fallback preservando `cwd: projectPath` literal (D-04).

## Task Commits

Cada task se commiteó atómicamente (Task 1 con ciclo TDD RED→GREEN):

1. **Task 1 (RED): suite unit fallando para las 3 funciones puras** - `dda4a53` (test)
2. **Task 1 (GREEN): deriveExpectedGroupName + resolveWorkspaceGroup + newWorkspaceWithGroupFallback** - `b213e5a` (feat)
3. **Task 2: cableado en launchWorkItem + source-hygiene** - `bb0601b` (feat)

_Task 1 no necesitó fase REFACTOR: el código quedó limpio en GREEN. El código canónico de RESEARCH §Pattern 1/2/3 se replicó sin reinventar._

## Files Created/Modified
- `test/session/group-resolve.test.js` - **Creado.** 29 tests de las 3 funciones puras contra un fixture inline del shape live (`Kodo`/`SCRIBBA`/`SCP-CMRi`, RESEARCH §Pattern 2), sin FS ni cmux real. Incluye: derivación identifier vs `IDENTIFIER/Módulo`, ref degenerado → null (5 formas) piped end-to-end, `SCP` → null (Pitfall 1), never-throws (7 shapes), y el retry D-10 con `newWorkspaceFn`/`log` inyectados (dientes reales de la capa 2).
- `src/session/manager.js` - **Modificado.** 3 funciones puras exportadas nuevas junto a `deriveModuleName`; cableado en `launchWorkItem` entre `getHost('cmux')` y la construcción de `workspaceName` (capa 1) + sustitución del `newWorkspace` directo por `newWorkspaceWithGroupFallback` (capa 2). Nada de `:285` en adelante se tocó (`setColor`/`buildSessionFromTask`/`addSession`/`send`/`notify` intactos).
- `test/manager.test.js` - **Modificado.** 4 asserts source-hygiene nuevos + ajuste del invariante D-04 (la llamada directa migró al helper): resolución vía `host._legacy.listWorkspaceGroups` en try/catch, uso de `newWorkspaceWithGroupFallback(host._legacy.newWorkspace, {...}, groupRef)`, GRP-04 (regex negativo de verbos de gestión + `buildSessionFromTask` sin campos de grupo).
- `.planning/phases/77-agrupaci-n-de-workspaces-en-cmux/77-VALIDATION.md` - **Modificado.** Per-Task Verification Map a verde y `wave_0_complete: true`.

## Decisions Made
- **Las 3 funciones en `manager.js`, no en módulo aparte** (D-08, discreción resuelta por RESEARCH): misma casa que `deriveModuleName`, mismo estilo pura + JSDoc.
- **Normalización = NFC + lowercase + trim** (discreción D-03): cubre `Traça Web` (NFC) y los grupos live `Kodo`/`SCRIBBA` contra identifiers `KODO`/`SCRIBBA`.
- **`host._legacy.newWorkspace` pasado desreferenciado al fallback:** verificado que su cuerpo (`src/host/cmux.js:359`) no usa `this` — solo importa y delega —, así que la referencia detached es segura.
- **Seguridad T-77-02 (Tampering/DoS):** `JSON.parse` dentro del try/catch englobante + `resolveWorkspaceGroup` defensiva (`Array.isArray` guard + type-check por campo) → never-throws. **T-77-03 (Info Disclosure):** el `log` de degradación lleva solo el ref/motivo; verificado por el behavior assert (`log` no contiene el título de la tarea).

## Deviations from Plan
None - plan executed exactly as written. El código canónico de RESEARCH se replicó literalmente; el único ajuste de test (invariante D-04 en `manager.test.js`) estaba previsto por el plan (la llamada directa migra al helper).

## Issues Encountered
- **Flake conocido `test/gsd-lock-race.test.js` (CR-01), FUERA de alcance:** la suite completa dio 2172 pass / 1 fail / 1 skipped; el único fallo es el subtest «5 processes observing the SAME dead-PID stale lock» — el flake documentado en el plan. Confirmado no relacionado: mis ficheros tocados pasan 92/92 aislados. Anotado y no tocado, según instrucción.

## User Setup Required
None - no external service configuration required.

**Nota de operación (Pitfall 1, no es código):** con los datos reales de hoy, solo `KODO` y `SCRIBBA` auto-matchean. El grupo `SCP-CMRi` NO matchea el identifier `SCP` → las tareas de SCP se lanzan sin grupo (fail-open correcto). Para agruparlas, el operador renombra el grupo a `SCP` — acción de operador, no cambio de código.

## Next Phase Readiness
- Fase 77 completa (Plan 01 + Plan 02): la fontanería y la resolución están cableadas end-to-end.
- Invariantes verificadas: `HOST_METHODS` = 4, walker `cmux-isolation` verde, `manager.js` sin import de `cmux/client.js`, cero deps npm nuevas, cero refs `workspace_group:N` persistidos.
- Verificación manual pendiente (VALIDATION §Manual-Only): confirmar VISUALMENTE en la sidebar del operador que un nuevo workspace aterriza en `member_workspace_refs` de su grupo — requiere la app cmux GUI viva; fuera del alcance automatizable.

## Self-Check: PASSED

- Files verified on disk: `test/session/group-resolve.test.js`, `src/session/manager.js`, `test/manager.test.js`.
- Commits verified in git: `dda4a53` (test), `b213e5a` (feat), `bb0601b` (feat).
- Suite tocada: 92/92 pass (`group-resolve` + `manager` + `cmux-isolation`). Suite completa: 2172 pass / 1 skipped + flake CR-01 fuera de alcance.

---
*Phase: 77-agrupaci-n-de-workspaces-en-cmux*
*Completed: 2026-07-16*
