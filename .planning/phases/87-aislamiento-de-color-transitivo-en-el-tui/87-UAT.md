---
status: testing
phase: 87-aislamiento-de-color-transitivo-en-el-tui
source: [87-VERIFICATION.md]
started: 2026-08-10T00:00:00Z
updated: 2026-08-10T00:00:00Z
---

## Current Test

number: 1
name: Ratificar el radio ampliado de ISO-01 (32 → 42 ficheros en la unión de clausuras del TUI)
expected: |
  El dueño de la fase confirma por escrito (comentario de commit, entrada en STATE.md o
  equivalente) que acepta que un futuro import de `picocolors` en cualquiera de esos 10
  ficheros ponga ISO-01 en rojo, aunque el cambio se haya hecho pensando solo en el carril
  CLI/proveedores y no en el TUI.
awaiting: user response

## Tests

### 1. Ratificar el radio ampliado de ISO-01

expected: El dueño de la fase acepta (o rechaza) que la invariante color-isolation se extienda a `src/providers/*`, `src/host/interface.js`, `src/interface.js` y `src/labels.js`.
result: [pending]

**Origen:** la corrección WR-02 del code review eligió **ensanchar el guard** en vez de narrar su declaración. La unión de clausuras que ISO-01 vigila pasa de **32 a 42 ficheros** al sembrarla con las aristas `import()` de specifier literal que salen de `src/cli/dashboard/`.

**Estado hoy:** los 10 ficheros nuevos están limpios — ninguno alcanza `picocolors`, el guard pasa verde. No hay violación viva.

**Lo que se decide:** si un futuro `import` de `picocolors` en `src/providers/plane/client.js` (por ejemplo, para colorear un error del cliente) debe poner ISO-01 en rojo. Con el radio ampliado, sí.

**Las dos opciones, ambas legítimas:**

- **Ratificar (mantener el ensanche).** La invariante se vuelve más fuerte y cubre el camino real de carga del TUI, que incluye esas aristas dinámicas. Coste: un cambio pensado solo para el carril CLI puede poner roja una fase ajena, y quien lo lea tendrá que entender por qué el TUI le concierne.
- **Revertir a la opción conservadora.** Se deja el guard en las 32 clausuras estáticas y se **narra la declaración** para que deje de afirmar cobertura sobre aristas dinámicas salientes que no lee. No es una violación de DEBT-04: una declaración que exagera su cobertura es exactamente el pecado que ISO-04 existe para corregir. Coste: el punto ciego sigue ahí, declarado.

**Cómo ratificar:** responder en la sesión, o dejar constancia en `STATE.md` §Accumulated Context. Si se prefiere revertir, el commit a deshacer es `8d1f6be` (`fix(87): WR-02 siembra la union del TUI con las aristas import() literales`) y hay que sustituirlo por el ajuste del texto de la cabecera.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
