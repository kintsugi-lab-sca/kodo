---
fecha: 2026-11-09
proyecto: kodo
slug: lecciones-orquestador
---

## Resumen
Documentadas 9 lecciones operacionales del orquestador derivadas de incidentes reales (cmux restarts, claude-mem-lite updates, kodo launch edge cases, SendMessage retenidos). Volcadas a la skill de kodo-orchestrate como fuente canónica para el siguiente ciclo de sesiones.

## Reto
El orquestador acumula learnings dispersos durante rondas y recycles. Sin un ritual de captura inmediato (post-issue), se pierden en el transcript o se olvidan. La skill es el único almacén durable, pero requiere disciplina explícita para escribir dentro de ella tras cada descubrimiento.

## Propuesta de skill
Skill `/kodo-capture-lesson` que permita al orquestador teclear una lección en la ronda (`/kodo-capture-lesson <tema>`) y automáticamente la reformule con contexto de `state.json` (fecha, repos activos, estado) e inyecte directamente en la skill, sin escribir compound aparte. Reducir fricción de captura = repetibilidad.
