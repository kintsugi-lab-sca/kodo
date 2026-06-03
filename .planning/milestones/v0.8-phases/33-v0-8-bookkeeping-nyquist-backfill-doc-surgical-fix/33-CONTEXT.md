# Phase 33: v0.8 Bookkeeping & Nyquist Backfill (Doc + Surgical Fix) - Context

**Gathered:** 2026-05-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Cerrar los ~14 items de tech debt identificados en `.planning/v0.8-MILESTONE-AUDIT.md` (verdict TECH_DEBT, no blockers) antes de archivar v0.8. Análogo estructural a Phase 32 (v0.7 bookkeeping doc-only) pero con scope ligeramente mayor: añade nyquist VALIDATION.md backfill × 3 phases + 1 surgical fix de robustness gap en `markSessionStatus` callers. La phase NO es 100% doc-only — el slug "Doc + Surgical Fix" lo refleja.

**In scope (audit-fijo, 3 bloques disjuntos):**

- **Bloque A (doc-drift, ~10 líneas):**
  - **BOOK-DRIFT-V8** — 9 IDs `[ ]` Pending → `[x]` Complete en `.planning/REQUIREMENTS.md` top-level (POLL-FIX-01, DAEMON-01, DAEMON-02, ADVISORY-01/02/03, BOOK-01/02/03). Wire-up funcional ya verificado en audit + VERIFICATION.md SATISFIED de cada phase.
  - **SUMMARY-FRONTMATTER** — 4-5 SUMMARYs con `requirements_completed: []` reconciliados: 29-01 añade REPORT-01 + REPORT-05; 31-01 añade ADVISORY-01; 31-02 añade ADVISORY-02. 30-03/30-04 son cosméticos (gap-closure plans), incluidos por consistencia.
  - **ROADMAP-FIX** — `.planning/ROADMAP.md` §Phase 32 Plans section listas `31-01-PLAN.md / 31-02-PLAN.md / 31-03-PLAN.md` por copy-paste residual del scaffold → corregir a `32-01 / 32-02 / 32-03`.

- **Bloque B (nyquist backfill, 3 archivos nuevos):**
  - **NYQ-28** — Crear `.planning/phases/28-polling-daemon-hardening/28-VALIDATION.md` con frontmatter `nyquist_compliant: true` + tabla dimensión→cobertura citando tests existentes + audit como evidencia. Placeholder estructural, NO re-ejecución de tests.
  - **NYQ-30** — Idem para `.planning/phases/30-sessionrecord-lifecycle/30-VALIDATION.md`. Phase 30 tiene HUMAN-UAT 2/2 documentado en VERIFICATION; el placeholder cita esa cobertura.
  - **NYQ-31** — Idem para `.planning/phases/31-phase-21-22-advisory-cleanup/31-VALIDATION.md`.
  - **NYQ-32-NA** — Phase 32 (doc-only Tier 1) se documenta como N/A explícitamente en `v0.8-MILESTONE-AUDIT.md` (o STATE.md v0.8 deferred-not-applicable section); el planner decide ubicación. NO se crea `32-VALIDATION.md`.

- **Bloque C (surgical fix, 2 callsites + 2-4 tests netos):**
  - **LIFE-02-FOLLOWUP** — `src/gsd/verify.js:267` y `src/hooks/stop.js:197` actualmente descartan el return discriminado `{ok, reason}` de `markSessionStatus(...)`. Cambio: ambos callsites capturan el return en un `const result = markSessionStatus(...)` y emiten `log.warn('markSessionStatus.skipped', {reason: result.reason, session_id})` cuando `result.ok === false`. **Comportamiento simétrico log + continue** — cero throws, cero cambio E2E observable (porque `task_id` siempre presente en sesiones activas), pero NDJSON registra el drift si emerge.

**Out of scope (explícito):**

- Re-ejecución formal de la suite de tests para sustentar nyquist. La suite ya está verde (894 pass) y los placeholders citan esa cobertura empírica.
- 6 anti-patterns INFO-level documentados en `30-REVIEW.md` (WR-01..04 + IN-03/IN-04). Phase 30 ya los marcó out-of-scope deliberado; el audit los reconoce como pre-existentes no introducidos por v0.8.
- Edge case `src/skill/sync.js:60` `const warn = onConsoleWarn ?? console.warn` (referencia a `console.warn` como default nullish coalescing). El audit lo cataloga como "decisión consciente — refactorizarlo sería sobreingenierización".
- Auditar phases anteriores a v0.8 o cualquier otra phase v0.8 ya cerrada para drift adicional no listado en el audit.
- Adapters nuevos, capabilities nuevas, refactors funcionales — pertenecen a v0.9+.
- Cambios a `markSessionStatus` mismo o a su contrato (return shape inmutable por D-02 Phase 30 LIFE-02).

</domain>

<decisions>
## Implementation Decisions

### Surgical fix scope (LIFE-02-FOLLOWUP)
- **D-01:** **Surgical fix LIFE-02-FOLLOWUP entra en Phase 33 con consumo simétrico log+continue en ambos callers.** `src/gsd/verify.js:267` y `src/hooks/stop.js:197` capturan el return `{ok, reason}` de `markSessionStatus`; cuando `ok === false`, emiten `log.warn('markSessionStatus.skipped', {reason, session_id})` y continúan. Cero throws (preserva fail-open contract del stop hook + no rompe E2E del gate de verify cuando task_id está presente). Tier 1 razonable por mínima intrusión, sin cambio de comportamiento runtime hoy (task_id siempre presente), pero NDJSON registra el drift si emerge. NOMBRE del event log normalizado al patrón `<componente>.<situación>` ya en uso (e.g., `worktree.cleanup.dirty`, `markSessionStatus.failed`).

### Nyquist backfill profundidad (NYQ-28/30/31 + NYQ-32-NA)
- **D-02:** **Placeholder pro-forma para 3 phases (28/30/31), Phase 32 = N/A documentado.** Cada VALIDATION.md placeholder es 1 archivo nuevo con frontmatter `nyquist_compliant: true` + tabla dimensión→cobertura citando tests existentes + audit + SUMMARYs/VERIFICATION.md como evidencia. **NO** re-ejecución de tests (la suite está verde a 894 pass; el audit ya validó empíricamente). Phase 32 NO se crea VALIDATION.md — se documenta como N/A en `v0.8-MILESTONE-AUDIT.md` o `STATE.md` (planner decide ubicación) con justificación "Tier 1 doc-only sin código a validar". Sign-off final v0.8 queda en 4/5 compliant + 1/5 N/A explícito (vs 1/5 baseline pre-Phase 33).

### Plan granularity (3 plans = 1 por bloque)
- **D-03:** **3 plans = 1 por bloque (A=doc-drift, B=nyquist, C=surgical-fix), Wave 1 paralelo, cero overlap.** Réplica del playbook Phase 32 (3 plans Wave 1 paralelo). Plan 33-01 = Bloque A (doc-drift bundle); Plan 33-02 = Bloque B (NYQ-28/30/31 + NYQ-32-NA doc); Plan 33-03 = Bloque C (LIFE-02-FOLLOWUP surgical). Los 3 bloques tocan archivos disjuntos (A → `.planning/REQUIREMENTS.md` + 5 SUMMARYs + `.planning/ROADMAP.md`; B → 3 VALIDATION.md nuevos + 1 nota en audit/STATE; C → `src/gsd/verify.js`, `src/hooks/stop.js`, tests asociados). Cero contención, Wave 1 paralelo seguro.

### Scope discipline (Full A + audit-fijo)
- **D-04:** **Full A scope incluye BOOK-DRIFT + SUMMARY-FRONTMATTER + ROADMAP-FIX juntos en Plan 33-01.** Los 3 sub-items están listados en el audit (no inventados); diferir los cosméticos a una phase futura crearía overhead de re-roadmap por ~10 líneas — overkill. Hereda **D-06 de Phase 32**: scope fijo a items del audit (sin discriminar cosmético vs estructural si está listado en `.planning/v0.8-MILESTONE-AUDIT.md`). Drift descubierto en ejecución fuera del audit → `<deferred>`, NO se mete sin re-roadmap.

### Claude's Discretion

Las siguientes decisiones son meta-process / structural sobre el workflow de planning mismo (no implementables como contratos por-plan). Se documentan aquí por trazabilidad histórica de la discussion, pero no requieren citation explícita en `must_haves` de los plans — su cumplimiento se observa en la existencia de los plans, su YAML frontmatter, los commits del executor, y la política Tier 1 de CLAUDE.md.

- **Convención commits:** `docs(33-01): close BOOK-DRIFT-V8 + SUMMARY-FRONTMATTER + ROADMAP-FIX — <one-liner>`, `docs(33-02): close NYQ-{28,30,31} placeholders + NYQ-32-NA — <one-liner>`, `fix(33-03): consume markSessionStatus return in verify.js + stop.js — <one-liner>` (semantic prefix discriminado porque 33-03 SÍ toca `src/`). *Process/convention — enforced at commit time, alineada con Phase 31/32.*
- **Wave 1 = los 3 plans en paralelo, cero overlap entre A/B/C.** *Encoded by `wave: 1` + `depends_on: []` in each plan's frontmatter.*
- **Tier según política CLAUDE.md global:** Bloque A + B = Tier 1 (docs → fast-forward main local sin PR). Bloque C = Tier 1 extendido (toca `src/` pero es robustness gap puro sin path E2E hot; log+continue simétrico, cero throw, cero cambio E2E). Si el reviewer del plan o el code-review previo al merge marca C como Tier 2, escalar — pero el default es Tier 1.
- **Template VALIDATION.md** se toma de `.planning/milestones/v0.7-phases/24-githubprovider-normalizer-registry/24-VALIDATION.md` (única v0.7 con `nyquist_compliant: true`) o de `.planning/phases/29-gsd-provider-reporting-integration/29-VALIDATION.md` (única v0.8 con sign-off existente). El planner inspecciona ambos y escoge el más cercano por estructura.
- **NYQ-32-NA ubicación de la justificación:** opción A — append a `.planning/v0.8-MILESTONE-AUDIT.md` en sección "Nyquist Compliance" reemplazando "32 missing" con "32 N/A — Tier 1 doc-only"; opción B — append a `.planning/STATE.md` en una nueva sección `## Nyquist Coverage Sign-off`. El planner decide; preferencia ligera por opción A porque consolida el cierre del audit en el mismo documento que lo abrió.
- **Plan task granularity** dentro de cada bloque queda al planner. Heurística: 1 task por sub-item identificado arriba (Bloque A → 3 tasks, Bloque B → 4 tasks, Bloque C → 2 tasks + tests), pero el planner puede consolidar si tiene sentido (BOOK-DRIFT son 9 ediciones celda en 1 archivo → probablemente 1 task con script o batch edit).
- **Suite delta esperado:** Bloque A + B = 0 tests netos (cero código tocado). Bloque C = +2 a +4 tests netos (consumo del return discriminado en cada callsite × 2 callers; opcionalmente test de drift observability en NDJSON). Target post-phase: ≥896 pass. **NO** re-ejecutar la suite global como gate funcional del phase (suite ya verde a 894); el gate del plan 33-03 corre solo los tests modificados/añadidos.
- **Documentación del cierre del milestone v0.8** (ej. update final a `v0.8-MILESTONE-AUDIT.md` declarando "all tech debt closed, status: SHIPPABLE") queda fuera de Phase 33 estricto — eso es trabajo de `/gsd-complete-milestone` post-Phase 33. Phase 33 solo cierra los items, no archiva.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit doc (source of truth — drives ALL scope decisions)
- `.planning/v0.8-MILESTONE-AUDIT.md` — Documento que identificó los ~14 items de tech debt como TECH_DEBT verdict (no blockers). Frontmatter `tech_debt:` enumera items por phase + `milestone-level`. Sección "Recommendations" textual: *"cerrar el drift inline antes de archivar — sea con un Phase 33 doc-only (BOOKKEEPING v0.8 cleanup, análogo a Phase 32 para v0.7)"*. Sección "Requirements Coverage Matrix" tiene la lista 1:1 de los 9 IDs `[ ]` Pending. Sección "Nyquist Compliance" tabla con 1/5 compliant.

### Bloque A — Doc-drift targets (Plan 33-01)
- `.planning/REQUIREMENTS.md` — Traceability table líneas ~80-96; reconciliar 9 IDs (POLL-FIX-01, DAEMON-01, DAEMON-02, ADVISORY-01/02/03, BOOK-01/02/03) de `[ ]` Pending a `[x]` Complete. NO tocar prosa adyacente.
- `.planning/phases/29-gsd-provider-reporting-integration/29-01-SUMMARY.md` — Frontmatter `requirements_completed: []` → añadir `[REPORT-01, REPORT-05]`. VERIFICATION.md ya registra ambos como SATISFIED; este es el frontmatter cosmético.
- `.planning/phases/30-sessionrecord-lifecycle/30-03-SUMMARY.md` — Frontmatter `requirements_completed: []` (gap-closure plan, sin REQ-ID directo asignado — el planner decide si añadir LIFE-01 como reference o dejar `[]` y notar en prosa).
- `.planning/phases/30-sessionrecord-lifecycle/30-04-SUMMARY.md` — Idem 30-03.
- `.planning/phases/31-phase-21-22-advisory-cleanup/31-01-SUMMARY.md` — Frontmatter `requirements_completed: []` → añadir `[ADVISORY-01]`.
- `.planning/phases/31-phase-21-22-advisory-cleanup/31-02-SUMMARY.md` — Frontmatter `requirements_completed: []` → añadir `[ADVISORY-02]`.
- `.planning/ROADMAP.md` §Phase 32 — Líneas 93-96 listan `31-01-PLAN.md / 31-02-PLAN.md / 31-03-PLAN.md` por copy-paste residual → corregir a `32-01-PLAN.md / 32-02-PLAN.md / 32-03-PLAN.md` (con los one-liners reales de Phase 32 BOOK-01/02/03).

### Bloque B — Nyquist backfill targets (Plan 33-02)
- `.planning/phases/28-polling-daemon-hardening/28-VALIDATION.md` — **NEW.** Frontmatter `nyquist_compliant: true` + tabla dimensión→cobertura citando `28-VERIFICATION.md` (4/4 must-haves SATISFIED) + tests existentes (`test/providers/github/normalize.test.js`, `test/triggers/polling.test.js`, daemon integration tests añadidos por DAEMON-01/02) + audit `.planning/v0.8-MILESTONE-AUDIT.md` como evidencia funcional.
- `.planning/phases/30-sessionrecord-lifecycle/30-VALIDATION.md` — **NEW.** Idem citando `30-VERIFICATION.md` (4/4 must-haves, 3ª re-verification) + HUMAN-UAT 2/2 documentado + `test/session/find-session.test.js` + `test/session/mark-status.test.js`.
- `.planning/phases/31-phase-21-22-advisory-cleanup/31-VALIDATION.md` — **NEW.** Idem citando `31-VERIFICATION.md` (9/9 must-haves) + tests asociados a ADVISORY-01..03.
- `.planning/v0.8-MILESTONE-AUDIT.md` — **UPDATE.** Sección "Nyquist Compliance" tabla: marcar 28/30/31 como compliant tras NYQ-{28,30,31} y declarar 32 como N/A explícito con justificación Tier 1 doc-only. Reemplazar "Overall: 1/5 compliant, 4/5 missing" con "Overall: 4/5 compliant + 1/5 N/A documented (Phase 32 Tier 1 doc-only)".

#### Templates / references
- `.planning/milestones/v0.7-phases/24-githubprovider-normalizer-registry/24-VALIDATION.md` — Template canónico v0.7 con `nyquist_compliant: true` (única v0.7 toggled tras Phase 32 BOOK-03 closure).
- `.planning/phases/29-gsd-provider-reporting-integration/29-VALIDATION.md` — Reference v0.8 con sign-off existente (única v0.8 pre-Phase 33). El planner inspecciona y escoge la estructura más cercana.

### Bloque C — Surgical fix targets (Plan 33-03)
- `src/gsd/verify.js:267` — Callsite #1. Contexto: dentro de `finalize()` rama `pass` tras `addComment + updateTaskState`. Patrón actual: `markSessionStatus(session.task_id, 'review', 'gate-passed', log, session.session_id);` (return descartado). NO está envuelto en try/catch (el caller asume markSessionStatus es non-throwing per discriminated union contract de Phase 30).
- `src/hooks/stop.js:197` — Callsite #2. Contexto: dentro de try/catch líneas 196-202 que captura excepciones del dynamic import + invocación. Patrón actual: `markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id);` (return descartado). El log warn nuevo cabe DENTRO del mismo try block (no añadir try/catch adicional).
- `src/session/manager.js` — Export de `markSessionStatus` y su return shape. NO modificar — contrato Phase 30 LIFE-02 inmutable; el surgical fix consume, no muta el contrato.
- `test/gsd-verify-integration.test.js` (o equivalente) — Tests del flujo verify.js#finalize. Añadir caso: cuando `markSessionStatus` retorna `{ok: false, reason: 'missing-task-id'}`, NDJSON contiene event `markSessionStatus.skipped` con `{reason, session_id}`. Planner decide test exacto.
- `test/skill-auto-commit.test.js` o `test/hooks/stop.test.js` (planner inspecciona) — Tests del flujo stop hook. Añadir caso simétrico al de verify.js.

### Precedente directo (no canónico para implementación, pero playbook reference)
- `.planning/phases/32-v0-7-bookkeeping-doc-only/32-CONTEXT.md` — Phase 32 v0.7 bookkeeping doc-only playbook (3 plans Wave 1 paralelo, D-06 scope discipline, format de plan task granularity). Phase 33 hereda el shape y extiende con Bloque C.

### Project-level (siempre aplicable)
- `.planning/PROJECT.md` — Project context (Core Value, Current Milestone v0.8 Active).
- `.planning/REQUIREMENTS.md` — Current milestone REQUIREMENTS (mecánica `gsd-sdk roadmap.update-plan-progress` auto-marca al cierre de plans; BOOK-DRIFT-V8 lo hace manual porque los IDs cubren phases ya cerradas).
- `.planning/STATE.md` — STATE actual (post-Phase 32; Phase 33 actualizará al cierre).
- `.planning/ROADMAP.md` — Roadmap canónico (Phase 33 entry pendiente de update con Goal real tras este CONTEXT).
- `./CLAUDE.md` global (en `~/.claude/CLAUDE.md`) — Tier 1 política, scope discipline, "no mocks DB" patterns, etc.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **VALIDATION.md frontmatter template** — `24-VALIDATION.md` v0.7 (única v0.7 con `nyquist_compliant: true` tras BOOK-03 closure) + `29-VALIDATION.md` v0.8 (única v0.8 con sign-off existente). El planner inspecciona ambos para escoger structure mas cercana al phase shipped (no doc-only).
- **VERIFICATION → VALIDATION evidence pattern** — Phase 32 BOOK-02 ya estableció el playbook de "backfill placeholder estructural citando audit + SUMMARYs como evidencia funcional sin re-ejecutar tests". Aplica simétrico a NYQ-{28,30,31}.
- **Frontmatter YAML toggle** — Todas las VALIDATION.md existentes usan frontmatter YAML; añadir el archivo nuevo es literalmente write con frontmatter + body templated. No rediseñar la estructura.
- **markSessionStatus return shape** — Phase 30 LIFE-02 ya definió el discriminated union `{ok: true} | {ok: false, reason: 'missing-task-id'}`. El surgical fix consume este shape; cero cambio al contrato.

### Established Patterns
- **`docs(NN-XX):` commit convention para Tier 1** — En uso desde Phase 31/32. Phase 33 Bloque A + B usa este prefijo; Bloque C usa `fix(NN-XX):` porque toca `src/`.
- **Event log naming `<componente>.<situación>`** — Ya en uso (`worktree.cleanup.dirty`, `worktree.cleanup.ok`, `markSessionStatus.failed` del catch existente en stop.js:201). El nuevo `markSessionStatus.skipped` (D-01) extiende el patrón.
- **Try/catch existente en stop.js (líneas 196-202)** — El bloque ya captura excepciones del dynamic import + invocación. El log warn nuevo (cuando `result.ok === false`) cabe DENTRO del mismo try block, no añadir wrapper adicional.
- **verify.js:267 sin try/catch** — `markSessionStatus` se asume non-throwing per discriminated union contract. El log warn nuevo va inline, no envolver.

### Integration Points
- **`gsd-sdk roadmap.update-plan-progress`** — Auto-actualiza STATE.md y REQUIREMENTS.md al cierre de plans para REQ-IDs declarados en `requirements_completed` del SUMMARY frontmatter. Phase 33 NO depende de este mecanismo para BOOK-DRIFT-V8 porque los IDs reconciliados corresponden a phases ya cerradas (28-31) — la edición es manual y directa al archivo de REQUIREMENTS.
- **Suite delta esperado:** Bloque A + B = 0 tests netos (cero código tocado). Bloque C = +2 a +4 tests netos. Target ≥896 pass post-phase (894 baseline + ≥2). Sin regresiones; LOG-12 walker, color isolation, single-source-of-format invariants no afectados (cero archivos `src/cli/`, `src/logger.js` tocados).
- **Codebase maps existentes** — `.planning/codebase/{ARCHITECTURE,CONCERNS,CONVENTIONS,INTEGRATIONS,STACK,STRUCTURE,TESTING}.md` disponibles para el researcher si necesita inspeccionar patrones. Para Phase 33 doc + surgical fix limitado, probablemente el researcher solo necesita verificar el patrón del callsite (ya verificado en este CONTEXT) y el template VALIDATION.md.

</code_context>

<specifics>
## Specific Ideas

- **9 IDs reconciliados (BOOK-DRIFT-V8):** POLL-FIX-01, DAEMON-01, DAEMON-02, ADVISORY-01, ADVISORY-02, ADVISORY-03, BOOK-01, BOOK-02, BOOK-03. Verificación 1:1 contra `.planning/v0.8-MILESTONE-AUDIT.md` "Requirements Coverage Matrix" — cada uno tiene VERIFICATION SATISFIED registrado.
- **5 SUMMARYs frontmatter:** 29-01 (REPORT-01 + REPORT-05), 30-03 + 30-04 (cosméticos sin REQ directo, dejar `[]` o añadir `[LIFE-01]` como reference — el planner decide), 31-01 (ADVISORY-01), 31-02 (ADVISORY-02).
- **ROADMAP-FIX:** `.planning/ROADMAP.md` líneas ~93-96 bajo "### Phase 32" lista por error `31-01-PLAN.md / 31-02-PLAN.md / 31-03-PLAN.md` con los one-liners de Phase 31. Corregir a `32-01-PLAN.md / 32-02-PLAN.md / 32-03-PLAN.md` con los one-liners reales de Phase 32 BOOK-01/02/03 (referencia: las líneas 33-35 del mismo ROADMAP.md tienen el patrón Phase 28 que sirve de molde).
- **VALIDATION.md placeholder body sugerido:** frontmatter YAML `nyquist_compliant: true` + sección `## Nyquist Coverage` con tabla:

| Dimensión | Cobertura | Evidencia |
|-----------|-----------|-----------|
| Functional correctness | ✓ | `XX-VERIFICATION.md` SC-1..N verdict SATISFIED |
| Test coverage | ✓ | `test/<paths>` (lista los tests asociados al REQ) |
| Integration wired | ✓ | `v0.8-MILESTONE-AUDIT.md` §Cross-Phase Integration |
| Regression risk | ✓ | Suite global ≥894 pass post-phase, 0 nuevos skips |

  Sin re-ejecución; sin sampling formal. Citation-based placeholder.

- **NYQ-32-NA justification (preferencia ligera por opción A):** append a `v0.8-MILESTONE-AUDIT.md` §Nyquist Compliance:

  > **Update 2026-05-23 (Phase 33 NYQ-32-NA):** Phase 32 (v0.7 Bookkeeping Doc-Only) NO genera `32-VALIDATION.md`. Justificación: Tier 1 doc-only sin código a validar — los 4 SC del phase son commits doc-only verificables por `git diff <base>..<head> -- src/ test/ bin/` retorna vacío (invariante Phase 32 D-06). Nyquist coverage para doc-only Tier 1 fases = N/A explícito.

- **Surgical fix wording sugerido (D-01):**

  ```javascript
  // src/gsd/verify.js:267 (after)
  const result = markSessionStatus(session.task_id, 'review', 'gate-passed', log, session.session_id);
  if (!result?.ok) {
    log.warn('markSessionStatus.skipped', { reason: result?.reason, session_id: session.session_id });
  }

  // src/hooks/stop.js:197 (after, DENTRO del try block existente 196-202)
  const result = markSessionStatus(session.task_id, 'done', 'session-stop', log, session.session_id);
  if (!result?.ok) {
    log.warn('markSessionStatus.skipped', { reason: result?.reason, session_id: session.session_id });
  }
  ```

  El optional chaining `result?.ok` es defensivo contra casos donde el caller mocked markSessionStatus retorna undefined; production siempre retorna el discriminated union per Phase 30 D-02.

</specifics>

<deferred>
## Deferred Ideas

Items que emergieron en discussion pero quedan fuera del scope Phase 33:

- **LIFE-02 caller hardening más profundo** — Parametrizar reason policy (decidir si ciertos `reason` deben throw vs log), telemetry counters de `markSessionStatus.skipped` rate, alerting si emerge en producción. Diferido a v0.9 si la falla emerge en runtime real; hoy `task_id` siempre presente.
- **6 anti-patterns INFO-level Phase 30 REVIEW.md** (WR-01..04 + IN-03/IN-04) — Out-of-scope deliberado por Phase 30; el audit los reconoce como pre-existentes. Permanecen diferidos a v0.9 backlog.
- **Edge case `src/skill/sync.js:60` `console.warn` default nullish coalescing** — Phase 31 lo dejó como "decisión consciente". Audit confirma "refactorizarlo sería sobreingenierización". Permanece diferido indefinidamente.
- **Sampling nyquist formal real** (vs placeholder) — Si en v0.9+ se decide elevar el bar de nyquist coverage, ejecutar `/gsd-validate-phase` retroactivo sobre 28/30/31 con sampling de tests. Hoy no se justifica el esfuerzo por verdict TECH_DEBT (no blockers) + 894 pass.
- **Documentación del cierre v0.8 milestone** — `v0.8-MILESTONE-AUDIT.md` final update marcando "all tech debt closed, status: SHIPPABLE" tras Phase 33. Es trabajo de `/gsd-complete-milestone`, no de Phase 33 estricto.

**Scope-creep guard:** Si durante ejecución surgen drift items adicionales NO listados en `v0.8-MILESTONE-AUDIT.md`, se capturan en el SUMMARY.md del plan correspondiente bajo "Deferred" — **NO se meten en Phase 33** sin re-roadmap (heredado D-06 Phase 32).

</deferred>

---

*Phase: 33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix*
*Context gathered: 2026-05-23*
