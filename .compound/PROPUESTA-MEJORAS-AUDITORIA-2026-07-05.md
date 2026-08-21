# Propuesta de mejoras — remediación de la auditoría adversarial

**Fecha:** 2026-07-05 · **Input:** `AUDITORIA-ADVERSARIAL-2026-07-03.md` · **Estado:** propuesta, sin código tocado.

**Re-verificación previa (2026-07-05):** los 9 hallazgos ALTA se re-comprobaron contra el código actual y **todos se sostienen** (A1 `server.js:651/667` bindea sin host; A2 el comentario "ÚNICO escritor" sigue en `server.js:682`; A3 `lock.js` sigue sin `flag:'wx'`; A4 `reconcile.js` no contiene ninguna escritura de `status` y el gate de `manager.js:178` filtra por `status==='running'`; A5 `run.js` escribe el PID pre-bind y `teardown` lo borra sin comprobar propiedad; A6 no hay validación de `started_at`/`kind` antes de matar; A7 el cursor avanza incondicionalmente con dispatch fire-and-forget; A8 la heurística `cwd ⊂ KODO_ROOT` + `git commit` sin pathspec siguen; A9 `runUp` nunca lee `deps.url`). **M13 sigue abierta:** hoy no existe ningún worktree ni en `.bg-shell/` ni en `.claude/worktrees/`, así que no se pudo confirmar empíricamente cuál es la ubicación real.

---

## Principio organizador

La auditoría lista ~40 hallazgos, pero casi todos descienden de **tres causas raíz** (las tensiones T1–T5 del informe). Arreglar síntoma a síntoma multiplicaría el trabajo y los conflictos entre parches; la propuesta agrupa por causa raíz en 4 olas, cada una cerrable y verificable de forma independiente. Formato sugerido: **milestone v0.16 "Hardening"** con una fase GSD por ola.

---

## Ola 1 — Cerrar la superficie de red (A1, M1, M2, B6, B10)

*Causa raíz T3: el modelo de seguridad delega en un aislamiento de red que el código no materializa.*

1. **Bind configurable con default seguro** (`server.js:651,667`): `server.listen(port, host)` con `host = config.server.bind ?? '127.0.0.1'`. Quien necesite recibir el webhook de Plane desde otro nodo configura explícitamente la IP de tailscale — el default deja de exponer a toda interfaz.
2. **Token compartido para el carril no-webhook**: header `Authorization: Bearer <token>` exigido en `GET /status|/logs|/comments/:id` y `DELETE /sessions/:id`. `/webhook` ya tiene HMAC (correcto, no tocar); `/health` puede quedar abierto (booleano sin datos). El dashboard Ink lee el token de config y lo envía.
3. **Límite de body pre-auth** (M1, `server.js:380`): cortar `readBody` a 1 MB → 413.
4. **Errores 500 genéricos** (B10): `err.message` al log, mensaje neutro al cliente.
5. **Validar `sessionId`** (B6, `logs/reader.js:66`): `/^[A-Za-z0-9_-]+$/`.

**Éxito:** desde otro nodo de la LAN, `GET /status` y `DELETE /sessions/x` devuelven 401 sin token; el webhook de Plane sigue entrando; test de body de 2 MB → 413.

**Nota crítica:** con esta ola cerrada, M4 (OSC-52 en dashboard) baja mucho de prioridad — exige un atacante con permiso de comentario en tu Plane. Lo dejaría para la Ola 4 como strip barato de `\x1b` y no antes.

## Ola 2 — Concurrencia y ciclo de vida de procesos (A2, A3, A4, A5, A6, M16, M17, M20)

*Causas raíz T1 (state.json multiproceso sin lock) y T2 (status vs state).*

1. **Lock advisory alrededor de load→mutate→save** (A2): un `withStateLock(fn)` que toma lockfile `O_EXCL` con retry corto, re-lee, muta y guarda. Envolver los ~6 escritores. **No** propongo mover toda mutación a HTTP contra el server (la alternativa del informe): es la solución "correcta" pero reescribe hooks, CLI y doctor para un problema que un lockfile de 40 líneas resuelve — sobreingeniería a día de hoy.
2. **Corregir el comentario mentiroso** de `server.js:682` en el mismo commit — los comentarios que afirman invariantes falsas son deuda activa.
3. **`acquireGsdLock` atómico** (A3): `writeFileSync(path, content, {flag:'wx'})`, `EEXIST` → tomado; `stealLock` vía tmp+rename.
4. **Puente `state→status`** (A4): cuando reconcile marca `state:'dead'`, derivar también `status:'idle'` (o que el gate de `max_parallel` filtre por `alive`). Es la fuga de capacidad más dañina en el uso diario: 3 zombis = kodo parado hasta 30 días.
5. **PID ownership** (A5, A6): `teardown` solo borra `kodo.pid` si `payload.pid === process.pid`; no escribir el PID hasta post-bind. Antes de SIGKILL, comparar `started_at` del payload con el arranque real del proceso (`ps -o lstart=`) y abortar si no cuadra.
6. **Arranques concurrentes** (M20): lock `O_EXCL` en `polling start` (reutiliza la primitiva del punto 1).
7. **Migración v1→v2 atómica** (M16): `migrateConfigIfNeeded` vía `writeFileAtomic`.
8. **Dedup no-GSD cross-proceso** (M17): usar el mismo lock por `task_id`.

**Éxito:** test que lanza 2 procesos concurrentes contra el mismo repo y verifica un solo `{acquired:true}`; test de zombi (`kill -9` a una sesión) que verifica que reconcile libera el slot de `max_parallel` en el siguiente tick.

## Ola 3 — Fiabilidad de entrega y backstop del ciclo de vida (A7, M10, M11, T5)

*Causa raíz T4/T5: fire-and-forget donde hay obligación de entrega, y ciclo de vida delegado al LLM sin fallback.*

1. **Cursor de polling solo avanza con dispatch confirmado** (A7): en el path de polling, `await dispatchFn` (con timeout) y solo incorporar el `updated_at` de ese issue a `maxUpdatedAt` si resolvió. El webhook puede seguir fire-and-forget (Plane re-entrega); el polling no tiene esa red.
2. **Centinela de primer tick** (M10): distinguir "cache ausente" de "primer tick observado".
3. **Idempotencia real en adopt** (M11): antes de `createTask`, buscar por `task_url`.
4. **Backstop mecánico de "In Review"** (T5): si al `SessionEnd` la tarea sigue en "In Progress" y la sesión terminó limpia, el hook hace la transición él mismo (y comenta "cierre automático"). Esto convierte la instrucción al LLM en optimización, no en única vía. Es el hallazgo que más afecta a la promesa central del producto (README: "al cerrar, pasa a In Review").

**Éxito:** simular `launchWorkItem` que rechaza → el issue se reintenta en el siguiente tick; matar una sesión sin dejar que el LLM transicione → la tarea acaba en "In Review" igualmente.

## Ola 4 — Higiene, DX y verdad documental (A8, A9, M3, M5, M12, M14, M18, M19, resto de BAJAS, deriva del README)

1. **Marcador explícito de orquestador** (A8): variable de entorno (`KODO_ORCHESTRATOR=1`) inyectada al lanzar el workspace orquestador; el stop hook solo auto-commitea si está presente, y con pathspec completo (`git commit -- .claude/skills/kodo-orchestrate/`). La heurística de cwd es el hallazgo con más riesgo de morder al propio dev (commits fantasma por turno con lo que hubiera staged).
2. **`kodo up --url`** (A9): decisión de simplicidad — **eliminar el flag** salvo que haya un caso de uso real; cablearlo es trivial pero es una feature especulativa que ya nació muerta una vez.
3. **Health loop** (M18): misma vara — si nadie lo echó de menos desde que existe, **borrar `startHealthLoop` y corregir el README**; cablearlo es añadir un proceso periódico más al mismo event loop que M21 ya señala como cargado.
4. **Efectos de cierre en `SessionEnd`, no en `Stop`** (M19): mover coloreado de workspace, notify y nudge.
5. **Batch de endurecimiento de config**: M3 (rechazar `__proto__|constructor|prototype`), M5 (chmod 0600 si hay `*_secret`), M14 (`split` con `join` del resto), B5, B7.
6. **Batch de BAJAS mecánicas**: B1, B3, B4, B9, B12 y M12 (`[-–—]` en roadmap) — todas son diffs de 1–5 líneas, un solo PR.
7. **Pasada de README**: stop hook real, `kodo status` vs `dashboard`, rutas `src/providers/…`, owner del repo, comandos indocumentados, y **documentar `--dangerously-skip-permissions`** en sesiones GSD (o hacerlo opt-in vía `kodo:yolo`) — hoy es un default silencioso con implicaciones de seguridad.

## Qué NO haría ahora (y por qué)

- **M21 (reconcile síncrono):** medir antes de arreglar. Con pocas sesiones el bloqueo de 2.5s-tick puede ser de milisegundos; pasar a async o a proceso aparte es un refactor con riesgo propio. Solo si `/health` muestra latencias reales.
- **M4 (OSC-52):** tras la Ola 1, el vector exige un colaborador malicioso en tu propio Plane. Strip de `\x1b` en Ola 4, no antes.
- **B2, B8 (latentes):** incluirlos en el batch de bajas, sin prioridad.
- **Rediseño "un solo escritor de estado" (alternativa de T1):** rechazado por ahora; el lockfile cubre el riesgo con 1/20 del coste. Revisitar solo si aparecen más escritores.
- **M7–M9 (cliente Plane: Retry-After, filtro kodo, paginación):** válidos pero de impacto acotado; entran en Ola 3 si sobra hueco o como batch propio después.

## Decisiones que necesita el mantenedor antes de empezar

1. **Topología real:** ¿Plane entrega el webhook desde otro nodo? → define si el default de bind es `127.0.0.1` puro o hace falta doc de "bind a IP tailscale + ACL".
2. **Backstop In Review (Ola 3.4):** ¿se acepta que kodo transicione tareas sin intervención del LLM? Cambia el contrato del producto (a mejor, en mi opinión, pero es decisión de producto).
3. **Health loop y `up --url`:** confirmar que se borran en vez de cablearse.
4. **M13:** a resolver empíricamente en la Ola 2 lanzando una sesión GSD real y observando dónde aparece el worktree — hoy no hay ninguno vivo que lo delate.

## Orden y tamaño

| Ola | Contenido | Tamaño | Riesgo de regresión |
|---|---|---|---|
| 1 | Red y auth | S (1 fase corta) | Bajo — aditivo |
| 2 | Concurrencia/PID | M — la más delicada | Medio — tocar locks exige tests de proceso real |
| 3 | Entrega + backstop | M | Medio — cambia semántica de polling y SessionEnd |
| 4 | Higiene/docs | S–M, paralelizable | Bajo |

La Ola 1 va primero no por ser la más grave en probabilidad, sino porque es la más barata de cerrar y elimina la única exposición a atacantes externos; 2 y 3 son las que arreglan el producto para el usuario legítimo. La 4 puede solaparse con cualquiera.
