# Phase 55: Contrato `HostProvider.describeSurface()` (cmux) - Research

**Researched:** 2026-06-16
**Domain:** cmux CLI integration · WorkspaceHost contract extension (Node.js, ESM, node:test)
**Confidence:** HIGH (open question resolved empirically against the real binary)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Método primario `listAgentSurfaces()` (enumeración → array), NO `describeSurface(ref)`. Devuelve `AgentSurface[]`. Un consumer que quiera una sola surface por `ref` filtra el array por `workspaceRef`. NO se añade un segundo método salvo que cmux ofrezca una consulta per-ref más barata (Karpathy regla 2: una superficie, no dos especulativas).
- **D-02:** camelCase `{ workspaceRef, cwd, sessionId, kind }` — alineado EXACTAMENTE con la firma de entrada de `adoptSession`. Divergencia consciente del `WorkspaceInfo` snake_case existente. Mapeo: `sessionId ← resume_binding.checkpoint_id`; `cwd ← resume_binding.cwd`; `kind ← resume_binding.kind`; `workspaceRef ← workspace_ref` del surface.
- **D-03:** El método NO se añade a `HOST_METHODS` (sigue congelado en 4) ni a `validateHost`. Se detecta por `typeof host.listAgentSurfaces === 'function'` en el call site — espejo 1:1 de `getTaskState`/`createTask`. `NullHost` puede stubear retornando `[]`.
- **D-04:** Nueva fixture `test/fixtures/cmux/surface-resume-show.json` con salida cruda real, asertada vía el `run` DI existente. Incluye ≥1 surface adoptable + casos de fallo (cleared / sin resume_binding / source≠agent-hook).
- **D-05:** never-throws, degrada fila-a-fila. Socket caído/exec error/JSON corrupto → `logger?.warn?.`, retorna `[]`. Por surface: `cleared:true`, `resume_binding` ausente, `source != 'agent-hook'` → se omite. NO se filtra por `kind=="claude"` aquí — el consumer decide.
- **D-06:** El set-difference contra `state.json` vive en el CONSUMIDOR (Phase 56), NO aquí. Keyeado por `sessionId`/`cwd`, NUNCA por `workspaceRef` (defensa Phase 43: cmux recicla `workspace:N`).

### Claude's Discretion
- Nombre final del método (`listAgentSurfaces` vs `describeSurfaces` plural) — el planner lo fija para encajar con la convención de `src/host/`.
- Estructura interna del parseo (helper puro `normalizeSurface(raw)` vs inline) — recomendado un helper puro testeable, espejo de cómo `listWorkspaces` mapea `WorkspaceInfo`.
- Si `NullHost` stubea el método o se deja ausente para probar la rama "host no lo soporta".
- Nombres de eventos NDJSON exactos (`host.list_agent_surfaces.ok/fail`) — siguiendo la taxonomía de `host.list_workspaces.*`.

### Deferred Ideas (OUT OF SCOPE)
- Set-difference + tecla `a` "sesiones adoptables descubiertas" → Phase 56 (DETECT-02).
- Auto-derivar flags de `kodo adopt` (`--cwd`/`--session-id`/`--workspace`) desde este seam → Phase 54/57.
- P1 reconcile event-driven (`cmux events` + `top --processes`) → v0.14.
- P2 sidebar nativo (`set-progress`/`set-status`) → mejora oportunista.
- P3 `notify` rico + `send-key` → fuera de scope.
- Cualquier llamada a `cmux` desde `adopt.js`/`reconcile.js`/hooks → PROHIBIDA por la regla transversal LOCKED.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DETECT-01 | Método opcional typeof-detected en `HostProvider`, implementado en `src/host/cmux.js` sobre `cmux surface resume show --json`. Devuelve `{ workspaceRef, cwd, sessionId, kind }` por surface. (a) fixture-lock salida real; (b) fail-open en cleared/sin resume_binding/source≠agent-hook/socket caído; (c) set-difference downstream keyeado por sessionId/cwd. | Enumeration mechanism resuelto empíricamente (ver Summary + Open Question). Mapeo de campos verificado contra `cmux surface resume show --json` en 0.64.16. Molde de implementación = `listWorkspaces` (never-throws + `logger?.warn` + `.map()`). Molde de fixture = `list-workspaces.json`. Molde de test = `contract.test.js` `fakeExecFromFixtures`. |
</phase_requirements>

## Summary

Esta fase NO es un spike — la viabilidad de correlacionar surface→sessionId estaba probada (CMUX-CAPABILITIES.md §P0) y la he **re-verificado contra el binario real**. El deliverable es código de producción + fixture. La fase es de **bajo riesgo arquitectónico**: el molde existe entero (`listWorkspaces` en `src/host/cmux.js`), el seam de test existe (`run` DI + `fakeExecFromFixtures`), y los precedentes typeof-detected existen (`getTaskState`/`createTask`).

**El hallazgo crítico — y la corrección a la premisa de CONTEXT.md:** `cmux surface resume show --json` opera sobre **UN SOLO surface** (el del contexto del caller, `$CMUX_SURFACE_ID`, o el pasado por `--surface`). **NO enumera.** La CLI de cmux 0.64.16 **no expone** ningún `surface resume list` (verificado en `cmux capabilities`: existe `surface.resume.{set,get,clear}` y el `show` de CLI, pero NO un `.list`). Por tanto `listAgentSurfaces()` debe enumerar en DOS pasos: (1) listar surfaces vivas vía `cmux tree --all --json`, (2) por cada surface llamar `cmux surface resume show --json --surface <ref>` y quedarse con las que tienen `resume_binding.source == 'agent-hook'` y `cleared == false`. Confirmado empíricamente: con `--surface <UUID>` de una surface viva el `show` devuelve su binding; con un UUID de surface cerrada devuelve `Error: not_found: Surface not found`.

**Segundo hallazgo:** la versión instalada es **0.64.16 (build 96)**, no 0.64.15. La fixture debe capturarse de 0.64.16 y la documentación del fixture debe anotar la versión exacta. El shape del `resume_binding` es idéntico al de §P0 (campos `kind`, `checkpoint_id`, `cwd`, `source`, `cleared`).

**Primary recommendation:** Implementar `listAgentSurfaces()` en `src/host/cmux.js` como enumeración de dos pasos (`tree --all --json` → fan-out de `surface resume show --json --surface <ref>`), normalizando cada binding válido a `{ workspaceRef, cwd, sessionId, kind }` vía un helper puro `normalizeSurface(raw)`. never-throws en todas las ramas (tree falla → `[]`; un `show` individual falla/`not_found` → se omite esa surface, no rompe el array). Fixture-lock vía el `run` DI con un test que enruta por argv (`includes('tree')` y `includes('surface resume show')`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enumerar surfaces cmux vivas | Host adapter (`src/host/cmux.js`) | — | Único punto autorizado a hablar con el binario cmux (SC#5 walker). |
| Parsear `resume_binding` → `{workspaceRef,cwd,sessionId,kind}` | Host adapter (`src/host/cmux.js`) | — | Transformación host-specific. El consumer recibe datos host-agnósticos. |
| Detección opcional `typeof host.listAgentSurfaces` | Consumer call site (Phase 56) | — | Degradación fail-open; FUERA del contrato congelado (D-03). |
| Set-difference vs `state.json` (dedup) | Consumer (Phase 56) | — | D-06: keyeado por sessionId/cwd. NO en este método. |
| Definir `@typedef AgentSurface` | Contract (`src/host/interface.js`) | — | Documentación del shape, paralelo a `WorkspaceInfo`. `HOST_METHODS` no cambia. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js builtins (`node:child_process`) | runtime | `execFile`/`execFileSync` para shell-out a cmux | Ya en uso en `src/host/cmux.js`; cero deps nuevas. |
| `node:test` + `node:assert/strict` | runtime | Contract matrix + golden fixture assert | Framework de test ya en uso (`contract.test.js`). |
| cmux CLI | **0.64.16 (build 96)** | `tree --all --json`, `surface resume show --json` | El host real. Verificado instalado en `/Applications/cmux.app/Contents/Resources/bin/cmux`. |

### Supporting
No hay librerías nuevas. **Esta fase NO instala ningún paquete.** Todo es código de producción + fixture JSON sobre infraestructura existente.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tree --all --json` para enumerar surfaces | Iterar `~/.cmuxterm/claude-hook-sessions.json` | El JSON crudo tiene `sessionId`/`cwd`/`surfaceId`/`workspaceId` PERO **carece de `kind`/`source`/`cleared`** y de `workspace_ref` (solo UUIDs internos). Requeriría un segundo paso de cruce contra `tree` igualmente. **El path CLI (`tree` + `resume show`) es el único que da los 4 campos + el filtro `source==agent-hook` directamente.** Ver Pitfall 4. |
| `tree --all --json` | `list-pane-surfaces` | `list-pane-surfaces` es solo del workspace/pane actual y no da UUIDs por defecto. `tree --all` da el árbol completo de TODOS los workspaces vivos con `--id-format both`. |
| Fan-out de N `resume show` | Un solo `resume show` sin `--surface` | **NO enumera** — devuelve solo el surface del caller. Descartado: rompe D-01 (enumeración). |

**Installation:** N/A — sin paquetes nuevos.

**Version verification:** `cmux --version` → `cmux 0.64.16 (96) [5321becb6]` (VERIFIED: binario instalado). CMUX-CAPABILITIES.md cita 0.64.15 — **la fixture debe anotar 0.64.16** como la versión real congelada.

## Package Legitimacy Audit

> N/A — esta fase no instala paquetes externos. Solo código de producción + fixture JSON usando builtins de Node ya presentes. No hay superficie de slopsquatting.

## Architecture Patterns

### System Architecture Diagram

```
                         listAgentSurfaces()  [src/host/cmux.js]
                                   │
                                   ▼
                   ┌───────────────────────────────┐
   PASO 1: enumerar │  run(['tree','--all','--json',  │  ──► JSON.parse ──► windows[].workspaces[]
   surfaces vivas    │       '--id-format','both'])    │                        .panes[].surfaces[]
                   └───────────────────────────────┘      (ref + UUID por surface)
                                   │  exec error / parse error
                                   │ ──────────────────────────► logger.warn + return []  (fail-open)
                                   ▼
                   para cada surface_ref:
                   ┌───────────────────────────────┐
   PASO 2: resolver  │ run(['surface','resume','show', │  ──► { resume_binding, cleared, workspace_ref }
   el resume_binding │      '--json','--surface',<ref>])│
                   └───────────────────────────────┘
                                   │
                  ┌────────────────┼─────────────────────────────┐
       not_found /│ exec error     │ JSON ok                      │
       cleared:true│ resume_binding │ source == 'agent-hook'       │
       source≠hook │ ausente        │ cleared == false             │
                  ▼                 ▼                              ▼
              OMITIR (skip)    OMITIR (skip)             normalizeSurface(raw)  [helper puro]
                                                          { workspaceRef, cwd, sessionId, kind }
                                                                  │
                                                                  ▼
                                          AgentSurface[]  ──►  Phase 56 (set-difference vs state.json)
```

Entrada: el call site del consumer hace `typeof host.listAgentSurfaces === 'function'`. Salida: `AgentSurface[]` host-agnóstico, jamás throws.

### Recommended Project Structure
```
src/host/
├── interface.js     # + @typedef AgentSurface; HOST_METHODS sin cambios; NullHost opcional stub
└── cmux.js          # + listAgentSurfaces() + helper normalizeSurface(raw); reusa el `run` DI
test/host/
└── contract.test.js # + rama fakeExecFromFixtures para 'tree' y 'surface resume show'; nuevo describe
test/fixtures/cmux/
├── surface-resume-show.json   # NUEVA: array/casos de salida cruda 0.64.16 (≥1 adoptable + fallos)
└── (opcional) surface-tree.json  # la salida de `tree --all --json` para alimentar el paso 1
```

### Pattern 1: never-throws + logger inyectado + `.map()` (molde directo de `listWorkspaces`)
**What:** El método copia la forma exacta de `listWorkspaces` (src/host/cmux.js:62-118): `try { run([...]) } catch { logger?.warn?.(...); return [] }`, luego `JSON.parse` envuelto en un segundo try/catch con `code:'PARSE_ERROR'`, luego `.map()` normalizador.
**When to use:** Siempre — es el invariante de `src/host/`.
**Example:**
```javascript
// Source: src/host/cmux.js:62-118 (listWorkspaces — el molde a espejar)
async function listAgentSurfaces() {
  const started = Date.now();
  let treeRaw;
  try {
    treeRaw = await run(['tree', '--all', '--json', '--id-format', 'both']);
  } catch (err) {
    logger?.warn?.('host.list_agent_surfaces.fail', {
      code: err?.code || 'EXEC_ERROR',
      detail: String(err?.message || '').trim(),
      duration_ms: Date.now() - started,
    });
    return [];
  }
  let surfaceRefs;
  try {
    surfaceRefs = extractSurfaceRefs(JSON.parse(treeRaw)); // helper puro
  } catch (err) {
    logger?.warn?.('host.list_agent_surfaces.fail', { code: 'PARSE_ERROR', /* … */ });
    return [];
  }
  const out = [];
  for (const ref of surfaceRefs) {
    let raw;
    try {
      raw = JSON.parse(await run(['surface', 'resume', 'show', '--json', '--surface', ref]));
    } catch {
      continue; // not_found / exec error / parse → omitir esta surface (D-05 fila-a-fila)
    }
    const surface = normalizeSurface(raw); // null si cleared/sin binding/source≠agent-hook
    if (surface) out.push(surface);
  }
  logger?.info?.('host.list_agent_surfaces.ok', { count: out.length, duration_ms: Date.now() - started });
  return out;
}
```

### Pattern 2: helper puro `normalizeSurface(raw)` (D-05 filtro fila-a-fila)
**What:** Helper testeable que mapea un `resume show` crudo → `AgentSurface | null`. Devuelve `null` para surfaces inválidas (que el caller omite). Aísla el mapeo de campos D-02 y los guards D-05.
**When to use:** Recomendado por Claude's Discretion; espejo de cómo `listWorkspaces` mapea inline pero extraído por testeabilidad.
**Example:**
```javascript
// Mapeo D-02 + guards D-05. Puro, sin I/O — testeable sin DI.
function normalizeSurface(raw) {
  if (!raw || raw.cleared === true) return null;            // D-05: cleared
  const b = raw.resume_binding;
  if (!b) return null;                                       // D-05: sin resume_binding
  if (b.source !== 'agent-hook') return null;                // D-05: source≠agent-hook
  if (typeof b.checkpoint_id !== 'string' || typeof b.cwd !== 'string') return null;
  return {
    workspaceRef: raw.workspace_ref,        // D-02
    cwd: b.cwd,                             // D-02
    sessionId: b.checkpoint_id,             // D-02 (== session_id de Claude Code)
    kind: b.kind,                           // D-02 (NO se filtra por kind aquí — D-05)
  };
}
```

### Anti-Patterns to Avoid
- **Llamar `surface resume show` sin `--surface` esperando que enumere:** devuelve SOLO el surface del caller. Verificado empíricamente. Es el error que la premisa de CONTEXT.md anticipaba — confirmado.
- **Keyear/dedup por `workspaceRef`:** prohibido por D-06. Además `surface_ref`/`workspace_ref` que devuelve `resume show` son **refs relativos al contexto del caller** (siempre `surface:1`/`workspace:1` cuando se llama desde la propia surface) — NO son identidades estables. La identidad estable es `sessionId` (== checkpoint_id) y `cwd`. Verificado: con `--surface <UUID>` distinto el `show` aún devolvió `surface_ref: surface:1`.
- **Iterar `claude-hook-sessions.json` como fuente primaria:** carece de `kind`/`source`/`cleared` y de `workspace_ref`. Solo serviría como fallback de enumeración, y exigiría cruce con `tree` igualmente. Ver Pitfall 4.
- **Importar `src/logger.js` en `src/host/cmux.js`:** prohibido por LOG-12. El logger entra por `opts.logger`.
- **Tocar `adopt.js`/`reconcile.js`:** la regla transversal LOCKED — todo lo cmux vive en `src/host/cmux.js`.
- **Añadir el método a `HOST_METHODS` o `validateHost`:** D-03 — queda fuera del contrato congelado, detectado por typeof.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shell-out a cmux | Un nuevo wrapper de child_process | El `run` DI existente de `createCmuxHost` (`makeRun`/`execFileSync`) | Ya inyectable, ya con timeout 5s, ya el seam de test. |
| Enrutar fixtures en test | Un nuevo mock framework | Extender `fakeExecFromFixtures` con ramas `includes('tree')` / `includes('surface resume show')` | Patrón ya establecido en `contract.test.js`. |
| Detección de capability opcional | Lógica nueva de feature-flags | `typeof host.listAgentSurfaces === 'function'` en el call site | Precedente 1:1 de `getTaskState`/`createTask` (provider-state.js:78). |
| Parsear el árbol cmux | Regex sobre la salida de texto de `tree` | `tree --all --json` | Hay salida JSON estructurada (verificada). El texto plano es frágil. |

**Key insight:** Esta fase es deliberadamente pequeña. La tentación es "construir un enumerador de sesiones cmux genérico"; la realidad es **copiar el molde de `listWorkspaces`, cambiar 2 comandos y el shape de salida**. Todo lo demás (DI, fixture-lock, typeof-detection, never-throws) ya existe.

## Runtime State Inventory

> No es una fase de rename/refactor. Esta sección documenta el estado runtime de cmux relevante para entender QUÉ enumera el método (no acciones de migración).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.cmuxterm/claude-hook-sessions.json` — mapa `surfaceUUID → {sessionId, updatedAt}` + bloque `sessions{}` con `cwd`/`agentLifecycle`/`isRestorable`/`surfaceId`/`workspaceId`. Verificado: 4 surfaces históricas, mezcla de live/cerradas, multi-proyecto (kodo, liken, optiai). | Solo lectura como fallback de enumeración (NO primaria — carece de kind/source/cleared). Ninguna migración. |
| Live service config | El estado live de cmux (workspaces/panes/surfaces abiertos) vive en el daemon de cmux, accesible vía socket Unix (`/tmp/cmux.sock`), NO en git. `tree --all --json` lo expone. Solo surfaces VIVAS resuelven en `resume show`. | Capturar la fixture de un estado live real con ≥1 sesión claude. |
| OS-registered state | Ninguno relevante. | None — verified by `cmux --help` (no registration commands tocan esto). |
| Secrets/env vars | `CMUX_WORKSPACE_ID`, `CMUX_SURFACE_ID`, `CMUX_SOCKET_PATH`, `CMUX_SOCKET_PASSWORD` — el contexto del caller. `resume show` sin `--surface` usa `$CMUX_SURFACE_ID`. | None — el método pasa `--surface <ref>` explícito; no depende del env del caller. |
| Build artifacts | Ninguno. | None. |

**El gotcha de runtime:** los UUIDs de surfaces cerradas que aparecen en `claude-hook-sessions.json` **no resuelven** en `resume show` (`Error: not_found: Surface not found`). El método solo descubrirá sesiones cuyas surfaces siguen vivas en cmux. Esto es correcto para el caso de uso (adoptar sesiones activas), pero el planner/Phase 56 debe saberlo: una sesión claude cerrada pero registrada en el hook-map NO es descubrible vía este path. Verificado empíricamente con 3 UUIDs históricos.

## Common Pitfalls

### Pitfall 1: Asumir que `surface resume show` enumera
**What goes wrong:** Se implementa `listAgentSurfaces()` como un solo `run(['surface','resume','show','--json'])` y devuelve un array de 1 elemento (el caller).
**Why it happens:** La fixture de §P0 muestra un único objeto; es tentador asumir que sin contexto lista todo.
**How to avoid:** Enumeración en 2 pasos (`tree --all --json` → fan-out de `resume show --surface <ref>`). No existe `surface resume list` en 0.64.16 (verificado en `cmux capabilities`).
**Warning signs:** El método solo devuelve la sesión actual; otras sesiones claude vivas no aparecen.

### Pitfall 2: Congelar la fixture con la versión equivocada
**What goes wrong:** Se documenta la fixture como 0.64.15 (lo que dice CMUX-CAPABILITIES.md) cuando el binario instalado es 0.64.16.
**Why it happens:** Confiar en el doc de research en vez del binario.
**How to avoid:** La fixture y su comentario anotan `cmux 0.64.16 (96)`. El test fixture-lock detecta drift de contrato; si cmux cambia el shape en una versión futura, el test rompe ruidosamente (DETECT-01(a)).
**Warning signs:** `cmux --version` ≠ versión documentada en la fixture.

### Pitfall 3: Dejar que un `resume show` individual rompa el array entero
**What goes wrong:** Una surface devuelve `not_found` o JSON corrupto y el método throws, perdiendo TODAS las surfaces.
**Why it happens:** El catch envuelve todo el bucle en vez de cada iteración.
**How to avoid:** D-05 fila-a-fila — el try/catch va DENTRO del bucle por surface; un fallo individual hace `continue`, no `return`. Solo el fallo del `tree` (paso 1) retorna `[]`.
**Warning signs:** Una surface cerrada/inválida vacía el descubrimiento entero.

### Pitfall 4: Usar `claude-hook-sessions.json` como fuente primaria
**What goes wrong:** Se parsea el JSON crudo y faltan `kind`/`source`/`cleared`; se cuelan sesiones tmux/opencode o cleared.
**Why it happens:** El archivo parece tener "todo" (sessionId, cwd, surfaceId).
**How to avoid:** Es solo fuente de fallback. El path autoritativo para `{kind, source, cleared}` es `surface resume show`. Si el planner quiere un fallback cuando el socket está caído, documentarlo explícitamente — pero el primario es la CLI.
**Warning signs:** Surfaces no-claude o cleared aparecen en el array.

### Pitfall 5: Confiar en `surface_ref`/`workspace_ref` de `resume show` como identidad
**What goes wrong:** `resume show` devuelve `surface_ref: "surface:1"` / `workspace_ref: "workspace:1"` **relativos al caller**, no la identidad global del surface consultado.
**Why it happens:** El JSON trae esos campos y parecen identificadores.
**How to avoid:** Para `workspaceRef` (D-02) usar el `workspace_ref` que devuelve el binding — PERO el planner debe verificar al capturar la fixture si ese ref es estable o relativo. La identidad para dedup (D-06) es SIEMPRE `sessionId`/`cwd`, nunca el ref. Verificado: llamar `show --surface <UUID-distinto>` aún devolvió `surface_ref: surface:1`.
**Warning signs:** Todos los surfaces enumerados comparten el mismo `workspaceRef`.

## Code Examples

### Capturar la fixture real (comando exacto a correr para D-04)
```bash
# Source: binario cmux 0.64.16 instalado (VERIFIED 2026-06-16)
# Paso 1 — enumerar surfaces vivas:
cmux tree --all --json --id-format both
# Paso 2 — por cada surface_ref, su resume_binding:
cmux surface resume show --json --surface surface:1
# (con un UUID de surface cerrada → Error: not_found: Surface not found, exit 0)
```

### Shape real de `surface resume show --json` (0.64.16) — adoptable
```json
{
  "cleared": false,
  "pane_ref": "pane:1",
  "resume_binding": {
    "approval_policy": "auto",
    "approval_record_id": null,
    "auto_resume": true,
    "checkpoint_id": "c1c3ed6d-fa07-43af-add7-44274b1e0a64",
    "command": "{ cd -- '/Users/alex/dev/klab/kodo' ... claude --resume c1c3ed6d... }",
    "cwd": "/Users/alex/dev/klab/kodo",
    "environment": null,
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
La fixture `surface-resume-show.json` debe incluir además al menos: un caso `cleared:true`, uno sin `resume_binding`, y uno con `source:"environment"` (o `"tmux"`/`"opencode"`) ≠ `agent-hook` — para ejercer D-05 en el mismo test. (Los `launchCommand.source: "environment"` y `kind: "tmux"` ya existen en el sistema real, ver `claude-hook-sessions.json`.)

### Shape de `tree --all --json` (0.64.16) — fuente del paso 1
```json
{
  "active": { "surface_ref": "surface:1", "workspace_ref": "workspace:1", ... },
  "caller": { ... },
  "windows": [{
    "ref": "window:1",
    "workspaces": [{
      "ref": "workspace:1", "title": "KODO DEV",
      "panes": [{
        "ref": "pane:1",
        "surface_refs": ["surface:1", "surface:2"],
        "surfaces": [
          { "ref": "surface:1", "type": "terminal", "title": "⠂ Claude Code", "tty": "ttys005" },
          { "ref": "surface:2", "type": "terminal", "title": "kodo start", "tty": "ttys001" }
        ]
      }]
    }]
  }]
}
```
**Nota:** las entradas de surface en `tree` NO traen `kind`/`resumable` — el `title` "Claude Code" es solo cosmético. El único discriminador fiable es llamar `resume show` y filtrar por `source == 'agent-hook'`. Con `--id-format both` cada `ref` viene acompañado del UUID (útil si el planner prefiere pasar UUID a `--surface`).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Phase 55 como "SPIKE research abierto" (BIDIR-F1 gate) | Contrato `HostProvider` con viabilidad probada | 2026-06-16 (CMUX-CAPABILITIES.md §P0) | El deliverable es código + fixture, no un veredicto. |
| CMUX 0.64.15 documentado | 0.64.16 (96) instalado | — | La fixture se congela de 0.64.16. Shape de `resume_binding` sin cambios. |
| `cmux list-workspaces` (legacy) | `cmux workspace list` (alias; legacy sigue funcionando) | — | Irrelevante para esta fase (usa `tree` + `surface resume show`). |

**Deprecated/outdated:**
- La premisa de CONTEXT.md de que `resume show` sin `--surface` *podría* enumerar: **descartada** — opera sobre un solo surface. No hay `surface resume list`.
- `cmux.com/es/docs/api`: desactualizada (afirma cosas falsas sobre read-screen/event-bus). Fiarse del binario.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `workspace_ref` que devuelve `resume show` es utilizable como el campo `workspaceRef` de D-02 (aunque sea relativo al caller). | Pitfall 5 / D-02 | BAJO. D-06 prohíbe dedup por workspaceRef de todos modos; sessionId/cwd son la identidad. El planner debe verificar al capturar la fixture si el ref es estable cuando se pasa `--surface` explícito. Mitigación: si resulta no fiable, el campo se puede derivar del paso 1 (`tree`) en vez del binding. |
| A2 | El fan-out de N×`resume show` es aceptable en latencia (≤5s timeout, ~50ms/call medido en §S5). Para pocas sesiones (típico <10) es trivial. | Pattern 1 | BAJO. Si hubiera decenas de surfaces, considerar `Promise.all` con límite. No es un caso real hoy (1 workspace vivo verificado). |
| A3 | `kind:"claude"` con `source:"agent-hook"` es el discriminador correcto de sesión-agente adoptable; otros `kind` (tmux/opencode) se incluyen en el array pero el consumer filtra. | D-05 / normalizeSurface | BAJO. D-05 dice explícitamente NO filtrar por kind aquí. El guard es solo `source==agent-hook` + `cleared==false` + `resume_binding` presente. |

## Open Questions

1. **RESUELTA: ¿Cómo enumera `listAgentSurfaces()`?**
   - Lo que sabíamos: §P0 mostraba un solo surface.
   - Resuelto empíricamente: `surface resume show` opera sobre UN surface (`--surface`/`$CMUX_SURFACE_ID`). NO existe `surface resume list`. Enumeración = `tree --all --json` (paso 1) + fan-out de `resume show --surface <ref>` (paso 2). Confirmado: UUID de surface cerrada → `not_found`.

2. **MENOR: ¿El `workspace_ref` del binding es estable o relativo al caller?**
   - Lo que sabemos: cuando se llama desde la propia surface, devuelve `workspace:1`/`surface:1`. Con `--surface <UUID>` distinto aún devolvió `surface_ref: surface:1`.
   - Lo que no está claro: si pasar `--surface` de OTRO surface vivo devuelve su `workspace_ref` real o el del caller. (En el momento de la captura solo había 1 workspace vivo, no se pudo cruzar.)
   - Recomendación: el planner captura la fixture con ≥2 surfaces claude vivas en workspaces distintos para verificar. Si el ref es relativo, derivar `workspaceRef` del paso 1 (`tree`, donde cada surface está anidada bajo su `workspace.ref`) en vez del binding. A1 cubre el riesgo (bajo, por D-06).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| cmux CLI | listAgentSurfaces() runtime | ✓ | 0.64.16 (96) | El método fail-open retorna `[]` si el binario/socket no está (D-05). Tests usan el `run` DI, no el binario real. |
| Node.js | runtime + test | ✓ | v22.22.3 | — |
| `~/.cmuxterm/claude-hook-sessions.json` | fallback de enumeración (opcional) | ✓ | — | El path CLI es el primario; este es fallback. |
| Sesión claude viva en cmux | capturar la fixture real (D-04) | ✓ | — | Esta misma sesión es una surface `kind:claude source:agent-hook` viva — sirve de captura. |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** El binario cmux en runtime degrada a `[]` (fail-open por diseño).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin) + `node:assert/strict` |
| Config file | none — `package.json` test script + globs |
| Quick run command | `node --test 'test/host/*.test.js'` |
| Full suite command | `npm test` (verificar el script exacto en package.json) |

Baseline verificado: `node --test 'test/host/*.test.js'` → **43 pass / 0 fail** (2026-06-16).

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETECT-01 | `listAgentSurfaces` existe y es función en CmuxHost | unit | `node --test test/host/contract.test.js` | ✅ (extender) |
| DETECT-01(a) | parsea fixture real → array `{workspaceRef,cwd,sessionId,kind}` campo a campo | unit (golden) | `node --test test/host/contract.test.js` | ❌ Wave 0 (fixture + asserts) |
| DETECT-01(b) | fail-open: cleared/sin binding/source≠agent-hook → omitidos; tree falla → `[]` | unit | `node --test test/host/contract.test.js` | ❌ Wave 0 |
| DETECT-01 | typeof-detection: NullHost sin el método → consumer degradaría (probar la rama) | unit | `node --test test/host/contract.test.js` | ❌ Wave 0 (decisión NullHost stub vs ausente) |
| DETECT-01(SC#5) | walker confirma cmux confinado a `src/host/cmux.js` | unit (walker) | `node --test test/host/cmux-isolation.test.js` | ✅ (debe seguir verde, sin cambios) |

### Sampling Rate
- **Per task commit:** `node --test 'test/host/*.test.js'`
- **Per wave merge:** `npm test` (suite completa)
- **Phase gate:** suite completa verde antes de `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/fixtures/cmux/surface-resume-show.json` — captura real 0.64.16 con ≥1 adoptable + casos de fallo (cleared/sin binding/source≠agent-hook). Cubre DETECT-01(a)(b).
- [ ] (opcional) `test/fixtures/cmux/surface-tree.json` — salida de `tree --all --json` para el paso 1, si el test ejerce la enumeración completa.
- [ ] Extender `fakeExecFromFixtures` en `contract.test.js` con ramas `includes('tree')` y `includes('surface resume show')`.
- [ ] Nuevo `describe('CmuxHost — listAgentSurfaces')` con asserts campo a campo + casos fail-open.
- [ ] Decisión: `NullHost` stubea `listAgentSurfaces: async () => []` o se deja ausente para probar la rama de degradación (Claude's Discretion).

## Security Domain

> `security_enforcement` no está explícitamente en false. Esta fase es bajo riesgo de seguridad: solo lee datos de cmux y los devuelve como datos. No persiste, no expone endpoints, no renderiza HTML.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (cmux socket auth lo maneja el binario) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `normalizeSurface` valida tipos (`typeof checkpoint_id === 'string'`) y descarta shapes inesperados → `null`. JSON.parse envuelto en try/catch. |
| V6 Cryptography | no | — |

### Known Threat Patterns for {Node.js shell-out a cmux}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection vía argv | Tampering | `execFile`/`execFileSync` con array argv literal (NO shell, NO interpolación). Ya el patrón de `src/host/cmux.js`. El `--surface <ref>` viene de la salida JSON de cmux, no de input de usuario. |
| Salida cmux maliciosa/corrupta crashea el host | DoS | never-throws D-05: parse en try/catch, fila-a-fila skip, return `[]`. El panel ink permanece montado. |
| Path traversal en `cwd` devuelto | — | El `cwd` se pasa como dato al consumer (Phase 56), que ya lo sanitiza vía `sanitizeAdoptionData` (BIDIR-08) antes de cualquier uso. Este método NO usa el `cwd`. |

## Sources

### Primary (HIGH confidence)
- Binario `cmux 0.64.16 (96)` instalado — `cmux --help`, `cmux surface resume show --json`, `cmux surface resume --help`, `cmux tree --all --json --id-format both`, `cmux capabilities`, `cmux workspace list --json`, `cmux surface resume show --json --surface <UUID>` (live + cerradas). VERIFIED 2026-06-16.
- `~/.cmuxterm/claude-hook-sessions.json` — inspeccionado directamente (estructura `activeSessionsBySurface`/`activeSessionsByWorkspace`/`sessions`).
- `src/host/cmux.js`, `src/host/interface.js`, `src/adopt.js`, `test/host/contract.test.js`, `test/host/cmux-isolation.test.js`, `test/fixtures/cmux/{list-workspaces,notification-list}.json` — leídos.
- `.planning/REQUIREMENTS.md` DETECT-01, `.planning/research/CMUX-CAPABILITIES.md` §P0, `.planning/phases/55-.../55-CONTEXT.md`.

### Secondary (MEDIUM confidence)
- `~/.claude/skills/cmux-diagnostics/SKILL.md` — confirma el path de los hook-sessions y el flag `terminal.autoResumeAgentSessions`.

### Tertiary (LOW confidence)
- Ninguna. Todo se verificó contra el binario.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sin paquetes nuevos; todo builtins/infra existente verificada en código.
- Architecture: HIGH — molde de `listWorkspaces` leído línea a línea; enumeración resuelta empíricamente contra el binario.
- Pitfalls: HIGH — los 5 pitfalls derivan de pruebas empíricas directas (not_found, refs relativos, falta de `surface resume list`, shape de hook-sessions).
- Open Question (enumeración): RESUELTA empíricamente.
- Residual (Q2 workspace_ref estabilidad): MEDIUM — bajo riesgo por D-06; verificar al capturar la fixture multi-surface.

**Research date:** 2026-06-16
**Valid until:** Estable mientras cmux no cambie el shape de `resume_binding` o introduzca `surface resume list` (el fixture-lock test detectaría el drift). Re-verificar si se actualiza cmux más allá de 0.64.x.
