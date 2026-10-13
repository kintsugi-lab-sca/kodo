---
name: kodo-catchup
description: Ponerse al día como orquestador de kodo tras un finde o un tiempo sin actividad. Reúne en una sola pasada lo que ha pasado desde la última ronda (estado de kodo, git y PRs de cada repo vinculado, Plane, calendario y reuniones de Anarlog), lo convierte en un brief corto con fechas que mandan y trabajo a medias, y propone qué lanzar. No lanza nada sin un «go» del operador. Úsala cuando el operador diga «vamos a ponernos al día», «retomamos», «qué hay pendiente» o invoque /kodo-catchup.
argument-hint: "[since:YYYY-MM-DD] [days:7] [go]"
---

# kodo:catchup

Eres el orquestador de kodo arrancando después de un parón. El objetivo no es
un informe: es que en dos minutos el operador sepa **qué manda hoy, qué quedó a
medias y qué lanzamos**, y que tú puedas empezar la ronda con esa prioridad.

Argumentos (todos opcionales, en cualquier orden):

- `since:YYYY-MM-DD` — desde cuándo mirar. Por defecto, la última ronda tuya
  (último ack de `inbox-orch`; si no hay, el último handoff consumido).
- `days:N` — horizonte hacia delante para fechas límite y calendario (7).
- `go` — lanza la propuesta sin preguntar. Sin `go`, propones y esperas.

## 1. Recoger hechos (una llamada, ~1 min)

```bash
python3 -I .claude/skills/kodo-catchup/gather.py [--since YYYY-MM-DD] [--days N]
```

Imprime Markdown con cuatro bloques: **Local** (daemon, sesiones, inbox-orch sin
ver, cola de integración pendiente, capturas sin triar, último handoff), **Git /
PRs** por repo de `~/.kodo/projects.json` (ahead/behind, worktrees con commits
sin integrar o sin upstream, PRs abiertas sin contar bots), **Plane** por
proyecto (vencidas y próximas, In Review, In Progress, lanzables = label `kodo`
+ assignee en Backlog/Todo, actualizadas en la ventana, comentarios de otros) y
**Calendario** (eventos hasta el horizonte, vía `spark events`).

Cada fuente falla abierta: una línea «(no disponible: …)» no detiene nada. No
reescribas el script para «arreglar» una fuente caída; dilo en el brief.

## 2. Reuniones (Anarlog, MCP)

El script no llega a Anarlog. Hazlo tú, sin transcripts:

1. `mcp__anarlog__list_meetings` acotado a la ventana (desde `since`).
2. Para cada reunión relevante a un proyecto vinculado, `mcp__anarlog__get_meeting`
   y quédate solo con **acciones asignadas a Alex o a kodo** y **decisiones que
   cambian prioridad o fecha**. Si ya existe la tarea en Plane (busca por
   `work-items/search/`), enlázala; si no, es candidata a captura (`kodo capture`),
   no la crees tú en Plane sin preguntar.
3. Nunca pidas `get_meeting_transcript` aquí: el resumen basta y el transcript
   revienta el contexto (visto el 10-oct).

## 3. Redactar el brief

Formato fijo, cinco listas, **máximo 5 filas por lista**, lo demás se guarda
para cuando se pregunte. Cada fila lleva su ref (tarea, PR, rama, evento) para
que se pueda actuar sin releer.

```markdown
**Ventana:** desde <since> (<N> días sin ronda).

**1. Fechas que mandan** (calendario + target_date ≤ horizonte, lo más cercano primero)
- jue 15 10:00 · Estatus SCP → SCP-135 (demo, compromiso mar 14) sin empezar.

**2. A medias** (ramas sin push, PRs abiertas, In Review sin verificar, cola, capturas)
- ITCLIP-213 · rama en worktree sin push, cola pending; falta PR.

**3. Nuevo desde la última vez** (tareas creadas/movidas, comentarios de otros, acciones de reuniones)
- ITCLIP-214…217 creadas el sáb por Alex, todas Backlog sin label kodo.

**4. Ruido que conviene limpiar** (vencidas antiguas sin fecha real, worktrees muertos, PRs de bots)
- 13 PRs de dependabot en liken; 15 vencidas en ITCLIP con fechas de agosto.

**5. Propuesta de lanzamiento** (≤ max_parallel, orden = urgencia > impacto > esfuerzo, con el porqué)
1. SCP-135 — demo comprometida mañana; lanzable (kodo + assignee). 
2. …

¿Go? (`go` lanza en este orden; «go 1,3» solo esas; «no» y seguimos con ronda normal)
```

Reglas de redacción:

- **Lo que manda hoy va primero.** Un evento del calendario con una tarea
  ligada pesa más que cualquier Backlog con label `kodo`.
- **Una vencida de hace meses no es urgente, es ruido**: va al bloque 4, no al 1.
  Al bloque 1 van las que vencen dentro del horizonte o vencieron en la ventana.
- **No propongas lanzar lo que no es lanzable.** Si una tarea importante no tiene
  label `kodo` o assignee, dilo en el bloque 5 como «requiere label/assignee» y
  ofrece ponerlos; `kodo launch` la rechazará si no.
- **No arregles nada en este paso.** Ni triage de capturas, ni cerrar worktrees,
  ni mergear. Se lista; se actúa tras el go o cuando el operador lo pida.
- Respeta el límite de sesiones simultáneas de la skill de orquestación y las
  labels `kodo:sonnet` / `kodo:haiku`.

## 4. Tras el «go»

1. `kodo launch <ref>` en el orden propuesto; re-lee `~/.kodo/state.json` y
   confirma `status: running` por cada una.
2. `kodo inbox-orch ack --all`.
3. Las pendientes no lanzadas (In Review a verificar, ramas sin push, capturas)
   pasan a la ronda normal de `kodo-orchestrate`; si el operador no decide sobre
   alguna, queda en «Decisiones del operador pendientes» del próximo handoff.
4. Cierra con la línea de estado: `N lanzadas · M en review · K decisiones
   abiertas` y sigue con rondas.

## Lecciones

- 2026-10-13 · La ventana se calcula desde el último **ack** de `inbox-orch`,
  no desde el último cierre de sesión: un `session-end` que llegó mientras no
  había orquestador es precisamente lo que hay que revisar, no el punto de corte.
- 2026-10-13 · `integration_queue` acumula entradas `dropped` históricas (49 el
  13-oct); solo cuentan `pending`/`ready`.
- 2026-10-13 · Los worktrees de clipping marcan ~190 ficheros «sucios» por
  ficheros generados sin untracked; el script ya excluye untracked, y aun así
  cualquier cifra > 50 es señal de worktree abandonado, no de trabajo a medias.
