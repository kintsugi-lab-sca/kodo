---
phase: 42-dismiss-tui-read-write-server-amplification
fixed_at: 2026-06-05T13:30:00Z
review_path: .planning/phases/42-dismiss-tui-read-write-server-amplification/42-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 42: Code Review Fix Report

**Fixed at:** 2026-06-05T13:30:00Z
**Source review:** .planning/phases/42-dismiss-tui-read-write-server-amplification/42-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (WR-01, WR-02, WR-03)
- Fixed: 3
- Skipped: 0

## Fixed Issues

### WR-01: `dismissSession` pasa `armedTaskId` tipado como `string | null` sin guard

**Files modified:** `src/cli/dashboard/App.js`
**Commit:** `62fee01`
**Applied fix:** Añadido guard defensivo de 4 líneas antes del `await dismissSession(...)`: si `armedTaskId` es falsy, resetea `armedTaskRef` a null, vuelve a modo `list` y retorna sin ejecutar el DELETE. No altera ningún camino alcanzable del state-machine actual; cierra la discrepancia de tipos `string | null` → `string`.

---

### WR-02: Handler `DELETE /sessions/` acepta ID vacío sin validación

**Files modified:** `src/server.js`
**Commit:** `9599f18`
**Applied fix:** Añadido guard explícito después de `decodeURIComponent`: si `taskId` es falsy (URL `/sessions/` sin segmento), responde HTTP 400 con `{ok:false, error:'missing session id'}` antes de llamar al `dismissHandler`. La forma `{ok, error}` es consistente con las respuestas del propio `dismiss.js` (409 y 500). Ningún test existente cubre ese path, no se requirió actualizar tests de e2e.

---

### WR-03: `sessionDismissed` no tenía test de contrato de emisión en `logger-events.test.js`

**Files modified:** `test/logger-events.test.js`
**Commit:** `2ab550d`
**Applied fix:** (1) Añadido `sessionDismissed` al destructuring de import del módulo `logger-events.js` (estaba ausente). (2) Añadido `it(...)` al final del bloque `describe` existente que llama `sessionDismissed(log, { task_id: 'KL-42', actions_count: 3 })`, lee la línea NDJSON emitida y aserta `line.event === EVENTS.SESSION_DISMISSED`, `line.task_id === 'KL-42'`, `line.actions_count === 3`. Patrón espeja los helpers existentes (worktreeCleanupOk, pollingTick, etc.).

---

## Test suite final

- Baseline pre-fix: 1182 pass / 0 fail / 1 skip
- Post-fix: **1183 pass / 0 fail / 1 skip** (+1 test nuevo de WR-03)
- No test existente requirió actualización por los cambios de source.

---

_Fixed: 2026-06-05T13:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
