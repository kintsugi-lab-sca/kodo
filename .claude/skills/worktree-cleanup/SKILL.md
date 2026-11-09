---
name: worktree-cleanup
description: Audita y limpia worktrees acumulados en este repo (por defecto los del patrón `agent-*` bajo `.claude/worktrees/`, creados por el tool Agent de Claude Code con `isolation: "worktree"`). Verifica que cada rama esté mergeada en la rama principal, respeta worktrees `locked`, rechaza los que tengan cambios sin commit, y elimina los seguros junto con su rama local. Para los worktrees de sesión de kodo (`.claude/worktrees/<session-id>`) usa el script `sessions.py` de esta skill, que exige además tarea Done en Plane y ninguna sesión viva. Úsalo cuando el usuario pida limpiar worktrees, cuando se acumulen tras varias sesiones de agentes, o cuando aparezcan worktrees huérfanos en `git worktree list`.
---

# Worktree Cleanup

Audita los worktrees de este repo y elimina solo los que sean **demostrablemente seguros**. Por defecto opera sobre el patrón `agent-*` bajo `.claude/worktrees/`, pero acepta cualquier prefijo si el usuario lo pide explícitamente.

## Principios

1. **Dry-run primero, mutación después.** Nunca borres en la primera iteración. Reporta y pide confirmación.
2. **Seguridad antes que limpieza.** Ante la duda → **STOP** y reporta al usuario.
3. **Una sola fuente de verdad:** `git worktree list --porcelain`. No parsees el formato humano.
4. **Limpieza completa:** worktree + rama local + `git worktree prune`. Borrar solo el directorio deja basura en `.git/worktrees/`.

## Contexto kodo (importante)

Este repo (`kodo`) tiene dos lugares distintos donde aparecen worktrees:

| Ubicación | Quién los crea | Patrón típico | ¿Tocar? |
|---|---|---|---|
| `<repo>/.bg-shell/<sessionId>` | `kodo` mismo (ver `computeWorktreePath` en `src/session/state.js:69`) | UUID | **NO**, los gestiona el propio kodo. Saltar siempre. |
| `<repo>/.claude/worktrees/agent-*` | Tool `Agent` de Claude Code con `isolation: "worktree"` | `agent-<hash>` | **SÍ**, son la diana habitual del skill. |
| `<repo>/.claude/worktrees/<session-id>` | Sesiones de kodo (`cleanupWorktree` renombra las sucias a `<session-id>.dirty`) | UUID | **SÍ, pero solo con `sessions.py`** (ver abajo). |
| `<repo>/.claude/worktrees/<otro>` | Orca, GSD, compound-engineering, etc. | varía (p. ej. `zesty-tickling-pine`) | Solo si el usuario lo pide explícitamente. |
| `/Users/alex/orca/workspaces/<repo>/...` | Orca | varía | NUNCA desde este skill. Pertenece a Orca. |

Cuando el usuario diga "limpia los worktrees" sin más, asume **solo** `.claude/worktrees/agent-*`.

## Worktrees de sesión de kodo: `sessions.py`

Para `.claude/worktrees/<session-id>` no sigas el procedimiento manual de abajo: ejecuta el
script, que recorre todos los repos de `~/.kodo/projects.json` (o los `--repo` que le pases):

```bash
python3 -I .claude/skills/worktree-cleanup/sessions.py            # simulación, no borra
python3 -I .claude/skills/worktree-cleanup/sessions.py --apply    # borra los BORRABLE
```

Borra worktree + rama local solo si se cumplen las cuatro condiciones:

1. **Tarea** Done o Cancelled en Plane. La tarea sale del nombre del directorio
   (= session_id) buscado en `sessions`/`history` de `~/.kodo/state.json` y, si ya no está,
   en el `session.start` de `~/.kodo/logs/<session_id>.ndjson`.
2. **Sin commits propios**: `git rev-list --count <remoto>/<main>..HEAD` es 0 tras
   `git fetch` de cada remoto; basta con que esté contenida en la main de **uno** de ellos.
   Una rama integrada por squash cuenta como con commits propios y se conserva.
3. **Árbol limpio**: nada modificado ni sin seguimiento; los ignorados cuentan salvo
   los regenerables (`node_modules`, `tmp`, `log`, `.venv`, `.ruby-lsp`…, lista en el script).
4. **Sin sesión viva**: ni fila en `sessions`, ni `locked`, ni proceso con el cwd dentro (`lsof`).

Si algo no se puede comprobar (tarea sin identificar, Plane caído, remoto inaccesible),
se conserva. La salida da, por worktree: directorio, rama, tarea, veredicto y las
condiciones que fallan. Test: `test/skill-worktree-cleanup-sessions.test.js`.

## Procedimiento

### 1. Detectar el repo principal y la rama principal

```bash
git rev-parse --show-toplevel
git symbolic-ref refs/remotes/origin/HEAD --short 2>/dev/null | sed 's@^origin/@@' || echo main
```

- Si no estás dentro de un repo, **aborta** y dile al usuario.
- La rama principal puede ser `main` o `master`. No la asumas: derívala del comando anterior. Si falla todo, pregunta.

### 2. Listar worktrees con porcelain

```bash
git worktree list --porcelain
```

Cada bloque (separado por línea en blanco) tiene `worktree`, `HEAD`, `branch`, y opcionalmente `locked` o `prunable`. Parsea estos campos — **nunca** la salida humana.

### 3. Filtrar candidatos

Aplica este orden de descartes:

| Descarte | Motivo |
|---|---|
| El worktree principal (mismo path que `show-toplevel`). | No es eliminable. |
| `locked` presente. | Sesión activa o lock intencional. **Reporta el PID/razón** del lock y salta. |
| Path bajo `.bg-shell/`. | Gestionado por kodo. |
| Path fuera del repo (p. ej. `/Users/alex/orca/...`). | No es alcance del skill. |
| El nombre del directorio no matchea `agent-*` (asumiendo invocación por defecto). | Fuera del patrón pedido. |

Lo que sobreviva es candidato.

### 4. Para cada candidato: clasificación

Ejecuta dos comprobaciones independientes:

**4a. Estado del árbol** (uncommitted / untracked):

```bash
git -C <worktreePath> status --porcelain
```

- Vacío → limpio.
- No vacío → **dirty**. **STOP** para este worktree. Reporta los archivos al usuario.

**4b. ¿La rama está mergeada en la principal?**

Combina dos señales (ninguna por sí sola es suficiente):

```bash
# Señal A — merges normales (con merge commit)
git branch --merged <mainBranch> --list <branchName>

# Señal B — patch-equivalence (rebase / squash-merge / cherry-pick)
git cherry <mainBranch> <branchName>
```

Lógica:

- **Mergeada** si A devuelve la rama, **o** si B no tiene ninguna línea que empiece por `+` (las `+` son commits no presentes en main).
- **No mergeada** en cualquier otro caso.

> Caveat: si la rama upstream nunca se publicó y main ya tiene los cambios por squash-merge, `git branch --merged` no lo detectará; `git cherry` sí. Por eso usamos las dos señales.

### 5. Construir el reporte (dry-run)

Antes de tocar nada, presenta al usuario una tabla con tres categorías:

| Estado | Acción propuesta |
|---|---|
| `SAFE` — limpio y mergeada | Eliminar worktree + rama local. |
| `LOCKED` — sesión activa | Saltar. Informa el lock. |
| `DIRTY` — cambios sin commit | **STOP**. Listar archivos. Sugerir `git -C <path> stash` o commit manual. |
| `UNMERGED` — limpio pero rama no integrada | **STOP**. Mostrar commits ahead (`git log <main>..<branch> --oneline`). |

Cuenta cuántos hay en cada categoría. Pide confirmación explícita antes de pasar al paso 6.

### 6. Ejecución (solo `SAFE`, solo tras confirmación)

Para cada worktree `SAFE`:

```bash
git worktree remove <worktreePath>
git branch -d <branchName>
```

Notas:

- Usa `-d` (lowercase), **no** `-D`. Si `-d` falla, la rama no estaba realmente mergeada → re-clasifica como `UNMERGED` y reporta. No fuerces.
- Si `git worktree remove` falla por dirty (carrera con paso 4a), **no** uses `--force`. Repórtalo.

Al terminar:

```bash
git worktree prune -v
```

Esto limpia metadata huérfana en `.git/worktrees/` (worktrees que se borraron a mano sin `git worktree remove`).

### 7. Reporte final

Resume:

- Cuántos worktrees había, cuántos se eliminaron, cuántos se saltaron y por qué.
- Si quedaron categorías `DIRTY` o `UNMERGED`, lista los paths con su comando de inspección sugerido para que el usuario decida.

## Cuándo NO usar este skill

- Si el usuario pide tocar `.bg-shell/` → redirige a `kodo` (el propio kodo gestiona esos worktrees vía su lifecycle de sesión).
- Si el usuario pide forzar la eliminación con `--force` → rechaza por defecto. Pídele que confirme y que confirme también qué hará con el trabajo no integrado.
- Si no estás dentro de un repo git → aborta.

## Ejemplos de invocación

- "limpia los worktrees" → patrón por defecto `agent-*` bajo `.claude/worktrees/`.
- "limpia también los `gsd-*`" → expande el filtro del paso 3 a `agent-*` **y** `gsd-*`.
- "haz dry-run de la limpieza" → ejecuta hasta el paso 5 y para.
