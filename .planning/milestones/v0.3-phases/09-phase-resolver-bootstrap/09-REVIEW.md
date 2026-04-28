---
status: issues_found
phase: 09-phase-resolver-bootstrap
reviewed_at: 2026-04-21T10:16:00Z
depth: standard
files_reviewed: 16
findings_total: 9
findings_by_severity:
  critical: 0
  high: 2
  medium: 3
  low: 4
---

# Phase 9: Code Review Report

**Reviewed:** 2026-04-21T10:16:00Z
**Depth:** standard
**Files Reviewed:** 16 (9 fuente + 7 tests)
**Status:** issues_found

## Summary

Phase 9 implementa el resolver de fase (`roadmap.js` parser puro, `resolver.js` discriminated union), el brief de bootstrap, la integración en el dispatcher con release de lock fail-closed, la extensión de `buildGsdContext` para renderizar brief, la persistencia `phase_id`/`brief` en `Session`, y el subcomando `kodo gsd inspect`. La calidad general es alta: patrón DI correcto, invariantes D-04 / D-18 protegidas por tests estáticos, spread condicional para campos opcionales, exhaustividad en los tests.

Se detectan sin embargo **dos bugs de comportamiento (HIGH)**:

1. **Doble emisión de `gsd.bootstrap`** — el dispatcher y el hook `session-start.js` emiten ambos el evento para el mismo dispatch bootstrap. El contrato D-14 + pattern-mapper #3 fue corregido para `gsd.phase.resolved` (sólo dispatcher) pero `gsd.bootstrap` quedó duplicado. Esto romperá `kodo logs --event gsd.bootstrap --count` de la misma forma que `gsd.phase.resolved` antes del fix.
2. **Exit code 2 semánticamente sobrecargado** — `runGsdInspect` retorna `2` tanto para fallo de fetch del provider como para fallo de `resolveProjectPath`. D-19 sólo especifica `2` para "provider fetch failure"; un mapping faltante genera el mismo código, lo que confunde scripts que usan `code === 2` como señal "reintenta / red mala".

Tres issues **MEDIUM** relacionados con exhaustividad de switches sin `default`, silent-failure cuando no hay project mapping para una task GSD, y un helper de logger (`gsdBootstrap`) que no soporta `brief_empty` lo que obliga al dispatcher a bypassearlo con `log.info` crudo (deriva de ruta de emisión).

Cuatro issues **LOW** de JSDoc stale, double `createLogger` en dispatcher, `else if` donde el switch ya retornó, y un string match frágil en test.

## High

### HI-01: Doble emisión de `gsd.bootstrap` (dispatcher + hook)

**Files:**
- `src/triggers/dispatcher.js:198-204`
- `src/hooks/session-start.js:188-200`

**Issue:** El dispatcher ya emite `gsd.bootstrap` (con `brief_empty`) cuando el resolver devuelve `action === 'bootstrap'`. El hook SessionStart vuelve a emitir el mismo evento cuando detecta `session.gsd && !session.phase_id`. Resultado: cada bootstrap dispatch produce DOS entradas NDJSON con `event: 'gsd.bootstrap'` — el pattern-mapper #3 arregló exactamente este problema para `gsd.phase.resolved` pero no para `gsd.bootstrap`. Rompe la invariante "Una sola entry por dispatch" del contexto (D-14) y hace que `kodo logs --event gsd.bootstrap` double-cuente. El test `test/session-start.test.js:156` incluso pide activamente que el hook siga emitiéndolo, cementando el bug.

**Fix:** Dejar la emisión en el dispatcher (fuente de verdad del resolver, ya incluye `brief_empty`) y eliminar la del hook. Añadir test de anti-regresión análogo al existente para `gsdPhaseResolved`:

```js
// en src/hooks/session-start.js — eliminar el bloque 188-200
- if (session.gsd && !session.phase_id) {
-   try {
-     const { createLogger } = await import('../logger.js');
-     const { gsdBootstrap } = await import('../logger-events.js');
-     ...
-     gsdBootstrap(log, { project_path: session.project_path });
-   } catch {}
- }
```

```js
// en test/session-start.test.js — reemplazar el test 156 por:
it('Phase 9: does NOT emit gsd.bootstrap from hook (moved to dispatcher)', () => {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/gsdBootstrap\s*\(/.test(stripped));
});
```

---

### HI-02: `runGsdInspect` retorna `2` para dos fallos de clase distinta

**File:** `src/cli/gsd-inspect.js:64-76`
**Issue:** D-19 declara: *"Exit codes: `0` si `action === 'phase'` o `'bootstrap'`; `1` si `action === 'error'`"*. El contrato del output de este phase review añade: *"2 provider fetch failure"*. El código actual retorna `2` tanto cuando `provider.getTask` lanza (línea 65) como cuando `resolveProjectPathFn` lanza ("No local path mapped for project …", línea 73). Un mapping ausente es un error de configuración del usuario, no un fallo transitorio de red — el script `kodo gsd inspect X && fire-webhook` se comportará idéntico ante una tarea cuyo project_id está sin mapear (error de usuario) que ante un provider caído (transiente). Scripts que hacen retry-on-2 reintentarán para siempre.

**Fix:** Distinguir ambos códigos. El contrato plausible: `2` fetch failure, `1` error semántico (resolver + mapping). Concretamente:

```js
let projectPath;
try {
  projectPath = resolveProjectPathFn(task);
} catch (e) {
  err(`Error resolving project path: ${e.message}\n`);
- return 2;
+ return 1;  // config error — semantic failure, not a transient fetch issue
}
```

Alternativamente, crear un exit code `3` para mapping missing si se quiere distinguirlos los tres. Actualizar el comentario `@returns` y la doc de D-19 para reflejar la semántica elegida.

## Medium

### ME-01: Switch sobre discriminated union sin `default` en dispatcher y CLI

**Files:**
- `src/triggers/dispatcher.js:147-184`
- `src/cli/gsd-inspect.js:120-136`

**Issue:** D-02 manda explícitamente: *"Exhaustive `switch(result.action)` en consumidores (dispatcher, CLI inspect, logger-events formatters)"*. Ambos switches cubren `phase | bootstrap | error`, pero ninguno tiene `default`. Si alguien añade un cuarto miembro al union (p. ej. `no-planning-root`, `ambiguous-workspace`, lo que sea en v0.4) el switch cae silenciosamente:

- En el dispatcher, `gsdPhaseId` y `gsdBrief` siguen siendo `null` y se lanza una sesión GSD sin contexto ni phase_id → UX roto sin traza.
- En `renderHuman` del CLI no se imprime ninguna sección "Verdict: …" → output muted.

**Fix:** Añadir `default` que `assert.fail` o log-and-return:

```js
// dispatcher.js
switch (resolverVerdict.action) {
  case 'phase': ...
  case 'bootstrap': ...
  case 'error': ...
+ default: {
+   // Exhaustiveness guard (D-02): unknown verdict kind means contract drift.
+   const _exhaustive = /** @type {never} */ (resolverVerdict);
+   throw new Error(`Unknown resolver verdict action: ${JSON.stringify(_exhaustive)}`);
+ }
}
```

```js
// cli/gsd-inspect.js renderHuman
+ default:
+   write(`  action:        <unknown: ${JSON.stringify(verdict)}>\n`);
```

El patrón `/** @type {never} */` aprovecha `@ts-check` para que TypeScript avise si se añade un nuevo miembro al union sin actualizar los consumidores.

---

### ME-02: Task GSD con mapping faltante → resolver skippeado en silencio

**File:** `src/triggers/dispatcher.js:114-133, 145`
**Issue:** Si `resolveProjectPathFn(task)` lanza para una task GSD (línea 117-120), `gsdProjectPath` queda en `null`. A continuación:

- línea 121 `if (gsdProjectPath)` → NO adquiere lock.
- línea 145 `if (kodoConfig.flags.includes('gsd') && gsdProjectPath)` → NO ejecuta el resolver.

El dispatcher entonces cae al launch normal (línea 258-272) sin `phase_id` ni `brief` pero con `flags: ['gsd']`. El hook SessionStart al ver `session.gsd && !session.phase_id` emite `gsd.bootstrap` (además del doble-emit de HI-01) y renderiza el bloque bootstrap. Pero la task puede no ser un bootstrap real — es simplemente una task sin project path configurado. El comentario del código lo admite: *"launch will fail later with same error"*, pero `launchWorkItem` llama a `resolveProjectPath` con el mismo mapa y lanza, así que la sesión nunca arranca. Sin embargo se pierde la oportunidad de emitir `resolver_failed` con código informativo (`no-project-mapping` o similar) y `kodo logs` no tendrá un evento `gsd.phase.resolved` para esta dispatch fallida.

**Fix:** Retornar explícitamente un `resolver_failed` con código nuevo antes de continuar (equivalente conceptual a `roadmap-missing`):

```js
if (kodoConfig.flags.includes('gsd')) {
  try {
    gsdProjectPath = resolveProjectPathFn(task);
  } catch (err) {
-   gsdProjectPath = null;
+   // Fail-closed: no mapping for a GSD task is a config error, not a silent
+   // skip. Emit forensic event and return so kodo logs captures it.
+   console.log(`[kodo:dispatch] resolver_failed — ${task.ref}: no-project-mapping`);
+   return { action: 'resolver_failed', code: 'no-project-mapping', detail: err.message };
  }
  ...
```

Esto también simplifica la condición de la línea 145 (`gsdProjectPath` deja de poder ser `null` en la rama GSD).

---

### ME-03: Helper `gsdBootstrap` no soporta `brief_empty` — el dispatcher lo bypasea con `log.info` crudo

**Files:**
- `src/logger-events.js:151-160`
- `src/triggers/dispatcher.js:200-204`

**Issue:** D-12 requiere emitir `brief_empty: true` en `gsd.bootstrap` cuando la descripción viene vacía. El helper `gsdBootstrap(log, { project_path })` no acepta ese campo. Como consecuencia, el dispatcher emite el evento con `log.info('gsd.bootstrap', { event, project_path, brief_empty })` saltándose el helper. El hook sí usa `gsdBootstrap(log, { project_path: session.project_path })`. Dos rutas, dos estructuras: el evento del hook **nunca** llevará `brief_empty` (y si se corrige HI-01, esto deja de ser bug práctico, pero hoy es una divergencia silenciosa del contrato).

**Fix:** Extender la firma del helper:

```js
// logger-events.js
-export function gsdBootstrap(logger, fields) {
+/**
+ * @param {Logger} logger
+ * @param {{ project_path: string, brief_empty?: boolean }} fields
+ */
+export function gsdBootstrap(logger, fields) {
  logger.info(EVENTS.GSD_BOOTSTRAP, {
    event: EVENTS.GSD_BOOTSTRAP,
    project_path: fields.project_path,
+   ...(fields.brief_empty !== undefined && { brief_empty: fields.brief_empty }),
  });
}
```

Luego en dispatcher.js:200-204 reemplazar `log.info('gsd.bootstrap', {...})` por `gsdBootstrap(log, { project_path: gsdProjectPath, brief_empty: isBriefEmpty(task) })`.

## Low

### LO-01: JSDoc de `findSession` no documenta `sessionId`

**File:** `src/session/state.js:154-169`
**Issue:** El typedef del parámetro dice `{ cwd?: string, workspaceRef?: string }`, pero el código en las líneas 158-161 accede a `query.sessionId`. El hook `session-start.js:148` llama `findSession({ sessionId, cwd })`. `@ts-check` no avisa porque la pluma del objeto queda anulada por la conversión implícita. Pre-existente, no introducido por Phase 9, pero visible ahora.

**Fix:**

```js
-/**
- * Find session by workspace ref or project path
- * @param {{ cwd?: string, workspaceRef?: string }} query
- */
+/**
+ * Find session by session_id (preferred, unique), workspace ref or cwd.
+ * @param {{ sessionId?: string, cwd?: string, workspaceRef?: string }} query
+ */
 export function findSession(query) {
```

---

### LO-02: Dos `createLogger` en el mismo flow del dispatcher

**File:** `src/triggers/dispatcher.js:163-208`
**Issue:** El dispatcher instancia `createLogger` dos veces en el mismo dispatch si el verdict es `phase` o `bootstrap`: una vez en la rama `error` (línea 163-174, inaccesible cuando no es error) y otra después del switch (línea 187-192). Como ambas están en `try/catch` independientes, no hay bug real, pero hay ~30 líneas duplicadas que pueden divergir. Leer el logger del env dos veces es también un mini-smell.

**Fix:** Extraer un helper local `buildDispatchLogger(sessionId, taskId)` dentro del módulo y reutilizar:

```js
const buildDispatchLogger = async (sessionId, taskId) => {
  const { createLogger } = await import('../logger.js');
  return createLogger({
    sessionId: sessionId || 'dispatch',
    minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
  }).child({ component: 'dispatcher', task_id: taskId });
};
```

---

### LO-03: `else if` redundante después de `switch` con returns

**File:** `src/triggers/dispatcher.js:193-205`
**Issue:** El switch de las líneas 147-184 retorna en `case 'error'`. El bloque posterior (línea 185-208) corre solo para `phase` o `bootstrap` — pero usa `if (resolverVerdict.action === 'phase') ... else if (resolverVerdict.action === 'bootstrap')` cuando podría usar el mismo switch del que ya se conoce la exhaustividad. Mezclar switch + if-chain sobre el mismo discriminator invita a drift (ver ME-01). Refactor natural al arreglar ME-01:

```js
switch (resolverVerdict.action) {
  case 'phase':
    gsdPhaseId = resolverVerdict.phase_id;
    gsdPhaseResolved(log, { phase_id: ..., match_heading: ... });
    break;
  case 'bootstrap':
    gsdBrief = buildBriefFromTask(task);
    gsdBootstrap(log, { project_path: gsdProjectPath, brief_empty: isBriefEmpty(task) });
    break;
  case 'error':
    // release + return
  default: /* exhaustive guard */
}
```

---

### LO-04: Test `gsd-inspect-cli.test.js` D-18 invariante frágil con `launchWorkItem`

**File:** `test/gsd-inspect-cli.test.js:192`
**Issue:** La aserción `assert.ok(!/launchWorkItem/.test(src))` también rechazaría un comentario como `// NOTE: never call launchWorkItem here`. Hoy funciona porque no hay comentario así, pero una futura doc-inline legítima rompería el test. Es la misma técnica que `session-start.test.js:142-153` aplica para `gsdPhaseResolved` con strip de comentarios — aplicar el mismo tratamiento aquí:

```js
const stripped = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
assert.ok(!/launchWorkItem/.test(stripped), 'must not reference launchWorkItem');
```

Aplicable también a los otros `assert.ok(!/import.*.../.test(src))` del mismo test — hoy el código pasa, mañana un comentario descriptivo lo rompe.

---

_Reviewed: 2026-04-21T10:16:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
