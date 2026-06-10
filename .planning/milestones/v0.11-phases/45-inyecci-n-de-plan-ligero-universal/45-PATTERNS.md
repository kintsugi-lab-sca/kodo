# Phase 45: Inyección de plan ligero universal - Pattern Map

**Mapped:** 2026-06-10
**Files analyzed:** 4 (1 source edit, 2 test edits, 1 downstream contract reference)
**Analogs found:** 4 / 4 (todos los patrones viven en el propio fichero o en sus tests — fase intra-codebase pura)

> Nota de scope: esta fase es una edición quirúrgica de **un solo fichero de producción** (`src/hooks/session-start.js`) más extensión de dos ficheros de test. No hay "archivos nuevos" que clasificar por rol/data-flow al estilo controller/service. Los "analogs" relevantes son los **bloques existentes del propio fichero** (los bloques Anti-push HOOK-01/HOOK-02) y los **tests existentes** que los pinean. Esos son los patrones canónicos a copiar.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/hooks/session-start.js` (MODIFY) | hook builder (puro) | transform (session → string) | Bloque "Anti-push" en el mismo fichero (`buildSessionContext` L70-78 / `buildGsdContext` L166-180) | exact (mismo patrón append-al-final, mismo fichero) |
| `test/session-start.test.js` (MODIFY) | test | request-response (assert sobre string) | Tests HOOK-01/HOOK-02 existentes (L99-120) + fixtures `makeSession`/`makeConfig` (L15-39) | exact |
| `test/gsd-context.test.js` (MODIFY) | test | request-response (assert sobre string) | Test `D-04 common-block invariance` (L160-170) + idempotencia (L172-185) | exact |
| `src/cli/dashboard/plan.js` (READ-ONLY, no se toca) | consumer (downstream, Phase 46) | file-I/O (read best-effort) | — (referencia de contrato, no se edita en esta fase) | n/a |

## Pattern Assignments

### `src/hooks/session-start.js` — bloque ES (controller `buildSessionContext`, transform)

**Analog:** el propio bloque "Anti-push-fantasma" al final del `return [...]` (líneas 70-78). Ese bloque es la prueba viva del patrón HOOK-02 "append al FINAL preserva golden bytes".

**Imports a añadir** (top del fichero, hoy NO presentes — el fichero importa solo `fileURLToPath`, `findSession`, `loadConfig`, `getSessionMode` en L8-11):
```javascript
// Patrón de import idéntico a src/session/state.js:3-4 (mismo par join + KODO_DIR)
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
```
- `KODO_DIR` se exporta verificado en `src/config.js:228` (`export { KODO_DIR, CONFIG_PATH, PROJECTS_PATH, DEFAULT_CONFIG };`).
- `KODO_DIR = join(homedir(), '.kodo')` (`src/config.js:6`) — const evaluada al import, NO I/O en runtime del builder. Mantiene la pureza.
- **Landmine documentado (Pitfall 3 / memorias 21811, 21885, 22683):** `KODO_DIR` se cachea al import; los tests NO deben redirigir `HOME` para verificar la ruta — deben computar el esperado con el mismo `KODO_DIR`.

**Patrón append-al-final** (a copiar exactamente del estilo L70-78):
```javascript
// src/hooks/session-start.js:31-79 — estructura existente: el bloque nuevo se añade
// como ELEMENTOS FINALES del array literal antes de .join('\n').
return [
  // ... TODO el bloque existente sin tocar, hasta la última línea Good/Bad ...
  '   - Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
  // --- APPEND nuevo (D-04a non-GSD, D-08 ES, D-09 complementario "Además") ---
  '',
  `Además, escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`.`,
].join('\n');
```
- **Comentario inline a replicar** (estilo L29-30): documentar "Phase 45 PLAN-03: append al FINAL preserva golden bytes (HOOK-02 satisfied-by-construction)".
- La separación con una línea `''` vacía replica el patrón de separación con `\n\n` que el test HOOK-02 verifica (`prefix.endsWith('\n\n')`).

---

### `src/hooks/session-start.js` — rama quick (controller `buildGsdContext`, transform)

**Analog:** la propia rama `if (mode === 'quick')` con su `lines.push(...)` (líneas 109-133).

**Patrón append-DENTRO-de-la-rama** (crítico — NO después del bloque común):
```javascript
// src/hooks/session-start.js:123-133 — el push de la rama quick.
// La instrucción nueva va como ÚLTIMOS argumentos de ESTE lines.push, DENTRO del if.
lines.push(
  'This is a one-shot GSD session.',
  '',
  'Execute the slash command:',
  '',
  `1. \`/gsd-quick "${safeTitle}"\``,
  '',
  'Run the slash command and finish — no plan/execute/verify cycle.',
  // --- APPEND nuevo (D-04b quick, D-08 EN, D-09 complementario "Also") ---
  '',
  `Also, write a short plan (what you'll do + planned steps) to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`.`,
);
// El bloque común "## No automatic push" (lines.push fuera del if/else, L169-180) NO se toca.
```
- **Anti-pattern crítico (Pitfall 2):** NO appendear después del `lines.push('## No automatic push', ...)` común (L169-180). Rompería `D-04 common-block invariance` (gsd-context.test.js:160). El tail desde `## No automatic push` debe quedar byte-idéntico en quick/phase/bootstrap.
- **Ramas phase (L134-146) y bootstrap (L147-163): NO TOCAR** (D-04 las excluye; sus bytes están pineados).

**Error handling / guard:** N/A para producción — `main()` hace `process.exit(0)` si `findSession` no devuelve sesión (L204-207), así que el builder nunca corre sin `session.task_id`. Defensa opcional `session.task_id ?? 'unknown'` es discrecional y probablemente over-engineering (Pitfall 1 / Assumption A2). Recomendación: confiar en el invariante, NO ensuciar golden-bytes con defensa.

---

### `test/session-start.test.js` (test) — extender con casos non-GSD

**Analog:** tests HOOK-01/HOOK-02 (L99-120) + fixtures `makeSession`/`makeConfig` (L15-39).

**Fixtures a reusar tal cual** (NO redefinir):
```javascript
// test/session-start.test.js:15-39 — makeSession ya provee task_id: 'uuid-123' por defecto.
function makeSession(overrides = {}) {
  return { workspace_ref: 'KL-42', session_id: 'sess-abc', task_id: 'uuid-123', /* ... */ ...overrides };
}
function makeConfig(overrides = {}) { /* provider plane + mcp_hint */ }
```

**Patrón de assert de ruta resuelta** (sin hardcodear HOME — Pitfall 3):
```javascript
// Añadir al top del fichero de test:
import { KODO_DIR } from '../src/config.js'; // join ya importado en L6
// Caso nuevo (estilo de los it() existentes):
it('PLAN-03 non-GSD: inyecta instrucción ES con ruta resuelta ~/.kodo/plans/<task_id>.md', () => {
  const ctx = buildSessionContext(makeSession({ task_id: 'uuid-abc' }), makeConfig());
  const expectedPath = join(KODO_DIR, 'plans', 'uuid-abc.md');
  assert.ok(ctx.includes(expectedPath), `debe incluir la ruta resuelta ${expectedPath}`);
  assert.ok(!ctx.includes('<task_id>'), 'no debe contener el literal <task_id>');
  assert.match(ctx, /Además, escribe un plan corto/);
});
```
- **Patrón de assert ya establecido:** `assert.match(ctx, /regex/)` para presencia, `assert.ok(!ctx.includes(...))` para ausencia (ver L107-112, L82-83). Copiarlo.
- **Patrón golden-bytes HOOK-02 a extender** (L115-120): `ctx.lastIndexOf(HEADER)` + `prefix.endsWith('\n\n')`. La instrucción nueva queda DESPUÉS del header Anti-push, así que ese assert sigue verde sin cambios.

---

### `test/gsd-context.test.js` (test) — extender con casos quick + invariancia

**Analog:** test `D-04 common-block invariance` (L160-170) e idempotencia (L172-185).

**Patrón de invariancia de ramas excluidas** (a replicar para PLAN-03):
```javascript
// test/gsd-context.test.js:160-170 — el patrón tail() canónico.
const tail = (s) => s.slice(s.lastIndexOf('## No automatic push'));
// Caso nuevo PLAN-03:
it('PLAN-03: rama quick recibe instrucción EN; phase/bootstrap NO', () => {
  const quick = buildGsdContext(makeSession({ gsd_mode: 'quick', summary: 'X' }));
  const phase = buildGsdContext(makeSession({ phase_id: '08' }));
  const boot  = buildGsdContext(makeSession({ phase_id: undefined }));
  assert.match(quick, /Also, write a short plan/);
  assert.ok(!phase.includes('Also, write a short plan'), 'phase no lleva la instrucción');
  assert.ok(!boot.includes('Also, write a short plan'), 'bootstrap no lleva la instrucción');
});
```
- **CRÍTICO — el test L160 `D-04 common-block invariance` debe seguir verde:** verifica que `tail(quick) === tail(phase) === tail(boot)`. Como la instrucción quick va DENTRO del if (antes del bloque común), el tail compartido no cambia. Este test es el guard que detecta el anti-pattern de Pitfall 2.
- **Quick fixture nota:** `getSessionMode` (verificado en `src/labels.js:82-85`) retorna `'quick'` solo si `gsd && gsd_mode === 'quick'`. La fixture quick necesita ambos: `makeSession({ gsd_mode: 'quick' })` (gsd:true ya es default en este fichero, L22).

---

## Shared Patterns

### Resolución de ruta bajo KODO_DIR
**Source:** `src/session/state.js:3-4` (analog directo) y `src/config.js:6,228`
**Apply to:** ambos builders editados (ES y quick)
```javascript
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
// uso: join(KODO_DIR, 'plans', `${session.task_id}.md`)
```
`state.js` es el precedente exacto: importa `join` de `node:path` y `KODO_DIR` de `../config.js` con el mismo propósito (componer rutas bajo `~/.kodo`). Copiar ese par de imports verbatim. Alternativa válida (Open Question #1): `import { homedir } from 'node:os'` + `join(homedir(), '.kodo', 'plans', ...)` si el plan-checker objeta acoplar el hook a config.js. Recomendación del research: usar `KODO_DIR` (DRY, una línea).

### Append-al-final preserva golden-bytes (HOOK-02)
**Source:** `src/hooks/session-start.js:29-30, 70-78` (ES) y `166-180` (EN común)
**Apply to:** toda extensión de los builders
- Añadir SOLO como elementos finales del array / últimos args del `lines.push`.
- Replicar el comentario inline "append al FINAL preserva golden bytes (HOOK-02 satisfied-by-construction)".
- Separar con una línea `''` vacía para producir el `\n\n` que los tests de prefix verifican.

### Assert best-effort / never-throws del consumidor (Phase 46, informativo)
**Source:** `src/cli/dashboard/plan.js:58-133`
**Apply to:** el FORMATO del artefacto que la instrucción pide escribir (no es código de esta fase, pero condiciona D-05)
```javascript
// plan.js:98,109 — contención anti-traversal con String.includes, NO RegExp (D-13 / anti-ReDoS):
(e) => e.startsWith(`${padded}-`) && !e.includes('/') && !e.includes('\\') && !e.includes('..')
// plan.js:123-128 — cada readFile en su propio try/catch: degrada a 'error', nunca lanza.
```
El artefacto markdown debe ser **plano, sin frontmatter** (D-05) para que el render plano del overlay no muestre `---` como ruido. La correlación vive en el nombre de fichero (`<task_id>.md`), que `plan.js` resolverá con `String.includes` anti-ReDoS — el formato del artefacto no debe asumir parsing complejo.

## No Analog Found

Ninguno. Todos los patrones tienen analog exacto en el propio fichero o en sus tests. Esta es una fase intra-codebase: el patrón a copiar es el bloque Anti-push (HOOK-01/HOOK-02) ya implementado y pineado por tests verdes (baseline 48/48).

## Metadata

**Analog search scope:** `src/hooks/`, `src/config.js`, `src/session/state.js`, `src/labels.js`, `src/cli/dashboard/plan.js`, `test/session-start.test.js`, `test/gsd-context.test.js`
**Files scanned:** 7 (todos leídos directamente, HIGH confidence)
**Pattern extraction date:** 2026-06-10
**Baseline verificado:** `node --test test/session-start.test.js test/gsd-context.test.js` → 48/48 verde (research L313)
