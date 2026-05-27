# Phase 35: Datos — cliente HTTP + polling - Context

**Gathered:** 2026-05-27
**Status:** Ready for planning

<domain>
## Phase Boundary

El panel obtiene y refresca las sesiones desde el server de forma resiliente: cliente HTTP
puro que **nunca lanza**, loop de polling self-scheduling que **no apila** requests, y
degradación elegante (keep-last-good + backoff) cuando el server no responde — incluida una
respuesta JSON corrupta.

Cubre **TUI-05** (poll self-scheduling cada ~2.5s, una request en vuelo) y **TUI-06**
(server caído al arrancar/a mitad → estado claro, keep-last-good, backoff, recuperación; JSON
corrupto tratado como poll fallido).

**Superficie visible de esta fase:** `App.js` reemplaza el placeholder estático `starting…` de
Phase 34 por una **status line viva** — indicador de conexión + contador `N sessions` + banner
de estado de degradación. **NO** se renderiza la tabla columnar (`task_ref · repo · phase/mode ·
status · age`), selección, orden estable, color por estado, contadores "live" ni filtros — todo
eso es **Phase 36**. Esta fase deja el dato fluyendo y observable, no la presentación final.

**Fuera de esta fase (fases posteriores):** tabla/selección por `task_id`/filtros + header de
contadores (Phase 36), attach a cmux (Phase 37), overlays de comentarios/logs (Phase 38).

</domain>

<decisions>
## Implementation Decisions

### Superficie visible tras Phase 35 (TUI-06 observable)
- **D-01:** `App.js` reemplaza `starting…` por una **status line mínima viva**: indicador de
  conexión (`● live` cuando el último poll fue ok / `⚠ server caído` cuando falla), contador
  `N sessions` (desde `data.count` / `data.sessions.length` del payload `/status`), y banner de
  degradación. Sin tabla columnar — esa es Phase 36. Mockup aprobado:
  ```
  kodo dashboard            ● live

    3 sessions

    q quit

  --- server cae ---
  kodo dashboard            ⚠ server caído

    3 sessions (last update 8s ago, retrying…)

    q quit
  ```
- **D-02:** Se descartó la opción "headless" (solo `client.js`+`usePoll.js`+tests) porque
  contradice los criterios de éxito observables de la fase: TUI-06 exige que "el dashboard
  *muestra* estado 'server caído'" y el criterio #1 habla de refresco visible. También se descartó
  la "lista cruda" para no invadir la capa de presentación de Phase 36 con código desechable.

### Cadencia de polling + backoff (TUI-05)
- **D-03:** Intervalo **base = 2.5s** (research-aligned; más suave que el "~2s" del seed sobre un
  `/status` caro). Loop **self-scheduling** con `setTimeout` recursivo: el siguiente tick se
  programa SOLO tras resolver (o abortar) el actual → una request en vuelo a la vez, nunca
  `setInterval`.
- **D-04:** **Backoff** ante fallos consecutivos duplicando con **cap a 10s** (`2.5 → 5 → 10`,
  estable en 10s). **Reset a 2.5s** al primer poll exitoso. Nunca más rápido que la base.
- **D-05:** **Timeout de fetch = 5s** vía `AbortController` (`signal` + `setTimeout(abort, 5000)`).
  Generoso a propósito: como hay single-flight, un poll lento solo retrasa el siguiente (no
  apila), así que conviene no abortar polls legítimamente lentos cuando el cache de
  `listPendingTasks` expira y `/status` tarda. Re-crear el controller cada tick.

### UX de degradación / "server caído" (TUI-06)
- **D-06:** **Dos estados** distintos de degradación, no uno: (a) **`waiting for server`** —
  arranque sin ningún dato bueno todavía (primer `/status` falla, ECONNREFUSED); (b) **`stale,
  retrying`** — ya hubo al menos un poll ok y el server cayó a mitad → **keep-last-good** (se
  conserva el último `count`/sessions, NO se blanquea) + banner de reintento.
- **D-07:** **Copy unificado** para todos los fallos: ECONNREFUSED, HTTP 5xx y JSON corrupto se
  tratan igual a nivel de mensaje ("server caído" / "retrying…"). No se varía el texto por clase
  de error (el research dice que la clase informa la recuperación, no necesariamente el copy).
  JSON corrupto/HTTP no-ok → poll fallido vía el discriminante `{ok:false}`, jamás un throw que
  llegue a React.
- **D-08:** La edad mostrada (`last update Ns ago`) se **recalcula en cada intento de poll**, NO
  con un timer de 1s. Evita forzar re-renders cosméticos por segundo (Pitfall 8). Acepta que la
  edad "salta" en pasos de ~2.5–10s según la cadencia/backoff.

### Late-response guard (TUI-05)
- **D-09:** **No** se implementa el guard de tick-id monotónico que sugiere el research. Con el
  loop self-scheduling estricto (≤1 request en vuelo) ninguna respuesta tardía puede pisar datos
  frescos, porque siempre se `await` antes de programar el siguiente tick. El teardown se cubre
  con un **flag `cancelled`** en el cleanup del `useEffect` + **abort-on-unmount** del controller.
  El tick-id sería código muerto (YAGNI) salvo que en el futuro se permitiera solapamiento.

### Hardening arrastrado de Phase 34
- **D-10:** Cerrar el **advisory WR-01** de `34-REVIEW.md`: `loadConfig().server.port` sin guardia.
  Phase 35 es donde el cliente consume el `baseUrl`, así que el guard de `server.port` undefined
  (fallback al default 9090, ver `src/config.js:62-66`) debe quedar resuelto en esta fase.

### Claude's Discretion
- Partición fina de `client.js` (¿una función por endpoint ya, o solo `fetchStatus` en esta fase
  y `fetchComments`/`fetchLogs` se añaden en Phases 36/38? — el research las lista todas en
  `client.js`, pero Phase 35 solo necesita `fetchStatus`).
- Forma exacta del hook `usePoll` (firma, dónde vive el estado de backoff/connection — dentro del
  hook vs en `App`), siempre respetando D-03/D-04/D-05/D-09.
- Profundidad de la validación de shape del payload antes de usarlo — el research recomienda
  mínima (`Array.isArray(payload.sessions)`); el planner decide si añade más.
- Markup exacto de la status line (uso de `<Box>`/`<Text color>`) mientras respete D-01 y la
  invariante de color-isolation (color SOLO de ink, cero `picocolors`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (patrones, pitfalls — verificados contra el codebase)
- `.planning/research/ARCHITECTURE.md` — Pattern 1 (cliente puro never-throws `{ok,data}`),
  Pattern 2 (`usePoll` self-scheduling, NO `setInterval`), Data Flow "Poll → render", Build Order
  pasos 1+3, Testability Map (tier pure unit + pure-ish para `usePoll`). Anti-Pattern 3
  (`setInterval`).
- `.planning/research/PITFALLS.md` — Pitfall 2 (request stacking + AbortController + timeout),
  Pitfall 5 (server-down startup vs mid-session + keep-last-good + backoff), Pitfall 9 (cleanup:
  clear timer + abort en unmount), Pitfall 11 (DI clock+fetch para tests hermético), Pitfall 12
  (JSON corrupto → poll fallido). Pitfall-to-Phase: filas 2, 5, 12 = P-poll = esta fase.
- `.planning/research/STACK.md` — `ink@6.8.0` + `react@19.2`, `fetch` built-in (sin dep nueva),
  sin build step.

### Requirements + roadmap
- `.planning/REQUIREMENTS.md` — TUI-05, TUI-06 (Datos/polling, Phase B), Out of Scope.
- `.planning/ROADMAP.md` §"Phase 35" — Goal, Success Criteria (4), Stack invariants no negociables
  (poll self-scheduling con `setTimeout`, NO `setInterval`; keep-last-good).

### Codebase (verificado en scout)
- `src/server.js:361-413` — handler `GET /status`: shape del payload
  (`{sessions:[{...,alive,elapsed_min}], count, pending, pending_count, history, metrics, uptime}`);
  await de `provider.listPendingTasks()` (TTL-cached) + `cmux.listWorkspaces()` → endpoint **caro/lento**.
  **READ ONLY — cero endpoints nuevos.**
- `src/config.js:62-66` — `server.port: 9090` default; el cliente construye `baseUrl` desde aquí
  salvo override `--url` (resuelto ya en `index.js` de Phase 34). Guard WR-01 (D-10).
- `src/cli/dashboard/index.js`, `src/cli/dashboard/App.js` — entry + root component existentes de
  Phase 34 (placeholder `starting…` a reemplazar por la status line).
- `test/format-isolation.test.js` — walker de color-isolation ya extendido a `src/cli/dashboard/`
  en Phase 34; los nuevos archivos (`client.js`, `usePoll.js`) no deben importar `picocolors`.
- `.planning/phases/34-fundacion-subcomando-ciclo-de-vida/34-CONTEXT.md` — decisiones de
  fundación (D-05 `--url`, D-12 color-isolation) que esta fase preserva.
- `.planning/phases/34-fundacion-subcomando-ciclo-de-vida/34-REVIEW.md` — advisory WR-01 (D-10).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/dashboard/index.js` (`runDashboard`) — ya resuelve `baseUrl` (config + `--url`) y hace
  `render()`. El cliente HTTP recibe ese `baseUrl`; `fetch` (global Node 20+) inyectable para tests.
- `src/cli/dashboard/App.js` — root ink component de Phase 34; aquí se cablea `usePoll` + el estado
  (`connected`, `lastError`, `lastGoodCount`/sessions, `lastUpdateAt`) y se renderiza la status line.
- `loadConfig()` (`src/config.js`) — `server.port` default 9090 (con guard WR-01, D-10).

### Established Patterns
- **Pure helpers + DI for testability** (Key Decision del proyecto; el test runner de Node carece
  de `mock.module`): `client.js` toma `fetchFn = globalThis.fetch`; `usePoll` toma clock/intervalo
  inyectables. Tests con fake fetch (fixtures + throw) y fake timer — sin red, sin TTY.
- **Cliente devuelve objetos resultado, no excepciones**: `{ok:true,data}` / `{ok:false,error}`.
  El invariante "no crash" es estructural en `client.js`, no en los componentes.
- **Color-isolation**: cero `picocolors` bajo `src/cli/dashboard/**`; color solo de `<Text color>`.
- **Lazy import** del módulo dashboard desde `src/cli.js` (Phase 34) — no se toca.

### Integration Points
- `src/cli/dashboard/client.js` (NUEVO) — `fetchStatus(baseUrl, fetchFn?)` puro, never-throws.
- `src/cli/dashboard/usePoll.js` (NUEVO) — hook self-scheduling cancelable (D-03/04/05/09).
- `src/cli/dashboard/App.js` (MODIFICADO) — consume `usePoll(fetchStatus, …)`, mantiene
  keep-last-good + connection/backoff state, renderiza la status line (D-01).
- `src/server.js` — **NO se modifica** (constraint dura del milestone).
- Tests nuevos: cliente (fixture + throw + JSON corrupto → `{ok:false}`), `usePoll`
  (single-flight: fetch lento → solo 1 en vuelo; teardown limpia timer+abort; backoff sube y
  resetea), App status line (ink-testing-library: `lastFrame()` muestra `live` / `server caído` /
  keep-last-good tras succeed×2-then-throw).

</code_context>

<specifics>
## Specific Ideas

- Status line aprobada por el usuario (mockup en D-01): `● live` / `⚠ server caído` a la derecha
  del título, `N sessions` en el cuerpo, y `(last update Ns ago, retrying…)` junto al contador
  cuando está stale.
- Test load-bearing de TUI-06: fetch que tiene éxito ×2 y luego lanza → las filas/contador se
  **conservan** (keep-last-good) y el flag de conexión pasa a stale (Pitfall 5).
- Test load-bearing de TUI-05: fetch lento inyectado → assert que solo hay **una** request en
  vuelo (no stacking) y que el siguiente tick no arranca hasta resolver el actual.

</specifics>

<deferred>
## Deferred Ideas

- Tabla columnar (`task_ref · repo · phase/mode · status · age`), selección por `task_id`, orden
  estable por `started_at`, color por `status`+`alive`, header con contadores "live" y filtros
  (`/`, `r:`, `s:`) — **Phase 36** (TUI-07..TUI-12).
- `fetchComments`/`fetchLogs` en `client.js` — se añaden cuando los consuman Phase 38 (TUI-15/16);
  Phase 35 solo necesita `fetchStatus`.
- Guard de tick-id monotónico — descartado por YAGNI (D-09); reconsiderar solo si alguna vez se
  permite solapamiento de requests.
- Copy diferenciado por clase de error (ECONNREFUSED vs 5xx vs JSON) — descartado (D-07) a favor
  de un único mensaje honesto.

</deferred>

---

*Phase: 35-datos-cliente-http-polling*
*Context gathered: 2026-05-27*
