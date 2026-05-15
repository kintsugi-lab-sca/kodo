# Phase 24: GitHubProvider + Normalizer + Registry - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Implementar el adaptador `TaskProvider` completo para GitHub Issues — los 9 métodos del contrato canonical de `src/interface.js`, un normalizer puro `GitHub Issue → TaskItem`, y la factory function en `src/providers/registry.js`. La fase consume `GitHubClient` (Phase 23) y produce un provider que satisface el gate de validación `TASK_PROVIDER_METHODS` para que `getProvider('github')` no explote en runtime. Cubre GH-02, GH-03, GH-04, GH-05 y TEST-01.

**Scope-anchor:**
- `src/providers/github/provider.js` — factory `createGitHubProvider(config, opts?)`, 9 métodos.
- `src/providers/github/normalize.js` — `normalizeIssue(issue, context)` puro + helpers de extracción.
- `src/providers/registry.js` — añadir factory `github` (mirror del bloque `plane` líneas 25-38).
- `test/providers/github/{provider,normalize}.test.js` + fixtures adicionales en `test/fixtures/github/`.

**Out of scope (esta fase):**
- Polling loop, state cache (etag persistente), `dispatchTrigger` desde polling → Phase 25 (POLL-01..04).
- Config wizard, schema `providers.github` real, daemon CLI → Phase 26 (CFG-01..04). Phase 24 ASUME el schema disponible (mismo patrón que Phase 23 asumió `api_key_env`); tests inyectan config directo.
- Cross-provider contract matrix → Phase 27 (TEST-03).
- Webhook GitHub ingress y `parseTriggerEvent`/`verifySignature` reales — v0.7 polling-only; ambos métodos son no-op (`null`/`false`).
- Modificar `src/labels.js` (GH-05 invariante: zero cambios).
- Añadir eventos NDJSON nuevos a `src/logger-events.js` (Phase 23 ya cerró `github.api.call`/`github.api.call.failed`).

</domain>

<decisions>
## Implementation Decisions

### Contrato del Provider (BLOQUEANTE — resuelto)

- **D-01:** `GitHubProvider` implementa los **9 métodos REALES de `src/interface.js`**: `init`, `getTask`, `updateTaskState`, `addComment`, `listPendingTasks`, `parseTriggerEvent`, `verifySignature`, `resolveRef`, `listProjects`. **NO** los métodos descritos en ROADMAP Phase 24 SC#1 (`listTasks`, `listLabels`, `listStates`, `transitionTask`), que son fantasía del roadmapper. La validación en `registry.js:73-77` solo deja pasar lo que está en `TASK_PROVIDER_METHODS`. **Acción:** actualizar `.planning/ROADMAP.md` §Phase 24 SC#1 + `.planning/REQUIREMENTS.md` §GH-02 para reflejar el contrato real ANTES de planificar.
- **D-02:** Factory function `createGitHubProvider(config, opts?)` — mirror exacto de `createPlaneProvider` (`src/providers/plane/provider.js:24`). El registry hace lazy init y singleton caching ya implementados (sin cambios en lógica del registry, solo añadir el `factories.set('github', ...)` block).

### Module Shape & Style

- **D-03:** Archivos: `src/providers/github/provider.js` + `src/providers/github/normalize.js`. NO crear `labels.js` (parseKodoLabels de `src/labels.js` se usa directo, GH-05 invariante).
- **D-04:** `// @ts-check` + JSDoc en todos los exports públicos (convención repo CONVENTIONS.md).
- **D-05:** El provider construye un `GitHubClient` privado en el factory (mirror provider.js:26-31) usando `config.providers.github.{base_url, api_key_env}`. El cliente recibe el `logger.child({component: 'github'})` para que NDJSON `github.api.call` lleve component tag correcto.

### Normalizer (GH-03)

- **D-06:** `normalizeIssue(issue, context)` es **función pura** — cero API calls, cero side effects. Mirror `normalizeWorkItem` (`src/providers/plane/normalize.js:64`). Context shape: `{ projectId: 'owner/repo', baseUrl?: string }` (baseUrl solo para tests con server fake).
- **D-07:** `TaskItem.id` = `issue.node_id` (string opaco GitHub). El `node_id` es estable y distinto de `issue.id` (numérico, repo-scoped) — usamos `node_id` por estabilidad cross-rename y para mantener `id` opaco como contrato del interface.
- **D-08:** `TaskItem.ref` = `<owner>/<repo>#<number>` (REQ GH-03 literal). Owner/repo viene del context (no del issue payload — GitHub embebe `repository_url` que es parseable pero indirecto).
- **D-09:** `TaskItem.title` = `issue.title`.
- **D-10:** `TaskItem.description` = `issue.body || ''` — **Markdown crudo, sin strip**. GitHub devuelve Markdown directamente útil para el LLM. Plane stripea HTML por necesidad (su API devuelve HTML); GitHub no necesita esa transformación. Body null/undefined → string vacío.
- **D-11:** `TaskItem.labels` = `issue.labels.map(l => l.name)`. Los issue payloads de GitHub embeben `{id, node_id, name, color, ...}` por label — extraer solo `name`. No usar `labels[].name` directo sin `.map` porque algunos endpoints devuelven strings (raro pero documentado).
- **D-12:** `TaskItem.projectId` = `context.projectId` (= `owner/repo`). REQ GH-03 lock-in.
- **D-13:** `TaskItem.projectName` = `context.projectId` (mismo string `owner/repo`). GitHub no tiene "project name" distinto del slug; reusar el slug es simétrico con Plane donde `projectName` viene de `project_detail.name`.
- **D-14:** `TaskItem.groups` = `[]` (hardcoded). Cierra la open question del STATE.md sobre milestone: **NO se extrae**. GitHub no tiene "modules" análogos a Plane; milestone es opcional, raro, y mezclar semánticas (milestone temporal vs assignee humano) confunde. Si emerge necesidad en v0.8+, añadir entonces.
- **D-15:** `TaskItem.url` = `issue.html_url` (REQ GH-03 literal). GitHub lo embebe en cada payload.
- **D-16:** `TaskItem.state` = `issue.state` literal (`'open'` o `'closed'`). **Sin transformación.** El dispatcher (`src/triggers/dispatcher.js:83-88`) ya es config-driven — con `config.providers.github.states.done='closed'` (Phase 26 CFG-02) la comparación case-insensitive matchea sin ningún mapeo intermedio.
- **D-17:** `TaskItem.priority` extracción: scan `issue.labels[].name` buscando prefix `priority:`. Valores aceptados: `urgent`, `high`, `medium`, `low` (matcheando `VALID_PRIORITIES`). **Sin aliases** (`p0`, `critical`, `blocker` ignorados). Match case-insensitive. Si no hay match o el valor no está en la whitelist → `null` (simétrico Plane, valida contrato Phase 27 TEST-03 cross-provider).
- **D-18:** El normalizer NO toca milestone, assignees, pull_request, draft, locked, comments_count, created_at, updated_at, closed_at, reactions, user (autor), state_reason — todos campos GitHub-only que NO entran en `TaskItem` (zero fugas del shape canonical, REQ GH-03 lock).

### Provider Methods (los 9 reales)

- **D-19:** `async init()` = **no-op completo** (`async init() {}`). GitHub no requiere cache porque: (a) labels embedded en cada issue payload como objects con `.name` (no UUIDs por resolver), (b) states son `'open'`/`'closed'` fijos, (c) sin modules análogos. El registry valida que `init` exista como función — no-op cumple. Karpathy R2 (simplicity).
- **D-20:** `async getTask(ref)` — parsea `ref` con `parseRef(ref)` (helper privado regex strict), llama `client.getIssue(owner, repo, number)`, devuelve `normalizeIssue(issue, {projectId: 'owner/repo'})`. Si el issue no existe → propagar el `Error` con `.code='not_found'` que ya lanza el cliente (D-12 de Phase 23).
- **D-21:** `async resolveRef(humanRef)` — parsea `humanRef` con `parseRef`, llama `client.getIssue(owner, repo, number)`, devuelve `issue.node_id`. Mirror PlaneProvider:243-249. Si parseRef falla → throw `Error('Invalid GitHub ref: ${ref}. Expected owner/repo#number')` (mensaje formato fijo para grep en logs).
- **D-22:** `parseRef(ref)` privado, regex `^([^/]+)\/([^#]+)#(\d+)$` con captura `{owner, repo, number}`. **Sin tolerancia** a variaciones (`#N` sin repo, URL completa, `/issues/N`). Si emerge demand, añadir en v0.8+.
- **D-23:** `async updateTaskState(task, stateName)` — lee `config.providers.github.states[<key>]` donde key se infiere reverso (busca qué entrada del `states` map tiene valor = stateName). Si el config dice `states: {trigger:'open', review:'closed', done:'closed'}`, llamando `updateTaskState(task, 'closed')` → PATCH `state:'closed'`. Llamar con un valor que no aparece en el config → throw `Error('Unknown state: ${stateName}. Configured: ${availableStates}')`.

  **Implementación concreta:** acepta directamente `'open'`/`'closed'` (passthrough) Y también nombres lógicos del config si están definidos. Pattern:
  ```js
  const ghState = stateName === 'open' || stateName === 'closed'
    ? stateName
    : Object.values(config.providers.github.states || {}).includes(stateName)
      ? stateName  // already 'open'/'closed'
      : throw...;
  await client.updateIssue(owner, repo, number, { state: ghState });
  ```
  En la práctica, los callers (`verify.js`, dispatcher) leen `config.providers.github.states.review` antes y pasan el valor resuelto — el provider hace passthrough hard. Si Phase 26 schema queda `{trigger:'open', review:'closed', done:'closed'}`, todos los callers pasan `'open'` o `'closed'` directo.
- **D-24:** `async addComment(task, markdownText)` — extrae `{owner, repo, number}` de `task.ref` (parseRef sobre `task.ref`) y llama `client.addComment(owner, repo, number, markdownText)`. GitHub acepta Markdown nativo (a diferencia de Plane que requiere HTML), así que NO se aplica el `<p>...<br></p>` wrap de PlaneProvider:183. Markdown va literal.
- **D-25:** `async listPendingTasks()` — itera `config.providers.github.repos` (array `[{owner,repo}]`), por cada uno llama `client.listIssues(owner, repo, {labels:['kodo'], state:'open'})`, normaliza cada issue con `normalizeIssue(issue, {projectId: '${owner}/${repo}'})`, concatena. **Sin etag persistente** (esa optimización vive en Phase 25 polling-state.json). El filter `labels=kodo` se hace server-side (GitHub query string `labels=kodo` → AND-match: incluye issues que tengan `kodo` + cualquier label adicional).
- **D-26:** `parseTriggerEvent(rawPayload)` → `null` siempre. GitHub no usa webhook en v0.7 (REQUIREMENTS §Out of Scope). `webhook.js` consume este método solo en el path HTTP webhook (que no se activa para GitHub).
- **D-27:** `verifySignature(rawBody, headers)` → `false` siempre. Mismo motivo que D-26.
- **D-28:** `async listProjects()` — devuelve `config.providers.github.repos.map(r => ({id: '${r.owner}/${r.repo}', identifier: '${r.owner}/${r.repo}', name: '${r.owner}/${r.repo}'}))`. **Cero API calls.** Los 3 campos del shape `{id, identifier, name}` se duplican porque GitHub no tiene "nombre humano" separado del slug. Si Phase 26 wizard quiere enriquecer (e.g. con `repo.description`), llamará al client directo — NO entra en el contrato del provider.

### Registry (GH-04)

- **D-29:** Añadir bloque en `src/providers/registry.js:registerDefaults` después del `factories.set('plane', ...)` block. Patrón idéntico:
  ```js
  const { createGitHubProvider } = await import('./github/provider.js');
  factories.set('github', () => {
    const config = loadConfig();
    const github = config.providers.github;
    return createGitHubProvider(github, { logger: /* ... */ });
  });
  ```
  El logger no se construye en el registry (precedente PlaneProvider lo recibe en opts). El `verify.js` y consumidores pasan logger desde su scope; en `listPendingTasks` legacy paths sin logger, el provider emite no-op via optional chain (mismo patrón Plane).
- **D-30:** Phase 24 NO requiere cambios en `registry.js` lógica fuera de añadir la entry del `github` factory. La validación `TASK_PROVIDER_METHODS` ya cubre el gate (D-01 garantiza los 9 métodos).
- **D-31:** Phase 24 NO modifica `src/config.js`. El factory llama `loadConfig()` y accede `config.providers.github`. Si la clave no existe (config v0.6 sin GitHub), el access devuelve `undefined` y el constructor del `GitHubClient` falla con mensaje canónico. Comportamiento aceptable: Phase 24 verde implica config con `github` presente.

### Labels (GH-05)

- **D-32:** **Cero cambios en `src/labels.js`.** `parseKodoLabels` opera sobre `Array<{name: string}>` provider-agnostic; el dispatcher (`src/triggers/dispatcher.js:65,74`) lo invoca con `task.labels.map(name => ({name}))`. Los labels que vienen de GitHub Issue ya son strings tras la normalización (D-11), así que el mapeo a `{name}` funciona idéntico a Plane.

### Tests (TEST-01)

- **D-33:** Test file structure:
  - `test/providers/github/normalize.test.js` — unit tests del normalizer, fixtures JSON.
  - `test/providers/github/provider.test.js` — contract tests de los 9 métodos.
- **D-34:** Las fixtures de Phase 23 (`test/fixtures/github/{issue.json, issues-list.json, comment-created.json, labels-list.json, ...}`) se reutilizan donde aplica. **Fixtures nuevos Phase 24:**
  - `test/fixtures/github/issue-with-priority.json` (label `priority:high`)
  - `test/fixtures/github/issue-with-kodo.json` (labels `kodo` + `kodo:sonnet`)
  - `test/fixtures/github/issue-closed.json` (state='closed' para listPendingTasks edge)
  - `test/fixtures/github/issue-no-body.json` (body=null para D-10 default)
  - `test/fixtures/github/issue-no-labels.json` (labels=[] para parseKodoLabels edge)
- **D-35:** Cobertura ≥ 90% branches del normalizer (REQ TEST-01). Branches críticas a cubrir: priority extraction (urgent/high/medium/low + miss + invalid value), body null vs string, labels array vs empty, state open/closed, id mapping (node_id vs id), groups siempre `[]`.
- **D-36:** Provider tests inyectan `fakeClient` (mock del GitHubClient con métodos stub) en `createGitHubProvider(config, {client: fakeClient})`. **Acción:** añadir `opts.client?` al factory para permitir inyección sin tener que mockear globalThis.fetch. Si no se inyecta, construye `new GitHubClient(...)` normal. Esto facilita testing del provider sin reentrar en la suite del cliente (que ya tiene 15 tests Phase 23 verdes).
- **D-37:** Zero live API calls (`assert.fail` si fakeClient no se inyecta y se intenta tocar `api.github.com`). Mismo principio que TEST-02 (Phase 25).
- **D-38:** Registry test (`test/registry.test.js`): añadir caso `getProvider('github')` que valida el gate de los 9 métodos. **Cuidado:** el test debe inyectar config válida vía mock (`clearRegistry` + `registerProvider('github', () => fakeGitHubProvider)`) o ajustar fixture para no leer config real.

### Documentación in-code

- **D-39:** Header doc en `src/providers/github/provider.js` (mirror Phase 23 client.js:1-30): describe el contrato, las decisiones D-01 (contrato real vs ROADMAP), D-16 (state passthrough), D-26/D-27 (webhook no-op), y referencia esta CONTEXT.md.

### Claude's Discretion

- **D-40:** Nombre del helper privado `parseRef` vs `parseGitHubRef`: voy con `parseRef` local al módulo (no exported) — sin colisión con `parseRef` de PlaneProvider (que también es local).
- **D-41:** Si añadir tipos JSDoc al factory `opts.client` (D-36): sí, `{ client?: import('./client.js').GitHubClient, logger?: ... }`.
- **D-42:** Orden de los métodos en el objeto `provider` retornado: seguir el orden de `TASK_PROVIDER_METHODS` (init, getTask, updateTaskState, addComment, listPendingTasks, parseTriggerEvent, verifySignature, resolveRef, listProjects) para facilitar diff side-by-side con `PlaneProvider`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 24 scope (locked)

- `.planning/ROADMAP.md` §Phase 24 — Goal + 5 Success Criteria + Requirements (GH-02, GH-03, GH-04, GH-05, TEST-01). **ATENCIÓN:** el contrato `TaskProvider` listado en SC#1 es incorrecto (D-01); actualizar antes de planificar.
- `.planning/REQUIREMENTS.md` §GH-02, §GH-03, §GH-04, §GH-05, §TEST-01 + §Out of Scope. **ATENCIÓN:** GH-02 lista métodos incorrectos; actualizar a contrato `interface.js` real.
- `.planning/PROJECT.md` §Current Milestone v0.7.

### Cross-phase invariants

- `.planning/STATE.md` §Critical Invariants to Preserve (v0.7):
  - TaskProvider 9-method contract — `TASK_PROVIDER_METHODS` frozen.
  - TaskItem shape provider-agnostic — Phase 27 TEST-03 valida simetría.
  - `parseKodoLabels` provider-agnostic — cero cambios en `src/labels.js` (GH-05).
  - LOG-12 guard — Phase 24 NO importa nada que rompa el árbol de `src/check.js`.
  - Color isolation — Phase 24 NO importa picocolors directo.

### Phase 23 dependency (consumed)

- `.planning/phases/23-githubclient-auth-foundation/23-CONTEXT.md` — decisiones del cliente (D-01..D-39). Especialmente D-12 (Error.code canonical), D-19 (304 envelope shape), D-22 (5 métodos públicos).
- `src/providers/github/client.js` — implementación viva: constructor (líneas 80-91), `request` privado (líneas ~110-200), 5 métodos públicos (`getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels`).
- `test/providers/github/client.test.js` — 15 tests, fixtures en `test/fixtures/github/`.

### Plane analog (template directo)

- `src/providers/plane/provider.js` — **template directo del factory**, especialmente:
  - constructor + closures (líneas 24-43)
  - helpers `parseRef`/`findProject` (líneas 49-64)
  - `init()` con 3 ciclos (líneas 68-123) — Phase 24 lo simplifica a no-op (D-19).
  - `getTask` (líneas 125-160), `updateTaskState` (líneas 162-180), `addComment` (líneas 182-185), `listPendingTasks` (líneas 197-215), `parseTriggerEvent`/`verifySignature` (líneas 217-232), `listProjects` (líneas 234-241), `resolveRef` (líneas 243-249).
- `src/providers/plane/normalize.js` — template del normalizer puro:
  - `stripHtml` (líneas 21-27) — NO necesario en GitHub (D-10).
  - `resolveWorkItemLabels` (líneas 40-53) — equivalente trivial para GitHub (D-11).
  - `normalizeWorkItem` (líneas 64-80) — template del shape de retorno.
- `src/providers/registry.js` — bloque `factories.set('plane', ...)` (líneas 25-38) — template del registro para `github`.
- `src/interface.js` — **fuente única del contrato real** (`TASK_PROVIDER_METHODS` líneas 50-60, `TaskItem` typedef líneas 11-24, `TaskProvider` typedef líneas 36-46, `VALID_PRIORITIES` líneas 62-69).

### Consumer paths

- `src/triggers/dispatcher.js:83-88` — donde `task.state` se compara contra `config.providers.<name>.states.done` + `'Cancelled'`. Justifica D-16 (state literal sin transformación).
- `src/triggers/webhook.js:27,40` — donde `provider.verifySignature` y `provider.parseTriggerEvent` se invocan. Justifica D-26/D-27 (no-op funcional aunque GitHub no use webhook).
- `src/cli.js:155-167` — donde `dispatchTrigger` se invoca con event manual (CLI). El path mantiene flujo igual.
- `src/labels.js` (líneas ~12-37) — `parseKodoLabels`. Phase 24 lo invoca indirecto via dispatcher con `task.labels.map(name => ({name}))` (GH-05 zero cambios).

### Testing conventions

- `.planning/codebase/TESTING.md` — runner `node:test`, `node:assert/strict`, no mocking framework externo.
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check`, kebab-case files, camelCase exports, JSDoc en públicos, error pattern `throw new Error(template)`.
- `test/plane-provider.test.js` — analog directo para estructura de provider.test.js.
- `test/normalize.test.js` — analog directo para estructura de normalize.test.js.
- `test/registry.test.js` — caso a extender (D-38).

### Config dependency (asumido por Phase 24, definido por Phase 26)

- `src/config.js:160` (`getProviderApiKey`) — fuente del token via `config.providers.github.api_key_env`. Phase 23 ya funcional.
- **Schema asumido Phase 24** (definido en Phase 26 CFG-02):
  ```json
  "providers": {
    "github": {
      "base_url": "https://api.github.com",
      "api_key_env": "GITHUB_TOKEN",
      "repos": [{"owner": "...", "repo": "..."}],
      "states": {"trigger": "open", "review": "closed", "done": "closed"}
    }
  }
  ```

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`PlaneProvider` (`src/providers/plane/provider.js`)** — template casi 1:1 para el factory. Esperado ~150-180 LOC para GitHubProvider (vs 253 LOC Plane, que carga 3 ciclos de cache eliminados en D-19).
- **`normalizeWorkItem` + helpers (`src/providers/plane/normalize.js`)** — template de la función pura + JSDoc context type. Esperado ~80-100 LOC para `normalize.js` GitHub (más simple porque sin stripHtml + sin resolveWorkItemLabels para UUIDs).
- **`GitHubClient` (`src/providers/github/client.js`)** — listo, 5 métodos públicos consumibles directo. Phase 24 NO toca el cliente.
- **`parseKodoLabels` (`src/labels.js:12-37`)** — provider-agnostic, GitHub Issue labels mapped a `{name}` lo invocan idéntico.
- **`getProviderApiKey('github')` (`src/config.js:160`)** — Phase 23 ya lo usa, sin cambios necesarios.
- **`VALID_PRIORITIES` (`src/interface.js:62-69`)** — array frozen `['urgent', 'high', 'medium', 'low', 'none']`. D-17 lo usa como whitelist en priority extraction.
- **`TASK_PROVIDER_METHODS` (`src/interface.js:50-60`)** — array frozen de los 9 métodos que el registry valida. D-01 garantía.

### Established Patterns

- **Factory function `create<Name>Provider(config, opts?)`** — convención Plane (provider.js:24), Phase 24 sigue.
- **Closures sobre cache state** (`labelCache`, `stateCache`) en Plane — Phase 24 NO usa este pattern (init no-op, D-19).
- **`async init()` con TTL guard** — Plane lo tiene (`INIT_TTL_MS = 5min`). Phase 24 NO lo replica (D-19 simplicity).
- **Helper `parseRef` privado al módulo** — Plane lo tiene (lines 49-53) para `KL-42`. Phase 24 lo redefine para `owner/repo#N` (D-22).
- **Provider object retornado al final del factory** — todos los métodos en un literal anotado con JSDoc `/** @type {TaskProvider} */`. Phase 24 sigue (D-42 mismo orden).
- **Mensajes de error templating** `${context}: ${detail}` consistentes para grep.

### Integration Points

- **Phase 25 consumer (POLL-01..04)** — `polling.js` invocará `provider.listPendingTasks()` cuando arranque el loop por primera vez (warmup), y `provider.getTask(ref)` por cada nuevo issue detectado. Phase 25 NO necesita métodos extra; el `listIssues` con etag es del CLIENTE (Phase 23), accedido via el provider en `listPendingTasks` D-25 sin etag o directo desde polling con etag.
- **Phase 26 consumer (CFG-01..04)** — `kodo config` wizard llamará `provider.listProjects()` para mostrar repos configurados (D-28 sin API calls). Si quiere enriquecer, llamará al cliente directo.
- **Phase 27 consumer (TEST-03)** — el contract matrix itera `['plane', 'github']` ejecutando los mismos asserts. Phase 24 garantiza que el shape de `TaskItem` retornado es idéntico (D-06..D-18). Riesgo crítico: si D-17 hace algo distinto que Plane (priority null), el matrix detecta. ✅ Mitigado por simetría D-17.
- **`src/triggers/dispatcher.js`** — Phase 24 NO modifica el dispatcher. Su lógica config-driven (D-16, líneas 83-88) ya soporta GitHub automáticamente cuando el config tiene `states.done='closed'`.

</code_context>

<specifics>
## Specific Ideas

- **Mirror PlaneProvider como template estructural** — la consistencia entre adapters es el pilar del invariante v0.2. Cualquier divergencia (init no-op D-19, sin labelCache, sin HTML wrap D-24) debe estar justificada por una diferencia REAL de GitHub vs Plane, no preferencia estilística.
- **Karpathy R2 (simplicity first)** — init() no-op (D-19), parseRef strict (D-22), groups siempre `[]` (D-14). Nada de placeholders "por si acaso necesitamos cache después".
- **Karpathy R3 (cambios quirúrgicos)** — Phase 24 NO toca `src/labels.js` (GH-05), `src/config.js` (Phase 26 owns), `src/logger-events.js` (Phase 23 ya cerró), `src/triggers/dispatcher.js`, `src/triggers/webhook.js`. La única modificación a archivos existentes es `src/providers/registry.js` (añadir factory block).
- **Contrato real prevalece sobre redacción del roadmapper** — D-01 implica updates a `.planning/ROADMAP.md` y `.planning/REQUIREMENTS.md`. El planner debe hacerlo ANTES de empezar implementación, no después.
- **Test fixtures incrementales** — fixtures Phase 23 cubren errores HTTP y rate limit; Phase 24 añade fixtures de payload shape variations (priority labels, no body, no labels, closed state).

</specifics>

<deferred>
## Deferred Ideas

- **Auto-pagination en `listPendingTasks`** — D-25 hace single-page request (max 100 per repo). Si emerge necesidad real (un repo con >100 issues con label `kodo` open, raro), añadir cursor en v0.8+.
- **`listProjects` con enriquecimiento** (`/repos/{owner}/{repo}` para `description`) — descartado en D-28. Si Phase 26 wizard lo necesita, lo hace directo via `client.request('/repos/...')`.
- **Discovery de repos via `/user/repos`** — fuera de contrato. Phase 26 wizard puede ofrecerlo como helper separado.
- **Milestone extraction a `TaskItem.groups`** — descartado en D-14. Cerrar la open question del STATE.md como "NO".
- **Aliases de priority (`p0`, `critical`, `blocker`)** — descartado en D-17. Si emerge demand, añadir mapping table en v0.8+.
- **State mapping a semántica Plane** (`open→In Progress`, `closed→Done`) — descartado en D-16. Rompe contrato cross-provider; cada provider expone sus propios estados.
- **`updateTaskState` con map de aliases en el provider** — descartado en D-23 (passthrough hard). Si los callers necesitan traducción, leen el config antes de pasar.
- **GitHub webhook ingress real** — REQUIREMENTS §Out of Scope. `parseTriggerEvent`/`verifySignature` (D-26/D-27) quedan como no-op funcional; si v0.8+ añade webhook, implementar entonces.
- **Cachear labels per-repo en init()** — descartado en D-19. Si Phase 26 wizard lo necesita, llama al cliente directo.

</deferred>

---

*Phase: 24-GitHubProvider + Normalizer + Registry*
*Context gathered: 2026-05-14*
