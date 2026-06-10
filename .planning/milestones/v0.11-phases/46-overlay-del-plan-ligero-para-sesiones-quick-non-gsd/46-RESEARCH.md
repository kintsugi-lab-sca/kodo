# Phase 46: Overlay del plan ligero para sesiones quick/non-GSD - Research

**Researched:** 2026-06-10
**Domain:** Node.js TUI (Ink/React) — extensión de un reader filesystem puro, never-throws, leaf-isolated
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** El fallback vive **dentro de `readPlan` (`src/cli/dashboard/plan.js`)**, no en un reader separado ni en el handler `p` de `App.js`. `readPlan(row, deps)` ya es el único entry point que App.js invoca (`App.js:495`). El handler `p` no cambia su forma (sigue `readPlan(row, { resolvePhaseFn })` + `setOverlaySnapshot`).
- **D-02:** GSD tiene prioridad. El fallback corre **solo cuando `phaseId` queda `null`** tras intentar `row.phase_id` y el `resolvePhaseFn` inyectado (la rama que hoy retorna `{ status: 'no-phase' }` en `plan.js:69`). Una fila GSD con `phase_id` pero sin `PLAN.md` mantiene su `no-plan` actual. El fallback no toca las ramas `no-plan`/`error`/`ok` del flujo GSD existente.
- **D-03:** Correlación por **`task_id`** (espejo de Phase 45 D-02). Lookup directo `~/.kodo/plans/${row.task_id}.md`. Si `row.task_id` es ausente/falsy, no se intenta el artefacto y se mantiene `no-phase` (defensivo).
- **D-04:** Se **añade un status nuevo** ("sesión quick/non-GSD pero sin plan ligero escrito aún") con **copy propia** (NO se reusa `OVERLAY_PLAN_NO_PLAN`). Naming sugerido (literal a discreción del planner): status `no-light-plan` → constante `OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet'` (dim, informativo, no rojo).
- **D-05:** Mapeo de resultados del fallback a status:
  - artefacto leído con contenido → **`ok`** (reusa el render plano existente, línea a línea).
  - artefacto ausente (ENOENT) → **`no-light-plan`** (D-04, copy honesta nueva).
  - artefacto presente pero ilegible (EACCES/otros no-ENOENT) → **`error`** (reusa `OVERLAY_PLAN_ERROR`).
  - sin `phase_id` Y sin `task_id` utilizable → **`no-phase`** (mantiene `OVERLAY_PLAN_NO_PHASE`).
- **D-06:** El `no-phase` "puro" (fila sin phase_id, sin task_id) sigue existiendo como caso terminal — el fallback **estrecha** cuándo aparece, no lo elimina.
- **D-07:** `plan.js` importa **`homedir` de `node:os`** y computa la ruta inline: `join(homedir(), '.kodo', 'plans', \`${task_id}.md\`)`. NO se importa `src/config.js`; se replica la convención (`src/config.js:4,6`).
- **D-08:** Override opcional en `deps` para aislar HOME en tests (`deps.kodoPlansDir` o `deps.homedirFn`, naming a discreción). La lectura reusa `deps.readFileFn`. Sin override, default `homedir()` real.
- **D-09:** Anti-ReDoS y never-throws se preservan: la ruta es **construida** (no derivada de input por regex), envuelta en try/catch propio. El planner debe confirmar que `task_id` no contiene separadores; guard de contención estilo WR-01 (`String.includes`, no RegExp) si hay duda.

### Claude's Discretion
- Literal exacto de la copy nueva (`OVERLAY_PLAN_NO_LIGHT` u otro), dentro de los límites de D-04 ("honesta y distinta de NO_PHASE/NO_PLAN").
- Nombre exacto del status nuevo (`no-light-plan` u otro) y del override de deps (`kodoPlansDir`/`homedirFn`).
- Si el guard de contención de `task_id` (D-09) es necesario o redundante dado cómo se generan los `task_id`.

### Deferred Ideas (OUT OF SCOPE)
- Limpieza / retención de `~/.kodo/plans/` (no hay purga; candidato a `doctor`/cleanup futuro).
- Lista navegable multi-artefacto / multi-PLAN (no aplica: un único fichero por `task_id`).
- Frontmatter con metadata verificable (descartado en Phase 45 D-05; añadiría stripping al overlay).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-04 | El overlay de plan de PLAN-01 lee el artefacto de plan ligero y lo muestra para sesiones quick/non-GSD con la misma UX (snapshot congelado, copy honesta por caso, `Esc` preserva cursor por `task_id`, never-throws), como **fallback** cuando la fila no tiene `phase_id`/`PLAN.md` GSD. Cero endpoints nuevos en `src/server.js`; overlay sigue read-only. | El fallback se inserta en `plan.js:69` (rama `no-phase`). Toda la maquinaria de render/snapshot/Esc ya existe (Phase 44) y se reusa por el camino `{ status, lines }`. El productor (Phase 45) ya escribe `~/.kodo/plans/<task_id>.md`. El único trabajo de UI es la rama de copy del status nuevo en `SessionTable.js`. Cero endpoints: la lectura es filesystem directo (como el flujo GSD de `plan.js`). |
</phase_requirements>

## Summary

Esta fase es una **edición quirúrgica de tres ficheros** (`src/cli/dashboard/plan.js`, `App.js`, `SessionTable.js`) más tests puros. No hay paquetes nuevos, ni endpoints, ni I/O en producción más allá de un `readFile` sincrono envuelto en try/catch. El reader `readPlan` ya existe con un contrato `{ status, lines }` never-throws/anti-ReDoS/leaf-only perfectamente establecido en Phase 44; el fallback es **una rama nueva que sustituye el `return { status: 'no-phase', lines: [] }` de la línea 69** cuando hay `task_id` disponible.

El productor del artefacto (Phase 45, **ya shipped y verificado hoy 2026-06-10**) escribe `~/.kodo/plans/${session.task_id}.md` desde `src/hooks/session-start.js:85` (rama non-GSD ES) y `:145` (rama quick EN). La correlación es por `task_id` exacto, y `row.task_id` está disponible en App.js (`App.js:414` lo usa en `fetchComments`). El acoplamiento productor↔consumidor es **solo la convención de ruta** — sin estado compartido, sin endpoints.

Toda la UX (snapshot congelado, scroll, `Esc` preserva cursor por `task_id`, render plano línea a línea) **ya está construida** para el overlay GSD y se reusa idéntica: el plan ligero entra como otro `{ status, lines }` por el mismo `setOverlaySnapshot`. El único trabajo de UI nuevo es **una constante de copy exportada** (`App.js`) y **una rama de render** (`SessionTable.js`) para el status `no-light-plan`.

**Primary recommendation:** En `plan.js`, reemplazar `if (phaseId == null) return { status: 'no-phase', lines: [] }` (línea 69) por una llamada a una función `readLightPlan(row, deps)` cuando `row.task_id` sea truthy; mantener `no-phase` solo cuando `task_id` es falsy. `readLightPlan` computa `join(homedir(), '.kodo', 'plans', \`${task_id}.md\`)` (con override DI `deps.kodoPlansDir`/`deps.homedirFn`), lee con `deps.readFileFn` en su propio try/catch, y mapea ENOENT→`no-light-plan`, contenido→`ok`, otros→`error`. Añadir `OVERLAY_PLAN_NO_LIGHT` en `App.js:113` y su rama en `SessionTable.js:158`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resolver fila→fase GSD | reader puro (`plan.js`) | — | Ya existe; el fallback se inserta tras este paso |
| Leer artefacto de plan ligero del filesystem | reader puro (`plan.js`) | — | Mismo tier que la lectura de `PLAN.md` GSD; leaf-only, never-throws (D-01) |
| Mapear resultado→status | reader puro (`plan.js`) | — | El status es el discriminante del contrato (D-05) |
| Render del overlay (snapshot, scroll, copy) | presentacional (`SessionTable.js`) | — | Render puro de `{ status, lines }`; rama de copy nueva |
| Orquestar apertura del overlay (`p`) | handler (`App.js`) | — | Llama `readPlan` + `setOverlaySnapshot`; NO cambia su forma (D-01) |
| Producir el artefacto | sesión de Claude (runtime) | — | Phase 45, fuera de scope; solo lectura aquí |
| Persistencia del artefacto | filesystem `~/.kodo/plans/` | — | Convención de ruta compartida; cero endpoints |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:os` (`homedir`) | builtin | Resolver `~` para `~/.kodo/plans/` | Builtin → mantiene `plan.js` como leaf (D-07). Mismo patrón que `src/config.js:4` [VERIFIED: codebase grep src/config.js:4] |
| `node:path` (`join`) | builtin | Componer la ruta absoluta del artefacto | Ya importado en `plan.js:31` [VERIFIED: codebase grep plan.js:31] |
| `node:fs` (`readFileSync`) | builtin | Lectura sincrona del artefacto | Ya el default de `deps.readFileFn` en `plan.js:49` [VERIFIED: codebase grep plan.js:49] |
| `node:test` + `node:assert/strict` | builtin | Test runner | `package.json` test script usa `node --test` [VERIFIED: codebase grep package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `ink-testing-library` | (devDep instalado) | Tests de integración del handler `p` (frame assertions) | Solo si se añade un test de integración en `dashboard-overlay.test.js`; los tests de unidad de `readPlan` son PUROS (sin Ink) [VERIFIED: codebase grep package.json devDeps] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `homedir()` inline (D-07) | `import { KODO_DIR } from '../../config.js'` | RECHAZADO por D-07: acoplaría el leaf a `config.js`, que ejecuta `loadEnvFile()` y define I/O. Romper la leaf-isolation viola WARNING-01. Replicar la convención (no importar) es la decisión locked. |
| Reader separado para plan ligero | Función helper `readLightPlan` dentro de `plan.js` | D-01 locked: un solo reader, un solo entry point. Una función helper privada dentro del mismo módulo respeta D-01 (no es un módulo separado). |

**Installation:** Ninguna. Cero paquetes nuevos. Todos los imports son builtins de Node ya usados en el proyecto.

**Version verification:** No aplica — sin dependencias externas. Node builtins (`node:os`, `node:fs`, `node:path`) son parte del runtime.

## Package Legitimacy Audit

> No aplica: esta fase NO instala paquetes externos. Todos los módulos son builtins de Node (`node:os`, `node:fs`, `node:path`, `node:test`, `node:assert`) y un devDependency ya presente (`ink-testing-library`). slopcheck no es relevante.

## Architecture Patterns

### System Architecture Diagram

```
  [Operador pulsa `p` sobre fila seleccionada]
              │
              ▼
  App.js handler `p` (~482-502)
   row = filtered[sel.index]
   res = readPlan(row, { resolvePhaseFn })   ◄── SÍNCRONO, never-throws, sin await
              │
              ▼
  plan.js readPlan(row, deps)
   ┌─────────────────────────────────────────┐
   │ 1. phaseId = row.phase_id               │
   │    ?? resolvePhaseFn(...) (try/catch)   │
   └──────────────┬──────────────────────────┘
                  │ phaseId != null?
          ┌───────┴────────┐
        SÍ│                │NO  ◄── (plan.js:69, punto de inserción del fallback)
          ▼                ▼
   [flujo GSD existente]   ┌──────────────────────────────────────┐
   lee .planning/phases    │ FALLBACK PLAN LIGERO (nuevo, D-02)    │
   → ok/no-plan/error      │  row.task_id truthy?                 │
                           │   NO → no-phase (D-06, terminal)     │
                           │   SÍ → path = join(homedir(),        │
                           │         '.kodo','plans',`${id}.md`)  │
                           │     try readFileFn(path):            │
                           │       contenido → ok (lines plano)   │
                           │       ENOENT    → no-light-plan      │
                           │       otro err  → error              │
                           └──────────────┬───────────────────────┘
                                          │
              ▼                           ▼
   res = { status, lines }  ◄─────────────┘
              │
              ▼
  App.js: setOverlaySnapshot({ kind:'plan', taskRef, status, lines })
   setOverlayKind('plan'); setScrollOffset(0); setMode('overlay')
              │
              ▼
  SessionTable.renderOverlay(snap, scrollOffset, 'plan')
   status==='ok'           → render lines[] (scroll viewport)
   status==='no-light-plan'→ OVERLAY_PLAN_NO_LIGHT (dim)  ◄── RAMA NUEVA
   status==='no-phase'     → OVERLAY_PLAN_NO_PHASE (dim)
   status==='error'        → OVERLAY_PLAN_ERROR (red)
```

### Recommended Project Structure
```
src/cli/dashboard/
├── plan.js          # EDIT: añadir readLightPlan helper + rama en línea 69
├── App.js           # EDIT: añadir OVERLAY_PLAN_NO_LIGHT (~línea 113), import resolvePhase ya existe
└── SessionTable.js  # EDIT: importar OVERLAY_PLAN_NO_LIGHT + rama de render (~línea 158)
test/
└── dashboard-plan.test.js  # EDIT: añadir describe block para el fallback (DI puro)
```

### Pattern 1: Helper privado leaf-safe con DI override de HOME
**What:** Una función `readLightPlan(row, deps)` dentro de `plan.js` que computa la ruta del artefacto con override testable.
**When to use:** Para la rama del fallback; mantiene `readPlan` legible y los tests aislados del HOME real.
**Example:**
```javascript
// Source: patrón derivado de plan.js:47-51 (DI de deps) + config.js:4,6 (homedir convention)
import { homedir } from 'node:os';
// ... existing imports

function readLightPlan(taskId, deps) {
  // D-08: override DI para test HOME isolation; default homedir() real.
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const plansDir = deps.kodoPlansDir
    || join((deps.homedirFn || homedir)(), '.kodo', 'plans');
  // D-07: ruta CONSTRUIDA (no derivada por regex). D-09: guard de contención si task_id dudoso.
  const path = join(plansDir, `${taskId}.md`);
  try {
    const md = readFileFn(path);
    return { status: 'ok', lines: md.split('\n') };
  } catch (err) {
    const code = err?.code;
    if (code === 'ENOENT') return { status: 'no-light-plan', lines: [] };
    return { status: 'error', lines: [] }; // D-05: EACCES/otros → error
  }
}
```

### Pattern 2: Punto de inserción en readPlan (reemplaza plan.js:69)
**What:** El fallback estrecha el `no-phase`: solo es terminal si NO hay `task_id`.
**Example:**
```javascript
// Source: plan.js:69 (rama actual a reemplazar)
// ANTES:  if (phaseId == null) return { status: 'no-phase', lines: [] };
// DESPUÉS:
if (phaseId == null) {
  // D-02: el fallback de plan ligero solo dispara cuando NO hay fase GSD.
  // D-03/D-06: sin task_id utilizable → no-phase terminal (defensivo).
  const taskId = row?.task_id;
  if (taskId) return readLightPlan(taskId, deps); // D-05 mapping
  return { status: 'no-phase', lines: [] };
}
```

### Pattern 3: Copy constant exportada + rama de render (mata el drift code/render)
**What:** La constante vive en `App.js` (junto a `OVERLAY_PLAN_NO_PHASE/NO_PLAN/ERROR`), `SessionTable.js` la importa.
**Example:**
```javascript
// Source: App.js:110-112 (constantes existentes) + SessionTable.js:34-36 (imports)
// App.js (~línea 113), junto a las otras OVERLAY_PLAN_*:
export const OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet'; // D-04 literal a discreción

// SessionTable.js: añadir al import (línea 34-36) y rama (tras línea 158):
} else if (snap.status === 'no-light-plan') {
  copy = OVERLAY_PLAN_NO_LIGHT; // dim (informativo, no rojo) — DISTINTO de no-phase/no-plan
}
```

### Anti-Patterns to Avoid
- **Importar `src/config.js` para `KODO_DIR`:** viola D-07 y la leaf-isolation (WARNING-01). `config.js` arrastra `loadEnvFile()`. Replicar `homedir()` inline.
- **Reusar `OVERLAY_PLAN_NO_PLAN` para el caso sin plan ligero:** mentiría sobre una sesión quick (D-04). `'phase has no PLAN.md yet'` es GSD-specific.
- **Mapear ENOENT a `error`:** ENOENT (artefacto ausente) es el caso normal "aún no escribió plan" → `no-light-plan` (D-05). Solo no-ENOENT → `error`.
- **Construir la ruta con template `~/...`:** `~` no se expande en strings. Usar `join(homedir(), ...)`.
- **Añadir el check `overlayReqRef` post-await en el handler `p`:** `readPlan` es SÍNCRONO; no hay await window (ver `App.js:486-492`). El handler `p` NO cambia.
- **Compilar `new RegExp` desde `task_id`:** viola anti-ReDoS (D-09). El test `plan.js no compila ningún new RegExp` (test:261-267) lo vigila estructuralmente.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Render del overlay (scroll, snapshot, Esc) | UI nueva para plan ligero | El render `{ status, lines }` existente (`SessionTable.renderOverlay`) | Toda la maquinaria de Phase 44/39 ya existe; el plan ligero entra por el mismo camino. CERO UI nueva salvo la rama de copy. |
| Resolución `~/.kodo` | Parser de `~` | `join(homedir(), '.kodo', 'plans')` | Builtin, normaliza separadores cross-platform, mismo patrón que `config.js` |
| Aislamiento de HOME en tests | mock global de `os.homedir` / env HOME | DI override `deps.kodoPlansDir`/`deps.homedirFn` (D-08) | Mantiene `readPlan` puro; los tests existentes ya usan DI (`deps.readFileFn`) sin tocar disco |
| Lectura de fichero never-throws | try/catch ad-hoc disperso | `deps.readFileFn` envuelto en un try/catch propio del helper (D-09) | Patrón ya establecido en `plan.js:122-131` |

**Key insight:** El 90% de esta fase ya está construido. El valor de la investigación es confirmar **exactamente dónde** se inserta el fallback (plan.js:69) y **qué status nuevo** atraviesa el render. No hay problema "deceptivamente complejo" que resolver — el riesgo es desviarse de los invariantes locked (leaf-isolation, never-throws, anti-ReDoS, honest-copy).

## Runtime State Inventory

> Esta fase es READ-ONLY (solo lee un artefacto que otra fase produce). No renombra, no migra, no escribe estado. La mayoría de categorías son vacías por construcción.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — el overlay solo LEE `~/.kodo/plans/<task_id>.md`; no escribe ni migra datos. Verificado: el handler `p` no llama writeFile. | Ninguna |
| Live service config | None — cero endpoints nuevos (PLAN-04 explícito); el overlay no toca `src/server.js`. Verificado por grep: la lectura es filesystem directo, como el flujo GSD de `plan.js`. | Ninguna |
| OS-registered state | None — no hay tasks, daemons ni procesos registrados. Es código de dashboard TUI en proceso. | Ninguna |
| Secrets/env vars | None — no se leen secretos ni env vars. `homedir()` resuelve `~` vía `os` builtin (no env-dependiente en producción; el override DI es solo para tests). | Ninguna |
| Build artifacts | None — sin compilación; ESM ejecutado directo por Node. No hay egg-info/binarios/imágenes. | Ninguna |

**Dependencia de contrato (no es state, es acoplamiento de ruta):** El productor (Phase 45) escribe en `${KODO_DIR}/plans/${task_id}.md` (`session-start.js:85,145`), donde `KODO_DIR = join(homedir(), '.kodo')`. El consumidor (esta fase) debe leer **exactamente** la misma ruta. **VERIFICAR en planning:** que `join(homedir(), '.kodo', 'plans', \`${task_id}.md\`)` produce la ruta byte-idéntica a la del productor. Riesgo de divergencia: si Phase 45 usó `KODO_DIR` (que respeta `KODO_DIR` env override en config.js) y esta fase usa `homedir()` crudo, podrían divergir bajo un `KODO_DIR` env custom. [ASSUMED: producción usa el default `~/.kodo`; el override DI cubre tests — confirmar si config.js permite override de KODO_DIR vía env].

## Common Pitfalls

### Pitfall 1: Divergencia de ruta productor vs consumidor bajo KODO_DIR override
**What goes wrong:** Phase 45 usa `KODO_DIR` (de `config.js`); D-07 ordena `homedir()` inline. Si `config.js` permite override de `KODO_DIR` vía env var, el productor escribiría en la ruta override y el consumidor leería en `~/.kodo` → siempre `no-light-plan` falso.
**Why it happens:** Dos módulos computan la "misma" ruta por caminos distintos (DRY violado por necesidad de leaf-isolation).
**How to avoid:** Confirmar en planning si `config.js` deriva `KODO_DIR` de un env var (`KODO_HOME`/similar). Si lo hace, el helper debe respetar el mismo override (vía el `deps.kodoPlansDir` y/o leyendo el mismo env). En el default `~/.kodo`, ambos coinciden. **Leer `src/config.js:1-20` durante planning para confirmar.**
**Warning signs:** Un test E2E que escribe con la lógica de Phase 45 y lee con la de Phase 46 daría `no-light-plan` si las rutas divergen.

### Pitfall 2: `task_id` con caracteres de path
**What goes wrong:** Un `task_id` con `/` o `..` haría que `join` escape de `~/.kodo/plans/`.
**Why it happens:** Interpolación directa del input en el nombre de fichero.
**How to avoid:** `task_id` es un **UUID del provider** (`src/session/state.js:15` lo documenta como "UUID del task en el provider activo"; `id = session.task_id` se usa como identidad en `findSession`). Los UUIDs no contienen separadores. **El guard D-09 es barato (`!taskId.includes('/') && !taskId.includes('\\') && !taskId.includes('..')`) y hace literalmente cierta la afirmación "fixed root" del threat model** — recomendado aunque redundante. Si el guard falla → `no-phase` (defensivo, mismo trato que task_id falsy).
**Warning signs:** Un test con `task_id: '../../../etc/passwd'` debe colapsar a `no-phase`/`no-light-plan`, jamás leer fuera de `~/.kodo/plans/`.

### Pitfall 3: Romper los tests de integración existentes del overlay
**What goes wrong:** El test `dashboard-overlay.test.js:499` espera que una fila sin phase_id ni project_path → `OVERLAY_PLAN_NO_PHASE`. Si el fallback dispara para esa fila (porque tiene `task_id` en la fixture), el frame mostraría otra copy.
**Why it happens:** La fixture `planStatus({})` puede o no llevar `task_id`; el cambio de comportamiento del `no-phase` afecta esos tests.
**How to avoid:** Revisar `dashboard-overlay.test.js:499-530` durante planning. La fila de ese test no debe tener `task_id`, o el artefacto no debe existir (→ `no-light-plan`, lo que requiere actualizar el assert). Decidir: ¿la fixture lleva `task_id`? Si sí, el test debe esperar `no-light-plan` (no `no-phase`). **Este es el principal riesgo de regresión.**
**Warning signs:** `node --test test/dashboard-overlay.test.js` falla en el caso no-phase tras el cambio.

### Pitfall 4: Olvidar exportar la constante o el drift code/render
**What goes wrong:** Definir la copy literal en `SessionTable.js` en vez de importarla de `App.js` → drift entre el código y los tests.
**How to avoid:** Patrón Phase 44: la constante se EXPORTA de `App.js:110-112` y `SessionTable.js:34-36` la importa. Los tests importan la misma constante para asertar equality sin duplicar strings.

## Code Examples

### Mapeo de resultados (D-05) — la lógica central del fallback
```javascript
// Source: derivado de plan.js:88-92 (patrón de discriminación ENOENT/EACCES existente)
try {
  const md = readFileFn(path);
  return { status: 'ok', lines: md.split('\n') };  // contenido → ok, render plano
} catch (err) {
  const code = err?.code;
  if (code === 'ENOENT') return { status: 'no-light-plan', lines: [] }; // ausente
  return { status: 'error', lines: [] };  // EACCES/otros → error (reusa OVERLAY_PLAN_ERROR)
}
```

### Test con DI HOME isolation (D-08) — patrón para los 4 casos
```javascript
// Source: derivado de dashboard-plan.test.js:34-52 (makeFs DI pattern)
it('task_id + artefacto presente → ok con contenido', () => {
  const plansDir = '/fake/.kodo/plans';
  const deps = {
    kodoPlansDir: plansDir,                              // D-08 override
    readFileFn: (p) => {
      if (p === `${plansDir}/abc-123.md`) return 'mi plan ligero\npaso 1';
      const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e;
    },
  };
  const res = readPlan({ task_id: 'abc-123' }, deps);    // sin phase_id → fallback
  assert.equal(res.status, 'ok');
  assert.ok(res.lines.includes('mi plan ligero'));
});

it('task_id + artefacto ausente (ENOENT) → no-light-plan', () => {
  const deps = {
    kodoPlansDir: '/fake/.kodo/plans',
    readFileFn: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
  };
  const res = readPlan({ task_id: 'missing' }, deps);
  assert.equal(res.status, 'no-light-plan');
});

it('task_id + artefacto ilegible (EACCES) → error', () => {
  const deps = {
    kodoPlansDir: '/fake/.kodo/plans',
    readFileFn: () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; },
  };
  const res = readPlan({ task_id: 'locked' }, deps);
  assert.equal(res.status, 'error');
});

it('sin phase_id Y sin task_id → no-phase (D-06 terminal)', () => {
  const res = readPlan({}, { kodoPlansDir: '/fake/.kodo/plans' });
  assert.equal(res.status, 'no-phase');
});

it('readFileFn que lanza NO propaga (never-throws, D-09)', () => {
  const deps = { kodoPlansDir: '/fake', readFileFn: () => { throw new Error('boom'); } };
  let res;
  assert.doesNotThrow(() => { res = readPlan({ task_id: 'x' }, deps); });
  assert.equal(res.status, 'error'); // boom sin .code → no-ENOENT → error
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Olfatear el plan nativo de Claude Code vía hooks (spike) | kodo produce el artefacto activamente (`session-start.js` inyecta instrucción; sesión escribe `~/.kodo/plans/<task_id>.md`) | 2026-06-09 (Phase 45 decisión) | El overlay lee un artefacto kodo-controlado estable, no rutas internas no documentadas |

**Deprecated/outdated:**
- Captura del plan vía hooks no documentados de Claude Code: descartado (frágil/version-specific). Docs del spike preservados en git (`350c43d`/`3750171`).
- `~/.claude/plans/` / transcript JSONL / `TodoWrite`: NO se usan (formato no documentado; `TodoWrite` deprecado).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Producción usa el default `~/.kodo` y `config.js` no aplica un `KODO_DIR` env override que divergiría del `homedir()` inline | Runtime State Inventory / Pitfall 1 | Si `config.js` deriva `KODO_DIR` de un env var, productor y consumidor leerían rutas distintas → `no-light-plan` falso permanente. **Mitigación: leer `src/config.js:1-20` en planning.** |
| A2 | `task_id` es un UUID del provider sin separadores de path | Pitfall 2 / D-09 | Si algún provider genera `task_id` con `/`, sin el guard de contención se podría leer fuera de `~/.kodo/plans/`. Mitigación: el guard D-09 (barato) elimina el riesgo. |

## Open Questions

1. **¿`config.js` permite override de `KODO_DIR` vía env var?**
   - What we know: `config.js:6` define `KODO_DIR = join(homedir(), '.kodo')`. Phase 45 escribe con `KODO_DIR`. D-07 ordena `homedir()` inline en `plan.js` (NO importar config.js).
   - What's unclear: si `KODO_DIR` se recalcula desde un env var en algún punto (vi `loadEnvFile()` en config.js:11). Las líneas 1-20 que leí muestran `KODO_DIR` como const directa de `homedir()`, sin env override aparente — pero conviene confirmar el módulo completo.
   - Recommendation: leer `src/config.js` completo en planning. Si NO hay env override de KODO_DIR (lo más probable por lo visto), `homedir()` inline == `KODO_DIR` y no hay divergencia. Si lo hay, el helper debe respetarlo.

2. **¿La fixture del test `no-phase` en `dashboard-overlay.test.js:499` lleva `task_id`?**
   - What we know: ese test espera `OVERLAY_PLAN_NO_PHASE` para una fila sin phase_id/project_path.
   - What's unclear: si la fila de la fixture tiene `task_id` (lo que activaría el fallback y cambiaría la copy esperada).
   - Recommendation: el planner debe inspeccionar la fixture y actualizar el assert si procede (esperar `no-light-plan` cuando hay task_id pero no artefacto, o quitar `task_id` para preservar el caso `no-phase` puro). Mantener AMBOS casos cubiertos.

## Environment Availability

> Esta fase es código/tests puros sin dependencias externas (sin servicios, sin CLIs, sin red). Node builtins disponibles por construcción. **Step 2.6: SKIPPED salvo el runtime de Node.**

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (con `--test`) | test runner + ESM | ✓ | (runtime del proyecto) | — |
| `ink-testing-library` | tests de integración del overlay (opcional) | ✓ | devDep instalado | tests de unidad puros (sin Ink) cubren la lógica |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** Ninguna.

## Validation Architecture

> nyquist_validation está habilitado (`config.json` workflow.nyquist_validation: true). Sección incluida.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (builtins) |
| Config file | none — `package.json` test script: `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/dashboard-plan.test.js` |
| Full suite command | `node --test $(find test -name '*.test.js' -type f)` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-04 | task_id + artefacto con contenido → `ok` (render plano de líneas) | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender) |
| PLAN-04 | task_id + artefacto ausente (ENOENT) → `no-light-plan` | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender) |
| PLAN-04 | task_id + artefacto ilegible (EACCES/no-ENOENT) → `error` | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender) |
| PLAN-04 | sin phase_id Y sin task_id → `no-phase` (D-06 terminal) | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender) |
| PLAN-04 | `readFileFn` que lanza NO propaga (never-throws, D-09) | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender) |
| PLAN-04 | guard de contención: `task_id` con `/`/`..` → no lee fuera de plans dir | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (extender, si guard adoptado) |
| PLAN-04 | GSD con phase_id+PLAN.md sigue → `ok` (no regresión) | unit (DI) | `node --test test/dashboard-plan.test.js` | ✅ (existente, debe seguir verde) |
| PLAN-04 | `plan.js` no compila `new RegExp` (anti-ReDoS estructural) | unit | `node --test test/dashboard-plan.test.js` | ✅ (existente, test:261-267) |
| PLAN-04 | overlay `p` muestra el plan ligero y la copy nueva (frame) | integration (Ink) | `node --test test/dashboard-overlay.test.js` | ⚠️ revisar fixtures (Pitfall 3) |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard-plan.test.js`
- **Per wave merge:** `node --test test/dashboard-plan.test.js test/dashboard-overlay.test.js`
- **Phase gate:** Full suite verde antes de `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extender `test/dashboard-plan.test.js` con un `describe('readPlan — fallback plan ligero (D-05/D-08/D-09)')` (5-6 casos arriba). El patrón DI (`makeFs`/`deps.readFileFn`) y el aislamiento ya existen — solo falta el override `kodoPlansDir`/`homedirFn`.
- [ ] Revisar/ajustar las fixtures de `test/dashboard-overlay.test.js:499-530` (Pitfall 3) — posible cambio de assert de `no-phase` a `no-light-plan` según lleve `task_id`.
- [ ] (Si se adopta el guard D-09) un test de contención con `task_id` malicioso.
- Framework install: ninguno — `node:test` es builtin, baseline verde confirmado (Phase 44/45).

## Security Domain

> security_enforcement no está explícitamente en config.json → tratado como habilitado. Superficie de ataque mínima (read-only, filesystem local, sin red/endpoints).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Sin auth; dashboard local |
| V3 Session Management | no | Sin sesiones web |
| V4 Access Control | no | Lectura de filesystem local del operador |
| V5 Input Validation | yes | `task_id` interpolado en path → guard de contención `String.includes` (D-09, anti path-traversal). NO `new RegExp` (anti-ReDoS) |
| V6 Cryptography | no | Sin crypto |
| V12 File & Resources | yes | Path traversal: el `task_id` se contiene a `~/.kodo/plans/` (fixed root). never-throws en lectura (no DoS por fichero ilegible) |

### Known Threat Patterns for {Node TUI filesystem reader}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal vía `task_id` con `/` o `..` | Tampering / Information Disclosure | Guard de contención `String.includes` (D-09, estilo WR-01); `task_id` es UUID por construcción. Falla → no-phase, no lectura fuera del fixed root |
| ReDoS por matching de input con regex | Denial of Service | Cero `new RegExp` derivado de input (D-09); la ruta se CONSTRUYE, no se matchea. Vigilado por test estructural (test:261-267) |
| Crash del panel por fichero ilegible | Denial of Service | never-throws: todo `readFile` envuelto; error degrada a status `error`/`no-light-plan`, jamás propaga a React (D-09, herencia Phase 44 D-05) |
| Fuga de contenido de otra sesión | Information Disclosure | Correlación exacta por `task_id` (1 fichero por task); el operador ya tiene acceso al filesystem local. Sin amplificación |

**Nota threat model:** Phase 44 cerró una vulnerabilidad de path traversal (observación 23075/23076, "Hardened plan-file path containment"). El mismo patrón de contención WR-01 (`String.includes`, no RegExp) aplica aquí al `task_id`. Reusar la lección.

## Sources

### Primary (HIGH confidence)
- `src/cli/dashboard/plan.js` (líneas 1-134) — contrato `readPlan`, punto de inserción (línea 69), invariantes (never-throws, anti-ReDoS, leaf-isolation), patrón DI de deps
- `src/cli/dashboard/App.js` (líneas 100-128, 405-502) — copy constants `OVERLAY_PLAN_*` (110-112), handler `p` (482-502, síncrono), `row.task_id` (414)
- `src/cli/dashboard/SessionTable.js` (líneas 34-36, 130-181) — render del overlay, status→copy mapping, imports de constantes
- `src/hooks/session-start.js` (líneas 75-86, 145) — productor: `join(KODO_DIR, 'plans', \`${session.task_id}.md\`)`, ES (85) + EN (145)
- `src/config.js` (líneas 1-12) — convención `KODO_DIR = join(homedir(), '.kodo')` a replicar
- `src/session/state.js` (línea 15) — `task_id` documentado como "UUID del task en el provider activo"
- `test/dashboard-plan.test.js` (líneas 1-269) — patrón DI (`makeFs`), naming, estructura de describe blocks a espejar
- `test/dashboard-overlay.test.js` (líneas 433-530) — tests de integración del overlay `p` (Ink), fixtures `planStatus`
- `.planning/REQUIREMENTS.md` (líneas 11-17, 63-70) — PLAN-04 y preámbulo "Plan Overlay"
- `.planning/ROADMAP.md` (líneas 24, 59-69) — Phase 46 goal + Phase 45 contrato del productor
- `.planning/phases/45-*/45-RESEARCH.md` — confirma ruta, correlación por task_id, markdown sin frontmatter
- `.planning/phases/46-*/46-CONTEXT.md` — decisiones locked D-01..D-09

### Secondary (MEDIUM confidence)
- Memoria de sesión 23075/23076 (Phase 44 path containment hardening) — precedente del guard de contención
- Memoria 23172/23179/23182 (Phase 45 PLAN-03 shipped 2026-06-10, 58 tests) — el productor está vivo y verificado

### Tertiary (LOW confidence)
- Ninguna. Toda la investigación se basó en lectura directa del código y los docs de planning del propio repo.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — solo builtins de Node ya en uso; verificado por grep
- Architecture: HIGH — el punto de inserción (plan.js:69), el contrato `{ status, lines }` y el render están leídos directamente del código
- Pitfalls: HIGH para path/never-throws/copy-drift (verificados en código); MEDIUM para la divergencia KODO_DIR (A1, requiere confirmar config.js completo)

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (estable — fase de edición interna sin dependencias externas que cambien)
