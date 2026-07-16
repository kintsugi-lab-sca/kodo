# Phase 77: Agrupación de workspaces en cmux - Research

**Researched:** 2026-07-16
**Domain:** Integración cmux CLI (workspace groups) + seam de launch en `src/session/manager.js`
**Confidence:** HIGH (seams de código verificados por lectura directa; comportamiento cmux verificado en vivo contra el binario 0.64.19 instalado)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01..D-13)

- **D-01: Derivación determinística del nombre esperado.** Path resuelto == `default` del proyecto (o entrada flat string) → nombre esperado = **identifier humano del proyecto** (`ROMAN`, `KODO`). Módulo con path propio distinto del default → **`IDENTIFIER/Módulo`** (`ROMAN/FVF`), con el nombre de módulo tal cual aparece en `projects.json`.
- **D-02: El compuesto es obligatorio, no estético.** El nombre pelado de módulo es ambiguo (`DEV` existe en dos proyectos). Nunca matchear por módulo a secas.
- **D-03: Match case-insensitive + trim** contra el campo `name` de `workspace-group list --json`. Empate múltiple → tomar el primero de la lista (determinista, documentado).
- **D-04: Descartado** el match por `current_directory` del anchor y **descartado** un campo `cmux_group` en `projects.json`.
- **D-05:** `client.js` gana UN passthrough fino `listWorkspaceGroups()` → `run(['workspace-group','list','--json'])`. El parseo del JSON NO vive en client.js.
- **D-06:** `host._legacy` expone `listWorkspaceGroups` igual que `newWorkspace`. `HOST_METHODS` (4) NO se toca; walker `cmux-isolation.test.js` verde.
- **D-07:** La resolución es una función PURA `(groupsJson, expectedName) → ref | null`, defensiva ante shapes inesperados (never-throws).
- **D-08:** La derivación del nombre esperado es otra función pura al lado de `deriveModuleName` (`manager.js:113`).
- **D-09: Capa 1 fail-open — resolución.** `listWorkspaceGroups` falla o no hay match → sin `--group`. Sin version-check de cmux.
- **D-10: Capa 2 fail-open — TOCTOU.** Si `newWorkspace` CON `--group` falla, **reintentar una vez SIN `--group`**. El fallo del reintento propaga como hoy.
- **D-11: Observabilidad:** `console.log` de una línea (`[kodo] group_skipped — <motivo corto>`), precedente `worktree_skipped_nongit` (`manager.js:312`). Sin contenido de usuario en el log.
- **D-12:** Como mucho UNA llamada cmux extra por lanzamiento (~50ms). Cero llamadas nuevas en el reconcile loop.
- **D-13: SOLO sesiones de tareas** — el `newWorkspace` de `launchWorkItem` (`manager.js:280`). Orquestador y sesiones adoptadas quedan fuera.

### Claude's Discretion

- `--group-placement`: default (`top`) salvo que research encuentre motivo para `afterCurrent`.
- Normalización exacta de strings en el match (casefold Unicode vs `toLowerCase`; NFC/NFD para `Traça Web`).
- Si las dos funciones puras viven en `manager.js` o en un módulo pequeño propio.
- Estructura de tests: DI del `run`/exec, fixtures del JSON real de `workspace-group list`.

### Deferred Ideas (OUT OF SCOPE)

- Agrupar el workspace del orquestador (`orchestrator/launch.js:220`).
- `workspace-group add` para sesiones adoptadas.
- Auto-crear el grupo si no existe (`workspace-group create --from`).
- Color/icono de grupo por proyecto.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRP-01 | El workspace aterriza dentro del grupo cuyo nombre coincide con el path resuelto | `--group <ref>` verificado en vivo (`new-workspace --help`); seam en `manager.js:280`; función pura `resolveWorkspaceGroup` (§Architecture) |
| GRP-02 | La clave de agrupación es el path resuelto, no proyecto ni módulo a secas | `deriveExpectedGroupName` compara `resolvedPath` vs `entry.default` (§Architecture Pattern 1); auditoría live proyectos↔grupos (§Pitfall 1) |
| GRP-03 | Sin match / fallo / cmux viejo → se lanza exactamente como hoy | Capa 1 (`run()` rejecta en err — `client.js:18`) + Capa 2 (retry sin `--group`); todo en try/catch never-throws |
| GRP-04 | kodo nunca crea/renombra/borra grupos; ningún `workspace_group:N` en `state.json`/config | La resolución es read-only (`workspace-group list`); el ref se pasa a `newWorkspace` y NO se persiste (`buildSessionFromTask` no gana campos — §Runtime State Inventory) |
</phase_requirements>

## Summary

Phase 77 inyecta el flag `--group <ref>` en el `new-workspace` que `launchWorkItem` ya emite, resolviendo el ref **en fresco por lanzamiento** contra `cmux workspace-group list --json`. Toda la superficie nueva son dos funciones puras (derivar el nombre esperado, resolver nombre→ref) + un passthrough de una línea en `client.js` + su espejo en `host._legacy` + el cableado en `manager.js`. El contrato `HOST_METHODS` (4) no se toca; la resolución pasa SIEMPRE por `host._legacy` (nunca cmux directo desde `manager.js`), respetando el walker `cmux-isolation.test.js`.

Verifiqué en vivo contra el binario instalado (`cmux 0.64.19`): `--group <id|ref>` y `--group-placement afterCurrent|top|end` (default `top`) existen; `workspace-group list --json` devuelve `{ groups: [{ name, ref, member_workspace_refs, ... }], window_ref }`. Los grupos reales del operador HOY son **`Kodo`**, **`SCRIBBA`** y **`SCP-CMRi`**. Crucial: crucé estos nombres contra los identifiers Plane reales del operador y descubrí que **solo `Kodo` (↔KODO) y `SCRIBBA` (↔SCRIBBA) auto-matchean; `SCP-CMRi` NO matchea el identifier `SCP`** del proyecto que apunta a `/roman/scp-cmri`. Esto no es un bug — es el contrato de matching encontrándose con un nombre de grupo elegido a mano; fail-open lo cubre (sesión sin grupo). El planner y el operador deben saberlo (§Pitfall 1).

**Primary recommendation:** Dos funciones puras en `manager.js` junto a `deriveModuleName` — `deriveExpectedGroupName(task, entry, resolvedPath)` (identifier vía `task.ref`, compuesto si `resolvedPath !== entry.default`) y `resolveWorkspaceGroup(groupsJson, expectedName)` (match NFC+lowercase+trim, first-wins, never-throws) — más un helper `newWorkspaceWithGroupFallback` que da dientes reales al retry D-10. El passthrough `listWorkspaceGroups` se añade a `client.js` y a `host._legacy`. Usa `--group-placement` default (omitir el flag).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Derivar nombre esperado de grupo | Pure logic (`manager.js`) | — | Función pura sobre `task`+`entry`+`resolvedPath`; testeable sin cmux (D-08) |
| Resolver nombre→ref | Pure logic (`manager.js`) | — | Parseo defensivo del JSON; never-throws (D-07) |
| Ejecutar `workspace-group list` | cmux client (`src/cmux/client.js`) | `host._legacy` (`src/host/cmux.js`) | cmux confinado a `src/host/`+`src/cmux/` (walker); manager consume vía `_legacy` (D-05/D-06) |
| Inyectar `--group` en el launch | Session manager (`manager.js:280`) | cmux client (`newWorkspace`) | El seam del launch ya vive aquí; el flag es cosmético sobre la carga útil |
| Fail-open (capa 1 y 2) | Session manager | — | La política (retry, skip, log) es del launcher, no del cliente cmux |

## Standard Stack

**Sin dependencias npm nuevas** (invariante cross-milestone confirmado en STATE.md). Todo se hace con:

| Módulo | Versión | Propósito | Por qué |
|--------|---------|-----------|---------|
| `node:child_process` (`execFile`) | built-in | Ejecutar `cmux workspace-group list --json` | Ya usado por `client.js run()` — el passthrough lo reusa tal cual |
| `JSON.parse` | built-in | Parsear la salida de cmux | Envuelto en try/catch + función pura defensiva (patrón `buildTitleMap`/`normalizeSurface`) |
| cmux binary | **≥ 0.64.19** (instalado: `0.64.19 (99)`) | Provee `--group` en `new-workspace` y `workspace-group list --json` | Dependencia EXTERNA; el soporte se deriva del éxito/fallo de la llamada, NO de un version-check (D-09) |

**Installation:** N/A — cero paquetes. cmux ya instalado en `/Applications/cmux.app/Contents/Resources/bin/cmux`.

## Package Legitimacy Audit

No aplica: la fase no instala paquetes externos (cero deps npm nuevas — invariante cross-milestone). Nada que auditar.

## Architecture Patterns

### System Architecture Diagram

```
launchWorkItem(identifier)                             [src/session/manager.js:225]
  │
  ├─ resolveTaskAndLaunchContext → { task, projectPath(resuelto), moduleName }   [:251]
  │
  ├─ host = getHost('cmux')                                                        [:276]
  │
  ├─ NUEVO ── expectedName = deriveExpectedGroupName(task, entry, projectPath)     [pura, D-08]
  │              │  identifier = task.ref sin la secuencia   (KODO-9 → "KODO")
  │              │  ¿resolvedPath === entry.default? → identifier
  │              │  ¿módulo con path propio?          → "IDENTIFIER/Módulo"
  │              ▼
  │           groupRef = null
  │           try {
  │             raw = await host._legacy.listWorkspaceGroups()   ── UNA llamada cmux (D-12)
  │             groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName)    [pura, D-07]
  │           } catch { /* capa 1: cmux viejo/headless/socket roto → groupRef=null */ }   [D-09]
  │
  ├─ workspaceRef = await newWorkspaceWithGroupFallback(                            [:280, MODIFICADO]
  │                    host._legacy.newWorkspace,
  │                    { name, cwd: projectPath },
  │                    groupRef)
  │        │  groupRef presente → intenta con --group
  │        │  falla            → console.log('group_skipped') + reintenta SIN --group  [capa 2, D-10]
  │        ▼
  │     workspace:N
  │
  ├─ setColor · addSession · send · notify   ── SIN CAMBIOS (contrato congelado)
  ▼
  return session   ── worktree_path/state.json SIN ref de grupo (GRP-04)
```

`workspace-group list --json` NO se llama en el reconcile loop (D-12). El orquestador (`orchestrator/launch.js:220`) NO pasa por este seam (D-13).

### Recommended Project Structure

Cero ficheros nuevos de producción obligatorios. Las funciones puras viven junto a `deriveModuleName` en `manager.js` (recomendado — misma casa, mismo estilo, D-08). Si el planner prefiere aislarlas (discreción), un módulo `src/session/group-resolve.js` de CERO imports es aceptable y facilita el test unitario, pero añade un fichero — **recomiendo mantenerlas en `manager.js`** salvo que crezcan.

```
src/
├── cmux/client.js       # +1 passthrough listWorkspaceGroups; +--group en newWorkspace
├── host/cmux.js         # +1 passthrough _legacy.listWorkspaceGroups
└── session/manager.js   # +deriveExpectedGroupName +resolveWorkspaceGroup +newWorkspaceWithGroupFallback +cableado
test/
├── session/group-resolve.test.js   # NUEVO — unit puro (teeth GRP-01/02/03/04)
└── manager.test.js                  # +source-hygiene asserts del cableado (analog :769-780)
```

### Pattern 1: Derivación del nombre esperado (D-01/D-02/D-08)

**What:** Función pura que convierte `(task, entry, resolvedPath)` en el nombre de grupo esperado.
**When to use:** Una vez por launch, justo antes de resolver.

```javascript
// Source: derivado de manager.js:79-115 (resolveProjectPath/deriveModuleName) + projects.json real
// [VERIFIED: lectura de src/session/manager.js + ~/.kodo/{config,projects}.json]
/**
 * @param {import('../interface.js').TaskItem} task
 * @param {string | {default?: string, modules?: Record<string,string>}} entry  projects[task.projectId]
 * @param {string} resolvedPath  el output de resolveProjectPath (el "path resuelto" de GRP-02)
 * @returns {string} nombre de grupo esperado, p.ej. "KODO" o "ROMAN/FVF"
 */
export function deriveExpectedGroupName(task, entry, resolvedPath) {
  // Identifier humano desde task.ref — cross-provider, sin plumbear config a la función pura.
  //   Plane:  ref = "IDENT-<seq>"        → "KODO-9"  → "KODO"        (strip trailing -digits)
  //   GitHub: ref = "owner/repo#<num>"   → "acme/x#7"→ "x"           (basename antes de #)
  const ref = String(task?.ref || '');
  const identifier = ref.includes('#')
    ? ref.split('#')[0].split('/').pop()          // GitHub
    : ref.replace(/-\d+$/, '');                    // Plane
  const moduleName = deriveModuleName(task);       // task.groups[0] || null

  // Flat string (kodo) o path resuelto == default → identifier a secas (D-01).
  // Módulo con path propio DISTINTO del default → "IDENTIFIER/Módulo" (D-01).
  // Comparar contra resolvedPath === entry.default implementa GRP-02 LITERAL:
  // los F0..F6 de SCP (todos == default) colapsan al identifier; FVF/WAG (path
  // propio) se separan. Robusto también al caso "módulo existe pero cayó al default".
  const isFlat = typeof entry === 'string';
  const usesModulePath = !isFlat && moduleName && resolvedPath !== entry?.default;
  return usesModulePath ? `${identifier}/${moduleName}` : identifier;
}
```

**Nota sobre el identifier (camino de datos, verificado):** El identifier NO está en `projects.json` (que keyea por `task.projectId` UUID). Dos caminos exactos:
1. **`task.ref` prefix (RECOMENDADO, cross-provider):** Plane construye `ref = ${projectIdentifier}-${sequence_id}` (`src/providers/plane/normalize.js:66`); GitHub `ref = ${projectId}#${number}` (`src/providers/github/normalize.js:96`). Sin plumbear config a la función pura (mantiene D-08 limpio). `[VERIFIED: lectura de normalize.js de ambos providers]`
2. **Config lookup (exacto, Plane-only):** `config.providers.plane.projects.find(p => p.id === task.projectId).identifier`. Da idénticos resultados para Plane (`KODO`, `SCP`, `SCRIBBA`) pero acopla la función a la config del provider. `[VERIFIED: ~/.kodo/config.json — array {id,identifier,name}]`

Ambos dan el mismo string para Plane. Recomiendo el camino 1 por pureza. **GitHub queda parcialmente sin especificar** (¿grupo = repo basename o `owner/repo`?): el operador solo usa grupos Plane hoy, así que es un `[ASSUMED]` de bajo riesgo — ver Assumptions Log A1.

### Pattern 2: Resolución nombre→ref (D-03/D-07)

```javascript
// Source: patrón defensivo de host/cmux.js:57-140 (normalizeSurface/buildTitleMap) — never-throws
// [VERIFIED: shape live de `cmux workspace-group list --json` capturado 2026-07-16]
const norm = (s) => String(s).normalize('NFC').toLowerCase().trim();  // discreción: NFC cubre "Traça Web"

/**
 * @param {any} groupsJson  salida ya parseada de `workspace-group list --json`
 * @param {string} expectedName
 * @returns {string|null} ref "workspace_group:N" o null
 */
export function resolveWorkspaceGroup(groupsJson, expectedName) {
  if (!groupsJson || !Array.isArray(groupsJson.groups)) return null;  // shape inesperado → null
  const target = norm(expectedName);
  for (const g of groupsJson.groups) {                                 // first-match wins (D-03 empate)
    if (g && typeof g.name === 'string' && typeof g.ref === 'string' && norm(g.name) === target) {
      return g.ref;
    }
  }
  return null;
}
```

**Shape live confirmado** de `workspace-group list --json` (binario 0.64.19, 2026-07-16):
```json
{
  "groups": [
    { "anchor_workspace_ref": "workspace:11", "custom_color": null, "icon_symbol": null,
      "is_collapsed": false, "is_pinned": false, "member_count": 3,
      "member_workspace_refs": ["workspace:11","workspace:2","workspace:13"],
      "name": "Kodo", "ref": "workspace_group:1" },
    { "name": "SCRIBBA", "ref": "workspace_group:2", "member_workspace_refs": ["workspace:14","workspace:4","workspace:15"], ... },
    { "name": "SCP-CMRi", "ref": "workspace_group:4", "member_workspace_refs": ["workspace:19","workspace:20"], ... }
  ],
  "window_ref": "window:1"
}
```

### Pattern 3: Retry fail-open D-10 con dientes (helper testeable)

**What:** El retry sin `--group` extraído a un helper con `newWorkspaceFn` inyectable, para que D-10 tenga un test que lo ejerza (no solo source-hygiene).
**When to use:** Envuelve la llamada `newWorkspace` del launch.

```javascript
// Source: nuevo helper — da teeth a D-10 (el caso "más fácil de dejar sin dientes")
/**
 * @param {(opts:{name:string,cwd?:string,group?:string}) => Promise<string>} newWorkspaceFn
 * @param {{name:string, cwd?:string}} baseOpts
 * @param {string|null} group
 * @param {(msg:string)=>void} [log]  inyectable; default console.log
 * @returns {Promise<string>}
 */
export async function newWorkspaceWithGroupFallback(newWorkspaceFn, baseOpts, group, log = console.log) {
  if (!group) return newWorkspaceFn(baseOpts);                     // sin grupo → como hoy
  try {
    return await newWorkspaceFn({ ...baseOpts, group });          // intento con --group
  } catch {
    log(`[kodo] group_skipped — retry_sin_grupo ${group}`);      // D-11: solo ref/motivo, sin user content
    return newWorkspaceFn(baseOpts);                              // capa 2: reintento SIN --group (D-10)
  }
}
```

Un fallo del reintento propaga como hoy (no lo capturamos). El `console.log` es de una línea, sin contenido de usuario (D-11, precedente `worktree_skipped_nongit` `manager.js:312`).

### Pattern 4: Passthrough en client.js + host._legacy (D-05/D-06)

```javascript
// src/cmux/client.js — calcado del patrón una-función-por-comando (:79 listWorkspaces)
/** @returns {Promise<string>} raw JSON stdout de `cmux workspace-group list --json` */
export async function listWorkspaceGroups() {
  return run(['workspace-group', 'list', '--json']);
}

// --group en newWorkspace (client.js:32-40) — calcado de --cwd/--command:
export async function newWorkspace(opts) {
  const args = ['new-workspace', '--name', opts.name];
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.command) args.push('--command', opts.command);
  if (opts.group) args.push('--group', opts.group);   // NUEVO — argv array, sin shell (§Security)
  const output = await run(args);
  const match = output.match(/(workspace:\d+)/);
  return match ? match[1] : output;
}

// src/host/cmux.js — dentro de _legacy (:357-386), espejo de newWorkspace:
async listWorkspaceGroups() {
  return (await import('../cmux/client.js')).listWorkspaceGroups();
}
```

### Anti-Patterns to Avoid

- **Keyear el grupo por el path crudo.** GRP-02 dice "clave = path resuelto" pero eso alimenta la detección default-vs-módulo; el group KEY real es el NOMBRE derivado (D-01). Dos proyectos que apuntan al mismo path filesystem (ROMAN/SCP-módulo vs proyecto standalone `SCP`) producen nombres distintos → grupos distintos. No hashear el path.
- **Parsear el JSON en `client.js`.** D-05 lo prohíbe: client.js devuelve el stdout crudo; el parseo vive en la función pura.
- **Llamar cmux directamente desde `manager.js`.** Rompe el walker `cmux-isolation.test.js`. Todo pasa por `host._legacy`.
- **Version-check de cmux.** D-09 lo prohíbe: el soporte se deriva del fallo de la propia llamada.
- **Persistir el ref `workspace_group:N`.** GRP-04: ningún ref en `state.json` ni config.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Ejecutar cmux con timeout + captura de stderr | Un `execFile` nuevo en manager.js | `run()` de `client.js` (:14-26) vía passthrough | Ya tiene timeout 15s, logger opcional, y rejecta en err (= capa 1 fail-open gratis) |
| Parseo defensivo de JSON cmux | Validación ad-hoc con ifs | Patrón `normalizeSurface`/`buildTitleMap` (host/cmux.js:57-140) | Never-throws probado; claves ausentes → null |
| Detección default-vs-módulo | Re-leer projects.json | Comparar `resolvedPath` (ya computado) vs `entry.default` | `resolveProjectPath` ya hizo el trabajo; reusa su output |

**Key insight:** Casi todo ya existe. La fase es cableado + dos funciones puras; el 80% del riesgo está en el CONTRATO de matching (nombres), no en el código.

## Runtime State Inventory

> Fase de integración/feature, no rename. Incluida en forma reducida porque GRP-04 exige verificar que NADA persiste.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — el ref `workspace_group:N` se pasa a `newWorkspace` y se descarta; `buildSessionFromTask` (`manager.js:34-68`) NO gana campos. Verificado: el shape de Session no referencia grupos. | Ninguna (GRP-04 satisfecho por construcción) |
| Live service config | **None** — kodo NO ejecuta `workspace-group create/rename/delete/add/ungroup`. Solo `list` (read-only). Los grupos los crea el operador a mano. | Ninguna |
| OS-registered state | **None** — no hay registros OS. | Ninguna |
| Secrets/env vars | **None** — `CMUX_QUIET=1` es opcional para silenciar el aviso legacy; no es un secreto. Verificado: `env -i HOME=$HOME cmux ...` funciona sin env especial. | Ninguna |
| Build artifacts | **None** — sin artefactos. | Ninguna |

## Common Pitfalls

### Pitfall 1: El nombre del grupo del operador ≠ el identifier derivado (HALLAZGO CRÍTICO)

**What goes wrong:** El operador crea un grupo con un nombre "bonito" que no coincide con el identifier Plane. Auditoría en vivo de sus 3 grupos actuales contra los identifiers reales de su `config.json`:

| Grupo live (`name`) | Normalizado | Identifier Plane candidato | Path | ¿Match? |
|---------------------|-------------|----------------------------|------|---------|
| `Kodo` | `kodo` | `KODO` (proyecto flat `/klab/kodo`) | default | ✅ |
| `SCRIBBA` | `scribba` | `SCRIBBA` (`d24bcfa4`) | default | ✅ |
| `SCP-CMRi` | `scp-cmri` | `SCP` (`b560734a`, name "CMRi SCP", path `/roman/scp-cmri`) | default | ❌ `scp` ≠ `scp-cmri` |

**Why it happens:** `SCP-CMRi` fue nombrado a mano; el identifier Plane del proyecto es `SCP`. Ni el identifier (`SCP`) ni el projectName (`CMRi SCP`) normalizan a `scp-cmri`.
**How to avoid:** Es comportamiento CORRECTO (fail-open → sesión sin grupo). Pero el planner DEBE documentar que **la aceptación de GRP-02 con datos reales solo cubre KODO y SCRIBBA hoy**; para que las tareas del proyecto `SCP` aterricen en un grupo, el operador debe renombrar `SCP-CMRi` → `SCP` (o crear un grupo `SCP`). Esto es una nota de operación, no un cambio de código.
**Warning signs:** Tareas de `SCP-*` que se lanzan sueltas pese a existir el grupo `SCP-CMRi`.

### Pitfall 2: Colisión de path entre proyecto standalone y módulo de otro proyecto

**What goes wrong:** `/roman/scp-cmri` es alcanzable por DOS rutas: el proyecto standalone `SCP` (`b560734a`, default) → nombre `SCP`; y el módulo `SCP` de ROMAN (`add88b2b`, path ≠ default `/roman`) → nombre `ROMAN/SCP`. Mismo path filesystem, nombres de grupo distintos.
**Why it happens:** D-01 deriva el nombre de identifier+módulo, no del path. GRP-02 usa el path solo para decidir default-vs-módulo.
**How to avoid:** Es determinista y aceptable. Documentar que el "grouping key" efectivo es el NOMBRE derivado, no el path literal.

### Pitfall 3: Multi-ventana — el grupo puede vivir en otra window

**What goes wrong:** `workspace-group list --json` devuelve grupos de UNA window (`window_ref` en el output; live: `window:1`). `new-workspace` apunta a la window del caller. Si el grupo resuelto vive en otra window, el ref puede ser inválido allí → fatal → capa 2 retry.
**Why it happens:** Los grupos son por-window (verificado en ROADMAP §Phase 77).
**How to avoid:** La capa 2 (D-10) lo cubre: el `newWorkspace` con ref inválido rejecta → retry sin grupo. Documentar la degradación (aceptada en CONTEXT.md).

### Pitfall 4: Ref reciclado / borrado entre list y launch (TOCTOU)

**What goes wrong:** El operador borra el grupo entre la resolución y el `newWorkspace`. Un ref inválido es FATAL (exit=1, workspace NO creado — verificado en vivo).
**How to avoid:** Exactamente lo que resuelve D-10 (capa 2). Sin ella, un grupo borrado mataría la sesión. El test debe ejercer este camino (ver Validation).

## Code Examples

### Cableado en launchWorkItem (manager.js, entre :276 y :283)

```javascript
// [VERIFIED: seam leído en src/session/manager.js:243-283]
const host = getHost('cmux');                                   // :276 (existente)

// NUEVO: resolución de grupo (capa 1 fail-open englobante)
const entry = projects[task.projectId];                          // projects ya cargado en :243
let groupRef = null;
try {
  const expectedName = deriveExpectedGroupName(task, entry, projectPath);
  const raw = await host._legacy.listWorkspaceGroups();          // UNA llamada extra (D-12)
  groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName);
  if (!groupRef) console.log(`[kodo] group_skipped — sin_grupo_para ${expectedName}`);  // D-11 (opcional)
} catch {
  console.log(`[kodo] group_skipped — resolucion_fallo`);        // D-11: cmux viejo/headless/socket
}

const prefix = moduleName ? `${task.ref} [${moduleName}]` : task.ref;   // :278 (existente)
const workspaceName = `${prefix}: ${truncate(task.title, 40)}`;         // :279 (existente)
const workspaceRef = await newWorkspaceWithGroupFallback(               // :280 (MODIFICADO)
  host._legacy.newWorkspace,
  { name: workspaceName, cwd: projectPath },
  groupRef,
);
```

**Nota discreción `--group-placement`:** default `top` (verificado en `new-workspace --help`). No hay motivo para `afterCurrent` (requiere `--group-reference` a un workspace concreto — complejidad sin beneficio para kodo). **Recomiendo omitir el flag** (usa el default).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cmux new-workspace` (alias legacy) | `cmux workspace create` (nombre canónico) | ≤ 0.64.19 | `new-workspace` sigue funcionando (aviso silenciable con `CMUX_QUIET=1`); el regex `workspace:\d+` de client.js:38 tolera el aviso. NO migrar — fuera de scope |
| Sin agrupación en sidebar | `--group <ref>` + `workspace-group` subcommands | 0.64.19 | Habilita toda la fase |

**Deprecated/outdated:** Nada que la fase toque queda deprecado.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Para GitHub, el "identifier humano" = repo basename (`owner/repo#n` → `repo`). El operador solo usa grupos Plane hoy, no hay grupo GitHub que validar. | Pattern 1 | Bajo — si el operador crea grupos para repos GitHub y quiere `owner/repo`, ajustar la derivación. Fail-open cubre el no-match mientras tanto. |
| A2 | El identifier Plane nunca contiene el patrón `-<dígitos>` al final (que `replace(/-\d+$/,'')` cortaría de más). Verificado en los 9 identifiers reales (`ROMAN`,`KODO`,`SCP`,`SCRIBBA`,...): ninguno termina en `-dígitos`. | Pattern 1 | Muy bajo — identifiers Plane son códigos cortos alfanuméricos. |
| A3 | El daemon headless (launchd sin sesión GUI) hace que `workspace-group list` falle limpio o devuelva otra window → cubierto por capa 1. NO reproducible de forma 100% no-mutante desde aquí (la app GUI del operador está corriendo). Ver Open Questions. | Fail-open | Bajo — cualquier resultado (error, otra window, JSON válido) es seguro por diseño; solo afecta si SE agrupa, nunca si se lanza. |

## Open Questions (RESOLVED)

1. **RESOLVED — ¿Qué ve el daemon headless (launchd, sin sesión GUI) al correr `workspace-group list --json`?**
   - **What we know:** Experimento no-mutante ejecutado hoy — `env -i HOME=$HOME /Applications/cmux.app/Contents/Resources/bin/cmux workspace-group list --json` devolvió **EXIT=0 con JSON válido completo** (window:1), incluso con environment stripped. `CMUX_QUIET=1` idéntico. El binario habla con la app vía socket bajo `$HOME`, sin depender de env de GUI.
   - **What's unclear:** Ese experimento corre con la **app cmux del operador VIVA** (yo estoy en una sesión GUI). El caso 66-06 real es launchd SIN ninguna sesión GUI y potencialmente sin app corriendo. No es reproducible sin tumbar la sesión del operador (PROHIBIDO). El precedente 66-06 fue "Failed to write to socket (Broken pipe)" a stderr.
   - **Determinismo del código (VERIFICADO por lectura):** `client.js run()` (:14-26) rejecta la promesa si `execFile` devuelve `err` (exit≠0, spawn error, o timeout 15s). El caller lo envuelve en try/catch → capa 1 → sin `--group`. Si devuelve JSON de OTRA window → `resolveWorkspaceGroup` no matchea → null → sin grupo. **Todos los desenlaces son seguros.**
   - **Recommendation:** El diseño NO depende de la respuesta. Dejar para el executor un experimento opcional bajo launchd real (`launchctl` con el daemon kodo) SOLO si quiere certeza empírica: correr `kodo` bajo su plist y observar si aparece `group_skipped — resolucion_fallo` en `kodo.log`. No bloquea la fase.

2. **RESOLVED — ¿El operador quiere que `SCP-CMRi` matchee?** (Pitfall 1). Decisión de operación: renombrar el grupo a `SCP` o dejarlo (tareas SCP sueltas). No es código.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| cmux binary | `--group` + `workspace-group list` | ✅ | 0.64.19 (99) | Si < 0.64.19: la llamada falla → capa 1 fail-open (sin grupo). NO se hace version-check (D-09) |
| `node:child_process` | passthrough `run()` | ✅ | built-in | — |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** cmux < 0.64.19 degrada a comportamiento actual vía fail-open (por diseño).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none (scripts en `package.json`) |
| Quick run command | `node --test test/session/group-resolve.test.js` |
| Full suite command | `node --test` (o el script `test` de package.json) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRP-01 | `newWorkspace` recibe `--group` cuando hay match | unit (pura) | `node --test test/session/group-resolve.test.js` | ❌ Wave 0 |
| GRP-01 | client.js `newWorkspace` push `--group` si `opts.group` | unit / source | idem + assert en `test/manager.test.js` (analog :769-780) | ❌ Wave 0 (client) |
| GRP-02 | `deriveExpectedGroupName`: KODO(flat)→"KODO"; ROMAN/FVF(path propio)→"ROMAN/FVF"; SCP F0..F6(==default)→"SCP"; módulo cae a default→identifier | unit (pura) | idem | ❌ Wave 0 |
| GRP-02 | `resolveWorkspaceGroup`: fixture live (`Kodo`/`SCRIBBA`/`SCP-CMRi`) — "KODO"→ref, "SCP"→null, empate→first | unit (pura) | idem | ❌ Wave 0 |
| GRP-03 | capa 1: JSON malformado / `groups` ausente / error → null (never-throws) | unit (pura) | idem | ❌ Wave 0 |
| GRP-03 | **capa 2 (D-10)**: `newWorkspaceWithGroupFallback` con `newWorkspaceFn` que rejecta al 1er intento → 2º intento SIN `group` + 1 log line | unit (DI del fn) | idem | ❌ Wave 0 |
| GRP-04 | `buildSessionFromTask` NO gana campos de grupo; manager NO llama `workspace-group create/rename/delete/add` | source-hygiene | assert grep en `test/manager.test.js` | ❌ Wave 0 |
| — | walker sigue verde: `manager.js` NO importa `cmux/client.js` | structural | `node --test test/host/cmux-isolation.test.js` | ✅ existe |

### Sampling Rate
- **Per task commit:** `node --test test/session/group-resolve.test.js test/host/cmux-isolation.test.js`
- **Per wave merge:** `node --test` (suite completa)
- **Phase gate:** Suite verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/session/group-resolve.test.js` — cubre GRP-01/02/03; incluye fixture del JSON live de `workspace-group list` (los 3 grupos reales) y el caso D-10.
- [ ] Asserts nuevos en `test/manager.test.js` (source-hygiene) — `--group` en el cableado + GRP-04 (sin create/rename/delete; sin campo de grupo en Session).
- [ ] **(Decisión de test para client.js):** `src/cmux/client.js` NO tiene test funcional (su `run()` usa `execFile` NO inyectable). Para dar teeth a "newWorkspace push `--group`" sin refactor grande, **recomiendo extraer `buildNewWorkspaceArgs(opts) → string[]`** (función pura) en client.js y testearla directamente; alternativa débil = source-hygiene regex. El planner elige.
- [ ] `launchWorkItem` NO se ejecuta en tests (hace I/O real de cmux/provider — comentario `manager.test.js:238-243`). El cableado se verifica por source-hygiene (patrón existente `:696-785`); la LÓGICA vive en las funciones puras que SÍ se ejecutan.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | La fase no toca auth |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | JSON de cmux parseado en función pura defensiva (never-throws, claves ausentes → null); shape validado (`typeof g.name/g.ref === 'string'`) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Inyección de comando vía nombre de grupo / ref | Tampering | `execFile` con **argv array** (`run(['workspace-group','list','--json'])` y `args.push('--group', ref)`) — NUNCA shell. El ref (`workspace_group:N`) va como elemento de array; sin interpolación en un string de shell. Superficie de inyección = **nula**. `[VERIFIED: client.js usa execFile, no exec/shell]` |
| JSON malicioso/malformado de cmux (`workspace-group list`) | Tampering / DoS | Función pura defensiva: `JSON.parse` en try/catch, `Array.isArray(groups)` guard, type-checks por campo → null. Never-throws (patrón `normalizeSurface`). |
| Fuga de contenido de usuario en logs | Information Disclosure | D-11: el `console.log` lleva SOLO el identifier/ref/motivo (`group_skipped — <ref>`), nunca el título de tarea ni el nombre de grupo del operador con contenido libre (precedente T-71-18). |
| Timeout / cuelgue de cmux headless | DoS | `run()` tiene timeout 15s (`client.js:17`); expira → reject → capa 1. La resolución añade máx 1 llamada (~50ms típico), cero en reconcile (D-12). |

## Sources

### Primary (HIGH confidence)
- `cmux 0.64.19` binario instalado — `--version`, `new-workspace --help`, `workspace-group --help`, `workspace-group list --json` (ejecutados read-only 2026-07-16). AUTORIDAD (los docs web divergen).
- `src/session/manager.js`, `src/cmux/client.js`, `src/host/cmux.js`, `src/host/interface.js`, `src/interface.js`, `src/providers/{plane,github}/normalize.js` — lectura directa.
- `~/.kodo/projects.json` + `~/.kodo/config.json` — shapes reales (identifiers, módulos, colisiones).
- `test/manager.test.js`, `test/host/{cmux-isolation,cmux-stderr-capture,contract}.test.js` — patrones de test existentes.

### Secondary (MEDIUM confidence)
- `.planning/ROADMAP.md` §Phase 77 + `77-CONTEXT.md` — hechos live pre-verificados (no re-derivados).

### Tertiary (LOW confidence)
- Comportamiento del daemon headless real (launchd sin GUI) — parcialmente inferido; experimento no-mutante hecho con la app viva (ver Open Questions).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps; cmux 0.64.19 verificado en vivo.
- Architecture: HIGH — seams leídos línea a línea; funciones puras siguen precedentes exactos del repo.
- Pitfalls: HIGH — Pitfall 1/2 verificados cruzando grupos live vs identifiers reales.
- Daemon headless: MEDIUM — diseño fail-open cubre todos los desenlaces; reproducción 100% no disponible sin mutar.

**Research date:** 2026-07-16
**Valid until:** 2026-08-15 (estable; re-verificar solo si cmux sube de versión mayor o cambia el shape de `workspace-group list --json`)
</content>
</invoke>
