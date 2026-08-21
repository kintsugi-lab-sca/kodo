# Auditoría adversarial de kodo — Informe consolidado

**Fecha:** 2026-07-03 · **Alcance:** toda la base de código (~22k LOC en `src/`, 170 tests) · **Método:** lectura directa de caminos críticos + 9 auditorías por subsistema con verificación cruzada. · **Sin cambios de código (solo lectura).**

Veredicto por hallazgo: **CONFIRMADO** (traza cerrada end-to-end) o **PLAUSIBLE** (sospechado, no cerrado).

**TL;DR:** el código es maduro, muy comentado y con buena higiene de tests, pero descansa sobre **tres supuestos falsos que se contradicen a sí mismos en los comentarios**: (1) "un único escritor de `state.json`" cuando escriben ≥6 módulos en procesos distintos sin lock; (2) "aislamiento de red = seguridad" cuando el server bindea a `0.0.0.0` y solo `/webhook` está autenticado; (3) "el stop hook mueve la tarea a Review" cuando ya no toca el provider.

---

## 1. Mapa del sistema

**Propósito.** Puente Plane CE ↔ Claude Code vía cmux: una tarea entra en "In Progress" → kodo lanza una sesión Claude en un workspace cmux → al cerrar, la tarea pasa a "In Review".

**Puntos de entrada reales:**
- **CLI** (`src/cli.js`): `config`, `up`, `start`, `stop`, `status`, `check`, `launch`, `adopt`, `comment`, `logs`, `dashboard`, `orchestrate`, `install/uninstall`, `gsd {inspect,verify,doctor}`, `skill sync`, `polling {start,stop,status}`, `daemon run` (hidden).
- **HTTP** (`src/server.js`, `:9090`): `POST /webhook` (único con HMAC), `GET /health|/status|/logs|/comments/:id`, `DELETE /sessions/:id`, `GET /|/dashboard`.
- **Triggers**: webhook (fire-and-forget) y polling GitHub (loop `setTimeout`, cursor en `~/.kodo/polling-state.json`) → ambos convergen en `dispatchTrigger`.
- **Hooks Claude Code** (procesos separados): `SessionStart` (inyecta contexto), `Stop` (por turno, cleanup ligero), `SessionEnd` (cierre real, cleanup destructivo).

**Rutas de ejecución reales (no las documentadas):**
- La transición a "In Review" **la ejecuta el LLM** (instruido por `session-start.js`), **no** un hook mecánico. Si la sesión crashea o el modelo lo olvida, la tarea nunca transiciona.
- El health checker periódico **no existe**: `startHealthLoop` no tiene llamadores; `checkHealth` solo corre bajo `kodo check`.
- El daemon moderno (`daemon run` → `up`/brew) y el `kodo start` legacy conviven con **dos ficheros PID** (`kodo.pid`, `server.pid`) y semánticas distintas.

**Invariantes clave — declaradas vs aplicadas:**

| Invariante declarada | ¿Se aplica? |
|---|---|
| `state.json` tiene un único escritor (server) | **NO** — escriben server, hooks, CLI, doctor, polling, adopt en procesos distintos, sin lock |
| Seguridad por aislamiento de red | **Parcial** — bind `0.0.0.0`, solo `/webhook` autenticado |
| Escritura atómica ⇒ concurrencia segura | **NO** — el rename evita ficheros rotos, no lost-updates |
| GSD lock per-repo serializa sesiones | **NO cross-proceso** — `existsSync`+`writeFileSync` sin `O_EXCL` |
| Verificación HMAC del webhook | **SÍ** — `timingSafeEqual`, fail-closed, parse tras verificar (correcto) |
| Aislamiento de shell en cmux | **SÍ** — `execFile` con arrays; título/descr. van aislados en prompt-file |
| Enmascaramiento de secretos en el dashboard | **SÍ** — PERSIST-04 se sostiene, sin fuga en los 3 caminos |

---

## 2. Hallazgos por severidad

### ALTA

**A1 · Superficie de red sin autenticar, incluido un endpoint destructivo** — `server.js:651,667` (bind), `:589` (`DELETE /sessions/:id`). CONFIRMADO.
`server.listen(port)` sin host → bind a `0.0.0.0` (todas las interfaces, no solo la tailnet). Ningún endpoint salvo `/webhook` valida identidad. Escenario: cualquier nodo de la tailnet o del Wi-Fi local hace `GET /status` para enumerar `task_id`s y luego `DELETE /sessions/<id>`, que invoca `doctor.execute({fix:true})` — elimina worktrees, poda, roba locks y archiva state (solo protege sesiones vivas con un 409). **Dirección:** bind explícito a `127.0.0.1`/IP-tailscale y token compartido para el carril destructivo/lectura.

**A2 · `state.json`: read-modify-write multiproceso sin lock → lost updates** — `state.js:242-257`, `reconcile.js:327-351`; escritores en `server.js`, `manager.js`, `polling.js`, `adopt.js`, `doctor.js`, `hooks/stop.js`, `hooks/session-end.js`. CONFIRMADO.
El comentario `server.js:682` afirma "el ÚNICO escritor de state.json"; es falso. `saveState` usa tmp-único+rename (evita ficheros rotos) pero no protege el ciclo load→mutate→save. Escenario: el reconcile loop (`loadState` → bucle `pgrep` de segundos → `saveState`) revierte el `status:'idle'`/`removeSession` que un hook `Stop`/`SessionEnd` escribió en la ventana. El propio "rescate desde history" (`reconcile.js:196`) es un parche de esta carrera. **Dirección:** lockfile advisory en `saveState`, o merge por-sesión con re-read bajo lock.

**A3 · GSD lock no atómico (TOCTOU cross-proceso)** — `lock.js:103-139,216-219`. CONFIRMADO.
`acquireGsdLock` hace `existsSync` y luego `writeFileSync` **sin `flag:'wx'`/`O_EXCL`**; `stealLock` sobrescribe (last-write-wins). Intra-proceso el event loop serializa, pero dos procesos OS (polling daemon + CLI, o `doctor --fix` vs dispatch) pueden ambos ver el fichero ausente/PID muerto y ambos recibir `{acquired:true}` sobre el mismo repo. **Dirección:** `writeFileSync(path, content, { flag:'wx' })`, tratar `EEXIST` como tomado; steal vía tmp+rename.

**A4 · Zombies `status:'running'` filtran `max_parallel` hasta 30 días** — `reconcile.js:138-193` vs `manager.js:178-184`, `check.js:38`. CONFIRMADO.
`reconcile` marca `state:'dead'`/`alive:false` pero **nunca toca `status`** (dos campos de estado sin puente). El gate de lanzamiento filtra por `status==='running'`. Un `kill -9`/cierre de tab sin hook deja la sesión `status:'running'` para siempre; solo la libera el sellado a 30 días (`SEAL_AFTER_MS`) o un dismiss manual. Con `max_parallel:3`, 3 zombis bloquean todo lanzamiento. **Dirección:** que reconcile derive también `status`, o que el gate lea `alive`/`state`.

**A5 · Carrera de arranque de daemon: el perdedor borra el `kodo.pid` del ganador** — `daemon/run.js:142-166`, `server.js:645`. CONFIRMADO.
Dos `daemon run` concurrentes (p. ej. `kodo up` dentro de la ventana de boot de `brew services`). A escribe `kodo.pid=A` y bindea; B sobrescribe `kodo.pid=B`, su `startServer({managed})` rechaza `EADDRINUSE` → `teardown(1)` → `removePidFile('kodo')` borra el PID. A sigue sirviendo pero `kodo status`→`stopped` y `kodo stop` no puede tumbarlo: **daemon huérfano inmatable vía CLI**. **Dirección:** el teardown solo debe borrar el PID si le pertenece; no reclamar el PID hasta post-bind.

**A6 · `stop` mata por PID sin verificar identidad → PID reciclado recibe SIGKILL** — `cli/polling.js:502-510`, `daemon/lifecycle.js:177-187`, `polling-daemon.js:119-129`. CONFIRMADO.
El daemon muere sin limpiar; el SO recicla su PID para un proceso ajeno. `kodo stop` lee el PID stale, `isPidAlive`→true, envía SIGTERM→SIGKILL a un proceso inocente. El payload lleva `kind`/`started_at` pero `readPidFile` nunca los valida. **Dirección:** comparar `started_at` con el arranque real del proceso antes de matar.

**A7 · El cursor de polling avanza aunque el dispatch falle → tarea perdida en silencio** — `triggers/polling.js:340-395`. CONFIRMADO.
`maxUpdatedAt` se recalcula por cada issue **incondicionalmente**; el `dispatchFn` es fire-and-forget (su rechazo solo se loguea) y al final el cursor persiste. Escenario: `#42` cambia a `T`, `launchWorkItem` rechaza (cmux caído, collision, lock ajeno) → el cursor ya está en `T` → el próximo tick lo ve `≤ cursor` y **nunca reintenta**. A diferencia del webhook (Plane re-entrega), el cursor de polling crea una obligación de entrega que fire-and-forget incumple. **Dirección:** avanzar el cursor solo para issues cuyo dispatch se confirmó.

**A8 · Auto-commit de skills en cada turno de cualquier sesión dentro del repo** — `hooks/stop.js:132-135,265-299`. CONFIRMADO.
`handleOrchestratorStop` infiere "sesión orquestadora" como "cwd ⊂ KODO_ROOT + sin sesión tracked". Un dev con un `claude` normal en el repo kodo dispara, **al final de cada turno**, `git add .claude/skills/ && git commit`. Consecuencias: (1) commits a mitad de trabajo por turno; (2) barre todas las skills, no solo `kodo-orchestrate`; (3) el `git commit` sin pathspec arrastra cualquier cosa ya staged bajo un mensaje engañoso. **Dirección:** marcador explícito de orquestador (workspace/env), no heurística de cwd; `git commit -- .claude/skills/kodo-orchestrate/`.

**A9 · `kodo up --url` es código muerto** — `cli.js:82-83`, `cli/up.js:151,190`. CONFIRMADO.
`runUp({url})` pasa el objeto como `deps`; `runUp` nunca lee `deps.url` — resuelve `baseUrl` config-driven internamente. El flag documentado no cumple (contraste: `kodo dashboard --url` sí funciona). **Dirección:** separar `{url}` de `deps` y usar `deps.url ?? resolveBaseUrl(...)`.

### MEDIA

**M1 · `readBody` sin límite de tamaño → DoS de memoria pre-auth** — `server.js:380`. CONFIRMADO. `Buffer.concat` de todos los chunks antes de verificar la firma. **Dirección:** cortar a un umbral (p. ej. 1 MB) con 413.

**M2 · `/logs` y `/comments/:id` sin auth exfiltran datos** — `server.js:555,561,619`. CONFIRMADO. `/logs` incluye los primeros 200 chars de cada cuerpo de webhook y trazas de error; `/comments` devuelve comentarios de Plane con la credencial del server. **Dirección:** auth/bind como A1; no volcar cuerpos crudos al buffer.

**M3 · Prototype pollution vía `kodo config --set`** — `cli.js:547-555`. CONFIRMADO. `--set __proto__.x=y`: `setNestedValue` camina hasta `Object.prototype` y lo contamina. **Dirección:** rechazar `__proto__`/`constructor`/`prototype`.

**M4 · OSC-52 clipboard/title injection en el dashboard** — `SessionTable.js` (render comentarios/logs). PLAUSIBLE. No hay saneo app-level de control chars; ink neutraliza CSI pero **preserva OSC**. Un comentario de Plane con `\x1b]52;c;<b64>\x07` escribe en el portapapeles del operador en terminales con OSC-52. **Dirección:** strip de `\x1b`/C1 en texto del provider antes de `<Text>`.

**M5 · `webhook_secret` en `config.json` world-readable (0644)** — `config.js:99-103`, `registry.js:34`, `server.js:453`. CONFIRMADO. `writeFileAtomic` no hace `chmod` (el `.env` sí es 0600); `registry.js` acepta `plane.webhook_secret` desde `config.json` como fallback. **Dirección:** eliminar el fallback o chmod 0600 si contiene `*_secret`.

**M6 · Redacción de logs con regex anclado deja pasar secretos embebidos** — `logger.js:165-195`. CONFIRMADO (comportamiento). `JWT_RE`/`BEARERY_RE` son `^…$`; los campos `error`/`detail` de `*ApiCallFailed`/`pollingError` guardan snippets de body sin estar en `SENSITIVE_KEYS`. Si el upstream refleja la credencial en el mensaje, persiste verbatim en el NDJSON. **Dirección:** redacción de sub-strings o sanear `error`/`detail`.

**M7 · `Retry-After` de Plane sin cota → cuelgue de request** — `providers/plane/client.js:62-63`. CONFIRMADO. Solo la rama exponencial se acota (8s); un `Retry-After: 100000` bloquea el `setTimeout` 100.000 s. `listPendingTasks` se awaitea en `/status` y `check.js` → congela el ciclo. **Dirección:** `Math.min(retryAfter*1000, 60_000)`.

**M8 · `listPendingTasks` de Plane no filtra por label `kodo`** — `providers/plane/provider.js:373-392` vs `github/provider.js:157`. CONFIRMADO. `check.js:39-43` cuenta "N pending kodo tasks" y puede lanzar el orquestador por tareas sin `kodo:`. **Dirección:** filtrar por kodo en el provider Plane.

**M9 · Paginación truncada a 100 en silencio** — `providers/plane/client.js:104-109`, `github/client.js:254-262`. CONFIRMADO. `per_page=100` sin seguir `next`/`Link`. **Dirección:** bucle de paginación o `log()` de truncamiento.

**M10 · Primer issue de un repo que arrancó vacío nunca se despacha** — `triggers/polling.js:332,391`. CONFIRMADO. Un primer tick vacío persiste cursor `{}`; el siguiente (primero con items) vuelve a la rama first-tick y solo puebla cursor sin despachar. **Dirección:** distinguir "cache ausente" de "primer tick observado" con un centinela.

**M11 · `PERSIST_FAILED` en adopt: el re-run "idempotente" duplica la tarea** — `adopt.js:245-296`. CONFIRMADO. El guard de idempotencia depende del write local que falló; si `createTask` tuvo éxito pero `addSession` lanzó, el re-run crea una segunda tarea Plane. **Dirección:** buscar por `task_url` antes de re-crear.

**M12 · Fases con em/en-dash invisibles al resolver** — `gsd/roadmap.js:31`. CONFIRMADO. El separador exige `:` o `-` ASCII; `## Phase 6 — Foundation` no matchea → `no-match` → no arranca, sin diagnóstico. **Dirección:** aceptar `[-–—]`.

**M13 · Divergencia de ubicación de worktree: doctor limpia el sitio equivocado** — `gsd/doctor.js:164` (`.bg-shell/<id>`) vs `gsd/verify.js:27-29` + `state.js:176` (`.claude/worktrees/<id>`). PLAUSIBLE. Si el worktree real vive en `.claude/worktrees/`, el barrido de doctor es un no-op perpetuo y el collision-check valida un path que `claude --worktree` no usa. **Dirección:** confirmar empíricamente y unificar la fuente de verdad.

**M14 · `config --set`/`--map-project` truncan valores con `=`/`:`** — `cli.js:36,49`. CONFIRMADO. `--set token=a=b=c` guarda `a`; `--map-project 123:/p:x` rompe la ruta. **Dirección:** `slice(1).join(sep)`.

**M15 · El daemon de `up` descarta stdout/stderr (crash sin rastro)** — `cli/up.js:207` vs `cli/polling.js:274-299`. CONFIRMADO. `startDaemon('kodo', …)` sin `_logFd` → stdio `ignore` → /dev/null. **Dirección:** pasar `_logFd` desde `up`.

**M16 · `loadConfig` escribe disco de forma no atómica en la migración v1→v2** — `config.js:145-164`. CONFIRMADO. `migrateConfigIfNeeded` usa `writeFileSync` directo dentro de un "load"; un crash a mitad trunca `config.json` → siguiente load cae a DEFAULT_CONFIG. **Dirección:** migrar vía `writeFileAtomic`.

**M17 · Doble sesión no-GSD cross-proceso** — `dispatcher.js:16,138,423`, `manager.js:171-298`. CONFIRMADO. El dedup real es el `Set inFlight` per-proceso + guard de sesión persistida; para no-GSD no hay lock. `kodo launch` (CLI) y el webhook (server) son procesos distintos. **Nota:** dentro de un mismo proceso el guard sí funciona (run-to-completion). **Dirección:** dedup por `task_id` con lock también para no-GSD.

**M18 · El health checker periódico no existe; el README anuncia "cada 60s"** — `session/health.js` (todo), README:281-286. CONFIRMADO. `startHealthLoop` no tiene llamadores; `checkHealth` solo corre bajo `kodo check` (y con `.catch(()=>[])` que enmudece errores). **Dirección:** cablear el loop o borrar el código muerto y corregir el README.

**M19 · El stop hook dispara efectos por turno** — `hooks/stop.js:157,166,235-242`. CONFIRMADO. En cada turno colorea el workspace a `review`, emite `notify` "cerrada" y nudgea al orquestador "ha terminado" — mientras la sesión sigue viva. **Dirección:** condicionar los efectos de cierre a `SessionEnd`, no a `Stop`.

**M20 · Arranque concurrente de `polling start` deja un daemon huérfano** — `cli/polling.js:259-303`. CONFIRMADO. Check-then-spawn sin lock; sin puerto no hay `EADDRINUSE` que aborte al segundo. **Dirección:** lock `O_EXCL` de arranque.

**M21 · `execFileSync` en el reconcile bloquea el event loop del server** — `reconcile.js:337-345`, `cmux/client.js`. CONFIRMADO. Cada tick (2.5s) corre síncronamente `cmux workspace list` + `notification.list` + un `pgrep` por sesión en el mismo proceso que sirve HTTP. **Dirección:** variantes async o reconcile en proceso aparte.

### BAJA

- **B1 · `kodo:opus` no se reconoce como modelo** — `labels.js:29-33`. CONFIRMADO. El whitelist es solo `sonnet`/`haiku`; `opus` cae a `flags` (inerte). Latente si el default cambia. **Dirección:** incluir `opus`.
- **B2 · `PlaneClient` referencia el schema v1 eliminado** — `providers/plane/client.js:8,10,14`. CONFIRMADO (latente). `config.plane.*` es siempre `undefined` tras la migración; un `new PlaneClient()` con opción faltante lanza `TypeError` críptico, y el mensaje de error amigable (línea 14) es inalcanzable. Los 3 llamadores pasan todas las opciones. **Dirección:** leer `config.providers.plane.*`.
- **B3 · `verified > total` produce PASS** — `gsd/verification.js:213-241`. CONFIRMADO. La condición es `verified < total` (no `!==`); `99/3` pasa. **Dirección:** `verified !== total` → malformed.
- **B4 · matching de VERIFICATION.md acoplado a zero-pad de 2 dígitos** — `gsd/verify.js:136-181`. BAJA. `06-slug` vs `6-slug` → `missing` falso. **Dirección:** normalizar ambos lados.
- **B5 · Parser `.env` diverge de dotenv** — `config.js:12-28`. CONFIRMADO. No hace strip de comillas; `PLANE_API_KEY="x"` guarda las comillas → 401 sin explicación. **Dirección:** documentar o strip conservador.
- **B6 · Path traversal en `kodo logs`** — `logs/reader.js:66`. CONFIRMADO (auto-infligido). `sessionId` crudo del argv sin validar. **Dirección:** validar `/^[A-Za-z0-9_-]+$/`.
- **B7 · `loadConfig` no hace deep-merge de defaults ni valida** — `config.js:155-164`. CONFIRMADO. Config parcial llega verbatim; `max_parallel:-5` se carga sin control. **Dirección:** deep-merge + validación en `loadConfig`.
- **B8 · `parseRef` rechaza identificadores con dígitos** — `providers/plane/client.js:290`. PLAUSIBLE. `^([A-Z]+)-(\d+)$` rechaza `K2-42`. **Dirección:** `^([A-Za-z][A-Za-z0-9]*)-(\d+)$`.
- **B9 · `install/uninstall` casan por `command.includes('kodo')`** — `hooks/install.js:82,111`. CONFIRMADO. Demasiado amplio: `uninstall` borraría un hook ajeno con "kodo" en la ruta; `install` deja rutas obsoletas si mueves el repo. **Dirección:** match por ruta canónica.
- **B10 · Mensajes de error 500 filtran `err.message` crudo** — `server.js:584`, `server/dismiss.js:139`. CONFIRMADO. **Dirección:** genérico al cliente, detalle al log.
- **B11 · `follow.js` puede re-emitir líneas duplicadas** — `logs/follow.js:61-64`. PLAUSIBLE. **Dirección:** que `drainFrom` devuelva su offset.
- **B12 · Otros:** YAML inline comments rompen el parser de verification (fail-closed); `throttle` proactivo asume epoch en `x-ratelimit-reset`; `createLabel` 409-detection amplia (mitigado); factory GitHub sin bloque `github` lanza `TypeError` en vez del mensaje canónico (`registry.js:60-72`).

---

## 3. Tensiones de diseño (las 5 más profundas)

**T1 · `state.json` como base de datos compartida sin gestor de concurrencia.** El sistema es de-facto multiproceso pero trata `state.json` como si tuviera un único escritor — hasta afirmarlo en comentarios. El "rescate desde history" del reconcile es un epiciclo para tapar la carrera. *Alternativa:* lock advisory de escritura, o mover toda mutación a un solo proceso (hooks POSTeando al server).

**T2 · Dos fuentes de verdad para la vida de una sesión: `status` (legacy) y `state` (v3).** `reconcile` opera sobre `state`/`alive`; `max_parallel`/`check`/`health` sobre `status`; nada los sincroniza → zombis que filtran capacidad (A4). *Alternativa:* colapsar a un campo derivado, o puente explícito `state→status`.

**T3 · El modelo de seguridad delega 100% en el aislamiento de red, pero el código no lo materializa.** Bind `0.0.0.0`, un solo endpoint autenticado, un `DELETE` destructivo abierto, `/logs` con payloads crudos. *Alternativa:* bind a loopback/IP-tailscale + token compartido en todo lo que no sea `/webhook`.

**T4 · `fire-and-forget` uniforme para webhook y polling, ignorando que solo el webhook tiene re-entrega.** El polling avanza un cursor que crea obligación de entrega y no reintenta (A7). *Alternativa:* confirmar el dispatch antes de avanzar el cursor.

**T5 · La responsabilidad del ciclo de vida migró del código mecánico al LLM sin cerrar el fallback.** La transición a Review, los comentarios de cierre y (parcialmente) la limpieza dependen de que el modelo ejecute instrucciones. Si la sesión crashea, la tarea queda en "In Progress". *Alternativa:* backstop mecánico en `SessionEnd`/reconcile.

---

## 4. Brechas de expectativa (esperaba X, encontré Y)

- **Doc:** el README describe un stop hook que "lee 30 líneas, comenta el cierre y mueve a In Review" → el hook no toca el provider; lo hace el LLM (o nadie).
- **Doc:** `kodo status` "ver sesiones activas" → ahora es un booleano de vida del daemon; las sesiones viven en `kodo dashboard` (indocumentado).
- **Doc:** `src/plane/client.js` → la ruta real es `src/providers/plane/client.js`; `skills/` → `.claude/skills/`; `install` registra "2 hooks" → registra 3; owner `deikka/kodo` (README) vs `kintsugi-lab-sca/kodo` (formula/packaging); PLAN.md stale (`default_model: sonnet` cuando es `opus`); ~10 comandos (`up`, `dashboard`, `adopt`, `comment`, `logs`, `gsd*`, `skill`, `polling`) sin documentar.
- **Affordance:** `kodo up --url` promete redirigir el visor → es swallowed en `deps` (código muerto).
- **Affordance:** el "health checker cada 60s" → no hay loop; solo `kodo check` on-demand, con errores tragados.
- **Affordance:** `kodo config --set` acepta cualquier key → prototype pollution y truncado en `=`.
- **Seguridad (positivo):** esperaba inyección de shell vía título de tarea → refutado (`execFile` + prompt-file); esperaba fuga de secretos en el dashboard → refutado (PERSIST-04 sólido); esperaba bypass de HMAC → refutado (fail-closed correcto).
- **DX:** un recién llegado que siga el README literalmente configura un webhook, espera comentarios de cierre automáticos que nunca llegan, ejecuta `kodo status` esperando sesiones y no las ve, y busca `src/plane/client.js` que no existe.

---

## 5. Preguntas abiertas (para el mantenedor)

1. **¿Kodo corre alguna vez como múltiples procesos contra el mismo repo/estado?** De la respuesta depende si A2/A3/A5/M17/M20 son explotables hoy o solo latentes.
2. **¿Hay ACLs de Tailscale que restrinjan `:9090` al nodo de Plane?** Si no, A1/M2 son exposición real a toda la tailnet/LAN.
3. **¿Dónde viven realmente los worktrees huérfanos — `.bg-shell/` o `.claude/worktrees/`?** Determina si el barrido de `doctor` (M13) sirve o es letra muerta.
4. **¿`x-ratelimit-reset` de Plane self-hosted es epoch o delta?** Decide si el throttle proactivo actúa o es no-op, y agrava M7.
5. **¿El polling se soporta con algún provider que no sea GitHub?** El filtro `projectId === "owner/repo"` degrada a silencio con Plane.
6. **¿Cuál es el marcador robusto de "sesión orquestadora"?** Sin él, A8 (auto-commit) se dispara para cualquier `claude` en el repo.
7. **¿Es intencional que toda sesión GSD corra con `--dangerously-skip-permissions`** (`manager.js:318`) sin documentarlo junto a `kodo:yolo`?
8. **¿Se acepta explícitamente perder tareas en polling ante fallo de `launchWorkItem`** (A7), o el cursor se pensó solo para crashes?

---

**Cobertura:** CLI/daemon/polling, server/webhook, session/host/orquestador, providers Plane/GitHub, triggers/adopt, dashboard Ink completo, GSD (doctor/verify/lock/roadmap), config/secretos/logging, hooks/skill-sync y docs/packaging — leídos sin muestreo.

**Prioridad de arreglo a corto plazo:** A1 (bind + auth), A2/A3 (locks de concurrencia), A4 (zombis de capacidad) y la tanda de deriva documental del README.
