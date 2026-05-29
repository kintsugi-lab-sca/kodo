# Phase 38 — CONTEXT

> **Mode:** `--auto` (single-pass, gray areas auto-resolved con defaults sensatos derivados de SEED.md + invariantes PROJECT.md).
> **Audit trail:** ver §Auto-decision log al final del documento para cada decisión.
> **Origen:** promovido desde backlog 999.2 (commit `7f6e041` capturó el SEED) tras diagnóstico 2026-05-29 de ROMAN-151/152 invisibles en el dashboard. Renumber Phase 38↔39 en commit `536ad1d`.
> **SEED:** `.planning/phases/38-workspacehost-lifecycle-idle-needs-input/SEED.md` (queda como histórico de captura; este CONTEXT.md es la source-of-truth para researcher + planner).

## Phase goal (de ROADMAP, locked)

El dashboard nunca pierde sesiones reanudables (proceso Claude exit pero tab del workspace host viva esperando merge/push/duda) — esas sesiones quedan como `idle` o `needs-input` en `state.sessions`, NO se mueven a `history`. Simultáneamente, la dependencia directa de cmux se elimina vía un `WorkspaceHost` provider contract intercambiable (cmux hoy, orca u otros mañana), análogo al invariante v0.7 `TaskProvider 9-method contract`.

## Locked requirements (de ROADMAP Success Criteria)

1. **TUI-17 (SC#1):** `src/host/interface.js` define `HOST_METHODS` + `getHost(name)` con contrato mínimo; `CmuxHost` implementa; test de contrato análogo a `test/providers/contract.test.js` verde.
2. **TUI-18 (SC#2):** `markSessionStatus` acepta `idle` / `needs-input` / `closed`; exit del proceso Claude mapea a `idle` (NO `done`); state.json migra idempotentemente con backup automático; entries de history con tab del host viva → vuelven a `sessions` como `idle`.
3. **TUI-19 (SC#3):** Dashboard lista TODOS los estados no-closed con badges visuales; filtros Phase 36 respetan multi-estado; footer-error Phase 36/37 absorbe errores del host.
4. **TUI-20 (SC#4):** Reconciliación polling cruza `state.sessions + state.history` contra `host.listWorkspaces()`; rescata huérfanos con tab viva; sella `closed` los sin tab; debouncing previene flicker idle↔running.
5. **SC#5 (cmux-isolation):** Cero referencias directas a `cmux` en `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js`. cmux confinado a `src/host/cmux.js`. Style guard análogo a `test/format-isolation.test.js`.
6. **SC#6 (Phase 37 parity):** UAT manual Phase 37 re-ejecutado sobre `CmuxHost` confirma parity — los 2 obligatorios siguen pasando.

## Decisions

### D-01 — Nombre del contract: `WorkspaceHost`

Auto-selected (SEED.md): `WorkspaceHost` se prefiere sobre `TerminalHostProvider` / `WorkspaceProvider` por simetría con `TaskProvider` (mismo patrón naming) y porque el dominio del provider es **workspace lifecycle**, no solo "terminal". cmux y Orca exponen workspaces como abstracción primaria.

### D-02 — Ubicación del módulo: `src/host/`

Auto-selected (SEED.md): `src/host/interface.js`, `src/host/cmux.js`, futuros `src/host/orca.js` / `src/host/null.js`. Paralelo a `src/providers/` (TaskProvider implementations) sin entrar en él, porque WorkspaceHost es un eje ortogonal al provider de tareas. Eliminar el dir `src/host/` requiere update del README de arquitectura cuando esta phase ship.

### D-03 — API mínima del contract (4 métodos)

Auto-selected: el contrato mínimo de TUI-17 son **4 métodos**:

```js
// src/host/interface.js
export const HOST_METHODS = [
  'listWorkspaces',  // () => Promise<WorkspaceInfo[]>
  'selectWorkspace', // (ref) => Promise<{ok, code?, detail?}>  (fire-and-forget focus, never-throws)
  'isAlive',         // (ref) => Promise<boolean>  (helper derivable, pero ergonómico para guards)
  'needsInput',      // (ref) => Promise<boolean>  (badge cmux / orca equivalent)
];
```

`closeWorkspace(ref)` queda como **follow-up no bloqueante** — fuera de scope de Phase 38. El sellado a `closed` se hace por desaparición de la tab (observada en `listWorkspaces()`), no por acción explícita del provider.

**Shape de `WorkspaceInfo`:**

```js
{
  workspace_ref: string,       // canónico (host-specific format, e.g. "workspace:N")
  alive: boolean,              // process del agente activo (no necesariamente Claude — cualquier process en la tab)
  needs_input: boolean,        // badge "Needs input" o equivalent del host
  last_activity: string|null,  // ISO 8601 timestamp del último activity event (cmux exposes esto vía socket; orca TBD)
}
```

`last_activity` es opcional/nullable porque el research del SEED no confirmó que Orca lo exponga. Si el host no puede inferirlo, retorna `null` y el dashboard usa fallback al `started_at` de la session de kodo.

**Contract test:** `test/host/contract.test.js` itera implementations (`CmuxHost` + `NullHost` mock) × asserts core:
- `HOST_METHODS.every(m => typeof host[m] === 'function')` — validación shape.
- `selectWorkspace` retorna discriminated union `{ok, code?, detail?}` (never-throws, mismo patrón que `runFocus` Phase 37).
- `listWorkspaces` retorna array con todos los fields del shape.

### D-04 — Estados del ciclo de vida (5 estados)

Auto-selected: ampliación del SEED de 4 a **5 estados** para cubrir el caso `dead`:

| Estado | Significado | Ubicación | Transición desde |
|---|---|---|---|
| `running` | proceso vivo Y tab del host viva | `state.sessions` | inicial (`launch`) |
| `idle` | proceso exit, tab del host viva, sin badge `needs_input` | `state.sessions` | `running` (al exit del process) |
| `needs-input` | proceso exit, tab del host viva, badge `needs_input` activo | `state.sessions` | `idle` (cuando el host expone needs_input=true) o `running` (al exit + host ya tiene needs_input) |
| `dead` | proceso exit, tab del host AUSENTE | `state.sessions` | `idle` / `needs-input` (al desaparecer la tab) |
| `closed` | sellado terminal | `state.history` | `dead` (tras retention TTL) o explícito por operador (cmd futuro `/kodo close-session <id>`) |

**Reglas de transición load-bearing:**

- `running` → `idle` al exit del process (sin mover a history).
- `idle` ↔ `needs-input` según `host.needsInput(ref)` (bidireccional, debounced).
- `idle` / `needs-input` → `dead` cuando `host.isAlive(ref) === false` (tab desapareció).
- `dead` → `idle` cuando la tab reaparece (raro, pero posible con re-attach manual del operador). NOTA: este caso NO requiere lógica especial, el reconciliador lo detecta en el siguiente tick.
- `dead` → `closed` automático tras **30 días** sin reaparecer (configurable via `workflow.host_dead_ttl_days`, default 30). Conservador para no perder huérfanos legítimos.
- `closed` es terminal — no transiciona de vuelta.

**Estado `done` legacy:** durante la migración (v2→v3), entries con `status: done` se mapean a:
- Si `ended_at` < 30 días Y `host.listWorkspaces()` contiene su `workspace_ref` → `idle` (rescate).
- Si `ended_at` < 30 días Y tab ausente → `dead`.
- Si `ended_at` ≥ 30 días → `closed` (sin cambio efectivo, ya estaban en history).

### D-05 — Migración state.json: schema v2 → v3

Auto-selected:

- **Idempotente:** ejecutar la migración N veces es equivalente a ejecutarla 1 vez. Detección por `schema_version === 3` (skip silencioso si ya migrada).
- **Backup automático ANTES de migrar:** `~/.kodo/state.json.bak.YYYYMMDD_HHMMSS` (formato sortable, sin overwrite). Recovery manual = `cp state.json.bak.<ts> state.json`.
- **Migración una-vía:** no se soporta downgrade v3→v2 automático. Si el operador necesita revert, restaurar el backup.
- **Trigger:** la migración corre al primer arranque del server con código v0.9-post-Phase-38 (lazy en `loadState()`). NO requiere comando manual.
- **Logging:** emite `state.migration.v2_to_v3` con `{from_count, to_sessions, to_history, rescued_from_history, sealed_as_closed}` (taxonomía 19 → 20). Visible en `kodo polling start --verbose` y en el log diario.
- **Test:** `test/state/migration.test.js` con 3 fixtures (state v2 vacío, state v2 con historia reciente cubierta por host, state v2 sin host activo).

### D-06 — Dashboard render: badges + filtros multi-estado

Auto-selected:

**Badges visuales (literal-stable, byte-determinístico):**

```js
// src/cli/dashboard/format.js — extensión, color isolation via <Text color>
const STATE_BADGES = {
  running:        { glyph: '▶', color: 'green',   label: 'running' },
  idle:           { glyph: '⏸', color: 'yellow',  label: 'idle' },
  'needs-input':  { glyph: '🔔', color: 'cyan',    label: 'needs-input' },
  dead:           { glyph: '✗', color: 'red',     label: 'dead' },
  // closed no se renderiza — closed lives in history, not in the dashboard list
};
```

**Filtros (extensión Phase 36 sintaxis `s:<state>`):**
- `s:running` — solo running
- `s:idle` — solo idle
- `s:needs-input` — solo needs-input
- `s:dead` — solo dead
- `s:active` — alias de `running || idle || needs-input` (NO incluye dead)
- Sin filtro `s:` → lista TODOS los estados de `state.sessions` (running + idle + needs-input + dead). `closed` no aparece porque viene de `state.history`.

**Footer-error Phase 36/37:** los errores del host (e.g. `host.listWorkspaces()` falla por ENOENT del binario) se renderizan en el mismo footer rojo de Phase 37 con constantes nuevas:
- `HOST_ERR_UNAVAILABLE = '[!] host unavailable — check binary path'`
- `HOST_ERR_TIMEOUT = '[!] host timeout — list-workspaces took >5s'`

Reusan el patrón `clear-on-any-input` (D-04 Phase 37) y el mecanismo `FOCUS_ERR_*` (D-05 Phase 37) sin duplicar.

### D-07 — Reconciliación: polling cross-check con debouncing

Auto-selected:

- **Trigger:** cada poll tick (compartido con el ciclo de polling actual de Phase 35 — sin nuevo timer).
- **Algoritmo:**
  1. `liveRefs = await host.listWorkspaces()` (timeout 5s, never-throws → si falla emite warn + skip este tick).
  2. Para cada session en `state.sessions`: actualizar `alive`/`needs_input` desde liveRefs. Aplicar transición de estado según D-04.
  3. Para cada entry en `state.history` con `ended_at < 30 días`: si su `workspace_ref` está en liveRefs → rescatar a `state.sessions` con estado derivado (`idle` o `needs-input`).
  4. Para cada session `dead` con `dead_since > 30 días` (configurable) → sellar como `closed` y mover a `state.history`.
- **Debouncing:** cambios de estado idle↔running↔needs-input requieren **2 ticks consecutivos** del mismo estado para aplicarse. Previene flicker UI cuando el host expone needs_input intermitentemente.
- **No bloquea render:** la reconciliación es async, completa después del próximo render del dashboard. Si tarda, el operador ve el estado del tick anterior (no UI freeze).

### D-08 — `CmuxHost` impl: migrar lógica existente

Auto-selected: extrae sin reescribir.

**Métodos:**
- `listWorkspaces()` → `execFile(cmux, ['list-workspaces', '--json'], {timeout: 5000})`. Parse JSON, normaliza shape al `WorkspaceInfo` contract. Timeout 5s mismo que `runFocus` Phase 37.
- `selectWorkspace(ref)` → invoca `runFocus({exec, ref, binary})` de Phase 37 (sin duplicar la lógica). `runFocus` ya retorna discriminated union — `selectWorkspace` re-exporta el shape.
- `isAlive(ref)` → wrapper sobre `listWorkspaces()` con caché de 1 tick. Para no spammear el socket cmux, mantiene un `Map<ref, alive>` que se invalida al siguiente tick del polling.
- `needsInput(ref)` → mismo patrón que `isAlive`, leyendo el campo `needs_input` del último snapshot.

**Binary path:** resuelto desde `loadConfig().cmux.binary` (mismo patrón que Phase 37 D-03). Si está vacío, `getHost('cmux')` falla early con `HOST_ERR_UNAVAILABLE`.

**cmux JSON contract:** investigar en research si `cmux list-workspaces --json` existe o si hay que parsear el output textual (`* workspace:N  Name [selected]`). Si no existe `--json`, el research debe documentar el regex parser.

### D-09 — Style guard: cmux-isolation walker

Auto-selected: análogo a `test/format-isolation.test.js` (color-isolation walker Phase 34 D-12).

**Test:** `test/host/cmux-isolation.test.js` con walker que itera `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js` y assert que NINGUNO contiene:
- `from '*/cmux/*'`
- `require('*/cmux/*')`
- Literal string `'cmux'` en path imports

cmux confinado a `src/host/cmux.js` (impl), `src/cmux/client.js` (puede mantenerse como helper interno usado SOLO desde `CmuxHost`), `src/cli/dashboard/focus.js` (lo que ya existe — Phase 37 lo creó y se mantiene; `CmuxHost.selectWorkspace` lo invoca).

**Excepciones documentadas:** la lista anterior + comentarios doc en JSDoc.

### D-10 — Orca / NullHost: deferred / mocks

Auto-selected: **fuera de scope de Phase 38**.

- `OrcaHost`: capture al backlog como Phase 999.3 candidate, "Implementar `OrcaHost` cuando se decida migrar de cmux a Orca". Skill `orca-cli` ya disponible localmente; el research puede investigar el CLI de Orca para confirmar feasibility, pero la impl es follow-up.
- `NullHost`: implementar como **mock-only en tests** (`test/host/null-host.test.fixture.js`). Sirve para el contract test y para tests de dashboard que no quieren depender de cmux real. NO se publica como export de runtime.

### D-11 — Estado de sesión: dimensiones independientes

Auto-selected: `alive` deja de ser binario.

El SessionRecord schema v3 expone 3 dimensiones independientes que el cliente puede leer por separado:

```js
{
  // ... fields v2 preservados ...
  alive: boolean,           // mantenido por compat (= state === 'running' || state === 'idle' || state === 'needs-input')
  state: 'running' | 'idle' | 'needs-input' | 'dead' | 'closed',  // NUEVO
  needs_input: boolean,     // NUEVO — true cuando state === 'needs-input'
  process_alive: boolean,   // NUEVO — true cuando el process Claude original está vivo (≈ pre-v3 alive)
  tab_alive: boolean,       // NUEVO — true cuando host.isAlive(workspace_ref)
  last_seen_alive: string,  // ISO timestamp del último tick donde tab_alive=true
}
```

`alive` se computa derivado de `state` para no romper consumers existentes. `process_alive` y `tab_alive` son las dimensiones canónicas; `state` es la combinación derivada según D-04 transition rules.

### D-12 — Backwards compat de callers existentes

Auto-selected: zero breaking changes en consumers conocidos.

- `findSession dual-scan` (v0.8 Phase 30 invariante): sigue funcionando. Escanea `state.sessions` + `state.history`. Con la reconciliación de D-07, idle/needs-input/dead viven en sessions; solo closed vive en history. El dual-scan se mantiene por seguridad (recovery de migración / corrupciones).
- `markSessionStatus contrato non-throwing` (v0.8 invariante): firma intacta. Acepta los nuevos states (`idle`, `needs-input`, `closed`) además de los existentes. El call existente `markSessionStatus(taskId, 'done', ...)` se REMAPEA internamente a `'idle'` durante un período de transición — esto incluye los 2 callers conocidos (`verify.js#finalize` rama pass + `stop.js`).

**Caller migration plan:**
- `verify.js#finalize` rama pass → `markSessionStatus(taskId, 'idle', 'gate-passed', log)`. Si el verdict es `pass`, el agente terminó su turno pero la sesión puede retomar.
- `stop.js` → `markSessionStatus(taskId, 'idle', 'session-stop:lock-released', log)`. El stop hook NO significa "sesión muerta" — significa "lock released, esperando humano".
- Compat shim: `'done'` se acepta como input y se mapea a `'idle'` con un `log.warn` ("DEPRECATED: status 'done' mapped to 'idle' for back-compat"). Se elimina en v0.10.

### D-13 — Observabilidad NDJSON

Auto-selected: nuevos eventos en la taxonomía del logger (v0.8 = 19 events → v0.9-post-38 = 23 events).

| Evento | Schema | Cuándo |
|---|---|---|
| `host.list_workspaces.ok` | `{count, duration_ms}` | cada poll exitoso |
| `host.list_workspaces.fail` | `{code, detail, duration_ms}` | host falla / timeout |
| `host.reconcile.tick` | `{rescued, sealed, transitioned, total}` | cada tick de reconciliación |
| `state.migration.v2_to_v3` | `{from_count, to_sessions, to_history, rescued, sealed}` | una vez al arranque post-migración |

Mantiene byte-determinismo (DX-06) y color isolation (logger no usa picocolors).

### D-14 — Phase 37 UAT re-corrida sobre `CmuxHost` (SC#6)

Auto-selected:

- Tras completar Plans 1-4, re-ejecutar los 2 escenarios obligatorios de `37-HUMAN-UAT.md` con `CmuxHost` en lugar de invocación directa a `runFocus`.
- **Trigger del retest:** durante el plan-3 (dashboard render multi-estado) o plan-4 (reconciliación) — el primero que toque el wire del Enter handler ya consume el host.
- **Sign-off:** mismo formato que Phase 37 (frontmatter `passed`, `approved_by`, `approved_at`). Archivo NUEVO `38-HUMAN-UAT.md` que extiende los 2 escenarios de Phase 37 + 2 escenarios de los nuevos estados:
  - **Nuevo Escenario A — idle visible:** sesión con `process_alive=false, tab_alive=true, needs_input=false` aparece con badge `⏸ idle`.
  - **Nuevo Escenario B — needs-input visible:** misma + `needs_input=true` aparece con badge `🔔 needs-input`. Visible delta tras forzar el badge en cmux (manual interaction).

### D-15 — Plans split (4 plans, Wave 1→4 secuencial por dependencias)

Auto-selected (matches SEED.md):

1. **Plan 38-01 (Wave 1)** — Contract + `CmuxHost` impl + contract test. Refactor `focus.js` y `polling.js` para consumir `host` (mínimo). Style guard `cmux-isolation` walker. SIN tocar estados todavía.
2. **Plan 38-02 (Wave 2)** — Estados `idle`/`needs-input`/`dead`/`closed` en `markSessionStatus` + schema v2→v3 + migration test + caller updates (`verify.js`, `stop.js` con compat shim). SIN tocar dashboard render.
3. **Plan 38-03 (Wave 3)** — Dashboard render multi-estado: badges, filtros `s:<state>`, footer-error host. Tests `dashboard-table.test.js` extendidos con fixtures multi-estado.
4. **Plan 38-04 (Wave 4)** — Reconciliación host ↔ state con debouncing. Tests `host/reconciliation.test.js`. `38-HUMAN-UAT.md` con 4 escenarios (2 retest Phase 37 + 2 nuevos). Logging NDJSON nuevos events. Cierre del milestone.

Cada plan tiene **2-4 tasks** (dimensión Phase 37). Estimación: 4 días-persona, ~12-15 commits totales.

## Open questions (research debe resolver)

1. **¿`cmux list-workspaces --json` existe?** — el `--help` que vimos en Phase 37 UAT muestra el verb `list-workspaces` pero no confirma flag `--json`. Si NO existe, el research debe documentar el parser textual (regex sobre `* workspace:N  Name [selected]`). Bloquea Plan 38-01.
2. **¿cmux expone `needs_input` vía socket?** — el badge `🔔 Needs input` que el operador vio en la GUI debe tener señal observable desde el CLI. Investigar `cmux docs api` y el socket API. Si NO está expuesto, TUI-19 needs-input state se queda como dead-letter (badge nunca se renderiza para cmux pero sí para hosts futuros). NO bloqueante para Plan 38-01 ni 02; afecta UX del Plan 38-03.
3. **¿`last_activity` está disponible?** — opcional pero deseable. Si cmux no lo expone, el dashboard usa fallback al `started_at` de kodo.

## Deferred ideas (post-Phase 38)

- `OrcaHost` impl (capture en backlog como 999.3 candidate).
- `kodo close-session <id>` CLI explícito para forzar transición `dead`/`idle` → `closed`.
- `kodo gsd doctor --clean-host-orphans` para limpiar sessions huérfanas masivas (combina con futuro `closeWorkspace`).
- Webhook del host (cmux push de events `needs_input` change vía socket subscribe) — eliminaría debouncing si el host empuja. Investigar feasibility tras Plan 38-04.

## Invariants preservados

- `TaskProvider 9-method contract` (v0.7 — hermano del nuevo `WorkspaceHost`, no reemplazo).
- `findSession dual-scan` (v0.8 Phase 30) — sigue cubriendo lookup retrospectivo.
- `markSessionStatus contrato non-throwing` (v0.8 Phases 30+33) — firma intacta, return discriminated union `{ok, reason}`.
- `Color isolation` (`picocolors` solo desde `src/cli/format.js`) — nuevo host no introduce color; usa `<Text color>` de ink en el dashboard.
- `Worktree always-on` (Phase 18) — el host no toca worktrees, ortogonal.
- Plug del dashboard Phase 34-37: alt-screen toggle (NO mutar líneas 129/155 de `index.js`), SIGTERM handler D-10 Phase 34, never-throws en runFocus, literal-stable messages D-05 Phase 37.
- `--json` byte-determinismo (DX-06) en logger NDJSON.
- LOG-12 walker (`kodo check` no carga `src/logger.js`) — el host no debe importarse desde `check.js`.

## Risk flags (PASS A PLAN — planner debe addressar)

- **Migración state.json destructive si schema bump no es idempotente** → backup automático ANTES de migrar (D-05) + test idempotence en `test/state/migration.test.js`.
- **Reconciliación puede causar flicker** (idle↔running rápido) → debouncing 2-tick (D-07) + test `test/host/reconciliation-debounce.test.js`.
- **Caller migration de `markSessionStatus(... 'done', ...)` puede romper test fixtures legacy** → compat shim 'done' → 'idle' con warn (D-12) hasta v0.10.
- **cmux JSON API uncertainty** (Open Q#1) → resuelve en research; si falta `--json`, parser textual con regex anclado al output observado en Phase 37 (`* workspace:N  Name [selected]`).

---

## Auto-decision log (`--auto` audit trail)

Cada línea registra: **[area]** — **Q:** "pregunta auto-generada" → **Selected:** "opción elegida" (razón).

```
[auto] [D-01 contract name] Q: "WorkspaceHost vs TerminalHostProvider vs WorkspaceProvider?" → Selected: "WorkspaceHost" (SEED.md default; simetría con TaskProvider).
[auto] [D-02 module path]   Q: "src/host/ vs src/workspace-host/ vs src/providers/host/?" → Selected: "src/host/" (SEED.md default; paralelo a src/providers/).
[auto] [D-03 API methods]   Q: "4 métodos mínimos o incluir closeWorkspace?" → Selected: "4 métodos (listWorkspaces/selectWorkspace/isAlive/needsInput); closeWorkspace deferred" (alcance estricto Phase 38, sellado por desaparición observada).
[auto] [D-04 lifecycle states] Q: "4 estados SEED (running/idle/needs-input/closed) o ampliar a 5 con `dead`?" → Selected: "5 estados con `dead` separado de `closed`" (proceso exit + tab ausente ≠ sellado terminal; permite recuperación si tab reaparece).
[auto] [D-05 schema migration] Q: "Backup obligatorio, idempotente, lazy en loadState()?" → Selected: "Sí a las 3" (risk flag SEED.md; default conservador).
[auto] [D-06 dashboard render] Q: "Glyphs ASCII puros (▶⏸✗) o emoji (🔔) mixto?" → Selected: "Mixto: ASCII para running/idle/dead, emoji 🔔 SOLO para needs-input" (needs-input es UX urgente; el emoji llama atención sin romper TTY no-color via `<Text>` fallback de ink).
[auto] [D-07 reconciliation cadence] Q: "Cada poll tick o timer separado?" → Selected: "Cada poll tick (sin nuevo timer)" (reusa infra Phase 35 con `setTimeout` recursivo; debouncing 2-tick para flicker).
[auto] [D-08 CmuxHost impl strategy] Q: "Reescribir o reutilizar runFocus + cmux/client.js?" → Selected: "Reutilizar — runFocus es el primitivo ya never-throws" (zero duplication; cmux/client.js se mantiene como helper interno usado por CmuxHost solo).
[auto] [D-09 style guard]   Q: "Walker estructural como color-isolation o solo grep CI?" → Selected: "Walker estructural test/host/cmux-isolation.test.js" (mismo patrón Phase 34 D-12; load-bearing para evitar leak).
[auto] [D-10 Orca/NullHost] Q: "Implementar OrcaHost en scope o follow-up?" → Selected: "Follow-up no bloqueante (capture al backlog); NullHost mock-only en tests" (alcance estricto; OrcaHost requiere su propio research).
[auto] [D-11 state dimensions] Q: "Mantener `alive` binario o exponer dimensiones independientes (process_alive/tab_alive/needs_input)?" → Selected: "Exponer dimensiones; mantener `alive` como derived field por compat" (cero breaking changes; permite invariantes finos).
[auto] [D-12 caller migration] Q: "Breaking change o compat shim 'done' → 'idle'?" → Selected: "Compat shim con log.warn, eliminado en v0.10" (Tier 3 risk — no romper verify.js/stop.js mid-flight).
[auto] [D-13 NDJSON events]  Q: "Logger events nuevos o reusar polling.tick?" → Selected: "4 events nuevos (host.list_workspaces.ok/fail, host.reconcile.tick, state.migration.v2_to_v3)" (taxonomía 19→23; sin coupling con polling existente).
[auto] [D-14 UAT re-corrida] Q: "Re-run Phase 37 UAT en plan-3 o plan-4?" → Selected: "Plan-3 (primer wire del Enter via host)" (catch parity drift early; ahorra retest en plan-4).
[auto] [D-15 plan split]    Q: "4 plans (SEED.md) o 3 condensando 03+04?" → Selected: "4 plans" (mantiene dimensión Phase 37; plan-3 puramente UI, plan-4 puramente backend; menor blast radius por plan).
```

---

**Next:** `/gsd-plan-phase 38` (auto-advance enabled via `--auto` mode).
