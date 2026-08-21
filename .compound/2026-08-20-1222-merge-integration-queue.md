---
fecha: 2026-08-20
proyecto: kodo
slug: merge-integration-queue
---

## Resumen
Mergeadas dos features completadas (KODO-24: sincronización de lock race en tests; KODO-18: Orca como host elegible) resolviendo conflictos en 7 archivos y ajustando imports post-merge. Diseñado sistema de cola de integración para evitar pérdida de tracking entre sesiones concurrentes durante merges de branches.

## Reto
Múltiples sesiones concurrentes genera pérdida de visibilidad sobre qué branches están en "In review" y necesitan merge; sin coordinación central, dos sesiones pueden mergearse al mismo tiempo o dejar branches olvidadas en estado transitorio.

## Propuesta de skill
Automatizar la detección de branches stale (+89 commits desde main) y proponer merge-first como patrón preemptivo en sesiones que comienzan con código divergente.
