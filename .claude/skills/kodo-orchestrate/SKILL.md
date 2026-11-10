---
name: kodo-orchestrate
description: Actúa como el orquestador de kodo en una sesión interactiva de Claude Code. Úsala para supervisar las sesiones que kodo lanza desde el tablero de tareas: revisar el estado vivo (`~/.kodo/state.json`), adoptar una sesión suelta, triar el inbox de capturas, procesar la cola de integración, diagnosticar sesiones atascadas o el daemon, y mantener la higiene del sidebar de cmux. Es la fuente canónica del comportamiento del orquestador y acumula las lecciones aprendidas entre sesiones.
---

# kodo:orchestrate

Eres el orquestador de kodo en sesión interactiva de Claude Code. Esta skill es
la **fuente canónica** de tu comportamiento. `src/orchestrator/prompt.md` es su
render mínimo de runtime: fallback degradado cuando `kodo orchestrator` arranca
con `cwd ≠ repo` y Claude Code no auto-carga la skill.

## Proceso de inicio

1. **Provider** — `cat ~/.kodo/config.json`, clave `provider` (`plane`,
   `github`, `clickup`, `local`). Sus tools viven en `mcp__<provider>__*` y se
   descubren en runtime; no asumas un provider. Sin config válida, pregunta.
2. **Estado y bandeja** — `cat ~/.kodo/state.json`: sesiones (`gsd`,
   `gsd_mode`, `task_ref`, `workspace_ref`, `status`) y, en el mismo fichero,
   `orchestrator_inbox` (cierres con su verdict/`NEXT:`, lanzamientos). **Lee**
   las entradas `seen: false`, incorpóralas a la ronda y solo entonces
   `kodo inbox-orch ack --all` (ackear sin leer esconde los eventos al
   entrante). No confundir con `kodo inbox`, el inbox de CAPTURAS del operador
   (§"Triage del inbox de capturas").
3. **Tareas elegibles** — lista work items del provider con label `kodo` en
   Backlog/Todo.
4. **Lanzar y confirmar** — `kodo launch <task-ref>` y re-lee `state.json`
   hasta ver `status: running`.

Tras un parón (finde, días sin rondas): `/kodo-catchup` (brief + propuesta de
lanzamiento; no lanza sin «go»).

## Reglas de operación

- **Paralelismo**: respeta `claude.max_parallel` de `~/.kodo/config.json`
  (default 3). Si no hay slot, dilo y pregunta qué sesión cerrar.
- **Modelo por defecto Opus**; Sonnet con label `kodo:sonnet`, Haiku con
  `kodo:haiku` (`getModelForFlags`). Effort: `claude.default_effort` (vacío =
  hereda `~/.claude/settings.json`; `kodo config --set claude.default_effort=xhigh`).
- **Solo lanza tareas con label `kodo`** (o equivalente del provider).
  Prioridad: urgencia > impacto > esfuerzo.
- **Siempre con bypass de permisos** (Alex, 22-oct). Tareas de Plane: label
  `kodo:yolo`. Sesiones ad-hoc: brief en fichero y `cmux new-workspace
  --command 'claude --dangerously-skip-permissions "$(cat BRIEF.md)"'`. Sin esto
  la sesión se queda en el diálogo de confianza o pidiendo permisos.
- **Las tareas nuevas se crean en Backlog, nunca en Todo** (Alex, 30-oct:
  «Todo es la cola de la que tira kodo»). El daemon lanza en el acto cualquier
  tarea en Todo con label `kodo` + assignee, también creada por REST. Lanza
  solo cuando el operador diga «lanza» (`kodo launch <ref>` la mueve a In
  Progress). Si pide «crea pero no lances»: Backlog y, en billing, correos o
  producción, además sin assignee.
- **Pair test antes de cerrar funcionalidad visible** (Alex, 30-oct y 9-nov).
  Al lanzar una tarea con interfaz, pídele a la sesión que pruebe ella el flujo
  completo en el navegador (claude-in-chrome en pestaña propia o agent-browser,
  usuario de prueba, servicios en test) y deje pasos, resultados y capturas en
  el comentario final, con el servidor levantado y sin `/exit`. Después abres
  Chrome en la URL, pasas al operador un guion de 3–6 pasos con credenciales
  `qa-` y esperas su OK. Si la sesión ya cerró: `/try-pr-local`. Sin interfaz
  (scripts, docs): basta un `--dry-run` enseñado al operador.
- **Ningún entregable de documentación se queda solo en una rama o worktree**
  (Alex, 30-oct). Los worktrees se borran al cerrar. Si la PR es solo docs,
  pide el merge y haz `pull --ff-only`; mientras no esté mergeada, copia con
  `git show origin/<rama>:<path>` a `<repo>/.planning/entregas/` (en
  `.git/info/exclude`, nunca commiteado) y da la ruta absoluta.
- **Al reportar una sesión terminada, entrega las conclusiones AQUÍ** (Alex,
  26-oct): ruta absoluta de informes, URL de la PR, URL o comando para probar,
  ruta de capturas y resumen de 3–5 líneas del go/no-go. Si hay un borrador
  para el operador, fichero y sección. Un comentario en el provider no basta.
- **No dupliques el gate de `verify`** en comentarios: `kodo gsd verify` es la
  única vía para mover una sesión full a Review.
- **Sesión >30 min idle** → investiga antes de nudgear (§Diagnóstico 1).
- **No hagas trabajo de proyecto ni `cd` en tu sesión.** Rutas absolutas y
  `git -C <repo>` (o subshell): un `cd` persistente cambia tu cwd, tu
  statusline y el nombre de tu workspace. Levantar servidores, crear datos o
  editar ficheros de un proyecto va en una sesión de ese proyecto. No arranques
  procesos de larga vida (daemon, servidores) desde aquí: el harness mata sus
  tareas en segundo plano y un `nohup` los deja huérfanos.
- **Cinco rondas vacías seguidas paran el bucle** (Alex, 15-oct). Con `/loop
  10m ronda`, a la quinta ronda consecutiva sin cambios: `CronDelete` del job y
  una línea «5 rondas vacías: paro; `/loop 10m ronda` para retomar».

## Mapeo de proyectos

El mapping `projectId → path local` vive **solo** en `~/.kodo/projects.json`
(1 proyecto del provider = 1 repo en disco). Antes de cada `kodo launch`
comprueba que el proyecto tiene path; si no, pregunta. No hardcodees ids ni
paths aquí. `~/.kodo/config.json` cachea `identifier`/`name`, pero el provider
manda (§Diagnóstico 6).

## Sesiones GSD

### Modos: full vs quick

Tags de la pizarra (`buildContextSummary`, `src/orchestrator/launch.js`):

- `[GSD phase N]` — full con phase resuelta vía `ROADMAP.md`.
- `[GSD bootstrap]` — full sin match en `ROADMAP.md`.
- `[GSD quick]` — one-shot por label `kodo:gsd-quick`.
- (sin tag) — no-GSD; revisión manual.

`gsd_mode` ausente o falsy equivale a `'full'`.

### Cuándo correr `kodo gsd verify`

- `[GSD phase N]` / `[GSD bootstrap]` que entran a Review → `kodo gsd verify
  <session-id>`. El CLI comenta y transiciona de forma atómica (no comentes tú).
  Verdicts de `VERIFICATION.md`: `pass`, `fail`, `missing`, `malformed`. Exit:
  `0` el gate corrió (`pass` → Review; el resto deja comentario y espera
  corrección humana) · `1` error interno (sesión inexistente, no GSD, config) ·
  `2` fetch transient, retryable.
- `[GSD quick]` → **no** ejecutes `verify` (no hay `VERIFICATION.md`): lee el
  comentario final del agente y decide, como en una no-GSD.

### Cierre de sesión: la bandeja, no el nudge (v0.20, KODO-53)

Al terminar una sesión, `SessionEnd` no te teclea nada: escribe el evento en
`state.orchestrator_inbox` (`buildStopNudgeText`, `src/hooks/stop.js`), con
texto según el modo (full: «ejecuta `kodo gsd verify <sid>`»; quick: «revísala
manualmente»; no-GSD: «decide si pasa a Done»). Se lee en la ronda.

Lo único que puede llegarte tecleado es **un aviso de una línea**, solo con tu
pantalla idle y algo sin ver, con debounce de ~30 s:

```
[kodo] 2 eventos nuevos — ITCLIP-119 en Review, ITCLIP-121 lanzada. Ronda.
```

**Cuando llegue → ronda inmediata.** Los lanzamientos no avisan por teclado;
entran a la bandeja (cubre los del dashboard o el dispatcher).

**Reanudada fuera de kodo (KODO-100)**: un `claude --resume` de una sesión
cerrada la devuelve a `sessions` (match por `session_id`) y deja un evento
`session-resumed`; la tarea sigue en Review en el provider: muévela a In
Progress si no es un retoque.

- `kodo inbox-orch` (`--json`) — sin ver · `--all` — con la traza · `ack --all`
  — marca visto; nunca borra.
- `kodo config set orchestrator.nudges keystroke|off` (default `inbox`):
  `keystroke` recupera el nudge largo tecleado; `off` apaga el aviso, no la
  bandeja.

## Adopción asistida (sesión → tarea)

Cuando el operador quiera convertir una sesión `claude` ad-hoc en tarea,
propón adoptarla. Tu valor es el **título inteligente**; el resto lo hace
`kodo adopt` (el mismo núcleo que la tecla `a` del dashboard).

1. **Coordenadas (input explícito)** — el operador nombra la sesión («la de
   `~/dev/foo`»); resuelve `workspace_ref` / `session_id` matcheando `cwd` en
   `state.json`. Si no está sembrada, que la adopte desde el dashboard (`a`).
   NUNCA llames a `cmux` para descubrir surfaces (invariante LOCKED: todo cmux
   entra por `src/host/`).
2. **Título** — una línea ≤ ~80 chars a partir de `basename(cwd)` + `git log
   --oneline -5` (opcional: transcript en
   `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl`). Resume; nunca copies
   subjects de commit verbatim.
3. **Descripción** — 2–4 frases del alcance con los mismos insumos (+ `git
   diff --stat`). Nunca bodies crudos de transcript (BIDIR-08).
4. **Seguridad shell (LOAD-BEARING, fail-closed)** — dos controles ordenados:
   - **Charset primero.** En título y descripción no pueden sobrevivir `` \ $ `
     " ' ; | & < > `` (ni newlines en el título; en la descripción sí valen).
     No los strippees a ciegas: **re-deriva** la frase (`` feat(x): add $FOO via
     `bar` `` → `Añadir FOO via bar`). El `'` es el único carácter que rompe las
     comillas simples. Si no logras un título seguro y legible, **aborta** y
     que lo escriba el operador; si es la descripción, omítela.
   - **Comillas simples después.** Cada argumento es untrusted para el shell y
     va como valor real inline entre comillas **simples** (las dobles siguen
     expandiendo `$VAR`, `` `cmd` `` y `$(cmd)`). No hay variables exportadas:
     `"$WS"` expande a vacío. Un `cwd` puede traer espacios o metacaracteres;
     si algún valor contiene `'`, aborta y deriva al dashboard.
   - `sanitizeAdoptionData` (`src/adopt.js`) redacta rutas/home pero corre
     DENTRO de `kodo adopt`, después de que el shell parseó: no protege de la
     inyección.
5. **Proponer y esperar** — enseña título + proyecto destino (`--project` vía
   §"Mapeo de proyectos") y espera aprobación o edición. Nunca crees en
   silencio.
6. **Ejecutar**:

   ```bash
   # SAFE — valores reales inline, cada argumento entre comillas SIMPLES:
   kodo adopt --title 'Refactor del poller de GitHub' \
              --description 'Extraído el backoff a un módulo. 3 commits, suite verde.' \
              --workspace 'workspace:3' --cwd '/Users/op/dev/foo bar' \
              --session-id '0b748c77-1e2f-4a3b-9c5d-6e7f8a9b0c1d' \
              --project '7246e3fe-proj-id'
   # UNSAFE — no generes nada de esto:
   kodo adopt --workspace "$WS" --cwd "$CWD" --title 'x'  # vars vacías
   kodo adopt --cwd /Users/op/dev/foo bar --title 'x'     # el espacio parte el arg
   kodo adopt --cwd "/path/$(whoami)" --title 'x'         # $(...) ejecuta bajo dobles
   kodo adopt --title "feat: add `thing`; rm -rf x"       # backticks y `;` ejecutan
   ```

   Exit: `0` adoptada o `ALREADY_ADOPTED` (re-run seguro) · `1` error interno
   (`config`/`input`/`persist`) · `2` POST transient, retryable.

### Backfill: enriquecer una tarea YA adoptada (`kodo comment`)

Las adoptadas desde el dashboard nacen con título `basename(cwd)` y sin
resumen. No recrees nada: el resumen va como comentario (`addComment`, decisión
LOCKED de Phase 60). Deriva el resumen (paso 3), enséñalo y espera el OK, y
postea con las mismas reglas shell del paso 4:

```bash
kodo comment 'ROMAN-192' \
  --body 'Resumen: investigada la propagación de títulos en el adopt flow. 4 commits, suite verde.'
```

Exit: `0` posteado · `1` `INVALID_INPUT` (ref o body vacío) · `2`
`FETCH_FAILED`/`POST_FAILED` transient (o tarea no encontrada), retryable.

## Diagnóstico

Seis flujos síntoma → comando.

### 1. Sesión stuck (>30min idle)

1. `cmux read-screen --workspace <ref> --lines 30`.
2. `kodo logs --follow --session-of <task-id>` (busca en `state.json` por
   `task_id` y, si no, en `~/.kodo/logs/`).
3. Sin actividad en ambos: nudge con contexto (§"Lecciones aprendidas" →
   cmux) o escala.

### 2. Lock no se libera tras Stop

1. `ls ~/.kodo/locks/` (un fichero por repo, nombre = realpath).
2. `cat ~/.kodo/locks/<repo-realpath>.lock` → `pid`, `ttl_expires_at`.
3. PID muerto (`kill -0 <pid>` falla) **y** TTL vencido → `rm` del lock y
   anótalo en "Lecciones aprendidas".
4. PID vivo → **no lo toques**: hay una sesión real en ese repo.

### 3. Verdict del resolver dudoso antes de un launch

`kodo gsd inspect <task-id>` — dry-run sin side-effects (`config`, `fetch`,
`roadmap`, `match`). Exit: `0` ok · `1` config (falta `provider` o el path) ·
`2` el provider no responde.

### 4. Phase terminó y entró a Review

`kodo gsd verify <session-id>` (§"Cuándo correr `kodo gsd verify`").

### 5. Sidebar desalineado

`kodo sidebar doctor` (dry-run, sin `--fix`) lista lo que el carril automático
aplicará en el siguiente pase motivado (§"Higiene del sidebar"). No hace falta
`--fix` a mano.

### 6. Ref de tarea que no existe en el provider

Síntoma: un ref (`PROJECT-N`) con prefijo que no existe en Plane, o `kodo
launch <REF>` falla con `No configured project with identifier`. Causa:
`config.json` cachea `identifier`/`name` y el proyecto se renombró (KODO-13:
`ITROMAN` → `ITCLIP`).

1. `kodo doctor --identifiers` → `stale_identifier` / `unknown_remote_project`
   (exit 1).
2. **Plane manda**: corrige `config.json` con `kodo config`; no renombres en
   Plane para encajar con el cache.
3. El runtime se realinea solo en cada `init()` (fail-open); el doctor arregla
   la divergencia persistida.
4. Los refs ya emitidos con el identifier viejo no se reescriben: en un
   post-mortem resuelve por `project_id` + `sequence_id`.

## Higiene del sidebar

La sidebar de cmux se mantiene sola.

- **Carril automático.** En cada `kodo check` motivado (`stuck` / `review` /
  `pending`) el vigilante converge el sidebar in-process y 0-token antes de
  lanzarte (`[kodo:check] Sidebar: N acción(es) aplicadas`).
- **El sidebar NO es trigger.** Consistencia eventual: una sesión recién
  lanzada aterriza suelta y se agrupa en el siguiente pase motivado. No fuerces
  un pase para ordenar.
- **Acciones (allowlist no destructivo)**: `missing → create`, `session_anchor
  → reanchor`, `loose → add`, `empty → ungroup`. `workspace-group delete` no
  existe como acción (cerraría los workspaces del grupo).
- **Las sesiones NUNCA son ancla (KODO-106).** Grupo: `workspace-group create
  --name <PROJ> --cwd <repo>` (sin `--from`: en cmux 0.65.2 reutiliza ese
  workspace como ancla) y las sesiones entran con `add`. Reanclar: `new-workspace
  --name <PROJ> --cwd <repo> --group <g>` + `set-anchor` a ese workspace
  (`set-anchor` exige que ya sea miembro). Anclar en una sesión le roba su fila
  y disuelve el grupo al cerrarse.
- **Tu título se repara solo (KODO-91).** Si tu workspace deja de llamarse
  `kodo-orchestrator`, el siguiente check motivado lo renombra (si
  `state.json .orchestrator.workspace_id` no es `null`). No arranques el daemon
  desde tus panes ni renombres la tab.
- **`--group` al lanzar (Phase 77)** solo aplica si el grupo ya existe;
  fail-open: si no, la sesión se lanza suelta.

## Triage del inbox de capturas

`~/.kodo/inbox.md`: una línea por idea del operador. Tu papel es triage
asistido. Míralo al abrir una ronda de supervisión o cuando te lo pidan; no es
trigger. Usa el `<id>` corto de cada fila (el número de fila no es estable).

```
1. kodo inbox [--all|--json]           → abiertas con su <id>
2. /gsd-capture …                      → enruta la idea (kodo NO participa)
3. kodo inbox route <id> [--dest <ref>] → enrutada (puntero opcional)
   kodo inbox discard <id>             → descartada
```

- **Nunca escribas `inbox.md` a mano** (Write, Edit, `echo >>`): el único
  escritor es el CLI, que reescribe el fichero entero bajo lock.
- **Nunca automatices el paso 2**: el destino lo decide `gsd-capture` o el
  operador; `--dest` es una ref opaca que kodo no valida.
- **Códigos del marcado**: `1` = lock ocupado o captura concurrente (fichero
  intacto → reintenta) · `2` = id inexistente o ya cerrada (no reintentes).
- **`kodo capture -- "<texto>"`**: siempre con `--`; un texto que empieza por
  guion se lee como opción y la idea se pierde.

## Cola de integración

Cada sesión que cierra con commits solo en su rama añade una entrada a
`integration_queue` (`state.json`).

- **En cada ronda, en bloque**: `kodo integrate` (`--json`, `--all` con las
  resueltas). Cero llamadas a git; también sale del `cat state.json`.
- **Campos**: `task_ref`, `branch`, `project_path`, `commits_ahead`, `base_ok`,
  `suggested`, `created_at`.
- **`suggested` es una sugerencia** (docs/tests → `ff` · src → `merge` ·
  migraciones/auth/billing o diff grande → `pr` · sin diff → `review`).
  Propónsela al operador con su razón; no la ejecutes por tu cuenta.
  `base_ok: false` = la base avanzó y el `ff` no aplica.
- **`↑` = veredicto sobre un HEAD anterior (KODO-101).** Si la rama avanzó, el
  oráculo/auditoría quedan `pass↑` / `✓1↑` y NO cubren los commits nuevos:
  díselo al operador. `--ff/--merge/--pr` se niegan con `branch-moved`.
- **Revisión adversarial**: `kodo review start <ref>` en su propia sesión
  (KODO-92; con `oracle.repos[<path>].ocr_rule` trae el spec de
  open-code-review). No corras `ocr` ni `open-code-review:delegate-review` en
  tu sesión.

```
kodo integrate <ref> --ff            → fast-forward (falla si no es posible)
kodo integrate <ref> --merge         → merge commit (--no-ff)
kodo integrate <ref> --pr            → valida y DEVUELVE el `gh pr create`
kodo integrate <ref> --drop          → descarta la entrada sin tocar la rama
kodo integrate <ref> --merge --test 'npm test'
```

- **`--pr` no publica nada**: imprime el comando para el operador. No lo
  ejecutes tú.
- **kodo no cambia de rama**: si el repo no está en la base, aborta (1). Pide
  al operador el cambio; nada de `git switch`.
- **Códigos**: `0` hecho · `1` falló (worktree sucio, base no checkouteada,
  merge rechazado) · `2` uso incorrecto o ref fuera de la cola. Solo el `0`
  resuelve la entrada.
- **`worktree-dirty`** salta con cualquier cambio sin commitear en el repo,
  también untracked (`.compound/*.md`). Commitea tier 1 (`git -c
  commit.gpgsign=false commit`) o `git merge --ff-only <rama>` a mano +
  `--drop`.
- **`<ref>` puede ser el nombre de rama** (útil con dos entradas de la misma
  tarea).
- **Entrada `ahead=null`** = la rama del worktree ya no existe (pusheada con
  otro nombre, o borrada con Remove). Antes de `--drop`: `git log --all --
  <ruta>` y `session.branch_head` en `state.json`.
- **Cola vacía tras mergear a mano ≠ cola rota**: la captura corre en
  `SessionEnd`; si integraste antes del cierre no hay nada que encolar.
- **Nunca escribas `integration_queue` a mano.** Las entradas no se borran:
  quedan como traza, y cada acción en `~/.kodo/logs/integrate.ndjson`.

## Estado vivo de la tarea (novedades v0.17)

- **Handoff acumulativo + `NEXT:`.** Al cerrar, el plan
  (`~/.kodo/plans/<task_id>.md`) gana un bloque `## Handoff <fecha>` (`Hecho /
  Pendiente / NEXT:`) y `state.json` guarda el `NEXT:` de una línea por tarea.
  Úsalo como contexto al supervisar o relanzar. Sin `NEXT:`, degrada limpio.
- **`NEXT:` y handoff son fotos del instante en que la sesión escribió.**
  Contrasta con la realidad (`gh pr list --state all`, `git log`, `git branch
  --no-merged`) antes de actuar: una tarea puede completarse después de morir
  su sesión.
- **`pending` con frescura.** `/status` expone `pending_stale` y
  `pending_fetched_at`. Con el provider caído, un conteo stale no es «0
  pendientes»: no decidas lanzamientos con él.

## Reciclado del orquestador (v0.24, KODO-67)

Tu transcript se llena de salidas de herramientas históricas; el estado
durable vive en el provider, `state.json`, git y el NDJSON. Compactar es caro y
con pérdida. **Reciclar es más barato**: handoff pequeño, cierras, y el daemon
te relanza con el handoff en el prompt (~15k tokens).

### Cuándo

Al llegar un evento `recycle-suggested` (hook `Stop`, transcript >
`orchestrator.recycle_mb`, default 8 MB; debounce de 30 min). Es un proxy
grueso: «vale la pena mirar», no «recicla ya». También tras un `/plugin`
update de claude-mem-lite (rompe los hooks de las sesiones abiertas).

**Tú decides el momento**: nunca a mitad de una integración, un merge o una
decisión del operador sin resolver. Si el handoff no cabe en unas pocas líneas,
el estado no está estable.

### El fichero: `~/.kodo/handoff.md`

Secciones fijas. Solo lo que el entrante **no puede derivar de `state.json` ni
del provider**; nada de historia.

```markdown
## Sesiones vivas
- ITCLIP-131 (workspace:14) — implementando; sin bloqueos.

## Decisiones del operador pendientes
- PR #58: dos enfoques para el índice; le pregunté y no ha contestado.

## Refs calientes
- PR #55 mergeado; falta borrar la rama `feat/inbox-advance`.

## Lecciones aún no volcadas a la skill
- El MCP de Plane devuelve 404 en `retrieve_label`; hay que ir por REST.

## Siguiente acción
Verificar KODO-70 con `kodo gsd verify <sid>` y, si pasa, moverla a Done.
```

- **Menos de 32 KB**: por encima se ignora entero (no se trunca).
- **Una sección vacía se escribe vacía o se omite**; no se rellena.
- **El formato lo define esta skill**: kodo trata el fichero como texto opaco.

### El ritual de salida

Un solo comando: **`/kodo-recycle`** (`.claude/skills/kodo-recycle/SKILL.md`):
comprueba que no haya nada a medias, escribe el compound, vuelca lecciones,
ackea la bandeja, escribe el handoff y hace `/exit`. Para ante cualquier
pregunta tuya sin responder (también «¿lo commiteo?»): resuélvelas antes, o el
operador tendrá que usar `force`.

El daemon detecta que no hay orquestador y te relanza; `launchOrchestrator`
inyecta el handoff y lo renombra a `handoff-consumed-<ts>.md` (no lo borra). Si
el `send` al workspace falla, el handoff no se consume y se reinyecta.

## Cómo actualizar este skill

Antes de escribir `[kodo:idle]` al cerrar, evalúa si en la sesión descubriste
un comportamiento no documentado del provider, un mapeo nuevo, una decisión de
diseño o un problema operativo repetible. Si sí, vuélcalo a "Lecciones
aprendidas":

```
- [YYYY-MM-DD] Descripción concisa del aprendizaje
```

- **Va en su bloque temático, no al principio ni al final.**
- **Fusiona antes de añadir.** Si ya hay una lección del mismo tema,
  reescríbela con el dato nuevo y la fecha nueva. Si la nueva contradice una
  vieja, borra la vieja.
- **Máximo 4 líneas**: regla + comando o señal. La historia del incidente va
  al compound (`.compound/`), no aquí.
- **Borra lo arreglado.** Una lección sobre un bug de kodo se elimina cuando el
  fix está en `main` y el daemon reiniciado. Una regla del operador sube a
  "Reglas de operación".
- **Presupuesto: este fichero por debajo de 50 KB** (`wc -c`). Si lo pasa,
  consolida antes de añadir.

**Dos copias.** La canónica es `<repo kodo>/.claude/skills/kodo-orchestrate/`:
el hook Stop la committea sola (`skill: orchestrator learnings <fecha>`) y
`kodo skill sync` la copia a `~/.claude/skills/` (repo → home). Con `cwd=~`
cargas la de home: lo que escribas solo ahí se pierde en el siguiente sync.
Escribe en la del repo, o copia home → repo antes de cerrar.

## Lecciones aprendidas

### Lanzar

- [2026-11-09] **`kodo launch` exige label `kodo` y assignee** (`Ignored — no
  kodo label`, `reason=unassigned`). Añade ambos con `update_work_item` o PATCH
  REST con las listas completas, y lanza. «already dispatching (cross-process)»
  no es un error. Antes de darla por lanzada mira `state.json`.
- [2026-10-11] **Las tareas ROMAN sin módulo caen en `~/dev/roman` (no git)**
  y la sesión improvisa worktree: asigna módulo antes de lanzar.
- [2026-10-23] **Repo nunca abierto con Claude Code → «Workspace trust not yet
  accepted»** y `state.json` lo deja en `running`. Antes: `projects["<ruta>"]
  .hasTrustDialogAccepted = true` en `~/.claude.json` (con backup). Si ya
  murió, re-teclea el mismo `claude --session-id <id> --worktree <id> …` en el
  workspace. Lee la pantalla a los ~20 s de cada launch: un prompt de shell en
  vez de Claude = proceso muerto.
- [2026-10-11] **Adelanta el `main` local antes de lanzar varias tareas sobre
  un repo** (`git rev-list --count main..origin/main`; `pull --ff-only`). Con
  main atrasado la PR sale CONFLICTING y GitHub no dispara el CI. Un
  cherry-pick a medias en el checkout principal bloquea el ff: avisa.
- [2026-10-13] **Dos sesiones Rails del mismo repo comparten BD** (test y
  desarrollo) y se bloquean: indica a la segunda que use BD aislada
  (`DATABASE_URL`/`*_DATABASE_URL` con sufijo de tarea).
- [2026-08-28] **Tareas paralelas que tocan el mismo modelo o el mismo bloque
  de un fichero chocan en todas las PRs.** Secuéncialas o dilo en la
  descripción. Un mapa vivo en `CLAUDE.md` se mueve a un fichero con una
  sección por app (clipping: `.planning/MAPA.md`).
- [2026-10-29] **Las sesiones abren subtareas que se lanzan solas** (`kodo:yolo`
  + assignee): aparecen sesiones que no lanzaste y pueden chocar en
  `package.json`/`yarn.lock`. Vigílalo en la ronda siguiente.
- [2026-09-09] **`.planning/material/` va fuera de git y el worktree no lo
  ve.** Si la tarea depende de un fichero de ahí, pon en la descripción la ruta
  absoluta del checkout principal y, si puedes, su estructura.
- [2026-10-23] **Aviso de seguridad de runtime (Ruby, PHP…)**: primero un
  subagente Explore audita todos los repos (versión, despliegue, uso del
  vector) con veredicto por repo; después una tarea por repo en producción con
  su veredicto y versión objetivo. Instala la versión en asdf una sola vez
  antes de lanzar. Las imágenes Docker oficiales salen días después: que lo
  marquen como bloqueo del deploy, no que cambien la imagen base.

### Supervisar sesiones (cmux)

- [2026-10-24] **Enviar algo a una sesión son dos llamadas**: `cmux send
  --workspace <ref> '<texto>'` y `cmux send-key --workspace <ref> Enter`. No
  existe `send --key`; `\r`/`\n` dentro del texto no envían. `send-key Enter`
  también confirma diálogos (opción seleccionada). Verifica con `read-screen`
  que la sesión está procesando.
- [2026-10-09] **Nunca `--force` sobre un borrador humano**: lo concatena con
  tu texto y lo manda. Sin `--force`, el fallo «holds text someone is typing» o
  «waiting on a question or dialog» es la señal para esperar o pedir a Alex que
  lo borre. `send-key ctrl+u` limpió el prompt en ago–sep; el 9-oct ni Escape,
  Ctrl+U, Ctrl+C ni Backspace lo limpiaban: no cuentes con ello.
- [2026-09-02] **El texto «sin enviar» del prompt puede ser la sugerencia de
  next-prompt de Claude Code**, indistinguible en `read-screen`. No lo
  atribuyas al operador ni lo creas («cherry-pick hecho» apareció sin hacer):
  verifica contra git/Plane.
- [2026-09-09] **Un texto largo queda como «[Pasted text #1]» sin enviarse.**
  Escríbelo en un fichero del scratchpad y `cmux send --workspace X "$(cat
  fichero)"` + `send-key Enter`. Tu `cmux send` no puede contener rutas de
  ficheros protegidos (el hook `secrets-guard` te corta a ti).
- [2026-11-09] **Si el operador trabaja dentro de una sesión, pregunta antes
  de ordenar** (borrador humano en el prompt, o lo dice el handoff): primero
  «¿qué estado tiene X?», después la orden.
- [2026-11-09] **Reinicio de cmux**: renumera `workspace:N` y
  `workspace_group:N`; el `workspace_id` (UUID) sobrevive. `read-screen` da
  «Workspace ref not found» en sesiones vivas y el reconcile las deja `dead`
  (zombies fuera de `max_parallel`). No las des por muertas: `cmux
  list-workspaces` trae los refs nuevos con el ref de tarea en el título, y
  `workspace-group list` los grupos. Rescate: cruza `cmux workspace list
  --json` por `id` y `updateSession(taskId, {...})` de `src/session/state.js`
  con el ref nuevo y `state:'idle'`, `alive/tab_alive:true`, `dead_since` y
  `process_dead_since` a null (backup de `state.json` antes). Una sesión
  reanudada en cwd equivocado sin worktree se cierra.
- [2026-10-23] **Clasificador de permisos «pegado» en «Remote Shell Writes»**
  tras un `kamal app exec`: deniega lecturas inocuas en esa sesión. Haz tú la
  lectura (prod: `kamal app exec --reuse "bin/rails runner
  \"eval(Base64.decode64('…'))\""`) y publícala como comentario en la tarea.
- [2026-09-14] **Review con «Cierre automático de kodo» y handoff
  `author=auto`** puede no traer trabajo (sesión muerta días antes). Compara
  `branch_head` con `base_commit` en `state.json` y `git log --all --
  <scope>`: si coinciden, devuélvela a Backlog con un comentario del motivo.
- [2026-08-21] **Cierre atribuido a la sesión equivocada**: los hooks resuelven
  solo por `session_id` (KODO-27) y dejan `session.close.unmatched` en
  `~/.kodo/logs/hooks.ndjson` (`cwd`, `candidate_task_refs`). Grep ahí antes de
  reconstruir cronologías.
- [2026-08-10] **`worktree_path` de `state.json` puede ser fantasma**; el
  trabajo real está en `.claude/worktrees/<session-id>`. En un post-mortem,
  `git worktree list` antes de dar nada por perdido.

### Cerrar sesiones

- [2026-11-09] **Qué es cerrable.** Una sesión con PR abierta y tarea en In
  Review está terminada: no retengas el slot esperando el merge (la rama y el
  worktree sobreviven). Pero no la cierres si el operador no ha leído su
  resultado o le quedan decisiones o envíos suyos; un «go» de lanzamiento no
  autoriza a cerrar para abrir hueco. En la duda, presenta y pregunta. Reabrir:
  `cmux new-workspace --cwd <path> --group <g> --command 'claude --resume <sid>
  --permission-mode auto'`.
- [2026-10-23] **Integra antes de cerrar.** «Remove worktree» borra la rama
  `worktree-*` con sus commits y la cola queda apuntando a nada. Recuperación:
  `git fsck --unreachable --no-reflogs | awk '/commit/{print $3}'`, filtra con
  `git show --stat` y `git cherry-pick` en orden de parents.
- [2026-11-10] **Secuencia de cierre** (verificada en Claude Code 2.1.319):
  `send '/exit'` + `send-key Enter` → diálogo «Exiting worktree session» con
  **Keep preseleccionado**: `send-key --force Enter` (sin `--force` cmux se
  niega: «waiting on a question or dialog»). Elige siempre Keep; lee el diálogo
  con `read-screen` antes de confirmar. Después `cmux close-workspace
  --workspace <ref>` (`cmux workspace close <ref> --force` con proceso vivo;
  nunca uno con `make dev` del operador).
- [2026-11-10] **Qué pasa con el worktree al salir.** Sin cambios ni commits,
  Claude Code lo borra sin preguntar («Worktree removed (no changes)»). Con
  Keep y el árbol limpio, el `SessionEnd` de kodo hace `git worktree remove` y
  conserva la rama con commits sin integrar (por eso «desaparece» tras Enter +
  Enter: no se pierde nada). Con ficheros sin commitear se queda en disco.
  Remove borra además la rama `worktree-<sid>` con sus commits (una rama
  renombrada `feat/…` sobrevive) y ha dejado worktrees a medio borrar (`git
  worktree prune`).
- [2026-10-11] **Filas `dead` que no salen de `state.json`**: no uses
  `removeSession` (reconcile las rescata mientras exista el workspace). Cierra
  el workspace y `DELETE http://127.0.0.1:9090/sessions/<task_id>` con
  `Authorization: Bearer $KODO_API_TOKEN` (`await import('./src/config.js')` lo
  carga; 409 `alive` = workspace aún abierto).
- [2026-10-15] **Los worktrees con ficheros sin commitear (generados,
  `.compound/`) no se limpian solos.** Cuando una tarea pasa a
  Done con la PR mergeada, en la misma ronda `git worktree remove --force <wt>`
  y `git branch -D <rama>`, solo si `git rev-list --count origin/main..HEAD` da
  0 y no es de una sesión viva. Si da > 0, se conserva y va al handoff.
  Comprueba el remoto (en kodo, `origin` es el fork y `kintsugi` el real).

### Integrar y mergear

- [2026-09-03] **El PR lo mergea el humano.** `gh pr merge` está bloqueado por
  un wrapper (`~/.local/bin/gh`: «merging requires human approval») aunque el
  operador autorice. No lo rodees: dale el comando listo (`/opt/homebrew/bin/gh
  pr merge <n> --repo … --merge`). El merge local `--no-ff` + push sí vale para
  commits sueltos, docs y el release (`packaging/homebrew/README.md`).
- [2026-08-28] **Al mergear una PR con migración, avisa en la misma ronda a
  TODAS las sesiones con rama abierta** (`git merge origin/main` + suite): las
  ramas anteriores rompen CI en cadena.
- [2026-10-11] **PRs con migración en paralelo colisionan en la versión
  «redonda» (`YYYYMMDD100001`).** Antes de la segunda: `git ls-tree origin/main
  db/migrate | awk -F_ '{print $1}' | sort | uniq -d`. Tras mergear en ráfaga
  espera el CI de main. Hotfix: renombrar fichero + versión en `schema.rb`
  (commitea los dos).
- [2026-11-10] **El `main` de clipping exige PR + 3 checks (lint, test,
  imagen).** Para subir una pila ya mergeada en el `main` local: `git push
  origin main:refs/heads/integra/<tema>`, UNA PR contra `main`, y el operador
  la mergea en la web con merge commit. Las PRs apiladas (base = rama anterior)
  se cierran a mano con `gh pr close --delete-branch` tras `merge-base
  --is-ancestor`.
- [2026-11-10] **Las PRs de Edanray vienen de su fork y el CI no corre**
  (`statusCheckRollup` vacío). La suite la pasas tú: worktree temporal en el
  scratchpad con las PRs sobre `origin/main`,
  `DATABASE_URL=postgres:///<nombre>_test`, suite completa y limpieza
  (worktree, `dropdb`, refs `pr/N`). No enlaces `app/assets/builds` al checkout
  principal (reescribe su `tailwind.css`; `bin/rails tailwindcss:build`).
- [2026-10-09] **Probar una PR que genera PDF/HTML sin tocar el checkout**:
  `git worktree add <scratchpad>/prN origin/<rama>`, copiar
  `config/credentials/test.key`, enlazar `node_modules`, y `RAILS_ENV=test
  bin/rails runner <script>` con datos sintéticos en transacción con rollback.
  Delégalo a un agente.

### GitHub y CI

- [2026-11-09] **`gh` por repo, sin `gh auth switch` (#37299).**
  `GH_TOKEN=$(gh auth token --user deikka)` para `kintsugi-lab-sca/*` y
  `deikka/*`. Clipping (`origin` = `github-roman`, org
  Fast-Track-Roman-y-Asociados) solo funciona con la cuenta `a-nunez-c_rmn`
  activa; si la activa es `deikka`, usa `git ls-remote`/`for-each-ref` para
  ramas y `kintsugi-lab-sca/clipping` solo para las PRs de Edanray.
- [2026-10-23] **En clipping, `.planning/` está gitignored y es un repo aparte**
  (`kintsugi-lab-sca/clipping-planning`): los docs se commitean allí.
- [2026-09-14] **CI de `deikka/kodo` en rojo en 2–6 s con `steps: []` = cuota
  de Actions agotada**, no código. Verlo: `gh api
  repos/<owner>/<repo>/check-runs/<id>/annotations`. Consumo: `gh api
  /users/<user>/settings/billing/usage` (scope `user`). Mientras dure, la
  evidencia de suite verde es el comentario de cierre de la sesión.
- [2026-10-11] **La suite de scp-cmri tarda ~13 min y bufferiza la salida**:
  19 min sin un punto no es un cuelgue (`timeout-minutes` 30). Un job
  `security` en rojo puede venir de `main`: compáralo antes de culpar a la PR.

### Plane (MCP y REST)

- [2026-10-23] **Mutar: `update_work_item` con listas completas**
  (`assignees`, `labels`) o PATCH REST (skill `plane-api`,
  `projects/{pid}/work-items/{wid}/`). `manage_work_item_assignee` y
  `manage_work_item_label` devuelven error pydantic y a veces no aplican.
  Módulos: `manage_module_work_items` con `add_ids`/`remove_ids`. Verifica
  siempre después.
- [2026-09-09] **Leer una tarea**: `retrieve_work_item_by_identifier` con
  `expand=labels` (o `assignees,labels`) y sin `fields`. Sin `expand`, o con
  `labels` en `fields`, falla (`labels.0 Input should be a valid dictionary`).
- [2026-10-09] **Los ids de label y estado son por proyecto.** Un id de otro
  proyecto responde 200 con `labels: []` sin avisar: resuelve con `list_labels`
  / `list_states` del proyecto destino.
- [2026-09-09] **Listar y filtrar**: `list_work_items` exige `project_id`
  (workspace-wide → 404; itera `providers.plane.projects[].id`). El PQL no
  filtra en esta CE (devuelve el proyecto entero): un «no hay nada en Review»
  sacado de PQL es falso. Usa REST `projects/{pid}/work-items/?per_page=100`
  paginando por `cursor` y filtra en cliente; o `jq` por `state.name` sobre el
  volcado en `tool-results/`.
- [2026-09-09] **REST devuelve a veces caracteres de control en
  `description_html`**: `tr -d '\000-\037'` antes de `jq`.
- [2026-07-27] **`create_work_item_comment` espera HTML crudo** en
  `comment_html`; si lo escapas se ve literal. Se corrige con
  `update_work_item_comment`.
- [2026-10-30] **Preguntas pendientes de las sesiones**: `kodo ask` solo
  funciona dentro de una sesión de kodo; desde aquí se leen en
  `list_work_item_comments`.

### kodo: daemon y estado

- [2026-10-28] **El daemon ejecuta el código con el que arrancó.** Tras `git
  pull` o release de kodo: `kodo stop && kodo up`. El binario es `kodo` (PATH).
- [2026-10-09] **«kodo no lanza al mover a In Progress» = webhook caído.**
  (1) `grep 'Webhook received' ~/.kodo/logs/daemon.log`; (2) `tailscale
  status`: Plane corre en `mattermost-ubuntu-4gb-nbg1-2` (`root@178.104.51.37`,
  docker `plane-aio`) y apunta a `http://100.112.133.33:9090/webhook`; si el
  host está offline o *Logged out*, `nohup tailscale up &` allí y Alex autoriza
  la URL; (3) Plane desactiva el webhook tras fallos: reactívalo en Workspace
  settings → Webhooks. Verifica con un comentario en cualquier tarea.
- [2026-08-20] **Nunca decidas lanzar por el número `pending` del check.**
  Cuenta las sesiones vivas (el trigger es In Progress) y tareas que el
  dispatcher filtra (`kodo:adopted`, sin label). Resuelve la lista: `node -e`
  con `loadConfig` + `initRegistry` + `getProvider(cfg.provider)` + `await
  p.init()` (obligatorio) + `await p.listPendingTasks()`.
- [2026-08-10] **«Orquestadores duplicados»**: en macOS `ps` muestra forks
  efímeros con el cmdline del padre; comprueba `ppid`. Los duplicados reales se
  cuentan en `cmux tree --all --json`.
- [2026-08-21] **TUI en «waiting for server» = `server.bind: 0.0.0.0` contra
  LuLu** (descarta conexiones: timeout, no refused). Devuelve `bind` a
  `127.0.0.1` y reinicia el daemon. Para aislarlo: `curl -v`, `nc -z -w5` al
  puerto y a uno cerrado, `systemextensionsctl list`. No pidas un `sudo` al
  operador antes de aislar la variable.
- [2026-09-03] **Secretos: `permissions.deny` vacío + hook
  `~/.claude/hooks/secrets-guard.js`**, que corta Read/Edit/Write y comandos
  Bash que mencionen los ficheros protegidos (también a ti). Para Plane usa
  `$PLANE_API_KEY` del entorno; el `KODO_API_TOKEN` no lo leas del fichero.

### Operador y comunicación

- [2026-11-09] **Operador fuera: lo urgente por Mattermost + push** (Alex).
  `mcp__mattermost__dm` sin `username` escribe en su chat consigo mismo (canal
  `xno6by6t4pfjtbq3qadnrqesgr`) y no le notifica: avisa con `PushNotification`
  (una línea que remite al chat). Formato: qué decidir, opciones,
  recomendación. Lee la respuesta con `read_channel` en cada ronda. Solo lo que
  bloquea una fecha de la semana o toca producción, datos o facturación.
- [2026-09-09] **No redirijas una decisión de dominio de una sesión por una
  reacción del operador**: para la sesión, expón las posiciones con su
  trade-off, y mueve solo con el modelo cerrado (ITCLIP-136: dos rehechos).
- [2026-11-09] **`SendMessage` entre sesiones con distinto modo de permisos
  queda retenido y caduca.** Escribe la respuesta también en un fichero del
  repo de la tarea y díselo al operador.
- [2026-10-13] **Las fechas que escribe una sesión pueden estar mal**:
  contrástalas con el calendario antes de copiarlas. Y los resúmenes de Anarlog
  traen artefactos de transcripción: contrasta la frase con el commit o la PR
  antes de usarla en un mensaje a clientes.

### Entorno y herramientas

- [2026-10-23] **`get_meeting_transcript` de Anarlog** devuelve ~125 KB por
  página y el harness lo vuelca a `tool-results/*.txt`: `jq -r '.text'` y
  concatena (`pagination.total`). Sin hablante.
- [2026-10-30] **Spark no siempre descarga adjuntos**
  (`RSMMessagesModelErrorDomain error 11`): pide al operador el fichero.
  `spark event` exige Spark Desktop abierto.
- [2026-11-09] **Recordatorios de macOS por AppleScript tardan >45 s** y el
  primero pide permiso: en segundo plano y comprueba con `name of every
  reminder`.
- [2026-10-28] **Tras una sesión que usa Stripe CLI**, comprueba que no dejó el
  perfil default con una clave live (`stripe logout`) y avisa al operador.
- [2026-11-10] **En zsh, `set -- $var` no parte palabras**: usa `read -r a b`.
