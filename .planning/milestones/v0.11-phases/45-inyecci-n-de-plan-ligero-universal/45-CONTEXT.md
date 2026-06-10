# Phase 45: Inyección de plan ligero universal - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Toda sesión kodo que hoy **no** produce un `PLAN.md` (sesiones **quick** y **non-GSD**) emite un artefacto de plan ligero a una ruta **propia de kodo y estable**, mediante una instrucción **inyectada en `session-start.js`**, correlacionada por `task_id`. kodo produce el artefacto **activamente** (no olfatea el plan nativo de Claude Code vía hooks — enfoque descartado el 2026-06-09 por frágil/version-specific). El artefacto lo consume el overlay de Phase 46 (PLAN-04) como fallback read-only.

**Esto NO entrega:** el overlay que lo muestra (Phase 46), captura del plan nativo de Claude Code, ni nuevos endpoints en `src/server.js`.

</domain>

<decisions>
## Implementation Decisions

### Ruta del artefacto
- **D-01:** El plan ligero se persiste en `~/.kodo/plans/<task_id>.md` (kodo home, fuera del repo). Elegido sobre in-repo porque: (a) es resoluble idénticamente por el hook que escribe y por el overlay que lee, a partir del `task_id` que la fila ya lleva — sin depender de `worktree_path`; (b) sobrevive al cleanup de worktrees (`doctor`/`reconcile` eliminan `.bg-shell/<sessionId>`); (c) cero ruido en `git status` (las sesiones non-GSD ni tienen `.planning/`); (d) reusa la convención `~/.kodo/` existente (`logs/`, `polling-state.json`, `config.json` — ver `src/config.js:6` `KODO_DIR = join(homedir(), '.kodo')`).
- **D-02:** Correlación por **`task_id`** (no `session_id`). El overlay correlaciona filas por `task_id` (selección por identidad, cursor por `task_id`); keyear por `task_id` hace el lookup del fallback en Phase 46 directo: `~/.kodo/plans/${row.task_id}.md`.
- **D-03:** La creación del directorio `~/.kodo/plans/` la hace la **sesión** al escribir el fichero (el tool Write de Claude crea parents). El hook NO pre-crea el directorio — solo inyecta la instrucción con la ruta absoluta resuelta.

### Alcance de inyección
- **D-04:** Reciben la instrucción exactamente dos rutas de código: (a) `buildSessionContext` **entero** (todas las sesiones non-GSD); (b) la rama `mode === 'quick'` de `buildGsdContext` (sesiones `/gsd-quick`). Las ramas **phase** (`session.phase_id`) y **bootstrap** de `buildGsdContext` se **excluyen** — la GSD full ya escribe su `PLAN.md` de fase. Bootstrap queda fuera conscientemente (cuando resuelva fase, GSD genera su plan); ampliarla excedería PLAN-03.

### Formato y escritura
- **D-05:** Contenido en **markdown simple, sin frontmatter**. Contenido libre y corto: una línea de objetivo + pasos previstos (qué se va a hacer). Sin YAML frontmatter porque (a) el overlay (`plan.js`/Phase 46) renderiza las líneas **planas** y un bloque `---` se vería como ruido crudo; (b) la correlación ya vive en el nombre de fichero `<task_id>.md` — duplicarla en YAML es redundante y obligaría a Phase 46 a añadir lógica de stripping.
- **D-06:** Semántica **overwrite al empezar** (latest-wins). La sesión escribe el plan una vez al inicio; un re-dispatch de la misma task sobrescribe el fichero. Coherente con la UX snapshot-at-open del overlay. NO write-once (mostraría un plan viejo en re-runs) ni append (acumularía bloques stale, crecimiento sin límite).

### Fuerza / wording de la instrucción
- **D-07:** Tono **imperativo de una sola línea**, sin ceremonia — mantiene quick ligero (no contradice el "one-shot, sin plan/execute/verify") pero garantiza que el artefacto exista de forma fiable (descartado el tono opcional/suave: Claude lo saltaría a menudo y el overlay mostraría "sin plan" la mayoría de las veces; descartado el multi-paso/enfático: añade ceremonia incompatible con quick).
- **D-08:** **Coherencia idiomática por bloque:** la instrucción en `buildSessionContext` va en **español** (el bloque non-GSD es ES); la instrucción en la rama quick de `buildGsdContext` va en **inglés** (D-04 Phase 8: bloque GSD en EN). Redacción del tipo "Además, escribe un plan corto (qué vas a hacer + pasos) en `~/.kodo/plans/<task_id>.md`." / equivalente EN "Also, write a short plan (what you'll do + steps) to `~/.kodo/plans/<task_id>.md`."
- **D-09:** La redacción debe ser **complementaria, no duplicada**, respecto al flujo existente. El bloque non-GSD ya pide "**1. Al empezar** — comenta tu plan de acción" (eso es un **comentario al provider** vía MCP). La instrucción nueva es **escribir un fichero local** para el dashboard — redactarla como "además/also" para que no se confunda con el comentario al provider.

### Claude's Discretion
- Posición exacta del bloque nuevo dentro de cada builder (debe ser **append al final** para preservar golden-bytes — ver canonical refs HOOK-02), y la mecánica precisa de interpolar la ruta absoluta (`join(homedir(), '.kodo', 'plans', \`${session.task_id}.md\`)`) en el string inyectado.
- Microcopy exacta de la instrucción (longitud, si incluye un mini-ejemplo de estructura) — dentro de los límites de D-05/D-07/D-08/D-09.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Mecanismo de inyección (núcleo de la fase)
- `src/hooks/session-start.js` — Sitio único de edición. `buildSessionContext` (líneas ~23-80, bloque non-GSD ES) y `buildGsdContext` (líneas ~95-183, rama quick en ~109-133). El patrón golden-bytes está documentado inline: "append al FINAL del array preserva golden bytes anteriores (HOOK-02 satisfied-by-construction)" (líneas 29-30, 166-168).
- `src/session/state.js` — `Session` typedef (líneas ~12-39): campos `task_id`, `session_id`, `project_path`, `worktree_path?` (opcional, `.bg-shell/<sessionId>`). `findSession` sintetiza `id = session.task_id`.
- `src/config.js` §6 — `KODO_DIR = join(homedir(), '.kodo')`. Convención de la ruta propia de kodo a reusar.

### Consumidor downstream (para no romper el contrato de lectura)
- `src/cli/dashboard/plan.js` — Reader del overlay GSD (Phase 44). Phase 46 añadirá el fallback que lee `~/.kodo/plans/<task_id>.md` cuando la fila no tiene `phase_id`. Contrato never-throws / best-effort y anti-ReDoS (`String.includes`, no `RegExp`) que el artefacto debe respetar en su consumo.

### Especificación y roadmap
- `.planning/REQUIREMENTS.md` — **PLAN-03** (este fase) y **PLAN-04** (Phase 46, el overlay que consume el artefacto). Driver completo en el preámbulo de la sección Plan Overlay.
- `.planning/ROADMAP.md` §"Phase 45" — Goal + 3 Success Criteria + Notes (pivote 2026-06-09). Phase 46 §"Phase 46" para entender al consumidor.
- `.planning/phases/44-overlay-de-plan-gsd-pulido-de-dashboard/44-CONTEXT.md` `<deferred>` — diseño del overlay reusable para no-GSD (mismo `mode:'overlay'`, snapshot, copy honesta).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildSessionContext` / `buildGsdContext` (`src/hooks/session-start.js`): funciones **puras** (no I/O, fully testable) que devuelven el string inyectado. La instrucción nueva se añade como elemento(s) del array que se `.join('\n')`.
- `session.task_id` (siempre presente en sesiones trackeadas; `findSession` lo usa como identidad) → key del artefacto.
- `homedir()` de `node:os` (ya importado en `src/config.js`, `src/logger-events.js`) → base de la ruta.

### Established Patterns
- **Golden-bytes / HOOK-02:** los bloques existentes tienen bytes pineados por tests. La adición debe ser **append al final** de cada array de líneas, sin alterar los bloques previos (las ramas non-quick de `buildGsdContext` deben quedar byte-idénticas).
- **Bifurcación por modo:** `getSessionMode(session)` distingue quick; `session.gsd` distingue GSD vs non-GSD en `main()` (línea ~212). El reparto D-04 se apoya en esa bifurcación ya existente (Phase 12).
- **Pureza testeable:** los builders no hacen I/O — la ruta se computa e interpola dentro del builder (o se pasa como dato), manteniéndolos puros para test.

### Integration Points
- La instrucción inyectada (escritura) y el overlay de Phase 46 (lectura) se acoplan **solo por la convención de ruta** `~/.kodo/plans/<task_id>.md` — sin endpoints, sin estado compartido en memoria. Contrato implícito filesystem, como `focus.js`↔cmux y `plan.js`↔`.planning/phases`.

</code_context>

<specifics>
## Specific Ideas

- Wording de referencia acordado (microcopy final a discreción del planner dentro de estos límites):
  - **ES (non-GSD):** "Además, escribe un plan corto (qué vas a hacer + pasos previstos) en `~/.kodo/plans/<task_id>.md`."
  - **EN (quick):** "Also, write a short plan (what you'll do + planned steps) to `~/.kodo/plans/<task_id>.md`."
- La ruta mostrada al modelo debe ser **absoluta y resuelta** (homedir expandido + task_id real), no el literal `<task_id>`.

</specifics>

<deferred>
## Deferred Ideas

- **Limpieza / retención de `~/.kodo/plans/`** — no se discutió mecanismo de purga de artefactos viejos (a diferencia de los logs con retención 7 días). Candidato a futura higiene si el directorio crece; fuera de scope de PLAN-03 (que solo produce el artefacto). Notar para `doctor`/cleanup futuro.
- **Frontmatter con metadata verificable** (task_id/session_id) — descartado para Phase 45 (D-05) por el render plano del overlay; reconsiderar solo si Phase 46 necesitara integridad explícita y añadiera stripping.
- **Overlay que muestra el artefacto** → Phase 46 (PLAN-04), ya en roadmap.

None — la discusión se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 45-Inyección de plan ligero universal*
*Context gathered: 2026-06-10*
