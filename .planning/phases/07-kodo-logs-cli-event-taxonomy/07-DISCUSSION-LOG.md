# Phase 7: `kodo logs` CLI + Event Taxonomy - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-16
**Phase:** 07-kodo-logs-cli-event-taxonomy
**Areas discussed:** CLI shape + --follow, Taxonomía eventos + DI, Transcript correlation (LOG-10), Lookup --session-of (LOG-11)

---

## CLI shape + --follow

### ¿Qué forma tiene el sub-comando kodo logs?

| Option | Description | Selected |
|--------|-------------|----------|
| Posicional + flags (Recomendado) | `kodo logs <session-id> [--follow] [--level] [--component] [--event-type] [--json] [--session-of]`. Una entrada, discoverable con --help. | ✓ |
| Sub-comandos anidados | `kodo logs show/tail/find`. Más verbose. | |
| Pos + --session-of mutex | Como (1) pero commander enforza mutex. | |

**User's choice:** Posicional + flags
**Notes:** Alineado con el resto de sub-comandos del CLI existentes.

### ¿Output default pretty-print o NDJSON raw?

| Option | Description | Selected |
|--------|-------------|----------|
| Pretty por default, --json para raw (Recomendado) | Idéntico al mirror stderr del logger. `--json` imprime NDJSON crudo. | ✓ |
| NDJSON raw default, --pretty para TUI | Pipe-friendly out-of-the-box. | |
| Auto por TTY | Auto-detect stdout TTY. Más magia. | |

**User's choice:** Pretty por default, --json para raw
**Notes:** Consistencia visual con los logs que el dev ya ve en stderr durante las sesiones.

### ¿Cómo implementamos --follow?

| Option | Description | Selected |
|--------|-------------|----------|
| fs.watchFile polling 200ms (Recomendado) | Polling por stat diff, portable, simple, stdlib. | ✓ |
| fs.watch (inotify/FSEvents) | Evento kernel, más edge cases. | |
| Tail externo | Spawn `tail -f`. Dep implícita. | |

**User's choice:** fs.watchFile polling 200ms
**Notes:** Portabilidad macOS/Linux sin edge cases raros.

### ¿Desde dónde imprime --follow?

| Option | Description | Selected |
|--------|-------------|----------|
| Dump completo + tail (Recomendado) | Como `tail -f`: archivo entero + live. | ✓ |
| Sólo nuevas líneas | Arranca vacío. | |
| Últimas N líneas + tail | `tail -n 20 -f` semantics. | |

**User's choice:** Dump completo + tail
**Notes:** Estándar Unix. El dev ve el contexto completo de la sesión.

---

## Taxonomía eventos + DI

### ¿Cómo expresamos el tipo de evento en NDJSON?

| Option | Description | Selected |
|--------|-------------|----------|
| Campo event + constantes export (Recomendado) | Campo `event` top-level + const EVENTS en src/logger-events.js. | ✓ |
| Campo event, strings libres | Sin constantes, tests grep-based. | |
| Convención en msg | msg = 'session.start'. Rompe separación msg/tipo. | |

**User's choice:** Campo event + constantes export
**Notes:** Descubrible desde IDE, robusto a typos, filtro CLI limpio.

### ¿Los eventos tipados exigen campos obligatorios por tipo?

| Option | Description | Selected |
|--------|-------------|----------|
| Helpers típicos, tests por evento (Recomendado) | Funciones sessionStart/sessionEnd/... que rellenan event + campos obligatorios. | ✓ |
| Enum + convención, sin helpers | Cada consumer a mano. Fácil olvidar. | |
| Schema-by-example en tests | Fixture golden. Integration-test heavy. | |

**User's choice:** Helpers típicos, tests por evento
**Notes:** Disciplina baked-in sin dependencias de runtime extra (sin ajv ni similar).

### ¿Dónde se crea el root logger y cómo llega a consumers?

| Option | Description | Selected |
|--------|-------------|----------|
| Root en CLI/server, pasado explícito (Recomendado) | src/cli.js + src/server.js crean logger, pasan como arg. Cada consumer hace .child({ component }). | ✓ |
| Factory per-module (getLogger) | Singleton global. | |
| Options object en cada función | Verbose explícito. | |

**User's choice:** Root en CLI/server, pasado explícito
**Notes:** Respeta decisión Phase 6 "DI-only, no singleton". Zero globales.

### ¿Seq monotonico por línea o nos basta con timestamp?

| Option | Description | Selected |
|--------|-------------|----------|
| No, timestamp basta (Recomendado) | ISO-8601 ms + appendFileSync atomic POSIX. | ✓ |
| Sí, seq monotónico en factory | Counter incremental. Estado mutable. | |
| Defer a implementación | Decidir en plan-phase. | |

**User's choice:** No, timestamp basta
**Notes:** Cierra la nota deferida de Phase 6. Los 7 tipos no son alta frecuencia.

---

## Transcript correlation (LOG-10)

### ¿Cómo resolvemos el transcript path de Claude Code?

| Option | Description | Selected |
|--------|-------------|----------|
| Determinístico desde project_path + session_id (Recomendado) | `~/.claude/projects/<encoded>/<id>.jsonl` con `encodeURIComponent + %2F→-`. Sin I/O. | ✓ |
| Glob descubrir | Busca con glob. Robusto pero I/O + edge cases. | |
| Leer de la env de Claude hook | Hook stdin payload. | |

**User's choice:** Determinístico desde project_path + session_id
**Notes:** Sin I/O en el resolver. Simple y estable mientras Claude no cambie convención.

### ¿Quién emite session.start con el transcript_path?

| Option | Description | Selected |
|--------|-------------|----------|
| Hook SessionStart (Recomendado) | src/hooks/session-start.js ya se ejecuta con el payload. | ✓ |
| Session manager en spawn | Antes/después del spawn. | |
| Ambos eventos separados | session.spawn + session.start. 8vo tipo. | |

**User's choice:** Hook SessionStart
**Notes:** Fuente de verdad de primera mano. Encaja con D-17 (resolución determinística hecha en un solo sitio, el hook).

### ¿Qué incluye la línea session.start mínima?

| Option | Description | Selected |
|--------|-------------|----------|
| Contrato mínimo explicit (Recomendado) | session_id, plane_task_id, provider, project_path, transcript_path, started_at. | ✓ |
| Espejo de SessionRecord | Todos los campos del state. Ruidoso. | |
| Core + ctx libre | Mínimo absoluto + ctx libre. Menos contrato. | |

**User's choice:** Contrato mínimo explicit
**Notes:** Lo necesario para pivotar a Claude y al task Plane desde un tail, sin flood.

---

## Lookup --session-of (LOG-11)

### ¿Qué fuente consulta --session-of <plane-task-id>?

| Option | Description | Selected |
|--------|-------------|----------|
| state.json primero, scan NDJSON fallback (Recomendado) | loadState() primero, scan primera línea NDJSON fallback. Cubre vivas y archivadas. | ✓ |
| Solo state.json | Trivial. Sesiones limpiadas invisibles. | |
| Solo scan NDJSON | I/O siempre. Append-only como fuente única. | |

**User's choice:** state.json primero, scan NDJSON fallback
**Notes:** Cubre el 100% de casos sin cambiar el contrato de state.

### ¿Qué hacemos si hay múltiples sesiones del mismo plane-task-id?

| Option | Description | Selected |
|--------|-------------|----------|
| Más reciente, warn a stderr (Recomendado) | Sort desc + pick latest + warn con los descartados. | ✓ |
| Fail, listar y exigir session-id | Error, exit no-zero. | |
| Imprimir todos intercalados | Merge por timestamp. Rompe contrato. | |

**User's choice:** Más reciente, warn a stderr
**Notes:** 99% del tiempo el dev quiere la última. Warn deja pista de que hay más.

### ¿Cómo se comporta --session-of con --follow?

| Option | Description | Selected |
|--------|-------------|----------|
| Resuelve al arrancar, follow fijo (Recomendado) | Un session-id resuelto en startup, follow sobre ese archivo. | ✓ |
| Follow 'live' multi-sesión | Sigue cualquier sesión nueva del task. Complica tests. | |

**User's choice:** Resuelve al arrancar, follow fijo
**Notes:** Semántica `tail -f` idéntica a cuando se pasa session-id directo.

---

## Claude's Discretion

- Nombre exacto del archivo (`src/logger-events.js` vs `src/events.js`) y forma interna (un objeto `EVENTS` vs una const por tipo).
- Algoritmo exacto para leer la primera línea de cada `.ndjson` en el fallback del lookup.
- Formato exacto del warn de multi-match a stderr.
- Interval del `watchFile` (200ms sugerencia).
- Estructura del helper de fixture para tests de eventos.

## Deferred Ideas

- `kodo logs --since <timestamp>` — filtro temporal explícito.
- `kodo logs --grep <pattern>` — ripgrep interno.
- `session.spawn` como 8vo tipo de evento.
- `--follow` multi-sesión con `--session-of`.
- Exporter de métricas Prometheus (LOG-F2, v2).
- Lint rule anti-interpolación de secretos (deuda Fase 6, fuera de Fase 7).
- Refactor `src/check.js` separando snapshot/act (deuda Fase 6, fuera de Fase 7).
