---
phase: 80-carril-orquestador-reconciliaci-n-documental
reviewed: 2026-07-23T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - .claude/skills/kodo-orchestrate/skill.md
  - src/check.js
  - src/logger-events.js
  - src/orchestrator/prompt.md
  - test/check-isolation.test.js
  - test/check.test.js
findings:
  critical: 0
  warning: 3
  info: 1
  total: 4
status: issues_found
---

# Phase 80: Code Review Report

**Reviewed:** 2026-07-23
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Se revisó el carril orquestador in-process (piggyback del sidebar doctor en
`runCheckAndAct`) más la reconciliación documental (skill, prompt, taxonomía de
eventos) y los tests asociados. La suite (`check.test.js` + `check-isolation.test.js`,
33 tests) pasa en verde.

**Verificación de las restricciones LOCKED — todas satisfechas:**

- **El sidebar NO es trigger.** El resultado del doctor (`report`, `r`) solo se
  loguea; jamás se escribe en `reasons` ni altera `needsOrchestrator`. El piggyback
  vive DENTRO de `if (result.needsOrchestrator)` y no re-alimenta el gate (D-04).
  Test C lo confirma (sidebar sucio + check limpio ⇒ 0 llamadas).
- **In-process, sin subprocess.** Import directo de `scan`/`execute`; no shellea
  `kodo sidebar doctor --fix`.
- **Solo cuando `needsOrchestrator === true`, ANTES de `launchOrchestrator()`,
  fail-open.** Orden `execute` → `launch` verificado (Test A); `try/catch` propio
  garantiza que un throw del doctor no bloquea el launch (Test D / D2).
- **LOG-12.** `deps = {}` ⇒ `noopLogger` (verificado en `resolveDeps`). El grafo
  estático de `check.js` alcanza `sidebar-doctor.js` pero NO `logger.js`
  (`check-isolation` verde). Runtime: los providers cargados por `initRegistry`
  y `state.js` solo hacen `await import('logger-events.js')` (puro), nunca
  `logger.js`. Invariante intacta.
- **`missing_group` sigue advisory.** No se ejecuta; solo se reporta.
- **`runCheck()` byte-idéntico.** Cuerpo sin cambios; Test E lo blinda.
- **`src/orchestrator/launch.js` intacto** (diff vacío).
- **`prompt.md`:** placeholders `{{provider_name}}` (8), `{{provider}}` (1),
  `{{mcp_tool}}` (2) y marcadores `<!-- BEGIN/END reporting -->` presentes e
  intactos; el diff solo añadió 2 párrafos de contexto.

No hay BLOCKER: el cambio es quirúrgico y bien acotado. Las 3 advertencias son
degradaciones de observabilidad/robustez y cobertura de test, más 1 nota de diseño.

## Warnings

### WR-01: Los fallos por-item del sidebar son silenciosos en el carril automático

**File:** `src/check.js:156-166`
**Issue:** El piggyback inyecta `deps = {}`, lo que resuelve a `noopLogger`
(obligado por LOG-12). Dentro de `execute()`, cada acción fallida NO lanza:
se captura en `result.errors` y se emite vía `sidebarDoctorFixError(log, ...)`,
donde `log` es el `noopLogger` → **no-op silencioso**. El piggyback, además,
**nunca inspecciona `r.errors`** (`grep errors src/check.js` no devuelve nada):
solo lee `r.added` y `r.ungrouped`. Consecuencia: si 3 `addToWorkspaceGroup`
fallan (cmux caído, race), el operador ve exactamente `[kodo:check] Sidebar:
0 acción(es) aplicadas`, **indistinguible** de "no había nada que arreglar".

El comentario de la línea 150-153 promete "un error del doctor loguea una línea",
pero eso solo aplica al throw top-level (capturado por el `catch` → `errorFn`).
Los fallos por-item no throwean y quedan invisibles en AMBOS canales (no hay
NDJSON porque es noopLogger; no hay stdout porque el piggyback ignora `r.errors`).

**Fix:** Sin violar LOG-12 (no inyectar el logger real), inspeccionar el conteo
de errores y emitirlo por `logFn` (stdout, 0-token):
```js
const r = await executeFn(deps, { fix: true });
const applied = (r.added || 0) + (r.ungrouped || 0);
logFn(`[kodo:check] Sidebar: ${applied} acción(es) aplicadas`);
const failed = (r.errors || []).length;
if (failed > 0) {
  errorFn(`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`);
}
```

### WR-02: La rama de advisories y la línea "Sidebar: N aplicadas" no tienen cobertura de test

**File:** `test/check.test.js:321-439`, `src/check.js:159-163`
**Issue:** Ningún test ejercita la rama `if (report && report.hasAdvisories)`
(líneas 161-163). Los casos disponibles no la alcanzan:
- Test A y Test D usan `cleanReport()` (`hasAdvisories: false`).
- Test C sí tiene `hasAdvisories: true`, pero con `needsOrchestrator: false`,
  de modo que el piggyback nunca corre y la rama de advisories queda intocada.

Tampoco hay ninguna aserción sobre el output real: Test A/D pasan
`logFn: () => {}`, así que la línea `Sidebar: N acción(es) aplicadas` y el cálculo
`applied = added + ungrouped` no están cubiertos. Un cambio que rompiera el conteo
(p. ej. usar `r.created` en lugar de `r.added`) o la línea de advisories pasaría
en verde.

**Fix:** Añadir un test con `needsOrchestrator: true` + `scanFn` que retorne
`hasAdvisories: true` (con `missing_group` no vacío) y un `executeFn` que retorne
`{ added: 2, ungrouped: 1, ... }`, capturando `logFn` en un array y aseverando
que aparecen `Sidebar: 3 acción(es) aplicadas` y la línea de advisories con el
conteo correcto.

### WR-03: El guard de aislamiento LOG-12 es solo estático y descansa sobre una premisa falsa

**File:** `test/check-isolation.test.js:14, 33-34, 156-164`
**Issue:** El walker de imports (`walkImports`) solo sigue imports **estáticos**;
el comentario (líneas 13-14 y 33-34) afirma "No cubre `import()` dinámico — el
repo no lo usa (verificado en 06-RESEARCH A3)". Esa premisa es hoy **falsa**:
`src/providers/registry.js` (que SÍ está en el grafo estático de `check.js` y se
invoca en runtime desde `runCheck` vía `initRegistry`) hace
`await import('../config.js')` y `await import('./plane|github/provider.js')`;
`src/session/state.js:247` hace `await import('../logger-events.js')`; y hay
`await import('../logger.js')` real en dispatcher/server/hooks. Aunque hoy la
invariante se sostiene (los providers solo cargan `logger-events.js`, puro), el
guard NO protege contra una regresión: si un módulo del grafo de check
(`config.js`, `manager.js`, `state.js`, `client.js`) añadiera un
`await import('../logger.js')` en runtime, el test seguiría verde y LOG-12 se
rompería en silencio. Justo esta fase amplía el grafo con `sidebar-doctor.js`,
cuyos deps (`manager.js`, `client.js`, `config.js`) son exactamente ese tipo de
módulo.

**Fix:** Actualizar el comentario para no afirmar una premisa falsa y, mejor,
reforzar el guard con un chequeo de source-grep sobre los módulos del grafo del
vigilante buscando `import('.*logger\.js')` dinámico (excluyendo `logger-events`
/`logger-noop`), de modo que una regresión por import dinámico también rompa el test.

## Info

### IN-01: Doble `scan` por pase motivado; el conteo de advisories proviene de otro snapshot que las acciones ejecutadas

**File:** `src/check.js:156-158`, `src/cmux/sidebar-doctor.js:367`
**Issue:** El piggyback llama `scanFn(deps)` (scan #1) para leer `hasAdvisories`
/`missing_group`, y luego `executeFn(deps, { fix: true })`, que internamente
**vuelve a llamar `scan(deps)`** (scan #2, re-detección TOCTOU D-06). Por tanto
`scan` corre dos veces por pase motivado. El conteo de advisories que se loguea
sale del scan #1, mientras que las acciones aplicadas salen del scan #2: en un
sidebar con carreras, ambos pueden divergir (el log dice "1 advisory" pero
execute ya vio 0, o viceversa). Es solo informativo (los advisories no se
ejecutan), pero es trabajo redundante y una posible inconsistencia de reporte.

**Fix:** Considerar que `execute()` devuelva el `report` que usó (scan #2) y que
el piggyback derive de ahí tanto las acciones como los advisories, eliminando
scan #1 y la divergencia. (Nota: la eficiencia de la doble llamada cmux queda
fuera del alcance v1; aquí interesa la coherencia del reporte.)

---

_Reviewed: 2026-07-23_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
