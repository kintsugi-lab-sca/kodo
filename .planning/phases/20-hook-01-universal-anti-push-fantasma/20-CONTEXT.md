# Phase 20: HOOK-01 Universal Anti-Push-Fantasma - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Inyectar a TODAS las sesiones que kodo lanza vía `launchWorkItem` (full + quick + no-GSD) un recordatorio explícito de que kodo NO hace `git push` automático, instruyendo al agente a verificar push real o redactar en condicional las afirmaciones de deploy/publicación. Driver primario: ROMAN-125/126 — sesiones afirmando "deploy hecho" o "feature publicada" sin haber pusheado nada.

Cubierto por esta phase:
- **HOOK-01** — Bloque "Anti-push-fantasma" añadido a `buildSessionContext` (ES, no-GSD) y a `buildGsdContext` (EN, 3 ramas GSD: quick / phase / bootstrap).
- **HOOK-02** — Golden bytes preservados: el bloque se inserta como header propio AL FINAL del prompt (append puro), de modo que los bytes anteriores — incluyendo las tags `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]` emitidas por `buildContextSummary` en `src/orchestrator/launch.js` (sin overlap, ese módulo no se modifica) — quedan idénticos. Offset por modo = suma constante.
- **HOOK-03** — Test coverage: 4 escenarios (no-GSD + 3 ramas GSD) × `buildSessionContext`/`buildGsdContext`. Validar (a) presencia del bloque por modo, (b) golden bytes pre-Phase 20 preservados, (c) bloque al final con header determinista.

Fuera de scope (Phase 20):
- **Orchestrator (`src/orchestrator/prompt.md`, `launchOrchestrator`)** queda EXCLUIDO — D-05 (análogo a Phase 18 D-06). El orchestrator no escribe código ni hace deploy; supervisa sesiones, hace nudges via cmux y dispara `kodo gsd verify`. La incidencia ROMAN-125/126 fue una sesión de TRABAJO afirmando deploy, no el orchestrator.
- **Skill `kodo-orchestrate` (`.claude/skills/kodo-orchestrate/skill.md`)** queda EXCLUIDA — no se añade el recordatorio ahí. Es la fuente canonical del orchestrator (Phase 999.1), no de las sesiones de trabajo.
- **Verificación runtime de `git push`** — el recordatorio es instructivo, no enforcement. Ningún hook ni guard ejecuta `git rev-list @{u}..` ni similar. Defer a v0.7+ si surge necesidad.
- **Logging del evento `hook.anti_push.injected`** — no se añade NDJSON event. El bloque es estático y siempre presente (D-04), no hay state observable que necesite traza.
- **Migración retroactiva de sesiones legacy v0.5** vivas en `state.json` cuando se despliegue Phase 20 — el bloque se inyecta al startup del próximo `session-start`, no se backfillea historial.

Fuera de scope (otras phases v0.6):
- Skill sync CLI + auto-sync (Phase 21).
- Tech debt v0.5 closure (Phase 22).

</domain>

<decisions>
## Implementation Decisions

### Idioma del bloque (split agente vs humano-facing)

- **D-01:** Split idiomático preservado por Phase 8 D-04 + Phase 12 QUICK-07. Dos bloques distintos:
  - `buildSessionContext` (no-GSD, humano-facing en ES) → bloque ES con header `## Anti-push-fantasma`.
  - `buildGsdContext` (GSD, agente-Claude-facing en EN) → bloque EN con header `## No automatic push`.
  - Razón: el agente lee EN en flujos GSD (commands `/gsd-plan-phase`, `/gsd-quick`), el contexto no-GSD es prosa operativa en ES (criterios de cierre, estados Plane). Forzar idioma único rompería uno de los dos contratos. Decisión confirma el patrón actual sin reabrirlo.

### Rigor y contenido textual

- **D-02:** Máximo rigor: statement + instrucción + ejemplos correctos/incorrectos en cada bloque. Fraseo canonical (planner determinará bytes exactos; este es el contrato semántico):
  - **Statement:** "kodo NO hace `git push` automático." (ES) / "kodo does NOT push automatically." (EN)
  - **Instrucción:** "Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ('una vez se haga push…')." (ES) / equivalente en EN.
  - **Ejemplos correctos vs incorrectos:** mínimo 1 par "Bad: 'feature deployed' / Good: 'feature committed locally, pending push to remote'" (EN) y su análogo ES. Esto bloquea la paráfrasis de ROMAN-125/126 ("deploy hecho" sin push).
  - Bytes finales del fraseo: discreción del planner, pero debe contener: statement explícito + verbo "verifica/verify" + un par mal/bien.
- **D-02b:** Sin emojis ni énfasis ANSI; el bloque es texto plano markdown. Reglas: 1 H2 header, 1 párrafo statement+instrucción, 1 sub-bloque de ejemplos (lista o "Bad/Good:" prefijos). Total estimado 6–10 líneas por idioma.

### Posición del bloque

- **D-03:** Header propio al FINAL del array `lines` en cada builder. Construcción:
  - `buildSessionContext` (línea 23–68): tras el último item (línea 66: "Si no puedes terminar..."), append `''` + `'## Anti-push-fantasma'` + cuerpo + cierre.
  - `buildGsdContext` (línea 83–155): tras cada `lines.push(...)` final de cada rama (quick / phase / bootstrap), append el bloque EN común. Como las 3 ramas convergen al `return lines.join('\n')` (línea 154), el append común puede hacerse después del `if/else` (más DRY) — la decisión queda a discreción del planner siempre que el bloque salga ANTES del `return`.
  - **Invariante HOOK-02:** los bytes anteriores al header `##` añadido quedan idénticos. Verificable con golden snapshot capturado pre-Phase 20 (suite actual produce el render exacto sin el bloque; nuevo snapshot post-Phase 20 mantiene los primeros N bytes equivalentes).

### Granularidad por rama GSD

- **D-04:** Un único helper produce un único bloque ES y un único bloque EN. Las 3 ramas de `buildGsdContext` (quick / phase / bootstrap) reciben el MISMO bloque EN. No hay variantes por rama. Razón: el recordatorio es invariante semántico ("no hay push automático") — la rama GSD no cambia esa verdad. Tests HOOK-03 reducen a 2 golden bytes references (1 ES + 1 EN), aplicadas a 4 modos.
- **D-04b:** Helper recomendado: `buildAntiPushReminder(lang)` con `lang ∈ {'es', 'en'}`. Vive junto a los builders en `src/hooks/session-start.js` o se extrae a `src/hooks/anti-push.js` si el planner lo justifica por testing aislado. Preferencia: inline en `session-start.js` (mínima fricción, cero superficie de import nueva), helper si reduce duplicación entre los dos builders.

### Aplicar al orchestrator (decisión de scope)

- **D-05:** **EXCLUIDO de Phase 20** — `src/orchestrator/prompt.md` y `launchOrchestrator` (`src/orchestrator/launch.js:37`) NO reciben el recordatorio. Justificación:
  - El orchestrator no escribe código, no hace commits, no hace deploy. Supervisa sesiones (`cmux read-screen`, nudges via `cmux send`, lanzamiento de `kodo launch`, ejecución de `kodo gsd verify`).
  - La incidencia driver ROMAN-125/126 fue una sesión de TRABAJO (launchWorkItem) afirmando "deploy hecho", no el orchestrator.
  - El prompt del orchestrator es prosa operativa que apunta a la skill `kodo-orchestrate` para detalle. Inyectar el bloque ahí suma superficie sin reducir el riesgo originalmente detectado.
  - Si en el futuro emerge un caso donde el orchestrator parafrasea push falsos (ej. al redactar comentarios al provider), se abre un track separado. Análogo a Phase 18 D-06: exclusión documentada, blindada con assert en CONTEXT y opcionalmente con grep negativo en tests.

### Claude's Discretion

- **Bytes exactos del fraseo** (ES y EN) — el planner los redacta dentro del contrato semántico de D-02 (statement + instrucción + ejemplos). Preferencia: prosa concisa, evitar duplicar info (un statement, no tres).
- **Helper vs inline** — D-04b prefiere inline; el planner decide basándose en el costo de duplicación.
- **Comando exacto para golden snapshot** — el planner elige entre snapshot-files en `test/__snapshots__/` (canonical Node.js) o asserts inline string-by-string (patrón actual de `test/format-isolation.test.js`). Phase 12 QUICK-07 + Phase 14 D-07 (format-isolation) son referencias.
- **Helper aislado (`src/hooks/anti-push.js`)** — si el planner decide extraerlo, queda libre. Si no, inline en `session-start.js` (preferencia D-04b).
- **Ejemplo concreto par "Bad/Good"** — el planner redacta los pares ES y EN respetando el contrato semántico de D-02.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap, requirements, estado

- `.planning/ROADMAP.md` §"Phase 20: HOOK-01 Universal Anti-Push-Fantasma" — goal canónico + 3 Success Criteria (presencia por modo, golden bytes invariante, posición determinista).
- `.planning/REQUIREMENTS.md` §"HOOK-01 universal (HOOK-*)" — HOOK-01, HOOK-02, HOOK-03 (scope de Phase 20).
- `.planning/STATE.md` — Open Questions §"¿HOOK-01 universal altera bytes del prompt en sesiones GSD?" → cubierto por SC#2 golden bytes invariante (D-03).
- `.planning/PROJECT.md` §"Current Milestone: v0.6" — driver ROMAN-125/126 + Constraint Phase 999.1 cwd=repo (preservada por exclusión D-05 del orchestrator).

### Phase 12 (precedente directo: golden bytes + idioma split)

- `.planning/milestones/v0.4-phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md` — decisiones de bifurcación `buildGsdContext` + nudges stop hook. Phase 20 NO reabre la bifurcación; añade SOLO el bloque anti-push al final.
- Phase 8 D-04 + Phase 12 QUICK-07 — invariante idioma split (agente EN en GSD, humano-facing ES). Phase 20 D-01 lo preserva.
- Phase 12 QUICK-07 — golden bytes test sobre `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` (en `buildContextSummary` de `src/orchestrator/launch.js`). Phase 20 NO toca `buildContextSummary` — los tags se preservan por construcción.

### Phase 18 + 19 (precedente: exclusión orchestrator)

- `.planning/phases/18-worktree-runtime-wiring/18-CONTEXT.md` D-06 — orchestrator EXCLUIDO de worktree por necesidad de cwd=repo. Phase 20 D-05 sigue el mismo patrón (exclusión documentada + razón explícita).
- `.planning/phases/19-worktree-cleanup-integration/19-CONTEXT.md` D-05 — confirma "satisfied-by-design" para subsistemas que ya están en el cwd correcto. Phase 20 D-05 es la equivalencia: orchestrator excluido porque su superficie no es la fuente del riesgo.

### Código a modificar (source-of-truth de comportamiento actual)

- `src/hooks/session-start.js:23–68` (`buildSessionContext`) — sitio principal #1. Añadir bloque ES al final del array `lines` antes del `return ...join('\n')`.
- `src/hooks/session-start.js:83–155` (`buildGsdContext`) — sitio principal #2. Añadir bloque EN común a las 3 ramas (quick / phase / bootstrap). Preferencia: append común después del `if/else` (línea ~152, antes del `return`).
- `src/hooks/session-start.js:184–186` (`main()` despacho) — NO se modifica: el ternario `session.gsd ? buildGsdContext : buildSessionContext` ya cubre los 3 modos GSD + no-GSD.
- `src/orchestrator/launch.js:128–157` (`buildContextSummary`) — NO se modifica (D-05 EXCLUIDO).
- `src/orchestrator/prompt.md` — NO se modifica (D-05 EXCLUIDO).

### Código a leer (sin modificar) — referencia de patrones

- `src/labels.js` (`getSessionMode`) — usado por `buildGsdContext:96` para discriminar `quick` vs otras ramas. Phase 20 no consume `getSessionMode` directamente porque el bloque es común a las 3 ramas (D-04).
- `test/format-isolation.test.js` — referencia de patrón source-hygiene (grep + walker) si el planner decide blindar la existencia del bloque con un test estático.
- `test/dispatcher-isolation.test.js` (Phase 16) — referencia comment-aware grep para distinguir runtime literals de comentarios históricos.

### Convenciones del proyecto

- `.planning/codebase/CONVENTIONS.md` — estilo tests (`tmpdir+HOME override` no aplica aquí: los builders son puros sin I/O), source-hygiene asserts.
- `.planning/codebase/ARCHITECTURE.md` §"Claude Code Hooks" — `src/hooks/session-start.js` es la frontera de inyección de contexto.

### Incidencia driver

- ROMAN-125 / ROMAN-126 (driver primario de HOOK-01) — sesiones afirmando "deploy hecho" / "feature publicada" sin haber pusheado al remoto. Phase 20 lo bloquea por construcción: el agente lee el recordatorio en TODAS las sesiones lanzadas por kodo y debe verificar push real o redactar en condicional.
- Memoria `kodo_session_scope_creep.md` — patrón recurrente de usuario: revisar TODOS los commits ahead de origin, no solo HEAD, antes de pushear. Phase 20 es la contraparte automatizada: el agente no afirma "pushed" sin haberlo hecho.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `buildSessionContext(session, config)` en `src/hooks/session-start.js:23` — pure function, sin I/O, devuelve string. Ideal para append directo al final del array `lines` antes del `.join('\n')` (línea 67).
- `buildGsdContext(session, opts)` en `src/hooks/session-start.js:83` — pure function, 3 ramas internas (`quick` / `phase` / `bootstrap`) que convergen en `return lines.join('\n')` (línea 154). El append común post-if/else aprovecha la convergencia: 1 sola inserción cubre las 3 ramas (D-04 simplificación).
- `getSessionMode(session)` en `src/labels.js` — existente, no requiere consumirse en Phase 20 (el bloque es común a las 3 ramas GSD; el mode discrimina es ortogonal al bloque anti-push).
- Patrón de tests "pure builder with golden string assertion" — usado en Phase 12 (`test/hook-session-start.test.js` o similar; el planner localiza el archivo exacto). Reusable directamente: importa el builder, llama con session fixture, asserta `includes('Anti-push-fantasma')` o snapshot.

### Established Patterns

- **Pure builders sin I/O** — `buildSessionContext` y `buildGsdContext` son puros. Phase 20 mantiene la pureza: el nuevo bloque (o helper `buildAntiPushReminder(lang)`) no introduce I/O ni globals.
- **Idioma split (ES humano / EN agente)** — Phase 8 D-04 + Phase 12 QUICK-07. Phase 20 D-01 lo respeta.
- **Append final como estrategia de bytes-preserving** — análogo a cómo Phase 16 emit-before-mutation no altera bytes pre-emit. Phase 20 D-03 lo aplica: append al final = bytes anteriores intactos = HOOK-02 satisfied by construction.
- **Helper aislado opcional** — Phase 14 `src/cli/format.js` (factory pattern), Phase 18 `computeWorktreePath` en `src/session/state.js`. Phase 20 D-04b deja la decisión al planner: inline o helper aislado en `src/hooks/anti-push.js`.
- **Single-source-of-truth tests** (Phase 15 D-08, Phase 16 LOG-15) — si Phase 20 extrae `buildAntiPushReminder`, el planner puede añadir un source-hygiene test (grep) verificando que ambos builders lo consumen, no inline.

### Integration Points

- `src/hooks/session-start.js:184–186` — punto único de despacho. El ternario `session.gsd ? buildGsdContext(...) : buildSessionContext(...)` ya rutea los 3 modos GSD + no-GSD. Phase 20 NO toca el despacho — modifica los 2 builders solamente.
- `src/orchestrator/launch.js:128` (`buildContextSummary`) — NO se modifica (D-05). Las tags `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` quedan idénticas porque ese módulo no entra en scope.
- Tests existentes de `buildGsdContext` (Phase 12 + Phase 13 QUICK-08 coverage matrix) — extender con asserts del bloque anti-push en cada rama. Las 4 entradas de la matriz (full / quick / no-GSD / bootstrap) ya tienen fixtures preparadas; reusarlas para HOOK-03.

</code_context>

<specifics>
## Specific Ideas

- Driver concreto: ROMAN-125 / ROMAN-126 — sesiones que afirmaron "deploy hecho" / "feature publicada" sin haber pusheado al remoto. El usuario detectó el patrón al revisar git log vs estado remoto. Phase 20 lo bloquea por inyección de contexto explícito (no por enforcement runtime — el enforcement queda como deferred).
- El bloque debe ser CLARO ante un agente que parafrasee — no basta con un statement abstracto. Ejemplos "Bad: 'feature deployed' / Good: 'feature pushed locally, pending push to remote'" son la forma más quirúrgica de bloquear la paráfrasis (D-02).
- Phase 20 prefiere "instrucción explícita + ejemplos" sobre "informacional minimalista" porque ROMAN-125/126 demostró que el agente NO infiere la implicación del statement solo. El costo de los ~6–10 líneas extra por idioma es despreciable en un prompt que ya tiene 60+ líneas de contexto.
- Patrón cohesivo con resto de v0.6: cada phase añade UN bloque defensivo (Phase 18 worktree isolation, Phase 19 cleanup fail-open, Phase 20 anti-push reminder). Ninguno introduce enforcement runtime — todos son construcciones defensivas que reducen la superficie de error sin requerir vigilancia continua.
- Orchestrator excluido (D-05) cohesivo con Phase 18 D-06: el orchestrator es un agente meta cuya superficie es supervisión, no producción. Las decisiones de exclusión se acumulan: si en v0.7+ emerge un riesgo en el orchestrator, se evaluará en su propio track.

</specifics>

<deferred>
## Deferred Ideas

- **Enforcement runtime de `git push` verification** — un guard que ejecute `git rev-list @{u}..` en el stop hook y rechace cerrar la sesión si el agente afirmó "deploy" sin haber pusheado. Costoso (parsing del transcript, definición de "afirmar deploy"), no necesario para la primera línea de defensa. Defer a v0.7+ si Phase 20 + observación humana no resuelven el patrón.
- **NDJSON event `hook.anti_push.injected`** — observabilidad de que el bloque se insertó. El bloque es estático y siempre presente (D-04), no hay state observable que necesite traza. Defer indefinidamente.
- **Recordatorio anti-push en orchestrator prompt.md** — D-05 lo excluye explícitamente. Reabrir SOLO si emerge un caso donde el orchestrator parafrasea push falsos al redactar comentarios al provider o nudges a sesiones.
- **Recordatorio anti-push en la skill `kodo-orchestrate`** — defer cohesivo con D-05. Si Phase 21 (skill sync) reabre el contrato de la skill, evaluar ahí si añadirlo.
- **Variantes por rama GSD** (quick / phase / bootstrap textos distintos) — D-04 lo descartó. Reabrir SOLO si el operador detecta que una rama necesita énfasis especial (ej. quick con "no PR/no push by design"). Hasta entonces, bloque común.
- **Localización dinámica (i18n)** — si el agente en el futuro necesita ES en flujos GSD o EN en no-GSD (ej. operador no-hispanohablante), evaluar `buildAntiPushReminder(lang)` consumiendo config. Hoy no aplica: idioma derivado del builder, no de config.
- **Bytes-deterministic test infra** (snapshot files en `test/__snapshots__/`) — Phase 20 puede usar asserts inline o snapshot files. Si Phase 21+ acumula más golden bytes tests, considerar consolidar en snapshot infra estilo Jest. Defer cosmético.

### Reviewed Todos (not folded)

No hubo todos cross-referenced en esta sesión (`gsd-sdk query todo.match-phase 20` → `matches: []`).

</deferred>

---

*Phase: 20-hook-01-universal-anti-push-fantasma*
*Context gathered: 2026-05-12*
