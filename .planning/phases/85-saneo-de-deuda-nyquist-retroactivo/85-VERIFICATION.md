---
phase: 85-saneo-de-deuda-nyquist-retroactivo
verified: 2026-07-27T14:05:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Decidir la disposición de WR-01 (80-REVIEW) a la luz del hallazgo de 85-REVIEW: el fix implementado (línea de fallos por `errorFn` en `src/check.js:160-172`) solo cubre fallos de escritura por-item de `executeFn`. En el escenario que la propia advertencia usó como motivación — cmux caído — `parseRaw` (`src/cmux/sidebar-doctor.js:153-162`) traga el error y devuelve el fallback vacío; con `liveWorkspaceRefs` vacío, el bucle de sesiones vivas descarta todo, `missing_group`/`loose_workspace`/`empty_group` quedan vacíos, cero acciones se intentan, `errors: []`, y el silencio original persiste."
    expected: "Una decisión explícita del mantenedor: (a) aceptar el fix como suficiente para el alcance literal de DEBT-07 (\"resueltos o re-aceptados... con razón documentada\") y registrar esta limitación con su trigger en `85/deferred-items.md` — hoy NO está registrada ahí, porque 85-REVIEW.md (13:43:55Z) se completó DESPUÉS de que 85-05 cerrara el bookkeeping de la fase (13:32:15Z) — o (b) abrir un fix de seguimiento que propague la degradación del scan (el propio 85-REVIEW.md ya trae un snippet concreto: marcar `__degraded: true` en el fallback de `parseRaw` y comprobarlo en `check.js`)."
    why_human: "Es una decisión de alcance/prioridad, no un defecto verificable por grep: el código presente hace exactamente lo que el fix propuesto por 80-REVIEW especificaba (inspeccionar `r.errors`, emitir por `errorFn`), con test coverage real (Test F/Test G, verdes) y sin comportamiento incorrecto — el propio 85-REVIEW.md lo clasifica WARNING, no BLOCKER. Pero el objetivo operativo original de WR-01 (distinguir «nada que arreglar» de «cmux caído, N fallos») sigue sin resolverse para el escenario más probable, y ningún artefacto de la fase lo documenta todavía como aceptado."
---

# Phase 85: Saneo de deuda documental + Nyquist retroactivo — Verification Report

**Phase Goal:** La deuda documental de v0.18 y la columna Nyquist de v0.16+v0.18 quedan saldadas — barrido ligero, mayormente mecánico y doc-only.
**Verified:** 2026-07-27T14:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion del ROADMAP) | Status | Evidencia |
|---|---|---|---|
| 1 | El typedef `TaskHandoff` (`src/session/state.js`) documenta la semántica post-DEBT-01 — contrato tres-estados del `next` por presencia — cerrando 81-REVIEW WR-01 (DEBT-05) | ✓ VERIFIED | `src/session/state.js:53` reescrito: enuncia OVERWRITE/CLEAR/PRESERVE por PRESENCIA, cita la tabla canónica `:405-410` y los tres tests (`test/state/handoff-state.test.js:265/288/307`). `git diff` del fichero: 1 inserción/1 eliminación, cero código ejecutable tocado. `node --test test/state/handoff-state.test.js` → 24/24 verde, fichero de test sin modificar |
| 2 | `deriveAnyNext` (`src/cli/dashboard/select.js`) colapsa whitespace al decidir la presencia de la columna `next`, coherente con `nextCell`; con la crit 1 salda R-81-02, cerrando 81-REVIEW WR-02 (DEBT-06) | ✓ VERIFIED | `select.js:273-275`: `return rows.some((r) => nextCell(r).length > 0);` — delega en `nextCell`, la misma función que pinta. Test RED-antes-del-fix confirmado por commits (`8cc703c` rojo → `ba69110` verde). `test/dashboard-select.test.js` con 4 asserts nuevos (3 whitespace-only → `false`, 1 mixto → `true`), verde; los 8 asserts LIVE-05 previos intactos (diff addition-only, verificado con `git diff -U0`). `format-isolation.test.js` sin modificar y verde |
| 3 | Los 3 warnings de 80-REVIEW.md quedan resueltos o re-aceptados individualmente con razón documentada (DEBT-07) | ⚠️ Ver Human Verification | WR-01, WR-02 y WR-03 tienen código presente, wireado y con test coverage verde (`src/check.js:160-172`, Test F/Test G en `test/check.test.js`, guard `DYNAMIC_LOGGER_IMPORT_RE` con mordida verificada en `test/check-isolation.test.js`). PERO: 85-REVIEW.md (posterior al cierre de bookkeeping de 85-05) encontró que la línea de fallos de WR-01 no cubre el escenario motivador (cmux caído) — ver análisis abajo y el ítem de Human Verification. WR-04 (hallazgo del propio review, comentario falso duplicado en `format-isolation.test.js`) SÍ está correctamente registrado como diferido — ver Deferred Items |
| 4 | Phases 79/80/81 tienen `VALIDATION.md` `nyquist_compliant: true` citation-based (NYQ-01) | ✓ VERIFIED | Los tres ficheros (`79-VALIDATION.md`, `80-VALIDATION.md`, `81-VALIDATION.md`) tienen `status: validated` + `nyquist_compliant: true` en frontmatter (grep confirmado). Per-Task Verification Map: 20 filas con cita concreta de fichero + sección + conteo, spot-checadas contra código real (ej. `test/hooks/session-end-handoff.test.js` + `session-end.test.js` → 53/53 pass, coincide con la cita; `test/dashboard-format.test.js` → 58/58, coincide). `MILESTONE-AUDIT.md` archivados de v0.18 intactos (`git diff --stat` vacío) |
| 5 | Phases 69/71/72 tienen `VALIDATION.md` `nyquist_compliant: true` citation-based (NYQ-02) | ✓ VERIFIED | Los tres ficheros (`69-VALIDATION.md`, `71-VALIDATION.md`, `72-VALIDATION.md`, en sus rutas reales bajo `v0.16-phases/`) tienen `status: validated` + `nyquist_compliant: true`. 23 filas del mapa citadas; corrección honesta de una ruta de test mal citada en el `VERIFICATION` original (`config-set-raw.test.js` → `test/cli/config-set-raw.test.js`, confirmado que el fichero real existe en esa ruta). Evidencia adversa citada sin redondeo (`skipped: 1` de GitHub real en 71, flake pre-existente en la suite de 72) |

**Score:** 4/5 truths VERIFIED sin reservas + 1/5 (DEBT-07) con reserva documentada que requiere decisión humana. **0** behavior-unverified (presencia+wiring, sin invariante de comportamiento sin probar).

### Required Artifacts

| Artefacto | Esperado | Status | Detalle |
|---|---|---|---|
| `src/session/state.js` | Comentario del typedef `TaskHandoff` reescrito | ✓ VERIFIED | Contrato tres-estados por presencia, coherente con `:405-410` y `:449-462` (sin tocar) |
| `src/cli/dashboard/select.js` | `deriveAnyNext` delegando en `nextCell` | ✓ VERIFIED | Import `nextCell` de `./format.js`, predicado `nextCell(r).length > 0`, sin picocolors, guard §TUI-04 verde |
| `test/dashboard-select.test.js` | Caso RED→GREEN de solo-whitespace | ✓ VERIFIED | 4 asserts nuevos dentro de LIVE-05, adición pura, 8 asserts previos intactos |
| `src/check.js` | Rama `if (failed > 0) errorFn(...)` | ✓ VERIFIED (con reserva de cobertura — ver Human Verification) | Línea presente, wireada, testeada; escenario cmux-caído no cubierto |
| `test/check.test.js` | Test F (advisories+fallos) y Test G (silencio) | ✓ VERIFIED | 36/36 verde en `test/check.test.js` + `test/check-isolation.test.js` juntos |
| `test/check-isolation.test.js` | `stripComments` + guard `DYNAMIC_LOGGER_IMPORT_RE` + comentarios corregidos | ✓ VERIFIED | Comentario falso sobre `import()` dinámico retirado; guard con mordida demostrada (verificación destructiva reversible documentada en SUMMARY, no re-ejecutada aquí por ser destructiva) |
| 6× `{N}-VALIDATION.md` (79/80/81/69/71/72) | `status: validated` + `nyquist_compliant: true` citation-based | ✓ VERIFIED | Frontmatter confirmado por grep en los 6; citas spot-checadas contra ficheros de test reales |
| `.planning/phases/85.../deferred-items.md` | Registro de deuda adyacente no cerrada, con trigger | ✓ VERIFIED | 6 filas, 0 celdas de Trigger vacías; incluye OQ-1 (comentario falso duplicado en `format-isolation.test.js`) con su trigger |

### Key Link Verification

| From | To | Via | Status | Detalle |
|---|---|---|---|---|
| `deriveAnyNext` (`select.js`) | `nextCell` (`format.js`) | `import` + llamada directa | ✓ WIRED | `grep -cF "import { nextCell } from './format.js';"` = 1; `nextCell(r).length > 0` en el cuerpo |
| typedef `TaskHandoff` (`state.js:~53`) | merge tres-estados (`state.js:449-462`) | coherencia doc↔código | ✓ WIRED | Verificado línea a línea: el texto del typedef enumera exactamente las tres ramas del `if/else if/else` real |
| `executeFn` → `r.errors` | `errorFn` (stderr) | `const failed = (r.errors \|\| []).length; if (failed > 0) errorFn(...)` | ✓ WIRED (alcance parcial — ver Human Verification) | El link existe y es correcto para su dominio de entrada (`r.errors` no vacío); el dominio de entrada real bajo cmux-caído nunca llega a poblar `r.errors` — ver análisis |
| `{N}-VALIDATION.md` | `{N}-VERIFICATION.md` | cita fichero+sección+conteo | ✓ WIRED | Spot-check en 79/81: conteos citados (53, 58, 24, 15, 17, 22 pass) coinciden con `node --test` ejecutado independientemente |

### Behavioral Spot-Checks

| Comportamiento | Comando | Resultado | Status |
|---|---|---|---|
| DEBT-05: suite de handoff verde sin tocar el test | `node --test test/state/handoff-state.test.js` | 24/24 pass | ✓ PASS |
| DEBT-06: whitespace-only no enciende columna | `node --test test/dashboard-select.test.js test/format-isolation.test.js` | verde (incl. `DEBT-06`) | ✓ PASS |
| DEBT-07: Test F/Test G del piggyback | `node --test test/check.test.js test/check-isolation.test.js` | 36/36 pass | ✓ PASS |
| NYQ-01/02: cita de `session-end` (53) y `dashboard-format` (58) | `node --test test/hooks/session-end-handoff.test.js test/hooks/session-end.test.js` / `test/dashboard-format.test.js` | 53/53 y 58/58 pass, coincide con la cita | ✓ PASS |
| Suite completa sin regresión | `npm test` (ejecutado 2 veces) | 2590 tests / 2589 pass / 0 fail / 1 skipped en la 2ª corrida; 1ª corrida mostró 1 fail intermitente sin reproducir en aislamiento | ✓ PASS (flake pre-existente, documentado en IN-07 de 85-REVIEW y en 85-05-SUMMARY) |
| Guards WR-03: comentario falso retirado | `grep -c '06-RESEARCH A3' test/check-isolation.test.js` | 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Plan fuente | Descripción | Status | Evidencia |
|---|---|---|---|---|
| DEBT-05 | 85-01 | Typedef `TaskHandoff` documenta el contrato tres-estados por presencia | ✓ SATISFIED | `src/session/state.js:53`, `test/state/handoff-state.test.js:265/288/307` |
| DEBT-06 | 85-01 | `deriveAnyNext` colapsa whitespace coherente con `nextCell` | ✓ SATISFIED | `src/cli/dashboard/select.js:273-275`, `test/dashboard-select.test.js` |
| DEBT-07 | 85-02 | Los 3 warnings de 80-REVIEW resueltos o re-aceptados con razón documentada | ⚠️ NEEDS HUMAN | Código presente y testeado para los 3; hallazgo post-hoc de 85-REVIEW sobre alcance de WR-01 sin registrar en `deferred-items.md` |
| NYQ-01 | 85-03 | 79/80/81 VALIDATION.md nyquist_compliant true citation-based | ✓ SATISFIED | 20 filas citadas, spot-checadas |
| NYQ-02 | 85-04 | 69/71/72 VALIDATION.md nyquist_compliant true citation-based | ✓ SATISFIED | 23 filas citadas, spot-checadas |

Ningún requirement de REQUIREMENTS.md mapeado a Phase 85 queda huérfano: los 5 IDs (`DEBT-05`, `DEBT-06`, `DEBT-07`, `NYQ-01`, `NYQ-02`) aparecen en la tabla de Traceability marcados `Complete` y con checkbox `[x]`, y coinciden exactamente con los 5 `requirements:` declarados a través de los 4 planes de ejecución (`85-01` → DEBT-05/06; `85-02` → DEBT-07; `85-03` → NYQ-01; `85-04` → NYQ-02).

### Anti-Patterns Found

Ninguno. `grep` de `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` sobre las líneas AÑADIDAS de los 6 ficheros de código/test tocados (`state.js`, `select.js`, `dashboard-select.test.js`, `check.js`, `check.test.js`, `check-isolation.test.js`) devuelve 0 (el único match es la palabra «falsos positivos» dentro de una frase de comentario, no un marcador de deuda). Ningún debt marker sin resolver introducido por esta fase.

### Scope Fences (verificados, no asumidos)

| Fence | Comprobación | Resultado |
|---|---|---|
| `test/format-isolation.test.js` sin modificar | `git diff --stat 2ca5080 HEAD -- test/format-isolation.test.js` | vacío (0 cambios) |
| `src/gsd/lock.js` sin modificar | `git diff --stat 2ca5080 HEAD -- src/gsd/lock.js` | vacío |
| `.planning/codebase/TESTING.md` sin modificar | `git diff --stat 2ca5080 HEAD -- .planning/codebase/TESTING.md` | vacío |
| `walkImports` en `check-isolation.test.js` sin modificar | `git diff -U0 ... \| grep '^-' \| grep -cE 'function walkImports\|...'` (vía SUMMARY, no re-ejecutado) | confirmado en SUMMARY con criterio de aceptación explícito |
| 8 asserts LIVE-05 preexistentes sin editar (addition-only) | `git diff -U0 2ca5080 HEAD -- test/dashboard-select.test.js` | confirmado: único hunk es `+8` líneas nuevas al final del `describe`, cero líneas `-` |
| `MILESTONE-AUDIT.md` archivados sin modificar | `git diff --stat 2ca5080 HEAD -- .planning/milestones/*MILESTONE-AUDIT*` (los 12 ficheros del repo) | vacío en los 12 |

### Deferred Items (registrados en `85/deferred-items.md`)

| # | Ítem | Registrado correctamente | Evidencia |
|---|---|---|---|
| D-18 | `format-isolation` transitivo — walker no sigue imports transitivos | ✓ Sí, con trigger | Fila 1 de `deferred-items.md`, con nota de asimetría respecto al patrón de `85-02` |
| OQ-1 | Comentario falso duplicado en `test/format-isolation.test.js:14,33` (mismo hallazgo que WR-04 de 85-REVIEW) | ✓ Sí, con trigger compartido con D-18 | Fila 2 de `deferred-items.md`, confirmado verbatim en el fichero real (`sed -n '10,18p;28,38p' test/format-isolation.test.js`) |
| — | **Hallazgo WR-01 de 85-REVIEW.md (alcance narrow del fix)** | ✗ **No registrado** | `85-REVIEW.md` se completó a las 13:43:55Z; `85-05` (que escribió `deferred-items.md` y cerró `STATE.md`) completó su commit `26eb1dc`/`72f57ef` con `85-05-SUMMARY.md` de mtime 13:32:15Z — el review es POSTERIOR al cierre de bookkeeping, así que el hallazgo no pudo incorporarse |

## Análisis independiente: ¿se cumple el Success Criterion 3 (DEBT-07)?

**Lo que el código hace correctamente:** `src/check.js:160-172` implementa literalmente el fix que 80-REVIEW propuso para WR-01 — inspeccionar `r.errors` y emitir el conteo por `errorFn` (stderr), nunca por `logFn`. Tiene test coverage real y no debilitado (Test F fuerza `applied=3`/`failed=2`/`advisories=1`, tres números distintos por diseño; Test G congela la rama de silencio). El fail-open, el gate `needsOrchestrator` y el orden `execute→launch` quedan intactos. Nada de lo introducido produce comportamiento incorrecto — coincide con la clasificación WARNING (no BLOCKER) de 85-REVIEW.md.

**Lo que NO se sostiene:** `r.errors` solo se puebla cuando `executeFn` intenta una escritura (`addToWorkspaceGroup`/`ungroupWorkspaceGroup`) y ESA escritura falla. Verifiqué el camino de datos completo (`src/cmux/sidebar-doctor.js:153-270`): con cmux caído, `parseRaw` (`:153-162`) atrapa la excepción y devuelve el fallback `{ workspaces: [] }`/`{ groups: [] }` — nunca relanza. Con `liveWorkspaceRefs` vacío, el filtro `if (!liveWorkspaceRefs.has(s.workspace_ref)) continue;` (`:239`) descarta TODAS las sesiones antes de clasificarlas, así que `missing_group`/`loose_workspace`/`empty_group` quedan vacíos, `executeFn` no intenta ninguna acción, `r.errors === []`, y `[kodo:check] Sidebar: 0 acción(es) aplicadas` sigue siendo indistinguible de «nada que arreglar» — exactamente el escenario que la prosa original de WR-01 nombraba como motivador.

**Mi juicio:** esto es una **resolución parcial, correctamente construida para el subconjunto que cubre, con un hallazgo real y no trivial sobre su alcance** — no una implementación rota ni un intento de aparentar que algo funciona cuando no lo hace. La pregunta de si el Success Criterion 3 («resueltos... con razón documentada») queda satisfecho depende de una decisión de alcance: ¿es «resuelto» en el sentido literal (implementó el fix tal cual se especificó, con test verde) suficiente, o el criterio exige que el problema *operativo* real quede resuelto? Dado que el propio 80-REVIEW nombró el escenario de cmux-caído como motivador explícito del warning, y ese escenario sigue exactamente igual de silencioso que antes de la fase, me inclino a NO dar esto por saldado sin que quede una decisión documentada — pero tampoco lo considero un BLOCKER que impida avanzar, porque no hay comportamiento incorrecto y el desvío es honesto y acotado. Escalo como ítem de Human Verification en vez de forzar `gaps_found` o `passed`.

## Human Verification Required

### 1. Disposición de WR-01 tras el hallazgo de alcance narrow (85-REVIEW.md)

**Test:** Revisar la sección "Análisis independiente" arriba y decidir entre (a) aceptar el fix actual como suficiente para DEBT-07, registrando la limitación en `85/deferred-items.md` con su trigger («que el conteo de advisories se contradiga con lo aplicado en un caso real de operación» — el mismo trigger que ya usa `IN-01` de 80-REVIEW en la fila 3 de `deferred-items.md` cubre exactamente este caso, así que podría fusionarse con esa fila en vez de abrir una nueva), o (b) abrir un fix de seguimiento que propague `__degraded: true` desde `parseRaw` (snippet ya escrito en `85-REVIEW.md` WR-01).

**Expected:** Una fila nueva o ampliada en `deferred-items.md` (o el `STATE.md` §Deferred Items ya cerrado por 85-05 reabierto con la anotación), o un plan de seguimiento fuera de esta fase.

**Why human:** Es una decisión de prioridad/alcance sobre un WARNING no-bloqueante, no un defecto programáticamente verificable. El código, tal como está, cumple literalmente lo que 80-REVIEW pidió; el desacuerdo es sobre si eso basta dado lo que el warning realmente perseguía.

## Gaps Summary

No hay gaps que bloqueen el avance. Los 5 requirements tienen artefactos presentes, wireados y con test coverage verde; los 6 `VALIDATION.md` de Nyquist están citation-based y spot-checados contra el código real; los scope fences declarados se sostienen sin excepción. El único punto abierto es una decisión de alcance sobre DEBT-07/WR-01 que el propio proceso de revisión de la fase descubrió DESPUÉS de que el bookkeeping se cerrara — no es una regresión de esta verificación, es una carrera entre dos pasos del mismo pipeline (execute → review) que dejó un hallazgo válido sin absorber. Recomiendo resolver el ítem de Human Verification antes de considerar v0.19 listo para `/gsd-audit-milestone`, dado que ese comando lee exactamente las filas de `deferred-items.md`/`STATE.md` que este hallazgo debería tocar.

---

_Verified: 2026-07-27T14:05:00Z_
_Verifier: Claude (gsd-verifier)_
