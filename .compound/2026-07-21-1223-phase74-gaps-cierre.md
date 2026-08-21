---
fecha: 2026-07-21
proyecto: kodo
slug: phase74-gaps-cierre
---

## Resumen
Ejecutada la fase 74 en modo --gaps-only: 74-07 añadió a `kodo doctor` el detector puro de deriva instalación↔settings (`checkHookRegistration` sobre `KODO_HOOKS`, ERROR+exit 1) y 74-08 registró el hook SessionEnd real con verificación en vivo (checkpoint blocking-human aprobado).
Resultado: G-74-4 cerrado end-to-end (`state.tasks` poblado por un cierre real + telemetría de session_id real), verificación de fase passed 5/5, UAT resolved 8/8, milestone v0.17 con sus 4 fases verificadas.

## Reto
El must-have de 74-08 exigía «doctor sale 0», pero `kodo doctor` comparte un único exit code entre secciones: el finding preexistente `mapped_not_dispatched` (residuo KODO-10) fuerza exit 1 aunque la sección hooks esté limpia — hubo que documentarlo como desviación en vez de poder afirmar el criterio literal.

## Propuesta de skill
No existe candidata en find-skills: un skill de «gate por sección» para CLIs de diagnóstico que verifique el estado de UNA sección (p. ej. `kodo doctor --json` + jq sobre `hooks.missing`) en lugar del exit code global, evitando falsos rojos por findings ajenos al criterio bajo prueba.
