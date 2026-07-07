---
phase: 71-fiabilidad-de-entrega-y-backstop
verified: 2026-07-07T08:40:00Z
status: gaps_found
score: 2/4 must-haves verificados (DELIV-01, DELIV-02 OK; DELIV-03, DELIV-04 fallan end-to-end)
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "`adopt` sobre una tarea ya adoptada (mismo `task_url`) no crea un duplicado — busca por `task_url` antes de `createTask` (Success Criterion #3 del ROADMAP, DELIV-03)."
    status: failed
    reason: >
      El mecanismo de idempotencia por `task_url` en `adoptSession` (src/adopt.js:271)
      es correcto en aislamiento, pero es INALCANZABLE desde cualquier consumidor real.
      Ningún caller de producción conoce ni reenvía `task_url`/`task_id`/`task_ref`.
      Un operador que sufre un `PERSIST_FAILED` no tiene forma de disparar la
      reconciliación; la única acción disponible (re-correr `kodo adopt` con los
      mismos argumentos) cae de nuevo en `createTask` y crea una segunda tarea en
      Plane — exactamente el bug M11 que DELIV-03 dice cerrar.
    artifacts:
      - path: "src/cli.js:274-305"
        issue: "El comando `kodo adopt` no declara ningún flag `--task-url`/`--task-id`; no hay forma de pasar la identidad de recuperación desde la CLI."
      - path: "src/cli/adopt.js:165-176"
        issue: "`runAdoptCli` construye el objeto pasado a `adoptSessionFn` con `{provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title, description, module}` — sin `task_url`/`task_id`/`task_ref`, aunque `opts` los tuviera."
      - path: "src/cli/dashboard/adopt.js:112-147"
        issue: "El argv literal de 8 (+title/description/--json) elementos que la tecla `a` del dashboard construye para invocar `kodo adopt` no incluye ningún flag de `task_url`."
      - path: "src/adopt.js:271"
        issue: "El bloque de idempotencia por `task_url` (barrido local + reconciliación) está gateado por `typeof task_url === 'string' && task_url.length > 0` — nunca se activa porque ningún caller lo puebla."
    missing:
      - "Añadir `--task-url`/`--task-id` (opcionales) al comando `kodo adopt` en `src/cli.js`."
      - "Reenviar esos flags desde `runAdoptCli` (`src/cli/adopt.js`) hacia `adoptSessionFn`."
      - "Opcionalmente, para que el barrido local sea útil sin que el operador conozca el `task_url` de antemano, resolver la identidad recuperable localmente (p. ej. `listSessions`/`listHistory` por `workspaceRef`/`cwd`) ANTES de intentar `createTask`, en vez de depender solo del argumento explícito."
      - "Confirmado por lectura exhaustiva: `grep -rn \"adoptSession(\" src --include=\"*.js\"` devuelve un ÚNICO call site en todo el árbol (`src/adopt.js:206` la definición; `src/cli/adopt.js:165` la única invocación) — no existe un segundo consumidor (orquestador) que sí propague `task_url`."
  - truth: "Matar una sesión sin que el LLM transicione la tarea → al SessionEnd, si sigue «In Progress» y la sesión terminó limpia, el hook la pasa a «In Review» y comenta «cierre automático» (Success Criterion #4 del ROADMAP, DELIV-04)."
    status: failed
    reason: >
      Para Plane el backstop funciona como se describe. Para GitHub, la premisa
      documentada en 71-CONTEXT.md/71-RESEARCH.md ("GitHub no implementa transición
      de estado igual que Plane → el provider degrada a no-op", D-13) es
      empíricamente falsa: GitHub SÍ implementa `getTaskState`/`updateTaskState`/
      `addComment`. El capability-gate de `runReviewBackstop` (session-end.js:183-190)
      PASA para GitHub. Combinado con el default `states.review: 'closed'` de GitHub
      (config.js:333) y el passthrough hard de `updateTaskState` (que trata 'closed'
      como un estado nativo y llama directo a `client.updateIssue(..., {state:'closed'})`,
      provider.js:129-142), el backstop CIERRA el issue de GitHub en vez de mandarlo a
      revisión — en CUALQUIER `SessionEnd` "limpio" con la tarea todavía `in_progress`,
      sin el gate `verdict.action === 'pass'` que protege el mismo camino en
      `src/gsd/verify.js:257`. `runReviewBackstop` trata TODO `input.reason` como limpio
      (`void input;`, session-end.js:209) — no distingue trabajo completado de una
      sesión interrumpida.
    artifacts:
      - path: "src/hooks/session-end.js:183-190"
        issue: "Capability gate por `typeof` — no excluye explícitamente a GitHub; pasa porque GitHub implementa las 3 capacidades."
      - path: "src/providers/github/provider.js:129-142,145-148,178-181"
        issue: "`updateTaskState`/`addComment`/`getTaskState` están implementados — el gate NO degrada a no-op para GitHub, contradiciendo D-13/71-CONTEXT.md/71-RESEARCH.md."
      - path: "src/config.js:327-335"
        issue: "`getDefaultGithubProviderConfig()` fija `states.review: 'closed'` — el backstop resuelve `reviewState='closed'` para GitHub por defecto (session-end.js:225-227)."
      - path: "src/hooks/session-end.js:203-209"
        issue: "`runReviewBackstop` no implementa ningún chequeo real de `input.reason` (`void input;`) — es fail-open incondicional, sin el gate `verdict.action==='pass'` que protege el mismo camino en `src/gsd/verify.js:257`."
    missing:
      - "Excluir explícitamente a GitHub del backstop (o de la resolución de `reviewState` cuando coincide con un estado terminal nativo `'closed'`), dado que su modelo binario open/closed no tiene un análogo seguro a «In Review»."
      - "O añadir un gate equivalente a `verdict.action === 'pass'` (evidencia de trabajo completado) antes de transicionar, en vez de fiarse solo de que la sesión no crasheó."
      - "Corregir la documentación (71-CONTEXT.md/71-RESEARCH.md) que afirma incorrectamente que GitHub degrada a no-op, y decidir conscientemente si cerrar issues de GitHub automáticamente es el comportamiento deseado."
human_verification:
  - test: "Backstop end-to-end contra Plane real (diferido en VALIDATION.md, D6 del plan 71-03): matar una sesión kodo sin `/exit` limpio del LLM con provider Plane y confirmar la transición a «In Review» + comentario «cierre automático»."
    expected: "La tarea en Plane pasa a `In review` (o el `states.review` configurado) y recibe un comentario «cierre automático»; el evento NDJSON `session.backstop.review` se emite con `{session_id, task_id, from:'in_progress', to:reviewState}`."
    why_human: "Requiere un provider Plane real y observar la transición de estado en la UI; no automatizable en la suite unitaria (mocks)."
---

# Fase 71: Fiabilidad de entrega y backstop — Informe de verificación

**Objetivo de la fase:** Garantizar la entrega de dispatches y el cierre del ciclo de vida — el cursor de polling deja de saltarse issues cuyo dispatch no confirmó, y "In Review" gana un backstop mecánico que ya no depende del LLM (causas raíz T4/T5).
**Verificado:** 2026-07-07T08:40:00Z
**Status:** gaps_found
**Re-verificación:** No — verificación inicial

## Metodología

Esta verificación es **goal-backward y de alcanzabilidad end-to-end**: no basta con que los tests unitarios pasen (lo hacen — 92/92 en los 3 ficheros de test de la fase, y 1907/1908 en la suite completa, 1 skip preexistente ajeno). Para cada DELIV se trazó el camino real desde el punto de entrada (CLI/hook/daemon) hasta el código nuevo, para confirmar que un usuario real puede disparar el comportamiento prometido — y se contrastó explícitamente contra `71-REVIEW.md` (code review adversarial reciente, 2 BLOCKER con anclas de código), validando cada BLOCKER contra el código real en vez de tomarlo como verdad ciega.

**Resultado:** los 2 BLOCKER de `71-REVIEW.md` se **confirman íntegramente** contra el código real. DELIV-01 y DELIV-02 están correctamente implementados y son alcanzables. DELIV-03 y DELIV-04 tienen código internamente correcto pero fallan el criterio end-to-end del ROADMAP.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidencia |
|---|-------|--------|-----------|
| 1 | DELIV-01 — un dispatch de polling que rechaza/hace timeout NO avanza el cursor sobre ese issue; se reintenta el siguiente tick; el webhook sigue fire-and-forget | ✓ VERIFIED | `confirmDispatch` (`src/triggers/polling.js:315-329`) usa `Promise.race` con `clock.setTimeout`/`clearTimeout` en `finally`, never-throws. El loop (`:378-461`) separa `maxUpdatedAt` de `failedUpdatedAts`; el watermark se acota estrictamente por debajo de `min(failedUpdatedAts)` o retrocede a `prev.last_updated_at` (`:457-461`), aplicado en ambos paths (client/provider). `git diff --stat afdbad1^..HEAD -- src/triggers/webhook.js` → vacío (confirmado, webhook intacto). Tests: 5 casos en `startPolling — DELIV-01` (rechazo, timeout, watermark acotado A-falla/B-ok), todos en verde. |
| 2 | DELIV-02 — el primer tick distingue "cache ausente" de "observado" vía centinela explícito; no re-dispara lo visto ni salta issues nuevos | ✓ VERIFIED | `shouldDispatch` (`polling.js:184-187`) decide el skip por `prev.observed !== true`, no por `!prev.last_updated_at`. El path 200 persiste `observed:true` siempre (`:471-476`), con o sin items. La rama 304 no escribe cache (`:356-374`, verificado sin tocar). Entrada legacy sin `observed` cae en primer-tick-skip (retrocompat segura). Tests: 5 casos en `startPolling — DELIV-02 centinela observed`, todos en verde. |
| 3 | DELIV-03 — `adopt` sobre una tarea ya adoptada (mismo `task_url`) no crea un duplicado (Success Criterion #3 ROADMAP) | ✗ FAILED | Mecanismo interno correcto (`src/adopt.js:262-307`) pero **inalcanzable**: ningún consumidor real (`src/cli.js:274-305`, `src/cli/adopt.js:165-176`, `src/cli/dashboard/adopt.js:112-147`) declara o reenvía `task_url`/`task_id`. Único call site de `adoptSession` en todo el árbol es `src/cli/adopt.js:165`, y no propaga esos campos. Ver Gaps. |
| 4 | DELIV-04 — al SessionEnd, si la tarea sigue "In Progress" y la sesión terminó limpia, el hook la pasa a "In Review" y comenta "cierre automático" (Success Criterion #4 ROADMAP) | ✗ FAILED | Correcto para Plane. Para GitHub, el capability-gate (`session-end.js:183-190`) NO degrada a no-op (GitHub implementa las 3 capacidades — `providers/github/provider.js:129,145,178`) y el default `states.review:'closed'` (`config.js:333`) hace que el backstop **cierre** el issue en vez de mandarlo a revisión, en cualquier `SessionEnd` limpio, sin el gate `verdict.action==='pass'` que protege el mismo camino en `verify.js:257`. Ver Gaps. |

**Score:** 2/4 truths verificadas (0 presentes-sin-comportamiento-verificado).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/triggers/polling.js` | `confirmDispatch` + watermark acotado + centinela `observed` | ✓ VERIFIED | Existe, sustantivo, cableado; tests pasan (10/10 casos DELIV-01/02) |
| `test/triggers/polling.test.js` | Casos DELIV-01/02 | ✓ VERIFIED | 16 suites, todas en verde |
| `src/adopt.js` | Idempotencia por `task_url` (recuperación + barrido local) | ⚠️ ORPHANED (mecánicamente) | El código existe y es sustantivo, pero está **desconectado de todo consumidor real** — ver Key Link Verification |
| `test/adopt.test.js` | Ventana PERSIST_FAILED, barrido local, regresión 5 discriminados | ✓ VERIFIED (a nivel unitario) | Todos los tests pasan, pero solo ejercitan `adoptSession` invocada directamente con `task_url`, no a través de ningún consumidor real |
| `src/logger-events.js` | Evento tipado `session.backstop.review` | ✓ VERIFIED | `EVENTS.SESSION_BACKSTOP_REVIEW`, helper con whitelist de 4 campos, test de contrato pasa |
| `src/hooks/session-end.js` | `runReviewBackstop` capability-gated + fail-open | ⚠️ HOLLOW (para GitHub) | El código es sustantivo y está cableado, pero el capability-gate no produce el efecto documentado (no-op) para GitHub — produce una transición destructiva no evaluada |
| `test/hooks/session-end.test.js` | Casos in_progress/no-op/capability-gate/fail-open/reviewState custom | ✓ VERIFIED (a nivel unitario) | Todos los tests pasan; ninguno reproduce el escenario real "GitHub + issue in_progress sin labels" con el `states.review` DEFAULT de `getDefaultGithubProviderConfig()` — el test de capability-gate usa un mock SIN los 3 métodos, no el provider GitHub real |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/cli.js` (`kodo adopt`) | `src/cli/adopt.js` (`runAdoptCli`) | argv → opts | WIRED | Correcto, sin relación con el gap |
| `runAdoptCli` | `adoptSession` (`src/adopt.js`) | llamada directa `:165-176` | **NOT_WIRED (para el eje task_url)** | El objeto pasado NUNCA incluye `task_url`/`task_id`/`task_ref`; el bloque `(c2)` de `adoptSession` es código muerto en producción |
| tecla `a` dashboard (`src/cli/dashboard/adopt.js`) | `kodo adopt` (subproceso) | argv literal | **NOT_WIRED (para el eje task_url)** | El argv de 8(+opcionales) elementos no incluye ningún flag de `task_url` |
| `runSessionEndHook` | `runReviewBackstop` | llamada directa `:117` | WIRED | El backstop se invoca correctamente tras los guards de idempotencia y antes de `performTerminalCleanup` |
| `runReviewBackstop` capability-gate | GitHub provider | `typeof provider.getTaskState/updateTaskState/addComment` | **WIRED pero con efecto incorrecto** | El gate pasa para GitHub (falso positivo respecto a D-13); el resultado observable es el cierre del issue, no un no-op |
| `runReviewBackstop` → `reviewState` | `config.providers[provider].states.review` | `session-end.js:225-227` | WIRED (Pitfall #1 respetado) | Mecánicamente correcto — el problema es el VALOR por defecto (`'closed'` para GitHub), no la resolución |

### Requirements Coverage

| Requirement | Plan fuente | Descripción | Status | Evidencia |
|-------------|-------------|-------------|--------|-----------|
| DELIV-01 | 71-01 | Cursor de polling avanza solo con dispatch confirmado | ✓ SATISFIED | `polling.js:315-461`, tests en verde |
| DELIV-02 | 71-01 | Centinela `observed` separa cache-ausente de primer-tick-observado | ✓ SATISFIED | `polling.js:184-187,466-476`, tests en verde |
| DELIV-03 | 71-02 | `adopt` idempotente por `task_url` | ✗ BLOCKED | Mecanismo correcto pero inalcanzable — ver gap 1 |
| DELIV-04 | 71-03 | Backstop mecánico "In Review" en SessionEnd | ✗ BLOCKED | Correcto para Plane, defecto de corrección para GitHub — ver gap 2 |

No hay requisitos huérfanos: `.planning/REQUIREMENTS.md` mapea exactamente DELIV-01..04 a Phase 71 y los 3 planes (71-01/02/03) los declaran en su frontmatter `requirements`.

### Anti-Patrones Encontrados

Ninguno bloqueante nuevo introducido por esta fase (sin `TBD`/`FIXME`/`XXX`/placeholders en los ficheros modificados). El comentario `void input;` en `session-end.js:209` es honesto sobre la ausencia de gate por `reason` (documentado también como LO-03 en `71-REVIEW.md`) — no es un anti-patrón de ocultamiento, pero sí un síntoma superficial del gap 2 (no hay ninguna señal de "trabajo completado" antes de transicionar).

### Comprobaciones de comportamiento (spot-checks)

| Comportamiento | Comando | Resultado | Status |
|---|---|---|---|
| Suite de la fase (polling + adopt + session-end) | `node --test test/adopt.test.js test/hooks/session-end.test.js test/triggers/polling.test.js` | 92 tests, 0 fallos | ✓ PASS |
| Suite completa del proyecto (regresión) | `npm test` | 1907 pass / 0 fail / 1 skip preexistente | ✓ PASS |
| Único call site de `adoptSession` en producción | `grep -rn "adoptSession(" src --include="*.js"` | 1 resultado: `src/adopt.js:206` (la definición) | ✓ CONFIRMA gap 1 (ningún segundo consumidor programático) |
| `webhook.js` sin cambios | `git diff --stat afdbad1^..HEAD -- src/triggers/webhook.js` | vacío | ✓ PASS |

### Verificación Humana Requerida

#### 1. Backstop end-to-end contra Plane real (diferido en VALIDATION.md, D6 del plan 71-03)

**Test:** Matar una sesión kodo sin `/exit` limpio del LLM (provider Plane), con la tarea aún en `in_progress`.
**Esperado:** La tarea pasa a `In review` (o el `states.review` configurado) y recibe el comentario «cierre automático»; se emite `session.backstop.review`.
**Por qué humano:** Requiere un provider Plane real y observar la transición en la UI — no automatizable en la suite unitaria (mocks). Esto NO cubre el defecto de GitHub (gap 2), que es un defecto de diseño/corrección, no solo una verificación pendiente.

## Resumen de Gaps

**DELIV-03 (gap 1) — inalcanzable end-to-end.** El código de `src/adopt.js` es correcto en aislamiento (guard `sessionId` intacto, never-throws preservado, los 5 discriminantes conservados, barrido local antes de reconciliación para evitar duplicados de fila). Pero el `Success Criterion #3` del ROADMAP («`adopt` sobre una tarea ya adoptada… no crea un duplicado») exige que un OPERADOR REAL pueda disparar esa ruta, y hoy ninguno puede: falta el flag `--task-url` en `kodo adopt` (`src/cli.js`) y su reenvío en `runAdoptCli` (`src/cli/adopt.js`). El hint devuelto en `PERSIST_FAILED` («recoverable via idempotent re-run») es hoy **falso** en la práctica — no hay ningún mecanismo de producción para ese re-run recuperable.

**DELIV-04 (gap 2) — defecto de corrección para GitHub.** El backstop funciona como se documenta para Plane, pero la premisa que sustenta el diseño (D-13: "GitHub degrada a no-op por capability-gating") es incorrecta — GitHub implementa las 3 capacidades necesarias. Combinado con el default `states.review:'closed'`, el resultado observable es que el backstop **cierra automáticamente issues de GitHub** que solo estaban `in_progress`, en cualquier `SessionEnd` "limpio" (incluidos los que NO completaron el trabajo), sin el gate de verificación explícita (`verdict.action==='pass'`) que protege la misma transición en `verify.js`. Esto es más destructivo que el "falso In Review" que D-12 asume como coste bajo: cerrar un issue de GitHub lo saca de las vistas por defecto de "open issues".

Ambos gaps fueron identificados de forma independiente por `71-REVIEW.md` (code review adversarial) y se confirman aquí contra el código real — no son hipótesis, son rutas de fallo trazadas hasta el punto de entrada real.

## Direcciones de Fix (decisión del operador, 2026-07-07)

**Estas direcciones son LOCKED para la replanificación `--gaps`. El planner de cierre de gaps DEBE seguirlas.**

**Gap 1 / DELIV-03 → Cablear la recuperación en el CLI (fix real end-to-end).**
- Añadir flags opcionales `--task-url` (y `--task-id`/`--task-ref` según haga falta para reconstruir el `reconciledTask`) al comando `kodo adopt` en `src/cli.js`.
- Reenviarlos desde `runAdoptCli` (`src/cli/adopt.js:165-176`) hacia `adoptSessionFn`, de modo que un re-run tras un `PERSIST_FAILED` (`kodo adopt … --task-url <url> --task-id <id>`) dispare el bloque `(c2)` de reconciliación en `src/adopt.js:271` y NO un segundo `createTask`. El hint «recoverable via idempotent re-run» pasa a ser verdadero.
- El guard `sessionId` existente y los 5 discriminantes NO se tocan. Test end-to-end: invocar el CLI (no `adoptSession` directo) con los flags de recuperación y verificar UN SOLO `createTask`.
- Opcional (no requerido por la decisión, pero permitido si es barato): propagar los flags también desde la tecla `a` del dashboard (`src/cli/dashboard/adopt.js`).

**Gap 2 / DELIV-04 → No cerrar nunca: gate de estado no-terminal.**
- El backstop solo debe transicionar cuando el `reviewState` resuelto NO sea un estado terminal/de cierre. Para GitHub (`states.review: 'closed'`, modelo binario open/closed) el backstop queda **no-op**; para Plane (`'In review'`, no-terminal) procede como hoy.
- Implementar un guard explícito en `runReviewBackstop` (`src/hooks/session-end.js`) que detecte si `reviewState` cierra/termina la tarea (p. ej. coincide con el estado `done`/`closed` del provider) y, en ese caso, salte sin llamar `updateTaskState`/`addComment` (emitiendo, si acaso, un evento/log de "backstop omitido por estado terminal"). Evitar acoplar a un literal `'closed'` si hay una vía provider-agnostic; si no la hay de forma barata, un check pragmático sobre el vocabulario de cierre del provider es aceptable.
- Corregir la documentación que afirma falsamente que «GitHub degrada a no-op por capability-gating» (D-13 en `71-CONTEXT.md` y la sección equivalente de `71-RESEARCH.md`): la razón real del no-op para GitHub pasa a ser el gate de estado no-terminal, no la ausencia de capacidades.
- NO se adopta la alternativa del gate `verdict.action==='pass'` (se descartó a favor del gate no-terminal).

---

_Verificado: 2026-07-07T08:40:00Z_
_Verificador: Claude (gsd-verifier)_
