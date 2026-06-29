# Phase 61: Progreso vivo para sesiones adoptadas - Context

**Gathered:** 2026-06-24
**Status:** Ready for planning
**Mode:** discuss (3 decisiones de diseño locked por el operador)

<domain>
## Phase Boundary

Una sesión GSD **adoptada** (no lanzada por kodo) refleja su progreso vivo `N/M` en el dashboard igual que una lanzada. **Origen:** HUMAN-UAT de DEBT-02 (2026-06-23) — una sesión adoptada GSD no mostraba `N/M`. Diagnóstico de dos causas raíz:
1. **La adopción no marca `gsd`** (`buildSessionFromAdoption`, `src/adopt.js:114-129`, omite `gsd`/`gsd_mode`/`phase_id`) → gate del progreso `App.js:419` (`row.gsd !== true → no-progress`) la excluye.
2. **El lector asume worktree de kodo** (`computeRealWorktreePath(project_path, session_id)` = `<project_path>/.claude/worktrees/<sid>/.planning/STATE.md`, `App.js:433`) — una sesión adoptada corre en su cwd real y no tiene ese worktree; su STATE.md está en `<project_path>/.planning/STATE.md`.

</domain>

<decisions>
## Implementation Decisions (LOCKED en discuss 2026-06-24)

### D-1 — Detección de progreso DINÁMICA en el lector (cubre adoptadas ya-GSD Y las que se vuelven GSD después)
El gate del progreso (`App.js` enrich) pasa de **"`row.gsd === true`"** a **"existe un STATE.md con bloque `progress:` legible en el path resuelto"**. Es decir: el progreso se muestra para CUALQUIER sesión cuyo path resuelto tenga un STATE.md GSD, independientemente del flag `gsd` persistido.
- **Por qué:** cubre el Caso B — una sesión adoptada que NO era GSD al adoptar pero se vuelve GSD después (el operador corre `/gsd:*` dentro y aparece `.planning`) se enciende sola, sin re-adoptar ni re-detect. El flag `gsd` congelado al adoptar no bloquea el progreso.
- **Implicación (para el planner):** relaja la invariante DG-03 (Phase 50.1: "solo filas GSD se enriquecen"). Consecuencias a manejar: (a) el enrich intentará resolver+leer el STATE.md para TODAS las filas cada render (no solo `gsd:true`) → mantener never-throws + barato (stat síncrono, ENOENT→no-progress→'—'); (b) una sesión no-GSD en un repo que SÍ es proyecto GSD mostraría el progreso del proyecto — comportamiento aceptado (si hay STATE.md GSD en el path, se muestra). El guard anti-traversal del `session_id` (`App.js:426-431`) se preserva.
- **NO** se mueve la lógica GSD a reconcile (rechazado: reconcile es host/liveness, no debe ganar un segundo escritor del flag). **NO** queda solo at-adopt snapshot (rechazado: no cubriría el Caso B).

### D-2 — Resolución del path del STATE.md: fallback worktree → project_path
El lector resuelve el STATE.md con DOS caminos:
- Si existe el worktree de kodo (`<project_path>/.claude/worktrees/<sid>/`, sesión **lanzada**) → `computeRealWorktreePath` (actual; preserva Pitfall 1 / la defensa anti-`.bg-shell`).
- Si no (sesión **adoptada**, sin worktree de kodo) → `<project_path>/.planning/STATE.md`.
- **NO** usar siempre `project_path` (rechazado: rompería las sesiones lanzadas, cuyo STATE.md vive en el worktree aislado, no en `project_path` — regresión).
- **NO** usar el `row.worktree_path` persistido (es el `.bg-shell` equivocado, Pitfall 1).
- Decisión del discriminador "tiene worktree de kodo": preferentemente por existencia del dir `.claude/worktrees/<sid>` (o STATE.md ahí); el planner fija la forma exacta (p. ej. intentar worktree-path primero y caer a project_path en ENOENT). Never-throws.

### D-3 — `adopt.js` setea `gsd` + `gsd_mode` + `phase_id` at-adopt (para columnas phase/mode)
`buildSessionFromAdoption` (o un detector adyacente en la fontanería) detecta si el cwd/`project_path` es proyecto GSD (existe `.planning/PROJECT.md` o `.planning/STATE.md`) y setea `gsd:true` (+ `gsd_mode`/`phase_id` derivables del STATE.md).
- **Sigue siendo útil** aunque el progreso ya sea dinámico (D-1): alimenta las columnas **phase/mode** (gated por `deriveAnyGsd`/flag `gsd`) para sesiones adoptadas.
- Determinista, 0-token (preserva el invariante "adopt.js es fontanería 0-token"). El flag es propiedad de la sesión → su sitio es donde se crea.
- **Atención host-agnóstico:** la detección de GSD es lectura de filesystem (`.planning/`), NO cmux — no rompe la regla "cmux solo via src/host/".

</decisions>

<code_context>
## Existing Code Insights

- `src/cli/dashboard/App.js:416-445` — el enrich del progreso. Gate actual `if (row?.gsd !== true) return no-progress` (419) → relajar a detección por STATE.md (D-1). Path via `computeRealWorktreePath` (433) → añadir fallback project_path (D-2). Guard anti-traversal del sid (426-431) se conserva.
- `src/cli/dashboard/progress.js` — `readGsdProgress(base, {})` never-throws: 'ok' (n/m), 'no-progress' (ENOENT / sin progress block), 'error' (EACCES / corrupto). El keep-last-good (`App.js:439-442`) y `deriveAnyProgress` (`select.js:242`, cuenta status 'ok') quedan IGUAL.
- `src/session/state.js:176` — `computeRealWorktreePath(projectPath, sessionId)` = `join(projectPath, '.claude','worktrees', sessionId)`.
- `src/adopt.js:114-129` — `buildSessionFromAdoption` (pure builder); aquí se añaden `gsd`/`gsd_mode`/`phase_id` (D-3). Setea `project_path: projectPath` (ancestro configurado más cercano del cwd — `resolveProjectPath`).
- `deriveAnyGsd` (`select.js`) / columnas phase/mode — gated por flag `gsd`; D-3 las alimenta para adoptadas.
- Test harness de componente: `ink-testing-library` (`test/dashboard/app-*.test.js`, incl. el nuevo `app-progress-keeplast.test.js` de la regresión keep-last-good) — usar el mismo patrón para tests de Phase 61 (sesión adoptada sin worktree + STATE.md en project_path → prog; sesión no-GSD → '—').

</code_context>

<specifics>
## Specific Ideas

- Preservar el read-path probado (`readGsdProgress` + keep-last-good) — Phase 61 solo cambia el GATE (D-1) y la RESOLUCIÓN DE PATH (D-2), no el parser ni el keep-last-good.
- Regression: una sesión LANZADA (con worktree) debe seguir mostrando su `N/M` desde `.claude/worktrees/<sid>` (no regresar D-2).
- Una sesión no-GSD sin STATE.md en su path → '—' (sin cambio observable).
- Tests con ink-testing-library siguiendo el patrón de `app-progress-keeplast.test.js`.

</specifics>

<deferred>
## Deferred Ideas

- **Bootstrap/creación de GSD al adoptar** (que kodo INICIALICE un proyecto GSD para una sesión adoptada no-GSD): fuera de scope. Phase 61 hace que una sesión que SE VUELVE GSD (por acción del operador dentro de la sesión) se refleje — pero NO crea la estructura GSD por sí misma.
- Columnas phase/mode con derivación rica del modo (full/quick) más allá de lo que el STATE.md expone directamente.

</deferred>

<canonical_refs>
## Canonical References

- `.planning/STATE.md` §Open Blockers (DEBT-02 UAT) — diagnóstico de las 2 causas raíz + F2 (contexto del descubrimiento).
- `.planning/ROADMAP.md` §"Phase 61" (Backlog) — Goal + 3 Success Criteria originales.
- `src/cli/dashboard/App.js` (enrich 416-445), `src/cli/dashboard/progress.js`, `src/cli/dashboard/select.js` (deriveAnyProgress/deriveAnyGsd), `src/adopt.js` (buildSessionFromAdoption), `src/session/state.js` (computeRealWorktreePath).
- `test/dashboard/app-progress-keeplast.test.js` — patrón de test de componente del progreso.

</canonical_refs>
</content>
