# Pitfalls Research

**Domain:** CLI orchestrator de sesiones Claude Code (Node.js) — saneo destructivo de recursos (worktrees/locks/logs/state.json), promoción de TUI ink read-only → read-write, y enrichment cross-provider (Plane + GitHub) en el poll.
**Researched:** 2026-06-03
**Confidence:** HIGH (groundeado en `src/gsd/lock.js`, `src/hooks/stop.js`, invariantes v0.9 de STATE.md; verificado contra `kill(2)` y `git worktree --help` en este host)

> Alcance: pitfalls **específicos** a las tres features de v0.10 (DOCTOR, DISMISS, PROVIDER-STATE). No se repiten genéricos. Cada pitfall mapea a la fase que debe mitigarlo.

---

## Critical Pitfalls

### Pitfall 1: PID reciclado por el OS pasa `process.kill(pid, 0)` → doctor roba/borra un lock vivo

**What goes wrong:**
`doctor --fix` (y el dismiss que reusa su lógica) decide que un lock per-repo está "colgado" porque su PID está muerto, lo borra, y otra sesión arranca sobre el mismo repo rompiendo el invariante de coalescencia. El caso inverso es peor: el PID del lock fue **reciclado** por el kernel y ahora pertenece a un proceso ajeno vivo (mismo UID) → `isPidAlive` devuelve `true`, doctor lo respeta como "vivo" y un lock realmente huérfano nunca se limpia. En macOS los PIDs son un espacio pequeño (≤99998) y se reciclan rápido en sesiones largas.

**Why it happens:**
`process.kill(pid, 0)` solo prueba existencia + permiso del PID, NO identidad del proceso. `src/gsd/lock.js#isPidAlive` ya es correcto (solo `ESRCH` ⇒ muerto; `EPERM` ⇒ vivo conservador), pero NO valida que el PID siga siendo *esa* sesión kodo. Un PID reciclado del mismo usuario es indistinguible de la sesión original con la información que el lock guarda hoy (`{session_id, task_id, pid, acquired_at, ttl_hours}`).

**How to avoid:**
- Doctor NO debe re-implementar liveness: reusar `isPidAlive` + el TTL ya existente. El TTL (4h) es la red de seguridad real contra PID-reuse — un lock cuyo `acquired_at` excede TTL se considera robable aunque `isPidAlive` mienta.
- Hacer el liveness **dos-factor** donde sea barato: cruzar el `pid` del lock contra `state.json` (¿hay una sesión con ese `session_id` y `alive===true`?) y/o contra el host provider (`cmux`). Si el PID dice "vivo" pero NINGUNA sesión kodo lo reclama Y el TTL venció ⇒ huérfano seguro.
- `--fix` sobre locks: aplicar la MISMA máquina de estados de `acquireGsdLock` (dead → steal silent; alive+TTL-exceeded → steal+warn; alive+TTL-ok → **abstenerse**). Nunca un borrado incondicional.

**Warning signs:**
- Doctor reporta "lock huérfano limpiado" seguido de un `worktree_collision` en el dispatcher minutos después.
- Tests con un PID hardcodeado (p. ej. `99999`) que asumen "siempre muerto" — frágiles ante reciclaje.

**Phase to address:** Fase DOCTOR (la que implemente el saneo de locks). Verificación: test que inyecta un lock con PID vivo+TTL-ok y asserta NO-borrado; test con PID muerto y assert steal.

---

### Pitfall 2: Race liveness→borrado (TOCTOU) — la sesión revive entre el check y el `rm`

**What goes wrong:**
Doctor lee `state.json`, ve `alive===false` para una sesión, e inicia el borrado del worktree / `DELETE /sessions/{id}`. Entre el check y el borrado, `reconcileTick` (el ÚNICO escritor de `alive`) corre y flipea esa sesión a `alive===true` (el usuario reabrió el workspace en cmux). Doctor borra un worktree con trabajo en curso o desregistra una sesión viva.

**Why it happens:**
`alive` es un snapshot. Doctor y `reconcileTick` corren en procesos distintos sin sincronización. El dismiss desde la TUI agrava esto: la decisión de "¿es dismissable?" se toma sobre el snapshot del poll (potencialmente segundos viejo), y la confirmación humana introduce una ventana aún mayor entre check y acción.

**How to avoid:**
- **Re-verificar `alive` inmediatamente antes de la acción destructiva**, leyendo la fuente autoritativa (`state.json` / `GET /status`), no el snapshot que disparó la decisión. Patrón check-then-act atómico: leer `alive`, y si `false`, actuar; abortar fail-open si cambió.
- Reusar la red de seguridad que `stop.js` YA tiene: `git worktree remove` (sin `--force`) **rechaza** árboles con cambios sin commitear. NO añadir `--force` en doctor por defecto — dejar que git sea el segundo guard. Si está dirty, mover-a-`.dirty` como hace stop.js, nunca borrar.
- El dismiss debe respetar el guard inverso (`alive===false`) **en el momento del DELETE**, no solo al pintar la tecla `d`.

**Warning signs:**
- Worktrees `.dirty-<ts>` apareciendo tras correr doctor (señal de que casi se borra trabajo vivo).
- Reportes de "mi sesión desapareció del dashboard mientras trabajaba".

**Phase to address:** Fase DOCTOR (re-check pattern) + Fase DISMISS (guard en el momento del DELETE). Verificación: test que flipea `alive` entre el check mock y la acción, assert abort.

---

### Pitfall 3: TOCTOU en el filesystem del worktree — `existsSync` luego `remove` sobre un path que cambió

**What goes wrong:**
Doctor detecta un worktree "huérfano" (en disco pero sin sesión en `state.json`), confirma con `existsSync`, y borra. Pero `git worktree remove` opera sobre metadata en `$GIT_DIR/worktrees/`, no solo el directorio: si el directorio fue movido/borrado a mano, `remove` falla; si fue reemplazado por un symlink o un archivo regular (caso ya manejado en stop.js CR-03 con `lstatSync` discriminando ENOENT/symlink/EACCES), un `rm -rf` ciego podría seguir un symlink fuera del repo.

**Why it happens:**
"Huérfano" se define por ausencia de sesión, pero el estado del filesystem es ortogonal y mutable. Mezclar el borrado del directorio (`rm`) con la limpieza de metadata de git (`worktree prune`) sin orden definido produce estados intermedios inconsistentes.

**How to avoid:**
- Preferir las herramientas de git sobre `rm` crudo: `git worktree remove <path>` para los registrados, `git worktree prune` para la metadata stale. `prune` es idempotente y seguro por diseño (es exactamente lo que git ofrece para "limpiar administrative files stale").
- Reusar el `lstatSync`-en-try/catch de stop.js que ya discrimina ENOENT vs symlink vs EACCES antes de tocar el path. NO introducir un segundo patrón de borrado.
- Distinguir dos clases de huérfano: (a) **registrado en git pero sin sesión** → `git worktree remove`; (b) **metadata git stale sin directorio** → `git worktree prune`. Tratarlos con la misma brocha es el error.
- Nunca seguir symlinks al borrar; resolver con `realpathSync` y confirmar que el target sigue bajo `<projectPath>/.bg-shell/` antes de actuar.

**Warning signs:**
- `git worktree list` muestra entradas `prunable` tras correr doctor (no se limpió la metadata, solo el dir).
- Errores `EACCES`/`ENOTDIR` en el log de doctor (path mutó bajo los pies).

**Phase to address:** Fase DOCTOR. Verificación: test con worktree registrado-sin-dir (prunable) y dir-sin-registro; assert ruta correcta para cada uno.

---

### Pitfall 4: Borrar logs NDJSON que un `kodo logs --follow` activo está leyendo

**What goes wrong:**
Doctor borra logs "viejos" mientras un proceso `kodo logs --follow` (UAT-01 spawnea esto en tests) o un tail tiene el archivo abierto. En POSIX el `unlink` no rompe el reader (el inode persiste hasta cerrar el fd), pero el follower nunca ve EOF y queda leyendo un inode fantasma; peor, si doctor *trunca* o *rota* en vez de borrar, el follower puede leer basura o saltar líneas. Además los logs de `polling-YYYY-MM-DD.log` tienen retención de 7 días YA implementada (v0.8 Phase 28) — doctor duplicando esa lógica con criterio distinto crea borrados inconsistentes.

**Why it happens:**
"Logs viejos" es ambiguo (¿por mtime? ¿por fecha en el nombre? ¿por sesión muerta?). El follower y el doctor no coordinan. La retención de polling ya existe y doctor la ignora.

**How to avoid:**
- Definir "viejo" por una sola regla explícita (p. ej. mtime > N días Y ninguna sesión activa lo referencia vía `--session-of`/head-line scan). NO borrar el log del día activo.
- **Reusar** la retención de 7 días de polling-daemon, no inventar otra ventana. Doctor reporta lo que borraría; el borrado real respeta el mismo umbral.
- Nunca truncar in-place: borrar archivos enteros (unlink) deja a los followers POSIX intactos. Evitar rotación destructiva.
- Dry-run por defecto: doctor lista los logs candidatos sin tocarlos hasta `--fix`.

**Warning signs:**
- `kodo logs --follow` colgado sin nuevas líneas tras correr doctor.
- Dos criterios de retención divergentes en el código (polling vs doctor).

**Phase to address:** Fase DOCTOR. Verificación: test que spawnea `--follow`, corre doctor `--fix`, assert el follower no crashea y el log activo sobrevive.

---

### Pitfall 5: N+1 API calls a Plane/GitHub en cada poll → rate-limit exhaust

**What goes wrong:**
`getTaskState` se llama por-sesión dentro del enrichment de `GET /status`. Con N sesiones activas, cada poll del dashboard (cada 2.5–10s por el backoff) dispara N llamadas a Plane/GitHub. GitHub REST tiene 5000 req/h autenticado pero **el secondary rate limit** (ráfagas concurrentes) muerde mucho antes; Plane CE depende del deploy. El dashboard puede tener múltiples instancias abiertas. Resultado: el token se agota y TODO kodo (polling trigger incluido, que comparte el cliente y el warn `X-RateLimit-Remaining < 100`) deja de funcionar.

**Why it happens:**
El enrichment se acopla al ciclo del poll de la TUI sin caché ni batching. El contrato `TaskProvider` es per-task (`getTask(ref)`), así que el reflejo ingenuo es 1 fetch por sesión por poll.

**How to avoid:**
- **Cache server-side con TTL** en `GET /status` (no en la TUI): `getTaskState` solo se invoca si el cache de ese `task_id` venció. El estado del provider cambia en minutos, no en segundos — un TTL de 30–60s desacopla la frecuencia del poll TUI de la frecuencia de llamadas al provider.
- Coalescer: un solo refresh en vuelo por `task_id` (single-flight, ya es el patrón de `runPollLoop`).
- Respetar el rate-limit warn existente del `GitHubClient` (`X-RateLimit-Remaining < 100`): si está bajo, el enrichment se salta (fail-open) en vez de empujar al límite.
- Considerar batch donde el provider lo permita (GitHub Search API por labels, Plane list filtrado) en lugar de N `getTask`.

**Warning signs:**
- `X-RateLimit-Remaining` cayendo monótonamente con el dashboard abierto.
- `plane.api.call.failed` / 403/429 en el log creciendo con el número de sesiones.
- El polling trigger (canal independiente) empieza a fallar cuando alguien abre el dashboard.

**Phase to address:** Fase PROVIDER-STATE (cache+TTL en `/status` ANTES de cablear el render). Verificación: test que con N sesiones y dos polls consecutivos dentro del TTL assert ≤ N (no 2N) llamadas a `getTaskState`.

---

### Pitfall 6: Fail-open silencioso que oculta fallos del provider durante horas

**What goes wrong:**
El enrichment es fail-open (correcto, no debe crashear `/status`), pero si el fail-open colapsa el error a "sin estado" sin observabilidad, el operador ve sesiones sin `provider_state` durante horas creyendo que es normal, cuando en realidad el token expiró o Plane está caído. El driver del milestone (ROMAN-150: sesión "In Review" invisible) se reintroduce justo al revés: ahora el estado existe pero el fetch falla silenciosamente.

**Why it happens:**
Fail-open + cache se combinan mal: un fetch fallido puede servir un valor de cache stale indefinidamente, o devolver vacío sin distinguir "no aplica" de "falló". El render no diferencia "provider sin estado" de "no pudimos consultarlo".

**How to avoid:**
- Distinguir TRES estados en el shape de enrichment (espejo del campo aditivo `supported` que 39.1 ya introdujo para overlays): `{provider_state: 'In Review'}` (ok), `{provider_state: null, reason: 'unsupported'}` (provider sin el concepto), `{provider_state: null, reason: 'fetch-failed', stale_at?}` (falló — render lo marca distinto, p. ej. dim/`?`).
- Emitir NDJSON en el fail (`provider.state.fetch.failed`) — el fail-open es silencioso en la UI pero NUNCA en el log (mismo principio que `worktree.cleanup.dirty` warn).
- Cache con marca de frescura: si el último fetch ok fue hace > X, degradar el render a "stale" en vez de mostrar el valor viejo como si fuera vivo.
- Token=0 invariante: el enrichment vive en server/vigilante que consumen 0 tokens LLM — `getTaskState` es una API call HTTP, no una llamada al modelo. No violar esto.

**Warning signs:**
- Columna `provider_state` vacía para TODAS las sesiones pero sin nada en el log.
- Valores de estado que no cambian nunca (cache stale servido indefinidamente).

**Phase to address:** Fase PROVIDER-STATE. Verificación: test con `getTaskState` que throwea, assert `/status` responde 200 + reason `fetch-failed` + evento NDJSON emitido.

---

### Pitfall 7: Acoplar el lifecycle de kodo al vocabulario de estados del provider

**What goes wrong:**
El render/filtro del dashboard hardcodea strings del provider ("In Review", "Done"). Plane renombra "In Review" → "Review" en su instancia, o el operador usa estados custom, y el mapeo se rompe silenciosamente. El estado v3 de kodo (`idle`/`needs-input`/`dead`/`closed` + `running`/`review`/etc.) NO debe confundirse con `provider_state` — son dos ejes ortogonales (estado del proceso local vs estado de la tarea en el sistema de gestión).

**Why it happens:**
Es tentador mapear `provider_state` directamente a un color/columna del dashboard reusando el `statusColor` v3-aware. Pero los estados de Plane/GitHub son **datos del usuario**, no un enum cerrado de kodo. GitHub agrava: no tiene un estado "review" nativo (solo open/closed + labels + PR review state) → el mapeo es inherentemente ambiguo.

**How to avoid:**
- `getTaskState` devuelve el string **crudo del provider** (más, opcionalmente, una normalización a un enum kodo pequeño y abierto). El dashboard muestra el crudo; cualquier semántica (color, filtro) opera sobre el crudo como dato, NUNCA con `switch` sobre literales hardcodeados que se rompen al renombrar.
- Mantener `provider_state` como columna/badge SEPARADA del estado v3 — no fusionar con `statusColor`. Decisión abierta (render: columna vs badge vs color) debe resolver esto en discuss-phase.
- GitHub: documentar el mapeo elegido (labels vs PR-state, decisión abierta) y aceptar que "review" puede no existir → devolver el estado nativo (open/closed) + label relevante, no inventar un "review" falso.
- Filtro (`s:review` OR vs prefijo `ps:`, decisión abierta): si filtra por `provider_state`, debe ser substring case-insensitive con `String.includes` (NUNCA `RegExp`, anti-ReDoS Phase 36) sobre el string crudo, tolerante a renombrados parciales.

**Warning signs:**
- `switch (providerState) { case 'In Review': ... }` en el código del dashboard.
- El filtro por estado deja de matchear tras un cambio de configuración en Plane.
- El mismo color para una sesión `dead` (v3) y una tarea `closed` (provider) confundiendo al operador.

**Phase to address:** Fase PROVIDER-STATE (contrato `getTaskState` + render). Verificación: test que cambia el string del provider y assert el render/filtro sigue funcionando sin cambios de código.

---

### Pitfall 8: Un throw en el handler de `d` crashea React (rompe el invariante never-throws de v0.9)

**What goes wrong:**
El dismiss introduce la PRIMERA mutación en la TUI. El handler de `d` hace `await fetch(DELETE /sessions/{id})`. Si esa promesa rechaza (ECONNREFUSED, 500, timeout) y el throw NO se captura ANTES de tocar React, ink desmonta el árbol y el dashboard crashea — violando directamente el invariante v0.9 "ningún throw llega a React" y el lifecycle limpio de Phase 34.

**Why it happens:**
La capa de datos v0.9 (`fetchStatus`/`fetchComments`/`fetchLogs`) es never-throws por diseño, pero es de **lectura**. El DELETE es una ruta nueva de **escritura** que no pasa por `client.js` never-throws a menos que se añada ahí explícitamente. Un `useInput` handler async con un `await` sin try/catch es un throw no capturado.

**How to avoid:**
- Añadir el DELETE a la capa never-throws (`client.js`): `dismissSession(baseUrl, id)` que colapsa cualquier fallo a `{ok:false, error}` igual que `fetchStatus`. El handler de `d` NUNCA hace un `await` desnudo.
- El error de dismiss se muestra en el **footer** (mismo patrón que el error de focus/`Enter` en Phase 37: error al footer, panel permanece montado, cero unmount).
- El handler de `useInput` no debe ser `async` con throws latentes: o es fire-and-forget con `.catch` que escribe al footer, o delega a una función never-throws.

**Warning signs:**
- `await fetch(...)` sin try/catch en un handler de `useInput`.
- El dashboard sale con stack trace en vez de mostrar un error en el footer.
- Tests de la TUI que no cubren el path DELETE-falla.

**Phase to address:** Fase DISMISS. Verificación: test que mockea DELETE rechazando, assert el componente sigue montado + footer muestra error (espejo del test de focus-error de Phase 37).

---

### Pitfall 9: Mutar sobre un snapshot stale → confirmar sobre la fila equivocada

**What goes wrong:**
El usuario pulsa `d`, kodo pide confirmación, y mientras tanto el poll vivo refresca la tabla y reordena (sort DESC por `started_at`). Si la confirmación se resuelve contra el **índice de fila** o contra el snapshot viejo, se borra/desregistra la sesión equivocada. O: la sesión seleccionada era `alive===false` al pulsar `d`, pero `reconcileTick` la revivió antes de confirmar.

**Why it happens:**
La TUI ya selecciona por **identidad `task_id`** (invariante Phase 36), pero el dismiss es una acción diferida con confirmación. Si la confirmación no captura y revalida el `task_id` (no el índice ni el objeto-sesión congelado), el reordenamiento del poll mueve la fila bajo el cursor.

**How to avoid:**
- Capturar el `task_id` (identidad, Phase 36 invariante) en el momento de pulsar `d`, mostrarlo en el prompt de confirmación ("Dismiss ROMAN-150?"), y ejecutar el DELETE contra ESE `task_id` — nunca contra el índice ni la posición actual del cursor.
- Re-validar `alive===false` para ese `task_id` contra el snapshot MÁS RECIENTE en el momento de confirmar (no el del momento de pulsar `d`). Si revivió, abortar con mensaje al footer.
- Considerar congelar el render bajo el modo de confirmación (patrón "snapshot congelado" que los overlays `c`/`l` de Phase 39 ya usan) para que el reordenamiento del poll no mueva visualmente la fila durante la decisión.

**Warning signs:**
- Confirmación que muestra "Dismiss row 3?" en vez del `task_id`.
- Reportes de "borré la sesión de arriba pero desapareció otra".
- El cursor salta visiblemente durante el prompt de confirmación.

**Phase to address:** Fase DISMISS. Verificación: test que reordena la tabla entre pulsar `d` y confirmar, assert el DELETE va al `task_id` original.

---

### Pitfall 10: Añadir el 10º método (`getTaskState`) rompiendo la contract matrix

**What goes wrong:**
`getTaskState` se añade a `TASK_PROVIDER_METHODS` (9 → 10) y a Plane, pero GitHub no lo implementa (o viceversa). `getProvider('github')` falla la validación de 10 métodos al arranque, o peor, pasa la validación con un método que throwea en runtime. La contract matrix (`test/providers/contract.test.js`, Plane+GitHub × 7 asserts core) no cubre el método nuevo y el fallo se escapa a producción.

**Why it happens:**
Es un milestone de "añadir un método" — el reflejo es implementarlo donde duele el caso real (Plane, ROMAN-150) y diferir GitHub. Pero la validación de N métodos es all-or-nothing: un adapter incompleto rompe `getProvider`.

**How to avoid:**
- Implementar `getTaskState` en **AMBOS** adapters en la MISMA fase, aunque GitHub tenga un mapeo "pobre" (open/closed + label). Un no-op honesto que devuelve `{provider_state: null, reason:'unsupported'}` es válido; un método ausente NO lo es.
- Extender la contract matrix: añadir `getTaskState` a los asserts core (8º assert × 2 providers) ANTES de cablear el enrichment. La matrix es el guard que demuestra empíricamente la promesa arquitectónica.
- Actualizar `TASK_PROVIDER_METHODS` en `src/interface.js` y el invariante de STATE.md ("TaskProvider 9-method contract" → 10) en la misma fase — si no, el doc-drift confunde a futuros adapters (ClickUp, local).

**Warning signs:**
- `getProvider('github')` lanza "missing method getTaskState" al abrir el dashboard con provider github.
- La contract matrix sigue iterando 7 asserts tras añadir el método.
- `getTaskState` implementado en un solo `provider.js`.

**Phase to address:** Fase PROVIDER-STATE (debe ser la PRIMERA en tocar el contrato, antes de render/dismiss). Verificación: contract matrix iterando 8 asserts × 2 providers verde + validación de 10 métodos.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `getTaskState` solo en Plane, no-op throw en GitHub | Cierra ROMAN-150 rápido | Rompe `getProvider('github')` y la contract matrix; doc-drift del invariante 9→10 | Nunca — el no-op debe ser honesto (`{state:null, reason:'unsupported'}`), no ausente ni throw |
| Doctor `--fix` sin dry-run por defecto | Menos teclas | Un borrado destructivo accidental sin preview = trabajo perdido | Nunca para borrados; dry-run debe ser el default |
| Enrichment sin cache (fetch por poll) | Render siempre fresco | N+1 rate-limit exhaust mata el polling trigger compartido | Solo en prototipo con 1 sesión; nunca con N sesiones reales |
| `await fetch(DELETE)` directo en el handler de `d` | Menos código | Un rechazo crashea React, viola el invariante never-throws | Nunca — debe pasar por `client.js` never-throws |
| Doctor reimplementa liveness en vez de reusar `isPidAlive`/TTL | Independencia del módulo lock | Dos definiciones de "muerto" divergen; PID-reuse no cubierto | Nunca — reusar `src/gsd/lock.js` |
| `rm -rf` del worktree en vez de `git worktree remove`/`prune` | Simple | Deja metadata git stale; puede seguir symlinks; pierde el guard clean/dirty | Nunca — usar las herramientas de git |
| Mapear `provider_state` con `switch` sobre literales | Render directo | Se rompe al renombrar estados en Plane | Nunca — tratar el estado como dato crudo |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| GitHub REST (`getTaskState`) | Asumir 5000 req/h como el único límite; ignorar secondary rate limit | Cache+TTL server-side; respetar el warn `X-RateLimit-Remaining < 100` ya existente; saltar enrichment si está bajo |
| GitHub "review" | Inventar un estado "review" que GitHub no tiene | Mapear a open/closed + PR review state / label; devolver el estado nativo, documentar el mapeo (decisión abierta) |
| Plane estados custom | Hardcodear "In Review" en el render/filtro | Tratar el string del provider como dato; substring `String.includes` para el filtro |
| `git worktree` | `rm` del directorio sin `git worktree prune` | `git worktree remove` (registrados) + `git worktree prune` (metadata stale); reusar el `lstatSync` discriminante de stop.js |
| `process.kill(pid, 0)` | Asumir que "vivo" ⇒ es la sesión original | TTL como red de seguridad contra PID-reuse; cruzar con `state.json`/cmux |
| `DELETE /sessions/{id}` | `await` desnudo en el handler React | Envolver en `client.js` never-throws → `{ok:false, error}` → footer |
| `state.json` ↔ `reconcileTick` | Decidir sobre un snapshot y actuar después sin re-check | Re-leer `alive` de la fuente autoritativa justo antes de la acción destructiva |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 `getTaskState` por poll | `X-RateLimit-Remaining` cae; 429/403 crecen | Cache+TTL en `/status`, single-flight por `task_id` | Con ≥ ~5 sesiones activas y/o múltiples dashboards abiertos (rate-limit secundario de GitHub muerde antes de 5000/h) |
| Doctor escaneando todos los worktrees/logs en cada invocación | Lento en repos grandes | OK — doctor es on-demand, no en loop; no optimizar prematuramente | No relevante a la escala personal de kodo |
| Cache stale servido indefinidamente tras fetch-fail | Estados que nunca cambian | Marca de frescura; degradar a "stale" tras X | Cuando el provider está caído horas |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Doctor sigue symlinks al borrar worktrees | Borrado fuera de `<projectPath>/.bg-shell/` (escape de directorio) | `realpathSync` + confirmar target bajo `.bg-shell/`; reusar `lstatSync` discriminante de stop.js |
| `getTaskState` registrando el token o el body del provider en NDJSON | Exfiltración de secreto en logs | El redactor NDJSON ya corre en emit (invariante v0.3); asegurar que el nuevo evento pasa por él |
| `DELETE /sessions/{id}` sin guard de identidad | TUI borra la sesión equivocada por confusión de `task_id` | Acción por `task_id` (Phase 36 identidad), re-validada al confirmar |
| Token leído por `getTaskState` escrito a `config.json` | Token persistido en claro | Token solo desde `~/.kodo/.env`, NUNCA a `config.json` (invariante v0.7 GitHubClient) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| `d` sin confirmación sobre acción destructiva | Borrado accidental de sesión | Prompt de confirmación mostrando el `task_id`, no el índice |
| `provider_state` vacío sin distinguir "no aplica" de "falló" | El operador no sabe si el provider está caído | Tres estados visuales: ok / unsupported / fetch-failed (dim+`?`) |
| Doctor borra sin preview | Sorpresa destructiva | Dry-run por defecto; `--fix` explícito; resumen de lo que se borraría |
| `d` habilitado sobre `alive===true` | Usuario intenta dismiss una sesión viva | Guard inverso a Enter (solo `alive===false`), rechazo con mensaje al footer |
| Mismo color para `dead` (v3) y `closed` (provider) | Confusión entre eje local y eje provider | Columna/badge separada para `provider_state`, NO fusionar con `statusColor` |

## "Looks Done But Isn't" Checklist

- [ ] **Doctor liveness:** ¿reusa `isPidAlive` + TTL, o reimplementó "muerto"? Verifica que NO borra lock con PID vivo+TTL-ok.
- [ ] **Doctor worktree:** ¿usa `git worktree remove`/`prune` (no `rm -rf`)? ¿maneja registrado-sin-dir Y dir-sin-registro? ¿dirty → `.dirty` no borrado?
- [ ] **Doctor logs:** ¿reusa la retención de 7 días de polling? ¿NO borra el log del día activo? ¿el `--follow` sobrevive?
- [ ] **Dismiss handler:** ¿el DELETE pasa por `client.js` never-throws? Verifica que un rechazo NO desmonta React.
- [ ] **Dismiss identidad:** ¿confirma contra `task_id` revalidado, no índice ni snapshot viejo? ¿re-check `alive===false` al confirmar?
- [ ] **provider_state enrichment:** ¿cache+TTL server-side? Verifica ≤ N llamadas en dos polls dentro del TTL.
- [ ] **provider_state fail-open:** ¿emite NDJSON al fallar? ¿distingue unsupported de fetch-failed en el render?
- [ ] **Contract matrix:** ¿`getTaskState` en AMBOS adapters? ¿la matrix itera el 8º assert × 2 providers? ¿`TASK_PROVIDER_METHODS` actualizado a 10?
- [ ] **Invariantes v0.9:** ¿`reconcileTick` sigue siendo el ÚNICO escritor de `alive`? ¿color isolation (cero picocolors en dashboard)? ¿tokens=0 en server/vigilante?
- [ ] **STATE.md:** ¿el invariante "9-method contract" actualizado a 10 para no confundir a ClickUp/local?

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Doctor borró un worktree vivo | HIGH | `git worktree add` re-crea el dir desde la branch si la branch sobrevive; si stop.js movió a `.dirty`, recuperar de ahí; si fue `rm -rf` ciego, trabajo perdido (de ahí el dry-run default) |
| Lock vivo robado → sesión doble sobre el repo | MEDIUM | El `worktree_collision` fail-fast del dispatcher (Phase 18) aborta la segunda sesión; revisar logs y re-acquire |
| Token agotado por N+1 | MEDIUM | Esperar al reset de la ventana; cerrar dashboards; añadir cache+TTL (la fix permanente) |
| React crasheó por throw en `d` | LOW | Re-lanzar `kodo dashboard`; envolver el DELETE en never-throws (fix permanente) |
| Dismiss sobre fila equivocada | MEDIUM | La sesión sigue en cmux (DELETE solo toca state.json/worktree); re-registrar si es necesario; añadir confirmación por `task_id` |
| Mapeo provider roto por renombrado | LOW | El estado crudo sigue mostrándose; ajustar el filtro; nunca había `switch` hardcodeado si se siguió el patrón |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. PID reciclado roba lock vivo | DOCTOR | Test: lock PID-vivo+TTL-ok → NO-borrado; PID-muerto → steal |
| 2. Race liveness→borrado (TOCTOU state) | DOCTOR + DISMISS | Test: flip `alive` entre check y acción → abort |
| 3. TOCTOU filesystem worktree | DOCTOR | Test: registrado-sin-dir vs dir-sin-registro → ruta correcta cada uno |
| 4. Borrar logs con `--follow` activo | DOCTOR | Test: spawn `--follow` + doctor `--fix` → follower sobrevive, log activo intacto |
| 5. N+1 rate-limit exhaust | PROVIDER-STATE | Test: 2 polls dentro de TTL con N sesiones → ≤ N llamadas |
| 6. Fail-open silencioso oculta caídas | PROVIDER-STATE | Test: `getTaskState` throw → 200 + reason `fetch-failed` + NDJSON |
| 7. Acoplar lifecycle al vocabulario del provider | PROVIDER-STATE | Test: renombrar estado provider → render/filtro sigue sin cambios de código |
| 8. Throw en `d` crashea React | DISMISS | Test: DELETE rechaza → componente montado + footer error |
| 9. Mutar sobre snapshot stale (fila equivocada) | DISMISS | Test: reordenar tabla entre `d` y confirmar → DELETE al `task_id` original |
| 10. 10º método rompe contract matrix | PROVIDER-STATE (primera) | Contract matrix 8 asserts × 2 providers verde + validación 10 métodos |

**Recomendación de orden de fases (refuerza el mapping):**
1. **PROVIDER-STATE primero** — toca el contrato (`getTaskState`, 9→10) y la contract matrix; es la fundación. Mitiga 5, 6, 7, 10. Cierra el driver real ROMAN-150.
2. **DOCTOR segundo** — la lógica destructiva canónica que DISMISS reusará. Mitiga 1, 2, 3, 4. Dry-run + reuso de `isPidAlive`/TTL/stop.js cleanup.
3. **DISMISS último** — reusa la lógica de DOCTOR y promueve la TUI a read-write sobre la capa never-throws ya extendida. Mitiga 2 (en el momento del DELETE), 8, 9.

## Sources

- `.planning/PROJECT.md` (Constraints, Key Decisions, invariantes v0.7/v0.8/v0.9) — HIGH
- `.planning/STATE.md` (Critical Invariants to Preserve) — HIGH
- `src/gsd/lock.js` (`isPidAlive` ESRCH/EPERM, máquina de estados de acquire, TTL 4h, `realpathSync`) — HIGH (leído directo)
- `src/hooks/stop.js` (worktree cleanup fail-open, branch-read-before-remove, `lstatSync` discriminante ENOENT/symlink/EACCES, move-a-`.dirty`) — HIGH (leído directo)
- `man 2 kill` (macOS — permission check, ESRCH) — HIGH (verificado en este host)
- `git worktree --help` (remove requiere clean, `--force` para dirty, `prune` para metadata stale, prunable) — HIGH (verificado en este host)
- v0.8 Phase 28 retención polling logs 7 días — HIGH (PROJECT.md requirement validado)
- v0.7 GitHubClient rate-limit warn `X-RateLimit-Remaining < 100`, token desde `.env` — HIGH (PROJECT.md)

---
*Pitfalls research for: kodo v0.10 — saneo destructivo + TUI read-write + enrichment cross-provider*
*Researched: 2026-06-03*
