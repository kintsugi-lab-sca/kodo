# Project Research Summary

**Project:** kodo v0.9 — `kodo dashboard` (ink TUI para sesiones en vivo)
**Domain:** Terminal UI subcommand sobre un CLI Node.js ESM existente
**Researched:** 2026-05-26
**Confidence:** HIGH

## Executive Summary

`kodo dashboard` es un subcomando interactivo que monta un panel TUI de ink (React-for-CLI) directamente sobre el CLI existente de kodo, consumiendo exclusivamente los endpoints HTTP que ya existen (`/status`, `/logs`, `/comments/<task_id>`). El patrón establecido por herramientas comparables (k9s, lazygit, btop) es: tabla principal con auto-refresh de ~2s, selección por identidad estable (no por índice), overlays a pantalla completa para vistas de detalle, y handoff completo del TTY para adjuntar a un proceso hijo interactivo. La investigación confirma que todos esos patrones son directamente aplicables a ink con las primitivas nativas del framework (`unmount()`, `waitUntilExit()`, `spawn` con `stdio:'inherit'`).

La decisión de stack más crítica es **`ink@6.8.0` + `react@19.2.x`**: ink@7 (npm `latest`) exige Node `>=22`, lo que elevaría el floor del proyecto por encima del `>=20` declarado en `engines`. El segundo invariante no negociable es **`React.createElement` en `.js` plano, sin paso de build** — la alternativa (loader JSX) introduce una dep de runtime y cambia cómo se invoca el binario, contradiciendo la cultura "no build step" del proyecto. La expansión neta de deps de producción queda en 2 → 5 (`ink`, `react`, `ink-text-input`), más 2 devDeps (`ink-testing-library`, `@types/react`).

Los tres riesgos mayores son: (1) el handoff TTY a `cmux attach` — si se spawna mientras ink aún tiene el TTY en raw mode la terminal queda rota, y el patrón correcto (unmount → waitUntilExit → spawn → re-render) debe ser su propio bloque de trabajo con UAT manual; (2) tres contratos de datos del servidor que redefinen el alcance; (3) la invariante de color-isolation (`picocolors` single-source en `test/format-isolation.test.js`) que el TUI no debe romper — ink provee su propio sistema de color y ningún archivo bajo `src/cli/dashboard/` debe importar `picocolors`.

---

## Key Findings

### Recommended Stack

El stack mínimo honesto para un TUI ink dentro de kodo es: `ink@^6.8.0` + `react@^19.2.0` (peer obligatorio — ink no lo bundlea) + `ink-text-input@^6.0.0` (input de texto para el filtro `/`). `ink-table` está verificado como abandonado (versión `0.0.0-development`, CJS, peerDeps de React 16) y debe evitarse; la tabla se implementa a mano con `<Box>`/`<Text>` (~40 LOC de columnas de ancho fijo). No se necesita cliente HTTP — Node 20+ incluye `fetch` global con `AbortController`. El handoff de `cmux attach` usa `node:child_process` nativo, no `ink-spawn` (que sirve para renderizar output de subprocesos dentro del árbol ink, no para un handoff interactivo de TTY).

**Core technologies:**

| Paquete | Versión | Propósito | Razón |
|---------|---------|-----------|-------|
| `ink` | `^6.8.0` | Renderer React para terminal | Línea mantenida que respeta `engines.node >=20`; ink@7 exige Node `>=22` |
| `react` | `^19.2.0` | Peer requerido por ink; `useState`/`useEffect` para estado + polling | No viene bundleado — instalación explícita |
| `ink-text-input` | `^6.0.0` | Input de texto para el filtro `/` (cursor, backspace, paste) | Peercompat con ink@6/react@19; ESM; +1 prod dep justificado |
| `ink-testing-library` | `^4.0.0` | Renderizar componentes ink a buffer de string en `node --test` | devDep; version-agnóstico a ink/react |
| `@types/react` | `^19` | JSDoc `@ts-check` sobre la superficie ink/React | devDep opcional pero recomendado |
| Node global `fetch` | built-in (Node 20+) | Polling `/status`, fetch de `/comments`, `/logs` | Sin dep nueva; `AbortController`/`AbortSignal.timeout` también built-in |

**Invariantes de stack que deben sobrevivir al milestone:**
- `engines.node` permanece `>=20` — pin `ink@6`, no `ink@7`.
- Sin paso de build: `React.createElement` en `.js` plano; no Babel, no esbuild, no `tsx`.
- `bin/kodo dashboard` ejecuta directamente bajo `node` sin transpilación.

### Expected Features

**Must have (table stakes):**
- Auto-refresh ~2s de `GET /status` con indicador de "live / último update"
- Tabla de sesiones activas: `task_ref · repo · phase/mode · status · age`
- Selección ↑↓ rastreada por `task_id` (identidad estable, no índice de array)
- Ordenamiento estable por `started_at` (sin salto de filas en cada poll)
- Color por `status` + `alive` (incluyendo el combo zombie `running`+`!alive`)
- `Enter` → handoff completo a `cmux attach <workspace_ref>` → vuelta al dashboard
- Estado vacío ("no active sessions") y banner de servidor caído (keep-last-good + dimming)
- `q` para salir limpiamente (cursor, echo, scrollback intactos)

**Should have (diferenciadores):**
- Resumen de contadores en header: "3 running · 1 review · 1 error"
- Columna de edad en vivo (`elapsed_min` ya viene del servidor)
- Badge de modo GSD / phase (`[GSD p34]` / `[quick]` / `—`)
- Overlay `c` — comentarios vía `GET /comments/<task_id>` (vuelta al mismo cursor)
- Overlay `l` — grep de substring sobre el buffer compartido de `/logs` (honestamente etiquetado)
- Filtros client-side `/` (substring) + `r:<repo>` + `s:<state>` con cursor preservado

**Defer (v1.x o v2+):**
- Footer contextual por panel (v1.x)
- Tab de pending tasks (v1.x)
- Toggle de ordenamiento interactivo (v1.x)
- Dismissal de sesiones `d` (v2+ — orphan-safety + `kodo gsd doctor`)
- Stream real por sesión (v2+ — requiere nuevos endpoints)
- Config / temas / LLM assist (v2+)

**Fuera de alcance permanente en v1:**
- `DELETE /sessions/<id>` como acción — no mata el proceso, solo borra bookkeeping, puede orphanar sesiones vivas (`removeSession` en `src/session/state.js:131-145` verificado).
- Cualquier endpoint nuevo en `src/server.js`.
- Mouse / config / LLM.

### Three Data-Contract Realities That Reshape Scope

Estos tres hechos fueron verificados directamente en `src/server.js` y cambian el alcance de tres features. El requirements author y el roadmapper deben actuar sobre ellos explícitamente:

**1. `/logs` no tiene `session_id`** — El ring buffer (`src/server.js:13-29`) pushea `{ ts, level, msg }` sin ninguna clave de sesión. "Filtrado client-side de `/logs` por session_id" (PROJECT.md línea ~32) es imposible con el shape actual. La feature `l` debe implementarse como **grep de substring** sobre `task_ref`/`workspace_ref` del registro seleccionado. El texto de PROJECT.md en esa línea debe corregirse explícitamente durante la fase de aux panels.

**2. `DELETE /sessions/<id>` es solo bookkeeping** — `removeSession` mueve el SessionRecord a `history` y borra de `state.sessions`. No detiene el proceso de Claude, no toca el workspace de cmux, no elimina el worktree. Llamarlo desde el TUI "olvidaría" una sesión que sigue viva — exactamente el patrón de desincronización del incidente ROMAN-132. Recomendación: **OUT de v1 completamente**. No conectar a ninguna tecla.

**3. `/comments/<id>` está keyed por `task_id`, no `task_ref`** — El handler (`src/server.js:421-441`) resuelve por `s.task_id === taskId`. La columna visible de navegación es `task_ref` ("KL-7"), pero el fetch de comments necesita el `task_id` interno. La función `taskRefToTaskId(rows, ref)` en `select.js` es obligatoria para el mapping.

### Architecture Approach

La arquitectura parte el módulo TUI en cuatro capas ortogonales que corresponden directamente a los cuatro niveles de testabilidad del proyecto: (1) cliente HTTP puro (`client.js`, never-throws, result objects), (2) helpers de derivación puros sin React (`select.js`), (3) componentes ink presentacionales (`App.js` + `components/`), y (4) orquestación de proceso (`index.js`, dueño del `render()` + attach loop + exit code). Esta partición permite que la mayor parte de la lógica sea testeable con `node:test` puro y DI, reservando `ink-testing-library` para aserciones de render y routing de teclas, y dejando solo el handoff TTY real a `cmux attach` como UAT manual.

**Componentes principales:**

| Componente | Responsabilidad |
|------------|----------------|
| `src/cli.js` | Registro del subcomando `kodo dashboard` (lazy import, ~8 líneas) |
| `dashboard/index.js` (`runDashboard`) | Propietario del proceso: base URL, `render()`, attach loop, exit code |
| `dashboard/App.js` | Root ink: estado React, `usePoll`, routing `useInput`, switch de panel |
| `dashboard/client.js` | Pure HTTP: `fetchStatus`/`fetchComments`/`fetchLogs` (result objects, never throws) |
| `dashboard/select.js` | Pure derive: `sortSessions`, `filterSessions`, `resolveSelection`, `rowCells`, `taskRefToTaskId` |
| `dashboard/usePoll.js` | Hook: poll auto-scheduling sin stacking (recursive `setTimeout`, no `setInterval`) |
| `dashboard/attach.js` | Handoff: `unmount` → `waitUntilExit` → `spawn(cmux attach)` → re-`render` en `finally` |
| `dashboard/components/` | Dumb presentational: Header, Table, Row, DetailPanel, FilterInput, Footer |

**Color-isolation invariant:** ningún archivo bajo `src/cli/dashboard/` importa `picocolors`. El color del TUI viene exclusivamente de `<Text color>` de ink. La `test/format-isolation.test.js` existente ya escanea todo `src/` — sigue verde sin modificar porque ink no es `picocolors`. Recomendación: extender el walker con una aserción adicional que garantice cero `picocolors` imports en `src/cli/dashboard/**`.

**Regla de routing de colores:**

| Superficie | Fuente de color | Layout |
|-----------|----------------|--------|
| CLI clásico (`kodo logs`, `check`, `gsd verify`) | `picocolors` via `createFormatter` | manual `formatRow`/`formatTable` strings |
| TUI (`kodo dashboard`) | ink `<Text color>` (chalk interno de ink) | ink Flexbox `<Box>` |

No mezclar: pre-colorear strings con `createFormatter` antes de pasarlos a `<Text>` doble-encodea ANSI y rompe el width math de ink.

### Critical Pitfalls

1. **Handoff TTY a `cmux attach` sin unmount previo** — ink tiene stdin en raw mode; spawnar el hijo mientras ink está montado produce "Raw mode is not supported" o echo doble. Secuencia obligatoria: `unmount()` → `await waitUntilExit()` → `spawn(..., {stdio:'inherit'})` → re-`render()` en un `finally`. Pre-flight: si `alive === false`, no spawnar — mostrar mensaje y permanecer montado. Esta es la integración de mayor riesgo del milestone y necesita UAT manual (4 escenarios).

2. **Selección por índice de array en lugar de `task_id`** — `/status` reconstruye el array en cada request (`src/server.js:379`). Un índice fijo apunta a una sesión diferente cuando una fila desaparece. Rastrear siempre por `task_id`; re-derivar el índice en cada render con `resolveSelection`. Mismo patrón de desincronización que ROMAN-132.

3. **`setInterval` para el polling** — Apila requests si el servidor es lento. La correcta es `setTimeout` recursivo en el `finally` del fetch (solo se re-arma después de que el tick anterior resuelve), con `AbortController` por tick (timeout <2s) y flag `cancelled` para teardown.

4. **`/logs` tratado como stream por sesión** — El buffer es un ring compartido de 200 líneas sin `session_id`. Implementar `l` como grep de substring y etiquetar honestamente en la UI.

5. **Importar `picocolors` dentro del TUI** — Rompe `test/format-isolation.test.js`. Todo color via `<Text color>` de ink.

---

## Implications for Roadmap

El orden de fases surge directamente de las dependencias hard del grafo de features. Las fases continúan numeradas desde Phase 33 (la roadmapper asigna números finales).

### Phase A: Scaffold + non-TTY refusal + lifecycle

**Rationale:** Establece el esqueleto antes que cualquier lógica de negocio. El guard de non-TTY (exit 1 antes de llamar a `render()`), la disciplina de imports (no `picocolors` en el directorio TUI), y el ciclo de vida limpio de `q`/Ctrl-C/SIGTERM deben estar desde el primer commit. Sin esto el resto de las fases trabajarían sobre suelo inestable.

**Delivers:** `src/cli.js` +1 comando; `dashboard/index.js` con `render()` mínimo; guard non-TTY testeable con spawn piped (exit 1 + mensaje canónico); `useApp().exit()` + SIGTERM handler; `test/format-isolation.test.js` verde con TUI dir en el walker.

**Avoids:** Pitfall 4 (non-TTY crash), Pitfall 9 (dirty exit / raw mode leaked), Pitfall 10 (color-isolation leak).

**Research flag:** ninguno — patrones bien establecidos.

---

### Phase B: HTTP client + polling loop

**Rationale:** El cliente puro y el hook de polling son la fundación de datos. Son React-free, testeables con `node:test` + fetch fake, y no dependen de nada ink. Aislarlos aquí permite testear la lógica de "no stacking", "keep-last-good" y "backoff" sin levantar terminal.

**Delivers:** `dashboard/client.js` (fetchStatus/fetchComments/fetchLogs — result objects, never throws, fetch fn injectable); `dashboard/usePoll.js` (self-scheduling, cancellable, AbortController per tick); estado de conexión en App (connected/lastError/keep-last-good con backoff progresivo); tests: slow-fetch single-flight, succeed×2-then-throw retains last data, garbage JSON treated as failed poll.

**Avoids:** Pitfall 2 (request stacking), Pitfall 5 (server-down mid-session), Pitfall 12 (garbage JSON crashes render).

**Research flag:** ninguno — patrón canónico documentado en la investigación de stack.

---

### Phase C: Tabla viva + selección + filtros

**Rationale:** Con datos llegando, se construye la capa de presentación central. La selección por `task_id` y el ordenamiento estable por `started_at` son prerequisitos de todo lo que viene después (attach, comments y logs actúan sobre "la fila seleccionada"). Los filtros viven aquí porque también afectan qué filas son accionables.

**Delivers:** `dashboard/select.js` completo (sortSessions, filterSessions, resolveSelection, rowCells, taskRefToTaskId); `App.js` con estado completo; componentes Header/Table/Row/Footer; `FilterInput` con `ink-text-input`; color por status+alive (incluyendo highlight de zombie); resumen de contadores; indicador live; tests: two-payload reducer (cursor sigue task_id tras desaparición de fila), empty/shrinking filtered set, no-op guards en Enter/c/l con lista vacía; diff-gate para skip de setState si payload idéntico.

**Avoids:** Pitfall 3 (index-based selection / wrong-session attach), Pitfall 6 (filter/empty-list cursor crash), Pitfall 8 (re-render flicker).

**Research flag:** ninguno — los tests de `resolveSelection` están completamente especificados por la investigación.

---

### Phase D: Attach handoff — FASE DE MAYOR RIESGO

**Rationale:** El handoff TTY a `cmux attach` es la integración de mayor riesgo del milestone y merece su propio bloque de trabajo. Requiere desmontar ink, ceder el terminal al proceso hijo, y re-montar al volver — todo sin dejar la terminal rota. No puede colapsarse con otra fase porque falla de maneras no detectables por tests automáticos.

**Delivers:** `dashboard/attach.js` (unmount → waitUntilExit → spawn → re-render con finally-guarantee); `index.js` attach loop con do-while; pre-flight guard para `alive===false` (se rechaza con mensaje, se permanece montado); manejo de ENOENT (cmux no en PATH); reuso de `loadConfig().cmux.binary` para el path; **UAT manual documentado** cubriendo los 4 escenarios críticos: (1) primer attach + vuelta limpia, (2) segundo attach consecutivo (re-render no tiene raw-mode residual), (3) attach a workspace muerto (`alive===false`), (4) Ctrl-C durante attach (detach sin matar kodo).

**Avoids:** Pitfall 1 (TTY handoff roto), Pitfall 13 (handoff sin UAT).

**Research flag:** REQUIERE UAT MANUAL. Los tests unitarios cubren el ordering (fake spawn + fake render que graban la secuencia) y el pre-flight guard. El handoff raw-mode real solo es verificable en un TTY real contra un workspace cmux vivo.

---

### Phase E: Paneles auxiliares — comments + logs

**Rationale:** Una vez que la selección es estable y el attach funciona, los overlays `c` y `l` son additive sobre la infraestructura existente. El único riesgo propio de esta fase es la corrección del contrato de datos (task_id vs task_ref, shared buffer vs per-session stream), y la corrección del texto de PROJECT.md.

**Delivers:** `DetailPanel.js` (overlay a pantalla completa, Esc vuelve al mismo cursor preservando task_id); `c` — `fetchComments(baseUrl, task_id)` via `taskRefToTaskId` mapping, con manejo de 404/vacío/error; `l` — grep de substring por `task_ref`/`workspace_ref` sobre `fetchLogs`, auto-scroll con freeze al hacer scroll manual, header honesto ("shared buffer grep — may include other sessions"); corrección del wording en PROJECT.md línea ~32 de "filtrado por session_id" a "best-effort substring grep".

**Avoids:** Pitfall 7 (`l` como false-precision per-session tail).

**Research flag:** ninguno — los contratos de `/comments` y `/logs` están verificados directamente en `src/server.js`.

---

### Suggested Build Order (dentro del milestone)

```
Phase A: scaffold/non-TTY-refuse → lifecycle/cleanup → isolation guard
Phase B: client.js (pure) → usePoll hook → App wired + connection state
Phase C: static table render → selection+sort → color → filters
Phase D: attach.js unit tests → index.js loop → UAT manual (4 escenarios)
Phase E: comments overlay → logs overlay → PROJECT.md wording fix
```

### Phase Ordering Rationale

- **A primero:** el guard non-TTY y la disciplina de imports deben estar desde el primer commit de TUI; sin ellos cualquier fase intermedia puede romper CI o dejar la isolation test roja.
- **B antes que C:** los componentes ink consumen datos ya testeados aisladamente; no mezclar la validación del contrato HTTP con la del render.
- **C antes que D:** el attach actúa sobre "la fila seleccionada"; si la selección no es estable por `task_id`, el attach conectaría al workspace equivocado — un bug de corrección, no cosmético.
- **D sola:** el mayor riesgo del milestone; colapsarla con C o E enmascaría fallos del handoff TTY que solo aparecen en UAT manual.
- **E al final:** los overlays son additive; su único riesgo propio (contratos de datos) es conocido y acotado.

### Research Flags

**Fases que requieren atención especial durante planning:**
- **Phase D (attach handoff):** UAT manual obligatorio. Planificar explícitamente los 4 escenarios del checklist "Looks Done But Isn't". Sin artifact de UAT, la fase no está completa.

**Fases con patrones estándar (sin research adicional):**
- **Phase A:** non-TTY guard es un patrón canónico de ink (`useStdin().isRawModeSupported`), bien documentado.
- **Phase B:** self-scheduling poll con AbortController es el patrón recomendado en la investigación de stack, completamente especificado.
- **Phase C:** `resolveSelection` por `task_id` está completamente especificado; los tests de regresión se derivan directamente de la especificación.
- **Phase E:** contratos de `/comments` y `/logs` verificados directamente en código fuente.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versiones y peerDeps verificados contra npm registry + package.json de GitHub master; Node floor conflict documentado con fuentes primarias directas |
| Features | HIGH | Contrato de datos verificado directamente contra `src/server.js` y `src/session/state.js`; los tres re-scopes (logs sin session_id, DELETE bookkeeping-only, comments keyed by task_id) tienen fuente HIGH |
| Architecture | HIGH | Basada en las APIs documentadas de ink + lectura directa del codebase de kodo; la separación en 4 capas es directamente aplicable y testeable |
| Pitfalls | HIGH | 13 pitfalls identificados; todos con fuente HIGH (ink issues verificados, lectura directa del server); la mayoría tienen tests de verificación especificados |

**Overall confidence:** HIGH

### Gaps to Address

- **Número de fase final:** la investigación usa nombres A/B/C/D/E. El roadmapper asignará números reales continuando desde Phase 33. No hay dependencia bloqueante.
- **`config.server.port` vs literal 9090:** `dashboard/index.js` debe leer el puerto de `loadConfig().server.port` (default 9090 en `src/config.js:63`). Criterio de implementación de Phase A, no de diseño.
- **`loadConfig().cmux.binary` para el path de cmux:** `src/cmux/client.js:5` ya lee la config; `attach.js` debe reutilizar ese path. Criterio de implementación de Phase D.
- **`exit(value)` vs prop `onAttach` para pasar `workspace_ref`:** ambas variantes son idiomáticas en ink; elegir una en Phase D y ser consistente. No requiere research adicional.
- **Extensión del walker de isolation test:** se recomienda añadir una aserción que garantice cero `picocolors` imports en `src/cli/dashboard/**`. Criterio de aceptación de Phase A.

---

## Sources

### Primary (HIGH confidence)

- `src/server.js:354-455` — contrato de `/status`, `/logs`, `/comments/<task_id>`, `DELETE /sessions/<id>`; shape del ring buffer (sin `session_id`); array reconstruido por request en línea 379
- `src/session/state.js:131-145` — `removeSession` = bookkeeping-only, no kill, no cmux touch
- `src/cli/format.js` + `test/format-isolation.test.js:98-129` — invariante de color-isolation, grep por specifier `'picocolors'`, walker scope
- `src/config.js:62-66` — `server.port: 9090` default; `src/cmux/client.js:5` — cmux binary desde config
- `.planning/PROJECT.md` — constraints: no build step, no new endpoints, DI-for-testability, Node `>=20`, "filtrado por session_id" wording a corregir
- npm registry (`npm view`) — `ink@7.0.1` engines `>=22`; `ink@6.8.0` engines `>=20`; `react@19.2.5` latest
- GitHub `vadimdemedes/ink` package.json (master) — peerDeps confirmados; lifecycle API verificado
- GitHub `vadimdemedes/ink-text-input`, `ink-testing-library`, `ink-spinner`, `ink-table` — versiones, peerDeps, CJS/ESM status
- ink README + Context7 `/vadimdemedes/ink` — `useInput`, `useApp`, `exitOnCtrlC`, `patchConsole`, `waitUntilExit(value)` semántica
- ink DeepWiki (raw mode) — `isRawModeSupported`, ref-counted raw mode
- ink#378 + node/help#3084 — footgun de raw mode al spawnar hijo interactivo sin unmount

### Secondary (MEDIUM confidence)

- k9s repo + k9s#3220/#3652 — cursor reset en filtros, refresh cadence 2s default
- bubbletea ExecProcess / PR#237 — patrón suspend→handoff→restore (Go, comparable directo)
- k9scli.io Shell topic + k9s#1761 — rough edges en attach en algunos terminales
- btop/htop — `proc_sorting = "cpu lazy"` para estabilidad de filas

---
*Research completed: 2026-05-26*
*Ready for roadmap: yes*
