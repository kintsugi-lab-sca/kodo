# Phase 19: Worktree Cleanup & Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-12
**Phase:** 19-worktree-cleanup-integration
**Areas discussed:** Política dirty + cleanup, Semántica WT-05 (auto-commit cwd), Branches huérfanas, Fallback legacy v0.5 + eventos NDJSON

---

## Política "dirty" + acción del cleanup (WT-04)

### Pregunta 1 — Definición de "dirty"

| Option | Description | Selected |
|--------|-------------|----------|
| Solo working tree (`git status --porcelain`) | Cambios sin commit → preservar worktree. Commits unpushed se eliminan con el worktree. | ✓ |
| Working tree + commits unpushed | Cualquier divergencia respecto al remote cuenta como dirty. Más conservador. | |
| Working tree + cualquier cambio respecto a base | Aún más estricto: trabajo no-committed O commits que difieran de main. | |

**User's choice:** "Solo working tree (`git status --porcelain`)"
**Notes:** Alineado con el driver de la incidencia ROMAN-113…118 (cross-staging de trabajo no-committed). Commits unpushed no son el problema que esta phase resuelve.

### Pregunta 2 — Acción exacta si dirty

| Option | Description | Selected |
|--------|-------------|----------|
| Preservar in-place + log warn | Worktree queda en `.bg-shell/<sid>/` intacto. Operador limpia manualmente. | |
| Rename a `.bg-shell/<sid>.dirty/` + log warn | Marca visible "requiere review humano". Evita colisiones de UUID futuras. | ✓ |
| Preservar + nudge al orchestrator | Como A pero añade info al stop nudge para discoverability. | |

**User's choice:** "Rename a `.bg-shell/<sid>.dirty/` + log warn"
**Notes:** El `.dirty` suffix es marca visible. Detalle del comando exacto (`git worktree move` vs `mv` + `repair`) lo decide el planner.

### Pregunta 3 — Cleanup error no-dirty (FS, git lock, race)

| Option | Description | Selected |
|--------|-------------|----------|
| Log error + continuar (fail-open total) | Mismo patrón que `releaseGsdLock` actual. Worktree zombie queda como deuda observable. | ✓ |
| Log error + retry 1 vez con backoff corto | Reintentar (~200ms) contra races transient con git. | |
| Log error + emitir evento `worktree.cleanup.error` además del console.error | Como A pero con evento NDJSON tipado para `kodo logs`. | |

**User's choice:** "Log error + continuar (fail-open total)"
**Notes:** Stop hook debe ser rápido. Sin retry, sin complejidad. (El evento NDJSON sí se emite — opción 3 se redujo a su nombre; pero el comportamiento elegido excluye retry. El evento se confirmó en área 4 vía D-10.)

### Pregunta 4 — `git worktree prune` oportunista

| Option | Description | Selected |
|--------|-------------|----------|
| No — fuera de scope de Phase 19 | Solo cleanup del worktree de la sesión que termina. Zombies pre-existentes → operador o futuro `kodo gsd doctor`. | |
| Sí, oportunista al final del cleanup | `git worktree prune` sin args al final. ~10ms, no-op si no hay zombies. | ✓ |
| Solo si el remove falló por "not registered" | Defensivo y dirigido. | |

**User's choice:** "Sí, oportunista al final del cleanup"
**Notes:** Beneficio: repo queda limpio sin intervención humana. Riesgo bajo.

---

## Semántica WT-05 (auto-commit cwd)

### Pregunta 1 — ¿Qué significa WT-05?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo blindar el cwd actual (no-op funcional) | `handleOrchestratorStop` sigue con cwd=KODO_ROOT. WT-05 = satisfied-by-design. | ✓ |
| Extender: sesiones-de-trabajo auto-commiteen `.claude/skills/` | Doble path con cwd diferente según quién terminó. | |
| Mover toda la responsabilidad a sesiones-de-trabajo | Orchestrator deja de auto-commitear. Más puro pero rompe la promesa actual del skill.md. | |
| Aclarar/corregir el ROADMAP — quitar WT-05 o redirigirlo | Editar REQUIREMENTS.md para reflejar el contrato real. | |

**User's choice:** "Solo blindar el cwd actual (no-op funcional)"
**Notes:** La orchestrator está excluida de worktree por Phase 18 D-06. WT-05 se interpreta como "el cwd ya es el correcto por construcción". Phase 19 NO toca `handleOrchestratorStop`.

### Pregunta 2 — Resolución de path en `verify.js` (WT-06)

| Option | Description | Selected |
|--------|-------------|----------|
| `session.worktree_path` con fallback a `project_path` | Aditivo opcional, patrón Phase 18 D-03c. Cambio quirúrgico (1 línea). | ✓ |
| Siempre `worktree_path`, falla si ausente | Estricto, limpieza brutal pero potencialmente disruptiva. | |
| Probar worktree primero, fallback a project_path con log warn | Como A pero detecta drift vía warn. | |

**User's choice:** "`session.worktree_path` con fallback a `project_path`"
**Notes:** Sin warn (fallback silent), consistente con la sem ántica aditiva.

### Pregunta 3 — Responsable del cleanup y timing

| Option | Description | Selected |
|--------|-------------|----------|
| Stop hook, después del nudge — acepta el bug del verify | Cleanup en `stop.js`. Verify post-stop falla con "session not found" (deuda separada). | ✓ |
| Stop hook sí, pero `findSession` busca también en history | No resuelve el problema base (worktree ya removido = VERIFICATION.md inaccesible). | |
| Mover cleanup al orchestrator (post-verify) | Stop hook NO hace cleanup. Nueva CLI o RPC. Cambio mayor de scope. | |
| Verify síncrono dentro del stop hook, luego cleanup | Acopla stop ⇄ verify. Riesgo: stop hook se vuelve red. | |

**User's choice:** "Stop hook, después del nudge — acepta el bug del verify"
**Notes:** El bug del verify post-stop (`findSession` no busca en `state.history`) es deuda separada para Phase 21+. Phase 19 cumple WT-04 literal sin extender scope.

---

## Branches huérfanas tras `git worktree remove` (WT-04)

### Pregunta única — ¿Qué hacer con la branch?

| Option | Description | Selected |
|--------|-------------|----------|
| Borrarla con `git branch -D` tras remove ok | Si remove tuvo éxito → borrar branch. Filosofía: cleanup completo. | ✓ |
| Preservar la branch siempre | Default de `git worktree remove`. Branches acumulan. | |
| Borrar solo si no tiene commits únicos respecto a HEAD/main | Heurística defensiva. | |

**User's choice:** "Borrarla con `git branch -D` tras remove ok"
**Notes:** Cleanup completo si no hay nada que preservar. Si el cleanup hizo move-aside (dirty) o falló, la branch se preserva con el worktree para review humano. Nombre exacto de la branch → leer via `git -C <wt> branch --show-current` pre-remove (Claude's Discretion del planner).

---

## Fallback legacy v0.5 + eventos NDJSON

### Pregunta 1 — Sesiones legacy v0.5 (sin `worktree_path`)

| Option | Description | Selected |
|--------|-------------|----------|
| Skip cleanup silently — sin warn | Comportamiento v0.5 idempotente. Cero noise. | ✓ |
| Skip cleanup + log info | Como A pero emite log info para detectar drift. | |
| Computar path on-the-fly y limpiar defensivamente | `computeWorktreePath` + chequeo de existencia. Rompe semántica aditiva. | |

**User's choice:** "Skip cleanup silently — sin warn"
**Notes:** Consistente con D-06 (fallback silent en verify). Sesiones v0.6+ con bug que no persistan `worktree_path` quedan sin cleanup silenciosa → detection vía tests + observabilidad, no runtime warning.

### Pregunta 2 — Eventos NDJSON del cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| Eventos dedicados: `worktree.cleanup.ok / .dirty / .error` | Tres eventos tipados, payload por evento. Patrón de `logger-events.js`. | ✓ |
| Un solo evento `worktree.cleanup` con campo `result` | Denso pero menos descubrible. | |
| Reusar `session.end` con campo extra | Cero eventos nuevos pero mezcla semántica. | |

**User's choice:** "Eventos dedicados: `worktree.cleanup.ok / .dirty / .error`"
**Notes:** Grep-friendly + queryable vía `kodo logs --event worktree.cleanup.*`. El evento `skipped-legacy` se omite intencionalmente (silent fallback D-09).

---

## Claude's Discretion

- Comando exacto para move-aside (`git worktree move` nativo vs `mv` + `git worktree repair`).
- Orden exacto en stop hook entre cleanup, `removeSession`, y `notify orchestrator` (con la restricción dura: cleanup TRAS `releaseGsdLock`, restricción suave: `git worktree prune` al final).
- Determinación del nombre de la branch para `git branch -D` (lectura via `git -C <wt> branch --show-current` pre-remove recomendado).
- Decisión de inyectar info de worktree dirty en el nudge al orchestrator (nice-to-have opcional).
- Estructura de tests siguiendo Phase 16 `tmpdir + HOME override` + DI vía `runStopHook(input, deps)`.
- Shape exacto del payload de cada evento NDJSON.

---

## Deferred Ideas

- Bug latente: `findSession` no busca en `state.history` → verify post-stop falla. Issue dedicado para Phase 21+ o patch separado.
- `kodo gsd doctor` retroactivo para zombies pre-existentes (v0.7+ o backlog).
- Path consistency check runtime (`worktree_path` persistido vs `computeWorktreePath` canonical) → deferir a observabilidad si surge drift.
- Cleanup hook idempotencia explícita → cubierta naturalmente, documentar sin añadir lógica.
- `worktree_path` en `kodo logs --session-of` output (sigue deferido desde Phase 18).
- Auto-commit en sesiones-de-trabajo que toquen `.claude/skills/` → descartado por D-05b; reabrir solo si Phase 21 cambia el contrato.
- Nudge enriquecido al orchestrator con info de worktree dirty + skill.md update correspondiente.
