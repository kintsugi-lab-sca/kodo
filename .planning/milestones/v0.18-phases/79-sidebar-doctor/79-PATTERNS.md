# Phase 79: Sidebar Doctor - Pattern Map

**Mapped:** 2026-07-23
**Files analyzed:** 7 (4 nuevos código + 1 modificado + 3 nuevos test) — CONTEXT D-11/D-12, RESEARCH §Recommended Project Structure
**Analogs found:** 7 / 7 (todos con analog exacto en el codebase)

> Fase de "espejo": ~90% del código nuevo se calca de `src/gsd/doctor.js` + `src/cli/gsd-doctor.js`. Los analogs son literales, no aproximados. El planner debe referenciar líneas concretas al escribir cada plan.

## File Classification

| Fichero nuevo/modificado | Rol | Data Flow | Analog más cercano | Calidad match |
|--------------------------|-----|-----------|--------------------|---------------|
| `src/cmux/sidebar-doctor.js` (NUEVO) | service (pure scan/execute, DI) | transform + event-driven | `src/gsd/doctor.js` | exacto |
| `src/cli/sidebar-doctor.js` (NUEVO) | cli handler | request-response | `src/cli/gsd-doctor.js` | exacto |
| `src/cmux/client.js` (MODIFICADO) | client (passthrough execFile) | request-response | `listWorkspaceGroups`/`buildNewWorkspaceArgs` mismo fichero | exacto (mismo fichero) |
| `src/cli.js` (MODIFICADO) | route/registro | config | bloque namespace `gsd` (`:424-476`) | exacto (mismo fichero) |
| `src/logger-events.js` (MODIFICADO, discreción) | utility (pure transform) | transform | eventos `doctorScan/doctorFix*` | exacto |
| `test/cmux/sidebar-doctor.test.js` (NUEVO) | test (unit puro + DI spy) | — | `test/gsd-doctor*` + patrón DI | role-match |
| `test/cli/sidebar-doctor-cli.test.js` (NUEVO) | test (CLI dry-run/--fix/--json) | — | `test/gsd-doctor-cli.test.js` | role-match |
| `test/sidebar-doctor-hygiene.test.js` (NUEVO) | test (source-hygiene walker) | — | `test/hygiene-api-key.test.js` | exacto |

## Pattern Assignments

### `src/cmux/sidebar-doctor.js` (service pure, scan/execute + DI)

**Analog:** `src/gsd/doctor.js` (calco arquitectónico completo)

**Cabecera + imports (LOG-12) — `src/gsd/doctor.js:28-56`:**
El módulo vive dentro de `src/cmux/`, así que a diferencia de las restricciones del walker `cmux-isolation` (que solo escanea `src/cli/dashboard`, `src/session`, `src/cli/polling.js` — RESEARCH §Nota de aislamiento), **puede** importar `src/cmux/client.js` para los defaults lazy. NO importa `logger.js` (LOG-12): usa `noopLogger` de `../logger-noop.js`.
```javascript
// Espejo doctor.js:34-45 — imports de node built-ins + impls reales para defaults lazy DI
import { noopLogger } from '../logger-noop.js';                    // LOG-12: nunca logger.js
import { loadState as realLoadState } from '../session/state.js';
import { deriveExpectedGroupName, resolveWorkspaceGroup } from '../session/manager.js'; // REUSO verbatim
import { listWorkspaceGroups, createWorkspaceGroup, addToWorkspaceGroup,
         setGroupAnchor, ungroupWorkspaceGroup, listWorkspaces } from './client.js';
// loadProjects desde ../config.js para el reverse-lookup de módulo (D-02)
```

**DI con defaults lazy — `src/gsd/doctor.js:188-208`:**
```javascript
function resolveDeps(deps = {}) {
  return {
    loadState: deps.loadState || realLoadState,
    // ... cada primitiva DI con su default real lazy ...
    logger: deps.logger || noopLogger,   // default seguro: never-throws al emitir eventos
  };
}
```
Para sidebar-doctor los deps son: `loadState`, `loadProjects`, `listWorkspaceGroupsRaw` (stdout crudo, parse defensivo en la pura — RESEARCH Anti-Pattern "Parsear JSON en client.js"), `listWorkspacesRaw`, los 4 verbos del allowlist, `now`, `logger`.

**scan() puro never-throws — `src/gsd/doctor.js:405-406`** (estructura) + **RESEARCH Pattern 1 (`79-RESEARCH.md:191-238`)** (implementación concreta ya escrita): cada input en try/catch con fallback (`state={sessions:{}}`, `groups=[]`), clasifica en `missing_group`/`loose_workspace`/`empty_group` + `protected` + `hasActions`. Reutiliza `deriveExpectedGroupName` (`manager.js:144`) y `resolveWorkspaceGroup` (`manager.js:189`) verbatim.

**taskLikeFrom (reverse-lookup módulo D-02) — RESEARCH Pattern 2 (`79-RESEARCH.md:249-260`):** reconstruye `{ ref: session.task_ref, groups: [moduleName] }` buscando el módulo por `entry.modules[name] === session.project_path`. Contrato verificado contra `manager.js:166` (`deriveModuleName` → `task.groups[0]`).

**execute() re-detecta (TOCTOU D-06) — `src/gsd/doctor.js:483-484`** (estructura `emptyResult()` + `if (!opts.fix) return`) + **RESEARCH Code Example (`79-RESEARCH.md:412-443`)** (orden D-09 create→add→set-anchor, try/catch por acción). Clave: `execute` **re-llama a `scan(deps)`** para re-detectar, NO consume el report del scan externo (RESEARCH Anti-Pattern "Consumir el report de scan como plan").

**pushError (fail-open jamás silencioso) — `src/gsd/doctor.js:618-621`:**
```javascript
function pushError(result, log, category, target, reason) {
  result.errors.push({ category, target, reason });
  if (log) doctorFixError(log, { category, reason, target });  // sidebar → evento propio
}
```

---

### `src/cli/sidebar-doctor.js` (cli handler, request-response)

**Analog:** `src/cli/gsd-doctor.js` (calco literal)

**Handler runSidebarDoctor — `src/cli/gsd-doctor.js:53-84`** (la plantilla exacta; RESEARCH Pattern 3 `:273-290` ya adapta el nombre):
```javascript
export async function runGsdDoctor(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  const scanFn = deps.scanFn || realScan;
  const executeFn = deps.executeFn || realExecute;

  const report = scanFn(deps);                       // 1. SIEMPRE scan primero
  const exitCode = report.hasGarbage ? 1 : 0;        // 2. exit ANTES del render (sidebar → hasActions)
  let result = null;
  if (opts.fix) result = await executeFn(deps, { fix: true });  // 3. mutar solo bajo --fix
  if (opts.json) {                                   // 4. --json byte-determinista, NO usa formatter
    const payload = opts.fix ? { ...report, executed: result } : report;
    write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    renderHuman({ report, result, fix: !!opts.fix, write, err, fmt });
  }
  return exitCode;
}
```
> Cambio único vs. gsd: `report.hasGarbage` → `report.hasActions`. Import `{ scan, execute }` desde `../cmux/sidebar-doctor.js` (NUNCA desde `client.js` — RESEARCH §Nota de aislamiento).

**Color isolation — `src/cli/gsd-doctor.js:31, 106-163`:** cero ANSI inline; todo color vía `createFormatter` inyectado (`fmt.yellow`/`fmt.ok`/`fmt.dim`/`fmt.red`). renderHuman itera categorías con `renderCategory(write, fmt, title, items, actionOf)` (`:154-163`).

---

### `src/cmux/client.js` (client passthrough — MODIFICADO, +4 exports)

**Analog (mismo fichero):** `listWorkspaceGroups` (`:108-110`) + `buildNewWorkspaceArgs` (`:38-44`)

**Canal único `run()` — `src/cmux/client.js:14-26`:** execFile con timeout 15s, argv plano sin shell, logger opcional. Reutilizar tal cual.

**Passthroughs allowlist — RESEARCH Pattern 4 (`79-RESEARCH.md:315-330`)**, argv plano (ref como elemento de array, jamás interpolado — V5/Tampering, espejo `buildNewWorkspaceArgs`):
```javascript
export async function createWorkspaceGroup({ name, from }) {
  const args = ['workspace-group', 'create'];
  if (name) args.push('--name', name);
  if (from && from.length) args.push('--from', from.join(','));   // from = ['workspace:3', ...]
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
// NINGÚN deleteWorkspaceGroup — LOCKED (SDR-02/D-14). El guard source-hygiene lo verifica.
```

**Actualizar comentario GRP-04 — `src/cmux/client.js:99-106`:** el docstring de `listWorkspaceGroups` dice hoy "create/rename/delete/ungroup/add quedan fuera (GRP-04)". Re-fronterizar (D-12): gestión permitida SOLO en el carril doctor con allowlist no-destructivo; `delete`/`rename`/`remove` siguen fuera.

---

### `src/cli.js` (registro namespace — MODIFICADO)

**Analog (mismo fichero):** bloque `gsd` `:424-476`, en particular `gsd doctor` `:459-476`

**Registro — `src/cli.js:459-476`** (RESEARCH Pattern 3 `:296-306` ya adapta):
```javascript
const sidebar = program.command('sidebar').description('cmux sidebar hygiene (workspace groups)');
sidebar.command('doctor')
  .description('Detect (dry-run) and fix (--fix) cmux sidebar group drift...')
  .option('--fix', 'Execute the non-destructive allowlist (create/add/set-anchor/ungroup); no prompt')
  .option('--json', 'Emit the structured report as JSON (scriptable, byte-deterministic)')
  .action(async (opts) => {
    try {
      // SIN ensureConfig — no toca provider (espejo gsd doctor :466-468)
      const { runSidebarDoctor } = await import('./cli/sidebar-doctor.js');
      process.exit(await runSidebarDoctor({ fix: opts.fix || false, json: opts.json || false }));
    } catch (err) { console.error(`Error: ${err.message}`); process.exit(1); }
  });
```
> Crítico: **NO `ensureConfig()`** (espejo comentario `cli.js:466-468`) — el doctor solo lee state.json/projects.json/cmux, cero provider.

---

### `test/sidebar-doctor-hygiene.test.js` (source-hygiene walker — NUEVO)

**Analog:** `test/hygiene-api-key.test.js` (walker `src/` + `stripComments` + bloque "detector no trivial")

**stripComments — `test/hygiene-api-key.test.js:50-56`** y **listJsFiles recursivo — `:59-68`:** reutilizar verbatim para no marcar menciones de `delete` en comentarios.

**Patrón de guard + prueba positiva/negativa — `test/hygiene-api-key.test.js:174-198`:** el bloque "el detector NO es trivial" con fixture CON fuga (debe marcar) y limpio (no marca) es obligatorio (RESEARCH Wave 0 Gaps). Para SDR-02 el detector prohíbe `workspace-group` + `delete` como argv adyacentes (`/workspace-group['"\s]*[,\s]+['"]?delete/`) y `\bdeleteWorkspaceGroup\b` sobre `src/` stripeado.

---

### `test/cmux/sidebar-doctor.test.js` + `test/cli/sidebar-doctor-cli.test.js` (unit — NUEVOS)

**Analogs:** `test/gsd-doctor-cli.test.js` (dry-run/--fix/--json/exit) + patrón DI de `test/hygiene-api-key.test.js` (fixtures + `makeWorkdir`).

- Unit puro: fixtures del JSON live de RESEARCH (`79-RESEARCH.md:446-467`, los 5 grupos reales), DI del `run`/list con spy de argv (SDR-02: assert que ningún argv contiene `delete`), caso `loose_workspace` (SDR-05), `missing_group` con anchor = oldest `started_at` (D-08).
- CLI: `node:test` + `node:assert/strict`, exit `hasActions ? 1 : 0` en dry-run y `--fix`, `--json` byte-determinista TTY/no-TTY (SDR-06).

## Shared Patterns

### DI never-throws + defaults lazy
**Source:** `src/gsd/doctor.js:188-208` (`resolveDeps`)
**Apply to:** `src/cmux/sidebar-doctor.js` (scan y execute)
Cada primitiva de I/O es inyectable con default real lazy; el `logger` default es `noopLogger` (LOG-12), nunca `undefined`. Testeable sin cmux ni filesystem.

### Fail-open per item + TOCTOU re-check
**Source:** `src/gsd/doctor.js:483-484` (execute re-detecta) + `:618-621` (pushError)
**Apply to:** `src/cmux/sidebar-doctor.js execute()`
`execute` re-llama `scan(deps)` con datos frescos y aísla cada acción en try/catch → registra error y continúa. Nunca aborta el pase (D-06).

### Exit code antes del render + --json byte-determinista
**Source:** `src/cli/gsd-doctor.js:62-81`
**Apply to:** `src/cli/sidebar-doctor.js`
`const exitCode = report.hasActions ? 1 : 0` calculado ANTES de renderizar; `--json` serializa el report sin pasar por el formatter (idéntico TTY/no-TTY). `protected` no afecta el exit.

### Color isolation vía formatter inyectado
**Source:** `src/cli/gsd-doctor.js:31, 56, 154-163`
**Apply to:** `src/cli/sidebar-doctor.js`
Cero `picocolors`/ANSI inline; todo color sale de `createFormatter(process.stdout)` inyectable.

### argv plano sin shell (V5/Tampering)
**Source:** `src/cmux/client.js:14-26` (`run`) + `:38-44` (`buildNewWorkspaceArgs`)
**Apply to:** los 4 passthroughs nuevos en `client.js`
Refs (`workspace:N`, `workspace_group:N`) viajan como elementos de array, jamás interpolados en un string. `run()` da timeout 15s y reject-en-error (= fail-open gratis).

### Reutilización verbatim de funciones puras (no re-implementar)
**Source:** `src/session/manager.js:144` (`deriveExpectedGroupName`), `:189` (`resolveWorkspaceGroup`)
**Apply to:** `src/cmux/sidebar-doctor.js`
Ambas son puras, never-throws, con guards de ref degenerado y match NFC+lowercase+trim. El doctor solo aporta el `taskLikeFrom` (D-02). NO re-implementar strip de identifier ni el match de nombre→ref.

### Source-hygiene walker (stripComments + prueba no-trivial)
**Source:** `test/hygiene-api-key.test.js:50-68, 174-198`
**Apply to:** `test/sidebar-doctor-hygiene.test.js`

## No Analog Found

Ninguno. Los 7 ficheros tienen analog directo en el codebase (fase de espejo arquitectónico). La única lógica genuinamente nueva es `taskLikeFrom` (RESEARCH Pattern 2, ya escrita) y la sintaxis de los 4 verbos cmux (RESEARCH §Standard Stack, verificada en vivo 0.64.20).

## Restricciones de intocables (SDR-04 / D-15)

El launch path **no se edita** — los siguientes analogs son de **solo lectura/reuso aditivo**, jamás modificación:
- `src/session/manager.js:229-237` (`newWorkspaceWithGroupFallback`), `buildNewWorkspaceArgs` (`client.js:38`), call-site `manager.js:411`.
- Tests golden GRP-01..03 (`test/manager.test.js`, `test/session/group-resolve.test.js`) deben pasar **sin modificación**.
- Si el doctor necesita helpers compartidos → exports nuevos, sin tocar los existentes.

## Metadata

**Analog search scope:** `src/gsd/`, `src/cli/`, `src/cmux/`, `src/session/`, `test/`
**Files scanned:** `src/gsd/doctor.js`, `src/cli/gsd-doctor.js`, `src/cmux/client.js`, `src/session/manager.js`, `src/cli.js`, `test/hygiene-api-key.test.js`
**Pattern extraction date:** 2026-07-23
