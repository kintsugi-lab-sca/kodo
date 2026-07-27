---
phase: 71
slug: fiabilidad-de-entrega-y-backstop
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-07
---

# Phase 71 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-02).
> Cobertura **citada** de `71-VERIFICATION.md` (passed 4/4 must-haves tras el cierre de los 2 gaps BLOCKER) + los 5 SUMMARY de plan + `71-UAT.md`.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) + `node:assert/strict` |
| **Config file** | none — runner nativo, convención `test/**/*.test.js` |
| **Quick run command** | `node --test test/triggers/polling.test.js test/adopt.test.js test/adopt-cli.test.js test/hooks/session-end.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~30–60 segundos (suite completa **1914 pass / 1 skip / 0 fail** en la corrida citada) |
| **Evidencia citada** | `71-VERIFICATION.md` (2026-07-07T09:30:09Z, status passed, score 4/4 must-haves, `behavior_unverified: 0`, `gaps_remaining: []`, `regressions: []`) + `71-UAT.md` (`status: complete`, 2026-07-09) |

---

## Sampling Rate

- **Evidencia primaria:** `71-VERIFICATION.md` — **RE-verificación** goal-backward tras cerrar los 2 gaps `BLOCKER` de la verificación inicial (que estaba en `gaps_found`, 2/4): 4/4 observable truths + 8/8 required artifacts + 4/4 key-links, con `behavior_unverified: 0` y `regressions: []`. El propio informe declara haber **ejecutado** los tests fase-scoped y la suite completa en su proceso de verificación, sin reutilizar resultados reportados por el ejecutor.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** `71-UAT.md` — **2 tests totales: 1 pass, 1 skipped** (`passed: 1`, `skipped: 1`, `issues: 0`). El test 1 (backstop end-to-end contra Plane real, el crítico contra provider vivo) **pasó**. El test 2 (GitHub real) quedó **skipped**, reconocido explícitamente por el operador el **2026-07-09**, con el mock de las 3 capacidades reales como cobertura compensatoria (`71-VERIFICATION.md` §Acknowledged Gaps). **Aquí se contabiliza como skip, no como pass.** Nota de reconciliación: el cuerpo del `71-VERIFICATION.md` dice «Status: human_needed» porque se escribió con el UAT aún pendiente; su frontmatter quedó en `status: passed` y el `71-UAT.md` cerró el ciclo dos días después con `status: complete`.

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| DELIV-01 | 71-01 | (T4) Un dispatch de polling que rechaza o hace timeout **NO** avanza el cursor sobre ese issue: se reintenta en el siguiente tick. El carril webhook sigue fire-and-forget y el watermark queda acotado | unit | `node --test test/triggers/polling.test.js` | `71-VERIFICATION.md` Observable Truths → Truth #1 ✓ VERIFIED (`confirmDispatch` en `src/triggers/polling.js:315-329`; watermark acotado `:378-461`; **5 casos** `startPolling — DELIV-01` en verde) + §«`polling.js` sin tocar en el gap-closure» → `git diff --stat 951b966^..HEAD -- src/triggers/polling.js` **vacío** ✓ PASS (sin regresión); Spot-Checks → suite fase-scoped **130 tests / 0 fallos** | ✅ green |
| DELIV-02 | 71-01 | El primer tick distingue «cache ausente» de «observado» mediante un centinela explícito `observed:true`: ni re-dispara lo ya visto ni se salta issues nuevos — sin storm de arranque | unit | `node --test test/triggers/polling.test.js` | `71-VERIFICATION.md` Truth #2 ✓ VERIFIED (`shouldDispatch` en `polling.js:184-187`; persistencia de `observed:true` en `:471-476`; **5 casos** `startPolling — DELIV-02 centinela observed` en verde); §Requirements Coverage → DELIV-02 ✓ SATISFIED «sin cambios, verificado de nuevo (regresión)» | ✅ green |
| DELIV-03 | 71-02 | El mecanismo de idempotencia: un re-run tras `PERSIST_FAILED` que reintroduce el `task_url`/`task_id` reconcilia la fila local con **un solo** `createTask`; los 5 discriminantes de error y el guard por `sessionId` intactos | unit (`adoptSession` directo) | `node --test test/adopt.test.js` | `71-VERIFICATION.md` §Verificación de gap 1 → los 5 códigos (`UNSUPPORTED`/`INVALID_INPUT`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`) confirmados por grep y `findSessionFn({ sessionId })` (`src/adopt.js:257`) sin modificar; §Required Artifacts → `src/adopt.js` **sin tocar** (último commit `f9e7f34`, de 71-02, fuera del rango del gap-closure) ✓ VERIFIED. El caso vive en `test/adopt.test.js:206` («re-run tras PERSIST_FAILED pasando task_url reconcilia con UN SOLO createTask (DELIV-03)») | ✅ green |
| DELIV-03 | 71-02 + 71-04 (gap closure) | **Alcanzabilidad** del mecanismo desde un operador real — el gap BLOCKER original: `kodo adopt` declara `--task-url`/`--task-id` y los reenvía con idioma *spread-when-present* (claves **ausentes**, nunca `undefined`), de modo que el gate `(c2)` de reconciliación sea disparable desde el CLI y no solo desde la API interna | integration E2E (vía `runAdoptCli` con el `adoptSession` REAL) | `node --test test/adopt-cli.test.js` | `71-VERIFICATION.md` Truth #3 ✓ VERIFIED y §Verificación de gap 1 (adversarial): `src/cli.js:284-285` declara los flags y `:298-299` los pasa; `src/cli/adopt.js:165-176` los reenvía; tests R1 (`test/adopt-cli.test.js:496-510`) y R2 (`:512-526`) cubren presencia/ausencia; el **E2E** (`:529-601`) corre dos veces con un espía contador y deja `createTask` **en 1** con `{ok:true, reused:true}`. Ejecutado en la propia verificación: `node --test test/adopt-cli.test.js` → **34/34 verde** | ✅ green |
| DELIV-04 | 71-03 | (T5) Backstop mecánico: al `SessionEnd`, con la tarea aún «In Progress» y cierre limpio, el hook la transiciona al `states.review` del provider (Plane: `In review`), comenta «cierre automático» y emite el evento NDJSON `session.backstop.review` | unit (DI con provider mock) | `node --test test/hooks/session-end.test.js` | `71-VERIFICATION.md` Truth #4 ✓ VERIFIED y §Verificación de gap 2: test «Plane (`states.review:"In review"`, no-terminal) → transiciona…» (`test/hooks/session-end.test.js:323-346`) — `updateTaskState` llamado **1 vez** con `'In review'`, `addComment` con `'cierre automático'`, evento NDJSON emitido; §Key Link Verification → `runReviewBackstop` → `isTerminalReviewState` ✓ WIRED | ✅ green |
| DELIV-04 | 71-03 + 71-05 (gap closure) | El gate `isTerminalReviewState` — el segundo gap BLOCKER: para un provider cuyo `states.review` es terminal (GitHub, `'closed'`) el backstop es **no-op absoluto** y **nunca cierra el issue**; emite `session.backstop.skipped_terminal` y deja correr el cleanup. Predicado puro, provider-agnostic (`states.done` además del token nativo) y **never-throws** ante config basura | unit (DI, mock de 3 capacidades reales) | `node --test test/hooks/session-end.test.js` | `71-VERIFICATION.md` Truth #4 ✓ VERIFIED y §Verificación de gap 2 (adversarial): test «GitHub REAL (3 capacidades) + `states.review:"closed"` → no-op» (`test/hooks/session-end.test.js:285-321`) con `updateTaskState.length === 0`, `addComment.length === 0`, ningún `session.backstop.review`, y `session.backstop.skipped_terminal` con exactamente `{session_id, task_id, state}`; test agnóstico por `states.done` (`:348-370`); test never-throws con `assert.doesNotReject` (`:372+`). Además §Spot-Checks → `grep -n "verdict.action" src/hooks/session-end.js` **sin coincidencias** ✓ PASS (el gate descartado por el operador **no** se coló) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements — sin framework install y sin fixture compartido: `test/triggers/polling.test.js`, `test/adopt.test.js` y `test/hooks/session-end.test.js` ya existían con sus helpers (`createTestClock`, DI de `addSession` que lanza, `makeSession`); la fase solo añadió `it()` nuevos más un provider mock con espías. La única ruta que el seed no anticipó es `test/adopt-cli.test.js` — el fichero donde vive la prueba E2E de alcanzabilidad de DELIV-03, creado/extendido durante el gap-closure de 71-04. `wave_0_complete` se conserva en `false` tal y como llegaba (**D-14**: ante duda no se re-deriva un flag de proceso ya cerrado).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Backstop end-to-end contra **Plane real**: matar una sesión kodo sin `/exit` limpio del LLM, con la tarea aún `in_progress`, y observar la transición a «In review» + comentario «cierre automático» + evento `session.backstop.review` | DELIV-04 | Manual-only **por construcción**: requiere un provider Plane vivo y observar la transición en su UI. La suite unitaria trabaja con mocks y no sustituye el happy-path contra el servicio real. Es UAT preexistente (diferido en el plan 71-03), no un gap de implementación. | `71-UAT.md` test 1 → **`result: pass`**. Es el ítem humano **crítico** de la fase y está **cumplido**. Su contraparte automatizada también está verde y citada: `71-VERIFICATION.md` §Verificación de gap 2, test Plane no-terminal (`test/hooks/session-end.test.js:323-346`) con `updateTaskState` 1× `'In review'` + `addComment` «cierre automático» + evento NDJSON. |
| Confirmación contra **GitHub real** de que un `SessionEnd` limpio con el issue aún `in_progress` **nunca** lo cierra (se observa `session.backstop.skipped_terminal` en el NDJSON del hook) | DELIV-04 | Manual-only **por construcción**: requiere credenciales y un repo GitHub real. La suite ya reproduce el escenario con un provider mock, pero una confirmación contra la API real cierra el círculo de la regresión que motivó el gap 2. | `71-UAT.md` test 2 → **`result: skipped`**, no pass. Skip **reconocido explícitamente por el operador el 2026-07-09** (`71-VERIFICATION.md` §Acknowledged Gaps): el setup solo tenía provider Plane y no había repo GitHub a mano. **Cobertura compensatoria citada:** `test/hooks/session-end.test.js:285-321` reproduce el escenario con un mock GitHub de las **3 capacidades reales** (`getTaskState`/`updateTaskState`/`addComment`) + `states.review:'closed'` → **0 llamadas** a `updateTaskState`/`addComment` (no-op verificado), y el gate `isTerminalReviewState` está confirmado en código (4/4 must-haves). Esta fila queda contabilizada como **skip con cobertura compensatoria**, nunca como verificación cumplida. **`STATE.md` §Deferred Items mantiene su fila abierta para este item y esta fase no la cierra** — el backfill solo la deja correctamente contabilizada. |

---

## Validation Sign-Off

- [x] Cada requirement (DELIV-01..04) mapeado a ≥1 cita de evidencia real en `71-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para las 6 dimensiones de riesgo (cursor con dispatch confirmado, centinela `observed`, mecanismo de idempotencia, su alcanzabilidad desde el CLI, transición del backstop y el gate de estado terminal)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente; `test/adopt-cli.test.js` se sumó durante el gap-closure de 71-04)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada; el ítem humano no cumplido se declara **skipped**, no verde
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-02)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-02)

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (DELIV-01..04) |
| COVERED (automated unit/integration) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design, complementario) | 2 items contra servicio externo vivo: Plane real (`71-UAT.md` **1 pass**) y GitHub real (`71-UAT.md` **1 skipped**, reconocido 2026-07-09, con mock de 3 capacidades como cobertura compensatoria) |
| Tests citados (no re-corridos) | **130 tests / 0 fallos** en la suite fase-scoped (`adopt-cli` + `adopt` + `session-end` + `polling`), de los cuales **34/34** en `test/adopt-cli.test.js` y 5+5 casos DELIV-01/DELIV-02 en `polling.test.js`; sobre suite completa **1914 pass / 1 skip / 0 fail** |

**Nota Nyquist:** La lógica de riesgo de la fase (no avanzar el cursor sin dispatch confirmado, centinela que separa cache-ausente de primer-tick-observado, idempotencia de `adopt` por `task_url` **y su alcanzabilidad real desde el CLI**, y un backstop que transiciona en Plane pero **nunca** cierra un issue de GitHub gracias a un gate de estado terminal puro y never-throws) está cubierta por tests unitarios con DI y por una prueba E2E que atraviesa el handler real, ya verde y verificada en `71-VERIFICATION.md` (passed 4/4 tras cerrar los 2 gaps BLOCKER, `behavior_unverified: 0`, `gaps_remaining: []`, `regressions: []`). Los 2 items de verificación humana son manual-only **por construcción** (exigen Plane y GitHub vivos), no huecos de sampling: el crítico —Plane— está **pass**, y el de GitHub está **skipped con constancia escrita y cobertura compensatoria citada**, sin maquillarse como cumplido. **Sin re-ejecutar la suite** — cobertura citada de `71-VERIFICATION.md` + 71-0{1,2,3,4,5}-SUMMARY.md + `71-UAT.md`. Fase declarada **nyquist-compliant**.
