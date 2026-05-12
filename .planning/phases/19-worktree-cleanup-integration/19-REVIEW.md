---
phase: 19-worktree-cleanup-integration
reviewed: 2026-05-12T17:24:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/gsd/verify.js
  - src/hooks/stop.js
  - src/logger-events.js
  - test/gsd-verify-integration.test.js
  - test/logger-events.test.js
  - test/stop-state-transition.test.js
  - test/stop-worktree-cleanup.test.js
  - test/stop.test.js
findings:
  blocker: 0
  warning: 5
  total: 5
status: issues_found
---

# Phase 19: Code Review Report (post Wave 3)

**Reviewed:** 2026-05-12T17:24:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found (warnings only — no blockers)

## Summary

Wave 3 (plan 19-03) cierra correctamente las dos brechas detectadas en la primera pasada de code review:

- **CR-02 (markSessionStatus solo dentro de `if (session.gsd)`)** — FIXED.
  `src/hooks/stop.js:152-176` reubica el mark fuera del `if (session.gsd)` que envuelve `releaseGsdLock`. El error de mark se diagnostica vía `console.error` en lugar de `catch {}` silencioso (WR-03 del plan 19-03 cumplido). El reason canónico ya es `'session-stop'` (sin sufijo `:lock-released`). El source-hygiene test `Phase 19 CR-02` cierra el invariante por regex y verifica que la cadena antigua desaparece.
- **CR-03 (`existsSync` seguía symlinks)** — FIXED.
  `src/hooks/stop.js:302-314` reemplaza `existsSync(target)` por `lstatSync(target)` dentro de try/catch que discrimina `ENOENT`. Cualquier stat exitoso (file, dir, symlink vivo o colgante) o error distinto de ENOENT fuerza la variante suffixed. Los dos tests nuevos (`DANGLING SYMLINK`, `REGULAR FILE`) en `test/stop-worktree-cleanup.test.js:235-316` ejercitan los escenarios exactos que la versión existsSync no cubría. El source-hygiene test `Phase 19 CR-03` impide regresión.

CR-01 (orden cleanup/removeSession vs orchestrator-led verify) está formalmente deferido a Phase 21+ vía override D-07 documentado en VERIFICATION.md (no se re-flagea aquí, según consigna).

Riesgos NUEVOS introducidos por Wave 3: ninguno con severidad blocker. Sí hay un puñado de warnings —principalmente en torno a logger instancing duplicado, redundancia tras el relocate de CR-02, y matices de fail-open en la pre-check de lstat— que conviene cerrar como tech debt menor (no bloqueante para shipping).

## Blockers

(ninguno)

## Warnings

### WR-01: Logger creado dos veces por sesión cuando hay worktree_path

**Archivo:** `src/hooks/stop.js:159-167` y `src/hooks/stop.js:220-228`
**Severidad:** Warning
**Issue:**
El bloque CR-02 instancia un logger (`log`) líneas 159-167 para `markSessionStatus` y `sessionEnd`. Más abajo, el bloque worktree cleanup vuelve a instanciar otro logger (`cleanupLog`) líneas 220-228 con exactamente la misma factoría y bindings (`{session_id, task_id}`). En producción, esto:

1. Llama a `createLogger(...)` dos veces para la misma sesión → dos cadenas `.child(...)` independientes → potencial duplicación de file descriptors NDJSON si el sink no es perezoso.
2. Hace la lectura del código confusa: a primera vista parece que `cleanupLog` necesita un binding diferente, pero los argumentos a `loggerFactory` son idénticos.
3. Rompe ligeramente con el comment del propio archivo (línea 156: "El logger se construye UNA sola vez y se comparte entre markSessionStatus + sessionEnd").

**Fix:** Reutilizar `log` para los eventos `worktreeCleanup*`. Reemplazar el segundo bloque por `const cleanupLog = log;` o, mejor, eliminar la variable y usar `log` directamente. Si la separación importa para tener un `component` distinto, hacerlo explícito con `log.child({ component: 'worktree' })` en una sola línea — no re-instanciar la cadena entera.

```js
// Reemplazar 220-228 por:
const cleanupLog = log; // o: const cleanupLog = log.child({ component: 'worktree' });
```

---

### WR-02: Comentario obsoleto contradice el nuevo orden tras CR-02

**Archivo:** `src/hooks/stop.js:193-195`
**Severidad:** Warning
**Issue:**
El comentario dice: *"Phase 19 CR-02: markSessionStatus ya corrió ANTES de este bloque para todas las sesiones; aquí solo queda el lock release para sesiones GSD."* Correcto. Pero el comentario inmediatamente anterior (líneas 178-180) afirma: *"Emit typed session.end event BEFORE removeSession so the logger captures the transition while the session record still exists."* — eso ya no aplica porque `state.transition` se emite vía `markSessionStatus` 14 líneas más arriba, NO por `sessionEnd`. `sessionEnd` solo emite el evento `session.end` (no `state.transition`).

Es código que funciona pero el comentario engaña al próximo reviewer. Tras el relocate de CR-02, la única razón para emitir `sessionEnd` antes de `removeSessionFn` es preservar la invariante observable de "session.end emitido mientras la sesión todavía existe en state.json"; el motivo `state.transition` ya no aplica.

**Fix:** Actualizar el comentario en 178-180 para clarificar que `sessionEnd` solo emite `session.end` (la transición ya ocurrió arriba). Por ejemplo:

```js
// Emit typed session.end event BEFORE removeSession. La transición a 'done'
// ya se emitió arriba vía markSessionStatus; aquí solo cerramos el ciclo
// observable con el evento session.end mientras el registro aún existe.
// Silent-failure: never crash Claude Code stop hook.
```

---

### WR-03: `lstatSync` ENOENT-vs-error path no distingue EACCES como "libre"

**Archivo:** `src/hooks/stop.js:302-314`
**Severidad:** Warning
**Issue:**
La pre-check actual hace `lstatSync(target)` en try/catch. Política implementada:
- Stat éxito → asume colisión → variante suffixed.
- `ENOENT` → asume libre → mantiene `<wt>.dirty`.
- Cualquier otro error (EACCES, ELOOP, EIO, …) → variante suffixed (defensivo).

El comentario (línea 310) lo enmarca como "defensivo, no asumimos libre" — coherente. Pero EACCES en un pre-check NO necesariamente significa "el target existe": puede significar "no podemos leerlo". Mantener `<wt>.dirty` como target probablemente fallaría igualmente en el `git worktree move` posterior; promover a suffixed es defensivo pero podría producir un `cleanup.dirty.moved_to` con sufijo timestamp cuando en realidad el target canónico era libre.

No es un bug correcto/incorrecto — es una decisión de tradeoff que vale la pena documentar explícitamente. La política actual prioriza "nunca fallar move" sobre "preservar nombre canónico", lo que está alineado con D-02 (fail-open), pero el comentario no lo dice.

**Fix:** Ajustar el comentario para nombrar el tradeoff. Opcional: emitir un `console.error` cuando se cae a la rama suffixed por error distinto de ENOENT, para diagnóstico (state mutation oculta sin observability es la misma crítica que motivó WR-03 del plan 19-03):

```js
} catch (err) {
  const code = /** @type {NodeJS.ErrnoException} */ (err).code;
  if (code !== 'ENOENT') {
    // EACCES, ELOOP u otro: tradeoff explícito — preferimos perder el nombre
    // canónico antes que arriesgar que `git worktree move` falle confusamente.
    console.error(`[kodo:stop] dirty-target pre-check ${code} on ${target} — falling back to suffixed`);
    target = `${wt}.dirty-${Date.now()}`;
  }
}
```

---

### WR-04: `gitFn` por defecto re-importa `node:child_process` en cada invocación

**Archivo:** `src/hooks/stop.js:105-108`
**Severidad:** Warning
**Issue:**
```js
const gitFn = deps.gitFn || (async (cwd, args) => {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim();
});
```

Cada llamada a `gitFn` hace un `await import('node:child_process')`. En el flujo normal (CLEAN path) se invoca 4-5 veces (branch --show-current, status, worktree remove, branch -D, worktree prune). Node cachea el módulo, así que el coste real es bajo, pero:

1. Cinco awaits innecesarios añaden latencia en un hook que ya está midiendo presión de cierre.
2. Es asimétrico con el patrón ya usado en el resto del archivo (e.g., `lstatSync`/`renameSync` se importan UNA vez líneas 214 con destructuring).
3. Si en algún momento alguien sustituye `execFileSync` por `execFile` async, este patrón obliga a propagar el await al import.

No afecta corrección. Sí afecta legibilidad y consistencia.

**Fix:** Mover el import al top-level del archivo (estático) o, si la lazy-loading es deliberada (evitar cargar `child_process` cuando el hook no toca worktree), hacer el import UNA vez al entrar al bloque worktree cleanup, no en cada llamada:

```js
import { execFileSync } from 'node:child_process';
// …
const gitFn = deps.gitFn || ((cwd, args) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim());
```

---

### WR-05: `gitFn` default antepone `-C <project>` aunque algunos call-sites ya pasan `-C <wt>`

**Archivo:** `src/hooks/stop.js:105-108` + call-sites `:239, :249`
**Severidad:** Warning
**Issue:**
El default `gitFn` produce el comando `git -C <project> <args>`. Los call-sites de `branch --show-current` y `status --porcelain` pasan args con `-C <wt>` ya incluido. Resultado neto del comando ejecutado:

```
git -C <project> -C <wt> branch --show-current
```

Git acepta múltiples `-C` (los compone), así el segundo gana → ejecuta en `<wt>`. **Funciona**, y el comentario (líneas 234-237) lo documenta como intencional. Pero:

1. Mezcla dos convenciones: para algunos comandos `cwd` es project + args `-C wt`; para otros (remove, move, branch -D, prune) `cwd` es project + sin `-C` extra (porque deben ejecutarse desde el repo principal).
2. La asimetría es invisible salvo lectura cuidadosa. Un implementer nuevo verá `gitFn(project, ['-C', wt, 'status', '--porcelain'])` y pensará que es un typo.
3. Hace que los tests stub (en `test/stop-worktree-cleanup.test.js`) tengan que reconocer el comando vía `args.includes('--show-current')` en lugar de `cwd === wt` — el primer test (`CLEAN: …`) lo refleja en el assertion sobre `args`.

**Fix:** Elegir una convención y documentarla explícitamente. Opción A (más simple): cambiar la firma de gitFn a `(cwd, args)` donde `cwd` SIEMPRE es el directorio de ejecución; los call-sites pasan `wt` o `project` según corresponda y el `gitFn` default usa `cwd` directamente:

```js
const gitFn = deps.gitFn || ((cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim());
// call-sites:
await gitFn(wt, ['branch', '--show-current']);
await gitFn(wt, ['status', '--porcelain']);
await gitFn(project, ['worktree', 'remove', wt]);
```

Esto elimina la composición `-C <project> -C <wt>` y hace cada call-site auto-evidente. Cambio no es estrictamente necesario para corrección (los tests pasan), pero reduce la superficie de confusión.

## Verificación de gap-closures (CR-02 + CR-03)

### CR-02 — markSessionStatus fuera de `if (session.gsd)` ✅

- **Implementación:** `src/hooks/stop.js:159-176` ejecuta `markSessionStatus(... 'done', 'session-stop' ...)` para TODA sesión encontrada (GSD y no-GSD), antes del bloque `if (session.gsd) { releaseGsdLock(...) }` (líneas 196-203).
- **Diagnóstico explícito:** `catch (err) { console.error(...) }` líneas 172-176 — cumple WR-03 del plan 19-03 (no silent).
- **Reason canónico actualizado:** `'session-stop'` (sin sufijo). El test source-hygiene `test/stop.test.js:135-158` verifica regex `markSessionStatus(session.task_id, 'done', 'session-stop'` y que la cadena antigua `'session-stop:lock-released'` ya no aparece.
- **Test behavioral:** `test/stop-state-transition.test.js:242-287` confirma que non-GSD AHORA emite `state.transition` con `to='done'`, `reason='session-stop'`.
- **D-04 invariante:** `test/stop-state-transition.test.js:292-339` confirma que tanto full como quick emiten `to='done'` fijo (D-04 LOCKED).

### CR-03 — `lstatSync` reemplaza a `existsSync` (symlink-safe) ✅

- **Implementación:** `src/hooks/stop.js:302-314`. La pre-check ya no sigue symlinks: `lstatSync` stat-ea el symlink en sí, así symlinks colgantes disparan el path suffixed igual que un archivo regular o un directorio existente.
- **Tests behavioral:**
  - `test/stop-worktree-cleanup.test.js:235-277` (DANGLING SYMLINK) — verifica que un symlink a `<tmpBase>/nonexistent-target` dispara variante suffixed.
  - `test/stop-worktree-cleanup.test.js:279-316` (REGULAR FILE) — verifica que un archivo regular en `<wt>.dirty` también dispara variante suffixed.
  - `test/stop-worktree-cleanup.test.js:153-188` (TARGET COLLISION) — escenario pre-existente, sigue verde tras el cambio.
- **Test source-hygiene:** `test/stop.test.js:160-178` verifica:
  - `lstatSync(target)` está presente.
  - `existsSync` NO aparece en `stop.js` (impide regresión).
  - El comentario referencia `Phase 19 CR-03` para trazabilidad.

### CR-01 — DEFERRED ✅ (override D-07, accepted_by: alex)

No re-flagueado en este reporte según consigna. La decisión está documentada en `19-VERIFICATION.md` overrides_applied:1.

## Observaciones complementarias (no findings)

1. **Test de regresión `test/stop-state-transition.test.js`** — el comentario header (líneas 12-19) documenta el cambio de premisa: el régimen non-GSD pasó de "NO emite state.transition" a "SÍ emite state.transition" tras CR-02. La explicación es clara y traceable al REVIEW.md previo. Buen patrón.

2. **HOME tmpdir override en `test/stop-state-transition.test.js:116-142`** — el `before` hook fija HOME tmpdir y hace dynamic import de `state.js` DESPUÉS, garantizando que `KODO_DIR = join(homedir(), '.kodo')` resuelve al tmpdir aislado. El comentario CR-02 fix lo explica explícitamente. Patrón sólido y reutilizable.

3. **`src/logger-events.js`** — Phase 19 añade 3 helpers (`worktreeCleanupOk/Dirty/Error`) que respetan la convención existente (pure transform, sin I/O, sin imports fuera de `node:os`/`node:path`). `EVENTS` sigue frozen. El test `EVENTS is frozen and contains the 11 canonical types` en `test/logger-events.test.js:48-64` valida el contrato. Sin findings en este archivo.

4. **`src/gsd/verify.js`** — el catch silencioso para `markSessionStatus` (líneas 266-270) preserva la invariante D-17 ("orchestratorReview en TODAS las ramas"). El comentario CR-01 fix Phase 16 explica el reasoning (split-brain). Esto NO es el mismo "catch silencioso" criticado en CR-02 del plan 19-03: aquí está justificado por la invariante D-17 documentada y testeada.

---

_Reviewed: 2026-05-12T17:24:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
