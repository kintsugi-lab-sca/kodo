# Phase 74: Handoff acumulativo al cierre - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Al cerrar una sesión, la tarea deja **estado vivo** en dos sitios: su fichero de plan
(`~/.kodo/plans/<task_id>.md`) gana un bloque `## Handoff <fecha>` que se **acumula** sesión tras
sesión (nunca se pisa), y `state.json` guarda el **puntero al plan + el `NEXT:` de una línea**.

Esta fase es el **productor** de todo el milestone v0.17: escribe el dato. Las Phases 75 (dashboard +
nudge) y 76 (conteo `pending`) no entran aquí.

**Dentro:** el hook `SessionEnd` (escritura del bloque, backstop mecánico, persistencia en
`state.json`), la inversión de la instrucción «sobrescribe si ya existe» en `SessionStart`, y el
**contrato de formato** parseable que consumirá la Phase 75.

**Fuera:** pintar el handoff en el dashboard o usarlo en el nudge (Phase 75), poda/cap de bloques
antiguos, handoff en sesiones muertas por SIGKILL, edición del handoff desde la TUI, endpoint nuevo.

</domain>

<decisions>
## Implementation Decisions

### Contrato del bloque de handoff

- **D-01: Formato del bloque** — heading humano + marcador HTML en la misma línea:

  ```markdown
  ## Handoff 2026-07-15 11:32 <!-- kodo:handoff v=1 session=<session_id> author=llm at=<ISO-8601> -->

  **Hecho:** …
  **Pendiente:** …
  **NEXT:** …
  ```

  El heading lleva fecha-hora **local** (`YYYY-MM-DD HH:MM`) porque lo lee un humano. El marcador HTML
  carga los metadatos que el hook necesita: `v=1` (versión del contrato, permite evolucionarlo sin
  romper ficheros viejos), `session=<session_id>` (UUID completo), `author=llm|auto`, `at=<ISO-8601 UTC>`.
  Rechazado: heading pelado sin marcador — no permite saber **de qué sesión** es un bloque, que es
  justo lo que rompe LIVE-03 en cuanto hay acumulación (ver D-04).

  > **Corrección post-research (2026-07-15).** Este bloque afirmaba que el marcador es «invisible al
  > renderizar». **Hoy no lo es**: `readLightPlan` (`plan.js:72`) hace `md.split('\n')` — render
  > plano línea a línea, sin markdown. Hasta que la Phase 75 renderice markdown de verdad (LIVE-06),
  > el marcador se verá **crudo** en el overlay. La decisión NO cambia: el marcador es la única vía
  > fiable para LIVE-03 (D-04), y el ruido es cosmético y temporal. Pero la Phase 75 debe saber que
  > su renderizador es lo que hace cierta la promesa de invisibilidad.

- **D-02: Extracción y truncado del `NEXT`** — dentro de un bloque, la **primera** línea que empieza por
  `**NEXT:**`; el valor es el resto de la línea, trimmed. Una sola línea (precedente D-07 Phase 45).
  Ausente → sin `NEXT:` (caso válido y esperado del bloque mecánico). Al persistir en `state.json` se
  **trunca a 200 caracteres**: evita que una línea desbocada del LLM engorde `state.json`, que la
  Phase 75 tendrá que pintar en una celda de tabla.

- **D-03: Bloque mecánico (LIVE-03)** — visualmente distinguible **sin** depender del marcador
  (que es invisible al renderizar): heading `## Handoff <fecha> — automático` + `author=auto`.
  Contenido determinista, **sin red y sin LLM**: `**Hecho:** Sesión cerrada (motivo: <reason>,
  estado: <session.status>)` y `**Pendiente:** Sin handoff del LLM — revisar la tarea manualmente`.
  **Sin `NEXT:`** (así lo pide LIVE-03). `input.reason` se trata como **enum CERRADO** y se valida
  contra `{clear, logout, prompt_input_exit, bypass_permissions_disabled, other}` antes de
  interpolarlo en el markdown; un valor desconocido colapsa a `other` (misma disciplina que T-71-12).

- **D-04: Detección de autoría** — el hook lee el plan y busca un marcador `kodo:handoff` con
  `session=<session_id>` **de esta sesión**. Presente → el LLM ya escribió, no se appendea nada.
  Ausente → append del bloque mecánico. **Scoped por `session_id`, jamás por conteo de bloques**: con
  acumulación (LIVE-02), la segunda sesión vería el bloque de la primera y concluiría en falso que el
  LLM ya escribió — precisamente el fallo que LIVE-03 existe para evitar.

- **D-13: Un solo módulo dueño del contrato** — writer y parser viven juntos en un módulo nuevo
  (`src/session/handoff.js` o equivalente), con funciones **puras** (construir bloque, detectar
  marcador de sesión, extraer `NEXT:`). La Phase 75 necesita parsear lo mismo que la 74 escribe; dos
  implementaciones del formato divergirían. El hook queda como I/O + orquestación.

### Persistencia en `state.json` (LIVE-04)

- **D-05: Clave top-level `tasks`, no el registro de sesión** — `state.tasks[task_id] =
  { plan_path, next, updated_at }`, **aditivo opcional y SIN bump de `schema_version`** (precedente
  exacto: `history` en Phase 30 y `worktree_path` en Phase 18 D-03c; lectura defensiva
  `state.tasks || {}`).
  Razón dura: `performTerminalCleanup` llama a `removeSession`, que **archiva la sesión a `history`
  (cap FIFO de 50) y borra la fila de `state.sessions`**. Un `NEXT:` guardado en el registro de sesión
  desaparecería de la lista al cerrar y sería desalojable a los 50 cierres — y el dato es de la
  **tarea**, no de la sesión: su valor es sobrevivir a la sesión que lo produjo para que la
  **siguiente** sesión de esa misma tarea lo encuentre.

  > **Corrección post-research (2026-07-15).** Este bloque afirmaba que «la Phase 75 lo lee por
  > `task_id` sin endpoint nuevo porque `/status` ya sirve `state.json`». **Falso**: `server.js:589`
  > sirve `listSessions()`, es decir `Object.values(loadState().sessions)` — **no** el fichero entero,
  > así que `state.tasks` NO saldría hoy por `/status`. La decisión D-05 **no cambia** (se sostiene
  > entera sobre la razón dura de `removeSession`), pero **la Phase 75 hereda un punto de decisión
  > real**: cómo llega `state.tasks` a la TUI. Hay salidas con precedente y ninguna necesita endpoint
  > nuevo — anotado como Open Question para el discuss de la 75, NO resuelto aquí.
  >
  > Evidencia de seguridad del aditivo (lo que sí verificó el research): `reconcile.js:238` y `:396`
  > reconstruyen el estado con spread (`{...state, sessions, history}`), así que **preservan claves
  > top-level desconocidas**; y `migrateStateV2toV3` (`state.js:139-143`), que sí las descartaría,
  > es inalcanzable desde el carril del hook por el early-return de idempotencia (`:122`).

- **D-06: Escritura bajo `withStateLock`** — el hook es un escritor más (invariante v0.16 Phase 70).
  El mutator toca **solo** `state.tasks`, nunca `alive` (D-04: `reconcileTick` sigue siendo su único
  escritor). Lock-timeout devuelve `{ok:false}` → `log.warn` y seguir: **jamás** bloquea el cierre.

### Punto de escritura y concurrencia

- **D-07: Bloque autónomo tras el logger, ANTES de `runReviewBackstop`** — en `runSessionEndHook`,
  en `session-end.js:97` y antes del backstop (`:104`), con **try/catch propio** además del outer
  never-throws.

  > **Corrección post-research (2026-07-15).** Este bloque decía «tras los guards (`:72-83`)». El
  > punto exacto es **`:97`, tras la construcción del `log` (`:88-96`)**, porque el bloque necesita
  > ese logger para el `log.warn` del lock-timeout (D-06). Sigue estando después de los guards y
  > antes del backstop, así que el razonamiento de abajo se mantiene intacto.
  Razón: el handoff es una escritura a **disco** (barata, sin red) y es el dato más valioso de la
  fase; si el backstop se atasca en red, el handoff ya aterrizó. **No altera el orden relativo LOCKED
  `backstop → setColor → notify`** (D-08 de v0.16 Phase 71) — inserta antes del trío, no lo reordena.
  Y queda muy por delante del cleanup destructivo, como exige LIVE-01.

- **D-08: Read-modify-write del plan bajo `withFileLock`** — se reutiliza la primitiva ya existente
  `withFileLock(lockPath, fn)` de `src/session/state-lock.js` sobre `<plan>.lock` (es un **import**:
  cero dependencias npm nuevas). Un `temp+rename` atómico por sí solo **no** evita el *lost update* de
  un leer→appendear→escribir: dos cierres simultáneos de la misma tarea perderían un bloque, que es
  exactamente el dato que este milestone construye. La escritura final sigue siendo temp+rename
  atómico (PERSIST).

### Cobertura y autoría

- **D-09: Create-if-missing — el handoff es universal** — si `~/.kodo/plans/<task_id>.md` no existe,
  el hook **crea** el fichero con una cabecera mínima (`# <task_ref> — <summary>`) y appendea el
  bloque. No es opcional: las ramas GSD **full** y **bootstrap** de `buildGsdContext` no reciben
  instrucción de escribir plan ligero (solo la no-GSD `:85` y la GSD quick `:145`), así que sin esto
  no tendrían fichero al que appendear. El invariante de STATE.md es explícito: *«el handoff se
  escribe en disco para TODA sesión»*; **D-02 solo prohíbe pintarlo en el overlay GSD, no escribirlo**.

- **D-10: Invertir las DOS ramas productoras, no solo la 85** — `session-start.js:85` (no-GSD, ES,
  «sobrescribe si ya existe») y `session-start.js:145` (GSD quick, EN, «overwrite if it exists») son
  **el mismo bug**; LIVE-02 nombra solo la 85 porque es donde se detectó. Ambas pasan a
  preservar-y-appendear y ambas ganan la instrucción de escribir el bloque de handoff al cierre con el
  formato de D-01. Las ramas GSD full/bootstrap **no** reciben instrucción — las cubre el backstop
  mecánico (D-03), y esas sesiones ya tienen continuidad propia vía GSD.

- **D-11: cobertura de tests de las instrucciones — re-alcanzada tras el research** — la premisa
  original («tocar 85/145 rompe los golden bytes de HOOK-02, hay que repararlos») resultó **falsa**:
  el grep exhaustivo del researcher encontró **cero** tests que asserten los literales «sobrescribe si
  ya existe» / «overwrite if it exists» — las asserts reales son de prefijo, ruta resuelta y orden, así
  que conservando el prefijo **no se rompe ningún test existente**.

  Lo que sí es real y la premisa original no veía: **`test/session-start.test.js:174-190`** (HOOK-01
  D-02b) toma el slice desde `lastIndexOf('## Anti-push-fantasma')` **hasta el final del string** y
  prohíbe emojis y secuencias ANSI. La instrucción de plan de `:85` ya cae dentro de ese slice, y la
  instrucción de handoff nueva también caerá. **La instrucción nueva debe ser markdown plano, sin
  emojis.** El planner mantiene la tarea explícita, pero su objeto cambia: **añadir** tests de la
  semántica nueva (preservar-y-appendear) y respetar el slice sin-emojis — no reparar golden bytes.

### Alcance

- **D-12: Sin poda ni cap de bloques** — acumular sin límite en v0.17 (Out of Scope ya decidido el
  2026-07-15: una tarea típica vive 1-3 sesiones; podar ahora es especulativo). Precedente «medir
  antes de arreglar» (M21). Revisitar en v0.18 con datos reales de crecimiento.

### Claude's Discretion

- Nombre y ubicación exactos del módulo del contrato (D-13) y de sus funciones.
- Estructura de los tests (fixtures de plan, aislamiento de `HOME` — precedente `kodoPlansDir`/
  `homedirFn` de `plan.js` D-08).
- Formato interno exacto de `Hecho`/`Pendiente` (bullets vs prosa) más allá de que `NEXT:` sea una
  única línea.
- Si `plan_path` se persiste absoluto o derivado — mientras la Phase 75 pueda resolverlo sin
  reconstruir la convención a mano.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contrato de la fase
- `.planning/REQUIREMENTS.md` — LIVE-01..04, la tabla de **Constraints** (invariantes que aplican a
  todo el milestone) y la tabla de **Out of Scope** (poda, SIGKILL, overlay GSD, edición TUI, endpoint)
- `.planning/ROADMAP.md` §Phase 74 — goal + los 5 success criteria que verifica `/gsd-verify-work`
- `.planning/STATE.md` §Critical Invariants to Preserve — invariantes cross-milestone vivos

### Punto de intervención (productor)
- `src/hooks/session-end.js` — `runSessionEndHook`; guards de idempotencia `:72-83`, `runReviewBackstop`
  `:104` (orden LOCKED D-08), `performTerminalCleanup` `:159`. Aquí entra el bloque de D-07
- `src/hooks/terminal-cleanup.js` — el cleanup destructivo: worktree → `removePromptFile` →
  `removeSession` (archiva a `history`, borra de `sessions`). El handoff va **antes** de todo esto
- `src/hooks/session-start.js:85` (no-GSD, ES) y `:145` (GSD quick, EN) — las dos instrucciones
  «sobrescribe si ya existe» que invierte D-10; ojo a los golden bytes HOOK-02 (D-11)

### Estado y primitivas reutilizables
- `src/session/state.js` — `withStateLock` `:317`, typedef `Session` `:24-49`, `removeSession` `:355`
  (FIFO 50 de `history`), precedente de campo aditivo sin bump (`worktree_path` `:41`, `history` `:54`)
- `src/session/state-lock.js:215` — `withFileLock(lockPath, fn)`, la primitiva genérica que reusa D-08

### Consumidor aguas abajo (no tocar en esta fase, pero el formato debe servirle)
- `src/cli/dashboard/plan.js:65` — `readLightPlan`: lee `~/.kodo/plans/<taskId>.md` y lo renderiza
  plano. Es el consumidor que la Phase 75 extenderá; el marcador HTML de D-01 no debe ensuciar ese render

### Precedentes de diseño
- `.planning/milestones/v0.16-phases/71-fiabilidad-de-entrega-y-backstop/` — el patrón
  **LLM + backstop mecánico** (D-10..D-14) que esta fase replica para el handoff
- `.planning/milestones/v0.16-phases/70-concurrencia-y-ciclo-de-vida-de-procesos/` — advisory locks
  sobre `state.json`; por qué todo escritor pasa por `withStateLock`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`withFileLock(lockPath, fn)`** (`src/session/state-lock.js:215`) — primitiva genérica de advisory
  lock; se aplica tal cual al fichero de plan (D-08) sin tocarla ni añadir dependencias.
- **`withStateLock(mutator)`** (`src/session/state.js:317`) — carga fresca **dentro** del lock; el
  patrón anti-clobber ya resuelto. El hook lo consume como un escritor más (D-06).
- **`saveState`** (`:266`) — temp+rename con nombre único por escritor (pid+UUID); el patrón de
  escritura no-corruptiva a copiar para el fichero de plan.
- **Patrón DI de los hooks** — `runSessionEndHook(input, deps)` inyecta `findSessionFn`,
  `removeSessionFn`, `loggerFactory`, `cmux`. El handoff debe seguirlo (inyectar fs/reloj) para ser
  testeable sin tocar `~/.kodo` real.
- **Aislamiento de `HOME` en tests** — `kodoPlansDir`/`homedirFn` de `plan.js` (D-08 Phase 46).

### Established Patterns
- **Hooks never-throw** — cuerpo entero en try/catch + try/catch por efecto. Un handoff que falla
  (plan ilegible, lock ocupado, formato raro) loguea y sigue; nunca crashea Claude Code ni bloquea el
  cierre (success criterion 5).
- **Fail-open por paso** — precedente literal del backstop `:104-129`: su propio try/catch además del
  outer, para que un fallo suyo jamás impida el cleanup.
- **Aditivo sin bump de schema** — `history` (Phase 30) y `worktree_path` (Phase 18) se añadieron con
  lectura defensiva y sin tocar `schema_version`. D-05 sigue ese carril.
- **Enum cerrado para `input.reason`** — nunca interpolado en comandos ni rutas (T-71-12); D-03 lo
  extiende a «tampoco en markdown sin validar».
- **LOG-12** — `state.js` solo importa `logger-noop`; el logger real se inyecta desde el caller.

### Integration Points
- **`runSessionEndHook`** (`session-end.js:58`) — único punto de entrada donde el handoff se engancha.
- **`state.tasks`** — clave nueva en `state.json`; `/status` ya sirve ese fichero, así que la Phase 75
  la consume sin endpoint nuevo (invariante «cero endpoints nuevos desde v0.10»).
- **`buildSessionContext` / `buildGsdContext`** (`session-start.js:25` / `:102`) — las dos ramas cuya
  instrucción se invierte (D-10). Funciones puras: se testean por golden bytes.

### Creative Options (habilitadas / cerradas por la arquitectura)
- **Habilitada:** el marcador HTML invisible da un canal de metadatos sin ensuciar el render de
  LIVE-06 — no hace falta un fichero sidecar ni un índice paralelo.
- **Cerrada:** guardar el `NEXT:` en el registro de sesión. `removeSession` lo archivaría a `history`
  (FIFO 50) y la fila desaparecería del dashboard al cerrar — el dato tiene que sobrevivir a su sesión.
- **Cerrada:** detectar el handoff del LLM contando bloques o por mtime del fichero — la acumulación
  de LIVE-02 lo rompe. Solo el marcador scoped por `session_id` es fiable.

</code_context>

<specifics>
## Specific Ideas

- El operador ya tiene una expectativa concreta y explícita en STATE.md: *«el handoff se escribe en
  disco para TODA sesión, pero no se pinta en el overlay GSD»*. D-09 y D-02 son las dos mitades de esa
  frase — cumplirla es criterio de aceptación, no interpretación.
- El hueco que motivó este discuss (detectado el 2026-07-15 y anotado en REQUIREMENTS §Constraints)
  era exactamente el **contrato parseable**: «detectar ¿hay bloque nuevo? (LIVE-03) y extraer el
  `NEXT:` (LIVE-04)». Queda cerrado por D-01 (marcador), D-04 (scoped por sesión) y D-02 (extracción).

</specifics>

<deferred>
## Deferred Ideas

- **Cómo llega `state.tasks` a la TUI (Open Question de la Phase 75)** — descubierto por el research:
  `/status` sirve `listSessions()` (`server.js:589`), no el `state.json` entero, así que `state.tasks`
  no viaja hoy hasta el dashboard. Hay salidas con precedente y **ninguna necesita endpoint nuevo**
  (la TUI ya lee el filesystem directamente en `plan.js`, precedente D-10 Phase 44). Se decide en el
  discuss de la Phase 75 — la 74 solo produce el dato.
- **Poda/cap de handoffs antiguos** — v0.18, con datos reales de crecimiento (ya en Out of Scope).
- **Surface del handoff en el overlay de filas GSD** — rompería D-02 (LOCKED desde v0.11). Se escribe
  en disco, no se pinta.
- **Handoff en sesiones muertas por SIGKILL/crash** — límite estructural aceptado: sin hook
  `SessionEnd` no hay handoff. Mismo modelo de fallo que el backstop de «In Review» de v0.16.
- **Migración/backfill de planes existentes** al nuevo formato — no surgió como requisito; los
  ficheros viejos son markdown plano y el appendeo funciona sobre ellos tal cual (el `v=1` de D-01
  existe para poder evolucionar sin romperlos).

</deferred>

---

*Phase: 74-Handoff acumulativo al cierre*
*Context gathered: 2026-07-15*
