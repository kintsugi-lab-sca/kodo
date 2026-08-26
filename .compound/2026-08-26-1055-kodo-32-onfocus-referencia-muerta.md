---
fecha: 2026-08-26
proyecto: kodo
slug: kodo-32-onfocus-referencia-muerta
---

## Resumen
Arreglado el crash del TUI al pulsar `Enter` o `shift+O`: la prop `onFocus` de `src/cli/dashboard/index.js` leía `cmuxBin`, variable que KODO-18 había renombrado a `hostBin` sin actualizar ese call site.
En vez de renombrar, `onFocus` pasa a delegar en `host.selectWorkspace(ref)` — el verbo del contrato `WorkspaceHost` — lo que cierra de paso el bug latente de mandar el verbo de cmux al binario de orca.

## Reto
Una referencia libre no declarada en ESM no falla al importar el módulo: se resuelve contra el global en runtime. El bug vivió en `main` con 3095 tests verdes porque el único camino que lo ejecutaba exigía TTY real y una pulsación de tecla. El repo no tiene linter — un `no-undef` lo habría cazado en el commit que lo introdujo, y esa decisión sigue abierta.

## Propuesta de skill
Skill `wiring-guard`: tras un rename de variable, hacer grep del nombre viejo en todo el repo Y verificar que los call sites del símbolo renombrado están cubiertos por algún test que los EJECUTE (no solo que los importe); si no lo están, generar el guard source-assertion del cableado, como el que este arreglo añadió en `test/dashboard/focus-wiring.test.js`.
