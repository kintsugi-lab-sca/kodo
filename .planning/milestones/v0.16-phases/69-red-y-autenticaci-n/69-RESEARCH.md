# Phase 69: Red y autenticación - Research

**Researched:** 2026-07-06
**Domain:** HTTP server hardening (network binding, bearer auth, body limits, error hygiene, path/input validation) sobre Node.js `node:http` built-in
**Confidence:** HIGH (codebase-verified anchors + built-in Node.js APIs; cero dependencias externas)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** El token vive en `~/.kodo/.env` como `KODO_API_TOKEN`, escrito vía `writeEnvVar` (escritura atómica, chmod 0600 pre-rename). Coherente con PERSIST-04: secretos nunca en `config.json`. "El dashboard lee el token de config" = la config de kodo en sentido amplio (`~/.kodo/`, que incluye `.env`).
- **D-02:** Si no hay token al arrancar el server, se **auto-genera** (`crypto.randomBytes(32)` en base64url/hex) y se persiste vía `writeEnvVar` en el primer arranque. Se loguea `auth token: ENABLED` (sin imprimir el valor). NUNCA se arranca el carril sin auth "porque falta el token" (anti-patrón del HMAC opcional silencioso).
- **D-03:** La comparación del token es **timing-safe** (`crypto.timingSafeEqual`), coherente con la verificación HMAC del webhook.
- **D-04:** Modelo **default-deny**: el middleware de auth cubre TODAS las rutas excepto `/health` (abierto, booleano sin datos) y `/webhook` (conserva HMAC intacto, no se toca). Incluye `/`, `/dashboard` y cualquier ruta futura — fail-closed.
- **D-05:** El dashboard web embebido (`GET /` y `/dashboard`) acepta el token vía query param (`/?token=<token>`) para servir el HTML; el JS inline reutiliza ese token como header `Authorization: Bearer` en sus fetches. Sin token válido → 401 también para el HTML.
- **D-06:** Orden de checks: bind (TCP) → límite de body 1 MB **antes** de auth (413 pre-auth) → HMAC o bearer según carril → handler. El 413 NO requiere token.
- **D-07:** Un único helper adjunta `Authorization: Bearer <token>` en todas las peticiones de `src/cli/dashboard/client.js`; el token se lee de la misma fuente (`~/.kodo/.env`). Dashboard Ink, `kodo status`, attach de `kodo up` convergen en la misma lectura.
- **D-08:** Un 401 en el dashboard se presenta como estado claro ("No autorizado — revisa KODO_API_TOKEN"), never-throws/degradación visible; nunca pantalla vacía. `/health` queda abierto → los health-checks de `kodo up` no cambian.
- **D-09:** Los 500 devuelven `{"error":"internal error"}` (mensaje neutro fijo); `err.message` solo al log. El planner debe barrer TODOS los `res.end(...err.message...)` del server, no solo `server.js:584`.
- **D-10:** `sessionId` se valida con `/^[A-Za-z0-9_-]+$/` en el borde, antes de cualquier acceso a filesystem — ancla `src/logs/reader.js:66`, defensa en profundidad en `src/logger.js:250`. Rechazo con 400 (HTTP) / error+exit (CLI).
- **D-11:** La topología multi-nodo se documenta en una **sección nueva del README** («Topología multi-nodo»). Solo esa sección — la pasada completa es HYG-08 (Fase 72).

### Claude's Discretion

- Forma exacta del middleware/helper de auth (función en `server.js` vs módulo pequeño) — lo que case con el estilo del server actual.
- Formato exacto del token (hex vs base64url) y su longitud (≥32 bytes de entropía).
- Cómo se corta `readBody` a 1 MB (contador sobre chunks + destroy vs `content-length` primero) — mientras el corte sea pre-auth y responda 413.
- Ubicación y estilo de los tests (suite existente usa `node:test`, 1788 pass — seguir el patrón).
- Redacción exacta de la sección README de topología.

### Deferred Ideas (OUT OF SCOPE)

- Rotación/regeneración de token desde el dashboard — nice-to-have de DX, no lo pide ningún NET-*; candidato a backlog.
- Rate limiting del carril autenticado — fuera de scope de v0.16 (la exposición externa queda cerrada por bind + bearer).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NET-01 | El server bindea a `127.0.0.1` por defecto; `config.server.bind` permite exponerlo explícitamente | §Pattern 1 (bind), 2 call sites verificados `server.js:651,667`; `config.js:62-66` server block → añadir `bind` |
| NET-02 | Carril no-webhook exige `Authorization: Bearer <token>` — 401 sin token; dashboard lee token de config y lo envía; `/webhook` HMAC, `/health` abierto | §Pattern 2 (default-deny middleware), §Pattern 3 (timing-safe compare), §Pattern 5 (token gen/persist), §Pattern 6 (dashboard clients) |
| NET-03 | `readBody` corta a 1 MB pre-auth → 413 | §Pattern 4 (bounded readBody); anchor `server.js:380`, único consumidor es `/webhook` (line 618) |
| NET-04 | Errores 500 devuelven mensaje neutro; `err.message` solo al log | §Pattern 7 (error hygiene); anchor `server.js:584`, barrido completo del fichero |
| NET-05 | `sessionId` validado con `/^[A-Za-z0-9_-]+$/` antes de tocar filesystem | §Pattern 8 (sessionId guard); anchors `logs/reader.js:66`, `logger.js:250` |
| NET-06 | Topología multi-nodo documentada — bind a IP tailscale + ACL para el webhook de Plane | §Pattern 1 + §Documentación NET-06 |
</phase_requirements>

## Summary

Esta fase es un **endurecimiento quirúrgico** de un único fichero de servidor (`src/server.js`, `node:http` puro) más dos ficheros de config/cliente y una sección de README. No introduce arquitectura nueva ni dependencias: todo se resuelve con `node:crypto` (`randomBytes`, `timingSafeEqual`) y `node:http` built-in, reusando fontanería ya presente (`writeEnvVar` de Fase 67, el patrón timing-safe del HMAC de Plane). El invariante cross-milestone **"cero nuevas dependencias npm"** se respeta trivialmente.

El trabajo se descompone en seis cambios ortogonales, todos aditivos respecto a las respuestas 200 existentes (401/413/400 son códigos nuevos por ruta, no cambios de shape): (1) `listen(port, host)` con default `127.0.0.1`; (2) middleware default-deny de bearer con exención de `/health` y `/webhook`; (3) comparación timing-safe; (4) `readBody` acotado a 1 MB → 413 pre-auth; (5) barrido de fugas de `err.message`; (6) validación de `sessionId`. El punto de mayor fricción es la propagación del token al **dashboard web embebido** (HTML template string con 4 call sites de `fetch` que hoy no mandan header) y al **cliente Ink** (`client.js`, 4 funciones con `fetchFn` inyectable).

**Primary recommendation:** Implementar el orden exacto del server pipeline `body-limit → auth → route` en la cabecera del callback de `createServer`; generar el token con `crypto.randomBytes(32).toString('hex')` (NO base64 estándar — ver Pitfall 1); reusar el patrón try/catch de `timingSafeEqual` del provider Plane verbatim; inyectar el bearer en el cliente Ink vía un `fetchFn` envolvente pasado desde `index.js` (un solo punto), no tocando las firmas de `client.js`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Network bind / interface exposure | API/Backend (`server.js` listen) | Config (`config.js` default) | La superficie TCP la decide el proceso servidor; el default vive en config |
| Bearer authentication (carril no-webhook) | API/Backend (server middleware) | — | La autenticación SIEMPRE es responsabilidad del servidor, nunca del cliente |
| Token generation + persistence | API/Backend (server first-boot) | Storage (`~/.kodo/.env` 0600) | El server auto-genera al arrancar; el secreto se persiste fuera de git/config.json |
| Body size limit (413) | API/Backend (`readBody`) | — | Defensa contra amplificación: se corta en el borde de ingreso, pre-auth |
| Error message neutralization | API/Backend (route handlers) | — | La no-fuga de detalles es responsabilidad del emisor de la respuesta |
| sessionId input validation | API/Backend + CLI (borde) | — | Se valida donde el input no confiable entra al sistema (HTTP handler / CLI arg) |
| Bearer attachment (outbound) | Client (`client.js` Ink + HTML inline JS) | — | El cliente adjunta el header; la fuente del token es la config local compartida |
| Multi-node topology docs | Docs (README) | — | Documentación operativa de despliegue |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:crypto` (built-in) | Node 22.22.3 | `randomBytes(32)` para el token, `timingSafeEqual` para comparación constant-time | Ya usado por el HMAC del webhook (`src/providers/plane/provider.js:2`); zero-dep; estándar de facto en Node |
| `node:http` (built-in) | Node 22.22.3 | Server, `req.socket.destroy()`/`req.destroy()`, `res.writeHead(413/401/400)` | El server ya es `node:http` puro (`server.js:2`) |
| `writeEnvVar` (interno, `src/config.js:406`) | — | Persistir `KODO_API_TOKEN` atómico + chmod 0600 pre-rename | Fontanería de Fase 67, escritor único de secretos (PERSIST-04); reuso obligado por D-01 |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `loadEnvFile` (interno, `src/config.js:12`) | — | Pobla `process.env.KODO_API_TOKEN` desde `~/.kodo/.env` al import | Lectura del token en server y dashboard (misma fuente, D-01/D-07) |
| `node:test` + `node:assert` | Node 22.22.3 | Suite de tests (1788 pass + 1 skip) | Todos los tests de esta fase (`test: node --test $(find test -name '*.test.js')`) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Middleware inline en `server.js` | Módulo `src/server/auth.js` extraído | Un módulo pequeño con función pura `isAuthorized(req, token)` es más testeable (DI seam) y espeja `src/server/provider-state.js` / `src/server/dismiss.js` (patrón ya establecido). RECOMENDADO por consistencia, pero es discreción (D-Claude) |
| `crypto.randomBytes(32).toString('hex')` | `base64url` | hex es 64 chars ASCII `[0-9a-f]`, imposible de romper el parser naive del `.env`; base64url también sirve (sin padding). NUNCA base64 estándar (Pitfall 1) |
| Contador de bytes sobre chunks + `destroy()` | `Content-Length` header primero | El header es spoofeable / puede faltar en chunked; el contador real es la defensa robusta. Combinar: rechazo temprano si `Content-Length` ya excede, y contador como red de seguridad |

**Installation:**
```bash
# Ninguna. Invariante cross-milestone: cero nuevas dependencias npm.
```

## Package Legitimacy Audit

**N/A — esta fase no instala ningún paquete externo.** Invariante cross-milestone LOCKED (STATE.md): "Cero nuevas dependencias npm: locks/crypto vía `node:*` built-in; nada de `proper-lockfile`/`lockfile`/`express`/`helmet`". Todo el trabajo usa módulos built-in de Node (`node:crypto`, `node:http`, `node:fs`) y fontanería interna ya existente.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                          incoming HTTP request (node:http)
                                     │
                                     ▼
                    ┌────────────────────────────────┐
     TCP layer      │  server.listen(port, HOST)      │  HOST = config.server.bind ?? '127.0.0.1'
     (NET-01)       │  default 127.0.0.1 = loopback   │  (2 call sites: managed 651, legacy 667)
                    └────────────────────────────────┘
                                     │  (socket accepted only on bound iface)
                                     ▼
                    ┌────────────────────────────────┐
     Pipeline       │  1. BODY LIMIT (readBody ≤1MB)  │  → 413 if exceeded  (NET-03, PRE-AUTH, D-06)
     order (D-06)   │     applies to POST bodies      │     req.destroy(); no token required
                    └────────────────────────────────┘
                                     │
                       ┌─────────────┴─────────────┐
                       ▼                            ▼
              route == /health?              route == /webhook?
              route == /webhook?                   │
                       │ yes → SKIP auth            │ HMAC verifySignature (UNCHANGED)
                       ▼                            │  provider.verifySignature(rawBody, headers)
              ┌──────────────────┐                 │  invalid → 401 'Invalid signature'
     AUTH     │ 2. BEARER GUARD  │                 ▼
     (NET-02) │ default-deny     │            webhook handler (parseTriggerEvent → dispatch)
              │ Authorization:   │
              │ Bearer <token>   │  missing/invalid → 401 (neutral body, NO err detail)
              │ timingSafeEqual  │  (NET-02, D-03/D-04)
              └──────────────────┘
                       │ authorized
                       ▼
              ┌──────────────────────────────────────────────┐
     ROUTE    │ /status /logs /comments/:id DELETE /sessions/ │  → handlers
     handlers │ / /dashboard (HTML; token via ?token=, D-05)  │
              └──────────────────────────────────────────────┘
                       │
                       ▼
              ┌──────────────────────────────────────────────┐
     ERROR    │ 3. catch → res.end({error:'internal error'})  │  err.message → console.error only
     hygiene  │    (NET-04, sweep ALL err.message leaks)      │  (captured to ring buffer + stderr)
              └──────────────────────────────────────────────┘

  Outbound (clients attach the same token from ~/.kodo/.env):
    Ink dashboard  ── fetchFn wrapper (Bearer) ──▶ /status /logs /comments /sessions   (client.js, D-07)
    Web dashboard  ── inline JS fetch(..., {headers:{Authorization}}) ──▶ same routes   (D-05)
    kodo up gate   ── /health (open, no token) ──▶ readiness probe                      (unchanged, D-08)

  CLI (kodo logs <session-id>): sessionId → /^[A-Za-z0-9_-]+$/ guard ──▶ join(logDir, `${id}.ndjson`)  (NET-05)
```

### Recommended Project Structure
```
src/
├── server.js                    # bind host, body-limit, auth middleware, error sweep (núcleo del cambio)
├── server/
│   └── auth.js                  # (opcional, RECOMENDADO) isAuthorized() + getOrCreateToken() puros/testeables
├── config.js                    # server.bind default; reuso de writeEnvVar para KODO_API_TOKEN
├── logs/reader.js               # validación sessionId (NET-05, borde CLI)
├── logger.js                    # defensa en profundidad sessionId (línea 250)
└── cli/dashboard/
    ├── index.js                 # lee token, construye fetchFn con Bearer, lo pasa a App
    └── client.js                # SIN cambios de firma (recibe fetchFn ya envuelto) — D-07
README.md                        # sección «Topología multi-nodo» (NET-06)
```

### Pattern 1: Bind con default seguro (NET-01)
**What:** `server.listen(port, host)` donde `host = config.server.bind ?? '127.0.0.1'`.
**When to use:** Ambos modos de arranque (managed y legacy) — DEBEN comportarse igual.
**Anclas exactas (verificadas 2026-07-06):**
- `src/server.js:651` — modo managed: `server.listen(port, () => {...})` → `server.listen(port, host, () => {...})`
- `src/server.js:667` — modo legacy: `server.listen(port, () => {...})` → `server.listen(port, host, () => {...})`
- `src/config.js:62-66` — bloque `server` (`port: 9090, idle_threshold_min, stuck_threshold_min`) → añadir `bind: '127.0.0.1'` como default explícito, o resolver con `?? '127.0.0.1'` en el server (defensa contra configs viejas sin la clave).
```js
// Source: node:http docs — server.listen([port][, host][, callback])
// [CITED: nodejs.org/api/net.html#serverlistenport-host-backlog-callback]
const host = config.server.bind ?? '127.0.0.1';
server.listen(port, host, () => { /* ... */ });
```
**Nota:** `config.js` cachea `DEFAULT_CONFIG` sin `bind`. Resolver con `?? '127.0.0.1'` en el server hace el cambio robusto ante configs migradas de v0.15 que no tengan la clave (invariante zero-breaking-change).

### Pattern 2: Middleware default-deny de bearer (NET-02, D-04)
**What:** Guard al inicio del callback de `createServer`, tras extraer método/url y tras el body-limit, ANTES del dispatch de rutas. Exime `/health` y `/webhook`; todo lo demás exige `Authorization: Bearer <token>`.
**When to use:** Todas las rutas no-webhook. Fail-closed: una ruta futura sin entrada explícita queda protegida por defecto.
```js
// Pseudocódigo del pipeline (cabecera del handler de createServer)
// Source: patrón de exención mínima — allowlist de rutas ABIERTAS, no de rutas cerradas.
const isOpenRoute =
  (req.method === 'GET' && req.url === '/health') ||
  (req.method === 'POST' && req.url === '/webhook'); // /webhook usa HMAC, no bearer

if (!isOpenRoute) {
  const provided = parseBearer(req.headers['authorization']); // 'Bearer xxx' → 'xxx' | null
  if (!provided || !timingSafeTokenEqual(provided, TOKEN)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' })); // neutro, sin detalle
    return;
  }
}
```
**Sutileza D-05 (dashboard HTML):** `GET /` y `/dashboard` aceptan el token por query param (`/?token=<token>`), NO por header (el navegador no puede mandar Authorization en una navegación GET normal). El guard debe leer el token de `?token=` para estas dos rutas específicas y del header `Authorization` para el resto. Parsear con `new URL(req.url, 'http://localhost')` para separar path de query de forma robusta (hoy el server compara `req.url === '/status'` con string exacto — al añadir query params esa comparación se rompe; ver Pitfall 4).

### Pattern 3: Comparación timing-safe del token (NET-02, D-03)
**What:** `crypto.timingSafeEqual` sobre buffers de igual longitud, envuelto en try/catch (lanza si difieren en longitud).
**When to use:** Toda comparación del bearer. Espejo EXACTO del HMAC de Plane.
```js
// Source: src/providers/plane/provider.js:398-409 (patrón ya en el codebase, VERIFIED)
import { timingSafeEqual } from 'node:crypto';
function timingSafeTokenEqual(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  try {
    return a.length === b.length && timingSafeEqual(a, b);
    // timingSafeEqual THROWS si a.length !== b.length → el guard de length lo previene;
    // el try/catch es belt-and-suspenders (espejo del provider Plane).
  } catch {
    return false;
  }
}
```
**Nota de seguridad:** El check `a.length === b.length` antes de `timingSafeEqual` filtra por longitud (leak trivial e inevitable con esta API); como el token tiene longitud fija conocida (64 hex chars), esto no da ventaja al atacante.

### Pattern 4: `readBody` acotado a 1 MB → 413 pre-auth (NET-03, D-06)
**What:** Contador de bytes acumulados; si supera 1 MB, responder 413 y destruir el socket. Corte ANTES de auth y ANTES de HMAC.
**When to use:** `readBody` (`server.js:380`). Único consumidor actual: `POST /webhook` (`server.js:618`). El criterio de éxito exige "POST de 2 MB → 413 antes de autenticar; `/webhook` conserva HMAC".
```js
// Source: node:http streaming body pattern
// [CITED: nodejs.org/api/http.html#event-data]
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
function readBody(req, res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    // Rechazo temprano si Content-Length ya declara exceso (barato, pero spoofeable):
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
      req.destroy();
      return;
    }
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {           // red de seguridad real (chunked / header mentiroso)
        reject(Object.assign(new Error('payload too large'), { code: 'PAYLOAD_TOO_LARGE' }));
        req.destroy();                        // corta la conexión — no seguimos tragando 2 MB
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
```
El caller (`/webhook`) traduce `err.code === 'PAYLOAD_TOO_LARGE'` → `res.writeHead(413)`. El 413 se emite SIN verificar HMAC ni bearer (D-06: un atacante no autenticado no debe poder hacer tragar 2 MB al server).

**Decisión de firma:** `readBody` hoy recibe solo `req`. Añadir `res` (o devolver el error tipado y que el caller escriba 413) — la segunda opción es más limpia y no acopla `readBody` a la respuesta. RECOMENDADO: `readBody` rechaza con error tipado; el caller mapea a 413.

### Pattern 5: Generación y persistencia del token (NET-02, D-02)
**What:** Al arrancar el server, si `process.env.KODO_API_TOKEN` está ausente/vacío, generar `crypto.randomBytes(32).toString('hex')`, persistir vía `writeEnvVar('KODO_API_TOKEN', token)`, y actualizar `process.env` in-proceso. Loguear `auth token: ENABLED` (nunca el valor).
**When to use:** First-boot idempotente en `startServer`, antes de crear el listener.
```js
// Source: src/config.js:406 writeEnvVar (VERIFIED) + node:crypto randomBytes
import { randomBytes } from 'node:crypto';
import { writeEnvVar } from './config.js';
function getOrCreateApiToken() {
  let token = process.env.KODO_API_TOKEN;
  if (token && token.length > 0) return token;
  token = randomBytes(32).toString('hex'); // 64 hex chars — parser-safe (Pitfall 1)
  const ok = writeEnvVar('KODO_API_TOKEN', token); // atómico, chmod 0600 pre-rename
  if (!ok) {
    // writeEnvVar never-throws en fallo I/O → devuelve false. NO arrancar sin auth (D-02).
    throw Object.assign(new Error('could not persist KODO_API_TOKEN'), { code: 'KODO_TOKEN_WRITE_FAILED' });
  }
  process.env.KODO_API_TOKEN = token; // in-proceso: disponible sin re-leer .env
  console.log('[kodo] auth token: ENABLED'); // NUNCA el valor (PERSIST-04)
  return token;
}
```
**Consistencia con el patrón HMAC-missing (D-02):** el server ya lanza `{code:'KODO_SETUP_REQUIRED'}` bajo managed cuando falta el webhook secret (`server.js:463-464`). El token es distinto: NO se le pide al operador, se auto-genera. Solo se lanza si la persistencia falla (I/O), para no correr con auth deshabilitado silenciosamente.

### Pattern 6: Adjuntar el bearer en los clientes (NET-02, D-05/D-07)
**What (Ink, D-07):** Un único helper/fetchFn que envuelve `globalThis.fetch` inyectando `Authorization: Bearer <token>`. Se construye en `src/cli/dashboard/index.js` (donde ya se resuelve `baseUrl` y se lee config) y se pasa como `fetchFn` a `App` → `client.js`. Las firmas de `client.js` (`fetchStatus`/`fetchComments`/`fetchLogs`/`dismissSession`, todas ya `(...args, fetchFn = globalThis.fetch)`) NO cambian — solo reciben un fetchFn ya autenticado. Cero duplicación (D-07).
```js
// Source: src/cli/dashboard/client.js (fetchFn injectable seam, VERIFIED líneas 49,95,135,178)
function makeAuthedFetch(token, base = globalThis.fetch) {
  return (url, opts = {}) =>
    base(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
// index.js: const fetchFn = makeAuthedFetch(process.env.KODO_API_TOKEN); render(<App fetchFn={fetchFn} .../>)
```
**What (web dashboard HTML, D-05):** `dashboardHtml()` (`server.js:76-373`) es un template string con 4 call sites de `fetch` que hoy NO mandan header:
- `refresh()` → `fetch('/status')` (línea ~345)
- `refreshLogs()` → `fetch('/logs')` (línea ~286)
- `toggleComments()` → `fetch('/comments/' + ...)` (línea ~231)
- `deleteSession()` → `fetch('/sessions/' + ..., {method:'DELETE'})` (línea ~221)

`dashboardHtml()` debe pasar a aceptar el token e inyectarlo en el JS inline (p. ej. `const TOKEN = "<token>";` + un `authedFetch` inline que añade el header a las 4 llamadas). El token entra por `?token=` en la navegación inicial (D-05); el guard de auth valida ese query param para `/` y `/dashboard`.

**Nota:** `kodo status` (`src/cli/stop-status.js`) es un "booleano de vida" que NO consume `/status` HTTP (usa liveness de PID) y `kodo up` sondea `/health` (abierto) — ninguno necesita el token (verificado). Los únicos consumidores autenticados son el dashboard Ink y el dashboard web.

### Pattern 7: Higiene de errores 500 (NET-04, D-09)
**What:** Barrer TODOS los `res.end(JSON.stringify({ error: err.message }))` y sustituir por `{error:'internal error'}`; `err.message` va a `console.error` (que el ring buffer + stderr ya capturan vía `makeSafeConsoleWriter`).
**Anclas (verificadas):**
- `src/server.js:584` — carril `/comments/:id`: `res.end(JSON.stringify({ error: err.message }))` → **LEAK confirmado** (NET-04/B10).
- `src/server.js:625-627` — carril `/webhook`: YA devuelve `{error:'Bad request'}` genérico (400), y loguea `err.message` a `console.error`. **Correcto, no tocar** (pero verificar que sigue así tras el refactor de readBody).
- Barrido: `grep -n "err.message\|error: e\.\|\.message" src/server.js` para no dejar ninguno en un `res.end`/`res.writeHead`. El único en cuerpo de respuesta es la línea 584.
```js
// Source: src/server.js:582-585 (anchor)
} catch (err) {
  console.error(`[kodo] /comments error: ${err.message}`); // detalle SOLO al log
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'internal error' }));     // neutro al cliente
}
```

### Pattern 8: Validación de `sessionId` (NET-05, D-10)
**What:** `/^[A-Za-z0-9_-]+$/` en el borde, antes de construir el path de fichero.
**Anclas (verificadas):**
- `src/logs/reader.js:66` — `join(KODO_DIR, 'logs', \`${sessionId}.ndjson\`)`: validar `sessionId` JUSTO antes (línea 65-66). Contexto CLI (`kodo logs <session-id>`): rechazo → `process.stderr.write` + `process.exit(2)` (coherente con los exits ya presentes, líneas 54/62).
- `src/logger.js:250` — `join(logDir, \`${sessionId}.ndjson\`)`: defensa en profundidad. **CUIDADO** (Pitfall 3): `createLogger` se invoca con ids sintéticos (`'reconcile'`) y con session ids reales. Validar aquí con throw podría regresionar arranques legítimos si algún id real contiene chars fuera del set. Verificar el formato de los session ids reales antes de endurecer con throw; si hay riesgo, validar solo en el borde (reader.js) y en logger.js usar un `console.warn` + sanitizar, no throw.
```js
// Source: patrón de allowlist (mismo espíritu que validateEnvKey, config.js:351)
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
  process.stderr.write(`Invalid session id\n`);
  process.exit(2);
}
```
**Nota:** El carril HTTP `/comments/:id` y `DELETE /sessions/:id` usan `task_id` (no `sessionId`) y ya hacen `decodeURIComponent` con guard de segmento vacío (`server.js:596-603`, T-39-01). NET-05 es específicamente el `sessionId` que se convierte en nombre de fichero (B6), no el task_id.

### Anti-Patterns to Avoid
- **Allowlist de rutas CERRADAS en vez de ABIERTAS:** enumerar los 4-5 endpoints protegidos se desactualiza cuando alguien añade una ruta. D-04 exige default-deny: allowlist de las DOS rutas abiertas (`/health`, `/webhook`), todo lo demás cerrado.
- **base64 estándar para el token:** rompe el parser del `.env` (Pitfall 1). hex o base64url.
- **Comparar el token con `===`:** timing attack. Siempre `timingSafeEqual` (D-03).
- **413 después de auth:** un atacante no autenticado podría forzar 2 MB de buffering. El límite va PRE-auth (D-06).
- **Loguear el token:** ni en el `auth token: ENABLED`, ni en `/status`, ni en argv (PERSIST-04, mismo cuidado que la API key).
- **Cambiar la shape de las respuestas 200:** invariante v0.9 (respuestas JSON aditivas). 401/413/400 son códigos nuevos, no cambios de shape.
- **Añadir endpoints nuevos:** invariante "cero endpoints nuevos desde v0.10". Esta fase endurece los existentes.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Comparación constant-time | Loop XOR manual / `===` | `crypto.timingSafeEqual` (patrón del provider Plane) | Manual leaks por early-return; `timingSafeEqual` es la primitiva correcta |
| Token aleatorio | `Math.random()` / timestamp | `crypto.randomBytes(32)` | `Math.random` no es CSPRNG; 32 bytes = 256 bits de entropía |
| Escritura del secreto a `.env` | `fs.writeFileSync` directo | `writeEnvVar` (config.js:406) | Ya hace atómico + chmod 0600 pre-rename + parse-merge (no clobbea otras keys). Reuso obligado (D-01) |
| Parse de query string | split manual por `&`/`=` | `new URL(req.url, 'http://localhost').searchParams` | Maneja encoding/edge cases; ya hay `URL` en el HTML inline (safeHref) |
| Auth middleware / framework | Instalar `express`+`helmet`/`passport` | Guard inline `node:http` | Invariante cero-deps; el server es 250 líneas de `node:http`, un framework es sobreingeniería |

**Key insight:** Todo lo "peligroso" de esta fase (crypto, escritura de secretos) ya tiene una primitiva correcta EN EL CODEBASE. El trabajo es cablear, no inventar.

## Runtime State Inventory

> Esta fase no es un rename, pero introduce estado runtime nuevo (el token) y afecta al despliegue multi-nodo. Inventario relevante:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `KODO_API_TOKEN` nuevo en `~/.kodo/.env` (0600). No hay datos previos con este nombre. | Auto-generación en first-boot (Pattern 5); no hay migración de datos existentes |
| Live service config | Despliegues que exponen el server hoy (bind implícito a `0.0.0.0` de facto) pasarán a `127.0.0.1` por defecto → un despliegue multi-nodo que RECIBE el webhook de Plane desde otro nodo **dejará de recibirlo** hasta poner `config.server.bind` a la IP tailscale. | Documentar en README (NET-06) el paso de opt-in; el operador debe configurar `bind` explícitamente tras actualizar |
| OS-registered state | `brew services` lanza `kodo daemon run` bajo launchd (server-only). El bind por defecto `127.0.0.1` aplica igual bajo launchd. | Ninguna — el default seguro es correcto también para el servicio brew |
| Secrets/env vars | `KODO_API_TOKEN` (nuevo). Coexiste con `PLANE_API_KEY`, `KODO_WEBHOOK_SECRET_PLANE` en el mismo `.env`. `writeEnvVar` hace parse-merge → no clobbea las otras keys (verificado, config.js:427-437). | Ninguna acción destructiva; append idempotente |
| Build artifacts | Ninguno afectado (no cambia empaquetado ni Homebrew formula). | None — verificado: la formula v0.15.4 no referencia el token |

**Riesgo de despliegue clave:** el cambio de bind es **breaking para despliegues multi-nodo existentes** que dependían del bind abierto para recibir el webhook. Es exactamente lo que NET-06 documenta. El operador de kodo (single-user, self-hosted) debe leer la nota de release. No es un breaking silencioso: es el objetivo de la fase (cerrar T3).

## Common Pitfalls

### Pitfall 1: base64 estándar rompe el parser del `.env`
**What goes wrong:** `crypto.randomBytes(32).toString('base64')` produce chars `+`, `/`, `=`. `validateEnvValue` (config.js:366) rechaza cualquier valor con `/[#=\s]/` → `writeEnvVar` LANZA `TypeError`, el server crashea al arrancar.
**Why it happens:** El parser naive del `.env` parte por el primer `=` y trata `#` como comentario; por eso `writeEnvVar` valida y rechaza esos chars.
**How to avoid:** Usar `.toString('hex')` (verificado: `[0-9a-f]`, 64 chars, pasa la validación) o `.toString('base64url')` (verificado: sin padding `=`, usa `-`/`_`, pasa la validación). **NUNCA base64 estándar.** (Verificado empíricamente 2026-07-06: hex reject=false, base64url reject=false, base64 reject=true.)
**Warning signs:** `TypeError: writeEnvVar: valor inválido` en el primer arranque.

### Pitfall 2: `req.url === '/status'` se rompe con query params
**What goes wrong:** El server compara `req.url === '/status'` con string exacto (líneas 471, 477, 555, 610...). Al añadir `?token=` para el dashboard HTML (D-05), `req.url` pasa a ser `/?token=abc` y NINGUNA comparación exacta matchea → 404.
**Why it happens:** `req.url` incluye el query string completo.
**How to avoid:** Parsear una vez al inicio del handler: `const { pathname, searchParams } = new URL(req.url, 'http://localhost')` y comparar `pathname` en las rutas. Es un cambio transversal a TODAS las comparaciones de ruta — el planner debe barrer todas. Alternativa mínima: solo `/` y `/dashboard` necesitan query param, pero unificar con `URL` es más robusto y evita fragilidad futura.
**Warning signs:** El dashboard HTML sirve 404 cuando se abre con `?token=`.

### Pitfall 3: validar `sessionId` en `logger.js:250` con throw regresiona arranques
**What goes wrong:** `createLogger` (logger.js:240) se llama con ids sintéticos (`'reconcile'`) y session ids reales. Un throw estricto podría matar el reconcile loop o loggers legítimos si algún id real contiene un char fuera de `[A-Za-z0-9_-]`.
**Why it happens:** El id se usa como nombre de fichero pero también como binding de log; el conjunto real de ids no está garantizado idéntico al regex.
**How to avoid:** Validar con rechazo duro en el BORDE (reader.js:66, input no confiable del CLI). En logger.js:250 usar defensa suave: verificar el formato y, si falla, sanitizar o `console.warn`+abortar ese logger, NO throw que tumbe el proceso. Verificar primero cómo se generan los session ids reales (buscar el generador de sessionId) antes de decidir la severidad.
**Warning signs:** El server o el reconcile loop crashean tras el cambio; tests de logger que fallan con ids sintéticos.

### Pitfall 4: el body-limit del webhook debe preservar el HMAC intacto
**What goes wrong:** Al reescribir `readBody` para cortar a 1 MB, un error de refactor podría cambiar el `rawBody` que se pasa a `provider.verifySignature` (p. ej. truncar en vez de rechazar), rompiendo la verificación HMAC de webhooks legítimos < 1 MB.
**Why it happens:** El HMAC se computa sobre el `rawBody` EXACTO; cualquier alteración (truncado, re-encoding) invalida la firma.
**How to avoid:** Para bodies ≤ 1 MB, `readBody` devuelve el body COMPLETO byte-idéntico (mismo `Buffer.concat(chunks).toString()` de hoy). Solo bodies > 1 MB se rechazan con 413 (no se truncan). Test obligatorio: webhook legítimo de tamaño normal sigue pasando HMAC tras el cambio.
**Warning signs:** Webhooks de Plane empiezan a devolver 401 'Invalid signature' tras la fase.

### Pitfall 5: timing del token entre server y dashboard en first-boot
**What goes wrong:** Bajo `kodo up` (daemon + dashboard), si el daemon auto-genera el token y el proceso del dashboard ya cargó `process.env` (via `loadEnvFile` al import) ANTES de que se escribiera el `.env`, el dashboard no tendrá `KODO_API_TOKEN` → todas sus peticiones dan 401.
**Why it happens:** `loadEnvFile` corre una vez al import (config.js:30) y es load-no-override; no re-lee el `.env` si ya pasó.
**How to avoid:** Opciones: (a) generar el token en `kodo up`/setup ANTES de spawnear cualquier proceso hijo, o (b) que el dashboard, si obtiene 401, re-lea el `.env` una vez y reintente, o (c) documentar que el primer `kodo up` en una máquina limpia puede requerir un segundo arranque. RECOMENDADO (a): centralizar `getOrCreateApiToken()` en el arranque compuesto antes de renderizar el dashboard. El planner debe decidir el punto de generación. **Open Question #1.**
**Warning signs:** Dashboard muestra "No autorizado" en la primera ejecución tras instalar, se arregla al reiniciar.

## Code Examples

### Parse del bearer header
```js
// Source: convención Authorization: Bearer <token> (RFC 6750)
// [CITED: datatracker.ietf.org/doc/html/rfc6750#section-2.1]
function parseBearer(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
```

### Unificar path parsing (Pitfall 2)
```js
// Source: node:http + WHATWG URL (built-in global)
const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // luego comparar `pathname === '/status'` en vez de `req.url === '/status'`
  // y leer searchParams.get('token') para las rutas HTML (D-05)
  ...
});
```

### HMAC intacto (referencia — NO tocar)
```js
// Source: src/providers/plane/provider.js:398-409 (VERIFIED, no se modifica)
verifySignature(rawBody, headers) {
  const signature = headers['x-plane-signature'];
  if (!signature || !config.webhookSecret) return false;
  const expected = createHmac('sha256', config.webhookSecret).update(rawBody).digest('hex');
  try { return timingSafeEqual(Buffer.from(signature), Buffer.from(expected)); }
  catch { return false; }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.listen(port)` (bind implícito a todas las interfaces) | `server.listen(port, '127.0.0.1')` default | Esta fase (NET-01) | Cierra exposición externa (T3) |
| Carril no-webhook sin auth | Bearer default-deny | Esta fase (NET-02) | 401 sin token desde la LAN |
| `readBody` sin límite | Cap 1 MB → 413 pre-auth | Esta fase (NET-03) | Anti-amplificación |
| `res.end({error: err.message})` | `{error:'internal error'}` + log | Esta fase (NET-04) | No fuga de internals |

**Deprecated/outdated:**
- Ninguna dependencia deprecada. `node:http`, `node:crypto` son APIs estables de larga vida (Node 22 LTS).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `server.js:584` es la ÚNICA fuga de `err.message` en cuerpo de respuesta | Pattern 7 | Bajo — el planner debe grep el fichero completo (D-09 lo exige); si hay más, se barren igual |
| A2 | Los session ids reales caen dentro de `/^[A-Za-z0-9_-]+$/` | Pattern 8 / Pitfall 3 | Medio — validar en logger.js con throw podría regresionar; mitigado validando en el borde y usando defensa suave en logger.js. Verificar el generador de sessionId antes de endurecer |
| A3 | `kodo status` (stop-status.js) y `kodo up` gate NO consumen `/status` HTTP (usan PID/`/health`) | Pattern 6 | Bajo — verificado por grep (stop-status usa liveness de PID; up.js sondea `/health`, línea 105). Si algún consumidor CLI oculto pega a `/status`, dará 401 y necesitará el token |
| A4 | El único consumidor de `readBody` es `POST /webhook` (line 618) | Pattern 4 | Bajo — verificado por grep (`readBody` solo en 380 y 618) |
| A5 | Bajo `kodo up`, el orden de arranque permite que el dashboard vea el token | Pitfall 5 | Medio — depende del punto de generación; resolver en planning (Open Question #1) |

**Si esta tabla tiene ítems:** A2 y A5 son las asunciones que el planner/discuss deben confirmar antes de ejecutar (verificar generador de sessionId; decidir dónde se genera el token en el arranque compuesto).

## Open Questions

1. **¿Dónde se genera el token en el arranque compuesto (`kodo up` = daemon + dashboard)?**
   - What we know: el server auto-genera en first-boot (D-02); `writeEnvVar` persiste a `.env`; `loadEnvFile` es load-no-override al import.
   - What's unclear: si el dashboard (proceso/import) ya fijó `process.env` antes de la escritura, no verá el token en la primera ejecución (Pitfall 5).
   - Recommendation: generar `getOrCreateApiToken()` en el punto de arranque compuesto ANTES de spawnear/renderizar el dashboard, o hacer que el dashboard re-lea el `.env` ante un 401. Decidir en planning.

2. **¿Validación de `sessionId` en `logger.js:250` con throw o defensa suave?**
   - What we know: `createLogger` recibe ids sintéticos (`'reconcile'`) y reales; el borde real de input no confiable es `reader.js:66`.
   - What's unclear: si TODOS los session ids reales pasan `/^[A-Za-z0-9_-]+$/`.
   - Recommendation: rechazo duro en `reader.js` (borde CLI); en `logger.js` verificar primero el generador de session ids y usar defensa suave (no throw) si hay cualquier duda de regresión. Buscar el generador (`grep -rn "sessionId" src/session/` / donde se acuñan).

3. **¿`config.server.bind` con default en `DEFAULT_CONFIG` o resuelto con `?? '127.0.0.1'` en el server?**
   - What we know: configs de v0.15 migradas no tendrán la clave `bind`.
   - Recommendation: resolver con `?? '127.0.0.1'` en el server (robusto ante configs viejas) Y añadir la clave a `DEFAULT_CONFIG` para configs nuevas. Ambos, para máxima seguridad.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Todo el server | ✓ | 22.22.3 | — |
| `node:crypto` | Token gen + timing-safe | ✓ | built-in | — |
| `node:http` | Server | ✓ | built-in | — |
| `writeEnvVar` (interno) | Persistir token | ✓ | config.js:406 | — |
| Segundo nodo LAN (para test de 401) | Verificación de éxito NET-01/02 | ✗ (probablemente) | — | Simular con `curl` a la IP no-loopback en el mismo host, o test de integración que arranca el server en `127.0.0.1` y verifica que un fetch a la IP de red rechaza/da 401 |

**Missing dependencies with fallback:**
- El criterio de éxito "desde otro nodo de la LAN → 401" se puede verificar sin un segundo nodo físico: (a) test que arranca el server sin token en el request → 401; (b) test que arranca con `bind: '127.0.0.1'` y confirma que el listener NO acepta en la IP de red (bind assertion). El planner debe estructurar tests que no dependan de topología física.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert` (built-in, Node 22.22.3) |
| Config file | none — glob en package.json: `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/server-auth.test.js` (fichero nuevo de esta fase) |
| Full suite command | `npm test` (1788 pass + 1 skip baseline v0.15) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NET-01 | `listen` recibe host `127.0.0.1` por defecto; `config.server.bind` lo override | unit | `node --test test/server-bind.test.js` | ❌ Wave 0 |
| NET-02 | GET `/status` + DELETE `/sessions/:id` → 401 sin bearer; con token válido → 200; `/health` abierto; `/webhook` HMAC intacto | integration | `node --test test/server-auth.test.js` | ❌ Wave 0 |
| NET-02 | `timingSafeTokenEqual` rechaza longitud distinta y token incorrecto sin throw | unit | `node --test test/server-auth.test.js` | ❌ Wave 0 |
| NET-02 | Token auto-generado es hex 64-char, persistido vía writeEnvVar (mock envPath) | unit | `node --test test/server-token.test.js` | ❌ Wave 0 |
| NET-03 | POST de 2 MB → 413 antes de auth/HMAC; body ≤1MB → HMAC intacto | integration | `node --test test/server-body-limit.test.js` | ❌ Wave 0 |
| NET-04 | 500 devuelve `{error:'internal error'}`; `err.message` no aparece en el body | unit | `node --test test/server-error-hygiene.test.js` | ❌ Wave 0 |
| NET-05 | `sessionId` con char fuera de `[A-Za-z0-9_-]` → rechazo antes de tocar fs | unit | `node --test test/logs-reader.test.js` (extender existente si lo hay) | ⚠️ verificar |
| NET-06 | (doc) — verificación manual del README | manual | inspección de la sección «Topología multi-nodo» | N/A |

### Sampling Rate
- **Per task commit:** `node --test test/server-auth.test.js` (o el fichero tocado)
- **Per wave merge:** `npm test` (suite completa, debe seguir en 1788+ pass)
- **Phase gate:** Full suite green antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/server-auth.test.js` — 401 sin token / 200 con token / `/health` abierto / `/webhook` HMAC intacto (NET-02)
- [ ] `test/server-bind.test.js` — host default `127.0.0.1` + override (NET-01)
- [ ] `test/server-body-limit.test.js` — 2 MB → 413 pre-auth; body normal → HMAC OK (NET-03)
- [ ] `test/server-error-hygiene.test.js` — 500 neutro (NET-04)
- [ ] `test/server-token.test.js` — gen/persist con envPath inyectado (NET-02/D-02)
- [ ] sessionId validation: extender el test de `logs/reader.js` si existe, o crear `test/logs-reader-validation.test.js` (NET-05)
- [ ] Framework install: ninguno (built-in)

**Nota de testabilidad:** el server ya tiene seams DI (`_loadConfig`, `_provider`, `opts.managed`, `opts.port`), y `writeEnvVar`/`client.js` aceptan paths/fetch inyectables — los tests pueden ejercitar auth/token/body-limit offline sin red real ni tocar `~/.kodo/`.

## Security Domain

> `security_enforcement` no está en config.json → tratado como ENABLED. Esta fase ES una fase de seguridad (remediación de auditoría adversarial, causa raíz T3).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Default-deny (D-04); bind loopback por defecto (NET-01); documentar el modelo de confianza (NET-06) |
| V2 Authentication | yes | Bearer token con `crypto.timingSafeEqual`; token CSPRNG 256-bit; secreto en `.env` 0600 (D-01/D-02/D-03) |
| V3 Session Management | no | Token estático compartido (single-user self-hosted); sin sesiones/cookies. Rotación diferida (backlog) |
| V4 Access Control | yes | Default-deny middleware; `/health` y `/webhook` allowlist explícita; fail-closed para rutas futuras (D-04) |
| V5 Input Validation | yes | `sessionId` allowlist `/^[A-Za-z0-9_-]+$/` (NET-05); body size limit 1 MB (NET-03); query param `token` parseado con `URL` |
| V6 Cryptography | yes | `randomBytes(32)` (nunca `Math.random`); `timingSafeEqual` (nunca `===`); HMAC SHA-256 del webhook intacto |
| V7 Error Handling & Logging | yes | 500 neutro al cliente, detalle solo a log (NET-04); token nunca logueado (PERSIST-04) |
| V12 Files & Resources | yes | Path traversal en `sessionId`→nombre de fichero neutralizado por la allowlist (B6) |

### Known Threat Patterns for node:http server (single-user self-hosted)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Server escuchando en toda interfaz → acceso externo no autenticado (A1/T3) | Spoofing, Info Disclosure | Bind `127.0.0.1` por defecto; exposición explícita opt-in (NET-01) |
| Carril no-webhook sin auth → lectura/borrado de sesiones desde la LAN (M2) | Elevation of Privilege, Tampering | Bearer default-deny + timing-safe (NET-02) |
| Body no acotado → DoS por amplificación/memoria (M1) | Denial of Service | Cap 1 MB → 413 pre-auth (NET-03) |
| Timing attack sobre comparación del token | Info Disclosure | `crypto.timingSafeEqual` (D-03) |
| Fuga de internals vía `err.message` (B10) | Info Disclosure | Mensaje neutro + detalle a log (NET-04) |
| Path traversal vía `sessionId` → lectura arbitraria de ficheros (B6) | Tampering, Info Disclosure | Allowlist regex antes del `join` (NET-05) |
| Token en query string (`?token=`) → leak vía logs/referer (D-05) | Info Disclosure | Aceptado como tradeoff para el dashboard local; documentar; el carril primario (Ink/API) usa header. NO usar query param fuera de `/` y `/dashboard` |
| Slopsquatting / cadena de suministro | Tampering | N/A — cero dependencias nuevas (invariante) |

## Sources

### Primary (HIGH confidence)
- Codebase (VERIFIED, leído 2026-07-06): `src/server.js` (listen 651/667, readBody 380/618, error 584, rutas), `src/config.js` (writeEnvVar 406, validateEnvValue 366, server block 62-66, loadEnvFile 12), `src/providers/plane/provider.js:398-409` (patrón timing-safe HMAC), `src/cli/dashboard/client.js` (fetchFn seam), `src/logs/reader.js:66`, `src/logger.js:250`.
- Verificación empírica de encoding del token (2026-07-06): hex/base64url pasan `validateEnvValue`, base64 estándar la falla.
- `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` §Ola 1 (plan por hallazgo A1/M1/M2/B6/B10).
- `.planning/REQUIREMENTS.md` §Red y autenticación (NET-01..06 normativos).

### Secondary (MEDIUM confidence)
- [CITED: nodejs.org/api/net.html] — `server.listen(port, host, callback)`.
- [CITED: nodejs.org/api/http.html] — streaming body / `req.destroy()`.
- [CITED: nodejs.org/api/crypto.html] — `randomBytes`, `timingSafeEqual`.
- [CITED: datatracker.ietf.org/doc/html/rfc6750] — Authorization: Bearer.

### Tertiary (LOW confidence)
- Ninguna. Todo el material es codebase-verified o built-in API estándar.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps, todo built-in/codebase-verificado.
- Architecture: HIGH — anclas de código verificadas línea a línea; patrones espejo de código ya presente (HMAC, writeEnvVar).
- Pitfalls: HIGH — Pitfall 1 verificado empíricamente; Pitfalls 2-5 derivados de lectura directa del código.
- Open questions: 3 acotadas, ninguna bloquea el planning (todas resolubles con un grep o una decisión de punto de arranque).

**Research date:** 2026-07-06
**Valid until:** 2026-08-05 (30 días — dominio estable, built-in Node APIs; el único riesgo de deriva es que otro cambio toque `server.js` antes de ejecutar)
