---
phase: 29-gsd-provider-reporting-integration
reviewed: 2026-05-20T11:50:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/labels.js
  - src/triggers/dispatcher.js
  - src/config.js
  - src/orchestrator/launch.js
  - src/orchestrator/prompt.md
  - test/labels-hygiene.test.js
  - test/launch.test.js
  - test/config.test.js
  - test/orchestrator-gsd.test.js
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-05-20T11:50:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 29 integra anti-recursión GSD (`kodo:gsd-child`), opt-in config estricto (`isReportToProviderEnabled`), gate idempotente (`applyReportingGate`) y prosa ES provider-agnostic en `prompt.md`. La arquitectura central es correcta: el guard se ubica antes del branch `!opts.force` (D-06), la strict equality `=== true` cierra fail-closed contra truthy coercion (D-09), y la composición `applyReportingGate(resolvePromptTemplate(...), ...)` garantiza que `{{provider_name}}` se sustituye antes de que el gate evalúe los markers.

Se identifican dos Warnings y dos hallazgos Info. Ninguno es bloqueante para el comportamiento definido en REPORT-01..06; pero uno de los Warnings (WR-01) es una debilidad de robustez observable en producción si un proveedor MCP devuelve un `TaskItem` con `labels` no-array.

---

## Warnings

### WR-01: `task.labels.join(', ')` en dispatcher.js no es defensivo — crash antes del guard anti-recursión

**File:** `src/triggers/dispatcher.js:61`

**Issue:** La línea 61 hace `task.labels.join(', ')` sin validar que `task.labels` sea un array. Si un proveedor (o un stub de test) devuelve un `TaskItem` con `labels: null`, `labels: undefined`, o sin la propiedad, el dispatcher lanza `TypeError: Cannot read properties of null (reading 'join')` **antes** de que llegue al guard `isGsdChild` en la línea 68. Esto significa que el guard anti-recursión, aunque correcto en su posición, no tiene oportunidad de ejecutarse en ese escenario. El helper `isGsdChild` es defensivo contra null/non-array, pero la línea 61 lo corta antes.

Esta línea es pre-existente a Phase 29, pero Phase 29 insertó el guard (`isGsdChild`) asumiendo que `task.labels` llega validado. El riesgo concreto: si el agente Claude crea un sub-issue en un proveedor cuyo adaptador no normaliza correctamente `labels` (p. ej., campo `labels` ausente en la respuesta API), el dispatch crashea con TypeError en lugar de retornar `{ action: 'ignored', code: 'gsd_child' }`. El lock GSD no se libera porque el crash ocurre antes de su adquisición — en este caso no hay fuga de lock, pero el error es opaco y no observable via `kodo log`.

**Fix:**
```js
// Línea 61 — añadir fallback defensivo
const labelsArr = Array.isArray(task.labels) ? task.labels : [];
console.log(`[kodo:dispatch] Task: ${task.ref} — labels: [${labelsArr.join(', ')}]`);

// Y usar labelsArr en el resto del flujo: líneas 68, 75, 84
if (isGsdChild(labelsArr)) { ... }
const kodoConfig = parseKodoLabels(labelsArr.map((name) => ({ name })));
```

---

### WR-02: `DEFAULT_CONFIG` exportado sin `Object.freeze` — mutable desde tests externos

**File:** `src/config.js:32` / `test/config.test.js:6`

**Issue:** `DEFAULT_CONFIG` se exporta como named export en la línea 228 sin estar frozen (`Object.isFrozen(DEFAULT_CONFIG) === false`). El test `REPORT-02 — DEFAULT_CONFIG anti-mutation` (config.test.js:54) verifica que `DEFAULT_CONFIG` no tenga la key `workflow` en el momento en que ese test corre, pero no previene que otro test — en la misma suite o en futuros — mute el objeto entre importaciones del módulo ES (los módulos ES son singletons). Si algún test ejecutado antes de este `describe` hiciera `DEFAULT_CONFIG.workflow = { report_to_provider: true }`, el invariante D-03 quedaría roto silenciosamente para todos los tests posteriores que usen la función `isReportToProviderEnabled` sin inyección.

El riesgo es bajo hoy (ningún test actual muta `DEFAULT_CONFIG`), pero exportar un objeto mutable como constante de configuración es una trampa estructural. La convención del proyecto es que `DEFAULT_CONFIG` sea inmutable (D-03).

**Fix:**
```js
// src/config.js:32 — congelar el objeto raíz (no anidados, suficiente para el invariante D-03)
const DEFAULT_CONFIG = Object.freeze({
  provider: 'plane',
  providers: { ... },
  cmux: { ... },
  claude: { ... },
  server: { ... },
  // SIN 'workflow' — invariante D-03
});
```

Nota: `Object.freeze` shallow es suficiente para blindar la ausencia de la key `workflow` en el nivel raíz (D-03). Los objetos anidados (`providers.plane`, etc.) quedan mutables, pero ese riesgo es pre-existente y fuera del scope de Phase 29.

---

## Info

### IN-01: Trailing blank line en prompt al hacer strip con `enabled=false`

**File:** `src/orchestrator/launch.js:56-59` / `src/orchestrator/prompt.md:39-40`

**Issue:** El prompt.md tiene una línea vacía antes de `<!-- BEGIN reporting -->` (separador de sección). Cuando `applyReportingGate` aplica `enabled=false`, la regex `/<!-- BEGIN reporting -->[\s\S]*?<!-- END reporting -->\n?/g` elimina el bloque y el `\n` inmediatamente posterior, pero no el `\n` que precede al marcador `BEGIN`. El resultado termina con `\n\n` (doble newline) en lugar de `\n`. Esto es cosmético y no afecta la funcionalidad — el prompt es texto libre enviado vía cmux y Claude Code no es sensible a trailing whitespace. La idempotencia se preserva (confirmado: segunda aplicación no produce cambio). Ningún test del proyecto verifica trailing whitespace del prompt resultante.

**Fix:** Si en el futuro se requiere output limpio, la regex puede extenderse para absorber el newline previo:
```js
return prompt.replace(
  /\n?<!-- BEGIN reporting -->[\s\S]*?<!-- END reporting -->\n?/g,
  '',
);
```
Cambio no urgente — verificar que el test LG3 siga pasando (preserva "prose before the block").

---

### IN-02: Tests de prompt/launch usan `readFileSync` con paths relativos (frágiles si cwd cambia)

**File:** `test/launch.test.js:69,80` / `test/orchestrator-gsd.test.js:7,279,406`

**Issue:** Varios tests leen `src/orchestrator/prompt.md` con paths relativos sin `__dirname`:
```js
readFileSync('src/orchestrator/prompt.md', 'utf-8')  // relativo a cwd del proceso
```
El comando `npm test` invoca `node --test $(find test ...)` desde el raíz del repo, por lo que en condiciones normales funciona. Sin embargo, si alguien ejecuta los tests directamente desde un subdirectorio (`node --test test/launch.test.js` desde dentro de `test/`), todos fallarán con `ENOENT`. El patrón es pre-existente en el proyecto (también en `test/gsd-verify-cli-handler.test.js`), por lo que no es una regresión de Phase 29, pero los tests nuevos de Phase 29 lo perpetúan en cuatro nuevas llamadas.

**Fix:** Usar `__dirname` / `import.meta.url` para paths absolutos:
```js
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'src', 'orchestrator', 'prompt.md');
// ...
const real = readFileSync(PROMPT_PATH, 'utf-8');
```

---

## Notas del revisor

**Corrección en scope de WR-01:** La línea `task.labels.join(', ')` (línea 61) es pre-existente a Phase 29. Sin embargo, Phase 29 insertó el guard anti-recursión (`isGsdChild`, línea 68) en un contexto que asume `task.labels` válido. La declaración de defensividad de `isGsdChild` contra null/undefined en D-08 no es efectiva si la línea anterior ya crasheó. Por tanto se clasifica como Warning introducido por Phase 29 (el guard no cumple su promesa defensiva en ese edge case).

**Lo que está correcto y no se marcó:**
- Placement del guard: `isGsdChild` en línea 68 precede `!opts.force` (línea 74) y `acquireGsdLock` (línea 145) — correcto.
- Strict equality `=== true` en `isReportToProviderEnabled` — correcto.
- Composición `applyReportingGate(resolvePromptTemplate(...), isReportToProviderEnabled())` — el resolve ocurre BEFORE el gate, garantizando que los markers se evalúan sobre texto ya con placeholders sustituidos.
- Idempotencia de `applyReportingGate` — verificada: doble aplicación con `enabled=false` produce output idéntico.
- Source hygiene: 0 literales inline `'kodo:gsd-child'` fuera de `src/labels.js`.
- `prompt.md`: markers únicos (1 BEGIN + 1 END), heading `## Sub-issue reporting` entre markers, sección ubicada después de `## Sesiones GSD` (línea 30 < línea 40).
- Prosa ES: los 6 conceptos canónicos presentes, `{{provider_name}}` consistente, `HARD STEP` capitalizado, `NUNCA` cerca de `delete-issue`.

---

_Reviewed: 2026-05-20T11:50:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
