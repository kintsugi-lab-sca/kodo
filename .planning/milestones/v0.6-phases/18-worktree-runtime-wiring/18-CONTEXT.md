# Phase 18: Worktree Runtime Wiring - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Aislar el filesystem de cada sesión kodo (`launchWorkItem`) lanzándola con `claude --worktree <session-id>`, persistir el path determinístico del worktree en `SessionRecord.worktree_path` (state.json) y preservar el invariante del lock per-repo (Phase 8 GSD-10): el lock sigue siendo sobre el repo principal — dos tareas Plane sobre el mismo repo coalescen igual que en v0.5.

Cubierto por esta phase:
- WT-01: TODA sesión `launchWorkItem` (full + quick + no-GSD) lleva `--worktree <session-id>` en el comando claude. Sin labels opt-in.
- WT-02: `worktree_path = <projectPath>/.bg-shell/<session-id>/` se computa PRE-spawn y se persiste en `SessionRecord` antes de invocar cmux.
- WT-03: `acquireGsdLockFn(projectPath, ...)` sigue usando `projectPath` (repo principal), nunca `worktree_path`. La coalescencia se preserva idéntica.

Fuera de scope (Phase 19):
- `git worktree remove` en stop hook (cleanup fail-open).
- `auto-commit` operando dentro del worktree (cwd de `handleSkillAutoCommit` en `stop.js`).
- `kodo gsd verify` leyendo `VERIFICATION.md` desde el worktree.
- Cualquier limpieza retroactiva de worktrees zombie.

Fuera de scope (otras phases v0.6):
- HOOK-01 anti-push-fantasma (Phase 20).
- Skill sync CLI / auto-sync (Phase 21).
- Tech debt v0.5 closure (Phase 22).

Fuera de scope (cross-cutting):
- La sesión del `kodo orchestrator` NO arranca con worktree (excluida explícitamente — ver D-06).
- Compactación / migración retroactiva de sesiones legacy en state.json sin `worktree_path` — campo aditivo opcional (precedent Phase 11 D-08).

</domain>

<decisions>
## Implementation Decisions

### Invocación CLI

- **D-01:** kodo pasa `--worktree <session-id>` explícito en el comando claude. Single source of truth: el path del worktree se deriva determinísticamente del session-id (`<projectPath>/.bg-shell/<sessionId>/`). NO usar `claude --worktree` sin argumento (claude generaría nombre y kodo lo perdería).
- **D-02:** Branch naming queda a discreción de claude. kodo no fuerza ni nombra branches; cualquier consumer que necesite la branch la lee con `git -C <worktree> branch --show-current` (no aplica en Phase 18; Phase 19 lo evaluará para cleanup).

### Workspace cmux y cwd

- **D-04:** `cmux.newWorkspace({ cwd: projectPath })` se mantiene IDÉNTICO. El shell de cmux abre en el repo principal; `claude --worktree <session-id>` materializa el worktree y opera dentro. Los agents team de claude (`--agents`) y los hooks (`session-start`, `stop`) ven `cwd = worktree` desde el lado de claude. Verificable con `git -C $(pwd) rev-parse --show-toplevel` desde tools del agente (SC#1).
- **D-04b:** La opción de cmux de "nuevas ventanas" (iTerm/tmux pane) es ortogonal a esta phase — no se toca aquí. Cualquier cambio en spawn-window se mete en otro track.

### Persistencia worktree_path

- **D-03:** `worktree_path` se escribe a `SessionRecord` PRE-spawn y determinísticamente: kodo computa `join(projectPath, '.bg-shell', sessionId)` y llama `addSession(taskId, session)` ANTES de `cmux.send(claudeCmd)`. Beneficios: `kodo logs --session-of` y otros consumers tienen el path inmediato; single source of truth en kodo, no en claude.
- **D-03b:** No se añade verificación post-spawn opcional en `session-start` hook en Phase 18. El consistency check (`git rev-parse --show-toplevel === worktree_path`) puede entrar como reinforcement en Phase 19 si surge drift en QA, no antes.
- **D-03c:** `SessionRecord.worktree_path` es **campo aditivo opcional** (mismo patrón que Phase 11 D-08 para `gsd_mode`). Sesiones legacy v0.5 en state.json siguen leyéndose; falsy → undefined → consumers downstream que esperen el path lo manejan como "no aplica" (compat). No hay migration schema_version bump.

### Colisión de path

- **D-05:** Si `<projectPath>/.bg-shell/<session-id>/` ya existe al invocar `launchWorkItem`, kodo aborta el spawn con error canonical antes de llamar a cmux/claude. Phase 18 NO toca worktrees existentes para evitar race con sesiones vivas. Phase 19 (stop hook fail-open) será quien limpie worktrees huérfanos en su cierre normal.
- **D-05b:** Detalles del error canonical (código, action label en el dispatcher, mensaje stderr) los decide el planner siguiendo el patrón Phase 8 (`gsd_locked` → `worktree_collision` análogo) y LOG-09/Phase 16 (bytes-deterministic). Mantener simetría con los `action` strings existentes del dispatcher (`gsd_locked`, `resolver_failed`).

### Scope de "todas las sesiones"

- **D-06:** WT-01 aplica a `launchWorkItem` (sesiones de trabajo: full + quick + no-GSD). El `kodo orchestrator` (singleton supervisor, lanzado vía `launchOrchestrator` separado) queda EXCLUIDO: necesita `cwd = repo` para auto-cargar `.claude/skills/kodo-orchestrate/skill.md` (Phase 999.1 D-05 constraint, registrado en PROJECT.md). Capturar la exclusión como comentario en `launchOrchestrator` o como assert en CONTEXT/PLAN.
- **D-06b:** Sesiones no-GSD (sin `kodo:gsd*` label) tampoco adquieren el per-repo lock (heredado de v0.5), pero SÍ corren con worktree (WT-01 explícito). Implicación: dos sesiones no-GSD sobre el mismo repo pueden correr en paralelo sin contención (cada una en su worktree). Este es el punto que resuelve la incidencia 28/04 ROMAN-113…118 (`git add -A` cross-staging).

### Claude's Discretion

- Exit code y string del error canonical para colisión (siguiendo patrón Phase 8/16).
- Orden exacto de aserciones en tests (state.json mutation → comando claude armado → lock path verification).
- Si conviene factorizar el cómputo `join(projectPath, '.bg-shell', sessionId)` en un helper (`computeWorktreePath`) en `src/session/state.js` o `src/session/manager.js`, o mantenerlo inline en `launchWorkItem`. Preferencia: helper si lo consumen >1 sitio (Phase 19 stop hook lo consumirá para `git worktree remove`).
- Cómo presentar `worktree_path` en `kodo logs --session-of` output (campo nuevo opcional en la línea formateada, o solo accesible por flag `--json`). Decisión cosmética que cae en el planner / es trivial.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap, requirements, estado

- `.planning/ROADMAP.md` §"Phase 18: Worktree Runtime Wiring" — goal canónico + 3 SCs.
- `.planning/REQUIREMENTS.md` §"Worktree always-on (WT-*)" — WT-01, WT-02, WT-03 (scope) + WT-04..06 (deferred a Phase 19).
- `.planning/REQUIREMENTS.md` §"Out of Scope" — `worktree_path` aditivo opcional, un worktree por session-id (no shared pool).
- `.planning/PROJECT.md` §"Current Milestone: v0.6" — driver de la incidencia 28/04 (ROMAN-113…118) y constraint Phase 999.1 cwd=repo.
- `.planning/STATE.md` — última posición; menciona explícitamente el invariante "lock NO toca worktree" (SC#3).

### Código a modificar (source-of-truth de comportamiento actual)

- `src/session/manager.js` líneas 154–250 (`launchWorkItem`) — sitio principal: añadir cómputo de `worktreePath`, persistir en `addSession`, threadear a `buildClaudeCommand`. Línea 193–197: `cmux.newWorkspace({ cwd: projectPath })` se mantiene (D-04).
- `src/session/manager.js` líneas 261–274 (`buildClaudeCommand`) — añadir `--worktree <sessionId>` al string del comando claude. Preservar orden actual de flags (`--model X --session-id Y [--dangerously-skip-permissions] '<prompt>'`).
- `src/session/state.js` — `SessionRecord` shape: añadir campo opcional `worktree_path` (aditivo, falsy permitido). NO bump `schema_version` (precedent Phase 11 D-08 / `gsd_mode`).
- `src/gsd/lock.js` líneas 103, 154 (`acquireGsdLock`/`releaseGsdLock`) — invariante: la firma sigue tomando `projectPath` (repo principal), NO `worktree_path`. Verificar que NINGÚN call site del dispatcher cambia el primer argumento.
- `src/triggers/dispatcher.js` líneas 130–137 (lock acquire) y 200, 300, 331 (lock release) — consumer principal de `launchWorkItem`; las llamadas a lock pasan `gsdProjectPath` actualmente, debe seguir igual (SC#3).
- `src/orchestrator/launch.js` (`launchOrchestrator`) — confirmar que NO recibe `--worktree`. Es la línea de defensa de D-06 (orchestrator excluido).
- `src/hooks/session-start.js` — opera en cwd=worktree desde el lado de claude. Verificar que no asume cwd=projectPath para lecturas (probablemente OK; las paths absolutas via `KODO_DIR` o `~/.kodo/...` son robustas).

### Decisiones de phases previas que esta phase preserva

- Phase 8 `GSD-10` — lock per-repo en `~/.kodo/locks/<repo-realpath>.lock`. SC#3 = invariante esencial.
- Phase 11 `D-08` — `gsd_mode` aditivo opcional en `SessionRecord` sin schema bump. `worktree_path` sigue MISMO patrón (D-03c).
- Phase 999.1 `D-05` + `D-06` — orchestrator necesita cwd=repo para auto-cargar la skill. Driver de D-06 (exclusion).
- Phase 999.1 `D-14` — `SKILL_PATH`/auto-commit en `stop.js` apunta a `.claude/skills/`. Phase 19 reabre esto para hacer el cwd correcto en worktree, NO Phase 18.
- Phase 12 `QUICK-07` — etiquetas `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` deben permanecer byte-idénticas al añadir `--worktree` (golden bytes invariant para HOOK-01 en Phase 20).
- Phase 16 `LOG-13..15` — patrón de tests con `tmpdir+HOME override` (CR-02 fix) y `markSessionStatus(..., 'session-stop:lock-released', log)`. Reusable para tests de Phase 18.

### Convenciones del proyecto

- `.planning/codebase/ARCHITECTURE.md` — layers; `Session Management Layer` (`src/session/manager.js`) es el punto de cambio.
- `.planning/codebase/CONVENTIONS.md` — estilo de tests (`tmpdir+HOME override`, spawn real con `bin/kodo`, source-hygiene asserts).
- `~/.kodo/state.json` — formato real de `SessionRecord` v2 (schema_version 2 since Phase 1).
- `claude --help` — flag oficial: `-w, --worktree [name]` (optional name). `--tmux` requiere `--worktree`. Documentar que kodo SÍ pasa name (D-01).

### Incidencia driver

- Memoria `kodo_no_git_add_all.md` (incidente 2026-04-28, ROMAN-113…118) — explica por qué worktree always-on resuelve el cross-staging de sesiones paralelas. Driver primario de v0.6.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `randomUUID()` en `launchWorkItem` (línea 206) — ya genera `sessionId` cuando `opts.sessionId` no viene. El path determinístico `.bg-shell/<sessionId>/` reutiliza el mismo UUID que ya thread a través de lock + state + cmd.
- Patrón `opts.X ?? labelX` en `launchWorkItem` (líneas 206–209) — extensible si en el futuro hay un opt-in/out de worktree por flag (no en Phase 18; aplica a Phase 19+).
- `buildSessionFromTask` (línea 215) — ya recibe campos opcionales con conditional spread (`phase_id`, `brief`); `worktree_path` se añade ahí siguiendo el mismo idiom.
- `escapeShell` (línea 277) — usado para el prompt; `--worktree <sessionId>` NO necesita escape (UUID es seguro), pero el orden de flags importa para golden bytes downstream.

### Established Patterns

- **Campos aditivos opcionales en `SessionRecord`** — Phase 11 `gsd_mode` y Phase 9 `phase_id`/`brief` ya entran con conditional spread y se leen como falsy → compat v0.3. `worktree_path` sigue idéntico.
- **Single source of truth en kodo, no en claude** — Phase 8 GSD-10 demuestra el patrón: kodo computa el lock path, no espera a que claude lo reporte. `worktree_path` PRE-spawn (D-03) extiende este patrón.
- **Source-hygiene tests + `format-isolation.test.js` style** (Phase 15, Phase 16) — el planner puede pedir grep guard "1 callsite construye `--worktree`, en `buildClaudeCommand`".
- **`gsd_locked` action en dispatcher** (Phase 8) — referencia canonical para el patrón de error de colisión (`worktree_collision` action, similar shape `{ action, code, detail }`).
- **Idioma:** docs operativos en ES; mensajes al agente en EN. El nudge de cmux/stop debe respetar este split (Phase 999.1 D-04).

### Integration Points

- `launchWorkItem` (líneas 154–250) — único call site afectado. `launchOrchestrator` queda intacto (D-06).
- Dispatcher (`src/triggers/dispatcher.js`) — consumer principal; no necesita cambios si `launchWorkItem` mantiene su signature. Verifica el lock invariant (SC#3).
- `kodo logs --session-of` (Phase 7 LOG-11) — eventualmente puede exponer `worktree_path` desde state.json; aplica al campo opcional (no rompe two-step resolver).
- `session-start.js` hook — opera dentro del worktree (cwd lo establece claude --worktree); no requiere cambios funcionales en Phase 18 (cualquier ajuste sale en Phase 19).
- `.bg-shell/` — directorio ya gitignored (visible en `git status` no-tracked). Convención claude para worktrees. NO añadir explicit gitignore en esta phase si ya lo está.

</code_context>

<specifics>
## Specific Ideas

- Driver concreto: incidencia 28/04 (ROMAN-113…118) donde `git add -A` / `commit -a` en sesiones paralelas arrastraba staging entre sí. Worktree always-on lo elimina por construcción (cada sesión = working tree independiente). Esta phase materializa el fix; Phase 19 lo cierra con cleanup limpio.
- Sketch 2026-05-07 descartó las labels `kodo:worktree` / `kodo:branch` (opt-in) en favor de always-on. Esta decisión está YA tomada — no se reabre.
- Phase 18 prefiere "fail-fast + canonical error" sobre "auto-prune" porque el ecosistema kodo prioriza determinismo y exit codes observables (Phase 9 `kodo gsd inspect` D-19, Phase 10 Pitfall #6 Opción A). Auto-prune cae naturalmente en Phase 19 vía stop hook fail-open.

</specifics>

<deferred>
## Deferred Ideas

- **Verificación post-spawn en `session-start` hook** (`git rev-parse --show-toplevel === worktree_path`) — defensivo, no necesario para SC#1 que es observable inspeccionando el comando armado. Si surge drift en QA, entra como reinforcement en Phase 19.
- **Branch naming forzado por kodo** — `claude --worktree` ya da branch; si downstream necesita branch determinístico (ej. para PR auto-creation futura), se evalúa en v0.7+.
- **Helper `computeWorktreePath(projectPath, sessionId)`** — extracción a `src/session/state.js` o `src/session/manager.js` se justifica si Phase 19 lo consume (stop hook `git worktree remove`). Decidir en el planner de Phase 18 si lo factoriza ya (preferible) o lo deja inline.
- **Exposición de `worktree_path` en `kodo logs --session-of` output** — cosmético, puede entrar como mejora menor en Phase 19 o como UX-debt deferido.
- **Migración retroactiva de sesiones legacy v0.5 en state.json para añadirles `worktree_path`** — descartada: campo aditivo opcional, NO se backfillea (precedent `gsd_mode`).
- **Cleanup retroactivo de worktrees zombie** existentes en `.bg-shell/` antes de Phase 18 → Phase 19 lo cubre vía stop hook + manual `git worktree prune`.

### Reviewed Todos (not folded)

No hubo todos cross-referenced en esta sesión.

</deferred>

---

*Phase: 18-worktree-runtime-wiring*
*Context gathered: 2026-05-11*
