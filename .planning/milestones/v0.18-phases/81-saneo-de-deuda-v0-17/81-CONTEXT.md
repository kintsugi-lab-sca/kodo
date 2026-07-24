# Phase 81: Saneo de deuda v0.17 - Context

**Gathered:** 2026-07-24
**Status:** Ready for planning
**Mode:** --auto (decisiones auto-seleccionadas sobre la opción recomendada; constraints LOCKED de v0.18 y decisiones D-02/D-03 de Phase 74 respetados sin re-discutir)

<domain>
## Phase Boundary

Cerrar los 4 items menores que el audit de v0.17 trazó «→ backlog v0.18» (DEBT-01..04), sin regresionar invariantes: locks de v0.16 (`withStateLock`, `acquireGsdLock`/steal CAS), dashboard never-throws, y la disciplina de saneo de contenido LLM (Phase 78).

1. **DEBT-01** — semántica de clear/stale de `next` decidida y aplicada en `upsertTaskHandoff` (`src/session/state.js:418`): un cierre sin `NEXT:` no deja un `next` obsoleto para siempre.
2. **DEBT-02** — doc-drift de Phase 75 corregido: comentario de App.js «lee tasks UNA vez por tick» (75/WR-02) y typedef del prop `overlaySnapshot` sin `render` (75/WR-04). Solo documentación.
3. **DEBT-03** — `nextCell` colapsa `\n`/`\t` en el render de fila (75/WR-03): un `next` hand-editado en `state.json` no descuadra la tabla.
4. **DEBT-04** — diagnóstico de causa raíz del flaky `test/gsd-lock-race.test.js` («concurrent dead-holder steal», CR-01) vía `/gsd-debug`; solo se toca con la causa entendida, jamás a ciegas.

**Fuera de la fase:** fidelidad markdown del overlay (FUT-01, solo si molesta), `kodo doctor --fix` asistido config↔projects (FUT-02), cualquier cambio a la semántica de locks de v0.16 sin causa raíz confirmada, cambios al sidebar doctor (Phases 79-80, cerradas), endpoints nuevos, deps npm nuevas.

</domain>

<decisions>
## Implementation Decisions

### Semántica de clear del `next` (DEBT-01)
- **D-01:** El contrato de `upsertTaskHandoff` pasa de la asimetría binaria actual (`entry.next ?? prev.next` — cualquier ausencia preserva) a **discriminación en tres estados**: `next: string` no-vacío → sobrescribe (como hoy); `next: null` explícito → **clear deliberado** (borra el previo, persiste `null`); campo `next` **ausente** (`undefined`) → preserva el previo (como hoy). El `??` actual conflaciona `null` y `undefined`; la discriminación exige `entry.next !== undefined` (o `'next' in entry`).
- **D-02:** El caller (`src/hooks/session-end.js`) mapea la autoría al contrato: **handoff redactado por el LLM sin línea `NEXT:`** → pasa `next: null` (el LLM afirmó activamente que no hay siguiente paso → clear); **backstop mecánico** (el LLM no redactó bloque; el hook appendea el mínimo sin `NEXT:` per D-03 de Phase 74) → omite el campo `next` (esa sesión «no dijo nada» → preserva). Esto conserva intacta la razón de ser de la asimetría original (74/WR-02: un cierre mecánico no debe resucitar ni borrar un `NEXT:` real) y cierra el caso obsoleto: el LLM que cierra sin next limpia el puntero.
- **D-03:** Alternativas descartadas: (a) staleness por timestamp + atenuado en TUI — más maquinaria, toca render y poll, YAGNI para un item menor; (b) siempre-borrar ante ausencia — regresiona D-03 de Phase 74 (el backstop mecánico borraría un `NEXT:` válido de una sesión anterior de la misma tarea).
- **D-04:** Sin bump de schema: `null` ya es valor legal del campo (`next: string|null`). JSDoc de `upsertTaskHandoff` y de `session-end.js` actualizados con la tabla de tres estados; los tests de `test/state/handoff-state.test.js` ganan los casos `null`-clear y `undefined`-preserve. Telemetría invariante: el `next` sigue sin loguearse jamás (T-71-18).

### Colapso de whitespace en el render (DEBT-03)
- **D-05:** El colapso vive en `nextCell` (`src/cli/dashboard/format.js:258`) — el punto de proyección al render, mismo criterio que el enunciado del item («en el RENDER de fila»). Política: reemplazar toda secuencia de whitespace (`/\s+/g`, cubre `\n`, `\t`, `\r` y espacios múltiples) por un espacio único + `trim`; si el resultado queda vacío → `''` (celda vacía, sin placeholder — SC5 intacto).
- **D-06:** El dato persistido en `state.json` queda **verbatim** — no se sanea al escribir (`upsertTaskHandoff` no toca el contenido) ni al mergear en el enrich de App.js (que sigue aplicando solo `stripControlChars`, carril de Phase 78 intacto). Fix puro de render: una fuente hand-editada rara no justifica mutar el dato de origen.
- **D-07:** `nextCell` sigue pura, sin color propio (color-isolation D-12 de Phase 75) y never-throws (input no-string → `''` como hoy).

### Diagnóstico del flaky `gsd-lock-race` (DEBT-04)
- **D-08:** El entregable es el **diagnóstico documentado**, no el fix: se corre `/gsd-debug` contra «concurrent dead-holder steal (CR-01)» (`test/gsd-lock-race.test.js:142`) con intento de reproducción bajo carga (repetición N veces / suite en paralelo — el flaky se manifiesta «bajo carga», y hay precedente de 12 runs verdes seguidos en frío 2026-07-06). El artefacto de debug + una nota de resolución en el directorio de fase satisfacen DEBT-04.
- **D-09:** Gate del fix (constraint LOCKED, no re-discutir): **solo** se aplica un cambio si la causa raíz queda entendida Y el cambio no altera la semántica de locks de v0.16 (`src/gsd/lock.js`: `acquireGsdLock` atómico, steal CAS tmp+rename, guarda ABA). Si la causa es del harness del test (timing de arranque de procesos, no del producto), el fix legítimo es al test. Prohibido a ciegas: retries, `skip`, subir timeouts, o tocar `lock.js` sin causa.
- **D-10:** Si tras un intento honesto no reproduce, el outcome válido es documentar la no-repro (condiciones intentadas, hipótesis abiertas) y, si es barato, dejar instrumentación de bajo coste en el propio test (p. ej. volcar los verdicts al fallar) para la próxima manifestación. El item queda cerrado como «diagnosticado: no reproducible en frío; instrumentado», sin tocar producción.

### Doc-drift de Phase 75 (DEBT-02)
- **D-11:** Cambios quirúrgicos doc-only, cero comportamiento: (a) el comentario de `src/cli/dashboard/App.js:735` («lee el bloque tasks … UNA vez por tick») se corrige para describir la realidad del render que 75/WR-02 señaló — el ejecutor lee el hallazgo exacto en `75-REVIEW.md` antes de redactar; (b) el typedef del prop `overlaySnapshot` en `src/cli/dashboard/SessionTable.js:817` gana `render?: 'markdown'|'plain'` — espejo del `PlanResult` de `src/cli/dashboard/plan.js:48` que ya lo declara.
- **D-12:** Tier 1 (riesgo bajo): sin tests nuevos — la suite existente debe seguir verde sin modificación, prueba de que no hubo cambio de comportamiento.

### Claude's Discretion
Redacción exacta de comentarios/JSDoc corregidos, estructura y naming de los tests nuevos de DEBT-01/DEBT-03, agrupación de los items en planes (candidato natural: DEBT-01+02+03 como carril de código quirúrgico, DEBT-04 como carril de diagnóstico aparte — el planner decide), y el formato del artefacto de diagnóstico de DEBT-04 dentro de las convenciones de `/gsd-debug`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning (scope y constraints)
- `.planning/ROADMAP.md` §Phase 81 — goal, success criteria 1-4, ortogonalidad (sin dependencias)
- `.planning/REQUIREMENTS.md` §Saneo de deuda v0.17 (DEBT-01..04) + §Out of Scope
- `.planning/STATE.md` §Deferred Items (los 4 items absorbidos, con sus punteros de origen) + §Critical Invariants (escrituras `state.json` bajo `withStateLock`, contenido LLM saneado, TUI never-throws) + §Accumulated Context (constraint LOCKED: DEBT-04 solo diagnóstico)

### Origen de la deuda (hallazgos exactos)
- `.planning/milestones/v0.17-MILESTONE-AUDIT.md` — el audit que trazó los 4 items «→ backlog v0.18»
- `.planning/milestones/v0.17-phases/75-superficie-del-next-dashboard-y-nudge/75-REVIEW.md` — WR-02 (comentario App.js), WR-03 (`nextCell` whitespace), WR-04 (typedef sin `render`): el texto exacto de cada hallazgo
- `.planning/milestones/v0.17-phases/74-handoff-acumulativo-al-cierre/74-REVIEW.md` — WR-02 de Phase 74: la razón de ser de la asimetría del upsert que D-01/D-02 refinan (no invalidan)

### Código a tocar (DEBT-01)
- `src/session/state.js` — `upsertTaskHandoff` (:418, JSDoc :400-416 con la asimetría documentada y la razón D-02/D-03 de Phase 74)
- `src/hooks/session-end.js` — caller único (`stateWriterFn`, :302); aquí vive la distinción autoría-LLM vs backstop mecánico que D-02 mapea al contrato
- `test/state/handoff-state.test.js` — suite existente del writer (los casos nuevos se añaden aquí)

### Código a tocar (DEBT-02, DEBT-03)
- `src/cli/dashboard/format.js` — `nextCell` (:258) + `rowCells` (:271)
- `src/cli/dashboard/App.js` — comentario :735 (WR-02) y enrich del `next` (:751, NO se toca el saneo)
- `src/cli/dashboard/SessionTable.js` — typedef del prop `overlaySnapshot` (:817)
- `src/cli/dashboard/plan.js` — `PlanResult` (:48) con el `render?` que el typedef debe espejar

### Diagnóstico (DEBT-04)
- `test/gsd-lock-race.test.js` — el flaky (:142 «concurrent dead-holder steal (CR-01)»)
- `src/gsd/lock.js` — `acquireGsdLock`/steal CAS de v0.16 (SOLO lectura salvo causa raíz confirmada; invariante protegido)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withStateLock` (`src/session/state.js`) — `upsertTaskHandoff` ya corre dentro; DEBT-01 no toca la primitiva, solo la lógica de merge bajo el lock
- `test/state/handoff-state.test.js` — harness completo del writer (mock de state dir, casos de asimetría existentes) listo para los casos nuevos
- Patrón de celdas puras en `format.js` (`progCell`, `taskCell`) — `nextCell` sigue ese molde; el colapso es una transformación local más

### Established Patterns
- La asimetría actual de `next` está **documentada como diseño** (JSDoc :403-409 citando 74/WR-02 y D-02/D-03) — DEBT-01 es un refinamiento consciente de ese diseño, no un bugfix contra él; el JSDoc debe reescribirse con la tabla de tres estados
- Saneo por capas (Phase 78): `stripControlChars` en el enrich (App.js) neutraliza control chars; el colapso de whitespace en `nextCell` es la capa de layout que faltaba — capas complementarias, no redundantes
- Tier 1 doc-only con suite verde sin modificación como evidencia (precedente v0.11 Phase 47)
- `/gsd-debug` con estado persistente para el diagnóstico del flaky (constraint de origen: NO arreglar a ciegas)

### Integration Points
- `src/hooks/session-end.js:302` — único call-site de `upsertTaskHandoff` en producción; el parse del bloque handoff (presencia/ausencia de `NEXT:` y autoría LLM vs backstop) ya ocurre ahí — D-02 solo cambia qué se pasa en `entry`
- Consumidores del `next` persistido: enrich de App.js (dashboard) y nudge del orquestador (LIVE-07, vía el return de `upsertTaskHandoff`) — un `null`-clear se propaga limpio a ambos (celda vacía / nudge genérico byte-idéntico)
- La tabla del dashboard consume `nextCell` vía `rowCells` — un solo punto de cambio para DEBT-03

</code_context>

<specifics>
## Specific Ideas

- El enunciado de DEBT-03 acota el alcance real: el carril keystroke ya se cerró en Phase 78; esto solo es alcanzable por `state.json` hand-editado — fix de render barato, no un endurecimiento de seguridad.
- Precedente de repro del flaky: 2026-07-06 «Lock race tests pass under stress: 12 consecutive runs, 0 failures» — la reproducción probablemente exija carga real (suite completa en paralelo), no repetición en frío; el diagnóstico debe registrar las condiciones intentadas.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (FUT-01 fidelidad markdown, FUT-02 doctor config↔projects y FUT-03 puerta LLM ya trazados en REQUIREMENTS §Future.)

</deferred>

---

*Phase: 81-Saneo de deuda v0.17*
*Context gathered: 2026-07-24*
