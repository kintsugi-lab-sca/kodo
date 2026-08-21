---
fecha: 2026-08-10
proyecto: kodo
slug: kodo16-orchestrator-persistence
---

## Resumen
Resuelto KODO-16: daemon restart orphanizaba orquestador vivo y lanzaba duplicado. Implementada persistencia de identidad en disk + revalidación en startup; daemon ahora reutiliza orquestador registrado sin spawnar duplicados. Fix mergedo a main con suite pasando.

## Reto
Race condition distribuida: daemon reiniciado no tenía forma de saber si un orquestador ya estaba activo; lanzaba uno nuevo. Requería coordinar estado entre procesos efímeros (daemon) y sesiones persistentes sin cambiar el modelo de ejecución.

## Propuesta de skill
`orchestrator-persistence-recovery` — utilidad reutilizable para servicios sin estado que necesitan retomar rol/identidad tras restarts: persistir marcador en disk en startup, validar liveness antes de reasignarse identidad, fallback a crear nuevo si el holder está muerto.
