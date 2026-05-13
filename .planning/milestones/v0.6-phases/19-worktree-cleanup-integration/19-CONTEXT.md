# Phase 19: Worktree Cleanup & Integration - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar el ciclo de vida del worktree creado por Phase 18 y reapuntar los dos consumidores de filesystem que aún operan sobre el repo principal:

- **WT-04** — Stop hook hace `git worktree remove` con política fail-open. Si el working tree está dirty (`git status --porcelain` no vacío), el worktree NO se borra: se mueve a `.bg-shell/<sid>.dirty/` + log warn. Si el remove tiene éxito, también borra la branch local que `claude --worktree` creó y hace `git worktree prune` oportunista.
- **WT-05** — `auto-commit` de `kodo-orchestrate` queda blindado en su cwd actual (KODO_ROOT) — la orchestrator está excluida de worktree por Phase 18 D-06, así que el "dentro del worktree" del ROADMAP se interpreta como "el cwd ya es el correcto por construcción". El env override `KODO_ROOT` (Phase 999.1 D-16) sigue funcionando idéntico para tests.
- **WT-06** — `kodo gsd verify` (`src/gsd/verify.js` línea 124) resuelve `phasesRoot` con `session.worktree_path ?? session.project_path`. Fallback aditivo opcional: sesiones legacy v0.5 sin el campo siguen leyendo del repo principal, sesiones v0.6+ leen del worktree donde el agente escribió VERIFICATION.md.

Cubierto por esta phase:
- Cleanup del worktree EN el stop hook (no en orchestrator) — D-07.
- Move-aside `.bg-shell/<sid>.dirty/` para preservar trabajo no committed sin perder filesystem state — D-02.
- Eventos NDJSON dedicados `worktree.cleanup.ok / .dirty / .error` — D-10.
- Fallback silent para sesiones legacy v0.5 sin `worktree_path` — D-09.
- Cwd correcto para `verify.js` lectura de VERIFICATION.md — D-06.

Fuera de scope:
- Bug latente: `kodo gsd verify <sid>` post-stop falla porque `findSession` no busca en `state.history`. El nudge sugiere ejecutar verify TRAS el stop, pero el SessionRecord ya fue removido. Phase 19 lo acepta como deuda separada (D-07); resolverlo correspondería a Phase 21+ o a un patch dedicado al lifecycle del SessionRecord.
- `kodo gsd doctor` para limpiar zombies pre-existentes — solo se hace `git worktree prune` oportunista al final del cleanup de la sesión actual (D-04), nada retroactivo.
- Migración de sesiones legacy v0.5 para añadirles `worktree_path` — Phase 18 D-03c lo descartó explícitamente.
- Push automático desde el worktree al repo principal — kodo NO hace push automático (HOOK-01 driver de Phase 20).
- Cleanup ejecutado por el orchestrator post-verify — descartado por carga de coordinación (D-07).
- Sincronía verify⇄stop dentro del mismo hook — descartado por dependencia de Plane en un hook que debe ser rápido (D-07).

Fuera de scope (otras phases v0.6):
- HOOK-01 anti-push-fantasma (Phase 20).
- Skill sync CLI + auto-sync (Phase 21).
- Tech debt v0.5 closure (Phase 22).

</domain>

<decisions>
## Implementation Decisions

### Política de "dirty" y acción del cleanup (WT-04)

- **D-01:** "Dirty" = `git status --porcelain` sobre el worktree devuelve output no vacío. SOLO working tree — commits locales no pusheados NO cuentan como dirty (se eliminan junto con el worktree al hacer `git worktree remove`; la branch puede preservarse según D-08). Alineado con la incidencia driver (ROMAN-113…118): el problema era trabajo sin commit perdiéndose entre sesiones, no commits unpushed.
- **D-02:** Si el worktree está dirty al stop, se MUEVE a `.bg-shell/<sid>.dirty/` (no se intenta `--force`, no se preserva in-place sin marcar). El `.dirty` suffix es marca visible de "requiere review humano" y permite que una nueva sesión con el mismo session-id (colisión UUID, prob ~0) no choque con el path canónico. Log warn con `{ session_id, worktree_path, new_path }`. Detalle del comando exacto (`git worktree move` nativo vs `mv` + `git worktree repair`) lo decide el planner basándose en lo que git acepta sobre un worktree con working tree dirty.
- **D-03:** Si `git worktree remove`/`move` falla por razón no-dirty (FS error, git lock interno, race), `console.error` + continuar fail-open. MISMO patrón que `releaseGsdLock` (`stop.js:197`). Sin retry, sin backoff. El stop hook nunca debe crashear Claude Code; el worktree zombie queda como deuda observable vía logs (eventos D-10).
- **D-04:** `git worktree prune` oportunista al FINAL del cleanup (después de remove/move + branch cleanup). No-op si no hay zombies. Coste ~10ms, beneficio: el repo queda limpio sin intervención humana cuando alguien borró manualmente un directorio `.bg-shell/<sid>/`. NO se hace prune retroactivo en arranque ni en `kodo logs` ni en otros comandos — solo en el stop hook de cada sesión que termina.

### Auto-commit cwd (WT-05)

- **D-05:** WT-05 = **satisfied-by-design**. `handleOrchestratorStop` (`stop.js:238`) sigue con `cwd: KODO_ROOT` porque la orchestrator session está EXCLUIDA de worktree (Phase 18 D-06 — necesita cwd=repo para auto-cargar `.claude/skills/kodo-orchestrate/skill.md`). El "auto-commit dentro del worktree" del ROADMAP se interpreta como "el cwd del auto-commit ya respeta el contrato D-06 por construcción". Phase 19 NO toca `handleOrchestratorStop` funcionalmente; el requirement se marca cumplido y se documenta el contrato explícito. `KODO_ROOT` env override (Phase 999.1 D-16) preservado idéntico — tests siguen apuntando a tmpdir aislado.
- **D-05b:** Si una session-de-trabajo (NO orchestrator) modifica `.claude/skills/kodo-orchestrate/skill.md` dentro de su worktree y la sesión termina sin que el agente haya hecho `git commit`, esos cambios caen bajo D-02 (dirty → move-aside). NO se añade un segundo path de auto-commit para sesiones-de-trabajo: la skill canónica es la del repo principal (Phase 999.1 Constraint cwd=repo), no la copia del worktree. Cualquier aprendizaje genuino que el agente quiera persistir debe hacerlo committeando explícitamente en su worktree y dejando que el operador haga merge/cherry-pick a main.

### Verify lee VERIFICATION.md desde el worktree (WT-06)

- **D-06:** `src/gsd/verify.js` línea 124 cambia de `join(session.project_path, '.planning', 'phases')` a `join(session.worktree_path ?? session.project_path, '.planning', 'phases')`. Cambio quirúrgico (1 línea + JSDoc). Mismo patrón aditivo opcional que Phase 18 D-03c para `gsd_mode`. Sesiones legacy v0.5 sin `worktree_path` siguen leyendo del repo principal sin warn (consistente con D-09). NO se emite log warn en el fallback porque la legitimidad de "leer del repo" coexiste durante toda la ventana de migración v0.5 → v0.6.

### Orden + responsabilidad del cleanup (cross-cutting WT-04+WT-06)

- **D-07:** Cleanup vive en `stop.js` después del `releaseGsdLock` y del nudge al orchestrator (justo antes o después de `removeSession` — orden exacto a discreción del planner). El bug latente del verify post-stop (`findSession` no busca en `state.history`) es **deuda separada**, no se resuelve en Phase 19. Implicación: el flujo correcto es que el orchestrator dispare `kodo gsd verify <sid>` MIENTRAS la sesión está viva (pre-stop). El nudge actual (texto sugiriendo verify TRAS stop) requiere fix independiente — capturar como issue para Phase 21+.

### Branches huérfanas tras `git worktree remove` (WT-04)

- **D-08:** Si `git worktree remove` tuvo éxito (worktree limpio + removed), también `git branch -D <branch>` para borrar la branch que `claude --worktree <sessionId>` creó. Filosofía: cleanup completo si no hay nada que preservar. Si el cleanup hizo move-aside (D-02) o falló (D-03), la branch se preserva con el worktree dirty para review humano. Nombre exacto de la branch: el planner lo determina leyendo `git -C <worktree> branch --show-current` ANTES del remove (más robusto que asumir una convención de claude). Si `git branch -D` falla (race, ya borrada, nunca existió) → log warn fail-open. NO usar `git branch -d` (force delete OK aquí porque la decisión ya considera el dirty check).

### Fallback legacy v0.5 (cross-cutting)

- **D-09:** Sesiones sin `session.worktree_path` (legacy v0.5 vivas en state.json al desplegar Phase 19) → stop hook SKIP el cleanup completamente, sin emitir warn ni info. Comportamiento idempotente: el stop hook se comporta como v0.5 para esas sesiones. Riesgo aceptado: sesiones v0.6+ que por bug no persistan `worktree_path` quedan sin cleanup silenciosa — el detection de drift correspondería a tests + observabilidad, no a runtime warning. Consistente con D-06 (fallback silent en verify).

### Eventos NDJSON del cleanup (observabilidad)

- **D-10:** Eventos dedicados `worktree.cleanup.ok`, `worktree.cleanup.dirty`, `worktree.cleanup.error`, definidos en `src/logger-events.js` siguiendo el patrón de `sessionEnd`, `orchestratorReview`, `planeApiCallFailed`. Payload mínimo `{ session_id, worktree_path }` + campo específico por evento:
  - `.ok` → `{ branch_deleted: boolean }` (refleja D-08).
  - `.dirty` → `{ moved_to: string }` (path del `.dirty/` rename, D-02).
  - `.error` → `{ phase: 'remove' | 'move' | 'branch' | 'prune', reason: string }` (D-03).
  El evento `skipped-legacy` (D-09) se omite intencionalmente — silent fallback. Detalle final de payload + shape exacto a discreción del planner.

### Claude's Discretion

- Comando concreto para move-aside (`git worktree move` nativo vs `mv` + `git worktree repair`): probar `git worktree move` primero (más idiomático), caer a `mv + repair` si git rechaza por dirty.
- Orden exacto en stop hook entre `cleanup`, `removeSession`, y `notify orchestrator`. Restricción dura: cleanup DESPUÉS de `releaseGsdLock` (D-07). Restricción suave: prune al final del cleanup (D-04).
- Determinación del nombre de la branch (lectura via `git -C <wt> branch --show-current` pre-remove — D-08). Si la branch no existe (caso edge), fail-open silent.
- Decisión de inyectar el path del worktree dirty en el nudge del orchestrator para mejorar discoverability — opcional, no requerido.
- Estructura de tests: reuso del patrón Phase 16 `tmpdir+HOME override` + `runStopHook(input, deps)` ya factorizado para DI. Tests por path: ok / dirty / error / legacy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap, requirements, estado

- `.planning/ROADMAP.md` §"Phase 19: Worktree Cleanup & Integration" — goal canónico + 3 SCs.
- `.planning/REQUIREMENTS.md` §"Worktree always-on (WT-*)" — WT-04, WT-05, WT-06 (scope de Phase 19) + WT-01..03 (cerradas en Phase 18, contexto).
- `.planning/STATE.md` — última posición; lock NO toca worktree (SC#3 Phase 18 preservada); `KODO_ROOT` y auto-commit cwd cableados en Phase 19 SC#2 declarado allí.
- `.planning/PROJECT.md` §"Current Milestone: v0.6" — driver de la incidencia 28/04 (ROMAN-113…118) que justifica el cleanup limpio.

### Phase 18 — base que Phase 19 extiende

- `.planning/phases/18-worktree-runtime-wiring/18-CONTEXT.md` — decisiones D-01..D-06b: invocación CLI, persistencia de `worktree_path` PRE-spawn, lock per-repo invariante, EXCLUSIÓN del orchestrator. Phase 19 PRESERVA todas; ninguna se reabre.
- `.planning/phases/18-worktree-runtime-wiring/18-01-PLAN.md` y `18-01-SUMMARY.md` — `computeWorktreePath(projectPath, sessionId)` factorizado en `src/session/state.js`. Phase 19 lo CONSUME para limpiar el path determinístico.
- `.planning/phases/18-worktree-runtime-wiring/18-02-PLAN.md` y `18-02-SUMMARY.md` — cableado `--worktree <sessionId>` en `buildClaudeCommand` + persistencia de `SessionRecord.worktree_path` PRE-spawn. Define el shape que Phase 19 lee.
- `.planning/phases/18-worktree-runtime-wiring/18-03-PLAN.md` y `18-03-SUMMARY.md` — `worktree_collision` action canonical en dispatcher + invariante lock per-repo. Phase 19 NO toca el dispatcher; el cleanup vive aguas abajo.
- `.planning/phases/18-worktree-runtime-wiring/18-VERIFICATION.md` — proof de que WT-01/02/03 están cerrados antes de empezar Phase 19.

### Código a modificar (source-of-truth de comportamiento actual)

- `src/hooks/stop.js` líneas 97-222 (`runStopHook`) — sitio principal: añadir bloque de cleanup tras `releaseGsdLock` (línea 196-197) y antes/después de `removeSession` (línea 203). El `try/catch` top-level (línea 219-221) ya garantiza fail-open global; el cleanup debe tener su propio try/catch interno para emitir eventos D-10 correctos. NO tocar `handleOrchestratorStop` (líneas 238-272) — D-05.
- `src/gsd/verify.js` línea 124 (`phasesRoot`) — único cambio: `join(session.worktree_path ?? session.project_path, '.planning', 'phases')`. Update JSDoc para reflejar el fallback. Tests asociados (`test/gsd-verify-*.test.js`) deben extender fixtures para cubrir el path con worktree_path + el legacy sin él.
- `src/logger-events.js` — añadir `worktreeCleanupOk`, `worktreeCleanupDirty`, `worktreeCleanupError` siguiendo el patrón de `sessionEnd`, `orchestratorReview`, `planeApiCallFailed`. Shape exacto a discreción del planner según D-10.
- `src/session/state.js` línea 69 (`computeWorktreePath`) — REUSE no modify; Phase 19 lo importa en `stop.js` para computar el path canonical desde `(project_path, session_id)` si necesita verificar consistencia con `worktree_path` persistido.
- `.claude/skills/kodo-orchestrate/skill.md` líneas 173-176 — la documentación dice "El commit es automático... al terminar la sesión orquestadora vía handleOrchestratorStop". Confirmar tras Phase 19 que sigue siendo verdad (D-05 no altera nada). Si Phase 19 introduce nudge enriquecido para sesiones dirty (Claude's Discretion), actualizar skill.md correspondientemente.

### Decisiones de phases previas que Phase 19 preserva

- Phase 8 `GSD-10` — lock per-repo. Phase 18 SC#3 lo blindó; Phase 19 NO altera el contrato (cleanup ocurre TRAS `releaseGsdLock`).
- Phase 10 `D-04`, `D-17` — `orchestratorReview` emitido en TODAS las ramas del verdict. Verify.js no debe perder este invariante al cambiar `phasesRoot` (D-06).
- Phase 10 Pitfall #6 Opción A — exit codes deterministas + bytes Plane comment. Cambio de `phasesRoot` NO altera ni bytes ni exit codes.
- Phase 11 `D-08` / Phase 18 `D-03c` — campo aditivo opcional en `SessionRecord`. `worktree_path` ya sigue este patrón; D-06 + D-09 lo extienden a los consumers.
- Phase 12 `QUICK-07` — etiquetas `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` byte-idénticas. Phase 19 NO toca `buildSessionContext` ni `buildClaudeCommand`.
- Phase 16 `LOG-13..15` — patrón de tests `tmpdir + HOME override` + DI vía `runStopHook(input, deps)`. Reusable para tests Phase 19.
- Phase 999.1 `D-04..D-06` — orchestrator cwd=repo invariante. D-05 de Phase 19 lo confirma explícitamente.
- Phase 999.1 `D-16` — `KODO_ROOT` env override. Phase 19 lo preserva sin cambios.

### Convenciones del proyecto

- `.planning/codebase/ARCHITECTURE.md` — layers; `Hooks Layer` (`src/hooks/`) es la frontera donde vive el cleanup.
- `.planning/codebase/CONVENTIONS.md` — estilo de tests; eventos NDJSON tipados en `logger-events.js` (no strings sueltos).
- `~/.kodo/state.json` — formato real de `SessionRecord` v2 (schema_version 2). `worktree_path` aditivo opcional desde Phase 18.
- `git worktree` man page — comportamiento por defecto: `remove` rechaza working tree dirty; `move` no acepta worktrees con cambios sin commit (validar en research).

### Incidencia driver

- Memoria `kodo_no_git_add_all.md` (incidente 2026-04-28, ROMAN-113…118) — driver primario de v0.6. Phase 18 lo bloquea por construcción (worktree always-on); Phase 19 lo CIERRA limpiando el filesystem tras cada sesión sin perder trabajo dirty.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `runStopHook(input, deps)` (`stop.js:97`) — ya factorizado para DI (Phase 16 LOG-15). Phase 19 inyectará `gitWorktreeFn?` y mock de FS para tests sin spawn.
- `computeWorktreePath(projectPath, sessionId)` (`state.js:69`) — usable para verificar consistencia `worktree_path` persistido vs canonical, opcional.
- `loggerFactory` deps en `runStopHook` — mismo patrón Phase 16 LOG-15: tests inyectan memSink para capturar eventos sin disk I/O.
- `markSessionStatus(taskId, status, reason, log)` (`session/manager.js`) — patrón emit-BEFORE-mutation reusable si Phase 19 necesita marcar algún estado intermedio (probablemente no — el cleanup no muta SessionRecord).
- `findSession({ sessionId, cwd })` (`state.js:180`) — ya consumida por stop hook. Phase 19 NO la toca, pero el bug latente del fallback a history (D-07) está aquí (línea 180-194 solo busca en `state.sessions`).
- `loadConfig` / `getProvider` (en verify.js) — sin cambios; el cambio de D-06 es UNA línea de path resolution.

### Established Patterns

- **Try/catch fail-open por bloque** — `stop.js` ya tiene try/catch separados para `cmux.setColor`, `cmux.notify`, `session.end emit`, `markSessionStatus`, `releaseGsdLock`, `notify orchestrator`. Phase 19 añade UN try/catch más para el cleanup, emite evento `worktree.cleanup.error` en su catch (D-10) y continúa.
- **Eventos NDJSON tipados** — `logger-events.js` define helpers como `sessionEnd`, `orchestratorReview`, `planeApiCallFailed`. Phase 19 añade 3 helpers nuevos siguiendo el mismo shape.
- **Campo aditivo opcional + fallback** — Phase 11 `gsd_mode`, Phase 18 `worktree_path`. D-06 y D-09 extienden el patrón a consumers downstream.
- **Lazy import en stop hook** — `releaseGsdLock` y `markSessionStatus` se importan dinámicamente para minimizar el cold-start del hook. `git` ops se ejecutarán via `execSync`/`execFile` (igual que `handleOrchestratorStop:239`).
- **Tests con `tmpdir + HOME override`** (Phase 16 CR-02 fix) — toda lectura/escritura sobre `~/.kodo/state.json` debe ser redirigida. Tests Phase 19 lanzarán `git worktree add` real sobre un repo bare temporal.

### Integration Points

- `releaseGsdLock` (`stop.js:197`) — el cleanup va DESPUÉS de esta llamada (D-07). El lock ya está libre cuando el cleanup arranca, así que una segunda task contra el mismo repo puede coalescer mientras corre el cleanup (no contention).
- `notify orchestrator` (`stop.js:208-215`) — el orden cleanup⇄notify es discrecional (D-07). Inyectar info de "worktree dirty preservado en X" en el nudge es un nice-to-have opcional.
- `removeSession` (`stop.js:203`) — mueve la session a `state.history` y la borra de `sessions`. El cleanup necesita `session.worktree_path` (leído antes de `removeSession`).
- `handleOrchestratorStop` (`stop.js:238`) — NO se modifica (D-05). Sigue corriendo con `cwd: KODO_ROOT`. Línea 244 + 259 preservadas.
- `verify.js` línea 124 — única línea de cambio para WT-06 (D-06). El resto de `runGsdVerify` (provider, addComment, transition, orchestratorReview) intacto.

</code_context>

<specifics>
## Specific Ideas

- Driver concreto: incidencia 28/04 (ROMAN-113…118). Phase 18 detuvo el cross-staging; Phase 19 cierra el lifecycle sin acumular zombies en `.bg-shell/`.
- `kodo gsd verify` con worktree_path debe seguir funcionando MIENTRAS la sesión está viva (orchestrator dispara verify pre-stop). El nudge actual sugiere verify post-stop pero ese flujo está roto independientemente — Phase 19 lo documenta como deuda separada (D-07).
- Phase 19 prioriza "preservar trabajo no committed" sobre "repo siempre limpio" — la opción "rename a .dirty" (D-02) refleja esa jerarquía. La incidencia driver es sobre datos perdidos, no sobre acumulación de directorios.
- Branch cleanup (D-08) es agresivo (`-D` force delete) pero acotado: solo si el worktree estaba limpio. Trabajo no committed → worktree preservado → branch preservada. Filosofía cohesiva.

</specifics>

<deferred>
## Deferred Ideas

- **Bug latente: `findSession` no busca en `state.history`.** El nudge sugiere `kodo gsd verify <sid>` TRAS stop, pero el SessionRecord ya fue removido → verify falla con "session not found". Independiente de Phase 19. Capturar como issue dedicado para Phase 21+ o como patch separado al lifecycle del SessionRecord.
- **`kodo gsd doctor`** — herramienta retroactiva para limpiar zombies pre-existentes (worktrees en `.bg-shell/` sin sesión asociada en state.json, entries en `.git/worktrees/` sin directorio). Defer a v0.7+ o backlog.
- **Re-evaluar la skill `kodo-orchestrate` documentación** — si Phase 19 introduce nudge enriquecido con info de worktree dirty (Claude's Discretion), actualizar `skill.md` para que el orquestador sepa interpretarlo. Si no, no tocar.
- **Path consistency check en runtime** — `worktree_path` persistido vs `computeWorktreePath(project_path, session_id)` canonical. Defensivo, probablemente innecesario; deferir a observabilidad si surge drift en QA.
- **Cleanup hook idempotencia explícita** — qué pasa si el stop hook se llama dos veces (cmux retry, manual replay). El cleanup ya es naturalmente idempotente: `git worktree remove` falla si no existe → atrapamos error → no-op. Documentar pero no añadir lógica.
- **`worktree_path` en `kodo logs --session-of`** — exposición cosmética del campo. Deferido en Phase 18 también; sigue deferido.
- **Auto-commit en sesiones-de-trabajo** que toquen `.claude/skills/` — descartado por D-05b. La skill canónica vive en el repo, no en el worktree. Reabrir solo si Phase 21 (skill sync) cambia el contrato.

### Reviewed Todos (not folded)

No hubo todos cross-referenced en esta sesión.

</deferred>

---

*Phase: 19-worktree-cleanup-integration*
*Context gathered: 2026-05-12*
