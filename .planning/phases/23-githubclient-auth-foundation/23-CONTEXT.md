# Phase 23: GitHubClient + Auth Foundation - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Implementar un **cliente REST aislado** (`src/providers/github/client.js`) que hable contra `https://api.github.com` con autenticación PAT, conciencia de rate limits y soporte de fetch condicional vía `etag`/`304` — **sin acoplarse a `TaskProvider`**, sin saber qué es `TaskItem`, sin emitir `dispatchTrigger`. Es la pieza de transporte HTTP que las fases siguientes (Provider en Phase 24, Polling en Phase 25) consumen.

**Scope-anchor:**
- `GitHubClient` class con 5 métodos: `getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels`.
- Rate-limit awareness (`X-RateLimit-Remaining < 100` → warn NDJSON; `429` → canonical error `rate_limit_exceeded`).
- 304 Not Modified como response shape (no excepción).
- ≥ 8 tests offline con fixtures JSON.

**Out of scope (esta fase):**
- `GitHubProvider`, normalizer, registry wiring → Phase 24.
- Polling loop, state cache, dispatchTrigger → Phase 25.
- Config wizard, CLI `kodo polling` → Phase 26.
- Cross-provider contract matrix → Phase 27.

</domain>

<decisions>
## Implementation Decisions

### Module Shape & Style

- **D-01:** El cliente es una **clase** `GitHubClient` (no factory function). Mirror exacto de `PlaneClient` (`src/providers/plane/client.js:4`). El provider de Phase 24 (`createGitHubProvider`) sí será factory function, como `createPlaneProvider`. Justificación: cliente es transporte stateless con un poco de estado opcional (rate-limit tracking si decidimos añadirlo); provider es orquestación. La división class-vs-factory ya está establecida en el milestone v0.2.
- **D-02:** Archivo único: `src/providers/github/client.js`. No splittear en sub-módulos (`http.js`, `errors.js`) — el cliente Plane vive en un solo archivo y el problema-size de GH es similar. YAGNI.
- **D-03:** JSDoc `// @ts-check` al principio del archivo (convención repo, ver CONVENTIONS.md §Linting). Todos los métodos públicos llevan `@param` + `@returns` (mirror Plane).

### HTTP Transport

- **D-04:** Usar `globalThis.fetch` nativo de Node 20+. No añadir `undici`, `node-fetch` ni `axios`. Mirror PlaneClient (línea 46). Bundle size cero, zero deps nuevas.
- **D-05:** `AbortSignal.timeout(10_000)` — 10s timeout por request, idéntico a Plane (línea 53). Suficiente para `api.github.com` desde una conexión doméstica.
- **D-06:** Inyectable `fetch` via constructor opts (`opts.fetch ?? globalThis.fetch`). **No existe en PlaneClient** — es una mejora pequeña que destraba el testing sin global mocking. Tests pasan un `fetch` fake que devuelve `Response`-like objects con `.status`, `.headers`, `.json()`, `.text()`.

### Auth

- **D-07:** Token leído via `getProviderApiKey('github')` (`src/config.js:160`). NO crear `getGithubApiKey()` wrapper (sería deprecated antes de nacer — `getPlaneApiKey` ya está marcado `@deprecated`). El env var configurable vía `config.providers.github.api_key_env` (default `'GITHUB_TOKEN'`, lo lockea CFG-02 en Phase 26).
- **D-08:** Header: `Authorization: token <PAT>` (no `Bearer`, no `token=`). Locked por ROADMAP SC#1. Funciona para classic PAT y fine-grained PAT.
- **D-09:** El cliente acepta `opts.token` para override en tests; si no, llama `getProviderApiKey('github')` en el constructor. Si el token sale `undefined`, lanza `Error('GitHub token not found. Set GITHUB_TOKEN env var.')` — mirror PlaneClient línea 13.
- **D-10:** El env var name leído del config (no hardcoded `GITHUB_TOKEN`), igual que Plane lee `config.plane.api_key_env`. Esto permite operadores con múltiples PATs (caso raro pero zero cost).

### Retry & Error Surface

- **D-11:** **CERO retry interno en el cliente.** Diferente de PlaneClient (que reintenta `429` con exponential backoff). Justificación: ROADMAP SC#2 dice "rechaza con error canonical `rate_limit_exceeded` en `429`", y POLL-04 (Phase 25) es la capa que retrye con backoff exponencial. Mezclar dos capas de retry sería doble-pago de tiempo y enmascararía señal.
- **D-12:** Error canonical: `Error` plano con propiedades adicionales `.code`, `.status`, `.retryAfter`. NO clase custom (`RateLimitError extends Error`) — overengineering, minimal Error es suficiente y testeable con `err.code === 'rate_limit_exceeded'`. Códigos: `rate_limit_exceeded` (429), `unauthorized` (401), `not_found` (404), `forbidden` (403 non-rate-limit), `github_api_error` (otros 4xx/5xx).
- **D-13:** Para `429`, el error lleva `.retryAfter` (segundos) extraídos del header `Retry-After` si presente; si no, `undefined` (Phase 25 polling usa default `2s * 2^attempt`).
- **D-14:** Mensajes de error formato `GitHub API ${status}: ${path} — ${textSnippet}` (mirror PlaneClient línea 72). Snippet de body limitado a 200 chars para no inflar logs.

### Rate Limit Observability

- **D-15:** Añadir 2 eventos a la taxonomía cerrada `src/logger-events.js` (Phase 7 owner):
  - `github.api.call` (info-level por default, **warn-level** cuando `rate_limit_remaining < 100`) — fields: `{ method, path, status, duration_ms, rate_limit_remaining }`.
  - `github.api.call.failed` (error-level) — fields: `{ method, path, status, error }` — emitido en cualquier `!res.ok`.
- **D-16:** El switch info/warn vive en el helper `githubApiCall`, pattern mirror `orchestratorReview` (`logger-events.js:145`: `const level = fields.verdict === 'approved' ? 'info' : 'warn';`). NO inventar `github.rate_limit.warn` separado — duplicaría taxonomía sin valor.
- **D-17:** Helpers se exportan desde `src/logger-events.js` junto a los 13 existentes; constantes `GITHUB_API_CALL` y `GITHUB_API_CALL_FAILED` se añaden al `EVENTS` frozen object. **Invariante LOG-12 preservada:** el módulo `logger-events.js` solo importa stdlib (`node:os`, `node:path`); seguirá sin tocar `src/check.js` graph.
- **D-18:** El cliente recibe `logger` opcional via `opts.logger` (mirror PlaneClient línea 11). Sin logger, las emisiones son no-op vía optional chain — sin lanzar.

### Conditional Fetch (etag / 304)

- **D-19:** Stateless en el cliente. `listIssues(owner, repo, opts)` acepta `opts.etag` (string opaco). Cliente añade `If-None-Match: <etag>` al request. Respuesta:
  - `304` → devuelve `{ status: 304, items: [], etag: <header X-Cache-Etag o el viejo si no llega>, rate_limit_remaining }`.
  - `200` → devuelve `{ status: 200, items: <array>, etag: <header ETag>, rate_limit_remaining }`.
- **D-20:** Cliente NO persiste etag entre llamadas — eso es responsabilidad de `~/.kodo/polling-state.json` (POLL-02, Phase 25). El cliente es puro request → response.
- **D-21:** `getIssue`, `addComment`, `updateIssue`, `listLabels` NO soportan etag — el etag/304 path es exclusivo de `listIssues` por ROADMAP SC#3 y porque es el único método que ejercita polling.

### Method Surface

- **D-22:** Métodos públicos (todos `async`):
  - `getIssue(owner, repo, number)` → raw GitHub issue payload.
  - `listIssues(owner, repo, opts?)` → `{ status, items, etag, rate_limit_remaining }`. `opts` soporta `{ labels?: string[], state?: 'open'|'closed'|'all', since?: ISO8601, etag?: string, per_page?: number }` (default `per_page: 100`).
  - `addComment(owner, repo, number, markdownBody)` → raw comment response.
  - `updateIssue(owner, repo, number, updates)` → raw issue payload tras PATCH; `updates` soporta `{ state?: 'open'|'closed', labels?, title?, body?, state_reason? }`.
  - `listLabels(owner, repo)` → array de labels raw.
- **D-23:** Los métodos pasan `(owner, repo, ...)` posicional (no `{owner, repo}` object). Justificación: `<owner>/<repo>` es la clave de granularity en GitHub (mirror `projectId` en Plane que es positional en `client.listStates(projectId)`). Provider Phase 24 hará el binding `owner/repo` desde `task.projectId`.
- **D-24:** El cliente NO normaliza la response — devuelve la shape raw de GitHub (con `node_id`, `pull_request`, `assignees`, etc.). Phase 24 normalizer transforma raw → `TaskItem`. Esto preserva la división Phase 23 ↔ Phase 24 clean.

### Pagination

- **D-25:** **Single page only** — `listIssues` devuelve hasta `per_page` items (default 100). NO auto-paginar el header `Link`. Justificación: POLL-03 (Phase 25) usa cursor `since` que mitiga la necesidad de full enumeration; iterar Link para una primera fase añade complejidad sin uso real inmediato. Si emerge necesidad, Phase 25 paginará externamente.
- **D-26:** `getIssue`, `addComment`, `updateIssue`, `listLabels` no paginan por definición.

### Internal Helpers

- **D-27:** Un método privado `request(path, opts)` que centraliza fetch + auth header + timeout + rate-limit header parsing + emisión NDJSON + error mapping. Mirror PlaneClient línea 23. Los 5 métodos públicos lo invocan.
- **D-28:** `request` parsea `X-RateLimit-Remaining` y `X-RateLimit-Reset` (segundos epoch UTC) y los stash en `this._rateRemaining` / `this._rateReset` (state opcional, no exigido por contrato pero útil para telemetría futura).
- **D-29:** NO proactive throttle (a diferencia de PlaneClient línea 36-42 que duerme cuando remaining < 5). El cliente surfaces — la decisión de pausar la lleva polling Phase 25 si decide.

### API Base URL

- **D-30:** Default hardcoded `https://api.github.com` en el constructor; configurable vía `opts.baseUrl` o `config.providers.github.base_url` (Phase 26 schema). La intención es facilitar testing con un fake server local (`http://127.0.0.1:<port>`) sin tocar el código.
- **D-31:** GitHub Enterprise self-hosted está **out of scope v0.7** (REQUIREMENTS.md §Out of Scope) — el flag `base_url` queda como hook futuro sin docs explícitas.

### Test Infrastructure

- **D-32:** Test file: `test/providers/github/client.test.js`. Crear el subdir `test/providers/github/` por primera vez (no existe). Mirror la estructura test/normalize.test.js, test/plane-provider.test.js.
- **D-33:** Fixtures en `test/fixtures/github/` (crear nuevo). Naming por escenario: `issue.json`, `issues-list.json`, `issue-comment.json`, `labels-list.json`, `rate-limit-low.json`, `rate-limit-exceeded.json`, `not-modified-304.json`, `unauthorized-401.json`, `not-found-404.json`. Mínimo 8 según SC#4 — se generan 9 para cubrir todas las branches del switch de errores.
- **D-34:** Fixtures redactadas de respuestas REALES del GitHub API (capturadas vía `curl` contra un repo personal del usuario, sin info sensible). Decisión operativa: el plan Phase 23 incluirá un script o instrucciones para capturar respuestas reales una sola vez; los fixtures son commited al repo.
- **D-35:** Mock de `fetch` vía inyección en constructor (D-06). Cada test construye un `fakeFetch` que devuelve una `Response`-like object:
  ```js
  function makeFetch(scenario) {
    return async (url, init) => ({
      status: scenario.status,
      ok: scenario.status >= 200 && scenario.status < 300,
      headers: new Map(Object.entries(scenario.headers || {})),
      async json() { return scenario.body; },
      async text() { return JSON.stringify(scenario.body); },
    });
  }
  ```
- **D-36:** Tests usan `node:test` + `node:assert/strict` (TESTING.md establecido). Zero live network calls — el plan Phase 23 añadirá una assertion en CI que falla si los tests intentan tocar `api.github.com` (e.g., el default `fetch` que crashea cuando se invoca con argumentos no-localhost). Si demasiado costoso, mínimo el constructor en tests siempre inyecta `fetch`.

### Claude's Discretion

- **D-37:** El nombre exacto del symbol exportado (`GitHubClient` vs `GithubClient`): voy con **`GitHubClient`** (CamelCase con la 'H' mayúscula, como GitHub oficialmente lo capitaliza y como el repo ya hace en `src/providers/plane/client.js → PlaneClient`).
- **D-38:** Si hace falta un `User-Agent` header explícito: GitHub requests benignos sin UA explícito están permitidos; el plan incluirá `'User-Agent': 'kodo/0.7.x'` por buena ciudadanía. No es bloqueante.
- **D-39:** El orden de los headers en cada request (`Authorization` → `Accept: application/vnd.github+json` → `X-GitHub-Api-Version: 2022-11-28` → `User-Agent`) — discreción del planner. Lo recomendado: incluir `Accept` y `X-GitHub-Api-Version` para futuro-proofing API contract.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 23 scope (locked)

- `.planning/ROADMAP.md` §Phase 23 — Goal + 4 Success Criteria + Requirements (GH-01).
- `.planning/REQUIREMENTS.md` §GH-01 (la única requirement de Phase 23) y §Out of Scope (descartes lock-in).
- `.planning/PROJECT.md` §Current Milestone v0.7 — invariantes provider-agnostic v0.2.

### Cross-phase invariants (preservar)

- `.planning/STATE.md` §Critical Invariants to Preserve (cross-phase v0.7):
  - LOG-12 guard (Phase 16) — `kodo check` no carga `src/logger.js` transitivamente; `logger-events.js` solo importa stdlib.
  - Color isolation (Phase 14) — `picocolors` solo desde `src/cli/format.js`; el cliente Phase 23 NO importa colores.
  - TaskProvider 9-method contract (v0.2) — Phase 23 no implementa el contrato pero su shape de retorno alimenta Phase 24 que sí.

### Plane analog (template directo)

- `src/providers/plane/client.js` — **template directo**, especialmente el constructor (línea 4), `request` (línea 23), rate-limit parsing (línea 56-59), error throw (línea 70-73), emisión `planeApiCall` (línea 76-88).
- `src/providers/plane/provider.js` — referencia de factory function pattern para Phase 24 (no tocado en Phase 23).
- `src/providers/registry.js` — referencia para wiring Phase 24 (no tocado en Phase 23).
- `src/interface.js` — `TaskProvider` contract (Phase 24 owns; Phase 23 client retorna shapes raw que Phase 24 normaliza a `TaskItem`).

### Logger taxonomy (extender)

- `src/logger-events.js` — taxonomía cerrada de 13 eventos. Phase 23 añade `github.api.call` y `github.api.call.failed` siguiendo el patrón de `planeApiCall` (línea 192-200) y `orchestratorReview` (línea 145, switch info/warn por field).

### Config & env vars

- `src/config.js:160` (`getProviderApiKey`) — fuente canonical del token via env var name leído desde config.
- `src/config.js:34-40` — schema actual de `providers.plane` con `api_key_env: 'PLANE_API_KEY'`. Phase 23 NO modifica `src/config.js` (eso es CFG-01/CFG-02 en Phase 26), pero el cliente llama `getProviderApiKey('github')` que ya funciona si el config tiene la clave.

### Testing conventions

- `.planning/codebase/TESTING.md` — runner `node:test`, assertion `node:assert/strict`, structure `describe`/`it`/`beforeEach`, no mocking framework externo.
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check`, kebab-case files, camelCase exports, JSDoc en públicos, error pattern `throw new Error(\`Plane API ${status}: ${path} — ${text}\`)`.
- `test/normalize.test.js`, `test/plane-provider.test.js` — analogs para estructura de test files dentro de providers.

### Milestone history (precedente)

- `.planning/milestones/v0.2-ROADMAP.md` — original provider abstraction; baseline para entender por qué el cliente está desacoplado del provider.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`PlaneClient` (`src/providers/plane/client.js`)** — template casi 1:1. Copiable structure: constructor con opts, método privado `request`, rate-limit parsing, error throw, NDJSON emisión via logger. ~120 LOC esperadas (Plane es 212 LOC pero incluye `resolveIdentifier` y métodos plane-específicos).
- **`getProviderApiKey(name)` (`src/config.js:160`)** — funcional ya. Solo necesita que `config.providers.github.api_key_env` exista para devolver el token. Esto se asume presente desde Phase 26; en Phase 23 los tests inyectan `opts.token` directo para evitar acoplar al config v0.6.
- **Estructura `EVENTS` frozen (`src/logger-events.js:38-52`)** — patrón establecido para añadir nuevas event keys. Phase 23 inserta `GITHUB_API_CALL: 'github.api.call'` y `GITHUB_API_CALL_FAILED: 'github.api.call.failed'` siguiendo el orden cronológico.
- **Helper pattern `planeApiCall` (`src/logger-events.js:192-200`)** — template exacto para `githubApiCall`. Single change: añadir field `rate_limit_remaining` y switch `info`/`warn` en el level por D-16.

### Established Patterns

- **Class with private state via underscore-prefix props** (`PlaneClient._rateRemaining`, `_rateReset`) — el cliente puede mantener telemetría opcional sin contractual leak.
- **Inyectable logger opcional** — todos los modules emisores aceptan `opts.logger?` y emiten via optional chain (`this.logger?.info(...)`). Phase 23 sigue el patrón.
- **Constructor lanza si falta config** — PlaneClient línea 13 (`if (!this.apiKey) throw`). GitHubClient hace lo mismo (`if (!this.token) throw`).
- **Métodos públicos `async` con JSDoc** (`@param` posicional, `@returns Promise<...>`) — convención global.
- **Error message templating** `[kodo] X service ${status}: ${path} — ${snippet}` — formato consistente para grep en logs.

### Integration Points

- **Phase 24 consumer** — `createGitHubProvider({ token, ... })` construirá `new GitHubClient({ token, logger })` y los 9 métodos `TaskProvider` lo invocarán. Phase 23 NO toca Phase 24; pero el shape de retorno del cliente (raw GitHub payloads) debe ser estable porque Phase 24 lo va a normalizar.
- **Phase 25 consumer** — `polling.js` invocará `provider.listTasks(...)` que internamente llama `client.listIssues(...)`. El 304 path (D-19) es el contract crítico entre Phase 23 y Phase 25.
- **`src/logger-events.js`** — Phase 23 lo extiende. Riesgo: tests existentes (`test/logger-events.test.js`) que enumeran EVENTS pueden romperse si los asserts cuentan el tamaño del objeto. Plan mitiga revisando ese test antes del commit y ajustando.
- **`test/registry.test.js`** — Phase 24 lo modificará. Phase 23 lo deja intacto (no registra factory `github` aún).

</code_context>

<specifics>
## Specific Ideas

- **Mirror PlaneClient como guía estilística y estructural** — el usuario tiene memoria persistente de que kodo prefiere consistencia entre adapters (memoria `kodo_one_project_per_repo` + invariante v0.2 explícito en STATE.md). Cualquier divergencia de PlaneClient debe estar justificada (D-11 retry, D-19 etag).
- **GH classic PAT solamente** — REQUIREMENTS.md §Future Requirements descarta OAuth GitHub App y fine-grained PAT como out-of-scope. El plan no debe añadir paths que requieran OAuth tokens.
- **Stateless puro en testing** — los tests Phase 23 deben correr en < 1s wall-time y zero network. Mirror la disciplina de TEST-02 en Phase 25 (clock mocking).
- **JSDoc estricto** — el repo usa `// @ts-check`. Tipos deben validar; tests CI vía `npm run build` (si existe) o `tsc --noEmit` (validar en plan).

</specifics>

<deferred>
## Deferred Ideas

- **Auto-pagination del header `Link`** — descartado en Phase 23 por D-25. Si Phase 25 polling encuentra issues con > 100 results, replantear como helper en Phase 25 o como nueva micro-fase v0.7.x.
- **Proactive throttle** (a la PlaneClient < 5 remaining → sleep) — descartado en Phase 23 por D-29. POLL-04 retry exponential en Phase 25 cubre el caso 429; si emerge presión real, añadir en una phase de polish v0.8+.
- **GitHub Enterprise self-hosted** — REQUIREMENTS.md §Out of Scope explícito. El flag `base_url` queda en el constructor (D-30) pero sin tests ni docs en v0.7.
- **Fine-grained PAT support** — REQUIREMENTS.md §Future Requirements. El header `Authorization: token <PAT>` funciona idéntico, pero validación de scopes no es scope v0.7.
- **OAuth GitHub App** — REQUIREMENTS.md §Out of Scope. No tocar.
- **GraphQL API** — out of scope; v0.7 es REST only.
- **Caché interna de issues** — el cliente Phase 23 es stateless; cualquier caché vive en Phase 25 (`~/.kodo/polling-state.json`).
- **Webhook GitHub ingress real-time** — descartado en v0.7 por trigger choice (polling-only).

</deferred>

---

*Phase: 23-GitHubClient + Auth Foundation*
*Context gathered: 2026-05-14*
