# Phase 47: Backfill de deuda Nyquist - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Saldar la deuda Nyquist acumulada al cierre de v0.9 y v0.10 creando/actualizando `VALIDATION.md` **citation-based** (`nyquist_compliant: true`) para 7 fases ya archivadas, **sin re-ejecutar la suite de tests**. Cada `VALIDATION.md` cita la evidencia empírica ya existente (VERIFICATION.md + tests + UAT) como cobertura por-dimensión. Espejo estructural directo de **v0.8 Phase 33 Bloque B** (NYQ-28/30/31), reducido a solo el backfill nyquist (sin doc-drift ni surgical-fix).

**In scope (audit-fijo, 7 fases + 1 reconciliación de estado):**

- **NYQ-01 (v0.10 — 2 fases):**
  - Phase 41 (`doctor-m-dulo-puro-de-saneo-cli`) — **NEW** `41-VALIDATION.md`. Cita `41-VERIFICATION.md`.
  - Phase 43 (`render-provider-state-en-el-dashboard`) — **NEW** `43-VALIDATION.md`. Cita `43-VERIFICATION.md` + `43-HUMAN-UAT.md`.

- **NYQ-02 (v0.9 — 5 fases):**
  - Phase 36 (`tabla-viva-render-seleccion-filtros`) — **UPDATE** `36-VALIDATION.md` existente (PARTIAL, `nyquist_compliant: false`) → compliant. Cita `36-VERIFICATION.md` + `36-HUMAN-UAT.md`.
  - Phase 37 (`attach-handoff-cmux`) — **UPDATE** `37-VALIDATION.md` existente (draft, `nyquist_compliant: false`) → compliant. Cita `37-UAT.md` + `37-HUMAN-UAT.md` (sin VERIFICATION.md formal — covered-by-UAT).
  - Phase 38 (`workspacehost-lifecycle-idle-needs-input`) — **NEW** `38-VALIDATION.md`. Cita `38-HUMAN-UAT.md` (sin VERIFICATION.md formal — covered-by-UAT).
  - Phase 39 (`paneles-auxiliares-comentarios-logs`) — **NEW** `39-VALIDATION.md`. Cita `39-VERIFICATION.md`.
  - Phase 39.1 (`cierre-de-gaps-v0-9-wiring-host-tui-fuente-nica-de-alive-sta`) — **NEW** `39.1-VALIDATION.md`. Cita `39.1-VERIFICATION.md` (passed 14/14).

- **Reconciliación de estado:**
  - `.planning/STATE.md` `## Deferred Items` — actualizar las 7 filas `nyquist` de PARTIAL/MISSING → saldado/compliant; actualizar la línea intro ("La deuda Nyquist se salda en Phase 47") a tiempo pasado/cerrado.

**Out of scope (explícito):**

- **Re-ejecución de la suite de tests** para sustentar nyquist. La suite ya está verde (1263/1264 pass, 1 skip — ver actividad Phase 46) y cada VALIDATION.md cita esa cobertura empírica + VERIFICATION/UAT existentes. Idéntico a la disciplina de Phase 33 D-02.
- **Edición manual de `.planning/REQUIREMENTS.md`** para NYQ-01/NYQ-02 — son requirements de ESTA fase; los marca automáticamente `gsd-sdk roadmap.update-plan-progress` al cierre de los plans (a diferencia de BOOK-DRIFT-V8 en Phase 33, que cubría phases ya cerradas). Verificar tras el cierre, no editar a mano.
- **Cualquier cambio en `src/`, `test/`, `bin/`** — `git diff -- src/ test/ bin/` DEBE quedar vacío (Tier 1 doc-only). Sin surgical-fix (a diferencia de Phase 33 Bloque C, que sí tocaba `src/`).
- **Re-auditar las 7 fases** buscando drift adicional no listado, o validar fases distintas a las 7 enumeradas.
- **Declarar fase alguna como N/A** — las 7 tienen evidencia empírica real (VERIFICATION o UAT); todas reciben `nyquist_compliant: true` citando su evidencia. Ninguna N/A.

</domain>

<decisions>
## Implementation Decisions

### Plan granularity
- **D-01:** **1 solo plan, ~3 tasks, Wave 1.** Task 1 = NYQ-01 (v0.10: 41/43, 2 NEW). Task 2 = NYQ-02 (v0.9: 36/37 UPDATE + 38/39/39.1 NEW). Task 3 = reconciliación `STATE.md`. Se elige 1 plan secuencial (no split por requirement en plans paralelos) **porque `STATE.md` es un fichero compartido**: dos plans paralelos editando `STATE.md` colisionarían. Un único plan secuencial elimina la contención y honra simplicidad-primero (Karpathy Regla 2). El espejo Phase 33 usó 1 plan por bloque; aquí solo existe el equivalente al Bloque B, luego 1 plan.

### New-vs-Update por fase
- **D-02:** **2 UPDATE + 5 NEW.** Phases 36 y 37 YA tienen `VALIDATION.md` (PARTIAL/draft, `nyquist_compliant: false`) — se **actualizan in-place** a citation-based compliant, preservando todo campo no relacionado. Phases 38, 39, 39.1, 41, 43 NO tienen `VALIDATION.md` — se **crean nuevos**. Esto coincide 1:1 con la clasificación PARTIAL (36/37) vs MISSING (38/39/39.1/41/43) registrada en `STATE.md ## Deferred Items`.

### Política de citación de evidencia
- **D-03:** **Citar la evidencia más fuerte disponible por fase, sin re-ejecutar tests.** Donde existe `VERIFICATION.md` formal (36, 39, 39.1, 41, 43) se cita como evidencia primaria por-dimensión. Donde NO existe VERIFICATION formal (37, 38 — cerradas vía UAT, ver fila `covered-by-UAT` en STATE.md) se cita el/los UAT (`*-UAT.md` / `*-HUMAN-UAT.md`) como evidencia equivalente. Cada `VALIDATION.md` es una tabla dimensión→cobertura citando fichero+resultado, NO una re-corrida de la suite. Réplica del playbook Phase 33 D-02 / Phase 32 BOOK-02.

### Forma del update a STATE.md
- **D-04:** **Reconciliar solo las 7 filas `nyquist` de `## Deferred Items`** (PARTIAL/MISSING → saldado/compliant, p. ej. "✓ saldado Phase 47") + actualizar la línea intro a tiempo pasado. **Dejar intactas** las filas `verification` (covered-by-UAT 37/38), `code` (WARNING-01 ciclo ESM), y `frontmatter` (cosmético) — son deuda distinta, fuera de NYQ-01/02. El criterio de éxito 3 del ROADMAP exige exactamente esto.

### Disciplina Tier 1 doc-only
- **D-05:** **Tier 1 doc-only puro.** Solo se escriben/editan ficheros `.md` bajo `.planning/`. `git diff -- src/ test/ bin/` debe quedar vacío como gate del plan. Sin tests netos (0 código tocado). Merge fast-forward a `main` local sin PR por política CLAUDE.md global (Tier 1: docs).

### Claude's Discretion
Decisiones meta-process delegadas al planner/executor (no requieren citation en `must_haves`):
- **Template VALIDATION.md:** tomar la estructura de `40-VALIDATION.md` o `42-VALIDATION.md` (v0.10, mismo milestone, fases shipped con sign-off existente — los ejemplos de forma más cercana a las 7 fases). El planner inspecciona y escoge. Para los 2 UPDATE (36/37) preservar la estructura existente y solo togglear `nyquist_compliant` + rellenar la tabla de citación.
- **Convención de commits:** `docs(47-01): backfill nyquist VALIDATION.md NYQ-01 (41/43) + NYQ-02 (36/37/38/39/39.1) + STATE reconciliation — <one-liner>`. Prefijo `docs(` (no `fix(`) porque cero `src/` tocado (a diferencia de Phase 33-03).
- **Granularidad de tasks dentro del plan:** heurística 1 task por requirement-group + 1 task STATE.md (= 3 tasks); el planner puede consolidar o subdividir (p. ej. separar UPDATE de NEW) si tiene sentido.
- **Rigor de la tabla dimensión→cobertura:** nivel de detalle por-dimensión (qué dimensiones Nyquist enumerar, cuántas citas por dimensión) queda al executor, anclado al template escogido. Mínimo: cada criterio de éxito de la fase mapeado a ≥1 cita de evidencia.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Precedente directo / playbook (source of truth del patrón)
- `.planning/milestones/v0.8-phases/33-v0-8-bookkeeping-nyquist-backfill-doc-surgical-fix/33-CONTEXT.md` — Espejo estructural. Bloque B (D-02) define el playbook "backfill placeholder citation-based citando audit + VERIFICATION + SUMMARYs sin re-ejecutar tests". Phase 47 = solo el equivalente al Bloque B, ampliado a 7 fases y a UPDATE-de-draft además de NEW.
- `.planning/milestones/v0.8-phases/33-...-doc-surgical-fix/33-02-PLAN.md` + `33-02-SUMMARY.md` — La implementación concreta del Bloque B (cómo quedó cada VALIDATION.md). Plantilla de ejecución más cercana.

### Templates VALIDATION.md (estructura a copiar)
- `.planning/milestones/v0.10-phases/40-provider-state-contrato-providers-enrichment/40-VALIDATION.md` — Ejemplo v0.10 mismo-milestone con `nyquist_compliant: true`. Forma más cercana a las 7 fases shipped.
- `.planning/milestones/v0.10-phases/42-dismiss-tui-read-write-server-amplification/42-VALIDATION.md` — Segundo ejemplo v0.10 con sign-off existente. El planner inspecciona ambos.

### NYQ-01 targets (v0.10)
- `.planning/milestones/v0.10-phases/41-doctor-m-dulo-puro-de-saneo-cli/41-VALIDATION.md` — **NEW.** Evidencia: `.../41-VERIFICATION.md` + `41-0{1,2,3}-SUMMARY.md`. Requirements DOCTOR-01..04.
- `.planning/milestones/v0.10-phases/43-render-provider-state-en-el-dashboard/43-VALIDATION.md` — **NEW.** Evidencia: `.../43-VERIFICATION.md` + `.../43-HUMAN-UAT.md` + `43-0{1,2}-SUMMARY.md`. Requirements PSTATE-05, PSTATE-06.

### NYQ-02 targets (v0.9)
- `.planning/milestones/v0.9-phases/36-tabla-viva-render-seleccion-filtros/36-VALIDATION.md` — **UPDATE** (existente PARTIAL `nyquist_compliant:false`). Evidencia: `.../36-VERIFICATION.md` + `.../36-HUMAN-UAT.md`.
- `.planning/milestones/v0.9-phases/37-attach-handoff-cmux/37-VALIDATION.md` — **UPDATE** (existente draft `nyquist_compliant:false`). Evidencia: `.../37-UAT.md` + `.../37-HUMAN-UAT.md` (sin VERIFICATION formal).
- `.planning/milestones/v0.9-phases/38-workspacehost-lifecycle-idle-needs-input/38-VALIDATION.md` — **NEW.** Evidencia: `.../38-HUMAN-UAT.md` (firmado, sin VERIFICATION formal).
- `.planning/milestones/v0.9-phases/39-paneles-auxiliares-comentarios-logs/39-VALIDATION.md` — **NEW.** Evidencia: `.../39-VERIFICATION.md`.
- `.planning/milestones/v0.9-phases/39.1-cierre-de-gaps-v0-9-wiring-host-tui-fuente-nica-de-alive-sta/39.1-VALIDATION.md` — **NEW.** Evidencia: `.../39.1-VERIFICATION.md` (passed 14/14).

### Estado a reconciliar
- `.planning/STATE.md` `## Deferred Items` — Tabla con 7 filas `nyquist` (36/37 PARTIAL, 38/39/39.1/41/43 MISSING) → saldado. Línea intro "La deuda Nyquist se salda en Phase 47 de v0.11 (NYQ-01/NYQ-02)" → cerrar. NO tocar filas `verification`/`code`/`frontmatter`.

### Project-level (siempre aplicable)
- `.planning/ROADMAP.md` §Phase 47 — Goal + 3 Success Criteria + Notes (Tier 1 doc-only, rutas de archivo de las fases). Source of truth del scope.
- `.planning/REQUIREMENTS.md` — NYQ-01 (línea 30) y NYQ-02 (línea 31). Se auto-marcan al cierre del plan vía `roadmap.update-plan-progress` — verificar, no editar a mano.
- `~/.claude/CLAUDE.md` — Política Tier 1 (fast-forward main local sin push para docs), scope discipline.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Template VALIDATION.md citation-based** — `40-VALIDATION.md` / `42-VALIDATION.md` (v0.10) y los 3 backfills de Phase 33 (`28/30/31-VALIDATION.md`) son ejemplos directos de la estructura: frontmatter YAML con `nyquist_compliant: true` + tabla dimensión→cobertura citando evidencia. Write con frontmatter+body templated; no rediseñar estructura.
- **Patrón VERIFICATION/UAT → VALIDATION** — Phase 33 Bloque B estableció "citar audit/VERIFICATION/UAT como evidencia funcional sin re-ejecutar". Aplica simétrico a las 7 fases.

### Established Patterns
- **Frontmatter YAML toggle** — Las 2 fases PARTIAL (36/37) ya tienen `VALIDATION.md` con `nyquist_compliant: false`; el UPDATE es togglear el flag + rellenar la tabla, preservando el resto. Las 5 MISSING son write nuevo.
- **Sin código** — Cero ficheros bajo `src/`/`test/`/`bin/`. Esta fase no tiene `code_context` de implementación real; toda la "lógica" es estructura de documento.

### Integration Points
- `.planning/STATE.md ## Deferred Items` — único punto de reconciliación de estado compartido (motiva D-01: 1 plan secuencial para evitar contención).

</code_context>

<specifics>
## Specific Ideas

- Espejo explícito de **v0.8 Phase 33 Bloque B** — el usuario/roadmap lo nombra directamente como referencia. Replicar ese shape (no inventar formato nuevo).
- Backfill ejecutable vía `/gsd:validate-phase <N>` por fase (Notes del ROADMAP) — el planner puede apoyarse en ese comando o escribir los VALIDATION.md directamente; ambos producen el mismo artefacto citation-based.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. Las otras filas de `## Deferred Items` (verification covered-by-UAT, code WARNING-01 ciclo ESM, frontmatter cosmético) son deuda distinta deliberadamente fuera de NYQ-01/02 y NO se tocan en Phase 47.

</deferred>

---

*Phase: 47-backfill-de-deuda-nyquist*
*Context gathered: 2026-06-10*
