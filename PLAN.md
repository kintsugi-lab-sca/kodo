# Plan: Plane-cmux Bridge ("kōdō")

## Context

Sistema ligero que conecte Plane CE (kanban en tasks.kintsugi-lab.com) con sesiones de Claude Code corriendo en cmux. Probados Operator y agtx — demasiado framework, poca libertad. Lo que necesitamos:

1. **Kanban = Plane** (ya existe, web, móvil, filtros, labels)
2. **Runtime = cmux** (cada tarea = workspace con color y nombre)
3. **Bridge = script ligero** (webhooks + cmux CLI + Plane API)
4. **Orquestador = sesión Claude Code** con MCP de Plane + cmux skill
5. **GSD sigue funcionando** dentro de cada sesión como siempre

## Nombre del proyecto

`kodo` (心動 — "heartbeat" en japonés). Sencillo, corto, fácil de escribir.

## Tech Stack

- **Node.js** — alineado con el ecosistema de hooks de Claude Code (GSD ya usa JS)
- **Sin framework pesado** — solo libs mínimas (http nativo de Node, sin Express)
- **CLI propio** — `kodo` como comando principal
- **Repo en GitHub** — `deikka/kodo`

## Arquitectura

**Event-driven via Tailscale**: Plane CE y Mac están en la misma red Tailscale.
Plane webhooks llegan directamente al Mac sin túneles ni relays.

```
┌─────────────────────────────────┐
│ Plane CE (178.104.51.37)        │
│ tasks.kintsugi-lab.com          │
│ Backlog → Todo → Doing → Done   │
└──────┬──────────────▲───────────┘
       │               │
       │ webhook       │ PATCH /work-items/{id}
       │ (Tailscale)   │ (Tailscale)
       │               │
┌──────▼───────────────┴──────────┐
│ kodo server (Node.js, :9090)    │
│                                 │
│ ┌──────────────┐ ┌────────────┐ │
│ │ Webhook      │ │ State Store│ │
│ │ Receiver     │ │ (JSON file)│ │
│ │ POST /webhook│ │            │ │
│ └──────┬───────┘ └─────▲──────┘ │
│        │               │        │
│ ┌──────▼───────────────┴──────┐ │
│ │ Session Manager             │ │
│ │ - cmux new-workspace        │ │
│ │ - cmux send (launch claude) │ │
│ │ - cmux read-screen (health) │ │
│ │ - cmux workspace-action     │ │
│ └─────────────────────────────┘ │
└──────────────▲──────────────────┘
               │
    Claude Code hooks
    (SessionStart, Stop)
               │
┌──────────────▼──────────────────┐
│ cmux                            │
│ ┌──────────┐ ┌──────────┐      │
│ │ TASK-42  │ │ TASK-77  │ ...  │
│ │ [Amber]  │ │ [Green]  │      │
│ │ claude   │ │ claude   │      │
│ └──────────┘ └──────────┘      │
│                                 │
│ ┌──────────────────────┐        │
│ │ kodo-orchestrator    │        │
│ │ (Claude Code session)│        │
│ │ + Plane MCP          │        │
│ │ + cmux skill         │        │
│ └──────────────────────┘        │
└─────────────────────────────────┘
```

## Componentes

### 1. `kodo server` — El corazón (event-driven)

**Archivo**: `src/server.js`

Servidor HTTP (Node.js http nativo, sin Express) que:
- Escucha en `:9090` para webhooks de Plane (via Tailscale)
- Recibe POST `/webhook` con evento `issue.update`
- Verifica firma HMAC-SHA256 (`X-Plane-Signature`)
- Si el work item pasó a "In Progress" → crea workspace cmux + lanza Claude
- Si una sesión terminó (via hook Stop) → actualiza Plane a "Done" o "In Review"
- Expone GET `/status` para ver sesiones activas (JSON)

**Configuración de Plane webhook**:
- URL: `http://<mac-tailscale-ip>:9090/webhook`
- Events: Issue (create, update)
- Secret: generado por Plane, almacenado en env var `PLANE_WEBHOOK_SECRET`

**State store**: `~/.kodo/state.json`
```json
{
  "sessions": {
    "plane-work-item-uuid": {
      "workspace_ref": "workspace:3",
      "session_id": "claude-session-abc",
      "plane_id": "uuid",
      "plane_identifier": "KL-42",
      "summary": "Implementar auth",
      "status": "running",
      "started_at": "2026-04-06T18:00:00Z",
      "project_path": "/Users/alex/dev/klab/tenderio"
    }
  }
}
```

### 2. `kodo hooks` — Claude Code <-> kodo

**Archivos**: `src/hooks/session-start.js`, `src/hooks/stop.js`

**SessionStart hook**:
- Lee stdin (session_id, cwd)
- Busca en state.json si este cwd corresponde a una tarea de Plane
- Si sí → inyecta contexto: "Estás trabajando en KL-42: Implementar auth"
- Crea notificación cmux

**Stop hook**:
- Lee stdin (session_id)
- Busca en state.json la sesión
- Actualiza Plane: PATCH work item → estado "Done" o "In Review"
- Actualiza color del workspace cmux (verde = done)
- Elimina de state.json

### 3. `kodo cli` — Comandos manuales

**Archivo**: `src/cli.js` (entry point `bin/kodo`)

```bash
kodo start              # Arranca el servidor webhook (:9090)
kodo stop               # Para el servidor
kodo status             # Muestra sesiones activas
kodo launch KL-42       # Lanza manualmente un work item de Plane
kodo config             # Configura API key, workspace, projects
kodo orchestrate        # Lanza sesión orquestadora
```

### 4. `kodo orchestrator` — El cerebro (Claude Code session)

**Archivo**: `src/orchestrator/prompt.md`

Una sesión de Claude Code que se lanza a demanda (no permanente) con:
- **Plane MCP server** registrado → puede leer/crear/actualizar work items
- **cmux skill** → puede crear workspaces, leer screens, enviar comandos
- **Acceso a state.json** → sabe qué sesiones están corriendo

Se invoca cuando:
- `kodo orchestrate` manual
- El servidor detecta una situación que requiere juicio (sesión stuck >30min, múltiples tareas compitiendo por prioridad, tarea compleja que necesita descomposición)

El prompt del orquestador:
```markdown
Eres el orquestador de kodo. Tu trabajo es:

1. Revisar las tareas en Plane (via MCP) y decidir prioridades
2. Verificar el estado de las sesiones activas (via cmux read-screen)
3. Desbloquear sesiones stuck (enviar mensajes via cmux send)
4. Descomponer tareas complejas en subtareas de Plane
5. Decidir cuándo lanzar nuevas sesiones y cuándo esperar

Reglas:
- Máximo 3 sesiones simultáneas (controlar costes)
- Usar Sonnet por defecto, Opus solo para tareas complejas
- Si una sesión lleva >30min idle, investigar y decidir: nudge, kill, o escalar
- Actualizar Plane con comentarios sobre el progreso
- Al terminar, señalizar [kodo:idle] y esperar
```

### 5. Configuración

**Archivo**: `~/.kodo/config.json`
```json
{
  "plane": {
    "base_url": "https://tasks.kintsugi-lab.com",
    "api_key_env": "PLANE_API_KEY",
    "workspace_slug": "klab",
    "projects": ["project-uuid-1", "project-uuid-2"],
    "trigger_state": "In Progress",
    "done_state": "Done",
    "review_state": "In Review"
  },
  "cmux": {
    "binary": "/Applications/cmux.app/Contents/Resources/bin/cmux",
    "colors": {
      "running": "Amber",
      "done": "Green",
      "error": "Crimson",
      "review": "Blue"
    }
  },
  "claude": {
    "binary": "/Applications/cmux.app/Contents/Resources/bin/claude",
    "default_model": "sonnet",
    "max_parallel": 3,
    "flags": ["--dangerously-skip-permissions"]
  },
  "server": {
    "port": 9090,
    "idle_threshold_min": 5,
    "stuck_threshold_min": 30
  }
}
```

## Estructura del repo

```
kodo/
├── package.json
├── bin/
│   └── kodo                    # CLI entry point (#!/usr/bin/env node)
├── src/
│   ├── cli.js                  # Commander-based CLI
│   ├── server.js               # HTTP webhook receiver + session manager
│   ├── plane/
│   │   ├── client.js           # Plane API client (REST)
│   │   └── types.js            # Type definitions / schemas
│   ├── cmux/
│   │   ├── client.js           # cmux CLI wrapper
│   │   └── colors.js           # Color mapping logic
│   ├── session/
│   │   ├── manager.js          # Create/track/cleanup sessions
│   │   ├── state.js            # State store (~/.kodo/state.json)
│   │   └── health.js           # Health checks (idle, stuck, error)
│   ├── hooks/
│   │   ├── session-start.js    # Claude Code SessionStart hook
│   │   ├── stop.js             # Claude Code Stop hook
│   │   └── install.js          # Auto-register hooks in settings.json
│   └── orchestrator/
│       ├── prompt.md           # System prompt for orchestrator
│       └── launch.js           # Spawn orchestrator Claude session
├── test/
│   ├── plane-client.test.js
│   ├── cmux-client.test.js
│   └── session-manager.test.js
└── README.md
```

## Flujo completo (ejemplo)

1. **En Plane**: mueves "KL-42: Implementar auth en tenderio" a "In Progress"
2. **Plane webhook** llega a kodo server via Tailscale
3. **kodo server** ejecuta:
   ```bash
   cmux new-workspace --name "KL-42: Auth tenderio" --cwd /Users/alex/dev/klab/tenderio
   cmux workspace-action --action set-color --color Amber
   cmux send --workspace workspace:N "claude --session-id kodo-KL-42 'Implementa la autenticación...'"
   ```
4. **Claude arranca** → SessionStart hook inyecta contexto de Plane
5. **Claude trabaja** (puede usar /gsd:* si el proyecto tiene GSD)
6. **Claude termina** → Stop hook dispara:
   - PATCH Plane work item → "Done"
   - `cmux workspace-action --action set-color --color Green`
   - Elimina sesión de state.json
7. **Notificación cmux**: "KL-42 completada"

## Flujo del orquestador

1. `kodo orchestrate` o trigger automático
2. Crea workspace cmux "kodo-orchestrator" (color Indigo)
3. Lanza Claude con Plane MCP + contexto de state.json
4. El orquestador:
   - Lee tareas de Plane → "hay 3 en Doing, 2 en Todo"
   - Verifica screens de sesiones activas via cmux
   - Toma decisiones: "KL-55 está idle 40min, le envío un nudge"
   - `cmux send --workspace workspace:5 "¿Necesitas ayuda? El objetivo es..."`
   - Actualiza comentarios en Plane
5. Cuando no hay más acciones → señaliza idle y termina

## Mapeo proyecto Plane -> path local

En config o en un archivo de mapeo `~/.kodo/projects.json`:
```json
{
  "plane-project-uuid-tenderio": "/Users/alex/dev/klab/tenderio",
  "plane-project-uuid-fvf": "/Users/alex/dev/roman/fvf"
}
```
Se configura una vez con `kodo config` y se reutiliza.

## Implementación por fases

### Fase 1: Esqueleto + Plane client + cmux client (MVP)
- `kodo config` — setup interactivo
- `kodo launch KL-42` — lanza manualmente una tarea
- Plane API client (list states, list work items, update work item)
- cmux client (new-workspace, send, read-screen, workspace-action)
- State store básico

### Fase 2: Webhook server + hooks
- `kodo start` / `kodo stop` — servidor HTTP para webhooks de Plane
- Verificación HMAC-SHA256 de firma
- Hooks de Claude Code (session-start, stop)
- Reacción automática a cambios de estado en Plane
- `kodo status` — ver sesiones activas

### Fase 3: Health checks + notificaciones
- Detección de idle/stuck/error
- Notificaciones cmux
- Colores automáticos por estado

### Fase 4: Orquestador
- `kodo orchestrate` — sesión Claude con Plane MCP
- Prompt del orquestador con reglas de decisión
- Trigger automático cuando hay sesiones stuck

### Fase 5: Polish
- `kodo install` — instala hooks y MCP server automáticamente
- Tests
- README
- npm publish (opcional)

## Verificación

- [ ] `kodo config` configura Plane API key y projects
- [ ] `kodo launch KL-42` crea workspace cmux con color y lanza Claude
- [ ] Claude recibe contexto de Plane via SessionStart hook
- [ ] Al terminar Claude, Stop hook actualiza Plane a "Done"
- [ ] `kodo start` recibe webhooks de Plane y reacciona a cambios de estado
- [ ] `kodo status` muestra sesiones activas con estado
- [ ] `kodo orchestrate` lanza sesión orquestadora funcional
- [ ] Colores de workspace se actualizan por estado

## Infraestructura existente a reutilizar

- **Plane CE**: `tasks.kintsugi-lab.com` (178.104.51.37) — API REST + webhooks
- **Plane MCP server**: `uvx plane-mcp-server` (v0.2.8, ya disponible)
- **cmux CLI**: `/Applications/cmux.app/Contents/Resources/bin/cmux` — workspaces, colores, send, read-screen, notify
- **cmux claude-hook**: integración nativa cmux<->Claude Code (session-start, stop, idle)
- **Tailscale**: red privada entre Mac y servidor
- **GSD skills**: `~/.claude/commands/gsd/` — instalado globalmente
- **Hooks existentes**: `~/.claude/hooks/gsd-context-monitor.js` (patrón stdin/stdout + debounce)
- **Plane Go client**: `/Users/alex/dev/klab/mattermost/server/plane/client.go` (patrones de API, auth, tipos)
