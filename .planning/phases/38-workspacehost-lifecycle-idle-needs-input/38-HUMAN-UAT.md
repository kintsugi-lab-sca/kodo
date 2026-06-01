---
status: pending
phase: 38-workspacehost-lifecycle-idle-needs-input
source: [38-CONTEXT.md D-14, 38-04-PLAN.md]
started: ~
updated: ~
approved_by: ~
approved_at: ~
fixture: >
  scripts/dev-dashboard-fixture.mjs (Phase 36) + ad-hoc setup para escenarios
  A/B (cerrar pane cmux manualmente / inducir needs-input desde Claude Code
  real). NOTA Phase 38: la reconciliación host↔state corre en el PROCESO SERVER
  (kodo server / startReconcileLoop), no en el dashboard — el dashboard es
  cliente HTTP read-only de GET /status. Para A/B debe haber un `kodo server`
  corriendo además del `kodo dashboard`.
blocking_for_phase_close: true
obligatorios: 4
bonus: 0
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

result: pending
verified_via: ~

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

result: pending
verified_via: ~

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

result: pending
verified_via: ~

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

result: pending
verified_via: ~

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

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
