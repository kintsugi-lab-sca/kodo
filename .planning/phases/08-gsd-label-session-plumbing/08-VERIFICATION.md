---
phase: 08-gsd-label-session-plumbing
verified: 2026-04-20T07:07:23Z
status: gaps_found
score: 5/7 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Dos webhooks Plane que resuelven al mismo realpath de repo no arrancan sesiones GSD concurrentes: existe lock por repo con sentinel en .planning/.kodo.lock, verificado por test de integración con dos tareas distintas en paralelo"
    status: partial
    reason: "El lock ADQUIERE correctamente por repo, pero la LIBERACIÓN en producción está rota (CR-01). El dispatcher escribe el lock con session_id='pending-<task.id>' pero stop.js libera con session.session_id que es un randomUUID() generado después en launchWorkItem — nunca coinciden. El lock persiste hasta que expira el TTL de 4h. El test de integración (gsd-concurrency.test.js:136) oculta el bug liberando manualmente con `pending-${task1.id}` en lugar de simular lo que haría el stop hook real."
    artifacts:
      - path: "src/triggers/dispatcher.js"
        issue: "Línea 112: acquireGsdLockFn llamada con session_id: `pending-${task.id}`. El UUID real se genera en manager.js:177 DESPUÉS de que el guard ya corrió."
      - path: "src/hooks/stop.js"
        issue: "Línea 106: releaseGsdLock(session.project_path, session.session_id) usa el UUID real de la sesión, que nunca coincide con 'pending-<task.id>' grabado en el lock."
      - path: "test/gsd-concurrency.test.js"
        issue: "Línea 136: El test 'after lock release' llama releaseGsdLock(repoDir, `pending-${task1.id}`) — usa el synthetic ID que usó el dispatcher, NO el session_id real que usaría el stop hook. El test pasa pero no valida el round-trip de producción."
    missing:
      - "Opción A (preferida): Generar el sessionId (UUID) en el dispatcher ANTES de adquirir el lock y pasarlo a launchWorkItemFn como opts.sessionId. launchWorkItem acepta opts.sessionId opcional y lo usa en lugar de generar uno nuevo. Adquirir con el UUID real, persistir con el UUID real, liberar con el UUID real."
      - "Opción B: Después de launchWorkItem retornar, reescribir el lock con el session_id real de la sesión (self-steal con el nuevo UUID). Requiere un helper dedicado 'rekey' o acquire-overwrite que ignore ownership."
      - "Test de regresión que valide el round-trip completo sin release manual: dispatcher adquiere → stop hook libera con session.session_id → próximo dispatch en el mismo repo tiene éxito."
  - truth: "parseKodoLabels expone 'gsd' en flags cuando la tarea trae label kodo:gsd; el dispatcher propaga el flag a SessionRecord.gsd = true"
    status: failed
    reason: "parseKodoLabels SI produce flags=['gsd'] correctamente para label 'kodo:gsd'. buildSessionFromTask SI propaga gsd:true cuando flags.includes('gsd'). SIN EMBARGO, el campo Session.gsd=true en el registro persistido SOLO sirve para que el stop hook llame releaseGsdLock — y esa liberación está rota por CR-01. La propagación del flag al SessionRecord está implementada correctamente a nivel código, pero el contrato de GSD-01 ('kodo reconoce el modo GSD en el dispatcher') queda parcialmente incumplido porque el lock no se libera, dejando el repo bloqueado para futuros dispatches GSD."
    artifacts:
      - path: "src/triggers/dispatcher.js"
        issue: "El flag gsd llega correctamente al guard (kodoConfig.flags.includes('gsd')) y al launchWorkItemFn (flags: combinedFlags), pero el lock adquirido con pending-ID nunca se libera en producción."
    missing:
      - "Corregir CR-01 (ver gap anterior) para que el flag gsd en SessionRecord implique un lock que efectivamente se libera al terminar la sesión."
deferred: []
human_verification:
  - test: "Verificar que la sesión GSD recibe el contexto correcto al arrancar Claude Code"
    expected: "additionalContext contiene '# kodo KL-XX — GSD Mode', la secuencia de comandos /gsd-plan-phase, /gsd-execute-phase, /gsd-verify-work (con phase_id presente) o /gsd-new-project (sin phase_id), todo en inglés."
    why_human: "buildGsdContext es una función pura testeada, pero la entrega real a Claude Code vía additionalContext requiere ejecutar el hook session-start.js con stdin real y verificar que el JSON de salida es procesado por Claude Code."
---

# Phase 8: GSD Label + Session Plumbing — Verification Report

**Phase Goal:** Una tarea Plane con label `kodo:gsd` atraviesa el dispatcher con el flag GSD propagado hasta la sesión, y dos tareas del mismo repo nunca arrancan sesiones GSD concurrentes.
**Verified:** 2026-04-20T07:07:23Z
**Status:** gaps_found
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `parseKodoLabels` expone `'gsd'` en `flags` cuando la tarea trae label `kodo:gsd` | VERIFIED | `src/labels.js:32` — `result.flags.push(tag)` donde tag='gsd' para 'kodo:gsd'. `parseKodoLabels([{name:'kodo:gsd'}])` produce `{flags:['gsd']}`. |
| 2 | El dispatcher propaga el flag a `SessionRecord.gsd = true` | VERIFIED | `src/session/manager.js:41` — `...(flags?.includes('gsd') ? { gsd: true } : {})`. `launchWorkItem` pasa `flags: combinedFlags` en línea 192. 3 tests en manager.test.js confirman. |
| 3 | El hook `SessionStart` inyecta la secuencia `/gsd-plan-phase <n>` → `/gsd-execute-phase <n>` → `/gsd-verify-work` cuando `session.gsd === true` y `phase_id` presente; inyecta `/gsd-new-project` cuando `phase_id` ausente | VERIFIED | `src/hooks/session-start.js:90-116` — `buildGsdContext` implementa exactamente este bifurcado. Comandos en forma hiphen (D-02). 9 tests en gsd-context.test.js pasan. |
| 4 | El contexto GSD está en inglés y NO incluye instrucciones genéricas en español | VERIFIED | `buildGsdContext` no invoca `buildSessionContext`. No contiene "Estás trabajando", "comenta tu plan", "mcp_hint". Test D-04 y D-03 confirman. |
| 5 | `Session.status` typedef incluye `gsd?: boolean` y `phase_id?: string` | VERIFIED | `src/session/state.js:25-26` — ambos campos opcionales presentes con comentarios de fase. |
| 6 | El lock ADQUIERE correctamente por repo: dos tareas GSD en el mismo repo — la primera adquiere, la segunda recibe `gsd_locked` | VERIFIED | `src/triggers/dispatcher.js:100-121`. Test en gsd-concurrency.test.js confirma comportamiento de adquisición. |
| 7 | El lock se LIBERA correctamente cuando la sesión GSD termina (stop hook) — permitiendo que el siguiente dispatch en el mismo repo tenga éxito sin TTL | FAILED | **CR-01 — Mismatch de session_id:** El lock es adquirido con `session_id: "pending-<task.id>"` (dispatcher.js:112) pero liberado con `session.session_id` (un UUID real, stop.js:106). `releaseGsdLock` compara `existing.session_id === sessionId` y los valores nunca coinciden. El lock persiste hasta expiración de TTL (4h). El test de integración gsd-concurrency.test.js:136 llama manualmente `releaseGsdLock(repoDir, \`pending-${task1.id}\`)` — usa el synthetic ID correcto, ocultando el bug de producción. |

**Score:** 5/7 truths verified (SC-1 y SC-3 parcialmente)

### Requerimientos clave — Análisis de cobertura

| Requirement | Descripción | Status | Evidence |
|-------------|-------------|--------|----------|
| GSD-01 | Usuario puede etiquetar una tarea con `kodo:gsd` y kodo reconoce el modo GSD en el dispatcher | PARTIAL | El flag se reconoce y propaga al SessionRecord. Sin embargo el lock adquirido por el guard no se libera en producción (CR-01), lo que bloquea dispatches GSD futuros en el mismo repo durante hasta 4h. |
| GSD-04 | Sesión GSD recibe contexto inyectado con la secuencia de comandos GSD al arrancar | VERIFIED | `buildGsdContext` implementado y bifurcado correctamente en `main()`. 9 tests pasan. |
| GSD-10 | Dos tareas Plane apuntando al mismo repo no arrancan sesiones GSD concurrentes (lock a nivel de repo) | PARTIAL | El lock previene adquisición concurrente. Pero el mecanismo de liberación está roto — la sesión no puede liberar su propio lock porque el session_id grabado ('pending-<id>') no coincide con el de la sesión real (UUID). Cada sesión GSD exitosa deja un lock huérfano durante 4h. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/gsd/lock.js` | GSD lock acquire/release/isPidAlive/readLock | VERIFIED | 222 líneas. Exports: `acquireGsdLock`, `releaseGsdLock`, `readLock`, `isPidAlive`, `LOCK_FILE`, `DEFAULT_TTL_HOURS`. 4 casos de adquisición + 1 corrupt. |
| `src/session/state.js` | Session typedef con `gsd?` y `phase_id?` | VERIFIED | Líneas 25-26 con ambos campos opcionales. |
| `test/gsd-lock.test.js` | Unit tests para lock module (min 80 líneas) | VERIFIED | 275 líneas, 15 tests pasando. |
| `src/session/manager.js` | `buildSessionFromTask` con flags, `gsd: true` propagado | VERIFIED | Línea 41: conditional spread. Línea 192: `flags: combinedFlags`. |
| `src/triggers/dispatcher.js` | GSD lock guard en dispatch chain con DI | VERIFIED (parcial) | Guard implementado. Adquisición funciona. Liberación rota por CR-01. |
| `test/manager.test.js` | Tests para flags propagation | VERIFIED | 3 tests GSD en describe('GSD flag propagation (D-12)'). 20 tests totales pasando. |
| `test/dispatcher.test.js` | Tests para gsd_locked guard | VERIFIED | 3 tests GSD lock guard. 11 tests totales pasando. |
| `src/hooks/session-start.js` | `buildGsdContext` + bifurcación en main() | VERIFIED | Línea 77: función exportada. Línea 144: ternario `session.gsd`. Comandos en forma hiphen. |
| `src/hooks/stop.js` | `releaseGsdLock` en cleanup chain | VERIFIED (código presente) | Líneas 102-110: guard `if (session.gsd)`, dynamic import, call. El código existe pero es dead code en producción por CR-01. |
| `test/gsd-context.test.js` | Unit tests para buildGsdContext (min 60 líneas) | VERIFIED | 84 líneas, 9 tests pasando. |
| `test/stop.test.js` | Tests de lock release hygiene | VERIFIED | 4 tests de higiene de código. 7 tests totales pasando. |
| `test/gsd-concurrency.test.js` | Integration test concurrencia (min 60 líneas) | VERIFIED (con advertencia) | 198 líneas, 3 tests pasando. El Test 2 oculta CR-01 liberando con el ID sintético en lugar del ID real. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/labels.js` | flags array | `parseKodoLabels` extrae 'gsd' de 'kodo:gsd' | WIRED | `src/labels.js:32`: `result.flags.push(tag)` donde tag='gsd'. |
| `src/triggers/dispatcher.js` | `src/gsd/lock.js` | `acquireGsdLock` llamado en guard chain | WIRED (adquisición) | `dispatcher.js:7` import estático. `dispatcher.js:111` llamada en guard 3b. |
| `src/triggers/dispatcher.js` | `src/gsd/lock.js` | release en stop hook | BROKEN | El lock adquirido con `pending-<id>` nunca puede ser liberado por `session.session_id`. |
| `src/session/manager.js` | `src/session/state.js` | `buildSessionFromTask` retorna Session con `gsd` field | WIRED | `manager.js:41`: conditional spread con `gsd: true`. |
| `src/hooks/session-start.js` | `src/session/state.js` | `session.gsd` boolean check para bifurcación | WIRED | `session-start.js:144`: ternario `session.gsd`. |
| `src/hooks/stop.js` | `src/gsd/lock.js` | dynamic import de `releaseGsdLock` | WIRED (código) / BROKEN (contrato) | `stop.js:105`: dynamic import presente. El call usa `session.session_id` que no coincide con el lock. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/hooks/session-start.js` | `session.gsd` | `findSession()` → state.json → `buildSessionFromTask` con flags | Sí — cuando label 'kodo:gsd' está presente | FLOWING |
| `src/hooks/session-start.js` | `context` | `buildGsdContext(session)` — pure function | Sí — genera contexto GSD en inglés | FLOWING |
| `src/hooks/stop.js` | `session.gsd` | `findSession()` → state.json | Sí — si la sesión fue lanzada con flag gsd | FLOWING |
| `src/hooks/stop.js` | `session.session_id` para release | state.json → `session_id` (UUID real) | Sí, pero no coincide con lo grabado en el lock | HOLLOW — datos reales pero contrato roto |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Lock unit tests (15 tests) | `node --test test/gsd-lock.test.js` | 15 pass / 0 fail | PASS |
| GSD context tests (9 tests) | `node --test test/gsd-context.test.js` | 9 pass / 0 fail | PASS |
| Manager tests (20 tests) | `node --test test/manager.test.js` | 20 pass / 0 fail | PASS |
| Dispatcher tests (11 tests) | `node --test test/dispatcher.test.js` | 11 pass / 0 fail | PASS |
| Stop tests (7 tests) | `node --test test/stop.test.js` | 7 pass / 0 fail | PASS |
| Concurrency integration (3 tests) | `node --test test/gsd-concurrency.test.js` | 3 pass / 0 fail | PASS (con advertencia — Test 2 oculta CR-01) |
| Suite completa | `node --test test/**/*.test.js` | 211 pass / 1 skip / 0 fail (212 total) | PASS |

### Requirements Coverage

| Requirement | Plan(s) | Descripción | Status | Evidence |
|-------------|---------|-------------|--------|----------|
| GSD-01 | 08-02 | kodo reconoce modo GSD: label → dispatcher → SessionRecord.gsd | PARTIAL | Flag se propaga. Lock acquisition funciona. Lock release roto (CR-01). |
| GSD-04 | 08-03 | Sesión GSD recibe contexto con comandos GSD al arrancar | SATISFIED | `buildGsdContext` implementado, bifurcado, testeado. Comandos en hiphen. Inglés. |
| GSD-10 | 08-01, 08-02, 08-04 | Lock por repo, no por tarea — sesiones concurrentes bloqueadas | PARTIAL | Adquisición correcta. Release roto — lock persiste hasta TTL (4h) en happy path. |

**Nota:** GSD-04 en REQUIREMENTS.md usa la forma de colon (`/gsd:plan-phase`) pero CONTEXT.md D-02 decide explícitamente usar la forma hiphen (`/gsd-plan-phase`). La implementación sigue D-02 (hiphen) consistentemente — esto es correcto y esperado.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/triggers/dispatcher.js` | 112 | `session_id: \`pending-${task.id}\`` para lock acquisition | Blocker | Lock adquirido con ID sintético que nunca coincide con el session_id real de la sesión. `releaseGsdLock` en stop.js nunca elimina el archivo. |
| `test/gsd-concurrency.test.js` | 136 | `releaseGsdLock(repoDir, \`pending-${task1.id}\`)` | Blocker | El test valida la adquisición pero simula una liberación con el ID sintético — oculta que la liberación de producción está rota. El test pasa pero no prueba lo que afirma ("after lock release, second task can acquire" — en producción eso requeriría esperar 4h). |

### Human Verification Required

#### 1. Entrega real de contexto GSD a Claude Code

**Test:** Lanzar una sesión kodo con una tarea que tenga label `kodo:gsd` (con o sin `phase_id`), dejar que Claude Code arranque y verificar en la interfaz de Claude Code que el `additionalContext` contiene el bloque GSD.
**Expected:** Encabezado `# kodo KL-XX — GSD Mode`, datos de la tarea, sección `## GSD Workflow`, comandos en forma hiphen (`/gsd-plan-phase`, etc.), todo en inglés.
**Why human:** `buildGsdContext` es una función pura testeada. La entrega via el mecanismo `additionalContext` de Claude Code requiere ejecutar el hook real con stdin del runtime de Claude.

## Gaps Summary

**Se identificaron 2 gaps bloqueantes del mismo root cause — CR-01 (mismatch de session_id en el lock):**

### Gap 1: Lock nunca se libera en el happy path (CR-01)

El dispatcher adquiere el lock con el identificador sintético `pending-<task.id>` porque el UUID real de la sesión no existe aún en ese momento del dispatch chain. El hook stop.js libera con `session.session_id` (el UUID real). `releaseGsdLock` verifica `existing.session_id === sessionId` antes de borrar el lock, y los dos valores nunca coinciden.

**Consecuencia observable en producción:** Cada sesión GSD exitosa deja el lock `.planning/.kodo.lock` en el repo durante ~4 horas. El siguiente intento de lanzar una tarea GSD en el mismo repo retorna `gsd_locked` con el holder siendo la sesión anterior ya terminada, y solo el TTL o la muerte del PID del servidor kodo liberarán el lock.

**El test de integración gsd-concurrency.test.js lo oculta** porque el Test 2 ("after lock release, second task can acquire") llama manualmente `releaseGsdLock(repoDir, \`pending-${task1.id}\`)` usando el synthetic ID que usó el dispatcher — exactamente lo que la función necesita para coincidir — en lugar de simular lo que haría el stop hook real con `session.session_id`.

### Gap 2: GSD-01 queda parcialmente incumplido

El flag `kodo:gsd` SI se propaga correctamente por toda la cadena `parseKodoLabels → dispatcher → buildSessionFromTask → Session.gsd=true`. Pero la promesa completa de GSD-01 ("kodo reconoce el modo GSD en el dispatcher") implica que el sistema puede gestionar el ciclo completo incluyendo liberar el lock al terminar — y eso está roto.

### Solución recomendada (Opción A del REVIEW.md)

Generar el UUID en el dispatcher ANTES de adquirir el lock:

```javascript
// src/triggers/dispatcher.js — en el bloque GSD guard:
import { randomUUID } from 'node:crypto';
// ...
const sessionId = randomUUID();
const lockResult = acquireGsdLockFn(projectPath, {
  session_id: sessionId,  // UUID real, no 'pending-...'
  task_id: task.id,
  task_ref: task.ref,
});
if (!lockResult.acquired) { return { action: 'gsd_locked', holder: lockResult.holder }; }
// Pasar sessionId a launchWorkItem:
const session = await launchWorkItemFn(event.taskRef, { ...launchOpts, sessionId });
```

`launchWorkItem` acepta `opts.sessionId` y lo usa en lugar de generar uno nuevo con `randomUUID()`. El test de concurrencia Test 2 debe actualizarse para llamar `releaseGsdLock(repoDir, session1.session_id)` (UUID real devuelto por launchWorkItem) en lugar del ID sintético.

---

_Verified: 2026-04-20T07:07:23Z_
_Verifier: Claude (gsd-verifier)_
