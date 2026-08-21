---
fecha: 2026-06-25
proyecto: kodo
slug: phase62-stdin-title-fix
---

## Resumen
Corregidas dos causas raíz en Phase 62: cierre de stdin en subproceso `claude` para evitar timeout intermitente de 3s, y derivación de título movida a nivel de tarea (en lugar de scope de proyecto) para que GSD sessions prioricen el intent del usuario. Ambas correcciones probadas en UAT con dos sesiones reales (liken, scp-cmri) mostrando títulos correctos sin fallback a "LIKEN".

## Reto
El timeout intermitente de stdin ocurría porque `child.stdin.end()` no se invocaba, causando que el subproceso esperara 3s por datos; bajo latencia API de Claude esto disparaba fallback a `surface.title`. Simultáneamente, el flujo de derivación de proyecto-scope rechazaba el primer prompt del transcript para GSD, perdiendo la señal de intent del usuario.

## Propuesta de skill
Un diagnosticador de stdin/timeout que trace la secuencia de spawn → stdin.end() → API latency vs timeout threshold; podría acelerar futuros ciclos de debug en procesos subshell que invoquen APIs externas con stdin heredado.
