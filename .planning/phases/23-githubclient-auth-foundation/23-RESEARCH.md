# Phase 23: GitHubClient + Auth Foundation — Research

**Researched:** 2026-05-14
**Domain:** REST HTTP client (Node 20+ `globalThis.fetch`) sobre `api.github.com` con PAT, rate-limit awareness y ETag/304.
**Confidence:** HIGH (todos los puntos críticos verificados contra docs.github.com 2026-05-14 + análisis directo del template Plane en el repo).

## Summary

El alcance de Phase 23 es producir **un único módulo de transporte HTTP** (`src/providers/github/client.js`) que sea espejo estructural casi 1:1 del `PlaneClient` existente, con tres divergencias justificadas: (a) **cero retry interno** — el cliente surface 429 como `Error` canónico y deja que Phase 25 polling decida el backoff; (b) **soporte ETag/304 stateless** — el caller pasa `opts.etag`, el cliente devuelve `{ status, items, etag, rate_limit_remaining }` sin levantar excepción en 304; (c) **`fetch` inyectable por constructor** para test ergonomics, dado que el helper test de Plane re-asigna `globalThis.fetch` y eso es exactamente el patrón que queremos evitar replicar.

Toda la información técnica de GitHub está verificada contra docs.github.com 2026 (ver Sources). El plan tiene material suficiente — no hay bloqueos.

**Primary recommendation:** Mirror `PlaneClient` (constructor → private `request` → 5 métodos públicos), añadir el envelope `{status,items,etag,rate_limit_remaining}` SOLO en `listIssues`, y extender `logger-events.js` con `githubApiCall` (info/warn switch en `rate_limit_remaining < 100`) + `githubApiCallFailed`. Tres tareas, dos secuenciales y una opcional en paralelo (ver §Plan-shaping).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 … D-36)

**Module shape & style:**
- **D-01** Clase `GitHubClient` (no factory). Espejo de `PlaneClient`. Provider Phase 24 sí será factory.
- **D-02** Archivo único `src/providers/github/client.js`. No splittear en `http.js`/`errors.js`.
- **D-03** `// @ts-check` en cabecera, JSDoc `@param`/`@returns` en públicos.

**HTTP transport:**
- **D-04** `globalThis.fetch` nativo Node 20+. NO `undici`/`node-fetch`/`axios`.
- **D-05** `AbortSignal.timeout(10_000)` — 10s timeout por request.
- **D-06** `fetch` inyectable via `opts.fetch ?? globalThis.fetch`. **Mejora sobre Plane** — destraba testing sin global mocking.

**Auth:**
- **D-07** Token leído via `getProviderApiKey('github')` (`src/config.js:160`). NO crear `getGithubApiKey()`.
- **D-08** Header `Authorization: token <PAT>` (no Bearer, no `token=`).
- **D-09** Acepta `opts.token` override; si falta, `Error('GitHub token not found. Set GITHUB_TOKEN env var.')`.
- **D-10** Env var name leído del config (no hardcoded `'GITHUB_TOKEN'`).

**Retry & error surface:**
- **D-11** **CERO retry interno**. Divergencia justificada de Plane.
- **D-12** Error canonical: `Error` plano con `.code`/`.status`/`.retryAfter`. NO clases custom. Códigos: `rate_limit_exceeded`, `unauthorized`, `not_found`, `forbidden`, `github_api_error`.
- **D-13** `.retryAfter` (segundos) parseado de header `Retry-After` cuando presente.
- **D-14** Mensaje `GitHub API ${status}: ${path} — ${snippet}` (snippet ≤ 200 chars).

**Rate-limit observability:**
- **D-15** Añadir 2 eventos a la taxonomía cerrada `EVENTS`: `github.api.call` y `github.api.call.failed`.
- **D-16** Switch info/warn por `rate_limit_remaining < 100` dentro del helper `githubApiCall`. Pattern espejo `orchestratorReview`.
- **D-17** Helpers exportados desde `src/logger-events.js`. **LOG-12 preservada** (solo importa stdlib).
- **D-18** Logger opcional via `opts.logger` (optional-chain emit).

**Conditional fetch (etag/304):**
- **D-19** Stateless. `listIssues` acepta `opts.etag`, devuelve envelope `{status, items, etag, rate_limit_remaining}`. 304 → `items: []`.
- **D-20** Cliente NO persiste etag (esa es responsabilidad de Phase 25).
- **D-21** Etag/304 SOLO en `listIssues`. Otros métodos no soportan condicional.

**Method surface:**
- **D-22** 5 métodos públicos `async`: `getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels`.
- **D-23** Args posicionales `(owner, repo, ...)`.
- **D-24** Devuelve raw GitHub payloads — la normalización es Phase 24.

**Pagination:**
- **D-25** Single page only. NO auto-paginar `Link` header.
- **D-26** `getIssue`, `addComment`, `updateIssue`, `listLabels` no paginan.

**Internal helpers:**
- **D-27** Método privado `request(path, opts)` — centraliza fetch + auth + timeout + rate-limit parse + NDJSON + error mapping.
- **D-28** Parsea `X-RateLimit-Remaining`/`X-RateLimit-Reset` y los stashea en `this._rateRemaining`/`this._rateReset`.
- **D-29** **NO proactive throttle** (divergencia de Plane).

**API base URL:**
- **D-30** Default `https://api.github.com`. Override via `opts.baseUrl`.
- **D-31** GitHub Enterprise out of scope v0.7.

**Test infrastructure:**
- **D-32** Test file `test/providers/github/client.test.js` (crear subdir).
- **D-33** Fixtures en `test/fixtures/github/` (crear nuevo). ≥ 9 fixtures: `issue.json`, `issues-list.json`, `issue-comment.json`, `labels-list.json`, `rate-limit-low.json`, `rate-limit-exceeded.json`, `not-modified-304.json`, `unauthorized-401.json`, `not-found-404.json`.
- **D-34** Fixtures redactadas de respuestas REALES (capturadas con `curl`, sin info sensible).
- **D-35** Mock de `fetch` via inyección (D-06).
- **D-36** `node:test` + `node:assert/strict`. Zero live network.

### Claude's Discretion (D-37 … D-39)

- **D-37** Nombre exportado: **`GitHubClient`** (con 'H' mayúscula, capitalización oficial de GitHub).
- **D-38** Incluir `User-Agent: 'kodo/0.7.x'` por buena ciudadanía (no bloqueante).
- **D-39** Orden de headers: `Authorization` → `Accept: application/vnd.github+json` → `X-GitHub-Api-Version: 2022-11-28` → `User-Agent`.

### Deferred Ideas (OUT OF SCOPE en Phase 23)

- Auto-pagination del header `Link` — replantear en Phase 25 si emerge.
- Proactive throttle (estilo PlaneClient `<5 remaining → sleep`).
- GitHub Enterprise self-hosted.
- Fine-grained PAT validation de scopes.
- OAuth GitHub App.
- GraphQL API.
- Caché interna de issues (Phase 25 owns).
- Webhook GitHub ingress real-time (v0.8+).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **GH-01** | `GitHubClient` (`src/providers/github/client.js`) implementa REST wrapper sobre `https://api.github.com` con auth `Authorization: token <GITHUB_TOKEN>`; maneja rate limit headers (`X-RateLimit-Remaining` warn cuando < 100); respeta 304 Not Modified para condicional fetch via etag. | §GitHub REST API reference cubre los 5 endpoints; §Auth & token mechanics cubre PAT + header format; §Rate limit semantics cubre headers + thresholds; §Conditional fetch deep-dive cubre ETag/304; §NDJSON event additions especifica el wire-format del warn. |
</phase_requirements>

## Architectural Responsibility Map

Phase 23 toca exclusivamente la capa de **transporte HTTP**. No hay UI ni persistence.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP request a `api.github.com` | API client (transport) | — | El cliente es la frontera Node↔red. Aislado de provider/normalizer. |
| Auth PAT header injection | API client | Config layer (`src/config.js`) | Token cargado desde env via `getProviderApiKey('github')`; cliente solo lo inyecta. |
| Rate-limit header parsing | API client | — | Surface, no decide políticas. |
| Rate-limit warn NDJSON | Observability (`logger-events.js`) | API client (consumer) | Taxonomía cerrada vive en `logger-events.js`; el cliente la consume. |
| ETag/304 envelope | API client | Phase 25 polling (caller decide acción) | Stateless en el cliente — Phase 25 persiste etag en `polling-state.json`. |
| Error mapping HTTP → `.code` canonical | API client | — | El provider Phase 24 lee `.code` para traducir a errores del contrato `TaskProvider`. |
| Normalización raw → `TaskItem` | **NO en Phase 23** | Phase 24 normalizer | D-24 explícito. |
| Polling loop, retry, etag persistence | **NO en Phase 23** | Phase 25 | D-11 + D-20 explícitos. |

**Sanity check:** El cliente solo conoce `path` (string), opts (objeto opaco), y emite `Error`/devuelve `Response.json()`. No importa `interface.js`, no conoce `TaskItem`, no llama al registry.

---

## GitHub REST API Reference (api-version 2022-11-28)

Los 5 endpoints que `GitHubClient` ejercita. Todos contra `https://api.github.com`.

### 1. `GET /repos/{owner}/{repo}/issues/{issue_number}` — `getIssue`

**Request:**
- Path params: `owner`, `repo`, `issue_number` (todos required).
- Headers (recomendados): `Authorization`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent`.
- Sin body.

**Response 200 — shape clave (campos que Phase 24 va a leer):**
```json
{
  "id": 1234567890,
  "node_id": "I_kwDOABCD12M5gAbCd",
  "number": 42,
  "title": "Bug en X",
  "body": "Markdown text or null",
  "labels": [
    { "id": 99, "node_id": "LA_...", "name": "kodo", "color": "0e8a16", "default": false, "description": null }
  ],
  "state": "open",
  "state_reason": null,
  "html_url": "https://github.com/owner/repo/issues/42",
  "pull_request": null,
  "assignees": [{ "login": "alex", "id": 1, ... }],
  "user": { "login": "alex", "id": 1, ... },
  "created_at": "2026-05-14T07:00:00Z",
  "updated_at": "2026-05-14T08:00:00Z",
  "closed_at": null,
  "locked": false,
  "comments": 3,
  "milestone": null,
  "repository_url": "https://api.github.com/repos/owner/repo"
}
```

**Edge cases:**
- `404 Not Found` — issue no existe O el token no tiene visibilidad sobre el repo (GitHub no distingue para evitar leaking — ver §Auth).
- `410 Gone` — issue archivada/locked (raro, surface como `forbidden` o `github_api_error` por simplicidad).
- `body` puede ser `null` cuando la issue fue creada sin descripción (Pitfall #1).

**Response headers relevantes:**
- `ETag: "W/\"abc123\""` — para condicional futuro (no usado en `getIssue`).
- `Last-Modified: Wed, 14 May 2026 08:00:00 GMT`.
- `X-RateLimit-Limit: 5000`, `X-RateLimit-Remaining: 4998`, `X-RateLimit-Reset: 1747200000`, `X-RateLimit-Used: 2`, `X-RateLimit-Resource: core`.

---

### 2. `GET /repos/{owner}/{repo}/issues` — `listIssues`

**Request:**
- Path params: `owner`, `repo`.
- Query params (los que Phase 25 va a usar): `state` (default `open`; valid `open|closed|all`), `labels` (comma-separated), `since` (ISO 8601), `sort` (default `created`), `direction` (default `desc`), `per_page` (default 30, max 100), `page` (default 1).
- Headers: los de arriba **+ opcionalmente** `If-None-Match: <etag>` para condicional.

**Response 200 — shape:**
Array de objects con la misma shape que `getIssue` (cada elemento es un issue). El endpoint puede devolver **PRs intermixed** — distinguibles por la presencia del campo `pull_request` ≠ null (ver Pitfall #2).

**Response 304 Not Modified** (cuando `If-None-Match` matches el ETag actual):
- **Body vacío** (no parsear `json()`).
- Headers: el `ETag` se devuelve (mismo valor enviado). `X-RateLimit-Remaining` sigue presente.
- **Importante:** una conditional request que responde 304 **NO cuenta contra el primary rate limit** ([docs.github.com — best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).

**Response headers relevantes** (en 200):
- `ETag: "W/\"hash\""` — string opaco (siempre tratarlo así, no parsear; weak validators `W/` incluidos).
- `Link: <https://api.github.com/...?page=2>; rel="next", ...` — usado para pagination. **Phase 23 lo ignora (D-25)**.
- `X-RateLimit-*` — siempre presentes.

**`since` semantics:** filtra por `updated_at` (no `created_at`). Es **exclusive en el límite inferior** según comportamiento empírico (Pitfall #5).

---

### 3. `POST /repos/{owner}/{repo}/issues/{issue_number}/comments` — `addComment`

**Request:**
- Path params: `owner`, `repo`, `issue_number`.
- Body: `{ "body": "<markdown>" }`. **El cuerpo es markdown** (no HTML). Diferencia importante con Plane que usaba HTML.
- Headers: `Content-Type: application/json` + los habituales.

**Response 201 Created:**
```json
{
  "id": 123,
  "node_id": "IC_...",
  "url": "https://api.github.com/repos/owner/repo/issues/comments/123",
  "html_url": "https://github.com/owner/repo/issues/42#issuecomment-123",
  "body": "<markdown>",
  "user": { "login": "alex", ... },
  "created_at": "2026-05-14T08:00:00Z",
  "updated_at": "2026-05-14T08:00:00Z",
  "author_association": "OWNER",
  "reactions": { "total_count": 0, ... }
}
```

**Edge cases:**
- `403 Forbidden` — token no tiene permisos.
- `404 Not Found` — issue o repo no existe.
- `410 Gone` — issue locked (no se puede comentar).
- `422 Unprocessable Entity` — body vacío o rate-limited secondary.

---

### 4. `PATCH /repos/{owner}/{repo}/issues/{issue_number}` — `updateIssue`

**Request:**
- Body: `{ state?: 'open'|'closed', state_reason?: 'completed'|'not_planned'|'reopened'|null, title?: string, body?: string, labels?: string[], assignees?: string[], milestone?: number|null }`.
- **Importante:** `labels` en PATCH es **replace, no merge** — pasar el array completo deseado.

**Response 200 OK:** mismo shape que `getIssue`.

**Edge cases:**
- `422` si `state_reason` es inválido para el `state` (e.g., `not_planned` con `state: open`).
- `403` si el token no puede modificar (e.g., issue de otro user en repo donde solo eres reader).

---

### 5. `GET /repos/{owner}/{repo}/labels` — `listLabels`

**Request:**
- Query: `per_page` (max 100, default 30), `page`.
- Single page only en Phase 23 (D-25).

**Response 200:** array de:
```json
{ "id": 1, "node_id": "LA_...", "url": "...", "name": "kodo", "description": null, "color": "0e8a16", "default": false }
```

---

## Auth & Token Mechanics

### Header format

| Forma | Válido | Recomendación |
|-------|--------|---------------|
| `Authorization: token ghp_XXXX` | ✅ Sí | **Locked por D-08 + ROADMAP SC#1.** Estilo histórico, sigue funcionando para classic PAT + fine-grained PAT. |
| `Authorization: Bearer ghp_XXXX` | ✅ Sí | Alternativa moderna, mandatoria para JWT. **No usar — desvía del lock de scope.** |
| `Authorization: ghp_XXXX` (sin prefijo) | ❌ No | Rechazado (401). |

Verificado vs [docs.github.com — authenticating-to-the-rest-api](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api): "In most cases, you can use `Authorization: Bearer` or `Authorization: token` to pass a token."

### Classic PAT format

- Prefix: `ghp_` (classic PAT). Fine-grained PAT: `github_pat_`. Ambos funcionan con `Authorization: token`.
- Longitud típica classic: ~40 chars post-prefix. **El cliente NO debe validar formato del token** — surface 401 cuando GitHub rechaza, sin pre-flight.

### Scopes requeridos para Phase 23 (sólo cliente)

| Endpoint | Public repo | Private repo |
|----------|-------------|--------------|
| `GET /repos/.../issues/{n}` | (sin scope) o `public_repo` | `repo` |
| `GET /repos/.../issues` | (sin scope) o `public_repo` | `repo` |
| `POST .../comments` | `public_repo` | `repo` |
| `PATCH .../issues/{n}` | `public_repo` | `repo` |
| `GET .../labels` | (sin scope) | `repo` |

**Decisión recomendada:** documentar en `kodo config` wizard (Phase 26) que el PAT necesita `repo` (private) o `public_repo` (public-only). En Phase 23 NO validar scope antes de la primera llamada — surface `forbidden` cuando GitHub responda.

### Failure modes — 401 vs 403 vs 404

Verificado vs docs.github.com:

| Status | Causa | Recomendación de mapeo |
|--------|-------|------------------------|
| `401 Unauthorized` | Token ausente, malformado, o credenciales inválidas en primer intento. | `Error.code = 'unauthorized'` |
| `403 Forbidden` | Token válido pero sin scope; failed-login-limit; rate limit (primary o secondary). | Si `X-RateLimit-Remaining === '0'` o header `Retry-After` presente → `rate_limit_exceeded`. Si no → `forbidden`. |
| `404 Not Found` | Issue/repo inexistente **O** repo privado sin scope (GitHub no distingue para no leak existence). | `Error.code = 'not_found'` |
| `410 Gone` | Issue locked/archived. Surface como `github_api_error` (no es un caso común; no merecen un code propio). |
| `422 Unprocessable Entity` | Body inválido o rate-limit secondary creator. Surface como `github_api_error`. |
| `429 Too Many Requests` | Secondary rate limit (raro — primary usualmente es 403). | `rate_limit_exceeded` con `.retryAfter`. |
| `500/502/503/504` | Server-side. Surface como `github_api_error`. Phase 25 retry. |

---

## Rate Limit Semantics

### Headers (verificados en docs)

| Header | Tipo | Significado |
|--------|------|-------------|
| `X-RateLimit-Limit` | int | Total disponible por hora en este resource (PAT auth core = **5000**). |
| `X-RateLimit-Remaining` | int | Cuántos te quedan en la ventana. |
| `X-RateLimit-Used` | int | Cuántos has consumido. |
| `X-RateLimit-Reset` | int (epoch seconds UTC) | Cuándo se resetea la ventana. |
| `X-RateLimit-Resource` | string | Cuál bucket cuenta (`core`, `search`, `graphql`, ...). Para Issues API siempre `core`. |
| `Retry-After` | int (seconds) **o** HTTP-date | Presente en 429 y en 403 secondary. Parsear ambos formatos (ver Pitfall #4). |

**Authenticated PAT primary limit:** 5000 requests/hora en `core`. Polling cada 60s × N repos te da margen de sobra (1 repo × 60 = 60 req/h; 10 repos = 600 req/h).

### Primary vs secondary rate limits

- **Primary:** se gasta el bucket de 5000/h. Cuando llega a 0 → siguiente request **403 o 429** (docs no distinguen el code).
- **Secondary:** detección de abuso (rate de requests demasiado alto, concurrencia excesiva). Puede llegar antes que el primary esté agotado. También **403 o 429**.
- **Indistinguible en el cliente** sin lógica heurística — y eso está bien para Phase 23. Tratamos cualquier 429 (y cualquier 403 con `Retry-After`) como `rate_limit_exceeded`.

### "Near-limit" detección — el threshold `< 100`

Locked por D-15 y SC#2. El `100` es razonable porque:
- Da ~120 segundos de buffer a 1 req/s antes de quedarte sin tokens.
- Por debajo de 50 ya estás en zona crítica; Phase 25 puede tomar la decisión de pausar.
- El switch info → warn es solo observabilidad — no cambia comportamiento. Polling layer (Phase 25) decide.

**Implementación del switch (espejo `orchestratorReview` línea 145 de `logger-events.js`):**

```js
const level = fields.rate_limit_remaining < 100 ? 'warn' : 'info';
logger[level](EVENTS.GITHUB_API_CALL, { ...fields, event: EVENTS.GITHUB_API_CALL });
```

---

## Conditional Fetch (ETag / 304) Deep-Dive

**El seam más crítico entre Phase 23 y Phase 25.**

### Cómo funciona

1. Primera llamada `listIssues(owner, repo, { state: 'open', labels: ['kodo'], since: ISO })` sin `etag`. GitHub responde 200 + `ETag: W/"abc..."`.
2. Phase 25 persiste `etag` en `~/.kodo/polling-state.json` por `<owner>/<repo>` (POLL-02).
3. Siguiente tick: `listIssues(owner, repo, { ..., etag: 'W/"abc..."' })`. Cliente añade `If-None-Match: W/"abc..."`.
4. Si nada cambió desde la última request idéntica → GitHub responde **304 Not Modified, sin body**.
5. Si algo cambió → **200 con nuevo body + nuevo ETag**.

### ETag y el `since` filter

**Importante:** El ETag está calculado sobre el **conjunto exacto de query params + estado actual**. Si cambias `since` entre llamadas, el ETag ya no aplica → 200 garantizado.

**Implicación para Phase 25:** debe almacenar el `etag` **junto con** el `since` que generó esa request, y enviarlos como par. Si Phase 25 quiere avanzar `since` debe esperar el nuevo `etag` antes de cachearlo. Phase 23 no se preocupa por esto — solo pasa el `etag` que recibe.

### Qué contiene exactamente una 304 response

Verificado contra docs + análisis de behavior:

| Header | Presente en 304 |
|--------|-----------------|
| `ETag` | Sí (mismo valor que enviamos). |
| `Last-Modified` | Sí. |
| `X-RateLimit-*` | **Sí, todos presentes.** El recurso de rate-limit info sigue siendo visible. |
| `Link` | No (no aplica en 304). |
| `Content-Length` | 0 o ausente. |
| Body | Vacío. **NO llamar `res.json()` — fallaría.** |

**304 NO cuenta contra primary rate limit** ([docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).

### Envelope canónica `listIssues` (Phase 23 → Phase 25 contract)

```js
// 200 OK
{
  status: 200,
  items: [/* array of raw GitHub issue objects */],
  etag: 'W/"abc..."',           // string opaco, puede ser undefined si GH no devolvió header
  rate_limit_remaining: 4523    // number, o undefined si header ausente
}

// 304 Not Modified
{
  status: 304,
  items: [],                    // siempre array vacío (no hay payload)
  etag: 'W/"abc..."',           // el mismo que enviaste; o el devuelto si distinto
  rate_limit_remaining: 4523
}
```

**Decisión clave:** **NO levantar excepción en 304.** El `_request` interno detecta `res.status === 304`, construye la envelope manualmente y devuelve. Sólo `listIssues` recibe esta forma; los demás métodos (`getIssue`, `addComment`, ...) devuelven el JSON parseado tal cual.

### Implementación recomendada (sketch JSDoc)

```js
/**
 * @param {string} owner
 * @param {string} repo
 * @param {{ labels?: string[], state?: 'open'|'closed'|'all', since?: string, etag?: string, per_page?: number }} [opts]
 * @returns {Promise<{ status: 200 | 304, items: any[], etag: string | undefined, rate_limit_remaining: number | undefined }>}
 */
async listIssues(owner, repo, opts = {}) { ... }
```

---

## Error Mapping Table

Para `request(path, opts)` — el helper privado mapea HTTP → `Error` canónico. Phase 25 lee `.code`.

| HTTP | Caso | `.code` | `.status` | `.retryAfter` | Mensaje |
|------|------|---------|-----------|---------------|---------|
| 200, 201 | OK | — | — | — | (devuelve `res.json()`, no throw) |
| 304 (listIssues only) | Not Modified | — | — | — | (devuelve envelope, no throw) |
| 401 | Unauthorized | `unauthorized` | 401 | — | `GitHub API 401: ${path} — ${snippet}` |
| 403 (con `Retry-After` o `X-RateLimit-Remaining === '0'`) | Rate limit secondary o primary | `rate_limit_exceeded` | 403 | `parseInt(Retry-After)` o `undefined` | `GitHub API 403 rate limit: ${path}` |
| 403 (otros) | Sin scope o failed-login-limit | `forbidden` | 403 | — | `GitHub API 403: ${path} — ${snippet}` |
| 404 | Not Found | `not_found` | 404 | — | `GitHub API 404: ${path}` |
| 410 | Locked | `github_api_error` | 410 | — | `GitHub API 410: ${path} — ${snippet}` |
| 422 | Validation / secondary throttle | `github_api_error` | 422 | (si header presente) | `GitHub API 422: ${path} — ${snippet}` |
| 429 | Too Many Requests | `rate_limit_exceeded` | 429 | `parseInt(Retry-After)` o `undefined` | `GitHub API 429: ${path}` |
| 5xx | Server error | `github_api_error` | (status) | — | `GitHub API ${status}: ${path} — ${snippet}` |
| Network/timeout | `AbortError`/`TypeError` | `github_api_error` (o reemitir) | — | — | dejar bubble del `Error` original con prefijo |

**`Retry-After` parsing (Pitfall #4):** GitHub puede devolver tanto un entero (segundos) como una HTTP-date. Recomendado:

```js
function parseRetryAfter(header) {
  if (!header) return undefined;
  const asInt = parseInt(header, 10);
  if (!isNaN(asInt) && String(asInt) === header.trim()) return asInt;
  const asDate = Date.parse(header);
  if (!isNaN(asDate)) return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
  return undefined;
}
```

**Error shape:**

```js
const err = new Error(`GitHub API ${status}: ${path} — ${snippet}`);
err.code = 'rate_limit_exceeded';      // o el code que toque
err.status = 429;
err.retryAfter = 60;                    // segundos, undefined si no aplica
throw err;
```

---

## Testing Strategy

### Por qué `fetch` injection (D-06) > global mocking

El precedente Plane (ver `test/plane-provider.test.js:62-77`) reasigna `globalThis.fetch` y restaura en `finally`. Funciona pero:
- Acopla los tests al global state — un test que olvide `restore()` envenena los demás.
- No es threadsafe si en el futuro corremos `node --test --concurrency=N`.
- Hace difícil testear dos clientes con stubs distintos en el mismo test.

Pasar `fetch` por constructor opts es 4 líneas más y elimina los tres problemas:

```js
const client = new GitHubClient({
  token: 'ghp_test',
  fetch: makeFakeFetch({ status: 200, body: issueFixture, headers: { etag: 'W/"abc"' } }),
});
```

### `Response`-like fake (el shape mínimo que el cliente lee)

El cliente sólo usa: `res.status`, `res.ok`, `res.headers.get(name)`, `res.json()`, `res.text()`. Por tanto:

```js
/**
 * @param {{ status: number, body?: any, headers?: Record<string,string> }} scenario
 * @returns {typeof fetch}
 */
function makeFetch(scenario) {
  return async (_url, _init) => ({
    status: scenario.status,
    ok: scenario.status >= 200 && scenario.status < 300,
    headers: {
      get(name) { return scenario.headers?.[name.toLowerCase()] ?? null; },
    },
    async json() {
      if (scenario.status === 304) throw new Error('No body for 304');
      return scenario.body;
    },
    async text() {
      return scenario.body ? JSON.stringify(scenario.body) : '';
    },
  });
}
```

**Por qué no usar `new Response(JSON.stringify(body), {status, headers})`:** funciona y es lo que hace Plane, pero `Headers` global es case-insensitive y eso oculta bugs cuando el cliente lee header names incorrectos. El fake explícito hace los bugs visibles.

### Fixtures shape (≥ 9 files en `test/fixtures/github/`)

Cada fixture es un JSON capturado de respuesta REAL de GitHub (redactado: cambiar `owner`/`repo` a `kodo-test`/`fixture-repo`, IDs a valores deterministas, URLs `https://github.com/kodo-test/fixture-repo/...`).

**Ejemplos shape-only (NO 80KB dumps):**

`test/fixtures/github/issue.json` (respuesta a `GET /repos/.../issues/42`):
```json
{
  "id": 1,
  "node_id": "I_kwTEST001",
  "number": 42,
  "title": "Test issue",
  "body": "Issue body markdown",
  "labels": [{ "id": 1, "node_id": "LA_TEST001", "name": "kodo", "color": "0e8a16", "default": false, "description": null }],
  "state": "open",
  "state_reason": null,
  "html_url": "https://github.com/kodo-test/fixture-repo/issues/42",
  "pull_request": null,
  "assignees": [],
  "user": { "login": "kodo-test", "id": 1 },
  "created_at": "2026-05-14T07:00:00Z",
  "updated_at": "2026-05-14T08:00:00Z",
  "locked": false,
  "comments": 0
}
```

`test/fixtures/github/issues-list.json` — array de 2 elementos: una issue y una PR (con `pull_request` ≠ null) para validar el filter en Phase 24.

`test/fixtures/github/rate-limit-low.json` — issue payload normal (el header `X-RateLimit-Remaining: 99` se inyecta vía `scenario.headers`).

`test/fixtures/github/not-modified-304.json` — meta-fixture, body vacío `{}` (no se usa en json() para 304 pero permite share la estructura del scenario).

`test/fixtures/github/unauthorized-401.json`:
```json
{ "message": "Bad credentials", "documentation_url": "https://docs.github.com/rest" }
```

`test/fixtures/github/not-found-404.json`:
```json
{ "message": "Not Found", "documentation_url": "https://docs.github.com/rest" }
```

`test/fixtures/github/rate-limit-exceeded.json`:
```json
{ "message": "API rate limit exceeded for user ID 1.", "documentation_url": "https://docs.github.com/rest/overview/rate-limits-for-the-rest-api" }
```

### Test cases mínimos (≥ 8, recomendado 12)

| # | Test | Fixture | Asserts |
|---|------|---------|---------|
| 1 | `getIssue` happy path | `issue.json` | devuelve raw payload, `_rateRemaining` actualizado |
| 2 | `listIssues` 200 + ETag | `issues-list.json` | envelope `{status:200, items:[...], etag:'W/"..."', rate_limit_remaining: number}` |
| 3 | `listIssues` 304 envelope | (sin body) | envelope `{status:304, items:[], etag, rate_limit_remaining}`; **NO throw** |
| 4 | `listIssues` envía `If-None-Match` cuando `opts.etag` | spy en init | header presente con valor opaco |
| 5 | `listIssues` envía `since`, `labels`, `state` correctamente | spy en URL | querystring `?state=open&labels=kodo&since=...&per_page=100` |
| 6 | Constructor: token ausente → throw `'GitHub token not found'` | — | `assert.throws` |
| 7 | `401` → `Error` con `.code === 'unauthorized'` | `unauthorized-401.json` | assert err.code, err.status |
| 8 | `404` → `Error` con `.code === 'not_found'` | `not-found-404.json` | |
| 9 | `429` con `Retry-After: 60` → `.code === 'rate_limit_exceeded'`, `.retryAfter === 60` | `rate-limit-exceeded.json` | |
| 10 | `403` con `X-RateLimit-Remaining: 0` → `rate_limit_exceeded` | `rate-limit-exceeded.json` | |
| 11 | Rate-limit warn: `Remaining: 50` → emite NDJSON con level=`warn` | logger spy | record contains `level:'warn'`, `event:'github.api.call'`, `rate_limit_remaining:50` |
| 12 | `addComment` envía body markdown como `{body: ...}` | spy en init.body | parsea body, asserts `body.body === 'mi comentario'` |

**Logger spy** — patrón mínimo:
```js
function makeSpyLogger() {
  const records = [];
  return {
    records,
    info: (event, fields) => records.push({ level: 'info', event, ...fields }),
    warn: (event, fields) => records.push({ level: 'warn', event, ...fields }),
    error: (event, fields) => records.push({ level: 'error', event, ...fields }),
  };
}
```

### Anti-network guard

Para asegurar zero live API calls (SC#4): el constructor en cada test SIEMPRE inyecta `fetch`. Como salvaguarda extra opcional, un test al final de la suite que verifique:

```js
it('no live network calls — globalThis.fetch unchanged', () => {
  assert.equal(globalThis.fetch, originalFetch);
});
```

(No es estrictamente necesario si seguimos D-06, pero documenta la intención.)

---

## NDJSON Event Additions

### Shape exacta — `github.api.call`

Emitido por `_request` **cuando `res.ok === true`** (no en errores).

| Field | Type | Source |
|-------|------|--------|
| `event` | `'github.api.call'` | constant |
| `method` | `'GET'|'POST'|'PATCH'` | `opts.method || 'GET'` |
| `path` | `string` | first arg of `request()` (e.g., `/repos/owner/repo/issues/42`) |
| `status` | `200|201|304` | `res.status` |
| `duration_ms` | `number` | `Date.now() - started` |
| `rate_limit_remaining` | `number|undefined` | parsed from `X-RateLimit-Remaining` header |

**Level switch:** `info` por default, `warn` si `rate_limit_remaining < 100`.

```js
export function githubApiCall(logger, fields) {
  const level = (typeof fields.rate_limit_remaining === 'number' && fields.rate_limit_remaining < 100)
    ? 'warn'
    : 'info';
  logger[level](EVENTS.GITHUB_API_CALL, {
    event: EVENTS.GITHUB_API_CALL,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    duration_ms: fields.duration_ms,
    rate_limit_remaining: fields.rate_limit_remaining,
  });
}
```

### Shape exacta — `github.api.call.failed`

Emitido cuando el response es `!res.ok` (y antes del throw). Mirror `planeApiCallFailed` pero con `path/method/status` en lugar de `step`.

| Field | Type | Source |
|-------|------|--------|
| `event` | `'github.api.call.failed'` | constant |
| `method` | `'GET'|'POST'|'PATCH'` | |
| `path` | `string` | |
| `status` | `number` | |
| `error` | `string` | message snippet (no the full Error stack) |

```js
export function githubApiCallFailed(logger, fields) {
  logger.error(EVENTS.GITHUB_API_CALL_FAILED, {
    event: EVENTS.GITHUB_API_CALL_FAILED,
    method: fields.method,
    path: fields.path,
    status: fields.status,
    error: fields.error,
  });
}
```

### Extensión `EVENTS` frozen

```js
export const EVENTS = Object.freeze({
  // ... 13 existing ...
  GITHUB_API_CALL:        'github.api.call',
  GITHUB_API_CALL_FAILED: 'github.api.call.failed',
});
```

Y actualizar el JSDoc `@type` cabecera del objeto + el bloque comment del top of file.

### LOG-12 invariant preservation argument

`logger-events.js` actualmente importa solo `node:os` y `node:path` (stdlib). Phase 23 añade dos helpers que tampoco importan nada — solo manipulan `fields` y delegan a `logger[level](...)`. **No introduce ningún edge nuevo en el grafo de imports.** El test contract `check-isolation.test.js` (existente) seguirá pasando sin modificación.

**Validación recomendada en plan:** correr `npm test -- check-isolation` después de modificar `logger-events.js` y antes del commit.

### Riesgo en `test/logger-events.test.js`

El test contract (líneas 50-68 del archivo) hardcodea **todos los 13 event types** en un `assert.deepEqual(types.sort(), [...])`. Plan Phase 23 **debe** actualizar este array para incluir `github.api.call` y `github.api.call.failed` (y los helpers nuevos en la lista de imports).

```js
// nuevo array esperado (15 entries):
assert.deepEqual(types, [
  'github.api.call',
  'github.api.call.failed',
  'gsd.bootstrap',
  'gsd.phase.resolved',
  'orchestrator.review',
  'plane.api.call',
  'plane.api.call.failed',
  'session.end',
  'session.start',
  'skill.sync.auto',
  'skill.sync.auto.error',
  'state.transition',
  'worktree.cleanup.dirty',
  'worktree.cleanup.error',
  'worktree.cleanup.ok',
]);
```

---

## Risks / Pitfalls

### Pitfall #1: `body` puede ser `null` en issues sin descripción

**Qué pasa:** GitHub devuelve `body: null` cuando la issue fue creada sin descripción. Phase 24 normalizer debe defaultear a `""`. **Phase 23** simplemente devuelve el raw — pero el plan debe documentar este edge case en el JSDoc de `getIssue` y en uno de los fixtures (`issue.json` puede tener `body: null` en una variante).

### Pitfall #2: `listIssues` devuelve PRs intermixed

**Qué pasa:** GitHub considera PRs como "issues con un campo `pull_request`". `GET /repos/.../issues` devuelve ambos. **Phase 23** entrega el array raw; **Phase 24** filtra `if (item.pull_request) skip` antes de normalizar a `TaskItem`. El plan Phase 23 debe **documentar este contract** en el JSDoc de `listIssues` para que Phase 24 no se sorprenda.

### Pitfall #3: GitHub Enterprise self-hosted devuelve headers ligeramente distintos

**Qué pasa:** GHE Server puede no incluir `X-GitHub-Api-Version` requerement, o cambiar `X-RateLimit-Resource` semantics. **Out of scope v0.7** (D-31), pero el cliente recibe `opts.baseUrl` por si futuro. Plan: no añadir asserts sobre headers GitHub-specific que fallen en GHE.

### Pitfall #4: `Retry-After` puede ser entero O HTTP-date

**Qué pasa:** RFC 7231 permite ambos formatos. GitHub históricamente usa entero, pero el spec admite ambos y herramientas como Apache pueden inyectar el formato date. Mitigación: helper `parseRetryAfter` (ver §Error Mapping).

### Pitfall #5: `since` filter es por `updated_at`, exclusive en el límite

**Qué pasa:** Si llamas `?since=2026-05-14T08:00:00Z` y existe una issue con `updated_at = 2026-05-14T08:00:00Z` exacto, **NO** vuelve (límite exclusive según comportamiento empírico GitHub). Phase 25 debe usar el `updated_at` máximo visto + 1ms como cursor o aceptar que no procesa events en el mismo segundo dos veces. **Phase 23 no se preocupa** — solo pasa `since` literal.

### Pitfall #6: ETag invalidation por cambio de query

**Qué pasa:** Si Phase 25 envía `?labels=kodo` la primera vez y `?labels=kodo,foo` la segunda, **el ETag cambia** independientemente de si las issues cambiaron. El cache debe key-ear por `(owner, repo, labels, state)` no solo por `(owner, repo)`. **Documentar en el contract de `listIssues` (JSDoc).**

### Pitfall #7: GitHub puede caer (5xx) durante mantenimiento

**Qué pasa:** 502/503 son comunes durante deploys de GitHub.com. Phase 23 surface como `github_api_error`; Phase 25 retry. **No imprimir en `console.warn` desde el cliente** — solo emit NDJSON. El path actual `console.warn` de Plane (línea 39, 64) es legacy y el cliente GitHub debe usar exclusivamente logger optional-chain.

### Pitfall #8: `headers.get()` con node `fetch` devuelve `string | null`

**Qué pasa:** El header parsing debe normalizar `null` antes de `parseInt`. Esto Plane ya lo hace bien (líneas 56-59):
```js
const remaining = res.headers.get('x-ratelimit-remaining');  // string | null
if (remaining !== null) this._rateRemaining = parseInt(remaining, 10);
```
Replicar el mismo patrón en GitHub.

### Pitfall #9: AbortSignal.timeout fires después del header pero antes del body

**Qué pasa:** Si el server tarda en streamear el body, `res.json()` puede rechazar con `AbortError` aunque `fetch()` retornó. Plan: el catch de `res.json()` debe re-throw como `github_api_error`, no como network error.

### Pitfall #10: Tests dependientes de `Date.now()` flakean

**Qué pasa:** `duration_ms` es `Date.now() - started`. En tests rápidos puede ser 0. **Mitigación:** asserts `assert.ok(record.duration_ms >= 0)` en lugar de `assert.equal(record.duration_ms, X)`.

---

## Validation Architecture

> Nyquist validation ENABLED (per `.planning/config.json` → `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 20+ built-in; runtime in this env: v25.9.0) |
| Config file | None (uses Node.js defaults) |
| Quick run command | `node --test test/providers/github/client.test.js` |
| Full suite command | `npm test` |
| Required env | None (zero live API — fetch is injected) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| **GH-01.SC1** | `GitHubClient` exporta los 5 métodos | unit | `node --test test/providers/github/client.test.js` | ❌ Wave 0 |
| **GH-01.SC1** | Constructor lee token via `getProviderApiKey('github')` y throwea si falta | unit | idem | ❌ Wave 0 |
| **GH-01.SC1** | Cada request envía `Authorization: token <PAT>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent` | unit (spy on fetch init) | idem | ❌ Wave 0 |
| **GH-01.SC2** | Emite NDJSON `github.api.call` con level=warn cuando `X-RateLimit-Remaining < 100` | unit (logger spy) | idem | ❌ Wave 0 |
| **GH-01.SC2** | `429` → throw `Error` con `.code === 'rate_limit_exceeded'`, `.retryAfter` parseado | unit | idem | ❌ Wave 0 |
| **GH-01.SC3** | `listIssues({ etag })` añade `If-None-Match` header | unit (spy on fetch init headers) | idem | ❌ Wave 0 |
| **GH-01.SC3** | `listIssues` con respuesta 304 devuelve `{status:304, items:[], etag, rate_limit_remaining}` **sin throw** | unit | idem | ❌ Wave 0 |
| **GH-01.SC4** | ≥ 8 tests offline | unit | `node --test test/providers/github/client.test.js 2>&1 \| grep '^# tests' ` debe ser ≥ 8 | ❌ Wave 0 |
| **LOG-12 invariant** | `check-isolation.test.js` sigue verde tras extender `logger-events.js` | regression | `node --test test/check-isolation.test.js` | ✅ existe |
| **Logger taxonomy** | `logger-events.test.js` enumera 15 events (los 13 existentes + 2 nuevos) | regression | `node --test test/logger-events.test.js` | ✅ existe (debe actualizarse) |
| **Color isolation** | Ningún import de `picocolors` en `src/providers/github/client.js` o en los hunks añadidos de `logger-events.js` | grep | `grep -rn 'picocolors' src/providers/github/ src/logger-events.js \|\| echo OK` | n/a (grep) |

### Sampling Rate

- **Per task commit:** `node --test test/providers/github/client.test.js test/logger-events.test.js test/check-isolation.test.js` (< 2s total)
- **Per wave merge:** `npm test` (full suite — should remain green)
- **Phase gate:** `npm test` green + grep guards above + manual smoke con un PAT real (opcional, no bloqueante): `node -e "import('./src/providers/github/client.js').then(({GitHubClient}) => new GitHubClient().getIssue('octocat','hello-world',1).then(console.log))"`

### Wave 0 Gaps

- [ ] `test/providers/github/` — subdirectorio nuevo, crear.
- [ ] `test/providers/github/client.test.js` — covers GH-01 SC1-4. **Test-first recomendado** (RED → implementation → GREEN) por consistencia con Phase 21 Plan 21-02.
- [ ] `test/fixtures/github/` — subdirectorio nuevo, crear.
- [ ] `test/fixtures/github/*.json` — 9 fixtures (ver §Testing Strategy).
- [ ] **Update `test/logger-events.test.js`** — array de 13 → 15 events; añadir imports de `githubApiCall`, `githubApiCallFailed`.
- [ ] **Update `EVENTS` frozen object** en `src/logger-events.js` y JSDoc `@type` cabecera.
- [ ] No framework install needed (`node:test` built-in).

---

## Plan-shaping Recommendations

### Recommended breakdown: **3 plans, 2 waves**

**Plan 23-01: Logger events extension** (Wave 1, ~30 LOC + tests update)
- Add `GITHUB_API_CALL` + `GITHUB_API_CALL_FAILED` to `EVENTS` frozen.
- Add `githubApiCall(logger, fields)` helper with info/warn switch.
- Add `githubApiCallFailed(logger, fields)` helper.
- Update JSDoc `@type` cabecera + comment header listing the 15 events.
- Update `test/logger-events.test.js` — bump array to 15 events, add helper export asserts.
- **Output:** `logger-events.js` extended, `logger-events.test.js` green.
- **No downstream dependencies until Plan 23-02 lands.**

**Plan 23-02: GitHubClient core + fixtures + tests** (Wave 2, ~150 LOC client + ~9 fixtures + ~200 LOC tests)
- Create `src/providers/github/client.js` with `class GitHubClient`, private `request()`, 5 public methods.
- Create `test/fixtures/github/*.json` (9 fixtures).
- Create `test/providers/github/client.test.js` with ≥ 8 tests (recommend 12, see §Testing Strategy).
- **Depends on Plan 23-01** (the client invokes `githubApiCall` / `githubApiCallFailed`).
- **Output:** Client exports + tests green + fixtures committed.

**Plan 23-03 (optional, can run parallel to 23-02): Fixture capture script** (Wave 2, ~40 LOC)
- `scripts/capture-github-fixtures.js` (NEW) — toma un PAT vía `process.env.GITHUB_TOKEN` + un repo `owner/repo` desde argv, hace los 5 requests reales, redacta IDs/owners, escribe a `test/fixtures/github/`. **No se ejecuta en CI** — solo cuando un dev quiere refrescar fixtures.
- **Justificación:** D-34 dice "fixtures redactadas de respuestas REALES, captured via curl una sola vez". Un script de Node es más reproducible que `curl` con jq.
- **Si presupuesto ajustado, descartar** — los fixtures pueden generarse manualmente y commit. No es crítico para SC.

### Wave structure

```
Wave 1 (1 plan in parallel — none, this is a single small plan):
  └── Plan 23-01 (logger-events extension)

Wave 2 (1 or 2 plans in parallel):
  ├── Plan 23-02 (client core + tests) — depends on 23-01
  └── Plan 23-03 (fixture capture script — OPTIONAL) — independent, parallel-safe
```

### Alternative breakdowns considered

**Alt A: One mega-plan** — todo en un solo plan. **Rechazado:** mezcla la extensión del taxonomy contract (alto-riesgo, requiere actualizar tests existentes en otro archivo) con la creación del cliente nuevo (bajo-riesgo, archivo nuevo). Granularity coarse del proyecto admite plans medianos, pero esto pasaría de 400 LOC en un solo wave y dificultaría code review.

**Alt B: Four plans (split client core vs tests vs fixtures)** — separar `client.js` de los tests en plans distintos. **Rechazado:** GSD methodology favorece test-first; separar tests de implementation rompe el RED-GREEN flow y obliga a hacer un commit "test only" sin implementación = test broken on disk between commits.

**Recommended (locked):** la breakdown de 3 plans arriba. 2 waves, parallel-safe en wave 2.

### Estimated effort

- Plan 23-01: ~45 min (logger extension + update test contract).
- Plan 23-02: ~3-4 h (cliente + tests + fixtures + iteración hasta verde).
- Plan 23-03 (opcional): ~30 min.

**Total Phase 23: ~5 h** asumiendo zero blockers y fixtures generables sin live API (es OK porque las response shapes están documentadas arriba).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-fetch` package | `globalThis.fetch` nativo | Node 18+ (stable Node 20) | Zero deps. Locked by D-04. |
| `Authorization: token <PAT>` | Aún válido en 2026 | n/a | GitHub aún acepta ambos (`token` y `Bearer`) — `token` está locked por D-08. |
| `X-GitHub-Api-Version: 2022-11-28` | Latest = `2026-03-10` per docs.github.com | 2026-03-10 (per docs) | **Decisión:** mantener `2022-11-28` (lock CONTEXT D-39). El default sin header es `2022-11-28` hasta sunset 2028-03-10. **NO urge migrar.** Confidence MEDIUM — si Phase 25 polling encuentra incompatibilidad con `2022-11-28`, Phase 23 puede revisitar en v0.7.x. |

**Deprecated / outdated en training data:**
- "GitHub requires User-Agent header" — históricamente sí, hoy es **soft requirement** (requests sin UA funcionan pero no es buena ciudadanía; D-38 lock `User-Agent: kodo/0.7.x`).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El header `X-RateLimit-Remaining` está presente en respuestas 304 | §Conditional Fetch | LOW — si no está, `rate_limit_remaining` en envelope será `undefined`; Phase 25 puede defaultear. Verificación recomendada en la fixture capture script. |
| A2 | El `Retry-After` en GitHub es siempre integer en práctica (aunque RFC permite date) | §Error Mapping Pitfall #4 | LOW — el helper `parseRetryAfter` cubre ambos formatos. |
| A3 | `since` filter es exclusive en el límite inferior | Pitfall #5 | MEDIUM para Phase 25, irrelevante para Phase 23 (el cliente solo pasa el valor literal). |
| A4 | El switch info/warn en `rate_limit_remaining < 100` no rompe ningún consumer de NDJSON (e.g., `kodo logs --json`) | LOG-12 invariant | LOW — `kodo logs` lee NDJSON pero no filtra por level; verificar en plan que `logs --json` siga byte-deterministic. |
| A5 | Los fixtures pueden generarse manualmente (sin script de captura) sin perder fidelity | §Plan-shaping | LOW — las shapes están documentadas above; cualquier divergencia se corrige al primer run con PAT real. |

**Mitigación general:** A1 y A2 son verificables en menos de 5 minutos con un PAT real al inicio de Plan 23-02. El plan debe incluir una task de "validate fixture realism" como sanity check antes del merge.

---

## Open Questions

1. **¿`User-Agent` debe incluir versión hardcoded o leer de `package.json`?**
   - What we know: D-38 locked `kodo/0.7.x`. `package.json` actualmente dice `0.1.0`.
   - What's unclear: ¿bumping de versión es responsabilidad de Phase 23 o de un milestone release plan?
   - Recommendation: hardcodear `kodo/0.7.x` literal en Phase 23 (espejo de cómo PlaneClient no incluye UA). Bumping de `package.json` defer a milestone close.

2. **¿El test `check-isolation.test.js` necesita una assertion explícita sobre `github.api.call`?**
   - What we know: el test actual verifica que `src/check.js` no importa `src/logger.js` transitivamente.
   - What's unclear: si añadir nuevos events triggers algún import indirecto.
   - Recommendation: el plan ejecuta `check-isolation` después de cada commit de Plan 23-01 y 23-02 como gate. Sin nuevos asserts.

3. **¿Capturar fixtures requiere un repo de prueba dedicado en GitHub?**
   - What we know: D-34 dice "respuestas REALES, capturadas vía curl contra un repo personal del usuario, sin info sensible".
   - What's unclear: si Alex tiene un repo de fixtures listo o si Phase 23 debe crearlo.
   - Recommendation: documentar en el plan que el dev crea `kodo-test/fixture-repo` con 2-3 issues etiquetadas `kodo` antes de Plan 23-03 (o usar `kodo` mismo si es público).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + runtime | ✓ | v25.9.0 (>= 20.0.0 required) | — |
| `node:test` | Test runner | ✓ | built-in | — |
| `node:assert/strict` | Test assertions | ✓ | built-in | — |
| `globalThis.fetch` | HTTP transport | ✓ | built-in Node 20+ | — |
| `AbortSignal.timeout` | Request timeout | ✓ | built-in Node 20+ | — |
| GitHub PAT con `repo` scope | Fixture capture (Plan 23-03, OPTIONAL) | unknown (user-managed) | — | Generar fixtures manualmente con shapes documentadas en §Testing Strategy |
| `picocolors` | NOT USED in Phase 23 | n/a | n/a | Color isolation invariant — debe NO importarse |

**No external service required** — todos los tests son offline (D-36).

---

## Security Domain

> `security_enforcement` no está explícitamente seteado en `.planning/config.json` — tratamos como enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | PAT en env var (`getProviderApiKey('github')`); nunca logueado |
| V3 Session Management | no | Cliente HTTP stateless |
| V4 Access Control | no (delega a GitHub) | GitHub valida scopes server-side |
| V5 Input Validation | yes | `owner`/`repo` params se interpolan en URL — sanitizar (ver below) |
| V6 Cryptography | yes (TLS) | `https://api.github.com` only; nunca permitir downgrade |
| V8 Data Protection | yes | Token nunca aparece en logs, nunca en `Error.message`, nunca en NDJSON |
| V14 Configuration | yes | Token en `~/.kodo/.env` (file mode 0600), NO en `config.json` |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token leak en logs | Information Disclosure | El logger redactor (`src/logger.js`) ya redacta secrets via regex existente. **Plan validation:** correr `test/logger-redaction.test.js` con un payload que incluya `ghp_`-prefixed string para confirmar redaction. |
| Token en `Error.message` | Information Disclosure | El mensaje `GitHub API ${status}: ${path} — ${snippet}` NO incluye headers. `snippet` es el body de error, que no debería contener el token salvo en caso extremo de echo. Mitigación: trunca a 200 chars. |
| `owner`/`repo` injection en URL path | Tampering | Los métodos reciben strings posicionales. **Plan recomendado:** validar `owner` y `repo` contra `/^[\w.-]+$/` o usar `encodeURIComponent`. Decisión: usar `encodeURIComponent(owner)` + `encodeURIComponent(repo)` en la construcción del path. Esto evita SSRF si un caller pasa `..` o `?` malicioso. |
| TLS downgrade | Tampering | Hardcodear `https://` — el `opts.baseUrl` permite `http://127.0.0.1:<port>` para tests pero el constructor no debe **lower-case match** algún string a downgrade silencioso. Validar `baseUrl.startsWith('http')` y nada más. |
| Body de error con HTML/script | n/a (cliente Node, no DOM) | No aplicable — el body se trata como string opaco. |

---

## Sources

### Primary (HIGH confidence)
- [docs.github.com — Issues REST API](https://docs.github.com/en/rest/issues/issues) — endpoints, response shapes, status codes (verified 2026-05-14)
- [docs.github.com — Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — `X-RateLimit-*` headers, primary vs secondary, 5000/h PAT (verified 2026-05-14)
- [docs.github.com — Best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — ETag/If-None-Match, 304 no count rate limit (verified 2026-05-14)
- [docs.github.com — Authenticating to REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api) — `token` vs `Bearer`, 401/403/404 distinctions (verified 2026-05-14)
- [docs.github.com — Issue comments](https://docs.github.com/en/rest/issues/comments) — POST request body markdown, 201 status (verified 2026-05-14)
- [docs.github.com — Labels](https://docs.github.com/en/rest/issues/labels) — list endpoint shape (verified 2026-05-14)
- [docs.github.com — API versions](https://docs.github.com/en/rest/overview/api-versions) — `2026-03-10` latest, `2022-11-28` default until 2028 (verified 2026-05-14)

### Codebase (HIGH confidence)
- `src/providers/plane/client.js` — direct template (~120 LOC expected for `GitHubClient`)
- `src/providers/plane/provider.js` — factory pattern reference for Phase 24 (not touched in 23)
- `src/logger-events.js` lines 38-52 (EVENTS frozen), 145 (level switch pattern), 192-200 (planeApiCall), 211-217 (planeApiCallFailed)
- `src/config.js` line 160 (`getProviderApiKey`)
- `src/interface.js` (TaskProvider contract — informational only)
- `test/plane-provider.test.js` lines 62-77 (fetch stub pattern, anti-pattern: global mutation)
- `test/normalize.test.js` (provider test layout precedent)
- `test/logger-events.test.js` lines 50-68 (EVENTS contract — must be updated)
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check`, JSDoc, error pattern
- `.planning/codebase/TESTING.md` — `node:test` framework

### Secondary (MEDIUM confidence)
- None — all critical claims verified against primary docs.

### Tertiary (LOW confidence)
- None.

---

## Metadata

**Confidence breakdown:**

| Decision (from CONTEXT.md) | Confidence | Reason |
|---------------------------|------------|--------|
| D-01..D-03 (module shape) | HIGH | Direct mirror of established Plane pattern |
| D-04..D-06 (HTTP transport) | HIGH | Node 20+ fetch verified, D-06 improves over Plane |
| D-07..D-10 (auth) | HIGH | `getProviderApiKey` exists and works; `token` header verified vs docs |
| D-11..D-14 (retry/errors) | HIGH | Divergence from Plane justified by SC#2 + POLL-04 |
| D-15..D-18 (rate-limit obs) | HIGH | LOG-12 preserved (verified — only stdlib imports in logger-events.js) |
| D-19..D-21 (ETag/304) | HIGH | Envelope shape verified vs docs (304 contains X-RateLimit-* headers) |
| D-22..D-26 (method surface + no pagination) | HIGH | All 5 endpoints verified; pagination deferred to POLL via `since` cursor |
| D-27..D-29 (internal helpers, no proactive throttle) | HIGH | Divergence justified |
| D-30..D-31 (base URL) | HIGH | GHE deferred per REQUIREMENTS Out of Scope |
| D-32..D-36 (test infra) | HIGH | Patterns verified vs existing tests |
| D-37 (`GitHubClient` capitalization) | HIGH | GitHub's own canonical capitalization |
| D-38 (`User-Agent`) | MEDIUM | "soft requirement" per current docs; locked anyway by D-38 |
| D-39 (header order) | HIGH | Mirror of `octokit/rest` and GitHub examples |

**Confidence breakdown — research areas:**
- Standard stack: HIGH — zero new deps; Node 20+ stdlib only
- Architecture: HIGH — direct mirror of validated Plane pattern with 3 documented divergences
- Pitfalls: HIGH — verified vs primary docs; 10 pitfalls documented with mitigations
- Testing strategy: HIGH — `fetch` injection pattern is verifiable improvement over Plane's global mutation

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days; GitHub API is stable, X-GitHub-Api-Version 2022-11-28 supported until 2028)

---

## RESEARCH COMPLETE

Phase 23 has zero blockers. The planner has enough material to produce 3 plans (Plan 23-01: logger extension; Plan 23-02: client + tests; Plan 23-03 optional: fixture capture script). All critical decisions in CONTEXT.md are verified or carry an explicit Assumption tag with low risk and a documented mitigation. Recommended next action: `/gsd-plan-phase 23` to generate the 3 plan files.
