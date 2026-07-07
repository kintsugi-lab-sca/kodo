---
phase: 71-fiabilidad-de-entrega-y-backstop
verified: 2026-07-07T09:30:09Z
status: human_needed
score: 4/4 must-haves verificados
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 2/4
  gaps_closed:
    - "DELIV-03 — `--task-url`/`--task-id` cableados end-to-end en `kodo adopt` → gate `(c2)` de reconciliación de `src/adopt.js` ahora alcanzable desde el CLI real."
    - "DELIV-04 — gate `isTerminalReviewState` en `runReviewBackstop` impide que el backstop cierre issues de GitHub; corregida la premisa falsa D-13 en `71-CONTEXT.md`/`71-RESEARCH.md`."
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Backstop end-to-end contra Plane real (diferido en VALIDATION.md, D6 del plan 71-03; reconfirmado como pendiente en 71-05): matar una sesión kodo sin `/exit` limpio del LLM con provider Plane y confirmar la transición a «In Review» + comentario «cierre automático»."
    expected: "La tarea en Plane pasa a `In review` (o el `states.review` configurado) y recibe un comentario «cierre automático»; el evento NDJSON `session.backstop.review` se emite con `{session_id, task_id, from:'in_progress', to:reviewState}`."
    why_human: "Requiere un provider Plane real y observar la transición de estado en la UI; no automatizable en la suite unitaria (mocks). Es UAT preexistente, no un gap de código: el gate de estado no-terminal de DELIV-04 no lo elimina (sigue siendo deseable verificar el happy-path de Plane en vivo)."
  - test: "Confirmar en un repo GitHub real que un `SessionEnd` limpio con el issue aún `in_progress` NUNCA cierra el issue (regresión del bug que motivó el gap 2)."
    expected: "El issue de GitHub permanece abierto tras el `SessionEnd`; se observa el log `session.backstop.skipped_terminal` en el NDJSON del hook."
    why_human: "Requiere un repo GitHub real y credenciales; la suite unitaria ya reproduce el escenario con un provider mock de 3 capacidades reales, pero no sustituye una confirmación contra la API real de GitHub."
---

# Fase 71: Fiabilidad de entrega y backstop — Informe de RE-verificación (post gap-closure)

**Objetivo de la fase:** Garantizar la entrega de dispatches y el cierre del ciclo de vida — cursor de polling con dispatch confirmado + centinela + adopt idempotente + backstop mecánico de "In Review" (T4/T5).
**Verificado:** 2026-07-07T09:30:09Z
**Status:** human_needed
**Re-verificación:** Sí — tras cierre de gaps (planes 71-04 y 71-05)

## Metodología

Esta es una RE-verificación goal-backward tras el cierre de los 2 gaps `BLOCKER` encontrados en la verificación inicial (`gaps_found`, 2/4). Para cada gap se aplicó el mismo estándar de alcanzabilidad end-to-end que detectó el problema original — no basta con que el mecanismo interno sea correcto, tiene que ser disparable por un consumidor real (CLI/hook) tal y como lo exige el Success Criterion del ROADMAP. Se leyó el código real (no solo SUMMARY.md), se trazó el camino desde el punto de entrada hasta el efecto observable, y se ejecutaron los tests fase-scoped y la suite completa en este proceso de verificación (no se reutilizaron resultados reportados por el ejecutor).

**Resultado:** ambos gaps se confirman CERRADOS contra el código real, siguiendo exactamente las direcciones de fix LOCKED por el operador. DELIV-01/02 permanecen intactos (sin regresión). Los 4 DELIV están correctos y alcanzables en código. Se mantiene un ítem de verificación humana (UAT contra Plane/GitHub reales) que es preexistente y no bloqueante para el cierre de fase.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidencia |
|---|-------|--------|-----------|
| 1 | DELIV-01 — un dispatch de polling que rechaza/hace timeout NO avanza el cursor sobre ese issue; se reintenta el siguiente tick; el webhook sigue fire-and-forget | ✓ VERIFIED | Sin cambios desde la verificación inicial. `git diff 951b966^..HEAD -- src/triggers/polling.js` vacío (confirmado en esta re-verificación) — el gap closure NO tocó `polling.js`. `confirmDispatch` (`src/triggers/polling.js:315-329`), watermark acotado (`:378-461`). Tests: 5 casos `startPolling — DELIV-01`, verde. |
| 2 | DELIV-02 — el primer tick distingue "cache ausente" de "observado" vía centinela explícito; no re-dispara lo visto ni salta issues nuevos | ✓ VERIFIED | Sin cambios. `shouldDispatch` (`polling.js:184-187`), persistencia `observed:true` (`:471-476`). Tests: 5 casos `startPolling — DELIV-02 centinela observed`, verde. |
| 3 | DELIV-03 (ahora) — `adopt` sobre una tarea ya adoptada (mismo `task_url`) no crea un duplicado, y el mecanismo es ALCANZABLE desde un operador real (Success Criterion #3 ROADMAP) | ✓ VERIFIED | Ver detalle en la sección "Verificación de gap 1" más abajo. `src/cli.js:284-285` declara `--task-url`/`--task-id`; `src/cli.js:298-299` los pasa a `runAdoptCli` como `taskUrl`/`taskId`; `src/cli/adopt.js:165-176` los reenvía a `adoptSession` como `task_url`/`task_id` con idioma spread-when-present. Test E2E vía `runAdoptCli` con `adoptSession` REAL (`test/adopt-cli.test.js:530-601`): run inicial → `PERSIST_FAILED` (1 `createTask`), re-run con los flags → `reused:true`, contador de `createTask` sigue en 1. `src/adopt.js` sin tocar (`git diff` vacío desde antes del gap-closure). |
| 4 | DELIV-04 (ahora) — al SessionEnd, si la tarea sigue "In Progress" y la sesión terminó limpia, el hook la pasa a "In Review" (Plane) y comenta "cierre automático"; para GitHub el backstop NUNCA cierra el issue (Success Criterion #4 ROADMAP) | ✓ VERIFIED | Ver detalle en la sección "Verificación de gap 2" más abajo. `isTerminalReviewState` (`src/hooks/session-end.js`, aprox. líneas 169-195) puro y never-throws; insertado tras resolver `reviewState` (`:266`) y antes de `updateTaskState` (`:284`) — exactamente en la ventana declarada por el plan. Test "GitHub REAL (3 capacidades) + states.review:'closed'" (`test/hooks/session-end.test.js:285-321`): `updateTaskState`/`addComment` con 0 llamadas, cleanup sigue corriendo. Test Plane no-terminal (`:323-346`): transiciona + comenta + evento NDJSON, comportamiento preservado. |

**Score:** 4/4 truths verificadas (0 presentes-sin-comportamiento-verificado).

### Verificación de gap 1 — DELIV-03 (adversarial)

- **`src/cli.js` declara los flags?** Sí: `.option('--task-url <url>', ...)` y `.option('--task-id <id>', ...)` (líneas 284-285), y el `.action` los pasa como `taskUrl: opts.taskUrl` / `taskId: opts.taskId` (líneas 298-299) al objeto de `runAdoptCli`.
- **`src/cli/adopt.js` los reenvía?** Sí (líneas ~165-176): `...(opts.taskUrl ? { task_url: opts.taskUrl } : {})` y `...(opts.taskId ? { task_id: opts.taskId } : {})` — idioma spread-when-present, confirmado por los tests R1 (`test/adopt-cli.test.js:496-510`, con flags → claves presentes) y R2 (`:512-526`, sin flags → claves AUSENTES, nunca `undefined`).
- **¿Traza un re-run tras `PERSIST_FAILED` hasta `(c2)` de `src/adopt.js:271` produciendo UN SOLO `createTask`?** Sí — el test E2E (`test/adopt-cli.test.js:529-601`) invoca `runAdoptCli` (no `adoptSession` directo) dos veces con un `provider.createTask` espía contador: run inicial (sin flags) → `addSession` lanza → rama `(d)` `createTask` (contador 1) → `PERSIST_FAILED`, exit 1. Re-run (mismos `workspaceRef`/`cwd`/`sessionId`, con `taskUrl`/`taskId`, `addSession` ya no lanza) → `runAdoptCli` con `--json` devuelve `{ok:true, reused:true}`, exit 0, contador de `createTask` **sigue en 1**. Ejecutado en este proceso de verificación: `node --test test/adopt-cli.test.js` → 34/34 verde (incluye E2E).
- **¿Es genuinamente end-to-end vía `runAdoptCli` (no `adoptSession` directo)?** Sí — `deps.adoptSessionFn = (args) => adoptSession(args, stateDeps)` usa el `adoptSession` REAL importado de `../src/adopt.js`; el punto de entrada ejercitado es `runAdoptCli`, que es el handler real invocado desde `src/cli.js`.
- **¿El guard `sessionId` y los 5 discriminantes siguen intactos?** Sí — `grep` confirma los 5 códigos (`UNSUPPORTED`/`INVALID_INPUT`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`) presentes en `src/adopt.js`, y `findSessionFn({ sessionId })` (línea 257) sin modificar.
- **¿`src/adopt.js` quedó sin tocar?** Sí — `git log --oneline -- src/adopt.js` no muestra ningún commit del gap-closure (`951b966`, `6d131b4`); el último commit que tocó el fichero es `f9e7f34` (71-02), previo a esta verificación.

### Verificación de gap 2 — DELIV-04 (adversarial)

- **¿Existe `isTerminalReviewState` en `src/hooks/session-end.js`, insertado tras resolver `reviewState` y antes de `updateTaskState`?** Sí — el predicado se define antes de `runReviewBackstop`; la llamada al gate está en las líneas 266 (resolución de `reviewState`) → 273-280 (gate + `return` temprano con log de skip) → 284 (`updateTaskState`), exactamente el orden declarado por el plan 71-05.
- **Traza GitHub (`getTaskState==='in_progress'`, `states.review:'closed'`) → ¿backstop no-op?** Sí — test `'GitHub REAL (3 capacidades) + states.review:"closed" → no-op...'` (`test/hooks/session-end.test.js:285-321`) usa un provider mock con las 3 capacidades REALES implementadas (no el mock "sin capacidades" del test anterior, que estaba mal etiquetado como GitHub); assert `calls.updateTaskState.length === 0`, `calls.addComment.length === 0`, ningún evento `session.backstop.review`, y SÍ se emite `session.backstop.skipped_terminal` con exactamente `{session_id, task_id, state}` (verificado con `Object.keys(skip.fields).sort()`). El cleanup (`removeSession`) sigue corriendo (`removed` contiene el `task_id`).
- **Plane (`states.review:'In review'`) → ¿sí transiciona?** Sí — test `'Plane (states.review:"In review", no-terminal) → transiciona...'` (`:323-346`): `updateTaskState` llamado 1 vez con `'In review'`, `addComment` con `'cierre automático'`, evento NDJSON emitido.
- **¿El predicado es provider-agnostic razonable (states.done + 'closed')?** Sí — `isTerminalReviewState` normaliza a lowercase/trim, retorna `true` si coincide con el token nativo `'closed'` O con `providerCfg.states.done`. Test adicional `'states.done captura un review terminal por vía agnóstica'` (`:348-370`) confirma la vía agnóstica sin depender del literal `'closed'` (provider `x` con `states.review:'Done'===states.done`).
- **¿Se corrigió la premisa falsa D-13 en `71-CONTEXT.md` y `71-RESEARCH.md`?** Sí — `grep -n "gate de estado no-terminal"` produce 6 coincidencias combinadas entre ambos ficheros (D-13 en ambos, más §Pattern 2, code-example, tabla de Dependencies y test-map en `71-RESEARCH.md`), todas explicando que GitHub SÍ implementa las 3 capacidades y que el no-op deriva del gate de estado no-terminal.
- **¿NO se adoptó el gate `verdict.action==='pass'`?** Confirmado — `grep -n "verdict.action" src/hooks/session-end.js` no produce ninguna coincidencia; el fix implementado es exclusivamente el gate de estado no-terminal, tal como exigía la decisión LOCKED del operador.
- **¿never-throws/fail-open preservado?** Sí — test `'gate never-throws sobre config basura (states.done no-string)...'` (`:372+`) usa `assert.doesNotReject`; el predicado guarda tipos con `typeof` antes de normalizar.

### Requerimiento 71-01/02: `polling.js` sin tocar en el gap-closure

`git diff --stat 951b966^..HEAD -- src/triggers/polling.js` → vacío (confirmado en esta re-verificación). Los commits del gap-closure (`951b966`, `6d131b4`, `c93573b`, `99f12dd`, `57b4cd4`) solo tocan `src/cli.js`, `src/cli/adopt.js`, `test/adopt-cli.test.js`, `src/hooks/session-end.js`, `test/hooks/session-end.test.js`, `71-CONTEXT.md`, `71-RESEARCH.md` — ningún fichero de polling ni webhook.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/triggers/polling.js` | Sin cambios desde verificación inicial | ✓ VERIFIED | `git diff` vacío desde el gap-closure |
| `src/cli.js` | Flags `--task-url`/`--task-id` en `adopt` | ✓ VERIFIED | Líneas 284-285 (declaración), 298-299 (paso a `runAdoptCli`) |
| `src/cli/adopt.js` | Reenvío `taskUrl→task_url`/`taskId→task_id` spread-when-present | ✓ VERIFIED | Líneas ~165-176; typedef `RunAdoptCliOpts` extendido |
| `src/adopt.js` | Sin tocar (mecanismo `(c2)` ya existía) | ✓ VERIFIED | `git log` confirma último commit `f9e7f34` (71-02), fuera del rango del gap-closure |
| `test/adopt-cli.test.js` | Tests R1/R2 (reenvío) + E2E (recuperación, 1 solo `createTask`) | ✓ VERIFIED | 34 tests, todos en verde (`node --test`) |
| `src/hooks/session-end.js` | `isTerminalReviewState` + gate insertado | ✓ VERIFIED | Predicado puro/never-throws; gate entre resolución de `reviewState` (:266) y `updateTaskState` (:284) |
| `test/hooks/session-end.test.js` | Casos GitHub-real-no-op, Plane-transiciona, states.done-agnóstico, never-throws | ✓ VERIFIED | Todos en verde |
| `71-CONTEXT.md` / `71-RESEARCH.md` | Premisa D-13 corregida | ✓ VERIFIED | `grep -q "gate de estado no-terminal"` positivo en ambos |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cli.js` (`kodo adopt`) | `runAdoptCli` | `taskUrl`/`taskId` en el objeto de opts | WIRED | Confirmado por lectura + test R1/R2 |
| `runAdoptCli` | `adoptSession` (`src/adopt.js`) | `task_url`/`task_id` spread-when-present | WIRED | Test E2E confirma que un `task_url` no vacío llega hasta `(c2)` y evita un segundo `createTask` |
| `runReviewBackstop` → `reviewState` | `isTerminalReviewState` | llamada directa tras resolver `reviewState`, antes de `updateTaskState` | WIRED | Confirmado por lectura de línea y por los 4 tests nuevos del gate |
| `isTerminalReviewState` | `providerCfg.states.done` / token `'closed'` | comparación normalizada | WIRED | Test agnóstico (`states.done`) y test GitHub (`'closed'`) ambos en verde |

### Requirements Coverage

| Requirement | Plan fuente | Descripción | Status | Evidencia |
|-------------|-------------|-------------|--------|-----------|
| DELIV-01 | 71-01 | Cursor de polling avanza solo con dispatch confirmado | ✓ SATISFIED | Sin cambios, verificado de nuevo (regresión) |
| DELIV-02 | 71-01 | Centinela `observed` separa cache-ausente de primer-tick-observado | ✓ SATISFIED | Sin cambios, verificado de nuevo (regresión) |
| DELIV-03 | 71-02 + 71-04 (gap closure) | `adopt` idempotente por `task_url`, alcanzable desde el CLI | ✓ SATISFIED | Gap 1 cerrado — ver "Verificación de gap 1" |
| DELIV-04 | 71-03 + 71-05 (gap closure) | Backstop mecánico "In Review" en SessionEnd, sin cerrar issues de GitHub | ✓ SATISFIED | Gap 2 cerrado — ver "Verificación de gap 2" |

No hay requisitos huérfanos.

### Anti-Patrones Encontrados

Ninguno bloqueante en los ficheros tocados por el gap-closure (`src/cli.js`, `src/cli/adopt.js`, `src/hooks/session-end.js`, tests, docs). Sin `TBD`/`FIXME`/`XXX`/placeholders nuevos. `void input;` en `session-end.js` sigue presente (documentado, no un anti-patrón de ocultamiento) — fuera de scope del fix LOCKED (el operador descartó explícitamente el gate `verdict.action==='pass'`).

### Comprobaciones de comportamiento (spot-checks)

| Comportamiento | Comando | Resultado | Status |
|---|---|---|---|
| Suite fase-scoped (adopt-cli + adopt + session-end + polling) | `node --test test/adopt-cli.test.js test/adopt.test.js test/hooks/session-end.test.js test/triggers/polling.test.js` | 130 tests, 0 fallos | ✓ PASS |
| Suite completa del proyecto (regresión) | `npm test` | 1914 pass / 0 fail / 1 skip (preexistente) | ✓ PASS |
| `src/adopt.js` sin tocar en el gap-closure | `git log --oneline -- src/adopt.js` | último commit `f9e7f34` (71-02), anterior al gap-closure | ✓ PASS |
| `src/triggers/polling.js` sin tocar en el gap-closure | `git diff --stat 951b966^..HEAD -- src/triggers/polling.js` | vacío | ✓ PASS |
| Gate `verdict.action==='pass'` NO adoptado | `grep -n "verdict.action" src/hooks/session-end.js` | sin coincidencias | ✓ PASS |
| Premisa D-13 corregida en docs | `grep -q "gate de estado no-terminal"` en ambos `.md` | positivo en ambos | ✓ PASS |

### Verificación Humana Requerida

#### 1. Backstop end-to-end contra Plane real (UAT preexistente, diferido en VALIDATION.md D6 del plan 71-03)

**Test:** Matar una sesión kodo sin `/exit` limpio del LLM (provider Plane), con la tarea aún en `in_progress`.
**Esperado:** La tarea pasa a `In review` y recibe el comentario «cierre automático»; se emite `session.backstop.review`.
**Por qué humano:** Requiere un provider Plane real y observar la transición en la UI — no automatizable en la suite unitaria. Este ítem es preexistente a los gaps 71-04/71-05; el fix de DELIV-04 no lo elimina ni lo modifica (sigue siendo deseable confirmar el happy-path de Plane en vivo).

#### 2. Confirmación en GitHub real de que el backstop nunca cierra el issue

**Test:** `SessionEnd` limpio con un issue de GitHub `in_progress` real.
**Esperado:** El issue permanece abierto tras el `SessionEnd`; se observa `session.backstop.skipped_terminal` en el log NDJSON del hook.
**Por qué humano:** Requiere credenciales y un repo GitHub real; la suite unitaria ya reproduce el escenario con un mock de 3 capacidades reales (ver "Verificación de gap 2"), pero una confirmación contra la API real de GitHub cierra el círculo completo de la regresión que motivó el gap 2.

## Resumen de Gaps

**Ninguno.** Los 2 gaps de la verificación inicial (DELIV-03 inalcanzable desde el CLI; DELIV-04 cerraba issues de GitHub) se confirman CERRADOS contra el código real, siguiendo exactamente las direcciones de fix LOCKED por el operador (flags de recuperación en el CLI para DELIV-03; gate de estado no-terminal — no el gate `verdict.action==='pass'` — para DELIV-04). DELIV-01/02 no presentan regresión. La suite completa (1914/1914, 1 skip preexistente ajeno) y la suite fase-scoped (130/130) pasan en verde en este proceso de verificación.

El único ítem pendiente es la verificación humana contra proveedores reales (Plane y GitHub), que es un UAT complementario y no bloqueante: el código es correcto y alcanzable, la brecha restante es de tipo "confirmar en producción", no "cerrar un gap de implementación".

---

_Verificado: 2026-07-07T09:30:09Z_
_Verificador: Claude (gsd-verifier)_
