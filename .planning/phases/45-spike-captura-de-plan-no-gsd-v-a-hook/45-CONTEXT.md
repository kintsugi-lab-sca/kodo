# Phase 45: Spike — captura de plan no-GSD vía hook - Context

**Gathered:** 2026-06-09
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-resueltas con la opción recomendada; revisar antes de ejecutar)

<domain>
## Phase Boundary

Determinar **empíricamente, con evidencia reproducible**, si las sesiones kodo **no-GSD / quick** (lanzadas con `--dangerously-skip-permissions`) emiten un plan **capturable** vía un hook **SOPORTADO** de Claude Code (`PostToolUse` sobre `ExitPlanMode`, o equivalente), dado que kodo ya inyecta `SessionStart`/`Stop`. El entregable es un documento de spike que concluye con un **veredicto binario** (VIABLE / INVIABLE) y, si VIABLE, especifica el contrato de captura que Phase 46 implementaría.

**Cubre:** PLAN-03 (spike — gate de PLAN-04).

**NO cubre (otras fases / out of scope):**
- Implementación de producción de la captura/persistencia → Phase 46 (PLAN-04, condicional/cuttable a v2). **Spike puro: cero código de producción se commitea aquí.**
- Parsear el **transcript JSONL crudo**, `~/.claude/plans/`, `~/.claude/todos/` → out of scope por ROADMAP/REQUIREMENTS (formato no documentado, frágil). El **único camino soportado evaluable es el hook**.
- Mostrar todos/Tasks en vivo de una sesión → v2 (PLAN-F1/PLAN-F2): sin fuente soportada.

</domain>

<decisions>
## Implementation Decisions

### Método experimental del spike (PLAN-03 SC#1)
- **D-01:** El veredicto se obtiene mediante un **experimento real y reproducible**, NO análisis documental. Se instala un **hook de prueba temporal e instrumentado** que vuelca a un fichero de log el **payload completo** recibido por stdin (espejo de cómo `session-start.js` lee stdin), y se lanza una sesión real `claude --dangerously-skip-permissions` que provoque un plan. La evidencia (comando exacto, hook instalado, payload crudo capturado **o su ausencia**) se transcribe literalmente al documento. El hook de prueba se instala/desinstala **manualmente** vía el mismo mecanismo que `src/hooks/install.js` (`~/.claude/settings.json`) y **NO se commitea a producción**.

### Eventos de hook a evaluar (PLAN-03)
- **D-02:** **Hipótesis primaria:** `PostToolUse` con matcher `ExitPlanMode`. Si NO dispara bajo `--dangerously-skip-permissions` (resultado plausible: skip-permissions evita el gate de aprobación de plan, por lo que `ExitPlanMode` podría no emitirse), se ejecuta un **barrido de eventos SOPORTADOS y documentados** (`PreToolUse`/`PostToolUse` sobre otras tools, `UserPromptSubmit`, `Stop`, `Notification`) para localizar el evento más cercano que porte el plan o la intención. El barrido se limita a eventos soportados — **nunca** desciende a parsear el transcript crudo ni rutas internas de Claude Code (D-07).

### Criterio del veredicto binario (PLAN-03 SC#2)
- **D-03:** El documento abre con un **veredicto binario accionable**: **VIABLE** (con el evento de hook concreto + forma del payload documentados) o **INVIABLE** (con la evidencia que lo justifica: el hook no dispara / el payload no contiene el plan). "**Capturable**" exige DOS condiciones, no una: (a) el payload contiene el **texto del plan**, y (b) es **correlacionable con la sesión** (`session_id` y/o `cwd` presentes en el payload). Que el evento meramente dispare sin portar el plan o sin correlación = **INVIABLE**.

### Contrato de captura a especificar si VIABLE (PLAN-03 SC#3)
- **D-04:** Si VIABLE, el documento especifica un **contrato de captura PROPIO de kodo**, espejo del patrón ya existente: el hook de kodo recibe el payload → extrae el plan → kodo lo persiste en **su propio side** (estado/dir de sesión de kodo), correlacionado por **`task_id`** vía el mapeo `session_id`/`cwd` → `task_id` que **ya hace `findSession`** en `session-start.js`/`state.js`. **NUNCA** parsing de rutas internas frágiles de Claude Code. El contrato define explícitamente: **(1)** qué evento de hook, **(2)** qué campo del payload contiene el plan, **(3)** dónde persiste kodo, **(4)** cómo se correlaciona con `task_id`, **(5)** cómo el overlay de Phase 44 (`mode:'overlay'`, snapshot congelado, never-throws) se **reusa** para mostrarlo. Si INVIABLE, el documento registra la decisión de **diferir PLAN-04 a v2** (PLAN-F1/PLAN-F2 ya lo anticipan) **sin bloquear** el cierre del milestone (Phases 44/45/47 cierran v0.11).

### Estructura y ubicación del documento (PLAN-03 SC#1)
- **D-05:** El entregable es **`45-SPIKE.md`** en el phase dir, con estructura: **(1)** Veredicto binario arriba del todo (VIABLE/INVIABLE en una línea); **(2)** Hipótesis y método (qué hook se instaló, qué comando se lanzó); **(3)** Evidencia reproducible (comandos exactos + payloads crudos capturados, o la ausencia documentada); **(4)** Contrato de captura para Phase 46 si VIABLE (los 5 puntos de D-04), o decisión explícita de diferir PLAN-04 a v2 si INVIABLE. **Evidencia > opinión** (rigor de spike GSD).

### Invariantes confirmadas (no se discuten — se honran)
- **D-06:** **Spike puro — cero implementación de producción.** No se commitea código de captura aquí; el hook de prueba es temporal y se desinstala tras el experimento. El veredicto **gobierna** si Phase 46 se planifica/ejecuta o se corta a v2.
- **D-07:** **Solo caminos soportados.** El único mecanismo evaluable es un hook **soportado y documentado** de Claude Code. Queda explícitamente fuera de scope: transcript JSONL crudo, `~/.claude/plans/`, `~/.claude/todos/`.

### Claude's Discretion
- Tarea/tool concreta usada para forzar un plan en la sesión de prueba (algo que naturalmente invoque plan mode) y el formato exacto del log de instrumentación — decisión del executor del spike.
- Si el barrido de eventos (D-02) se ejecuta como **matriz** (varios eventos instrumentados en un `settings.json` de prueba a la vez) o **secuencial** — decisión del executor; ambos satisfacen la reproducibilidad.
- Ubicación exacta del fichero de log de instrumentación temporal (p. ej. `/tmp/kodo-spike-*.log`) — irrelevante al veredicto.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y alcance de la fase
- `.planning/ROADMAP.md` §"Phase 45" — Goal + 3 Success Criteria + Notes (spike puro, cero implementación de producción, no parsear transcript/`~/.claude/plans/`/`~/.claude/todos/`, gate de Phase 46).
- `.planning/REQUIREMENTS.md` §"Plan Visibility (PLAN)" — PLAN-03 (spike), PLAN-04 (condicional), PLAN-F1/PLAN-F2 (futuros que anticipan el diferimiento a v2) + tabla "Out of Scope".

### Mecanismo de hooks de Claude Code (código a imitar para el hook de prueba + contrato de captura)
- `src/hooks/install.js` — `installHooks()`/`addHook()`: cómo kodo escribe hooks en `~/.claude/settings.json` sin clobber. **Modelo para instalar/desinstalar el hook de prueba temporal** (D-01). Hoy solo registra `SessionStart` + `Stop`.
- `src/hooks/session-start.js` — `main()`: lectura de stdin del hook (`readStdin`, timeout 3s), parseo del payload (`input.cwd`, `input.session_id`, `input.transcript_path`), correlación `findSession({ sessionId, cwd })` → `session.task_id`, y output JSON con `hookSpecificOutput`. **Modelo directo del contrato de captura D-04** (cómo el hook recibe payload y correlaciona con task_id).
- `src/hooks/stop.js` — segundo hook ya inyectado (referencia de patrón de hook kodo).
- `src/session/state.js` — `findSession` dual-scan (`state.sessions` + `state.history`): la correlación `session_id`/`cwd` → `task_id` que el contrato de captura reusaría (D-04).

### Reuso aguas abajo (Phase 46 si VIABLE)
- `.planning/phases/44-overlay-de-plan-gsd-pulido-de-dashboard/44-CONTEXT.md` — el overlay `mode:'overlay'` (snapshot congelado, `Esc` preserva cursor, never-throws) está **diseñado para reusarse** para sesiones no-GSD si Phase 46 procede. El contrato de captura (D-04) debe encajar con este overlay.

### Estado e invariantes
- `.planning/STATE.md` §"Critical Invariants to Preserve" — `findSession` dual-scan; TUI read-only salvo dismiss; cero endpoints nuevos. El contrato de captura debe honrarlos (la persistencia de Phase 46 no añade endpoints).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`installHooks()`/`addHook()`** (`src/hooks/install.js`): el hook de prueba temporal se instala con el mismo patrón (entrada en `~/.claude/settings.json` `hooks[event]`), y se desinstala con el filtro `command?.includes(...)`.
- **`readStdin()` + parseo de payload** (`src/hooks/session-start.js`): plantilla exacta de cómo un hook de kodo recibe y parsea el payload de Claude Code por stdin — la instrumentación del spike vuelca este mismo `input`.
- **`findSession({ sessionId, cwd })`** (`src/session/state.js`): la correlación sesión → `task_id` que el contrato de captura (D-04) reusaría tal cual; ya es dual-scan y never-throws.
- **Overlay `mode:'overlay'`** (Phase 44, `src/cli/dashboard/App.js`): consumidor de plano `lines[]` scrollable congelado, listo para reusarse en Phase 46 si el spike sale VIABLE.

### Established Patterns
- **Hooks kodo = best-effort, silent failure** (`session-start.js`: try/catch externo, "never break Claude Code startup"): el hook de captura de Phase 46 debe seguir el mismo contrato never-throws.
- **kodo persiste en su propio side, no en rutas internas de Claude Code** (correlación por `task_id`): principio rector del contrato de captura (D-04, D-07).

### Integration Points
- `~/.claude/settings.json` `hooks` — superficie donde se registra el hook de prueba (temporal) y donde Phase 46 registraría el hook de captura real (`PostToolUse`/equivalente), junto a los `SessionStart`/`Stop` existentes.
- El payload del hook (stdin) — la fuente de datos del spike: se inspecciona si contiene plan + correlación.

</code_context>

<specifics>
## Specific Ideas

- El spike es **empírico**: el documento debe contener el **comando exacto** lanzado y el **payload crudo** capturado (o la evidencia de su ausencia), no una conjetura. Un lector debe poder **reproducir** el experimento.
- El veredicto debe ser **binario y accionable** en la primera línea: el roadmapper/planner de Phase 46 lo lee para decidir ejecutar vs cortar a v2 — sin ambigüedad.
- Resultado plausible a anticipar (no pre-juzgar): bajo `--dangerously-skip-permissions` el gate de plan se evita, así que `ExitPlanMode` **podría no emitirse**; por eso D-02 incluye el barrido de eventos soportados como fallback antes de declarar INVIABLE.

</specifics>

<deferred>
## Deferred Ideas

- **Implementación de captura/persistencia del plan no-GSD** → Phase 46 (PLAN-04, condicional a este veredicto). Si VIABLE, implementa el contrato de D-04; si INVIABLE, se difiere a v2 (PLAN-F1/PLAN-F2) sin penalizar el cierre del milestone.
- **Parsear transcript JSONL / `~/.claude/plans/` / `~/.claude/todos/`** → fuera de scope permanente (formato no documentado/frágil); solo se reconsideraría si Claude Code publica un contrato estable.
- **Mostrar todos/Tasks en vivo** → v2 (PLAN-F2): sin fuente soportada.

None — la discusión se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 45-spike-captura-de-plan-no-gsd-v-a-hook*
*Context gathered: 2026-06-09*
</content>
</invoke>
