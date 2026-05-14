# Phase 26: Config Wizard + CLI Integration - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning
**Mode:** --auto (single-pass autonomous capture; all gray areas auto-resolved)

<domain>
## Phase Boundary

El operador puede configurar `provider: github` desde `kodo config` (wizard interactivo que pide `GITHUB_TOKEN`, repos con auto-detect del git remote, y confirma cada paso), arrancar polling como daemon (`kodo polling start/stop/status`) o integrado en el orchestrator (`kodo orchestrator --polling`), y las configs v0.6 siguen leyéndose sin error.

**Requirements bound to this phase:** CFG-01, CFG-02, CFG-03, CFG-04 (4/4 — sin TEST-* en esta fase; Phase 27 cubre cross-provider matrix).

**Explicitly NOT in scope (deferred to Phase 27 or v0.8):**
- TEST-03 contract matrix (Phase 27).
- Web UI / dashboard para polling status.
- Multi-token rotation o per-repo token override (un token global por instalación).

</domain>

<decisions>
## Implementation Decisions

### Wizard — `kodo config` con provider: github
- **D-01:** Extender el `availableProviders` array en `interactiveConfig` (`src/cli.js:355`) de `['plane']` a `['plane', 'github']`. Reusar la estructura paso-a-paso existente (lista numerada → Enter selecciona default `1`).
- **D-02:** Para `provider: github`, pedir `GITHUB_TOKEN` como variable de entorno (`api_key_env`, default `GITHUB_TOKEN`) — espejo exacto del flow Plane. NO escribir el token a `config.json`; escribirlo (o sugerir export) a `~/.kodo/.env` siguiendo el precedente Phase 23 (`getProviderApiKey('github')` ya lee de `~/.kodo/.env`).
- **D-03:** Auto-detect de repos vía `git remote get-url origin` en el `cwd` actual. Regex de parseo permisivo: `github\.com[:/]([^/]+)/([^/.]+?)(?:\.git)?(?:/|$)` — captura `owner` y `repo`. Si parsea con éxito, mostrar `Detectado: <owner>/<repo> — ¿añadir? [S/n]`. Si el usuario confirma (Enter o `s`), añadir al array `repos`.
- **D-04:** Tras auto-detect (o si no parsea), permitir añadir repos manualmente uno-a-uno con prompt `Repo (owner/repo, Enter para terminar): `. Validación: si el input no tiene exactamente un `/`, advertir y reintentar.
- **D-05:** Mostrar resumen final antes de `saveConfig`: lista de repos a guardar + `poll_interval` + confirmación `Guardar? [S/n]`. Permite abortar sin escribir si el usuario detecta error.

### Schema extension — `~/.kodo/config.json`
- **D-06:** El default schema `providers.github` se compone:
  ```json
  {
    "providers": {
      "github": {
        "api_key_env": "GITHUB_TOKEN",
        "repos": [],
        "poll_interval": 60,
        "mcp_hint": "GitHub MCP server",
        "states": { "review": "closed" }
      }
    }
  }
  ```
  `repos` array de `{owner, repo}` objects (NO strings tipo `"owner/repo"` — alineado con el shape consumido por `startPolling` Phase 25 `repos: [{owner, repo}]`).
- **D-07:** **Backward compatibility (CFG-02 invariante):** `loadConfig` ya migra v1→v2 (Plane). Phase 26 NO añade nueva migración. Si `providers.github` está ausente, NO se inyecta; solo se inyecta cuando el wizard lo guarda. Configs v0.6 (con `provider: plane` y `providers.plane`) cargan idéntico — verificable con fixture test (`test/config-migration.test.js` o equivalente).
- **D-08:** `DEFAULT_CONFIG` en `src/config.js` NO se modifica para añadir `providers.github` (eso forzaría a v0.6 configs a tener la clave aunque no la usen). El default `providers.github` se aplica solo en runtime dentro de `interactiveConfig` cuando el usuario elige `github`.

### Daemon CLI — `kodo polling start/stop/status`
- **D-09:** Comando padre `kodo polling` con subcomandos `start`, `stop`, `status` (mirror la convención `kodo gsd <subcmd>` y `kodo skill <subcmd>` ya en `src/cli.js:241,277`). NO añadir flags directos a `kodo` raíz para polling.
- **D-10:** `kodo polling start` (default daemon mode) — `fork` un proceso hijo desorbitado (`spawn` con `detached: true`, `stdio: 'ignore'`, `unref()`); el hijo escribe su PID a `~/.kodo/polling.pid` (atómico tmp+rename, mismo patrón que Phase 25 state cache); el padre exit `0` tras confirmar PID file escrito (timeout 2s).
- **D-11:** `kodo polling start --no-daemon` — foreground; el proceso actual llama directamente a `startPolling({...})` sin fork; SIGINT/SIGTERM cancelan vía `stop()`; logs van a stdout (NDJSON sigue al sink configurado).
- **D-12:** `kodo polling stop` — lee `~/.kodo/polling.pid`, envía `SIGTERM` al PID; espera hasta 5s por exit; si sigue vivo, `SIGKILL`; borra el PID file. Si PID file no existe → exit `3` con mensaje "no polling daemon running".
- **D-13:** `kodo polling status` — lee `~/.kodo/polling.pid`, verifica que el proceso existe (`process.kill(pid, 0)` en try/catch); si vivo → `running (pid: N, started: ISO)`; si no → `idle`. Exit `0` siempre (status query no falla).
- **D-14:** Exit codes deterministas (mirror CFG-03):
  - `0` ok (start exitoso / stop exitoso / status query)
  - `1` ya corriendo (start con PID file vivo)
  - `2` no config (start sin `providers.github.repos` o sin `GITHUB_TOKEN`)
  - `3` stop sin daemon vivo (PID file ausente o proceso muerto)
- **D-15:** PID file shape: `{ pid: <number>, started_at: <iso>, repos: ["owner/repo", ...] }` JSON (NO solo el PID number — facilita `kodo polling status` informativo). Atomic tmp+rename.

### Orchestrator wiring — `kodo orchestrator --polling`
- **D-16:** `kodo orchestrate` (existente en `src/cli.js:126`) acepta nuevo flag `--polling`. Cuando está presente, el orchestrator carga config, valida `providers.github.repos` no vacío y `GITHUB_TOKEN` set, y arranca `startPolling({...})` integrado en el mismo proceso (no spawn). El polling vive como tarea async paralela al webhook server / dispatcher.
- **D-17:** **Mutex implícito (Open Question CFG-04 — RESOLVED):** El contrato es "elige uno u otro por repo" — `kodo polling start` daemon path y `kodo orchestrator --polling` integrated path son ortogonales. La idempotencia ya está garantizada por el lock per-repo Phase 8 GSD-10 (si ambos disparan dispatch para el mismo issue, el lock coalesce). NO añadir mutex explícito (chequeo de `polling.pid` activo) — documentar en `--help` text del flag: `--polling: arranca polling integrado. NO usar simultáneo con 'kodo polling start' sobre el mismo repo.`. Razón: simplicity-first (CLAUDE.md Rule 2) + el lock per-repo ya provee la propiedad de seguridad esencial.
- **D-18:** Cancelación limpia — `kodo orchestrate --polling` debe capturar SIGINT/SIGTERM y llamar a `stop()` de `startPolling` antes de exit (evita timer huérfano). Mirror patrón `--no-daemon`.
- **D-19:** Sin `--polling`, `kodo orchestrate` se comporta idéntico a hoy (zero breaking change; el flag es estrictamente aditivo).

### Color & format — output consistency
- **D-20:** Todos los outputs del wizard + `kodo polling status` van vía `createFormatter(stream)` de `src/cli/format.js` (invariante v0.5 — `picocolors` solo desde `format.js`). NO importar `picocolors` directo en CLI handlers nuevos.
- **D-21:** `kodo polling status` soporta `--json` flag — output JSON byte-determinista TTY/no-TTY (invariante DX-06 v0.5). Sin `--json`, output legible con colores TTY-aware.

### Testing strategy
- **D-22:** Tests offline solamente — zero live API calls. Para el wizard: stub `readline` con scripted answers; para daemon: spawn niño en test fixture y verificar PID file + exit codes. No usar `child_process` real para tests; mock `spawn`/`detached: true`.
- **D-23:** Fixture de config v0.6 (`test/fixtures/configs/v0.6-no-github.json`) verifica que `loadConfig` lee sin error (CFG-02 invariante zero breaking change).
- **D-24:** Test de `kodo orchestrate --polling` SIGINT cleanup — spawn con `--no-daemon`-equivalent path, send SIGINT, assert no timers pendientes (heurística: `process._getActiveHandles().length === pre-spawn baseline` o sentinel temporal del clock-mock pattern Phase 25).

### Claude's Discretion
- Estructura interna del git-remote parser (regex inline vs función dedicada) — el planner decide; CFG-01 SC#1 solo exige que funcione contra `git@github.com:owner/repo.git`, `https://github.com/owner/repo`, y `https://github.com/owner/repo.git`.
- Si el wizard ofrece reordenar/eliminar repos existentes (UX nicety) — opcional; mínimo viable es "add only".
- Si `kodo polling status` muestra additional info (`last_tick: <iso>`, `dispatches_this_session: N`) — opcional; mínimo viable es `running|idle` + PID.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & requirements
- `.planning/ROADMAP.md` §"Phase 26: Config Wizard + CLI Integration" — 4 success criteria verbatim (CFG-01..04)
- `.planning/REQUIREMENTS.md` §"Config wizard + CLI integration (CFG-*)" — 4 requirement IDs con scope detallado
- `.planning/STATE.md` §"Critical Invariants to Preserve" — `cwd=repo` Phase 999.1, color isolation v0.5, `--json` byte-determinismo DX-06, lock per-repo Phase 8 GSD-10, worktree always-on Phase 18, HOOK-01 universal Phase 20

### Wave precedents (Phase 23-25)
- `.planning/phases/25-polling-trigger-channel/25-SUMMARY.md` — `startPolling({client?, provider?, repos, intervalSec, clock?, logger?, statePath?, dispatchTriggerFn?})` signature canonical
- `.planning/phases/25-polling-trigger-channel/25-RESEARCH.md` §"Validation Architecture" — clock-mock + fake fs patterns reusables para Phase 26 tests
- `.planning/phases/23-githubclient-auth-foundation/23-SUMMARY.md` — `getProviderApiKey('github')` lee de `~/.kodo/.env` (NO config.json)
- `.planning/phases/24-githubprovider-normalizer-registry/24-SUMMARY.md` — `getProvider('github')` factory disponible para Phase 26 validation

### Code source-of-truth
- `src/cli.js:19-63` — `kodo config` command + `interactiveConfig` entry point (extender, no reescribir)
- `src/cli.js:126-143` — `kodo orchestrate` command (añadir `--polling` flag aquí)
- `src/cli.js:241-277` — patrón subcomando `kodo gsd <subcmd>` / `kodo skill <subcmd>` (mirror para `kodo polling <subcmd>`)
- `src/cli.js:344-525` — `interactiveConfig` implementation pattern (lista numerada de providers, ask helper, validation loop)
- `src/config.js:60-115` — `DEFAULT_CONFIG`, `migrateConfig`, `migrateConfigIfNeeded` — schema patterns
- `src/config.js:172-176` — `getProviderApiKey` (provider-agnostic; cubre `github` automáticamente)
- `src/triggers/polling.js` — Phase 25; `startPolling({...}) → {stop}` API a invocar desde wizard test + daemon + orchestrator
- `src/cli/format.js` — `createFormatter(stream)` para output TTY-aware (D-20)
- `bin/kodo` — entry point (NO modificar; thin shim a `src/cli.js`)
- `src/server.js` — webhook server (referencia para el SIGINT/SIGTERM cleanup pattern)

### Anti-pattern guards (must not regress)
- `test/check-isolation.test.js` — LOG-12 walker; Phase 26 NO añade nueva fila aquí (el polling.js row de Phase 25 ya cubre el invariante transitivo; CLI handlers nuevos van bajo `src/cli.js` que ya está fuera del check graph)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`interactiveConfig` (`src/cli.js:344-525`)**: Wizard scaffolding ya implementado para Plane — readline + ask helper + numbered list + validation retry loop. Extender (no reescribir) añadiendo branch `selectedProvider === 'github'`.
- **`createFormatter` (`src/cli/format.js`)**: TTY-aware coloring + `--json` flag handling. Reusar para todo output nuevo.
- **`getProviderApiKey` (`src/config.js:172`)**: provider-agnostic — ya cubre `github` (lee `process.env[providers.github.api_key_env]`).
- **`spawn` + `detached` precedent**: el repo aún no tiene daemon — Phase 26 será el primero. Patrón estándar Node.js (`spawn(node, [bin/kodo, 'polling', 'start', '--no-daemon'], { detached: true, stdio: 'ignore' }); child.unref()`); el planner debe explicitar.
- **`startPolling` (`src/triggers/polling.js`)**: ya soporta `{stop}` para cancelación clean (D-18).

### Established Patterns
- **CLI subcommands**: `kodo gsd <sub>`, `kodo skill <sub>` — sintaxis canonical para `kodo polling <sub>` (NO `kodo polling-start`).
- **Config migration**: aditiva, con backup (`config.json.bak`). Phase 26 NO migra; solo añade clave cuando el wizard la escribe.
- **PID file shape**: ninguno aún en el repo; Phase 26 establece el patrón (JSON con `{pid, started_at, ...}`, atomic tmp+rename — mirror Phase 25 state cache).
- **Color isolation**: `picocolors` solo en `src/cli/format.js` (invariante v0.5).
- **Exit codes**: Plane CLI ya usa convención `0=ok, 1=error transient, 2=error config, 3=specific failure mode` (revisar `kodo check` para ejemplos previos).

### Integration Points
- `src/cli.js` — Comando `polling` parent + 3 subcomandos + flag `--polling` en `orchestrate`.
- `src/config.js` — sin cambios al `DEFAULT_CONFIG`; añadir helper opcional `getDefaultGithubProviderConfig()` para que el wizard inserte el shape D-06.
- `src/cli/format.js` — sin cambios; consumir.
- `~/.kodo/polling.pid` — nuevo artifact runtime (NO en repo).
- `~/.kodo/.env` — Phase 23 ya lo lee; el wizard puede sugerir `export GITHUB_TOKEN=...` si no está set, sin escribirlo automático (security: no escribir secrets a disco).

</code_context>

<specifics>
## Specific Ideas

- Wizard greeting line debe distinguirse del `kodo config` Plane existente: `kodo config — provider: github (v0.7)` para feedback visual claro de qué provider está siendo configurado.
- `kodo polling status` `--json` shape canonical: `{"status": "running"|"idle", "pid": N|null, "started_at": "<iso>"|null, "repos": [{"owner":..., "repo":...}]|null}` — null fields cuando idle.
- El flag `--polling` en `kodo orchestrate` debe aparecer en `--help` con texto que cita el contrato mutex implícito (D-17): `--polling      Arranca polling integrado en el orchestrator. Mutex implícito vía lock per-repo (no usar con 'kodo polling start' simultáneo sobre el mismo repo).`

</specifics>

<deferred>
## Deferred Ideas

- **Multi-token rotation** — soporte para múltiples `GITHUB_TOKEN`s para sortear rate-limits — defer a v0.8+ (CFG actual asume un solo token; el polling de Phase 25 ya emite warn en `X-RateLimit-Remaining < 100`).
- **Web UI / dashboard polling status** — fuera de scope CFG-03 (CLI-only); defer indefinido.
- **Mutex explícito daemon ↔ orchestrator** — defer si el lock per-repo Phase 8 muestra colisión real en uso (no anticipar).
- **`kodo polling restart`** subcomando — UX nicety; defer hasta feedback de uso.
- **`kodo polling tail`** (stream logs en vivo) — duplicado funcional con `kodo logs --follow`; defer.
- **Auto-detect múltiples remotes** (origin + upstream + fork) — defer; `origin` es el ≥90% caso.

</deferred>

---

*Phase: 26-config-wizard-cli-integration*
*Context gathered: 2026-05-14 via /gsd-discuss-phase 26 --auto*

## Auto-mode decisions log

`--auto` mode auto-resolved 5 gray areas without user prompts. Recommended option chosen in each case. Open questions from STATE.md resolved inline:

| Gray area | Decision | Rationale |
|---|---|---|
| Wizard UX flow | Extender `interactiveConfig` (D-01..05) | Reuse precedent Plane; minimize new code (Karpathy Rule 2 simplicity-first) |
| Schema extension shape | `providers.github = {api_key_env, repos[], poll_interval, mcp_hint, states}` (D-06..08) | Mirror Plane schema; NO migration (zero breaking change CFG-02 invariante) |
| Daemon implementation | `spawn detached + unref + PID file JSON atomic` (D-10..15) | Establece el primer daemon pattern del repo; reuse Phase 25 atomic write |
| Mutex daemon ↔ orchestrator (CFG-04 Open Q) | **Implícito vía lock per-repo Phase 8** (D-17) | Simplicity-first; lock ya provee la propiedad esencial; documentar en `--help` |
| Output formatting | `createFormatter(stream)` + `--json` byte-determinista (D-20..21) | Invariantes v0.5 (color isolation + DX-06) |
