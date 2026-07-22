---
phase: 78-address-tech-debt-saneo-del-nudge-75-wr-01-fixes-77-review
verified: 2026-07-22T00:00:00Z
status: passed
score: 11/11 must-haves verificados
behavior_unverified: 0
overrides_applied: 0
---

# Phase 78: Address tech debt — saneo del nudge (75/WR-01) + fixes 77-REVIEW — Verification Report

**Phase Goal:** Saldar la deuda técnica de cierre de v0.17 — sanear el contenido LLM del nudge del orquestador (75/WR-01, riesgo aceptado R-75-02) y endurecer la resolución de grupos cmux (hallazgos accionables de 77-REVIEW), sin cambio de comportamiento observable para inputs limpios ni dependencias nuevas.
**Verified:** 2026-07-22T00:00:00Z
**Status:** passed
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `buildStopNudgeText` sanea `task_ref`, `summary` y `next` con `stripControlChars` — ninguna secuencia CSI/OSC/C0/C1/DEL/CR sobrevive hacia `cmuxClient.send` | ✓ VERIFIED | `src/hooks/stop.js:56,79` interpola los 3 campos vía `stripControlChars(...)`; import correcto desde `../cli/format.js:16`. Tests dedicados `78/WR-01: sanea task_ref/summary/next inyectado` en pass (`node --test test/stop.test.js` → 30/30). |
| 2 | Inputs ASCII limpios producen texto byte-idéntico a Phase 75 (D-09) — 5 goldens por-modo intactos | ✓ VERIFIED | Test `78/WR-01: no-regresión D-09 — inputs ASCII limpios producen texto byte-idéntico en los TRES modos` pass; los 5 goldens QUICK-08 preexistentes no se modificaron (diff no los toca) y siguen verdes. |
| 3 | `buildStopNudgeText` sigue pura (cero I/O) — test de pureza LIVE-07 sigue verde | ✓ VERIFIED | Test de pureza (grep de `readFileSync`/`writeFileSync`/`readFileFn` sobre el cuerpo) en la suite `node --test test/stop.test.js`, verde; `stripControlChars` en sí es pura (`String(s).replace(...)`, sin I/O). |
| 4 | Los 3 modos (quick/full/no-GSD) siguen añadiendo la línea `NEXT:` con `next` string no vacío y degradan byte-idéntico con null/''/undefined/no-string | ✓ VERIFIED | Guard `typeof next === 'string' && next.length > 0` intacto en `stop.js:76`; solo se envuelve el valor interpolado (`stripControlChars(next)`), no el guard. LIVE-07 verde. |
| 5 | `deriveExpectedGroupName` deriva sobre el ref trimeado y devuelve `null` para refs que colapsan a identifier vacío (`'#7'`→null, `'-9'`→null); `'KODO-9 '` → match limpio `KODO` | ✓ VERIFIED | `src/session/manager.js:143-169`: `if (typeof rawRef !== 'string') return null; const ref = rawRef.trim(); if (ref === '') return null;` … `if (!identifier \|\| identifier.trim() === '') return null;`. Tests `ref='#7'→null`, `ref='-9'→null`, `ref='KODO-9 '→'KODO'` en `test/session/group-resolve.test.js:132-148`, todos pass. |
| 6 | `resolveWorkspaceGroup` solo devuelve `g.ref` cuando cumple `/^workspace_group:\d+$/` — ref anómalo (con `\n` u otro shape) → null | ✓ VERIFIED | `src/session/manager.js:190-206`: predicado `/^workspace_group:\d+$/.test(g.ref)` añadido al type-check por campo. Describe `IN-02: g.ref debe cumplir /^workspace_group:\d+$/` en group-resolve.test.js:213, pass. |
| 7 | `resolveWorkspaceGroup` matchea `name` en NFD contra `expectedName` en NFC (invariante Unicode con red de regresión) | ✓ VERIFIED | `norm()` sigue aplicando `.normalize('NFC')` (manager.js:186); test WR-02 (group-resolve.test.js:230-238) construye NFD/NFC con escapes explícitos y confirma el match; comentario documenta que borrar `.normalize('NFC')` pone el test rojo. |
| 8 | `host._legacy.listWorkspaceGroups()` NO se ejecuta cuando `expectedName` es null (guard `if (expectedName)`) | ✓ VERIFIED | `src/session/manager.js:401-406`: la llamada vive dentro de `if (expectedName) { const raw = await host._legacy.listWorkspaceGroups(); ... }`. Source-hygiene `test/manager.test.js:809-812` (regex `if\s*\(\s*expectedName\s*\)\s*\{[\s\S]*?host\._legacy\.listWorkspaceGroups\(\)`) pass. |
| 9 | El log de degradación incluye el motivo del error (`String(err?.message).slice(0,80)`) sin filtrar contenido de usuario | ✓ VERIFIED | `src/session/manager.js:408-422`: `catch (err) { ... console.log(\`[kodo] group_skipped — resolucion_fallo: ${String(err?.message).slice(0, 80)}\`); }`. El origen del `err` es `listWorkspaceGroups()`/`JSON.parse`, nunca `task.title`/`task.ref` (D-11 preservado). Source-hygiene `test/manager.test.js:815-820` pass. |
| 10 | El JSDoc de `_legacy.newWorkspace` documenta `group?: string` en `opts` | ✓ VERIFIED | `src/host/cmux.js:357`: `/** @param {{ name: string, cwd?: string, command?: string, group?: string }} opts ... */`. |
| 11 | El fixture live (Kodo/SCRIBBA/SCP-CMRi) sigue resolviendo `KODO-9`→`workspace_group:1`; los 19 tests preexistentes de group-resolve.test.js y source-hygiene de manager.test.js siguen verdes | ✓ VERIFIED | `test/session/group-resolve.test.js:162-171` (`fixtureLive` → `workspace_group:1`/`workspace_group:2`/null) pass. Suite completa: `node --test test/session/group-resolve.test.js` → 37/37 pass; `node --test test/manager.test.js` → 59/59 pass (incluye source-hygiene GRP-01/03/04 y el nuevo assert `end > start` IN-05 en :871). |

**Score:** 11/11 truths verified (0 present-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/stop.js` | `buildStopNudgeText` sanea los 3 campos LLM | ✓ VERIFIED | Wired: import `stripControlChars` desde `../cli/format.js`, usado en las 3 interpolaciones (líneas 56, 79). |
| `test/stop.test.js` | Casos de regresión de saneo + no-regresión D-09 | ✓ VERIFIED | 4 casos nuevos en `QUICK-08 — buildStopNudgeText switch` (líneas 352-397); suite completa 30/30 pass. |
| `src/session/manager.js` | `deriveExpectedGroupName`/`resolveWorkspaceGroup`/`launchWorkItem` endurecidos | ✓ VERIFIED | Los 3 símbolos modificados según diseño; `newWorkspaceWithGroupFallback` (líneas 228-236, D-10) NO aparece en el diff del plan. |
| `src/host/cmux.js` | JSDoc `group?: string` en `_legacy.newWorkspace` | ✓ VERIFIED | Línea 357. |
| `test/session/group-resolve.test.js` | Casos WR-01/IN-01/IN-02/WR-02 | ✓ VERIFIED | 37 tests, todos pass. |
| `test/manager.test.js` | Backstop IN-05 + source-hygiene IN-04/IN-03 | ✓ VERIFIED | 59 tests, todos pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `buildStopNudgeText` | `stripControlChars` (src/cli/format.js) | import relativo + interpolación en los 3 campos | ✓ WIRED | Mismo patrón que `App.js:752-753`; verificado por grep e inspección directa. |
| `deriveExpectedGroupName` → `resolveWorkspaceGroup` → `newWorkspaceWithGroupFallback` | cadena fail-open GRP-03 | un `null` en cualquier eslabón lanza sin `--group` | ✓ WIRED | `launchWorkItem` mantiene `let groupRef = null` como default; `newWorkspaceWithGroupFallback` no tocado; tests de la cadena completa (`test/manager.test.js` GRP-01/03) pass. |
| `launchWorkItem` | `host._legacy.listWorkspaceGroups` | única llamada cmux extra, guardada por `expectedName` | ✓ WIRED | `if (expectedName) { ... }` confirmado en código y en source-hygiene test. |

### Prohibitions (must_haves.prohibitions)

| # | Statement | Verification | Result |
|---|-----------|---------------|--------|
| 1 | Cero nuevas dependencias npm (78-01) | `git diff --name-only` del rango de la fase no incluye `package.json`/`package-lock.json` | ✓ RESUELTO |
| 2 | `buildStopNudgeText` nunca hace I/O (78-01) | Test de pureza LIVE-07 verde; `stripControlChars` es pura | ✓ RESUELTO |
| 3 | No se toca `src/hooks/session-end.js` (78-01) | `git diff --name-only` del rango de la fase confirma que `session-end.js` NO aparece | ✓ RESUELTO |
| 4 | No re-cablear el retry TOCTOU de `newWorkspaceWithGroupFallback` (78-02, D-10 LOCKED) | Función intacta (líneas 228-236), no aparece en los hunks del diff de manager.js del plan 02 | ✓ RESUELTO |
| 5 | Ningún verbo de gestión de grupos cmux (78-02, GRP-04) | Guard existente `test/manager.test.js` (GRP-04) sigue verde | ✓ RESUELTO |
| 6 | `manager.js` no importa `src/cmux/client.js` directo (78-02) | `grep "from '../cmux/client.js'" src/session/manager.js` sin resultados | ✓ RESUELTO |

### Requirements Coverage

| Requirement | Source Plan | Descripción | Status | Evidencia |
|-------------|-------------|-------------|--------|-----------|
| 75/WR-01 | 78-01 | Sanear el nudge del orquestador (3 campos LLM) | ✓ SATISFIED | `stop.js:56,79` + tests dedicados |
| 77/WR-01 | 78-02 | Guard del identifier derivado bogus | ✓ SATISFIED | `manager.js:161` |
| 77/WR-02 | 78-02 | Test de regresión Unicode NFC | ✓ SATISFIED | `group-resolve.test.js:230-238` |
| 77/IN-01 | 78-02 | Trim del ref antes de derivar | ✓ SATISFIED | `manager.js:148-149` |
| 77/IN-02 | 78-02 | Guard de shape `workspace_group:\d+` | ✓ SATISFIED | `manager.js:198` |
| 77/IN-03 | 78-02 | Motivo del error en el log de degradación | ✓ SATISFIED | `manager.js:422` |
| 77/IN-04 | 78-02 | No llamar cmux cuando `expectedName` es null | ✓ SATISFIED | `manager.js:401-406` |
| 77/IN-05 | 78-02 | Assert de slice no-vacuo (backstop) | ✓ SATISFIED | `manager.test.js:871` |
| 77/IN-06 | 78-02 | JSDoc `group?: string` alineado | ✓ SATISFIED | `cmux.js:357` |
| 77/IN-07 | — | Riesgo residual retry D-10 | LOCKED (fuera de scope por D-10, confirmado en RESEARCH.md y en el diff — `newWorkspaceWithGroupFallback` intacto) | N/A |

Ninguna de las IDs de hallazgo declaradas en las plans queda huérfana; los 9 requirements declarados en frontmatter (75/WR-01 + 8 de 77) están cubiertos por evidencia de código y test. 77/IN-07 está explícitamente fuera de scope (D-10 LOCKED), tal como lo documenta la fase.

### Anti-Patterns Found

Ninguno bloqueante en los ficheros modificados (`src/hooks/stop.js`, `src/session/manager.js`, `src/host/cmux.js`, `test/stop.test.js`, `test/session/group-resolve.test.js`, `test/manager.test.js`): sin `TBD`/`FIXME`/`XXX`, sin stubs, sin implementaciones vacías.

**Hallazgo informativo (no bloqueante) — trazado desde 78-REVIEW.md:**

El propio code-review de la fase (`78-REVIEW.md`, status `issues_found`, 1 warning + 3 info) identificó que un **segundo** envío al terminal del orquestador — el nudge "Nueva sesión lanzada" en `launchWorkItem` (`src/session/manager.js:522`) — interpola `task.ref`/`task.title` SIN pasar por `stripControlChars`, con el mismo modelo de amenaza (inyección de escapes de terminal) que motiva 75/WR-01. Verificado en código: la línea permanece sin sanear.

Este hallazgo **no es un gap del scope declarado de la fase**: `78-RESEARCH.md` (§Out of Scope, escrito ANTES de la ejecución) excluye explícitamente "saneo de `summary`/`task_ref` en OTROS sinks" y acota el follow-up al texto de `buildStopNudgeText` — el sink que cierra literalmente el riesgo aceptado R-75-02 registrado en `75-SECURITY.md`. La Success Criterion #1 del ROADMAP también se limita a "el nudge del orquestador" (definido como `buildStopNudgeText`), que está verificado.

Dicho esto: es deuda de seguridad real, del mismo tipo que esta fase existe para saldar, descubierta por el propio review de la fase y sin commit de remediación posterior (`655b700` es el último commit de la fase y solo añade el informe). Se recomienda capturarla como un nuevo hallazgo (candidato `R-78-01`) para una fase de hardening futura — no bloquea el veredicto de esta fase porque estaba fuera del scope declarado desde RESEARCH, pero el humano debe decidir si se abre ya un ítem de backlog.

### Behavioral Spot-Checks / Probe Execution

| Comando | Resultado | Status |
|---------|-----------|--------|
| `node --test test/stop.test.js` | 30/30 pass | ✓ PASS |
| `node --test test/session/group-resolve.test.js` | 37/37 pass | ✓ PASS |
| `node --test test/manager.test.js` | 59/59 pass | ✓ PASS |
| `npm test` (suite completa, una sola corrida) | 2296 pass / 0 fail / 1 skip | ✓ PASS (coincide con lo reportado en 78-02-SUMMARY.md) |

### Human Verification Required

Ninguna. Todos los must-haves son verificables programáticamente (funciones puras + source-hygiene + tests de regresión con dientes verificados en RED antes del fix).

### Gaps Summary

Sin gaps bloqueantes. Los 11 must-haves (4 de 78-01 + 7 de 78-02), las 6 prohibiciones y los 9 requirement IDs declarados están verificados contra el código real (no solo contra las afirmaciones de los SUMMARY). `npm test` completo en verde (2296/2296, 1 skip preexistente no relacionado — `test/gsd-lock-race.test.js` es flaky documentado de Phase 74, no re-disparado en esta corrida). `git diff` confirma cero dependencias nuevas y que `session-end.js`/`newWorkspaceWithGroupFallback` no fueron tocados, tal como exigían las prohibiciones.

Se deja constancia (no bloqueante) del hallazgo WR-01 de `78-REVIEW.md` sobre el nudge paralelo de lanzamiento sin sanear — explícitamente fuera del scope declarado en RESEARCH.md, pero recomendado como ítem de backlog de seguridad para v0.18.

---

_Verified: 2026-07-22T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
