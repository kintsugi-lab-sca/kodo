---
fecha: 2026-09-02
proyecto: kodo
slug: spike-swarm-forge
---

## Resumen
Se revisó `unclebob/swarm-forge` entero (main + 5 ramas de packs, ~8.6k líneas de Babashka/tmux) contrastando cada concepto de orquestación contra la arquitectura de kodo y contra KODO-69.
Resultado: informe en `.planning/research/swarm-forge-review.md` con 5 ideas aprovechables, 11 descartadas con razón y 3 convergencias independientes que confirman decisiones ya tomadas en kodo.

## Reto
Separar lo genuinamente nuevo de lo que kodo ya tiene bajo otro nombre. La mitad de los "hallazgos" iniciales resultaron duplicados exactos (el wake-up lossy + cola durable es KODO-53; `pending_approval/` es la cola de integración), y la pieza más vendida del repo —el platoon— es un brainstorm de 402 líneas sin implementar. Lo que costó fue la disciplina de descartar también las propias ideas al verificarlas contra el código (el merge idempotente ya estaba razonado y rechazado a propósito en `capture.js:89`).

## Propuesta de skill
Una skill `contrast-external-repo`: clona un repo ajeno en scratchpad, extrae sus primitivas por categoría (dispatch / verificación / estado / recuperación) y **antes de emitir veredicto** obliga a un grep contra el repo propio buscando el equivalente, de modo que "esto ya existe aquí" sea el default y "esto es nuevo" tenga que demostrarse. Evitaría la primera pasada de falsos hallazgos.
