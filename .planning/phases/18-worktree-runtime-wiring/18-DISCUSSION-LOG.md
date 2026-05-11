# Phase 18: Worktree Runtime Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-11
**Phase:** 18-worktree-runtime-wiring
**Areas discussed:** Forma de invocar `--worktree`, Timing de persistencia `worktree_path`, Manejo de colisión de path, Scope de "todas las sesiones"

---

## Forma de invocar `--worktree`

| Option | Description | Selected |
|--------|-------------|----------|
| `--worktree <session-id>` explícito | kodo computa el nombre = session-id UUID. Path determinístico antes del spawn. Permite escribir `worktree_path` en state.json ANTES de invocar claude. | ✓ |
| `--worktree` sin argumento | claude genera el nombre. kodo lee post-spawn vía `git worktree list`. Menos control: drift si claude cambia naming. | |
| Otro (preguntar) | Tercera vía — ej. `git worktree add` manual desde kodo. | |

**User's choice:** `--worktree <session-id>` explícito
**Notes:** Captura D-01. Single source of truth en kodo, no en claude.

---

## Branch naming (follow-up de Área 1)

| Option | Description | Selected |
|--------|-------------|----------|
| Lo que decida claude (default) | claude usa su default derivado del worktree name. kodo no controla; consumers leen con `git -C <worktree> branch --show-current`. | ✓ |
| Forzar branch = session-id | Pasar flag adicional o pre-crear branch. Mayor control pero más código. | |
| No-op por ahora, Phase 19 lo cubrirá | Defer. | |

**User's choice:** Lo que decida claude
**Notes:** Captura D-02. No hay consumer downstream en Phase 18 que necesite la branch determinística.

---

## Timing de persistencia `worktree_path`

| Option | Description | Selected |
|--------|-------------|----------|
| PRE-spawn determinístico | kodo computa `join(projectPath, '.bg-shell', sessionId)` y llama `addSession` ANTES de `cmux.send`. `kodo logs --session-of` y otros consumers tienen el path inmediato. | ✓ |
| POST-spawn leer de git | Spawn primero; después leer `git worktree list --porcelain`. Más correcto pero timing-sensitive. | |
| PRE-spawn + verificación post-spawn opcional | Escribir PRE-spawn y opcionalmente assert en `session-start` hook. Defensa en profundidad. | |

**User's choice:** PRE-spawn determinístico
**Notes:** Captura D-03. La verificación post-spawn se deja deferida (D-03b) — entra a Phase 19 si surge drift en QA.

---

## Workspace cmux y cwd (follow-up de Área 2)

| Option | Description | Selected |
|--------|-------------|----------|
| Dejar cwd = projectPath | cmux shell arranca en repo principal; `claude --worktree <session-id>` materializa worktree y opera dentro. | ✓ |
| Cambiar cwd = worktree_path | kodo crea worktree ANTES de spawn (`git worktree add`) y cmux abre allí. Rompe delegación a Claude Code. | |
| cwd = projectPath + verificar post-spawn | Como Recommended + log-warn si `git rev-parse --show-toplevel` difiere. | |

**User's choice:** cwd = projectPath
**Notes:** Captura D-04. Antes de responder, el usuario preguntó sobre `--agents` (teams) y la opción cmux de "nueva ventana". Aclarado: ambos son ortogonales al cwd — agents corren dentro de la sesión claude (cwd=worktree internamente); spawn-window de cmux es otra config aparte (D-04b).

---

## Manejo de colisión de path

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-fast con error explícito | Si el directorio existe, abortar spawn con canonical error `worktree-collision`. Phase 19 hará cleanup propio. | ✓ |
| Auto-prune si --force / no hay sesión viva | Si no hay SessionRecord vivo, `git worktree remove --force` antes de re-crear. Riesgo data loss. | |
| Generar nuevo session-id | Rotar UUID y reintentar. Rompe deterministicidad WT-02. | |
| stale_relaunch path: reuse worktree existente | Solo en `action === 'stale_relaunch'` reusar. Para el resto fail-fast. | |

**User's choice:** Fail-fast con error explícito
**Notes:** Captura D-05. Detalles del exit code y mensaje canonical los decide el planner siguiendo Phase 8 / LOG-09 patrón (D-05b).

---

## Scope de "todas las sesiones"

| Option | Description | Selected |
|--------|-------------|----------|
| Excluir orchestrator | WT-01 aplica solo a `launchWorkItem`. Orchestrator necesita cwd=repo para auto-cargar skill (Phase 999.1 D-05). | ✓ |
| Incluir orchestrator | También con `--worktree`. Rompería D-05: skill no auto-cargaría desde worktree. | |
| Worktree solo para sesiones GSD | Excluir orchestrator y no-GSD. Contradice WT-01 literal. | |

**User's choice:** Excluir orchestrator
**Notes:** Captura D-06. La exclusión queda como assert/comentario en `launchOrchestrator`. Sesiones no-GSD SÍ entran (D-06b) — driver de la incidencia 28/04 ROMAN-113…118.

---

## Cierre

| Option | Description | Selected |
|--------|-------------|----------|
| Cerrar y escribir CONTEXT.md | 6 decisiones cubren las 3 SCs. Detalles cosméticos/de tests caen al planner. | ✓ |
| Una preocupación más sobre hooks | Comportamiento de `session-start.js` dentro del worktree. | |
| Una preocupación más sobre tests | Cómo cubrir las 3 SCs sin spawner real. | |
| Una preocupación más sobre migration | Confirmar campo opcional aditivo (precedent Phase 11 D-08). | |

**User's choice:** Cerrar
**Notes:** Migration ya capturada en D-03c sin pregunta explícita; tests delegados al planner; hooks ven cwd=worktree automáticamente (Phase 18 no toca session-start).

---

## Claude's Discretion

- Exit code y string canonical del error `worktree_collision` (sigue patrón Phase 8 `gsd_locked` / LOG-09 Phase 16).
- Orden de aserciones en tests del manager (state.json mutation → claude cmd construction → lock path).
- Factorización del helper `computeWorktreePath` (inline en manager.js vs export en state.js) — preferible exportar si Phase 19 lo consume.
- Cómo mostrar `worktree_path` en `kodo logs --session-of` (campo opcional en línea formateada vs solo en `--json`).

## Deferred Ideas

- Verificación post-spawn `git rev-parse --show-toplevel === worktree_path` en `session-start` hook (defensa adicional para SC#1).
- Branch naming forzado por kodo (entra en v0.7+ si PR auto-creation lo necesita).
- Helper `computeWorktreePath(projectPath, sessionId)` extraído a módulo compartido (decidir en planning).
- Exposición de `worktree_path` en output legible de `kodo logs --session-of`.
- Migración retroactiva de sesiones legacy v0.5 (descartada: campo aditivo opcional).
- Cleanup retroactivo de worktrees zombie en `.bg-shell/` (cae en Phase 19 stop hook + `git worktree prune`).
