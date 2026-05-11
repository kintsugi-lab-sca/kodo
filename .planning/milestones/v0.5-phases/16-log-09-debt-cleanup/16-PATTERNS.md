# Phase 16: LOG-09 Debt Cleanup — Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 6 (3 modified source + 3 modified/new tests)
**Analogs found:** 6 / 6

> **Phase 16 NO crea código nuevo de runtime.** Cablea constantes y un helper ya existentes (`EVENTS.GSD_PHASE_RESOLVED`, `EVENTS.GSD_BOOTSTRAP`, `markSessionStatus`) en TRES callsites independientes. Solo crea UN test nuevo (`test/dispatcher-isolation.test.js`); el resto son extensiones a tests existentes.
>
> **Hereda de fases anteriores** (NO se re-derivan):
> - **Phase 9 D-14**: dispatcher es single-source de `gsd.phase.resolved` (D-01 preserva invariante).
> - **Phase 10 D-11/D-12**: cadena `addComment OK → updateTaskState OK` ya enforced en `verify.js`; D-11 LOG-14 inserta `markSessionStatus` después.
> - **Phase 11 D-07/D-08**: `gsd.bootstrap` lleva `mode`; stop.js `if (session.gsd)` cubre full+quick.
> - **Phase 13 D-09/D-10**: anti-inline / anti-direct-access para `gsd_mode` — los tests existentes deben seguir verdes.
> - **Patrón factory + DI-by-descriptor** ya aplicado en Phase 14/15 — Phase 16 NO lo extiende (los 3 callsites no son CLI surfaces).
>
> **Nuevo en Phase 16** (foco de este documento):
> - Patrón **"sustituir literal por constante"** (D-01 dispatcher.js): primer caso del repo donde un evento canónico se cablea desde dispatcher SIN pasar por su helper típico (incompatibilidad de shape — payloads heterogéneos).
> - Patrón **"silent — never block X on logger failure"** ya presente en dispatcher.js (lines 191-193, 218-219, 257-258) y stop.js line 132 — D-09 lo extiende a `markSessionStatus` en stop.js.
> - Patrón **"emit BEFORE mutation"** ya aplicado en stop.js line 116 (`session.end` antes de `removeSession`) — D-08 lo extiende a `state.transition` antes de `releaseGsdLock`.
> - Patrón **"comment-aware grep"** para test source-hygiene (D-12): primer test del repo que filtra líneas-de-comentario antes de buscar literales, porque `dispatcher.js` mantiene los strings en comentarios documentando el contrato histórico (líneas 171, 173, 203, 228 reales).

---

## File Classification

| File | New/Mod | Role | Data Flow | Closest Analog | Match Quality | Decision Refs |
|------|---------|------|-----------|----------------|---------------|---------------|
| `src/triggers/dispatcher.js` | MOD | controller (trigger handler) | event-driven (TriggerEvent → dispatch) | el propio dispatcher.js (5 callsites de literales) + helpers `gsdPhaseResolved`/`gsdBootstrap` ya importados como referencia | exact (sustitución 1-a-1 de literales) | D-01, D-02, D-03 |
| `src/gsd/verify.js` | MOD | service (verification gate) | request-response (sessionId → verdict + side-effects Plane) | el propio `finalize()` en `verify.js` (cadena pass→addComment→updateTaskState ya existente line 230-245) | exact (insertar 1 line entre updateTaskState y orchestratorReview) | D-10, D-11 |
| `src/hooks/stop.js` | MOD | hook (mechanical cleanup) | event-driven (Claude Stop event → cleanup) | el propio stop.js: patrón `session.end emit BEFORE removeSession` line 116-134 | exact (extender el patrón "emit BEFORE mutation" un nivel: state.transition antes de releaseGsdLock) | D-04, D-06, D-07, D-08, D-09 |
| `test/dispatcher-isolation.test.js` | NEW | test (source-hygiene guard) | static text scan (read-only) | `test/check-isolation.test.js` (naming + estructura) + `test/stop.test.js:60-72` (comment-aware filter regex) | exact (combinación: file-naming de check-isolation, regex-filter de stop.test) | D-12, D-13 |
| `test/gsd-verify-integration.test.js` | MOD (extend) | test (integration, fs real) | NDJSON event capture | el propio archivo (T20-T23 ya existen con event-spy via fake logger) | exact (añadir 4-6 escenarios sobre el spy ya cableado) | D-11 (SC#3) |
| `test/stop.test.js` | MOD (extend) | test (behavior + source-hygiene) | NDJSON event capture | el propio archivo (source-hygiene + buildStopNudgeText switch tests) + `gsd-verify-integration.test.js` (memSink pattern) | partial-match (necesita exportar/refactorizar `main()` o testear vía spy sobre dynamic import — opción más realista: nuevo test file `test/stop-state-transition.test.js`) | D-04, D-07 (SC#5) |

---

## Pattern Assignments

### 1. `src/triggers/dispatcher.js` — EVENTS.* migration (D-01, D-02, D-03)

**Analog principal:** el propio archivo. Las 5 ocurrencias del literal viven en líneas verificadas (no las que cita CONTEXT a veces de memoria — se confirmó por grep).

#### Verificación de líneas reales (grep contra src/triggers/dispatcher.js)

```
183:            log.info('gsd.phase.resolved', {       ← LITERAL #1 (no-match tolerated, info)
184:              event: 'gsd.phase.resolved',         ← LITERAL #2 (event: key del payload #1)
210:          log.warn('gsd.phase.resolved', {         ← LITERAL #3 (fail-closed, warn)
211:            event: 'gsd.phase.resolved',           ← LITERAL #4 (event: key del payload #3)
```

**Solo 4 literales `'gsd.phase.resolved'`** en código, NO 5. CONTEXT línea 12 dice "4 literales `'gsd.phase.resolved'` + 1 `'gsd.bootstrap'`". Verificación de `'gsd.bootstrap'` en código:

```
$ grep -n "'gsd.bootstrap'\|\"gsd.bootstrap\"" src/triggers/dispatcher.js
(sin output)
```

**Resultado**: NO existe ningún literal `'gsd.bootstrap'` en runtime de dispatcher.js. La rama matched-true (lines 246-256) ya usa el helper `gsdBootstrap()` importado dinámicamente desde `logger-events.js` — no requiere migración.

**Comentarios que mencionan los strings** (NO migran, respetados por grep comment-aware D-12):
- Line 171: `// gsd.phase.resolved {matched:false, code:'no-match', tolerated:true,`
- Line 173: `// Dispatcher remains the single source of gsd.phase.resolved (D-14`
- Line 203: `// D-14: emit gsd.phase.resolved with matched:false for forensic logging.`
- Line 228: `// D-14: emit matched-true gsd.phase.resolved (phase branch) or gsd.bootstrap (bootstrap branch).`

**Total a migrar:** 4 literales `'gsd.phase.resolved'` (líneas 183, 184, 210, 211). El campo `'gsd.bootstrap'` ya está cableado vía helper — Phase 16 no lo toca.

> ⚠️ **CORRECCIÓN A CONTEXT**: CONTEXT línea 12 sugiere "4 + 1 bootstrap" literales. Verificación contra código a 2026-05-06 confirma SOLO 4 literales `gsd.phase.resolved` y CERO literales `gsd.bootstrap`. Esto NO altera el plan — solo ajusta el conteo (4 sustituciones, no 5). El test source-hygiene (D-12/D-13) sigue afirmando ambos strings ausentes en código no-comment como guardia anti-regresión.

#### Imports pattern (nuevo import a añadir)

**Source — actual (lines 1-11):**

```javascript
// @ts-check
import { randomUUID } from 'node:crypto';
import { getProvider } from '../providers/registry.js';
import { loadConfig, loadProjects } from '../config.js';
import { parseKodoLabels, getGsdMode } from '../labels.js';
import { listSessions, removeSession } from '../session/state.js';
import { launchWorkItem, resolveProjectPath } from '../session/manager.js';
import { acquireGsdLock, releaseGsdLock } from '../gsd/lock.js';
import * as cmux from '../cmux/client.js';
import { resolvePhase } from '../gsd/resolver.js';
import { buildBriefFromTask, isBriefEmpty } from '../gsd/brief.js';
```

**Apply (D-02)** — añadir un import eager al top del bloque (sin coste runtime: `logger-events.js` solo importa `node:os` y `node:path`, sin side effects):

```javascript
import { EVENTS } from '../logger-events.js';
```

**LOG-12 invariante preservada:** `logger-events.js` no es importado por `check.js` ni nadie en su grafo. Verificable por el walker existente (`test/check-isolation.test.js`); no se requiere extensión.

#### Sustitución de literales — variante INFO (no-match tolerated)

**Source — actual (lines 177-194):**

```javascript
try {
  const { createLogger } = await import('../logger.js');
  const log = createLogger({
    sessionId: gsdSessionId || 'dispatch',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dispatcher', task_id: task.id });
  log.info('gsd.phase.resolved', {
    event: 'gsd.phase.resolved',
    matched: false,
    code: 'no-match',
    tolerated: true,
    mode: 'quick',
    task_ref: task.ref,
  });
} catch {
  // silent — never block dispatch on logger failure (mirror existing
  // forensic warn pattern below)
}
```

**Apply (D-01 + D-02)** — primer arg del `log.info()` y `event:` key migran a la constante. Shape inline preservado byte-a-byte (D-01 explícito):

```javascript
try {
  const { createLogger } = await import('../logger.js');
  const log = createLogger({
    sessionId: gsdSessionId || 'dispatch',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dispatcher', task_id: task.id });
  log.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    matched: false,
    code: 'no-match',
    tolerated: true,
    mode: 'quick',
    task_ref: task.ref,
  });
} catch {
  // silent — never block dispatch on logger failure (mirror existing
  // forensic warn pattern below)
}
```

#### Sustitución de literales — variante WARN (fail-closed)

**Source — actual (lines 204-220):**

```javascript
try {
  const { createLogger } = await import('../logger.js');
  const log = createLogger({
    sessionId: gsdSessionId || 'dispatch',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dispatcher', task_id: task.id });
  log.warn('gsd.phase.resolved', {
    event: 'gsd.phase.resolved',
    matched: false,
    error_code: resolverVerdict.code,
    detail: resolverVerdict.detail,
    task_ref: task.ref,
    mode: gsdMode,  // D-07 schema homogeneity: warn fail-closed also distinguishes mode
  });
} catch {
  // silent — never block the return on logger failure
}
```

**Apply** — mismo patrón:

```javascript
log.warn(EVENTS.GSD_PHASE_RESOLVED, {
  event: EVENTS.GSD_PHASE_RESOLVED,
  matched: false,
  error_code: resolverVerdict.code,
  detail: resolverVerdict.detail,
  task_ref: task.ref,
  mode: gsdMode,  // D-07 schema homogeneity: warn fail-closed also distinguishes mode
});
```

#### Anti-pattern: NO migrar a `gsdPhaseResolved()` / `gsdBootstrap()` helpers (D-03)

**Why** — los helpers en `src/logger-events.js:149-156` y `:166-173` tienen shapes fijos:

```javascript
// src/logger-events.js:149-156
export function gsdPhaseResolved(logger, fields) {
  logger.info(EVENTS.GSD_PHASE_RESOLVED, {
    event: EVENTS.GSD_PHASE_RESOLVED,
    phase_id: fields.phase_id,
    match_heading: fields.match_heading,
    mode: fields.mode,
  });
}
```

Acepta solo `{phase_id, match_heading, mode}` — no incluye los campos `matched:false`, `code`, `tolerated`, `error_code`, `detail`, `task_ref` que las dos variantes de dispatcher emiten. Forzar el helper exigiría:
- Modificar el helper (rompería los callers happy-path en lines 246-256).
- Crear helpers nuevos (overkill para 4 callsites locales — explícitamente deferred en CONTEXT lines 124-126).

**Resultado:** D-01 mandata literal-substitution, no helper-substitution. Los helpers existentes siguen disponibles para callers que emitan el shape canónico (matched-true) — dispatcher line 241 ya los usa.

#### `'gsd.bootstrap'` literal — NO existe en código (validación sanity)

**Apply para test D-13:** el test source-hygiene afirma que `'gsd.bootstrap'` NO aparece en código no-comment. Hoy ya pasa (cero ocurrencias). El test es **defensivo** — bloquea regresión si alguien añade en el futuro un `log.info('gsd.bootstrap', ...)` literal (ej. forking de bootstrap). El helper `gsdBootstrap()` (importado dinámicamente line 231) sigue siendo el único path para emitir el evento.

---

### 2. `src/gsd/verify.js` — markSessionStatus integration (D-10, D-11)

**Analog principal:** el propio `finalize()` en `verify.js`. La cadena `getTask → addComment → updateTaskState → orchestratorReview` ya está implementada con guardas de error individuales — Phase 16 inserta UNA línea más entre `updateTaskState` exitoso y `orchestratorReview`.

#### Verdict legacy mapping (header context — line 26)

**Source — verify.js:26:**

```javascript
//   pass + side-effects OK  → 'approved' (reason: 'gate-passed')
//   pass pero getTask falla → 'blocked'  (reason: 'plane-unreachable:getTask-failed')
//   fail                    → 'blocked'  (reason: '<reason>:<detail>')
//   missing                 → 'blocked'  (reason: 'missing')
//   malformed               → 'blocked'  (reason: 'malformed:<detail>')
```

**D-10 alignment:** el `reason` de `markSessionStatus` será **`'gate-passed'`** — exactamente el mismo string que ya usa `orchestratorReview` para la rama pass. Two emissions del mismo `reason` en la misma rama es intencional: un evento documenta el verdict (orchestrator.review), el otro documenta la transición de estado de la sesión (state.transition). Consistencia textual = trazabilidad.

#### Cadena actual `addComment OK → updateTaskState OK` (lines 218-245)

**Source — actual (lines 218-246):**

```javascript
if (task) {
  try {
    await provider.addComment(task, markdown);
    commented = true;
  } catch (err) {
    planeApiCallFailed(log, {
      step: 'addComment',
      error: /** @type {Error} */ (err).message,
    });
  }

  // updateTaskState: sólo si verdict pass Y addComment tuvo éxito.
  if (verdict.action === 'pass' && commented) {
    // Pitfall #1: config.providers[provider].states.review — NO top-level.
    const config = loadConfigFn();
    const providerName = session.provider || config.provider;
    const providerCfg = (config.providers && config.providers[providerName]) || {};
    const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';
    try {
      await provider.updateTaskState(task, reviewState);
      transitioned = true;
    } catch (err) {
      planeApiCallFailed(log, {
        step: 'updateTaskState',
        error: /** @type {Error} */ (err).message,
      });
    }
  }
}
```

#### Inserción de `markSessionStatus` (D-11)

**Apply** — DESPUÉS de `transitioned = true`, ANTES del `} catch (err)` que cierra el try de updateTaskState. La invocación va dentro del try-OK path (sólo se ejecuta si updateTaskState no lanzó):

```javascript
if (verdict.action === 'pass' && commented) {
  const config = loadConfigFn();
  const providerName = session.provider || config.provider;
  const providerCfg = (config.providers && config.providers[providerName]) || {};
  const reviewState = (providerCfg.states && providerCfg.states.review) || 'In review';
  try {
    await provider.updateTaskState(task, reviewState);
    transitioned = true;
    // Phase 16 LOG-14 (D-11): mark session 'review' SOLO cuando pass + addComment OK
    // + updateTaskState OK. El reason 'gate-passed' espeja el verdict legacy
    // mapping del header (line 26) y el orchestratorReview emitido abajo.
    // markSessionStatus emite state.transition con from/to reales vía logger.
    markSessionStatus(session.task_id, 'review', 'gate-passed', log);
  } catch (err) {
    planeApiCallFailed(log, {
      step: 'updateTaskState',
      error: /** @type {Error} */ (err).message,
    });
  }
}
```

> ⚠️ **Decisión de scope (Discretion):** la firma de `markSessionStatus(taskId, ...)` es `taskId` (`session.task_id`), no `task_ref`. El helper en `manager.js:300` busca por `s.task_id === taskId || s.task_ref === taskId` — acepta ambos, pero la convención por el resto del repo es pasar `task_id` (UUID estable). Verify.js tiene `session.task_id` disponible en la closure (lo persiste `findSessionFn`).

#### Import a añadir (top de verify.js)

**Source — actual (lines 32-39):**

```javascript
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseVerificationFrontmatter, computeVerdict } from './verification.js';
import { orchestratorReview, planeApiCallFailed } from '../logger-events.js';
import { createLogger } from '../logger.js';
```

**Apply** — añadir import `markSessionStatus` desde `manager.js` (sibling import, mismo patrón que el resto):

```javascript
import { markSessionStatus } from '../session/manager.js';
```

**LOG-12 / LOG-12-extension preservadas:** `manager.js` ya está fuera del grafo de `check.js` (verify.js consume manager.js indirectamente desde Phase 11). Importar `markSessionStatus` no añade nuevas dependencias prohibidas.

#### Anti-pattern: NO emitir state.transition en otras ramas (D-11, SC#3)

**Forbidden** — `markSessionStatus` se invoca **EXCLUSIVAMENTE** dentro del try-OK path del `if (verdict.action === 'pass' && commented)`. Las siguientes ramas NO emiten `state.transition` (regression test cubre cada una — SC#3):

| Rama | Por qué NO se emite |
|------|---------------------|
| `verdict.action === 'fail'` (soft-fail) | El task sigue en su estado actual; orchestrator decide siguiente paso; no hay transición de sesión |
| `verdict.action === 'fail'` (hard-fail) | Igual que soft-fail; el verdict ya documenta el blocker |
| `verdict.action === 'missing'` | VERIFICATION.md no encontrado; sesión no progresa de estado |
| `verdict.action === 'malformed'` | Frontmatter inválido; sesión bloqueada en su estado |
| `verdict.action === 'pass'` + getTask falla | `task` undefined → no entra al `if (task)` block — markSessionStatus nunca ejecutado |
| `verdict.action === 'pass'` + addComment falla | `commented = false` → `if (verdict.action === 'pass' && commented)` falso |
| `verdict.action === 'pass'` + updateTaskState falla | El throw cae en el catch ANTES del `markSessionStatus` (orden importa: la línea está **dentro** del try, no después) |

**Test pattern (regression):** spy sobre `log.info` fake. Filter por `event === 'state.transition'` y assert `events.filter(...).length === 0` en cada rama no-pass.

---

### 3. `src/hooks/stop.js` — markSessionStatus PRE-release (D-04, D-06, D-07, D-08, D-09)

**Analog principal:** el propio stop.js, lines 116-134 — el patrón "Emit typed event BEFORE mutation" ya documentado para `session.end`. D-08 lo extiende un nivel: `state.transition` antes de `releaseGsdLock`.

#### Patrón precedente — `session.end` event antes de removeSession (lines 116-134)

**Source — actual (lines 116-134):**

```javascript
// Emit typed session.end event BEFORE removeSession so the logger
// captures the transition while the session record still exists.
// Silent-failure: never crash Claude Code stop hook.
try {
  const { createLogger } = await import('../logger.js');
  const { sessionEnd } = await import('../logger-events.js');
  const log = createLogger({
    sessionId: session.session_id,
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'hook', task_id: session.task_id });
  sessionEnd(log, {
    session_id: session.session_id,
    task_id: session.task_id,
    status: session.status,
    ended_at: new Date().toISOString(),
  });
} catch {
  // silent — never crash Claude Code
}
```

**Three patterns to mirror:**
1. **Lazy dynamic import** del logger (no eager — stop.js es CLI hook, latency-sensitive).
2. **Try/catch silencioso** sin re-throw (`catch {}` literal).
3. **Child logger** con `component: 'hook'` y `task_id` binding.

#### Rama `if (session.gsd) { ... }` actual (lines 137-144)

**Source — actual (lines 137-144):**

```javascript
// Release GSD lock if applicable (D-09: idempotent, verifies session_id)
if (session.gsd) {
  try {
    const { releaseGsdLock } = await import('../gsd/lock.js');
    releaseGsdLock(session.project_path, session.session_id);
  } catch (err) {
    console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
  }
}

removeSession(id);
```

#### Inserción de `markSessionStatus` PRE-release (D-04, D-08, D-09)

**Apply (D-08)** — `markSessionStatus` se inserta DENTRO de la rama `if (session.gsd)`, ANTES del try que importa `releaseGsdLock`. Status fijo `'done'` (D-04 — hook mecánico, no infiere modo). Reason `'session-stop:lock-released'` (D-06). Try/catch silencioso (D-09):

```javascript
// Release GSD lock if applicable (D-09: idempotent, verifies session_id)
if (session.gsd) {
  // Phase 16 LOG-15 (D-04, D-08): mark session 'done' BEFORE releaseGsdLock so
  // the state.transition event captures the terminal status while the session
  // record still exists. Mirrors the session.end pattern at line 116 (emit
  // BEFORE mutation). Status is fixed 'done' for both modes (full + quick) —
  // stop.js is a mechanical hook and does NOT infer mode (D-04, D-07).
  try {
    const { createLogger } = await import('../logger.js');
    const { markSessionStatus } = await import('../session/manager.js');
    const log = createLogger({
      sessionId: session.session_id,
      minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
    }).child({ component: 'hook', task_id: session.task_id });
    markSessionStatus(session.task_id, 'done', 'session-stop:lock-released', log);
  } catch {
    // silent — never block lock release on logger failure (mirrors session.end pattern line 116)
  }

  try {
    const { releaseGsdLock } = await import('../gsd/lock.js');
    releaseGsdLock(session.project_path, session.session_id);
  } catch (err) {
    console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
  }
}

removeSession(id);
```

**Reuse vs. duplicate logger:** dos opciones (Discretion):
- **(a) Crear el child logger DOS veces** (una para markSessionStatus, otra implícita en sessionEnd vía la closure superior). Coste: +1 createLogger per stop. Cero churn fuera de la rama gsd.
- **(b) Hoist** el `log` creado en lines 119-125 a una scope superior y reusarlo en ambos sites. Pero `sessionEnd` está fuera del `if (session.gsd)` — y D-07 dice que `markSessionStatus` SOLO va dentro. Mezclar scopes complica.

**Recomendación:** (a) — un createLogger extra dentro del `if (session.gsd)` block. Coste despreciable, lectura más simple, satisface D-07/D-09 sin acrobacias.

#### Anti-pattern: NO modificar la rama no-GSD del switch (D-07)

**Forbidden** — el switch `getSessionMode(session)` (NO existe explícitamente en stop.js — vive en `buildStopNudgeText` line 41-56) y el `else if (!session.gsd)` implícito por el `if (session.gsd)` block NO emiten `state.transition`. Mantener:
- Si `session.gsd === false/undefined`: no entra al block → `markSessionStatus` no se llama → no `state.transition` → behavior pre-Phase 16 byte-a-byte.
- El `removeSession(id)` line 146 sigue siendo el único side-effect mecánico para sesiones no-GSD.

#### Anti-pattern: NO inferir modo (D-04, D-07)

**Forbidden** — stop.js NO consulta:
- `getSessionMode(session)` para decidir si emitir o no.
- `session.gsd_mode` para variar `nextStatus`.
- `session.phase_id` para decidir si verify pasó (sería responsabilidad del orchestrator, no del hook).

`'done'` se pasa **literal** como argumento. Si `verify.js` dejó la sesión en `'review'` (Phase 10/16 happy path), `markSessionStatus` emite `from='review' to='done'` (D-05). Si stop dispara antes que verify (caso quick — sin verify intermedio), emite `from='running' to='done'`. Ambas transiciones son válidas — el hook no juzga.

#### Resumen de orden final del block `if (session.gsd)`

```
1. createLogger + child  (closure local)
2. markSessionStatus(task_id, 'done', 'session-stop:lock-released', log)
   → emite state.transition con from=session.status, to='done'
3. releaseGsdLock(project_path, session_id)
   → libera el lock per-repo (idempotente, verifica owner)
4. (fuera del if) removeSession(id)
   → borra la entry de state.json
```

---

### 4. `test/dispatcher-isolation.test.js` (NEW) — D-12, D-13

**Analog combinado:**
- **Naming + estructura general:** `test/check-isolation.test.js` (file-naming `*-isolation.test.js` paralelo).
- **Comment-aware filter regex:** `test/stop.test.js:60-72` (`replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(...)`).
- **Positive import assert:** `test/format-isolation.test.js:141-163` (assert que un specifier RELATIVO a un módulo concreto está presente).

#### Imports + path setup (analog: check-isolation.test.js:1-9)

**Source — `test/check-isolation.test.js:1-9`:**

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
```

**Apply (verbatim)** — mismo bloque al top de `test/dispatcher-isolation.test.js`. Añadir además la ruta concreta del subject:

```javascript
const DISPATCHER_PATH = join(SRC, 'triggers', 'dispatcher.js');
```

#### Comment-aware filter (analog: stop.test.js:60-72)

**Source — `test/stop.test.js:62-67`:**

```javascript
const stripped = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
  .join('\n');
```

**Apply (D-12)** — copiar el helper como función nombrada reutilizable dentro del test file:

```javascript
/**
 * Strip block comments + line comments + JSDoc continuation lines.
 * Used by source-hygiene tests that want to assert literal-absence in CODE
 * (not in documentation prose). Comments in dispatcher.js documenting the
 * historical contract D-14 mention 'gsd.phase.resolved' literally and must
 * be tolerated.
 *
 * @param {string} src
 * @returns {string} the source with all comment lines removed
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

#### Three asserts (D-13)

**Apply** — el test file declara EXACTAMENTE tres asserts en un solo `describe`:

```javascript
describe('LOG-13: dispatcher source hygiene (Phase 16 SC#1)', () => {
  it('does not contain literal "gsd.phase.resolved" in non-comment code (uses EVENTS.GSD_PHASE_RESOLVED)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes("'gsd.phase.resolved'") && !stripped.includes('"gsd.phase.resolved"'),
      'src/triggers/dispatcher.js must not contain literal "gsd.phase.resolved" in code (use EVENTS.GSD_PHASE_RESOLVED). ' +
        'Comments documenting the historical contract are allowed.',
    );
  });

  it('does not contain literal "gsd.bootstrap" in non-comment code (uses EVENTS.GSD_BOOTSTRAP or gsdBootstrap helper)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    const stripped = stripComments(source);
    assert.ok(
      !stripped.includes("'gsd.bootstrap'") && !stripped.includes('"gsd.bootstrap"'),
      'src/triggers/dispatcher.js must not contain literal "gsd.bootstrap" in code (use EVENTS.GSD_BOOTSTRAP or gsdBootstrap helper).',
    );
  });

  it('imports EVENTS from logger-events.js (forces wiring — Phase 16 D-02)', () => {
    const source = readFileSync(DISPATCHER_PATH, 'utf-8');
    // El path relativo desde src/triggers/dispatcher.js a src/logger-events.js
    // es '../logger-events.js'. Acepta la forma `import { EVENTS } from '...'`
    // o `import { EVENTS, ... } from '...'` (named import, posiblemente con extras).
    assert.match(
      source,
      /import\s+\{[^}]*\bEVENTS\b[^}]*\}\s+from\s+['"]\.\.\/logger-events\.js['"]/,
      'dispatcher.js must import { EVENTS } from "../logger-events.js" (Phase 16 D-02 wiring)',
    );
  });
});
```

#### Anti-pattern: NO replicar el walker LOG-12 (D-12)

**Forbidden** — el test NO usa `walkImports()` ni asserts transitivos. dispatcher.js no introduce indirecciones (helpers locales que retornen el string, módulo intermedio que re-exporte). Single-file scan basta. Si en el futuro alguien añade un `const EVT = 'gsd.phase.resolved'; log.info(EVT, ...)`, el test FALLARÁ (la indirección queda en el non-comment code y `stripped.includes("'gsd.phase.resolved'")` es true sobre el RHS del const) — comportamiento deseado.

---

### 5. Regression tests verify.js (extend `test/gsd-verify-integration.test.js`) — SC#3

**Analog principal:** el propio archivo. T20-T23 ya tienen el patrón fake-logger / event-spy completo (lines 73-83):

#### memSink / fake logger pattern existente (lines 73-83)

**Source — `test/gsd-verify-integration.test.js:73-83`:**

```javascript
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,
  };
  return { logger, events };
}
```

**Reuse verbatim** — ya cumple todos los requisitos (captura los 4 niveles, child() devuelve el mismo logger para preservar el `events` array a través de `.child({component: 'session', task_id})`).

#### Pass branch — POSITIVE assert (state.transition emitted)

**Apply (extender T20)** — añadir asserts al test existente que ya postea pass:

```javascript
// En el T20 actual (line 103-142), después de las asserts de Plane:
const transition = events.find((e) => e.fields?.event === 'state.transition');
assert.ok(transition, 'pass branch must emit state.transition');
assert.equal(transition.level, 'info');
assert.equal(transition.fields.from, 'review'); // o el status real del fixture
assert.equal(transition.fields.to, 'review');
assert.equal(transition.fields.reason, 'gate-passed');
```

> ⚠️ **Sutileza:** el fixture session line 50 tiene `status: 'review'` ya. Si el test crea una sesión `status: 'running'`, la transición observada será `from='running' to='review'`. El planner debe ajustar el fixture o el assert según el setup deseado para SC#2.

#### 4+ ramas NEGATIVE (state.transition NO emitted)

**Apply (extender T21, T22, T23 + 2 nuevos tests para errores Plane)** — cada test añade UN assert:

```javascript
// En T21 (fail/gaps-found, line 144-170), añadir:
const transition = events.find((e) => e.fields?.event === 'state.transition');
assert.equal(transition, undefined, 'fail branch must NOT emit state.transition');

// En T22 (malformed, line 172-196), añadir:
const transition = events.find((e) => e.fields?.event === 'state.transition');
assert.equal(transition, undefined, 'malformed branch must NOT emit state.transition');

// En T23 (missing, line 198+), añadir:
const transition = events.find((e) => e.fields?.event === 'state.transition');
assert.equal(transition, undefined, 'missing branch must NOT emit state.transition');
```

#### 2 ramas NEGATIVE de error Plane (NEW tests)

**Apply** — dos tests nuevos para los paths donde getTask/addComment/updateTaskState fallan:

```javascript
it('SC#3 LOG-14: pass + getTask fails → NO state.transition emitted', async () => {
  writeFileSync( /* VERIFICATION.md pass */ );
  const session = makeSession();
  const { deps, calls, events } = makeDeps(session);
  // Override provider to throw on getTask:
  deps.getProviderFn = async () => ({
    getTask: async () => { throw new Error('Plane unreachable'); },
    addComment: async () => {},
    updateTaskState: async () => {},
  });
  await runGsdVerify({ sessionId: 'sess-int' }, deps);
  const transition = events.find((e) => e.fields?.event === 'state.transition');
  assert.equal(transition, undefined, 'pass + getTask fail must NOT emit state.transition (markSessionStatus skipped)');
  // Sanity: planeApiCallFailed sí se emitió:
  const apiFailed = events.find((e) => e.fields?.event === 'plane.api.call.failed' && e.fields.step === 'getTask');
  assert.ok(apiFailed);
});

it('SC#3 LOG-14: pass + updateTaskState fails → NO state.transition emitted', async () => {
  writeFileSync( /* VERIFICATION.md pass */ );
  const session = makeSession();
  const { deps, calls, events } = makeDeps(session);
  // Override provider to throw on updateTaskState:
  const { provider, calls: providerCalls } = makeProviderMock();
  provider.updateTaskState = async () => { throw new Error('Plane state transition rejected'); };
  deps.getProviderFn = async () => provider;
  await runGsdVerify({ sessionId: 'sess-int' }, deps);
  const transition = events.find((e) => e.fields?.event === 'state.transition');
  assert.equal(transition, undefined, 'pass + updateTaskState fail must NOT emit state.transition (markSessionStatus is INSIDE the updateTaskState try block, lost to catch)');
});
```

> ⚠️ **Critical para D-11:** el test `pass + updateTaskState fails` documenta el orden exacto del cableado: `markSessionStatus` está **dentro** del try de updateTaskState, después de `transitioned = true`. Si alguien refactoriza moviéndolo después del try (afuera del bloque), el test SC#3 lo cazaría — porque `state.transition` aparecería incluso en el path de fallo, violando D-11.

#### Anti-pattern: NO emitir state.transition en soft-fail/hard-fail/missing/malformed/error branches (D-11, SC#3)

Reformulación de la sección "Pattern 2 anti-pattern" arriba en formato test-asserts. Cobertura completa (4 ramas verdict + 2 ramas error Plane = 6 negative tests).

---

### 6. Coverage tests stop.js (NEW `test/stop-state-transition.test.js`) — SC#5

**Analog principal:** `test/gsd-verify-integration.test.js` (memSink + fixture en tmpdir + spy logger). El test stop.test.js actual (146 líneas) cubre source-hygiene + `buildStopNudgeText` switch — Phase 16 introduce un comportamiento nuevo (state.transition emit) que requiere otro file de test para no engordar el archivo existente con una preocupación distinta.

#### Por qué nuevo file (no extender stop.test.js)

stop.test.js actual mezcla:
- Source-hygiene contra `src/hooks/stop.js` (lines 12-87).
- Behavior tests sobre `buildStopNudgeText` (line 89-146).

Phase 16 testea behavior DIFERENTE: `state.transition` emit cuando lock se libera. Eso es testear `main()`, no `buildStopNudgeText`. Y `main()` actual no es exportable (line 71 + line 207 wrapped en `if (isMainEntry)`). Dos opciones:

- **(a) Refactorizar `main()`** para exportarlo y hacer DI — fuera del scope D-04 ("hook mecánico, NO infiere modo, NO consulta verdict"). Sería scope-creep.
- **(b) Test indirecto** vía: spawn `node src/hooks/stop.js` con stdin sintético, fixture `state.json` real con `gsd:true`, y assert sobre el contenido del log NDJSON file generado (mismo enfoque que UAT-02 deferred Phase 17).

**Discretion (Recomendación):** opción (a) **light** — extraer el body de `main()` a una función `runStopHook(input, deps)` exportable, dejando `main()` como wrapper:

```javascript
// Mínimo refactor: extraer la lógica a una función testeable.
export async function runStopHook(input, deps = {}) {
  const findSessionFn = deps.findSessionFn || findSession;
  const removeSessionFn = deps.removeSessionFn || removeSession;
  const cmuxClient = deps.cmux || cmux;
  const loggerFactory = deps.loggerFactory || /* ... */;
  // ... resto del cuerpo actual de main() pero recibiendo deps
}

async function main() {
  const input = JSON.parse(await readStdin());
  await runStopHook(input);
}
```

> ⚠️ **Decisión a verificar con planner:** este micro-refactor está dentro de SC#5 ("nuevos tests cubren los 3 callsites") pero NO en CONTEXT explícitamente. Plan alternativo: usar opción (b) (spawn child process + fixture) — más realista pero más lento. El planner debe elegir antes de escribir el plan, basándose en el coste de mantenimiento futuro.

#### Test patterns a cubrir (3 escenarios SC#5)

**Apply** — tres tests + memSink + fixture session sintético:

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function makeLogger() {
  // Reuse verbatim del patrón en gsd-verify-integration.test.js:73-83
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,
  };
  return { logger, events };
}

describe('SC#5 LOG-15: stop hook state.transition coverage', () => {
  it('full mode: session.status="review" + lock release → emits state.transition from=review to=done', async () => {
    // Fixture session quasi-real (campos mínimos del Session record).
    // markSessionStatus busca por task_id → state.json debe estar poblado.
    // Setup: state.json con session {gsd:true, gsd_mode:'full', status:'review', ...}
    // Run: runStopHook({session_id: ..., cwd: ...}, deps)
    // Assert events.find(e => e.fields?.event === 'state.transition') matches:
    //   from === 'review', to === 'done', reason === 'session-stop:lock-released'
  });

  it('quick mode: session.status="running" + lock release → emits state.transition from=running to=done', async () => {
    // Igual pero session.status='running' (quick no pasa por verify).
    // Assert from='running', to='done', reason='session-stop:lock-released'
  });

  it('non-GSD: session.gsd=false → does NOT emit state.transition', async () => {
    // Setup: state.json con session {gsd:false, status:'running', ...}
    // Assert events.find(e => e.fields?.event === 'state.transition') === undefined
    // Sanity: removeSession sí se ejecutó (la sesión sale del state.json)
  });
});
```

#### Anti-pattern: NO inferir modo en stop.js (D-04 fixed `'done'`)

**Forbidden** — los tests NO pasan distintos `expectedTo` por modo. Los tres escenarios full + quick siempre asertan `to === 'done'`. Solo varía el `from` (que viene del `session.status` previo, no del modo). Si un test asume `to === 'review'` en quick, está violando D-04 — fail intencional.

#### Anti-pattern: NO modificar la rama no-GSD (D-07)

**Forbidden** — el tercer test (non-GSD) NO valida ningún `state.transition`. Lo único que assert-a es que NO se emite. Si el implementer añade `markSessionStatus` fuera de `if (session.gsd)`, este test falla.

---

## Shared Patterns

### Pattern A — Lazy dynamic import del logger en hooks

**Source dual:**
- `src/triggers/dispatcher.js:178, 205, 230` — `await import('../logger.js')` dentro de cada try-block emisor.
- `src/hooks/stop.js:120-121` — `await import('../logger.js')` + `await import('../logger-events.js')`.

**Apply Phase 16:**
- **dispatcher.js** mantiene patrón actual (no cambia — el `EVENTS` import es eager, pero `createLogger` sigue lazy).
- **stop.js** Phase 16 D-08 añade dos imports lazy más: `await import('../logger.js')` (createLogger) y `await import('../session/manager.js')` (markSessionStatus). Mantiene el patrón.
- **verify.js** NO sigue este patrón — `createLogger` está en eager import line 39 (porque verify.js es CLI-invoked, no hook con startup-budget). `markSessionStatus` también va eager (sibling import desde manager.js).

### Pattern B — Try/catch silencioso "never block X on logger failure"

**Source triple:**
- `src/triggers/dispatcher.js:191-193` — `silent — never block dispatch on logger failure (mirror existing forensic warn pattern below)`.
- `src/triggers/dispatcher.js:218-219` — `silent — never block the return on logger failure`.
- `src/hooks/stop.js:132` — `silent — never crash Claude Code`.

**Apply Phase 16 D-09:**

```javascript
} catch {
  // silent — never block lock release on logger failure (mirrors session.end pattern line 116)
}
```

Comentario explícito que CITA el patrón precedente (line 116 de stop.js). Esto es D-09 textual.

### Pattern C — Spy fake logger via `child: () => logger` self-return

**Source:** `test/gsd-verify-integration.test.js:73-83`. La key insight es que `child()` devuelve **el mismo logger** (no uno nuevo) para preservar el array `events` a través de los `.child(...)` calls de los emisores. `markSessionStatus` line 304 hace `logger.child({ component: 'session', task_id: taskId })` — sin el self-return, los eventos del child se perderían.

**Apply Phase 16:**
- **Regression tests verify.js** (sección 5): reuse verbatim del helper.
- **Coverage tests stop.js** (sección 6): replicar verbatim el helper en el nuevo file.

```javascript
function makeLogger() {
  const events = [];
  const logger = {
    info: (m, f) => events.push({ level: 'info', msg: m, fields: f }),
    warn: (m, f) => events.push({ level: 'warn', msg: m, fields: f }),
    error: (m, f) => events.push({ level: 'error', msg: m, fields: f }),
    debug: (m, f) => events.push({ level: 'debug', msg: m, fields: f }),
    child: () => logger,  // ← self-return, NO new logger
  };
  return { logger, events };
}
```

### Pattern D — `event === 'state.transition'` filter con field key del payload

**Source:** `src/logger-events.js:117-124` — `stateTransition(logger, fields)` emite `{event: EVENTS.STATE_TRANSITION, from, to, reason}`. El `event:` key dentro del payload es el discriminator estable (más robusto que filter por `msg`).

**Apply** — todos los regression tests filtran por `e.fields?.event === 'state.transition'` (NO por `e.msg`):

```javascript
const transition = events.find((e) => e.fields?.event === 'state.transition');
```

**Why** — `msg` puede mutar (ej. logger refactor renombra el primer arg de `log.info`). El `event:` key es contractual (D-10 Phase 7).

### Pattern E — Stop.js source-hygiene tests siguen verdes (Phase 13 D-09/D-10)

**Source:** `test/stop.test.js:53-72` — anti-inline `session.gsd_mode || "full"` y anti-direct-access `.gsd_mode`.

**Apply Phase 16:** los cambios D-08 (markSessionStatus) NO acceden a `session.gsd_mode` ni a `getSessionMode(session)` — solo a `session.task_id`, `session.session_id`, `session.status` (vía markSessionStatus internal lookup). Los tests existentes Phase 13 siguen pasando sin modificación. **Verificar después del implementer:** correr `node --test test/stop.test.js` y confirmar 0 fails.

---

## No Analog Found

| File | Razón |
|------|-------|
| (ninguno) | Los 3 callsites tienen analogs claros — el propio archivo modificado es el patrón a seguir. Los tests reusen patrones de check-isolation/stop.test/gsd-verify-integration verbatim. |

**Patrones nuevos sin precedente directo en el repo** (pero derivables del archivo afectado):
1. **Comment-aware grep filter** (D-12 dispatcher-isolation.test.js): primer test del repo que separa código de comentarios para asserts de literal-absence. Patrón ya implementado fragmentariamente en `test/stop.test.js:62-67` — Phase 16 lo eleva a helper nombrado.
2. **`markSessionStatus` cableado en consumers reales**: el helper existe en `manager.js:299` pero hasta Phase 16 no tiene call sites en runtime productivo (solo el path implícito vía `updateSession` antes). Phase 16 establece el patrón: 1 callsite por surface (verify, stop), reason string descriptivo.

---

## Metadata

**Analog search scope:**
- `src/`: dispatcher.js, gsd/verify.js, hooks/stop.js, logger-events.js, session/manager.js
- `test/`: dispatcher.test.js, manager.test.js, stop.test.js, check-isolation.test.js, format-isolation.test.js, gsd-verify-integration.test.js
- `.planning/phases/`: 14-PATTERNS.md, 15-PATTERNS.md (formato a seguir), 16-CONTEXT.md (decisions)

**Files read (analogs):**
- Source: 5 archivos completos (dispatcher.js 339 líneas, verify.js 403, stop.js 209, logger-events.js 205, manager.js 308)
- Tests: 5 archivos (manager.test.js 416, stop.test.js 146, check-isolation.test.js 109, format-isolation.test.js 182, gsd-verify-integration.test.js 200/288 leídos)

**Verifications run:**
- `grep -n "gsd.phase.resolved\|gsd.bootstrap" src/triggers/dispatcher.js` → confirma 4 literales 'gsd.phase.resolved' (líneas 183, 184, 210, 211) + 4 menciones en comentarios (171, 173, 203, 228).
- `grep -n "'gsd.bootstrap'\|\"gsd.bootstrap\"" src/triggers/dispatcher.js` → confirma 0 literales runtime (helper `gsdBootstrap()` ya en uso).
- `grep -rn "markSessionStatus" src/ test/` → confirma 1 callsite (definición en manager.js:299), 0 callsites runtime productivos antes de Phase 16.

**Critical correction logged:**
- **CONTEXT línea 12** dice "4 literales `'gsd.phase.resolved'` + 1 `'gsd.bootstrap'`". Verificación contra código (2026-05-06): SOLO 4 literales `gsd.phase.resolved` y CERO literales `gsd.bootstrap` en runtime. La rama matched-true (line 251) ya usa `gsdBootstrap()` helper. **Total real a migrar: 4 sustituciones, NO 5.** El test source-hygiene D-13 sigue afirmando ambos strings ausentes en código no-comment como guardia anti-regresión (cero ocurrencias de `'gsd.bootstrap'` HOY → el test pasa trivialmente HOY pero bloquea regresión futura si alguien re-introduce el literal).

**Pattern extraction date:** 2026-05-06.
