---
fecha: 2026-08-09
proyecto: kodo
slug: diri-agent-manifest-research
---

## Resumen
Investigué adopción del patrón de agent manifest de diri (orchestrador Swift) como solución para desacoplar referencias hardcodeadas a 'claude' en kodo. Mapeé 3 puntos críticos de acoplamiento en config.js, orchestrator/launch.js y session/health.js que podrían refactorizarse usando manifests JSON configurables.

## Reto
Diri está diseñado para macOS con Swift + Rust. Kodo es Node.js cross-platform. El challenge es adaptar el patrón de manifests declarativos a una arquitectura Node sin replicar la complejidad nativa de diri.

## Propuesta de skill
Un skill que automatice refactoring de config.claude hacia agent manifests declarativos en JSON (similar a diri pero para Node.js), con loader parametrizable que desacople el agente del core orchestration.
