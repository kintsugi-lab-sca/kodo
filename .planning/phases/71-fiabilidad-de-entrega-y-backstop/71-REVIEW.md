---
phase: 71-fiabilidad-de-entrega-y-backstop
reviewed: 2026-07-07T08:25:01Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - src/triggers/polling.js
  - src/adopt.js
  - src/hooks/session-end.js
  - src/logger-events.js
findings:
  blocker: 2
  high: 0
  medium: 2
  low: 3
  total: 7
status: issues_found
---

# Phase 71: Code Review Report — Fiabilidad de entrega y backstop

**Reviewed:** 2026-07-07T08:25:01Z
**Depth:** deep (cross-file: `polling.js` ↔ `dispatcher.js`/`webhook.js`; `adopt.js` ↔ `cli/adopt.js`/`cli.js`/`cli/dashboard/adopt.js`; `session-end.js` ↔ `providers/plane/provider.js`/`providers/github/provider.js`/`config.js`)
**Commits reviewed:** `3976758`, `5101ff1`, `d46164b`, `f9e7f34`, `89b3cfa`, `ab2b856` (`afdbad1^..HEAD`)
**Files Reviewed:** 4 (producción; tests usados solo como contexto)
**Status:** issues_found

## Summary

El núcleo mecánico de las cuatro entregas está bien construido y, leído en aislamiento, satisface la mayoría de los invariantes normativos: el watermark de polling se acota correctamente por debajo del `min(updated_at)` de los fallidos (Pitfall #2 resuelto con la variante "retrocede a prev" documentada), el timeout de `confirmDispatch` limpia su timer en `finally` y nunca relanza, el centinela `observed` está desacoplado del cursor y es aditivo respecto al path 304, `webhook.js` queda intacto (diff vacío verificado), y el backstop de `SessionEnd` respeta el Pitfall #1 (`providers[provider].states.review`), usa `addComment` (no `createComment`), y es fail-open por paso sin bloquear `performTerminalCleanup`.

Sin embargo, la revisión cross-file encontró **dos defectos que invalidan el resultado end-to-end de dos de los cuatro entregables**, aunque el código nuevo en sí mismo (mirado archivo por archivo) es internamente correcto:

1. **DELIV-03 es inalcanzable en producción** — el mecanismo de idempotencia por `task_url` en `adopt.js` solo se activa si el *caller* pasa `task_url`, pero ninguno de los tres consumidores reales (`kodo adopt` CLI, tecla `a` del dashboard, orquestador) fue tocado para exponer/reenviar ese dato. Un operador real que sufre un `PERSIST_FAILED` no tiene forma de disparar la reconciliación.
2. **DELIV-04 puede cerrar issues de GitHub en vez de "mandarlos a revisión"** — la premisa documentada en 71-CONTEXT.md/71-RESEARCH.md ("GitHub no implementa transición de estado igual que Plane" → gate degrada a no-op) es empíricamente falsa: GitHub SÍ implementa `getTaskState`/`updateTaskState`/`addComment`. Combinado con el default `states.review: 'closed'` de GitHub, el backstop mecánico ahora cierra automáticamente issues de GitHub que solo estaban `in_progress`, en cualquier `SessionEnd` limpio — sin el gate `verdict.action === 'pass'` que protegía este mismo camino en `verify.js`.

Los cuatro archivos del diff son consistentes con las convenciones existentes (never-throws, discriminated returns, capability-gating por `typeof`, whitelist explícito en los helpers NDJSON). El resto de hallazgos son de severidad menor (pérdida de detalle forense, ausencia de timeout defensivo en el backstop, un campo de log potencialmente engañoso).

## Blocker Issues

### BL-01: DELIV-03 — la ruta de idempotencia por `task_url` es inalcanzable desde cualquier consumidor real

**Archivos:** `src/adopt.js:262-307` (mecanismo, correcto en aislamiento); `src/cli/adopt.js:96-213` (no reenvía `task_url`); `src/cli.js:274-305` (sin flag `--task-url`); `src/cli/dashboard/adopt.js` (argv sin `task_url`)

**Fallo concreto (input → salida errónea):** `adoptSession` solo entra en el bloque `(c2)` — barrido local `(c2.a)` o reconciliación `(c2.b)` — cuando `args.task_url` es un string no vacío (`src/adopt.js:271`). Ese argumento no existe en ningún punto de entrada real:

- `src/cli.js:274-305` (`kodo adopt`) no declara `--task-url` ni ningún flag equivalente.
- `runAdoptCli` (`src/cli/adopt.js:165-176`) construye el objeto que pasa a `adoptSessionFn` con `provider, providerName, workspaceRef, cwd, sessionId, projectId, projectPath, title, description, module` — **sin `task_url`/`task_id`/`task_ref`**, aunque `opts` los tuviera.
- `src/cli/dashboard/adopt.js` (tecla `a`) construye el `argv` de `kodo adopt` sin ningún flag de `task_url`.
- Búsqueda exhaustiva (`grep -rn "adoptSessionFn(\|await adoptSession(\|task_url\|task-url"` sobre `src/cli*`, `src/orchestrator/`) confirma que `adoptSession` tiene **un único call site** en todo el árbol (`src/cli/adopt.js:165`) y que ningún caller conoce/propaga `task_url`.

Consecuencia real: cuando `adoptSession` devuelve `PERSIST_FAILED{task_url, hint:'recoverable via idempotent re-run'}` (`:345-355`), el CLI lo imprime a stderr (`src/cli/adopt.js:333-340`) pero el operador **no tiene ningún flag para reintroducir ese `task_url`** en un re-run. La única acción disponible — volver a correr `kodo adopt --workspace ... --cwd ... --session-id ... --project ...` con los mismos argumentos — cae de nuevo en la rama `(d) createTask` (`:309-332`, sin `task_url` no se entra en el bloque `(c2)`), **creando una segunda tarea en Plane**. Esto es exactamente el bug M11 que DELIV-03 dice cerrar.

El barrido local `(c2.a)` tiene el mismo problema: solo se ejecuta si `task_url` ya viene en `args` (`:271`), pero la re-adopción típica (nueva `sessionId`, mismo `cwd`/tarea) no conoce de antemano el `task_url` a comparar — por diseño, nadie se lo pasa.

**Verificación:** Criterio de éxito 3 del ROADMAP §71 ("adopt sobre una tarea ya adoptada... no crea un duplicado") **no se cumple end-to-end**; solo se cumple si se invoca `adoptSession()` programáticamente con `task_url`, cosa que ningún código de producción hace hoy.

**Fix:** Añadir `--task-url`/`--task-id` (opcionales) al comando `kodo adopt` (`src/cli.js`), reenviarlos en `runAdoptCli` hacia `adoptSessionFn`, y — si se quiere que el barrido local sea útil sin que el operador conozca el `task_url` de antemano — resolverlo también a partir de una identidad recuperable localmente (p. ej. buscar por `workspaceRef`/`cwd` en `history` antes de intentar `createTask`), tal como sugiere D-08 ("recuperado del estado local... y/o pasado por el caller"). Alternativamente, si el mecanismo debe operar SOLO vía recuperación explícita, exponer el flag es el mínimo indispensable para que el hint `'recoverable via idempotent re-run'` sea verdad.

---

### BL-02: DELIV-04 — el backstop puede cerrar issues de GitHub que no están terminadas, sin el gate de "verdict pass" que protege el mismo camino en `verify.js`

**Archivos:** `src/hooks/session-end.js:180-235` (backstop); `src/providers/github/provider.js:129-142,178-181` (GitHub SÍ implementa las 3 capacidades); `src/config.js:327-335` (`states.review: 'closed'` por defecto en GitHub)

**Fallo concreto (input → salida errónea):**

1. `71-CONTEXT.md`/`71-RESEARCH.md` asumen explícitamente: *"GitHub no implementa transición de estado igual que Plane... el provider degrada a no-op"* (Pattern 2, D-13). Esto es **falso**: `src/providers/github/provider.js` implementa `getTaskState` (`:178`), `updateTaskState` (`:129`) y `addComment` (`:145`) — las tres funciones que el gate de `runReviewBackstop` (`session-end.js:183-190`) comprueba con `typeof`. El gate **pasa** para GitHub; el backstop NO es no-op ahí.
2. Para un issue de GitHub abierto sin labels `review`/`block`, `getTaskState` (`provider.js:178-181` → `mapGithubLabels`) devuelve `'in_progress'` por defecto (`:112`) — el mismo valor que gatilla la transición (`session-end.js:221`).
3. El `reviewState` resuelto (`session-end.js:225-227`) para GitHub, con la config por defecto (`getDefaultGithubProviderConfig`, `config.js:327-335`), es literalmente **`'closed'`**.
4. `provider.updateTaskState(task, 'closed')` en GitHub (`provider.js:129-142`) trata `'closed'` como uno de los DOS estados nativos hardcodeados (`stateName !== 'open' && stateName !== 'closed'`) y hace `client.updateIssue(owner, repo, number, { state: 'closed' })` **directamente** — sin ningún chequeo adicional. Esto **cierra el issue de GitHub**, no lo "manda a revisión": GitHub no tiene una columna de revisión nativa, así que la única señal disponible es cerrar.

El mismo camino de transición existe hoy en `src/gsd/verify.js:256-265`, pero ahí está protegido por `if (verdict.action === 'pass' && commented)` (`:257`) — solo se ejecuta tras una verificación explícita del LLM que determinó que la fase pasa. El backstop de DELIV-04 **no tiene ese gate**: transiciona ante *cualquier* `SessionEnd` "limpio" (D-12, fail-open — ningún `reason` conocido cuenta como fallo) mientras la tarea siga `in_progress`, sin importar si el trabajo se completó, se interrumpió por agotamiento de contexto, o el humano simplemente cerró la terminal a mitad de tarea.

**Impacto real:** cualquier sesión kodo sobre un repo GitHub que termine "limpia" (la mayoría de los `/exit`, incluidos los que NO completaron el trabajo) con el issue todavía `in_progress` hará que el issue se **cierre automáticamente** y reciba un comentario "cierre automático" — hoy sin que el mantenedor lo haya decidido explícitamente. El coste asumido en D-12 ("el coste de un falso In Review es bajo — un humano lo revisa") no es válido para GitHub: cerrar un issue lo saca de las vistas de "open issues", notificaciones y dashboards por defecto — es una acción mucho más destructiva/oculta que mover una tarjeta a una columna de revisión en Plane.

**Fix:** Al menos una de:
- Excluir explícitamente a GitHub del backstop (o de la resolución de `reviewState` cuando coincide con un estado terminal nativo `'closed'`), dado que su modelo binario open/closed no tiene un análogo seguro a "In Review".
- Añadir el mismo gate que `verify.js` usa (`verdict.action === 'pass'`) o un criterio equivalente que exija evidencia de trabajo completado antes de transicionar, en vez de fiarse solo de "la sesión no crasheó".
- Como mínimo, corregir la documentación (`71-CONTEXT.md`/`71-RESEARCH.md`) que afirma incorrectamente que GitHub degrada a no-op, y decidir conscientemente si cerrar issues de GitHub automáticamente es el comportamiento deseado — actualmente parece un efecto secundario no evaluado, no una decisión de producto.

## Medium Issues

### MD-01: `confirmDispatch` descarta el motivo real del fallo antes de que llegue al log

**Archivo:** `src/triggers/polling.js:315-329` (definición), `:436-447` (call site)

**Fallo concreto:** `confirmDispatch` captura cualquier rechazo o timeout con `catch { return { ok: false }; }` — el objeto de error (`err.message`, incluida la causa real: timeout vs. excepción real de `dispatchTrigger`) se descarta por completo. El call site solo puede emitir `pollingError(logger, { ..., error: 'dispatch-unconfirmed' })` (`:439-446`), un literal fijo idéntico para CUALQUIER causa de fallo. El código previo (fire-and-forget, ver diff) sí propagaba `err.message` al log (`polling.dispatch.failed`). Esto es una regresión de observabilidad: un operador ya no puede distinguir en el NDJSON si un issue se reintentará por un timeout de red transitorio o por un bug real en `dispatchTrigger` (p. ej. un `throw` de `resolvePhaseFn`), lo cual dificulta el diagnóstico exactamente del escenario que esta fase pretende hacer más observable.

**Fix:** Propagar al menos un snippet truncado del motivo (`err instanceof Error ? err.message : 'timeout'`) hasta `pollingError`, o distinguir explícitamente el caso timeout (`error.message === 'dispatch-timeout'`) del caso rechazo real en el campo `error`.

### MD-02: El backstop de `SessionEnd` no tiene timeout propio en sus 3 llamadas de red

**Archivo:** `src/hooks/session-end.js:214-243`

**Fallo concreto:** A diferencia de `confirmDispatch` (DELIV-01), que envuelve explícitamente el dispatch en `Promise.race` con un timeout mockeable basado en `clock.setTimeout` (mitigación explícita del Pitfall #4: "un dispatch colgado congelaría el loop"), `runReviewBackstop` llama `provider.getTaskState(task)`, `provider.updateTaskState(task, reviewState)` y `provider.addComment(task, ...)` con `await` directo, sin ningún timeout a nivel de call site. Hoy esto está acotado indirectamente porque `PlaneClient.request()` usa `AbortSignal.timeout(10_000)` internamente (`client.js:53`) con hasta 3 reintentos en 429 (backoff hasta 8s + posible espera proactiva de hasta 65s, `client.js:36-42,61-67`) — es decir, el hook puede tardar decenas de segundos en el peor caso, pero no cuelga indefinidamente. Sin embargo, esto depende de un detalle de implementación del cliente Plane, no de un contrato exigido por `interface.js`; un futuro provider (o una implementación de GitHub sin timeout propio) podría colgar el hook — y por extensión, retrasar indefinidamente `performTerminalCleanup` — sin la defensa explícita que el resto de la fase sí aplicó a `confirmDispatch`.

**Fix:** Envolver las tres llamadas con el mismo patrón `Promise.race` + timeout ya usado en `confirmDispatch`, o al menos documentar explícitamente que el contrato depende del timeout interno del provider (y añadir un guard de timeout genérico independiente del provider concreto).

## Low Issues

### LO-01: `classifyPattern` sigue usando la heurística pre-DELIV-02 (`!prev.last_updated_at`) para el campo forense `pattern`

**Archivo:** `src/triggers/polling.js:189-206` (sin cambios en este diff, pero ahora inconsistente con `shouldDispatch`)

**Descripción:** `shouldDispatch` migró a `prev.observed !== true` (D-04) para decidir first-tick, pero `classifyPattern` — que solo alimenta el campo `pattern` de `pollingDispatch` (forense, "NOT a contract" según su propio docstring) — sigue usando `!prev.last_updated_at`. En el caso "primer tick sin items, cursor queda vacío pero `observed:true`" (Ejemplo 3 de 71-RESEARCH.md), el SEGUNDO tick real (que sí dispara, porque `shouldDispatch` ve `observed===true`) sería etiquetado por `classifyPattern` como `'first-tick'` aunque no lo es. No afecta ninguna decisión de dispatch/cursor — solo el valor de un campo de log.

**Fix:** Alinear `classifyPattern` para usar `prev.observed !== true` igual que `shouldDispatch`, o documentar explícitamente por qué diverge.

### LO-02: `isFirstTick`/`first_tick:true` en el NDJSON se basa en un `Set` en memoria, no en el centinela persistido

**Archivo:** `src/triggers/polling.js:576-577,602,623`

**Descripción:** `firstTickPerRepo` es un `Set` en memoria del proceso del daemon, reseteado en cada reinicio. Tras un restart, el primer tick del proceso para un repo YA `observed:true` en disco emitirá `first_tick:true` en `polling.tick`/`polling.tick.summary`, aunque `shouldDispatch` (que sí lee el centinela persistido) actúe como tick normal. Es un campo puramente forense (no gating), pero puede confundir a un operador leyendo logs tras un reinicio del daemon.

**Fix:** Derivar `first_tick` de `prev.observed !== true` (el mismo criterio que `shouldDispatch`) en vez de un Set efímero por proceso.

### LO-03: `runReviewBackstop` acepta `input` pero no implementa ningún chequeo de `reason`

**Archivo:** `src/hooks/session-end.js:172-209`

**Descripción:** La firma y el comentario (`:203-209`) documentan extensamente el criterio "sesión limpia" basado en `input.reason` como "enum cerrado", pero el código real hace `void input;` y nunca lee `input.reason` — el comportamiento es fail-open incondicional, coherente con D-12, pero el parámetro/JSDoc dan la impresión de un gate real que no existe hoy. No es un bug (coincide con la decisión documentada), pero es una fuente previsible de confusión para el próximo mantenedor que asuma que cambiar `input.reason` en el JSON de entrada tiene algún efecto.

**Fix:** Simplificar el JSDoc/comentario para dejar explícito que hoy NO hay gate por `reason` (es 100% fail-open), o implementar el chequeo mínimo que el comentario describe.

## Invariantes verificados como correctos (para que quede constancia — no re-abrir)

- **Watermark acotado (Pitfall #2):** confirmado con trazas manuales de casos límite (fallo antes/después, empate de timestamps, solo-fallos, solo-éxitos) en `src/triggers/polling.js:450-461`. Usa la variante "retrocede a `prev` si el máximo cruza/iguala el mínimo fallido" — más conservadora que el óptimo teórico, pero explícitamente aceptada como tal en 71-RESEARCH.md (Open Question #2) y correcta (nunca entierra a un fallido).
- **`confirmDispatch` timeout:** limpia el timer en `finally` (`:326-328`) en ambas ramas (resuelve/rechaza), nunca relanza, usa `clock.setTimeout` (mockeable), no `globalThis.setTimeout`.
- **`webhook.js`:** diff vacío verificado con `git diff afdbad1^..HEAD -- src/triggers/webhook.js` — sigue fire-and-forget, sin cambios.
- **Anti-storm/304:** el path 304 no toca `cache[key]` (`:356-374`); el centinela se escribe siempre en el path 200 con o sin items (`:471-476`); una entrada legacy sin `observed` cae en "no observado" (comportamiento seguro).
- **T-25-02 (call site del dispatch):** `pollingDispatch` solo recibe `{owner, repo, ref, pattern}` (`:408-415`); el objeto pasado a `dispatchFn` (`{taskRef, action, provider, raw}`, `:421-430`) es interno al proceso, nunca al NDJSON.
- **DELIV-03 (mecánica interna, aislada de la cuestión de alcanzabilidad de BL-01):** el guard `sessionId` (`:257-260`) queda intacto y se evalúa ANTES del bloque `task_url`; el barrido local (`:280-285`) precede a la reconciliación (`:287-306`) de modo que una fila ya persistida gana `ALREADY_ADOPTED` en vez de `reused:true`; ningún camino invoca `createTask` dos veces DADA la misma llamada con `task_url` fijo; `task_url` nunca se enruta por `sanitizeAdoptionData`; los 5 discriminantes preexistentes y el never-throws quedan intactos.
- **DELIV-04 (capability-gating y Pitfall #1):** guard `!provider` primero (`:183-190`, el `typeof` no puede lanzar); `states.review` resuelto bajo `providerCfg.states.review` (`:226-227`), nunca top-level; método `addComment` (no `createComment`, `:240`); cada paso de red en su propio try/catch fail-open (`:215-220,230-235,239-243`) — un `throw` en cualquiera de los tres NO impide `performTerminalCleanup` (verificado: el bloque completo está envuelto en un try/catch adicional en `runSessionEndHook:95-120`, y el cleanup terminal se invoca incondicionalmente después, `:150-156`); el backstop está insertado tras los guards de idempotencia y antes de `performTerminalCleanup`, sin entrelazarse con el evento `session.end` ni el lock release (deja sitio a HYG-04/Fase 72 según Pitfall #7).
- **Evento NDJSON `session.backstop.review`:** whitelist explícito de 4 campos (`session_id, task_id, from, to`), sin spread, en `src/logger-events.js:825-833` — no hay fuga de contenido de usuario.

---

_Reviewed: 2026-07-07T08:25:01Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
