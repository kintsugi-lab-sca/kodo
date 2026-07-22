# Phase 77: Agrupación de workspaces en cmux - Pattern Map

**Mapped:** 2026-07-16
**Files analyzed:** 5 (3 producción modificados + 2 test)
**Analogs found:** 5 / 5 (todos con analog exacto en el propio repo)

## File Classification

| Fichero (new/mod) | Rol | Data Flow | Analog más cercano | Match |
|-------------------|-----|-----------|--------------------|-------|
| `src/cmux/client.js` (MOD) | client (thin cmux wrapper) | request-response (CLI exec) | funciones existentes del MISMO fichero (`listWorkspaces` `:79`, `newWorkspace` `:32`) | exacto (self) |
| `src/host/cmux.js` (MOD) | provider/host `_legacy` passthrough | request-response (lazy import) | `_legacy.newWorkspace` `:359`, `_legacy.listWorkspaces` `:383` | exacto (self) |
| `src/session/manager.js` (MOD) | service (launch orchestration) + utility (funciones puras) | transform + request-response | `deriveModuleName` `:113`, `resolveProjectPath` `:79`, parsers defensivos `host/cmux.js:57-140`, cableado `launchWorkItem` `:280` | exacto |
| `test/session/group-resolve.test.js` (NEW) | test (unit puro + DI) | — | `test/session/max-parallel-alive.test.js` (import de función pura + DI) | exacto |
| `test/manager.test.js` (MOD) | test (source-hygiene) | — | asserts `:696-782` (regex sobre source de `manager.js`) | exacto (self) |

## Pattern Assignments

### `src/cmux/client.js` — passthrough `listWorkspaceGroups` + `--group` (client, D-05)

**Analog:** el propio fichero — patrón una-función-por-comando, todas envuelven `run(args)`.

**Passthrough analog** (`listWorkspaces` `:76-81`) — calcar exactamente esta forma:
```javascript
/**
 * @returns {Promise<string>}
 */
export async function listWorkspaces() {
  return run(['workspace', 'list']);
}
```
→ nuevo: `export async function listWorkspaceGroups() { return run(['workspace-group', 'list', '--json']); }`. Devuelve stdout crudo; NO parsea JSON (D-05, anti-pattern RESEARCH §271-278).

**`--group` push analog** (`newWorkspace` `:32-40`) — el flag se añade calcando `--cwd`/`--command`:
```javascript
export async function newWorkspace(opts) {
  const args = ['new-workspace', '--name', opts.name];
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.command) args.push('--command', opts.command);
  const output = await run(args);
  // cmux returns "OK workspace:N" — extract the ref
  const match = output.match(/(workspace:\d+)/);
  return match ? match[1] : output;
}
```
→ insertar `if (opts.group) args.push('--group', opts.group);` tras la línea de `--command`. Actualizar el JSDoc `@param` `:29` para añadir `group?: string`. El regex `workspace:\d+` `:38` NO se toca (tolera el aviso legacy — verificado ROADMAP).

**Seguridad (V5 / Tampering):** `run` usa `execFile` con argv array (`:17`), sin shell. El ref va como elemento de array → superficie de inyección nula. No introducir `exec`/interpolación.

---

### `src/host/cmux.js` — espejo `_legacy.listWorkspaceGroups` (host, D-06)

**Analog:** bloque `_legacy` `:357-386` — cada método es un lazy-import passthrough fiel.

```javascript
/** @returns {Promise<string>} raw stdout de `cmux workspace list` (texto, sin --json) */
async listWorkspaces() {
  return (await import('../cmux/client.js')).listWorkspaces();
},
```
→ nuevo método dentro del objeto `_legacy` (antes del cierre `:386`):
```javascript
/** @returns {Promise<string>} raw JSON stdout de `cmux workspace-group list --json` */
async listWorkspaceGroups() {
  return (await import('../cmux/client.js')).listWorkspaceGroups();
},
```
**Invariantes:** NO tocar `HOST_METHODS` (congelado en 4) ni el `return` `:388` (los 4 métodos de contrato). El nuevo método vive SOLO en `_legacy`. El walker `cmux-isolation.test.js` sigue verde porque el único import de `cmux/client.js` permitido es este fichero.

---

### `src/session/manager.js` — 2 funciones puras + helper retry + cableado

**Analog derivación (D-08):** `deriveModuleName` `:106-115` — función pura minúscula sobre `task`, exportada, JSDoc `@param`/`@returns`:
```javascript
/**
 * Derive the module name from a TaskItem's groups array.
 * Pure function.
 * @param {import('../interface.js').TaskItem} task
 * @returns {string|null}
 */
export function deriveModuleName(task) {
  return task.groups && task.groups.length > 0 ? task.groups[0] : null;
}
```
→ `deriveExpectedGroupName(task, entry, resolvedPath)` al lado (misma casa, mismo estilo). Consume `deriveModuleName(task)` y compara `resolvedPath !== entry?.default` (reusa el output de `resolveProjectPath`, no re-lee projects.json — Don't Hand-Roll RESEARCH §285). Identifier vía `task.ref` (Pattern 1). Ver código canónico en RESEARCH §143-170.

**Analog resolución defensiva (D-07):** `buildTitleMap` (`host/cmux.js:124-140`) y `normalizeSurface` (`:57-78`) — never-throws, `Array.isArray(...)` guard, type-check por campo, shape inesperado → vacío/null:
```javascript
function buildTitleMap(listJson) {
  const map = new Map();
  const workspaces = Array.isArray(listJson?.workspaces) ? listJson.workspaces : [];
  for (const ws of workspaces) {
    const ref = ws?.ref;
    const customTitle = ws?.custom_title;
    if (typeof ref === 'string' && ws?.has_custom_title === true &&
        typeof customTitle === 'string' && customTitle.length > 0) {
      map.set(ref, customTitle);
    }
  }
  return map;
}
```
→ `resolveWorkspaceGroup(groupsJson, expectedName)` calca este defensivo: guard `Array.isArray(groupsJson.groups)`, itera con `typeof g.name/g.ref === 'string'`, first-match wins, `null` por defecto. Código canónico RESEARCH §191-200.

**Analog helper retry + observabilidad (D-10/D-11):** el `console.log` de degradación de una línea `:311-313`:
```javascript
if (!gitBacked) {
  console.log(`[kodo] worktree_skipped_nongit — ${task.ref}: ${projectPath} no es un repositorio git; se lanza sin --worktree`);
}
```
→ `newWorkspaceWithGroupFallback(newWorkspaceFn, baseOpts, group, log = console.log)`: intenta con `group`, catch → `log('[kodo] group_skipped — ...')` (solo ref/motivo, sin user content) → reintenta sin group. `newWorkspaceFn` inyectable da teeth al test D-10. Código canónico RESEARCH §232-240.

**Analog cableado (D-13):** el seam actual de `launchWorkItem` `:276-283`:
```javascript
const host = getHost('cmux');
const prefix = moduleName ? `${task.ref} [${moduleName}]` : task.ref;
const workspaceName = `${prefix}: ${truncate(task.title, 40)}`;
const workspaceRef = await host._legacy.newWorkspace({
  name: workspaceName,
  cwd: projectPath,
});
```
→ entre `getHost('cmux')` `:276` y la construcción de `workspaceName`: resolver `groupRef` (capa 1 en try/catch englobante que llama `host._legacy.listWorkspaceGroups()` — NUNCA cmux directo, walker) y sustituir la llamada `newWorkspace` por `newWorkspaceWithGroupFallback(host._legacy.newWorkspace, { name, cwd: projectPath }, groupRef)`. `entry = projects[task.projectId]` (`projects` ya cargado `:243`). Código de cableado canónico RESEARCH §338-361. **NO tocar** `setColor`/`addSession`/`send`/`notify` ni `buildSessionFromTask` (GRP-04: cero campos de grupo persistidos).

---

### `test/session/group-resolve.test.js` (NEW) — unit puro + DI

**Analog:** `test/session/max-parallel-alive.test.js` — importa la función pura directamente y la ejerce sin FS/HOME:
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isSchedulable } from '../../src/session/manager.js';
```
→ `import { deriveExpectedGroupName, resolveWorkspaceGroup, newWorkspaceWithGroupFallback } from '../../src/session/manager.js';` (o del módulo propio si el planner los aísla — discreción D-08). Fixture inline con el shape live de los 3 grupos (`Kodo`/`SCRIBBA`/`SCP-CMRi`, RESEARCH §205-215). Casos obligatorios (RESEARCH §413-420): GRP-02 (`KODO`→ref, `SCP`→null por mismatch Pitfall 1, empate→first), GRP-03 capa 1 (JSON malformado/`groups` ausente→null never-throws), GRP-03 capa 2 (D-10: `newWorkspaceFn` que rejecta al 1er intento → 2º sin `group` + 1 log line via `log` inyectado).

---

### `test/manager.test.js` (MOD) — source-hygiene del cableado + GRP-04

**Analog:** los asserts regex-sobre-source `:696-782`. Patrón exacto (`:769-782`):
```javascript
it('Phase 18 D-04 invariant: newWorkspace still uses cwd: projectPath (NOT worktree path)', () => {
  const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
  assert.ok(
    /host\._legacy\.newWorkspace\(\s*\{[^}]*cwd:\s*projectPath/.test(source),
    'host._legacy.newWorkspace must keep `cwd: projectPath` ...',
  );
  assert.ok(
    !/host\._legacy\.newWorkspace\(\s*\{[^}]*cwd:\s*worktreePath/.test(source),
    'host._legacy.newWorkspace must NOT receive cwd: worktreePath',
  );
});
```
→ nuevos asserts: `--group` cableado presente; `host._legacy.listWorkspaceGroups()` llamado en `manager.js`; GRP-04 negativos (`!/workspace-group (create|rename|delete|add)/`, y `buildSessionFromTask` sin campo de grupo). Reusar la constante `MANAGER_SOURCE_PATH` ya definida `:9`. `launchWorkItem` NO se ejecuta en test (I/O real — la LÓGICA vive en las puras que sí corren).

## Shared Patterns

### Ejecución cmux confinada (walker)
**Source:** `test/host/cmux-isolation.test.js` (escanea `src/session/` `:65-69`)
**Apply to:** `manager.js` — NUNCA importar `src/cmux/client.js`; toda ejecución cmux pasa por `host._legacy`. El regex del walker es `/\/cmux\/client/` sobre imports; un import directo desde `manager.js` lo pondría rojo.

### Parseo JSON defensivo never-throws
**Source:** `src/host/cmux.js:57-140` (`normalizeSurface`, `extractSurfaceRefs`, `buildTitleMap`)
**Apply to:** `resolveWorkspaceGroup` — `Array.isArray` guard + type-check por campo + `null`/vacío ante shape inesperado. Nunca throw; el caller además envuelve en try/catch (capa 1 fail-open).

### Ejecución con timeout + reject = fail-open gratis
**Source:** `src/cmux/client.js:14-26` (`run` con `execFile`, timeout 15s, reject en err)
**Apply to:** El passthrough reusa `run` tal cual — cmux viejo/headless/socket roto → reject → capa 1 (try/catch en `manager.js`) → sin `--group`.

### Observabilidad de degradación (1 línea, sin user content)
**Source:** `src/session/manager.js:311-313` (`worktree_skipped_nongit`)
**Apply to:** `group_skipped` en el helper retry y en el no-match. Solo identifier/ref/motivo, nunca título de tarea ni nombre de grupo con contenido libre (D-11 / V6 Info Disclosure).

## No Analog Found

Ninguno. Toda la superficie nueva tiene precedente exacto en el propio repo (RESEARCH §287: "Casi todo ya existe").

## Metadata

**Analog search scope:** `src/cmux/`, `src/host/`, `src/session/`, `test/`, `test/session/`, `test/host/`
**Files scanned:** 6 leídos (client.js, manager.js, host/cmux.js, manager.test.js, cmux-isolation.test.js, max-parallel-alive.test.js)
**Pattern extraction date:** 2026-07-16
