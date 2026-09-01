---
fecha: 2026-09-01
proyecto: kodo
slug: reciclado-orquestador
---

## Resumen
Implementado KODO-67: handoff persistido en `~/.kodo/handoff.md` que se inyecta al final del prompt del orquestador entrante y se consume por rename, más un aviso `recycle-suggested` que dispara el hook Stop al cruzar `orchestrator.recycle_mb` sobre el tamaño del transcript.
Suite completa en verde (4011 pass / 0 fail) con 64 tests nuevos; la tarea quedó en Review con el commit local `4b82822a`, sin push.

## Reto
El enunciado pedía inyectar el handoff dentro de `resolvePromptTemplate`, pero esa función es pura por contrato documentado en el propio fichero — es literalmente la razón por la que `applyReportingGate` existe aparte. Meterle I/O habría roto esa separación para satisfacer la letra de un criterio que en realidad mide el prompt observable, no dónde vive la llamada. Se movió la inyección a la composición del prompt en `launchOrchestrator` y la desviación se declaró por escrito en el plan, en el commit y en Plane, en vez de aplicarla en silencio.

## Propuesta de skill
Una skill `declare-deviation`: cuando el enunciado de una tarea especifica un punto de implementación concreto que choca con un invariante documentado del código, que genere el bloque de desviación (qué pedía, por qué no, qué se hizo en su lugar, qué observable sigue cubierto) y lo replique en los tres sitios donde el revisor lo va a buscar — plan, mensaje de commit y comentario de cierre — para que la divergencia nunca dependa de que alguien lea el diff.
