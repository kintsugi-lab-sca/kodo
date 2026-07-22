# Phase 78: Address tech debt — saneo del nudge (75/WR-01) + fixes 77-REVIEW — Pattern Map

**Mapped:** 2026-07-22
**Files analyzed:** 5 modificados (3 fuente + 2 test) · 0 nuevos
**Analogs found:** 5 / 5 (todos son self-analogs — fase de deuda: los patrones a replicar viven en el propio repo)

> **Naturaleza de la fase:** deuda técnica. NO se crean ficheros; se aplican fixes quirúrgicos sobre código existente. Por tanto el "analog" de cada fichero es un patrón YA presente en el mismo repo (el carril de render del dashboard, las guardas defensivas por-campo de `resolveWorkspaceGroup`, el precedente de log `worktree_skipped_nongit`). El planner debe copiar esos patrones exactos, no inventar nuevos.

---

## File Classification

| Fichero a modificar | Rol | Data Flow | Analog (patrón a replicar) | Match |
|---------------------|-----|-----------|----------------------------|-------|
| `src/hooks/stop.js` (`buildStopNudgeText`) | utility (función pura) | transform | `src/cli/dashboard/App.js:752-753` (saneo `next` en render) + `src/cli/format.js:80` (`stripControlChars`) | exact |
| `src/hooks/session-end.js` (~248-261) | hook | event-driven | Bloque nudge ya existente; solo cambia si el saneo va en Opción 2 | self |
| `src/session/manager.js` (`deriveExpectedGroupName`, `resolveWorkspaceGroup`, `launchWorkItem`) | service/manager | transform + request-response | Guardas defensivas por-campo ya en `resolveWorkspaceGroup:185`; guarda de entrada ya en `deriveExpectedGroupName:146` | self / role-match |
| `src/host/cmux.js:358` (JSDoc `_legacy.newWorkspace`) | provider | config (doc) | JSDoc por-campo del resto de métodos `_legacy` | self |
| `test/session/group-resolve.test.js` | test | — | Casos existentes `:145-158` (norm, empate) | exact |
| `test/manager.test.js` (~844-857) | test | — | Assert de slice GRP-04 existente `:849-852` | exact |

---

## Pattern Assignments

### Plan A — Saneo del nudge

#### `src/hooks/stop.js` → `buildStopNudgeText` (utility, transform) — FIX 75/WR-01

**Analog primario (patrón a copiar):** `src/cli/dashboard/App.js:752-753` — el carril de render YA sanea `next` con `stripControlChars`. Plan A cierra la asimetría replicando ese saneo en el carril del nudge.

**Helper a reutilizar** (`src/cli/format.js:80-87`) — pura, never-throws, identidad sobre ASCII limpio:
```js
export function stripControlChars(s) {
  return String(s)
    .replace(/\x1b\[[\d;]*[A-Za-z]/g, '')          // CSI completas
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, ''); // C0+DEL+C1, preserva \t \n
}
```

**Estado actual** (`src/hooks/stop.js:48-73`) — los 3 campos LLM se interpolan crudos aquí (único punto de convergencia):
```js
export function buildStopNudgeText(session, next) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;  // ← task_ref + summary crudos
  let text;
  switch (getSessionMode(session)) { /* ... */ }
  if (typeof next === 'string' && next.length > 0) {
    text += `Siguiente paso sugerido por la sesión: ${next}\\n`;  // ← next crudo
  }
  return text;
}
```

**Fix recomendado (Opción 1 — sanear DENTRO de la función pura):**
- Import a añadir: `import { stripControlChars } from '../cli/format.js';` (mismo patrón que `App.js`/`markdown.js`; NO viola `format-isolation` porque no importa picocolors directo).
- Sanear los 3 campos en el punto de interpolación: `stripControlChars(session.task_ref)`, `stripControlChars(session.summary)`, `stripControlChars(next)` (este último dentro del guard `typeof === 'string' && length > 0` existente).
- **Invariantes:** la función SIGUE pura (`stripControlChars` es cero-I/O → test de pureza de `test/stop.test.js` verde). D-09: identidad sobre inputs limpios → goldens por-modo byte-idénticos.

#### `src/hooks/session-end.js:248-261` (hook, event-driven)

**Estado actual** — el nudge se emite aquí con `handoffNext` crudo:
```js
if (orchMatch) {
  await cmuxClient.send({
    workspace: orchMatch[1],
    text: buildStopNudgeText(session, handoffNext),  // handoffNext SIN sanear
  });
}
```
**Con Opción 1 (recomendada):** este fichero NO se toca — el saneo ocurre dentro de `buildStopNudgeText`. Solo se toca si el planner elige la Opción 2 (sanear `handoffNext` aquí antes de threadear, que además exige sanear `summary`/`task_ref` antes de construir `session` → más disperso). El saneo va dentro del `try/catch` estructural existente (never-throws preservado).

---

### Plan B — Hardening de resolución de grupos cmux

#### `src/session/manager.js` → `deriveExpectedGroupName` (transform) — FIX 77/WR-01 + IN-01

**Analog:** la guarda de entrada YA existe en la misma función (`:146`); el fix la extiende a operar sobre el ref trimeado y a validar el identifier DERIVADO.

**Estado actual** (`src/session/manager.js:143-162`):
```js
export function deriveExpectedGroupName(task, entry, resolvedPath) {
  const ref = task && task.ref;
  if (typeof ref !== 'string' || ref.trim() === '') return null;   // guarda solo del crudo
  const identifier = ref.includes('#')                              // ← opera sobre ref CRUDO (IN-01)
    ? ref.split('#')[0].split('/').pop()
    : ref.replace(/-\d+$/, '');
  // ... NO valida identifier vacío (WR-01)
```

**Fix (fusionar WR-01 + IN-01 en un solo cambio cohesivo — misma función):**
```js
const ref = String(task?.ref ?? '').trim();          // IN-01: derivar sobre ref trimeado
if (ref === '') return null;
const identifier = ref.includes('#')
  ? ref.split('#')[0].split('/').pop()
  : ref.replace(/-\d+$/, '');
if (!identifier || identifier.trim() === '') return null;  // WR-01: derivado vacío → fail-open null
```
**Cierra:** `'#7'`→null, `'-9'`→null, `'KODO-9 '`→match limpio. **Pitfall 3:** el fixture live (`Kodo`/`SCRIBBA`/`SCP-CMRi`) debe seguir resolviendo `KODO-9`→`workspace_group:1`.

#### `src/session/manager.js` → `resolveWorkspaceGroup` (transform) — FIX 77/IN-02

**Analog:** el type-check por-campo YA existe en la misma línea (`:185`); el fix añade un predicado de shape.

**Estado actual** (`:185`):
```js
if (g && typeof g.name === 'string' && typeof g.ref === 'string' && norm(g.name) === target) {
  return g.ref;
}
```
**Fix (añadir guarda de shape `workspace_group:\d+`):**
```js
if (g && typeof g.name === 'string' && typeof g.ref === 'string'
    && /^workspace_group:\d+$/.test(g.ref) && norm(g.name) === target) {
  return g.ref;
}
```
Bloquea refs anómalos de cmux (p. ej. con `\n` que forjaría líneas de log — V5/Tampering).

#### `src/session/manager.js:388-396` → `launchWorkItem` (request-response) — FIX 77/IN-04 (+ IN-03 opcional)

**Estado actual:**
```js
try {
  const expectedName = deriveExpectedGroupName(task, entry, projectPath);
  const raw = await host._legacy.listWorkspaceGroups();   // ← se ejecuta siempre, aunque expectedName sea null
  groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName);
} catch {
  console.log('[kodo] group_skipped — resolucion_fallo');  // ← descarta el error (IN-03)
}
```
**Fix IN-04 (guardar la llamada cmux cuando `expectedName` es null):**
```js
const expectedName = deriveExpectedGroupName(task, entry, projectPath);
if (expectedName) {
  const raw = await host._legacy.listWorkspaceGroups();
  groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName);
}
```
**Fix IN-03 (OPCIONAL — diagnosticabilidad, decisión de plan):** `catch (err) { console.log(\`[kodo] group_skipped — resolucion_fallo: ${String(err?.message).slice(0,80)}\`); }`. D-11 preservado: el mensaje viene de cmux/JSON.parse, nunca del título de tarea. **NO tocar** `newWorkspaceWithGroupFallback:209-217` (D-10 LOCKED — IN-07 out of scope).

#### `src/host/cmux.js:358` (provider, doc) — FIX 77/IN-06

**Estado actual:**
```js
/** @param {{ name: string, cwd?: string, command?: string }} opts @returns {Promise<string>} */
async newWorkspace(opts) {
```
**Fix (añadir `group?: string` al JSDoc — el passthrough ya lo recibe vía `newWorkspaceWithGroupFallback`):**
```js
/** @param {{ name: string, cwd?: string, command?: string, group?: string }} opts @returns {Promise<string>} */
```

#### `test/session/group-resolve.test.js` — FIX 77/WR-01+IN-01 tests + WR-02 (Unicode)

**Analog:** casos existentes `:145-158` (norm NFC+lowercase+trim, empate first-match). Añadir a la misma suite:
- Casos WR-01/IN-01: `deriveExpectedGroupName` con `ref:'#7'`→null, `ref:'-9'`→null, `ref:'KODO-9 '`→match limpio.
- Caso WR-02 (Unicode NFD↔NFC): name en NFD (`ç` = `c`+`U+0327`) matchea expected en NFC → `workspace_group:N`. **Teeth:** borrar `.normalize('NFC')` de `:179` debe poner el test rojo.

**Patrón de aserción existente a copiar** (`:155-158`):
```js
it('norm = NFC+lowercase+trim: ...', () => {
  const g = { groups: [{ name: ' kodo ', ref: 'workspace_group:1' }] };
  assert.equal(resolveWorkspaceGroup(g, 'KODO'), 'workspace_group:1');
});
```

#### `test/manager.test.js:849-852` — FIX 77/IN-05 (assert de slice no-vacuo)

**Estado actual (frágil — slice puede dar `''` si se reordenan funciones):**
```js
const start = source.indexOf('export function buildSessionFromTask');
assert.ok(start >= 0, 'buildSessionFromTask debe existir');
const end = source.indexOf('export function resolveProjectPath');
const body = source.slice(start, end);
```
**Fix (añadir guarda ANTES de usar `body`):**
```js
assert.ok(end > start, 'resolveProjectPath debe seguir a buildSessionFromTask (delimitador del slice)');
```
**Pitfall 4:** el assert debe ir ANTES de `source.slice(...)`. Verificar con teeth: mutar el orden de funciones en local debe poner el test rojo.

---

## Shared Patterns

### Saneo de contenido no confiable (V5 Input Validation)
**Source:** `src/cli/format.js:80` (`stripControlChars`) — patrón de uso en `src/cli/dashboard/App.js:752-753`
**Apply to:** `buildStopNudgeText` (Plan A). Aplicar UNA vez en el punto de composición, no en cada sink. `stripControlChars` es pura y never-throws → no rompe pureza ni goldens.

### Guarda defensiva por-campo (never-throws → null)
**Source:** `src/session/manager.js:185` (type-check por campo en `resolveWorkspaceGroup`), `:146` (guarda de entrada en `deriveExpectedGroupName`)
**Apply to:** los 3 fixes de `manager.js` (WR-01/IN-01, IN-02). Validar el valor DERIVADO además del crudo; shapes inesperados → `null` (fail-open GRP-03).

### Log de degradación sin contenido de usuario (D-11)
**Source:** `src/session/manager.js:214` (`group_skipped — retry_sin_grupo`), precedente `worktree_skipped_nongit`
**Apply to:** IN-03 (si se incluye). Solo motivo/ref/`err.message` de cmux, NUNCA título de tarea. `slice(0,80)` acota.

### Byte-determinismo / teeth por mutación (D-09)
**Source:** goldens por-modo de `test/stop.test.js`, fixture live de `group-resolve.test.js`
**Apply to:** todos los planes. Criterio de éxito: suites verdes + goldens byte-idénticos + casos nuevos rojos-sin-fix / verdes-con-fix.

---

## No Analog Found

Ninguno. Todos los ficheros a modificar ya existen y todos los patrones a replicar están presentes en el repo (fase de deuda técnica, cero superficie nueva). El planner NO necesita recurrir a RESEARCH.md para patrones externos — no hay dependencias ni endpoints nuevos.

---

## Metadata

**Analog search scope:** `src/hooks/`, `src/cli/`, `src/session/`, `src/host/`, `test/session/`, `test/`
**Files scanned:** 7 (stop.js, format.js, session-end.js, manager.js, cmux.js, group-resolve.test.js, manager.test.js)
**Pattern extraction date:** 2026-07-22

**Ubicaciones abiertas de diseño (decidir en plan, ver RESEARCH §Open Questions):**
- Opción 1 (sanear en `buildStopNudgeText`, recomendada) vs Opción 2 (en `session-end.js`) → determina si `session-end.js` se toca.
- Alcance del saneo: 3 campos (`next`+`summary`+`task_ref`, recomendado) vs solo `next`.
- IN-03 (motivo del error en log): incluir vs diferir.
