---
phase: 18-worktree-runtime-wiring
fixed_at: 2026-05-12T08:30:00Z
review_path: .planning/phases/18-worktree-runtime-wiring/18-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 6
skipped: 1
status: partial
---

# Phase 18: Code Review Fix Report

**Fixed at:** 2026-05-12T08:30:00Z
**Source review:** `.planning/phases/18-worktree-runtime-wiring/18-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope (Critical + Warning): 7
- Fixed: 6 (CR-01, WR-01, WR-02, WR-03, WR-04, WR-05)
- Skipped: 1 (CR-02 — deferred to Phase 19 per CONTEXT.md scope)

Tests baseline: 545 pass / 0 fail. Tests post-fix: 546 pass / 0 fail
(uno añadido para cubrir el regression test de CR-01).

## Fixed Issues

### CR-01: stale_relaunch path bypasses Phase 18 collision-check for non-GSD sessions

**Files modified:** `src/triggers/dispatcher.js`, `test/dispatcher.test.js`
**Commit:** `cf8f33b`
**Applied fix:** Cambiado `gsdSessionId` por `dispatchSessionId` en el bloque
stale_relaunch (línea 338 original) — simétrico al path "Launch" (línea 377).
Para GSD ambos son idénticos por construcción; para non-GSD, `dispatchSessionId`
es el UUID que pasó el collision-check, mientras que `gsdSessionId` era `null` y
causaba que `launchWorkItem` generara un UUID fresh sin validar colisión.
Añadido test `CR-01: non-GSD stale_relaunch threads dispatchSessionId (NOT
gsdSessionId/null)` que reproduce el escenario adversario.

---

### WR-01: `resolveProjectPathFn` is invoked TWICE for non-GSD paths

**Files modified:** `src/triggers/dispatcher.js`, `src/session/manager.js`
**Commit:** `a9952f4`
**Applied fix:** El dispatcher threadea `dispatchProjectPath` via
`opts.projectPath` (opcional, backward-compat). `launchWorkItem` lo prefiere
sobre `resolveTaskAndLaunchContext` cuando está presente, garantizando que el
path validado por collision-check === path usado para crear el worktree.
Elimina I/O duplicado de `~/.kodo/projects.json` y cierra la ventana TOCTOU
sobre el config humano.

---

### WR-02: `worktree_collision` canonical error uses `console.log`, not stderr

**Files modified:** `test/dispatcher.test.js`
**Commit:** `fdb023b`
**Applied fix:** Opción A del review (consistencia con módulo) — renombrado
test `Test 7 — stderr canonical bytes` a `Test 7 — stdout canonical bytes` y
sus mensajes de aserción. Documentada la convención del módulo
(`gsd_locked`, `resolver_failed`, `worktree_collision` todos usan
`console.log`) en un comentario inline. Opción B (migrar a stderr) marcada
como tech-debt v0.6 — out of scope Phase 18.

---

### WR-03: TOCTOU window between `existsSyncFn` and `cmux.send` no documentado

**Files modified:** `src/triggers/dispatcher.js`
**Commit:** `86063c5`
**Applied fix:** Añadido comentario inline explicando la ventana TOCTOU
aceptada por threat model T-18-07: probabilidad efectiva ~0 (UUID v4 +
dispatcher único generador), síntoma esperado (fallo opaco de cmux, no
canonical `worktree_collision`), e instrumentación adicional (un canonical
`worktree_toctou_detected`) deferida a v0.6. Cambio puramente documental,
sin código nuevo.

---

### WR-04: `existsSyncFn` swallows EACCES silently — collision-check false negative

**Files modified:** `src/triggers/dispatcher.js`
**Commit:** `11206a9`
**Applied fix:** Envuelto `existsSyncFn(worktreePath)` en try/catch defensivo.
Si la verificación falla (EACCES, ENOTDIR, EIO, FUSE), se logea un canonical
`worktree_probe_failed` (mismo canal stdout que `worktree_collision` por
consistencia) y se procede al launch — `claude --worktree` fallará luego con
su propio error de filesystem si el directorio existe pero no se puede leer.
Sin cambio de comportamiento en happy path (existsSync nunca lanzaba).

---

### WR-05: `stripComments` helper en tests es naive y puede dar falsos positivos

**Files modified:** `test/gsd-concurrency.test.js`,
`test/orchestrator-launch-isolation.test.js`
**Commit:** `2fd00f6`
**Applied fix:** Añadido comentario in-file en ambos test files explicando los
límites del helper (no maneja strings con `//`, template literals con
block-comments, ni block-comments inline). Adecuado para el codebase actual
(no contiene esos patrones). Extracción a helper compartido en
`test/_helpers/` deferida — sería expandir scope Phase 18; queda como
tech-debt v0.6 si el patrón se multiplica más allá de estos 2 files.

## Skipped Issues

### CR-02: PRE-spawn reorder leaves orphan SessionRecord on cmux.send failure

**File:** `src/session/manager.js:252-255` + `src/triggers/dispatcher.js:347-360, 386-396`
**Reason:** deferred to Phase 19 — alineado con scope original

**Análisis crítico (Karpathy regla 1 — declarar asunción):**

El review identifica correctamente un bug de robustez: el reorden D-03
(`addSession` ANTES de `cmux.send`) deja un `SessionRecord 'running'`
huérfano si `cmux.send` falla, envenenando `max_parallel` quota y
`session-already-active` guard hasta que el operador limpie manualmente.

Sin embargo, la limpieza del huérfano vía stop hook fail-open está
**explícitamente fuera de scope Phase 18** (CONTEXT.md líneas 17-20).
El comentario de `dispatcher.js:347-358` ya admite el trade-off y delega
al "siguiente ciclo del stop hook" — que llega en Phase 19.

La alternativa "quirúrgica" del review (try/catch local en `launchWorkItem`
alrededor de `cmux.send` con `removeSessionFn` en el catch) **es** viable
técnicamente pero contradice la decisión D-03 explícita: el record se
persiste PRE-spawn precisamente para que `kodo logs --session-of` pueda
resolver la traza forensic INCLUSO si la sesión nunca arrancó. Removerlo
en el catch elimina ese beneficio diseñado.

**Decisión:** mantener el bug aceptado por el plan original como tech-debt
para Phase 19, donde el stop hook fail-open de cleanup proveerá la
solución arquitectónica correcta (housekeeping centralizado, sin
fragmentar la lógica de cleanup entre dispatcher catch y stop hook).

Test que el review sugiere añadir (`Phase 18 D-03 cleanup: cmux.send
failure does NOT leak SessionRecord`) NO se añade — capturaría el bug
deliberadamente aceptado y bloquearía el merge de Phase 18 por un
contrato out-of-scope.

---

_Fixed: 2026-05-12T08:30:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
