# Phase 55: Contrato `HostProvider.listAgentSurfaces()` (cmux) - Pattern Map

**Mapped:** 2026-06-16
**Files analyzed:** 5 (2 modify, 2 create, 1 verify-only)
**Analogs found:** 5 / 5 (all exact or strong, same codebase, same role)

> Todo el material de patrón vive en el MISMO subsistema (`src/host/`, `test/host/`, `test/fixtures/cmux/`). Esta fase es deliberadamente pequeña: copiar el molde de `listWorkspaces`, cambiar 2 comandos y el shape de salida. No hay analogo "lejano" — los analogos son hermanos directos del archivo a modificar.

## File Classification

| New/Modified File | Op | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|----|------|-----------|----------------|---------------|
| `src/host/cmux.js` | MODIFY | host adapter (provider method) | request-response (CLI shell-out → normalize) | `listWorkspaces()` en el mismo archivo (cmux.js:62-118) | exact (mismo archivo, mismo molde) |
| `src/host/interface.js` | MODIFY (typedef only) | contract | n/a (type doc) | `@typedef WorkspaceInfo` (interface.js:14-24) | exact |
| `test/fixtures/cmux/surface-resume-show.json` | CREATE | test fixture (golden) | data (frozen CLI output) | `test/fixtures/cmux/list-workspaces.json` | exact |
| `test/host/contract.test.js` | MODIFY (extend) | test (contract matrix + golden) | request-response | `fakeExecFromFixtures` + `describe('CmuxHost…')` (mismo archivo) | exact |
| `test/host/cmux-isolation.test.js` | VERIFY-ONLY (no edit) | test (structural walker) | n/a | n/a — debe seguir verde sin cambios | n/a |

**Probable extra fixture (Claude's Discretion, RESEARCH §Recommended Structure):** `test/fixtures/cmux/surface-tree.json` — la salida de `tree --all --json` para alimentar el paso-1 de enumeración. Mismo molde de fixture (`list-workspaces.json`). El planner decide si el test ejerce la enumeración completa de 2 pasos o stubea el paso-1.

---

## Pattern Assignments

### `src/host/cmux.js` — `listAgentSurfaces()` (host adapter, request-response, 2-step enumeration)

**Analog:** `listWorkspaces()` (same file, lines 62-118). Copy the never-throws shape exactly; change the commands and output shape.

**Imports pattern** (cmux.js:10-12) — NO new imports needed; `run` DI already exists:
```javascript
import { execFile, execFileSync } from 'node:child_process';
import { loadConfig } from '../config.js';
import { runFocus } from '../cli/dashboard/focus.js';
// NO `import '../logger.js'` — prohibido (LOG-12). El logger entra por opts.logger.
```

**The `run` DI seam** (cmux.js:24-42) — el método nuevo lo reusa SIN tocar la infraestructura de exec. Esto es exactamente el seam que el test inyecta:
```javascript
function makeRun(execSync, binary) {
  return async (args) =>
    execSync(binary, args, { encoding: 'utf-8', timeout: TIMEOUT_MS });
}
// dentro de createCmuxHost(opts):
const run = opts.run || makeRun(opts.execSync || execFileSync, binary);
const logger = opts.logger;
```
`listAgentSurfaces` se define como una función interna más dentro de `createCmuxHost` (junto a `listWorkspaces`/`selectWorkspace`/…) y se añade al objeto de retorno (ver "Integration / Return shape" abajo).

**Core never-throws + logger + map pattern** — molde directo de `listWorkspaces` (cmux.js:62-118):
```javascript
async function listWorkspaces() {
  const started = Date.now();
  let wsRaw;
  let notifRaw;
  try {
    [wsRaw, notifRaw] = await Promise.all([
      run(['list-workspaces', '--json']),
      run(['rpc', 'notification.list']),
    ]);
  } catch (err) {
    logger?.warn?.('host.list_workspaces.fail', {
      code: err?.code || 'EXEC_ERROR',
      detail: String(err?.message || '').trim(),
      duration_ms: Date.now() - started,
    });
    return [];
  }

  let workspaces;
  try {
    workspaces = JSON.parse(wsRaw).workspaces || [];
  } catch (err) {
    logger?.warn?.('host.list_workspaces.fail', {
      code: 'PARSE_ERROR',
      detail: String(err?.message || '').trim(),
      duration_ms: Date.now() - started,
    });
    return [];
  }

  const result = workspaces.map((w) => { /* … normalize … */ });

  logger?.info?.('host.list_workspaces.ok', {
    count: result.length,
    duration_ms: Date.now() - started,
  });
  return result;
}
```

**What changes for `listAgentSurfaces`** (RESEARCH §Pattern 1 — the empirically-resolved 2-step enumeration):
- Step 1 command: `run(['tree', '--all', '--json', '--id-format', 'both'])` → `JSON.parse` → extract live surface refs (helper `extractSurfaceRefs`). `tree` exec/parse failure → `logger?.warn?.('host.list_agent_surfaces.fail', {code, detail, duration_ms})` + `return []` (EXACT mirror of the catch above).
- Step 2 fan-out: per surface ref, `run(['surface', 'resume', 'show', '--json', '--surface', ref])`. **The try/catch goes INSIDE the loop** (D-05 row-by-row): a `not_found`/exec/parse failure on one surface does `continue`, never `return` (RESEARCH Pitfall 3). Only step-1 failure returns `[]`.
- Each successful `show` → `normalizeSurface(raw)`; push if non-null.
- Final: `logger?.info?.('host.list_agent_surfaces.ok', { count, duration_ms })`.
- Event names follow the `host.list_workspaces.*` taxonomy (Claude's Discretion → `host.list_agent_surfaces.ok|fail`).

**Pure helper `normalizeSurface(raw)`** (Claude's Discretion → recommended; D-02 field map + D-05 guards). No analog by name, but mirrors the inline `.map((w) => {…})` of `listWorkspaces` extracted for testability. Defined at module scope (pure, no I/O):
```javascript
function normalizeSurface(raw) {
  if (!raw || raw.cleared === true) return null;            // D-05: cleared
  const b = raw.resume_binding;
  if (!b) return null;                                       // D-05: sin resume_binding
  if (b.source !== 'agent-hook') return null;                // D-05: source≠agent-hook
  if (typeof b.checkpoint_id !== 'string' || typeof b.cwd !== 'string') return null;
  return {
    workspaceRef: raw.workspace_ref,   // D-02 (ver Assumption A1 — puede derivarse del tree si el ref es relativo)
    cwd: b.cwd,                        // D-02
    sessionId: b.checkpoint_id,        // D-02 (== session_id de Claude Code, P0)
    kind: b.kind,                      // D-02 (NO se filtra por kind aquí — D-05)
  };
}
```

**Integration / Return shape** (cmux.js:178) — añadir el método al objeto retornado, junto a los 4 del contrato + `_legacy`. NO se toca `_legacy`:
```javascript
// actual:
return { listWorkspaces, selectWorkspace, isAlive, needsInput, _legacy };
// nuevo:
return { listWorkspaces, selectWorkspace, isAlive, needsInput, listAgentSurfaces, _legacy };
```

**Field-map source of truth** — el shape `{ workspaceRef, cwd, sessionId, kind }` se alinea EXACTAMENTE con la firma de entrada de `adoptSession` (adopt.js:163-166) para que el consumer lo pase sin transformación:
```javascript
export async function adoptSession(
  { provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title, description },
  deps = {},
) { /* … */ }
```

---

### `src/host/interface.js` — `@typedef AgentSurface` (contract, type doc only)

**Analog:** `@typedef WorkspaceInfo` (interface.js:14-24). Mismo estilo JSDoc, paralelo. **Divergencia consciente:** camelCase (este shape) vs snake_case (`WorkspaceInfo`) — D-02.

**Typedef pattern** (interface.js:14-24):
```javascript
/**
 * @typedef {Object} WorkspaceInfo
 * @property {string} workspace_ref - Ref canónico host-specific (e.g. "workspace:N"). D-03.
 * @property {boolean} alive - ...
 * @property {boolean} needs_input - ...
 * @property {string|null} last_activity - ...
 * @property {string} [title] - ...
 */
```
New typedef to add (camelCase, D-02):
```javascript
/**
 * @typedef {Object} AgentSurface
 * @property {string} workspaceRef - Ref del workspace del surface (host-specific).
 * @property {string} cwd - cwd de la sesión-agente (← resume_binding.cwd).
 * @property {string} sessionId - Identidad estable (← resume_binding.checkpoint_id == session_id de Claude Code).
 * @property {string} kind - Tipo de agente (← resume_binding.kind; el consumer filtra, NO este método).
 */
```

**CRITICAL — `HOST_METHODS` NO CAMBIA** (interface.js:34-39). D-03: el método queda FUERA del contrato congelado de 4. NO se añade a `HOST_METHODS` ni a `validateHost`:
```javascript
export const HOST_METHODS = Object.freeze([
  'listWorkspaces', 'selectWorkspace', 'isAlive', 'needsInput',
]); // sigue en 4 — el contract test lo asierta (contract.test.js:87-94)
```

**`NullHost` stub decision** (interface.js:60-67, Claude's Discretion). Sus 4 stubs neutros son el molde si el planner decide stubear:
```javascript
function createNullHost() {
  return {
    listWorkspaces: async () => [],
    selectWorkspace: async () => ({ ok: true }),
    isAlive: async () => false,
    needsInput: async () => false,
    // opcional D-03: listAgentSurfaces: async () => [],  ← o se OMITE para probar la rama "host no lo soporta"
  };
}
```

---

### `test/fixtures/cmux/surface-resume-show.json` (CREATE — golden fixture)

**Analog:** `test/fixtures/cmux/list-workspaces.json` (raw cmux output, frozen). Mismo molde: salida CRUDA real, no inventada.

**Shape to capture** (RESEARCH §Code Examples — verificado contra cmux **0.64.16 build 96**, NO 0.64.15 — anotar la versión exacta en un comentario/sidecar). Un `surface resume show --json` adoptable:
```json
{
  "cleared": false,
  "pane_ref": "pane:1",
  "resume_binding": {
    "checkpoint_id": "c1c3ed6d-fa07-43af-add7-44274b1e0a64",
    "cwd": "/Users/alex/dev/klab/kodo",
    "kind": "claude",
    "name": "Claude Code",
    "source": "agent-hook",
    "updated_at": 1781624696.837585
  },
  "surface_ref": "surface:1",
  "window_ref": "window:1",
  "workspace_ref": "workspace:1"
}
```
La fixture debe incluir además (para ejercer D-05 en el mismo test):
- 1 caso `cleared: true`
- 1 caso sin `resume_binding`
- 1 caso `source: "environment"` (o `"tmux"`/`"opencode"`) ≠ `agent-hook`

**Structuring note:** dado que cada `resume show` devuelve UN objeto (no un array — Pitfall 1), la fixture puede ser un objeto-por-ref (mapa `surfaceRef → showOutput`) o varios archivos; el planner elige cómo `fakeExecFromFixtures` los enruta por `--surface <ref>`. Si se hace la enumeración de 2 pasos, añadir `surface-tree.json` (shape de `tree --all --json` en RESEARCH §Code Examples) para el paso-1.

---

### `test/host/contract.test.js` (MODIFY — extend matrix + golden asserts)

**Analog:** el propio archivo. Tres extensiones, todas con molde existente.

**1. Extend `fakeExecFromFixtures`** (contract.test.js:35-49) — añadir ramas por argv:
```javascript
function fakeExecFromFixtures() {
  return (binary, args, opts, cb) => {
    const argv = (args || []).join(' ');
    let payload = '';
    if (argv.includes('list-workspaces')) payload = LIST_FIXTURE;
    else if (argv.includes('notification.list')) payload = NOTIF_FIXTURE;
    // NUEVO:
    // else if (argv.includes('tree')) payload = TREE_FIXTURE;
    // else if (argv.includes('surface resume show')) payload = SURFACE_FIXTURE_FOR(argv); // enruta por --surface
    else payload = '';
    if (typeof cb === 'function') { cb(null, payload, ''); return; }
    return payload; // execFileSync style
  };
}
```
**Nota:** `instantiateHost` (contract.test.js:70-84) tiene un SEGUNDO router en su `run:` async — extender LAS DOS ramas (o factorizar el routing). El `argv` se construye con `(args || []).join(' ')`, así que `'surface resume show'` matchea el argv `['surface','resume','show','--json','--surface',ref]`.

**2. Fixture load** (contract.test.js:14-17) — molde:
```javascript
const FIXTURES = join(__dirname, '..', 'fixtures', 'cmux');
const LIST_FIXTURE = readFileSync(join(FIXTURES, 'list-workspaces.json'), 'utf-8');
const NOTIF_FIXTURE = readFileSync(join(FIXTURES, 'notification-list.json'), 'utf-8');
// NUEVO: const SURFACE_FIXTURE = readFileSync(join(FIXTURES, 'surface-resume-show.json'), 'utf-8');
```

**3. New golden describe** — molde EXACTO de `describe('CmuxHost — derivación needs_input…')` (contract.test.js:142-171). Asserts campo a campo + casos fail-open:
```javascript
describe('CmuxHost — listAgentSurfaces (DETECT-01)', () => {
  let host;
  before(() => { host = instantiateHost('cmux'); });

  test('retorna array de AgentSurface {workspaceRef,cwd,sessionId,kind}', async () => {
    const surfaces = await host.listAgentSurfaces();
    assert.ok(Array.isArray(surfaces));
    // assert campo a campo: sessionId === checkpoint_id, cwd, kind, workspaceRef
  });
  test('omite cleared:true / sin resume_binding / source≠agent-hook (D-05)', async () => { /* … */ });
  test('tree falla → [] (fail-open D-05)', async () => { /* run lanza en tree */ });
  test('un resume show individual falla → se omite esa surface, no rompe el array (D-05 fila-a-fila)', async () => { /* … */ });
});
```

**Optional typeof-detection test** (RESEARCH Wave 0 gap): si `NullHost` NO stubea el método, asertar `typeof getHost('null').listAgentSurfaces !== 'function'` para documentar la rama de degradación del consumer.

**DO NOT break the matrix invariant** (contract.test.js:87-94): el test `HOST_METHODS es exactamente los 4 métodos` debe seguir verde — confirma D-03.

---

### `test/host/cmux-isolation.test.js` (VERIFY-ONLY — no edit)

**No analog needed.** El walker (SC#5) confina cmux a `src/host/cmux.js`. Como `listAgentSurfaces` vive DENTRO de `src/host/cmux.js` y NO añade imports de `cmux/client.js` a las 3 áreas escaneadas (`src/cli/dashboard/`, `src/session/`, `src/cli/polling.js` — líneas 65-69), este test debe seguir verde sin cambios. Solo confirmar cobertura tras implementar.

---

## Shared Patterns

### never-throws + logger inyectado
**Source:** `src/host/cmux.js:62-118` (`listWorkspaces`)
**Apply to:** `listAgentSurfaces` (todas las ramas de fallo loguean `warn` + retornan neutro `[]`; el éxito loguea `info`).
```javascript
} catch (err) {
  logger?.warn?.('host.<event>.fail', {
    code: err?.code || 'EXEC_ERROR',     // o 'PARSE_ERROR' en el segundo catch
    detail: String(err?.message || '').trim(),
    duration_ms: Date.now() - started,
  });
  return [];
}
```
El logger NUNCA se importa (LOG-12) — entra por `opts.logger`, se lee como `logger?.warn?.(...)`.

### typeof-detected optional method (FUERA del contrato congelado)
**Source:** `src/providers/plane/provider.js:236-264` (cómo se DOCUMENTA `getTaskState`/`createTask` como opcional), `src/server/provider-state.js:78` y `src/adopt.js:174` (el CALL SITE real).
**Apply to:** la documentación del método nuevo (no a su implementación interna). El consumer (Phase 56, FUERA de scope) replicará el guard:
```javascript
// provider.js:236 — cómo se documenta:
// OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9). Detected at the
// call site via `typeof provider.getTaskState === 'function'`.

// provider-state.js:78 / adopt.js:174 — el call site (molde para Phase 56):
if (typeof provider.getTaskState !== 'function') {
  return { state: null, reason: 'unsupported' };
}
```
Para `listAgentSurfaces`: el comentario en `src/host/cmux.js` debe decir "OPTIONAL (NOT in HOST_METHODS — FROZEN at 4). Detected via `typeof host.listAgentSurfaces === 'function'`."

### Fixture-lock vía `run` DI (argv routing)
**Source:** `test/host/contract.test.js:35-49` (`fakeExecFromFixtures`) + `:70-84` (`instantiateHost` run router)
**Apply to:** el nuevo test sirve `surface-resume-show.json` (y opcional `surface-tree.json`) enrutando por `argv.includes('tree')` / `argv.includes('surface resume show')`. Un cambio de contrato de cmux rompe el golden assert ruidosamente (DETECT-01(a)).

### Identidad estable ≠ workspaceRef (defensa Phase 43)
**Source:** comentario en `src/host/cmux.js:104-107` (cmux recicla `workspace:N`)
**Apply to:** D-06 — el set-difference downstream (Phase 56, FUERA de scope) se keyea por `sessionId`/`cwd`, NUNCA por `workspaceRef`. RESEARCH Pitfall 5 + Assumption A1: `surface_ref`/`workspace_ref` que devuelve `resume show` son relativos al caller; si resultan no fiables, derivar `workspaceRef` del paso-1 (`tree`) en vez del binding.

---

## No Analog Found

Ninguno. Los 5 archivos tienen analogo exacto en el mismo subsistema. Las únicas piezas "nuevas" son:
- El helper puro `normalizeSurface(raw)` — sin analogo por nombre, pero es la extracción testeable del `.map((w) => {…})` inline de `listWorkspaces`.
- La enumeración de 2 pasos (`tree` → fan-out `resume show`) — sin analogo de estructura (los 4 métodos del contrato son single-call), PERO cada paso individual sigue el molde `try/run/catch/parse` de `listWorkspaces`. RESEARCH §Pattern 1 da el esqueleto completo verificado.

---

## Metadata

**Analog search scope:** `src/host/`, `test/host/`, `test/fixtures/cmux/`, `src/providers/plane/`, `src/server/`, `src/adopt.js`
**Files scanned/read:** 7 (cmux.js, interface.js, contract.test.js, list-workspaces.json, cmux-isolation.test.js, provider-state.js, plane/provider.js, adopt.js excerpts)
**Pattern extraction date:** 2026-06-16
**cmux version locked:** 0.64.16 (build 96) — NOT 0.64.15 (RESEARCH Pitfall 2)
