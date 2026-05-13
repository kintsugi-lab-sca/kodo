# Phase 19: Worktree Cleanup & Integration - Research

**Researched:** 2026-05-12
**Domain:** Git worktree lifecycle + Node.js child_process + Phase 16 LOG-15 DI test patterns
**Confidence:** HIGH (todas las afirmaciones de comportamiento git VERIFIED empíricamente sobre git 2.51.2 / Homebrew arm64; el resto VERIFIED vía lectura directa del código existente y CONTEXT.md)

## Summary

Phase 19 es una phase de **ejecución cuidadosa sobre código existente**, no de descubrimiento técnico. CONTEXT.md ya cerró las 10 decisiones de diseño (D-01..D-10). Esta investigación responde tres preguntas concretas que necesita el planner:

1. **¿Qué fallará y qué no fallará en los comandos git que vamos a llamar?** → Documentado en §"Empirical Git Worktree Behavior" con tablas de exit-codes y stderr observados sobre git 2.51.2. Hallazgo crítico no obvio: **`git worktree move` NATIVO funciona perfectamente sobre worktree dirty** (working tree con cambios staged + unstaged + untracked) en git 2.51.2 — la D-02 fallback "`mv + git worktree repair`" probablemente nunca se ejecutará en este entorno, pero queda como defense-in-depth ante OS/git-version edge cases. Hallazgo secundario: **`git worktree move` con target que YA existe coloca el worktree INSIDE de ese directorio en lugar de fallar** — landmine que el planner debe mitigar con `existsSync` pre-check.

2. **¿Qué orden de operaciones es seguro en `stop.js`?** → Confirmado leyendo `removeSession` (`state.js:127`): YA mueve el record a `state.history` antes de borrar de `state.sessions`. Por tanto el cleanup PUEDE ir antes o después de `removeSession` con tal de que **lea `session.worktree_path` desde la closure local `session` (variable de línea 123)**, no desde un re-fetch de `findSession`. El orden recomendado es **cleanup → removeSession → notify-orchestrator**, para que el nudge enriquecido D-10 pueda referenciar el `moved_to` path en caso dirty.

3. **¿Cuál es el shape exacto de DI para tests y de logger-events?** → `runStopHook(input, deps)` ya admite 4 deps (`findSessionFn`, `removeSessionFn`, `cmux`, `loggerFactory`). Phase 19 añade **una sola dep nueva: `gitFn`** (default `execFileSync` from `node:child_process`). El shape de los 3 helpers `worktreeCleanupOk/Dirty/Error` está modelado verbatim sobre `sessionEnd` (`logger-events.js:103-111`): `logger.info(EVENT_NAME, { event, ...fields })`.

**Primary recommendation:** El planner puede estructurar Phase 19 en **2 plans secuenciales** (NO paralelos):
- **Plan 01** (Wave 1): añadir 3 helpers a `logger-events.js` + extender `EVENTS` con 3 strings nuevas + tests unitarios de los helpers (puro transform, 0 I/O — patrón Phase 6/16 LOG-15).
- **Plan 02** (Wave 2, depends on 01): bloque de cleanup en `stop.js` + 1-line fix en `verify.js:124` + tests E2E con git worktree real (mkdtempSync + git init local, mismo patrón que `skill-auto-commit.test.js`).

Empacar todo en un solo plan también es viable (mismo `git mv` que Phase 18 Plan 18-01 contenido 1 helper + 1 typedef) si el planner prefiere reducir overhead — pero Plan 02 sólo puede empezar cuando Plan 01 está merged, así que el split es claramente más limpio.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Worktree filesystem cleanup | Hooks Layer (`src/hooks/stop.js`) | Session State (lee `worktree_path`) | El stop hook es la única frontera que sabe cuándo termina una sesión; cleanup ahí evita coupling con orchestrator (D-07) |
| Branch cleanup post-remove | Hooks Layer (`src/hooks/stop.js`) | Git CLI (out-of-process) | Sigue el cleanup del worktree; aislamiento de error vía try/catch independiente (D-08 fail-open) |
| Move-aside dirty preservation | Hooks Layer (`src/hooks/stop.js`) | Filesystem (rename) + Git CLI (repair/move) | `git worktree move` nativo es preferido (preserva metadata `.git/worktrees/`); `mv + repair` es defense-in-depth |
| Worktree prune oportunista | Hooks Layer (`src/hooks/stop.js`) | Git CLI | Una invocación por sesión que termina; no-op si no hay zombies; D-04 prohíbe prune retroactivo |
| Verify VERIFICATION.md desde worktree | GSD Layer (`src/gsd/verify.js`) | Session State (lee `worktree_path`) | Cambio de 1 línea en path resolution (D-06); el resto de `runGsdVerify` intacto |
| Auto-commit skill cwd | Orchestrator Hook (`handleOrchestratorStop`) | (sin cambios) | D-05 satisfied-by-design: orchestrator EXCLUIDA de worktree por Phase 18 D-06, cwd ya es repo principal |
| Observabilidad cleanup | Logger Events (`src/logger-events.js`) | NDJSON sink (`src/logger.js`) | 3 helpers nuevos siguiendo taxonomía cerrada (D-10) |

## User Constraints

> Copiado verbatim de `19-CONTEXT.md`. Estas decisiones son LOCKED — el planner NO las re-evalúa.

### Locked Decisions (D-01..D-10 de CONTEXT.md)

- **D-01** "Dirty" = `git status --porcelain` sobre el worktree devuelve output no vacío. SOLO working tree — commits locales no pusheados NO cuentan como dirty (se eliminan junto con el worktree al hacer `git worktree remove`; la branch puede preservarse según D-08). Alineado con la incidencia driver (ROMAN-113…118).
- **D-02** Si el worktree está dirty al stop, se MUEVE a `.bg-shell/<sid>.dirty/` (no se intenta `--force`, no se preserva in-place sin marcar). El `.dirty` suffix es marca visible de "requiere review humano". Log warn con `{ session_id, worktree_path, new_path }`. Detalle del comando exacto (`git worktree move` nativo vs `mv` + `git worktree repair`) lo decide el planner basándose en lo que git acepta sobre un worktree con working tree dirty.
- **D-03** Si `git worktree remove`/`move` falla por razón no-dirty (FS error, git lock interno, race), `console.error` + continuar fail-open. MISMO patrón que `releaseGsdLock`. Sin retry, sin backoff.
- **D-04** `git worktree prune` oportunista al FINAL del cleanup (después de remove/move + branch cleanup). No-op si no hay zombies. NO se hace prune retroactivo en arranque ni en `kodo logs` — solo en el stop hook de cada sesión que termina.
- **D-05** WT-05 = **satisfied-by-design**. `handleOrchestratorStop` sigue con `cwd: KODO_ROOT` porque la orchestrator session está EXCLUIDA de worktree (Phase 18 D-06). Phase 19 NO toca `handleOrchestratorStop` funcionalmente. `KODO_ROOT` env override preservado.
- **D-05b** Si una session-de-trabajo modifica `.claude/skills/kodo-orchestrate/skill.md` dentro de su worktree y termina sin commit, esos cambios caen bajo D-02 (dirty → move-aside). NO se añade un segundo path de auto-commit.
- **D-06** `src/gsd/verify.js` línea 124 cambia de `join(session.project_path, '.planning', 'phases')` a `join(session.worktree_path ?? session.project_path, '.planning', 'phases')`. Cambio quirúrgico (1 línea + JSDoc). Sesiones legacy v0.5 sin `worktree_path` siguen leyendo del repo principal sin warn.
- **D-07** Cleanup vive en `stop.js` después del `releaseGsdLock` y del nudge al orchestrator (justo antes o después de `removeSession` — orden exacto a discreción del planner). El bug latente del verify post-stop es deuda separada, no se resuelve en Phase 19.
- **D-08** Si `git worktree remove` tuvo éxito, también `git branch -D <branch>`. El nombre de la branch se determina con `git -C <worktree> branch --show-current` ANTES del remove. Si `git branch -D` falla → log warn fail-open. NO usar `git branch -d`.
- **D-09** Sesiones sin `session.worktree_path` (legacy v0.5) → stop hook SKIP el cleanup completamente, sin emitir warn ni info.
- **D-10** Eventos dedicados `worktree.cleanup.ok`, `worktree.cleanup.dirty`, `worktree.cleanup.error`, definidos en `src/logger-events.js` siguiendo el patrón de `sessionEnd`. Payload mínimo `{ session_id, worktree_path }` + campo específico por evento. El evento `skipped-legacy` (D-09) se omite intencionalmente.

### Claude's Discretion (areas para que el planner decida)

- Comando concreto para move-aside (`git worktree move` nativo vs `mv` + `git worktree repair`). **Recomendación de research:** probar `git worktree move` primero (validated en git 2.51.2 con dirty worktree, exit 0); fallback `mv + repair` queda como defense-in-depth para git-version edge cases.
- Orden exacto entre `cleanup`, `removeSession`, y `notify orchestrator`. **Recomendación de research:** `cleanup → removeSession → notify`, para que el nudge puede referenciar `moved_to`.
- Determinación del nombre de la branch via `git -C <wt> branch --show-current` pre-remove. Si la branch no existe (caso edge), fail-open silent.
- Inyectar el path del worktree dirty en el nudge del orchestrator — opcional, no requerido.
- Estructura de tests: reuso del patrón Phase 16 `tmpdir+HOME override` + `runStopHook(input, deps)`.

### Deferred Ideas (OUT OF SCOPE — el planner las IGNORA)

- Bug latente `findSession` no busca en `state.history` — independiente de Phase 19, deferir a Phase 21+.
- `kodo gsd doctor` para limpiar zombies pre-existentes — defer a v0.7+.
- Re-evaluar la skill `kodo-orchestrate` documentación si Phase 19 introduce nudge enriquecido.
- Path consistency check en runtime (`worktree_path` persistido vs `computeWorktreePath` canonical).
- Cleanup hook idempotencia explícita — el cleanup ya es naturalmente idempotente.
- `worktree_path` en `kodo logs --session-of` output — cosmético, deferido.
- Auto-commit en sesiones-de-trabajo que toquen `.claude/skills/` — descartado por D-05b.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WT-04 | El `stop` hook hace cleanup del worktree (`git worktree remove`) tras release del lock, fail-open si la sesión dejó cambios sin commitear (log warn, no borrar) | §"Empirical Git Worktree Behavior" valida los exit codes y comportamiento de `git worktree remove`/`move`/`prune`/`branch -D`. Patrón de try/catch fail-open ya establecido en `stop.js` (líneas 197-200 con `releaseGsdLock`). |
| WT-05 | `auto-commit` de la skill `kodo-orchestrate` opera dentro del worktree | **Satisfied-by-design (D-05).** Verified: `handleOrchestratorStop` (`stop.js:238-272`) sigue con `cwd: KODO_ROOT` que es el repo principal — la orchestrator session está EXCLUIDA de worktree por Phase 18 D-06 (`launchOrchestrator` NO pasa `--worktree`). El "dentro del worktree" del ROADMAP se reinterpreta como "el cwd ya es correcto por construcción". El test `test/skill-auto-commit.test.js` ya cubre el behavior; Phase 19 sólo documenta el contrato. |
| WT-06 | `kodo gsd verify` lee `VERIFICATION.md` desde el worktree de la sesión | Cambio de 1 línea: `src/gsd/verify.js:124` — `phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases')`. Sesiones legacy v0.5 sin `worktree_path` siguen leyendo del repo principal (fallback silent, D-09). |

## Project Constraints (from CLAUDE.md)

`CLAUDE.md` global del user (no project-specific instructions added to repo CLAUDE.md beyond what `.planning/codebase/CONVENTIONS.md` ya describe). Aplican estas reglas vinculantes:

- **Sé crítico y revisa propuestas.** No dar la razón siempre. Este RESEARCH.md cuestiona implícitamente la D-02 fallback (probablemente sobre-engineered en git 2.51.2 pero la dejo como defense-in-depth honesta).
- **Piensa antes de codificar.** Asunciones declaradas explícitamente en `## Assumptions Log`.
- **Simplicidad primero.** Phase 19 = 1-line en `verify.js` + 3 helpers de events + un bloque de cleanup. NO factorizar un módulo nuevo `src/hooks/worktree-cleanup.js` (Claude's Discretion del planner: si crece >40 líneas el bloque, extraer; si ≤40, inline en `stop.js`).
- **Cambios quirúrgicos.** NO tocar `handleOrchestratorStop`, NO tocar `runGsdVerify` excepto la línea 124, NO refactorizar el try/catch top-level.
- **Idioma:** docs operativos en ES (este RESEARCH.md está en ES), mensajes al agente/log en EN cuando sea técnico.
- **Estilo Node:** 2 espacios, `@ts-check` en cabecera, JSDoc en exports públicos, no semicolons opcionales pero el repo SÍ usa semicolons (`stop.js:14` lo confirma).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` | stdlib (Node 20+) | `execFileSync` para invocar git | `[VERIFIED: handleOrchestratorStop usa execSync, stop.js:239]` ya consumido por el repo — patrón establecido. `execFileSync` preferido a `execSync` para evitar shell parsing (defense-in-depth contra paths con espacios, aunque UUIDs no los tienen). |
| `node:path` | stdlib | `join` para construir paths | Ya importado en `stop.js:12`. |
| `node:fs` | stdlib | `existsSync` opcional (defense vs target collision de D-02) | Ya consumido transitivamente por `state.js`. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `computeWorktreePath` | (interno) | Derivar path canonical desde `(projectPath, sessionId)` | OPCIONAL en Phase 19 — el path ya está persistido en `session.worktree_path`. Solo usarlo si el planner quiere defense-in-depth check de consistency. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `execFileSync` síncrono | `execFile` async + Promise | Sync alinea con el patrón existente (`handleOrchestratorStop` usa `execSync`). Stop hook ya es síncrono por contrato (Claude Code espera exit code). |
| `git worktree move` nativo | `mv + git worktree repair` | Probar nativo primero (D-02, validated en git 2.51.2). Fallback queda como defense. |
| Inline-Bash `git status --porcelain` | `simple-git` npm dep | Repo NO tiene `simple-git`; añadir dep para 4 comandos git es overkill. Stdlib + `execFileSync` es 0-dep. |

**Installation:** Ningún paquete nuevo. Phase 19 = stdlib + helpers locales.

**Version verification:** N/A — todas las dependencias son stdlib de Node 20+ (engines en `package.json`). Verificable con `node --version` (probable >= 20.x).

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────┐
                          │  Claude Code stop hook payload       │
                          │  { session_id, cwd, transcript_path }│
                          └────────────────┬─────────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────────┐
                          │  runStopHook(input, deps)            │
                          │  src/hooks/stop.js:97                │
                          └────────────────┬─────────────────────┘
                                           │
                          ┌────────────────┴─────────────────────┐
                          │                                      │
                          ▼                                      ▼
              findSessionFn({sessionId, cwd})              not found?
                          │                                      │
                          │  found                               │
                          ▼                                      ▼
              ┌──────────────────────┐               isOrchestratorSession?
              │ cmux.setColor(review)│                       │
              │ cmux.notify()        │                       ▼
              │ sessionEnd(log)      │              handleOrchestratorStop
              └──────────┬───────────┘              (cwd=KODO_ROOT, D-05)
                         │                                  │
                         │ if session.gsd:                  ▼
                         ▼                            (no Phase 19 work)
              ┌──────────────────────┐
              │ markSessionStatus    │
              │ releaseGsdLock       │
              └──────────┬───────────┘
                         │
                         │  ◀══════════════ Phase 19 cleanup block (NEW) ══════════════▶
                         │
                         ▼
              ┌─────────────────────────────────────────────────────────────────────┐
              │ if (session.worktree_path)  // D-09 silent skip si ausente          │
              │                                                                     │
              │   1. branch = gitFn('-C', wtPath, 'branch', '--show-current')       │
              │      (catch → branch=null, fail-open D-08)                          │
              │                                                                     │
              │   2. status = gitFn('-C', wtPath, 'status', '--porcelain')          │
              │      (catch → emit cleanup.error{phase:'status'} + skip)            │
              │                                                                     │
              │   3a. status === ''  (CLEAN):                                       │
              │       gitFn(projectPath, 'worktree', 'remove', wtPath)              │
              │       └─ ok? → gitFn(projectPath, 'branch', '-D', branch)           │
              │              └─ ok?       → branch_deleted=true                     │
              │              └─ fail?     → branch_deleted=false (D-08 fail-open)   │
              │              emit cleanup.ok { branch_deleted }                     │
              │       └─ fail (race, FS err)? → emit cleanup.error{phase:'remove'}  │
              │                                                                     │
              │   3b. status !== ''  (DIRTY):                                       │
              │       newPath = `${wtPath}.dirty`                                   │
              │       if (existsSync(newPath)) newPath += `-${Date.now()}`          │
              │         (defense vs landmine "git worktree move into existing dir") │
              │       gitFn(projectPath, 'worktree', 'move', wtPath, newPath)       │
              │       └─ ok? → emit cleanup.dirty { moved_to: newPath }             │
              │       └─ fail? → fallback: fs.renameSync(wtPath, newPath)           │
              │                  + gitFn(projectPath, 'worktree', 'repair', newPath)│
              │                  └─ all ok? → emit cleanup.dirty + warn             │
              │                  └─ fail?   → emit cleanup.error{phase:'move'}      │
              │                                                                     │
              │   4. gitFn(projectPath, 'worktree', 'prune')  // D-04 oportunista   │
              │      (catch → emit cleanup.error{phase:'prune'} + continue)         │
              └─────────────────────────────────┬───────────────────────────────────┘
                                                │
                                                ▼
                                       removeSessionFn(id)
                                       (moves session to state.history, state.js:131)
                                                │
                                                ▼
                                       cmuxClient.listWorkspaces()
                                       cmuxClient.send(orchestrator,
                                                       buildStopNudgeText(session))
                                                │
                                                ▼
                                            (exit 0)
```

```
                          ┌──────────────────────────────────────┐
                          │  kodo gsd verify <session-id>        │
                          │  src/gsd/verify.js                   │
                          └────────────────┬─────────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────────┐
                          │ findSession({sessionId})             │
                          │ (NOTE: bug latente — solo busca en   │
                          │  state.sessions, no en state.history;│
                          │  deuda separada, NO Phase 19)        │
                          └────────────────┬─────────────────────┘
                                           │
                                           ▼ session = { project_path, worktree_path?, phase_id, … }
                          ┌──────────────────────────────────────┐
                          │ Phase 19 D-06 CHANGE — verify.js:124 │
                          │                                      │
                          │ ANTES:                               │
                          │   phasesRoot = join(                 │
                          │     session.project_path,            │
                          │     '.planning', 'phases')           │
                          │                                      │
                          │ DESPUÉS:                             │
                          │   phasesRoot = join(                 │
                          │     session.worktree_path            │
                          │       ?? session.project_path,       │
                          │     '.planning', 'phases')           │
                          └────────────────┬─────────────────────┘
                                           │
                                           ▼
                          ┌──────────────────────────────────────┐
                          │ readdirSync(phasesRoot)              │
                          │ find phase dir, read VERIFICATION.md │
                          │ → computeVerdict → addComment → …    │
                          │ (resto del flow INTACTO)             │
                          └──────────────────────────────────────┘
```

### Recommended Project Structure

NO se crea estructura nueva. Phase 19 toca **3 archivos source** + **2-3 archivos test**:

```
src/
├── hooks/
│   └── stop.js                  # MODIFY: add cleanup block after releaseGsdLock
├── gsd/
│   └── verify.js                # MODIFY: 1 line (phasesRoot fallback)
├── logger-events.js             # MODIFY: add 3 helpers + extend EVENTS
└── session/
    └── state.js                 # READ-ONLY: import computeWorktreePath if needed

test/
├── stop.test.js                 # MODIFY: source-hygiene asserts (grep guards)
├── stop-worktree-cleanup.test.js   # NEW: E2E tests with real git worktree
├── gsd-verify-integration.test.js  # MODIFY: extend fixtures (worktree vs legacy)
└── logger-events.test.js        # MODIFY: add tests for 3 new helpers
```

### Pattern 1: Try/Catch Fail-Open Por Bloque

**What:** Cada operación I/O en `stop.js` vive en su propio `try/catch` que silencia el error y continúa. El catch top-level (`stop.js:219-221`) es defense-in-depth, no la barrera primaria.

**When to use:** TODO el cleanup de Phase 19. Cada uno de los siguientes pasos es un try/catch independiente:
1. `git branch --show-current` (lee branch name) — falla → branch=null, continúa.
2. `git status --porcelain` (dirty check) — falla → emit error event + skip cleanup, continúa.
3. `git worktree remove` o `git worktree move` — falla → emit error event, continúa.
4. `git branch -D` — falla → emit ok event con `branch_deleted=false`, continúa.
5. `git worktree prune` — falla → emit error event, continúa.

**Example (canonical pattern from `stop.js:195-200`):**

```javascript
// Source: src/hooks/stop.js:195-200 (releaseGsdLock pattern)
try {
  const { releaseGsdLock } = await import('../gsd/lock.js');
  releaseGsdLock(session.project_path, session.session_id);
} catch (err) {
  console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
}
```

Aplicar el mismo shape para cada paso del cleanup. `[CITED: stop.js:195-200]`

### Pattern 2: Eventos NDJSON Tipados (logger-events.js)

**What:** Cada nuevo evento del cleanup tiene un helper exportado en `logger-events.js` que envuelve `logger.info(EVENT_NAME, { event, ...fields })`. El helper es pure-transform, sin I/O.

**When to use:** Los 3 eventos D-10 (`worktree.cleanup.ok`, `worktree.cleanup.dirty`, `worktree.cleanup.error`).

**Example (verbatim shape de `sessionEnd`):**

```javascript
// Source: src/logger-events.js:103-111 (sessionEnd pattern, EXACT TEMPLATE for new helpers)
export function sessionEnd(logger, fields) {
  logger.info(EVENTS.SESSION_END, {
    event: EVENTS.SESSION_END,
    session_id: fields.session_id,
    task_id: fields.task_id,
    status: fields.status,
    ended_at: fields.ended_at,
  });
}
```

**Recommended Phase 19 shape (copy verbatim):**

```javascript
// New EVENTS entries (extend the Object.freeze block in logger-events.js:30-39):
WORKTREE_CLEANUP_OK:    'worktree.cleanup.ok',
WORKTREE_CLEANUP_DIRTY: 'worktree.cleanup.dirty',
WORKTREE_CLEANUP_ERROR: 'worktree.cleanup.error',

/**
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, branch_deleted: boolean }} fields
 */
export function worktreeCleanupOk(logger, fields) {
  logger.info(EVENTS.WORKTREE_CLEANUP_OK, {
    event: EVENTS.WORKTREE_CLEANUP_OK,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    branch_deleted: fields.branch_deleted,
  });
}

/**
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, moved_to: string }} fields
 */
export function worktreeCleanupDirty(logger, fields) {
  logger.warn(EVENTS.WORKTREE_CLEANUP_DIRTY, {
    event: EVENTS.WORKTREE_CLEANUP_DIRTY,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    moved_to: fields.moved_to,
  });
}

/**
 * @param {Logger} logger
 * @param {{ session_id: string, worktree_path: string, phase: 'remove'|'move'|'branch'|'prune'|'status', reason: string }} fields
 */
export function worktreeCleanupError(logger, fields) {
  logger.error(EVENTS.WORKTREE_CLEANUP_ERROR, {
    event: EVENTS.WORKTREE_CLEANUP_ERROR,
    session_id: fields.session_id,
    worktree_path: fields.worktree_path,
    phase: fields.phase,
    reason: fields.reason,
  });
}
```

Nivel de log:
- `ok` → `info` (mismo que `sessionEnd`).
- `dirty` → `warn` (mismo que `orchestratorReview` cuando verdict !== 'approved': "warn para espejar a stderr también", `logger-events.js:131`).
- `error` → `error` (mismo que `planeApiCallFailed`, `logger-events.js:199`).

### Pattern 3: DI vía `runStopHook(input, deps)`

**What:** `runStopHook` ya admite `deps = { findSessionFn, removeSessionFn, cmux, loggerFactory }`. Phase 19 añade una sola dep: `gitFn` (default `execFileSync` from `node:child_process`).

**Shape recomendado:**

```javascript
// Extension to runStopHook signature
/**
 * @param {{session_id: string, cwd?: string, transcript_path?: string}} input
 * @param {{
 *   findSessionFn?: typeof findSession,
 *   removeSessionFn?: typeof removeSession,
 *   cmux?: typeof cmux,
 *   loggerFactory?: (binding: {session_id: string, task_id: string}) => any,
 *   gitFn?: (cwd: string, args: string[]) => { stdout: string, status: number } | string,
 *   fs?: { existsSync: typeof existsSync, renameSync: typeof renameSync },
 * }} [deps]
 */
```

**Default implementación:**

```javascript
const gitFn = deps.gitFn || ((cwd, args) => {
  const { execFileSync } = require('node:child_process'); // o import dinámico
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
});
```

**Tests inyectan stub:**

```javascript
const gitCalls = [];
const gitFnStub = (cwd, args) => {
  gitCalls.push({ cwd, args });
  if (args[0] === 'status') return ''; // CLEAN path
  if (args[0] === 'branch' && args[1] === '--show-current') return 'session-abc';
  return '';
};
```

`[CITED: stop.js:97-101 — runStopHook DI signature]`

### Anti-Patterns to Avoid

- **NO usar `execSync(string)` con concatenación**. Aunque `handleOrchestratorStop:258` lo usa (precedent), Phase 19 debe preferir `execFileSync('git', [...args])` para que tests con `gitFn` stub no tengan que parsear shell strings. `[ASSUMED]` — el precedent es lo bastante fuerte como para que `execSync` también sea aceptable; el planner decide.
- **NO emitir state.transition desde el cleanup.** El status de la sesión NO cambia por el cleanup; el state.transition canonical ya se emite en `markSessionStatus(... 'done' ...)` (líneas 188-193 de `stop.js`). Añadir otro transition rompe Phase 16 LOG-15 D-04.
- **NO mover `removeSession` para que dependa del resultado del cleanup.** `removeSession` (`state.js:127`) ya mueve el record a `state.history` — un cleanup failed NO debe bloquear la limpieza del state.json. Fail-open en todas las direcciones.
- **NO usar `git worktree remove --force` para borrar dirty.** Viola D-01/D-02 (datos perdidos = incidencia driver ROMAN-113…118). El `--force` SOLO sería válido en el path post-`move` si el move dejó el directorio en estado raro, pero ningún test empírico mostró ese caso.
- **NO leer `branch --show-current` DESPUÉS del remove.** Ya no hay worktree → `git -C <path>` falla. Lectura SIEMPRE antes del remove (D-08).
- **NO ejecutar `git worktree prune` con `--expire`.** El default (sin `--expire`) borra solo entries con directorio inexistente — comportamiento exacto que pide D-04. `--expire 1.hour.ago` añade ventana temporal innecesaria.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Detectar "dirty" en un worktree | Parsear `git diff` o `git ls-files` | `git status --porcelain` (D-01) | `--porcelain` está diseñado para script-parsing; output vacío = clean, no-vacío = dirty. Cubre untracked + staged + unstaged + conflicts en un solo comando. |
| Borrar un worktree | `rm -rf <path>` | `git worktree remove <path>` | `rm -rf` deja zombie en `.git/worktrees/<name>/`; `git worktree remove` actualiza ambos. |
| Mover un worktree dirty | `mv` + manual edit de `.git/worktrees/<name>/gitdir` | `git worktree move <src> <dst>` (validated en git 2.51.2) | `git worktree move` actualiza `gitdir` pointer atómicamente. **Empíricamente PASA sobre dirty** (`git worktree move` exit 0 sobre WT con staged+unstaged+untracked). |
| Recovery de worktree con dir desaparecido | Manual edit de `.git/worktrees/` | `git worktree prune` | Borra entries cuyo `gitdir` apunta a path inexistente. Empíricamente: cuando se hace `rm -rf` del directorio del worktree, `git worktree remove` SOBRE el path inexistente devuelve exit 0 (limpia entry); `git worktree prune` hace lo mismo. |
| Determinar nombre de branch del worktree | Convención (asumir `claude-<session-id>` o similar) | `git -C <worktree> branch --show-current` | Claude CLI elige el nombre; kodo NO debe asumir convención. La lectura es O(1) y robusta. **Empíricamente validated:** desde dentro del worktree devuelve el nombre correcto; desde el repo principal devuelve `main`. |
| Borrar branch que está checked out por un worktree | `git branch -D` antes del `worktree remove` | Order obligatorio: `worktree remove` → `branch -D` | **Empíricamente:** `git branch -D <branch>` falla con exit 1 + `error: cannot delete branch 'X' used by worktree at ...` si el worktree todavía existe. Orden D-08 (remove primero, branch después) es OBLIGATORIO, no opcional. |

**Key insight:** Git ya tiene primitivas correctas para todo lo que Phase 19 necesita. El "hand-rolling" tentador es manejar `.git/worktrees/<name>/` directamente, pero eso es frágil entre versiones de git y rompe en macOS vs Linux. Stick con la CLI.

## Runtime State Inventory

> Phase 19 NO es un rename/refactor de strings. ES un refactor de lifecycle. Aplico el inventario porque toca filesystem y eventos.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None.** El cleanup NO muta `~/.kodo/state.json` (eso lo hace `removeSession` ya existente). El cleanup tampoco escribe a `~/.kodo/logs/` directamente — los eventos van vía `logger.info` que el sink NDJSON maneja. | Ninguna acción de migración. |
| Live service config | **None.** kodo no tiene servicios externos con configuración. cmux workspace state es transient. | Ninguna acción. |
| OS-registered state | **`.git/worktrees/<name>/` entries** dentro del repo principal. Cada worktree creado por `claude --worktree <sessionId>` (Phase 18) deja una entry aquí. Phase 19 las limpia vía `git worktree remove` (clean) o las preserva vía `git worktree move` (dirty). **Pre-Phase-19 zombies:** worktrees creados antes del deploy de Phase 19 quedan huérfanos en `.git/worktrees/` y `.bg-shell/`. D-04 prune oportunista los limpia incidentalmente cuando otra sesión termina. | El `git worktree prune` oportunista (D-04) limpia entries huérfanas incidentalmente. NO se hace migración retroactiva (D-04 lo prohíbe). Cualquier limpieza retroactiva queda como `kodo gsd doctor` futuro (deferred). |
| Secrets/env vars | **`KODO_ROOT`** sigue siendo el env override para tests; Phase 19 lo preserva idéntico (D-05). **`KODO_LOG_LEVEL`** sigue siendo consumido por el loggerFactory default; no cambia. | Ninguna acción — preservado. |
| Build artifacts | **None.** kodo se distribuye como `bin/kodo` shell script + `src/` ESM modules. No hay artifacts compilados. | Ninguna acción. |

**Pre-Phase-19 zombies (clarificación):**
- Antes de Phase 18, no había worktrees → 0 zombies posibles.
- Después de Phase 18 (deploy hace pocas horas) pero antes de Phase 19: si el dev ha lanzado sesiones que han terminado, hay `.bg-shell/<uuid>/` directories y `.git/worktrees/<name>/` entries acumulándose.
- Phase 19 D-04 los limpia cuando una NUEVA sesión termina (prune oportunista). Ninguna acción retroactiva.

## Common Pitfalls

### Pitfall 1: `git worktree move` silent-coerces target into existing directory

**What goes wrong:** Si el target del move (`<wt>.dirty/`) ya existe (porque hubo colisión UUID o porque alguien creó manualmente ese directorio), `git worktree move` NO falla — coloca el worktree DENTRO de ese directorio. Resultado: worktree termina en `.bg-shell/sess-x.dirty/sess-x/` en lugar de `.bg-shell/sess-x.dirty/`.

**Why it happens:** [VERIFIED empíricamente sobre git 2.51.2 — ver §Empirical Git Worktree Behavior, Test 3] git documenta el comportamiento como "if destination is an existing directory, the worktree is placed inside" pero el man page no lo destaca.

**How to avoid:**
- `existsSync` pre-check del target ANTES de invocar `git worktree move`.
- Si target existe, generar variante: `<wt>.dirty-<timestamp>` o `<wt>.dirty-<short-random>`.
- Documentar el pre-check inline con cita de este pitfall.

**Warning signs:** Tests E2E que verifican el shape final del path post-cleanup (assert `existsSync(`${wt}.dirty`)` Y assert el contenido) deben fallar si el bug ocurre.

### Pitfall 2: Branch read after worktree remove fails silently

**What goes wrong:** Si el planner invierte el orden y lee `git -C <wt> branch --show-current` DESPUÉS de `git worktree remove`, git devuelve exit 128 (no es worktree). El catch fail-open lo silencia → la branch nunca se borra y queda zombie indefinida en el repo principal.

**Why it happens:** `git -C <path>` requiere que el path exista como worktree para resolver `--show-current`.

**How to avoid:** Estricto orden D-08:
1. Read branch name (`git -C <wt> branch --show-current`) → store local.
2. Read dirty status (`git -C <wt> status --porcelain`) → branch CLEAN/DIRTY.
3. Si CLEAN: `git worktree remove <wt>` → `git branch -D <stored_branch>`.

**Warning signs:** Después de cleanup ok, `git branch | grep <session-id>` debería devolver 0 matches. Source-hygiene test: regex sobre `stop.js` confirma que `branch --show-current` aparece ANTES de `worktree remove` (offset check).

### Pitfall 3: `git branch -D` con la branch checked-out por OTRO worktree

**What goes wrong:** Caso raro pero posible — colisión UUID (prob ~0 pero el código defensivo importa) o bug donde dos sesiones acaban con la misma branch. `git branch -D <X>` falla con `error: cannot delete branch 'X' used by worktree at <other_path>` (verified empíricamente).

**Why it happens:** Git protege branches checked-out por otros worktrees.

**How to avoid:** Catch del error en el branch-delete block. Log warn con el path del otro worktree (lo trae el stderr). NO retry, NO force con `--force` (git no lo acepta para branches in-use anyway).

**Warning signs:** Evento `worktree.cleanup.ok` con `branch_deleted: false` y stderr de `[kodo:stop]` indicando "cannot delete branch". Si se vuelve frecuente, indica un bug arquitectural.

### Pitfall 4: Race condition entre `cmux` agent terminando y el stop hook

**What goes wrong:** El stop hook se lanza cuando Claude Code termina la sesión. Si cmux todavía tiene file handles abiertos sobre archivos en el worktree (improbable porque el agente ya cerró), el `rm -rf` interno de `git worktree remove` puede fallar con `EBUSY` en macOS/Linux (raro en macOS, más en Linux).

**Why it happens:** Procesos backround dejan FDs abiertos transients.

**How to avoid:** Try/catch fail-open (D-03). Si falla, emit `cleanup.error{phase:'remove'}` y deja el worktree zombie. El próximo `prune` oportunista no lo recupera (worktree dir todavía existe + entry todavía válida) pero los logs lo documentan para review.

**Warning signs:** Evento `worktree.cleanup.error{phase:'remove', reason:'EBUSY...'}` frecuente. Mitigación futura: backoff retry o `setTimeout` antes del remove, pero por ahora deuda observable.

### Pitfall 5: Double-stop hook (cmux retry, manual replay)

**What goes wrong:** Claude Code puede invocar el stop hook 2 veces (cmux retry on SIGPIPE, manual replay durante dev). Primera invocación borra el worktree, segunda intenta borrarlo otra vez → `git worktree remove` exit 128 con `fatal: <path> no es un árbol de trabajo`.

**Why it happens:** El cleanup no es idempotente en términos de exit codes — pero SÍ en términos de efecto (la segunda llamada es no-op porque el worktree ya no existe).

**How to avoid:** El find a session también falla (la primera invocación llamó `removeSession`, la segunda no encuentra). El cleanup nunca corre la segunda vez porque está dentro de `if (result)` (`stop.js:110-121`).

**Warning signs:** Logs muestran `[kodo:stop] No matching session found` en el replay — comportamiento esperado, no action needed.

### Pitfall 6: `worktree_path` persistido inconsistente con `computeWorktreePath` canonical

**What goes wrong:** Caso degenerado: el `worktree_path` persistido en state.json fue computado con un `projectPath` diferente al actual (ej. el repo se movió en disco). Cleanup invoca `git worktree remove` sobre el path persistido pero el worktree real está en otro sitio.

**Why it happens:** Drift entre persistencia y runtime. Improbable pero no imposible.

**How to avoid:**
- Phase 19 PUEDE añadir consistency check defensivo: `if (computeWorktreePath(session.project_path, session.session_id) !== session.worktree_path) emit warn`. CONTEXT.md marca esto como Claude's Discretion ("Path consistency check en runtime"). Recomendación: NO añadirlo en Phase 19 — añade complejidad sin caso de uso real. Deferir a observabilidad.

**Warning signs:** Manualmente: `kodo logs --session-of` debería mostrar paths consistentes; cualquier drift visible en review post-incidente.

## Code Examples

### Operation 1: Dirty check + decision

```javascript
// Source: synthesized from src/hooks/stop.js patterns + empirical git verification
// Goal: determine if worktree is dirty per D-01

const status = gitFn(session.project_path, ['-C', session.worktree_path, 'status', '--porcelain']);
const isDirty = status.length > 0;
```

### Operation 2: Branch name read (D-08)

```javascript
// Source: empirical verification (Test 7 of Empirical Git Worktree Behavior)
// Goal: get the branch claude --worktree created, BEFORE worktree remove

let branchName = null;
try {
  branchName = gitFn(session.project_path, ['-C', session.worktree_path, 'branch', '--show-current']);
} catch (err) {
  // Branch read failed (worktree gone? detached HEAD?) — log warn, continue with branchName=null
  console.error(`[kodo:stop] branch read failed: ${err.message}`);
}
```

### Operation 3: Clean cleanup path

```javascript
// Source: synthesized
// Goal: worktree clean → remove + branch delete + prune

try {
  gitFn(session.project_path, ['worktree', 'remove', session.worktree_path]);
  let branchDeleted = false;
  if (branchName) {
    try {
      gitFn(session.project_path, ['branch', '-D', branchName]);
      branchDeleted = true;
    } catch (err) {
      console.error(`[kodo:stop] branch -D ${branchName} failed: ${err.message}`);
    }
  }
  worktreeCleanupOk(log, {
    session_id: session.session_id,
    worktree_path: session.worktree_path,
    branch_deleted: branchDeleted,
  });
} catch (err) {
  worktreeCleanupError(log, {
    session_id: session.session_id,
    worktree_path: session.worktree_path,
    phase: 'remove',
    reason: err.message,
  });
}
```

### Operation 4: Dirty move-aside

```javascript
// Source: synthesized (D-02 + Pitfall #1 mitigation)
// Goal: dirty worktree → move to .dirty/ suffix, fallback to mv + repair

let newPath = `${session.worktree_path}.dirty`;
// Pitfall #1 mitigation: target collision
if (existsSync(newPath)) {
  newPath = `${session.worktree_path}.dirty-${Date.now()}`;
}

try {
  gitFn(session.project_path, ['worktree', 'move', session.worktree_path, newPath]);
  worktreeCleanupDirty(log, {
    session_id: session.session_id,
    worktree_path: session.worktree_path,
    moved_to: newPath,
  });
} catch (err) {
  // Fallback D-02: native move rejected (older git? OS edge?) → mv + repair
  try {
    renameSync(session.worktree_path, newPath);
    gitFn(session.project_path, ['worktree', 'repair', newPath]);
    worktreeCleanupDirty(log, {
      session_id: session.session_id,
      worktree_path: session.worktree_path,
      moved_to: newPath,
    });
  } catch (err2) {
    worktreeCleanupError(log, {
      session_id: session.session_id,
      worktree_path: session.worktree_path,
      phase: 'move',
      reason: `${err.message} | fallback: ${err2.message}`,
    });
  }
}
```

### Operation 5: Opportunistic prune

```javascript
// Source: synthesized (D-04)
// Goal: clean up zombies oportunistically — no-op if nothing to prune

try {
  gitFn(session.project_path, ['worktree', 'prune']);
} catch (err) {
  worktreeCleanupError(log, {
    session_id: session.session_id,
    worktree_path: session.worktree_path,
    phase: 'prune',
    reason: err.message,
  });
}
```

### Operation 6: verify.js D-06 change (1 line)

```javascript
// Source: src/gsd/verify.js:124 (Phase 19 D-06)

// ANTES:
const phasesRoot = join(session.project_path, '.planning', 'phases');

// DESPUÉS:
const phasesRoot = join(session.worktree_path ?? session.project_path, '.planning', 'phases');
```

JSDoc update:
```javascript
// Add note in function header comment:
//   - phasesRoot lee desde session.worktree_path (Phase 19 D-06) o fallback a
//     session.project_path para sesiones legacy v0.5 sin el campo (D-09).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Worktrees acumulándose indefinidamente en `.bg-shell/` | Cleanup en stop hook fail-open | Phase 19 (this phase) | Resuelve la deuda dejada por Phase 18 |
| `git worktree remove --force` para forzar dirty | `git worktree move` nativo → `.dirty/` preservation | Phase 19 D-02 | Preserva trabajo no committed (driver: incidencia ROMAN-113…118) |
| `git worktree move` rechaza dirty (creencia común pre-research) | `git worktree move` ACEPTA dirty en git 2.51.2 (empíricamente validated) | git 2.18+ probablemente, no documentado claramente | El fallback "mv + repair" raramente se ejecutará |
| Verify lee VERIFICATION.md del repo principal | Verify lee del worktree con fallback (D-06) | Phase 19 (this phase) | Habilita el flow correcto cuando el agente escribe VERIFICATION.md DENTRO de su worktree |

**Deprecated/outdated:**
- Suposición de Phase 18 D-03c original: "tests legacy v0.5 testean comportamiento sin `worktree_path` activamente". Realidad: el fallback D-09 + D-06 hacen que sesiones legacy sigan funcionando idénticas a v0.5 sin código adicional — el patrón aditivo opcional ya cubre el case.

## Empirical Git Worktree Behavior

> **Setup:** git 2.51.2 (Homebrew arm64 / macOS Darwin 25.4.0). Throwaway repo creado con `git init` + 1 commit. Todos los tests ejecutados secuencialmente; cleanup vía `git worktree remove --force` al final. `[VERIFIED: research session 2026-05-12 ~12:53 GMT+2]`

### Test 1: clean worktree remove + branch delete

| Operation | Command | Exit | Observations |
|-----------|---------|------|--------------|
| Create worktree | `git worktree add ./.bg-shell/sess-clean -b session-clean` | 0 | Creates branch `session-clean`, populates `.git/worktrees/sess-clean/` |
| Remove clean | `git worktree remove ./.bg-shell/sess-clean` | 0 | Removes dir AND entry. Branch `session-clean` SURVIVES (not auto-deleted). |
| `git branch -D session-clean` | (above) | 0 | OK after remove. |

**Conclusion:** Clean path is straightforward. D-08 order (remove → branch -D) is correct.

### Test 2: dirty worktree (untracked) — remove vs move

| Operation | Command | Exit | stderr |
|-----------|---------|------|--------|
| Create worktree + add untracked file | `git worktree add ./.bg-shell/sess-dirty -b session-dirty`, then `echo > dirty.txt` | 0 | — |
| `git status --porcelain` | (inside wt) | 0 | `?? dirty.txt` (non-empty) → DIRTY per D-01 |
| `git worktree remove` (no `--force`) | `git worktree remove ./.bg-shell/sess-dirty` | **128** | `fatal: './.bg-shell/sess-dirty' contiene archivos modificados o no rastreados, usa --force para borrarlo` |
| `git worktree move <dirty>` | `git worktree move ./.bg-shell/sess-dirty ./.bg-shell/sess-dirty.dirty` | **0** | — (silent success!) |

**Conclusion:** **HALLAZGO CRÍTICO** — `git worktree move` acepta dirty worktree en git 2.51.2. El fallback D-02 "mv + repair" probablemente no se ejecuta en este entorno.

### Test 2b: dirty (modified tracked file)

| Operation | Command | Exit | Observations |
|-----------|---------|------|--------------|
| Create + modify tracked file | `git worktree add ...`, then `echo >> file.txt` | 0 | `git status --porcelain` → ` M file.txt` |
| `git worktree move` | `git worktree move <src> <dst>.dirty` | **0** | Modified content preserved post-move (`git status --porcelain` in new path still shows ` M file.txt`) |

### Test 2c: heavily dirty (staged + unstaged + untracked)

| Operation | Result |
|-----------|--------|
| `git worktree move <heavy> <heavy>.dirty` | exit 0; post-move `git status --porcelain` preserves ` M file.txt\nA  staged.txt\n?? untracked.txt` |

**Conclusion:** `git worktree move` is robust over dirty state for ALL types of changes.

### Test 3: target directory ALREADY EXISTS — LANDMINE

| Operation | Command | Exit | Result |
|-----------|---------|------|--------|
| Pre-create blocker dir | `mkdir -p ./.bg-shell/blocker; echo > .bg-shell/blocker/x.txt` | 0 | Blocker exists with content |
| Move to existing dir | `git worktree move <wt> ./.bg-shell/blocker` | **0 (silent)** | **Worktree placed INSIDE `blocker/sess-conflict/` — NOT at `blocker/`** |

**Conclusion:** **MAJOR LANDMINE.** Confirms Pitfall #1. Phase 19 MUST `existsSync` pre-check the target before `git worktree move`.

### Test 4: branch -D edge cases

| Operation | Command | Exit | stderr |
|-----------|---------|------|--------|
| Delete branch in-use by another worktree | `git branch -D session-bx` (while wt active) | **1** | `error: cannot delete branch 'session-bx' used by worktree at <path>` |
| Delete non-existent branch | `git branch -D nonexistent-branch` | **1** | `error: branch 'nonexistent-branch' not found` |
| Delete branch after worktree removed | `git worktree remove ...; git branch -D session-bx` | **0** | (silent — `Eliminada la rama session-bx (era <sha>)`) |

**Conclusion:** Both error cases must be caught fail-open. D-08 order (remove → branch -D) is the ONLY working order for clean cleanup.

### Test 5: `git worktree prune` semantics

| Setup | Command | Exit | Observation |
|-------|---------|------|-------------|
| Delete worktree directory manually (`rm -rf`) | `git worktree list` shows `prunable` annotation | — | Entry persists |
| `git worktree prune --verbose` | (above setup) | **0** | `Eliminando worktrees/<name>: archivo gitdir apunta a una ubicación inexistente` |
| `git worktree prune --verbose` again (now no-op) | — | **0** | (silent no-op) |
| Active worktrees | (all unaffected) | — | prune touches ONLY entries with missing gitdir |

**Conclusion:** D-04 prune oportunista es seguro y no-op cuando no hay zombies. **NO afecta worktrees activos.**

### Test 6: remove idempotency

| Operation | Exit | Stderr |
|-----------|------|--------|
| `git worktree remove <non-existent>` | **128** | `fatal: '<path>' no es un árbol de trabajo` |
| `git worktree remove <removed_once_then_again>` | **128** | `fatal: '<path>' no es un árbol de trabajo` |
| `git worktree remove <rm-rf'd_dir>` (where dir was deleted manually but entry remains) | **0** | (silent — auto-prunes the entry) |

**Conclusion:** Idempotency is NOT exit-0 — second remove returns 128. But the second invocation never happens in practice because `findSession` won't find the session twice (Pitfall #5). The `rm -rf` recovery case returns 0, which is convenient.

### Test 7: branch --show-current from worktree

| Where | Command | Output |
|-------|---------|--------|
| In main repo | `git branch --show-current` | `main` |
| In worktree | `git -C ./.bg-shell/sess-x branch --show-current` | `sess-x` (when claude --worktree <sessionId> creates branch with sessionId) |

**Conclusion:** D-08 read pattern via `-C <wt> branch --show-current` works. The branch name claude creates equals the `<sessionId>` arg in `claude --worktree <sessionId>` per Phase 18 D-01 — but the kodo code reads it dynamically (D-08), so this is contract-stable even if claude changes its naming.

### Test 8: rm-rf'd worktree dir — git worktree remove

| Operation | Command | Exit | Observation |
|-----------|---------|------|-------------|
| `rm -rf <wt_dir>` | — | — | Entry persists with `prunable` annotation |
| `git worktree remove <wt_dir>` (dir gone) | **0** | (silent — auto-prunes entry) |
| `git worktree remove --force <wt_dir>` (already pruned) | **128** | `fatal: <path> no es un árbol de trabajo` |
| Post-remove: `git branch \| grep sess-rm` | — | Branch SURVIVES; needs explicit `git branch -D` |

**Conclusion:** Race-recovery (worktree dir deleted by external process) is handled gracefully by `git worktree remove` exit 0. The branch still needs explicit deletion.

### Test 9: absolute vs relative paths + cross-cwd invocation

| Pattern | Exit | Observation |
|---------|------|-------------|
| `git worktree remove <relative_path>` (from repo root) | 0 | Works |
| `git worktree remove <absolute_path>` (from repo root) | 0 | Works |
| `git -C <projectPath> worktree remove <absPath>` (from `/tmp`, totally different cwd) | 0 | **Works.** `-C` rebases git's working dir; the wt path is absolute so resolution is unambiguous. |

**Conclusion:** kodo's invocation pattern (Phase 19 will call from stop hook, which runs from claude's cwd which is the worktree — but with `-C <projectPath>` redirect) is correct. `session.worktree_path` is already absolute (computed via `path.join` from absolute `projectPath`).

### Test 10: `git worktree move` with non-existent source

| Operation | Exit | Stderr |
|-----------|------|--------|
| `git worktree move <non-existent-src> <dst>` | **128** | `fatal: '<path>' no es un árbol de trabajo` |

**Conclusion:** Source must exist as worktree. If both `status --porcelain` read succeeded AND we're trying to move, the source DOES exist (trust-by-construction). If status read failed, we skip the cleanup entirely (`cleanup.error{phase:'status'}`), so move never attempts on non-existent source.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `execFileSync` es preferible a `execSync` en el cleanup block | Standard Stack > Core; Anti-Patterns | Si el planner prefiere `execSync` (precedent en `handleOrchestratorStop:258`), los tests inyectan stub que parsea shell string en lugar de `(cwd, args)`. Trade-off cosmético; ambos funcionan. |
| A2 | Claude CLI nombra la branch igual que el `<sessionId>` arg | Empirical Test 7; D-08 | El planner NO depende de esto — el código lee la branch via `git -C <wt> branch --show-current` (D-08). La asunción solo importa para entender por qué la branch existe. Si claude cambia su naming en el futuro, el código sigue robusto. |
| A3 | `git worktree move` siempre acepta dirty en git versions soportadas por el repo | §"Empirical Git Worktree Behavior" Test 2/2b/2c | El fallback `mv + git worktree repair` (D-02) está como defense-in-depth. Si una versión vieja de git falla en `move`, el fallback se activa. Verificación empírica solo cubre git 2.51.2; users con git <2.20 podrían ver comportamiento distinto. |
| A4 | El planner añadirá test E2E con `git init` local (mismo patrón que `test/skill-auto-commit.test.js`) | Architecture Patterns + Validation Architecture | Si el planner prefiere mocks puros (`gitFn` stub) sin git real, perdemos cobertura de los pitfalls observados empíricamente. Recomendación fuerte: HÍBRIDO — unit tests con `gitFn` stub para flow logic + 1 E2E test con git real para validar la integración. |
| A5 | `commit_docs: true` en `.planning/config.json` significa que RESEARCH.md va al commit del researcher | Step 7 del execution flow del agente | Confirmado: `.planning/config.json:5` muestra `"commit_docs": true`. |

## Open Questions (RESOLVED)

1. **¿El planner debería factorizar el cleanup block en un módulo separado (`src/hooks/worktree-cleanup.js`) o mantenerlo inline en `stop.js`?**
   - What we know: Phase 18 Plan 18-01 estableció precedent de factorizar `computeWorktreePath` a `state.js` por reusabilidad. Pero `stop.js` ya tiene `handleOrchestratorStop` inline (50 líneas) sin factorizar.
   - What's unclear: Si el cleanup block crece >40 líneas, factorizar mejora legibilidad de `runStopHook`; si ≤40, inline es coherente con `handleOrchestratorStop`.
   - RESOLVED: Mantener inline en Plan 02; el planner puede revisar tras escribir el RED test si parece desproporcionado.

2. **¿`git worktree move` sobre dirty necesita `--force` en algunas versiones de git?**
   - What we know: Empíricamente git 2.51.2 acepta `move` sobre dirty sin `--force`.
   - What's unclear: Git docs históricas (~2.20) sugerían que `move` requería `--force` para dirty, pero los release notes de git 2.30+ no mencionan el cambio explícitamente.
   - RESOLVED: NO usar `--force` por defecto. El fallback D-02 (`mv + repair`) cubre el case si una versión vieja rechaza.

3. **¿Hay riesgo de cmux retener handles en archivos del worktree post-stop?**
   - What we know: cmux abre un shell en el cwd del workspace. Phase 18 D-04 fija `cwd: projectPath` (repo principal), no el worktree, así que cmux NO debería retener handles en el worktree.
   - What's unclear: ¿El claude --worktree process abre handles que sobreviven al stop signal? Empíricamente no he podido testar (no hay claude binary disponible para spawn).
   - RESOLVED: Pitfall #4 documenta el case y el catch fail-open lo absorbe. Si `EBUSY` se vuelve frecuente en prod, deuda observable.

4. **¿El nudge enriquecido (D-10 Claude's Discretion: inyectar `moved_to` path en el orchestrator nudge) requiere skill.md update?**
   - What we know: skill.md líneas 99-110 describen el nudge actual. Si el planner añade info de `moved_to`, el orchestrator NECESITA saber interpretarlo.
   - What's unclear: ¿El planner va a meterse en este nice-to-have o lo deja deferido?
   - RESOLVED: DEFERIR (deferred ideas de CONTEXT.md ya lo marcaron). Si el planner decide implementarlo, debe incluir update de skill.md como parte del plan.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` binary | All cleanup ops (`worktree`, `branch`, `status`, `prune`) | ✓ | 2.51.2 | Ninguno — git es hard dep de kodo. Si falta, Phase 18 ya falla en spawn. |
| Node.js | All code | ✓ | 20+ (per `package.json` engines) | Ninguno |
| `node:child_process` | `execFileSync` / `execSync` | ✓ | stdlib | Ninguno |
| `node:fs` | `existsSync`, `renameSync` (fallback de D-02) | ✓ | stdlib | Ninguno |
| Claude Code (`claude` binary) | Lanzar sesiones con `--worktree` | ✓ (asumido — es la herramienta operativa de kodo) | unknown | Ninguno (Phase 18 ya depende de él) |

**Missing dependencies with no fallback:** Ninguna.

**Missing dependencies with fallback:** Ninguna.

## Validation Architecture

> `workflow.nyquist_validation: true` en `.planning/config.json` (verified).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node.js `node:test` stdlib + `node:assert/strict` (per `.planning/codebase/TESTING.md`) |
| Config file | None — `package.json` `test` script invokes `node --test test/**/*.test.js` |
| Quick run command | `node --test test/stop-worktree-cleanup.test.js test/logger-events.test.js test/gsd-verify-integration.test.js` (≤30s) |
| Full suite command | `npm test` (todas las suites — actualmente 545+ tests pre-Phase-19) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WT-04 | Stop hook removes clean worktree + deletes branch + emits cleanup.ok | E2E (git real + tmpdir) | `node --test test/stop-worktree-cleanup.test.js` | ❌ Wave 0 — new file |
| WT-04 | Stop hook moves dirty worktree to `.dirty/` + emits cleanup.dirty | E2E (git real + dirty fixture) | `node --test test/stop-worktree-cleanup.test.js` | ❌ Wave 0 |
| WT-04 | Stop hook fail-open on git remove error + emits cleanup.error | Unit (gitFn stub returns error) | `node --test test/stop-worktree-cleanup.test.js` | ❌ Wave 0 |
| WT-04 | Stop hook target collision (`.dirty/` already exists) → suffixed path | E2E (existsSync mocked or real precondition) | `node --test test/stop-worktree-cleanup.test.js` | ❌ Wave 0 |
| WT-04 | Stop hook legacy v0.5 (`worktree_path` absent) → silent skip | Unit (session fixture without worktree_path) | `node --test test/stop-worktree-cleanup.test.js` | ❌ Wave 0 |
| WT-04 | Stop hook calls cleanup AFTER releaseGsdLock (order invariant) | Source-hygiene (grep guard) | `node --test test/stop.test.js` | ✅ exists, extend |
| WT-04 | 3 new event helpers emit correct shape (`worktree.cleanup.{ok,dirty,error}`) | Unit (pure transform) | `node --test test/logger-events.test.js` | ✅ exists, extend |
| WT-04 | EVENTS frozen object includes 3 new strings | Unit | `node --test test/logger-events.test.js` | ✅ exists, extend |
| WT-05 | Orchestrator stop auto-commits in KODO_ROOT cwd (preserved) | E2E (already covered) | `node --test test/skill-auto-commit.test.js` | ✅ exists, preserve |
| WT-05 | `handleOrchestratorStop` source unchanged in functional terms | Source-hygiene (no changes to lines 238-272) | `node --test test/stop.test.js` (new assert) | ✅ exists, extend |
| WT-06 | verify reads VERIFICATION.md from worktree_path when present | Integration (fixture with worktree_path set) | `node --test test/gsd-verify-integration.test.js` | ✅ exists, extend |
| WT-06 | verify falls back to project_path for legacy sessions (no worktree_path) | Integration (fixture without worktree_path) | `node --test test/gsd-verify-integration.test.js` | ✅ exists, extend |
| WT-06 | verify.js line 124 contains `worktree_path ?? project_path` | Source-hygiene | `node --test test/gsd-verify-integration.test.js` o nuevo | ✅ exists, extend |

### Sampling Rate

- **Per task commit:** `node --test test/stop-worktree-cleanup.test.js test/logger-events.test.js test/gsd-verify-integration.test.js test/stop.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green + manual verification de un cleanup E2E sobre un repo throwaway antes de `/gsd-verify-work`.

### Wave 0 Gaps

- [ ] `test/stop-worktree-cleanup.test.js` — covers WT-04 (NEW file). Patrón mixto: unit (gitFn stub) + E2E (1 test con git init local mismo patrón que `skill-auto-commit.test.js`).
- [ ] Extend `test/logger-events.test.js` — covers D-10 (3 new helpers + EVENTS strings).
- [ ] Extend `test/gsd-verify-integration.test.js` — covers WT-06 (worktree_path + legacy paths).
- [ ] Extend `test/stop.test.js` — source-hygiene asserts:
  - Cleanup invoked AFTER releaseGsdLock (offset check via `indexOf`).
  - Cleanup invoked BEFORE OR AFTER removeSession (no strict requirement; document choice).
  - `worktreeCleanupOk` / `Dirty` / `Error` helpers referenced in cleanup block.
  - `handleOrchestratorStop` lines 238-272 unchanged in functional terms (cwd: KODO_ROOT preserved).
- [ ] **NO framework install needed** — `node:test` y `node:assert/strict` ya en uso.

### Test Helper Recommendations (synthesized from existing patterns)

```javascript
// Helper para tests E2E con git real (synthesized from skill-auto-commit.test.js + stop-state-transition.test.js)
function makeIsolatedRepoWithWorktree(opts = {}) {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-wt-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-wt-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const run = (cmd) => execSync(cmd, { cwd: tmpRepo, encoding: 'utf-8' });
  run('git init -q');
  run('git config user.email "test@kodo.local"');
  run('git config user.name "kodo test"');
  run('git config commit.gpgsign false');
  writeFileSync(join(tmpRepo, 'file.txt'), 'initial');
  run('git add .');
  run('git commit -q -m "initial"');

  const sessionId = opts.sessionId || randomUUID();
  const worktreePath = join(tmpRepo, '.bg-shell', sessionId);
  run(`git worktree add ${worktreePath} -b session-${sessionId}`);

  if (opts.dirty) {
    writeFileSync(join(worktreePath, 'dirty.txt'), 'uncommitted work');
  }

  return { tmpHome, tmpRepo, sessionId, worktreePath };
}
```

## Security Domain

> `security_enforcement` no encontrado explícitamente en `.planning/config.json`; aplica el default (enabled). Sin embargo Phase 18 ya pasó por `gsd-security-auditor` con verdict SECURED, y Phase 19 toca el mismo dominio (mismo threat surface). Sección mínima:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | yes | `session.worktree_path` viene de state.json (controlado por kodo, persistido por `computeWorktreePath` que es path.join puro — Phase 18 SECURED). El cleanup invoca `gitFn` con argumentos pasados como array (`execFileSync`), NO como shell string → no shell injection. |
| V6 Cryptography | no | — |
| V7 Error Handling | yes | Try/catch fail-open por bloque (Pattern 1). Sin stack traces leaked al stderr más allá de `err.message`. |

### Known Threat Patterns for Phase 19

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via `session.worktree_path` | Tampering | `execFileSync('git', [arg1, arg2, …])` pasa args como array — no shell parsing. Phase 18 SECURED ya validó que `worktree_path` es derivado de `path.join(projectPath, '.bg-shell', sessionId)` donde sessionId es UUID v4 random + projectPath es config humano. NO hay input externo. |
| Path traversal via crafted `worktree_path` | Tampering | `computeWorktreePath` es pure `path.join` (Phase 18 D-04 — NO realpathSync, NO concat manual). El test 3 de `test/state.test.js` ya assert `!out.includes('..')` (defense-in-depth). |
| Information disclosure via cleanup events | Disclosure | Eventos NDJSON contienen `worktree_path` y `session_id` — ambos ya persistidos en state.json y logs. No información nueva expuesta. |
| DoS via repeated cleanup invocations | DoS | `findSession` falla en re-stop (sesión ya removida), el cleanup nunca corre 2 veces. Empírico Test 6: el segundo `git worktree remove` falla con exit 128 — el catch fail-open lo silencia. |
| Race condition entre cleanup y nueva sesión sobre el mismo repo | Tampering | Lock per-repo (Phase 8 GSD-10 / Phase 18 SC#3) sigue intacto — cleanup corre TRAS `releaseGsdLock`, así que una nueva sesión puede empezar mientras corre cleanup. Pero los dos cleanups operan en distintos worktrees (UUIDs únicos), sin contención de filesystem. |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/19-worktree-cleanup-integration/19-CONTEXT.md` — D-01..D-10 locked decisions
- `.planning/REQUIREMENTS.md` — WT-04, WT-05, WT-06 textual
- `.planning/ROADMAP.md` — Phase 19 SCs canonical
- `.planning/STATE.md` — invariants cross-phase
- `.planning/phases/18-worktree-runtime-wiring/18-CONTEXT.md` y `18-{01,02,03}-SUMMARY.md` — base que Phase 19 extiende
- `src/hooks/stop.js` (líneas 97-272) — `runStopHook` actual + `handleOrchestratorStop`
- `src/gsd/verify.js` (línea 124) — único change de WT-06
- `src/logger-events.js` (líneas 1-205) — taxonomía cerrada + helpers pattern
- `src/session/state.js` (líneas 69-141) — `computeWorktreePath`, `findSession`, `removeSession`
- `src/session/manager.js` (líneas 232-326) — Phase 18 wiring confirmation
- Empirical git worktree experiments — git 2.51.2 throwaway repo, sesión 2026-05-12 12:53 GMT+2

### Secondary (MEDIUM confidence)

- `.planning/codebase/CONVENTIONS.md`, `TESTING.md`, `ARCHITECTURE.md` — coding standards
- `test/stop.test.js`, `test/stop-state-transition.test.js`, `test/skill-auto-commit.test.js` — test pattern templates
- `.claude/skills/kodo-orchestrate/skill.md` (líneas 99-110) — nudge documentación actual

### Tertiary (LOW confidence)

- Comportamiento de `git worktree move` con `--force` en git <2.30 — extrapolation desde changelogs, no testado empíricamente. Mitigado por fallback D-02.
- Posibilidad de cmux retaining FDs sobre worktree files post-stop — no testable sin claude CLI real.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — todo stdlib + patrones ya en uso, 0 deps nuevas
- Architecture: HIGH — confirmed leyendo source actual + CONTEXT.md locked decisions
- Pitfalls: HIGH — todos VERIFIED empíricamente sobre git 2.51.2
- Validation Architecture: HIGH — patrones de test ya establecidos por Phase 16 LOG-15 + Phase 999.1 D-16

**Research date:** 2026-05-12
**Valid until:** 30 días para los hallazgos empíricos de git worktree (git is stable), 7 días para suposiciones sobre claude CLI behavior (puede cambiar con releases).
