# Phase 7: `kodo logs` CLI + Event Taxonomy — Research

**Researched:** 2026-04-16
**Domain:** CLI reader + live-tail + NDJSON event taxonomy sobre logger ya entregado (Fase 6)
**Confidence:** HIGH

## Summary

Fase 7 entrega tres piezas que consumen — no modifican — el logger de Fase 6:

1. **`kodo logs` sub-comando** en `src/cli.js` (commander 13.1.0) con filtros cliente-side y `--follow` tipo `tail -f` implementado con `fs.watchFile` (polling 200ms).
2. **Taxonomía cerrada de 7 eventos** (`session.start`, `session.end`, `state.transition`, `orchestrator.review`, `gsd.phase.resolved`, `gsd.bootstrap`, `plane.api.call`) en un nuevo `src/logger-events.js` con constantes `EVENTS` + helpers por tipo que delegan en `logger.info/warn/error`.
3. **DI del logger raíz** creado en `src/cli.js` y `src/server.js` hacia 7 consumers (`session/manager`, `session/state`, `session/health`, `providers/plane/*`, `cmux/client`, `hooks/*`, `orchestrator/launch`).

Toda la plomería funciona con Node 20 stdlib y `commander@13.1.0` (ya instalado) — **cero dependencias nuevas**. El aislamiento del vigilante queda intacto: ningún módulo nuevo importado desde `src/check.js` transitivamente, y `test/check-isolation.test.js` sigue verde sin ser tocado.

**Primary recommendation:** Implementar en 3 waves — Wave 0 scaffolding + fixtures, Wave 1 taxonomía + CLI reader (dump + filtros), Wave 2 `--follow` + `--session-of` + DI en los 7 consumers. Exportar `COLOR_BY_LEVEL` desde `logger.js` y **reutilizar `formatLine`** extrayéndolo a helper compartido — una única fuente de verdad para el pretty-print mantiene consistencia entre stderr mirror y `kodo logs`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CLI parsing (`kodo logs <id>`) | CLI / commander | — | commander ya es el único entrypoint de sub-comandos (`src/cli.js`). Registrar `logs` junto a `status`, `launch`, `check`. |
| Lectura de `<session>.ndjson` | Local FS (Node stdlib) | — | Ficheros en `~/.kodo/logs/`; sin HTTP ni IPC. `fs.readFileSync` para dump, `fs.watchFile` para tail. |
| Pretty-print formatter | Shared helper (logger.js export) | CLI reader | Reutilizar la función del mirror stderr — consistencia visual + sola fuente de verdad. |
| Filtros `--level` / `--component` / `--event-type` | CLI reader (client-side) | — | Parseo línea por línea y descarte; no se modifica el archivo NDJSON (append-only fuente de verdad). |
| Tail en vivo (`--follow`) | Watcher (Node stdlib `fs.watchFile`) | — | Polling 200ms robusto contra rename/truncate; evita `fs.watch` (inotify/FSEvents edge cases). |
| Resolver `--session-of <task-id>` | Two-step lookup | CLI reader | 1) `loadState()` sobre `~/.kodo/state.json`; 2) fallback: head-line-read de cada `.ndjson`. |
| Emisión de los 7 eventos tipados | Helpers en `src/logger-events.js` | Consumers (DI) | Helpers puros que llaman `logger.info/warn/error` — el sink sigue siendo `logger.js`. |
| Correlación transcript Claude Code | Resolver síncrono (path det.) | Hook `session-start.js` | `encodeURIComponent(project_path).replace(/%2F/g,'-')` + `<sessionId>.jsonl`. Sin I/O en el resolver. |
| DI del logger raíz | CLI entrypoint (`cli.js`/`server.js`) | Consumers | Entrypoint conoce `minLevel` (flag > env > default); inyecta al dispatcher/manager. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `commander` | 13.1.0 | CLI parsing (ya es la única dep) | [VERIFIED: `/Users/alex/dev/klab/kodo/package.json:11`] Única dependencia runtime del proyecto. Patrón establecido en los 8 sub-comandos existentes (`config`, `start`, `check`, `install`, `orchestrate`, `launch`, `status`, `stop`). |
| `node:fs` | Node ≥20 stdlib | `appendFileSync` (logger), `readFileSync` + `openSync`/`readSync` (dump + head-line), `watchFile` (tail) | [VERIFIED: `node --version → v24.14.0`] Ya usado por `logger.js`, `config.js`, `state.js`, `check.js`. |
| `node:path` | stdlib | `join(KODO_DIR, 'logs', ...)` | stdlib |
| `node:url` | stdlib | `fileURLToPath` para entrypoint detection en hooks | Ya patrón en `hooks/session-start.js:112` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` | stdlib | Test runner (`node --test test/**/*.test.js`) | [VERIFIED: `package.json:9`] Ya patrón establecido en los 20 test files. |
| `node:assert/strict` | stdlib | Assertions | Ya patrón en todos los tests. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fs.watchFile` (polling 200ms) | `fs.watch` (inotify/FSEvents) | [CITED: nodejs.org/api/fs.html#caveats] `fs.watch` tiene casos edge documentados: no funciona en NFS, eventos coalesced en macOS, rename/truncate disparan events inconsistentes entre plataformas. `watchFile` usa `stat()` polling — determinístico y portable. Penalización: ~200ms de latencia máxima. Aceptable para tail humano. |
| `readline.createInterface` para head-line | `fs.openSync + readSync(buf)` | [VERIFIED empírico] `readline` abre un stream que dispara `data` events para el archivo entero incluso si rompes tras la primera línea — ineficiente para un dir con N archivos. `readSync` con buffer de 4KB lee solo hasta encontrar `\n`. |
| Un solo helper genérico `emitEvent(type, fields)` | 7 helpers tipados (`sessionStart(log, fields)`, ...) | [CITED: D-09] 7 helpers tipados dan autocompletado IDE + JSDoc `@param` específico por tipo. El helper genérico pierde la seguridad de que `session.start` siempre lleve `transcript_path`. |
| Exportar `createLogger` global singleton | DI explícito en argumentos (D-13/14) | [CITED: D-14] Singletons rompen tests de aislamiento y hacen imposible stubbing. DI es estilo ya establecido por `TaskProvider` (Fase 3). |

**Installation:** (no new deps)

```bash
# Nothing to install. commander@13.1.0 ya está en package.json.
# Verify:
node -e "console.log(require('commander/package.json').version)" # 13.1.0
```

**Version verification:**

| Package | Latest registry | Installed | Currency |
|---------|----------------|-----------|----------|
| `commander` | 13.1.0 (verified via `require('commander/package.json').version`) | 13.1.0 | OK |
| `node` runtime | v24.14.0 local | engines `>=20.0.0` en `package.json:14` | OK — stdlib APIs usadas (`fs.watchFile`, `fs.openSync`, `readSync`) existen desde Node 0.x y 12.x. |

## User Constraints (from CONTEXT.md)

### Locked Decisions (22 decisiones D-01..D-22)

**CLI shape (LOG-05, LOG-06, LOG-07, LOG-11)**

- **D-01:** Forma `kodo logs <session-id> [flags]` — session-id posicional obligatorio salvo cuando se pasa `--session-of`. Resuelto vía `commander` siguiendo el estilo del resto de sub-comandos (`src/cli.js`).
- **D-02:** Flags soportados: `--follow`, `--level <debug|info|warn|error>`, `--component <name>`, `--event-type <type>`, `--json`, `--session-of <plane-task-id>`.
- **D-03:** Output default **pretty-print** idéntico al mirror stderr del logger (`HH:MM:SS LEVEL component msg +ctx`) con colores si stdout es TTY y `NO_COLOR` no está set. Con `--json` imprime NDJSON crudo.
- **D-04:** `--follow` con `fs.watchFile(path, { interval: 200 })`. No usar `fs.watch`.
- **D-05:** Semántica `--follow`: **dump completo + tail** (como `tail -f`). Espera si el archivo no existe aún.
- **D-06:** Filtros en el **cliente**, parseando cada línea JSON.

**Taxonomía (LOG-09)**

- **D-07:** Campo top-level `event` (string) para líneas tipadas. Los 7 tipos son contrato cerrado.
- **D-08:** Constantes exportadas desde `src/logger-events.js`: `EVENTS = Object.freeze({ SESSION_START: 'session.start', SESSION_END: 'session.end', STATE_TRANSITION: 'state.transition', ORCHESTRATOR_REVIEW: 'orchestrator.review', GSD_PHASE_RESOLVED: 'gsd.phase.resolved', GSD_BOOTSTRAP: 'gsd.bootstrap', PLANE_API_CALL: 'plane.api.call' })`.
- **D-09:** Helpers por evento: `sessionStart(logger, fields)`, `sessionEnd(logger, fields)`, `stateTransition(logger, { from, to, reason })`, `orchestratorReview(logger, { phase_id, verdict, reason })`, `gsdPhaseResolved(logger, { phase_id, match_heading })`, `gsdBootstrap(logger, { project_path })`, `planeApiCall(logger, { method, path, status, duration_ms })`.
- **D-10:** `session.start` contrato mínimo: `session_id, plane_task_id, provider, project_path, transcript_path, started_at`.
- **D-11:** Validación por evento vía `test/logger-events.test.js`.
- **D-12:** No seq monotónico por línea. ISO-8601 + `appendFileSync` atómico bastan.

**DI (Fase 7)**

- **D-13:** Root logger creado en `src/cli.js` + `src/server.js`. `minLevel`: flag CLI > `KODO_LOG_LEVEL` env > default `info`.
- **D-14:** Se pasa explícito a: `session/manager.js`, `session/state.js` (si emite), `providers/plane/*`, `cmux/client.js`, `hooks/*.js`, `orchestrator/launch.js`. Sin singletons.
- **D-15:** Cada consumer hace `logger.child({ component: '<name>' })`. Componentes: `session`, `plane`, `cmux`, `hook`, `orchestrator`, `gsd` (reservado Fase 9+).
- **D-16:** `src/check.js` prohibido de importar `logger.js` (intocable).

**Transcript (LOG-10)**

- **D-17:** Path determinístico: `~/.claude/projects/${encodeURIComponent(project_path).replace(/%2F/g,'-')}/${sessionId}.jsonl`. Sin glob, sin I/O.
- **D-18:** Emisor de `session.start`: hook `SessionStart` (`src/hooks/session-start.js`). Payload de Claude trae `transcript_path` en primera persona.
- **D-19:** Correlation fields bindeados vía `.child({ plane_task_id, phase_id })`.

**Lookup `--session-of` (LOG-11)**

- **D-20:** Resolver dos pasos: (1) `loadState()` busca por `task_id`; (2) fallback: leer **solo la primera línea** de cada `~/.kodo/logs/*.ndjson`.
- **D-21:** Multi-match: ordenar por `session.start.timestamp` DESC; warn a stderr listando descartados.
- **D-22:** `--session-of` + `--follow`: resuelve UN session-id al arrancar, follow sobre ese archivo fijo.

### Claude's Discretion

- Nombre exacto del archivo (`src/logger-events.js` vs `src/events.js`).
- Algoritmo exacto del head-line-read.
- Formato exacto del warn de multi-match a stderr.
- Interval del `watchFile` (200ms sugerencia; puede bajar a 100ms si tests lo exigen).
- Estructura del helper de fixture para tests de eventos.

### Deferred Ideas (OUT OF SCOPE)

- `kodo logs --since <timestamp>`, `--grep <pattern>`, `--timeout <s>` — backlog.
- `session.spawn` como 8º tipo — los 7 del ROADMAP son contrato fijo.
- `--follow` multi-sesión con `--session-of` — backlog.
- Exporter Prometheus (LOG-F2), rotación/retención (LOG-F1), shipping (LOG-F3).
- Lint rule anti-interpolación de secretos (deuda heredada, fuera de Fase 7).
- Refactor `src/check.js` separando snapshot/act (deuda heredada, fuera de Fase 7).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOG-05 | `kodo logs <session-id>` imprime el log completo de una sesión | `src/logs/reader.js` (nuevo) + registro en `src/cli.js`. `fs.readFileSync` + split `\n` + parse + formatLine. |
| LOG-06 | `kodo logs <id> --follow` hace tail en vivo | `fs.watchFile(path, { interval: 200 })` con buffer+split para líneas parciales. Empíricamente verificado: fires on append. |
| LOG-07 | `--level <n>` filtra por nivel mínimo | Cliente-side: comparar `LEVELS[line.level] >= LEVELS[flag]` antes de imprimir. `LEVELS` ya exportado desde `logger.js:25`. |
| LOG-09 | 7 eventos tipados | Nuevo `src/logger-events.js` con `EVENTS` frozen + 7 helpers. Cada helper rellena `event` + campos obligatorios. Test `test/logger-events.test.js` con fixture de captura. |
| LOG-10 | `session.start` incluye `transcript_path` | Resolver síncrono en `src/logger-events.js` o helper local al hook. Path determinístico: `homedir()/.claude/projects/{encoded}/{sessionId}.jsonl`. Empíricamente verificado con dir real. |
| LOG-11 | `--session-of <plane-task-id>` localiza el log | Resolver dos pasos: `loadState()` → fallback head-line-read de `~/.kodo/logs/*.ndjson`. |

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         kodo logs (CLI)                             │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ 1. commander parses: <id?>, --session-of, --follow,
         │    --level, --component, --event-type, --json
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  src/cli.js  ←  flag CLI / KODO_LOG_LEVEL env / default 'info'      │
│  action handler delega en src/logs/reader.js                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ 2. Si --session-of: resolve task_id → session_id
         ▼
┌────────────────────────────┐   fallback   ┌────────────────────────┐
│  loadState() by task_id    │─── empty ───▶│  Scan logs/*.ndjson,   │
│  (~/.kodo/state.json)      │              │  head-line-read each   │
└────────────────────────────┘              │  (openSync + readSync) │
         │                                   │  Find session.start    │
         │                                   │  where plane_task_id=X │
         │                                   │  Pick most recent      │
         │                                   │  Warn multi-match      │
         │                                   └────────────────────────┘
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  filePath = KODO_DIR/logs/<sessionId>.ndjson                        │
└─────────────────────────────────────────────────────────────────────┘
         │
         │ 3. Branch: dump vs follow
         ▼
  ┌────────────────────────┐        ┌──────────────────────────────┐
  │  Dump (default)        │        │  --follow                    │
  │  readFileSync(path)    │        │  Wait-until-exists loop      │
  │  split '\n'            │        │  Read byte[0..current size]  │
  │  for line:             │        │  fs.watchFile(path, {200})   │
  │    parse JSON          │        │   on change: read [prev..new]│
  │    filter (lvl/comp/ev)│        │   buffer+split(\n) → lines   │
  │    formatLine          │        │   keep trailing partial      │
  │    stdout.write        │        │   SIGINT → unwatchFile + exit│
  └────────────────────────┘        └──────────────────────────────┘
         │                                           │
         └─────────────┬─────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  formatLine(record, { useColor }) — EXPORTED from src/logger.js     │
│  Reused by both stderr mirror AND CLI reader (single truth)         │
└─────────────────────────────────────────────────────────────────────┘
                       │
                       ▼
                   process.stdout.write(...)


┌─────────────────────────────────────────────────────────────────────┐
│  Emission side (feeds the log files the reader consumes)           │
└─────────────────────────────────────────────────────────────────────┘

  cli.js / server.js
     │ createLogger({ sessionId, minLevel })
     ▼
  Root logger ──┬──▶ session/manager (.child({component:'session'}))
                ├──▶ providers/plane  (.child({component:'plane'}))
                ├──▶ cmux/client      (.child({component:'cmux'}))
                ├──▶ hooks/*          (.child({component:'hook'}))
                ├──▶ orchestrator     (.child({component:'orchestrator'}))
                └──▶ session/state    (.child({component:'state'})) [if emitting]

  Each consumer emits typed events via logger-events.js helpers:
     sessionStart(log, { session_id, plane_task_id, provider,
                         project_path, transcript_path, started_at })
     → log.info('session.start', { event: 'session.start', ...fields })
     → writeNdjson → ~/.kodo/logs/<sessionId>.ndjson
```

### Recommended Project Structure

```
src/
├── logger.js               # EXISTING. Add exports: formatLine, COLOR_BY_LEVEL.
├── logger-noop.js          # EXISTING. Untouched.
├── logger-events.js        # NEW. EVENTS frozen + 7 helpers + transcript path resolver.
├── logs/
│   └── reader.js           # NEW. CLI action handler: dump, follow, filter, session-of.
├── cli.js                  # EDIT. Register `kodo logs`. Parse --log-level → root logger.
├── server.js               # EDIT. createLogger for webhook flow.
├── session/
│   ├── manager.js          # EDIT. Accept logger DI; child component='session'.
│   ├── state.js            # EDIT. Accept optional logger arg on mutating fns.
│   └── health.js           # EDIT. Accept logger DI.
├── providers/plane/
│   ├── client.js           # EDIT. Accept logger in constructor; planeApiCall helper.
│   └── provider.js         # EDIT. Accept logger DI.
├── cmux/client.js          # EDIT. Accept logger (module-level or per-call).
├── hooks/
│   ├── session-start.js    # EDIT. Emit sessionStart(logger, {...transcript_path}).
│   └── stop.js             # EDIT. Emit sessionEnd(logger, {...status}).
└── orchestrator/
    └── launch.js           # EDIT. Accept logger DI; orchestratorReview helper.

test/
├── logger-events.test.js   # NEW. Contract tests for 7 helpers.
├── logs-reader.test.js     # NEW. CLI reader action handler tests (stdout mock).
├── logs-follow.test.js     # NEW. Tail semantics: append, wait-exists, partial line.
├── logs-session-of.test.js # NEW. Two-step resolver + multi-match warn.
├── transcript-path.test.js # NEW. Path resolver determinism + edge cases.
└── fixtures/
    └── events-golden.ndjson # NEW. Golden sample — 1 línea por cada uno de los 7 tipos.
```

### Pattern 1: Commander sub-command con variadic flag

**What:** Registrar `kodo logs` con `--event-type <type...>` variadic (acepta múltiples).
**When to use:** Cualquier filtro que acepte 1..N valores sin parseo CSV custom.
**Example:**

```javascript
// Source: [VERIFIED empírico: commander 13.1.0 + Node v24.14.0]
// Parsing `kodo logs sess-1 --event-type session.start --event-type plane.api.call`
// gives opts.eventType === ['session.start', 'plane.api.call']
program
  .command('logs [session-id]')  // opcional porque --session-of lo reemplaza
  .description('Inspect session log')
  .option('-f, --follow', 'Tail live output')
  .option('-l, --level <level>', 'Min level: debug|info|warn|error')
  .option('-c, --component <name>', 'Filter by component')
  .option('-e, --event-type <type...>', 'Filter by event type (repeatable)')
  .option('--json', 'Emit raw NDJSON (pipe-friendly)')
  .option('--session-of <task-id>', 'Resolve session-id from Plane task id')
  .action(async (sessionId, opts) => {
    const { runLogs } = await import('./logs/reader.js');
    await runLogs({ sessionId, ...opts });
  });
```

### Pattern 2: Head-line read (sin readline)

**What:** Leer solo la primera línea de un archivo NDJSON para extraer `session.start.plane_task_id`.
**When to use:** Scanning N archivos en el fallback de `--session-of`.
**Example:**

```javascript
// Source: [VERIFIED empírico: /tmp/kodo-headline.ndjson test]
import { openSync, readSync, closeSync } from 'node:fs';

const MAX_HEADLINE_BYTES = 65536; // guardrail anti-archivo-corrupto

/**
 * Lee solo la primera línea de un archivo. Mucho más barato que readline
 * cuando el archivo es grande y solo nos importa la cabecera.
 * @param {string} filePath
 * @returns {string | null} la línea sin '\n', o null si no hay newline dentro del cap
 */
function readFirstLine(filePath) {
  const fd = openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4096);
    let acc = '';
    let pos = 0;
    while (acc.length < MAX_HEADLINE_BYTES) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) return null; // EOF sin '\n'
      const chunk = buf.slice(0, n).toString('utf8');
      const nl = chunk.indexOf('\n');
      if (nl !== -1) return acc + chunk.slice(0, nl);
      acc += chunk;
      pos += n;
    }
    return null;
  } finally {
    closeSync(fd);
  }
}
```

### Pattern 3: Tail con `fs.watchFile` + buffer+split

**What:** Seguir un archivo NDJSON append-only, manejando líneas parciales y archivo inexistente.
**When to use:** `--follow` y `--session-of --follow`.
**Example:**

```javascript
// Source: [VERIFIED empírico: /tmp/kodo-watch-test.ndjson + partial-line test]
import { watchFile, unwatchFile, openSync, readSync, closeSync, existsSync, statSync } from 'node:fs';

/**
 * Tail-follow con buffer para líneas parciales.
 * @param {string} filePath
 * @param {(line: string) => void} onLine  called once per complete JSON line
 */
function followFile(filePath, onLine) {
  let readFrom = 0;
  let buffer = '';

  // Empíricamente: watchFile sobre archivo inexistente fires con size=0/birthtime=0
  // luego dispara de nuevo cuando aparece. "Wait-until-exists" gratis.
  if (existsSync(filePath)) {
    readFrom = 0;  // dump desde byte 0 (semántica D-05)
    drainFrom(filePath, 0);
    readFrom = statSync(filePath).size;
  } else {
    process.stderr.write(`waiting for session log to appear...\n`);
  }

  watchFile(filePath, { interval: 200 }, (curr, prev) => {
    if (curr.size === 0 && prev.size === 0) return; // still doesn't exist
    if (curr.size < prev.size) {
      // truncate / rename. En v0.3 no rotamos logs pero no debemos crashear.
      readFrom = 0;
      buffer = '';
    }
    if (curr.size > readFrom) {
      drainFrom(filePath, readFrom);
      readFrom = curr.size;
    }
  });

  process.on('SIGINT', () => {
    unwatchFile(filePath);
    process.exit(0);
  });

  function drainFrom(path, start) {
    const fd = openSync(path, 'r');
    try {
      const size = statSync(path).size - start;
      if (size <= 0) return;
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, start);
      buffer += buf.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop();  // guarda el fragmento parcial (si queda)
      for (const line of parts) if (line) onLine(line);
    } finally {
      closeSync(fd);
    }
  }
}
```

### Pattern 4: Event helper con contrato mínimo

**What:** Helpers de taxonomía que garantizan los campos del contrato.
**When to use:** Todos los callsites críticos usan estos en lugar de `log.info('session.start', {...})` a pelo.
**Example:**

```javascript
// src/logger-events.js
// Source: [CITED: D-08, D-09, D-10]
import { homedir } from 'node:os';
import { join } from 'node:path';

export const EVENTS = Object.freeze({
  SESSION_START:        'session.start',
  SESSION_END:          'session.end',
  STATE_TRANSITION:     'state.transition',
  ORCHESTRATOR_REVIEW:  'orchestrator.review',
  GSD_PHASE_RESOLVED:   'gsd.phase.resolved',
  GSD_BOOTSTRAP:        'gsd.bootstrap',
  PLANE_API_CALL:       'plane.api.call',
});

/**
 * Deterministic transcript path. Pure — no I/O.
 * [VERIFIED: /Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/<uuid>.jsonl exists]
 * @param {string} projectPath absolute
 * @param {string} sessionId UUID v4
 * @returns {string}
 */
export function resolveTranscriptPath(projectPath, sessionId) {
  const encoded = encodeURIComponent(projectPath).replace(/%2F/g, '-');
  return join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`);
}

/**
 * Emit the 7-field session.start contract line.
 * @param {import('./logger.js').Logger} logger
 * @param {{ session_id: string, plane_task_id: string | null, provider: string,
 *           project_path: string, transcript_path?: string, started_at: string }} fields
 */
export function sessionStart(logger, fields) {
  const transcript_path = fields.transcript_path
    ?? resolveTranscriptPath(fields.project_path, fields.session_id);
  logger.info('session.start', {
    event: EVENTS.SESSION_START,
    session_id: fields.session_id,
    plane_task_id: fields.plane_task_id,
    provider: fields.provider,
    project_path: fields.project_path,
    transcript_path,
    started_at: fields.started_at,
  });
}
// ... sessionEnd, stateTransition, orchestratorReview, gsdPhaseResolved,
//     gsdBootstrap, planeApiCall (analog shape)
```

### Pattern 5: Fixture para tests de eventos

**What:** Captura NDJSON en memoria via logger real + lectura de archivo tmp (aprovechando `makeTmpHome` de Fase 6).
**When to use:** `test/logger-events.test.js` — asserta que cada helper emite los campos del contrato.
**Example:**

```javascript
// Source: [VERIFIED: test/helpers/logger-fixtures.js:10 patrón ya usado]
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTmpHome, readAllLines } from './helpers/logger-fixtures.js';

const fx = makeTmpHome({ sessionId: 'sess-events-unit', label: 'events' });
after(() => fx.cleanup());

const { createLogger } = await import('../src/logger.js');
const { sessionStart, EVENTS } = await import('../src/logger-events.js');

describe('logger-events: session.start contract (D-10)', () => {
  it('emits all 6 required fields', () => {
    const log = createLogger({ sessionId: 'sess-events-unit', minLevel: 'info' });
    sessionStart(log, {
      session_id: 'sess-events-unit',
      plane_task_id: 'KL-42',
      provider: 'plane',
      project_path: '/tmp/kodo-demo',
      started_at: '2026-04-16T10:00:00.000Z',
    });
    const line = readAllLines(fx.logPath).pop();
    assert.equal(line.event, EVENTS.SESSION_START);
    for (const f of ['session_id','plane_task_id','provider','project_path','transcript_path','started_at']) {
      assert.ok(f in line, `session.start missing required field: ${f}`);
    }
    assert.match(line.transcript_path, /\/\.claude\/projects\/-tmp-kodo-demo\/sess-events-unit\.jsonl$/);
  });
});
```

### Anti-Patterns to Avoid

- **Singleton global logger via `getLogger()` factory:** rompe tests de aislamiento y hace imposible inyectar mocks. Siempre DI — ya establecido por `TaskProvider` (Fase 3) y re-confirmado en D-14.
- **`fs.watch` en lugar de `fs.watchFile`:** [VERIFIED: D-04] inotify/FSEvents tienen eventos coalesced, rename/truncate inconsistentes por plataforma, no funciona en NFS. `watchFile` es polling portable.
- **Duplicar el formato pretty-print entre `logger.js` y el reader:** crea dos fuentes de verdad que divergen con el tiempo. Exportar `formatLine` desde `logger.js` y reutilizar.
- **Usar `readline.createInterface` para head-line-read:** lee stream entero aunque rompas el loop; para N archivos = O(N·size). `readSync(buf)` es O(N·4KB).
- **Interpolar secretos en `msg`:** el redactor cubre keys/valores, NO interpolación en strings. Convención documentada en Fase 6 threat model. Fase 7 solo debe respetar — no fija lint rule (deferred).
- **Parsear línea por línea con `JSON.parse` sin try/catch:** una línea malformada (escritura interrumpida, fsync mid-flight) tumbaría el reader. Envolver en try; si falla, imprimir raw con prefijo `[malformed]` y continuar.
- **Leer todo el `.ndjson` entero en `--session-of` fallback:** solo la primera línea necesaria (cabecera `session.start`). Head-line-read con cap de 64KB.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CLI argument parsing | Regex sobre `process.argv` | commander 13.1.0 (ya dep) | Ya establecido, soporta variadic, help auto, subcommands. |
| Cross-platform file change detection | Custom polling with setInterval | `fs.watchFile({ interval })` | Maneja stat() diffs internamente; libera al exit. |
| JSON line parsing | Character-by-character scanner | `line.split('\n')` + `JSON.parse(line)` | NDJSON es por diseño `split('\n')`; la única sofisticación es bufferear parcial (ver Pattern 3). |
| Pretty-print formatting | Duplicar formato en reader | Exportar `formatLine` desde `logger.js` | Una fuente de verdad. |
| Transcript path lookup | `glob(~/.claude/projects/**)` | Path determinístico `resolveTranscriptPath` | D-17 + VERIFIED: encoding exacto produce el directorio correcto. |
| Level numeric comparison | Hardcodear `{debug:1, info:2, ...}` en reader | Importar `LEVELS` de `logger.js:25` | Ya exportado; una fuente de verdad. |

**Key insight:** El 90% de la fase es cablear pieces ya existentes (logger, commander, stdlib fs) con contratos cerrados. El único código novel es: (1) head-line-read, (2) follow con buffer+split, (3) helpers de taxonomía. Todo lo demás es DI wiring.

## Runtime State Inventory

> N/A — Phase 7 es greenfield feature addition sobre logger ya entregado. No rename, no refactor de estado persistido.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 7 solo **lee** `~/.kodo/logs/*.ndjson` (emite el logger, no inventa un store nuevo). | None |
| Live service config | None — `--follow` abre file handles transitorios, no registra servicios. | None |
| OS-registered state | None — sin launchd/pm2/TaskScheduler. | None |
| Secrets/env vars | `KODO_LOG_LEVEL` se lee en cli.js/server.js (nueva convención, no reemplaza ninguna existente). | Documentar en CLI `--help`. |
| Build artifacts | None — ES modules, sin compile step. | None |

## Common Pitfalls

### Pitfall 1: `fs.watch` en lugar de `fs.watchFile`

**What goes wrong:** Tail stops firing after rename/truncate; eventos coalesced en macOS; crashes en NFS.
**Why it happens:** `fs.watch` usa inotify (Linux) / FSEvents (macOS) — API de bajo nivel con semánticas distintas por plataforma.
**How to avoid:** Usar `fs.watchFile` (polling con `stat()`). D-04 lo fija. Penalización ~200ms — aceptable para tail humano.
**Warning signs:** Test en CI funciona local pero timeouts en otro OS.

### Pitfall 2: Partial line at watch-fire boundary

**What goes wrong:** `appendFileSync` escribe `{"a":1}\n{"b":2` (flush parcial), watchFile dispara, reader parsea `{"b":2` → `JSON.parse` throws.
**Why it happens:** Mid-write capture. POSIX `appendFileSync` es atómico ≤PIPE_BUF, pero líneas grandes o flush intermedio pueden dejar un `{...` sin `\n`.
**How to avoid:** Buffer+split — guardar el fragmento tras el último `\n`, reparsear cuando llegue más. Pattern 3 lo implementa.
**Warning signs:** Tail muestra líneas OK pero ocasional `SyntaxError: Unexpected end of JSON input`.

### Pitfall 3: Transcript path encoding falla con paths exóticos

**What goes wrong:** Para `/Users/alex/dev/kodo`, `encodeURIComponent(p).replace(/%2F/g,'-')` = `-Users-alex-dev-kodo` (match Claude). Para `/Users/alex/proyecto ñ`, produce `-Users-alex-proyecto%20%C3%B1` — NO matchea cómo Claude nombra su dir (que podría ser `-Users-alex-proyecto--` o similar).
**Why it happens:** Claude Code tiene su propia normalización; reverse-engineered en CONTEXT.md pero nunca auditada formalmente.
**How to avoid:** Aceptar esta limitación explícitamente en D-17 ("Si el fichero no existe cuando el dev abre el transcript, el logger no es responsable — sólo persiste la referencia."). Documentar en JSDoc de `resolveTranscriptPath` que paths con chars no-ASCII fuera de `[A-Za-z0-9-_.~]` pueden divergir de la convención Claude real. **[VERIFIED empírico]** en mi test: `encodeURIComponent('/Users/alex/dev/klab/kodo with space/ñ').replace(/%2F/g,'-')` = `-Users-alex-dev-klab-kodo%20with%20space-%C3%B1` — no cumple la convención hypen-only.
**Warning signs:** En un repo con unicode en el path, `kodo logs --session-of X` funciona pero el transcript no se abre.

### Pitfall 4: Multi-match de `--session-of` devuelve la sesión equivocada

**What goes wrong:** Múltiples sesiones históricas para el mismo task_id existen en `logs/`. Sin ordenación, el primer match gana y podría ser obsoleto.
**Why it happens:** `fs.readdirSync` no garantiza orden por mtime.
**How to avoid:** D-21 fija: ordenar por `session.start.timestamp` DESC, elegir más reciente, warn a stderr con los descartados. Warn UI debe ser `unobtrusive` — una línea con session_id + timestamp.
**Warning signs:** Dev reporta "me está mostrando logs viejos para esta tarea".

### Pitfall 5: Variadic flag de commander y parsing

**What goes wrong:** `--event-type session.start plane.api.call` (sin repeat) se parsea incorrectamente en algunas versiones de commander.
**Why it happens:** Commander 13 distingue `option('-e <type...>')` (variadic via repeats: `-e a -e b`) de `option('-e <types...>')` (argv consuming).
**How to avoid:** [VERIFIED empírico: `-e a -e b` → `['a','b']` en commander 13.1.0]. Usar signature `<type...>` y documentar en help que se repite el flag. Alternativa CSV es sugar: `--event-type session.start,plane.api.call` parseado por el action handler.
**Warning signs:** `opts.eventType` es string cuando esperabas array.

### Pitfall 6: DI rompiendo `test/check-isolation.test.js`

**What goes wrong:** Al cablear logger a `session/state.js`, si `state.js` acaba siendo importado desde el grafo de `check.js`, el test de grafo lo pilla y falla.
**Why it happens:** `src/check.js` → `src/session/state.js` (para `listSessions`) es un camino real. Si `state.js` importa `logger.js`, falla LOG-12.
**How to avoid:** `state.js` acepta `logger` como **argumento opcional** en fns mutating — si es undefined, cae al `noopLogger` ya importado. Nunca `import { createLogger } from '../logger.js'` a nivel módulo dentro de state.js. Verificar runtime: `npm test` debe seguir PASS con `check-isolation.test.js` al completar wave 2.
**Warning signs:** `test/check-isolation.test.js` Test 3 falla con "check.js transitively imports src/logger.js via...".

### Pitfall 7: Double emission de `session.start`

**What goes wrong:** Tanto el `session/manager` (que arranca el proceso) como el hook `session-start.js` (que recibe el SessionStart de Claude) emiten `session.start`.
**Why it happens:** El manager sabe cuándo lanzó el workspace; el hook sabe el `transcript_path` real. Ambos tienen info valiosa.
**How to avoid:** D-18 fija que el **emisor oficial** de `session.start` es el hook (tiene `transcript_path` fidedigno). Si el manager quiere registrar "workspace creado", emite un log libre `logger.info('session.spawn', {...})` (no tipado, no cuenta como 8º tipo — D-07 permite líneas sin `event`).
**Warning signs:** Dos líneas `event: "session.start"` en el mismo `.ndjson` con timestamps consecutivos.

## Code Examples

### Pretty-print reusado desde logger.js

```javascript
// Source: [extracción refactor de src/logger.js:222-257, ya en el codebase]
// src/logger.js — añadir exports:
export const COLOR_BY_LEVEL = Object.freeze({
  debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m',
});

export const ANSI_RESET = '\x1b[0m';

/**
 * Pretty-format a log record. Shared by stderr mirror AND `kodo logs` CLI.
 * Pure — no I/O.
 * @param {object} record
 * @param {{ useColor: boolean }} opts
 * @returns {string}
 */
export function formatLine(record, { useColor }) {
  const time = String(record.timestamp).slice(11, 19);
  const lvl = String(record.level).toUpperCase();
  const c = useColor ? COLOR_BY_LEVEL[record.level] : '';
  const r = useColor ? ANSI_RESET : '';
  const comp = record.component ? ` ${record.component}` : '';
  const ctx = formatCtxInline(record);
  return `${time} ${c}${lvl}${r}${comp} ${record.msg}${ctx}`;
}
```

### Reader action handler (dump)

```javascript
// src/logs/reader.js (NEW)
// Source: [synthesis of D-01..D-06]
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { LEVELS, formatLine } from '../logger.js';

/** @param {{ sessionId?: string, follow?: boolean, level?: string, component?: string, eventType?: string[], json?: boolean, sessionOf?: string }} opts */
export async function runLogs(opts) {
  const sessionId = opts.sessionOf
    ? await resolveSessionIdFromTaskId(opts.sessionOf)
    : opts.sessionId;

  if (!sessionId) {
    console.error('Usage: kodo logs <session-id> | kodo logs --session-of <task-id>');
    process.exit(2);
  }

  const filePath = join(KODO_DIR, 'logs', `${sessionId}.ndjson`);
  const minLevelNum = opts.level ? LEVELS[opts.level] : LEVELS.debug;
  const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

  const printLine = opts.json
    ? (raw) => process.stdout.write(raw + '\n')
    : (raw) => {
        let rec;
        try { rec = JSON.parse(raw); }
        catch { return process.stdout.write(`[malformed] ${raw}\n`); }
        if (LEVELS[rec.level] < minLevelNum) return;
        if (opts.component && rec.component !== opts.component) return;
        if (opts.eventType?.length && !opts.eventType.includes(rec.event)) return;
        process.stdout.write(formatLine(rec, { useColor }) + '\n');
      };

  if (opts.follow) {
    const { followFile } = await import('./follow.js');
    followFile(filePath, printLine);
  } else {
    if (!existsSync(filePath)) {
      console.error(`No log file at ${filePath}`);
      process.exit(1);
    }
    const raw = readFileSync(filePath, 'utf-8');
    for (const line of raw.split('\n')) if (line) printLine(line);
  }
}
```

### `--session-of` resolver (two-step)

```javascript
// src/logs/session-of.js (NEW)
// Source: [synthesis of D-20, D-21; head-line-read VERIFIED]
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
import { loadState } from '../session/state.js';
import { readFirstLine } from './head-line.js';  // Pattern 2

export async function resolveSessionIdFromTaskId(taskId) {
  // Step 1: state.json
  const state = loadState();
  const hit = Object.values(state.sessions).find(s => s.task_id === taskId || s.task_ref === taskId);
  if (hit) return hit.session_id;

  // Step 2: scan logs/ for session.start.plane_task_id === taskId
  const logsDir = join(KODO_DIR, 'logs');
  if (!existsSync(logsDir)) return null;
  const matches = [];
  for (const fn of readdirSync(logsDir)) {
    if (!fn.endsWith('.ndjson')) continue;
    const first = readFirstLine(join(logsDir, fn));
    if (!first) continue;
    let rec;
    try { rec = JSON.parse(first); } catch { continue; }
    if (rec.event === 'session.start' && rec.plane_task_id === taskId) {
      matches.push({ sessionId: fn.replace(/\.ndjson$/, ''), timestamp: rec.timestamp });
    }
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  if (matches.length > 1) {
    process.stderr.write(`Multiple sessions for task ${taskId}:\n`);
    for (const m of matches.slice(1)) process.stderr.write(`  ${m.sessionId}  ${m.timestamp}\n`);
    process.stderr.write(`Using most recent: ${matches[0].sessionId}\n\n`);
  }
  return matches[0].sessionId;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.log` / `console.error` scattered | Structured NDJSON logger (Fase 6) | 2026-04-15 | Fase 7 solo consume. |
| Logger singleton via `getLogger()` | DI explícito por argumento (D-13/14) | Fase 7 establece | Test isolation; no more mocking `import.meta`. |
| `fs.watch` para tailing | `fs.watchFile` polling (D-04) | Fase 7 establece | Portable, sin edge cases. |
| Eventos libres `log.info('session started')` | Taxonomía cerrada + helpers (D-07/08/09) | Fase 7 establece | Grep/filter fiable; IDE autocomplete. |
| `readline.createInterface` para head-line | `fs.openSync + readSync` (Pattern 2) | Fase 7 establece | O(4KB) vs O(file size). |

**Deprecated/outdated:**
- Nada deprecado. Fase 6 es foundation intocada.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `fs.watchFile` con 200ms interval es responsivo suficiente para UX humana de tail | D-04 + Pitfall 1 | Dev percibe lag > 200ms. Mitigación: interval configurable, bajar a 100ms si tests lo requieren (Claude's Discretion). |
| A2 | El payload que Claude Code envía al hook `SessionStart` incluye `transcript_path` en todas las versiones que usa el equipo | D-18 | Si la versión actual de Claude no manda el campo, el hook debe reconstruirlo vía `resolveTranscriptPath(cwd, sessionId)`. **Mitigación:** helper ya gestiona fallback (Pattern 4: `transcript_path ?? resolveTranscriptPath(...)`). |
| A3 | Claude Code usa exactamente `encodeURIComponent(path).replace(/%2F/g, '-')` para derivar el nombre del directorio `-Users-...-kodo/` | D-17 | [PARTIALLY VERIFIED]: caso ASCII confirmado empíricamente. Para paths unicode/space la convención real es desconocida — Pitfall 3 documenta como limitación aceptada. |
| A4 | `commander@13.1.0` soporta variadic `<type...>` con repeated flags en el shape que usamos | D-02 | [VERIFIED empírico] → NO risk. |
| A5 | `session/state.js` puede aceptar `logger` opcional sin romper `test/check-isolation.test.js` | D-14, Pitfall 6 | Verificación en CI obligatoria durante Wave 2. Si falla, `state.js` se queda sin emisión y el logging se hace en `session/manager.js` a nivel orquestador. |
| A6 | Los 7 consumers listados cubren todos los callsites críticos para los 7 eventos de la taxonomía | D-14 + D-09 mapping | `plane.api.call` requiere `plane/client.js` + `plane/provider.js`. `state.transition` probablemente en `session/manager.js` (al cambiar `session.status`). Si hay un callsite faltante, el evento simplemente no se emite — no hay error, solo gap. Planner debe mapear 7 eventos → callsites durante waves. |
| A7 | El emisor de `session.end` es el hook `stop.js` (simetría con `session-start.js` para `session.start`) | Inferencia de D-18 | Si se decide que el manager emite `session.end` al remover la sesión, cambia el callsite pero no el contrato. Bajo riesgo. |
| A8 | Duplicar el test `test/startup-budget.test.js` no es necesario en Fase 7 | Context | Deuda explícitamente diferida. `test/check-isolation.test.js` ya protege LOG-12. |

## Open Questions

1. **¿Dónde va el emisor de `session.end`?**
   - What we know: D-18 fija `session.start` → hook `session-start.js`. Simetría sugiere `stop.js`.
   - What's unclear: `stop.js` corre **después** de `/exit` de Claude. El `Stop` hook recibe `session_id` y `cwd`; no tiene `status` explícito. Hay que derivar status de `session.status` en state.json antes de `removeSession`.
   - Recommendation: Planner fija: `stop.js` llama `sessionEnd(log, { session_id, status: session.status, ended_at })` antes de `removeSession()`. Documentar en Wave 2.

2. **¿`state.transition` es un evento distinto o cualquier cambio de `session.status`?**
   - What we know: D-09 firma `stateTransition(logger, { from, to, reason })`.
   - What's unclear: ¿Solo el `session.status` (running → done/error/review)? ¿O también transiciones de estado de Plane (In Progress → In Review)?
   - Recommendation: En v0.3, `state.transition` = cambio de `session.status`. Las transiciones Plane-side se cubren por `plane.api.call` con `method: 'PATCH', path: '/work-items/.../state/'`. Planner fija esto en ALGORITHM del plan de Wave 2.

3. **¿Exportar `COLOR_BY_LEVEL` + `formatLine` desde `logger.js` requiere refactor de Fase 6?**
   - What we know: Ambos son privados en `src/logger.js` actual. Fase 6 cerrada, API contrato.
   - What's unclear: ¿Exportar constantes/funciones extraídas cuenta como "modificar el logger"? Técnicamente sí, pero es **additive only** — no cambia comportamiento ni firma de createLogger.
   - Recommendation: Permitido — Fase 6 dice "API intocable" referido a `createLogger` y `.child`. Exportar constantes es extensión, no breaking change. Planner añade Wave 1 task: "Export COLOR_BY_LEVEL, ANSI_RESET, formatLine from logger.js (additive, no behavior change)". Validado por `test/logger.test.js` sin modificación — los tests existentes siguen pasando si las firmas originales no cambian.

4. **¿Interval de `watchFile` 200ms vs 100ms?**
   - What we know: D-04 sugiere 200ms; Claude's Discretion para bajar.
   - What's unclear: ¿Hay tests que imponen latencia < 200ms? Probablemente no en v0.3.
   - Recommendation: Empezar con 200ms. Si test de tail timeouts por slow CI, subir (no bajar). Constante `FOLLOW_INTERVAL_MS = 200` exportada para test override.

5. **¿`state.js` debe emitir o solo consumir el logger?**
   - What we know: D-14 menciona "(si emite)". Actualmente state.js hace I/O a state.json silenciosamente.
   - What's unclear: ¿Vale la pena loggear `addSession`/`removeSession`?
   - Recommendation: Sí — son transiciones útiles para debug. Pero el logger es **opcional** (default `noopLogger`) para mantener `state.js` importable desde `check.js` sin romper LOG-12. Patrón: `export function addSession(taskId, session, logger = noopLogger) { ... logger.info('state.session.added', { task_id }); }`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v24.14.0 (engines: `>=20.0.0`) | — |
| `commander` | CLI parsing | ✓ | 13.1.0 (installed, `node_modules/`) | — |
| `fs.watchFile` | tail `--follow` | ✓ | stdlib since Node 0.x | Polling custom con `setInterval + statSync` (nunca necesario) |
| `fs.openSync` + `readSync` | head-line-read | ✓ | stdlib since Node 0.x | Leer archivo entero con `readFileSync` (ineficiente pero funcional) |
| `~/.kodo/logs/` dir | Leer NDJSON | ✓ | Creado por Fase 6 logger al primer `createLogger` call | Reader debe manejar "no dir" con error claro. |
| `~/.claude/projects/` dir | Resolver transcript | ✓ (verificado empíricamente) | Creado por Claude Code | Resolver devuelve path no-existente; hook escribe referencia y dev ve el path en `kodo logs`. |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (stdlib) + `node:assert/strict` |
| Config file | None (stdlib; `package.json:9` → `"test": "node --test test/**/*.test.js"`) |
| Quick run command | `npm test -- --test-name-pattern "logger-events"` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOG-05 | `kodo logs <id>` dumps full log | integration | `npm test -- --test-name-pattern "logs-reader: dump"` | ❌ Wave 0 (`test/logs-reader.test.js`) |
| LOG-06 | `--follow` tails in live | integration | `npm test -- --test-name-pattern "logs-follow"` | ❌ Wave 0 (`test/logs-follow.test.js`) |
| LOG-07 | `--level <n>` filters | unit | `npm test -- --test-name-pattern "logs-reader: filter"` | ❌ Wave 0 (same file) |
| LOG-09 | 7 event helpers with contract | unit | `npm test -- --test-name-pattern "logger-events"` | ❌ Wave 0 (`test/logger-events.test.js`) |
| LOG-10 | `session.start` has `transcript_path` | unit | `npm test -- --test-name-pattern "session.start contract"` | ❌ Wave 0 (in `logger-events.test.js`) |
| LOG-11 | `--session-of <task-id>` resolves | integration | `npm test -- --test-name-pattern "logs-session-of"` | ❌ Wave 0 (`test/logs-session-of.test.js`) |
| LOG-12 | Vigilante isolation preserved | unit | `npm test -- --test-name-pattern "LOG-12"` | ✅ (existe, NO tocar) |

### Sample Points / Oracles / Invariants (Nyquist)

**Oracle — source of truth for each success criterion:**

| Success Criterion | Sample Point | Oracle | Invariant |
|-------------------|--------------|--------|-----------|
| **SC-1**: `kodo logs <id>` imprime completo + `--follow` live + `--level` filtra | stdout del comando | Contenido exacto del `~/.kodo/logs/<id>.ndjson` tras N emisiones desde un fixture | Líneas impresas ⊆ líneas del archivo ∧ orden preservado ∧ count filtrado = count real_level≥min |
| **SC-2**: `--session-of <task-id>` localiza sin session-id | stdout first line (session_id resuelto) | 1) `loadState().sessions[task_id].session_id`; 2) `session.start.plane_task_id` headlined | resolver(task_id) = sessionId ∧ archivo abierto = `<sessionId>.ndjson` |
| **SC-3**: 7 callsites emiten tipos fijos | NDJSON records de `~/.kodo/logs/<sess>.ndjson` | `events-golden.ndjson` fixture (1 line per type) | ∀ evento tipado: `rec.event ∈ EVENTS` ∧ `Object.keys(rec)` ⊇ contrato del tipo |
| **SC-4**: `session.start` incluye `transcript_path` de Claude Code | Field `transcript_path` en la línea `event: 'session.start'` | `resolveTranscriptPath(project_path, session_id)` | `transcript_path` == `join(homedir(), '.claude/projects', encoded, sessionId+'.jsonl')` ∧ campo existe en el record |

**Sample Rate (Nyquist frequency):**

- **Per task commit:** `npm test -- --test-name-pattern "logger-events|logs-reader|logs-follow|logs-session-of|transcript-path"` (~300ms, ~25 it)
- **Per wave merge:** `npm test` (full suite — verifica `check-isolation` no regresionado, existing 139 tests + new ~25 = ~165 total)
- **Phase gate:** Full suite green + golden fixture `test/fixtures/events-golden.ndjson` checked-in + `kodo logs` manually exercised against real `~/.kodo/logs/` of a dev session.

**Test invariants — what MUST be true after Phase 7:**

1. **LOG-12 intact:** `test/check-isolation.test.js` passes without modification. Adding `logger-events.js` does NOT appear in `walkImports('src/check.js')`.
2. **Zero new deps:** `package.json` dependencies count is unchanged (only `commander`).
3. **Taxonomy closed:** Any `rec.event` in a real log file is `∈ EVENTS` (violated only by legacy/untyped lines — explicitly allowed by D-07).
4. **Single pretty-print source:** No other file besides `src/logger.js` contains the string `toUpperCase()` next to `timestamp.slice(11, 19)` — reuse is enforced by code review, not automated (acceptable: drift would show visually in first dev session).
5. **Head-line-read bounded:** `readFirstLine` never reads > 65536 bytes — bounded buffer test.
6. **Follow semantics complete:** append → fires; truncate → resets readFrom; non-existent → waits; SIGINT → clean exit.

### Wave 0 Gaps

- [ ] `test/logger-events.test.js` — contract tests for 7 helpers (covers LOG-09, LOG-10)
- [ ] `test/logs-reader.test.js` — dump + filter tests (LOG-05, LOG-07)
- [ ] `test/logs-follow.test.js` — tail semantics incl. append, wait-exists, partial-line, SIGINT (LOG-06)
- [ ] `test/logs-session-of.test.js` — two-step resolver + multi-match warn (LOG-11)
- [ ] `test/transcript-path.test.js` — determinism of `resolveTranscriptPath` including edge cases
- [ ] `test/fixtures/events-golden.ndjson` — 1 line per each of 7 types with full contract fields
- [ ] `test/helpers/logger-fixtures.js` extension: add `captureStdout(fn)` helper (wraps `process.stdout.write` mock)

*Framework install: NOT needed — `node:test` is stdlib.*

## Project Constraints (from CLAUDE.md)

El `CLAUDE.md` global del usuario está orientado a Ruby on Rails / WordPress — **no aplica** a este repo JavaScript/Node. El `CLAUDE.md` del proyecto (en repo) está vacío. Las reglas que rigen aquí están en `.planning/PROJECT.md` y `STATE.md`:

- **Zero new runtime deps** (principio explícito, STATE.md "Decisions"). `commander@13.1.0` es la única dep y se mantiene.
- **ES modules puros** (`"type": "module"` en `package.json:5`). No CommonJS.
- **Factory functions sobre classes** (salvo `PlaneClient`, excepción histórica).
- **JSDoc `@param`/`@return` obligatorio** en API público.
- **Tests con `node:test` + `node:assert/strict`**; fixtures en tmpdir con cleanup.
- **`src/check.js` no importa `logger.js`** (LOG-12, guardado por `test/check-isolation.test.js` — 4 asserts, intocable).
- **Redactor aplicado dentro del logger** (Fase 6); Fase 7 no redacta, solo pasa ctx a `logger.info` (que redacta internamente).
- **Hooks nunca tumban Claude Code** (`session-start.js:107` silent failure pattern). Aplicable a `sessionStart(log, ...)`: si el logger falla, el hook debe seguir emitiendo el `additionalContext`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `commander` valida presencia/shape del flag. Filtros aplican contra whitelist estática (`LEVELS`, `EVENTS`). Nunca ejecutamos el input. |
| V6 Cryptography | no | — |
| V7 Error Handling | yes | `try/catch` alrededor de `JSON.parse` (malformed NDJSON); SIGINT handler limpio. |
| V8 Data Protection | yes | Redacción delegada al logger (Fase 6); reader **solo lee** — cero riesgo de leak. El archivo NDJSON ya fue redactado antes de escribirse. |
| V14 Logging & Error | yes (core domain) | — Redacción (LOG-08) ya cubierto Fase 6. Retención out-of-scope v0.3. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Injection via filter flag (`--component "'; rm -rf /"`) | Tampering | `commander` parsea sin shell; el valor se usa en `===` string comparison, nunca en `child_process`. No shell = no injection. |
| Path traversal via `session-id` → `logs/${id}.ndjson` | Tampering | Whitelist: `sessionId` viene de commander positional + pasa por `join(KODO_DIR, 'logs', ${id}.ndjson)`. Si el usuario pasa `../../etc/passwd`, el join lo resuelve pero `existsSync` devuelve false para `.ndjson` fake → "no log". Aceptable: no hay escritura, solo lectura de archivos que Claude o el propio user tiene acceso. **Mitigación adicional** (Claude's Discretion en plan): validar `sessionId` matches `/^[A-Za-z0-9-]{1,64}$/` antes de interpolar. |
| Leak de secretos no-redactados vía `--json` | Info Disclosure | El redactor de Fase 6 corre ANTES del sink. `--json` lee el archivo ya redactado. Cero riesgo nuevo. |
| Redactor bypass por `event` malformado | Tampering | El taxonomy helper rellena `event` via constante `EVENTS.SESSION_START`, no via input usuario. Las líneas libres (sin `event`) siguen pasando por `redact()` en `emit()`. |
| TOCTOU en `existsSync(path) && readFileSync(path)` | Race | File puede ser deleted entre checks. Mitigación: try/catch sobre `readFileSync`; si ENOENT → "log disappeared" error limpio. No hay escalada de privilegios — el user leía un file que ya era suyo. |

## Sources

### Primary (HIGH confidence)

- [VERIFIED empírico: `/Users/alex/dev/klab/kodo/package.json`] — commander 13.1.0, Node engines >=20.
- [VERIFIED empírico: `node --test test/*.test.js` harness] — ya ejecuta 139 tests Fase 6.
- [VERIFIED empírico: `fs.watchFile` test con append] — fires on size change, bit birthtime=0 sentinel for non-existent.
- [VERIFIED empírico: `readSync + buffer` head-line test] — extrae `{...}` de primera línea con archivo de 5KB+.
- [VERIFIED empírico: commander 13.1.0 variadic `<type...>`] — `['a','b']` para `-t a -t b`.
- [VERIFIED empírico: `/Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/<uuid>.jsonl`] — convención confirmada.
- [VERIFIED empírico: `encodeURIComponent('/Users/alex/dev/klab/kodo').replace(/%2F/g,'-')`] = `-Users-alex-dev-klab-kodo`.
- [VERIFIED empírico: partial line split test] — `raw.split('\n')` + pop incomplete tail.
- `src/logger.js` — exports reales: `LEVELS`, `LEVEL_NAMES`, `createLogger`, `noopLogger`. `COLOR_BY_LEVEL` y `formatLine` son privados.
- `src/cli.js:143-187` — patrón `launch <ref>` como referencia para `logs [session-id]` con opcional positional.
- `test/check-isolation.test.js:75-88` — walker transitivo con regex dual `IMPORT_FROM_RE` + `IMPORT_BARE_RE`.
- `test/helpers/logger-fixtures.js` — `makeTmpHome({ sessionId, label })` + `readAllLines(logPath)` reutilizable en Fase 7.

### Secondary (MEDIUM confidence)

- [CITED: CONTEXT.md D-01..D-22] — 22 decisiones locked por el usuario.
- [CITED: ROADMAP.md §Phase 7] — 4 success criteria + 7 tipos cerrados.
- [CITED: 06-VERIFICATION.md "Deuda transferible a Phase 7"] — DI + CLI + taxonomía + refactor check.js (diferido).
- [CITED: nodejs.org/api/fs.html — fs.watch caveats] — inotify/FSEvents inconsistencies; polling `watchFile` como alternativa portable.

### Tertiary (LOW confidence)

- **A3** (Claude transcript naming con unicode) — solo ASCII verificado empíricamente. Aceptado como limitación documentada en Pitfall 3.
- **A6** (los 7 consumers cubren los 7 callsites) — mapeo evento→callsite es ejercicio del planner; alguno puede quedar sin emisor explícito (p.ej. `state.transition` tiene varios candidatos).

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — todo stdlib + commander 13.1.0 verificado localmente.
- Architecture: HIGH — patrones 1-5 son adaptación directa de código existente (logger.js, cli.js) más 2 piezas novel (head-line, follow) ambas verificadas empíricamente con Node v24.
- Pitfalls: HIGH — 6 de 7 pitfalls tienen evidencia directa (empírica o de VERIFICATION.md de Fase 6). Pitfall 3 es PARTIALLY VERIFIED (edge case documentado).
- Validation Architecture: HIGH — samples, oracles e invariants son derivados directos de los success criteria del ROADMAP + locked decisions.

**Research date:** 2026-04-16
**Valid until:** 2026-05-16 (30 días; commander y Node stdlib son stable; la única volatilidad es el formato de hook `SessionStart` de Claude Code, que cambia con cada release).

---

*Phase: 07-kodo-logs-cli-event-taxonomy*
*Researched: 2026-04-16*
