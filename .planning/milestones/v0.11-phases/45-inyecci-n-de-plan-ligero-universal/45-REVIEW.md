---
phase: 45-inyecci-n-de-plan-ligero-universal
reviewed: 2026-06-10T08:17:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/hooks/session-start.js
  - test/session-start.test.js
  - test/gsd-context.test.js
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 45: Code Review Report

**Reviewed:** 2026-06-10T08:17:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Se revisó la inyección del plan ligero universal (PLAN-03): los dos bloques de
instrucción añadidos a `buildSessionContext` (ES) y a la rama `mode === 'quick'`
de `buildGsdContext` (EN), los nuevos imports `join`/`KODO_DIR`, y los casos de
test nuevos en `session-start.test.js` y `gsd-context.test.js`.

Verificaciones realizadas:

- **Golden-bytes (D-04 / HOOK-02):** confirmado. El append ES va al final del
  array tras el bloque "Anti-push-fantasma", y el append EN va DENTRO del `if
  quick` antes del bloque común "## No automatic push" (que vive fuera del
  if/else). Las ramas phase y bootstrap quedan byte-idénticas; los tests de
  invariancia (`gsd-context.test.js:229-237`, `:162-172`) y exclusión
  (`:219-227`) lo blindan. Ejecuté la suite: 58/58 pass.
- **Sin I/O:** confirmado. El hook solo emite el string del path resuelto; la
  función sigue siendo pura (D-03). Ninguna llamada a `fs` se introdujo.
- **Calidad de tests:** los tests calculan el path esperado con
  `join(KODO_DIR, 'plans', '<id>.md')` reales (no HOME hardcodeado), verifican
  ausencia del literal `<task_id>`, y cubren exclusión de las ramas phase y
  bootstrap. Buena cobertura.

Las observaciones abajo son de robustez y mantenibilidad, no de corrección
demostrable. No hay BLOCKERs.

## Warnings

### WR-01: `session.task_id` interpolado sin guard puede producir `undefined.md`

**File:** `src/hooks/session-start.js:85` y `src/hooks/session-start.js:145`
**Issue:** Ambos bloques interpolan `session.task_id` directamente en el path
sin validar que sea un string no vacío:
```js
`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}`
```
Si `task_id` fuese `undefined`/`null`/`''`, el path emitido sería
`.../plans/undefined.md` (o `.../plans/.md`) y la sesión escribiría un fichero
basura colisionante que machacaría planes de otras sesiones malformadas. En el
camino de producción actual `task.id` siempre se asigna desde el provider en el
dispatcher (`src/triggers/dispatcher.js:147`), por lo que no hay path alcanzable
probado con `task_id` undefined — por eso es WARNING y no BLOCKER. Pero ambas
son funciones **exportadas y puras** que leen su input desde `state.json` (datos
potencialmente legacy o corruptos tras migraciones v2→v3), y el resto del cuerpo
ya tolera campos ausentes sin crashear. La interpolación silenciosa de un valor
inválido en una ruta de fichero es exactamente el tipo de fallo que no se nota
hasta que un plan se sobrescribe mal.

Nótese que el resto del contexto también interpola `task_id` (líneas 39, 109),
pero ahí su ausencia solo degrada texto informativo; aquí degrada una **ruta de
escritura de fichero**, lo que eleva la consecuencia.

**Fix:** Guard explícito antes de emitir la instrucción, omitiéndola si el id no
es válido (preserva golden-bytes: si no hay id, no se añade nada):
```js
// ES — buildSessionContext
const planLines = session.task_id
  ? ['', `Además, al empezar escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\` (sobrescribe si ya existe).`]
  : [];
// ...spread planLines al final del array
```
Mismo patrón para la rama quick en EN. Alternativamente, validar en el llamador
(`main`) y salir temprano, pero el guard local mantiene la función auto-contenida.

### WR-02: Duplicación de la construcción del path del plan entre ES y EN

**File:** `src/hooks/session-start.js:85` y `src/hooks/session-start.js:145`
**Issue:** La expresión `join(KODO_DIR, 'plans', `${session.task_id}.md`)` está
duplicada verbatim en dos funciones. Si el directorio (`plans`), el esquema de
nombre (`${task_id}.md`) o la lógica de validación (ver WR-01) cambian, hay que
editar dos sitios y mantenerlos en sync — y los tests también duplican el
cálculo en cuatro lugares (`session-start.test.js:107`, `gsd-context.test.js:214`).
Es una micro-violación de DRY del mismo tipo que el propio codebase blinda con
guards anti-inline en otros sitios (p. ej. `getSessionMode`, ver
`session-start.test.js:385-414`).

**Fix:** Extraer un helper puro, idealmente en `src/config.js` junto a
`KODO_DIR` (donde los tests ya importan):
```js
// src/config.js
export function planPath(taskId) {
  return join(KODO_DIR, 'plans', `${taskId}.md`);
}
```
Y usarlo en ambas funciones y en los tests. Centraliza también el fix de WR-01
(la validación viviría en un solo lugar).

## Info

### IN-01: Import de `KODO_DIR` en línea separada del import de `loadConfig`

**File:** `src/hooks/session-start.js:11-12`
**Issue:** `loadConfig` y `KODO_DIR` provienen del mismo módulo `../config.js`
pero se importan en dos sentencias separadas:
```js
import { loadConfig } from '../config.js';
import { KODO_DIR } from '../config.js';
```
Funcionalmente correcto, pero dos imports del mismo specifier es ruido evitable
y rompe el estilo del resto del fichero (imports agrupados por módulo).

**Fix:**
```js
import { loadConfig, KODO_DIR } from '../config.js';
```

### IN-02: Comentarios de decisión muy densos sobre las líneas de instrucción

**File:** `src/hooks/session-start.js:81-84` y `:140-143`
**Issue:** Cada instrucción de una línea lleva 3-4 líneas de comentario
referenciando decisiones (D-03 a D-08, HOOK-02). Es trazabilidad valiosa pero
densa; si las decisiones se renumeran o archivan, estos comentarios quedan como
referencias colgantes sin contexto en el código. No es un defecto — solo un
riesgo de mantenibilidad a futuro. Sin acción requerida; considerar enlazar al
doc de fase en vez de enumerar IDs inline si el patrón prolifera.

**Fix:** (opcional) condensar a una línea con referencia a la fase, p. ej.
`// Phase 45 PLAN-03: append-al-final preserva golden bytes; sin I/O.`

---

_Reviewed: 2026-06-10T08:17:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
