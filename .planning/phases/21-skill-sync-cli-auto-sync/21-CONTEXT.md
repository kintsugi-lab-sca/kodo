# Phase 21: Skill Sync CLI + Auto-Sync - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning
**Source:** /gsd-discuss-phase 21 --auto (auto-mode single pass)

<domain>
## Phase Boundary

Materializar el contrato de sincronización entre la skill canonical `kodo-orchestrate` del repo (`<repo>/.claude/skills/kodo-orchestrate/`) y su copia en home (`~/.claude/skills/kodo-orchestrate/`), con dos superficies:

- **SKILL-01** — CLI manual `kodo skill sync`: detecta drift (hash SHA-256 por archivo), copia archivos cambiados de repo → home, NO borra foráneos salvo `--prune` explícito, exit codes deterministas (0 ok/no-op, 1 fs error, 2 fuera de repo), stderr canonical messages.
- **SKILL-02** — auto-sync en `launchOrchestrator`: antes de `cmux.newWorkspace`, detecta drift y sincroniza automáticamente. Fail-open con warn (no rompe el launch). Emite `skill.sync.auto` (ok) o `skill.sync.auto.error` (fallo) en el log NDJSON.
- **SKILL-03** — Constraint cwd=repo preservada (Phase 999.1 D-04/D-05/D-06): la skill local del repo sigue ganando por orden de carga de Claude Code; el sync solo asegura que home no quede stale para invocaciones cross-cwd futuras.
- **SKILL-04** — Tests deterministas: 4 escenarios de exit code para `kodo skill sync` (ok / no-op / fs error / fuera de repo) + tests de auto-sync (drift detected → sync + event; no drift → no-op silent; sync fail → warn + event).

Driver actual confirmado: `~/.claude/skills/kodo-orchestrate` es un **symlink obsoleto** apuntando a `<repo>/skills/kodo-orchestrate` (path pre-Phase 999.1 que NO existe). Phase 21 lo resuelve: el sync detecta el symlink, lo reemplaza con un directorio real, y copia la skill canonical desde `<repo>/.claude/skills/kodo-orchestrate/`.

Cubierto por esta phase:
- Comando `kodo skill sync` (manual) con flags `--prune` (opt-in destructivo) y output `--json` (byte-deterministic).
- Hook en `launchOrchestrator` ANTES de `cmux.newWorkspace` que llama al mismo módulo de sync.
- Detección de symlink legacy (Phase 999.1 dejó residuo) y reemplazo por directorio real.
- Eventos NDJSON dedicados `skill.sync.auto` / `skill.sync.auto.error` (Phase 19 patrón).
- Source-hygiene: un único módulo de sync (`src/skill/sync.js`) consumido por CLI y por orchestrator launch.

Fuera de scope (Phase 21):
- Sync inverso `~/.claude/skills/` → `<repo>/.claude/skills/` — descartado por REQUIREMENTS.md "Out of Scope" (el repo es la source canonical).
- Sync de otras skills genéricas que pueda tener `~/.claude/skills/` — Phase 21 solo gestiona `kodo-orchestrate` (skill canonical del proyecto).
- `kodo skill diff` o `kodo skill list` — no requeridos por SKILL-01..04; defer si surge necesidad.
- Watch mode (`kodo skill sync --watch`) — fuera del scope, manual + auto-on-launch cubre el flujo.
- Migración del symlink residual en pre-execute (script de bootstrap) — el primer `kodo orchestrator` o `kodo skill sync` lo resuelve automáticamente.

Fuera de scope (otras phases v0.6):
- Tech debt v0.5 closure (Phase 22).
- HOOK-01 anti-push reminder (Phase 20 — completada).

</domain>

<decisions>
## Implementation Decisions

### Scope del sync (qué se sincroniza)

- **D-01:** Solo `<repo>/.claude/skills/kodo-orchestrate/` → `~/.claude/skills/kodo-orchestrate/`. NO se sincroniza todo el árbol `<repo>/.claude/skills/`. Razón: la skill canonical de kodo es específicamente `kodo-orchestrate`; otras skills en `.claude/skills/` (presentes o futuras) son de Claude Code u otros plugins y NO son responsabilidad de kodo. Implicación: `src/skill/sync.js` opera sobre un par de paths fijo (no acepta arg para skill arbitraria en Phase 21).

### Diff signal

- **D-02:** Hash SHA-256 por archivo. Para cada archivo en `<repo>/.claude/skills/kodo-orchestrate/` calcula `crypto.createHash('sha256')` sobre el contenido y compara con el archivo equivalente en home. Si hash difiere O archivo no existe en home → marcar para copia. Razón: mtime es engañoso bajo `touch`, checkout de git, sync de Dropbox/iCloud, etc. Hash detecta drift real de contenido. Coste: ~1ms por archivo en SSD, despreciable para una skill de ~5-10 archivos. Usar `node:crypto` built-in (sin nueva dep).

### Auto-sync fail mode (en launchOrchestrator)

- **D-03:** Fail-open con warn + evento `skill.sync.auto.error` en NDJSON. Si el sync falla (FS error, permisos, etc.), el orchestrator continúa su launch normal — la skill local del repo gana por construcción (D-04 Phase 999.1), así que el orchestrator funciona aunque home quede stale. Razón: bloquear el launch del orchestrator por un sync fallido es peor que dejar home stale (el operador puede ejecutar `kodo skill sync` manualmente luego). Patrón ya establecido en stop hook Phase 19 (cleanup fail-open D-03).
- **D-03b:** Evento payload mínimo `{ event, source, dest, files_changed?, error? }`. Variantes:
  - `skill.sync.auto` (ok): `{ source: '<repo>/.claude/skills/kodo-orchestrate/', dest: '~/.claude/skills/kodo-orchestrate/', files_changed: number }`.
  - `skill.sync.auto.error` (fail-open): `{ source, dest, error: string }`.
  - `skill.sync.auto.noop` (drift no detectado) — omitido intencionalmente para evitar ruido (Phase 19 patrón D-10 con `worktree.cleanup.dirty` skipped legacy).

### Manejo del symlink legacy (~/.claude/skills/kodo-orchestrate como symlink obsoleto)

- **D-04:** Sync DETECTA y REEMPLAZA. Si `lstat(dest)` devuelve `isSymbolicLink: true`:
  1. Log: `[kodo skill sync] symlink legacy detectado en ${dest}, reemplazando con directorio real`.
  2. `fs.rmSync(dest)` (borra el symlink, NO el target — `rmSync` con un symlink path borra solo el link).
  3. `fs.mkdirSync(dest, { recursive: true })` y copiar archivos canónicos desde source.
  4. Emitir evento normal `skill.sync.auto` con `files_changed: N` (todos los archivos canónicos cuentan como "cambiados" tras el reemplazo).
- **D-04b:** El reemplazo es idempotente: si el symlink ya fue reemplazado en una corrida previa, `lstat(dest)` devuelve directorio normal y el flujo de diff por hash se aplica como cualquier otra ejecución.
- **D-04c:** NO se intenta resolver el symlink antes de borrarlo (`readlink` solo informativo en el log si se desea). El target del symlink obsoleto puede o no existir; en cualquier caso queremos forzar directorio real con archivos canónicos.

### --prune (opt-in destructivo)

- **D-05:** Sin `--prune`, archivos foráneos en `~/.claude/skills/kodo-orchestrate/` (presentes en home pero no en repo) se PRESERVAN silentemente. Razón: el operador puede haber añadido archivos custom (anotaciones, override locales) y kodo no debe destruirlos por defecto.
- **D-05b:** Con `--prune`, archivos foráneos se BORRAN. Lista de borrados se loguea explícitamente con `console.warn` antes de borrar (`[kodo skill sync --prune] removing foreign: ${path}`). NO hay confirmación interactiva — `--prune` es opt-in informado.
- **D-05c:** Auto-sync en `launchOrchestrator` NUNCA hace prune (D-05 default). El operador solo activa `--prune` manualmente vía `kodo skill sync --prune` cuando quiere reset clean.

### CLI surface (`kodo skill sync`)

- **D-06:** Subcomando bajo el comando `skill` en Commander: `kodo skill sync [--prune] [--json]`. Sigue el patrón Phase 9 `kodo gsd <subcmd>`. El planner decide si `kodo skill` es un grupo con multiples subcmds (`sync`, futuras `diff` / `list`) o un comando único con flags. Preferencia: grupo (extensible) aunque solo se exponga `sync` en Phase 21.
- **D-06b:** Output:
  - TTY no-`--json`: prosa coloreada usando `src/cli/format.js` (factory `createFormatter`, Phase 14 D-07). Líneas estilo: `✓ Synced 3 files to ~/.claude/skills/kodo-orchestrate/` (verde para ok, amarillo para warn de symlink legacy, rojo para error).
  - `--json` o no-TTY: bytes-deterministic JSON `{ status: 'ok'|'noop'|'error', files_changed: N, errors?: [...] }`. Sin ANSI escapes (LOG-12 invariante + DX-06 Phase 14).

### Exit codes deterministas (SKILL-04)

- **D-07:** Cuatro estados canónicos, alineados con patrón Phase 9 `kodo gsd inspect` (D-19) y Phase 10 `kodo gsd verify` (Pitfall #6 Opción A):
  - `0` — Sync ok (archivos copiados) O no-op (no drift detectado). Stderr vacío.
  - `0` — No-op explícito tras hash check: NO se distingue de "sync ok" en exit code (consistente con REQUIREMENTS.md SKILL-04). Stdout indica `status: noop`.
  - `1` — Error de filesystem (permisos, disco lleno, archivo origen ilegible, etc.). Stderr canonical message: `Error: filesystem error: ${detail}`.
  - `2` — Fuera de un repo kodo. `kodo skill sync` ejecutado en un directorio donde `<cwd>/.claude/skills/kodo-orchestrate/skill.md` no existe → exit 2 + stderr canonical: `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)`.
- **D-07b:** Auto-sync en `launchOrchestrator` NO tiene exit code (no es CLI); reusa los códigos vía return value `{ status: 'ok'|'noop'|'error', detail? }` del módulo `src/skill/sync.js`. El orchestrator interpreta el return: `'error'` → warn + event, otros → silencio.

### Source-hygiene: módulo único compartido

- **D-08:** `src/skill/sync.js` exporta una función pura testeable + un wrapper CLI:
  - `syncSkill(opts)` — función pura, opts: `{ source: string, dest: string, prune?: boolean, logger?: Logger }`. Return: `{ status: 'ok'|'noop'|'error', files_changed: number, files_pruned?: number, error?: string }`. No I/O fuera de los paths declarados; NO emite eventos (caller decide).
  - El CLI handler (`src/cli/skill-sync.js` o inline en `src/cli.js`) llama a `syncSkill`, decide exit code, formatea output con `format.js`, y emite stderr canonical messages.
  - `launchOrchestrator` (`src/orchestrator/launch.js`) llama a `syncSkill` con dispositivos pasados via DI y emite los eventos `skill.sync.auto` / `skill.sync.auto.error` en su propio scope.
- **D-08b:** Test source-hygiene: un único `import` de `syncSkill` desde 2 callsites (CLI + orchestrator). Phase 16 `test/dispatcher-isolation.test.js` style (comment-aware grep).

### Eventos NDJSON (logger-events.js)

- **D-09:** Añadir 2 helpers tipados en `src/logger-events.js`:
  - `skillSyncAuto(log, { source, dest, files_changed })` → emite `skill.sync.auto`.
  - `skillSyncAutoError(log, { source, dest, error })` → emite `skill.sync.auto.error`.
  - Patrón establecido en Phase 19 `worktreeCleanupOk/Dirty/Error`. NO se añade `skill.sync.manual` event (el comando CLI ya tiene exit code + stdout — observabilidad redundante).

### Constraint cwd=repo preservada (SKILL-03)

- **D-10:** Phase 21 NO modifica el contrato Phase 999.1 D-04..D-06. Verificación: tests existentes de orchestrator launch (cwd=repo → skill local gana) deben seguir verdes. El nuevo auto-sync NO modifica `cwd` ni añade lógica que dependa de home vs repo — es solo un side-effect previo al launch. Source-hygiene assert opcional: el orchestrator launch NO debe leer `~/.claude/skills/kodo-orchestrate/skill.md` para nada (la skill canonical sigue siendo la del repo via `cwd`).

### Claude's Discretion

- **Bytes exactos del stderr canonical** — el planner los redacta dentro del contrato D-07 (4 estados, mensajes inequívocos).
- **Estructura interna de `syncSkill`** — file walker (recursive readdir vs `fs.cp` con filter) a discreción. Preferencia: walker manual (control fino sobre el diff hash + prune list) — más LOC pero testeable.
- **Ubicación de `src/skill/sync.js` vs `src/skill/index.js`** — el planner decide si introduce un dir `src/skill/` o coloca en `src/skill-sync.js` flat. Preferencia: dir `src/skill/` por extensibilidad (futuros `kodo skill diff` / `list`).
- **Test fixture strategy** — tmpdir + HOME override (Phase 16 CR-02 fix) reusable. Los 4 escenarios SKILL-04 + auto-sync tests pueden compartir setup.
- **Logger DI en `syncSkill`** — `opts.logger?` opcional con default no-op. Tests inyectan memSink.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap, requirements, estado

- `.planning/ROADMAP.md` §"Phase 21: Skill Sync CLI + Auto-Sync" — goal canónico + 4 SCs.
- `.planning/REQUIREMENTS.md` §"Skill sync (SKILL-*)" — SKILL-01, SKILL-02, SKILL-03, SKILL-04.
- `.planning/REQUIREMENTS.md` §"Out of Scope" — sync inverso descartado, `--prune` solo opt-in.
- `.planning/STATE.md` — Open Question §"¿Auto-sync de SKILL-01 en `kodo orchestrator` rompe la Constraint cwd=repo (Phase 999.1 D-04/D-05/D-06)?" → resuelto por D-10 (NO rompe, sync es side-effect previo).
- `.planning/PROJECT.md` §"Current Milestone: v0.6" + §"Constraints" — orchestrator cwd=repo, color isolation, single-source-of-truth patterns.

### Phase 999.1 (precedente directo: skill canonical en repo)

- `.planning/phases/999.1-*/` (si existen) o `MILESTONES.md` v0.5 entry — Phase 999.1 D-04..D-06: skill canonical SOLO en `<repo>/.claude/skills/`, `~/.claude/skills/kodo-orchestrate/` eliminado al cierre. Phase 21 reabre el path en home pero como COPIA sincronizada, NO como source.
- `.claude/skills/kodo-orchestrate/skill.md` — fuente canónica. Phase 21 la consume read-only como source del sync.
- `src/orchestrator/prompt.md` — fallback degradado. Phase 21 NO lo modifica.

### Phase 18+19 (precedente: fail-open + eventos NDJSON)

- `.planning/phases/18-worktree-runtime-wiring/18-CONTEXT.md` — patrón "campo aditivo opcional + fallback" aplicable al estado de drift.
- `.planning/phases/19-worktree-cleanup-integration/19-CONTEXT.md` D-03 (fail-open en cleanup), D-10 (eventos NDJSON dedicados). Phase 21 reusa ambos patrones literalmente.

### Phase 14 (precedente: CLI format + color isolation)

- `src/cli/format.js` — factory `createFormatter(stream)`. Phase 21 lo consume desde el CLI handler de `kodo skill sync` para output coloreado (sin importar `picocolors` directamente — color isolation invariante).
- `test/format-isolation.test.js` — source-hygiene (grep + walker). Si Phase 21 añade un nuevo callsite que necesita color, este test debe pasar sin cambios.

### Phase 6 + 7 (precedente: logger NDJSON)

- `src/logger.js` — `createLogger({ sessionId?, minLevel })`. Phase 21 lo usa en el CLI handler y vía DI en `launchOrchestrator`.
- `src/logger-events.js` — eventos tipados. Phase 21 añade 2 helpers (D-09).
- `src/logger-events.js` patrón `sessionEnd`, `orchestratorReview`, `worktreeCleanupOk/Dirty/Error` — análogos para `skillSyncAuto/Error`.

### Phase 8 (precedente: ensureConfig + subcommands)

- `src/cli.js` — Commander setup. Phase 21 añade subgrupo `kodo skill <sync>`. Patrón Phase 9 `kodo gsd <inspect|verify>` reusable.
- `src/config.js` `loadConfig` — Phase 21 NO requiere config nueva. Sync usa paths fijos derivados de `process.cwd()` + `os.homedir()`.

### Phase 10 (precedente: exit codes deterministas)

- `src/gsd/verify.js` + handler en `src/cli.js` — Pitfall #6 Opción A: exit codes 0/1/2 con stderr canonical messages. Phase 21 D-07 sigue el mismo patrón.
- `test/gsd-verify-integration.test.js` — 4 escenarios spawn real con `bin/kodo`. Phase 21 SKILL-04 reusa el patrón.

### Código a modificar (source-of-truth de comportamiento actual)

- `src/orchestrator/launch.js:37` (`launchOrchestrator`) — sitio principal del auto-sync. Insertar llamada a `syncSkill(...)` ANTES de `cmux.listWorkspaces()` (línea 45) o ANTES de `cmux.newWorkspace()` (línea 70) según D-03 fail-open + D-08 single-source. Wrap try/catch fail-open con emit `skill.sync.auto` / `.error`.
- `src/cli.js` — añadir subgrupo `kodo skill sync` con handler dispatched.
- `src/skill/sync.js` (NUEVO) — módulo único `syncSkill(opts)` con función pura + helpers internos (hash, diff, copy, prune).
- `src/logger-events.js` — añadir `skillSyncAuto` y `skillSyncAutoError` helpers tipados.
- `test/skill-sync.test.js` (NUEVO) — 4 escenarios SKILL-04 spawn real `bin/kodo skill sync` + tests de `syncSkill` con fixtures tmpdir + HOME override.
- `test/orchestrator-auto-sync.test.js` (NUEVO) o extensión de `test/orchestrator-launch.test.js` — auto-sync drift detected, no-drift no-op, fail-open path.

### Código a leer (sin modificar) — referencia de patrones

- `.claude/skills/kodo-orchestrate/skill.md` — source canonical (read-only).
- `src/gsd/inspect.js` + `src/gsd/verify.js` — referencia para shape de CLI subcommands con exit codes + canonical messages.
- `src/hooks/stop.js` Phase 19 cleanup — referencia de pattern fail-open + emit eventos.

### Convenciones del proyecto

- `CLAUDE.md` — reglas Karpathy (simplicity, surgical changes, single-source). Phase 21 las respeta: 1 módulo de sync compartido, 0 nuevas deps, exit codes en el patrón existente.
- `.planning/codebase/ARCHITECTURE.md` §"Hooks Layer" + §"CLI Interface" — Phase 21 toca ambas (hooks indirecto via orchestrator launch + CLI directo).
- `~/.kodo/config.json` — NO se modifica el schema. Sync no requiere config.

### Incidencia driver

- Phase 999.1 D-04..D-06 cerró el path home. Phase 21 lo reabre con contrato sync-de-copia. El driver real actual: `~/.claude/skills/kodo-orchestrate` es symlink obsoleto a path que NO existe (Phase 999.1 dejó residuo). Phase 21 D-04 lo resuelve.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createFormatter(stream)` en `src/cli/format.js` — factory de output coloreado. Phase 21 CLI lo consume para `--json`-vs-TTY shape dual (D-06b).
- `createLogger({ sessionId?, minLevel })` en `src/logger.js` — Phase 21 lo usa en CLI handler + DI en launchOrchestrator.
- `loadConfig()` en `src/config.js` — Phase 21 lo invoca en el handler para confirmar que existe `~/.kodo/config.json` (opcional, no bloqueante para SKILL-01).
- `cmux.listWorkspaces()` / `cmux.newWorkspace()` en `launchOrchestrator` — Phase 21 inserta el sync ANTES de estas llamadas.
- Patrón `existsSync(...)` + `lstatSync(...)` (Phase 19 D-02 lstatSync-safe handling) — Phase 21 D-04 reusa para detectar symlink legacy.
- `gsd-sdk query commit` para los commits del flow GSD — no aplica al runtime de Phase 21, solo a docs/plans.
- `runStopHook(input, deps)` DI pattern (Phase 16 LOG-15) — referencia para `syncSkill(opts)` con `deps?` opcional.

### Established Patterns

- **Single-source-of-truth + DI** — Phase 14 `format.js`, Phase 16 `runStopHook`, Phase 18 `computeWorktreePath`. Phase 21 D-08 sigue el patrón con `syncSkill(opts)`.
- **Fail-open con event NDJSON** — Phase 19 cleanup. Phase 21 D-03 reusa literalmente.
- **Exit codes deterministas + stderr canonical** — Phase 9/10 D-19/Pitfall #6. Phase 21 D-07.
- **Hash SHA-256 sobre contenido** — patrón estándar Node.js (`node:crypto`). No hay precedente en kodo pero es trivial y no añade deps.
- **`tmpdir + HOME override`** (Phase 16 CR-02) — para tests aislados de FS. Phase 21 SKILL-04 + auto-sync tests lo reusan.
- **Source-hygiene grep + walker** (Phase 14/16) — para asegurar `syncSkill` se consume desde exactamente 2 callsites (CLI + orchestrator).

### Integration Points

- `launchOrchestrator` (`src/orchestrator/launch.js:37`) — sitio del auto-sync. Inserción ANTES de `cmux.listWorkspaces()` (línea 45) garantiza que home esté sync ANTES del primer side-effect de cmux.
- `src/cli.js` Commander setup — sitio del subgrupo `kodo skill sync`.
- `src/logger-events.js` — punto único para taxonomía de eventos (LOG-09 + Phase 16 LOG-13/14 patrón).
- `~/.claude/skills/kodo-orchestrate/` — destino del sync. Si existe como symlink (caso actual), D-04 lo reemplaza con dir real.

### Drift detection (estado actual)

- **CONFIRMADO** vía `readlink ~/.claude/skills/kodo-orchestrate`: symlink apunta a `/Users/alex/dev/klab/kodo/skills/kodo-orchestrate` (path pre-Phase 999.1, NO existe en filesystem).
- **CONFIRMADO** vía `ls /Users/alex/dev/klab/kodo/skills/`: el directorio `<repo>/skills/` ya no contiene `kodo-orchestrate/` (Phase 999.1 lo movió a `<repo>/.claude/skills/`).
- **CONFIRMADO** vía `find <repo> -name kodo-orchestrate -type d`: la skill canonical vive SOLO en `<repo>/.claude/skills/kodo-orchestrate/`.

Phase 21 primer ejecución (manual `kodo skill sync` o auto-sync del orchestrator) resolverá el residuo: detecta symlink → borra link → crea dir → copia archivos canónicos → emite `skill.sync.auto` con `files_changed: N`.

</code_context>

<specifics>
## Specific Ideas

- Driver concreto verificable: `~/.claude/skills/kodo-orchestrate` es symlink obsoleto que apunta a un path que NO existe. El primer ejecución de Phase 21 lo resuelve por construcción (D-04).
- Auto-sync NO es defensa duplicada de la Constraint cwd=repo (D-04 Phase 999.1) — es complemento: el repo gana siempre por orden de carga de Claude Code, sync solo asegura que home no esté stale para invocaciones cross-cwd futuras (ej. un `claude` lanzado desde otro repo que use la skill home).
- Phase 21 prioriza determinismo (hash SHA-256 over mtime) sobre velocidad porque el conjunto de archivos es pequeño (~5-10 archivos, ~50KB total) — el coste es despreciable.
- Fail-open en auto-sync es cohesivo con resto de v0.6: Phase 19 cleanup fail-open, Phase 20 reminder estático (no enforcement runtime), Phase 21 sync fail-open. Patrón: añadir defensa sin bloquear el flujo principal.
- `--prune` opt-in es el único path destructivo del CLI; default no-destructivo evita pérdida silenciosa de overrides locales del operador.

</specifics>

<deferred>
## Deferred Ideas

- **Sync inverso `~/.claude/skills/` → `<repo>/.claude/skills/`** — descartado por REQUIREMENTS.md "Out of Scope". El repo es la source canonical; cambios manuales en home se descartan en el próximo sync.
- **`kodo skill diff` / `kodo skill list`** — comandos adicionales para inspección sin sync. Defer a v0.7+ si el operador los pide explícitamente. Phase 21 deja el subgrupo `kodo skill <subcmd>` abierto para extensión.
- **Watch mode (`kodo skill sync --watch`)** — defer indefinidamente. Manual + auto-on-launch cubre el flujo de operación normal. Watch consume recursos sin beneficio claro.
- **Sync de skills genéricas en `<repo>/.claude/skills/`** (no solo `kodo-orchestrate`) — defer indefinidamente. Phase 21 es específica de la skill canonical de kodo; otras skills son responsabilidad de Claude Code o plugins.
- **Pre-execute script de bootstrap para limpiar symlink residual** — innecesario; el primer ejecución de Phase 21 lo resuelve (D-04).
- **`kodo skill sync --dry-run`** — útil para QA pero no requerido por SKILL-01..04. Defer si emerge necesidad (ej. CI/CD que valida drift sin tocar).
- **Hash cache** (no recomputar hash si mtime+size no cambió) — optimización prematura para 5-10 archivos. Defer.
- **Enforcement: el orchestrator REQUIERE sync exitoso para lanzar** — descartado por D-03 fail-open. Reabrir solo si emerge un caso donde la stale home rompe un flujo crítico (no esperado hoy).
- **Migración del symlink residual via `kodo doctor`** — Phase 19 deferred `kodo gsd doctor`; Phase 21 lo resuelve inline en el sync. Sin doctor adicional.

### Reviewed Todos (not folded)

No hubo todos cross-referenced en esta sesión (gsd-sdk query todo.match-phase 21 → matches: []).

</deferred>

---

*Phase: 21-skill-sync-cli-auto-sync*
*Context gathered: 2026-05-12 — auto-mode single pass*
