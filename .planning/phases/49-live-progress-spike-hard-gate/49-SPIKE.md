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
| Hook throwaway | `/tmp/kodo-spike-taskhook.sh` (registrado en `~/.claude/settings.json`, backup en `.bak`) |
| Comando GSD del sujeto | _(a documentar en Task 2 — qué `/gsd-execute-phase` de qué fase corrió la sesión instrumentada)_ |

## Evidence Map — 4 condiciones × 3 superficies (orden de preferencia)

> Reglas (D-04): VIABLE de una superficie SOLO si las 4 condiciones (a/b/c/d) se demuestran con
> evidencia cruda adjunta en el apéndice. Sin evidencia cruda = esa condición FALLA. Se evalúan
> en orden de preferencia; se para en la primera superficie que cumple las 4.

| Superficie (orden) | (a) dispara/se lee en 2.1.175 interactiva | (b) payload estable → `N/M` | (c) correlación determinista `session_id→task_id` | (d) cero ruptura + escribe a `~/.kodo/` | Veredicto superficie |
|--------------------|-------------------------------------------|------------------------------|---------------------------------------------------|------------------------------------------|----------------------|
| 1. Hook `TaskCreated`/`TaskCompleted` | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ |
| 2. Transcript JSONL `~/.claude/projects/<slug>/<sid>.jsonl` | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ |
| 3. `~/.claude/tasks/<session_id>/N.json` | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ pendiente | ⬜ |

Leyenda: ✅ demostrada (con evidencia cruda) · ❌ falla / sin evidencia · ⬜ pendiente · ⏭️ no evaluada (superficie anterior ya VIABLE)

## Apéndice de evidencia cruda

### Superficie 1 — Hook `TaskCreated` / `TaskCompleted` (preferida)
_(Adjuntar: payload(s) crudo(s) de `/tmp/kodo-spike-task-*.json` capturados durante la sesión viva.
Indicar si el payload lleva `session_id`/`cwd`/`transcript_path` → resuelve condición (c).)_

```
(pendiente — evidencia cruda Task 2)
```

### Superficie 2 — Transcript JSONL
_(Adjuntar: resultado del scan del `.jsonl` de la sesión sujeto buscando entradas task/todo de las
que derivar N/M. Base estática del research: CERO `TodoWrite`/`Task` → probable fallo de (b).)_

```
(pendiente — evidencia cruda Task 2)
```

### Superficie 3 — `~/.claude/tasks/<session_id>/` (último recurso)
_(Adjuntar: `ls -R ~/.claude/tasks/<session_id>/` con timestamp dentro de la ventana de sesión y
el cálculo N/M = ficheros con `status:"completed"` / total ficheros `N.json`. Lectura never-throws,
sin tomar el `.lock`, Pitfall 3.)_

```
(pendiente — evidencia cruda Task 2)
```

### Correlación condición (c) — round-trip real `session_id → task_id`
_(Adjuntar: el mapeo de UNA sesión real `session_id → task_id → ~/.kodo/progress/<task_id>.json`
resuelto vía `findSession({sessionId})` sobre `~/.kodo/state.json`. NO escribir el artefacto —
solo demostrar la cadena, D-05.)_

```
(pendiente — evidencia cruda Task 2)
```

### Condición (d) — cero ruptura / escritura kodo-controlada
_(Constatar: la sesión completó sin degradación/stall durante el polling de lectura, y el spike
escribió SOLO a `/tmp` — cero mutación de internos de Claude Code.)_

```
(pendiente — evidencia cruda Task 2)
```

## Veredicto

**Veredicto: PENDIENTE** _(se emite en Task 3 tras rellenar el Evidence Map. VIABLE solo si una
superficie demuestra las 4 condiciones con evidencia cruda; cualquier fallo único → INVIABLE, D-04.)_

- Superficie ganadora (si VIABLE): _(pendiente)_
- Conjunto de fallos por superficie (si INVIABLE): _(pendiente)_

## Decisión de gate — Phase 49 → Phase 50

_(Se emite en Task 3, Success Criteria #5 del ROADMAP.)_

- **Si INVIABLE:** Phase 50 se corta entera (sin stub/placeholder); PROG-02/03 → v2 vía PROG-F1;
  el milestone cierra con OPEN-* + NYQ-03 sin penalización.
- **Si VIABLE:** proceder a Phase 50, nombrando la superficie ganadora y la ruta del artefacto
  `~/.kodo/progress/<task_id>.json` (D-05) que la captura usaría.
