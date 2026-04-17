# Phase 8: GSD Label + Session Plumbing - Research

**Researched:** 2026-04-17
**Domain:** GSD flag propagation, session context injection, per-repo file locking
**Confidence:** HIGH

## Summary

Phase 8 conecta tres piezas: (1) el flag `gsd` ya parseado por `parseKodoLabels` se propaga al `SessionRecord` y al dispatcher, (2) el hook `session-start.js` bifurca su output entre contexto generico y contexto GSD con instrucciones de skill invocation, y (3) un lock file por repo (``.planning/.kodo.lock``) impide sesiones GSD concurrentes en el mismo repositorio.

El codebase esta preparado para esta fase: `parseKodoLabels` ya produce `flags: ['gsd']`, el dispatcher ya tiene un patron de guards con DI (`DispatchDeps`), los event helpers `gsdPhaseResolved` y `gsdBootstrap` ya existen en `logger-events.js`, y el Session typedef es extensible. El trabajo es puramente aditivo -- no hay breaking changes.

La complejidad principal esta en la semantica del lock (adquisicion, robo por PID muerto, TTL auto-release) y en la bifurcacion del contexto GSD que **reemplaza** completamente las instrucciones genericas (no coexisten).

**Primary recommendation:** Implementar en 3 sub-planes: (1) lock module + tests, (2) SessionRecord + dispatcher guard + tests, (3) hook bifurcation + integration test de concurrencia.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Placeholder condicionado en `session-start.js`: si `session.phase_id` existe, inyecta cadena GSD (`/gsd-plan-phase <n>` -> `/gsd-execute-phase <n>` -> `/gsd-verify-work`); si `phase_id` ausente, inyecta `/gsd-new-project`.
- **D-02:** Comandos usan forma `gsd-new-project` (guion), no `gsd:new-project` (dos puntos).
- **D-03:** El contexto GSD **reemplaza** completamente las instrucciones genericas de `buildSessionContext`. Datos comunes (task_ref, project_path, session_id) se mantienen.
- **D-04:** Idioma del contexto GSD inyectado: **ingles**.
- **D-05:** Lock file en `.planning/.kodo.lock` (sentinel en el repo destino).
- **D-06:** Contenido del lock: JSON con `session_id`, `task_id`, `task_ref`, `pid`, `acquired_at`, `ttl_hours` (default 4).
- **D-07:** Semantica de adquisicion: no existe -> crear; PID muerto -> robar; PID vivo + TTL expirado -> robar + warn; PID vivo + TTL OK -> rechazar con `{ action: 'gsd_locked', holder }`.
- **D-08:** Guard del lock en `dispatcher.js`, despues del inFlight check, solo cuando `flags.includes('gsd')`.
- **D-09:** Liberacion del lock en `stop.js`. Idempotente (verifica session_id antes de borrar).
- **D-10:** Campo `gsd?: boolean` en SessionRecord. Aditivo, sin migracion.
- **D-11:** Campo `phase_id?: string` en SessionRecord (preparacion Phase 9, no se rellena en Phase 8).
- **D-12:** `buildSessionFromTask` recibe `flags` y setea `gsd: flags.includes('gsd')`.

### Claude's Discretion
- Nombre exacto del modulo de lock (`src/gsd/lock.js`, `src/locks.js`, etc.)
- TTL default (4h es sugerencia)
- Formato exacto del warn a stderr cuando se roba un lock por TTL expirado
- Si `buildGsdContext` vive en el mismo archivo que `buildSessionContext` o en modulo aparte
- Mecanismo de PID check (kill -0 vs /proc)

### Deferred Ideas (OUT OF SCOPE)
- `kodo unlock` CLI command
- Lint rule anti-interpolacion de secretos
- Refactor `src/check.js` (separar snapshot/act)
- Lock multi-tier (repo + workspace)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GSD-01 | Usuario puede etiquetar una tarea Plane con `kodo:gsd` y kodo reconoce el modo GSD en el dispatcher | `parseKodoLabels` ya produce `flags: ['gsd']`; falta propagar a SessionRecord (`gsd: true`) y que el dispatcher use el flag para el lock guard |
| GSD-04 | Sesion GSD recibe contexto inyectado con la secuencia de comandos GSD al arrancar | `buildSessionContext` en `session-start.js` necesita bifurcacion: si `session.gsd` -> `buildGsdContext()` que inyecta los comandos `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-verify-work` |
| GSD-10 | Dos tareas Plane apuntando al mismo repo no arrancan sesiones GSD concurrentes | Lock file `.planning/.kodo.lock` con PID check via `process.kill(pid, 0)` y TTL auto-release; guard en dispatcher keyed por `realpathSync(project_path)` |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| GSD flag parsing | Labels module (`src/labels.js`) | -- | Ya implementado, no requiere cambios |
| Flag propagation to session | Session manager (`src/session/manager.js`) | Session state typedef (`src/session/state.js`) | `buildSessionFromTask` es el factory que construye el record |
| Per-repo lock acquire/release | Lock module (nuevo) | -- | Logica pura de filesystem aislada en su propio modulo |
| Lock guard (reject concurrent) | Dispatcher (`src/triggers/dispatcher.js`) | -- | Centraliza todos los guards; sigue el patron existente de `inFlight` |
| GSD context injection | Session-start hook (`src/hooks/session-start.js`) | -- | Punto de inyeccion existente; bifurca segun `session.gsd` |
| Lock release on stop | Stop hook (`src/hooks/stop.js`) | -- | Cleanup mecanico al cierre, patron establecido |
| Event emission | Logger-events (`src/logger-events.js`) | -- | Helpers `gsdPhaseResolved`, `gsdBootstrap` ya definidos |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:fs | built-in (Node 25.9) | Lock file read/write, `realpathSync` | [VERIFIED: `node --version` = v25.9.0] Zero-dep, proyecto no permite runtime deps adicionales |
| node:test | built-in | Test runner | [VERIFIED: package.json scripts] Patron establecido del proyecto |
| node:assert/strict | built-in | Assertions | [VERIFIED: test files] Patron establecido |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | `join` para construir path del lock file | Construir `.planning/.kodo.lock` |
| node:process | built-in | `process.kill(pid, 0)` para PID liveness check | Lock acquisition/steal logic |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File lock manual | `proper-lockfile` npm | Anade runtime dep -- prohibido por principio zero-deps del proyecto [VERIFIED: PROJECT.md] |
| `process.kill(pid, 0)` | `/proc/${pid}` check | `/proc` no existe en macOS [VERIFIED: plataforma darwin] |

## Architecture Patterns

### System Architecture Diagram

```
Webhook/CLI trigger
       |
       v
  +-----------+     parseKodoLabels
  | dispatcher|---> flags: ['gsd']
  +-----------+
       |
       | [Guard chain]
       | 1. kodo label check
       | 2. terminal state check
       | 3. inFlight dedup (by task_id)
       | 4. NEW: gsd repo lock (by realpath)  <-- Phase 8
       | 5. session-already-active check
       |
       v
  +---------------+
  | launchWorkItem |---> buildSessionFromTask({ ...flags })
  +---------------+       |
       |                  v
       |            SessionRecord { gsd: true, phase_id?: string }
       v
  +------------------+
  | session-start.js |
  +------------------+
       |
       +---> if session.gsd
       |       |
       |       +---> buildGsdContext(session)
       |              "GSD Mode" + task data + command sequence
       |
       +---> else
               |
               +---> buildSessionContext(session, config)  [existing]
               
  [On session end]
  +----------+
  | stop.js  |---> releaseGsdLock(session) [if session.gsd]
  +----------+
```

### Recommended Project Structure
```
src/
  gsd/
    lock.js           # acquireGsdLock, releaseGsdLock, isLockStale, readLock
  hooks/
    session-start.js  # + buildGsdContext (or import from gsd/context.js)
    stop.js           # + releaseGsdLock call
  session/
    manager.js        # buildSessionFromTask extended with flags
    state.js          # Session typedef extended with gsd?, phase_id?
  triggers/
    dispatcher.js     # + gsd lock guard
test/
  gsd-lock.test.js    # lock module unit tests
  gsd-context.test.js # GSD context builder tests  
  gsd-concurrency.test.js  # integration test: two tasks, same repo
```

### Pattern 1: Lock Module (Pure FS Operations)
**What:** Modulo aislado con funciones puras para adquirir, verificar y liberar locks.
**When to use:** Cada interaccion con `.planning/.kodo.lock`.

```javascript
// Source: derived from CONTEXT.md D-05..D-07, verified against Node stdlib
// src/gsd/lock.js
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { realpathSync } from 'node:fs';

/**
 * @typedef {{
 *   session_id: string,
 *   task_id: string,
 *   task_ref: string,
 *   pid: number,
 *   acquired_at: string,
 *   ttl_hours: number,
 * }} LockContent
 */

const LOCK_FILE = '.planning/.kodo.lock';
const DEFAULT_TTL_HOURS = 4;

/**
 * Check if a PID is alive using kill -0.
 * @param {number} pid
 * @returns {boolean}
 */
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);  // signal 0 = liveness check only
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';  // ESRCH = no such process
  }
}

/**
 * Attempt to acquire the GSD lock for a repo.
 * @param {string} projectPath - absolute path to the repo
 * @param {{ session_id: string, task_id: string, task_ref: string }} session
 * @returns {{ acquired: boolean, holder?: LockContent }}
 */
export function acquireGsdLock(projectPath, session) {
  const lockPath = join(realpathSync(projectPath), LOCK_FILE);
  // ... acquisition logic per D-07
}
```

### Pattern 2: Dispatcher Guard (DI-Compatible)
**What:** Nuevo guard en la cadena del dispatcher que verifica el lock GSD.
**When to use:** Solo cuando `kodoConfig.flags.includes('gsd')`.

```javascript
// Source: derived from CONTEXT.md D-08 + existing dispatcher.js pattern
// Inside dispatchTrigger, after inFlight check:

// 3b. GSD repo lock guard (only for GSD-flagged tasks)
if (kodoConfig.flags.includes('gsd')) {
  const lockResult = acquireGsdLockFn(projectPath, {
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
  });
  if (!lockResult.acquired) {
    return { action: 'gsd_locked', holder: lockResult.holder };
  }
}
```

### Pattern 3: Context Bifurcation
**What:** `session-start.js` selecciona entre contexto GSD y generico basandose en `session.gsd`.
**When to use:** En el hook `main()` al construir `additionalContext`.

```javascript
// Source: CONTEXT.md D-01, D-03, D-04
const context = session.gsd
  ? buildGsdContext(session)
  : buildSessionContext(session, config);
```

### Anti-Patterns to Avoid
- **Lock en memoria (in-process):** No sobrevive a crashes; debe ser file-based para que TTL funcione entre reinicios del server. [VERIFIED: CONTEXT.md D-05]
- **Lock global en `~/.kodo/`:** Requeriria indexar por repo path; el lock en el repo destino es autodescriptivo y visible al usuario. [VERIFIED: CONTEXT.md D-05]
- **Contexto GSD coexistiendo con generico:** Las instrucciones GSD son incompatibles con el flujo manual (no hay "comenta tu plan" ni "mueve a Review" manuales). [VERIFIED: CONTEXT.md D-03]
- **Hardcodear "Plane" en el contexto GSD:** El contexto es provider-agnostic; datos de tarea vienen del SessionRecord. [VERIFIED: test/session-start.test.js Test 6]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PID liveness check | Leer `/proc/<pid>` | `process.kill(pid, 0)` | `/proc` no existe en macOS; kill-0 es POSIX portable [VERIFIED: test manual en darwin] |
| Symlink-safe path comparison | `===` string comparison | `fs.realpathSync()` | `/tmp` y `/private/tmp` son el mismo directorio en macOS [VERIFIED: test manual] |
| Lock file atomicity | `writeFileSync` directo | `writeFileSync` con `mkdirSync({recursive:true})` primero | `.planning/` puede no existir en repos sin GSD previo |
| File locking library | npm `proper-lockfile` | Manual JSON file lock | Zero runtime deps policy [VERIFIED: PROJECT.md] |

**Key insight:** El lock de kodo no necesita atomicidad real de filesystem (como `O_EXCL` o `flock`) porque el dispatcher es single-threaded (Node event loop). La race condition es entre procesos, y el PID check + TTL cubren ese caso. El `inFlight` Set ya cubre la race intra-proceso.

## Common Pitfalls

### Pitfall 1: Race Between Two Webhook Arrivals
**What goes wrong:** Dos webhooks para distintas tareas del mismo repo llegan simultaneamente, ambas pasan el inFlight check (distintos task_id), y ambas intentan adquirir el lock.
**Why it happens:** `inFlight` esta keyed por `task_id`, no por `project_path`.
**How to avoid:** El lock file actua como mutex entre procesos. Dentro del mismo proceso Node, el event loop serializa las operaciones de filesystem. La segunda llamada a `acquireGsdLock` vera el lock ya escrito por la primera.
**Warning signs:** Test de integracion con dos tareas simultaneas falla intermitentemente.

### Pitfall 2: Lock Stale After Crash
**What goes wrong:** El proceso kodo crashea sin ejecutar el stop hook; el lock queda huerfano.
**Why it happens:** El stop hook no se ejecuta en SIGKILL o crash fatal.
**How to avoid:** TTL auto-release (D-07 punto 3) + PID liveness check (D-07 punto 2). Si el PID del holder esta muerto, el lock se roba automaticamente. [VERIFIED: CONTEXT.md D-07]
**Warning signs:** Sesiones GSD bloqueadas permanentemente tras un crash.

### Pitfall 3: realpath Divergence
**What goes wrong:** Dos tareas del mismo repo usan paths distintos (uno con symlink, otro sin). El lock no se comparte porque los paths no matchean.
**Why it happens:** `projects.json` puede tener `/tmp/myrepo` mientras el webhook resuelve `/private/tmp/myrepo`.
**How to avoid:** Siempre usar `fs.realpathSync()` antes de comparar paths o construir el lock path. [VERIFIED: `realpathSync('/tmp')` = `/private/tmp` en darwin]
**Warning signs:** Dos sesiones GSD corren en paralelo en el "mismo" repo.

### Pitfall 4: `.planning/` Absent in Target Repo
**What goes wrong:** El lock file path es `.planning/.kodo.lock` pero `.planning/` no existe en repos sin GSD previo.
**Why it happens:** Phase 9 es la que bootstrapea `.planning/`; Phase 8 necesita crear el directorio si no existe.
**How to avoid:** `mkdirSync(dirname(lockPath), { recursive: true })` antes de escribir el lock.
**Warning signs:** `ENOENT` al intentar escribir el lock.

### Pitfall 5: Context Bifurcation Breaks Existing Tests
**What goes wrong:** Los tests existentes de `buildSessionContext` fallan al cambiar la logica del hook.
**Why it happens:** El hook `main()` ahora necesita la propiedad `gsd` en la session para decidir que contexto construir.
**How to avoid:** `buildSessionContext` no cambia -- se anade `buildGsdContext` como funcion adicional. La bifurcacion ocurre en `main()` con un `if (session.gsd)` check. Sessions sin `gsd` property (falsy) siguen el path existente. [VERIFIED: CONTEXT.md D-10 "sesiones existentes sin el campo se tratan como gsd=false"]
**Warning signs:** Tests de `session-start.test.js` existentes fallan tras el cambio.

## Code Examples

### Lock Acquisition Logic (D-07 Complete)
```javascript
// Source: CONTEXT.md D-07, verified with Node 25.9 stdlib
export function acquireGsdLock(projectPath, sessionInfo) {
  const resolved = realpathSync(projectPath);
  const lockPath = join(resolved, LOCK_FILE);
  
  // Case 1: Lock no existe -> crear y adquirir
  if (!existsSync(lockPath)) {
    const content = {
      session_id: sessionInfo.session_id,
      task_id: sessionInfo.task_id,
      task_ref: sessionInfo.task_ref,
      pid: process.pid,
      acquired_at: new Date().toISOString(),
      ttl_hours: DEFAULT_TTL_HOURS,
    };
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(content, null, 2) + '\n');
    return { acquired: true };
  }

  // Read existing lock
  let existing;
  try {
    existing = JSON.parse(readFileSync(lockPath, 'utf-8'));
  } catch {
    // Corrupt lock file — overwrite
    return stealLock(lockPath, sessionInfo, 'corrupt lock file');
  }

  // Case 2: PID muerto -> robar automaticamente
  if (!isPidAlive(existing.pid)) {
    return stealLock(lockPath, sessionInfo, `PID ${existing.pid} dead`);
  }

  // Case 3: PID vivo + TTL expirado -> robar + warn
  const acquiredAt = new Date(existing.acquired_at).getTime();
  const ttlMs = (existing.ttl_hours || DEFAULT_TTL_HOURS) * 3600_000;
  if (Date.now() - acquiredAt > ttlMs) {
    console.error(
      `[kodo:lock] Stealing expired lock from ${existing.task_ref} ` +
      `(acquired ${existing.acquired_at}, TTL ${existing.ttl_hours}h exceeded)`
    );
    return stealLock(lockPath, sessionInfo, 'TTL expired');
  }

  // Case 4: PID vivo + TTL OK -> rechazar
  return { acquired: false, holder: existing };
}
```

### GSD Context Builder (D-01, D-03, D-04)
```javascript
// Source: CONTEXT.md D-01, D-04 (English context)
export function buildGsdContext(session) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    '',
    `You are working on **${session.task_ref}: ${session.summary}**`,
    `- Project path: ${session.project_path}`,
    `- Session ID: ${session.session_id}`,
    `- Work item ID: ${session.task_id} | Project ID: ${session.project_id}`,
    '',
    '## GSD Workflow',
    '',
  ];

  if (session.phase_id) {
    // Phase known — inject plan/execute/verify sequence
    lines.push(
      `This is a GSD session for **phase ${session.phase_id}**.`,
      '',
      'Execute the following commands in order:',
      '',
      `1. \`/gsd-plan-phase ${session.phase_id}\``,
      `2. \`/gsd-execute-phase ${session.phase_id}\``,
      `3. \`/gsd-verify-work\``,
      '',
      'Do NOT comment your plan manually or move the task state — GSD manages the full cycle.',
    );
  } else {
    // No phase — bootstrap mode
    lines.push(
      'No `.planning/` directory detected or no phase resolved for this task.',
      '',
      'Run the bootstrap command:',
      '',
      '1. `/gsd-new-project`',
      '',
      'This will initialize the project planning structure using the task description as brief.',
    );
  }

  return lines.join('\n');
}
```

### Session Record Extension
```javascript
// Source: CONTEXT.md D-10, D-11, D-12
// In buildSessionFromTask — add flags parameter
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags = [] }) {
  return {
    workspace_ref: workspaceRef,
    session_id: sessionId,
    task_id: task.id,
    task_ref: task.ref,
    provider: providerName,
    project_id: task.projectId,
    summary: task.title,
    status: 'running',
    started_at: new Date().toISOString(),
    project_path: projectPath,
    task_url: task.url,
    project_name: task.projectName,
    // Phase 8: GSD fields
    ...(flags.includes('gsd') ? { gsd: true } : {}),
    // Phase 9 will populate phase_id
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Session context siempre generico | Bifurcacion GSD vs generico | Phase 8 | GSD sessions reciben instrucciones de skill invocation en lugar de instrucciones manuales |
| Sin lock de concurrencia | Lock por repo con PID + TTL | Phase 8 | Previene corrupcion de `.planning/` por sesiones concurrentes |
| `inFlight` solo por task_id | `inFlight` por task_id + lock por repo path | Phase 8 | Dos tareas distintas del mismo repo no colisionan |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `writeFileSync` es suficiente (no necesita `O_EXCL` atomico) porque Node event loop serializa dentro del proceso y el lock file cubre entre procesos | Don't Hand-Roll | Si dos procesos kodo distintos corren simultaneamente, podrian tener una race condition de ~microsegundos al escribir el lock. Risk: bajo -- kodo tipicamente es un solo proceso server |
| A2 | TTL de 4h es razonable para sesiones GSD tipicas | Code Examples | Si sesiones GSD toman mas de 4h, el lock se robaria prematuramente. Mitigable ajustando `DEFAULT_TTL_HOURS` |

## Open Questions

1. **Posicion exacta del guard en el dispatcher**
   - What we know: Debe ir despues del inFlight check (D-08). Pero el dispatcher primero resuelve la tarea via provider, luego chequea labels, luego inFlight, luego session-already-active.
   - What's unclear: El guard GSD necesita el `projectPath` resuelto, que actualmente solo se resuelve dentro de `launchWorkItem`. El dispatcher no tiene acceso directo a `projects` map.
   - Recommendation: El guard necesita que el dispatcher resuelva el `projectPath` antes del launch. Opciones: (a) inyectar `resolveProjectPathFn` como dep del dispatcher, (b) mover la resolucion de path al dispatcher antes del launch. Opcion (a) es mas consistente con el patron DI existente.

2. **Donde vive `buildGsdContext`**
   - What we know: Es discretion de Claude (CONTEXT.md). Puede vivir en `session-start.js` o en modulo aparte.
   - Recommendation: En el mismo archivo `session-start.js` por ahora -- es una funcion pura de ~30 lineas, y el archivo actual tiene 137 lineas. Si crece en Phase 9 (mas logica de bootstrap), extraer a `src/gsd/context.js`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node 25.9.0) |
| Config file | none -- uses `node --test test/**/*.test.js` |
| Quick run command | `node --test test/gsd-lock.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GSD-01 | `parseKodoLabels` expone `gsd` en flags; `buildSessionFromTask` setea `gsd: true` | unit | `node --test test/labels.test.js test/manager.test.js` | labels: yes, manager: yes (extend) |
| GSD-04 | `buildGsdContext` genera instrucciones con secuencia de comandos GSD | unit | `node --test test/gsd-context.test.js` | no -- Wave 0 |
| GSD-04 | Hook bifurca entre GSD y generico basandose en `session.gsd` | unit | `node --test test/session-start.test.js` | yes (extend) |
| GSD-10 | `acquireGsdLock` crea lock, rechaza segundo acquire, roba lock muerto | unit | `node --test test/gsd-lock.test.js` | no -- Wave 0 |
| GSD-10 | `releaseGsdLock` borra lock solo si session_id coincide | unit | `node --test test/gsd-lock.test.js` | no -- Wave 0 |
| GSD-10 | Dispatcher rechaza segunda tarea GSD en mismo repo | integration | `node --test test/gsd-concurrency.test.js` | no -- Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/gsd-lock.test.js test/gsd-context.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/gsd-lock.test.js` -- unit tests del modulo lock (acquire, release, steal, TTL)
- [ ] `test/gsd-context.test.js` -- unit tests de `buildGsdContext` (phase known, bootstrap mode)
- [ ] `test/gsd-concurrency.test.js` -- integration test: dos tareas GSD, mismo repo, lock impide segunda

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | -- |
| V3 Session Management | no | -- |
| V4 Access Control | no | -- |
| V5 Input Validation | yes | Validar JSON del lock file al leer (try/catch parse, tratar corrupto como stale) |
| V6 Cryptography | no | -- |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Lock file tampering | Tampering | Lock file en `.planning/` del repo destino -- misma confianza que el codigo fuente. Si alguien puede escribir ahi, ya tiene acceso al repo |
| PID reuse attack | Spoofing | Extremadamente improbable (requiere que el OS reasigne el PID exacto a otro proceso kodo). TTL limita la ventana |
| Lock file symlink attack | Tampering | `realpathSync` resuelve symlinks antes de construir el path del lock |

## Sources

### Primary (HIGH confidence)
- Codebase directo: `src/labels.js`, `src/triggers/dispatcher.js`, `src/session/manager.js`, `src/hooks/session-start.js`, `src/hooks/stop.js`, `src/session/state.js`, `src/logger-events.js` -- todos leidos y analizados
- CONTEXT.md Phase 8 -- decisiones D-01 a D-12 con especificaciones detalladas
- Node.js stdlib -- `process.kill(pid, 0)` verificado en darwin (ESRCH para PID muerto), `realpathSync` verificado (`/tmp` -> `/private/tmp`)
- Test suite existente -- `test/dispatcher.test.js`, `test/session-start.test.js`, `test/stop.test.js` patron DI confirmado

### Secondary (MEDIUM confidence)
- REQUIREMENTS.md -- GSD-01, GSD-04, GSD-10 requirements text

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- todo es Node stdlib, verificado en el entorno
- Architecture: HIGH -- patron DI existente, extension aditiva, codebase completamente leido
- Pitfalls: HIGH -- verificados con pruebas manuales (realpath, kill-0) y analisis del codigo existente

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stack estable, solo stdlib)
