---
phase: 58-ciclo-de-vida-de-cierre-deuda-heredada-de-v0-12
status: passed
verified: 2026-06-23
suite: 1499 pass / 0 fail / 1 skip (full) · 8/8 isolation walkers
human_verification:
  count: 0
  note: "DEBT-02 HUMAN-UAT 50.1 validado 2026-06-23 — esc.1/3 en vivo (prog 3/7 + gate), esc.2 (keep-last-good) vía test de componente app-progress-keeplast.test.js. F2 (labels) corregido c87baad."
---

# Phase 58 Verification — Ciclo de vida de cierre + deuda v0.12

## LIFE-03 — Hook SessionEnd ✅ PASSED

### SC1 — `/exit` dispara cleanup terminal limpio; la fila desaparece en vez de quedar `dead` ✅
**Evidencia:**
- Nuevo hook `src/hooks/session-end.js` (`runSessionEndHook`) registrado vía `install.js` (tercer evento). Hace: typed `session.end` event → `releaseGsdLock` backstop → `performTerminalCleanup` (worktree + promptFile + removeSession).
- `removeSession` archiva la fila a history → desaparece del dashboard. Tests: `test/hooks/session-end.test.js` (sesión viva → session.end + removeSession llamado).

### SC2 — Reusa el cleanup de stop.js SIN duplicar ✅
**Evidencia:**
- Helper compartido `src/hooks/terminal-cleanup.js` (`performTerminalCleanup`) — la secuencia destructiva extraída de stop.js, reusa `cleanupWorktree` (Phase 41 D-11, también usado por doctor.js). `stop.js` ya no la contiene (refactor T-58-01-3); `session-end.js` la invoca. Cero duplicación.

### SC3 — Separación Stop (per-turn → idle) vs SessionEnd (cierre → cleanup terminal) ✅ (D-1)
**Evidencia:**
- `stop.js` conserva solo: `setColor(review)`, `notify`, `markSessionStatus('idle','session-stop:lock-released')`, `releaseGsdLock`, nudge, `handleOrchestratorStop`. Ya NO llama `removeSession`/`cleanupWorktree`/`removePromptFile` ni emite el typed `session.end`.
- Regression asserts: `test/stop-state-transition.test.js` (Stop NO remueve), `test/stop.test.js` source-hygiene (orden lock→cleanup ahora en session-end.js).

### SC4 — Idempotencia entre los dos hooks ✅ (D-3)
**Evidencia:**
- Guard `source === 'history'` en `runSessionEndHook` (espejo de stop.js:154). `test/hooks/stop-idempotency.test.js` (re-apuntado a SessionEnd): primera invocación archiva, segunda hace no-op (removeSession NO llamado, history no duplicado). `test/hooks/session-end.test.js`: no-op en source=history y sin sesión.
- Cero estado nuevo en el schema de sesión.

### SC5 — never-throws / fail-open ✅ (D-4)
**Evidencia:** outer try/catch en `runSessionEndHook` + try por paso en `performTerminalCleanup`. Test: "un removeSessionFn que lanza NO crashea el hook" (assert.doesNotReject).

### SC6 — Rescate desde history conservado (D-2) ✅
**Evidencia:** `src/session/reconcile.js` NO se tocó. El rescate (líneas 195-222) sigue intacto como defensa en profundidad.

### SC7 — install/uninstall al tercer evento, golden-bytes preservados ✅
**Evidencia:** `install.js` añade `SessionEnd` vía `addHook` (idempotente, sin clobber); `uninstall` lo limpia. `test/hooks/install.test.js` Test 1 (SessionEnd registrado) + Test 1b (uninstall lo quita, preserva ajenos). SessionStart/Stop intactos.

## DEBT-01 — XSS WR-01 ✅ PASSED (ya estaba mitigado)
Ver `.planning/REQUIREMENTS.md`. El item estaba **stale**: la allowlist `safeHref` (http(s) vía `new URL()`) ya estaba en `src/server.js` desde commit `77a5c0c` (T-48-10), aplicada a los 3 renders de `task_url`. Test de regresión añadido: `test/server-xss-allowlist.test.js` (`976f8a6`).

## DEBT-02 — HUMAN-UAT 50.1 ✅ PASSED (2026-06-23)
Validado en TTY real (dashboard kodo) sembrando un `STATE.md` con `progress:` en una sesión `gsd:true` viva (ROMAN-175):
- **Esc.1** (prog desde STATE.md): la columna `prog` mostró `3/7` leído del worktree ✅.
- **Esc.3** (gate GSD/no-GSD): ROMAN-175 mostró `3/7`; las adoptadas/no-gsd `—` ✅.
- **Esc.2** (keep-last-good): validado vía test de componente determinista `test/dashboard/app-progress-keeplast.test.js` (ink-testing-library) — ante un fallo transitorio la columna MANTIENE `N/M`. La anomalía observada en vivo (columna desaparece) fue el worktree borrándose al terminar la sesión (ENOENT → `no-progress`, correcto), NO un fallo del keep-last-good.

**Hallazgos colaterales de la UAT:** F2 (getTask perdía labels) corregido `c87baad`; F3 y F5 fueron misdiagnósticos corregidos; Phase 61 (progreso de sesiones adoptadas) registrada; F4 (worktree base) por verificar.

## Tests (live, 2026-06-19)
```
npm test → tests 1500 · pass 1499 · fail 0 · skipped 1
node --test test/hooks/session-end.test.js test/hooks/install.test.js → 11 pass
node --test test/stop*.test.js test/hooks/stop-idempotency.test.js → 42 pass
node --test test/format-isolation.test.js test/cmux-isolation.test.js → 8 pass
```

## Veredicto

**LIFE-03 + DEBT-01: PASSED.** Código mergeable, suite verde, walkers verde. **DEBT-02: human_needed** — el HUMAN-UAT 50.1 queda para el operador en TTY real. La fase se cierra en código; la deuda de verificación humana es la única pendiente (reconocida, no bloqueante para el código).
</content>
