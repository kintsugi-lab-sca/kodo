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
- `KODO_API_TOKEN` (auth de la API) se genera solo en el primer arranque — no hace falta crearlo.

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
> Las herramientas locales (`kodo up`, `kodo dashboard`) siguen el bind
> automáticamente: no hace falta `0.0.0.0` ni pasar `--url`.
>
> Ver [Topología multi-nodo](#topología-multi-nodo) para las implicaciones de seguridad.

**Contrato de respuesta de `/webhook`** — Plane reintenta la entrega cuando recibe un
error, así que el status codifica si el evento merece otro intento:

| Status | Cuándo | Efecto en Plane |
|--------|--------|-----------------|
| `200`  | Evento aceptado, ignorado (sin label `kodo`, estado inactivo) o fallo **permanente** del dispatch | No reintenta |
| `401`  | Firma HMAC inválida o ausente | — |
| `400` / `413` | Body no-JSON o mayor de 1 MB | — |
| `503`  | Fallo **transitorio** del dispatch: Plane 5xx/429/408, red caída, timeout | Reintenta la entrega |

Un fallo transitorio se contesta con 503 en vez de tragarse el evento: sin ese
reintento la tarea se quedaba en In Progress sin sesión y sin explicación. La
clasificación es *default-closed* — solo lo que se reconoce como reintentable
devuelve 503; un error de configuración (p. ej. `No configured project`) falla igual
en cada intento, así que devuelve 200 para no abrir una tormenta de reintentos. Cada
503 deja un `webhook.dispatch.retry` en `kodo logs`.

El webhook espera al dispatch una ventana corta (2 s) antes de responder: lo justo
para ver morir la red, sin bloquear la respuesta durante el arranque completo de la
sesión. Un dispatch que sigue vivo al vencer la ventana responde 200 y continúa en
segundo plano.

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

## Comandos

```
kodo up                  # arranca daemon + dashboard (comando principal)
kodo stop                # para el daemon
kodo status              # estado del daemon (running|stopped)
kodo dashboard           # TUI de sesiones activas
kodo capture "<texto>"   # captura una idea al inbox global (~/.kodo/inbox.md)
kodo inbox               # triage del inbox (--all, --json, route <id>, discard <id>)
kodo integrate           # cola de integración: qué ramas esperan ff/merge/PR (--all, --json)
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

### `kodo integrate` — la cola de integración

Cada sesión termina pidiendo algo distinto: esta rama es un fast-forward, esta otra merece un
merge commit, esta hay que mirarla antes. Hasta ahora esa información viajaba solo en el nudge
efímero del hook Stop: si no actuabas en ese momento, se perdía y acababas repasando sesión por
sesión de memoria.

Ahora, **al cerrar una sesión cuya rama tiene commits que no están en ninguna otra referencia**
(el mismo cálculo que decide conservar la rama), kodo persiste una entrada en
`~/.kodo/state.json`. Una sesión que cierra ya mergeada no deja nada.

```bash
kodo integrate                    # la cola pendiente, en bloque
kodo integrate --all --json       # incluida la traza de lo ya resuelto, como JSON
kodo integrate KODO-26 --ff       # fast-forward (falla si no es posible)
kodo integrate KODO-26 --merge    # merge commit explícito (--no-ff)
kodo integrate KODO-26 --pr       # prepara la rama y DEVUELVE el comando gh listo
kodo integrate KODO-26 --drop     # descarta la entrada sin tocar la rama
kodo integrate KODO-26 --merge --test 'npm test'   # suite antes de integrar
```

```
ref     · rama             · commits · base · sugerido · edad · estado
KODO-26 · worktree-5b1f809 · 3       · sí   · merge    · 2h   ·
KODO-24 · worktree-ae91f22 · 1       · NO   · merge    · 3d   ·
```

**La sugerencia es una sugerencia.** Sale de una heurística simple y visible, y la confirma
quien integra:

| Qué toca la rama | Sugerencia |
|---|---|
| Solo documentación y tests | `ff` |
| `src/` sin nada sensible | `merge` |
| Migraciones, auth, billing, credenciales, o un diff de más de 400 líneas | `pr` |
| Diff no inspeccionable (sin base resoluble, o solo merge commits) | `review` |

La columna **base** es `merge-base` en una palabra: `sí` significa que la rama contiene la base
entera; `NO`, que `main` avanzó por debajo mientras la sesión trabajaba. Con `NO` (o con `?`, no
verificable) el `ff` **nunca** se sugiere — `git merge --ff-only` fallaría.

Lo que este comando **no** hace, por contrato:

- **Nunca hace `git push` ni crea PRs.** `--pr` valida la rama, marca la entrada y te imprime el
  `git push … && gh pr create …` listo para pegar. Publicar sigue siendo tuyo.
- **Nunca cambia de rama.** Si el repo no está en la base, aborta con código 1 y te lo dice; no
  hace `switch` por debajo.
- **Nunca borra la rama** tras integrar (eso es del cleanup, que ya sabe verificar) **ni borra la
  entrada** de la cola: al resolverla queda con su `status`, `action`, `sha` y `outcome` como
  traza, igual que el inbox.
- **Nunca integra sobre un worktree sucio.** Es la primera precondición que comprueba.

Exit codes: `0` la acción se ejecutó · `1` falló (worktree sucio, base no checkouteada, merge
rechazado, suite en rojo) · `2` uso incorrecto o ref que no está pendiente en la cola. Solo el
`0` saca la entrada de pendiente.

Cada acción —incluido `--drop`— deja además una línea NDJSON en
`~/.kodo/logs/integrate.ndjson` con `{action, task_ref, branch, sha, outcome}`, en éxito y en
fallo. Ese es el registro permanente de lo que se ejecutó; si el log no es escribible, la acción
sigue igual.

El listado no hace **ni una** llamada a git: todo se calculó al cerrar la sesión y vive en
`state.json`, así que el orquestador puede presentar la cola entera en cada ronda gratis. El
dashboard lo refleja como `N por integrar` en la cabecera, y `kodo status` lista el bloque.

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
Orca al crear el worktree. Lo verás en el log como `worktree_skipped_host`.

**Los worktrees de Orca no se borran solos.** Con cmux, kodo crea
`<repo>/.bg-shell/<id>` y lo limpia al cerrar la sesión. Con Orca el checkout es *tu*
workspace —tiene su tarjeta en el tablero y su rama— así que kodo no lo toca: es donde
revisas el trabajo cuando el agente termina. Lo cierras tú, desde la app o con
`orca worktree rm`. Ninguna ruta de kodo ejecuta ese comando, y hay un test que falla
si alguien lo cablea.

Las columnas del tablero se ajustan igual que los colores de cmux:

```bash
kodo config --set orca.statuses.review=in-review
```

### Cambiar de cliente con sesiones vivas

Cada sesión guarda bajo qué cliente se lanzó. Es lo que permite que conmutar `host`
**no toque** las sesiones del cliente anterior: sus workspaces no aparecen en el
snapshot del nuevo, y sin ese sello kodo las leería como «tab desaparecida» y las
degradaría a idle/dead estando perfectamente vivas. Ausencia de evidencia no es
evidencia de muerte: se quedan intactas hasta que vuelvas a su cliente.

Las sesiones lanzadas antes de v0.19 no llevan el sello y sí se evalúan como antes.

### Cambiar de cliente con un orquestador vivo

Si conmutas `host` mientras `kodo orchestrate` está corriendo, el orquestador del
cliente anterior queda **fuera del alcance** del nuevo: su workspace no aparece ahí, y
esa ausencia es *estructural* — no significa que haya muerto. kodo **no lanza otro por
su cuenta**: dos supervisores sobre el mismo `state.json` despachan la misma tarea dos
veces, se pisan los nudges y duplican comentarios en el provider.

```
[kodo] Orchestrator registrado en … pertenece al host 'cmux' y el host activo es
'orca' — NO se lanza otro.
[kodo]   Desde 'orca' no puedo ver si sigue vivo. Si el orquestador de 'cmux' está
abierto, ciérralo; después: kodo orchestrate --force
```

La decisión es tuya porque eres el único que puede mirar el otro cliente. Comprueba que
el anterior está cerrado y lanza el nuevo con `--force`.

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
- **Marca del propio daemon**: `kodo server` renombra y colorea su tab partiendo de
  `CMUX_WORKSPACE_ID`, que solo existe dentro de cmux. Con Orca el bloque se salta —
  es cosmética del daemon, no del ciclo de vida de las sesiones.
- **`needs-input`**: se deriva de `agents[].state` de Orca (`done` = el agente
  terminó su turno y espera). Requiere los hooks de agente: actívalos con
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

### El tooling local sigue el bind

`kodo up` y `kodo dashboard` derivan a qué host conectarse del propio
`server.bind`, así que un bind a una interfaz concreta funciona tal cual:

| `server.bind`            | dónde escucha el daemon | a qué se conectan `up` / `dashboard` |
| ------------------------ | ----------------------- | ------------------------------------ |
| ausente (default)        | `127.0.0.1`             | `http://localhost:<port>`            |
| `0.0.0.0` / `::`         | todas las interfaces    | `http://localhost:<port>`            |
| `100.x.y.z` (Tailscale)  | `100.x.y.z`             | `http://100.x.y.z:<port>`            |

Conectar a una IP asignada a esta misma máquina no sale del kernel, así que el
dashboard funciona igual de rápido que contra loopback. **No hace falta bindear a
`0.0.0.0` ni añadir reglas de firewall solo para que el dashboard hable con el
daemon**, y `kodo status` no toca la red en ningún caso (resuelve por PID).

`--url` queda reservado para lo que el bind no describe: apuntar el dashboard a un
daemon que corre en **otra** máquina.

```bash
kodo dashboard --url http://100.x.y.z:9090
```

La exposición **no** relaja la autenticación:

- El carril no-webhook (la API que consume el TUI) sigue exigiendo el **bearer token**
  (`KODO_API_TOKEN`) en la cabecera `Authorization` — sin token responde `401`.
- `/webhook` conserva su verificación **HMAC** con el webhook secret.
- `/health` permanece abierto (probe de salud sin auth).

> **Nota — el token va siempre en cabecera.** No hay ruta que lo acepte como query
> param: el `?token=` existía solo para el dashboard web, retirado. Si sospechas que
> se ha filtrado, borra la línea `KODO_API_TOKEN` de `~/.kodo/.env` (se regenera al
> arrancar) y reinicia (`kodo stop && kodo up`).

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
| `src/server.js` | Servidor HTTP `:9090` — webhook (HMAC) + API JSON autenticada |
| `src/daemon/` | Ciclo de vida del daemon (`kodo up/stop/status`, `daemon run` para launchd) |
| `src/triggers/` | Dispatch de eventos: webhook (Plane), polling (GitHub) |
| `src/providers/` | Clientes de Plane y GitHub (REST, normalización, estados) |
| `src/cmux/` + `src/host/` | Wrapper del CLI de cmux: workspaces, screens, colores |
| `src/session/` | Manager de sesiones, state store (`~/.kodo/state.json`), loop de reconciliación, barrido de sesiones huérfanas |
| `src/hooks/` | SessionStart (inyecta contexto de la tarea), Stop (estado ligero per-turn: idle + lock liberado) y SessionEnd (backstop "In Review" + cleanup terminal + color/notify/nudge al cierre real) |
| `src/integration/` | Cola de integración: captura al cerrar sesión, heurística de tier y store sobre `state.json` |
| `src/orchestrator/` | Lanzamiento del orquestador + su prompt |
| `src/cli/dashboard/` | Dashboard TUI (Ink/React) |

## Archivos

```
~/.kodo/
├── .env               # PLANE_API_KEY, PLANE_WEBHOOK_SECRET, KODO_API_TOKEN
├── config.json        # provider, estados, servidor, claude
├── projects.json      # proyecto del provider → path local
├── state.json         # sesiones activas + registro del orquestador (`.orchestrator`) + cola de integración (`.integration_queue`)
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
