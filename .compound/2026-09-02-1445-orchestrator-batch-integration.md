---
fecha: 2026-09-02
proyecto: kodo
slug: orchestrator-batch-integration
---

## Resumen
Orquestación de batch KODO-72/73 con shipping a production de dos features (dispatcher queue pressure warnings, blocker respect) y avance de KODO-75 en fix-validate cycle tras detección de CI failure. Identificadas dos gotchas críticas en Claude Code auto-fill suggestions e observation search indexing que impactan reliability de futuras automatizaciones.

## Reto
Claude Code pre-filling suggestions son indistinguibles de input operador en cmux read-screen output, creando riesgo de malattribución y ejecución accidental; observation search system tiene lag indexando observaciones del mismo día, complicando post-processing de sesiones con work tracking.

## Propuesta de skill
Skill de orchestrator watchdog loop que automatice ciclos de rondas: verifica estado de sesiones paralelas, detecta CI failures con parsing de logs, ejecuta cherry-picks y pushes, coordina queue progression, y sincroniza mirror repos sin intervención manual en cada round.
