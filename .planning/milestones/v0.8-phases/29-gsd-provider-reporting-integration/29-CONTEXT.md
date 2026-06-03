# Phase 29: GSD Provider Reporting Integration - Context

**Gathered:** 2026-05-20
**Status:** Ready for planning
**Mode:** `--auto` (all gray areas resolved with recommended defaults; see DISCUSSION-LOG.md for per-question log)

<domain>
## Phase Boundary

Cerrar la cadena de visibilidad GSD → proveedor reutilizando los 9 commits de código y 38 tests heredados de la rama paralela `gsd-provider-reporting` (HEAD `cb28994`, 35 commits sobre `ad2cd88`). Diseño **instruction-driven**: kodo NO crea/lee/borra issues — solo blinda anti-recursión (`kodo:gsd-child`) y opt-in gating (`workflow.report_to_provider`). El agente Claude (vía sus MCP propios) crea sub-issues por phase con label `kodo:gsd-child` y comenta plan-by-plan en el sub-issue.

**Touch surface (cherry-pick selectivo):**
- `src/labels.js` — añadir `KODO_LABEL_GSD_CHILD` + `isGsdChild(labels)` helper (5a41d8f)
- `src/triggers/dispatcher.js` — filtro anti-recursión ANTES de `parseKodoLabels`/lock/resolver/launch (cbd8f9c)
- `src/config.js` — `isReportToProviderEnabled()` strict equality + DI opcional (e1f82c9)
- `src/orchestrator/prompt.md` — markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->` + prosa ES provider-agnostic (7c28c06 + d030547)
- `src/orchestrator/launch.js` — `applyReportingGate(prompt, enabled)` pure helper + wire-up (5feb578)
- `test/dispatcher.test.js`, `test/config.test.js`, `test/labels.test.js`, `test/orchestrator/launch.test.js` — 38 tests heredados via cherry-pick

**Re-genera (numeración v0.8 = Phase 29, NO Phase 14-15 del branch que colisionaría con v0.5 main):**
- `.planning/phases/29-gsd-provider-reporting-integration/29-{01..04}-PLAN.md` + SUMMARY equivalentes
- `.planning/phases/29-gsd-provider-reporting-integration/VERIFICATION.md` (phase-level, único)

**Out of scope (delegado a otras phases):**
- ROMAN-132 state.json desync ↔ cmux → Phase 30 (LIFE-01/02)
- syncSkill/runSkillSyncCli/launchOrchestrator advisory → Phase 31
- v0.7 doc bookkeeping (REQUIREMENTS traceability + nyquist toggle) → Phase 32

Cero adapters nuevos, cero capacidades nuevas. Pura integración de trabajo terminado.

</domain>

<decisions>
## Implementation Decisions

### Cherry-pick scope + orden (REPORT-06)

- **D-01 [auto]:** Aplicar los 9 SHAs de código documentados en `.planning/PENDING-INTEGRATIONS.md` en orden cronológico exacto: `5a41d8f` → `cbd8f9c` → `e1f82c9` → `7c28c06` → `5feb578` → `38c7a2e` → `d030547` → `4d67312` → `81c848c`. **NO** se mergea la rama directamente — los `.planning/` del branch (numeración Phase 14-15) chocarían con v0.5 main archive. Cherry-pick selectivo + planning regen manual es la vía limpia documentada.
- **D-02 [auto]:** Cherry-pick se aplica sobre `main` post-Phase-28 (baseline actual: commit `29875d5`, suite 806 pass + 1 skip + 0 fail). NO rebase de la rama. El branch `gsd-provider-reporting` se preserva intacto como audit trail.
- **D-03 [auto]:** Cherry-pick **plan-by-plan**, no en bloque único. Cada plan de Phase 29 aplica su cluster de SHAs + verifica suite verde antes del próximo plan. Si un cherry-pick produce conflicto, se resuelve manualmente preservando la evolución de `main` (e.g., `dispatcher.js` puede haber evolucionado entre Phase 8 GSD y la rama divergida).

### Decomposición en plans (REPORT-01..06)

- **D-04 [auto]:** **4 plans** mapeando los clusters naturales de commits de la rama:
  - **29-01 — Anti-recursion foundation** (REPORT-01, REPORT-05): `5a41d8f` (KODO_LABEL_GSD_CHILD + isGsdChild + 9 tests) + `cbd8f9c` (dispatcher filter + 6 tests). 15 tests heredados.
  - **29-02 — Opt-in config helper** (REPORT-02): `e1f82c9` (isReportToProviderEnabled strict-equality + 10 tests + DEFAULT_CONFIG anti-mutation invariant + source-hygiene). 10 tests heredados.
  - **29-03 — Reporting gate infrastructure** (REPORT-03): `7c28c06` (prompt markers + placeholder) + `5feb578` (applyReportingGate helper + wire into launchOrchestrator) + `38c7a2e` (launch.test.js: applyReportingGate + source hygiene). SR1..SR6 = 6 tests heredados.
  - **29-04 — Sub-issue reporting prose** (REPORT-04): `d030547` (placeholder → prosa ES completa) + `4d67312` (SR1..SR6 gating reassertion) + `81c848c` (RC1..RC15 + RA1..RA6 content asserts). RC15 + RA6 = 21 tests heredados (+ overlap con SR1..SR6 de 29-03).

  Total tests heredados: ≈38 nuevos sobre baseline post-Phase-28.

- **D-05 [auto]:** Cada plan persiste un PLAN.md y SUMMARY.md propios (numeración 29-NN). **VERIFICATION.md** es phase-level único (un solo archivo cubre los 4 plans). **VALIDATION.md** NO se genera en Phase 29 — la flag `nyquist_compliant` se toggea en bloque para v0.7+v0.8 cuando proceda (consistente con Phase 32 BOOK-03 alcance).

### Anti-recursión (REPORT-01)

- **D-06 [auto, hereda branch D-06/D-07/D-08/D-11]:** Filtro ubicado entre el log "Task" inicial y el branch `if (!opts.force)` — corta ANTES de `parseKodoLabels`, lock acquire, resolver y launch. Hard safety property: filtro **fuera** del branch `!opts.force` — funciona incluso bajo `--force=true`. Discriminador del retorno: `{action: 'ignored', code: 'gsd_child'}` reutilizando la union existente (NO action nuevo, code nuevo).
- **D-07 [auto, hereda branch]:** Log line literal `[kodo:dispatch] Ignored — kodo:gsd-child filtered (anti-recursion)` para grep-friendly forensics. Distintivo del prefix + reason explícito.
- **D-08 [auto, hereda branch D-08]:** `isGsdChild(labels)` es **única fuente de verdad** para el check — bloquea inline `labels.some(l => l === 'kodo:gsd-child')` en consumers. Defensivo: tolera `string[]`, `Array<{name}>`, `null`/`undefined`. Case-insensitive parity con `parseKodoLabels`. Exact-match (no startsWith/includes) → `'kodo:gsd-children'` / `'kodo:gsd-quick-child'` / `'gsd-child'` (sin prefix `kodo:`) → `false`.

### Opt-in config (REPORT-02)

- **D-09 [auto, hereda branch D-03/D-05]:** `isReportToProviderEnabled(_loadConfig = loadConfig)` con strict equality `=== true` + optional chaining. Fail-closed contra: string `"true"`, number `1`, JSON corruption, missing `workflow` section, missing key. **DEFAULT_CONFIG no contiene la key `workflow`** (anti-mutation invariant D-03).
- **D-10 [auto]:** DI opcional via `_loadConfig` param para tests — evita filesystem touching real `~/.kodo/config.json` (Pitfall 3 documentado en plan branch). Default a `loadConfig` real para producción.
- **D-11 [auto]:** Matriz de tests = 5 estados: `true` (only this returns true), `"true"` (string), `1` (number), `undefined`, missing key. **+** anti-mutation invariant `DEFAULT_CONFIG.workflow === undefined`. **+** source-hygiene multi-archivo recursivo bajo `src/` (passes empty hoy, blinds Phase 29-03 contra inline reads).

### Reporting gate + prompt markers (REPORT-03)

- **D-12 [auto, hereda branch]:** Markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->` en `src/orchestrator/prompt.md`. `applyReportingGate(prompt, enabled)` es **pure function idempotente**: con `enabled=true` deja la sección entre markers; con `enabled=false` elimina markers + contenido entre ellos (no trailing whitespace).
- **D-13 [auto]:** Wire-up en `src/orchestrator/launch.js` ANTES del template render (similar al patrón del Phase 10 verification block). Default: `enabled = isReportToProviderEnabled()` salvo override por tests via DI.
- **D-14 [auto]:** Idempotencia verificada con SR1..SR6: aplicar `applyReportingGate` dos veces consecutivas con el mismo flag produce bytes idénticos. Anti-drift contra futuras llamadas dobles.

### Prosa ES sub-issue reporting (REPORT-04)

- **D-15 [auto, hereda branch]:** Provider-agnostic via `{{provider_name}}` placeholder. Cubre los 6 conceptos canónicos:
  1. **Just-in-time creation** — sub-issue se crea por phase justo antes de cambiar de phase (no batch upfront)
  2. **Label canónica** — `kodo:gsd-child` (referenciada como variable, NO inline en la prosa)
  3. **Comentarios plan-by-plan** — un comentario al sub-issue por plan completado, con el handle de su PLAN.md
  4. **Lifecycle abstracto** — no menciona Plane/GitHub específicos; usa `{{provider_name}}`
  5. **Append-only** — prohibido `delete-issue` / `close-issue` / mutaciones destructivas del sub-issue
  6. **HARD STEP pre-transición phase** — antes de marcar phase complete, validar sub-issue creado + último comentario presente
  Log literal en caso de falla MCP: `[kodo:reporting] MCP failure on phase N: <error>` — agent NO bloquea phase ante falla MCP (fail-open por diseño instruction-driven).
- **D-16 [auto]:** Tests RC1..RC15 (content asserts en string del prompt rendered) + RA1..RA6 (anti-leak asserts: ninguna mención inline de `kodo:gsd-child` en la prosa, debe llegar via constante).

### Source-hygiene (REPORT-05)

- **D-17 [auto]:** Test grep contra `src/` que retorna 0 matches para inline `'kodo:gsd-child'` fuera de `src/labels.js`. Ubicación del test: nuevo archivo `test/labels-hygiene.test.js` mirroring patrón Phase 14 `test/format-isolation.test.js` + Phase 16 `test/dispatcher-isolation.test.js` (test guard walker + grep AST-friendly).
- **D-18 [auto]:** El walker filtra: `src/labels.js` (legítimo, fuente única) + tests reference fixtures (si los hubiera). Cualquier nuevo consumer DEBE importar `KODO_LABEL_GSD_CHILD` y usar `isGsdChild(labels)`.

### Planning artifacts regen (REPORT-06)

- **D-19 [auto]:** Cada plan tiene su PLAN.md escrito ANTES del cherry-pick (locks decisiones) + SUMMARY.md escrito DESPUÉS del cherry-pick (refleja landing real). Patrón ya validado en Phase 28.
- **D-20 [auto]:** Source de la prosa de los PLANs del branch (en `.planning/milestones/v0.5-phases/{14,15}-*/` del branch): consultable via `git show gsd-provider-reporting:.planning/milestones/v0.5-phases/14-01-*PLAN.md` etc. — usar como inspiración estructural, NO copiar literal (la numeración y referencias a archivos cambian).
- **D-21 [auto]:** VERIFICATION.md phase-level con shape paralelo a Phase 28 VERIFICATION.md (success criteria items × verdict + assertion source). Cubre los 5 SC observables del ROADMAP §"Phase 29" + reconciliación REPORT-01..06 traceability.

### Suite baseline (SC#5)

- **D-22 [auto, override ROADMAP SC#5 numeración]:** ROADMAP SC#5 dice "≥818 pass" asumiendo 780 post-Phase-28 + 38 heredados. Phase 28 cerró con **806 pass** (sobrecumplió). Target real Phase 29: **≥844 pass** (806 + ≈38 heredados). Si tests heredados solapan/dedup, el floor mínimo es 818 (cumplir letra del ROADMAP). 0 regresiones, 0 nuevos skips. 1 skip pre-existente preservado.
- **D-23 [auto]:** Verificación incremental: tras cada cherry-pick plan completo (29-01, 29-02, 29-03, 29-04), correr `npm test` y registrar delta en SUMMARY.md respectivo. Si una phase intermedia introduce regresión, detener y diagnosticar antes de avanzar al siguiente plan.

### Conflict resolution policy

- **D-24 [auto]:** Si un cherry-pick produce conflicto (likely en `dispatcher.js` por evoluciones post-Phase 8 GSD; `launch.js` post-Phase 10 verification gate; `prompt.md` post-Phase 18-22 worktree/skill-sync):
  1. **Conflict trivial (whitespace/import order)**: resolver inline preservando lo más reciente.
  2. **Conflict semántico (función movida/refactorizada)**: aplicar la lógica equivalente manualmente sobre la versión actual de `main`, conservando el commit message original + nota `[cherry-picked from <sha>, manual resolution]`.
  3. **Conflict estructural (archivo movido/eliminado)**: detener cherry-pick, documentar en SUMMARY.md el desvío estructural, reaplicar lógica equivalente como commit nuevo dentro del scope del plan.
- **D-25 [auto]:** NO usar `git cherry-pick --strategy=ours` ni descartar cambios sin documentar. Cada desvío del cherry-pick literal debe quedar trazable en el SUMMARY.md del plan correspondiente.

### Claude's Discretion

- Orden interno de aplicación de los SHAs dentro de cada plan (atomicidad de los commits resultantes en main).
- Decisión de squashear los cherry-picks de un mismo plan en un único commit final vs preservar los SHAs originales como commits separados — recomendado: preservar separados para audit trail, pero squash es aceptable si simplifica reverts.
- Numeración interna de los archivos de tests (e.g., `test/dispatcher.test.js` o `test/triggers/dispatcher.test.js` según estructura actual de `main`).
- Si emerge la necesidad de una sub-task de "cleanup post-merge" (e.g., reformatear archivos tras conflict resolution), añadirla como Plan 29-05 sin pedir confirmación.
- Verificación de que los 38 tests heredados NO solapen con tests pre-existentes en main (e.g., si Phase 14 del branch añadió tests sobre función X que main reescribió post-divergencia).

### Folded Todos
N/A — no todos relevantes para Phase 29 (`todo.match-phase 29` no produjo matches; ROADMAP + REQUIREMENTS son self-contained).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 29 drivers (REQ-IDs + acceptance criteria)

- `.planning/REQUIREMENTS.md` §REPORT (lines 17-24) — REQ-IDs canónicos REPORT-01..REPORT-06 con acceptance criteria literales.
- `.planning/ROADMAP.md` §"Phase 29: GSD Provider Reporting Integration" (lines 38-49) — Success Criteria observables (5 items) + dependencia Phase 28.
- `.planning/PENDING-INTEGRATIONS.md` — Estado de la rama paralela `gsd-provider-reporting`, lista de los 9 SHAs de código + instrucciones cherry-pick literales + razón "NO mergear directo".
- `.planning/STATE.md` §"Most recent shipped milestone" + §"Critical Invariants" — Baseline Phase 28 (806/805+1 skip) + invariantes cross-milestone (TaskProvider 9-method, Lock per-repo GSD-10, HOOK-01 universal, worktree always-on).

### Branch paralela (source of truth para cherry-picks)

- Branch: `gsd-provider-reporting` HEAD `cb28994` (35 commits ahead of `ad2cd88`).
- 9 SHAs de código:
  - `5a41d8f` — feat(14-01): export KODO_LABEL_GSD_CHILD + isGsdChild helper (`src/labels.js`)
  - `cbd8f9c` — feat(14-01): anti-recursion filter for kodo:gsd-child in dispatcher (`src/triggers/dispatcher.js`)
  - `e1f82c9` — feat(14-02): isReportToProviderEnabled helper with source-hygiene tests (`src/config.js` + `test/config.test.js`)
  - `7c28c06` — feat(15-01): reporting block markers + placeholder in prompt.md (`src/orchestrator/prompt.md`)
  - `5feb578` — feat(15-01): applyReportingGate helper + wire into launchOrchestrator (`src/orchestrator/launch.js`)
  - `38c7a2e` — test(15-01): launch.test.js — applyReportingGate + source hygiene
  - `d030547` — feat(15-02): replace placeholder with full ES prose for sub-issue reporting
  - `4d67312` — test(15-02): SR1..SR6 — sub-issue reporting section gating asserts
  - `81c848c` — test(15-02): RC1..RC15 + RA1..RA6 — sub-issue reporting content asserts
- Branch planning artifacts inspeccionables via `git show gsd-provider-reporting:.planning/milestones/v0.5-phases/14-{01,02}-*PLAN.md` y `15-{01,02}-*PLAN.md` (USO REFERENCIAL — no copiar literal por colisión Phase 14-15).

### Touch targets (archivos a modificar en main)

- `src/labels.js` — existing `parseKodoLabels` + `getGsdMode` (NO TOUCH); añadir `KODO_LABEL_GSD_CHILD` + `isGsdChild` exports aditivos.
- `src/triggers/dispatcher.js` — añadir guard ANTES del branch `if (!opts.force)` + import de `isGsdChild`. Preservar invariante Phase 8 GSD-10 lock per-repo y Phase 9 dispatcher como fuente única para `gsd.phase.resolved`.
- `src/config.js` — añadir `isReportToProviderEnabled` export con DI opcional `_loadConfig`. DEFAULT_CONFIG intacto (no key `workflow`).
- `src/orchestrator/prompt.md` — insertar markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->` + placeholder + prosa ES en posición canónica (TBD por planner, sugerencia: tras la sección "## Sesiones GSD" Phase 10 D-07).
- `src/orchestrator/launch.js` — añadir `applyReportingGate(prompt, enabled)` pure helper + wire en el render path. Preservar invariante Phase 18 worktree always-on + Phase 20 HOOK-01 universal.

### Patrones canónicos en main que aplican a Phase 29

- `src/cli/format.js` (Phase 14 D-01..D-07) — patrón de single-source-of-truth + grep-friendly source-hygiene (referente para D-17).
- `test/dispatcher-isolation.test.js` (Phase 16 LOG-13) — patrón de comment-aware grep guard sobre `src/dispatcher.js` (referente directo para `test/labels-hygiene.test.js` D-17).
- `test/format-isolation.test.js` (Phase 14 + Phase 15 extension) — patrón de walker + 5 callsites import + 0 leak (referente para multi-archivo source-hygiene D-11/D-18).
- `.planning/phases/28-polling-daemon-hardening/28-CONTEXT.md` — shape canónico de CONTEXT.md de la era v0.8 (referente estructural).
- `.planning/phases/28-polling-daemon-hardening/VERIFICATION.md` — shape canónico de VERIFICATION.md phase-level v0.8 (referente para D-21).

### Invariantes que NO se tocan (cross-milestone preservation)

- **TaskProvider 9-method contract** (`src/interface.js` `TASK_PROVIDER_METHODS`) — Phase 29 NO toca interface ni añade método (la reporting es instruction-driven, fuera del provider contract).
- **TaskItem/TriggerEvent 13-field shape** (Phase 28 D-01) — zero changes; reporting agnóstico al shape de TaskItem.
- **`parseKodoLabels` semantics** (Phase 8 GSD-01 + Phase 11 QUICK-01 + Phase 13 source-hygiene D-09/D-10/D-11) — zero changes; `isGsdChild` es helper paralelo, NO una rama nueva de parseKodoLabels.
- **Lock per-repo Phase 8 GSD-10** — anti-recursión REPORT-01 corta ANTES del lock acquire (D-06) → invariante preservado.
- **Worktree always-on Phase 18 + HOOK-01 universal Phase 20 + cwd=repo Phase 999.1** — Phase 29 no toca dispatcher launch path ni orchestrator cwd → preservados por construcción.
- **LOG-12 guard** (`test/check-isolation.test.js` walker) — Phase 29 añade archivos a `src/`; verificar que ningún nuevo archivo en path "no-logger" introduzca import transitivo de `logger.js`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`src/labels.js#parseKodoLabels`**: Patrón normalizador de labels existente (`string[] | Array<{name}>` → estructura canónica). `isGsdChild` (5a41d8f) mirrors la firma defensive sin tocar `parseKodoLabels`.
- **`src/config.js#loadConfig`**: Loader existente para `~/.kodo/config.json`. `isReportToProviderEnabled` (e1f82c9) lo wrap-ea con DI opcional sin reescribir.
- **`src/triggers/dispatcher.js#dispatchTrigger`**: Fire-and-forget pattern v0.2 + Phase 8 GSD-10 lock + Phase 9 dispatcher como única fuente de `gsd.phase.resolved`. Filtro REPORT-01 se inserta como guard temprano sin alterar el flow downstream.
- **`src/orchestrator/launch.js#launchOrchestrator`**: Render path del prompt + invariante cwd=repo + worktree always-on. `applyReportingGate` se inserta como pure transformation sobre `promptText` ANTES del render final.
- **`src/orchestrator/prompt.md`**: Markdown ya estructurado en secciones (Phase 10 D-07: sección `## Sesiones GSD` condicional). Nueva sección "Sub-issue reporting" sigue el mismo idioma (ES) y posición convencional.

### Established Patterns

- **Closed event taxonomy en `src/logger-events.js`**: Phase 29 NO añade evento nuevo — el filtro REPORT-01 reutiliza `{action: 'ignored', code: 'gsd_child'}` sobre el evento `dispatcher.skip` existente (D-11 del branch). Cero cambios a `logger-events.js`.
- **Source-hygiene grep walker** (Phase 14 `test/format-isolation.test.js`, Phase 16 `test/dispatcher-isolation.test.js`): patrón canónico para guard contra literales inline. `test/labels-hygiene.test.js` (D-17) lo replica.
- **DI opcional con `_param = realParam`** (Phase 14 W-4 stop.js, Phase 17 UAT-03 spawnSync): patrón establecido para test seams sin mocks globales. `isReportToProviderEnabled(_loadConfig = loadConfig)` (D-10) lo aplica.
- **Pure function idempotente entre markers** (espejo de patrón Pandoc/markdown transformation): `applyReportingGate` (D-12) es transformación textual sin side effects — testable con bytes.
- **Provider-agnostic via `{{placeholder}}` en prompt** (Phase 2 D-09 + Phase 10 D-07): prosa ES Phase 29 D-15 usa `{{provider_name}}` consistente con el patrón histórico.

### Integration Points

- **`src/triggers/dispatcher.js` línea TBD (post-Phase 8 + Phase 9 evolutions)**: punto único de inserción del guard REPORT-01. Planner debe localizar la línea exacta tras inspeccionar la versión actual de main (puede haber drift vs branch).
- **`src/orchestrator/launch.js` línea TBD (post-Phase 10 + Phase 18-20 evolutions)**: punto único de wire-up de `applyReportingGate`. Idem — drift posible.
- **`src/orchestrator/prompt.md` posición canónica**: tras `## Sesiones GSD` (Phase 10) o `## Worktree` (Phase 18) según orden actual del archivo. Planner localiza.
- **`test/dispatcher.test.js` + `test/triggers/dispatcher.test.js`**: drift posible — verificar cuál existe en main actual y dónde se añaden los 6 tests REPORT-01.
- **`test/config.test.js`**: nuevo archivo si no existe (rama lo crea en e1f82c9) o append si ya existe en main (Phase 26 podría haberlo creado).
- **`test/orchestrator/launch.test.js`**: nuevo archivo si no existe (rama lo crea en 38c7a2e) o append si ya existe en main.

### Potential Drift Risks (cherry-pick collision surface)

- `src/triggers/dispatcher.js`: evolucionó Phase 8 (GSD label), Phase 9 (resolver wire), Phase 11 (gsd-quick), Phase 18 (worktree path threading). Branch divergió antes de Phase 18 evolutions → conflict probable en el guard placement.
- `src/orchestrator/launch.js`: evolucionó Phase 10 (verification gate), Phase 18 (worktree threading), Phase 26 (`--polling` flag DI). Branch divergió antes → conflict probable.
- `src/orchestrator/prompt.md`: evolucionó Phase 10 (Sesiones GSD section), Phase 18 (Worktree section), Phase 20 (HOOK-01 block). Branch divergió antes → conflict probable en marker placement.
- `src/config.js`: evolucionó Phase 26 (wizard `provider: github` paths). Branch divergió antes → conflict posible en DEFAULT_CONFIG shape.
- `src/labels.js`: muy estable post-Phase 11 D-09/D-10/D-11. Conflict improbable.

</code_context>

<specifics>
## Specific Ideas

- **SC#1 literal** (anti-recursión observable): operador crea tarea con label `kodo:gsd-child`, dispara webhook/polling/CLI manual (incluso `--force`), `kodo log` emite `dispatcher.skip reason=gsd-child` SIN llegar a `parseKodoLabels`/lock/resolver/launch. Verificable en `test/dispatcher.test.js` con spy sobre los 4 callsites downstream (deben no ser llamados).
- **SC#2 literal** (opt-in observable): operador con `workflow.report_to_provider: true` → prompt renderizado contiene sección entre markers `<!-- BEGIN reporting -->` / `<!-- END reporting -->`. Operador con `false` / `undefined` / missing key → prompt SIN esa sección. Verificable byte-level con SR1..SR6.
- **SC#3 literal** (source-hygiene): `grep -rE "'kodo:gsd-child'" src/` retorna 0 matches fuera de `src/labels.js`. Verificable en `test/labels-hygiene.test.js`.
- **SC#4 literal** (cherry-pick traceability): 9 SHAs aplicados (audit via `git log --grep="(cherry picked from commit"`). Planning artifacts regenerados (PLAN/SUMMARY/VERIFICATION) con numeración Phase 29 (NO Phase 14-15).
- **SC#5 literal** (suite verde): ≥818 pass (override D-22: target real ≥844). 0 regresiones, 0 nuevos skips. 1 skip pre-existente preservado.
- **Provider-agnostic literal**: prosa ES usa `{{provider_name}}` (NO Plane, NO GitHub, NO ClickUp inline). Ejemplo del template: "Crea un sub-issue en {{provider_name}} con label `kodo:gsd-child`".
- **HARD STEP literal**: prosa explícita "ANTES de marcar phase complete, valida que existe el sub-issue + último comentario está presente". Si falla la validación, log `[kodo:reporting] MCP failure on phase N: <error>` y NO bloquea phase (fail-open).
- **Anti-recursión bajo --force**: caso crítico no negociable — el filtro DEBE funcionar incluso con `dispatchTrigger({..., force: true})` (placement OUTSIDE del `!opts.force` branch).

</specifics>

<deferred>
## Deferred Ideas

- **Webhook GitHub real-time para sub-issues** → REPORT funciona vía polling actual + instruction-driven; webhook ingress queda fuera de v0.8 (PROJECT.md out-of-scope).
- **`kodo gsd doctor` para limpiar sub-issues huérfanos** → instruction-driven implica que kodo no lee ni borra issues. Limpieza es responsabilidad del operador o del agente Claude. → v0.9+ si emerge demanda.
- **Tests E2E de MCP (Claude crea sub-issue real)** → fuera de scope; tests son unit/integration sobre prompt content + dispatcher filter + config gate. La cadena MCP-driven es responsabilidad del operador en deploy real.
- **Detección automática de drift entre prompt.md y la prosa heredada** → la prosa se cherry-picka una vez; si en el futuro Phase 18-22-etc. modifican `prompt.md`, el operador debe verificar manualmente que los markers + prosa se preservan. Test SR1..SR6 es la red de seguridad.
- **Métrica de uso del flag `workflow.report_to_provider`** → telemetría de adoption no es objetivo v0.8. Si emerge demanda, futura phase puede emitir evento `config.flag.read` con la key.
- **Migración v0.2 → v0.8 del config para añadir `workflow` block default** → explícitamente RECHAZADO (D-09 anti-mutation invariant). Operador opta-in manualmente editando `~/.kodo/config.json`.
- **Validación de sub-issue formato/contenido por kodo** → instruction-driven implica fail-open; kodo confía en el agente. NO añadir validator. Si el agente crea sub-issues malformados, es bug del agente, no de kodo.

### Reviewed Todos (not folded)

N/A — `todo.match-phase 29` no produjo matches relevantes.

</deferred>

---

*Phase: 29-GSD Provider Reporting Integration*
*Context gathered: 2026-05-20*
*Mode: --auto (all gray areas resolved with recommended defaults)*
