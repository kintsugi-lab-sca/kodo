# Phase 79: Sidebar Doctor - Research

**Researched:** 2026-07-23
**Domain:** CLI determinista espejo de `gsd doctor` (scan+execute, DI, never-throws) + gestión no-destructiva de `workspace-group` de cmux + re-derivación offline del grupo esperado
**Confidence:** HIGH (seams de código leídos línea a línea; sintaxis y shapes de cmux 0.64.20 verificados en vivo read-only; precedentes de source-hygiene localizados)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-15)

- **D-01:** Scan 100% offline / 0 red. Inputs = `state.json` (sesiones con `workspace_ref`, `task_ref`, `project_path`, `started_at`), `projects.json`, y cmux (`workspace-group list --json` + `workspace list`). **Ninguna llamada al provider.**
- **D-02:** Grupo esperado se re-deriva reutilizando `deriveExpectedGroupName` (`src/session/manager.js:144`) con un task-like: `ref` ← `session.task_ref`; módulo por **reverse-lookup determinista** en `projects.json` (si `session.project_path` ≠ `entry.default` y coincide con un path de `entry.modules`, el nombre del módulo es esa key; first-match estable). Paths == default → identifier a secas.
- **D-03:** Descartado persistir `expected_group` en el session record (tocaría launch path, arriesga SDR-04). No se modifica ningún escritor de `state.json`.
- **D-04:** El doctor solo agrupa/mueve workspaces **correlacionados con sesiones kodo** (`state.json`, match por `workspace_ref`). Workspaces del operador jamás se tocan.
- **D-05:** `ungroup` aplica a grupos con **0 miembros** (no destructivo, no cierra workspaces). Dry-run lista siempre todos los candidatos antes de `--fix`.
- **D-06:** Fail-open per item (espejo `gsd/doctor.js`): item ilegible o shape inesperado → skip con warning, nunca aborta el pase. `scan` no muta; `execute` re-detecta antes de actuar (guard TOCTOU).
- **D-07:** "Grupo disuelto" == **grupo faltante cuyo nombre esperado tiene ≥1 sesión kodo viva**: mismo remedio que grupo faltante (`create` + `add` + `set-anchor`). No se persiste estado nuevo.
- **D-08:** "Miembro más longevo" = sesión con `started_at` más antiguo (orden lexicográfico ISO-8601; empate → orden estable de la lista). `set-anchor` apunta a su `workspace_ref`.
- **D-09:** Orden determinista por grupo: `create` → `add`(s) → `set-anchor`. El report lista en ese mismo orden (DX-06).
- **D-10:** Sintaxis exacta de `cmux workspace-group create/add/set-anchor/ungroup` **verificada empíricamente** (ver §Standard Stack — hecho en este research contra 0.64.20).
- **D-11:** Mitad pura en `src/cmux/sidebar-doctor.js` (scan+execute con DI, never-throws, defaults lazy, LOG-12). CLI en `src/cli/sidebar-doctor.js`. Registro en `src/cli.js`: `program.command('sidebar')` + subcomando `doctor` (espejo namespace `gsd`, `src/cli.js:424-476`).
- **D-12:** Funciones cmux nuevas en `src/cmux/client.js` vía `run()` existente (execFile, timeout 15s, argv plano) — **exclusivamente** el allowlist `create`, `add`, `set-anchor`, `ungroup`. Actualizar el comentario GRP-04 de `listWorkspaceGroups`.
- **D-13:** Exit codes y `--json` espejo de `gsd doctor`: dry-run → `hasActions ? 1 : 0` (patrón `gsd-doctor.js:66`); `--json` byte-determinista TTY/no-TTY (DX-06). Exit en `--fix` replica `gsd-doctor.js`.
- **D-14:** Guard source-hygiene automático (SDR-02): test que escanea `src/` y **falla** si aparece `workspace-group` cableado con `delete`. Espejo de guards existentes.
- **D-15:** SDR-04 por construcción + evidencia: launch path NO se edita (`newWorkspaceWithGroupFallback`, `buildNewWorkspaceArgs`, call-site `manager.js:411`); tests golden GRP-01..03 pasan sin modificación. Helpers compartidos → exports nuevos sin tocar los existentes.

### Claude's Discretion

- Naming interno del report (`missing_group` / `loose_workspace` / `empty_group`), formato de la salida humana del CLI, eventos nuevos en `logger-events.js`, estructura de tests — siguiendo convenciones de `gsd-doctor`.

### Deferred Ideas (OUT OF SCOPE)

- **FUT-03** — puerta LLM para ambigüedad de agrupación (YAGNI).
- **FUT-02** — `kodo doctor --fix` asistido config.json↔projects.json (v2).
- **FUT-01** — fidelidad markdown del overlay.
- Carril orquestador (Phase 80, ORCH-07..08), saneo deuda v0.17 (Phase 81, DEBT-01..04).
- `workspace-group delete` (NI SE CABLEA — LOCKED), sidebar como trigger, renombrar `SCP-CMRi`→`SCP` (acción de operador).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SDR-01 | `kodo sidebar doctor` (dry-run) lista acciones clasificadas — grupo faltante→`create`, suelto→`add`, disuelto→re-crear/`set-anchor`, vacío→`ungroup` — sin ejecutar | `scan()` puro espejo `gsd/doctor.js:405`; categorías + `hasActions` (§Architecture Pattern 1); sintaxis de acciones verificada (§Standard Stack) |
| SDR-02 | `--fix` usa **exclusivamente** el allowlist; `delete` no existe en código + guard source-hygiene | Allowlist `create/add/set-anchor/ungroup` verificado; guard calca `manager.test.js:906` + `hygiene-api-key.test.js` (§Don't Hand-Roll, §Validation) |
| SDR-03 | Detección 100% determinista, 0 tokens — reutiliza `deriveExpectedGroupName` + `listWorkspaceGroups` | Ambas funciones puras existentes; reverse-lookup módulo offline (§Pattern 2). Ningún import de provider/LLM |
| SDR-04 | Launch path byte-idéntico — GRP-01..03 intactos | Launch path no se edita (D-15); helpers nuevos aditivos; golden GRP-01..03 (§Common Pitfall 4) |
| SDR-05 | Sesiones adoptadas/lanzadas convergen al grupo esperado en el siguiente pase | Resuelve frontera D-13 Phase 77: `add` de workspace suelto a grupo existente + `create` cuando falta (§Pattern 1) |
| SDR-06 | CLI espejo de `gsd doctor` — `--json` byte-determinista, exit codes deterministas | `runGsdDoctor` (`src/cli/gsd-doctor.js`) plantilla exacta; `hasActions ? 1 : 0` (§Pattern 3) |
</phase_requirements>

## Summary

Phase 79 crea `kodo sidebar doctor`, un doctor determinista del sidebar de cmux que es **espejo arquitectónico exacto** del par ya en producción `src/gsd/doctor.js` (mitad pura scan/execute, DI, never-throws, fail-open per item, TOCTOU re-check, LOG-12) + `src/cli/gsd-doctor.js` (dry-run por defecto / `--fix`, `--json` byte-determinista, exit `hasGarbage ? 1 : 0`). La totalidad de la lógica nueva es: (1) una mitad pura en `src/cmux/sidebar-doctor.js` que compara sesiones kodo de `state.json` contra el estado real del sidebar (`workspace-group list --json`), (2) un handler CLI en `src/cli/sidebar-doctor.js`, (3) 4 passthroughs finos en `src/cmux/client.js` (`create/add/set-anchor/ungroup`), y (4) el registro `program.command('sidebar')` en `src/cli.js`. Reutiliza directamente `deriveExpectedGroupName` y `resolveWorkspaceGroup` (`manager.js`) — cero red, cero tokens.

Verifiqué en vivo contra el binario instalado (**cmux 0.64.20**, sube desde el 0.64.19 de Phase 77) toda la familia `workspace-group`. La sintaxis del allowlist es: `create [--name <name>] [--cwd <path>] [--from <id>,<id>...]`, `add --group <group> --workspace <ws>`, `set-anchor --group <group> --workspace <ws>`, `ungroup <group>`. Confirmé que `delete <group>` existe y es **destructivo** ("Delete a group AND close every workspace inside it") — por eso el LOCKED de no cablearlo. Crucial y verificado en vivo: los grupos del operador HOY se llaman `Kodo`, `itclip`, `roman/optiai`, `scp`, `pchat/v2` — nombres en minúsculas y con `/` que **auto-matchean** los identifiers derivados vía la normalización NFC+lowercase de `resolveWorkspaceGroup` (`roman/optiai` ↔ `ROMAN/OptiAI`, `scp` ↔ `SCP`). Esto valida el caso de fricción de origen (OptiAI suelta).

**Primary recommendation:** Calca `gsd/doctor.js` a la letra. `scan(deps)` produce un `SidebarReport` con 3 categorías (`missing_group`, `loose_workspace`, `empty_group`) + `protected` + `hasActions`; `execute(deps,{fix:true})` re-detecta (D-06) y emite el allowlist en orden `create→add→set-anchor` por grupo (D-09), fail-open per item. El CLI clona `runGsdDoctor` cambiando solo scan/execute/render. Un `create` seguido de un re-`list` obtiene el ref del grupo nuevo (no dependas de parsear el stdout de `create` — ver Open Question 1). Guard source-hygiene: calca `hygiene-api-key.test.js` (walker `src/`) prohibiendo `workspace-group` + `delete` como argv adyacentes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Re-derivar nombre de grupo esperado offline | Pure logic (`sidebar-doctor.js` + reuso `manager.js`) | — | Función pura sobre session record + projects.json; testeable sin cmux (D-02) |
| Detectar categorías (`scan`) | Pure logic (`src/cmux/sidebar-doctor.js`) | — | No muta, no I/O destructivo; consume JSON ya parseado (D-06/D-07) |
| Ejecutar allowlist cmux (`execute`) | cmux client (`src/cmux/client.js`) | `sidebar-doctor.js` (política) | cmux confinado a `src/cmux/`; el `run()` argv-plano es el único canal (D-12) |
| Ritual CLI dry-run/`--fix`/`--json`/exit | CLI handler (`src/cli/sidebar-doctor.js`) | `src/cli.js` (registro) | Espejo exacto de `gsd-doctor.js` (D-11/D-13) |
| Fail-open per item + TOCTOU re-check | `sidebar-doctor.js execute` | — | La política de skip/re-detección es del doctor, no del cliente |
| Guard de ausencia de `delete` | Test source-hygiene | — | SDR-02 verificado mecánicamente, no por revisión humana (D-14) |

## Standard Stack

**Sin dependencias npm nuevas** (invariante cross-milestone LOCKED). Todo con built-ins + assets existentes.

### Core
| Módulo | Versión | Propósito | Por qué estándar |
|--------|---------|-----------|------------------|
| `node:child_process` (`execFile` vía `run()`) | built-in | Ejecutar los 4 subcomandos del allowlist | `client.js run()` ya tiene timeout 15s, argv plano sin shell, logger opcional (`src/cmux/client.js:14`) |
| `JSON.parse` en función pura defensiva | built-in | Parsear `workspace-group list --json` / `workspace list --json` | Patrón `resolveWorkspaceGroup` (never-throws, `manager.js:189`) |
| `deriveExpectedGroupName` | `manager.js:144` | Re-derivar el nombre esperado desde un task-like | Función pura ya lista, guards de ref degenerado (SDR-03) `[VERIFIED: lectura directa]` |
| `resolveWorkspaceGroup` | `manager.js:189` | Nombre esperado → ref `workspace_group:N`, NFC+lowercase+trim | Match defensivo ya probado (SDR-03) `[VERIFIED: lectura directa]` |
| cmux binary | **0.64.20 (100)** instalado (Phase 77 usó 0.64.19) | Provee `workspace-group create/add/set-anchor/ungroup` | Dependencia externa; soporte derivado del fallo de la llamada, no de version-check (espejo D-09 Phase 77) `[VERIFIED: cmux 0.64.20 en vivo]` |

### Sintaxis del allowlist (verificada en vivo — cmux 0.64.20, `workspace-group --help`)

```
list [--json]
create [--name <name>] [--cwd <path>] [--from <id>,<id>...]
       Defaults --from to the active sidebar selection / caller workspace when omitted.
ungroup <group>           Dissolve a group, preserving all members
delete <group>            Delete a group AND close every workspace inside it. Destructive.   ← PROHIBIDO (LOCKED)
add --group <group> --workspace <ws>
remove --workspace <ws>                                                                        ← no en allowlist
set-anchor --group <group> --workspace <ws>
rename <group> --name <new>                                                                    ← no en allowlist
```
`<group>` acepta UUID **o** el ref `workspace_group:N` impreso por `list`. `--workspace <ws>` acepta `workspace:N` — que es exactamente el shape de `session.workspace_ref`. **Todos** los subcomandos honran `--json`. `[VERIFIED: cmux 0.64.20 workspace-group --help, 2026-07-23]`

**Refs argv-planos (crítico para D-12/V5):** el ref viaja como elemento de array (`run(['workspace-group','add','--group', ref, '--workspace', ws])`), jamás interpolado en string — cero superficie de inyección, espejo de `buildNewWorkspaceArgs` (`client.js:38`).

### Alternatives Considered
| En vez de | Podría usar | Tradeoff |
|-----------|-------------|----------|
| `create --from <refs>` con todos los miembros | `create --name` solo + `add` cada uno | `--from` puebla en un paso; pero D-09 exige orden explícito y set-anchor final igual. Recomendado: `create --from <oldest>` para fijar anchor inicial, luego `add` el resto, luego `set-anchor` (idempotente) |
| Re-`list` tras `create` para obtener el ref | Parsear stdout de `create --json` | Re-list es robusto y no depende de un shape de output sin verificar (Open Question 1). Coste: 1 llamada cmux extra por grupo creado — aceptable en el carril `--fix` |
| Reverse-lookup módulo en `projects.json` | Persistir `expected_group` al lanzar | Persistir tocaría launch path (viola SDR-04, D-03). Reverse-lookup es offline y puro |

**Installation:** N/A — cero paquetes. cmux ya en `/Applications/cmux.app/Contents/Resources/bin/cmux`, resuelto vía `loadConfig().cmux.binary`.

**Version verification:** `cmux 0.64.20 (100)` confirmado con `cmux --version` el 2026-07-23. `[VERIFIED: cmux binary en vivo]`

## Package Legitimacy Audit

No aplica: la fase no instala paquetes externos (cero deps npm nuevas — invariante cross-milestone). Nada que auditar.

## Architecture Patterns

### System Architecture Diagram

```
kodo sidebar doctor [--fix] [--json]                       [src/cli/sidebar-doctor.js — espejo gsd-doctor.js]
  │
  │ (SIN ensureConfig — no toca provider; solo state.json/projects.json/cmux)
  ▼
scan(deps) ─────────────────────────────────────────────  [src/cmux/sidebar-doctor.js — PURO, never-throws]
  │  inputs (todos DI, defaults lazy):
  │    loadState()            → sesiones kodo (workspace_ref, task_ref, project_path, started_at)  [state.js]
  │    loadProjects()         → projects.json (reverse-lookup módulo)                              [config.js]
  │    listWorkspaceGroups()  → workspace-group list --json  {groups:[{name,ref,member_workspace_refs,anchor_workspace_ref,member_count}]}
  │    listWorkspaces()       → workspace list --json        {workspaces:[{ref,...}]}  (liveness de refs)
  │
  ├─ por cada sesión kodo viva:
  │     expectedName = deriveExpectedGroupName(taskLike, entry, session.project_path)   [manager.js:144, REUSO]
  │     groupRef     = resolveWorkspaceGroup(groupsJson, expectedName)                  [manager.js:189, REUSO]
  │     agrupa sesiones por expectedName → convergentes
  │
  ├─ CLASIFICA (3 categorías deterministas):
  │     missing_group   : expectedName con ≥1 sesión kodo viva y SIN grupo (o disuelto) → create+add+set-anchor  (D-07)
  │     loose_workspace : sesión cuyo workspace_ref ∉ member_workspace_refs del grupo existente → add            (SDR-05)
  │     empty_group     : grupo con member_count 0 → ungroup                                                      (D-05)
  │     protected       : workspaces del operador / sesiones ya bien agrupadas (NO afecta exit)                  (D-04)
  │
  ▼  SidebarReport { missing_group[], loose_workspace[], empty_group[], protected, hasActions }
  │
  │  exit = hasActions ? 1 : 0   (calculado ANTES del render, espejo gsd-doctor.js:66)   (D-13)
  │
  ├─ dry-run  → render humano por categoría / --json byte-determinista
  │
  └─ --fix → execute(deps,{fix:true}) ─────────────────  [re-detecta D-06, NO consume el report de scan]
        por grupo, orden D-09:  create --from <oldest> --name <expected>
                                → re-list para obtener ref nuevo
                                → add --group <ref> --workspace <ws> (resto)
                                → set-anchor --group <ref> --workspace <oldest>   (D-08 miembro más longevo)
        loose:  add --group <ref> --workspace <ws>
        empty:  ungroup <ref>
        cada acción en try/catch → error registrado, continúa (fail-open per item, D-06)
```

El launch path (`manager.js:400-440`) **NO se toca** — sigue solo-`list` + `--group` fail-open (SDR-04/D-15). El reconcile loop no gana llamadas cmux.

### Recommended Project Structure

```
src/
├── cmux/
│   ├── client.js          # +4 passthroughs: createWorkspaceGroup/addToWorkspaceGroup/setGroupAnchor/ungroupWorkspaceGroup
│   │                       #  +comentario GRP-04 de listWorkspaceGroups actualizado (re-fronterización)
│   └── sidebar-doctor.js   # NUEVO — mitad pura scan()+execute() con DI (espejo src/gsd/doctor.js)
├── cli/
│   └── sidebar-doctor.js   # NUEVO — handler runSidebarDoctor (espejo src/cli/gsd-doctor.js)
├── cli.js                  # +program.command('sidebar').command('doctor') (espejo namespace gsd :424-476)
└── logger-events.js        # +eventos sidebarDoctorScan/Fix* (discreción — taxonomía espejo doctor*)
test/
├── cmux/sidebar-doctor.test.js   # NUEVO — unit puro scan/execute con fixtures del JSON live
├── cli/sidebar-doctor-cli.test.js # NUEVO — dry-run/--fix/--json/exit (espejo gsd-doctor-cli.test.js)
└── sidebar-doctor-hygiene.test.js # NUEVO — guard SDR-02 (walker src/, prohíbe delete)
```

**Nota de aislamiento (walker `cmux-isolation.test.js`):** el walker escanea SOLO `src/cli/dashboard`, `src/session`, `src/cli/polling.js` (verificado `test/host/cmux-isolation.test.js:71-75`). `src/cmux/sidebar-doctor.js` vive **dentro** de `src/cmux/`, así que puede importar `src/cmux/client.js` para sus defaults lazy DI — exactamente como `src/gsd/doctor.js` importa sus impls reales. `src/cli/sidebar-doctor.js` importa de `sidebar-doctor.js` (scan/execute), nunca de `client.js`. Cero riesgo de regresión del walker.

### Pattern 1: Clasificación determinista (scan puro)

**What:** Comparar sesiones kodo de `state.json` contra el sidebar real y clasificar en 3 categorías.
**When to use:** Una vez por invocación, en `scan()`. Nunca muta.

```javascript
// Source: espejo de src/gsd/doctor.js:405 (scan) + reuso manager.js:144/189
// [VERIFIED: shapes live capturados 2026-07-23; funciones puras leídas]
export function scan(deps = {}) {
  const d = resolveDeps(deps);
  let state, projects, groupsJson, workspacesJson;
  try { state = d.loadState(); } catch { state = { sessions: {} }; }        // never-throws (D-06)
  try { projects = d.loadProjects(); } catch { projects = {}; }
  try { groupsJson = JSON.parse(d.listWorkspaceGroupsRaw()); } catch { groupsJson = { groups: [] }; }
  try { workspacesJson = JSON.parse(d.listWorkspacesRaw()); } catch { workspacesJson = { workspaces: [] }; }

  const liveWorkspaceRefs = new Set((workspacesJson.workspaces || []).map((w) => w?.ref));
  const memberOf = buildMemberIndex(groupsJson);   // workspace:N -> [group refs]

  // Agrupar sesiones kodo vivas por nombre esperado (D-02 reverse-lookup módulo)
  const byExpected = new Map();  // expectedName -> [{session, workspace_ref, started_at}]
  for (const s of Object.values(state.sessions || {})) {
    if (!s || s.alive === false) continue;               // solo sesiones vivas (D-04)
    if (!liveWorkspaceRefs.has(s.workspace_ref)) continue; // workspace ya cerrado → nada que agrupar
    const entry = projects[s.project_id];
    const expected = deriveExpectedGroupName(taskLikeFrom(s, projects), entry, s.project_path);
    if (!expected) continue;                              // ref degenerado → fail-open (guard reuso)
    (byExpected.get(expected) || byExpected.set(expected, []).get(expected)).push(s);
  }

  const missing_group = [], loose_workspace = [];
  for (const [expected, sessions] of byExpected) {
    const groupRef = resolveWorkspaceGroup(groupsJson, expected);
    if (!groupRef) {
      // grupo faltante O disuelto (D-07): mismo remedio
      const ordered = sortByOldest(sessions);            // D-08: started_at ISO asc, empate estable
      missing_group.push({ name: expected, anchor: ordered[0].workspace_ref,
                           members: ordered.map((s) => s.workspace_ref) });
    } else {
      // grupo existe: ¿algún miembro suelto? (SDR-05)
      for (const s of sessions) {
        const groups = memberOf.get(s.workspace_ref) || [];
        if (!groups.includes(groupRef)) {
          loose_workspace.push({ group: groupRef, workspace_ref: s.workspace_ref, name: expected });
        }
      }
    }
  }
  // grupos vacíos (D-05) — defensivo; cmux disuelve al cerrar anchor, así que es raro
  const empty_group = (groupsJson.groups || [])
    .filter((g) => g && g.member_count === 0)
    .map((g) => ({ ref: g.ref, name: g.name }));

  const hasActions = missing_group.length + loose_workspace.length + empty_group.length > 0;
  return { missing_group, loose_workspace, empty_group, protected: {/*...*/}, hasActions };
}
```

### Pattern 2: Reverse-lookup del módulo offline (D-02)

**What:** Reconstruir el task-like para `deriveExpectedGroupName` sin red. El módulo se obtiene comparando `session.project_path` contra `entry.modules`.
**When to use:** Por sesión, dentro de `scan`.

```javascript
// Source: D-02 + shape real de projects.json (~/.kodo/projects.json)
// [VERIFIED: projects.json es Record<UUID, string | {default:string, modules:Record<name,path>}>]
function taskLikeFrom(session, projects) {
  const entry = projects[session.project_id];
  let moduleName = null;
  if (entry && typeof entry === 'object' && entry.modules && session.project_path !== entry.default) {
    // reverse-lookup determinista: primer módulo cuyo path == project_path (first-match estable)
    for (const [name, path] of Object.entries(entry.modules)) {
      if (path === session.project_path) { moduleName = name; break; }
    }
  }
  // deriveExpectedGroupName llama deriveModuleName(task) → task.groups[0]; alimentamos groups=[moduleName]
  return { ref: session.task_ref, groups: moduleName ? [moduleName] : [] };
}
```

**Verificación del contrato:** `deriveModuleName(task)` retorna `task.groups[0] || null` (`manager.js`, consumido en :166). `deriveExpectedGroupName` deriva el identifier de `task.ref` (Plane `KODO-9`→`KODO`; GitHub `owner/repo#7`→`repo`) y compone `IDENTIFIER/Módulo` solo si `resolvedPath !== entry.default`. Al pasarle `session.project_path` como `resolvedPath` y el módulo correcto, la re-derivación offline es idéntica a la del launch. `[VERIFIED: manager.js:144-173]`

### Pattern 3: CLI espejo de runGsdDoctor (D-11/D-13/SDR-06)

**What:** Clonar `runGsdDoctor` cambiando solo scan/execute/render. Exit `hasActions ? 1 : 0` calculado antes del render; `--json` no usa el formatter (byte-determinista).
**When to use:** El handler `runSidebarDoctor`.

```javascript
// Source: calco literal de src/cli/gsd-doctor.js:53-84
// [VERIFIED: lectura directa]
export async function runSidebarDoctor(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const fmt   = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  const scanFn = deps.scanFn || realScan;
  const executeFn = deps.executeFn || realExecute;

  const report = scanFn(deps);                       // 1. SIEMPRE scan primero
  const exitCode = report.hasActions ? 1 : 0;        // 2. exit ANTES del render (D-13)
  let result = null;
  if (opts.fix) result = await executeFn(deps, { fix: true });  // 3. mutar solo bajo --fix

  if (opts.json) {                                   // 4. --json byte-determinista
    write(JSON.stringify(opts.fix ? { ...report, executed: result } : report, null, 2) + '\n');
  } else {
    renderHuman({ report, result, fix: !!opts.fix, write, fmt });
  }
  return exitCode;
}
```

**Registro en `src/cli.js`** (espejo del namespace `gsd` :424-476, SIN `ensureConfig` — como `gsd doctor` :466):

```javascript
const sidebar = program.command('sidebar').description('cmux sidebar hygiene (workspace groups)');
sidebar.command('doctor')
  .description('Detect (dry-run) and fix (--fix) cmux sidebar group drift: missing/dissolved groups, loose workspaces, empty groups')
  .option('--fix', 'Execute the non-destructive allowlist (create/add/set-anchor/ungroup); no prompt')
  .option('--json', 'Emit the structured report as JSON (scriptable, byte-deterministic)')
  .action(async (opts) => {
    try {
      const { runSidebarDoctor } = await import('./cli/sidebar-doctor.js');
      process.exit(await runSidebarDoctor({ fix: opts.fix || false, json: opts.json || false }));
    } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
  });
```

### Pattern 4: Passthroughs del allowlist en client.js (D-12)

```javascript
// Source: calco de listWorkspaceGroups (client.js:108) — argv plano, run() reusado
// [VERIFIED: sintaxis cmux 0.64.20 en vivo]
/** create --from <ref>[,<ref>...] --name <name> → devuelve stdout crudo (ref se obtiene por re-list, ver OQ1) */
export async function createWorkspaceGroup({ name, from }) {
  const args = ['workspace-group', 'create'];
  if (name) args.push('--name', name);
  if (from && from.length) args.push('--from', from.join(','));  // from = ['workspace:3', ...]
  return run(args);
}
export async function addToWorkspaceGroup({ group, workspace }) {
  return run(['workspace-group', 'add', '--group', group, '--workspace', workspace]);
}
export async function setGroupAnchor({ group, workspace }) {
  return run(['workspace-group', 'set-anchor', '--group', group, '--workspace', workspace]);
}
export async function ungroupWorkspaceGroup({ group }) {
  return run(['workspace-group', 'ungroup', group]);   // <group> posicional
}
// NOTA: NINGÚN deleteWorkspaceGroup. El guard source-hygiene (D-14) lo verifica.
```

### Anti-Patterns to Avoid

- **Cablear `delete` "por completitud".** LOCKED: `delete` cierra todos los workspaces del grupo. El guard falla si aparece. Usa `ungroup` (preserva miembros).
- **Consumir el report de `scan` como plan en `execute`.** D-06: `execute` RE-detecta (loadState/list frescos) y re-chequea antes de cada acción — igual que `gsd/doctor.js:494`. Un grupo pudo crearse/borrarse entre scan y execute.
- **Parsear JSON en `client.js`.** El parseo defensivo vive en la función pura (patrón D-05 Phase 77 preservado).
- **Tocar workspaces del operador.** D-04: solo `workspace_ref` presentes en `state.json` y vivos. Un `add`/`set-anchor` jamás apunta a un workspace no-kodo.
- **Persistir cualquier ref `workspace_group:N`.** GRP-04 re-fronterizado: se permite GESTIONAR grupos, pero sigue prohibido persistir refs en `state.json`/config.
- **Depender del anchor que elige `create --from`.** Es no verificado; por eso D-09 termina en `set-anchor` explícito (idempotente).
- **Version-check de cmux.** Espejo D-09 Phase 77: el soporte se deriva del fallo de la llamada (fail-open per item).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Derivar el nombre esperado de grupo | Re-implementar strip de identifier + composición módulo | `deriveExpectedGroupName` (`manager.js:144`) | Cross-provider, guards de ref degenerado, ya testeado (SDR-03) |
| Resolver nombre→ref | Match ad-hoc con `.toLowerCase()` | `resolveWorkspaceGroup` (`manager.js:189`) | NFC+lowercase+trim + validación de shape `workspace_group:N`, never-throws |
| Ejecutar cmux con timeout + stderr | `execFile` nuevo en sidebar-doctor.js | `run()` de `client.js:14` vía los 4 passthroughs | timeout 15s, argv plano, rejecta en err = fail-open gratis |
| Ritual dry-run/`--fix`/`--json`/exit | Handler CLI desde cero | Calco de `runGsdDoctor` (`gsd-doctor.js:53`) | Exit y byte-determinismo ya resueltos (SDR-06) |
| Scan/execute con DI never-throws | Estructura nueva | Calco de `src/gsd/doctor.js` (resolveDeps/emptyResult/pushError) | Fail-open per item + TOCTOU ya probados en producción |
| Guard source-hygiene | Grep manual | Calco de `hygiene-api-key.test.js` (walker `src/` + `stripComments`) o `manager.test.js:906` | Detector no-trivial anti falso-positivo/negativo ya escrito |

**Key insight:** Casi todo el código ya existe. Phase 79 es 90% cableado por espejo (doctor + CLI) + 4 passthroughs de una línea + 2 funciones puras reutilizadas verbatim. El riesgo real está en el CONTRATO (sintaxis cmux, ya verificada; scoping de `empty_group`, ver Open Question 2) y en NO regresionar el launch path (SDR-04).

## Runtime State Inventory

> Fase de integración/feature con gestión de estado externo (cmux sidebar). Incluida para verificar qué persiste y qué es efímero.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** en kodo — el doctor LEE `state.json` (nunca escribe; invariante `withStateLock` intacto por no escribir) y `projects.json` (solo lectura). Ningún ref `workspace_group:N` se persiste (GRP-04 re-fronterizado). | Ninguna. Verificar en el guard que `sidebar-doctor.js` no importa ningún escritor de state (`saveState`/`withStateLock`/`upsertTaskHandoff`) |
| Live service config | **cmux sidebar** — el `--fix` SÍ muta estado vivo de cmux (crea/agrupa/re-ancla grupos). Es el propósito de la fase. NO exportado a git; vive en el runtime de la app cmux. `delete` (cierra workspaces) NI SE CABLEA. | Documentar que `--fix` es mutante; dry-run por defecto; allowlist no-destructivo |
| OS-registered state | **None** — sin registros OS. | Ninguna |
| Secrets/env vars | **None** — no toca secretos. `CMUX_QUIET=1` opcional (silencia aviso legacy), no secreto. | Ninguna |
| Build artifacts | **None** — sin artefactos. Ficheros nuevos son código fuente. | Ninguna |

## Common Pitfalls

### Pitfall 1: `create` sin `--from` agarra el workspace del caller (headless / determinismo)

**What goes wrong:** El help dice *"Defaults `--from` to the active sidebar selection / caller workspace when omitted."* Si el doctor corre `create --name X` sin `--from`, cmux inventa el miembro inicial desde el "caller workspace" — que bajo el daemon kodo (launchd, sin sesión GUI) es ambiguo o vacío, rompiendo el determinismo y potencialmente creando el grupo con el workspace equivocado.
**Why it happens:** El default de `--from` es contextual, no vacío.
**How to avoid:** **SIEMPRE** pasar `--from` explícito con los `workspace_ref` de las sesiones kodo convergentes. Nunca omitirlo. El scan ya conoce los miembros exactos (D-08).
**Warning signs:** Un grupo creado con un workspace del operador dentro, o `create` que falla bajo el daemon.

### Pitfall 2: El ref del grupo recién creado no se conoce hasta re-`list`

**What goes wrong:** `create` no garantiza (sin verificar) devolver el ref `workspace_group:N` en un shape parseble; encadenar `add`/`set-anchor` necesita ese ref.
**Why it happens:** El stdout de `create` no está verificado (no se ejecutó comando mutante en este research — ver Open Question 1).
**How to avoid:** Tras `create`, re-ejecutar `listWorkspaceGroups()` y resolver el ref por nombre con `resolveWorkspaceGroup(json, expectedName)`. Robusto e independiente del output de `create`. Coste: 1 llamada cmux extra por grupo creado (aceptable en `--fix`). Alternativa: el executor verifica el shape de `create --json` contra un grupo throwaway y, si trae `ref`, lo usa directo.
**Warning signs:** `add` con ref `undefined` → cmux rechaza → fail-open lo salta pero el grupo queda a medio poblar.

### Pitfall 3: Nombres de grupo del operador cambian entre versiones (contrato de matching)

**What goes wrong:** En Phase 77 (2026-07-16) los grupos eran `Kodo`/`SCRIBBA`/`SCP-CMRi`. HOY (2026-07-23) son `Kodo`/`itclip`/`roman/optiai`/`scp`/`pchat/v2`. El operador renombra a mano; el matching NFC+lowercase debe seguir cubriendo.
**Why it happens:** Los nombres de grupo son elección libre del operador.
**How to avoid:** Confiar en `resolveWorkspaceGroup` (NFC+lowercase+trim, first-match). Verificado en vivo: `roman/optiai`↔`ROMAN/OptiAI` ✓, `scp`↔`SCP` ✓. El caso `SCP-CMRi` de Phase 77 ya no existe (el operador lo renombró a `scp`) — el doctor ahora SÍ agruparía tareas SCP. La aceptación con datos reales cubre estos nombres HOY; el test usa fixtures del JSON live.
**Warning signs:** Tareas que se quedan sueltas pese a existir un grupo con nombre "parecido" pero que no normaliza igual.

### Pitfall 4: Regresión del launch path (SDR-04)

**What goes wrong:** Añadir un helper compartido tocando `newWorkspaceWithGroupFallback`/`buildNewWorkspaceArgs`/el call-site `manager.js:411` cambia el golden GRP-01..03.
**Why it happens:** Tentación de "reutilizar" refactorizando en vez de añadir.
**How to avoid:** D-15: launch path **no se edita**. Helpers nuevos son exports aditivos. Los tests golden GRP-01..03 (`test/manager.test.js`, `test/session/group-resolve.test.js`) deben pasar **sin modificación** — ese es el criterio de éxito 4. El guard source-hygiene puede además afirmar que las líneas del launch path no cambian de forma.
**Warning signs:** Cualquier diff en `manager.js:400-440` o en los tests GRP-01..03.

### Pitfall 5: Grupos vacíos casi nunca existen (empty_group defensivo)

**What goes wrong:** Se sobre-diseña la categoría `empty_group` asumiendo que es común. cmux **disuelve** el grupo al cerrar su anchor ("Closing the anchor dissolves the group while preserving its other members as ungrouped workspaces" — help verificado). Un grupo con 0 miembros es un estado transitorio raro.
**Why it happens:** El modelo mental "grupo vacío = basura" no encaja con la semántica de auto-disolución de cmux.
**How to avoid:** Implementar `empty_group→ungroup` como camino defensivo (member_count === 0), pero no invertir esfuerzo desproporcionado. Ver Open Question 2 sobre el scoping (¿qué grupos vacíos ungroup-ear?).
**Warning signs:** Tests que fabrican grupos vacíos como si fueran el caso principal.

## Code Examples

### execute() — orden D-09 con re-detección (fail-open per item)

```javascript
// Source: espejo de src/gsd/doctor.js:483 (execute) — re-detecta, try/catch por acción
// [VERIFIED: patrón leído; sintaxis cmux 0.64.20]
export async function execute(deps = {}, opts = {}) {
  const result = emptyResult();
  if (!opts.fix) return result;                     // dry-run usa scan() para mostrar
  const d = resolveDeps(deps);
  try {
    const report = scan(deps);                      // RE-detección fresca (D-06)
    // missing_group: create → add → set-anchor (D-09)
    for (const g of report.missing_group) {
      try {
        await d.createWorkspaceGroup({ name: g.name, from: [g.anchor] });   // --from oldest fija anchor inicial
        const ref = resolveWorkspaceGroup(JSON.parse(d.listWorkspaceGroupsRaw()), g.name);  // OQ1: re-list
        if (!ref) { pushError(result, d.logger, 'missing_group', g.name, 'ref no resuelto tras create'); continue; }
        for (const ws of g.members) if (ws !== g.anchor) {
          try { await d.addToWorkspaceGroup({ group: ref, workspace: ws }); result.added++; }
          catch (e) { pushError(result, d.logger, 'add', ws, errMsg(e)); }
        }
        try { await d.setGroupAnchor({ group: ref, workspace: g.anchor }); }  // D-08 idempotente
        catch (e) { pushError(result, d.logger, 'set-anchor', g.anchor, errMsg(e)); }
        result.created++;
      } catch (e) { pushError(result, d.logger, 'create', g.name, errMsg(e)); }
    }
    for (const l of report.loose_workspace) {
      try { await d.addToWorkspaceGroup({ group: l.group, workspace: l.workspace_ref }); result.added++; }
      catch (e) { pushError(result, d.logger, 'add', l.workspace_ref, errMsg(e)); }
    }
    for (const e of report.empty_group) {
      try { await d.ungroupWorkspaceGroup({ group: e.ref }); result.ungrouped++; }
      catch (err) { pushError(result, d.logger, 'ungroup', e.ref, errMsg(err)); }
    }
  } catch (err) { pushError(result, d.logger, 'execute', 'top-level', errMsg(err)); }  // never-throws
  return result;
}
```

### Shape live de `workspace-group list --json` (cmux 0.64.20, 2026-07-23)

```json
{
  "groups": [
    { "anchor_workspace_ref": "workspace:3", "custom_color": null, "icon_symbol": null,
      "is_collapsed": false, "is_pinned": true, "member_count": 3,
      "member_workspace_refs": ["workspace:3","workspace:4","workspace:36"],
      "name": "Kodo", "ref": "workspace_group:1" },
    { "name": "roman/optiai", "ref": "workspace_group:4", "member_count": 1,
      "anchor_workspace_ref": "workspace:12", "member_workspace_refs": ["workspace:12"] },
    { "name": "scp", "ref": "workspace_group:6", "member_count": 1,
      "anchor_workspace_ref": "workspace:18", "member_workspace_refs": ["workspace:18"] }
  ],
  "window_ref": "window:1"
}
```
`[VERIFIED: cmux 0.64.20 workspace-group list --json, 2026-07-23]` — mismo shape que Phase 77 (campos estables). Nota: el JSON usa comillas con espacio (`"key" : value`), irrelevante para `JSON.parse`.

### Shape live de `workspace list --json` (para liveness de refs)

Un workspace object tiene keys: `current_directory, custom_color, custom_title, description, has_custom_title, index, latest_conversation_message, latest_submitted_at, latest_submitted_message, listening_ports, pinned, ref, remote, selected, title`. **NO hay ningún campo de grupo** en el workspace object — la membresía SOLO se obtiene de `member_workspace_refs` en `workspace-group list --json`. Por eso el scan cruza ambas listas. `[VERIFIED: cmux 0.64.20, keys enumeradas en vivo]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| kodo consume grupos cmux (solo `list` + `--group`), gestión PROHIBIDA (GRP-04 Phase 77) | Gestión permitida SOLO en el carril doctor (`create/add/set-anchor/ungroup`), launch sigue solo-list | v0.18 Phase 79 (esta fase) | Re-fronterización consciente de GRP-04; actualizar el comentario de `listWorkspaceGroups` (D-12) |
| cmux 0.64.19 (Phase 77) | cmux 0.64.20 (100) | 2026-07 | Sintaxis `workspace-group` idéntica; shapes estables. Sin impacto de versión |
| Grupos operador `Kodo`/`SCRIBBA`/`SCP-CMRi` | `Kodo`/`itclip`/`roman/optiai`/`scp`/`pchat/v2` | operador renombró | El caso `scp` ahora auto-matchea (antes `SCP-CMRi` no); friccción OptiAI resuelta por el doctor |

**Deprecated/outdated:** `new-workspace` sigue siendo alias legacy de `workspace create` (aviso silenciable `CMUX_QUIET=1`) — fuera de scope, no migrar. `delete` existe pero LOCKED fuera del código.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `create` NO devuelve el ref del grupo nuevo en un shape parseable fiable, por eso se re-`list`. No verificado (no se ejecutó comando mutante contra el sidebar del operador). | Pitfall 2 / Open Question 1 | Bajo — el re-list es robusto pase lo que pase; si `create --json` sí trae `ref`, es una optimización opcional. El executor lo confirma con un grupo throwaway |
| A2 | `add` sobre un workspace que ya está en OTRO grupo lo MUEVE (no falla). No verificado en vivo (mutante). | Pattern 4 / execute | Medio — si `add` falla en ese caso, un workspace mal-agrupado no converge; fail-open lo salta con warning. Executor verifica |
| A3 | `set-anchor` requiere que el workspace ya sea miembro del grupo; por eso va DESPUÉS de `add` (D-09). Inferido del modelo "anchor es un miembro". | Pattern 3 / execute | Bajo — el orden D-09 (create→add→set-anchor) lo garantiza; si además set-anchor acepta no-miembros, no cambia nada |
| A4 | Un grupo con `member_count: 0` puede existir transitoriamente pese a la auto-disolución de cmux. No observado en vivo (todos los grupos live tienen ≥1 miembro). | Pitfall 5 | Muy bajo — si nunca ocurre, la categoría `empty_group` es dead code inofensivo; ungroup es no-destructivo |
| A5 | El daemon kodo (launchd, sin GUI) puede ejecutar `workspace-group create/add/...` y mutar el sidebar. Phase 77 confirmó que `list` funciona headless; los verbos mutantes se asumen equivalentes. | Environment | Medio — si los verbos mutantes fallan headless, `--fix` bajo el daemon (piggyback Phase 80) no converge, pero fail-open per item evita crash. El operador puede correr `kodo sidebar doctor --fix` desde la GUI. Executor verifica bajo launchd real (opcional, precedente Open Question 1 de Phase 77) |

### Post-UAT correction (G-79-1)

El UAT en vivo destapó un modelo que A1–A5 no capturaron: en **cmux 0.64.20 el header de un grupo ES la representación sidebar de su anchor**. Al auto-crear un grupo anclado (`--from`/`set-anchor`) en la sesión kodo viva más longeva (D-08), esa sesión perdía su fila y su título visibles (absorción de identidad — sin pérdida de datos, `custom_title` intacto). Reportado por el operador como "Fatal! se ha cargado una sesión en vivo".

Resolución ratificada por checkpoint (Plan 04, Opción A): **`missing_group` pasa a report-only / advisory**. `execute()` deja de emitir `create`/`set-anchor` — el doctor nunca ancla un grupo en una sesión viva. El operador crea el grupo una vez (eligiendo su anchor conscientemente) y el doctor lo mantiene poblado vía `add` (SDR-05 intacto) + `ungroup` de vacíos. Esto **supera las decisiones LOCKED D-07** (grupo faltante/disuelto → create+add+set-anchor) **y D-08** (anchor = miembro más longevo) y la política de re-anclaje eventual. `scan()` excluye `missing_group` de `hasActions` y expone `hasAdvisories` para que el CLI y el piggyback de Phase 80 distingan deriva auto-arreglable de acción del operador (y `--fix` converja a exit 0 sin bucle).

## Open Questions

1. **¿`create` devuelve el ref del grupo en `--json`?**
   - What we know: `create [--name] [--cwd] [--from]` existe y honra `--json`; el shape del output no se capturó (comando mutante — NO ejecutado contra el sidebar del operador).
   - What's unclear: Si `create --json` trae `{ ref: "workspace_group:N" }` directamente.
   - Recommendation: Implementar con re-`list` + `resolveWorkspaceGroup` (robusto, independiente del output). El executor puede optimizar tras verificar con un grupo throwaway. No bloquea la fase.

2. **¿Qué grupos vacíos debe `ungroup` el doctor (scoping de `empty_group`)?**
   - What we know: D-05 dice "grupos con 0 miembros". D-04 dice "solo workspaces correlacionados con sesiones kodo". Un grupo vacío no tiene workspaces, así que no hay sesión kodo que lo correlacione — el doctor no puede saber si es un grupo que kodo creó o uno del operador (sin ownership marker; GRP-04 prohíbe persistir refs).
   - What's unclear: Si ungroup-ear TODO grupo vacío (incluidos posibles grupos vacíos del operador) o solo los que normalizan a un nombre "kodo-plausible" derivable de `projects.json`.
   - Recommendation: `ungroup` es no-destructivo (0 miembros → no cierra nada; solo elimina un contenedor vacío). El riesgo de tocar un grupo del operador es nulo en datos. Opción conservadora: ungroup solo grupos vacíos cuyo nombre normalizado coincida con un expected-name derivable del conjunto de sesiones/projects.json. **Decisión para el planner** — recomiendo la conservadora por principio de mínima sorpresa, documentando que es defensivo (Pitfall 5: raro que ocurra).

3. **¿`--fix` bajo el daemon launchd muta el sidebar correctamente? (A5)**
   - What we know: Phase 77 confirmó `list` headless OK. Los verbos mutantes no se probaron headless (mutantes).
   - Recommendation: No bloquea Phase 79 (el CLI funciona desde la GUI del operador). Phase 80 (piggyback en `kodo check`) es quien depende de headless — el executor puede diferir la verificación empírica a Phase 80 o hacer un smoke test bajo launchd. Fail-open per item cubre el peor caso.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| cmux binary | `workspace-group create/add/set-anchor/ungroup/list`, `workspace list` | ✓ | 0.64.20 (100) | cmux viejo/ausente → cada llamada falla → fail-open per item (skip con warning, dry-run muestra 0 acciones) |
| `node:child_process` | `run()` passthrough | ✓ | built-in | — |
| `state.json` | scan inputs | ✓ | — | ausente → `{ sessions: {} }` → 0 acciones (never-throws D-06) |
| `projects.json` | reverse-lookup módulo | ✓ | — | ausente → `{}` → módulo null → identifier a secas (fail-open) |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** cmux ausente/viejo o JSON de sesiones ausente degradan a "0 acciones detectadas" vía fail-open — el doctor nunca crashea (SDR-06 exit determinista).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none (scripts en `package.json`) |
| Quick run command | `node --test test/cmux/sidebar-doctor.test.js` |
| Full suite command | `node --test` (script `test` de package.json) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SDR-01 | `scan` clasifica missing/loose/empty desde fixtures del JSON live; dry-run no muta | unit (puro) | `node --test test/cmux/sidebar-doctor.test.js` | ❌ Wave 0 |
| SDR-01 | render dry-run lista acciones en orden D-09 (create→add→set-anchor) | unit (CLI) | `node --test test/cli/sidebar-doctor-cli.test.js` | ❌ Wave 0 |
| SDR-02 | `execute` emite SOLO el allowlist; ninguna acción `delete` | unit (DI del run, spy de argv) | idem sidebar-doctor.test.js | ❌ Wave 0 |
| SDR-02 | **guard source-hygiene**: `src/` no contiene `workspace-group`+`delete` cableado ni `deleteWorkspaceGroup` | source-hygiene (walker) | `node --test test/sidebar-doctor-hygiene.test.js` | ❌ Wave 0 |
| SDR-03 | reverse-lookup módulo offline; `deriveExpectedGroupName`/`resolveWorkspaceGroup` reutilizados; sin import de provider/LLM | unit + source | idem + assert de imports | ❌ Wave 0 |
| SDR-04 | golden GRP-01..03 pasan **sin modificación**; launch path (`manager.js:400-440`) sin diff | regression + source-hygiene | `node --test test/manager.test.js test/session/group-resolve.test.js` | ✅ existen |
| SDR-05 | sesión suelta (workspace_ref ∉ member_workspace_refs) → categoría `loose_workspace` → `add` | unit (puro) | idem sidebar-doctor.test.js | ❌ Wave 0 |
| SDR-06 | `--json` byte-determinista TTY/no-TTY; exit `hasActions ? 1 : 0` en dry-run y `--fix` | unit (CLI) | idem sidebar-doctor-cli.test.js | ❌ Wave 0 |
| — | walker `cmux-isolation` sigue verde (sidebar-doctor.js en src/cmux/ no es scanned) | structural | `node --test test/host/cmux-isolation.test.js` | ✅ existe |

### Sampling Rate
- **Per task commit:** `node --test test/cmux/sidebar-doctor.test.js test/cli/sidebar-doctor-cli.test.js test/sidebar-doctor-hygiene.test.js`
- **Per wave merge:** `node --test test/manager.test.js test/session/group-resolve.test.js test/host/cmux-isolation.test.js` (regresión SDR-04) + los nuevos
- **Phase gate:** Suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/cmux/sidebar-doctor.test.js` — unit puro de scan/execute con fixtures del JSON live (los 5 grupos reales) + DI del `run`/list (spy de argv para SDR-02) + caso `loose_workspace` (SDR-05) + caso `missing_group` con anchor = oldest (D-08).
- [ ] `test/cli/sidebar-doctor-cli.test.js` — calco de `test/gsd-doctor-cli.test.js`: dry-run/`--fix`/`--json`/exit codes (SDR-06).
- [ ] `test/sidebar-doctor-hygiene.test.js` — calco de `test/hygiene-api-key.test.js` (walker `src/` + `stripComments`) O de `test/manager.test.js:906`: prohíbe `/workspace-group['"\s]*[,\s]+['"]?delete/` y `\bdeleteWorkspaceGroup\b` (SDR-02/D-14). Incluir un bloque "detector no es trivial" con fixture con-fuga que DEBE fallar.
- [ ] Asegurar que los golden GRP-01..03 NO se editan (SDR-04) — si el planner añade helpers compartidos, que sean exports nuevos.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | La fase no toca auth |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | JSON de cmux parseado en función pura defensiva (`resolveWorkspaceGroup` never-throws; `Array.isArray(groups)`, type-check por campo, ref validado `^workspace_group:\d+$`). Los `workspace_ref`/`task_ref` vienen de `state.json` (escrito por kodo bajo lock), no de red |
| V6 Cryptography | no | — |

### Known Threat Patterns for {node CLI + cmux exec}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Inyección de comando vía ref/nombre de grupo | Tampering | `execFile` con **argv array** (`run(['workspace-group','add','--group',ref,'--workspace',ws])`) — NUNCA shell. Refs como elementos de array, sin interpolación (espejo `buildNewWorkspaceArgs`) `[VERIFIED: client.js usa execFile]` |
| Acción destructiva `delete` (cierra workspaces) | Denial of Service / Destruction | `delete` NI SE CABLEA (LOCKED); guard source-hygiene automático falla si aparece (SDR-02/D-14). Solo `ungroup` (no-destructivo) |
| Tocar workspaces del operador | Tampering | D-04: solo `workspace_ref` presentes en `state.json` y vivos (cruzados con `workspace list`); jamás un ref no-kodo |
| JSON malicioso/malformado de cmux | Tampering / DoS | Función pura defensiva + `JSON.parse` en try/catch; shape inesperado → categoría vacía + warn (never-throws D-06) |
| Escritura corruptiva de `state.json` | Tampering | El doctor **no escribe** `state.json` (solo lectura); invariante `withStateLock` intacto por construcción |
| Cuelgue de cmux headless | DoS | `run()` timeout 15s; expira → reject → fail-open per item. `--fix` re-detecta pero cada acción está aislada en try/catch |

## Sources

### Primary (HIGH confidence)
- `cmux 0.64.20 (100)` binario instalado — `--version`, `workspace-group --help` (todos los subcomandos), `workspace-group list --json`, `workspace list --json`, `workspace list --help` (ejecutados read-only 2026-07-23). AUTORIDAD sobre la sintaxis del allowlist.
- `src/gsd/doctor.js` (:1-622) + `src/cli/gsd-doctor.js` (:1-180) — plantilla arquitectónica leída línea a línea (scan/execute/DI/never-throws/exit).
- `src/session/manager.js` (:120-237) — `deriveExpectedGroupName`, `resolveWorkspaceGroup`, `newWorkspaceWithGroupFallback`, launch path :400-440 (NO tocar).
- `src/cmux/client.js` (:1-121) — `run()`, `listWorkspaceGroups`, `buildNewWorkspaceArgs`.
- `src/session/state.js` (:23-63) — shape del Session record (`workspace_ref`, `task_ref`, `project_id`, `project_path`, `started_at`, `alive`).
- `~/.kodo/projects.json` — shape real `Record<UUID, string | {default, modules}>` (reverse-lookup módulo).
- `src/cli.js` (:400-497) — patrón de registro del namespace `gsd` (sin `ensureConfig`).
- `test/hygiene-api-key.test.js` (:1-60) + `test/manager.test.js` (:906-940) — precedentes de guard source-hygiene.
- `test/host/cmux-isolation.test.js` (:22-80) — scope del walker (`src/cli/dashboard`, `src/session`, `src/cli/polling.js`).

### Secondary (MEDIUM confidence)
- `.planning/milestones/v0.17-phases/77-.../77-RESEARCH.md` — shapes pre-verificados de Phase 77 (contraste de versión y nombres de grupo).
- `79-CONTEXT.md`, `REQUIREMENTS.md`, `STATE.md` — decisiones LOCKED (no re-derivadas).

### Tertiary (LOW confidence)
- Comportamiento de los verbos MUTANTES de cmux (`create`/`add`/`set-anchor`) — sintaxis verificada por `--help`, semántica de movimiento/anchor y output de `create --json` NO ejecutados (mutarían el sidebar del operador). Ver Assumptions A1-A5.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps; sintaxis cmux 0.64.20 verificada en vivo; funciones puras reutilizadas leídas.
- Architecture: HIGH — `gsd/doctor.js` + `gsd-doctor.js` son plantilla exacta; walker de aislamiento acotado.
- Pitfalls: HIGH — shapes live capturados; nombres de grupo cruzados contra identifiers reales.
- Semántica de verbos mutantes: MEDIUM — sintaxis HIGH, comportamiento de movimiento/anchor/output inferido (no mutado); fail-open per item cubre las 5 assumptions.

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (estable; re-verificar solo si cmux sube de versión mayor o cambia el shape de `workspace-group`/`workspace list --json`)
</content>
