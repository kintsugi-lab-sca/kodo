---
phase: 77-agrupaci-n-de-workspaces-en-cmux
verified: 2026-07-16T12:00:00Z
status: passed
score: 17/18 must-haves verified
behavior_unverified: 1 # SC#1 e2e: el workspace aterriza VISUALMENTE en el grupo — presente y cableado, comportamiento final no ejercitable sin mutar la sidebar real (PROHIBIDO)
overrides_applied: 0
prohibitions_verified: 12/12
behavior_unverified_items:

  - truth: "Al lanzar una tarea cuyo grupo existe en la sidebar, el workspace aterriza dentro del grupo (SC#1 / GRP-01 end-to-end)"
    test: "Lanzar una tarea de un proyecto con grupo existente (Kodo/SCRIBBA) con la app cmux GUI viva"
    expected: "El nuevo workspace:N aparece en member_workspace_refs del grupo en `cmux workspace-group list --json` y visualmente dentro del grupo colapsable de la sidebar"
    why_human: "Requiere la app cmux GUI del operador viva y muta la sidebar real (crear workspace) — PROHIBIDO en verificación automatizada. Todas las piezas (argv --group, resolución nombre→ref, cableado) verificadas por repro independiente; solo el attach final del lado de cmux queda sin ejercitar"
human_verification:

  - test: "Lanzar una tarea de un proyecto con grupo existente (Kodo o SCRIBBA) con la app cmux GUI viva, p. ej. `kodo launch KODO-<n>`"
    expected: "El nuevo `workspace:N` aparece en `member_workspace_refs` del grupo correspondiente (`cmux workspace-group list --json`) y el workspace se ve dentro del grupo colapsable en la sidebar"
    why_human: "Confirmación visual end-to-end con la app GUI viva; crear el workspace muta la sidebar real (prohibido en verificación automatizada). Item Manual-Only ya declarado en 77-VALIDATION.md"
---

# Phase 77: Agrupación de workspaces en cmux — Verification Report

**Phase Goal:** Las sesiones que kodo lanza aterrizan en el grupo cmux de su path resuelto (`--group` en el `new-workspace` existente), con resolución nombre→ref en fresco y fail-open total; kodo consume grupos, no los gestiona.
**Verified:** 2026-07-16
**Status:** human_needed (0 gaps · 1 item manual-only conocido)
**Re-verification:** No — verificación inicial

## Metodología

Verificación goal-backward con repro PROPIO (`node -e` sobre las funciones reales exportadas de `src/session/manager.js`, fixture del JSON capturado de los 3 grupos reales Kodo/SCRIBBA/SCP-CMRi), greps de prohibiciones sobre `src/`, `git diff 68709be..HEAD` para los intocables, y ejecución de las 4 suites afectadas (101/101 pass). No se ejecutó ningún comando cmux que mute la sidebar. Los SUMMARYs y el REVIEW se usaron solo como mapa, no como evidencia.

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria (contrato)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC#1 | Workspace aterriza en el grupo (verificable en `member_workspace_refs`) | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Todas las piezas presentes, cableadas y con repro: argv incluye `--group workspace_group:1` (test client-args), `KODO-9`→`KODO`→`workspace_group:1` (repro propio), cableado en `launchWorkItem` (manager.js:388-408 + source-hygiene asserts). El attach final del lado de cmux es el item Manual-Only de 77-VALIDATION.md — ver Human Verification |
| SC#2 | Clave = path resuelto: FVF≠WAG en grupos distintos; F0..F6 de SCP colapsan al mismo | ✓ VERIFIED | Repro propio: `deriveExpectedGroupName(ROMAN-3, FVF, /roman/fvf)`→`'ROMAN/FVF'`, `(ROMAN-5, WAG, /roman/wag)`→`'ROMAN/WAG'` (distintos); `(SCP-3, F0, path==default)`→`'SCP'` (colapsa). Módulo caído al default → identifier a secas (test :87-93) |
| SC#3 | Fail-open total, cero sesiones perdidas | ✓ VERIFIED | Repro propio: capa 1 — `resolveWorkspaceGroup` devuelve null sin lanzar para null/{}/groups-no-array/name-no-string/groups-vacío; try/catch englobante en manager.js:390-396 deja `groupRef=null`. Capa 2 — stub que falla CON `--group` → exactamente 2 invocaciones (1ª con group, 2ª sin) + 1 log; stub que falla SIN `--group` → 1 invocación, cero retries, error propaga; fallo del retry → propaga (`boom`) |
| SC#4 | kodo nunca gestiona grupos ni persiste refs | ✓ VERIFIED | Grep `workspace-group` en `src/`: el único verbo ejecutado es `list` (client.js:109); resto son comentarios/JSDoc. Grep `workspace_group` en `src/`: solo 2 hits en JSDoc de manager.js, cero writes a state/config. Assert source-hygiene: `buildSessionFromTask` sin campos `group*` (manager.test.js:844-858). COVERAGE.md: 2 INTEGRATE / 15 OPT-OUT razonados |
| SC#5 | ≤1 llamada cmux extra por launch; reconcile intacto; HOST_METHODS congelado en 4 | ✓ VERIFIED | `listWorkspaceGroups` tiene UN único call site consumidor (manager.js:392, dentro de `launchWorkItem`). `git diff 68709be..HEAD -- src/session/reconcile.js src/orchestrator/launch.js` = 0 líneas; grep `group` en reconcile.js = 0. `src/host/interface.js` sin tocar (diff 0), `HOST_METHODS` = `Object.freeze` con 4 entradas |

### Observable Truths — Plan 01 (fontanería cmux)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | `--group <ref>` en argv exactamente cuando `opts.group`; sin él, argv byte-idéntico | ✓ VERIFIED | client.js:38-44 (push guardado por truthiness); tests client-args (9/9 pass): con group → par consecutivo `['--group', ref]`; sin group / group `''` → token ausente |
| 2 | `buildNewWorkspaceArgs` pura, exportada, orden determinista `--name`→`--cwd`→`--command`→`--group` | ✓ VERIFIED | Exportada (client.js:38); `newWorkspace` la invoca (:51); test de orden completo y orden estable sin `--cwd` |
| 3 | `listWorkspaceGroups()` ejecuta `workspace-group list --json` vía `run()`, devuelve stdout crudo sin parsear (D-05) | ✓ VERIFIED | client.js:108-110: `return run(['workspace-group','list','--json'])`; cero `JSON.parse` en client.js (grep -c = 0) |
| 4 | `run()` rejecta ante error/timeout → capa 1 gratis para el caller (GRP-03) | ✓ VERIFIED | client.js:17-21: `execFile` con `timeout: 15_000`, `reject(new Error(...))` en err — la rejección cae en el try/catch de manager.js:390-396 |
| 5 | `host._legacy.listWorkspaceGroups` passthrough lazy-import fiel; walker verde; HOST_METHODS en 4 (D-06) | ✓ VERIFIED | host/cmux.js:387-389: `(await import('../cmux/client.js')).listWorkspaceGroups()`; el `return` de :392 expone los 4 métodos + `_legacy` (método nuevo NO en el contrato); `cmux-isolation.test.js` verde (en los 101/101) |

### Observable Truths — Plan 02 (funciones puras + cableado)

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Launch con grupo existente → `--group <ref>` resuelto → miembro del grupo (GRP-01) | ⚠️ = SC#1 | Deduplicado con SC#1 (mismo item, contado una vez) |
| 2 | `deriveExpectedGroupName`: flat/path==default → identifier; módulo con path propio → `IDENTIFIER/Módulo`; F0..F6 colapsan | ✓ VERIFIED | Repro propio (los 4 casos) + 6 tests dedicados en group-resolve.test.js |
| 3 | Identifier desde `task.ref` sin config: Plane `IDENT-<seq>`→`IDENT`; GitHub `owner/repo#n`→basename | ✓ VERIFIED | Repro: `KODO-9`→`KODO`, `SCRIBBA-12`→`SCRIBBA`; tests: `SCP-42`→`SCP` (A2), `acme/x#7`→`x` (A1) |
| 4 | Empate: dos grupos con mismo nombre normalizado → PRIMERO de la lista (D-03) | ✓ VERIFIED | Repro propio: `[' Dev ':10, 'DEV':11]` con `'dev'` → `workspace_group:10`. Determinista |
| 5 | Lista vacía / `groups` ausente / JSON malformado → null → sin `--group`; never-throws (D-07) | ✓ VERIFIED | Repro propio: `{groups:[]}`→null, `null`→null, `expectedName null`→null; 7 shapes en test con `assert.doesNotThrow` |
| 6 | `workspace-group list` falla → try/catch → `groupRef=null` → launch exactamente como hoy (capa 1) | ✓ VERIFIED | manager.js:389-396: try/catch englobante sobre derive+list+parse+resolve; `groupRef` inicializado a null; con null, `newWorkspaceWithGroupFallback` llama fn UNA vez con baseOpts sin `group` (repro) y `buildNewWorkspaceArgs` sin group produce argv byte-idéntico (test) |
| 7 | TOCTOU: `new-workspace --group` falla → UN reintento sin `--group` que crea el workspace (D-10 capa 2) | ✓ VERIFIED | Repro propio con stub: 1er intento con group rechaza → 2º sin group devuelve `workspace:50`; exactamente 1 línea de log |
| 8 | Retry EXACTAMENTE una vez, solo con `--group` presente; fallo del retry propaga | ✓ VERIFIED | Repro propio: fallo sin group → 1 invocación, cero retries, propaga; fallo de ambos intentos → 2 invocaciones, propaga `boom` |
| 9 | ≤1 llamada cmux por lanzamiento, cero en reconcile (D-12) | ✓ VERIFIED | = SC#5. Único call site en `launchWorkItem`; reconcile.js diff 0 y grep group 0 |

**Score:** 17/18 truths verificadas (1 presente, behavior-unverified — el e2e manual-only)

### Prohibiciones (must_haves.prohibitions — 12/12 verificadas)

| # | Prohibición | Status | Evidence |
| --- | ---------- | ------ | -------- |
| P01-1 | Solo verbo `list` de workspace-group en client.js | ✓ VERIFIED | Grep: única ejecución es client.js:109 `['workspace-group','list','--json']` |
| P01-2 | HOST_METHODS congelado en 4; método nuevo solo en `_legacy` | ✓ VERIFIED | interface.js sin tocar (diff 0); `Object.freeze` con 4 entradas; return de host/cmux.js:392 inalterado en shape |
| P01-3 | Cero dependencias npm nuevas | ✓ VERIFIED | `git diff 68709be..HEAD -- package.json package-lock.json` = 0 líneas |
| P01-4 | Parseo JSON NO en client.js (D-05) | ✓ VERIFIED | 0 ocurrencias de `JSON.parse` en client.js; el parseo vive en manager.js:393 dentro del try/catch |
| P01-5 | cmux confinado a `src/host/`+`src/cmux/`: no se introduce ejecución fuera | ✓ VERIFIED | El diff de la fase toca solo 6 ficheros; los imports preexistentes de `cmux/client` (dispatcher, server, hooks, orchestrator) NO cambiaron; walker verde |
| P02-1 | Cero verbos de gestión de grupos en manager.js | ✓ VERIFIED | Grep + assert source-hygiene negativo (manager.test.js:829-843) |
| P02-2 | Cero refs `workspace_group:N` persistidos en state/config | ✓ VERIFIED | Grep `workspace_group` en src/ = solo JSDoc; `buildSessionFromTask` sin campos `group*` (assert :844-858); `groupRef` se pasa a `newWorkspaceWithGroupFallback` y se descarta |
| P02-3 | manager.js no importa `cmux/client.js` — todo vía `host._legacy` | ✓ VERIFIED | Imports de manager.js limpios; hits de `cmux/client` en manager.js son comentarios; walker `cmux-isolation.test.js` verde |
| P02-4 | `buildSessionFromTask`/`setColor`/`addSession`/`send`/`notify` sin tocar; orden de efectos preservado | ✓ VERIFIED | Grep sobre el diff de manager.js: cero líneas +/- tocan esas llamadas; el único reemplazo es la llamada directa `newWorkspace` → `newWorkspaceWithGroupFallback` (el cambio previsto) |
| P02-5 | Hooks, state.json, server.js, reconcile intactos; cero endpoints; cero deps | ✓ VERIFIED | diff --stat: solo client.js, host/cmux.js, manager.js + 3 ficheros de test |
| P02-6 | Sin version-check de cmux (D-09) | ✓ VERIFIED | Grep `version` × `cmux` en manager.js = 0; el soporte se deriva del éxito/fallo de la llamada |
| P02-7 | Log de degradación solo identifier/ref/motivo, nunca título de tarea (D-11) | ✓ VERIFIED | manager.js:395 (`resolucion_fallo`, motivo fijo) y :214 (`retry_sin_grupo <ref>`); test asserta que el log NO contiene `Secreto del usuario` (título) |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/cmux/client.js` | `buildNewWorkspaceArgs` + `--group` + `listWorkspaceGroups` | ✓ VERIFIED | Existente, sustantivo (+35 líneas), cableado (newWorkspace lo consume; host/_legacy lo importa) |
| `src/host/cmux.js` | espejo `_legacy.listWorkspaceGroups` | ✓ VERIFIED | Passthrough lazy-import fiel (:387-389), consumido por manager.js:392 |
| `src/session/manager.js` | 3 funciones puras + cableado en `launchWorkItem` | ✓ VERIFIED | Exportadas (:143, :178, :209), cableadas (:388-408); datos reales fluyen (task.ref del provider → derive → list en fresco → resolve → argv) |
| `test/cmux/client-args.test.js` | suite pura del argv | ✓ VERIFIED | 9 tests, pass |
| `test/session/group-resolve.test.js` | unit puro de las 3 funciones + fixture live | ✓ VERIFIED | 29 tests con el fixture real capturado (Kodo/SCRIBBA/SCP-CMRi), pass |
| `test/manager.test.js` | asserts source-hygiene del cableado + GRP-04 | ✓ VERIFIED | 4 asserts nuevos Phase 77 (:786-858), pass |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `host._legacy.listWorkspaceGroups` | `cmux/client.js listWorkspaceGroups` | lazy import | ✓ WIRED | host/cmux.js:388 — único punto de entrada, walker verde |
| `buildNewWorkspaceArgs` | argv de execFile | `opts.group` → `--group <ref>` array element | ✓ WIRED | client.js:42 + :51-52; sin shell (T-77-01) |
| `launchWorkItem` | `newWorkspace` con grupo | derive → list → JSON.parse (try/catch) → resolve → `newWorkspaceWithGroupFallback(host._legacy.newWorkspace, {name,cwd}, groupRef)` | ✓ WIRED | manager.js:388-408; cadena completa reproducida con fixture real |
| `deriveExpectedGroupName` | `resolveProjectPath`/`deriveModuleName` | consume outputs, no re-lee projects.json | ✓ WIRED | manager.js:155 (deriveModuleName), :391 recibe `projectPath` ya resuelto |
| `newWorkspaceWithGroupFallback` | retry D-10 con dientes | `newWorkspaceFn` + `log` inyectados | ✓ WIRED | Repro propio con stubs: 2 invocaciones exactas, 1 log |

### Behavioral Spot-Checks (repro propio, sin cmux real)

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Cadena KODO-9 → grupo Kodo | `node -e` con funciones reales + fixture live | `'KODO'` → `workspace_group:1` | ✓ PASS |
| Cadena SCP-3 (path scp-cmri) → sin grupo | ídem | `'SCP'` → `null` (Pitfall 1: no matchea `SCP-CMRi` — fail-open correcto, nota de operación) | ✓ PASS |
| FVF vs WAG → nombres distintos | ídem | `'ROMAN/FVF'` ≠ `'ROMAN/WAG'` | ✓ PASS |
| D-10 retry único con --group | stub que rechaza 1ª vez | 2 invocaciones (1ª con group, 2ª sin), ref devuelto, 1 log | ✓ PASS |
| D-10 sin --group → cero retries | stub que siempre rechaza, group=null | 1 invocación, error propaga | ✓ PASS |
| Empate first-wins / empty→null / expected null→null | fixtures | `workspace_group:10` / `null` / `null` | ✓ PASS |
| Unicode NFD↔NFC (sonda WR-02) | name NFD `Traça Web` vs expected NFC | matchea → `workspace_group:7` (el código es correcto) | ✓ PASS |
| Suites afectadas | `node --test` × 4 ficheros | 101/101 pass, 0 fail | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| GRP-01 | 77-01, 77-02 | `new-workspace` incluye `--group <ref>` cuando hay grupo coincidente | ✓ SATISFIED* | Argv + resolución + cableado verificados; *attach visual final = item human |
| GRP-02 | 77-02 | Derivación determinística por path resuelto | ✓ SATISFIED | Repro FVF≠WAG, F0..F6 colapsan, formato `IDENTIFIER/Módulo` |
| GRP-03 | 77-01, 77-02 | Resolución en fresco + fail-open total | ✓ SATISFIED | En fresco por launch (call site único, sin caché); 2 capas reproducidas |
| GRP-04 | 77-01, 77-02 | No crea/renombra/borra grupos; no persiste refs | ✓ SATISFIED | 12/12 prohibiciones verificadas; COVERAGE.md 15 OPT-OUT razonados |

Sin requirements huérfanos: REQUIREMENTS.md mapea exactamente GRP-01..04 a Phase 77 y ambos planes los reclaman.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | Cero TBD/FIXME/XXX/HACK/PLACEHOLDER en los 6 ficheros del diff | — | — |

### Evaluación de las 2 Warnings del review (WR-01 / WR-02)

**WR-01 — identifier derivado `''` con refs degenerados `'#7'`/`'-9'`.** Reproducido: `deriveExpectedGroupName({ref:'#7'})` → `''`, `{ref:'-9'}` → `''`, `'#7'`+módulo → `'/FVF'`; y `resolveWorkspaceGroup({groups:[{name:'  ',ref:'workspace_group:9'}]}, '')` → `workspace_group:9`. **Veredicto: deuda menor, NO gap.** Razones: (a) el truth del plan enumera explícitamente los degenerados cubiertos (`''`, whitespace, `undefined`, no-string) y TODOS devuelven null — el contrato escrito se cumple; `'#7'`/`'-9'` quedan fuera de esa enumeración; (b) el disparo exige un provider emitiendo refs patológicos (normalize.js construye `IDENT-seq`; `'-9'` requiere identifier de proyecto vacío aguas arriba) Y un grupo del operador con nombre solo-whitespace en la sidebar — doble improbabilidad; (c) contra el fixture real, `''` → null; (d) la consecuencia es cosmética (grupo equivocado), nunca una sesión perdida — GRP-03 intacto. GRP-02 (determinismo) no se rompe: mismo input → mismo output. Sí contradice el JSDoc de la función («NO deriva un nombre bogus») — deriva documental. Fix recomendado (5 líneas, el del review) para la siguiente fase de higiene.

**WR-02 — invariante Unicode sin test.** Reproducido: la sonda NFD↔NFC pasa (el `.normalize('NFC')` funciona), pero la suite tiene cero bytes no-ASCII en names de grupo. **Veredicto: deuda menor de cobertura de regresión, NO gap.** GRP-02 tiene evidencia conductual independiente (esta verificación ejecutó la sonda contra el código real); lo que falta es la red de regresión si alguien elimina el `.normalize('NFC')` mañana. El `<behavior>` del plan 77-02 sí reclamaba «forma Unicode» y el test :155 solo cubre caso/espacios — incompletitud de la tarea de test, no del comportamiento entregado. Fix recomendado: el test de 4 líneas propuesto en el review.

Ninguna de las dos compromete un requirement: el fail-open (la garantía dura de la fase) queda intacto en ambos escenarios.

### Human Verification Required

#### 1. Aterrizaje visual end-to-end en la sidebar (SC#1 / GRP-01)

**Test:** Con la app cmux GUI viva y los grupos `Kodo`/`SCRIBBA` existentes, lanzar una tarea real (p. ej. `kodo launch KODO-<n>`).
**Expected:** El nuevo `workspace:N` aparece en `member_workspace_refs` del grupo en `cmux workspace-group list --json` y el workspace se ve dentro del grupo colapsable en la sidebar. Una tarea SCP (grupo `SCP-CMRi` no matchea `SCP`) se lanza SIN grupo y la sesión funciona igual — para agruparlas, el operador renombra el grupo a `SCP` (acción de operador, no de código).
**Why human:** Requiere la GUI viva; crear el workspace muta la sidebar real (prohibido en verificación automatizada). Item Manual-Only ya declarado en 77-VALIDATION.md.

### Gaps Summary

Sin gaps. Los 5 Success Criteria del ROADMAP y los 14 truths de los planes están verificados con repro independiente, salvo el attach visual final (SC#1 e2e), que es el item manual-only conocido y declarado. Las 12 prohibiciones (GRP-04 y quirúrgicas) verificadas por grep/diff/asserts. Las 2 Warnings del review (WR-01 identifier bogus en refs patológicos, WR-02 cobertura Unicode) son deuda menor documentada — ninguna compromete GRP-02/GRP-03 ni el fail-open.

---

_Verified: 2026-07-16_
_Verifier: Claude (gsd-verifier)_
