# Phase 37: Attach — handoff a cmux - Context

**Gathered:** 2026-05-28
**Status:** Ready for planning

<domain>
## Phase Boundary

La **integración más arriesgada del milestone v0.9**: handoff TTY completo desde el panel
`kodo dashboard` (ya cableado en Phases 34-36) hacia `cmux attach <workspace_ref>` y vuelta
intacta al desmarcaje, aislada en su propia fase con UAT manual obligatorio porque falla de
maneras que los tests automáticos no detectan (raw-mode leak, alt-screen colgado, doubled
echo, terminal rota tras error).

Cubre **TUI-13** (Enter sobre la fila seleccionada → `cmux attach <workspace_ref>`, secuencia
`unmount` → `waitUntilExit` → `spawn stdio:'inherit'` → re-`render`, vuelta intacta al
detach) y **TUI-14** (guards: `alive===false` y ENOENT de `cmux` → mensaje + dashboard
permanece montado, jamás rompe la terminal).

**Fuera de esta fase (Phase 38):** overlays `c` (comentarios por `task_id`) y `l` (logs grep
best-effort sobre el buffer compartido). Esta fase NO toca overlays, NO añade endpoints al
server, NO modifica el shape de `SessionRecord` ni de `/status` (constraints duras del
milestone). El mecanismo de invocación de cmux desde código existente (`src/cmux/client.js`,
basado en `execFile` no-interactivo) NO se reutiliza — el attach es interactivo y necesita
`spawn` con `stdio:'inherit'`.

</domain>

<decisions>
## Implementation Decisions

### Arquitectura del handoff: dueño del proceso (TUI-13)
- **D-01:** El loop `unmount → spawn → re-render` vive en **`runDashboard` (`src/cli/dashboard/index.js`)** — único dueño del proceso (consistente con la responsabilidad ya declarada de ese módulo: alt-screen, SIGTERM handler, baseUrl, exit code). App.js NUNCA orquesta su propio desmonte y re-mount; solo **emite intent** y llama `useApp().exit()`. El loop conceptual:
  ```
  try {
    while (true) {
      const intent = { value: null };
      const app = render(<App ... onAttach={(ref, snapshot) => { intent.value = { type:'attach', ref, snapshot }; exit(); }} />);
      install SIGTERM handler de Phase 34 D-10;
      await app.waitUntilExit();
      remove SIGTERM handler;
      if (intent.value?.type !== 'attach') break;
      // attach window: ver D-06, D-12
      runAttach(...);
      snapshot = intent.value.snapshot;  // pasa a la siguiente iteración como initialSnapshot
    }
  } finally { stdout.write('\x1b[?1049l'); process.exitCode = 0; }
  ```
- **D-02:** **Seam de comunicación intent ↔ runDashboard = mutable ref + callback prop.** `runDashboard` crea `const intent = { value: null }` por iteración del loop y pasa `onAttach(ref, snapshot) => { intent.value = { type:'attach', ref, snapshot }; exit(); }` como prop a `<App />`. Tras `await waitUntilExit()`, lee `intent.value` y bifurca. **Sin promesas extra paralelas, sin event emitters**: el seam es deliberadamente flat. Se descartó el patrón Deferred/Promise por añadir una promesa paralela a `waitUntilExit` y dificultar la coordinación.
- **D-03:** **`spawn` se inyecta en `runDashboard(deps)`** — mismo patrón que `stdout`/`stdin`/`url` ya inyectados (D-DI de Phase 34): `runDashboard(deps = { spawn = childProcess.spawn })`. `attach.js` es puro y recibe `spawn` como argumento (cero import eager). Habilita tests herméticos con `spawn` fake que registra call-order relativo a `unmount` (Pitfall 13: "automate what *can* be: ordering test with injected spawn fn").
- **D-04:** **`attach.js` como módulo separado** (ARCHITECTURE.md sección "ATTACH HANDOFF"): exporta `runAttach({ spawn, ref, stdout })` (firma exacta a refinar por el planner) — orquestador puro y testeable que recibe sus deps y retorna un discriminated union `{ok: true} | {ok: false, code: 'ENOENT' | 'NON_ZERO_EXIT' | 'SPAWN_ERROR', detail}` (jamás throw que llegue al loop). El planner decide si encapsula también el toggle del alt-screen (D-06) y la gestión de señales (D-12), o si `runDashboard` los hace alrededor de la llamada.

### Pre-flight guard: alive===false (TUI-14, criterio #3)
- **D-05:** El guard `alive===false` corre en **App.js DENTRO del handler de Enter, ANTES de emitir intent**. Si `row.alive === false`, NO se llama `onAttach`: se fija un estado local `attachError = 'workspace gone'` y se renderiza el footer rojo (D-09). **Cero unmount, cero spawn, App nunca se desmonta** — el TTY ni siquiera se toca. Esto descarta deliberadamente las alternativas (chequear en runDashboard o en `runAttach` puro) porque obligarían a un round-trip unmount→re-render solo para mostrar un error que la fila ya conoce. Phase 36 D-09 ya pinta marca textual `(zombie)` en la celda `status`, así que el operador puede anticipar el rechazo visualmente.

### Alt-screen + cursor durante el handoff (TUI-13, criterio #1)
- **D-06:** **Toggle simétrico del alt-screen alrededor del spawn de cmux** — `runDashboard` (o `attach.js` por delegación, D-04) ejecuta:
  1. `stdout.write('\x1b[?1049l')` ANTES del `spawn` → kodo apaga su alt-screen, terminal vuelve a la primary screen.
  2. `spawn('cmux', ['attach', ref], { stdio: 'inherit' })` → cmux es propietario único del TTY y del alt-screen mientras corre; entra/sale de su propio alt-screen.
  3. `await` el close del child.
  4. `stdout.write('\x1b[?1049h')` ANTES del re-render → kodo re-entra a su alt-screen para la siguiente iteración.
  5. `render(<App initialSnapshot={...} initialError={...} />)`.

  **Rationale (load-bearing para el criterio #1, vuelta intacta):** sin pasos 1+4, cuando cmux detach hace `\x1b[?1049l` al salir, kodo "cree" que sigue en alt-screen y el siguiente render pinta sobre la primary screen → frame fantasma en scrollback, contrato del `finally` de `index.js:122-127` violado. Patrón estándar para nested TUIs (vim shell-out, tmux nested, claude code).
- **D-07:** **No añadir belt-and-suspenders de restauración de cursor/raw-mode.** `ink.waitUntilExit()` ya garantiza por contrato (ink docs) que el cleanup termina ANTES de resolver — incluyendo raw-mode restore y cursor visible. Confiamos en eso. Cualquier "extra" (write explícito de `\x1b[?25h`) duplica responsabilidad y oscurece la fuente de verdad.

### Estado post-detach: snapshot del cursor + filtro (TUI-13, segundo attach consecutivo)
- **D-08:** **Snapshot del estado de App `{selectedTaskId, query, mode}` viaja en el intent** y se reaplica como prop del siguiente render: `intent.value = { type:'attach', ref, snapshot:{selectedTaskId, query, mode} }`. La siguiente iteración renderiza `<App initialSnapshot={snapshot} ... />` y App usa esos valores como `useState` initializers (e.g., `useState(initialSnapshot?.selectedTaskId ?? null)`). El operador vuelve al **mismo cursor, mismo filtro, mismo modo (list / filter)**. resolveSelection de Phase 36 D-06 cubre transparentemente el caso "la sesión seleccionada terminó durante el attach" (clamp al vecino por índice posicional previo). **Criterio #2 (segundo attach consecutivo igual que el primero) emerge naturalmente del loop**: cada iteración crea una instancia fresca de ink — cero state leak entre handoffs.

### UX del mensaje de error (TUI-14, criterios #3 y #4)
- **D-09:** **El footer `↑↓ move · / filter · q quit` se reemplaza por el mensaje de error rojo, persistente hasta la próxima tecla.** Cualquier tecla (incluida Esc — no choca con la reserva D-11 de Phase 34 porque aquí no abre overlay, solo dismisses el error) limpia `attachError`/`initialError` y restaura el footer normal. **Sin timers cosméticos** (Pitfall 8: re-render por timer de 1s es anti-pattern). Sin overlays nuevos (esos son scope de Phase 38). El renderizado vive en `SessionTable.js` (componente del footer) o en App.js — el planner decide la ubicación exacta.
- **D-10:** **Tres mensajes específicos por causa** (el operador sabe inmediatamente qué arreglar):
  - **Zombie pre-flight (D-05):** `[!] workspace gone (alive=false) — press any key`
  - **ENOENT (`cmux` no en PATH):** `[!] cmux not found in PATH — press any key`
  - **cmux exit code ≠ 0 / otros errores de spawn:** `[!] cmux attach failed (code N) — press any key` (con `N` substituido por `child.exitCode ?? err.code ?? 'unknown'`)
- **D-11:** **Origen del error según el caso** (atado a D-04):
  - **Zombie pre-flight (TUI-14 alive===false):** estado local en App (`useState(null)` de `attachError`), set en el Enter handler ANTES de emitir intent. No requiere round-trip por runDashboard.
  - **Post-spawn (ENOENT / non-zero):** `runAttach` retorna `{ok: false, code, detail}` (D-04, never throws); runDashboard captura, mapea al mensaje canónico (D-10) y pasa `<App initialError={msg} />` a la siguiente iteración. App lo presenta vía el mismo slot del footer (D-09).

### Manejo de señales durante la ventana del attach (Pitfall 1)
- **D-12:** **Durante la ventana del attach (entre `unmount` resolución de `waitUntilExit` y re-render):**
  1. **Install no-op SIGINT handler** (`process.on('SIGINT', noop)`) → cmux (foreground vía `stdio:'inherit'`) recibe Ctrl-C y lo trata como detach por su propia lógica; kodo recibe SIGINT también pero el handler no-op previene el default de Node que mataría el proceso. **Cumple el criterio #5.4 del UAT (Ctrl-C durante attach = detach SIN matar kodo).**
  2. **Remove el handler de SIGTERM de Phase 34 D-10** (`process.removeListener('SIGTERM', onSigterm)`) — App ya está desmontado, llamar `app.unmount()` sobre una instancia destruida es undefined behavior. Si el operador manda SIGTERM durante el attach, queda como TODO documentado (probablemente kodo termina con default — aceptable; el caso real es Ctrl-C, no SIGTERM remoto).
  3. **Limpieza inversa al volver del spawn:** `process.removeListener('SIGINT', noop)` + reinstalar el `process.once('SIGTERM', onSigterm)` para la nueva instancia de App. **Cero leak de handlers entre iteraciones del loop** (verificable con `process.listenerCount('SIGINT')` / `'SIGTERM'`).

### Artifact UAT: formato del `37-HUMAN-UAT.md` (criterio #5, sin esto la fase NO está completa)
- **D-13:** **Markdown único `${phase_dir}/37-HUMAN-UAT.md` con 4 escenarios obligatorios** (siguiendo el patrón v0.3 `07-HUMAN-UAT.md` y el commit reciente `e93a1dc test(36): close HUMAN-UAT — 3/3 passed in TTY`). Cada escenario contiene:
  1. **Setup:** precondiciones concretas (ej. "lanzar `kodo dashboard` con al menos 1 sesión viva en `state.json` y workspace cmux montado").
  2. **Steps:** numerados, accionables (ej. "1. ↓ hasta seleccionar la fila B. 2. Pulsar Enter.").
  3. **Expected observable:** criterio textual y verificable (ej. "Tras Enter: dashboard desaparece, `cmux attach workspace:N` toma el TTY. Detach con `Ctrl-d`: dashboard re-aparece. Cursor sobre row B. Sin doubled echo al tipear `/abc`.").
  4. **Slot 'Observed':** vacío para anotar el run real (texto libre).
  5. **Pass/Fail + fecha + firma humana.**

  **Los 4 escenarios obligatorios (literal del criterio #5 del ROADMAP):**
  - (1) **Primer attach + vuelta limpia** — cursor visible, no doubled echo, kodo re-render con el cursor preservado (D-08), terminal scrollback sin frames fantasma (D-06).
  - (2) **Segundo attach consecutivo** — entrar a una sesión, detach, entrar a OTRA sesión, detach. Ambos handoffs equivalentes; cero raw-mode leak entre iteraciones (D-01/D-08).
  - (3) **Attach a workspace muerto** (forzar `alive===false`): cursor sobre fila zombie + Enter → footer rojo D-09/D-10 (`workspace gone`), dashboard intacto, no spawn (D-05). Tecla cualquiera → footer normal restaurado.
  - (4) **Ctrl-C durante attach** — durante `cmux attach` el operador pulsa Ctrl-C → cmux detach, kodo dashboard re-aparece intacto (D-12.1). Forma DETERMINANTE de pass: el process `kodo` sigue PID-vivo tras el Ctrl-C (verificable con `ps`/`top` en una ventana paralela ANTES y DESPUÉS).

  **Bonus escenarios opcionales (no-blocker, anotar pass si se ejecutan):** ENOENT (renombrar temporalmente `cmux` para forzar PATH-miss → footer `cmux not found in PATH`); SIGTERM remoto durante attach (documentar comportamiento real).

  **Sin sign-off (4/4 obligatorios), la fase NO está completa** — `gsd-verify-work` debe bloquear el cierre si el artefacto está ausente o si algún escenario está marcado Fail/sin firmar.

### Claude's Discretion
- Estructura granular de archivos: ¿`attach.js` como un único módulo, o split en `runAttach` puro + helpers (`mapAttachError(err, code)`, `dismissAttachError(state)`)? Recomendado mantener un único `attach.js` mientras la lógica quepa razonable (< ~120 LOC), siguiendo el patrón conservador del proyecto.
- Forma exacta del discriminated union de `runAttach`: `{ok: false, code: 'ENOENT'|'NON_ZERO_EXIT'|'SPAWN_ERROR', detail}` es el contrato propuesto, el planner puede pulir nombres mientras preserve el mapeo 1:1 a D-10.
- Tests inyectables: el planner decide qué cosas se prueban con `spawn` fake (ordering test: unmount precede spawn; ENOENT mapping; exit-code mapping) vs. qué queda como manual UAT (D-13). Mínimo verificable automáticamente: el ordering relativo y el mapeo de errores.
- Ubicación exacta del render del footer-error: en `SessionTable.js` (donde ya vive el footer) o izado a App.js como un branch del JSX. Recomendado: render condicional en `SessionTable.js` o un componente `Footer.js` extraído (consistente con la granularidad de Phase 36).
- Si el `initialError` se persiste un solo render o se mantiene en estado y la primera tecla lo limpia (D-09 dice "primera tecla limpia"; la implementación natural es izar a `useState(initialError)` con clear-on-any-input — el planner refina).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements + roadmap
- `.planning/ROADMAP.md` §"Phase 37: Attach — handoff a cmux (FASE DE MAYOR RIESGO)" — Goal, los 5 Success Criteria (handoff completo + vuelta intacta · segundo attach · alive===false reject · ENOENT reject · UAT artifact obligatorio), `UI hint: yes`.
- `.planning/REQUIREMENTS.md` — TUI-13 (Enter → cmux attach handoff sequence), TUI-14 (guards alive/ENOENT); Out of Scope del milestone (NO endpoints nuevos, NO modificar SessionRecord, NO modificar /status).

### Milestone research (verificado en Phase 34-36, aplicable directo a Phase 37)
- `.planning/research/PITFALLS.md` **Pitfall 1** (líneas 9-41) — `cmux attach` TTY handoff leaves the terminal in a broken state: prescribe la secuencia EXACTA `unmount → waitUntilExit → spawn(stdio:'inherit') → finally re-render`, el pre-flight `alive` guard, el wrap de spawn errors (ENOENT, non-zero exit). **El mecanismo está locked aquí**, esta fase ejecuta lo prescrito.
- `.planning/research/PITFALLS.md` **Pitfall 13** (líneas 342-347) — Attach handoff no es unit-testeable; UAT manual obligatorio con 4 escenarios; lo que SÍ se puede automatizar: pre-flight `alive` guard + ordering test (unmount precede spawn) con `spawn` fake. D-13 ejecuta el primero; D-03 habilita el segundo.
- `.planning/research/ARCHITECTURE.md` — sección "ATTACH HANDOFF" (líneas 27-34) + componente `attach.js` (línea 67, 81) + responsabilidad de `dashboard/index.js` (línea 62: "host the attach loop"). **D-01/D-04 alinean exactamente con esta partición.**
- `.planning/research/STACK.md` — `ink@6.x` + `react@19`, sin build step, `React.createElement` plano (constraint heredada de Phase 34).
- `.planning/research/SUMMARY.md` — invariantes de stack y la regla de routing de colores (aplica al footer-error de D-09: rojo vía `<Text color="red">`, jamás `picocolors`).
- *(El planner correrá `gsd-phase-researcher` para profundizar phase-specific en patrones de spawn interactivo y test harness para attach orchestration — lo anterior es el research a nivel milestone ya validado.)*

### Codebase (verificado en scout — READ ONLY salvo donde se indique explícitamente)
- `src/cli/dashboard/index.js:78-131` (`runDashboard`) — **MÓDULO A MODIFICAR**: dueño del proceso, ya tiene el guard non-TTY (D-03 Phase 34), resolución de baseUrl (D-05 Phase 34), alt-screen toggle `\x1b[?1049h/l` (línea 107 / 127), SIGTERM handler (líneas 115-118), exit code (línea 129). **D-01/D-02/D-03/D-06/D-12 mutan este archivo** — el loop `while (true) { render ... waitUntilExit ... if attach intent { spawn ... continue } else break }` reemplaza el `try/finally` lineal actual.
- `src/cli/dashboard/App.js:89-260` — **MÓDULO A MODIFICAR**: ya tiene `useApp().exit()` (línea 200), `useInput` mode-gated (líneas 170-221), estado `selectedTaskId`/`query`/`mode` (líneas 116-123). **D-05/D-08/D-09 mutan este archivo**: añadir `onAttach`/`initialSnapshot`/`initialError` props, handler de Enter con guard `alive===false`, render condicional del footer-error.
- `src/cli/dashboard/attach.js` — **MÓDULO NUEVO** (D-04): orquestador puro `runAttach({ spawn, ref, stdout })` que retorna discriminated union `{ok, code, detail}`; never-throws; testeable con `spawn` fake.
- `src/cli/dashboard/SessionTable.js` — **POSIBLE MODIFICACIÓN** (D-09): render del footer (donde hoy vive `↑↓ move · / filter · q quit`); ubicación natural del footer-error rojo (alternativa: izar a App.js — Claude's Discretion).
- `src/cli/dashboard/select.js`, `format.js`, `usePoll.js`, `client.js` — **NO MODIFICAR**: helpers puros de Phase 35-36, esta fase no toca derivación/polling/HTTP.
- `src/cmux/client.js:1-80` — **REFERENCIA, NO REUSAR**: muestra el patrón existente para invocar cmux (`execFile`, no-interactivo, 15s timeout). El attach es DIFERENTE: interactivo, `spawn` con `stdio:'inherit'`, sin timeout, foreground. No reusar `run()`; **escribir desde cero en `attach.js`**.
- `src/config.js` — `cmux.binary` (default `/Applications/cmux.app/Contents/Resources/bin/cmux`). El planner debe decidir si `attach.js` usa esa ruta absoluta config-driven, o `'cmux'` desde PATH (criterio #4 habla de ENOENT → PATH-based es el caso a guardar). **Recomendado: leer de `loadConfig().cmux.binary` igual que `src/cmux/client.js`**, así el comportamiento de "cmux not in PATH" es realmente "cmux binary configurado no encontrado" — más resiliente.
- `test/format-isolation.test.js:98-129` — walker que escanea `src/cli/dashboard/**` por `picocolors`. **`attach.js` NO debe importar `picocolors`** (color-isolation invariante D-12 Phase 34).

### Phases previas — decisiones que esta fase preserva
- `.planning/phases/34-fundacion-subcomando-ciclo-de-vida/34-CONTEXT.md` — **D-11** (`Esc` reservada para overlays Phase 38 — D-09 de esta fase NO la viola: el dismiss del footer-error acepta cualquier tecla, no específicamente Esc); **D-10** (SIGTERM handler explícito — D-12 de esta fase lo remueve durante la ventana del attach y lo reinstala al volver); **D-12** (color-isolation: `attach.js` y cualquier render del footer-error usan solo `<Text color>` de ink).
- `.planning/phases/35-datos-cliente-http-polling/35-CONTEXT.md` — **D-01** (status line viva y el indicador `● live` — esta fase no la altera; el polling sigue corriendo en cada iteración fresca del loop), **D-09** (single-flight: no aplica al attach pero sí al re-arranque del polling tras el detach — cada render fresco re-monta `usePoll`).
- `.planning/phases/36-tabla-viva-render-seleccion-filtros/36-CONTEXT.md` — **D-05** (`selectedTaskId` por identidad — base del intent emitido), **D-06** (clamp fallback cuando la sesión seleccionada desaparece — cubre el "session terminó durante el attach" en D-08), **D-08/D-09** (color zombie + marca textual `(zombie)` — el operador anticipa visualmente el rechazo de D-05 antes de pulsar Enter), **D-11** (`Esc` modal en filtro vs lista — D-09 de esta fase no rompe la reserva: el footer-error no es un overlay).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`runDashboard` (`index.js`)** ya es el dueño del proceso (alt-screen, SIGTERM, exit code) — D-01 extiende su responsabilidad con el loop `while(true)` sin cambiar su rol arquitectónico.
- **Patrón DI del proyecto** (Phase 34 D-DI): `runDashboard(deps = {...})` ya recibe `stdout`/`stdin`/`url`; añadir `spawn = childProcess.spawn` sigue el patrón sin invención (D-03).
- **`useApp().exit()`** en App.js (línea 200) ya está cableado para `q`; el handler de Enter lo reusará (`onAttach(...)` + `exit()`).
- **`selectedTaskId` por identidad + `resolveSelection` clamp** (Phase 36 D-05/D-06): el snapshot D-08 lo lee directo del estado de App; al re-render con `initialSnapshot` el clamp cubre el caso "esa sesión ya no está".
- **`isRawModeSupported` guard de `useInput`** (App.js línea 220): preservado tal cual; el handler de Enter vive dentro del bloque `mode === 'list'` existente.
- **Patrón helpers puros + DI sin `mock.module`**: `attach.js` puro (D-04) testeable con `spawn` fake (mismo patrón que `client.js`/`select.js`/`format.js` de Phases 35-36).

### Established Patterns
- **Color-isolation** (Phase 34 D-12): footer-error rojo vía `<Text color="red">`; `attach.js` no debe importar `picocolors` (walker D-13 Phase 34 ya lo verifica para todo `src/cli/dashboard/**`).
- **`React.createElement` plano, sin JSX, sin build step** (Phase 34): cualquier markup nuevo (footer-error, prop adicional en `<App>`) sigue este patrón.
- **Lazy imports en `runDashboard`** (`await import('ink')`, `await import('react')`, `await import('./App.js')` — index.js líneas 98-100): el `await import('./attach.js')` se añade igual; el `await import('node:child_process').spawn` solo se usa si `deps.spawn` no fue inyectado.
- **never-throws + discriminated union** (Phase 35 D-07: `client.js` retorna `{ok, data}` jamás throw): `runAttach` (D-04) sigue exactamente este contrato — `{ok:true} | {ok:false, code, detail}` — para que el loop nunca caiga en un catch-all que rompa el TTY.
- **Mensaje canónico estable** (Phase 34 D-04 con `NON_TTY_MSG`): los tres mensajes de D-10 son strings estables — los tests de mapeo (D-04, "automate what *can* be") los asertan literal.
- **`exit()` clean unmount, NO `process.exit`** (Phase 34 D-08): el handler de Enter llama `exit()` igual que `q`; cero `process.exit` desde React.

### Integration Points
- `src/cli/dashboard/index.js` (**MODIFICADO**): loop `while(true)` reemplaza el `try/finally` lineal de Phase 34 sobre `waitUntilExit`; manejo de señales D-12; alt-screen toggle D-06 alrededor del spawn.
- `src/cli/dashboard/App.js` (**MODIFICADO**): tres props nuevas (`onAttach`, `initialSnapshot`, `initialError`); handler de Enter en el bloque `mode === 'list'`; estado local `attachError` para zombie pre-flight; render condicional del footer-error.
- `src/cli/dashboard/attach.js` (**NUEVO**): orquestador puro; never-throws; discriminated union; usa `spawn` inyectado.
- `src/cli/dashboard/SessionTable.js` (**POSIBLE**, Discretion): render del footer-error rojo cuando se reciba la prop correspondiente.
- `src/server.js`: **NO TOCAR** (constraint dura del milestone — cero endpoints nuevos).
- `src/cmux/client.js`: **NO TOCAR ni reusar** (es execFile no-interactivo; attach necesita spawn interactivo).
- `test/format-isolation.test.js`: cubre automáticamente `attach.js` y cualquier nuevo archivo bajo `src/cli/dashboard/**` (no requiere extensión).
- `.planning/phases/37-attach-handoff-cmux/37-HUMAN-UAT.md` (**NUEVO**, D-13): artefacto bloqueante del cierre de fase.

</code_context>

<specifics>
## Specific Ideas

- **Test load-bearing de TUI-13 + criterio #2 (automatizable):** con `spawn` fake que registra call-order, asertar que `spawn` se llama DESPUÉS de que `waitUntilExit()` resolvió (ordering test). Iterar dos veces (dos attachs consecutivos en el mismo proceso de test) para validar cero leak de handlers de señales entre iteraciones (`process.listenerCount('SIGINT')` debe ser 0 antes y después de cada handoff; `process.listenerCount('SIGTERM')` debe ser 1 mientras App está montado, 0 mientras está desmontado).
- **Test load-bearing de TUI-14 alive===false (automatizable):** render con fixture de `/status` que retorna una sesión con `alive: false`; simular Enter; asertar que `spawn` NO se llamó y que `lastFrame()` contiene `workspace gone (alive=false) — press any key` con color rojo (`<Text color="red">`).
- **Test load-bearing de TUI-14 ENOENT (automatizable):** `spawn` fake que emite `error` con `err.code === 'ENOENT'`; asertar que `runAttach` retorna `{ok:false, code:'ENOENT'}`, que el siguiente render recibe `initialError='[!] cmux not found in PATH — press any key'`, y que el dashboard sigue montado (no crash).
- **Test load-bearing del snapshot (D-08, automatizable):** seleccionar fila B, activar filtro `r:repo1`, simular Enter → attach → close del child → asertar que el siguiente render llega con `initialSnapshot.selectedTaskId === 'B'.task_id` y `initialSnapshot.query === 'r:repo1'`.
- **Caso NO automatizable, exclusivo del UAT manual (D-13.4):** Ctrl-C durante `cmux attach` real, en una terminal TTY real — `ink-testing-library` no puede reproducir esto (fake stdout, no real TTY).
- **Mensajes literal-estables** (los tests de mapeo los asertan literal): `'[!] workspace gone (alive=false) — press any key'`, `'[!] cmux not found in PATH — press any key'`, `'[!] cmux attach failed (code N) — press any key'` (`N` substituido).

</specifics>

<deferred>
## Deferred Ideas

- **Overlays `c` (comentarios por `task_id`) y `l` (logs grep best-effort)** — **Phase 38** (TUI-15/16). `Esc` cerrará overlays en modo lista (honrando el límite modal de Phase 36 D-15). Independiente del attach.
- **`kodo gsd doctor` (limpieza de worktrees huérfanos + sesiones zombie)** — post-v0.9 (PROJECT.md "Deferred candidates"). El zombie-reject de esta fase es defensivo en la UI; el doctor lo limparía proactivamente.
- **Attach con argumentos extra (`cmux attach <ref> --foo`)** — no hay caso de uso definido; el contrato actual es `spawn('cmux', ['attach', workspace_ref], { stdio: 'inherit' })` literal.
- **Reconectar al MISMO attach si Ctrl-C falla en lugar de detach (recovery semántica)** — fuera de scope; si Ctrl-C no detach, es un bug de cmux que no compete a kodo.
- **Notificación visual al detach (toast / sound)** — innecesario; el operador acaba de hacerlo, sabe que volvió.

### Reviewed Todos (not folded)
- **"Surface provider state in dashboard (Plane In Review / GitHub equivalent)"** (`2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`, matched score 0.9 por keyword "dashboard"/área "dashboard") — **scope creep para Phase 37**: requiere modificar `src/server.js` (añadir `provider_state` al payload `/status`), `src/providers/{plane,github}/provider.js` (nuevo método `getTaskState`), `src/cli/dashboard/SessionTable.js` (columna nueva) y `select.js`/`format.js` (helpers). Phase 37 es estrictamente el handoff TTY a cmux; añadir una columna y un campo del payload contradice las constraints duras del milestone ("NO endpoints nuevos, NO modificar SessionRecord/`/status`"). **Belongs en una fase futura** (post-v0.9, o como excepción puntual al constraint de "no nuevos campos en `/status`" en un milestone consolidación posterior). Mantener el todo abierto para roadmap backlog.

</deferred>

---

*Phase: 37-attach-handoff-cmux*
*Context gathered: 2026-05-28*
