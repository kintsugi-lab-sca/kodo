# Phase 4: Server + Trigger Abstraction - Context

**Gathered:** 2026-04-13
**Status:** Ready for planning

<domain>
## Phase Boundary

Desacoplar `server.js` de Plane y centralizar el despacho de triggers en una función `dispatchTrigger()`. El server delega parsing de payload y verificación de firma al adapter activo; tanto el webhook como `kodo launch` convergen en el mismo punto de entrada. Al final, el server no sabe qué proveedor generó el evento y un evento de Plane se procesa igual que antes del refactor.

</domain>

<decisions>
## Implementation Decisions

### Simetría CLI ↔ webhook
- `kodo launch <ref>` **atraviesa `dispatchTrigger()`** construyendo un `TriggerEvent` sintético (`action: "manual"`, provider del config activo)
- Una sola ruta de lanzamiento para webhook y CLI — checks de sesión existente, workspace stale, etc. viven dentro del dispatcher
- Hidratación del TaskItem desde el ref → Claude's discretion durante planning
- Por defecto se exige label `kodo` (igual que webhook); flag `--force` salta la comprobación para lanzamiento manual
- CLI acepta `<ref>` + `--model <name>` + `--yolo` como opciones de override sin tocar labels
- Los overrides del CLI se pasan dentro del `TriggerEvent.raw` o como campo dedicado del evento

### Profundidad de la abstracción de canal
- **Mixto sin typedef formal:** nuevo directorio `src/triggers/` con `dispatcher.js` + `webhook.js`
- No se introduce interfaz `TriggerChannel` — la extensibilidad viene de la organización de archivos
- `server.js` queda **solo con boot HTTP + routing** (`/status`, `/health`, `/webhook`); delega el handler del webhook entero a `src/triggers/webhook.js`
- `dispatchTrigger()` vive en `src/triggers/dispatcher.js`
- El webhook handler en `src/triggers/webhook.js` recibe el request body ya parseado, obtiene el adapter, llama a `verifySignature` + `parseTriggerEvent`, y pasa el `TriggerEvent` a `dispatchTrigger()`

### Resolución del provider en el server
- **Único provider activo** leído de `config.provider` via `getProvider()` del registry (Phase 2)
- `startServer()` llama a `provider.init()` **antes de `listen()`** — fail-fast, coherente con Phase 1
- Si `config.provider` no existe o es inválido → mensaje explícito ("config.provider no configurado. Ejecuta kodo config.") + `process.exit(1)`
- La instancia del provider se cachea (singleton del registry) y se pasa al webhook handler

### Config del webhook secret
- **Env var por provider con convención:** `KODO_WEBHOOK_SECRET_PLANE`, `KODO_WEBHOOK_SECRET_GITHUB`, etc.
- El adapter declara qué env var leer en su config (`providers.plane.webhook_secret_env: "KODO_WEBHOOK_SECRET_PLANE"`)
- El adapter **saca el secret solo** — `verifySignature(body, headers)` sin que el server toque el secret
- El adapter lee su secret durante `init()` o en su factory closure
- Sin secret configurado → **fail-fast en `startServer()`**. Para desarrollo se necesita flag explícito (`--insecure` o env `KODO_DEV=1`) para saltarse la verificación

### Claude's Discretion
- Hidratación del TaskItem en el caso manual (pre-dispatch vs inside dispatcher)
- Contrato de retorno de `dispatchTrigger()` (void, session object, result enum)
- Semántica de respuesta HTTP (401 firma inválida, 400 parse error, 200/204 ignorado)
- Exact signature del `TriggerEvent` sintético para CLI
- Implementación del flag `--insecure` para dev sin secret
- Cómo pasa el server la instancia del provider al webhook handler (import, closure, parameter)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/providers/plane/provider.js`: PlaneProvider ya implementa `parseTriggerEvent()` y `verifySignature()` — listo para ser llamado por el webhook handler
- `src/providers/registry.js`: `getProvider(name?)` con singleton cacheado — entry point para resolver el adapter activo
- `src/session/manager.js`: `launchWorkItem(identifier, opts)` ya rewired en Phase 3 — el dispatcher puede llamarlo directamente
- `src/labels.js`: `parseKodoLabels()` reutilizable para el caso manual CLI si se necesita parsear labels del TaskItem
- `src/interface.js`: `TriggerEvent` typedef ya definida con `{ taskRef, action, provider, raw }`

### Established Patterns
- Factory functions con dependency injection (Phase 2 PlaneProvider pattern)
- Pure helper extraction para testabilidad (Phase 3 manager.js, check.js)
- JSDoc @ts-check en todo el codebase
- Entry-point guards (`import.meta.url === file://process.argv[1]`) para importabilidad en tests (Phase 3)

### Integration Points
- `server.js` (275 líneas) — se refactorizará a ~80 líneas (solo HTTP boot + routing)
- `cli.js` comando `launch` — actualmente llama directo a `launchWorkItem`, se reconectará a `dispatchTrigger()`
- `cli.js` loggea `session.plane_identifier` (stale post Phase 3) — se corrige a campos genéricos
- `src/session/state.js` — `listSessions`, `removeSession` usados en la lógica de "sesión ya activa" que se mueve al dispatcher

</code_context>

<specifics>
## Specific Ideas

- El dispatcher absorbe toda la lógica de "sesión ya activa + workspace stale" que hoy está dispersa en `handleTriggerState` de server.js
- `src/triggers/webhook.js` es un handler puro que recibe `(rawBody, headers, provider)` y devuelve un response object — testeable sin HTTP
- El flag `--force` en `kodo launch` se traduce a `kodoConfig.isKodo = true` dentro del TriggerEvent sintético, evitando bifurcación en el dispatcher

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-server-trigger-abstraction*
*Context gathered: 2026-04-13*
