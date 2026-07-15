# Phase 69: Red y autenticación - Pattern Map

**Mapped:** 2026-07-06
**Files analyzed:** 8 (6 modified + 2 new test/module candidates)
**Analogs found:** 8 / 8

Todos los ficheros de esta fase son endurecimiento quirúrgico de código existente. Cada cambio tiene un analog verbatim ya en el codebase (HMAC timing-safe, writeEnvVar, fetchFn seam, exits de reader.js). No hay arquitectura nueva ni deps.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/server.js` (MOD) | server/middleware | request-response | (self) rutas + `readBody` existentes | exact (in-file) |
| `src/server/auth.js` (NEW, opcional) | middleware/utility | request-response | `src/providers/plane/provider.js:398-409` (timing-safe) + `src/server/dismiss.js` (módulo puro DI) | role-match |
| `src/config.js` (MOD) | config | CRUD (env write) | `writeEnvVar` (`config.js:406`) + `server` block (`config.js:62-66`) | exact (in-file) |
| `src/cli/dashboard/client.js` (MOD firma-estable) | client | request-response | `fetchStatus/fetchComments` fetchFn seam (self) | exact (in-file) |
| `src/cli/dashboard/index.js` (MOD) | provider/wiring | request-response | baseUrl resolution + `render(<App/>)` (self) | exact (in-file) |
| `src/logs/reader.js` (MOD) | utility (CLI edge) | file-I/O | exits `reader.js:54,62` (`process.exit`) | exact (in-file) |
| `src/logger.js` (MOD) | utility | file-I/O | guard `createLogger` `logger.js:241-243` | exact (in-file) |
| `README.md` (MOD) | docs | — | secciones existentes del README | n/a |
| `test/server-*.test.js` (NEW) | test | — | suite `node:test` existente | role-match |

## Pattern Assignments

### `src/server.js` (server/middleware, request-response) — núcleo del cambio

**Analog:** el propio fichero (patrones de ruta ya presentes).

**Anclas de dispatch actuales** (comparación `req.url === '/x'` exacta — Pitfall 2):
- `/health` GET (471), `/status` GET (477), `/logs` GET (555), `/comments/` GET (561), `DELETE /sessions/` (589), `/` y `/dashboard` GET (610), `/webhook` POST (616), 404 fallback (632).

**Cambio 1 — Bind con default seguro (NET-01, D-06).** Anclas `server.listen(port, ...)` en 651 (managed) y 667 (legacy):
```js
// AHORA (server.js:651 y 667): sin host → bind implícito a todas las interfaces
server.listen(port, () => { ... });
// DESPUÉS: host resuelto con fallback (robusto ante configs v0.15 sin `bind`)
const host = config.server.bind ?? '127.0.0.1';
server.listen(port, host, () => { ... });
```
Aplicar en AMBOS call sites (managed 651 dentro del `new Promise`, legacy 667). El bloque `console.log('[kodo] Server listening on :${port}')` ya existe — no cambiar su shape.

**Cambio 2 — Path parsing unificado (Pitfall 2, habilita D-05).** Al inicio del callback de `createServer` (ancla 470), parsear una vez y comparar `pathname` en TODAS las rutas:
```js
const server = createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');
  // luego: req.url === '/status' → pathname === '/status' en las 8 comparaciones
```

**Cambio 3 — Middleware default-deny (NET-02, D-04/D-05).** Tras el body-limit, ANTES del dispatch de rutas (insertar sobre la línea 471):
```js
const isOpenRoute =
  (req.method === 'GET' && pathname === '/health') ||
  (req.method === 'POST' && pathname === '/webhook'); // HMAC, no bearer
if (!isOpenRoute) {
  // /  y /dashboard: token por ?token= (navegación GET, D-05); resto: header Bearer
  const isHtml = req.method === 'GET' && (pathname === '/' || pathname === '/dashboard');
  const provided = isHtml ? searchParams.get('token') : parseBearer(req.headers['authorization']);
  if (!timingSafeTokenEqual(provided, TOKEN)) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' })); // neutro, sin detalle
    return;
  }
}
```

**Cambio 4 — `readBody` acotado a 1 MB → 413 pre-auth (NET-03, D-06).** Ancla `readBody` (380). Único consumidor: `/webhook` (618). Patrón actual (sin límite):
```js
// server.js:380-387 (AHORA)
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}
```
Añadir contador de bytes + rechazo tipado (`code:'PAYLOAD_TOO_LARGE'`) + `req.destroy()` cuando `size > 1024*1024`; check temprano de `content-length`. Body ≤1 MB DEVUELVE `Buffer.concat(chunks).toString()` BYTE-IDÉNTICO (Pitfall 4 — no romper HMAC). El caller `/webhook` mapea `err.code === 'PAYLOAD_TOO_LARGE'` → 413 ANTES de `handleWebhookRequest`/HMAC.

**Cambio 5 — Higiene de error 500 (NET-04, D-09).** Ancla LEAK confirmado `server.js:582-585` (carril `/comments/:id`):
```js
// AHORA (LEAK B10):
} catch (err) {
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: err.message }));   // ← fuga de internals
}
// DESPUÉS (patrón del webhook 624-627, que YA es correcto):
} catch (err) {
  console.error(`[kodo] /comments error: ${err.message}`); // detalle SOLO al log
  res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'internal error' }));     // neutro al cliente
}
```
Barrer TODO el fichero: `grep -n "err.message\|error: e" src/server.js` — la 584 es la única fuga en cuerpo de respuesta (webhook 625 loguea pero responde `{error:'Bad request'}`, correcto, verificar tras el refactor de readBody). Los `console.error` van al ring buffer vía `makeSafeConsoleWriter` (53-63) → visibles en `/logs`.

**Cambio 6 — Generación/persistencia del token (NET-02, D-02).** En `startServer` (409), antes de crear el listener, junto al patrón existente del secret faltante (`server.js:463-464`, que lanza `{code:'KODO_SETUP_REQUIRED'}` bajo managed). El token es distinto: NO se pide, se auto-genera. Ver Pattern 5 (Shared).

**Cambio 7 — `dashboardHtml()` recibe el token (D-05).** `dashboardHtml()` (76-373) es template string con 4 `fetch` inline sin header. Pasar `dashboardHtml(token)` e inyectar `const TOKEN="..."` + `authedFetch` inline en los 4 call sites (`/status` ~345, `/logs` ~286, `/comments/` ~231, `DELETE /sessions/` ~221). El HTML se sirve solo tras validar `?token=` (Cambio 3).

---

### `src/config.js` (config, CRUD) — default `bind` + reuso de `writeEnvVar`

**Analog:** el propio fichero.

**Server block** (`config.js:62-66`) → añadir `bind`:
```js
server: {
  port: 9090,
  idle_threshold_min: 5,
  stuck_threshold_min: 30,
  bind: '127.0.0.1',   // NUEVO (default explícito para configs nuevas; el server resuelve con ?? para las viejas)
},
```

**`writeEnvVar` (`config.js:406`) — reuso SIN modificar** (escritor único de secretos, PERSIST-04). Firma `writeEnvVar(key, value, envPath = ENV_PATH)`: atómico, `chmodSync(tmp, 0o600)` PRE-rename, parse-merge (no clobbea `PLANE_API_KEY`/`KODO_WEBHOOK_SECRET_PLANE`). Contrato de fallo: input inválido → `throw TypeError`; I/O → devuelve `false`; éxito → `true`.

**CRÍTICO (Pitfall 1):** `validateEnvValue` (`config.js:366`) rechaza `/[#=\s]/`. Un token base64 estándar (`+`, `/`, `=`) haría LANZAR a `writeEnvVar` y crashear el arranque. El token DEBE ser `randomBytes(32).toString('hex')` (64 chars `[0-9a-f]`) o `base64url`. NUNCA base64 estándar.

---

### `src/cli/dashboard/client.js` (client, request-response) — SIN cambios de firma (D-07)

**Analog:** el propio fichero. Las 4 funciones exportadas ya tienen el seam `fetchFn = globalThis.fetch`:
- `fetchStatus(baseUrl, fetchFn, signal)` (49), `fetchComments(baseUrl, taskId, fetchFn, signal)` (95), `fetchLogs(baseUrl, fetchFn, signal)` (135), `dismissSession(baseUrl, taskId, fetchFn)` (178).

D-07 exige CERO cambio de firma: reciben un `fetchFn` YA autenticado, construido aguas arriba en `index.js`. No tocar `client.js` salvo, si acaso, un comentario. El patrón never-throws `{ok}` se preserva intacto.

---

### `src/cli/dashboard/index.js` (wiring, request-response) — construye el fetchFn autenticado (D-07)

**Analog:** el propio fichero (resuelve `baseUrl` y hace `render(<App/>)`). Punto ÚNICO donde se lee el token y se envuelve `fetch`:
```js
function makeAuthedFetch(token, base = globalThis.fetch) {
  return (url, opts = {}) =>
    base(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
}
// const fetchFn = makeAuthedFetch(process.env.KODO_API_TOKEN);
// render(<App fetchFn={fetchFn} baseUrl={...} .../>)
```
Un 401 se presenta como estado claro ("No autorizado — revisa KODO_API_TOKEN"), never-throws (D-08). **Pitfall 5 / Open Question #1:** decidir el punto de generación del token en el arranque compuesto (`kodo up`) para que el dashboard lo vea (`loadEnvFile` es load-no-override al import). Recomendado: generar en el arranque compuesto ANTES de renderizar.

---

### `src/logs/reader.js` (utility CLI edge, file-I/O) — validación sessionId (NET-05, D-10)

**Analog:** los `process.exit` ya presentes en el mismo fichero (54, 62).

Ancla `reader.js:66` — `sessionId` sin validar antes de construir el path:
```js
// server.js pattern (validar JUSTO antes de la línea 66):
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
if (!sessionId || !SESSION_ID_RE.test(sessionId)) {
  process.stderr.write('Invalid session id\n');
  process.exit(2);   // espejo de los exits 54/62
}
const filePath = join(KODO_DIR, 'logs', `${sessionId}.ndjson`); // línea 66
```
Rechazo DURO en el borde (input no confiable del CLI `kodo logs <session-id>`).

---

### `src/logger.js` (utility, file-I/O) — defensa en profundidad (NET-05, D-10, Pitfall 3)

**Analog:** el guard existente `createLogger` (`logger.js:241-243`, ya lanza si `sessionId` vacío).

Ancla `logger.js:250` — `join(logDir, \`${sessionId}.ndjson\`)`. **CUIDADO (Pitfall 3 / OQ#2):** `createLogger` se invoca con ids sintéticos (`'reconcile'`, ver `server.js:431`) y session ids reales. Un throw estricto aquí podría regresionar el reconcile loop. Recomendado: defensa SUAVE (verificar formato → `console.warn` + sanitizar, NO throw que tumbe el proceso). Verificar el generador de sessionId antes de endurecer. El rechazo duro vive en el borde (`reader.js`).

---

### `test/server-*.test.js` (test) — suite `node:test`

**Analog:** suite existente (`node:test` + `node:assert`, 1788 pass + 1 skip). Runner: `node --test test/<file>.test.js`. El server tiene seams DI (`_loadConfig`, `_provider`, `opts.managed`, `opts.port`); `writeEnvVar`/`client.js` aceptan path/fetch inyectables → tests offline sin red ni `~/.kodo/`. Ficheros Wave 0: `server-bind`, `server-auth`, `server-token`, `server-body-limit`, `server-error-hygiene`, y extensión de `logs-reader`.

## Shared Patterns

### Comparación timing-safe del token (D-03) — espejo verbatim del HMAC de Plane
**Source:** `src/providers/plane/provider.js:398-409`
**Apply to:** `src/server.js` (o `src/server/auth.js`), toda comparación del bearer.
```js
// provider.js:404-408 (patrón a copiar)
try {
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
} catch { return false; }
// Adaptado al token (añadir guard de longitud, timingSafeEqual LANZA si difieren):
function timingSafeTokenEqual(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided), b = Buffer.from(expected);
  try { return a.length === b.length && timingSafeEqual(a, b); }
  catch { return false; }
}
```

### Generación + persistencia del token (D-02) — reuso de `writeEnvVar`
**Source:** `src/config.js:406` (`writeEnvVar`) + `node:crypto.randomBytes`
**Apply to:** `startServer` first-boot (`src/server.js:409`), antes del listener.
```js
import { randomBytes } from 'node:crypto';
import { writeEnvVar } from './config.js';
function getOrCreateApiToken() {
  let token = process.env.KODO_API_TOKEN;
  if (token && token.length > 0) return token;
  token = randomBytes(32).toString('hex');        // 64 hex — parser-safe (Pitfall 1)
  if (!writeEnvVar('KODO_API_TOKEN', token)) {     // atómico 0600; false ante I/O fail
    throw Object.assign(new Error('could not persist KODO_API_TOKEN'), { code: 'KODO_TOKEN_WRITE_FAILED' });
  }
  process.env.KODO_API_TOKEN = token;             // in-proceso (loadEnvFile no re-lee)
  console.log('[kodo] auth token: ENABLED');       // NUNCA el valor (PERSIST-04)
  return token;
}
```
Consistente con el patrón secret-faltante existente (`server.js:463-464`), pero auto-genera en vez de lanzar `KODO_SETUP_REQUIRED`. Solo lanza si la persistencia I/O falla (no arrancar sin auth silenciosamente).

### Parse del bearer + query token (RFC 6750 / D-05)
**Apply to:** `src/server.js` guard.
```js
function parseBearer(headerValue) {
  if (typeof headerValue !== 'string') return null;
  const m = headerValue.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
// path/query unificado (Pitfall 2): new URL(req.url, 'http://localhost') → { pathname, searchParams }
```

### Higiene de error 500 (D-09) — patrón ya correcto en `/webhook`
**Source:** `src/server.js:624-627` (webhook, ya devuelve `{error:'Bad request'}` genérico)
**Apply to:** todos los `catch` de handlers que hoy escriben `err.message` al body (solo `server.js:584`).
```js
console.error(`[kodo] <ruta> error: ${err.message}`); // detalle SOLO al log (→ ring buffer)
res.writeHead(500, { 'Content-Type': 'application/json' });
res.end(JSON.stringify({ error: 'internal error' }));  // neutro
```

### Validación de input (allowlist regex) — mismo espíritu que `validateEnvValue`
**Source:** `src/config.js:366` (`validateEnvValue`, allowlist por rechazo de charset)
**Apply to:** `src/logs/reader.js:66` (duro) y `src/logger.js:250` (suave).
```js
const SESSION_ID_RE = /^[A-Za-z0-9_-]+$/;
```

## No Analog Found

Ninguno. Los 6 ficheros modificados y los patrones nuevos (bearer guard, token gen, body-limit) tienen todos un analog directo en el codebase (HMAC timing-safe, `writeEnvVar`, `fetchFn` seam, exits de `reader.js`, guard de `createLogger`). El único "nuevo" opcional es `src/server/auth.js` (módulo puro), que espeja el patrón de `src/server/dismiss.js` / `src/server/provider-state.js` — módulos DI ya establecidos.

## Metadata

**Analog search scope:** `src/server.js`, `src/server/`, `src/config.js`, `src/providers/plane/provider.js`, `src/cli/dashboard/`, `src/logs/reader.js`, `src/logger.js`
**Files scanned:** 7 (todos codebase-verified 2026-07-06)
**Pattern extraction date:** 2026-07-06
