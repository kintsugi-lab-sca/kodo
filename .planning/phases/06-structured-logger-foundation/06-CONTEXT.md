# Phase 6: Structured Logger Foundation - Context

**Gathered:** 2026-04-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Crear `src/logger.js` — factory NDJSON con redacción de secretos, espejo stderr pretty-print y aislamiento estricto del vigilante `kodo check`. Cubre LOG-01, LOG-02, LOG-03, LOG-04, LOG-08, LOG-12. El CLI `kodo logs`, la taxonomía de eventos de ciclo de vida y el cableado GSD viven en fases 7–10.

</domain>

<decisions>
## Implementation Decisions

### API del logger
- Factory `createLogger({ sessionId, minLevel })` devuelve logger raíz.
- `logger.child({ component, ...bindings })` crea loggers derivados por módulo (estilo pino/bunyan).
- Signatura de llamada: `log.info('msg', { ctx })` — contexto como segundo argumento, se mezcla con campos base en la línea NDJSON.
- `sessionId` es obligatorio y bindeado en el factory; `plane_task_id` y `phase_id` se añaden vía `.child()` cuando se conocen (phase_id puede llegar tarde, después del resolver).
- No-op fallback disponible para `src/check.js` y cualquier código transitivamente cargado por el vigilante (nunca importar `logger.js` directamente desde `check.js`).

### Niveles
- Constantes numéricas internas: `debug=10`, `info=20`, `warn=30`, `error=40` (para comparación `minLevel`).
- API pública y campo `level` en NDJSON son strings (`'debug'|'info'|'warn'|'error'`).
- Configuración: flag CLI `--log-level` > env `KODO_LOG_LEVEL` > default (`info` en modo interactivo, a definir en planning si cambia para daemon). Precedencia exacta se decide durante planning; el API acepta ambos canales.

### Campos NDJSON por línea
- Base obligatorios: `timestamp` (ISO-8601), `level` (string), `component` (del bind), `msg` (string), `session_id`.
- Opcionales por bind: `plane_task_id`, `phase_id`.
- Contexto arbitrario mezclado a nivel top-level de la línea JSON (no anidado bajo `ctx`).

### Redacción de secretos (LOG-08)
- Estrategia dual: set cerrado de keys sensibles (`PLANE_API_KEY`, `plane_api_key`, `authorization`, `x-api-key`, `x-plane-signature`, `password`, `token`, `secret`, case-insensitive) + regex genérico para valores que parezcan JWT / API key sin key conocida.
- Placeholder: `[REDACTED]` literal (no hash, no longitud).
- Recorrido deep walk con límites: depth=4, array length=100; al exceder se reemplaza por `[REDACTED:depth-exceeded]` o se trunca.
- Se aplica antes de cualquier escritura: tanto al NDJSON de disco como al pretty-print de stderr.
- Test unitario obligatorio cubre: PLANE_API_KEY top-level, header `authorization` anidado, `x-plane-signature` anidado, valor tipo `eyJhbG...` sin key conocida. Asserta que el NDJSON en disco NO contiene el secreto original (grep del archivo) y que stderr tampoco.

### Pretty-print stderr
- Formato: `HH:MM:SS LEVEL component msg +ctx` — timestamp corto, nivel en mayúsculas, contexto inline `k=v` si cabe; si es grande, JSON compacto al final.
- Colores ANSI auto por `process.stderr.isTTY` (respeta `NO_COLOR`).
- Niveles espejados: `warn` + `error` siempre; `info` adicional si TTY Y `minLevel <= info`; `debug` nunca a stderr salvo que `minLevel=debug` Y TTY.
- Dos sinks independientes (disco NDJSON + stderr pretty) derivados del mismo evento fuente — stderr nunca lee del disco. Test asserta que ninguna línea de stderr empieza con `{`.

### Escritura a disco
- `fs.appendFileSync` por línea con flag `'a'` y `\n` final (atómico en POSIX para escrituras <PIPE_BUF, sobrevive a crashes sin pérdida).
- Directorio: `~/.kodo/logs/<session-id>.ndjson`.
- `mkdirSync(logDir, { recursive: true })` una vez en el factory (tolera existencia previa).
- Fallos I/O (ENOSPC, EACCES, etc.): atrapar, emitir un único warning pretty-print a stderr por sesión indicando el fallo, NO throw. El logger nunca tumba la app.

### Aislamiento del vigilante (LOG-12)
- Convención: `src/check.js` no puede importar `logger.js` directa ni transitivamente.
- Doble red de verificación:
  1. Test de grafo de imports que parsea el árbol desde `src/check.js` (walk AST o análisis de require-graph) y asserta que `logger` no aparece.
  2. Test de presupuesto de arranque: `node bin/kodo check` debe completar en <50ms (medición promediada de N runs).
- Si algún código que vive en el camino de `check.js` necesita loggear, usa el no-op fallback o se refactoriza fuera del path del vigilante.

### Claude's Discretion
- Nombres internos exactos de funciones/símbolos del redactor.
- Estructura interna del módulo (un archivo `src/logger.js` o split en submódulos si supera ~300 LoC).
- Nombre y forma exacta del flag CLI (`--log-level`, `-L`, etc.) — a consolidar en plan.
- Mecanismo técnico del test de grafo (AST nativo, `node --trace-imports`, regex sobre source): lo que sea más barato manteniendo la garantía.
- Formato exacto del fallback "write failed" (incluyendo si se emite un único evento por sesión vs throttle).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config.js`: Ya expone `KODO_DIR` y convenciones para `~/.kodo/`. El logger debe tomar el root desde ahí para consistencia; no duplicar resolución de paths.
- `node:fs` / `node:path` / `node:os`: stack ya usado en todo el proyecto — sin dependencias nuevas (zero-runtime-deps es principio explícito en STACK.md).
- `node:test` + `node:assert/strict`: test harness establecido; añadir `test/logger.test.js` siguiendo el patrón existente.

### Established Patterns
- ES modules puros (`"type": "module"`), sin CommonJS — logger exporta named `createLogger`.
- Factory functions sobre classes (estilo PlaneClient es la excepción). Preferible: factory pura que devuelve objeto con métodos, sin `this`.
- Constantes `UPPER_SNAKE_CASE` a nivel módulo; keys de objetos en `snake_case` al serializar (alineado con `config.json`).
- Comentarios JSDoc `@param`/`@return` obligatorios en el API público.

### Integration Points
- Consumidores esperados en fases siguientes: `src/session/manager.js`, `src/session/state.js`, `src/plane/client.js`, `src/cmux/client.js`, `src/hooks/*.js`, `src/orchestrator/launch.js`. Todos deben recibir un logger (por DI) o crear un child — nunca importar uno global singleton.
- `src/check.js` queda fuera: cualquier utilidad compartida que importe deberá vivir en un módulo sin dependencia de `logger.js`.
- `bin/kodo` / `src/cli.js`: aquí vive el parseo de `--log-level`; crea el logger raíz con `minLevel` resuelto y lo inyecta al comando.

</code_context>

<specifics>
## Specific Ideas

- Inspiración en pino/bunyan: child loggers, niveles numéricos internos con serialización string, contexto como segundo arg. No hay intención de usar pino como dependencia (viola zero-deps) — replicar solo la ergonomía.
- "El logger nunca es crítico": cualquier fallo del logger se degrada a stderr y continúa. Perder logs es peor que tumbar una sesión por un ENOSPC.
- Test de redacción debe hacer `grep` directo sobre el archivo NDJSON para tener confianza real de que el secreto no quedó persistido.

</specifics>

<deferred>
## Deferred Ideas

- Rotación / retención de logs → **LOG-F1** (v2, ya fuera de scope explícitamente).
- Export de métricas Prometheus → **LOG-F2** (v2).
- Transports pluggables (Loki, Datadog) → **LOG-F3** (v2).
- Seq monotónico por sesión para ordering estricto en concurrencia → revisar en fase 7 si los filtros del CLI lo necesitan; no es bloqueante ahora.
- Nivel extra `trace` o `fatal` → explícitamente out-of-scope (REQUIREMENTS.md "paralysis of choice").

</deferred>

---

*Phase: 06-structured-logger-foundation*
*Context gathered: 2026-04-15*
