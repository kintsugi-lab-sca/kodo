# Phase 80: Carril orquestador + reconciliación documental - Research

**Researched:** 2026-07-23
**Domain:** Integración in-process de un motor determinista (sidebar doctor) en el carril `kodo check` + reconciliación documental (skill + prompt del orquestador)
**Confidence:** HIGH (todo el objetivo es integración de código ya presente en el repo — verificado por lectura directa de fuente; nada depende de dependencias externas ni de conocimiento de entrenamiento)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Punto de invocación del piggyback**
- **D-01:** El carril fix vive en `runCheckAndAct()` (`src/check.js`), **in-process** vía import directo de `scan`/`execute` (`src/cmux/sidebar-doctor.js`) — no un subproceso `kodo sidebar doctor --fix`. Cumple ORCH-07 ejecutando el mismo carril que el CLI, con determinismo garantizado (0 tokens), sin dependencia de PATH/argv, y espejo del patrón existente (check.js ya importa `launchOrchestrator` directamente).
- **D-02:** Alternativas descartadas: (a) instruir al LLM a shellear el fix cada ronda — no determinista, gasta tokens, incumple «converge en ≤1 pase» verificable; (b) dentro de `launchOrchestrator()` — se llama también desde `kodo orchestrate` manual y tiene early-return "already exists". `kodo orchestrate` manual NO ejecuta el doctor (el carril es exclusivo de `kodo check`).

**Gating, orden y fallo dentro del pase**
- **D-03:** Gate estricto: el doctor corre **solo** cuando `needsOrchestrator === true`. Un check «All clear» no lo ejecuta.
- **D-04:** El resultado del doctor **jamás** se añade a `reasons` ni influye en `needsOrchestrator` — invariante «sidebar NO es trigger», verificable por test.
- **D-05:** Orden: doctor **antes** de `launchOrchestrator()`. Fail-open total: try/catch propio; un error del doctor loguea una línea (`[kodo:check] Sidebar doctor error: <msg>`) y nunca bloquea check ni launch (espejo del catch existente de `launchOrchestrator`).
- **D-06:** Salida stdout: línea(s) resumen deterministas con acciones aplicadas (p. ej. `[kodo:check] Sidebar: N acción(es) aplicadas`); formato exacto a discreción, coherente con `[kodo:check]` y `createFormatter`.

**Advisories (missing_group)**
- **D-07:** El carril fix solo converge lo auto-arreglable per 79-04: `loose_workspace` → `add`, `empty_group` → `ungroup`. `missing_group` es advisory report-only — el carril **no crea ni ancla grupos**.
- **D-08:** Si `hasAdvisories`, el check emite una línea informativa (`[kodo:check] Sidebar advisories: N (acción de operador)`) sin convertirla en reason. Descartado inyectar advisories en el `contextSummary` del launch.

**Reconciliación documental**
- **D-09:** Reparto asimétrico: la **skill** (canónica) recibe el detalle — nuevo § de higiene del sidebar + un flujo 5 en §Diagnóstico. El **prompt.md** (fallback degradado) recibe menciones concisas: una línea en el loop de supervisión + referencia a la skill.
- **D-10:** Features v0.17 a reflejar en ambos docs con su profundidad: handoff acumulativo + `NEXT:` en `state.tasks` (74), superficie `NEXT:` dashboard/nudge (75), `pending_stale`/`pending_fetched_at` + convergencia (76), agrupación `--group` (77).
- **D-11:** Disciplina anti-deriva (criterio 4): auditoría cruzada features↔docs en ambos sentidos como **checklist manual** en el plan/VERIFICATION (precedente HYG-08) — no un test automático de docs. Cambios quirúrgicos.
- **D-12:** El bloque `<!-- BEGIN/END reporting -->` de prompt.md y `applyReportingGate` no se tocan — placeholders de `resolvePromptTemplate` intactos.

### Claude's Discretion
Formato exacto de las líneas de log del check, eventos nuevos en `logger-events.js` si aplican (taxonomía existente), DI para testear `runCheckAndAct` (hoy sin DI — espejo de `checkPendingTasks` si hace falta), estructura de tests, y redacción exacta de las secciones nuevas de skill/prompt.

### Deferred Ideas (OUT OF SCOPE)
Ninguna — la discusión se mantuvo dentro del scope de fase. FUT-02 (`kodo doctor --fix` asistido config↔projects) y FUT-03 (puerta LLM) ya trazados en REQUIREMENTS §Future. **Fuera de la fase:** cambios al motor del doctor (Phase 79), saneo de deuda v0.17 (Phase 81, DEBT-01..04), sidebar como trigger, `workspace-group delete` (NI SE CABLEA), triggers/endpoints nuevos.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-07 | Con el orquestador activo, un sidebar con grupos faltantes o workspaces sueltos converge al estado agrupado en ≤1 pase sin intervención humana — piggyback de `kodo sidebar doctor --fix` en pases ya motivados por `kodo check` (el sidebar NO es trigger). | Punto de inserción verificado (`runCheckAndAct`, `src/check.js:119`); `scan`/`execute` in-process listos para consumir con defaults de producción; gate `needsOrchestrator` ya calculado por `runCheck()`; patrón fail-open del catch de `launchOrchestrator` como espejo exacto. Ver §Architecture Patterns Pattern 1 y §Code Examples. |
| ORCH-08 | El skill `kodo-orchestrate` y `src/orchestrator/prompt.md` mencionan el sidebar doctor y reflejan las features v0.17 (handoff + `NEXT:`, dashboard/nudge, `pending_stale`/`pending_fetched_at`, `--group`) — sin prometer features borradas ni omitir las nuevas (disciplina HYG-08). | Inventario completo del contenido actual de ambos docs vs. realidad v0.17 (ver §Reconciliación Documental — Gap Inventory); mecanismo `syncSkill` auto-propaga la skill; `applyReportingGate`/`resolvePromptTemplate` a preservar (D-12). |
</phase_requirements>

## Summary

Esta fase es **integración pura de piezas ya presentes en el repo** — no introduce dependencias, endpoints ni conceptos nuevos. El motor `scan`/`execute` del sidebar doctor (`src/cmux/sidebar-doctor.js`, Phase 79) está terminado, es never-throws, determinista (0 tokens) y expone exactamente el contrato que el carril necesita. El único cambio de código vive en **una función**: `runCheckAndAct()` (`src/check.js:119`). Se inserta, entre el gate `if (result.needsOrchestrator)` y la llamada `await launchOrchestrator()`, un bloque que llama `scan()` (para la línea de advisories) y `execute(deps, {fix:true})` (para converger loose→add / empty→ungroup), envuelto en su propio try/catch fail-open que espeja el catch ya existente de `launchOrchestrator`.

El hallazgo **crítico habilitante** (VERIFIED por walker de import-graph ejecutado en esta sesión): importar `scan`/`execute` desde `src/cmux/sidebar-doctor.js` **NO rompe LOG-12**. El grafo transitivo de `sidebar-doctor.js` (18 ficheros) no contiene `src/logger.js` ni `github/provider.js`/`github/normalize.js`/`triggers/polling.js` — los cuatro módulos que `test/check-isolation.test.js` prohíbe en el grafo de `kodo check`. El motor usa `noopLogger` (zero-import whitelisted) por defecto y `logger-events.js` es transformación pura (solo `node:os`+`node:path`). **Consecuencia LOCKED para el plan:** el carril de check debe llamar al doctor con `deps` que **NO inyecte un logger real** — el default `noopLogger` es obligatorio; inyectar `logger.js` reintroduciría el módulo prohibido al grafo del vigilante.

La reconciliación documental (ORCH-08) es una pasada anti-deriva estilo HYG-08: la skill (`.claude/skills/kodo-orchestrate/skill.md`, canónica) gana el detalle de higiene del sidebar y las cuatro features v0.17 ausentes; el `prompt.md` (fallback degradado) gana menciones concisas preservando su rol reducido y su bloque `reporting` gated intacto (D-12). Es edición quirúrgica verificada contra un inventario de gaps concreto (ver §Reconciliación Documental).

**Primary recommendation:** Un plan de 2 waves — Wave 1 el carril de código (`runCheckAndAct` + DI + tests: gate, invariante never-adds-to-reasons, fail-open, isolation LOG-12); Wave 2 la reconciliación documental (skill + prompt + checklist manual anti-deriva en VERIFICATION). Ambas son ortogonales en ficheros y podrían paralelizarse, pero el carril es el corazón de ORCH-07 y debe ir primero conceptualmente.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Disparo del piggyback del doctor | CLI / vigilante determinista (`src/check.js` `runCheckAndAct`) | — | `kodo check` es el único carril motivado (stuck/review/pending). El carril es 0-token, no-LLM: pertenece al vigilante, no al orquestador LLM. |
| Detección + convergencia del sidebar | Motor puro cmux (`src/cmux/sidebar-doctor.js`) | Host/cmux (`src/cmux/client.js` execFile) | Ya entregado por Phase 79. El carril lo CONSUME tal cual; no toca su lógica. |
| Gate «sidebar NO es trigger» | Vigilante (`runCheck()` calcula `needsOrchestrator`; `runCheckAndAct()` gatea) | — | El resultado del doctor jamás re-entra a `reasons`/`needsOrchestrator` (D-04). |
| Documentación del comportamiento del orquestador | Skill canónica (`.claude/skills/kodo-orchestrate/skill.md`) | Prompt fallback degradado (`src/orchestrator/prompt.md`) | Jerarquía existente y declarada: la skill manda; el prompt es fallback provider-templated cuando `cwd ≠ repo`. La reconciliación preserva esa asimetría (D-09). |
| Propagación de la skill editada a `~/.claude/skills/` | `syncSkill` en `launchOrchestrator` (mecanismo existente) | — | Auto-sync fail-open al próximo launch; el plan NO añade paso manual de copia. |

## Standard Stack

No aplica un "stack" de librerías nuevas — **cero dependencias npm nuevas** (constraint LOCKED v0.18). Todo el trabajo usa módulos internos ya presentes:

### Core (módulos internos consumidos)
| Módulo | Símbolos | Propósito | Por qué es el estándar del repo |
|--------|----------|-----------|---------------------------------|
| `src/cmux/sidebar-doctor.js` | `scan(deps)`, `execute(deps, opts)` | Motor determinista detección+convergencia del sidebar | Entregado por Phase 79; never-throws, 0-token, DI. El carril lo importa directo (espejo de `launchOrchestrator`). |
| `src/check.js` | `runCheckAndAct()`, `runCheck()`, `checkPendingTasks()` | Vigilante; punto único de inserción | `runCheckAndAct` ya orquesta el gate + launch; el piggyback vive aquí. |
| `src/cli/format.js` | `createFormatter` | Color isolation para las líneas nuevas del check | Constraint de color isolation (picocolors solo desde format.js). check.js ya lo usa. |
| `src/logger-noop.js` | `noopLogger` | Logger por defecto del doctor en el carril de check | Zero-import whitelisted — preserva LOG-12. **Obligatorio** en el carril (no inyectar `logger.js`). |

### Supporting (referencia, no se importan en el carril)
| Módulo | Símbolos | Cuándo mirarlo |
|--------|----------|----------------|
| `src/cli/sidebar-doctor.js` | `runSidebarDoctor(opts, deps)` | Referencia de semántica: cómo el CLI encadena `scan()` → `execute(deps,{fix:true})`. El carril replica el mismo orden **in-process** (NO shellea). |
| `src/orchestrator/launch.js` | `resolvePromptTemplate`, `applyReportingGate`, `syncSkill` (vía import) | Verificar que las ediciones de `prompt.md` no rompen placeholders ni el bloque reporting (D-12). |
| `src/logger-events.js` | `sidebarDoctorScan/Fix/FixError` | Taxonomía existente. **No hacen falta eventos nuevos** (ver §Common Pitfalls: el carril usa `noopLogger`, la observabilidad va a stdout). |

**Installation:** N/A — cero paquetes. `node --test` (Node 22.22.3) ejecuta la suite.

## Package Legitimacy Audit

No aplica — esta fase **no instala ningún paquete externo** (constraint LOCKED: cero nuevas dependencias npm). No hay `npm install`, no hay ecosistema que auditar.

## Architecture Patterns

### System Architecture Diagram — carril del piggyback (ORCH-07)

```
`kodo check` (sin --dry-run)
      │
      ▼
runCheckAndAct()                            [src/check.js:119 — ÚNICO punto que cambia]
      │
      ├─► runCheck() ───────────────► { needsOrchestrator, reasons, summary }
      │                                (SIN cambios — byte-idéntico; D-04)
      │
      ├─ console.log(result.summary)
      │
      ▼
   ¿needsOrchestrator === true?  ──NO──►  return   (sidebar sucio con check limpio → NADA; D-03)
      │
     SÍ (stuck/review/pending)
      │
      ▼
  ┌────────────────────────────────────────────────────┐
  │  PIGGYBACK DOCTOR (NUEVO — antes de launch; D-05)   │
  │  try {                                              │
  │    report  = await scan(deps)   ── advisories line  │  deps = {} → noopLogger (LOG-12!)
  │    result  = await execute(deps, { fix: true })     │  loose→add, empty→ungroup
  │    // D-06: `[kodo:check] Sidebar: N acción(es)...`  │
  │    // D-08: `[kodo:check] Sidebar advisories: N...`  │
  │  } catch (err) {                                     │  fail-open (defensa en profundidad;
  │    console.error(`[kodo:check] Sidebar doctor        │  execute ya es never-throws top-level)
  │       error: ${err.message}`)                        │
  │  }                                                   │
  └────────────────────────────────────────────────────┘
      │
      ▼
  console.log('[kodo:check] Launching orchestrator: ...')
  try { await launchOrchestrator() }                    [catch existente — espejo del fail-open]
  catch (err) { console.error(...) }
      │
      ▼
   Orquestador arranca con el sidebar YA convergido
```

Motor consumido (NO se toca, Phase 79):
```
scan(deps)    → { missing_group[], loose_workspace[], empty_group[],
                  protected{}, hasActions, hasAdvisories }   [never-throws, read-only]
execute(deps,{fix:true}) → re-scan TOCTOU fresco → allowlist no-destructivo
                  → { created:0, added:N, ungrouped:M, errors[] }  [never-throws top-level]
```

### Recommended Project Structure
```
src/
├── check.js                    # ← ÚNICO fichero de código que cambia (runCheckAndAct + DI)
├── cmux/sidebar-doctor.js      # consumido tal cual (import directo scan/execute)
├── logger-noop.js              # noopLogger — default del doctor en el carril (LOG-12)
└── orchestrator/
    └── prompt.md               # ← edición documental concisa (D-09, D-12 intacto)
.claude/skills/kodo-orchestrate/
    └── skill.md                # ← edición documental detallada (D-09)
test/
├── check.test.js               # ← extender: tests del piggyback (gate, invariante, fail-open)
└── check-isolation.test.js     # ← extender: LOG-12 sigue verde con sidebar-doctor en el grafo
```

### Pattern 1: Piggyback in-process con gate + fail-open (el corazón de ORCH-07)

**What:** Insertar el carril doctor dentro del branch `if (result.needsOrchestrator)` de `runCheckAndAct`, **antes** de `launchOrchestrator()`, en su propio try/catch.

**When to use:** Exactamente aquí — es el único punto que satisface D-01/D-03/D-05 simultáneamente.

**Example (referencia — el catch de `launchOrchestrator` es el espejo exacto del fail-open):**
```javascript
// Source: src/check.js:119-131 (estructura ACTUAL — el piggyback se inserta en el hueco marcado)
export async function runCheckAndAct() {
  const result = await runCheck();
  console.log(result.summary);

  if (result.needsOrchestrator) {
    // ◄── AQUÍ va el bloque doctor (D-05: ANTES del launch), con su try/catch propio
    console.log(`[kodo:check] Launching orchestrator: ${result.reasons.join('; ')}`);
    try {
      await launchOrchestrator();
    } catch (err) {                                     // ← espejo del fail-open a replicar
      console.error(`[kodo:check] Error launching orchestrator: ${err.message}`);
    }
  }
}
```

### Pattern 2: Consumo del motor con defaults de producción (LOG-12-safe)

**What:** Llamar `scan()` y `execute()` con un `deps` que resuelve a defaults reales de producción y **omite `logger`** (→ `noopLogger`).

**Example:**
```javascript
// Source: contrato de src/cmux/sidebar-doctor.js:90-108 (resolveDeps)
// En producción, deps = {} hace que resolveDeps use TODOS los defaults reales:
//   loadState, loadProjects, listWorkspaceGroups, listWorkspacesJson,
//   createWorkspaceGroup, addToWorkspaceGroup, setGroupAnchor, ungroupWorkspaceGroup,
//   now = Date.now, logger = noopLogger  ◄── clave LOG-12
const report = await scan();                    // read-only; para la línea de advisories (D-08)
const result = await execute({}, { fix: true }); // converge loose→add / empty→ungroup (D-07)
// result.added, result.ungrouped, result.errors → línea resumen D-06
// report.hasAdvisories, report.missing_group.length → línea advisories D-08
```

### Pattern 3: DI para testabilidad (discreción — espejo de `checkPendingTasks`)

**What:** `runCheckAndAct` hoy no acepta parámetros (ver callers `src/cli.js:140-141`). Para testear el piggyback sin cmux/estado reales, añadir params opcionales inyectables con defaults de producción — el patrón exacto que ya usa `checkPendingTasks({ getProviderFn, formatterFn })`.

**Recomendación:** firma `runCheckAndAct({ runCheckFn, scanFn, executeFn, launchFn } = {})` con defaults a las impls reales. Preserva byte-identidad para el caller de producción (`await runCheckAndAct()` sigue funcionando) y permite tests que inyectan un `runCheckFn` que devuelve `needsOrchestrator:false/true`, un `scanFn`/`executeFn` stub, y un `launchFn` espía para verificar el orden.

### Anti-Patterns to Avoid
- **Shellear `kodo sidebar doctor --fix` como subproceso:** descartado por D-01/D-02 (no determinista respecto a PATH/argv, y rompe el «mismo proceso, 0 tokens»). Import directo, siempre.
- **Inyectar un `logger` real (de `src/logger.js`) al doctor desde el carril de check:** rompe LOG-12 (reintroduce `logger.js` al grafo del vigilante). Usar `noopLogger` (default). La observabilidad del carril va a **stdout** con prefijo `[kodo:check]`, no al NDJSON.
- **Añadir el resultado del doctor a `reasons` o dejar que influya `needsOrchestrator`:** viola el invariante «sidebar NO es trigger» (D-04). El doctor lee el gate, nunca lo alimenta.
- **Correr el doctor bajo `kodo check --dry-run`:** el path `--dry-run` llama `runCheck()` (no `runCheckAndAct`; ver `src/cli.js:132-138`), así que el `--fix` mutante **no** se dispara en dry-run por construcción. No mover el piggyback a `runCheck()`.
- **Crear/anclar grupos (`missing_group`):** el carril NO ejecuta `missing_group` (ratificación 79-04/G-79-1). Solo advisory.
- **Reescribir los documentos enteros:** D-11 exige cambios quirúrgicos. Se corrige lo desfasado, no se re-redacta.
- **Tocar el bloque `<!-- BEGIN/END reporting -->` o los placeholders `{{provider}}`:** D-12 — la reconciliación no altera el gating ni `resolvePromptTemplate`.

## Don't Hand-Roll

| Problema | No construyas | Usa | Por qué |
|----------|---------------|-----|---------|
| Detección de deriva del sidebar | Un scanner nuevo de grupos/workspaces | `scan()` de `src/cmux/sidebar-doctor.js` | Ya clasifica missing/loose/empty con TOCTOU, DI y never-throws. |
| Convergencia (add/ungroup) | Llamadas cmux propias | `execute(deps,{fix:true})` | Allowlist no-destructivo, fail-open per-item, re-scan interno TOCTOU. |
| Fail-open del carril | Un patrón de manejo de error nuevo | El catch existente de `launchOrchestrator` en `runCheckAndAct` | D-05 lo nombra como espejo exacto; misma forma `console.error('[kodo:check] ...')`. |
| Testabilidad del carril | Mocks de cmux/fs pesados | Patrón DI de `checkPendingTasks` | Ya establecido; discreción D lo autoriza como espejo. |
| Color de las líneas nuevas | ANSI inline | `createFormatter` | Color isolation LOCKED; check-isolation.test.js prohíbe `\x1b[` inline en check.js. |
| Propagar la skill editada a home | `cp` manual en el plan | `syncSkill` (auto en `launchOrchestrator`) | Mecanismo existente fail-open; se dispara al próximo launch. |

**Key insight:** El 100% de la "lógica de sidebar" ya existe y está verificada en vivo (UAT 79 4/4). Esta fase es **cableado + gating + documentación**, no construcción. Cualquier lógica de grupos nueva es sobreingeniería que además arriesga el launch path byte-idéntico y LOG-12.

## Runtime State Inventory

Esta fase incluye una reconciliación documental (rename/refactor-adjacent) además del carril de código. Inventario de estado runtime:

| Categoría | Items encontrados | Acción requerida |
|-----------|-------------------|------------------|
| Stored data | **Ninguno** — `state.json` es solo-lectura para todo el carril (constraint LOCKED). El doctor ya es GRP-04/read-only sobre state.json (no persiste refs `workspace_group:N`). Verificado en `src/cmux/sidebar-doctor.js` (no importa saveState/withStateLock). | Ninguna. |
| Live service config | **cmux workspace-groups** — el `execute()` muta grupos del sidebar cmux (add/ungroup). Esto es el efecto deseado (ORCH-07), no un rename. Los grupos son **por ventana** (Phase 77): el daemon headless puede no ver la ventana correcta → convergencia eventual asumida (constraint LOCKED). | Ninguna acción de migración; documentar el caveat window-scoping (ya asumido). |
| OS-registered state | **Ninguno.** | Ninguna. |
| Secrets/env vars | **Ninguno** — el carril no lee ni escribe secretos. | Ninguna. |
| Build artifacts | **`~/.claude/skills/kodo-orchestrate/skill.md`** (copia en home) queda **stale** respecto a la skill del repo tras editarla — pero `syncSkill` la re-propaga fail-open en el próximo `launchOrchestrator`. NO es un artefacto a regenerar manualmente. | Ninguna manual; el auto-sync lo cubre. Verificar en VERIFICATION que la copia home se actualiza al siguiente launch (o documentar que es lazy). |
| **Comentario de código stale** (categoría extra detectada) | `src/logger-events.js:21` afirma: *«LOG-12 invariant: ningún consumer en el grafo de src/check.js importa este módulo.»* Tras Phase 80, `check.js` → `sidebar-doctor.js` → `logger-events.js`, así que el grafo de check SÍ alcanza `logger-events.js`. **Ningún test rompe** (los guards solo prohíben `logger.js`/github/polling; `logger-events.js` es puro y permitido), pero el comentario queda FALSO. | Edición quirúrgica del comentario en el plan del carril (actualizarlo a: «alcanzable vía sidebar-doctor tras Phase 80, pero sigue siendo transformación pura zero-side-effect»). |

**Nada encontrado en categorías Stored data / OS-registered / Secrets:** confirmado por lectura de fuente (el carril y el motor son read-only sobre state.json y no tocan secretos ni registros OS).

## Common Pitfalls

### Pitfall 1: Romper LOG-12 al importar el doctor en check.js
**What goes wrong:** El carril importa algo que arrastra `src/logger.js` (o github/polling) al grafo de `kodo check`; `test/check-isolation.test.js` se pone rojo.
**Why it happens:** Es tentador inyectar un logger real para emitir `sidebar.doctor.*` al NDJSON.
**How to avoid:** Importar SOLO `scan`/`execute` de `src/cmux/sidebar-doctor.js` (grafo verificado limpio) y llamar con `deps` **sin** `logger` (→ `noopLogger`). La observabilidad va a stdout. **VERIFIED en esta sesión:** el grafo transitivo de `sidebar-doctor.js` (18 ficheros) no contiene ninguno de los 4 módulos prohibidos.
**Warning signs:** Cualquier `import ... from '../logger.js'` nuevo en el path de check; cualquier `deps.logger = <algo real>`.

### Pitfall 2: Doble mutación / bucle sobre advisories
**What goes wrong:** El operador teme que un `missing_group` no auto-arreglable haga que cada pase re-intente y no converja.
**Why it happens:** Malentender qué cuenta como acción.
**How to avoid:** `hasActions = loose + empty` (missing_group EXCLUIDO, por diseño 79-04). El carril solo ejecuta loose→add / empty→ungroup; los advisories solo se REPORTAN (D-08). Un segundo pase con el sidebar ya convergido no ejecuta nada. No hay bucle.
**Warning signs:** Test de convergencia que espera 0 acciones en el 2º pase y ve N>0.

### Pitfall 3: El piggyback altera el orden de efectos del launch
**What goes wrong:** El launch path deja de ser byte-idéntico; `test/orchestrator-launch-isolation.test.js` u otros golden rompen.
**Why it happens:** Meter lógica dentro de `launchOrchestrator()` (D-02 lo descarta explícitamente).
**How to avoid:** Todo el piggyback vive en `runCheckAndAct`, ANTES de `launchOrchestrator()`. `launch.js` no se toca. El orden `backstop → setColor → notify` y el early-return "already exists" quedan intactos.
**Warning signs:** Diffs en `src/orchestrator/launch.js`.

### Pitfall 4: `runCheck()` deja de ser byte-idéntico
**What goes wrong:** Se añade la línea de sidebar dentro de `runCheck()` y el `summary`/`reasons` cambian, contaminando el gate.
**Why it happens:** Confundir dónde va el piggyback.
**How to avoid:** `runCheck()` NO cambia (D-04). El piggyback vive solo en `runCheckAndAct`, que consume `result.needsOrchestrator` sin modificarlo. Las líneas de sidebar salen por `console.log`/`console.error` en `runCheckAndAct`, no entran a `result.summary`.
**Warning signs:** Diffs en `runCheck()`; tests de `runCheck` que ven líneas `Sidebar:` inesperadas.

### Pitfall 5: Deriva documental en la dirección equivocada (prometer features borradas)
**What goes wrong:** La reconciliación añade menciones a features v0.17 pero deja prosa que promete cosas ya cambiadas (p. ej. el nudge de refresh que se borró, o `missing_group` como auto-creable).
**Why it happens:** HYG-08 es bidireccional; es fácil solo añadir y no auditar lo viejo.
**How to avoid:** Checklist manual features↔docs en AMBOS sentidos en VERIFICATION (D-11). En particular: el doctor NO crea grupos (advisory), el nudge de refresh ya no existe (`launch.js:203` solo loguea "already exists"), `pending` es `pending_stale`/`pending_fetched_at`.
**Warning signs:** Prosa en skill/prompt que menciona create/set-anchor como acción del doctor sobre sesiones vivas.

### Pitfall 6: cmux ausente/headless hace fallar el carril ruidosamente
**What goes wrong:** En un pase donde cmux no responde (o el daemon está en otra ventana), el doctor produce ruido o excepción.
**Why it happens:** Los passthroughs cmux (`listWorkspaceGroups`/`listWorkspacesJson`) usan execFile.
**How to avoid:** `scan()` ya es never-throws (parseRaw con fallback → report vacío → 0 acciones); `execute()` es never-throws top-level. El try/catch del carril (D-05) es defensa en profundidad. Un pase sin cmux converge a "0 acciones", no a crash. Window-scoping → convergencia eventual (asumida).
**Warning signs:** El carril lanza excepción no capturada; el check aborta antes del launch.

## Code Examples

### Detección + convergencia in-process (el patrón que el carril replica del CLI)
```javascript
// Source: src/cli/sidebar-doctor.js:61-92 (runSidebarDoctor) — semántica a replicar IN-PROCESS
// El CLI: 1) SIEMPRE scan primero  2) execute solo bajo --fix, SIEMPRE después de scan.
const report = await scanFn(deps);
const exitCode = report.hasActions ? 1 : 0;   // el carril NO usa exit code; usa los contadores
let result = null;
if (opts.fix) {
  result = await executeFn(deps, { fix: true });
}
// El carril de check hace lo mismo pero con fix SIEMPRE true (piggyback), y en vez de render
// humano emite las líneas [kodo:check] Sidebar: ... (D-06) y Sidebar advisories: ... (D-08).
```

### Contrato del report y del result (lo que el carril lee para sus líneas)
```javascript
// Source: src/cmux/sidebar-doctor.js:64-71 (SidebarReport) y :326 (SidebarResult)
// report:
//   { missing_group[], loose_workspace[], empty_group[], protected{sessions[]},
//     hasActions: (loose+empty)>0, hasAdvisories: missing_group>0 }
// result (de execute):
//   { created: 0 /*siempre 0 — no crea grupos*/, added: N, ungrouped: M, errors: [{category,target,reason}] }
```

### Patrón DI existente a espejar en runCheckAndAct
```javascript
// Source: src/check.js:30 (checkPendingTasks) — DI opcional con defaults de producción
export async function checkPendingTasks({ config, runningCount, getProviderFn, formatterFn }) { ... }
// runCheckAndAct debería seguir el mismo estilo: params opcionales con defaults a impls reales,
// preservando `await runCheckAndAct()` sin args para el caller de cli.js:141.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| El operador cura el sidebar a mano (crea grupos, mueve workspaces sueltos) | El doctor lo cura; el orquestador lo invoca de piggyback | v0.18 (Phase 79 motor, Phase 80 carril) | El humano deja de mantener el sidebar; convergencia eventual sin intervención. |
| `missing_group` auto-creable (D-07/D-08 originales de Phase 79) | `missing_group` report-only/advisory (79-04 / G-79-1) | Phase 79 UAT (2026-07-23) | El doctor nunca ancla grupos en sesiones vivas (cmux 0.64.20: el header del grupo ES la fila del anchor). `hasActions` excluye missing_group. |
| Nudge de refresh al orquestador ya-existente | Solo `console.log('...already exists')`, sin nudge (spam eliminado) | 2026-07-14 (Phase 73 quemada) | La skill/prompt NO deben prometer un nudge de refresh (anti-deriva). |
| `pending_count` con ventana de divergencia 30s | Convergencia por hoja `src/tasks/pending.js` + `pending_stale`/`pending_fetched_at` | v0.17 Phase 76 | La skill/prompt deben reflejar la frescura discriminada (D-10). |

**Deprecated/outdated (a NO reintroducir en la doc):**
- Nudge de refresh del orquestador (borrado con Phase 73).
- `missing_group` como acción ejecutable del doctor (ahora advisory).
- El doc web de cmux sobre disolución de grupos (el `--help` del binario manda: cerrar el anchor disuelve preservando miembros como sueltos).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El formato exacto de las líneas de log (`[kodo:check] Sidebar: N acción(es) aplicadas` / `Sidebar advisories: N (acción de operador)`) es a discreción del planner/executor. | D-06/D-08 (Discretion) | Bajo — CONTEXT lo marca explícitamente como discreción; cualquier formato coherente con `[kodo:check]` + `createFormatter` es válido. |
| A2 | No hacen falta eventos nuevos en `logger-events.js`: el carril usa `noopLogger` (LOG-12), así que emitir `sidebar.doctor.*` al NDJSON desde el carril sería un no-op de todos modos; la observabilidad va a stdout. | §Standard Stack / Discretion | Bajo — si el operador quisiera NDJSON del carril, chocaría con LOG-12; stdout es la vía correcta. Confirmar en discuss si se desea telemetría, pero el default recomendado es "sin eventos nuevos". |
| A3 | `runCheckAndAct` necesita DI añadida para testear el piggyback de forma unitaria (hoy no tiene). | Pattern 3 (Discretion) | Bajo — es discreción D; alternativa: test de integración con stubs de módulo. La DI espejo de `checkPendingTasks` es el patrón establecido y de menor fricción. |

**Nota:** No hay assumptions sobre decisiones LOCKED — todas las decisiones D-01..D-12 se verificaron contra código real (no re-decididas). Las tres A# son áreas de discreción explícitamente delegadas por CONTEXT.

## Open Questions

1. **¿El carril debe llamar `scan()` por separado, o basta el result de `execute()` (que re-scanea internamente)?**
   - Lo que sabemos: `execute()` hace su propio `scan()` fresco (TOCTOU) pero su `result` NO incluye `missing_group`/`hasAdvisories` (solo created/added/ungrouped/errors). Para la línea de advisories (D-08) el carril necesita el `report`.
   - Lo que no está claro: si vale la pena un `scan()` extra (2 scans totales) o si D-08 puede omitirse cuando no hay una fuente barata.
   - Recomendación: llamar `scan()` una vez para el report (advisories + decidir si hay algo que hacer) y `execute(deps,{fix:true})` para converger — exactamente lo que hace el CLI (`runSidebarDoctor`). El coste es 2 llamadas cmux por pase motivado (~aceptable; el pase ya va a lanzar un LLM). Es el patrón de menor sorpresa.

2. **¿Se surface el resumen del doctor al `contextSummary` del launch?**
   - Resuelto por D-08: **no** (infla el prompt; el orquestador puede correr `kodo sidebar doctor` dry-run bajo demanda). Cerrado.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime + `node --test` | ✓ | 22.22.3 | — |
| cmux CLI | `execute()` muta grupos (add/ungroup) en vivo | ✓ | 0.64.20 (100) | `scan`/`execute` never-throws → report vacío → 0 acciones si cmux ausente/headless (fail-open). |
| npm deps nuevas | — | N/A | — | Cero deps nuevas (constraint LOCKED). |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** en un entorno sin cmux (CI, tests), el motor degrada a 0 acciones vía sus fallbacks never-throws; los tests inyectan stubs vía DI. cmux 0.64.20 está presente en la máquina del operador y es el que Phase 79 validó en vivo.

## Validation Architecture

`workflow.nyquist_validation` está habilitado (config.json). Sección incluida.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in, Node 22.22.3) |
| Config file | none — `package.json` script `test` |
| Quick run command | `node --test test/check.test.js test/check-isolation.test.js` |
| Full suite command | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-07 | Con `needsOrchestrator===true`, el carril llama `execute({fix:true})` ANTES de `launchOrchestrator` | unit (DI) | `node --test test/check.test.js` | ✅ (extender) |
| ORCH-07 | Con `needsOrchestrator===false` (All clear), el doctor NO corre (gate D-03) | unit (DI) | `node --test test/check.test.js` | ✅ (extender) |
| ORCH-07 | Invariante «sidebar NO es trigger»: un sidebar sucio con check limpio → ni doctor ni orquestador; el result del doctor nunca entra a `reasons`/`needsOrchestrator` (D-04) | unit (DI) | `node --test test/check.test.js` | ✅ (extender) |
| ORCH-07 | Fail-open: un `execute`/`scan` que lanza no bloquea `launchOrchestrator` ni el check (D-05) | unit (DI, stub que throwea) | `node --test test/check.test.js` | ✅ (extender) |
| ORCH-07 | LOG-12: `check.js` sigue sin alcanzar `logger.js`/github/polling en su grafo tras importar sidebar-doctor | source/import-graph | `node --test test/check-isolation.test.js` | ✅ (extender: añadir aserción explícita de que sidebar-doctor está en el grafo pero no arrastra prohibidos) |
| ORCH-07 | `runCheck()` byte-idéntico (sin líneas Sidebar en `summary`) | unit | `node --test test/check.test.js` | ✅ (existente cubre runCheck; añadir guard si hace falta) |
| ORCH-08 | skill + prompt mencionan sidebar doctor y features v0.17; no prometen features borradas | checklist manual (VERIFICATION) | manual — precedente HYG-08 (D-11) | N/A (no test automático de docs, por D-11) |

### Sampling Rate
- **Per task commit:** `node --test test/check.test.js test/check-isolation.test.js`
- **Per wave merge:** `npm test` (suite completa — baseline v0.17 cerró en 2309 tests verdes)
- **Phase gate:** suite completa verde antes de `/gsd-verify-work`; checklist anti-deriva D-11 completo en VERIFICATION.

### Wave 0 Gaps
- [ ] `test/check.test.js` — extender con la batería del piggyback (gate on/off, invariante never-adds-to-reasons, fail-open, orden doctor-antes-de-launch). Requiere DI en `runCheckAndAct` (Pattern 3).
- [ ] `test/check-isolation.test.js` — añadir aserción positiva: `check.js` alcanza `src/cmux/sidebar-doctor.js` en su grafo (convergencia observable) Y sigue sin alcanzar los 4 prohibidos.
- [ ] Framework install: ninguno — `node:test` es built-in.

*(No hay gaps de infraestructura: el framework y los ficheros existen; el trabajo es extender.)*

## Security Domain

`security_enforcement` no está explícitamente en `false` (config.json no lo desactiva) → sección incluida. Nota: esta fase es 0-token, read-only sobre state.json, sin red nueva, sin endpoints, sin input de usuario nuevo. La superficie de seguridad es mínima.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El carril no autentica nada. |
| V3 Session Management | no | No gestiona sesiones HTTP. |
| V4 Access Control | no | Sin endpoints ni permisos nuevos. |
| V5 Input Validation | parcial | El motor ya valida/parsea el JSON crudo de cmux con fallback never-throws (`parseRaw`). El carril no añade input nuevo. |
| V6 Cryptography | no | Sin cripto. |
| V7 Error Handling & Logging | sí | Fail-open documentado (D-05); el carril emite a stdout, nunca al NDJSON (LOG-12). Los errores del doctor no filtran contenido de usuario (solo `err.message`). |

### Known Threat Patterns for este carril

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Log injection / fuga de contenido de usuario en las líneas `[kodo:check] Sidebar ...` | Information disclosure | Las líneas emiten contadores + `err.message`, no nombres/paths de tareas crudos. Mantener el patrón whitelist del repo (no volcar refs/objetos raw). |
| Mutación cmux inesperada (verbo destructivo) | Tampering | El motor solo usa el allowlist no-destructivo (create/add/set-anchor/ungroup) y `delete` NI SE CABLEA — guard `test/sidebar-doctor-hygiene.test.js` escanea todo `src/` y falla si aparece. El carril no añade verbos. |
| DoS por bucle de re-fix sobre advisories | Denial of Service | `hasActions` excluye `missing_group`; un 2º pase converge a 0 acciones. Sin bucle. |

**Nota:** No se abre ninguna amenaza nueva. El guard source-hygiene de Phase 79 (`sidebar-doctor-hygiene.test.js`) sigue cubriendo la ausencia de `delete`. El carril hereda el 0-token / read-only-state / never-throws del motor.

## Sources

### Primary (HIGH confidence — lectura directa de fuente en esta sesión)
- `src/check.js` (`runCheck`, `runCheckAndAct`, `checkPendingTasks`) — punto de inserción y patrón DI.
- `src/cmux/sidebar-doctor.js` (`scan`, `execute`, `resolveDeps`, contrato `SidebarReport`/`SidebarResult`) — motor a consumir.
- `src/cli/sidebar-doctor.js` (`runSidebarDoctor`) — semántica del encadenamiento scan→execute a replicar.
- `src/orchestrator/launch.js` (`resolvePromptTemplate`, `applyReportingGate`, `syncSkill`, early-return "already exists") — invariantes a preservar (D-12).
- `src/logger-events.js` (taxonomía + `sidebarDoctor*` + comentario stale L21) — no hacen falta eventos nuevos; comentario a corregir.
- `.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md` — inventario de contenido para la reconciliación.
- `test/check.test.js`, `test/check-isolation.test.js`, `test/sidebar-doctor-hygiene.test.js` (head) — patrones de test a espejar.
- `src/cli.js:130-143` — callers de `runCheck`/`runCheckAndAct` (dry-run usa runCheck; el fix no corre en dry-run).
- **Walker de import-graph ejecutado en esta sesión** — VERIFIED: grafo de `sidebar-doctor.js` (18 ficheros) sin `logger.js`/github/polling → LOG-12 preservado.
- `.planning/REQUIREMENTS.md` (ORCH-07/08, Out of Scope), `.planning/STATE.md` (Critical Invariants, constraints LOCKED v0.18, decisiones 79-04), `.planning/milestones/v0.17-ROADMAP.md` (features 74-77), `.planning/phases/80-.../80-CONTEXT.md` (D-01..D-12).

### Secondary (MEDIUM confidence)
- `cmux 0.64.20` verificado presente en la máquina (`cmux --version`).

### Tertiary (LOW confidence)
- Ninguna — no se usó WebSearch; todo el dominio es código interno del repo.

## Metadata

**Confidence breakdown:**
- Standard stack (módulos internos + cero deps): HIGH — verificado por lectura de fuente y walker de imports.
- Architecture (punto de inserción, gate, fail-open, LOG-12): HIGH — el patrón espejo (catch de launchOrchestrator, DI de checkPendingTasks) ya existe en el mismo fichero; LOG-12 verificado empíricamente.
- Pitfalls: HIGH — derivados de invariantes LOCKED y tests existentes concretos.
- Reconciliación documental: MEDIUM — el inventario de gaps es claro, pero la redacción exacta es discreción y la auditoría anti-deriva es manual (D-11).

**Research date:** 2026-07-23
**Valid until:** ~2026-08-22 (30 días — dominio estable, código interno; el único riesgo es que otra fase toque `check.js`/`sidebar-doctor.js` antes de ejecutar, improbable dado que Phase 81 es ortogonal).
