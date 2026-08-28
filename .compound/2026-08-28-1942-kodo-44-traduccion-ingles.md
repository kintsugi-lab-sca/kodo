---
fecha: 2026-08-28
proyecto: kodo
slug: traduccion-ingles-codebase
---

## Resumen
Traducido a inglés el material doc-facing del repo (README, PLAN, packaging Homebrew) y los docblocks de contrato de tres módulos de `src/`, en dos commits separados por riesgo.
Suite completa verde (3376/3377) y conteo de IDs de contrato idéntico byte a byte entre HEAD y el árbol de trabajo.

## Reto
El README citaba literalmente output que el runtime emite **todavía en español** y que tiene tests asertándolo (`N por integrar`, `[kodo] N eventos nuevos …`, cabecera de `kodo integrate`, `⚠ solo-mapeado`). Traducir esas citas habría hecho que el doc mintiese sobre lo que se ve en pantalla, así que hubo que distinguir *prosa traducible* de *literal de contrato* fichero por fichero, con `grep` sobre `src/` y `test/` para cada cadena sospechosa. Queda pendiente decidir si se traduce la UI del runtime (cambio distinto: toca `src/` + tests) y si `PLAN.md` debe seguir exponiendo la IP `178.104.51.37` y el host interno en un repo público.

## Propuesta de skill
Un skill `i18n-doc-sync` que, antes de traducir un `.md`, extraiga sus spans de código inline y bloques citados, los grepee contra `src/` y `test/`, y marque cuáles son literales de runtime intocables — luego valide el resultado con un checklist estructural cruzado (headings, fences, filas de tabla, conteo de subcomandos), que es justo lo que se hizo a mano aquí.
