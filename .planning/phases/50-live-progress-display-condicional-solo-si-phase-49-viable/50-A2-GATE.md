# 50-A2-GATE — Veredicto del gate de apertura (D-01/D-02)

**Fecha:** 2026-06-13
**Versión Claude Code medida:** 2.1.175 (re-verificada en el momento — Pitfall 6/0 cerrado; coincide con el research)
**Plan:** 50-01 (Wave 0, checkpoint:human-verify, blocking-human)

---

## VEREDICTO A2: **CONFIRMA**

El supuesto A2 —load-bearing para TODO el valor de Phase 50— queda **CERRADO con evidencia cruda**, no inferido. `TaskCreate`/`TaskUpdate` disparan los hooks `TaskCreated`/`TaskCompleted` durante un `claude --worktree` real (cwd en un worktree, no el repo del orquestador), el tasks-dir se puebla por `session_id`, y la latencia del hook es negligible.

→ **Procede a ejecutar los Plans 02 (captura) y 03 (display).**

---

## Metodología

Instrumentación throwaway (espejo del harness del spike Phase 49), cero código de producción:

1. Hook throwaway `/tmp/kodo-a2-hook.cjs` (never-throws, cuerpo representativo D-04: `readdirSync` del tasks-dir sin tomar `.lock` + filtrado `.lock`/`.highwatermark` + recuento `status==="completed"` + 1 `writeFileSync` a `/tmp`).
2. Registrado en `~/.claude/settings.json` (backup `.a2bak` previo) para `TaskCreated`/`TaskCompleted` en **modo síncrono** (a propósito, para medir latencia real).
3. Lanzada una sesión worktree real vía el flujo de kodo:
   `claude -p --session-id <SID> --worktree <SID> --dangerously-skip-permissions '<prompt que usa TaskCreate/TaskUpdate>'`
4. Inspeccionados los volcados `/tmp/kodo-a2-*.json` + `~/.claude/tasks/<SID>/`.

---

## Evidence Map

| Condición | Resultado | Evidencia cruda |
|-----------|-----------|-----------------|
| **A1** — tasks-dir se puebla | ✅ | `~/.claude/tasks/050a809e-…/` con `1.json`…`8.json` + `.lock`; status 4 `completed` + 4 `pending` |
| **A2** — disparo en worktree real | ✅ | 16 volcados (`12× TaskCreated`, `4× TaskCompleted`) con `cwd = <repo>/.claude/worktrees/<sid>/` — NUNCA el repo raíz; **2 sesiones worktree distintas** (`050a809e`, `c8885f79`) dispararon |
| **A4** — cwd ≠ repo orquestador | ✅ | Todos los payloads traen `cwd` apuntando al worktree, confirmando que el disparo NO es el escenario de primera-persona del spike |
| **D-04** — recuento autoritativo self-healing | ✅ | El hook deriva `n/m` recontando el dir en cada disparo (ej. `2/8` con 8 entries y 2 completed); el `.lock` presente NO se cuenta |
| **Schema `N.json`** | ✅ | `{ id, subject, description, status, blocks, blockedBy }`; status estricto `pending`/`completed` (coincide con research) |
| **Latencia (Pitfall 1)** | ✅ negligible | Coste total de invocación síncrona del hook: **~30-40ms/evento** (`/usr/bin/time -p`, 5 corridas: 0,03-0,04s); cuerpo solo ~5-7ms; por debajo del umbral de perceptibilidad (~100ms) |

### Payload de ejemplo (crudo, worktree)
```json
{
  "hook_event_name": "TaskCreated",
  "session_id": "050a809e-f9be-4f87-b092-71cfc04326f0",
  "cwd": "/Users/alex/dev/klab/kodo/.claude/worktrees/050a809e-f9be-4f87-b092-71cfc04326f0",
  "payload_task_id": "1",
  "derived": { "n": 0, "m": 4, "dir_readable": true },
  "timing": { "hook_body_ms": 6.00 }
}
```

---

## Hallazgo lateral (no bloqueante — anotar para Plan 02)

**Discrepancia de path del worktree.** El `claude --worktree <sid>` real materializa el worktree en **`<repo>/.claude/worktrees/<sid>/`**, NO en `.bg-shell/<sid>/` como asume `computeWorktreePath` (`src/session/state.js`). 

**Impacto en Phase 50: NINGUNO.** El hook de captura (D-04) lee `~/.claude/tasks/<session_id>/` — ubicación **global keyed por session_id, independiente del cwd del worktree**. La correlación (D-05) usa `session_id` del payload → `findSession`. Por tanto el mecanismo de captura es indiferente a dónde viva el worktree. (La discrepancia `.bg-shell` vs `.claude/worktrees` es una observación sobre `computeWorktreePath`/doctor que excede el scope de Phase 50; registrar como hallazgo si afecta a doctor/dismiss a futuro.)

---

## Decisión de gate (D-02)

- **A2 CONFIRMA** → proceder a Plans 02/03. ✅ **Esta es la rama tomada.**
- ~~A2 FALLA → cortar vía PROG-F1~~ — no aplica.

### Recomendación load-bearing para el Plan 02 (modo de registro del hook)
- **Modo síncrono + cuerpo mínimo es ACEPTABLE** (~35ms/evento, imperceptible). No se requiere `async` para cumplir el Success Criteria 1 ("sin latencia perceptible").
- **Mantener el cuerpo mínimo**: `readdirSync` + filtrado + N parseos baratos + 1 `writeFileSync`. `findSession` vía import dinámico lazy (no encarece el cold-start salvo en el disparo real).
- **`async:true`/`asyncRewake:true`** queda como optimización OPCIONAL si en uso real con sesiones muy intensas en tasks se notara acumulación; no es necesario para v1. (Open Question 1 resuelta: sync basta.)

---

## Reversibilidad

- `~/.claude/settings.json` restaurado byte-idéntico desde `.a2bak` (hook throwaway desregistrado).
- `git diff -- src/ test/ bin/` vacío (cero código de producción tocado).
- Volcados `/tmp/kodo-a2-*.json` y worktrees de prueba (`050a809e`, `c8885f79`) eliminados.
