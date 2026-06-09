---
phase: 41-doctor-m-dulo-puro-de-saneo-cli
reviewed: 2026-06-04T20:39:57Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/hooks/worktree-cleanup.js
  - src/hooks/stop.js
  - src/logger-events.js
  - src/gsd/doctor.js
  - src/cli/gsd-doctor.js
  - src/cli.js
  - src/cli/polling-logfile.js
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: resolved
resolved_note: "WR-01/02/03 corregidos en commit 41e3889 (+ guard .dirty). Infos IN-01/IN-02 aceptados como menores. Suite 1143/0/1, UAT 18/18."
---

# Phase 41: Code Review Report

**Reviewed:** 2026-06-04T20:39:57Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Se revisaron los 7 archivos de la fase 41 (módulo puro de saneo CLI `kodo gsd doctor`). La arquitectura es sólida: invariantes LOG-12 respetadas, sin `rm -rf`, sin `--force` en git worktree remove, detección scoped a `.bg-shell` sin `git worktree list`, TOCTOU guard implementado, fail-open per item verificado. El gap fix descubierto en UAT (gitFn + noopLogger defaults en `resolveDeps`) está correctamente aplicado.

Se encontraron tres warnings y dos infos. Ningún hallazgo es un blocker de seguridad o corrupción de datos. Los dos más relevantes son: (1) el parámetro `err` construido pero nunca usado en `renderHuman` (código muerto + errores en --fix van a stdout en lugar de stderr), y (2) los `console.error` con prefijo `[kodo:stop]` en el helper compartido, que ahora también se emiten cuando lo invoca `doctor.js` — el prefijo incorrecto dificulta el diagnóstico.

---

## Warnings

### WR-01: `err` construido pero ignorado en `renderHuman` — los errores de `--fix` van a stdout

**File:** `src/cli/gsd-doctor.js:55,80,106`
**Issue:** En `runGsdDoctor`, se construye `err` (línea 55) como la función de escritura a stderr y se pasa en el objeto a `renderHuman` (línea 80). Sin embargo, la destructuring de `renderHuman` en su declaración (línea 106) no incluye `err`:

```js
// línea 80: se pasa err
renderHuman({ report, result, fix: !!opts.fix, write, err, fmt });

// línea 106: err silenciosamente descartado
function renderHuman({ report, result, fix, write, fmt }) {
```

Como consecuencia, la sección de errores del bloque `--fix` (líneas 134-139) usa `write` (stdout), en lugar de `err` (stderr). Los errores de saneo deberían ir a stderr para ser filtrables, especialmente en uso con `--json` o en scripts. Además, `err` es letra muerta: se asigna, se pasa, pero nunca se consume.

**Fix:**
```js
// Añadir err al destructuring de renderHuman:
function renderHuman({ report, result, fix, write, err, fmt }) {
  // ...
  if (result.errors.length > 0) {
    err(`\n${fmt.red('errors')} (${result.errors.length}):\n`);
    for (const e of result.errors) {
      err(`  ${fmt.fail(e.category)} ${e.target}: ${e.reason}\n`);
    }
  }
}
```

---

### WR-02: `console.error` con prefijo `[kodo:stop]` en helper compartido `worktree-cleanup.js`

**File:** `src/hooks/worktree-cleanup.js:74,117`
**Issue:** El helper extrae literalmente el código de `stop.js`, incluyendo las llamadas a `console.error` con el prefijo `[kodo:stop]`:

```js
// línea 74
console.error(`[kodo:stop] branch --show-current failed: ${err.message}`);

// línea 117
console.error(`[kodo:stop] branch -D ${branchName} failed: ...`);
```

Ahora que `cleanupWorktree` es un helper compartido consumido también por `doctor.js`, estos mensajes aparecerán con el prefijo incorrecto `[kodo:stop]` cuando los emite el comando `kodo gsd doctor`. En un flujo de `--fix` real, el operador verá `[kodo:stop]` en su terminal aunque no haya ningún stop hook activo, lo que dificulta correlacionar el error con su causa.

Ambas rutas son fail-open silenciosas per diseño (branch read antes de remove, y branch -D fallback). El `console.error` es el único canal de diagnóstico para esas dos fallas parciales porque el plan expresamente excluyó emitir un evento `cleanup.error{phase:branch}` en estas rutas (para mantener verbatim el contrato del test contractual). Ahora que el código es compartido, el prefijo erróneo es un obstáculo concreto de diagnóstico.

**Fix:**
```js
// Reemplazar el prefijo hardcodeado por el parámetro existente sessionId:
console.error(`[kodo:worktree-cleanup] branch --show-current failed (session=${sessionId}): ${err.message}`);
// ...
console.error(`[kodo:worktree-cleanup] branch -D ${branchName} failed (session=${sessionId}): ${err.message}`);
```

---

### WR-03: `defaultListWorktreeDirs` no escanea proyectos de `state.history` — worktrees huérfanos de sesiones archivadas nunca se detectan

**File:** `src/gsd/doctor.js:128-154`
**Issue:** `defaultListWorktreeDirs` usa `realListSessions()` (que devuelve solo `Object.values(state.sessions)` — sesiones activas), por lo que si un proyecto solo tiene sesiones en `state.history` (ya archivadas/terminadas), su directorio `.bg-shell/` nunca se escanea. Los worktrees huérfanos más viejos — precisamente los que más necesitan ser saneados — son invisibles para `scan()` y `execute()`.

Contraste: `collectLockProjects` en la misma función (línea 292) sí incluye `state.history`. La asimetría entre la detección de worktrees y de locks es un defecto de cobertura.

**Ejemplo concreto:** Un worktree huérfano de una sesión eliminada de `state.sessions` hace semanas permanece en disco indefinidamente porque `defaultListWorktreeDirs` no escaneará su `projectPath`.

**Fix:**
```js
function defaultListWorktreeDirs() {
  const out = [];
  const seenProjects = new Set();
  let state;
  try {
    state = realLoadState(); // usar loadState, no listSessions
  } catch {
    return [];
  }
  // Unificar active sessions + history para el escaneo de projectPaths
  const allSessions = [
    ...Object.values(state.sessions || {}),
    ...(Array.isArray(state.history) ? state.history : []),
  ];
  for (const s of allSessions) {
    const projectPath = s?.project_path;
    if (!projectPath || seenProjects.has(projectPath)) continue;
    seenProjects.add(projectPath);
    // ... resto igual
  }
  return out;
}
```

---

## Info

### IN-01: `scan()` siempre emite `mode: 'dry-run'` en el evento `doctor.scan`, también cuando se llama desde `execute()`

**File:** `src/gsd/doctor.js:394-401`
**Issue:** El evento `doctorScan` se emite solo al final de `scan()` con `mode: 'dry-run'` hardcoded. `execute()` re-detecta internamente pero no emite el evento `doctor.scan`. Si el operador filtra los logs por `doctor.scan`, solo verá el dry-run, no la ejecución del fix — el NDJSON no refleja cuándo realmente se actuó. El plan especificaba el evento para "iniciar/terminar un escaneo de `kodo gsd doctor` (dry-run o **--fix**)" (comment de `doctorScan` en logger-events.js:676).

**Fix:** En `execute()`, emitir `doctorScan` con `mode: 'fix'` al inicio del bloque try principal (después de `loadState`), usando los counts de las detecciones.

---

### IN-02: `gitFn` default en `resolveDeps` es síncrono pero `cleanupWorktree` lo trata como `Promise<string>|string`

**File:** `src/gsd/doctor.js:170`
**Issue:** El `gitFn` default en `resolveDeps` devuelve un `string` (llamada `execFileSync` síncrona), mientras que el de `stop.js` usa `async` con dynamic import y devuelve una `Promise<string>`. La declaración de tipo en ambos módulos admite `Promise<string>|string`, y `await` sobre un valor no-Promise devuelve el valor directamente — funcionalmente correcto. Sin embargo, si en el futuro se añade lógica que dependa de que `gitFn` sea asíncrono (ej. timeout, cancelación), este subtleza será una trampa. Además, bloquea el event loop en cada operación git dentro de `execute()` async, aunque dado que es un comando CLI de corta duración, el impacto práctico es mínimo.

El comentario en línea 167-170 documenta esta intención ("espejo de stop.js:122-126"), pero la implementación no es idéntica: stop.js usa async con dynamic import; doctor.js usa sync con static import. La asimetría puede llevar a confusión en futuros mantenedores.

**Fix (bajo riesgo, puede diferirse):** Si se quiere uniformidad, usar la misma forma que stop.js:
```js
gitFn: deps.gitFn || (async (cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()),
```
(Wrapper async con execFileSync síncrono — misma semántica pero tipo correcto).

---

_Reviewed: 2026-06-04T20:39:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
