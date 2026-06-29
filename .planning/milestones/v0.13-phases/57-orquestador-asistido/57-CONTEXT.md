# Phase 57: Orquestador asistido - Context

**Gathered:** 2026-06-18
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; ver DISCUSSION-LOG.md)

<domain>
## Phase Boundary

Phase 57 añade el **tercer consumidor** de la fontanería de adopción: el **orquestador** (el único carril con LLM). Dada una sesión `claude` ad-hoc, el orquestador deriva un **título inteligente** del contexto real (cwd / commits recientes / transcript) — mucho mejor que el `basename(cwd)` determinista del dashboard (Phase 56) — lo confirma con el operador, y shellea el **mismo** `kodo adopt --title "<derived>"`. El carril 0-token del núcleo se preserva intacto; el LLM vive **estrictamente en el consumidor** (la prosa del skill).

Es un **CONSUMIDOR no dueño**: NO añade lógica de negocio nueva, NO toca el núcleo determinista (`adoptSession`/`kodo adopt`), NO es un mecanismo paralelo. El deliverable es **prosa de instrucción** en el skill `kodo-orchestrate` (+ espejo condensado en el fallback `src/orchestrator/prompt.md`), apoyándose en el CLI `kodo adopt` (Phase 54) y el sanitizador del núcleo (BIDIR-08, Phase 53).

**En scope (ORCH-01):**
- Sección nueva en `.claude/skills/kodo-orchestrate/skill.md` ("Adopción asistida: sesión → tarea") que instruye al orquestador a: (1) reconocer/proponer una sesión ad-hoc adoptable, (2) derivar un título inteligente del contexto real, (3) confirmarlo (humano/CLI) antes de crear, (4) shellear `kodo adopt --title "<derived>" --workspace … --cwd … --session-id … --project …`.
- Espejo/cross-ref condensado en `src/orchestrator/prompt.md` (la fuente degradada que ya cross-referencia el skill).
- Resolución del `--project` reusando el mapeo que el orquestador ya conoce (`~/.kodo/projects.json`, §"Mapeo de proyectos" del skill).

**FUERA de scope (límites con otras fases):**
- **Descubrimiento automático** de surfaces ad-hoc (listAgentSurfaces / set-difference) → es de la **tecla del dashboard (Phase 56)**. El orquestador "no depende del spike — toma input explícito" (ROADMAP/ORCH-01).
- **Lógica de negocio nueva en el orquestador** o en `src/orchestrator/launch.js` → prohibido (SC3). El orquestador solo deriva el título (LLM) y shellea el CLI.
- **Cambios al núcleo determinista** (`adoptSession`, `kodo adopt`, `sanitizeAdoptionData`) → ya completos (Phase 53/54); Phase 57 los consume sin tocarlos.
- **El gap de liveness de sesiones adoptadas** (dead/zombie en el dashboard) → **Phase 59** (independiente).
- Embeber bodies de transcript en la tarea → prohibido por BIDIR-08.
</domain>

<decisions>
## Implementation Decisions

### Cómo obtiene el orquestador la sesión a adoptar (ORCH-01, success criterion 1)
- **D-01:** El orquestador recibe las coordenadas de la sesión (`workspaceRef` / `cwd` / `sessionId`) como **input explícito** — NO auto-descubre (ROADMAP/ORCH-01: "no depende del spike, toma input explícito"). El descubrimiento es responsabilidad de la tecla del dashboard (Phase 56). El **valor** del orquestador es derivar el título, no descubrir. **⚠ FLAG para researcher/planner:** clarificar la fuente práctica de esas coordenadas — ¿las provee el operador en la sesión interactiva? ¿se pasan desde el flujo del dashboard? Si se necesita una fuente programática (el operador no conoce el `sessionId`/`checkpoint_id` de memoria), la opción LOCKED-compliant es un **comando `kodo` read-only que envuelva `listAgentSurfaces()`** (consumidor determinista, espejo de `kodo adopt`, cmux confinado a `src/host/`) — pero el scope POR DEFECTO de esta fase es prosa + input explícito, sin CLI nuevo. El planner decide si el read-CLI entra aquí o se difiere.

### Derivación del título inteligente (ORCH-01, success criterion 1)
- **D-02:** El título lo compone el **orquestador (LLM)** con sus herramientas normales (Bash/Read), a partir de: `basename(cwd)` como ancla + `git log --oneline -N` en el cwd (subjects de commits recientes = la mejor señal de "qué es este trabajo") + opcionalmente un **resumen** del transcript. Conciso (una línea, estilo título de tarea). El orquestador NO reimplementa el default ni el saneo — solo produce un string mejor que `basename(cwd)` y lo pasa como `--title`. El núcleo lo sanea (D-04).

### Confirmación antes de crear (ORCH-01, success criterion 2)
- **D-03:** El orquestador **propone** el título derivado + el proyecto destino al operador y **espera aprobación/edición** antes de shellear `kodo adopt` (SC2: "se confirma humano/CLI"). Nunca crea silenciosamente. En la sesión interactiva, "confirmar (CLI)" = el operador aprueba/edita en el diálogo; el orquestador entonces ejecuta el shell con el título final.

### Saneo + descripción (BIDIR-08, success criterion 2)
- **D-04:** El saneo es **automático en el núcleo**: `kodo adopt` ya corre `sanitizeAdoptionData` (BIDIR-08: redacta home/rutas absolutas, default `basename(cwd)`) sobre `--title`/`--description`. El orquestador solo pasa `--title "<derived>"` — NO duplica el saneo (única fuente de verdad en `src/adopt.js`). `--description` es **opcional** y, si se usa, es un **resumen corto escrito por el LLM**, NUNCA un body crudo de transcript (BIDIR-08). El estado inicial sano de la tarea lo aplica el core (`createTask` resuelve el state trigger, Phase 52). Recomendado para esta fase: **solo `--title`** (descripción diferible).

### Dónde vive el cambio (ORCH-01, success criterion 3)
- **D-05:** La fuente canónica es `.claude/skills/kodo-orchestrate/skill.md` — nueva sección "Adopción asistida (sesión → tarea)" siguiendo el estilo de las secciones existentes (Proceso de inicio / Diagnóstico / Sesiones GSD). Espejo **condensado** + cross-ref en `src/orchestrator/prompt.md` (la fuente degradada que ya remite al skill, línea 3). **CERO lógica nueva en `src/orchestrator/launch.js`** ni en el núcleo. El LLM vive estrictamente en la prosa del consumidor; el carril 0-token (`kodo adopt`) queda intacto.

### Claude's Discretion
- **Wording exacto** de la sección del skill + el espejo en prompt.md (estilo prosa imperativa, provider-agnostic — el skill ya es provider-agnostic).
- **Cuántos commits** mira `git log` para el título (p.ej. `-5`) y la heurística de composición — discreción del orquestador/LLM en runtime.
- **Si incluir `--description`** (resumen corto) en esta fase o diferirlo a BIDIR-F2 (backfill de descripción desde transcript/diff).
- **Forma del read-CLI** (si el planner decide incluirlo): nombre/flags (`kodo surfaces` vs `kodo adopt --list`), espejo de `kodo adopt`.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap (este milestone)
- `.planning/REQUIREMENTS.md` — **ORCH-01** (orquestador propone + deriva título inteligente + confirma + shellea `kodo adopt --title`; prosa del skill; cero lógica nueva). **BIDIR-08** (saneo + datos auto-derivados editables + estado inicial sano + nunca embeber transcript). Fuente de verdad del scope.
- `.planning/ROADMAP.md` §"Phase 57" — goal + 3 success criteria ("no depende del spike, toma input explícito"). §"Progress" — regla transversal LOCKED.

### El skill a editar (deliverable principal)
- `.claude/skills/kodo-orchestrate/skill.md` — fuente canónica del orquestador (180 líneas): Proceso de inicio, §"Mapeo de proyectos" (`~/.kodo/projects.json`), Reglas de operación, Sesiones GSD, 4 flujos de Diagnóstico, §"Cómo actualizar este skill". La sección nueva de adopción sigue este estilo prosa provider-agnostic.
- `src/orchestrator/prompt.md` — el fallback degradado (109 líneas) que cross-referencia el skill (línea 3). Recibe el espejo condensado.
- `src/orchestrator/launch.js` — `resolvePromptTemplate`; NO se toca (cero lógica nueva).

### La fontanería que el orquestador consume (NO se toca)
- `src/cli/adopt.js` + `src/cli.js` (comando `adopt`) — el CLI que el orquestador shellea: flags `--workspace/--cwd/--session-id/--project/--title/--description/--json`, exit codes Opción A.
- `src/adopt.js` — `adoptSession` (núcleo 0-token) + **`sanitizeAdoptionData`** (BIDIR-08, líneas ~82-90: redacta home/abs paths, default `basename(cwd)`). El saneo del título es automático aquí.
- `54-CONTEXT.md` — decisiones del CLI `kodo adopt` (el título/saneo los aplica el CORE, el CLI no duplica). `56-CONTEXT.md` — el dashboard como consumidor determinista paralelo (título = basename, sin LLM); Phase 57 es el consumidor LLM.

No hay specs/ADRs externos — las decisiones canónicas viven en PROJECT.md, los CONTEXT.md de fase y REQUIREMENTS.md.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `kodo adopt` (CLI, Phase 54) + `adoptSession` (núcleo, Phase 53) — la fontanería completa; el orquestador solo la shellea con un mejor `--title`.
- `sanitizeAdoptionData` (`src/adopt.js`, BIDIR-08) — saneo automático del título/descripción en el adopt; el orquestador NO lo duplica.
- `.claude/skills/kodo-orchestrate/skill.md` — el patrón de secciones de prosa (Diagnóstico, Sesiones GSD) a replicar para la sección de adopción.
- §"Mapeo de proyectos" del skill — el orquestador ya resuelve provider + `~/.kodo/projects.json`; reusa eso para el `--project`.

### Established Patterns
- **Una fontanería, tres consumidores** — CLI (54), dashboard (56, determinista), orquestador (57, LLM). El LLM vive SOLO en el consumidor orquestador.
- **Carril 0-token del núcleo intacto** — el orquestador deriva el título (LLM) pero el `kodo adopt` y `adoptSession` no ven un solo token de LLM.
- **prompt.md = fallback degradado del skill** (v0.5): la prosa canónica vive en el skill; prompt.md es el espejo condensado con cross-ref.
- **BIDIR-08: nunca embeber transcript** — la descripción, si existe, es un resumen corto, no un dump.

### Integration Points
- `.claude/skills/kodo-orchestrate/skill.md` — nueva sección de adopción.
- `src/orchestrator/prompt.md` — espejo condensado + cross-ref.
- `kodo adopt` (proceso hijo shelleado por el orquestador) — la única mutación; el orquestador deriva el título y lo pasa.
</code_context>

<specifics>
## Specific Ideas

- El flujo del operador con el orquestador: "tengo una sesión ad-hoc en ~/dev/foo, adóptala" → el orquestador lee `git log`/cwd/transcript, propone un título inteligente + proyecto, el operador aprueba/edita, el orquestador shellea `kodo adopt --title "<derived>" …`.
- El contraste clave con Phase 56: el dashboard usa `basename(cwd)` (= "kodo", "fvf") sin LLM; el orquestador produce algo como "Investigar tags y comportamiento del orquestador kodo" derivado del trabajo real.
- El orquestador YA tiene las herramientas para derivar el título (Bash para `git log`, Read para el transcript) — no necesita capacidades nuevas, solo instrucción (prosa).
</specifics>

<deferred>
## Deferred Ideas

- **Descripción auto-derivada del transcript/diff** (resumen del trabajo ya hecho) → **BIDIR-F2** (futuro). Esta fase prioriza el título; la descripción es opcional/diferible.
- **Descubrimiento automático de surfaces por el orquestador** (read-CLI `kodo surfaces` envolviendo `listAgentSurfaces()`) → solo si el planner confirma que es necesario para obtener las coordenadas; si no, queda como refinamiento futuro. Por defecto el orquestador toma input explícito.
- **Liveness de sesiones adoptadas** (dead/zombie en el dashboard) → **Phase 59** (ya en roadmap).
- **adopt asistido hacia ClickUp / adapter local** → **BIDIR-F3** (cuando existan esos adapters).

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 57-orquestador-asistido*
*Context gathered: 2026-06-18*
