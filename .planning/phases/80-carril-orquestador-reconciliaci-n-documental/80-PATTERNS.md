# Phase 80: Carril orquestador + reconciliación documental - Mapa de Patrones

**Mapeado:** 2026-07-23
**Ficheros analizados:** 6 (2 código, 2 test, 2 docs)
**Analogías encontradas:** 6 / 6

> Fase de **integración pura**: cero ficheros nuevos, cero deps. Todo el trabajo
> modifica ficheros existentes copiando patrones que ya viven en el mismo fichero
> o en su gemelo CLI. Las analogías son excepcionalmente fuertes (mismo fichero /
> mismo motor).

## Clasificación de ficheros

| Fichero (modificado) | Rol | Data Flow | Analogía más cercana | Calidad |
|----------------------|-----|-----------|----------------------|---------|
| `src/check.js` (`runCheckAndAct`) | vigilante / orquestación de carril | event-driven (gate → efecto) | mismo fichero: catch de `launchOrchestrator` + DI de `checkPendingTasks` | exacta (in-file) |
| `src/cmux/sidebar-doctor.js` | motor (consumido, NO modificado) | transform / batch | — (import directo, tal cual) | consumo directo |
| `src/logger-events.js:21` (comentario stale) | comentario de código | — | edición quirúrgica de una línea | trivial |
| `test/check.test.js` | test unit (DI) | — | tests existentes de `checkPendingTasks` (fakes + DI por params) | exacta (in-file) |
| `test/check-isolation.test.js` | test source / import-graph | — | guard de convergencia ORCH-05 (pending.js) + guards de prohibición | exacta (in-file) |
| `.claude/skills/kodo-orchestrate/skill.md` | doc canónico | — | §Diagnóstico (flujos síntoma→comando) + precedente HYG-08 | exacta (in-file) |
| `src/orchestrator/prompt.md` | doc fallback degradado | — | §Loop de supervisión (pasos numerados) | exacta (in-file) |
| `src/cli/sidebar-doctor.js` (`runSidebarDoctor`) | referencia de semántica (NO modificado) | — | secuencia scan→execute a replicar in-process | referencia |

## Asignaciones de patrones

### `src/check.js` — `runCheckAndAct()` (vigilante, event-driven)

**Analogía primaria:** el propio `runCheckAndAct` (catch de `launchOrchestrator`) y `checkPendingTasks` (DI), ambos en el mismo fichero.

**Imports actuales** (`src/check.js:9-15`) — el doctor se añade con el **mismo estilo de import directo** que `launchOrchestrator` y `fetchFreshPending`:
```javascript
import { launchOrchestrator } from './orchestrator/launch.js';
import { createFormatter } from './cli/format.js';
import { fetchFreshPending } from './tasks/pending.js';
// AÑADIR (mismo estilo, import directo del motor Phase 79):
// import { scan, execute } from './cmux/sidebar-doctor.js';
```
> LOG-12 CRÍTICO: importar SOLO `scan`/`execute`. NUNCA `logger.js`. El grafo de
> `sidebar-doctor.js` (18 ficheros) está verificado limpio; llamar con `deps`
> **sin** `logger` → `noopLogger` por defecto.

**Patrón de gate + fail-open** (estructura ACTUAL a extender, `src/check.js:119-131`) — el bloque doctor se inserta **dentro** del `if (result.needsOrchestrator)`, **antes** de `launchOrchestrator()`, con su try/catch propio espejo del existente:
```javascript
export async function runCheckAndAct() {
  const result = await runCheck();
  console.log(result.summary);

  if (result.needsOrchestrator) {
    // ◄── D-05: bloque doctor AQUÍ (antes del launch), con try/catch propio:
    // try {
    //   const report = await scanFn();               // read-only, para advisories D-08
    //   const r = await executeFn({}, { fix: true }); // loose→add, empty→ungroup D-07
    //   // D-06: `[kodo:check] Sidebar: N acción(es) aplicadas`
    //   // D-08: `[kodo:check] Sidebar advisories: N (acción de operador)`
    // } catch (err) {
    //   console.error(`[kodo:check] Sidebar doctor error: ${err.message}`);
    // }
    console.log(`[kodo:check] Launching orchestrator: ${result.reasons.join('; ')}`);
    try {
      await launchOrchestrator();
    } catch (err) {                                     // ← ESPEJO EXACTO del fail-open
      console.error(`[kodo:check] Error launching orchestrator: ${err.message}`);
    }
  }
}
```

**Patrón DI a espejar** (`src/check.js:30`) — `checkPendingTasks` ya inyecta deps con defaults de producción; `runCheckAndAct` debe adoptar el mismo estilo (params opcionales, `await runCheckAndAct()` sin args sigue funcionando para `src/cli.js:141`):
```javascript
export async function checkPendingTasks({ config, runningCount, getProviderFn, formatterFn }) {
  const fmt = (formatterFn || (() => createFormatter(process.stdout)))();
  // ...defaults de producción resueltos lazy...
}
// Firma recomendada (Pattern 3 RESEARCH):
// runCheckAndAct({ runCheckFn = runCheck, scanFn = scan, executeFn = execute,
//                  launchFn = launchOrchestrator } = {})
```

**Patrón de línea de log** (`src/check.js:44-47`) — prefijo `[kodo:check]` + color vía `createFormatter` (nunca ANSI inline; check-isolation prohíbe `\x1b[` en check.js):
```javascript
lines.push(
  `[kodo:check] ${fmt.yellow(`${pending.length} pending kodo task(s), ${available} slot(s) available`)}`,
);
```

---

### Consumo del motor — `src/cmux/sidebar-doctor.js` (NO modificar)

**Analogía de secuencia:** `runSidebarDoctor` en `src/cli/sidebar-doctor.js:61-92` — el carril replica el **mismo orden scan→execute in-process** (NO shellea):
```javascript
// src/cli/sidebar-doctor.js:70-81 — semántica a replicar (sin --json, fix SIEMPRE true):
const report = await scanFn(deps);          // 1. SIEMPRE scan primero
const exitCode = report.hasActions ? 1 : 0; // (el carril NO usa exit code; usa contadores)
let result = null;
if (opts.fix) {
  result = await executeFn(deps, { fix: true }); // 2. execute SIEMPRE después de scan
}
```

**Contrato de deps (defaults de producción)** — `resolveDeps` (`src/cmux/sidebar-doctor.js:90-108`): pasar `deps = {}` (o nada) resuelve TODOS los defaults reales, incl. `logger = noopLogger`. **NO** pasar un `logger` real:
```javascript
function resolveDeps(deps = {}) {
  return {
    loadState: deps.loadState || loadState,
    // ...passthroughs cmux, allowlist no-destructivo...
    now: deps.now || (() => Date.now()),
    logger: deps.logger || noopLogger,   // ◄── LOG-12: omitir deps.logger en el carril
  };
}
```

**Contrato de report/result** (`SidebarReport` `:64-71`, `SidebarResult`) — lo que el carril lee para sus líneas:
```javascript
// report:  { missing_group[], loose_workspace[], empty_group[], protected{sessions[]},
//            hasActions: (loose+empty)>0, hasAdvisories: missing_group>0 }
// result:  { created: 0 /*siempre 0*/, added: N, ungrouped: M, errors: [{category,target,reason}] }
// D-06 → result.added + result.ungrouped ; D-08 → report.hasAdvisories, report.missing_group.length
```

---

### `src/logger-events.js:21` — comentario stale (edición quirúrgica)

Tras Phase 80, `check.js → sidebar-doctor.js → logger-events.js`, así que el grafo
de check SÍ alcanza este módulo. Ningún test rompe (es transformación pura,
whitelisted), pero el comentario que afirma «ningún consumer en el grafo de
check.js importa este módulo» queda FALSO. Actualizarlo a: «alcanzable vía
sidebar-doctor tras Phase 80, pero sigue siendo transformación pura
zero-side-effect». Cambio de una línea, no tocar la lógica.

---

## Asignaciones de patrones — Tests

### `test/check.test.js` — batería del piggyback (unit, DI)

**Analogía:** los tests existentes de `checkPendingTasks` (`test/check.test.js:36-70`) — fakes construidos localmente + inyección por params + assertions sobre `lines`/`reasons`:
```javascript
// Patrón fake + DI a espejar (test/check.test.js:17-49):
function createFakeProvider(overrides = {}) { /* todos los métodos, uno override */ }
const result = await checkPendingTasks({
  config: BASE_CONFIG, runningCount: 1, getProviderFn: () => provider,
});
assert.match(result.lines.join('\n'), /2 pending/);
```
**Nuevos tests (misma forma, inyectando `scanFn`/`executeFn`/`launchFn` stubs):**
- Gate ON: `needsOrchestrator:true` → `executeFn({fix:true})` llamado ANTES de `launchFn` (espía de orden).
- Gate OFF (D-03): `needsOrchestrator:false` → ni `scanFn` ni `executeFn` corren.
- Invariante D-04: un `scanFn` con drift + `runCheckFn` limpio → ni doctor ni launch; el result nunca entra a `reasons`.
- Fail-open D-05: `executeFn`/`scanFn` que `throw` → `launchFn` igual corre, el check no aborta.

### `test/check-isolation.test.js` — LOG-12 + convergencia (source/import-graph)

**Analogía:** el guard de convergencia ORCH-05 (`:211-219`, positivo) + los guards de prohibición (`:75-147`, negativos). Añadir el par simétrico para sidebar-doctor:
```javascript
// Positivo (convergencia, espejo de :211-219):
it('kodo check reaches src/cmux/sidebar-doctor.js in its import graph', () => {
  const graph = walkImports(join(SRC, 'check.js'));
  assert.ok(graph.has(join(SRC, 'cmux', 'sidebar-doctor.js')));
});
// Negativo: los 4 guards existentes (:79, :113, :123, :139) deben SEGUIR verdes
// (logger.js / github/provider / github/normalize / triggers/polling) con
// sidebar-doctor ya en el grafo.
```

---

## Asignaciones de patrones — Documentación (ORCH-08)

### `.claude/skills/kodo-orchestrate/skill.md` — canónico (detalle, D-09)

**Analogía estructural:** §Diagnóstico (`:282-327`) usa el patrón «síntoma → secuencia numerada de comandos». El nuevo **flujo 5** («sidebar desalineado → `kodo sidebar doctor` dry-run → interpretar acciones/advisories») copia esa forma:
```markdown
### 4. Phase terminó y entró a Review   ← existente (:321)
### 5. Sidebar desalineado (grupos vacíos / workspaces sueltos)   ← NUEVO
1. `kodo sidebar doctor` (dry-run) para diagnosticar sin mutar.
2. Interpretar: acciones auto-arreglables (loose→add, empty→ungroup) vs
   advisories (missing_group = acción del operador; kodo no ancla en sesión viva).
3. El carril automático de `kodo check` ya converge las acciones en pases
   motivados — el dry-run es sólo diagnóstico.
```
Más un **§ nuevo de higiene del sidebar** (carril automático en `kodo check`,
dry-run como herramienta, advisories = operador, allowlist no destructivo, launch
path intacto) y las 4 features v0.17 (D-10) con detalle.

**Precedente anti-deriva:** HYG-08 (v0.16 Phase 72, README) — auditoría manual
features↔docs bidireccional. Reflejar en `## Cómo actualizar este skill` (`:328`).

### `src/orchestrator/prompt.md` — fallback degradado (conciso, D-09)

**Analogía estructural:** §Loop de supervisión (`:11-21`) = pasos numerados. Añadir
**una línea** al loop + referencia a la skill (preservar el rol reducido):
```markdown
## Loop de supervisión                    ← existente (:11)
5. Revisar tareas en Review (ver §"Sesiones GSD"...).
6. Lanzar nuevas tareas si hay slots libres (...).
# ← AÑADIR mención concisa: el sidebar lo mantiene `kodo check` (carril automático);
#   para diagnóstico bajo demanda `kodo sidebar doctor` (dry-run). Detalle en la skill.
```

**D-12 — NO TOCAR:** el bloque `<!-- BEGIN reporting -->` / `<!-- END reporting -->`
(`:47-116`) ni los placeholders `{{provider}}` / `{{provider_name}}` / `{{mcp_tool}}`
(consumidos por `resolvePromptTemplate` / `applyReportingGate`). Las ediciones van
FUERA de ese bloque.

---

## Patrones compartidos (cross-cutting)

### Fail-open per lane
**Fuente:** `src/check.js:125-129` (catch de `launchOrchestrator`).
**Aplicar a:** el bloque doctor nuevo en `runCheckAndAct`.
```javascript
try { await launchOrchestrator(); }
catch (err) { console.error(`[kodo:check] Error launching orchestrator: ${err.message}`); }
```
Misma forma exacta: `console.error('[kodo:check] Sidebar doctor error: ...')`. Nunca al NDJSON (LOG-12).

### DI opcional con defaults de producción
**Fuente:** `src/check.js:30` (`checkPendingTasks`) y `src/cli/sidebar-doctor.js:62-66` (`runSidebarDoctor`).
**Aplicar a:** `runCheckAndAct` (para testear el piggyback sin cmux/estado reales).
```javascript
const scanFn = deps.scanFn || realScan;
const executeFn = deps.executeFn || realExecute;
```

### Color isolation
**Fuente:** `src/cli/format.js` `createFormatter`, ya usado en `check.js:67` y `:31`.
**Aplicar a:** todas las líneas `[kodo:check] Sidebar ...` nuevas. Cero ANSI inline (guard en check-isolation).

### Disciplina anti-deriva HYG-08 (checklist manual)
**Fuente:** precedente v0.16 Phase 72 (README).
**Aplicar a:** skill.md + prompt.md — auditoría bidireccional features↔docs en VERIFICATION (D-11), NO test automático.

## Sin analogía

Ninguna. Todos los ficheros modificados tienen analogía in-file o en su gemelo CLI.
Los deprecated a NO reintroducir en la doc (RESEARCH §State of the Art): nudge de
refresh (borrado Phase 73), `missing_group` como acción ejecutable (ahora advisory),
doc web cmux de disolución de grupos.

## Metadata

**Scope de búsqueda:** `src/check.js`, `src/cmux/sidebar-doctor.js`, `src/cli/sidebar-doctor.js`, `src/logger-events.js`, `test/check*.test.js`, `.claude/skills/kodo-orchestrate/skill.md`, `src/orchestrator/prompt.md`.
**Ficheros escaneados:** 7.
**Fecha de extracción:** 2026-07-23.
</content>
</invoke>
