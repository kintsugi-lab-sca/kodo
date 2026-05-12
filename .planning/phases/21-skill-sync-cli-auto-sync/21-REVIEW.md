---
phase: 21-skill-sync-cli-auto-sync
reviewed: 2026-05-13T00:14:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/skill/sync.js
  - src/cli/skill-sync.js
  - src/cli.js
  - src/logger-events.js
  - src/orchestrator/launch.js
  - test/skill-sync.test.js
  - test/orchestrator-auto-sync.test.js
  - test/logger-events.test.js
findings:
  critical: 0
  warning: 6
  info: 5
  total: 11
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-05-13T00:14:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 21 cabela `kodo skill sync` (CLI + módulo puro) y el hook auto-sync en `launchOrchestrator`. Los invariantes críticos solicitados (D-04 symlink replace, D-05 prune opt-in, D-05c auto-sync nunca prune, D-07 exit codes, D-08 single-source, D-10 cwd preservada, comentario Phase 18 D-06, color isolation, skill canonical no modificada) están todos satisfechos.

No detecto blockers de seguridad ni de corrección que rompan el contrato Phase 21. Sin embargo, hay **6 warnings reales** que conviene cerrar — sobre todo (1) el patrón `console.error` que se filtra al stderr en escenarios CLI legítimos (`--json`) y (2) un bug latente en el reemplazo del symlink cuando el target es un directorio real (no el caso del driver actual, pero sí ocurrirá si alguna vez existe un repo viejo apuntado por el link). Resto son code smells y test-shape.

## Critical Issues

_None._

## Warnings

### WR-01: `rmSync({ force: true })` sobre symlink que apunta a directorio **no borra el link** y deja `mkdirSync` ineficaz

**File:** `src/skill/sync.js:64-69`
**Issue:** `rmSync(path, { force: true })` con un symlink path borra el link cuando el target es un archivo (o cuando el target no existe — el caso del driver actual: `/Users/alex/dev/klab/kodo/skills/kodo-orchestrate` no existe en disco). Pero si el symlink apuntara a un **directorio real existente**, `rmSync` sin `recursive: true` lanza `EISDIR` (o, peor, en algunos runtimes de Node `rmSync` sin `recursive` sigue el link y falla porque la ruta resuelta es un dir). El test `Test 4` y `D-04 CLI` solo cubren el caso "symlink dangling" (`'/nonexistent/path/...'`). El test no protege el camino que se ejecutará en producción si un futuro driver tiene un symlink válido. El SUMMARY afirma "verified against Node POSIX `unlink(2)` semantics", pero Node `fs.rmSync` no es `unlink(2)` puro: aplica heurísticas de `stat`/`lstat` internas en algunas versiones.
**Fix:**
```js
if (st.isSymbolicLink()) {
  // unlinkSync es la operación POSIX correcta: borra el link, nunca el target.
  // rmSync sin recursive falla si el link apunta a un dir real existente.
  unlinkSync(dest);
  mkdirSync(dest, { recursive: true });
  symlinkReplaced = true;
}
```
Y añadir un test que cree un symlink → dir real y verifique que se reemplaza sin borrar el target.

---

### WR-02: `console.error` en `launchOrchestrator` outer-catch escapa al stderr aunque el caller no provea logger

**File:** `src/orchestrator/launch.js:76`
**Issue:** El outer-catch usa `console.error(...)` directo. `launchOrchestrator` se invoca desde `src/check.js:122` (`runCheckAndAct`) y desde `src/cli.js:131` (`kodo orchestrate`). Esos callers **no** pasan logger (`opts.logger` undefined), así que un fallo inesperado de `syncSkill` (ej. throw síncrono no atrapado por el inner-catch del módulo — improbable pero contemplado como "defense in depth") siempre vuelca a stderr del proceso del CLI. Esto rompe el principio Phase 19 fail-open + observabilidad-vía-NDJSON: la línea queda en stderr sin contraparte estructurada. Además, este `console.error` no aparece en los tests in-process (Test C usa `try/catch` propio).
**Fix:** Si el inner-catch del módulo `syncSkill` ya devuelve `status: 'error'` correctamente (lo hace — línea 129-135), el outer-catch en `launch.js` solo dispara si hay un throw síncrono fuera del try del módulo (p.ej. en `KODO_ROOT_FOR_SKILL` o `homedir()`). Esos paths son síncronos y no fallan. **Considerar eliminar el outer-catch** (ya cubierto por el inner-catch del módulo) o, si se conserva como "belt-and-suspenders", emitir `skillSyncAutoError` cuando `log` exista en lugar de `console.error`:
```js
} catch (err) {
  const msg = /** @type {Error} */ (err).message;
  if (log) skillSyncAutoError(log, { source: skillSource ?? '?', dest: skillDest ?? '?', error: msg });
  // (sin log: silencio total — el orchestrator continúa, la skill canonical
  // gana por cwd-autoload.)
}
```
Nota: `skillSource`/`skillDest` están en el scope try, así que requieren declararse fuera. Esto fuerza una decisión limpia en lugar de mezclar `console.error` + helper.

---

### WR-03: `lstatSync` se llama dos veces en el flujo normal (microbug en error-paths cuando ENOENT no se propaga)

**File:** `src/skill/sync.js:70-77`
**Issue:** El catch silencia **todos** los errores de `lstatSync(dest)` (no solo ENOENT), comentando "defense in depth — fall-through al mkdirSync siguiente". Pero si `lstatSync` falla por algo distinto a ENOENT (p.ej. `EACCES` en un parent dir read-only), el flujo continúa hasta `mkdirSync` que también fallará. El error real (`EACCES` en `lstat`) se pierde, y el operador ve `EACCES` en `mkdirSync` que apunta al sitio equivocado. Adicionalmente, el `if (err.code !== 'ENOENT') { /* defense in depth */ }` no hace **nada** — el bloque está vacío salvo por el comentario. Esto es código muerto que no expresa intención.
**Fix:**
```js
try {
  const st = lstatSync(dest);
  if (st.isSymbolicLink()) {
    unlinkSync(dest); // ver WR-01
    mkdirSync(dest, { recursive: true });
    symlinkReplaced = true;
  }
} catch (err) {
  // Solo tragamos ENOENT — mkdirSync recursive lo crea después.
  // Cualquier otro error (EACCES, ELOOP) se propaga al outer-catch del módulo.
  if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
}
```

---

### WR-04: La salida `--json` mezcla `console.warn` del prune con stdout, rompiendo "byte-deterministic JSON"

**File:** `src/skill/sync.js:115` (interacción con `src/cli/skill-sync.js:70-79`)
**Issue:** El test `D-06b --json` (line 350 de `test/skill-sync.test.js`) afirma `assert.match(result.stdout, /^\{"status":"ok","files_changed":2\}\n$/)` con anchors `^...$`. Esto pasa **solo porque el test no usa `--prune`**. Pero si un operador ejecuta `kodo skill sync --json --prune` con archivos foráneos, `syncSkill` llama a `console.warn(...)` (sync.js:115) — esto va a **stderr** en Node por defecto. Ok, stdout queda limpio. **Pero**: el `console.warn` es comportamiento del *módulo puro* que se afirma como "NO emite eventos; el caller decide" (sync.js:15). El módulo emite efectos colaterales a stderr globales que el caller (CLI handler) no puede silenciar ni redirigir. Esto rompe la encapsulación del DI: el `errFn`/`writeFn` del CLI handler no recibe la línea de warn.
**Fix:** Mover el warn al caller. Devolver la lista de archivos pruned y dejar que `src/cli/skill-sync.js` lo emita via `err(...)` (o `write` si lo prefiere). Así el módulo es realmente puro y los tests del orchestrator auto-sync (que NUNCA llaman con prune=true) no tendrían ningún console.warn lateral posible.
```js
// sync.js: acumular lista
const pruned = [];
for (const relPath of destFiles) {
  if (!sourceSet.has(relPath)) {
    rmSync(join(dest, relPath), { force: true });
    pruned.push(relPath);
  }
}
result.files_pruned = pruned.length;
result.pruned_files = pruned; // o equivalent

// skill-sync.js CLI: emite los warns vía deps.errFn (DI-able, testeable)
for (const p of result.pruned_files ?? []) {
  err(`[kodo skill sync --prune] removing foreign: ${p}\n`);
}
```

---

### WR-05: `runSkillSyncCli` declara la firma como `async` y `Promise<number>` sin operaciones async reales

**File:** `src/cli/skill-sync.js:40`
**Issue:** `export async function runSkillSyncCli(opts, deps = {}) { ... }` retorna `Promise<number>` pero ninguna operación interna es async: `syncSkill` es síncrona, `process.cwd()/homedir()/existsSync` son síncronos, `write/err` son `process.stdout.write`. Marcarla como async confunde al lector (sugiere I/O async) y agrega una microtarea al ciclo de event loop sin razón.
**Fix:** Quitar `async` y `Promise<>` del JSDoc:
```js
/** @returns {number} */
export function runSkillSyncCli(opts, deps = {}) { ... }
```
Si se conserva por consistencia con `runGsdInspect`/`runGsdVerifyCli` (que sí son async porque hacen HTTP a Plane), documentarlo: "async preserved for parity with other gsd handlers; no internal awaits". Pero la *Karpathy regla 2 — simplicidad primero* dice: si no haces async, no lo declares.

---

### WR-06: Test C (`orchestrator-auto-sync.test.js`) no ejercita el bloque real de `launchOrchestrator`

**File:** `test/orchestrator-auto-sync.test.js:80-153`
**Issue:** Los tests A/B/C llaman a `syncSkill(...)` + `skillSyncAuto/Error(...)` **directamente desde el test**, no a `launchOrchestrator()`. El comentario en la cabecera reconoce que se simula el caller ("Simula el caller (orchestrator)"). Esto significa que la lógica condicional del **bloque real** en `launch.js:67-72` (`if (status === 'error') skillSyncAutoError(...); else if (status === 'ok') skillSyncAuto(...)`) **no está cubierta por ningún test**. Si alguien refactoriza ese `else if` a `if` doble, o invierte las ramas, o elimina la guarda `if (log)`, los tests siguen verdes pero `launchOrchestrator` rompe. El test D source-hygiene blinda el import; el test E blinda regex negativos. **Ningún test ejecuta el bloque auto-sync vivo.**
**Fix:** Añadir un test in-process que mockea `cmux.listWorkspaces` (para que retorne string vacío y corte el flujo antes de `cmux.newWorkspace`) e invoca `launchOrchestrator({ logger: memSinkLogger })`. Asertar que el record `skill.sync.auto` aparece en el sink. Pattern análogo a `test/orchestrator-launch-isolation.test.js` (ya existe en el repo).

---

## Info

### IN-01: `let result;` declarado fuera de try sin valor inicial

**File:** `src/cli/skill-sync.js:57-58`
**Issue:** `let result;` con asignación condicional dentro del try y uso posterior. TypeScript flow analysis tolera esto, pero JSDoc `@type` no añade narrowing y el `result` se usa fuera del try (line 65) tras un return en el catch. Funciona porque el catch retorna, pero el patrón es frágil ante refactor.
**Fix:** Aceptable como está; alternativa más explícita:
```js
const result = (() => {
  try { return syncFn({ source, dest, prune: opts.prune === true }); }
  catch (e) { return { status: 'error', files_changed: 0, error: e.message }; }
})();
if (result.status === 'error') { err(...); return 1; }
```

---

### IN-02: Comentario `// defense in depth — fall-through al mkdirSync siguiente` no hace nada (bloque vacío)

**File:** `src/skill/sync.js:74-76`
**Issue:** Ver WR-03. El `if (err.code !== 'ENOENT') { /* defense in depth */ }` es código muerto: no hay branch verdadero, solo un comentario en un bloque vacío. Confunde al lector — sugiere que hay defensa, pero no hay nada.
**Fix:** Eliminar el `if` o convertirlo en un `throw` real (ver WR-03).

---

### IN-03: `KODO_ROOT_FOR_SKILL` se evalúa a load-time, no a call-time

**File:** `src/orchestrator/launch.js:19`
**Issue:** La constante captura `process.env.KODO_ROOT || process.cwd()` cuando el módulo se importa. Si el operador cambia `cwd` o setea `KODO_ROOT` después del import (en tests in-process, no en CLI subprocesos), el sync apuntará al cwd "viejo". Para el flujo CLI no importa (un proceso = un import = un cwd). Para tests futuros que reusen el módulo en mismo proceso, sí. Patrón documentado como "mirror src/hooks/stop.js:20" — mismo defecto allá, así que es consistencia con precedente, pero el precedente arrastra el bug.
**Fix:** Si emerge el problema, mover a getter: `function kodoRootForSkill() { return process.env.KODO_ROOT || process.cwd(); }`. Por ahora aceptable por consistencia.

---

### IN-04: El renderHuman imprime "Legacy symlink replaced" **incluso** cuando el destino no era symlink en este run

**File:** `src/cli/skill-sync.js:97-100`
**Issue:** El warning del symlink legacy se emite si `result.symlink_replaced === true`. Pero `symlinkReplaced` solo se setea en *este* run cuando se reemplazó *en este run*. Idempotente: ok. **Sin embargo**, el render imprime "Legacy symlink replaced at <dest>" antes que la línea "Synced N files". Cosmético: el operador podría preferir el orden inverso (resultado primero, contexto después). No es bug.
**Fix:** Mantener orden actual si "contexto antes que resultado" es el patrón del proyecto. Cosmético.

---

### IN-05: Tests de spawn dependen de `bin/kodo` real; no aíslan provider/config

**File:** `test/skill-sync.test.js:65-79`
**Issue:** `runCli` spawnea `bin/kodo` real con `HOME` override. Como `kodo skill sync` deliberadamente **no llama** `ensureConfig`, esto funciona. Pero si alguien añade en el futuro un side-effect global a `bin/kodo` (telemetría, version-check, etc.), los tests podrían volverse flaky o slow. No es bug actual.
**Fix:** Vigilancia. Si emerge, mover a invocación directa de `runSkillSyncCli` con DI (los tests in-process del orchestrator ya usan ese patrón).

---

## Invariantes verificados (de la lista del prompt)

| # | Invariante | Estado | Evidencia |
|---|------------|--------|-----------|
| 1 | D-04 symlink replace (`lstatSync` + `rmSync(force)` + `mkdirSync`) | OK con caveat WR-01 | `src/skill/sync.js:63-69`; falta cobertura caso symlink→dir-real |
| 2 | D-05 `--prune` opt-in (default false preserva foráneos) | OK | `src/skill/sync.js:51,110` + `Test 5` (test/skill-sync.test.js:181) |
| 3 | D-05c auto-sync NEVER prune | OK | `grep -cE 'syncSkill\([^)]*prune:\s*true' src/orchestrator/launch.js` → 0 |
| 4 | D-07 exit codes 0/1/2 + canonical stderr | OK | `src/cli/skill-sync.js:52-67`; bytes verificados en `SKILL-04 #4` |
| 5 | D-08 single-source: 2 importers exactos | OK | `grep -rn 'from.*skill/sync' src/` → `src/cli/skill-sync.js` + `src/orchestrator/launch.js` |
| 6 | D-10 cwd=repo preservada (no chdir, no mutar arg) | OK | `grep -c 'process.chdir' src/orchestrator/launch.js` → 0; `cwd: process.cwd()` preservado L110 |
| 7 | Phase 18 D-06 comment preserved (1 grep match) | OK | `grep -n 'Phase 18 D-06' src/orchestrator/launch.js` → 1 match (L122) |
| 8 | `.claude/skills/kodo-orchestrate/skill.md` NO modificado | OK | `git diff main -- .claude/skills/kodo-orchestrate/` → empty |
| 9 | Color isolation: picocolors solo en `format.js` | OK | `grep picocolors src/skill/sync.js src/cli/skill-sync.js` → 0 matches |

Driver real del usuario confirmado (`ls -la ~/.claude/skills/kodo-orchestrate`):
```
lrwxr-xr-x ... ⇒ /Users/alex/dev/klab/kodo/skills/kodo-orchestrate
```
Symlink obsoleto presente. Phase 21 D-04 lo resolverá al primer `kodo orchestrate` o `kodo skill sync` post-merge (target dangling — caso cubierto por `Test 4`).

---

_Reviewed: 2026-05-13T00:14:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
