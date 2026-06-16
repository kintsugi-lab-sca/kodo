# Phase 52: createTask + contrato + anti-recursión - Context

**Gathered:** 2026-06-16
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 52 entrega **`createTask`** como método **opcional typeof-detected** en los DOS adapters (Plane + GitHub), preservando el contrato `TASK_PROVIDER_METHODS` FROZEN en 9, **más** el guard de **anti-recursión** (BIDIR-06) que viaja junto al método como propiedad de corrección del núcleo (precedente: la anti-recursión `kodo:gsd-child` shipped *con* el reporting en Phase 29, no después).

**En scope:**
- `client.createWorkItem` (Plane) + `client.createIssue` (GitHub) — transporte POST, ~6 líneas c/u reusando `request()`.
- `provider.createTask` typeof-detected en ambos `provider.js` (FUERA de los 9 FROZEN), normalizando el 201 a `TaskItem` canónico.
- Anti-recursión: `KODO_LABEL_ADOPTED` (`kodo:adopted`) + helper `isAdopted(labels)` en `labels.js` + corte en `dispatcher.js` espejo de `isGsdChild`.
- Test capability-gated en `contract.test.js` (espejo B8 `getTaskState`).

**FUERA de scope (límites con otras fases):**
- `adoptSession` + escritura en `state.json` → **Phase 53** (`createTask` es invocado *por* la fontanería de la 53; aquí solo se entrega el método).
- CLI `kodo adopt` → Phase 54 · tecla dashboard → Phase 56 · orquestador → Phase 57.
- La selección de proyecto destino / título / sanitización → Phase 53 (BIDIR-08). Phase 52 recibe esos datos ya resueltos como argumentos de `createTask`.
</domain>

<decisions>
## Implementation Decisions

### Anti-recursión (BIDIR-06) — doble capa
- **D-01 (capa primaria, naturalmente segura):** `createTask` crea la tarea adoptada **SIN ningún label trigger de kodo** (`kodo:gsd` / `kodo:gsd-quick`). El dispatcher solo lanza si `parseKodoLabels(...).isKodo === true` (`dispatcher.js:77-80`); sin label trigger, la tarea adoptada **nunca** se despacha. El lever del anti-redispatch es el **label ausente**, no un estado pasivo.
- **D-02 (defensa en profundidad, sobrevive `--force`):** `createTask` aplica un marker `kodo:adopted` y se añade un corte `isAdopted(task.labels)` en `dispatcher.js` que descarta **ANTES** de lock/resolver/launch, espejo exacto del guard `isGsdChild` (`dispatcher.js:68`, que corta incluso bajo `opts.force`). Protege el caso de que alguien añada manualmente un label trigger después, o se use `--force`. Constante `KODO_LABEL_ADOPTED = 'kodo:adopted'` + helper `isAdopted` en `src/labels.js`, con source-hygiene anti-inline (espejo de `KODO_LABEL_GSD_CHILD` / `isGsdChild`). El mismo marker hace además la **procedencia** de la tarea visible/filtrable (origen = sesión adoptada) — señal honesta, no solo guard (rationale, sin paso de build propio).

### Estado inicial de la tarea creada
- **D-04:** la tarea se crea en estado **in-progress / activo** (el `trigger`/in-progress configurado del provider en Plane; en GitHub la issue queda simplemente `open`), porque **refleja la realidad**: el humano ya está trabajando en esa sesión ad-hoc. NO se crea en `Backlog`/estado pasivo. Esto resuelve la Open Question de STATE.md: la garantía "no re-despachada" viene del **label ausente + marker** (D-01/D-02), no de un estado inactivo. (Nota: el `dispatcher.js:108-118` ignora `Backlog`+`review`, pero NO dependemos de eso para la anti-recursión.)

### Payload de `createTask` + normalización
- **D-05:** los nuevos métodos de transporte espejan EXACTAMENTE el POST autenticado existente (`createComment`/`addComment`): mismo `request()`, misma auth ya presente (`X-API-Key` en Plane, PAT en GitHub). Plane: `POST .../projects/{id}/work-items/`, `name` required, body `description_html`. GitHub: `POST /repos/{o}/{r}/issues`, `title` required, body **Markdown** (divergencia ya conocida del split de `addComment`).
- **D-06:** el 201 se normaliza de vuelta a `TaskItem` por los normalizers EXISTENTES (`normalizeWorkItem` / `normalizeIssue`), de modo que el `TaskItem` devuelto es **shape-idéntico** a uno fetcheado — Phase 53 (`adoptSession`) consume un `TaskItem` canónico sin caso especial. `task_id`: Plane `${identifier}-${sequence_id}`, GitHub `number`. `url`: Plane `web_url`/browse-URL (cableado en v0.12 Phase 48), GitHub `html_url`.

### Test del método opcional (sin romper FROZEN-9)
- **D-07:** un `it()` capability-gated en `test/providers/contract.test.js` espejo del test B8 de `getTaskState` (~`contract.test.js:498`): asserta que `createTask` es función cuando el adapter lo soporta, que **NO** está en `TASK_PROVIDER_METHODS` (el loop de validación de `registry.js` queda intacto), y que un 201 mockeado round-trippea a un `TaskItem` canónico. El endpoint **Plane CE** real se valida con un POST manual de ~5 min al inicio de la fase (research flag — único ítem MEDIUM-confidence).

### Scope del PAT de GitHub
- **D-08:** documentar `issues:write` (fine-grained) / `repo` (classic) como scope mínimo. `createTask` falla **LOUD** ante 403/404 (scope insuficiente / repo inexistente) con mensaje claro — nunca silencioso (never-throws es para los carriles de lectura, no para una mutación que el operador acaba de pedir).

### Claude's Discretion
- Nombres internos exactos de los métodos de cliente (`createWorkItem`/`createIssue` sugeridos).
- La taxonomía exacta de strings `code` de error de `createTask` — se coordina con el discriminante `{ok:false, code, detail}` de la fontanería en Phase 53; aquí basta con que los errores propaguen con contexto.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — BIDIR-01 (createTask Plane), BIDIR-02 (createTask GitHub), BIDIR-06 (anti-recursión). Fuente de verdad del scope.
- `.planning/ROADMAP.md` §"Phase 52" — goal + success criteria.

### Research v0.13 (grounded en código real)
- `.planning/research/ARCHITECTURE.md` — wiring de `createTask` (mirror `getTaskState` Phase 40), build order, integración.
- `.planning/research/STACK.md` — endpoints verificados Plane CE `POST .../work-items/` + GitHub `POST .../issues`, shapes del 201, scope PAT, "cero deps nuevas".
- `.planning/research/PITFALLS.md` — pitfall #1 (auto-recursión, `shouldDispatch`/`classifyPattern`/`isGsdChild`) + FROZEN-9 / 0-token.

### Decisiones de proyecto (no hay ADRs separados; viven en PROJECT.md)
- `.planning/PROJECT.md` §"Key Decisions" + §"Constraints" — contrato FROZEN en 9, `getTaskState` como precedente de método opcional, "kodo no elimina tareas", 0-token.

No hay specs/ADRs externos — kodo no usa un sistema de ADR separado; las decisiones canónicas viven en PROJECT.md y en este CONTEXT.md.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/providers/plane/provider.js:235-263` (`getTaskState`) — **el precedente EXACTO de método opcional** a espejar. El comentario línea 235-236 (*"OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13). Detected at the call site via `typeof`"*) es la plantilla literal para `createTask`.
- `src/providers/plane/client.js` (`createComment`) + `src/providers/github/client.js` (`addComment`) — el transporte POST autenticado a espejar (~6 líneas c/u, mismo `request()`).
- `src/providers/plane/normalize.js` (`normalizeWorkItem`) + `src/providers/github/normalize.js` (`normalizeIssue`) — reusar para el 201 → `TaskItem` canónico.
- `src/labels.js` (`KODO_LABEL_GSD_CHILD`, `isGsdChild`, `parseKodoLabels`) — espejar para `KODO_LABEL_ADOPTED` + `isAdopted`.
- `test/providers/contract.test.js:~498` (B8 `getTaskState` capability-gated) — espejar para el test de `createTask`.

### Established Patterns
- **Contrato FROZEN en 9** (`src/interface.js:52`, `TASK_PROVIDER_METHODS` `Object.freeze`): los métodos opcionales se detectan por `typeof provider.X === 'function'` en el call site, **nunca** se añaden a la lista. El loop de validación de `registry.js` itera SOLO los 9 — debe quedar intacto.
- **Anti-recursión por corte temprano** (`dispatcher.js:63-71`): el guard se evalúa ANTES de `parseKodoLabels` / lock / resolver / launch, y **`--force` no lo bypasea**. `isAdopted` se inserta con el mismo patrón (justo después o junto a `isGsdChild`).
- **Gate de dispatch por label** (`dispatcher.js:73-81`): sin label trigger kodo → `action: 'ignored'`. Esta es la capa primaria de la anti-recursión.

### Integration Points
- `dispatcher.js` — nuevo corte `isAdopted(task.labels)` (espejo `isGsdChild`).
- `provider.createTask` será invocado por `adoptSession` (Phase 53) vía `typeof`-gate. Phase 52 NO escribe el caller — solo entrega el método, el test y el guard.
</code_context>

<specifics>
## Specific Ideas

- El marker `kodo:adopted` cumple doble función: (1) defensa anti-recursión bajo `--force`, (2) procedencia honesta (esta tarea nació de una sesión adoptada, no de un flujo normal). Mantenerlo como label real, no solo como convención implícita.
- Reconciliar conscientemente el Out of Scope histórico de PROJECT.md ("kodo no crea ni elimina tareas"): v0.13 introduce el **create** (no el delete). El delete sigue prohibido — un huérfano de proveedor se resuelve por re-run idempotente (Phase 53), nunca por borrado.
</specifics>

<deferred>
## Deferred Ideas

- **`adoptSession` + escritura en `state.json`** (idempotencia/double-adopt, atomicidad LOUD, datos sanitizados) → **Phase 53** (BIDIR-03/04/05/08). `createTask` es la pieza de transporte que la 53 consume.
- **Selección de proyecto destino / título auto-derivado / sanitización** → Phase 53 (BIDIR-08). Phase 52 recibe `{ projectId, title, description? }` ya resueltos.
- **CLI `kodo adopt`** → Phase 54 · **tecla dashboard** → Phase 56 (gated por spike 55) · **orquestador asistido** → Phase 57.

None — la discusión se mantuvo dentro del scope de la fase.
</deferred>

---

*Phase: 52-createtask-contrato-anti-recursión*
*Context gathered: 2026-06-16*
