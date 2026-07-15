# Phase 72: Higiene, DX y verdad documental - Context

**Gathered:** 2026-07-13
**Status:** Ready for planning
**Mode:** --auto (decisiones auto-seleccionadas con opción recomendada; log inline por decisión)

<domain>
## Phase Boundary

Saldar la higiene mecánica y la deriva documental de la Ola 4 del audit adversarial (2026-07-03): blindar el auto-commit del stop hook (HYG-01), borrar features muertas `kodo up --url` y `startHealthLoop` (HYG-02/03), mover los efectos de cierre (color/notify/nudge) de `Stop` a `SessionEnd` (HYG-04), aplicar el batch de endurecimiento de config (HYG-05), el batch de BAJAS mecánicas (HYG-06), strip de `\x1b` en contenido externo del dashboard (HYG-07) y la pasada de verdad documental del README (HYG-08). Cero capacidades nuevas — solo eliminar, endurecer y reconciliar.

</domain>

<decisions>
## Implementation Decisions

### Alcance del batch de BAJAS (HYG-06) — discrepancia B2/B8 y grab-bag B12
- **D-01:** `[auto]` El contrato es **REQUIREMENTS.md HYG-06** (2026-07-06, posterior): `B1, B2, B3, B4, B8, B9, B12 + M12`. La PROPUESTA (2026-07-05) omitía B2 y B8 — REQUIREMENTS los añade deliberadamente y **gana**.
- **D-02:** `[auto]` **B12 «Otros»** es un grab-bag de 4 sub-items (YAML inline comments en el parser de verification; `throttle` asume epoch en `x-ratelimit-reset`; `createLabel` 409-detection amplia; factory GitHub sin bloque `github` → `TypeError` en vez de mensaje canónico). Se descompone en 4 micro-diffs independientes. Si alguno excede el presupuesto de ~5 líneas del criterio de éxito, se **difiere con nota** en el SUMMARY (no se fuerza).
- **D-03 [CRÍTICO para research]:** Los file:line del audit (2026-07-03) tienen **10 días de deriva** (Phases 69-71 + README ya aterrizados). El researcher DEBE re-verificar que cada hallazgo B*/M* **sigue reproduciéndose en HEAD** antes de planificar su fix; los ya corregidos de rebote se marcan N/A con evidencia (p. ej. B6/B10 eran de Ola 1 y podrían estar cerrados).

### HYG-08 — README ya reescrito el 2026-07-10 (commit cb98a6d)
- **D-04:** `[auto]` HYG-08 se ejecuta como **pasada DELTA de verificación, no reescritura**. El README fue reescrito y auditado contra el CLI real el 2026-07-10 y ya cubre: `kodo status` vs `dashboard`, rutas `src/providers/…`, owner/repo público, comandos antes indocumentados (`adopt`/`comment`/`logs`/`dashboard`), y `--dangerously-skip-permissions` vía labels (`kodo:yolo`, `kodo:gsd` «implica yolo»).
- **D-05:** `[auto]` La pasada delta va **al FINAL de la fase** (último plan), porque HYG-04 cambia el comportamiento que el README describe («al cerrar, el stop hook postea comentario y mueve a In Review» → pasa a `SessionEnd`). Verificar cada claim del checklist HYG-08 contra el estado POST-72 y tocar solo lo que quede falso.

### HYG-01 — gate del auto-commit del orquestador
- **D-06:** `[auto]` El gate `KODO_ORCHESTRATOR=1` cubre **todo el bloque** de auto-commit (add + commit), no solo el commit. Sin la variable → **skip silencioso con log** (no error): las sesiones normales en el repo kodo dejan de auto-commitear por turno.
- **D-07:** `[auto]` La variable se **inyecta en `launchOrchestrator`** (el único sitio que lanza el workspace orquestador) como parte del entorno/comando del claude lanzado. Pathspec completo en AMBOS pasos: `git add -- .claude/skills/kodo-orchestrate/` y `git commit -- .claude/skills/kodo-orchestrate/` (literal del criterio de éxito #1; hoy el add es `.claude/skills/` entero y el commit no lleva pathspec — stop.js:285).

### HYG-04 — orden de efectos en SessionEnd
- **D-08:** `[auto]` Los tres efectos (color review, notify, nudge al orquestador) se ejecutan **DESPUÉS del backstop de transición de estado** que Phase 71 (DELIV-04) ya ordenó en `SessionEnd` — la transición provider es lo load-bearing; los efectos cosméticos van al final, cada uno never-throws individual (un fallo de cmux no aborta los demás ni la transición).
- **D-09:** `[auto]` `Stop` conserva lo que no es efecto-de-cierre (guards de re-entrada/idempotencia, mark de estado ligero). El researcher debe mapear el reparto exacto Stop↔SessionEnd sin romper `test/hooks/stop-idempotency.test.js` y coherente con el reordenado de DELIV-04.

### HYG-05 — estrategia de validación de config (incluye B7)
- **D-10:** `[auto]` B7 (deep-merge + validación en `loadConfig`) se implementa como **warn-and-fallback, nunca crash**: config parcial se deep-merge sobre `DEFAULT_CONFIG`; valores inválidos (p. ej. `max_parallel:-5`) caen al default con warn NDJSON. Coherente con la filosofía never-throws del daemon. Reutilizar `src/config-validate.js` existente en vez de duplicar validación.
- **D-11:** `[auto]` M3 (rechazar `__proto__|constructor|prototype` en claves), M5 (chmod 0600 del `.env` cuando contiene `*_secret`) y M14 (`split` con `join` del resto en el parser `.env`) siguen la dirección literal del audit. B5 (strip conservador de comillas en `.env`) se aplica como strip — no solo documentación — porque M14 ya toca ese parser.

### Claude's Discretion
- Orden interno de los planes (batches paralelizables); agrupación de BAJAS en 1 plan vs 2; ubicación exacta del strip `\x1b` (HYG-07/M4) en el pipeline de render de comentarios del dashboard; wording de los warns NDJSON nuevos.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Audit origen (definiciones de TODOS los códigos)
- `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` — **fuente canónica** de A*/M*/B*/T* con file:line, verdicto (CONFIRMADO/PLAUSIBLE) y dirección de fix. Las BAJAS están en §BAJA (líneas ~115-128). MUST read; re-verificar cada file:line contra HEAD (D-03).
- `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` — remediación por olas; la Ola 4 (§línea ~55) es el origen del scope de esta fase. La lista de BAJAS de aquí está SUPERSEDIDA por REQUIREMENTS (D-01).

### Contrato de la fase
- `.planning/REQUIREMENTS.md` §HYG-01..HYG-08 (líneas ~41-48) — requirements de registro; HYG-06 define el batch definitivo.
- `.planning/ROADMAP.md` §Phase 72 — success criteria literales (pathspec exacto de HYG-01, etc.).

### Estado ya-hecho relevante (evitar trabajo duplicado)
- `README.md` @ commit `cb98a6d` (2026-07-10) — reescritura completa auditada contra CLI real; base del delta HYG-08 (D-04/D-05).

### Touchpoints de código
- `src/hooks/stop.js` — auto-commit sin gate (~:263-293), efectos setColor/notify/send a mover (~:157, :166, :238).
- `src/hooks/session-end.js` — destino de HYG-04; ya reordenado por DELIV-04 (Phase 71).
- `src/session/health.js` — `startHealthLoop` (:157) código muerto, borrar (HYG-03).
- `src/cli.js` — `--url` de `kodo up` (:75; ojo: el `--url` de :381 es de otro comando y NO se toca sin verificar).
- `src/config.js` + `src/config-validate.js` — HYG-05 (parser .env :12-28, loadConfig :155-164 según audit; re-verificar).
- `src/labels.js` — B1 (`kodo:opus` whitelist, ~:29-33).
- `src/orchestrator/launch.js` — inyección de `KODO_ORCHESTRATOR=1` (D-07).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/config-validate.js`: validación de config ya existente — B7 debe cablearla, no duplicarla.
- Logger NDJSON + convención never-throws/warn-and-continue: patrón establecido para los warns de HYG-05 y los efectos never-throws de HYG-04.
- `test/hooks/stop-idempotency.test.js` y tests de session-end (Phase 71): guardrails existentes para el reparto Stop↔SessionEnd.

### Established Patterns
- Efectos cmux siempre `catch`-eados individualmente (patrón de stop.js actual) — se conserva al moverlos a SessionEnd.
- Diffs quirúrgicos con test por hallazgo (patrón de las olas 1-3 del mismo audit).

### Integration Points
- `SessionEnd` hook: DELIV-04 (Phase 71) ya reordenó su secuencia — HYG-04 se inserta DESPUÉS de la transición de estado (D-08).
- `launchOrchestrator`: mismo módulo tocado en la feature de la tecla `O` (ref persistido, commit 0524776) — no romper `persistOrchestratorRef`.

</code_context>

<specifics>
## Specific Ideas

- El criterio de éxito #1 fija el pathspec **literal** `git commit -- .claude/skills/kodo-orchestrate/` (subdirectorio de la skill, no `.claude/skills/` entero).
- M12 es literalmente permitir `[-–—]` (guion/en-dash/em-dash) en el parser de roadmap.
- «Borrar, no cablear» (decisión 2026-07-05) es firme para HYG-02/03: cero intentos de "arreglar" `--url` o el health loop.

</specifics>

<deferred>
## Deferred Ideas

- B11 (`follow.js` re-emisión de líneas duplicadas) — PLAUSIBLE en el audit, NO está en HYG-06; queda fuera salvo que REQUIREMENTS cambie.
- B6/B10 (path traversal en `kodo logs`, 500 con `err.message` crudo) — eran de Ola 1; si el researcher los encuentra sin cerrar, son candidatos a backlog, no a esta fase (scope fijado por HYG-06).

</deferred>

---

*Phase: 72-higiene-dx-y-verdad-documental*
*Context gathered: 2026-07-13*
