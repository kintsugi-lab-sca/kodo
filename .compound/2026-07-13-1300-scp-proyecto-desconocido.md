---
fecha: 2026-07-13
proyecto: kodo
slug: scp-proyecto-desconocido
---

## Resumen
Arreglado el dispatch de SCP en dos capas: (1) el proyecto faltaba en providers.plane.projects de config.json (el dashboard lo mostraba mapeado vía projects.json → "UNKNOWN-9"); (2) la label kodo:gsd fallaba con resolver_failed no-match porque exige título de tarea == título de fase del ROADMAP, y además el parser no reconoce headings "Phase N (MVP):". Config corregida, estado "In Review" creado en Plane, label cambiada a kodo:gsd-quick → sesión SCP-9 lanzada y verificada (KODO-10 creado para el gap de UX).

## Reto
Dos fuentes de verdad desalineadas (config.json vs projects.json) + errores de dispatch crípticos en el log ("resolver_failed — no-match" sin explicar el contrato tarea↔fase de kodo:gsd) → dos rondas de diagnóstico para un mismo "no funciona".

## Propuesta de skill
Un `kodo doctor` (o check en el dashboard) que cruce projects.json vs config.providers.plane.projects vs estados requeridos (trigger/review/done) por proyecto y avise de desalineaciones antes de que un webhook falle.
