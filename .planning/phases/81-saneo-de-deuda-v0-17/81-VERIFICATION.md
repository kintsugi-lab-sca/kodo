---
phase: 81-saneo-de-deuda-v0-17
verified: 2026-07-24T08:20:05Z
status: human_needed
score: 26/26 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Decidir si los 2 warnings del propio code review de la fase (81-REVIEW.md, WR-01 y WR-02, ambos aún abiertos en HEAD) bloquean el cierre de DEBT-01/DEBT-03 o se aceptan/difieren explícitamente a backlog"
    expected: "O bien se corrige el typedef `TaskHandoff` (state.js:53, sigue documentando la semántica PRE-DEBT-01, contradictoria con el comportamiento ya shippeado) y se alinea `deriveAnyNext` (select.js:258) con el colapso de whitespace de `nextCell` (format.js), o un humano acepta explícitamente dejarlos como deuda conocida para v0.18+"
    why_human: "Es un juicio de alcance/prioridad (¿este 'saneo de deuda' debe cerrar la deuda que su propia revisión encontró, o puede difpage a un futuro item?), no una comprobación programática — el código de ambos hallazgos está confirmado y reproducido abajo, la decisión de aceptar o arreglar es del mantenedor"
---

# Phase 81: Saneo de deuda v0.17 Verification Report

**Phase Goal:** Cerrar los 4 items menores de deuda técnica que el audit de v0.17 trazó «→ backlog v0.18», sin regresionar invariantes (locks de v0.16, dashboard never-throws). El flaky `gsd-lock-race` se toca SOLO con la causa entendida vía `/gsd-debug`, jamás a ciegas — protege el invariante de locks de v0.16.
**Verified:** 2026-07-24T08:20:05Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

**DEBT-01 (81-01-PLAN.md, 7 truths)**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Cierre LLM sin `NEXT:` → `next: null` → BORRA el `next` previo | ✓ VERIFIED | `src/session/state.js`: `entry.next === null → nextValue = null`; test `CLEAR: next: null explícito... BORRA el previo` pass |
| 2 | Cierre mecánico (backstop) OMITE `next` → PRESERVA el previo | ✓ VERIFIED | `session-end.js:388` retorna `next:null, authored:'auto'`; call-site `...(authored==='llm' ? {next} : {})` omite la clave en rama mecánica; test `PRESERVE: campo next AUSENTE... PRESERVA` pass |
| 3 | `next` string no-vacío sobrescribe el previo | ✓ VERIFIED | `state.js` rama `else → nextValue = entry.next`; test `OVERWRITE` pass |
| 4 | `null` explícito borra / campo ausente preserva / primera escritura sin prev → `null` | ✓ VERIFIED | `state.js:449-459`; tests `:265`, `:288`, `:396` pass |
| 5 | Discriminación por PRESENCIA, no truthiness (`??` eliminado de la decisión) | ✓ VERIFIED | `grep "'next' in entry"` → match en `state.js`; `grep "entry.next ??"` en la línea de decisión → 0 matches (solo en comentarios explicativos) |
| 6 | Valor post-merge alimenta el nudge LIVE-07 (clear→null, preserve→prev.next) | ✓ VERIFIED | `session-end.js:420-422` `effectiveNext = upsertResult.value.next`; tests `LIVE-07: ... CLEAR` / `... PRESERVE` pass |
| 7 | Discriminador de autoría sobrevive fuera de `withFileLock`, entry construida condicionalmente (nunca `r.value.next` incondicional) | ✓ VERIFIED | `session-end.js:410` `...(r.value.authored === 'llm' ? { next: r.value.next } : {})` — spread condicional confirmado por lectura directa |

**DEBT-02 + DEBT-03 (81-02-PLAN.md, 13 truths incl. 1 backstop)**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `nextCell` colapsa toda secuencia de whitespace a un espacio + trim | ✓ VERIFIED | `format.js:263` `session.next.replace(/\s+/g,' ').trim()`; tests `'a\nb\tc'→'a b c'` pass |
| 2 | Celda vacía `''` para ausente/null/undefined/''/solo-whitespace/no-string, sin placeholder | ✓ VERIFIED | `format.js:262` guard `typeof !== 'string' → ''`; tests confirmaron `''` en todos los casos, sin glyph |
| 3 | Colapso usa `/\s+/g` (clase JS completa), no normaliza Unicode, truncado sigue en columna Ink | ✓ VERIFIED | Código usa literalmente `/\s+/g`; columna Ink de ancho fijo no tocada (fuera del diff) |
| 4 | Dato persistido queda VERBATIM — colapso es render-only | ✓ VERIFIED | `App.js:756` enrich sigue con SOLO `stripControlChars`; diff de `App.js` en Task 1 de 81-02 vacío (confirmado por SUMMARY y por inspección — el colapso solo vive en `format.js`) |
| 5 | `nextCell` sigue pura (sin color, sin efectos) | ✓ VERIFIED | Lectura directa: función de una línea, sin I/O, sin color |
| 6 | Comentario App.js :735 corregido (deja de afirmar «una vez por tick») | ✓ VERIFIED | `App.js:735-739` ahora describe lectura síncrona en CADA render, piggyback sobre `usePoll` |
| 7 | Typedef `overlaySnapshot` gana `render?: 'markdown'\|'plain'` | ✓ VERIFIED | `SessionTable.js:817` — campo presente, espeja literalmente `plan.js:48` `PlanResult` |
| 8 | `next` string no-vacío renderiza verbatim tras colapso+trim | ✓ VERIFIED | test `'plan ok'→'plan ok'` pass |
| 9 | No hay estado de carga async — lectura síncrona piggyback | ✓ VERIFIED | `readTasksFn({})` síncrono, sin spinner/skeleton en el código |
| 10 | Filas degradan independientemente (sin acoplamiento cross-fila) | ✓ VERIFIED | test `rowCells sin next → celda "" (degradación limpia)` pass, no hay estado compartido entre filas |
| 11 | `\n`/`\t`/`\r`/multi-espacio colapsan a un espacio — fix núcleo DEBT-03 | ✓ VERIFIED | tests de colapso pass; ver también hallazgo WR-02 abajo (edge no cubierto por este truth literal) |
| 12 | Comportamiento de columna condicional de Phase 75 inalterado (cero→oculta, uno/muchos→celdas independientes, sin copy singular/plural) | ✓ VERIFIED (literal) — ⚠️ ver Anti-Patterns/WR-02 | Los 3 criterios literales del truth se sostienen; PERO existe una divergencia adyacente no cubierta por su wording literal — ver hallazgo WR-02 |
| 13 (backstop) | DEBT-02 doc-only, sin edge runtime — evidencia = suite verde sin modificar tests | ✓ VERIFIED | Suite completa 2364/2364 pass sin tocar ningún test en Task 2 de 81-02 |

**DEBT-04 (81-03-PLAN.md, 6 truths incl. 2 backstop)**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Diagnóstico de causa raíz DOCUMENTADO vía `/gsd-debug` (entregable = artefacto, no test verde) | ✓ VERIFIED | `.planning/debug/gsd-lock-race-cr01.md` existe, estructura canónica completa, evidencia reproducida (no inferida) |
| 2 | `src/gsd/lock.js` SIN modificar salvo causa confirmada sin alterar semántica v0.16 | ✓ VERIFIED | `git diff --quiet -- src/gsd/lock.js` → exit 0 |
| 3 | Si causa es de harness, fix va al test; si no-repro, documentar + instrumentación barata | ✓ VERIFIED (n/a — causa SÍ fue de producto, confirmada, no harness) | Diagnóstico confirma causa de producto (ventana briefly-empty en `stealLock`); ni test ni `lock.js` tocados; outcome documentado explícitamente |
| 4 | Invariante "exactamente-uno-adquiere" es order-independent | ✓ VERIFIED | Test asevera solo el conteo (`=1`), no qué proceso específico gana; sin cambios |
| 5 (backstop) | Diagnóstico registra si dos stealers pueden AMBOS adquirir (colisión move-aside→create) | ✓ VERIFIED (evidencia explícita, no abstención) | Artefacto §Evidencia ítem 3: traza de dos `FRESH_CREATE_WON` simultáneos, confirmado con experimento instrumentado |
| 6 (backstop) | Diagnóstico anota el caso degenerado N=1 / cubre N=2 y N=5 | ✓ VERIFIED (evidencia explícita) | Artefacto: "100% de los fallos en N=5; cero fallos en N=2" — ambos casos (:143 N=2, :153 N=5) explícitamente distinguidos |

**Score:** 26/26 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/session/state.js` | Merge de 3 estados + JSDoc reescrito | ✓ VERIFIED | Discriminación por presencia confirmada; JSDoc tabla de 3 estados presente (líneas ~403-422) |
| `src/hooks/session-end.js` | Discriminador de autoría + build condicional + effectiveNext | ✓ VERIFIED | `authored:'llm'\|'auto'` flag + spread condicional confirmados |
| `test/state/handoff-state.test.js` | Casos reexpresados + nuevos (24 tests) | ✓ VERIFIED | 24/24 pass |
| `test/hooks/session-end-handoff.test.js` | Caso de mapeo de autoría | ✓ VERIFIED | Incluido en 53/53 pass (con session-end.test.js) |
| `src/cli/dashboard/format.js` | `nextCell` con colapso + JSDoc | ✓ VERIFIED | Colapso `/\s+/g`+trim confirmado |
| `test/dashboard-format.test.js` | Casos de whitespace-collapse | ✓ VERIFIED | 58/58 pass (suite completa del fichero) |
| `src/cli/dashboard/App.js` | Comentario :735 corregido | ✓ VERIFIED | Confirmado, `stripControlChars` intacto |
| `src/cli/dashboard/SessionTable.js` | Typedef `overlaySnapshot` con `render?` | ✓ VERIFIED | Campo presente en 2 ubicaciones del fichero |
| `.planning/debug/gsd-lock-race-cr01.md` | Artefacto `/gsd-debug` canónico | ✓ VERIFIED | Estructura completa, 10KB, evidencia reproducida |
| `.planning/phases/81-saneo-de-deuda-v0-17/81-DEBT-04-DIAGNOSIS.md` | Nota de resolución | ✓ VERIFIED | Outcome, condiciones, gate D-09/D-10 documentados |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `session-end.js` (rama LLM/mecánica) | `upsertTaskHandoff` | discriminación por `'next' in entry` | ✓ WIRED | Confirmado por lectura + tests de mapeo de autoría |
| `upsertTaskHandoff` return `{ok,value}` | `effectiveNext` → `buildStopNudgeText` | valor post-merge | ✓ WIRED | `session-end.js:420-422` lee `upsertResult.value.next` |
| `state.json next` (verbatim) | celda Ink ancho fijo | `App.js enrich (stripControlChars)` → `rowCells` → `nextCell` (colapso) | ✓ WIRED | Cadena completa confirmada por lectura de los 3 ficheros |
| `SessionTable.js` typedef `overlaySnapshot` | `plan.js:48` `PlanResult` | espejo literal `render?: 'markdown'\|'plain'` | ✓ WIRED | Campo idéntico confirmado en ambos ficheros |
| harness `raceGsdStealDeadHolder` | `stealLock` CAS (`lock.js:283-351`, READ-ONLY) | siembra dead-PID → spawnea N hijos → asevera 1 acquired | ✓ WIRED (sin cambios) | Test intacto, `lock.js` intacto — confirmado por `git diff --quiet` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Writer de 3 estados (DEBT-01) | `node --test test/state/handoff-state.test.js` | 24/24 pass | ✓ PASS |
| Mapeo de autoría en el hook (DEBT-01) | `node --test test/hooks/session-end-handoff.test.js test/hooks/session-end.test.js` | 53/53 pass | ✓ PASS |
| Colapso de whitespace en `nextCell` (DEBT-03) | `node --test test/dashboard-format.test.js` | 58/58 pass | ✓ PASS |
| Suite completa (regresión global) | `node --test $(find test -name '*.test.js' -type f)` | 2364/2365 pass, 1 skip pre-existente, 0 fail | ✓ PASS |
| Flaky CR-01 (DEBT-04) — corrida puntual (no determinista por diseño) | `node --test test/gsd-lock-race.test.js` | 4/4 pass en esta corrida | ✓ PASS (esperado: ~48% de fallo bajo carga en loop, per diagnóstico; el entregable es el diagnóstico, no un test consistentemente verde) |
| Divergencia `deriveAnyNext` vs `nextCell` en whitespace-only `next` (hallazgo del propio code review, WR-02) | `deriveAnyNext([{next:'\n'}])` vs `nextCell({next:'\n'})` | `true` vs `''` | ⚠️ Confirma WR-02 (81-REVIEW.md) — ver Anti-Patterns |
| `git diff --quiet -- src/gsd/lock.js` (invariante v0.16) | `git diff --quiet -- src/gsd/lock.js; echo $?` | `0` | ✓ PASS |
| `git diff --quiet -- test/gsd-lock-race.test.js test/helpers/lock-race-child.mjs` | mismo comando | `0` | ✓ PASS (cero remedios a ciegas, cero `.skip`) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| DEBT-01 | 81-01-PLAN.md | Semántica clear/stale de `next` en `upsertTaskHandoff` | ✓ SATISFIED | Merge de 3 estados + mapeo de autoría, 77 tests verdes (24+53) |
| DEBT-02 | 81-02-PLAN.md | Doc-drift Phase 75 (comentario App.js + typedef `overlaySnapshot`) | ✓ SATISFIED | Ambas correcciones confirmadas por lectura directa; suite sin modificar tests (D-12) |
| DEBT-03 | 81-02-PLAN.md | `nextCell` colapsa whitespace en render | ✓ SATISFIED | Colapso confirmado, 58 tests verdes; ver nota WR-02 (edge adyacente no cubierto) |
| DEBT-04 | 81-03-PLAN.md | Diagnóstico de causa raíz del flaky `gsd-lock-race`, `lock.js` READ-ONLY | ✓ SATISFIED | Artefacto + nota de resolución completos; causa CONFIRMADA (carrera real en `stealLock`); `lock.js` intacto |

No orphaned requirements — `REQUIREMENTS.md` mapea exactamente DEBT-01..04 → Phase 81, y las tres plans cubren las cuatro IDs sin remanentes.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/session/state.js` | `:53` (typedef `TaskHandoff`) | Doc-drift: el comentario del campo `next` sigue documentando la semántica PRE-DEBT-01 ("un `next` ausente/null NO borra el previo"), que la propia fase invirtió — un `null` explícito SÍ borra ahora. Hallazgo **WR-01** del propio `81-REVIEW.md`, nunca corregido tras la revisión (HEAD = `781474b`, sin commit posterior que lo toque). | ⚠️ WARNING | Confunde a futuros mantenedores que lean el typedef de consumo en vez del JSDoc de `upsertTaskHandoff` (que SÍ fue actualizado correctamente) |
| `src/cli/dashboard/select.js` | `:258` (`deriveAnyNext`) vs `src/cli/dashboard/format.js` (`nextCell`) | Divergencia de predicado: `deriveAnyNext` cuenta por longitud RAW (`r.next.length > 0`), mientras `nextCell` colapsa whitespace antes de decidir vacío. Un `next` solo-whitespace (p.ej. hand-editado `"\n"`) produce columna VISIBLE con celda EN BLANCO. Confirmado por ejecución directa: `deriveAnyNext([{next:'\n'}])` → `true`, `nextCell({next:'\n'})` → `''`. Hallazgo **WR-02** del propio `81-REVIEW.md`, nunca corregido. | ⚠️ WARNING | Cosmético (no crash, no pérdida de datos, no descuadre de tabla — el fix núcleo de DEBT-03 SÍ funciona), pero está dentro del propio threat model que DEBT-03 declara defender ("un `next` hand-editado... no descuadra la tabla") |

No se encontraron marcadores de deuda (`TBD`/`FIXME`/`XXX`) sin referenciar, ni placeholders, ni implementaciones vacías en los ficheros modificados por esta fase. Los matches de "TODO" en `App.js`/`SessionTable.js`/`dashboard-format.test.js` son la palabra española "todo" (= "all"), no el marcador en inglés — falsos positivos descartados.

### Human Verification Required

### 1. Disposición de WR-01/WR-02 (hallazgos del code review propio de la fase, `81-REVIEW.md`, ambos aún sin resolver en HEAD)

**Test:** Revisar `.planning/phases/81-saneo-de-deuda-v0-17/81-REVIEW.md` (2 warnings, 2 info, 0 blockers) y decidir si:
(a) se corrige el typedef `TaskHandoff` en `src/session/state.js:53` para reflejar la semántica de 3 estados que DEBT-01 shippeó, y
(b) se alinea el predicado `deriveAnyNext` (`src/cli/dashboard/select.js:258`) con el colapso de whitespace de `nextCell`, o se acepta explícitamente dejar ambos como deuda conocida (con nota en `STATE.md` §Deferred Items o un nuevo item de backlog).

**Expected:** Una decisión explícita — arreglar antes de considerar la fase "cerrada", o diferir con constancia escrita (igual que se hizo con 75/WR-02 y 75/WR-04, que SÍ fueron absorbidos como DEBT-02 de esta misma fase).

**Why human:** Es un juicio de alcance y prioridad, no una comprobación programática. La evidencia de ambos hallazgos está confirmada y reproducida arriba (Anti-Patterns); lo que falta es la decisión del mantenedor sobre si esta fase de "saneo de deuda" debe cerrar también la deuda que su propia revisión descubrió, dado que ninguno de los dos es requisito literal de los `must_haves` declarados en los PLAN.md (por eso no se clasifican como gaps/blockers), pero sí tocan directamente los mismos ficheros/símbolos que DEBT-01 y DEBT-03 shippearon.

### Gaps Summary

No hay gaps bloqueantes: los 26 truths declarados en los 3 PLAN.md (incluidos los 3 truths `backstop`) están verificados con evidencia de código y de tests — no por inferencia. Las 4 requirements (DEBT-01..04) están satisfechas. Todos los artefactos existen, son sustantivos y están conectados (wired). La suite completa está verde (2364/2365, 1 skip pre-existente no relacionado) y el invariante de locks de v0.16 está protegido (`git diff --quiet -- src/gsd/lock.js` verde).

El único punto que impide un `passed` limpio es que el propio code review de la fase (`81-REVIEW.md`, generado el mismo día tras completar los 3 plans) encontró 2 warnings reales — confirmados aquí por ejecución directa, no solo por lectura del reporte — que tocan exactamente los símbolos que DEBT-01 y DEBT-03 shippearon, y que quedaron sin corregir ni diferir explícitamente. Ninguno de los dos es un blocker de producto (0 crash, 0 pérdida de datos, 0 descuadre de tabla — el invariante "never-throws" del dashboard se sostiene), pero dejar una fase de "saneo de deuda" con deuda nueva de su propia cosecha sin una decisión explícita del mantenedor no es coherente con el objetivo declarado de la fase. Se enruta como verificación humana (escalation gate), no como gap bloqueante.

---

_Verified: 2026-07-24T08:20:05Z_
_Verifier: Claude (gsd-verifier)_
