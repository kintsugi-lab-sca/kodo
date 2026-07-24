# Phase 80: Carril orquestador + reconciliación documental - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Mode:** --auto (decisiones auto-seleccionadas sobre la opción recomendada; constraints LOCKED de v0.18 y ratificaciones de Phase 79 respetados sin re-discutir)

<domain>
## Phase Boundary

Dos entregables acoplados por el mismo objetivo (el humano deja de mantener el sidebar):

1. **Carril orquestador (ORCH-07):** los pases de `kodo check` **ya motivados** (stuck/review/pending → `needsOrchestrator === true`) ejecutan además el carril fix del sidebar doctor. Un sidebar con workspaces sueltos o grupos vacíos converge en ≤1 pase sin intervención humana. El sidebar **NO** es trigger (constraint LOCKED): el resultado del doctor jamás motiva un pase ni lanza al orquestador; una sesión recién lanzada suelta se agrupa en el **siguiente** pase motivado (consistencia eventual asumida).
2. **Reconciliación documental (ORCH-08):** el skill `.claude/skills/kodo-orchestrate/skill.md` (canónico) y `src/orchestrator/prompt.md` (fallback degradado) mencionan `kodo sidebar doctor` y reflejan las features v0.17 hoy ausentes — handoff acumulativo + `NEXT:` (74), superficie dashboard/nudge (75), `pending_stale`/`pending_fetched_at` + convergencia de pending (76), agrupación `--group` (77). Misma disciplina anti-deriva que HYG-08 aplicó al README en v0.16: sin prometer features borradas, sin omitir las nuevas.

**Fuera de la fase:** cambios al motor del doctor (Phase 79, cerrada — `scan`/`execute` se consumen tal cual), saneo de deuda v0.17 (Phase 81, DEBT-01..04), sidebar como trigger, `workspace-group delete` (NI SE CABLEA), puerta LLM (FUT-03), triggers o endpoints nuevos.

</domain>

<decisions>
## Implementation Decisions

### Punto de invocación del piggyback
- **D-01:** El carril fix vive en `runCheckAndAct()` (`src/check.js`), **in-process** vía import directo de `scan`/`execute` (`src/cmux/sidebar-doctor.js`) — no un subproceso `kodo sidebar doctor --fix`. Cumple la semántica ORCH-07 ejecutando el mismo carril que el CLI, con determinismo garantizado (0 tokens: el LLM no participa), sin dependencia de PATH/argv, y espejo del patrón existente (check.js ya importa `launchOrchestrator` directamente).
- **D-02:** Alternativas descartadas: (a) instruir al LLM orquestador a shellear el fix en cada ronda — no determinista (depende de que el LLM lo recuerde), gasta tokens, incumple el criterio «converge en ≤1 pase» verificable; (b) dentro de `launchOrchestrator()` — se llama también desde `kodo orchestrate` manual y tiene early-return en la rama "already exists"; acoplar higiene al launch mezcla concerns. `kodo orchestrate` manual NO ejecuta el doctor (el carril es exclusivo de `kodo check`).

### Gating, orden y fallo dentro del pase
- **D-03:** Gate estricto: el doctor corre **solo** cuando `needsOrchestrator === true`. Un check «All clear» no lo ejecuta (success criterion 2: la sesión suelta espera al siguiente pase motivado).
- **D-04:** El resultado del doctor **jamás** se añade a `reasons` ni influye en `needsOrchestrator` — invariante «sidebar NO es trigger», verificable por test (un sidebar sucio con check limpio → ni doctor ni orquestador).
- **D-05:** Orden dentro del pase: doctor **antes** de `launchOrchestrator()` — el orquestador arranca con el sidebar ya convergido. Fail-open total: try/catch propio; un error del doctor loguea una línea (`[kodo:check] Sidebar doctor error: <msg>`) y nunca bloquea ni el check ni el launch (espejo del catch existente de `launchOrchestrator` en `runCheckAndAct`).
- **D-06:** Salida en stdout del check: línea(s) resumen deterministas con las acciones aplicadas (p. ej. `[kodo:check] Sidebar: N acción(es) aplicadas`); formato exacto a discreción, coherente con el prefijo `[kodo:check]` y `createFormatter`.

### Advisories (missing_group) en el carril
- **D-07:** El carril fix solo converge lo auto-arreglable per 79-04: `loose_workspace` → `add`, `empty_group` → `ungroup`. `missing_group` es advisory report-only — el carril **no crea ni ancla grupos** (ratificación 79-04 intacta; el doctor nunca ancla un grupo en una sesión kodo viva).
- **D-08:** Si `hasAdvisories`, el check emite una línea informativa (`[kodo:check] Sidebar advisories: N (acción de operador)`) sin convertirla en reason. Descartado: inyectar advisories en el `contextSummary` del launch — infla el prompt; el orquestador ya puede correr `kodo sidebar doctor` (dry-run) para diagnóstico bajo demanda.

### Reconciliación documental (reparto y profundidad)
- **D-09:** Reparto asimétrico coherente con la jerarquía existente: la **skill** (canónica) recibe el detalle — nuevo § de higiene del sidebar (el carril automático en `kodo check`, dry-run como herramienta de diagnóstico, advisories = acción de operador, allowlist no destructivo, launch path intacto) + un flujo 5 en §Diagnóstico («sidebar desalineado → `kodo sidebar doctor` dry-run → interpretar acciones/advisories»). El **prompt.md** (fallback degradado) recibe menciones concisas: una línea en el loop de supervisión + referencia a la skill.
- **D-10:** Features v0.17 a reflejar (criterio 3, en ambos docs con la profundidad que corresponda a cada uno): handoff acumulativo + `NEXT:` en `state.tasks` (74 — el orquestador puede leerlo como contexto de qué sigue en cada tarea), superficie del `NEXT:` en dashboard y nudge con contexto (75), `pending_stale`/`pending_fetched_at` + convergencia de pending con `kodo check` (76), agrupación `--group` de workspaces al lanzar (77).
- **D-11:** Disciplina anti-deriva (criterio 4): auditoría cruzada features↔docs en ambos sentidos como **checklist manual** en el plan/VERIFICATION (precedente HYG-08, v0.16 Phase 72) — no un test automático de docs. Cambios quirúrgicos: se corrige lo desfasado, no se reescriben los documentos enteros.
- **D-12:** El bloque `<!-- BEGIN/END reporting -->` de prompt.md y `applyReportingGate` no se tocan — la reconciliación no altera el mecanismo de gating ni `resolvePromptTemplate` (placeholders intactos).

### Claude's Discretion
Formato exacto de las líneas de log del check, eventos nuevos en `logger-events.js` si aplican (taxonomía existente), DI para testear `runCheckAndAct` (hoy sin DI — espejo de `checkPendingTasks` si hace falta), estructura de tests, y redacción exacta de las secciones nuevas de skill/prompt.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning (scope y constraints LOCKED)
- `.planning/ROADMAP.md` §Phase 80 — goal, success criteria 1-4, dependencia de Phase 79
- `.planning/REQUIREMENTS.md` §Carril orquestador (ORCH-07, ORCH-08) + §Out of Scope — sidebar no es trigger; `delete` ni se cablea
- `.planning/STATE.md` §Accumulated Context — constraints LOCKED de v0.18 + decisiones 79-04 (missing_group report-only, `hasActions`/`hasAdvisories`) + §Critical Invariants (cero endpoints nuevos, cero deps npm, launch path byte-idéntico, GRP-04 re-fronterizado)
- `.planning/phases/79-sidebar-doctor/79-CONTEXT.md` — decisiones D-01..D-15 de la fase que entrega el doctor que este carril consume

### Punto de inserción (carril check)
- `src/check.js` — `runCheck()` (construye `reasons`: stuck/review/pending) y `runCheckAndAct()` (punto de inserción del piggyback, catch existente de `launchOrchestrator` como espejo de fail-open)
- `src/orchestrator/launch.js` — `launchOrchestrator` (early-return "already exists", `buildContextSummary`), NO se modifica su lifecycle

### Doctor a consumir (Phase 79, no modificar el motor)
- `src/cmux/sidebar-doctor.js` — `scan(deps)` / `execute(deps, opts)`, categorías, `hasActions` (solo loose+empty) vs `hasAdvisories` (missing_group)
- `src/cli/sidebar-doctor.js` — CLI espejo con exit codes deterministas (referencia de semántica del carril fix)

### Documentos a reconciliar (ORCH-08)
- `.claude/skills/kodo-orchestrate/skill.md` — fuente canónica del comportamiento del orquestador (secciones: Proceso de inicio, Reglas, Sesiones GSD, Adopción, Diagnóstico, Lecciones)
- `src/orchestrator/prompt.md` — fallback degradado provider-templated (`{{provider}}`), bloque reporting gated — mantener su rol reducido

### Precedente de disciplina anti-deriva
- `.planning/milestones/v0.16-REQUIREMENTS.md` HYG-08 (Phase 72) — pasada anti-deriva del README: mismo estándar para skill/prompt

### Features v0.17 a reflejar (contexto para la reconciliación)
- `.planning/milestones/v0.17-ROADMAP.md` — qué entregó cada fase 74-78 (handoff+`NEXT:`, dashboard/nudge, pending, `--group`, saneo)
- `.planning/milestones/v0.17-phases/` — detalle por fase si el planner/executor necesita precisión de comportamiento

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scan`/`execute` de `src/cmux/sidebar-doctor.js` — motor completo con DI, never-throws, TOCTOU re-check; el carril solo lo invoca con los defaults de producción
- Patrón de import directo en `src/check.js` (`launchOrchestrator`, `fetchFreshPending`) — mismo estilo para el doctor
- `createFormatter` (`src/cli/format.js`) — color isolation para las líneas nuevas del check

### Established Patterns
- Fail-open per lane: el catch de `launchOrchestrator` en `runCheckAndAct` es el espejo exacto para el catch del doctor
- `checkPendingTasks` con DI por params — patrón de testabilidad si `runCheckAndAct` necesita inyección
- Disciplina HYG-08: auditoría manual features↔docs con checklist en VERIFICATION

### Integration Points
- `src/check.js:119` `runCheckAndAct()` — único punto que cambia en código (gate `needsOrchestrator` + doctor + launch)
- `.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md` — cambios solo documentales; `syncSkill` auto-propaga la skill a home en el próximo launch (mecanismo existente, no tocar)
- `state.json` sigue siendo solo-lectura para todo el carril (ningún escritor nuevo)

</code_context>

<specifics>
## Specific Ideas

- Origen (Backlog 999.3 → v0.18): el operador no quiere curar el sidebar a mano — la higiene debe «ir sola» aprovechando pases que ya ocurren. La fricción de crear grupos manualmente (caso OptiAI) se resolvió en 79; esta fase cierra el loop automatizando el disparo.
- El prompt.md declara explícitamente su jerarquía («la skill manda; prompt es fallback degradado») — la reconciliación debe preservar esa asimetría, no nivelarla.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (FUT-02 `kodo doctor --fix` asistido config↔projects y FUT-03 puerta LLM ya trazados en REQUIREMENTS §Future.)

</deferred>

---

*Phase: 80-Carril orquestador + reconciliación documental*
*Context gathered: 2026-07-23*
