# Phase 46: Overlay del plan ligero para sesiones quick/non-GSD - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

El overlay de plan (`p`, Phase 44) gana un **fallback read-only**: cuando la fila seleccionada es **quick/non-GSD** (no resuelve a una fase GSD → hoy `readPlan` devuelve `no-phase`), lee el artefacto de **plan ligero** de Phase 45 (`~/.kodo/plans/<task_id>.md`) y lo muestra con la **misma UX** del overlay GSD: snapshot congelado al abrir, copy honesta por caso, `Esc` preserva el cursor por `task_id`, lectura never-throws. Cero endpoints nuevos en `src/server.js`; el overlay sigue read-only.

**Esto NO entrega:** la producción del artefacto (ya es Phase 45/PLAN-03, shipped), ningún endpoint nuevo, ninguna superficie read-write, ni cambios en la rama GSD del reader (filas con `phase_id` siguen leyendo su `PLAN.md` exactamente igual).

</domain>

<decisions>
## Implementation Decisions

### Ubicación del fallback
- **D-01:** El fallback vive **dentro de `readPlan` (`src/cli/dashboard/plan.js`)**, no en un reader separado ni en el handler `p` de `App.js`. `readPlan(row, deps)` ya es el único entry point que App.js invoca (`App.js:495`); extenderlo mantiene un solo overlay, un solo reader y un solo contrato de status. El handler `p` de App.js no cambia su forma (sigue `readPlan(row, { resolvePhaseFn })` + `setOverlaySnapshot`).

### Precedencia / cuándo dispara el fallback
- **D-02:** GSD tiene prioridad. El fallback de plan ligero corre **solo cuando `phaseId` queda `null`** tras intentar `row.phase_id` y el `resolvePhaseFn` inyectado (la rama que hoy retorna `{ status: 'no-phase' }` en `plan.js:69`). Una fila GSD con `phase_id` pero sin `PLAN.md` mantiene su `no-plan` actual — Phase 45 D-04 excluye GSD full/bootstrap de escribir el artefacto, así que **nunca** hay artefacto que mostrar para esas filas. El fallback no toca las ramas `no-plan`/`error`/`ok` del flujo GSD existente.
- **D-03:** Correlación por **`task_id`** (espejo de Phase 45 D-02). La fila ya lleva `row.task_id` (confirmado: `App.js:414` lo usa en `fetchComments`). Lookup directo: `~/.kodo/plans/${row.task_id}.md`. Si `row.task_id` es ausente/falsy, no se intenta el artefacto y se mantiene `no-phase` (defensivo).

### Taxonomía de status + copy honesta
- **D-04:** Se **añade un status nuevo** para el caso "sesión quick/non-GSD pero sin plan ligero escrito aún", con **copy propia** (NO se reusa `OVERLAY_PLAN_NO_PLAN = 'phase has no PLAN.md yet'`, que es GSD-specific y mentiría sobre una sesión quick). Respeta el contrato honest-copy de Phase 44 D-07 (el operador distingue de un vistazo "no es GSD" de "es quick pero aún no escribió plan"). Naming sugerido (a discreción del planner, literal a fijar): status `no-light-plan` → constante exportada tipo `OVERLAY_PLAN_NO_LIGHT = 'session has not written a plan yet'` (dim, igual matiz informativo que NO_PHASE/NO_PLAN, no rojo).
- **D-05:** Mapeo de resultados del fallback a status:
  - artefacto leído con contenido → **`ok`** (reusa el render plano existente; el markdown del artefacto se muestra línea a línea igual que un `PLAN.md`).
  - artefacto ausente (ENOENT) → **`no-light-plan`** (D-04, copy honesta nueva).
  - artefacto presente pero ilegible (EACCES/otros no-ENOENT) → **`error`** (reusa `OVERLAY_PLAN_ERROR = 'error reading plan'`, genérico y correcto).
  - sin `phase_id` Y sin `task_id` utilizable → **`no-phase`** (mantiene la copy GSD `OVERLAY_PLAN_NO_PHASE`).
- **D-06:** El `no-phase` "puro" (fila sin phase_id, sin task_id) sigue existiendo como caso terminal — el fallback **estrecha** cuándo aparece, no lo elimina.

### Resolución de ruta y pureza de plan.js
- **D-07:** `plan.js` importa **`homedir` de `node:os`** y computa la ruta inline: `join(homedir(), '.kodo', 'plans', \`${task_id}.md\`)`. `node:os` es builtin — mantiene `plan.js` como **leaf** del grafo (no rompe WARNING-01 ni la color-isolation D-12 de Phase 44, que solo prohíben importar módulos de render/color del proyecto). Mismo patrón que `src/config.js:4,6` (`KODO_DIR = join(homedir(), '.kodo')`). NO se importa `src/config.js` (evita acoplar el leaf a un módulo de config con otras dependencias); se replica la convención de ruta.
- **D-08:** **Testabilidad por DI:** se añade un override opcional en `deps` para aislar el HOME en tests (p. ej. `deps.kodoPlansDir` o `deps.homedirFn`, naming a discreción del planner). La lectura del artefacto reusa el patrón `deps.readFileFn` ya existente. Sin el override, el default es `homedir()` real. Mantiene `readPlan` puro y testeable sin tocar el HOME del runner.
- **D-09:** Anti-ReDoS (Phase 44 D-13) y never-throws (D-05) se preservan: el lookup del artefacto es una ruta **construida** (no derivada de input por regex) y va envuelto en try/catch propio; un fallo de lectura degrada a `error`/`no-light-plan`, jamás propaga a React. El `task_id` se interpola tal cual en el nombre de fichero — el planner debe confirmar que `task_id` no contiene separadores de ruta (guard de contención estilo WR-01 si hay duda, con `String.includes`, no RegExp).

### Claude's Discretion
- Literal exacto de la copy nueva (`OVERLAY_PLAN_NO_LIGHT` u otro nombre) dentro de los límites de D-04 — el contrato es "honesta y distinta de NO_PHASE/NO_PLAN", el wording exacto lo fija el planner/UI.
- Nombre exacto del status nuevo (`no-light-plan` u otro) y del override de deps (`kodoPlansDir`/`homedirFn`).
- Si el guard de contención de `task_id` (D-09) es necesario o redundante dado cómo se generan los `task_id` — el planner lo decide leyendo la forma real del `task_id`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Núcleo de la fase (sitio de edición)
- `src/cli/dashboard/plan.js` — El reader a extender. Contrato actual `readPlan(row, deps) → { status, lines }`, never-throws (D-05 Phase 44), anti-ReDoS (D-13 Phase 44), leaf-only (importa solo `node:fs`/`node:path`). La rama `plan.js:69` (`return { status: 'no-phase', lines: [] }`) es donde se inserta el fallback. El header del fichero documenta todos los invariantes a preservar.
- `src/cli/dashboard/App.js` — Consumidor. Handler `p` en `App.js:482-502` (llama `readPlan`, `setOverlaySnapshot`, `mode:'overlay'`). Copy constants exportadas en `App.js:110-112` (`OVERLAY_PLAN_NO_PHASE`/`NO_PLAN`/`ERROR`) — añadir aquí la constante nueva (D-04). `row.task_id` disponible (ver `App.js:414`).
- `src/cli/dashboard/SessionTable.js` — Render del overlay; importa las copy constants para matar el drift code/render (patrón Phase 44). El status nuevo necesita su rama de render aquí.

### Productor del artefacto (contrato de lectura)
- `~/.kodo/plans/<task_id>.md` — Ruta del artefacto (Phase 45 D-01). Markdown plano sin frontmatter (D-05 Phase 45), overwrite latest-wins (D-06 Phase 45). El overlay lo renderiza línea a línea igual que un `PLAN.md`.
- `src/config.js` §4,6 — Convención `homedir()` + `~/.kodo` a replicar (NO importar; replicar la forma, D-07).
- `src/hooks/session-start.js` — Escritor de la instrucción (Phase 45). No se edita; referencia para entender qué formato produce la sesión.

### Especificación y roadmap
- `.planning/REQUIREMENTS.md` — **PLAN-04** (esta fase, el fallback de lectura) y su preámbulo "Plan Overlay" (driver completo). PLAN-01/02 (overlay GSD base) y PLAN-03 (productor) como contexto.
- `.planning/ROADMAP.md` §"Phase 46" — Goal + 3 Success Criteria + Notes ("ya no es condicional/cuttable"). §"Phase 44"/"Phase 45" para el overlay base y el productor.
- `.planning/phases/45-inyecci-n-de-plan-ligero-universal/45-CONTEXT.md` — Decisiones del productor (ruta `~/.kodo/plans/<task_id>.md`, correlación por `task_id`, markdown sin frontmatter). `<canonical_refs>` apunta a `plan.js` como consumidor downstream.
- `.planning/phases/44-overlay-de-plan-gsd-pulido-de-dashboard/44-CONTEXT.md` `<deferred>` — diseño del overlay reusable para no-GSD (mismo `mode:'overlay'`, snapshot, copy honesta) — el origen de esta fase.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `readPlan(row, deps)` (`plan.js`): contrato y estructura ya existen; el fallback es una rama nueva antes del `return no-phase`, reusando `deps.readFileFn` para la lectura del artefacto.
- `mode:'overlay'` + `setOverlaySnapshot` + render de `lines[]` (App.js/SessionTable.js): toda la maquinaria de render, scroll, snapshot congelado y `Esc`-preserva-cursor ya está; el plan ligero entra como otro `{ status, lines }` por el mismo camino. CERO trabajo de UI nuevo salvo la rama de copy del status nuevo.
- Copy constants exportadas (`OVERLAY_PLAN_*`): patrón establecido para strings literal-estables compartidas code/render/tests.
- `homedir()` de `node:os` (patrón `config.js`).

### Established Patterns
- **Never-throws / best-effort (Phase 44 D-05):** toda lectura de fs envuelta; un error degrada a status, nunca propaga a React. El fallback hereda esto.
- **Anti-ReDoS (Phase 44 D-13):** matching con `String.startsWith/endsWith/includes`, cero RegExp derivado de input. La ruta del artefacto se construye, no se matchea.
- **Honest-copy por caso (Phase 44 D-07):** cada estado sin contenido tiene copy distinta y legible bajo NO_COLOR. El status nuevo extiende este contrato.
- **Leaf-isolation (WARNING-01 / color-isolation Phase 44 D-12):** `plan.js` solo importa builtins; el fallback mantiene esto (`node:os` es builtin).

### Integration Points
- Productor (Phase 45, `session-start.js` → la sesión escribe el fichero) y consumidor (este overlay) se acoplan **solo por la convención de ruta** `~/.kodo/plans/<task_id>.md` — sin endpoints, sin estado compartido en memoria. Contrato implícito filesystem, como `plan.js`↔`.planning/phases` y `focus.js`↔cmux.

</code_context>

<specifics>
## Specific Ideas

- La UX debe ser **indistinguible** de la del overlay GSD para el operador: misma tecla `p`, mismo snapshot congelado, mismo `Esc` que preserva cursor por `task_id`, mismo render plano de líneas. La única diferencia visible es la copy del estado vacío ("session has not written a plan yet" vs "phase has no PLAN.md yet").
- El render del artefacto es plano (sin tratar el markdown) — coherente con que Phase 45 D-05 lo produce sin frontmatter precisamente para que el overlay no necesite stripping.

</specifics>

<deferred>
## Deferred Ideas

- **Limpieza / retención de `~/.kodo/plans/`** — heredado de Phase 45 `<deferred>`: no hay purga de artefactos viejos (a diferencia de logs con retención 7 días). Candidato a higiene futura (`doctor`/cleanup). Fuera de scope de esta fase (solo lee).
- **Lista navegable multi-artefacto / multi-PLAN** — heredado de Phase 44: si el concatenado resultara incómodo, reconsiderar en pulido futuro. El plan ligero es un único fichero por `task_id`, así que no aplica multi-fichero aquí.
- **Frontmatter con metadata verificable** — descartado en Phase 45 D-05; reconsiderar solo si hiciera falta integridad explícita (añadiría stripping al overlay). No ahora.

None — la discusión se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 46-Overlay del plan ligero para sesiones quick/non-GSD*
*Context gathered: 2026-06-10*
