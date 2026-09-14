---
fecha: 2026-09-01
proyecto: kodo
slug: kodo67-orchestrator-recycling
---

## Resumen
Se diseñó e inició la implementación de KODO-67 (orquestador reciclable) con persisted handoff (`~/.kodo/handoff.md`) para reciclar sesiones largas, capturando estado esencial (decisions, hot refs, lessons) antes de relaunch. Se documentó también una lección de context economy: usar REST API en lugar de MCP para cambios de estado en Plane, ahorrando 3–8k tokens por update.

## Reto
Orquestadores de larga duración (4+ días) acumulan histórico innecesario y alcanzan 72% del presupuesto de tokens (683k en la sesión actual). El mecanismo de handoff recicla limpiamente sin pérdida de estado operativo, pero la integración requiere validar que el relaunch con handoff inyectado resume trabajo sin re-preguntas.

## Propuesta de skill
La skill `kodo-orchestrate` ya documenta el formato de handoff. Propuesta: crear `kodo-orchestrate:recycling-checklist` que automatice detección de cuándo reciclar, preparación del handoff comprobado, inyección correcta en prompt, y validación post-relaunch del state recovery.
