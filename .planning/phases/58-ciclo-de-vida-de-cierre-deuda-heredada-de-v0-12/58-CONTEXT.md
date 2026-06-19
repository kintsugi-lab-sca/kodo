# Phase 58: Ciclo de vida de cierre + deuda heredada de v0.12 - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning (LIFE-03). DEBT-01 ya cerrado; DEBT-02 es UAT humano.

<domain>
## Phase Boundary

Tres items independientes, distinto estado:
- **DEBT-01 (XSS WR-01)** — ✅ **YA CERRADO.** El item estaba stale: la allowlist `safeHref` (`new URL()` → solo `http(s)`) ya estaba mitigada en commit `77a5c0c` (T-48-10), aplicada a los 3 renders de `task_url` vía `refAnchor`. Test de regresión añadido (`976f8a6`, `test/server-xss-allowlist.test.js`). NO requiere más trabajo.
- **LIFE-03 (hook `SessionEnd`)** — el trabajo real de esta fase. Una sesión cerrada con `/exit` queda colgada como `dead` porque kodo no escucha `SessionEnd`. Re-coreografiar el lifecycle: `Stop` (per-turn) → estado ligero; `SessionEnd` (cierre real) → cleanup terminal destructivo.
- **DEBT-02 (HUMAN-UAT 50.1)** — verificación visual de los 3 escenarios del display de progreso vivo `N/M` en un TTY real con sesión GSD viva. **Solo el operador puede ejecutarlo** (`50.1-HUMAN-UAT.md`). No es decisión de diseño.

</domain>

<decisions>
## Implementation Decisions — LIFE-03 (LOCKED en discuss 2026-06-19)

### D-1 — Reparto Stop vs SessionEnd: Stop→idle / SessionEnd→cleanup terminal
- **`Stop`** (dispara al final de CADA turno) deja de llamar `removeSession`. Conserva solo el estado ligero: `markSessionStatus(..., 'idle', 'session-stop:lock-released')`, color `review`, nudge al orquestador, `releaseGsdLock` (lock release per-turn está OK — es idempotente y verifica session_id). NO toca `removeSession`/worktree/promptFile.
- **`SessionEnd`** (dispara una vez al cierre `/exit` u otro `end_reason`) hace el cleanup DESTRUCTIVO: `removeSession` + `cleanupWorktree` + `removePromptFile`. Reusa el lock release si aún no se hizo.
- **Helper compartido:** el bloque de cleanup terminal se extrae a un helper reusado por `SessionEnd` (y referenciable desde Stop si hiciera falta), **sin duplicar** el código de `stop.js`. (Goal LIFE-03: "reusa el cleanup de stop.js, sin duplicar".)
- **Rechazado:** mover TODO a SessionEnd dejando Stop como no-op de estado — rompería el feedback per-turn (`idle`/lock-released) del que depende el dashboard hoy.

### D-2 — Rescate desde history: CONSERVAR como defensa en profundidad
- `reconcileTick` rescata desde `history` (`reconcile.js:195-222`, Phase 38 / ROMAN-151/152) las sesiones cuyo `workspace_ref` sigue vivo. Existe porque `Stop` archivaba sesiones vivas cada turno. Al mover `removeSession` a `SessionEnd`, esa causa principal desaparece — pero el rescate **se conserva intacto** como red de seguridad ante un `Stop` espurio / crash / archivado prematuro.
- **NO se toca `reconcile.js`** en esta fase — minimiza blast radius (Tier-3). Solo se le retira la causa de trabajo, no la red.
- **Rechazado:** eliminar/simplificar el rescate — más limpio pero pierde la red de seguridad y amplía el blast radius.

### D-3 — Idempotencia Stop↔SessionEnd: guard por source+estado (espejo del existente)
- Cada hook es idempotente por sí mismo; los órdenes `Stop→SessionEnd`, `SessionEnd` solo, o `Stop` múltiple (per-turn) convergen sin doble cleanup.
- Reusa el patrón YA presente en `stop.js:153-157` (`if (result.source === 'history') skip`). `SessionEnd` verifica `findSession` y si la sesión ya fue removida/archivada → no-op silencioso. Re-check fresco antes del cleanup destructivo.
- **Cero estado nuevo** en el schema de sesión. **Rechazado:** flag explícito `closing_at` — añade superficie de bugs sin necesidad.

### D-4 — Robustez del hook (heredado, no negociable)
- `SessionEnd` handler es **never-throws / fail-open** como el resto de hooks (jamás crashea Claude Code) — espejo del outer try/catch de `runStopHook`.
- `install.js` / `uninstall` extendidos al tercer evento (`SessionEnd`), sin clobber de hooks existentes (`addHook` ya idempotente). **Golden-bytes de los hooks existentes (SessionStart/Stop) preservados.**

</decisions>

<code_context>
## Existing Code Insights

- `src/hooks/stop.js` — `runStopHook(input, deps)`: hoy hace `markSessionStatus('idle')` (línea 205) + `sessionEnd` event (222) + `releaseGsdLock` (236-243) + `cleanupWorktree` (254-278) + `removePromptFile` (283) + `removeSessionFn(id)` (285). El cleanup destructivo (worktree/promptFile/removeSession) es lo que migra a SessionEnd. Guard de idempotencia ya existente: líneas 150-157 (`source === 'history'` skip).
- `src/hooks/worktree-cleanup.js` — `cleanupWorktree` ya es el helper compartido (Phase 41 D-11), reusado por doctor.js. SessionEnd lo reusa.
- `src/hooks/install.js` — `addHook(settings.hooks, 'SessionStart'|'Stop', cmd)` idempotente, sin clobber. Extender a `SessionEnd`.
- `src/session/reconcile.js:195-222` — rescate desde history (NO tocar).
- `src/session/state.js` — `findSession` (escanea history desde Phase 30), `removeSession` (archiva a history).
- Patrón de hook test: `runStopHook(input, deps)` con DI (findSessionFn/removeSessionFn/cmux/loggerFactory). `SessionEnd` debe seguir el mismo patrón testeable (input, deps).

## DEBT-01 (cerrado, referencia)
- `src/server.js:168-184` (`safeHref`/`refAnchor`) — allowlist http(s), client-side. Test: `test/server-xss-allowlist.test.js`.

</code_context>

<specifics>
## Specific Ideas

- El payload de `SessionEnd` de Claude Code incluye `reason`/`end_reason` — el handler puede loguearlo pero el cleanup es incondicional (toda sesión terminada se limpia). Verificar el shape real del evento `SessionEnd` en research.
- `releaseGsdLock` es idempotente y verifica session_id → seguro llamarlo desde ambos hooks.
- Mantener el `sessionEnd` typed event (logger-events.js) en el punto correcto del nuevo reparto (probablemente en SessionEnd, no en Stop, para que el observable refleje el cierre real).

</specifics>

<deferred>
## Deferred Ideas

- DEBT-02 (HUMAN-UAT 50.1) NO es código — es verificación humana en TTY. Se cierra fuera del plan de código, con el operador ejecutando `50.1-HUMAN-UAT.md`.

</deferred>

<canonical_refs>
## Canonical References

- `.planning/REQUIREMENTS.md` — LIFE-03 (línea 47), DEBT-01 (40), DEBT-02 (41).
- `.planning/STATE.md` §"Open Questions" Phase 58 (LIFE-03 — mapeo del baile Stop↔reconcile↔needs-input).
- `.planning/phases/50.1-*/50.1-HUMAN-UAT.md` — los 3 escenarios de DEBT-02 (UAT humano).
- `src/hooks/stop.js`, `src/hooks/worktree-cleanup.js`, `src/hooks/install.js`, `src/session/reconcile.js` (rescate, NO tocar).

</canonical_refs>
</content>
