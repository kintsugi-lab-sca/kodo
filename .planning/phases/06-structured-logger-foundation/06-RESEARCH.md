# Phase 6: Structured Logger Foundation - Research

**Researched:** 2026-04-15
**Domain:** Structured logging (NDJSON) sobre Node 20 stdlib, con redacción de secretos y aislamiento de import-graph
**Confidence:** HIGH (stack trivial, Node built-ins + codebase convenciones; LOW solo en ajuste fino del presupuesto 50 ms)

## Summary

Phase 6 es un módulo puro Node stdlib: factory que produce un logger con ergonomía pino-like (child bindings, niveles numéricos internos, API con `log.level(msg, ctx)`), escribe NDJSON a `~/.kodo/logs/<session-id>.ndjson` con `fs.appendFileSync` (atómico vía `O_APPEND` hasta PIPE_BUF), y espeja `warn`/`error` a stderr en pretty-print. Todo el diseño macro está lockeado en `06-CONTEXT.md` — este documento recolecta el **cómo** técnico para el planner.

La mayor deuda de verificación del phase son dos tests guardianes: (1) un test de import-graph que asegure que `src/check.js` nunca importe `src/logger.js` transitivamente, y (2) un test de presupuesto de arranque que confirme `node bin/kodo check` <50 ms. Ambos son ejecutables exclusivamente con `node:test`, sin dependencias nuevas. La redacción dual (key-set + regex genérico) y el deep-walk con límites son los únicos puntos con más de una vía razonable; el resto es mecánica.

**Primary recommendation:** Un solo archivo `src/logger.js` (~250 LoC estimadas) con sub-secciones lógicas separadas por comentario (factory, redactor, formateo NDJSON, pretty-print). Tests en `test/logger.test.js` + `test/logger.redaction.test.js` + `test/check-isolation.test.js` (import-graph + presupuesto). Escritura con `appendFileSync` + `\n`, `writeSync(2, ...)` para stderr.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**API del logger**
- Factory `createLogger({ sessionId, minLevel })` devuelve logger raíz.
- `logger.child({ component, ...bindings })` crea loggers derivados por módulo (estilo pino/bunyan).
- Signatura de llamada: `log.info('msg', { ctx })` — contexto como segundo argumento, se mezcla con campos base en la línea NDJSON.
- `sessionId` es obligatorio y bindeado en el factory; `plane_task_id` y `phase_id` se añaden vía `.child()` cuando se conocen (phase_id puede llegar tarde, después del resolver).
- No-op fallback disponible para `src/check.js` y cualquier código transitivamente cargado por el vigilante (nunca importar `logger.js` directamente desde `check.js`).

**Niveles**
- Constantes numéricas internas: `debug=10`, `info=20`, `warn=30`, `error=40`.
- API pública y campo `level` en NDJSON son strings (`'debug'|'info'|'warn'|'error'`).
- Configuración: flag CLI `--log-level` > env `KODO_LOG_LEVEL` > default (`info` interactivo). Precedencia exacta se decide durante planning; el API acepta ambos canales.

**Campos NDJSON por línea**
- Base obligatorios: `timestamp` (ISO-8601), `level` (string), `component` (del bind), `msg` (string), `session_id`.
- Opcionales por bind: `plane_task_id`, `phase_id`.
- Contexto arbitrario mezclado a nivel top-level (no anidado bajo `ctx`).

**Redacción de secretos (LOG-08)**
- Estrategia dual: set cerrado de keys sensibles (`PLANE_API_KEY`, `plane_api_key`, `authorization`, `x-api-key`, `x-plane-signature`, `password`, `token`, `secret`, case-insensitive) + regex genérico para valores JWT / API key sin key conocida.
- Placeholder: `[REDACTED]` literal (no hash, no longitud).
- Deep walk con límites: depth=4, array length=100; al exceder se reemplaza por `[REDACTED:depth-exceeded]` o se trunca.
- Se aplica antes de cualquier escritura: NDJSON disco y pretty-print stderr.
- Test cubre: PLANE_API_KEY top-level, header `authorization` anidado, `x-plane-signature` anidado, valor `eyJhbG...` sin key conocida. Asserta grep del archivo no contiene el secreto original y stderr tampoco.

**Pretty-print stderr**
- Formato: `HH:MM:SS LEVEL component msg +ctx`.
- Colores ANSI auto por `process.stderr.isTTY` (respeta `NO_COLOR`).
- Niveles: `warn`+`error` siempre; `info` si TTY Y `minLevel <= info`; `debug` nunca salvo `minLevel=debug` Y TTY.
- Dos sinks independientes. Test asserta que ninguna línea de stderr empieza con `{`.

**Escritura a disco**
- `fs.appendFileSync` por línea, flag `'a'`, `\n` final.
- Directorio: `~/.kodo/logs/<session-id>.ndjson`.
- `mkdirSync(logDir, { recursive: true })` en el factory.
- Fallos I/O: atrapar, un warning pretty-print a stderr por sesión, NO throw.

**Aislamiento del vigilante (LOG-12)**
- `src/check.js` no importa `logger.js` directa ni transitivamente.
- Doble red: (1) test de grafo de imports; (2) test de presupuesto `<50 ms`.

### Claude's Discretion
- Nombres internos exactos de funciones/símbolos del redactor.
- Estructura interna del módulo (un archivo o split si supera ~300 LoC).
- Nombre y forma exacta del flag CLI (`--log-level`, `-L`, etc.).
- Mecanismo técnico del test de grafo (AST nativo, `--trace-imports`, regex source).
- Formato exacto del fallback "write failed" (único por sesión vs throttle).

### Deferred Ideas (OUT OF SCOPE)
- Rotación / retención de logs → LOG-F1 (v2).
- Export de métricas Prometheus → LOG-F2 (v2).
- Transports pluggables (Loki, Datadog) → LOG-F3 (v2).
- Seq monotónico por sesión → revisar en Phase 7.
- Nivel `trace` o `fatal` → out-of-scope.
- `kodo logs` CLI, taxonomía de eventos, cableado GSD → Phases 7–10.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOG-01 | 4 niveles configurables vía `KODO_LOG_LEVEL` + flag CLI | Niveles numéricos internos + API string (sección Architecture Patterns → Level Table). Precedencia CLI > env > default reforzada por pattern en Commander. |
| LOG-02 | NDJSON con `timestamp`, `level`, `component`, `msg`, ctx libre | Sección "NDJSON Writer Pattern" + ejemplo de línea base. `JSON.stringify` directo suficiente dado que redactor preprocesa. |
| LOG-03 | Per-session file `~/.kodo/logs/<session-id>.ndjson` con correlación | `KODO_DIR` ya exportado desde `src/config.js` — reusar. `mkdirSync({recursive: true})` + `appendFileSync` es el par correcto. |
| LOG-04 | Stderr pretty-print warn+ sin duplicar JSON | Dos sinks derivados del mismo evento fuente; test anti-regresión "ninguna línea stderr empieza con `{`". |
| LOG-08 | Redacción PLANE_API_KEY, firmas webhook, Authorization | Sección "Redaction Strategy" con secret patterns concretos (bearer, JWT, webhook signatures, UUID-like API keys). |
| LOG-12 | `kodo check` no carga logger transitivamente, <50 ms arranque | Sección "Import-Graph Isolation Test" con 3 opciones evaluadas (regex source, AST nativo, `--experimental-loader` trace). |
</phase_requirements>

## Project Constraints (no CLAUDE.md en repo, convenciones inferidas de código existente)

- ES modules puros (`"type": "module"`); no CommonJS.
- `// @ts-check` en cabecera de cada archivo fuente; JSDoc `@param`/`@returns` obligatorios en API público.
- Factory functions sin `this`. El único objeto con `class` es `PlaneClient` (excepción histórica).
- Constantes `UPPER_SNAKE_CASE` a nivel módulo; keys de datos serializados `snake_case`.
- Tests: `node:test` + `node:assert/strict`; archivos `test/*.test.js`; fixtures temporales en `tmpdir()`.
- Zero runtime deps excepto `commander@^13`; Node `>=20`.
- Español para comentarios de usuario visibles (ej. `'[kodo] Config migrada...'`); nombres de símbolos en inglés.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| NDJSON serialization | Library (src/logger.js) | — | Pure function; sin side-effects salvo en método terminal |
| Disk I/O (appendFileSync) | Library | — | Encapsulado en un único sink para poder mock-earlo en tests |
| Secret redaction | Library (redactor privado del módulo logger) | — | No se expone público; cada sink lo invoca antes de serializar |
| Stderr pretty-print | Library | — | Segundo sink derivado del mismo evento interno |
| Level resolution (CLI/env) | CLI layer (`src/cli.js` / `bin/kodo`) | Library (acepta ya resuelto) | Keeps `logger.js` puro; CLI compone flag + env → pasa `minLevel` |
| Vigilante isolation enforcement | Test suite (`test/check-isolation.test.js`) | Convention (doc in module head) | No se puede enforcar en runtime sin añadir overhead al camino crítico |
| No-op fallback para check path | Library (exported `noopLogger`) | — | Permite a módulos compartidos aceptar logger opcional sin ramificar lógica |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | builtin (Node 20+) | `appendFileSync`, `mkdirSync`, `writeSync` [VERIFIED: Node docs, atomicidad O_APPEND confirmada] | Parte del stdlib ya usado en `src/config.js` y `src/session/state.js` — consistencia |
| `node:path` | builtin | `join` para `~/.kodo/logs/<id>.ndjson` | Ya en uso |
| `node:os` | builtin | `homedir()` (consumido indirectamente via `KODO_DIR`) | Ya en uso |
| `node:test` + `node:assert/strict` | builtin | Test harness | Standard del proyecto, confirmado en `package.json` `"test": "node --test test/**/*.test.js"` [VERIFIED: package.json] |
| `node:util` | builtin | `inspect()` para pretty-print de ctx grande (fallback JSON compacto) | Built-in; evita tocar `console.*` |

### Supporting (opcional, a evaluar)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:module` | builtin | `Module.builtinModules` + `require('module').createRequire` para walker de import-graph | Opción A del test de aislamiento |
| `node:vm` / regex | builtin | Parse estático de `import ... from './x.js'` via regex | Opción B (más simple) del test de aislamiento |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled NDJSON writer | `pino` | Viola zero-deps; añade ~35 kB, carga inicial 5-8 ms; innecesario para ~6 callsites previstos en v0.3. pino sí se estudia como fuente de ergonomía (child bindings, levels). |
| `appendFileSync` | `createWriteStream` + `end()` | Stream gana throughput pero añade backpressure, flush-on-exit, y riesgo de perder últimas líneas en crash. Para cadencia esperada (<100 líneas/sesión) `appendFileSync` es más simple y atómico hasta PIPE_BUF [VERIFIED: nodejs groups discussion]. |
| Regex genérico para secretos | hashing + entropy scoring | Entropy da falsos positivos en hashes legítimos (UUIDs, git shas). El set cerrado es preciso; regex es fallback conservador para `eyJ…` (JWT) y `plane_*` prefixes. |
| `console.error` para stderr | `process.stderr.write` / `fs.writeSync(2, …)` | `console.*` puede monkey-patchearse (tests, dev tools). `writeSync(2, …)` es determinista y sobrevive a redirecciones. |

**Installation:** ninguna. Node 20+ ya presente. [VERIFIED: package.json `engines.node >=20.0.0`]

## Architecture Patterns

### System Architecture Diagram

```
                  ┌─────────────────────────────────┐
   CLI/env  ───►  │ src/cli.js                      │
                  │   resolve minLevel (flag>env)   │
                  │   createLogger({ sessionId,     │
                  │                  minLevel })    │
                  └──────────────┬──────────────────┘
                                 │ inject via DI
                                 ▼
                  ┌─────────────────────────────────┐
   consumers  ──► │ rootLogger.child({ component }) │
   (session/*,    │   log.info(msg, ctx)            │
    plane/*,      └──────────────┬──────────────────┘
    cmux/*,                      │ event { level, msg, ctx, bindings }
    hooks/*,                     ▼
    orch/*)       ┌─────────────────────────────────┐
                  │ REDACTOR (deep-walk, depth≤4)   │
                  │   replace sensitive keys        │
                  │   replace JWT-like values       │
                  └──────┬──────────────────┬───────┘
                         │                  │
                  NDJSON sink          Pretty sink
                  (if level≥minLevel)  (if mirror rules match)
                         │                  │
                         ▼                  ▼
               ~/.kodo/logs/          fs.writeSync(2, …)
               <sid>.ndjson                (stderr)
               (appendFileSync)


  ✂  src/check.js  ──────────✗✗✗──────────►  src/logger.js
     (verified by test/check-isolation.test.js)
```

### Recommended Project Structure

```
src/
├── logger.js              # Factory, redactor, NDJSON writer, pretty-print (single file)
└── check.js               # UNCHANGED — MUST NOT import logger.js

test/
├── logger.test.js         # Factory API, child bindings, level filtering, NDJSON shape
├── logger.redaction.test.js # Grep-based assertion: secret never persisted
└── check-isolation.test.js # Import-graph walk + 50ms budget
```

**Rationale single-file:** módulo autocontenido con 4 responsabilidades relacionadas; separar agrega ceremonia sin claridad. Si crece >300 LoC, splittear a `src/logger/` con `index.js`, `redact.js`, `format.js`.

### Pattern 1: Factory with closure-captured state

```javascript
// src/logger.js
// @ts-check
import { appendFileSync, mkdirSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { KODO_DIR } from './config.js';

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });
const LEVEL_NAMES = /** @type {const} */ (['debug', 'info', 'warn', 'error']);

/**
 * @param {{ sessionId: string, minLevel?: 'debug'|'info'|'warn'|'error' }} opts
 */
export function createLogger({ sessionId, minLevel = 'info' }) {
  const logDir = join(KODO_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  const filePath = join(logDir, `${sessionId}.ndjson`);
  const minLevelNum = LEVELS[minLevel];
  let writeFailedWarned = false;
  const bindings = { session_id: sessionId };

  return makeNode(bindings);

  function makeNode(currentBindings) {
    const node = {
      child(extra) { return makeNode({ ...currentBindings, ...extra }); },
    };
    for (const name of LEVEL_NAMES) {
      node[name] = (msg, ctx) => emit(name, msg, ctx, currentBindings);
    }
    return node;
  }

  function emit(level, msg, ctx, boundFields) {
    if (LEVELS[level] < minLevelNum) return;
    const record = redact({
      timestamp: new Date().toISOString(),
      level,
      msg,
      ...boundFields,
      ...(ctx ?? {}),
    });
    writeNdjson(record);
    maybeMirrorToStderr(level, record);
  }

  function writeNdjson(record) {
    try {
      appendFileSync(filePath, JSON.stringify(record) + '\n');
    } catch (err) {
      if (!writeFailedWarned) {
        writeSync(2, `[kodo:logger] write failed: ${err.message}\n`);
        writeFailedWarned = true;
      }
    }
  }
  // maybeMirrorToStderr, redact: ver patrones siguientes
}
```
*Source: pattern derived from pino/bunyan ergonomics + codebase factory conventions.*

### Pattern 2: Redactor — deep walk con límites

```javascript
const SENSITIVE_KEYS = new Set([
  'plane_api_key', 'authorization', 'x-api-key', 'x-plane-signature',
  'password', 'token', 'secret', 'cookie', 'set-cookie',
].map(k => k.toLowerCase()));

// JWT: eyJ + base64url ≥ 2 dots. Conservador; no redacta UUIDs ni shas.
const JWT_RE = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;
// Plane bearer / plane_api_key literal prefix
const BEARERY_RE = /^(Bearer\s+|plane_)[A-Za-z0-9_\-]{20,}$/i;

const MAX_DEPTH = 4;
const MAX_ARRAY_LEN = 100;

function redact(value, depth = 0, keyHint = '') {
  if (depth > MAX_DEPTH) return '[REDACTED:depth-exceeded]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_KEYS.has(keyHint.toLowerCase())) return '[REDACTED]';
    if (JWT_RE.test(value) || BEARERY_RE.test(value)) return '[REDACTED]';
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const sliced = value.length > MAX_ARRAY_LEN
      ? [...value.slice(0, MAX_ARRAY_LEN), `[REDACTED:truncated-${value.length - MAX_ARRAY_LEN}]`]
      : value;
    return sliced.map(v => redact(v, depth + 1, keyHint));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEYS.has(k.toLowerCase())
      ? '[REDACTED]'
      : redact(v, depth + 1, k);
  }
  return out;
}
```

**When to use:** Sobre **cada record** antes de `JSON.stringify`. El redactor es idempotente (una segunda pasada no daña) — cheap insurance si el pretty-print derivara del record ya redactado.

### Pattern 3: Pretty-print + TTY decisions

```javascript
const COLOR = {
  debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m', reset: '\x1b[0m',
};
const useColor = process.stderr.isTTY && !process.env.NO_COLOR;

function maybeMirrorToStderr(level, record) {
  const isTTY = process.stderr.isTTY;
  const minLevelNum = LEVELS[record.level];
  const mirror =
    level === 'error' || level === 'warn' ||
    (level === 'info' && isTTY && LEVELS.info >= minLevelNum) ||
    (level === 'debug' && isTTY && LEVELS.debug >= minLevelNum);
  if (!mirror) return;

  const time = record.timestamp.slice(11, 19);   // HH:MM:SS
  const c = useColor ? COLOR[level] : '';
  const r = useColor ? COLOR.reset : '';
  const comp = record.component ? ` ${record.component}` : '';
  const ctxStr = formatCtxInline(record);
  writeSync(2, `${time} ${c}${level.toUpperCase()}${r}${comp} ${record.msg}${ctxStr}\n`);
}
```

### Pattern 4: No-op fallback para el path del vigilante

```javascript
export const noopLogger = Object.freeze({
  debug() {}, info() {}, warn() {}, error() {},
  child() { return noopLogger; },
});
```

Cualquier módulo que quiera seguir funcionando en el path de `kodo check` acepta `logger = noopLogger` como default en la signature. Esto es **convención**; el guardián real es el test de aislamiento (que impide a `check.js` siquiera importar `logger.js` — por lo que el `noopLogger` se expone desde un archivo aparte o se duplica en consumidores compartidos).

**Decisión abierta para planning:** Si `noopLogger` vive en `src/logger.js`, entonces `check.js` puede importarlo sin violar LOG-12 solo si el test de grafo permite esa única dependencia. Alternativa más limpia: mover `noopLogger` a `src/logger-noop.js` (zero imports, 6 LoC), y que `logger.js` re-exporte desde ahí. Así el test de aislamiento puede prohibir `logger.js` completamente sin penalizar a módulos compartidos que necesiten el no-op.

### Anti-Patterns to Avoid

- **Log singleton global (`export const logger = createLogger(…)`):** rompe inyección por sesión, imposibilita bindings correctos, y forzaría import desde `check.js` o consumers transitivos. Explícitamente desalentado en CONTEXT.md.
- **`console.log/error` dentro del logger:** monkey-patcheable; usar `fs.writeSync(2, …)`.
- **Redactar solo top-level:** headers anidados en `{ request: { headers: { authorization: … } } }` escaparían. Deep walk obligatorio.
- **Hashear o truncar secretos en vez de `[REDACTED]` literal:** facilita correlación en ataques de side-channel y complica tests de grep.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO-8601 timestamp | `new Date().toString()` / printf-style | `new Date().toISOString()` | Built-in, consistente, UTC-Z, ya usado en `state.test.js` |
| Stream backpressure | `createWriteStream` + manual `.write()`/`.end()` management | `appendFileSync` | Cadencia esperada baja; Sync + O_APPEND resuelve atomicidad [VERIFIED: nodejs group discussion] |
| JSON encoding con escaping | template literals | `JSON.stringify` | Maneja Unicode, escaping, circular refs (lanza — atrapar) |
| TTY detection | comparar `process.env.TERM` | `process.stderr.isTTY` | Built-in, respeta redirección de pipes |
| Directory existence | `try { statSync } catch { mkdir }` | `mkdirSync(dir, { recursive: true })` | Idempotente; no lanza si existe |

**Key insight:** Zero-deps aquí es trivial — no hay ningún problema real que Node stdlib no resuelva. pino/bunyan existen por performance (JSON stringify alternativo, async write) que no aplica a este volumen.

## Runtime State Inventory

No aplica — phase es greenfield creacional (un archivo nuevo + tests). No hay datos almacenados, servicios externos registrados, tareas OS, ni artefactos de build a migrar.

- **Stored data:** None — el phase no toca almacenamiento previo; `~/.kodo/logs/` es un directorio nuevo. Verificado por inspección del repo (`src/` no contiene `logs/` previo).
- **Live service config:** None.
- **OS-registered state:** None.
- **Secrets/env vars:** `KODO_LOG_LEVEL` es un env var **nuevo**; `PLANE_API_KEY` ya existe en `.env` del usuario y el logger solo lo **lee indirectamente** (via contexto que redacta).
- **Build artifacts:** None.

## Common Pitfalls

### Pitfall 1: Serializar `Error` objects pierde stack
**What goes wrong:** `JSON.stringify(new Error('x'))` → `"{}"`. El stack desaparece del log.
**Why it happens:** `Error` tiene `message` y `stack` como no-enumerables.
**How to avoid:** En el redactor, detectar `value instanceof Error` y serializar a `{ message, stack, name }` antes del walk.
**Warning signs:** Logs de `error` con ctx vacío `{}` aunque el callsite pasó `{ err }`.

### Pitfall 2: Referencias circulares en ctx
**What goes wrong:** `JSON.stringify` lanza `TypeError: Converting circular structure to JSON`.
**Why it happens:** El consumidor pasa un objeto de dominio con back-pointers (ej. SessionRecord con `parent`).
**How to avoid:** Envolver `JSON.stringify` en try/catch; fallback a `util.inspect(record, { depth: 4, breakLength: Infinity })` dentro de `{ "_raw": "..." }` o usar un replacer con WeakSet para detectar ciclos.
**Warning signs:** `write failed` warning en stderr; sesiones sin logs completos.

### Pitfall 3: `stderr.isTTY` es `undefined`, no `false`, en no-TTY
**What goes wrong:** Un `=== false` falla porque `undefined !== false`.
**Why it happens:** Node documenta `isTTY` como `true | undefined` para streams estándar.
**How to avoid:** Usar coerción truthy (`if (process.stderr.isTTY)`), nunca comparar estricto con `false`.

### Pitfall 4: NDJSON roto por `\n` dentro de `msg`
**What goes wrong:** `log.info('line1\nline2', {})` produce 2 líneas, la segunda inválida JSON.
**Why it happens:** `JSON.stringify` escapa `\n` a `\\n` correctamente, **pero** si alguien accidentalmente hace `appendFileSync(path, msg + '\n')` sin stringify, rompe.
**How to avoid:** El escritor **siempre** hace `JSON.stringify(record) + '\n'`. Test de redacción hace parse línea por línea y espera éxito en todas.

### Pitfall 5: Permisos `~/.kodo/logs/` en macOS con sync externos
**What goes wrong:** iCloud sync o antivirus bloquea appendFileSync intermitentemente (EBUSY, EPERM en `~`).
**Why it happens:** `homedir()` en macOS puede ser iCloud-backed.
**How to avoid:** El fallback ya cubre esto (warn a stderr, no throw). Documentar en README que logs pueden perderse si `$HOME` está sincronizado.

### Pitfall 6: `appendFileSync` atomicity solo <PIPE_BUF
**What goes wrong:** Escrituras >4 KB pueden interleave con otros procesos escribiendo al mismo archivo.
**Why it happens:** POSIX garantiza atomicidad de `write()` con `O_APPEND` solo hasta `PIPE_BUF` (4096 bytes en Linux/macOS).
**How to avoid:** Mantener líneas <4 KB. Si un ctx es muy grande, truncar a N caracteres y marcar `[REDACTED:truncated-size]`. Cada sesión escribe a su propio archivo (`<session-id>.ndjson`), así que en la práctica solo hay un escritor — esto hace PIPE_BUF casi irrelevante, pero la regla defensiva es útil.
**Warning signs:** Líneas NDJSON corruptas en cargas altas.

### Pitfall 7: `--log-level` pasa como string pero `minLevel` espera number internamente
**What goes wrong:** Mezcla de unidades en signature pública vs interna causa runtime `LEVELS[30] === undefined`.
**How to avoid:** Validar `minLevel` al entrar al factory (`if (!(minLevel in LEVELS)) throw`); documentar tipo en JSDoc.

## Code Examples

### Example: Sample NDJSON line (target shape)

```json
{"timestamp":"2026-04-16T10:32:17.123Z","level":"info","session_id":"sess-abc","component":"plane.client","plane_task_id":"KL-42","msg":"API call","method":"GET","path":"/api/v1/workspaces/k-lab/projects/","status":200,"duration_ms":145}
```

### Example: Factory usage in consumer

```javascript
// src/session/manager.js (future, Phase 8+)
import { createLogger } from '../logger.js';
export async function spawnSession({ sessionId, taskId }) {
  const root = createLogger({ sessionId, minLevel: process.env.KODO_LOG_LEVEL ?? 'info' });
  const log = root.child({ component: 'session.manager', plane_task_id: taskId });
  log.info('spawning', { cmux_workspace: taskId });
  try {
    // ...
  } catch (err) {
    log.error('spawn failed', { err: { message: err.message, stack: err.stack } });
  }
}
```

### Example: Redaction unit test (grep-based, highest confidence)

```javascript
// test/logger.redaction.test.js
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Override KODO_DIR via env BEFORE importing config.js/logger.js
const TEST_HOME = join(tmpdir(), `kodo-redact-${Date.now()}`);
process.env.HOME = TEST_HOME;
const { createLogger } = await import('../src/logger.js');

describe('logger redaction (grep assertion)', () => {
  const sessionId = 'sess-redact-1';
  const logPath = join(TEST_HOME, '.kodo', 'logs', `${sessionId}.ndjson`);
  after(() => rmSync(TEST_HOME, { recursive: true, force: true }));

  it('never persists PLANE_API_KEY, headers, JWT-like values', () => {
    const log = createLogger({ sessionId, minLevel: 'debug' });
    const SECRETS = {
      apiKey: 'plane_abcdef0123456789deadbeefcafe1234',
      jwt:    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123sig',
      sig:    'sha256=0123456789abcdef0123456789abcdef',
    };
    log.info('creds top-level', { plane_api_key: SECRETS.apiKey });
    log.info('nested headers', { request: { headers: { authorization: `Bearer ${SECRETS.apiKey}` } } });
    log.info('webhook', { headers: { 'x-plane-signature': SECRETS.sig } });
    log.info('raw JWT', { payload: SECRETS.jwt });

    const raw = readFileSync(logPath, 'utf-8');
    for (const s of Object.values(SECRETS)) {
      assert.equal(raw.includes(s), false, `secret leaked: ${s.slice(0, 12)}…`);
    }
    assert.equal(raw.includes('[REDACTED]'), true);
  });
});
```

### Example: Import-graph isolation test (Option B — regex source walk)

```javascript
// test/check-isolation.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '..', 'src');
const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/gm;

function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const match of src.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue; // skip node: and deps
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}

describe('LOG-12: vigilante isolation', () => {
  it('kodo check does not import logger.js transitively', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const hit = [...graph].find(p => p.endsWith('logger.js'));
    assert.equal(hit, undefined, `check.js transitively imports ${hit}`);
  });

  it('kodo check completes in under 50ms', async () => {
    const { spawnSync } = await import('node:child_process');
    const runs = 5;
    const durations = [];
    for (let i = 0; i < runs; i++) {
      const t0 = process.hrtime.bigint();
      spawnSync(process.execPath, [join(SRC, '..', 'bin', 'kodo'), 'check'], { stdio: 'ignore' });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      durations.push(ms);
    }
    const median = durations.sort((a, b) => a - b)[Math.floor(runs / 2)];
    // NOTE: 50ms is aspirational. Medir en baseline y ajustar; si baseline ya >50ms,
    // el test asserta NO-REGRESSION (baseline * 1.1) en vez de absoluto.
    assert.ok(median < 50, `median startup ${median.toFixed(1)}ms exceeds 50ms budget`);
  });
});
```

**Nota:** la versión regex **no maneja re-exports dinámicos ni `import()` dynamic**, pero el proyecto no usa ninguno (verificado por grep). Si Phase 7+ introduce dynamic imports, migrar a Opción A (walker vía `node --experimental-loader`).

### Example: Pretty-print anti-duplication test

```javascript
it('stderr never emits a JSON object', (t) => {
  const captured = [];
  t.mock.method(process.stderr, 'write', (chunk) => { captured.push(chunk.toString()); return true; });
  const log = createLogger({ sessionId: 'x', minLevel: 'debug' });
  log.warn('oops', { deep: { authorization: 'Bearer secret123' } });
  for (const line of captured.join('').split('\n').filter(Boolean)) {
    assert.notEqual(line.trimStart()[0], '{', `stderr emitted JSON: ${line}`);
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `winston` + multi-transport | `pino` (bare NDJSON to stdout, pretty sidecar) | ~2019 (pino ecosystem) | Logger se simplifica: serializa rápido, ships a disco o stdout, downstream tools hacen rest |
| Custom verbose log format | NDJSON universal | ~2018 (Vector/Loki/Grafana) | Cualquier agregador asume JSON-per-line |
| Synchronous Bunyan | Async pino w/ flush-on-exit | ~2020 | No aplica a kodo (sync es simpler y suficiente) |
| Secrets via allow-list | Deep-walk + deny-list + entropy | ~2021 (GitHub secret scanning) | Deny-list + pattern es el estándar actual |

**Deprecated/outdated:**
- `console.log` con timestamps manuales — reemplazado por NDJSON por tooling.
- Rotación integrada al logger (`winston-daily-rotate-file`) — ahora delegada a `logrotate`/externals o deferred como en kodo v0.3.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Baseline actual de `kodo check` ya está <50 ms (budget factible sin refactor) | Pattern "check isolation test", código ejemplo | [ASSUMED] Si baseline ya es >50 ms, el test asserta no-regresión vs baseline medido, no un absoluto. Planner debe medir primero. |
| A2 | `pino`/`bunyan` API de child/levels es familiar suficiente a los consumidores futuros (Phases 7–10) | "API ergonomics" | [ASSUMED] Si los consumidores prefieren API tipo `log({level, msg})`, el diseño actual requeriría wrapper. Low-risk — los consumidores son internos y los escribimos nosotros. |
| A3 | Regex walker captura todos los imports del proyecto actual (no hay `import()` dinámicos) | "Isolation test Option B" | [VERIFIED: Grep `import\(` en `src/` retorna 0 resultados al 2026-04-15] Bajo riesgo. |
| A4 | PIPE_BUF atomicity en macOS/Linux cubre el tamaño medio de líneas NDJSON (<4 KB) | "Don't hand-roll" + Pitfall 6 | [VERIFIED: nodejs groups, POSIX docs]. Si un evento individual genera >4 KB, truncar. |
| A5 | JWT regex no causa falsos positivos en el código actual (no hay valores tipo `eyJ…` legítimos en logs) | "Redaction strategy" | [ASSUMED] Plane podría devolver campos opacos con ese prefijo; si ocurre, agregar al allow-list del redactor. |
| A6 | `KODO_DIR` (`~/.kodo`) es siempre escribible en target environment (dev + CI) | "NDJSON writer" | [ASSUMED] CI puede usar `$HOME` temporal; verificar en Phase 7 setup. |
| A7 | Un único archivo por sesión elimina necesidad de file-locking inter-process | Pitfall 6 | [ASSUMED] Válido mientras se respete invariante "una sesión ≠ múltiples escritores". Phase 8 lock por repo lo refuerza. |

## Open Questions

1. **¿`noopLogger` se exporta desde `src/logger.js` o desde `src/logger-noop.js` separado?**
   - What we know: CONTEXT.md exige que `check.js` no importe `logger.js` ni transitivamente.
   - What's unclear: Si un módulo compartido (`src/providers/registry.js`) acepta logger opcional, ¿cómo obtiene el `noopLogger` sin arrastrar `logger.js` al grafo de `check.js`?
   - Recommendation: Crear `src/logger-noop.js` (6 LoC, zero imports). `logger.js` lo re-exporta para conveniencia. El test de aislamiento permite `logger-noop.js` en el grafo de check, bloquea `logger.js`.

2. **¿Precedencia exacta cuando flag y env están ambos presentes?**
   - What we know: CLI flag > env > default (documentado).
   - What's unclear: ¿Conflict inválido (ambos seteados con valores distintos) silencia-gana-flag o imprime warning?
   - Recommendation: Silently `flag wins`; stderr pretty warning si difieren (una sola vez).

3. **¿Budget de 50 ms absoluto o relativo?**
   - What we know: CONTEXT.md dice `<50 ms`.
   - What's unclear: En macOS M1 el baseline actual puede ser ya 20–30 ms; en CI Linux de runners compartidos puede ser 40–80 ms con varianza alta. Un threshold absoluto va a flakear.
   - Recommendation: Durante planning Wave 0, medir baseline (median de 10 runs); establecer threshold = `max(50, baseline * 1.15)` y dejarlo como constante al top del test.

4. **¿`session_id` format es stable entre Phase 6 y Phase 7?**
   - What we know: Phase 7 añade `kodo logs --session-of <plane-task-id>` que probablemente usa metadata interna.
   - What's unclear: Si session_id cambia formato entre fases, nombres de archivo se rompen.
   - Recommendation: Phase 6 asume que `sessionId` viene ya resuelto del caller; no parsea ni valida formato. Phase 7 indexa por plane_task_id escrito **en el NDJSON**, no en el nombre de archivo.

## Environment Availability

Phase 6 requiere solo Node 20+. Ya verificado.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node ≥20 | Toda la phase (built-ins) | ✓ | (verificado en `package.json engines`) | — |
| `node:fs`, `node:path`, `node:os`, `node:test`, `node:assert/strict`, `node:util`, `node:child_process` | Factory + redactor + tests | ✓ | builtin | — |
| commander ^13 | CLI integración del `--log-level` | ✓ | en `package.json` | — |
| Escribir a `~/.kodo/logs/` | NDJSON sink | ✓ | (mismo path que `~/.kodo/config.json`, escribible) | Pretty-print warn + continue |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (Node 20 built-in) |
| Config file | none — usa `package.json` script `"test": "node --test test/**/*.test.js"` |
| Quick run command | `node --test test/logger.test.js test/logger.redaction.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| LOG-01 | `createLogger({ minLevel })` filtra niveles; acepta string; default `info` | unit | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-01 | CLI `--log-level` pasado a `createLogger` via `src/cli.js` | unit (mock `parseArgs`) | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-02 | NDJSON line contiene `timestamp`, `level`, `component`, `msg`, `session_id`, ctx | unit (parse línea, assert shape) | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-03 | File escrito en `~/.kodo/logs/<session-id>.ndjson`; `mkdirSync` idempotente; child bindings mergean `plane_task_id`, `phase_id` | unit (tmpdir como `$HOME`) | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-04 | `warn`+`error` a stderr pretty; ninguna línea stderr empieza con `{`; `info`+`debug` solo si TTY+minLevel | unit (mock `process.stderr.write`) | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-04 | NDJSON en disco contiene el mismo evento sin duplicación | unit (file read after warn) | `node --test test/logger.test.js` | ❌ Wave 0 |
| LOG-08 | PLANE_API_KEY, Authorization nested, x-plane-signature, JWT-like sin key conocida — no aparecen en disco ni stderr | unit (grep file + captured stderr) | `node --test test/logger.redaction.test.js` | ❌ Wave 0 |
| LOG-08 | `[REDACTED]` literal (no hash, no longitud); deep-walk con depth=4 e array=100 | unit | `node --test test/logger.redaction.test.js` | ❌ Wave 0 |
| LOG-12 | `src/check.js` no importa `src/logger.js` directa ni transitivamente | static (import-graph walk) | `node --test test/check-isolation.test.js` | ❌ Wave 0 |
| LOG-12 | `node bin/kodo check` median <50 ms (o no-regresión vs baseline) | smoke (spawnSync N runs) | `node --test test/check-isolation.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/logger.test.js test/logger.redaction.test.js test/check-isolation.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + baseline de startup budget medido y anotado en VERIFICATION.md antes de `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `test/logger.test.js` — cubre LOG-01..LOG-04
- [ ] `test/logger.redaction.test.js` — cubre LOG-08
- [ ] `test/check-isolation.test.js` — cubre LOG-12 (import-graph + startup budget)
- [ ] Baseline measurement de `kodo check` startup (registrar en VERIFICATION.md) — requisito para el threshold del test
- [ ] Fixture helper opcional: `test/fixtures/logger-helpers.js` para setup/teardown de `HOME` temporal si los 3 tests lo comparten

*(Framework ya instalado: Node 20 built-in. No requiere install step.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Logger no autentica; solo consume credenciales del entorno sin persistirlas |
| V3 Session Management | no | `sessionId` es identificador de sesión kodo, no de autenticación |
| V4 Access Control | yes (débil) | Archivos bajo `~/.kodo/logs/` heredan umask del user; recomendar `chmod 0600` por archivo en plan |
| V5 Input Validation | yes | `minLevel` validado; `msg` coaccionado a string; ctx pasa por `JSON.stringify` con try/catch |
| V6 Cryptography | no | No hay crypto propio — NUNCA hand-rollear hashing de secretos (ya decidido: `[REDACTED]` literal) |
| V7 Logging & Monitoring | **yes (core)** | Toda esta phase. Redacción de secretos antes de persistencia es el control primario |
| V8 Data Protection | yes | Logs pueden contener PII (task titles, paths). Out-of-scope rotación, pero docs deben advertir |
| V9 Communications | no | No hay red |
| V14 Configuration | yes | Default `minLevel=info` evita leak de debug data por error |

### Known Threat Patterns for este stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage to disk (PLANE_API_KEY, webhook signatures) | Information Disclosure | Redactor deep-walk con key-set + regex; test de grep sobre el archivo persistido |
| Log injection via `msg` (attacker-controlled task title contiene `\n` + JSON fake) | Tampering | `JSON.stringify` escapa `\n`; lectores asumen una línea = un JSON válido (no regex parsing de logs) |
| Log file tampering | Tampering | Out-of-scope para v0.3; documented en deferred (LOG-F1 rotación + integridad) |
| DoS via enormous ctx object | DoS | Deep walk con límites (depth=4, array=100) + try/catch en `JSON.stringify` |
| Symlink attack en `~/.kodo/logs/` | Tampering | `mkdirSync({recursive: true})` sigue symlinks; mitigar vía `chmod 0700` del dir y documentar que `~/.kodo` debe ser dir regular |
| Prototype pollution via ctx con `__proto__` | Tampering | El redactor itera `Object.entries` y reconstruye objetos nuevos — natural defense. Test explícito recomendado. |

## Sources

### Primary (HIGH confidence)
- Node.js v20 `fs` docs (appendFileSync, writeSync, mkdirSync) — [VERIFIED via WebSearch, reforzado por uso existente en `src/config.js`]
- `src/config.js` — patrón `KODO_DIR`, `ensureDir`, JSDoc `@param`/`@returns`
- `test/state.test.js` — patrón de test con `tmpdir()` fixture, `node:test` + `node:assert/strict`
- `src/check.js` — vigilante actual (87 LoC, imports: `config`, `state`, `health`, `registry`, `orchestrator/launch`)
- `package.json` — zero deps excepto commander, Node ≥20, `node --test` script
- `.planning/phases/06-structured-logger-foundation/06-CONTEXT.md` — architecture locked, user-confirmed

### Secondary (MEDIUM confidence)
- Google Groups discussion sobre atomicidad de `fs.write` bajo `O_APPEND` y PIPE_BUF [VERIFIED vía WebSearch 2026-04-15]
- Convenciones pino/bunyan para child loggers — replicar ergonomía, no dependency

### Tertiary (LOW confidence)
- Threshold exacto de 50 ms para `kodo check` — aspiracional en CONTEXT.md; validar baseline antes de hardcodear

### Sources from this research session
- [Node.js File System Documentation](https://nodejs.org/api/fs.html)
- [Is fs.write() atomic (up to PIPE_BUF)?](https://groups.google.com/g/nodejs/c/sPPM8Y7v6BY)
- [Node.js fs.appendFileSync Function](https://www.geeksforgeeks.org/node-js-fs-appendfilesync-function/)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todo built-in, zero deps, ya en uso
- Architecture: HIGH — arquitectura lockeada en CONTEXT.md; patrones son mecánicos
- Redaction strategy: MEDIUM — set cerrado verificable, pero JWT regex y truncation están basados en juicio, no evidencia empírica de payloads reales de Plane
- Isolation test: MEDIUM — regex walker cubre el repo hoy (verificado no hay dynamic imports), pero es frágil si el proyecto evoluciona
- Startup budget: LOW — 50 ms es aspiracional; requiere medición de baseline en Wave 0

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (30 días — stack estable, Node LTS)

Sources:
- [Node.js File System Documentation](https://nodejs.org/api/fs.html)
- [Is fs.write() atomic (up to PIPE_BUF)?](https://groups.google.com/g/nodejs/c/sPPM8Y7v6BY)
