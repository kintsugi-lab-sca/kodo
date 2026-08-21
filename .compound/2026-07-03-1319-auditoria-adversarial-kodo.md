---
fecha: 2026-07-03
proyecto: kodo
slug: auditoria-adversarial
---

## Resumen
Auditoría adversarial completa de kodo (~22k LOC) vía 9 subagentes por subsistema + lectura directa de caminos críticos; se consolidó un informe con mapa del sistema, hallazgos por severidad, 5 tensiones de diseño y deriva documental.
Hallazgos ancla: state.json multi-escritor sin lock (el comentario "único escritor" es falso), bind 0.0.0.0 con DELETE destructivo sin auth, GSD lock TOCTOU, zombis status:running filtrando max_parallel, cursor de polling que pierde tareas en fallo de dispatch, y README describiendo un stop-hook que ya no toca Plane.

## Reto
Los subagentes en background entregan "idle_notification" pero su informe final no vuelve como tool result automáticamente; hubo que pedir cada informe explícitamente vía SendMessage. Coordinar 9 fan-outs + verificación cruzada sin duplicar lecturas requirió trazar yo mismo el núcleo (state/dispatcher/manager/server/hooks) y delegar la periferia.

## Propuesta de skill
Un skill "adversarial-audit-fanout" que orqueste el patrón: particionar el repo por subsistema, lanzar N auditores con prompt de refutación CONFIRMADO/PLAUSIBLE, y recolectar+deduplicar informes automáticamente (evitando el paso manual de re-pedir cada reporte). Candidata cercana: no existe; el más próximo es gsd-code-review pero es single-agent y scope de diff, no auditoría full-repo multi-agente.
