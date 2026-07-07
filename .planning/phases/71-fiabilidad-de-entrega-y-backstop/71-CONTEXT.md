# Phase 71: Fiabilidad de entrega y backstop - Context

**Gathered:** 2026-07-07
**Mode:** --auto (decisiones auto-seleccionadas con la opción recomendada; auditables en `71-DISCUSSION-LOG.md`)
**Status:** Ready for planning

<domain>
## Phase Boundary

Garantizar la **entrega de dispatches** y el **cierre del ciclo de vida** de las sesiones kodo (Ola 3 de v0.16 Hardening, causas raíz **T4** «fire-and-forget donde hay obligación de entrega» y **T5** «ciclo de vida delegado al LLM sin fallback»). Cubre cuatro requisitos:

- **DELIV-01** — El cursor de polling (`maxUpdatedAt`) solo avanza sobre un issue cuando su dispatch **confirmó** (`await` + timeout); un dispatch fallido/timeout se reintenta en el siguiente tick. El **webhook sigue fire-and-forget** (Plane re-entrega — no se toca).
- **DELIV-02** — El primer tick de polling distingue **«cache ausente»** de **«primer tick ya observado»** vía un centinela explícito, sin re-disparar todo lo visto ni saltarse issues nuevos.
- **DELIV-03** — `adopt` es idempotente por `task_url`: busca por `task_url` **antes** de `createTask` para no crear un duplicado en la ventana de re-adopción/recuperación (eje **distinto** del guard `sessionId` ya existente).
- **DELIV-04** — Backstop mecánico de «In Review»: si al `SessionEnd` la tarea sigue «In Progress» y la sesión terminó limpia, el hook la transiciona a «In Review» y comenta «cierre automático». La instrucción al LLM pasa a ser **optimización, no única vía** (cambio de contrato de producto, decisión del mantenedor 2026-07-05).

**Fuera del boundary:**
- La red/auth (Fase 69, completa) y la concurrencia/lock multiproceso (Fase 70, completa).
- Higiene/DX y verdad documental (Fase 72). **Ojo de secuenciación:** HYG-04 (Fase 72) mueve `color/notify/nudge` de `Stop` a `SessionEnd` — el **mismo hook** que DELIV-04 reordena. El ROADMAP secuencia 72 **después** de 71 justo para evitar conflictos de merge sobre `session-end.js`.
- No se cambia la semántica fire-and-forget del **webhook** (solo el carril **polling**).
- No se añade un carril LLM nuevo: adopt y el backstop son **fontanería determinista 0-token** (coherente con «una fontanería, tres consumidores»).

</domain>

<decisions>
## Implementation Decisions

### DELIV-01 — Avance de cursor con dispatch confirmado (carril polling)
- **D-01:** En `processRepo` (`src/triggers/polling.js:333-387`), el dispatch del **carril polling** deja de ser fire-and-forget: se `await`ea con un **timeout** acotado. Solo se incorpora el `updated_at` de un issue a `maxUpdatedAt` cuando su dispatch **resolvió OK** (o cuando el issue **no requería dispatch** — `shouldDispatch===false`, ya visto). Un dispatch que **rechaza o excede el timeout** NO avanza el cursor sobre ese issue → se reintenta en el siguiente tick. El `.catch()` fire-and-forget actual (`:372-383`) se reemplaza por un await con captura del resultado.
- **D-02 [SUTILEZA — obligatoria para research/planner]:** el cursor es un **watermark escalar** (`last_updated_at = max(updated_at)`). Si un issue con dispatch fallido tiene un `updated_at` **menor** que otro issue posterior cuyo dispatch **sí** confirmó, avanzar el watermark al del exitoso **saltaría** al fallido en el siguiente tick (el filtro `since` lo excluiría). Por tanto la regla correcta NO es «no sumar el updated_at del fallido» a secas, sino **topar el watermark por debajo del `updated_at` mínimo de los issues fallidos del tick** (o, conservador, **no avanzar el cursor en absoluto si algún dispatch del tick falló**). El planner debe elegir entre: (a) watermark = max(updated_at de exitosos/no-dispatch) **acotado a** `< min(updated_at de fallidos)`; o (b) hold total del cursor ante cualquier fallo. **Recomendado por defecto:** opción (a) — minimiza la pérdida de progreso; verificar la semántica inclusiva/exclusiva de `since` de Plane/GitHub para el epsilon.
- **D-03:** El **timeout** de la confirmación de dispatch es un parámetro nuevo (DI/config con default sensato); su vencimiento cuenta como **no confirmado** (reintento), nunca como error fatal del tick (never-throws / warn-and-continue, coherente con `polling.dispatch.failed`). El webhook (`src/triggers/webhook.js`) **no se toca**.

### DELIV-02 — Centinela de primer tick
- **D-04:** Se introduce un **centinela explícito** en la entrada de cache por repo (`cache[key]`), p. ej. `observed: true` (o un `first_tick_done`), **desacoplado** de `last_updated_at`. Hoy `shouldDispatch` infiere «primer tick» de `!prev.last_updated_at` (`polling.js:173`), lo que **confunde** dos estados distintos: (1) **cache ausente** (nunca observamos este repo → skip-and-populate correcto, anti-storm T-25-04) y (2) **observado pero con cursor legítimamente vacío/perdido** (no debe re-disparar todo lo visto). Con el centinela, «cache ausente» ⇒ primer tick (skip + poblar cursor + marcar `observed`); «observado» ⇒ dispatch normal por `updated_at > cursor`.
- **D-05:** El centinela se persiste **aunque el primer tick no encuentre items** (hoy `cache[key]` solo se escribe en el path 200 con items; ver `:391-395`). Escribir la marca `observed` en la primera observación evita que un repo sin issues en el primer tick sea tratado como «primer tick» indefinidamente y dispare un storm cuando por fin aparezcan issues. Mantener la escritura **atómica** (`saveStateCache`, tmp+rename ya existente).
- **D-06:** Preservar los invariantes de anti-storm ya probados: el primer tick real **no dispara** (T-25-04), y el path 304 sigue **preservando cursor sin escribir** (`:310-328`). El centinela es aditivo, no reemplaza esas ramas.

### DELIV-03 — Idempotencia de adopt por `task_url`
- **D-07:** DELIV-03 cubre un **eje distinto** del guard ya existente. `adoptSession` (`src/adopt.js:245`) ya rechaza re-adopción por **`sessionId`** (`ALREADY_ADOPTED`, gap-fix 56-03). Lo que M11/DELIV-03 cierra es la ventana en la que un adopt **creó la tarea en el provider pero falló al persistir localmente** (`PERSIST_FAILED`, `:283-294`, que devuelve `task_url` con hint «recoverable via idempotent re-run») **u otra re-adopción de la MISMA tarea**: hoy un re-run llamaría a `createTask` **otra vez** → **tarea duplicada** en Plane.
- **D-08:** La fontanería añade un **lookup por `task_url` antes del `createTask`** (`:259`): si la identidad de adopción ya tiene un `task_url` conocido (recuperado del estado local `state.json` sessions+history, y/o pasado por el caller en el re-run de recuperación), se **reutiliza/reconcilia** la tarea existente en vez de crear una nueva. **Recomendado por defecto:** resolver por **estado local determinista** (0-token, coherente con la arquitectura); un lookup **provider-side** por url queda como fallback SOLO si la identidad no es recuperable localmente. El planner/researcher debe **reproducir la ventana exacta** (test: adopt que crea tarea + `PERSIST_FAILED` → re-run → verificar **un solo** `createTask`) y fijar la clave y el mecanismo del lookup.
- **D-09:** Mantener el **never-throws** y los discriminated returns de adopt (`UNSUPPORTED`/`INVALID_INPUT`/`ALREADY_ADOPTED`/`CREATE_FAILED`/`PERSIST_FAILED`). El nuevo camino idempotente devuelve un `ok:true` (reutilizado) o un discriminante nuevo si procede, sin romper los consumidores (CLI `kodo adopt`, tecla `a` del dashboard, orquestador).

### DELIV-04 — Backstop mecánico de «In Review» en `SessionEnd`
- **D-10:** El backstop vive en `runSessionEndHook` (`src/hooks/session-end.js`) — el hook que dispara **una vez** al cierre real (no en cada `Stop`). Antes del cleanup terminal destructivo (o coordinado con él), si la tarea de la sesión **sigue «In Progress»** y la sesión **terminó limpia**, el hook: (1) transiciona a «In Review» vía `provider.updateTaskState(task, reviewState)` y (2) comenta **«cierre automático»** (createComment). Reusa la fontanería de transición ya establecida en `src/gsd/verify.js:257-265` (resolver `config.providers[provider].states.review`, default `'In review'`, **Pitfall #1: bajo `providers`, NO top-level**).
- **D-11 [gating de estado — idempotencia frente al LLM]:** el backstop **solo** actúa si `getTaskState()` (capability-gated, `src/providers/plane/provider.js:251`) reporta el estado de **trigger/«In Progress»**. Si el LLM ya transicionó (la tarea ya está en «In Review»/done), el backstop **no-op**. Esto materializa «la instrucción al LLM pasa a ser optimización, no única vía»: el mecanismo es el suelo, el LLM es la ruta feliz.
- **D-12 [definición de «sesión limpia»]:** «terminó limpia» se decide por el `reason`/`end_reason` de `SessionEnd` (p. ej. `/exit` u otro cierre normal) — NO un crash/kill abrupto. **Recomendado por defecto:** tratar como limpio cualquier `SessionEnd` que **no** indique fallo explícito (fail-open hacia transicionar, porque el coste de un falso «In Review» es bajo — un humano lo revisa — frente al coste de una tarea que se queda colgada en «In Progress» para siempre, que es la causa raíz T5). El planner debe enumerar los `reason` observados de Claude Code y fijar el criterio; documentarlo.
- **D-13 [capability-gating + never-throws]:** todo el backstop es **capability-gated** por `typeof provider.getTaskState/updateTaskState/createComment === 'function'` (GitHub no implementa transición de estado igual que Plane) y **fail-open por paso** (un fallo de red al transicionar/comentar NO crashea el hook ni bloquea el cleanup terminal — se registra y sigue), coherente con el contrato never-throws de los hooks. Emitir un evento NDJSON tipado para observabilidad del cierre automático.
- **D-14 [alcance]:** aplica a sesiones **trackeadas por kodo con tarea de provider** (las que `findSession` recupera con `task_id`/`task_url`). Sesiones ad-hoc no adoptadas / la propia sesión del orquestador ya son no-op por el guard `!result` existente (`:61-64`).

### Claude's Discretion
- Valor exacto del **timeout** de confirmación de dispatch (D-03) y del backoff/reintento — mientras el vencimiento cuente como reintento, no como error fatal.
- Nombre exacto del campo centinela (`observed` vs `first_tick_done`) y su forma en `cache[key]` (D-04).
- Elección final entre watermark-acotado (a) y hold-total (b) del cursor (D-02) — con (a) como recomendado.
- Clave y mecanismo exactos del lookup por `task_url` (estado local vs provider-side) y si el retorno idempotente es `ok:true` reutilizado o un discriminante nuevo (D-08).
- Criterio preciso de «reason limpio» según los `end_reason` reales de Claude Code (D-12).
- Ubicación y estilo de los tests (`node:test`; los tests de entrega simulan dispatch que rechaza/timeout, primer tick con y sin items, re-run de adopt tras PERSIST_FAILED, y SessionEnd con tarea en «In Progress»).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auditoría (fuente de los hallazgos que esta fase cierra — A7/M10/M11/T5)
- `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md` §«Ola 3 — Fiabilidad de entrega + backstop» — plan acordado por hallazgo (A7 cursor con dispatch confirmado, M10 centinela, M11 idempotencia adopt, T5 backstop In Review) con las anclas de código; incluye la **decisión de producto del mantenedor 2026-07-05** (backstop ACEPTADO; instrucción al LLM = optimización).
- `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` — detalle original de A7/M10/M11 y de T4 (fire-and-forget con obligación de entrega) y T5 (ciclo de vida delegado al LLM sin fallback) como causas raíz.

### Requirements y roadmap
- `.planning/REQUIREMENTS.md` §«Fiabilidad de entrega y backstop (Ola 3 — causas raíz T4, T5)» — **DELIV-01..04 normativos** (líneas 34-37).
- `.planning/ROADMAP.md` §«Phase 71» (líneas 169-181) — Goal + 4 Success Criteria verificables. **Nota de secuenciación** con Fase 72 (HYG-04 reordena el mismo `SessionEnd`).
- `.planning/PROJECT.md` §«Current Milestone: v0.16 Hardening» → Ola 3 + «Key context» (decisiones del mantenedor) + «Fuera de alcance explícito».

### Fontanería reusada (referencia viva = código)
- `src/triggers/polling.js` — `processRepo` (`:275-400`), `shouldDispatch` (`:157-175`, first-tick skip `:173`), `classifyPattern` (`:188-192`), avance de `maxUpdatedAt` (`:332-342`), dispatch fire-and-forget (`:362-383`), persistencia de cursor (`:391-395`), rama 304 (`:310-328`). Ejes de DELIV-01 y DELIV-02.
- `src/triggers/webhook.js` — el carril que **conserva** fire-and-forget (contraste explícito de DELIV-01).
- `src/adopt.js` — `adoptSession` (`:196-`), guard de idempotencia por `sessionId` (`:232-248`), `createTask` (`:259`), retorno `PERSIST_FAILED` con `task_url` (`:283-294`). Eje de DELIV-03.
- `src/hooks/session-end.js` — `runSessionEndHook` (`:50-125`), guards de idempotencia (`:61-72`), cleanup terminal (`:114-121`). Sede del backstop DELIV-04.
- `src/gsd/verify.js:257-265` — patrón **ya establecido** de transición a «In review» (resolver `providers[provider].states.review`, Pitfall #1) + comment: reusar, no reinventar, en DELIV-04.
- `src/providers/plane/provider.js` — `updateTaskState` (`:203`), `getTaskState` (`:251`, capability-gated) usados por el backstop; `interface.js:52` `TASK_PROVIDER_METHODS` (contrato FROZEN-9; `updateTaskState` dentro, `createTask`/`getTaskState`/`createComment` **fuera** del 9 → gating por `typeof`).

</canonical_refs>

<code_context>
## Existing Code Insights

### Anclas verificadas (2026-07-07, código actual)
- `src/triggers/polling.js:362-383` — el dispatch del carril polling es **fire-and-forget** (`dispatchFn(...).catch(...)`, comentario «NEVER `await`»). DELIV-01 lo cambia a await+timeout **solo aquí**; el webhook queda intacto.
- `src/triggers/polling.js:332` — `let maxUpdatedAt = prev.last_updated_at || ''` y `:340-342` lo suben por **cada** issue visto, con dispatch acoplado o no → hoy el cursor avanza aunque el dispatch falle (raíz T4). Watermark **escalar** ⇒ ver D-02.
- `src/triggers/polling.js:173` — `if (!prev.last_updated_at) return false` conflaciona «cache ausente» con «cursor vacío» (raíz M10). Centinela explícito lo separa (D-04).
- `src/triggers/polling.js:391-395` — `cache[key]` solo se escribe con items en el path 200; el centinela debe persistirse también sin items (D-05).
- `src/adopt.js:245` — guard existente por `sessionId` (NO por `task_url`); DELIV-03 es un **eje adicional** para la ventana PERSIST_FAILED/re-adopción, no un reemplazo (D-07).
- `src/hooks/session-end.js` — hoy **NO transiciona estado**: solo emite `session.end` + libera lock GSD + cleanup terminal. El backstop DELIV-04 añade la transición condicional (D-10..D-14).
- Obs. `claude-mem` 25055 (2026-07-07): «Code reconnaissance for Phase 71 implementation sites» — corrobora estas anclas.

### Reusable Assets
- Patrón de transición «In review» + comment de `src/gsd/verify.js:248-265` — reusar para el backstop (misma resolución de `states.review`, mismo Pitfall #1).
- `getTaskState` (Plane, `provider.js:251`, cache 30s en el resolver de `/status`) — para el gate de estado del backstop (D-11).
- `saveStateCache` (tmp+rename atómico) del propio polling — para persistir el centinela sin nueva fontanería (D-05).
- Discriminated returns + never-throws de `adoptSession` — el camino idempotente encaja en ese contrato (D-09).

### Established Patterns
- **Carril polling ≠ carril webhook.** Webhook confía en la re-entrega de Plane (fire-and-forget legítimo); polling es la única fuente de verdad de su propio cursor ⇒ debe garantizar entrega (D-01). No unificar.
- **Capability-gating por `typeof`** para métodos fuera del contrato FROZEN-9 (`createTask`, `getTaskState`, `createComment`) — GitHub no los implementa igual que Plane; degradar, nunca asumir (D-13, D-08).
- **never-throws en hooks y en adopt** — el backstop y el lookup idempotente degradan con warn/discriminante, jamás con throw que crashee Claude Code (D-09, D-13).
- **`states.review` bajo `providers[provider]`, NO top-level** (Pitfall #1, verify.js) — replicar en el backstop.
- Suite `node:test` (1885 pass + 1 skip tras Fase 70) — seguir el patrón; los tests de entrega simulan rechazo/timeout de dispatch y estados de tarea.

### Integration Points
- `src/triggers/polling.js` (`processRepo`: await+timeout del dispatch + regla de watermark + centinela); `src/adopt.js` (`adoptSession`: lookup por `task_url` pre-`createTask`); `src/hooks/session-end.js` (backstop de transición); reuso de `src/gsd/verify.js` (transición) y `src/providers/plane/provider.js` (`getTaskState`/`updateTaskState`/comment). **Coordinar con Fase 72 HYG-04** que también editará `session-end.js` (secuenciación ya prevista en ROADMAP).

</code_context>

<specifics>
## Specific Ideas

- La propuesta de auditoría fija literalmente para Ola 3: cursor de polling **solo avanza con dispatch confirmado** (`await` + timeout; webhook sigue fire-and-forget porque Plane re-entrega); **centinela** de primer tick (distinguir cache ausente de primer tick observado); **idempotencia real en adopt** (buscar por `task_url` antes de `createTask`); **backstop mecánico** de «In Review» en `SessionEnd` (si la sesión terminó limpia y la tarea sigue «In Progress», transicionar + comentar «cierre automático»).
- Criterios de éxito verificables (ROADMAP §71): (1) `launchWorkItem` que **rechaza** → su `updated_at` NO entra en `maxUpdatedAt` y se reintenta el tick siguiente; (2) primer tick con centinela — ni re-dispara lo visto ni salta issues nuevos; (3) `adopt` sobre tarea ya adoptada (mismo `task_url`) → **sin duplicado**; (4) matar sesión sin transición del LLM → `SessionEnd` la pasa a «In Review» + comenta «cierre automático».
- Decisión de producto del mantenedor (2026-07-05): el backstop es un **cambio de contrato** — el LLM ya no es la única vía de cerrar el ciclo; su transición es optimización.

</specifics>

<deferred>
## Deferred Ideas

- **HYG-04 (mover `color/notify/nudge` de `Stop` a `SessionEnd`)** — pertenece a la **Fase 72**, aunque toca el mismo `session-end.js`. No adelantarlo aquí; el ROADMAP secuencia 72 tras 71 para evitar el conflicto de merge. Solo dejar el backstop de DELIV-04 en un punto del hook que no obstaculice ese movimiento posterior.
- `Retry-After` en 429 del cliente Plane (PLANE-F1/M7) y demás diferidos a v2 — fuera de v0.16.
- Unificar el carril webhook con la garantía de entrega del polling — **explícitamente rechazado** (webhook confía en la re-entrega de Plane); no es esta fase ni está pedido.

None fuera de lo anterior — la discusión se mantuvo dentro del scope de la Ola 3.

</deferred>

---

*Phase: 71-Fiabilidad de entrega y backstop*
*Context gathered: 2026-07-07*
