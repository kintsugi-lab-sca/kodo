---
fecha: 2026-11-09
proyecto: kodo
slug: orquestador-socket-closed
---

## Resumen
El lanzamiento del orquestador fallaba porque tecleaba unos 20 KB por `cmux send`, que falla de forma intermitente a partir de 4 KB (3,5 KB 0/30; 4 KB 16/30).
Ahora el prompt va por `writePromptFile` + `"$(cat path)"` (156 bytes tecleados): 30/30 envíos correctos contra cmux real y suite en verde (4775 pass, 0 fail).

## Reto
Queda sin probar el relanzamiento real de `kodo orchestrate`, y `kodo review` sigue tecleando su prompt (plantilla de 4,9 KB), así que está expuesto al mismo fallo.

## Propuesta de skill
`cmux-diagnostics` ya existe para la salud de cmux; le falta una comprobación que mida la tasa de fallo de `cmux send` por tamaño de payload en un workspace temporal.
