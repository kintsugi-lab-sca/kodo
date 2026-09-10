# ¿Merece la pena un agent-plugin para kodo?

**KODO-87** · 2026-09-10 · revisión sobre `v0.28.0`
Artículo de referencia: *"Stop Shipping Individual MCP Servers. Start Shipping Agent Plugins"* (A. Tkachuk, ago 2026).

---

## Veredicto

**Sí, pero como capa aditiva delgada — y no por el motivo que sugiere el artículo.**

Un plugin de Claude Code cubre **2 de los 7 pasos** de instalación de kodo (3 si se cuenta el MCP del provider). Los 5 caros —binario, servicio supervisado, credenciales, config, webhook— quedan intactos, porque un plugin no es un gestor de paquetes ni un supervisor de procesos.

El argumento fuerte a favor **no es reducir pasos de instalación**. Es:

1. Desinstalación limpia y sin residuos.
2. Fin del drift de skills (y borrado de 182 líneas de sincronizador por hash).
3. Dejar de escribir en `~/.claude/settings.json`, un fichero que kodo comparte con todo lo demás del usuario.

### Matiz que hay que fijar antes de nada

El artículo describe **Agent Plugins 1.0** (Vercel + Amazon + Anysphere + Microsoft + OpenAI + Google). Ese spec **no aplica a kodo**, y el propio artículo lo dice:

> *"Anthropic's own Claude plugin format bundles Skills, connectors, and sub-agents, but it wasn't among the launch clients for the Agent Plugins 1.0 spec in August — it still uses its own layout."*

El core portable de Agent Plugins 1.0 son **solo Skills + `mcp.json`**. Los hooks quedan explícitamente fuera, en el namespace vendor-specific. Y los hooks **son** kodo: el ciclo de vida entero (SessionStart / Stop / SessionEnd) es lo que convierte una tarea de Plane en una sesión gestionada.

Dicho de otro modo: kodo no es portable por diseño, y el spec portable no le compra nada hoy. Lo que sí existe y sí aplica es el **formato de plugin de Claude Code**. Esta revisión va sobre eso.

---

## Superficie de instalación actual

Verificado en el árbol, no de memoria:

| # | Paso | Cómo se hace hoy | ¿Lo cubre un plugin de Claude Code? |
|---|------|------------------|--------------------------------------|
| 1 | Binario `kodo` en PATH | `brew install kodo` / `npm i -g …#vTAG` | **No** |
| 2 | Servicio supervisado | `brew services start kodo` / `kodo install --systemd` | **No** |
| 3 | Credenciales | `~/.kodo/.env` a mano (`PLANE_API_KEY`, secreto webhook) | **No** |
| 4 | Config + mapeo de proyectos | `kodo config` | **No** |
| 5 | Webhook en el provider | UI de Plane, a mano | **No** |
| 6 | Hooks de Claude Code | `kodo install` → reescribe `~/.claude/settings.json` | **Sí** |
| 7 | Skills en `~/.claude/skills/` | `kodo skill sync` (copia + diff SHA-256) | **Sí** |
| 8 | MCP del provider | a mano en `~/.claude.json` | **Parcial** |

**2 de 7 pasos automatizados** (3 de 8 contando el MCP). Nada del carril de instalación real desaparece.

---

## Lo que sí se gana

### Hooks — la ganancia más limpia

Hoy `src/hooks/install.js` parchea `~/.claude/settings.json` inyectando comandos con **rutas absolutas** al directorio de instalación:

```
node "/opt/homebrew/.../src/hooks/session-start.js"
```

Eso obliga a mantener a mano: detección de duplicados, matching por segmento de ruta (`/src/hooks/<name>.js`), `uninstallHooks()`, y un detector de deriva por-evento. Son ~200 líneas cuyo único trabajo es no romper el `settings.json` de otro.

Con un plugin, es un `hooks/hooks.json` declarativo con `${CLAUDE_PLUGIN_ROOT}` y el cliente gestiona el ciclo de vida. Desinstalar el plugin desregistra los hooks; hoy, si alguien borra el brew keg sin `kodo uninstall`, quedan tres comandos rotos apuntando a un directorio inexistente.

**Detalle favorable, verificado:** el grafo de módulos de los tres hooks (`config.js`, `session/state.js`, `labels.js`, `session/context.js`, `logger.js`) **no importa ni una dependencia externa** — solo builtins `node:*`. Por tanto el plugin no necesita un `setup.sh` que haga `npm install` dentro del cache, que es justo el andamiaje extra que `claude-mem-lite` sí arrastra. kodo se libra de él.

### Skills — desaparece un subsistema entero

`kodo skill sync` existe solo porque no hay canal de distribución: 182 líneas de walker recursivo + diff SHA-256 fichero a fichero + detección de symlink legacy + `--prune` + su comando de CLI + sus tests. Con un plugin, el cliente hace el pull desde el repo y el drift deja de ser un concepto.

### MCP del provider — el paso manual más feo

Hoy el MCP de Plane vive en `~/.claude.json` con la **API key en claro e inline**, configurado a mano. Un plugin puede shippear un `.mcp.json` que apunte a un launcher propio que lea `~/.kodo/.env` y haga `exec` del server con el entorno ya montado. Elimina el paso manual **y** saca el secreto de `~/.claude.json`.

### Commands

`kodo capture`, `kodo status`, `kodo doctor` pasarían a ser slash commands nativos (`commands/*.md`), que hoy no existen.

---

## Lo que NO se gana, y lo que rompe

### 1. El binario y el daemon: techo duro

Precedente empírico, no teoría. El plugin de **basecamp** (37signals) declara sus hooks así:

```json
{ "type": "command", "command": "basecamp agent-hook session-start" }
```

Invocación **por nombre en PATH**. El plugin no instala el CLI: asume un `brew install` previo. Es exactamente el mismo techo que tendría kodo, y viene de un equipo que sí controla ambos extremos.

### 2. Skew de versión — el riesgo real

Con plugin habría **dos copias de kodo** en la máquina: la de brew (que corre el daemon bajo launchd) y la del cache del plugin (que corre los hooks). Ambas leen y escriben `~/.kodo/state.json`, un contrato con `schema_version` y una docena larga de campos aditivos opcionales (`worktree_path`, `branch_head`, `base_commit`, `process_dead_since`, `review`, `agent`…).

Hoy ese skew **no puede existir**: hay una sola copia. Con plugin, sí — y se manifestaría como un hook escribiendo un campo que el daemon de otra versión ignora, en silencio. Esto no es cosmético; es la objeción seria.

Mitigación: que el `hooks.json` del plugin invoque el `kodo` del PATH (modelo basecamp) en vez de su propia copia. Pero entonces se pierde la ventaja de `${CLAUDE_PLUGIN_ROOT}` y el plugin se queda en poco más que un vehículo para las skills.

### 3. `kodo doctor` se queda ciego

`src/cli/doctor.js:52` lee **solo** `~/.claude/settings.json`, y `checkHookRegistration` valida evento por evento. Con los hooks en el plugin, el doctor reportaría los tres como `NO registrado` para siempre — un falso rojo permanente en el comando cuya razón de ser es detectar deriva. Hay que enseñarle a leer `~/.claude/plugins/installed_plugins.json` y el `hooks/hooks.json` del plugin. Es trabajo obligatorio, no opcional.

### 4. `kodo-orchestrate` no es una skill válida hoy

`.claude/skills/kodo-orchestrate/skill.md`:

- **No tiene frontmatter YAML** — arranca directamente con `# kodo:orchestrate`. Sin `name` ni `description` no hay descubrimiento.
- El fichero está en **minúsculas** (`skill.md`), no `SKILL.md`. En macOS pasa desapercibido; en Linux, no. El propio `src/skill/sync.js` documenta esa deuda ("el rename difiere D-08") y tolera ambos casos como parche.

En el árbol del repo cuela por autocarga contextual. Como skill de plugin, no. **Arreglarlo es prerequisito**, y conviene hacerlo aunque el plugin no se llegue a hacer.

### 5. Gobernanza — el punto que el artículo acierta

kodo lanza `claude` con `--dangerously-skip-permissions` (`src/config.js:211`) sobre worktrees de repos reales, y el daemon acepta webhooks. Distribuir eso por un marketplace baja la fricción de instalación de algo con ese blast radius. El artículo lo formula bien: *"discoverable, installed, authorized, enabled, and executable are five different states"*. Si se publica el marketplace, el README tiene que decir explícitamente qué hace kodo antes de que alguien teclee `/plugin install`.

---

## Coste

| Alcance | Estimación |
|---------|-----------|
| Mínimo: `plugin.json` + `hooks/hooks.json` + mover skills + arreglar frontmatter de `kodo-orchestrate` + `marketplace.json` + enseñar al doctor | **~1 día** |
| Añadir launcher de MCP del provider que lea `~/.kodo/.env` | **+medio día** |
| Mantener los dos carriles (brew/npm + plugin) coherentes | **coste recurrente**, no de arranque |

El coste de arranque es bajo. El recurrente no es cero: cada release tiene que publicar tag, fórmula de brew **y** versión del plugin, y ninguna puede quedarse atrás sin que aparezca el skew del punto 2.

---

## Recomendación

**Hacerlo, en este orden y con este alcance:**

1. **Ahora, independientemente del plugin:** arreglar `kodo-orchestrate` (frontmatter + rename a `SKILL.md`). Es deuda ya reconocida en el código y no depende de esta decisión.
2. **Plugin como capa aditiva:** cubre los pasos 6, 7 y 8. `brew` / `npm -g` siguen cubriendo 1–5.
3. **No borrar `kodo install` ni `kodo skill sync`.** Pasan a ser el carril de "instalado desde fuente", que es como se desarrolla kodo a diario.
4. **Enseñar al doctor a ver los dos carriles** en el mismo commit que introduzca el plugin, no después.
5. **Decidir explícitamente** entre hooks con `${CLAUDE_PLUGIN_ROOT}` (limpio, con riesgo de skew) o con `kodo` del PATH (modelo basecamp: sin skew, sin ventaja). Recomendación: **PATH**, porque el skew de `state.json` es peor que la ganancia de aislamiento, y porque conserva una única fuente de verdad del código.

### La alternativa que hay que descartar en voz alta

**No hacer nada.** `kodo install` + `kodo skill sync` son dos comandos, funcionan, y ya están en el README. Quien instala kodo ya está en una terminal ejecutando `brew install` — dos comandos más no son la fricción dominante ahí.

Si el objetivo declarado era *"facilitar la instalación"*, el plugin **no lo justifica**: quita 2 pasos de 7 y añade un carril de distribución que mantener. Lo que sí lo justifica es el uninstall limpio, la muerte del sincronizador de skills, y dejar de tocar el `settings.json` del usuario. Si esas tres cosas no importan lo suficiente, la respuesta correcta a KODO-87 es **no**.
