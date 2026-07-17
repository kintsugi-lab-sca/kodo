---
phase: 75-superficie-del-next-dashboard-y-nudge
verified: 2026-07-17T13:10:00Z
status: human_needed
score: 13/13 must-haves verificables verificados (0 fallidos)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "En el dashboard TUI (kodo dashboard), abrir una sesión no-GSD cuya tarea tenga un `NEXT:` persistido en state.json y confirmar visualmente que la columna `next` aparece al final de la tabla con el dato vivo, sin ruido, con truncado correcto."
    expected: "La celda `next` muestra el texto del NEXT: real, truncado con ellipsis si excede el ancho; sin dato, la celda queda vacía sin placeholder."
    why_human: "Verificación visual/funcional sobre datos vivos de una fase en curso — declarado explícitamente human_judgment:true en 75-01-SUMMARY.md (coverage D4); no verificable por grep/test estático."
  - test: "Cerrar una sesión cuya tarea dejó un `NEXT:` (o cuyo cierre es mecánico pero la tarea tiene un `NEXT:` previo) y confirmar en el workspace `kodo-orchestrator` (vía cmux) que el nudge recibido contiene la línea «Siguiente paso sugerido por la sesión: …»."
    expected: "El nudge que llega al panel del orquestador incluye la línea concreta del NEXT:, no el texto genérico."
    why_human: "La entrega efectiva del nudge vía `cmux send` al workspace real del orquestador es un efecto de integración con el runtime cmux que la suite hermética no ejercita — declarado explícitamente human_judgment:true en 75-02-SUMMARY.md (coverage D3) y listado en 75-VALIDATION.md §Manual-Only Verifications."
  - test: "Desde una fila no-GSD (phaseId==null) con un plan ligero real (headings, **Label:**, bullets, code fences, marcador kodo:handoff), pulsar `p` y confirmar que el render markdown best-effort (NO CommonMark) es legible y suficiente para leer el plan; en particular, un plan largo con múltiples handoffs acumulados."
    expected: "El operador confirma que el render line-based (headings bold/cyan, labels bold, bullets planos, fences dim) es legible y suficiente para el propósito de LIVE-06, sin exigir tablas/links/nested rendering."
    why_human: "Truth explícitamente marcado `verification: backstop` en 75-03-PLAN.md (must_haves.truths) — la fidelidad del render es una decisión de producto que el verificador no puede confirmar con evidencia de código; por contrato honest-verifier, un backstop no confirmado abstiene a human_needed (insufficient_spec), nunca un pase silencioso. Cross-confirmado en 75-VALIDATION.md §Manual-Only Verifications."
---

# Phase 75: Superficie del `NEXT:` — dashboard y nudge — Informe de Verificación

**Objetivo de la fase:** El operador y el orquestador **consumen** el estado vivo sin abrir ficheros a mano: el `NEXT:` de cada tarea se ve en la lista del dashboard, el plan completo se abre renderizado desde la fila, y el nudge del orquestador deja de ser genérico. Es la cara visible del dato que produce la Phase 74.

**Verificado:** 2026-07-17
**Estado:** human_needed
**Re-verificación:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Estado | Evidencia |
|---|-------|--------|-----------|
| 1 | (SC1/LIVE-05) El dashboard muestra el `NEXT:` por tarea leyéndolo de `state.json`; la TUI no abre N ficheros de plan; sin endpoint nuevo en `src/server.js` | ✓ VERIFIED | `src/cli/dashboard/tasks.js` (`readTasks`) lee `~/.kodo/state.json` una vez por render/tick, importa SOLO builtins (`node:fs`/`node:path`/`node:os`), nunca `loadState`. `git diff --stat` sobre el rango de commits de la fase (`accffcb..97e227d`) para `src/server.js`/`package.json`/`package-lock.json` es VACÍO. 145 tests verdes en `test/dashboard-tasks.test.js` + `test/dashboard-select.test.js` + `test/dashboard-format.test.js` + `test/dashboard-table.test.js`. |
| 2 | (SC2/LIVE-06) Desde la fila de una sesión no-GSD, el operador abre el markdown completo del plan renderizado y de solo lectura; `Esc` vuelve preservando el cursor por `task_id` | ✓ VERIFIED | Test de comportamiento real (render + stdin simulado) `test/dashboard-overlay.test.js` — `LIVE-06 SC2: el overlay de plan LIGERO pinta el heading con el marcador INVISIBLE` y `LIVE-06 SC2: Esc cierra el overlay de plan LIGERO y restaura la tabla con el MISMO cursor (KL-1)`, ambos verdes. |
| 3 | (SC3/LIVE-06) Las filas GSD siguen abriendo su overlay de plan GSD exactamente igual que hoy (D-02 intacto); el handoff no se surface en esa rama | ✓ VERIFIED | Test de no-regresión explícito `LIVE-06 SC3 / NO-REGRESIÓN GSD: el overlay de plan GSD NO strippea el marcador (render:plain, byte-idéntico)` en `test/dashboard-overlay.test.js` — verde; el marcador aparece VERBATIM en la rama GSD. Código: `SessionTable.js:206-223` ramifica por `snap.render`, la rama `else` (GSD) es el `map` de `<Text>` preexistente sin tocar. |
| 4 | (SC4/LIVE-07) Con un `NEXT:` presente, el nudge del orquestador lo usa como contexto concreto en vez del genérico | ✓ VERIFIED | `buildStopNudgeText(session, next)` en `src/hooks/stop.js:48-73` añade la línea `Siguiente paso sugerido por la sesión: ${next}\n` cuando `typeof next === 'string' && next.length > 0`, en los 3 modos. El threading `upsertTaskHandoff` → `writeHandoff` → `handoffNext` → `buildStopNudgeText` está cableado en `state.js:436-465` y `session-end.js:142-149,388-400`, con la asimetría post-upsert correctamente propagada (`effectiveNext = upsertResult.ok ? upsertResult.value.next : r.value.next`). Tests verdes en `test/stop.test.js`, `test/state/handoff-state.test.js`, `test/hooks/session-end-handoff.test.js`. |
| 5 | (SC5) Sin `NEXT:`, el dashboard y el nudge degradan limpio: celda vacía, nudge sin contexto, TUI never-throws, cero ruido | ✓ VERIFIED | `readTasks` colapsa ENOENT/JSON-corrupto/sin-clave-tasks/tasks-null a `{}` (never-throws, 7 casos en `test/dashboard-tasks.test.js`). `nextCell` devuelve `''` sin placeholder cuando falta el dato. `buildStopNudgeText(s)` === `buildStopNudgeText(s, null)` === `buildStopNudgeText(s, '')` (byte-idéntico, asserted en `test/stop.test.js`). |
| 6 | readTasks tolera escritores concurrentes; nunca escribe state.json; nunca importa loadState/config.js | ✓ VERIFIED | `grep -nE "^import" src/cli/dashboard/tasks.js` → solo `node:fs`/`node:path`/`node:os`. `npm test` no genera ficheros `state.json.bak.*`. |
| 7 | deriveAnyNext se computa sobre el set SIN filtrar (`enriched`, no `filtered`) — la columna no parpadea al teclear una query | ✓ VERIFIED | `App.js:804` — `const anyNext = deriveAnyNext(enriched);` (antes de `applyFilter` en `:805`). |
| 8 | El contenido LLM del `next` se sanea con `stripControlChars` antes de proyectarse a la celda | ✓ VERIFIED | `App.js:752-753` — sanea `rawNext` con `stripControlChars` cuando es string no vacío, antes de asignarlo a `row.next`. |
| 9 | La telemetría de `upsertTaskHandoff` nunca lleva el `next` (solo `{task_id}`/`{task_id, reason}`) | ✓ VERIFIED | `state.js:462` — `logger.info('state.task.handoff_saved', { task_id: taskId })`; rama de fallo `:459` — `logger.warn('state.task.handoff_failed', { task_id: taskId, reason: r.reason })`. |
| 10 | `buildStopNudgeText` permanece pura (cero I/O), recibe el `next` ya en memoria | ✓ VERIFIED | `grep -nE "readFileSync\|readFileFn\|writeFileSync" src/hooks/stop.js` dentro del cuerpo de la función no devuelve nada; test `test/stop.test.js` asserta pureza explícitamente. |
| 11 | `stripHandoffMarker` es string-only (indexOf/slice, cero regex) y `handoff.js` conserva cero imports | ✓ VERIFIED | `grep -n "^import" src/session/handoff.js` sin resultados; `stripHandoffMarker` usa `indexOf`/`slice` (`handoff.js:191-199`). `test/check-isolation.test.js` verde. |
| 12 | El mini-renderer markdown solo aplica al carril light 'ok'; la rama GSD queda byte-idéntica | ✓ VERIFIED | `plan.js:76` (`render:'markdown'` en la rama light) vs `plan.js:193` (`render:'plain'` en GSD); `SessionTable.js:206` ramifica por `snap.render === 'markdown'`. Test de no-regresión explícito (ver truth #3). |
| 13 | Cada línea del plan ligero pasa por `stripControlChars` antes de proyectarse | ✓ VERIFIED | `markdown.js:57` — `const clean = stripControlChars(arr[i]);` aplicado ANTES de cualquier decisión de estilo. |

**Score:** 13/13 truths verificables verificadas por evidencia de código/tests (0 fallidas). 3 ítems adicionales requieren confirmación humana (ver abajo) — no cuentan como fallo ni como verificado, son backstop/human-judgment declarados por el propio plan.

### Required Artifacts

| Artifact | Esperado | Estado | Detalles |
|----------|----------|--------|----------|
| `src/cli/dashboard/tasks.js` | Reader leaf `readTasks(deps)` never-throws | ✓ VERIFIED | Existe, 47 líneas, solo builtins, never-throws confirmado por test. |
| `src/cli/dashboard/select.js` | `deriveAnyNext` exportada | ✓ VERIFIED | `export function deriveAnyNext(rows)` en línea 258. |
| `src/cli/dashboard/format.js` | `nextCell` exportada + clave `next` en `rowCells` | ✓ VERIFIED | `nextCell` en línea 258; `next: nextCell(session)` en `rowCells` (línea 280, última clave tras `age`). |
| `src/cli/dashboard/App.js` | enrich `row.next` + `anyNext` + prop a `SessionTable` | ✓ VERIFIED | Enrich en `:752-758`, `anyNext` en `:804`, prop pasada en `:2051`. |
| `src/cli/dashboard/SessionTable.js` | `COLS.next` + header/celda condicionales al final | ✓ VERIFIED | `COLS.next: 40` en línea 99; header condicional `:1021`, celda condicional `:1086`. |
| `test/dashboard-tasks.test.js` | Nuevo (Wave 0), cubre `readTasks` | ✓ VERIFIED | 7 casos, verde. |
| `src/hooks/stop.js` | `buildStopNudgeText` con 2º parámetro opcional `next` | ✓ VERIFIED | Firma `buildStopNudgeText(session, next)` en línea 48. |
| `src/session/state.js` | `upsertTaskHandoff` devuelve `value: { plan_path, next, updated_at }` | ✓ VERIFIED | Return `{ ok: true, value: persisted }` en línea 465, con `persisted` construido bajo el lock. |
| `src/hooks/session-end.js` | `writeHandoff` devuelve el `next` efectivo; bloque nudge lo threadea | ✓ VERIFIED | `writeHandoff` return `{ planPath, next: effectiveNext }` (`:400`); handler threadea `handoffNext` a `buildStopNudgeText(session, handoffNext)` (`:258`). |
| `src/session/handoff.js` | `stripHandoffMarker` exportada (string-only, cero imports) | ✓ VERIFIED | Línea 191, cero imports en el módulo. |
| `src/cli/dashboard/markdown.js` | Nuevo módulo `renderMarkdownLines` | ✓ VERIFIED | Existe, 90 líneas, importa `ink`/`react`/`stripHandoffMarker`/`stripControlChars`. |
| `src/cli/dashboard/plan.js` | Discriminante `render` ('markdown' en light 'ok', 'plain' en GSD) | ✓ VERIFIED | Líneas 76 y 193. |
| `test/dashboard-markdown.test.js` | Nuevo (Wave 0), cubre el mini-renderer | ✓ VERIFIED | Existe, incluido en la suite verde. |

### Key Link Verification

| From | To | Via | Estado | Detalles |
|------|----|----|--------|----------|
| `state.json` (tasks) | `readTasks` → enrich App.js → `deriveAnyNext`/`nextCell` → columna `next` | merge por `task_id` | ✓ WIRED | Cadena completa confirmada por lectura de código y tests de integración (`dashboard-table.test.js`). |
| `upsertTaskHandoff` (state.js, asimetría) | `writeHandoff` (session-end.js) → `handoffNext` → `buildStopNudgeText(session, handoffNext)` | return-threading bajo lock | ✓ WIRED | Confirmado con lectura de código línea a línea y tests unitarios/integración de asimetría. |
| `readPlan`/`readLightPlan` (plan.js, `render`) | `App.js` (`setOverlaySnapshot`) → `SessionTable.renderOverlay` | `snap.render === 'markdown'` gate | ✓ WIRED | `App.js:1843` threadea `render: res.render`; `SessionTable.js:206` ramifica correctamente. |
| `handoff.js` (`stripHandoffMarker`, dueño único) | `markdown.js` (`renderMarkdownLines`) | import directo | ✓ WIRED | `markdown.js:26` importa `stripHandoffMarker` de `../../session/handoff.js`; se aplica solo en headings (`:76`). |

### Behavioral Spot-Checks

| Behavior | Comando | Resultado | Estado |
|----------|---------|-----------|--------|
| Suite completa de la fase (7 ficheros de test tocados) | `node --test test/dashboard-tasks.test.js test/dashboard-select.test.js test/dashboard-format.test.js test/dashboard-table.test.js` | 145 tests, 0 fail | ✓ PASS |
| Suite del nudge/threading | `node --test test/stop.test.js test/state/handoff-state.test.js test/hooks/session-end-handoff.test.js test/state/handoff-concurrency.test.js` | 84 tests, 0 fail | ✓ PASS |
| Suite del overlay/markdown/isolation | `node --test test/session/handoff.test.js test/check-isolation.test.js test/dashboard-markdown.test.js test/dashboard-overlay.test.js test/dashboard-plan.test.js test/format-isolation.test.js` | 117 tests, 0 fail | ✓ PASS |
| Suite completa del proyecto (una sola corrida, `npm test`) | `npm test` | 2253 pass / 0 fail / 1 skipped | ✓ PASS (coincide con lo declarado en el contexto de verificación — flaky preexistente CR-01 no re-triggered en esta corrida) |
| `git diff --stat` sobre `src/server.js`/`package.json`/`package-lock.json` en el rango completo de commits de la fase | `git diff --stat b9893ac~1 97e227d -- src/server.js package.json package-lock.json` | Sin salida (vacío) | ✓ PASS (SC1 confirmado — cero endpoints nuevos, cero deps nuevas) |

### Requirements Coverage

| Requirement | Plan origen | Descripción | Estado | Evidencia |
|-------------|-------------|-------------|--------|-----------|
| LIVE-05 | 75-01 | El usuario ve el `NEXT:` por tarea en la lista del dashboard sin que la TUI abra N ficheros de plan | ✓ SATISFIED | Columna `next` condicional cableada end-to-end (truths #1, #6-8; artifacts tasks.js/select.js/format.js/App.js/SessionTable.js). REQUIREMENTS.md ya lo marca `[x]` / `Complete`. |
| LIVE-06 | 75-03 | El usuario abre el markdown completo del plan desde la vista del dashboard, renderizado (no editable), en la rama `phaseId == null` | ✓ SATISFIED (con backstop pendiente de UAT) | Truths #2, #3, #11-13; tests de comportamiento explícitos SC2/SC3. El backstop de fidelidad de render (best-effort, NO CommonMark) queda como `verification: backstop` — ver Human Verification. REQUIREMENTS.md ya lo marca `[x]` / `Complete`. |
| LIVE-07 | 75-02 | Con un `NEXT:` presente, el nudge del orquestador lo usa como contexto en vez del genérico | ✓ SATISFIED (con entrega real pendiente de UAT) | Truths #4, #5, #9-10; threading de asimetría verificado por código y tests. La entrega efectiva vía `cmux send` al workspace real es human_judgment — ver Human Verification. REQUIREMENTS.md ya lo marca `[x]` / `Complete`. |

Sin requisitos huérfanos: los 3 IDs declarados en `REQUIREMENTS.md` para Phase 75 (LIVE-05, LIVE-06, LIVE-07) aparecen cada uno en el campo `requirements` de exactamente un plan (75-01, 75-02, 75-03 respectivamente).

### Anti-Patterns Found

| Fichero | Línea | Patrón | Severidad | Impacto |
|---------|-------|--------|-----------|---------|
| `src/hooks/session-end.js:258` (vía `stop.js:69-71`) | — | El `NEXT:` (contenido LLM) llega a `cmuxClient.send` **sin** `stripControlChars`, a diferencia del mismo dato en el carril de render del dashboard (`App.js:753`) — hallazgo `WR-01` de `75-REVIEW.md` | ⚠️ Warning | Riesgo de inyección de secuencias de escape de terminal (OSC-52/CSI) hacia el terminal del orquestador vía cmux. Vector preexistente (mismo patrón que `summary`/`task_ref` no saneados en ese sink), pero Phase 75 añade deliberadamente un nuevo campo LLM (`next`) a ese sink justo cuando el carril de render sí lo blinda. No bloqueante per code review (0 critical), marcado explícitamente como advisory en el contexto de esta verificación; no está entre los `must_haves`/prohibitions declarados por el plan 75-02 (su threat model no registra Tampering para el sink del nudge), así que no invalida ningún truth de la fase, pero se registra aquí como hallazgo real de seguridad para seguimiento. |
| `src/cli/dashboard/App.js:735-739` | — | Comentario dice «lee `tasks` UNA vez por tick»; en realidad se ejecuta en cada render de React (incl. teclado), no solo en el tick de `usePoll` — hallazgo `WR-02` de `75-REVIEW.md` | ⚠️ Warning | Solo drift de documentación / posible lectura síncrona repetida (never-throws, no crashea); no afecta ningún truth declarado. |
| `src/cli/dashboard/format.js:258-260` (`nextCell`) | — | `stripControlChars` preserva `\n`/`\t`; un `next` hand-editado en `state.json` con salto de línea puede descuadrar la fila de la tabla (`truncate:true` acota ancho, no líneas) — hallazgo `WR-03` de `75-REVIEW.md` | ⚠️ Warning | Solo alcanzable con `state.json` corrupto/hand-editado, no por el pipeline normal (LLM `extractNext` ya produce una sola línea). No invalida ningún truth declarado. |
| `src/cli/dashboard/SessionTable.js:817` | — | Typedef del prop `overlaySnapshot` no incluye `render` pese a que se threadea y consume — hallazgo `WR-04` de `75-REVIEW.md` | ℹ️ Info | Solo documentación, no afecta runtime. |

No se encontraron marcadores de deuda (`TBD`/`FIXME`/`XXX`) en ningún fichero modificado por la fase (los matches de `TODO` en los ficheros fuente son la palabra española «todo/TODOS», no el marcador de deuda).

### Human Verification Required

### 1. Columna `next` con dato vivo en el dashboard real

**Test:** Abrir el dashboard TUI (`kodo dashboard`) durante una fase en curso con al menos una tarea que tenga un `NEXT:` persistido; observar la columna `next`.
**Expected:** La celda muestra el valor real del `NEXT:`, truncado con ellipsis si excede el ancho de columna; en tareas sin dato, la celda queda vacía y sin ruido visual.
**Why human:** Declarado explícitamente `human_judgment: true` en `75-01-SUMMARY.md` (coverage D4) — verificación visual/funcional sobre datos vivos que el verificador estático no puede reproducir.

### 2. Entrega real del nudge con contexto al orquestador

**Test:** Cerrar una sesión cuya tarea dejó (o heredó) un `NEXT:`; comprobar en el workspace `kodo-orchestrator` (vía cmux) que el nudge recibido incluye la línea «Siguiente paso sugerido por la sesión: …».
**Expected:** El texto recibido en el panel del orquestador contiene la línea concreta, no el genérico.
**Why human:** Declarado explícitamente `human_judgment: true` en `75-02-SUMMARY.md` (coverage D3) y listado en `75-VALIDATION.md §Manual-Only Verifications` — el envío por `cmux send` al workspace real es un efecto de integración fuera del alcance de la suite hermética.

### 3. Fidelidad del render markdown best-effort (backstop)

**Test:** Desde una fila no-GSD con un plan ligero real (headings, `**Label:**`, bullets, code fences, marcador `kodo:handoff`, y con handoffs acumulados/plan largo), pulsar `p` y evaluar si el render line-based es legible y suficiente.
**Expected:** El operador confirma que el render (headings bold/cyan, labels bold, bullets planos, fences dim) es suficiente para LIVE-06 sin exigir tablas/links/nested rendering (fuera de alcance explícito, diferido a v0.18/M21).
**Why human:** Truth marcado explícitamente `verification: backstop` en `75-03-PLAN.md` (must_haves.truths) — es una decisión de fidelidad de producto, no verificable con evidencia de código. Por el contrato honest-verifier, un backstop no confirmable abstiene a `human_needed` (razón `insufficient_spec`), nunca un pase silencioso.

### Gaps Summary

No hay gaps que bloqueen el objetivo de la fase: los 13 truths verificables por código/tests están VERIFIED con evidencia directa (lectura de fuente + 346 tests verdes específicos de la fase + suite completa 2253/0/1 sin regresiones). El invariante SC1 («cero endpoints nuevos, cero deps npm nuevas») se confirma con `git diff --stat` vacío sobre todo el rango de commits de la fase. Las tres rutas GSD/light-plan/nudge están cableadas end-to-end con tests de comportamiento reales (no solo presencia de símbolos), incluyendo un test de no-regresión explícito para D-02 LOCKED (rama GSD byte-idéntica).

Lo que falta para pasar a `passed` son 3 confirmaciones humanas explícitamente declaradas por el propio equipo ejecutor como pendientes de UAT (no ocultas, documentadas en los tres SUMMARY.md y en 75-VALIDATION.md §Manual-Only Verifications desde el inicio): la columna `next` con dato vivo, la entrega real del nudge vía cmux al orquestador, y el backstop de fidelidad del render markdown. Ninguna de las tres es alcanzable por verificación estática — la fase está funcionalmente completa a nivel de código pero requiere el paso de UAT humano que las plans ya reservaron para `/gsd-verify-work`.

Adicionalmente, el code review (`75-REVIEW.md`, advisory, 0 critical / 4 warnings) encontró una asimetría real de saneo: el `NEXT:` que llega al nudge vía `cmux.send` no pasa por `stripControlChars`, a diferencia del mismo dato en el render del dashboard (WR-01). No es un must-have declarado por el plan 75-02 y no bloquea el goal de la fase, pero se deja registrado para seguimiento (posible follow-up antes o durante el UAT).

---

_Verificado: 2026-07-17_
_Verificador: Claude (gsd-verifier)_
