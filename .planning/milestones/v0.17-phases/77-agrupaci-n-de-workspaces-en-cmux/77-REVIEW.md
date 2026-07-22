---
phase: 77-agrupaci-n-de-workspaces-en-cmux
reviewed: 2026-07-16T08:34:25Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/cmux/client.js
  - src/host/cmux.js
  - src/session/manager.js
  - test/cmux/client-args.test.js
  - test/session/group-resolve.test.js
  - test/manager.test.js
findings:
  critical: 0
  warning: 2
  info: 7
  total: 9
status: issues
---

# Phase 77: Code Review Report

**Reviewed:** 2026-07-16T08:34:25Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues (0 Critical · 2 Warning · 7 Info)

## Summary

Revisión adversarial del diff `68709be..HEAD` (agrupación de workspaces en cmux). Los 10 invariantes del encargo se verificaron contra el código real (no contra los SUMMARYs); los resultados incluyen ejecución de los 4 suites afectados (101/101 pass) y sondas empíricas de edge cases sobre las funciones puras.

**Veredicto de invariantes (verificado en código):**

1. **T-77-01 ✓** — el ref de grupo viaja como elemento de argv array: `buildNewWorkspaceArgs` (`src/cmux/client.js:38-44`) devuelve array plano de strings, `run()` (`:17`) usa `execFile` sin shell. Cero interpolación en strings de shell.
2. **D-10 ✓** — `newWorkspaceWithGroupFallback` (`src/session/manager.js:209-217`): sin `group` → early return SIN try (fallo propaga sin retry); con `group` → un único retry sin `--group` cuya rejección NO se captura (propaga). Verificado con tests con stub inyectado (2 invocaciones exactas, 1 log).
3. **D-12 ✓** — `listWorkspaceGroups` tiene UN único call site consumidor (`manager.js:392`, dentro de `launchWorkItem`). `git diff 68709be..HEAD -- src/session/reconcile.js` está vacío; grep de `group` en `reconcile.js` da 0 resultados.
4. **GRP-04 ✓** — `workspace_group` aparece en `src/` solo en comentarios/JSDoc; ningún write a `state.json`/config (`buildSessionFromTask` no gana campos, blindado por assert). De la familia `workspace-group` solo se ejecuta `list` (`client.js:109`); cero verbos de gestión.
5. **Walker ✓** — los imports de `manager.js` (líneas 2-11) no incluyen `cmux/client.js`; toda ejecución cmux pasa por `host._legacy`. `cmux-isolation.test.js` verde.
6. **T-77-03 ✓** — las dos líneas de degradación (`group_skipped — resolucion_fallo` en `manager.js:395`, `group_skipped — retry_sin_grupo <ref>` en `:214`) llevan solo motivo/ref; el test asserta que el log no contiene el título de la tarea.
7. **never-throws ✓ (con matiz WR-01)** — `resolveWorkspaceGroup` devuelve `null` sin lanzar ante `null`/`{}`/`groups` no-array/campos no-string (7 shapes testeados). `deriveExpectedGroupName` con ref ausente/no-string/whitespace devuelve `null`. Matiz: refs degenerados NO cubiertos por la guarda pueden emitir nombre bogus `''` (ver WR-01).
8. **Degradación no mata el launch ✓** — capa 1 (try/catch englobante → `groupRef=null`) + capa 2 (retry sin `--group`); con `groupRef=null` el opts de `newWorkspace` es idéntico al previo y `buildNewWorkspaceArgs` sin `group` produce argv byte-idéntico (testeado).
9. **Unicode ✓ en código, ✗ en test** — `norm = NFC + toLowerCase + trim` en ambos lados del match; sonda empírica confirma que un nombre de grupo en NFD (`Traça Web` descompuesto) matchea el esperado en NFC. Pero NINGÚN test ejercita formas Unicode divergentes (ver WR-02).
10. **Sin regresión en consumers de `newWorkspace` ✓** — `orchestrator/launch.js` intacto (diff vacío); su llamada (`:220`) no lleva `group`, y sin `opts.group` el argv es idéntico al previo (D-13).

Los dos Warnings son edges reales de la derivación y un hueco de cobertura sobre un invariante reclamado; ninguno compromete el fail-open (la sesión nunca muere por la agrupación).

## Warnings

### WR-01: `deriveExpectedGroupName` puede emitir un nombre bogus `''` (o `'/Módulo'`) que SÍ matchea grupos de nombre solo-whitespace — la guarda documentada no cubre el identifier derivado

**File:** `src/session/manager.js:143-162`
**Issue:** La guarda de entrada degenerada valida el `ref` crudo (`typeof ref !== 'string' || ref.trim() === ''`) pero NO valida el **identifier derivado**. Sondas empíricas sobre el código real:

- `ref = '#7'` → `'#7'.split('#')[0]` = `''` → identifier `''` → la función devuelve `''`.
- `ref = '-9'` (p. ej. `projectIdentifier` vacío en Plane: `'' + '-' + 9`) → `replace(/-\d+$/,'')` = `''` → devuelve `''`.
- `ref = '#7'` + módulo con path propio → devuelve `'/FVF'` (compuesto con identifier vacío).

Esto contradice el contrato documentado en el propio JSDoc de la función («NO deriva un nombre bogus (`'undefined'`, `''`)»). Y no es inocuo aguas abajo: `resolveWorkspaceGroup` acepta `''` como `expectedName` válido (`typeof '' === 'string'`) y su `norm` trimea ambos lados, así que **un grupo del operador cuyo nombre sea solo espacios matchea `''`** — verificado: `resolveWorkspaceGroup({groups:[{name:'  ', ref:'workspace_group:9'}]}, '')` devuelve `'workspace_group:9'`. Resultado: una tarea con ref degenerado podría aterrizar en un grupo arbitrario en vez de lanzarse sin grupo (fail-open esperado). El launch nunca muere (capas 1/2 intactas), por eso es Warning y no Critical.
**Fix:**
```js
// tras derivar el identifier, antes de derivar moduleName:
const identifier = ref.includes('#')
  ? ref.split('#')[0].split('/').pop()
  : ref.replace(/-\d+$/, '');
if (!identifier || identifier.trim() === '') return null; // bogus → fail-open
```
Y añadir a `test/session/group-resolve.test.js` los casos `ref: '#7'` y `ref: '-9'` → `null` (hoy el loop de degenerados solo cubre `''`/whitespace/`undefined`/no-string).

### WR-02: El invariante Unicode (NFC, `Traça Web`) no tiene ningún test — la cobertura reclamada en el plan no existe

**File:** `test/session/group-resolve.test.js:155-158`
**Issue:** El behavior del plan 77-02 exige: «`resolveWorkspaceGroup` con un `name` que solo difiere en mayúsculas/espacios/**forma Unicode** (`' kodo '`, `'KODO'`) → matchea igual (norm = NFC+lowercase+trim)». El único test de normalización (`:155`) cubre exclusivamente caso y espacios (`' kodo '` vs `'KODO'`) — cero bytes Unicode no-ASCII en toda la suite. El `.normalize('NFC')` del código funciona (verificado con sonda: nombre de grupo en NFD `Traça Web` matchea el esperado en NFC), pero si mañana alguien elimina el `.normalize('NFC')` de `norm` (p. ej. «simplificando» a `toLowerCase().trim()`), la suite completa sigue verde y el matching de `Traça Web`/`F0 · Cierre…` se rompe en silencio (fail-open lo camufla: la sesión se lanza sin grupo, sin ningún fallo visible). El invariante 9 del review queda sin red de regresión.
**Fix:**
```js
it('forma Unicode: name en NFD matchea expected en NFC (Traça Web)', () => {
  const nfd = 'ROMAN/Traça Web'; // ç descompuesta (c + U+0327)
  const g = { groups: [{ name: nfd, ref: 'workspace_group:7' }] };
  assert.equal(resolveWorkspaceGroup(g, 'ROMAN/Traça Web'), 'workspace_group:7');
});
```

## Info

### IN-01: Ref con whitespace de borde deriva un identifier sucio → pérdida silenciosa de agrupación

**File:** `src/session/manager.js:144-152`
**Issue:** La guarda usa `ref.trim() === ''` para validar pero la derivación opera sobre el `ref` crudo: `ref = 'KODO-9 '` (espacio final) → `replace(/-\d+$/,'')` no matchea (termina en espacio) → identifier `'KODO-9 '` → norm lo convierte en `'kodo-9'` → no matchea `'kodo'` → sin grupo, sin traza. Los providers actuales construyen refs limpios (`normalize.js`), así que es latente.
**Fix:** derivar sobre el ref trimeado: `const ref = String(task?.ref ?? '').trim(); if (ref === '') return null;` y usar ese `ref` en la derivación.

### IN-02: `resolveWorkspaceGroup` devuelve `g.ref` sin validar el shape `workspace_group:\d+`

**File:** `src/session/manager.js:184-190`
**Issue:** El plan afirma que el ref que llega a `--group` es «siempre un `workspace_group:N` de la lista de cmux», pero el código solo exige `typeof g.ref === 'string'`. Un JSON anómalo de cmux (frontera T-77-02, medium) puede colar un string arbitrario que fluye al argv (inocuo vía `execFile`) y a la línea de log (un ref con `\n` forjaría líneas de log). Hardening barato y coherente con el estilo defensivo del fichero.
**Fix:** en el type-check por campo, añadir `&& /^workspace_group:\d+$/.test(g.ref)`.

### IN-03: El catch de la capa 1 descarta el error por completo — un solo motivo fijo para 4 causas distintas

**File:** `src/session/manager.js:394-396`
**Issue:** `catch { console.log('[kodo] group_skipped — resolucion_fallo'); }` no distingue cmux viejo sin subcomando / daemon headless / JSON malformado / bug de programación (un `ReferenceError` en el bloque también degrada en silencio). Coincide con el código canónico del plan (D-09/D-11), por eso es Info y no Warning, pero diagnosticar «por qué mis sesiones no se agrupan» exigirá instrumentación manual.
**Fix (opcional):** `catch (err) { console.log(\`[kodo] group_skipped — resolucion_fallo: ${String(err?.message).slice(0, 80)}\`); }` — el mensaje viene de cmux/JSON.parse, no del usuario, así que D-11 se preserva.

### IN-04: Se ejecuta la llamada cmux `listWorkspaceGroups` aunque `expectedName` sea `null` (resultado garantizado null)

**File:** `src/session/manager.js:391-393`
**Issue:** Con ref degenerado, `deriveExpectedGroupName` devuelve `null` y aun así se paga el exec de cmux (~50ms, timeout hasta 15s en el peor caso) para que `resolveWorkspaceGroup(json, null)` devuelva `null` sí o sí. Dentro del presupuesto D-12 (≤1 llamada), pero es trabajo garantizado-inútil.
**Fix:** `if (expectedName) { const raw = await host._legacy.listWorkspaceGroups(); groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName); }`

### IN-05: El assert GRP-04 de persistencia puede volverse vacuo si se reordenan funciones en `manager.js`

**File:** `test/manager.test.js` (assert «buildSessionFromTask NO gana ningún campo de grupo»)
**Issue:** El slice del cuerpo usa `indexOf('export function buildSessionFromTask')` → `indexOf('export function resolveProjectPath')`. Hoy el orden es correcto (líneas 34 → 79), pero si `resolveProjectPath` se renombra o se mueve por delante, `end` queda `-1` o `< start`, `slice` devuelve `''` y el regex negativo pasa vacuamente — el guard GRP-04 se apaga en silencio.
**Fix:** `assert.ok(end > start, 'resolveProjectPath debe seguir a buildSessionFromTask (delimitador del slice)');`

### IN-06: JSDoc de `_legacy.newWorkspace` desactualizado — falta `group?: string`

**File:** `src/host/cmux.js:359`
**Issue:** El passthrough ahora recibe opts con `group` (vía `newWorkspaceWithGroupFallback`), pero su JSDoc sigue en `{{ name: string, cwd?: string, command?: string }}`. `client.js` sí se actualizó. Sin efecto en runtime (no hay typecheck en CI), solo deriva documental.
**Fix:** `/** @param {{ name: string, cwd?: string, command?: string, group?: string }} opts @returns {Promise<string>} */`

### IN-07: Riesgo residual inherente a D-10 (LOCKED, no accionable en esta fase): el retry no distingue causa del fallo

**File:** `src/session/manager.js:211-216`
**Issue:** El catch de la capa 2 reintenta ante CUALQUIER rejección con `--group` presente, no solo ante «ref inválido fatal». Si el primer intento falla por timeout de `execFile` (15s) DESPUÉS de que el daemon cmux haya creado el workspace, el retry crea un segundo workspace duplicado. Es el comportamiento que D-10 fija (decisión LOCKED, verificada aquí como implementada fielmente) — se registra como riesgo residual conocido, no como defecto de implementación.
**Fix:** ninguno en esta fase; si el duplicado aparece en operación, la discriminación del error (`invalid_params`/exit=1 vs timeout) sería el seam.

---

_Reviewed: 2026-07-16T08:34:25Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
