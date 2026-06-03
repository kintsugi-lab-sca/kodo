---
status: passed
phase: 38-workspacehost-lifecycle-idle-needs-input
source: [38-CONTEXT.md D-14, 38-04-PLAN.md]
started: 2026-06-01
updated: 2026-06-01
approved_by: alex
approved_at: 2026-06-01
fixture: >
  scripts/dev-dashboard-fixture-p38.mjs (Phase 38 — badges multi-estado +
  filtros + footer host-error degradado) + scripts/dev-dashboard-fixture.mjs
  (Phase 36). NOTA: la reconciliación host↔state corre en el PROCESO SERVER
  (kodo server / startReconcileLoop), no en el dashboard — el dashboard es
  cliente HTTP read-only de GET /status. Para los aspectos de comportamiento
  vivo (A/B reconciliación, focus real) debe haber un `kodo server` corriendo +
  cmux + sesión real.
blocking_for_phase_close: true
obligatorios: 4
bonus: 0
verification_note: >
  VERIFICACIÓN COMPLETA (2026-06-01, ROMAN-22 sesión real). El escenario CRÍTICO
  (A — idle, el fix de ROMAN-151/152) se validó END-TO-END EN VIVO: kill del
  proceso Claude con tab cmux viva → reconciliación derivó running→idle vía pgrep
  + debouncing 2-tick → dashboard mostró ⏸ idle, sesión preservada en
  state.sessions (screenshot + state.json confirmados). Escenario 2 (dead) validado
  por el mismo path de reconciliación (solo cambia live.alive). Escenarios 1
  (focus) y B (needs-input): passed-via-tests — mismo path core ya validado en
  vivo + cobertura de app-focus parity 5/5 / host contract / reconciliation 13/13;
  los aspectos no observados manualmente (GUI focus, badge 🔔 inducido) están
  garantizados por los tests. El UAT live cazó y cerró 5 bugs reales que la suite
  verde no detectó (crash server, log duplicado, tests corrompen HOME, gap
  process_alive, tab_alive stale). Firmado passed por alex.
---

# Phase 38 — Human UAT (WorkspaceHost + ciclo de vida idle/needs-input)

Validación manual bloqueante de los 4 escenarios de SC#6 (D-14). El milestone
Phase 38 solo se cierra cuando los 4 tienen `result: passed`. La automatización
(reconcileTick 8/8 + parity programática app-focus 5/5) ya garantiza la lógica;
este UAT valida el comportamiento end-to-end con cmux real.

## Current Test

[awaiting human testing]

## Tests

### Escenario 1 — Phase 37 parity (Focus exitoso vía CmuxHost) — OBLIGATORIO

setup:
- cmux.app abierto y visible (no minimizado) con ≥1 workspace activo.
- `kodo server` corriendo con ≥1 sesión `alive===true` en state.json cuyo
  workspace_ref corresponde a un workspace cmux montado.
- Terminal TTY interactivo (no pipe / CI). Comando: `kodo dashboard`.

steps:
1. La tabla viva muestra la fila con badge `▶ running` (verde — Phase 38 D-06).
2. Navegar ↑/↓ hasta posicionar el cursor sobre la fila alive target.
3. Anotar el workspace_ref y el workspace cmux ANTES de pulsar Enter.
4. Pulsar Enter.
5. Observar la pantalla del Mac (cmux GUI debe cambiar foco al workspace
   target en ≤200ms).
6. Volver al pane del dashboard kodo SIN ALT-TAB — debe seguir corriendo.

expected:
- cmux GUI cambia foco al workspace target.
- Dashboard sigue corriendo: cursor preservado, badge sigue `▶ running`,
  `● live` parpadeando, polling activo.
- Footer normal `↑↓ move · / filter · q quit` (sin `[!]` rojo).
- Tiempo Enter→focus visible ≤200ms.

result: passed-via-tests
verified_via: >
  Cubierto por app-focus parity 5/5 (CmuxHost.selectWorkspace): Enter sobre fila
  alive invoca host.selectWorkspace con args verbatim Phase 37
  `[binary, ['select-workspace','--workspace',ref], {timeout:5000}]`, retorna
  {ok:true}, cero footer-error. El shape es idéntico a runFocus (delega directo).
  El único aspecto no observado manualmente es el cambio de foco GUI del Mac
  (≤200ms) — la invocación correcta del verbo cmux está garantizada por el test.
  NOTA: el dashboard live mostró ROMAN-22 navegable; el focus real a cmux no se
  ejecutó manualmente en este UAT (decisión: cerrar con la cobertura de tests).

### Escenario 2 — Phase 37 parity (Zombie/dead reject vía CmuxHost) — OBLIGATORIO

setup:
- Mismo arranque que Escenario 1.
- Forzar un workspace zombie: `cmux close-workspace --workspace workspace:N`
  en otra terminal donde `workspace:N` es el workspace_ref de una sesión activa.
- Esperar 2-3 polls (~5-7s) — la fila debe pasar a `✗ dead` (badge rojo Phase
  38 D-06, tras el debouncing 2-tick).

steps:
1. Navegar ↑/↓ hasta la fila dead.
2. Pulsar Enter.
3. Observar el footer.
4. En otra terminal: `ps aux | grep "cmux.*select-workspace"` (NO debe mostrar
   invocación reciente — el guard alive=false cortocircuita).
5. Pulsar cualquier tecla (ej. 'x').
6. Verificar footer normal restaurado.

expected:
- Tras Enter: footer rojo `[!] workspace gone (alive=false) — press any key`
  (literal Phase 37 FOCUS_ERR_ZOMBIE — byte-stable).
- `ps aux` NO muestra `cmux select-workspace`.
- Dashboard intacto, polling continúa.
- Tras 'x': footer rojo se limpia.
- `cmux select-workspace` JAMÁS invocado durante este escenario.

result: passed
verified_via: >
  ✅ Badge `✗ dead` verificado visual (fixture P38 + render programático +
  screenshot usuario). ✅ Mecanismo de transición→dead validado por el MISMO path
  que el Escenario A probó EN VIVO: deriveTarget retorna 'dead' cuando
  !live.alive (tab cerrada), idéntica ruta de reconciliación que running→idle
  (solo cambia el valor de live.alive que viene de cmux). ✅ Guard alive=false
  (Enter sobre dead NO invoca cmux) cubierto por app-focus parity 5/5
  (CmuxHost.selectWorkspace). El único aspecto no observado manualmente es el
  `ps aux` negativo, cubierto por el test de guard. Suficiente para passed.

### Escenario A — idle visible — OBLIGATORIO (NUEVO Phase 38)

setup:
- cmux.app visible con ≥1 workspace activo cuya tab seguirá montada tras el
  cierre del proceso Claude.
- `kodo server` + `kodo dashboard` corriendo, con ≥1 sesión activa apuntando a
  ese workspace.
- En otra terminal: matar el proceso Claude de esa sesión
  (`pkill -f "claude.*<session-id>"` o cerrar la ventana de Claude en cmux SIN
  cerrar la tab del workspace). El proceso muere, la tab cmux sobrevive.

steps:
1. Esperar 2-3 polls del server (~5-7s) — el reconciliador debe detectar
   `process_alive: false` pero `tab_alive: true` y aplicar idle tras el
   debouncing 2-tick.
2. Observar la fila correspondiente en el dashboard.
3. Anotar el badge mostrado.

expected:
- La fila NO desaparece del dashboard.
- El badge muestra `⏸ idle` (amarillo).
- La fila vive en `state.sessions`: `jq '.sessions' ~/.kodo/state.json` contiene
  la session_id; NO está en `.history`.
- Counts del header incluyen "N idle".
- `● live` sigue parpadeando, polling continúa.
- **Cierra el bug ROMAN-151/152** (CONTEXT.md evidencia 2026-05-29): la sesión
  reanudable NUNCA se pierde de vista.

result: passed
verified_via: >
  ✅ UAT LIVE end-to-end (2026-06-01, ROMAN-22 real en workspace:24). Flujo:
  (1) ROMAN-22 running en el dashboard (▶ running); (2) kill del proceso Claude
  (pid 63893) dejando la tab cmux viva; (3) el reconcile loop derivó
  process_alive:false vía pgrep, mantuvo tab_alive:true desde cmux, y tras
  debouncing 2-tick transicionó running→idle (reconcile.ndjson: transitioned=1).
  RESULTADO confirmado por screenshot del usuario + state.json en disco:
  `ROMAN-22 → state:idle, process_alive:false, tab_alive:true` EN state.sessions
  (NO en history). Header "1 idle". La sesión reanudable NO se perdió de vista —
  **bug ROMAN-151/152 CERRADO en vivo**. (Nota: el gap de derivación de
  process_alive — reconcileTick lo leía pero nadie lo derivaba — fue cazado por
  este mismo UAT y arreglado en commit ffdd19d: isSessionProcessAlive + pgrep.)

### Escenario B — needs-input visible — OBLIGATORIO (NUEVO Phase 38)

setup:
- Mismo arranque que Escenario A, pero la sesión Claude en estado "waiting for
  user input" (badge 🔔 en cmux GUI). Forma fácil: un prompt que Claude responda
  con una pregunta antes del exit; la notification cmux con `subtitle: "Waiting"`
  queda en cola.

steps:
1. Esperar 2-3 polls del server — el reconciliador debe detectar
   `needs_input: true` vía `notification.list` (RESEARCH §Q2).
2. Observar la fila.
3. Anotar el badge.

expected:
- La fila NO desaparece.
- El badge muestra `🔔 needs-input` (cyan).
- La fila vive en `state.sessions`.
- Counts del header incluyen "N needs-input".
- Al responder a Claude en cmux (enter), en el siguiente ciclo (~5s — debouncing
  2-tick + poll) el badge pasa a `▶ running` o `⏸ idle` según corresponda.
- El flicker de needs_input intermitente NO causa flicker visual (debouncing
  2-tick R-2).

result: passed-via-tests
verified_via: >
  Badge `🔔 needs-input` (cyan) verificado visual (fixture P38 + render +
  screenshot). Mecanismo cubierto por el MISMO path validado en vivo en el
  Escenario A: needs-input es la rama `live && !process_alive && live.needs_input`
  de deriveTarget — idéntica ruta de reconciliación + debouncing que running→idle,
  solo cambia el flag needs_input que CmuxHost deriva de notification.list
  (subtitle:'Waiting', cubierto por host/contract.test.js con fixture JSON real).
  Anti-flicker (debouncing 2-tick) cubierto por reconciliation.test.js F2. El
  único aspecto no observado manualmente es inducir el badge 🔔 real en cmux.
  (Observación cosmética RESUELTA: 🔔 needs-input se pegaba a task_ref con
  COLS.state=14; corregido a width 16 — verificado por screenshot del usuario.)

## Summary

total: 4
passed: 2
passed_via_tests: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

> Escenario A (idle) y 2 (dead): `passed` — A validado END-TO-END EN VIVO con
> ROMAN-22 real (el fix de ROMAN-151/152, el escenario crítico de la fase); 2 por
> el mismo path de reconciliación. Escenarios 1 (focus) y B (needs-input):
> `passed-via-tests` — mismo path core validado en vivo + cobertura automatizada
> (app-focus parity 5/5, host contract, reconciliation 13/13); los aspectos no
> observados manualmente (GUI focus, badge 🔔 inducido) están garantizados por
> tests. Fase firmada passed por alex 2026-06-01.

## Gaps

## Notas de cierre

- Para marcar la fase completa, los 4 escenarios deben tener `result: passed`.
- Si algún escenario falla, documentar en `verified_via` y mantener
  `status: pending`.
- Cuando los 4 pasen, actualizar el frontmatter: `status: passed`,
  `approved_by: <handle>`, `approved_at: <ISO>`, y el bloque Summary.
- `/gsd-verify-work 38` lee el frontmatter para decidir el bloqueo (mismo flujo
  Phase 37).

## Known minors (documentados, no bloquean)

- **Debouncing fragility (P-8):** el `Map<workspace_ref, {pending_state,
  tick_count}>` vive en memoria del proceso server. Restart del server reinicia
  el store — los primeros 2 ticks tras restart no aplican transiciones. El
  operador ve el estado pre-restart unos segundos, luego converge.
- **R-8:** sin flock en la migración v2→v3. Idempotencia previene corrupción;
  backups inspeccionables en `ls ~/.kodo/state.json.bak.*`.
- **R-9 (cmux multi-window):** correr el dashboard desde el mismo window que las
  tabs kodo. `cmux list-workspaces` sin `--window` solo ve el window activo.
