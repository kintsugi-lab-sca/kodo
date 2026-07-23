---
phase: 79-sidebar-doctor
reviewed: 2026-07-23T08:31:29Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/cli.js
  - src/cli/sidebar-doctor.js
  - src/cmux/client.js
  - src/cmux/sidebar-doctor.js
  - src/logger-events.js
  - test/cli/sidebar-doctor-cli.test.js
  - test/cmux/sidebar-doctor.test.js
  - test/logger-events.test.js
  - test/sidebar-doctor-hygiene.test.js
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 79: Code Review Report

**Reviewed:** 2026-07-23T08:31:29Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Se revisó el carril completo `kodo sidebar doctor` (Phase 79): el wiring CLI
(`cli.js`), el handler de render/exit-code (`src/cli/sidebar-doctor.js`), el
motor puro `scan`/`execute` (`src/cmux/sidebar-doctor.js`), los 4 passthroughs
del allowlist no-destructivo en `src/cmux/client.js`, y los 3 nuevos eventos de
taxonomía en `src/logger-events.js`, más sus tests.

Veredicto general: la implementación es sólida y disciplinada. Las restricciones
LOCKED se respetan de forma verificable — el allowlist es exactamente
`create/add/set-anchor/ungroup`, `workspace-group delete/remove/rename` NI se
cablea (guard mecánico `test/sidebar-doctor-hygiene.test.js`), los refs viajan
como elementos de array a `execFile` sin shell (cero superficie de inyección), el
motor es 0-provider/0-token (guard de imports), never-throws con fail-open
per-item y re-detección TOCTOU en `execute`. El launch path queda byte-idéntico
(guard SDR-04). La taxonomía de eventos crece 31 → 34 de forma consistente
(whitelist explícito field-by-field, sin `...fields` spread).

El único defecto de correctitud real es un conflicto de acciones contradictorias
en `execute` cuando un grupo esta transitoriamente vacío pero sigue siendo el
grupo esperado de una sesión viva (WR-01). El resto son notas de robustez/diseño.

No se detectaron vulnerabilidades de seguridad ni riesgos de pérdida de datos.

## Warnings

### WR-01: `execute` emite `add` y luego `ungroup` sobre el MISMO grupo (acciones contradictorias)

**File:** `src/cmux/sidebar-doctor.js:270-288, 392-410`
**Issue:**
`scan` clasifica de forma independiente `loose_workspace` (por
`member_workspace_refs` / `member_count > 0` implícito) y `empty_group` (por
`member_count === 0`). Ambas categorías pueden apuntar al MISMO ref de grupo en un
único report:

Escenario reachable (confirmado contra `resolveWorkspaceGroup`, manager.js:189 —
casa por nombre normalizado): un grupo `workspace_group:N` con `member_count: 0`
cuyo nombre normaliza al `expected` de una sesión viva. Ese grupo:
- resuelve por nombre → la sesión viva no es miembro → entra en
  `loose_workspace` como `{ group: 'workspace_group:N', ... }` (líneas 271-278), y
- tiene `member_count === 0` → entra en `empty_group` como `{ ref: 'workspace_group:N' }`
  (líneas 286-288).

En `execute`, con el orden D-09 (loose antes que empty) sobre un ÚNICO report:
1. `addToWorkspaceGroup({ group: 'workspace_group:N', workspace })` → `result.added++`
2. `ungroupWorkspaceGroup({ group: 'workspace_group:N' })` → `result.ungrouped++`

Se añade el workspace al grupo e inmediatamente se disuelve ese grupo. El single
`--fix` NO converge (el workspace queda suelto de nuevo), y el report emitido
miente: `added: 1, ungrouped: 1` sugiere convergencia cuando el neto es nulo. Es
no-destructivo (ungroup preserva los workspaces) y auto-sana en una 2ª pasada
(la sesión sin grupo cae en `missing_group` → `create`), pero un `--fix` con
contadores contradictorios y un no-op efectivo es un defecto de correctitud. El
propio código reconoce que `member_count 0` es un estado transitorio raro
(Pitfall 5), que es justo la ventana donde esto ocurre.

**Fix:** Excluir de `empty_group` los grupos que también son destino de un `add`
en el mismo report. Por ejemplo, computar el set de refs referidos por
`loose_workspace` y filtrarlos del `empty_group`:

```js
const looseGroupRefs = new Set(loose_workspace.map((l) => l.group));
const empty_group = (groupsJson.groups || [])
  .filter((g) => g && typeof g.ref === 'string'
    && g.member_count === 0
    && !looseGroupRefs.has(g.ref)) // no disolver un grupo al que vamos a añadir
  .map((g) => ({ ref: g.ref, name: typeof g.name === 'string' ? g.name : '' }));
```

Alternativamente, en `execute`, saltar el `ungroup` de cualquier `eg.ref` que
aparezca como `l.group` en `report.loose_workspace`.

## Info

### IN-01: grupo creado pero no contabilizado cuando el re-list no resuelve el ref

**File:** `src/cmux/sidebar-doctor.js:359-371`
**Issue:** En el carril `missing_group`, si `createWorkspaceGroup` tiene éxito
pero el re-list posterior no resuelve el ref (`ref no resuelto tras create`), se
hace `pushError(... 'missing_group' ...)` y `continue` SIN incrementar
`result.created`. El grupo quedó creado en cmux pero no se cuenta ni se le añaden
miembros. Auto-sana en la siguiente pasada (el grupo ya existente hace que los
miembros caigan en `loose_workspace`), pero el report de esta pasada subreporta
lo realmente mutado. Es un trade-off aceptable dado el diseño idempotente;
documentarlo o contabilizar el create parcial mejoraría la fidelidad del report.
**Fix:** Considerar `result.created++` antes del `continue`, o registrar el ref
huérfano en un campo aparte para que el consumidor de `--json` lo perciba.

### IN-02: exit code 1 tras un `--fix` que convergió con éxito

**File:** `src/cli/sidebar-doctor.js:74, 91`
**Issue:** El exit code se deriva de `report.hasActions` del scan PRE-fix, tanto
en dry-run como en `--fix`. Un `kodo sidebar doctor --fix` que sanea toda la
deriva devuelve `1`, indistinguible de "quedó deriva sin arreglar". Es un espejo
consciente de `gsd doctor` (documentado en la cabecera del handler), pero es un
footgun para automatización que espere `0` en éxito. No es un bug —comportamiento
especificado— pero conviene que el consumidor lo sepa.
**Fix:** Ninguno requerido si se mantiene la paridad con `gsd doctor`. Si se
quiere distinguir, exponer un exit code derivado de `result.errors.length` bajo
`--fix`, o documentar la semántica en `--help`.

### IN-03: `renderHuman` asume `report.protected.sessions` presente

**File:** `src/cli/sidebar-doctor.js:135`
**Issue:** `renderHuman` accede a `report.protected.sessions.length` sin guarda.
El `scan` real siempre construye `protected: { sessions: [...] }`, así que en
producción es seguro; pero un `scanFn` inyectado que omita `protected` (o un
report deserializado parcialmente) haría throw en el render. Robustez defensiva
menor, coherente con el resto del módulo que sí es never-throws.
**Fix:** Guardar el acceso: `report.protected?.sessions?.length ?? 0`.

---

_Reviewed: 2026-07-23T08:31:29Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
