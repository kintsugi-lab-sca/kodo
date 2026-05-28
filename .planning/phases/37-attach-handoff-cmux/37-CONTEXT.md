# Phase 37: Focus — invocar `cmux select-workspace` - Context

**Gathered:** 2026-05-28
**REVISED:** 2026-05-28 (post-research, tras hallazgo C-01)
**Status:** Ready for planning

> **REVISION NOTE — C-01.** La versión original de este CONTEXT.md (D-01..D-13) asumía un verbo `cmux attach <workspace_ref>` que **no existe** en el binario cmux instalado (verificado empíricamente contra `/Applications/cmux.app/Contents/Resources/bin/cmux --help` y `capabilities` RPC). cmux es una app macOS GUI controlada por socket Unix; sus workspaces son tabs GUI, no sesiones TTY reattachables. El verbo real para "ir a la sesión X" es `cmux select-workspace --workspace <ref>` — fire-and-forget, ~50ms, **sin handoff TTY**. Ver `37-RESEARCH.md §C-01` para evidencia completa.
>
> **Decisiones supervivientes de la versión original** (con renumeración limpia): D-04 → D-01 (módulo puro never-throws), D-05 → D-02 (alive guard en App.js), D-09 → D-04 (footer-error UX), D-10 → D-05 (mensajes literal-estables, adaptados), D-11 → D-06 (origen del error).
> **Decisiones eliminadas** (innecesarias sin handoff TTY): D-01..D-03, D-06, D-07, D-08, D-12 (loop unmount→spawn→re-render, alt-screen toggle, snapshot del cursor, SIGINT noop window, remoción de SIGTERM, intent={value:null}).
> **Decisiones nuevas:** D-03 (`execFile` no `spawn`, sin `stdio:'inherit'`), D-07 (verbo+args exactos), D-08 (UAT reducido 4→2 escenarios).

<domain>
## Phase Boundary

`Enter` sobre la fila seleccionada del dashboard `kodo dashboard` (ya cableado en Phases 34-36) invoca `cmux select-workspace --workspace <row.workspace_ref>` vía `execFile` no-interactivo (~50ms, fire-and-forget). La app cmux cambia foco a ese workspace en su GUI. El dashboard `kodo` sigue corriendo intacto en su pane: no se desmonta, no se re-renderiza, no toca alt-screen ni raw-mode. Polling continúa sin interrupción.

Cubre **TUI-13** (Enter sobre fila `alive===true` → `cmux select-workspace`; GUI cambia foco; dashboard sigue corriendo) y **TUI-14** (guards: `alive===false` rechaza sin invocar; `ENOENT` o exit code ≠ 0 → footer-error rojo; dashboard nunca se rompe).

**Fuera de esta fase (Phase 38):** overlays `c` (comentarios por `task_id`) y `l` (logs grep best-effort). Esta fase NO toca overlays, NO añade endpoints al server, NO modifica el shape de `SessionRecord` ni de `/status` (constraints duras del milestone). NO usa `spawn` con `stdio:'inherit'`, NO mete loop `unmount→re-render`, NO toggla alt-screen, NO instala/remueve handlers de SIGINT/SIGTERM. El patrón existente de `src/cmux/client.js` (`execFile` no-interactivo con timeout) es el que se reusa — sin la duplicación que la versión original asumía.

</domain>

<decisions>
## Implementation Decisions

### Arquitectura: módulo puro never-throws (TUI-13/TUI-14)
- **D-01:** **`focus.js` como módulo nuevo** bajo `src/cli/dashboard/`: exporta `runFocus({ exec, ref, binary, timeoutMs })` — orquestador puro y testeable que recibe sus deps (incluido `exec` = `execFile` por default) y retorna un discriminated union:
  ```
  { ok: true } | { ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail }
  ```
  **Never throws** — jamás levanta una excepción que llegue a App.js (alineado con Phase 35 D-07 `client.js`). El planner decide la firma exacta y la granularidad interna (mapeo de error code, formateo del `detail`), respetando el contrato del discriminated union.

### Pre-flight guard: `alive===false` (TUI-14, criterio #2)
- **D-02:** **El guard `alive===false` corre en `App.js` DENTRO del handler de `Enter`, ANTES de invocar `runFocus`.** Si `row.alive === false`, NO se llama a `runFocus`: se fija estado local `focusError = 'workspace gone'` y se renderiza el footer rojo (D-04). **Cero invocación a `cmux`** — el caso zombie no genera ni una llamada de proceso. Phase 36 D-09 ya pinta la marca textual `(zombie)` en la celda `status`, así que el operador puede anticipar visualmente el rechazo antes de pulsar Enter.

### Mecanismo de invocación: `execFile` no-interactivo (NO `spawn stdio:'inherit'`)
- **D-03:** **Uso de `execFile` (no `spawn`), sin `stdio:'inherit'`, con timeout corto** (5s). Esto es CRÍTICO: cmux `select-workspace` es una RPC fire-and-forget al socket Unix, no un proceso interactivo. La invocación termina en ~50ms. NO se cede el TTY, NO se cambia el alt-screen, NO se instala/remueve handlers de señales, NO se desmonta ink. El patrón espejo es `src/cmux/client.js:14-26` (`function run(args)` → `execFile(getCmuxBinary(), args, { timeout: 15_000 }, callback)`); `focus.js` usa el mismo mecanismo con timeout más corto. **Esta decisión es la simplificación load-bearing tras C-01**: elimina todo el riesgo de raw-mode leak / alt-screen colgado / Ctrl-C confuso porque ninguno de esos vectores aplica.

### UX del mensaje de error (TUI-14, criterios #2 y #3)
- **D-04:** **El footer `↑↓ move · / filter · q quit` se reemplaza por el mensaje de error rojo, persistente hasta la próxima tecla.** Cualquier tecla (incluida Esc — no choca con la reserva D-11 de Phase 34/36 porque aquí no abre overlay, solo dismisses el error) limpia `focusError` y restaura el footer normal. **Sin timers cosméticos** (Phase 35 Pitfall 8 sigue aplicando). Sin overlays nuevos. El renderizado vive en `SessionTable.js` (componente del footer) o en App.js — el planner decide la ubicación exacta.
- **D-05:** **Tres mensajes específicos por causa** (el operador sabe inmediatamente qué arreglar):
  - **Zombie pre-flight (D-02):** `[!] workspace gone (alive=false) — press any key`
  - **ENOENT (`cmux` no en PATH o binario configurado no existe):** `[!] cmux not found in PATH — press any key`
  - **`cmux select-workspace` exit code ≠ 0 / otros errores de spawn:** `[!] cmux focus failed (code N) — press any key` (con `N` = `err.code ?? error.exitCode ?? 'unknown'`)
- **D-06:** **Origen del error según el caso** (atado a D-01):
  - **Zombie pre-flight (alive===false):** estado local en App (`useState(null)` de `focusError`), set en el Enter handler ANTES de llamar `runFocus`. No requiere ningún round-trip.
  - **Post-invocación (ENOENT / non-zero):** `runFocus` retorna `{ok:false, code, detail}` (D-01, never throws); el handler de Enter (que es `async`) `await`a el resultado y, si `!ok`, mapea al mensaje canónico (D-05) y fija `focusError` en el estado local. App lo presenta vía el mismo slot del footer (D-04).

### Verbo cmux exacto + ruta al binario
- **D-07:** **Invocación literal:** `execFile(binary, ['select-workspace', '--workspace', row.workspace_ref], { timeout: 5_000 })` donde `binary` = `loadConfig().cmux.binary` (default `/Applications/cmux.app/Contents/Resources/bin/cmux`, mismo patrón que `src/cmux/client.js:5-7`). El `workspace_ref` viene del `SessionRecord` ya existente (server.js:381 garantiza shape `workspace:N`). **NO usar `spawn`, NO `stdio:'inherit'`, NO `stdout: 'pipe'` necesario** — el stdout de `select-workspace` se ignora (no hay nada útil). **Timeout corto (5s)** porque la RPC al socket debería resolver en ~50ms; un timeout largo solo enmascara un cmux colgado.

### Artifact UAT: formato del `37-HUMAN-UAT.md` (criterio #4, sin esto la fase NO está completa)
- **D-08:** **Markdown único `${phase_dir}/37-HUMAN-UAT.md` con 2 escenarios OBLIGATORIOS** (siguiendo el patrón v0.3 `07-HUMAN-UAT.md` y el commit reciente `e93a1dc test(36): close HUMAN-UAT — 3/3 passed in TTY`). Cada escenario contiene:
  1. **Setup:** precondiciones concretas (ej. "lanzar `kodo dashboard` con al menos 1 sesión viva en `state.json` y workspace cmux montado en la app").
  2. **Steps:** numerados, accionables (ej. "1. ↓ hasta seleccionar la fila B. 2. Pulsar Enter.").
  3. **Expected observable:** criterio textual y verificable (ej. "Tras Enter: la app cmux focusea el workspace `workspace:N` (visible en la GUI). El dashboard kodo sigue corriendo en su pane, el cursor sigue sobre la fila B, el indicador `● live` sigue actualizándose.").
  4. **Slot 'Observed':** vacío para anotar el run real (texto libre).
  5. **Pass/Fail + fecha + firma humana.**

  **Los 2 escenarios OBLIGATORIOS:**
  - **(1) Focus exitoso visible** — cursor sobre fila alive + Enter → cmux GUI cambia foco al workspace target; dashboard sigue corriendo (cursor preservado, polling activo). **Por qué manual:** automatizar "cmux GUI cambia foco" requiere snapshotear el estado de la app desktop — fuera del scope de tests Node.
  - **(2) Zombie reject** — cursor sobre fila `alive===false` (forzable: matar manualmente el workspace cmux subyacente; el siguiente poll lo marca `alive:false`); Enter → footer rojo D-04/D-05 (`workspace gone`), dashboard intacto. Verificación adicional: `ps aux | grep cmux` muestra que el `execFile` NUNCA se invocó. Tecla cualquiera → footer normal restaurado.

  **Bonus escenarios OPCIONALES (no-blocker, anotar pass si se ejecutan):**
  - **(3) ENOENT** — renombrar temporalmente el binario cmux (`mv .../cmux .../cmux.bak`) → footer `[!] cmux not found in PATH`; dashboard sigue funcional. Restaurar con `mv .../cmux.bak .../cmux`.
  - **(4) Exit code ≠ 0** — forzar ref inválido (`workspace:99999`); footer `[!] cmux focus failed (code N)`; dashboard sigue funcional.

  **Sin sign-off de los 2 escenarios obligatorios, la fase NO está completa** — `gsd-verify-work` debe bloquear el cierre si el artefacto está ausente o si algún escenario está marcado Fail/sin firmar. Los bonus pueden quedar como TODO.

### Claude's Discretion
- Granularidad de `focus.js`: módulo único `runFocus` con `mapFocusError` interno, o split en helpers separados (`runFocus` + `mapFocusError`). Recomendado: mantenerlo en un único `focus.js` mientras la lógica quepa razonable (< ~80 LOC), siguiendo el patrón conservador del proyecto (cf. `client.js` Phase 35).
- Forma exacta del discriminated union de `runFocus`: `{ok:true} | {ok:false, code:'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}` es el contrato propuesto. El planner puede pulir nombres mientras preserve el mapeo 1:1 a D-05.
- Cabecera del Enter handler: `async (key) => {...}` o usar `runFocus(...).then(result => ...)`. Recomendado: `async/await` consistente con Phase 35 D-07 `usePoll` (`await fetchStatus(...)`).
- Ubicación exacta del render del footer-error: en `SessionTable.js` (donde ya vive el footer de Phase 36) o izado a App.js como un branch del JSX. Recomendado: render condicional en `SessionTable.js` (consistente con Phase 36 granularidad).
- Inyección de `exec` en `runDashboard`: si el planner quiere tests automatizables del mapping de errores, debe inyectar `exec` en `runDashboard(deps = { exec = childProcess.execFile, ... })` siguiendo el patrón Phase 34 D-DI; si no, `focus.js` importa `execFile` directamente y el mapping se prueba con `mock.module` puntual. Recomendado: inyectar `exec` (consistencia con `stdout`/`stdin`/`url`).
- Persistencia del `focusError`: un solo render vs `useState(focusError)` con clear-on-any-input. Implementación natural: `useState`, clear en el primer `useInput` post-error (D-04 dice "primera tecla limpia").

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap (revisados 2026-05-28)
- `.planning/ROADMAP.md` §"Phase 37: Focus — invocar `cmux select-workspace`" — Goal revisado, los 4 Success Criteria (focus exitoso · zombie reject · ENOENT/non-zero graceful · UAT 2-escenarios), `UI hint: yes`.
- `.planning/REQUIREMENTS.md` §"Focus workspace en cmux (Phase D)" — TUI-13 (Enter → `cmux select-workspace` fire-and-forget), TUI-14 (guards `alive===false` y ENOENT/non-zero); Out of Scope del milestone (NO endpoints nuevos, NO modificar SessionRecord, NO modificar /status).

### Phase 37 research (Cobertura completa del rationale + C-01)
- `.planning/phases/37-attach-handoff-cmux/37-RESEARCH.md` **§C-01** — Evidencia empírica de que `cmux attach` no existe; análisis del binario real y los verbos disponibles (`select-workspace`, `list-workspaces`, etc.). Justifica toda la simplificación.
- `.planning/phases/37-attach-handoff-cmux/37-RESEARCH.md` **§Validation Architecture** — Wave 0 RED tests automatizables (ordering test ya no aplica; sí aplican: alive guard, ENOENT mapping, NON_ZERO_EXIT mapping, never-throws contract).
- *(Las secciones del research sobre handoff TTY / alt-screen / SIGINT noop / snapshot quedan **referenciales** — describen una arquitectura que no se implementa. Útiles si en un futuro cmux añade un verbo `attach` real.)*

### Milestone research (heredado, aplicable parcialmente tras C-01)
- `.planning/research/STACK.md` — `ink@6.x` + `react@19`, sin build step, `React.createElement` plano (constraint heredada de Phase 34).
- `.planning/research/SUMMARY.md` — invariantes de stack y la regla de routing de colores (aplica al footer-error de D-04: rojo vía `<Text color="red">`, jamás `picocolors`).
- `.planning/research/ARCHITECTURE.md` §"ATTACH HANDOFF" — **NOTA HISTÓRICA**: describe la arquitectura asumida pre-C-01. Los principios (módulo puro never-throws + DI + discriminated union) siguen aplicando; el mecanismo concreto (handoff TTY) no.
- `.planning/research/PITFALLS.md` **Pitfall 1** (líneas 9-41) — **NOTA HISTÓRICA**: prescribe la secuencia `unmount → waitUntilExit → spawn(stdio:'inherit') → re-render` para handoff TTY. **No aplica a esta fase** porque cmux no soporta el verbo; queda como referencia para una eventual reimplementación si cmux añade `attach` futuro.
- `.planning/research/PITFALLS.md` **Pitfall 13** — UAT manual obligatorio porque ciertos escenarios no son unit-testeables: el principio sigue aplicando (escenario #1 de D-08 requiere ver la GUI de cmux); el alcance se reduce (4→2 escenarios obligatorios).

### Codebase (verificado en scout — READ ONLY salvo donde se indique explícitamente)
- `src/cli/dashboard/index.js:78-131` (`runDashboard`) — **MÓDULO A MODIFICAR (mínimo)**: ya tiene guard non-TTY, baseUrl, alt-screen toggle, SIGTERM handler, exit code. **Cambio mínimo:** añadir `exec` a `deps` (DI siguiendo el patrón Phase 34) y pasar `onFocus={async (ref) => runFocus({exec, ref, binary:loadConfig().cmux.binary})}` como prop a `<App />`. **NO añadir loop while(true)**, **NO tocar alt-screen toggle**, **NO instalar/remover handlers de señales**.
- `src/cli/dashboard/App.js:89-260` — **MÓDULO A MODIFICAR**: ya tiene `useInput` mode-gated y estado `selectedTaskId`/`query`/`mode`. **Cambios:** añadir prop `onFocus`, añadir `useState(null)` para `focusError`, handler de Enter en bloque `mode === 'list'` con guard `alive===false` + `await onFocus(row.workspace_ref)` + mapeo de resultado a `focusError`, lógica de clear-on-any-input para `focusError`. Render condicional del footer-error.
- `src/cli/dashboard/focus.js` — **MÓDULO NUEVO** (D-01): orquestador puro `runFocus({exec, ref, binary, timeoutMs?})` que retorna discriminated union `{ok, code, detail}`; never-throws; testeable con `exec` fake. Pattern espejo de `src/cmux/client.js:14-26`.
- `src/cli/dashboard/SessionTable.js` — **POSIBLE MODIFICACIÓN** (D-04): render del footer (donde hoy vive `↑↓ move · / filter · q quit`); ubicación natural del footer-error rojo. Alternativa Claude's Discretion: izar a App.js.
- `src/cli/dashboard/select.js`, `format.js`, `usePoll.js`, `client.js` — **NO MODIFICAR**: helpers puros de Phase 35-36; esta fase no toca derivación/polling/HTTP.
- `src/cmux/client.js:14-26` (`run(args)`) — **REFERENCIA + PATRÓN A REUSAR**: pattern espejo para `focus.js`. Misma estructura `execFile(getCmuxBinary(), args, { timeout: T }, callback)`. **NO importar `run` directamente** (manejo de errores distinto: `client.js` reject-throws, esta fase never-throws); copiar el patrón con la firma adaptada.
- `src/config.js` — `loadConfig().cmux.binary` (default `/Applications/cmux.app/Contents/Resources/bin/cmux`). `focus.js` lo lee igual que `client.js`.
- `src/server.js:378-381` — **REFERENCIA, NO MODIFICAR**: muestra cómo `alive` se computa server-side (`workspaceList.includes(s.workspace_ref)`). El guard D-02 confía en este campo del payload `/status`.
- `test/format-isolation.test.js:98-129` — walker que escanea `src/cli/dashboard/**` por `picocolors`. **`focus.js` NO debe importar `picocolors`** (color-isolation invariante D-12 Phase 34).

### Phases previas — decisiones que esta fase preserva
- `.planning/phases/34-fundacion-subcomando-ciclo-de-vida/34-CONTEXT.md` — **D-DI** (deps inyectables en `runDashboard`: stdin/stdout/url, extendido aquí con `exec`); **D-12** (color-isolation: `focus.js` y footer-error usan solo `<Text color>` de ink); **D-10** (SIGTERM handler — NO se toca esta fase, contrario a la versión original de Phase 37). El alt-screen toggle de `index.js` queda intacto (NO se modifica el `\x1b[?1049h/l` actual).
- `.planning/phases/35-datos-cliente-http-polling/35-CONTEXT.md` — **D-07 never-throws contract** (`client.js` retorna `{ok}` jamás throw): `runFocus` sigue exactamente el mismo contrato (cf. D-01); **D-01** (status line viva sigue corriendo durante la invocación — la RPC es síncrona ~50ms pero `runFocus` es async, el polling self-scheduling de `usePoll` no se ve afectado).
- `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-CONTEXT.md` — **D-05** (`selectedTaskId` por identidad — el handler de Enter lee de `row` que ya resolveSelection cubre por identidad); **D-08/D-09** (color zombie + marca `(zombie)` — operador anticipa visualmente el rechazo D-02); **D-11** (`Esc` modal en filtro vs lista — D-04 de esta fase no rompe la reserva: el footer-error no es un overlay; dismissable por cualquier tecla incluida Esc).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/cmux/client.js:14-26` `run(args)`** — Pattern espejo directo para `focus.js`. Mismo `execFile(binary, args, { timeout })`, manejo de err/stdout/stderr, lectura del binario via `loadConfig().cmux.binary`. La única diferencia: `client.js` rechaza con Error; `focus.js` resuelve con discriminated union never-throws (Phase 35 D-07 pattern).
- **Patrón DI del proyecto** (Phase 34 D-DI): `runDashboard(deps = {...})` ya recibe `stdout`/`stdin`/`url`; añadir `exec = childProcess.execFile` sigue el patrón sin invención (D-01 + Claude's Discretion).
- **`useApp().exit()`** en App.js (línea 200) — **NO se usa para Enter** en esta fase (no hay handoff TTY que requiera unmount). El handler de Enter llama `runFocus` directamente (async) y mantiene App montado. `exit()` sigue solo cableado para `q`.
- **`selectedTaskId` por identidad + `resolveSelection` clamp** (Phase 36 D-05/D-06): el handler de Enter lee `row` desde el snapshot resuelto; `resolveSelection` ya garantiza que `row` es la fila correcta o la siguiente válida si la previa desapareció.
- **`isRawModeSupported` guard de `useInput`** (App.js línea 220): preservado tal cual; el handler de Enter vive dentro del bloque `mode === 'list'` existente.
- **Patrón helpers puros + DI sin `mock.module`**: `focus.js` puro (D-01) testeable con `exec` fake (mismo patrón que `client.js`/`select.js`/`format.js` de Phases 35-36).

### Established Patterns
- **Color-isolation** (Phase 34 D-12): footer-error rojo vía `<Text color="red">`; `focus.js` no debe importar `picocolors` (walker ya lo verifica para todo `src/cli/dashboard/**`).
- **`React.createElement` plano, sin JSX, sin build step** (Phase 34): cualquier markup nuevo (footer-error, prop adicional en `<App>`) sigue este patrón.
- **Lazy imports en `runDashboard`** (`await import('ink')`, `await import('react')`, `await import('./App.js')`): el `await import('./focus.js')` se añade igual; `await import('node:child_process')` solo se usa si `deps.exec` no fue inyectado.
- **never-throws + discriminated union** (Phase 35 D-07): `runFocus` (D-01) sigue exactamente este contrato — `{ok:true} | {ok:false, code, detail}` — para que ninguna excepción de `execFile` llegue a App.
- **Mensaje canónico estable** (Phase 34 D-04 con `NON_TTY_MSG`): los tres mensajes de D-05 son strings estables — los tests de mapeo (D-01) los asertan literal.

### Integration Points
- `src/cli/dashboard/index.js` (**MODIFICADO mínimo**): añadir `exec` a `deps`; pasar `onFocus` prop a `<App />`. **NO loop while(true)**, **NO toggle alt-screen extra**, **NO touch SIGINT/SIGTERM handlers**. El `try/finally` lineal de Phase 34 queda intacto.
- `src/cli/dashboard/App.js` (**MODIFICADO**): prop `onFocus`, estado `focusError`, handler de Enter en bloque `mode==='list'`, render condicional del footer-error.
- `src/cli/dashboard/focus.js` (**NUEVO**): orquestador puro; never-throws; discriminated union; usa `exec` inyectado.
- `src/cli/dashboard/SessionTable.js` (**POSIBLE**, Claude's Discretion): render del footer-error rojo cuando se reciba la prop correspondiente.
- `src/server.js`: **NO TOCAR** (constraint dura del milestone — cero endpoints nuevos).
- `src/cmux/client.js`: **NO TOCAR**. **REFERENCIA**: `focus.js` copia el patrón de `run(args)` con la adaptación never-throws.
- `test/format-isolation.test.js`: cubre automáticamente `focus.js` y cualquier nuevo archivo bajo `src/cli/dashboard/**` (no requiere extensión).
- `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` (**NUEVO**, D-08): artefacto bloqueante del cierre de fase, 2 escenarios obligatorios + 2 bonus opcionales.

</code_context>

<specifics>
## Specific Ideas

- **Test load-bearing de TUI-13 success path (automatizable):** con `exec` fake que invoca el callback `(null, '', '')`, asertar que `runFocus({exec, ref:'workspace:5', binary:'/path/to/cmux'})` retorna `{ok:true}` y que el `exec` fake recibió `args = ['select-workspace', '--workspace', 'workspace:5']` literal (ordering + args).
- **Test load-bearing de TUI-14 `alive===false` (automatizable):** render App con fixture de `/status` que retorna una sesión con `alive:false`; simular Enter (vía `ink-testing-library` o input stream fake); asertar que `onFocus` NUNCA fue llamado, que `lastFrame()` contiene `workspace gone (alive=false) — press any key` con color rojo (`<Text color="red">`), y que el dashboard sigue montado.
- **Test load-bearing de TUI-14 ENOENT (automatizable):** `exec` fake que invoca callback con `err.code === 'ENOENT'`; asertar que `runFocus` retorna `{ok:false, code:'ENOENT'}`. Y/o test de integración en App: tras Enter, el siguiente render contiene `'[!] cmux not found in PATH — press any key'`.
- **Test load-bearing de TUI-14 exit code ≠ 0 (automatizable):** `exec` fake que invoca callback con `err = Object.assign(new Error('x'), { code: 7 })`; asertar `runFocus` retorna `{ok:false, code:'NON_ZERO_EXIT'}` y mensaje renderizado contiene `'code 7'`.
- **Test de clear-on-any-input (automatizable):** App con `focusError` seteado; simular cualquier tecla; asertar que `focusError === null` y el footer normal `↑↓ move · / filter · q quit` está renderizado.
- **Test never-throws contract (automatizable):** `exec` fake que SÍNCRONAMENTE lanza (no callback); asertar que `runFocus` resuelve con `{ok:false, code:'SPAWN_ERROR'}` sin que la promesa reject. Cubre el caso donde `execFile` mismo lanza por argumentos malos.
- **Caso NO automatizable, exclusivo del UAT manual (D-08.1):** verificar visualmente que cmux GUI cambia foco al workspace target tras el `select-workspace`. `ink-testing-library` no puede observar la app desktop.
- **Mensajes literal-estables** (los tests de mapeo los asertan literal): `'[!] workspace gone (alive=false) — press any key'`, `'[!] cmux not found in PATH — press any key'`, `'[!] cmux focus failed (code N) — press any key'` (`N` substituido por el código real).

</specifics>

<deferred>
## Deferred Ideas

- **Verbo `cmux attach` real (handoff TTY genuino)** — Si cmux añade un subcomando `attach` futuro que sí secuestra el TTY del parent, la versión original de Phase 37 (D-01..D-13 pre-revision) describe la arquitectura completa. Hoy fuera de scope porque el verbo no existe.
- **Overlays `c` (comentarios por `task_id`) y `l` (logs grep best-effort)** — **Phase 38** (TUI-15/16). `Esc` cerrará overlays en modo lista (honrando el límite modal de Phase 36 D-15). Independiente del focus.
- **`kodo gsd doctor` (limpieza de worktrees huérfanos + sesiones zombie)** — post-v0.9. El zombie-reject de esta fase es defensivo en la UI; el doctor lo limparía proactivamente.
- **`cmux focus-window` + `select-workspace` combinado** — si el operador tiene cmux minimizado/oculto, `select-workspace` cambia el workspace pero no traer la app al frente. El planner puede considerar combinar con `focus-window` si la UAT manual lo revela. Por ahora, fuera de scope (escenario #1 del UAT lo cubre si el operador tiene cmux visible).
- **Indicador "focusing..." entre Enter y resolución de `runFocus`** — la invocación es ~50ms, no justifica spinner. Si el operador percibe lag, se añade en una fase posterior.

### Reviewed Todos (not folded)
- **"Surface provider state in dashboard (Plane In Review / GitHub equivalent)"** (`2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`) — **scope creep para Phase 37**: requiere modificar `src/server.js` y SessionTable. Phase 37 es estrictamente la invocación del verbo `cmux select-workspace`. Mantener el todo abierto para roadmap backlog post-v0.9.

</deferred>

---

*Phase: 37-attach-handoff-cmux* (slug histórico; el goal es "focus workspace en cmux" tras la revisión C-01)
*Context gathered: 2026-05-28*
*Context revised: 2026-05-28 (post-research C-01)*
