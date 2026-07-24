# Phase 79: Sidebar Doctor - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** --auto (decisiones auto-seleccionadas sobre la opción recomendada; constraints LOCKED de v0.18 respetados sin re-discutir)

<domain>
## Phase Boundary

`kodo sidebar doctor` — un doctor determinista del sidebar de cmux, espejo del patrón `src/gsd/doctor.js` (`scan` + `execute`, dry-run por defecto / `--fix`, 0 tokens). Detecta y corrige: grupo faltante → `create`, workspace suelto con grupo esperado → `add`, grupo disuelto por cierre de su anchor → re-crear/`set-anchor` (al miembro más longevo), grupo vacío → `ungroup`. La gestión de grupos —hasta hoy prohibida (GRP-04)— pasa a estar permitida SOLO en este carril, con allowlist no destructivo (`create`, `add`, `set-anchor`, `ungroup`). El launch path queda byte-idéntico (GRP-01..03 intactos). Requirements: SDR-01..06.

**Fuera de la fase:** carril orquestador (Phase 80, ORCH-07..08), saneo de deuda v0.17 (Phase 81, DEBT-01..04), `workspace-group delete` (NI SE CABLEA — LOCKED), sidebar como trigger, puerta LLM (FUT-03).

</domain>

<decisions>
## Implementation Decisions

### Fuente de datos del scan (re-derivación offline del grupo esperado)
- **D-01:** El scan es 100% offline y 0 red: inputs = `state.json` (sesiones con `workspace_ref`, `task_ref`, `project_path`, `started_at`), `projects.json`, y cmux (`workspace-group list --json` + `workspace list`). **Ninguna llamada al provider** — el doctor no necesita el task del provider para derivar el grupo esperado.
- **D-02:** El grupo esperado se re-deriva reutilizando `deriveExpectedGroupName` (`src/session/manager.js:144`) construyendo un task-like desde el session record: `ref` ← `session.task_ref`; el módulo se obtiene por **reverse-lookup determinista** en `projects.json` — si `session.project_path` ≠ `entry.default` y coincide con un path de `entry.modules`, el nombre del módulo es esa key (first-match estable si hubiera duplicados). Paths iguales al default colapsan al identifier a secas (mismo contrato D-01/D-02 de Phase 77).
- **D-03:** Alternativa descartada: persistir `expected_group` en el session record al lanzar — tocaría el launch path y arriesga SDR-04. No se modifica ningún escritor existente de `state.json`.

### Alcance de workspaces (qué toca el doctor)
- **D-04:** El doctor solo agrupa/mueve workspaces **correlacionados con sesiones kodo** presentes en `state.json` (match por `workspace_ref`). Workspaces del operador jamás se agrupan, mueven ni re-anclan.
- **D-05:** `ungroup` aplica a grupos con **0 miembros** según `workspace-group list --json` (acción no destructiva — no cierra workspaces). El dry-run lista siempre todos los candidatos para auditoría antes de cualquier `--fix`.
- **D-06:** Fail-open per item (espejo de `gsd/doctor.js`): un item ilegible o un shape inesperado de cmux se salta con warning, nunca aborta el pase entero. `scan` no muta nada; `execute` re-detecta antes de actuar (guard TOCTOU, espejo D-06/D-14 de Phase 41).

### Grupo disuelto y política de anchor
- **D-07:** No existe historial de grupos en cmux ni en kodo → "grupo disuelto" se operacionaliza como **grupo faltante cuyo nombre esperado tiene ≥1 sesión kodo viva**: mismo remedio que grupo faltante (`create` + `add` de los miembros + `set-anchor`). No se persiste estado nuevo para distinguir "nunca existió" de "se disolvió" — la acción correctiva es idéntica.
- **D-08:** "Miembro más longevo" = sesión con `started_at` más antiguo entre las que convergen al grupo (orden lexicográfico ISO-8601; empate → orden estable de la lista). `set-anchor` apunta a su `workspace_ref`.
- **D-09:** Orden de acciones determinista por grupo: `create` → `add`(s) → `set-anchor`. El report del scan lista las acciones en ese mismo orden (determinismo requerido por `--json` byte-determinista, DX-06).
- **D-10:** La sintaxis exacta de `cmux workspace-group create/add/set-anchor/ungroup` (flags, formato de refs, output) **debe verificarse empíricamente** en el research — mismo rigor que Phase 77 ("verificado en vivo"; precedente: `rename` documentado ≠ real en `src/cmux/client.js:86-89`).

### Shape del módulo y CLI
- **D-11:** Mitad pura en `src/cmux/sidebar-doctor.js` (scan+execute con DI, never-throws, defaults lazy — espejo arquitectónico exacto de `src/gsd/doctor.js`, incluido el invariante LOG-12: logger inyectado, `logger-noop.js` de default). CLI handler en `src/cli/sidebar-doctor.js` (espejo de `src/cli/gsd-doctor.js`). Registro en `src/cli.js`: `program.command('sidebar')` + subcomando `doctor` (espejo del namespace `gsd`, `src/cli.js:424-476`).
- **D-12:** Las funciones cmux nuevas viven en `src/cmux/client.js` vía el `run()` existente (execFile, timeout 15s, argv plano sin shell) y son **exclusivamente** las del allowlist: `create`, `add`, `set-anchor`, `ungroup`. El comentario GRP-04 de `listWorkspaceGroups` se actualiza para reflejar la re-fronterización (gestión permitida SOLO en el carril doctor).
- **D-13:** Exit codes y `--json` espejo de `gsd doctor`: dry-run → `hasActions ? 1 : 0` (patrón `src/cli/gsd-doctor.js:66`); payload `--json` byte-determinista idéntico TTY/no-TTY (DX-06). El comportamiento exacto de exit en `--fix` replica el de `gsd-doctor.js` (el researcher lo confirma del código).

### Guards SDR-02 y SDR-04
- **D-14:** Guard source-hygiene automático (SDR-02): test que escanea `src/` y **falla** si aparece `workspace-group` cableado con `delete` (p.ej. como elementos de argv). Espejo de los guards source-hygiene existentes (anti-inline de Phase 29; el researcher localiza el precedente exacto para calcar el patrón).
- **D-15:** SDR-04 se garantiza por construcción + evidencia: el launch path no se edita (ni `newWorkspaceWithGroupFallback`, ni `buildNewWorkspaceArgs`, ni el call-site de `manager.js:411`); los tests golden GRP-01..03 existentes deben pasar **sin modificación**. Si el doctor necesita helpers compartidos, se añaden como exports nuevos sin tocar los existentes.

### Claude's Discretion
- Naming interno del report (categorías tipo `missing_group` / `loose_workspace` / `empty_group`), formato de la salida humana del CLI, eventos nuevos en `logger-events.js` (taxonomía), y estructura de tests — siguiendo las convenciones de `gsd-doctor`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning (scope y constraints LOCKED)
- `.planning/ROADMAP.md` §Phase 79 — goal, success criteria 1-5, dependencias
- `.planning/REQUIREMENTS.md` §Sidebar Doctor (SDR-01..06) + §Out of Scope — `delete` ni se cablea; sidebar no es trigger
- `.planning/STATE.md` §Accumulated Context — **Constraints LOCKED de v0.18** (no re-discutir) + §Critical Invariants (GRP-04 re-fronterizado, cero deps npm, cero endpoints nuevos, `--json` byte-determinismo, escrituras `state.json` bajo `withStateLock`)

### Patrón espejo (doctor)
- `src/gsd/doctor.js` — mitad pura scan/execute, DI, never-throws, fail-open per item, TOCTOU re-check, LOG-12
- `src/cli/gsd-doctor.js` — CLI dry-run/`--fix`, `--json`, exit `hasGarbage ? 1 : 0`

### Assets reutilizados (Phase 77)
- `src/session/manager.js` — `deriveExpectedGroupName` (:144, pura, guards de ref degenerado), `resolveWorkspaceGroup` (:189, NFC+lowercase+trim), `newWorkspaceWithGroupFallback` (launch path, NO tocar)
- `src/cmux/client.js` — `run()` (execFile, timeout 15s), `listWorkspaceGroups()` (:108, comentario GRP-04 a actualizar)
- `src/session/state.js` — shape del session record (`workspace_ref`, `task_ref`, `project_path`, `started_at`), `loadState`

### Decisiones y riesgos heredados de v0.17
- `.planning/milestones/v0.17-phases/77-agrupaci-n-de-workspaces-en-cmux/77-CONTEXT.md` + `77-RESEARCH.md` — decisiones D-01..D-13 de agrupación, shapes verificados en vivo de `workspace-group list --json`, frontera D-13 (adoptadas/ya lanzadas) que esta fase resuelve
- `.planning/milestones/v0.17-phases/78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review/78-SECURITY.md` §Accepted Risks — IN-07/R-77-D10 (retry TOCTOU puede duplicar workspace; riesgo aceptado, no re-abrir)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/gsd/doctor.js` — plantilla arquitectónica completa: typedefs `DoctorReport`/`DoctorDeps`, DI con defaults lazy, categorías + `hasGarbage`, `protected` items
- `deriveExpectedGroupName` + `resolveWorkspaceGroup` (`src/session/manager.js`) — funciones puras listas para reuso directo; el doctor solo aporta el task-like reconstruido (D-02)
- `run()` de `src/cmux/client.js` — canal único hacia cmux, argv plano (V5/Tampering ya mitigado)

### Established Patterns
- Ritual dos pasos "doctor mira / doctor --fix arregla" con re-check TOCTOU antes de cada acción
- `--json` byte-determinista TTY/no-TTY (DX-06) y exit codes deterministas
- Color isolation (`picocolors` solo vía `src/cli/format.js`), LOG-12 (logger inyectado), cero deps npm nuevas
- Source-hygiene guards como tests (precedente Phase 29 anti-inline)

### Integration Points
- `src/cli.js:424` — patrón de registro de namespace (`gsd`) a calcar para `sidebar`
- `src/cmux/client.js` — punto único donde entran los 4 subcomandos del allowlist
- `state.json` es SOLO lectura para el doctor (ningún escritor nuevo; invariante `withStateLock` intacto por no escribir)

</code_context>

<specifics>
## Specific Ideas

- Origen: fricción real del operador (2026-07-20, Backlog 999.3) — sesiones de OptiAI sueltas porque no existía el grupo `ROMAN/OptiAI`; no se pre-crean grupos por módulo: el doctor los crea cuando hay sesiones que los esperan.
- El caso operador `SCP-CMRi` ≠ `SCP` queda fuera (acción de operador, no de código) — el doctor NO renombra grupos (no hay `rename` en el allowlist).

</specifics>

<deferred>
## Deferred Ideas

- **FUT-03** — puerta LLM para ambigüedad de agrupación (YAGNI, constraint de origen)
- **FUT-02** — `kodo doctor --fix` asistido config.json↔projects.json (propuesta KODO-10, v2)
- **FUT-01** — fidelidad markdown del overlay (solo si molesta en uso real)

</deferred>

---

*Phase: 79-Sidebar Doctor*
*Context gathered: 2026-07-23*
