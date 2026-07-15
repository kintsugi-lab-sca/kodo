# Phase 69: Red y autenticación - Context

**Gathered:** 2026-07-06
**Mode:** --auto (decisiones auto-seleccionadas con la opción recomendada; auditables en `69-DISCUSSION-LOG.md`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar la superficie de red del server kodo (Ola 1 de v0.16 Hardening, causa raíz T3): bind seguro por defecto (`127.0.0.1`) con exposición explícita vía `config.server.bind`, bearer token en el carril no-webhook, límite de body 1 MB pre-auth → 413, errores 500 neutros al cliente, `sessionId` validado antes de tocar el filesystem, y documentación de la topología multi-nodo. Requirements: NET-01..06.

Fuera del boundary: concurrencia/locks (Fase 70), fiabilidad de entrega (Fase 71), higiene/config hardening (Fase 72).

</domain>

<decisions>
## Implementation Decisions

### Token bearer: almacenamiento, generación y arranque
- **D-01:** El token vive en `~/.kodo/.env` como `KODO_API_TOKEN`, escrito vía `writeEnvVar` (fontanería de Fase 67: escritura atómica, chmod 0600 pre-rename). Coherente con el boundary PERSIST-04: secretos nunca en `config.json`. NET-02 dice "el dashboard lee el token de config" — se interpreta como la configuración de kodo en sentido amplio (`~/.kodo/`), que incluye `.env`.
- **D-02:** Si no hay token al arrancar el server, se **auto-genera** (aleatorio criptográfico, p. ej. `crypto.randomBytes(32)` en base64url/hex) y se persiste vía `writeEnvVar` en el primer arranque. Se loguea `auth token: ENABLED` (sin imprimir el valor). Nunca se arranca con el carril sin auth "porque falta el token" — eso repetiría el anti-patrón del HMAC opcional silencioso (CONCERNS.md #4).
- **D-03:** La comparación del token es **timing-safe** (`crypto.timingSafeEqual`), coherente con la verificación HMAC existente del webhook.

### Alcance del carril autenticado
- **D-04:** Modelo **default-deny**: el middleware de auth cubre TODAS las rutas excepto `/health` (queda abierto — respuesta booleana sin datos) y `/webhook` (conserva su HMAC intacto, no se toca). Esto incluye `/`, `/dashboard` y cualquier ruta futura — fail-closed en vez de lista de 4 endpoints que se desactualiza.
- **D-05:** El dashboard web embebido (`GET /` y `/dashboard`) acepta el token vía query param (`/?token=<token>`) para servir el HTML; el JS inline reutiliza ese token como header `Authorization: Bearer` en sus fetches a `/status` y `/logs`. Sin token válido → 401 también para el HTML.
- **D-06:** El orden de checks en el server es: bind (capa TCP) → límite de body 1 MB **antes** de auth (413 pre-auth, NET-03) → HMAC o bearer según carril → handler. El 413 no debe requerir token (un atacante no autenticado no puede hacer tragar 2 MB al server).

### Dashboard Ink y consumidores CLI
- **D-07:** Un único helper adjunta `Authorization: Bearer <token>` en todas las peticiones de `src/cli/dashboard/client.js`; el token se lee de la misma fuente (`~/.kodo/.env` vía la fontanería de config existente). Todos los consumidores locales del carril (dashboard Ink, `kodo status`, attach de `kodo up`) convergen en la misma lectura — sin duplicar la lógica.
- **D-08:** Un 401 en el dashboard se presenta como estado claro (p. ej. "No autorizado — revisa KODO_API_TOKEN") siguiendo el patrón never-throws/degradación visible del dashboard (v0.14); nunca una pantalla vacía silenciosa. `/health` queda abierto, así que los health-checks de `kodo up` no cambian.

### Errores neutros y validación de sessionId
- **D-09:** Los 500 devuelven `{"error":"internal error"}` (mensaje neutro fijo); el `err.message` real va solo al log del server. Anclas conocidas: `src/server.js:584` (carril `/comments/:id`) — el planner debe barrer TODOS los `res.end(...err.message...)` del server, no solo esa línea.
- **D-10:** `sessionId` se valida con `/^[A-Za-z0-9_-]+$/` en el borde, antes de cualquier acceso a filesystem — ancla principal `src/logs/reader.js:66` (la auditoría B6) y defensa en profundidad donde el id se convierte en nombre de fichero (`src/logger.js:250` construye `${sessionId}.ndjson`). Rechazo con 400.

### Documentación NET-06
- **D-11:** La topología multi-nodo se documenta en una **sección nueva del README** («Topología multi-nodo»): default `127.0.0.1`, exposición explícita con `config.server.bind` a una IP tailscale + ACL/firewall para que el webhook de Plane entre desde otro nodo, y la advertencia de que exponer el bind es opt-in consciente. Solo se añade esa sección — la pasada completa del README es HYG-08 (Fase 72).

### Claude's Discretion
- Forma exacta del middleware/helper de auth (función en `server.js` vs módulo pequeño) — lo que case con el estilo del server actual.
- Formato exacto del token (hex vs base64url) y su longitud (≥32 bytes de entropía).
- Cómo se corta `readBody` a 1 MB (contador sobre chunks + destroy vs `content-length` primero) — mientras el corte sea pre-auth y responda 413.
- Ubicación y estilo de los tests (la suite existente usa `node:test`, 1788 pass — seguir el patrón).
- Redacción exacta de la sección README de topología.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auditoría (fuente de los hallazgos que esta fase cierra)
- `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` §«Ola 1» — plan acordado por hallazgo (A1, M1, M2, B6, B10) con anclas de código exactas; las decisiones de arriba lo desarrollan, no lo contradicen.
- `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` — detalle original de cada hallazgo (leer las entradas A1/M1/M2/B6/B10 si se necesita el razonamiento completo).

### Requirements y roadmap
- `.planning/REQUIREMENTS.md` §«Red y autenticación (Ola 1)» — NET-01..06 normativos.
- `.planning/ROADMAP.md` §«Phase 69» — success criteria verificables (401 desde otro nodo, 413 con 2 MB, HMAC intacto, `/health` abierto).

### Fontanería reusada
- `.planning/phases/*` de Fase 67 están archivados; la referencia viva es el código: `writeEnvVar` (escritura atómica 0600 de `~/.kodo/.env`) — buscar en `src/` (nació en Fase 67, SETUP-03/04).

</canonical_refs>

<code_context>
## Existing Code Insights

### Anclas verificadas (2026-07-06, código actual)
- `src/server.js:651,667` — `server.listen(port)` sin host en ambos modos (legacy y managed) → añadir `host = config.server.bind ?? '127.0.0.1'` en los dos.
- `src/server.js:380` — `readBody(req)` acumula chunks sin límite → cap 1 MB → 413.
- `src/server.js:584` — `res.end(JSON.stringify({ error: err.message }))` en el carril `/comments/:id` (fuga B10); barrer el resto del fichero.
- `src/logs/reader.js:66` — `sessionId` sin validar antes de tocar filesystem (B6).
- `src/logger.js:250` — `join(logDir, \`${sessionId}.ndjson\`)` — el id se usa como nombre de fichero.
- `src/config.js:62-66` — bloque `server` con defaults (`port: 9090`, thresholds) → nuevo campo `bind`.
- `src/cli/dashboard/client.js` — cliente HTTP del dashboard Ink (baseUrl `http://localhost:9090`) → punto único para adjuntar el bearer.
- Rutas actuales en `server.js`: `/health` (471), `/status` (477), `/logs` (555), `/comments/:id` (561), `DELETE /sessions/:id` (589), `/` y `/dashboard` (610, HTML embebido con JS inline que fetchea `/status` y `/logs`), `/webhook` (616, HMAC).

### Reusable Assets
- `writeEnvVar` (Fase 67) — escritura atómica 0600 de `~/.kodo/.env`; reusar para persistir `KODO_API_TOKEN` auto-generado.
- Verificación HMAC existente del webhook — patrón de comparación timing-safe ya presente en el server; el bearer sigue el mismo estándar.
- Patrón never-throws del dashboard (v0.14) — para el estado 401 visible.

### Established Patterns
- Dos modos de `startServer` (`managed` true/false) — el bind y la auth deben comportarse igual en ambos; el modo managed lanza `{code:'KODO_SETUP_REQUIRED'}` en vez de `process.exit`.
- Respuestas JSON aditivas (invariante v0.9) — los cambios de shape en respuestas 200 deben ser aditivos; 401/413 son códigos nuevos por ruta, no cambios de shape.
- Suite de tests `node:test` (1788 pass + 1 skip en v0.15) — los tests de esta fase siguen ese runner.

### Integration Points
- `src/server.js` (middleware auth + bind + readBody + 500 neutro), `src/config.js` (default `bind`), `src/cli/dashboard/client.js` (bearer), `src/logs/reader.js` (validación sessionId), `README.md` (sección topología).

</code_context>

<specifics>
## Specific Ideas

- La propuesta de auditoría fija literalmente: `server.listen(port, host)` con `host = config.server.bind ?? '127.0.0.1'`; bearer exigido en `GET /status|/logs|/comments/:id` y `DELETE /sessions/:id`; `/webhook` no se toca; `/health` abierto; `readBody` a 1 MB → 413; 500 neutro; `sessionId` con `/^[A-Za-z0-9_-]+$/`.
- Criterio de éxito verificable desde fuera: desde otro nodo de la LAN, `GET /status` y `DELETE /sessions/x` → 401 sin token; body de 2 MB → 413; webhook de Plane sigue entrando con HMAC.

</specifics>

<deferred>
## Deferred Ideas

- Rotación/regeneración de token desde el dashboard (comando o tecla) — nice-to-have de DX, no lo pide ningún NET-*; candidato a backlog si alguien lo echa de menos.
- Rate limiting del carril autenticado — fuera de scope de v0.16 (la exposición externa queda cerrada por bind + bearer).

</deferred>

---

*Phase: 69-Red y autenticación*
*Context gathered: 2026-07-06*
