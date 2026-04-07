# kodo 心動

Bridge entre [Plane CE](https://plane.so) y [Claude Code](https://claude.ai/code) via [cmux](https://cmux.dev).

Mueves una tarea a "In Progress" en Plane → kodo crea un workspace en cmux → lanza Claude Code → al terminar, la tarea pasa a "In Review".

## Cómo funciona

```
Plane (kanban)          kodo (bridge)              cmux (terminal)
─────────────           ─────────────              ────────────────
                                                  
Tarea → In Progress ──webhook──→ kodo server       
                                  │                
                        ¿tiene label "kodo"?       
                          │ no → ignorar           
                          │ sí ↓                   
                        crea workspace ──────────→ TENDERIO-42 [Amber]
                        lanza claude ────────────→ claude --model opus ...
                                                     │
                                                   Claude trabaja
                                                     │
                                                   sesión se cierra
                                                   (Ctrl+C, /exit, cerrar)
                                                     │
                        stop hook ←──────────────────┘
                          │                        
                        Plane → In Review          TENDERIO-42 [Blue]
                        notifica orquestador       
                          │
                        humano/orquestador revisa
                          │
                        Plane → Done               TENDERIO-42 [Green]
```

## Setup

### 1. Instalar

```bash
git clone git@github.com:deikka/kodo.git
cd kodo
npm install
npm link   # hace "kodo" disponible globalmente
```

### 2. Configurar credenciales

```bash
# Genera un API token en: https://tasks.kintsugi-lab.com/profile/api-tokens/
# El webhook secret lo obtienes al crear el webhook en Plane

mkdir -p ~/.kodo
cat > ~/.kodo/.env << 'EOF'
PLANE_API_KEY=plane_api_tu_token_aqui
PLANE_WEBHOOK_SECRET=plane_wh_tu_secret_aqui
EOF
```

### 3. Mapear proyectos

```bash
kodo config   # wizard interactivo: conecta con Plane, lista proyectos, pide paths locales
```

Esto crea `~/.kodo/config.json` y `~/.kodo/projects.json`.

### 4. Crear labels en Plane

En cada proyecto, crea estos labels:

| Label | Efecto |
|---|---|
| `kodo` | Activa la automatización. Modelo: Opus |
| `kodo:sonnet` | Usa Sonnet en vez de Opus |
| `kodo:haiku` | Usa Haiku |
| `kodo:yolo` | Activa `--dangerously-skip-permissions` |

Solo las tareas con label `kodo` (o `kodo:*`) se automatizan.

### 5. Configurar webhook en Plane

Settings → Webhooks → Agregar webhook:

- **URL**: `http://<tu-ip-tailscale>:9090/webhook`
- **Events**: Work Items
- **Secret**: copia el secret a `~/.kodo/.env`

Requiere que Plane y tu Mac estén en la misma red Tailscale.

### 6. Instalar hooks de Claude Code

```bash
kodo install   # registra SessionStart y Stop hooks en ~/.claude/settings.json
```

### 7. Arrancar

```bash
kodo start   # arranca el servidor webhook en :9090
```

## Configuración

### Slots paralelos

El número máximo de sesiones simultáneas de Claude (por defecto 3):

```bash
kodo config --set claude.max_parallel=5
```

### Thresholds

```bash
kodo config --set server.idle_threshold_min=5     # minutos para considerar idle
kodo config --set server.stuck_threshold_min=30    # minutos para considerar stuck
```

### Ver configuración actual

```bash
kodo config --show
```

## Uso

### Automático (webhook)

1. Añade label `kodo` a una tarea en Plane
2. Muévela a "In Progress"
3. kodo crea workspace cmux + lanza Claude
4. Claude trabaja en su workspace
5. Al cerrar la sesión (Ctrl+C, `/exit`, cerrar pestaña) → tarea pasa a "In Review"
6. Tú o el orquestador revisáis y movéis a "Done"

### Manual

```bash
kodo launch TENDERIO-42   # lanza una tarea específica
kodo status               # ver sesiones activas
kodo orchestrate          # lanza sesión supervisora
```

## Comandos

```
kodo config              # wizard de configuración
kodo start               # arranca webhook server (:9090)
kodo stop                # para el server
kodo launch <ID>         # lanza tarea manualmente (ej: KL-42)
kodo status              # sesiones activas
kodo orchestrate         # lanza sesión orquestadora
kodo install             # registra hooks en Claude Code
kodo uninstall           # elimina hooks
```

## Ciclo de vida de una tarea

```
Backlog → Todo → In Progress → [Claude trabaja] → In Review → Done
                      ↑                                ↑
                 webhook trigger                 humano/orquestador
```

- **In Progress**: kodo detecta el webhook y lanza Claude (si tiene label `kodo`)
- **In Review**: la sesión terminó, esperando validación
- **Done**: alguien (tú o el orquestador) confirmó que el trabajo está correcto

## Visibilidad del progreso

Todo el progreso se documenta en Plane como comentarios, sin necesidad de abrir cmux:

**Durante la sesión** — Claude recibe instrucciones de documentar en Plane:
- Al empezar: plan de acción
- Tras cada hito (feature, bug fix, decisión): comentario breve
- Al terminar: resumen de lo hecho y pendientes

**Al cerrar la sesión** — el stop hook automáticamente:
- Lee las últimas 30 líneas del screen de cmux
- Posta un comentario de cierre con duración y output final
- Mueve la tarea a "In Review"

**Con el orquestador activo** — rondas de supervisión cada ~5 minutos:
- Lee el screen de cada sesión activa
- Evalúa progreso y documenta el estado observado en Plane
- Si detecta problemas, actúa (nudge, desbloqueo, escalado)

Resultado: abres cualquier tarea en Plane y ves el historial completo de lo que hizo Claude.

## Orquestador

El orquestador (`kodo orchestrate`) es una sesión de Claude Code dedicada a supervisar las demás.

### Qué hace

Mientras está activo, ejecuta un ciclo continuo:

```
┌─→ Leer state.json (sesiones activas)
│   Leer screens de cada sesión (cmux read-screen)
│   Evaluar: ¿progresa? ¿idle? ¿errores?
│   Documentar estado en Plane (comentarios)
│   Actuar si necesario (nudge, desbloquear)
│   Revisar tareas en "In Review" → mover a Done si OK
│   Lanzar nuevas tareas si hay slots disponibles
│   Esperar ~5 minutos
└───────────────────┘
```

Se activa automáticamente cuando:
- El health checker detecta una sesión stuck (>30min)
- Una sesión termina y le envía mensaje → ronda inmediata

### Skill con autoaprendizaje

El orquestador tiene un skill en `skills/kodo-orchestrate/skill.md` que acumula conocimiento:

- Quirks de la API de Plane (ej: filtros que devuelven 403)
- Mapeo de proyectos y paths descubiertos
- Decisiones de diseño y procesos validados

Antes de terminar cada sesión, el orquestador actualiza el skill con lo aprendido. El stop hook detecta cambios en `skills/` y los auto-commitea. La próxima sesión arranca con todo el contexto previo.

```
Sesión N: descubre quirk → actualiza skill.md → cierra → auto-commit
Sesión N+1: lee skill.md → ya conoce el quirk → no repite el error
```

## Componentes

### Server (`src/server.js`)
Servidor HTTP en `:9090`. Recibe webhooks de Plane, verifica firma HMAC, filtra por labels, y lanza sesiones.

### Plane client (`src/plane/client.js`)
Cliente REST para la API de Plane: proyectos, work items, estados. Resuelve identificadores tipo `TENDERIO-42`.

### cmux client (`src/cmux/client.js`)
Wrapper sobre el CLI de cmux: crear workspaces, enviar comandos, leer screens, cambiar colores, notificaciones.

### Session manager (`src/session/manager.js`)
Orquesta el lanzamiento: resuelve work item → verifica límite de sesiones → crea workspace → lanza Claude → trackea en state.

### State store (`src/session/state.js`)
JSON file en `~/.kodo/state.json`. Trackea sesiones activas: workspace ref, Plane ID, estado, timestamps.

### Health checker (`src/session/health.js`)
Cada 60s verifica sesiones activas:
- **gone**: workspace cerrado → limpia state
- **stuck**: >30min sin progreso → notifica + lanza orquestador
- **idle**: >5min en prompt → log

### Hooks (`src/hooks/`)
- **session-start.js**: inyecta contexto Plane ("Estás trabajando en TENDERIO-42: ...")
- **stop.js**: Plane → In Review, color azul, notifica orquestador
- **install.js**: registra/desregistra hooks en `~/.claude/settings.json`

### Labels (`src/labels.js`)
Parsea labels de Plane (`kodo`, `kodo:sonnet`, `kodo:yolo`) para configurar modelo y permisos.

### Orquestador (`src/orchestrator/` + `skills/kodo-orchestrate/`)
Sesión supervisora de Claude Code. Ver sección [Orquestador](#orquestador) más arriba.

## Archivos de configuración

```
~/.kodo/
├── .env              # PLANE_API_KEY, PLANE_WEBHOOK_SECRET
├── config.json       # Plane URL, workspace slug, colores, thresholds
├── projects.json     # Plane project ID → path local
└── state.json        # sesiones activas
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
