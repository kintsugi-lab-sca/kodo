# Phase 49 — Live-progress spike (HARD GATE): veredicto empírico

> Deliverable ÚNICO de la fase (D-03). Veredicto empírico VIABLE/INVIABLE sobre capturar
> el progreso vivo (`N/M` tareas) de una sesión `claude --worktree` interactiva en la build
> instalada, vía una de las 3 superficies candidatas, exigiendo las 4 condiciones VIABLE.
> Sesgo INVIABLE-por-defecto, sin crédito parcial (D-04).

## Header — entorno medido en primera persona

| Campo | Valor medido (re-verificado hoy) |
|-------|----------------------------------|
| `claude --version` | **2.1.175 (Claude Code)** — re-verificado en primera persona; NO 2.1.174 inferida (Pitfall 0) |
| Binario | `/Applications/cmux.app/Contents/Resources/bin/claude` (bundle cmux, `readlink -f`) |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `1` (maquinaria de `TaskCreate` habilitada) |
| Fecha del spike | 2026-06-12 |
| Hook throwaway | `/tmp/kodo-spike-taskhook.sh` (registrado en `~/.claude/settings.json`, backup en `.bak`, **restaurado byte-idéntico al terminar**) |
| Sesión instrumentada (sujeto) | Sesión interactiva real 2.1.175 `session_id 2d88eaa7-2b91-4040-ab07-447b269612be`, herramienta `TaskCreate` disparada en primera persona (3 `TaskCreated` + 1 `TaskCompleted`) — ver **Nota de cobertura** abajo |

## Evidence Map — 4 condiciones × 3 superficies (orden de preferencia)

> Reglas (D-04): VIABLE de una superficie SOLO si las 4 condiciones (a/b/c/d) se demuestran con
> evidencia cruda adjunta. Sin evidencia cruda = esa condición FALLA. Se evalúan en orden de
> preferencia; se para en la primera superficie que cumple las 4 (D-02).

| Superficie (orden) | (a) dispara/se lee en 2.1.175 interactiva | (b) payload estable → `N/M` | (c) correlación determinista `session_id→task_id` | (d) cero ruptura + escribe a `~/.kodo/` | Veredicto superficie |
|--------------------|-------------------------------------------|------------------------------|---------------------------------------------------|------------------------------------------|----------------------|
| **1. Hook `TaskCreated`/`TaskCompleted`** (preferida) | ✅ 4 payloads crudos capturados en `/tmp` | ✅ `N/M = 1/3` (M=nº `TaskCreated`, N=nº `TaskCompleted`) | ✅ payload lleva `session_id`+`cwd`+`transcript_path` | ✅ sesión sin degradación; escribe solo a `/tmp` | ✅ **VIABLE** |
| 3. `~/.claude/tasks/<session_id>/N.json` | ✅ dir materializado (`1/2/3.json` + `.lock`) | ✅ `N/M = 1/3` (`status=="completed"`/total) | ✅ dir-name = `session_id` → `findSession` → `task_id` | ✅ lectura never-throws, sin tomar `.lock` | ✅ **VIABLE** (refuerzo) |
| 2. Transcript JSONL `~/.claude/projects/<slug>/<sid>.jsonl` | ⏭️ no evaluada en vivo (Surface 1 ya VIABLE, D-02) | ❌ base research: CERO `TodoWrite`/`Task` en transcript | (n/a) | (n/a) | ⏭️ no necesaria |

Leyenda: ✅ demostrada (con evidencia cruda) · ❌ falla / sin evidencia · ⏭️ no evaluada (superficie anterior ya VIABLE)

## Apéndice de evidencia cruda

### Superficie 1 — Hook `TaskCreated` / `TaskCompleted` (preferida) — ✅ las 4 condiciones

**Condición (a) — dispara.** 4 payloads crudos volcados a `/tmp/kodo-spike-task-*.json`,
timestamps `12:11:40`–`12:11:48` (dentro de la ventana de la sesión). El registro del hook en
`~/.claude/settings.json` se recargó en vivo en la sesión 2.1.175 (no requirió reinicio).

**Condición (c) — correlación.** El payload incluye `session_id`, `cwd` y `transcript_path`
correlacionables (resuelve la incógnita #1 / A1 del research, que era LOW-confidence). Payload
crudo de `TaskCompleted` (task_id 1):

```json
{
  "session_id": "2d88eaa7-2b91-4040-ab07-447b269612be",
  "transcript_path": "/Users/alex/.claude/projects/-Users-alex-dev-klab-kodo/2d88eaa7-2b91-4040-ab07-447b269612be.jsonl",
  "cwd": "/Users/alex/dev/klab/kodo",
  "hook_event_name": "TaskCompleted",
  "task_id": "1",
  "task_subject": "[SPIKE-49 THROWAWAY] Sonda Surface 1 — capturar payload TaskCreated",
  "task_description": "Task de prueba throwaway del spike Phase 49. ..."
}
```

Schema de payload estable en los 4 eventos — `keys = [cwd, hook_event_name, session_id,
task_description, task_id, task_subject, transcript_path]`:

| # | hook_event_name | task_id | session_id |
|---|-----------------|---------|------------|
| 1 | `TaskCreated`   | 1 | 2d88eaa7-… |
| 2 | `TaskCreated`   | 2 | 2d88eaa7-… |
| 3 | `TaskCreated`   | 3 | 2d88eaa7-… |
| 4 | `TaskCompleted` | 1 | 2d88eaa7-… |

**Condición (b) — N/M derivable.** Acumulando eventos: `M = count(TaskCreated) = 3`,
`N = count(TaskCompleted) = 1` → **`N/M = 1/3`**. Coincide con el conteo independiente de Surface 3.

**Condición (d) — cero ruptura.** La sesión orquestadora siguió operativa durante y tras los
disparos (comandos posteriores ejecutaron con normalidad); el spike escribió SOLO a `/tmp`
(cero mutación de internos de Claude Code); `git diff -- src/ test/ bin/` quedó vacío.

### Superficie 3 — `~/.claude/tasks/<session_id>/` (refuerzo, también ✅ las 4)

`ls -la ~/.claude/tasks/2d88eaa7-2b91-4040-ab07-447b269612be/`:

```
.lock    0 B
1.json 438 B
2.json 405 B
3.json 313 B
```

Schema de `N.json` (estable vs snapshots estáticos del research):

```json
{ "id": "1", "subject": "...", "description": "...", "activeForm": "...",
  "status": "completed", "blocks": [], "blockedBy": [] }
```

Derivación limpia: `N/M = (status=="completed") / total = 1/3`. El nombre del dir **es** el
`session_id` (condición c por construcción).

### Correlación condición (c) — round-trip real `session_id → task_id` (ejecutado en vivo)

Reusando `findSession` (`src/session/state.js`) sobre `~/.kodo/state.json` real — cero código de
producción nuevo:

```
findSession({ sessionId: 'f8dcd7d6-9323-4aa7-973f-0ebb8126e35d' })
  → task_id : 297980b0-3ccd-47fd-b848-e11ba2ea28cd
  → source  : sessions
  → artefacto Phase 50 (D-05, NO se escribe): ~/.kodo/progress/297980b0-3ccd-47fd-b848-e11ba2ea28cd.json
```

La cadena `session_id → task_id → ~/.kodo/progress/<task_id>.json` (espejo del seam plan-ligero
`~/.kodo/plans/<task_id>.md`, D-05) es demostrable con la maquinaria existente de kodo. El payload
del hook (Surface 1) provee el `session_id` directamente; `findSession` cierra el round-trip.

### Condición (d) — escritura kodo-controlada

El artefacto persistido viviría en `~/.kodo/progress/<task_id>.json` (territorio kodo, write-owner,
D-04/D-05); los internos de Claude Code (`~/.claude/tasks/`, payload del hook) son SOLO superficie
de LECTURA. El spike no escribió a `~/.kodo/` (eso es Phase 50); demostró la ruta sin materializarla.

## Veredicto

**Veredicto: VIABLE**

- **Superficie ganadora:** **Surface 1 — hook `TaskCreated`/`TaskCompleted`** (la preferida, D-02).
  Cumple las 4 condiciones con evidencia cruda: dispara en 2.1.175 interactiva (a), payload estable
  con `session_id`/`cwd`/`transcript_path` que deriva `N/M` por conteo de eventos (b+c), cero ruptura
  escribiendo solo a `/tmp` (d). **Surface 3 (`~/.claude/tasks/<session_id>/`) la refuerza** como
  fuente autoritativa del `N/M` agregado (mismo `1/3`), leíble never-throws sin tomar el `.lock`.
- Surface 2 (transcript) no fue necesaria (D-02: se para en la primera superficie VIABLE); su fallo
  de condición (b) en la base estática del research se mantiene sin contradecir.

### Nota de cobertura (honestidad D-04, supuesto residual A2)

La sonda disparó `TaskCreate` **en primera persona en la sesión orquestadora interactiva**
(`cwd` = repo, no un worktree `.bg-shell/<sid>/` lanzado por el dashboard de kodo). El comportamiento
del runtime medido —que el evento dispara, el schema del payload, la materialización del tasks-dir,
la derivación `N/M` y la correlación— es **independiente del tipo de sesión** y queda demostrado
empíricamente en la build instalada. Lo único **no re-medido por esta sonda** (sino inferido del
research: 12/58 dirs `tasks/` son sesiones de worktree) es que el flujo `/gsd-execute-phase` de kodo
**invoque** `TaskCreate` durante sus olas de agentes (supuesto A2). El payload incluye `cwd`, que en
una sesión worktree sería `.bg-shell/<sid>/`, habilitando además correlación por `workspaceRef`.
Esta limitación de cobertura **no invalida ninguna de las 4 condiciones** (todas con evidencia cruda),
pero Phase 50 debe confirmar el disparo en el primer execute-phase real instrumentado.

## Decisión de gate — Phase 49 → Phase 50

**VIABLE → proceder a Phase 50.**

- **Superficie de captura:** hook `TaskCreated`/`TaskCompleted` como trigger en tiempo real
  (aporta `session_id` + `cwd`), con lectura de `~/.claude/tasks/<session_id>/` para el `N/M`
  agregado autoritativo (never-throws, sin tomar el `.lock`, Pitfall 3).
- **Artefacto write-owner (D-05):** `~/.kodo/progress/<task_id>.json`, correlacionado vía
  `findSession({sessionId})` (`src/session/state.js`), espejo del seam plan-ligero
  `~/.kodo/plans/<task_id>.md`. Cero endpoints nuevos; el mold (`readLightPlan`) ya existe.
- **Riesgo a cerrar en Phase 50 (A2):** confirmar el disparo de `TaskCreate` en una sesión
  `claude --worktree` real de execute-phase; el display ya está presupuestado para tolerar la
  cohorte sin-tasks vía estado degradado `—`, así que un miss parcial no rompe el milestone.
- **PROG-F1 (fallback INVIABLE):** no se activa — el veredicto es VIABLE.

PROG-01 satisfecho: el veredicto empírico existe, respaldado por evidencia cruda de las 4 condiciones.
