---
status: pending
phase: 37-attach-handoff-cmux
source: [37-CONTEXT.md D-08, 37-VALIDATION.md]
started: 2026-05-28
updated: 2026-05-28
approved_by: pending
approved_at: pending
fixture: scripts/dev-dashboard-fixture.mjs
blocking_for_phase_close: true
obligatorios: 2
bonus: 2
---

## Current Test

[Escenario 1: Focus exitoso visible — pendiente de ejecutar manualmente]

## Tests

### 1. Focus exitoso visible (obligatorio — bloqueante para cierre de fase)

setup:
- cmux.app abierto y visible (no minimizado) con ≥1 workspace activo.
- server kodo corriendo con ≥1 sesión `alive===true` en `state.json` cuyo `workspace_ref` corresponde a un workspace cmux montado.
- Terminal TTY interactivo (no pipe / CI).
- Comando: `kodo dashboard` (o `node bin/kodo dashboard`).

steps:
1. La tabla viva muestra ≥1 fila con status verde (alive=true).
2. Navegar con ↑/↓ hasta posicionar el cursor (`›`) sobre la fila alive target.
3. Anotar el `workspace_ref` mostrado en `task_ref` y el workspace cmux ANTES de pulsar Enter.
4. Pulsar Enter.
5. Observar la pantalla del Mac (la app cmux GUI debe cambiar foco al workspace target en ≤200ms).
6. Volver al pane del dashboard kodo SIN ALT-TAB ni gestos de window manager — el dashboard debe seguir corriendo en su pane original.

expected:
- La app cmux GUI cambia el foco al workspace `workspace:N` (visible en la GUI macOS).
- El dashboard kodo sigue corriendo en su pane: cursor preservado sobre la fila, indicador `● live` sigue parpadeando, polling activo.
- El footer del dashboard sigue siendo `↑↓ move · / filter · q quit` (sin `[!]` rojo).
- Tiempo del Enter al focus visible: ≤200ms percibido.

result: pending
verified_via: (pendiente — requiere TTY real + cmux.app visible)

### 2. Zombie reject (obligatorio — bloqueante para cierre de fase)

setup:
- Mismo arranque que escenario #1: dashboard activo con ≥1 sesión.
- Forzar un workspace zombie: `cmux close-workspace --workspace workspace:N` en otra terminal donde `workspace:N` es el `workspace_ref` de una sesión activa en `state.json` (sin matar el server kodo).
- Esperar el próximo poll (~2s); la fila debe pasar a status rojo con marca textual `(zombie)`.

steps:
1. Navegar con ↑/↓ hasta posicionar el cursor sobre la fila zombie.
2. Pulsar Enter.
3. Observar el footer del dashboard.
4. En otra terminal: `ps aux | grep cmux | grep select-workspace` (debe NO mostrar ninguna invocación reciente — el guard cortocircuitó).
5. Pulsar cualquier tecla (ej. 'x').
6. Verificar que el footer normal se restaura.

expected:
- Tras Enter: footer rojo `[!] workspace gone (alive=false) — press any key` reemplaza el footer normal.
- `ps aux` NO muestra invocación de `cmux select-workspace` (el guard D-02 cortocircuitó ANTES de llamar a `runFocus`).
- Dashboard intacto: indicador `● live` sigue, polling sigue, cursor preservado.
- Tras pulsar 'x': footer rojo se limpia, footer normal `↑↓ move · / filter · q quit` se restaura.
- El comando `cmux` JAMÁS fue invocado durante este escenario.

result: pending
verified_via: (pendiente — requiere TTY real + cross-process verification con `ps aux`)

### 3. ENOENT (bonus, opcional — no bloqueante)

setup:
- Renombrar temporalmente el binario: `mv /Applications/cmux.app/Contents/Resources/bin/cmux /Applications/cmux.app/Contents/Resources/bin/cmux.bak`.
- Lanzar `kodo dashboard`.

steps:
1. Navegar a una fila con `alive===true`.
2. Pulsar Enter.
3. Restaurar el binario: `mv /Applications/cmux.app/Contents/Resources/bin/cmux.bak /Applications/cmux.app/Contents/Resources/bin/cmux`.

expected:
- Footer rojo `[!] cmux not found in PATH — press any key`.
- Dashboard sigue funcional, no crashea.

result: pending (optional, no bloqueante)
verified_via: (opcional)

### 4. Exit code ≠ 0 (bonus, opcional — no bloqueante)

setup:
- Forzar ref inválido: editar manualmente `state.json` para que una sesión tenga `workspace_ref: 'workspace:99999'` (id que no existe en cmux).
- Lanzar `kodo dashboard`.

steps:
1. Navegar a la fila con `workspace:99999` (mantendrá `alive:true` artificialmente; recordar restaurar después).
2. Pulsar Enter.
3. Restaurar `state.json`.

expected:
- Footer rojo `[!] cmux focus failed (code N) — press any key` (con N = exit code real de cmux).
- Dashboard sigue funcional.

result: pending (optional, no bloqueante)
verified_via: (opcional)

## Summary

total: 4 (2 obligatorios + 2 bonus opcionales)
passed: 0
issues: 0
pending: 2 obligatorios bloqueantes + 2 bonus opcionales
skipped: 0
blocked: 0

## Gaps

(pending — UAT por ejecutar; los 2 obligatorios son bloqueantes para `gsd-verify-work` por D-08).

---

**Notas de cierre (D-08):**
- Para marcar la fase como completa, los escenarios **1** y **2** deben tener `result: passed`.
- Los escenarios **3** y **4** pueden quedar como `pending` o `skipped` sin bloquear el cierre.
- Cuando los 2 obligatorios pasen, actualizar el frontmatter: `status: passed`, `approved_by: <handle>`, `approved_at: <ISO>`. `gsd-verify-work` lee el frontmatter para decidir si bloquear.
- Si algún escenario obligatorio falla, documentar en `verified_via` y mantener `status: pending`. NO marcar la fase como completa.
