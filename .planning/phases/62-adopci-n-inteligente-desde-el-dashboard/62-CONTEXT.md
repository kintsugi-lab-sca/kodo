# Phase 62: Adopción inteligente desde el dashboard - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Al pulsar `a` sobre un surface ad-hoc en el dashboard, kodo ejecuta un paso de **derivación LLM one-shot** (`claude -p --model claude-haiku-4-5`, headless, fail-open) que produce `{ title, description }` a partir de la memoria del proyecto + la intención de la sesión, los **propone** al operador, y al confirmar shellea `kodo adopt --title '…' --description '…'`. Implementa **ORCH-02** y supersede el camino at-adopt fallido de ORCH-01 (Phase 57).

**Por qué el dashboard y no el orquestador:** el dashboard YA tiene las coordenadas (`workspaceRef`/`cwd`/`sessionId`/`kind`) vía `listAgentSurfaces()` (DETECT-01). El orquestador no podía resolverlas para una sesión no adoptada — ese fue el fallo de UAT de ORCH-01 (ROMAN-194, 2026-06-24).

**En alcance:** derivación de `{title, description}` al pulsar `a`; lectura de memoria GSD (PROJECT.md/ROADMAP/STATE) Y fallback non-GSD (git log + primer prompt del transcript); UX derive-then-confirm; fail-open a `basename(cwd)`; paso de `--description` a `kodo adopt`.

**Fuera de alcance:** editar el título/descripción en el overlay (v1 no-editable); enriquecer tareas ya adoptadas (eso es Phase 60 / `kodo comment`); `updateTask` (no existe, FROZEN-9); cambiar el orquestador (ORCH-01 queda como está, superado).

</domain>

<decisions>
## Implementation Decisions

### Carril LLM y acceso a datos
- **D-01:** Derivador **one-shot** `claude -p --model claude-haiku-4-5`, headless, disparado por la tecla `a` (NO daemon, NO orquestador persistente). Precedente de spawn de `claude` en `src/orchestrator/launch.js:197`.
- **D-02:** **Contexto inline pre-leído** — kodo lee los insumos (PROJECT.md/ROADMAP/STATE para GSD; git log + primer prompt del transcript) y los **inyecta en el prompt**. El subproceso NO lleva tools (sin Read/Bash). Razón: rápido, determinista, coste acotado, cero superficie de tools en el subproceso.
- **D-03:** **never-throws / fail-open** con timeout acotado (orden de ~8s; valor exacto lo fija el planner). Si Haiku falla/timeout/parse-error → fallback a `basename(cwd)` (comportamiento actual de Phase 56) y el adopt **nunca se bloquea**.

### Fuentes de memoria (señales de derivación)
- **D-04:** **GSD** (`.planning/` existe): leer `PROJECT.md` + `ROADMAP.md` + `STATE.md` → captura el **alcance global** del proyecto (arregla el F2 del UAT: el resumen anterior se ancló en los últimos commits en vez del alcance).
- **D-05:** **non-GSD** (sin `.planning/`): **SÍ se enriquece** — derivar de `git log --oneline` + el **primer prompt del usuario** del transcript. Cubre la mayoría de sesiones ad-hoc (uso real: dev solo + equipo, todos con Claude). NO cae a basename salvo fallo.
- **D-06:** El **primer prompt del usuario** del transcript es señal primaria de *intención* ("qué va a hacer"); `git log` es señal de *actividad*. Reusar `resolveTranscriptPath(cwd, sessionId)` de `src/logger-events.js:109` para localizar el `.jsonl` — NO reinventar el path.

### Prompt de derivación
- **D-07:** **Prompt nuevo, dedicado y mínimo** (NO reutilizar la prosa de adopción del orquestador `skill.md §Adopción asistida`). Razón: la shell-safety la garantiza `execFile` con argv literal (los metacaracteres son inertes), así que el mandato de charset/single-quote de ORCH-01 es **redundante aquí**. El prompt solo pide derivar `{title, description}` desde el contexto inline.

### UX (flujo de la tecla `a`)
- **D-08:** **Derive-then-confirm**: pick surface → estado "derivando…" (spinner) → muestra `{title, description}` propuestos → segunda `a` confirma → `kodo adopt`. La latencia de Haiku se enmascara en la transición picker→confirm.
- **D-09:** **v1 no-editable**: si la propuesta no convence, Esc → el operador usa `kodo adopt --title '…'` manual. Editar en el overlay ink se difiere.
- **D-10:** Por qué derive-ANTES-de-crear: no hay `updateTask` para el título (FROZEN-9), así que el buen título debe existir antes del `createTask`. La descripción viaja como `--description` (cuerpo at-adopt), NO como comentario post-hoc.

### Invariantes preservados
- **D-11:** Suelo determinista 0-token intacto: `adoptSession`/`createTask` no cambian; el LLM vive SOLO en el paso de derivación del dashboard.
- **D-12:** El `{title, description}` derivado pasa igual por `sanitizeAdoptionData` (BIDIR-08, `src/adopt.js`) — redacción de home/rutas. Sin saneo nuevo.
- **D-13:** `execFile` argv (sin shell) → inyección estructuralmente imposible; T-57-01 no aplica a este carril.

### Trade-offs aceptados conscientemente
- **D-14:** Rompe el invariante literal "vigilante/server 0-token" — pero es un spawn **explícito, disparado por tecla, acotado** (no razonamiento de fondo). Aceptado.
- **D-15:** Dependencia dura del CLI `claude` en PATH. Aceptado (todos los devs del proyecto usan Claude). El planner debe definir el fallback si `claude` no está disponible (→ basename, como cualquier otro fail-open).

### Claude's Discretion
- Valor exacto del timeout (~8s de referencia).
- Ubicación del módulo nuevo (sugerencia: `src/cli/dashboard/enrich.js`) y su firma DI.
- Forma exacta del prompt y del parse del `--output-format json` de `claude -p` (envelope → extraer el JSON `{title, description}`; parse-fail → fallback).
- Presupuesto de contexto inline (cuánto de PROJECT.md/transcript alimentar; caps).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/REQUIREMENTS.md` §ORCH-02 — el requisito completo de esta fase (spec, invariantes, trade-offs).
- `.planning/ROADMAP.md` — Phase 62 (checklist + tabla de estado).
- `.planning/phases/57-orquestador-asistido/57-HUMAN-UAT.md` — el fallo de UAT de ORCH-01 (F1 coordenadas, F2 resumen estrecho) que motiva esta fase.
- `.planning/milestones/v0.13-MILESTONE-AUDIT.md` — contexto del milestone (status gaps_found por esta fase).

### Activos de código a reusar (verificados en scout 2026-06-25)
- `src/logger-events.js:109` — `resolveTranscriptPath(cwd, sessionId)` ya computa `~/.claude/projects/<encoded>/<sessionId>.jsonl`. REUSAR para localizar el primer prompt.
- `src/cli/dashboard/adopt.js:91` — `runAdopt({ ..., title })` ya inserta `--title` como argv literal. Añadir `--description` con el mismo patrón.
- `src/orchestrator/launch.js:197` — precedente de spawn de `claude`. Mirror para resolver/spawnear el binario.
- `src/adopt.js` — `sanitizeAdoptionData` (BIDIR-08) + `isGsdProject(projectPath)` (detección GSD, Phase 61). REUSAR `isGsdProject` para la rama D-04/D-05.
- `src/cli/dashboard/select.js:344` — `computeAdoptable` (filtro kind==='claude' + set-difference). El surface elegido ya trae `cwd`/`sessionId`/`workspaceRef`.
- `src/cli/dashboard/App.js` — handler de la tecla `a` + estados de confirm (`list`/`filter`/`overlay`/`confirm`). Aquí entra el estado "derivando…".

### Skill de referencia (NO copiar la prosa — D-07)
- `.claude/skills/kodo-orchestrate/skill.md` §"Adopción asistida" — referencia de QUÉ señales usar (git log, primer prompt), pero el prompt de Phase 62 es nuevo y mínimo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveTranscriptPath` (logger-events.js): localiza el `.jsonl` de la sesión sin I/O — el derivador lee el primer mensaje de usuario de ahí.
- `runAdopt` (dashboard/adopt.js): ya shellea `kodo adopt` con argv literal + `--title`; extender con `--description`.
- `isGsdProject` (adopt.js, Phase 61): decide la rama GSD (D-04) vs non-GSD (D-05).
- `sanitizeAdoptionData` (adopt.js): backstop BIDIR-08 que sigue aplicando al `{title, description}` derivado.

### Established Patterns
- Spawn de binario externo: `process.execPath` + argv literal, cero PATH lookup (T-56-02). `launch.js:197` ya spawnea `claude`.
- never-throws / fail-open en todos los carriles del dashboard (el panel ink permanece montado).
- DI por `*Fn` params (testabilidad) — el derivador debe ser DI-inyectable para mockear el spawn en tests.

### Integration Points
- El nuevo paso de derivación se inserta en el flujo de la tecla `a` de `App.js`, entre "pick surface" y el `runAdopt` existente.
- El derivador (módulo nuevo, p.ej. `src/cli/dashboard/enrich.js`) es invocado por `App.js`/`index.js`; su salida alimenta los `--title`/`--description` de `runAdopt`.

</code_context>

<specifics>
## Specific Ideas

- El fallo concreto que origina la fase: ROMAN-194 (proyecto scp-cmri) se adoptó con título `scp-cmri` (basename) y un comentario que describía solo "la Fase 2 acaba de cerrarse…" en vez del alcance global. La derivación debe producir un título que refleje el proyecto, no el directorio ni el último commit.
- Modelo concreto: `claude-haiku-4-5` (Haiku 4.5) — suficiente para summarización; barato; latencia baja.

</specifics>

<deferred>
## Deferred Ideas

- **Edición del título/descripción en el overlay ink** — v2 (D-09 lo deja fuera de v1).
- **Enriquecimiento de tareas YA adoptadas con el derivador LLM** — ya existe `kodo comment` (Phase 60); integrarlo con este derivador es un follow-up.
- **Backfill del título de tareas ya creadas** — bloqueado por la ausencia de `updateTask` (FROZEN-9); requeriría ampliar el contrato, fuera de alcance.
- **claude-mem como fuente de memoria adicional** — para proyectos con observaciones claude-mem, podría enriquecer la señal; se mantiene filesystem-based (PROJECT.md/git log/transcript) en v1 para no añadir dependencia MCP en el subproceso.

</deferred>

---

*Phase: 62-adopci-n-inteligente-desde-el-dashboard*
*Context gathered: 2026-06-25*
