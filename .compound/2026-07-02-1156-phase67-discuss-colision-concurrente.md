---
fecha: 2026-07-02
proyecto: kodo
slug: phase67-discuss-colision-concurrente
---

## Resumen
Ejecuté `/gsd-discuss-phase 67 --auto` y produje el 67-CONTEXT.md (writeEnvVar chmod-0600-pre-rename + merge, masked input, grep de higiene de 5 sinks); al auto-avanzar a plan detecté que el daemon kodo (KODO-8, dogfooding) ya había planificado 67-01/02/03 concurrentemente desde mi mismo CONTEXT.
Detuve la cadena `--auto` antes de ejecutar y conservé los planes existentes, evitando dos ejecutores sobre `~/.kodo/.env` real y el daemon vivo.

## Reto
El `--auto` de GSD encadena discuss→plan→execute sin detectar que otro pipeline (el propio daemon kodo procesando la misma work item) corre en paralelo sobre la misma fase; el peligro real no era la redundancia de planning sino la doble ejecución sobre secretos/`config.json` compartidos.

## Propuesta de skill
Un pre-flight de concurrencia en el auto-advance de plan/execute: antes de spawnear planner o ejecutar, comprobar `git log` reciente + PID del daemon kodo + marcador "planning complete" del mismo padded_phase y abortar la cadena si otro runner ya tocó la fase (no existe candidata en find-skills; describir como `gsd-concurrency-guard`).
