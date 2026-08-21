---
fecha: 2026-08-10
proyecto: kodo
slug: daemon-zombie-orphan-bugs
---

## Resumen
Mergeados KODO-11, KODO-12, KODO-14 (orphan sweep + orchestrator model + sidebar doctor) a main; identificados dos bugs críticos en gestión de estado: KODO-15 (sesiones zombi cuando proceso muere pero tab vive) y KODO-16 (daemon restart pierden referencia al orquestador vivo, lanzando duplicado).

## Reto
Estado concurrente entre daemon, sesiones y orquestador: session.alive se deriva solo de tab liveness (ignorando process_alive), y orchestrator workspace identity vive solo en memoria del daemon, no en disk — causando que `kodo check` post-restart lance orquestador duplicado.

## Propuesta de skill
Skill de reconciliación daemon-aware que (1) persista orchestrator workspace ref a state.json y valide liveness en startup, (2) modifique applyLiveFields para que process_alive=false trigger dead state incluso con tab viva.
