---
phase: 62-adopci-n-inteligente-desde-el-dashboard
reviewed: 2026-06-25T09:37:18Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cli/dashboard/enrich.js
  - src/cli/dashboard/adopt.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/index.js
  - src/cli/dashboard/SessionTable.js
  - test/dashboard/app-derive.test.js
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 62: Code Review Report

**Reviewed:** 2026-06-25T09:37:18Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 62 ORCH-02 implementation: `enrich.js` (derivador LLM one-shot), `adopt.js` (par `--description` en argv), `App.js` (estado `deriving` + flujo derive-then-confirm), `index.js` (wiring), `SessionTable.js` (render del confirm derivado), y el test principal `app-derive.test.js`.

La implementación es sólida en los ejes críticos: el contrato never-throws/fail-open se cumple en todos los caminos verificados (ENOENT, timeout, parse-fail, sync-throw, outer try/catch en `deriveAdoptionMeta`); el token de generación `overlayReqRef` invalida correctamente derivaciones obsoletas tras Esc (T5); el `execFile` sin shell hace que los metacaracteres sean estructuralmente inertes (D-13); la fusión `derived.title ?? surface.title` preserva el fallback (T4); y la doble capa de parse del envelope es correcta.

Se encontraron **dos Warnings** y **tres Infos**. No hay Blockers.

---

## Warnings

### WR-01: Empty-string title bypasses `ADOPT_DERIVED_CONFIRM_FALLBACK` — muestra "título: " en blanco

**File:** `src/cli/dashboard/App.js:1033`
**Issue:** La prop `armedSurfaceTitle` se calcula como `armedSurface?.title ?? null`. El operador `??` solo activa el fallback para `null`/`undefined` — NO para `''` (cadena vacía). Si `surface.title === ''` (una AgentSurface que trae título vacío), `armedSurface.title` queda como `''`, y `'' ?? null` evalúa a `''`. En `SessionTable.adoptConfirmContent`, la guardia `if (armedSurfaceTitle != null)` es cierta para `''`, por lo que se renderiza `título: ` (colon en blanco) y se usa `ADOPT_DERIVED_CONFIRM` en lugar de `ADOPT_DERIVED_CONFIRM_FALLBACK`. El operador ve un confirm confusamente vacío en vez del degradado honesto.

**Contexto:** `truncateEllipsis('', 60)` devuelve `''` sin lanzar — no hay crash, solo display incorrecto. El mismo bug puede darse si `derived.title` es `''` y `surface.title` también lo es.

**Fix:**
```js
// App.js:1033 — usar || null en lugar de ?? null para excluir también ''
armedSurfaceTitle: armedSurface?.title || null,
```
Y en `SessionTable.js`, como defensa en profundidad, cambiar la guardia de `adoptConfirmContent`:
```js
// SessionTable.js — línea ~401: usar truthy check, no !=null
if (armedSurfaceTitle) {   // antes: if (armedSurfaceTitle != null)
```

---

### WR-02: Ausencia de guarda de path-traversal en `sessionId` del transcript (inconsistencia defensiva)

**File:** `src/cli/dashboard/enrich.js:160`
**Issue:** `firstUserPrompt` llama `resolveTranscriptPath(cwd, sessionId)` donde `sessionId` viene de la surface adoptable (vía `host.listAgentSurfaces()`). `resolveTranscriptPath` construye `join(homedir(), '.claude', 'projects', encoded, `${sessionId}.jsonl`)`. Si `sessionId` contiene `..` o `/`, `node:path.join` resuelve los segmentos y puede producir una ruta fuera de `~/.claude/projects/`.

Por contraste, `App.js` (líneas 453-457) sí tiene una guarda explícita anti-traversal sobre el `session_id` que viene de `/status` antes de construir la ruta de `STATE.md`: `!sessionId.includes('/') && !sessionId.includes('\\') && !sessionId.includes('..')`. Esta misma guarda no existe en `enrich.js` para el `sessionId` de la surface.

**Mitigación existente:** (a) El modelo de confianza es local (el host cmux es un proceso local del operador). (b) `firstUserPrompt` es never-throws — si lee un fichero inesperado cuyo contenido no es JSONL válido, devuelve `''` sin lanzar. (c) Un contenido leído erróneamente produce un prompt de Haiku con contexto incorrecto, no ejecución de código. (d) La worst-case surface es degradación de calidad del título, no pérdida de datos.

**No es BLOCKER** por el modelo de confianza local y el fail-open. Sin embargo, la inconsistencia defensiva con la guarda de `STATE.md` es un WR: la codebase tiene el patrón, debería aplicarlo aquí también.

**Fix:**
```js
// enrich.js — añadir guarda antes de resolveTranscriptPath (espejo de App.js:453-457)
export function firstUserPrompt({ cwd, sessionId, readFileFn }) {
  try {
    // Guard anti-traversal: sessionId es UUID por construcción pero la surface
    // es externa al core — espejo de App.js:453-457 (guardia del STATE.md).
    if (!sessionId || sessionId.includes('/') || sessionId.includes('\\') || sessionId.includes('..')) {
      return '';
    }
    const raw = readFileFn(resolveTranscriptPath(cwd, sessionId), 'utf8');
    // ... resto igual
```

---

## Info

### IN-01: Import muerto — `ADOPT_CONFIRM` importado en `SessionTable.js` pero nunca llamado

**File:** `src/cli/dashboard/SessionTable.js:40`
**Issue:** `ADOPT_CONFIRM` se importa en el bloque de imports (línea 40) pero no aparece en ninguna expresión de render. La Phase 62 reemplazó el uso de `ADOPT_CONFIRM` por `ADOPT_DERIVED_CONFIRM` / `ADOPT_DERIVED_CONFIRM_FALLBACK`, pero olvidó limpiar el import. Las referencias en líneas 293 y 295 son solo comentarios JSDoc — no son llamadas.

**Fix:** Eliminar `ADOPT_CONFIRM` del bloque de imports de `SessionTable.js`.

---

### IN-02: Comentarios JSDoc de `armedSurfaceRef`/`armedSessionId` en `SessionTable.js` mencionan `ADOPT_CONFIRM` obsoleto

**File:** `src/cli/dashboard/SessionTable.js:293,295`
**Issue:** Los parámetros `@param armedSessionId` y `@param armedSurfaceRef` del JSDoc dicen "rutea el copy a `ADOPT_CONFIRM`" y "copy persistente `ADOPT_CONFIRM`" — nomenclatura que corresponde a Phase 56. Desde Phase 62 el confirm de adopt usa `ADOPT_DERIVED_CONFIRM` / `ADOPT_DERIVED_CONFIRM_FALLBACK`. Lector del código ve documentación inconsistente.

**Fix:** Actualizar las dos líneas de JSDoc para referenciar `ADOPT_DERIVED_CONFIRM`/`_FALLBACK`.

---

### IN-03: Test `app-derive.test.js` declara 8 comportamientos en el comentario de cabecera pero solo contiene 7 `it()` — el comportamiento (8) está fundido en (1)

**File:** `test/dashboard/app-derive.test.js:24`
**Issue:** El comentario `// (8/once) onDerive llamado EXACTAMENTE una vez por armado` listado como comportamiento independiente en la cabecera no tiene su propio `it()`. La assertion correspondiente (`assert.equal(deriveCalls, 1, ...)`) está dentro del test `(1)`. No hay cobertura faltante — el assert existe. Solo hay una discrepancia entre el conteo declarado (8) y los tests reales (7).

**Fix:** O ajustar el comentario a "7 comportamientos" (eliminando el ítem 8 de la lista), o extraer el assert de deriveCalls a un `it()` separado para que el mapeo de VALIDATION.md sea 1:1 con los tests.

---

## Hallazgos confirmados NO presentes

Los siguientes focos del scope fueron verificados y **no presentan defectos**:

- **Command injection / argv safety:** `spawnDerive` usa `execFile` con argv literal (`spawnFn('claude', argv, ...)`) sin interpolación de shell. El prompt y la description viajan como elementos literales del array. Confirmado injection-inerte (D-13).
- **Never-throws contract:** Todos los caminos de fallo de `spawnDerive` y `deriveAdoptionMeta` resuelven a `{}`. El `TypeError` del leak guard en `spawnDerive` es capturado por el `try/catch` exterior de `deriveAdoptionMeta`. El `try/catch` de App.js en el handler es defensa en profundidad adicional.
- **Race condition / token de generación:** El patrón `overlayReqRef` invalida correctamente las derivaciones obsoletas. El `reqId` se toma síncronamente (antes del primer `await`) y el check post-await (`if (overlayReqRef.current !== reqId) return`) descarta resultados tardíos. El handler de Esc en `mode='deriving'` avanza el ref antes de limpiar el armado.
- **Resource leaks:** `execFile` con `{ timeout: 25000 }` mata el proceso hijo en timeout. No hay referencias circulares ni handles pendientes en los caminos de error.
- **Fail-open correctness:** La fusión `title: derived.title ?? surface.title` preserva el título de la surface cuando la derivación falla (T4). `description: derived.description` queda como `undefined` en fail-open → `runAdopt` lo omite del argv. `ADOPT_DERIVED_CONFIRM_FALLBACK` se muestra cuando `armedSurfaceTitle == null`.
- **Leak guard estructural:** `spawnDerive` lanza `TypeError` síncronamente si `spawnFn` no es función, ANTES del `new Promise`, impidiendo el fallback silencioso al binario real. Correcto y testeado.
- **`existsSyncFn` opcional:** El parámetro es `existsSyncFn?` en `deriveAdoptionMeta`, e `isGsdProject` tiene default `existsSync`. Si se pasa `undefined`, `isGsdProject` usa el builtin real. Aceptable — el comportamiento está documentado.

---

_Reviewed: 2026-06-25T09:37:18Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
