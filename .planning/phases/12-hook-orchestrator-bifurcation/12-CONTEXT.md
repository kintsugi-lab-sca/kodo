# Phase 12: Hook & Orchestrator Bifurcation - Context

**Gathered:** 2026-04-28
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 12 cierra el control-plane de `kodo:gsd-quick`: bifurcar los 3 puntos de lectura del modo (`buildGsdContext` en `src/hooks/session-start.js`, `buildStopNudgeText` en `src/hooks/stop.js`, `buildContextSummary` en `src/orchestrator/launch.js`) según `getSessionMode(session)` para que (1) el agente reciba `/gsd-quick "<title>"` en vez de la cadena `plan/execute/verify` o `new-project`, (2) el orchestrator NO sugiera `kodo gsd verify` y pida revisión manual, (3) la pizarra emita `[GSD quick]` además de `[GSD phase N]` y `[GSD bootstrap]`, y (4) la sección `## Sesiones GSD` de `prompt.md` aclare la excepción quick. Cubre QUICK-05, QUICK-06, QUICK-07.

**No incluye** (Phase 11): persistencia de `gsd_mode`, helper `getSessionMode`, telemetría dispatcher con campo `mode`, skip-perms parity. Todo eso ya está shipped.
**No incluye** (Phase 13): matriz de tests cross-cutting de los 4 estados de label en los 4 puntos de la cadena.
**No incluye** (out of scope per REQUIREMENTS): nuevos eventos NDJSON específicos para quick, cambios al slash command `/gsd-quick`, lectura programática de `VERIFICATION.md` para quick.

</domain>

<decisions>
## Implementation Decisions

### SessionStart hook quick branch (QUICK-05)

- **D-01:** `buildGsdContext` mantiene un único header `# kodo TASK-X — GSD Mode` para los tres casos (full+phase, full+bootstrap, quick). El modo se distingue por el contenido del bloque, no por el título. Reduce branching de strings y mantiene simetría con el patrón Phase 9 D-11.
- **D-02:** La sección interna se llama `## GSD Workflow` también en quick. Mismo header que las dos ramas full — sólo cambia la frase explicativa y el comando inyectado.
- **D-03:** Cuando `getSessionMode(session) === 'quick'` y `session.brief` existe (caso quick+bootstrap, donde el dispatcher persistió el brief vía `buildBriefFromTask`), el brief se renderiza FIRST y el comando `/gsd-quick` AFTER. Simétrico con D-11 Phase 9 (brief antes que comando en bootstrap). En quick+match el brief no existe (el dispatcher no lo persiste cuando hay phase match) — render salta directamente al comando.
- **D-04:** El comando inyectado tiene la forma `1. \`/gsd-quick "<safe-title>"\`` donde `<safe-title>` = `session.summary.replace(/"/g, "'")`. Reemplazo simple comilla-doble → comilla-simple antes de envolver en comillas dobles. Razón: títulos Plane raramente usan comillas estratégicamente; el slash command parser de Claude Code interpreta backslash escapes inconsistentemente; reemplazo es predecible y no rompe el parse.
- **D-05:** El branch quick añade una frase de cierre tipo "This is a one-shot GSD session. Run the slash command and finish — no plan/execute/verify cycle." Justifica por qué el bloque tiene un solo comando en vez de tres. Mantiene el idioma EN del hook (D-04 Phase 8).
- **D-06:** Estructura del switch en `buildGsdContext`: `if (mode === 'quick') { … } else if (session.phase_id) { … plan/execute/verify … } else { … brief + new-project … }`. Quick gana sobre phase_id. Si por error una sesión quick tuviera `phase_id` residual (no debería, dispatcher lo descarta), el branch quick lo ignora correctamente.

### Stop hook nudge quick branch (QUICK-06)

- **D-07:** `buildStopNudgeText` se reorganiza con `switch (getSessionMode(session))` exhaustivo: `case 'quick'` (texto nuevo), `case 'full'` (texto Phase 10 D-04 con phase_id ternary), `default` (texto no-GSD original). Más limpio que if/else anidado y simétrico con el patrón D-09 Phase 11.
- **D-08:** Texto del case quick (idioma ES preservado per D-16 Phase 10): `"La sesión TASK-X (summary) ha terminado y está en Review. Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n"`. Da contexto al orchestrator de por qué NO ejecuta verify, y enlaza visualmente con el párrafo de `prompt.md` (D-13).
- **D-09:** El nudge quick NO sugiere acciones adicionales (convertir a fase, abrir nueva task con `kodo:gsd`, etc.). Quick es deliberadamente liviano. KISS.
- **D-10:** Lock release queda inalterado. El bloque `if (session.gsd)` en `stop.js:127` ya cubre quick correctamente (`session.gsd === true` para ambos modos por D-04 Phase 11). NO se toca.

### Orchestrator tag switch (QUICK-07)

- **D-11:** En `buildContextSummary` (`src/orchestrator/launch.js:122`), el cómputo del `gsdTag` cambia de:
  ```js
  const gsdTag = s.gsd ? ` \`[GSD ${s.phase_id ? `phase ${s.phase_id}` : 'bootstrap'}]\`` : '';
  ```
  a una variante con prioridad mode-first:
  ```js
  let gsdTag = '';
  if (s.gsd) {
    const mode = getSessionMode(s);
    const inner = mode === 'quick' ? 'quick' : (s.phase_id ? `phase ${s.phase_id}` : 'bootstrap');
    gsdTag = ` \`[GSD ${inner}]\``;
  }
  ```
  Mode primero garantiza que una sesión quick con `phase_id` residual (no debería existir, dispatcher lo descarta — defensa en profundidad) renderice `[GSD quick]` y no `[GSD phase N]`.
- **D-12:** El cómputo del tag queda inline en `buildContextSummary`. NO se extrae a un helper exportable (`buildGsdTag(session)` etc.) — un solo callsite, YAGNI. Si Phase 13 necesita testearlo aislado, se extrae entonces.
- **D-13:** Sesiones no-GSD (`gsd === false` o ausente) siguen sin tag (cadena vacía). Status quo Phase 10 D-19 preservado. NO se introduce `[no-GSD]` ni similar — fuera del scope de QUICK-07.

### Sección `## Sesiones GSD` en prompt.md (QUICK-07 párrafo)

- **D-14:** Patch incremental: los 4 pasos numerados del flujo full (lee artefactos / ejecuta verify / actúa / debug previo) y el cierre "No dupliques el gate" se preservan literalmente. Diff mínimo, riesgo bajo de romper redacción probada de Phase 10.
- **D-15:** Se inserta UN solo párrafo nuevo al final de la sección (después de "**No dupliques el gate en comentarios manuales.** … supervisión."). Lectura natural: primero el modo principal (full), después la excepción (quick). Mantiene la cadencia h2 sin sub-secciones h3.
- **D-16:** Contenido del párrafo quick (idioma ES per D-16 Phase 10) — incorpora identificación + exclusión + acción + justificación:
  > **Sesiones quick.** Las sesiones lanzadas por `kodo:gsd-quick` aparecen en la pizarra como `[GSD quick]`. Son one-shot (sin `VERIFICATION.md`), por eso **NO ejecutes `kodo gsd verify`** sobre ellas — el CLI no las soporta. Revísalas manualmente como cualquier sesión no-GSD: lee el comentario final del agente, valida en {{provider_name}} y decide si pasa a Done o necesita más trabajo.
- **D-17:** El párrafo usa `{{provider_name}}` como placeholder existente (resuelto por `resolvePromptTemplate`) — no introduce nuevos placeholders ni hardcodea "Plane".

### Claude's Discretion

- Naming exacto de variables locales en cada función (`mode`, `gsdMode`, `inner`, `safeTitle`): a decidir en planning siguiendo convenciones existentes del archivo.
- Granularidad de plans: ¿4 plans (uno por punto de bifurcación) o 2 plans (hooks juntos + orchestrator+prompt juntos)? Decidir en `/gsd-plan-phase 12`.
- Orden exacto de las líneas dentro del bloque quick de `buildGsdContext` (qué frase va antes del comando, dónde se renderiza el cierre D-05): Claude elige siguiendo D-11 Phase 9 (brief FIRST, comando AFTER).
- Si el escape de title (D-04) se inline en el sitio o se extrae a una constante local: Claude elige por legibilidad.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Especificación de la fase
- `.planning/ROADMAP.md` §"Phase 12: Hook & Orchestrator Bifurcation" — goal, success criteria 1-4, requirements QUICK-05..07
- `.planning/REQUIREMENTS.md` §"v0.4 Requirements" QUICK-05, QUICK-06, QUICK-07 — contratos exactos de hook bifurcation, stop semantics, orchestrator visibility
- `.planning/PROJECT.md` §"Current Milestone: v0.4 GSD Quick Mode" — motivación, target features
- `.planning/STATE.md` §"Open Questions" — la pregunta sobre alcance del cambio en `## Sesiones GSD` queda resuelta por D-14/D-15 (patch incremental, párrafo al final)

### Decisiones de Phase 11 que Phase 12 consume directamente
- `.planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md` §"Implementation Decisions" — D-08 (legacy gsd:true == 'full'), D-09 (`getSessionMode(session)` exportado desde `src/labels.js`), D-10 (helper testeable aislado, Phase 12 es el primer consumer)

### Decisiones carry-forward de v0.3 (relevantes para Phase 12)
- D-04 Phase 8 (session-start hook en EN, prompt orchestrator en ES) — la rama quick del hook sigue EN, el nudge y el párrafo de prompt.md siguen ES
- D-19 Phase 10 (taggear sesiones GSD en `buildContextSummary`) — Phase 12 extiende con tercer caso `[GSD quick]`
- D-04 Phase 10 (`buildStopNudgeText` con bloque GSD apuntando a `kodo gsd verify`) — Phase 12 lo refactora a switch exhaustivo
- D-11 Phase 9 (brief FIRST, comando AFTER en bootstrap) — patrón replicado en quick branch

### Código a modificar
- `src/hooks/session-start.js:82` — `buildGsdContext`: añadir branch `if (mode === 'quick')` antes del actual `if (session.phase_id)` (D-01..D-06)
- `src/hooks/session-start.js:5` — añadir `getSessionMode` al import de `../labels.js`
- `src/hooks/stop.js:39` — `buildStopNudgeText`: refactor a `switch (getSessionMode(session))` con tres cases (D-07, D-08, D-09)
- `src/hooks/stop.js:14` — añadir import de `getSessionMode` desde `../labels.js`
- `src/orchestrator/launch.js:122` — cómputo de `gsdTag` con prioridad mode-first (D-11, D-12, D-13)
- `src/orchestrator/launch.js:7` — añadir import de `getSessionMode` desde `../labels.js`
- `src/orchestrator/prompt.md:88` — insertar párrafo nuevo al final de la sección `## Sesiones GSD` (D-14, D-15, D-16, D-17)

### Helper de Phase 11 que se consume
- `src/labels.js` `getSessionMode(session)` — única fuente de la regla "ausente == full" (D-08 Phase 11). Phase 12 NO duplica esa lógica inline en ningún callsite.

### Commits de referencia
- Phase 11 (commits 7cd4b2d, e935a3d, 2f65f71) — `getSessionMode`, `gsd_mode` persistido, dispatcher telemetry con `mode`. Phase 12 lee `gsd_mode` del SessionRecord persistido por estos commits.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`getSessionMode(session)`** en `src/labels.js:82`: helper exportado por Phase 11 (D-09) que aplica la regla "ausente == full". Phase 12 lo usa en los 3 callsites (session-start, stop, launch) — NO duplica la lógica inline.
- **`buildGsdContext(session, opts)`** en `src/hooks/session-start.js:82`: patrón actual de branch por `session.phase_id`. Phase 12 añade un primer branch por `mode === 'quick'` antes.
- **`buildStopNudgeText(session)`** en `src/hooks/stop.js:39`: patrón actual `if (session.gsd) { phase_id ternary } else { … }`. Phase 12 lo refactora a switch exhaustivo.
- **`buildContextSummary(sessions, config)`** en `src/orchestrator/launch.js:108`: cómputo inline de `gsdTag` con ternary. Phase 12 amplía a switch mode-first.
- **`session.brief`** en `Session` typedef (`src/session/state.js`): persistido por `buildSessionFromTask` cuando dispatcher entra en bootstrap branch. Disponible en quick+bootstrap; ausente en quick+match.
- **`{{provider_name}}` placeholder** en `prompt.md`: resuelto por `resolvePromptTemplate` en `launch.js:21`. Phase 12 lo reusa en el párrafo nuevo (D-17), no introduce placeholders nuevos.

### Established Patterns
- **"Helper en labels.js + consumer downstream"** — D-12 Phase 8 + D-09 Phase 11: una función exporta la regla, todos los consumers la importan. Phase 12 sigue este patrón sin desviación.
- **"Brief FIRST, comando AFTER en bootstrap"** — D-11 Phase 9: en `buildGsdContext`, render brief antes del comando. Phase 12 replica en quick (D-03).
- **"Idioma EN para hooks que escribe el agente; ES para texto que lee el orchestrator/humano"** — D-04 Phase 8 + D-16 Phase 10: session-start.js EN (lo lee Claude), stop.js nudge ES (lo lee orchestrator humano), prompt.md ES (orquestador). Phase 12 preserva.
- **"Switch exhaustivo sobre helper de modo"** — patrón nuevo introducido por D-07 Phase 12: `switch (getSessionMode(session)) { case 'quick': …; case 'full': …; default: … }`. Phase 13 testeará los 4 estados sobre este patrón.
- **"Inline computation hasta que YAGNI exija extracción"** — D-12 Phase 12: el tag se computa inline, se extrae sólo cuando hay 2+ callsites.

### Integration Points
- **`session-start.js → labels.js`**: import existente de `findSession` desde `../session/state.js`. Phase 12 añade `getSessionMode` al import del módulo `../labels.js` (no existe aún en este archivo).
- **`stop.js → labels.js`**: hoy NO importa de `../labels.js`. Phase 12 introduce el primer import: `import { getSessionMode } from '../labels.js';`.
- **`launch.js → labels.js`**: hoy NO importa de `../labels.js`. Phase 12 introduce el primer import: `import { getSessionMode } from '../labels.js';`.
- **`prompt.md → launch.js`**: el párrafo nuevo (D-16) usa `{{provider_name}}` que `resolvePromptTemplate` ya sabe resolver. Sin cambios en `launch.js` para el placeholder.

</code_context>

<specifics>
## Specific Ideas

- El branch quick de `buildGsdContext` lee `getSessionMode(session)` antes del switch sobre `phase_id`. Dado que `session.gsd` es true cuando `gsd_mode` está set (D-04 Phase 11), `getSessionMode` devuelve `'full'|'quick'` deterministamente para sesiones que llegan a `buildGsdContext` (la entrada en `main()` ya filtra: `session.gsd ? buildGsdContext(...) : buildSessionContext(...)`). El branch `default` del switch en stop.js gestiona el caso no-GSD donde `getSessionMode` devuelve `null`.
- En el nudge quick (D-08), preservar el formato `\\n` final (escape literal). Razón: `cmux.send` interpreta el `\\n` para enviar el carácter Enter — sin él, el agente no recibe el comando como input completo. Patrón establecido en stop.js Phase 10 D-04.
- Usar `getSessionMode(session)` en lugar de `session.gsd_mode` directo en los 3 callsites — incluso cuando "sabemos" que `gsd_mode` está set. Razón: el helper aplica la regla "legacy gsd:true sin gsd_mode == full" (D-08 Phase 11). Sesiones legacy persistidas pre-v0.4 leen como `'full'` automáticamente. Inline `session.gsd_mode || 'full'` es una micro-violación de DRY que Phase 11 specíficamente prohibió.
- El reemplazo de comillas en title (D-04) se aplica SÓLO en el branch quick. Las ramas full (phase y bootstrap) no inyectan título de task en el comando — siguen usando `phase_id` numérico — así que no necesitan escape.
- El párrafo de `prompt.md` (D-16) usa **negrita** sólo en "**Sesiones quick.**" inicial y en "**NO ejecutes `kodo gsd verify`**". Mantiene la economía visual del resto de la sección donde sólo "**No dupliques…**" lleva negrita.

</specifics>

<deferred>
## Deferred Ideas

### A Phase 13 (Test Coverage Matrix)
- `test/session-start.test.js` rama quick: assert que `buildGsdContext({...session, gsd_mode:'quick', summary:'TASK-X'}, {})` contiene `/gsd-quick "TASK-X"` y NO contiene `/gsd-plan-phase` ni `/gsd-execute-phase` ni `/gsd-verify-work` ni `/gsd-new-project`.
- `test/session-start.test.js` quick+bootstrap con brief: assert que el brief precede al comando.
- `test/session-start.test.js` escape de comillas: title `'TASK-X "with quotes"'` produce `/gsd-quick "TASK-X 'with quotes'"`.
- `test/stop.test.js` (si existe) o test nuevo para `buildStopNudgeText`: assert los tres cases del switch (quick → "GSD quick (one-shot…)", full+phase → "kodo gsd verify", full+bootstrap → "kodo gsd verify", default → texto original no-GSD).
- `test/launch.test.js` `buildContextSummary`: assert que las 3 etiquetas se renderizan correctamente según modo + phase_id.
- Sesiones legacy con `gsd:true` sin `gsd_mode`: deben leer como full y NO romper ningún branch.

### A futuras milestones (v0.5+)
- Variantes adicionales de quick (e.g., `kodo:gsd-quick-research` para sesiones research-only): hoy YAGNI, el patrón D-07 (switch sobre `getSessionMode`) ya lo permite con un nuevo case.
- Helper `buildGsdTag(session)` exportado: si v0.5 introduce un segundo callsite, se extrae entonces (D-12).
- Lectura programática de un `QUICK-NOTES.md` o similar producido por la sesión quick: hoy out-of-scope per REQUIREMENTS, quick es one-shot sin artefacto verificable.

### Out of Scope (REQUIREMENTS)
- Slash command `/gsd-quick` en sí (existe en `~/.claude/skills/`, no se toca).
- Migración programática de sesiones legacy en `state.json` — la regla "ausente == full" (D-08 Phase 11) cubre la lectura sin reescribir.
- Nuevos eventos NDJSON para quick (e.g., `gsd.quick.start`). Reusamos los 8 tipos existentes con campo `mode` añadido en Phase 11.

### Reviewed Todos
None — `gsd-tools todo match-phase 12` devolvió 0 matches.

</deferred>

---

*Phase: 12-hook-orchestrator-bifurcation*
*Context gathered: 2026-04-28*
