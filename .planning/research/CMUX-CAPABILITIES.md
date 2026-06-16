# Research — Capacidades de cmux infrautilizadas por kodo

**Fecha:** 2026-06-16
**Autor:** análisis Claude (sesión orquestador)
**Versión cmux verificada:** `cmux 0.64.15 (95)` — instalada en la máquina de dev
**Método:** verificación empírica contra el binario real (`cmux --help`, `cmux capabilities`,
`cmux surface resume show --json`, `cmux events`, `cmux top`) + docu pública en
`cmux.com/es/docs/concepts` + skill `cmux` instalado.

> ⚠️ **Aviso de fuentes:** la página `cmux.com/es/docs/api` está desactualizada / incompleta.
> Afirma que *"cmux no expone lectura de output/screen"* y **no menciona el event bus**.
> Ambas cosas son falsas en 0.64.15. **Fiarse del binario instalado, no de la web.**

---

## TL;DR

kodo consume hoy ~5 comandos de cmux (`list-workspaces`, `new-workspace`, `send`,
`set-color`, `select-workspace`). cmux 0.64.15 ofrece cuatro capacidades infrautilizadas
que encajan con los invariantes de kodo (0-token, determinista, fail-open) y mapean a
milestones activos:

| # | Capacidad | Impacto | Milestone |
|---|-----------|---------|-----------|
| **P0** | `surface resume show --json` | **Resuelve la SPIKE de Phase 55 antes de empezarla** | v0.13 (activo) |
| **P1** | `cmux events` + `top --processes` | Reconcile event-driven en vez de polling 60s | v0.14 (futuro) |
| **P2** | `set-progress` / `set-status` / `log` | Progreso vivo en sidebar nativo sin abrir el TUI | mejora de v0.12 |
| **P3** | `notify` rico + `send-key` | Notificaciones útiles + desbloqueo programático | oportunista |

**Regla transversal:** toda capacidad cmux-específica entra por el contrato `HostProvider`
(`src/host/interface.js`) e implementada en `src/host/cmux.js`, con detección `typeof`
para degradar elegante. No esparcir llamadas a `cmux` por `adopt.js` / `reconcile.js` /
hooks (erosiona la abstracción de Phase 38: cmux → orca).

---

## P0 — `surface resume show` resuelve la SPIKE de Phase 55

**Phase 55 (SPIKE, hard gate BIDIR-F1):** *"¿cmux expone cwd + UUID estable de sesión
ad-hoc? Si INVIABLE → Phase 56 se difiere."*

**Respuesta empírica: VIABLE, sin ambigüedad.** Salida real de `cmux surface resume show --json`:

```json
{
  "surface_ref": "surface:23", "workspace_ref": "workspace:11", "pane_ref": "pane:14",
  "cleared": false,
  "resume_binding": {
    "kind": "claude",
    "checkpoint_id": "70549d53-fb60-48b0-99b1-fd496ef0c5b0",   // == session_id de Claude Code
    "cwd": "/Users/alex/dev/klab/kodo",                          // == project path
    "source": "agent-hook",
    "auto_resume": true,
    "approval_policy": "auto",
    "command": "... claude --resume 70549d53... --dangerously-skip-permissions --teammate-mode tmux"
  }
}
```

Dado un workspace/surface, cmux entrega **cwd + session_id estable + kind del agente**,
sin screen-scraping ni heurística. Fuente cruda alternativa:
`~/.cmuxterm/claude-hook-sessions.json` (mapa `surfaceUUID → {sessionId, updatedAt}`,
y `activeSessionsByWorkspace`).

### Implicaciones para v0.13

- **Phase 54 (`kodo adopt`)**: hoy diseñado con flags manuales
  (`--workspace --cwd --title --project`). cmux permite **derivar `--cwd` y el `session_id`
  automáticamente**. El operador solo aporta lo que cmux no sabe: a qué tarea/proyecto del
  gestor pertenece la sesión.
- **Phase 56 (tecla `a` del dashboard)**: deja de ser condicional. Descubre sesiones
  adoptables = surfaces con `resume_binding.kind == "claude"` cuyo `session_id` no está ya
  en `state.json`.

### Recomendación crítica sobre Phase 55

**No ejecutar Phase 55 como "SPIKE research abierto" — la viabilidad ya está probada.**
Reconvertirla en una tarea corta de **contrato `HostProvider`**:

1. Definir método nuevo, p. ej. `describeSurface(ref)` / `listAgentSurfaces()` en
   `src/host/interface.js`, implementado en `src/host/cmux.js`.
2. Fijar qué campos de `resume_binding` se consumen (`kind`, `checkpoint_id`, `cwd`,
   `workspace_ref`) y su estabilidad entre reinicios de cmux.
3. Modos de fallo a manejar: `cleared: true`, `resume_binding` ausente, `source != agent-hook`,
   socket de cmux no disponible (fail-open).

Esto ahorra una fase entera y destraba Phase 56.

---

## P1 — Event bus: reconcile event-driven (candidato v0.14)

Hoy `reconcile.js` corre cada ~60s (setTimeout recursivo), único escritor de `alive`,
detecta muerte de proceso a posteriori con hasta 1 min de latencia.

cmux emite un **stream de eventos con cursor persistente y reanudable**:

```bash
cmux events --after <seq> --cursor-file <path> --category agent --name agent.hook.Stop
```

Muestra real capturada (`cmux events --limit 8`):

```
category=agent     name=agent.hook.UserPromptSubmit   payload={session_id, cwd, workspace_id, phase}
category=sidebar   name=sidebar.metadata.updated      payload="set_status claude_code Running --pid=10947"
category=workspace name=workspace.prompt.submitted    payload={message_preview, workspace_id}
category=feed      name=feed.item.completed           payload={session_id, result.status}
```

Capacidades relevantes:

- **Liveness en tiempo real**: cmux ya conoce el `--pid` de cada agente y su estado
  (`Running`). `cmux top --all --processes --flat --format tsv` da el árbol de PIDs por
  workspace/surface con CPU/MEM. Detección de muerte determinista e instantánea vs reconcile
  a ciegas. (`cmux surface-health` también existe.)
- **needs-input / idle**: los eventos `agent.hook.*` (Stop, Notification, UserPromptSubmit)
  dan el estado intermedio que la columna `status` del dashboard hoy solo aproxima.
- **0-token determinista**: respeta el invariante "vigilante/server 0 tokens".

### Crítica / forma recomendada

- Acoplamiento fuerte a cmux → **detrás de `HostProvider` o no va.**
- **No reemplazar** el reconcile en un solo salto. `state.json` sigue siendo la fuente de
  verdad y el fallback si el socket no está. Plantear como **fast-path event-driven con
  reconcile como red de seguridad**: los eventos adelantan transiciones; el tick periódico
  (espaciado a ~5 min) corrige divergencias.
- Riesgo: `events.jsonl` crece (vimos 56 MB de `workstream.jsonl`). Usar `--after`/cursor,
  nunca releer todo.

---

## P2 — Sidebar nativo: progreso vivo sin TUI (mejora de v0.12)

v0.12 ("progreso vivo") se resolvió parseando `STATE.md` y pintándolo en el dashboard TUI.
Funciona, pero exige tener el TUI abierto. cmux tiene API de sidebar que kodo no toca:

```bash
cmux set-progress 0.4 --label "fase 2/5: execute" --workspace <ref>
cmux set-status kodo:task "ROMAN-180" --icon bolt --color "#4C8DFF" --workspace <ref>
cmux log --level info "verificación passed" --source kodo --workspace <ref>
```

kodo hoy solo usa `set-color`. Empujar el progreso GSD ya calculado (`N/M`, columna `prog`)
a `set-progress`/`set-status` lo hace visible en la barra lateral nativa de cmux, para
cualquier sesión, sin abrir el dashboard. **Menor esfuerzo, mayor visibilidad** de la lista:
el dato ya existe, es un comando más en `CmuxHost`.

⚠️ cmux **ya** pone `set-status claude_code Running` automáticamente vía su propio hook.
Usar una `key` distinta (`kodo:task`, `kodo:progress`) para no pisarla.

---

## P3 — Notificaciones reales + `send-key` (oportunista)

- `cmux notify --title --subtitle --body --workspace <ref>` (hoy kodo manda `notify` plano).
  Señalar verificación fallida / needs-input al operador.
- `cmux send-key --surface <id> Enter|Escape|"ctrl+c"`: kodo solo usa `send` (texto). Con
  `send-key` el orquestador podría desbloquear o cerrar sesiones (`/exit`, responder prompts)
  de forma programática. Encaja con la dirección bidireccional.

---

## Lo que NO aprovechar (criba crítica)

| Capacidad cmux | Veredicto | Razón |
|---|-----------|-------|
| `read-screen` para detectar progreso | ❌ Evitar | Screen-scraping frágil. `STATE.md` parsing es estructurado y robusto. Solo para diagnóstico puntual. |
| `new-surface --type agent-session --provider claude` | ⚠️ No ahora | Cambiar el launch (que funciona) por el nativo de cmux: alto riesgo / bajo retorno, más acoplamiento en el camino crítico. |
| `claude-teams` / `codex-teams` | ⚠️ Vigilar, no adoptar | Orquestación multi-agente nativa de cmux = competencia de lo que ES kodo. Referencia de diseño, no dependencia. |
| Hooks de cmux reemplazando los de kodo | ⚠️ Tradeoff consciente | cmux **ya intercepta** los hooks de Claude Code y los reemite como `agent.hook.*`. Hoy hay **dos interceptores del mismo evento** (kodo en `~/.claude/settings.json` + cmux). Consumir `cmux events` y dejar de instalar hooks propios os acopla a cmux para una función núcleo. Decidir conscientemente. |

---

## Riesgo transversal: acoplamiento vs `HostProvider`

Phase 38 introdujo `HostProvider` para poder cambiar cmux → orca. Todo P0–P3 es
cmux-específico. Si entra directo en `adopt.js` / `reconcile.js` / hooks, **erosiona esa
abstracción**.

**Regla:** toda capacidad nueva de cmux entra por `src/host/interface.js` como método del
contrato `HostProvider`, implementada en `src/host/cmux.js`. Métodos opcionales detectados
por `typeof` (mismo patrón que `getTaskState()` / `createTask()`) para que un host que no
los soporte degrade fail-open, no rompa.

---

## Secuencia recomendada

1. **Ahora (desbloquea v0.13):** reconvertir Phase 55 de "SPIKE research" a "contrato
   `HostProvider.describeSurface()`". Viabilidad ya probada. Destraba Phase 56, simplifica
   Phase 54 (auto-deriva `--cwd`/`session_id`).
2. **Quick win en paralelo:** `set-progress`/`set-status` en `CmuxHost` (P2). Bajo riesgo,
   visible ya.
3. **v0.14 (nuevo milestone):** fast-path event-driven sobre `cmux events` + `top --processes`,
   con el reconcile actual como red de seguridad (P1).

---

## Apéndice — comandos cmux verificados (no exhaustivo)

```
# Correlación de sesiones (P0)
cmux surface resume show --json            # cwd + checkpoint_id(session_id) + kind por surface
cat ~/.cmuxterm/claude-hook-sessions.json  # surfaceUUID → sessionId (fuente cruda)

# Event bus + liveness (P1)
cmux events --after <seq> --cursor-file <p> --category agent [--name <n>] [--reconnect]
cmux top --all --processes --flat --format tsv   # árbol PID/CPU/MEM por workspace/surface
cmux surface-health
cmux capabilities                          # métodos JSON-RPC soportados

# Sidebar (P2)
cmux set-progress <0.0-1.0> --label <txt> --workspace <ref>
cmux set-status <key> <value> --icon <name> --color <#hex> --workspace <ref>
cmux log --level <lvl> --source <name> --workspace <ref> <msg>
cmux sidebar-state --workspace <ref>       # volcado de toda la metadata

# Interacción (P3)
cmux notify --title <t> --subtitle <s> --body <b> --workspace <ref>
cmux send-key --surface <id> <Enter|Escape|ctrl+c|...>
cmux read-screen --surface <id> [--scrollback] [--lines <n>]   # existe, pese a la web

# Acceso
# Socket Unix: /tmp/cmux.sock (override CMUX_SOCKET_PATH). JSON-RPC. cmux rpc <method> <json>
# Env auto: CMUX_WORKSPACE_ID, CMUX_SURFACE_ID, CMUX_SOCKET_PATH
```
