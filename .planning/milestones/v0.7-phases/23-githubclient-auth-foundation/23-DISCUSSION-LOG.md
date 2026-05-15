# Phase 23: GitHubClient + Auth Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 23-GitHubClient + Auth Foundation
**Mode:** `--auto --chain` (single-pass, recommended-option auto-selection)
**Areas discussed:** Module Shape, HTTP Transport, Auth, Retry & Error Surface, Rate Limit Observability, Conditional Fetch (etag/304), Method Surface, Pagination, API Base URL, Test Infrastructure

---

## Module Shape & Style

| Option | Description | Selected |
|--------|-------------|----------|
| `class GitHubClient` con constructor opts | Mirror exacto PlaneClient (`src/providers/plane/client.js:4`) | ✓ |
| Factory function `createGitHubClient(opts)` | Match con `createPlaneProvider` style (provider Phase 24) | |
| Mixin de functional helpers (objeto plano) | Sin clases, solo funciones exportadas | |

**Auto-selected:** Class. **Rationale:** PlaneClient analog directo; división class-vs-factory ya establecida (client = clase, provider = factory) en milestone v0.2.

---

## HTTP Transport

| Option | Description | Selected |
|--------|-------------|----------|
| `globalThis.fetch` nativo (Node 20+) | Zero deps, mirror PlaneClient | ✓ |
| `undici` (con `request`/`Pool`) | Más performance, pool de conexiones | |
| `node-fetch` polyfill | Compatibility-shim, hoy innecesario en Node 20 | |
| `axios` | Conveniencia, dep extra (~50KB) | |

**Auto-selected:** Native fetch. **Rationale:** Mirror Plane line 46. Bundle cero, Node 20+ ya disponible en `package.json engines`.

---

## fetch Injection for Tests

| Option | Description | Selected |
|--------|-------------|----------|
| Inyectar `opts.fetch` en constructor; default `globalThis.fetch` | Tests pasan fake fetch; no global mocking | ✓ |
| Usar `node:test` mock module reset | Mock global fetch desde test setup | |
| Spin-up de fake HTTP server con `node:http` | Tests hablan a `127.0.0.1:<port>` | |

**Auto-selected:** Constructor injection. **Rationale:** Mejora pequeña sobre PlaneClient (que no inyecta) — destraba testing puro sin contaminar global state.

---

## Token Sourcing

| Option | Description | Selected |
|--------|-------------|----------|
| `getProviderApiKey('github')` (existente) | Reuso del helper provider-agnostic | ✓ |
| Nuevo wrapper `getGithubToken()` | Mirror `getPlaneApiKey` deprecated style | |
| Lectura directa de `process.env.GITHUB_TOKEN` | Ignora config schema | |

**Auto-selected:** `getProviderApiKey('github')`. **Rationale:** El helper deprecated wrapper (`getPlaneApiKey`) ya existe como anti-precedente — no replicarlo.

---

## Retry Policy in Client

| Option | Description | Selected |
|--------|-------------|----------|
| **Zero retry** — surface `429` como `rate_limit_exceeded` | Phase 25 polling tiene retry exponential | ✓ |
| Exponential backoff mirror Plane (3 retries) | Mirror PlaneClient line 61-67 | |
| Simple linear retry (3 attempts, 1s pause) | Simpler subset | |

**Auto-selected:** Zero retry. **Rationale:** ROADMAP SC#2 explicit "rejects with canonical `rate_limit_exceeded` in 429"; POLL-04 (Phase 25) ya es el retry layer. Mezclar dos layers duplica tiempo y enmascara señal.

---

## Canonical Error Shape

| Option | Description | Selected |
|--------|-------------|----------|
| `Error` con `.code`, `.status`, `.retryAfter` props | Mínimo, sin clase custom | ✓ |
| Clase `RateLimitError extends Error` + clases por código | Discriminación por `instanceof` | |
| Devolver tuple `[error, value]` Go-style | Sin throw, caller chequea | |

**Auto-selected:** Plain Error + props. **Rationale:** YAGNI; `err.code === 'rate_limit_exceeded'` es testeable y matchea el patrón del repo (no hay clases custom de error en kodo).

---

## Rate Limit Observability

| Option | Description | Selected |
|--------|-------------|----------|
| Single event `github.api.call` + helper switch info/warn según `rate_limit_remaining < 100` | Mirror `orchestratorReview` switch | ✓ |
| Dos eventos `github.api.call` (info) + `github.rate_limit.warn` (warn) | Más explícito en NDJSON | |
| Solo console.warn directo (sin taxonomía) | Off-the-record, no NDJSON | |

**Auto-selected:** Single event con switch level. **Rationale:** Mantiene la taxonomía minimal (`logger-events.js` es cerrado por diseño); mirror el pattern `orchestratorReview` (`logger-events.js:145`).

---

## Conditional Fetch (etag / 304)

| Option | Description | Selected |
|--------|-------------|----------|
| **Stateless** — caller pasa etag, client devuelve etag | Polling Phase 25 persiste estado | ✓ |
| Cliente mantiene `Map<path, etag>` interna | Auto-condicional sin caller help | |
| Polling middleware separado en Phase 25 que envuelve cliente | Cliente puro sin etag awareness | |

**Auto-selected:** Stateless. **Rationale:** ROADMAP SC#3 explícito: `listIssues({ since, etag })` → `{ status, items, etag }`. Persistencia es POLL-02 (Phase 25 ~/.kodo/polling-state.json).

---

## Method Surface

| Option | Description | Selected |
|--------|-------------|----------|
| 5 métodos: `getIssue`, `listIssues`, `addComment`, `updateIssue`, `listLabels` | Locked por ROADMAP SC#1 | ✓ |
| Sólo `request(method, path, body)` genérico | Cliente "thin", provider Phase 24 escribe paths | |
| 9 métodos espejados del `TaskProvider` contract | Confunde la división client/provider | |

**Auto-selected:** 5 métodos. **Rationale:** ROADMAP lock; surfaces que Phase 24 normaliza.

---

## Method Signatures (positional vs object)

| Option | Description | Selected |
|--------|-------------|----------|
| Posicional `(owner, repo, number, ...)` | Mirror PlaneClient `(projectId, workItemId, ...)` | ✓ |
| Object `{ owner, repo, number, ...opts }` | Más explícito, evita order mistakes | |

**Auto-selected:** Positional. **Rationale:** Mirror Plane style; `<owner>/<repo>` es la unidad de granularity tipo `projectId`.

---

## Pagination Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| **Single page** (max `per_page` items) | Phase 25 polling usa cursor `since` | ✓ |
| Auto-paginate `Link` header | Devuelve array completo | |
| Async iterator que yield page-by-page | Lazy consumer-controlled | |

**Auto-selected:** Single page. **Rationale:** POLL-03 (Phase 25) usa `since` cursor; YAGNI auto-paginar antes de tener un caso real.

---

## API Base URL Configurability

| Option | Description | Selected |
|--------|-------------|----------|
| Default `https://api.github.com`, override via `opts.baseUrl` o config | Testing-friendly, GH Enterprise hook | ✓ |
| Hardcoded `https://api.github.com`, sin override | Más estricto, menos flexibilidad | |

**Auto-selected:** Configurable con default. **Rationale:** GH Enterprise out-of-scope v0.7 pero el hook queda sin extra cost; test fake server local lo necesita.

---

## Test Infrastructure

| Option | Description | Selected |
|--------|-------------|----------|
| `node:test` + fixtures JSON + `fakeFetch` inyectado | Mirror TESTING.md conventions | ✓ |
| `vitest` o `jest` (test runner externo) | Mejor DX (snapshot, mocks) | |
| `nock` HTTP mocking | Intercepta fetch globalmente | |
| Real GitHub API calls con repo de prueba | Cero mocking, depende de network | |

**Auto-selected:** node:test + inyección. **Rationale:** Convención repo (TESTING.md §Test Framework); zero deps; cumple SC#4 "zero live API calls".

---

## Fixture Naming Convention

| Option | Description | Selected |
|--------|-------------|----------|
| Por escenario: `issue.json`, `rate-limit-exceeded.json`, `not-modified-304.json` | Self-documenting | ✓ |
| Por endpoint + status: `GET_issues_200.json`, `GET_issues_429.json` | Más sistemático | |
| Combinados en un solo `scenarios.json` con index | Menos archivos | |

**Auto-selected:** Por escenario. **Rationale:** Mejor legibilidad en code review; cada test referencia su fixture por nombre semántico.

---

## Claude's Discretion

- **Symbol name:** `GitHubClient` (con H mayúscula) — matches GitHub branding.
- **Optional headers:** Plan puede añadir `User-Agent: kodo/0.7.x`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` — no bloqueante pero buen ciudadano.
- **Body snippet length on errors:** 200 chars, ajustable en plan.
- **Exact fixture count:** ≥ 8 mínimo (SC#4); voy con 9 para cubrir todas las branches del switch de errores (200 happy, 200 con rate-limit-low warn, 304, 401, 403, 404, 422, 429, 500).

## Deferred Ideas

- Auto-pagination del header `Link` (descartado D-25; re-evaluar en Phase 25 si polling real lo necesita).
- Proactive throttle estilo PlaneClient < 5 remaining → sleep (descartado D-29).
- GitHub Enterprise self-hosted (out-of-scope v0.7 explícito en REQUIREMENTS.md).
- Fine-grained PAT scope validation (out-of-scope v0.7).
- OAuth GitHub App (out-of-scope v0.7).
- GraphQL API support (v0.7 es REST only).
- Caché interna de issues en el cliente (anti-patrón — caché vive en Phase 25 polling-state.json).
- Real-time webhook ingress GitHub (descartado por trigger choice polling-only).
