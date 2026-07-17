---
phase: 75-superficie-del-next-dashboard-y-nudge
reviewed: 2026-07-17T11:01:22Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/format.js
  - src/cli/dashboard/markdown.js
  - src/cli/dashboard/plan.js
  - src/cli/dashboard/select.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/tasks.js
  - src/hooks/session-end.js
  - src/hooks/stop.js
  - src/session/handoff.js
  - src/session/state.js
findings:
  critical: 0
  warning: 4
  info: 0
  total: 4
status: issues_found
---

# Phase 75: Informe de Code Review

**Revisado:** 2026-07-17T11:01:22Z
**Profundidad:** standard
**Ficheros revisados:** 11 (solo fuente; los 11 ficheros de test se leyeron como contexto pero no se auditan salvo por fiabilidad)
**Estado:** issues_found

## Resumen

Phase 75 añade la columna `NEXT:` al dashboard TUI (LIVE-05), el mini-renderer markdown del overlay de plan ligero con strip del marcador `kodo:handoff` (LIVE-06) y el threading del `NEXT:` persistido hacia el nudge del orquestador (LIVE-07). El diff es quirúrgico (~326 líneas netas) y respeta las invariantes de fase que verifiqué directamente:

- **TUI never-throws:** `readTasks`, `renderMarkdownLines`, `stripHandoffMarker`, `nextCell` y `deriveAnyNext` protegen todos sus inputs (coerción `String(s)`, guards `typeof`, `Array.isArray`). ✓
- **Reader nunca escribe state.json / cero `loadState` en el poll:** `tasks.js` importa solo builtins y usa `readFileSync` directo; el enrich de `App.js` no llama a `loadState`. ✓
- **D-02 LOCKED (rama GSD byte-idéntica):** la rama `render !== 'markdown'` de `renderOverlay` conserva verbatim el `map` de `<Text>` previo; `plan.js` marca GSD con `render:'plain'`. ✓
- **Cero endpoints nuevos / cero deps npm:** `src/server.js` y `package.json` intactos en el rango del diff. ✓
- **stripControlChars sobre contenido LLM antes de render:** el `next` se sanea en el enrich (`App.js:753`) y cada línea del markdown pasa por `stripControlChars` (`markdown.js:57`). ✓
- **buildStopNudgeText sigue puro / NEXT nunca logueado:** la función solo compone strings; `upsertTaskHandoff` loguea únicamente `{task_id}`. ✓
- **Color-isolation:** el test `format-isolation` solo prohíbe imports DIRECTOS de `picocolors`; `markdown.js` importa `stripControlChars` de `../format.js` igual que `App.js` ya lo hacía — patrón preexistente aceptado. ✓

Suite en verde (113 tests de los ficheros de la fase). Los defectos encontrados son de robustez defensiva y consistencia, ninguno bloqueante.

## Warnings

### WR-01: El `NEXT:` (contenido LLM) llega a `cmux.send` SIN `stripControlChars` en el nudge del orquestador

**Fichero:** `src/hooks/session-end.js:258` (vía `src/hooks/stop.js:69-71`)
**Issue:** El carril de RENDER del dashboard sanea el `next` con `stripControlChars` antes de proyectarlo (`App.js:753`), pero el carril del NUDGE no lo hace. `handoffNext` sale de `state.tasks[...].next` (contenido escrito por el LLM de la sesión, o derivado del plan) y se interpola tal cual en `buildStopNudgeText`, cuyo resultado se inyecta en la surface cmux del orquestador vía `cmuxClient.send({ text })`. Un `NEXT:` con secuencias de escape de terminal (p. ej. OSC-52 = escritura al portapapeles, o CSI de reposicionamiento) queda inerte en el dashboard pero se emite crudo hacia el terminal del orquestador. `extractNext` solo hace `trim()` + `slice(200)`; no neutraliza bytes de control.

Es cierto que la MISMA cadena ya interpola `session.summary`/`session.task_ref` sin sanear (limitación documentada en `App.js:745`), por lo que el vector de inyección preexiste y el riesgo incremental es acotado — de ahí WARNING y no BLOCKER. Pero Phase 75 añade DELIBERADAMENTE un campo LLM más (`next`) a ese sink justo cuando el carril de render sí lo blinda, dejando la asimetría a la vista.

**Fix:** Sanear el `next` en el punto de threading, reutilizando el helper que ya se importa en el dashboard. En `session-end.js`, antes de construir el nudge:
```js
// stripControlChars vive en src/cli/format.js (puro, sin color) — mismo saneo que el render.
import { stripControlChars } from '../cli/format.js';
// ...
const safeNext = handoffNext ? stripControlChars(handoffNext) : handoffNext;
await cmuxClient.send({ workspace: orchMatch[1], text: buildStopNudgeText(session, safeNext) });
```
(Idealmente `summary`/`task_ref` recibirían el mismo tratamiento en la base, cerrando la limitación documentada de una vez.)

### WR-02: `readTasksFn({})` se ejecuta en CADA render, no "una vez por tick" como afirma el comentario

**Fichero:** `src/cli/dashboard/App.js:735-739`
**Issue:** El comentario dice «lee el bloque `tasks` … UNA vez por tick, piggyback sobre el tick de usePoll». En realidad `const tasks = readTasksFn({})` vive en el cuerpo del componente, que React re-ejecuta en CADA render — no solo en los ticks de `usePoll`. Cada pulsación de tecla en modo filtro, cada scroll de overlay y cada cambio de `mode` dispara una lectura síncrona (`readFileSync`) de `state.json` en el hilo del event loop. El comentario describe mal el comportamiento real y la lectura bloqueante se repite en el camino de teclado.

El patrón es consistente con el enrich de progreso preexistente (`readGsdProgress` + `existsSync` por fila, también por render), así que no es una regresión nueva y `readTasks` es never-throws; por eso es WARNING. Pero la afirmación «una vez por tick» es incorrecta y puede inducir a error en mantenimiento futuro.

**Fix:** O bien corregir el comentario para reflejar «una lectura síncrona por render» (mínimo), o memoizar la lectura al tick real de poll — p. ej. mover `tasks` a estado refrescado desde `onResult` (`usePoll`), en paralelo al `lastAttemptAt`, para que la lectura de disco se ligue al tick y no al teclado. La opción mínima es corregir la redacción; la robusta es ligar la lectura al `onResult`.

### WR-03: `nextCell`/enrich no colapsan saltos de línea; `stripControlChars` preserva `\n`, y `truncate:true` no garantiza una sola fila

**Fichero:** `src/cli/dashboard/format.js:258-260` (`nextCell`) y `src/cli/dashboard/App.js:753` (enrich)
**Issue:** `stripControlChars` preserva deliberadamente `\t` y `\n` (`src/cli/format.js:86`). El pipeline real garantiza un `next` de una sola línea (`extractNext` lo obtiene de un `split('\n')`), pero `state.json` es editable por el operador (paridad reconocida con `state.js`): un `"next": "linea1\nlinea2"` hand-editado o corrupto sobrevive al saneo con su `\n` intacto. Al pintarse en un `Box width:40` con `wrap:'truncate-end'`, un `\n` fuerza salto de línea y descuadra la fila de la tabla — `truncate:true` acota el ANCHO, no las líneas. El picker de adopt SÍ colapsa whitespace (`truncateEllipsis`, `SessionTable.js:274` usa `.replace(/\s+/g, ' ')`), pero la celda `next` no tiene equivalente.

Baja severidad (no crashea, no es alcanzable por el pipeline normal, solo por state.json corrupto/hand-editado), pero es una brecha defensiva real dado que `next` proviene de un fichero local mutable.

**Fix:** Colapsar whitespace al derivar la celda, espejo de `truncateEllipsis`:
```js
export function nextCell(session) {
  return typeof session.next === 'string' && session.next.length > 0
    ? session.next.replace(/\s+/g, ' ').trim()
    : '';
}
```
(o colapsar en el enrich de `App.js` justo tras `stripControlChars`).

### WR-04: Drift de documentación — el typedef del prop `overlaySnapshot` en `SessionTable` no incluye `render`

**Fichero:** `src/cli/dashboard/SessionTable.js:817`
**Issue:** El JSDoc de `renderOverlay` (`:176`) sí se actualizó a `{ …, render?: 'markdown'|'plain' }`, pero el typedef del prop `props.overlaySnapshot` de `SessionTable` (`:817`) sigue como `{ kind, taskRef, status, lines }` sin `render`, pese a que `App.js:1841` ahora threadea `render: res.render` en el snapshot y `renderOverlay` ramifica por ese campo. Es solo documentación (no afecta runtime), pero deja el contrato del componente incompleto y contradictorio con su propio helper.

**Fix:** Añadir `render?: 'markdown'|'plain'` al typedef del prop `overlaySnapshot` en la firma de `SessionTable`, igualándolo al de `renderOverlay`.

---

_Revisado: 2026-07-17T11:01:22Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Profundidad: standard_
