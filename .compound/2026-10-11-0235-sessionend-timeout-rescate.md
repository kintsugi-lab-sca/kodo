---
fecha: 2026-10-11
proyecto: kodo
slug: sessionend-timeout-rescate
---

## Resumen
Las filas huérfanas tras /exit no venían de un session_id reescrito: Claude Code cancela a 1.5 s un hook SessionEnd sin `timeout`, y reconcile rescataba de history lo que sí se retiraba.
Fix: `timeout: 30` en el instalador (aplicado al settings real) y `ended_by` en history para que el rescate salte los cierres deliberados; verificado con sonda en Claude Code y repro en HOME aislado.

## Reto
La evidencia de la tarea apuntaba al sitio equivocado (los ids «nuevos» eran el `claude -p` del hook compound); hizo falta cruzar los logs por sesión, los transcripts y el binario de Claude Code para encontrar las dos causas reales.

## Propuesta de skill
Una skill `hook-forensics` que, dado un session_id de kodo, cruce su log por sesión, hooks.ndjson, ticks de reconcile y el transcript para mostrar en qué paso murió o se deshizo un cierre.
