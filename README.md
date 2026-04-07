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
                        stop hook ←──────────────── sesión cierra
                          │                        
                        Plane → In Review          TENDERIO-42 [Blue]
                        notifica orquestador       
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

## Uso

### Automático (webhook)

1. Añade label `kodo` a una tarea en Plane
2. Muévela a "In Progress"
3. kodo crea workspace cmux + lanza Claude
4. Al terminar → tarea pasa a "In Review" automáticamente

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

### Orquestador (`src/orchestrator/`)
Sesión Claude supervisora que monitorea sesiones, desbloquea stuck, y coordina prioridades.

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
