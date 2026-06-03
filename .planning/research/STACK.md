# Stack Research

**Domain:** Node.js CLI — hygiene/cleanup utility + read-write TUI + cross-system task-state enrichment (kodo v0.10)
**Researched:** 2026-06-03
**Confidence:** HIGH

## Veredicto (TL;DR)

**No añadas ninguna dependencia nueva. Las 3 features se construyen al 100% con la stack
actual (4 deps prod) + APIs nativas de Node 20+ que ya están en uso en el código.**

Las tres preguntas del downstream tienen la misma respuesta, fundamentada en patrones que
**ya existen en producción** en este repo:

| Pregunta | Respuesta | Patrón ya presente en el código |
|----------|-----------|---------------------------------|
| (a) ¿lib para git worktree introspection/cleanup? | **No.** `execFile`/`execFileSync` de `node:child_process` | `src/hooks/stop.js` ya hace `execFileSync('git', ['-C', cwd, 'worktree', 'remove'\|'move'\|'repair', …])` con `gitFn` DI |
| (b) ¿componente ink extra (ink-text-input / confirm)? | **No.** `useInput` mode-gated + `<Text>` | `src/cli/dashboard/App.js` ya enruta teclas por sub-modo (`list`/`filter`/`overlay`); la confirmación `d` es un sub-modo más (`confirm`), no captura texto libre |
| (c) ¿lib de concurrency-limit / cache para N×getTaskState? | **No.** `Promise.allSettled` + `Map` TTL casero | `src/server.js` ya hace `sessions.map(...)` en `GET /status`; N es pequeño (sesiones kodo activas, decenas como mucho) |

Esto es coherente con la Constraint declarada en `PROJECT.md` ("mínimas dependencias
externas") y con la Key Decision histórica "Interfaz en JS puro con JSDoc, sin build step".
Cada dep que NO añadimos se justifica abajo con su versión actual real.

## Recommended Stack

### Core Technologies (todo YA en el repo — cero cambios a `package.json`)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | `>=20.0.0` (engines actual) | Runtime | `node:child_process`, `node:fs`, `Promise.allSettled`, `Map`, `AbortController` cubren las 3 features sin libs |
| `commander` | `^13.0.0` | Subcomando `kodo gsd doctor` + flags `--fix`/`--dry-run` | Ya parsea todo el CLI; el subcomando doctor se registra como cualquier otro |
| `ink` | `^6.8.0` | TUI read-write (tecla `d` + confirmación) | `useInput` + `<Text>` + `<Box>` bastan; ink@6 mantiene el floor Node ≥20 (ink@7 exigiría 22) |
| `react` | `^19.2.0` | Estado del sub-modo `confirm` en la TUI | `useState`/`useRef` ya gestionan `mode` y `overlayReqRef`; el confirm es estado idéntico |
| `picocolors` | `^1.1.1` | Color del output de `doctor` (no-TTY safe) | Vive SÓLO en `src/cli/format.js` (color isolation). `doctor` consume `createFormatter(stream)`; la TUI NO lo importa |

### APIs nativas de Node a usar (sin instalar nada)

| API nativa | Para qué feature | Patrón / precedente en el repo |
|------------|------------------|-------------------------------|
| `child_process.execFile` / `execFileSync` | DOCTOR — git worktree introspection + cleanup | `stop.js#gitFn` (worktree remove/move/repair); `focus.js` (cmux vía `exec` inyectado). Mismo patrón DI para testabilidad |
| `child_process` — `process.kill(pid, 0)` | DOCTOR — liveness de locks per-repo (PID muerto) | El lock per-repo (GSD-10) ya usa "PID liveness + TTL"; `doctor` reusa la misma comprobación, no la reinventa |
| `fs` (`readdirSync`, `statSync`, `rmSync`, `lstatSync`) | DOCTOR — worktrees huérfanos bajo `.bg-shell/`, logs NDJSON antiguos por mtime | `stop.js` ya usa `lstatSync` para discriminar ENOENT en el cleanup dirty (CR-03) |
| `Promise.allSettled` | PROVIDER-STATE — N sesiones × `getTaskState` fail-open | `server.js` ya mapea sesiones en `/status`; `allSettled` da el fail-open por-item gratis (un fallo de provider no tumba el enrichment) |
| `Map` + timestamp | PROVIDER-STATE — cache TTL casero del estado del provider | `usePoll.js` ya hace backoff con `setTimeout` recursivo + keep-last-good; un `Map<taskId,{state,ts}>` con TTL es el mismo nivel de complejidad |
| `useInput` (de ink) | DISMISS — tecla `d` + confirmación y/N | `App.js` ya tiene `useInput` mode-gated con sub-modos `list`/`filter`/`overlay`; `confirm` es el cuarto sub-modo |
| `fetch` (global, Node 18+) | PROVIDER-STATE — llamadas del provider en el server | `client.js` (`fetchStatus`) ya usa `fetch` global con `AbortController`; los adapters Plane/GitHub ya hacen REST |

## Notas de integración por feature

### (a) `kodo gsd doctor` — git worktree + locks + logs

- **Introspección de worktrees**: `git worktree list --porcelain` (con `execFile`) devuelve
  output parseable línea a línea — NO necesita una lib. Cruza el listado contra
  `.bg-shell/<sessionId>` y contra `state.json` para detectar huérfanos. Es exactamente el
  mismo verbo/familia que `stop.js` ya invoca (`worktree remove/move/repair`).
- **Cleanup**: reusa el patrón `gitFn` DI de `stop.js` (`execFileSync('git', ['-C', cwd, …])`)
  para que los tests inyecten handlers sync sin spawnear. **No introduzcas un wrapper distinto**
  — extrae/comparte el helper si conviene, pero el mecanismo ya está validado.
- **Locks colgados**: el lock per-repo (GSD-10) ya define "PID liveness + TTL". `doctor`
  detecta PID muerto con `process.kill(pid, 0)` (lanza ESRCH si no existe) + comparación de
  TTL contra el mtime/timestamp del lockfile. Cero deps.
- **Logs NDJSON antiguos**: `fs.readdirSync` + `statSync().mtime` sobre `~/.kodo/logs/`.
  Nota: el daemon de polling (v0.8) ya tiene retención 7 días + `0o600`; `doctor` debe ser
  consistente con esa convención, no contradecirla.
- **dry-run por defecto + `--fix`**: flags de `commander`, ya es como funciona todo el CLI.
  El output va por `createFormatter(stream)` (TTY-aware, `--json` byte-determinista) — NO
  imprimas ANSI inline (rompería la color-isolation blindada por `test/format-isolation.test.js`).

### (b) Dismiss (tecla `d`) — TUI read-write

- **No hace falta `ink-text-input` ni `ink-confirm-input`.** Esos componentes son para
  **capturar texto libre del usuario**. Aquí el flujo es: pulsar `d` sobre fila `alive===false`
  → mostrar prompt `Dismiss <task_id>? (y/N)` → leer **una sola tecla** (`y`/`n`/`Esc`).
  Eso es un `useInput` con un sub-modo `confirm`, idéntico en estructura al sub-modo `overlay`
  que `App.js` ya tiene. Añadir una lib de input sería sobreingeniería.
- **Guard inverso**: `d` sólo actúa sobre `alive===false` (espejo del guard de `Enter` que
  sólo actúa sobre `alive===true`, ya implementado en Phase 37). La fuente única de `alive`
  es el `reconcileTick` v3 (Phase 38/39.1) — consúmela, no recomputes estado.
- **Mutación**: `DELETE /sessions/{id}` ya existe. La TUI llama vía `fetch` (mismo `client.js`
  never-throws pattern). **Atención al invariante histórico** "TUI read-only — cero endpoints
  nuevos" de v0.9: este milestone lo **promueve conscientemente** a read-write (backlog 999.1);
  documenta la decisión, pero no necesitas un endpoint nuevo (el DELETE ya está).
- **Reuso de la lógica de doctor**: el dismiss debe invocar la misma rutina de saneo que
  `doctor` (worktree remove + state cleanup) — extrae esa lógica a un módulo puro/DI compartido
  para no duplicarla entre el CLI y el handler del server.

### (c) `provider_state` — enrichment N×getTaskState

- **`Promise.allSettled` + `Map` TTL casero es la respuesta correcta**, no `p-limit`/`p-queue`/`lru-cache`:
  - **Concurrencia**: N = sesiones kodo activas (decenas en el peor caso real, no miles).
    Plane/GitHub REST con esa cardinalidad por poll no satura nada. `p-limit` resuelve un
    problema (limitar cientos/miles de promesas simultáneas) que kodo **no tiene**. Si el
    rate-limit de GitHub preocupara, el `GitHubClient` ya hace etag/304 + warn cuando
    `X-RateLimit-Remaining < 100` (v0.7) — esa es la mitigación correcta, no una cola.
  - **Cache**: un `Map<taskId, {state, fetchedAt}>` con chequeo de TTL (p.ej. 30-60s) es ~15
    líneas. `lru-cache` aporta evicción por tamaño/LRU que aquí es innecesaria (el universo de
    taskIds activos es acotado y se purga al cerrar sesiones). Añadir `lru-cache@11` por un Map
    con TTL contradice la Constraint de deps mínimas.
  - **Fail-open**: `allSettled` da exactamente la semántica pedida — cada `getTaskState` que
    rechace queda `{status:'rejected'}` y se degrada a "estado desconocido" sin tumbar `/status`.
    Esto refleja el patrón fail-open ya usado en `fetchStatus`/`fetchComments`/`fetchLogs`.
- **Contrato TaskProvider 9→10 métodos**: `getTaskState(taskId)` se añade a
  `TASK_PROVIDER_METHODS` en `src/interface.js`. El registry (`src/providers/registry.js`)
  ya valida que cada provider implemente todos los métodos — añadir el 10º es aditivo. Plane
  y GitHub lo implementan; el resto del contrato no cambia.
- **Dónde cachear**: el server (`src/server.js`, en el handler de `GET /status`) es el sitio
  natural — vive en el proceso largo, los 0-token, y ya mergea estado cmux server-side
  (`alive`, `elapsed_min`). El cache no debe vivir en la TUI (efímera, re-arranca limpia).

## Alternatives Considered

| Recommended | Alternative | Versión actual | When to Use Alternative |
|-------------|-------------|---------------|-------------------------|
| `execFile` + parse `--porcelain` | `simple-git` | `3.36.0` | Sólo si kodo necesitara docenas de operaciones git de alto nivel (diff parsing, blame, log estructurado). Para `worktree list/remove/move`, la API nativa que el repo ya usa es más simple y ya está validada |
| `useInput` sub-modo `confirm` | `ink-confirm-input` | `2.0.0` | Nunca para este caso (1 tecla y/N). Útil si necesitaras un campo de confirmación con texto editable (p.ej. teclear el nombre a borrar) — no es el caso |
| `useInput` (lectura de tecla) | `ink-text-input` | `6.0.0` | Sólo si una feature futura pidiera **texto libre** en la TUI (p.ej. añadir un comentario inline). El filtro `/` actual ya se resuelve con `useInput` puro, así que no hay precedente de necesitarlo |
| `Promise.allSettled` | `p-limit` | `7.3.0` | Si N escalara a cientos/miles de fetches concurrentes por poll. Cardinalidad real de kodo (sesiones activas) lo hace innecesario |
| `Promise.allSettled` | `p-queue` | `9.3.0` | Si necesitaras priorización/rate-limiting/pausas entre tareas. Overkill para enrichment fire-and-forget por poll |
| `Map` + TTL manual | `lru-cache` | `11.5.1` | Si el universo de claves fuera ilimitado y necesitaras evicción por tamaño. El conjunto de taskIds activos es acotado y auto-purgable |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `simple-git` | +1 dep prod (y su árbol) para 3-4 verbos git que `execFile` ya cubre con DI testable | `execFileSync('git', ['-C', cwd, 'worktree', …])` reusando el patrón `gitFn` de `stop.js` |
| `ink-text-input` / `ink-confirm-input` | El dismiss lee 1 tecla (y/N), no texto libre; rompería la simplicidad del `useInput` mode-gated | Sub-modo `confirm` en el `useInput` existente de `App.js` |
| `p-limit` / `p-queue` | Resuelven concurrencia masiva que kodo no tiene (N = decenas); añaden dep prod | `Promise.allSettled(sessions.map(s => provider.getTaskState(s.task_id)))` |
| `lru-cache` | Evicción LRU/por-tamaño innecesaria para un set acotado de taskIds activos | `Map<taskId,{state,fetchedAt}>` con chequeo de TTL inline (~15 LOC) |
| `node-cache` / `memory-cache` | Mismo problema que lru-cache + menos mantenidas | `Map` casero con TTL |
| ANSI inline (`\x1b[…`) en `doctor` o en la TUI | Rompe la color-isolation (única fuente `src/cli/format.js`), blindada por `test/format-isolation.test.js` | `createFormatter(stream)` en el CLI; `<Text color>` de ink en la TUI |
| Endpoint nuevo en `src/server.js` para el dismiss | `DELETE /sessions/{id}` ya existe | Reusar el DELETE existente desde la TUI vía `fetch` |

## Stack Patterns by Variant

**Si el rate-limit de GitHub se vuelve un problema con muchas sesiones:**
- NO añadas `p-limit`. Reusa el etag/304 conditional fetch del `GitHubClient` (v0.7) + el
  cache TTL para reducir llamadas; sube el TTL del cache antes que limitar concurrencia.
- Porque la causa real sería "demasiados fetches repetidos", no "demasiados simultáneos".

**Si `git worktree list` resultara insuficiente para detectar todos los huérfanos:**
- Cruza tres fuentes: `git worktree list --porcelain`, el contenido de `.bg-shell/` (`readdirSync`),
  y `state.json` (sessions + history). Un huérfano es un dir en `.bg-shell/` sin sesión viva
  Y/O un worktree git sin entrada en state. Sigue sin necesitar libs.
- Porque la detección es un set-diff entre tres listas locales, no una operación git compleja.

**Si la confirmación del dismiss necesitara más que y/N en el futuro:**
- Reevalúa `ink-text-input@6` SÓLO en ese momento. Hoy YAGNI.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `ink@^6.8.0` | Node `>=20` | ink@6 es el floor correcto; ink@7 exigiría Node 22 y rompería el engines actual. NO subir |
| `react@^19.2.0` | `ink@6` | Pareja ya validada en v0.9 (1073 tests verdes). `useState`/`useRef` para el sub-modo confirm no requieren nada nuevo |
| `node:child_process` | Node `>=20` | `execFile`/`execFileSync`/`process.kill(pid,0)` estables; sin polyfills |
| `Promise.allSettled` | Node `>=20` | Nativo desde Node 12.9; cero riesgo |
| `fetch` global | Node `>=20` | Estable (sin flag) desde Node 18; ya usado en `client.js` |

## Sources

- `package.json` + `node_modules/` del repo — stack prod actual confirmado (commander, ink@6, picocolors, react@19; devDep ink-testing-library@4) — HIGH
- `src/hooks/stop.js` — patrón `gitFn` DI con `execFileSync('git', ['-C', …, 'worktree', …])` ya en producción (worktree remove/move/repair) — HIGH
- `src/cli/dashboard/App.js` — `useInput` mode-gated (`list`/`filter`/`overlay`) + estado `useState`/`useRef`; sin componentes de input de terceros — HIGH
- `src/cli/dashboard/focus.js` — patrón `exec` inyectado fire-and-forget never-throws (precedente para cleanup vía execFile) — HIGH
- `src/server.js` — `GET /status` ya hace `sessions.map(...)` server-side; punto natural del enrichment + cache — HIGH
- `src/providers/registry.js` + `src/providers/github/provider.js` — `TASK_PROVIDER_METHODS` validados por el registry; añadir 10º método es aditivo — HIGH
- npm registry (consultado 2026-06-03) — versiones actuales de las deps NO recomendadas: p-limit 7.3.0, p-queue 9.3.0, lru-cache 11.5.1 (engines `20 || >=22`), simple-git 3.36.0, ink-text-input 6.0.0, ink-confirm-input 2.0.0 — HIGH
- `.planning/PROJECT.md` — Constraints ("mínimas dependencias externas"), color-isolation invariant, lock per-repo PID+TTL (GSD-10), reconcileTick único escritor de `alive`, "TUI read-only — cero endpoints nuevos" (promovido a read-write en v0.10) — HIGH

---
*Stack research for: Node.js CLI hygiene/cleanup + read-write TUI + cross-system task-state enrichment*
*Researched: 2026-06-03*
