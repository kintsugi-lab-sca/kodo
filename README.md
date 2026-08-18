# kodo 心動

Sesiones de Claude Code automatizadas desde tu kanban. Mueves una tarea a "In Progress" → kodo lanza [Claude Code](https://claude.ai/code) en un workspace de [cmux](https://cmux.dev) o de [Orca](https://www.onorca.dev) → al terminar, la tarea vuelve como "In Review".

Providers soportados: [Plane](https://plane.so) (webhook) y GitHub Issues (polling).

## Cómo funciona

```
Plane (kanban)          kodo (daemon)              cmux (terminal)
─────────────           ─────────────              ────────────────

Tarea → In Progress ──webhook──→ kodo
                                  │
                        ¿tiene label "kodo"?
                          │ no → ignorar
                          │ sí ↓
                        crea workspace ──────────→ KL-42 [Amber]
                        lanza claude ────────────→ claude --model opus ...
                                                     │
                                                   Claude trabaja
                                                     │
                                                   sesión se cierra
                                                   (Ctrl+C, /exit, cerrar)
                                                     │
                        SessionEnd ←─────────────────┘
                          │
                        backstop → In Review       KL-42 [Blue]
                        notifica orquestador
                          │
                        humano/orquestador revisa
                          │
                        Plane → Done               KL-42 [Green]
```

## Instalación

Requiere macOS, Node ≥ 20 y [cmux](https://cmux.dev).

### Homebrew (recomendado)

```bash
brew tap kintsugi-lab-sca/kodo
brew install kodo
```

### Desde el código

```bash
git clone https://github.com/kintsugi-lab-sca/kodo.git
cd kodo
npm install
npm link   # hace "kodo" disponible globalmente
```

## Puesta en marcha

### 1. Credenciales

```bash
mkdir -p ~/.kodo
cat > ~/.kodo/.env << 'EOF'
PLANE_API_KEY=plane_api_tu_token_aqui
PLANE_WEBHOOK_SECRET=plane_wh_tu_secret_aqui
EOF
```

- `PLANE_API_KEY`: en Plane → perfil → **API tokens**.
- `PLANE_WEBHOOK_SECRET`: lo obtienes al crear el webhook (paso 4).
- `KODO_API_TOKEN` (auth del dashboard y la API) se genera solo en el primer arranque — no hace falta crearlo.

### 2. Configurar y mapear proyectos

```bash
kodo config   # wizard interactivo: conecta con Plane, lista proyectos, pide paths locales
```

Crea `~/.kodo/config.json` y `~/.kodo/projects.json` (proyecto de Plane → path del repo local).

### 3. Crear labels en Plane

En cada proyecto que quieras automatizar:

| Label | Efecto |
|---|---|
| `kodo` | Activa la automatización. Modelo por defecto: Opus |
| `kodo:sonnet` / `kodo:haiku` | Cambia el modelo |
| `kodo:yolo` | Añade `--dangerously-skip-permissions` |
| `kodo:gsd` / `kodo:gsd-quick` | Modo GSD (workflow de planificación estructurada); implica yolo |

Solo las tareas con label `kodo` (o `kodo:*`) se automatizan.

> **Contrato `kodo:gsd` (modo full).** El resolver casa la tarea con una fase de
> `.planning/ROADMAP.md` por **título exacto**: el título de la tarea debe coincidir con el
> título de una fase, y el heading debe tener el formato canónico **`## Phase N: Título`** o
> **`### Phase N: Título`** (también `## Phase N — Título`). Cualquier **sufijo entre el número y
> los dos puntos** — p. ej. `### Phase 0 (MVP): Setup` — hace la fase **invisible** para el
> resolver y la tarea fallará con `no-match`. Para tareas puntuales sin fase de ROADMAP usa
> `kodo:gsd-quick`. Cuando un dispatch falle, `kodo logs` explica el motivo con una pista accionable.

### 4. Configurar el webhook en Plane

Settings → Webhooks → nuevo webhook:

- **URL**: `http://<ip-alcanzable-desde-plane>:9090/webhook`
- **Events**: Work Items
- **Secret**: cópialo a `PLANE_WEBHOOK_SECRET` en `~/.kodo/.env`

> ⚠️ Por defecto kodo escucha **solo en `127.0.0.1`**. Si Plane corre en otra
> máquina, expón el bind (p. ej. tu IP de Tailscale) o el webhook nunca llegará:
>
> ```bash
> kodo config --set server.bind=100.x.y.z
> ```
>
> Ver [Topología multi-nodo](#topología-multi-nodo) para las implicaciones de seguridad.

### 5. Instalar hooks de Claude Code

```bash
kodo install   # registra SessionStart y Stop hooks en ~/.claude/settings.json
```

### 6. Arrancar

```bash
kodo up   # arranca el daemon en background y abre el dashboard TUI
```

Con Homebrew puedes dejarlo como servicio de arranque automático:

```bash
brew services start kodo
```

## Uso

### Automático (webhook)

1. Añade el label `kodo` a una tarea en Plane
2. Muévela a "In Progress"
3. kodo crea el workspace cmux y lanza Claude
4. Claude trabaja y documenta su progreso como comentarios en la tarea
5. Al cerrar la sesión → la tarea pasa a "In Review"
6. Tú (o el orquestador) revisáis y movéis a "Done"

Los nombres de estado son configurables (`plane.states.trigger/review/done`); por defecto `In Progress` / `In review` / `Done`.

### Manual

```bash
kodo launch KL-42   # lanza una tarea específica sin pasar por el webhook
kodo orchestrate    # lanza la sesión supervisora
```

### Dashboard

```bash
kodo dashboard   # TUI en vivo (también se abre con kodo up)
```

Teclas: `↑↓` mover · `c` comentarios · `l` logs de la sesión · `L` log general del daemon · `p` plan · `/` filtrar · `d` descartar sesión muerta · `o` abrir tarea en el navegador · `O` enfocar el orquestador · `a` adoptar sesión ad-hoc · `e` config · `m` proyectos · `q` salir

También hay dashboard web: `http://localhost:9090/?token=<KODO_API_TOKEN>` (el token está en `~/.kodo/.env`).

## Comandos

```
kodo up                  # arranca daemon + dashboard (comando principal)
kodo stop                # para el daemon
kodo status              # estado del daemon (running|stopped)
kodo dashboard           # TUI de sesiones activas
kodo capture "<texto>"   # captura una idea al inbox global (~/.kodo/inbox.md)
kodo inbox               # triage del inbox (--all, --json, route <id>, discard <id>)
kodo config              # wizard de configuración / --show / --set clave=valor
kodo launch <REF>        # lanza una tarea manualmente (ej: KL-42)
kodo check               # vigilante: revisa estado y lanza orquestador si hace falta (0 tokens)
kodo orchestrate         # lanza la sesión orquestadora (usa tokens)
kodo adopt               # adopta una sesión ad-hoc de cmux como tarea trackeada
kodo comment <REF>       # postea un comentario resumen en una tarea existente
kodo logs [session-id]   # inspecciona logs de sesión (dump, tail, filtro)
kodo doctor              # diagnostica la alineación config.json ↔ projects.json (--states, --identifiers, --json)
kodo install / uninstall # registra/elimina hooks de Claude Code
```

### `kodo capture` / `kodo inbox` — el inbox de capturas

Un **único buffer de captura global** en `~/.kodo/inbox.md`. La idea es separar dos actos que
normalmente se mezclan y se estorban: **capturar es instantáneo y tonto** (una línea, cero
preguntas, cero decisiones), y **triar es un paso deliberado y aparte**, que haces cuando te
apetece y no cuando la idea te interrumpe.

```bash
kodo capture "probar el nuevo resolver de estados antes de v0.19"

# Si el texto empieza por guion, antepón el separador de argumentos:
kodo capture -- "-3 % de conversión en el checkout tras el rediseño"
```

Superficie completa:

| Comando | Qué hace | Exit codes |
|---|---|---|
| `kodo capture "<texto>"` | Appendea una línea al inbox. El fichero se crea al vuelo en la primera captura | `0` ok · `1` error de fs · `2` texto vacío tras el saneo |
| `kodo inbox` | Lista las capturas abiertas con su `<id>` corto | `0` siempre — el lector nunca lanza |
| `kodo inbox --all` | Incluye además las ya cerradas, con su estado | `0` siempre |
| `kodo inbox --json` | El mismo listado como una sola línea JSON, determinista y sin color | `0` siempre |
| `kodo inbox route <id>` | Marca la captura como **enrutada** | `0` ok · `1` error de fs, lock ocupado o escritura concurrente · `2` id inexistente o captura ya cerrada |
| `kodo inbox route <id> --dest <ref>` | Igual, añadiendo un puntero de traza a dónde acabó | idem |
| `kodo inbox discard <id>` | Marca la captura como **descartada** | idem |

#### El enrutado lo decide `gsd-capture`, no kodo

kodo **no decide a dónde va una idea**. Ese trabajo es del skill `gsd-capture` de Claude Code, que
es quien conoce los destinos reales (todos estructurados, notas, backlog, semillas). El flujo son
tres pasos, y el del medio ocurre **fuera de kodo**:

```
1. kodo inbox                          → lista las abiertas con su <id>
2. /gsd-capture …                      → enruta la idea (kodo NO participa)
3. kodo inbox route <id> --dest <ref>  → marca enrutada + puntero de traza (si hay ref)
```

Esto es deliberado y es una frontera dura del diseño: **kodo no invoca, no importa y no
reimplementa** la lógica de destinos. El «a dónde va» vive fuera, así que kodo no puede quedarse
desfasado respecto a ella. Consecuencias prácticas:

- `--dest` es **opcional y best-effort**. Es una ref opaca —`999.4`, `SEED-012`, un path
  relativo, lo que sea— que kodo guarda tal cual sin validar que exista ni interpretar su forma.
- Sin ref, `kodo inbox route <id>` cierra la captura igualmente. La falta de puntero **nunca**
  bloquea el marcado.

#### El fichero es tuyo

`~/.kodo/inbox.md` es markdown plano y está pensado para que lo abras y lo edites a mano:

- **kodo nunca borra una captura.** Cerrar es solo una transición de estado: la línea sigue ahí,
  con su id, su texto y su fecha. La traza permanente es el objetivo, no un efecto secundario.
- **Toda línea que kodo no reconoce se conserva intacta**, byte a byte —encabezados, notas
  sueltas, líneas en blanco— y simplemente se omite del listado. El marcado de una captura no
  reescribe ninguna otra línea del fichero.

### `kodo doctor` — alineación config ↔ projects

El dashboard lista **todos** los proyectos del workspace de Plane con el mapeo de `projects.json`
superpuesto, pero el daemon solo despacha webhooks de los proyectos presentes en
`config.providers.<provider>.projects`. Un proyecto **mapeado pero no configurado** parece
operativo y sin embargo todos sus webhooks mueren con `No configured project ... UNKNOWN`.

`kodo doctor` cruza los dos ficheros y reporta la desalineación (exit code 1 si hay problemas):

- **mapeado pero no en config** (ERROR): sus webhooks morirán con `UNKNOWN` → añádelo a `config.json`.
- **en config pero sin ruta local** (WARN): el launch fallará al resolver el path → mapéalo.
- **identifier `UNKNOWN`** / **paths duplicados** (WARN): ruido de config.

`--states` además consulta la API y verifica que cada proyecto configurado tiene los estados
`trigger` / `review` / `done` (por nombre exacto, case-insensitive) — el segundo fallo del caso
SCP: sin el estado `In review` el cierre del flujo también falla. El editor de proyectos del
dashboard (`m`) marca cada fila **⚡ dispatch** (en config) o **⚠ solo-mapeado** (la trampa).

`--identifiers` consulta la API y compara el `identifier` cacheado en `config.json` con el real
del provider. Renombrar un proyecto en Plane deja el cache obsoleto y el ref pasa a apuntar a un
proyecto que no existe allí (`ITROMAN-1` para lo que Plane llama `ITCLIP`). El provider ya se
realinea solo en cada `init()` —el ref siempre sale del identifier de Plane—, pero este check
hace visible la divergencia persistida en disco para poder corregirla con `kodo config`.

## GitHub como provider

kodo también puede operar contra GitHub Issues (sin webhook: polling integrado en el daemon).

```bash
# En ~/.kodo/.env
GITHUB_TOKEN=ghp_...
```

Configura `provider: "github"` vía `kodo config`. El trigger son issues con el label `kodo`; al terminar, la sesión reporta con un comentario y el estado de revisión es el cierre del issue.

## Orca como cliente

Además de [cmux](https://cmux.dev), kodo puede correr sus sesiones en
[Orca](https://www.onorca.dev). El cliente se elige con **una sola clave** en
`~/.kodo/config.json`:

```bash
kodo config --set host=orca        # 'cmux' (default) | 'orca'
kodo config --set orca.binary=/usr/local/bin/orca
```

Es una propiedad de la **instalación**, no del proyecto ni de la tarea: un kodo
apunta a un cliente, igual que apunta a un solo binario de cmux. No hay migración —
las instalaciones existentes siguen en cmux sin tocar nada.

### Qué cambia con Orca

| | cmux | Orca |
|---|---|---|
| Unidad de trabajo | tab (`workspace:N`, ref reciclado) | worktree (`<repoId>::<path>`, ref estable) |
| Aislamiento git | `claude --worktree` → `.bg-shell/<id>` | lo crea Orca en `~/orca/workspaces/<repo>/<slug>` |
| Estado de la sesión | color de tab (Amber/Blue/…) | columna del tablero (`in-progress`/`in-review`/…) |
| Marca kodo | `set-description` | comentario de la tarjeta |
| Nombre | título libre | rama git → se slugifica; el título humano va a `--display-name` |

Con Orca, kodo **no** emite `claude --worktree`: el aislamiento ya lo pone el propio
Orca al crear el worktree, y anidar otro dejaría `worktree_path` apuntando a un
directorio que nadie crea. Lo verás en el log como `worktree_skipped_host`.

Las columnas del tablero se ajustan igual que los colores de cmux:

```bash
kodo config --set orca.statuses.review=in-review
```

### Límites conocidos (v0.19)

Orca no expone en su CLI algunas cosas que cmux sí, y kodo degrada **fail-open** en
todas ellas — nada aborta un lanzamiento:

- **Notificaciones de sistema**: Orca no tiene `notify`. Los avisos de sesión
  atascada salen solo por consola y por el dashboard.
- **Grupos de sidebar**: Orca organiza por linaje (padre/hijo, carpetas), no por
  grupos nombrados. `kodo sidebar doctor` no aplica.
- **Adopción de sesiones ad-hoc** (`kodo adopt` desde el descubrimiento del
  dashboard): requiere el `session_id` de Claude Code, que cmux publica en
  `surface resume show` y Orca no. La adopción explícita por ref sigue funcionando.
- **Orquestador** (`kodo orchestrate`): su lanzamiento sigue cableado a cmux.
- **`needs-input`**: se deriva de los hooks de agente de Orca. Actívalos con
  `orca agent hooks on`; sin ellos las sesiones nunca se marcan como «esperando».

## Configuración

```bash
kodo config --show                                  # ver configuración actual
kodo config --set claude.max_parallel=5             # sesiones simultáneas (default 3)
kodo config --set claude.default_model=opus         # modelo de las sesiones de trabajo
kodo config --set claude.orchestrator_model=fable   # modelo del orquestador (default fable)
kodo config --set server.idle_threshold_min=5       # minutos para considerar idle
kodo config --set server.stuck_threshold_min=30     # minutos para considerar stuck
```

### Rate limit de la API de Plane

Plane limita por defecto a **60 requests/minuto** por API key. kodo cachea
estados, labels y módulos (TTL 5 min) y reintenta con backoff exponencial ante
429, pero con varios proyectos concurrentes puedes agotar el cupo. En un Plane
self-hosted, súbelo en el `.env` del contenedor `api`:

```env
API_KEY_RATE_LIMIT=300/minute
```

## Topología multi-nodo

Por defecto el servidor escucha en **`127.0.0.1`** (loopback): la superficie de
red queda cerrada salvo que la abras deliberadamente. Para recibir el webhook
desde otra máquina, expón el bind de forma consciente:

```bash
kodo config --set server.bind=100.x.y.z   # p. ej. tu IP de Tailscale
```

Exponer el bind es un **opt-in explícito** y debe ir acompañado de una ACL o
firewall que restrinja quién alcanza el puerto `:9090` (ACLs de Tailscale,
`pf`/`ufw`). No dejes `0.0.0.0` sin control de acceso delante.

La exposición **no** relaja la autenticación:

- El carril no-webhook (dashboard / API) sigue exigiendo el **bearer token**
  (`KODO_API_TOKEN`) — sin token responde `401`.
- `/webhook` conserva su verificación **HMAC** con el webhook secret.
- `/health` permanece abierto (probe de salud sin auth).

> **Nota — token en la URL.** Las rutas HTML del dashboard aceptan el token como
> query param (`/?token=...`) porque el navegador no puede enviar la cabecera
> `Authorization` al navegar. Ese token queda en el historial del navegador. Si
> sospechas que se ha filtrado, borra la línea `KODO_API_TOKEN` de `~/.kodo/.env`
> (se regenera al arrancar) y reinicia (`kodo stop && kodo up`).

## Supervisión: vigilante + orquestador

Dos niveles separados: mecánico (0 tokens) y cognitivo (LLM).

### Vigilante (`kodo check`)

Script puro que revisa el estado del sistema — sesiones stuck, tareas en
"In Review" esperando aprobación, tareas pendientes con slots libres — y lanza
el orquestador **solo si detecta algo que requiere juicio**.

```bash
kodo check              # revisa y actúa
kodo check --dry-run    # solo reporta
```

### Orquestador (`kodo orchestrate`)

Sesión de Claude Code supervisora: lee los screens de las sesiones activas vía
cmux, evalúa tareas en "In Review" y decide si pasan a "Done", desbloquea
sesiones stuck, lanza nuevas tareas si hay slots, y documenta sus decisiones en
Plane. Desde el dashboard se enfoca con la tecla `O`.

Arranca **siempre con `fable`** (`claude.orchestrator_model`), independiente del
modelo de las sesiones de trabajo (`claude.default_model`, Opus por defecto): su
trabajo es supervisar y despachar, no implementar. Se cambia con
`kodo config --set claude.orchestrator_model=opus` o desde el editor del
dashboard (`e` → "Modelo del orquestador").

Su skill (`.claude/skills/kodo-orchestrate/`) acumula conocimiento entre
sesiones: quirks de la API, mapeos descubiertos, procesos validados. Antes de
cerrar, el orquestador actualiza la skill y el stop hook auto-commitea los
cambios — pero solo en la sesión orquestadora (marcada con la env var
`KODO_ORCHESTRATOR`) y acotado al pathspec `.claude/skills/kodo-orchestrate/`,
de modo que la siguiente sesión arranca con todo el contexto previo sin
arrastrar otros cambios staged.

## Visibilidad del progreso

Todo queda documentado en Plane como comentarios, sin abrir cmux:

- **Durante la sesión** — Claude comenta su plan al empezar, hitos intermedios y un resumen final.
- **Al cerrar** — al cierre real de la sesión (`/exit`), el hook `SessionEnd` ejecuta un backstop mecánico: si la tarea sigue en curso la mueve a "In Review" y comenta el cierre automático junto con el handoff de la sesión (la sesión activa suele haberlo hecho ya; el backstop solo cubre el hueco).
- **Si la sesión muere sin cerrar** — cerrar la tab, un kill o un reinicio no disparan `SessionEnd`, así que el backstop no llega a correr. El barrido de huérfanas del server detecta la sesión muerta y, si la tarea sigue en "In Progress", comenta el cierre incompleto con el último handoff conocido. **No** cambia el estado: kodo no puede saber si el trabajo quedó completo. Una tarea nunca se queda en curso sin rastro — o cierra, o queda marcada como incompleta.
- **Con el orquestador activo** — rondas de supervisión que documentan el estado observado.

## Arquitectura

| Módulo | Qué hace |
|---|---|
| `src/server.js` | Servidor HTTP `:9090` — webhook (HMAC), API autenticada, dashboard web |
| `src/daemon/` | Ciclo de vida del daemon (`kodo up/stop/status`, `daemon run` para launchd) |
| `src/triggers/` | Dispatch de eventos: webhook (Plane), polling (GitHub) |
| `src/providers/` | Clientes de Plane y GitHub (REST, normalización, estados) |
| `src/cmux/` + `src/host/` | Wrapper del CLI de cmux: workspaces, screens, colores |
| `src/session/` | Manager de sesiones, state store (`~/.kodo/state.json`), loop de reconciliación, barrido de sesiones huérfanas |
| `src/hooks/` | SessionStart (inyecta contexto de la tarea), Stop (estado ligero per-turn: idle + lock liberado) y SessionEnd (backstop "In Review" + cleanup terminal + color/notify/nudge al cierre real) |
| `src/orchestrator/` | Lanzamiento del orquestador + su prompt |
| `src/cli/dashboard/` | Dashboard TUI (Ink/React) |

## Archivos

```
~/.kodo/
├── .env               # PLANE_API_KEY, PLANE_WEBHOOK_SECRET, KODO_API_TOKEN
├── config.json        # provider, estados, servidor, claude
├── projects.json      # proyecto del provider → path local
├── state.json         # sesiones activas + registro del orquestador (`.orchestrator`)
├── inbox.md           # capturas rápidas (markdown plano, editable a mano)
├── inbox.lock         # lock advisory del inbox (efímero: se libera al terminar)
├── plans/             # planes de acción por tarea
└── logs/              # logs NDJSON por sesión
```

## Estado de la sesión en el cliente

Con `host: cmux` — color de la tab:

| Color | Significado |
|---|---|
| Amber | Sesión corriendo |
| Blue | En review |
| Green | Completada |
| Crimson | Error |
| Indigo | kodo service / orquestador |

Con `host: orca` — columna del tablero (`orca.statuses`):

| Columna | Significado |
|---|---|
| `in-progress` | Sesión corriendo (y también error: Orca no tiene columna de fallo, y esconder la tarjeta justo cuando hay que mirarla sería peor) |
| `in-review` | En review |
| `completed` | Completada |

## Tests

```bash
npm test
```

## Licencia

MIT
