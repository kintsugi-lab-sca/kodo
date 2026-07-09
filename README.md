# kodo 心動

Sesiones de Claude Code automatizadas desde tu kanban. Mueves una tarea a "In Progress" → kodo lanza [Claude Code](https://claude.ai/code) en un workspace de [cmux](https://cmux.dev) → al terminar, la tarea vuelve como "In Review".

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
                        stop hook ←──────────────────┘
                          │
                        Plane → In Review          KL-42 [Blue]
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
kodo config              # wizard de configuración / --show / --set clave=valor
kodo launch <REF>        # lanza una tarea manualmente (ej: KL-42)
kodo check               # vigilante: revisa estado y lanza orquestador si hace falta (0 tokens)
kodo orchestrate         # lanza la sesión orquestadora (usa tokens)
kodo adopt               # adopta una sesión ad-hoc de cmux como tarea trackeada
kodo comment <REF>       # postea un comentario resumen en una tarea existente
kodo logs [session-id]   # inspecciona logs de sesión (dump, tail, filtro)
kodo install / uninstall # registra/elimina hooks de Claude Code
```

## GitHub como provider

kodo también puede operar contra GitHub Issues (sin webhook: polling integrado en el daemon).

```bash
# En ~/.kodo/.env
GITHUB_TOKEN=ghp_...
```

Configura `provider: "github"` vía `kodo config`. El trigger son issues con el label `kodo`; al terminar, la sesión reporta con un comentario y el estado de revisión es el cierre del issue.

## Configuración

```bash
kodo config --show                                  # ver configuración actual
kodo config --set claude.max_parallel=5             # sesiones simultáneas (default 3)
kodo config --set claude.default_model=opus         # modelo por defecto
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

Su skill (`.claude/skills/kodo-orchestrate/`) acumula conocimiento entre
sesiones: quirks de la API, mapeos descubiertos, procesos validados. Antes de
cerrar, el orquestador actualiza la skill y el stop hook auto-commitea los
cambios — la siguiente sesión arranca con todo el contexto previo.

## Visibilidad del progreso

Todo queda documentado en Plane como comentarios, sin abrir cmux:

- **Durante la sesión** — Claude comenta su plan al empezar, hitos intermedios y un resumen final.
- **Al cerrar** — el stop hook postea un comentario de cierre (duración + output final) y mueve la tarea a "In Review".
- **Con el orquestador activo** — rondas de supervisión que documentan el estado observado.

## Arquitectura

| Módulo | Qué hace |
|---|---|
| `src/server.js` | Servidor HTTP `:9090` — webhook (HMAC), API autenticada, dashboard web |
| `src/daemon/` | Ciclo de vida del daemon (`kodo up/stop/status`, `daemon run` para launchd) |
| `src/triggers/` | Dispatch de eventos: webhook (Plane), polling (GitHub) |
| `src/providers/` | Clientes de Plane y GitHub (REST, normalización, estados) |
| `src/cmux/` + `src/host/` | Wrapper del CLI de cmux: workspaces, screens, colores |
| `src/session/` | Manager de sesiones, state store (`~/.kodo/state.json`), loop de reconciliación |
| `src/hooks/` | SessionStart (inyecta contexto de la tarea) y Stop (In Review, comentario de cierre) |
| `src/orchestrator/` | Lanzamiento del orquestador + su prompt |
| `src/cli/dashboard/` | Dashboard TUI (Ink/React) |

## Archivos

```
~/.kodo/
├── .env               # PLANE_API_KEY, PLANE_WEBHOOK_SECRET, KODO_API_TOKEN
├── config.json        # provider, estados, servidor, claude
├── projects.json      # proyecto del provider → path local
├── state.json         # sesiones activas
├── plans/             # planes de acción por tarea
└── logs/              # logs NDJSON por sesión
```

## Colores de workspace

| Color | Significado |
|---|---|
| Amber | Sesión corriendo |
| Blue | En review |
| Green | Completada |
| Crimson | Error |
| Indigo | kodo service / orquestador |

## Tests

```bash
npm test
```

## Licencia

MIT
